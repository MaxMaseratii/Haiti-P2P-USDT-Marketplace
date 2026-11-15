import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { geoGuard } from './auth.js';
import { HttpError } from './errors.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
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
