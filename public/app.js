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
  const views = { market: marketView, ads: adsView, orders: ordersView, order: orderView, wallet: walletView, profile: profileView, staff: staffView, admin: adminView, dispute: disputeView, safety: safetyView };
  try { await (views[view] || marketView)(app, arg); } catch (e) { toast(e.message, true); }
}

function renderNav() {
  const nav = $('#nav'); nav.replaceChildren();
  if (!token) return;
  const cur = (location.hash.slice(1) || 'market').split('/')[0];
  const items = [['market', 'Market'], ['ads', 'My ads'], ['orders', 'My orders'], ['wallet', 'Wallet'], ['profile', 'Profile'], ['safety', 'Safety']];
  if (me && ['AGENT', 'ADMIN'].includes(me.user.role)) items.push(['staff', 'Staff']);
  if (me && me.user.role === 'ADMIN') items.push(['admin', 'Admin']);
  for (const [k, label] of items) nav.append(h('button', { class: cur === k ? 'on' : '', onclick: () => go(k) }, t(label)));
  nav.append(h('button', { onclick: logout }, t('Log out')));
}

// ---------- auth ----------
function authView(app) {
  const phone = h('input', { placeholder: '+50937001234', inputmode: 'tel' });
  const name = h('input', { placeholder: t('Full name (as on your ID)') });
  const code = h('input', { placeholder: cfg.mock_otp ? 'Test code: ' + cfg.mock_otp : 'SMS code', inputmode: 'numeric' });
  const done = (r) => { token = r.token; localStorage.setItem('token', token); go('market'); route(); };
  const pt = (txt) => h('li', {}, h('span', { class: 'ic' }, '✓'), h('span', {}, txt));
  app.append(h('div', { class: 'hero' },
    h('div', {},
      h('h1', {}, 'Buy and sell ', h('em', {}, 'USDT'), ' with gourdes. Safely.'),
      h('p', { class: 'lead' }, 'Pay MonCash, NatCash or bank straight to a real person. The crypto is locked first, so nobody runs with your money.'),
      h('ul', { class: 'points' },
        pt('The seller\'s USDT is locked before you pay'),
        pt('We never hold your gourdes'),
        pt('A staff agent reads the proof if there is a problem'),
        pt('Haiti only. ID checked. Phones start with +509'))),
    h('div', { class: 'card' },
      h('h2', {}, t('Log in') + ' / ' + t('Sign up')),
      h('label', {}, t('Phone')), phone,
      h('label', {}, t('Full name (as on your ID)') + ' (sign up only)'), name,
      h('label', {}, 'Code'), code,
      h('button', { class: 'btn alt', onclick: act(async () => {
        const r = await api('POST', '/auth/request-code', { phone: phone.value.trim() });
        toast(cfg.mock_otp ? 'Test mode: no SMS is sent. Use code ' + cfg.mock_otp : 'Code sent. It works for ' + r.expires_in_min + ' minutes.');
      }) }, 'Send me a code'),
      h('div', {},
        h('button', { class: 'btn', onclick: act(async () => done(await api('POST', '/auth/login', { phone: phone.value.trim(), code: code.value.trim() }))) }, t('Log in')),
        h('button', { class: 'btn alt', onclick: act(async () => done(await api('POST', '/auth/signup', { phone: phone.value.trim(), full_name: name.value, code: code.value.trim() || undefined }))) }, t('Sign up'))))));
  if (cfg.demo) app.insertBefore(h('div', { class: 'card payto' },
    h('h2', {}, 'Quick test (fake money)'),
    h('p', { class: 'mute' }, 'Ready-made accounts. ID approved, payment account saved, wallet saved, 1000 fake USDT. Just click and trade.'),
    h('button', { class: 'btn good', onclick: act(async () => done(await api('POST', '/auth/demo-login', { who: 'buyer' }))) }, 'Log in as TEST BUYER'),
    h('button', { class: 'btn danger', onclick: act(async () => done(await api('POST', '/auth/demo-login', { who: 'seller' }))) }, 'Log in as TEST SELLER')), app.firstChild);
  publicAds(app);
}

// Home page for visitors: live ads from sellers, with different prices. Read only.
async function publicAds(app) {
  const wrap = h('div', { class: 'card' }, h('h2', {}, 'Live ads'), h('p', { class: 'mute' }, 'Prices are in gourdes (HTG) for 1 USDT. Log in to trade.'));
  app.append(wrap);
  const need = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); toast('Log in or sign up to trade.'); };
  const list = (title, ads, verb, cls) => h('div', {}, h('h3', {}, title),
    ads.length ? h('div', { class: 'ads' }, ads.map((a) => h('div', { class: 'ad' },
      h('div', { class: 'who' }, avatarEl(a.id, a.owner, a.has_avatar),
        h('div', {}, h('strong', {}, a.owner), h('div', { class: 'mute' }, whoLine(a)), repBadges(a))),
      h('div', {}, h('div', { class: 'lab' }, 'Price'), h('div', { class: 'price' }, money(a.price_htg), h('small', {}, ' HTG'))),
      h('div', {}, h('div', { class: 'lab' }, 'Available · Limits'), h('div', {}, usd(a.remaining) + ' ' + a.asset),
        h('div', { class: 'mute' }, `${money(a.min_order_htg, 0)} – ${money(a.max_order_htg, 0)} HTG`), h('span', { class: 'chip' }, a.pay_type)),
      h('button', { class: 'btn sm ' + cls, onclick: need }, verb)))) : h('p', { class: 'mute' }, 'No ads yet.'));
  try {
    const [sell, buy] = await Promise.all([api('GET', '/public/ads?side=SELL'), api('GET', '/public/ads?side=BUY')]);
    wrap.append(list('Buy USDT (sellers, lowest price first)', sell, t('Buy USDT'), 'good'), list('Sell USDT (buyers, highest price first)', buy, t('Sell USDT'), 'danger'));
  } catch (e) { wrap.append(h('p', { class: 'mute' }, 'Could not load ads.')); }
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
    box.replaceChildren(ads.length ? h('div', { class: 'ads' }, ads.map((a) => h('div', { class: 'ad' },
      h('div', { class: 'who' }, avatarEl(a.owner_id, a.owner_name, a.has_avatar),
        h('div', {}, h('strong', {}, a.owner_name), h('div', { class: 'mute' }, whoLine(a)), repBadges(a))),
      h('div', {}, h('div', { class: 'lab' }, t('Price')), h('div', { class: 'price' }, money(a.price_htg), h('small', {}, ' HTG'))),
      h('div', {}, h('div', { class: 'lab' }, t('Available') + ' · ' + t('Limits')),
        h('div', {}, usd(a.remaining) + ' ' + a.asset), h('div', { class: 'mute' }, `${money(a.min_order_htg, 0)} – ${money(a.max_order_htg, 0)} HTG`),
        h('span', { class: 'chip' }, a.pay_type)),
      a.owner_id === me.user.id ? h('span', { class: 'mute' }, 'your ad') : h('button', { class: 'btn sm ' + (marketSide === 'SELL' ? 'good' : 'danger'), onclick: () => takeAd(a) }, (marketSide === 'SELL' ? t('Buy USDT') : t('Sell USDT')))))) : h('p', { class: 'mute' }, 'No ads yet.'));
  });
  [asset, pay].forEach((s) => s.addEventListener('change', load));
  app.append(h('div', { class: 'card' },
    h('h2', {}, t('Market')),
    h('div', { class: 'seg' },
      h('button', { class: 'buy' + (marketSide === 'SELL' ? ' on' : ''), onclick: () => { marketSide = 'SELL'; route(); } }, t('Buy USDT')),
      h('button', { class: 'sell' + (marketSide === 'BUY' ? ' on' : ''), onclick: () => { marketSide = 'BUY'; route(); } }, t('Sell USDT'))),
    h('div', { class: 'row' }, asset, pay), box));
  load();
}

// Trust badges for a trader. Real numbers only: a new trader is shown as new, never with a made-up score.
function repBadges(a) {
  const out = [];
  if (a.is_business) out.push(h('span', { class: 'badge' }, '🏢 Business'));
  if (a.id_verified) out.push(h('span', { class: 'badge ok' }, '✓ ID checked'));
  if (a.trades > 0 && a.completion_pct != null) out.push(h('span', { class: 'badge' }, a.completion_pct + '% completed'));
  if (a.avg_release_min != null) out.push(h('span', { class: 'badge' }, '⏱ releases in ~' + (a.avg_release_min < 1 ? '1' : a.avg_release_min) + ' min'));
  if (!a.trades) out.push(h('span', { class: 'badge new' }, 'New trader'));
  return h('div', { class: 'badges' }, out);
}
const whoLine = (a) => `${a.trades} trade${a.trades === 1 ? '' : 's'}` + (a.rating ? ` · ${a.rating}★` : '');

function safetyView(app) {
  const step = (n, title, text) => h('div', { class: 'sstep' }, h('div', { class: 'snum' }, n), h('div', {}, h('b', {}, title), h('div', { class: 'mute' }, text)));
  app.append(h('div', { class: 'card narrow2' },
    h('h2', {}, 'How your money stays safe'),
    h('p', { class: 'mute' }, 'Short and simple. This is how every trade works here.'),
    step(1, 'The seller\'s crypto is locked first', 'Before a buyer pays anything, the USDT is locked in escrow. The seller cannot take it back.'),
    step(2, 'The buyer pays the seller directly', 'Gourdes go from the buyer to the seller by MonCash, NatCash or bank. We never hold gourdes.'),
    step(3, 'The seller checks, then releases', 'The seller looks at their own account. Only when the money is there, they press release.'),
    step(4, 'Problem? Staff decide', 'If something is wrong, open a dispute. Both sides upload proof. A staff agent decides. Big orders need two agents.'),
    h('h3', {}, 'Rules that protect you'),
    h('ul', { class: 'rules' },
      h('li', {}, 'Only real, ID-checked people can trade. The name on the payment account must match the ID.'),
      h('li', {}, 'The platform never releases crypto by itself. A timer alone never sends money.'),
      h('li', {}, 'If the seller goes quiet, a dispute opens automatically.'),
      h('li', {}, 'Every message and proof is kept, so staff can see what happened.'),
      h('li', {}, 'Fake proof or scams mean a ban.')),
    h('h3', {}, 'Stay safe yourself'),
    h('ul', { class: 'rules' },
      h('li', {}, 'Never pay outside the order. Never share your PIN or password.'),
      h('li', {}, 'Sellers: never release because of a screenshot. Look at your own account.'),
      h('li', {}, 'Buyers: write the payment code in the note, and pay the exact amount.')),
    h('button', { class: 'btn big-btn', onclick: () => go('market') }, 'Go to the market')));
}

const BANKS = ['Sogebank', 'Unibank', 'BNC', 'BUH', 'Capital Bank', 'Sogebel', 'Other'];
// Bank name picker. Returns the element and a function that gives the chosen name.
function bankPicker() {
  const sel = h('select', {}, BANKS.map((b) => h('option', {}, b))), other = h('input', { placeholder: 'Bank name', class: 'hidden' });
  sel.addEventListener('change', () => other.classList.toggle('hidden', sel.value !== 'Other'));
  return { el: h('div', {}, sel, other), value: () => (sel.value === 'Other' ? other.value.trim() : sel.value) };
}

function takeAd(a) {
  const minU = Math.ceil(Number(a.min_order_htg) / Number(a.price_htg)), maxU = Math.min(Number(a.remaining), Math.floor(Number(a.max_order_htg) / Number(a.price_htg)));
  const amount = h('input', { inputmode: 'decimal', placeholder: 'Amount in ' + a.asset, value: cfg.demo ? String(Math.min(minU + 2, maxU)) : '' });
  const total = h('div', { class: 'big' }, '0 HTG');
  const upd = () => { total.textContent = money(Number(amount.value || 0) * Number(a.price_htg)) + ' HTG'; };
  amount.addEventListener('input', upd); upd();
  const mine = (me.payment_methods || []).filter((p) => p.type === a.pay_type && p.verified);
  const pm = h('select', {}, mine.map((p) => h('option', { value: p.id }, `${p.bank_name ? p.bank_name : p.type} · ${p.account_ref} · ${p.account_name}`)));
  const nm = h('input', { value: me.user.full_name }), nr = h('input', { inputmode: 'numeric', placeholder: a.pay_type === 'BANK' ? 'Bank account number' : a.pay_type + ' phone number' });
  const bank = a.pay_type === 'BANK' ? bankPicker() : null;
  const addBox = h('div', { class: 'addacc' + (mine.length ? ' hidden' : '') },
    h('p', { class: 'mute' }, mine.length ? 'Add another ' + a.pay_type + ' account.' : `You have no ${a.pay_type} account yet. Add one. The name must match your ID.`),
    bank ? [h('label', {}, 'Which bank?'), bank.el] : null,
    h('label', {}, 'Name on the account'), nm, h('label', {}, a.pay_type === 'BANK' ? 'Account number' : 'Phone number'), nr,
    h('button', { class: 'btn alt sm', onclick: act(async () => {
      const r = await api('POST', '/payment-methods', { type: a.pay_type, account_name: nm.value.trim(), account_ref: nr.value.trim(), bank_name: bank ? bank.value() : undefined });
      me = await api('GET', '/me');
      if (!r.verified) { toast('Saved, but the name does not match your ID yet. Staff must approve it.', true); }
      takeAd(a);
    }) }, 'Save account'));
  const body = [h('button', { class: 'back', onclick: route }, '← Back to market'),
    h('h2', {}, `${a.side === 'SELL' ? t('Buy USDT') : t('Sell USDT')} @ ${money(a.price_htg)} HTG`),
    h('div', { class: 'tcard' }, avatarEl(a.owner_id, a.owner_name, a.has_avatar),
      h('div', {}, h('b', {}, a.owner_name), h('div', { class: 'mute' }, whoLine(a) + ' · member since ' + new Date(a.member_since).toLocaleDateString([], { month: 'short', year: 'numeric' })), a.bio ? h('div', { class: 'bio' }, a.bio) : null, repBadges(a))),
    h('div', { class: 'kv' }, kv([['Available', usd(a.remaining) + ' ' + a.asset], ['Limits per order', `${money(a.min_order_htg, 0)} – ${money(a.max_order_htg, 0)} HTG`], ['Pay by', a.pay_type]])),
    h('label', {}, 'How many ' + a.asset + '? (not gourdes)'), amount, h('div', { class: 'mute' }, `You can trade from ${minU} to ${maxU} ${a.asset}.`), h('div', { class: 'mute' }, 'You ' + (a.side === 'SELL' ? 'pay' : 'receive')), total];
  if (a.side === 'BUY') {
    body.push(h('label', {}, 'Where do you want to get paid?'), mine.length ? pm : null,
      mine.length ? h('button', { class: 'linkbtn', onclick: () => addBox.classList.toggle('hidden') }, '+ Add another number or account') : null, addBox);
  }
  body.push(h('button', { class: 'btn big-btn', onclick: act(async () => {
    if (a.side === 'BUY' && !mine.length) throw new Error('Add your ' + a.pay_type + ' account first.');
    const o = await api('POST', '/orders', { ad_id: a.id, amount: amount.value.trim(), payment_method_id: a.side === 'BUY' ? pm.value : undefined });
    go('order/' + o.id);
  }) }, 'Continue'));
  body.push(h('p', { class: 'mute center' }, '🔒 The USDT is locked in escrow before you pay (' + (cfg.network ? cfg.network.charAt(0) + cfg.network.slice(1).toLowerCase() : 'blockchain') + '). ', h('a', { href: '#safety' }, 'How it works')));
  $('#app').replaceChildren(h('div', { class: 'card narrow' }, body));
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
      h('div', {}, field('price_htg', 'Price (HTG per 1)', h('input', { inputmode: 'decimal', value: cfg.demo ? '140' : '' }))),
      h('div', {}, field('amount', 'Amount', h('input', { inputmode: 'decimal', value: cfg.demo ? '100' : '' }))),
      h('div', {}, field('min_order_htg', 'Min order (HTG)', h('input', { inputmode: 'decimal', value: cfg.demo ? '500' : '' }))),
      h('div', {}, field('max_order_htg', 'Max order (HTG)', h('input', { inputmode: 'decimal', value: cfg.demo ? '10000' : '' })))),
    field('payment_method_id', 'Payment account (sell ads: where you get paid)', h('select', {}, pms.map((p) => h('option', { value: p.id }, `${p.bank_name || p.type} ${p.account_ref} (${p.account_name})`)))),
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

function stepper(s) {
  const at = { ORDER_CREATED: 0, AWAITING_PAYMENT: 1, PAID_CLAIMED: 2, DISPUTED: 2, RELEASING: 3, COMPLETED: 4, REFUNDING: 3, REFUNDED: 4, CANCELLED_TIMEOUT: 4 }[s];
  const bad = ['DISPUTED', 'REFUNDING', 'REFUNDED', 'CANCELLED_TIMEOUT'].includes(s);
  const names = ['Locked', 'Pay', 'Seller checks', 'Release', 'Done'];
  return h('div', { class: 'steps' }, names.map((n, i) => h('div', { class: 'step' + (i < at ? ' done' : i === at ? (bad ? ' bad' : ' now') : '') }, i === 3 && ['REFUNDING', 'REFUNDED'].includes(s) ? 'Refund' : n)));
}

async function ordersView(app) {
  const list = await api('GET', '/orders');
  app.append(h('div', { class: 'card scroll' }, h('h2', {}, t('My orders')), list.length ? h('table', {},
    h('thead', {}, h('tr', {}, ['When', 'Role', t('Amount'), 'HTG', t('Status'), ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, list.map((o) => h('tr', {},
      h('td', {}, new Date(o.created_at).toLocaleString()), h('td', {}, o.buyer_id === me.user.id ? t('Buyer') : t('Seller')),
      h('td', {}, usd(o.amount) + ' ' + o.asset), h('td', {}, money(o.total_htg)), h('td', {}, statePill(o.state)),
      h('td', {}, h('button', { class: 'btn alt', onclick: () => go('order/' + o.id) }, 'Open')))))) : h('p', { class: 'mute' }, 'No orders yet.')));
}

// Small pop-up window used instead of the browser's plain confirm/prompt boxes.
function modal(title, body, actions) {
  const back = h('div', { class: 'modal-back' });
  const close = () => back.remove();
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, title), body,
    h('div', { class: 'modal-actions' }, actions.map((a) => h('button', { class: 'btn ' + (a.cls || 'alt'),
      onclick: act(async () => { if (a.run && (await a.run()) === false) return; close(); }) }, a.label))));
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.append(box); document.body.append(back);
  return close;
}

async function orderView(app, id) {
  const left = h('div', { class: 'col' }), right = h('div', { class: 'col' });
  app.append(h('div', { class: 'order-grid' }, left, right));
  let busy = false, lastView = null, sig = '', n = 0;
  const draw = async () => {
    if (busy) return; busy = true;
    try {
      const v = await api('GET', '/orders/' + id); lastView = v;
      const chat = await api('GET', `/orders/${id}/chat`);
      // Redraw only when something changed, so typing in a box is never wiped.
      const next = v.order.updated_at + '|' + v.events.length + '|' + chat.length + '|' + (v.dispute ? v.dispute.status : '') + '|' + v.evidence.length;
      if (next !== sig) { sig = next; renderOrder(left, v); renderChat(right, v, chat); }
    } catch (e) { toast(e.message, true); } finally { busy = false; }
  };
  await draw();
  timer = setInterval(() => { tickClock(lastView); if (++n % 4 === 0) draw(); }, 1000);
}

function tickClock(v) {
  const el = $('#clock'); if (!el || !v || !v.order.state_deadline) return;
  const skew = Date.now() - new Date(v.server_time).getTime();
  const end = new Date(v.order.state_deadline).getTime() + skew;
  const left = Math.round((end - Date.now()) / 1000);
  let txt = left >= 0 ? (left >= 3600 ? `${Math.floor(left / 3600)}h ${Math.floor(left % 3600 / 60)}m` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`) : 'time is up';
  if (left < 0 && v.order.state === 'AWAITING_PAYMENT') {
    const g = Math.round((end + v.grace_min * 60000 - Date.now()) / 1000);
    txt = g > 0 ? `grace ${Math.floor(g / 60)}:${String(g % 60).padStart(2, '0')}` : 'refund soon';
  }
  el.textContent = txt;
}

// Profile picture if the person has one, otherwise their first letter.
function avatarEl(id, name, has, cls = '') {
  const l = (name || '?').trim()[0].toUpperCase();
  const d = h('div', { class: 'avatar ' + cls }, l);
  if (has && id) { const img = h('img', { src: '/api/avatar/' + id, alt: '' }); img.onerror = () => img.remove(); d.append(img); }
  return d;
}
const initial = (name) => (name || '?').trim()[0].toUpperCase();
const hm = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const kv = (rows) => h('div', { class: 'kv' }, rows.filter(Boolean).map(([k, v]) => h('div', { class: 'kvrow' }, h('span', {}, k), h('b', {}, v))));

// ----- dispute window: reason, details, documents -----
const REASONS = {
  BUYER: ['I paid, but the seller did not release', 'The seller says they did not receive my payment', 'The seller asks for more money or wants to leave the app', 'Other'],
  SELLER: ['I did not receive the money', 'The amount I received is wrong', 'The payment came from a different name', 'Other'],
};
const DOC_KINDS = [['RECEIPT', 'Payment receipt'], ['STATEMENT', 'Account statement'], ['CHAT_EXPORT', 'Chat screenshot'], ['OTHER', 'Other document']];
const toB64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });

async function uploadFiles(orderId, files, kind) {
  for (const f of files) await api('POST', `/orders/${orderId}/evidence/upload`, { kind, filename: f.name, data: await toB64(f) });
}

function filePicker() {
  const input = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp,application/pdf', class: 'hidden' });
  const list = h('div', { class: 'files' });
  const box = h('label', { class: 'drop' }, input, h('div', { class: 'drop-ic' }, '⬆'), h('b', {}, 'Add photos or PDF'), h('span', { class: 'mute' }, 'PNG, JPG, WEBP or PDF. Up to 4 MB each.'));
  input.addEventListener('change', () => list.replaceChildren(...[...input.files].map((f) => h('div', { class: 'file' }, '📎 ' + f.name))));
  return { el: h('div', {}, box, list), files: () => [...input.files] };
}

function openDisputeWindow(v) {
  const o = v.order;
  const reason = h('select', {}, REASONS[v.role].map((r) => h('option', {}, r)));
  const text = h('textarea', { rows: 4, placeholder: 'Tell us what happened. Be clear and honest. Say the time, the amount and what you did.' });
  const kind = h('select', {}, DOC_KINDS.map(([k, l]) => h('option', { value: k }, l)));
  const pick = filePicker();
  modal('Open a dispute', h('div', {},
    h('p', { class: 'mute' }, 'A staff agent will read both sides and the proof, then decide. The crypto stays locked until then. Fake proof means a ban.'),
    h('label', {}, 'What is the problem?'), reason,
    h('label', {}, 'Details'), text,
    h('label', {}, 'Proof (you can also add it later)'), kind, pick.el),
  [{ label: 'Cancel' }, { label: 'Submit dispute', cls: 'danger', run: async () => {
    if (text.value.trim().length < 10) throw new Error('Write at least a few words about what happened.');
    await api('POST', `/orders/${o.id}/dispute`, { reason: `${reason.value}: ${text.value.trim()}` });
    if (pick.files().length) await uploadFiles(o.id, pick.files(), kind.value).catch((e) => toast('Dispute opened, but a file failed: ' + e.message, true));
    toast('Dispute opened. A staff agent will review it.'); route();
  } }]);
}

function openReleaseWindow(v) {
  const o = v.order;
  modal('Release the USDT?', h('div', {},
    h('p', {}, 'Open your ', h('b', {}, v.payment ? v.payment.type : 'payment'), ' app or bank and look at your account. Only release when you can see the money.'),
    kv([['Amount to receive', money(o.total_htg) + ' HTG'], ['From', v.buyer.full_name], ['Payment note code', o.pay_reference]]),
    h('p', { class: 'warn-note' }, 'Once released, it cannot be undone. Never release because of a screenshot alone.')),
  [{ label: 'Not yet' }, { label: 'Yes, I received it. Release.', cls: 'good', run: async () => {
    await api('POST', `/orders/${o.id}/confirm`, cfg.chain ? await signRelease(o.id) : undefined); route();
  } }]);
}

function openCancelWindow(v) {
  modal('Cancel this order?', h('p', {}, 'Only cancel if you have NOT sent any money. If you already paid, press "I have paid" or open a dispute instead.'),
    [{ label: 'Keep order' }, { label: 'Yes, cancel', cls: 'danger', run: async () => { await api('POST', `/orders/${v.order.id}/cancel`); route(); } }]);
}

// ----- what the person should do now -----
function guide(v) {
  const o = v.order, r = v.role, s = o.state, buyer = r === 'BUYER', seller = r === 'SELLER';
  const dispBtn = h('button', { class: 'btn alt sm', onclick: () => openDisputeWindow(v) }, buyer ? 'Problem? Open a dispute' : 'Not received? Open a dispute');
  if (r === 'STAFF') return { tone: '', title: 'Staff view', text: 'You are reading this order as staff.', actions: [] };
  if (buyer && s === 'AWAITING_PAYMENT') return { tone: 'go', title: `Pay ${money(o.total_htg)} HTG now`, steps: [
      `Open your ${v.payment ? (v.payment.bank_name || v.payment.type) : 'payment'} app or bank.`, `Send exactly ${money(o.total_htg)} HTG to the account below.`,
      `Write the code ${o.pay_reference} in the payment note.`, 'Come back and press "I have paid".'],
    actions: [h('button', { class: 'btn good', onclick: act(async () => { await api('POST', `/orders/${o.id}/paid`); route(); }) }, 'I have paid'),
      h('button', { class: 'btn alt', onclick: () => openCancelWindow(v) }, 'Cancel order')] };
  if (seller && s === 'AWAITING_PAYMENT') return { tone: 'wait', title: 'Waiting for the buyer to pay', text: `Your USDT is locked and safe. The buyer must send ${money(o.total_htg)} HTG to your account. Do not release anything yet.`, actions: [] };
  if (buyer && s === 'PAID_CLAIMED') return { tone: 'wait', title: 'Waiting for the seller to confirm', text: 'The seller is checking their account. When they confirm, the USDT comes to you. If they do not answer in time, a dispute opens by itself.', actions: [dispBtn] };
  if (seller && s === 'PAID_CLAIMED') return { tone: 'go', title: `Did ${money(o.total_htg)} HTG arrive in your account?`, text: `Check your ${v.payment ? v.payment.type : 'payment'} app or bank. Look for the code ${o.pay_reference}. Release only if you see the money.`,
    actions: [h('button', { class: 'btn good', onclick: () => openReleaseWindow(v) }, 'Yes, release the USDT'), dispBtn] };
  if (s === 'DISPUTED') return { tone: 'bad', title: 'Dispute open. A staff agent is deciding', text: 'Add your proof below. Keep chatting here, politely. Do not send money outside the app.', actions: [] };
  if (s === 'RELEASING') return { tone: 'wait', title: 'Sending the USDT', text: 'This takes a moment.', actions: [] };
  if (s === 'REFUNDING') return { tone: 'wait', title: 'Returning the USDT to the seller', text: 'This takes a moment.', actions: [] };
  if (s === 'COMPLETED') return { tone: 'done', title: buyer ? 'Done. The USDT is yours' : 'Done. Trade complete', text: 'Thank you. Please rate the other person.', actions: [], rate: true };
  if (s === 'REFUNDED') return { tone: '', title: 'Order closed', text: 'The USDT went back to the seller. No money moved.', actions: [] };
  if (s === 'CANCELLED_TIMEOUT') return { tone: '', title: 'Order cancelled', text: 'The lock did not finish in time. Nothing was charged.', actions: [] };
  return { tone: 'wait', title: 'Locking the USDT', text: 'One moment.', actions: [] };
}

function renderOrder(col, v) {
  const o = v.order, r = v.role, other = r === 'BUYER' ? v.seller : v.buyer;
  const g = guide(v);
  const rate = g.rate && r !== 'STAFF' ? h('div', { class: 'rate' }, [1, 2, 3, 4, 5].map((n) => h('button', { class: 'star', onclick: act(async () => { await api('POST', `/orders/${o.id}/rate`, { stars: n }); toast('Thanks for your rating.'); }) }, '★' + n))) : null;
  const pay = v.payment && ['AWAITING_PAYMENT', 'PAID_CLAIMED', 'DISPUTED'].includes(o.state) ? h('div', { class: 'card ' + (r === 'BUYER' && o.state === 'AWAITING_PAYMENT' ? 'payto' : '') },
    h('h3', { class: 'ct' }, r === 'BUYER' ? 'Pay to this account' : 'Your receiving account'),
    kv([v.payment.bank_name ? ['Bank', v.payment.bank_name] : null, [v.payment.type === 'BANK' ? 'Account number' : v.payment.type + ' number', v.payment.account_ref], ['Account name', v.payment.account_name], ['Amount', money(o.total_htg) + ' HTG']]),
    h('div', { class: 'mute', style: 'margin-top:10px' }, r === 'BUYER' ? 'Write this code in the payment note:' : 'The buyer must write this code in the note:'),
    h('div', { class: 'code' }, o.pay_reference, h('button', { onclick: () => { navigator.clipboard?.writeText(o.pay_reference); toast('Code copied.'); } }, 'Copy'))) : null;

  const dispute = v.dispute ? disputePanel(v, o) : null;
  col.replaceChildren(...[
    h('div', { class: 'card' },
      h('div', { class: 'ohead' },
        h('div', {}, h('div', { class: 'mute' }, r === 'BUYER' ? 'You buy' : r === 'SELLER' ? 'You sell' : 'Order'), h('div', { class: 'big' }, usd(o.amount) + ' ' + o.asset)),
        h('div', { class: 'timer' }, h('div', { class: 'lab' }, t('Time left')), h('div', { class: 'tnum', id: 'clock' }, '–'))),
      stepper(o.state),
      h('div', { class: 'cp' }, avatarEl(other.id, other.full_name, other.has_avatar),
        h('div', {}, h('b', {}, other.full_name), h('div', { class: 'mute' }, r === 'BUYER' ? 'Seller' : 'Buyer', ' · ID checked ✓')), statePill(o.state))),
    h('div', { class: 'card guide ' + g.tone },
      h('h2', {}, g.title),
      g.steps ? h('ol', { class: 'gsteps' }, g.steps.map((x) => h('li', {}, x))) : h('p', { class: 'gtext' }, g.text),
      rate, h('div', { class: 'gactions' }, g.actions)),
    ['ORDER_CREATED', 'AWAITING_PAYMENT', 'PAID_CLAIMED', 'DISPUTED', 'RELEASING'].includes(o.state)
      ? h('div', { class: 'escrow' }, h('b', {}, '🔒 ' + usd(o.amount) + ' ' + o.asset + ' is held in escrow'), h('span', {}, 'The seller cannot take it back. The buyer cannot touch it until the seller confirms the money, or staff decide.')) : null,
    pay, dispute,
    h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'Order details'),
      kv([['Price', money(o.price_htg) + ' HTG per ' + o.asset], ['You ' + (r === 'SELLER' ? 'sell' : 'buy'), usd(o.amount) + ' ' + o.asset], ['Total', money(o.total_htg) + ' HTG'],
        ['Platform fee', usd(o.fee_amount) + ' ' + o.asset + ' (paid by the seller)'], ['Order number', o.id.slice(0, 8).toUpperCase()]])),
    h('details', { class: 'card' }, h('summary', {}, 'History'), h('div', { class: 'timeline' },
      v.events.map((e) => h('div', {}, hm(e.created_at) + '  ' + (e.to_state || '').replaceAll('_', ' ').toLowerCase() + (e.note ? ' · ' + e.note : '')),
      v.escrow.map((x) => h('div', {}, `escrow ${x.kind.toLowerCase()}: ${x.status.toLowerCase()}` + (x.tx_hash ? ' ' + x.tx_hash.slice(0, 14) + '…' : '')))))),
  ].filter(Boolean));
  tickClock(v);
}

function disputePanel(v, o) {
  const d = v.dispute, open = d.status === 'OPEN', party = v.role !== 'STAFF';
  const status = open ? ['In review', 'bad'] : d.status === 'RESOLVED_BUYER' ? ['Decided for the buyer', 'good'] : ['Decided for the seller', 'good'];
  const kind = h('select', {}, DOC_KINDS.map(([k, l]) => h('option', { value: k }, l)));
  const pick = filePicker();
  return h('div', { class: 'card dispute' },
    h('div', { class: 'dhead' }, h('h3', { class: 'ct' }, 'Dispute'), h('span', { class: 'pill ' + status[1] }, status[0])),
    h('div', { class: 'quote' }, d.reason),
    open ? h('p', { class: 'mute' }, 'Proof must be added before ', h('b', {}, new Date(d.evidence_due).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })), '.') : null,
    h('h3', { class: 'ct' }, 'Documents (' + v.evidence.length + ')'),
    v.evidence.length ? h('div', { class: 'docs' }, v.evidence.map((e) => h('div', { class: 'doc' },
      h('span', { class: 'chip' }, (DOC_KINDS.find((k) => k[0] === e.kind) || [0, e.kind])[1]),
      e.file_ref.startsWith('upload:') ? h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); act(() => openProof(e.id))(); } }, '📎 ' + (e.orig_name || 'file')) : h('span', {}, e.file_ref),
      h('span', { class: 'mute' }, (e.by === v.role ? 'You' : e.by === 'BUYER' ? 'Buyer' : 'Seller') + ' · ' + hm(e.created_at))))) : h('p', { class: 'mute' }, 'No documents yet.'),
    open && party ? h('div', {}, h('label', {}, 'Add proof'), kind, pick.el,
      h('button', { class: 'btn sm', onclick: act(async () => {
        if (!pick.files().length) throw new Error('Pick a file first.');
        await uploadFiles(o.id, pick.files(), kind.value); toast('Proof added.'); route();
      }) }, 'Upload'),
      h('p', { class: 'mute' }, 'Tip: a receipt screenshot alone may not be enough. Add your own account statement too.')) : null,
    d.decision_note ? h('div', { class: 'quote ok' }, h('b', {}, 'Decision: '), d.decision_note) : null);
}

// Open a stored proof file. It needs the login token, so fetch it and show it as a blob.
async function openProof(id) {
  const r = await fetch('/api/evidence/' + id + '/file', { headers: { authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Could not open the file.');
  window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener');
}
const proofLine = (e, who) => h('div', {}, `${e.kind} (${who}): `, e.file_ref.startsWith('upload:')
  ? h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); act(() => openProof(e.id))(); } }, e.orig_name || 'file')
  : e.file_ref);

// ----- chat: one place for buyer and seller -----
function renderChat(col, v, msgs) {
  const o = v.order, other = v.role === 'BUYER' ? v.seller : v.buyer;
  const name = (id) => (id === v.buyer.id ? v.buyer : v.seller).full_name;
  const closed = ['COMPLETED', 'REFUNDED', 'CANCELLED_TIMEOUT'].includes(o.state) && v.role !== 'STAFF';
  const log = h('div', { class: 'chatlog' }, msgs.length ? msgs.map((m) => m.sender_id === null
    ? h('div', { class: 'sysmsg' }, m.body)
    : h('div', { class: 'bub ' + (m.sender_id === me.user.id ? 'me' : '') }, h('div', { class: 'bt' }, m.body), h('div', { class: 'bm' }, (m.sender_id === me.user.id ? 'You' : name(m.sender_id).split(' ')[0]) + ' · ' + hm(m.created_at))))
    : [h('div', { class: 'sysmsg' }, 'Say hello. Keep all talk here, where staff can see it if there is a problem.')]);
  const input = h('input', { placeholder: 'Write a message…', maxlength: 500 });
  const sendText = async (text) => { if (!text.trim()) return; await api('POST', `/orders/${o.id}/chat`, { body: text }); input.value = ''; route(); };
  const send = act(() => sendText(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  const quick = v.role === 'BUYER' ? ['I have paid. Please check.', 'Thank you!', 'Please confirm when you see it.'] : v.role === 'SELLER' ? ['Checking now.', 'I do not see it yet.', 'Received. Thank you!'] : [];
  col.replaceChildren(h('div', { class: 'card chat' },
    h('div', { class: 'chead' }, avatarEl(other.id, other.full_name, other.has_avatar), h('div', {}, h('b', {}, other.full_name), h('div', { class: 'mute' }, 'Order chat'))),
    log,
    closed ? h('p', { class: 'mute', style: 'text-align:center' }, 'This chat is closed.') : [
      quick.length ? h('div', { class: 'quick' }, quick.map((q) => h('button', { onclick: act(() => sendText(q)) }, q))) : null,
      v.role === 'STAFF' ? h('p', { class: 'mute' }, 'Staff can read but not write here.') : h('div', { class: 'compose' }, input, h('button', { class: 'btn sm', onclick: send }, t('Send')))],
    h('div', { class: 'safe' }, '🔒 Stay in the app. No links or phone numbers. Never pay outside the order.')));
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


// Where do you want to receive crypto? Binance UID and/or a wallet on a network.
function payoutCard() {
  const u = me.user, nets = cfg.networks || [];
  const uid = h('input', { inputmode: 'numeric', placeholder: 'Binance UID, for example 123456789', value: u.binance_uid || '' });
  const net = h('select', {}, nets.map((n) => h('option', { value: n.id, selected: n.id === (u.payout_network || cfg.network) }, n.label)));
  const addr = h('input', { placeholder: 'Wallet address on that network', value: u.payout_addr || '' });
  const hint = h('div', { class: 'mute' });
  const paint = () => { const n = nets.find((x) => x.id === net.value) || {}; hint.textContent = (n.fee || '') + (n.auto ? '. Automatic payouts work on this network.' : '. Saved for staff payouts. Not automatic yet.'); };
  net.addEventListener('change', paint); paint();
  const fake = { TRON: () => 'T' + Array.from(crypto.getRandomValues(new Uint8Array(33)), (b) => '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[b % 58]).join(''), };
  const evm = () => '0x' + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join('');
  return h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'Where do I receive crypto?'),
    h('p', { class: 'mute' }, 'Binance UID is the easiest: a Binance to Binance transfer has no network fee. Or use a wallet.'),
    h('label', {}, 'Binance UID'), uid,
    h('label', {}, 'Or a wallet: choose the network'), net, hint,
    h('label', {}, 'Wallet address'), addr,
    h('div', { class: 'warn-note', style: 'margin-top:10px' }, 'Be careful. If you pick the wrong network, the money can be lost forever. Always check the network and the address.'),
    h('div', { class: 'gactions', style: 'margin-top:12px' },
      cfg.demo ? h('button', { class: 'btn alt', onclick: () => { uid.value = '123456789'; addr.value = (fake[net.value] || evm)(); } }, 'Fill with test data') : null,
      h('button', { class: 'btn', onclick: act(async () => { await api('PUT', '/me/payout', { binance_uid: uid.value, network: addr.value ? net.value : undefined, address: addr.value }); me = await api('GET', '/me'); toast('Saved.'); }) }, 'Save')));
}

// ---------- wallet ----------
async function walletView(app) {
  const w = me.wallet;
  const amt = h('input', { value: '100', inputmode: 'decimal' });
  const asset = h('select', {}, h('option', {}, 'USDT'), h('option', {}, 'USDC'));
  const fakeAddr = () => '0x' + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join('');
  const addr = h('input', { value: me.user.wallet_addr || (cfg.demo ? fakeAddr() : ''), placeholder: 'Your USDT wallet address (for withdrawals when live)' });
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
      h('button', { class: 'btn alt', onclick: act(async () => { await api('PUT', '/me/wallet-address', { wallet_addr: addr.value.trim() }); toast('Saved.'); }) }, 'Save address')]),
    payoutCard());
}

// ---------- profile ----------
// Shrink a chosen photo to a small square JPEG in the browser, so uploads stay tiny.
function shrinkPhoto(file) {
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const m = Math.min(img.width, img.height), sx = (img.width - m) / 2, sy = (img.height - m) / 2;
      c.getContext('2d').drawImage(img, sx, sy, m, m, 0, 0, S, S); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => no(new Error('Could not read that picture.')); img.src = url;
  });
}

async function profileView(app) {
  const u = me.user;
  const nm = h('input', { value: u.full_name }); const doc = h('input', { placeholder: 'Link or file name of your ID photo', value: cfg.demo ? 'test-id-photo' : '' });
  const type = h('select', {}, h('option', {}, 'MONCASH'), h('option', {}, 'NATCASH'), h('option', {}, 'BANK'));
  const bank = bankPicker(), bankRow = h('div', { class: 'hidden' }, h('label', {}, 'Which bank?'), bank.el);
  type.addEventListener('change', () => bankRow.classList.toggle('hidden', type.value !== 'BANK'));
  const an = h('input', { placeholder: 'Name on the account (must match your ID)', value: cfg.demo ? u.full_name : '' });
  const ar = h('input', { placeholder: 'Phone number or bank account number', value: cfg.demo ? '37' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0') : '' });
  // public profile
  const pub = h('input', { value: u.display_name || '', placeholder: 'Optional. A company or trading name', maxlength: 40 });
  const bio = h('textarea', { rows: 2, maxlength: 160, placeholder: 'Optional. One line about you. No phone numbers or links.' }, u.bio || '');
  let photo;
  const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const prev = h('div', { class: 'avwrap' }, avatarEl(u.id, u.display_name || u.full_name, u.has_avatar, 'xl'));
  file.addEventListener('change', act(async () => {
    if (!file.files[0]) return; photo = await shrinkPhoto(file.files[0]);
    prev.replaceChildren(h('div', { class: 'avatar xl' }, h('img', { src: photo, alt: '' })));
  }));
  const save = act(async () => { await api('PUT', '/me/profile', { display_name: pub.value, bio: bio.value, avatar: photo }); me = await api('GET', '/me'); toast('Profile saved.'); route(); });
  const methods = me.payment_methods;
  app.append(
    h('div', { class: 'card' }, h('h2', {}, t('Profile')),
      h('div', { class: 'pfhead' }, prev, h('div', {}, h('b', {}, u.display_name || u.full_name), h('div', { class: 'mute' }, u.display_name ? 'ID name: ' + u.full_name + ' (private)' : u.phone),
        h('span', { class: 'pill ' + (u.tier >= 1 ? 'good' : 'warn') }, 'Tier ' + u.tier), u.strikes ? h('span', { class: 'pill bad' }, u.strikes + ' strike(s)') : null)),
      u.tier < 1 ? [h('h3', {}, 'ID check'), h('p', { class: 'mute' }, 'Send your ID details. Staff will review. You cannot trade before this.'),
        h('label', {}, 'Name on ID'), nm, h('label', {}, 'ID photo reference'), doc,
        h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/kyc', { name_on_id: nm.value, id_doc_ref: doc.value }); toast('Sent. Wait for staff.'); }) }, 'Send for review')] : h('p', { class: 'mute' }, '✓ ID check done.')),
    h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'What other people see'),
      h('p', { class: 'mute' }, 'Add a photo and a public name so buyers and sellers trust you. Your real name stays private if you use a company name.'),
      h('label', {}, 'Photo'), h('div', {}, h('label', { class: 'btn alt sm filebtn' }, file, 'Choose a photo'), h('span', { class: 'mute' }, ' Any picture. We make it small.')),
      h('label', {}, 'Public name or company'), pub, h('label', {}, 'About you'), bio,
      h('button', { class: 'btn', style: 'margin-top:12px', onclick: save }, 'Save profile')),
    h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'My payment accounts'),
      h('p', { class: 'mute' }, 'You can add MonCash, NatCash and bank accounts, and as many numbers as you want. The name on each one must match your ID.'),
      methods.length ? h('div', { class: 'accs' }, methods.map((p) => h('div', { class: 'acc' },
        h('div', {}, h('b', {}, p.bank_name ? p.bank_name : p.type), h('div', { class: 'mute' }, `${p.type === 'BANK' ? 'Account' : p.type} ${p.account_ref} · ${p.account_name}`)),
        h('span', { class: 'pill ' + (p.verified ? 'good' : 'warn') }, p.verified ? 'verified' : 'name does not match ID'))))
        : h('p', { class: 'mute' }, 'None yet. Add one after your ID check is approved.'),
      h('h3', { class: 'ct', style: 'margin-top:16px' }, 'Add an account'),
      h('label', {}, 'Type'), type, bankRow, h('label', {}, 'Name on the account'), an, h('label', {}, 'Number'), ar,
      h('button', { class: 'btn', style: 'margin-top:12px', onclick: act(async () => { await api('POST', '/payment-methods', { type: type.value, account_name: an.value, account_ref: ar.value, bank_name: type.value === 'BANK' ? bank.value() : undefined }); me = await api('GET', '/me'); route(); }) }, 'Add account')));
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
