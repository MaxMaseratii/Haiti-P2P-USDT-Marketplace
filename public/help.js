/* Help: a fast answer bot for common questions, on every page (Kreyòl, Français, English).
   It answers by itself from the list below (no waiting, works offline from the server).
   If it is not the right answer, the person writes to our team in one tap.
   Uses h(), api(), token, me, lang, cfg, toast, icon() from the other files. */
(() => {
  const L = () => (['ht', 'fr', 'en'].includes(typeof lang !== 'undefined' ? lang : 'ht') ? lang : 'ht');
  const T = (o) => o[L()] || o.en;
  const fee = () => (Number((typeof cfg !== 'undefined' && cfg.fee_rate) || 0.005) * 100).toFixed(1);
  const lockFee = () => (typeof cfg !== 'undefined' && cfg.lock_fee) || '0.25';
  const wFee = () => (typeof cfg !== 'undefined' && cfg.withdraw_fee) || '1';

  // Each answer: words that point to it (any language, no accents needed), the question, the answer.
  const KB = () => [
    { k: 'buy achte acheter achat purchase kijan achte comment acheter how buy', q: { ht: 'Kijan pou m achte USDT?', fr: 'Comment acheter des USDT ?', en: 'How do I buy USDT?' },
      a: { ht: '1. Ale nan MarketPlace, sou "Achte USDT".\n2. Chwazi yon vandè (gade pri a, nòt li ak badj li).\n3. Mete kantite goud ou vle depanse. Nou kadnase USDT vandè a.\n4. Peye vandè a pa MonCash, NatCash oswa labank, ak kòd peman an nan nòt la.\n5. Peze "Mwen peye". Vandè a konfime, epi USDT a tonbe nan pòtfèy ou.',
        fr: '1. Allez dans MarketPlace, « Acheter USDT ».\n2. Choisissez un vendeur (prix, note, badges).\n3. Entrez le montant en gourdes. Nous verrouillons les USDT du vendeur.\n4. Payez le vendeur par MonCash, NatCash ou banque, avec le code de paiement dans la note.\n5. Touchez « J\'ai payé ». Le vendeur confirme et les USDT arrivent dans votre portefeuille.',
        en: '1. Go to MarketPlace, "Buy USDT".\n2. Pick a seller (price, rating, badges).\n3. Enter how many gourdes you want to spend. We lock the seller\'s USDT.\n4. Pay the seller by MonCash, NatCash or bank, with the payment code in the note.\n5. Tap "I paid". The seller confirms and the USDT lands in your wallet.' } },
    { k: 'sell vann vendre vente goud gourdes cash out retire lajan', q: { ht: 'Kijan pou m vann USDT pou goud?', fr: 'Comment vendre des USDT contre des gourdes ?', en: 'How do I sell USDT for gourdes?' },
      a: { ht: 'Mete USDT nan pòtfèy ou (Pòtfèy → Depoze). Apre sa, swa ou mete yon anons "Vann", swa ou pran yon anons "Achte" yon moun nan MarketPlace. USDT ou a kadnase jiskaske goud yo rive nan MonCash, NatCash oswa kont bank ou. Ou tcheke lajan an, epi ou peze "Mwen resevwa l".',
        fr: 'Déposez des USDT dans votre portefeuille (Portefeuille → Déposer). Ensuite, publiez une annonce « Vendre » ou prenez une annonce « Acheter » dans MarketPlace. Vos USDT restent verrouillés jusqu\'à l\'arrivée des gourdes sur votre MonCash, NatCash ou compte bancaire. Vérifiez, puis touchez « Je l\'ai reçu ».',
        en: 'Put USDT in your wallet (Wallet → Deposit). Then post a "Sell" ad, or take someone\'s "Buy" ad in MarketPlace. Your USDT stays locked until the gourdes arrive in your MonCash, NatCash or bank. Check it, then tap "I received it".' } },
    { k: 'fee fre frais pri cost koute combien konbyen commission', q: { ht: 'Konbyen sa koute?', fr: 'Combien ça coûte ?', en: 'How much does it cost?' },
      a: { ht: `Enskri gratis.\n• Vandè: ${fee()}% sou chak echanj.\n• Achtè: ${lockFee()} USDT frè kadna pou chak kòmand.\n• Retire kripto: ${wFee()} USDT.\nTout frè parèt anvan ou konfime.`,
        fr: `Inscription gratuite.\n• Vendeur : ${fee()} % par échange.\n• Acheteur : ${lockFee()} USDT de frais de verrouillage par commande.\n• Retrait de crypto : ${wFee()} USDT.\nTous les frais s'affichent avant de confirmer.`,
        en: `Signing up is free.\n• Sellers: ${fee()}% per swap.\n• Buyers: ${lockFee()} USDT lock fee per order.\n• Taking crypto out: ${wFee()} USDT.\nEvery fee is shown before you confirm.` } },
    { k: 'safe sekirite securite scam vole volè arnaque fraud fwod kadna lock verrouille konfyans trust', q: { ht: 'Èske li an sekirite? Kisa kadna a ye?', fr: 'Est-ce sûr ? C\'est quoi le verrouillage ?', en: 'Is it safe? What is the lock?' },
      a: { ht: 'Wi. Anvan ou peye yon sèl goud, nou kadnase USDT vandè a. Vandè a pa ka manyen l. Li dekadnase al jwenn ou sèlman lè vandè a konfime lajan an rive. Si gen pwoblèm, ekip nou an deside ak prèv yo. Pa janm peye pèsonn andeyò yon kòmand nan aplikasyon an.',
        fr: 'Oui. Avant que vous payiez une seule gourde, nous verrouillons les USDT du vendeur. Il ne peut pas y toucher. Ils vous sont libérés seulement quand le vendeur confirme la réception. En cas de problème, notre équipe décide sur preuves. Ne payez jamais personne hors d\'une commande dans l\'application.',
        en: 'Yes. Before you pay a single gourde, we lock the seller\'s USDT. The seller cannot touch it. It is unlocked to you only when the seller confirms the money arrived. If there is a problem, our team decides with the proof. Never pay anyone outside an order in the app.' } },
    { k: 'moncash natcash pa rive not arrived pas recu delay reta lent slow sent voye peman payment', q: { ht: 'Mwen peye men vandè a di li pa wè lajan an', fr: 'J\'ai payé mais le vendeur ne voit pas l\'argent', en: 'I paid but the seller does not see the money' },
      a: { ht: 'Sa rive: pafwa MonCash, NatCash oswa yon bank lan. Kripto a rete kadnase, li pa ka disparèt. Kenbe resi SMS ou ak nimewo tranzaksyon an. Vandè a ka bay plis tan. Si lajan an pa rive apre tan an, ou ka louvri yon diskisyon nan kòmand lan epi voye resi a.',
        fr: 'Cela arrive : MonCash, NatCash ou une banque peut être lent. La crypto reste verrouillée, elle ne peut pas disparaître. Gardez votre reçu SMS et le numéro de transaction. Le vendeur peut donner plus de temps. Si l\'argent n\'arrive pas, ouvrez un litige dans la commande et envoyez le reçu.',
        en: 'It happens: MonCash, NatCash or a bank can be slow. The crypto stays locked, it cannot disappear. Keep your SMS receipt and transaction number. The seller can give more time. If the money never arrives, open a dispute in the order and upload the receipt.' } },
    { k: 'dispute diskisyon litige probleme pwoblem conflict seller not answer vande pa reponn', q: { ht: 'Vandè a pa reponn / gen yon pwoblèm', fr: 'Le vendeur ne répond pas / il y a un problème', en: 'The seller does not answer / there is a problem' },
      a: { ht: 'Si ou te peye epi vandè a pa reponn, yon diskisyon louvri pou kont li apre tan an. Ou ka louvri l tou nan kòmand lan. Voye prèv ou (resi, nimewo tranzaksyon). Ekip nou an tcheke epi deside. Kripto a rete kadnase jiskaske sa fini.',
        fr: 'Si vous avez payé et que le vendeur ne répond pas, un litige s\'ouvre tout seul après le délai. Vous pouvez aussi l\'ouvrir dans la commande. Envoyez vos preuves (reçu, numéro de transaction). Notre équipe vérifie et décide. La crypto reste verrouillée jusque-là.',
        en: 'If you paid and the seller does not answer, a dispute opens by itself after the time limit. You can also open it in the order. Upload your proof (receipt, transaction number). Our team checks and decides. The crypto stays locked until then.' } },
    { k: 'id kyc verifikasyon verification idantite identite passport paspo video videyo approve apwouve rejected refize', q: { ht: 'Verifikasyon idantite: kijan, konbyen tan?', fr: 'Vérification d\'identité : comment, combien de temps ?', en: 'ID check: how, how long?' },
      a: { ht: 'Nan Pwofil: chwazi pyès ou (kat idantite, paspò oswa lisans), pran foto l ak kamera aplikasyon an, epi fè ti videyo a (gade dwat, vire tèt ou a goch, a dwat, epi li fraz la). Sistèm nou an tcheke l an kèk minit. Si li pa sèten, ekip la gade l. Si yo refize, eseye ankò ak foto ki pi klè.',
        fr: 'Dans Profil : choisissez votre pièce (carte d\'identité, passeport ou permis), photographiez-la avec la caméra de l\'application, puis faites la courte vidéo (de face, tête à gauche, à droite, puis lisez la phrase). Notre système vérifie en quelques minutes. S\'il n\'est pas sûr, l\'équipe regarde. En cas de refus, réessayez avec des photos plus nettes.',
        en: 'In Profile: pick your ID (ID card, passport or license), photograph it with the app camera, then record the short video (look straight, turn your head left, right, then read the sentence). Our system checks it in a few minutes. If it is not sure, our team looks. If refused, try again with clearer photos.' } },
    { k: 'code kod pa resevwa not received email imel spam login konekte connexion', q: { ht: 'Mwen pa resevwa kòd la', fr: 'Je ne reçois pas le code', en: 'I did not get the code' },
      a: { ht: 'Kòd la ale nan imèl ou. Gade nan "Spam" oswa "Promotions". Tann 1 minit anvan ou mande yon lòt. Pou konekte, ou ka mete telefòn ou OSWA imèl ou.',
        fr: 'Le code va à votre e-mail. Regardez dans « Spam » ou « Promotions ». Attendez 1 minute avant d\'en redemander un. Pour vous connecter, entrez votre téléphone OU votre e-mail.',
        en: 'The code goes to your email. Check "Spam" or "Promotions". Wait 1 minute before asking for another one. To log in you can use your phone OR your email.' } },
    { k: 'deposit depoze depot arbitrum network rezo adres address wallet potfey send usdt binance', q: { ht: 'Kijan pou m depoze USDT?', fr: 'Comment déposer des USDT ?', en: 'How do I deposit USDT?' },
      a: { ht: 'Nan Pòtfèy: konekte pòtfèy kripto ou, epi swiv etap yo pou depoze USDT oswa USDC sou rezo Arbitrum One. Tcheke rezo a byen: si ou voye sou yon lòt rezo, lajan an ka pèdi.',
        fr: 'Dans Portefeuille : connectez votre portefeuille crypto, puis suivez les étapes pour déposer des USDT ou USDC sur le réseau Arbitrum One. Vérifiez bien le réseau : un envoi sur un autre réseau peut être perdu.',
        en: 'In Wallet: link your crypto wallet, then follow the steps to deposit USDT or USDC on the Arbitrum One network. Check the network carefully: money sent on another network can be lost.' } },
    { k: 'withdraw retire retrait sortir send out voye kripto binance', q: { ht: 'Kijan pou m retire kripto mwen?', fr: 'Comment retirer ma crypto ?', en: 'How do I take my crypto out?' },
      a: { ht: `Nan Pòtfèy → Retire. Ou siyen nan aplikasyon an, nou peye gaz rezo a pou ou, epi frè a se ${wFee()} USDT. Kripto a ale nan pòtfèy ou konekte a.`,
        fr: `Dans Portefeuille → Retirer. Vous signez dans l'application, nous payons les frais du réseau, et le frais est de ${wFee()} USDT. La crypto va vers votre portefeuille connecté.`,
        en: `In Wallet → Withdraw. You sign in the app, we pay the network gas for you, and the fee is ${wFee()} USDT. The crypto goes to your linked wallet.` } },
    { k: 'usdt usdc kisa what quoi dola dollar stablecoin', q: { ht: 'Kisa USDT ak USDC ye?', fr: 'C\'est quoi USDT et USDC ?', en: 'What are USDT and USDC?' },
      a: { ht: 'Se dola dijital. 1 USDT oswa 1 USDC fèt pou vo apeprè 1 dola ameriken. Ou ka kenbe yo, voye yo nenpòt kote, oswa chanje yo pou goud isit la.',
        fr: 'Ce sont des dollars numériques. 1 USDT ou 1 USDC vaut environ 1 dollar américain. Vous pouvez les garder, les envoyer partout, ou les échanger contre des gourdes ici.',
        en: 'They are digital dollars. 1 USDT or 1 USDC is made to stay worth about 1 US dollar. You can keep them, send them anywhere, or swap them for gourdes here.' } },
    { k: 'limit limite maximum minimum max min nivo tier konbyen plus', q: { ht: 'Ki limit yo ye?', fr: 'Quelles sont les limites ?', en: 'What are the limits?' },
      a: { ht: 'Chak anons gen yon minimòm ak yon maksimòm pou chak kòmand. Nivo kont ou (tier) fikse limit ou pa jou: apre verifikasyon idantite a ou nan nivo 1. Gwo komèsan ka mande ekip la yon nivo ki pi wo.',
        fr: 'Chaque annonce a un minimum et un maximum par commande. Le niveau de votre compte fixe votre limite par jour : après la vérification vous êtes au niveau 1. Les gros commerçants peuvent demander un niveau plus haut à l\'équipe.',
        en: 'Each ad has a minimum and maximum per order. Your account level (tier) sets your daily limit: after the ID check you are level 1. Big traders can ask the team for a higher level.' } },
    { k: 'country peyi pays outside andeyo diaspora usa france uk canada etranger', q: { ht: 'Èske m ka itilize l andeyò Ayiti?', fr: 'Puis-je l\'utiliser hors d\'Haïti ?', en: 'Can I use it outside Haiti?' },
      a: { ht: 'Wi. Nenpòt moun, nenpòt peyi, ak nenpòt nimewo, ka louvri yon kont apre verifikasyon idantite a (sof kèk peyi ki anba sanksyon).',
        fr: 'Oui. Tout le monde, de n\'importe quel pays et avec n\'importe quel numéro, peut ouvrir un compte après la vérification (sauf quelques pays sous sanctions).',
        en: 'Yes. Anyone, from any country and with any phone number, can open an account after the ID check (except a few countries under sanctions).' } },
    { k: 'goud gourdes hold kenbe garde lajan argent bank labank', q: { ht: 'Èske nou kenbe goud mwen?', fr: 'Gardez-vous mes gourdes ?', en: 'Do you hold my gourdes?' },
      a: { ht: 'Non. Goud yo toujou ale dirèk ant de moun yo. Nou sèlman kadnase epi dekadnase kripto a pandan echanj lan.',
        fr: 'Non. Les gourdes vont toujours directement d\'une personne à l\'autre. Nous verrouillons et libérons seulement la crypto.',
        en: 'No. Gourdes always go directly between the two people. We only lock and unlock the crypto during a swap.' } },
    { k: 'seller vande profile pwofil biznis business afich poster badge badj photo foto cover kouveti', q: { ht: 'Kijan pou m fè yon bèl pwofil vandè?', fr: 'Comment faire un beau profil vendeur ?', en: 'How do I make a good seller profile?' },
      a: { ht: 'Nan Pwofil → Pwofil biznis mwen: mete yon foto pwofil, yon foto kouvèti, non biznis ou, kèk mo sou ou, zòn ou, tan ou pran pou reponn, ak jiska 6 afich. Badj Bon Sèvis vini ak vrè echanj ki fini byen.',
        fr: 'Dans Profil → Mon profil commerce : photo de profil, photo de couverture, nom du commerce, quelques mots, votre zone, votre délai de réponse et jusqu\'à 6 affiches. Les badges Bon Service viennent avec de vrais échanges réussis.',
        en: 'In Profile → My business profile: add a profile photo, a cover photo, your business name, a few words, your area, your response time and up to 6 posters. Good Service badges come with real trades done well.' } },
    { k: 'whatsapp outside deyo hors payer avant pay first voye anvan', q: { ht: 'Yon moun mande m peye l sou WhatsApp anvan', fr: 'Quelqu\'un me demande de payer d\'abord sur WhatsApp', en: 'Someone asks me to pay first on WhatsApp' },
      a: { ht: 'Pa fè sa. Si yon moun gen vrè USDT, l ap vann li sou Ayiti P2P, kote kripto a kadnase anvan ou peye. Moun ki mande w voye lajan anvan, andeyò yon kòmand, gen anpil chans li pa gen kripto a.',
        fr: 'Ne le faites pas. Quelqu\'un qui a vraiment des USDT les vendra sur Ayiti P2P, où la crypto est verrouillée avant que vous payiez. Celui qui demande d\'envoyer l\'argent d\'abord, hors d\'une commande, ne l\'a probablement pas.',
        en: 'Do not do it. Someone who really has USDT will sell it on Ayiti P2P, where the crypto is locked before you pay. A person who asks you to send money first, outside an order, probably does not have it.' } },
    { k: 'close fèmen fermer delete efase supprimer account kont compte', q: { ht: 'Kijan pou m fèmen kont mwen?', fr: 'Comment fermer mon compte ?', en: 'How do I close my account?' },
      a: { ht: 'Anba paj la, nan "Fèmen kont". Ou dwe pa gen okenn kòmand louvri ni kripto nan pòtfèy ou.',
        fr: 'En bas de page, dans « Fermer le compte ». Vous ne devez avoir aucune commande ouverte ni crypto dans votre portefeuille.',
        en: 'At the bottom of the page, in "Close account". You must have no open order and no crypto left in your wallet.' } },
  ];

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  function best(text) {
    const words = norm(text).split(' ').filter((w) => w.length > 1);
    let top = null, score = 0;
    for (const e of KB()) {
      const keys = norm(e.k + ' ' + Object.values(e.q).join(' ')).split(' ');
      let s = 0; for (const w of words) if (keys.some((k) => k === w || (w.length > 3 && (k.startsWith(w) || w.startsWith(k)) && k.length > 3))) s++;
      if (s > score) { score = s; top = e; }
    }
    return score >= 1 ? top : null;
  }

  const TX = {
    title: { ht: 'Èd Ayiti P2P', fr: 'Aide Ayiti P2P', en: 'Ayiti P2P Help' },
    hi: { ht: 'Bonjou! Poze kesyon ou, oswa chwazi youn anba a. Repons lan vini touswit.', fr: 'Bonjour ! Posez votre question ou choisissez-en une ci-dessous. La réponse arrive tout de suite.', en: 'Hello! Ask your question, or pick one below. The answer comes right away.' },
    ph: { ht: 'Ekri kesyon ou…', fr: 'Écrivez votre question…', en: 'Type your question…' },
    send: { ht: 'Voye', fr: 'Envoyer', en: 'Send' },
    helped: { ht: 'Sa reponn kesyon ou?', fr: 'Cela répond à votre question ?', en: 'Did this answer your question?' },
    yes: { ht: 'Wi, mèsi', fr: 'Oui, merci', en: 'Yes, thanks' },
    person: { ht: 'Pale ak yon moun', fr: 'Parler à une personne', en: 'Talk to a person' },
    unsure: { ht: 'M pa fin sèten. Men kèk repons ki ka ede w, oswa ekri ekip la:', fr: 'Je ne suis pas sûr. Voici des réponses qui peuvent aider, ou écrivez à l\'équipe :', en: 'I am not sure. Here are answers that may help, or write to the team:' },
    glad: { ht: 'Mèsi! Nou la si ou bezwen nou.', fr: 'Merci ! Nous sommes là si besoin.', en: 'Great! We are here if you need us.' },
    write: { ht: 'Ekri mesaj ou pou ekip la. N ap reponn ou vit, nan aplikasyon an ak pa imèl.', fr: 'Écrivez votre message à l\'équipe. Nous répondons vite, dans l\'application et par e-mail.', en: 'Write your message to the team. We answer fast, in the app and by email.' },
    email: { ht: 'Imèl ou (pou nou reponn ou)', fr: 'Votre e-mail (pour vous répondre)', en: 'Your email (so we can answer)' },
    sent: { ht: 'Mesaj ou rive. Ekip la ap reponn ou vit.', fr: 'Message reçu. L\'équipe vous répond vite.', en: 'Message received. The team will answer you soon.' },
    mine: { ht: 'Mesaj ou yo', fr: 'Vos messages', en: 'Your messages' },
    wait: { ht: 'N ap reponn ou talè.', fr: 'Réponse bientôt.', en: 'Answer coming soon.' },
    team: { ht: 'Ekip la', fr: 'L\'équipe', en: 'The team' },
    close: { ht: 'Fèmen', fr: 'Fermer', en: 'Close' },
    btn: { ht: 'Èd', fr: 'Aide', en: 'Help' },
  };

  let panel = null, log = null;
  const say = (text, who = 'bot') => { const m = h('div', { class: 'hb-msg ' + who }, text); log.append(m); log.scrollTop = log.scrollHeight; return m; };
  const chipsOf = (list) => h('div', { class: 'hb-chips' }, list.map((e) => h('button', { type: 'button', class: 'hb-chip', onclick: () => answer(e, T(e.q)) }, T(e.q))));
  function answer(e, asked) {
    say(asked, 'me');
    say(T(e.a));
    const row = h('div', { class: 'hb-ask' }, h('span', {}, T(TX.helped)),
      h('button', { type: 'button', class: 'hb-chip', onclick: () => { row.remove(); say(T(TX.glad)); } }, T(TX.yes)),
      h('button', { type: 'button', class: 'hb-chip strong', onclick: () => { row.remove(); toPerson(asked); } }, T(TX.person)));
    log.append(row); log.scrollTop = log.scrollHeight;
  }
  function toPerson(prefill) {
    const msg = h('textarea', { rows: 3, maxlength: 1500, placeholder: T(TX.ph) }, prefill || '');
    const loggedIn = typeof token !== 'undefined' && token && typeof me !== 'undefined' && me;
    const em = loggedIn ? null : h('input', { type: 'email', placeholder: T(TX.email), autocomplete: 'email' });
    const box = h('div', { class: 'hb-form' }, h('p', {}, T(TX.write)), msg, em,
      h('button', { type: 'button', class: 'btn sm', onclick: async (ev) => {
        ev.target.disabled = true;
        try {
          await api('POST', '/help/ask', { message: msg.value, contact: em ? em.value : undefined, lang: L(), page: location.hash.slice(1, 40) });
          box.remove(); say(T(TX.sent));
        } catch (e) { toast(e.message, true); ev.target.disabled = false; }
      } }, T(TX.send)));
    log.append(box); log.scrollTop = log.scrollHeight; msg.focus();
  }
  async function myMessages() {
    if (!(typeof token !== 'undefined' && token)) return;
    try {
      const list = await api('GET', '/help/mine');
      if (!list.length) return;
      log.append(h('div', { class: 'hb-mine' }, h('b', {}, T(TX.mine)), list.slice(0, 5).map((t) => h('div', { class: 'hb-t' },
        h('div', { class: 'hb-q' }, t.message), t.reply ? h('div', { class: 'hb-r' }, h('b', {}, T(TX.team) + ': '), t.reply) : h('div', { class: 'mute small' }, T(TX.wait))))));
    } catch {}
  }
  function open() {
    if (panel) { panel.classList.toggle('on'); return; }
    const input = h('input', { placeholder: T(TX.ph), 'aria-label': T(TX.ph) });
    const go = () => { const v = input.value.trim(); if (!v) return; input.value = ''; const e = best(v); if (e) answer(e, v); else { say(v, 'me'); say(T(TX.unsure)); log.append(chipsOf(KB().slice(0, 4))); const b = h('button', { type: 'button', class: 'hb-chip strong', onclick: () => { b.remove(); toPerson(v); } }, T(TX.person)); log.append(b); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    log = h('div', { class: 'hb-log' });
    panel = h('div', { class: 'hb-panel on nt', role: 'dialog', 'aria-label': T(TX.title) },
      h('div', { class: 'hb-head' }, h('span', { class: 'hb-av' }, icon('headset')), h('b', {}, T(TX.title)), h('button', { type: 'button', class: 'hb-x', 'aria-label': T(TX.close), onclick: () => panel.classList.remove('on') }, '✕')),
      log, h('div', { class: 'hb-in' }, input, h('button', { type: 'button', class: 'btn sm', onclick: go }, T(TX.send))));
    document.body.append(panel);
    say(T(TX.hi)); log.append(chipsOf(KB().slice(0, 8))); myMessages();
    setTimeout(() => input.focus(), 50);
  }
  function mount() {
    if (document.querySelector('.hb-btn')) return;
    const b = h('button', { type: 'button', class: 'hb-btn nt', 'aria-label': T(TX.btn), onclick: open }, icon('chat'), h('span', {}, T(TX.btn)));
    document.body.append(b);
    // Language changed: rebuild in the new language next time it opens.
    window.addEventListener('hashchange', () => { if (panel && !panel.classList.contains('on')) { panel.remove(); panel = null; } b.lastChild.textContent = T(TX.btn); });
  }
  window.HelpBot = { mount, reset: () => { panel?.remove(); panel = null; const b = document.querySelector('.hb-btn'); if (b) b.lastChild.textContent = T(TX.btn); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
