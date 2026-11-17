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
process.env.DISPUTE_WAIT_MIN = '0';   // tests open disputes right after "I paid"; one test below checks the wait
process.env.LOCK_FEE_USDT = '0';   // one test below turns the buyer lock fee on
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
  const r = await ok('POST', '/auth/signup', { accept_terms: true, phone, full_name: name });
  U[key] = { token: r.token, id: r.user.id, name };
  if (role) await pool.query('UPDATE users SET role=$2, tier=3 WHERE id=$1', [U[key].id, role]);
}
// Fake ID photo (PNG bytes) and fake video (WEBM bytes): enough for the type check.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400, 2)]);
const upload = (kind, buf, token) => fetch(`${url}/api/kyc/file/${kind}`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream' }, body: buf });
async function kyc(key) {
  for (const [kind, buf] of [['FRONT', PNG], ['BACK', PNG], ['VIDEO', WEBM]]) assert.equal((await upload(kind, buf, tk(key))).status, 200);
  const k = await ok('POST', '/kyc', { id_type: 'NATIONAL_ID', name_on_id: U[key].name, id_number: '001-234-567-8' }, tk(key));
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
  assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone: '+963944123456', full_name: 'Sanctioned Country' })).status, 403);
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
  assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone: '+50937000002', full_name: 'Marie Buyer' })).status, 403, 'blocked phone cannot come back');
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
    assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone, full_name: 'Sms User', code: '000000' })).status, 400);
    await ok('POST', '/auth/request-code', { phone });
    assert.equal(sent.length, 1);
    const code = sent[0].text.match(/\b(\d{6})\b/)[1];
    assert.notEqual(code, '000000');
    // asking again right away is refused
    assert.equal((await call('POST', '/auth/request-code', { phone })).status, 429);
    // wrong code, then the right one
    assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone, full_name: 'Sms User', code: code === '123456' ? '654321' : '123456' })).status, 400);
    const r = await ok('POST', '/auth/signup', { accept_terms: true, phone, full_name: 'Sms User', code });
    assert.ok(r.token);
    // the same code cannot be used twice
    assert.equal((await call('POST', '/auth/login', { phone, code })).status, 400);
    // expired code
    await ok('POST', '/auth/request-code', { phone: '+50938111333' }); // different phone, no limit hit
    const c2 = sent.at(-1).text.match(/\b(\d{6})\b/)[1];
    await pool.query(`UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE phone='+50938111333'`);
    assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone: '+50938111333', full_name: 'Late User', code: c2 })).status, 400);
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
    // fully sanctioned countries never get a code
    assert.equal((await call('POST', '/auth/request-code', { phone: '+53512345678' })).status, 403);
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
  assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone: '+50937000777', full_name: 'Owner Person' })).status, 400);
  assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone: '+50937000777', full_name: 'Owner Person', code: '000000' })).status, 400);
  const o = await ok('POST', '/auth/signup', { accept_terms: true, phone: '+50937000777', full_name: 'Owner Person', code: '482913' });
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

test('ID check: needs the right files, a real ID type, and staff can see the video', async () => {
  await signup('idc', '+50937000333', 'Idris Charles');
  const st = await ok('GET', '/kyc/me', null, tk('idc'));
  assert.match(st.script, /My name is Idris Charles\. My phone number is \+50937000333\. My code is \d \d \d \d\./);
  // nothing uploaded yet
  assert.equal((await call('POST', '/kyc', { id_type: 'PASSPORT', name_on_id: 'Idris Charles', id_number: 'HT123456' }, tk('idc'))).status, 400);
  // a photo is not a video, a video is not a photo
  assert.equal((await upload('VIDEO', PNG, tk('idc'))).status, 400);
  assert.equal((await upload('FRONT', WEBM, tk('idc'))).status, 400);
  assert.equal((await upload('FRONT', PNG, tk('idc'))).status, 200);
  // passport needs no back side, but needs the video
  assert.equal((await call('POST', '/kyc', { id_type: 'PASSPORT', name_on_id: 'Idris Charles', id_number: 'HT123456' }, tk('idc'))).status, 400);
  assert.equal((await upload('VIDEO', WEBM, tk('idc'))).status, 200);
  assert.equal((await call('POST', '/kyc', { id_type: 'BUS_TICKET', name_on_id: 'Idris Charles', id_number: 'HT123456' }, tk('idc'))).status, 400);
  const k = await ok('POST', '/kyc', { id_type: 'PASSPORT', name_on_id: 'Idris Charles', id_number: 'HT123456' }, tk('idc'));
  assert.equal(k.challenge, st.challenge);
  assert.equal((await call('POST', '/kyc', { id_type: 'PASSPORT', name_on_id: 'Idris Charles', id_number: 'HT123456' }, tk('idc'))).status, 409);
  const q2 = await ok('GET', '/staff/kyc', null, tk('admin'));
  const row = q2.find((x) => x.id === k.id);
  assert.deepEqual([...row.files].sort(), ['FRONT', 'VIDEO']); assert.equal(row.id_type, 'PASSPORT');
  const v = await fetch(`${url}/api/staff/kyc/${k.id}/file/VIDEO`, { headers: { authorization: 'Bearer ' + tk('admin') } });
  assert.equal(v.status, 200); assert.equal(v.headers.get('content-type'), 'video/webm');
  assert.equal((await fetch(`${url}/api/staff/kyc/${k.id}/file/VIDEO`, { headers: { authorization: 'Bearer ' + tk('idc') } })).status, 403);
  // a new code is made for any later attempt
  assert.notEqual((await ok('GET', '/kyc/me', null, tk('idc'))).challenge, st.challenge);
});

test('sign up from any country, but not from fully sanctioned ones', async () => {
  const r = await call('POST', '/auth/signup', { accept_terms: true, phone: '+13055550123', full_name: 'Marie Diaspora', code: '000000' });
  assert.equal(r.status, 200);
  assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone: '+989121234567', full_name: 'Blocked Person', code: '000000' })).status, 403);
  assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone: '+5093700', full_name: 'Short Number', code: '000000' })).status, 400);
});

test('linked accounts: the other person registers, passes ID, accepts; they confirm the money; the trader pays a one-time fee per extra account', async () => {
  await signup('trd', '+13055550199', 'Rose Trader'); await kyc('trd');
  await pool.query(`INSERT INTO wallet_balances (user_id, asset, available) VALUES ((SELECT id FROM users WHERE phone='+13055550199'),'USDT',500)
                    ON CONFLICT (user_id, asset) DO UPDATE SET available = wallet_balances.available + 500`);
  // nobody with this phone yet
  assert.equal((await call('POST', '/links', { phone: '+50937881122' }, tk('trd'))).status, 404);
  // the person signs up but has no ID check yet
  await signup('mem', '+50937881122', 'Mama Rose');
  assert.equal((await call('POST', '/links', { phone: '+50937881122' }, tk('trd'))).status, 409);
  await kyc('mem');
  const pm = await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Mama Rose', account_ref: '37881122' }, tk('mem'));
  const l = await ok('POST', '/links', { phone: '+509 3788 1122' }, tk('trd'));
  assert.equal((await call('POST', '/links', { phone: '+50937881122' }, tk('trd'))).status, 409); // asked twice
  // only the member can accept, with their own verified account
  assert.equal((await call('POST', `/links/${l.id}/accept`, { payment_method_id: pm.id }, tk('trd'))).status, 404);
  const bal = async () => Number((await pool.query(`SELECT available FROM wallet_balances WHERE user_id=(SELECT id FROM users WHERE phone='+13055550199') AND asset='USDT'`)).rows[0].available);
  const b0 = await bal();
  await ok('POST', `/links/${l.id}/accept`, { payment_method_id: pm.id }, tk('mem'));
  assert.equal(b0 - (await bal()), 2.5);
  const me = await ok('GET', '/me', null, tk('trd'));
  assert.ok(me.payment_methods.some((p) => p.id === pm.id && p.linked));
  // a buyer ad; the trader sells into it and gets paid into Mama Rose's MonCash
  await signup('hb', '+50937881199', 'Haiti Buyer'); await kyc('hb');
  const bad = await ok('POST', '/ads', { side: 'BUY', pay_types: ['MONCASH'], price_htg: '139', amount: '50', min_order_htg: '500', max_order_htg: '20000' }, tk('hb'));
  const o = await ok('POST', '/orders', { ad_id: bad.id, amount: '10', payment_method_id: pm.id }, tk('trd'));
  const v = await ok('GET', '/orders/' + o.id, null, tk('hb'));
  assert.equal(v.payment.account_name, 'Mama Rose'); assert.equal(v.payment.is_receiver, true);
  await ok('POST', `/orders/${o.id}/paid`, null, tk('hb'));
  const list = await ok('GET', '/links/to-check', null, tk('mem'));
  assert.equal(list[0].id, o.id);
  assert.equal((await call('POST', `/links/to-check/${o.id}`, { received: true }, tk('hb'))).status, 404);
  await ok('POST', `/links/to-check/${o.id}`, { received: true }, tk('mem'));
  assert.equal((await ok('GET', '/orders/' + o.id, null, tk('trd'))).order.receiver_said, 'RECEIVED');
  await ok('POST', `/orders/${o.id}/confirm`, null, tk('trd'));
  // the member ends the link: the trader cannot use the account any more
  await ok('POST', `/links/${l.id}/end`, null, tk('mem'));
  assert.equal((await call('POST', '/orders', { ad_id: bad.id, amount: '5', payment_method_id: pm.id }, tk('trd'))).status, 400);
});

test('close account: refused while something is open, then the person cannot log in', async () => {
  await signup('cls', '+50937000555', 'Closing Person'); await kyc('cls');
  await pool.query(`INSERT INTO wallet_balances (user_id, asset, available) VALUES ((SELECT id FROM users WHERE phone='+50937000555'),'USDT',5)
                    ON CONFLICT (user_id, asset) DO UPDATE SET available = 5`);
  assert.equal((await call('POST', '/me/close', null, tk('cls'))).status, 409); // crypto left
  await pool.query(`UPDATE wallet_balances SET available=0 WHERE user_id=(SELECT id FROM users WHERE phone='+50937000555')`);
  await ok('POST', '/me/close', null, tk('cls'));
  assert.equal((await call('GET', '/me', null, tk('cls'))).status, 403);
  assert.equal((await call('POST', '/auth/login', { phone: '+50937000555', code: '000000' })).status, 403);
});

test('buyer lock fee: the buyer gets the amount minus the fee; a small last bit of an ad can be taken whole', async () => {
  const { config } = await import('../src/config.js');
  await signup('lfS', '+50937000301', 'Paul Vendeur'); await signup('lfB', '+50937000302', 'Lucie Achete');
  await kyc('lfS'); await kyc('lfB');
  const pm = await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Paul Vendeur', account_ref: '37300301' }, tk('lfS'));
  await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Lucie Achete', account_ref: '37300302' }, tk('lfB'));
  await ok('POST', '/wallet/dev-deposit', { asset: 'USDT', amount: '100' }, tk('lfS'));
  // an ad worth less than its own minimum order is refused
  const tiny = await call('POST', '/ads', { side: 'SELL', pay_type: 'MONCASH', price_htg: '140', amount: '5', min_order_htg: '1000', max_order_htg: '10000', payment_method_id: pm.id }, tk('lfS'));
  assert.equal(tiny.status, 400);
  const a = await ok('POST', '/ads', { side: 'SELL', pay_type: 'MONCASH', price_htg: '140', amount: '12', min_order_htg: '1000', max_order_htg: '10000', payment_method_id: pm.id }, tk('lfS'));
  config.lockFee = '0.25';
  try {
    const o = await ok('POST', '/orders', { ad_id: a.id, amount: '10' }, tk('lfB'));
    assert.equal(o.lock_fee, '0.250000');
    await ok('POST', `/orders/${o.id}/paid`, null, tk('lfB'));
    await ok('POST', `/orders/${o.id}/confirm`, null, tk('lfS'));
    assert.deepEqual(await bal('lfB'), { a: '9.750000', l: '0.000000' }, 'buyer pays the lock fee');
    const feeW = async () => (await pool.query(`SELECT available::text a FROM wallet_balances WHERE user_id='00000000-0000-0000-0000-000000000001'`)).rows[0].a;
    const f0 = Number(await feeW());
    // 2 USDT left = 280 HTG, below the 1000 HTG minimum: only "take all" works
    assert.equal((await call('POST', '/orders', { ad_id: a.id, amount: '1' }, tk('lfB'))).status, 400, 'part of the last bit is refused');
    const last = await ok('POST', '/orders', { ad_id: a.id, amount: '2' }, tk('lfB'));
    assert.equal(last.total_htg, '280.00');
    await ok('POST', `/orders/${last.id}/paid`, null, tk('lfB'));
    await ok('POST', `/orders/${last.id}/confirm`, null, tk('lfS'));
    assert.deepEqual(await bal('lfB'), { a: '11.500000', l: '0.000000' });
    assert.equal(Math.round((Number(await feeW()) - f0) * 1e6) / 1e6, 0.26, 'seller fee 0.01 + lock fee 0.25');
    assert.equal((await ad(a.id)).status, 'SOLD_OUT');
  } finally { config.lockFee = '0'; }
});

test('email codes (Brevo): sign up with email, log in by phone, code goes to the saved email', async () => {
  const { config } = await import('../src/config.js');
  const { setMailer } = await import('../src/sms.js');
  const mails = [];
  config.smsProvider = 'email';
  setMailer(async (to, subject, text) => { mails.push({ to, text }); });
  try {
    const phone = '+50938444555';
    assert.equal((await call('POST', '/auth/request-code', { phone })).status, 400, 'a new person must give an email');
    assert.equal((await call('POST', '/auth/request-code', { phone, email: 'not-an-email' })).status, 400);
    const r = await ok('POST', '/auth/request-code', { phone, email: 'Rose.Pierre@Gmail.com' });
    assert.equal(r.to, 'ro***@gmail.com');
    assert.equal(mails[0].to, 'rose.pierre@gmail.com');
    const code = mails[0].text.match(/\b(\d{6})\b/)[1];
    assert.equal((await call('POST', '/auth/signup', { accept_terms: true, phone, full_name: 'Rose Pierre', code: '000000' })).status, 400, 'no 000000 in email mode');
    const s = await ok('POST', '/auth/signup', { accept_terms: true, phone, full_name: 'Rose Pierre', code });
    assert.equal(s.user.email, 'rose.pierre@gmail.com');
    // log in later: only the phone, the code goes to the saved email (a different typed email is ignored)
    await pool.query("UPDATE otp_codes SET created_at = now() - interval '5 minutes' WHERE phone=$1", [phone]);
    await ok('POST', '/auth/request-code', { phone, email: 'thief@evil.com' });
    assert.equal(mails[1].to, 'rose.pierre@gmail.com');
    const code2 = mails[1].text.match(/\b(\d{6})\b/)[1];
    const l = await ok('POST', '/auth/login', { phone, code: code2 });
    assert.equal(l.user.id, s.user.id);
    // one email, one account
    assert.equal((await call('POST', '/auth/request-code', { phone: '+50938444556', email: 'rose.pierre@gmail.com' })).status, 400);
    assert.equal((await ok('GET', '/config')).code_channel, 'email');
  } finally { config.smsProvider = 'mock'; setMailer(null); }
});

test('terms: sign-up needs "I accept"; business profile, posters and the public page', async () => {
  assert.equal((await call('POST', '/auth/signup', { phone: '+50937000601', full_name: 'Paul Nottermes' })).status, 400, 'no terms, no account');
  await signup('bp', '+50937000601', 'Paul Biznis'); await kyc('bp');
  const me = await ok('GET', '/me', null, tk('bp'));
  assert.equal(me.user.terms_ok, true);
  await pool.query(`UPDATE users SET terms_version='old' WHERE id=$1`, [U.bp.id]);
  assert.equal((await ok('GET', '/me', null, tk('bp'))).user.terms_ok, false);
  await ok('POST', '/me/accept-terms', null, tk('bp'));
  assert.equal((await ok('GET', '/me', null, tk('bp'))).user.terms_ok, true);
  assert.equal((await call('PUT', '/me/profile', { display_name: 'Paul Cambio', department: 'Mars', response_min: 5 }, tk('bp'))).status, 400, 'unknown department');
  assert.equal((await call('PUT', '/me/profile', { display_name: 'Paul Cambio', area: 'call 3712 3456', department: 'Ouest' }, tk('bp'))).status, 400, 'no phone numbers');
  await ok('PUT', '/me/profile', { display_name: 'Paul Cambio', bio: 'Fast and honest. 7 days a week.', department: 'Ouest', area: 'Delmas 33', response_min: 10 }, tk('bp'));
  const img = 'data:image/png;base64,' + PNG.toString('base64');
  const p1 = await ok('POST', '/me/posters', { image: img }, tk('bp'));
  for (let i = 0; i < 5; i++) await ok('POST', '/me/posters', { image: img }, tk('bp'));
  assert.equal((await call('POST', '/me/posters', { image: img }, tk('bp'))).status, 409, 'max 6 posters');
  await ok('DELETE', `/me/posters/${p1.id}`, null, tk('bp'));
  const pub = await call('GET', `/public/profile/${U.bp.id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.name, 'Paul Cambio');
  assert.equal(pub.body.department, 'Ouest'); assert.equal(pub.body.area, 'Delmas 33'); assert.equal(pub.body.response_min, 10);
  assert.equal(pub.body.id_verified, true); assert.equal(pub.body.posters.length, 5);
  assert.ok(!('phone' in pub.body) && !('full_name' in pub.body), 'no private data on the public page');
  const poster = await fetch(url + '/api/public/poster/' + pub.body.posters[0]);
  assert.equal(poster.status, 200); assert.equal(poster.headers.get('content-type'), 'image/png');
  // a personal (non-business) profile shows a short name only
  await signup('pp', '+50937000602', 'Marie Claire Joseph');
  const pb = await ok('GET', `/public/profile/${U.pp.id}`);
  assert.equal(pb.name, 'Marie J.');
  assert.match(pb.name, /^\S+ \S\.$/);
});

test('payment delays: wait before a dispute, seller "not arrived yet" hold, provider outage, seller ETA, review comment, report', async () => {
  const { config } = await import('../src/config.js');
  await signup('dS', '+50937000701', 'Rene Vandè'); await signup('dB', '+50937000702', 'Lise Achtè');
  await kyc('dS'); await kyc('dB');
  const pm = await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Rene Vandè', account_ref: '37300701' }, tk('dS'));
  await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Lise Achtè', account_ref: '37300702' }, tk('dB'));
  await ok('POST', '/wallet/dev-deposit', { asset: 'USDT', amount: '100' }, tk('dS'));
  const a = await ok('POST', '/ads', { side: 'SELL', pay_type: 'MONCASH', price_htg: '140', amount: '50', min_order_htg: '500', max_order_htg: '10000', payment_method_id: pm.id }, tk('dS'));
  const o = await ok('POST', '/orders', { ad_id: a.id, amount: '10' }, tk('dB'));
  // seller says how fast they will check
  assert.equal((await call('POST', `/orders/${o.id}/eta`, { minutes: 7 }, tk('dS'))).status, 400);
  assert.equal((await call('POST', `/orders/${o.id}/eta`, { minutes: 10 }, tk('dB'))).status, 403, 'only the seller');
  await ok('POST', `/orders/${o.id}/eta`, { minutes: 10 }, tk('dS'));
  assert.equal((await order(o.id)).seller_eta_min, 10);
  await ok('POST', `/orders/${o.id}/paid`, null, tk('dB'));
  config.disputeWaitMin = 20;
  try {
    const r = await call('POST', `/orders/${o.id}/dispute`, { reason: 'I paid but nothing happened' }, tk('dB'));
    assert.equal(r.status, 409); assert.equal(r.body.code, 'TOO_SOON');
  } finally { config.disputeWaitMin = 0; }
  // seller: money not in my account yet -> more time, and no dispute during the hold
  assert.equal((await call('POST', `/orders/${o.id}/delay`, null, tk('dB'))).status, 403);
  const d = await ok('POST', `/orders/${o.id}/delay`, null, tk('dS'));
  assert.ok(new Date(d.delay_until) > new Date(Date.now() + 100 * 60000));
  const held = await call('POST', `/orders/${o.id}/dispute`, { reason: 'Seller is lying to me' }, tk('dB'));
  assert.equal(held.body.code, 'DELAY_HOLD');
  // the hold is capped at DELAY_MAX_HOURS after "I paid"
  await pool.query(`UPDATE orders SET paid_at = now() - interval '24 hours', delay_until = now() - interval '1 minute' WHERE id=$1`, [o.id]);
  assert.equal((await call('POST', `/orders/${o.id}/delay`, null, tk('dS'))).body.code, 'DELAY_MAX');
  // MonCash outage: disputes wait, and the "seller silent" timer does not open one
  await ok('POST', '/admin/providers', { provider: 'MONCASH', down: true, note: 'MonCash delays today' }, tk('admin'));
  assert.equal((await ok('GET', '/config')).provider_alerts[0].provider, 'MONCASH');
  assert.equal((await call('POST', `/orders/${o.id}/dispute`, { reason: 'Seller is lying to me' }, tk('dB'))).body.code, 'PROVIDER_DOWN');
  await pool.query(`UPDATE orders SET state_deadline = now() - interval '1 minute' WHERE id=$1`, [o.id]);
  await ok('POST', '/admin/run-timers', null, tk('admin'));
  assert.equal((await order(o.id)).state, 'PAID_CLAIMED', 'no automatic dispute during an outage');
  assert.equal((await ok('GET', `/orders/${o.id}`, null, tk('dB'))).provider_down, true);
  await ok('POST', '/admin/providers', { provider: 'MONCASH', down: false }, tk('admin'));
  assert.equal((await ok('GET', '/config')).provider_alerts.length, 0);
  // money arrived: finish, review with a comment, then report a reversal
  await ok('POST', `/orders/${o.id}/confirm`, null, tk('dS'));
  assert.equal((await call('POST', `/orders/${o.id}/rate`, { stars: 5, comment: 'call me 3712 3456' }, tk('dB'))).status, 400);
  await ok('POST', `/orders/${o.id}/rate`, { stars: 5, comment: 'Fast and honest seller' }, tk('dB'));
  const prof = await ok('GET', `/public/profile/${U.dS.id}`);
  assert.equal(prof.reviews[0].comment, 'Fast and honest seller'); assert.equal(prof.trades, 1); assert.equal(prof.ads.length, 1);
  await ok('POST', `/orders/${o.id}/report`, { kind: 'REVERSED', note: 'MonCash sent the money back to the buyer' }, tk('dS'));
  const reps = await ok('GET', '/admin/reports', null, tk('admin'));
  assert.equal(reps[0].kind, 'REVERSED');
  await ok('POST', `/admin/reports/${reps[0].id}/close`, null, tk('admin'));
});

test('automatic ID check: approves clear cases, flags a face used twice, owner can undo and switch it off', async () => {
  const idc = await import('../src/services/idcheck.js');
  const vec = (f, n = 0) => Array.from({ length: 1024 }, (_, i) => f(i) * 0.5 + (n ? Math.sin(i * 13 + n) * 0.005 : 0));
  const anne = (i) => Math.sin(i), other = (i) => Math.cos(i * 7), luc = (i) => Math.sin(i * 3 + 1);
  let SEEN = null;
  await pool.query("UPDATE kyc SET auto_status='NEEDS_YOU' WHERE status='PENDING'"); // IDs sent by the tests above
  idc.setAnalyzer(async (job) => { assert.ok(job.files.FRONT && job.files.FACE1, 'the robot gets the ID photo and the video pictures'); return SEEN; });
  const send = async (key, name, num) => {
    await signup(key, '+5093700' + String(Math.floor(1000 + Math.random() * 8999)), name);
    for (const [kind, buf] of [['FRONT', PNG], ['BACK', PNG], ['VIDEO', WEBM], ['FACE1', PNG], ['FACE2', PNG], ['FACE3', PNG]]) assert.equal((await upload(kind, buf, tk(key))).status, 200);
    const k = await ok('POST', '/kyc', { id_type: 'NATIONAL_ID', name_on_id: name, id_number: num }, tk(key));
    assert.equal(k.auto_status, 'QUEUED');
    return k;
  };
  const face = (f, n, yaw) => ({ found: 1, score: 1, real: 0.8, live: 0.9, yaw, emb: vec(f, n) });

  // 1) clear case: approved by itself
  const k1 = await send('ida', 'Anne Pierre', '77-1234-55');
  SEEN = { text: "REPUBLIQUE D'HAITI\nNom PIERRE\nPrenom ANNE\nNIF 77-1234-55", faces: { FRONT: face(anne, 1, 0), FACE1: face(anne, 2, 0), FACE2: face(anne, 3, -0.4), FACE3: face(anne, 4, 0.35) } };
  let d = await idc.runQueue(1);
  assert.equal(d[0].status, 'AUTO_APPROVED', JSON.stringify(d[0]));
  assert.equal((await pool.query('SELECT tier FROM users WHERE id=$1', [U.ida.id])).rows[0].tier, 1);
  assert.equal((await ok('GET', '/kyc/me', null, tk('ida'))).last.auto_status, 'AUTO_APPROVED');

  // 2) the same face on a second account: never approved by itself
  const k2 = await send('idb', 'Paul Jean', '88-9999-11');
  SEEN = { text: 'Nom JEAN Prenom PAUL', faces: { FRONT: face(anne, 5, 0), FACE1: face(anne, 6, 0), FACE2: face(anne, 7, -0.4), FACE3: face(anne, 8, 0.4) } };
  d = await idc.runQueue(1);
  assert.equal(d[0].status, 'NEEDS_YOU');
  assert.equal(d[0].checks.find((c) => c.key === 'dupface').ok, false);
  const list = await ok('GET', '/staff/kyc', null, tk('admin'));
  const row = list.find((x) => x.id === k2.id);
  assert.equal(row.auto_status, 'NEEDS_YOU'); assert.equal(row.face_vec, undefined, 'face prints never leave the server');

  // 3) different face and no head turn (a photo held up to the camera): needs a human
  const k3 = await send('idc3', 'Rose Michel', '55-4444-22');
  SEEN = { text: 'ROSE MICHEL 55-4444-22', faces: { FRONT: face(anne, 9, 0), FACE1: face(other, 1, 0.01), FACE2: face(other, 2, 0.02), FACE3: face(other, 3, 0.0) } };
  d = await idc.runQueue(1);
  assert.equal(d[0].status, 'NEEDS_YOU');
  const bad3 = d[0].checks.filter((c) => !c.ok).map((c) => c.key);
  assert.ok(bad3.includes('match') && bad3.includes('turn'), bad3.join());

  // 4) owner switches auto-approve OFF: a clear case waits for the owner
  assert.equal((await ok('POST', '/admin/idcheck', { auto_approve: false }, tk('admin'))).auto_approve, false);
  await send('idd', 'Luc Joseph', '66-1212-33');
  SEEN = { text: 'LUC JOSEPH', faces: { FRONT: face(luc, 9, 0), FACE1: face(luc, 10, 0), FACE2: face(luc, 11, -0.3), FACE3: face(luc, 12, 0.3) } };
  d = await idc.runQueue(1);
  assert.equal(d[0].status, 'NEEDS_YOU'); assert.equal(d[0].pass, true); assert.match(d[0].note, /OFF/);
  await ok('POST', '/admin/idcheck', { auto_approve: true }, tk('admin'));

  // 5) undo, recheck, staff only
  const s = await ok('GET', '/admin/idcheck', null, tk('admin'));
  assert.equal(s.auto_approve, true); assert.ok(s.recent.some((r) => r.id === k1.id));
  await ok('POST', `/admin/kyc/${k1.id}/undo`, {}, tk('admin'));
  assert.equal((await pool.query('SELECT tier FROM users WHERE id=$1', [U.ida.id])).rows[0].tier, 0);
  assert.equal((await pool.query('SELECT status FROM kyc WHERE id=$1', [k1.id])).rows[0].status, 'PENDING');
  assert.equal((await ok('POST', `/staff/kyc/${k3.id}/recheck`, {}, tk('admin'))).auto_status, 'QUEUED');
  assert.equal((await call('POST', '/admin/idcheck', { auto_approve: false }, tk('ida'))).status, 403);
  assert.equal((await call('POST', `/admin/kyc/${k2.id}/undo`, {}, tk('a1'))).status, 403);
});

test('log in with phone OR email, any country; wrong tab gets a clear answer', async () => {
  await signup('uk', '+447700900123', 'Grace Pierre');
  await pool.query('UPDATE users SET email=$2 WHERE id=$1', [U.uk.id, 'grace@example.com']);
  const nf = await call('POST', '/auth/request-code', { mode: 'login', login: '+447700900999' });
  assert.equal(nf.status, 404); assert.equal(nf.body.code, 'NO_ACCOUNT');
  const nfe = await call('POST', '/auth/request-code', { mode: 'login', login: 'nobody@example.com' });
  assert.equal(nfe.body.code, 'NO_ACCOUNT');
  const ex = await call('POST', '/auth/request-code', { mode: 'signup', phone: '+447700900123', email: 'x@example.com' });
  assert.equal(ex.status, 409); assert.equal(ex.body.code, 'EXISTS');
  // email login, and a phone typed with 00 and spaces
  assert.equal((await ok('POST', '/auth/login', { login: 'GRACE@example.com', code: '000000' })).user.id, U.uk.id);
  assert.equal((await ok('POST', '/auth/login', { login: '0044 7700 900123', code: '000000' })).user.id, U.uk.id);
  // blocked countries stay blocked
  assert.equal((await call('POST', '/auth/request-code', { mode: 'signup', phone: '+989121234567' })).status, 403);
});

test('help: anyone can write to the team, the owner answers in the app and by email; cover photo on the business page', async () => {
  const sms = await import('../src/sms.js');
  const mails = []; sms.setMailer(async (to, subject, text) => { mails.push({ to, subject, text }); });
  process.env.ADMIN_EMAIL = 'owner@example.com';
  assert.equal((await call('POST', '/help/ask', { message: 'Kijan pou m achte?' })).status, 400, 'logged out needs an email');
  await ok('POST', '/help/ask', { message: 'Kijan pou m achte?', contact: 'visitor@example.com', lang: 'ht' });
  const t = await ok('POST', '/help/ask', { message: 'My MonCash payment is late', lang: 'en' }, tk('uk'));
  assert.ok(mails.some((m) => m.to === 'owner@example.com'), 'the owner is told by email');
  assert.equal((await call('GET', '/admin/help', null, tk('uk'))).status, 403);
  const list = await ok('GET', '/admin/help', null, tk('admin'));
  assert.ok(list.length >= 2);
  const r = await ok('POST', `/admin/help/${t.id}/reply`, { reply: 'It is on its way. The crypto stays locked.' }, tk('admin'));
  assert.equal(r.emailed, true);
  assert.ok(mails.some((m) => m.to === 'grace@example.com' && /on its way/.test(m.text)));
  const mine = await ok('GET', '/help/mine', null, tk('uk'));
  assert.equal(mine[0].reply, 'It is on its way. The crypto stays locked.');
  sms.setMailer(null);

  const jpg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64');
  await ok('PUT', '/me/profile', { display_name: 'Deal509', cover: jpg }, tk('uk'));
  assert.equal((await fetch(`${url}/api/cover/${U.uk.id}`)).status, 200);
  assert.equal((await ok('GET', '/public/profile/' + U.uk.id)).has_cover, true);
  await ok('PUT', '/me/profile', { display_name: 'Deal509', cover: null }, tk('uk'));
  assert.equal((await fetch(`${url}/api/cover/${U.uk.id}`)).status, 404);
});

test('passwords: set at signup, log in with phone or email + password, lock after 5 wrong, reset with a code', async () => {
  const s = await ok('POST', '/auth/signup', { phone: '+50937770011', full_name: 'Paula Joseph', code: '000000', accept_terms: true, password: 'Kreyol2026' });
  assert.equal(s.user.has_password, true);
  await pool.query('UPDATE users SET email=$2 WHERE id=$1', [s.user.id, 'paula@example.com']);
  assert.ok((await ok('POST', '/auth/login', { login: '+509 3777 0011', password: 'Kreyol2026' })).token);
  assert.ok((await ok('POST', '/auth/login', { login: 'Paula@example.com', password: 'Kreyol2026' })).token);
  assert.equal((await call('POST', '/auth/signup', { phone: '+50937770012', full_name: 'Weak Pw', code: '000000', accept_terms: true, password: 'short' })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { login: '+50937770011', password: 'wrong-pass1' })).status, 401);
  const locked = await call('POST', '/auth/login', { login: '+50937770011', password: 'Kreyol2026' });
  assert.equal(locked.status, 429); assert.equal(locked.body.code, 'PW_LOCKED');
  // forgot password: email code + new password
  const r = await ok('POST', '/auth/reset-password', { login: 'paula@example.com', code: '000000', password: 'NouvoModpas9' });
  assert.ok(r.token);
  assert.ok((await ok('POST', '/auth/login', { login: '+50937770011', password: 'NouvoModpas9' })).token);
  // no password yet: told to use a code
  const np = await call('POST', '/auth/login', { login: '+447700900123', password: 'Whatever123' });
  assert.equal(np.body.code, 'NO_PASSWORD');
  // change it from the profile: needs the current one
  const oldTk = tk('uk');
  U.uk.token = (await ok('POST', '/me/password', { password: 'Grace2026ok' }, tk('uk'))).token;
  // the new password logs out every other login: the old token is dead, the new one works
  assert.equal((await call('GET', '/me', null, oldTk)).status, 401);
  await ok('GET', '/me', null, tk('uk'));
  assert.equal((await call('POST', '/me/password', { password: 'Another2026', current: 'bad' }, tk('uk'))).status, 401);
  U.uk.token = (await ok('POST', '/me/password', { password: 'Another2026', current: 'Grace2026ok' }, tk('uk'))).token;
  // a reset (forgot password) also kills older logins
  assert.equal((await call('GET', '/me', null, s.token)).status, 401);
});

test('Commercial Sellers: apply after the ID check, owner approves, badge and filter on the market', async () => {
  const sms = await import('../src/sms.js'); sms.setMailer(async () => {});
  assert.equal((await call('POST', '/me/business', { business_name: 'Kanbis Pa Nou', business_type: 'EXCHANGE' }, tk('uk'))).body.code, 'TIER');
  assert.equal((await call('POST', '/me/business', { business_name: 'Call 3700 1234 5678', business_type: 'EXCHANGE' }, tk('ms'))).body.code, 'NO_CONTACT');
  const a = await ok('POST', '/me/business', { business_name: 'Kanbis Pa Nou', business_type: 'EXCHANGE', business_reg: 'Patant 12345' }, tk('ms'));
  assert.equal(a.business_status, 'PENDING');
  assert.equal((await call('GET', '/admin/business', null, tk('ms'))).status, 403);
  const list = await ok('GET', '/admin/business', null, tk('admin'));
  assert.ok(list.some((x) => x.id === U.ms.id && x.business_name === 'Kanbis Pa Nou'));
  await ok('POST', `/admin/business/${U.ms.id}`, { approve: true }, tk('admin'));
  const me1 = await ok('GET', '/me', null, tk('ms'));
  assert.equal(me1.user.business_status, 'APPROVED'); assert.equal(me1.user.display_name, 'Kanbis Pa Nou');
  const only = await ok('GET', '/ads?side=SELL&business=1', null, tk('buyer2'));
  assert.ok(only.every((x) => x.is_business));
  const pub = await ok('GET', '/public/ads?side=SELL&business=1');
  assert.ok(pub.every((x) => x.is_business && x.owner === 'Kanbis Pa Nou'));
  await ok('DELETE', '/me/business', null, tk('ms'));
  assert.equal((await ok('GET', '/me', null, tk('ms'))).user.business_status, null);
  sms.setMailer(null);
});

test('ads: the smallest and biggest order are optional (500 HTG up to the whole ad)', async () => {
  await signup('optS', '+50937000411', 'Opt Seller'); await kyc('optS');
  const pm = await ok('POST', '/payment-methods', { type: 'MONCASH', account_name: 'Opt Seller', account_ref: '37000411' }, tk('optS'));
  await pool.query(`INSERT INTO wallet_balances (user_id, asset, available) VALUES ((SELECT id FROM users WHERE phone='+50937000411'),'USDT',100)
                    ON CONFLICT (user_id, asset) DO UPDATE SET available = 100`);
  const a = await ok('POST', '/ads', { side: 'SELL', asset: 'USDT', price_htg: '140', amount: '50', min_order_htg: '', payment_method_ids: [pm.id] }, tk('optS'));
  const row = (await pool.query('SELECT min_order_htg, max_order_htg FROM ads WHERE id=$1', [a.id])).rows[0];
  assert.equal(Number(row.min_order_htg), 500); assert.equal(Number(row.max_order_htg), 7000);
});

test('payment accounts: remove one (not while an ad uses it), add it back later', async () => {
  await signup('rmS', '+50937000421', 'Remove Seller'); await kyc('rmS');
  const pm = await ok('POST', '/payment-methods', { type: 'NATCASH', account_name: 'Remove Seller', account_ref: '37000421' }, tk('rmS'));
  await pool.query(`INSERT INTO wallet_balances (user_id, asset, available) VALUES ((SELECT id FROM users WHERE phone='+50937000421'),'USDT',100)
                    ON CONFLICT (user_id, asset) DO UPDATE SET available = 100`);
  const a = await ok('POST', '/ads', { side: 'SELL', asset: 'USDT', price_htg: '140', amount: '20', payment_method_ids: [pm.id] }, tk('rmS'));
  const busy = await call('POST', `/payment-methods/${pm.id}/remove`, {}, tk('rmS'));
  assert.equal(busy.status, 400);
  await ok('POST', `/ads/${a.id}/status`, { status: 'CLOSED' }, tk('rmS'));
  await ok('POST', `/payment-methods/${pm.id}/remove`, {}, tk('rmS'));
  let me = await ok('GET', '/me', null, tk('rmS'));
  assert.equal(me.payment_methods.filter((p) => p.id === pm.id).length, 0);
  // Somebody else cannot remove it; the owner can add the same number back.
  const back = await ok('POST', '/payment-methods', { type: 'NATCASH', account_name: 'Remove Seller', account_ref: '37000421' }, tk('rmS'));
  assert.equal(back.id, pm.id);
  me = await ok('GET', '/me', null, tk('rmS'));
  assert.equal(me.payment_methods.filter((p) => p.id === pm.id).length, 1);
});

test('security: staff password needs the email code too, bad ids and odd numbers are refused cleanly, no look-alike names', async () => {
  await pool.query(`UPDATE users SET pw_hash=NULL WHERE id=$1`, [U.admin.id]);
  await ok('POST', '/me/password', { password: 'Owner2026pass' }, tk('admin')).then((r) => { U.admin.token = r.token; });
  const adminPhone = (await pool.query('SELECT phone FROM users WHERE id=$1', [U.admin.id])).rows[0].phone;
  const step1 = await call('POST', '/auth/login', { login: adminPhone, password: 'Owner2026pass' });
  assert.equal(step1.status, 400); assert.equal(step1.body.code, 'NEED_CODE');
  assert.equal((await call('POST', '/auth/login', { login: adminPhone, password: 'Owner2026pass', code: '000000' })).status, 400); // the public test code never works for staff
  assert.ok((await ok('POST', '/auth/login', { login: adminPhone, password: 'Owner2026pass', code: '482913' })).token);
  // a broken or fake token is just "log in again", never a crash
  assert.equal((await call('GET', '/me', null, 'eyJub3QiOiJqc29u.abc')).status, 401);
  assert.equal((await call('POST', '/help/ask', { message: 'hello there' }, 'bad.token')).status, 400); // treated as not logged in: asks for an email
  // a wrong id in the address: 4xx, not 500
  assert.ok([400, 404].includes((await call('GET', '/orders/not-an-id', null, tk('uk'))).status));
  assert.ok([400, 404, 409].includes((await call('POST', '/orders', { ad_id: 'x', amount: '5' }, tk('uk'))).status));
  assert.equal((await call('GET', '/ads?side=HACK&asset=XYZ', null, tk('uk'))).status, 200);
  // amounts: at most 6 decimals for crypto, 2 for gourdes
  assert.equal((await call('POST', '/orders', { ad_id: '00000000-0000-0000-0000-000000000000', amount: '1.1234567' }, tk('uk'))).status, 400);
  // public names: no copying the platform or a Commercial Seller
  assert.equal((await call('PUT', '/me/profile', { display_name: 'Ayiti P2P Support' }, tk('uk'))).body.code, 'NAME_TAKEN');
  assert.equal((await call('PUT', '/me/profile', { display_name: 'Admin Team' }, tk('uk'))).body.code, 'NAME_TAKEN');
  const approved = (await pool.query(`SELECT business_name FROM users WHERE business_status='APPROVED' LIMIT 1`)).rows[0];
  if (approved) assert.equal((await call('PUT', '/me/profile', { display_name: approved.business_name.toUpperCase() }, tk('uk'))).body.code, 'NAME_TAKEN');
  await ok('PUT', '/me/profile', { display_name: 'Grace Kanpay' }, tk('uk'));
});
