import fs from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();
const exists = await client.query("SELECT to_regclass('public.orders') AS t");
if (exists.rows[0].t && !process.argv.includes('--force')) {
  console.log('Tables already exist. Nothing to do. (Use --force only on an empty dev database.)');
} else {
  await client.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  console.log('Schema created.');
}
await client.end();
