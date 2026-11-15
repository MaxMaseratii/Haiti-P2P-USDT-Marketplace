import crypto from 'node:crypto';
import { tx, q } from '../db.js';
import { config, isMock } from '../config.js';
import { escrow } from '../escrow.js';
import { bad, conflict, forbidden, notFound } from '../errors.js';
import * as wallet from './wallet.js';
import { checkUserCanTrade } from './limits.js';
import { banAndBlock } from './users.js';
import * as evm from '../escrow-evm.js';

const mins = (m) => new Date(Date.now() + m * 60000);
const hours = (h) => new Date(Date.now() + h * 3600000);
const FINAL = ['COMPLETED', 'REFUNDED', 'CANCELLED_TIMEOUT'];
export const isFinal = (s) => FINAL.includes(s);

// ---------- state change helper (the DB trigger checks the move is legal and logs it) ----------
export async function setState(c, id, from, to, { actor = null, note = null, set = {} } = {}) {
  await c.query(`SELECT set_config('app.actor',$1,true), set_config('app.note',$2,true)`, [actor || '', note || '']);
  const cols = Object.keys(set);
  const sets = ['state=$3', ...cols.map((k, i) => `${k}=$${i + 4}`)];
  const r = await c.query(
    `UPDATE orders SET ${sets.join(', ')} WHERE id=$1 AND state = ANY($2::order_state[]) RETURNING *`,
    [id, Array.isArray(from) ? from : [from], to, ...cols.map((k) => set[k])]);
  if (!r.rowCount) throw conflict('The order changed. Reload and try again.', 'STATE_CHANGED');
  return r.rows[0];
}

async function lockOrder(c, id) {
  const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!o) throw notFound('Order not found.');
  return o;
}

// ---------- create ----------
export async function createOrder(user, { ad_id, amount, payment_method_id }) {
  if (!/^\d+(\.\d+)?$/.test(String(amount)) || Number(amount) <= 0) throw bad('Amount must be a number above 0.');
  const amt = String(amount);

  const orderId = await tx(async (c) => {
    const ad = (await c.query('SELECT * FROM ads WHERE id=$1 FOR UPDATE', [ad_id])).rows[0];
    if (!ad || ad.status !== 'ACTIVE') throw conflict('This ad is not available.', 'AD_GONE');
    if (ad.user_id === user.id) throw bad('You cannot trade with your own ad.');
    const owner = (await c.query('SELECT * FROM users WHERE id=$1', [ad.user_id])).rows[0];
    if (owner.banned || (owner.suspended_until && new Date(owner.suspended_until) > new Date()))
      throw conflict('This ad is not available.', 'AD_GONE');

    const sellerId = ad.side === 'SELL' ? ad.user_id : user.id;
    const buyerId = ad.side === 'SELL' ? user.id : ad.user_id;

    if (Number(amt) > Number(ad.remaining)) throw bad('Not enough left in this ad.', 'TOO_BIG');
    const total = (await c.query('SELECT round($1::numeric * $2::numeric, 2)::text AS t', [amt, ad.price_htg])).rows[0].t;
    if (Number(total) < Number(ad.min_order_htg) || Number(total) > Number(ad.max_order_htg))
      throw bad(`Order must be between ${ad.min_order_htg} and ${ad.max_order_htg} HTG.`, 'RANGE');

    // Payment account the buyer will pay into.
    let pmId = ad.payment_method_id;
    if (ad.side === 'BUY') {
      const pm = (await c.query('SELECT * FROM payment_methods WHERE id=$1 AND user_id=$2', [payment_method_id, user.id])).rows[0];
      if (!pm) throw bad('Pick the payment account where you want to be paid.');
      if (!pm.verified) throw forbidden('That payment account is not verified. The name must match your ID.');
      if (pm.type !== ad.pay_type) throw bad(`This ad pays by ${ad.pay_type}.`);
      pmId = pm.id;
    }

    const buyer = buyerId === user.id ? user : owner;
    const seller = sellerId === user.id ? user : owner;
    if (!isMock() && (!buyer.wallet_addr || !seller.wallet_addr))
      throw bad('Both traders must link a wallet first (Wallet page).', 'WALLET');
    await checkUserCanTrade(c, buyer, Number(total), { asSeller: false });
    await checkUserCanTrade(c, seller, Number(total), { asSeller: true });

    // Fee comes from the seller, in USDT/USDC. The last order of an ad takes the leftover reserve.
    const isLast = amt === ad.remaining || Number(amt) === Number(ad.remaining);
    let fee;
    if (ad.side === 'SELL' && isLast) {
      fee = (await c.query('SELECT ($1::numeric - $2::numeric)::text AS f', [ad.reserved, amt])).rows[0].f;
    } else {
      fee = (await c.query('SELECT trunc($1::numeric * $2::numeric, 6)::text AS f', [amt, ad.fee_rate])).rows[0].f;
    }
    if (Number(fee) < 0) throw conflict('Ad reserve is off. Contact support.', 'RESERVE');

    if (ad.side === 'SELL') {
      const ok = await c.query(`SELECT ($1::numeric + $2::numeric <= $3::numeric) AS ok`, [amt, fee, ad.reserved]);
      if (!ok.rows[0].ok) throw conflict('Ad reserve is too low. Contact support.', 'RESERVE');
    } else {
      const need = (await c.query('SELECT ($1::numeric + $2::numeric)::text AS n', [amt, fee])).rows[0].n;
      const bal = await wallet.available(c, sellerId, ad.asset);
      if (Number(bal) < Number(need)) throw bad('Not enough balance to lock for this order.', 'BALANCE');
    }

    const ref = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    const o = (await c.query(
      `INSERT INTO orders (ad_id, buyer_id, seller_id, asset, amount, price_htg, total_htg, fee_amount,
                           payment_method_id, pay_reference, state_deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [ad.id, buyerId, sellerId, ad.asset, amt, ad.price_htg, total, fee, pmId, ref, mins(config.lockTimeoutMin)])).rows[0];

    const newRemaining = (await c.query('SELECT ($1::numeric - $2::numeric)::text AS r', [ad.remaining, amt])).rows[0].r;
    await c.query(
      `UPDATE ads SET remaining=$2::numeric,
              reserved = CASE WHEN side='SELL' THEN reserved - ($3::numeric + $4::numeric) ELSE reserved END,
              status = CASE WHEN $2::numeric = 0 THEN 'SOLD_OUT'::ad_status ELSE status END
       WHERE id=$1`, [ad.id, newRemaining, amt, fee]);

    await c.query(`INSERT INTO escrow_txs (order_id, kind) VALUES ($1,'LOCK')`, [o.id]);
    await c.query(`INSERT INTO order_events (order_id, actor_id, note) VALUES ($1,$2,'Order created')`, [o.id, user.id]);
    return o.id;
  });

  // Lock on the chain (or the mock). Then the order moves to AWAITING_PAYMENT.
  await confirmLock(orderId);
  return getOrderRaw(orderId);
}

export async function confirmLock(orderId) {
  const o0 = (await q('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0];
  if (!o0 || o0.state !== 'ORDER_CREATED') return;
  let txHash;
  try { ({ txHash } = await escrow.lock(o0)); }
  catch (e) { console.error('lock failed', orderId, e.message); await q(`UPDATE escrow_txs SET attempts = attempts + 1 WHERE order_id=$1 AND kind='LOCK'`, [orderId]); return; }

  await tx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (o.state !== 'ORDER_CREATED') return;
    const ad = (await c.query('SELECT * FROM ads WHERE id=$1', [o.ad_id])).rows[0];
    if (ad.side === 'BUY') {
      const need = (await c.query('SELECT ($1::numeric + $2::numeric)::text AS n', [o.amount, o.fee_amount])).rows[0].n;
      try { await wallet.lock(c, o.seller_id, o.asset, need); }
      catch {
        await c.query(`UPDATE escrow_txs SET status='FAILED' WHERE order_id=$1 AND kind='LOCK'`, [orderId]);
        await cancelNoLock(c, o, 'Seller balance too low to lock');
        return;
      }
    }
    await c.query(`UPDATE escrow_txs SET status='CONFIRMED', tx_hash=$2, confirmed_at=now() WHERE order_id=$1 AND kind='LOCK'`, [orderId, txHash]);
    await setState(c, orderId, 'ORDER_CREATED', 'AWAITING_PAYMENT', { note: 'USDT locked', set: { state_deadline: mins(config.payWindowMin) } });
  });
}

// ---------- put funds / ad stock back ----------
async function restoreAd(c, o, fundsLocked) {
  const ad = (await c.query('SELECT * FROM ads WHERE id=$1 FOR UPDATE', [o.ad_id])).rows[0];
  const back = (await c.query('SELECT ($1::numeric + $2::numeric)::text AS n', [o.amount, o.fee_amount])).rows[0].n;
  const adOpen = ad.status !== 'CLOSED';
  if (adOpen) {
    await c.query(
      `UPDATE ads SET remaining = remaining + $2::numeric,
              reserved = CASE WHEN side='SELL' THEN reserved + $3::numeric ELSE reserved END,
              status = CASE WHEN status='SOLD_OUT' THEN 'ACTIVE'::ad_status ELSE status END
       WHERE id=$1`, [ad.id, o.amount, back]);
  }
  // SELL: if the ad is open, the money stays reserved for the ad. Otherwise it goes back to the seller.
  // BUY: money was locked per order, so it goes back to the seller.
  const toSeller = ad.side === 'BUY' ? fundsLocked : !adOpen;
  if (toSeller) await wallet.unlock(c, o.seller_id, o.asset, back);
}

async function cancelNoLock(c, o, note) {
  await restoreAd(c, o, false);
  await setState(c, o.id, 'ORDER_CREATED', 'CANCELLED_TIMEOUT', { note });
}

// ---------- buyer actions ----------
export async function markPaid(user, orderId) {
  const o = await tx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (o.buyer_id !== user.id) throw forbidden('Only the buyer can do this.');
    if (o.state !== 'AWAITING_PAYMENT') throw conflict('Order is not waiting for payment.', 'STATE');
    const limit = new Date(o.state_deadline).getTime() + config.payGraceMin * 60000;
    if (Date.now() > limit) throw conflict('Payment time is over.', 'LATE');
    await setState(c, orderId, 'AWAITING_PAYMENT', 'PAID_CLAIMED', {
      actor: user.id, note: 'Buyer says paid', set: { state_deadline: mins(config.sellerReplyMin) } });
    return (await c.query('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0];
  });
  // Tell the chain, so the app key cannot cancel this order any more. If this fails the app still never
  // cancels a PAID order (the database blocks it). The contract rule is a second lock.
  try { await escrow.claimed(o); } catch (e) { console.error('claim on chain failed', orderId, e.message); }
  return o;
}

export async function buyerCancel(user, orderId) {
  await tx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (o.buyer_id !== user.id) throw forbidden('Only the buyer can cancel. Sellers cannot cancel.');
    if (o.state !== 'AWAITING_PAYMENT') throw conflict('You can only cancel before you press "I paid".', 'STATE');
    await beginRefund(c, o, 'BUYER_CANCEL', user.id, 'Buyer cancelled');
  });
  await confirmRefund(orderId);
  return getOrderRaw(orderId);
}

// ---------- seller action ----------
export async function sellerConfirm(user, orderId, { sig, deadline } = {}) {
  await tx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (o.seller_id !== user.id) throw forbidden('Only the seller can confirm.');
    if (o.state !== 'PAID_CLAIMED') throw conflict('Nothing to confirm yet.', 'STATE');
    let extra = {};
    if (!isMock()) {
      // On a real chain the seller approves the release with a wallet signature (no gas needed).
      if (sig) {
        evm.verifyReleaseSig(o, user.wallet_addr, sig, Number(deadline));
        extra = { release_sig: sig, release_deadline: Number(deadline) };
      } else if (!config.arbiterKey) throw bad('Sign the release with your wallet.', 'SIG');
    }
    await beginRelease(c, o, user.id, 'Seller confirmed money received', extra);
  });
  await confirmRelease(orderId);
  return getOrderRaw(orderId);
}

// ---------- release / refund ----------
export async function beginRelease(c, o, actor, note, extra = {}) {
  await setState(c, o.id, ['PAID_CLAIMED', 'DISPUTED'], 'RELEASING', { actor, note, set: { state_deadline: null, ...extra } });
  await c.query(`INSERT INTO escrow_txs (order_id, kind) VALUES ($1,'RELEASE')`, [o.id]);
}

export async function beginRefund(c, o, reason, actor, note) {
  await setState(c, o.id, ['AWAITING_PAYMENT', 'DISPUTED'], 'REFUNDING', {
    actor, note, set: { refund_reason: reason, state_deadline: null } });
  await c.query(`INSERT INTO escrow_txs (order_id, kind) VALUES ($1,'REFUND')`, [o.id]);
}

export async function confirmRelease(orderId) {
  const o0 = (await q('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0];
  if (!o0 || o0.state !== 'RELEASING') return;
  let txHash;
  try { ({ txHash } = await escrow.release(o0)); }
  catch (e) { console.error('release failed', orderId, e.message); await q(`UPDATE escrow_txs SET attempts = attempts + 1 WHERE order_id=$1 AND kind='RELEASE'`, [orderId]); return; }
  await tx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (o.state !== 'RELEASING') return;
    const total = (await c.query('SELECT ($1::numeric + $2::numeric)::text AS n', [o.amount, o.fee_amount])).rows[0].n;
    await wallet.burnLocked(c, o.seller_id, o.asset, total);
    await wallet.credit(c, o.buyer_id, o.asset, o.amount);
    if (Number(o.fee_amount) > 0) await wallet.credit(c, config.platformUserId, o.asset, o.fee_amount);
    await c.query(`UPDATE escrow_txs SET status='CONFIRMED', tx_hash=$2, confirmed_at=now() WHERE order_id=$1 AND kind='RELEASE'`, [orderId, txHash]);
    await setState(c, orderId, 'RELEASING', 'COMPLETED', { note: 'USDT sent to buyer' });
  });
}

export async function confirmRefund(orderId) {
  const o0 = (await q('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0];
  if (!o0 || o0.state !== 'REFUNDING') return;
  let txHash;
  try { ({ txHash } = await escrow.refund(o0)); }
  catch (e) { console.error('refund failed', orderId, e.message); await q(`UPDATE escrow_txs SET attempts = attempts + 1 WHERE order_id=$1 AND kind='REFUND'`, [orderId]); return; }
  await tx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (o.state !== 'REFUNDING') return;
    await restoreAd(c, o, true);
    await c.query(`UPDATE escrow_txs SET status='CONFIRMED', tx_hash=$2, confirmed_at=now() WHERE order_id=$1 AND kind='REFUND'`, [orderId, txHash]);
    await setState(c, orderId, 'REFUNDING', 'REFUNDED', { note: 'USDT returned to seller' });
  });
  // If the ad is still open the money goes back into its reserve (chain: reserve again).
  try { await escrow.syncReserve(o0.seller_id, o0.asset); } catch (e) { console.error('reserve sync', e.message); }
}

// ---------- disputes (opening) ----------
export async function openDispute(user, orderId, reason) {
  if (!reason || reason.trim().length < 5) throw bad('Say what is wrong (at least a few words).');
  return tx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (o.buyer_id !== user.id && o.seller_id !== user.id) throw forbidden();
    if (o.state !== 'PAID_CLAIMED') throw conflict('You can only open a dispute after "I paid".', 'STATE');
    return createDispute(c, o, user.id, reason.trim());
  });
}

export async function createDispute(c, o, openedBy, reason) {
  await setState(c, o.id, 'PAID_CLAIMED', 'DISPUTED', {
    actor: openedBy, note: reason, set: { state_deadline: hours(config.evidenceHours) } });
  const d = (await c.query(
    `INSERT INTO disputes (order_id, opened_by, reason, evidence_due) VALUES ($1,$2,$3,$4) RETURNING *`,
    [o.id, openedBy, reason, hours(config.evidenceHours)])).rows[0];
  await c.query(`INSERT INTO chat_messages (order_id, sender_id, body) VALUES ($1,NULL,$2)`,
    [o.id, 'A dispute was opened. Upload your proof within ' + config.evidenceHours + ' hours. A staff agent will decide.']);
  return d;
}

// ---------- reading ----------
export async function getOrderRaw(id) {
  return (await q('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
}

export async function getOrderView(user, id) {
  const o = await getOrderRaw(id);
  if (!o) throw notFound('Order not found.');
  const staff = ['AGENT', 'ADMIN'].includes(user.role);
  const party = o.buyer_id === user.id || o.seller_id === user.id;
  if (!party && !staff) throw notFound('Order not found.');

  const [buyer, seller, pm, events, escrowTxs, dispute] = await Promise.all([
    q('SELECT id, full_name, tier FROM users WHERE id=$1', [o.buyer_id]),
    q('SELECT id, full_name, tier FROM users WHERE id=$1', [o.seller_id]),
    q('SELECT type, account_name, account_ref FROM payment_methods WHERE id=$1', [o.payment_method_id]),
    q('SELECT created_at, from_state, to_state, note, actor_id FROM order_events WHERE order_id=$1 ORDER BY id', [id]),
    q('SELECT kind, status, tx_hash, attempts, created_at, confirmed_at FROM escrow_txs WHERE order_id=$1 ORDER BY created_at', [id]),
    q('SELECT * FROM disputes WHERE order_id=$1', [id]),
  ]);
  const showPay = ['AWAITING_PAYMENT', 'PAID_CLAIMED', 'DISPUTED'].includes(o.state) || isFinal(o.state) || o.state === 'RELEASING' || o.state === 'REFUNDING';
  return {
    order: o,
    role: o.buyer_id === user.id ? 'BUYER' : o.seller_id === user.id ? 'SELLER' : 'STAFF',
    buyer: buyer.rows[0], seller: seller.rows[0],
    payment: showPay ? pm.rows[0] : null,
    events: events.rows, escrow: escrowTxs.rows, dispute: dispute.rows[0] || null,
    server_time: new Date().toISOString(),
    grace_min: config.payGraceMin,
  };
}

export async function myOrders(userId) {
  return (await q(
    `SELECT id, ad_id, buyer_id, seller_id, asset, amount, price_htg, total_htg, state, state_deadline, created_at
     FROM orders WHERE buyer_id=$1 OR seller_id=$1 ORDER BY created_at DESC LIMIT 100`, [userId])).rows;
}

// ---------- chat ----------
const BAD_CHAT = /(https?:\/\/|www\.|\.(com|net|org|io|me)\b|\+?509|\b[34]\d{3}[\s-]?\d{4}\b|whatsapp|telegram)/i;

export async function postChat(user, orderId, body) {
  const text = String(body || '').trim();
  if (!text) throw bad('Message is empty.');
  if (text.length > 1000) throw bad('Message is too long.');
  const o = await getOrderRaw(orderId);
  if (!o) throw notFound('Order not found.');
  const staff = ['AGENT', 'ADMIN'].includes(user.role);
  const party = o.buyer_id === user.id || o.seller_id === user.id;
  if (!party && !staff) throw notFound('Order not found.');
  if (isFinal(o.state) && !staff) throw conflict('This order is closed.', 'CLOSED');
  // No links or phone numbers before the order is done: stops off-platform scams.
  if (!staff && BAD_CHAT.test(text)) throw bad('No links, phone numbers or other apps in chat. Keep the deal on the platform.', 'CHAT_RULE');
  const r = await q('INSERT INTO chat_messages (order_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, created_at', [orderId, user.id, text]);
  return r.rows[0];
}

export async function getChat(user, orderId) {
  const o = await getOrderRaw(orderId);
  if (!o) throw notFound('Order not found.');
  const staff = ['AGENT', 'ADMIN'].includes(user.role);
  if (o.buyer_id !== user.id && o.seller_id !== user.id && !staff) throw notFound('Order not found.');
  return (await q('SELECT id, sender_id, body, created_at FROM chat_messages WHERE order_id=$1 ORDER BY id', [orderId])).rows;
}

export async function rate(user, orderId, stars) {
  const s = Number(stars);
  if (!Number.isInteger(s) || s < 1 || s > 5) throw bad('Stars must be 1 to 5.');
  const o = await getOrderRaw(orderId);
  if (!o || (o.buyer_id !== user.id && o.seller_id !== user.id)) throw notFound('Order not found.');
  if (o.state !== 'COMPLETED') throw conflict('You can rate after the order is completed.');
  const rated = o.buyer_id === user.id ? o.seller_id : o.buyer_id;
  try {
    await q('INSERT INTO ratings (order_id, rater_id, rated_id, stars) VALUES ($1,$2,$3,$4)', [orderId, user.id, rated, s]);
  } catch (e) { if (e.code === '23505') throw conflict('You already rated this order.'); throw e; }
  return { ok: true };
}

// ---------- timers ----------
export async function runTimers() {
  const done = { lockCancelled: 0, refunded: 0, autoDisputed: 0, retried: 0 };

  // 1. Lock never confirmed in time: cancel. Nothing was moved.
  for (const { id } of (await q(`SELECT id FROM orders WHERE state='ORDER_CREATED' AND state_deadline < now()`)).rows) {
    await tx(async (c) => {
      const o = await lockOrder(c, id);
      if (o.state !== 'ORDER_CREATED') return;
      await c.query(`UPDATE escrow_txs SET status='FAILED' WHERE order_id=$1 AND kind='LOCK' AND status='SENT'`, [id]);
      await cancelNoLock(c, o, 'Lock was not confirmed in time');
      done.lockCancelled++;
    }).catch((e) => console.error('timer lock', id, e.message));
  }

  // 2. Buyer never paid: refund after the window + grace.
  for (const { id } of (await q(
    `SELECT id FROM orders WHERE state='AWAITING_PAYMENT'
       AND state_deadline + make_interval(mins => $1) < now()`, [config.payGraceMin])).rows) {
    try {
      await tx(async (c) => {
        const o = await lockOrder(c, id);
        if (o.state !== 'AWAITING_PAYMENT') return;
        await beginRefund(c, o, 'PAY_TIMEOUT', null, 'Payment window ended');
      });
      await confirmRefund(id);
      done.refunded++;
    } catch (e) { console.error('timer refund', id, e.message); }
  }

  // 3. Seller silent after "I paid": open a dispute. Never auto-release.
  for (const { id } of (await q(`SELECT id FROM orders WHERE state='PAID_CLAIMED' AND state_deadline < now()`)).rows) {
    await tx(async (c) => {
      const o = await lockOrder(c, id);
      if (o.state !== 'PAID_CLAIMED') return;
      await createDispute(c, o, null, 'Seller did not answer in time');
      done.autoDisputed++;
    }).catch((e) => console.error('timer dispute', id, e.message));
  }

  // 4. Release / refund that did not finish: try again.
  for (const { id } of (await q(`SELECT id FROM orders WHERE state='RELEASING'`)).rows) { await confirmRelease(id); done.retried++; }
  for (const { id } of (await q(`SELECT id FROM orders WHERE state='REFUNDING'`)).rows) { await confirmRefund(id); done.retried++; }
  // Locks that were not confirmed yet (the first try failed): try again.
  for (const { id } of (await q(`SELECT id FROM orders WHERE state='ORDER_CREATED'`)).rows) { await confirmLock(id); }
  // 5. Real chain: read deposits and withdrawals, keep ad reserves equal on chain.
  try { await escrow.tick(); } catch (e) { console.error('chain tick', e.message); }
  return done;
}

