import { tx, q } from '../db.js';
import { config } from '../config.js';
import { bad, forbidden, notFound, conflict } from '../errors.js';
import * as wallet from './wallet.js';

const num = (v, name) => {
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${name} is missing.`);
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) throw bad(`${name} must be a number above 0.`);
  return s;
};

export async function createAd(user, b) {
  if (user.tier < 1) throw forbidden('Finish the ID check first.');
  const side = b.side;
  if (!['SELL', 'BUY'].includes(side)) throw bad('Side must be SELL or BUY.');
  const asset = b.asset || 'USDT';
  if (!['USDT', 'USDC'].includes(asset)) throw bad('Asset must be USDT or USDC.');
  if (!['MONCASH', 'NATCASH', 'BANK'].includes(b.pay_type)) throw bad('pay_type must be MONCASH, NATCASH or BANK.');
  const price = num(b.price_htg, 'Price');
  const amount = num(b.amount, 'Amount');
  const minHtg = num(b.min_order_htg, 'Minimum order');
  const maxHtg = num(b.max_order_htg, 'Maximum order');
  if (Number(maxHtg) < Number(minHtg)) throw bad('Maximum order must be at least the minimum.');

  return tx(async (c) => {
    let pmId = null;
    if (side === 'SELL') {
      const pm = (await c.query('SELECT * FROM payment_methods WHERE id=$1 AND user_id=$2', [b.payment_method_id, user.id])).rows[0];
      if (!pm) throw bad('Pick one of your payment accounts.');
      if (!pm.verified) throw forbidden('That payment account is not verified. The name must match your ID.');
      if (pm.type !== b.pay_type) throw bad('Payment account type does not match.');
      pmId = pm.id;
    }
    const feeRate = config.feeRate;
    // SELL ads hold the seller's USDT now: amount + fee.
    const reserve = side === 'SELL'
      ? (await c.query('SELECT ($1::numeric + trunc($1::numeric * $2::numeric, 6))::text AS r', [amount, feeRate])).rows[0].r
      : '0';
    if (side === 'SELL') await wallet.lock(c, user.id, asset, reserve);
    const r = await c.query(
      `INSERT INTO ads (user_id, side, asset, price_htg, total_amount, remaining, min_order_htg, max_order_htg,
                        pay_type, payment_method_id, fee_rate, reserved)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [user.id, side, asset, price, amount, minHtg, maxHtg, b.pay_type, pmId, feeRate, reserve]);
    return r.rows[0];
  });
}

export async function listAds({ side, asset, pay_type, min_htg } = {}) {
  const where = [`a.status='ACTIVE'`, 'a.remaining > 0', 'u.banned = false', '(u.suspended_until IS NULL OR u.suspended_until < now())'];
  const args = [];
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', '$' + args.length)); };
  if (side) add('a.side = ?', side);
  if (asset) add('a.asset = ?', asset);
  if (pay_type) add('a.pay_type = ?', pay_type);
  if (min_htg) add('a.max_order_htg >= ?', min_htg);
  // Best price first: buyers want the lowest SELL price, sellers want the highest BUY price.
  const order = side === 'BUY' ? 'a.price_htg DESC' : 'a.price_htg ASC';
  const r = await q(
    `SELECT a.id, a.side, a.asset, a.price_htg, a.remaining, a.min_order_htg, a.max_order_htg, a.pay_type, a.created_at,
            u.id AS owner_id, u.full_name AS owner_name,
            (SELECT COUNT(*)::int FROM orders o WHERE (o.seller_id=u.id OR o.buyer_id=u.id) AND o.state='COMPLETED') AS trades,
            (SELECT ROUND(AVG(stars),2)::text FROM ratings WHERE rated_id=u.id) AS rating
     FROM ads a JOIN users u ON u.id=a.user_id
     WHERE ${where.join(' AND ')} ORDER BY ${order}, a.created_at LIMIT 100`, args);
  return r.rows;
}

export async function myAds(userId) {
  return (await q('SELECT * FROM ads WHERE user_id=$1 ORDER BY created_at DESC', [userId])).rows;
}

export async function setAdStatus(user, id, status) {
  if (!['PAUSED', 'ACTIVE', 'CLOSED'].includes(status)) throw bad('Bad status.');
  return tx(async (c) => {
    const ad = (await c.query('SELECT * FROM ads WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!ad || ad.user_id !== user.id) throw notFound();
    if (ad.status === 'CLOSED') throw conflict('Ad is closed.');
    if (status === 'ACTIVE' && ad.remaining === '0.000000') throw conflict('Nothing left to sell.');
    if (status === 'CLOSED') {
      // Give back the USDT that is not inside an open order.
      if (ad.side === 'SELL' && Number(ad.reserved) > 0) await wallet.unlock(c, user.id, ad.asset, ad.reserved);
      const r = await c.query(`UPDATE ads SET status='CLOSED', remaining=0, reserved=0 WHERE id=$1 RETURNING *`, [id]);
      return r.rows[0];
    }
    const r = await c.query('UPDATE ads SET status=$2 WHERE id=$1 RETURNING *', [id, status]);
    return r.rows[0];
  });
}
