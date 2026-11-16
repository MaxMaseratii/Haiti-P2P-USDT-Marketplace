const num = (k, d) => (process.env[k] !== undefined ? Number(process.env[k]) : d);
const str = (k, d) => process.env[k] ?? d;

export const config = {
  port: num('PORT', 3000),
  databaseUrl: str('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/haiti_p2p'),
  tokenSecret: str('TOKEN_SECRET', 'dev-only-secret'),
  escrowMode: str('ESCROW_MODE', 'MOCK'),
  requireHaitiGeo: str('REQUIRE_HAITI_GEO', 'false') === 'true',
  countryHeader: str('COUNTRY_HEADER', 'cf-ipcountry').toLowerCase(),
  lockTimeoutMin: num('LOCK_TIMEOUT_MIN', 10),
  payWindowMin: num('PAY_WINDOW_MIN', 30),
  payGraceMin: num('PAY_GRACE_MIN', 10),
  sellerReplyMin: num('SELLER_REPLY_MIN', 30),
  evidenceHours: num('EVIDENCE_HOURS', 24),
  feeRate: str('FEE_RATE', '0.005'),
  dualAgentHtg: num('DUAL_AGENT_HTG', 50000),
  newSellerCapHtg: num('NEW_SELLER_CAP_HTG', 10000),
  workerIntervalSec: num('WORKER_INTERVAL_SEC', 15),
  sanctionsFile: str('SANCTIONS_FILE', 'data/sanctions.txt'),
  // mock = code 000000, nothing is sent. twilio = real SMS (set the TWILIO_* values).
  // With SMS_PROVIDER=mock, everybody's code is 000000. Staff and owner accounts must use this secret 6-digit code instead.
  apiRateLimit: num('API_RATE_LIMIT', 600),          // API calls per IP per 5 minutes
  // Websites allowed to call the API from a browser (your admin dashboard on maxmaserati.com).
  // Country phone codes we refuse (full sanctions): Cuba, Iran, North Korea, Syria.
  blockedCountryCodes: str('BLOCKED_COUNTRY_CODES', '53,98,850,963').split(',').map((x) => x.trim()).filter(Boolean),
  // Linked accounts (another registered person's MonCash/NatCash/bank): price per link every 30 days, and how many are free.
  linkFeeUsdt: str('LINK_FEE_USDT', '2.50'),
  linkFree: num('LINK_FREE', 0),
  // The public address of the app, used in SMS links. Render fills RENDER_EXTERNAL_URL by itself.
  publicUrl: str('PUBLIC_URL', process.env.RENDER_EXTERNAL_URL || ''),
  adminOrigins: str('ADMIN_ORIGINS', 'https://www.maxmaserati.com,https://maxmaserati.com').split(',').map((x) => x.trim()).filter(Boolean),
  adminLoginCode: str('ADMIN_LOGIN_CODE', ''),
  smsProvider: str('SMS_PROVIDER', 'mock'),           // mock | twilio | email (codes by email through Brevo, free up to 300 a day)
  brevoKey: str('BREVO_API_KEY', ''),
  mailFrom: str('MAIL_FROM', ''),                      // a sender email verified in Brevo
  mailFromName: str('MAIL_FROM_NAME', 'Haiti P2P'),
  twilioSid: str('TWILIO_ACCOUNT_SID', ''),
  twilioToken: str('TWILIO_AUTH_TOKEN', ''),
  twilioFrom: str('TWILIO_FROM', ''),
  twilioMessagingService: str('TWILIO_MESSAGING_SERVICE_SID', ''),
  otpTtlMin: num('OTP_TTL_MIN', 10),
  otpResendSec: num('OTP_RESEND_SEC', 60),
  otpMaxPerHour: num('OTP_MAX_PER_HOUR', 5),
  otpMaxTries: num('OTP_MAX_TRIES', 5),
  // ESCROW_MODE=EVM (smart contract). Needs all of these. Use a chain where USDT/USDC have 6 decimals.
  evmRpcUrl: str('EVM_RPC_URL', ''),
  evmChainId: num('EVM_CHAIN_ID', 0),
  evmContract: str('EVM_ESCROW_ADDRESS', ''),
  evmStartBlock: num('EVM_START_BLOCK', 0),
  evmConfirmations: num('EVM_CONFIRMATIONS', 3),     // blocks to wait before a deposit counts
  operatorKey: str('OPERATOR_PRIVATE_KEY', ''),      // app key: reserve, lock, cancel unpaid orders
  arbiterKey: str('ARBITER_PRIVATE_KEY', ''),        // optional. Better: keep it off the server (see README)
  tokenUsdt: str('TOKEN_USDT', ''),
  tokenUsdc: str('TOKEN_USDC', ''),
  escrowNetwork: str('ESCROW_NETWORK', 'ARBITRUM'),
  lockFee: str('LOCK_FEE_USDT', '0.25'),               // flat fee the BUYER pays per order (covers the lock/unlock network cost), in USDT/USDC
  withdrawFee: str('WITHDRAW_FEE_USDT', '1'),           // flat fee for a gasless withdraw (the app pays the gas), in USDT/USDC   // the network the escrow runs on (shown to users)
  pgSsl: str('PGSSL', '') === 'true',                // true for hosted databases that need SSL
  adminPhones: str('ADMIN_PHONES', '').split(',').map((x) => x.trim()).filter(Boolean), // these phones become ADMIN when they sign up
  demoSeed: str('DEMO_SEED', '') === 'true',          // MOCK only: fill the market with example sellers
  uploadDir: str('UPLOAD_DIR', 'uploads'),
  maxUploadBytes: num('MAX_UPLOAD_BYTES', 4 * 1024 * 1024),
  platformUserId: '00000000-0000-0000-0000-000000000001',
};

export const isMock = () => config.escrowMode === 'MOCK';
export const isMockEscrow = isMock;
export const isMockSms = () => config.smsProvider === 'mock';
