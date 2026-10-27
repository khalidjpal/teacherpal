// cornucopia.js — the Name Wheel's thanksgiving skin: a woven horn of plenty
// on a wooden table instead of the wheel.
//
// Same shape as cauldron.js / boba.js: wheel.js still owns everything that
// matters (who's in, the fair draw, No repeats, the pop-out broadcast) and
// hands this file a spin descriptor { startedAt, duration, settle, winnerId }.
// One piece of produce per student, no names on them. A pick (~4s, the T
// timeline below) TIPS the horn and shakes it, the produce TUMBLES out and
// rolls across the table (gravity, bounces, friction, pieces knocking each
// other by weight), SCATTERS and slows to a stop; the chosen piece lights up
// and rolls forward to the front, comes to rest bigger than the rest, and
// the student's name rises above it with leaves bursting round it. The rest
// roll back into the horn. With No repeats on, the next pick drops the
// chosen piece into the BASKET on the right, which collects everyone called
// this round (names on them) until "Tip it back in" pours them back.
// Never picks anything.
(() => {
  const DURATION_MS = 2000;
  const SETTLE_MS = 2000;
  // ms from the start of a pick
  const T = { release: 220, releaseEnd: 820, upright: 1500, chosen: 1650, front: 2800, reveal: 2850 };
  const TO_FRONT = T.front - T.chosen;

  // ---- the scene, in a 400 x 400 box ----
  // Produce lives on the table plane: x across, y the depth on the table
  // (the point where it touches), z its height above the table. It is drawn
  // at (x, y - z - 0.85 r), a little smaller further back.
  const TABLE = { x0: 10, x1: 390, y0: 262, y1: 395 };
  const BASKET = { x: 288, y: 306 };              // the basket's corner on the table: nothing rolls past it
  const FRONT = { x: 186, y: 374 };               // where the chosen piece comes to rest
  const HORN_FLOOR = 268;                         // plane depth of the produce sitting in the horn's mouth
  const G = 1150;                                 // gravity, units/s²
  const GROW = 0.7;                               // the chosen piece ends 70% bigger

  // the horn: a cubic centreline from the mouth (P0) back to the curled tip
  const P = [[178, 236], [80, 270], [6, 160], [74, 102]];
  const radAt = (t) => 50 * Math.pow(1 - t, 1.2) + 2.5;
  const bez = (t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]); };
  const dbez = (t) => { const u = 1 - t; return [0, 1].map((k) => 3 * u * u * (P[1][k] - P[0][k]) + 6 * u * t * (P[2][k] - P[1][k]) + 3 * t * t * (P[3][k] - P[2][k])); };
  const norm = (t) => { const [dx, dy] = dbez(t), l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l, dx / l, dy / l]; };   // normal (up side), tangent
  const MOUTH = (() => {
    const [nx, ny, tx, ty] = norm(0), r = radAt(0);
    return { cx: P[0][0], cy: P[0][1], a: r * 0.6, b: r * 0.98, ang: Math.atan2(-ty, -tx) * 180 / Math.PI, nx, ny, tx: -tx, ty: -ty };
  })();

  const views = new Map();
  const isOn = (doc) => doc.documentElement.getAttribute('data-theme') === 'thanksgiving';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const reduced = (doc) => !!doc.defaultView.matchMedia && doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const persp = (y) => 0.84 + 0.16 * clamp((y - TABLE.y0) / (TABLE.y1 - TABLE.y0), 0, 1);
  const soundOn = (doc) => { const m = doc.getElementById('wheel-mute'); return !!m && m.getAttribute('aria-checked') !== 'true'; };
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (doc, tag, cls) => { const e = doc.createElementNS(NS, tag); if (cls) e.setAttribute('class', cls); return e; };

  // ---------- produce: drawn at radius 10 about (0, 0) ----------
  const PAL = {
    orange: 'orange', cran: 'cran', amber: 'amber', green: 'green', grape: 'grape',
  };
  const palStyle = (p) => `--m:var(--hn-${p});--d:var(--hn-${p}-d);--h:var(--hn-${p}-h)`;
  const SHINE = '<ellipse class="f-sh" cx="-3.4" cy="-2.6" rx="2.3" ry="1.2" transform="rotate(-35 -3.4 -2.6)"/>';
  const grapes = (() => {
    const at = [[-4, -4.4], [0, -5], [4, -4.4], [-6, -0.6], [-2, -1], [2, -1], [6, -0.6], [-4, 3], [0, 2.8], [4, 3], [-2, 6.6], [2, 6.6], [0, 9.6]];
    return at.map(([x, y]) => `<circle class="f-m o" cx="${x}" cy="${y}" r="2.65"/><circle class="f-h" cx="${x - 0.8}" cy="${y - 0.9}" r="0.75"/>`).join('');
  })();
  const kernels = (() => {
    let s = '';
    for (let y = -7.6; y <= 7; y += 2.1) for (const x of [-2, 0.6, 3.2]) s += `<circle class="f-h" cx="${x}" cy="${y.toFixed(1)}" r="0.85"/>`;
    return s;
  })();
  const head = (x, y, a) => {
    let s = `<g transform="translate(${x} ${y}) rotate(${a})">`;
    for (let k = 0; k < 4; k++) s += `<ellipse class="f-m o thin" cx="-1" cy="${-k * 1.7}" rx="0.95" ry="1.6" transform="rotate(-20 -1 ${-k * 1.7})"/><ellipse class="f-m o thin" cx="1" cy="${-k * 1.7}" rx="0.95" ry="1.6" transform="rotate(20 1 ${-k * 1.7})"/>`;
    return `${s}<ellipse class="f-m o thin" cx="0" cy="-7" rx="0.9" ry="1.5"/></g>`;
  };
  const TYPES = [
    { id: 'pumpkin', k: 1.14, pals: ['orange', 'orange', 'amber', 'green'], shine: true, art: `
      <ellipse class="f-d o" cx="-4.6" cy="1" rx="5.6" ry="7.6"/><ellipse class="f-d o" cx="4.6" cy="1" rx="5.6" ry="7.6"/>
      <ellipse class="f-m o" cx="0" cy="1" rx="5.2" ry="8.3"/>
      <path class="ln-d" d="M-2.5-5.6Q-3.8 1-2.5 7.7M2.5-5.6Q3.8 1 2.5 7.7"/>
      <path class="f-st o" d="M-1.2-6.4C-1.6-9-.6-10.6 1.8-11.1L2.6-9.7C1-9.3.9-8 1-6.4Z"/>
      <path class="f-lf o" d="M1.6-8.6C4-10.6 7-9.6 7.6-7.1 5.1-6.5 3.1-7.1 1.6-8.6Z"/>` },
    { id: 'apple', k: 0.94, pals: ['cran', 'cran', 'green', 'amber'], shine: true, art: `
      <path class="f-m o" d="M0-5.5C3.5-8.6 9.4-6.4 9-.2 8.6 6.4 4.2 9.6 0 8.2-4.2 9.6-8.6 6.4-9-.2-9.4-6.4-3.5-8.6 0-5.5Z"/>
      <path class="f-d" opacity=".55" d="M-8.4 2C-7 7-3 9.3 0 8.2 3 9.3 7 7 8.4 2 6 6 2 7 0 6.5-2 7-6 6-8.4 2Z"/>
      <path class="st" d="M0-5.5Q.3-8.5 1.6-10"/>
      <path class="f-lf o" d="M1-8.2C3-10.6 6.4-10.4 7.4-8.6 5.4-7.2 2.8-7.2 1-8.2Z"/>` },
    { id: 'pear', k: 0.98, pals: ['amber', 'green', 'amber'], shine: true, art: `
      <path class="f-m o" d="M0-8.4C2.6-8.4 3.2-5.6 3.8-3.4 7.8-.6 8.4 7.8 0 9.6-8.4 7.8-7.8-.6-3.8-3.4-3.2-5.6-2.6-8.4 0-8.4Z"/>
      <path class="f-d" opacity=".5" d="M-7.2 3.2C-6.6 7.6-3.4 9.4 0 9.6 3.4 9.4 6.6 7.6 7.2 3.2 5 6.8 2.4 7.6 0 7.6-2.4 7.6-5 6.8-7.2 3.2Z"/>
      <path class="st" d="M0-8.4Q.6-10.6 2.2-11.4"/>` },
    { id: 'gourd', k: 1.02, pals: ['amber', 'green', 'orange'], shine: true, art: `
      <path class="f-m o" d="M-.6-9.6C1.8-9.8 2.6-7 2.6-4.6 7.4-2.4 8.6 6.8 1.6 9.4-5.4 11-8.8 3.6-3.6-1.6-3.6-5-3.4-9.4-.6-9.6Z"/>
      <path class="ln-s" d="M.2-9C0-4-2 0-4.2 4M1.6-8.6C2-3 2 3 0 9.2M2.6-4.2C5-1 6.2 4 4.8 7.8"/>
      <path class="st" d="M-.6-9.6Q-1-11.4.6-12"/>` },
    { id: 'grapes', k: 1.0, pals: ['grape'], shine: false, art: `
      <path class="st" d="M0-7Q.6-9.6 2.4-10.6"/>
      <path class="f-lf o" d="M.4-7.6C-2.4-10.8-6.6-10-7.4-7.4-4.6-6-2-6.2.4-7.6Z"/>${grapes}` },
    { id: 'corn', k: 1.04, pals: ['amber'], shine: false, art: `
      <g transform="rotate(-35)">
        <path class="f-lf o" d="M-1.6-10.6C-6.2-6-6.6 4-2.6 9.4L-.4 6Z"/>
        <ellipse class="f-m o" cx=".6" cy="-.6" rx="4.4" ry="9.4"/>${kernels}
        <path class="f-lf o" d="M3.4-8.8C7.2-5 7.2 4 2.4 10L1 6.4Z"/>
      </g>` },
    { id: 'wheat', k: 0.96, pals: ['amber'], shine: false, art: `
      <g transform="rotate(-22)">
        <path class="ln-stalk" d="M-1.2-1L-3.4 10.4M0-1V10.8M1.2-1L3.4 10.4"/>
        ${head(-3, -2.4, -16)}${head(0, -3.6, 0)}${head(3, -2.4, 16)}
        <rect class="f-band o thin" x="-2.8" y="2.6" width="5.6" height="2" rx=".7"/>
      </g>` },
  ];
  const typeOf = (id) => TYPES[hash(id + 't') % TYPES.length];
  const palOf = (id, ty) => ty.pals[hash(id + 'c') % ty.pals.length];
  const artFor = (id) => { const ty = typeOf(id); return { ty, pal: PAL[palOf(id, ty)] }; };

  // ---------- the scene ----------
  function hornMarkup() {
    const N = 56, L = [], R = [], bands = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, [cx, cy] = bez(t), [nx, ny] = norm(t), r = radAt(t);
      L.push(`${(cx + nx * r).toFixed(1)} ${(cy + ny * r).toFixed(1)}`);
      R.push(`${(cx - nx * r).toFixed(1)} ${(cy - ny * r).toFixed(1)}`);
    }
    const outline = `M${L.join(' L')} L${R.reverse().join(' L')}Z`;
    // the woven rings: arcs across the body bowed toward the mouth
    for (let t = 0.07; t < 0.94; t += 0.068) {
      const [cx, cy] = bez(t), [nx, ny, tx, ty] = norm(t), r = radAt(t);
      const qx = cx - tx * r * 0.42, qy = cy - ty * r * 0.42;
      bands.push(`M${(cx + nx * r).toFixed(1)} ${(cy + ny * r).toFixed(1)}Q${qx.toFixed(1)} ${qy.toFixed(1)} ${(cx - nx * r).toFixed(1)} ${(cy - ny * r).toFixed(1)}`);
    }
    const line = (k, t1) => {
      const pts = [];
      for (let i = 0; i <= 40; i++) { const t = (i / 40) * t1, [cx, cy] = bez(t), [nx, ny] = norm(t), r = radAt(t); pts.push(`${(cx + nx * r * k).toFixed(1)} ${(cy + ny * r * k).toFixed(1)}`); }
      return `M${pts.join(' L')}`;
    };
    const m = MOUTH;
    return `
      <g class="hn-horn">
        <path class="hn-horn-body" d="${outline}"/>
        <path class="hn-horn-weave" d="${outline}"/>
        <path class="hn-horn-shade" d="${line(-0.55, 0.92)}"/>
        <path class="hn-horn-hi" d="${line(0.5, 0.86)}"/>
        <path class="hn-horn-bands" d="${bands.join('')}"/>
        <path class="hn-horn-edge" d="${outline}"/>
        <g transform="rotate(${m.ang.toFixed(1)} ${m.cx} ${m.cy})">
          <ellipse class="hn-mouth-in" cx="${m.cx}" cy="${m.cy}" rx="${m.a.toFixed(1)}" ry="${m.b.toFixed(1)}"/>
          <ellipse class="hn-mouth-rim" cx="${m.cx}" cy="${m.cy}" rx="${m.a.toFixed(1)}" ry="${m.b.toFixed(1)}"/>
          <ellipse class="hn-mouth-braid" cx="${m.cx}" cy="${m.cy}" rx="${m.a.toFixed(1)}" ry="${m.b.toFixed(1)}"/>
        </g>
      </g>`;
  }
  const BASKET_MARKUP = `
    <g class="hn-basket">
      <path class="hn-basket-handle" d="M298 320C298 262 390 262 390 320"/>
      <ellipse class="hn-basket-in" cx="344" cy="320" rx="52" ry="10"/>
      <g class="hn-basket-items"></g>
      <path class="hn-basket-body" d="M292 320Q344 334 396 320L387 392Q344 401 301 392Z"/>
      <path class="hn-basket-weave" d="M292 320Q344 334 396 320L387 392Q344 401 301 392Z"/>
      <path class="hn-basket-bands" d="M295 340Q344 354 393 340M297.5 360Q344 374 390.5 360M299.6 378Q344 391 388.4 378"/>
      <path class="hn-basket-rim" d="M292 320Q344 334 396 320"/>
    </g>`;
  const MARKUP = `
    <svg class="hn-svg" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="hn-weave" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <path d="M0 2H8M0 6H8" class="hn-weave-a"/><path d="M2 0V2M6 2V6M2 6V8" class="hn-weave-b"/>
        </pattern>
        <linearGradient id="hn-g-table" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient>
        <radialGradient id="hn-g-shadow"><stop offset="0"/><stop offset="1"/></radialGradient>
        <radialGradient id="hn-g-mouth" cx="0.62" cy="0.5" r="0.6"><stop offset="0"/><stop offset="1"/></radialGradient>
        <filter id="hn-blur" x="-20%" y="-100%" width="140%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
        <filter id="hn-glowf" x="-60%" y="-60%" width="220%" height="220%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="1.2" result="ring"/>
          <feFlood class="hn-glow-c"/><feComposite in2="ring" operator="in" result="ringc"/>
          <feGaussianBlur in="ringc" stdDeviation="2.2" result="glow"/>
          <feMerge><feMergeNode in="glow"/><feMergeNode in="glow"/><feMergeNode in="ringc"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path class="hn-table" d="M0 248H400V400H0Z"/>
      <path class="hn-table-planks" d="M0 266H400M0 290H400M0 320H400M0 357H400"/>
      <path class="hn-table-grain" d="M24 278q30-3 60 0M150 304q40-4 80 0M262 280q24-2 48 0M40 338q50-5 100 0M210 372q60-5 120 0M90 388q30-2 60 0"/>
      <path class="hn-table-edge" d="M0 248H400"/>
      <ellipse class="hn-horn-shadow" cx="122" cy="270" rx="128" ry="17"/>
      ${hornMarkup()}
      <g class="hn-shadows"></g>
      <g class="hn-produce"></g>
      ${BASKET_MARKUP}
    </svg>
    <span class="hn-left" aria-hidden="true"></span>
    <span class="hn-picked" aria-hidden="true"></span>
    <button type="button" class="hn-pour" hidden>Tip it back in</button>
    <div class="hn-name" aria-hidden="true"><span></span></div>
    <div class="hn-burst" aria-hidden="true"></div>`;

  const LEAF = 'M50 4 57 22 66 16 64 36 80 26 76 38 92 40 80 52 86 58 64 62 66 72 52 66 52 92 48 92 48 66 34 72 36 62 14 58 20 52 8 40 24 38 20 26 36 36 34 16 43 22Z';
  function burstMarkup() {
    let s = '';
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rnd(-0.15, 0.15), d = rnd(24, 42);
      s += `<i style="--dx:${(Math.cos(a) * d).toFixed(1)}cqi;--dy:${(Math.sin(a) * d * 0.6 - 6).toFixed(1)}cqi;--fall:${rnd(10, 22).toFixed(1)}cqi;--r:${rnd(-260, 260).toFixed(0)}deg;--d:${(i % 6) * 40}ms;--c:var(--hn-leaf-${i % 4})"><svg viewBox="0 0 100 100"><path d="${LEAF}"/></svg></i>`;
    }
    return s;
  }

  function build(doc) {
    if (views.has(doc)) return views.get(doc).el;
    const wrap = doc.querySelector('.wheel-wrap');
    if (!wrap) return null;
    const el = doc.createElement('div');
    el.className = 'horn';
    el.id = 'horn';
    el.dataset.state = '';
    el.innerHTML = MARKUP;
    wrap.appendChild(el);
    const v = {
      doc, el,
      svg: el.querySelector('.hn-svg'),
      produce: el.querySelector('.hn-produce'),
      shadows: el.querySelector('.hn-shadows'),
      basket: el.querySelector('.hn-basket'),
      items: el.querySelector('.hn-basket-items'),
      left: el.querySelector('.hn-left'),
      pickedEl: el.querySelector('.hn-picked'),
      pourBtn: el.querySelector('.hn-pour'),
      name: el.querySelector('.hn-name'),
      burst: el.querySelector('.hn-burst'),
      pieces: new Map(),                         // id -> piece
      leaving: [],                               // pieces on their way to the basket or fading out
      order: '',
      R: 16,
      active: null, show: null, released: false, chosen: false, revealed: false,
      picked: null, total: 0, off: false, pouring: false,
      incoming: new Map(),                       // id -> where it leaves the basket (pour)
      sound: false, roll: null, lastKnock: 0,
      last: 0, timers: [],
    };
    views.set(doc, v);
    v.pourBtn.addEventListener('click', (e) => { e.stopPropagation(); pour(v); });
    v.pourBtn.addEventListener('keydown', (e) => e.stopPropagation());
    const win = doc.defaultView;
    const frame = (t) => { step(v, t); win.requestAnimationFrame(frame); };
    win.requestAnimationFrame(frame);
    return el;
  }

  // ---------- pieces ----------
  function makePiece(v, item) {
    const doc = v.doc, { ty, pal } = artFor(item.id);
    const g = svgEl(doc, 'g', `hn-piece t-${ty.id}`);
    g.setAttribute('style', palStyle(pal));
    g.innerHTML = `<g class="hn-roll">${ty.art}</g>${ty.shine ? SHINE : ''}`;
    const sh = svgEl(doc, 'ellipse', 'hn-shadow');
    v.produce.appendChild(g);
    v.shadows.appendChild(sh);
    const k = ty.k * (0.9 + (hash(item.id + 'k') % 1000) / 1000 * 0.2);
    return {
      id: item.id, label: item.label, g, roll: g.firstChild, sh, k, r: v.R * k,
      ord: hash(item.id + 'o'),
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: (hash(item.id + 'r') % 60) - 30, w: 0, sc: 1,
      mode: 'rest', slot: null, placed: false, hold: 0, fly: null,
    };
  }

  // Draw the current list: add new pieces, drop missing ones (the chosen one
  // in front goes into the basket; anyone taken off just fades), keep the rest.
  function sync(doc, list) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    const ids = new Set(list.map((x) => x.id));
    for (const [id, p] of v.pieces) {
      if (ids.has(id)) continue;
      if (v.active && v.active.winnerId === id) continue;
      v.pieces.delete(id);
      if (p === v.show) { v.show = null; hideName(v); }
      if (p.mode === 'show' && v.picked && basketOn(v)) toBasket(v, p);
      else { p.mode = 'gone'; p.g.classList.add('leaving'); v.leaving.push(p); setTimeout(() => drop(v, p), 420); }
    }
    for (const item of list) {
      let p = v.pieces.get(item.id);
      if (!p) {
        p = makePiece(v, item);
        v.pieces.set(item.id, p);
        const from = v.incoming.get(item.id);
        if (from) { p.from = from; v.incoming.delete(item.id); }
        else if (v.built) { p.g.classList.add('born'); setTimeout(() => p.g.classList.remove('born'), 500); }   // remove it: a re-append for draw order would replay it
      }
      p.label = item.label;
    }
    v.built = true;
    assignSlots(v);
    paintCount(v);
  }
  function drop(v, p) {
    p.g.remove(); p.sh.remove();
    v.leaving = v.leaving.filter((q) => q !== p);
  }
  const basketOn = (v) => !v.doc.body.classList.contains('wheel-popout') && !!v.picked;

  // Resting places, filled from the horn outward, so a smaller class (or a
  // round half called) leaves a smaller spill and then an emptying horn.
  function makeSlots(n, R) {
    const s = R * 1.62, pts = [];
    const m = MOUTH, ca = Math.cos(m.ang * Math.PI / 180), sa = Math.sin(m.ang * Math.PI / 180);
    // in the mouth: points inside its (turned) opening, the bottom first
    for (let sy = m.cy - m.b; sy <= m.cy + m.b; sy += s * 0.82) {
      for (let sx = m.cx - m.b; sx <= m.cx + m.b; sx += s) {
        const dx = sx - m.cx, dy = sy - m.cy, u = dx * ca + dy * sa, w = -dx * sa + dy * ca;
        if ((u / (m.a - R * 0.55)) ** 2 + (w / (m.b - R * 0.7)) ** 2 > 1) continue;
        pts.push({ sx, sy, pr: Math.hypot(sx - (m.cx + 4), (sy - (m.cy + m.b)) * 1.3) });
      }
    }
    // spilling onto the table, in two layers, nearest the mouth first
    for (let grow = 1; pts.length < n + 4 && grow < 4; grow += 0.5) {
      const spill = [];
      const rx = 104 * grow, ry = 32 * Math.min(grow, 1.9), cx = 190, cy = 300;
      let row = 0;
      for (let y = cy - ry; y <= cy + ry; y += s * 0.78, row++) {
        for (let x = cx - rx + (row % 2) * s / 2; x <= cx + rx; x += s) {
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
          if (x < TABLE.x0 + R || x > BASKET.x - R || y < TABLE.y0 + R * 0.5 || y > TABLE.y1 - R) continue;
          const d = Math.hypot(x - (m.cx + 14), (y - 276) * 2.2);
          spill.push({ x, y, z: 0, pr: 1000 + d });
          if (((x - cx) / (rx * 0.66)) ** 2 + ((y - cy) / (ry * 0.6)) ** 2 < 1) spill.push({ x: x + s * 0.5, y: y - 2, z: R * 1.15, pr: 1000 + d + 34 });
        }
      }
      pts.length = 0;
      for (let sy = m.cy - m.b; sy <= m.cy + m.b; sy += s * 0.82) {
        for (let sx = m.cx - m.b; sx <= m.cx + m.b; sx += s) {
          const dx = sx - m.cx, dy = sy - m.cy, u = dx * ca + dy * sa, w = -dx * sa + dy * ca;
          if ((u / (m.a - R * 0.55)) ** 2 + (w / (m.b - R * 0.7)) ** 2 > 1) continue;
          pts.push({ sx, sy, pr: Math.hypot(sx - (m.cx + 4), (sy - (m.cy + m.b)) * 1.3) });
        }
      }
      pts.push(...spill);
    }
    pts.sort((a, b) => a.pr - b.pr);
    return pts.slice(0, n).map((q) => {
      if (q.sx === undefined) return q;
      const y = Math.max(HORN_FLOOR, q.sy + 0.85 * R), z = y - q.sy - 0.85 * R;
      return { x: q.sx, y: y + (q.sy - m.cy) * 0.02, z, mouth: true };
    });
  }
  // every piece in the horn gets a slot (by a stable per-student order); the
  // size follows the head count
  function assignSlots(v) {
    const list = [...v.pieces.values()].filter((p) => p.mode !== 'show' && p.mode !== 'chosen').sort((a, b) => a.ord - b.ord);
    const n = list.length;
    v.R = n <= 26 ? 16 : 16 * Math.sqrt(26 / n);
    const slots = makeSlots(n, v.R);
    list.forEach((p, i) => {
      p.r = v.R * p.k;
      p.slot = slots[i] || { x: 190, y: 300, z: 0 };
      if (p.from) {                              // poured back from the basket: fly to its place
        p.x = p.from.x; p.y = p.from.y; p.z = p.from.z;
        startFly(v, p, p.slot, { delay: p.from.delay, dur: 620, lift: 70 });
        p.from = null; p.placed = true;
      } else if (!p.placed) { p.x = p.slot.x; p.y = p.slot.y; p.z = p.slot.z; p.placed = true; }
    });
    for (const p of v.pieces.values()) if (p.mode === 'show' || p.mode === 'chosen') p.r = v.R * p.k;
  }
  function startFly(v, p, to, { delay = 0, dur = 650, lift = 40, toBasket = false } = {}) {
    p.mode = toBasket ? 'basket' : 'fly';
    p.fly = { from: { x: p.x, y: p.y, z: p.z, sc: p.sc }, to, t0: performance.now() + delay, dur: reduced(v.doc) ? 250 : dur, lift: reduced(v.doc) ? 0 : lift };
  }

  // ---------- the loop ----------
  function step(v, t) {
    const dt = Math.min(0.033, v.last ? (t - v.last) / 1000 : 0.016);
    v.last = t;
    if (!isOn(v.doc) || !v.el.offsetParent) return;      // other themes: idle
    const s = v.active;
    const el = s ? Date.now() - s.startedAt : 0;
    if (s) {
      if (!v.released && el >= T.release) release(v);
      if (!v.chosen && el >= T.chosen) choose(v, el);
      if (!v.revealed && el >= T.reveal) reveal(v);
      const st = el < T.upright ? 'tipping' : 'rolling';
      if (v.el.dataset.state !== st) v.el.dataset.state = st;
    }
    const free = [];
    let speed = 0;
    for (const p of v.pieces.values()) {
      if (p.mode === 'free') {
        if (el < p.hold) continue;
        physics(v, p, dt);
        free.push(p);
        if (p.z === 0) speed += Math.hypot(p.vx, p.vy);
      } else if (p.mode === 'chosen') {
        chosenStep(p, el, dt);
        free.push(p);
      } else if (p.mode === 'rest') {
        const k = Math.min(1, dt * 7);
        p.x += (p.slot.x - p.x) * k; p.y += (p.slot.y - p.y) * k; p.z += (p.slot.z - p.z) * k;
        p.sc += (1 - p.sc) * k;
      } else if (p.mode === 'fly') {
        flyStep(v, p, t);
      } else if (p.mode === 'show') {
        p.x += (FRONT.x - p.x) * 0.2; p.y += (FRONT.y - p.y) * 0.2; p.z *= 0.8;
      }
    }
    if (free.length) collide(v, free);
    for (const p of v.leaving) if (p.mode === 'basket') flyStep(v, p, t);
    if (v.roll) {
      const c = v.roll.ctx;
      v.roll.gain.gain.setTargetAtTime(Math.min(0.11, speed / 9000), c.currentTime, 0.05);
    }
    paint(v);
  }

  function physics(v, p, dt) {
    if (p.z > 0 || p.vz > 0) {
      p.vz -= G * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0;
        if (p.vz < -110) { knock(v, Math.min(1, -p.vz / 500)); p.vz = -p.vz * 0.3; } else p.vz = 0;
      }
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.z === 0) {
      // rolling friction: a constant drag plus a share of the speed, so they
      // slow to a real stop instead of creeping
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0) {
        const keep = Math.max(0, sp - (70 * dt + sp * (1 - Math.exp(-1.5 * dt)))) / sp;
        p.vx *= keep; p.vy *= keep;
      }
      p.w = (p.vx / p.r) * (180 / Math.PI);
    } else {
      p.vx *= Math.exp(-0.2 * dt); p.vy *= Math.exp(-0.2 * dt);
    }
    p.rot += p.w * dt;
    // the table's edges (with No repeats on, the basket fills its right end)
    const r = p.r;
    if (p.x < TABLE.x0 + r) { p.x = TABLE.x0 + r; p.vx = Math.abs(p.vx) * 0.45; }
    const x1 = basketOn(v) ? BASKET.x : TABLE.x1;          // the basket takes the right end of the table
    if (p.x > x1 - r) { p.x = x1 - r; p.vx = -Math.abs(p.vx) * 0.45; }
    if (p.y < TABLE.y0 + r * 0.4) { p.y = TABLE.y0 + r * 0.4; p.vy = Math.abs(p.vy) * 0.45; }
    if (p.y > TABLE.y1 - r * 0.2) { p.y = TABLE.y1 - r * 0.2; p.vy = -Math.abs(p.vy) * 0.45; }
  }
  // soft circles with weight: a heavier piece shoves a lighter one; the
  // chosen piece is driven, so it pushes everything out of its way
  function collide(v, list) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const sum = (a.r * a.sc + b.r * b.sc) * 0.92;
        if (Math.abs(a.z - b.z) > sum * 0.9) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= sum || d < 0.01) continue;
        const nx = dx / d, ny = dy / d, ov = sum - d;
        const ia = a.mode === 'chosen' ? 0 : 1 / (a.r * a.r), ib = b.mode === 'chosen' ? 0 : 1 / (b.r * b.r);
        if (ia + ib === 0) continue;
        a.x -= nx * ov * ia / (ia + ib); a.y -= ny * ov * ia / (ia + ib);
        b.x += nx * ov * ib / (ia + ib); b.y += ny * ov * ib / (ia + ib);
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const j2 = -(1 + 0.42) * vn / (ia + ib);
          a.vx -= j2 * ia * nx; a.vy -= j2 * ia * ny;
          b.vx += j2 * ib * nx; b.vy += j2 * ib * ny;
          if (vn < -70) knock(v, Math.min(1, -vn / 400));
        }
      }
    }
  }
  function chosenStep(p, el, dt) {
    const f = p.path;
    const u = clamp((el - f.t0) / TO_FRONT, 0, 1), e = easeInOut(u);
    const ox = p.x, oy = p.y;
    p.x = f.x + (FRONT.x - f.x) * e;
    p.y = f.y + (FRONT.y - f.y) * e;
    p.z = f.z * Math.max(0, 1 - u * 3);
    p.sc = 1 + GROW * easeOut(u);
    p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt;
    p.rot += ((p.x - ox) / p.r) * (180 / Math.PI);
    if (u >= 1) { p.mode = 'show'; p.vx = p.vy = 0; }
  }
  function flyStep(v, p, now) {
    const f = p.fly;
    const u = clamp((now - f.t0) / f.dur, 0, 1);
    if (u <= 0) return;
    const e = easeInOut(u);
    p.x = f.from.x + (f.to.x - f.from.x) * e;
    p.y = f.from.y + (f.to.y - f.from.y) * e;
    p.z = f.from.z + (f.to.z - f.from.z) * e + f.lift * Math.sin(Math.PI * u);
    p.sc = f.from.sc + ((f.to.sc || 1) - f.from.sc) * e;
    p.rot += (f.to.x - f.from.x) * 0.02;
    if (u >= 1) {
      if (p.mode === 'basket') { drop(v, p); renderBasket(v); paintCount(v); }
      else { p.mode = 'rest'; p.fly = null; }
    }
  }

  // positions → transforms; draw order by depth (the piece in flight on top)
  function paint(v) {
    const all = [...v.pieces.values(), ...v.leaving];
    for (const p of all) {
      const rr = p.r * p.sc * persp(p.y);
      const sy = p.y - p.z - rr * 0.85;
      p.g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${sy.toFixed(1)}) scale(${(rr / 10).toFixed(3)})`);
      p.roll.setAttribute('transform', `rotate(${p.rot.toFixed(1)})`);
      const lift = Math.min(1, p.z / 70);
      const hide = p.mode === 'rest' && p.slot && p.slot.mouth;
      p.sh.setAttribute('cx', p.x.toFixed(1));
      p.sh.setAttribute('cy', p.y.toFixed(1));
      p.sh.setAttribute('rx', (rr * (1 - lift * 0.4)).toFixed(1));
      p.sh.setAttribute('ry', (rr * 0.3 * (1 - lift * 0.4)).toFixed(1));
      p.sh.style.opacity = hide ? '0' : (0.55 * (1 - lift * 0.8)).toFixed(2);
      p.depth = (p.mode === 'fly' || p.mode === 'basket') ? 900 + p.y : p.mode === 'show' || p.mode === 'chosen' ? 800 + p.y : p.y + (p.z > 0 && !p.slot?.mouth ? 0.5 : 0);
    }
    all.sort((a, b) => a.depth - b.depth);
    const key = all.map((p) => p.id).join(',');
    if (key !== v.order) {
      v.order = key;
      all.forEach((p) => v.produce.appendChild(p.g));
    }
  }

  // ---------- a pick ----------
  function run(doc, s, { sound = false } = {}) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    v.timers.forEach(clearTimeout); v.timers = [];
    hideName(v);
    // last pick's piece, still in front (No repeats off): back into the tumble
    if (v.show && v.pieces.get(v.show.id) === v.show) { v.show.mode = 'free'; v.show.g.classList.remove('chosen'); }
    v.show = null;
    v.active = s;
    v.released = v.chosen = v.revealed = false;
    v.sound = sound;
    v.el.dataset.state = '';
    void v.el.offsetWidth;                        // restart the tip
    v.el.dataset.state = 'tipping';
    for (const p of v.pieces.values()) if (p.mode === 'fly') { p.mode = 'rest'; p.x = p.slot.x; p.y = p.slot.y; p.z = p.slot.z; }
    if (sound) tipSound(v);
    paintPour(v);
  }
  // Out they come: front of the spill first, the horn's mouth last, each with
  // a push forward and out to the side, a hop, and a spin.
  function release(v) {
    v.released = true;
    const list = [...v.pieces.values()].filter((p) => p.mode === 'rest' || p.mode === 'free');
    list.sort((a, b) => (b.slot?.mouth ? 0 : b.y) - (a.slot?.mouth ? 0 : a.y));
    const gap = list.length ? Math.min(28, (T.releaseEnd - T.release) / list.length) : 0;
    list.forEach((p, i) => {
      const mouth = p.slot && p.slot.mouth;
      p.mode = 'free';
      p.hold = T.release + i * gap;
      p.vx = mouth ? rnd(30, 190) : rnd(-70, 150) + (p.x - MOUTH.cx) * 0.9;
      p.vy = mouth ? rnd(110, 230) : rnd(50, 190);
      p.vz = mouth ? rnd(40, 140) : rnd(70, 210);
      p.w = rnd(-500, 500);
    });
    if (v.sound) startRoll(v);
  }
  // the winner comes loose, lights up and heads for the front
  function choose(v, el) {
    v.chosen = true;
    const p = v.pieces.get(v.active.winnerId);
    if (!p) return;
    if (p.mode !== 'free' || el < p.hold) { p.vz = 0; }
    p.mode = 'chosen';
    p.path = { x: p.x, y: p.y, z: p.z, t0: el };
    p.g.classList.add('chosen');
    v.show = p;
  }
  function reveal(v) {
    v.revealed = true;
    const p = v.active && v.pieces.get(v.active.winnerId);
    if (!p) return;
    if (p.mode === 'chosen') { p.mode = 'show'; }
    p.x = FRONT.x; p.y = FRONT.y; p.z = 0; p.sc = 1 + GROW;
    p.g.classList.add('chosen');
    v.show = p;
    showName(v, p);
    if (v.sound) chime();
  }
  function showName(v, p) {
    const rr = p.r * (1 + GROW) * persp(FRONT.y);
    const top = FRONT.y - rr * 1.85 - 4;
    const label = p.label || '';
    const longest = Math.max(4, ...label.split(/\s+/).map((w) => w.length));
    v.name.firstChild.textContent = label;
    v.name.style.setProperty('--fs', `${Math.min(12, 88 / (longest * 0.56)).toFixed(2)}cqi`);
    v.name.style.left = `${(FRONT.x / 4).toFixed(2)}%`;
    v.name.style.bottom = `${((400 - top) / 4).toFixed(2)}%`;
    v.name.title = label;
    v.name.classList.remove('go');
    void v.name.offsetWidth;
    v.name.classList.add('go');
    v.burst.innerHTML = burstMarkup();
    v.burst.style.left = v.name.style.left;
    v.burst.style.setProperty('--fs', v.name.style.getPropertyValue('--fs'));
    v.burst.style.bottom = `calc(${v.name.style.bottom} + var(--fs) * 0.6)`;
    v.burst.classList.remove('go');
    void v.burst.offsetWidth;
    v.burst.classList.add('go');
  }
  function hideName(v) {
    v.name.classList.remove('go');
    v.burst.classList.remove('go');
  }
  // the end: the winner in front with the name up (even if this window
  // missed frames), and everyone else rolls back into the horn
  function finish(doc, s) {
    const v = views.get(doc);
    if (!v) return;
    if (!v.released) release(v);
    if (!v.revealed) { v.active = v.active || s; reveal(v); }
    v.active = null;
    v.el.dataset.state = 'picked';
    stopRoll(v);
    for (const p of v.pieces.values()) if (p.mode === 'chosen') p.mode = 'show';
    v.timers.push(setTimeout(() => goHome(v), 450));
    paintCount(v);
    paintPour(v);
  }
  function goHome(v) {
    assignSlots(v);
    const list = [...v.pieces.values()].filter((p) => p.mode === 'free' || p.mode === 'rest');
    // the ones nearest the horn go first
    list.sort((a, b) => Math.hypot(a.x - MOUTH.cx, a.y - HORN_FLOOR) - Math.hypot(b.x - MOUTH.cx, b.y - HORN_FLOOR));
    const gap = list.length ? Math.min(40, 700 / list.length) : 0;
    list.forEach((p, i) => { p.vx = p.vy = p.vz = 0; startFly(v, p, p.slot, { delay: i * gap, dur: 600, lift: 34 + p.r }); });
    if (v.sound && soundOn(v.doc)) homeSound(list.length, gap);
  }
  function setWinner(doc, name, state) {
    const v = views.get(doc);
    if (!v) return;
    if (!name && !state && !v.active) { v.el.dataset.state = ''; }
  }
  function setDisabled(doc, off) {
    const v = views.get(doc);
    if (!v) return;
    v.off = !!off;
    v.el.setAttribute('aria-disabled', String(v.off || busy(doc)));
    paintPour(v);
  }
  const busy = (doc) => { const v = views.get(doc); return !!v && v.pouring; };

  // ---------- counts ----------
  function paintCount(v) {
    let n = 0;
    for (const p of v.pieces.values()) if (p !== v.show || !v.picked) n++;
    v.left.textContent = v.picked ? `${n} left` : `${n} in the horn`;
    const m = v.items.children.length;
    v.pickedEl.textContent = basketOn(v) && m ? `${m} picked` : '';
    paintPour(v);
  }
  function paintPour(v) {
    const m = v.items.children.length;
    v.pourBtn.hidden = !basketOn(v) || !m || v.pouring;
    v.pourBtn.disabled = !!v.active;
    let inHorn = 0;
    for (const p of v.pieces.values()) if (p !== v.show) inHorn++;
    v.pourBtn.classList.toggle('primary', inHorn === 0);
  }

  // ---------- the basket: everyone picked this round, names on them ----------
  function setPicked(doc, list, total) {
    const v = views.get(doc);
    if (!v) return;
    v.picked = list;
    v.total = Math.max(total || 0, list ? list.length : 0);
    v.el.classList.toggle('has-basket', basketOn(v));
    renderBasket(v);
    paintCount(v);
  }
  function basketSpots(n, total) {
    const rm = clamp(Math.sqrt((96 * 110) / (Math.max(total, 1) * 2.4)), 10, 14);
    const spots = [];
    for (let row = 0, y = 318; spots.length < n; row++, y -= rm * 1.2) {
      const w = 96 - row * 4, per = Math.max(1, Math.floor(w / (rm * 1.7)));
      for (let i = 0; i < per && spots.length < n; i++) spots.push({ x: 344 - ((per - 1) * rm * 1.7) / 2 + i * rm * 1.7 + (row % 2) * rm * 0.4, y, rm });
    }
    return spots;
  }
  function renderBasket(v) {
    if (!v.picked || !basketOn(v)) { v.items.innerHTML = ''; return; }
    const flying = new Set(v.leaving.map((p) => p.id));
    const list = v.picked.filter((p) => !flying.has(p.id) && !(v.show && v.show.id === p.id));
    const spots = basketSpots(list.length, v.total);
    v.items.innerHTML = list.map((it, i) => {
      const { ty, pal } = artFor(it.id), q = spots[i];
      const label = it.label || '';
      const fs = Math.min(q.rm * 0.6, (q.rm * 1.9) / (Math.max(3, label.length) * 0.52));
      return `<g class="hn-mini" data-id="${it.id}" transform="translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})" style="${palStyle(pal)}"><title>${escapeHtml(label)}</title>`
        + `<g transform="scale(${(q.rm / 10).toFixed(3)}) rotate(${(hash(it.id + 'r') % 40) - 20})">${ty.art}</g>`
        + `<text class="hn-mini-name" y="${(fs * 0.35).toFixed(2)}" style="font-size:${fs.toFixed(2)}px">${escapeHtml(label)}</text></g>`;
    }).reverse().join('');                       // the top of the pile first, so the front row draws over it
  }

  // the chosen piece rolls off the front and drops into the basket
  function toBasket(v, p) {
    p.g.classList.remove('chosen');
    v.leaving.push(p);
    const spot = basketSpots((v.picked ? v.picked.length : 1), v.total).pop() || { x: 344, y: 320, rm: 8 };
    startFly(v, p, { x: spot.x, y: 330, z: 330 - spot.y - 0.85 * spot.rm, sc: spot.rm / (p.r * persp(330)) }, { dur: 760, lift: 90, toBasket: true });
    if (soundOn(v.doc)) { const c = audio(); if (c) setTimeout(() => thunk(c, c.currentTime, 0.7), 700); }
  }

  // "Tip it back in": the basket tips toward the horn, and each piece in it
  // flies back to its place (wheel.js clears `called` as they leave)
  function pour(v) {
    if (v.pouring || v.active || !v.items.children.length) return;
    // the wheel may say no (a saved pick list asks before it is reset)
    if (!v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset-request', { cancelable: true }))) return;
    v.pouring = true;
    v.el.setAttribute('aria-disabled', 'true');
    v.basket.dataset.state = 'pouring';
    paintPour(v);
    const slow = reduced(v.doc);
    setTimeout(() => {
      const minis = [...v.items.children];
      const gap = slow ? 0 : Math.min(55, 900 / Math.max(1, minis.length));
      minis.forEach((g, i) => {                    // DOM order is top of the pile first
        const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform')) || [0, 344, 320];
        const sx = +m[1] - 30, sy = +m[2] - 40;       // the tipped basket lifts them up and toward the horn
        v.incoming.set(g.dataset.id, { x: sx, y: 330, z: Math.max(0, 330 - sy), delay: i * gap });
        if (soundOn(v.doc) && i % 2 === 0) { const c = audio(); if (c) blip(c, c.currentTime + (i * gap) / 1000 + 0.5, { type: 'triangle', f0: rnd(300, 520), f1: 180, len: 0.06, gain: 0.05 }); }
      });
      v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset'));   // the round starts over
      // last pick's piece, still in front, rolls home with the rest
      const sp = v.show;
      if (sp && v.pieces.get(sp.id) === sp) {
        v.show = null;
        hideName(v);
        sp.g.classList.remove('chosen');
        sp.mode = 'rest';
        assignSlots(v);
        startFly(v, sp, sp.slot, { dur: 650, lift: 40 });
      }
      v.incoming.clear();
      setTimeout(() => {
        v.pouring = false;
        v.basket.dataset.state = '';
        setDisabled(v.doc, v.off);
        paintCount(v);
      }, minis.length * gap + (slow ? 300 : 800));
    }, slow ? 0 : 380);
  }

  // ---------- sound: a wooden rumble, rolling and knocking, a chime ----------
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
  function blip(c, at, { type = 'sine', f0 = 900, f1 = 600, len = 0.05, gain = 0.05 } = {}) {
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
  // a hollow wooden knock: a low sine thump plus a short resonant click
  function thunk(c, at, s) {
    blip(c, at, { f0: 180 + rnd(-30, 40), f1: 90, len: 0.09, gain: 0.12 * s });
    blip(c, at, { type: 'triangle', f0: rnd(420, 720), f1: rnd(260, 380), len: 0.045, gain: 0.05 * s });
  }
  function knock(v, s) {
    if (!v.sound) return;
    const now = performance.now();
    if (now - v.lastKnock < 32 || s < 0.15) return;
    v.lastKnock = now;
    const c = audio();
    if (c) thunk(c, c.currentTime, s);
  }
  function tipSound() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    // the horn scraping and rumbling on the wood as it tips and shakes
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.12);
    g.gain.setValueAtTime(0.28, t0 + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0); src.stop(t0 + 1.25);
    [0, 0.17, 0.34, 0.52, 0.7].forEach((k, i) => thunk(c, t0 + k, i ? 0.6 : 1));
  }
  function startRoll(v) {
    const c = audio();
    if (!c) return;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = 'bandpass'; f.frequency.value = 340; f.Q.value = 0.9;
    g.gain.value = 0.0001;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start();
    v.roll = { ctx: c, src, gain: g };
  }
  function stopRoll(v) {
    if (!v.roll) return;
    const { ctx: c, src, gain } = v.roll;
    gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.08);
    src.stop(c.currentTime + 0.5);
    v.roll = null;
  }
  function chime() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(), at = t0 + i * 0.09;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.1, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
      o.connect(g); g.connect(c.destination);
      o.start(at); o.stop(at + 0.95);
    });
  }
  function homeSound(n, gap) {
    const c = audio();
    if (!c) return;
    for (let i = 0; i < n; i += 2) thunk(c, c.currentTime + (i * gap + 560) / 1000, 0.35);
  }

  window.Cornucopia = { DURATION_MS, SETTLE_MS, HOLDS_ROUND: true, isOn, busy, build, sync, run, finish, setWinner, setDisabled, setPicked };
})();
