/* The logged-in dashboard: like a bank app. One page with everything (balance, quick actions, orders, ads, security),
   and one simple page for each action: Depo, Resevwa, Retrè, Anons, extra accounts.
   Text is written in English here; i18n-app.js shows it in Kreyòl or French. Uses the helpers from app.js. */

const FINAL = ['COMPLETED', 'REFUNDED', 'CANCELLED_TIMEOUT'];
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
const hideBal = () => { try { return localStorage.getItem('hideBal') === '1'; } catch { return false; } };
const balOf = (asset) => me.wallet.find((w) => w.asset === asset) || { available: '0', locked: '0' };

async function copyText(v) {
  try { await navigator.clipboard.writeText(v); } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = v; document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove();
  }
  toast(t('Copied.'));
}
const copyBtn = (v) => h('button', { type: 'button', class: 'cbtn', title: t('Copy'), 'aria-label': t('Copy'), onclick: () => copyText(v) }, icon('copy'));
const backHome = () => h('button', { type: 'button', class: 'btn alt sm', onclick: () => go('home') }, icon('arrow-l'), h('span', {}, 'Dashboard'));
const dcard = (title, sub, right, ...body) => h('div', { class: 'card dcard' },
  h('div', { class: 'dch' }, h('div', {}, h('h2', {}, title), sub ? h('p', {}, sub) : null), right || null), ...body);
const empty = (ic, text, ...btns) => h('div', { class: 'dempty' }, icon(ic), h('p', {}, text), btns.length ? h('div', { class: 'gactions' }, ...btns) : null);
const tokenMark = (asset) => asset === 'USDT' ? h('span', { class: 'dtok' }, h('img', { src: 'img/brand/usdt.png', alt: '' })) : h('span', { class: 'dtok c' }, asset);

// One order line: what, when, how much, where it stands.
function orderLine(o) {
  const buy = o.buyer_id === me.user.id, role = buy ? 'BUYER' : 'SELLER';
  const turn = MY_TURN[role] && MY_TURN[role][o.state] && MY_TURN[role][o.state].startsWith('Your');
  return h('button', { type: 'button', class: 'oline' + (turn ? ' turn' : ''), onclick: () => go('order/' + o.id) },
    h('span', { class: 'oic ' + (buy ? 'in' : 'out') }, icon(buy ? 'arrow-d' : 'arrow-u')),
    h('span', { class: 'om' }, h('b', {}, h('span', {}, buy ? 'Bought' : 'Sold'), ' ' + usd2(o.amount) + ' ' + o.asset),
      h('small', {}, new Date(o.created_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · #' + String(o.id).slice(0, 6).toUpperCase())),
    h('span', { class: 'oa' }, h('b', {}, money(o.total_htg, 0) + ' HTG'), statePill(o.state, role)));
}

// ---------- the dashboard ----------
async function accountHome(app) {
  const u = me.user, first = (u.display_name || u.full_name).split(' ')[0];
  const [orders, sells, buys, myAds, links, check] = await Promise.all([api('GET', '/orders').catch(() => []), api('GET', '/ads?side=SELL').catch(() => []),
    api('GET', '/ads?side=BUY').catch(() => []), api('GET', '/my/ads').catch(() => []), api('GET', '/links').catch(() => ({ mine: [] })), toCheckCard()]);
  const bestSell = sells.length ? Number(sells[0].price_htg) : null, bestBuy = buys.length ? Number(buys[0].price_htg) : null;
  const sum = (k) => me.wallet.reduce((a, w) => a + Number(w[k] || 0), 0);
  const avail = sum('available'), locked = sum('locked'), total = avail + locked;
  const hide = hideBal(), mask = (txt) => (hide ? '•••••' : txt);
  const usdt = balOf('USDT'), usdc = balOf('USDC');

  // Balance card, like a bank card.
  const bal = h('div', { class: 'card dbal' },
    h('div', { class: 'dbal-top' }, h('span', { class: 'eyebrow' }, 'Total balance'),
      h('div', { class: 'dbal-r' }, u.tier >= 1 ? h('span', { class: 'dstat ok' }, h('i'), 'ID verified') : h('span', { class: 'dstat warn' }, h('i'), 'ID not checked yet'),
        h('button', { type: 'button', class: 'eye', title: t(hide ? 'Show' : 'Hide'), onclick: () => { try { localStorage.setItem('hideBal', hide ? '0' : '1'); } catch {} route(); } }, icon(hide ? 'eyeoff' : 'eye')))),
    h('div', { class: 'dbal-v' }, mask(money(total)), h('small', {}, ' USD')),
    h('div', { class: 'dbal-s' }, bestBuy ? h('span', {}, '≈ ' + mask(money(total * bestBuy, 0)) + ' HTG · ', h('span', {}, 'at the best selling price now')) : h('span', {}, 'USDT + USDC, 1 = 1 US dollar')),
    h('div', { class: 'dbal-a' },
      h('div', {}, h('span', {}, 'USDT'), h('b', {}, mask(money(usdt.available)))),
      h('div', {}, h('span', {}, 'USDC'), h('b', {}, mask(money(usdc.available)))),
      h('div', {}, h('span', {}, icon('lock'), ' ', h('span', {}, 'Locked (kadnase)')), h('b', {}, mask(money(locked)))),
      h('div', {}, h('span', {}, 'Available'), h('b', {}, mask(money(avail))))));

  const qa = (ic, label, fn, cls = '') => h('button', { type: 'button', class: 'dqa ' + cls, onclick: fn }, h('span', { class: 'dqi' }, icon(ic)), h('span', {}, label));
  const quick = h('div', { class: 'dqas' },
    qa('arrow-d', 'Buy', () => { marketSide = 'SELL'; go('market'); }),
    qa('arrow-u', 'Sell', () => { marketSide = 'BUY'; go('market'); }),
    qa('download', 'Deposit', () => go('deposit')),
    qa('inbox', 'Receive', () => go('receive')),
    qa('upload', 'Withdraw', () => go('withdraw')));

  // My orders, right on the dashboard: the ones waiting for me first.
  const isTurn = (o) => (o.buyer_id === u.id && o.state === 'AWAITING_PAYMENT') || (o.seller_id === u.id && o.state === 'PAID_CLAIMED');
  const open = orders.filter((o) => !FINAL.includes(o.state)).sort((a, b) => isTurn(b) - isTurn(a));
  let tab = open.length ? 'open' : 'all';
  const olist = h('div', { class: 'olist' });
  const seg = h('div', { class: 'dseg' });
  const paintOrders = () => {
    const rows = tab === 'open' ? open : tab === 'done' ? orders.filter((o) => FINAL.includes(o.state)) : orders;
    seg.replaceChildren(...[['open', 'Active', open.length], ['done', 'Finished'], ['all', 'All', orders.length]].map(([k, label, n]) =>
      h('button', { type: 'button', class: k === tab ? 'on' : '', onclick: () => { tab = k; paintOrders(); } }, h('span', {}, label), n ? h('em', {}, String(n)) : null)));
    olist.replaceChildren(...(rows.length ? rows.slice(0, 6).map(orderLine)
      : [empty('receipt', tab === 'open' ? 'No order in progress.' : 'No orders yet. Press Buy or Sell to start.',
        h('button', { class: 'btn sm', onclick: () => { marketSide = 'SELL'; go('market'); } }, 'Buy'), h('button', { class: 'btn alt sm', onclick: () => { marketSide = 'BUY'; go('market'); } }, 'Sell'))]));
  };
  paintOrders();
  const ordersCard = dcard('My orders', open.filter(isTurn).length ? null : 'Your purchases and sales, the newest first.',
    orders.length > 6 || orders.length ? h('button', { type: 'button', class: 'linkbtn', onclick: () => go('orders') }, 'See all') : null, seg, olist);
  if (open.filter(isTurn).length) ordersCard.querySelector('.dch > div').append(h('p', { class: 'dturn' }, icon('bolt'), ' ', h('span', {}, 'An order is waiting for you.')));

  // Live prices.
  const prices = dcard('Live prices', 'HTG for 1 USDT, right now on the MarketPlace.', h('span', { class: 'livetag' }, h('span', { class: 'livedot' }), 'Live'),
    h('div', { class: 'dprices' },
      h('div', {}, h('small', {}, 'Best price to buy'), h('b', {}, bestSell ? money(bestSell) : '—'), h('small', {}, sells.length + ' ', h('span', {}, 'sellers'))),
      h('div', {}, h('small', {}, 'Best price to sell'), h('b', {}, bestBuy ? money(bestBuy) : '—'), h('small', {}, buys.length + ' ', h('span', {}, 'buyers')))),
    h('button', { class: 'btn full', onclick: () => go('market') }, icon('chart'), ' ', h('span', {}, 'Open the MarketPlace')));

  // My ads.
  const live = myAds.filter((a) => a.status !== 'CLOSED');
  const adsCard = dcard('My ads', live.length ? null : 'Sell or buy at your own price.', h('button', { type: 'button', class: 'linkbtn', onclick: () => go('ads') }, 'See all'),
    live.length ? h('div', { class: 'alist' }, live.slice(0, 3).map((a) => h('button', { type: 'button', class: 'aline', onclick: () => go('ads') },
      h('span', { class: 'aside ' + (a.side === 'SELL' ? 'out' : 'in') }, a.side === 'SELL' ? 'Sell' : 'Buy'),
      h('span', { class: 'om' }, h('b', {}, usd2(a.remaining) + ' ' + a.asset), h('small', {}, money(a.price_htg) + ' HTG')),
      h('span', { class: 'pill ' + (a.status === 'ACTIVE' ? 'good' : 'warn') }, a.status === 'ACTIVE' ? 'Active' : 'Paused')))) : null,
    h('button', { class: 'btn alt full', onclick: () => { window.__adForm = true; go('ads'); } }, icon('plus'), ' ', h('span', {}, 'Post an ad')));

  // Account safety at a glance.
  const pms = me.payment_methods.filter((p) => !p.linked && p.verified);
  const extra = (links.mine || []).filter((l) => l.status === 'ACTIVE').length;
  const sitem = (ic, title, text, ok, fn, todo) => h('button', { type: 'button', class: 'sitem', onclick: fn },
    h('span', { class: 'sic ' + (ok ? 'ok' : 'warn') }, icon(ic)), h('span', { class: 'om' }, h('b', {}, title), h('small', {}, text)),
    ok ? h('span', { class: 'dstat ok' }, h('i'), 'Done') : h('span', { class: 'dstat warn' }, h('i'), todo || 'To do'));
  const sec = dcard('Account security', null, null,
    sitem('id', 'ID check', u.tier >= 1 ? 'Your identity is verified.' : 'Needed before your first swap. Takes 3 minutes.', u.tier >= 1, () => go('profile')),
    sitem('lock', 'Password', u.has_password ? 'You can log in with your password.' : 'Add a password to log in faster.', !!u.has_password, () => go('profile/password'), 'Add'),
    sitem('wallet', 'My wallet', u.wallet_addr ? short(u.wallet_addr) : 'Connect your wallet to deposit and sell.', !!u.wallet_addr, () => go('deposit'), 'Connect'),
    sitem('bank', 'Payment accounts', pms.length ? pms.length + ' MonCash / NatCash / Bank' : 'Add where you receive gourdes.', pms.length > 0, () => go('receive'), 'Add'),
    sitem('link', 'Extra accounts', extra ? String(extra) : 'Receive gourdes into more accounts.', true, () => go('linked')));

  app.append(
    Object.assign(pageHead(h('span', {}, h('span', {}, 'Hello'), ', ' + first), 'Here is your account at a glance.',
      h('button', { class: 'btn sm', onclick: () => { window.__adForm = true; go('ads'); } }, icon('plus'), ' ', h('span', {}, 'Post an ad'))), { className: 'phead home' }),
    ...(u.tier < 1 ? [h('button', { type: 'button', class: 'dnotice warn', onclick: () => go('profile') }, icon('id'), h('span', {}, h('b', {}, 'Verify your identity'), ' ', h('span', {}, 'Needed before your first swap. Takes 3 minutes.')), icon('arrow-r'))] : []),
    ...(check ? [check] : []),
    h('div', { class: 'dgrid' },
      h('div', { class: 'dcol' }, bal, quick, ordersCard),
      h('div', { class: 'dcol' }, prices, adsCard, sec)));
}

// ---------- all my orders ----------
async function ordersView(app) {
  const list = await api('GET', '/orders');
  app.append(pageHead('My orders', 'Every purchase and sale, the newest first.', backHome()),
    h('div', { class: 'card dcard' }, list.length ? h('div', { class: 'olist' }, list.map(orderLine))
      : empty('receipt', 'No orders yet. Press Buy or Sell to start.', h('button', { class: 'btn sm', onclick: () => go('market') }, 'Open the MarketPlace'))));
}

// ---------- Depo: put crypto in to sell ----------
async function depositView(app) {
  const u = me.user, chain = cfg.chain;
  const asset = h('select', {}, h('option', {}, 'USDT'), h('option', {}, 'USDC'));
  const amt = h('input', { inputmode: 'decimal', placeholder: '100' });
  const step = (n, title, sub, ...body) => h('div', { class: 'card dcard dstep' }, h('div', { class: 'dch' }, h('div', { class: 'dsn' }, String(n)), h('div', {}, h('h2', {}, title), sub ? h('p', {}, sub) : null)), ...body);
  const walletBox = u.wallet_addr
    ? h('div', {}, h('div', { class: 'addr' }, h('span', { class: 'dstat ok' }, h('i'), 'Connected'), h('code', {}, u.wallet_addr), copyBtn(u.wallet_addr)),
      chain ? h('button', { class: 'btn alt sm', onclick: act(async () => { await linkWalletWithSignature(); toast(t('Wallet linked.')); me = await api('GET', '/me'); route(); }) }, 'Change wallet') : null)
    : h('div', {}, h('p', { class: 'mute' }, 'Use a wallet like MetaMask or Trust Wallet, on the Arbitrum network. You sign once to prove it is yours. It costs nothing.'),
      h('button', { class: 'btn', onclick: act(async () => { if (!chain) throw new Error(t('Test mode: no real wallet here.')); await linkWalletWithSignature(); toast(t('Wallet linked.')); me = await api('GET', '/me'); route(); }) }, icon('wallet'), ' ', h('span', {}, 'Connect my wallet')));
  app.append(
    pageHead('Deposit to sell', 'Put USDT or USDC in your Ayiti P2P account. Then post an ad to sell it.', backHome()),
    h('div', { class: 'dgrid' },
      h('div', { class: 'dcol' },
        step(1, 'Connect my wallet', 'The wallet you send from.', walletBox),
        step(2, 'Transfer from your wallet to your Ayiti P2P account', 'Choose USDT or USDC and how much.',
          h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Asset'), asset), h('div', {}, h('label', {}, 'Amount'), amt)),
          h('button', { class: 'btn', onclick: act(async () => {
            if (!(Number(amt.value) > 0)) throw new Error(t('Type an amount.'));
            if (chain) { if (!u.wallet_addr) throw new Error(t('Connect your wallet first.')); await chainDeposit(asset.value, amt.value); }
            else { await api('POST', '/wallet/dev-deposit', { asset: asset.value, amount: amt.value }); toast(t('Test deposit added.')); }
            me = await api('GET', '/me'); route();
          }) }, icon('download'), ' ', h('span', {}, 'Deposit')),
          h('p', { class: 'mute small' }, 'Your wallet asks you to confirm two times: allow, then send. The network cost is a few cents in ETH on Arbitrum.'),
          h('div', { class: 'warn-note' }, 'Only on the Arbitrum One network. Never send from another network: the money can be lost.')),
        step(3, 'Post an ad', 'When the deposit shows in your balance, sell at your price.',
          h('button', { class: 'btn alt', onclick: () => { window.__adForm = true; go('ads'); } }, icon('megaphone'), ' ', h('span', {}, 'Post an ad')))),
      h('div', { class: 'dcol' }, balancesCard(),
        dcard('Network', null, null, kv([['Network', 'Arbitrum One'], ['Tokens', 'USDT · USDC'],
          ...(chain ? [['Contract', h('span', { class: 'addr sm' }, h('code', {}, short(chain.contract)), copyBtn(chain.contract))]] : [])]),
          h('p', { class: 'mute small' }, 'Your crypto is held by a public smart contract. You can always take it back with Withdraw.')))));
}

function balancesCard() {
  const hide = hideBal(), mask = (x) => (hide ? '•••••' : x);
  return dcard('My balance', null, null, h('div', { class: 'blist' }, ['USDT', 'USDC'].map((a) => {
    const b = balOf(a);
    return h('div', { class: 'bline' }, tokenMark(a), h('span', { class: 'om' }, h('b', {}, a), h('small', {}, h('span', {}, 'Locked'), ': ' + mask(money(b.locked)))),
      h('span', { class: 'oa' }, h('b', {}, mask(money(b.available))), h('small', {}, 'Available')));
  })));
}

// ---------- Resevwa: where I receive money (crypto and gourdes), to see and copy ----------
async function receiveView(app) {
  const u = me.user, nets = cfg.networks || [];
  const netName = (id) => (nets.find((n) => n.id === id) || {}).label || id;
  const line = (logo, title, value, sub) => h('div', { class: 'rline' }, logo, h('span', { class: 'om' }, h('small', {}, title), h('b', { class: 'mono' }, value), sub ? h('small', {}, sub) : null), copyBtn(value));
  const img = (src) => h('span', { class: 'acclogo' }, h('img', { src, alt: '' }));
  const crypto = h('div', {});
  const paintCrypto = (edit) => {
    const none = (logo, title, sub) => h('div', { class: 'rline' }, logo, h('span', { class: 'om' }, h('small', {}, title), h('b', { class: 'mute' }, 'Not saved yet'), sub ? h('small', {}, sub) : null),
      h('button', { type: 'button', class: 'btn alt sm', onclick: () => paintCrypto(true) }, icon('plus'), ' ', h('span', {}, 'Add')));
    const rows = [
      u.binance_uid ? line(img('img/brand/binance.png'), 'Binance UID', u.binance_uid, 'Binance to Binance: no network fee.') : none(img('img/brand/binance.png'), 'Binance UID', 'Binance to Binance: no network fee.'),
      u.payout_addr ? line(tokenMark('USDT'), h('span', {}, h('span', {}, 'Address on'), ' ' + netName(u.payout_network)), u.payout_addr) : none(tokenMark('USDT'), 'Arbitrum One address (or another network)'),
      u.wallet_addr ? line(icon('wallet'), 'My connected wallet (Arbitrum One)', u.wallet_addr) : null].filter(Boolean);
    crypto.replaceChildren(dcard('Crypto: USDT / USDC', 'Where you receive your crypto.',
      h('button', { type: 'button', class: 'btn alt sm', onclick: () => paintCrypto(!edit) }, icon('pencil'), ' ', h('span', {}, edit ? 'Close' : 'Edit')),
      rows.length ? h('div', { class: 'rlist' }, rows) : empty('wallet', 'Nothing saved yet. Add your Binance UID or a wallet address.'),
      edit ? payoutForm() : null));
  };
  paintCrypto(false);
  const pms = me.payment_methods.filter((p) => !p.linked);
  const linked = me.payment_methods.filter((p) => p.linked);
  const gourdes = dcard('Gourdes: MonCash, NatCash, Bank', 'Buyers pay you into these accounts. The name must match your ID.',
    h('button', { type: 'button', class: 'btn alt sm', onclick: () => go('profile/pay') }, icon('plus'), ' ', h('span', {}, 'Add')),
    pms.length ? h('div', { class: 'rlist' }, pms.map((p) => h('div', { class: 'rline' }, accLogo(p),
      h('span', { class: 'om' }, h('small', {}, p.bank_name || PAY_NAME[p.type] || p.type), h('b', { class: 'mono' }, p.account_ref), h('small', {}, p.account_name)),
      h('span', { class: 'pill ' + (p.verified ? 'good' : 'warn') }, p.verified ? 'verified' : 'name does not match ID'),
      copyBtn(p.account_ref),
      h('button', { type: 'button', class: 'cbtn', title: t('Remove'), 'aria-label': t('Remove'), onclick: () => removeAccount(p) }, icon('trash')))))
      : empty('bank', 'None yet. Add one after your ID check is approved.', h('button', { class: 'btn sm', onclick: () => go('profile/pay') }, 'Add account')));
  const extra = dcard('Add extra accounts to receive', 'Accounts of other verified people, when one account is not enough.',
    h('button', { type: 'button', class: 'linkbtn', onclick: () => go('linked') }, 'Open'),
    linked.length ? h('div', { class: 'rlist' }, linked.map((p) => h('div', { class: 'rline' }, accLogo(p),
      h('span', { class: 'om' }, h('small', {}, p.bank_name || PAY_NAME[p.type] || p.type), h('b', { class: 'mono' }, p.account_ref), h('small', {}, p.account_name)), copyBtn(p.account_ref))))
      : h('p', { class: 'mute' }, h('span', {}, 'One-time fee per extra account:'), ' ' + (cfg.link_fee || '2.50') + ' USDT.'));
  app.append(pageHead('Receive', 'Your saved accounts. Copy them, change them or add more.', backHome()),
    h('div', { class: 'dgrid even' }, h('div', { class: 'dcol' }, crypto), h('div', { class: 'dcol' }, gourdes, extra)));
}

function removeAccount(p) {
  modal(t('Remove this account?'), h('p', {}, (p.bank_name || PAY_NAME[p.type] || p.type) + ' · ' + p.account_ref),
    [{ label: t('Keep') }, { label: t('Remove'), cls: 'danger', run: async () => { await api('POST', `/payment-methods/${p.id}/remove`); me = await api('GET', '/me'); toast(t('Removed.')); route(); } }]);
}

// Binance UID and/or a wallet on a network (the form).
function payoutForm() {
  const u = me.user, nets = cfg.networks || [];
  const uid = h('input', { inputmode: 'numeric', placeholder: 'Binance UID, for example 123456789', value: u.binance_uid || '' });
  const net = h('select', {}, nets.map((n) => h('option', { value: n.id, selected: n.id === (u.payout_network || cfg.network) }, n.label)));
  const addr = h('input', { placeholder: 'Wallet address on that network', value: u.payout_addr || '' });
  const hint = h('div', { class: 'mute small' });
  const paint = () => { const n = nets.find((x) => x.id === net.value) || {}; hint.textContent = (n.fee || '') + (n.auto ? '. Automatic payouts work on this network.' : '. Saved for staff payouts. Not automatic yet.'); };
  net.addEventListener('change', paint); paint();
  return h('div', { class: 'dform' },
    h('label', { class: 'withlogo' }, h('img', { src: 'img/brand/binance.png', alt: '' }), 'Binance UID'), uid,
    h('label', {}, 'Or a wallet: choose the network'), net, hint,
    h('label', {}, 'Wallet address'), addr,
    h('div', { class: 'warn-note', style: 'margin-top:10px' }, 'Be careful. If you pick the wrong network, the money can be lost forever. Always check the network and the address.'),
    h('button', { class: 'btn', onclick: act(async () => { await api('PUT', '/me/payout', { binance_uid: uid.value, network: addr.value ? net.value : undefined, address: addr.value }); me = await api('GET', '/me'); toast(t('Saved.')); route(); }) }, 'Save'));
}

// ---------- Retrè: take crypto out ----------
async function withdrawView(app) {
  const u = me.user, chain = cfg.chain, fee = Number(cfg.withdraw_fee || 1);
  const asset = h('select', {}, h('option', {}, 'USDT'), h('option', {}, 'USDC'));
  const amt = h('input', { inputmode: 'decimal', placeholder: '0.00' });
  const saved = u.payout_network === 'ARBITRUM' && u.payout_addr ? u.payout_addr : '';
  const to = h('input', { placeholder: '0x… (Arbitrum One)', value: saved || u.wallet_addr || '' });
  const out = h('b', {}, '—');
  const upd = () => { const v = Number(amt.value || 0); out.textContent = v > fee ? usd2(v - fee) + ' ' + asset.value : '—'; };
  amt.addEventListener('input', upd); asset.addEventListener('change', upd);
  const pick = (label, v) => v ? h('button', { type: 'button', class: 'chipbtn', onclick: () => { to.value = v; } }, h('span', {}, label), ' ' + short(v)) : null;
  app.append(pageHead('Withdraw', 'Send USDT or USDC from your Ayiti P2P account to your wallet or to Binance.', backHome()),
    h('div', { class: 'dgrid' },
      h('div', { class: 'dcol' }, dcard('Withdraw', null, null,
        h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Asset'), asset),
          h('div', {}, h('label', {}, 'Amount'), h('div', { class: 'maxwrap' }, amt, h('button', { type: 'button', class: 'maxbtn', onclick: () => { amt.value = String(Math.floor(Number(balOf(asset.value).available) * 100) / 100); upd(); } }, 'Max')))),
        h('label', {}, 'Send to (Arbitrum One address)'), to,
        h('div', { class: 'chips' }, pick('My wallet', u.wallet_addr), saved && saved !== u.wallet_addr ? pick('Saved address', saved) : null),
        h('p', { class: 'mute small' }, 'To send to Binance: in Binance, choose Deposit, USDT, network Arbitrum One, and paste that address here.'),
        h('div', { class: 'sumbox' }, kv([['Network fee (we pay the gas)', fee + ' USDT/USDC'], ['You receive', out]])),
        h('button', { class: 'btn', onclick: act(async () => {
          if (!(Number(amt.value) > fee)) throw new Error(t('The amount must be bigger than the network fee.'));
          if (!chain) throw new Error(t('Test mode: withdrawals are not live here.'));
          await chainWithdraw(asset.value, amt.value, to.value.trim()); me = await api('GET', '/me'); route();
        }) }, icon('upload'), ' ', h('span', {}, 'Withdraw')),
        h('p', { class: 'mute small' }, 'You only sign in your wallet. You need no ETH.'),
        h('div', { class: 'warn-note' }, 'Check the address two times. A transfer on the blockchain cannot be undone.'))),
      h('div', { class: 'dcol' }, balancesCard(),
        dcard('Receive', 'Your saved Binance UID and addresses.', null, h('button', { class: 'btn alt full', onclick: () => go('receive') }, icon('inbox'), ' ', h('span', {}, 'See my accounts'))))));
}

// ---------- Anons: post an ad, see my ads ----------
async function adsView(app) {
  const mine = await api('GET', '/my/ads');
  const f = {};
  const pms = me.payment_methods.filter((p) => p.verified && p.active !== false);
  const tick = (value, label, sub) => h('label', { class: 'tick' }, h('input', { type: 'checkbox', value, checked: true }), h('span', {}, h('b', {}, label), sub ? h('small', { class: 'mute' }, ' ' + sub) : null));
  let side = 'SELL';
  const sideSeg = h('div', { class: 'seg' });
  const sellBox = h('div', {}, h('label', {}, 'I accept payment in (tick all you want)'),
    pms.length ? h('div', { class: 'ticks' }, pms.map((p) => tick(p.id, p.bank_name || PAY_NAME[p.type], `${p.account_ref} · ${p.account_name}` + (p.linked ? ' (extra)' : ''))))
      : h('p', { class: 'mute' }, h('span', {}, 'Add a verified MonCash, NatCash or bank account first.'), ' ', h('a', { href: '#profile/pay' }, 'Payment accounts')));
  const buyBox = h('div', { class: 'hidden' }, h('label', {}, 'I can pay with (tick all you want)'),
    h('div', { class: 'ticks' }, ['MONCASH', 'NATCASH', 'BANK'].map((tp) => tick(tp, PAY_NAME[tp]))));
  const paintSide = () => {
    sideSeg.replaceChildren(h('button', { type: 'button', class: 'sell' + (side === 'SELL' ? ' on' : ''), onclick: () => { side = 'SELL'; paintSide(); } }, 'I sell USDT/USDC (I get HTG)'),
      h('button', { type: 'button', class: 'buy' + (side === 'BUY' ? ' on' : ''), onclick: () => { side = 'BUY'; paintSide(); } }, 'I buy USDT/USDC (I pay HTG)'));
    sellBox.classList.toggle('hidden', side !== 'SELL'); buyBox.classList.toggle('hidden', side !== 'BUY');
  };
  paintSide();
  const inp = (key, ph) => (f[key] = h('input', { inputmode: 'decimal', placeholder: ph || '' }));
  const assetSel = (f.asset = h('select', {}, h('option', {}, 'USDT'), h('option', {}, 'USDC')));
  const worth = h('div', { class: 'mute small' });
  const form = h('div', { class: 'card dcard' + (window.__adForm || !mine.length ? '' : ' hidden'), id: 'adform' },
    h('div', { class: 'dch' }, h('div', {}, h('h2', {}, 'Post an ad'), h('p', {}, 'Your price, your amount. Buyers or sellers come to you.'))),
    sideSeg,
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'Asset'), assetSel),
      h('div', {}, h('label', {}, 'Price (HTG for 1)'), inp('price_htg', '140')),
      h('div', {}, h('label', {}, 'Amount'), inp('amount', '100'))),
    worth,
    sellBox, buyBox,
    h('details', { class: 'dmore' }, h('summary', {}, h('span', {}, 'Smallest and biggest order'), ' ', h('em', {}, 'Optional')),
      h('p', { class: 'mute small' }, 'Leave empty: people can take from 500 HTG up to the whole ad.'),
      h('div', { class: 'row' },
        h('div', {}, h('label', {}, 'Smallest order (HTG)'), inp('min_order_htg', '500')),
        h('div', {}, h('label', {}, 'Biggest order (HTG)'), inp('max_order_htg')))),
    h('div', { class: 'feebox' },
      h('p', {}, icon('lock'), ' ', h('span', {}, 'Sell ads lock your USDT now.'), ' ', h('span', {}, 'The seller pays'), ` ${Number(cfg.fee_rate) * 100}%.`),
      Number(cfg.lock_fee) > 0 ? h('p', {}, icon('receipt'), ' ', h('span', {}, 'The buyer pays the lock fee per order:'), ` ${cfg.lock_fee} USDT.`) : null),
    h('div', { class: 'gactions' },
      h('button', { class: 'btn', onclick: act(async () => {
        const b = { side, asset: assetSel.value, price_htg: f.price_htg.value, amount: f.amount.value, min_order_htg: f.min_order_htg.value, max_order_htg: f.max_order_htg.value };
        if (side === 'SELL') b.payment_method_ids = [...sellBox.querySelectorAll('input:checked')].map((x) => x.value);
        else b.pay_types = [...buyBox.querySelectorAll('input:checked')].map((x) => x.value);
        if (!(b.payment_method_ids || b.pay_types).length) throw new Error(t('Tick at least one payment method.'));
        await api('POST', '/ads', b); toast(t('Ad posted.')); window.__adForm = false; me = await api('GET', '/me'); route();
      }) }, icon('megaphone'), ' ', h('span', {}, 'Post an ad')),
      mine.length ? h('button', { class: 'btn alt', onclick: () => { form.classList.add('hidden'); window.__adForm = false; } }, 'Cancel') : null));
  const updWorth = () => { const v = Number(f.price_htg.value) * Number(f.amount.value); worth.textContent = v > 0 ? '= ' + money(v, 0) + ' HTG' : ''; };
  f.price_htg.addEventListener('input', updWorth); f.amount.addEventListener('input', updWorth);
  window.__adForm = false;

  const live = mine.filter((a) => a.status !== 'CLOSED'), closed = mine.filter((a) => a.status === 'CLOSED');
  const set = (a, status) => act(async () => { await api('POST', `/ads/${a.id}/status`, { status }); me = await api('GET', '/me'); route(); });
  const adCard = (a) => h('div', { class: 'adcard' + (a.status === 'CLOSED' ? ' off' : '') },
    h('div', { class: 'adtop' }, h('span', { class: 'aside ' + (a.side === 'SELL' ? 'out' : 'in') }, a.side === 'SELL' ? 'Sell' : 'Buy'), h('b', {}, a.asset),
      h('span', { class: 'pill ' + (a.status === 'ACTIVE' ? 'good' : a.status === 'PAUSED' ? 'warn' : '') }, a.status === 'ACTIVE' ? 'Active' : a.status === 'PAUSED' ? 'Paused' : 'Closed')),
    h('div', { class: 'adprice' }, money(a.price_htg), h('small', {}, ' HTG')),
    kv([['Left', usd2(a.remaining) + ' ' + a.asset], ['Locked', usd2(a.reserved) + ' ' + a.asset], ['Per order', money(a.min_order_htg, 0) + ' – ' + money(a.max_order_htg, 0) + ' HTG']]),
    payChips(a),
    a.status === 'CLOSED' ? null : h('div', { class: 'gactions' },
      a.status === 'ACTIVE' ? h('button', { class: 'btn alt sm', onclick: set(a, 'PAUSED') }, 'Pause') : h('button', { class: 'btn alt sm', onclick: set(a, 'ACTIVE') }, 'Resume'),
      h('button', { class: 'btn alt sm dangertxt', onclick: () => modal(t('Close this ad?'), h('p', {}, t('What is left goes back to your available balance.')), [{ label: t('Keep') }, { label: t('Close'), cls: 'danger', run: set(a, 'CLOSED') }]) }, 'Close')));
  app.append(
    pageHead('Ads', 'Post an ad and see your ads.', h('button', { class: 'btn sm', onclick: () => { form.classList.remove('hidden'); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, icon('plus'), ' ', h('span', {}, 'Post an ad'))),
    form,
    dcard('My ads', null, h('span', { class: 'mute small' }, String(live.length)),
      live.length ? h('div', { class: 'adgrid' }, live.map(adCard)) : empty('megaphone', 'No ads yet.', h('button', { class: 'btn sm', onclick: () => { form.classList.remove('hidden'); form.scrollIntoView({ behavior: 'smooth' }); } }, 'Post an ad'))),
    ...(closed.length ? [h('details', { class: 'card dcard dmore' }, h('summary', {}, h('span', {}, 'Closed ads'), ' ', h('em', {}, String(closed.length))), h('div', { class: 'adgrid' }, closed.slice(0, 12).map(adCard)))] : []));
}

// ---------- extra accounts to receive (another verified person's MonCash/NatCash/bank) ----------
async function payLink(l, fee) {
  const account = await eth();
  const td = await api('GET', `/links/${l.id}/pay-typed-data`);
  const data = { domain: td.domain, types: { EIP712Domain: [
    { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
    ...td.types }, primaryType: 'Withdraw', message: td.value };
  const signature = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(data)] });
  await api('POST', `/links/${l.id}/pay`, { deadline: td.value.deadline, signature });
  toast(t('Paid. The account is active.'));
}
async function linkedView(app) {
  const d = await api('GET', '/links');
  const fee = d.fee, ph = h('input', { inputmode: 'tel', placeholder: '+509 3700 1234' });
  const own = me.payment_methods.filter((p) => !p.linked && p.verified);
  const pay = (p) => `${p.bank_name || PAY_NAME[p.type] || ''} ${p.account_ref || ''}`.trim();
  const endBtn = (l, label) => h('button', { class: 'btn alt sm', onclick: () => modal(t(label) + '?', h('p', {}, t('The account cannot be used for new orders after this.')),
    [{ label: t('Keep') }, { label: t(label), cls: 'danger', run: async () => { await api('POST', `/links/${l.id}/end`); me = await api('GET', '/me'); route(); } }]) }, label);
  const stat = (l) => l.status === 'ACTIVE' ? h('span', { class: 'pill good' }, 'active') : l.status === 'UNPAID' ? h('span', { class: 'pill warn' }, 'to pay') : h('span', { class: 'pill warn' }, 'waiting');
  app.append(
    pageHead('Add extra accounts to receive', 'Receive gourdes into more MonCash, NatCash or bank accounts. For example when one account is full.', backHome()),
    h('div', { class: 'dgrid' },
      h('div', { class: 'dcol' },
        dcard('My extra accounts', null, null,
          d.mine.length ? h('div', { class: 'rlist' }, d.mine.map((l) => h('div', { class: 'rline' }, h('span', { class: 'acclogo none' }, icon('user')),
            h('span', { class: 'om' }, h('b', {}, l.member_name),
              h('small', {}, l.status === 'ACTIVE' ? pay(l) : l.status === 'UNPAID' ? t('They accepted. Pay the one-time fee to start using it.') : t('Waiting for them to accept'))),
            stat(l),
            l.status === 'UNPAID' ? h('button', { class: 'btn sm', onclick: act(async () => { await payLink(l, fee); me = await api('GET', '/me'); route(); }) }, h('span', {}, 'Pay'), ' ' + fee + ' USDT') : null,
            endBtn(l, l.status === 'ACTIVE' ? 'Remove' : 'Cancel'))))
            : empty('link', 'None yet.'),
          h('h3', { class: 'ct' }, 'Ask someone'),
          h('label', {}, 'Their phone number (they must already have a verified account)'), ph,
          h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/links', { phone: ph.value }); toast(t('Asked. They will see it in their app.')); route(); }) }, icon('send'), ' ', h('span', {}, 'Send request'))),
        d.asked.length ? dcard('People asking to use your account', null, null,
          h('div', { class: 'rlist' }, d.asked.map((l) => {
            if (l.status !== 'PENDING') return h('div', { class: 'rline' }, h('span', { class: 'acclogo none' }, icon('user')), h('span', { class: 'om' }, h('b', {}, l.owner_name), h('small', {}, h('span', {}, 'Uses your'), ' ' + pay(l))), stat(l), endBtn(l, 'Stop sharing'));
            const sel = h('select', {}, own.map((p) => h('option', { value: p.id }, accLabel(p))));
            return h('div', { class: 'rline wrap' }, h('span', { class: 'acclogo none' }, icon('user')),
              h('span', { class: 'om' }, h('b', {}, l.owner_name), h('small', {}, l.owner_phone + ' · ', h('span', {}, 'wants to receive gourdes into one of your accounts. You will confirm each payment.')),
                own.length ? sel : h('small', {}, 'Add a verified account in Profile first.')),
              h('button', { class: 'btn good sm', onclick: act(async () => { if (!own.length) throw new Error(t('Add a verified account in Profile first.')); await api('POST', `/links/${l.id}/accept`, { payment_method_id: sel.value }); route(); }) }, 'Accept'),
              endBtn(l, 'Refuse'));
          }))) : null),
      h('div', { class: 'dcol' },
        dcard('How it works', null, null,
          h('ol', { class: 'gsteps' },
            h('li', {}, 'The other person opens their own Ayiti P2P account and finishes the ID check.'),
            h('li', {}, 'You ask them here, with their phone number.'),
            h('li', {}, 'They accept in their app and choose which of their accounts to share.'),
            h('li', {}, 'When a buyer pays into that account, the owner confirms in their app that the gourdes arrived.'))),
        dcard('Price', null, null,
          h('div', { class: 'dprice1' }, h('b', {}, fee + ' USDT'), h('span', {}, 'one time, per extra account')),
          h('p', { class: 'mute small' }, 'Not monthly. Your own accounts are always free.')))));
}
