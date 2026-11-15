import pg from 'pg';
import { config } from './config.js';

// Return numeric columns as strings. No float math on money.
pg.types.setTypeParser(1700, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, ...(config.pgSsl ? { ssl: { rejectUnauthorized: false } } : {}) });

export const q = (text, params) => pool.query(text, params);

// Run fn inside one transaction. Rolls back on any error.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}
