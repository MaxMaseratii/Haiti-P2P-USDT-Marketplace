/* Home page for visitors (logged out). Uses h(), lang, cfg from app.js.
   All text is in English, French and Kreyòl. Kreyòl uses the same words as MonCash and NatCash
   (kont, tranzaksyon, verifye idantite w, kòd OTP, voye lajan). Have a native speaker review before launch. */
const HL = () => (['en', 'fr', 'ht'].includes(lang) ? lang : 'en');
const tx3 = (o) => o[HL()] || o.en;

// ---------- the old way vs the new way ----------
function oldWay() {
  const C = {
    old: { en: 'The old way', fr: 'Avant', ht: 'Ansyen fason an' },
    oldT: { en: 'Asking in every WhatsApp group', fr: 'Demander dans chaque groupe WhatsApp', ht: 'Mande nan tout gwoup WhatsApp' },
    m1: { en: 'Who has USDT? I need 100.', fr: 'Qui a des USDT ? J\'en veux 100.', ht: 'Kiyès ki gen USDT? M bezwen 100.' },
    m2: { en: 'Me. Send 14,000 HTG MonCash first, then I send.', fr: 'Moi. Envoie 14 000 HTG MonCash d\'abord, j\'envoie après.', ht: 'Mwen. Voye 14 000 goud MonCash anvan, m a voye.' },
    m3: { en: 'Sent ✓✓', fr: 'Envoyé ✓✓', ht: 'M voye l ✓✓' },
    m4: { en: 'Hello? Did you send the USDT?', fr: 'Allô ? Tu as envoyé les USDT ?', ht: 'Alo? Ou voye USDT a?' },
    m5: { en: 'Please answer…', fr: 'Réponds s\'il te plaît…', ht: 'Tanpri reponn…' },
    sys: { en: 'Seen. No answer. Number blocked.', fr: 'Vu. Pas de réponse. Numéro bloqué.', ht: 'Li wè mesaj la. Li pa reponn. Li bloke w.' },
    end: { en: 'Money gone. Nobody to call. Nothing to do.', fr: 'Argent perdu. Personne à appeler.', ht: 'Lajan an ale. Pa gen moun pou rele.' },
    neu: { en: 'With Ayiti P2P', fr: 'Avec Ayiti P2P', ht: 'Ak Ayiti P2P' },
    neuT: { en: 'We lock the crypto before you pay', fr: 'Nous verrouillons la crypto avant que vous payiez', ht: 'Nou kadnase kripto a anvan ou peye' },
    l1: [{ en: 'Real people only. ', fr: 'Que des vraies personnes. ', ht: 'Moun reyèl sèlman. ' }, { en: 'Every seller showed their ID and a video, and confirmed their phone with an OTP code.', fr: 'Chaque vendeur a montré sa pièce d\'identité et une vidéo, et confirmé son téléphone avec un code OTP.', ht: 'Chak vandè montre pyès idantite yo ak yon videyo, epi yo konfime telefòn yo ak yon kòd OTP.' }],
    l2: [{ en: 'The crypto is locked first. ', fr: 'La crypto est verrouillée d\'abord. ', ht: 'Kripto a kadnase anvan. ' }, { en: 'The seller cannot take it back while you pay.', fr: 'Le vendeur ne peut pas la reprendre pendant que vous payez.', ht: 'Vandè a pa ka repran l pandan w ap peye.' }],
    l3: [{ en: 'Unlocked only when the money arrives. ', fr: 'Libérée seulement quand l\'argent arrive. ', ht: 'Nou dekadnase l sèlman lè lajan an rive. ' }, { en: 'The seller confirms they received your gourdes, then the crypto goes to you.', fr: 'Le vendeur confirme avoir reçu vos gourdes, puis la crypto vient à vous.', ht: 'Vandè a konfime li resevwa goud ou yo, epi kripto a ale jwenn ou.' }],
    l4: [{ en: 'A problem? ', fr: 'Un problème ? ', ht: 'Gen pwoblèm? ' }, { en: 'Our team checks the proof and decides. The crypto stays locked until then.', fr: 'Notre équipe vérifie les preuves et décide. La crypto reste verrouillée jusque-là.', ht: 'Ekip nou an gade prèv yo epi deside. Kripto a rete kadnase jiskaske sa fini.' }],
    l5: [{ en: 'Ratings for everyone. ', fr: 'Des notes pour tous. ', ht: 'Tout moun gen nòt. ' }, { en: 'See each trader\'s finished trades and how fast they confirm.', fr: 'Voyez les échanges de chaque personne et sa rapidité.', ht: 'Ou wè konbyen tranzaksyon chak moun fè ak vitès yo.' }],
    neuEnd: { en: 'No more blind trust. No more begging in groups.', fr: 'Fini la confiance aveugle.', ht: 'Pa bezwen fè moun konfyans avèg ankò.' },
  };
  const msg = (who, text, cls = '') => h('div', { class: 'wa ' + cls }, h('b', {}, who), text);
  const li = (pair) => h('li', {}, h('b', {}, tx3(pair[0])), tx3(pair[1]));
  return h('div', { class: 'ow-grid' },
    h('div', { class: 'ow-card bad' }, h('div', { class: 'ow-tag' }, tx3(C.old)), h('h3', {}, tx3(C.oldT)),
      h('div', { class: 'wa-chat' }, msg('You', tx3(C.m1), 'me'), msg('+509 •••• ••••', tx3(C.m2)), msg('You', tx3(C.m3), 'me'), msg('You', tx3(C.m4), 'me'), msg('You', tx3(C.m5), 'me'), h('div', { class: 'wa-sys' }, tx3(C.sys))),
      h('p', { class: 'ow-end' }, tx3(C.end))),
    h('div', { class: 'ow-card good' }, h('div', { class: 'ow-tag' }, tx3(C.neu)), h('h3', {}, tx3(C.neuT)),
      h('ul', { class: 'ow-list' }, li(C.l1), li(C.l2), li(C.l3), li(C.l4), li(C.l5)),
      h('p', { class: 'ow-end ok' }, tx3(C.neuEnd))));
}

// ---------- real screens from the app, in phone frames ----------
function appShots(sec) {
  const L = HL();
  const shot = (name, title, cap) => h('figure', { class: 'ashot' },
    h('div', { class: 'aframe' }, h('img', { src: `img/app/${name}-${L}.jpg`, alt: tx3(title), loading: 'lazy', decoding: 'async', width: '390', height: '844' })),
    h('figcaption', {}, h('b', {}, tx3(title)), h('span', {}, tx3(cap))));
  return sec('screens', { en: 'The app', fr: 'L\'application', ht: 'Aplikasyon an' },
    { en: 'Everything you need to swap crypto, in one place.', fr: 'Tout ce qu\'il faut pour échanger de la crypto, au même endroit.', ht: 'Tout sa ou bezwen pou chanje kripto, yon sèl kote.' },
    { en: 'Ayiti P2P connects buyers and sellers of USDT/USDC. You see the prices, check the people, swap, and follow all your orders in one app.',
      fr: 'Ayiti P2P met en relation les acheteurs et les vendeurs d\'USDT/USDC. Vous voyez les prix, vérifiez les personnes, échangez et suivez toutes vos commandes dans une seule application.',
      ht: 'Ayiti P2P se yon platfòm ki mete achtè ak vandè USDT/USDC an kontak. Ou ka wè pri yo, verifye moun yo, fè echanj epi swiv tout kòmand ou yo nan yon sèl aplikasyon.' },
    h('div', { class: 'ashots' },
      shot('home', { en: 'Your account', fr: 'Votre compte', ht: 'Kont ou' }, { en: 'Balance, buy, sell and transaction history.', fr: 'Solde, achat, vente et historique.', ht: 'Balans, achte, vann ak istwa tranzaksyon.' }),
      shot('market', { en: 'MarketPlace', fr: 'MarketPlace', ht: 'MarketPlace' }, { en: 'The best prices first.', fr: 'Les meilleurs prix d\'abord.', ht: 'Pi bon pri yo an premye.' }),
      shot('order', { en: 'Orders', fr: 'Commandes', ht: 'Kòmand' }, { en: 'Chat, payment and clear steps.', fr: 'Chat, paiement et étapes claires.', ht: 'Chat, peman ak etap tranzaksyon klè.' }),
      shot('id', { en: 'Verification', fr: 'Vérification', ht: 'Verifikasyon' }, { en: 'ID photos and a live video.', fr: 'Photos de la pièce et vidéo en direct.', ht: 'Foto ID ak videyo an dirèk.' })));
}

// ---------- hero: one idea per slide, swipe left / right ----------
function heroSlides() {
  const L = HL();
  const S = [
    ['market', '1', { en: 'Pick a verified seller', fr: 'Choisissez un vendeur vérifié', ht: 'Chwazi yon vandè verifye' },
      { en: 'Best price first. Every seller showed their ID and a live video.', fr: 'Meilleur prix d\'abord. Chaque vendeur a montré sa pièce et une vidéo.', ht: 'Pi bon pri an premye. Chak vandè montre pyès idantite yo ak yon videyo an dirèk.' }, ['shield', 'ID'], { en: 'seller verified', fr: 'vendeur vérifié', ht: 'vandè verifye' }],
    ['order', '2', { en: 'The crypto is locked before you pay', fr: 'La crypto est verrouillée avant de payer', ht: 'Kripto a kadnase anvan ou peye' },
      { en: 'Then you pay the seller by MonCash, NatCash or bank. The seller cannot take the crypto back.', fr: 'Puis vous payez par MonCash, NatCash ou banque. Le vendeur ne peut pas reprendre la crypto.', ht: 'Apre sa ou peye vandè a pa MonCash, NatCash oswa labank. Vandè a pa ka repran kripto a.' }, ['lock', '20 USDT'], { en: 'locked for you', fr: 'verrouillés pour vous', ht: 'kadnase pou ou' }],
    ['home', '3', { en: 'The money arrives, the crypto is yours', fr: 'L\'argent arrive, la crypto est à vous', ht: 'Lajan an rive, kripto a pou ou' },
      { en: 'The seller confirms and the USDT lands in your account. Like a bank app, in your pocket.', fr: 'Le vendeur confirme et les USDT arrivent sur votre compte. Comme une appli bancaire.', ht: 'Vandè a konfime, epi USDT a tonbe nan kont ou. Tankou yon aplikasyon labank, nan pòch ou.' }, ['bolt', '5 min'], { en: 'released after payment', fr: 'libéré après paiement', ht: 'dekadnase apre peman' }],
    ['profile', '4', { en: 'Check the seller before you buy', fr: 'Vérifiez le vendeur avant d\'acheter', ht: 'Gade vandè a anvan ou achte' },
      { en: 'Real reviews, finished trades, response time and business posters.', fr: 'Vrais avis, échanges terminés, délai de réponse et affiches.', ht: 'Vrè revi, echanj ki fini, tan pou reponn ak afich biznis.' }, ['star', '5.0'], { en: 'from real trades', fr: 'de vrais échanges', ht: 'soti nan vrè echanj' }],
    ['id', '5', { en: 'Your ID, checked inside the app', fr: 'Votre pièce, vérifiée dans l\'appli', ht: 'Pyès ou, verifye nan aplikasyon an' },
      { en: 'Photos and a live video with the app camera. Only our team sees them.', fr: 'Photos et vidéo en direct avec la caméra de l\'appli. Seule notre équipe les voit.', ht: 'Foto ak videyo an dirèk ak kamera aplikasyon an. Se ekip nou an sèlman ki wè yo.' }, ['id', 'ID'], { en: '+ live video', fr: '+ vidéo en direct', ht: '+ videyo an dirèk' }],
  ];
  const track = h('div', { class: 'xs-track', tabindex: '0', 'aria-label': tx3({ en: 'How it works, slide by slide', fr: 'Comment ça marche', ht: 'Kijan li mache, youn apre lòt' }) },
    S.map(([img, n, title, text, chipB, chipS], i) => h('div', { class: 'xs-slide', 'data-i': i },
      h('div', { class: 'xs-phone' }, h('div', { class: 'xphone' }, h('img', { src: `img/app/${img}-${L}.jpg`, alt: tx3(title), loading: i ? 'lazy' : 'eager', ...(i ? {} : { fetchpriority: 'high' }) })),
        h('div', { class: 'xchip' }, h('b', {}, icon(chipB[0]), ' ' + chipB[1]), h('small', {}, tx3(chipS)))),
      h('div', { class: 'xs-cap' }, h('span', { class: 'xs-n' }, n), h('div', {}, h('b', {}, tx3(title)), h('p', {}, tx3(text)))))));
  const dots = h('div', { class: 'xs-dots' }, S.map((_, i) => h('button', { type: 'button', 'aria-label': String(i + 1), onclick: () => goTo(i, true) })));
  let cur = 0, timer = null, user = false;
  const goTo = (i, byUser) => { cur = (i + S.length) % S.length; track.scrollTo({ left: cur * track.clientWidth, behavior: 'smooth' }); if (byUser) { user = true; stop(); } };
  const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i === cur));
  track.addEventListener('scroll', () => { const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); if (i !== cur) { cur = i; paint(); } }, { passive: true });
  ['pointerdown', 'touchstart', 'wheel'].forEach((ev) => track.addEventListener(ev, () => { user = true; stop(); }, { passive: true }));
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') goTo(cur + 1, true); if (e.key === 'ArrowLeft') goTo(cur - 1, true); });
  const stop = () => { clearInterval(timer); timer = null; };
  const start = () => { if (user || timer || matchMedia('(prefers-reduced-motion: reduce)').matches) return; timer = setInterval(() => { if (!track.isConnected) return stop(); goTo(cur + 1); }, 5500); };
  paint(); setTimeout(start, 1200);
  return h('div', { class: 'xh-slides' },
    h('div', { class: 'xh-glow' }), track,
    h('div', { class: 'xs-nav' },
      h('button', { type: 'button', class: 'xs-arrow', 'aria-label': '‹', onclick: () => goTo(cur - 1, true) }, '‹'), dots,
      h('button', { type: 'button', class: 'xs-arrow', 'aria-label': '›', onclick: () => goTo(cur + 1, true) }, '›')),
    h('div', { class: 'xs-hint' }, tx3({ en: '← swipe →', fr: '← glissez →', ht: '← glise →' })));
}

// ---------- the Live MarketPlace: sellers and buyers, side by side ----------
function liveMarketArt() {
  const L = HL();
  const side = (img, cls, title, text) => h('figure', { class: 'lm-side ' + cls },
    h('div', { class: 'aframe' }, h('img', { src: `img/app/${img}-${L}.jpg`, alt: tx3(title), loading: 'lazy', width: '390', height: '844' })),
    h('figcaption', {}, h('b', {}, tx3(title)), h('span', {}, tx3(text))));
  return h('div', { class: 'lm' },
    side('live-sellers', 'sell', { en: 'Sellers', fr: 'Vendeurs', ht: 'Vandè yo' }, { en: 'You buy USDT: lowest price first', fr: 'Vous achetez des USDT : prix le plus bas d\'abord', ht: 'Ou achte USDT: pi ba pri an premye' }),
    h('div', { class: 'lm-mid' }, h('img', { src: 'img/brand/usdt.png', alt: 'USDT', width: '56', height: '56' }), h('div', { class: 'lm-swap' }, icon('swap')),
      h('div', { class: 'lm-g' }, 'G'), h('small', {}, tx3({ en: 'Live', fr: 'En direct', ht: 'Live' }))),
    side('live-buyers', 'buy', { en: 'Buyers', fr: 'Acheteurs', ht: 'Achtè yo' }, { en: 'You sell USDT: highest price first', fr: 'Vous vendez des USDT : prix le plus haut d\'abord', ht: 'Ou vann USDT: pi wo pri an premye' }));
}

// ---------- page ----------
function homeView(app, loginCard, quickTest, adsBox) {
  const go2 = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sec = (id, kicker, title, sub, ...body) => h('section', { class: 'hsec', id }, h('div', { class: 'hkick' }, tx3(kicker)), h('h2', { class: 'htitle' }, tx3(title)), sub ? h('p', { class: 'hsub' }, tx3(sub)) : null, ...body);
  const feat = (ic, title, text) => h('div', { class: 'feat' }, h('div', { class: 'feat-ic' }, icon(ic)), h('h3', {}, tx3(title)), h('p', {}, tx3(text)));
  const fee = (Number(cfg.fee_rate || 0.005) * 100).toFixed(1);
  const join = { en: 'Create your free account', fr: 'Créez votre compte gratuit', ht: 'Kreye kont ou gratis' };
  const L = HL();

  app.append(...[
    // ---------- 01. the promise ----------
    h('section', { class: 'xhero' },
      h('div', { class: 'xh-in' },
        h('div', { class: 'xh-text' },
          h('div', { class: 'xh-pill' }, tx3({ en: 'Buy USDT/USDC with peace of mind · MonCash · NatCash · Bank transfer', fr: 'Achetez des USDT/USDC en toute tranquillité · MonCash · NatCash · Virement bancaire', ht: 'Achte USDT/USDC ak trankilite · MonCash · NatCash · Transfè bank' })),
          h('h1', {}, tx3({ en: 'Buy and sell USDT fast, ', fr: 'Achetez et vendez des USDT vite, ', ht: 'Achte/Vann USDT rapid, vit ' }), h('em', {}, tx3({ en: 'with full confidence, stress-free.', fr: 'en toute confiance, sans stress.', ht: 'ak tout konfyans, san kè sote.' }))),
          h('p', { class: 'xh-lead' }, tx3({
            en: 'We check that every seller really has the crypto they are selling in their account, so we can lock it. When the buyer chooses how much to buy, we lock that amount in the seller\'s account so it cannot be withdrawn, before the buyer pays for the USDT in gourdes. The buyer pays the seller by MonCash, NatCash or bank and confirms the payment. The seller checks that the money arrived. When everyone has confirmed, Ayiti P2P unlocks the USDT and it goes to the buyer.',
            fr: 'Nous vérifions que chaque vendeur a vraiment sur son compte la crypto qu\'il vend, pour pouvoir la verrouiller. Quand l\'acheteur choisit combien il achète, nous verrouillons ce montant sur le compte du vendeur pour qu\'il ne puisse pas le retirer, avant que l\'acheteur paie les USDT en gourdes. L\'acheteur paie le vendeur par MonCash, NatCash ou banque et confirme le paiement. Le vendeur vérifie que l\'argent est arrivé. Quand tout le monde a confirmé, Ayiti P2P libère les USDT vers l\'acheteur.',
            ht: 'Nou verifye ke chak vandè gen kantite kripto l ap vann lan disponib sou kont li, pou nou ka kadnase l. Lè achtè a chwazi kantite l ap achte a, nou kadnase kantite sa a sou kont vandè a pou l pa ka retire l, anvan achtè a peye USDT a an goud. Achtè a peye vandè a pa MonCash, NatCash oswa labank, epi li konfime li fè peman an. Vandè a verifye peman an rive. Lè tout moun konfime, Ayiti P2P dekadnase USDT a, epi li al jwenn achtè a.' })),
          h('p', { class: 'xh-sat' }, tx3({ en: 'Everyone satisfied, in complete safety.', fr: 'Tout le monde satisfait, en toute sécurité.', ht: 'Tout moun satisfè, an sekirite.' })),
          h('div', { class: 'xh-cta' },
            h('button', { class: 'btn xbtn', onclick: go2('join') }, tx3(join) + ' →'),
            h('button', { class: 'btn xghost', onclick: go2('how') }, icon('play'), ' ' + tx3({ en: 'See how the process works', fr: 'Voir comment fonctionne le processus', ht: 'Gade kijan pwosesis la mache' }))),
          h('button', { type: 'button', class: 'livebtn xlive', onclick: () => (typeof goLive === 'function' ? goLive() : go2('market')()) }, h('span', { class: 'livedot' }), h('span', {}, 'Live MarketPlace'),
            h('small', {}, tx3({ en: 'See today\'s prices', fr: 'Voir les prix du jour', ht: 'Gade pri jodi a' })))),
        heroSlides())),

    // ---------- 02. how you pay + what protects you ----------
    h('section', { class: 'xstrip' },
      h('div', { class: 'xs-pay' }, h('small', {}, tx3({ en: 'Pay with', fr: 'Payez avec', ht: 'Peye ak' })),
        ...['MONCASH', 'NATCASH'].map((k) => (cfg.pay_logos || {})[k] ? h('img', { src: cfg.pay_logos[k], alt: k }) : h('b', {}, k)),
        ...['sogebank', 'unibank', 'bnc'].map((k) => h('img', { src: `img/bank/${k}-sq.png`, alt: k, class: 'bk' }))),
      h('div', { class: 'xs-trust' },
        [['lock', { en: 'Crypto locked', fr: 'Crypto verrouillée', ht: 'Kripto kadnase' }, { en: 'to protect the buyer against fraud', fr: 'pour protéger l\'acheteur contre la fraude', ht: 'pou pwoteje achtè a kont fwod' }],
          ['id', { en: 'ID + video', fr: 'Pièce + vidéo', ht: 'ID + videyo' }, { en: 'identity check for every user', fr: 'vérification de chaque utilisateur', ht: 'idantifikasyon pou tout itilizatè' }],
          ['headset', { en: 'Customer service', fr: 'Service client', ht: 'Sèvis kliyantèl' }, { en: 'solves problems fast', fr: 'règle les problèmes vite', ht: 'rezoud pwoblèm rapid vit' }]]
          .map(([ic, a, b]) => h('div', {}, h('i', {}, icon(ic)), h('span', {}, h('b', {}, tx3(a)), h('small', {}, tx3(b))))))),

    // ---------- 03. the app ----------
    appShots(sec),

    // ---------- 04. the problem ----------
    sec('problem', { en: 'The problem we solve', fr: 'Le problème que nous réglons', ht: 'Pwoblèm nou rezoud' },
      { en: 'Stop sending money to people you don\'t know and praying they send the crypto.', fr: 'N\'envoyez plus d\'argent à des inconnus en priant pour recevoir la crypto.', ht: 'Pa voye lajan bay moun ou pa konnen, epi priye pou li voye kripto a.' },
      { en: 'Today, to buy crypto in Haiti you ask in every WhatsApp group, send MonCash first, and hope. Too many people never get their crypto, and the seller stops answering.',
        fr: 'Aujourd\'hui, pour acheter de la crypto en Haïti, on demande dans chaque groupe WhatsApp, on envoie MonCash d\'abord, et on espère. Trop de gens ne reçoivent jamais leur crypto.',
        ht: 'Jodi a, pou achte kripto ann Ayiti, ou mande nan tout gwoup WhatsApp, ou voye MonCash anvan, epi ou espere. Twòp moun pa janm resevwa kripto yo, epi vandè a pa reponn ankò.' },
      filmWhy(), h('div', { style: 'height:20px' }), oldWay(),
      h('div', { class: 'xdiff' }, h('i', {}, icon('shield')), h('div', {},
        h('h3', {}, tx3({ en: 'With Ayiti P2P, things are different.', fr: 'Avec Ayiti P2P, c\'est différent.', ht: 'Ak Ayiti P2P, bagay yo diferan.' })),
        h('p', {}, tx3({ en: 'You don\'t need to trade on WhatsApp, or send money in advance to someone you don\'t know. The seller\'s crypto stays locked while the buyer pays. Every swap follows an order, with proof and clear rules to handle problems.',
          fr: 'Plus besoin d\'échanger sur WhatsApp ni d\'envoyer de l\'argent d\'avance à un inconnu. La crypto du vendeur reste verrouillée pendant que l\'acheteur paie. Chaque échange suit une commande, avec des preuves et des règles claires en cas de problème.',
          ht: 'Ou pa bezwen fè echanj sou WhatsApp, ni voye lajan davans bay yon moun ou pa konnen. Kripto vandè a rete kadnase pandan achtè a ap fè peman an. Chak echanj swiv yon kòmand, epi gen prèv ak règ klè pou jere pwoblèm.' }))))),

    // ---------- 05. the safety message ----------
    h('section', { class: 'xrule', id: 'rule' },
      h('div', { class: 'xr-ic' }, icon('shield')),
      h('div', {},
        h('div', { class: 'xr-kick' }, tx3({ en: 'Safety message', fr: 'Message de sécurité', ht: 'Mesaj sekirite' })),
        h('p', { class: 'xr-intro' }, tx3({ en: 'If someone really has USDT, they can sell it on Ayiti P2P, where the crypto is locked before you pay.', fr: 'Si quelqu\'un a vraiment des USDT, il peut les vendre sur Ayiti P2P, où la crypto est verrouillée avant que vous payiez.', ht: 'Si yon moun gen vrè USDT, li ka vann li sou Ayiti P2P, kote kripto a kadnase anvan ou peye.' })),
        h('h2', {}, tx3({ en: 'Never send your money outside an order.', fr: 'N\'envoyez jamais votre argent hors d\'une commande.', ht: 'Pa janm voye lajan w deyò yon kòmand.' })),
        h('p', {}, tx3({ en: 'If someone asks you to send MonCash, NatCash or bank money on WhatsApp or anywhere else, before an Ayiti P2P order is created and the crypto is locked, don\'t do it.',
          fr: 'Si quelqu\'un vous demande d\'envoyer du MonCash, du NatCash ou de l\'argent par banque sur WhatsApp ou ailleurs, avant qu\'une commande Ayiti P2P soit créée et la crypto verrouillée, ne le faites pas.',
          ht: 'Si yon moun mande w voye MonCash, NatCash oswa lajan labank sou WhatsApp oswa lòt kote, anvan yon kòmand Ayiti P2P fin kreye epi kripto a fin kadnase, pa fè sa.' })),
        h('p', {}, h('b', {}, tx3({ en: 'On Ayiti P2P, it always happens in this order:', fr: 'Sur Ayiti P2P, tout se fait dans cet ordre :', ht: 'Sou Ayiti P2P, pwosesis la fèt nan yon lòd klè:' }))),
        h('ol', { class: 'xr-steps' }, [
          { en: 'The seller makes the crypto available.', fr: 'Le vendeur met la crypto à disposition.', ht: 'Vandè a mete kripto li disponib.' },
          { en: 'The buyer chooses the amount.', fr: 'L\'acheteur choisit le montant.', ht: 'Achtè a chwazi kantite li vle a.' },
          { en: 'The crypto is locked.', fr: 'La crypto est verrouillée.', ht: 'Kripto a kadnase.' },
          { en: 'The buyer pays the seller directly.', fr: 'L\'acheteur paie le vendeur directement.', ht: 'Achtè a peye vandè a dirèkteman.' },
          { en: 'After the payment is confirmed and checked, the crypto is unlocked.', fr: 'Après confirmation et vérification du paiement, la crypto est libérée.', ht: 'Apre konfimasyon ak verifikasyon peman an, kripto a dekadnase.' },
        ].map((x) => h('li', {}, tx3(x)))),
        h('p', { class: 'xr-final' }, tx3({ en: 'Don\'t let anyone rush you. Never pay outside an order.', fr: 'Ne laissez personne vous presser. Ne payez jamais hors d\'une commande.', ht: 'Pa kite pèsonn prese w. Pa janm peye deyò yon kòmand.' })))),

    // ---------- 06. how it works: 3 steps ----------
    sec('how', { en: 'How it works', fr: 'Comment ça marche', ht: 'Kijan li mache' }, { en: 'We lock it. You pay. We unlock it.', fr: 'On verrouille. Vous payez. On libère.', ht: 'Nou kadnase l. Ou peye. Nou dekadnase l.' }, null,
      h('div', { class: 'x3' }, [
        ['01', 'user', { en: 'Choose', fr: 'Choisir', ht: 'Chwazi' }, { en: 'A verified seller', fr: 'Un vendeur vérifié', ht: 'Yon vandè verifye' }, { en: 'Pick the best price on the MarketPlace, from a seller whose ID is checked.', fr: 'Choisissez le meilleur prix sur la MarketPlace, chez un vendeur vérifié.', ht: 'Chwazi pi bon pri a nan MarketPlace la, ak yon vandè ki verifye idantite l.' }],
        ['02', 'lock', { en: 'Lock', fr: 'Verrouiller', ht: 'Kadnase' }, { en: 'The crypto is locked', fr: 'La crypto est bloquée', ht: 'Kripto a bloke' }, { en: 'We lock the amount you want in the seller\'s account, before you pay.', fr: 'Nous verrouillons le montant voulu sur le compte du vendeur, avant votre paiement.', ht: 'Nou kadnase kantite ou vle a sou kont vandè a, anvan ou peye.' }],
        ['03', 'check', { en: 'Receive', fr: 'Recevoir', ht: 'Resevwa' }, { en: 'The crypto is released', fr: 'La crypto est libérée', ht: 'Kripto a lage' }, { en: 'You pay, the seller confirms the money arrived, and we unlock the USDT to you.', fr: 'Vous payez, le vendeur confirme la réception, et nous vous libérons les USDT.', ht: 'Ou peye, vandè a konfime lajan an rive, epi nou dekadnase USDT a ba ou.' }],
      ].map(([n, ic, a, b, c]) => h('div', { class: 'x3-card' }, h('div', { class: 'x3-top' }, h('span', { class: 'x3-n' }, n), h('i', {}, icon(ic))), h('h3', {}, tx3(a)), h('b', {}, tx3(b)), h('p', {}, tx3(c))))),
      h('p', { class: 'x3-more' }, h('a', { href: '#welcome', onclick: (e) => { e.preventDefault(); go2('demo')(); } }, tx3({ en: 'Want every detail? See a real swap, step by step', fr: 'Tous les détails ? Voir un vrai échange, étape par étape', ht: 'Ou vle tout detay yo? Gade yon vrè echanj, etap pa etap' }), ' →'))),

    // ---------- 07. how we lock the crypto: rules and what if ----------
    sec('lock', { en: 'How we lock the crypto', fr: 'Comment nous verrouillons la crypto', ht: 'Kijan nou kadnase kripto a' },
      { en: 'Both sides are protected. The crypto stays locked until the rules are met.', fr: 'Les deux côtés sont protégés. La crypto reste bloquée tant que les conditions ne sont pas remplies.', ht: 'Toude bò yo pwoteje. Kripto a rete kadnase jiskaske kondisyon yo respekte.' }, null,
      h('div', { class: 'feats' },
        feat('lock', { en: 'The seller\'s crypto is locked', fr: 'La crypto du vendeur est verrouillée', ht: 'Kripto vandè a kadnase' }, { en: 'When a swap starts, we lock the seller\'s USDT. The seller cannot touch it, and neither can you, until the swap ends.', fr: 'Au début de l\'échange, nous verrouillons les USDT du vendeur. Personne n\'y touche jusqu\'à la fin.', ht: 'Lè yon echanj kòmanse, nou kadnase USDT vandè a. Ni vandè a, ni ou menm pa ka manyen l jiskaske echanj lan fini.' }),
        feat('send', { en: 'You pay the seller directly', fr: 'Vous payez le vendeur directement', ht: 'Ou peye vandè a dirèk' }, { en: 'Gourdes go straight from your MonCash, NatCash or bank to the seller. We never hold gourdes.', fr: 'Les gourdes vont directement de votre MonCash, NatCash ou banque au vendeur. Nous ne gardons jamais de gourdes.', ht: 'Goud yo soti nan MonCash, NatCash oswa labank ou dirèk bay vandè a. Nou pa janm kenbe goud.' }),
        feat('check', { en: 'Both confirm, then we unlock', fr: 'Les deux confirment, puis on libère', ht: 'Toude konfime, epi nou dekadnase' }, { en: 'You confirm you sent it. The seller confirms it arrived. Then the USDT is unlocked and goes to your wallet.', fr: 'Vous confirmez l\'envoi. Le vendeur confirme la réception. Puis les USDT sont libérés vers votre portefeuille.', ht: 'Ou konfime ou voye l. Vandè a konfime li rive. Epi USDT a dekadnase, li ale sou kont ou.' }),
        feat('clock', { en: 'A time limit for each step', fr: 'Un délai pour chaque étape', ht: 'Gen tan pou chak etap' }, { en: 'Every step has a clock. A clock never unlocks crypto to anyone by itself.', fr: 'Chaque étape a un délai. Un délai ne libère jamais la crypto tout seul.', ht: 'Chak etap gen yon tan. Tan an pa janm dekadnase kripto bay pèsonn pou kont li.' }),
        feat('receipt', { en: 'Proof, not promises', fr: 'Des preuves, pas des promesses', ht: 'Prèv, pa pwomès' }, { en: 'Chat, payment code and receipts stay in the order. In a dispute, both sides upload proof and our team decides.', fr: 'Chat, code et reçus restent dans la commande. En litige, l\'équipe décide sur preuves.', ht: 'Chat, kòd peman ak resi yo rete nan kòmand lan. Si gen diskisyon, toude bò voye prèv, epi ekip la deside.' }),
        feat('ban', { en: 'Scammers get banned', fr: 'Les arnaqueurs sont bannis', ht: 'Vòlè yo bloke' }, { en: 'Fake proof or no-shows bring strikes and bans. Banned phones, names and accounts cannot come back.', fr: 'Fausses preuves ou absences : avertissements et bannissement.', ht: 'Fo prèv oswa moun ki disparèt jwenn sanksyon epi yo bloke. Telefòn, non ak kont ki bloke pa ka tounen.' })),
      h('h3', { class: 'qa-title' }, tx3({ en: 'And if something goes wrong?', fr: 'Et si quelque chose se passe mal ?', ht: 'E si gen yon bagay ki mal pase?' })),
      h('div', { class: 'whatif' }, [
        [{ en: 'What if the buyer cancels?', fr: 'Et si l\'acheteur annule ?', ht: 'E si achtè a anile?' }, { en: 'The buyer can cancel before pressing "I paid". The crypto is unlocked back to the seller. A seller can never cancel an order.', fr: 'L\'acheteur peut annuler avant de toucher « J\'ai payé ». La crypto retourne au vendeur. Un vendeur ne peut jamais annuler.', ht: 'Achtè a ka anile anvan li peze "Mwen peye". Kripto a dekadnase epi li retounen sou kont vandè a. Yon vandè pa janm ka anile yon kòmand.' }],
        [{ en: 'What if the buyer never pays?', fr: 'Et si l\'acheteur ne paie pas ?', ht: 'E si achtè a pa peye?' }, { en: 'The buyer has 30 minutes to pay. If not, the order is cancelled by itself and the crypto goes back to the seller.', fr: 'L\'acheteur a 30 minutes pour payer. Sinon, la commande s\'annule toute seule et la crypto retourne au vendeur.', ht: 'Achtè a gen 30 minit pou peye. Si li pa peye, kòmand lan anile pou kont li, epi kripto a retounen bay vandè a.' }],
        [{ en: 'What if the seller does not confirm?', fr: 'Et si le vendeur ne confirme pas ?', ht: 'E si vandè a pa konfime?' }, { en: 'After "I paid", the seller has 30 minutes to check. If MonCash, NatCash or a bank is late, the seller can ask for more time (up to 24 hours). If the seller stays silent, a dispute opens by itself. The crypto is never unlocked by itself.', fr: 'Après « J\'ai payé », le vendeur a 30 minutes pour vérifier. En cas de retard du réseau, il peut demander plus de temps (jusqu\'à 24 heures). S\'il ne répond pas, un litige s\'ouvre tout seul. La crypto n\'est jamais libérée toute seule.', ht: 'Apre achtè a peze "Mwen peye", vandè a gen 30 minit pou l tcheke. Si MonCash, NatCash oswa bank lan an reta, vandè a ka mande plis tan (jiska 24 è). Si vandè a pa reponn, yon diskisyon louvri pou kont li. Kripto a pa janm dekadnase pou kont li.' }],
        [{ en: 'What if there is a dispute?', fr: 'Et en cas de litige ?', ht: 'E si gen diskisyon?' }, { en: 'The crypto stays locked. Both sides upload their proof: receipt, transaction number, chat. The Ayiti P2P team reviews it.', fr: 'La crypto reste verrouillée. Chacun envoie ses preuves : reçu, numéro de transaction, chat. L\'équipe Ayiti P2P les examine.', ht: 'Kripto a rete kadnase. Toude bò voye prèv yo: resi, nimewo tranzaksyon, chat. Ekip Ayiti P2P la egzamine yo.' }],
        [{ en: 'Who makes the final decision?', fr: 'Qui prend la décision finale ?', ht: 'Kiyès ki pran desizyon final la?' }, { en: 'The Ayiti P2P team, based on the proof. For big orders (50,000 HTG or more) two team members must agree; if they don\'t, the administrator decides.', fr: 'L\'équipe Ayiti P2P, sur preuves. Pour les grosses commandes (50 000 HTG ou plus), deux membres doivent être d\'accord ; sinon l\'administrateur tranche.', ht: 'Ekip Ayiti P2P la, dapre prèv yo. Pou gwo kòmand (50,000 HTG oswa plis), de manm ekip la dwe dakò; si yo pa dakò, administratè a deside.' }],
        [{ en: 'Can Ayiti P2P cancel a swap?', fr: 'Ayiti P2P peut-il annuler un échange ?', ht: 'Èske Ayiti P2P ka anile yon tranzaksyon?' }, { en: 'Not after the buyer has paid. From then on, only a dispute decision can send the crypto to the buyer or back to the seller. We never touch your gourdes.', fr: 'Pas après le paiement de l\'acheteur. Ensuite, seule une décision de litige peut envoyer la crypto à l\'acheteur ou la rendre au vendeur. Nous ne touchons jamais vos gourdes.', ht: 'Pa apre achtè a fin peye. Apre sa, se sèlman yon desizyon diskisyon ki ka voye kripto a bay achtè a oswa retounen l bay vandè a. Nou pa janm touche goud ou.' }],
      ].map(([q, a]) => h('div', { class: 'qa-item' }, h('b', {}, tx3(q)), h('p', {}, tx3(a)))))),

    // ---------- 08. a real swap, 15 steps (for people who want every detail) ----------
    sec('demo', { en: 'Demonstration', fr: 'Démonstration', ht: 'Demonstrasyon' }, { en: 'Watch a real swap, step by step.', fr: 'Regardez un vrai échange, étape par étape.', ht: 'Gade yon vrè echanj, etap pa etap.' },
      { en: 'With real numbers. Press any step, or drag the bar.', fr: 'Avec de vrais chiffres. Touchez une étape ou glissez la barre.', ht: 'Ak vrè chif. Peze nenpòt etap, oswa glise ba a.' }, filmHow()),

    // ---------- 09. the live market ----------
    sec('market', { en: 'Ayiti P2P - Live MarketPlace', fr: 'Ayiti P2P - Live MarketPlace', ht: 'Ayiti P2P - Live MarketPlace' },
      { en: 'See the prices. Choose the seller. Swap.', fr: 'Voyez les prix. Choisissez le vendeur. Échangez.', ht: 'Gade pri yo. Chwazi vandè a. Fè echanj lan.' },
      { en: 'Live exchange rate, in gourdes (HTG) for 1 USDT. Sellers: lowest price first. Buyers: highest price first. Every trader is verified, with the amount available and how to pay.',
        fr: 'Taux de change en direct, en gourdes (HTG) pour 1 USDT. Vendeurs : prix le plus bas d\'abord. Acheteurs : prix le plus haut d\'abord. Chaque personne est vérifiée, avec le montant disponible et les moyens de paiement.',
        ht: 'To dechanj live, an goud (HTG) pou 1 USDT. Vandè yo: pi ba pri an premye. Achtè yo: pi wo pri an premye. Chak moun verifye, ak kantite ki disponib ak fason pou peye.' },
      liveMarketArt(), adsBox),

    // ---------- 10. check the seller before you buy ----------
    sec('trust', { en: 'Check the seller before you buy', fr: 'Vérifiez le vendeur avant d\'acheter', ht: 'Gade vandè a anvan ou achte' },
      { en: 'Know who you are trading with.', fr: 'Sachez avec qui vous échangez.', ht: 'Konnen ak kiyès w ap fè echanj.' },
      { en: 'Every seller has a public page you can open before any order.', fr: 'Chaque vendeur a une page publique à consulter avant toute commande.', ht: 'Chak vandè gen yon paj piblik ou ka gade anvan nenpòt kòmand.' },
      h('div', { class: 'xbiz' },
        h('div', { class: 'xbiz-list' }, [
          ['shield', { en: 'ID verified', fr: 'Identité vérifiée', ht: 'ID verifye' }, { en: 'Photo ID and a live video, checked before the first trade.', fr: 'Pièce d\'identité et vidéo, vérifiées avant le premier échange.', ht: 'Foto ID ak yon videyo an dirèk, verifye anvan premye echanj lan.' }],
          ['check', { en: 'Trades done', fr: 'Échanges terminés', ht: 'Echanj ki fini' }, { en: 'How many swaps they finished, and what share they completed.', fr: 'Combien d\'échanges terminés, et quelle part réussie.', ht: 'Konbyen echanj li fini, ak ki pousantaj li konplete.' }],
          ['star', { en: 'Rating and customer feedback', fr: 'Note et avis des clients', ht: 'Nòt ak feedback kliyan yo' }, { en: 'Only people who finished a trade with them can leave a review.', fr: 'Seules les personnes ayant fini un échange peuvent noter.', ht: 'Se sèlman moun ki fin fè yon echanj avè l ki ka ba l nòt.' }],
          ['clock', { en: 'Response and release time', fr: 'Délai de réponse et de libération', ht: 'Tan pou reponn ak dekadnase' }, { en: 'How fast they usually answer and unlock the crypto.', fr: 'À quelle vitesse ils répondent et libèrent la crypto.', ht: 'Konbyen tan li pran anjeneral pou reponn ak dekadnase kripto a.' }],
          ['building', { en: 'Commercial Seller badge', fr: 'Badge Vendeur commercial', ht: 'Badj Vandè Komèsyal' }, { en: 'For businesses checked by our team.', fr: 'Pour les commerces vérifiés par notre équipe.', ht: 'Pou biznis ekip nou an verifye.' }],
        ].map(([ic, t1, t2]) => h('div', { class: 'xbiz-item' }, h('span', {}, icon(ic)), h('div', {}, h('b', {}, tx3(t1)), h('p', {}, tx3(t2)))))),
        h('div', { class: 'aframe xbiz-shot' }, h('img', { src: `img/app/profile-${L}.jpg`, alt: '', loading: 'lazy', width: '390', height: '844' })))),

    // ---------- 11. for sellers: personal sellers and Commercial Sellers ----------
    sec('sellers', { en: 'For sellers', fr: 'Pour les vendeurs', ht: 'Pou vandè yo' }, { en: 'Your business, in a real shop window.', fr: 'Votre commerce, dans une vraie vitrine.', ht: 'Biznis ou, nan yon vrè vitrin.' },
      { en: 'Every seller can build a beautiful, trusted profile for their business: your posters, a profile photo and a cover photo, where you are, how fast you answer, and the badges you get for good service.', fr: 'Chaque vendeur peut créer un beau profil de confiance pour son commerce : affiches, photo de profil et de couverture, où vous êtes, votre délai de réponse, et les badges reçus pour un bon service.', ht: 'Tout vandè ka kreye yon bèl pwofil konfyans pou biznis yo. Mete afich ou, foto pwofil ak foto kouvèti, kote w ap viv, tan ou pran pou reponn, ak badj ou resevwa pou bon sèvis.' },
      h('div', { class: 'types' }, [
        ['users', { en: 'Buyers', fr: 'Acheteurs', ht: 'Achtè' }, { en: 'Buy USDT/USDC from verified sellers. Pay by MonCash, NatCash or bank.', fr: 'Achetez des USDT/USDC à des vendeurs vérifiés. Payez par MonCash, NatCash ou banque.', ht: 'Achte USDT/USDC nan men vandè verifye. Peye pa MonCash, NatCash oswa labank.' }],
        ['user', { en: 'Sellers', fr: 'Vendeurs', ht: 'Vandè' }, { en: 'Any verified account can sell: post an ad, set your price and how you get paid.', fr: 'Tout compte vérifié peut vendre : publiez une annonce, fixez votre prix et vos moyens de paiement.', ht: 'Nenpòt kont verifye ka vann: mete yon anons, chwazi pri w ak fason yo ka peye w.' }],
        ['building', { en: 'Commercial Sellers', fr: 'Vendeurs commerciaux', ht: 'Vandè Komèsyal' }, { en: 'For businesses: your business name and the Commercial Seller badge on the MarketPlace, after our team checks the business.', fr: 'Pour les commerces : votre nom commercial et le badge Vendeur commercial, après vérification par notre équipe.', ht: 'Pou biznis yo: non biznis ou ak badj Vandè Komèsyal sou MarketPlace la, apre ekip nou an verifye biznis la.' }],
      ].map(([ic, a, b], i) => h('div', { class: 'type' + (i === 2 ? ' pro' : '') }, h('i', {}, icon(ic)), h('h3', {}, tx3(a)), h('p', {}, tx3(b))))),
      h('div', { class: 'xbiz-list two' }, [
        ['award', { en: 'Good Service badges', fr: 'Badges Bon Service', ht: 'Badj Bon Sèvis' }, { en: 'ID verified, Trusted trader, Top seller, Fast. Earned with real trades, never bought.', fr: 'ID vérifié, Fiable, Top vendeur, Rapide. Gagnés par de vrais échanges.', ht: 'ID verifye, Moun serye, Pi bon vandè, Rapid. Ou genyen yo ak vrè echanj, ou pa achte yo.' }],
        ['image', { en: 'Up to 6 posters', fr: 'Jusqu\'à 6 affiches', ht: 'Jiska 6 afich' }, { en: 'Show your shop, your flyer and your hours. Buyers see them before they trade.', fr: 'Montrez votre boutique, votre flyer et vos horaires.', ht: 'Montre boutik ou, flyer ou ak lè ou travay. Achtè yo wè yo anvan yo fè echanj.' }],
        ['clock', { en: 'Your response time', fr: 'Votre délai de réponse', ht: 'Tan ou pran pou reponn' }, { en: 'Tell buyers how fast you answer, and promise a time on each order.', fr: 'Dites aux acheteurs à quelle vitesse vous répondez.', ht: 'Di achtè yo konbyen tan ou pran pou reponn, epi pwomèt yon tan sou chak kòmand.' }],
        ['star', { en: 'Customer feedback', fr: 'Avis des clients', ht: 'Feedback kliyan yo' }, { en: 'Only people who finished a trade with you can review you.', fr: 'Seules les personnes ayant fini un échange avec vous peuvent noter.', ht: 'Se sèlman moun ki fin fè yon echanj avè w ki ka ba ou nòt.' }],
      ].map(([ic, t1, t2]) => h('div', { class: 'xbiz-item' }, h('span', {}, icon(ic)), h('div', {}, h('b', {}, tx3(t1)), h('p', {}, tx3(t2))))))),

    // ---------- 12. from anywhere ----------
    sec('anywhere', { en: 'From anywhere', fr: 'De partout', ht: 'Nenpòt kote' },
      { en: 'Wherever you are, you can trade on Ayiti P2P.', fr: 'Où que vous soyez, vous pouvez échanger sur Ayiti P2P.', ht: 'Ou nenpòt kote. Ou ka fè echanj sou Ayiti P2P.' },
      { en: 'Have USDT? Change it to gourdes in your NatCash or MonCash, wherever you are.', fr: 'Vous avez des USDT ? Changez-les en gourdes sur votre NatCash ou MonCash, où que vous soyez.', ht: 'Si ou genyen USDT, chanje l an goud nan NatCash/MonCash ou, nenpòt kote ou ye.' },
      h('div', { class: 'fam' },
        h('div', { class: 'fam-flow' },
          h('div', { class: 'fam-node' }, h('div', { class: 'fam-art' }, h('img', { src: 'img/brand/person-usdt.svg', alt: '', class: 'fam-person', width: '120', height: '120' }), h('img', { src: 'img/brand/usdt.png', alt: 'USDT', class: 'fam-coin', width: '40', height: '40' })),
            h('b', {}, tx3({ en: 'You have USDT: sell it for gourdes', fr: 'Vous avez des USDT : vendez-les contre des gourdes', ht: 'Ou gen USDT, vann li pou goud' }))),
          h('div', { class: 'fam-arrow' }, icon('arrow-r')),
          h('div', { class: 'fam-node mid' }, h('div', { class: 'fam-art' }, h('div', { class: 'fam-lock' }, icon('lock'))),
            h('b', {}, tx3({ en: 'The amount stays locked until you receive it in gourdes', fr: 'Le montant reste verrouillé jusqu\'à ce que vous le receviez en gourdes', ht: 'Kantite a kadnase jiskaske ou resevwa kantite a an goud' }))),
          h('div', { class: 'fam-arrow' }, icon('arrow-r')),
          h('div', { class: 'fam-node' }, h('div', { class: 'fam-art' }, h('img', { src: 'img/brand/gourdes-250.webp', alt: tx3({ en: 'Gourdes', fr: 'Gourdes', ht: 'Goud' }), class: 'fam-note', width: '220', height: '94' })),
            h('b', {}, tx3({ en: 'Into the MonCash, NatCash or bank account you choose', fr: 'Sur le MonCash, NatCash ou compte bancaire choisi', ht: 'Nan MonCash, NatCash oswa kont bank ou chwazi a' })))),
        h('ul', { class: 'ow-list' },
          h('li', {}, tx3({ en: 'Open an account from any country, with any phone number. The same ID check for everyone (except countries under sanctions).', fr: 'Ouvrez un compte depuis n\'importe quel pays, avec n\'importe quel numéro. La même vérification pour tous (sauf pays sous sanctions).', ht: 'Louvri yon kont nenpòt peyi, ak nenpòt nimewo telefòn. Menm verifikasyon idantite pou tout moun (sof peyi ki anba sanksyon).' })),
          h('li', {}, tx3({ en: 'Gourdes always arrive in a MonCash, NatCash or Haitian bank account (Sogebank, Unibank, BNC and others) in the name of the verified person.', fr: 'Les gourdes arrivent toujours sur un compte MonCash, NatCash ou une banque haïtienne (Sogebank, Unibank, BNC et autres) au nom de la personne vérifiée.', ht: 'Goud yo toujou rive nan yon kont MonCash, NatCash oswa yon kont bank ann Ayiti (Sogebank, Unibank, BNC ak lòt) ki sou non moun ki verifye a.' })),
          h('li', {}, tx3({ en: 'Not in Haiti? You can use your own MonCash/NatCash, or link a family member\'s account: only if that person also has a verified account here and says yes.', fr: 'Pas en Haïti ? Utilisez votre propre MonCash/NatCash, ou liez le compte d\'un proche : seulement s\'il a aussi un compte vérifié ici et qu\'il accepte.', ht: 'Ou pa ann Ayiti? Ou ka sèvi ak pwòp MonCash/NatCash ou, oswa konekte kont yon fanmi: sèlman si moun sa a gen yon kont verifye isit la tou, epi li dakò.' })),
          h('li', {}, tx3({ en: 'The crypto (USDT/USDC) runs on the Arbitrum One network: deposit or withdraw it from anywhere.', fr: 'La crypto (USDT/USDC) fonctionne sur le réseau Arbitrum One : déposez-la ou retirez-la de partout.', ht: 'Kripto a (USDT/USDC) mache sou rezo Arbitrum One: ou ka depoze l oswa retire l nenpòt kote ou ye.' })),
          h('li', {}, tx3({ en: 'We only lock and unlock crypto between users. We never hold gourdes.', fr: 'Nous ne faisons que verrouiller et libérer la crypto. Jamais de gourdes chez nous.', ht: 'Nou sèlman kadnase epi dekadnase kripto ant moun yo. Nou pa janm kenbe goud.' }))))),

    // ---------- 13. create your account ----------
    h('section', { class: 'xjoin', id: 'join' },
      h('div', { class: 'xj-why' },
        h('div', { class: 'hkick' }, tx3({ en: 'Free · 3 minutes to start', fr: 'Gratuit · 3 minutes pour commencer', ht: 'Gratis · 3 minit pou kòmanse' })),
        h('h2', { class: 'htitle' }, tx3({ en: 'Ready for your first swap?', fr: 'Prêt pour votre premier échange ?', ht: 'Pare pou fè premye echanj ou?' })),
        h('ul', { class: 'xj-list' },
          h('li', {}, h('b', {}, '1'), h('span', {}, tx3({ en: 'Enter your phone, your email and a password.', fr: 'Entrez votre téléphone, votre e-mail et un mot de passe.', ht: 'Antre telefòn ou, imèl ou ak yon modpas.' }))),
          h('li', {}, h('b', {}, '2'), h('span', {}, tx3({ en: 'Verify your identity with a photo of your ID and a live video.', fr: 'Vérifiez votre identité avec une photo de votre pièce et une vidéo en direct.', ht: 'Verifye idantite w ak yon foto ID ak yon videyo an dirèk.' }))),
          h('li', {}, h('b', {}, '3'), h('span', {}, tx3({ en: 'Start buying or selling with other verified users.', fr: 'Commencez à acheter ou vendre avec d\'autres utilisateurs vérifiés.', ht: 'Kòmanse achte oswa vann ak lòt itilizatè verifye.' })))),
        h('p', { class: 'xj-note' }, icon('shield'), ' ', tx3({ en: 'Only our team can see your verification documents, under our access and data protection rules.', fr: 'Seule notre équipe peut voir vos documents, selon nos règles d\'accès et de protection des données.', ht: 'Se ekip nou an sèlman ki ka wè dokiman verifikasyon ou yo, dapre règleman aksè ak pwoteksyon done nou yo.' }))),
      h('div', { class: 'xj-card' }, loginCard)),
    quickTest,

    // ---------- 14. questions ----------
    sec('faq', { en: 'Questions', fr: 'Questions', ht: 'Kesyon' }, { en: 'Good to know', fr: 'Bon à savoir', ht: 'Bon pou w konnen' }, null,
      h('div', { class: 'faq' }, [
        [{ en: 'What is USDT?', fr: 'C\'est quoi l\'USDT ?', ht: 'Kisa USDT ye?' }, { en: 'USDT is a digital dollar. 1 USDT is made to stay worth about 1 US dollar. You can keep it, send it anywhere, or swap it for gourdes.', fr: 'L\'USDT est un dollar numérique. 1 USDT vaut environ 1 dollar américain.', ht: 'USDT se yon dola dijital. 1 USDT fèt pou vo apeprè 1 dola ameriken. Ou ka kenbe l, voye l nenpòt kote, oswa chanje l pou goud.' }],
        [{ en: 'How much does it cost to buy or sell USDT?', fr: 'Quels sont les frais pour acheter ou vendre ?', ht: 'Ki frè pou achte oswa vann USDT?' }, { en: `Signing up is free. Sellers pay ${fee}% per swap. Buyers pay a small ${cfg.lock_fee || '0.25'} USDT lock fee per order. Taking crypto out costs a flat ${cfg.withdraw_fee || '1'} USDT. Every fee is shown before you confirm.`, fr: `Inscription gratuite. Les vendeurs paient ${fee} % par échange. Les acheteurs paient ${cfg.lock_fee || '0.25'} USDT de frais de verrouillage par commande. Un retrait coûte ${cfg.withdraw_fee || '1'} USDT. Tous les frais s'affichent avant de confirmer.`, ht: `Enskri gratis. Vandè yo peye ${fee}% sou chak echanj. Achtè yo peye yon ti frè kadna ${cfg.lock_fee || '0.25'} USDT pou chak kòmand. Retire kripto koute ${cfg.withdraw_fee || '1'} USDT. Tout frè parèt anvan ou konfime.` }],
        [{ en: 'Do you hold my gourdes?', fr: 'Gardez-vous mes gourdes ?', ht: 'Èske nou kenbe goud mwen?' }, { en: 'No. Gourdes always go directly between the two people. We only lock the crypto during a swap.', fr: 'Non. Les gourdes vont directement d\'une personne à l\'autre. Nous verrouillons seulement la crypto.', ht: 'Non. Goud yo toujou ale dirèk ant de moun yo. Nou sèlman kadnase kripto a pandan echanj lan.' }],
        [{ en: 'I sent the money but the seller does not confirm?', fr: 'J\'ai envoyé l\'argent mais le vendeur ne confirme pas ?', ht: 'E si mwen voye lajan men vandè a pa konfime?' }, { en: 'The crypto stays locked. If the seller does not answer in time, a dispute opens by itself. Upload your receipt. Our team checks it and, if you paid, unlocks the crypto to you.', fr: 'La crypto reste verrouillée. Si le vendeur ne répond pas à temps, un litige s\'ouvre tout seul. Envoyez votre reçu : l\'équipe vérifie et, si vous avez payé, vous libère la crypto.', ht: 'Kripto a rete kadnase. Si vandè a pa reponn atan, yon diskisyon louvri pou kont li. Voye resi w. Ekip la tcheke, epi si ou te peye, li dekadnase kripto a ba ou.' }],
        [{ en: 'What if a payment is late?', fr: 'Et si un paiement est en retard ?', ht: 'Ki sa k rive si gen yon peman ki pran reta?' }, { en: 'It happens: MonCash, NatCash or a bank can be slow, or send the money back. The seller can give more time, and the crypto stays locked. Keep your SMS receipt and transaction number. If the money never arrives, open a dispute.', fr: 'Cela arrive : MonCash, NatCash ou une banque peut être lent ou renvoyer l\'argent. Le vendeur peut donner plus de temps, la crypto reste verrouillée. Gardez votre reçu SMS.', ht: 'Sa rive: pafwa MonCash, NatCash oswa yon bank lan, oswa li retounen lajan an. Vandè a ka bay plis tan, epi kripto a rete kadnase. Kenbe resi SMS ou ak nimewo tranzaksyon an. Si lajan an pa janm rive, louvri yon diskisyon.' }],
        [{ en: 'Who settles a dispute?', fr: 'Qui règle un litige ?', ht: 'Kiyès ki rezoud yon diskisyon?' }, { en: 'The Ayiti P2P team, based on the proof from both sides. Big orders need two team members to agree.', fr: 'L\'équipe Ayiti P2P, sur les preuves des deux côtés. Les grosses commandes demandent l\'accord de deux membres.', ht: 'Ekip Ayiti P2P la, dapre prèv toude bò yo. Gwo kòmand bezwen de manm ekip la dakò.' }],
        [{ en: 'Can Ayiti P2P cancel a swap?', fr: 'Ayiti P2P peut-il annuler un échange ?', ht: 'Èske Ayiti P2P ka anile yon tranzaksyon?' }, { en: 'Not after the buyer has paid. Then only a dispute decision can move the crypto.', fr: 'Pas après le paiement de l\'acheteur. Ensuite, seule une décision de litige peut déplacer la crypto.', ht: 'Pa apre achtè a fin peye. Apre sa, se sèlman yon desizyon diskisyon ki ka deplase kripto a.' }],
        [{ en: 'Can I use someone else\'s MonCash or NatCash account?', fr: 'Puis-je utiliser le MonCash ou NatCash de quelqu\'un d\'autre ?', ht: 'Èske mwen ka itilize kont MonCash oswa NatCash yon lòt moun?' }, { en: 'Only if that person also has a verified Ayiti P2P account and agrees to link it to yours (Linked accounts). Otherwise, the name on the payment account must match your ID.', fr: 'Seulement si cette personne a aussi un compte Ayiti P2P vérifié et accepte de le lier au vôtre. Sinon, le nom du compte doit correspondre à votre pièce.', ht: 'Sèlman si moun sa a gen yon kont Ayiti P2P verifye tou, epi li dakò konekte kont li ak pa w (Kont konekte). Sinon, non sou kont peman an dwe menm ak non sou ID ou.' }],
        [{ en: 'What is a Commercial Seller?', fr: 'C\'est quoi un Vendeur commercial ?', ht: 'Kisa yon Vandè Komèsyal ye?' }, { en: 'A business that buys and sells USDT on Ayiti P2P. After our team checks it, its business name and the Commercial Seller badge show on the MarketPlace.', fr: 'Un commerce qui achète et vend des USDT sur Ayiti P2P. Après vérification, son nom commercial et le badge apparaissent sur la MarketPlace.', ht: 'Yon biznis k ap achte ak vann USDT sou Ayiti P2P. Apre ekip nou an verifye l, non biznis la ak badj Vandè Komèsyal la parèt sou MarketPlace la.' }],
        [{ en: 'Why do you ask for my ID and a video?', fr: 'Pourquoi une pièce d\'identité et une vidéo ?', ht: 'Poukisa nou mande pyès idantite m ak yon videyo?' }, { en: 'So everybody here is a real person. Only our team sees it.', fr: 'Pour que tout le monde soit une vraie personne. Seule notre équipe la voit.', ht: 'Pou tout moun isit la se moun reyèl. Se ekip nou an sèlman ki wè l.' }],
        [{ en: 'Can I use it outside Haiti?', fr: 'Puis-je l\'utiliser hors d\'Haïti ?', ht: 'Èske m ka sèvi ak li andeyò Ayiti?' }, { en: 'Yes. Anyone, with any phone number, can open an account after the ID check.', fr: 'Oui. Tout le monde peut ouvrir un compte après la vérification.', ht: 'Wi. Nenpòt moun, ak nenpòt nimewo, ka louvri yon kont apre verifikasyon idantite a.' }],
      ].map(([q, a]) => h('details', {}, h('summary', {}, tx3(q)), h('p', {}, tx3(a)))))),

    // ---------- 15. last call ----------
    h('section', { class: 'hfinal' },
      h('h2', {}, tx3({ en: 'Swap crypto in Haiti without fear.', fr: 'Échangez de la crypto en Haïti sans crainte.', ht: 'Fè echanj kripto ann Ayiti san pè.' })),
      h('p', {}, tx3({ en: 'Buy or sell USDT/USDC with verified people. Follow your orders and use the Ayiti P2P protection.', fr: 'Achetez ou vendez des USDT/USDC avec des personnes vérifiées. Suivez vos commandes et profitez de la protection Ayiti P2P.', ht: 'Achte oswa vann USDT/USDC ak moun verifye. Swiv kòmand ou yo epi itilize pwoteksyon Ayiti P2P.' })),
      h('button', { class: 'btn', onclick: go2('join') }, tx3(join) + ' →'),
      h('small', {}, tx3({ en: 'Free · Signing up takes a few minutes.', fr: 'Gratuit · L\'inscription prend quelques minutes.', ht: 'Gratis · Enskripsyon an pran kèk minit.' }))),
    h('footer', { class: 'hfoot' }, h('span', {}, '© ' + new Date().getFullYear() + ' Ayiti P2P'), h('a', { href: '#safety' }, tx3({ en: 'Safety', fr: 'Sécurité', ht: 'Sekirite' })),
      h('span', { class: 'mute' }, tx3({ en: 'Crypto prices move. Only swap what you can afford.', fr: 'Le prix de la crypto bouge.', ht: 'Pri kripto a ka chanje. Pa riske lajan ou pa ka pèdi.' }))),
    h('div', { class: 'hfoot' }, legalLinks()),
    h('p', { class: 'tm', style: 'margin:0 auto 24px;padding:0 16px;text-align:center' }, tx3({ en: 'MonCash, NatCash, Binance and the bank names and logos belong to their owners. They are shown only to say which payment methods people use. Ayiti P2P is not part of, or approved by, these companies.',
      fr: 'MonCash, NatCash, Binance et les noms et logos des banques appartiennent à leurs propriétaires. Ils servent seulement à montrer les moyens de paiement utilisés. Ayiti P2P n\'est ni lié ni approuvé par ces entreprises.',
      ht: 'MonCash, NatCash, Binance ak non ak logo bank yo se pou mèt yo. Nou montre yo sèlman pou di ki fason moun peye. Ayiti P2P pa fè pati konpayi sa yo, e yo pa apwouve l.' }))].filter(Boolean));
}
