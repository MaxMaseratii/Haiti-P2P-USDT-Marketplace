// Commercial Sellers (Vandè Komèsyal): an ID-verified account can ask to trade as a business.
// The owner checks it and approves. Approved businesses get the "Commercial Seller" badge and their
// business name on the market. Changing the business details sends it back for a new check.
import { q } from '../db.js';
import { bad, conflict, notFound } from '../errors.js';
import { sendEmail } from '../sms.js';
import { hasContact } from './users.js';

export const TYPES = ['EXCHANGE', 'SHOP', 'SERVICES', 'OTHER'];
const ownerEmail = () => String(process.env.ADMIN_EMAIL || '').split(',')[0].trim();
const mail = (to, s, t) => (to ? sendEmail(to, s, t).catch((e) => console.error('business email', e.message)) : null);

export async function apply(user, { business_name, business_type, business_reg, note }) {
  if (user.tier < 1) throw bad('Finish your ID check first. Then you can ask to become a Commercial Seller.', 'TIER');
  const name = String(business_name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw bad('Business name: 2 to 60 characters.');
  if (hasContact(name) || hasContact(note)) throw bad('No phone numbers, emails or links here. Trades happen inside the app.', 'NO_CONTACT');
  if (!TYPES.includes(business_type)) throw bad('Pick the kind of business.');
  const reg = String(business_reg || '').trim().slice(0, 40) || null;
  const why = String(note || '').trim().slice(0, 300) || null;
  const r = (await q(`UPDATE users SET business_status='PENDING', business_name=$2, business_type=$3, business_reg=$4, business_note=$5, business_at=now(), business_reviewed_at=NULL
                      WHERE id=$1 RETURNING business_status, business_name`, [user.id, name, business_type, reg, why])).rows[0];
  mail(ownerEmail(), 'Ayiti P2P: new Commercial Seller request', `${name} (${user.full_name}, ${user.phone}) asks to become a Commercial Seller.\n\nCheck it in your admin page, Ayiti P2P tab, "Commercial Sellers".`);
  return r;
}

export async function leave(user) {
  await q(`UPDATE users SET business_status=NULL, business_reviewed_at=NULL WHERE id=$1`, [user.id]);
  return { business_status: null };
}

export async function list(status = 'PENDING') {
  return (await q(`SELECT u.id, u.full_name, u.phone, u.email, u.tier, u.business_status, u.business_name, u.business_type, u.business_reg, u.business_note, u.business_at,
      (SELECT COUNT(*)::int FROM orders o WHERE o.seller_id=u.id AND o.state='COMPLETED') AS trades
      FROM users u WHERE u.business_status IS NOT NULL AND ($1='ALL' OR u.business_status=$1) ORDER BY u.business_at DESC LIMIT 100`, [status])).rows;
}

const SUBJ = { APPROVED: 'Ayiti P2P: you are now a Commercial Seller', REJECTED: 'Ayiti P2P: your Commercial Seller request' };
export async function decide(staff, id, { approve, note }) {
  const st = approve ? 'APPROVED' : 'REJECTED';
  if (!approve && !String(note || '').trim()) throw conflict('Write a short reason for the person.');
  const u = (await q(`UPDATE users SET business_status=$2, business_reviewed_at=now(),
        display_name = CASE WHEN $2='APPROVED' THEN business_name ELSE display_name END
      WHERE id=$1 AND business_status IS NOT NULL RETURNING id, email, business_name`, [id, st])).rows[0];
  if (!u) throw notFound();
  mail(u.email, SUBJ[st], approve
    ? `Good news: ${u.business_name} is now a Commercial Seller on Ayiti P2P. Your business name and badge show on the MarketPlace.\n\nhttps://ayitip2p.com`
    : `Your request for ${u.business_name} was not approved: ${note}\n\nYou can fix it and ask again in Profile → Business.\n\nhttps://ayitip2p.com`);
  return { id, business_status: st };
}
