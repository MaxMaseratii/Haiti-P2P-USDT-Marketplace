import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import { ethers } from 'ethers';

const C = JSON.parse(fs.readFileSync(new URL('../build/contracts.json', import.meta.url), 'utf8'));
const keys = Array.from({ length: 8 }, () => ethers.Wallet.createRandom().privateKey);
let provider, W, esc, usdc, usdt, gp, srv;
const [OWNER, OP, ARB, FEE, SELLER, BUYER, STRANGER, SELLER2] = [0, 1, 2, 3, 4, 5, 6, 7];
const id = (s) => ethers.id(s);
const U = (n) => BigInt(Math.round(n * 1e6));

async function deploy(name, signer, ...args) {
  const f = new ethers.ContractFactory(C[name].abi, C[name].bytecode, signer);
  const c = await f.deploy(...args); await c.waitForDeployment(); return c;
}
const as = (c, i) => c.connect(W[i]);
const bad = async (p, msg) => assert.rejects(p, (e) => (msg ? String(e.message + (e.reason || '') + (e.info?.error?.message || '')).includes(msg) : true), msg);

before(async () => {
  srv = ganache.server({ logging: { quiet: true }, chain: { chainId: 1337 },
    wallet: { accounts: keys.map((k) => ({ secretKey: k, balance: '0x' + (10n ** 21n).toString(16) })) } });
  await srv.listen(0);
  gp = srv.provider;
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${srv.address().port}`, 1337, { staticNetwork: true, pollingInterval: 50, cacheTimeout: -1, batchMaxCount: 1 });
  W = keys.map((k) => new ethers.Wallet(k, provider));
  const addr = (i) => keys.map((k) => new ethers.Wallet(k).address)[i];
  esc = await deploy('P2PEscrow', W[OWNER], addr(OP), addr(ARB), addr(FEE));
  usdc = await deploy('MockToken', W[OWNER], 'USDC');
  usdt = await deploy('MockNoReturnToken', W[OWNER]);
  for (const t of [usdc, usdt]) for (const i of [SELLER, BUYER, SELLER2]) {
    await (await t.mint(await W[i].getAddress(), U(1000))).wait();
    await (await as(t, i).approve(await esc.getAddress(), U(1000))).wait();
  }
});
after(async () => { provider.destroy(); await srv.close(); });

const a = async (i) => await W[i].getAddress();
const avail = async (t, i) => esc.available(await t.getAddress(), await a(i));
const resv = async (t, i) => esc.reserved(await t.getAddress(), await a(i));

test('deposit and withdraw work with both token styles (returns bool / returns nothing)', async () => {
  for (const t of [usdc, usdt]) {
    await (await as(esc, SELLER).deposit(await t.getAddress(), U(100))).wait();
    assert.equal(await avail(t, SELLER), U(100));
    await (await as(esc, SELLER).withdraw(await t.getAddress(), U(40))).wait();
    assert.equal(await avail(t, SELLER), U(60));
    assert.equal(await t.balanceOf(await a(SELLER)), U(940));
    await bad(as(esc, SELLER).withdraw(await t.getAddress(), U(61)), 'not enough free balance');
    await (await as(esc, SELLER).withdraw(await t.getAddress(), U(60))).wait();
  }
});

test('happy path: lock, claimed, seller releases. Buyer and fee get credited, money adds up', async () => {
  const tk = await usdc.getAddress();
  await (await as(esc, SELLER).deposit(tk, U(100.5))).wait();
  const oid = id('order-1');
  await (await as(esc, OP).lock(oid, await a(SELLER), await a(BUYER), tk, U(100), U(0.5), false)).wait();
  assert.equal(await avail(usdc, SELLER), 0n);
  await bad(as(esc, OP).lock(oid, await a(SELLER), await a(BUYER), tk, U(1), 0, false), 'order exists');
  await (await as(esc, OP).markClaimed(oid)).wait();
  // nobody but the seller or arbiter can release. The operator cannot.
  await bad(as(esc, OP).release(oid), 'not allowed');
  await bad(as(esc, BUYER).release(oid), 'not allowed');
  await bad(as(esc, STRANGER).release(oid), 'not allowed');
  await (await as(esc, SELLER).release(oid)).wait();
  assert.equal(await avail(usdc, BUYER), U(100));
  assert.equal(await esc.available(tk, await a(FEE)), U(0.5));
  await bad(as(esc, SELLER).release(oid), 'not locked');          // no double release
  await bad(as(esc, ARB).refund(oid, false), 'not locked');       // no refund after release
  await (await as(esc, BUYER).withdraw(tk, U(100))).wait();
  assert.equal(await usdc.balanceOf(await esc.getAddress()), U(0.5)); // only the fee is left inside
});

test('operator cannot refund once the buyer claimed payment. Arbiter can.', async () => {
  const tk = await usdc.getAddress();
  await (await as(esc, SELLER).deposit(tk, U(50))).wait();
  const oid = id('order-2');
  await (await as(esc, OP).lock(oid, await a(SELLER), await a(BUYER), tk, U(50), 0, false)).wait();
  await (await as(esc, OP).markClaimed(oid)).wait();
  await bad(as(esc, OP).refund(oid, false), 'already claimed');
  await bad(as(esc, SELLER).refund(oid, false), 'already claimed');
  await bad(as(esc, STRANGER).refund(oid, false), 'not allowed');
  await (await as(esc, ARB).refund(oid, false)).wait();
  assert.equal(await avail(usdc, SELLER), U(50));
  await bad(as(esc, ARB).release(oid), 'not locked');
});

test('arbiter can release to the buyer (dispute won by buyer)', async () => {
  const tk = await usdc.getAddress();
  const oid = id('order-3');
  await (await as(esc, OP).lock(oid, await a(SELLER), await a(BUYER), tk, U(30), 0, false)).wait();
  await (await as(esc, OP).markClaimed(oid)).wait();
  const before = await avail(usdc, BUYER);
  await (await as(esc, ARB).release(oid)).wait();
  assert.equal((await avail(usdc, BUYER)) - before, U(30));
});

test('operator can cancel an unclaimed order. Seller can self-refund only after one day.', async () => {
  const tk = await usdc.getAddress();
  const free = await avail(usdc, SELLER);
  await (await as(esc, SELLER).deposit(tk, U(20))).wait();
  const o1 = id('order-4'), o2 = id('order-5');
  await (await as(esc, OP).lock(o1, await a(SELLER), await a(BUYER), tk, U(10), 0, false)).wait();
  await (await as(esc, OP).refund(o1, false)).wait();
  await (await as(esc, OP).lock(o2, await a(SELLER), await a(BUYER), tk, U(10), 0, false)).wait();
  await bad(as(esc, SELLER).refund(o2, false), 'too early');
  await gp.request({ method: 'evm_increaseTime', params: [86400 + 5] });
  await gp.request({ method: 'evm_mine', params: [] });
  await (await as(esc, SELLER).refund(o2, false)).wait();
  assert.equal(await avail(usdc, SELLER), free + U(20));
});

test('reserve for an ad: seller cannot withdraw reserved funds. Lock and refund use the reserve', async () => {
  const tk = await usdc.getAddress();
  await (await as(esc, SELLER2).deposit(tk, U(100))).wait();
  await (await as(esc, OP).reserve(await a(SELLER2), tk, U(100))).wait();
  assert.equal(await avail(usdc, SELLER2), 0n);
  await bad(as(esc, SELLER2).withdraw(tk, 1n), 'not enough free balance');
  const oid = id('order-6');
  await (await as(esc, OP).lock(oid, await a(SELLER2), await a(BUYER), tk, U(40), U(0.2), true)).wait();
  assert.equal(await resv(usdc, SELLER2), U(59.8));
  await (await as(esc, OP).refund(oid, true)).wait();      // ad still open: back to the reserve
  assert.equal(await resv(usdc, SELLER2), U(100));
  await bad(as(esc, ARB).refund(oid, true), 'not locked');
  await (await as(esc, OP).unreserve(await a(SELLER2), tk, U(100))).wait();
  assert.equal(await avail(usdc, SELLER2), U(100));
  await bad(as(esc, OP).unreserve(await a(SELLER2), tk, 1n), 'not enough reserved');
});

test('only the operator can reserve, lock, claim. Strangers cannot touch anything', async () => {
  const tk = await usdc.getAddress();
  for (const who of [SELLER, BUYER, STRANGER, ARB, OWNER]) {
    await bad(as(esc, who).reserve(await a(SELLER), tk, 1n), 'not operator');
    await bad(as(esc, who).lock(id('x'), await a(SELLER), await a(BUYER), tk, 1n, 0, false), 'not operator');
    await bad(as(esc, who).markClaimed(id('x')), 'not operator');
  }
  await bad(as(esc, STRANGER).setRoles(await a(STRANGER), await a(STRANGER), await a(STRANGER)), 'not owner');
  await bad(as(esc, OP).setPaused(true), 'not owner');
});

test('lock needs enough funds and sane parties', async () => {
  const tk = await usdc.getAddress();
  await bad(as(esc, OP).lock(id('p1'), await a(STRANGER), await a(BUYER), tk, U(1), 0, false), 'not enough free balance');
  await bad(as(esc, OP).lock(id('p2'), await a(SELLER), await a(SELLER), tk, U(1), 0, false), 'bad parties');
  await bad(as(esc, OP).lock(id('p3'), await a(SELLER), await a(BUYER), tk, 0, 0, false), 'bad amount');
});

test('release with seller signature: anyone can send it, wrong signer / expired / replay fail', async () => {
  const tk = await usdc.getAddress();
  await (await as(esc, SELLER).deposit(tk, U(10))).wait();
  const oid = id('order-sig');
  await (await as(esc, OP).lock(oid, await a(SELLER), await a(BUYER), tk, U(10), 0, false)).wait();
  const domain = { name: 'P2PEscrow', version: '1', chainId: 1337, verifyingContract: await esc.getAddress() };
  const types = { Release: [{ name: 'orderId', type: 'bytes32' }, { name: 'deadline', type: 'uint256' }] };
  const wallet = (i) => new ethers.Wallet(keys[i]);
  const latest = (await provider.getBlock('latest')).timestamp;
  const dl = latest + 3600;
  const bySeller = ethers.Signature.from(await wallet(SELLER).signTypedData(domain, types, { orderId: oid, deadline: dl }));
  const byStranger = ethers.Signature.from(await wallet(STRANGER).signTypedData(domain, types, { orderId: oid, deadline: dl }));
  const expired = ethers.Signature.from(await wallet(SELLER).signTypedData(domain, types, { orderId: oid, deadline: latest - 10 }));
  await bad(as(esc, STRANGER).releaseWithSig(oid, dl, byStranger.v, byStranger.r, byStranger.s), 'bad signature');
  await bad(as(esc, STRANGER).releaseWithSig(oid, latest - 10, expired.v, expired.r, expired.s), 'expired');
  // a signature for another order does not work here
  const other = ethers.Signature.from(await wallet(SELLER).signTypedData(domain, types, { orderId: id('other'), deadline: dl }));
  await bad(as(esc, STRANGER).releaseWithSig(oid, dl, other.v, other.r, other.s), 'bad signature');
  await (await as(esc, STRANGER).releaseWithSig(oid, dl, bySeller.v, bySeller.r, bySeller.s)).wait();
  assert.equal(await avail(usdc, BUYER) >= U(10), true);
  await bad(as(esc, STRANGER).releaseWithSig(oid, dl, bySeller.v, bySeller.r, bySeller.s), 'not locked'); // replay
});

test('pause stops new deposits and locks but never blocks exits', async () => {
  const tk = await usdc.getAddress();
  await (await as(esc, SELLER).deposit(tk, U(5))).wait();
  const oid = id('order-pause');
  await (await as(esc, OP).lock(oid, await a(SELLER), await a(BUYER), tk, U(5), 0, false)).wait();
  await (await as(esc, OWNER).setPaused(true)).wait();
  await bad(as(esc, SELLER).deposit(tk, 1n), 'paused');
  await bad(as(esc, OP).lock(id('np'), await a(SELLER), await a(BUYER), tk, 1n, 0, false), 'paused');
  await (await as(esc, ARB).refund(oid, false)).wait();           // exits still work
  await (await as(esc, SELLER).withdraw(tk, U(5))).wait();
  await (await as(esc, OWNER).setPaused(false)).wait();
});

test('re-entrancy through a hostile token cannot double-withdraw', async () => {
  const evil = await deploy('MockReentrantToken', W[OWNER]);
  const ea = await evil.getAddress();
  await (await evil.mint(await a(SELLER), U(10))).wait();
  await (await as(evil, SELLER).approve(await esc.getAddress(), U(10))).wait();
  await (await as(esc, SELLER).deposit(ea, U(10))).wait();
  await (await evil.setTarget(await esc.getAddress())).wait();
  await (await as(esc, SELLER).withdraw(ea, U(10))).wait();
  assert.equal(await evil.balanceOf(await a(SELLER)), U(10));
  assert.equal(await evil.balanceOf(await esc.getAddress()), 0n);
  assert.equal(await esc.available(ea, await a(SELLER)), 0n);
});

test('solvency: contract token balance equals all internal balances at the end', async () => {
  const tk = await usdc.getAddress();
  const holders = await Promise.all([OWNER, OP, ARB, FEE, SELLER, BUYER, STRANGER, SELLER2].map(a));
  let sum = 0n;
  for (const h of holders) sum += (await esc.available(tk, h)) + (await esc.reserved(tk, h));
  // minus orders still locked (none are open now) -> all balances must match the contract's real token balance
  assert.equal(await usdc.balanceOf(await esc.getAddress()), sum);
});

// ---------- gasless withdraw ----------
async function signWithdraw(i, token, amount, to, maxFee, deadline, nonce) {
  const net = await provider.getNetwork();
  const domain = { name: 'P2PEscrow', version: '1', chainId: net.chainId, verifyingContract: await esc.getAddress() };
  const types = { Withdraw: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'to', type: 'address' }, { name: 'maxFee', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
  const n = nonce ?? await esc.nonces(await a(i));
  return ethers.Signature.from(await W[i].signTypedData(domain, types, { token, amount, to, maxFee, nonce: n, deadline }));
}

test('gasless withdraw: user signs, operator sends, fee goes to feeRecipient, user pays no gas', async () => {
  const tk = await usdc.getAddress();
  await (await as(esc, BUYER).deposit(tk, U(50))).wait();
  const start = await avail(usdc, BUYER);
  const to = await a(STRANGER);
  const toBefore = await usdc.balanceOf(to);
  const dl = BigInt((await provider.getBlock('latest')).timestamp + 3600);
  const buyerEthBefore = await provider.getBalance(await a(BUYER));
  const feeBefore = await avail(usdc, FEE);
  const sig = await signWithdraw(BUYER, tk, U(20), to, U(1), dl);
  await (await as(esc, OP).withdrawWithSig(await a(BUYER), tk, U(20), to, U(0.8), U(1), dl, sig.v, sig.r, sig.s)).wait();
  assert.equal(start - await avail(usdc, BUYER), U(20));
  assert.equal(await usdc.balanceOf(to) - toBefore, U(19.2));
  assert.equal(await avail(usdc, FEE) - feeBefore, U(0.8));
  assert.equal(await provider.getBalance(await a(BUYER)), buyerEthBefore, 'buyer spent no gas');
  assert.equal(await esc.nonces(await a(BUYER)), 1n);
  // the same signature cannot be used twice
  await bad(as(esc, OP).withdrawWithSig(await a(BUYER), tk, U(20), to, U(0.8), U(1), dl, sig.v, sig.r, sig.s), 'bad signature');
});

test('gasless withdraw: refuses fee above maxFee, non-operator, wrong signer, changed address, expired, too much', async () => {
  const tk = await usdc.getAddress();
  const to = await a(STRANGER);
  const start = await avail(usdc, BUYER);
  const dl = BigInt((await provider.getBlock('latest')).timestamp + 3600);
  const sig = await signWithdraw(BUYER, tk, U(10), to, U(1), dl);
  await bad(as(esc, OP).withdrawWithSig(await a(BUYER), tk, U(10), to, U(1.5), U(1), dl, sig.v, sig.r, sig.s), 'bad fee');
  await bad(as(esc, STRANGER).withdrawWithSig(await a(BUYER), tk, U(10), to, U(1), U(1), dl, sig.v, sig.r, sig.s), 'not operator');
  await bad(as(esc, OP).withdrawWithSig(await a(BUYER), tk, U(10), await a(OP), U(1), U(1), dl, sig.v, sig.r, sig.s), 'bad signature');
  await bad(as(esc, OP).withdrawWithSig(await a(SELLER), tk, U(10), to, U(1), U(1), dl, sig.v, sig.r, sig.s), 'bad signature');
  await bad(as(esc, OP).withdrawWithSig(await a(BUYER), tk, U(11), to, U(1), U(1), dl, sig.v, sig.r, sig.s), 'bad signature');
  const old = BigInt((await provider.getBlock('latest')).timestamp - 10);
  const sig2 = await signWithdraw(BUYER, tk, U(10), to, U(1), old);
  await bad(as(esc, OP).withdrawWithSig(await a(BUYER), tk, U(10), to, U(1), U(1), old, sig2.v, sig2.r, sig2.s), 'signature expired');
  const sig3 = await signWithdraw(BUYER, tk, U(5000), to, U(1), dl);
  await bad(as(esc, OP).withdrawWithSig(await a(BUYER), tk, U(5000), to, U(1), U(1), dl, sig3.v, sig3.r, sig3.s), 'not enough free balance');
  // and a good one still works after all the refusals
  await (await as(esc, OP).withdrawWithSig(await a(BUYER), tk, U(10), to, U(1), U(1), dl, sig.v, sig.r, sig.s)).wait();
  assert.equal(start - await avail(usdc, BUYER), U(10));
});
