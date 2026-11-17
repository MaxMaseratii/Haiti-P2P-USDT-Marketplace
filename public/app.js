'use strict';
// ---------- tiny helpers ----------
const $ = (s) => document.querySelector(s);
let lang = (() => { try { return localStorage.getItem('lang'); } catch { return null; } })() || 'ht'; // Kreyòl first: this is for Haiti
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
const usd2 = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });

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
// Go to a page. Same page again = redraw it (fresh data).
function go(hash) { if (location.hash.slice(1) === hash) route(); else location.hash = hash; }
window.addEventListener('hashchange', route);
$('#lang').value = lang;
$('#lang').addEventListener('change', (e) => { lang = e.target.value; localStorage.setItem('lang', lang); route(); });

async function route() {
  stopTimer();
  // Each draw gets its own box. If a newer draw starts, the old one writes into a box nobody sees.
  const app = h('div', { class: 'view' }); $('#app').replaceChildren(app);
  if (!cfg.escrow_mode) cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  const ban = $('#banner');
  const alerts = cfg.provider_alerts || [];
  ban.hidden = !alerts.length;
  if (alerts.length) ban.textContent = '⚠️ ' + alerts.map((x) => PAY_NAME[x.provider] || x.provider).join(', ') + ': ' + t('known problem right now. Payments can arrive late. Disputes wait, and your crypto stays locked.') + (alerts[0].note ? ' ' + alerts[0].note : '');
  if (location.hash.startsWith('#legal')) { if (token && !me) { try { me = await api('GET', '/me'); } catch {} } renderNav(); return legalView(app, location.hash.split('/')[1]); }
  if (location.hash === '#welcome') { if (token && !me) { try { me = await api('GET', '/me'); } catch {} } renderNav(); return authView(app); } // the public home page, also for logged-in people
  if (location.hash.startsWith('#u/')) { // public business profile: works logged in or not
    if (token && !me) { try { me = await api('GET', '/me'); } catch {} }
    renderNav();
    try { return await publicProfileView(app, location.hash.split('/')[1]); } catch (e) { return app.append(h('div', { class: 'card' }, h('p', {}, e.message))); }
  }
  if (!token && location.hash === '#safety') { renderNav(); return safetyView(app); }
  if (!token) { renderNav(); return authView(app); }
  try { const m = await api('GET', '/me'); me = m; } catch { return; }
  renderNav();
  if (me.user.terms_ok === false && !document.querySelector('.terms-gate')) termsGate();
  const [view, arg] = (location.hash.slice(1) || 'home').split('/');
  const views = { market: marketView, ads: adsView, orders: ordersView, order: orderView, wallet: walletView, profile: profileView, staff: staffView, admin: adminView, dispute: disputeView, safety: safetyView, linked: linkedView, home: accountHome };
  try { await (views[view] || marketView)(app, arg); } catch (e) { toast(e.message, true); }
}

function renderNav() {
  const nav = $('#nav'); nav.replaceChildren();
  document.body.classList.toggle('in', !!token);
  if (!token) { $('#tabs').replaceChildren(); return; }
  const cur = (location.hash.slice(1) || 'home').split('/')[0];
  const items = [['home', 'Home'], ['market', 'Market'], ['ads', 'My ads'], ['orders', 'My orders'], ['linked', 'Linked accounts'], ['wallet', 'Wallet'], ['profile', 'Profile'], ['safety', 'Safety']];
  if (me && ['AGENT', 'ADMIN'].includes(me.user.role)) items.push(['staff', 'Staff']);
  if (me && me.user.role === 'ADMIN') items.push(['admin', 'Admin']);
  for (const [k, label] of items) nav.append(h('button', { class: cur === k ? 'on' : '', onclick: () => go(k) }, t(label)));
  nav.append(h('button', { onclick: logout }, t('Log out')));
  // Phone: a bank-app style bar at the bottom with the 5 main places.
  const tabs = $('#tabs');
  tabs.replaceChildren(...[['home', '🏠', 'Home'], ['market', '📈', 'Market'], ['orders', '🧾', 'Orders'], ['wallet', '👛', 'Wallet'], ['profile', '👤', 'Profile']]
    .map(([k, ic, label]) => h('button', { class: cur === k || (k === 'orders' && cur === 'order') ? 'on' : '', onclick: () => go(k) }, h('span', { class: 'ti' }, ic), h('span', {}, t(label)))));
}

// ---------- auth ----------
function authView(app) {
  const phone = h('input', { placeholder: '+509 3700 1234  or  +1 305 555 1234', inputmode: 'tel' });
  const name = h('input', { placeholder: t('Full name (as on your ID)') });
  const byEmail = cfg.code_channel === 'email';
  const email = h('input', { type: 'email', placeholder: 'you@gmail.com', autocomplete: 'email' });
  const code = h('input', { placeholder: byEmail ? 'Email code' : 'SMS code', inputmode: 'numeric' });
  const done = (r) => { token = r.token; localStorage.setItem('token', token); go('home'); };
  const clean = () => phone.value.replace(/[\s()\-.]/g, '');
  let mode = 'signup';
  const agree = h('input', { type: 'checkbox', class: 'chk' });
  const agreeBox = h('label', { class: 'agree' }, agree, h('span', {}, 'I am 18 or older. I read and accept the ', h('a', { href: '#legal/terms', target: '_blank' }, 'Terms and Conditions'), ' and the ', h('a', { href: '#legal/privacy', target: '_blank' }, 'Privacy Policy'),
    '. I understand Ayiti P2P is only a facilitator: I pay and receive gourdes directly with the other person, and I only pay inside an order after the crypto is locked.'));
  const sendCode = h('button', { class: 'btn alt', type: 'button', onclick: act(async () => {
    if (mode === 'signup' && !agree.checked) throw new Error('Tick the box to accept the Terms and Conditions first.');
    const r = await api('POST', '/auth/request-code', { phone: clean(), email: byEmail && mode === 'signup' ? email.value.trim() || undefined : undefined });
    toast(r.to ? `Code sent to ${r.to}. Check your email (and spam).` : 'Code sent. It works for ' + r.expires_in_min + ' minutes.');
    code.focus();
  }) }, 'Send code');
  const goBtn = h('button', { class: 'btn big-btn', type: 'button', onclick: act(async () => {
    if (mode === 'signup') {
      if (!agree.checked) throw new Error('Tick the box to accept the Terms and Conditions first.');
      done(await api('POST', '/auth/signup', { phone: clean(), full_name: name.value, code: code.value.trim() || undefined, accept_terms: true }));
    } else done(await api('POST', '/auth/login', { phone: clean(), code: code.value.trim() }));
  }) });
  const fName = h('div', {}, h('label', {}, 'Full name (as on your ID)'), name);
  const fEmail = byEmail ? h('div', {}, h('label', {}, 'Email. Your code goes there.'), email) : null;
  const note = h('p', { class: 'mute small' });
  const tabS = h('button', { type: 'button' }, 'Create account'), tabL = h('button', { type: 'button' }, 'Log in');
  const paint = () => {
    const su = mode === 'signup';
    tabS.classList.toggle('on', su); tabL.classList.toggle('on', !su);
    fName.classList.toggle('hidden', !su); fEmail && fEmail.classList.toggle('hidden', !su); agreeBox.classList.toggle('hidden', !su);
    goBtn.textContent = t(su ? 'Create my free account' : 'Log in');
    note.textContent = su ? (byEmail ? 'We send a code to your email. Then you verify your ID with photos and a short video, right in the app.' : 'We send a code by SMS. Then you verify your ID with photos and a short video, right in the app.')
      : (byEmail ? 'Enter your phone. The code goes to the email on your account.' : 'Enter your phone. We send you a code by SMS.');
  };
  tabS.onclick = () => { mode = 'signup'; paint(); }; tabL.onclick = () => { mode = 'login'; paint(); };
  const loginCard = h('div', { class: 'card logincard' },
    h('div', { class: 'authtabs' }, tabS, tabL),
    h('label', {}, 'Phone (with country code)'), phone,
    fName, fEmail, agreeBox,
    h('label', {}, 'Code'), h('div', { class: 'codebox' }, code, sendCode),
    goBtn, note);
  paint();
  const adsBox = h('div');
  // Logged in and looking at the public home page: show a way back to the account instead of the login form.
  const card = token && me ? h('div', { class: 'card logincard' }, h('h2', {}, (me.user.display_name || me.user.full_name).split(' ')[0] + ' 👋'),
    h('p', { class: 'mute' }, lang === 'ht' ? 'Ou konekte deja.' : lang === 'fr' ? 'Vous êtes déjà connecté.' : 'You are already logged in.'),
    h('button', { class: 'btn big-btn', onclick: () => go('home') }, lang === 'ht' ? 'Ale nan kont mwen' : lang === 'fr' ? 'Aller à mon compte' : 'Go to my account')) : loginCard;
  homeView(app, card, null, adsBox);
  publicAds(adsBox);
}

// Home page for visitors: live ads from sellers, with different prices. Read only.
async function publicAds(app) {
  const wrap = h('div', { class: 'card' });
  app.append(wrap);
  const need = () => { document.getElementById('join')?.scrollIntoView({ behavior: 'smooth' }); toast('Create a free account or log in to trade.'); };
  const list = (title, ads, verb, cls) => h('div', {}, h('h3', {}, title),
    ads.length ? h('div', { class: 'ads' }, ads.map((a) => h('div', { class: 'ad' },
      h('div', { class: 'who' }, avatarEl(a.id, a.owner, a.has_avatar),
        h('div', {}, h('strong', {}, a.owner), h('div', { class: 'mute' }, whoLine(a)), repBadges(a))),
      h('div', {}, h('div', { class: 'lab' }, 'Price'), h('div', { class: 'price' }, money(a.price_htg), h('small', {}, ' HTG'))),
      h('div', {}, h('div', { class: 'lab' }, 'Available · Limits'), h('div', {}, usd(a.remaining) + ' ' + a.asset),
        h('div', { class: 'mute' }, `Per order: ${money(a.min_order_htg, 0)} – ${money(a.max_order_htg, 0)} HTG`), payChips(a)),
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
      h('div', { class: 'who link', title: 'See profile', onclick: () => go('u/' + a.owner_id) }, avatarEl(a.owner_id, a.owner_name, a.has_avatar),
        h('div', {}, h('strong', {}, a.owner_name, a.id_verified ? h('span', { class: 'vtick', title: 'ID verified' }, '✓') : null), h('div', { class: 'mute' }, whoLine(a), ' · ', h('span', { class: 'plink' }, 'See profile ›')), repBadges(a))),
      h('div', {}, h('div', { class: 'lab' }, t('Price')), h('div', { class: 'price' }, money(a.price_htg), h('small', {}, ' HTG'))),
      h('div', {}, h('div', { class: 'lab' }, 'Available · Limits'),
        h('div', {}, usd(a.remaining) + ' ' + a.asset, h('span', { class: 'mute' }, ` ≈ ${money(Number(a.remaining) * Number(a.price_htg), 0)} HTG`)),
        h('div', { class: 'mute' }, `Per order: ${money(a.min_order_htg, 0)} – ${money(a.max_order_htg, 0)} HTG`),
        payChips(a)),
      a.owner_id === me.user.id ? h('span', { class: 'mute' }, 'your ad') : h('button', { class: 'btn sm ' + (marketSide === 'SELL' ? 'good' : 'danger'), onclick: () => takeAd(a) }, (marketSide === 'SELL' ? t('Buy USDT') : t('Sell USDT')))))) : h('p', { class: 'mute' }, 'No ads yet.'));
  });
  [asset, pay].forEach((s) => s.addEventListener('change', load));
  app.append(h('div', { class: 'card' },
    h('h2', {}, t('Market')),
    h('div', { class: 'seg' },
      h('button', { class: 'buy' + (marketSide === 'SELL' ? ' on' : ''), onclick: () => { marketSide = 'SELL'; route(); } }, t('Buy USDT')),
      h('button', { class: 'sell' + (marketSide === 'BUY' ? ' on' : ''), onclick: () => { marketSide = 'BUY'; route(); } }, t('Sell USDT'))),
    h('div', { class: 'row' }, asset, pay), scamRule(true), box));
  load();
}

// Trust badges for a trader. Real numbers only: a new trader is shown as new, never with a made-up score.
function repBadges(a, noLoc) {
  const out = [];
  const trades = a.trades || 0, pct = a.completion_pct;
  if (trades >= 50 && pct >= 97) out.push(h('span', { class: 'badge top' }, '🏆 Top seller'));
  else if (trades >= 10 && pct >= 95) out.push(h('span', { class: 'badge top' }, '⭐ Trusted trader'));
  if (a.id_verified) out.push(h('span', { class: 'badge ok' }, '✓ ID verified'));
  if (a.is_business) out.push(h('span', { class: 'badge' }, '🏢 Business'));
  if ((a.response_min && a.response_min <= 10) || (a.avg_release_min != null && a.avg_release_min <= 10)) out.push(h('span', { class: 'badge fast' }, '⚡ Fast'));
  if (trades > 0 && pct != null) out.push(h('span', { class: 'badge' }, pct + '% completed'));
  if (a.avg_release_min != null) out.push(h('span', { class: 'badge' }, '⏱ releases in ~' + (a.avg_release_min < 1 ? '1' : a.avg_release_min) + ' min'));
  else if (a.response_min) out.push(h('span', { class: 'badge' }, '⏱ replies in ~' + a.response_min + ' min'));
  if (a.department && !noLoc) out.push(h('span', { class: 'badge loc' }, '📍 ' + (a.area ? a.area + ', ' : '') + a.department));
  if (!trades) out.push(h('span', { class: 'badge new' }, 'New trader'));
  return h('div', { class: 'badges' }, out);
}
const whoLine = (a) => `${a.trades} trade${a.trades === 1 ? '' : 's'}` + (a.rating ? ` · ${a.rating}★` : '');

// The golden rule. Shown on the market, before buying, and on the order page.
function scamRule(compact) {
  return h('div', { class: 'scamrule' + (compact ? ' sm' : '') }, h('div', { class: 'sr-ic' }, '🛡️'),
    h('div', {}, h('b', {}, 'Buy only from people selling on Ayiti P2P.'),
      h('span', {}, ' Someone who really has USDT or USDC will lock it here. Never send your hard-earned money to anyone outside an order. Pay only after the app shows the crypto is locked.')));
}

// ---------- public business profile: anyone can check a trader before buying ----------
const SLA = (n) => n < 60 ? n + ' min' : (n / 60) + ' h';
function lightbox(src) {
  const back = h('div', { class: 'modal-back lb', onclick: () => back.remove() }, h('img', { src, alt: '' }), h('button', { class: 'lbx', onclick: () => back.remove() }, '✕'));
  document.body.append(back);
}
async function publicProfileView(app, id) {
  const p = await api('GET', '/public/profile/' + id);
  const mine = me && me.user.id === p.id;
  const since = new Date(p.member_since).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const stat = (big, lab) => h('div', { class: 'pst' }, h('b', {}, big), h('span', {}, lab));
  const stars = (n) => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));
  const adRow = (ad) => {
    const full = { ...ad, owner_id: p.id, owner_name: p.name, has_avatar: p.has_avatar, bio: p.bio, member_since: p.member_since, trades: p.trades, rating: p.rating,
      completion_pct: p.completion_pct, avg_release_min: p.avg_release_min, id_verified: p.id_verified, is_business: p.is_business, department: p.department, area: p.area, response_min: p.response_min };
    return h('div', { class: 'pad' },
      h('div', {}, h('div', { class: 'lab' }, ad.side === 'SELL' ? t('Sells') : t('Buys')), h('div', { class: 'price' }, money(ad.price_htg), h('small', {}, ' HTG'))),
      h('div', {}, h('div', {}, usd(ad.remaining) + ' ' + ad.asset), h('div', { class: 'mute' }, `${money(ad.min_order_htg, 0)} – ${money(ad.max_order_htg, 0)} HTG`), payChips(ad)),
      mine ? h('span', { class: 'mute' }, 'your ad') : token && me ? h('button', { class: 'btn sm ' + (ad.side === 'SELL' ? 'good' : 'danger'), onclick: () => takeAd(full) }, ad.side === 'SELL' ? t('Buy USDT') : t('Sell USDT'))
        : h('button', { class: 'btn sm good', onclick: () => go('welcome') }, t('Create my free account')));
  };
  app.append(h('div', { class: 'pprof' },
    h('div', { class: 'back', onclick: () => history.length > 1 ? history.back() : go('market') }, '← ' + t('Back')),
    h('div', { class: 'card pp-head' },
      h('div', { class: 'pp-av' }, avatarEl(p.id, p.name, p.has_avatar, 'xl'), p.id_verified ? h('span', { class: 'pp-tick', title: 'ID verified' }, '✓') : null),
      h('div', { class: 'pp-id' },
        h('h1', {}, p.name),
        repBadges(p, true),
        h('div', { class: 'pp-meta' },
          p.department ? h('span', {}, '📍 ' + (p.area ? p.area + ', ' : '') + p.department) : null,
          p.response_min ? h('span', {}, '⏱ ' + t('Replies in about') + ' ' + SLA(p.response_min)) : null,
          h('span', {}, '📅 ' + t('Member since') + ' ' + since)),
        p.bio ? h('p', { class: 'pp-bio' }, p.bio) : null,
        mine ? h('button', { class: 'btn alt sm', onclick: () => go('profile') }, '✏️ ' + t('Edit my profile')) : null)),
    h('div', { class: 'pst-grid' },
      stat(p.trades, t('Trades done')),
      stat(p.completion_pct != null ? p.completion_pct + '%' : '—', t('Completion')),
      stat(p.avg_release_min != null ? '~' + Math.max(1, p.avg_release_min) + ' min' : '—', t('Average release')),
      stat(p.rating ? Number(p.rating).toFixed(1) + '★' : '—', `${p.ratings_count} ${t('reviews')}`),
      stat(p.volume ? usd2(p.volume) : '0', t('USDT traded'))),
    p.posters.length ? h('div', { class: 'card' }, h('h3', { class: 'ct' }, t('Business posters')),
      h('div', { class: 'posters' }, p.posters.map((pid) => h('button', { class: 'poster', onclick: () => lightbox('/api/public/poster/' + pid) }, h('img', { src: '/api/public/poster/' + pid, alt: '', loading: 'lazy' }))))) : null,
    h('div', { class: 'card' }, h('h3', { class: 'ct' }, t('Active ads')), p.ads.length ? h('div', { class: 'pads' }, p.ads.map(adRow)) : h('p', { class: 'mute' }, t('No active ads right now.'))),
    scamRule(),
    h('div', { class: 'card' }, h('h3', { class: 'ct' }, t('Reviews')), p.reviews.length ? h('div', { class: 'reviews' }, p.reviews.map((rv) => h('div', { class: 'rev' },
      h('div', { class: 'rev-top' }, h('span', { class: 'stars' }, stars(rv.stars)), h('b', {}, rv.by_name), h('span', { class: 'mute' }, new Date(rv.created_at).toLocaleDateString())),
      rv.comment ? h('p', {}, rv.comment) : null))) : h('p', { class: 'mute' }, t('No reviews yet. Reviews come from real, finished trades only.')))));
}


function safetyView(app) {
  const step = (n, title, text) => h('div', { class: 'sstep' }, h('div', { class: 'snum' }, n), h('div', {}, h('b', {}, title), h('div', { class: 'mute' }, text)));
  app.append(h('div', { class: 'card narrow2' },
    h('h2', {}, 'How your money stays safe'),
    h('p', { class: 'mute' }, 'Short and simple. This is how every trade works here.'),
    step(1, 'The seller\'s crypto is locked first', 'Before a buyer pays anything, we lock the seller\'s USDT. The seller cannot take it back.'),
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
    scamRule(),
    h('h3', {}, 'Stay safe yourself'),
    h('ul', { class: 'rules' },
      h('li', {}, 'MonCash or NatCash slow? A payment can show "sent" before it arrives, or come back later. Sellers: press "Not in my account yet" instead of fighting. Buyers: keep your SMS receipt and transaction number.'),
      h('li', {}, 'Never pay outside the order. Never share your PIN or password.'),
      h('li', {}, 'Sellers: never release because of a screenshot. Look at your own account.'),
      h('li', {}, 'Buyers: write the payment code in the note, and pay the exact amount.')),
    h('button', { class: 'btn big-btn', onclick: () => go('market') }, 'Go to the market')));
}

// Banks on the BRH list (Banque de la République d'Haïti), with their official logos.
const BANKS = [['Sogebank', 'sogebank'], ['Unibank', 'unibank'], ['BNC', 'bnc'], ['BUH', 'buh'], ['Capital Bank', 'capital'], ['Sogebel', 'sogebel'], ['BPH', 'bph'], ['BNDA', null], ['Other', null]];
const bankLogo = (name) => { const b = BANKS.find(([n]) => n.toLowerCase() === String(name || '').trim().toLowerCase()); return b && b[1] ? 'img/bank/' + b[1] + '.png' : null; };
// Small logo for an account: the bank's logo, or MonCash / NatCash.
function accLogo(p) {
  const src = p.type === 'BANK' ? (bankLogo(p.bank_name) || '').replace('.png', '-sq.png') || null : (cfg.pay_logos || {})[p.type];
  return src ? h('img', { class: 'acclogo' + (p.type === 'BANK' ? ' bank' : ''), src, alt: '' }) : h('span', { class: 'acclogo none' }, p.type === 'BANK' ? '🏦' : '•');
}
// Bank picker: a grid of bank logos. Returns the element and a function that gives the chosen name.
function bankPicker() {
  let cur = 'Sogebank';
  const other = h('input', { placeholder: 'Bank name', class: 'hidden' });
  const grid = h('div', { class: 'bgrid' });
  grid.append(...BANKS.map(([n, k]) => h('button', { type: 'button', class: 'btile' + (n === cur ? ' on' : ''), 'data-n': n, onclick: () => {
    cur = n; [...grid.children].forEach((c) => c.classList.toggle('on', c.dataset.n === n)); other.classList.toggle('hidden', n !== 'Other'); if (n === 'Other') other.focus();
  } }, k ? h('img', { src: 'img/bank/' + k + '.png', alt: n }) : h('b', {}, n === 'Other' ? 'Other bank' : n), h('small', {}, n === 'Other' ? '' : n))));
  return { el: h('div', {}, grid, other), value: () => (cur === 'Other' ? other.value.trim() : cur) };
}

const PAY_NAME = { MONCASH: 'MonCash', NATCASH: 'NatCash', BANK: 'Bank' };
// Payment badge: the official logo if the file is on the server, otherwise the name. Same clean white badge for all.
const payBadge = (p) => h('span', { class: 'paybadge' }, (cfg.pay_logos || {})[p] ? h('img', { src: cfg.pay_logos[p], alt: '' }) : p === 'BANK' ? h('span', { class: 'pbi' }, '🏦') : null, h('b', {}, PAY_NAME[p] || p));
const payChips = (a) => h('div', { class: 'paychips' }, (a.pay_types || [a.pay_type]).map(payBadge));

const accLabel = (p) => (p.linked ? '🔗 ' + p.account_name + ' (linked) · ' : '') + `${p.bank_name || PAY_NAME[p.type] || p.type} · ${p.account_ref}` + (p.linked ? '' : ` · ${p.account_name}`);

function takeAd(a) {
  const P = Number(a.price_htg);
  // If what is left is worth less than the minimum, the next person takes all of it (the ad never gets stuck).
  const rest = Number(a.remaining) * P, tail = rest < Number(a.min_order_htg);
  const minH = tail ? rest : Number(a.min_order_htg), maxH = tail ? rest : Math.min(Number(a.max_order_htg), Math.floor(rest));
  const LF = Number(cfg.lock_fee || 0);
  // People can type the amount in gourdes (most natural) or in USDT. We always send USDT to the server.
  let unit = 'HTG';
  const amount = h('input', { inputmode: 'decimal', placeholder: 'Amount', value: tail ? rest.toFixed(2) : '' });
  if (tail) amount.readOnly = true;
  const unitSeg = h('div', { class: 'seg unitseg' }, ['HTG', a.asset].map((u2, i) => h('button', { type: 'button', class: i ? '' : 'on', onclick: (e) => {
    const v = Number(amount.value || 0);
    if (u2 !== unit && v) amount.value = u2 === 'HTG' ? (v * P).toFixed(2) : (v / P).toFixed(2);
    unit = u2; unitSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); upd();
  } }, u2 === 'HTG' ? 'Gourdes (HTG)' : u2)));
  const total = h('div', { class: 'big' }, '0 HTG'), other = h('div', { class: 'mute' }), feeLine = h('div', { class: 'feeline' });
  // USDT with 2 decimals, nudged to stay inside the order limits.
  const usdtOf = () => {
    if (tail) return Number(a.remaining);
    const v = Number(amount.value || 0); let u2 = Math.round((unit === 'HTG' ? v / P : v) * 100) / 100;
    if (u2 && u2 * P < minH - 0.005) u2 = Math.round((u2 + 0.01) * 100) / 100;
    if (u2 * P > maxH + 0.005) u2 = Math.round((u2 - 0.01) * 100) / 100;
    return u2;
  };
  const upd = () => {
    const u2 = usdtOf(), htg = u2 * P;
    total.textContent = (a.side === 'SELL' ? '' : '') + money(htg) + ' HTG';
    other.textContent = `= ${usd2(u2)} ${a.asset}` + (htg && (htg < minH - 0.01 || htg > maxH + 0.01) ? `  ·  must be ${money(minH, 0)} – ${money(maxH, 0)} HTG` : '');
    other.classList.toggle('badtxt', !!htg && (htg < minH - 0.01 || htg > maxH + 0.01));
    // Who pays what: the buyer pays the lock fee, the seller pays the platform fee.
    const sellFee = Math.trunc(u2 * Number(cfg.fee_rate || 0) * 1e6) / 1e6;
    feeLine.replaceChildren(!u2 ? '' : a.side === 'SELL'
      ? h('span', {}, h('b', {}, `You get: ${usd2(Math.max(0, u2 - LF))} ${a.asset}`), ' ', h('span', { class: 'mute' }, `(${usd2(u2)} − ${usd2(LF)} lock fee)`))
      : h('span', {}, h('b', {}, `You sell: ${usd2(u2)} ${a.asset}`), ' ', h('span', { class: 'mute' }, `+ ${usd(sellFee)} ${a.asset} platform fee (${Number(cfg.fee_rate) * 100}%)`)));
  };
  amount.addEventListener('input', upd); upd();
  const types = a.pay_types || [a.pay_type];
  // Buying from a seller: choose how you pay. Selling to a buyer: choose which of your accounts gets paid.
  let payWith = types[0];
  const paySeg = h('div', { class: 'seg payseg' }, types.map((tp, i) => h('button', { class: i ? '' : 'on', onclick: (e) => {
    payWith = tp; paySeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, payBadge(tp))));
  const mine = (me.payment_methods || []).filter((p) => types.includes(p.type) && p.verified && p.active !== false);
  const addType = h('select', {}, types.map((tp) => h('option', { value: tp }, PAY_NAME[tp] || tp)));
  const pm = h('select', {}, mine.map((p) => h('option', { value: p.id }, accLabel(p))));
  const nm = h('input', { value: me.user.full_name }), nr = h('input', { inputmode: 'numeric', placeholder: 'Phone number or bank account number' });
  const bank = bankPicker(), bankRow = h('div', { class: addType.value === 'BANK' ? '' : 'hidden' }, h('label', {}, 'Which bank?'), bank.el);
  addType.addEventListener('change', () => bankRow.classList.toggle('hidden', addType.value !== 'BANK'));
  const addBox = h('div', { class: 'addacc' + (mine.length ? ' hidden' : '') },
    h('p', { class: 'mute' }, mine.length ? 'Add another account.' : `You have no ${types.map((x) => PAY_NAME[x]).join(' / ')} account yet. Add one. The name must match your ID.`),
    h('label', {}, 'Type'), addType, bankRow,
    h('label', {}, 'Name on the account'), nm, h('label', {}, 'Number'), nr,
    h('button', { class: 'btn alt sm', onclick: act(async () => {
      const r = await api('POST', '/payment-methods', { type: addType.value, account_name: nm.value.trim(), account_ref: nr.value.trim(), bank_name: addType.value === 'BANK' ? bank.value() : undefined });
      me = await api('GET', '/me');
      if (!r.verified) { toast('Saved, but the name does not match your ID yet. Staff must approve it.', true); }
      takeAd(a);
    }) }, 'Save account'));
  const body = [h('button', { class: 'back', onclick: route }, '← Back to market'),
    h('h2', {}, `${a.side === 'SELL' ? t('Buy USDT') : t('Sell USDT')} @ ${money(a.price_htg)} HTG`),
    h('div', { class: 'tcard' }, avatarEl(a.owner_id, a.owner_name, a.has_avatar),
      h('div', {}, h('b', {}, a.owner_name), h('div', { class: 'mute' }, whoLine(a) + ' · member since ' + new Date(a.member_since).toLocaleDateString([], { month: 'short', year: 'numeric' })), a.bio ? h('div', { class: 'bio' }, a.bio) : null, repBadges(a),
        h('a', { href: '#u/' + a.owner_id, class: 'plink' }, 'See full profile, posters and reviews ›'))),
    scamRule(true),
    h('div', { class: 'kv' }, kv([['Available', `${usd(a.remaining)} ${a.asset}  (≈ ${money(Number(a.remaining) * P, 0)} HTG)`],
      ['Per order', `${money(minH, 0)} – ${money(Number(a.max_order_htg), 0)} HTG  (≈ ${usd2(minH / P)} – ${usd2(Number(a.max_order_htg) / P)} ${a.asset})`], [a.side === 'SELL' ? 'Seller accepts' : 'Buyer pays with', types.map((x) => PAY_NAME[x]).join(', ')]])),
    h('label', {}, 'How much?'), unitSeg, amount,
    tail ? h('div', { class: 'mute' }, `Only ${usd(a.remaining)} ${a.asset} is left. You take all of it.`) : h('div', { class: 'mute' }, `From ${money(minH, 0)} to ${money(maxH, 0)} HTG.`),
    h('div', { class: 'sumbox' }, h('div', { class: 'mute' }, a.side === 'SELL' ? 'You pay' : 'You receive'), total, other, feeLine)];
  if (a.side === 'SELL') body.push(h('label', {}, 'How will you pay?'), paySeg);
  if (a.side === 'BUY') {
    body.push(h('label', {}, 'Where should the buyer send the gourdes?'), h('p', { class: 'mute' }, 'One of your accounts, or a linked account (see "Linked accounts").'), mine.length ? pm : null,
      mine.length ? h('button', { class: 'linkbtn', onclick: () => addBox.classList.toggle('hidden') }, '+ Add another number or account') : null, addBox);
  }
  body.push(h('button', { class: 'btn big-btn', onclick: act(async () => {
    if (a.side === 'BUY' && !mine.length) throw new Error('Add a payment account first.');
    const o = await api('POST', '/orders', { ad_id: a.id, amount: tail ? String(a.remaining) : usdtOf().toFixed(2), payment_method_id: a.side === 'BUY' ? pm.value : undefined, pay_type: a.side === 'SELL' ? payWith : undefined });
    go('order/' + o.id);
  }) }, 'Continue'));
  body.push(h('p', { class: 'mute center' }, '🔒 We lock the seller\'s USDT before you pay. ', h('a', { href: '#safety' }, 'How it works')));
  $('#app').replaceChildren(h('div', { class: 'card narrow' }, body));
}

// ---------- my ads ----------
async function adsView(app) {
  const mine = await api('GET', '/my/ads');
  const f = {};
  const field = (key, label, el) => { f[key] = el; return [h('label', {}, label), el]; };
  const pms = me.payment_methods.filter((p) => p.verified && p.active !== false);
  const tick = (value, label, sub) => h('label', { class: 'tick' }, h('input', { type: 'checkbox', value, checked: true }), h('span', {}, h('b', {}, label), sub ? h('small', { class: 'mute' }, ' ' + sub) : null));
  // Sell ad: tick every account you accept money in. Buy ad: tick every way you can pay.
  const sellBox = h('div', {}, h('label', {}, 'I accept payment in (tick all you want)'),
    pms.length ? h('div', { class: 'ticks' }, pms.map((p) => tick(p.id, (p.linked ? '🔗 ' : '') + (p.bank_name || PAY_NAME[p.type]), `${p.account_ref} · ${p.account_name}` + (p.linked ? ' (linked)' : ''))))
      : h('p', { class: 'mute' }, 'Add a verified MonCash, NatCash or bank account in Profile first.'));
  const buyBox = h('div', { class: 'hidden' }, h('label', {}, 'I can pay with (tick all you want)'),
    h('div', { class: 'ticks' }, ['MONCASH', 'NATCASH', 'BANK'].map((tp) => tick(tp, PAY_NAME[tp]))));
  app.append(h('div', { class: 'card' }, h('h2', {}, t('Post an ad')),
    h('div', { class: 'row' },
      h('div', {}, field('side', 'I want to', h('select', {}, h('option', { value: 'SELL' }, 'SELL USDT/USDC (I get HTG)'), h('option', { value: 'BUY' }, 'BUY USDT/USDC (I pay HTG)')))),
      h('div', {}, field('asset', 'Asset', h('select', {}, h('option', {}, 'USDT'), h('option', {}, 'USDC')))),
    ),
    h('div', { class: 'row' },
      h('div', {}, field('price_htg', 'Price (HTG per 1)', h('input', { inputmode: 'decimal' }))),
      h('div', {}, field('amount', 'Amount', h('input', { inputmode: 'decimal' }))),
      h('div', {}, field('min_order_htg', 'Min order (HTG)', h('input', { inputmode: 'decimal' }))),
      h('div', {}, field('max_order_htg', 'Max order (HTG)', h('input', { inputmode: 'decimal' })))),
    sellBox, buyBox,
    h('p', { class: 'mute' }, `Sell ads lock your USDT now. A ${Number(cfg.fee_rate) * 100}% fee is taken from the seller, in USDT.`),
    Number(cfg.lock_fee) > 0 ? h('p', { class: 'mute' }, `The buyer pays a ${cfg.lock_fee} USDT lock fee per order. It comes out of the USDT they get.`) : null,
    h('button', { class: 'btn', onclick: act(async () => {
      const b = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      if (b.side === 'SELL') b.payment_method_ids = [...sellBox.querySelectorAll('input:checked')].map((x) => x.value);
      else b.pay_types = [...buyBox.querySelectorAll('input:checked')].map((x) => x.value);
      if (!(b.payment_method_ids || b.pay_types).length) throw new Error('Tick at least one payment method.');
      await api('POST', '/ads', b); toast('Ad posted.'); route();
    }) }, t('Post an ad'))));
  f.side.addEventListener('change', () => { sellBox.classList.toggle('hidden', f.side.value !== 'SELL'); buyBox.classList.toggle('hidden', f.side.value !== 'BUY'); });
  app.append(h('div', { class: 'card scroll' }, h('h2', {}, t('My ads')), mine.length ? h('table', {},
    h('thead', {}, h('tr', {}, ['Side', t('Price'), t('Available'), 'Payment', 'Held', 'Status', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, mine.map((a) => h('tr', {},
      h('td', {}, a.side + ' ' + a.asset), h('td', {}, money(a.price_htg)), h('td', {}, usd(a.remaining)), h('td', {}, payChips(a)), h('td', {}, usd(a.reserved)),
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
// Status label. With a role it speaks to that person: "Your turn" vs "Waiting for…".
const MY_TURN = { BUYER: { AWAITING_PAYMENT: 'Your turn: pay' }, SELLER: { PAID_CLAIMED: 'Your turn: check and release', AWAITING_PAYMENT: 'Waiting for payment' } };
const statePill = (s, role) => {
  const mine = role && MY_TURN[role] && MY_TURN[role][s];
  return h('span', { class: 'pill ' + (mine && mine.startsWith('Your') ? 'good' : STATE_TEXT[s][1]) }, mine || t(STATE_TEXT[s][0]));
};

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
      h('td', {}, usd(o.amount) + ' ' + o.asset), h('td', {}, money(o.total_htg)), h('td', {}, statePill(o.state, o.buyer_id === me.user.id ? 'BUYER' : 'SELLER')),
      h('td', {}, h('button', { class: 'btn alt', onclick: () => go('order/' + o.id) }, 'Open')))))) : h('p', { class: 'mute' }, 'No orders yet.')));
}

// New or changed terms: the person must accept them before using the app again. No way around it.
function termsGate() {
  const agree = h('input', { type: 'checkbox', class: 'chk' });
  const back = h('div', { class: 'modal-back terms-gate' });
  back.append(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('h2', {}, 'Our terms changed'), h('p', { class: 'mute' }, 'Please read and accept the Terms and Conditions to keep using Ayiti P2P.'),
    h('p', {}, h('a', { href: '#legal/terms', target: '_blank' }, '📄 Read the Terms and Conditions'), ' · ', h('a', { href: '#legal/privacy', target: '_blank' }, 'Privacy Policy')),
    h('label', { class: 'agree' }, agree, h('span', {}, 'I read and accept the Terms and Conditions. I understand Ayiti P2P is only a facilitator.')),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn alt', onclick: logout }, t('Log out')),
      h('button', { class: 'btn', onclick: act(async () => {
        if (!agree.checked) throw new Error('Tick the box to accept.');
        await api('POST', '/me/accept-terms'); back.remove(); me = await api('GET', '/me');
      }) }, 'I accept'))));
  document.body.append(back);
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
  const t0 = setInterval(() => { if (!app.isConnected) return clearInterval(t0); tickClock(lastView); if (++n % 4 === 0) draw(); }, 1000);
  timer = t0;
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
  modal('Unlock the crypto?', h('div', {},
    h('p', {}, 'Open your ', h('b', {}, v.payment ? v.payment.type : 'payment'), ' app or bank and look at your account. Only release when you can see the money.'),
    kv([['Amount to receive', money(o.total_htg) + ' HTG'], ['From', v.buyer.full_name], ['Payment note code', o.pay_reference]]),
    h('p', { class: 'warn-note' }, 'Once unlocked, it cannot be undone. Never unlock because of a screenshot alone. Look at your own account.')),
  [{ label: 'Not yet' }, { label: 'Yes, I received it. Unlock.', cls: 'good', run: async () => {
    await api('POST', `/orders/${o.id}/confirm`, cfg.chain ? await signRelease(o.id) : undefined); route();
  } }]);
}

function openCancelWindow(v) {
  modal('Cancel this order?', h('p', {}, 'Only cancel if you have NOT sent any money. If you already paid, press "I have paid" or open a dispute instead.'),
    [{ label: 'Keep order' }, { label: 'Yes, cancel', cls: 'danger', run: async () => { await api('POST', `/orders/${v.order.id}/cancel`); route(); } }]);
}

// Seller: "I will check within X minutes". Buyer: sees the promise.
function etaBox(v) {
  const o = v.order;
  if (!['AWAITING_PAYMENT', 'PAID_CLAIMED'].includes(o.state)) return null;
  if (v.role === 'BUYER') return o.seller_eta_min ? h('div', { class: 'etabar' }, '⏱ ', h('b', {}, `The seller will check and release within ${SLA(o.seller_eta_min)}`), ' after you pay.') : null;
  if (v.role !== 'SELLER') return null;
  return h('div', { class: 'card etacard' }, h('b', {}, '⏱ Tell the buyer how fast you will check'), h('p', { class: 'mute small' }, 'Buyers feel safe when they know. Keep your promise: it builds your rating.'),
    h('div', { class: 'chips' }, [5, 10, 15, 30, 60].map((m) => h('button', { class: 'chip' + (o.seller_eta_min === m ? ' on' : ''), onclick: act(async () => { await api('POST', `/orders/${o.id}/eta`, { minutes: m }); toast('The buyer can see it.'); route(); }) }, SLA(m)))));
}

// Before a dispute: rule out a slow MonCash / NatCash / bank first.
function preDispute(v) {
  const o = v.order, buyer = v.role === 'BUYER';
  if (v.provider_down) return modal('Disputes are paused for now', h('p', {}, (PAY_NAME[v.payment?.type] || 'This payment service') + ' has a known problem right now. Payments can arrive late. The crypto stays locked and safe. You can open a dispute when the service works again.'), [{ label: 'OK' }]);
  const paidAt = o.paid_at ? new Date(o.paid_at).getTime() : Date.now();
  const left = Math.ceil((paidAt + (v.dispute_wait_min || 0) * 60000 - Date.now()) / 60000);
  if (left > 0) return modal('Give the payment a little time', h('div', {}, h('p', {}, `MonCash, NatCash and bank payments can take some minutes to arrive. You can open a dispute in ${left} minute${left === 1 ? '' : 's'}.`),
    h('p', { class: 'mute' }, buyer ? 'Meanwhile, keep your receipt (the SMS and the transaction number) and chat with the seller here.' : 'Meanwhile, refresh your MonCash, NatCash or bank app and check your SMS messages.')), [{ label: 'OK' }]);
  if (o.delay_until && new Date(o.delay_until) > new Date()) return modal('Payment delay check is on', h('p', {}, `The seller asked for more time because the money may be delayed. You can open a dispute after ${hm(o.delay_until)} if it still has not arrived.`), [{ label: 'OK' }]);
  const items = buyer
    ? ['I have the receipt: the SMS or screenshot with the transaction number.', 'The money left my account (it was not reversed or refused).', 'I sent the exact amount to the account shown in this order.', 'I checked that MonCash / NatCash / my bank is working normally today.']
    : ['I refreshed my MonCash / NatCash / bank app and checked my SMS.', 'I looked for the code ' + o.pay_reference + ' and the exact amount.', 'I checked that MonCash / NatCash / my bank is working normally today.', 'I understand: if the money arrives later, I must unlock the crypto.'];
  const boxes = items.map((x) => { const c = h('input', { type: 'checkbox', class: 'chk' }); return [c, h('label', { class: 'agree' }, c, h('span', {}, x))]; });
  modal('Before you open a dispute', h('div', {},
    h('p', { class: 'mute' }, 'Sometimes MonCash or NatCash shows the money as sent, but it arrives later, or it goes back to the sender. Many problems fix themselves. Check these first:'),
    ...boxes.map((b) => b[1]),
    !buyer ? h('p', { class: 'mute small' }, 'Not sure yet? Press "Not in my account yet" instead: it gives the payment more time and keeps the crypto locked.') : null),
  [{ label: 'Cancel' }, { label: 'Continue to the dispute', cls: 'danger', run: async () => {
    if (!boxes.every((b) => b[0].checked)) throw new Error('Tick every box first.');
    openDisputeWindow(v);
  } }]);
}

function openDelayWindow(v) {
  modal('Money not in your account yet?', h('div', {},
    h('p', {}, 'Sometimes MonCash, NatCash or a bank shows "sent" before the money really arrives. Press the button to give the payment more time. The crypto stays locked, and nobody can open a dispute during this time.'),
    h('p', { class: 'mute' }, 'Each press adds 2 hours, up to 24 hours after the buyer paid. If the money arrives, unlock the crypto right away.')),
  [{ label: 'Cancel' }, { label: 'Give the payment more time', cls: 'good', run: async () => { await api('POST', `/orders/${v.order.id}/delay`); toast('More time added. The buyer can see it.'); route(); } }]);
}

function openReportWindow(v) {
  const kind = h('select', {}, h('option', { value: 'REVERSED' }, 'The payment was sent back (reversed)'), h('option', { value: 'OTHER' }, 'Another problem'));
  const note = h('textarea', { rows: 4, placeholder: 'What happened? When? Which transaction number?' });
  modal('Report a problem', h('div', {}, h('label', {}, 'What happened?'), kind, h('label', {}, 'Details'), note),
    [{ label: 'Cancel' }, { label: 'Send report', cls: 'danger', run: async () => { await api('POST', `/orders/${v.order.id}/report`, { kind: kind.value, note: note.value }); toast('Report sent. Our team will look at it.'); route(); } }]);
}

// Stars and a short review after a finished trade.
function rateBox(o) {
  let stars = 0;
  const row = h('div', { class: 'rate' });
  const comment = h('input', { placeholder: 'A short review (optional): fast, honest, friendly…', maxlength: 200 });
  const paint = () => row.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', { class: 'star' + (n <= stars ? ' on' : ''), onclick: () => { stars = n; paint(); } }, '★')));
  paint();
  return h('div', { class: 'ratebox' }, row, comment, h('button', { class: 'btn sm', onclick: act(async () => {
    if (!stars) throw new Error('Pick 1 to 5 stars.');
    await api('POST', `/orders/${o.id}/rate`, { stars, comment: comment.value }); toast('Thanks for your review.'); route();
  }) }, 'Send review'));
}

// ----- what the person should do now -----
function guide(v) {
  const o = v.order, r = v.role, s = o.state, buyer = r === 'BUYER', seller = r === 'SELLER';
  const dispBtn = h('button', { class: 'btn alt sm', onclick: () => preDispute(v) }, buyer ? 'Problem? Open a dispute' : 'Not received? Open a dispute');
  const delayBtn = h('button', { class: 'btn alt sm', onclick: () => openDelayWindow(v) }, '⏳ Not in my account yet');
  if (r === 'STAFF') return { tone: '', title: 'Staff view', text: 'You are reading this order as staff.', actions: [] };
  if (buyer && s === 'AWAITING_PAYMENT') return { tone: 'go', title: `Pay ${money(o.total_htg)} HTG now`, steps: [
      `Open your ${v.payment ? (v.payment.bank_name || PAY_NAME[v.payment.type] || v.payment.type) : 'payment'} app or bank.`, `Send exactly ${money(o.total_htg)} HTG to the account below.`,
      `Write the code ${o.pay_reference} in the payment note.`, 'Come back and press "I have paid".'],
    actions: [h('button', { class: 'btn good', onclick: act(async () => { await api('POST', `/orders/${o.id}/paid`); route(); }) }, 'I have paid'),
      h('button', { class: 'btn alt', onclick: () => openCancelWindow(v) }, 'Cancel order')] };
  if (seller && s === 'AWAITING_PAYMENT') return { tone: 'wait', title: 'Waiting for the buyer to pay', text: `Your USDT is locked and safe. The buyer must send ${money(o.total_htg)} HTG to your account. Do not release anything yet.`, actions: [] };
  if (buyer && s === 'PAID_CLAIMED') return { tone: 'wait', title: 'Waiting for the seller to confirm', text: 'The seller is checking their account. When they confirm, the USDT comes to you. If they do not answer in time, a dispute opens by itself.', actions: [dispBtn] };
  if (seller && s === 'PAID_CLAIMED' && v.payment && v.payment.is_receiver) return { tone: o.receiver_said === 'RECEIVED' ? 'go' : 'wait',
    title: o.receiver_said === 'RECEIVED' ? `${v.payment.account_name} got the money ✓` : o.receiver_said === 'NOT_RECEIVED' ? `${v.payment.account_name} says it did NOT arrive` : `Waiting for ${v.payment.account_name} to confirm`,
    text: o.receiver_said === 'RECEIVED' ? 'The account owner confirmed in the app. Unlock the crypto to finish.' : o.receiver_said === 'NOT_RECEIVED' ? 'Check with them. If the money never came, open a dispute. Do not unlock.' : `${v.payment.account_name} owns the receiving account. We asked them to check and confirm in the app. You can also check with them and unlock yourself.`,
    actions: [h('button', { class: 'btn good', onclick: () => openReleaseWindow(v) }, 'Unlock the crypto'), dispBtn] };
  if (seller && s === 'PAID_CLAIMED') return { tone: 'go', title: `Did ${money(o.total_htg)} HTG arrive in your account?`, text: `Check your ${v.payment ? (v.payment.bank_name || PAY_NAME[v.payment.type] || v.payment.type) : 'payment'} app or bank. Look for the code ${o.pay_reference}. Release only if you see the money.`,
    actions: [h('button', { class: 'btn good', onclick: () => openReleaseWindow(v) }, 'Yes, I received it. Unlock the crypto'), delayBtn, dispBtn] };
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
  const rate = g.rate && r !== 'STAFF' ? rateBox(o) : null;
  const pay = v.payment && ['AWAITING_PAYMENT', 'PAID_CLAIMED', 'DISPUTED'].includes(o.state) ? h('div', { class: 'card ' + (r === 'BUYER' && o.state === 'AWAITING_PAYMENT' ? 'payto' : '') },
    h('h3', { class: 'ct' }, r === 'BUYER' ? 'Pay to this account' : v.payment.is_receiver ? 'Paid into a linked account' : 'Your receiving account'),
    h('div', { class: 'payhead' }, accLogo(v.payment), h('b', {}, v.payment.bank_name || PAY_NAME[v.payment.type] || v.payment.type)),
    r === 'BUYER' && o.state === 'AWAITING_PAYMENT' ? h('div', { class: 'safepay' }, '✅ ', h('b', {}, `${usd(o.amount)} ${o.asset} is locked.`), ' It is safe to pay now. Pay only this account, only inside this order.') : null,
    v.payment.is_receiver && r === 'BUYER' ? h('p', { class: 'mute' }, `This account belongs to ${v.payment.account_name}, a verified user linked to the seller. Pay exactly this account.`) : null,
    kv([v.payment.bank_name ? ['Bank', v.payment.bank_name] : null, [v.payment.type === 'BANK' ? 'Account number' : (PAY_NAME[v.payment.type] || v.payment.type) + ' number', v.payment.account_ref], ['Account name', v.payment.account_name], ['Amount', money(o.total_htg) + ' HTG']]),
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
        h('div', {}, h('b', {}, other.full_name), h('div', { class: 'mute' }, r === 'BUYER' ? 'Seller' : 'Buyer', ' · ID checked ✓')), statePill(o.state, r))),
    v.provider_down && ['AWAITING_PAYMENT', 'PAID_CLAIMED', 'DISPUTED'].includes(o.state) ? h('div', { class: 'alertbar' }, '⚠️ ', h('b', {}, (PAY_NAME[v.payment?.type] || 'This payment service') + ' has a known problem right now.'), ' Payments can arrive late or come back. Timers wait and disputes are paused. The crypto stays locked.') : null,
    o.delay_until && new Date(o.delay_until) > new Date() && o.state === 'PAID_CLAIMED' ? h('div', { class: 'alertbar info' }, '⏳ ', h('b', {}, 'Possible payment delay.'), ` The seller does not see the money yet. We gave more time until ${hm(o.delay_until)}. Buyer: keep your receipt and transaction number. Disputes open after that time if the money still has not arrived.`) : null,
    etaBox(v),
    h('div', { class: 'card guide ' + g.tone },
      h('h2', {}, g.title),
      g.steps ? h('ol', { class: 'gsteps' }, g.steps.map((x) => h('li', {}, x))) : h('p', { class: 'gtext' }, g.text),
      rate, h('div', { class: 'gactions' }, g.actions)),
    ['ORDER_CREATED', 'AWAITING_PAYMENT', 'PAID_CLAIMED', 'DISPUTED', 'RELEASING'].includes(o.state)
      ? h('div', { class: 'escrow' }, h('b', {}, '🔒 ' + usd(o.amount) + ' ' + o.asset + ' is locked'), h('span', {}, 'Nobody can touch it until the seller confirms the money arrived, the order is cancelled, or our team decides.')) : null,
    pay, dispute,
    o.state === 'COMPLETED' && r !== 'STAFF' ? h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'A problem after the trade?'),
      v.my_report ? h('p', { class: 'mute' }, `You reported this order (${new Date(v.my_report.created_at).toLocaleString()}). Our team is looking at it.`)
        : [h('p', { class: 'mute' }, 'For example MonCash, NatCash or the bank sent the money back after the crypto was unlocked. Tell us: we can block the person and help you.'),
          h('button', { class: 'btn alt sm', onclick: () => openReportWindow(v) }, 'Report a problem')]) : null,
    h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'Order details'),
      kv([['Price', money(o.price_htg) + ' HTG per ' + o.asset], ['You ' + (r === 'SELLER' ? 'sell' : 'buy'), usd(o.amount) + ' ' + o.asset], ['Total', money(o.total_htg) + ' HTG'],
        ['Platform fee', usd(o.fee_amount) + ' ' + o.asset + ' (paid by the seller)'],
        ...(Number(o.lock_fee) > 0 ? [['Lock fee', usd(o.lock_fee) + ' ' + o.asset + ' (paid by the buyer)'], ['Buyer gets', usd(Number(o.amount) - Number(o.lock_fee)) + ' ' + o.asset]] : []),
        ['Order number', o.id.slice(0, 8).toUpperCase()]])),
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

// ---------- real chain helpers (ESCROW_MODE=EVM) ----------
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
// Gasless withdraw: you sign in your wallet (free), the app sends it and pays the network cost.
// A small flat fee (cfg.withdraw_fee) is taken from the amount. You need no ETH.
async function chainWithdraw(asset, amount, to) {
  const account = await eth();
  const td = await api('GET', `/wallet/withdraw-typed-data?asset=${encodeURIComponent(asset)}&amount=${encodeURIComponent(amount)}&to=${encodeURIComponent(to)}`);
  const data = { domain: td.domain, types: { EIP712Domain: [
    { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
    ...td.types }, primaryType: 'Withdraw', message: td.value };
  const signature = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(data)] });
  const r = await api('POST', '/wallet/withdraw-gasless', { asset, amount, to, deadline: td.value.deadline, signature });
  toast(`Sent. ${r.receive} ${asset} is on the way. Your balance updates after a few blocks.`);
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
  return h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'Where do I receive crypto?'),
    h('p', { class: 'mute' }, 'Binance UID is the easiest: a Binance to Binance transfer has no network fee. Or use a wallet.'),
    h('label', { class: 'withlogo' }, h('img', { src: 'img/brand/binance.png', alt: '' }), 'Binance UID'), uid,
    h('label', {}, 'Or a wallet: choose the network'), net, hint,
    h('label', {}, 'Wallet address'), addr,
    h('div', { class: 'warn-note', style: 'margin-top:10px' }, 'Be careful. If you pick the wrong network, the money can be lost forever. Always check the network and the address.'),
    h('div', { class: 'gactions', style: 'margin-top:12px' },
      h('button', { class: 'btn', onclick: act(async () => { await api('PUT', '/me/payout', { binance_uid: uid.value, network: addr.value ? net.value : undefined, address: addr.value }); me = await api('GET', '/me'); toast('Saved.'); }) }, 'Save')));
}

// ---------- wallet ----------
async function walletView(app) {
  const w = me.wallet;
  const amt = h('input', { value: '100', inputmode: 'decimal' });
  const asset = h('select', {}, h('option', {}, 'USDT'), h('option', {}, 'USDC'));
  const addr = h('input', { value: me.user.wallet_addr || '', placeholder: 'Your USDT wallet address (for withdrawals when live)' });
  const wto = h('input', { value: (me.user.payout_network === 'ARBITRUM' && me.user.payout_addr) || me.user.wallet_addr || '', placeholder: '0x… (your wallet, or your Binance USDT deposit address on Arbitrum)' });
  app.append(h('div', { class: 'card' }, h('h2', {}, t('Wallet')),
    w.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Asset', t('Available'), 'Locked'].map((x) => h('th', {}, x)))),
      h('tbody', {}, w.map((b) => h('tr', {}, h('td', {}, b.asset), h('td', {}, usd(b.available)), h('td', {}, usd(b.locked)))))) : h('p', { class: 'mute' }, 'Empty.'),
    cfg.chain ? [
      h('p', { class: 'mute' }, 'Your crypto is held in a smart contract on Arbitrum. Start with small amounts.'),
      h('h3', {}, 'Your wallet'), h('p', {}, me.user.wallet_addr || 'Not linked yet.'),
      h('button', { class: 'btn alt', onclick: act(async () => { await linkWalletWithSignature(); toast('Wallet linked.'); route(); }) }, 'Connect and link my wallet'),
      h('h3', {}, 'Deposit or withdraw'), h('div', { class: 'row' }, asset, amt),
      h('button', { class: 'btn', onclick: act(async () => chainDeposit(asset.value, amt.value)) }, t('Deposit')),
      h('p', { class: 'mute' }, 'Deposit: your wallet pays a tiny network cost in ETH on Arbitrum (a few cents).'),
      h('label', {}, 'Send my withdraw to (Arbitrum address)'), wto,
      h('p', { class: 'mute' }, `Withdraw: you only sign. We pay the network cost. A flat ${cfg.withdraw_fee || '1'} ${'USDT/USDC'} network fee is taken from the amount. You need no ETH.`),
      h('button', { class: 'btn alt', onclick: act(async () => { await chainWithdraw(asset.value, amt.value, wto.value.trim()); route(); }) }, 'Withdraw')]
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

// ---------- ID check: phone, ID type, photos, name + number, a short video, send ----------
// Send a photo or video as raw bytes, with a progress bar.
function sendFile(kind, blob, onProgress) {
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/kyc/file/' + kind);
    x.setRequestHeader('authorization', 'Bearer ' + token); x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status < 300 ? ok(j) : no(new Error(j.error || 'Upload failed.')); };
    x.onerror = () => no(new Error('Upload failed. Check your internet and try again.'));
    x.send(blob);
  });
}
// Make an ID photo smaller (max 1600 px) but still sharp enough to read.
function shrinkId(file) {
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? ok(b) : no(new Error('Could not read that photo.'))), 'image/jpeg', 0.9);
    };
    img.onerror = () => no(new Error('Could not read that photo. Use JPG or PNG.')); img.src = url;
  });
}

// Live camera inside the app: shows the back camera, the person presses the button, we keep the picture.
function cameraShot(label) {
  return new Promise((resolve, reject) => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then((stream) => {
      const v = h('video', { autoplay: true, muted: true, playsinline: true }); v.srcObject = stream;
      const stop = () => stream.getTracks().forEach((tr) => tr.stop());
      const back = h('div', { class: 'modal-back camback' });
      const done = (blob) => { stop(); back.remove(); resolve(blob); };
      const shoot = h('button', { class: 'btn big-btn', type: 'button', onclick: () => {
        const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
        if (!c.width) return; c.getContext('2d').drawImage(v, 0, 0); c.toBlob((b) => done(b), 'image/jpeg', 0.92);
      } }, '📸 ' + t('Take the photo'));
      back.append(h('div', { class: 'modal cam' }, h('h2', {}, label), h('p', { class: 'mute small' }, t('Fill the frame with the ID. All 4 corners visible. No light reflection.')),
        h('div', { class: 'camview' }, v, h('div', { class: 'camguide' })), shoot, h('button', { class: 'btn alt', type: 'button', onclick: () => done(null) }, t('Cancel'))));
      document.body.append(back);
    }).catch(() => reject(new Error('Camera blocked. Allow the camera for this site, then try again.')));
  });
}

async function idCheckCard() {
  const st = await api('GET', '/kyc/me');
  if (st.last && st.last.status === 'PENDING') return h('div', { class: 'card kyc' }, h('div', { class: 'kdone' }, h('div', { class: 'kicon' }, '⏳'),
    h('div', {}, h('h2', {}, 'We are checking your ID'), h('p', { class: 'mute' }, ['QUEUED', 'RUNNING'].includes(st.last.auto_status)
      ? t('Our system is checking your photos and video now. It usually takes a few minutes. Open this page again soon.')
      : `Sent ${new Date(st.last.created_at).toLocaleString()}. A staff member looks at your photos and video, usually within a few hours. You can trade as soon as it is approved.`))));
  const have = new Set(st.drafts.map((d) => d.kind));
  let idType = null;
  const card = h('div', { class: 'card kyc' });
  const step = (n, title, sub, body, done) => h('div', { class: 'kstep' + (done ? ' ok' : '') }, h('div', { class: 'knum' }, done ? '✓' : n),
    h('div', { class: 'kbody' }, h('h3', {}, title), sub ? h('p', { class: 'mute' }, sub) : null, body));
  // photo tile
  const photoTile = (kind, label) => {
    // The photo is taken with the camera, inside the app. No gallery, no old pictures.
    const camOk = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
    const status = h('div', { class: 'mute' }, have.has(kind) ? '✓ Uploaded. Tap to take it again.' : 'Tap to open the camera');
    const tile = h(camOk ? 'button' : 'label', { type: camOk ? 'button' : undefined, class: 'ptile' + (have.has(kind) ? ' ok' : '') }, camOk ? null : input, h('div', { class: 'pic' }, '📷'), h('b', {}, label), status);
    const useBlob = (raw) => act(async () => {
      const blob = await shrinkId(raw);
      tile.querySelector('.pic').replaceChildren(h('img', { src: URL.createObjectURL(blob), alt: '' }));
      status.textContent = 'Uploading…';
      await sendFile(kind, blob, (p) => { status.textContent = 'Uploading ' + Math.round(p * 100) + '%'; });
      have.add(kind); tile.classList.add('ok'); status.textContent = '✓ Uploaded. Tap to take it again.'; paint();
    });
    if (camOk) tile.addEventListener('click', act(async () => { const b = await cameraShot(label); if (b) await useBlob(b)(); }));
    else input.addEventListener('change', () => input.files[0] && useBlob(input.files[0])());
    return tile;
  };
  const front = photoTile('FRONT', 'Front of the ID'), back = photoTile('BACK', 'Back of the ID');
  const types = h('div', { class: 'idtypes' }, Object.entries(st.id_types).map(([k, label]) => h('button', { type: 'button', class: 'idt', onclick: (e) => {
    idType = k; types.querySelectorAll('.idt').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); paint();
  } }, h('span', {}, { NATIONAL_ID: '🪪', PASSPORT: '🛂', DRIVER_LICENSE: '🚗' }[k]), label)));
  const nameIn = h('input', { value: st.full_name }), numIn = h('input', { placeholder: 'The number printed on your ID' });

  // ---- video ----
  const vStatus = h('div', { class: 'mute' }, have.has('VIDEO') ? '✓ Video uploaded. You can record again.' : '');
  const vBox = h('div', { class: 'vbox hidden' });
  const vFile = h('input', { type: 'file', accept: 'video/*', capture: 'user', class: 'hidden' });
  const uploadVideo = async (blob) => {
    vStatus.textContent = 'Uploading video…';
    await sendFile('VIDEO', blob, (p) => { vStatus.textContent = 'Uploading video ' + Math.round(p * 100) + '%'; });
    have.add('VIDEO'); vStatus.textContent = '✓ Video uploaded. You can record again.'; paint();
  };
  vFile.addEventListener('change', act(async () => {
    const f = vFile.files[0]; if (!f) return;
    vBox.classList.remove('hidden'); vBox.replaceChildren(h('video', { src: URL.createObjectURL(f), controls: true, playsinline: true }));
    await uploadVideo(f);
  }));
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const record = act(async () => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: true }); }
    catch { throw new Error('Camera blocked. Allow the camera and microphone for this site, then try again.'); }
    const live = h('video', { autoplay: true, muted: true, playsinline: true }); live.srcObject = stream;
    const clock = h('span', { class: 'rec' }, '● 0s');
    const stop = h('button', { class: 'btn danger', type: 'button' }, 'Stop');
    // The app tells the person what to do, and takes 3 face pictures by itself for the automatic check.
    const say = h('div', { class: 'vsay' }), sayTxt = h('b', {}, t('Look straight at the camera')), sayScript = h('div', { class: 'vscript hidden' }, '"' + st.script + '"');
    say.append(sayTxt, sayScript);
    vBox.classList.remove('hidden'); vBox.replaceChildren(h('div', { class: 'vlive' }, live, say), h('div', { class: 'vbar' }, clock, stop));
    const faces = {};
    const grab = (kind) => {
      if (!live.videoWidth) return;
      const k = Math.min(1, 720 / Math.max(live.videoWidth, live.videoHeight)), c = document.createElement('canvas');
      c.width = Math.round(live.videoWidth * k); c.height = Math.round(live.videoHeight * k);
      c.getContext('2d').drawImage(live, 0, 0, c.width, c.height); c.toBlob((b) => { if (b) faces[kind] = b; }, 'image/jpeg', 0.88);
    };
    const STEPS = { 3: 'Turn your head slowly to the LEFT ⬅️', 6: 'Now turn your head to the RIGHT ➡️', 9: 'Hold your ID next to your face and read out loud:' };
    const SHOTS = { 2: 'FACE1', 5: 'FACE2', 8: 'FACE3' };
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 700000 } : undefined);
    const parts = []; rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    let secs = 0; const tick = setInterval(() => {
      clock.textContent = '● ' + (++secs) + 's';
      if (SHOTS[secs]) grab(SHOTS[secs]);
      if (STEPS[secs]) { sayTxt.textContent = t(STEPS[secs]); if (secs === 9) sayScript.classList.remove('hidden'); }
      if (secs >= 30) rec.stop();
    }, 1000);
    rec.onstop = act(async () => {
      clearInterval(tick); stream.getTracks().forEach((tr) => tr.stop());
      const blob = new Blob(parts, { type: rec.mimeType || 'video/webm' });
      vBox.replaceChildren(h('video', { src: URL.createObjectURL(blob), controls: true, playsinline: true }));
      if (secs < 12) throw new Error('Too short. Follow the steps on the screen and say the whole sentence.');
      await uploadVideo(blob);
      for (const kind of ['FACE1', 'FACE2', 'FACE3']) if (faces[kind]) await sendFile(kind, faces[kind]).catch(() => {});
    });
    stop.onclick = () => rec.state !== 'inactive' && rec.stop();
    rec.start(1000);
  });

  const send = h('button', { class: 'btn big-btn', type: 'button', onclick: act(async () => {
    if (!idType) throw new Error('Pick your ID type (step 2).');
    await api('POST', '/kyc', { id_type: idType, name_on_id: nameIn.value, id_number: numIn.value });
    toast('Sent. We will check it soon.'); route();
  }) }, 'Send for review');
  const checklist = h('div', { class: 'mute center' });
  function paint() {
    const needBack = idType && idType !== 'PASSPORT';
    back.classList.toggle('hidden', !needBack);
    const miss = [];
    if (!idType) miss.push('ID type'); if (!have.has('FRONT')) miss.push('front photo'); if (needBack && !have.has('BACK')) miss.push('back photo'); if (!have.has('VIDEO')) miss.push('video');
    checklist.textContent = miss.length ? 'Still needed: ' + miss.join(', ') + '.' : 'All ready. Press Send.';
    send.disabled = miss.length > 0;
    card.querySelectorAll('[data-k]').forEach((el) => el.classList.toggle('ok', { type: !!idType, photos: have.has('FRONT') && (!needBack || have.has('BACK')), video: have.has('VIDEO') }[el.dataset.k]));
  }
  const s2 = step(2, 'Choose your ID', 'Use a real, valid ID with your photo.', types); s2.dataset.k = 'type';
  const s3 = step(3, 'Take photos of your ID', 'With the camera in the app. Put the ID on a table: all 4 corners visible, no light reflection, text easy to read. Passport: one photo of the page with your picture.', h('div', { class: 'ptiles' }, front, back)); s3.dataset.k = 'photos';
  const s5 = step(5, 'Record a short video', canRecord ? t('Follow what the screen says: look straight, turn your head left, then right. Then hold your ID next to your face and read this sentence out loud:') : 'Look at the camera. Hold your ID next to your face. Read this sentence out loud:',
    h('div', {}, h('div', { class: 'script' }, '"' + st.script + '"'),
      h('div', { class: 'gactions' }, canRecord ? h('button', { class: 'btn', type: 'button', onclick: record }, '🎥 Record now') : h('label', { class: 'btn filebtn' }, vFile, '🎥 Record a video')),
      vBox, vStatus)); s5.dataset.k = 'video';
  card.append(...[
    h('h2', {}, 'Verify your identity'),
    h('p', { class: 'mute' }, 'Everybody who trades here is a real, checked person. This keeps scammers out. It takes about 3 minutes.'),
    st.last && st.last.status === 'REJECTED' ? h('p', { class: 'warn-note' }, 'Your last ID was not accepted. Please try again with clear photos and a clear video.') : null,
    step(1, 'Account confirmed', `${st.phone} — you confirmed your account with a code when you signed up.`, null, true),
    s2, s3,
    step(4, 'Your name and ID number', 'Exactly as written on the ID.', h('div', {}, h('label', {}, 'Name on the ID'), nameIn, h('label', {}, 'ID number'), numIn)),
    s5,
    h('div', { class: 'kfoot' }, checklist, send),
    h('p', { class: 'mute center' }, '🔒 Only our staff can see your ID and video. We never show them to other users.')].filter(Boolean));
  paint();
  return card;
}


// ---------- account home: like a mobile bank app ----------
const L3 = (o) => o[lang] || o.en;
async function accountHome(app) {
  const u = me.user, first = (u.display_name || u.full_name).split(' ')[0];
  const [orders, sells, buys, check] = await Promise.all([api('GET', '/orders').catch(() => []), api('GET', '/ads?side=SELL').catch(() => []), api('GET', '/ads?side=BUY').catch(() => []), toCheckCard()]);
  const bestSell = sells.length ? Number(sells[0].price_htg) : null, bestBuy = buys.length ? Number(buys[0].price_htg) : null;
  const sum = (k) => me.wallet.reduce((a, w) => a + Number(w[k] || 0), 0);
  const avail = sum('available'), locked = sum('locked'), total = avail + locked;
  const hide = (() => { try { return localStorage.getItem('hideBal') === '1'; } catch { return false; } })();
  const mask = (txt) => (hide ? '•••••' : txt);
  const quick = (ic, label, fn) => h('button', { class: 'qa', onclick: fn }, h('span', { class: 'qi' }, ic), h('span', {}, label));
  const myTurn = orders.filter((o) => (o.buyer_id === u.id && o.state === 'AWAITING_PAYMENT') || (o.seller_id === u.id && o.state === 'PAID_CLAIMED'));
  const row = (o) => {
    const buy = o.buyer_id === u.id;
    return h('button', { class: 'txrow', onclick: () => go('order/' + o.id) },
      h('span', { class: 'txi ' + (buy ? 'in' : 'out') }, buy ? '↓' : '↑'),
      h('span', { class: 'txm' }, h('b', {}, (buy ? L3({ en: 'Bought', fr: 'Achat', ht: 'Achte' }) : L3({ en: 'Sold', fr: 'Vente', ht: 'Vann' })) + ' ' + usd2(o.amount) + ' ' + o.asset),
        h('small', {}, new Date(o.created_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + t((STATE_TEXT[o.state] || [o.state])[0]))),
      h('span', { class: 'txa ' + (buy ? 'in' : 'out') }, (buy ? '−' : '+') + money(o.total_htg, 0) + ' HTG'));
  };
  app.append(
    h('div', { class: 'bank' },
      h('div', { class: 'hello' }, L3({ en: 'Hello', fr: 'Bonjour', ht: 'Bonjou' }) + ', ' + first + ' 👋'),
      u.tier < 1 ? h('button', { class: 'kycbar', onclick: () => go('profile') }, h('b', {}, L3({ en: 'Verify your identity', fr: 'Vérifiez votre identité', ht: 'Verifye idantite w' })),
        h('span', {}, L3({ en: 'Needed before your first swap. Takes 3 minutes. →', fr: 'Nécessaire avant votre premier échange. 3 minutes. →', ht: 'Ou bezwen l anvan premye echanj ou. Li pran 3 minit. →' }))) : null,
      h('div', { class: 'balcard' },
        h('div', { class: 'bc-top' }, h('span', {}, L3({ en: 'Total balance', fr: 'Solde total', ht: 'Balans total' })),
          h('button', { class: 'eye', onclick: () => { try { localStorage.setItem('hideBal', hide ? '0' : '1'); } catch {} route(); } }, hide ? '🙈' : '👁')),
        h('div', { class: 'bc-amt' }, mask(usd2(total)), h('small', {}, ' USDT')),
        h('div', { class: 'bc-htg' }, bestBuy ? '≈ ' + mask(money(total * bestBuy, 0)) + ' HTG' : ''),
        h('div', { class: 'bc-row' },
          h('div', {}, h('small', {}, L3({ en: 'Available', fr: 'Disponible', ht: 'Disponib' })), h('b', {}, mask(usd2(avail)))),
          h('div', {}, h('small', {}, '🔒 ' + L3({ en: 'Locked in swaps', fr: 'Verrouillé', ht: 'Kadnase' })), h('b', {}, mask(usd2(locked)))))),
      h('div', { class: 'qas' },
        quick('↓', L3({ en: 'Buy', fr: 'Acheter', ht: 'Achte' }), () => { marketSide = 'SELL'; go('market'); }),
        quick('↑', L3({ en: 'Sell', fr: 'Vendre', ht: 'Vann' }), () => { marketSide = 'BUY'; go('market'); }),
        quick('＋', L3({ en: 'Deposit', fr: 'Dépôt', ht: 'Depo' }), () => go('wallet')),
        quick('➜', L3({ en: 'Withdraw', fr: 'Retrait', ht: 'Retire' }), () => go('wallet'))),
      check,
      myTurn.length ? h('div', { class: 'card guide go' }, h('h3', { class: 'ct' }, L3({ en: 'Waiting for you', fr: 'En attente de vous', ht: 'Y ap tann ou' })),
        h('div', { class: 'txlist' }, myTurn.map(row))) : null,
      h('div', { class: 'prices' },
        h('div', {}, h('small', {}, L3({ en: 'Best price to buy', fr: 'Meilleur prix d\'achat', ht: 'Pi bon pri pou achte' })), h('b', {}, bestSell ? money(bestSell) : '—'), h('small', {}, 'HTG / USDT')),
        h('div', {}, h('small', {}, L3({ en: 'Best price to sell', fr: 'Meilleur prix de vente', ht: 'Pi bon pri pou vann' })), h('b', {}, bestBuy ? money(bestBuy) : '—'), h('small', {}, 'HTG / USDT'))),
      h('div', { class: 'card' }, h('div', { class: 'dhead' }, h('h3', { class: 'ct' }, L3({ en: 'Recent transactions', fr: 'Transactions récentes', ht: 'Dènye tranzaksyon' })),
        orders.length ? h('button', { class: 'linkbtn', onclick: () => go('orders') }, L3({ en: 'See all', fr: 'Tout voir', ht: 'Wè tout' })) : null),
        orders.length ? h('div', { class: 'txlist' }, orders.slice(0, 6).map(row)) : h('p', { class: 'mute' }, L3({ en: 'No transactions yet. Tap Buy or Sell to start.', fr: 'Aucune transaction. Touchez Acheter ou Vendre.', ht: 'Poko gen tranzaksyon. Peze Achte oswa Vann pou kòmanse.' })))));
}

// ---------- linked accounts (another verified person's MonCash/NatCash/bank) ----------
async function linkedView(app) {
  const d = await api('GET', '/links');
  const fee = d.fee, ph = h('input', { inputmode: 'tel', placeholder: '+509 3700 1234' });
  const own = me.payment_methods.filter((p) => !p.linked && p.verified);
  const pay = (p) => `${p.bank_name || PAY_NAME[p.type] || ''} ${p.account_ref || ''}`.trim();
  const endBtn = (l, label) => h('button', { class: 'btn alt sm', onclick: () => modal(label + '?', h('p', {}, 'The account cannot be used for new orders after this.'),
    [{ label: 'Keep' }, { label, cls: 'danger', run: async () => { await api('POST', `/links/${l.id}/end`); me = await api('GET', '/me'); route(); } }]) }, label);
  app.append(...[
    h('div', { class: 'card' }, h('h2', {}, 'Linked accounts'),
      h('p', {}, 'Receive gourdes into more MonCash, NatCash or bank accounts. For example when one account is full.'),
      h('ol', { class: 'gsteps' },
        h('li', {}, 'The other person opens their own Ayiti P2P account and finishes the ID check.'),
        h('li', {}, 'You ask them here, with their phone number.'),
        h('li', {}, 'They accept in their app and choose which of their accounts to share.'),
        h('li', {}, 'When a buyer pays into that account, the owner confirms in their app that the gourdes arrived.')),
      h('p', { class: 'mute' }, `Each linked account costs ${fee} USDT a month, taken from your wallet. Your own accounts are free.`)),
    d.asked.length ? h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'People asking to use your account'),
      h('div', { class: 'accs' }, d.asked.map((l) => {
        if (l.status === 'ACTIVE') return h('div', { class: 'acc' }, h('div', {}, h('b', {}, l.owner_name), h('div', { class: 'mute' }, 'Uses your ' + pay(l))), endBtn(l, 'Stop sharing'));
        const sel = h('select', {}, own.map((p) => h('option', { value: p.id }, accLabel(p))));
        return h('div', { class: 'acc' }, h('div', {}, h('b', {}, l.owner_name), h('div', { class: 'mute' }, `${l.owner_phone} wants to receive gourdes into one of your accounts. You will confirm each payment.`),
          own.length ? sel : h('div', { class: 'mute' }, 'Add a verified account in Profile first.')),
          h('div', { class: 'gactions', style: 'flex:none' },
            h('button', { class: 'btn good sm', onclick: act(async () => { if (!own.length) throw new Error('Add a verified account in Profile first.'); await api('POST', `/links/${l.id}/accept`, { payment_method_id: sel.value }); route(); }) }, 'Accept'),
            endBtn(l, 'Refuse')));
      }))) : null,
    h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'My linked accounts'),
      d.mine.length ? h('div', { class: 'accs' }, d.mine.map((l) => h('div', { class: 'acc' },
        h('div', {}, h('b', {}, l.member_name), h('div', { class: 'mute' }, l.status === 'ACTIVE' ? pay(l) + (l.paid_until ? ' · paid until ' + new Date(l.paid_until).toLocaleDateString() : ' · free') : 'Waiting for them to accept')),
        h('div', { class: 'gactions', style: 'flex:none' }, h('span', { class: 'pill ' + (l.status === 'ACTIVE' ? 'good' : 'warn') }, l.status === 'ACTIVE' ? 'active' : 'waiting'), endBtn(l, l.status === 'ACTIVE' ? 'Remove' : 'Cancel')))))
        : h('p', { class: 'mute' }, 'None yet.'),
      h('h3', { class: 'ct', style: 'margin-top:18px' }, 'Ask someone'),
      h('label', {}, 'Their phone number (they must already have a verified account)'), ph,
      h('button', { class: 'btn', style: 'margin-top:12px', onclick: act(async () => { await api('POST', '/links', { phone: ph.value }); toast('Asked. They will see it in their app.'); route(); }) }, 'Send request'))].filter(Boolean));
}

// Payments into my account that I must check (when I lent my account to someone).
async function toCheckCard() {
  const list = await api('GET', '/links/to-check').catch(() => []);
  if (!list.length) return null;
  return h('div', { class: 'card guide go' }, h('h2', {}, 'Check your account'),
    h('p', { class: 'mute' }, 'Someone you linked your account to is waiting. Look at your account, then answer.'),
    h('div', { class: 'accs' }, list.map((o) => h('div', { class: 'acc' },
      h('div', {}, h('b', {}, money(o.total_htg) + ' HTG'), h('div', { class: 'mute' }, `${o.bank_name || PAY_NAME[o.type]} ${o.account_ref} · from ${o.payer} · code ${o.pay_reference} · for ${o.trader}`),
        o.receiver_said ? h('div', { class: 'mute' }, 'You said: ' + (o.receiver_said === 'RECEIVED' ? 'received ✓' : 'not received')) : null),
      h('div', { class: 'gactions', style: 'flex:none' },
        h('button', { class: 'btn good sm', onclick: act(async () => { await api('POST', `/links/to-check/${o.id}`, { received: true }); route(); }) }, 'It arrived'),
        h('button', { class: 'btn alt sm', onclick: act(async () => { await api('POST', `/links/to-check/${o.id}`, { received: false }); route(); }) }, 'Not yet'))))));
}
// Make a poster smaller (max 1280 px) so it loads fast on a phone, but stays sharp.
function shrinkPoster(file) {
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let q = 0.85, d = c.toDataURL('image/jpeg', q);
      while (d.length > 780000 && q > 0.4) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
      ok(d);
    };
    img.onerror = () => no(new Error('Could not read that picture.')); img.src = url;
  });
}

// "My business profile": what buyers see before they trade with you.
async function businessCard(u) {
  const pubP = await api('GET', '/public/profile/' + u.id).catch(() => ({ posters: [] }));
  let photo, rmin = u.response_min || null;
  const pub = h('input', { value: u.display_name || '', placeholder: 'Optional. A company or trading name', maxlength: 40 });
  const bio = h('textarea', { rows: 3, maxlength: 300, placeholder: 'Tell buyers why to trade with you: your hours, how fast you answer, your experience. No phone numbers or links.' }, u.bio || '');
  const dep = h('select', {}, h('option', { value: '' }, '—'), (cfg.departments || []).map((d) => h('option', { value: d, selected: d === u.department }, d)));
  const area = h('input', { value: u.area || '', maxlength: 60, placeholder: 'City or area, e.g. Delmas, Cap-Haïtien, Miami' });
  const face = h('div', { class: 'avwrap' }, avatarEl(u.id, u.display_name || u.full_name, u.has_avatar, 'xl'));
  const pick = (capture) => { const f = h('input', { type: 'file', accept: 'image/*', class: 'hidden', ...(capture ? { capture: 'user' } : {}) });
    f.addEventListener('change', act(async () => { if (!f.files[0]) return; photo = await shrinkPhoto(f.files[0]); face.replaceChildren(h('div', { class: 'avatar xl' }, h('img', { src: photo, alt: '' }))); paintMeter(); })); return f; };
  const chips = h('div', { class: 'chips' }, (cfg.response_mins || [5, 10, 15, 30, 60]).map((m) => h('button', { type: 'button', class: 'chip' + (m === rmin ? ' on' : ''), onclick: (e) => {
    rmin = rmin === m ? null : m; chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.m) === rmin)); paintMeter(); }, 'data-m': m }, SLA(m))));
  let posters = [...(pubP.posters || [])];
  const grid = h('div', { class: 'posters edit' });
  const addIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden', multiple: true });
  addIn.addEventListener('change', act(async () => {
    for (const f of [...addIn.files]) {
      if (posters.length >= 6) { toast('Up to 6 posters.', true); break; }
      const r = await api('POST', '/me/posters', { image: await shrinkPoster(f) }); posters.push(r.id);
    }
    addIn.value = ''; paintPosters(); paintMeter(); toast('Poster added.');
  }));
  const paintPosters = () => grid.replaceChildren(...posters.map((id) => h('div', { class: 'poster' }, h('img', { src: '/api/public/poster/' + id, alt: '', onclick: () => lightbox('/api/public/poster/' + id) }),
    h('button', { class: 'pdel', title: 'Remove', onclick: act(async () => { await api('DELETE', '/me/posters/' + id); posters = posters.filter((x) => x !== id); paintPosters(); paintMeter(); }) }, '✕'))),
    posters.length < 6 ? h('label', { class: 'poster add' }, addIn, h('span', {}, '＋'), h('small', {}, 'Add poster')) : null);
  const meter = h('div', { class: 'meter' }), tips = h('div', { class: 'mute small nt' });
  function paintMeter() {
    const items = [[u.has_avatar || !!photo, { en: 'a photo of your face', fr: 'une photo de votre visage', ht: 'yon foto figi w' }], [!!pub.value.trim(), { en: 'a public name', fr: 'un nom public', ht: 'yon non piblik' }],
      [bio.value.trim().length >= 20, { en: 'a few words about you', fr: 'quelques mots sur vous', ht: 'kèk mo sou ou' }], [!!dep.value, { en: 'your area', fr: 'votre zone', ht: 'zòn ou' }],
      [!!rmin, { en: 'your response time', fr: 'votre délai de réponse', ht: 'tan ou pran pou reponn' }], [posters.length > 0, { en: 'a business poster', fr: 'une affiche', ht: 'yon afich biznis' }]];
    const done = items.filter((x) => x[0]).length, pct = Math.round(100 * done / items.length);
    meter.replaceChildren(h('div', { class: 'meter-bar' }, h('i', { style: `width:${pct}%` })), h('b', {}, pct + '%'));
    const miss = items.filter((x) => !x[0]).map((x) => L3(x[1]));
    tips.textContent = miss.length ? L3({ en: 'Add ', fr: 'Ajoutez ', ht: 'Mete ' }) + miss.join(', ') + L3({ en: ' to get more buyers.', fr: ' pour avoir plus d\'acheteurs.', ht: ' pou w jwenn plis achtè.' })
      : L3({ en: 'Your profile is complete. Buyers love that.', fr: 'Votre profil est complet. Les acheteurs adorent.', ht: 'Pwofil ou konplè. Achtè yo renmen sa.' });
  }
  [pub, bio, dep, area].forEach((x) => x.addEventListener('input', paintMeter));
  paintPosters(); paintMeter();
  return h('div', { class: 'card bizcard' },
    h('div', { class: 'bc-top' }, h('div', {}, h('h3', { class: 'ct' }, 'My business profile'), h('p', { class: 'mute' }, 'This is your shop window. Buyers check it before they trade.')),
      h('button', { class: 'btn alt sm', onclick: () => go('u/' + u.id) }, '👁 ' + t('See my public page'))),
    meter, tips,
    h('div', { class: 'facebox' }, face, h('div', {},
      h('b', {}, '📸 A photo of your face'),
      h('p', { class: 'mute small' }, 'Optional, but people trust a real face. Profiles with a face photo get more orders.'),
      h('div', { class: 'gactions' }, h('label', { class: 'btn sm filebtn' }, pick(true), 'Take a selfie'), h('label', { class: 'btn alt sm filebtn' }, pick(false), 'Choose a photo')))),
    h('label', {}, 'Public name or company'), pub,
    h('label', {}, 'About you'), bio,
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Department'), dep), h('div', {}, h('label', {}, 'City or area'), area)),
    h('label', {}, 'How fast do you usually answer an order?'), chips,
    h('label', {}, 'Business posters (up to 6)'), h('p', { class: 'mute small' }, 'Your flyer, your shop, your prices, your hours. No phone numbers or links: keep the deal in the app.'), grid,
    h('button', { class: 'btn big-btn', onclick: act(async () => {
      await api('PUT', '/me/profile', { display_name: pub.value, bio: bio.value, avatar: photo, department: dep.value || null, area: area.value, response_min: rmin });
      me = await api('GET', '/me'); toast('Profile saved.'); route();
    }) }, 'Save my profile'));
}

async function profileView(app) {
  const u = me.user;
  const type = h('select', {}, h('option', {}, 'MONCASH'), h('option', {}, 'NATCASH'), h('option', {}, 'BANK'));
  const bank = bankPicker(), bankRow = h('div', { class: 'hidden' }, h('label', {}, 'Which bank?'), bank.el);
  type.addEventListener('change', () => bankRow.classList.toggle('hidden', type.value !== 'BANK'));
  const an = h('input', { placeholder: 'Name on the account (must match your ID)' });
  const ar = h('input', { placeholder: 'Phone number or bank account number' });
  const prev = h('div', { class: 'avwrap' }, avatarEl(u.id, u.display_name || u.full_name, u.has_avatar, 'xl'));
  const methods = me.payment_methods.filter((p) => !p.linked);
  const menu = [['welcome', '🌐', 'Home page'], ['ads', '📣', 'My ads'], ['linked', '🔗', 'Linked accounts'], ['safety', '🛡️', 'Safety'], ['legal/terms', '📄', 'Legal']];
  if (['AGENT', 'ADMIN'].includes(u.role)) menu.push(['staff', '🧑‍⚖️', 'Staff']);
  if (u.role === 'ADMIN') menu.push(['admin', '⚙️', 'Admin']);
  app.append(
    h('div', { class: 'card menu-m' }, menu.map(([k, ic, label]) => h('button', { class: 'mrow', onclick: () => go(k) }, h('span', {}, ic), h('b', {}, t(label)), h('span', { class: 'mute' }, '›'))),
      h('button', { class: 'mrow', onclick: logout }, h('span', {}, '🚪'), h('b', {}, t('Log out')), h('span', {}, ''))),
    h('div', { class: 'card' }, h('h2', {}, t('Profile')),
      h('div', { class: 'pfhead' }, prev, h('div', {}, h('b', {}, u.display_name || u.full_name), h('div', { class: 'mute' }, u.display_name ? 'ID name: ' + u.full_name + ' (private)' : u.phone),
        h('span', { class: 'pill ' + (u.tier >= 1 ? 'good' : 'warn') }, 'Tier ' + u.tier), u.strikes ? h('span', { class: 'pill bad' }, u.strikes + ' strike(s)') : null)),
      u.tier >= 1 ? h('p', { class: 'mute' }, '✓ ID check done.') : null),
    ...(u.tier < 1 ? [await idCheckCard()] : []),
    await businessCard(u),
    h('div', { class: 'card' }, h('h3', { class: 'ct' }, 'My payment accounts'),
      h('p', { class: 'mute' }, 'You can add MonCash, NatCash and bank accounts, and as many numbers as you want. The name on each one must match your ID.'),
      methods.length ? h('div', { class: 'accs' }, methods.map((p) => h('div', { class: 'acc' },
        h('div', { class: 'accrow' }, accLogo(p), h('div', {}, h('b', {}, p.bank_name ? p.bank_name : PAY_NAME[p.type] || p.type), h('div', { class: 'mute' }, `${p.type === 'BANK' ? 'Account' : PAY_NAME[p.type] || p.type} ${p.account_ref} · ${p.account_name}`))),
        h('span', { class: 'pill ' + (p.verified ? 'good' : 'warn') }, p.verified ? 'verified' : 'name does not match ID'))))
        : h('p', { class: 'mute' }, 'None yet. Add one after your ID check is approved.'),
      h('h3', { class: 'ct', style: 'margin-top:16px' }, 'Add an account'),
      h('label', {}, 'Type'), type, bankRow, h('label', {}, 'Name on the account'), an, h('label', {}, 'Number'), ar,
      h('button', { class: 'btn', style: 'margin-top:12px', onclick: act(async () => { await api('POST', '/payment-methods', { type: type.value, account_name: an.value, account_ref: ar.value, bank_name: type.value === 'BANK' ? bank.value() : undefined }); me = await api('GET', '/me'); route(); }) }, 'Add account')));
}

// ---------- staff ----------
const ID_NAME = { NATIONAL_ID: 'National ID card', PASSPORT: 'Passport', DRIVER_LICENSE: "Driver's license" };
// What the automatic ID check saw (green = passed, red = needs a human look).
function robotBox(k) {
  const r = k.auto_result || {}, st = k.auto_status;
  if (!st || st === 'QUEUED' || st === 'RUNNING') return h('div', { class: 'robot' }, h('b', {}, '🤖 Automatic check: ' + (st === 'RUNNING' ? 'running now…' : 'waiting in line (about 1 minute)')));
  return h('div', { class: 'robot' }, h('b', {}, '🤖 Automatic check: ' + (r.pass ? 'everything passed' : 'needs you')), r.note ? h('div', { class: 'mute' }, r.note) : null,
    h('ul', {}, (r.checks || []).map((c) => h('li', { class: c.ok ? 'ok' : c.blocking ? 'no' : 'soft' }, (c.ok ? '✓ ' : c.blocking ? '✗ ' : '• ') + c.label + (c.detail ? ' — ' + c.detail : '')))),
    h('button', { class: 'btn alt small', type: 'button', onclick: act(async () => { await api('POST', `/staff/kyc/${k.id}/recheck`); toast('Checking again…'); route(); }) }, 'Check again'));
}
// One ID check for staff: details, photos, the video, and what the person had to say.
function kycReview(k) {
  const media = h('div', { class: 'kmedia' });
  ['FRONT', 'BACK', 'VIDEO'].filter((x) => (k.files || []).includes(x)).forEach((kind) => {
    const slot = h('div', { class: 'kslot' }, h('div', { class: 'mute' }, { FRONT: 'Front', BACK: 'Back', VIDEO: 'Video' }[kind]), h('div', { class: 'mute' }, 'Loading…'));
    media.append(slot);
    fetch(`/api/staff/kyc/${k.id}/file/${kind}`, { headers: { authorization: 'Bearer ' + token } }).then((r) => r.blob()).then((b) => {
      const src = URL.createObjectURL(b);
      slot.lastChild.replaceWith(kind === 'VIDEO' ? h('video', { src, controls: true, playsinline: true }) : h('a', { href: src, target: '_blank' }, h('img', { src, alt: kind })));
    }).catch(() => { slot.lastChild.textContent = 'Could not load.'; });
  });
  const same = String(k.name_on_id).trim().toLowerCase() === String(k.full_name).trim().toLowerCase();
  return h('div', { class: 'kitem' },
    kv([['Account name', k.full_name], ['Name on ID', k.name_on_id + (same ? ' ✓' : ' ⚠ different')], ['ID', (ID_NAME[k.id_type] || k.id_type || 'old form') + (k.id_number ? ' · ' + k.id_number : '')],
      ['Phone', k.phone], k.challenge ? ['Must say', `"My name is ${k.full_name}. My phone number is ${k.phone}. My code is ${k.challenge}."`] : null, ['Sent', new Date(k.created_at).toLocaleString()]]),
    media, robotBox(k),
    h('p', { class: 'mute' }, 'Check: the face in the video is the face on the ID · they say the right name, phone and code · the ID looks real and not expired.'),
    h('div', { class: 'gactions' }, h('button', { class: 'btn good', onclick: act(async () => { await api('POST', `/staff/kyc/${k.id}/decision`, { approve: true }); route(); }) }, 'Approve'),
      h('button', { class: 'btn danger', onclick: act(async () => { await api('POST', `/staff/kyc/${k.id}/decision`, { approve: false }); route(); }) }, 'Reject')));
}

async function staffView(app) {
  const [kyc, disputes, hits] = await Promise.all([api('GET', '/staff/kyc'), api('GET', '/staff/disputes'), api('GET', '/staff/screening-hits')]);
  app.append(
    h('div', { class: 'card scroll' }, h('h2', {}, 'Disputes waiting'), disputes.length ? h('table', {},
      h('thead', {}, h('tr', {}, ['Opened', 'Reason', 'HTG', 'Votes', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, disputes.map((d) => h('tr', {}, h('td', {}, new Date(d.created_at).toLocaleString()), h('td', {}, d.reason), h('td', {}, money(d.total_htg)), h('td', {}, d.votes),
        h('td', {}, h('button', { class: 'btn', onclick: () => go('dispute/' + d.id) }, 'Open')))))) : h('p', { class: 'mute' }, 'Queue is empty.')),
    h('div', { class: 'card' }, h('h2', {}, 'ID checks waiting'), kyc.length ? h('div', { class: 'kreview' }, kyc.map(kycReview)) : h('p', { class: 'mute' }, 'None waiting.')),
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
// Admin: find people by phone or name, then change tier, ban or unban.
function usersCard() {
  const search = h('input', { placeholder: 'Search phone or name' }), list = h('div', { class: 'ulist' });
  const load = act(async () => {
    const rows = await api('GET', '/admin/users?q=' + encodeURIComponent(search.value.trim()));
    list.replaceChildren(...(rows.length ? rows.map((u) => {
      const tier = h('select', {}, [0, 1, 2, 3].map((n) => h('option', { selected: n === u.tier }, n)));
      return h('div', { class: 'urow' },
        h('div', {}, h('b', {}, u.display_name || u.full_name), h('div', { class: 'mute' }, `${u.phone} · ${u.role} · ${u.orders} orders` + (u.strikes ? ` · ${u.strikes} strike(s)` : '')),
          u.banned ? h('span', { class: 'pill bad' }, 'banned') : null),
        h('div', { class: 'gactions' }, h('span', { class: 'mute' }, 'Tier'), tier,
          h('button', { class: 'btn alt sm', onclick: act(async () => { await api('POST', `/admin/users/${u.id}/tier`, { tier: Number(tier.value) }); toast('Tier set.'); }) }, 'Save tier'),
          u.banned ? h('button', { class: 'btn alt sm', onclick: act(async () => { await api('POST', `/admin/users/${u.id}/unban`); load(); }) }, 'Unban')
            : h('button', { class: 'btn danger sm', onclick: () => modal('Ban ' + u.full_name + '?', h('p', {}, 'They cannot log in or trade. Their phone is blocked.'),
              [{ label: 'No' }, { label: 'Ban', cls: 'danger', run: async () => { await api('POST', `/admin/users/${u.id}/ban`, { reason: 'Admin ban' }); load(); } }]) }, 'Ban')));
    }) : [h('p', { class: 'mute' }, 'Nobody found.')]));
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  load();
  return h('div', { class: 'card' }, h('h2', {}, 'Users'), h('div', { class: 'compose', style: 'padding:0 0 10px' }, search, h('button', { class: 'btn sm', onclick: load }, 'Search')), list);
}

// MonCash / NatCash / bank outage switch. While ON: a banner shows, disputes on those orders wait,
// and the "seller silent" timer does not open disputes.
function providersCard(rows) {
  const st = Object.fromEntries(rows.map((x) => [x.provider, x]));
  return h('div', { class: 'card' }, h('h2', {}, 'Payment services status'),
    h('p', { class: 'mute' }, 'Turn ON when MonCash, NatCash or banks have problems (payments late or sent back). Everyone sees a warning, disputes wait, and nobody gets punished for the service\'s problem.'),
    ...['MONCASH', 'NATCASH', 'BANK'].map((k) => {
      const cur = st[k] || {}, note = h('input', { value: cur.note || '', placeholder: 'Short note users will see (optional)' });
      return h('div', { class: 'prov' + (cur.down ? ' down' : '') },
        h('div', { class: 'prov-name' }, h('b', {}, PAY_NAME[k]), h('span', { class: 'pill ' + (cur.down ? 'bad' : 'good') }, cur.down ? 'PROBLEM' : 'Working')), note,
        h('button', { class: 'btn sm ' + (cur.down ? 'good' : 'danger'), onclick: act(async () => { await api('POST', '/admin/providers', { provider: k, down: !cur.down, note: note.value }); toast('Saved.'); cfg = {}; route(); }) },
          cur.down ? 'Mark as working again' : 'Mark as having problems'));
    }));
}
function reportsCard(rows) {
  return h('div', { class: 'card scroll' }, h('h2', {}, 'Reports after trades'), rows.length ? h('table', {},
    h('thead', {}, h('tr', {}, ['When', 'By', 'Kind', 'Order', 'Details', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.map((x) => h('tr', { class: x.status === 'OPEN' ? '' : 'mute' }, h('td', {}, new Date(x.created_at).toLocaleString()), h('td', {}, x.reporter + ' · ' + x.phone),
      h('td', {}, x.kind === 'REVERSED' ? 'Payment reversed' : 'Other'), h('td', {}, h('a', { href: '#order/' + x.order_id }, `${usd(x.amount)} ${x.asset} · ${money(x.total_htg, 0)} HTG`)),
      h('td', {}, x.note), h('td', {}, x.status === 'OPEN' ? h('button', { class: 'btn alt sm', onclick: act(async () => { await api('POST', `/admin/reports/${x.id}/close`); route(); }) }, 'Close') : 'closed'))))) : h('p', { class: 'mute' }, 'No reports.'));
}

async function adminView(app) {
  const [limits, block, provs, reps] = await Promise.all([api('GET', '/admin/limits'), api('GET', '/admin/blocklist'), api('GET', '/admin/providers'), api('GET', '/admin/reports')]);
  app.append(providersCard(provs), reportsCard(reps));
  const rows = limits.map((l) => {
    const a = h('input', { value: l.max_order_htg }), b = h('input', { value: l.max_daily_htg }), c = h('input', { value: l.max_open_orders });
    return h('tr', {}, h('td', {}, 'Tier ' + l.tier), h('td', {}, a), h('td', {}, b), h('td', {}, c),
      h('td', {}, h('button', { class: 'btn alt', onclick: act(async () => { await api('PUT', '/admin/limits/' + l.tier, { max_order_htg: a.value, max_daily_htg: b.value, max_open_orders: c.value }); toast('Saved.'); }) }, 'Save')));
  });
  const kind = h('select', {}, ['PHONE', 'WALLET', 'PAY_ACCOUNT', 'NAME'].map((k) => h('option', {}, k))); const val = h('input', { placeholder: 'Value' });
  app.append(
    h('div', { class: 'card scroll' }, h('h2', {}, 'Limits (starting guesses, tune after the pilot)'), h('table', {}, h('thead', {}, h('tr', {}, ['Tier', 'Max per order (HTG)', 'Max per day (HTG)', 'Open orders', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))),
    usersCard(),
    h('div', { class: 'card scroll' }, h('h2', {}, 'Blocklist'), h('div', { class: 'row' }, kind, val),
      h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/admin/blocklist', { kind: kind.value, value: val.value.trim(), reason: 'Admin' }); route(); }) }, 'Add'),
      h('table', {}, h('tbody', {}, block.map((x) => h('tr', {}, h('td', {}, x.kind), h('td', {}, x.value), h('td', {}, x.reason || ''))))),
      h('button', { class: 'btn alt', onclick: act(async () => { const r = await api('POST', '/admin/run-timers'); toast('Timers ran: ' + JSON.stringify(r)); }) }, 'Run timers now')));
}

route();
