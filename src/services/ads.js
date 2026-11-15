import { tx, q } from '../db.js';
import { config, isMock } from '../config.js';
import { escrow } from '../escrow.js';
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
  // An ad can accept several payment types. Old callers send one pay_type / payment_method_id.
  const TYPES = ['MONCASH', 'NATCASH', 'BANK'];
  let types = [...new Set([].concat(b.pay_types || b.pay_type || []))];
  const pmIds = [...new Set([].concat(b.payment_method_ids || b.payment_method_id || []))];
  const price = num(b.price_htg, 'Price');
  const amount = num(b.amount, 'Amount');
  const minHtg = num(b.min_order_htg, 'Minimum order');
  const maxHtg = num(b.max_order_htg, 'Maximum order');
  if (Number(maxHtg) < Number(minHtg)) throw bad('Maximum order must be at least the minimum.');

  const ad = await tx(async (c) => {
    let pmIds2 = null;
    if (side === 'SELL') {
      if (!isMock() && !user.wallet_addr) throw bad('Link your wallet first (Wallet page).', 'WALLET');
      if (!pmIds.length) throw bad('Pick at least one of your payment accounts.');
      const pms = (await c.query('SELECT * FROM payment_methods WHERE id = ANY($1::uuid[]) AND user_id=$2', [pmIds, user.id])).rows;
      if (pms.length !== pmIds.length) throw bad('Pick your own payment accounts.');
      if (pms.some((p) => !p.verified)) throw forbidden('A payment account is not verified. The name must match your ID.');
      pmIds2 = pmIds; types = [...new Set(pms.map((p) => p.type))];
    }
    if (!types.length || types.some((t) => !TYPES.includes(t))) throw bad('Pick how you get paid: MONCASH, NATCASH or BANK.');
    const feeRate = config.feeRate;
    // SELL ads hold the seller's USDT now: amount + fee.
    const reserve = side === 'SELL'
      ? (await c.query('SELECT ($1::numeric + trunc($1::numeric * $2::numeric, 6))::text AS r', [amount, feeRate])).rows[0].r
      : '0';
    if (side === 'SELL') await wallet.lock(c, user.id, asset, reserve);
    const r = await c.query(
      `INSERT INTO ads (user_id, side, asset, price_htg, total_amount, remaining, min_order_htg, max_order_htg,
                        pay_type, payment_method_id, fee_rate, reserved, pay_types, pay_methods)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [user.id, side, asset, price, amount, minHtg, maxHtg, types[0], pmIds2 ? pmIds2[0] : null, feeRate, reserve, types, pmIds2]);
    return r.rows[0];
  });
  // Real chain: hold the same amount in the contract so the seller cannot withdraw it while the ad is open.
  if (side === 'SELL') {
    try { await escrow.syncReserve(user.id, asset); }
    catch (e) {
      console.error('reserve failed, closing ad', e.message);
      await setAdStatus(user, ad.id, 'CLOSED').catch(() => {});
      throw conflict('Could not hold the funds on chain. Check your deposit has arrived and try again.', 'RESERVE_FAILED');
    }
  }
  return ad;
}

export async function listAds({ side, asset, pay_type, min_htg } = {}) {
  const where = [`a.status='ACTIVE'`, 'a.remaining > 0', 'u.banned = false', '(u.suspended_until IS NULL OR u.suspended_until < now())'];
  const args = [];
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', '$' + args.length)); };
  if (side) add('a.side = ?', side);
  if (asset) add('a.asset = ?', asset);
  if (pay_type) add('? = ANY(a.pay_types)', pay_type);
  if (min_htg) add('a.max_order_htg >= ?', min_htg);
  // Best price first: buyers want the lowest SELL price, sellers want the highest BUY price.
  const order = side === 'BUY' ? 'a.price_htg DESC' : 'a.price_htg ASC';
  const r = await q(
    `SELECT a.id, a.side, a.asset, a.price_htg, a.remaining, a.min_order_htg, a.max_order_htg, a.pay_type, a.pay_types, a.created_at,
            u.id AS owner_id, COALESCE(u.display_name, u.full_name) AS owner_name, (u.display_name IS NOT NULL) AS is_business, (u.avatar_mime IS NOT NULL) AS has_avatar, u.bio,
            (SELECT COUNT(*)::int FROM orders o WHERE (o.seller_id=u.id OR o.buyer_id=u.id) AND o.state='COMPLETED') AS trades,
            (SELECT ROUND(AVG(stars),2)::text FROM ratings WHERE rated_id=u.id) AS rating,
            u.created_at AS member_since,
            EXISTS (SELECT 1 FROM kyc k WHERE k.user_id=u.id AND k.status='APPROVED') AS id_verified,
            -- Completion rate counts only what this person did wrong: a dispute they lost,
            -- or (as buyer) an order they cancelled or let expire. The other side's mistakes do not count against them.
            (SELECT CASE WHEN good + bad = 0 THEN NULL ELSE ROUND(100.0 * good / (good + bad))::int END FROM (
               SELECT COUNT(*) FILTER (WHERE o.state='COMPLETED' AND NOT (o.seller_id=u.id AND COALESCE(d.status::text,'')='RESOLVED_BUYER')) AS good,
                      COUNT(*) FILTER (WHERE (o.seller_id=u.id AND d.status='RESOLVED_BUYER') OR (o.buyer_id=u.id AND d.status='RESOLVED_SELLER')
                                          OR (o.buyer_id=u.id AND d.id IS NULL AND o.state IN ('REFUNDED','CANCELLED_TIMEOUT'))) AS bad
                 FROM orders o LEFT JOIN disputes d ON d.order_id=o.id
                WHERE (o.seller_id=u.id OR o.buyer_id=u.id) AND o.state IN ('COMPLETED','REFUNDED','CANCELLED_TIMEOUT')) x) AS completion_pct,
            (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (c.created_at - p.created_at)) / 60))::int
               FROM orders o JOIN order_events p ON p.order_id=o.id AND p.to_state='PAID_CLAIMED'
                             JOIN order_events c ON c.order_id=o.id AND c.to_state='COMPLETED'
              WHERE o.seller_id=u.id) AS avg_release_min,
            (SELECT COUNT(*)::int FROM disputes d JOIN orders o ON o.id=d.order_id WHERE o.seller_id=u.id OR o.buyer_id=u.id) AS disputes
     FROM ads a JOIN users u ON u.id=a.user_id
     WHERE ${where.join(' AND ')} ORDER BY ${order}, a.created_at LIMIT 100`, args);
  return r.rows;
}

export async function myAds(userId) {
  return (await q('SELECT * FROM ads WHERE user_id=$1 ORDER BY created_at DESC', [userId])).rows;
}

export async function setAdStatus(user, id, status) {
  if (!['PAUSED', 'ACTIVE', 'CLOSED'].includes(status)) throw bad('Bad status.');
  const closed = await tx(async (c) => {
    const ad = (await c.query('SELECT * FROM ads WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!ad || (ad.user_id !== user.id && user.role !== 'ADMIN')) throw notFound(); // the admin may stop any ad
    if (ad.status === 'CLOSED') throw conflict('Ad is closed.');
    if (status === 'ACTIVE' && ad.remaining === '0.000000') throw conflict('Nothing left to sell.');
    if (status === 'CLOSED') {
      // Give back the USDT that is not inside an open order.
      if (ad.side === 'SELL' && Number(ad.reserved) > 0) await wallet.unlock(c, ad.user_id, ad.asset, ad.reserved);
      const r = await c.query(`UPDATE ads SET status='CLOSED', remaining=0, reserved=0 WHERE id=$1 RETURNING *`, [id]);
      return r.rows[0];
    }
    const r = await c.query('UPDATE ads SET status=$2 WHERE id=$1 RETURNING *', [id, status]);
    return r.rows[0];
  });
  if (status === 'CLOSED' && closed.side === 'SELL') {
    try { await escrow.syncReserve(closed.user_id, closed.asset); } catch (e) { console.error('reserve sync', e.message); } // the worker retries
  }
  return closed;
}
