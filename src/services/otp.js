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
export async function requestCode(phone) {
  const recent = (await q(
    `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS hour,
            MAX(created_at) AS last FROM otp_codes WHERE phone=$1`, [phone])).rows[0];
  if (recent.last && Date.now() - new Date(recent.last).getTime() < config.otpResendSec * 1000)
    throw new HttpError(429, `Wait ${config.otpResendSec} seconds before asking for another code.`, 'OTP_WAIT');
  if (recent.hour >= config.otpMaxPerHour)
    throw new HttpError(429, 'Too many codes asked. Try again in an hour.', 'OTP_LIMIT');

  const code = isMockSms() ? '000000' : String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const id = (await q(
    `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1,$2, now() + make_interval(mins => $3)) RETURNING id`,
    [phone, hash(phone, code), config.otpTtlMin])).rows[0].id;
  try {
    await sendSms(phone, `Haiti P2P code: ${code}. It works for ${config.otpTtlMin} minutes. Never share it with anyone.`);
  } catch (e) {
    await q('DELETE FROM otp_codes WHERE id=$1', [id]); // a code that was never sent should not count
    console.error('sms failed:', e.message);
    throw new HttpError(502, 'Could not send the SMS. Try again soon.', 'SMS_FAILED');
  }
  return { sent: true, expires_in_min: config.otpTtlMin };
}

// Check a code. A code works once, expires, and dies after too many wrong tries.
export async function verifyCode(phone, code) {
  if (!/^\d{6}$/.test(String(code || ''))) throw bad('The code is 6 digits.', 'OTP');
  if (isMockSms()) { // dev only: no SMS is sent, the code is always 000000
    if (code !== '000000') throw bad('Wrong code.', 'OTP');
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
