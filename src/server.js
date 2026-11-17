import { buildApp } from './app.js';
import { config } from './config.js';
import { startWorker } from './worker.js';

if (!['MOCK', 'EVM'].includes(config.escrowMode)) {
  console.error('ESCROW_MODE must be EVM.');
  process.exit(1);
}
// Fake money (MOCK) is only for the automated tests and a laptop. A public server must run real money.
if (config.escrowMode === 'MOCK' && process.env.ALLOW_TEST_MODE !== 'true') {
  console.error('ESCROW_MODE=MOCK (fake money) is turned off. Set ESCROW_MODE=EVM and the lines from /owner.html. (On a laptop only: ALLOW_TEST_MODE=true.)');
  process.exit(1);
}
// Real money must never run with fake SMS codes or demo data. Test networks are allowed (for a practice run).
const TESTNETS = new Set([421614, 11155111, 84532, 80002, 1337, 31337]);
if (config.escrowMode === 'EVM' && !TESTNETS.has(config.evmChainId)) {
  const stop = [];
  if (config.smsProvider === 'mock') stop.push("SMS_PROVIDER is mock (everyone's code is 000000). Set SMS_PROVIDER=email (BREVO_API_KEY, MAIL_FROM) or SMS_PROVIDER=twilio (TWILIO_* values).");
  if (config.smsProvider === 'email' && (!config.brevoKey || !config.mailFrom)) stop.push('Email codes need BREVO_API_KEY and MAIL_FROM (a sender email verified in Brevo).');
  if (config.smsProvider === 'twilio' && (!config.twilioSid || !config.twilioToken || !(config.twilioFrom || config.twilioMessagingService)))
    stop.push('Twilio values are missing: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID).');
  if (stop.length) { console.error('Real money mode will not start until you fix this:\n - ' + stop.join('\n - ')); process.exit(1); }
}
if (config.escrowMode === 'EVM') {
  const { initEvm } = await import('./escrow-evm.js');
  try { await initEvm(); } catch (e) { console.error('EVM escrow check failed:', e.message); process.exit(1); }
  console.warn('EVM escrow is ON. The contract is UNAUDITED. Do not use real funds before an audit.');
}
if (config.tokenSecret === 'dev-only-secret') console.warn('Warning: using the dev TOKEN_SECRET. Start with npm start so a strong one is made.');

buildApp().listen(config.port, () => console.log(`Ayiti P2P marketplace on http://localhost:${config.port} (${config.escrowMode} escrow)`));
startWorker();
