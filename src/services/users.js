import { tx, q } from '../db.js';
import { bad, conflict, forbidden, notFound } from '../errors.js';
import { checkPhone } from '../auth.js';
import { isBlocked, screenUser, addBlock } from './screening.js';
import { namesMatch } from './names.js';
import { isMock, config } from '../config.js';
import * as evm from '../escrow-evm.js';

export async function signup({ phone, full_name }) {
  checkPhone(phone);
  if (!full_name || full_name.trim().length < 3) throw bad('Enter your full name as on your ID.', 'NAME');
  return tx(async (c) => {
    if (await isBlocked(c, 'PHONE', phone)) throw forbidden('This phone is blocked.');
    if (await isBlocked(c, 'NAME', full_name.trim().toLowerCase())) throw forbidden('This name is blocked.');
    const ex = await c.query('SELECT 1 FROM users WHERE phone=$1', [phone]);
    if (ex.rowCount) throw conflict('Phone already has an account.', 'EXISTS');
    // Owner phones (ADMIN_PHONES) become ADMIN with full limits. They still must prove the phone with the SMS code.
    const isAdmin = config.adminPhones.includes(phone);
    const r = await c.query('INSERT INTO users (phone, full_name, role, tier) VALUES ($1,$2,$3,$4) RETURNING *',
      [phone, full_name.trim(), isAdmin ? 'ADMIN' : 'USER', isAdmin ? 3 : 0]);
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
  display_name: u.display_name || null, bio: u.bio || null, has_avatar: !!u.avatar_mime,
});

const NO_CONTACT = /(https?:|www\.|@|\+?\d[\d\s().-]{6,}\d)/i;
export async function setProfile(user, { display_name, bio, avatar }) {
  const dn = String(display_name ?? '').trim(), b = String(bio ?? '').trim();
  if (dn && (dn.length < 2 || dn.length > 40)) throw bad('Public name must be 2 to 40 letters.');
  if (b.length > 160) throw bad('About text is too long (max 160).');
  if (NO_CONTACT.test(dn) || NO_CONTACT.test(b)) throw bad('No links, emails or phone numbers in your profile. Keep trades in the app.');
  let buf = null, mime = null;
  if (avatar) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(avatar));
    if (!m) throw bad('Photo must be a JPG, PNG or WEBP image.');
    buf = Buffer.from(m[2], 'base64'); mime = m[1];
    if (buf.length > 200 * 1024) throw bad('Photo is too big.');
  }
  if (avatar === null) await q('UPDATE users SET avatar=NULL, avatar_mime=NULL WHERE id=$1', [user.id]);
  else if (buf) await q('UPDATE users SET avatar=$2, avatar_mime=$3 WHERE id=$1', [user.id, buf, mime]);
  await q('UPDATE users SET display_name=$2, bio=$3 WHERE id=$1', [user.id, dn || null, b || null]);
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
export async function submitKyc(user, { name_on_id, id_doc_ref }) {
  if (!name_on_id || !id_doc_ref) throw bad('Need the name on your ID and a pointer to the ID photo.');
  return tx(async (c) => {
    await screenUser(c, user.id, name_on_id);
    const r = await c.query(
      `INSERT INTO kyc (user_id, name_on_id, id_doc_ref) VALUES ($1,$2,$3) RETURNING *`,
      [user.id, name_on_id.trim(), id_doc_ref]);
    return r.rows[0];
  });
}

export async function listKyc(status = 'PENDING') {
  const r = await q(
    `SELECT k.*, u.phone, u.full_name FROM kyc k JOIN users u ON u.id=k.user_id
     WHERE k.status=$1 ORDER BY k.created_at`, [status]);
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
