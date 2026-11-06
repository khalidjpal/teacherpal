// sled.js — the Name Wheel's winter skin, the other picker: a sled race.
// (The teacher chooses it over Santa's sleigh with the Name Wheel's winter
// selector, data-wpick="race" on <html>; see shared.js's winterPicker().)
//
// A long snowy hill seen from the side, curving down with bumps and dips;
// pines along both edges (heavier at the back, snow on their branches),
// spectator snowmen, mountains and a winter sky behind (still). A START
// banner and gate at the top; a FINISH line with flags and a banner at the
// bottom. One sledder per student at the top, each on their own sled
// (toboggan, saucer, runner sled or inner tube, in their own colours), the
// name on a plate on the sled's side; at rest they jostle, bounce and fix
// their scarves.
//
// A pick (the T timeline below): a whistle, the gate swings up and they
// launch, snow spraying behind. The camera follows the pack down the hill
// (the trees, the far ridge and the foreground scroll past at their own
// depths): they bunch, overtake, bump off each other, catch air over the
// bumps and land with a thump, speed lines on the fastest. The pack thins
// and one pulls ahead and crosses the line: snow sprays, the name comes up
// large with snow and confetti, the winner throws their arms up and a couple
// of others wipe out. With No repeats on, the winner hops over to the lodge
// (fixed at the right of the view, warm windows) and goes in: everyone
// picked this round sits in its windows with cocoa, "7 / 28" on its sign.
// Then the view sweeps back up the hill, everyone else back at the top.
// "Let them out" (or Reset) sends them out of the lodge and back up.
//
// Same shape as workshop.js (wheel.js's skins): isOn, build, sync, run,
// finish, setWinner, setDisabled, setPicked, busy, HOLDS_ROUND, DURATION_MS,
// SETTLE_MS. It never picks anybody: the winner comes in the spin
// descriptor, already drawn by wheel.js. Everything a race shows is worked
// out from the descriptor (a seeded random of winnerId:startedAt) and the
// clock, so the full screen window runs the same race.
//
// Two lengths (the teacher's choice, shared.js's sledRace(), and it comes in
// the descriptor as s.long): the short race above (~5s, a straight run), or
// the LONG race (~12s) on a winding course: two banked bends (the track
// turns away from you, then back toward you), a valley (down steeply, then a
// slow climb out), a big jump, a tunnel of snow-laden pines, and a final
// straight where they sprint. The lead changes several times on the way
// (whoever leads at each stage is planned, never the winner going into the
// final straight), a couple of sledders tumble off and get back on, and
// numbered badges ride on the top three.
//
// Several places (s.winners, 1-6, drawn in order by wheel.js): they cross the
// line one at a time, a beat apart, each announced with their place and
// name; then a results panel lists them all, numbered, large. All of them go
// into the lodge.
(function () {
  'use strict';

  const DURATION_MS = 3400;     // a short race, one winner: the whistle to the name
  const SETTLE_MS = 1700;       // the cheer, the wipeouts, the hop to the lodge
  // a race's timeline (ms after the whistle), from the descriptor: the race's
  // length, then a beat per extra place, the results, the lodge, the sweep
  // back up the hill. timing() gives wheel.js the duration and settle.
  const SHORT = { gate: 120, go: 380, fin: 5400, beat: 650 };
  const LONG = { gate: 120, go: 420, fin: 19000, beat: 700 };
  function times(s) {
    const b = s && s.long ? LONG : SHORT;
    const n = Math.max(1, Math.min(6, (s && s.winners && s.winners.length) || 1));
    const cross = [];
    for (let k = 0; k < n; k++) cross.push(b.fin + k * b.beat);
    const last = cross[n - 1];
    const toLodge = last + (n > 1 ? 1600 : 850);
    return { ...b, long: !!(s && s.long), n, cross, last, results: n > 1 ? last + 950 : null, toLodge, back: toLodge + (n - 1) * 170 + 700, backDur: 950 };
  }
  function timing(s) { const t = times(s); return { duration: t.last, settle: t.back - t.last + 150 }; }
  const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  const PARTY_MS = 2600;
  const H = 400;                // the view is 400 units tall, as wide as the box
  const DEPTH = 116;            // the track's width, back edge to front edge (screen y)
  const SKEW = 30;              // ...and the front edge's lean to the left
  const PLAT = 150;             // the hilltop's height (world y)
  const CAM_Y = 228;            // where the track's back edge sits in the view

  const views = new Map();
  const isOn = (doc) => doc.documentElement.getAttribute('data-theme') === 'winter' && doc.documentElement.getAttribute('data-wpick') === 'race';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const seeded = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const reduced = (doc) => !!doc.defaultView.matchMedia && doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const calm = (doc) => reduced(doc) || doc.documentElement.getAttribute('data-effects') === 'reduced';
  const soundOn = (doc) => { const m = doc.getElementById('wheel-mute'); return !!m && m.getAttribute('aria-checked') !== 'true'; };
  const isPopout = (v) => v.doc.body.classList.contains('wheel-popout');
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (doc, tag, cls) => { const e = doc.createElementNS(NS, tag); if (cls) e.setAttribute('class', cls); return e; };
  const shortName = (s) => { s = String(s || ''); return s.length > 9 ? `${s.slice(0, 8).trimEnd()}…` : s; };
  const f1 = (n) => (Math.round(n * 10) / 10).toString();
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  // ---------- the hill ----------
  // World units: x along the course (downhill = right), y down the screen.
  // base(x) is the hill's smooth line, surf(x) adds the bumps and dips; the
  // track runs from its back edge (x, surf) to its front edge
  // (x − SKEW, surf + DEPTH). A sledder at course x and depth d (0 back,
  // 1 front) stands at (x − SKEW·d, surf(x) + 9 + (DEPTH − 18)·d).
  // The long course's stages, as fractions of the way from the start line to
  // the finish. Bends: the track turns away (dir −1: it narrows and leans the
  // other way) or toward you (dir 1: it widens). The pace (speed) follows
  // them: slower round the bends and up out of the valley, a sprint on the
  // final straight.
  const COURSE = {
    bends: [{ u0: 0.17, u1: 0.3, dir: -1 }, { u0: 0.54, u1: 0.65, dir: 1 }],
    valley: { u0: 0.34, mid: 0.405, u1: 0.47 },
    jump: 0.5,
    tunnel: { u0: 0.68, u1: 0.79 },
    final: 0.83,
  };
  const win01 = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(Math.PI * (u - a) / (b - a)));
  function geo(W, long = false) {
    const G = Math.round(0.58 * W);                    // the start line
    const L = Math.round(long ? G + 5000 + 1.3 * W : G + 800 + W);   // the finish line
    const span = L - G;
    const XMIN = -320, XMAX = Math.round(L + 1.2 * W);
    const STEP = 4, n = Math.ceil((XMAX - XMIN) / STEP) + 1;
    const base = new Float32Array(n), surf = new Float32Array(n);
    const dep = new Float32Array(n), skw = new Float32Array(n), bnd = new Float32Array(n);
    const C = COURSE;
    const bendU = (u) => { let b = 0; if (long) for (const k of C.bends) b += k.dir * smooth(win01(u, k.u0, k.u1) * 1.6); return b; };
    const slope = (x) => {
      if (x < G) return 0;
      if (x > L) { const u = (x - L) / 260; return u >= 1 ? 0 : 0.085 * (1 - smooth(u)); }
      const u = (x - G) / span;
      if (!long) return (0.27 + 0.07 * Math.sin(u * 9.4 + 0.6)) * smooth((x - G) / 150) * (1 - 0.68 * smooth((u - 0.84) / 0.16));
      // the long course: steady, then the valley (steep down, a climb out), a
      // steep final straight, a gentler run-out
      let sl = 0.22 + 0.05 * Math.sin(u * 21 + 0.6);
      sl += 0.24 * win01(u, C.valley.u0, C.valley.mid);
      sl -= 0.36 * win01(u, C.valley.mid, C.valley.u1);
      sl = lerp(sl, 0.34, smooth((u - C.final + 0.02) / 0.04));
      return sl * smooth((x - G) / 150) * (1 - 0.7 * smooth((u - 0.965) / 0.035));
    };
    let y = PLAT;
    for (let i = 0; i < n; i++) {
      const x = XMIN + i * STEP;
      base[i] = y; y += slope(x) * STEP;
      const b = bendU((x - G) / span);
      bnd[i] = b; dep[i] = DEPTH * (1 + 0.36 * b); skw[i] = SKEW + 46 * b;
    }
    // the kickers: a crest each (they catch air off it) and a dip after it;
    // the long course has a big jump halfway
    const crests = (long
      ? [{ u: 0.07, h: 12 }, { u: 0.13, h: 15 }, { u: C.jump, h: 30, w: 48, big: true }, { u: 0.885, h: 13 }, { u: 0.935, h: 11 }]
      : [0.16, 0.31, 0.47, 0.62, 0.77].map((u, i) => ({ u, h: 13 + (i % 3) * 3.5 })))
      .map((c) => ({ x: G + c.u * span, h: c.h, w: c.w || 30, big: !!c.big }));
    for (let i = 0; i < n; i++) {
      const x = XMIN + i * STEP;
      let s = base[i];
      for (const c of crests) {
        const a = (x - c.x) / c.w, b = (x - c.x - 62 * (c.big ? 2 : 1)) / (c.big ? 70 : 40);
        s -= c.h * Math.exp(-a * a);
        s += c.h * 0.75 * Math.exp(-b * b);
      }
      surf[i] = s;
    }
    const g = { W, G, L, span, XMIN, XMAX, STEP, base, surf, dep, skw, bnd, crests, long };
    g.YMIN = -340;
    g.YMAX = Math.ceil(baseAt(g, XMAX) + 560);
    g.LW = Math.round(clamp(0.21 * W, 160, 290));      // the lodge's width, fixed at the right of the view
    g.lodge = { s: g.LW / 270, x: W - g.LW - 6 };
    g.rest = { x: 0, y: baseAt(g, 0.5 * W) - CAM_Y };
    g.finX = L - 0.42 * W;
    // the pace: how far along the course (u) at each moment of the race
    // (tau, 0..1). Short: speeding up all the way. Long: from a speed per
    // stage, integrated, so the bends and the climb take longer.
    if (long) {
      const N = 1400, t = new Float32Array(N + 1);
      for (let i = 1; i <= N; i++) {
        const u = (i - 0.5) / N;
        let sp = (0.3 + 0.7 * smooth(u / 0.05)) * (1 - 0.15 * Math.abs(bendU(u)));
        sp *= 1 + 0.18 * win01(u, C.valley.u0, C.valley.mid) - 0.36 * win01(u, C.valley.mid, C.valley.u1);
        sp *= 1 + 0.42 * smooth((u - C.final + 0.03) / 0.06);
        t[i] = t[i - 1] + 1 / (N * sp);
      }
      const T1 = t[N], M = 800, prog = new Float32Array(M + 1);
      let j = 0;
      for (let k = 0; k <= M; k++) {
        const want = (k / M) * T1;
        while (j < N && t[j + 1] < want) j++;
        const a = t[j], b = t[Math.min(N, j + 1)];
        prog[k] = (j + (b > a ? (want - a) / (b - a) : 0)) / N;
      }
      g.prog = prog;
    }
    return g;
  }
  // how far along (0..1) at race time tau (0..1)
  const uAt = (g, tau) => {
    tau = clamp(tau, 0, 1);
    if (!g.prog) return tau ** 1.3;
    const f = tau * (g.prog.length - 1), i = Math.floor(f), j = Math.min(g.prog.length - 1, i + 1);
    return lerp(g.prog[i], g.prog[j], f - i);
  };
  // speed at the line, units per ms of race time
  const vLine = (g, race) => g.span * (uAt(g, 1) - uAt(g, 0.995)) / (0.005 * race);
  const look = (arr, g, x) => {
    const f = (clamp(x, g.XMIN, g.XMAX) - g.XMIN) / g.STEP, i = Math.floor(f), j = Math.min(arr.length - 1, i + 1);
    return lerp(arr[i], arr[j], f - i);
  };
  const baseAt = (g, x) => look(g.base, g, x);
  const surfAt = (g, x) => look(g.surf, g, x);
  const depAt = (g, x) => look(g.dep, g, x);     // the track's width here (it changes round the bends)
  const skwAt = (g, x) => look(g.skw, g, x);     // ...and its front edge's lean
  const bendAt = (g, x) => look(g.bnd, g, x);    // −1..1: how hard it turns here
  const slopeDeg = (g, x) => Math.atan2(surfAt(g, x + 6) - surfAt(g, x - 6), 12) * 180 / Math.PI;
  const camYAt = (g, cx) => baseAt(g, cx + 0.5 * g.W) - CAM_Y;
  // course (x, d) → world
  const onTrack = (g, x, d) => { const q = depAt(g, x) / DEPTH; return { x: x - skwAt(g, x) * d, y: surfAt(g, x) + q * (9 + (DEPTH - 18) * d) }; };
  // a point across the track's full width (d 0 = back edge, 1 = front edge)
  const edge = (g, x, d) => ({ x: x - skwAt(g, x) * d, y: surfAt(g, x) + depAt(g, x) * d });

  // ---------- art: the pines, the snowmen (symbols, reused with <use>) ----------
  function pinePath(tiers, cls, shadeCls, snow) {
    let s = '';
    for (const [top, bot, hw] of tiers) {
      s += `<path class="${cls}" d="M0 ${top}L${-hw} ${bot}Q${-hw / 2} ${bot + 3} 0 ${bot - 1}Q${hw / 2} ${bot + 3} ${hw} ${bot}Z"/>`;
      s += `<path class="${shadeCls}" d="M0 ${top}L${hw} ${bot}Q${hw / 2} ${bot + 3} 0 ${bot - 1}Z"/>`;
      if (snow) {
        const y1 = top + (bot - top) * 0.5;
        s += `<path class="sr-psnow" d="M0 ${top - 1}L${f1(-hw * 0.52)} ${f1(y1)}Q${f1(-hw * 0.3)} ${f1(y1 - 3.5)} ${f1(-hw * 0.12)} ${f1(y1 + 0.5)}Q${f1(hw * 0.1)} ${f1(y1 - 3)} ${f1(hw * 0.28)} ${f1(y1)}Q${f1(hw * 0.4)} ${f1(y1 - 2.5)} ${f1(hw * 0.5)} ${f1(y1 - 0.5)}Z"/>`;
        s += `<path class="sr-psnow" d="M${-hw - 1} ${bot + 0.5}Q${f1(-hw * 0.78)} ${bot - 5} ${f1(-hw * 0.5)} ${bot - 1}Q${f1(-hw * 0.3)} ${bot - 4.5} ${f1(-hw * 0.08)} ${bot}L${f1(-hw * 0.2)} ${bot + 2.5}Q${f1(-hw * 0.6)} ${bot + 3.5} ${-hw - 1} ${bot + 0.5}Z"/>`;
        s += `<path class="sr-psnow-d" d="M${f1(hw * 0.2)} ${bot}Q${f1(hw * 0.5)} ${bot - 4} ${f1(hw * 0.8)} ${bot - 0.5}Q${hw} ${bot - 2} ${hw + 1} ${bot + 0.5}Q${f1(hw * 0.6)} ${bot + 3.5} ${f1(hw * 0.2)} ${bot}Z"/>`;
      }
    }
    return s;
  }
  const PINE_NEAR = [[-38, -4, 27], [-58, -26, 21], [-78, -47, 15], [-94, -66, 8.5]];
  const PINE_TALL = [[-44, -4, 24], [-68, -28, 19], [-90, -52, 14], [-110, -74, 8.5]];
  const PINE_FAR = [[-30, -2, 15], [-46, -18, 11], [-60, -34, 7]];
  function snowman(v, hat, arms) {
    const armP = arms === 'up' ? 'M-9-40L-21-58M-17-52L-22-52M9-40L21-58M17-52L22-52'
      : arms === 'wave' ? 'M-9-38L-22-30M-18-32L-21-36M9-40L20-57M17-52L23-52'
        : 'M-9-38L-23-34M-19-35L-22-39M9-38L23-34M19-35L22-39';
    const hats = {
      top: '<rect class="sr-sm-hat" x="-7.5" y="-61" width="15" height="2.6" rx="1"/><rect class="sr-sm-hat" x="-5" y="-71" width="10" height="11" rx="1"/><rect class="sr-sm-band" x="-5" y="-63.6" width="10" height="2.2"/>',
      beanie: '<path class="sr-sm-beanie" d="M-7.4-59.5C-7.4-68 7.4-68 7.4-59.5Z"/><rect class="sr-sm-beanie-c" x="-8" y="-61" width="16" height="3" rx="1.4"/><circle class="sr-sm-pom" cx="0" cy="-67.8" r="2.4"/>',
      none: '<path class="sr-sm-twig" d="M-2-62L-4-67M2-62L4-66"/>',
    };
    return `<g class="sr-sm-${hat}">
      <ellipse class="sr-sm-shadow" cx="3" cy="0" rx="17" ry="3.2"/>
      <path class="sr-sm-arm" d="${armP}"/>
      <circle class="sr-sm-ball" cx="0" cy="-15" r="15"/><path class="sr-sm-shade" d="M8-27A15 15 0 0 1 3.5-.4A15 13 0 0 0 8-27Z"/>
      <circle class="sr-sm-ball" cx="0" cy="-38" r="11"/><path class="sr-sm-shade" d="M6-47A11 11 0 0 1 3-27.4A11 9 0 0 0 6-47Z"/>
      <circle class="sr-sm-ball" cx="0" cy="-54" r="8"/>
      <circle class="sr-sm-coal" cx="0" cy="-41" r="1.3"/><circle class="sr-sm-coal" cx="0" cy="-35" r="1.3"/><circle class="sr-sm-coal" cx="0" cy="-29" r="1.3"/>
      <path class="sr-sm-scarf" d="M-7.6-47.4Q0-44 7.6-47.4L7.8-44.2Q0-40.6-7.8-44.2Z"/><path class="sr-sm-scarf" d="M3-45L5.6-35.4L9-36.4L7-45Z"/>
      <circle class="sr-sm-coal" cx="-2.8" cy="-56" r="1.1"/><circle class="sr-sm-coal" cx="2.8" cy="-56" r="1.1"/>
      <path class="sr-sm-carrot" d="M0-53.6L9-52.2L0-51Z"/>
      <path class="sr-sm-mouth" d="M-3-50Q0-48 3-50"/>
      ${hats[hat] || ''}
    </g>`;
  }
  const defsMarkup = (v) => `
    <defs>
      <symbol id="sr-pn" overflow="visible"><rect class="sr-trunk" x="-3.4" y="-8" width="6.8" height="10" rx="1"/>${pinePath(PINE_NEAR, 'sr-pine', 'sr-pine-d', true)}</symbol>
      <symbol id="sr-pt" overflow="visible"><rect class="sr-trunk" x="-3.4" y="-8" width="6.8" height="10" rx="1"/>${pinePath(PINE_TALL, 'sr-pine', 'sr-pine-d', true)}</symbol>
      <symbol id="sr-pm" overflow="visible"><rect class="sr-trunk-m" x="-3" y="-6" width="6" height="8"/>${pinePath(PINE_NEAR, 'sr-pine-m', 'sr-pine-md', true)}</symbol>
      <symbol id="sr-pb" overflow="visible">${pinePath(PINE_TALL, 'sr-pine-b', 'sr-pine-bd', true)}</symbol>
      <symbol id="sr-pf" overflow="visible">${pinePath(PINE_FAR, 'sr-pine-f', 'sr-pine-fd', false)}<path class="sr-psnow-f" d="M0-61L-4-52Q0-54 4-52Z"/></symbol>
      <symbol id="sr-sm0" overflow="visible">${snowman(v, 'top', 'up')}</symbol>
      <symbol id="sr-sm1" overflow="visible">${snowman(v, 'beanie', 'wave')}</symbol>
      <symbol id="sr-sm2" overflow="visible">${snowman(v, 'none', 'out')}</symbol>
      <symbol id="sr-sm3" overflow="visible">${snowman(v, 'beanie', 'up')}</symbol>
      <linearGradient id="sr-sky-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="sr-sky-1"/><stop offset="0.55" class="sr-sky-2"/><stop offset="1" class="sr-sky-3"/>
      </linearGradient>
      <radialGradient id="sr-sun-grad"><stop offset="0" class="sr-sun-1"/><stop offset="1" class="sr-sun-2"/></radialGradient>
      <linearGradient id="sr-win-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sr-win-1"/><stop offset="1" class="sr-win-2"/></linearGradient>
      <radialGradient id="sr-spill-grad"><stop offset="0" class="sr-spill-1"/><stop offset="1" class="sr-spill-2"/></radialGradient>
    </defs>`;

  // the sky, the sun and the mountains: still, in view units
  function skyMarkup(g) {
    const W = g.W, r = seeded(5);
    const peaks = (y0, n, hMin, hMax, seed) => {
      const rr = seeded(seed);
      let d = `M-20 ${H}V${y0}`, snow = '';
      const step = (W + 40) / n;
      for (let i = 0; i < n; i++) {
        const x0 = -20 + i * step, xp = x0 + step * (0.35 + rr() * 0.3), hp = y0 - (hMin + rr() * (hMax - hMin)), x1 = x0 + step;
        d += `L${f1(xp)} ${f1(hp)}L${f1(x1)} ${f1(y0 - rr() * 18)}`;
        const k = 0.3;
        snow += `<path d="M${f1(xp)} ${f1(hp)}L${f1(lerp(xp, x0, k))} ${f1(lerp(hp, y0, k))}L${f1(lerp(xp, x0, k * 0.6) + 4)} ${f1(lerp(hp, y0, k * 0.8))}L${f1(xp + 2)} ${f1(lerp(hp, y0, k * 0.55))}L${f1(lerp(xp, x1, k * 0.7))} ${f1(lerp(hp, y0, k * 0.85))}L${f1(lerp(xp, x1, k))} ${f1(lerp(hp, y0, k))}Z"/>`;
      }
      return { d: d + `L${W + 20} ${H}Z`, snow };
    };
    const far = peaks(232, Math.max(5, Math.round(W / 190)), 70, 130, 3);
    const near = peaks(268, Math.max(4, Math.round(W / 260)), 55, 110, 9);
    let clouds = '';
    for (let i = 0; i < 5; i++) {
      const cx = (0.08 + i * 0.21 + r() * 0.06) * W, cy = 34 + r() * 50, s = 0.7 + r() * 0.6;
      clouds += `<g class="sr-cloud" transform="translate(${f1(cx)} ${f1(cy)}) scale(${f1(s)})"><ellipse rx="34" ry="8"/><ellipse cx="-12" cy="-6" rx="16" ry="9"/><ellipse cx="10" cy="-8" rx="19" ry="11"/></g>`;
    }
    return `
      <rect x="-20" y="-20" width="${W + 40}" height="${H + 40}" fill="url(#sr-sky-grad)"/>
      <circle class="sr-sun-glow" cx="${f1(0.2 * W)}" cy="150" r="120" fill="url(#sr-sun-grad)"/>
      <circle class="sr-sun" cx="${f1(0.2 * W)}" cy="150" r="20"/>
      ${clouds}
      <path class="sr-mtn-far" d="${far.d}"/><g class="sr-mtn-far-snow">${far.snow}</g>
      <path class="sr-mtn" d="${near.d}"/><g class="sr-mtn-snow">${near.snow}</g>`;
  }

  // the far ridge with its forest: moves at 0.3 of the camera
  const FAR_K = 0.3, FAR_KY = 0.12, FG_K = 1.4;
  function farMarkup(g) {
    const x1 = g.W + FAR_K * (g.XMAX + 200), r = seeded(21);
    let d = `M-100 ${H + 400}V300`;
    for (let x = -100; x <= x1; x += 40) d += `L${x} ${f1(290 - 26 * Math.sin(x / 260) - 14 * Math.sin(x / 97 + 1))}`;
    d += `L${f1(x1)} ${H + 400}Z`;
    let trees = '';
    for (let x = -90; x < x1; x += 14 + r() * 16) {
      const top = 290 - 26 * Math.sin(x / 260) - 14 * Math.sin(x / 97 + 1);
      trees += `<use href="#sr-pf" transform="translate(${f1(x)} ${f1(top + 8 + r() * 26)}) scale(${f1(0.5 + r() * 0.4)})"/>`;
    }
    return { w: x1 + 100, html: `<path class="sr-ridge" d="${d}"/><g class="sr-ridge-trees">${trees}</g>` };
  }

  // the hill itself: the slope behind the track with its forest, the track,
  // the slope below; the start and the finish
  function hillMarkup(g) {
    const r = seeded(7);
    const P = (x, y) => `${f1(x)} ${f1(y)}`;
    let back = '', top = '', track = '', edgeB = '', edgeF = '', below = '';
    const xs = [];
    for (let x = g.XMIN; x <= g.XMAX; x += 12) xs.push(x);
    xs.push(g.XMAX);
    // the slope behind the track runs up to a soft ridge
    // narrow at the top (the mountains show over the start), a deep forested
    // valley side further down
    const band = (x) => lerp(48, 132, smooth((x - g.G + 120) / 700));
    const ridge = (x) => baseAt(g, x) - band(x) - 10 * Math.sin(x / 210) - 6 * Math.sin(x / 71 + 2);
    xs.forEach((x, i) => { top += `${i ? 'L' : 'M'}${P(x, ridge(x))}`; });
    back = `${top}L${P(g.XMAX, surfAt(g, g.XMAX))}`;
    for (let i = xs.length - 1; i >= 0; i--) back += `L${P(xs[i], surfAt(g, xs[i]))}`;
    back += 'Z';
    xs.forEach((x, i) => { track += `${i ? 'L' : 'M'}${P(x, surfAt(g, x))}`; edgeB += `${i ? 'L' : 'M'}${P(x, surfAt(g, x) + 1)}`; });
    const EP = (x, d) => { const e = edge(g, x, d); return P(e.x, e.y); };
    for (let i = xs.length - 1; i >= 0; i--) track += `L${EP(xs[i], 1)}`;
    track += 'Z';
    xs.forEach((x, i) => { edgeF += `${i ? 'L' : 'M'}${EP(x, 1)}`; });
    below = `${edgeF}L${P(g.XMAX - SKEW, g.YMAX)}L${P(g.XMIN - SKEW, g.YMAX)}Z`;
    // grooves worn by the sleds, along the track
    let grooves = '';
    [0.2, 0.42, 0.64, 0.84].forEach((d) => {
      let p = '';
      for (let x = g.XMIN; x <= g.XMAX; x += 16) p += `${p ? 'L' : 'M'}${EP(x, d)}`;
      grooves += `<path d="${p}"/>`;
    });
    // bumps: a lit band across the crest, a shaded one in the dip
    let bumps = '';
    for (const c of g.crests) {
      const band = (x0, x1, cls) => `<path class="${cls}" d="M${P(x0, surfAt(g, x0))}L${P(x1, surfAt(g, x1))}L${EP(x1, 1)}L${EP(x0, 1)}Z"/>`;
      bumps += c.big ? band(c.x + 70, c.x + 200, 'sr-dip') : band(c.x + 34, c.x + 90, 'sr-dip');
    }
    // the hillside forest, densest at the back: far rows small and blue
    let forest = '';
    const keepClear = (x) => (x > g.G - 210 && x < g.G + 40) || (x > g.L - 150 && x < g.L + 150);
    for (let x = g.XMIN; x < g.XMAX; x += 24 + r() * 18) forest += `<use href="#sr-pb" transform="translate(${P(x, ridge(x) + band(x) * (0.2 + r() * 0.16))}) scale(${f1((0.36 + r() * 0.16) * (0.75 + band(x) / 520))})"/>`;
    for (let x = g.XMIN + 10; x < g.XMAX; x += 28 + r() * 26) forest += `<use href="#sr-pm" transform="translate(${P(x, ridge(x) + band(x) * (0.55 + r() * 0.15))}) scale(${f1((0.5 + r() * 0.18) * (0.8 + band(x) / 600))})"/>`;
    let nearRow = '';
    for (let x = g.XMIN + 20; x < g.XMAX; x += 70 + r() * 90) {
      if (keepClear(x)) continue;
      const s = 0.78 + r() * 0.3;
      nearRow += `<use href="#${r() < 0.4 ? 'sr-pt' : 'sr-pn'}" transform="translate(${P(x, surfAt(g, x) - 9 - r() * 12)}) scale(${f1(s)})"/>`;
    }
    // spectators along the back edge, a crowd at the finish
    let crowd = '';
    const sm = (x, y, s) => `<use href="#sr-sm${Math.floor(r() * 4)}" transform="translate(${P(x, y)}) scale(${f1(s)})"/>`;
    for (let x = g.G + 260; x < g.L - 200; x += 200 + r() * 260) crowd += sm(x, surfAt(g, x) - 3, 0.62 + r() * 0.1);
    for (let k = 0; k < 6; k++) { const x = g.L - 230 + k * 64 + r() * 20; if (Math.abs(x - g.L) < 20) continue; crowd += sm(x, surfAt(g, x) - 4, 0.6 + r() * 0.08); }
    crowd += sm(g.G - 250, surfAt(g, g.G - 250) - 3, 0.6) + sm(60, PLAT - 3, 0.58);
    // the start: a banner on two poles behind the line, a pennant string,
    // and the gate's bar across the track (it swings up at the whistle)
    const start = (() => {
      const y = surfAt(g, g.G), x0 = g.G - 190, x1 = g.G - 20;
      const b = `<g class="sr-banner start"><path class="sr-pole" d="M${P(x0, y - 2)}V${f1(y - 86)}M${P(x1, y - 2)}V${f1(y - 86)}"/>
        <rect class="sr-cloth" x="${f1(x0 - 4)}" y="${f1(y - 84)}" width="${f1(x1 - x0 + 8)}" height="30" rx="3"/>
        <rect class="sr-cloth-hi" x="${f1(x0 - 4)}" y="${f1(y - 84)}" width="${f1(x1 - x0 + 8)}" height="5" rx="2"/>
        <text x="${f1((x0 + x1) / 2)}" y="${f1(y - 61.5)}">START</text></g>`;
      let pen = '', d = `M${P(g.G + 4, y - 50)}`;
      for (let i = 1; i <= 8; i++) {
        const u = i / 8, px = lerp(g.G + 4, g.G + 4 - SKEW, u), py = lerp(y - 50, y + DEPTH - 50, u) + 8 * Math.sin(Math.PI * u);
        d += `L${P(px, py)}`;
        if (i < 8) pen += `<path class="sr-pen p${i % 4}" d="M${P(px - 3, py)}L${P(px + 3, py)}L${P(px, py + 8)}Z"/>`;
      }
      const posts = `<path class="sr-gate-post" d="M${P(g.G + 4, y + 4)}V${f1(y - 52)}M${P(g.G + 4 - SKEW, y + DEPTH + 4)}V${f1(y + DEPTH - 52)}"/>`;
      return `${b}${posts}<path class="sr-pen-line" d="${d}"/>${pen}`;
    })();
    // the finish: a checkered line across the track, flags on both edges, a
    // banner behind it
    const finish = (() => {
      const y = surfAt(g, g.L);
      let checks = '';
      const rows = 9;
      for (let i = 0; i < rows; i++) {
        for (let c = 0; c < 2; c++) {
          const u0 = i / rows, u1 = (i + 1) / rows, xa = g.L + c * 6, xb = xa + 6;
          checks += `<path class="${(i + c) % 2 ? 'sr-ck-a' : 'sr-ck-b'}" d="M${P(xa - SKEW * u0, y + DEPTH * u0)}L${P(xb - SKEW * u0, y + DEPTH * u0)}L${P(xb - SKEW * u1, y + DEPTH * u1)}L${P(xa - SKEW * u1, y + DEPTH * u1)}Z"/>`;
        }
      }
      const flag = (x, fy, hgt) => {
        let f = '';
        for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) f += `<rect class="${(i + j) % 2 ? 'sr-ck-a' : 'sr-ck-b'}" x="${f1(x + 1 + j * 5)}" y="${f1(fy - hgt + i * 5)}" width="5" height="5"/>`;
        return `<path class="sr-pole" d="M${P(x, fy)}V${f1(fy - hgt - 2)}"/>${f}<circle class="sr-pole-top" cx="${f1(x)}" cy="${f1(fy - hgt - 3)}" r="2.2"/>`;
      };
      const bx0 = g.L - 120, bx1 = g.L + 120;
      let ban = `<g class="sr-banner finish"><path class="sr-pole" d="M${P(bx0, y + 1)}V${f1(y - 104)}M${P(bx1, y + 1)}V${f1(y - 104)}"/>
        <rect class="sr-cloth" x="${f1(bx0 - 5)}" y="${f1(y - 102)}" width="${f1(bx1 - bx0 + 10)}" height="38" rx="3"/>`;
      for (let i = 0; i < 24; i++) ban += `<rect class="${i % 2 ? 'sr-ck-a' : 'sr-ck-b'}" x="${f1(bx0 - 5 + i * (bx1 - bx0 + 10) / 24)}" y="${f1(y - 102)}" width="${f1((bx1 - bx0 + 10) / 24 + 0.2)}" height="5"/><rect class="${i % 2 ? 'sr-ck-b' : 'sr-ck-a'}" x="${f1(bx0 - 5 + i * (bx1 - bx0 + 10) / 24)}" y="${f1(y - 69)}" width="${f1((bx1 - bx0 + 10) / 24 + 0.2)}" height="5"/>`;
      ban += `<text x="${f1(g.L)}" y="${f1(y - 75)}">FINISH</text></g>`;
      return { back: `${ban}${flag(g.L + 2, y - 2, 46)}`, line: checks, front: flag(g.L + 2 - SKEW, y + DEPTH + 2, 46) };
    })();
    // sparkles on the snow
    let sparkle = '';
    for (let x = g.XMIN; x < g.XMAX; x += 30 + r() * 50) {
      const d = r();
      const p = edge(g, x, d);
      sparkle += `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(0.7 + r() * 0.8)}"/>`;
    }
    return `
      <path class="sr-back" d="${back}"/>
      <path class="sr-ridge-line" d="${top}"/>
      <g class="sr-forest">${forest}</g>
      <path class="sr-below" d="${below}"/>
      <path class="sr-track" d="${track}"/>
      <g class="sr-bumps">${bumps}</g>
      <g class="sr-grooves">${grooves}</g>
      <g class="sr-sparkle">${sparkle}</g>
      ${finish.line}
      <path class="sr-edge-b" d="${edgeB}"/>
      <path class="sr-edge-f" d="${edgeF}"/>
      ${start}
      ${finish.back}
      <g class="sr-near-row">${nearRow}</g>
      <g class="sr-crowd">${crowd}</g>
      ${g.long ? longHill(g, r) : ''}
      <g class="sr-gate"><path class="sr-bar-a"/><path class="sr-bar-b"/></g>
      <g class="sr-finish-front">${finish.front}</g>`;
  }

  // the long course's stages, behind the sledders: the banked walls and
  // chevron boards round the bends, the jump's flags, the tunnel's back wall
  // of pines, the FINAL STRETCH banner
  function longHill(g, r) {
    const P = (x, y) => `${f1(x)} ${f1(y)}`;
    const C = COURSE, at = (u) => g.G + u * g.span;
    let berm = '', chev = '', s = '';
    for (const b of C.bends) {
      const x0 = at(b.u0), x1 = at(b.u1);
      // a raised wall of snow along the back edge, highest mid-bend
      let top = '', bot = '';
      for (let x = x0; x <= x1; x += 10) {
        const k = Math.abs(bendAt(g, x));
        top += `${top ? 'L' : 'M'}${P(x, surfAt(g, x) - 3 - 13 * k)}`;
        bot = `L${P(x, surfAt(g, x) + 3)}` + bot;
      }
      berm += `<path class="sr-berm" d="${top}${bot}Z"/><path class="sr-berm-hi" d="${top}"/>`;
      // red and white chevron boards on posts, pointing the way round
      for (let x = x0 + 70; x < x1 - 40; x += 110) {
        const y = surfAt(g, x) - 14 - 13 * Math.abs(bendAt(g, x));
        const a = b.dir < 0 ? 'M-6-4L0 0L-6 4M0-4L6 0L0 4' : 'M6-4L0 0L6 4M0-4L-6 0L0 4';
        chev += `<g transform="translate(${P(x, y)})"><path class="sr-chev-post" d="M0 12V0"/><rect class="sr-chev" x="-13" y="-14" width="26" height="14" rx="1.5"/><path class="sr-chev-a" transform="translate(0 -7)" d="${a}"/></g>`;
      }
    }
    // the jump: a flag either side of the lip, a JUMP board
    const jx = at(C.jump), jy = surfAt(g, jx);
    s += `<path class="sr-pole" d="M${P(jx - 4, jy)}V${f1(jy - 58)}"/><path class="sr-jump-flag" d="M${P(jx - 4, jy - 58)}l22 6l-22 6Z"/>`;
    s += `<g transform="translate(${P(jx - 120, surfAt(g, jx - 120) - 6)})"><path class="sr-pole" d="M-18 6V-34M18 6V-34"/><rect class="sr-board" x="-26" y="-50" width="52" height="20" rx="3"/><text class="sr-board-t" x="0" y="-36">JUMP</text></g>`;
    // the tunnel's back wall: tall pines close together along the back edge
    let tun = '';
    for (let x = at(C.tunnel.u0) - 40; x < at(C.tunnel.u1) + 40; x += 30 + r() * 12) tun += `<use href="#sr-pt" transform="translate(${P(x, surfAt(g, x) - 3)}) scale(${f1(1.45 + r() * 0.35)})"/>`;
    // the final straight's banner
    const fx = at(C.final), fy = surfAt(g, fx), x0 = fx - 140, x1 = fx + 10;
    s += `<g class="sr-banner final"><path class="sr-pole" d="M${P(x0, fy - 2)}V${f1(fy - 86)}M${P(x1, surfAt(g, x1) - 2)}V${f1(fy - 86)}"/>
      <rect class="sr-cloth" x="${f1(x0 - 4)}" y="${f1(fy - 84)}" width="${f1(x1 - x0 + 8)}" height="26" rx="3"/>
      <text x="${f1((x0 + x1) / 2)}" y="${f1(fy - 65)}">FINAL STRETCH</text></g>`;
    return `<g class="sr-tunnel-back">${tun}</g>${berm}${chev}${s}`;
  }

  // in front of the track (drawn over the sledders): a rope fence, pines and
  // snowmen down the slope below
  function frontMarkup(g) {
    const r = seeded(13);
    const P = (x, y) => `${f1(x)} ${f1(y)}`;
    let fence = '', posts = '', items = '';
    // the fence along the front edge, in stretches
    for (let x = g.G + 120; x < g.L - 140; x += 420 + r() * 260) {
      const len = 160 + r() * 140;
      let d = '';
      for (let k = 0; k <= len; k += 10) {
        const e = edge(g, x + k, 1), px = e.x, py = e.y + 9;
        d += `${k ? 'L' : 'M'}${P(px, py - 6 + 1.5 * Math.sin(k / 40 * Math.PI))}`;
        if (k % 40 === 0) posts += `<path d="M${P(px, py + 2)}V${f1(py - 9)}"/>`;
      }
      fence += `<path d="${d}"/>`;
    }
    // pines and snowmen below the track, kept clear of the start and the finish
    for (let x = g.G + 300; x < g.L - 300; x += 260 + r() * 300) {
      const e = edge(g, x, 1), y = e.y + 52 + r() * 24;
      items += r() < 0.75
        ? `<use href="#${r() < 0.5 ? 'sr-pt' : 'sr-pn'}" transform="translate(${P(e.x, y)}) scale(${f1(1.05 + r() * 0.35)})"/>`
        : `<use href="#sr-sm${Math.floor(r() * 4)}" transform="translate(${P(e.x, y - 20)}) scale(0.9)"/>`;
    }
    if (g.long) items += tunnelFront(g, r);
    // at the top, low down so they never cover the start
    items += `<use href="#sr-sm1" transform="translate(${P(0.06 * g.W, PLAT + DEPTH + 70)}) scale(0.82)"/>`;
    items += `<use href="#sr-pn" transform="translate(${P(-30, PLAT + DEPTH + 96)}) scale(1.2)"/>`;
    // at the bottom, beside the finish
    items += `<use href="#sr-sm0" transform="translate(${P(g.L - 160 - SKEW, surfAt(g, g.L - 160) + DEPTH + 64)}) scale(0.9)"/>`;
    items += `<use href="#sr-sm3" transform="translate(${P(g.L + 90 - SKEW, surfAt(g, g.L + 90) + DEPTH + 70)}) scale(0.86)"/>`;
    return `<g class="sr-fence">${fence}</g><g class="sr-fence-posts">${posts}</g>${items}`;
  }

  // the tunnel, in front of the sledders: big snow-laden pines below the
  // track, close together, and the track in their shade (the name plates
  // stay on top, crisp)
  function tunnelFront(g, r) {
    const P = (x, y) => `${f1(x)} ${f1(y)}`;
    const x0 = g.G + COURSE.tunnel.u0 * g.span, x1 = g.G + COURSE.tunnel.u1 * g.span;
    let top = '', bot = '';
    for (let x = x0 - 80; x <= x1 + 80; x += 12) { const e = edge(g, x, 1); bot = `L${P(e.x, e.y + 4)}` + bot; top += `${top ? 'L' : 'M'}${P(x, surfAt(g, x) - 2)}`; }
    let front = '';
    for (let x = x0 - 30; x < x1 + 30; x += 70 + r() * 30) {
      const e = edge(g, x, 1);
      front += `<use href="#sr-pt" transform="translate(${P(e.x + 10, e.y + 64 + r() * 14)}) scale(${f1(1.5 + r() * 0.35)})"/>`;
    }
    return `<defs><linearGradient id="sr-tun-grad" gradientUnits="userSpaceOnUse" x1="${f1(x0 - 80)}" x2="${f1(x1 + 80)}" y1="0" y2="0">
        <stop offset="0" class="sr-tun-0"/><stop offset="0.14" class="sr-tun-1"/><stop offset="0.86" class="sr-tun-1"/><stop offset="1" class="sr-tun-0"/></linearGradient></defs>
      <path class="sr-tunnel-shade" fill="url(#sr-tun-grad)" d="${top}${bot}Z"/>
      <g class="sr-tunnel-front">${front}</g>`;
  }

  // the foreground: drifts and snowy boughs right at the bottom of the view,
  // moving faster than the hill
  function fgMarkup(g) {
    const x1 = g.W + FG_K * (g.XMAX + 200), r = seeded(31);
    let s = '';
    for (let x = 260; x < x1; x += 320 + r() * 420) {
      const w = 90 + r() * 120;
      s += `<path class="sr-drift" d="M${f1(x - w)} 412Q${f1(x - w * 0.5)} ${f1(384 - r() * 14)} ${f1(x)} ${f1(380 - r() * 10)}Q${f1(x + w * 0.6)} ${f1(386 - r() * 10)} ${f1(x + w)} 412Z"/>`;
      if (r() < 0.4) s += `<use href="#sr-pt" transform="translate(${f1(x + w * 0.4)} ${f1(468 + r() * 16)}) scale(${f1(1.3 + r() * 0.3)})"/>`;
      if (r() < 0.3) s += `<path class="sr-fg-post" d="M${f1(x - w * 0.3)} 406V${f1(350 - r() * 10)}"/><path class="sr-fg-flag" d="M${f1(x - w * 0.3)} 352l16 5l-16 5Z"/>`;
    }
    // a bough in the corner of the first view
    s += `<use href="#sr-pt" transform="translate(-24 460) scale(1.9)"/>`;
    return { w: x1 + 100, html: s };
  }

  // the lodge: fixed at the right of the view (view units), on a snowy knoll
  const LOD = {
    w1: { x: 28, y: -98, w: 78, h: 76 },
    w2: { x: 164, y: -98, w: 78, h: 76 },
    loft: { x: 103, y: -174, w: 64, h: 46 },
    door: { x: 116, y: -78, w: 38, h: 74 },
  };
  function lodgeMarkup(g) {
    const win = (w) => `<rect class="sr-win-glow" x="${w.x - 5}" y="${w.y - 5}" width="${w.w + 10}" height="${w.h + 10}" rx="5"/><rect class="sr-win" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="2" fill="url(#sr-win-grad)"/>`;
    const frame = (w) => `<rect class="sr-win-frame" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="2"/><path class="sr-sill" d="M${w.x - 4} ${w.y + w.h + 2}h${w.w + 8}"/><path class="sr-sill-snow" d="M${w.x - 4} ${w.y + w.h + 1}q${w.w / 4} -5 ${w.w / 2} -1q${w.w / 4} -4 ${w.w / 2 + 8} 1z"/>`;
    let logs = "";
    for (let y = -14; y > -112; y -= 11) logs += `M8 ${y}H262`;
    let planks = "";
    for (let x = 22; x < 262; x += 14) { const yt = -108 - 106 * (1 - Math.abs(x - 135) / 127); planks += `M${x} -108V${f1(Math.min(-108, yt + 2))}`; }
    let lights = "";
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      lights += `<circle class="sr-bulb b${i % 4}" cx="${f1(lerp(-12, 135, u))}" cy="${f1(lerp(-96, -232, u))}" r="2.8"/><circle class="sr-bulb b${(i + 2) % 4}" cx="${f1(lerp(282, 135, u))}" cy="${f1(lerp(-96, -232, u))}" r="2.8"/>`;
    }
    return `
      <g class="sr-lodge" transform="translate(${f1(g.lodge.x)} ${H}) scale(${g.lodge.s.toFixed(3)})">
        <ellipse class="sr-spill" cx="135" cy="-24" rx="200" ry="40" fill="url(#sr-spill-grad)"/>
        <path class="sr-knoll" d="M-150 30Q-96 -26 -10 -30Q80 -38 170 -36Q260 -34 340 -44V80H-150Z"/>
        <path class="sr-knoll-shade" d="M-150 30Q-96 -8 -10 -12Q80 -16 170 -14Q260 -12 340 -22V80H-150Z"/>
        <g transform="translate(0 -32)">
          <rect class="sr-chimney" x="200" y="-204" width="22" height="90"/>
          <path class="sr-chimney-snow" d="M197-204h28q-4-7-14-6q-10-1-14 6z"/>
          <g class="sr-smoke"><circle cx="211" cy="-218" r="9"/><circle cx="218" cy="-236" r="12"/><circle cx="212" cy="-258" r="15"/></g>
          <rect class="sr-found" x="2" y="-8" width="266" height="10" rx="2"/>
          <rect class="sr-wall" x="6" y="-112" width="258" height="106"/>
          <path class="sr-logs" d="${logs}"/>
          <path class="sr-gable" d="M8-108L135-214L262-108Z"/>
          <path class="sr-planks" d="${planks}"/>
          ${win(LOD.w1)}${win(LOD.w2)}${win(LOD.loft)}
          <g class="sr-guests"></g>
          ${frame(LOD.w1)}${frame(LOD.w2)}${frame(LOD.loft)}
          <rect class="sr-door" x="${LOD.door.x}" y="${LOD.door.y}" width="${LOD.door.w}" height="${LOD.door.h}" rx="3"/>
          <rect class="sr-door-pane" x="${LOD.door.x + 9}" y="${LOD.door.y + 9}" width="${LOD.door.w - 18}" height="18" rx="2" fill="url(#sr-win-grad)"/>
          <circle class="sr-wreath" cx="${LOD.door.x + LOD.door.w / 2}" cy="${LOD.door.y + 44}" r="8"/><circle class="sr-wreath-in" cx="${LOD.door.x + LOD.door.w / 2}" cy="${LOD.door.y + 44}" r="4"/><path class="sr-bow" d="M${LOD.door.x + LOD.door.w / 2 - 4} ${LOD.door.y + 51}l4-3l4 3l-4 1z"/>
          <circle class="sr-knob" cx="${LOD.door.x + LOD.door.w - 7}" cy="${LOD.door.y + 46}" r="1.8"/>
          <rect class="sr-name-board" x="100" y="-106" width="70" height="13" rx="2"/><text class="sr-name-board-t" x="135" y="-96.6">LODGE</text>
          <path class="sr-roof" d="M-16-100L135-236L286-100L262-100L135-214L8-100Z"/>
          <path class="sr-roof-snow" d="M-24-96L135-244L294-96Q286-88 276-98Q266-88 258-102L135-220L12-102Q4-88-6-98Q-16-88-24-96Z"/>
          ${lights}
          <circle class="sr-lantern-glow" cx="${LOD.door.x - 8}" cy="${LOD.door.y + 14}" r="12"/><rect class="sr-lantern" x="${LOD.door.x - 11}" y="${LOD.door.y + 8}" width="6" height="10" rx="1.5"/>
          <g class="sr-skis"><path d="M250-4L262-74M258-4L270-74"/></g>
          <path class="sr-wall-snow" d="M0-4Q40-12 80-6Q120-12 160-6Q210-12 270-4V4H0Z"/>
        </g>
        <g class="sr-count" transform="translate(-62 -46)">
          <path class="sr-count-post" d="M0 4V44"/>
          <rect class="sr-count-board" x="-42" y="-28" width="84" height="34" rx="4"/>
          <text class="sr-count-t" x="0" y="-3.6"></text>
        </g>
      </g>`;
  }

  // ---------- a sledder: facing downhill (right), the sled's bottom at 0 ----------
  const LOOKS = {
    sled: ['tob', 'run', 'sau', 'tube'],
    coat: 8, pants: 4, hat: ['beanie', 'bobble', 'trapper', 'helmet'], hatc: 6, scarf: 6, skin: 5, mitt: 4, sledc: 5, wood: 3,
  };
  const SEAT = { tob: [-7, -9], run: [-9, -13], sau: [0, -8], tube: [0, -13] };
  function lookOf(id) {
    const h = hash(id), h2 = hash(id + '#'), h3 = hash('~' + id);
    return {
      sled: LOOKS.sled[h % 4],
      coat: (h >>> 3) % LOOKS.coat,
      coat2: (h2 >>> 5) % LOOKS.coat,
      stripe: (h2 & 3) === 0,
      pants: (h >>> 7) % LOOKS.pants,
      hat: LOOKS.hat[(h >>> 10) % 4],
      hatc: (h >>> 13) % LOOKS.hatc,
      pom: (h3 >>> 2) % LOOKS.hatc,
      scarf: (h >>> 16) % LOOKS.scarf,
      skin: (h >>> 19) % LOOKS.skin,
      mitt: (h3 >>> 6) % LOOKS.mitt,
      sledc: (h >>> 22) % LOOKS.sledc,
      wood: (h3 >>> 9) % LOOKS.wood,
      style: (h >>> 25) & 1 ? 'lean' : 'grip',
      goggles: ((h3 >>> 12) % 5) === 0,
      ph: ((h >>> 27) % 1000) / 1000,
    };
  }
  function sledMarkup(lk) {
    switch (lk.sled) {
      case 'tob': return `
        <path class="sr-wood o" d="M-28-1H17Q29-1 29-11Q29-19.5 21.4-19Q25.4-14.4 22-10.8Q19.6-8.4 15-8.4H-28Q-30-8.4-30-4.7Q-30-1-28-1Z"/>
        <path class="sr-wood-d" d="M-28-1H17Q26-1 28.6-7.4Q25-3.8 17-3.8H-28Z"/>
        <path class="sr-slat" d="M-20-8.4V-1M-9-8.4V-1M2-8.4V-1M12-8.4V-1"/>
        <path class="sr-rope" d="M-26-10Q-6-13.6 18-10.4"/><path class="sr-rope-post" d="M-24-8.4V-10.6M-6-8.4V-12.4M12-8.4V-11"/>`;
      case 'run': return `
        <path class="sr-strut" d="M-20-8.6V-1.4M-5-8.6V-1.4M10-8.6V-1.4"/>
        <path class="sr-rail-o" d="M-27-1.2H17Q27-1.2 27-8.2Q27-13.4 21.6-12.8"/>
        <path class="sr-rail" d="M-27-1.2H17Q27-1.2 27-8.2Q27-13.4 21.6-12.8"/>
        <rect class="sr-wood o" x="-28" y="-13.6" width="44" height="5.4" rx="1.6"/>
        <path class="sr-slat" d="M-28-11H16"/>
        <path class="sr-steer" d="M13-13.6L20-16.4"/>`;
      case 'sau': return `
        <ellipse class="sr-sled-b o" cx="0" cy="-4.8" rx="23" ry="5.6"/>
        <path class="sr-sled-d" d="M-23-4.8Q0 3.2 23-4.8Q12-.2 0-.2Q-12-.2-23-4.8Z"/>
        <path class="sr-sled-hi" d="M-17-7.6Q0-10.6 17-7.6"/>
        <path class="sr-handle" d="M-20-6.4Q-23-11-18.4-11.4M20-6.4Q23-11 18.4-11.4"/>`;
      default: return `
        <ellipse class="sr-sled-b o" cx="0" cy="-8.6" rx="24.5" ry="8.8"/>
        <ellipse class="sr-tube-hole" cx="1" cy="-12.6" rx="12.5" ry="3.2"/>
        <path class="sr-sled-d" d="M-24.5-8.6Q-23.4 0 0 0Q23.4 0 24.5-8.6Q20-3.2 0-3.2Q-20-3.2-24.5-8.6Z"/>
        <path class="sr-sled-hi" d="M-18.5-13.4Q-6-18 10-16.8"/>`;
    }
  }
  const TUBE_FRONT = '<path class="sr-sled-b sr-tube-front" d="M-24.5-8.6Q-24-2.2-10-.6Q2 .4 14-.8Q24-2.6 24.5-8.6Q23-11 13.4-11.2Q2-9.4-11.4-11.2Q-23-11-24.5-8.6Z"/>';
  // the hats (round the head at (2.5, −27.5), r 7)
  function hatMarkup(lk) {
    switch (lk.hat) {
      case 'beanie': return `
        <path class="sr-hat o" d="M-4.8-28.6C-4.8-37.6 9.8-37.6 9.8-28.6Z"/>
        <rect class="sr-hat-c o" x="-5.4" y="-30.6" width="15.8" height="3.6" rx="1.7"/>
        <circle class="sr-pom o" cx="2.5" cy="-37" r="2.7"/>`;
      case 'bobble': return `
        <g class="sr-hat-tail"><path class="sr-hat o" d="M0-34Q-8-35.4-13.6-31.6L-12.4-29Q-7-32 0-30.6Z"/><circle class="sr-pom o" cx="-14.4" cy="-30" r="2.6"/></g>
        <path class="sr-hat o" d="M-4.8-28.6C-4.8-37.6 9.8-37.6 9.8-28.6Z"/>
        <path class="sr-hat-c" d="M-4.8-30.4H9.8" />`;
      case 'trapper': return `
        <path class="sr-hat o" d="M-5-28.4C-5-37.8 10-37.8 10-28.4Z"/>
        <path class="sr-fur o" d="M-5.8-28.2Q2.5-31.6 10.8-28.2L10.6-31Q2.5-34.4-5.6-31Z"/>
        <path class="sr-fur o" d="M-4.4-29Q-5.8-22.4-2.6-21.2L.2-21.6Q-1.2-25 .4-28.4Z"/>`;
      default: return `
        <path class="sr-helmet o" d="M-5.2-26.6C-5.8-38.6 11-38.8 10.6-27.2L9.2-26.4Q2.5-29.4-5.2-26.6Z"/>
        <path class="sr-helmet-s" d="M2-36.8Q6-36.6 9.6-31"/>
        <path class="sr-helmet-hi" d="M-1.6-34.4Q1-36.4 4-36.6"/>
        <rect class="sr-goggle-strap" x="-5" y="-31.4" width="14" height="2.2"/>
        <rect class="sr-goggle o" x="4" y="-32.6" width="7" height="4.4" rx="2"/>`;
    }
  }
  // arms: one set per pose, shown by data-arms on the sledder (CSS)
  const ARMS = {
    rest:  ['M2.6-17.6Q8.4-11.2 12.6-6.4', [13, -5.8], 'M-.4-18Q4.6-11.8 9-7', [9.4, -6.4]],
    scarf: ['M2.6-17.6Q11-16 8-21.2', [7.6, -21.6], 'M-.4-18Q4.6-11.8 9-7', [9.4, -6.4]],
    grip:  ['M2.6-17.6Q5.4-9.4 4.8-2.6', [4.9, -2], 'M-.4-18Q-1.6-9.6-3-3', [-3.2, -2.4]],
    lean:  ['M2.6-17.6Q12-15.6 18.4-10.4', [19, -9.8], 'M-.4-18Q9-16.6 15.4-11.6', [16, -11]],
    out:   ['M2.6-17.6Q9.6-24 15.4-27.6', [16, -28.2], 'M-.4-18Q-7.6-24-12.4-28', [-13, -28.6]],
    up:    ['M2.8-18.2Q5.2-29.4 7.4-38.4', [7.6, -39.2], 'M-.6-18.6Q-4-29.6-4.4-38.6', [-4.5, -39.4]],
    flail: ['M2.6-17.6Q13-20 18.4-26.4', [19, -27], 'M-.4-18Q-10.6-21.6-14.4-29', [-15, -29.6]],
  };
  function armsMarkup(far) {
    let s = '';
    for (const [k, a] of Object.entries(ARMS)) {
      const d = far ? a[2] : a[0], m = far ? a[3] : a[1];
      s += `<g class="sr-arm a-${k}"><path class="sr-arm-o" d="${d}"/><path class="sr-arm-f" d="${d}"/><circle class="sr-mitt o" cx="${m[0]}" cy="${m[1]}" r="2.4"/></g>`;
    }
    return s;
  }
  const ARMS_NEAR = armsMarkup(false), ARMS_FAR = armsMarkup(true);
  function legsMarkup(lk) {
    if (lk.sled === 'sau') return '<path class="sr-leg-o" d="M0-1.6L8.6-1L4-.2"/><path class="sr-leg" d="M0-1.6L8.6-1L4-.2"/><ellipse class="sr-boot o" cx="9.6" cy="-1.4" rx="3.6" ry="2.6"/>';
    if (lk.sled === 'tube') return '<path class="sr-leg-o" d="M1-2Q10-7.4 16-3"/><path class="sr-leg" d="M1-2Q10-7.4 16-3"/><ellipse class="sr-boot o" cx="18" cy="-2.2" rx="4" ry="2.8"/>';
    return '<path class="sr-leg-o" d="M0-1.8L15.6-2.6"/><path class="sr-leg" d="M0-1.8L15.6-2.6"/><ellipse class="sr-boot o" cx="18.6" cy="-3.2" rx="4" ry="3"/>';
  }
  function riderMarkup(lk) {
    const seat = SEAT[lk.sled];
    return `
      <ellipse class="sr-glow" cx="0" cy="-20" rx="38" ry="30"/>
      <g class="sr-speed" opacity="0"><path d="M-34-8h-30M-36-20h-22M-30-32h-18"/></g>
      <g class="sr-sledg">${sledMarkup(lk)}</g>
      <g class="sr-mang"><g class="sr-man" transform="translate(${seat[0]} ${seat[1]})">
        ${legsMarkup(lk)}
        <g class="sr-up">
          <g class="sr-arms far">${ARMS_FAR}</g>
          <g class="sr-scarf-t" transform="translate(-3 -19.4)"><path class="sr-scarf o" d="M0 0L-12.6 3.4L-12 7L0 3.6Z"/><path class="sr-scarf-s" d="M-4.6 1.4L-4.4 5.2M-8.6 2.4L-8.4 6.2"/></g>
          <path class="sr-coat o" d="M-6.2 1C-9.2-8-8.2-18.6-2-21.4C4-22.8 8.6-18.2 8.2-9.2L7.6 1Z"/>
          <path class="sr-coat-d" d="M-6.2 1C-9.2-8-8.2-18.6-2-21.4C-4.6-14-4.6-6-2.6 1Z"/>
          ${lk.stripe ? '<path class="sr-coat-s" d="M-8.2-10.4Q0-8.6 8.4-10.4L8.3-7.4Q0-5.6-8.4-7.4Z"/>' : '<path class="sr-zip" d="M5.4-19L6.2 0"/>'}
          <path class="sr-scarf o" d="M-4.8-20.6Q2-17.6 8.4-20.6L8.6-16.8Q2-13.8-5-16.8Z"/>
          <circle class="sr-head o" cx="2.5" cy="-27.5" r="7"/>
          <circle class="sr-cheek" cx="5.8" cy="-25" r="1.7"/>
          <g class="sr-face-n"><circle class="sr-eye" cx="6" cy="-28.6" r="1.05"/><path class="sr-mouth" d="M6.2-23.6Q7.8-22.6 9-23.8"/></g>
          <g class="sr-face-y"><path class="sr-eye-y" d="M4.8-28.4Q6-30 7.2-28.4"/><path class="sr-mouth-o" d="M5.6-24.2Q7.6-20.4 9.4-24.4Z"/></g>
          <g class="sr-face-x"><path class="sr-eye-x" d="M5-29.6l2 2m0-2l-2 2"/><circle class="sr-mouth-oh" cx="7.6" cy="-23.6" r="1.3"/></g>
          <circle class="sr-nose" cx="9.3" cy="-26.6" r="1.35"/>
          ${hatMarkup(lk)}
          ${lk.goggles && lk.hat !== 'helmet' ? '<rect class="sr-goggle-strap" x="-4.8" y="-32" width="14" height="2"/><rect class="sr-goggle o" x="4.2" y="-33.2" width="6.6" height="4" rx="1.9"/>' : ''}
          <g class="sr-arms near">${ARMS_NEAR}</g>
        </g>
        <g class="sr-dizzy" transform="translate(2.5 -42)"><g class="sr-dizzy-r"><path d="M-9 0l1.4-3 1.4 3-3-1.8h3.2Z"/><path d="M7 -2l1.4-3 1.4 3-3-1.8h3.2Z"/><path d="M-1 4l1.4-3 1.4 3-3-1.8h3.2Z"/></g></g>
      </g></g>
      ${lk.sled === 'tube' ? `<g class="sr-sledf">${TUBE_FRONT}</g>` : ''}`;
  }
  function riderStyle(lk) {
    const w = lk.sled === 'tob' || lk.sled === 'run';
    return `--coat:var(--sr-c${lk.coat});--coat2:var(--sr-c${lk.coat2});--pants:var(--sr-p${lk.pants});--hat:var(--sr-h${lk.hatc});--pom:var(--sr-h${lk.pom});`
      + `--scarf:var(--sr-s${lk.scarf});--skin:var(--sr-k${lk.skin});--mitt:var(--sr-m${lk.mitt});`
      + `--sled:var(--sr-${w ? `w${lk.wood}` : `q${lk.sledc}`});--rail:var(--sr-q${lk.sledc})`;
  }

  // the plate on the sled's side, with the name (HTML, so the text is crisp
  // and its size comes from CSS)
  function setPlate(v, r) {
    r.plate.firstChild.lastChild.textContent = shortName(r.label);
    r.pw = 0;
  }

  // A sledder is three small elements, each its own compositor layer: the
  // shadow, the drawing (an SVG in a div, with the snow spray), and the
  // plate. Moving, turning with the slope and squashing are CSS transforms
  // on them, so a race doesn't repaint the hill (one big layer for everyone
  // re-rastered half the screen every frame). Sizes are in em: the
  // containers' font-size is one rider unit in px at full size (v.B).
  const RSPAN = { x: -70, y: -80, w: 140, h: 100 };
  function makeRider(v, item) {
    const lk = lookOf(item.id);
    const d = v.doc;
    const wrap = d.createElement('div');
    wrap.className = 'sr-rw';
    wrap.setAttribute('style', riderStyle(lk));
    wrap.innerHTML = `<div class="sr-spray"><i></i><i></i><i></i><i></i><i></i><i></i></div><svg class="sr-rider s-${lk.sled}" viewBox="${RSPAN.x} ${RSPAN.y} ${RSPAN.w} ${RSPAN.h}" aria-hidden="true" focusable="false">${riderMarkup(lk)}</svg>`;
    const g = wrap.lastChild;
    const plate = d.createElement('div');
    plate.className = 'sr-plate';
    plate.setAttribute('style', riderStyle(lk));
    plate.innerHTML = '<span><b class="sr-rk"></b><em></em></span>';
    plate.title = item.label;
    const shadow = d.createElement('div');
    shadow.className = 'sr-shadow';
    const r = {
      id: item.id, label: item.label, lk, g, wrap, plate, shadow,
      sledg: g.querySelector('.sr-sledg'), mang: g.querySelector('.sr-mang'), up: g.querySelector('.sr-up'),
      sledf: g.querySelector('.sr-sledf'),
      scarfT: g.querySelector('.sr-scarf-t'), hatT: g.querySelector('.sr-hat-tail'),
      speedEl: g.querySelector('.sr-speed'),
      x: 0, d: 0.5, h: 0, mode: 'grid', placed: false, arms: '', face: '', sq: 0,
      hx: 0, hd: 0.5, pAt: 0,
    };
    setPlate(v, r);
    g.dataset.arms = 'rest';
    return r;
  }
  // one rider unit in px at full size, on the three containers
  function sizeRiders(v) {
    if (!v.gs) return;
    v.B = v.k * v.gs * 1.12;
    v.ridersEl.style.fontSize = v.shadowsEl.style.fontSize = `${v.B.toFixed(3)}px`;
    v.platesEl.style.fontSize = v.posL.style.fontSize = `${(v.B * 9.6).toFixed(3)}px`;
    // the race's name badges: one size for everyone, from the box, whatever
    // the class size or the sled's depth
    // (a little bigger in the close shots, so they read at that distance)
    v.lf = clamp(v.bh * 0.03, 12, 30) * (v.lfK || 1);
    if (v.bh) v.platesEl.style.setProperty('--lf', `${v.lf.toFixed(1)}px`);
    for (const r of v.riders.values()) r.lfF = undefined;
    v.mv++;
  }

  // ---------- the view ----------
  const markup = () => `
    <svg class="sr-layer sr-skyl" aria-hidden="true" focusable="false"></svg>
    <div class="sr-world">
    <svg class="sr-layer sr-farl" aria-hidden="true" focusable="false"></svg>
    <div class="sr-veil" aria-hidden="true"></div>
    <svg class="sr-layer sr-hilll" aria-hidden="true" focusable="false"></svg>
    <div class="sr-box sr-shadows" aria-hidden="true"></div>
    <div class="sr-box sr-riders" aria-hidden="true"></div>
    <svg class="sr-layer sr-frontl" aria-hidden="true" focusable="false"></svg>
    <svg class="sr-layer sr-fgl" aria-hidden="true" focusable="false"></svg>
    </div>
    <canvas class="sr-cine" aria-hidden="true"></canvas>
    <svg class="sr-bank" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="sr-bank-b" d="M0 34Q60 18 130 30T270 26T420 34T560 22T720 30T860 20T1000 30V100H0Z"/><path class="sr-bank-f" d="M0 58Q90 40 190 54T380 50T560 60T760 46T1000 56V100H0Z"/></svg>
    <div class="sr-box sr-plates" aria-hidden="true"></div>
    <div class="sr-box sr-posl" aria-hidden="true"><b class="sr-pos p1"></b><b class="sr-pos p2"></b><b class="sr-pos p3"></b><b class="sr-pos p4"></b><b class="sr-pos p5"></b><b class="sr-pos p6"></b></div>
    <svg class="sr-layer sr-lodgel" aria-hidden="true" focusable="false"></svg>
    <span class="sr-left" aria-hidden="true"></span>
    <div class="sr-lb" aria-hidden="true"><ol></ol></div>
    <button type="button" class="sr-pour" hidden>Let them out</button>
    <div class="sr-name" aria-hidden="true"><b class="sr-place"></b><span></span></div>
    <div class="sr-results" aria-hidden="true"><ol></ol></div>
    <div class="sr-burst" aria-hidden="true"></div>
    <div class="sr-burst sr-burst-lodge" aria-hidden="true"></div>`;

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
    const q = (s) => el.querySelector(s);
    const v = {
      doc, el,
      sky: q('.sr-skyl'), far: q('.sr-farl'), hill: q('.sr-hilll'), front: q('.sr-frontl'),
      fg: q('.sr-fgl'), lodgeL: q('.sr-lodgel'),
      shadowsEl: q('.sr-shadows'), ridersEl: q('.sr-riders'), platesEl: q('.sr-plates'), posL: q('.sr-posl'),
      posEls: [...el.querySelectorAll('.sr-pos')], results: q('.sr-results'), lb: q('.sr-lb'), lbRows: new Map(), lbOrder: [], mv: 0, long: false, badges: [], rank: [],
      cine: q('.sr-cine'), z: 1, lfK: 1, shot: 'side', shots: null, shotI: -1, shotCam: null,
      left: q('.sr-left'), pourBtn: q('.sr-pour'), name: q('.sr-name'), burst: q('.sr-burst'), burstLodge: q('.sr-burst-lodge'),
      riders: new Map(), g: null, k: 1, offX: 0, offY: 0, bw: 0, bh: 0, cam: { x: 0, y: 0 },
      race: null, active: null, plan: null, done: new Set(), winner: null,
      picked: null, total: 0, full: false, wasFull: undefined, off: false, pouring: false,
      incoming: new Set(), inLodge: new Set(), entering: new Set(), order: '', last: 0, sound: false, lastThump: 0,
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

  // 400 units tall and as wide as the box; the layers are drawn once per
  // width and moved by the camera (CSS transforms, so nothing repaints)
  function layout(v) {
    const bw = v.el.clientWidth, bh = v.el.clientHeight;
    if (!bw || !bh) return;
    const W = Math.round(clamp((H * bw) / bh, 620, 1500));
    v.bw = bw; v.bh = bh;
    v.K = Math.min(bw / W, bh / H);
    v.oX = (bw - W * v.K) / 2;
    v.oY = bh - H * v.K;
    v.el.style.setProperty('--u', `${v.K.toFixed(4)}px`);
    zoomNums(v);
    v.cc = null;
    // (the perspective canvas: flat art, so it needn't be drawn past 1600px)
    const dpr = Math.min(v.doc.defaultView.devicePixelRatio || 1, 1600 / Math.max(1, bw));
    v.cine.width = Math.round(bw * dpr); v.cine.height = Math.round(bh * dpr); v.dpr = dpr;
    if (!v.g || v.g.W !== W || v.g.long !== !!v.long) {
      const g = v.g = geo(W, !!v.long);
      const vb = (svg, x0, y0, w, h) => { svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`); svg.dataset.x0 = x0; svg.dataset.y0 = y0; svg.dataset.w = w; svg.dataset.h = h; };
      v.sky.innerHTML = defsMarkup(v) + skyMarkup(g);
      vb(v.sky, 0, 0, W, H);
      const far = farMarkup(g);
      v.far.innerHTML = far.html;
      vb(v.far, -100, 0, far.w, H + 400);
      v.hill.innerHTML = hillMarkup(g);
      [v.hill, v.front].forEach((s) => vb(s, g.XMIN, g.YMIN, g.XMAX - g.XMIN, g.YMAX - g.YMIN));
      v.front.innerHTML = frontMarkup(g) + '<g class="sr-fx"></g>';
      v.fx = v.front.querySelector('.sr-fx');
      const fg = fgMarkup(g);
      v.fg.innerHTML = fg.html;
      vb(v.fg, -100, 0, fg.w, H + 200);
      v.lodgeL.innerHTML = lodgeMarkup(g);
      vb(v.lodgeL, 0, 0, W, H);
      v.guests = v.lodgeL.querySelector('.sr-guests');
      v.countT = v.lodgeL.querySelector('.sr-count-t');
      v.countG = v.lodgeL.querySelector('.sr-count');
      v.gate = v.hill.querySelector('.sr-gate');
      v.cam = { x: g.rest.x, y: g.rest.y };
      assignHomes(v, true);
      renderLodge(v);
      paintCount(v);
      paintGate(v, 0);
    }
    sizeLayers(v);
    sizeRiders(v);
    placeLayers(v);
    v.order = '';
    if (v.name.title) placeName(v);
    if (v.shownResults) placeResults(v);
    if (v.lbRows.size) { placeBoard(v); if (v.plan) boardStep(v, true); }
    placeLodgeBurst(v);
  }
  // screen units (the sky, the lodge, the name, the results) never zoom
  const toPx = (v, x, y) => ({ x: v.oX + x * v.K, y: v.oY + y * v.K });
  // a shot's zoom: the world scales about a point a little below the middle
  function zoomNums(v) {
    const z = v.z, cx = v.bw / 2, cy = v.bh * 0.55;
    v.k = v.K * z;
    v.offX = cx - (cx - v.oX) * z;
    v.offY = cy - (cy - v.oY) * z;
  }
  function setZoom(v, z) {
    if (z === v.z) return;
    v.z = z;
    zoomNums(v);
    sizeLayers(v);
    sizeRiders(v);
    v.order = '';
  }
  // the layers are drawn at the shot's scale (a CSS scale would blur them)
  function sizeLayers(v) {
    for (const s of [v.sky, v.far, v.hill, v.front, v.fg, v.lodgeL]) {
      if (!s.dataset.w) continue;
      const k = s === v.hill || s === v.front || s === v.fg ? v.k : v.K;
      s.setAttribute('width', (s.dataset.w * k).toFixed(1));
      s.setAttribute('height', (s.dataset.h * k).toFixed(1));
    }
  }
  function placeLayers(v) {
    const c = v.cam, g = v.g, k = v.k;
    const at = (svg, ux, uy) => { svg.style.transform = `translate3d(${(v.offX + ux * k).toFixed(2)}px, ${(v.offY + uy * k).toFixed(2)}px, 0)`; };
    const atS = (svg, ux, uy) => { svg.style.transform = `translate3d(${(v.oX + ux * v.K).toFixed(2)}px, ${(v.oY + uy * v.K).toFixed(2)}px, 0)`; };
    atS(v.sky, 0, 0);
    atS(v.lodgeL, 0, 0);
    atS(v.far, -100 - FAR_K * c.x, -FAR_KY * (c.y - g.rest.y));
    for (const s of [v.hill, v.front]) at(s, g.XMIN - c.x, g.YMIN - c.y);
    at(v.fg, -100 - FG_K * c.x, 0);
  }

  // the top of the hill: staggered rows behind the start line, as big as fit
  function assignHomes(v, snap = false) {
    const g = v.g;
    if (!g) return;
    const list = [...v.riders.values()].filter((r) => r.mode !== 'lodge');
    const n = list.length;
    const x0 = 40, x1 = g.G - 26;
    let best = null;
    for (let R = 1; R <= 5; R++) {
      const C = Math.ceil(n / R) || 1;
      const pitch = (x1 - x0) / (C + (R > 1 ? 0.5 : 0));
      const gapD = R > 1 ? (DEPTH - 18) * 0.86 / (R - 1) : 99;
      const s = Math.min(1.2, pitch / 68, gapD / 16.5);
      if (!best || s > best.s + 0.001) best = { R, C, pitch, s };
    }
    v.gs = clamp(best.s, 0.55, 1.2);
    list.forEach((r, i) => {
      const row = i % best.R, col = Math.floor(i / best.R);
      const d = best.R === 1 ? 0.5 : 0.07 + 0.86 * row / (best.R - 1);
      const x = x1 - best.pitch * (col + 0.5) - (row % 2 ? best.pitch * 0.5 : 0) + SKEW * d * 0.4;
      r.hx = x; r.hd = d;
      if (snap || !r.placed) { r.x = x; r.d = d; r.placed = true; }
      if (r.mode === 'hop' && r.hop0 && performance.now() < r.hop0.at) r.hop0 = null;   // not out of the door yet: aim at the new spot
    });
    sizeRiders(v);
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
        r.wrap.remove(); r.plate.remove(); r.shadow.remove();
        v.riders.delete(id);
        changed = true;
      }
    }
    for (const it of want.values()) {
      const r = v.riders.get(it.id);
      if (r) { if (r.label !== it.label) { r.label = it.label; r.plate.title = it.label; setPlate(v, r); } continue; }
      if (v.inLodge.has(it.id) && (v.picked || []).some((p) => p.id === it.id)) continue;   // still in the lodge
      const nr = makeRider(v, it);
      v.riders.set(it.id, nr);
      v.shadowsEl.appendChild(nr.shadow);
      v.ridersEl.appendChild(nr.wrap);
      v.platesEl.appendChild(nr.plate);
      const fromLodge = v.incoming.has(it.id) || v.inLodge.has(it.id) || (v.picked || []).some((p) => p.id === it.id);
      if (fromLodge && v.g) { nr.hopFrom = doorWorld(v); nr.mode = 'hop'; nr.hidden = true; nr.hopAt = hopSlot(v); }
      v.incoming.delete(it.id); v.inLodge.delete(it.id);
      changed = true;
    }
    if (changed) {
      assignHomes(v, false);
      paintCount(v);
      v.order = '';
    }
  }
  // out of the lodge one after another
  function hopSlot(v) {
    const now = performance.now();
    if (!v.hopBase || now - v.hopBase > 2500) { v.hopBase = now; v.hopN = 0; }
    return v.hopBase + 150 + (v.hopN++) * 55;
  }
  // the lodge's door, in world units (the lodge stays put in the view)
  function doorWorld(v) {
    const g = v.g, s = g.lodge.s;
    return { x: g.lodge.x + (LOD.door.x + LOD.door.w / 2) * s + v.cam.x, y: H + (-32 - 4) * s + v.cam.y };
  }

  // ---------- the race ----------
  // The places (wheel.js drew them, in order) cross the line a beat apart:
  // each one's gap behind the winner at the line is its beat times the speed
  // there. Everyone else finishes behind the last of them.
  function makePlan(v, s) {
    const g = v.g, tm = v.tm;
    const rnd = seeded(hash(`${s.winnerId}:${s.startedAt}`));
    const racers = [...v.riders.values()].filter((r) => r.mode !== 'lodge');
    const ids = new Set(racers.map((r) => r.id));
    const places = (s.winners && s.winners.length ? s.winners : [s.winnerId]).filter((id) => ids.has(id)).slice(0, tm.n);
    v.places = places;
    const placeOf = new Map(places.map((id, k) => [id, k]));
    const others = racers.filter((r) => !placeOf.has(r.id));
    const shuffled = others.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const race = tm.fin - tm.go, vl = vLine(g, race);
    const lastGap = (places.length - 1) * tm.beat * vl;
    const spacing = clamp(1000 / Math.max(1, others.length), 30, 120);
    const gap = new Map();
    places.forEach((id, k) => gap.set(id, k * tm.beat * vl));
    shuffled.forEach((r, k) => gap.set(r.id, lastGap + 44 + k * spacing + rnd() * spacing * 0.8));
    const stopMax = Math.max(g.L + 160, g.L + 0.58 * g.W - g.LW - 46);   // the lodge's left edge, at the finish view
    const plan = new Map();
    for (const r of racers) {
      const place = placeOf.has(r.id) ? placeOf.get(r.id) : -1;
      plan.set(r.id, {
        r, place, win: place === 0, tm, race,
        x0: r.x, d0: r.d, off: r.x - g.G,
        gap: gap.get(r.id),
        wa: place === 0 ? 0 : (g.long ? 8 + rnd() * 16 : 14 + rnd() * 22), wf: g.long ? 1.5 + rnd() * 2 : 0.6 + rnd() * 1, wp: rnd() * 6.28,
        lane: 0.5, la: 0.015 + rnd() * 0.025, lf: 0.3 + rnd() * 0.5, lp: rnd() * 6.28,
        stop: place >= 0 ? lerp(g.L + 70, stopMax, 0.75 - 0.5 * place / Math.max(1, places.length)) + rnd() * 20 : g.L + 40 + rnd() * (stopMax - g.L - 40),
        stopD: 0.08 + rnd() * 0.84,
        bumps: [], wipe: null, form: null, mw: null,
      });
    }
    // lanes: neighbours in the finishing order go in lanes well apart, so
    // sleds near each other on the course are spread down the track
    const order = [...places.map((id) => plan.get(id)), ...shuffled.map((r) => plan.get(r.id))];
    const NL = clamp(Math.round(Math.sqrt(order.length) * 1.3), 3, 7);
    const step = [3, 2, 5, 1].find((k) => k < NL && gcd(k, NL) === 1) || 1;
    order.forEach((p, k) => { p.lane = 0.08 + 0.84 * (NL === 1 ? 0.5 : ((k * step) % NL) / (NL - 1)) + (rnd() - 0.5) * 0.03; });
    if (g.long) planLong(plan, places, shuffled, rnd);
    // two who cross just behind the places wipe out (a big class only)
    const wipers = shuffled.slice(0, 6).slice(0, others.length >= 5 ? 2 : (others.length >= 3 ? 1 : 0));
    wipers.forEach((r, i) => { const p = plan.get(r.id); if (!p.mw) p.wipe = { x: g.L + 26 + i * 40 + rnd() * 30, dir: rnd() < 0.5 ? 1 : -1 }; });
    // bumps between neighbours: sample the race, push close pairs apart
    const list = [...plan.values()];
    const maxB = g.long ? 6 : 3;
    let nb = 0;
    for (let el = tm.go + 260; el < tm.fin - 260 && nb < maxB; el += 70) {
      for (let i = 0; i < list.length && nb < maxB; i++) {
        for (let j = i + 1; j < list.length && nb < maxB; j++) {
          const a = list[i], b = list[j];
          const xa = xAt(g, a, el), xb = xAt(g, b, el), da = dAt(a, el), db = dAt(b, el);
          if (Math.abs(xa - xb) < 26 * v.gs && Math.abs(da - db) < 0.11) {
            const recent = (p) => p.bumps.some((u) => el - u.t < 600);
            if (recent(a) || recent(b)) continue;
            const sg = da >= db ? 1 : -1;
            a.bumps.push({ t: el, s: sg }); b.bumps.push({ t: el, s: -sg });
            nb++;
          }
        }
      }
    }
    return plan;
  }
  // The long race's story: at each stage (KN, race time 0..1) one of a few
  // contenders leads, a different one each time, and never the winner going
  // into the final straight; the rest of the field drifts back and forth
  // behind. Two of the field tumble off and get back on.
  const KN = [0.08, 0.19, 0.3, 0.41, 0.52, 0.63, 0.74, 0.82];
  function planLong(plan, places, shuffled, rnd) {
    const first = places[0];
    const contenders = [...places.slice(0, 3), ...shuffled.slice(0, 5 - Math.min(3, places.length)).map((r) => r.id)];
    const leaders = [];
    for (let j = 0; j < KN.length; j++) {
      const prev = leaders[j - 1];
      const ok = contenders.filter((id) => id !== prev && !(id === first && (j === 0 || j === KN.length - 1)));
      // the winner leads once, mid-race, then drops back
      leaders.push(j === 3 && prev !== first && contenders.length > 1 ? first : ok[Math.floor(rnd() * ok.length)] || contenders[0]);
    }
    const isC = new Set(contenders);
    for (const p of plan.values()) {
      let f = isC.has(p.r.id) ? rnd() * 40 - 20 : -(40 + rnd() * 90);
      p.form = KN.map((t, j) => {
        if (leaders[j] === p.r.id) return 120 + rnd() * 30;
        if (isC.has(p.r.id)) return rnd() * 70 - 30;
        f = clamp(f + rnd() * 70 - 40, -240, -20);
        return f;
      });
    }
    // tumbles: two of the field, at different stages (not round the bends' tightest)
    const tumblers = shuffled.filter((r) => !isC.has(r.id)).slice(0, 2);
    tumblers.forEach((r, i) => { const t0 = 0.35 + i * 0.22 + rnd() * 0.06; plan.get(r.id).mw = { t0, t1: t0 + 0.068, slide: 30 }; });
  }
  function formAt(p, tau) {
    const f = p.form;
    if (!f) return 0;
    if (tau <= KN[0]) return f[0] * smooth(tau / KN[0]);
    const last = KN.length - 1;
    if (tau >= KN[last]) return f[last] * (1 - smooth((tau - KN[last]) / 0.12));
    let j = 0;
    while (tau > KN[j + 1]) j++;
    return lerp(f[j], f[j + 1], smooth((tau - KN[j]) / (KN[j + 1] - KN[j])));
  }
  // where a racer is along the course (world x) at race time tau (0..1), up
  // to the line; the winner reaches L exactly at tau 1, each place a beat later
  function xRaw(g, p, tau) {
    tau = clamp(tau, 0, 1);
    const base = g.G + g.span * uAt(g, tau);
    if (g.long) {
      const weave = p.wa * Math.sin(Math.PI * tau) * Math.sin(6.283 * p.wf * tau + p.wp) * (1 - smooth((tau - 0.6) / 0.25));
      return base + p.off * (1 - smooth(tau / 0.25)) + formAt(p, tau) + weave - p.gap * smooth((tau - 0.8) / 0.14);
    }
    const weave = p.wa * Math.sin(Math.PI * tau) * Math.sin(6.283 * p.wf * tau + p.wp) * (1 - smooth((tau - 0.58) / 0.3));
    const lag = p.win ? -42 * Math.sin(Math.PI * Math.min(1, tau / 0.7)) * (1 - smooth((tau - 0.45) / 0.4)) : 0;
    return base + p.off * (1 - smooth(tau)) + weave + lag - p.gap * smooth((tau - 0.12) / 0.8);
  }
  // a tumble: they slide a little while they're off, then get back on and
  // win back part of what they lost
  function xRace(g, p, tau) {
    if (!p.mw || tau <= p.mw.t0) return xRaw(g, p, tau);
    const { t0, t1, slide } = p.mw, xa = xRaw(g, p, t0);
    if (tau <= t1) return xa + slide * smooth((tau - t0) / (t1 - t0));
    const loss = xRaw(g, p, t1) - xa - slide;
    return xRaw(g, p, tau) - loss * (1 - 0.45 * smooth((tau - t1) / 0.22));
  }
  function xAt(g, p, el) {
    const tm = p.tm;
    if (el <= tm.go) return p.x0;
    if (el <= tm.fin) return xRace(g, p, (el - tm.go) / p.race);
    // past the winner's moment: anyone short of the line keeps their speed
    // over it (so the places cross a beat apart), then they brake to a stop
    let x1 = xRace(g, p, 1), dt = el - tm.fin;
    const v1 = Math.max(0.05, (x1 - xRace(g, p, 1 - 0.01)) / (0.01 * p.race));
    const line = g.L + 12;
    if (x1 < line) { const tc = (line - x1) / v1; if (dt <= tc) return x1 + v1 * dt; dt -= tc; x1 = line; }
    const D = Math.max(40, p.stop - x1), a = v1 * v1 / (2 * D), td = 2 * D / v1;
    return dt >= td ? x1 + D : x1 + v1 * dt - a * dt * dt / 2;
  }
  function dAt(p, el) {
    const tm = p.tm;
    if (el <= tm.go) return p.d0;
    const tau = (el - tm.go) / p.race;
    let d = lerp(p.d0, p.lane + p.la * Math.sin(6.283 * p.lf * tau + p.lp), smooth(tau / 0.3));
    if (el > tm.fin) d = lerp(d, p.stopD, smooth((el - tm.fin) / 1200));
    for (const b of p.bumps) { const u = (el - b.t) / 110; if (u > 0) d += b.s * 0.11 * u * Math.exp(1 - u); }
    return clamp(d, 0.03, 0.97);
  }
  // air over the kickers (more off the big jump): how high, and how far in
  function airAt(g, p, x, speed) {
    for (let k = 0; k < g.crests.length; k++) {
      const c = g.crests[k], J = c.big ? clamp(speed * 0.34, 80, 300) : clamp(speed * 0.16, 30, 150);
      if (x > c.x && x < c.x + J) { const u = (x - c.x) / J; return { h: 4 * J * (c.big ? 0.21 : 0.2) * u * (1 - u), u, k, big: c.big }; }
    }
    return null;
  }

  function raceStep(v, el, now) {
    const g = v.g, tm = v.tm;
    let lead = -1e9;
    const live = [];
    for (const p of v.plan.values()) {
      const r = p.r;
      if (r.mode !== 'race') continue;
      const x = xAt(g, p, el), speed = Math.max(0, (x - xAt(g, p, el - 40)) / 0.04);   // units / s
      if (!p.wipe || !p.wiped) lead = Math.max(lead, x);
      r.x = x;
      r.d = clamp(dAt(p, el) + (g.long ? 0.2 * bendAt(g, x) : 0), 0.03, 0.97);
      r.speed = speed;
      const tau = (el - tm.go) / p.race;
      // a tumble mid-race (long): off the sled, head over heels, back on
      r.tumble = p.mw && tau > p.mw.t0 && tau < p.mw.t1 ? (tau - p.mw.t0) / (p.mw.t1 - p.mw.t0) : null;
      r.dizzy = !!p.mw && tau >= p.mw.t1 && tau < p.mw.t1 + 0.05;
      if (r.tumble != null) once(v, `mw:${r.id}`, true, () => { bonkFx(v, r); if (v.sound) wipeSound(); });
      const air = r.tumble == null && el > tm.go && el < tm.last + 600 ? airAt(g, p, x, speed) : null;
      r.h = air ? air.h : (r.tumble != null ? 30 * Math.sin(Math.PI * r.tumble) : 0);
      if (air) { r.air = air; } else if (r.air) {
        // landed: a thump and a puff
        const key = `land:${r.id}:${r.air.k}`;
        if (!v.done.has(key)) { v.done.add(key); r.sq = now; puff(v, r); if (v.sound && now - v.lastThump > 90) { v.lastThump = now; thump(); } }
        r.air = null;
      }
      for (const b of p.bumps) {
        const key = `bump:${r.id}:${b.t}`;
        if (el >= b.t && !v.done.has(key)) { v.done.add(key); if (b.s > 0) { bonkFx(v, r); if (v.sound) bonk(); } }
      }
      // the wipeout: off the sled just past the line
      if (p.wipe && !p.wiped && x >= p.wipe.x) { p.wiped = { at: el, x, d: r.d }; if (v.sound) wipeSound(); }
      const crossed = p.place >= 0 && el >= tm.cross[p.place];
      r.pose = el < tm.go ? 'crouch' : (p.wiped ? 'wipe' : (r.tumble != null ? 'wipe' : (air ? 'air' : (crossed ? 'cheer' : (r.dizzy ? 'dizzy' : (el > tm.last + 900 && x >= p.stop - 2 ? 'stand' : 'ride'))))));
      r.wipe = p.wiped || null;
      r.el = el;
      if (el > tm.go + 500 && x < g.L) live.push(r);
    }
    // the camera follows the leaders down (a little ahead of the long race's
    // leader, so more of the field shows), then holds on the finish
    // (the mean of the first four, so a change of leader doesn't jerk it),
    // eased and speed-limited, and always keeping the leader in view; then
    // it settles on the finish
    const front = [...v.plan.values()].filter((p) => p.r.mode === 'race' && !p.wiped).map((p) => p.r.x).sort((a, b) => b - a).slice(0, 4);
    const focus = front.length ? front.reduce((a, b) => a + b, 0) / front.length : lead;
    const room = g.W - g.LW - 70;
    let tc = el >= tm.fin ? g.finX : clamp(Math.max(focus - 0.46 * g.W, lead - room), g.rest.x, g.finX);
    // the long race cuts between shots (planShots); a cut back to the side
    // camera lands it on its mark, no swoop
    const si = v.shots ? shotIndex(v.shots, el) : -1;
    const cut = si !== v.shotI;
    v.shotI = si;
    if (cut && si >= 0 && v.shots[si].type === 'side' && el >= tm.go) { v.camS = clamp(Math.max(tc, lead - room), g.rest.x, g.finX); v.camV = 0; v.camEl = el; }
    if (v.camS == null || el < tm.go) { v.camS = g.rest.x; v.camV = 0; }
    else {
      const dts = clamp((el - v.camEl) / 1000, 0, 0.25);
      // a damped spring toward the target, its speed capped
      const k = 5, c = 2 * Math.sqrt(k);
      v.camV += (k * (tc - v.camS) - c * v.camV) * dts;
      v.camV = clamp(v.camV, -600, 600);
      v.camS += v.camV * dts;
      if (el < tm.fin) v.camS = Math.max(v.camS, lead - room);
      v.camS = clamp(v.camS, g.rest.x, g.finX);
    }
    v.camEl = el;
    v.raceCam = v.camS;
    v.shotCam = si >= 0 ? shotCam(v, v.shots[si], el, cut) : null;
    // the race's calm look and the running order, while they race
    const racing = el >= tm.go && el < (tm.results || tm.back - 400);
    if (racing !== !!v.quiet) { v.quiet = racing; v.el.classList.toggle('quiet', racing); v.lb.classList.toggle('on', racing); }
    if (racing && (el - (v.lbAt || -1e9) > 450 || el < v.lbAt)) { v.lbAt = el; boardStep(v); }
    once(v, 'whistle', el >= 0, () => { if (v.sound) whistle(); });
    once(v, 'hiss', el >= tm.go, () => { if (v.sound) hiss(Math.min(tm.fin - tm.go, 6000) + 600); });
    if (g.long) once(v, 'hiss2', el >= tm.fin - 3800, () => { if (v.sound) hiss(3600); });
    // the places, one at a time
    (v.places || []).forEach((id, k) => {
      const p = v.plan.get(id);
      if (p) once(v, `line:${k}`, el >= tm.cross[k], () => crossLine(v, p.r, k));
    });
    if (tm.results) once(v, 'results', el >= tm.results, () => showResults(v));
    if (v.lodgeBound) {
      (v.places || []).forEach((id, k) => {
        const p = v.plan.get(id);
        if (p && el >= tm.toLodge + k * 170 && !v.done.has(`tolodge:${k}`)) { v.done.add(`tolodge:${k}`); toLodge(v, p.r, now); }
      });
    }
    // badges: the top three while they race (the long race), then each
    // place's number once they're over the line
    const placed = (v.places || []).map((id, k) => ({ k, r: v.riders.get(id) })).filter((q, k) => q.r && el >= tm.cross[k] && q.r.mode === 'race');
    let badges;
    if (placed.length || !g.long || el < tm.go + 500) badges = placed.map((q) => ({ r: q.r, n: q.k + 1 }));
    else {
      const prev = v.rank;
      const score = (r) => r.x + (prev.indexOf(r.id) >= 0 ? (3 - prev.indexOf(r.id)) * 6 : 0);
      live.sort((a, b) => score(b) - score(a));
      v.rank = live.slice(0, 3).map((r) => r.id);
      badges = live.slice(0, 3).map((r, i) => ({ r, n: i + 1 }));
    }
    v.badges = badges;
  }
  const once = (v, key, due, fn) => { if (due && !v.done.has(key)) { v.done.add(key); fn(); } };

  // over the line: their place and name come up, snow and confetti
  function crossLine(v, r, k = 0) {
    if (k === 0) v.winner = r;
    r.placeK = k;
    r.g.classList.add(k === 0 ? 'win' : 'placed');
    r.plate.classList.add(k === 0 ? 'win' : 'placed');
    showName(v, r.label, v.tm.n > 1 ? ORD[k] : '');
    const p = v.shot === 'head' && v.cineFin ? v.cineFin : toPx(v, v.g.L - 14 - v.raceCam, surfAt(v.g, v.g.L) + DEPTH / 2 - camYAt(v.g, v.raceCam));
    v.burst.style.left = `${p.x.toFixed(1)}px`;
    v.burst.style.top = `${p.y.toFixed(1)}px`;
    fireBurst(v.burst, snowBurst(v.K, k === 0 ? 40 : 20, true));
    if (v.sound) { if (k === 0) cheer(); else ding(k); }
  }
  // a winner hops over to the lodge's door and in
  function toLodge(v, r, now) {
    r.mode = 'tolodge';
    const w = worldOf(v, r);
    r.tl = { at: now, from: { x: w.x, y: w.y }, to: doorWorld(v), dur: reduced(v.doc) ? 300 : 600 };
  }

  // ---------- every frame ----------
  function step(v, now) {
    const dt = v.last ? Math.min(250, now - v.last) / 1000 : 0;
    v.last = now;
    if (!isOn(v.doc) || !v.g) return;
    const g = v.g;
    let camX = g.rest.x, camY = null, z = 1, shot = 'side';
    if (v.race) {
      const el = Date.now() - v.race.startedAt, tm = v.tm;
      if (v.plan && el < tm.back + 200) raceStep(v, el, now);
      camX = v.raceCam != null ? v.raceCam : g.rest.x;
      const sc = el < tm.back ? v.shotCam : null;
      if (sc) { shot = sc.type; if (sc.x != null) { camX = sc.x; camY = sc.y; z = sc.z; } }
      if (el >= tm.back) {
        // back up the hill: everyone's at the top again once the view has left them
        const u = smooth((el - tm.back) / tm.backDur);
        v.badges = [];
        camX = lerp(g.finX, g.rest.x, u);
        if (u > 0.45 && !v.done.has('reset')) { v.done.add('reset'); resetToTop(v); }
        if (u >= 1) endRace(v);
      }
      paintGate(v, el);
    }
    setShot(v, shot);
    setDuel(v, shot === 'tight' && v.shots && v.shotI >= 0 ? v.shots[v.shotI] : null);
    setZoom(v, z);
    v.cam.x = camX;
    v.cam.y = camY != null ? camY : camYAt(g, camX);
    placeLayers(v);
    if (v.cineOn) drawCine(v, now);
    for (const r of v.riders.values()) {
      if (r.mode === 'tolodge') lodgeStep(v, r, now);
      else if (r.mode === 'hop') hopStep(v, r, now);
      else if (r.mode === 'grid') gridStep(v, r, dt, now);
    }
    paint(v, now);
  }
  // waiting at the top: shuffle toward their spot, jostle, bounce, fix the scarf
  function gridStep(v, r, dt, now) {
    const k = 1 - Math.exp(-dt * 5);
    r.x = lerp(r.x, r.hx, k); r.d = lerp(r.d, r.hd, k);
    r.h = 0; r.speed = 0; r.wipe = null;
    r.pose = 'idle';
    if (calm(v.doc)) { r.jx = 0; r.jy = 0; r.lean = 3; r.scarfRot = 58; return; }
    const t = now / 1000 + r.lk.ph * 20;
    r.jx = 2.2 * Math.sin(t * 1.1 + r.lk.ph * 9);
    const env = Math.max(0, Math.sin(t * 0.45 + r.lk.ph * 7));
    r.jy = -Math.abs(Math.sin(t * 7.5)) * 2.6 * env * env;
    r.lean = 3 + 4 * Math.sin(t * 1.4 + r.lk.ph * 3);
    r.scarfRot = 56 + 9 * Math.sin(t * 2.1 + r.lk.ph);
    // every few seconds, a hand to the scarf
    const cyc = (t * 0.17 + r.lk.ph) % 1;
    r.scarfFix = cyc < 0.09;
  }
  function hopStep(v, r, now) {
    if (!r.hop0) {
      const home = onTrack(v.g, r.hx, r.hd);
      r.hop0 = { at: r.hopAt || now, from: r.hopFrom || home, to: home };
      r.hop0.dur = reduced(v.doc) ? 400 : clamp(Math.hypot(home.x - r.hop0.from.x, home.y - r.hop0.from.y) / 0.32, 700, 1900);
    }
    const u = (now - r.hop0.at) / r.hop0.dur;
    r.pose = 'hop';
    if (u < 0) { r.hidden = true; return; }
    r.hidden = false;
    if (u >= 1) { r.mode = 'grid'; r.x = r.hx; r.d = r.hd; r.wx = null; r.hop0 = null; r.hopFrom = null; r.hopTo = null; return; }
    const e = smooth(u), n = Math.max(2, Math.round(r.hop0.dur / 260));
    r.wx = lerp(r.hop0.from.x, r.hop0.to.x, e);
    r.wy = lerp(r.hop0.from.y, r.hop0.to.y, e) - Math.abs(Math.sin(Math.PI * n * u)) * 14 * (1 - u * 0.4);
    r.wd = r.hd;
  }
  function lodgeStep(v, r, now) {
    const t = r.tl, u = (now - t.at) / t.dur;
    r.pose = 'hop';
    if (u >= 1) {
      r.mode = 'lodge';
      r.hidden = true;
      r.wx = null;
      v.inLodge.add(r.id);
      v.entering.add(r.id);
      renderLodge(v);
      paintCount(v);
      if (v.sound) doorBell();
      return;
    }
    const e = smooth(u);
    r.wx = lerp(t.from.x, t.to.x, e);
    r.wy = lerp(t.from.y, t.to.y, e) - Math.abs(Math.sin(Math.PI * 3 * u)) * 12;
    r.wd = 1;
  }
  // everyone not in the lodge back on the start rows (off screen, mid-sweep)
  function resetToTop(v) {
    for (const r of v.riders.values()) {
      if (r.mode === 'lodge' || r.mode === 'hop') continue;
      if (r.mode === 'tolodge') { r.mode = 'lodge'; r.hidden = true; r.wx = null; v.inLodge.add(r.id); v.entering.add(r.id); renderLodge(v); continue; }
      r.mode = 'grid'; r.wipe = null; r.h = 0; r.air = null; r.wx = null; r.hidden = false; r.tumble = null; r.dizzy = false;
      unplace(r);
    }
    assignHomes(v, true);
    paintCount(v);
  }
  function unplace(r) {
    r.placeK = null;
    r.g.classList.remove('win', 'placed'); r.plate.classList.remove('win', 'placed');
  }
  function endRace(v) {
    v.race = null; v.plan = null; v.raceCam = null; v.badges = []; v.shots = null; v.shotCam = null;
    v.quiet = false; v.el.classList.remove('quiet'); v.lb.classList.remove('on');
    v.el.dataset.state = v.winner ? 'picked' : '';
    paintGate(v, 0);
    setDisabled(v.doc, v.off);
  }
  function paintGate(v, el) {
    if (!v.gate) return;
    const g = v.g, y = surfAt(g, g.G);
    const open = v.race && v.tm ? smooth((el - v.tm.gate) / 260) : 0;
    const a0 = Math.atan2(DEPTH, -SKEW), a1 = -1.45;
    const a = lerp(a0, a1, open), len = Math.hypot(SKEW, DEPTH);
    const px = g.G + 4, py = y - 16, ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
    const d = `M${f1(px)} ${f1(py)}L${f1(ex)} ${f1(ey)}`;
    v.gate.firstChild.setAttribute('d', d);
    v.gate.lastChild.setAttribute('d', d);
  }

  // a sledder's spot in the world
  function worldOf(v, r) {
    if (r.wx != null) return { x: r.wx, y: r.wy, d: r.wd != null ? r.wd : r.d };
    const p = onTrack(v.g, r.x, r.d);
    return { x: p.x + (r.jx || 0) * (r.mode === 'grid' ? 1 : 0), y: p.y - r.h + (r.mode === 'grid' ? (r.jy || 0) : 0), d: r.d };
  }
  const px = (v, x, y) => ({ x: v.offX + (x - v.cam.x) * v.k, y: v.offY + (y - v.cam.y) * v.k });
  const n2 = (n) => n.toFixed(2);
  function paint(v, now) {
    const g = v.g, list = [...v.riders.values()], floats = [];
    for (const r of list) {
      const hide = r.mode === 'lodge' || r.hidden;
      if (hide !== r.wasHidden) { r.wasHidden = hide; r.wrap.style.display = r.plate.style.display = r.shadow.style.display = hide ? 'none' : ''; }
      if (hide) continue;
      const w = worldOf(v, r);
      const s = v.gs * (0.86 + 0.26 * clamp(w.d, 0, 1)), S = s / (v.gs * 1.12);
      // the sled follows the slope; in the air it noses up, then down
      let ang = r.mode === 'grid' || r.wx != null ? 0 : slopeDeg(g, r.x);
      if (r.air) ang += lerp(-8, 10, r.air.u);
      if (r.mode === 'race' && g.long) ang += 7 * bendAt(g, r.x);     // leaning into the bend
      // a squash on landing
      const sq = r.sq && now - r.sq < 220 ? Math.sin(Math.PI * (now - r.sq) / 220) : 0;
      let at = px(v, w.x, w.y), plateAt = at, plateAng = ang;
      let sledT = '', manT = '';
      if (r.wipe) {
        // the sled spins on and stops upside down; the rider tumbles ahead
        const u = clamp((r.el - r.wipe.at) / 700, 0, 1), us = clamp((r.el - r.wipe.at) / 900, 0, 1);
        const base = onTrack(g, r.wipe.x, r.wipe.d), slide = r.x - r.wipe.x;
        at = px(v, base.x, base.y);
        plateAt = px(v, base.x + slide, base.y);
        plateAng = ang = 0;
        sledT = `translate(${f1(slide / s)} 0) rotate(${f1(lerp(0, 540, smooth(us)))} 0 -6)`;
        manT = `translate(${f1(lerp(0, 70, u))} ${f1(-24 * u * (1 - u) * 2 + lerp(0, 6, u))}) rotate(${f1(lerp(0, 470, smooth(u)))} 0 -20)`;
      }
      // a tumble turns them head over heels about their middle
      const roll = r.tumble != null ? ` translate(0, -20em) rotate(${Math.round(720 * smooth(r.tumble))}deg) translate(0, 20em)` : '';
      const tf = `translate3d(${n2(at.x)}px, ${n2(at.y)}px, 0) rotate(${f1(ang)}deg) scale(${(S * (1 + sq * 0.08)).toFixed(3)}, ${(S * (1 - sq * 0.12)).toFixed(3)})${roll}`;
      if (tf !== r.tf) { r.tf = tf; r.wrap.style.transform = tf; }
      const float = r.mode === 'race' || r.mode === 'tolodge';
      if (float !== !!r.fl) { r.fl = float; r.plate.classList.toggle('float', float); r.pw = 0; r.lo = null; r.stem = null; }
      if (float) {
        // over the head: the anchor, laid out with the others below
        let vis = true, f = 1;
        if (v.cineOn) {
          vis = !!(r.cv && r.cv.vis);
          if (vis) { r.ax = r.cv.x; r.ay = r.cv.y; f = r.cv.f; }
        } else {
          r.ax = plateAt.x;
          r.ay = plateAt.y - 60 * v.gs * (0.86 + 0.26 * clamp(w.d, 0, 1)) * v.k;
        }
        if (vis !== (r.pvis !== false)) { r.pvis = vis; r.plate.style.visibility = vis ? '' : 'hidden'; }
        if (f !== r.lfF) { r.lfF = f; if (f === 1) r.plate.style.removeProperty('--lf'); else r.plate.style.setProperty('--lf', `${(v.lf * f).toFixed(1)}px`); r.pw = 0; }
        if (vis) floats.push(r);
      } else {
        if (r.pvis === false) { r.pvis = true; r.plate.style.visibility = ''; }
        const pt = `translate3d(${n2(plateAt.x)}px, ${n2(plateAt.y)}px, 0) rotate(${f1(plateAng)}deg) scale(${S.toFixed(3)})`;
        if (pt !== r.pt) { r.pt = pt; r.plate.style.transform = pt; }
      }
      if (sledT !== r.sledT) { r.sledT = sledT; r.sledg.setAttribute('transform', sledT); if (r.sledf) r.sledf.setAttribute('transform', sledT); }
      if (manT !== r.manT) { r.manT = manT; r.mang.setAttribute('transform', manT); }
      // the shadow stays on the snow
      const gw = r.wx != null ? { x: w.x, y: w.y + 2 } : onTrack(g, r.x, r.d);
      const gp = px(v, gw.x + 2, gw.y + 0.5), hs = clamp(1 - r.h / 70, 0.35, 1);
      const st = `translate3d(${n2(gp.x)}px, ${n2(gp.y)}px, 0) scale(${(S * hs).toFixed(3)})`;
      if (st !== r.st) { r.st = st; r.shadow.style.transform = st; }
      paintPose(v, r, now);
    }
    // draw order: back of the track first; the winner on top at the end
    const order = list.filter((r) => !r.wasHidden).sort((a, b) => key(a) - key(b));
    const sig = order.map((r) => r.id).join();
    if (sig !== v.order) {
      v.order = sig;
      order.forEach((r, i) => { r.wrap.style.zIndex = r.plate.style.zIndex = String(i + 1); });
    }
    paintBadges(v);
    if (floats.length) layoutLabels(v, floats);
  }
  // the leaders' places (the long race) and each finisher's, as a number on
  // their name badge
  function paintBadges(v) {
    const want = new Map((v.badges || []).map((q) => [q.r.id, q.n]));
    for (const r of v.riders.values()) {
      const n = want.get(r.id) || null;
      if (n === (r.rk || null)) continue;
      r.rk = n;
      const b = r.plate.firstChild.firstChild;
      b.textContent = n ? String(n) : '';
      if (n) r.plate.dataset.rk = String(n); else delete r.plate.dataset.rk;
      r.pw = 0;
    }
  }
  // Name badges over the sleds while they race: upright, one size, and never
  // on top of each other (lowest first; each one that would overlap one
  // already placed goes up above it, a thin stem down to its sled)
  function layoutLabels(v, list) {
    for (const r of list) if (!r.pw || r.pwV !== v.mv) { const sp = r.plate.firstChild; r.pw = sp.offsetWidth; r.ph = sp.offsetHeight; r.pwV = v.mv; }
    list.sort((a, b) => b.ay - a.ay);
    const placed = [], gap = 3;
    for (const r of list) {
      let y = r.ay, moved = true, guard = 0;
      while (moved && guard++ < 60) {
        moved = false;
        for (const q of placed) {
          if (Math.abs(r.ax - q.ax) < (r.pw + q.pw) / 2 + gap && y > q.ly - q.ph - gap && y - r.ph < q.ly + gap) { y = q.ly - q.ph - gap; moved = true; }
        }
      }
      r.ly = y;
      placed.push(r);
    }
    for (const r of list) {
      const off = r.ly - r.ay;
      r.lo = r.lo == null || r.loV !== v.mv ? off : r.lo + (off - r.lo) * 0.4;
      r.loV = v.mv;
      const stem = Math.round(Math.max(4, 4 - r.lo));
      if (stem !== r.stem) { r.stem = stem; r.plate.style.setProperty('--stem', `${stem}px`); }
      const pt = `translate3d(${n2(r.ax)}px, ${n2(r.ay)}px, 0)`;
      if (pt !== r.pt) { r.pt = pt; r.plate.style.transform = pt; }
    }
  }

  // ---------- the long race's camera: shots, cut between, held to be followed ----------
  // The short race is one steady shot. The long one cuts, cleanly (no swoops,
  // no spins), between six shots, each held at least MIN_HOLD so a sled can
  // be tracked; and none from the last bend through the line. All of it from
  // the race's own timeline, so the full screen window cuts with the page.
  //   wide    the start gate, zoomed out
  //   side    the usual side tracking camera
  //   tight   two sleds battling, zoomed in on them
  //   low     down in the snow at the big jump, the sleds flying overhead
  //   behind  over the leader's shoulder, down the course (perspective)
  //   head    head-on at the finish, the field coming at the camera
  const MIN_HOLD = 2400;
  function tauOfU(g, u) {
    let a = 0, b = 1;
    for (let i = 0; i < 32; i++) { const m = (a + b) / 2; if (uAt(g, m) < u) a = m; else b = m; }
    return (a + b) / 2;
  }
  function planShots(v) {
    const g = v.g, tm = v.tm;
    if (!g.long || !v.plan) return null;
    const race = tm.fin - tm.go, at = (u) => tm.go + race * tauOfU(g, u), C = COURSE;
    // head-on from the last bend until the last place is over the line
    let headEnd = tm.cross[tm.cross.length - 1] + 900;
    if (tm.results) headEnd = Math.min(headEnd, tm.results - 60);
    if (tm.toLodge) headEnd = Math.min(headEnd, tm.toLodge - 60);
    // the low shot from just before the jump to the last bend; the time
    // before it shared out evenly between the other four, each held at
    // least MIN_HOLD (one that can't be is dropped: the battle first)
    const head = at(C.bends[1].u1), low = at(C.jump) - 800;
    let early = ['wide', 'side', 'behind', 'tight'];
    while (early.length > 1 && low / early.length < MIN_HOLD) early.splice(early.indexOf('tight') >= 0 ? early.indexOf('tight') : early.indexOf('behind'), 1);
    const shots = early.map((type, i) => ({ type, t0: (low * i) / early.length }));
    shots.push({ type: 'low', t0: low }, { type: 'head', t0: head }, { type: 'side', t0: Math.max(head + MIN_HOLD, headEnd) });
    shots.forEach((q, i) => { q.t1 = i + 1 < shots.length ? shots[i + 1].t0 : Infinity; });
    const tight = shots.find((q) => q.type === 'tight');
    if (tight && !pickBattle(v, tight)) tight.type = 'side';
    return shots;
  }
  // the two to watch: the closest pair near the front over the shot, a swap
  // of places counting in their favour
  function pickBattle(v, sh) {
    const g = v.g, ps = [...v.plan.values()].filter((p) => !p.mw);
    const N = 8, ts = Array.from({ length: N }, (_, i) => lerp(sh.t0, sh.t1, (i + 0.5) / N));
    const xs = ps.map((p) => ts.map((t) => xAt(g, p, t)));
    const lead = ts.map((_, k) => Math.max(...xs.map((a) => a[k])));
    let best = null;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        let gap = 0, behind = 0, flips = 0, worst = 0;
        for (let k = 0; k < N; k++) {
          const d = xs[i][k] - xs[j][k];
          gap += Math.abs(d); worst = Math.max(worst, Math.abs(d));
          behind += lead[k] - Math.max(xs[i][k], xs[j][k]);
          if (k && Math.sign(d) !== Math.sign(xs[i][k - 1] - xs[j][k - 1])) flips++;
        }
        const score = gap / N + 2 * behind / N - 40 * Math.min(flips, 2);
        if (!best || score < best.score) best = { score, i, j, worst };
      }
    }
    if (!best) return false;
    sh.a = ps[best.i].r.id; sh.b = ps[best.j].r.id;
    // close enough to read the names, wide enough to keep both in
    sh.z = clamp((0.62 * g.W) / (best.worst + 160), 1.3, 1.75);
    return true;
  }
  const shotIndex = (shots, el) => { for (let i = shots.length - 1; i >= 0; i--) if (el >= shots[i].t0) return i; return 0; };
  // the scale and offsets a zoom would give (zoomNums without applying it)
  const zoomFor = (v, z) => { const cx = v.bw / 2, cy = v.bh * 0.55; return { k: v.K * z, offX: cx - (cx - v.oX) * z, offY: cy - (cy - v.oY) * z }; };
  // the camera for a 2D shot: { x, y, z } (world units at the box's corner,
  // and the zoom), or no x for the side camera / the perspective shots
  function shotCam(v, sh, el, cut) {
    const g = v.g, t = sh.type;
    if (t === 'wide') {
      // the gate a third in, the course ahead, still
      const z = 0.6, n = zoomFor(v, z), x = g.G - (0.56 * v.bw - n.offX) / n.k;
      return { type: t, x, y: camYAt(g, x) + 30, z };
    }
    if (t === 'low') {
      // in the snow just past the big jump's crest, looking up as they fly over
      const c = g.crests.find((q) => q.big) || g.crests[0], z = 1.3, n = zoomFor(v, z);
      const x0 = c.x - (0.32 * v.bw - n.offX) / n.k;
      // once the front of the pack is past the middle, it follows them on,
      // eased, still down in the snow
      const front = [...v.plan.values()].filter((p) => p.r.mode === 'race' && !p.wiped).map((p) => p.r.x).sort((p, q) => q - p).slice(0, 4);
      const fx = front.length ? front.reduce((p, q) => p + q, 0) / front.length : c.x;
      const tx = Math.max(x0, fx - (0.55 * v.bw - n.offX) / n.k);
      if (cut || !v.lc) v.lc = { x: tx, el };
      else { const a2 = 1 - Math.exp(-clamp((el - v.lc.el) / 1000, 0, 0.25) * 3); v.lc.x += (tx - v.lc.x) * a2; v.lc.el = el; }
      const wy = onTrack(g, c.x + (v.lc.x - x0), 0.5).y;
      return { type: t, x: v.lc.x, y: wy - (0.64 * v.bh - n.offY) / n.k, z };
    }
    if (t === 'tight') {
      const a = v.riders.get(sh.a), b = v.riders.get(sh.b);
      if (!a || !b) return { type: 'side' };
      const wa = worldOf(v, a), wb = worldOf(v, b), n = zoomFor(v, sh.z);
      const fx = (wa.x + wb.x) / 2, fy = (wa.y + wb.y) / 2 - 24;
      const tx = fx - (0.5 * v.bw - n.offX) / n.k, ty = fy - (0.52 * v.bh - n.offY) / n.k;
      if (cut || !v.tc) v.tc = { x: tx, y: ty, el };
      else {
        const a2 = 1 - Math.exp(-clamp((el - v.tc.el) / 1000, 0, 0.25) * 6);
        v.tc.x += (tx - v.tc.x) * a2; v.tc.y += (ty - v.tc.y) * a2; v.tc.el = el;
      }
      return { type: t, x: v.tc.x, y: v.tc.y, z: sh.z };
    }
    return { type: t };
  }
  // the two in the tight shot: their badges stand out from the others
  function setDuel(v, sh) {
    const ids = sh && sh.a ? [sh.a, sh.b] : [];
    const key = ids.join();
    if (key === (v.duel || '')) return;
    v.duel = key;
    for (const r of v.riders.values()) {
      const on = ids.includes(r.id);
      if (on !== r.plate.classList.contains('duel')) { r.plate.classList.toggle('duel', on); r.pw = 0; }
    }
  }
  function setShot(v, type) {
    if (type === v.shot) return;
    v.shot = type;
    v.el.dataset.shot = type;
    v.cineOn = type === 'behind' || type === 'head';
    v.cineType = null;
    if (!v.cineOn) v.cineFin = null;
    v.lfK = type === 'tight' ? 1.2 : (type === 'low' ? 1.15 : 1);
    sizeRiders(v);
    // a cut: the labels land on their sleds at once, no sliding across
    for (const r of v.riders.values()) { r.lo = null; r.cv = null; }
    v.order = '';
  }

  // ---------- the perspective shots: down the course, drawn on a canvas ----------
  // The side scene can't be turned round, so behind-the-leader and head-on
  // are their own simple 3D view: the course's real bends, crests and pines,
  // the sledders drawn from behind or from the front in their own colours,
  // and their HTML name badges laid out over them like the side view's.
  const CINE = {
    // high enough that a sled further down the course is higher on screen,
    // so the pack (and its badges) spreads up the picture, not into a pile
    behind: { F: 1.0, hz: 0.3, h: 230, back: 650, far: 2400, ref: 420, e: 0.8 },
    // backs down the course ahead of the leader (D), then holds past the line
    head: { F: 1.25, hz: 0.28, h: 170, D: 450, far: 3000, ref: 900, e: 0.45 },
  };
  const CINE_SEG = 20;
  const CINE_COLS = ['sky-1', 'sky-2', 'sky-3', 'mtn-far', 'mtn', 'mtn-snow', 'ridge', 'snow', 'snow-2', 'snow-3', 'track', 'groove',
    'pine', 'pine-d', 'pine-f', 'trunk', 'banner', 'banner-ink', 'check-a', 'check-b', 'pole', 'line', 'shadow', 'fur', 'goggle',
    'metal', 'cheek', 'mouth', 'boot', 'gold', 'label'];
  function cineColors(v) {
    if (v.cc) return v.cc;
    const cs = v.doc.defaultView.getComputedStyle(v.el), c = {};
    const get = (n) => cs.getPropertyValue(`--sr-${n}`).trim() || '#888';
    for (const n of CINE_COLS) c[n] = get(n);
    for (const [p, m] of [['c', 8], ['p', 4], ['h', 6], ['s', 6], ['k', 5], ['m', 4], ['q', 5], ['w', 3]]) for (let i = 0; i < m; i++) c[p + i] = get(p + i);
    c.font = cs.getPropertyValue('--font-body').trim() || 'sans-serif';
    // the distant ranges, seeded so every window draws the same
    const rnd = seeded(77);
    c.mtnA = Array.from({ length: 14 }, () => rnd());
    c.mtnB = Array.from({ length: 20 }, () => rnd());
    return (v.cc = c);
  }
  const hwAt = (g, x) => 185 * depAt(g, x) / DEPTH;     // the track's half width, in the 3D view
  function drawCine(v, now) {
    const g = v.g, bw = v.bw, bh = v.bh, ctx = v.cine.getContext('2d');
    const el = v.race ? Date.now() - v.race.startedAt : 0;
    const cut = v.cineType !== v.shot;
    v.cineType = v.shot;
    const head = v.shot === 'head', P = head ? CINE.head : CINE.behind, dir = head ? -1 : 1;
    const F = P.F * bh, hz = P.hz * bh, ch = P.h, c = cineColors(v);
    // the camera: head-on, past where they stop, looking up the course;
    // behind, over the leader's shoulder, eased after them
    let cx, clat = 0, lead = null;
    for (const p of v.plan.values()) { const r = p.r; if (r.mode === 'race' && !p.wiped && r.tumble == null && (!lead || r.x > lead.x)) lead = r; }
    {
      const hold = g.L + Math.max(160, 0.58 * g.W - g.LW - 46) + 100;
      const tx = head ? Math.min(hold, lead ? lead.x + P.D : hold) : (lead ? lead.x - P.back : v.bc ? v.bc.x : g.G);
      const tl = lead && !head ? (lead.d - 0.5) * 2 * hwAt(g, lead.x) * 0.82 * 0.5 : 0;
      if (cut || !v.bc) v.bc = { x: tx, lat: tl, el };
      else {
        const a = 1 - Math.exp(-clamp((el - v.bc.el) / 1000, 0, 0.25) * 5);
        v.bc.x += (tx - v.bc.x) * a; v.bc.lat += (tl - v.bc.lat) * a * 0.5; v.bc.el = el;
      }
      cx = v.bc.x; clat = v.bc.lat;
    }
    // the course ahead of the camera, a strip at a time: its bend (as a
    // sideways drift), its rise and fall against the slope under the camera
    const n = Math.ceil(P.far / CINE_SEG) + 1, sx0 = surfAt(g, cx);
    const ref = (surfAt(g, cx + dir * P.ref) - sx0) / (dir * P.ref);
    const dz = new Float32Array(n), wx = new Float32Array(n), off = new Float32Array(n), e = new Float32Array(n), hw = new Float32Array(n);
    let o = 0, dO = 0;
    for (let i = 0; i < n; i++) {
      const d = CINE_SEG * (i + 1), x = cx + dir * d;
      if (i) { dO += bendAt(g, x) * 0.0011 * dir * CINE_SEG; o += dO * CINE_SEG; }
      dz[i] = d; wx[i] = x; off[i] = o; hw[i] = hwAt(g, x);
      e[i] = (surfAt(g, x) - sx0 - ref * (x - cx)) * P.e;
    }
    const at = (d) => {
      const f = clamp(d / CINE_SEG - 1, 0, n - 1), i = Math.floor(f), j = Math.min(n - 1, i + 1), u = f - i;
      return { off: lerp(off[i], off[j], u), e: lerp(e[i], e[j], u), hw: lerp(hw[i], hw[j], u) };
    };
    const scr = (d, lat, q = at(d)) => { const s = F / d; return { x: bw / 2 + (q.off + lat - clat) * s, y: hz + (ch + q.e) * s, s }; };
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    // the sky, two far ranges, a far snowfield
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, c['sky-1']); sky.addColorStop(0.7, c['sky-2']); sky.addColorStop(1, c['sky-3']);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, bw, hz + 1);
    const range = (pts, amp, col, shift) => {
      ctx.beginPath(); ctx.moveTo(0, hz + 1);
      const m = pts.length;
      for (let i = 0; i <= m; i++) {
        const x = (i / m) * (bw + 200) - 100 + shift;
        ctx.lineTo(x, hz - amp * (0.35 + 0.65 * pts[i % m]));
      }
      ctx.lineTo(bw, hz + 1); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    };
    range(c.mtnA, bh * 0.2, c['mtn-far'], -clat * 0.05);
    range(c.mtnB, bh * 0.11, c.mtn, -clat * 0.1);
    ctx.fillStyle = c['snow-2']; ctx.fillRect(0, hz, bw, bh - hz);
    const quad = (x1, y1, x2, y2, x3, y3, x4, y4, col) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
    // the ground and the track, far to near
    // (far off a strip is under a pixel: two or four at a time there)
    for (let a = n - 1, b; a > 0; a = b) {
      b = Math.max(0, a - (dz[a] > 1600 ? 4 : (dz[a] > 800 ? 2 : 1)));
      const sa = F / dz[a], sb = F / dz[b];
      const ya = hz + (ch + e[a]) * sa, yb = hz + (ch + e[b]) * sb;
      if (yb <= ya || ya > bh) continue;          // the far side of a crest, or off the bottom
      const xa = bw / 2 + (off[a] - clat) * sa, xb = bw / 2 + (off[b] - clat) * sb;
      const wa = hw[a] * sa, wb = hw[b] * sb, alt = Math.floor(wx[b] / 90) & 1;
      ctx.fillStyle = alt ? c.snow : c['snow-2'];
      ctx.fillRect(0, ya - 0.5, bw, yb - ya + 1);
      quad(xa - wa * 1.2, ya, xa + wa * 1.2, ya, xb + wb * 1.2, yb, xb - wb * 1.2, yb, alt ? c['snow-3'] : c['snow-2']);
      quad(xa - wa, ya, xa + wa, ya, xb + wb, yb, xb - wb, yb, c.track);
      if (alt) for (const l of [-0.34, 0.34]) quad(xa + (l - 0.012) * wa, ya, xa + (l + 0.012) * wa, ya, xb + (l + 0.012) * wb, yb, xb + (l - 0.012) * wb, yb, c.groove);
      // the finish line: two rows of checks across the track
      if ((wx[a] - g.L) * (wx[b] - g.L) <= 0) {
        const N = 12;
        for (let k = 0; k < N; k++) for (let r2 = 0; r2 < 2; r2++) {
          const l0 = -1 + (2 * k) / N, l1 = l0 + 2 / N, y0 = lerp(ya, yb, r2 / 2), y1 = lerp(ya, yb, (r2 + 1) / 2);
          const x0 = lerp(xa, xb, r2 / 2), x1 = lerp(xa, xb, (r2 + 1) / 2), w0 = lerp(wa, wb, r2 / 2), w1 = lerp(wa, wb, (r2 + 1) / 2);
          quad(x0 + l0 * w0, y0, x0 + l1 * w0, y0, x1 + l1 * w1, y1, x1 + l0 * w1, y1, (k + r2) & 1 ? c['check-a'] : c['check-b']);
        }
      }
    }
    // what stands on it: pines, banners, sledders, drawn far to near
    const items = [];
    const xLo = Math.min(cx + dir * 30, cx + dir * P.far), xHi = Math.max(cx + dir * 30, cx + dir * P.far);
    const T = COURSE.tunnel, CELL = 70;
    for (let k = Math.floor(xLo / CELL); k <= Math.ceil(xHi / CELL); k++) {
      for (const sd of [-1, 1]) for (const row of [0, 1]) {
        const hh = Math.imul((k * 4 + (sd > 0 ? 1 : 0) + row * 2) ^ 0x5bd1e995, 2654435761) >>> 0;
        const x = k * CELL + (hh >>> 16) % 60;
        if (x < g.G - 260 || x > g.XMAX) continue;
        const u = (x - g.G) / g.span, tun = u > T.u0 && u < T.u1;
        if (row && !tun) continue;
        if (hh % 100 >= (tun ? 92 : 34)) continue;
        const d = (x - cx) * dir;
        if (d < 30 || d > P.far) continue;
        const q = at(d), lat = sd * (q.hw * 1.2 + (tun ? 10 + row * 55 + (hh >>> 8) % 30 : 30 + (hh >>> 8) % 280));
        const h = (tun ? 150 : 110) * (0.75 + ((hh >>> 20) % 50) / 100);
        items.push({ d, f: () => { const p = scr(d, lat, q); if (p.y < 0 || p.x < -p.s * 60 || p.x > bw + p.s * 60) return; cinePine(ctx, c, p.x, p.y, p.s, h); } });
      }
    }
    for (const [x, text] of [[g.L, 'FINISH'], [g.G + COURSE.final * g.span, 'FINAL STRETCH']]) {
      const d = (x - cx) * dir;
      if (d > 230 && d < P.far) items.push({ d, f: () => { ctx.globalAlpha = smooth((d - 230) / 200); cineBanner(ctx, c, scr(d, 0), at(d).hw, text); ctx.globalAlpha = 1; } });
    }
    if (head) { const d = cx - g.L, p = scr(d, 0); v.cineFin = { x: p.x, y: p.y - 20 * p.s }; }
    for (const p of v.plan.values()) {
      const r = p.r;
      r.cv = { vis: false };
      if (r.mode !== 'race') continue;
      const d = (r.x - cx) * dir;
      if (d < 55 || d > P.far) continue;
      const q = at(d), lat = (r.d - 0.5) * 2 * q.hw * 0.82 * dir, sp = scr(d, lat, q);
      if (sp.x < -80 || sp.x > bw + 80 || sp.y < 0 || sp.y - 70 * sp.s > bh) continue;
      const prevF = r.cvF || 1, f = sp.s > (prevF >= 1.3 ? 2.1 : 2.4) ? 1.3 : (sp.s > (prevF >= 1.15 ? 1.15 : 1.35) ? 1.15 : (sp.s < (prevF < 1 ? 0.6 : 0.5) ? 0.85 : 1));
      r.cvF = f;
      r.cv = { vis: true, x: sp.x, y: sp.y - ((r.h || 0) + 60) * sp.s, f };
      items.push({ d, f: () => cineRider(v, ctx, c, r, sp.x, sp.y, sp.s, dir, now) });
    }
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.f();
  }
  function cinePine(ctx, c, x, y, s, h) {
    const w = h * 0.46 * s, H = h * s;
    ctx.fillStyle = c.trunk; ctx.fillRect(x - w * 0.07, y - H * 0.12, w * 0.14, H * 0.13);
    for (let t = 0; t < 3; t++) {
      const yb = y - H * (0.1 + t * 0.26), yt = yb - H * 0.42, ww = w * (1 - t * 0.26);
      ctx.beginPath(); ctx.moveTo(x - ww, yb); ctx.lineTo(x, yt); ctx.lineTo(x + ww, yb); ctx.closePath(); ctx.fillStyle = c.pine; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, yt); ctx.lineTo(x + ww, yb); ctx.lineTo(x + ww * 0.15, yb); ctx.closePath(); ctx.fillStyle = c['pine-d']; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - ww * 0.42, yt + (yb - yt) * 0.42); ctx.lineTo(x, yt); ctx.lineTo(x + ww * 0.42, yt + (yb - yt) * 0.42);
      ctx.lineTo(x + ww * 0.12, yt + (yb - yt) * 0.36); ctx.lineTo(x - ww * 0.14, yt + (yb - yt) * 0.44); ctx.closePath(); ctx.fillStyle = c.snow; ctx.fill();
    }
  }
  function cineBanner(ctx, c, p, hw, text) {
    const s = p.s, xl = p.x - (hw * 1.25) * s, xr = p.x + (hw * 1.25) * s, top = p.y - 150 * s, bh2 = 30 * s;
    ctx.fillStyle = c.pole;
    ctx.fillRect(xl - 3 * s, top, 6 * s, 150 * s); ctx.fillRect(xr - 3 * s, top, 6 * s, 150 * s);
    ctx.fillStyle = c.banner; ctx.fillRect(xl, top, xr - xl, bh2);
    const N = Math.max(6, Math.round((xr - xl) / (8 * s)));
    for (let k = 0; k < N; k++) { ctx.fillStyle = k & 1 ? c['check-a'] : c['check-b']; ctx.fillRect(xl + (k * (xr - xl)) / N, top + bh2, (xr - xl) / N + 0.5, 5 * s); }
    const fs = bh2 * 0.72;
    if (fs < 5) return;
    ctx.fillStyle = c['banner-ink']; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${fs.toFixed(1)}px ${c.font}`;
    ctx.fillText(text, p.x, top + bh2 * 0.54, (xr - xl) * 0.9);
  }
  // a sledder seen from behind (dir 1) or from the front (dir −1), in their
  // own colours; units are about the side view's
  function cineRider(v, ctx, c, r, X, Y, s, dir, now) {
    const lk = r.lk, front = dir < 0, g = v.g;
    const lift = (r.h || 0) * s, line = c.line;
    ctx.globalAlpha = clamp(1 - (r.h || 0) / 90, 0.3, 0.9);
    ctx.fillStyle = c.shadow; ctx.beginPath(); ctx.ellipse(X, Y, 27 * s, 6 * s, 0, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(X, Y - lift + Math.sin(now / 85 + lk.ph * 30) * 0.7 * s);
    let rot = -bendAt(g, r.x) * 0.16 * dir;
    if (r.tumble != null) rot += 6.2832 * smooth(r.tumble) * dir;
    if (r.wipe) rot += 1.2;
    ctx.rotate(rot); ctx.scale(s, s);
    ctx.lineWidth = 1.3; ctx.strokeStyle = line; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const col = (p, i) => c[p + i];
    const wood = lk.sled === 'tob' || lk.sled === 'run', sledCol = wood ? col('w', lk.wood) : col('q', lk.sledc);
    const ell = (x, y, rx, ry, fill, stroke = true) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832); ctx.fillStyle = fill; ctx.fill(); if (stroke) ctx.stroke(); };
    if (r.placeK != null) { ctx.globalAlpha = 0.35; ell(0, -28, 36, 36, c.gold, false); ctx.globalAlpha = 1; }
    // the sled under them
    if (lk.sled === 'tube') ell(0, -6, 26, 10, sledCol);
    else if (lk.sled === 'sau') ell(0, -4, 25, 7, sledCol);
    else {
      if (lk.sled === 'run') { ctx.strokeStyle = c.metal; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-13, -1); ctx.lineTo(-13, -6); ctx.moveTo(13, -1); ctx.lineTo(13, -6); ctx.stroke(); ctx.lineWidth = 1.3; ctx.strokeStyle = line; }
      ctx.beginPath(); ctx.roundRect(-17, -11, 34, 7, 2); ctx.fillStyle = sledCol; ctx.fill(); ctx.stroke();
    }
    // legs toward the camera (head-on)
    if (front) {
      for (const sx of [-1, 1]) {
        ctx.beginPath(); ctx.roundRect(sx * 7 - 4.5, -16, 9, 12, 3); ctx.fillStyle = col('p', lk.pants); ctx.fill(); ctx.stroke();
        ell(sx * 7, -4, 5, 3.4, c.boot);
      }
    }
    // the coat
    ctx.beginPath(); ctx.moveTo(-12, -33); ctx.quadraticCurveTo(-13.5, -20, -10.5, -9); ctx.lineTo(10.5, -9); ctx.quadraticCurveTo(13.5, -20, 12, -33);
    ctx.quadraticCurveTo(0, -37, -12, -33); ctx.closePath(); ctx.fillStyle = col('c', lk.coat); ctx.fill(); ctx.stroke();
    if (lk.stripe) { ctx.fillStyle = col('c', lk.coat2); ctx.fillRect(-12.6, -24, 25.2, 4); }
    // arms, by pose
    const pose = r.pose, mit = col('m', lk.mitt);
    const hand = pose === 'cheer' ? [17, -54] : (pose === 'air' || pose === 'wipe' ? [27, -32 + Math.sin(now / 60) * 3] : [16, -12]);
    ctx.lineWidth = 6.5; ctx.strokeStyle = line;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 10.5, -31); ctx.lineTo(sx * hand[0], hand[1]); ctx.stroke(); }
    ctx.lineWidth = 4.2; ctx.strokeStyle = col('c', lk.coat);
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 10.5, -31); ctx.lineTo(sx * hand[0], hand[1]); ctx.stroke(); }
    ctx.lineWidth = 1.3; ctx.strokeStyle = line;
    for (const sx of [-1, 1]) ell(sx * hand[0], hand[1], 3.6, 3.6, mit);
    // the front of the tube, over their lap
    if (lk.sled === 'tube' && front) { ctx.beginPath(); ctx.ellipse(0, -6, 26, 10, 0, 0.15, 3.0); ctx.lineWidth = 7; ctx.strokeStyle = sledCol; ctx.stroke(); ctx.lineWidth = 1.3; ctx.strokeStyle = line; }
    if (lk.sled === 'tob' && front) { ctx.beginPath(); ctx.arc(0, -15, 15, Math.PI * 1.1, Math.PI * 1.9); ctx.lineWidth = 5; ctx.strokeStyle = sledCol; ctx.stroke(); ctx.lineWidth = 1.3; ctx.strokeStyle = line; }
    // scarf, and its tails in the wind
    const sc = col('s', lk.scarf);
    ctx.beginPath(); ctx.roundRect(-9.5, -36.5, 19, 5, 2.4); ctx.fillStyle = sc; ctx.fill(); ctx.stroke();
    const fl = Math.sin(now / 70 + lk.ph * 20) * 3;
    ctx.beginPath(); ctx.moveTo(4, -34); ctx.quadraticCurveTo(12, front ? -30 : -40 + fl, 18, front ? -24 : -38 - fl);
    ctx.lineWidth = 4; ctx.strokeStyle = sc; ctx.stroke(); ctx.lineWidth = 1.3; ctx.strokeStyle = line;
    // the head, the face (head-on), the hat
    ell(0, -44, 9.6, 9.6, col('k', lk.skin));
    if (front) {
      if (lk.goggles) { ctx.beginPath(); ctx.roundRect(-8, -48, 16, 5.2, 2.4); ctx.fillStyle = c.goggle; ctx.fill(); ctx.stroke(); }
      else { ctx.fillStyle = line; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * 3.4, -45, 1.3, 0, 6.2832); ctx.fill(); } }
      ctx.globalAlpha = 0.6; ctx.fillStyle = c.cheek; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * 5.6, -41.5, 1.9, 0, 6.2832); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      if (pose === 'cheer' || pose === 'air' || r.wipe) { ctx.ellipse(0, -39.6, 2.2, 1.8, 0, 0, 6.2832); ctx.fillStyle = c.mouth; ctx.fill(); }
      else { ctx.arc(0, -41, 2.6, 0.3, 2.84); ctx.stroke(); }
    }
    const hat = col('h', lk.hatc), low = front ? -46 : -41.5;
    ctx.beginPath(); ctx.moveTo(-10.2, low); ctx.quadraticCurveTo(-10.6, -57, 0, -56.8); ctx.quadraticCurveTo(10.6, -57, 10.2, low); ctx.closePath();
    ctx.fillStyle = hat; ctx.fill(); ctx.stroke();
    if (lk.hat === 'trapper') for (const sx of [-1, 1]) ell(sx * 9.6, low + 3, 3.2, 5.4, hat);
    if (lk.hat !== 'helmet') { ctx.beginPath(); ctx.roundRect(-10.6, low - 2.4, 21.2, 3.6, 1.6); ctx.fillStyle = lk.hat === 'trapper' ? c.fur : hat; ctx.fill(); ctx.stroke(); }
    if (lk.hat === 'bobble') ell(0, -58.5, 3.8, 3.8, col('h', lk.pom));
    ctx.restore();
  }

  // ---------- the running order ----------
  // a strip down the left: everyone's name in race order, the numbers fixed
  // and the names moving between them, so a student can find their name and
  // watch it climb even when they lose their sled in the pack
  function buildBoard(v) {
    const ol = v.lb.firstChild;
    ol.textContent = '';
    v.lbRows = new Map();
    const list = [...v.plan.values()].map((p) => p.r);
    for (const r of list) {
      const li = v.doc.createElement('li');
      const n = v.doc.createElement('b'), t = v.doc.createElement('span');
      t.textContent = r.label.length > 12 ? `${r.label.slice(0, 11).trimEnd()}…` : r.label;
      li.title = r.label;
      li.append(n, t);
      ol.appendChild(li);
      v.lbRows.set(r.id, li);
    }
    v.lbOrder = [];
    v.lbAt = null;
    placeBoard(v);
    boardStep(v, true);
  }
  // as many rows as fit the scene's height: two columns past 14
  function placeBoard(v) {
    const n = v.lbRows.size;
    if (!n || !v.bh) return;
    const cols = n > 14 ? 2 : 1, rows = Math.ceil(n / cols);
    const top = v.bh * 0.035 + 30, availH = v.bh - top - v.bh * 0.04;
    const rh = Math.max(11, Math.min(v.bh * 0.046, (availH - 10) / rows));
    const fs = rh * 0.72;
    const longest = Math.max(4, ...[...v.lbRows.values()].map((li) => li.lastChild.textContent.length));
    const cw = fs * (longest * 0.52 + 3.4);
    const st = v.lb.style;
    st.setProperty('--rh', `${rh.toFixed(1)}px`);
    st.setProperty('--fs', `${fs.toFixed(1)}px`);
    st.setProperty('--cw', `${cw.toFixed(1)}px`);
    st.top = `${top.toFixed(1)}px`;
    st.width = `${(cw * cols).toFixed(1)}px`;
    st.height = `${(rh * rows).toFixed(1)}px`;
    v.lbRowsN = rows;
    v.lbOrder = [];
  }
  function boardStep(v, snap = false) {
    if (!v.plan || !v.lbRows.size) return;
    const g = v.g;
    const score = (p) => (p.r.x < g.L ? p.r.x : g.L + 1e5 - p.gap);
    const ps = [...v.plan.values()].sort((a, b) => score(b) - score(a));
    // two within a sled's length keep the order they had (no flicker)
    const prev = new Map(v.lbOrder.map((id, i) => [id, i]));
    for (let i = 0; i + 1 < ps.length; i++) {
      const a = ps[i], b = ps[i + 1];
      if (Math.abs(score(a) - score(b)) < 22 && prev.has(a.r.id) && prev.has(b.r.id) && prev.get(b.r.id) < prev.get(a.r.id)) { ps[i] = b; ps[i + 1] = a; }
    }
    const ids = ps.map((p) => p.r.id);
    const rows = v.lbRowsN || ids.length;
    ids.forEach((id, i) => {
      const li = v.lbRows.get(id);
      if (!li) return;
      const p = v.plan.get(id), done = p.r.x >= g.L;
      const cls = `${i < 3 ? `p${i + 1}` : ''}${done ? ' done' : ''}`;
      if (li.className !== cls) li.className = cls;
      if (prev.get(id) === i && !snap) return;
      li.firstChild.textContent = String(i + 1);
      li.style.transform = `translate(calc(var(--cw) * ${Math.floor(i / rows)}), calc(var(--rh) * ${i % rows}))`;
      // a name changing column jumps there (sliding, it would cross the others)
      const was = prev.get(id);
      if (snap || was == null || Math.floor(was / rows) !== Math.floor(i / rows)) { li.style.transition = 'none'; void li.offsetWidth; li.style.transition = ''; }
    });
    v.lbOrder = ids;
  }
  // in bands, so small depth wobbles don't reshuffle the nodes every frame
  // (moving a sledder's subtree restyles it)
  const key = (r) => (r.mode === 'hop' || r.mode === 'tolodge' ? 5 : 0) + (r.placeK != null ? 4 - r.placeK * 0.1 : 0) + Math.round((r.wx != null ? r.wd : r.d) * 14) / 14;
  function paintPose(v, r, now) {
    let arms = 'rest', lean = 3, face = 'n', scarf = 58, spray = 0;
    const t = now / 1000 + r.lk.ph * 20;
    switch (r.pose) {
      case 'idle': arms = r.scarfFix ? 'scarf' : 'rest'; lean = r.lean || 3; scarf = r.scarfRot || 58; break;
      case 'crouch': arms = 'grip'; lean = 24; scarf = 40; break;
      case 'ride': arms = r.lk.style; lean = r.lk.style === 'lean' ? 22 : 8; scarf = -6 + 7 * Math.sin(t * 24); spray = 1; break;
      case 'air': arms = 'out'; lean = -8; face = 'y'; scarf = -14 + 6 * Math.sin(t * 30); break;
      case 'cheer': arms = 'up'; lean = -4; face = 'y'; scarf = 20 + 10 * Math.sin(t * 12); spray = r.speed > 200 ? 0.6 : 0; break;
      case 'stand': arms = 'rest'; lean = 0; scarf = 50; break;
      case 'wipe': arms = 'flail'; lean = 0; face = 'x'; scarf = -30; break;
      case 'dizzy': arms = 'grip'; lean = 10; face = 'x'; scarf = -6 + 7 * Math.sin(t * 24); spray = 1; break;
      case 'hop': arms = 'out'; lean = -2; face = 'y'; scarf = 30 + 14 * Math.sin(t * 14); break;
      default: break;
    }
    // inside the drawing (each change repaints it): a new pose at once, the
    // flutter and the lean at most ~15 times a second
    const posed = arms !== r.arms || face !== r.face;
    if (arms !== r.arms) { r.arms = arms; r.g.dataset.arms = arms; }
    if (face !== r.face) { r.face = face; r.g.dataset.face = face; }
    if (posed || now - r.pAt > 66) {
      r.pAt = now;
      const upT = `rotate(${Math.round(lean)})`;
      if (upT !== r.upT) { r.upT = upT; r.up.setAttribute('transform', upT); }
      const sc = `translate(-3 -19.4) rotate(${Math.round(scarf / 2) * 2})`;
      if (sc !== r.scT) { r.scT = sc; r.scarfT.setAttribute('transform', sc); if (r.hatT) r.hatT.setAttribute('transform', `rotate(${f1((scarf - 40) * 0.4)} 0 -33)`); }
    }
    // snow spray behind the sled (a CSS loop, switched on and off) and speed
    // lines on the fastest, from the speed
    const sp = r.speed || 0;
    const on = spray * clamp(sp / 300, 0, 1) > 0.3 && (!v.quiet || r.rk != null);
    if (on !== !!r.spraying) { r.spraying = on; r.wrap.classList.toggle('spray', on); }

  }
  function puff(v, r) {
    if (calm(v.doc)) return;
    const w = worldOf(v, r), c = svgEl(v.doc, 'g', 'sr-puff');
    c.setAttribute('transform', `translate(${f1(w.x)} ${f1(w.y)}) scale(${v.gs.toFixed(2)})`);
    c.innerHTML = '<circle cx="-14" cy="-2" r="6"/><circle cx="0" cy="-1" r="7"/><circle cx="14" cy="-2" r="6"/><circle cx="-24" cy="-1" r="4"/><circle cx="24" cy="-1" r="4"/>';
    v.fx.appendChild(c);
    setTimeout(() => c.remove(), 600);
  }
  function bonkFx(v, r) {
    if (calm(v.doc)) return;
    const w = worldOf(v, r), c = svgEl(v.doc, 'g', 'sr-bonk');
    c.setAttribute('transform', `translate(${f1(w.x)} ${f1(w.y - 30 * v.gs)})`);
    c.innerHTML = '<path d="M0-9L2.4-2.6L9-2.4L3.8 1.6L5.6 8L0 4.2L-5.6 8L-3.8 1.6L-9-2.4L-2.4-2.6Z"/>';
    v.fx.appendChild(c);
    setTimeout(() => c.remove(), 500);
  }

  // ---------- the pick ----------
  function run(doc, s, { sound = false } = {}) {
    const v = views.get(doc);
    if (!v || !v.g) return;
    // a pick during the sweep back: everyone's at the top already
    if (v.race && !v.done.has('reset')) resetToTop(v);
    // the long course or the short one (the descriptor says which)
    if (!!s.long !== !!v.g.long) { v.long = !!s.long; layout(v); }
    for (const r of v.riders.values()) {
      unplace(r);
      if (r.mode === 'hop') { r.mode = 'grid'; r.wx = null; r.hop0 = null; r.hidden = false; }
      if (r.mode === 'grid') { r.x = r.hx; r.d = r.hd; r.jx = 0; r.jy = 0; r.mode = 'race'; }
    }
    hideName(v);
    hideResults(v);
    v.winner = null;
    v.entering = new Set();
    v.tm = times(s);
    v.badges = []; v.rank = [];
    v.race = s;
    v.active = s;
    v.raceCam = v.g.rest.x;
    v.camS = null;
    v.done = new Set();
    v.sound = sound && !isPopout(v);
    v.lodgeBound = !!v.picked;
    v.plan = makePlan(v, s);
    v.shots = planShots(v); v.shotI = -1; v.bc = null;
    buildBoard(v);
    v.el.dataset.state = 'racing';
    v.el.setAttribute('aria-disabled', 'true');
  }
  function finish(doc, s, { respawn = false } = {}) {
    const v = views.get(doc);
    if (!v || !v.g) return;
    if (!v.race || v.race.startedAt !== s.startedAt) {
      if (!!s.long !== !!v.g.long) { v.long = !!s.long; layout(v); }
      v.race = s; v.tm = times(s); v.done = new Set(); v.plan = makePlan(v, s); v.shots = planShots(v); v.shotI = -1; v.bc = null; v.lodgeBound = !!v.picked; v.camS = null; buildBoard(v);
    }
    const el = Date.now() - s.startedAt, tm = v.tm;
    v.sound = false;
    if (v.plan && el < tm.back) raceStep(v, Math.max(el, tm.last + 1), performance.now());
    // anyone not announced yet (a window that missed frames)
    (v.places || []).forEach((id, k) => { const p = v.plan && v.plan.get(id); if (p && !v.done.has(`line:${k}`)) { v.done.add(`line:${k}`); crossLine(v, p.r, k); } });
    if (respawn) v.lodgeBound = false;
    if (respawn) {
      // No repeats is off: back out of the lodge and up the hill
      (v.places || []).forEach((id, k) => {
        const r = v.riders.get(id);
        if (!r || (r.mode !== 'lodge' && r.mode !== 'tolodge')) return;
        r.mode = 'hop'; r.hopFrom = doorWorld(v); r.hopAt = performance.now() + 300 + k * 90; r.hop0 = null; r.wx = null;
        v.inLodge.delete(id); v.entering.delete(id);
      });
      renderLodge(v);
    }
    v.active = null;
    setDisabled(doc, v.off);
    paintCount(v);
  }
  function setWinner(doc, name, state) {
    const v = views.get(doc);
    if (!v) return;
    if (!name && !state && !v.active) { v.el.dataset.state = ''; hideName(v); hideResults(v); }
  }
  // the teacher changed the race (wheel.js): draw the course now, between
  // races, so a pick doesn't wait for it
  function setRace(doc, r) {
    const v = views.get(doc);
    if (!v) return;
    const long = !!r && r.length === 'long';
    if (long === !!v.long) return;
    v.long = long;
    if (!v.race && isOn(doc)) layout(v);
  }
  function setDisabled(doc, off) {
    const v = views.get(doc);
    if (!v) return;
    v.off = !!off;
    v.el.setAttribute('aria-disabled', String(v.off || !!v.active || busy(doc)));
    paintPour(v);
  }
  const busy = (doc) => { const v = views.get(doc); return !!v && v.pouring; };

  // ---------- the name, large, with snow and confetti ----------
  function showName(v, label, place = '') {
    v.name.lastChild.textContent = label || '';
    v.name.firstChild.textContent = place;
    v.name.firstChild.hidden = !place;
    v.name.title = label || '';
    placeName(v);
    v.name.classList.remove('go'); void v.name.offsetWidth; v.name.classList.add('go');
  }
  function placeName(v) {
    const label = v.name.title || '';
    const longest = Math.max(4, ...label.split(/\s+/).map((w) => w.length));
    const room = (v.g.W - v.g.LW - 40) * v.K;
    let size = Math.min(64, 560 / (longest * 0.56)) * v.K;
    size = Math.min(size, room / (Math.max(4, label.length) * 0.56 + 1.4));
    const p = toPx(v, (v.g.W - v.g.LW) / 2, 58);
    v.name.style.setProperty('--fs', `${size.toFixed(1)}px`);
    v.name.style.left = `${p.x.toFixed(1)}px`;
    v.name.style.top = `${Math.max(6, p.y - size * 0.6).toFixed(1)}px`;
  }
  function hideName(v) {
    v.name.classList.remove('go');
    v.name.title = '';
  }
  // all the places, numbered, large: replaces the name once the last is in
  function showResults(v) {
    const list = (v.places || []).map((id) => v.riders.get(id)).filter(Boolean);
    if (list.length < 2) return;
    hideName(v);
    const ol = v.results.firstChild;
    ol.textContent = '';
    list.forEach((r, k) => {
      const li = v.doc.createElement('li');
      li.className = `p${k + 1}`;
      li.style.setProperty('--i', String(k));
      const n = v.doc.createElement('b');
      n.textContent = String(k + 1);
      const t = v.doc.createElement('span');
      t.textContent = r.label;
      li.title = r.label;
      li.append(n, t);
      ol.appendChild(li);
    });
    v.shownResults = list.map((r) => r.label);
    placeResults(v);
    v.results.classList.remove('go'); void v.results.offsetWidth; v.results.classList.add('go');
  }
  // as large as fits: every row in the box's height, the longest name in the
  // width left of the lodge
  function placeResults(v) {
    const names = v.shownResults || [];
    if (!names.length || !v.g) return;
    const n = names.length;
    const availH = v.bh * 0.84, availW = (v.g.W - v.g.LW - 30) * v.K;
    const longest = Math.max(4, ...names.map((s) => s.length));
    let fs = Math.min(availH / (n * 1.32 + 0.6), v.bh * 0.11);
    fs = Math.min(fs, availW / (longest * 0.54 + 3.2));
    fs = Math.max(fs, 14);
    const cx = toPx(v, (v.g.W - v.g.LW) / 2, 0).x;
    v.results.style.setProperty('--fs', `${fs.toFixed(1)}px`);
    v.results.style.left = `${cx.toFixed(1)}px`;
    v.results.style.top = `${(v.bh * 0.5).toFixed(1)}px`;
  }
  function hideResults(v) {
    v.results.classList.remove('go');
    v.shownResults = null;
  }
  function fireBurst(el, html) {
    el.innerHTML = html;
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('go'), 1900);
  }
  function snowBurst(k, n, confetti) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5, d = (60 + Math.random() * 150) * k;
      const sz = (3 + Math.random() * 6) * k;
      const c = confetti && i % 2 ? ` class="cf c${i % 6}"` : '';
      s += `<i${c} style="--dx:${(Math.cos(a) * d * 1.3).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;--fall:${((50 + Math.random() * 80) * k).toFixed(1)}px;--s:${sz.toFixed(1)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;--d:${(i % 6) * 30}ms"></i>`;
    }
    return s;
  }

  // ---------- the lodge: everyone called this round, with cocoa ----------
  function renderLodge(v) {
    if (!v.guests) return;
    const ids = (v.picked || []).map((p) => p.id);
    const list = (v.picked || []).slice();
    for (const id of v.entering) if (!ids.includes(id) && v.riders.has(id)) list.push({ id, label: v.riders.get(id).label });
    const total = Math.max(v.total, list.length, 1);
    // seats: the biggest guests that give everyone in the round a place,
    // in rows that overlap (the back row peeks over the front one): the two
    // big windows first, front rows first, then the loft
    const wins = [LOD.w1, LOD.w2, LOD.loft];
    const grid = (w, c) => { const cols = Math.max(0, Math.floor(w.w / (0.8 * c))), rows = Math.max(0, Math.floor((w.h - 3 - 1.1 * c) / (0.6 * c)) + 1); return { cols, rows }; };
    let cell = 40;
    const seats = (c) => wins.reduce((n, w) => { const q = grid(w, c); return n + q.cols * q.rows; }, 0);
    while (cell > 7 && seats(cell) < total) cell -= 0.5;
    const spots = [];
    const fill = (w) => {
      const { cols, rows } = grid(w, cell), ox = w.x + (w.w - cols * 0.8 * cell) / 2;
      const out = [];
      for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) out.push({ x: ox + 0.8 * cell * (c + 0.5) + (rr % 2 ? 0.2 * cell : 0) * (c < cols - 1 ? 1 : -1), y: w.y + w.h - 2 - 0.6 * cell * rr, row: rr });
      return out;
    };
    spots.push(...[...fill(LOD.w1), ...fill(LOD.w2)].sort((p, q) => p.row - q.row || p.x - q.x), ...fill(LOD.loft));
    const k = cell / 22;
    const parts = [];
    list.forEach((p, j) => {
      const sp = spots[j];
      if (!sp) return;
      let s = '';
      const lk = lookOf(p.id);
      s += `<g class="sr-guest${v.entering.has(p.id) ? ' new' : ''}" style="${riderStyle(lk)}" transform="translate(${f1(sp.x)} ${f1(sp.y)}) scale(${k.toFixed(3)})"><title></title>`
        + '<path class="sr-coat o" d="M-8.6 0C-9-7-6-10.4 0-10.8C6-10.4 9-7 8.6 0Z"/>'
        + '<circle class="sr-head o" cx="0" cy="-15" r="5.6"/><circle class="sr-cheek" cx="2.6" cy="-13.4" r="1.2"/>'
        + '<circle class="sr-eye" cx="-1.8" cy="-15.6" r="0.8"/><circle class="sr-eye" cx="2" cy="-15.6" r="0.8"/>'
        + '<path class="sr-hat o" d="M-5.8-16.4C-5.6-22.6 5.6-22.6 5.8-16.4Z"/><circle class="sr-pom o" cx="0" cy="-22.4" r="1.9"/>'
        + '<path class="sr-mug o" d="M2.6-7H8.4V-1.4Q8.4.4 6.6.4H4.4Q2.6.4 2.6-1.4Z"/><path class="sr-mug-h" d="M8.4-5.6Q10.6-5.6 10.6-3.8Q10.6-2 8.4-2"/><path class="sr-cocoa" d="M3-6.6H8"/>'
        + '<path class="sr-steam" d="M4.4-8.6Q3.4-10.6 5-12M6.6-8.6Q5.6-10.6 7.2-12"/></g>';
      parts.push({ y: sp.y, s, label: p.label });
    });
    parts.sort((p, q) => p.y - q.y);
    v.guests.innerHTML = parts.map((p) => p.s).join('');
    v.guests.querySelectorAll('.sr-guest').forEach((gEl, j) => { gEl.querySelector('title').textContent = parts[j].label; });
  }
  function paintCount(v) {
    const got = new Set((v.picked || []).map((p) => p.id));
    let n = 0;
    for (const r of v.riders.values()) if (r.mode !== 'lodge' && r.mode !== 'tolodge' && !got.has(r.id)) n++;
    v.left.textContent = v.picked ? `${Math.max(0, n)} left` : `${n} on the hill`;
    if (v.countT) {
      const got = new Set((v.picked || []).map((p) => p.id));
      const inside = got.size + [...v.entering].filter((id) => !got.has(id)).length;
      v.countT.textContent = `${inside} / ${v.total}`;
      v.countG.toggleAttribute('hidden', !v.picked);
    }
    paintPour(v);
  }
  function paintPour(v) {
    v.pourBtn.hidden = !v.picked || isPopout(v) || !v.picked.length || v.pouring;
    v.pourBtn.disabled = !!v.active || !!v.race;
    v.pourBtn.classList.toggle('primary', v.full);
  }
  function setPicked(doc, list, total) {
    const v = views.get(doc);
    if (!v) return;
    const was = new Set((v.picked || []).map((p) => p.id));
    v.picked = list;
    v.total = Math.max(total || 0, list ? list.length : 0);
    const now = new Set((list || []).map((p) => p.id));
    // out of the lodge (let out, or the list emptied): they hop back up
    for (const id of was) {
      if (now.has(id)) continue;
      const r = v.riders.get(id);
      if (r && (r.mode === 'lodge' || r.mode === 'tolodge')) {
        r.mode = 'hop'; r.hidden = true; r.hopFrom = doorWorld(v); r.hopAt = hopSlot(v); r.hop0 = null; r.wx = null;
        unplace(r);
      } else v.incoming.add(id);
      v.inLodge.delete(id);
      v.entering.delete(id);
    }
    setTimeout(() => v.incoming.clear(), 4000);
    renderLodge(v);
    const full = !!list && v.total > 0 && list.length >= v.total;
    if (full && v.wasFull === false) celebrate(v);
    v.wasFull = full;
    v.full = full;
    v.el.classList.toggle('full', full);
    paintCount(v);
  }
  function celebrate(v) {
    if (!isOn(v.doc) || !v.g) return;   // the sleigh is showing instead
    v.el.classList.add('party');
    setTimeout(() => v.el.classList.remove('party'), PARTY_MS);
    placeLodgeBurst(v);
    fireBurst(v.burstLodge, snowBurst(v.K * 0.8, 30, true));
    if (soundOn(v.doc) && !isPopout(v)) chime();
  }
  function placeLodgeBurst(v) {
    if (!v.bw || !v.g) return;
    const g = v.g, p = toPx(v, g.lodge.x + 135 * g.lodge.s, H - 150 * g.lodge.s);
    v.burstLodge.style.left = `${p.x.toFixed(1)}px`;
    v.burstLodge.style.top = `${p.y.toFixed(1)}px`;
  }
  // "Let them out": the wheel says go (a saved list asks first), then
  // wheel.js empties the round, and everyone hops out of the lodge and back
  // up to the start
  function pour(v) {
    if (v.pouring || v.active || v.race || !v.picked || !v.picked.length) return;
    if (!v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset-request', { cancelable: true }))) return;
    v.pouring = true;
    v.el.setAttribute('aria-disabled', 'true');
    paintPour(v);
    if (soundOn(v.doc) && !isPopout(v)) letOut();
    v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset'));
    setTimeout(() => { v.pouring = false; setDisabled(v.doc, v.off); paintCount(v); }, reduced(v.doc) ? 600 : 2200);
  }

  // ---------- sound: a whistle, runners, thumps, bonks, a cheer ----------
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
  const noise = (c, at, len, gain, freq, q = 0.8, type = 'bandpass') => {
    if (!noiseBuf) return null;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.05, len / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(at); src.stop(at + len + 0.05);
    return { src, f, g };
  };
  // a referee's whistle: two short pips and a long trill
  function whistle() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [[0, 0.08], [0.13, 0.08], [0.27, 0.3]].forEach(([d, len]) => {
      const o = tone(c, t0 + d, 2950, len, 0.07);
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 36; lg.gain.value = 130;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t0 + d); lfo.stop(t0 + d + len + 0.02);
    });
  }
  // runners on snow: band-passed noise that swells as they pick up speed
  function hiss(ms) {
    const c = audio();
    if (!c || !noiseBuf) return;
    const t0 = c.currentTime + 0.05, len = ms / 1000;
    const n = noise(c, t0, len + 0.4, 0.055, 1800, 0.6);
    if (!n) return;
    n.g.gain.cancelScheduledValues(t0);
    n.g.gain.setValueAtTime(0.0001, t0);
    n.g.gain.exponentialRampToValueAtTime(0.06, t0 + len * 0.8);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.4);
    n.f.frequency.setValueAtTime(1400, t0);
    n.f.frequency.linearRampToValueAtTime(3800, t0 + len);
  }
  function thump() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, o = tone(c, at, 130, 0.18, 0.13);
    o.frequency.exponentialRampToValueAtTime(52, at + 0.16);
    noise(c, at, 0.12, 0.04, 600, 0.7);
  }
  function bonk() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, o = tone(c, at, 420, 0.14, 0.06, 'triangle');
    o.frequency.exponentialRampToValueAtTime(260, at + 0.12);
  }
  function wipeSound() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime;
    const o = tone(c, at, 700, 0.5, 0.06, 'triangle');
    o.frequency.exponentialRampToValueAtTime(140, at + 0.45);
    noise(c, at + 0.32, 0.3, 0.07, 500, 0.6);
  }
  // across the line: a crowd's roar and a bell
  function cheer() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [988, 1319, 1568, 1976].forEach((f, i) => tone(c, t0 + i * 0.08, f, 0.6, 0.05, 'triangle'));
    const n = noise(c, t0, 1.4, 0.06, 1100, 0.4);
    if (n) {
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 7; lg.gain.value = 300;
      lfo.connect(lg); lg.connect(n.f.frequency);
      lfo.start(t0); lfo.stop(t0 + 1.4);
    }
  }
  function chime() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(c, t0 + i * 0.12, f, 0.9, 0.05, 'triangle'));
  }
  // a place after the first crosses: a bell, a step lower each time
  function ding(k) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime, f = [1319, 1175, 1047, 988, 880][Math.min(4, k - 1)];
    tone(c, t0, f, 0.7, 0.06, 'triangle');
    tone(c, t0 + 0.09, f * 1.5, 0.5, 0.03, 'triangle');
    noise(c, t0, 0.25, 0.025, 2600, 0.7);
  }
  function doorBell() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [1760, 2093, 2637].forEach((f, i) => tone(c, t0 + i * 0.07, f, 0.4, 0.035, 'triangle'));
  }
  function letOut() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    noise(c, t0, 0.6, 0.05, 900, 0.5);
    [1568, 1319, 1175, 988].forEach((f, i) => tone(c, t0 + 0.1 + i * 0.09, f, 0.4, 0.04, 'triangle'));
  }

  window.Sled = { DURATION_MS, SETTLE_MS, HOLDS_ROUND: true, MULTI: true, timing, isOn, busy, build, sync, run, finish, setWinner, setDisabled, setPicked, setRace };
})();
