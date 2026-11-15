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
await client.end();

if (config.demoSeed && config.escrowMode === 'MOCK') {
  const { seedDemo } = await import('../src/services/demo.js');
  console.log((await seedDemo()) ? 'Demo ads added.' : 'Demo ads skipped (market is not empty).');
}
await import('../src/server.js');
