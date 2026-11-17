// Passwords: people can log in with phone/email + password (the email code still works, and resets a forgotten password).
// Stored as scrypt hashes, never as text. 5 wrong tries = 15 minutes locked.
import crypto from 'node:crypto';
import { q } from '../db.js';
import { bad, HttpError } from '../errors.js';
import { makeToken } from '../auth.js';

const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? no(e) : ok(k))));
export function check(pw) {
  pw = String(pw || '');
  if (pw.length < 8) throw bad('Password must have at least 8 characters.', 'PW_SHORT');
  if (pw.length > 128) throw bad('Password is too long.', 'PW_LONG');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw bad('Use letters and numbers in your password.', 'PW_WEAK');
  return pw;
}
export async function hash(pw) {
  const salt = crypto.randomBytes(16);
  return 'scrypt$' + salt.toString('base64') + '$' + (await scrypt(check(pw), salt)).toString('base64');
}
async function same(pw, stored) {
  const [kind, s, h] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !s || !h) return false;
  const a = await scrypt(String(pw || ''), Buffer.from(s, 'base64')), b = Buffer.from(h, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// A new password logs out every other phone and browser (their old logins stop working).
export async function set(userId, pw) {
  await q('UPDATE users SET pw_hash=$2, pw_fails=0, pw_locked_until=NULL, tokens_after=$3 WHERE id=$1', [userId, await hash(pw), new Date()]);
}
export async function login(u, pw) {
  if (!u.pw_hash) throw new HttpError(400, 'This account has no password yet. Log in with a code, then add a password in your Profile.', 'NO_PASSWORD');
  if (u.pw_locked_until && new Date(u.pw_locked_until) > new Date()) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes, or log in with a code.', 'PW_LOCKED');
  if (!(await same(pw, u.pw_hash))) {
    await q(`UPDATE users SET pw_locked_until = CASE WHEN pw_fails+1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
             pw_fails = CASE WHEN pw_fails+1 >= 5 THEN 0 ELSE pw_fails+1 END WHERE id=$1`, [u.id]);
    throw new HttpError(401, 'Wrong password.', 'PW_WRONG');
  }
  if (u.pw_fails) await q('UPDATE users SET pw_fails=0 WHERE id=$1', [u.id]);
}
export async function change(u, { password, current }) {
  if (u.pw_hash && !(await same(current, u.pw_hash))) throw new HttpError(401, 'Your current password is not right.', 'PW_WRONG');
  await set(u.id, password);
  return { ok: true, token: makeToken(u.id) }; // this browser stays logged in
}
