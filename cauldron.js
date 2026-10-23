// cauldron.js — the Name Wheel's halloween skin: a cauldron on a fire.
//
// wheel.js still owns everything that matters — the roster, the pool, No
// repeats, and the pick itself (the winner is drawn FIRST with
// crypto.getRandomValues). This file only draws and animates: every name
// floats in the brew as a bubble; a pick is a spin descriptor
// { startedAt, duration, settle, winnerId } that boils the brew for
// `duration` ms (intensity building), then spends `settle` lifting the
// winner's bubble above the surface, hovering, and popping it. wheel.js's
// runSpin() hands the descriptor here whenever the document is in the
// halloween theme, so the page, the full screen window and the mini window
// all brew the same pick from the same timestamps.
//
// Exposed as window.Cauldron (plain script, no modules — like everything
// else in the app). Bubbles are HTML (crisp text at any size) moved by a
// small rAF physics loop: a wander, a swirl when boiling, soft separation so
// they bob against each other, and an elliptical wall at the brew's edge.

(function () {
  const BOIL_MS = 3600;                          // the churn, intensity building
  const SETTLE_MS = 2000;                        // rise + hover + pop
  const RISE = 0.48, HOVER = 0.36;               // fractions of settle (pop is the rest)
  const NS = 'http://www.w3.org/2000/svg';

  const views = new Map();                       // document -> view state
  const isOn = (doc) => doc.documentElement.getAttribute('data-theme') === 'halloween';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const easeIn = (t) => t * t;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);

  // ---------- markup ----------
  // Two SVG layers in one 400x400 box with the bubbles between them: the back
  // (ground light, steam, the flames behind the pot, legs, pot, rim, brew
  // surface) and the front (the near lip of the rim, so bubbles sit IN the
  // brew, then the logs, the coal bed and the flames over the pot's base).
  // A flame is three layers (deep orange, bright orange, a yellow-white core,
  // each smaller and a little offset) that lick on their own beats in CSS.
  // Its base is at 0; s < 0 mirrors it so neighbours don't look stamped.
  const flame = (x, y, s, i) => `
      <g class="cd-flame" style="--i:${i}" transform="translate(${x} ${y}) scale(${s} ${Math.abs(s)})"><g class="cd-flame-boil">
        <path class="f-out" d="M0 0 C-22 0 -32 -16 -29 -36 C-26 -54 -12 -62 -8 -80 C-5 -92 -6 -102 -2 -114 C8 -102 16 -90 16 -76 C20 -82 24 -86 24 -94 C36 -76 38 -50 30 -28 C24 -10 14 0 0 0 Z"/>
        <path class="f-mid" d="M2 0 C-14 0 -20 -12 -18 -27 C-16 -40 -7 -46 -4 -60 C-2 -70 -2 -76 1 -86 C9 -74 14 -64 14 -52 C17 -56 19 -60 19 -66 C27 -50 27 -34 22 -18 C18 -6 12 0 2 0 Z"/>
        <path class="f-core" d="M3 0 C-7 0 -11 -7 -10 -17 C-9 -26 -3 -31 0 -42 C1 -46 1 -48 2 -52 C8 -42 12 -32 12 -22 C13 -14 11 -6 8 -3 C6 -1 5 0 3 0 Z"/>
      </g></g>`;
  // a log: a dark edge, the bark, its cut end with a ring, glowing cracks
  const log = (x1, y1, x2, y2, cracks) => `
      <g class="cd-log">
        <line class="lg-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
        <line class="lg-bark" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
        <ellipse class="lg-end" cx="${x1}" cy="${y1}" rx="5.5" ry="8.5"/>
        <ellipse class="lg-ring" cx="${x1}" cy="${y1}" rx="2.6" ry="4.4"/>
        ${cracks.map((d) => `<path class="lg-crack" d="${d}"/>`).join('')}
      </g>`;
  const MARKUP = `
    <svg class="cd-back" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="cd-g-fire"><stop offset="0"/><stop offset="1"/></radialGradient>
        <radialGradient id="cd-g-pool"><stop offset="0"/><stop offset="0.45"/><stop offset="1"/></radialGradient>
        <radialGradient id="cd-g-bed"><stop offset="0"/><stop offset="0.5"/><stop offset="1"/></radialGradient>
        <linearGradient id="cd-g-f-out" x1="0" y1="1" x2="0" y2="0"><stop offset="0"/><stop offset="1"/></linearGradient>
        <linearGradient id="cd-g-f-mid" x1="0" y1="1" x2="0" y2="0"><stop offset="0"/><stop offset="1"/></linearGradient>
        <linearGradient id="cd-g-f-core" x1="0" y1="1" x2="0" y2="0"><stop offset="0"/><stop offset="1"/></linearGradient>
        <linearGradient id="cd-g-rimlight" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="0.55"/><stop offset="1"/></linearGradient>
        <radialGradient id="cd-g-brew" cx="50%" cy="42%" r="62%"><stop offset="0"/><stop offset="0.55"/><stop offset="1"/></radialGradient>
        <linearGradient id="cd-g-pot" x1="0" y1="0" x2="1" y2="0"><stop offset="0"/><stop offset="0.3"/><stop offset="1"/></linearGradient>
        <radialGradient id="cd-g-under" cx="50%" cy="100%" r="75%"><stop offset="0"/><stop offset="1"/></radialGradient>
        <radialGradient id="cd-g-haze" cx="50%" cy="50%" r="50%"><stop offset="0"/><stop offset="1"/></radialGradient>
      </defs>
      <g class="cd-light"><ellipse class="cd-fireglow" cx="200" cy="372" rx="210" ry="74" fill="url(#cd-g-fire)"/>
      <ellipse class="cd-pool" cx="200" cy="391" rx="175" ry="24" fill="url(#cd-g-pool)"/></g>
      <ellipse class="cd-haze" cx="200" cy="150" rx="190" ry="120" fill="url(#cd-g-haze)"/>
      <g class="cd-steam">
        <path d="M140 120 q-16 -24 2 -46 q18 -22 0 -46"/>
        <path d="M206 112 q16 -26 -2 -50 q-18 -24 2 -50"/>
        <path d="M268 122 q-14 -22 4 -42 q16 -20 -2 -40"/>
      </g>
      <g class="cd-flames back">${flame(102, 384, -0.8, 5)}${flame(298, 384, 0.84, 6)}${flame(130, 386, 0.64, 7)}${flame(272, 386, -0.62, 8)}</g>
      <path class="cd-leg" d="M96 318 L78 362 L96 362 L114 326 Z"/>
      <path class="cd-leg" d="M304 318 L322 362 L304 362 L286 326 Z"/>
      <path class="cd-pot" d="M50 172 C38 264 92 346 200 350 C308 346 362 264 350 172 Z" fill="url(#cd-g-pot)"/>
      <path class="cd-pot-glow" d="M50 172 C38 264 92 346 200 350 C308 346 362 264 350 172 Z" fill="url(#cd-g-under)"/>
      <path class="cd-pot-rimlight" d="M50 172 C38 264 92 346 200 350 C308 346 362 264 350 172" stroke="url(#cd-g-rimlight)"/>
      <path class="cd-pot-hi" d="M74 206 C70 252 92 298 130 322"/>
      <ellipse class="cd-rim" cx="200" cy="168" rx="158" ry="64"/>
      <ellipse class="cd-brew-surface" cx="200" cy="171" rx="140" ry="53" fill="url(#cd-g-brew)"/>
      <ellipse class="cd-brew-sheen" cx="168" cy="152" rx="56" ry="12"/>
    </svg>
    <div class="cd-brew"></div>
    <svg class="cd-front" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <path class="cd-lip" d="M42 168 A158 64 0 0 0 358 168 L340 171 A140 53 0 0 1 60 171 Z"/>
      <path class="cd-lip-hi" d="M66 196 Q200 244 334 196"/>
      <g class="cd-logs">${log(282, 368, 124, 374, ['M268 369 l-9 1 l-4 -1.5 l-8 1', 'M150 373 l-8 0.5 l-4 -1'])}</g>
      <ellipse class="cd-bed" cx="200" cy="383" rx="92" ry="15" fill="url(#cd-g-bed)"/>
      <g class="cd-flames">${flame(150, 386, 0.68, 0)}${flame(176, 388, -0.84, 1)}${flame(202, 386, 0.92, 2)}${flame(228, 388, -0.8, 3)}${flame(253, 386, 0.66, 4)}</g>
      <g class="cd-logs">${log(104, 393, 262, 375, ['M128 390 l10 -2 l5 1.5 l10 -2.5', 'M196 383 l9 -1 l5 -2 l8 0.5'])}${log(296, 393, 140, 376, ['M276 391 l-10 -2 l-5 1 l-9 -2', 'M236 386 l-8 -1 l-5 -2 l-7 0.5'])}</g>
    </svg>
    <div class="cd-embers" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
    <div class="cd-burst" aria-hidden="true"></div>
    <p class="cd-winner"></p>`;

  function build(doc) {
    if (views.has(doc)) return views.get(doc).el;
    const wrap = doc.querySelector('.wheel-wrap');
    if (!wrap) return null;
    const el = doc.createElement('div');
    el.className = 'cauldron';
    el.id = 'cauldron';
    el.dataset.state = '';
    el.innerHTML = MARKUP;
    wrap.appendChild(el);
    const v = {
      doc, el,
      brew: el.querySelector('.cd-brew'),
      winnerEl: el.querySelector('.cd-winner'),
      burst: el.querySelector('.cd-burst'),
      bubbles: new Map(),                        // id -> bubble
      size: { W: 0, H: 0, n: -1 },
      active: null,                              // the running brew descriptor
      popped: null,                              // id of the bubble that just popped
      boil: 0,
      last: 0,
      timers: [],
    };
    views.set(doc, v);
    const win = doc.defaultView;
    const frame = (t) => { step(v, t); win.requestAnimationFrame(frame); };
    win.requestAnimationFrame(frame);
    return el;
  }

  // ---------- bubbles ----------
  function makeBubble(v, item) {
    const b = v.doc.createElement('span');
    b.className = 'cd-bubble';
    b.innerHTML = '<span class="cd-name"></span>';
    v.brew.appendChild(b);
    return {
      id: item.id, label: '', el: b,
      x: rnd(-0.6, 0.6) * (v.size.W / 2 || 100), y: rnd(-0.5, 0.5) * (v.size.H / 2 || 40),
      vx: 0, vy: 0, w: 40, h: 30,
      theta: rnd(0, Math.PI * 2), phase: rnd(0, Math.PI * 2),
      mode: 'float', lift: null,
    };
  }
  function setLabel(b, label) {
    if (b.label === label) return;
    b.label = label;
    b.el.firstChild.textContent = label;
    b.el.title = label;
  }

  // Draw the current list: add new bubbles, drop missing ones, keep the rest
  // where they are. A popped bubble comes back once it's in the list again
  // after a fresh sync (No repeats off, or the next round).
  function sync(doc, list) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    const ids = new Set(list.map((x) => x.id));
    for (const [id, b] of v.bubbles) {
      if (!ids.has(id) && !(v.active && v.active.winnerId === id)) { b.el.remove(); v.bubbles.delete(id); }
    }
    for (const item of list) {
      let b = v.bubbles.get(item.id);
      if (!b) { b = makeBubble(v, item); v.bubbles.set(item.id, b); b.el.classList.add('born'); }
      setLabel(b, item.label);
      if (v.popped === item.id && !v.active) { b.el.classList.remove('popped', 'pop', 'lifted'); b.mode = 'float'; b.y = v.size.H / 2 * 0.6; v.popped = null; }
    }
    v.size.n = -1;                               // re-measure on the next frame
  }

  // Bubble size from the brew's area and the head count: together they cover
  // about 60% of the surface, so a class of 30 still fits; the name sets the
  // width (a pill), the font scales with the bubble.
  function measure(v) {
    const W = v.brew.clientWidth, H = v.brew.clientHeight;
    const n = v.bubbles.size;
    if (Math.abs(W - v.size.W) < 1 && Math.abs(H - v.size.H) < 1 && n === v.size.n) return;
    v.size = { W, H, n };
    if (!n || !W) return;
    const a = W / 2, bb = H / 2;
    const d = Math.max(24, Math.min(H * 0.95, 2 * Math.sqrt((0.6 * a * bb) / n)));
    const f = Math.max(10, Math.min(40, d * 0.36));
    for (const b of v.bubbles.values()) {
      const len = Math.max(2, b.label.length);
      b.w = Math.max(d, f * 0.55 * len + f * 1.5);
      b.h = Math.max(d * 0.72, f * 1.85);
      b.el.style.width = `${b.w.toFixed(1)}px`;
      b.el.style.height = `${b.h.toFixed(1)}px`;
      b.el.style.fontSize = `${f.toFixed(1)}px`;
    }
  }

  // ---------- the loop ----------
  function step(v, t) {
    const dt = Math.min(0.05, v.last ? (t - v.last) / 1000 : 0.016);
    v.last = t;
    if (!isOn(v.doc) || !v.el.offsetParent) return;     // other themes: idle
    measure(v);
    const { W, H } = v.size;
    if (!W) return;
    const a = W / 2, bb = H / 2;

    // intensity: builds through the churn, eases off as the winner rises
    const s = v.active;
    let lifting = null, phaseP = 0;
    if (s) {
      const el = Date.now() - s.startedAt;
      const rise = s.settle * RISE, hover = s.settle * HOVER;
      if (el < s.duration) v.boil = 0.12 + 0.88 * easeIn(Math.min(1, el / s.duration));
      else v.boil = Math.max(0.15, 1 - (el - s.duration) / (rise + hover) * 0.85);
      if (el >= s.duration) {
        lifting = v.bubbles.get(s.winnerId) || null;
        phaseP = el - s.duration;
        if (lifting && phaseP >= rise + hover && !lifting.el.classList.contains('pop')) pop(v, lifting);
      }
    } else {
      v.boil = Math.max(0, v.boil - dt * 0.7);
    }
    v.el.style.setProperty('--boil', v.boil.toFixed(3));

    const list = [...v.bubbles.values()];
    const wander = 10 + v.boil * 190, swirl = v.boil * 140, maxV = 26 + v.boil * 300;
    for (const b of list) {
      if (b === lifting || b.el.classList.contains('popped')) continue;
      b.theta += rnd(-1.5, 1.5) * dt * 2;
      b.vx += (Math.cos(b.theta) * wander + (-b.y / bb) * swirl) * dt;
      b.vy += (Math.sin(b.theta) * wander * 0.6 + (b.x / a) * swirl * 0.5 + rnd(-1, 1) * v.boil * 520) * dt;
      const damp = Math.exp(-1.7 * dt);
      b.vx *= damp; b.vy *= damp;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > maxV) { b.vx *= maxV / sp; b.vy *= maxV / sp; }
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    // separation: treat each pill as an ellipse, push overlapping pairs apart
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p === lifting || p.el.classList.contains('popped')) continue;
        for (let j = i + 1; j < list.length; j++) {
          const q = list[j];
          if (q === lifting || q.el.classList.contains('popped')) continue;
          const dx = q.x - p.x, dy = q.y - p.y;
          const rx = (p.w + q.w) * 0.46, ry = (p.h + q.h) * 0.46;
          const nd = Math.hypot(dx / rx, dy / ry);
          if (nd >= 1 || nd === 0) continue;
          const push = (1 - nd) * 0.5;
          const ux = (dx / rx) / nd, uy = (dy / ry) / nd;
          p.x -= ux * push * rx * 0.5; p.y -= uy * push * ry * 0.5;
          q.x += ux * push * rx * 0.5; q.y += uy * push * ry * 0.5;
          p.vx -= ux * 6; q.vx += ux * 6; p.vy -= uy * 4; q.vy += uy * 4;
        }
      }
    }
    // the brew's edge: centres stay inside the ellipse (bubbles may poke a
    // little over the far rim — they're floating)
    for (const b of list) {
      if (b === lifting) continue;
      const ax = Math.max(4, a - b.w * 0.42), by = Math.max(4, bb - b.h * 0.3);
      const e = (b.x / ax) ** 2 + (b.y / by) ** 2;
      if (e > 1) {
        const k = 1 / Math.sqrt(e);
        b.x *= k; b.y *= k;
        b.vx *= -0.4; b.vy *= -0.4;
      }
    }
    // the winner: drift to the middle, rise clear of the surface, hover
    if (lifting && !lifting.el.classList.contains('popped')) {
      const rise = s.settle * RISE;
      if (!lifting.lift) {
        lifting.lift = { x: lifting.x, y: lifting.y };
        lifting.el.classList.add('lifted');
      }
      const p = easeOut(Math.min(1, phaseP / rise));
      const ty = -bb - lifting.h * 1.25;
      lifting.x = lifting.lift.x + (0 - lifting.lift.x) * p;
      lifting.y = lifting.lift.y + (ty - lifting.lift.y) * p;
      lifting.scale = 1 + 0.6 * p;
    }
    // paint
    const time = t / 1000;
    for (const b of list) {
      const bob = Math.sin(time * (1.6 + v.boil * 6) + b.phase) * (1.5 + v.boil * 4);
      const sc = b === lifting ? (b.scale || 1) : 1;
      b.el.style.transform = `translate(${(b.x - b.w / 2).toFixed(1)}px, ${(b.y - b.h / 2 + bob).toFixed(1)}px) scale(${sc.toFixed(3)})`;
    }
  }

  function pop(v, b) {
    b.el.classList.add('pop');
    v.popped = b.id;
    // the burst of green sparks, where the bubble was
    const { W, H } = v.size;
    v.burst.style.left = `${((b.x + W / 2) / W * 70 + 15).toFixed(2)}%`;
    v.burst.style.top = `${((b.y + H / 2) / H * 26.5 + 29.5).toFixed(2)}%`;
    v.burst.innerHTML = Array.from({ length: 16 }, (_, i) => `<i style="--a:${(i * 22.5 + rnd(-8, 8)).toFixed(1)}deg;--d:${rnd(0.7, 1.15).toFixed(2)}"></i>`).join('');
    v.burst.classList.remove('go'); void v.burst.offsetWidth; v.burst.classList.add('go');
    v.timers.push(setTimeout(() => b.el.classList.add('popped'), 300));
  }

  // ---------- a pick ----------
  function run(doc, s, { sound = false } = {}) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    v.timers.forEach(clearTimeout); v.timers = [];
    v.active = s;
    v.el.dataset.state = 'boiling';
    const b = v.bubbles.get(s.winnerId);
    if (b) { b.lift = null; b.scale = 1; b.el.classList.remove('lifted', 'pop', 'popped'); }
    if (sound) brewSound(v, s);
  }
  // after the reveal: the popped bubble stays gone; with No repeats off it
  // bubbles back up a moment later
  function finish(doc, s, { respawn = false } = {}) {
    const v = views.get(doc);
    if (!v) return;
    v.active = null;
    v.el.dataset.state = 'picked';
    const b = v.bubbles.get(s.winnerId);
    if (b) { b.lift = null; b.scale = 1; b.el.classList.add('popped'); }
    if (respawn) v.timers.push(setTimeout(() => {
      const bb = v.bubbles.get(s.winnerId);
      if (!bb || v.active) return;
      bb.el.classList.remove('popped', 'pop', 'lifted');
      bb.x = rnd(-0.3, 0.3) * v.size.W / 2; bb.y = v.size.H / 2 * 0.5; bb.vx = 0; bb.vy = -40;
      bb.el.classList.remove('born'); void bb.el.offsetWidth; bb.el.classList.add('born');
      if (v.popped === s.winnerId) v.popped = null;
    }, 1600));
  }
  // the name above the cauldron (state: '' | 'boiling' | 'picked')
  function setWinner(doc, name, state) {
    const v = views.get(doc);
    if (!v) return;
    if (state === 'picked' && name) {
      v.winnerEl.textContent = name;
      v.winnerEl.dataset.len = name.length > 12 ? 'long' : '';
      v.el.dataset.state = 'picked';
    } else if (state === 'boiling') {
      v.el.dataset.state = 'boiling';          // the old name fades out
    } else {
      v.winnerEl.textContent = '';
      if (!v.active) v.el.dataset.state = '';
    }
  }
  function setDisabled(doc, off) {
    const v = views.get(doc);
    if (v) v.el.setAttribute('aria-disabled', String(!!off));
  }

  // ---------- sound: bubbling that builds, then a pop ----------
  let ctx = null;
  function audio() {
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
    return ctx;
  }
  function bloop(c, at, level) {
    const o = c.createOscillator(), g = c.createGain();
    const f0 = rnd(160, 340) * (1 + level * 0.5);
    const len = rnd(0.05, 0.11);
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f0 * rnd(2.2, 3.2), at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.035 + level * 0.05, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + len + 0.02);
  }
  function brewSound(v, s) {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const t0 = c.currentTime;
    const boil = s.duration / 1000, rise = (s.settle * (RISE + HOVER)) / 1000;
    // the bubbling: sparse at first, a rolling boil by the end of the churn
    let t = 0;
    while (t < boil + rise * 0.6) {
      const level = t < boil ? easeIn(t / boil) : Math.max(0, 1 - (t - boil) / rise);
      bloop(c, t0 + t, level);
      if (level > 0.5 && Math.random() < level * 0.6) bloop(c, t0 + t + rnd(0.01, 0.04), level);
      t += 1 / (3 + level * 24) * rnd(0.6, 1.4);
    }
    // a low simmer under it, swelling with the boil
    try {
      const len = boil + rise;
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf; lp.type = 'lowpass'; lp.frequency.value = 380;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.09, t0 + boil);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      src.connect(lp); lp.connect(g); g.connect(c.destination);
      src.start(t0); src.stop(t0 + len);
    } catch { /* ignore */ }
    // the pop on the reveal
    const at = t0 + (s.duration + s.settle * (RISE + HOVER)) / 1000;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, at);
    o.frequency.exponentialRampToValueAtTime(110, at + 0.14);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.22, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    o.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + 0.2);
  }

  window.Cauldron = { BOIL_MS, DURATION_MS: BOIL_MS, SETTLE_MS, isOn, build, sync, run, finish, setWinner, setDisabled };
})();
