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
  platformUserId: '00000000-0000-0000-0000-000000000001',
};

export const isMock = () => config.escrowMode === 'MOCK';
