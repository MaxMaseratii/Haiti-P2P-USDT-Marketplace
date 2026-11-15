/* Home page for visitors (logged out). Uses h(), t(), lang, cfg from app.js. */

// ---------- "How it works" animation: a short silent film made of HTML, with captions in 3 languages ----------
const FILM = [
  { at: 'start', cap: { en: 'Meet Rose (buyer) and Jean (seller). Rose wants 100 USDT.', fr: 'Voici Rose (acheteuse) et Jean (vendeur). Rose veut 100 USDT.', ht: 'Men Rose (achtè) ak Jean (vandè). Rose bezwen 100 USDT.' } },
  { at: 'lock', cap: { en: 'Step 1. Jean\'s 100 USDT goes into the safe. Locked. Jean cannot take it back.', fr: 'Étape 1. Les 100 USDT de Jean vont dans le coffre. Bloqués. Jean ne peut pas les reprendre.', ht: 'Etap 1. 100 USDT Jean an ale nan kofrefò a. Li bloke. Jean pa ka repran l.' } },
  { at: 'pay', cap: { en: 'Step 2. Rose sends 14,000 HTG by MonCash, straight to Jean. We never touch the gourdes.', fr: 'Étape 2. Rose envoie 14 000 HTG par MonCash, directement à Jean. Nous ne touchons jamais aux gourdes.', ht: 'Etap 2. Rose voye 14 000 goud pa MonCash, dirèk bay Jean. Nou pa janm manyen goud yo.' } },
  { at: 'paid', cap: { en: 'Step 3. Rose presses "I have paid".', fr: 'Étape 3. Rose appuie sur « J\'ai payé ».', ht: 'Etap 3. Rose peze « Mwen peye ».' } },
  { at: 'check', cap: { en: 'Step 4. Jean checks his MonCash. The money is there. He confirms.', fr: 'Étape 4. Jean vérifie son MonCash. L\'argent est là. Il confirme.', ht: 'Etap 4. Jean tcheke MonCash li. Lajan an la. Li konfime.' } },
  { at: 'release', cap: { en: 'Step 5. The safe opens. The 100 USDT goes to Rose. Done in minutes.', fr: 'Étape 5. Le coffre s\'ouvre. Les 100 USDT vont à Rose. Fini en quelques minutes.', ht: 'Etap 5. Kofrefò a louvri. 100 USDT yo ale bay Rose. Fini nan kèk minit.' } },
  { at: 'shield', cap: { en: 'A problem? The USDT stays locked. Our staff check the proof and decide. Nobody can run away with the money.', fr: 'Un problème ? Les USDT restent bloqués. Notre équipe vérifie les preuves et décide. Personne ne peut fuir avec l\'argent.', ht: 'Gen pwoblèm? USDT yo rete bloke. Ekip nou an gade prèv yo epi deside. Pèsonn pa ka kouri ak lajan an.' } },
];

function howFilm() {
  const L = () => (['en', 'fr', 'ht'].includes(lang) ? lang : 'en');
  const coin = h('div', { class: 'f-coin' }, '₮ 100');
  const note = h('div', { class: 'f-note' }, 'G 14,000');
  const buyerScreen = h('div', { class: 'f-screen' }, h('div', { class: 'f-app' }, 'Haiti P2P'), h('div', { class: 'f-line' }, 'Buy 100 USDT'), h('div', { class: 'f-bal' }, '0 USDT'), h('div', { class: 'f-btn' }, 'I have paid'));
  const sellerScreen = h('div', { class: 'f-screen' }, h('div', { class: 'f-app mc' }, 'MonCash'), h('div', { class: 'f-line' }, 'Balance'), h('div', { class: 'f-bal' }, '2,500 HTG'), h('div', { class: 'f-btn' }, 'Release USDT'));
  const vault = h('div', { class: 'f-vault' }, h('div', { class: 'f-door' }, h('span', { class: 'f-lock' }, '🔒')), h('div', { class: 'f-vlab' }, 'Escrow'));
  const shield = h('div', { class: 'f-shield' }, '🛡️', h('small', {}, 'Staff check'));
  const stage = h('div', { class: 'f-stage' },
    h('div', { class: 'f-person f-left' }, h('div', { class: 'f-phone' }, buyerScreen), h('b', {}, 'Rose'), h('span', {}, 'buyer')),
    vault, shield,
    h('div', { class: 'f-person f-right' }, h('div', { class: 'f-phone' }, sellerScreen), h('b', {}, 'Jean'), h('span', {}, 'seller')),
    coin, note);
  const cap = h('div', { class: 'f-cap' });
  const dots = h('div', { class: 'f-dots' }, FILM.map((_, i) => h('button', { type: 'button', 'aria-label': 'Scene ' + (i + 1), onclick: () => { show(i); restart(); } })));
  const bar = h('div', { class: 'f-bar' }, h('i'));
  const play = h('button', { class: 'f-play', type: 'button', 'aria-label': 'Play or pause' }, '❚❚');
  let i = 0, timer = null, playing = true;
  const SCENE_MS = 4200;
  function show(n) {
    i = n; stage.dataset.at = FILM[n].at; cap.textContent = FILM[n].cap[L()];
    dots.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === n));
    const done = ['release', 'shield'].includes(FILM[n].at);
    buyerScreen.querySelector('.f-bal').textContent = done ? '100 USDT' : '0 USDT';
    sellerScreen.querySelector('.f-bal').textContent = ['check', 'release', 'shield', 'paid'].includes(FILM[n].at) ? '16,500 HTG' : '2,500 HTG';
    bar.firstChild.style.animation = 'none'; void bar.offsetWidth; bar.firstChild.style.animation = playing ? `fbar ${SCENE_MS}ms linear forwards` : 'none';
  }
  function restart() { clearInterval(timer); if (playing) timer = setInterval(() => show((i + 1) % FILM.length), SCENE_MS); }
  play.onclick = () => { playing = !playing; play.textContent = playing ? '❚❚' : '▶'; show(i); restart(); };
  const box = h('div', { class: 'film' }, stage, h('div', { class: 'f-ctl' }, play, dots), bar, cap);
  // Start when it is on screen. Respect people who turned off animations.
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  show(0);
  if (still) { playing = false; play.textContent = '▶'; } else if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && playing && !timer) restart(); if (!es[0].isIntersecting) { clearInterval(timer); timer = null; } }, { threshold: 0.4 });
    setTimeout(() => io.observe(box), 0);
  } else restart();
  return box;
}

// ---------- the old way vs the new way ----------
function oldWay() {
  const msg = (who, text, cls = '') => h('div', { class: 'wa ' + cls }, h('b', {}, who), text);
  return h('div', { class: 'ow-grid' },
    h('div', { class: 'ow-card bad' },
      h('div', { class: 'ow-tag' }, 'The old way'),
      h('h3', {}, 'Asking in every WhatsApp group'),
      h('div', { class: 'wa-chat' },
        msg('You', 'Who has USDT? I need 100.', 'me'),
        msg('Unknown number', 'Me. Send 14,000 HTG MonCash first, then I send.'),
        msg('You', 'Sent ✓✓', 'me'),
        msg('You', 'Hello? Did you send the USDT?', 'me'),
        msg('You', 'Please answer…', 'me'),
        h('div', { class: 'wa-sys' }, 'Seen. No answer. Number blocked.')),
      h('p', { class: 'ow-end' }, 'Money gone. Nobody to call. Nothing to do.')),
    h('div', { class: 'ow-card good' },
      h('div', { class: 'ow-tag' }, 'With Haiti P2P'),
      h('h3', {}, 'The crypto is locked before you pay'),
      h('ul', { class: 'ow-list' },
        h('li', {}, h('b', {}, 'Real people only. '), 'Every seller showed their ID and a video, and confirmed their phone.'),
        h('li', {}, h('b', {}, 'The USDT is locked first. '), 'The seller cannot take it back while you pay.'),
        h('li', {}, h('b', {}, 'Released only when the money arrives. '), 'The seller confirms they received your gourdes, then the USDT goes to you.'),
        h('li', {}, h('b', {}, 'A problem? '), 'Our staff look at the proof and decide. The crypto stays locked until then.'),
        h('li', {}, h('b', {}, 'Ratings for everyone. '), 'See each trader\'s completed trades and how fast they release.')),
      h('p', { class: 'ow-end ok' }, 'No more blind trust. No more begging in groups.')));
}

// ---------- page ----------
function homeView(app, loginCard, quickTest, adsBox) {
  const go2 = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sec = (id, kicker, title, sub, ...body) => h('section', { class: 'hsec', id }, h('div', { class: 'hkick' }, kicker), h('h2', { class: 'htitle' }, title), sub ? h('p', { class: 'hsub' }, sub) : null, ...body);
  const feat = (ic, title, text) => h('div', { class: 'feat' }, h('div', { class: 'feat-ic' }, ic), h('h3', {}, title), h('p', {}, text));

  app.append(
    // hero
    h('section', { class: 'hhero' },
      h('div', { class: 'hh-left' },
        h('div', { class: 'hkick' }, '🇭🇹 Made for Haiti · open to the world'),
        h('h1', {}, 'Buy and sell USDT with gourdes. ', h('em', {}, 'Without the risk.')),
        h('p', { class: 'lead' }, 'Pay by MonCash, NatCash or bank to a real, ID-checked person. The crypto is locked in a safe before you pay, and released only when the money arrives.'),
        h('div', { class: 'hh-cta' },
          h('button', { class: 'btn', onclick: go2('join') }, 'Create my free account'),
          h('button', { class: 'btn alt', onclick: go2('how') }, '▶ See how it works')),
        h('div', { class: 'hh-stats' },
          h('div', {}, h('b', {}, '🔒'), h('span', {}, 'Crypto locked first')),
          h('div', {}, h('b', {}, '🪪'), h('span', {}, 'Everyone ID + video checked')),
          h('div', {}, h('b', {}, '⚖️'), h('span', {}, 'Staff settle problems')))),
      h('div', { class: 'hh-right', id: 'join' }, loginCard)),
    quickTest,
    sec('how', 'How it works', 'A safe in the middle. Watch.', 'This is every trade on Haiti P2P, in 30 seconds. Change the language at the top to read it in Kreyòl or French.', howFilm()),
    sec('problem', 'The problem we solve', 'No more sending money to strangers and praying.', 'Today, to buy crypto in Haiti you ask in WhatsApp groups, send MonCash first, and hope. Too many people never get their crypto, and the seller stops answering.', oldWay()),
    sec('hold', 'How we hold the crypto', 'Both sides are protected.', null,
      h('div', { class: 'feats' },
        feat('🔐', 'The seller\'s USDT is locked', 'When you start a trade, the seller\'s USDT moves into escrow (a locked safe). The seller cannot touch it, and neither can you, until the trade ends.'),
        feat('💸', 'You pay the seller directly', 'Gourdes go straight from your MonCash, NatCash or bank to the seller. We never hold your gourdes.'),
        feat('✅', 'Confirm, then release', 'The seller checks their account. When the money is there, they confirm, and the USDT is released to your wallet.'),
        feat('⏱️', 'Clocks keep it moving', 'You have 30 minutes to pay. If the seller goes quiet after you paid, a dispute opens by itself. The USDT is never released by a timer.'),
        feat('🧾', 'Proof, not promises', 'Chat, payment code and receipts are kept in the order. In a dispute, both sides upload proof and staff decide.'),
        feat('🚫', 'Scammers get banned', 'Fake proof or no-shows bring strikes and bans. Banned phones, names and accounts cannot come back.'))),
    sec('family', 'Send money home', 'Living abroad? Send to family in Haiti, faster and for less.', null,
      h('div', { class: 'fam' },
        h('div', { class: 'fam-flow' },
          h('div', { class: 'fam-node' }, h('span', {}, '🇺🇸🇨🇦🇫🇷'), h('b', {}, 'You, abroad'), h('small', {}, 'Sell USDT on Haiti P2P')),
          h('div', { class: 'fam-arrow' }, '→'),
          h('div', { class: 'fam-node mid' }, h('span', {}, '🔒'), h('b', {}, 'Escrow'), h('small', {}, 'Your USDT is safe')),
          h('div', { class: 'fam-arrow' }, '→'),
          h('div', { class: 'fam-node' }, h('span', {}, '🇭🇹'), h('b', {}, 'Your family'), h('small', {}, 'Gets gourdes on MonCash, NatCash or bank'))),
        h('ul', { class: 'ow-list' },
          h('li', {}, h('b', {}, 'Open an account from any country. '), 'Any phone number. Same ID check.'),
          h('li', {}, h('b', {}, 'Add your family once. '), 'Their name, phone and MonCash, NatCash or bank account. The first one is free.'),
          h('li', {}, h('b', {}, 'A buyer in Haiti pays them directly. '), 'Your family gets an SMS and presses "I received it".'),
          h('li', {}, h('b', {}, 'Then you release the USDT. '), 'No transfer office queue. Money arrives in minutes, not days.')),
        h('p', { class: 'mute' }, 'Check the price on the market before you send: you see exactly how many gourdes your family gets.'))),
    sec('market', 'Live market', 'Real prices right now.', 'Prices are in gourdes (HTG) for 1 USDT. Pick the best price, then trade.', adsBox),
    sec('faq', 'Questions', 'Good to know', null,
      h('div', { class: 'faq' }, [
        ['What is USDT?', 'USDT is a digital dollar. 1 USDT is made to stay worth about 1 US dollar. You can keep it, send it anywhere in the world, or sell it for gourdes.'],
        ['Do you hold my gourdes?', 'No. Gourdes always go directly from the buyer to the seller (or to the seller\'s family). We only hold the crypto in escrow during a trade.'],
        ['What if the seller does not release?', 'If you paid and the seller does not answer, a dispute opens by itself. Upload your receipt. Staff check it and release the USDT to you if you paid.'],
        ['Why do you ask for my ID and a video?', 'So everybody here is a real person. Scammers hide behind fake numbers. A video saying your name, phone and a code stops them. Only our staff see it.'],
        ['How much does it cost?', `Signing up is free. Sellers pay a small fee of ${(Number(cfg.fee_rate || 0.005) * 100).toFixed(1)}% per trade, in USDT. Buyers pay no fee.`],
        ['Can I use it outside Haiti?', 'Yes. Anyone, with any phone number, can open an account after the ID check. It is perfect to send money to family in Haiti.'],
      ].map(([q, a]) => h('details', {}, h('summary', {}, q), h('p', {}, a))))),
    h('section', { class: 'hfinal' }, h('h2', {}, 'Trade crypto in Haiti with confidence.'), h('p', {}, 'Free to join. Takes 3 minutes.'), h('button', { class: 'btn', onclick: go2('join') }, 'Create my free account')),
    h('footer', { class: 'hfoot' }, h('span', {}, '© ' + new Date().getFullYear() + ' Haiti P2P'), h('a', { href: '#safety' }, 'Safety'), h('span', { class: 'mute' }, 'Crypto prices move. Only trade what you can afford.')));
}
