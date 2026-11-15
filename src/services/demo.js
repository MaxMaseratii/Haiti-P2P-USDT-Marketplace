import { q, tx } from '../db.js';
import * as users from './users.js';
import * as ads from './ads.js';
import * as wallet from './wallet.js';

// MOCK only. Puts example sellers and buyers in the market so a new visitor sees real-looking ads.
// These are fake accounts with fake money. Safe to delete. Runs once (when there are no ads).
const SELL = [
  ['Jean Baptiste', 'MONCASH', '139.50', 800, 1000, 25000],
  ['Widlene Joseph', 'NATCASH', '140.20', 450, 500, 15000],
  ['Pierre Louis', 'BANK', '141.00', 1500, 5000, 150000],
  ['Marie Claire Desir', 'MONCASH', '140.00', 300, 500, 10000],
  ['Stephanie Pierre', 'NATCASH', '141.75', 220, 500, 8000],
  ['Roody Charles', 'MONCASH', '142.50', 120, 500, 5000],
];
const BUY = [
  ['Nadege Fils', 'MONCASH', '137.80', 400, 1000, 20000],
  ['Kervens Altidor', 'BANK', '138.40', 900, 5000, 100000],
];

export async function seedDemo() {
  if ((await q('SELECT 1 FROM ads LIMIT 1')).rowCount) return false;
  let n = 0;
  const mk = async (name) => {
    const phone = '+5099900' + String(++n).padStart(4, '0');
    await users.signup({ phone, full_name: name });
    await q('UPDATE users SET tier=2 WHERE phone=$1', [phone]);
    const u = await users.findByPhone(phone);
    await q(`INSERT INTO kyc (user_id, status, id_doc_ref, name_on_id, reviewed_at) VALUES ($1,'APPROVED','demo',$2,now())`, [u.id, name]);
    return u;
  };
  for (const [name, type, price, amount, min, max] of SELL) {
    const u = await mk(name);
    const pm = (await q(`INSERT INTO payment_methods (user_id, type, account_name, account_ref, verified) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [u.id, type, name, '3799' + String(n).padStart(4, '0')])).rows[0];
    await tx((c) => wallet.credit(c, u.id, 'USDT', String(amount + 10)));
    await ads.createAd(u, { side: 'SELL', pay_type: type, price_htg: price, amount: String(amount), min_order_htg: String(min), max_order_htg: String(max), payment_method_id: pm.id });
  }
  for (const [name, type, price, amount, min, max] of BUY) {
    const u = await mk(name);
    await q(`INSERT INTO payment_methods (user_id, type, account_name, account_ref, verified) VALUES ($1,$2,$3,$4,true)`, [u.id, type, name, '3799' + String(n).padStart(4, '0')]);
    await ads.createAd(u, { side: 'BUY', pay_type: type, price_htg: price, amount: String(amount), min_order_htg: String(min), max_order_htg: String(max) });
  }
  return true;
}
