import crypto from 'node:crypto';
import { config } from './config.js';
import { q } from './db.js';
import { unauth, forbidden, bad, HttpError } from './errors.js';

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', config.tokenSecret).update(data).digest('base64url');

export function makeToken(userId, days = 7) {
  const now = Date.now();
  const body = b64(JSON.stringify({ uid: userId, iat: now, exp: now + days * 864e5 }));
  return `${body}.${sign(body)}`;
}

export function readToken(tok) {
  if (!tok) return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  return data && data.exp > Date.now() ? data : null;
}

// Haiti-only. Phone must be +509 and 8 digits.
// Any country can sign up (family abroad send to Haiti). Phone in world format: + country code + number.
// Countries under full sanctions are refused (list in BLOCKED_COUNTRY_CODES).
export function checkPhone(phone) {
  phone = String(phone || '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw bad('Write your phone with the country code, like +50937001234 or +13055551234.', 'PHONE');
  if (phone.startsWith('+509') && !/^\+509\d{8}$/.test(phone)) throw bad('A Haiti number is +509 and 8 digits.', 'PHONE');
  if (config.blockedCountryCodes.some((cc) => phone.startsWith('+' + cc))) throw forbidden('Sorry, we cannot serve this country.', 'COUNTRY');
}

// Haiti-only by network. Needs a CDN header such as Cloudflare's CF-IPCountry.
export function geoGuard(req, _res, next) {
  if (!config.requireHaitiGeo) return next();
  const c = String(req.headers[config.countryHeader] || '').toUpperCase();
  if (c !== 'HT') return next(new HttpError(403, 'This service is for Haiti only.', 'GEO'));
  next();
}

export async function auth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const data = readToken(h.startsWith('Bearer ') ? h.slice(7) : null);
    if (!data) throw unauth();
    const r = await q('SELECT * FROM users WHERE id=$1', [data.uid]);
    const u = r.rows[0];
    if (!u) throw unauth();
    // After a password change or reset, older logins (other phones, a stolen token) stop working.
    if (u.tokens_after && !(Number(data.iat) >= new Date(u.tokens_after).getTime())) throw unauth();
    if (u.closed_at) throw forbidden('This account is closed.', 'CLOSED');
    if (u.banned) throw forbidden('Account is frozen or banned.');
    if (u.suspended_until && new Date(u.suspended_until) > new Date()) throw forbidden('Account is suspended until ' + new Date(u.suspended_until).toISOString().slice(0, 10) + '.');
    req.user = u;
    next();
  } catch (e) { next(e); }
}

export const needRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden('Staff only.'));
