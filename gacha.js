// gacha.js — the Name Wheel's marwa skin: a gachapon machine.
//
// Like cauldron.js (halloween), this only draws and animates. wheel.js owns
// the roster, the pool, No repeats and the pick itself (the winner is drawn
// FIRST with crypto.getRandomValues). Each student is one capsule in the
// globe — no names on them, so any class size works, and the globe visibly
// empties as No repeats takes capsules out.
//
// A pick is the spin descriptor { startedAt, duration, settle, winnerId },
// played as a row of deliberate beats (~5s, all from the descriptor's
// timestamps, so the page, the full screen window and the mini window play
// the same pick):
//   0.0–1.0s  the handle turns once and the machine shakes
//   0.25–1.9  the capsules are thrown about the globe — mixing
//   1.9–2.55  they settle; at 2.15 ONE capsule lights up (a pink ring, bigger)
//   2.55–2.95 it leaves the group and slides to the globe's exit
//   2.95–3.6  it falls down the glass chute, accelerating
//   3.6–4.2   it drops into the tray, bounces, rolls to a stop
//   4.25–4.55 a pause and a little shiver
//   4.6       it pops: the halves fly apart and fall away, hearts burst, the
//             name scales up out of it with an overshoot
//
// Exposed as window.Gacha with the same shape as window.Cauldron, so wheel.js
// treats them as interchangeable skins.

(function () {
  // the timeline, ms from the start of a pick
  const T = {
    turn: 1000, churn0: 250, churn1: 1900,
    pick: 2150, sep: 2550, exit: 2950, chute: 3600, settle: 4200,
    shiver: 4250, crack: 4600, name: 4650, end: 5000,
  };
  const DURATION_MS = T.sep;
  const SETTLE_MS = T.end - T.sep;
  const CAPS = 6;                                // pastel capsule colours (--gc-cap-1…6)
  // the machine, in the 400x400 box
  const GLOBE = { cx: 200, cy: 118, r: 104 };    // the capsules' room (inside the glass)
  const EXIT = { x: 200, y: 212 };               // where the chosen one leaves the globe
  const ROUTE = 'M200 226 C198 246 140 238 131 262 L130 316 C130 338 142 347 160 349';   // the chute
  const REST = { x: 194, y: 349 };               // where it comes to rest in the tray

  const views = new Map();
  const isOn = (doc) => doc.documentElement.getAttribute('data-theme') === 'marwa';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  // a stable colour per student, so a capsule keeps its colour all day
  const colourOf = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 1 + (h % CAPS); };

  // ---------- markup ----------
  // Back layer: shadow, base, body, the tray's dark mouth, the label strip,
  // the knob's socket, the glass globe's back, its collar, and the chute's
  // glass tube. Then the capsules (HTML, clipped to the globe). Front layer:
  // the glass's rim and shine, the tube's shine, the knob, the tray's lip.
  // Then the travelling capsule, the burst, the name and the counter.
  const MARKUP = `
    <svg class="gc-back" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <ellipse class="gc-shadow" cx="200" cy="390" rx="132" ry="9"/>
      <rect class="gc-foot" x="92" y="362" width="216" height="24" rx="11"/>
      <path class="gc-body" d="M88 238 Q88 222 106 220 L294 220 Q312 222 312 238 L316 356 Q316 370 300 370 L100 370 Q84 370 84 356 Z"/>
      <path class="gc-body-hi" d="M100 244 L98 346"/>
      <rect class="gc-label" x="190" y="236" width="112" height="22" rx="11"/>
      <rect class="gc-mouth" x="112" y="324" width="150" height="44" rx="15"/>
      <circle class="gc-glass-back" cx="200" cy="118" r="112"/>
      <rect class="gc-neck" x="150" y="212" width="100" height="16" rx="8"/>
      <path class="gc-tube-edge" d="${ROUTE}"/>
      <path class="gc-tube" d="${ROUTE}"/>
      <path class="gc-route" d="${ROUTE}"/>
      <circle class="gc-cap-top" cx="200" cy="7" r="8"/>
    </svg>
    <div class="gc-globe"></div>
    <svg class="gc-front" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <circle class="gc-glass-rim" cx="200" cy="118" r="112"/>
      <path class="gc-shine" d="M118 64 Q140 32 182 20"/>
      <path class="gc-shine small" d="M110 92 Q111 84 114 78"/>
      <path class="gc-tube-rim" d="${ROUTE}"/>
      <path class="gc-tube-shine" d="M122 268 L121 312"/>
      <g class="gc-knob">
        <circle class="gc-knob-ring" cx="272" cy="294" r="31"/>
        <circle class="gc-knob-face" cx="272" cy="294" r="23"/>
        <rect class="gc-knob-bar" x="245" y="288" width="54" height="12" rx="6"/>
        <circle class="gc-knob-dot" cx="272" cy="294" r="4"/>
      </g>
      <path class="gc-lip" d="M112 352 L262 352 L262 356 Q262 368 250 368 L124 368 Q112 368 112 356 Z"/>
    </svg>
    <button type="button" class="gc-handle" id="gacha-handle" aria-label="Turn the handle to pick a student"></button>
    <div class="gc-drop" aria-hidden="true"><span class="gc-half gc-top"></span><span class="gc-half gc-bot"></span></div>
    <div class="gc-burst" aria-hidden="true"></div>
    <p class="gc-winner"><span></span></p>
    <p class="gc-counter" aria-live="polite"><b>0</b><span>left</span></p>`;

  function build(doc) {
    if (views.has(doc)) return views.get(doc).el;
    const wrap = doc.querySelector('.wheel-wrap');
    if (!wrap) return null;
    const el = doc.createElement('div');
    el.className = 'gacha';
    el.id = 'gacha';
    el.dataset.state = '';
    el.innerHTML = MARKUP;
    wrap.appendChild(el);
    const burst = el.querySelector('.gc-burst');
    burst.innerHTML = Array.from({ length: 14 }, (_, i) =>
      `<i class="${i % 3 === 2 ? 'spark' : 'heart'}" style="--a:${(i * 360 / 14 + 6).toFixed(1)}deg;--d:${(0.7 + (i % 4) * 0.14).toFixed(2)};--s:${(0.8 + (i % 3) * 0.25).toFixed(2)}"></i>`).join('');
    const v = {
      doc, el,
      globe: el.querySelector('.gc-globe'),
      drop: el.querySelector('.gc-drop'),
      route: el.querySelector('.gc-route'),
      winnerEl: el.querySelector('.gc-winner'),
      nameEl: el.querySelector('.gc-winner span'),
      burst,
      counter: el.querySelector('.gc-counter b'),
      caps: new Map(),                           // id -> capsule
      labels: new Map(),                         // id -> label (for the reveal)
      S: 0, B: 0, r: 0,
      active: null,
      gone: null,                                // id whose capsule left the globe
      from: null,                                // where the chosen one left the group (box units)
      revealed: false,
      last: 0,
      timers: [],
    };
    views.set(doc, v);
    const win = doc.defaultView;
    const frame = (t) => { step(v, t); win.requestAnimationFrame(frame); };
    win.requestAnimationFrame(frame);
    return el;
  }

  // ---------- capsules ----------
  function addCapsule(v, id, fromTop) {
    const c = v.doc.createElement('span');
    c.className = 'gc-cap';
    c.dataset.c = String(colourOf(id));
    v.globe.appendChild(c);
    const R = (v.S || 200) / 2;
    const cap = {
      id, el: c,
      x: rnd(-0.5, 0.5) * R, y: fromTop ? -R * 0.75 : rnd(-0.2, 0.6) * R,
      vx: rnd(-30, 30), vy: 0, ang: rnd(0, 360), spin: 0, hidden: false,
    };
    v.caps.set(id, cap);
    return cap;
  }
  // One capsule per name in the list (the wheel's displayList). The colour
  // follows the student; nothing on the capsule says who it is.
  function sync(doc, list) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    const ids = new Set(list.map((x) => x.id));
    list.forEach((x) => v.labels.set(x.id, x.label));
    for (const [id, c] of v.caps) {
      if (!ids.has(id) && !(v.active && v.active.winnerId === id)) { c.el.remove(); v.caps.delete(id); }
    }
    for (const x of list) {
      const c = v.caps.get(x.id);
      if (!c) addCapsule(v, x.id, v.S > 0);
      else if (c.hidden && !v.active && v.gone === x.id) { show(c, v, true); v.gone = null; }
    }
    paintCount(v);
  }
  function show(c, v, fromTop) {
    c.hidden = false;
    c.el.classList.remove('gone', 'picked');
    if (fromTop) { const R = v.S / 2; c.x = rnd(-0.3, 0.3) * R; c.y = -R * 0.75; c.vy = 0; }
  }
  function paintCount(v) {
    let n = 0;
    for (const c of v.caps.values()) if (!c.hidden) n++;
    v.counter.textContent = String(n);
    v.el.dataset.empty = n ? '' : '1';
  }

  // ---------- the loop ----------
  function step(v, t) {
    const dt = Math.min(0.033, v.last ? (t - v.last) / 1000 : 0.016);
    v.last = t;
    if (!isOn(v.doc) || !v.el.offsetParent) return;
    const S = v.globe.clientWidth, B = v.el.clientWidth;
    if (!S || !B) return;
    if (Math.abs(S - v.S) > 1) {
      const k = v.S ? S / v.S : 1;
      for (const c of v.caps.values()) { c.x *= k; c.y *= k; }
      v.S = S;
    }
    v.B = B;
    const R = S / 2;
    // capsule size: fixed for any class up to ~36, so the globe empties as
    // names go; only a bigger class shrinks them to fit
    const r = R * Math.min(0.135, Math.sqrt(0.5 / Math.max(1, v.caps.size)));
    v.r = r;
    v.globe.style.setProperty('--cap', `${(r * 2).toFixed(1)}px`);

    const s = v.active;
    const el = s ? Date.now() - s.startedAt : Infinity;
    const chosen = s ? v.caps.get(s.winnerId) : null;
    // the mix: a bell of energy while the handle turns and just after
    const churn = s && el > T.churn0 && el < T.churn1
      ? Math.sin(Math.PI * (el - T.churn0) / (T.churn1 - T.churn0)) : 0;
    if (s) {
      if (chosen && el >= T.pick && !chosen.hidden) chosen.el.classList.add('picked');
      if (chosen && el >= T.sep && !chosen.hidden) leaveGlobe(v, chosen);
      paintDrop(v, el);
      if (el >= T.crack && !v.el.classList.contains('cracked')) crack(v);
      if (el >= T.name && !v.revealed) reveal(v, s.winnerId);
    }

    // physics: gravity, the mix, bouncy collisions, the round glass wall
    const live = [...v.caps.values()].filter((c) => !c.hidden);
    const k = S / 200;
    const g = 1700 * k;
    for (const c of live) {
      if (c.el.classList.contains('picked')) {
        // the chosen one holds still, eased in off the glass so its ring
        // (it is drawn 1.35x) never gets clipped by the globe's edge
        c.vx *= 0.8; c.vy *= 0.8;
        const d = Math.hypot(c.x, c.y), lim = R - r * 1.45 - 2;
        if (d > lim) { const k2 = 1 - Math.min(1, dt * 6) * (1 - lim / d); c.x *= k2; c.y *= k2; }
        continue;
      }
      c.vy += g * dt;
      if (churn > 0) {
        c.vx += (rnd(-1, 1) * 3400 - c.x * 5) * churn * dt * k;
        c.vy -= rnd(0.5, 1.7) * 4600 * churn * dt * k;
      }
      c.vx *= Math.exp(-0.7 * dt); c.vy *= Math.exp(-0.2 * dt);
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.spin = c.spin * Math.exp(-1.5 * dt) + (c.vx / Math.max(4, r)) * 57.3 * dt * 0.3;
      c.ang += c.spin + (c.vx * dt / Math.max(4, r)) * 40;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < live.length; i++) {
        const a = live[i];
        for (let j = i + 1; j < live.length; j++) {
          const b = live[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy), min = r * 2;
          if (d >= min || d === 0) continue;
          const nx = dx / d, ny = dy / d, push = (min - d) / 2;
          const am = a.el.classList.contains('picked') ? 0 : 1, bm = b.el.classList.contains('picked') ? 0 : 1;
          a.x -= nx * push * am * (bm ? 1 : 2); a.y -= ny * push * am * (bm ? 1 : 2);
          b.x += nx * push * bm * (am ? 1 : 2); b.y += ny * push * bm * (am ? 1 : 2);
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) { const j2 = -rv * 0.85; a.vx -= nx * j2 * am; a.vy -= ny * j2 * am; b.vx += nx * j2 * bm; b.vy += ny * j2 * bm; }
        }
      }
      for (const c of live) {
        const d = Math.hypot(c.x, c.y), max = R - r - 1;
        if (d > max) {
          const nx = c.x / d, ny = c.y / d;
          c.x = nx * max; c.y = ny * max;
          const vn = c.vx * nx + c.vy * ny;
          if (vn > 0) { c.vx -= vn * nx * 1.6; c.vy -= vn * ny * 1.6; c.spin += rnd(-6, 6); }   // a real bounce off the glass
        }
      }
    }
    for (const c of live) {
      c.el.style.transform = `translate(${(c.x - r).toFixed(1)}px, ${(c.y - r).toFixed(1)}px) rotate(${c.ang.toFixed(1)}deg)`;
    }
  }

  // The chosen capsule leaves the globe: the globe's copy hides and the
  // travelling one (.gc-drop, in box units so it can go anywhere) takes over
  // at exactly the same spot.
  function leaveGlobe(v, c) {
    const u = 400 / v.S * (GLOBE.r * 2 / 400);           // globe px → box units
    v.from = { x: GLOBE.cx + c.x * u, y: GLOBE.cy + c.y * u, ang: c.ang };
    c.hidden = true;
    c.el.classList.add('gone');
    c.el.classList.remove('picked');
    v.gone = c.id;
    paintCount(v);
  }

  // Where the travelling capsule is at time `el` (box units), and how it's
  // turned. Each leg has its own easing: an ease-in-out slide to the exit, a
  // fall that ACCELERATES down the chute (distance ∝ t²), then a bounce in
  // the tray that loses height each time and a roll to a stop.
  function dropPose(v, el) {
    const D = v.r * 2 * (400 / v.S) * (GLOBE.r * 2 / 400);   // a capsule's diameter, box units
    if (el < T.exit) {
      const f = v.from || { x: EXIT.x, y: EXIT.y - 30, ang: 0 };
      const p = easeInOut(clamp01((el - T.sep) / (T.exit - T.sep)));
      return { x: lerp(f.x, EXIT.x, p), y: lerp(f.y, EXIT.y, p), rot: lerp(f.ang, f.ang + 90, p), D };
    }
    if (el < T.chute) {
      const p = clamp01((el - T.exit) / (T.chute - T.exit));
      const L = v.route.getTotalLength();
      const pt = v.route.getPointAtLength(L * p * p);          // falls faster and faster
      return { x: pt.x, y: pt.y, rot: (v.from ? v.from.ang : 0) + 90 + 540 * p * p, D };
    }
    const q = (el - T.chute) / 1000;                          // seconds in the tray
    const start = { x: 160, y: 349 };
    const roll = easeInOut(clamp01(q / 0.55));
    const hop = Math.abs(Math.sin(q * 13)) * 26 * Math.exp(-q * 6.5);   // big first bounce, then smaller
    let rot = Math.sin(q * 9) * 30 * Math.exp(-q * 5);
    if (el >= T.shiver && el < T.crack) rot += Math.sin((el - T.shiver) / 18) * 6;   // the shiver before it opens
    return { x: lerp(start.x, REST.x, roll), y: REST.y - hop, rot, D };
  }
  function paintDrop(v, el) {
    const d = v.drop;
    if (el < T.sep || !v.S) { d.style.opacity = '0'; return; }
    const p = dropPose(v, el);
    d.style.opacity = '1';
    d.style.left = `${(p.x / 4).toFixed(2)}%`;
    d.style.top = `${(p.y / 4).toFixed(2)}%`;
    d.style.width = `${(p.D * 1.3 / 4).toFixed(2)}%`;          // the chosen one is a size up
    d.style.transform = `translate(-50%, -50%) rotate(${p.rot.toFixed(1)}deg)`;
    // squash a little as it hits the tray floor
    const q = el - T.chute;
    d.classList.toggle('squash', q > 0 && q < 90);
  }

  function crack(v) {
    v.el.classList.add('cracked');
    v.drop.style.transform = 'translate(-50%, -50%)';
    v.burst.style.left = `${(REST.x / 4).toFixed(2)}%`;
    v.burst.style.top = `${(REST.y / 4).toFixed(2)}%`;
    v.burst.classList.remove('go'); void v.burst.offsetWidth; v.burst.classList.add('go');
  }
  function reveal(v, id) {
    v.revealed = true;
    const name = v.labels.get(id) || '';
    v.nameEl.textContent = name;
    v.winnerEl.dataset.len = name.length > 11 ? 'long' : '';
    v.el.dataset.state = 'picked';
  }

  // ---------- a pick ----------
  function run(doc, s, { sound = false } = {}) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    v.timers.forEach(clearTimeout); v.timers = [];
    v.active = s;
    v.revealed = false;
    v.from = null;
    v.el.classList.remove('cracked');
    v.burst.classList.remove('go');
    v.el.dataset.state = 'turning';
    v.drop.dataset.c = String(colourOf(s.winnerId));
    v.drop.style.opacity = '0';
    const knob = v.el.querySelector('.gc-knob');
    knob.classList.remove('turning'); void knob.getBoundingClientRect(); knob.classList.add('turning');
    if (sound) gachaSound();
  }
  function finish(doc, s, { respawn = false } = {}) {
    const v = views.get(doc);
    if (!v) return;
    v.active = null;
    // Land on the final pose even if this window missed frames (a hidden or
    // throttled window doesn't run rAF): the capsule gone from the globe and
    // opened in the tray, the name up.
    const left = v.caps.get(s.winnerId);
    if (left && !left.hidden) { left.hidden = true; left.el.classList.add('gone'); left.el.classList.remove('picked'); v.gone = s.winnerId; paintCount(v); }
    if (v.S) {
      const D = v.r * 2 * (400 / v.S) * (GLOBE.r * 2 / 400);
      v.drop.style.left = `${(REST.x / 4).toFixed(2)}%`;
      v.drop.style.top = `${(REST.y / 4).toFixed(2)}%`;
      v.drop.style.width = `${(D * 1.3 / 4).toFixed(2)}%`;
    }
    v.drop.style.opacity = '1';
    v.drop.style.transform = 'translate(-50%, -50%)';
    v.el.classList.add('cracked');
    if (!v.revealed) reveal(v, s.winnerId);
    v.el.dataset.state = 'picked';
    v.el.querySelector('.gc-knob').classList.remove('turning');
    // With No repeats off the capsule goes back in: it drops in from the top
    // a moment later. With it on, the globe stays one lighter.
    if (respawn) v.timers.push(setTimeout(() => {
      const c = v.caps.get(s.winnerId);
      if (c && c.hidden && !v.active) { show(c, v, true); if (v.gone === s.winnerId) v.gone = null; paintCount(v); }
    }, 1400));
  }
  // the name over the machine (state: '' | 'boiling' (a pick is under way) | 'picked')
  function setWinner(doc, name, state) {
    const v = views.get(doc);
    if (!v) return;
    if (state === 'picked' && name) {
      v.nameEl.textContent = name;
      v.winnerEl.dataset.len = name.length > 11 ? 'long' : '';
      v.el.dataset.state = 'picked';
    } else if (state === 'boiling') {
      if (!v.revealed) v.el.dataset.state = 'turning';
    } else {
      v.nameEl.textContent = '';
      v.el.classList.remove('cracked');
      v.drop.style.opacity = '0';
      if (!v.active) v.el.dataset.state = '';
    }
  }
  function setDisabled(doc, off) {
    const v = views.get(doc);
    if (!v) return;
    v.el.setAttribute('aria-disabled', String(!!off));
    const h = v.el.querySelector('.gc-handle');
    if (h) h.disabled = !!off;
  }

  // ---------- sound: the crank, rattling capsules, the chute, the pop ----------
  let ctx = null;
  function audio() {
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
    return ctx;
  }
  function blip(c, at, { type = 'square', f0 = 900, f1 = 600, len = 0.03, gain = 0.05 } = {}) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + len + 0.02);
  }
  function gachaSound() {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const t0 = c.currentTime, s = (ms) => t0 + ms / 1000;
    // the crank: a ratchet, clicking around one turn
    for (let i = 0; i < 10; i++) blip(c, s(T.turn * easeInOut(i / 10)), { f0: 1300, f1: 700, len: 0.025, gain: 0.06 });
    // capsules rattling as they mix, loudest mid-mix
    for (let t = T.churn0; t < T.churn1; t += rnd(22, 70)) {
      const e = Math.sin(Math.PI * (t - T.churn0) / (T.churn1 - T.churn0));
      blip(c, s(t), { type: 'triangle', f0: rnd(1800, 3200), f1: rnd(1200, 2000), len: rnd(0.015, 0.03), gain: 0.01 + e * 0.04 });
    }
    // a clack as the chosen one drops out, then down the chute, faster and faster
    blip(c, s(T.exit), { type: 'triangle', f0: 1700, f1: 1000, len: 0.04, gain: 0.06 });
    for (let k = 1; k <= 5; k++) blip(c, s(T.exit + (T.chute - T.exit) * Math.sqrt(k / 6)), { type: 'triangle', f0: 1500 - k * 120, f1: 900, len: 0.03, gain: 0.05 });
    // into the tray: a clunk, two smaller bounces
    blip(c, s(T.chute), { type: 'sine', f0: 240, f1: 100, len: 0.13, gain: 0.18 });
    blip(c, s(T.chute + 230), { type: 'sine', f0: 220, f1: 120, len: 0.08, gain: 0.08 });
    blip(c, s(T.chute + 390), { type: 'sine', f0: 210, f1: 130, len: 0.06, gain: 0.04 });
    // the pop as it opens, and a little sparkle
    blip(c, s(T.crack), { type: 'triangle', f0: 1100, f1: 220, len: 0.13, gain: 0.22 });
    blip(c, s(T.crack + 60), { type: 'sine', f0: 1600, f1: 2600, len: 0.12, gain: 0.05 });
    blip(c, s(T.crack + 150), { type: 'sine', f0: 2100, f1: 3200, len: 0.1, gain: 0.04 });
  }

  window.Gacha = { DURATION_MS, SETTLE_MS, isOn, build, sync, run, finish, setWinner, setDisabled };
})();
