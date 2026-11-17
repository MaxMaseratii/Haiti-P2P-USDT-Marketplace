import crypto from 'node:crypto';
import { NETWORKS, validAddress, validBinanceUid } from '../networks.js';
import { tx, q } from '../db.js';
import { bad, conflict, forbidden, notFound } from '../errors.js';
import { checkPhone } from '../auth.js';
import { isBlocked, screenUser, addBlock } from './screening.js';
import { namesMatch } from './names.js';
import { isMock, config } from '../config.js';
import * as evm from '../escrow-evm.js';

export async function signup({ phone, full_name, email = null, accept_terms = false }) {
  checkPhone(phone);
  if (accept_terms !== true) throw bad('You must read and accept the Terms and Conditions to create an account.', 'TERMS');
  if (!full_name || full_name.trim().length < 3) throw bad('Enter your full name as on your ID.', 'NAME');
  return tx(async (c) => {
    if (await isBlocked(c, 'PHONE', phone)) throw forbidden('This phone is blocked.');
    if (await isBlocked(c, 'NAME', full_name.trim().toLowerCase())) throw forbidden('This name is blocked.');
    const ex = await c.query('SELECT 1 FROM users WHERE phone=$1', [phone]);
    if (ex.rowCount) throw conflict('Phone already has an account.', 'EXISTS');
    // Owner phones (ADMIN_PHONES) become ADMIN with full limits. They still must prove the phone with the SMS code.
    const isAdmin = config.adminPhones.includes(phone);
    if (email && (await c.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email])).rowCount) throw conflict('This email is already used by another account.', 'EMAIL_USED');
    const r = await c.query('INSERT INTO users (phone, full_name, role, tier, email, terms_version, terms_at) VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING *',
      [phone, full_name.trim(), isAdmin ? 'ADMIN' : 'USER', isAdmin ? 3 : 0, email, config.termsVersion]);
    if (isAdmin) // owner accounts skip the ID queue: their ID check is approved right away
      await c.query(`INSERT INTO kyc (user_id, status, id_doc_ref, name_on_id, reviewed_at) VALUES ($1,'APPROVED','owner',$2,now())`, [r.rows[0].id, full_name.trim()]);
    await screenUser(c, r.rows[0].id, full_name);
    return (await c.query('SELECT * FROM users WHERE id=$1', [r.rows[0].id])).rows[0];
  });
}

export async function findByPhone(phone) {
  const r = await q('SELECT * FROM users WHERE phone=$1', [phone]);
  return r.rows[0];
}

export const publicUser = (u) => ({
  id: u.id, phone: u.phone, full_name: u.full_name, role: u.role, tier: u.tier,
  strikes: u.strikes, wallet_addr: u.wallet_addr,
  binance_uid: u.binance_uid || null, payout_network: u.payout_network || null, payout_addr: u.payout_addr || null,
  display_name: u.display_name || null, bio: u.bio || null, has_avatar: !!u.avatar_mime, email: u.email || null,
  department: u.department || null, area: u.area || null, response_min: u.response_min || null,
  terms_ok: u.terms_version === config.termsVersion,
});

export async function acceptTerms(user) {
  await q('UPDATE users SET terms_version=$2, terms_at=now() WHERE id=$1', [user.id, config.termsVersion]);
  return { ok: true };
}

// ---------- business profile ----------
export const DEPARTMENTS = ['Ouest', 'Nord', 'Nord-Est', 'Nord-Ouest', 'Artibonite', 'Centre', 'Sud', 'Sud-Est', "Grand'Anse", 'Nippes', 'Diaspora'];
export const RESPONSE_MINS = [5, 10, 15, 30, 60];
const MAX_POSTERS = 6;

function imageFrom(dataUrl, maxKb, what) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad(what + ' must be a JPG, PNG or WEBP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxKb * 1024) throw bad(what + ' is too big.');
  return { buf, mime: m[1] };
}

export async function addPoster(user, { image }) {
  const { buf, mime } = imageFrom(image, 600, 'Poster');
  const n = Number((await q('SELECT COUNT(*) FROM user_photos WHERE user_id=$1', [user.id])).rows[0].count);
  if (n >= MAX_POSTERS) throw conflict(`You can show up to ${MAX_POSTERS} posters. Remove one first.`, 'MAX');
  const r = await q('INSERT INTO user_photos (user_id, mime, size, data) VALUES ($1,$2,$3,$4) RETURNING id', [user.id, mime, buf.length, buf]);
  return { id: r.rows[0].id };
}
export async function removePoster(user, id) {
  const r = await q('DELETE FROM user_photos WHERE id=$1 AND user_id=$2', [id, user.id]);
  if (!r.rowCount) throw notFound();
  return { ok: true };
}
export async function getPoster(id) {
  return (await q('SELECT mime, data FROM user_photos WHERE id=$1', [id])).rows[0];
}

// Real numbers only. Used on ads, the public profile and order pages.
export const STATS_SQL = (u) => `
  (SELECT COUNT(*)::int FROM orders o WHERE (o.seller_id=${u}.id OR o.buyer_id=${u}.id) AND o.state='COMPLETED') AS trades,
  (SELECT COALESCE(ROUND(SUM(o.amount))::int, 0) FROM orders o WHERE (o.seller_id=${u}.id OR o.buyer_id=${u}.id) AND o.state='COMPLETED') AS volume,
  (SELECT ROUND(AVG(stars),2)::text FROM ratings WHERE rated_id=${u}.id) AS rating,
  (SELECT COUNT(*)::int FROM ratings WHERE rated_id=${u}.id) AS ratings_count,
  EXISTS (SELECT 1 FROM kyc k WHERE k.user_id=${u}.id AND k.status='APPROVED') AS id_verified,
  (SELECT CASE WHEN good + bad = 0 THEN NULL ELSE ROUND(100.0 * good / (good + bad))::int END FROM (
     SELECT COUNT(*) FILTER (WHERE o.state='COMPLETED' AND NOT (o.seller_id=${u}.id AND COALESCE(d.status::text,'')='RESOLVED_BUYER')) AS good,
            COUNT(*) FILTER (WHERE (o.seller_id=${u}.id AND d.status='RESOLVED_BUYER') OR (o.buyer_id=${u}.id AND d.status='RESOLVED_SELLER')
                                OR (o.buyer_id=${u}.id AND d.id IS NULL AND o.state IN ('REFUNDED','CANCELLED_TIMEOUT'))) AS bad
       FROM orders o LEFT JOIN disputes d ON d.order_id=o.id
      WHERE (o.seller_id=${u}.id OR o.buyer_id=${u}.id) AND o.state IN ('COMPLETED','REFUNDED','CANCELLED_TIMEOUT')) x) AS completion_pct,
  (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (c.created_at - p.created_at)) / 60))::int
     FROM orders o JOIN order_events p ON p.order_id=o.id AND p.to_state='PAID_CLAIMED'
                   JOIN order_events c ON c.order_id=o.id AND c.to_state='COMPLETED'
    WHERE o.seller_id=${u}.id) AS avg_release_min,
  (SELECT COUNT(*)::int FROM disputes d JOIN orders o ON o.id=d.order_id WHERE o.seller_id=${u}.id OR o.buyer_id=${u}.id) AS disputes,
  (SELECT COALESCE(array_agg(p.id ORDER BY p.created_at), '{}') FROM user_photos p WHERE p.user_id=${u}.id) AS posters`;

// The public business page: anyone can look before they buy.
export async function publicProfile(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw notFound('Profile not found.');
  const u = (await q(
    `SELECT u.id, COALESCE(u.display_name, u.full_name) AS name, (u.display_name IS NOT NULL) AS is_business, u.bio, u.department, u.area, u.response_min,
            (u.avatar_mime IS NOT NULL) AS has_avatar, u.created_at AS member_since, ${STATS_SQL('u')}
       FROM users u WHERE u.id=$1 AND u.banned=false AND u.closed_at IS NULL`, [id])).rows[0];
  if (!u) throw notFound('Profile not found.');
  const [reviews, ads] = await Promise.all([
    q(`SELECT r.stars, r.comment, r.created_at, COALESCE(x.display_name, split_part(x.full_name, ' ', 1)) AS by_name
         FROM ratings r JOIN users x ON x.id=r.rater_id WHERE r.rated_id=$1 ORDER BY r.created_at DESC LIMIT 12`, [id]),
    q(`SELECT id, side, asset, price_htg, remaining, min_order_htg, max_order_htg, pay_type, pay_types FROM ads
        WHERE user_id=$1 AND status='ACTIVE' AND remaining > 0 ORDER BY created_at DESC`, [id]),
  ]);
  return { ...u, reviews: reviews.rows, ads: ads.rows };
}

const NO_CONTACT = /(https?:|www\.|@|\+?\d[\d\s().-]{6,}\d)/i;
export async function setProfile(user, { display_name, bio, avatar, department, area, response_min }) {
  const dn = String(display_name ?? '').trim(), b = String(bio ?? '').trim(), ar = String(area ?? '').trim();
  if (dn && (dn.length < 2 || dn.length > 40)) throw bad('Public name must be 2 to 40 letters.');
  if (b.length > 300) throw bad('About text is too long (max 300).');
  if (ar.length > 60) throw bad('Area is too long (max 60).');
  if (NO_CONTACT.test(dn) || NO_CONTACT.test(b) || NO_CONTACT.test(ar)) throw bad('No links, emails or phone numbers in your profile. Keep trades in the app.');
  const dep = department ? String(department) : null;
  if (dep && !DEPARTMENTS.includes(dep)) throw bad('Pick your department from the list.');
  const rm = response_min == null || response_min === '' ? null : Number(response_min);
  if (rm != null && !RESPONSE_MINS.includes(rm)) throw bad('Pick a response time from the list.');
  let buf = null, mime = null;
  if (avatar) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(avatar));
    if (!m) throw bad('Photo must be a JPG, PNG or WEBP image.');
    buf = Buffer.from(m[2], 'base64'); mime = m[1];
    if (buf.length > 200 * 1024) throw bad('Photo is too big.');
  }
  if (avatar === null) await q('UPDATE users SET avatar=NULL, avatar_mime=NULL WHERE id=$1', [user.id]);
  else if (buf) await q('UPDATE users SET avatar=$2, avatar_mime=$3 WHERE id=$1', [user.id, buf, mime]);
  await q('UPDATE users SET display_name=$2, bio=$3, department=$4, area=$5, response_min=$6 WHERE id=$1', [user.id, dn || null, b || null, dep, ar || null, rm]);
  return { ok: true };
}
export async function getAvatar(id) {
  const r = await q('SELECT avatar, avatar_mime FROM users WHERE id=$1 AND avatar IS NOT NULL', [id]);
  return r.rows[0];
}

export const BANKS = ['Sogebank', 'Unibank', 'BNC', 'BUH', 'Capital Bank', 'Sogebel', 'Other'];

export async function setWallet(user, addr, signature) {
  if (!addr || addr.length < 20) throw bad('Wallet address looks wrong.');
  // On a real chain deposits are credited to the account that owns the wallet, so the user must prove it.
  if (!isMock()) {
    addr = evm.verifyWalletLink(user.id, addr, signature);
    if (user.wallet_addr && user.wallet_addr.toLowerCase() !== addr.toLowerCase()
        && (await q(`SELECT 1 FROM wallet_balances WHERE user_id=$1 AND (available > 0 OR locked > 0) LIMIT 1`, [user.id])).rowCount)
      throw forbidden('You have funds in the contract. Withdraw them before you change wallet.');
  }
  return tx(async (c) => {
    if (await isBlocked(c, 'WALLET', addr)) throw forbidden('This wallet is blocked.');
    try { await c.query('UPDATE users SET wallet_addr=$2 WHERE id=$1', [user.id, addr]); }
    catch (e) { if (e.code === '23505') throw conflict('This wallet is already linked to another account.'); throw e; }
  });
}

// ---- KYC (manual review in the MVP) ----
// ---- ID check: ID photos + a short video where the person says their name, phone and a code ----
export const ID_TYPES = { NATIONAL_ID: 'National ID card (CIN)', PASSPORT: 'Passport', DRIVER_LICENSE: "Driver's license" };
const KYC_MAX = { FRONT: 8 * 1024 * 1024, BACK: 8 * 1024 * 1024, VIDEO: 25 * 1024 * 1024 };

// What kind of file is this, from its first bytes (never trust the name).
function sniff(buf) {
  const b = buf.subarray(0, 16);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return b.subarray(8, 10).toString('latin1') === 'qt' ? 'video/quicktime' : 'video/mp4';
  return null;
}

const newChallenge = () => Array.from(crypto.randomBytes(4), (x) => x % 10).join(' ');

export async function kycState(user) {
  let ch = (await q('SELECT kyc_challenge FROM users WHERE id=$1', [user.id])).rows[0].kyc_challenge;
  if (!ch) { ch = newChallenge(); await q('UPDATE users SET kyc_challenge=$2 WHERE id=$1', [user.id, ch]); }
  const last = (await q('SELECT id, status, id_type, name_on_id, created_at, reviewed_at FROM kyc WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [user.id])).rows[0] || null;
  const drafts = (await q('SELECT kind, mime, size FROM kyc_files WHERE user_id=$1 AND kyc_id IS NULL', [user.id])).rows;
  return { challenge: ch, phone: user.phone, full_name: user.full_name, last, drafts, id_types: ID_TYPES,
    script: `My name is ${user.full_name}. My phone number is ${user.phone}. My code is ${ch}.` };
}

export async function addKycFile(user, kind, buf) {
  if (!KYC_MAX[kind]) throw bad('Kind must be FRONT, BACK or VIDEO.');
  if (!Buffer.isBuffer(buf) || buf.length < 100) throw bad('The file is empty.');
  if (buf.length > KYC_MAX[kind]) throw bad(kind === 'VIDEO' ? 'Video is too big (max 25 MB). Keep it short, about 10 seconds.' : 'Photo is too big (max 8 MB).');
  const mime = sniff(buf);
  if (kind === 'VIDEO' ? !mime?.startsWith('video/') : !mime?.startsWith('image/')) throw bad(kind === 'VIDEO' ? 'That is not a video (MP4, MOV or WEBM).' : 'That is not a photo (JPG, PNG or WEBP).');
  await q(`INSERT INTO kyc_files (user_id, kind, mime, size, data) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (user_id, kind) WHERE kyc_id IS NULL DO UPDATE SET mime=EXCLUDED.mime, size=EXCLUDED.size, data=EXCLUDED.data, created_at=now()`,
    [user.id, kind, mime, buf.length, buf]);
  return { kind, mime, size: buf.length };
}

export async function submitKyc(user, { id_type, name_on_id, id_number }) {
  if (!ID_TYPES[id_type]) throw bad('Pick your ID: National ID card, passport or driver\'s license.');
  name_on_id = String(name_on_id || '').trim(); id_number = String(id_number || '').trim();
  if (name_on_id.length < 3) throw bad('Write your name exactly as it is on the ID.');
  if (id_number.length < 4 || id_number.length > 40) throw bad('Write the number on your ID.');
  return tx(async (c) => {
    if ((await c.query(`SELECT 1 FROM kyc WHERE user_id=$1 AND status IN ('PENDING','APPROVED')`, [user.id])).rowCount) throw conflict('Your ID is already sent or approved.');
    const have = new Set((await c.query('SELECT kind FROM kyc_files WHERE user_id=$1 AND kyc_id IS NULL', [user.id])).rows.map((r) => r.kind));
    const need = id_type === 'PASSPORT' ? ['FRONT', 'VIDEO'] : ['FRONT', 'BACK', 'VIDEO'];
    const miss = need.filter((k) => !have.has(k));
    if (miss.length) throw bad('Still missing: ' + miss.map((k) => ({ FRONT: 'photo of the front', BACK: 'photo of the back', VIDEO: 'your video' }[k])).join(', ') + '.');
    await screenUser(c, user.id, name_on_id);
    const ch = (await c.query('SELECT kyc_challenge FROM users WHERE id=$1', [user.id])).rows[0].kyc_challenge;
    const k = (await c.query(`INSERT INTO kyc (user_id, name_on_id, id_doc_ref, id_type, id_number, challenge) VALUES ($1,$2,'files',$3,$4,$5) RETURNING *`,
      [user.id, name_on_id, id_type, id_number, ch])).rows[0];
    await c.query('UPDATE kyc_files SET kyc_id=$2 WHERE user_id=$1 AND kyc_id IS NULL', [user.id, k.id]);
    await c.query('UPDATE users SET kyc_challenge=NULL WHERE id=$1', [user.id]); // a new code next time
    return k;
  });
}

export async function kycFile(kycId, kind) {
  const f = (await q('SELECT mime, data FROM kyc_files WHERE kyc_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1', [kycId, kind])).rows[0];
  if (!f) throw notFound();
  return f;
}

export async function listKyc(status = 'PENDING') {
  const r = await q(
    `SELECT k.*, u.phone, u.full_name, (SELECT array_agg(f.kind) FROM kyc_files f WHERE f.kyc_id=k.id) AS files
     FROM kyc k JOIN users u ON u.id=k.user_id WHERE k.status=$1 ORDER BY k.created_at`, [status]);
  return r.rows;
}

export async function decideKyc(staff, id, approve) {
  return tx(async (c) => {
    const k = (await c.query('SELECT * FROM kyc WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!k) throw notFound();
    if (k.status !== 'PENDING') throw conflict('Already decided.');
    const u = (await c.query('SELECT * FROM users WHERE id=$1', [k.user_id])).rows[0];
    if (approve && !namesMatch(k.name_on_id, u.full_name))
      throw bad('Name on ID does not match the account name.', 'NAME_MISMATCH');
    await c.query(`UPDATE kyc SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`,
      [id, approve ? 'APPROVED' : 'REJECTED', staff.id]);
    if (approve && u.tier < 1) await c.query('UPDATE users SET tier=1 WHERE id=$1', [u.id]);
    // Payment accounts added before the ID was approved get checked now.
    if (approve) {
      for (const pm of (await c.query('SELECT id, account_name FROM payment_methods WHERE user_id=$1 AND NOT verified', [u.id])).rows)
        if (namesMatch(k.name_on_id, pm.account_name)) await c.query('UPDATE payment_methods SET verified=true WHERE id=$1', [pm.id]);
    }
    return { id, status: approve ? 'APPROVED' : 'REJECTED' };
  });
}

// ---- Payment methods ----
export async function addPaymentMethod(user, { type, account_name, account_ref, bank_name }) {
  if (!['MONCASH', 'NATCASH', 'BANK'].includes(type)) throw bad('Type must be MONCASH, NATCASH or BANK.');
  if (!account_name || !account_ref) throw bad('Need account name and account number.');
  bank_name = type === 'BANK' ? String(bank_name || '').trim() : null;
  if (type === 'BANK' && (bank_name.length < 2 || bank_name.length > 40)) throw bad('Say which bank this account is in.');
  return tx(async (c) => {
    if (await isBlocked(c, 'PAY_ACCOUNT', account_ref)) throw forbidden('This payment account is blocked.');
    const k = (await c.query(
      `SELECT name_on_id FROM kyc WHERE user_id=$1 AND status='APPROVED' ORDER BY created_at DESC LIMIT 1`, [user.id])).rows[0];
    // Name on the payment account must match the ID. No match, not verified.
    const verified = !!k && namesMatch(k.name_on_id, account_name);
    try {
      const r = await c.query(
        `INSERT INTO payment_methods (user_id, type, account_name, account_ref, verified, bank_name)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [user.id, type, account_name.trim(), account_ref.trim(), verified, bank_name]);
      return r.rows[0];
    } catch (e) {
      if (e.code === '23505') throw conflict('This payment account is already used.', 'DUP_ACCOUNT');
      throw e;
    }
  });
}

export async function myPaymentMethods(userId) {
  return (await q('SELECT * FROM payment_methods WHERE user_id=$1 ORDER BY created_at', [userId])).rows;
}

export async function setPaymentVerified(id, verified) {
  const r = await q('UPDATE payment_methods SET verified=$2 WHERE id=$1 RETURNING *', [id, !!verified]);
  if (!r.rowCount) throw notFound();
  return r.rows[0];
}

// ---- Staff tools ----
export async function setBanned(userId, banned, reason) {
  return tx(async (c) => {
    const r = await c.query('UPDATE users SET banned=$2 WHERE id=$1 RETURNING *', [userId, !!banned]);
    if (!r.rowCount) throw notFound();
    if (banned) await banAndBlock(c, r.rows[0], reason || 'Banned by staff');
    return r.rows[0];
  });
}

export async function banAndBlock(c, user, reason) {
  await c.query('UPDATE users SET banned=true WHERE id=$1', [user.id]);
  await addBlock(c, 'PHONE', user.phone, reason);
  await addBlock(c, 'WALLET', user.wallet_addr, reason);
  const pms = await c.query('SELECT account_ref FROM payment_methods WHERE user_id=$1', [user.id]);
  for (const p of pms.rows) await addBlock(c, 'PAY_ACCOUNT', p.account_ref, reason);
}

// Where the person wants to receive crypto: a Binance UID (internal transfer, no network fee) and/or a wallet on a network.
export async function setPayout(user, { binance_uid, network, address }) {
  const uid = String(binance_uid ?? '').trim(), addr = String(address ?? '').trim();
  if (uid && !validBinanceUid(uid)) throw bad('Binance UID is a number with 6 to 12 digits. Find it in Binance under Profile.');
  if (addr || network) {
    if (!NETWORKS[network]) throw bad('Pick a network.');
    if (!validAddress(network, addr)) throw bad(`That is not a valid ${NETWORKS[network].label} address. Check it carefully.`);
  }
  if (!uid && !addr) throw bad('Add a Binance UID or a wallet address.');
  await q('UPDATE users SET binance_uid=$2, payout_network=$3, payout_addr=$4 WHERE id=$1', [user.id, uid || null, addr ? network : null, addr || null]);
  return { ok: true };
}

// The person closes their own account. Only when nothing is open and no crypto is left.
export async function closeAccount(user) {
  return tx(async (c) => {
    const open = (await c.query(`SELECT 1 FROM orders WHERE (buyer_id=$1 OR seller_id=$1) AND state IN ('ORDER_CREATED','AWAITING_PAYMENT','PAID_CLAIMED','DISPUTED','RELEASING','REFUNDING') LIMIT 1`, [user.id])).rowCount;
    if (open) throw conflict('You still have an open order. Finish it first.', 'OPEN_ORDER');
    if ((await c.query(`SELECT 1 FROM ads WHERE user_id=$1 AND status <> 'CLOSED' LIMIT 1`, [user.id])).rowCount) throw conflict('Close your ads first (My ads).', 'OPEN_AD');
    const bal = (await c.query('SELECT COALESCE(SUM(available + locked),0)::numeric AS b FROM wallet_balances WHERE user_id=$1', [user.id])).rows[0].b;
    if (Number(bal) > 0) throw conflict('Withdraw all your crypto first (Wallet).', 'BALANCE');
    await c.query(`UPDATE account_links SET status='ENDED' WHERE (owner_id=$1 OR member_id=$1) AND status <> 'ENDED'`, [user.id]);
    await c.query('UPDATE users SET closed_at=now() WHERE id=$1', [user.id]);
    return { ok: true };
  });
}
