import { bad } from '../errors.js';

export async function ensure(c, userId, asset) {
  await c.query(
    'INSERT INTO wallet_balances (user_id, asset) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, asset]);
}

async function apply(c, userId, asset, dAvail, dLocked) {
  await ensure(c, userId, asset);
  try {
    await c.query(
      `UPDATE wallet_balances SET available = available + $3::numeric, locked = locked + $4::numeric
       WHERE user_id=$1 AND asset=$2`, [userId, asset, dAvail, dLocked]);
  } catch (e) {
    if (e.code === '23514') throw bad('Not enough balance.', 'BALANCE');
    throw e;
  }
}

const neg = (x) => '-' + x;

export const credit = (c, u, a, amt) => apply(c, u, a, amt, '0');
export const lock = (c, u, a, amt) => apply(c, u, a, neg(amt), amt);          // available -> locked
export const unlock = (c, u, a, amt) => apply(c, u, a, amt, neg(amt));        // locked -> available
export const burnLocked = (c, u, a, amt) => apply(c, u, a, '0', neg(amt));    // locked leaves (paid out)

export async function balances(c, userId) {
  const r = await c.query('SELECT asset, available, locked FROM wallet_balances WHERE user_id=$1 ORDER BY asset', [userId]);
  return r.rows;
}

export async function available(c, userId, asset) {
  const r = await c.query('SELECT available FROM wallet_balances WHERE user_id=$1 AND asset=$2', [userId, asset]);
  return r.rows[0]?.available ?? '0';
}
