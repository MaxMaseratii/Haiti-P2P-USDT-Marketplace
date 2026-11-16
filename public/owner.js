/* Owner tools: deploy the lock contract with your own browser wallet, fund the app wallet,
   take out fees, decide disputes on-chain, pause. Uses ethers v6 (vendor/ethers-6.umd.min.js). */
(() => {
  const NETS = {
    test: { name: 'Arbitrum Sepolia', id: 421614, hex: '0x66eee', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io',
      usdt: null /* a test USDT is made for you */, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
    real: { name: 'Arbitrum One', id: 42161, hex: '0xa4b1', rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io',
      usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' /* USD₮0 */, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' /* native USDC */ },
  };
  const ESC_ABI = ['function owner() view returns (address)', 'function operator() view returns (address)', 'function arbiter() view returns (address)',
    'function feeRecipient() view returns (address)', 'function paused() view returns (bool)', 'function available(address,address) view returns (uint256)',
    'function withdraw(address token, uint256 amount)', 'function release(bytes32 orderId)', 'function refund(bytes32 orderId, bool toReserved)',
    'function setPaused(bool p)', 'function orders(bytes32) view returns (address token, address seller, address buyer, uint128 amount, uint128 fee, uint64 lockedAt, bool claimed, uint8 status)'];
  const $ = (id) => document.getElementById(id);
  const say = (id, msg, cls = '') => { const e = $(id); e.textContent = msg; e.className = 'log ' + cls; };
  const errText = (e) => e?.shortMessage || e?.info?.error?.message || e?.reason || e?.message || String(e);
  const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } } };

  let net = 'test', provider = null, signer = null, me = null, op = null, deployed = store.get('hp2p-deployed'), C = null;

  async function contracts() { if (!C) C = await (await fetch('owner/contracts.json')).json(); return C; }
  async function connect() {
    if (!window.ethereum) throw new Error('No wallet found in this browser. Install MetaMask or Rabby, then reload this page.');
    const N = NETS[net];
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    const cur = String(await window.ethereum.request({ method: 'eth_chainId' })).toLowerCase();
    if (cur !== N.hex) {
      try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: N.hex }] }); }
      catch (e) {
        if (e.code === 4902 || /unrecognized|not added|unknown chain/i.test(e.message || '')) {
          await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: N.hex, chainName: N.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [N.rpc], blockExplorerUrls: [N.explorer] }] });
        } else throw e;
      }
    }
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    me = await signer.getAddress();
    const bal = await provider.getBalance(me);
    say('who', `Connected: ${me}\nNetwork: ${N.name}\nETH: ${Number(ethers.formatEther(bal)).toFixed(5)}` + (bal === 0n ? (net === 'test' ? '\nYou need free test ETH: search "Arbitrum Sepolia faucet".' : '\nYou need a little ETH on Arbitrum One.') : ''), 'ok');
    if (!$('fee').value) $('fee').value = me;
    if (!$('arb').value) $('arb').value = me;
    return N;
  }
  const act = (btn, fn, logId) => $(btn).addEventListener('click', async () => {
    const b = $(btn); b.disabled = true;
    try { await fn(); } catch (e) { if (logId) say(logId, errText(e), 'err'); else alertBox(errText(e)); } finally { b.disabled = false; }
  });
  function alertBox(m) { say('who', m, 'err'); }
  const addr = (v, what) => { try { return ethers.getAddress(String(v || '').trim()); } catch { throw new Error(what + ' is not a valid address.'); } };

  // 1. network
  $('netSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    net = b.dataset.net; [...$('netSeg').children].forEach((x) => x.classList.toggle('on', x === b));
    $('deployNote').textContent = net === 'test' ? 'Practice: we also make a test USDT for you (and send you 1,000). It costs only free test ETH.' : 'Real money. Your wallet asks you to confirm. It costs a few cents of ETH.';
    provider = signer = me = null; say('who', 'Network changed. Connect again.');
  });
  $('deployNote').textContent = 'Practice: we also make a test USDT for you (and send you 1,000). It costs only free test ETH.';

  // 2. connect
  act('connect', connect, 'who');

  // 3. app wallet
  $('mkop').addEventListener('click', () => {
    op = ethers.Wallet.createRandom();
    $('opBox').classList.remove('hidden'); $('opAddr').textContent = op.address; $('opKey').textContent = '••••••••••••••••••••••••'; renderEnv();
  });
  $('showKey').addEventListener('click', () => { if (op) $('opKey').textContent = op.privateKey; });
  $('copyKey').addEventListener('click', async () => { if (op) { await navigator.clipboard.writeText(op.privateKey); $('copyKey').textContent = 'Copied'; setTimeout(() => { $('copyKey').textContent = 'Copy'; }, 1500); } });

  // 4. deploy
  act('deploy', async () => {
    const N = await connect();
    if (!op) throw new Error('Make the app wallet first (step 3).');
    const fee = addr($('fee').value, 'Fee wallet'), arb = addr($('arb').value, 'Dispute judge');
    const k = await contracts();
    say('deployLog', 'Confirm in your wallet…');
    const f = new ethers.ContractFactory(k.P2PEscrow.abi, k.P2PEscrow.bytecode, signer);
    const c = await f.deploy(op.address, arb, fee);
    say('deployLog', 'Sent. Waiting for the network… ' + c.deploymentTransaction().hash);
    const rc = await c.deploymentTransaction().wait();
    const address = await c.getAddress();
    let usdt = N.usdt;
    if (net === 'test') {
      say('deployLog', 'Contract is live. Now making a test USDT. Confirm in your wallet…');
      const t = await new ethers.ContractFactory(k.MockToken.abi, k.MockToken.bytecode, signer).deploy('Test USDT');
      await t.deploymentTransaction().wait();
      usdt = await t.getAddress();
      say('deployLog', 'Sending you 1,000 test USDT. Confirm in your wallet…');
      await (await t.mint(me, 1000n * 10n ** 6n)).wait();
    }
    deployed = { net, address, block: rc.blockNumber, usdt, usdc: N.usdc, chainId: N.id, at: new Date().toISOString() };
    store.set('hp2p-deployed', deployed);
    $('cAddr').value = address;
    say('deployLog', `Done.\nContract: ${address}\nBlock: ${rc.blockNumber}\nSee it: ${N.explorer}/address/${address}` + (net === 'test' ? `\nTest USDT: ${usdt}` : ''), 'ok');
    renderEnv();
  }, 'deployLog');

  // 5. fund the app wallet
  act('fund', async () => {
    await connect();
    if (!op) throw new Error('Make the app wallet first (step 3). If you already did and reloaded, send ETH to it from your wallet app.');
    const v = ethers.parseEther(String($('ethAmt').value || '0'));
    if (v <= 0n) throw new Error('Write an amount of ETH.');
    say('fundLog', 'Confirm in your wallet…');
    const tx = await signer.sendTransaction({ to: op.address, value: v });
    await tx.wait();
    say('fundLog', `Sent ${$('ethAmt').value} ETH to ${op.address}.`, 'ok');
  }, 'fundLog');

  // 6. env lines
  function renderEnv() {
    if (!deployed) { $('env').textContent = 'Deploy first (step 4).'; return; }
    const N = NETS[deployed.net];
    const lines = [
      'ESCROW_MODE=EVM', 'ESCROW_NETWORK=ARBITRUM', `EVM_RPC_URL=${N.rpc}`, `EVM_CHAIN_ID=${deployed.chainId}`, `EVM_ESCROW_ADDRESS=${deployed.address}`,
      `EVM_START_BLOCK=${deployed.block}`, 'EVM_CONFIRMATIONS=40', `TOKEN_USDT=${deployed.usdt}`, `TOKEN_USDC=${deployed.usdc}`,
      `OPERATOR_PRIVATE_KEY=${op ? op.privateKey : '(the app wallet secret key from step 3)'}`, 'WITHDRAW_FEE_USDT=1', 'DEMO_SEED=false',
    ];
    $('env').textContent = lines.join('\n');
  }
  $('copyEnv').addEventListener('click', async () => { await navigator.clipboard.writeText($('env').textContent); $('copyEnv').textContent = 'Copied'; setTimeout(() => { $('copyEnv').textContent = 'Copy all'; }, 1500); });

  // ---- after launch ----
  const esc = async () => { await connect(); return new ethers.Contract(addr($('cAddr').value, 'Contract address'), ESC_ABI, signer); };
  const tokensFor = () => (deployed && deployed.address.toLowerCase() === String($('cAddr').value).trim().toLowerCase())
    ? { USDT: deployed.usdt, USDC: deployed.usdc } : { USDT: NETS[net].usdt, USDC: NETS[net].usdc };
  act('readC', async () => {
    const c = await esc(); const t = tokensFor();
    const [owner, operator, arbiter, fee, paused] = await Promise.all([c.owner(), c.operator(), c.arbiter(), c.feeRecipient(), c.paused()]);
    const fu = t.USDT ? await c.available(t.USDT, fee) : 0n, fc = t.USDC ? await c.available(t.USDC, fee) : 0n;
    const opEth = await provider.getBalance(operator);
    say('cInfo', `Owner: ${owner}\nApp wallet: ${operator}  (ETH ${Number(ethers.formatEther(opEth)).toFixed(5)}${opEth < ethers.parseEther('0.0005') ? ' — LOW, top it up' : ''})\nDispute judge: ${arbiter}\nFee wallet: ${fee}\nFees waiting: ${ethers.formatUnits(fu, 6)} USDT · ${ethers.formatUnits(fc, 6)} USDC\nPaused: ${paused ? 'YES' : 'no'}`, 'ok');
  }, 'cInfo');
  const takeFees = (asset) => async () => {
    const c = await esc(); const tk = tokensFor()[asset];
    if (!tk) throw new Error('No ' + asset + ' on this network.');
    const fee = await c.feeRecipient();
    if (fee.toLowerCase() !== me.toLowerCase()) throw new Error('Connect the fee wallet (' + fee + ') to take out fees.');
    const amt = await c.available(tk, me);
    if (amt === 0n) { say('feeLog', 'No ' + asset + ' fees waiting yet.'); return; }
    say('feeLog', `Withdrawing ${ethers.formatUnits(amt, 6)} ${asset}. Confirm in your wallet…`);
    await (await c.withdraw(tk, amt)).wait();
    say('feeLog', `Done. ${ethers.formatUnits(amt, 6)} ${asset} is in your fee wallet.`, 'ok');
  };
  act('feesUsdt', takeFees('USDT'), 'feeLog');
  act('feesUsdc', takeFees('USDC'), 'feeLog');
  const decide = (toBuyer) => async () => {
    const c = await esc(); const id = String($('ordId').value || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Paste the full order number (36 characters).');
    const oid = ethers.id(id); const o = await c.orders(oid);
    if (o.status !== 1n) throw new Error('This order is not locked on-chain (status ' + o.status + ').');
    if ((await c.arbiter()).toLowerCase() !== me.toLowerCase()) throw new Error('Connect the dispute judge wallet.');
    say('ordLog', `${toBuyer ? 'Unlocking to the buyer' : 'Returning to the seller'}: ${ethers.formatUnits(o.amount, 6)}. Confirm in your wallet…`);
    await (await (toBuyer ? c.release(oid) : c.refund(oid, false))).wait();
    say('ordLog', 'Done. The app sees it within a minute and closes the order.', 'ok');
  };
  act('relBuyer', decide(true), 'ordLog');
  act('refSeller', decide(false), 'ordLog');
  const pause = (p) => async () => { const c = await esc(); say('pauseLog', 'Confirm in your wallet…'); await (await c.setPaused(p)).wait(); say('pauseLog', p ? 'Paused.' : 'Running again.', 'ok'); };
  act('pause', pause(true), 'pauseLog');
  act('unpause', pause(false), 'pauseLog');

  if (deployed) { $('cAddr').value = deployed.address; net = deployed.net; [...$('netSeg').children].forEach((x) => x.classList.toggle('on', x.dataset.net === net)); renderEnv(); }
})();
