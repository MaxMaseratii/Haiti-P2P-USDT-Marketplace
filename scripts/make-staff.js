// Make (or promote) a staff account. Usage: node scripts/make-staff.js +50937001234 "Full Name" AGENT|ADMIN
import pg from 'pg';

const [phone, name, role] = process.argv.slice(2);
if (!phone || !name || !['AGENT', 'ADMIN'].includes(role)) {
  console.error('Usage: node scripts/make-staff.js +509XXXXXXXX "Full Name" AGENT|ADMIN');
  process.exit(1);
}
if (!/^\+509\d{8}$/.test(phone)) { console.error('Phone must be +509 and 8 digits.'); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(
  `INSERT INTO users (phone, full_name, role, tier) VALUES ($1,$2,$3,3)
   ON CONFLICT (phone) DO UPDATE SET role = EXCLUDED.role`, [phone, name, role]);
console.log(`${phone} is now ${role}. Log in with code 000000 in MOCK mode.`);
await c.end();
