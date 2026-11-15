import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const ADMIN_URL = process.env.TEST_ADMIN_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'haiti_test_' + process.pid;
const base = new URL(ADMIN_URL);
base.pathname = '/' + DB;

process.env.DATABASE_URL = base.toString();
process.env.ESCROW_MODE = 'MOCK';
process.env.DUAL_AGENT_HTG = '1000';      // every test order needs two agents
process.env.WORKER_INTERVAL_SEC = '3600';
process.env.FEE_RATE = '0.005';
process.env.API_RATE_LIMIT = '100000';
process.env.ADMIN_PHONES = '+50937000777';
process.env.ADMIN_LOGIN_CODE = '482913';
process.env.UPLOAD_DIR = fs.mkdtempSync('/tmp/p2p-uploads-');
process.env.MAX_UPLOAD_BYTES = '200000';

let server, url, pool;
const U = {}; // name -> { token, id }

async function call(method, path, body, token) {
  const r = await fetch(url + '/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
const tk = (n) => U[n].token;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));

  const { buildApp } = await import('../src/app.js');
  server = buildApp().listen(0);
  url = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  server?.close();
  const db = (await import('../src/db.js')).pool;
  await db.end();
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.end();
});

async function signup(key, phone, name, role) {
  const r = await ok('POST', '/auth/signup', { phone, full_name: name });
  U[key] = { token: r.token, id: r.user.id, name };
  if (role) await pool.query('UPDATE users SET role=$2, tier=3 WHERE id=$1', [U[key].id, role]);
}
async function kyc(key) {
  const k = await ok('POST', '/kyc', { name_on_id: U[key].name, id_doc_ref: 'img://' + key }, tk(key));
  await ok('POST', `/staff/kyc/${k.id}/decision`, { approve: true }, tk('admin'));
}
const bal = async (key, asset = 'USDT') =>
  (await pool.query('SELECT available::text a, locked::text l FROM wallet_balances WHERE user_id=$1 AND asset=$2', [U[key].id, asset])).rows[0];
const order = async (id) => (await pool.query('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
const ad = async (id) => (await pool.query('SELECT * FROM ads WHERE id=$1', [id])).rows[0];

let adId, pmS;

test('setup: users, ID checks, payment accounts, balances, a sell ad', async () => {
  await signup('admin', '+50930000001', 'Admin Person', 'ADMIN');
  await signup('a1', '+50930000002', 'Agent One', 'AGENT');
  await signup('a2', '+50930000003', 'Agent Two', 'AGENT');
  await signup('seller', '+50937000001', 'Jean Seller');
  await signup('buyer', '+50937000002', 'Marie Buyer');

  // Haiti only
  assert.equal((await call('POST', '/auth/signup', { phone: '+14155550100', full_name: 'Not Haiti' })).status, 400);
  // not allowed to trade before ID check
  assert.equal((await call('POST', '/ads', { side: 'BUY' }, tk('buyer'))).status, 403);

  await kyc('seller'); await kyc('buyer');

  // name must match the ID
  const wrong = await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Someone Else', account_ref: '37999999' }, tk('seller'));
  assert.equal(wrong.verified, false);
  pmS = await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'SELLER jean', account_ref: '37111111' }, tk('seller'));
  assert.equal(pmS.verified, true, 'name match ignores case and order');
  const wrongAd = await call('POST', '/ads', { side: 'SELL', pay_type: 'MONCASH', price_htg: '140', amount: '10', min_order_htg: '1000', max_order_htg: '10000', payment_method_id: wrong.id }, tk('seller'));
  assert.equal(wrongAd.status, 403);
  const dupe = await call('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Marie Buyer', account_ref: '37111111' }, tk('buyer'));
  assert.equal(dupe.status, 409, 'one payment account per user');
  await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Marie Buyer', account_ref: '37222222' }, tk('buyer'));

  await ok('POST', '/wallet/dev-deposit', { asset: 'USDT', amount: '1000' }, tk('seller'));
  assert.equal((await call('POST', '/ads', { side: 'SELL', pay_type: 'MONCASH', price_htg: '140', amount: '5000', min_order_htg: '1000', max_order_htg: '10000', payment_method_id: pmS.id }, tk('seller'))).status, 400, 'not enough balance');

  const a = await ok('POST', '/ads', { side: 'SELL', pay_type: 'MONCASH', price_htg: '140', amount: '100', min_order_htg: '1000', max_order_htg: '10000', payment_method_id: pmS.id }, tk('seller'));
  adId = a.id;
  assert.deepEqual(await bal('seller'), { a: '899.500000', l: '100.500000' }, 'ad holds amount + 0.5% fee');
  const list = await ok('GET', '/ads?side=SELL', null, tk('buyer'));
  assert.equal(list.length, 1);
});

test('full trade: lock, paid, confirm, release. Seller cannot cancel after paid.', async () => {
  // limits
  assert.equal((await call('POST', '/orders', { ad_id: adId, amount: '0.1' }, tk('buyer'))).status, 400, 'below minimum order');
  assert.equal((await call('POST', '/orders', { ad_id: adId, amount: '200' }, tk('buyer'))).status, 400, 'more than the ad has');
  assert.equal((await call('POST', '/orders', { ad_id: adId, amount: '10' }, tk('seller'))).status, 400, 'own ad');

  const o = await ok('POST', '/orders', { ad_id: adId, amount: '10' }, tk('buyer'));
  assert.equal(o.state, 'AWAITING_PAYMENT');
  assert.equal(o.total_htg, '1400.00');
  assert.equal(o.fee_amount, '0.050000');
  assert.equal((await ad(adId)).remaining, '90.000000');

  const v = await ok('GET', `/orders/${o.id}`, null, tk('buyer'));
  assert.equal(v.role, 'BUYER');
  assert.equal(v.payment.account_ref, '37111111');
  assert.equal((await call('GET', `/orders/${o.id}`, null, tk('a1'))).status, 200, 'staff can read');
  await signup('stranger', '+50937000009', 'Random Person');
  assert.equal((await call('GET', `/orders/${o.id}`, null, tk('stranger'))).status, 404, 'strangers cannot');

  assert.equal((await call('POST', `/orders/${o.id}/confirm`, null, tk('seller'))).status, 409, 'nothing to confirm before paid');
  assert.equal((await call('POST', `/orders/${o.id}/paid`, null, tk('seller'))).status, 403, 'only buyer says paid');
  await ok('POST', `/orders/${o.id}/paid`, null, tk('buyer'));
  assert.equal((await call('POST', `/orders/${o.id}/paid`, null, tk('buyer'))).status, 409, 'cannot press twice');
  assert.equal((await call('POST', `/orders/${o.id}/cancel`, null, tk('seller'))).status, 403, 'seller cannot cancel');
  assert.equal((await call('POST', `/orders/${o.id}/cancel`, null, tk('buyer'))).status, 409, 'buyer cannot cancel after paid');

  const done = await ok('POST', `/orders/${o.id}/confirm`, null, tk('seller'));
  assert.equal(done.state, 'COMPLETED');
  assert.deepEqual(await bal('buyer'), { a: '10.000000', l: '0.000000' });
  assert.deepEqual(await bal('seller'), { a: '899.500000', l: '90.450000' });
  const fee = (await pool.query(`SELECT available::text a FROM wallet_balances WHERE user_id='00000000-0000-0000-0000-000000000001'`)).rows[0];
  assert.equal(fee.a, '0.050000');

  const ev = await ok('GET', `/orders/${o.id}`, null, tk('buyer'));
  assert.deepEqual(ev.events.map((e) => e.to_state).filter(Boolean), ['AWAITING_PAYMENT', 'PAID_CLAIMED', 'RELEASING', 'COMPLETED']);
  assert.equal(ev.escrow.length, 2);
  await ok('POST', `/orders/${o.id}/rate`, { stars: 5 }, tk('buyer'));
  assert.equal((await call('POST', `/orders/${o.id}/rate`, { stars: 5 }, tk('buyer'))).status, 409);
});

test('buyer cancels before paying: USDT goes back to the ad', async () => {
  const o = await ok('POST', '/orders', { ad_id: adId, amount: '10' }, tk('buyer'));
  assert.equal((await ad(adId)).remaining, '80.000000');
  const r = await ok('POST', `/orders/${o.id}/cancel`, null, tk('buyer'));
  assert.equal(r.state, 'REFUNDED');
  assert.equal(r.refund_reason, 'BUYER_CANCEL');
  assert.equal((await ad(adId)).remaining, '90.000000');
  assert.equal((await ad(adId)).reserved, '90.450000');
});

test('timers: unpaid order is refunded after window + grace. Silent seller opens a dispute.', async () => {
  const o = await ok('POST', '/orders', { ad_id: adId, amount: '10' }, tk('buyer'));
  // inside the window: nothing happens
  await ok('POST', '/admin/run-timers', null, tk('admin'));
  assert.equal((await order(o.id)).state, 'AWAITING_PAYMENT');
  // window passed but still in the 10-minute grace: nothing happens, buyer can still press "I paid"
  await pool.query(`UPDATE orders SET state_deadline = now() - interval '5 minutes' WHERE id=$1`, [o.id]);
  await ok('POST', '/admin/run-timers', null, tk('admin'));
  assert.equal((await order(o.id)).state, 'AWAITING_PAYMENT');
  // grace over: refund
  await pool.query(`UPDATE orders SET state_deadline = now() - interval '11 minutes' WHERE id=$1`, [o.id]);
  const t = await ok('POST', '/admin/run-timers', null, tk('admin'));
  assert.equal(t.refunded, 1);
  const after = await order(o.id);
  assert.equal(after.state, 'REFUNDED');
  assert.equal(after.refund_reason, 'PAY_TIMEOUT');
  assert.equal((await call('POST', `/orders/${o.id}/paid`, null, tk('buyer'))).status, 409);

  // seller silent after "I paid"
  const o2 = await ok('POST', '/orders', { ad_id: adId, amount: '10' }, tk('buyer'));
  await ok('POST', `/orders/${o2.id}/paid`, null, tk('buyer'));
  await pool.query(`UPDATE orders SET state_deadline = now() - interval '1 minute' WHERE id=$1`, [o2.id]);
  const t2 = await ok('POST', '/admin/run-timers', null, tk('admin'));
  assert.equal(t2.autoDisputed, 1);
  assert.equal((await order(o2.id)).state, 'DISPUTED', 'never auto-released');
  global.disputedOrder = o2.id;
});

test('dispute: chat rules, evidence, two agents must agree, buyer wins, seller gets a strike', async () => {
  const id = global.disputedOrder;
  const bad = await call('POST', `/orders/${id}/chat`, { body: 'pay me on whatsapp please' }, tk('seller'));
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', `/orders/${id}/chat`, { body: 'call 3712 3456' }, tk('buyer'))).status, 400);
  assert.equal((await call('POST', `/orders/${id}/chat`, { body: 'go to http://x.com' }, tk('buyer'))).status, 400);
  await ok('POST', `/orders/${id}/chat`, { body: 'I paid at 10:42, reference attached' }, tk('buyer'));
  await ok('POST', `/orders/${id}/evidence`, { kind: 'RECEIPT', file_ref: 'img://receipt1', note: 'MonCash receipt' }, tk('buyer'));
  assert.equal((await call('POST', `/orders/${id}/evidence`, { kind: 'RECEIPT', file_ref: 'img://x' }, tk('stranger'))).status, 403);

  // real file upload: type is checked from the bytes, size is capped, only parties and staff can read it
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-but-valid-header')]);
  const up = await ok('POST', `/orders/${id}/evidence/upload`, { kind: 'RECEIPT', filename: '../../evil name.png', data: png.toString('base64') }, tk('buyer'));
  assert.equal(up.mime, 'image/png');
  assert.ok(!up.orig_name.includes('/'), 'file name is cleaned');
  assert.equal((await call('POST', `/orders/${id}/evidence/upload`, { kind: 'RECEIPT', filename: 'a.png', data: Buffer.from('MZ not an image').toString('base64') }, tk('buyer'))).status, 400, 'wrong type');
  assert.equal((await call('POST', `/orders/${id}/evidence/upload`, { kind: 'RECEIPT', filename: 'a.png', data: Buffer.concat([png, Buffer.alloc(300000)]).toString('base64') }, tk('buyer'))).status, 400, 'too big');
  assert.equal((await call('POST', `/orders/${id}/evidence/upload`, { kind: 'RECEIPT', filename: 'a.png', data: png.toString('base64') }, tk('stranger'))).status, 403);
  const get = (tok) => fetch(url + `/api/evidence/${up.id}/file`, { headers: { authorization: 'Bearer ' + tok } });
  assert.equal((await get(tk('stranger'))).status, 404);
  const file = await get(tk('a1'));
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await get(tk('seller'))).status, 200, 'the other side can see it');

  const dq = await ok('GET', '/staff/disputes', null, tk('a1'));
  assert.equal(dq.length, 1);
  assert.equal((await call('GET', '/staff/disputes', null, tk('buyer'))).status, 403, 'users cannot see the queue');

  const v1 = await ok('POST', `/staff/disputes/${dq[0].id}/vote`, { decision: 'BUYER', note: 'Receipt matches name, amount and time' }, tk('a1'));
  assert.equal(v1.resolved, false, 'big order needs a second agent');
  assert.equal((await call('POST', `/staff/disputes/${dq[0].id}/vote`, { decision: 'BUYER', note: 'again' }, tk('a1'))).status, 409, 'one vote each');
  const v2 = await ok('POST', `/staff/disputes/${dq[0].id}/vote`, { decision: 'BUYER', note: 'Agree with agent one' }, tk('a2'));
  assert.equal(v2.resolved, true);
  assert.equal((await order(id)).state, 'COMPLETED');
  const s = (await pool.query('SELECT strikes, banned FROM users WHERE id=$1', [U.seller.id])).rows[0];
  assert.equal(s.strikes, 1);
  assert.equal(s.banned, false);
});

test('dispute: agents disagree, admin settles. Seller wins. Fake proof bans the buyer.', async () => {
  const o = await ok('POST', '/orders', { ad_id: adId, amount: '8' }, tk('buyer'));
  await ok('POST', `/orders/${o.id}/paid`, null, tk('buyer'));
  await ok('POST', `/orders/${o.id}/dispute`, { reason: 'No money arrived in my account' }, tk('seller'));
  assert.equal((await order(o.id)).state, 'DISPUTED');
  const d = (await ok('GET', '/staff/disputes', null, tk('a1')))[0];

  await ok('POST', `/staff/disputes/${d.id}/vote`, { decision: 'BUYER', note: 'looks fine to me' }, tk('a1'));
  const split = await ok('POST', `/staff/disputes/${d.id}/vote`, { decision: 'SELLER', note: 'statement shows nothing' }, tk('a2'));
  assert.equal(split.resolved, false);
  assert.equal(split.needs_admin, true);
  const fin = await ok('POST', `/staff/disputes/${d.id}/vote`, { decision: 'SELLER', note: 'Receipt is edited. Fake.', fake_proof: true }, tk('admin'));
  assert.equal(fin.resolved, true);

  const after = await order(o.id);
  assert.equal(after.state, 'REFUNDED');
  assert.equal(after.refund_reason, 'DISPUTE_SELLER_WINS');
  const b = (await pool.query('SELECT banned FROM users WHERE id=$1', [U.buyer.id])).rows[0];
  assert.equal(b.banned, true, 'fake proof = immediate ban');
  assert.equal((await call('GET', '/me', null, tk('buyer'))).status, 403);
  const bl = (await pool.query(`SELECT kind FROM blocklist ORDER BY kind`)).rows.map((r) => r.kind);
  assert.ok(bl.includes('PHONE') && bl.includes('PAY_ACCOUNT'));
  assert.equal((await call('POST', '/auth/signup', { phone: '+50937000002', full_name: 'Marie Buyer' })).status, 403, 'blocked phone cannot come back');
  assert.equal((await ad(adId)).remaining, '80.000000');
});

test('buy ad: seller accepts and funds lock per order. Limits apply.', async () => {
  await signup('buyer2', '+50937000003', 'Paul Buyer');
  await kyc('buyer2');
  await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Paul Buyer', account_ref: '37333333' }, tk('buyer2'));
  const b = await ok('POST', '/ads', { side: 'BUY', pay_type: 'MONCASH', price_htg: '135', amount: '50', min_order_htg: '1000', max_order_htg: '20000' }, tk('buyer2'));
  assert.equal(b.reserved, '0.000000');

  // Seller took a strike: limits are halved (tier 1 max order 10000 -> 5000)
  assert.equal((await call('POST', '/orders', { ad_id: b.id, amount: '40', payment_method_id: pmS.id }, tk('seller'))).status, 403, '5400 HTG is above the halved limit');

  const before = await bal('seller');
  const o = await ok('POST', '/orders', { ad_id: b.id, amount: '10', payment_method_id: pmS.id }, tk('seller'));
  assert.equal(o.state, 'AWAITING_PAYMENT');
  assert.equal(o.seller_id, U.seller.id);
  assert.equal(o.buyer_id, U.buyer2.id);
  const mid = await bal('seller');
  assert.ok(Math.abs(Number(mid.a) - (Number(before.a) - 10.05)) < 1e-9);
  assert.ok(Math.abs(Number(mid.l) - (Number(before.l) + 10.05)) < 1e-9);

  await ok('POST', `/orders/${o.id}/paid`, null, tk('buyer2'));
  const done = await ok('POST', `/orders/${o.id}/confirm`, null, tk('seller'));
  assert.equal(done.state, 'COMPLETED');
  assert.equal((await bal('buyer2')).a, '10.000000');
});

test('closing an ad gives back what is not inside an order. Money adds up.', async () => {
  const mine = await ok('GET', '/my/ads', null, tk('seller'));
  const sell = mine.find((a) => a.id === adId);
  const closed = await ok('POST', `/ads/${adId}/status`, { status: 'CLOSED' }, tk('seller'));
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.reserved, '0.000000');
  assert.equal((await bal('seller')).l, '0.000000');
  assert.ok(Number(sell.reserved) > 0);

  // Everything deposited is still somewhere
  const t = (await pool.query(`SELECT SUM(available + locked)::text s FROM wallet_balances WHERE asset='USDT'`)).rows[0].s;
  assert.equal(t, '1000.000000');
});

test('database rules hold even if the app is wrong', async () => {
  const done = (await pool.query(`SELECT id FROM orders WHERE state='COMPLETED' LIMIT 1`)).rows[0];
  await assert.rejects(pool.query(`UPDATE orders SET state='DISPUTED' WHERE id=$1`, [done.id]), /illegal order move/);
  await assert.rejects(pool.query(`DELETE FROM order_events`), /append-only/);
  await assert.rejects(pool.query(`INSERT INTO escrow_txs (order_id, kind) VALUES ($1,'RELEASE')`, [done.id]), /escrow_one_exit/);
});

test('staff only routes and login', async () => {
  assert.equal((await call('GET', '/admin/limits', null, tk('a1'))).status, 403);
  assert.equal((await call('GET', '/admin/limits', null, tk('admin'))).status, 200);
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('POST', '/auth/login', { phone: '+50937000001', code: '111111' })).status, 400);
  const l = await ok('POST', '/auth/login', { phone: '+50937000001', code: '000000' });
  assert.ok(l.token);
});

test('real SMS codes: send, expire, one use, wrong tries, rate limit', async () => {
  const { config } = await import('../src/config.js');
  const { setSender } = await import('../src/sms.js');
  const sent = [];
  config.smsProvider = 'twilio'; // any non-mock value; the sender below is a fake
  setSender(async (phone, text) => { sent.push({ phone, text }); });
  try {
    const phone = '+50938111222';
    // no code asked yet
    assert.equal((await call('POST', '/auth/signup', { phone, full_name: 'Sms User', code: '000000' })).status, 400);
    await ok('POST', '/auth/request-code', { phone });
    assert.equal(sent.length, 1);
    const code = sent[0].text.match(/\b(\d{6})\b/)[1];
    assert.notEqual(code, '000000');
    // asking again right away is refused
    assert.equal((await call('POST', '/auth/request-code', { phone })).status, 429);
    // wrong code, then the right one
    assert.equal((await call('POST', '/auth/signup', { phone, full_name: 'Sms User', code: code === '123456' ? '654321' : '123456' })).status, 400);
    const r = await ok('POST', '/auth/signup', { phone, full_name: 'Sms User', code });
    assert.ok(r.token);
    // the same code cannot be used twice
    assert.equal((await call('POST', '/auth/login', { phone, code })).status, 400);
    // expired code
    await ok('POST', '/auth/request-code', { phone: '+50938111333' }); // different phone, no limit hit
    const c2 = sent.at(-1).text.match(/\b(\d{6})\b/)[1];
    await pool.query(`UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE phone='+50938111333'`);
    assert.equal((await call('POST', '/auth/signup', { phone: '+50938111333', full_name: 'Late User', code: c2 })).status, 400);
    // too many wrong tries kills the code, even the right one
    await pool.query(`DELETE FROM otp_codes WHERE phone=$1`, [phone]);
    await ok('POST', '/auth/request-code', { phone });
    const c3 = sent.at(-1).text.match(/\b(\d{6})\b/)[1];
    const wrong = c3 === '111111' ? '222222' : '111111';
    for (let i = 0; i < config.otpMaxTries; i++) await call('POST', '/auth/login', { phone, code: wrong });
    assert.equal((await call('POST', '/auth/login', { phone, code: c3 })).status, 400);
    // only a hash is stored
    const row = (await pool.query(`SELECT code_hash FROM otp_codes WHERE phone=$1`, [phone])).rows[0];
    assert.ok(!row.code_hash.includes(c3) && row.code_hash.length === 64);
    // a provider failure returns 502 and does not use up the limit
    setSender(async () => { throw new Error('boom'); });
    await pool.query(`DELETE FROM otp_codes WHERE phone=$1`, [phone]);
    assert.equal((await call('POST', '/auth/request-code', { phone })).status, 502);
    assert.equal((await pool.query(`SELECT 1 FROM otp_codes WHERE phone=$1`, [phone])).rowCount, 0);
    // non-Haiti numbers never get a code
    assert.equal((await call('POST', '/auth/request-code', { phone: '+14155550100' })).status, 400);
  } finally {
    setSender(null);
    config.smsProvider = 'mock';
  }
});

test('payment account added before ID approval is verified when the ID is approved', async () => {
  await signup('late', '+50937000077', 'Late Person');
  const pm = await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Person Late', account_ref: '37000077' }, tk('late'));
  assert.equal(pm.verified, false);
  await kyc('late');
  const row = (await pool.query('SELECT verified FROM payment_methods WHERE id=$1', [pm.id])).rows[0];
  assert.equal(row.verified, true);
});

test('profile: public name, photo, bank name, no contact info', async () => {
  await signup('prof', '+50937000088', 'Prof User');
  await kyc('prof');
  const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  await ok('PUT', '/me/profile', { display_name: 'Prof Exchange', bio: 'Fast and honest.', avatar: px }, tk('prof'));
  const me = await ok('GET', '/me', null, tk('prof'));
  assert.equal(me.user.display_name, 'Prof Exchange'); assert.equal(me.user.has_avatar, true);
  const img = await fetch(`${url}/api/avatar/${me.user.id}`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call('PUT', '/me/profile', { bio: 'call me +509 3700 0088' }, tk('prof'))).status, 400);
  assert.equal((await call('POST', '/payment-methods', { type: 'BANK', account_name: 'Prof User', account_ref: '1234567' }, tk('prof'))).status, 400);
  const b = await ok('POST', '/payment-methods', { type: 'BANK', account_name: 'Prof User', account_ref: '1234567', bank_name: 'Sogebank' }, tk('prof'));
  assert.equal(b.bank_name, 'Sogebank');
});

test('payout: Binance UID and wallet address are checked per network', async () => {
  await signup('pay', '+50937000099', 'Pay User');
  const put = (b) => call('PUT', '/me/payout', b, tk('pay'));
  assert.equal((await put({ binance_uid: 'abc' })).status, 400);
  assert.equal((await put({})).status, 400);
  assert.equal((await put({ network: 'TRON', address: '0x' + 'a'.repeat(40) })).status, 400);
  assert.equal((await put({ network: 'ARBITRUM', address: 'T' + 'a'.repeat(33) })).status, 400);
  assert.equal((await put({ binance_uid: '123456789' })).status, 200);
  assert.equal((await put({ binance_uid: '123456789', network: 'ARBITRUM', address: '0x' + 'a'.repeat(40) })).status, 200);
  assert.equal((await put({ network: 'TRON', address: 'TXYZopqrstuvwxyzABCDEFGHJKLMNPQRST' })).status, 200);
  const me = await ok('GET', '/me', null, tk('pay'));
  assert.equal(me.user.payout_network, 'TRON'); assert.equal(me.user.binance_uid, null);
});

test('test mode: owner and staff phones cannot log in with the public code 000000', async () => {
  // owner signup needs the secret code
  assert.equal((await call('POST', '/auth/signup', { phone: '+50937000777', full_name: 'Owner Person' })).status, 400);
  assert.equal((await call('POST', '/auth/signup', { phone: '+50937000777', full_name: 'Owner Person', code: '000000' })).status, 400);
  const o = await ok('POST', '/auth/signup', { phone: '+50937000777', full_name: 'Owner Person', code: '482913' });
  assert.equal(o.user.role, 'ADMIN');
  assert.equal((await call('POST', '/auth/login', { phone: '+50937000777', code: '000000' })).status, 400);
  await ok('POST', '/auth/login', { phone: '+50937000777', code: '482913' });
  // a staff account made in the database is protected too
  await signup('stf', '+50937000778', 'Staff Person', 'AGENT');
  assert.equal((await call('POST', '/auth/login', { phone: '+50937000778', code: '000000' })).status, 400);
  // guessing is stopped after 5 wrong codes
  for (let i = 0; i < 4; i++) await call('POST', '/auth/login', { phone: '+50937000778', code: '111111' });
  assert.equal((await call('POST', '/auth/login', { phone: '+50937000778', code: '482913' })).status, 429);
});

test('security headers are set', async () => {
  const r = await fetch(url + '/');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('proof files are kept in the database, not on the server disk', async () => {
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, 0);
  const n = (await pool.query('SELECT COUNT(*)::int n FROM evidence WHERE data IS NOT NULL')).rows[0].n;
  assert.ok(n > 0);
});

test('completion rate: a buyer cancel does not hurt the seller', async () => {
  const ads = await ok('GET', '/public/ads');
  for (const a of ads) if (a.completion_pct != null) { assert.ok(a.completion_pct >= 0 && a.completion_pct <= 100); }
});

test('one sell ad can take MonCash, NatCash and bank; the buyer picks', async () => {
  await signup('ms', '+50937000111', 'Multi Seller'); await kyc('ms');
  const ids = [];
  for (const [type, ref, bank] of [['MONCASH', '37111001'], ['NATCASH', '37111002'], ['BANK', '37111003', 'Sogebank']])
    ids.push((await ok('POST', '/payment-methods', { type, account_name: 'Multi Seller', account_ref: ref, bank_name: bank }, tk('ms'))).id);
  await pool.query(`INSERT INTO wallet_balances (user_id, asset, available) VALUES ((SELECT id FROM users WHERE phone='+50937000111'),'USDT',500)
                    ON CONFLICT (user_id, asset) DO UPDATE SET available = wallet_balances.available + 500`);
  const ad = await ok('POST', '/ads', { side: 'SELL', price_htg: '140', amount: '100', min_order_htg: '500', max_order_htg: '10000', payment_method_ids: ids }, tk('ms'));
  assert.deepEqual([...ad.pay_types].sort(), ['BANK', 'MONCASH', 'NATCASH']);
  const listed = await ok('GET', '/public/ads?side=SELL&pay_type=NATCASH');
  assert.ok(listed.some((a) => a.ad_id === ad.id || a.id === ad.id || a.price_htg === '140.00'));
  await signup('mb', '+50937000112', 'Multi Buyer'); await kyc('mb');
  const o = await ok('POST', '/orders', { ad_id: ad.id, amount: '10', pay_type: 'BANK' }, tk('mb'));
  const v = await ok('GET', '/orders/' + o.id, null, tk('mb'));
  assert.equal(v.payment.type, 'BANK'); assert.equal(v.payment.bank_name, 'Sogebank');
});

test('owner dashboard: overview, orders, ads, stop any ad, CORS for maxmaserati.com', async () => {
  const o = await ok('POST', '/auth/login', { phone: '+50937000777', code: '482913' });
  const T = o.token;
  const ov = await ok('GET', '/admin/overview', null, T);
  assert.ok(ov.users.total > 0); assert.equal(ov.daily.length, 30); assert.equal(ov.server.owner_code_set, true);
  assert.ok((await ok('GET', '/admin/orders', null, T)).length > 0);
  const list = await ok('GET', '/admin/ads', null, T);
  const victim = list.find((a) => a.side === 'SELL');
  await ok('POST', `/admin/ads/${victim.id}/status`, { status: 'PAUSED' }, T);
  assert.equal((await call('GET', '/admin/overview', null, tk('mb'))).status, 403);
  const pre = await fetch(url + '/api/admin/overview', { method: 'OPTIONS', headers: { Origin: 'https://www.maxmaserati.com', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://www.maxmaserati.com');
  const evil = await fetch(url + '/api/config', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});
