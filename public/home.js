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
  const shot = (name, cap) => h('figure', { class: 'ashot' },
    h('div', { class: 'aframe' }, h('img', { src: `img/app/${name}-${L}.jpg`, alt: tx3(cap), loading: 'lazy', decoding: 'async', width: '390', height: '844' })),
    h('figcaption', {}, tx3(cap)));
  return sec('screens', { en: 'The app', fr: 'L\'application', ht: 'Aplikasyon an' }, { en: 'Like your bank account, in your pocket.', fr: 'Comme votre compte bancaire, dans votre poche.', ht: 'Tankou kont labank ou, nan pòch ou.' },
    { en: 'Real screens from Ayiti P2P. Your balance, the market, every order step by step, and your ID check.', fr: 'De vrais écrans de Ayiti P2P : votre solde, le marché, chaque commande étape par étape, et votre vérification.', ht: 'Vrè ekran Ayiti P2P: balans ou, mache a, chak kòmand etap pa etap, ak verifikasyon idantite w.' },
    h('div', { class: 'ashots' },
      shot('home', { en: 'Your account: balance, buy, sell', fr: 'Votre compte : solde, achat, vente', ht: 'Kont ou: balans, achte, vann' }),
      shot('market', { en: 'The market: best price first', fr: 'Le marché : meilleur prix d\'abord', ht: 'Mache a: pi bon pri an premye' }),
      shot('order', { en: 'An order: clear steps and chat', fr: 'Une commande : étapes claires et chat', ht: 'Yon kòmand: etap klè ak chat' }),
      shot('id', { en: 'ID check: photo and video', fr: 'Vérification : photo et vidéo', ht: 'Verifikasyon: foto ak videyo' })));
}

// ---------- page ----------
function homeView(app, loginCard, quickTest, adsBox) {
  const go2 = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sec = (id, kicker, title, sub, ...body) => h('section', { class: 'hsec', id }, h('div', { class: 'hkick' }, tx3(kicker)), h('h2', { class: 'htitle' }, tx3(title)), sub ? h('p', { class: 'hsub' }, tx3(sub)) : null, ...body);
  const feat = (ic, title, text) => h('div', { class: 'feat' }, h('div', { class: 'feat-ic' }, ic), h('h3', {}, tx3(title)), h('p', {}, tx3(text)));
  const fee = (Number(cfg.fee_rate || 0.005) * 100).toFixed(1);
  const join = { en: 'Create my free account', fr: 'Créer mon compte gratuit', ht: 'Kreye kont mwen gratis' };

  app.append(...[
    h('section', { class: 'hhero' },
      h('div', { class: 'hh-left' },
        h('div', { class: 'hkick' }, tx3({ en: 'Made for Haiti · open to the world', fr: 'Fait pour Haïti · ouvert au monde', ht: 'Fèt pou Ayiti · louvri pou tout moun' })),
        h('h1', {}, tx3({ en: 'Swap USDT and gourdes. ', fr: 'Échangez USDT et gourdes. ', ht: 'Chanje USDT ak goud. ' }), h('em', {}, tx3({ en: 'Without the risk.', fr: 'Sans risque.', ht: 'San risk.' }))),
        h('p', { class: 'lead' }, tx3({ en: 'Pay by MonCash, NatCash or bank to a real, ID-checked person. We lock the seller\'s crypto before you pay, and unlock it only when the money arrives.',
          fr: 'Payez par MonCash, NatCash ou banque à une vraie personne vérifiée. Nous verrouillons la crypto du vendeur avant que vous payiez, et la libérons seulement quand l\'argent arrive.',
          ht: 'Peye pa MonCash, NatCash oswa labank bay yon moun reyèl ki verifye idantite l. Nou kadnase kripto vandè a anvan ou peye, epi nou dekadnase l sèlman lè lajan an rive.' })),
        h('div', { class: 'hh-cta' },
          h('button', { class: 'btn', onclick: go2('join') }, tx3(join)),
          h('button', { class: 'btn alt', onclick: go2('how') }, '▶ ' + tx3({ en: 'See how it works', fr: 'Voir comment ça marche', ht: 'Gade kijan sa mache' }))),
        h('div', { class: 'hh-stats' },
          h('div', {}, h('b', {}, '🔒'), h('span', {}, tx3({ en: 'Crypto locked first', fr: 'Crypto verrouillée d\'abord', ht: 'Kripto a kadnase anvan' }))),
          h('div', {}, h('b', {}, '🪪'), h('span', {}, tx3({ en: 'Everyone checked: ID + video', fr: 'Tous vérifiés : ID + vidéo', ht: 'Tout moun verifye: ID + videyo' }))),
          h('div', {}, h('b', {}, '⚖️'), h('span', {}, tx3({ en: 'Our team settles problems', fr: 'Notre équipe règle les problèmes', ht: 'Ekip nou an rezoud pwoblèm' }))))),
      h('div', { class: 'hh-right', id: 'join' }, loginCard)),
    quickTest,
    sec('how', { en: 'How it works', fr: 'Comment ça marche', ht: 'Kijan li mache' }, { en: 'We lock it. You pay. We unlock it.', fr: 'On verrouille. Vous payez. On libère.', ht: 'Nou kadnase l. Ou peye. Nou dekadnase l.' },
      { en: 'A real swap, step by step, with real numbers. Press any step, or drag the bar. Change the language at the top: Kreyòl, Français, English.', fr: 'Un vrai échange, étape par étape, avec de vrais chiffres. Touchez une étape ou glissez la barre.', ht: 'Yon vrè echanj, etap pa etap, ak vrè chif. Peze nenpòt etap, oswa glise ba a. Chanje lang lan anwo a: Kreyòl, Français, English.' }, filmHow()),
    appShots(sec),
    sec('problem', { en: 'The problem we solve', fr: 'Le problème que nous réglons', ht: 'Pwoblèm nou rezoud' },
      { en: 'No more sending money to strangers and praying.', fr: 'Fini d\'envoyer de l\'argent à des inconnus en priant.', ht: 'Pa voye lajan bay moun ou pa konnen ankò, epi priye.' },
      { en: 'Today, to buy crypto in Haiti you ask in every WhatsApp group, send MonCash first, and hope. Too many people never get their crypto, and the seller stops answering.',
        fr: 'Aujourd\'hui, pour acheter de la crypto en Haïti, on demande dans chaque groupe WhatsApp, on envoie MonCash d\'abord, et on espère. Trop de gens ne reçoivent jamais leur crypto.',
        ht: 'Jodi a, pou achte kripto ann Ayiti, ou mande nan tout gwoup WhatsApp, ou voye MonCash anvan, epi ou espere. Twòp moun pa janm resevwa kripto yo, epi vandè a pa reponn ankò.' }, filmWhy(), h('div', { style: 'height:20px' }), oldWay()),
    sec('lock', { en: 'How we lock the crypto', fr: 'Comment nous verrouillons la crypto', ht: 'Kijan nou kadnase kripto a' },
      { en: 'Both sides are protected.', fr: 'Les deux côtés sont protégés.', ht: 'Toude bò yo pwoteje.' },
      { en: 'We lock the amount of crypto the person is selling. You send them the money and confirm you sent it. They confirm they received it. Then we unlock the crypto and it goes to you. While it is locked, nobody can touch it until the order is cancelled or confirmed.',
        fr: 'Nous verrouillons la crypto que la personne vend. Vous lui envoyez l\'argent et confirmez l\'envoi. Elle confirme la réception. Nous libérons alors la crypto vers vous. Tant qu\'elle est verrouillée, personne ne peut y toucher.',
        ht: 'Nou kadnase kantite kripto moun nan ap vann nan. Ou voye lajan an ba li, epi ou konfime ou voye l. Li menm, li konfime li resevwa l. Lè sa a, nou dekadnase kripto a epi li ale jwenn ou. Depi kripto a kadnase, pèsonn pa ka manyen l jiskaske kòmand lan anile oswa li konfime.' },
      h('div', { class: 'feats' },
        feat('🔐', { en: 'The seller\'s crypto is locked', fr: 'La crypto du vendeur est verrouillée', ht: 'Kripto vandè a kadnase' }, { en: 'When a swap starts, we lock the seller\'s USDT. The seller cannot touch it, and neither can you, until the swap ends.', fr: 'Au début de l\'échange, nous verrouillons les USDT du vendeur. Personne n\'y touche jusqu\'à la fin.', ht: 'Lè yon echanj kòmanse, nou kadnase USDT vandè a. Ni vandè a, ni ou menm pa ka manyen l jiskaske echanj lan fini.' }),
        feat('💸', { en: 'You pay the seller directly', fr: 'Vous payez le vendeur directement', ht: 'Ou peye vandè a dirèk' }, { en: 'Gourdes go straight from your MonCash, NatCash or bank to the seller. We never hold gourdes.', fr: 'Les gourdes vont directement de votre MonCash, NatCash ou banque au vendeur. Nous ne gardons jamais de gourdes.', ht: 'Goud yo soti nan MonCash, NatCash oswa labank ou dirèk bay vandè a. Nou pa janm kenbe goud.' }),
        feat('✅', { en: 'Both confirm, then we unlock', fr: 'Les deux confirment, puis on libère', ht: 'Toude konfime, epi nou dekadnase' }, { en: 'You confirm you sent it. The seller confirms it arrived. Then the USDT is unlocked and goes to your wallet.', fr: 'Vous confirmez l\'envoi. Le vendeur confirme la réception. Puis les USDT sont libérés vers votre portefeuille.', ht: 'Ou konfime ou voye l. Vandè a konfime li rive. Epi USDT a dekadnase, li ale nan pòtfèy ou.' }),
        feat('⏱️', { en: 'Clocks keep it moving', fr: 'Des délais clairs', ht: 'Gen tan pou chak etap' }, { en: 'You have 30 minutes to pay. If the seller goes quiet after you paid, a dispute opens by itself. A clock never unlocks crypto alone.', fr: '30 minutes pour payer. Si le vendeur ne répond plus, un litige s\'ouvre tout seul. Un délai ne libère jamais la crypto tout seul.', ht: 'Ou gen 30 minit pou peye. Si vandè a pa reponn apre ou peye, yon diskisyon louvri pou kont li. Tan pa janm dekadnase kripto pou kont li.' }),
        feat('🧾', { en: 'Proof, not promises', fr: 'Des preuves, pas des promesses', ht: 'Prèv, pa pwomès' }, { en: 'Chat, payment code and receipts stay in the order. In a dispute, both sides upload proof and our team decides.', fr: 'Chat, code et reçus restent dans la commande. En litige, l\'équipe décide sur preuves.', ht: 'Chat, kòd peman ak resi yo rete nan kòmand lan. Si gen diskisyon, toude bò voye prèv, epi ekip la deside.' }),
        feat('🚫', { en: 'Scammers get banned', fr: 'Les arnaqueurs sont bannis', ht: 'Vòlè yo bloke' }, { en: 'Fake proof or no-shows bring strikes and bans. Banned phones, names and accounts cannot come back.', fr: 'Fausses preuves ou absences : avertissements et bannissement.', ht: 'Fo prèv oswa moun ki disparèt jwenn sanksyon epi yo bloke. Telefòn, non ak kont ki bloke pa ka tounen.' }))),
    sec('anywhere', { en: 'From anywhere', fr: 'De partout', ht: 'Nenpòt kote' },
      { en: 'Have USDT? Swap it for gourdes, from anywhere.', fr: 'Vous avez des USDT ? Échangez-les contre des gourdes, de partout.', ht: 'Ou gen USDT? Chanje l pou goud, nenpòt kote ou ye.' }, null,
      h('div', { class: 'fam' },
        h('div', { class: 'fam-flow' },
          h('div', { class: 'fam-node' }, h('span', {}, '🌎'), h('b', {}, tx3({ en: 'You', fr: 'Vous', ht: 'Ou menm' })), h('small', {}, tx3({ en: 'Sell USDT', fr: 'Vendez des USDT', ht: 'Vann USDT' }))),
          h('div', { class: 'fam-arrow' }, '→'),
          h('div', { class: 'fam-node mid' }, h('span', {}, '🔒'), h('b', {}, tx3({ en: 'Locked', fr: 'Verrouillé', ht: 'Kadnase' })), h('small', {}, tx3({ en: 'Until the gourdes arrive', fr: 'Jusqu\'à l\'arrivée des gourdes', ht: 'Jiskaske goud yo rive' }))),
          h('div', { class: 'fam-arrow' }, '→'),
          h('div', { class: 'fam-node' }, h('span', {}, '🇭🇹'), h('b', {}, tx3({ en: 'Gourdes', fr: 'Gourdes', ht: 'Goud' })), h('small', {}, tx3({ en: 'Into the MonCash, NatCash or bank you choose', fr: 'Sur le MonCash, NatCash ou banque choisi', ht: 'Nan MonCash, NatCash oswa labank ou chwazi a' })))),
        h('ul', { class: 'ow-list' },
          h('li', {}, tx3({ en: 'Open an account from any country, with any phone number. Same ID check for everyone.', fr: 'Ouvrez un compte depuis n\'importe quel pays. Même vérification pour tous.', ht: 'Louvri yon kont nenpòt peyi, ak nenpòt nimewo. Menm verifikasyon pou tout moun.' })),
          h('li', {}, tx3({ en: 'Big sellers can link more accounts: another person\'s MonCash or NatCash can be linked only if that person also has a verified account here and says yes.', fr: 'Les gros vendeurs peuvent lier d\'autres comptes, seulement si la personne a aussi un compte vérifié et accepte.', ht: 'Gwo vandè ka konekte plis kont: kont MonCash oswa NatCash yon lòt moun, sèlman si moun sa a gen yon kont verifye isit la tou, epi li dakò.' })),
          h('li', {}, tx3({ en: 'We only lock and unlock crypto between users. We never hold gourdes.', fr: 'Nous ne faisons que verrouiller et libérer la crypto. Jamais de gourdes chez nous.', ht: 'Nou sèlman kadnase epi dekadnase kripto ant moun yo. Nou pa janm kenbe goud.' }))))),
    sec('market', { en: 'Live market', fr: 'Marché en direct', ht: 'Mache an dirèk' }, { en: 'Real prices right now.', fr: 'Les vrais prix maintenant.', ht: 'Vrè pri kounye a.' },
      { en: 'Prices are in gourdes (HTG) for 1 USDT. Pick the best price, then swap.', fr: 'Prix en gourdes (HTG) pour 1 USDT.', ht: 'Pri yo an goud (HTG) pou 1 USDT. Chwazi pi bon pri a, epi fè echanj lan.' }, adsBox),
    sec('faq', { en: 'Questions', fr: 'Questions', ht: 'Kesyon' }, { en: 'Good to know', fr: 'Bon à savoir', ht: 'Bon pou w konnen' }, null,
      h('div', { class: 'faq' }, [
        [{ en: 'What is USDT?', fr: 'C\'est quoi l\'USDT ?', ht: 'Kisa USDT ye?' }, { en: 'USDT is a digital dollar. 1 USDT is made to stay worth about 1 US dollar. You can keep it, send it anywhere, or swap it for gourdes.', fr: 'L\'USDT est un dollar numérique. 1 USDT vaut environ 1 dollar américain.', ht: 'USDT se yon dola dijital. 1 USDT fèt pou vo apeprè 1 dola ameriken. Ou ka kenbe l, voye l nenpòt kote, oswa chanje l pou goud.' }],
        [{ en: 'Do you hold my gourdes?', fr: 'Gardez-vous mes gourdes ?', ht: 'Èske nou kenbe goud mwen?' }, { en: 'No. Gourdes always go directly between the two people. We only lock the crypto during a swap.', fr: 'Non. Les gourdes vont directement d\'une personne à l\'autre. Nous verrouillons seulement la crypto.', ht: 'Non. Goud yo toujou ale dirèk ant de moun yo. Nou sèlman kadnase kripto a pandan echanj lan.' }],
        [{ en: 'What if the seller does not confirm?', fr: 'Et si le vendeur ne confirme pas ?', ht: 'E si vandè a pa konfime?' }, { en: 'If you paid and the seller does not answer, a dispute opens by itself. Upload your receipt. Our team checks it and unlocks the crypto to you if you paid.', fr: 'Un litige s\'ouvre tout seul. Envoyez votre reçu. L\'équipe vérifie et vous libère la crypto si vous avez payé.', ht: 'Si ou peye epi vandè a pa reponn, yon diskisyon louvri pou kont li. Voye resi w. Ekip la tcheke, epi si ou te peye, nou dekadnase kripto a ba ou.' }],
        [{ en: 'Why do you ask for my ID and a video?', fr: 'Pourquoi une pièce d\'identité et une vidéo ?', ht: 'Poukisa nou mande pyès idantite m ak yon videyo?' }, { en: 'So everybody here is a real person. A short video saying your name, phone and a code stops fake accounts. Only our team sees it.', fr: 'Pour que tout le monde soit une vraie personne. Seule notre équipe la voit.', ht: 'Pou tout moun isit la se moun reyèl. Yon ti videyo kote ou di non w, nimewo w ak yon kòd bloke fo kont. Se ekip nou an sèlman ki wè l.' }],
        [{ en: 'How much does it cost?', fr: 'Combien ça coûte ?', ht: 'Konbyen sa koute?' }, { en: `Signing up is free. Sellers pay ${fee}% per swap, in USDT. Buyers pay no fee.`, fr: `Inscription gratuite. Les vendeurs paient ${fee} % par échange. Les acheteurs ne paient rien.`, ht: `Enskri gratis. Vandè yo peye ${fee}% sou chak echanj, an USDT. Achtè yo pa peye frè.` }],
        [{ en: 'Can I use it outside Haiti?', fr: 'Puis-je l\'utiliser hors d\'Haïti ?', ht: 'Èske m ka sèvi ak li andeyò Ayiti?' }, { en: 'Yes. Anyone, with any phone number, can open an account after the ID check.', fr: 'Oui. Tout le monde peut ouvrir un compte après la vérification.', ht: 'Wi. Nenpòt moun, ak nenpòt nimewo, ka louvri yon kont apre verifikasyon idantite a.' }],
      ].map(([q, a]) => h('details', {}, h('summary', {}, tx3(q)), h('p', {}, tx3(a)))))),
    h('section', { class: 'hfinal' },
      h('h2', {}, tx3({ en: 'Swap crypto in Haiti with confidence.', fr: 'Échangez de la crypto en Haïti en toute confiance.', ht: 'Fè echanj kripto ann Ayiti san pè.' })),
      h('p', {}, tx3({ en: 'Free to join. Takes 3 minutes.', fr: 'Gratuit. 3 minutes.', ht: 'Gratis. Li pran 3 minit.' })),
      h('button', { class: 'btn', onclick: go2('join') }, tx3(join))),
    h('footer', { class: 'hfoot' }, h('span', {}, '© ' + new Date().getFullYear() + ' Ayiti P2P'), h('a', { href: '#safety' }, tx3({ en: 'Safety', fr: 'Sécurité', ht: 'Sekirite' })),
      h('span', { class: 'mute' }, tx3({ en: 'Crypto prices move. Only swap what you can afford.', fr: 'Le prix de la crypto bouge.', ht: 'Pri kripto a ka chanje. Pa riske lajan ou pa ka pèdi.' }))),
    h('div', { class: 'hfoot' }, legalLinks()),
    h('p', { class: 'tm', style: 'margin:0 auto 24px;padding:0 16px;text-align:center' }, tx3({ en: 'MonCash, NatCash, Binance and the bank names and logos belong to their owners. They are shown only to say which payment methods people use. Ayiti P2P is not part of, or approved by, these companies.',
      fr: 'MonCash, NatCash, Binance et les noms et logos des banques appartiennent à leurs propriétaires. Ils servent seulement à montrer les moyens de paiement utilisés. Ayiti P2P n\'est ni lié ni approuvé par ces entreprises.',
      ht: 'MonCash, NatCash, Binance ak non ak logo bank yo se pou mèt yo. Nou montre yo sèlman pou di ki fason moun peye. Ayiti P2P pa fè pati konpayi sa yo, e yo pa apwouve l.' }))].filter(Boolean));
}
