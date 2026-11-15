import { buildApp } from './app.js';
import { config } from './config.js';
import { startWorker } from './worker.js';

if (!['MOCK', 'EVM'].includes(config.escrowMode)) {
  console.error('ESCROW_MODE must be MOCK or EVM.');
  process.exit(1);
}
if (config.escrowMode === 'EVM') {
  const { initEvm } = await import('./escrow-evm.js');
  try { await initEvm(); } catch (e) { console.error('EVM escrow check failed:', e.message); process.exit(1); }
  console.warn('EVM escrow is ON. The contract is UNAUDITED. Do not use real funds before an audit.');
}
if (config.tokenSecret === 'dev-only-secret') console.warn('Warning: using the dev TOKEN_SECRET. Start with npm start so a strong one is made.');

buildApp().listen(config.port, () => console.log(`Haiti P2P marketplace on http://localhost:${config.port} (${config.escrowMode} escrow)`));
startWorker();
