/* Ludo: board rendering, input, turn flow, sound, save/resume, PWA glue.
 * All game rules live in engine.js. */
(function () {
  'use strict';

  const E = window.LudoEngine;
  const NS = 'http://www.w3.org/2000/svg';

  const COLORS = [
    { main: '#d93a40', tint: '#f4b6b8', dark: '#8f1f25' },   // Red
    { main: '#2e9d5a', tint: '#aedcbf', dark: '#175c34' },   // Green
    { main: '#f2b705', tint: '#fbe295', dark: '#8f6d00' },   // Yellow
    { main: '#2f6fdd', tint: '#b1c8f4', dark: '#173f8f' }    // Blue
  ];
  const ROT = [0, 90, 180, 270];   // each seat's dice and label face the player sitting on that side
  const SAVE_KEY = 'ludo.save.v1';
  const PREF_KEY = 'ludo.prefs.v1';
  const PIPS = [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0], [0, 0], [0.42, 0], [-0.42, 0.42], [0.42, 0.42]];
  const PIP_SETS = { 1: [3], 2: [0, 6], 3: [0, 3, 6], 4: [0, 1, 5, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 4, 5, 6] };

  const $ = (s) => document.querySelector(s);
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function svg(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ---------- Storage (always guarded: it can be empty or blocked) ---------- */
  const store = {
    get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } },
    del(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  };
  const prefs = Object.assign({ sound: true, level: 'medium', hintDismissed: false, people: 1, computers: 1 }, store.get(PREF_KEY) || {});
if (['easy', 'medium', 'hard'].indexOf(prefs.level) === -1) prefs.level = 'medium';   // revision 1 stored 'normal'
const LEVELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard', normal: 'Hard' };
  function savePrefs() { store.set(PREF_KEY, prefs); }

  /* ---------- Sound (synthesised, no files) ---------- */
  const Snd = (function () {
    let ctx = null;
    function init() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { ctx = new AC(); } catch (e) { ctx = null; return; }
      }
      if (ctx.state === 'suspended') ctx.resume();
    }
    function tone(freq, start, dur, type, vol, slideTo) {
      if (!ctx || !prefs.sound) return;
      const t = ctx.currentTime + start, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.03);
    }
    function noise(start, dur, vol, freq) {
      if (!ctx || !prefs.sound) return;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2; g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(ctx.destination);
      src.start(ctx.currentTime + start);
    }
    return {
      init,
      dice() { for (let i = 0; i < 7; i++) noise(i * 0.075 + Math.random() * 0.02, 0.06, 0.45, 1300 + Math.random() * 2000); },
      hop() { tone(480 + Math.random() * 70, 0, 0.08, 'triangle', 0.2, 720); },
      tick() { tone(900, 0, 0.05, 'sine', 0.1); },
      capture() { tone(380, 0, 0.36, 'sawtooth', 0.12, 70); },
      home() { [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.24, 'triangle', 0.16)); },
      win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.32, 'triangle', 0.16)); },
      bad() { tone(230, 0, 0.26, 'square', 0.07, 140); },
      good() { [392, 494, 587].forEach((f, i) => tone(f, i * 0.16, 0.34, 'sine', 0.13)); }
    };
  })();

  /* ---------- Game session state ---------- */
  let G = null;              // engine state
  let run = 0;               // bumped whenever a game starts or is abandoned; stale loops stop
  let pending = null;        // input the loop is waiting for
  let sel = null;            // token chosen but not yet confirmed
  let paused = false;
  let pauseWaiters = [];
  const flashes = {};
  let dice = {}, toks = {};

  const board = $('#board');
  let gDest, gDice, gTokens;
  const baseEls = [];

  const humansOf = (g) => g.seats.filter((x) => g.cpu.indexOf(x) === -1);
  const soloHuman = () => humansOf(G).length === 1;
  // With one person everything faces them; with several, each seat faces the side of the table it sits on.
  const seatRot = (seat) => (humansOf(G).length > 1 ? ROT[seat] : 0);
  function seatLabel(seat) {        // short text inside the seat's base
    if (E.isCpu(G, seat)) return 'Computer';
    return soloHuman() ? 'You' : E.NAMES[seat];
  }
  function seatFull(seat) {         // used in lists
    if (E.isCpu(G, seat)) return G.cpu.length === 1 ? 'Computer' : E.NAMES[seat] + ' (computer)';
    return soloHuman() ? 'You' : E.NAMES[seat];
  }
  const normLevel = (l) => (l === 'normal' ? 'hard' : l);

  /* ---------- Timing ---------- */
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  async function sleep(ms) {
    await delay(reduceMotion ? Math.min(ms, 120) : ms);
    while (paused) await new Promise((r) => pauseWaiters.push(r));
  }
  function setPaused(v) {
    paused = v;
    if (!v) { const w = pauseWaiters; pauseWaiters = []; w.forEach((r) => r()); }
  }

  /* ---------- Board drawing ---------- */
  function starPoints(cx, cy, ro, ri) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : ro;
      pts.push((cx + r * Math.cos(a)).toFixed(3) + ',' + (cy + r * Math.sin(a)).toFixed(3));
    }
    return pts.join(' ');
  }

  function buildBoard() {
    board.textContent = '';
    svg('rect', { x: -0.25, y: -0.25, width: 15.5, height: 15.5, rx: 0.7, class: 'board-face' }, board);
    const st = svg('g', {}, board);
    const corners = [[0, 9], [0, 0], [9, 0], [9, 9]];
    for (let seat = 0; seat < 4; seat++) {
      const g = svg('g', { class: 'base', 'data-seat': seat }, st), c = COLORS[seat];
      svg('rect', { x: corners[seat][0], y: corners[seat][1], width: 6, height: 6, rx: 0.55, fill: c.main }, g);
      svg('rect', { x: corners[seat][0] + 0.6, y: corners[seat][1] + 0.6, width: 4.8, height: 4.8, rx: 0.4, class: 'base-inner' }, g);
      for (let t = 0; t < 4; t++) {
        const p = E.position(seat, -1, t);
        svg('circle', { cx: p[0], cy: p[1], r: 0.5, fill: c.tint }, g);
      }
      baseEls[seat] = g;
    }
    const startOf = {};
    E.START.forEach((idx, seat) => { startOf[idx] = seat; });
    E.TRACK.forEach((t, i) => {
      const isStart = startOf[i] !== undefined;
      svg('rect', {
        x: t[0] + 0.04, y: t[1] + 0.04, width: 0.92, height: 0.92, rx: 0.12, class: 'cell',
        style: isStart ? 'fill:' + COLORS[startOf[i]].main : ''
      }, st);
      if (E.SAFE[i]) svg('polygon', { points: starPoints(t[0] + 0.5, t[1] + 0.5, 0.34, 0.15), class: 'star' + (isStart ? ' on-color' : '') }, st);
    });
    E.LANE.forEach((lane, seat) => {
      lane.forEach((t) => svg('rect', { x: t[0] + 0.04, y: t[1] + 0.04, width: 0.92, height: 0.92, rx: 0.12, class: 'cell', style: 'fill:' + COLORS[seat].tint }, st));
    });
    const tri = [
      [[6, 9], [9, 9], [7.5, 7.5]],   // Red, bottom
      [[6, 6], [6, 9], [7.5, 7.5]],   // Green, left
      [[6, 6], [9, 6], [7.5, 7.5]],   // Yellow, top
      [[9, 6], [9, 9], [7.5, 7.5]]    // Blue, right
    ];
    tri.forEach((pts, seat) => svg('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: COLORS[seat].main, class: 'center-tri' }, st));
    gDest = svg('g', {}, board);
    gDice = svg('g', {}, board);
    gTokens = svg('g', {}, board);
  }

  function buildPieces() {
    gDice.textContent = '';
    gTokens.textContent = '';
    gDest.textContent = '';
    dice = {}; toks = {};
    for (let seat = 0; seat < 4; seat++) baseEls[seat].classList.toggle('off', G.seats.indexOf(seat) === -1);

    G.seats.forEach((seat) => {
      const bc = E.BASE_CENTRE[seat], c = COLORS[seat];
      const g = svg('g', { class: 'die idle', 'data-seat': seat, role: 'button', 'aria-label': 'Roll the dice' }, gDice);
      const rot = svg('g', { transform: 'translate(' + bc[0] + ' ' + bc[1] + ') rotate(' + seatRot(seat) + ')' }, g);
      svg('rect', { x: -1.15, y: -1.15, width: 2.3, height: 2.3, fill: 'transparent' }, rot);
      svg('rect', { class: 'glow', x: -0.9, y: -0.9, width: 1.8, height: 1.8, rx: 0.4, stroke: c.dark }, rot);
      const face = svg('g', { class: 'face' }, rot);
      svg('rect', { class: 'face-bg', x: -0.8, y: -0.8, width: 1.6, height: 1.6, rx: 0.3, stroke: c.dark }, face);
      const pips = PIPS.map((p) => svg('circle', { class: 'pip', cx: p[0], cy: p[1], r: 0.13, display: 'none' }, face));
      const label = svg('text', { class: 'label', x: 0, y: 2.32 }, rot);
      g.addEventListener('click', onDieClick);
      dice[seat] = { g, face, pips, label };

      toks[seat] = [];
      for (let i = 0; i < 4; i++) {
        const t = svg('g', { class: 'token', 'data-seat': seat, 'data-idx': i }, gTokens);
        svg('ellipse', { class: 'shadow', cx: 0.03, cy: 0.1, rx: 0.4, ry: 0.34 }, t);
        svg('circle', { class: 'ring-dark', r: 0.56 }, t);
        svg('circle', { class: 'ring-light', r: 0.56 }, t);
        svg('circle', { class: 'body', r: 0.4, fill: c.main, stroke: c.dark }, t);
        svg('ellipse', { class: 'shine', cx: -0.12, cy: -0.14, rx: 0.16, ry: 0.1 }, t);
        svg('circle', { r: 0.72, fill: 'transparent' }, t);
        t.addEventListener('click', onTokenClick);
        toks[seat][i] = { g: t, x: 0, y: 0, s: 1 };
      }
    });
  }

  function setTok(t, x, y, s) {
    t.x = x; t.y = y; t.s = s;
    t.g.setAttribute('transform', 'translate(' + x.toFixed(3) + ' ' + y.toFixed(3) + ') scale(' + s.toFixed(3) + ')');
  }

  function stackOffset(n, idx) {
    if (n === 1) return [0, 0];
    if (n === 2) return [idx ? 0.2 : -0.2, 0];
    if (n === 3) return [[-0.2, -0.14], [0.2, -0.14], [0, 0.2]][idx];
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    return [((idx % cols) - (cols - 1) / 2) * 0.34, (Math.floor(idx / cols) - (rows - 1) / 2) * 0.34];
  }

  function layoutTokens() {
    const groups = {};
    G.seats.forEach((seat) => G.tokens[seat].forEach((p, i) => {
      const pos = E.position(seat, p, i);
      const key = (p === E.BASE || p === E.FINISH) ? 'u' + seat + '-' + i : pos[0].toFixed(2) + ',' + pos[1].toFixed(2);
      (groups[key] = groups[key] || []).push({ seat, i, pos, p });
    }));
    Object.keys(groups).forEach((k) => {
      const arr = groups[k], n = arr.length;
      arr.forEach((it, idx) => {
        const off = stackOffset(n, idx);
        const sc = it.p === E.FINISH ? 0.72 : (n === 1 ? 1 : n === 2 ? 0.82 : 0.68);
        setTok(toks[it.seat][it.i], it.pos[0] + off[0], it.pos[1] + off[1], sc);
      });
    });
  }

  /* ---------- Dice ---------- */
  function setDie(seat, value) {
    const d = dice[seat];
    if (!d) return;
    // Before the first roll the face shows faint placeholder pips so it never looks empty
    const on = PIP_SETS[value || 6];
    d.pips.forEach((p, i) => {
      p.setAttribute('display', on.indexOf(i) !== -1 ? 'inline' : 'none');
      p.setAttribute('opacity', value ? '1' : '0.2');
    });
  }
  function setReady(seat, ready) {
    if (dice[seat]) { dice[seat].g.classList.toggle('ready', !!ready); dice[seat].g.setAttribute('tabindex', ready ? '0' : '-1'); }
  }

  async function rollAnim(seat, value) {
    const d = dice[seat];
    Snd.dice();
    d.face.classList.add('rolling');
    const n = reduceMotion ? 2 : 8;
    for (let i = 0; i < n; i++) { setDie(seat, 1 + Math.floor(Math.random() * 6)); await sleep(70); }
    d.face.classList.remove('rolling');
    setDie(seat, value);
  }

  /* ---------- Labels ---------- */
  function labelFor(seat) {
    if (flashes[seat]) return flashes[seat];
    if (G.phase === 'over') return G.winner === seat ? 'Winner' : seatLabel(seat);
    if (G.turn !== seat) return seatLabel(seat);
    if (E.isCpu(G, seat)) return 'Thinking';
    if (G.phase === 'opening') return 'Roll for a 6';
    if (G.phase === 'roll') return 'Tap to roll';
    return E.legalMoves(G).length > 1 ? 'Pick a token' : 'Moving';
  }
  function flash(seat, text, ms) {
    flashes[seat] = text;
    refreshAll();
    setTimeout(() => { if (flashes[seat] === text) { delete flashes[seat]; if (G) refreshAll(); } }, ms);
  }
  function refreshAll() {
    if (!G) return;
    G.seats.forEach((seat) => {
      const d = dice[seat];
      if (!d) return;
      d.label.textContent = labelFor(seat);
      d.g.classList.toggle('idle', G.turn !== seat || G.phase === 'over');
      if (!(d.face.classList.contains('rolling'))) setDie(seat, G.shown[seat]);
    });
  }

  /* ---------- Selection and destination marker ---------- */
  function clearMovable() { document.querySelectorAll('.token.movable').forEach((n) => n.classList.remove('movable')); }
  function markMovable(list) {
    clearMovable();
    const seat = G.turn, progs = list.map((i) => G.tokens[seat][i]);
    G.tokens[seat].forEach((p, i) => {
      if (progs.indexOf(p) === -1) return;
      if (p === E.BASE && list.indexOf(i) === -1) return;   // identical base tokens: highlight just one
      toks[seat][i].g.classList.add('movable');
    });
  }
  function hideDest() { gDest.textContent = ''; }
  function showDest(rep) {
    hideDest();
    const seat = G.turn, info = E.preview(G, rep), pos = E.position(seat, info.to, rep);
    const m = svg('circle', { class: 'dest' + (info.captures.length ? ' capture' : ''), cx: pos[0], cy: pos[1], r: 0.56 }, gDest);
    m.addEventListener('click', (e) => { e.stopPropagation(); if (sel !== null) confirmSelection(); });
  }
  function select(rep) { sel = rep; showDest(rep); Snd.tick(); }
  function confirmSelection() {
    if (!pending || pending.kind !== 'token' || sel === null) return;
    const p = pending, rep = sel;
    pending = null; sel = null;
    p.res(rep);
  }

  function onTokenClick(e) {
    e.stopPropagation();
    Snd.init();
    if (!pending || pending.kind !== 'token') return;
    const g = e.currentTarget, seat = +g.getAttribute('data-seat'), i = +g.getAttribute('data-idx');
    if (seat !== G.turn) return;
    const prog = G.tokens[seat][i];
    const rep = pending.legal.find((k) => G.tokens[seat][k] === prog);
    if (rep === undefined) return;
    if (sel === rep) confirmSelection(); else select(rep);
  }
  function onDieClick(e) {
    Snd.init();
    const seat = +e.currentTarget.getAttribute('data-seat');
    if (pending && pending.kind === 'dice' && pending.seat === seat) {
      const p = pending; pending = null;
      setReady(seat, false);
      p.res();
    }
  }
  board.addEventListener('click', () => { if (sel !== null && pending) { sel = null; hideDest(); } });

  /* ---------- Animation ---------- */
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  function tweenSegment(t, a, b, ms, hop, s0, s1) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      (function frame(now) {
        const k = Math.min(1, (now - t0) / ms), e = ease(k);
        setTok(t, a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, (s0 + (s1 - s0) * e) * (1 + hop * Math.sin(Math.PI * k)));
        if (k < 1) requestAnimationFrame(frame); else resolve();
      })(t0);
    });
  }
  async function animateMove(seat, idx, from, to) {
    const t = toks[seat][idx];
    gTokens.appendChild(t.g);
    const pts = [[t.x, t.y]];
    if (from === E.BASE) pts.push(E.position(seat, 0, idx));
    else for (let p = from + 1; p <= to; p++) pts.push(E.position(seat, p, idx));
    const step = reduceMotion ? 40 : 150;
    let s = t.s;
    for (let i = 1; i < pts.length; i++) {
      await tweenSegment(t, pts[i - 1], pts[i], step, 0.28, s, 1);
      s = 1;
      Snd.hop();
    }
  }
  async function flyBack(seat, idx) {
    const t = toks[seat][idx];
    gTokens.appendChild(t.g);
    await tweenSegment(t, [t.x, t.y], E.position(seat, E.BASE, idx), reduceMotion ? 60 : 420, 0.4, t.s, 1);
  }

  /* ---------- Turn flow ---------- */
  function persist() {
    if (!G) return;
    if (G.phase === 'over') store.del(SAVE_KEY);
    else store.set(SAVE_KEY, { G });
  }
  const waitDice = (seat) => new Promise((res) => { pending = { kind: 'dice', seat, res }; setReady(seat, true); });
  const waitToken = (legal) => new Promise((res) => { pending = { kind: 'token', legal, res }; });

  async function doRoll(my) {
    const seat = G.turn, value = E.rollDie();
    setReady(seat, false);
    await rollAnim(seat, value);
    if (my !== run) return;
    const ev = E.applyRoll(G, value);
    persist();
    let slow = false;
    ev.forEach((e) => {
      if (e.type === 'opening-winner') flash(seat, 'Goes first', 1400);
      if (e.type === 'triple-six') { flash(seat, 'Three 6s', 1300); Snd.bad(); slow = true; }
      if (e.type === 'no-move') { flash(seat, 'No move', 1100); slow = true; }
    });
    await sleep(slow ? 950 : 320);
    refreshAll();
  }

  async function doMove(my, idx) {
    hideDest(); clearMovable(); sel = null;
    const seat = G.turn;
    const ev = E.applyMove(G, idx);
    persist();
    const mv = ev[0];
    await animateMove(seat, mv.token, mv.from, mv.to);
    if (my !== run) return;
    const caps = ev.filter((e) => e.type === 'capture');
    if (caps.length) {
      Snd.capture();
      await Promise.all(caps.map((c) => flyBack(c.victim, c.token)));
      if (my !== run) return;
    }
    if (ev.some((e) => e.type === 'home')) Snd.home();
    layoutTokens();
    refreshAll();
    if (!ev.some((e) => e.type === 'win')) await sleep(160);
  }

  async function loop(my) {
    try {
      while (my === run) {
        if (G.phase === 'over') { showWin(); return; }
        persist();
        refreshAll();
        const seat = G.turn, cpu = E.isCpu(G, seat);
        if (G.phase === 'opening' || G.phase === 'roll') {
          if (cpu) { await sleep(650); } else { await waitDice(seat); }
          if (my !== run) return;
          await doRoll(my);
        } else {
          const legal = E.legalMoves(G);
          let pick;
          if (cpu) {
            await sleep(450);
            if (my !== run) return;
            pick = E.chooseMove(G);
            showDest(pick);
            await sleep(450);
          } else if (legal.length === 1) {
            markMovable(legal);
            showDest(legal[0]);
            await sleep(520);
            pick = legal[0];
          } else {
            markMovable(legal);
            pick = await waitToken(legal);
          }
          if (my !== run) return;
          await doMove(my, pick);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  function startGame(state) {
    run++;
    pending = null; sel = null;
    Object.keys(flashes).forEach((k) => delete flashes[k]);
    G = state;
    hide($('#setup')); hide($('#win')); hide($('#menu')); hide($('#rules')); hide($('#stats')); hide($('#confirm'));
    window.LudoFX.stop();
    setPaused(false);
    buildPieces();
    layoutTokens();
    refreshAll();
    persist();
    loop(run);
  }
  const sameAgain = () => startGame(E.newGame(G.seats, G.cpu, { level: normLevel(G.level) }));

  function tokensHome(seat) { return G.tokens[seat].filter((p) => p === E.FINISH).length; }
  function trophySvg(color) {
    return '<svg viewBox="0 0 100 100"><g class="bob">' +
      '<path d="M28 14h44v22c0 14-10 24-22 24S28 50 28 36z" fill="#ffc83d" stroke="#b98800" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M28 20H14c0 16 6 24 16 26M72 20h14c0 16-6 24-16 26" fill="none" stroke="#b98800" stroke-width="4" stroke-linecap="round"/>' +
      '<rect x="44" y="60" width="12" height="14" fill="#e6a800" stroke="#b98800" stroke-width="3"/>' +
      '<rect x="32" y="74" width="36" height="12" rx="4" fill="#ffc83d" stroke="#b98800" stroke-width="3"/>' +
      '<circle cx="50" cy="34" r="9" fill="' + color + '" stroke="#ffffff" stroke-width="3"/></g></svg>';
  }
  const STAR_SVG = '<svg viewBox="0 0 100 100"><g class="bob"><path d="M50 10l11 25 27 3-20 19 6 27-24-14-24 14 6-27-20-19 27-3z" fill="#ffe08a" stroke="#d9a400" stroke-width="3" stroke-linejoin="round"/></g>' +
    '<path d="M16 20v10M11 25h10M86 62v10M81 67h10" stroke="#d9a400" stroke-width="3" stroke-linecap="round"/></svg>';

  function showWin() {
    const my = run, w = G.winner, cpuWon = E.isCpu(G, w), solo = soloHuman();
    $('#win-title').textContent = cpuWon ? 'Good game' : solo ? 'You win!' : E.NAMES[w] + ' wins!';
    $('#win-sub').textContent = cpuWon
      ? (G.cpu.length === 1 ? 'The computer takes this one.' : E.NAMES[w] + ', a computer player, takes this one.')
      : solo ? 'Nicely played.' : 'Well played, everyone.';
    $('#win-art').innerHTML = cpuWon ? STAR_SVG : trophySvg(COLORS[w].main);
    $('#w-again').textContent = cpuWon ? 'Rematch' : 'Play again';
    let rot = cpuWon ? 0 : seatRot(w);
    if ((rot === 90 || rot === 270) && Math.min(window.innerWidth, window.innerHeight) < 600) rot = 0;   // too small to turn sideways
    $('#win-card').style.setProperty('--rot', rot + 'deg');

    const list = $('#win-list');
    list.textContent = '';
    G.seats.slice().sort((a, b) => (b === w) - (a === w) || tokensHome(b) - tokensHome(a)).forEach((seat) => {
      const li = document.createElement('li');
      if (seat === w) li.className = 'first';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = COLORS[seat].main;
      const name = document.createElement('span'); name.textContent = seatFull(seat);
      const right = document.createElement('span'); right.className = 'right'; right.textContent = tokensHome(seat) + ' of 4 home';
      li.appendChild(dot); li.appendChild(name); li.appendChild(right);
      list.appendChild(li);
    });
    refreshAll();
    setTimeout(() => {
      if (my !== run) return;
      show($('#win'));
      if (cpuWon) { Snd.good(); window.LudoFX.consolation(); }
      else { Snd.win(); window.LudoFX.celebrate([COLORS[w].main, COLORS[w].tint]); }
    }, reduceMotion ? 0 : 900);
  }

  /* ---------- Dice stats ---------- */
  function renderStats() {
    const body = $('#stats-body');
    body.textContent = '';
    G.seats.forEach((seat) => {
      const counts = (G.rolls && G.rolls[seat]) || [0, 0, 0, 0, 0, 0];
      const total = counts.reduce((a, b) => a + b, 0);
      const avg = total ? counts.reduce((a, c, i) => a + c * (i + 1), 0) / total : 0;
      const max = Math.max(1, ...counts);
      const block = document.createElement('div'); block.className = 'stat-block';
      const head = document.createElement('div'); head.className = 'stat-head';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = COLORS[seat].main;
      const nm = document.createElement('span'); nm.textContent = seatFull(seat);
      const meta = document.createElement('span'); meta.className = 'meta';
      meta.textContent = total + (total === 1 ? ' roll' : ' rolls') + (total ? ', average ' + avg.toFixed(1) : '');
      head.appendChild(dot); head.appendChild(nm); head.appendChild(meta);
      const bars = document.createElement('div'); bars.className = 'bars';
      counts.forEach((c) => {
        const bar = document.createElement('div'); bar.className = 'bar';
        const num = document.createElement('b'); num.textContent = c;
        const fill = document.createElement('i'); fill.style.height = (c ? Math.max(6, 62 * c / max) : 0) + '%'; fill.style.background = COLORS[seat].main;
        bar.appendChild(num); bar.appendChild(fill); bars.appendChild(bar);
      });
      const faces = document.createElement('div'); faces.className = 'faces';
      for (let f = 1; f <= 6; f++) { const d = document.createElement('span'); d.textContent = f; faces.appendChild(d); }
      block.appendChild(head); block.appendChild(bars); block.appendChild(faces);
      body.appendChild(block);
    });
  }

  /* ---------- Sheets and dialogs ---------- */
  const show = (n) => { n.hidden = false; };
  const hide = (n) => { n.hidden = true; };
  function openSheet(id) {
    ['menu', 'rules', 'stats'].forEach((s) => hide($('#' + s)));
    show($('#' + id));
    if (G && G.phase !== 'over' && $('#setup').hidden) setPaused(true);
  }
  function closeSheet(id) {
    hide($('#' + id));
    if ($('#menu').hidden && $('#rules').hidden && $('#stats').hidden && $('#confirm').hidden) setPaused(false);
  }
  let confirmRes = null;
  function ask(title, text, okLabel, cancelLabel) {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#c-ok').textContent = okLabel;
    $('#c-cancel').textContent = cancelLabel || 'Keep playing';
    show($('#confirm'));
    return new Promise((res) => { confirmRes = res; });
  }
  function answer(v) { hide($('#confirm')); if (confirmRes) { const r = confirmRes; confirmRes = null; r(v); } }

  function showSetup() {
    run++;
    pending = null; sel = null;
    setPaused(false);
    hide($('#menu')); hide($('#rules')); hide($('#stats')); hide($('#confirm')); hide($('#win'));
    window.LudoFX.stop();
    renderResume();
    show($('#setup'));
  }

  /* ---------- Setup screen ---------- */
  const SIDES = ['bottom', 'left', 'top', 'right'];
  const cfg = { people: prefs.people, computers: prefs.computers };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function normalizeCfg() {
    cfg.people = clamp(Math.round(cfg.people) || 1, 1, 4);
    cfg.computers = clamp(Math.round(cfg.computers) || 0, Math.max(0, 2 - cfg.people), 4 - cfg.people);
  }
  // Changing one number nudges the other so the table always ends up with 2 to 4 players.
  function setPeople(p) { cfg.people = p; normalizeCfg(); }
  function setComputers(c) { cfg.computers = c; cfg.people = clamp(cfg.people, Math.max(1, 2 - c), 4 - c); normalizeCfg(); }
  const listJoin = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  function personIcon(x, y) {
    return '<circle cx="' + x + '" cy="' + (y - 4) + '" r="4" fill="#fff"/><path d="M' + (x - 7) + ' ' + (y + 9) + 'c0-6.500 3.200-9 7-9s7 2.500 7 9z" fill="#fff"/>';
  }
  function robotIcon(x, y, color) {
    return '<path d="M' + x + ' ' + (y - 7) + 'v-3" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="' + x + '" cy="' + (y - 11) + '" r="1.800" fill="#fff"/>' +
      '<rect x="' + (x - 8) + '" y="' + (y - 6) + '" width="16" height="13" rx="3.500" fill="#fff"/>' +
      '<circle cx="' + (x - 3.200) + '" cy="' + (y + 0.500) + '" r="1.900" fill="' + color + '"/><circle cx="' + (x + 3.200) + '" cy="' + (y + 0.500) + '" r="1.900" fill="' + color + '"/>';
  }
  function renderPicker() {
    normalizeCfg();
    document.querySelectorAll('#seg-people button').forEach((b) => b.setAttribute('aria-pressed', +b.getAttribute('data-n') === cfg.people ? 'true' : 'false'));
    document.querySelectorAll('#seg-cpu button').forEach((b) => b.setAttribute('aria-pressed', +b.getAttribute('data-n') === cfg.computers ? 'true' : 'false'));
    $('#level-row').hidden = cfg.computers === 0;

    const lay = E.layout(cfg.people, cfg.computers);
    const spots = [[80, 136], [24, 80], [80, 24], [136, 80]];    // bottom, left, top, right of the table
    let svgText = '<rect class="pv-table" x="42" y="42" width="76" height="76" rx="14"/>';
    for (let seat = 0; seat < 4; seat++) {
      const p = spots[seat];
      if (lay.seats.indexOf(seat) === -1) { svgText += '<circle class="pv-seat-off" cx="' + p[0] + '" cy="' + p[1] + '" r="18"/>'; continue; }
      svgText += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="19" fill="' + COLORS[seat].main + '"/>';
      svgText += lay.cpu.indexOf(seat) !== -1 ? robotIcon(p[0], p[1] + 1, COLORS[seat].main) : personIcon(p[0], p[1]);
    }
    $('#pv').innerHTML = svgText;
    $('#pv-title').textContent = plural(cfg.people, 'person', 'people') + (cfg.computers ? ' and ' + plural(cfg.computers, 'computer', 'computers') : '');
    const humanSeats = lay.seats.filter((x) => lay.cpu.indexOf(x) === -1);
    const where = (x) => E.NAMES[x] + ' (' + SIDES[x] + ')';
    $('#pv-cap').textContent = cfg.people === 1 ? 'You play ' + where(humanSeats[0]) + '.' : 'People sit at ' + listJoin(humanSeats.map(where)) + '.';
  }
  function startFromSetup() {
    normalizeCfg();
    prefs.people = cfg.people; prefs.computers = cfg.computers; savePrefs();
    const lay = E.layout(cfg.people, cfg.computers);
    startGame(E.newGame(lay.seats, lay.cpu, { level: prefs.level }));
  }

  function readSave() {
    const s = store.get(SAVE_KEY);
    if (!s || !s.G || s.G.v !== 1 || !Array.isArray(s.G.seats) || !Array.isArray(s.G.cpu) || s.G.phase === 'over') return null;
    return s;
  }
  function renderResume() {
    const s = readSave(), btn = $('#resume');
    if (!s) { hide(btn); return; }
    const g = s.G, humans = g.seats.length - g.cpu.length, cpus = g.cpu.length;
    const who = humans === 1
      ? (g.cpu.indexOf(g.turn) === -1 ? 'your turn' : (cpus === 1 ? "the computer's turn" : E.NAMES[g.turn] + "'s turn"))
      : E.NAMES[g.turn] + "'s turn";
    const players = plural(humans, 'person', 'people') + (cpus ? ' and ' + plural(cpus, 'computer', 'computers') + ' (' + (LEVELS[g.level] || 'Medium') + ')' : '');
    $('#resume-cap').textContent = players + ', ' + who;
    show(btn);
  }

  /* ---------- Full screen, clean view, install hint ---------- */
  const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches));
  const fsEl = document.documentElement;
  const fsSupported = () => !isStandalone() && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
  const fsActive = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function toggleFullscreen() {
    try {
      if (fsActive()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl);
    } catch (e) { /* ignore */ }
  }
  function syncFullscreenUi() {
    const on = fsActive();
    $('#btn-full').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('#m-full-state').textContent = on ? 'On' : 'Off';
  }
  function setClean(on) {
    document.body.classList.toggle('clean', on);
    $('#btn-clean').setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function syncSound() {
    document.body.classList.toggle('muted', !prefs.sound);
    $('#m-sound-state').textContent = prefs.sound ? 'On' : 'Off';
    $('#btn-sound').setAttribute('aria-pressed', prefs.sound ? 'false' : 'true');
  }
  function fit() {
    const st = $('#stage'), s = Math.max(120, Math.floor(Math.min(st.clientWidth, st.clientHeight)) - 6);
    board.style.setProperty('--bs', s + 'px');
  }

  /* ---------- Wire up ---------- */
  function init() {
    buildBoard();
    document.querySelectorAll('#seg-people button').forEach((b) => b.addEventListener('click', () => { setPeople(+b.getAttribute('data-n')); renderPicker(); }));
    document.querySelectorAll('#seg-cpu button').forEach((b) => b.addEventListener('click', () => { setComputers(+b.getAttribute('data-n')); renderPicker(); }));
    $('#start').addEventListener('click', () => { Snd.init(); startFromSetup(); });
    renderPicker();
    $('#resume').addEventListener('click', () => { Snd.init(); const s = readSave(); if (s) startGame(s.G); });
    document.querySelectorAll('.seg button[data-level]').forEach((b) => {
      b.setAttribute('aria-pressed', b.getAttribute('data-level') === prefs.level ? 'true' : 'false');
      b.addEventListener('click', () => {
        prefs.level = b.getAttribute('data-level'); savePrefs();
        document.querySelectorAll('.seg button[data-level]').forEach((o) => o.setAttribute('aria-pressed', o === b ? 'true' : 'false'));
      });
    });

    $('#btn-menu').addEventListener('click', () => openSheet('menu'));
    $('#btn-rules').addEventListener('click', () => openSheet('rules'));
    $('#setup-rules').addEventListener('click', () => { show($('#rules')); });
    $('#rules-close').addEventListener('click', () => closeSheet('rules'));
    $('#m-resume').addEventListener('click', () => closeSheet('menu'));
    $('#m-rules').addEventListener('click', () => openSheet('rules'));
    $('#m-stats').addEventListener('click', () => { renderStats(); openSheet('stats'); });
    $('#stats-close').addEventListener('click', () => closeSheet('stats'));
    $('#m-test').addEventListener('click', () => {
      if (!prefs.sound) { prefs.sound = true; savePrefs(); syncSound(); }
      Snd.init(); Snd.dice(); setTimeout(Snd.home, 520);
    });
    $('#btn-sound').addEventListener('click', () => { prefs.sound = !prefs.sound; savePrefs(); syncSound(); Snd.init(); Snd.tick(); });
    $('#m-sound').addEventListener('click', () => { prefs.sound = !prefs.sound; savePrefs(); syncSound(); Snd.init(); Snd.tick(); });
    $('#btn-clean').addEventListener('click', () => setClean(true));
    $('#m-clean').addEventListener('click', () => { closeSheet('menu'); setClean(true); });
    $('#peek').addEventListener('click', () => setClean(false));
    $('#btn-full').addEventListener('click', toggleFullscreen);
    $('#m-full').addEventListener('click', toggleFullscreen);
    $('#m-restart').addEventListener('click', async () => {
      hide($('#menu'));
      if (await ask('Restart this game?', 'Everyone starts again from the beginning.', 'Restart')) sameAgain();
      else closeSheet('confirm');
    });
    $('#m-players').addEventListener('click', async () => {
      hide($('#menu'));
      if (await ask('Change players?', 'This game will end and cannot be resumed.', 'End game')) { store.del(SAVE_KEY); showSetup(); }
      else closeSheet('confirm');
    });
    $('#c-ok').addEventListener('click', () => answer(true));
    $('#c-cancel').addEventListener('click', () => answer(false));
    $('#w-again').addEventListener('click', sameAgain);
    $('#w-change').addEventListener('click', showSetup);
    ['menu', 'rules', 'stats'].forEach((id) => $('#' + id).addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSheet(id); }));

    document.addEventListener('pointerdown', Snd.init, { passive: true });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((n) => document.addEventListener(n, () => { syncFullscreenUi(); fit(); }));
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

    if (fsSupported()) { show($('#btn-full')); show($('#m-full')); }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && !isStandalone() && !prefs.hintDismissed) show($('#install-hint'));
    $('#hint-close').addEventListener('click', () => { hide($('#install-hint')); prefs.hintDismissed = true; savePrefs(); });

    syncSound(); syncFullscreenUi();
    fit();
    if (window.ResizeObserver) new ResizeObserver(fit).observe($('#stage'));
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', () => setTimeout(fit, 120));
    renderResume();

    registerServiceWorker();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && window.__updateRequested) { reloading = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const offer = (worker) => {
        show($('#banner'));
        $('#banner-btn').onclick = () => { window.__updateRequested = true; worker.postMessage('skipWaiting'); };
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => { /* offline install is a bonus, the game still works */ });
  }

  // Test hook (used by the automated browser checks, harmless in normal play)
  window.__ludo = { get state() { return G; }, startGame, showSetup };

  init();
})();
