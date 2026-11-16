import { ethers } from 'ethers';
import { q, tx } from './db.js';
import { config } from './config.js';
import * as wallet from './services/wallet.js';
import { bad } from './errors.js';

// Smart-contract escrow adapter (contracts/src/P2PEscrow.sol). UNAUDITED.
//
// The database stays the book for the app. The chain holds the money. Three rules keep them equal:
//  1. A Deposited / Withdrawn event on the chain changes the user's free balance in the database.
//  2. chain "reserved" for a user = the sum of reserved on their open SELL ads (syncReserve).
//  3. Every lock, release and refund on the chain is paired with the same move in the database.
// reconcile() compares the two. Run it often. A mismatch means stop and look.

const ABI = [
  'function owner() view returns (address)',
  'function feeRecipient() view returns (address)',
  'function available(address token, address user) view returns (uint256)',
  'function reserved(address token, address user) view returns (uint256)',
  'function orders(bytes32) view returns (address token, address seller, address buyer, uint128 amount, uint128 fee, uint64 lockedAt, bool claimed, uint8 status)',
  'function reserve(address user, address token, uint256 amount)',
  'function unreserve(address user, address token, uint256 amount)',
  'function lock(bytes32 orderId, address seller, address buyer, address token, uint256 amount, uint256 fee, bool fromReserved)',
  'function markClaimed(bytes32 orderId)',
  'function release(bytes32 orderId)',
  'function releaseWithSig(bytes32 orderId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function refund(bytes32 orderId, bool toReserved)',
  'event Deposited(address indexed token, address indexed user, uint256 amount)',
  'event Withdrawn(address indexed token, address indexed user, uint256 amount)',
  'event WithdrawFee(address indexed token, address indexed user, uint256 fee)',
  'function nonces(address) view returns (uint256)',
  'function withdrawWithSig(address user, address token, uint256 amount, address to, uint256 fee, uint256 maxFee, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
];
const ERC20 = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
const LOCKED = 1n, RELEASED = 2n, REFUNDED = 3n;

let ctx = null;
function get() {
  if (ctx) return ctx;
  for (const k of ['evmRpcUrl', 'evmChainId', 'evmContract', 'operatorKey', 'tokenUsdt'])
    if (!config[k]) throw new Error(`EVM escrow is not set up: ${k} is missing. See README.`);
  const provider = new ethers.JsonRpcProvider(config.evmRpcUrl, config.evmChainId,
    { staticNetwork: true, cacheTimeout: -1, pollingInterval: 1000 });
  const operator = new ethers.Wallet(config.operatorKey, provider);
  const arbiter = config.arbiterKey ? new ethers.Wallet(config.arbiterKey, provider) : null;
  const base = new ethers.Contract(config.evmContract, ABI, provider);
  const tokens = { USDT: config.tokenUsdt, ...(config.tokenUsdc ? { USDC: config.tokenUsdc } : {}) };
  const assetOf = Object.fromEntries(Object.entries(tokens).map(([a, t]) => [t.toLowerCase(), a]));
  ctx = { provider, operator, arbiter, base, op: base.connect(operator), arb: arbiter ? base.connect(arbiter) : null, tokens, assetOf };
  return ctx;
}
export const resetEvm = () => { ctx?.provider.destroy(); ctx = null; };

// Send one transaction at a time so nonces never collide.
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
const send = (contract, fn, ...args) => serial(async () => {
  const t = await contract[fn](...args);
  const r = await t.wait(1);
  if (!r || r.status !== 1) throw new Error(`${fn} failed on chain`);
  return r.hash;
});

const oid = (order) => ethers.id(order.id);
const units = (s) => ethers.parseUnits(String(s), 6);
const human = (n) => ethers.formatUnits(n, 6);
const tokenOf = (asset) => {
  const t = get().tokens[asset];
  if (!t) throw new Error('No token address for ' + asset);
  return t;
};
async function addrOf(userId) {
  const a = (await q('SELECT wallet_addr FROM users WHERE id=$1', [userId])).rows[0]?.wallet_addr;
  if (!a) throw new Error('User has no linked wallet');
  return a;
}
const chainOrder = (order) => get().base.orders(oid(order));

// ---------- start up ----------
export async function initEvm() {
  const { base, provider, tokens } = get();
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== config.evmChainId) throw new Error('RPC chain id does not match EVM_CHAIN_ID');
  if ((await provider.getCode(config.evmContract)) === '0x') throw new Error('No contract at EVM_ESCROW_ADDRESS');
  for (const [asset, t] of Object.entries(tokens)) { // amounts are stored with 6 decimals
    const d = await new ethers.Contract(t, ERC20, provider).decimals().catch(() => 6n);
    if (Number(d) !== 6) throw new Error(`${asset} has ${d} decimals. Only 6-decimal tokens are supported.`);
  }
  // One database = one contract. Never mix test-mode (fake) balances or another contract's books with this one.
  const bound = (await q(`SELECT value FROM chain_state WHERE key='escrow_contract'`)).rows[0]?.value;
  if (bound && bound.toLowerCase() !== config.evmContract.toLowerCase())
    throw new Error(`This database belongs to another contract (${bound}). Use a new, empty database for this contract.`);
  if (!bound) {
    const used = (await q(`SELECT (SELECT COUNT(*) FROM wallet_balances WHERE available > 0 OR locked > 0)
      + (SELECT COUNT(*) FROM orders) AS n`)).rows[0].n;
    if (Number(used) > 0) throw new Error('This database already has test-mode balances or orders. Real mode needs a new, empty database (Render: create a new PostgreSQL and point DATABASE_URL to it).');
    await q(`INSERT INTO chain_state (key, value) VALUES ('escrow_contract', $1) ON CONFLICT (key) DO NOTHING`, [config.evmContract]);
  }
  // Fees land on the contract under feeRecipient. Tie that address to the platform account.
  const fr = await base.feeRecipient();
  await q('UPDATE users SET wallet_addr=NULL WHERE lower(wallet_addr)=lower($1) AND id<>$2', [fr, config.platformUserId]);
  await q('UPDATE users SET wallet_addr=$1 WHERE id=$2', [fr, config.platformUserId]);
}

// ---------- wallet link proof ----------
export const linkMessage = (userId) => `Link this wallet to my Haiti P2P account ${userId}`;
export function verifyWalletLink(userId, addr, signature) {
  let a;
  try { a = ethers.getAddress(addr); } catch { throw bad('Wallet address looks wrong.'); }
  if (!signature) throw bad('Sign the message with your wallet to prove it is yours.', 'SIG');
  let who;
  try { who = ethers.verifyMessage(linkMessage(userId), signature); } catch { throw bad('Bad signature.', 'SIG'); }
  if (who !== a) throw bad('The signature does not match this wallet.', 'SIG');
  return a;
}

// ---------- seller release approval (EIP-712) ----------
export function releaseTypedData(order, deadline) {
  return {
    domain: { name: 'P2PEscrow', version: '1', chainId: config.evmChainId, verifyingContract: config.evmContract },
    types: { Release: [{ name: 'orderId', type: 'bytes32' }, { name: 'deadline', type: 'uint256' }] },
    value: { orderId: oid(order), deadline },
  };
}
export function verifyReleaseSig(order, sellerAddr, sig, deadline) {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(deadline) || deadline < now + 60 || deadline > now + 7 * 86400)
    throw bad('Signature deadline must be between 1 minute and 7 days from now.', 'SIG');
  const t = releaseTypedData(order, deadline);
  let who;
  try { who = ethers.verifyTypedData(t.domain, t.types, t.value, sig); } catch { throw bad('Bad signature.', 'SIG'); }
  if (who.toLowerCase() !== sellerAddr.toLowerCase()) throw bad('The signature is not from the seller wallet.', 'SIG');
}

// ---------- gasless withdraw (EIP-712). The user signs, the app key sends and pays the gas. ----------
const W_TYPES = { Withdraw: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'to', type: 'address' },
  { name: 'maxFee', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
const wDomain = () => ({ name: 'P2PEscrow', version: '1', chainId: config.evmChainId, verifyingContract: config.evmContract });
function checkWithdraw(asset, amount, to) {
  let dest; try { dest = ethers.getAddress(String(to || '').trim()); } catch { throw bad('Wallet address looks wrong.'); }
  if (!/^\d+(\.\d{1,6})?$/.test(String(amount)) || Number(amount) <= 0) throw bad('Amount must be a number above 0.');
  const fee = units(config.withdrawFee);
  if (units(amount) <= fee) throw bad(`The amount must be more than the ${config.withdrawFee} ${asset} network fee.`);
  return { dest, fee };
}
export async function withdrawPrep(userId, asset, amount, to) {
  const { base } = get();
  const { dest, fee } = checkWithdraw(asset, amount, to);
  const user = await addrOf(userId);
  const nonce = await base.nonces(user);
  const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
  return { domain: wDomain(), types: W_TYPES, primaryType: 'Withdraw', fee: config.withdrawFee,
    value: { token: tokenOf(asset), amount: units(amount).toString(), to: dest, maxFee: fee.toString(), nonce: nonce.toString(), deadline } };
}
export async function relayWithdraw(userId, asset, amount, to, deadline, signature) {
  const { op, base } = get();
  const { dest, fee } = checkWithdraw(asset, amount, to);
  const user = await addrOf(userId);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(deadline) || deadline < now || deadline > now + 3600) throw bad('This withdraw request expired. Try again.');
  const free = (await q('SELECT available FROM wallet_balances WHERE user_id=$1 AND asset=$2', [userId, asset])).rows[0]?.available || '0';
  if (units(free) < units(amount)) throw bad('Not enough balance.');
  const value = { token: tokenOf(asset), amount: units(amount), to: dest, maxFee: fee, nonce: await base.nonces(user), deadline };
  let who; try { who = ethers.verifyTypedData(wDomain(), W_TYPES, value, signature); } catch { throw bad('Bad signature.', 'SIG'); }
  if (who.toLowerCase() !== user.toLowerCase()) throw bad('The signature does not match this wallet.', 'SIG');
  const sg = ethers.Signature.from(signature);
  const txHash = await send(op, 'withdrawWithSig', user, value.token, value.amount, dest, fee, fee, BigInt(deadline), sg.v, sg.r, sg.s);
  return { txHash, fee: config.withdrawFee, receive: human(value.amount - fee) };
}

// ---------- order moves (safe to repeat) ----------
export const adapter = {
  async lock(order) {
    const { op } = get();
    const st = (await chainOrder(order)).status;
    if (st === LOCKED) return { txHash: 'chain:already-locked' };
    if (st !== 0n) throw new Error('Order is already finished on chain');
    const ad = (await q('SELECT side FROM ads WHERE id=$1', [order.ad_id])).rows[0];
    const txHash = await send(op, 'lock', oid(order), await addrOf(order.seller_id), await addrOf(order.buyer_id),
      // The chain pays the buyer "amount" and the fee wallet "fee". The buyer's lock fee moves from one to the other.
      tokenOf(order.asset), units(order.amount) - units(order.lock_fee || '0'), units(order.fee_amount) + units(order.lock_fee || '0'), ad.side === 'SELL');
    return { txHash };
  },

  // Buyer pressed "I paid". After this the app key can no longer cancel the order on chain.
  async claimed(order) {
    const { op } = get();
    const o = await chainOrder(order);
    if (o.status === LOCKED && !o.claimed) await send(op, 'markClaimed', oid(order));
  },

  async release(order) {
    const { op, arb } = get();
    const o = await chainOrder(order);
    if (o.status === RELEASED) return { txHash: 'chain:already-released' };
    if (o.status !== LOCKED) throw new Error('Order is not locked on chain');
    if (order.release_sig && Number(order.release_deadline) > Math.floor(Date.now() / 1000)) {
      const s = ethers.Signature.from(order.release_sig);
      return { txHash: await send(op, 'releaseWithSig', oid(order), BigInt(order.release_deadline), s.v, s.r, s.s) };
    }
    if (arb) return { txHash: await send(arb, 'release', oid(order)) };
    // No signature and no arbiter key here: an arbiter can call release() from their own wallet.
    // The worker will see it on chain and finish the order in the database.
    throw new Error('Waiting for the seller signature or an arbiter release');
  },

  async refund(order) {
    const { op, arb } = get();
    const o = await chainOrder(order);
    if (o.status === REFUNDED) return { txHash: 'chain:already-refunded' };
    if (o.status !== LOCKED) throw new Error('Order is not locked on chain');
    if (order.refund_reason !== 'DISPUTE_SELLER_WINS') return { txHash: await send(op, 'refund', oid(order), false) };
    if (arb) return { txHash: await send(arb, 'refund', oid(order), false) };
    throw new Error('Waiting for an arbiter refund');
  },

  // Keep chain "reserved" equal to the open SELL ads' reserve in the database.
  async syncReserve(userId, asset) {
    const { op, base } = get();
    const user = (await q('SELECT wallet_addr FROM users WHERE id=$1', [userId])).rows[0];
    if (!user?.wallet_addr) return;
    // A lock in flight is using the reserve right now. Try again later.
    if ((await q(`SELECT 1 FROM orders WHERE seller_id=$1 AND asset=$2 AND state='ORDER_CREATED' LIMIT 1`, [userId, asset])).rowCount) return;
    const target = units((await q(
      `SELECT COALESCE(SUM(reserved),0)::text AS s FROM ads WHERE user_id=$1 AND asset=$2 AND side='SELL' AND status<>'CLOSED'`,
      [userId, asset])).rows[0].s);
    const token = tokenOf(asset);
    const cur = await base.reserved(token, user.wallet_addr);
    if (target > cur) await send(op, 'reserve', user.wallet_addr, token, target - cur);
    else if (target < cur) await send(op, 'unreserve', user.wallet_addr, token, cur - target);
  },

  async syncAllReserves() {
    for (const r of (await q(`SELECT DISTINCT user_id, asset FROM ads WHERE side='SELL'`)).rows) {
      try { await this.syncReserve(r.user_id, r.asset); } catch (e) { console.error('reserve sync', r.user_id, e.message); }
    }
  },

  async tick() { await scanChain(); await this.syncAllReserves(); },
};

// ---------- deposits and withdrawals ----------
const getState = async (k) => (await q('SELECT value FROM chain_state WHERE key=$1', [k])).rows[0]?.value;
const setState = (k, v) => q(`INSERT INTO chain_state (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [k, String(v)]);

export async function scanChain() {
  const { provider, base, assetOf } = get();
  const head = await provider.getBlockNumber();
  const safe = head - config.evmConfirmations;
  const last = await getState('last_block');
  let from = last === undefined ? config.evmStartBlock : Number(last) + 1;
  while (from <= safe) {
    const to = Math.min(from + 1999, safe);
    const logs = [...await base.queryFilter(base.filters.Deposited(), from, to), ...await base.queryFilter(base.filters.Withdrawn(), from, to),
      ...await base.queryFilter(base.filters.WithdrawFee(), from, to)];
    const feeTo = logs.some((l) => l.fragment.name === 'WithdrawFee') ? await base.feeRecipient() : null;
    for (const l of logs) {
      const token = l.args.token.toLowerCase();
      if (!assetOf[token]) continue; // a token we do not trade
      // A gasless withdraw fee stays in the contract, credited to feeRecipient (the platform account).
      const isFee = l.fragment.name === 'WithdrawFee';
      if (isFee && l.args.fee === 0n) continue;
      await q(
        `INSERT INTO chain_events (tx_hash, log_index, block_number, kind, token, address, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [l.transactionHash, l.index, l.blockNumber, isFee || l.fragment.name === 'Deposited' ? 'DEPOSIT' : 'WITHDRAW', token,
          isFee ? feeTo : l.args.user, human(isFee ? l.args.fee : l.args.amount)]);
    }
    await setState('last_block', to);
    from = to + 1;
  }
  return applyEvents();
}

// Credit or debit the user whose linked wallet matches. Events for unknown wallets wait.
export async function applyEvents() {
  const { assetOf } = get();
  let n = 0;
  for (const e of (await q('SELECT * FROM chain_events WHERE NOT applied ORDER BY block_number, log_index')).rows) {
    const u = (await q('SELECT id FROM users WHERE lower(wallet_addr)=lower($1)', [e.address])).rows[0];
    if (!u) continue;
    try {
      await tx(async (c) => {
        const fresh = (await c.query('SELECT applied FROM chain_events WHERE id=$1 FOR UPDATE', [e.id])).rows[0];
        if (fresh.applied) return;
        const asset = assetOf[e.token];
        if (e.kind === 'DEPOSIT') await wallet.credit(c, u.id, asset, e.amount);
        else await wallet.debit(c, u.id, asset, e.amount);
        await c.query('UPDATE chain_events SET applied=true, error=NULL WHERE id=$1', [e.id]);
        n++;
      });
    } catch (err) {
      await q('UPDATE chain_events SET error=$2 WHERE id=$1', [e.id, err.message]);
      console.error('chain event not applied', e.id, err.message);
    }
  }
  return n;
}

// ---------- books check ----------
// For each asset: tokens held by the contract must equal everything the database says users own.
export async function reconcile() {
  const { provider, tokens } = get();
  const out = [];
  for (const [asset, t] of Object.entries(tokens)) {
    const chain = await new ethers.Contract(t, ERC20, provider).balanceOf(config.evmContract);
    const db = (await q(`SELECT COALESCE(SUM(available + locked),0)::text AS s FROM wallet_balances WHERE asset=$1`, [asset])).rows[0].s;
    const pending = (await q(`SELECT COUNT(*)::int AS n FROM chain_events WHERE NOT applied`)).rows[0].n;
    out.push({ asset, chain: human(chain), db, ok: units(db) === chain, unapplied_events: pending });
  }
  return out;
}
