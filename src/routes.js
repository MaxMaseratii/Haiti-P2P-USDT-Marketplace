import express from 'express';
import { q, tx } from './db.js';
import { config, isMock } from './config.js';
import { auth, needRole, makeToken, checkOtp, checkPhone } from './auth.js';
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
  mock_otp: isMock() ? '000000' : null,
}));

// ---------- auth ----------
api.post('/auth/signup', wrap(async (req) => {
  const u = await users.signup(req.body || {});
  return { token: makeToken(u.id), user: users.publicUser(u) };
}));

api.post('/auth/login', wrap(async (req) => {
  const { phone, code } = req.body || {};
  checkPhone(phone);
  checkOtp(code);
  const u = await users.findByPhone(phone);
  if (!u) throw notFound('No account for this phone.');
  if (u.banned) throw forbidden('Account is frozen or banned.');
  return { token: makeToken(u.id), user: users.publicUser(u) };
}));

// Everything below needs login.
api.use(auth);

api.get('/me', wrap(async (req) => ({
  user: users.publicUser(req.user),
  wallet: await wallet.balances({ query: q }, req.user.id),
  payment_methods: await users.myPaymentMethods(req.user.id),
})));
api.put('/me/wallet-address', wrap(async (req) => { await users.setWallet(req.user, req.body?.wallet_addr); return { ok: true }; }));

// ---------- KYC + payment accounts ----------
api.post('/kyc', wrap(async (req) => users.submitKyc(req.user, req.body || {})));
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
api.post('/orders/:id/confirm', wrap(async (req) => orders.sellerConfirm(req.user, req.params.id)));
api.post('/orders/:id/dispute', wrap(async (req) => orders.openDispute(req.user, req.params.id, req.body?.reason)));
api.get('/orders/:id/chat', wrap(async (req) => orders.getChat(req.user, req.params.id)));
api.post('/orders/:id/chat', wrap(async (req) => orders.postChat(req.user, req.params.id, req.body?.body)));
api.post('/orders/:id/rate', wrap(async (req) => orders.rate(req.user, req.params.id, req.body?.stars)));
api.post('/orders/:id/evidence', wrap(async (req) => disputes.addEvidence(req.user, req.params.id, req.body || {})));

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
admin.post('/run-timers', wrap(async () => orders.runTimers()));
api.use('/admin', admin);
