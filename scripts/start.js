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
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS bank_name text']) await client.query(sql);
await client.end();

if (config.demoSeed && config.escrowMode === 'MOCK') {
  const { seedDemo } = await import('../src/services/demo.js');
  console.log((await seedDemo()) ? 'Demo ads added.' : 'Demo ads skipped (market is not empty).');
  const { ensureTestAccounts } = await import('../src/services/demo.js');
  await ensureTestAccounts(); console.log('Test buyer and test seller are ready.');
}
await import('../src/server.js');
