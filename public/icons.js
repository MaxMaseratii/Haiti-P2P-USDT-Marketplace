/* Clean line icons instead of emojis (a money app should look calm and serious).
   icon('lock') gives an inline SVG. iconizeTree(node) swaps any emoji left in the text for the matching icon,
   or removes it when there is no good icon. i18n-app.js runs it on every screen, after translating. */
(() => {
  const P = {
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M5.8 16c.9-1.7 5.5-1.7 6.4 0M14 10h4M14 14h3"/>',
    scale: '<path d="M12 3v17M7 20h10M4 7h16"/><path d="M6 7l-3 6.5a3 3 0 0 0 6 0zM18 7l-3 6.5a3 3 0 0 0 6 0z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.6"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="M8.6 14L7 22l5-3 5 3-1.6-8"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.2l2.8 2.8L16 9.4"/>',
    receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>',
    megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h3l7 4V5L7 9H4a1 1 0 0 0-1 1zM18 8.5a5 5 0 0 1 0 7"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
    home: '<path d="M3 11l9-8 9 8M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
    building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    bank: '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><path d="M4 4l16 16"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1.2-3.5 3.7-5 6.5-5s5.3 1.5 6.5 5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.2c2.4.2 4.2 1.8 5 4.8"/>',
    doc: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
    pin: '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    clip: '<path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7-7L13.8 4a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    car: '<path d="M5 16v-5l2-5h10l2 5v5M3 16h18v3H3zM7 19v2M17 19v2"/>',
    logout: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11"/>',
    bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12v1.5M15 12v1.5M9 16h6"/>',
    chat: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13h5"/>',
    headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-2 2.5-5 2.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    pencil: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/>',
    'arrow-r': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'arrow-l': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    'arrow-u': '<path d="M12 19V5M6 11l6-6 6 6"/>',
    undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.7-2.7-3-6-3"/>',
    swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
    play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    'arrow-d': '<path d="M12 5v14M6 13l6 6 6-6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M4 17v3h16v-3"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-1 1.2-2.1 1.3-2.1 3M12 17.5h.01"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    live: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>',
  };
  const svg = (n) => n === 'flag-ht'
    ? '<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="10" fill="#00209F"/><rect y="10" width="30" height="10" fill="#D21034"/><rect x="11.5" y="7" width="7" height="6" rx="1" fill="#fff"/><rect x="13.5" y="8.6" width="3" height="2.8" fill="#016a16"/></svg>'
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  window.icon = (n, cls) => { const s = document.createElement('span'); s.className = 'ic ic-' + n + (cls ? ' ' + cls : ''); s.innerHTML = svg(n); return s; };

  const MAP = { '🔒': 'lock', '🔐': 'lock', '🪪': 'id', '🛂': 'id', '⚖': 'scale', '🛡': 'shield', '🎥': 'video', '📷': 'camera', '📸': 'camera', '🏆': 'award',
    '🖼': 'image', '⏱': 'clock', '⏳': 'clock', '⭐': 'star', '⚡': 'bolt', '💸': 'send', '✅': 'check', '🧾': 'receipt', '🚫': 'ban', '⛔': 'ban', '🌎': 'globe',
    '🌐': 'globe', '📣': 'megaphone', '📱': 'phone', '🏠': 'home', '🏢': 'building', '🏦': 'bank', '👁': 'eye', '🙈': 'eyeoff', '👛': 'wallet', '👤': 'user',
    '🧑': 'user', '📄': 'doc', '📅': 'calendar', '📈': 'chart', '📍': 'pin', '📎': 'clip', '🔗': 'link', '🚗': 'car', '🚪': 'logout', '🤖': 'bot', '⚙': 'gear',
    '⚠': 'warn', '✏': 'pencil', '➜': 'arrow-r', '➡': 'arrow-r', '⬅': 'arrow-l', '⬆': 'arrow-u', '↩': 'undo', '💬': 'chat', '🇭🇹': 'flag-ht', '▶': 'play', '✔': 'check' };
  const RE = /([\u{1F1E6}-\u{1F1FF}]{2}|(?![©®™])\p{Extended_Pictographic})️?/gu;
  const NO_EL = new Set(['OPTION', 'TEXTAREA', 'TITLE', 'SCRIPT', 'STYLE']);
  function fix(n) {
    const v = n.nodeValue; RE.lastIndex = 0;
    if (!v || !RE.test(v)) return;
    const p = n.parentNode; if (!p) return;
    if (NO_EL.has(p.nodeName)) { n.nodeValue = v.replace(RE, '').replace(/^\s+/, ''); return; }
    const frag = document.createDocumentFragment(); let last = 0; RE.lastIndex = 0; let m;
    while ((m = RE.exec(v))) {
      if (m.index > last) frag.append(v.slice(last, m.index));
      const name = MAP[m[1]];
      if (name) frag.append(window.icon(name));
      last = m.index + m[0].length;
      if (!name && v[last] === ' ' && (m.index === 0 || v[m.index - 1] === ' ')) last++; // dropped emoji: no double space
    }
    if (last < v.length) frag.append(v.slice(last));
    p.replaceChild(frag, n);
  }
  window.iconizeTree = (root) => {
    if (!root) return;
    if (root.nodeType === 3) return fix(root);
    if (root.nodeType !== 1 || root.matches('script,style,svg')) return;
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
    let n; while ((n = it.nextNode())) list.push(n);
    list.forEach(fix);
  };
})();
