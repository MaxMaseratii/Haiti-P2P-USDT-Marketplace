// Linked accounts. A trader can receive gourdes into another person's MonCash, NatCash or bank account,
// but only if that person has their own account here, passed the ID check, and accepts the link.
// That person then confirms in the app when the money arrives. The trader pays LINK_FEE_USDT per link every 30 days.
// We only swap crypto and gourdes between users. We never hold gourdes.
import { tx, q } from '../db.js';
import { bad, forbidden, notFound, conflict } from '../errors.js';
import { config, isMock } from '../config.js';
import * as wallet from './wallet.js';
import { sendSms } from '../sms.js';

async function charge(c, userId) {
  const fee = config.linkFeeUsdt;
  if (Number(fee) <= 0) return;
  if (Number(await wallet.available(c, userId, 'USDT')) < Number(fee)) throw bad(`A linked account costs ${fee} USDT a month. Add USDT to your wallet first.`, 'FEE');
  await wallet.debit(c, userId, 'USDT', fee);
  await wallet.credit(c, config.platformUserId, 'USDT', fee);
}

const VIEW = `SELECT l.id, l.status, l.paid_until, l.created_at, l.owner_id, l.member_id,
    COALESCE(o.display_name, o.full_name) AS owner_name, o.phone AS owner_phone,
    m.full_name AS member_name, m.phone AS member_phone,
    pm.id AS payment_method_id, pm.type, pm.account_ref, pm.account_name, pm.bank_name
  FROM account_links l JOIN users o ON o.id=l.owner_id JOIN users m ON m.id=l.member_id
  LEFT JOIN payment_methods pm ON pm.id=l.payment_method_id`;

export async function list(user) {
  const rows = (await q(`${VIEW} WHERE (l.owner_id=$1 OR l.member_id=$1) AND l.status <> 'ENDED' ORDER BY l.created_at`, [user.id])).rows;
  return { mine: rows.filter((r) => r.owner_id === user.id), asked: rows.filter((r) => r.member_id === user.id), fee: config.linkFeeUsdt, free: config.linkFree };
}

// Step 1: the trader asks a registered person by their phone number.
export async function invite(user, { phone }) {
  if (user.tier < 1) throw forbidden('Finish your ID check first.');
  phone = String(phone || '').replace(/[\s()\-.]/g, '');
  const m = (await q('SELECT id, tier, banned, full_name FROM users WHERE phone=$1', [phone])).rows[0];
  if (!m) throw notFound('Nobody has an account with this phone. Ask them to open an account and finish the ID check first.');
  if (m.id === user.id) throw bad('That is your own phone. Your own accounts are in Profile.');
  if (m.banned) throw forbidden('This person cannot be linked.');
  if (m.tier < 1) throw conflict(`${m.full_name} must finish the ID check before you can link their account.`);
  try {
    const l = (await q(`INSERT INTO account_links (owner_id, member_id) VALUES ($1,$2) RETURNING id`, [user.id, m.id])).rows[0];
    try { await sendSms(phone, `Ayiti P2P: ${user.full_name} asks to use one of your payment accounts to receive gourdes. Log in to Ayiti P2P to accept or refuse.`); } catch {}
    return l;
  } catch (e) { if (e.code === '23505') throw conflict('You already asked this person.'); throw e; }
}

// Step 2: the person accepts and picks which of their own verified accounts to share. The trader pays then.
export async function accept(user, linkId, { payment_method_id }) {
  return tx(async (c) => {
    const l = (await c.query('SELECT * FROM account_links WHERE id=$1 FOR UPDATE', [linkId])).rows[0];
    if (!l || l.member_id !== user.id) throw notFound();
    if (l.status !== 'PENDING') throw conflict('Already answered.');
    const pm = (await c.query('SELECT * FROM payment_methods WHERE id=$1 AND user_id=$2 AND verified AND NOT is_receiver AND active', [payment_method_id, user.id])).rows[0];
    if (!pm) throw bad('Pick one of your verified payment accounts.');
    const used = (await c.query(`SELECT COUNT(*)::int n FROM account_links WHERE owner_id=$1 AND status='ACTIVE'`, [l.owner_id])).rows[0].n;
    let paidUntil = null;
    if (used >= config.linkFree) {
      if (!isMock()) throw conflict('Paid linked accounts are not open yet with real money.');
      await charge(c, l.owner_id);
      paidUntil = new Date(Date.now() + 30 * 86400000);
    }
    await c.query(`UPDATE account_links SET status='ACTIVE', payment_method_id=$2, paid_until=$3 WHERE id=$1`, [linkId, pm.id, paidUntil]);
    return { ok: true };
  });
}

// Either side can end a link at any time.
export async function end(user, linkId) {
  const r = await q(`UPDATE account_links SET status='ENDED' WHERE id=$1 AND (owner_id=$2 OR member_id=$2) AND status <> 'ENDED' RETURNING id`, [linkId, user.id]);
  if (!r.rowCount) throw notFound();
  return { ok: true };
}

// Payment accounts this trader may receive into: their own + active linked ones.
export async function usableAccountIds(c, userId) {
  return (await c.query(`SELECT id FROM payment_methods WHERE user_id=$1 AND verified AND active AND NOT is_receiver
                         UNION SELECT payment_method_id FROM account_links WHERE owner_id=$1 AND status='ACTIVE'`, [userId])).rows.map((r) => r.id);
}

export async function linkedAccounts(userId) {
  return (await q(`SELECT pm.*, true AS linked, l.id AS link_id, m.full_name AS member_name FROM account_links l
                   JOIN payment_methods pm ON pm.id=l.payment_method_id JOIN users m ON m.id=l.member_id
                   WHERE l.owner_id=$1 AND l.status='ACTIVE'`, [userId])).rows;
}

export async function renew() {
  let renewed = 0, ended = 0;
  for (const l of (await q(`SELECT id, owner_id FROM account_links WHERE status='ACTIVE' AND paid_until IS NOT NULL AND paid_until < now()`)).rows) {
    try { await tx(async (c) => { await charge(c, l.owner_id); await c.query(`UPDATE account_links SET paid_until = now() + interval '30 days' WHERE id=$1`, [l.id]); }); renewed++; }
    catch { await q(`UPDATE account_links SET status='ENDED' WHERE id=$1`, [l.id]); ended++; }
  }
  return { linksRenewed: renewed, linksEnded: ended };
}

// When a buyer says "paid" into a linked account, tell the account owner to check and confirm.
export async function notifyMember(order) {
  const pm = (await q('SELECT pm.*, u.phone, u.full_name AS member_name FROM payment_methods pm JOIN users u ON u.id=pm.user_id WHERE pm.id=$1', [order.payment_method_id])).rows[0];
  if (!pm || pm.user_id === order.seller_id) return false;
  const htg = Number(order.total_htg).toLocaleString('en-US', { maximumFractionDigits: 2 });
  await q(`UPDATE orders SET receiver_said=NULL, receiver_at=NULL WHERE id=$1`, [order.id]);
  await q(`INSERT INTO chat_messages (order_id, sender_id, body) VALUES ($1,NULL,$2)`,
    [order.id, `${pm.member_name} owns the receiving account. We asked them to check for ${htg} HTG and confirm in the app.`]);
  try { await sendSms(pm.phone, `Ayiti P2P: check your ${pm.bank_name || pm.type} for ${htg} HTG (code ${order.pay_reference}). Then log in and confirm.`); } catch {}
  return true;
}

// The account owner's list of payments to check.
export async function toCheck(user) {
  return (await q(`SELECT o.id, o.total_htg, o.pay_reference, o.state, o.receiver_said, o.updated_at, pm.type, pm.account_ref, pm.bank_name,
                          COALESCE(s.display_name, s.full_name) AS trader, b.full_name AS payer
                     FROM orders o JOIN payment_methods pm ON pm.id=o.payment_method_id JOIN users s ON s.id=o.seller_id JOIN users b ON b.id=o.buyer_id
                    WHERE pm.user_id=$1 AND o.seller_id <> $1 AND o.state IN ('PAID_CLAIMED','DISPUTED') ORDER BY o.updated_at DESC`, [user.id])).rows;
}

export async function answer(user, orderId, received) {
  const o = (await q(`SELECT o.*, pm.user_id AS acc_owner, pm.account_name FROM orders o JOIN payment_methods pm ON pm.id=o.payment_method_id WHERE o.id=$1`, [orderId])).rows[0];
  if (!o || o.acc_owner !== user.id || o.seller_id === user.id) throw notFound();
  if (!['PAID_CLAIMED', 'DISPUTED'].includes(o.state)) throw conflict('This payment is already closed.');
  const said = received ? 'RECEIVED' : 'NOT_RECEIVED';
  await q('UPDATE orders SET receiver_said=$2, receiver_at=now() WHERE id=$1', [o.id, said]);
  await q(`INSERT INTO chat_messages (order_id, sender_id, body) VALUES ($1,NULL,$2)`, [o.id, received
    ? `${user.full_name} (account owner) confirmed the gourdes ARRIVED. Seller: you can unlock the crypto now.`
    : `${user.full_name} (account owner) says the gourdes did NOT arrive yet.`]);
  return { ok: true, said };
}
