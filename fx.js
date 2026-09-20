/* End-of-game graphics drawn on one canvas: no images, no libraries.
 *   LudoFX.celebrate(colors)  confetti cannons + fireworks for the winner
 *   LudoFX.consolation()      slow, soft falling stars for the losing side
 *   LudoFX.stop()             clear immediately
 * Does nothing when the device asks for reduced motion. */
(function () {
  'use strict';

  var canvas = null, ctx = null, raf = 0, parts = [], w = 0, h = 0, dpr = 1;
  var running = false, last = 0, elapsed = 0, script = [], spawn = null, hardStop = 0;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function setup() {
    canvas = canvas || document.getElementById('fx');
    if (!canvas) return false;
    ctx = canvas.getContext('2d');
    resize();
    return !!ctx;
  }
  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', function () { if (running) resize(); });

  /* ---------- particle makers ---------- */
  function confetti(x, y, vx, vy, colors) {
    parts.push({ kind: 'confetti', x: x, y: y, vx: vx, vy: vy, g: 0.26, drag: 0.992,
      w: rand(9, 15), h: rand(5, 9), rot: rand(0, 6.28), vr: rand(-0.25, 0.25),
      wob: rand(0, 6.28), wobSpeed: rand(0.08, 0.2), color: pick(colors), life: 0 });
  }
  function cannon(fromLeft, colors) {
    var n = 70, x = fromLeft ? -10 : w + 10, y = h * 0.92;
    for (var i = 0; i < n; i++) {
      var angle = fromLeft ? rand(-1.25, -0.6) : rand(-2.55, -1.9);
      var speed = rand(11, 21) * Math.min(1.15, Math.max(0.75, h / 800));
      confetti(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, colors);
    }
  }
  function rain(n, colors) {
    for (var i = 0; i < n; i++) confetti(rand(0, w), -12, rand(-1.2, 1.2), rand(1.5, 4), colors);
  }
  function firework(colors) {
    var x = rand(w * 0.18, w * 0.82), y = rand(h * 0.14, h * 0.42), n = 60, base = rand(0, 6.28);
    for (var i = 0; i < n; i++) {
      var a = base + i * (6.2832 / n), sp = rand(3, 7.5);
      parts.push({ kind: 'spark', x: x, y: y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 0.05, drag: 0.976, color: pick(colors), life: 0, max: rand(60, 100) });
    }
    parts.push({ kind: 'flash', x: x, y: y, life: 0, max: 10 });
  }
  function star(colors) {
    parts.push({ kind: 'star', x: rand(0, w), y: -20, vy: rand(0.55, 1.3), sway: rand(0, 6.28), swaySpeed: rand(0.02, 0.05),
      swayAmp: rand(0.3, 0.9), size: rand(6, 14), rot: rand(0, 6.28), vr: rand(-0.02, 0.02), color: pick(colors), life: 0 });
  }

  /* ---------- drawing ---------- */
  function drawStar(x, y, r, rot) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = rot - Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      var px = x + rr * Math.cos(a), py = y + rr * Math.sin(a);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }

  function step(now, dt) {
    ctx.clearRect(0, 0, w, h);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life += dt;
      if (p.kind === 'confetti') {
        p.vx *= Math.pow(p.drag, dt); p.vy = p.vy * Math.pow(p.drag, dt) + p.g * dt;
        p.x += p.vx * dt + Math.sin(p.wob) * 0.6; p.y += p.vy * dt;
        p.rot += p.vr * dt; p.wob += p.wobSpeed * dt;
        if (p.y > h + 30) { parts.splice(i, 1); continue; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.wob * 1.7));           // makes each piece flutter like paper
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      } else if (p.kind === 'spark') {
        p.px = p.x; p.py = p.y;
        p.vx *= Math.pow(p.drag, dt); p.vy = p.vy * Math.pow(p.drag, dt) + p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        var k = 1 - p.life / p.max;
        if (k <= 0) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, k);
        ctx.strokeStyle = p.color; ctx.lineWidth = 3.6 * k + 0.8; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'flash') {
        var f = 1 - p.life / p.max;
        if (f <= 0) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = f * 0.55; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 38 * (1.2 - f), 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'star') {
        p.sway += p.swaySpeed * dt; p.x += Math.sin(p.sway) * p.swayAmp * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y > h + 30) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = 0.85; ctx.fillStyle = p.color;
        drawStar(p.x, p.y, p.size, p.rot);
        ctx.globalAlpha = 1;
      }
    }
  }

  function frame(now) {
    if (!running) return;
    var dt = Math.min(2.2, (now - last) / 16.667 || 1); last = now;
    elapsed += dt * 16.667;
    while (script.length && script[0].at <= elapsed) script.shift().run();
    if (spawn && elapsed < spawn.until) spawn.run(dt);
    step(now, dt);
    if ((!parts.length && !script.length && (!spawn || elapsed >= spawn.until)) || elapsed > hardStop) { stop(); return; }
    raf = requestAnimationFrame(frame);
  }

  function begin(sc, sp, maxMs) {
    if (reduce || !setup()) return;
    stop();
    resize();
    running = true; elapsed = 0; last = performance.now(); parts = [];
    script = sc; spawn = sp; hardStop = maxMs;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false; cancelAnimationFrame(raf); parts = []; script = []; spawn = null;
    if (ctx && canvas) ctx.clearRect(0, 0, w, h);
  }

  /* ---------- public ---------- */
  function celebrate(seatColors) {
    var colors = (seatColors || []).concat(['#ffd166', '#ffffff', '#ff6b6b', '#4dd4ac', '#5aa9ff']);
    var sc = [
      { at: 0, run: function () { cannon(true, colors); cannon(false, colors); } },
      { at: 350, run: function () { firework(colors); } },
      { at: 900, run: function () { firework(colors); } },
      { at: 1500, run: function () { cannon(true, colors); cannon(false, colors); firework(colors); } },
      { at: 2200, run: function () { firework(colors); } },
      { at: 3000, run: function () { firework(colors); } }
    ];
    var sp = { until: 3200, run: function (dt) { if (Math.random() < 0.55 * dt) rain(2, colors); } };
    begin(sc, sp, 9000);
  }
  function consolation() {
    var colors = ['#f6d365', '#ffe9a8', '#c9d6ff', '#e2c8ff', '#ffffff'];
    var sp = { until: 4200, run: function (dt) { if (Math.random() < 0.28 * dt) star(colors); } };
    begin([{ at: 0, run: function () { for (var i = 0; i < 10; i++) { star(colors); parts[parts.length - 1].y = rand(-h * 0.5, h * 0.2); } } }], sp, 12000);
  }

  window.LudoFX = { celebrate: celebrate, consolation: consolation, stop: stop };
})();
