import crypto from 'node:crypto';
import { q } from '../db.js';
import { config, isMockSms } from '../config.js';
import { sendSms } from '../sms.js';
import { bad, HttpError } from '../errors.js';

const hash = (phone, code) =>
  crypto.createHmac('sha256', config.tokenSecret).update(`${phone}:${code}`).digest('hex');

const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Ask for a code. Limits: one per minute and a few per hour for each phone.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
export const isEmailCodes = () => config.smsProvider === 'email';
export const maskEmail = (e) => { const [u, d] = String(e).split('@'); return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + d; };

// In email mode a code goes to the account's email. A new person gives their email when they sign up.
export async function requestCode(phone, email) {
  let target = null;
  if (isEmailCodes()) {
    const u = (await q('SELECT email FROM users WHERE phone=$1', [phone])).rows[0];
    if (u && u.email) target = u.email;
    else {
      email = String(email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw bad(u ? 'Enter your email to get your code.' : 'Enter your email to get your code.', 'EMAIL');
      const used = (await q('SELECT 1 FROM users WHERE lower(email)=$1 AND phone<>$2', [email, phone])).rowCount;
      if (used) throw bad('This email is already used by another account.', 'EMAIL_USED');
      target = email;
    }
  }
  const recent = (await q(
    `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS hour,
            MAX(created_at) AS last FROM otp_codes WHERE phone=$1`, [phone])).rows[0];
  if (recent.last && Date.now() - new Date(recent.last).getTime() < config.otpResendSec * 1000)
    throw new HttpError(429, `Wait ${config.otpResendSec} seconds before asking for another code.`, 'OTP_WAIT');
  if (recent.hour >= config.otpMaxPerHour)
    throw new HttpError(429, 'Too many codes asked. Try again in an hour.', 'OTP_LIMIT');

  const code = isMockSms() ? '000000' : String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const id = (await q(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, email) VALUES ($1,$2, now() + make_interval(mins => $3), $4) RETURNING id`,
    [phone, hash(phone, code), config.otpTtlMin, target])).rows[0].id;
  try {
    if (target) await sendSms(phone, `Kòd Haiti P2P ou: ${code}\nYour Haiti P2P code: ${code}\n\nLi bon pou ${config.otpTtlMin} minit. Pa janm bay pèsonn li.\nIt works for ${config.otpTtlMin} minutes. Never share it with anyone.`, target);
    else await sendSms(phone, `Haiti P2P code: ${code}. It works for ${config.otpTtlMin} minutes. Never share it with anyone.`);
  } catch (e) {
    await q('DELETE FROM otp_codes WHERE id=$1', [id]); // a code that was never sent should not count
    console.error('code send failed:', e.message);
    throw new HttpError(502, target ? 'Could not send the email. Try again soon.' : 'Could not send the SMS. Try again soon.', 'SMS_FAILED');
  }
  return { sent: true, expires_in_min: config.otpTtlMin, ...(target ? { channel: 'email', to: maskEmail(target) } : {}) };
}

// Check a code. A code works once, expires, and dies after too many wrong tries.
const fails = new Map(); // phone -> [times of wrong codes]. Stops guessing.
function guard(phone) {
  const now = Date.now(), list = (fails.get(phone) || []).filter((t) => now - t < 15 * 60000);
  fails.set(phone, list);
  if (list.length >= 5) throw new HttpError(429, 'Too many wrong codes. Wait 15 minutes.', 'OTP_LOCK');
  return () => { list.push(now); };
}

// privileged = staff or owner phone. In test mode (mock SMS) they need ADMIN_LOGIN_CODE, not 000000,
// because 000000 is public and anyone could log in as the owner.
export async function verifyCode(phone, code, privileged = false) {
  if (!/^\d{6}$/.test(String(code || ''))) throw bad('The code is 6 digits.', 'OTP');
  if (isMockSms()) {
    const fail = guard(phone);
    if (privileged) {
      if (!/^\d{6}$/.test(config.adminLoginCode)) throw new HttpError(403, 'Owner login is locked. Set ADMIN_LOGIN_CODE (6 digits) on the server.', 'ADMIN_CODE_MISSING');
      if (!safeEq(code, config.adminLoginCode) || code === '000000') { fail(); throw bad('Wrong code.', 'OTP'); }
      return;
    }
    if (code !== '000000') { fail(); throw bad('Wrong code.', 'OTP'); }
    return;
  }
  const row = (await q(
    `SELECT * FROM otp_codes WHERE phone=$1 AND NOT used AND expires_at > now() AND attempts < $2
     ORDER BY created_at DESC LIMIT 1`, [phone, config.otpMaxTries])).rows[0];
  if (!row) throw bad('Code is wrong or expired. Ask for a new one.', 'OTP');
  if (!safeEq(row.code_hash, hash(phone, code))) {
    await q('UPDATE otp_codes SET attempts = attempts + 1 WHERE id=$1', [row.id]);
    throw bad('Wrong code.', 'OTP');
  }
  // Burn it. If two requests race with the same code, only one wins.
  const r = await q('UPDATE otp_codes SET used=true WHERE id=$1 AND NOT used', [row.id]);
  if (!r.rowCount) throw bad('Code is wrong or expired. Ask for a new one.', 'OTP');
  return { email: row.email || null };
}

// Simple per-IP limit for code requests (one server only. Use a shared store if you run many).
const hits = new Map();
export function ipLimit(req, _res, next) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  if (list.length >= 20) return next(new HttpError(429, 'Too many requests. Try again later.', 'IP_LIMIT'));
  list.push(now); hits.set(ip, list);
  next();
}
