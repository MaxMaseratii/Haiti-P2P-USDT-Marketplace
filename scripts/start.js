// One command for a hosted server: make the tables if they are missing, then start.
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
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS bank_name text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_after timestamptz', 'ALTER TABLE evidence ADD COLUMN IF NOT EXISTS data bytea',
  'ALTER TABLE ads ADD COLUMN IF NOT EXISTS pay_types text[]', 'ALTER TABLE ads ADD COLUMN IF NOT EXISTS pay_methods uuid[]',
  'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS id_type text', 'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS id_number text', 'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS challenge text',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_challenge text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS closed_at timestamptz',
  `CREATE TABLE IF NOT EXISTS kyc_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), kyc_id uuid REFERENCES kyc(id),
     kind text NOT NULL CHECK (kind IN ('FRONT','BACK','VIDEO')), mime text NOT NULL, size int NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  'CREATE UNIQUE INDEX IF NOT EXISTS kyc_files_draft ON kyc_files (user_id, kind) WHERE kyc_id IS NULL',
  'CREATE INDEX IF NOT EXISTS kyc_files_kyc ON kyc_files (kyc_id)',
  // automatic ID check: 3 face pictures taken during the video, and the robot's answer on each ID
  'ALTER TABLE kyc_files DROP CONSTRAINT IF EXISTS kyc_files_kind_check',
  "ALTER TABLE kyc_files ADD CONSTRAINT kyc_files_kind_check CHECK (kind IN ('FRONT','BACK','VIDEO','FACE1','FACE2','FACE3'))",
  // extra receiving accounts: one-time fee; UNPAID = accepted, waiting for the fee
  'ALTER TABLE account_links ADD COLUMN IF NOT EXISTS paid_at timestamptz',
  'ALTER TABLE account_links DROP CONSTRAINT IF EXISTS account_links_status_check',
  "ALTER TABLE account_links ADD CONSTRAINT account_links_status_check CHECK (status IN ('PENDING','UNPAID','ACTIVE','ENDED'))",
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS pw_hash text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS pw_fails int NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS pw_locked_until timestamptz',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS business_status text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name text',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS business_type text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS business_reg text',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS business_note text', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS business_at timestamptz',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS business_reviewed_at timestamptz',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS cover bytea', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_mime text',
  'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS auto_status text', 'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS auto_result jsonb',
  'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS auto_at timestamptz', 'ALTER TABLE kyc ADD COLUMN IF NOT EXISTS face_vec real[]',
  `CREATE TABLE IF NOT EXISTS support_tickets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), contact text, lang text, message text NOT NULL,
     page text, reply text, replied_by uuid REFERENCES users(id), replied_at timestamptz, status text NOT NULL DEFAULT 'OPEN', created_at timestamptz NOT NULL DEFAULT now())`,
  'CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())',
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS is_receiver boolean NOT NULL DEFAULT false',
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS receiver_phone text',
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS paid_until timestamptz',
  'ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true',
  'ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_type_account_ref_key',
  'CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_account_uniq ON payment_methods (type, account_ref) WHERE NOT is_receiver',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS receiver_token_hash text', 'ALTER TABLE orders ADD COLUMN IF NOT EXISTS receiver_said text',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS receiver_at timestamptz',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS lock_fee numeric(18,6) NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS email text', 'ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS email text',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL',
  // Business profiles, terms, payment-delay protection
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version text',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_at timestamptz',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS department text',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS area text',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS response_min smallint',
  'ALTER TABLE ratings ADD COLUMN IF NOT EXISTS comment text',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_eta_min smallint',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_eta_at timestamptz',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS delay_until timestamptz',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS delay_count smallint NOT NULL DEFAULT 0',
  'CREATE TABLE IF NOT EXISTS user_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), mime text NOT NULL, size int NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())',
  'CREATE INDEX IF NOT EXISTS user_photos_user ON user_photos (user_id, created_at)',
  'CREATE TABLE IF NOT EXISTS provider_status (provider text PRIMARY KEY, down boolean NOT NULL DEFAULT false, note text, updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now())',
  "CREATE TABLE IF NOT EXISTS order_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), reporter_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL, note text, status text NOT NULL DEFAULT 'OPEN', created_at timestamptz NOT NULL DEFAULT now())",
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
// The owner account is made by the server itself (ADMIN_PHONES + ADMIN_EMAIL), so the owner can log in on day one:
// phone or email, then the code arrives by email. No sign-up form needed.
{
  const emails = String(process.env.ADMIN_EMAIL || '').split(',').map((x) => x.trim().toLowerCase());
  for (const [i, phone] of config.adminPhones.entries()) {
    const email = emails[i] || null, name = process.env.OWNER_NAME || 'Ayiti P2P Owner';
    const u = (await client.query('SELECT id, email, role FROM users WHERE phone=$1', [phone])).rows[0];
    if (!u) {
      if (email && (await client.query('SELECT 1 FROM users WHERE lower(email)=$1', [email])).rowCount) { console.log('Owner email already used by another account:', phone); continue; }
      const id = (await client.query(`INSERT INTO users (phone, full_name, role, tier, email, terms_version, terms_at) VALUES ($1,$2,'ADMIN',3,$3,$4,now()) RETURNING id`,
        [phone, name, email, config.termsVersion])).rows[0].id;
      await client.query(`INSERT INTO kyc (user_id, status, id_doc_ref, name_on_id, reviewed_at) VALUES ($1,'APPROVED','owner',$2,now())`, [id, name]);
      console.log('Owner account created for', phone.slice(0, 5) + '…');
    } else {
      if (u.role !== 'ADMIN') await client.query(`UPDATE users SET role='ADMIN', tier=3 WHERE id=$1`, [u.id]);
      if (!u.email && email) {
        // The owner's email may sit on a test account the owner made with a wrong phone (no trades, no money):
        // close that account and give the email to the owner account.
        const other = (await client.query(`SELECT o.id FROM users o WHERE lower(o.email)=$1 AND o.id<>$2 AND o.role='USER'
            AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.buyer_id=o.id OR x.seller_id=o.id) AND NOT EXISTS (SELECT 1 FROM ads a WHERE a.user_id=o.id)
            AND NOT EXISTS (SELECT 1 FROM wallet_balances w WHERE w.user_id=o.id AND (w.available>0 OR w.locked>0))`, [email, u.id])).rows[0];
        if (other) {
          await client.query(`UPDATE users SET email=NULL, closed_at=COALESCE(closed_at, now()) WHERE id=$1`, [other.id]);
          await client.query(`UPDATE kyc SET status='REJECTED', reviewed_at=now() WHERE user_id=$1 AND status='PENDING'`, [other.id]);
          console.log('Owner email moved from an unused account to the owner account.');
        }
        await client.query('UPDATE users SET email=$2 WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email)=$2)', [u.id, email]);
      }
      if (process.env.OWNER_NAME) await client.query(`UPDATE users SET full_name=$2 WHERE id=$1 AND full_name='Ayiti P2P Owner'`, [u.id, process.env.OWNER_NAME]);
      if (process.env.OWNER_NAME) await client.query(`UPDATE kyc SET name_on_id=$2 WHERE user_id=$1 AND id_doc_ref='owner' AND name_on_id='Ayiti P2P Owner'`, [u.id, process.env.OWNER_NAME]);
    }
  }
}
await client.end();

await import('../src/server.js');
