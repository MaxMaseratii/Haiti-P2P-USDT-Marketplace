// Integration test: the real app against the real contract on a local test chain (ganache).
// Needs: cd contracts && npm install && npm run build   (the test skips itself if that is missing)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';
import { ethers } from 'ethers';

const require = createRequire(import.meta.url);
const built = new URL('../contracts/build/contracts.json', import.meta.url);
let ganache;
try { ganache = require('../contracts/node_modules/ganache'); } catch { /* skipped below */ }
const SKIP = !ganache || !fs.existsSync(built) ? 'contracts not built (cd contracts && npm install && npm run build)' : false;

const ADMIN_URL = process.env.TEST_ADMIN_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'haiti_evm_' + process.pid;
const base = new URL(ADMIN_URL); base.pathname = '/' + DB;
const KEYS = Object.fromEntries(['owner', 'operator', 'arbiter', 'fee', 'seller', 'buyer', 'stranger'].map((n) => [n, ethers.Wallet.createRandom().privateKey]));

let srv, provider, pool, server, url, esc, usdt, C, W, evm, config;
const U = {};
const id = (k) => U[k].id;
const addr = (k) => new ethers.Wallet(KEYS[k]).address;

async function call(method, path, body, token) {
  const r = await fetch(url + '/api' + path, { method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
const tk = (n) => U[n].token;
const units = (n) => ethers.parseUnits(String(n), 6);
const dbBal = async (k) => (await pool.query(`SELECT available::text a, locked::text l FROM wallet_balances WHERE user_id=$1 AND asset='USDT'`, [id(k)])).rows[0] || { a: '0.000000', l: '0.000000' };
const fmt = (n) => Number(ethers.formatUnits(n, 6)).toFixed(6);
const chainAvail = async (k) => fmt(await esc.available(await usdt.getAddress(), addr(k)));
const chainResv = async (k) => fmt(await esc.reserved(await usdt.getAddress(), addr(k)));
const reverts = (p, text) => assert.rejects(p, (e) => String(e.message + (e.reason || '') + (e.info?.error?.message || '')).includes(text), text);
const reconcile = async () => (await ok('GET', '/admin/reconcile', null, tk('admin')))[0];
const tick = () => ok('POST', '/admin/run-timers', {}, tk('admin'));
const sync = () => evm.scanChain();

async function deposit(who, amt) {
  const t = usdt.connect(W[who]), e = esc.connect(W[who]);
  await (await t.mint(addr(who), units(amt))).wait();
  await (await t.approve(await esc.getAddress(), units(amt))).wait();
  await (await e.deposit(await usdt.getAddress(), units(amt))).wait();
  await sync();
}
async function signup(key, phone, name, role) {
  const r = await ok('POST', '/auth/signup', { phone, full_name: name });
  U[key] = { token: r.token, id: r.user.id, name };
  if (role) await pool.query('UPDATE users SET role=$2, tier=3 WHERE id=$1', [id(key), role]);
}
async function linkWallet(key, signer = key, walletOf = key) {
  const { message } = await ok('GET', '/me/wallet-link-message', null, tk(key));
  const sig = await new ethers.Wallet(KEYS[signer]).signMessage(message);
  return call('PUT', '/me/wallet-address', { wallet_addr: addr(walletOf), signature: sig }, tk(key));
}
async function kyc(key) {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
  const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400, 2)]);
  for (const [kind, buf] of [['FRONT', PNG], ['VIDEO', WEBM]])
    await fetch(`${url}/api/kyc/file/${kind}`, { method: 'POST', headers: { authorization: 'Bearer ' + tk(key), 'content-type': 'application/octet-stream' }, body: buf });
  const k = await ok('POST', '/kyc', { id_type: 'PASSPORT', name_on_id: U[key].name, id_number: 'HT' + key.length + '0001' }, tk(key));
  await ok('POST', `/staff/kyc/${k.id}/decision`, { approve: true }, tk('admin'));
}
async function sellerSig(orderId, who = 'seller') {
  const td = await ok('GET', `/orders/${orderId}/release-typed-data`, null, tk('seller'));
  const sig = await new ethers.Wallet(KEYS[who]).signTypedData(td.domain, td.types, td.value);
  return { sig, deadline: td.deadline };
}
const state = async (oid) => (await pool.query('SELECT state FROM orders WHERE id=$1', [oid])).rows[0].state;

before(async () => {
  if (SKIP) return;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  pool = new pg.Pool({ connectionString: base.toString() });
  await pool.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));

  srv = ganache.server({ logging: { quiet: true }, chain: { chainId: 1337 },
    wallet: { accounts: Object.values(KEYS).map((k) => ({ secretKey: k, balance: '0x' + (10n ** 21n).toString(16) })) } });
  await srv.listen(0);
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${srv.address().port}`, 1337, { staticNetwork: true, pollingInterval: 50, cacheTimeout: -1, batchMaxCount: 1 });
  W = Object.fromEntries(Object.entries(KEYS).map(([n, k]) => [n, new ethers.Wallet(k, provider)]));
  C = JSON.parse(fs.readFileSync(built, 'utf8'));
  const dep = async (name, signer, ...a) => { const c = await new ethers.ContractFactory(C[name].abi, C[name].bytecode, signer).deploy(...a); await c.waitForDeployment(); return c; };
  esc = await dep('P2PEscrow', W.owner, addr('operator'), addr('arbiter'), addr('fee'));
  usdt = await dep('MockNoReturnToken', W.owner);  // USDT style: transfer returns nothing

  Object.assign(process.env, {
    DATABASE_URL: base.toString(), ESCROW_MODE: 'EVM', WORKER_INTERVAL_SEC: '3600', FEE_RATE: '0.005',
    DUAL_AGENT_HTG: '100000000', EVM_RPC_URL: `http://127.0.0.1:${srv.address().port}`, EVM_CHAIN_ID: '1337',
    EVM_ESCROW_ADDRESS: await esc.getAddress(), EVM_CONFIRMATIONS: '0', OPERATOR_PRIVATE_KEY: KEYS.operator,
    TOKEN_USDT: await usdt.getAddress(), UPLOAD_DIR: fs.mkdtempSync('/tmp/p2p-evm-up-'),
  });
  ({ config } = await import('../src/config.js'));
  evm = await import('../src/escrow-evm.js');
  await evm.initEvm();
  const { buildApp } = await import('../src/app.js');
  server = buildApp().listen(0);
  url = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (SKIP) return;
  server?.close(); evm?.resetEvm();
  await (await import('../src/db.js')).pool.end(); await pool.end();
  provider.destroy(); await srv.close();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.end();
});

let adId, pmS;

test('setup: wallet links need a signature, one wallet per account', { skip: SKIP }, async () => {
  await signup('admin', '+50930000001', 'Admin Person', 'ADMIN');
  await signup('seller', '+50937000001', 'Jean Seller');
  await signup('buyer', '+50937000002', 'Marie Buyer');
  await signup('stranger', '+50937000003', 'Paul Stranger');
  await kyc('seller'); await kyc('buyer');
  await pool.query(`UPDATE users SET tier=3 WHERE id = ANY($1)`, [[id('seller'), id('buyer')]]); // roomy limits: this test is about the chain
  pmS = await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Jean Seller', account_ref: '37111111' }, tk('seller'));
  await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Marie Buyer', account_ref: '37222222' }, tk('buyer'));
  // no signature, wrong signer, someone else's wallet
  assert.equal((await call('PUT', '/me/wallet-address', { wallet_addr: addr('seller') }, tk('seller'))).status, 400);
  assert.equal((await linkWallet('seller', 'stranger')).status, 400, 'signed by another wallet');
  assert.equal((await linkWallet('seller')).status, 200);
  assert.equal((await linkWallet('buyer')).status, 200);
  const { message } = await ok('GET', '/me/wallet-link-message', null, tk('stranger'));
  const sig = await new ethers.Wallet(KEYS.seller).signMessage(message); // seller wallet signs for the stranger account
  assert.equal((await call('PUT', '/me/wallet-address', { wallet_addr: addr('seller'), signature: sig }, tk('stranger'))).status, 409, 'wallet already belongs to the seller account');
  // the fake deposit route is closed on a real chain
  assert.equal((await call('POST', '/wallet/dev-deposit', { asset: 'USDT', amount: '5' }, tk('seller'))).status, 403);
  // an order or ad needs a linked wallet
  assert.equal((await call('POST', '/orders', { ad_id: '00000000-0000-0000-0000-000000000009', amount: '1' }, tk('stranger'))).status, 409, 'no such ad');
});

test('deposit on chain shows up in the database once. Withdraw is mirrored.', { skip: SKIP }, async () => {
  await deposit('seller', 100);
  assert.deepEqual(await dbBal('seller'), { a: '100.000000', l: '0.000000' });
  await sync(); await sync();
  assert.equal((await dbBal('seller')).a, '100.000000', 'no double credit');
  const r = await reconcile();
  assert.equal(r.ok, true, JSON.stringify(r));
  // a deposit from an unlinked wallet waits and is never credited to anyone else
  await deposit('stranger', 7);
  assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM chain_events WHERE NOT applied`)).rows[0].n, 1);
  assert.equal((await reconcile()).ok, false, 'books differ while a deposit is unclaimed. That is the alarm.');
  assert.equal((await linkWallet('stranger')).status, 200);
  await sync();
  assert.equal((await dbBal('stranger')).a, '7.000000');
  assert.equal((await reconcile()).ok, true);
});

test('SELL ad reserves on chain. Seller cannot withdraw the reserve, only the free part', { skip: SKIP }, async () => {
  const a = await ok('POST', '/ads', { side: 'SELL', pay_type: 'MONCASH', price_htg: '140', amount: '50', min_order_htg: '100', max_order_htg: '10000', payment_method_id: pmS.id }, tk('seller'));
  adId = a.id;
  assert.equal(await chainResv('seller'), '50.250000');
  assert.equal(await chainAvail('seller'), '49.750000');
  const e = esc.connect(W.seller), t = await usdt.getAddress();
  await reverts(e.withdraw(t, units(49.76)), 'not enough free balance');
  await (await e.withdraw(t, units(9.75))).wait();
  await sync();
  assert.deepEqual(await dbBal('seller'), { a: '40.000000', l: '50.250000' });
  assert.equal((await reconcile()).ok, true);
  // the seller cannot create an ad bigger than what the contract holds
  const big = await call('POST', '/ads', { side: 'SELL', pay_type: 'MONCASH', price_htg: '140', amount: '500', min_order_htg: '100', max_order_htg: '10000', payment_method_id: pmS.id }, tk('seller'));
  assert.equal(big.status, 400);
});

test('trade: lock on chain, buyer claims, seller signs release, buyer withdraws', { skip: SKIP }, async () => {
  const o = await ok('POST', '/orders', { ad_id: adId, amount: '10' }, tk('buyer'));
  assert.equal(o.state, 'AWAITING_PAYMENT');
  const co = await esc.orders(ethers.id(o.id));
  assert.equal(co.status, 1n); assert.equal(co.claimed, false);
  assert.equal(await chainResv('seller'), '40.200000'); // 50.25 - 10.05
  await ok('POST', `/orders/${o.id}/paid`, {}, tk('buyer'));
  assert.equal((await esc.orders(ethers.id(o.id))).claimed, true, 'chain knows the buyer claimed');
  // the app key cannot cancel it on chain any more
  await reverts(esc.connect(W.operator).refund(ethers.id(o.id), false), 'already claimed');
  // release needs the seller's signature (no arbiter key on this server)
  assert.equal((await call('POST', `/orders/${o.id}/confirm`, {}, tk('seller'))).status, 400);
  const forged = await sellerSig(o.id, 'buyer'); // signed by the buyer wallet
  assert.equal((await call('POST', `/orders/${o.id}/confirm`, forged, tk('seller'))).status, 400, 'not the seller wallet');
  const good = await sellerSig(o.id);
  const done = await ok('POST', `/orders/${o.id}/confirm`, good, tk('seller'));
  assert.equal(done.state, 'COMPLETED');
  assert.equal(await chainAvail('buyer'), '10.000000');
  assert.equal(await chainAvail('fee'), '0.050000');
  assert.equal((await esc.orders(ethers.id(o.id))).status, 2n);
  assert.deepEqual(await dbBal('buyer'), { a: '10.000000', l: '0.000000' });
  assert.equal((await reconcile()).ok, true);
  // buyer takes the USDT out to their own wallet
  await (await esc.connect(W.buyer).withdraw(await usdt.getAddress(), units(10))).wait();
  assert.equal(await usdt.balanceOf(addr('buyer')), units(10));
  await sync();
  assert.deepEqual(await dbBal('buyer'), { a: '0.000000', l: '0.000000' });
  assert.equal((await reconcile()).ok, true);
});

test('buyer cancels: chain refunds, reserve is restored on chain to match the ad', { skip: SKIP }, async () => {
  const o = await ok('POST', '/orders', { ad_id: adId, amount: '5' }, tk('buyer'));
  assert.equal(await chainResv('seller'), '35.175000'); // 40.2 - 5.025
  const c = await ok('POST', `/orders/${o.id}/cancel`, {}, tk('buyer'));
  assert.equal(c.state, 'REFUNDED');
  assert.equal((await esc.orders(ethers.id(o.id))).status, 3n);
  assert.equal(await chainResv('seller'), '40.200000', 'back in the reserve');
  const ad = (await pool.query('SELECT reserved::text r FROM ads WHERE id=$1', [adId])).rows[0];
  assert.equal(ad.r, '40.200000');
  assert.equal((await reconcile()).ok, true);
});

test('closing the ad frees the reserve on chain', { skip: SKIP }, async () => {
  await ok('POST', `/ads/${adId}/status`, { status: 'CLOSED' }, tk('seller'));
  assert.equal(await chainResv('seller'), '0.000000');
  assert.equal(await chainAvail('seller'), '80.200000'); // 40 free + 40.2 freed
  assert.equal((await dbBal('seller')).l, '0.000000');
  assert.equal((await reconcile()).ok, true);
});

test('disputes: seller wins by arbiter refund, buyer wins by arbiter release', { skip: SKIP }, async () => {
  const mk = async (amount) => {
    const a = await ok('POST', '/ads', { side: 'SELL', pay_type: 'MONCASH', price_htg: '140', amount: String(amount), min_order_htg: '100', max_order_htg: '10000', payment_method_id: pmS.id }, tk('seller'));
    const o = await ok('POST', '/orders', { ad_id: a.id, amount: String(amount) }, tk('buyer'));
    await ok('POST', `/orders/${o.id}/paid`, {}, tk('buyer'));
    await ok('POST', `/orders/${o.id}/dispute`, { reason: 'seller says no money arrived' }, tk('buyer'));
    return { a, o };
  };
  const decide = async (oid, decision) => {
    const d = (await ok('GET', '/staff/disputes', null, tk('admin'))).find((x) => x.order_id === oid);
    return ok('POST', `/staff/disputes/${d.id}/vote`, { decision, note: 'checked the statement' }, tk('admin'));
  };

  // 1) buyer wins, but this server has NO arbiter key: the order waits for an arbiter on chain
  const one = await mk(10);
  await reverts(esc.connect(W.operator).refund(ethers.id(one.o.id), false), 'already claimed');
  await decide(one.o.id, 'BUYER');
  assert.equal(await state(one.o.id), 'RELEASING', 'waiting for the arbiter. Nothing was released.');
  assert.equal((await esc.orders(ethers.id(one.o.id))).status, 1n);
  await reverts(esc.connect(W.operator).release(ethers.id(one.o.id)), 'not allowed');
  await reverts(esc.connect(W.buyer).release(ethers.id(one.o.id)), 'not allowed');
  await (await esc.connect(W.arbiter).release(ethers.id(one.o.id))).wait(); // staff signs from their own wallet
  await tick();                                                              // the worker sees it on chain
  assert.equal(await state(one.o.id), 'COMPLETED');
  assert.equal(await chainAvail('buyer'), '10.000000');
  assert.equal((await reconcile()).ok, true);

  // 2) seller wins, with an arbiter key configured on the server
  config.arbiterKey = KEYS.arbiter; evm.resetEvm(); await evm.initEvm();
  const two = await mk(20);
  await decide(two.o.id, 'SELLER');
  assert.equal(await state(two.o.id), 'REFUNDED');
  assert.equal((await esc.orders(ethers.id(two.o.id))).status, 3n);
  assert.equal((await reconcile()).ok, true);

  // close ads and finish with equal books
  for (const x of [one.a, two.a]) await ok('POST', `/ads/${x.id}/status`, { status: 'CLOSED' }, tk('seller'));
  await tick();
  assert.equal(await chainResv('seller'), '0.000000');
  const r = await reconcile();
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('gasless withdraw: buyer signs in the app, app key pays gas, fee goes to the platform, books stay equal', { skip: SKIP }, async () => {
  assert.equal(await chainAvail('buyer'), '10.000000');
  const to = addr('stranger');
  const before = await usdt.balanceOf(to);
  const ethBefore = await provider.getBalance(addr('buyer'));
  const feeBefore = await chainAvail('fee');
  // too small: must be above the 1 USDT fee
  assert.equal((await call('GET', `/wallet/withdraw-typed-data?asset=USDT&amount=1&to=${to}`, null, tk('buyer'))).status, 400);
  const td = await ok('GET', `/wallet/withdraw-typed-data?asset=USDT&amount=10&to=${to}`, null, tk('buyer'));
  assert.equal(td.fee, '1');
  const sig = await new ethers.Wallet(KEYS.buyer).signTypedData(td.domain, td.types, td.value);
  // someone else's signature is refused
  const wrong = await new ethers.Wallet(KEYS.seller).signTypedData(td.domain, td.types, td.value);
  assert.equal((await call('POST', '/wallet/withdraw-gasless', { asset: 'USDT', amount: '10', to, deadline: td.value.deadline, signature: wrong }, tk('buyer'))).status, 400);
  const r = await ok('POST', '/wallet/withdraw-gasless', { asset: 'USDT', amount: '10', to, deadline: td.value.deadline, signature: sig }, tk('buyer'));
  assert.equal(r.receive, '9.0');
  assert.equal(await usdt.balanceOf(to) - before, units(9));
  assert.equal(await provider.getBalance(addr('buyer')), ethBefore, 'buyer paid no gas');
  assert.equal(Number(await chainAvail('fee')) - Number(feeBefore), 1);
  await sync();
  assert.deepEqual(await dbBal('buyer'), { a: '0.000000', l: '0.000000' });
  // the same signature cannot be sent again
  assert.equal((await call('POST', '/wallet/withdraw-gasless', { asset: 'USDT', amount: '10', to, deadline: td.value.deadline, signature: sig }, tk('buyer'))).status, 400);
  const rc = await reconcile();
  assert.equal(rc.ok, true, JSON.stringify(rc));
});
