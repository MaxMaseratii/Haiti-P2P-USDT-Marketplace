// One command for a hosted server: make the tables if they are missing, optionally add demo ads, then start.
import fs from 'node:fs';
import pg from 'pg';
import { config } from '../src/config.js';

if (!config.databaseUrl) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const client = new pg.Client({ connectionString: config.databaseUrl, ...(config.pgSsl ? { ssl: { rejectUnauthorized: false } } : {}) });
await client.connect();
if (!(await client.query("SELECT to_regclass('public.orders') AS t")).rows[0].t) {
  await client.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  console.log('Schema created.');
}
// Small upgrades for databases made by an older version.
for (const sql of [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar bytea', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime text',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS binance_uid text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_network text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_addr text',
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS bank_name text', 'ALTER TABLE evidence ADD COLUMN IF NOT EXISTS data bytea']) await client.query(sql);
// Login tokens are signed with TOKEN_SECRET. A missing or weak one would let anyone fake a login,
// so make a strong random one and keep it in the database (logins survive restarts).
await client.query('CREATE TABLE IF NOT EXISTS app_secrets (name text PRIMARY KEY, value text NOT NULL)');
if (!config.tokenSecret || config.tokenSecret === 'dev-only-secret' || config.tokenSecret.length < 32) {
  const crypto = await import('node:crypto');
  await client.query('INSERT INTO app_secrets (name, value) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING', ['token_secret', crypto.randomBytes(48).toString('base64url')]);
  config.tokenSecret = (await client.query("SELECT value FROM app_secrets WHERE name='token_secret'")).rows[0].value;
  console.log('TOKEN_SECRET was missing or weak. Using a strong secret stored in the database.');
}
await client.end();

if (config.demoSeed && config.escrowMode === 'MOCK') {
  const { seedDemo } = await import('../src/services/demo.js');
  console.log((await seedDemo()) ? 'Demo ads added.' : 'Demo ads skipped (market is not empty).');
  const { ensureTestAccounts } = await import('../src/services/demo.js');
  await ensureTestAccounts(); console.log('Test buyer and test seller are ready.');
}
await import('../src/server.js');
