// Crypto networks people can choose when they say where to receive USDT/USDC.
// Only the network the escrow contract runs on can be paid out automatically. The others are saved for staff payouts.
export const NETWORKS = {
  TRON: { label: 'Tron (TRC20)', kind: 'tron', fee: 'Low fee, very popular for USDT' },
  ARBITRUM: { label: 'Arbitrum One', kind: 'evm', fee: 'Very low fee, fast' },
  BSC: { label: 'BNB Chain (BEP20)', kind: 'evm', fee: 'Low fee' },
  POLYGON: { label: 'Polygon', kind: 'evm', fee: 'Very low fee' },
  ETHEREUM: { label: 'Ethereum (ERC20)', kind: 'evm', fee: 'High fee. Use only if you must' },
};
const RX = { evm: /^0x[0-9a-fA-F]{40}$/, tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ };
export const validAddress = (network, addr) => !!NETWORKS[network] && RX[NETWORKS[network].kind].test(String(addr || '').trim());
export const validBinanceUid = (uid) => /^\d{6,12}$/.test(String(uid || '').trim());
