/* Two animated films for the home page, made of HTML (no video files, no voice).
   filmWhy(): the problem we solve. filmHow(): how a swap works, step by step.
   One clock drives everything, so the films can be played, paused and scrubbed smoothly.
   Uses h() from app.js and tx3() from home.js (both are loaded before these run). */
(() => {
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const mix = (a, b, p) => a + (b - a) * p;
  const num = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const setText = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  const setOp = (el, o) => { const v = o.toFixed(3); if (el._o !== v) { el._o = v; el.style.opacity = v; } };
  const tog = (el, c, on) => { if (el.classList.contains(c) !== !!on) el.classList.toggle(c, !!on); };
  const T3 = (o) => (typeof o === 'string' ? o : tx3(o));
  const still = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function centerOf(stage, el) {
    const a = stage.getBoundingClientRect(), b = el.getBoundingClientRect();
    return { x: b.left - a.left + b.width / 2, y: b.top - a.top + b.height / 2 };
  }
  // Quadratic curve from A to B. bend > 0 bows the path up (or to the side).
  function curve(A, B, p, bend = 40, C = null) {
    const c = C || { x: (A.x + B.x) / 2 + (B.y - A.y) * 0.0, y: (A.y + B.y) / 2 - bend };
    const q = 1 - p;
    return { x: q * q * A.x + 2 * q * p * c.x + p * p * B.x, y: q * q * A.y + 2 * q * p * c.y + p * p * B.y };
  }
  function place(el, P, s = 1) { el.style.transform = `translate3d(${P.x.toFixed(1)}px,${P.y.toFixed(1)}px,0) translate(-50%,-50%) scale(${s.toFixed(3)})`; }

  function lockIcon(cls = '') {
    const d = h('div', { class: 'lk ' + cls });
    d.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="shk"><path d="M7.5 11V7.6a4.5 4.5 0 0 1 9 0V11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></g><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.6" fill="currentColor"/><circle cx="12" cy="15.4" r="1.6" fill="var(--lk-hole,#fff)"/></svg>';
    return d;
  }
  function setLock(el, closed) {
    const g = el.querySelector('.shk');
    const v = closed.toFixed(3);
    if (el._c === v) return; el._c = v;
    g.style.transform = `translate(${(1 - closed) * 4.5}px, ${(1 - closed) * -3.5}px) rotate(${(1 - closed) * 18}deg)`;
    tog(el, 'shut', closed > 0.5);
  }

  // ---------- the player: stage, caption, play/pause, scrub bar, step chips ----------
  function player(spec) {
    const scenes = spec.scenes;
    const durs = scenes.map((s) => s.d || Math.max(s.min || 4200, 1500 + 52 * T3(s.cap).length));
    const starts = []; let acc = 0; for (const d of durs) { starts.push(acc); acc += d; }
    const T = acc;
    const at = (t, s, a, b) => ease(clamp01((t - starts[s] - a) / (b - a)));
    const sceneAt = (t) => { let k = 0; while (k + 1 < starts.length && t >= starts[k + 1]) k++; return k; };

    const stage = h('div', { class: 'fs ' + spec.cls });
    const film = spec.mount(stage, at, starts);

    const capA = h('span', { class: 'on' }), capB = h('span');
    const capNo = h('b', { class: 'fcap-n' });
    const cap = h('div', { class: 'fcap', 'aria-live': 'polite' }, capNo, h('div', { class: 'fcap-t' }, capA, capB));
    const fill = h('i', { class: 'ffill' });
    const knob = h('i', { class: 'fknob' });
    const track = h('div', { class: 'ftrack' }, fill, ...starts.slice(1).map((s) => h('b', { style: `left:${(s / T) * 100}%` })), knob);
    const bar = h('div', { class: 'fbar', role: 'slider', tabindex: '0', 'aria-label': T3({ en: 'Film position', fr: 'Position du film', ht: 'Kote fim nan ye' }), 'aria-valuemin': '1', 'aria-valuemax': String(scenes.length) }, track);
    const icPlay = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
    const icPause = '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
    const icAgain = '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const playBtn = h('button', { class: 'fplay', type: 'button' });
    const chips = h('div', { class: 'fchips' }, scenes.map((s, k) => h('button', { type: 'button', onclick: () => { seek(starts[k] + (reduce ? durs[k] - 1 : 0)); if (!reduce) setPlaying(true); } }, h('small', {}, String(k + 1)), T3(s.label))));
    const box = h('div', { class: 'film2' }, h('div', { class: 'fs-wrap' }, stage), cap, h('div', { class: 'fctl' }, playBtn, bar), chips);

    const reduce = still();
    let t = reduce ? durs[0] - 1 : 0, playing = false, visible = false, wanted = !reduce, raf = 0, last = 0, k0 = -1, which = 0, dragging = false;

    function draw() {
      const k = sceneAt(t);
      film.frame(t, k);
      // fade the stage at the loop seam so the restart is soft
      setOp(stage, playing ? Math.min(1, t / 380, (T - t) / 380) : 1);
      const pct = (t / T) * 100;
      fill.style.width = pct + '%'; knob.style.left = pct + '%';
      if (k !== k0) {
        k0 = k;
        const cur = which ? capB : capA, nxt = which ? capA : capB;
        nxt.textContent = T3(scenes[k].cap); cur.classList.remove('on'); nxt.classList.add('on'); which = 1 - which;
        capNo.textContent = (k + 1) + '/' + scenes.length;
        bar.setAttribute('aria-valuenow', String(k + 1));
        [...chips.children].forEach((c, i) => c.classList.toggle('on', i === k));
        const c = chips.children[k];
        if (c && chips.scrollWidth > chips.clientWidth) chips.scrollTo({ left: c.offsetLeft - chips.clientWidth / 2 + c.offsetWidth / 2, behavior: reduce ? 'auto' : 'smooth' });
      }
    }
    function loop(now) {
      raf = 0;
      if (!playing) return;
      const dt = last ? Math.min(now - last, 64) : 16; last = now;
      if (!dragging) { t += dt; if (t >= T) t -= T; }
      draw();
      raf = requestAnimationFrame(loop);
    }
    function run() { const go = wanted && visible && !document.hidden; if (go === playing) return; playing = go; last = 0; if (go) raf = raf || requestAnimationFrame(loop); else if (raf) { cancelAnimationFrame(raf); raf = 0; } playIcon(); draw(); }
    function playIcon() { playBtn.innerHTML = wanted ? icPause : icPlay; playBtn.setAttribute('aria-label', wanted ? 'Pause' : 'Play'); }
    function setPlaying(v) { wanted = v; run(); playIcon(); }
    function seek(nt) { t = Math.max(0, Math.min(T - 1, nt)); draw(); }
    playBtn.onclick = () => setPlaying(!wanted);
    playIcon();

    const fromX = (x) => { const r = track.getBoundingClientRect(); return clamp01((x - r.left) / r.width) * (T - 1); };
    bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); seek(fromX(e.clientX)); });
    bar.addEventListener('pointermove', (e) => { if (dragging) seek(fromX(e.clientX)); });
    const up = () => { if (dragging) { dragging = false; last = 0; } };
    bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
    bar.addEventListener('keydown', (e) => {
      const k = sceneAt(t);
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(starts[Math.min(k + 1, scenes.length - 1)] + (reduce ? durs[Math.min(k + 1, scenes.length - 1)] - 1 : 0)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(starts[Math.max(k - (t - starts[k] < 900 ? 1 : 0), 0)]); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPlaying(!wanted); }
    });

    const relayout = () => { stage.dataset.l = stage.clientWidth < 640 ? 'tall' : 'wide'; requestAnimationFrame(() => { film.layout(); draw(); }); };
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(stage); else addEventListener('resize', relayout);
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; run(); }, { threshold: 0.35 }).observe(box);
    else { visible = true; }
    document.addEventListener('visibilitychange', run);
    setTimeout(() => { relayout(); run(); }, 0);
    // Pause when the page is left (for example a route change removes the film)
    const gone = setInterval(() => { if (!box.isConnected && box._seen) { wanted = false; run(); clearInterval(gone); } if (box.isConnected) box._seen = true; }, 2000);
    return box;
  }

  // ======================================================================
  // Film 1: Why Ayiti P2P? (the problem we solve)
  // ======================================================================
  const WHY = {
    cls: 'why',
    scenes: [
      { label: { en: 'Why', fr: 'Pourquoi', ht: 'Poukisa' }, min: 3600, cap: { en: 'Why Ayiti P2P?', fr: 'Pourquoi Ayiti P2P ?', ht: 'Poukisa Ayiti P2P?' } },
      { label: { en: 'WhatsApp', fr: 'WhatsApp', ht: 'WhatsApp' }, min: 4600, cap: { en: 'Need crypto in Haiti? Today, you ask in every WhatsApp group.', fr: 'Besoin de crypto en Haïti ? Aujourd\'hui, vous demandez dans chaque groupe WhatsApp.', ht: 'Ou bezwen achte kripto ann Ayiti? Jodi a, ou mande nan tout gwoup WhatsApp.' } },
      { label: { en: 'Gone', fr: 'Disparu', ht: 'Disparèt' }, min: 6800, cap: { en: 'You send MonCash first. Then the person disappears. No answer. Your money is gone.', fr: 'Vous envoyez MonCash d\'abord. Puis la personne disparaît. Pas de réponse. Votre argent est perdu.', ht: 'Ou voye MonCash anvan. Epi moun nan disparèt. Li pa reponn. Lajan an ale.' } },
      { label: { en: 'Verified', fr: 'Vérifiés', ht: 'Verifye' }, min: 5200, cap: { en: 'On Ayiti P2P, everyone is verified: phone with an OTP code, ID, and a short video.', fr: 'Sur Ayiti P2P, tout le monde est vérifié : téléphone avec code OTP, pièce d\'identité et courte vidéo.', ht: 'Sou Ayiti P2P, tout moun verifye: telefòn ak kòd OTP, pyès idantite, ak yon ti videyo.' } },
      { label: { en: 'Locked first', fr: 'Verrouillé', ht: 'Kadnase' }, min: 4600, cap: { en: 'We lock the seller\'s crypto before you pay. They cannot take it back.', fr: 'Nous verrouillons la crypto du vendeur avant que vous payiez. Il ne peut pas la reprendre.', ht: 'Nou kadnase kripto vandè a anvan ou peye. Li pa ka repran l.' } },
      { label: { en: 'Unlocked', fr: 'Libéré', ht: 'Dekadnase' }, min: 5200, cap: { en: 'We unlock it only when the seller confirms the money arrived.', fr: 'Nous la libérons seulement quand le vendeur confirme que l\'argent est arrivé.', ht: 'Nou dekadnase l sèlman lè vandè a konfime li resevwa lajan an.' } },
      { label: { en: 'Problem?', fr: 'Problème ?', ht: 'Pwoblèm?' }, min: 4800, cap: { en: 'If there is a problem, the crypto stays locked. Our team checks the proof and decides.', fr: 'En cas de problème, la crypto reste verrouillée. Notre équipe examine les preuves et décide.', ht: 'Si gen pwoblèm, kripto a rete kadnase. Ekip nou an gade prèv yo epi deside.' } },
      { label: { en: 'Fast', fr: 'Rapide', ht: 'Rapid' }, min: 4400, cap: { en: 'No long waits. A swap can be done in minutes.', fr: 'Pas de longue attente. Un échange se fait en quelques minutes.', ht: 'Pa gen tann lontan. Yon echanj ka fini nan kèk minit.' } },
      { label: { en: 'Best price', fr: 'Meilleur prix', ht: 'Pi bon pri' }, min: 5400, cap: { en: 'The market shows the best prices first. You see each trader\'s rating and how many swaps they finished.', fr: 'Le marché montre d\'abord les meilleurs prix. Vous voyez la note de chacun et ses échanges terminés.', ht: 'Mache a montre pi bon pri yo an premye. Ou wè nòt chak moun, ak konbyen echanj yo fè.' } },
      { label: { en: 'Join', fr: 'Rejoindre', ht: 'Kreye kont' }, min: 4400, cap: { en: 'Create your free account. Ayiti P2P: swap crypto without the risk.', fr: 'Créez votre compte gratuit. Ayiti P2P : échangez de la crypto sans risque.', ht: 'Kreye kont ou gratis. Ayiti P2P: chanje kripto san risk.' } },
    ],
    mount(stage, at) {
      const W = {
        old: { en: 'The old way', fr: 'Avant', ht: 'Ansyen fason an' }, neu: { en: 'With Ayiti P2P', fr: 'Avec Ayiti P2P', ht: 'Ak Ayiti P2P' },
        grp: 'Kripto Ayiti 🇭🇹', mem: { en: '2,341 members', fr: '2 341 membres', ht: '2,341 manm' },
        m1: { en: 'Who has USDT? I need 100.', fr: 'Qui a des USDT ? J\'en veux 100.', ht: 'Kiyès ki gen USDT? M bezwen 100.' },
        m2: { en: 'Me. Send 14,000 HTG MonCash first.', fr: 'Moi. Envoie 14 000 HTG MonCash d\'abord.', ht: 'Mwen. Voye 14,000 goud MonCash anvan.' },
        m3: { en: 'OK, sent ✓✓', fr: 'OK, envoyé ✓✓', ht: 'Ok, m voye l ✓✓' },
        rc: { en: 'Sent', fr: 'Envoyé', ht: 'Voye' },
        m4: { en: 'Hello? Did you send the USDT?', fr: 'Allô ? Tu as envoyé ?', ht: 'Alo? Ou voye USDT a?' },
        m5: { en: 'Please answer…', fr: 'Réponds s\'il te plaît…', ht: 'Tanpri reponn…' },
        sys: { en: 'This contact blocked you', fr: 'Ce contact vous a bloqué', ht: 'Moun sa a bloke w' },
        gone: { en: 'Money gone', fr: 'Argent perdu', ht: 'Lajan an ale' },
        you: { en: 'You', fr: 'Vous', ht: 'Ou menm' },
        ver: { en: 'Verified', fr: 'Vérifié', ht: 'Verifye' }, ph: { en: 'Phone · OTP code', fr: 'Téléphone · code OTP', ht: 'Telefòn · kòd OTP' },
        id: { en: 'ID document', fr: 'Pièce d\'identité', ht: 'Pyès idantite' }, vd: { en: 'Video: "I am Jean…"', fr: 'Vidéo : « Je suis Jean… »', ht: 'Videyo: "Mwen se Jean…"' },
        lk: { en: 'Locked before you pay', fr: 'Verrouillé avant de payer', ht: 'Kadnase anvan ou peye' }, lk2: { en: 'The seller cannot take it back', fr: 'Le vendeur ne peut pas le reprendre', ht: 'Vandè a pa ka repran l' },
        u1: { en: 'You paid 28,000 HTG', fr: 'Vous avez payé 28 000 HTG', ht: 'Ou peye 28,000 goud' }, u2: { en: 'Seller: "I received it"', fr: 'Vendeur : « Je l\'ai reçu »', ht: 'Vandè a: "Mwen resevwa l"' }, u3: { en: '200 USDT → you', fr: '200 USDT → vous', ht: '200 USDT → ou menm' },
        t0: { en: 'Problem? The crypto stays locked', fr: 'Problème ? La crypto reste verrouillée', ht: 'Pwoblèm? Kripto a rete kadnase' },
        t1: { en: 'Both sides send proof', fr: 'Les deux envoient des preuves', ht: 'Toude bò voye prèv' }, t2: { en: 'Our team decides', fr: 'Notre équipe décide', ht: 'Ekip nou an deside' },
        f0: { en: 'Swap time', fr: 'Durée de l\'échange', ht: 'Tan echanj lan' }, f1: { en: 'Done', fr: 'Terminé', ht: 'Fini' },
        best: { en: 'Best price', fr: 'Meilleur prix', ht: 'Pi bon pri' }, sw: { en: 'swaps', fr: 'échanges', ht: 'echanj' },
        end: { en: 'Create your free account', fr: 'Créez votre compte gratuit', ht: 'Kreye kont ou gratis' }, endS: { en: 'Swap crypto without the risk.', fr: 'Échangez de la crypto sans risque.', ht: 'Chanje kripto san risk.' },
        title: { en: 'Why Ayiti P2P?', fr: 'Pourquoi Ayiti P2P ?', ht: 'Poukisa Ayiti P2P?' }, titleS: { en: 'The problem we solve', fr: 'Le problème que nous réglons', ht: 'Pwoblèm nou rezoud' },
      };
      const msg = (txt, me) => h('div', { class: 'wb' + (me ? ' me' : '') }, me ? null : h('b', {}, '+509 •••• 31 22'), T3(txt), h('i', {}, me ? '10:4' + (me === 2 ? '6' : '2') + ' ✓✓' : '10:43'));
      const M = [msg(W.m1, 1), msg(W.m2, 0), msg(W.m3, 2), h('div', { class: 'wb me rc' }, h('span', { class: 'mcx' }, 'MonCash'), h('b', {}, '−14,000 HTG'), h('small', {}, T3(W.rc) + ' ✓')), msg(W.m4, 2), msg(W.m5, 2), h('div', { class: 'wsys' }, '⛔ ' + T3(W.sys))];
      const stamp = h('div', { class: 'stamp' }, T3(W.gone));
      const oldPh = h('div', { class: 'wphone' }, h('div', { class: 'wtop' }, h('span', { class: 'wav' }, 'K'), h('div', {}, h('b', {}, W.grp), h('small', {}, T3(W.mem)))), h('div', { class: 'wbody' }, h('div', { class: 'wlist' }, M)), stamp);
      const oldCol = h('div', { class: 'wy-old' }, h('div', { class: 'wtag bad' }, T3(W.old)), oldPh);

      const check = (ic, txt) => h('div', { class: 'vrow2' }, h('span', { class: 'vic' }, ic), h('span', {}, T3(txt)), h('b', { class: 'vok' }, '✓'));
      const cVer = h('div', { class: 'wcard' }, h('div', { class: 'whead' }, h('span', { class: 'av2' }, 'J'), h('div', {}, h('b', {}, 'Jean B.'), h('small', {}, '312 ' + T3(W.sw) + ' · ★ 4.9')), h('span', { class: 'vbadge' }, '✓ ' + T3(W.ver))), check('📱', W.ph), check('🪪', W.id), check('🎥', W.vd));
      const lkBig = lockIcon('big');
      const cLock = h('div', { class: 'wcard center' }, h('div', { class: 'amt' }, '200 ', h('small', {}, 'USDT')), lkBig, h('b', { class: 'cl1' }, T3(W.lk)), h('span', { class: 'mute2' }, T3(W.lk2)));
      const lkU = lockIcon('mid');
      const step = (txt) => h('div', { class: 'vrow2' }, h('b', { class: 'vok' }, '✓'), h('span', {}, T3(txt)));
      const cUn = h('div', { class: 'wcard' }, lkU, step(W.u1), step(W.u2), h('div', { class: 'vrow2 gold' }, h('b', { class: 'vok' }, '✓'), h('span', {}, T3(W.u3))));
      const tline = (txt, ic) => h('div', { class: 'vrow2' }, h('span', { class: 'vic' }, ic), h('span', {}, T3(txt)));
      const cTeam = h('div', { class: 'wcard' }, h('div', { class: 'scale' }, '⚖️'), tline(W.t0, '🔒'), tline(W.t1, '🧾'), tline(W.t2, '✅'));
      const clock = h('div', { class: 'clock' }, '0:00'); const cbar = h('i');
      const cFast = h('div', { class: 'wcard center' }, h('small', { class: 'mute2' }, T3(W.f0)), clock, h('div', { class: 'cbar' }, cbar), h('b', { class: 'cl1 fdone' }, '✓ ' + T3(W.f1)));
      const rows = [['Jean B.', '4.9', 312, '139.50', 'MonCash · NatCash'], ['Nadège', '4.8', 188, '140.00', 'MonCash · Bank'], ['Pierre L.', '4.7', 96, '140.80', 'NatCash'], ['Wilson', '4.9', 241, '141.20', 'MonCash']]
        .map(([n, r, c, p, pay], i) => h('div', { class: 'mrow' + (i === 0 ? ' best' : '') }, h('span', { class: 'av2 sm' }, n[0]), h('div', {}, h('b', {}, n), h('small', {}, '★ ' + r + ' · ' + c + ' ' + T3(W.sw) + ' · ' + pay)), h('div', { class: 'mp' }, h('b', {}, p), h('small', {}, 'HTG')), i === 0 ? h('em', {}, T3(W.best)) : null));
      const cPrice = h('div', { class: 'wcard list' }, rows);
      const cards = [cVer, cLock, cUn, cTeam, cFast, cPrice]; // scenes 3..8
      const newCol = h('div', { class: 'wy-new' }, h('div', { class: 'wtag good' }, T3(W.neu)), h('div', { class: 'wcards' }, cards));
      const title = h('div', { class: 'fover' }, h('div', { class: 'fo-in' }, h('div', { class: 'fo-logo' }, 'Ayiti P2P'), h('h3', {}, T3(W.title)), h('p', {}, T3(W.titleS))));
      const end = h('div', { class: 'fover' }, h('div', { class: 'fo-in' }, h('div', { class: 'fo-logo' }, 'Ayiti P2P'), h('h3', {}, T3(W.end)), h('p', {}, T3(W.endS)), h('button', { class: 'fo-btn', type: 'button', onclick: () => (document.getElementById('join') || document.querySelector('.logincard'))?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, T3(W.end) + ' →')));
      stage.append(h('div', { class: 'wy-grid' }, oldCol, newCol), title, end);

      return {
        layout() { const list = oldPh.querySelector('.wlist'); this.box = oldPh.querySelector('.wbody').clientHeight; this.bot = M.map((m) => m.offsetTop + m.offsetHeight); this.list = list; },
        frame(t, k) {
          const tall = stage.dataset.l === 'tall';
          if (!this.bot) this.layout();
          // titles
          setOp(title, 1 - at(t, 0, 2600, 3200)); setOp(end, at(t, 9, 0, 600));
          end.style.pointerEvents = k === 9 && t - 0 > 0 && at(t, 9, 0, 600) > 0.6 ? 'auto' : 'none';
          // chat messages
          const times = [[1, 300], [1, 1700], [2, 200], [2, 900], [2, 2000], [2, 2700], [2, 3500]];
          let shown = 0;
          M.forEach((m, i) => { const p = at(t, times[i][0], times[i][1], times[i][1] + 380); setOp(m, p); m.style.transform = `translateY(${(1 - p) * 10}px) scale(${0.96 + 0.04 * p})`; shown += p * (this.bot[i] - (i ? this.bot[i - 1] : 0)); });
          this.list.style.transform = `translateY(${-Math.max(0, shown - this.box + 14).toFixed(1)}px)`;
          const sp = at(t, 2, 4300, 4700); setOp(stamp, sp); stamp.style.transform = `translate(-50%,-50%) rotate(-12deg) scale(${1.6 - 0.6 * sp})`;
          // old vs new
          const sw = at(t, 3, 0, 800);
          const oldO = tall ? 1 - sw : 1 - 0.55 * sw;
          setOp(oldCol, oldO * (1 - at(t, 9, 0, 500) * 0.5)); tog(oldCol, 'dim', sw > 0.5);
          setOp(newCol, tall ? sw : 0.3 + 0.7 * sw);
          oldCol.style.pointerEvents = tall && sw > 0.5 ? 'none' : '';
          // cards: one per scene 3..8
          cards.forEach((c, i) => {
            const s = i + 3;
            const p = at(t, s, 150, 650) * (s === 8 ? 1 : 1 - at(t, s + 1, 0, 350));
            setOp(c, i === 0 && k < 3 ? (tall ? 0 : 1) : p);
            c.style.transform = `translateY(${(1 - p) * 14}px)`;
            c.style.visibility = (i === 0 && k < 3 && !tall) || p > 0.001 ? 'visible' : 'hidden';
          });
          // verify ticks
          cVer.querySelectorAll('.vrow2').forEach((r, i) => { const p = at(t, 3, 900 + i * 550, 1250 + i * 550); tog(r, 'ok', p > 0.5); r.querySelector('.vok').style.transform = `scale(${p})`; });
          setOp(cVer.querySelector('.vbadge'), at(t, 3, 2700, 3100));
          // lock first
          setLock(lkBig, at(t, 4, 900, 1500));
          // unlock only when money arrived
          const us = cUn.querySelectorAll('.vrow2');
          us.forEach((r, i) => { const p = at(t, 5, 500 + i * 800, 850 + i * 800); setOp(r, 0.25 + 0.75 * p); r.querySelector('.vok').style.transform = `scale(${p})`; });
          setLock(lkU, 1 - at(t, 5, 1900, 2300));
          // team
          cTeam.querySelectorAll('.vrow2').forEach((r, i) => { const p = at(t, 6, 500 + i * 600, 850 + i * 600); setOp(r, p); r.style.transform = `translateX(${(1 - p) * -12}px)`; });
          cTeam.querySelector('.scale').style.transform = `rotate(${Math.sin((t - 0) / 380) * 6 * (k === 6 ? 1 : 0)}deg)`;
          // fast clock: 0:00 -> 4:12
          const fp = at(t, 7, 300, 3000);
          const secs = Math.round(252 * fp);
          setText(clock, Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'));
          cbar.style.width = (fp * 100) + '%';
          setOp(cFast.querySelector('.fdone'), at(t, 7, 3000, 3400));
          // market rows
          rows.forEach((r, i) => { const p = at(t, 8, 300 + i * 260, 750 + i * 260); setOp(r, p); r.style.transform = `translateX(${(1 - p) * 24}px)`; });
          tog(rows[0], 'lit', at(t, 8, 1800, 2200) > 0.5);
        },
      };
    },
  };

  // ======================================================================
  // Film 2: How it works, step by step (seller 1,000 USDT -> ad 500 -> order 200)
  // ======================================================================
  const HOW = {
    cls: 'how',
    scenes: [
      { label: { en: 'Start', fr: 'Début', ht: 'Kòmanse' }, min: 3400, cap: { en: 'How Ayiti P2P works', fr: 'Comment fonctionne Ayiti P2P', ht: 'Kijan Ayiti P2P mache' } },
      { label: { en: 'Only crypto', fr: 'Que la crypto', ht: 'Kripto sèlman' }, min: 5200, cap: { en: 'We never hold your gourdes. We only lock the crypto during a swap.', fr: 'Nous ne gardons jamais vos gourdes. Nous verrouillons seulement la crypto pendant l\'échange.', ht: 'Nou pa janm kenbe goud ou. Nou kadnase kripto a sèlman pandan echanj lan.' } },
      { label: { en: 'Deposit', fr: 'Dépôt', ht: 'Depo' }, min: 5600, cap: { en: 'Step 1. The seller sends 1,000 USDT from their own crypto wallet into the platform\'s smart contract.', fr: 'Étape 1. Le vendeur envoie 1 000 USDT depuis son propre portefeuille crypto vers le contrat intelligent de la plateforme.', ht: 'Etap 1. Vandè a voye 1,000 USDT soti nan pòtfèy kripto pa li, sou kontra entèlijan platfòm nan.' } },
      { label: { en: 'Fixed rules', fr: 'Règles fixes', ht: 'Règ fiks' }, min: 5000, cap: { en: 'It is a program on the blockchain that follows fixed rules. The seller can still withdraw any time.', fr: 'C\'est un programme sur la blockchain qui suit des règles fixes. Le vendeur peut retirer à tout moment.', ht: 'Se yon pwogram sou blockchain lan ki swiv règ fiks. Vandè a ka retire l nenpòt lè.' } },
      { label: { en: 'Ad', fr: 'Annonce', ht: 'Piblisite' }, min: 4400, cap: { en: 'Step 2. The seller posts an ad: "I sell 500 USDT at 140 gourdes."', fr: 'Étape 2. Le vendeur publie une annonce : « Je vends 500 USDT à 140 gourdes. »', ht: 'Etap 2. Li mete yon piblisite: "M vann 500 USDT a 140 goud."' } },
      { label: { en: 'Ad lock', fr: 'Verrou annonce', ht: 'Kadna piblisite' }, min: 5000, cap: { en: 'We lock those 500 USDT right away, so no buyer ever pays for crypto that is not there.', fr: 'Nous verrouillons ces 500 USDT tout de suite : aucun acheteur ne paie pour de la crypto absente.', ht: 'Nou kadnase 500 USDT sa yo touswit, pou okenn achtè pa janm peye pou kripto ki pa la.' } },
      { label: { en: 'Order', fr: 'Commande', ht: 'Kòmand' }, min: 5400, cap: { en: 'Step 3. A buyer takes 200 USDT. We move those 200 into their own lock, just for this order.', fr: 'Étape 3. Un acheteur prend 200 USDT. Nous les plaçons dans un verrou à part, rien que pour cette commande.', ht: 'Etap 3. Yon achtè pran 200 USDT. Nou mete 200 sa yo nan yon kadna apa pou kòmand sa a.' } },
      { label: { en: '300 left', fr: '300 restent', ht: '300 rete' }, min: 5400, cap: { en: 'The ad keeps 300 for other buyers. The seller cannot touch the 200 while the order is open.', fr: 'L\'annonce garde 300 pour les autres. Le vendeur ne peut pas toucher aux 200 tant que la commande est ouverte.', ht: 'Piblisite a rete ak 300 pou lòt achtè. Vandè a pa ka manyen 200 yo pandan kòmand lan louvri.' } },
      { label: { en: 'Pay', fr: 'Payer', ht: 'Peye' }, min: 6000, cap: { en: 'Step 4. The buyer sends 28,000 gourdes by MonCash, straight to the seller. Gourdes never pass through the app.', fr: 'Étape 4. L\'acheteur envoie 28 000 gourdes par MonCash, directement au vendeur. Les gourdes ne passent jamais par l\'application.', ht: 'Etap 4. Achtè a voye 28,000 goud pa MonCash, dirèk bay vandè a. Goud yo pa janm pase nan aplikasyon an.' } },
      { label: { en: 'Confirm', fr: 'Confirmer', ht: 'Konfime' }, min: 6000, cap: { en: 'Step 5. The buyer taps "I sent the money". The seller checks MonCash and taps "I received it".', fr: 'Étape 5. L\'acheteur appuie sur « J\'ai envoyé ». Le vendeur vérifie son MonCash et appuie sur « Je l\'ai reçu ».', ht: 'Etap 5. Achtè a peze "Mwen voye lajan an". Vandè a tcheke MonCash li, epi li peze "Mwen resevwa l".' } },
      { label: { en: 'Unlock', fr: 'Libérer', ht: 'Dekadnase' }, min: 5600, cap: { en: 'We unlock the 200 USDT and they go to the buyer\'s account. They can keep them or withdraw to their own wallet.', fr: 'Nous libérons les 200 USDT vers le compte de l\'acheteur. Il peut les garder ou les retirer vers son portefeuille.', ht: 'Nou dekadnase 200 USDT yo, yo ale nan kont achtè a. Li ka kenbe yo, oswa retire yo nan pòtfèy pa li.' } },
      { label: { en: 'If cancelled', fr: 'Si annulé', ht: 'Si l anile' }, min: 5000, cap: { en: 'If the buyer cancels or does not pay in time, the 200 go back to the ad.', fr: 'Si l\'acheteur annule ou ne paie pas à temps, les 200 retournent dans l\'annonce.', ht: 'Si achtè a anile, oswa li pa peye atan, 200 yo tounen nan piblisite a.' } },
      { label: { en: 'If dispute', fr: 'Si litige', ht: 'Si diskisyon' }, min: 5200, cap: { en: 'If there is a dispute, our team looks at the proof and decides where the 200 go.', fr: 'En cas de litige, notre équipe examine les preuves et décide où vont les 200.', ht: 'Si gen diskisyon, ekip nou an gade prèv yo, epi li deside kote 200 yo ale.' } },
      { label: { en: 'Close ad', fr: 'Fermer', ht: 'Fèmen' }, min: 5000, cap: { en: 'When the seller closes the ad, whatever is left goes back to Available in their account.', fr: 'Quand le vendeur ferme l\'annonce, le reste redevient disponible sur son compte.', ht: 'Lè vandè a fèmen piblisite a, sa ki rete a tounen disponib nan kont li.' } },
      { label: { en: 'Done', fr: 'Fin', ht: 'Fini' }, min: 4200, cap: { en: 'Ayiti P2P. Swap USDT and gourdes, without the risk.', fr: 'Ayiti P2P. Échangez USDT et gourdes, sans risque.', ht: 'Ayiti P2P. Chanje USDT ak goud, san risk.' } },
    ],
    mount(stage, at, starts) {
      const W = {
        seller: { en: 'seller', fr: 'vendeur', ht: 'vandè' }, buyer: { en: 'buyer', fr: 'acheteuse', ht: 'achtè' },
        wal: { en: 'Own crypto wallet', fr: 'Son portefeuille crypto', ht: 'Pòtfèy kripto pa l' }, acct: { en: 'Ayiti P2P account', fr: 'Compte Ayiti P2P', ht: 'Kont Ayiti P2P' },
        c1: { en: 'Smart contract', fr: 'Contrat intelligent', ht: 'Kontra entèlijan' }, c2: { en: 'Jean\'s account', fr: 'Compte de Jean', ht: 'Kont Jean' },
        av: { en: 'Available', fr: 'Disponible', ht: 'Disponib' }, ad: { en: 'In the ad', fr: 'Dans l\'annonce', ht: 'Nan piblisite' }, ord: { en: 'Order with Rose', fr: 'Commande de Rose', ht: 'Kòmand Rose' },
        adT: { en: 'I sell 500 USDT · 140 HTG', fr: 'Je vends 500 USDT · 140 HTG', ht: 'M vann 500 USDT · 140 goud' },
        rule: { en: 'Fixed rules · withdraw Available any time', fr: 'Règles fixes · retrait du disponible à tout moment', ht: 'Règ fiks · retire Disponib nenpòt lè' },
        out: { en: 'Gourdes: phone to phone, outside the app', fr: 'Gourdes : de téléphone à téléphone, hors de l\'appli', ht: 'Goud: telefòn a telefòn, deyò aplikasyon an' },
        take: { en: 'Buy 200 USDT', fr: 'Acheter 200 USDT', ht: 'Achte 200 USDT' }, send: { en: 'Send 28,000 HTG', fr: 'Envoyer 28 000 HTG', ht: 'Voye 28,000 goud' },
        sent: { en: 'I sent the money', fr: 'J\'ai envoyé', ht: 'Mwen voye lajan an' }, got: { en: 'I received it', fr: 'Je l\'ai reçu', ht: 'Mwen resevwa l' },
        close: { en: 'Close ad', fr: 'Fermer l\'annonce', ht: 'Fèmen piblisite' },
        if1: { en: 'What if the buyer cancels?', fr: 'Et si l\'acheteur annule ?', ht: 'E si achtè a anile?' }, if2: { en: 'What if there is a dispute?', fr: 'Et en cas de litige ?', ht: 'E si gen diskisyon?' },
        team: { en: 'Team checks the proof', fr: 'L\'équipe vérifie les preuves', ht: 'Ekip la gade prèv yo' },
        title: { en: 'How it works', fr: 'Comment ça marche', ht: 'Kijan li mache' }, titleS: { en: 'Step by step, with real numbers', fr: 'Étape par étape, avec de vrais chiffres', ht: 'Etap pa etap, ak vrè chif' },
        end: { en: 'Swap USDT and gourdes, without the risk.', fr: 'Échangez USDT et gourdes, sans risque.', ht: 'Chanje USDT ak goud, san risk.' },
      };
      const val = (cls) => h('b', { class: 'v ' + (cls || '') });
      // people
      const jWalV = val(), jMcV = val(), rAccV = val(), rMcV = val();
      const jBtn = h('div', { class: 'pbtn' }), rBtn = h('div', { class: 'pbtn' });
      const chip = (lab, v, cls) => h('div', { class: 'pchip ' + cls }, h('small', {}, T3(lab)), v);
      const jWal = chip(W.wal, jWalV, 'usdt'), jMc = chip('MonCash', jMcV, 'mc'), rAcc = chip(W.acct, rAccV, 'usdt'), rMc = chip('MonCash', rMcV, 'mc');
      const person = (cls, ini, name, role, a, b, btn) => h('div', { class: 'hw-p ' + cls }, h('div', { class: 'phead' }, h('span', { class: 'av2' }, ini), h('div', {}, h('b', {}, name), h('small', {}, T3(role)))), a, b, btn);
      const jean = person('jean', 'J', 'Jean', W.seller, jWal, jMc, jBtn);
      const rose = person('rose', 'R', 'Rose', W.buyer, rAcc, rMc, rBtn);
      // contract with Jean's three buckets
      const bk = (lab, lockable) => { const v = val(); const lk = lockable ? lockIcon('sm') : null; const row = h('div', { class: 'bk' }, h('span', { class: 'bl' }, lk, T3(lab)), v); return { row, v, lk }; };
      const AV = bk(W.av, false), AD = bk(W.ad, true), OR = bk(W.ord, true);
      const adTag = h('div', { class: 'adtag' }, '📣 ' + T3(W.adT));
      const team = h('div', { class: 'teamtag' }, '⚖️ ' + T3(W.team), h('span', { class: 'tw' }, h('i', {}, '→ Rose'), h('i', {}, '→ ' + T3(W.ad))));
      const rule = h('div', { class: 'crule' }, '↩ ' + T3(W.rule));
      const cLock = lockIcon('sm');
      const contract = h('div', { class: 'hw-c' }, h('div', { class: 'chead' }, cLock, h('div', {}, h('b', {}, 'Ayiti P2P'), h('small', {}, T3(W.c1) + ' · ' + T3(W.c2)))), AV.row, AD.row, adTag, OR.row, team, rule);
      const outTag = h('div', { class: 'outtag' }, '📱 ' + T3(W.out));
      const ifTag = h('div', { class: 'iftag' });
      const usdt = h('div', { class: 'tok usdt' }), htg = h('div', { class: 'tok htg' });
      const title = h('div', { class: 'fover' }, h('div', { class: 'fo-in' }, h('div', { class: 'fo-logo' }, 'Ayiti P2P'), h('h3', {}, T3(W.title)), h('p', {}, T3(W.titleS))));
      const end = h('div', { class: 'fover' }, h('div', { class: 'fo-in' }, h('div', { class: 'fo-logo' }, 'Ayiti P2P'), h('h3', {}, T3(W.end))));
      stage.append(h('div', { class: 'hw-grid' }, jean, contract, rose), outTag, ifTag, usdt, htg, title, end);

      // money at the START of each scene (what-if scenes start from the open order)
      const S = (wal, av, ad, ord, ro, rh, jh) => ({ wal, av, ad, ord, ro, rh, jh });
      const START = [S(1000, 0, 0, 0, 0, 30000, 2500), S(1000, 0, 0, 0, 0, 30000, 2500), S(1000, 0, 0, 0, 0, 30000, 2500), S(0, 1000, 0, 0, 0, 30000, 2500),
        S(0, 1000, 0, 0, 0, 30000, 2500), S(0, 1000, 0, 0, 0, 30000, 2500), S(0, 500, 500, 0, 0, 30000, 2500), S(0, 500, 300, 200, 0, 30000, 2500),
        S(0, 500, 300, 200, 0, 30000, 2500), S(0, 500, 300, 200, 0, 2000, 30500), S(0, 500, 300, 200, 0, 2000, 30500),
        S(0, 500, 300, 200, 0, 30000, 2500), S(0, 500, 300, 200, 0, 2000, 30500), S(0, 500, 300, 0, 200, 2000, 30500), S(0, 800, 0, 0, 200, 2000, 30500)];
      // moves inside a scene: [from, to, amount, startMs, arriveMs, label]
      const MOVES = {
        1: [['rh', 'jh', 0, 600, 2100, 'HTG', 'htg']],
        2: [['wal', 'av', 1000, 500, 2000, '1,000 USDT']],
        5: [['av', 'ad', 500, 500, 1900, '500 USDT']],
        6: [['ad', 'ord', 200, 1300, 2600, '200 USDT']],
        8: [['rh', 'jh', 28000, 900, 2700, '28,000 HTG', 'htg']],
        10: [['ord', 'ro', 200, 500, 2000, '200 USDT']],
        11: [['ord', 'ad', 200, 900, 2300, '200 USDT']],
        13: [['ad', 'av', 300, 1000, 2400, '300 USDT']],
      };
      const HI = { 1: ['c'], 2: ['wal', 'av'], 3: ['av', 'rule'], 4: ['ad'], 5: ['av', 'ad'], 6: ['ad', 'ord', 'rose'], 7: ['ad', 'ord'], 8: ['rh', 'jh'], 9: ['rose', 'jean'], 10: ['ord', 'ro'], 11: ['ord', 'ad'], 12: ['ord'], 13: ['ad', 'av'], 14: [] };
      const EL = { wal: jWal, av: AV.row, ad: AD.row, ord: OR.row, ro: rAcc, rh: rMc, jh: jMc, rose, jean, c: contract, rule };
      const VAL = { wal: jWalV, av: AV.v, ad: AD.v, ord: OR.v, ro: rAccV, rh: rMcV, jh: jMcV };
      // buttons: scene -> [who, text, pressMs]
      const BTN = { 6: [['r', W.take, 700]], 8: [['r', W.send, 500]], 9: [['r', W.sent, 500], ['j', W.got, 2600]], 13: [['j', W.close, 500]] };
      let A = {};
      function layout() { A = {}; for (const k of Object.keys(VAL)) A[k] = centerOf(stage, VAL[k]); A.c = centerOf(stage, contract); }

      return {
        layout,
        frame(t, k) {
          if (!A.av) layout();
          const tall = stage.dataset.l === 'tall';
          setOp(title, 1 - at(t, 0, 2400, 3000)); setOp(end, at(t, 14, 300, 900));
          // money
          const st = { ...START[k] };
          let tokU = 0, tokH = 0;
          for (const [from, to, amt, a, b, label, kind] of MOVES[k] || []) {
            st[from] -= amt * at(t, k, a, a + 400);
            st[to] += amt * at(t, k, b - 150, b + 450);
            const p = at(t, k, a, b);
            const o = Math.min(at(t, k, a - 250, a + 50), 1 - at(t, k, b + 100, b + 450));
            const tok = kind === 'htg' ? htg : usdt;
            const P0 = A[from], P1 = A[to];
            let C = null;
            if (kind === 'htg') C = tall ? { x: stage.clientWidth - 14, y: (P0.y + P1.y) / 2 } : { x: (P0.x + P1.x) / 2, y: stage.clientHeight + 30 };
            place(tok, curve(P0, P1, p, tall ? 0 : 50, C), 1 + 0.12 * Math.sin(Math.PI * p));
            setText(tok, label); setOp(tok, o);
            if (kind === 'htg') tokH = 1; else tokU = 1;
          }
          if (!tokU) setOp(usdt, 0); if (!tokH) setOp(htg, 0);
          setText(jWalV, num(st.wal) + ' USDT'); setText(AV.v, num(st.av)); setText(AD.v, num(st.ad)); setText(OR.v, num(st.ord));
          setText(rAccV, num(st.ro) + ' USDT'); setText(rMcV, num(st.rh) + ' HTG'); setText(jMcV, num(st.jh) + ' HTG');
          setLock(AD.lk, clamp01(st.ad / 40)); setLock(OR.lk, clamp01(st.ord / 40)); setLock(cLock, 1);
          tog(AD.row, 'empty', st.ad < 0.5); tog(OR.row, 'empty', st.ord < 0.5);
          // highlights
          const hi = HI[k] || [];
          for (const [key, el] of Object.entries(EL)) tog(el, 'hi', hi.includes(key));
          // ad tag, rule, team, tags
          const adOn = k >= 4 && k <= 13 ? (k === 4 ? at(t, 4, 300, 800) : k === 13 ? 1 - at(t, 13, 600, 1000) : 1) : 0;
          setOp(adTag, adOn); adTag.style.transform = `scale(${0.92 + 0.08 * adOn})`;
          setOp(rule, k === 3 ? at(t, 3, 300, 700) : k > 3 && k < 14 ? 0.55 : 0);
          setOp(team, k === 12 ? at(t, 12, 500, 900) : 0);
          tog(team, 'a', k === 12 && Math.floor((t - starts[12]) / 900) % 2 === 1);
          setOp(outTag, k === 8 ? at(t, 8, 400, 800) * (1 - at(t, 8, 4800, 5200)) : k === 1 ? at(t, 1, 1600, 2000) : 0);
          const ifTxt = k === 11 ? W.if1 : k === 12 ? W.if2 : null;
          if (ifTxt) setText(ifTag, T3(ifTxt));
          setOp(ifTag, ifTxt ? at(t, k, 0, 400) : 0);
          tog(stage, 'whatif', !!ifTxt);
          // buttons
          for (const [who, el] of [['r', rBtn], ['j', jBtn]]) {
            const b = (BTN[k] || []).find((x) => x[0] === who);
            if (!b) { setOp(el, 0); continue; }
            setText(el, T3(b[1]));
            const u = t - starts[k];
            setOp(el, at(t, k, Math.max(0, b[2] - 500), b[2] - 100));
            const pr = clamp01((u - b[2]) / 260);
            el.style.transform = `scale(${1 - 0.07 * Math.sin(Math.PI * pr)})`;
            tog(el, 'done', u > b[2] + 120);
          }
          // a soft glow on the contract while something is locked
          tog(contract, 'locked', st.ad > 1 || st.ord > 1);
        },
      };
    },
  };

  window.filmWhy = () => player(WHY);
  window.filmHow = () => player(HOW);
})();
