import { NETWORKS } from './networks.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const LOGO_DIR = fileURLToPath(new URL('../public/img/pay/', import.meta.url));
let logoCache = null, logoAt = 0;
function payLogos() {
  if (logoCache && Date.now() - logoAt < 60000) return logoCache;
  const out = {};
  try { for (const f of fs.readdirSync(LOGO_DIR)) { const m = /^(moncash|natcash|bank)\.(png|svg|webp|jpg)$/i.exec(f); if (m) out[m[1].toUpperCase()] = 'img/pay/' + f; } } catch {}
  logoCache = out; logoAt = Date.now(); return out;
}
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
import * as links from './services/links.js';
import * as orders from './services/orders.js';
import * as disputes from './services/disputes.js';
import { addBlock } from './services/screening.js';
import * as providers from './services/providers.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((v) => { if (v !== undefined) res.json(v); }).catch(next);

export const api = express.Router();

api.get('/config', wrap(async () => ({
  escrow_mode: config.escrowMode,
  pay_window_min: config.payWindowMin,
  pay_grace_min: config.payGraceMin,
  fee_rate: config.feeRate,
  mock_otp: isMockSms() ? '000000' : null,
  code_channel: config.smsProvider === 'email' ? 'email' : 'sms',
  network: config.escrowNetwork,
  // Official logo files, if you add them to public/img/pay/ (moncash.png, natcash.png, bank.png). Otherwise the name is shown.
  pay_logos: payLogos(),
  link_fee: config.linkFeeUsdt,
  networks: Object.entries(NETWORKS).map(([k, v]) => ({ id: k, label: v.label, fee: v.fee, auto: k === config.escrowNetwork })),
  withdraw_fee: config.withdrawFee,
  lock_fee: config.lockFee,
  chain: isMock() ? null : { chain_id: config.evmChainId, contract: config.evmContract, app_wallet: evm.appWalletAddress(),
    tokens: { USDT: config.tokenUsdt, USDC: config.tokenUsdc || null } },
  terms_version: config.termsVersion,
  departments: users.DEPARTMENTS,
  response_mins: users.RESPONSE_MINS,
  provider_alerts: await providers.alerts(),
})));

// ---------- auth ----------
api.post('/auth/request-code', otp.ipLimit, wrap(async (req) => {
  const { phone, email } = req.body || {};
  checkPhone(phone);
  return otp.requestCode(phone, email);
}));

// Signup proves the phone is yours with an SMS code (in test mode the code is not checked).
api.post('/auth/signup', wrap(async (req) => {
  const { phone, full_name, code, accept_terms } = req.body || {};
  checkPhone(phone);
  if (accept_terms !== true) throw bad('You must read and accept the Terms and Conditions to create an account.', 'TERMS');
  const owner = config.adminPhones.includes(phone);
  let proof = null;
  if (!isMockSms() || code !== undefined || owner) proof = await otp.verifyCode(phone, code, owner);
  // Email codes: the email that got the code becomes the account's email.
  const u = await users.signup({ phone, full_name, email: proof?.email || null, accept_terms: true });
  return { token: makeToken(u.id), user: users.publicUser(u) };
}));

api.post('/auth/login', wrap(async (req) => {
  const { phone, code } = req.body || {};
  checkPhone(phone);
  const known = await users.findByPhone(phone);
  await otp.verifyCode(phone, code, config.adminPhones.includes(phone) || (known && known.role !== 'USER'));
  const u = known;
  if (!u) throw notFound('No account for this phone.');
  if (u.closed_at) throw forbidden('This account is closed.', 'CLOSED');
  if (u.banned) throw forbidden('Account is frozen or banned.');
  return { token: makeToken(u.id), user: users.publicUser(u) };
}));

// The market is public to look at (so the home page can show live ads). Names are shortened.
api.get('/public/ads', wrap(async (req) => (await ads.listAds({ side: req.query.side === 'BUY' ? 'BUY' : 'SELL' })).map((a) => {
  const [first, ...rest] = String(a.owner_name).trim().split(/\s+/);
  return { side: a.side, asset: a.asset, price_htg: a.price_htg, remaining: a.remaining, min_order_htg: a.min_order_htg,
    max_order_htg: a.max_order_htg, pay_type: a.pay_type, pay_types: a.pay_types || [a.pay_type], trades: a.trades, rating: a.rating,
    id_verified: a.id_verified, has_avatar: a.has_avatar, is_business: a.is_business, id: a.owner_id, completion_pct: a.completion_pct, avg_release_min: a.avg_release_min,
    owner: a.is_business ? a.owner_name : rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first };
})));

// Public business pages: anyone can look at a trader before buying. Personal names are shortened (Jean B.).
const shortName = (n) => { const [first, ...rest] = String(n).trim().split(/\s+/); return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first; };
api.get('/public/profile/:id', wrap(async (req) => {
  const p = await users.publicProfile(req.params.id);
  return { ...p, name: p.is_business ? p.name : shortName(p.name) };
}));
api.get('/public/poster/:id', wrap(async (req, res) => {
  const a = /^[0-9a-f-]{36}$/.test(req.params.id) ? await users.getPoster(req.params.id) : null;
  if (!a) { res.status(404).end(); return; }
  res.set('Content-Type', a.mime).set('Cache-Control', 'public, max-age=3600').send(a.data);
}));

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
  payment_methods: [...(await users.myPaymentMethods(req.user.id)).filter((p) => !p.is_receiver), ...(await links.linkedAccounts(req.user.id))],
})));
// Gasless withdraw on the real chain: get the message to sign, then send the signature. The app pays the gas.
api.get('/wallet/withdraw-typed-data', wrap(async (req) => {
  if (isMock()) throw bad('Only needed on a real chain.');
  const asset = String(req.query.asset || 'USDT').toUpperCase();
  if (!['USDT', 'USDC'].includes(asset)) throw bad('Asset must be USDT or USDC.');
  return evm.withdrawPrep(req.user.id, asset, req.query.amount, req.query.to);
}));
api.post('/wallet/withdraw-gasless', wrap(async (req) => {
  if (isMock()) throw bad('Only needed on a real chain.');
  const b = req.body || {}, asset = String(b.asset || 'USDT').toUpperCase();
  if (!['USDT', 'USDC'].includes(asset)) throw bad('Asset must be USDT or USDC.');
  return evm.relayWithdraw(req.user.id, asset, String(b.amount), b.to, Number(b.deadline), String(b.signature || ''));
}));
api.get('/me/wallet-link-message', wrap(async (req) => ({ message: evm.linkMessage(req.user.id) })));
api.put('/me/wallet-address', wrap(async (req) => { await users.setWallet(req.user, req.body?.wallet_addr, req.body?.signature); return { ok: true }; }));

// ---------- KYC + payment accounts ----------
api.get('/kyc/me', wrap(async (req) => users.kycState(req.user)));
api.post('/kyc/file/:kind', wrap(async (req) => users.addKycFile(req.user, String(req.params.kind).toUpperCase(), req.body)));
api.post('/kyc', wrap(async (req) => users.submitKyc(req.user, req.body || {})));
api.get('/links', wrap(async (req) => links.list(req.user)));
api.post('/links', wrap(async (req) => links.invite(req.user, req.body || {})));
api.post('/links/:id/accept', wrap(async (req) => links.accept(req.user, req.params.id, req.body || {})));
api.post('/links/:id/end', wrap(async (req) => links.end(req.user, req.params.id)));
api.get('/links/to-check', wrap(async (req) => links.toCheck(req.user)));
api.post('/links/to-check/:orderId', wrap(async (req) => links.answer(req.user, req.params.orderId, req.body?.received === true)));
api.put('/me/payout', wrap(async (req) => users.setPayout(req.user, req.body || {})));
api.post('/me/close', wrap(async (req) => users.closeAccount(req.user)));
api.put('/me/profile', wrap(async (req) => users.setProfile(req.user, req.body || {})));
api.post('/me/accept-terms', wrap(async (req) => users.acceptTerms(req.user)));
api.post('/me/posters', wrap(async (req) => users.addPoster(req.user, req.body || {})));
api.delete('/me/posters/:id', wrap(async (req) => users.removePoster(req.user, req.params.id)));
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
api.post('/orders/:id/rate', wrap(async (req) => orders.rate(req.user, req.params.id, req.body?.stars, req.body?.comment)));
api.post('/orders/:id/eta', wrap(async (req) => orders.setEta(req.user, req.params.id, req.body?.minutes)));
api.post('/orders/:id/delay', wrap(async (req) => orders.payDelay(req.user, req.params.id)));
api.post('/orders/:id/report', wrap(async (req) => orders.report(req.user, req.params.id, req.body || {})));
api.post('/orders/:id/evidence', wrap(async (req) => disputes.addEvidence(req.user, req.params.id, req.body || {})));
api.post('/orders/:id/evidence/upload', wrap(async (req) => disputes.addUpload(req.user, req.params.id, req.body || {})));
api.get('/evidence/:id/file', async (req, res, next) => {
  try {
    const f = await disputes.openUpload(req.user, req.params.id);
    res.set({ 'Content-Type': f.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.send(f.data);
  } catch (e) { next(e); }
});

// ---------- staff ----------
const staff = express.Router();
staff.use(needRole('AGENT', 'ADMIN'));
staff.get('/kyc', wrap(async (req) => users.listKyc(req.query.status || 'PENDING')));
staff.get('/kyc/:id/file/:kind', wrap(async (req, res) => {
  const f = await users.kycFile(req.params.id, String(req.params.kind).toUpperCase());
  res.set('Content-Type', f.mime).set('Cache-Control', 'private, no-store').send(f.data);
}));
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
admin.get('/users', wrap(async (req) => (await q(
  `SELECT u.id, u.phone, u.full_name, u.display_name, u.role, u.tier, u.banned, u.strikes, u.created_at,
          (SELECT COUNT(*)::int FROM orders o WHERE o.buyer_id=u.id OR o.seller_id=u.id) AS orders
     FROM users u WHERE u.id <> $2 AND ($1 = '' OR u.phone ILIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
    ORDER BY u.created_at DESC LIMIT 100`, [String(req.query.q || '').trim().slice(0, 60), config.platformUserId])).rows));
admin.post('/users/:id/ban', wrap(async (req) => {
  const t = (await q('SELECT role FROM users WHERE id=$1', [req.params.id])).rows[0];
  if (!t) throw notFound();
  if (req.params.id === req.user.id || req.params.id === config.platformUserId || t.role === 'ADMIN') throw forbidden('You cannot ban this account.'); await users.setBanned(req.params.id, true, req.body?.reason); return { ok: true }; }));
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
admin.get('/chain-status', wrap(async () => (isMock() ? { mock: true } : evm.chainStatus())));
// ---- owner dashboard (maxmaserati.com/admin) ----
const started = new Date();
admin.get('/overview', wrap(async () => {
  const one = async (sql, a = []) => (await q(sql, a)).rows[0];
  const [u, o, money, wal, ads, disp] = await Promise.all([
    one(`SELECT COUNT(*) FILTER (WHERE id <> $1)::int total, COUNT(*) FILTER (WHERE tier >= 1 AND id <> $1)::int verified,
                COUNT(*) FILTER (WHERE created_at > now() - interval '7 days' AND id <> $1)::int new_7d, COUNT(*) FILTER (WHERE banned)::int banned,
                (SELECT COUNT(*)::int FROM kyc WHERE status='PENDING') kyc_pending FROM users`, [config.platformUserId]),
    one(`SELECT COUNT(*) FILTER (WHERE state IN ('ORDER_CREATED','AWAITING_PAYMENT','PAID_CLAIMED','DISPUTED','RELEASING','REFUNDING'))::int open,
                COUNT(*) FILTER (WHERE state='PAID_CLAIMED')::int waiting_release,
                COUNT(*) FILTER (WHERE state='COMPLETED' AND updated_at > now() - interval '1 day')::int done_24h,
                COUNT(*) FILTER (WHERE state='COMPLETED' AND updated_at > now() - interval '7 days')::int done_7d,
                COUNT(*) FILTER (WHERE state='COMPLETED')::int done_all FROM orders`),
    one(`SELECT COALESCE(SUM(total_htg) FILTER (WHERE updated_at > now() - interval '7 days'),0)::text htg_7d,
                COALESCE(SUM(amount) FILTER (WHERE updated_at > now() - interval '7 days'),0)::text usd_7d,
                COALESCE(SUM(total_htg),0)::text htg_all, COALESCE(SUM(amount),0)::text usd_all FROM orders WHERE state='COMPLETED'`),
    one(`SELECT COALESCE(SUM(locked) FILTER (WHERE user_id <> $1),0)::text locked, COALESCE(SUM(available) FILTER (WHERE user_id <> $1),0)::text available,
                COALESCE(SUM(available) FILTER (WHERE user_id = $1),0)::text fees FROM wallet_balances`, [config.platformUserId]),
    one(`SELECT COUNT(*) FILTER (WHERE status='ACTIVE' AND side='SELL')::int sell, COUNT(*) FILTER (WHERE status='ACTIVE' AND side='BUY')::int buy,
                (SELECT MIN(price_htg)::text FROM ads WHERE status='ACTIVE' AND side='SELL' AND remaining > 0) best_sell,
                (SELECT MAX(price_htg)::text FROM ads WHERE status='ACTIVE' AND side='BUY' AND remaining > 0) best_buy FROM ads`),
    one(`SELECT COUNT(*) FILTER (WHERE status='OPEN')::int open, COUNT(*)::int total FROM disputes`)]);
  const daily = (await q(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(o.total_htg),0)::text AS htg, COUNT(o.id)::int AS n
      FROM generate_series(current_date - 29, current_date, interval '1 day') d
      LEFT JOIN orders o ON o.state='COMPLETED' AND o.updated_at::date = d::date GROUP BY d ORDER BY d`)).rows;
  return { users: u, orders: o, volume: money, wallets: wal, ads, disputes: disp, daily,
    server: { escrow_mode: config.escrowMode, sms: config.smsProvider, network: config.escrowNetwork,
      fee_rate: config.feeRate, commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null, started_at: started, owner_code_set: /^\d{6}$/.test(config.adminLoginCode) } };
}));
admin.get('/orders', wrap(async (req) => (await q(
  `SELECT o.id, o.state, o.asset, o.amount::text, o.total_htg::text, o.price_htg::text, o.created_at, o.updated_at, o.pay_reference,
          COALESCE(b.display_name, b.full_name) buyer, COALESCE(s.display_name, s.full_name) seller, pm.type pay_type
     FROM orders o JOIN users b ON b.id=o.buyer_id JOIN users s ON s.id=o.seller_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id
    WHERE ($1 = '' OR o.state::text = $1) ORDER BY o.created_at DESC LIMIT 200`, [String(req.query.state || '')])).rows));
admin.get('/ads', wrap(async () => (await q(
  `SELECT a.id, a.side, a.asset, a.price_htg::text, a.remaining::text, a.total_amount::text, a.status, a.created_at,
          COALESCE(a.pay_types, ARRAY[a.pay_type::text]) pay_types, COALESCE(u.display_name, u.full_name) owner, u.phone
     FROM ads a JOIN users u ON u.id=a.user_id WHERE a.status <> 'CLOSED' ORDER BY a.side, a.price_htg LIMIT 300`)).rows));
admin.post('/ads/:id/status', wrap(async (req) => ads.setAdStatus(req.user, req.params.id, req.body?.status)));
admin.post('/run-timers', wrap(async () => orders.runTimers()));
// MonCash / NatCash / bank outage switch, and reports about finished orders (for example a reversed payment).
admin.get('/providers', wrap(async () => (await q('SELECT provider, down, note, updated_at FROM provider_status ORDER BY provider')).rows));
admin.post('/providers', wrap(async (req) => providers.set(req.user, req.body || {})));
admin.get('/reports', wrap(async () => (await q(
  `SELECT r.id, r.order_id, r.kind, r.note, r.status, r.created_at, COALESCE(u.display_name, u.full_name) AS reporter, u.phone,
          o.amount, o.asset, o.total_htg, o.buyer_id, o.seller_id
     FROM order_reports r JOIN users u ON u.id=r.reporter_id JOIN orders o ON o.id=r.order_id
    ORDER BY (r.status='OPEN') DESC, r.created_at DESC LIMIT 200`)).rows));
admin.post('/reports/:id/close', wrap(async (req) => { await q(`UPDATE order_reports SET status='CLOSED' WHERE id=$1`, [req.params.id]); return { ok: true }; }));
api.use('/admin', admin);
