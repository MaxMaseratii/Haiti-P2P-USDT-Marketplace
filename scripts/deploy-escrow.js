// Deploy contracts/src/P2PEscrow.sol. Build it first:  cd contracts && npm install && npm run build
//   DEPLOYER_PRIVATE_KEY=0x... EVM_RPC_URL=https://... \
//   OPERATOR_ADDRESS=0x... ARBITER_ADDRESS=0x... FEE_RECIPIENT=0x... node scripts/deploy-escrow.js
// ARBITER_ADDRESS should be a multisig (for example a Safe, 2 of 3, different people).
// The deployer becomes the owner (can pause and change roles). Move ownership to a multisig too.
import fs from 'node:fs';
import { ethers } from 'ethers';

const need = (k) => { if (!process.env[k]) { console.error('Missing ' + k); process.exit(1); } return process.env[k]; };
const built = new URL('../contracts/build/contracts.json', import.meta.url);
if (!fs.existsSync(built)) { console.error('Build first: cd contracts && npm install && npm run build'); process.exit(1); }
const { P2PEscrow } = JSON.parse(fs.readFileSync(built, 'utf8'));

const provider = new ethers.JsonRpcProvider(need('EVM_RPC_URL'));
const wallet = new ethers.Wallet(need('DEPLOYER_PRIVATE_KEY'), provider);
const [operator, arbiter, fee] = ['OPERATOR_ADDRESS', 'ARBITER_ADDRESS', 'FEE_RECIPIENT'].map((k) => ethers.getAddress(need(k)));
const net = await provider.getNetwork();
console.log(`Deploying to chain ${net.chainId} from ${wallet.address}`);
const c = await new ethers.ContractFactory(P2PEscrow.abi, P2PEscrow.bytecode, wallet).deploy(operator, arbiter, fee);
await c.waitForDeployment();
const receipt = await c.deploymentTransaction().wait();
console.log('\nDeployed. Put this in .env:');
console.log(`EVM_CHAIN_ID=${net.chainId}\nEVM_ESCROW_ADDRESS=${await c.getAddress()}\nEVM_START_BLOCK=${receipt.blockNumber}`);
provider.destroy();
