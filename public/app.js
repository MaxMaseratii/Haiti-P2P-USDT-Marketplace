'use strict';
// ---------- tiny helpers ----------
const $ = (s) => document.querySelector(s);
let lang = localStorage.getItem('lang') || 'en';
const t = (s) => (window.I18N[lang] && window.I18N[lang][s]) || s;
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const money = (v, d = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });

let toastTimer;
function toast(msg, err) {
  const el = $('#toast'); el.textContent = msg; el.className = 'toast' + (err ? ' err' : ''); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 4500);
}

let token = localStorage.getItem('token') || null;
let me = null, cfg = {};
async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token) { logout(); }
    throw new Error(j.error || 'Error ' + r.status);
  }
  return j;
}
const act = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, true); } };

function logout() { token = null; localStorage.removeItem('token'); me = null; route(); }

// ---------- router ----------
let timer = null;
const stopTimer = () => { clearInterval(timer); timer = null; };
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', route);
$('#lang').value = lang;
$('#lang').addEventListener('change', (e) => { lang = e.target.value; localStorage.setItem('lang', lang); route(); });

async function route() {
  stopTimer();
  const app = $('#app'); app.replaceChildren();
  if (!cfg.escrow_mode) cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  const ban = $('#banner');
  ban.hidden = cfg.escrow_mode !== 'MOCK';
  ban.textContent = 'TEST MODE: fake money. Nothing here is real USDT or real gourdes.';
  if (!token) { renderNav(); return authView(app); }
  try { const m = await api('GET', '/me'); me = m; } catch { return; }
  renderNav();
  const [view, arg] = (location.hash.slice(1) || 'market').split('/');
  const views = { market: marketView, ads: adsView, orders: ordersView, order: orderView, wallet: walletView, profile: profileView, staff: staffView, admin: adminView, dispute: disputeView };
  try { await (views[view] || marketView)(app, arg); } catch (e) { toast(e.message, true); }
}

function renderNav() {
  const nav = $('#nav'); nav.replaceChildren();
  if (!token) return;
  const cur = (location.hash.slice(1) || 'market').split('/')[0];
  const items = [['market', 'Market'], ['ads', 'My ads'], ['orders', 'My orders'], ['wallet', 'Wallet'], ['profile', 'Profile']];
  if (me && ['AGENT', 'ADMIN'].includes(me.user.role)) items.push(['staff', 'Staff']);
  if (me && me.user.role === 'ADMIN') items.push(['admin', 'Admin']);
  for (const [k, label] of items) nav.append(h('button', { class: cur === k ? 'on' : '', onclick: () => go(k) }, t(label)));
  nav.append(h('button', { onclick: logout }, t('Log out')));
}

// ---------- auth ----------
function authView(app) {
  const phone = h('input', { placeholder: '+50937001234', inputmode: 'tel' });
  const name = h('input', { placeholder: t('Full name (as on your ID)') });
  const code = h('input', { placeholder: cfg.mock_otp ? 'Test code: ' + cfg.mock_otp : 'SMS code' });
  const done = (r) => { token = r.token; localStorage.setItem('token', token); go('market'); route(); };
  app.append(h('div', { class: 'card' },
    h('h2', {}, t('Log in') + ' / ' + t('Sign up')),
    h('p', { class: 'mute' }, 'Haiti only. Phone numbers start with +509.'),
    h('label', {}, t('Phone')), phone,
    h('label', {}, t('Full name (as on your ID)') + ' (sign up only)'), name,
    h('label', {}, 'Code'), code,
    h('button', { class: 'btn alt', onclick: act(async () => {
      const r = await api('POST', '/auth/request-code', { phone: phone.value.trim() });
      toast(cfg.mock_otp ? 'Test mode: no SMS is sent. Use code ' + cfg.mock_otp : 'Code sent. It works for ' + r.expires_in_min + ' minutes.');
    }) }, 'Send me a code'),
    h('button', { class: 'btn', onclick: act(async () => done(await api('POST', '/auth/login', { phone: phone.value.trim(), code: code.value.trim() }))) }, t('Log in')),
    h('button', { class: 'btn alt', onclick: act(async () => done(await api('POST', '/auth/signup', { phone: phone.value.trim(), full_name: name.value, code: code.value.trim() || undefined }))) }, t('Sign up')),
  ));
}

// ---------- market ----------
let marketSide = 'SELL'; // SELL ads = you buy USDT
async function marketView(app) {
  const asset = h('select', {}, h('option', { value: '' }, 'USDT + USDC'), h('option', {}, 'USDT'), h('option', {}, 'USDC'));
  const pay = h('select', {}, h('option', { value: '' }, 'All payment types'), h('option', {}, 'MONCASH'), h('option', {}, 'NATCASH'), h('option', {}, 'BANK'));
  const box = h('div', { class: 'scroll' });
  const load = act(async () => {
    const qs = new URLSearchParams({ side: marketSide });
    if (asset.value) qs.set('asset', asset.value);
    if (pay.value) qs.set('pay_type', pay.value);
    const ads = await api('GET', '/ads?' + qs);
    box.replaceChildren(ads.length ? h('table', {},
      h('thead', {}, h('tr', {}, ['Trader', t('Price'), t('Available'), t('Limits'), 'Pay by', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, ads.map((a) => h('tr', {},
        h('td', {}, a.owner_name, h('div', { class: 'mute' }, `${a.trades} trades` + (a.rating ? ` · ${a.rating}★` : ''))),
        h('td', {}, money(a.price_htg) + ' HTG'),
        h('td', {}, usd(a.remaining) + ' ' + a.asset),
        h('td', {}, `${money(a.min_order_htg, 0)} – ${money(a.max_order_htg, 0)} HTG`),
        h('td', {}, a.pay_type),
        h('td', {}, a.owner_id === me.user.id ? h('span', { class: 'mute' }, 'yours') : h('button', { class: 'btn', onclick: () => takeAd(a) }, marketSide === 'SELL' ? t('Buy USDT') : t('Sell USDT'))))))) : h('p', { class: 'mute' }, 'No ads yet.'));
  });
  [asset, pay].forEach((s) => s.addEventListener('change', load));
  app.append(h('div', { class: 'card' },
    h('h2', {}, t('Market')),
    h('div', {},
      h('button', { class: 'btn' + (marketSide === 'SELL' ? '' : ' alt'), onclick: () => { marketSide = 'SELL'; route(); } }, t('Buy USDT')),
      h('button', { class: 'btn' + (marketSide === 'BUY' ? '' : ' alt'), onclick: () => { marketSide = 'BUY'; route(); } }, t('Sell USDT'))),
    h('div', { class: 'row' }, asset, pay), box));
  load();
}

function takeAd(a) {
  const amount = h('input', { inputmode: 'decimal', placeholder: 'Amount in ' + a.asset });
  const total = h('div', { class: 'big' }, '0 HTG');
  amount.addEventListener('input', () => { total.textContent = money(Number(amount.value || 0) * Number(a.price_htg)) + ' HTG'; });
  const pm = h('select', {}, (me.payment_methods || []).filter((p) => p.type === a.pay_type && p.verified).map((p) => h('option', { value: p.id }, `${p.type} ${p.account_ref}`)));
  const body = [h('h2', {}, `${a.side === 'SELL' ? t('Buy USDT') : t('Sell USDT')} @ ${money(a.price_htg)} HTG`),
    h('p', { class: 'mute' }, `Limits ${money(a.min_order_htg, 0)} – ${money(a.max_order_htg, 0)} HTG. Pay by ${a.pay_type}.`),
    h('label', {}, t('Amount')), amount, total];
  if (a.side === 'BUY') body.push(h('label', {}, t('Payment account') + ' (where you get paid)'), pm);
  body.push(h('button', { class: 'btn', onclick: act(async () => {
    const o = await api('POST', '/orders', { ad_id: a.id, amount: amount.value.trim(), payment_method_id: a.side === 'BUY' ? pm.value : undefined });
    go('order/' + o.id);
  }) }, t('Trade')));
  const app = $('#app'); app.replaceChildren(h('div', { class: 'card' }, body, h('button', { class: 'btn alt', onclick: route }, 'Back')));
}

// ---------- my ads ----------
async function adsView(app) {
  const mine = await api('GET', '/my/ads');
  const f = {};
  const field = (key, label, el) => { f[key] = el; return [h('label', {}, label), el]; };
  const pms = me.payment_methods.filter((p) => p.verified);
  app.append(h('div', { class: 'card' }, h('h2', {}, t('Post an ad')),
    h('div', { class: 'row' },
      h('div', {}, field('side', 'I want to', h('select', {}, h('option', { value: 'SELL' }, 'SELL USDT/USDC (I get HTG)'), h('option', { value: 'BUY' }, 'BUY USDT/USDC (I pay HTG)')))),
      h('div', {}, field('asset', 'Asset', h('select', {}, h('option', {}, 'USDT'), h('option', {}, 'USDC')))),
      h('div', {}, field('pay_type', 'Pay by', h('select', {}, h('option', {}, 'MONCASH'), h('option', {}, 'NATCASH'), h('option', {}, 'BANK'))))),
    h('div', { class: 'row' },
      h('div', {}, field('price_htg', 'Price (HTG per 1)', h('input', { inputmode: 'decimal' }))),
      h('div', {}, field('amount', 'Amount', h('input', { inputmode: 'decimal' }))),
      h('div', {}, field('min_order_htg', 'Min order (HTG)', h('input', { inputmode: 'decimal' }))),
      h('div', {}, field('max_order_htg', 'Max order (HTG)', h('input', { inputmode: 'decimal' })))),
    field('payment_method_id', 'Payment account (sell ads: where you get paid)', h('select', {}, pms.map((p) => h('option', { value: p.id }, `${p.type} ${p.account_ref} (${p.account_name})`)))),
    h('p', { class: 'mute' }, `Sell ads lock your USDT now. A ${Number(cfg.fee_rate) * 100}% fee is taken from the seller, in USDT.`),
    h('button', { class: 'btn', onclick: act(async () => {
      const b = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      await api('POST', '/ads', b); toast('Ad posted.'); route();
    }) }, t('Post an ad'))));
  app.append(h('div', { class: 'card scroll' }, h('h2', {}, t('My ads')), mine.length ? h('table', {},
    h('thead', {}, h('tr', {}, ['Side', t('Price'), t('Available'), 'Held', 'Status', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, mine.map((a) => h('tr', {},
      h('td', {}, a.side + ' ' + a.asset), h('td', {}, money(a.price_htg)), h('td', {}, usd(a.remaining)), h('td', {}, usd(a.reserved)),
      h('td', {}, a.status),
      h('td', {}, a.status === 'ACTIVE' ? h('button', { class: 'btn alt', onclick: act(async () => { await api('POST', `/ads/${a.id}/status`, { status: 'PAUSED' }); route(); }) }, 'Pause') : null,
        a.status === 'PAUSED' ? h('button', { class: 'btn alt', onclick: act(async () => { await api('POST', `/ads/${a.id}/status`, { status: 'ACTIVE' }); route(); }) }, 'Resume') : null,
        a.status !== 'CLOSED' ? h('button', { class: 'btn danger', onclick: act(async () => { await api('POST', `/ads/${a.id}/status`, { status: 'CLOSED' }); route(); }) }, 'Close') : null))))) : h('p', { class: 'mute' }, 'None yet.')));
}

// ---------- orders ----------
const STATE_TEXT = {
  ORDER_CREATED: ['Locking the USDT', ''], AWAITING_PAYMENT: ['Waiting for the buyer to pay', 'warn'],
  PAID_CLAIMED: ['Buyer says paid. Seller must check', 'warn'], DISPUTED: ['In dispute. A staff agent decides', 'bad'],
  RELEASING: ['Sending USDT', ''], COMPLETED: ['Done', 'good'], REFUNDING: ['Returning USDT', ''],
  REFUNDED: ['Refunded to seller', ''], CANCELLED_TIMEOUT: ['Cancelled', ''],
};
const statePill = (s) => h('span', { class: 'pill ' + STATE_TEXT[s][1] }, t(STATE_TEXT[s][0]));

async function ordersView(app) {
  const list = await api('GET', '/orders');
  app.append(h('div', { class: 'card scroll' }, h('h2', {}, t('My orders')), list.length ? h('table', {},
    h('thead', {}, h('tr', {}, ['When', 'Role', t('Amount'), 'HTG', t('Status'), ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, list.map((o) => h('tr', {},
      h('td', {}, new Date(o.created_at).toLocaleString()), h('td', {}, o.buyer_id === me.user.id ? t('Buyer') : t('Seller')),
      h('td', {}, usd(o.amount) + ' ' + o.asset), h('td', {}, money(o.total_htg)), h('td', {}, statePill(o.state)),
      h('td', {}, h('button', { class: 'btn alt', onclick: () => go('order/' + o.id) }, 'Open')))))) : h('p', { class: 'mute' }, 'No orders yet.')));
}

async function orderView(app, id) {
  const card = h('div'); app.append(card, h('div', { id: 'chatbox' }));
  let busy = false, lastView = null, sig = '', n = 0;
  const draw = async () => {
    if (busy) return; busy = true;
    try {
      const v = await api('GET', '/orders/' + id); lastView = v;
      const chat = await api('GET', `/orders/${id}/chat`);
      // Only redraw when something changed, so typing in a box is not wiped.
      const next = v.order.updated_at + '|' + v.events.length + '|' + chat.length + '|' + (v.dispute ? v.dispute.status : '');
      if (next !== sig) { sig = next; renderOrder(card, v); renderChat($('#chatbox'), v, chat); }
    } catch (e) { toast(e.message, true); } finally { busy = false; }
  };
  await draw();
  timer = setInterval(() => { tickClock(lastView); if (++n % 5 === 0) draw(); }, 1000);
}

function tickClock(v) {
  const el = $('#clock'); if (!el || !v || !v.order.state_deadline) return;
  const skew = Date.now() - new Date(v.server_time).getTime();
  let end = new Date(v.order.state_deadline).getTime() + skew;
  let left = Math.round((end - Date.now()) / 1000);
  let txt = left >= 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'time is up';
  if (left < 0 && v.order.state === 'AWAITING_PAYMENT') {
    const g = Math.round((end + v.grace_min * 60000 - Date.now()) / 1000);
    txt = g > 0 ? `grace ${Math.floor(g / 60)}:${String(g % 60).padStart(2, '0')}` : 'refund soon';
  }
  el.textContent = txt;
}

function renderOrder(card, v) {
  const o = v.order, role = v.role, s = o.state;
  const reload = () => route();
  const buttons = [];
  if (role === 'BUYER' && s === 'AWAITING_PAYMENT') {
    buttons.push(h('button', { class: 'btn good', onclick: act(async () => { await api('POST', `/orders/${o.id}/paid`); reload(); }) }, t('I paid')));
    buttons.push(h('button', { class: 'btn alt', onclick: act(async () => { if (confirm('Cancel this order?')) { await api('POST', `/orders/${o.id}/cancel`); reload(); } }) }, t('Cancel order')));
  }
  if (role === 'SELLER' && s === 'PAID_CLAIMED') {
    buttons.push(h('button', { class: 'btn good', onclick: act(async () => { if (confirm('Check your own MonCash, NatCash or bank app first. Did the money arrive?')) { await api('POST', `/orders/${o.id}/confirm`, cfg.chain ? await signRelease(o.id) : undefined); reload(); } }) }, t('Confirm received')));
  }
  if ((role === 'BUYER' || role === 'SELLER') && s === 'PAID_CLAIMED') {
    buttons.push(h('button', { class: 'btn danger', onclick: act(async () => { const r = prompt('What is wrong?'); if (r) { await api('POST', `/orders/${o.id}/dispute`, { reason: r }); reload(); } }) }, t('Open dispute')));
  }
  const pay = v.payment ? h('div', { class: 'card' }, h('h3', {}, 'Pay to'),
    h('div', {}, `${v.payment.type}: ${v.payment.account_ref}`), h('div', {}, 'Account name: ' + v.payment.account_name),
    role === 'BUYER' ? h('p', { class: 'mute' }, 'Pay exactly this amount. Put this code in the payment note:') : h('p', { class: 'mute' }, 'Buyer must put this code in the payment note:'),
    h('div', { class: 'code' }, o.pay_reference)) : null;
  const rate = s === 'COMPLETED' && role !== 'STAFF' ? h('div', {}, h('span', { class: 'mute' }, 'Rate the other side: '),
    [1, 2, 3, 4, 5].map((n) => h('button', { class: 'btn alt', onclick: act(async () => { await api('POST', `/orders/${o.id}/rate`, { stars: n }); toast('Thanks.'); }) }, n + '★'))) : null;
  const dispute = v.dispute ? h('div', { class: 'card' }, h('h3', {}, 'Dispute: ' + v.dispute.status), h('div', {}, v.dispute.reason),
    v.dispute.status === 'OPEN' && role !== 'STAFF' ? evidenceForm(o.id) : null,
    v.dispute.decision_note ? h('p', { class: 'mute' }, 'Decision: ' + v.dispute.decision_note) : null) : null;
  card.replaceChildren(...[
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', {}, h('div', { class: 'mute' }, role === 'BUYER' ? 'You buy' : role === 'SELLER' ? 'You sell' : 'Order'), h('div', { class: 'big' }, usd(o.amount) + ' ' + o.asset)),
        h('div', {}, h('div', { class: 'mute' }, 'Total in gourdes'), h('div', { class: 'big' }, money(o.total_htg) + ' HTG')),
        h('div', {}, h('div', { class: 'mute' }, t('Time left')), h('div', { class: 'big', id: 'clock' }, '–'))),
      h('p', {}, statePill(s), o.refund_reason ? h('span', { class: 'mute' }, ' (' + o.refund_reason + ')') : null),
      h('div', { class: 'mute' }, `${t('Price')} ${money(o.price_htg)} HTG · ${t('Buyer')}: ${v.buyer.full_name} · ${t('Seller')}: ${v.seller.full_name} · Fee ${usd(o.fee_amount)} ${o.asset} (paid by seller)`),
      buttons, rate),
    pay, dispute,
    h('div', { class: 'card' }, h('h3', {}, 'Timeline'), h('div', { class: 'timeline' },
      v.events.map((e) => h('div', {}, new Date(e.created_at).toLocaleTimeString() + '  ' + (e.to_state || '') + (e.note ? ' · ' + e.note : ''))),
      v.escrow.map((x) => h('div', {}, `escrow ${x.kind}: ${x.status}` + (x.tx_hash ? ' ' + x.tx_hash.slice(0, 14) + '…' : '')))))].filter(Boolean));
  tickClock(v);
}

function evidenceForm(orderId) {
  const kind = h('select', {}, ['RECEIPT', 'STATEMENT', 'CHAT_EXPORT', 'OTHER'].map((k) => h('option', {}, k)));
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,application/pdf' });
  const note = h('input', { placeholder: 'Short note (optional)' });
  const toB64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
  return h('div', {}, h('h3', {}, 'Add proof'), h('p', { class: 'mute' }, 'PNG, JPG, WEBP or PDF. Max 4 MB. A receipt screenshot alone may not be enough: add your own account statement too.'),
    h('div', { class: 'row' }, kind, file, note),
    h('button', { class: 'btn', onclick: act(async () => {
      const f = file.files[0]; if (!f) throw new Error('Pick a file first.');
      await api('POST', `/orders/${orderId}/evidence/upload`, { kind: kind.value, filename: f.name, data: await toB64(f), note: note.value || undefined });
      toast('Proof added.'); file.value = ''; note.value = ''; route();
    }) }, 'Upload'));
}

// Open a stored proof file. The file needs the login token, so fetch it and show it as a blob.
async function openProof(id) {
  const r = await fetch('/api/evidence/' + id + '/file', { headers: { authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Could not open the file.');
  window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener');
}
const proofLine = (e, who) => h('div', {}, `${e.kind} (${who}): `, e.file_ref.startsWith('upload:')
  ? h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); act(() => openProof(e.id))(); } }, e.orig_name || 'file')
  : e.file_ref);

function renderChat(box, v, msgs) {
  const log = h('div', { class: 'chat' }, msgs.map((m) => h('div', { class: 'msg ' + (m.sender_id === null ? 'sys' : m.sender_id === me.user.id ? 'me' : '') }, h('span', { class: 'b' }, m.body))));
  const input = h('input', { placeholder: 'Message (no links or phone numbers)' });
  const send = act(async () => { if (!input.value.trim()) return; await api('POST', `/orders/${v.order.id}/chat`, { body: input.value }); input.value = ''; route(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  const closed = ['COMPLETED', 'REFUNDED', 'CANCELLED_TIMEOUT'].includes(v.order.state) && v.role !== 'STAFF';
  box.replaceChildren(h('div', { class: 'card' }, h('h3', {}, t('Chat')), log, closed ? h('p', { class: 'mute' }, 'Chat is closed.') : h('div', { class: 'row' }, input, h('button', { class: 'btn', onclick: send }, t('Send')))));
  log.scrollTop = log.scrollHeight;
}

// ---------- real chain helpers (ESCROW_MODE=EVM). NOT TESTED in a browser wallet yet. ----------
const pad = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const toUnits = (v) => { const [i, f = ''] = String(v).split('.'); return BigInt(i + f.padEnd(6, '0').slice(0, 6)); };
async function eth() {
  if (!window.ethereum) throw new Error('No wallet found. Install a wallet like MetaMask.');
  const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const want = '0x' + Number(cfg.chain.chain_id).toString(16);
  if ((await window.ethereum.request({ method: 'eth_chainId' })) !== want)
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
  return account;
}
async function linkWalletWithSignature() {
  const account = await eth();
  const { message } = await api('GET', '/me/wallet-link-message');
  const hex = '0x' + [...new TextEncoder().encode(message)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const signature = await window.ethereum.request({ method: 'personal_sign', params: [hex, account] });
  await api('PUT', '/me/wallet-address', { wallet_addr: account, signature });
}
async function signRelease(orderId) {
  const account = await eth();
  const td = await api('GET', `/orders/${orderId}/release-typed-data`);
  const data = { domain: td.domain, types: { EIP712Domain: [
    { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
    ...td.types }, primaryType: 'Release', message: td.value };
  const sig = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(data)] });
  return { sig, deadline: td.deadline };
}
async function chainDeposit(asset, amount) {
  const account = await eth(); const token = cfg.chain.tokens[asset]; const v = toUnits(amount).toString(16);
  const send = (to, data) => window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to, data }] });
  await send(token, '0x095ea7b3' + pad(cfg.chain.contract) + pad(v));            // approve(escrow, amount)
  toast('Approved. Now confirm the deposit in your wallet.');
  await send(cfg.chain.contract, '0x47e7ef24' + pad(token) + pad(v));             // deposit(token, amount)
  toast('Deposit sent. It shows here after a few blocks.');
}
async function chainWithdraw(asset, amount) {
  const account = await eth(); const token = cfg.chain.tokens[asset];
  await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to: cfg.chain.contract,
    data: '0xf3fef3a3' + pad(token) + pad(toUnits(amount).toString(16)) }] });                // withdraw(token, amount)
  toast('Withdraw sent. Your balance updates after a few blocks.');
}

// ---------- wallet ----------
async function walletView(app) {
  const w = me.wallet;
  const amt = h('input', { value: '100', inputmode: 'decimal' });
  const asset = h('select', {}, h('option', {}, 'USDT'), h('option', {}, 'USDC'));
  const addr = h('input', { value: me.user.wallet_addr || '', placeholder: 'Your USDT wallet address (for withdrawals when live)' });
  app.append(h('div', { class: 'card' }, h('h2', {}, t('Wallet')),
    w.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Asset', t('Available'), 'Locked'].map((x) => h('th', {}, x)))),
      h('tbody', {}, w.map((b) => h('tr', {}, h('td', {}, b.asset), h('td', {}, usd(b.available)), h('td', {}, usd(b.locked)))))) : h('p', { class: 'mute' }, 'Empty.'),
    cfg.escrow_mode === 'MOCK' ? [h('h3', {}, t('Deposit') + ' (fake money, test mode)'), h('div', { class: 'row' }, asset, amt),
      h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/wallet/dev-deposit', { asset: asset.value, amount: amt.value }); route(); }) }, t('Deposit'))] : null,
    cfg.chain ? [
      h('p', { class: 'mute' }, 'Real chain mode. The contract is UNAUDITED. Use small amounts only.'),
      h('h3', {}, 'Your wallet'), h('p', {}, me.user.wallet_addr || 'Not linked yet.'),
      h('button', { class: 'btn alt', onclick: act(async () => { await linkWalletWithSignature(); toast('Wallet linked.'); route(); }) }, 'Connect and link my wallet'),
      h('h3', {}, 'Deposit or withdraw'), h('div', { class: 'row' }, asset, amt),
      h('button', { class: 'btn', onclick: act(async () => chainDeposit(asset.value, amt.value)) }, t('Deposit')),
      h('button', { class: 'btn alt', onclick: act(async () => chainWithdraw(asset.value, amt.value)) }, 'Withdraw')]
    : [h('h3', {}, 'Wallet address'), addr,
      h('button', { class: 'btn alt', onclick: act(async () => { await api('PUT', '/me/wallet-address', { wallet_addr: addr.value.trim() }); toast('Saved.'); }) }, 'Save address')]));
}

// ---------- profile ----------
async function profileView(app) {
  const nm = h('input', { value: me.user.full_name }); const doc = h('input', { placeholder: 'Link or file name of your ID photo' });
  const type = h('select', {}, h('option', {}, 'MONCASH'), h('option', {}, 'NATCASH'), h('option', {}, 'BANK'));
  const an = h('input', { placeholder: 'Name on the account (must match your ID)' }); const ar = h('input', { placeholder: 'MonCash / NatCash number or bank account' });
  app.append(
    h('div', { class: 'card' }, h('h2', {}, t('Profile')), h('div', {}, `${me.user.full_name} · ${me.user.phone}`),
      h('p', {}, h('span', { class: 'pill ' + (me.user.tier >= 1 ? 'good' : 'warn') }, 'Tier ' + me.user.tier), me.user.strikes ? h('span', { class: 'pill bad' }, me.user.strikes + ' strike(s)') : null),
      me.user.tier < 1 ? [h('h3', {}, 'ID check'), h('p', { class: 'mute' }, 'Send your ID details. Staff will review. You cannot trade before this.'),
        h('label', {}, 'Name on ID'), nm, h('label', {}, 'ID photo reference'), doc,
        h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/kyc', { name_on_id: nm.value, id_doc_ref: doc.value }); toast('Sent. Wait for staff.'); }) }, 'Send for review')] : h('p', { class: 'mute' }, 'ID check done.')),
    h('div', { class: 'card scroll' }, h('h3', {}, 'Payment accounts'),
      me.payment_methods.length ? h('table', {}, h('tbody', {}, me.payment_methods.map((p) => h('tr', {}, h('td', {}, p.type), h('td', {}, p.account_ref), h('td', {}, p.account_name),
        h('td', {}, h('span', { class: 'pill ' + (p.verified ? 'good' : 'warn') }, p.verified ? 'verified' : 'name does not match ID'))))))
        : h('p', { class: 'mute' }, 'None yet. Add one after your ID check is approved.'),
      h('div', { class: 'row' }, type, an, ar),
      h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/payment-methods', { type: type.value, account_name: an.value, account_ref: ar.value }); route(); }) }, 'Add account')));
}

// ---------- staff ----------
async function staffView(app) {
  const [kyc, disputes, hits] = await Promise.all([api('GET', '/staff/kyc'), api('GET', '/staff/disputes'), api('GET', '/staff/screening-hits')]);
  app.append(
    h('div', { class: 'card scroll' }, h('h2', {}, 'Disputes waiting'), disputes.length ? h('table', {},
      h('thead', {}, h('tr', {}, ['Opened', 'Reason', 'HTG', 'Votes', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, disputes.map((d) => h('tr', {}, h('td', {}, new Date(d.created_at).toLocaleString()), h('td', {}, d.reason), h('td', {}, money(d.total_htg)), h('td', {}, d.votes),
        h('td', {}, h('button', { class: 'btn', onclick: () => go('dispute/' + d.id) }, 'Open')))))) : h('p', { class: 'mute' }, 'Queue is empty.')),
    h('div', { class: 'card scroll' }, h('h2', {}, 'ID checks waiting'), kyc.length ? h('table', {}, h('tbody', {}, kyc.map((k) => h('tr', {},
      h('td', {}, k.phone), h('td', {}, 'Account: ' + k.full_name), h('td', {}, 'ID: ' + k.name_on_id), h('td', {}, k.id_doc_ref),
      h('td', {}, h('button', { class: 'btn good', onclick: act(async () => { await api('POST', `/staff/kyc/${k.id}/decision`, { approve: true }); route(); }) }, 'Approve'),
        h('button', { class: 'btn danger', onclick: act(async () => { await api('POST', `/staff/kyc/${k.id}/decision`, { approve: false }); route(); }) }, 'Reject'))))))
      : h('p', { class: 'mute' }, 'None waiting.')),
    h('div', { class: 'card' }, h('h2', {}, 'Sanctions hits'), hits.length ? h('table', {}, h('tbody', {}, hits.map((x) => h('tr', {}, h('td', {}, x.phone), h('td', {}, x.full_name), h('td', {}, 'matched ' + x.matched_name),
      h('td', {}, me.user.role === 'ADMIN' ? [h('button', { class: 'btn good', onclick: act(async () => { await api('POST', `/admin/screening-hits/${x.id}/resolve`, { clear: true }); route(); }) }, 'Cleared'),
        h('button', { class: 'btn danger', onclick: act(async () => { await api('POST', `/admin/screening-hits/${x.id}/resolve`, { clear: false }); route(); }) }, 'Confirm hit')] : 'Admin decides'))))) : h('p', { class: 'mute' }, 'No open hits.')));
}

async function disputeView(app, id) {
  const d = await api('GET', '/staff/disputes/' + id);
  const note = h('textarea', { rows: 3, placeholder: 'Why? Name, amount, time and reference match? Did you check the seller statement?' });
  const fake = h('input', { type: 'checkbox', style: 'width:auto' }); const pen = h('input', { type: 'checkbox', checked: true, style: 'width:auto' });
  const vote = (decision) => act(async () => {
    const r = await api('POST', `/staff/disputes/${id}/vote`, { decision, note: note.value, fake_proof: fake.checked, penalize: pen.checked });
    toast(r.resolved ? 'Decided: ' + r.decision : r.needs_admin ? 'Agents disagree. An admin must decide.' : `Vote saved. Need ${r.need} matching votes.`); go('staff');
  });
  app.append(h('div', { class: 'card' }, h('h2', {}, 'Dispute'), h('p', {}, d.dispute.reason),
    h('div', { class: 'mute' }, `Order ${usd(d.order.amount)} ${d.order.asset} · ${money(d.order.total_htg)} HTG · reference ${d.order.pay_reference}`),
    h('button', { class: 'btn alt', onclick: () => go('order/' + d.order.id) }, 'Open order page')),
    h('div', { class: 'card' }, h('h3', {}, 'Checklist'), h('ul', {}, ['Name on the payment matches the buyer ID and the seller account', 'Amount matches exactly', 'Time is inside the payment window', 'Reference code is in the payment note', 'Receipt matches the SELLER own statement (a screenshot alone is not enough)', 'No pressure to move off the platform'].map((x) => h('li', {}, x)))),
    h('div', { class: 'card' }, h('h3', {}, 'Proof'), d.evidence.length ? d.evidence.map((e) => proofLine(e, e.uploaded_by === d.order.buyer_id ? 'buyer' : 'seller')) : h('p', { class: 'mute' }, 'No proof uploaded.')),
    h('div', { class: 'card' }, h('h3', {}, 'Chat'), d.chat.map((m) => h('div', { class: 'mute' }, (m.sender_id === d.order.buyer_id ? 'Buyer: ' : m.sender_id === d.order.seller_id ? 'Seller: ' : 'System: ') + m.body))),
    h('div', { class: 'card' }, h('h3', {}, 'Your vote'), d.votes.length ? h('p', { class: 'mute' }, d.votes.length + ' vote(s) so far.') : null, note,
      h('label', {}, fake, ' Fake or edited proof (immediate ban)'),
      h('label', {}, pen, ' Give the losing side a strike'),
      h('button', { class: 'btn good', onclick: vote('BUYER') }, 'Buyer wins: release USDT'), h('button', { class: 'btn danger', onclick: vote('SELLER') }, 'Seller wins: refund USDT')));
}

// ---------- admin ----------
async function adminView(app) {
  const [limits, block] = await Promise.all([api('GET', '/admin/limits'), api('GET', '/admin/blocklist')]);
  const rows = limits.map((l) => {
    const a = h('input', { value: l.max_order_htg }), b = h('input', { value: l.max_daily_htg }), c = h('input', { value: l.max_open_orders });
    return h('tr', {}, h('td', {}, 'Tier ' + l.tier), h('td', {}, a), h('td', {}, b), h('td', {}, c),
      h('td', {}, h('button', { class: 'btn alt', onclick: act(async () => { await api('PUT', '/admin/limits/' + l.tier, { max_order_htg: a.value, max_daily_htg: b.value, max_open_orders: c.value }); toast('Saved.'); }) }, 'Save')));
  });
  const uid = h('input', { placeholder: 'User id' }); const tier = h('select', {}, [0, 1, 2, 3].map((n) => h('option', {}, n)));
  const kind = h('select', {}, ['PHONE', 'WALLET', 'PAY_ACCOUNT', 'NAME'].map((k) => h('option', {}, k))); const val = h('input', { placeholder: 'Value' });
  app.append(
    h('div', { class: 'card scroll' }, h('h2', {}, 'Limits (starting guesses, tune after the pilot)'), h('table', {}, h('thead', {}, h('tr', {}, ['Tier', 'Max per order (HTG)', 'Max per day (HTG)', 'Open orders', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))),
    h('div', { class: 'card' }, h('h2', {}, 'Users'), h('div', { class: 'row' }, uid, tier),
      h('button', { class: 'btn alt', onclick: act(async () => { await api('POST', `/admin/users/${uid.value.trim()}/tier`, { tier: Number(tier.value) }); toast('Tier set.'); }) }, 'Set tier'),
      h('button', { class: 'btn danger', onclick: act(async () => { if (confirm('Ban and block this user?')) { await api('POST', `/admin/users/${uid.value.trim()}/ban`, { reason: 'Admin ban' }); toast('Banned.'); } }) }, 'Ban + block'),
      h('button', { class: 'btn alt', onclick: act(async () => { await api('POST', `/admin/users/${uid.value.trim()}/unban`); toast('Unbanned.'); }) }, 'Unban')),
    h('div', { class: 'card scroll' }, h('h2', {}, 'Blocklist'), h('div', { class: 'row' }, kind, val),
      h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/admin/blocklist', { kind: kind.value, value: val.value.trim(), reason: 'Admin' }); route(); }) }, 'Add'),
      h('table', {}, h('tbody', {}, block.map((x) => h('tr', {}, h('td', {}, x.kind), h('td', {}, x.value), h('td', {}, x.reason || ''))))),
      h('button', { class: 'btn alt', onclick: act(async () => { const r = await api('POST', '/admin/run-timers'); toast('Timers ran: ' + JSON.stringify(r)); }) }, 'Run timers now')));
}

route();
