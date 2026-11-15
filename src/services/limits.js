import { forbidden } from '../errors.js';
import { config } from '../config.js';

const FINAL = ['COMPLETED', 'REFUNDED', 'CANCELLED_TIMEOUT'];

export async function limitsFor(c, user) {
  const r = await c.query('SELECT * FROM tier_limits WHERE tier=$1', [user.tier]);
  const t = r.rows[0];
  const f = user.strikes >= 1 ? 0.5 : 1; // 1st strike: lower limits
  return {
    maxOrder: Number(t.max_order_htg) * f,
    maxDaily: Number(t.max_daily_htg) * f,
    maxOpen: Number(t.max_open_orders),
  };
}

// Throws if this user may not take an order of this size right now.
export async function checkUserCanTrade(c, user, totalHtg, { asSeller }) {
  if (user.tier < 1) throw forbidden('Finish the ID check first.');
  const lim = await limitsFor(c, user);
  if (totalHtg > lim.maxOrder) throw forbidden(`Order is above your limit (${lim.maxOrder} HTG per order).`);

  const day = await c.query(
    `SELECT COALESCE(SUM(total_htg),0) AS s FROM orders
     WHERE (buyer_id=$1 OR seller_id=$1) AND created_at > now() - interval '24 hours'
       AND state NOT IN ('CANCELLED_TIMEOUT','REFUNDED')`, [user.id]);
  if (Number(day.rows[0].s) + totalHtg > lim.maxDaily)
    throw forbidden(`Daily limit reached (${lim.maxDaily} HTG per day).`);

  const open = await c.query(
    `SELECT COUNT(*)::int AS n FROM orders
     WHERE (buyer_id=$1 OR seller_id=$1) AND state <> ALL($2::order_state[])`, [user.id, FINAL]);
  if (open.rows[0].n >= lim.maxOpen) throw forbidden(`Too many open orders (max ${lim.maxOpen}).`);

  if (asSeller) {
    const done = await c.query(`SELECT COUNT(*)::int AS n FROM orders WHERE seller_id=$1 AND state='COMPLETED'`, [user.id]);
    if (done.rows[0].n < 5 && totalHtg > config.newSellerCapHtg)
      throw forbidden(`New sellers can only sell up to ${config.newSellerCapHtg} HTG per order until 5 sales are done.`);
  }

  // Many orders opened then dropped fast: pause.
  const dropped = await c.query(
    `SELECT COUNT(*)::int AS n FROM orders
     WHERE (buyer_id=$1 OR seller_id=$1) AND created_at > now() - interval '1 hour'
       AND (state = 'CANCELLED_TIMEOUT' OR refund_reason IN ('BUYER_CANCEL','PAY_TIMEOUT'))`, [user.id]);
  if (dropped.rows[0].n >= 5) throw forbidden('Too many cancelled orders. Try again later.');
}
