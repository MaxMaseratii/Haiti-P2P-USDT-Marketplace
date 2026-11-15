import crypto from 'node:crypto';
import { isMock } from './config.js';

// The escrow adapter is the only place that talks to the chain.
// Each call must be safe to repeat for the same order id (the timer worker retries).
//
// MOCK: fake hashes, instant "confirmation". Money lives in the wallet_balances table.
// LIVE: not built. Replace with a smart-contract adapter (lock / release / refund keyed by
//       order id), then get an outside audit before any real USDT moves. See README.
const fakeHash = (kind, orderId) =>
  '0xmock' + crypto.createHash('sha256').update(kind + orderId).digest('hex').slice(0, 58);

const mock = {
  async lock(order) { return { txHash: fakeHash('lock', order.id) }; },
  async release(order) { return { txHash: fakeHash('release', order.id) }; },
  async refund(order) { return { txHash: fakeHash('refund', order.id) }; },
};

const live = {
  async lock() { throw new Error('No live escrow adapter. Set ESCROW_MODE=MOCK or build one in src/escrow.js.'); },
  async release() { throw new Error('No live escrow adapter.'); },
  async refund() { throw new Error('No live escrow adapter.'); },
};

export const escrow = {
  lock: (o) => (isMock() ? mock : live).lock(o),
  release: (o) => (isMock() ? mock : live).release(o),
  refund: (o) => (isMock() ? mock : live).refund(o),
};
