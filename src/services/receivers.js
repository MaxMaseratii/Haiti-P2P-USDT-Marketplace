// Family receivers: send money to family in Haiti.
// A user (for example in the US) sells USDT here, and the buyer pays the gourdes straight into the
// MonCash, NatCash or bank account of a family member. The family member gets an SMS link to say
// "I received it". Then the sender releases the USDT. The first receiver is free; extra ones cost
// RECEIVER_FEE_USDT every 30 days, taken from the sender's wallet.
import crypto from 'node:crypto';
import { tx, q } from '../db.js';
import { bad, forbidden, notFound, conflict } from '../errors.js';
import { config, isMock, isMockSms } from '../config.js';
import * as wallet from './wallet.js';
import { sendSms } from '../sms.js';

const TYPES = ['MONCASH', 'NATCASH', 'BANK'];
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export async function list(user) {
  return (await q(`SELECT id, type, account_name, account_ref, bank_name, receiver_phone, paid_until, active, created_at
                   FROM payment_methods WHERE user_id=$1 AND is_receiver ORDER BY created_at`, [user.id])).rows;
}

async function charge(c, userId, fee) {
  const bal = await wallet.available(c, userId, 'USDT');
  if (Number(bal) < Number(fee)) throw bad(`An extra receiver costs ${fee} USDT a month. Add USDT to your wallet first.`, 'FEE');
  await wallet.debit(c, userId, 'USDT', fee);
  await wallet.credit(c, config.platformUserId, 'USDT', fee);
}

export async function add(user, { full_name, phone, type, account_ref, bank_name }) {
  if (user.tier < 1) throw forbidden('Finish your ID check first.');
  full_name = String(full_name || '').trim(); account_ref = String(account_ref || '').replace(/\s/g, ''); phone = String(phone || '').replace(/[\s()\-.]/g, '');
  if (full_name.length < 3 || full_name.length > 60) throw bad('Write the full name of your family member, as on their account.');
  if (!/^\+509\d{8}$/.test(phone)) throw bad('Their phone must be a Haiti number: +509 and 8 digits. They get an SMS to confirm.');
  if (!TYPES.includes(type)) throw bad('Pick MonCash, NatCash or bank.');
  if (account_ref.length < 6 || account_ref.length > 30) throw bad('Write their account number.');
  bank_name = type === 'BANK' ? String(bank_name || '').trim() : null;
  if (type === 'BANK' && !bank_name) throw bad('Say which bank.');
  return tx(async (c) => {
    if ((await c.query('SELECT 1 FROM payment_methods WHERE user_id=$1 AND is_receiver AND active AND type=$2 AND account_ref=$3', [user.id, type, account_ref])).rowCount)
      throw conflict('You already added this account.');
    const n = (await c.query('SELECT COUNT(*)::int n FROM payment_methods WHERE user_id=$1 AND is_receiver AND active', [user.id])).rows[0].n;
    let paidUntil = null;
    if (n >= 1) {
      if (!isMock()) throw conflict('Extra receivers are not open yet with real money. You can use one receiver for now.');
      await charge(c, user.id, config.receiverFeeUsdt);
      paidUntil = new Date(Date.now() + 30 * 86400000);
    }
    return (await c.query(`INSERT INTO payment_methods (user_id, type, account_name, account_ref, bank_name, verified, is_receiver, receiver_phone, paid_until)
                           VALUES ($1,$2,$3,$4,$5,true,true,$6,$7) RETURNING *`, [user.id, type, full_name, account_ref, bank_name, phone, paidUntil])).rows[0];
  });
}

export async function remove(user, id) {
  const r = await q('UPDATE payment_methods SET active=false WHERE id=$1 AND user_id=$2 AND is_receiver RETURNING id', [id, user.id]);
  if (!r.rowCount) throw notFound();
  return { ok: true };
}

// Called by the timers: renew paid receivers, pause the ones that cannot be paid.
export async function renew() {
  let renewed = 0, paused = 0;
  for (const r of (await q(`SELECT id, user_id FROM payment_methods WHERE is_receiver AND active AND paid_until IS NOT NULL AND paid_until < now()`)).rows) {
    try {
      await tx(async (c) => { await charge(c, r.user_id, config.receiverFeeUsdt); await c.query(`UPDATE payment_methods SET paid_until = now() + interval '30 days' WHERE id=$1`, [r.id]); });
      renewed++;
    } catch { await q('UPDATE payment_methods SET active=false WHERE id=$1', [r.id]); paused++; }
  }
  return { renewed, paused };
}

// The buyer says "I paid" to a family receiver: send them an SMS link to confirm.
export async function notifyReceiver(order) {
  const pm = (await q('SELECT * FROM payment_methods WHERE id=$1', [order.payment_method_id])).rows[0];
  if (!pm || !pm.is_receiver || !pm.receiver_phone) return null;
  const t = crypto.randomBytes(18).toString('base64url');
  await q('UPDATE orders SET receiver_token_hash=$2, receiver_said=NULL, receiver_at=NULL WHERE id=$1', [order.id, hash(t)]);
  const sender = (await q('SELECT COALESCE(display_name, full_name) n FROM users WHERE id=$1', [order.seller_id])).rows[0].n;
  const link = `${config.publicUrl || ''}/#receive/${t}`;
  const htg = Number(order.total_htg).toLocaleString('en-US', { maximumFractionDigits: 2 });
  await q(`INSERT INTO chat_messages (order_id, sender_id, body) VALUES ($1,NULL,$2)`,
    [order.id, `We sent an SMS to ${pm.account_name} (the family receiver) to confirm the ${htg} HTG arrived.` + (isMockSms() ? ` TEST MODE, no real SMS. The family's link is: ${link}` : '')]);
  try { await sendSms(pm.receiver_phone, `Haiti P2P: ${sender} sent you ${htg} HTG by ${pm.type === 'BANK' ? pm.bank_name : pm.type}. When you see it, confirm here: ${link}`); }
  catch (e) { console.error('receiver sms failed', e.message); }
  return t; // returned for tests and test mode only
}

async function byToken(t) {
  const o = (await q(`SELECT o.*, pm.account_name, pm.type AS pay_type, pm.bank_name, pm.account_ref, COALESCE(s.display_name, s.full_name) AS sender
                      FROM orders o JOIN payment_methods pm ON pm.id=o.payment_method_id JOIN users s ON s.id=o.seller_id
                      WHERE o.receiver_token_hash=$1`, [hash(t)])).rows[0];
  if (!o) throw notFound('This link is not valid.');
  return o;
}

// What the family member sees: no login, only this one payment.
export async function view(t) {
  const o = await byToken(t);
  return { receiver: o.account_name, sender: o.sender, amount_htg: o.total_htg, pay_type: o.pay_type, bank_name: o.bank_name,
    account_end: String(o.account_ref).slice(-4), pay_reference: o.pay_reference, said: o.receiver_said, open: ['PAID_CLAIMED', 'DISPUTED'].includes(o.state), state: o.state };
}

export async function answer(t, received) {
  const o = await byToken(t);
  if (!['PAID_CLAIMED', 'DISPUTED'].includes(o.state)) throw conflict('This payment is already closed.');
  const said = received ? 'RECEIVED' : 'NOT_RECEIVED';
  await q('UPDATE orders SET receiver_said=$2, receiver_at=now() WHERE id=$1', [o.id, said]);
  await q(`INSERT INTO chat_messages (order_id, sender_id, body) VALUES ($1,NULL,$2)`, [o.id, received
    ? `${o.account_name} confirmed the money ARRIVED. Seller: you can release the USDT now.`
    : `${o.account_name} says the money did NOT arrive yet.`]);
  return { ok: true, said };
}
