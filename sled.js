// sled.js — the Name Wheel's winter skin: a sledding race.
//
// A snowy hill at night, a START banner at the top and a FINISH line at the
// bottom; one sledder per student lined up on the hilltop, the student's name
// on the side of their sled. A pick (the T timeline below): a whistle, then
// they all race down the hill — weaving, bumping, kicking up snow — the pack
// bunched together until one pulls ahead and crosses the line. The name comes
// up large over the hill with a spray of snow. With No repeats on, the winner
// trudges over to the cabin by the finish and goes in: everyone picked this
// round sits in its window with a mug of cocoa, filling it as the class gets
// called ("7 / 28" over the door). "Let them out" (or Reset) sends them all
// back up the hill. The others walk back up after every race, pulling their
// sleds.
//
// Same shape as farmyard.js / boba.js (wheel.js's skins): isOn, build, sync,
// run, finish, setWinner, setDisabled, setPicked, busy, HOLDS_ROUND,
// DURATION_MS, SETTLE_MS. It never picks anybody: the winner comes in the
// spin descriptor, already drawn by wheel.js. Everything a race shows is
// worked out from the descriptor (a seeded random of winnerId:startedAt), so
// the pop-out and the mini window run the same race.
(function () {
  'use strict';

  const DURATION_MS = 3500;     // the whistle to the winner crossing the line
  const SETTLE_MS = 2300;       // the name, the snow, the walk to the cabin
  const T = { go: 450, fin: 3500, cabinAt: 4100, cabinBy: 5600 };
  const PARTY_MS = 2600;
  const H = 400;                // the scene is 400 units tall, as wide as the box
  const WALK = 110;             // walking speed, units per second

  const views = new Map();
  const isOn = (doc) => doc.documentElement.getAttribute('data-theme') === 'winter';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const seeded = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const reduced = (doc) => !!doc.defaultView.matchMedia && doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const soundOn = (doc) => { const m = doc.getElementById('wheel-mute'); return !!m && m.getAttribute('aria-checked') !== 'true'; };
  const isPopout = (v) => v.doc.body.classList.contains('wheel-popout');
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (doc, tag, cls) => { const e = doc.createElementNS(NS, tag); if (cls) e.setAttribute('class', cls); return e; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortName = (s) => { s = String(s || ''); return s.length > 9 ? `${s.slice(0, 8).trimEnd()}…` : s; };
  // further up the hill = further away = smaller
  const persp = (y) => 0.58 + 0.48 * clamp((y - 110) / 270, 0, 1);

  // ---------- the hill (W = the scene's width in units) ----------
  // the slope's edge against the sky; everything under it is snow
  const ridgeY = (W, x) => {
    const a = 0.3 * W, b = 0.74 * W;
    if (x <= a) return 108 + 6 * (x / a);
    if (x >= b) return 300;
    return lerp(114, 300, smooth((x - a) / (b - a)));
  };
  // the race track: a gentle S from the start line to the finish line, and
  // the "lanes" across it (l -1..1, toward the viewer = positive)
  function track(W, u, l) {
    const S = [0.3 * W, 168], C1 = [0.43 * W, 182], C2 = [0.47 * W, 336], F = [0.64 * W, 352];
    const uu = clamp(u, 0, 1), m = 1 - uu;
    let x = m * m * m * S[0] + 3 * m * m * uu * C1[0] + 3 * m * uu * uu * C2[0] + uu * uu * uu * F[0];
    let y = m * m * m * S[1] + 3 * m * m * uu * C1[1] + 3 * m * uu * uu * C2[1] + uu * uu * uu * F[1];
    if (u > 1) { x += (u - 1) * 0.55 * W; y += (u - 1) * 60; }   // past the line: run out along the flat
    const half = 30 + 22 * clamp(u, 0, 1);
    return { x: x - l * half * 0.55, y: Math.min(394, y + l * half) };
  }
  const cabinBox = (W) => { const w = clamp(0.2 * W, 140, 215); return { x: W - w - clamp(0.025 * W, 10, 26), y: 352, w, h: w * 0.62 }; };
  const doorOf = (W) => { const c = cabinBox(W); return { x: c.x + c.w * 0.22, y: c.y + 4 }; };

  function bgMarkup(W) {
    const r = seeded(11);
    let stars = '';
    for (let i = 0; i < 46; i++) stars += `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * 95).toFixed(0)}" r="${(0.5 + r() * 0.9).toFixed(2)}" opacity="${(0.35 + r() * 0.6).toFixed(2)}"/>`;
    // the ridge as a path, sampled
    let ridge = `M0 ${H}V${ridgeY(W, 0).toFixed(1)}`;
    for (let x = 0; x <= W; x += W / 48) ridge += `L${x.toFixed(1)} ${ridgeY(W, x).toFixed(1)}`;
    ridge += `L${W} ${ridgeY(W, W)}V${H}Z`;
    const pine = (x, y, s, cls = '') => `<g class="sl-pine ${cls}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})"><path class="sl-pine-b" d="M0-46L-13-24H-7L-17-6H-9L-20 10H20L9-6H17L7-24H13Z"/><path class="sl-pine-s" d="M0-46L-6-34Q0-31 6-34ZM-9-22Q0-18 9-22L7-26Q0-23-7-26ZM-13-4Q0 0 13-4L10-8Q0-5-10-8Z"/><rect class="sl-trunk" x="-2.4" y="10" width="4.8" height="6"/></g>`;
    let pines = '';
    // a few along the ridge and down the far side of the track
    [[0.06, 1.0], [0.14, 0.8], [0.22, 0.9]].forEach(([f, s]) => { pines += pine(f * W, ridgeY(W, f * W) - 2, s * 0.9, 'far'); });
    [[0.5, 0.75], [0.56, 0.9], [0.61, 1.0]].forEach(([f, s]) => { pines += pine(f * W, ridgeY(W, f * W) + 2, s * 0.85, 'far'); });
    pines += pine(0.12 * W, 340, 1.25) + pine(0.6 * W, 282, 1.05) + pine(0.035 * W, 252, 1.4) + pine(0.205 * W, 300, 1.5) + pine(0.52 * W, 392, 1.3);
    const S = track(W, 0, 0), F = track(W, 1, 0);
    const fl = (p, l) => track(W, p, l);
    const sA = fl(0, -1.25), sB = fl(0, 1.25), fA = fl(1, -1.25), fB = fl(1, 1.25);
    // the grooves the sleds have worn down the hill
    let grooves = '';
    [-0.7, 0, 0.7].forEach((l) => { let d = ''; for (let u = 0; u <= 1.001; u += 0.05) { const p = fl(u, l); d += `${u ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; } grooves += `<path d="${d}"/>`; });
    const checks = (() => {
      let s = '';
      const n = 10, bw = (fB.x - fA.x), bh = (fB.y - fA.y);
      for (let i = 0; i < n; i++) {
        const a = { x: fA.x + bw * i / n, y: fA.y + bh * i / n }, b = { x: fA.x + bw * (i + 1) / n, y: fA.y + bh * (i + 1) / n };
        s += `<path class="${i % 2 ? 'k1' : 'k0'}" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}l4 0L${(a.x + 4).toFixed(1)} ${a.y.toFixed(1)}Z"/>`;
      }
      return s;
    })();
    const banner = (A, B, top, text, cls) => {
      const mx = (A.x + B.x) / 2, my = Math.min(A.y, B.y) - top;
      return `<g class="sl-banner ${cls}"><path class="sl-pole" d="M${A.x.toFixed(1)} ${A.y.toFixed(1)}V${(my - 6).toFixed(1)}M${B.x.toFixed(1)} ${B.y.toFixed(1)}V${(my - 6).toFixed(1)}"/>`
        + `<path class="sl-cloth" d="M${A.x.toFixed(1)} ${(my - 6).toFixed(1)}Q${mx.toFixed(1)} ${(my + 2).toFixed(1)} ${B.x.toFixed(1)} ${(my - 6).toFixed(1)}V${(my + 8).toFixed(1)}Q${mx.toFixed(1)} ${(my + 16).toFixed(1)} ${A.x.toFixed(1)} ${(my + 8).toFixed(1)}Z"/>`
        + `<text x="${mx.toFixed(1)}" y="${(my + 7.2).toFixed(1)}">${text}</text></g>`;
    };
    const cb = cabinBox(W);
    return `
      <rect class="sl-sky" x="0" y="0" width="${W}" height="${H}"/>
      <g class="sl-stars">${stars}</g>
      <circle class="sl-moon-glow" cx="${(0.86 * W).toFixed(0)}" cy="58" r="40"/>
      <circle class="sl-moon" cx="${(0.86 * W).toFixed(0)}" cy="58" r="17"/>
      <path class="sl-far" d="M0 ${H}V230Q${0.25 * W} 170 ${0.5 * W} 214T${W} 196V${H}Z"/>
      <path class="sl-hill" d="${ridge}"/>
      <path class="sl-hill-shade" d="M${(0.3 * W).toFixed(1)} 114C${(0.42 * W).toFixed(1)} 150 ${(0.5 * W).toFixed(1)} 260 ${(0.74 * W).toFixed(1)} 300L${(0.74 * W).toFixed(1)} 316C${(0.55 * W).toFixed(1)} 300 ${(0.4 * W).toFixed(1)} 200 ${(0.3 * W).toFixed(1)} 124Z"/>
      <g class="sl-grooves">${grooves}</g>
      ${pines}
      <path class="sl-start-line" d="M${sA.x.toFixed(1)} ${sA.y.toFixed(1)}L${sB.x.toFixed(1)} ${sB.y.toFixed(1)}"/>
      <g class="sl-checks">${checks}</g>
      ${banner(sA, sB, 38, 'START', 'start')}
      ${banner(fA, fB, 46, 'FINISH', 'finish')}
      <g class="sl-cabin" transform="translate(${cb.x.toFixed(1)} ${cb.y.toFixed(1)})">${cabinMarkup(cb)}</g>`;
  }

  // the cabin: logs, a snowy roof, a chimney, a door and a big lit window
  // (its .sl-win-in is where everyone picked sits with their cocoa)
  function cabinMarkup(cb) {
    const w = cb.w, h = cb.h, roof = h * 0.62;
    let logs = '';
    for (let y = -h + 6; y < -2; y += 7) logs += `M2 ${y.toFixed(1)}H${(w - 2).toFixed(1)}`;
    const win = { x: w * 0.4, y: -h * 0.82, w: w * 0.52, h: h * 0.56 };
    return `
      <ellipse class="sl-cabin-shadow" cx="${w / 2}" cy="2" rx="${w * 0.62}" ry="6"/>
      <rect class="sl-chimney" x="${w * 0.72}" y="${-h - roof * 0.85}" width="${w * 0.1}" height="${roof * 0.7}"/>
      <path class="sl-chimney-snow" d="M${w * 0.71} ${-h - roof * 0.85}h${w * 0.12}q-${w * 0.06} -4 -${w * 0.12} 0Z"/>
      <g class="sl-smoke" transform="translate(${w * 0.77} ${-h - roof * 0.9})"><circle r="5"/><circle r="6.5"/><circle r="8"/></g>
      <rect class="sl-walls" x="0" y="${-h}" width="${w}" height="${h}" rx="2"/>
      <path class="sl-logs" d="${logs}"/>
      <path class="sl-roof" d="M${-w * 0.08} ${-h + 2}L${w / 2} ${-h - roof}L${w * 1.08} ${-h + 2}Z"/>
      <path class="sl-roof-snow" d="M${-w * 0.1} ${-h + 1}L${w / 2} ${-h - roof - 3}L${w * 1.1} ${-h + 1}Q${w * 0.98} ${-h + 7} ${w * 0.86} ${-h + 2}Q${w * 0.72} ${-h + 9} ${w * 0.58} ${-h + 2}Q${w * 0.4} ${-h + 8} ${w * 0.26} ${-h + 2}Q${w * 0.1} ${-h + 8} ${-w * 0.1} ${-h + 1}Z"/>
      <rect class="sl-door" x="${w * 0.12}" y="${-h * 0.6}" width="${w * 0.2}" height="${h * 0.6}" rx="3"/>
      <circle class="sl-knob" cx="${w * 0.28}" cy="${-h * 0.3}" r="1.6"/>
      <rect class="sl-win-glow" x="${win.x - 6}" y="${win.y - 6}" width="${win.w + 12}" height="${win.h + 12}" rx="6"/>
      <svg class="sl-win" x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" viewBox="0 0 ${win.w} ${win.h}" overflow="hidden">
        <rect class="sl-win-bg" width="${win.w}" height="${win.h}"/>
        <rect class="sl-fire" x="${win.w * 0.04}" y="${win.h * 0.5}" width="${win.w * 0.12}" height="${win.h * 0.4}" rx="2"/>
        <g class="sl-win-in"></g>
      </svg>
      <rect class="sl-win-frame" x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="2"/>
      <path class="sl-win-sill" d="M${win.x - 3} ${win.y + win.h + 1}h${win.w + 6}"/>
      <g class="sl-count" transform="translate(${w * 0.22} ${-h * 0.72})"><rect x="-16" y="-7" width="32" height="12" rx="2"/><text y="2.4"></text></g>`;
  }

  // ---------- a sledder: facing right (downhill), runners at (0, 0) ----------
  const COATS = 5, HATS = 3, SKINS = 3;
  const RIDER = `
    <g class="sl-art">
      <g class="sl-spray"><ellipse cx="-28" cy="-3" rx="8" ry="4"/><ellipse cx="-38" cy="-7" rx="6" ry="3.4"/><ellipse cx="-46" cy="-3" rx="4.4" ry="2.6"/><circle cx="-34" cy="-14" r="2"/><circle cx="-44" cy="-12" r="1.5"/></g>
      <g class="sl-seated">
        <path class="sl-leg" d="M-2-14L12-14 16-12"/>
        <path class="sl-coat" d="M-12-13C-14-22-12-30-5-33C2-34 6-30 5-22L4-13Z"/>
        <path class="sl-arm" d="M0-26C6-24 10-20 14-16"/>
        <circle class="sl-mitt" cx="14.6" cy="-15.6" r="2.4"/>
        <path class="sl-scarf" d="M-8-31Q-1-28 5-31L5-28Q-1-25-8-28Z"/>
        <path class="sl-scarf-tail" d="M-8-30L-16-27-15-24-7-27Z"/>
        <circle class="sl-head" cx="-1" cy="-38" r="6.4"/>
        <circle class="sl-eye" cx="2.4" cy="-38.6" r="0.9"/>
        <path class="sl-hat" d="M-7.6-40C-7.4-46.6 5.6-46.6 5.8-40Z"/>
        <circle class="sl-pom" cx="-1" cy="-47" r="2.2"/>
      </g>
      <g class="sl-walker">
        <path class="sl-wleg a" d="M27-14L25-1"/><path class="sl-wleg b" d="M30-14L32-1"/>
        <path class="sl-coat" d="M23-14C22-22 23-30 28-33C33-34 36-30 35-22L34-14Z"/>
        <path class="sl-rope" d="M24-24Q8-18-18-10"/>
        <circle class="sl-mitt" cx="24" cy="-24" r="2.2"/>
        <path class="sl-scarf" d="M23-31Q29-28 35-31L35-28Q29-25 23-28Z"/>
        <circle class="sl-head" cx="29" cy="-38" r="6.4"/>
        <circle class="sl-eye" cx="32.4" cy="-38.6" r="0.9"/>
        <path class="sl-hat" d="M22.4-40C22.6-46.6 35.6-46.6 35.8-40Z"/>
        <circle class="sl-pom" cx="29" cy="-47" r="2.2"/>
      </g>
      <g class="sl-sled">
        <path class="sl-runner" d="M-22 0H17Q25 0 24-7"/>
        <path class="sl-strut" d="M-16 0V-6M-2 0V-6M12 0V-6"/>
        <rect class="sl-board" x="-24" y="-13" width="44" height="8" rx="2"/>
        <path class="sl-board-hi" d="M-22-11.4H18"/>
      </g>
    </g>
    <text class="sl-tag" y="-6.6"></text>`;

  function setTag(r) {
    const t = r.g.querySelector('.sl-tag');
    const s = shortName(r.label);
    t.textContent = s;
    t.style.fontSize = `${s.length > 7 ? 6.4 : 7.4}px`;
  }
  function makeRider(v, item) {
    const g = svgEl(v.doc, 'g', 'sl-rider');
    const h = hash(item.id);
    g.classList.add(`c${h % COATS}`, `h${(h >>> 4) % HATS}`, `k${(h >>> 8) % SKINS}`);
    g.style.setProperty('--ph', `${-((h >>> 12) % 1000) / 1000 * 2}s`);
    g.innerHTML = RIDER;
    const r = { id: item.id, label: item.label, g, x: 0, y: 0, hx: 0, hy: 0, mode: 'home', face: 1, rot: 0, sc: 1, at: 0, bumpAt: 0 };
    setTag(r);
    const ti = svgEl(v.doc, 'title');
    ti.textContent = item.label;
    g.appendChild(ti);
    return r;
  }

  // ---------- the view ----------
  const markup = () => `
    <svg class="sl-svg" viewBox="0 0 800 ${H}" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <g class="sl-bg"></g>
      <g class="sl-actors"></g>
    </svg>
    <span class="sl-left" aria-hidden="true"></span>
    <button type="button" class="sl-pour" hidden>Let them out</button>
    <div class="sl-name" aria-hidden="true"><span></span></div>
    <div class="sl-burst" aria-hidden="true"></div>
    <div class="sl-burst sl-burst-cabin" aria-hidden="true"></div>`;

  function build(doc) {
    if (views.has(doc)) return views.get(doc).el;
    const wrap = doc.querySelector('.wheel-wrap');
    if (!wrap) return null;
    const el = doc.createElement('div');
    el.className = 'sled';
    el.id = 'sled';
    el.dataset.state = '';
    el.innerHTML = markup();
    wrap.appendChild(el);
    const v = {
      doc, el,
      svg: el.querySelector('.sl-svg'),
      bg: el.querySelector('.sl-bg'),
      actors: el.querySelector('.sl-actors'),
      left: el.querySelector('.sl-left'),
      pourBtn: el.querySelector('.sl-pour'),
      name: el.querySelector('.sl-name'),
      burst: el.querySelector('.sl-burst'),
      burstCabin: el.querySelector('.sl-burst-cabin'),
      riders: new Map(),
      W: 800, k: 1, offX: 0, offY: 0, bw: 0, bh: 0,
      active: null, plan: null, done: new Set(), winner: null,
      picked: null, total: 0, full: false, wasFull: undefined, off: false, pouring: false,
      incoming: new Set(),                        // let out of the cabin: they walk back from its door
      inCabin: new Set(),                         // walked in this session (hidden from the hill)
      order: '', last: 0, sound: false, hissing: null,
    };
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

  // 400 units tall and as wide as the box: the hill, the track and the cabin
  // are laid out from the width, so a wide screen gets a longer run-out
  function layout(v) {
    const bw = v.el.clientWidth, bh = v.el.clientHeight;
    if (!bw || !bh) return;
    const W = Math.round(clamp((H * bw) / bh, 620, 1300));
    v.bw = bw; v.bh = bh;
    v.k = Math.min(bw / W, bh / H);
    v.offX = (bw - W * v.k) / 2;
    v.offY = bh - H * v.k;
    v.el.style.setProperty('--u', `${v.k.toFixed(4)}px`);
    if (W !== v.W || !v.bg.firstChild) {
      v.W = W;
      v.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      v.bg.innerHTML = bgMarkup(W);
      v.winIn = v.bg.querySelector('.sl-win-in');
      v.countT = v.bg.querySelector('.sl-count text');
      v.cabinG = v.bg.querySelector('.sl-cabin');
      renderCabin(v);
      paintCount(v);
      assignHomes(v, true);
    }
    if (v.name.title) placeName(v);
    placeCabinBurst(v);
  }
  const toPx = (v, x, y) => ({ x: v.offX + x * v.k, y: v.offY + y * v.k });

  // the hilltop: staggered rows behind the start line, as many as fit
  function homesFor(W, n) {
    const x0 = 0.035 * W, x1 = 0.275 * W, y0 = 128, y1 = 218;
    const rows = clamp(Math.ceil(Math.sqrt(n / 2.4)), 1, 6);
    const cols = Math.max(1, Math.ceil(n / rows));
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = i % rows, c = Math.floor(i / rows);
      const y = rows === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * r / (rows - 1);
      const span = x1 - x0, cw = span / cols;
      const x = x0 + cw * (c + 0.5) + (r % 2 ? cw * 0.25 : -cw * 0.1);
      out.push({ x: clamp(x, x0, x1), y });
    }
    return out;
  }
  function assignHomes(v, snap = false) {
    const list = [...v.riders.values()].filter((r) => r.mode !== 'gone');
    const homes = homesFor(v.W, list.length);
    // rows from the back: the earlier in the list, the further up
    v.homeS = clamp((0.24 * v.W) / Math.max(1, Math.ceil(list.length / clamp(Math.ceil(Math.sqrt(list.length / 2.4)), 1, 6))) / 34, 0.55, 1.15);
    list.forEach((r, i) => {
      r.hx = homes[i].x; r.hy = homes[i].y;
      if (snap && r.mode === 'home') { r.x = r.hx; r.y = r.hy; }
      else if (r.mode === 'home' && !v.active && (Math.abs(r.x - r.hx) > 1 || Math.abs(r.y - r.hy) > 1)) r.mode = 'walk';
    });
  }

  // the wheel's list: one sledder per name (the winner stays until the next
  // pick, like the wheel's landing)
  function sync(doc, list) {
    const v = views.get(doc);
    if (!v) return;
    const want = new Map((list || []).map((it) => [it.id, it]));
    let changed = false;
    for (const [id, r] of v.riders) {
      if (!want.has(id)) {
        if (r.mode === 'cabin' || r.mode === 'inside') v.inCabin.add(id);
        r.g.remove();
        v.riders.delete(id);
        changed = true;
      }
    }
    for (const it of want.values()) {
      const r = v.riders.get(it.id);
      if (r) { if (r.label !== it.label) { r.label = it.label; setTag(r); } continue; }
      const nr = makeRider(v, it);
      v.riders.set(it.id, nr);
      v.actors.appendChild(nr.g);
      const fromCabin = v.incoming.has(it.id) || v.inCabin.has(it.id) || (v.picked || []).some((p) => p.id === it.id);
      if (fromCabin) {
        // out of the cabin door and back up the hill
        const d = doorOf(v.W);
        nr.x = d.x; nr.y = d.y; nr.mode = 'walk';
        nr.at = performance.now() + Math.random() * 600;
        v.incoming.delete(it.id); v.inCabin.delete(it.id);
      } else nr.mode = 'home';
      changed = true;
    }
    if (changed) {
      const fresh = [...v.riders.values()].filter((r) => r.mode === 'home' && !r.x && !r.y);
      assignHomes(v, false);
      fresh.forEach((r) => { r.x = r.hx; r.y = r.hy; });
      paintCount(v);
    }
  }

  // ---------- the race ----------
  function makePlan(v, s) {
    const rnd = seeded(hash(`${s.winnerId}:${s.startedAt}`));
    const racers = [...v.riders.values()].filter((r) => r.mode !== 'gone' && r.mode !== 'cabin' && r.mode !== 'inside');
    const n = racers.length;
    // lanes spread across the track, shuffled
    const lanes = racers.map((_, i) => (n < 2 ? 0 : -1 + 2 * i / (n - 1)));
    for (let i = lanes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [lanes[i], lanes[j]] = [lanes[j], lanes[i]]; }
    const plan = new Map();
    racers.forEach((r, i) => {
      const win = r.id === s.winnerId;
      plan.set(r.id, {
        r, win,
        sx: r.x, sy: r.y,
        lane: lanes[i] * 0.9,
        pace: win ? 0.9 : 0.72 + rnd() * 0.2,          // where they are when the winner crosses
        wob: 0.2 + rnd() * 0.25, wf: 2.4 + rnd() * 2.2, wp: rnd() * 6.3,
        surge: rnd() * 6.3,
        stop: 1.06 + rnd() * 0.16,                     // where they coast to a halt past the line
        bump: rnd() < 0.35 ? 0.25 + rnd() * 0.55 : -1, // a jolt partway down
      });
    });
    return plan;
  }
  // how far down the track (0 start, 1 the line) a racer is at time el
  function progress(p, el) {
    if (el < T.go) return 0;
    const tau = clamp((el - T.go) / (T.fin - T.go), 0, 1);
    const acc = tau ** 1.55;
    // the pack: everyone together, a little jostling for places
    let u = acc * (p.pace + 0.09 * Math.sin(tau * 8 + p.surge) * (1 - tau));
    if (p.win) u = acc * 0.88 + 0.12 * smooth((tau - 0.5) / 0.5);   // pulls ahead over the second half
    if (el <= T.fin) return u;
    // past the winner's moment: coast on to a stop past the line
    const k = easeOut((el - T.fin) / 1300);
    const end = p.win ? 1.08 : p.stop;
    return lerp(u, end, k);
  }
  function raceStep(v, el, now) {
    for (const p of v.plan.values()) {
      const r = p.r;
      if (r.mode === 'gone') continue;
      const u = progress(p, el);
      const live = el >= T.go && el < T.fin + 900;
      const wob = live ? p.wob * Math.sin((el / 1000) * p.wf + p.wp) * clamp(u * 4, 0, 1) * clamp((1.05 - u) * 3, 0, 1) : 0;
      const t = track(v.W, u, p.lane + wob);
      // off the hilltop and onto the track over the first stretch
      const join = smooth((el - T.go) / 700);
      r.x = lerp(p.sx, t.x, join);
      r.y = lerp(p.sy, t.y, join);
      r.face = 1;
      // the slope tilts the sled
      const a = track(v.W, Math.max(0, u - 0.02), p.lane), b = track(v.W, Math.min(1.2, u + 0.02), p.lane);
      r.rot = u > 0 && u < 1 ? clamp(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI * 0.55, -6, 26) : 0;
      setMode(r, el < T.go ? 'ready' : (live ? 'race' : 'stopped'));
      if (p.bump > 0 && u > p.bump && !r.bumped) {
        r.bumped = true;
        r.g.classList.remove('bump'); void r.g.getBBox(); r.g.classList.add('bump');
        if (v.sound) thump();
      }
    }
    const w = v.plan.get(v.active.winnerId);
    if (w) {
      once(v, 'line', el >= T.fin, () => crossLine(v, w.r));
      if (v.picked && el >= T.cabinAt && !v.done.has('cabin')) { v.done.add('cabin'); toCabin(v, w.r); }
    }
    once(v, 'whistle', el >= 0, () => { if (v.sound) whistle(); });
    once(v, 'hiss', el >= T.go, () => { if (v.sound) v.hissing = hiss(T.fin - T.go + 700); });
  }
  const once = (v, key, due, fn) => { if (due && !v.done.has(key)) { v.done.add(key); fn(); } };
  function setMode(r, m) {
    if (r.pose === m) return;
    r.pose = m;
    r.g.dataset.pose = m;
  }

  function crossLine(v, r) {
    v.winner = r;
    r.g.classList.add('winner');
    showName(v, r.label);
    if (v.sound) cheer();
  }
  function toCabin(v, r) {
    const d = doorOf(v.W);
    r.mode = 'cabin';
    r.tx = d.x; r.ty = d.y;
  }

  // ---------- every frame ----------
  function step(v, now) {
    const dt = v.last ? Math.min(250, now - v.last) / 1000 : 0;
    v.last = now;
    if (!isOn(v.doc)) return;
    if (v.active) {
      const el = Date.now() - v.active.startedAt;
      raceStep(v, el, now);
    }
    for (const r of v.riders.values()) {
      if (r.mode === 'walk' || r.mode === 'cabin') walkStep(v, r, dt, now);
      else if (r.mode === 'home' && !v.active) setMode(r, 'idle');
    }
    paint(v);
  }
  // walking: back up to the hilltop (pulling the sled), or into the cabin
  function walkStep(v, r, dt, now) {
    if (v.active && v.plan && v.plan.has(r.id) && r.mode === 'walk') return;
    if (r.at && now < r.at) { setMode(r, 'idle'); return; }
    const tx = r.mode === 'cabin' ? r.tx : r.hx, ty = r.mode === 'cabin' ? r.ty : r.hy;
    const dx = tx - r.x, dy = ty - r.y, d = Math.hypot(dx, dy);
    const sp = (reduced(v.doc) ? 2.2 : 1) * WALK * (r.mode === 'cabin' ? 1.25 : 1) * dt;
    r.rot = 0;
    if (d <= sp || d < 0.5) {
      r.x = tx; r.y = ty;
      if (r.mode === 'cabin') { r.mode = 'inside'; r.g.classList.add('in'); renderCabin(v); }
      else { r.mode = 'home'; r.face = 1; setMode(r, 'idle'); }
      return;
    }
    r.x += (dx / d) * sp; r.y += (dy / d) * sp;
    r.face = dx < 0 ? -1 : 1;
    setMode(r, 'walk');
  }
  function paint(v) {
    const list = [...v.riders.values()];
    for (const r of list) {
      // on the hilltop a big class is packed smaller; full size on the slope
      const s = persp(r.y) * lerp(v.homeS || 1, 1, smooth((r.x - 0.27 * v.W) / (0.1 * v.W)));
      const key = `${r.x.toFixed(1)}|${r.y.toFixed(1)}|${s.toFixed(3)}|${r.rot.toFixed(1)}|${r.face}`;
      if (key === r.key) continue;
      r.key = key;
      r.g.setAttribute('transform', `translate(${r.x.toFixed(1)} ${r.y.toFixed(1)}) scale(${s.toFixed(3)}) rotate(${r.rot.toFixed(1)})`);
      r.g.querySelector('.sl-art').setAttribute('transform', r.face < 0 ? 'scale(-1 1)' : '');
      r.g.querySelector('.sl-tag').setAttribute('x', r.face < 0 ? '2' : '-2');
    }
    // draw order: further up the hill first
    const order = list.slice().sort((a, b) => a.y - b.y);
    const sig = order.map((r) => r.id).join();
    if (sig !== v.order) {
      v.order = sig;
      let prev = null;
      for (const r of order) {
        const want = prev ? prev.g.nextSibling : v.actors.firstChild;
        if (want !== r.g) v.actors.insertBefore(r.g, want);
        prev = r;
      }
    }
  }

  // ---------- the pick ----------
  function run(doc, s, { sound = false } = {}) {
    const v = views.get(doc);
    if (!v) return;
    // whoever was still walking about gets back on their sled where they are
    for (const r of v.riders.values()) {
      r.g.classList.remove('winner', 'bump');
      r.bumped = false;
      if (r.mode === 'walk') r.mode = 'home';
    }
    hideName(v);
    v.active = s;
    v.done = new Set();
    v.sound = sound && !isPopout(v);
    v.plan = makePlan(v, s);
    v.el.dataset.state = 'racing';
    v.el.setAttribute('aria-disabled', 'true');
  }
  function finish(doc, s, { respawn = false } = {}) {
    const v = views.get(doc);
    if (!v) return;
    if (!v.active) v.active = s;
    if (!v.plan) v.plan = makePlan(v, s);
    const el = Math.max(T.fin + 1400, Date.now() - s.startedAt);
    v.sound = false;
    raceStep(v, el, performance.now());
    const w = v.plan.get(s.winnerId);
    // everyone else trudges back up the hill, a few at a time
    let i = 0;
    for (const p of v.plan.values()) {
      if (p.win) continue;
      p.r.mode = 'walk';
      p.r.at = performance.now() + 200 + (i++ % 8) * 140;
    }
    if (w) {
      if (!v.winner) crossLine(v, w.r);
      if (respawn || !v.picked) { w.r.mode = 'walk'; w.r.at = performance.now() + 1600; }
      else if (w.r.mode !== 'cabin' && w.r.mode !== 'inside') toCabin(v, w.r);
    }
    v.active = null;
    v.plan = null;
    v.el.dataset.state = 'picked';
    setDisabled(doc, v.off);
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
    v.off = !!off;
    v.el.setAttribute('aria-disabled', String(v.off || !!v.active || busy(doc)));
    paintPour(v);
  }
  const busy = (doc) => { const v = views.get(doc); return !!v && v.pouring; };

  // ---------- the name, large, with a spray of snow ----------
  function showName(v, label) {
    v.name.firstChild.textContent = label || '';
    v.name.title = label || '';
    placeName(v);
    v.name.classList.remove('go'); void v.name.offsetWidth; v.name.classList.add('go');
    v.burst.innerHTML = snowBurst(v.k, 30);
    v.burst.classList.remove('go'); void v.burst.offsetWidth; v.burst.classList.add('go');
  }
  function placeName(v) {
    const label = v.name.title || '';
    const longest = Math.max(4, ...label.split(/\s+/).map((w) => w.length));
    const room = v.bw * 0.6;
    let size = Math.min(66, 600 / (longest * 0.56)) * v.k;
    size = Math.min(size, room / (Math.max(4, label.length) * 0.56 + 1.2));
    // over the middle of the slope, under the sky's top edge
    const p = toPx(v, 0.5 * v.W, 64);
    v.name.style.setProperty('--fs', `${size.toFixed(1)}px`);
    v.name.style.left = `${p.x.toFixed(1)}px`;
    v.name.style.top = `${Math.max(6, p.y - size * 0.7).toFixed(1)}px`;
    v.burst.style.left = `${p.x.toFixed(1)}px`;
    v.burst.style.top = `${Math.max(6, p.y - size * 0.7).toFixed(1)}px`;
  }
  function hideName(v) {
    v.name.classList.remove('go');
    v.burst.classList.remove('go');
    v.name.title = '';
  }
  function snowBurst(k, n) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.3, d = (90 + Math.random() * 120) * k;
      const sz = (4 + Math.random() * 7) * k;
      s += `<i style="--dx:${(Math.cos(a) * d * 1.4).toFixed(1)}px;--dy:${(Math.sin(a) * d * 0.55 + 20 * k).toFixed(1)}px;--fall:${((30 + Math.random() * 60) * k).toFixed(1)}px;--s:${sz.toFixed(1)}px;--d:${(i % 5) * 35}ms"></i>`;
    }
    return s;
  }

  // ---------- the cabin: everyone called this round, with cocoa ----------
  function renderCabin(v) {
    if (!v.winIn) return;
    const box = v.winIn.ownerSVGElement;
    const W = +box.getAttribute('width'), Hh = +box.getAttribute('height');
    const list = (v.picked || []).filter((p) => !(v.winner && p.id === v.winner.id && v.winner.mode === 'cabin'));
    const total = Math.max(v.total, list.length, 1);
    // the slots: the most even grid that fits the round
    let best = null;
    for (let c = 1; c <= total; c++) {
      const r = Math.ceil(total / c), cell = Math.min((W * 0.82) / c, Hh / r);
      if (!best || cell > best.cell) best = { c, r, cell };
    }
    const { c, cell } = best;
    const x0 = W * 0.17;
    let s = '';
    list.forEach((p, j) => {
      const h = hash(p.id), cx = x0 + cell * ((j % c) + 0.5), cy = Hh - cell * Math.floor(j / c) - cell * 0.12;
      const k = cell / 20;
      s += `<g class="sl-guest c${h % COATS} h${(h >>> 4) % HATS} k${(h >>> 8) % SKINS}" transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${k.toFixed(3)})"><title>${esc(p.label)}</title>`
        + '<path class="sl-coat" d="M-7 0C-8-6-6-9 0-9.6C6-9 8-6 7 0Z"/><circle class="sl-head" cx="0" cy="-13" r="4.6"/>'
        + '<path class="sl-hat" d="M-5.2-14.4C-5-19.4 5-19.4 5.2-14.4Z"/><circle class="sl-pom" cx="0" cy="-19.6" r="1.5"/>'
        + '<path class="sl-mug" d="M2.4-5.6H7.6V-.6Q7.6 1 6 1H4Q2.4 1 2.4-.6Z"/><path class="sl-mug-h" d="M7.6-4.2Q9.6-4.2 9.6-2.6Q9.6-1 7.6-1"/><path class="sl-cocoa" d="M2.8-5.2H7.2"/>'
        + '<path class="sl-steam" d="M4-7Q3-9 4.6-10.4M6-7Q5-9 6.6-10.4"/></g>';
    });
    v.winIn.innerHTML = s;
  }
  function paintCount(v) {
    let n = 0;
    for (const r of v.riders.values()) if (r.mode !== 'cabin' && r.mode !== 'inside') n++;
    if (v.winner && v.picked && v.riders.has(v.winner.id) && v.winner.mode === 'home') n--;
    v.left.textContent = v.picked ? `${n} left` : `${n} on the hill`;
    if (v.countT) v.countT.textContent = v.picked && !isPopout(v) ? `${v.picked.length} / ${v.total}` : '';
    v.bg.querySelector('.sl-count')?.toggleAttribute('hidden', !v.picked || isPopout(v));
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
    const was = new Set((v.picked || []).map((p) => p.id));
    v.picked = list;
    v.total = Math.max(total || 0, list ? list.length : 0);
    // out of the cabin (let out, or the list emptied): they'll walk back up
    for (const id of was) if (!(list || []).some((p) => p.id === id)) v.incoming.add(id);
    const winner = v.winner;
    if (winner && was.has(winner.id) && !(list || []).some((p) => p.id === winner.id) && (winner.mode === 'cabin' || winner.mode === 'inside')) {
      winner.g.classList.remove('in', 'winner');
      winner.mode = 'walk'; winner.at = performance.now() + 300;
      v.incoming.delete(winner.id);
    }
    setTimeout(() => v.incoming.clear(), 4000);
    renderCabin(v);
    const full = !!list && v.total > 0 && list.length >= v.total;
    if (full && v.wasFull === false) celebrate(v);
    v.wasFull = full;
    v.full = full;
    v.el.classList.toggle('full', full);
    paintCount(v);
  }
  function celebrate(v) {
    v.el.classList.add('party');
    setTimeout(() => v.el.classList.remove('party'), PARTY_MS);
    placeCabinBurst(v);
    v.burstCabin.innerHTML = snowBurst(v.k * 0.8, 26);
    v.burstCabin.classList.remove('go'); void v.burstCabin.offsetWidth; v.burstCabin.classList.add('go');
    if (soundOn(v.doc) && !isPopout(v)) chime();
  }
  function placeCabinBurst(v) {
    if (!v.bw) return;
    const cb = cabinBox(v.W), p = toPx(v, cb.x + cb.w * 0.65, cb.y - cb.h * 0.55);
    v.burstCabin.style.left = `${p.x.toFixed(1)}px`;
    v.burstCabin.style.top = `${p.y.toFixed(1)}px`;
  }
  // "Let them out": the wheel says go (a saved list asks first), then
  // wheel.js empties the round, and everyone walks out of the cabin and back
  // up the hill
  function pour(v) {
    if (v.pouring || v.active || !v.picked || !v.picked.length) return;
    if (!v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset-request', { cancelable: true }))) return;
    v.pouring = true;
    v.el.setAttribute('aria-disabled', 'true');
    paintPour(v);
    if (soundOn(v.doc) && !isPopout(v)) doorBell();
    v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset'));
    setTimeout(() => { v.pouring = false; setDisabled(v.doc, v.off); paintCount(v); }, reduced(v.doc) ? 500 : 1800);
  }

  // ---------- sound: a whistle, the hiss of runners, bumps, a cheer ----------
  let ctx = null, noiseBuf = null;
  function audio() {
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
    if (ctx && !noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
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
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + len + 0.02);
    return o;
  };
  // a referee's whistle: a short blast then a long trilling one
  function whistle() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [[0, 0.12], [0.18, 0.42]].forEach(([d, len]) => {
      const o = tone(c, t0 + d, 2950, len, 0.07);
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 34; lg.gain.value = 120;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t0 + d); lfo.stop(t0 + d + len + 0.02);
    });
  }
  // runners on snow: band-passed noise that swells as they gather speed
  function hiss(ms) {
    const c = audio();
    if (!c || !noiseBuf) return null;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7;
    const t0 = c.currentTime, len = ms / 1000;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.5);
    f.frequency.linearRampToValueAtTime(3600, t0 + len);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0); src.stop(t0 + len + 0.6);
    return src;
  }
  function thump() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, o = tone(c, at, 140, 0.16, 0.12);
    o.frequency.exponentialRampToValueAtTime(60, at + 0.14);
  }
  // across the line: a bright bell and a little "hooray" sweep
  function cheer() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [988, 1319, 1568].forEach((f, i) => tone(c, t0 + i * 0.09, f, 0.5, 0.06, 'triangle'));
    if (noiseBuf) {
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 0.5;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
      src.connect(f); f.connect(g); g.connect(c.destination); src.start(t0); src.stop(t0 + 1.2);
    }
  }
  function chime() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(c, t0 + i * 0.12, f, 0.9, 0.05, 'triangle'));
  }
  function doorBell() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [1760, 2093, 1760].forEach((f, i) => tone(c, t0 + i * 0.07, f, 0.35, 0.04, 'triangle'));
  }

  window.Sled = { DURATION_MS, SETTLE_MS, HOLDS_ROUND: true, isOn, busy, build, sync, run, finish, setWinner, setDisabled, setPicked };
})();
