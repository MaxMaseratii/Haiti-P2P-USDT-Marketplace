import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { geoGuard } from './auth.js';
import { HttpError } from './errors.js';
import { config } from './config.js';

// Simple per-IP limit for the whole API: 600 calls per 5 minutes (the app polls every few seconds).
const seen = new Map();
function apiLimit(req, _res, next) {
  const ip = req.ip || 'x', now = Date.now();
  let e = seen.get(ip);
  if (!e || now - e.t > 300000) { e = { t: now, n: 0 }; seen.set(ip, e); }
  if (++e.n > config.apiRateLimit) return next(new HttpError(429, 'Too many requests. Slow down a little.', 'RATE'));
  if (seen.size > 50000) seen.clear();
  next();
}

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render and other hosts sit behind one proxy: use the real visitor IP
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()', // camera: ID photo and video
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    // Owner tools may be shown inside the owner dashboard on maxmaserati.com (and nowhere else).
    if (req.path === '/owner.html' || req.path === '/owner.js') {
      res.removeHeader('X-Frame-Options');
      res.set('Content-Security-Policy', res.get('Content-Security-Policy').replace("frame-ancestors 'none'", "frame-ancestors 'self' https://www.maxmaserati.com https://maxmaserati.com"));
    }
    next();
  });
  // Let the admin dashboard on maxmaserati.com call the API. Logins still need the owner code.
  app.use('/api', (req, res, next) => {
    const o = req.headers.origin;
    if (o && config.adminOrigins.includes(o)) {
      res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Max-Age': '600' });
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });
  app.use('/api', apiLimit);
  app.use('/api/orders/:id/evidence/upload', express.json({ limit: '8mb' }));
  app.use('/api/me/posters', express.json({ limit: '1mb' })); // business posters (made smaller in the browser first)
  app.use('/api/kyc/file', express.raw({ type: () => true, limit: '26mb' })); // ID photos and video arrive as raw bytes
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', geoGuard, api);
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON.', code: 'JSON' });
    // Database rule broke (illegal move, check constraint, etc.). Not a crash, but never leak details.
    if (err?.code && /^(23|P0)/.test(err.code)) {
      console.error('db rule:', err.message);
      return res.status(409).json({ error: 'That action is not allowed right now.', code: 'DB_RULE' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.', code: 'SERVER' });
  });
  return app;
}
