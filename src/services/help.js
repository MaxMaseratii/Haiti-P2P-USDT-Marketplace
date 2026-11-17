// Help: the in-app helper answers common questions by itself (in the browser). When it cannot,
// the person writes to the team here. The owner answers from the admin page; the answer shows in the app
// and goes by email when we have one. Each new message also emails the owner, so nothing waits.
import { q } from '../db.js';
import { bad, notFound } from '../errors.js';
import { sendEmail } from '../sms.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const ownerEmail = () => String(process.env.ADMIN_EMAIL || '').split(',')[0].trim();
const mail = (to, subject, text) => (to ? sendEmail(to, subject, text).catch((e) => console.error('help email', e.message)) : null);

export async function ask(user, { message, contact, lang, page }) {
  message = String(message || '').trim(); contact = String(contact || '').trim().slice(0, 120);
  if (message.length < 5) throw bad('Write your question (a few words).');
  if (message.length > 1500) throw bad('Message is too long (max 1500).');
  if (!user && !EMAIL_RE.test(contact)) throw bad('Write your email so we can answer you.', 'EMAIL');
  const open = (await q(`SELECT COUNT(*)::int n FROM support_tickets WHERE (user_id=$1 OR ($1 IS NULL AND contact=$2)) AND created_at > now() - interval '1 hour'`, [user?.id || null, contact])).rows[0].n;
  if (open >= 5) throw bad('You already sent several messages. Our team will answer soon.');
  const t = (await q(`INSERT INTO support_tickets (user_id, contact, lang, message, page) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
    [user?.id || null, user ? (user.email || user.phone) : contact, ['ht', 'fr', 'en'].includes(lang) ? lang : 'en', message, String(page || '').slice(0, 60)])).rows[0];
  mail(ownerEmail(), 'Ayiti P2P: new help message', `From: ${user ? user.full_name + ' ' + user.phone : contact}\n\n${message}\n\nAnswer it in your admin page, Ayiti P2P tab, "Help messages".`);
  return { id: t.id, created_at: t.created_at };
}

export async function mine(user) {
  return (await q(`SELECT id, message, reply, status, created_at, replied_at FROM support_tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [user.id])).rows;
}

export async function list(status = 'OPEN') {
  return (await q(`SELECT t.*, u.full_name, u.phone, u.email FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id
                   WHERE ($1='ALL' OR t.status=$1) ORDER BY t.created_at DESC LIMIT 100`, [status])).rows;
}

const SIGN = { ht: '\n\nEkip Ayiti P2P\nhttps://ayitip2p.com', fr: '\n\nL\'équipe Ayiti P2P\nhttps://ayitip2p.com', en: '\n\nThe Ayiti P2P team\nhttps://ayitip2p.com' };
const SUBJ = { ht: 'Ayiti P2P: repons pou kesyon ou', fr: 'Ayiti P2P : réponse à votre question', en: 'Ayiti P2P: answer to your question' };
export async function reply(staff, id, text) {
  text = String(text || '').trim();
  if (text.length < 2) throw bad('Write the answer.');
  const t = (await q(`UPDATE support_tickets SET reply=$2, status='ANSWERED', replied_at=now(), replied_by=$3 WHERE id=$1 RETURNING *`, [id, text, staff.id])).rows[0];
  if (!t) throw notFound();
  const to = t.user_id ? (await q('SELECT email FROM users WHERE id=$1', [t.user_id])).rows[0]?.email : (EMAIL_RE.test(t.contact) ? t.contact : null);
  mail(to, SUBJ[t.lang] || SUBJ.en, `${text}\n\n— ${t.message.slice(0, 300)}${SIGN[t.lang] || SIGN.en}`);
  return { id, status: 'ANSWERED', emailed: !!to };
}

export async function close(id) {
  const r = await q(`UPDATE support_tickets SET status='CLOSED' WHERE id=$1 RETURNING id`, [id]);
  if (!r.rowCount) throw notFound();
  return { id, status: 'CLOSED' };
}
