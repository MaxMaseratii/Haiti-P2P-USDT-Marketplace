import crypto from 'node:crypto';
import { isMock } from './config.js';
import * as evm from './escrow-evm.js';

// The escrow adapter is the only place that talks to the chain.
// Each call must be safe to repeat for the same order id (the timer worker retries).
//
// MOCK: fake hashes, instant "confirmation". Money lives in the wallet_balances table.
// EVM:  contracts/src/P2PEscrow.sol through src/escrow-evm.js. UNAUDITED. Get an outside audit
//       before any real USDT moves. See README.
const fakeHash = (kind, orderId) =>
  '0xmock' + crypto.createHash('sha256').update(kind + orderId).digest('hex').slice(0, 58);

const mock = {
  async lock(order) { return { txHash: fakeHash('lock', order.id) }; },
  async release(order) { return { txHash: fakeHash('release', order.id) }; },
  async refund(order) { return { txHash: fakeHash('refund', order.id) }; },
};

// Chooses the adapter by ESCROW_MODE: MOCK (fake, DB only) or EVM (smart contract, src/escrow-evm.js).
const impl = () => (isMock() ? mock : evm.adapter);

export const escrow = {
  lock: (o) => impl().lock(o),
  release: (o) => impl().release(o),
  refund: (o) => impl().refund(o),
  // The rest only matter on a real chain. In MOCK they do nothing.
  claimed: (o) => impl().claimed?.(o),
  syncReserve: (userId, asset) => impl().syncReserve?.(userId, asset),
  tick: () => impl().tick?.(),
};
