import { buildApp } from './app.js';
import { config } from './config.js';
import { startWorker } from './worker.js';

if (config.escrowMode !== 'MOCK') {
  console.error('ESCROW_MODE is not MOCK, but no live escrow adapter exists yet. See README "Going live".');
  process.exit(1);
}
if (config.tokenSecret === 'dev-only-secret') console.warn('Warning: using the dev TOKEN_SECRET. Set TOKEN_SECRET in .env.');

buildApp().listen(config.port, () => console.log(`Haiti P2P marketplace on http://localhost:${config.port} (MOCK money)`));
startWorker();
