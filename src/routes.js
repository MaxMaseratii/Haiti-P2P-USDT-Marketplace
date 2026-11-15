import { NETWORKS } from './networks.js';
import express from 'express';
import { q, tx } from './db.js';
import { config, isMock, isMockSms } from './config.js';
import * as evm from './escrow-evm.js';
import { auth, needRole, makeToken, checkPhone } from './auth.js';
import * as otp from './services/otp.js';
import { bad, forbidden, notFound } from './errors.js';
import * as users from './services/users.js';
import * as wallet from './services/wallet.js';
import * as ads from './services/ads.js';
import * as orders from './services/orders.js';
import * as disputes from './services/disputes.js';
import { addBlock } from './services/screening.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((v) => { if (v !== undefined) res.json(v); }).catch(next);

export const api = express.Router();

api.get('/config', (_req, res) => res.json({
  escrow_mode: config.escrowMode,
  pay_window_min: config.payWindowMin,
  pay_grace_min: config.payGraceMin,
  fee_rate: config.feeRate,
  mock_otp: isMockSms() ? '000000' : null,
  demo: config.demoSeed && isMock(),
  network: config.escrowNetwork,
  networks: Object.entries(NETWORKS).map(([k, v]) => ({ id: k, label: v.label, fee: v.fee, auto: k === config.escrowNetwork })),
  chain: isMock() ? null : { chain_id: config.evmChainId, contract: config.evmContract,
    tokens: { USDT: config.tokenUsdt, USDC: config.tokenUsdc || null } },
}));

// ---------- auth ----------
api.post('/auth/request-code', otp.ipLimit, wrap(async (req) => {
  const { phone } = req.body || {};
  checkPhone(phone);
  return otp.requestCode(phone);
}));

// Signup proves the phone is yours with an SMS code (in test mode the code is not checked).
api.post('/auth/signup', wrap(async (req) => {
  const { phone, full_name, code } = req.body || {};
  checkPhone(phone);
  if (!isMockSms() || code !== undefined) await otp.verifyCode(phone, code);
  const u = await users.signup({ phone, full_name });
  return { token: makeToken(u.id), user: users.publicUser(u) };
}));

// Test mode only: one-click login as the ready-made test buyer or test seller.
api.post('/auth/demo-login', wrap(async (req) => {
  if (!(config.demoSeed && isMock())) throw forbidden('Not available.');
  const { TEST_PHONES } = await import('./services/demo.js');
  const phone = TEST_PHONES[req.body?.who];
  if (!phone) throw bad('who must be buyer or seller.');
  const u = await users.findByPhone(phone);
  if (!u) throw notFound('Test accounts are not ready yet.');
  return { token: makeToken(u.id), user: users.publicUser(u) };
}));

api.post('/auth/login', wrap(async (req) => {
  const { phone, code } = req.body || {};
  checkPhone(phone);
  await otp.verifyCode(phone, code);
  const u = await users.findByPhone(phone);
  if (!u) throw notFound('No account for this phone.');
  if (u.banned) throw forbidden('Account is frozen or banned.');
  return { token: makeToken(u.id), user: users.publicUser(u) };
}));

// The market is public to look at (so the home page can show live ads). Names are shortened.
api.get('/public/ads', wrap(async (req) => (await ads.listAds({ side: req.query.side === 'BUY' ? 'BUY' : 'SELL' })).map((a) => {
  const [first, ...rest] = String(a.owner_name).trim().split(/\s+/);
  return { side: a.side, asset: a.asset, price_htg: a.price_htg, remaining: a.remaining, min_order_htg: a.min_order_htg,
    max_order_htg: a.max_order_htg, pay_type: a.pay_type, trades: a.trades, rating: a.rating,
    id_verified: a.id_verified, has_avatar: a.has_avatar, is_business: a.is_business, id: a.owner_id, completion_pct: a.completion_pct, avg_release_min: a.avg_release_min,
    owner: a.is_business ? a.owner_name : rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first };
})));

// Profile pictures are public (they are shown on ads).
api.get('/avatar/:id', wrap(async (req, res) => {
  const a = /^[0-9a-f-]{36}$/.test(req.params.id) ? await users.getAvatar(req.params.id) : null;
  if (!a) { res.status(404).end(); return; }
  res.set('Content-Type', a.avatar_mime).set('Cache-Control', 'public, max-age=300').send(a.avatar);
}));

// Everything below needs login.
api.use(auth);

api.get('/me', wrap(async (req) => ({
  user: users.publicUser(req.user),
  wallet: await wallet.balances({ query: q }, req.user.id),
  payment_methods: await users.myPaymentMethods(req.user.id),
})));
api.get('/me/wallet-link-message', wrap(async (req) => ({ message: evm.linkMessage(req.user.id) })));
api.put('/me/wallet-address', wrap(async (req) => { await users.setWallet(req.user, req.body?.wallet_addr, req.body?.signature); return { ok: true }; }));

// ---------- KYC + payment accounts ----------
api.post('/kyc', wrap(async (req) => users.submitKyc(req.user, req.body || {})));
api.put('/me/payout', wrap(async (req) => users.setPayout(req.user, req.body || {})));
api.put('/me/profile', wrap(async (req) => users.setProfile(req.user, req.body || {})));
api.post('/payment-methods', wrap(async (req) => users.addPaymentMethod(req.user, req.body || {})));
api.get('/payment-methods', wrap(async (req) => users.myPaymentMethods(req.user.id)));

// ---------- wallet (mock only) ----------
api.post('/wallet/dev-deposit', wrap(async (req) => {
  if (!isMock()) throw forbidden('Fake deposits only work in MOCK mode.');
  const { asset = 'USDT', amount } = req.body || {};
  if (!['USDT', 'USDC'].includes(asset) || !/^\d+(\.\d+)?$/.test(String(amount)) || Number(amount) <= 0) throw bad('Bad asset or amount.');
  if (Number(amount) > 100000) throw bad('Max 100000 per fake deposit.');
  await tx((c) => wallet.credit(c, req.user.id, asset, String(amount)));
  return wallet.balances({ query: q }, req.user.id);
}));

// ---------- ads ----------
api.get('/ads', wrap(async (req) => ads.listAds(req.query)));
api.get('/my/ads', wrap(async (req) => ads.myAds(req.user.id)));
api.post('/ads', wrap(async (req) => ads.createAd(req.user, req.body || {})));
api.post('/ads/:id/status', wrap(async (req) => ads.setAdStatus(req.user, req.params.id, req.body?.status)));

// ---------- orders ----------
api.post('/orders', wrap(async (req) => orders.createOrder(req.user, req.body || {})));
api.get('/orders', wrap(async (req) => orders.myOrders(req.user.id)));
api.get('/orders/:id', wrap(async (req) => orders.getOrderView(req.user, req.params.id)));
api.post('/orders/:id/paid', wrap(async (req) => orders.markPaid(req.user, req.params.id)));
api.post('/orders/:id/cancel', wrap(async (req) => orders.buyerCancel(req.user, req.params.id)));
api.get('/orders/:id/release-typed-data', wrap(async (req) => {
  if (isMock()) throw bad('Only needed on a real chain.');
  const o = await orders.getOrderRaw(req.params.id);
  if (o.seller_id !== req.user.id) throw forbidden('Only the seller can release.');
  const deadline = Math.floor(Date.now() / 1000) + 3 * 86400; // the seller signs this
  return { ...evm.releaseTypedData(o, deadline), deadline };
}));
api.post('/orders/:id/confirm', wrap(async (req) => orders.sellerConfirm(req.user, req.params.id, req.body || {})));
api.post('/orders/:id/dispute', wrap(async (req) => orders.openDispute(req.user, req.params.id, req.body?.reason)));
api.get('/orders/:id/chat', wrap(async (req) => orders.getChat(req.user, req.params.id)));
api.post('/orders/:id/chat', wrap(async (req) => orders.postChat(req.user, req.params.id, req.body?.body)));
api.post('/orders/:id/rate', wrap(async (req) => orders.rate(req.user, req.params.id, req.body?.stars)));
api.post('/orders/:id/evidence', wrap(async (req) => disputes.addEvidence(req.user, req.params.id, req.body || {})));
api.post('/orders/:id/evidence/upload', wrap(async (req) => disputes.addUpload(req.user, req.params.id, req.body || {})));
api.get('/evidence/:id/file', async (req, res, next) => {
  try {
    const f = await disputes.openUpload(req.user, req.params.id);
    res.set({ 'Content-Type': f.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.sendFile(f.file);
  } catch (e) { next(e); }
});

// ---------- staff ----------
const staff = express.Router();
staff.use(needRole('AGENT', 'ADMIN'));
staff.get('/kyc', wrap(async (req) => users.listKyc(req.query.status || 'PENDING')));
staff.post('/kyc/:id/decision', wrap(async (req) => users.decideKyc(req.user, req.params.id, !!req.body?.approve)));
staff.post('/payment-methods/:id/verify', wrap(async (req) => users.setPaymentVerified(req.params.id, req.body?.verified !== false)));
staff.get('/disputes', wrap(async (req) => disputes.queue(req.query.status || 'OPEN')));
staff.get('/disputes/:id', wrap(async (req) => disputes.detail(req.params.id)));
staff.post('/disputes/:id/vote', wrap(async (req) => disputes.vote(req.user, req.params.id, req.body || {})));
staff.get('/screening-hits', wrap(async () => (await q(
  `SELECT h.*, u.phone, u.full_name FROM screening_hits h JOIN users u ON u.id=h.user_id WHERE NOT h.resolved ORDER BY h.created_at`)).rows));
api.use('/staff', staff);

const admin = express.Router();
admin.use(needRole('ADMIN'));
admin.get('/limits', wrap(async () => (await q('SELECT * FROM tier_limits ORDER BY tier')).rows));
admin.put('/limits/:tier', wrap(async (req) => {
  const { max_order_htg, max_daily_htg, max_open_orders } = req.body || {};
  const r = await q(
    `UPDATE tier_limits SET max_order_htg=$2, max_daily_htg=$3, max_open_orders=$4 WHERE tier=$1 RETURNING *`,
    [req.params.tier, max_order_htg, max_daily_htg, max_open_orders]);
  if (!r.rowCount) throw notFound();
  return r.rows[0];
}));
admin.post('/users/:id/ban', wrap(async (req) => { await users.setBanned(req.params.id, true, req.body?.reason); return { ok: true }; }));
admin.post('/users/:id/unban', wrap(async (req) => { await users.setBanned(req.params.id, false); return { ok: true }; }));
admin.post('/users/:id/tier', wrap(async (req) => {
  const t = Number(req.body?.tier);
  if (![0, 1, 2, 3].includes(t)) throw bad('Tier must be 0 to 3.');
  await q('UPDATE users SET tier=$2 WHERE id=$1', [req.params.id, t]);
  return { ok: true };
}));
admin.get('/blocklist', wrap(async () => (await q('SELECT * FROM blocklist ORDER BY created_at DESC LIMIT 500')).rows));
admin.post('/blocklist', wrap(async (req) => {
  const { kind, value, reason } = req.body || {};
  if (!['PHONE', 'WALLET', 'PAY_ACCOUNT', 'NAME'].includes(kind) || !value) throw bad('Need kind and value.');
  await tx((c) => addBlock(c, kind, value, reason));
  return { ok: true };
}));
admin.post('/screening-hits/:id/resolve', wrap(async (req) => {
  const clear = !!req.body?.clear;
  await tx(async (c) => {
    const h = (await c.query('UPDATE screening_hits SET resolved=true, resolved_by=$2 WHERE id=$1 RETURNING *', [req.params.id, req.user.id])).rows[0];
    if (!h) throw notFound();
    if (clear) await c.query('UPDATE users SET banned=false WHERE id=$1', [h.user_id]); // cleared after review
  });
  return { ok: true };
}));
admin.get('/reconcile', wrap(async () => (isMock() ? { mock: true } : evm.reconcile())));
admin.post('/run-timers', wrap(async () => orders.runTimers()));
api.use('/admin', admin);
