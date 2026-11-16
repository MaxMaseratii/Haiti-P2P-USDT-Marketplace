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
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS bank_name text', 'ALTER TABLE evidence ADD COLUMN IF NOT EXISTS data bytea',
  'ALTER TABLE ads ADD COLUMN IF NOT EXISTS pay_types text[]', 'ALTER TABLE ads ADD COLUMN IF NOT EXISTS pay_methods uuid[]',
  'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS id_type text', 'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS id_number text', 'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS challenge text',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_challenge text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS closed_at timestamptz',
  `CREATE TABLE IF NOT EXISTS kyc_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), kyc_id uuid REFERENCES kyc(id),
     kind text NOT NULL CHECK (kind IN ('FRONT','BACK','VIDEO')), mime text NOT NULL, size int NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  'CREATE UNIQUE INDEX IF NOT EXISTS kyc_files_draft ON kyc_files (user_id, kind) WHERE kyc_id IS NULL',
  'CREATE INDEX IF NOT EXISTS kyc_files_kyc ON kyc_files (kyc_id)',
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS is_receiver boolean NOT NULL DEFAULT false',
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS receiver_phone text',
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS paid_until timestamptz',
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true',
  'ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_type_account_ref_key',
  'CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_account_uniq ON payment_methods (type, account_ref) WHERE NOT is_receiver',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS receiver_token_hash text', 'ALTER TABLE orders ADD COLUMN IF NOT EXISTS receiver_said text',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS receiver_at timestamptz',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS lock_fee numeric(18,6) NOT NULL DEFAULT 0',
  `CREATE TABLE IF NOT EXISTS account_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id), member_id uuid NOT NULL REFERENCES users(id),
     payment_method_id uuid, status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','ENDED')), paid_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK (owner_id <> member_id))`,
  "CREATE UNIQUE INDEX IF NOT EXISTS account_links_open ON account_links (owner_id, member_id) WHERE status <> 'ENDED'",
  'UPDATE payment_methods SET active=false WHERE is_receiver', // old unregistered family receivers are gone
  "UPDATE ads SET pay_types = ARRAY[pay_type::text] WHERE pay_types IS NULL",
  "UPDATE ads SET pay_methods = ARRAY[payment_method_id] WHERE pay_methods IS NULL AND payment_method_id IS NOT NULL"]) await client.query(sql);
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
