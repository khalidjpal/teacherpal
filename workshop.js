// workshop.js — the Name Wheel's winter skin: Santa's sleigh on a snowy hilltop.
//
// Night on a hilltop: stars, a moon, snowy hills and a few pines behind (all
// still). A big heaped pile of wrapped presents fills the left and centre,
// one per student, stacked and tumbled together, each with the student's
// name on its gift tag. Santa sits in his sleigh on the right, reins in hand,
// two reindeer hitched in front and a big open sack beside him.
//
// A pick (the T timeline below): Santa leans out of the sleigh and rummages
// through the pile, lifting one present and putting it back, shoving another
// aside, digging, while the presents near his hand jostle. The winner pops
// out of the pile into his hand (the pile settles into the gap), he sits up
// and holds it high, and the name comes up large. Then he tosses it over his
// shoulder into the sack, which bulges, and it lands on the load in the
// sleigh.
//
// The round (No repeats on): the pile shrinks as the class is called and the
// load in the sleigh grows, names readable on the tags; "7 / 28" is on the
// sleigh's side. When everyone's been picked the reindeer take off with the
// loaded sleigh. "Let them out" (or Reset) brings it back and dumps the load
// back into a fresh pile. Today's absentees are on a small notice staked in
// the snow, "Not here today".
//
// Same shape as farmyard.js / boba.js (wheel.js's skins): isOn, build, sync,
// run, finish, setWinner, setDisabled, setPicked, setAbsent, busy,
// HOLDS_ROUND, DURATION_MS, SETTLE_MS. It never picks anybody: the winner
// comes in the spin descriptor, already drawn by wheel.js. Everything a pick
// shows is worked out from the descriptor (a seeded random of
// winnerId:startedAt), so the full screen window plays the same pick.
//
// Still on purpose: nothing moves at rest. Santa and the presents are moved
// from JS (no CSS animations on them), only during a pick, a reflow of the
// pile or the dump back.
(function () {
  'use strict';

  const DURATION_MS = 3300;     // the click to the name
  const SETTLE_MS = 1800;       // held up, then over his shoulder into the sack
  // the timeline (ms from the click)
  const T = {
    lean: 150, leaned: 560, d1: 620, d1back: 1250, d2: 1330, d2back: 1820,
    pop: 2250, caught: 2650, held: 3080, name: 3300, toss: 4350, land: 4950,
  };
  const PARTY_MS = 3200;
  const H = 400;                // the scene is 400 units tall, as wide as the box
  const BASE = 386;             // the pile's bottom row stands here
  const RIDE_Y = 366;           // the sleigh's runners
  const RIDE_W = 300;           // the sleigh + reindeer, in their own units
  const SA = { x: 42, y: -44, s: 0.7 };    // Santa in the sleigh (ride units; his hips)
  const LOAD = { x0: 60, x1: 196, bed: -61, h: 236 };   // the load, ride units
  const SACK = { x: 172, y: -58 };
  const LEAN = -24;             // leaning out over the pile (deg)
  const NOTE_STEP = 9.4;

  const views = new Map();
  // winter, unless the teacher chose the sled race (data-wpick, sled.js)
  const isOn = (doc) => doc.documentElement.getAttribute('data-theme') === 'winter' && doc.documentElement.getAttribute('data-wpick') !== 'race';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const qb = (a, c, b, u) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * c + u * u * b;
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const seeded = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const reduced = (doc) => !!doc.defaultView.matchMedia && doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const soundOn = (doc) => { const m = doc.getElementById('wheel-mute'); return !!m && m.getAttribute('aria-checked') !== 'true'; };
  const isPopout = (v) => v.doc.body.classList.contains('wheel-popout');
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (doc, tag, cls) => { const e = doc.createElementNS(NS, tag); if (cls) e.setAttribute('class', cls); return e; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortName = (s) => { s = String(s || ''); return s.length > 9 ? `${s.slice(0, 8).trimEnd()}…` : s; };
  const n1 = (k) => k.toFixed(1);
  const D2R = Math.PI / 180;

  // ---------- the scene's geometry (W = its width in units) ----------
  function geo(W) {
    const rs = clamp((W * 0.42) / RIDE_W, 0.6, 1.35);
    const rx = W - 8 - RIDE_W * rs;
    return {
      W,
      ride: { x: rx, y: RIDE_Y, s: rs },
      pile: { x0: W * 0.035, x1: rx + 4, base: BASE, top: 72 },
      note: { x: W * 0.035 + 44, base: 292 },
    };
  }

  // the pile: a heap of rows, each one present shorter than the one under it
  // and staggered by half, sized for the whole round so a pick never resizes
  // it. Slots run bottom row first, centre out, so the first m slots are
  // always a heap and it shrinks from the top.
  const STEP = 0.6, GAP = 0.86;    // rows overlap; neighbours overlap a little too
  function pileSlots(G, N, left) {
    N = Math.max(1, N);
    const P = G.pile, x0 = P.x0 + (left || 0), PW = P.x1 - x0, PH = P.base - P.top;
    let best = null;
    const count = (c0, slope, r) => Math.max(1, c0 - Math.floor(r * slope));
    for (const slope of [1, 0.5]) for (let c0 = 1; c0 <= N; c0++) {
      let rows = 0, sum = 0;
      while (sum < N && rows < 40) { sum += count(c0, slope, rows); rows++; }
      const b = Math.min(PW / (GAP * c0 + 0.4), PH / ((rows - 1) * STEP + 1.05), 96);
      if (!best || b > best.b + 0.01) best = { c0, rows, b, slope };
    }
    const { c0, rows, b, slope } = best, rnd = seeded(N * 7919 + 13), cx = (x0 + P.x1) / 2 - b * 0.08;
    const slots = [];
    for (let r = 0; r < rows && slots.length < N; r++) {
      const c = count(c0, slope, r), y = P.base - r * STEP * b;
      const shift = c === count(c0, slope, r - 1) && r > 0 ? (r % 2 ? 0.22 : -0.22) * b : 0;
      const order = [];
      for (let i = 0; i < c; i++) order.push(i);
      order.sort((a, z) => Math.abs(a - (c - 1) / 2) - Math.abs(z - (c - 1) / 2) || a - z);
      for (const i of order) {
        if (slots.length >= N) break;
        slots.push({ r, x: cx + shift + (i - (c - 1) / 2) * b * GAP + (rnd() - 0.5) * b * 0.12, y: y + (rnd() - 0.5) * b * 0.05, rot: (rnd() - 0.5) * 17 });
      }
    }
    return { b, slots, sc: b / 58, cx };
  }

  // the load in the sleigh (ride units): stacked rows on the bed
  function loadGeom(n) {
    n = Math.max(1, n);
    const LW = LOAD.x1 - LOAD.x0;
    let best = null;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const b = Math.min(LW / c, LOAD.h / ((r - 1) * STEP + 1.05), 52);
      if (!best || b > best.b + 0.01) best = { c, r, b };
    }
    return best;
  }
  function loadSlot(L, j) {
    const row = Math.floor(j / L.c), col = j % L.c, LW = LOAD.x1 - LOAD.x0;
    const x = LOAD.x0 + (LW - L.c * L.b) / 2 + L.b * (col + 0.5) + (row % 2 ? L.b * 0.12 : -L.b * 0.06) - L.b * 0.08;
    const rot = ((hash(`l${j}`) % 9) - 4) * 1.6;
    return { x, y: LOAD.bed - row * L.b * STEP, rot, sc: L.b / 58 };
  }

  // ---------- a present (its own units; the origin is the bottom of its front face) ----------
  const PAPERS = 6, RIBBONS = 4;
  const CLASH = { 0: 2, 1: 3, 3: 0, 5: 1 };       // paper → the ribbon that would vanish on it
  function giftLook(id) {
    const h = hash(id);
    const p = (h >>> 9) % PAPERS;
    let rb = (h >>> 12) % RIBBONS;
    if (CLASH[p] === rb) rb = (rb + 1) % RIBBONS;
    return { w: 36 + (h % 13), h: 30 + ((h >>> 5) % 14), p, rb, pat: (h >>> 15) % 3 };
  }
  function boxMarkup(look, label) {
    const { w, h, pat } = look;
    const d = w * 0.2, lift = d * 0.55;
    const L = -w / 2, R = w / 2, top = -h;
    const rb = Math.max(2.6, w * 0.1);
    let patt = '';
    if (pat === 0) for (let i = 0; i < 4; i++) patt += `<rect class="ws-g-pat" x="${n1(L + w * (i + 0.5) / 4 - w * 0.045)}" y="${n1(top)}" width="${n1(w * 0.09)}" height="${n1(h)}"/>`;
    else if (pat === 1) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) patt += `<circle class="ws-g-pat" cx="${n1(L + w * (i * 2 + 1 + (j % 2) * 0.8) / 6.8)}" cy="${n1(top + h * (j * 2 + 1) / 4)}" r="${n1(Math.max(1.2, w * 0.045))}"/>`;
    else patt = `<path class="ws-g-pat-l" d="M${n1(L + 2)} ${n1(top + 2)}H${n1(R - 2)}V-2H${n1(L + 2)}Z"/>`;
    const bx = d / 2, by = top - lift / 2, bs = clamp(w / 40, 0.5, 1.2);
    // the gift tag: big on the front, the name filling it
    const name = shortName(label), tw = w * 0.9, th = Math.max(11, h * 0.42), ty = top + h * 0.4;
    const fs = Math.min(th * 0.74, (tw - 3) / (Math.max(3, name.length) * 0.54));
    return `<ellipse class="ws-g-shadow" cx="${n1(d * 0.4)}" cy="0.4" rx="${n1(w * 0.6)}" ry="2.2"/>
      <path class="ws-g-side" d="M${n1(R)} ${n1(top)}L${n1(R + d)} ${n1(top - lift)}V${n1(-lift)}L${n1(R)} 0Z"/>
      <rect class="ws-g-front" x="${n1(L)}" y="${n1(top)}" width="${n1(w)}" height="${n1(h)}"/>
      ${patt}
      <path class="ws-g-top" d="M${n1(L)} ${n1(top)}L${n1(L + d)} ${n1(top - lift)}H${n1(R + d)}L${n1(R)} ${n1(top)}Z"/>
      <rect class="ws-g-rb" x="${n1(-rb / 2)}" y="${n1(top)}" width="${n1(rb)}" height="${n1(h)}"/>
      <path class="ws-g-rb-l" stroke-width="${n1(rb * 0.8)}" d="M${n1(R + d / 2)} ${n1(top - lift / 2)}V${n1(-lift / 2)}M0 ${n1(top)}L${n1(d)} ${n1(top - lift)}M${n1(L + d / 2)} ${n1(top - lift / 2)}H${n1(R + d / 2)}"/>
      <g class="ws-g-bow" transform="translate(${n1(bx)} ${n1(by)}) scale(${bs.toFixed(2)})"><path class="ws-g-loop" d="M0 0C-3-6-10-7-9-2C-8 2-3 1 0 0ZM0 0C3-6 10-7 9-2C8 2 3 1 0 0Z"/><path class="ws-g-tail" d="M0 0L-4 6M0 0L4 6"/><circle class="ws-g-knot" r="1.8"/></g>
      <g class="ws-g-tag" transform="translate(0 ${n1(ty)}) rotate(-3)"><path class="ws-g-string" d="M${n1(-tw / 2 + 2)} ${n1(-th / 2)}L${n1(-rb / 2)} ${n1(-th / 2 - 5)}"/><rect x="${n1(-tw / 2)}" y="${n1(-th / 2)}" width="${n1(tw)}" height="${n1(th)}" rx="2"/><circle class="ws-g-hole" cx="${n1(-tw / 2 + 2.6)}" cy="${n1(-th / 2 + 2.6)}" r="0.9"/><text class="ws-g-name" y="${n1(fs * 0.35)}" font-size="${n1(fs)}">${esc(name)}</text></g>`;
  }
  // a present's transform: bottom-centre at (x, y), turned rot about its middle
  function giftT(look, x, y, rot, sc) {
    const hc = (look.h * sc) / 2;
    return `translate(${n1(x)} ${n1(y - hc)}) rotate(${n1(rot)}) translate(0 ${n1(hc)}) scale(${sc.toFixed(3)})`;
  }

  // ---------- the hilltop (static) ----------
  function pine(x, y, s) {
    return `<g transform="translate(${n1(x)} ${n1(y)}) scale(${s.toFixed(2)})"><path class="ws-pine-b" d="M0-46L-13-24H-7L-17-6H-9L-20 10H20L9-6H17L7-24H13Z"/><path class="ws-pine-s" d="M0-46L-6-34Q0-31 6-34ZM-9-22Q0-18 9-22L7-26Q0-23-7-26ZM-13-4Q0 0 13-4L10-8Q0-5-10-8Z"/><rect class="ws-trunk" x="-2.4" y="10" width="4.8" height="6"/></g>`;
  }
  function bgMarkup(G) {
    const W = G.W, r = seeded(11), mx = W * 0.74, my = 58;
    let stars = '';
    for (let i = 0, n = Math.round(W / 11); i < n; i++) {
      const x = r() * W, y = 6 + r() * 186, s = 0.45 + r() * 1.05;
      if (Math.hypot(x - mx, y - my) > 46) stars += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${s.toFixed(2)}"/>`;
    }
    let far = '', mid = '', spark = '';
    [0.06, 0.15, 0.29, 0.4, 0.58, 0.66, 0.8, 0.93].forEach((f, i) => { far += pine(W * f, 222 + (i % 3) * 4, 0.42 + (i % 2) * 0.12); });
    [0.03, 0.24, 0.52, 0.97].forEach((f, i) => { mid += pine(W * f, 256 + (i % 2) * 4, 0.7 + (i % 2) * 0.16); });
    for (let i = 0, n = Math.round(W / 16); i < n; i++) spark += `<circle cx="${n1(r() * W)}" cy="${n1(302 + r() * 96)}" r="${(0.4 + r() * 0.6).toFixed(2)}"/>`;
    return `
      <rect class="ws-sky" x="0" y="0" width="${W}" height="${H}" fill="url(#ws-sky-grad)"/>
      <g class="ws-stars">${stars}</g>
      <circle cx="${n1(mx)}" cy="${my}" r="60" fill="url(#ws-moon-grad)"/>
      <path class="ws-moon" d="M${n1(mx)} ${my - 17}a17 17 0 1 0 14 27a13.5 13.5 0 1 1 -14 -27Z"/>
      <path class="ws-hill-far" d="M0 ${H}V218Q${n1(W * 0.12)} 188 ${n1(W * 0.27)} 208T${n1(W * 0.56)} 200T${n1(W * 0.83)} 194T${W} 208V${H}Z"/>
      <path class="ws-hill-far-s" d="M0 ${H}V234Q${n1(W * 0.14)} 208 ${n1(W * 0.3)} 224T${n1(W * 0.6)} 218T${W} 224V${H}Z"/>
      ${far}
      <path class="ws-hill-mid" d="M0 ${H}V262Q${n1(W * 0.2)} 240 ${n1(W * 0.42)} 254T${n1(W * 0.86)} 246T${W} 258V${H}Z"/>
      ${mid}
      <path class="ws-snow-g" d="M0 ${H}V300Q${n1(W * 0.18)} 280 ${n1(W * 0.45)} 286T${W} 296V${H}Z"/>
      <path class="ws-snow-sh" d="M0 ${H}V372Q${n1(W * 0.3)} 360 ${n1(W * 0.6)} 368T${W} 364V${H}Z"/>
      <g class="ws-sparkle">${spark}</g>`;
  }

  // ---------- the sleigh, the sack and the reindeer (ride units, ground y 0, facing right) ----------
  const DEER = `
    <g class="wr-deer">
      <g transform="translate(-16 -30)"><path class="wr-leg-p" d="M0 0L-1 27"/><path class="wr-hoof" d="M-3.4 27.4h4.6"/></g>
      <g transform="translate(14 -30)"><path class="wr-leg-p" d="M0 0L1 27"/><path class="wr-hoof" d="M-1.4 27.4h4.6"/></g>
      <path class="wr-tail" d="M-24-42Q-30-44-29-49Q-25-48-23-44Z"/>
      <ellipse class="wr-body" cx="-1" cy="-38" rx="25" ry="12.5"/>
      <ellipse class="wr-belly" cx="1" cy="-31" rx="17" ry="5"/>
      <path class="wr-neck" d="M11-46L19-63L28-59L25-38Z"/>
      <path class="wr-collar" d="M12-48Q19-43 26-47L25.4-42Q19-38 12.6-43Z"/>
      <circle class="wr-bell" cx="18.6" cy="-40.6" r="2.3"/><circle class="wr-bell" cx="23.8" cy="-42.6" r="1.9"/>
      <g transform="translate(22 -58)">
        <path class="wr-antler" d="M-2-6L-6-20M-4-14L-11-17M-5-18L-4-26M2-6L4-21M3-14L9-18M4-19L2-27"/>
        <path class="wr-ear" d="M-4-5L-10-9L-5-1Z"/>
        <ellipse class="wr-face" cx="4" cy="-2" rx="8.5" ry="6" transform="rotate(18 4 -2)"/>
        <ellipse class="wr-muzzle" cx="10.5" cy="1.5" rx="3.8" ry="3.2"/>
        <circle class="wr-nose" cx="13.4" cy="0.6" r="1.7"/>
        <circle class="wr-eye" cx="4.5" cy="-4" r="1.1"/>
      </g>
      <g transform="translate(-10 -30)"><path class="wr-leg-p" d="M0 0L-1 27"/><path class="wr-hoof" d="M-3.4 27.4h4.6"/></g>
      <g transform="translate(18 -30)"><path class="wr-leg-p" d="M0 0L1 27"/><path class="wr-hoof" d="M-1.4 27.4h4.6"/></g>
    </g>`;
  // where the reins meet each deer's collar (ride units)
  const REIN_FAR = { x: 262 + 19 * 0.9, y: -4 - 45 * 0.9 }, REIN_NEAR = { x: 236 + 19, y: -45 };
  const SACK_MARKUP = `
    <g class="ws-sack-in">
      <path class="ws-sack-b" d="M-28 2C-38-16-34-46-20-60Q0-66 20-60C34-46 38-16 28 2Z"/>
      <path class="ws-sack-sh" d="M10-60C26-48 30-20 24 2H28C38-16 34-46 20-60Z"/>
      <path class="ws-sack-fold" d="M-14-50Q-18-30-12-8M6-52Q10-30 4-6"/>
      <ellipse class="ws-sack-mouth" cx="0" cy="-60" rx="21" ry="6.4"/>
      <ellipse class="ws-sack-dark" cx="0" cy="-59" rx="16" ry="4"/>
      <path class="ws-sack-tie" d="M-12-52Q0-47 12-52"/>
    </g>`;
  function rideMarkup() {
    return `
      <g class="ws-ride-fly">
        <ellipse class="ws-ride-shadow" cx="150" cy="2" rx="160" ry="8"/>
        <path class="ws-harness" d="M186-40Q212-34 238-40M186-47Q226-52 262-47"/>
        <g class="ws-deer-far" transform="translate(262 -4) scale(0.9)">${DEER}</g>
        <g class="ws-sleigh-back">
          <path class="ws-runner-o" d="M-6 0H176Q200 0 200-20Q200-38 184-36Q176-35 178-28"/>
          <path class="ws-runner" d="M-6 0H176Q200 0 200-20Q200-38 184-36Q176-35 178-28"/>
          <path class="ws-strut" d="M28 0V-15M92 0V-15M152 0V-15"/>
          <path class="ws-sleigh-b" d="M6-14H166C182-14 190-26 190-42C190-58 182-66 172-66H40C34-90 26-110 10-112C-2-113-6-104-2-98C2-93 8-95 8-100C10-80 4-40 6-14Z"/>
          <path class="ws-trim" d="M40-66H172C182-66 190-58 190-42M40-66C34-90 26-110 10-112"/>
          <path class="ws-sleigh-in" d="M14-62H174Q184-62 186-54"/>
        </g>
        <g class="ws-sack" transform="translate(${SACK.x} ${SACK.y})">${SACK_MARKUP}</g>
        <g class="ws-load"></g>
        <g class="ws-santa-slot"></g>
        <g class="ws-sleigh-front">
          <path class="ws-sleigh-f" d="M6-14H166C182-14 190-26 190-42C190-54 186-60 178-61H7C6-44 5-28 6-14Z"/>
          <path class="ws-sleigh-sh" d="M8-18H166C178-18 186-28 187-40C184-30 178-24 166-24H10Z"/>
          <path class="ws-trim" d="M7-61H178Q187-60 190-46"/>
          <path class="ws-swirl" d="M24-30q8-12 18-2q6 6 12-2M178-30q-8-12-18-2q-6 6-12-2"/>
          <g class="ws-count" transform="translate(108 -38)"><rect x="-27" y="-10" width="54" height="20" rx="3.4"/><text y="4.4"></text></g>
        </g>
        <path class="ws-reins"/>
        <g class="ws-deer-near" transform="translate(236 0)">${DEER}</g>
      </g>`;
  }

  // ---------- Santa (front view, sitting; the origin is his hips) ----------
  const SA_ARM = '<path class="sa-sleeve-o" d="M0 0L0 46"/><path class="sa-sleeve" d="M0 0L0 46"/><path class="sa-cuff" d="M0 40L0 48"/><circle class="sa-glove" cx="0" cy="56" r="8.6"/>';
  const SANTA = `
    <g class="sa-lean">
      <g class="sa-body">
        <path class="sa-coat" d="M-62 4C-64-34-58-60-38-70Q0-82 38-70C58-60 64-34 62 4Z"/>
        <path class="sa-coat-sh" d="M30-68C50-60 58-38 58 4H46C48-30 44-54 30-68Z"/>
        <rect class="sa-fur" x="-8" y="-72" width="16" height="76"/>
        <rect class="sa-belt" x="-60" y="-30" width="120" height="9"/>
        <rect class="sa-buckle" x="-8" y="-32" width="16" height="13" rx="2"/>
      </g>
      <g transform="translate(46 -62)"><g class="sa-arm r">${SA_ARM}</g></g>
      <g transform="translate(0 -70)"><g class="sa-head"><g transform="translate(0 70)">
        <path class="sa-hair" d="M-25-106Q-31-92-26-80L-18-86Q-21-96-17-106ZM25-106Q31-92 26-80L18-86Q21-96 17-106Z"/>
        <ellipse class="sa-ear" cx="-19.5" cy="-99" rx="4" ry="5.6"/><ellipse class="sa-ear" cx="19.5" cy="-99" rx="4" ry="5.6"/>
        <ellipse class="sa-face" cx="0" cy="-100" rx="19" ry="20"/>
        <path class="sa-beard" d="M-21-97C-29-84-29-62-19-50C-12-42-6-40 0-38C6-40 12-42 19-50C29-62 29-84 21-97C15-88 8-86 0-86C-8-86-15-88-21-97Z"/>
        <path class="sa-beard-l" d="M-15-70q4 4 8 0M3-64q4 4 8 0M-7-53q4 4 8 0M-18-60q3 3 6 0M12-75q3 3 6 0"/>
        <path class="sa-mouth" d="M-4.4-82Q0-78.6 4.4-82"/>
        <path class="sa-grin" d="M-6-83Q0-75 6-83Z"/>
        <path class="sa-mous" d="M0-90C-4-94-14-94-19-86C-12-88-6-86 0-84C6-86 12-88 19-86C14-94 4-94 0-90Z"/>
        <circle class="sa-cheek" cx="-12" cy="-94" r="4"/><circle class="sa-cheek" cx="12" cy="-94" r="4"/>
        <ellipse class="sa-nose" cx="0" cy="-94" rx="4.6" ry="4"/>
        <g class="sa-eyes"><circle class="sa-eye" cx="-7.5" cy="-102" r="1.9"/><circle class="sa-eye" cx="7.5" cy="-102" r="1.9"/></g>
        <path class="sa-brow" d="M-13.4-109Q-8-112.4-3-109.6M13.4-109Q8-112.4 3-109.6"/>
        <path class="sa-hat" d="M-21-111C-20-130-6-140 8-138C22-136 32-128 38-116C40-112 43-110 45-112L48-106C41-102 35-109 31-115C27-121 23-120 21-112Z"/>
        <circle class="sa-pom" cx="47" cy="-107" r="5.6"/>
        <rect class="sa-brim" x="-24" y="-119" width="48" height="10.5" rx="5.2"/>
      </g></g></g>
      <g transform="translate(-46 -62)"><g class="sa-arm l">${SA_ARM}</g></g>
    </g>`;
  const REST = { lean: 0, l: -8, lf: 1, r: -58, rf: 1.05, head: 0, grin: false };
  function makeSanta(v) {
    const g = svgEl(v.doc, 'g', 'santa');
    g.setAttribute('transform', `translate(${SA.x} ${SA.y}) scale(${SA.s})`);
    g.innerHTML = SANTA;
    const q = (s) => g.querySelector(s);
    const arm = (side) => { const a = q(`.sa-arm.${side}`); return { g: a, so: a.querySelector('.sa-sleeve-o'), s: a.querySelector('.sa-sleeve'), c: a.querySelector('.sa-cuff'), gl: a.querySelector('.sa-glove'), f: 1 }; };
    return { g, lean: q('.sa-lean'), head: q('.sa-head'), l: arm('l'), r: arm('r'), a: { ...REST }, last: {}, cls: '' };
  }
  function setArmLen(a, f) {
    if (Math.abs(a.f - f) < 0.005) return;
    a.f = f;
    const L = 46 * f;
    a.so.setAttribute('d', `M0 0L0 ${n1(L)}`);
    a.s.setAttribute('d', `M0 0L0 ${n1(L)}`);
    a.c.setAttribute('d', `M0 ${n1(L - 6)}L0 ${n1(L + 2)}`);
    a.gl.setAttribute('cy', n1(L + 10));
  }
  // Santa's arms: where a glove is (ride units) for an arm angle, stretch and
  // lean, and the angle + stretch that put a glove on a spot
  function gloveRide(side, ang, f, lean) {
    const sx = side === 'l' ? -46 : 46, a = ang * D2R, len = 46 * f + 10;
    const lx = sx - Math.sin(a) * len, ly = -62 + Math.cos(a) * len, L = lean * D2R;
    return { x: SA.x + (lx * Math.cos(L) - ly * Math.sin(L)) * SA.s, y: SA.y + (lx * Math.sin(L) + ly * Math.cos(L)) * SA.s };
  }
  function armSolve(side, p, lean) {
    const sx = side === 'l' ? -46 : 46, L = -lean * D2R;
    const px = (p.x - SA.x) / SA.s, py = (p.y - SA.y) / SA.s;
    const lx = px * Math.cos(L) - py * Math.sin(L), ly = px * Math.sin(L) + py * Math.cos(L);
    const dx = lx - sx, dy = ly + 62;
    return { ang: Math.atan2(-dx, dy) / D2R, f: clamp((Math.hypot(dx, dy) - 10) / 46, 0.7, 1.9) };
  }

  // ---------- the view ----------
  const markup = () => `
    <svg class="ws-svg" viewBox="0 0 800 ${H}" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ws-sky-grad" x1="0" y1="0" x2="0" y2="1"><stop class="ws-sky-a" offset="0"/><stop class="ws-sky-b" offset="0.75"/></linearGradient>
        <radialGradient id="ws-moon-grad"><stop class="ws-mg-a" offset="0"/><stop class="ws-mg-b" offset="1"/></radialGradient>
      </defs>
      <g class="ws-bg"></g>
      <g class="ws-note" hidden></g>
      <g class="ws-pile"></g>
      <g class="ws-ride"></g>
      <g class="ws-actors"></g>
    </svg>
    <button type="button" class="ws-pour" hidden>Let them out</button>
    <div class="ws-name" aria-hidden="true"><span></span></div>
    <div class="ws-burst" aria-hidden="true"></div>
    <div class="ws-burst ws-puff" aria-hidden="true"></div>
    <div class="ws-burst ws-burst-ride" aria-hidden="true"></div>`;

  function build(doc) {
    if (views.has(doc)) return views.get(doc).el;
    const wrap = doc.querySelector('.wheel-wrap');
    if (!wrap) return null;
    const el = doc.createElement('div');
    el.className = 'workshop';
    el.id = 'workshop';
    el.dataset.state = '';
    el.innerHTML = markup();
    wrap.appendChild(el);
    const q = (s) => el.querySelector(s);
    const v = {
      doc, el,
      svg: q('.ws-svg'), bg: q('.ws-bg'), noteG: q('.ws-note'), pileG: q('.ws-pile'), ride: q('.ws-ride'), actors: q('.ws-actors'),
      pourBtn: q('.ws-pour'), name: q('.ws-name'), burst: q('.ws-burst'), puff: q('.ws-puff'), burstRide: q('.ws-burst-ride'),
      carry: svgEl(doc, 'g', 'ws-carry'),
      G: null, W: 0, k: 1, offX: 0, offY: 0, bw: 0, bh: 0,
      disp: [], absent: [], absentSig: '', picked: null, total: 0,
      pile: new Map(), slots: null, slotKey: '', pileReady: false, snap: false, off: new Map(), loadPos: new Map(),
      out: null, landed: null, justLanded: null, carryOn: null, saPose: null, revealed: null, landedDone: null,
      active: null, plan: null, done: new Set(), sound: false, dumpAt: 0, dumpHide: false,
      full: false, wasFull: undefined, offBtn: false, pouring: false, last: 0,
    };
    v.santa = makeSanta(v);
    v.carry.style.display = 'none';
    v.actors.appendChild(v.carry);
    views.set(doc, v);
    v.pourBtn.addEventListener('click', (e) => { e.stopPropagation(); pour(v); });
    v.pourBtn.addEventListener('keydown', (e) => e.stopPropagation());
    const win = doc.defaultView;
    if (win.ResizeObserver) new win.ResizeObserver(() => layout(v)).observe(el);
    layout(v);
    const frame = (t) => { step(v, t); win.requestAnimationFrame(frame); };
    win.requestAnimationFrame(frame);
    return el;
  }

  // 400 units tall and as wide as the box; the scene is laid out from the width
  function layout(v) {
    const bw = v.el.clientWidth, bh = v.el.clientHeight;
    if (!bw || !bh) return;
    const W = Math.round(clamp((H * bw) / bh, 620, 1500));
    v.bw = bw; v.bh = bh;
    v.k = Math.min(bw / W, bh / H);
    v.offX = (bw - W * v.k) / 2;
    v.offY = bh - H * v.k;
    v.el.style.setProperty('--u', `${v.k.toFixed(4)}px`);
    if (W !== v.W || !v.bg.firstChild) {
      v.W = W;
      const G = v.G = geo(W);
      v.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      v.bg.innerHTML = bgMarkup(G);
      v.R = G.ride;
      v.ride.setAttribute('transform', `translate(${n1(v.R.x)} ${v.R.y}) scale(${v.R.s.toFixed(3)})`);
      if (!v.ride.firstChild) {
        v.ride.innerHTML = rideMarkup();
        v.loadG = v.ride.querySelector('.ws-load');
        v.sackG = v.ride.querySelector('.ws-sack');
        v.countG = v.ride.querySelector('.ws-count');
        v.reins = v.ride.querySelector('.ws-reins');
        v.ride.querySelector('.ws-santa-slot').appendChild(v.santa.g);
      }
      v.slotKey = '';
      v.snap = true;
      renderPile(v);
      renderLoad(v);
      renderNote(v);
      paintCount(v);
    }
    if (v.name.title) placeName(v);
  }
  const toPx = (v, x, y) => ({ x: v.offX + x * v.k, y: v.offY + y * v.k });
  const rideToScene = (v, p) => ({ x: v.R.x + p.x * v.R.s, y: v.R.y + p.y * v.R.s });

  // ---------- the pile ----------
  // who's in it: the wheel's list, less anyone picked, in the sleigh or in
  // Santa's hand
  function pileItems(v) {
    const gone = new Set((v.picked || []).map((p) => p.id));
    if (v.landed) gone.add(v.landed.id);
    if (v.out) gone.add(v.out);
    return v.disp.filter((it) => !gone.has(it.id));
  }
  function roundSize(v) {
    const s = new Set(v.disp.map((i) => i.id));
    for (const p of v.picked || []) s.add(p.id);
    if (v.landed) s.add(v.landed.id);
    return s.size;
  }
  function renderPile(v) {
    if (!v.G) return;
    const items = pileItems(v), N = roundSize(v), left = v.absent.length ? 96 : 0, key = `${v.W}|${N}|${left}`;
    if (key !== v.slotKey) { v.slotKey = key; v.slots = pileSlots(v.G, N, left); }
    const m = items.length, now = performance.now(), ids = new Set(items.map((i) => i.id));
    for (const [id, it] of v.pile) if (!ids.has(id)) { it.node.remove(); v.pile.delete(id); }
    // a present keeps its place; one higher up than the heap now reaches
    // tumbles down into a gap
    const taken = new Set(), rest = [];
    for (const i of items) {
      const it = v.pile.get(i.id);
      if (it && it.slot < m && !taken.has(it.slot)) taken.add(it.slot);
      else rest.push(i);
    }
    const holes = [];
    for (let s = 0; s < m; s++) if (!taken.has(s)) holes.push(s);
    rest.sort((a, b) => {
      const A = v.pile.get(a.id), B = v.pile.get(b.id);
      if (A && B) return B.slot - A.slot;
      if (A || B) return A ? -1 : 1;
      return hash(a.id) - hash(b.id);
    });
    let k = 0;
    rest.forEach((i, j) => {
      let it = v.pile.get(i.id);
      const slot = holes[j];
      if (!it) {
        it = { id: i.id, label: null, look: giftLook(i.id), node: svgEl(v.doc, 'g', 'ws-pp'), slot, x: 0, y: 0, rot: 0, key: '', fly: null };
        v.pile.set(i.id, it);
        v.pileG.appendChild(it.node);
        const s = v.slots.slots[slot], from = v.loadPos.get(i.id);
        if (!v.pileReady || !s) { it.x = s ? s.x : 0; it.y = s ? s.y : BASE; it.rot = s ? s.rot : 0; }
        else if (from) {
          // out of the sleigh, back onto the pile
          const at = Math.max(now, v.dumpAt) + (k++ % 40) * 45;
          it.fly = { from, t0: at, dur: 700, hide: v.dumpHide };
        } else it.fly = { from: { x: s.x, y: s.y - 70, rot: s.rot, sc: v.slots.sc * 0.3 }, t0: now, dur: 420, hide: false };
      }
      it.slot = slot;
    });
    for (const i of items) {
      const it = v.pile.get(i.id);
      if (it.label !== i.label) {
        it.label = i.label;
        it.node.setAttribute('class', `ws-pp ws-gift p${it.look.p} r${it.look.rb}`);
        it.node.innerHTML = `${boxMarkup(it.look, i.label)}<title>${esc(i.label)}</title>`;
      }
    }
    v.pileReady = true;
    orderPile(v);
  }
  // top rows behind, the bottom row in front; move only what's out of place
  function orderPile(v) {
    const slots = v.slots ? v.slots.slots : [];
    const list = [...v.pile.values()].sort((a, b) => ((slots[b.slot] || {}).r || 0) - ((slots[a.slot] || {}).r || 0) || a.slot - b.slot);
    let prev = null;
    for (const it of list) {
      const want = prev ? prev.nextSibling : v.pileG.firstChild;
      if (want !== it.node) v.pileG.insertBefore(it.node, want);
      prev = it.node;
    }
  }
  function stepPile(v, now, dt) {
    if (!v.slots) return;
    const sc0 = v.slots.sc, kk = v.snap || !dt ? 1 : 1 - Math.exp(-dt * 9);
    for (const it of v.pile.values()) {
      const s = v.slots.slots[it.slot];
      if (!s) continue;
      let x, y, rot, sc = sc0, show = true;
      if (it.fly) {
        const u = (now - it.fly.t0) / it.fly.dur, f = it.fly.from;
        if (u < 0) { show = !it.fly.hide; x = f.x; y = f.y; rot = f.rot; sc = f.sc; }
        else if (u < 1) {
          const e = smooth(u);
          x = lerp(f.x, s.x, e); y = qb(f.y, Math.min(f.y, s.y) - 80, s.y, e); rot = lerp(f.rot, s.rot + 360, e); sc = lerp(f.sc, sc0, e);
          it.x = x; it.y = y; it.rot = s.rot;
        } else { it.fly = null; it.x = s.x; it.y = s.y; it.rot = s.rot; }
      }
      if (!it.fly) {
        it.x += (s.x - it.x) * kk; it.y += (s.y - it.y) * kk; it.rot += (s.rot - it.rot) * kk;
        x = it.x; y = it.y; rot = it.rot;
      }
      const o = v.off.get(it.id);
      if (o) { x += o.dx; y += o.dy; rot += o.rot; }
      const key = show ? giftT(it.look, x, y, rot, sc) : 'hide';
      if (key !== it.key) {
        it.key = key;
        if (show) { it.node.setAttribute('transform', key); it.node.style.display = ''; }
        else it.node.style.display = 'none';
      }
    }
    v.snap = false;
  }
  // the top of a present in the pile (where a hand goes), scene units
  function itTop(v, it) {
    const sc = v.slots ? v.slots.sc : 1;
    return { x: it.x + it.look.w * 0.1 * sc, y: it.y - it.look.h * sc * 0.82 };
  }

  // the wheel's list: one present per name
  function sync(doc, list) {
    const v = views.get(doc);
    if (!v) return;
    v.disp = list || [];
    renderPile(v);
    paintCount(v);
  }

  // ---------- the load in the sleigh: everyone called this round ----------
  function loadList(v) {
    const list = (v.picked || []).slice();
    if (v.landed && !list.some((p) => p.id === v.landed.id)) list.push(v.landed);
    return list;
  }
  function renderLoad(v) {
    if (!v.loadG || !v.R) return;
    const list = loadList(v), L = loadGeom(Math.max(v.total || 0, list.length, 1));
    let s = '';
    const pos = new Map();
    for (let j = list.length - 1; j >= 0; j--) {
      const p = list[j], look = giftLook(p.id), at = loadSlot(L, j);
      s += `<g class="ws-gift p${look.p} r${look.rb}${p.id === v.justLanded ? ' new' : ''}" transform="${giftT(look, at.x, at.y, at.rot, at.sc)}"><g class="ws-ld-in">${boxMarkup(look, p.label)}</g><title>${esc(p.label)}</title></g>`;
      const sp = rideToScene(v, at);
      pos.set(p.id, { x: sp.x, y: sp.y, rot: at.rot, sc: at.sc * v.R.s });
    }
    v.loadG.innerHTML = s;
    v.loadPos = pos;
    // the sack swells as the round fills
    const fill = list.length / Math.max(1, v.total || list.length || 1);
    v.sackG.setAttribute('transform', `translate(${SACK.x} ${SACK.y}) scale(${(0.82 + 0.42 * clamp(fill, 0, 1)).toFixed(3)})`);
  }
  // where a present will sit in the load (scene units)
  function loadTarget(v, id) {
    const list = loadList(v);
    let j = list.findIndex((p) => p.id === id);
    if (j < 0) j = list.length;
    const L = loadGeom(Math.max(v.total || 0, j + 1, 1)), at = loadSlot(L, j), sp = rideToScene(v, at);
    return { x: sp.x, y: sp.y, rot: at.rot, sc: at.sc * v.R.s };
  }

  // ---------- the pick ----------
  function makePlan(v, s) {
    const rnd = seeded(hash(`${s.winnerId}:${s.startedAt}`));
    const P = { w: null, d: [], edge: null, wFrom: null, tossFrom: null };
    const it = v.pile.get(s.winnerId), d = v.disp.find((x) => x.id === s.winnerId);
    const label = it ? it.label : d ? d.label : null;
    if (label == null || !v.G) return P;
    P.w = { id: s.winnerId, label, look: giftLook(s.winnerId) };
    // two of the four presents nearest him to rummage through (seeded)
    const sh = rideToScene(v, gloveRide('l', 90, 1.4, LEAN));
    const near = [...v.pile.values()].filter((x) => x.id !== s.winnerId)
      .sort((a, b) => Math.hypot(a.x - sh.x, a.y - sh.y) - Math.hypot(b.x - sh.x, b.y - sh.y)).slice(0, 4);
    for (let i = near.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [near[i], near[j]] = [near[j], near[i]]; }
    P.d = near.slice(0, 2);
    P.edge = near[0] ? itTop(v, near[0]) : { x: v.G.pile.x1 - 20, y: BASE - 30 };
    return P;
  }
  const once = (v, key, due, fn) => { if (due && !v.done.has(key)) { v.done.add(key); fn(); } };
  const mixPt = (a, b, u) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) });
  const sceneToRide = (v, p) => ({ x: (p.x - v.R.x) / v.R.s, y: (p.y - v.R.y) / v.R.s });

  function pickStep(v, el) {
    const P = v.plan, w = P && P.w;
    const sa = { ...REST };
    v.saPose = sa;
    v.off = new Map();
    v.carryOn = null;
    if (!w) return;
    const look = w.look, sc0 = v.slots ? v.slots.sc : 0.8;
    const rest = rideToScene(v, gloveRide('l', REST.l, REST.lf, 0));
    const reach = (p, lean) => { const a = armSolve('l', sceneToRide(v, p), lean); sa.l = a.ang; sa.lf = a.f; };
    const gloveS = () => rideToScene(v, gloveRide('l', sa.l, sa.lf, sa.lean));
    const top = (it) => (it && v.pile.has(it.id) ? itTop(v, it) : P.edge);
    const d1 = P.d[0], d2 = P.d[1] || P.d[0];
    let hand = null, jostle = 0;
    if (el < T.lean) { /* sitting still */ }
    else if (el < T.pop) {
      sa.lean = LEAN * smooth((el - T.lean) / (T.leaned - T.lean));
      sa.head = -7 * smooth((el - T.lean) / 400);
      if (el < T.d1) hand = mixPt(rest, top(d1), smooth((el - T.lean) / (T.d1 - T.lean)));
      else if (el < T.d1back) {
        // lifts one, has a look, puts it back
        const u = (el - T.d1) / (T.d1back - T.d1), lift = Math.sin(clamp(u, 0, 1) * Math.PI);
        if (d1) v.off.set(d1.id, { dx: 5 * lift, dy: -36 * lift, rot: 16 * lift * Math.sin(u * Math.PI * 3) });
        hand = { x: top(d1).x + 5 * lift, y: top(d1).y - 36 * lift };
        sa.head = -7 + 5 * lift;
        once(v, 'd1', true, () => v.sound && rustle());
        once(v, 'd1b', u > 0.7, () => v.sound && tap(0.6));
        jostle = 0.8;
      } else if (el < T.d2) hand = mixPt(top(d1), top(d2), smooth((el - T.d1back) / (T.d2 - T.d1back)));
      else if (el < T.d2back) {
        // shoves another aside, and it slides back
        const u = (el - T.d2) / (T.d2back - T.d2), push = Math.sin(clamp(u, 0, 1) * Math.PI);
        if (d2) v.off.set(d2.id, { dx: -18 * push, dy: -6 * push, rot: -12 * push });
        hand = { x: top(d2).x - 12 * push, y: top(d2).y + 4 };
        once(v, 'd2', true, () => v.sound && rustle());
        jostle = 1.2;
      } else {
        // digs in, and the presents round his hand jostle
        const u = (el - T.d2back) / (T.pop - T.d2back), e = P.edge;
        hand = { x: e.x + Math.sin(el / 45) * 7, y: e.y + 6 + Math.abs(Math.cos(el / 60)) * 6 };
        jostle = 1.6 + 1.6 * u;
        once(v, 'dig', true, () => v.sound && rustle());
        once(v, 'dig2', u > 0.5, () => v.sound && rustle());
        const wi = v.pile.get(w.id);
        if (wi) v.off.set(w.id, { dx: 0, dy: -Math.abs(Math.sin(el / 50)) * 4 * u, rot: Math.sin(el / 38) * 7 * u });
      }
      if (hand) reach(hand, sa.lean);
      if (jostle) {
        const hp = gloveS();
        for (const it of v.pile.values()) {
          if (it.id === w.id || v.off.has(it.id)) continue;
          const dd = Math.hypot(it.x - hp.x, it.y - hp.y);
          if (dd > 130) continue;
          const a = jostle * (1 - dd / 130), ph = (hash(it.id) % 100) / 16;
          v.off.set(it.id, { dx: Math.sin(el / 55 + ph) * 2.2 * a, dy: -Math.abs(Math.sin(el / 80 + ph)) * 2.4 * a, rot: Math.sin(el / 65 + ph) * 3 * a });
        }
      }
    } else if (el < T.caught) {
      // the winner pops out of the pile and flies into his hand
      once(v, 'pop', true, () => {
        const wi = v.pile.get(w.id);
        P.wFrom = wi ? { x: wi.x, y: wi.y, rot: wi.rot } : null;
        v.out = w.id;
        renderPile(v);
        if (v.sound) { whoosh(0.4); rustle(); }
      });
      const u = (el - T.pop) / (T.caught - T.pop);
      sa.lean = lerp(LEAN, -12, smooth(u));
      sa.head = lerp(-7, -3, u);
      sa.l = 120; sa.lf = 1.3;
      const g = gloveS(), c = { x: g.x - look.w * 0.1 * sc0, y: g.y + (look.h * sc0) / 2 };
      const f = P.wFrom || c, e = 1 - (1 - u) * (1 - u);
      v.carryOn = { x: lerp(f.x, c.x, e), y: qb(f.y, Math.min(f.y, c.y) - 90, c.y, e), rot: lerp(f.rot || 0, 360, e), sc: sc0 };
    } else {
      once(v, 'catch', true, () => v.sound && tap(1));
      let u;
      if (el < T.held) {
        // he sits up and holds it high
        u = smooth((el - T.caught) / (T.held - T.caught));
        sa.lean = lerp(-12, 0, u); sa.l = lerp(120, 166, u); sa.lf = lerp(1.3, 1.2, u); sa.head = lerp(-3, -4, u);
        sa.grin = u > 0.5;
      } else if (el < T.toss) {
        sa.l = 166 + 4 * Math.sin((el - T.held) / 160); sa.lf = 1.2; sa.head = -4; sa.grin = true;
        sa.lean = 2 * Math.sin((el - T.held) / 230);
      } else {
        u = (el - T.toss) / (T.land - T.toss);
        sa.l = lerp(166, 214, smooth(u / 0.4)); sa.lf = 1.2; sa.grin = true;
        sa.head = lerp(-4, 8, smooth(u / 0.5));
        sa.lean = lerp(0, 6, smooth(u / 0.4));
      }
      const g = gloveS(), held = { x: g.x - look.w * 0.1 * sc0, y: g.y + (look.h * sc0) * 0.45, rot: 0, sc: sc0 };
      if (el < T.toss) v.carryOn = held;
      else if (el < T.land) {
        // over his shoulder into the sack
        if (!P.tossFrom) P.tossFrom = { ...held };
        const a = P.tossFrom, b = loadTarget(v, w.id), uu = clamp((el - T.toss) / (T.land - T.toss), 0, 1);
        v.carryOn = { x: lerp(a.x, b.x, uu), y: qb(a.y, Math.min(a.y, b.y) - 110, b.y, uu), rot: lerp(0, 360 + b.rot, smooth(uu)), sc: lerp(a.sc, b.sc, uu) };
        once(v, 'toss', true, () => v.sound && whoosh(0.5));
      }
      once(v, 'land', el >= T.land, () => landLoad(v, w));
    }
    once(v, 'reveal', el >= T.name, () => reveal(v, w));
    if (v.carryOn) Object.assign(v.carryOn, { look, id: w.id, label: w.label });
  }
  function reveal(v, w) {
    if (v.revealed === w.id) return;
    v.revealed = w.id;
    showName(v, w.label);
    if (v.sound) { hoho(); bells(14, 0.5, 0.026, true); }
  }
  function landLoad(v, w) {
    if (v.landedDone === w.id) return;
    v.landedDone = w.id;
    v.landed = { id: w.id, label: w.label };
    v.justLanded = w.id;
    v.out = null;
    v.carryOn = null;
    renderLoad(v);
    restart(v.sackG, 'gulp');
    const p0 = v.loadPos.get(w.id);
    if (p0) {
      const p = toPx(v, p0.x, p0.y - 10);
      v.puff.style.left = `${n1(p.x)}px`; v.puff.style.top = `${n1(p.y)}px`;
      v.puff.innerHTML = snowBurst(v.k * 0.22, 10, false);
      restart(v.puff, 'go');
    }
    if (v.sound) { plop(0.6); bells(6, 0.25, 0.02, false); }
    paintCount(v);
  }
  function restart(el, cls) { el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); }

  // ---------- every frame ----------
  function step(v, now) {
    const dt = v.last ? Math.min(250, now - v.last) / 1000 : 0;
    v.last = now;
    if (!isOn(v.doc) || !v.G) return;
    if (v.active) pickStep(v, Date.now() - v.active.startedAt);
    else { v.saPose = null; if (v.off.size) v.off = new Map(); }
    stepPile(v, now, dt);
    santaStep(v, dt);
    paintCarry(v);
  }
  function santaStep(v, dt) {
    const s = v.santa, want = v.saPose || REST;
    const k = 1 - Math.exp(-dt * (v.saPose ? 26 : 7));
    for (const key of ['lean', 'l', 'lf', 'r', 'rf', 'head']) s.a[key] += (want[key] - s.a[key]) * (dt ? k : 1);
    const set = (node, key, val) => { if (s.last[key] !== val) { s.last[key] = val; node.style.transform = val; } };
    set(s.lean, 'lean', `rotate(${s.a.lean.toFixed(1)}deg)`);
    set(s.l.g, 'l', `rotate(${s.a.l.toFixed(1)}deg)`);
    set(s.r.g, 'r', `rotate(${s.a.r.toFixed(1)}deg)`);
    set(s.head, 'h', `rotate(${s.a.head.toFixed(1)}deg)`);
    setArmLen(s.l, s.a.lf);
    setArmLen(s.r, s.a.rf);
    const cls = `santa${want.grin ? ' grin' : ''}`;
    if (cls !== s.cls) { s.cls = cls; s.g.setAttribute('class', cls); }
    // the reins, from his right glove to the reindeer
    const g = gloveRide('r', s.a.r, s.a.rf, s.a.lean);
    const d = `M${n1(g.x)} ${n1(g.y)}Q${n1((g.x + REIN_NEAR.x) / 2)} ${n1(Math.max(g.y, REIN_NEAR.y) + 10)} ${n1(REIN_NEAR.x)} ${n1(REIN_NEAR.y)}M${n1(g.x)} ${n1(g.y)}Q${n1((g.x + REIN_FAR.x) / 2)} ${n1(Math.max(g.y, REIN_FAR.y) + 6)} ${n1(REIN_FAR.x)} ${n1(REIN_FAR.y)}`;
    if (v.reins && s.last.reins !== d) { s.last.reins = d; v.reins.setAttribute('d', d); }
  }
  function paintCarry(v) {
    const c = v.carryOn, cg = v.carry;
    if (c) {
      if (cg.dataset.id !== c.id || cg.dataset.label !== c.label) {
        cg.dataset.id = c.id; cg.dataset.label = c.label;
        cg.setAttribute('class', `ws-carry ws-gift p${c.look.p} r${c.look.rb}`);
        cg.innerHTML = `${boxMarkup(c.look, c.label)}<title>${esc(c.label)}</title>`;
      }
      const t = giftT(c.look, c.x, c.y, c.rot || 0, c.sc);
      if (cg.style.display === 'none') cg.style.display = '';
      if (v.lastCarry !== t) { v.lastCarry = t; cg.setAttribute('transform', t); }
    } else if (cg.style.display !== 'none') cg.style.display = 'none';
  }

  function run(doc, s, { sound = false } = {}) {
    const v = views.get(doc);
    if (!v) return;
    hideName(v);
    if (v.respawnT) { clearTimeout(v.respawnT); v.respawnT = null; }
    // the last winner, if No repeats is off and it is still in the sleigh
    if (v.landed && !(v.picked || []).some((p) => p.id === v.landed.id)) { v.landed = null; renderLoad(v); renderPile(v); }
    v.justLanded = null;
    v.active = s;
    v.done = new Set();
    v.revealed = null;
    v.landedDone = null;
    v.sound = sound && !isPopout(v);
    v.plan = makePlan(v, s);
    v.el.dataset.state = 'picking';
    v.el.setAttribute('aria-disabled', 'true');
    paintPour(v);
  }
  function finish(doc, s, { respawn = false } = {}) {
    const v = views.get(doc);
    if (!v) return;
    if (!v.active) v.active = s;
    if (!v.plan) v.plan = makePlan(v, s);
    v.sound = false;
    const w = v.plan.w;
    if (w) { reveal(v, w); landLoad(v, w); }
    v.out = null;
    v.carryOn = null;
    v.saPose = null;
    v.active = null;
    v.plan = null;
    v.el.dataset.state = 'picked';
    renderPile(v);
    // No repeats off: it hops back onto the pile after a moment
    if (respawn && w) {
      v.respawnT = setTimeout(() => {
        v.respawnT = null;
        if (v.active || !v.landed || v.landed.id !== w.id) return;
        v.dumpAt = 0; v.dumpHide = false;
        v.landed = null;
        renderPile(v);
        renderLoad(v);
        paintCount(v);
      }, 1400);
    }
    setDisabled(doc, v.offBtn);
    paintCount(v);
  }
  function setWinner(doc, name, state) {
    const v = views.get(doc);
    if (!v) return;
    if (!name && !state && !v.active) { v.el.dataset.state = ''; hideName(v); }
  }
  function setDisabled(doc, off) {
    const v = views.get(doc);
    if (!v) return;
    v.offBtn = !!off;
    v.el.setAttribute('aria-disabled', String(v.offBtn || !!v.active || busy(doc)));
    paintPour(v);
  }
  const busy = (doc) => { const v = views.get(doc); return !!v && v.pouring; };

  // ---------- the name, large, with snow and gold stars ----------
  function showName(v, label) {
    v.name.firstChild.textContent = label || '';
    v.name.title = label || '';
    placeName(v);
    restart(v.name, 'go');
    v.burst.innerHTML = snowBurst(v.k, 30, true);
    restart(v.burst, 'go');
  }
  function placeName(v) {
    if (!v.G) return;
    const label = v.name.title || '';
    const longest = Math.max(4, ...label.split(/\s+/).map((w) => w.length));
    const room = v.bw * 0.6;
    let size = Math.min(70, 620 / (longest * 0.56)) * v.k;
    size = Math.min(size, room / (Math.max(4, label.length) * 0.56 + 1.2));
    // in the sky over the pile
    const cx = v.slots ? v.slots.cx : v.G.W * 0.3, p = toPx(v, cx, 74);
    v.name.style.setProperty('--fs', `${size.toFixed(1)}px`);
    v.name.style.left = `${p.x.toFixed(1)}px`;
    v.name.style.top = `${Math.max(6, p.y - size * 0.6).toFixed(1)}px`;
    v.burst.style.left = `${p.x.toFixed(1)}px`;
    v.burst.style.top = `${Math.max(6, p.y).toFixed(1)}px`;
  }
  function hideName(v) {
    v.name.classList.remove('go');
    v.burst.classList.remove('go');
    v.name.title = '';
  }
  function snowBurst(k, n, stars) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.3, d = (90 + Math.random() * 120) * k;
      const sz = (4 + Math.random() * 7) * Math.max(k, 0.5);
      s += `<i class="${stars && i % 3 === 0 ? 'st' : ''}" style="--dx:${(Math.cos(a) * d * 1.4).toFixed(1)}px;--dy:${(Math.sin(a) * d * 0.55 + 20 * k).toFixed(1)}px;--fall:${((30 + Math.random() * 60) * k).toFixed(1)}px;--s:${sz.toFixed(1)}px;--d:${(i % 5) * 35}ms"></i>`;
    }
    return s;
  }

  // ---------- the round ----------
  function paintCount(v) {
    if (v.countG) v.countG.querySelector('text').textContent = v.picked ? `${v.picked.length} / ${v.total}` : `${v.disp.length} names`;
    paintPour(v);
  }
  function paintPour(v) {
    v.pourBtn.hidden = !v.picked || isPopout(v) || !v.picked.length || v.pouring;
    v.pourBtn.disabled = !!v.active;
    v.pourBtn.classList.toggle('primary', v.full);
  }
  function setPicked(doc, list, total) {
    const v = views.get(doc);
    if (!v) return;
    const before = new Set((v.picked || []).map((p) => p.id));
    const wasFull = v.full;
    v.picked = list;
    v.total = Math.max(total || 0, list ? list.length : 0);
    if (v.landed && list && list.some((p) => p.id === v.landed.id)) v.landed = null;
    // anyone leaving the load flies back to the pile: after the sleigh is
    // back if it had flown off
    const now = new Set((list || []).map((p) => p.id));
    if ([...before].some((id) => !now.has(id))) {
      v.dumpAt = performance.now() + (wasFull ? 1100 : 0);
      v.dumpHide = wasFull;
    }
    renderPile(v);
    renderLoad(v);
    const full = !!list && v.total > 0 && list.length >= v.total;
    if (full && v.wasFull === false) celebrate(v);
    if (!full && v.full) back(v);
    v.wasFull = full;
    v.full = full;
    v.el.classList.toggle('full', full);
    paintCount(v);
  }
  // everyone's been picked: the reindeer take off with the loaded sleigh
  function celebrate(v) {
    if (!isOn(v.doc) || !v.R) return;   // the sled race is showing instead
    v.el.classList.add('leaving');
    setTimeout(() => v.el.classList.remove('leaving'), PARTY_MS);
    const p = toPx(v, v.R.x + 150 * v.R.s, v.R.y - 80 * v.R.s);
    v.burstRide.style.left = `${n1(p.x)}px`; v.burstRide.style.top = `${n1(p.y)}px`;
    v.burstRide.innerHTML = snowBurst(v.k * 0.6, 24, true);
    setTimeout(() => restart(v.burstRide, 'go'), 500);
    if (soundOn(v.doc) && !isPopout(v)) { bells(20, 1, 0.024, false); setTimeout(fanfare, 450); }
  }
  // a new round: the sleigh comes back
  function back(v) {
    v.el.classList.remove('leaving');
    v.el.classList.add('returning');
    setTimeout(() => v.el.classList.remove('returning'), 1400);
  }
  // "Let them out": the wheel says go (a saved list asks first), then
  // wheel.js empties the round and the load tumbles back into a fresh pile
  function pour(v) {
    if (v.pouring || v.active || !v.picked || !v.picked.length) return;
    if (!v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset-request', { cancelable: true }))) return;
    const wasFull = v.full;
    v.pouring = true;
    v.el.setAttribute('aria-disabled', 'true');
    paintPour(v);
    if (soundOn(v.doc) && !isPopout(v)) setTimeout(() => refillSound(v.picked ? v.picked.length || 12 : 12), wasFull ? 1100 : 0);
    v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset'));
    setTimeout(() => { v.pouring = false; setDisabled(v.doc, v.offBtn); paintCount(v); }, reduced(v.doc) ? 500 : (wasFull ? 2600 : 1600));
  }

  // ---------- the notice staked in the snow: "Not here today" (absent only) ----------
  function renderNote(v) {
    const g = v.noteG;
    if (!g || !v.G) return;
    const names = v.absent.map((a) => a.first);
    g.toggleAttribute('hidden', !names.length);
    if (!names.length) { g.innerHTML = ''; return; }
    const maxRows = 8, over = names.length > maxRows + 1;
    const shown = over ? names.slice(0, maxRows) : names.slice(0, maxRows + 1);
    const rows = shown.length + (over ? 1 : 0);
    const w = 76, h = 30 + (rows - 1) * NOTE_STEP + 7, N = v.G.note, top = N.base - 26 - h;
    g.innerHTML = `<g transform="translate(${n1(N.x)} 0)">`
      + `<path class="ws-note-stake" d="M-2.6 ${n1(top + 8)}H2.6L2 ${N.base}H-2Z"/>`
      + `<ellipse class="ws-note-snow" cx="0" cy="${N.base}" rx="11" ry="3.4"/>`
      + `<g transform="translate(0 ${n1(top)}) rotate(-3)">`
      + `<rect class="ws-note-board" x="${n1(-w / 2 - 4)}" y="-4" width="${n1(w + 8)}" height="${n1(h + 8)}" rx="2.4"/>`
      + `<rect class="ws-note-paper" x="${n1(-w / 2)}" y="0" width="${w}" height="${n1(h)}" rx="1"/>`
      + `<path class="ws-note-cap" d="M${n1(-w / 2 - 6)} -3Q0 -10 ${n1(w / 2 + 6)} -3Q${n1(w / 2)} -7 0 -6.5Q${n1(-w / 2)} -7 ${n1(-w / 2 - 6)} -3Z"/>`
      + `<text class="ws-note-head" x="0" y="11">NOT HERE</text>`
      + `<text class="ws-note-sub" x="0" y="18.6">today</text>`
      + `<path class="ws-note-rule" d="M${n1(-w / 2 + 6)} 22H${n1(w / 2 - 6)}"/>`
      + `<g class="ws-note-names"></g></g></g><title></title>`;
    const list = g.querySelector('.ws-note-names');
    const line = (text, i, cls) => {
      const t = svgEl(v.doc, 'text', cls);
      t.setAttribute('x', '0'); t.setAttribute('y', n1(31 + i * NOTE_STEP));
      t.textContent = text;                                  // student names: never markup
      list.appendChild(t);
    };
    shown.forEach((n, i) => line(n.length > 10 ? `${n.slice(0, 9)}…` : n, i, 'ws-note-n'));
    if (over) line(`+${names.length - maxRows} more`, maxRows, 'ws-note-more');
    g.querySelector('title').textContent = `Not here today: ${v.absent.map((a) => a.full).join(', ')}`;
  }
  // wheel.js: the period's absentees today ({ id, first, full } each), [] = none
  function setAbsent(doc, list) {
    const v = views.get(doc);
    if (!v) return;
    const sig = (list || []).map((x) => `${x.id}:${x.full}`).join('|');
    if (v.absentSig === sig) return;
    v.absentSig = sig;
    v.absent = (list || []).slice();
    renderNote(v);
    renderPile(v);
  }

  // ---------- sound: paper, Santa, sleigh bells ----------
  let ctx = null, noiseBuf = null;
  function audio() {
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
    if (ctx && !noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const tone = (c, at, f, len, gain, type = 'sine') => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + len + 0.02);
    return o;
  };
  function noise(c, at, len, gain, type, f, q = 0.8) {
    if (!noiseBuf) return null;
    const src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuf; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.04, len / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(fl); fl.connect(g); g.connect(c.destination);
    src.start(at, Math.random() * 0.5); src.stop(at + len + 0.02);
    return { src, fl };
  }
  function tap(gain = 1) {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, o = tone(c, at, 240, 0.06, 0.05 * gain, 'triangle');
    o.frequency.exponentialRampToValueAtTime(140, at + 0.05);
    noise(c, at, 0.04, 0.02 * gain, 'bandpass', 1400, 1.5);
  }
  // wrapping paper and boxes shuffling about
  function rustle() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    for (let i = 0; i < 5; i++) noise(c, t0 + i * 0.045, 0.06, 0.035, 'bandpass', 3000 + i * 380, 1.3);
    tone(c, t0 + 0.05, 180, 0.07, 0.03, 'triangle');
  }
  // "ho ho ho": three low warm hums
  function hoho() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [0, 0.2, 0.4].forEach((d, i) => {
      const at = t0 + d, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(128 - i * 6, at); o.frequency.linearRampToValueAtTime(104 - i * 6, at + 0.16);
      f.type = 'lowpass'; f.frequency.value = 700;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.06, at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      o.connect(f); f.connect(g); g.connect(c.destination);
      o.start(at); o.stop(at + 0.2);
    });
  }
  function plop(gain = 1) {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, o = tone(c, at, 190, 0.13, 0.08 * gain);
    o.frequency.exponentialRampToValueAtTime(90, at + 0.12);
    noise(c, at, 0.1, 0.03 * gain, 'lowpass', 900);
  }
  function whoosh(len = 0.6) {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, n = noise(c, at, len, 0.05, 'bandpass', 2400, 0.6);
    if (n) n.fl.frequency.exponentialRampToValueAtTime(600, at + len);
  }
  // sleigh bells: a shake of little bells, then (chime) a bright arpeggio
  function bells(n, spread, gain, chime) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    for (let i = 0; i < n; i++) {
      const at = t0 + (i / n) * spread + Math.random() * 0.02, f = 2500 + Math.random() * 1500;
      tone(c, at, f, 0.14, gain, 'triangle');
      tone(c, at, f * 1.51, 0.08, gain * 0.5, 'sine');
    }
    if (chime) [1047, 1319, 1568].forEach((f, i) => tone(c, t0 + 0.05 + i * 0.09, f, 0.55, 0.05, 'triangle'));
  }
  function fanfare() {
    bells(40, 2, 0.026, false);
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(c, t0 + 0.1 + i * 0.12, f, 0.9, 0.05, 'triangle'));
  }
  // the load tumbling back onto the pile: a run of soft thumps and paper
  function refillSound(n) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    for (let i = 0; i < Math.min(n, 30); i++) {
      const at = t0 + 0.6 + i * 0.045, o = tone(c, at, 210 + (i % 5) * 30, 0.09, 0.04, 'triangle');
      o.frequency.exponentialRampToValueAtTime(110, at + 0.08);
      if (i % 3 === 0) noise(c, at, 0.05, 0.02, 'bandpass', 3200, 1.2);
    }
    bells(10, 0.8, 0.018, false);
  }

  window.Workshop = { DURATION_MS, SETTLE_MS, HOLDS_ROUND: true, isOn, busy, build, sync, run, finish, setWinner, setDisabled, setPicked, setAbsent };
})();
