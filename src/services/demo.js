import { q, tx } from '../db.js';
import * as users from './users.js';
import * as ads from './ads.js';
import * as wallet from './wallet.js';

// MOCK only. Puts example sellers and buyers in the market so a new visitor sees real-looking ads.
// These are fake accounts with fake money. Safe to delete. Runs once (when there are no ads).
const SELL = [
  ['Jean Baptiste', 'MONCASH,NATCASH,BANK', '139.50', 800, 1000, 25000],
  ['Widlene Joseph', 'NATCASH,MONCASH', '140.20', 450, 500, 15000],
  ['Pierre Louis', 'BANK', '141.00', 1500, 5000, 150000],
  ['Marie Claire Desir', 'MONCASH', '140.00', 300, 500, 10000],
  ['Stephanie Pierre', 'NATCASH', '141.75', 220, 500, 8000],
  ['Roody Charles', 'MONCASH', '142.50', 120, 500, 5000],
];
const BUY = [
  ['Nadege Fils', 'MONCASH,NATCASH', '137.80', 400, 1000, 20000],
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
  // one account per payment type the person accepts
  const accounts = async (u, name, types) => {
    const ids = [];
    for (const [i, type] of types.entries()) ids.push((await q(`INSERT INTO payment_methods (user_id, type, account_name, account_ref, verified, bank_name) VALUES ($1,$2,$3,$4,true,$5) RETURNING id`,
      [u.id, type, name, '37' + i + '9' + String(n).padStart(4, '0'), type === 'BANK' ? 'Unibank' : null])).rows[0].id);
    return ids;
  };
  for (const [name, list, price, amount, min, max] of SELL) {
    const u = await mk(name), types = list.split(',');
    const ids = await accounts(u, name, types);
    await tx((c) => wallet.credit(c, u.id, 'USDT', String(amount + 10)));
    await ads.createAd(u, { side: 'SELL', price_htg: price, amount: String(amount), min_order_htg: String(min), max_order_htg: String(max), payment_method_ids: ids });
  }
  for (const [name, list, price, amount, min, max] of BUY) {
    const u = await mk(name), types = list.split(',');
    await accounts(u, name, types);
    await ads.createAd(u, { side: 'BUY', pay_types: types, price_htg: price, amount: String(amount), min_order_htg: String(min), max_order_htg: String(max) });
  }
  return true;
}

// Ready-made test accounts: ID approved, payment account verified, wallet saved, fake USDT in the wallet.
// The home page has "Log in as test buyer / test seller" buttons for them (test mode only).
export const TEST_PHONES = { buyer: '+50999990001', seller: '+50999990002' };

export async function ensureTestAccounts() {
  const out = {};
  const defs = [
    ['buyer', 'Test Buyer', 'MONCASH', '38990001', '0x7777777777777777777777777777777777777777'],
    ['seller', 'Test Seller', 'NATCASH', '38990002', '0x8888888888888888888888888888888888888888'],
  ];
  for (const [who, name, type, ref, addr] of defs) {
    const phone = TEST_PHONES[who];
    let u = await users.findByPhone(phone);
    if (!u) {
      await users.signup({ phone, full_name: name });
      await q('UPDATE users SET tier=3, wallet_addr=$2 WHERE phone=$1', [phone, addr]);
      u = await users.findByPhone(phone);
      await q(`INSERT INTO kyc (user_id, status, id_doc_ref, name_on_id, reviewed_at) VALUES ($1,'APPROVED','demo',$2,now())`, [u.id, name]);
      await q(`INSERT INTO payment_methods (user_id, type, account_name, account_ref, verified, bank_name) VALUES ($1,$2,$3,$4,true,$5)`, [u.id, type, name, ref, type === 'BANK' ? 'Sogebank' : null]);
      await tx((c) => wallet.credit(c, u.id, 'USDT', '1000'));
      const pm = (await q('SELECT id FROM payment_methods WHERE user_id=$1', [u.id])).rows[0];
      if (who === 'seller') await ads.createAd(u, { side: 'SELL', pay_type: type, price_htg: '140.10', amount: '300', min_order_htg: '500', max_order_htg: '10000', payment_method_id: pm.id });
      else await ads.createAd(u, { side: 'BUY', pay_type: type, price_htg: '138.20', amount: '200', min_order_htg: '500', max_order_htg: '10000' });
    }
    // every test account gets one account of each type, so any ad can be tested
    const extra = who === 'buyer' ? [['NATCASH', '38990003'], ['BANK', '38990005']] : [['MONCASH', '38990004'], ['BANK', '38990006']];
    for (const [t2, r2] of extra) {
      const has = (await q('SELECT 1 FROM payment_methods WHERE user_id=$1 AND type=$2', [u.id, t2])).rows[0];
      if (!has) await q(`INSERT INTO payment_methods (user_id, type, account_name, account_ref, verified, bank_name) VALUES ($1,$2,$3,$4,true,$5) ON CONFLICT DO NOTHING`, [u.id, t2, name, r2, t2 === 'BANK' ? 'Sogebank' : null]);
    }
    // the test seller's ad takes all 3 payment types, and the test buyer's ad pays with all 3
    const all = (await q('SELECT id, type FROM payment_methods WHERE user_id=$1 AND verified ORDER BY created_at', [u.id])).rows;
    const one = new Map(); for (const p of all) if (!one.has(p.type)) one.set(p.type, p.id);
    if (who === 'seller') await q(`UPDATE ads SET pay_methods=$2::uuid[], pay_types=$3 WHERE user_id=$1 AND side='SELL' AND status='ACTIVE'`, [u.id, [...one.values()], [...one.keys()]]);
    else await q(`UPDATE ads SET pay_types=$2 WHERE user_id=$1 AND side='BUY' AND status='ACTIVE'`, [u.id, [...one.keys()]]);
    out[who] = u;
  }
  return out;
}
