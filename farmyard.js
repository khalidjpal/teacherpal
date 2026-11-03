// farmyard.js — the Name Wheel's thanksgiving skin: a farmer choosing a
// turkey instead of the wheel.
//
// Same shape as cauldron.js / boba.js: wheel.js still owns everything that
// matters (who's in, the fair draw, No repeats, the pop-out broadcast) and
// hands this file a spin descriptor { startedAt, duration, settle, winnerId }.
// The farm fills the left two thirds or so: one plump cartoon turkey per
// student (its first name small on its body) penned in a fenced yard in
// front of a barn and hay bales, and the farmer by the pen's fence in a big
// thinking pose. The right third is a little production line running top to
// bottom: an oven at the top with a hopper on its farm side, an S of
// conveyor belt down through the packer and the labeller, and a grocery
// shelf at the bottom. A pick (~5.7s, the T timeline below): he strides
// along the flock, stops at a turkey or two, leans in and shakes his head;
// the turkeys near him duck and shuffle away, and one tries to sneak off.
// At the winner he stops and POINTS; it freezes mid-gobble. He hoists it
// over his head and lobs it into the hopper, and as it drops in the name
// comes up large over the farm. The oven rattles and glows, and out of its
// hatch comes a golden roast turkey, steaming, that rides the S down: under
// the packer (a white foam tray, clear film), past the labeller (a small
// label with the student's name) and onto the shelf. With No repeats on the shelf is where the
// round collects, one slot per student, filling from the top shelf down,
// the count on its base; when it's full a SOLD OUT sign drops. "Let them
// out" (or Reset) bursts the packages and the turkeys, whole and cheerful,
// hop back into the pen. With No repeats off the winner sits on the shelf
// until the next pick, then hops back. The decoys and the sneaker come from
// a seeded random from the descriptor, so the pop-out plays the same pick.
// Never picks anything.
(() => {
  const DURATION_MS = 3300;
  const SETTLE_MS = 2400;                          // 5.7s in all
  // ms from the start of a pick. The walk ends at `point`; he hoists the
  // winner (grab..grabEnd) and lobs it into the hopper (toss..drop; at drop
  // the name comes up over the farm). It cooks out of sight until outOven,
  // then the belt carries the package down one station at a time: the packer
  // (stamp, then packed), the labeller (slap: the label), the end of the belt
  // (end) and the shelf (shelf).
  const T = {
    start: 150, point: 2300, freeze: 2340,
    grab: 2580, grabEnd: 2760, toss: 2800, drop: 3280,
    outOven: 3720, atPack: 4120, stamp: 4140, packed: 4210, leavePack: 4320,
    atLabel: 4480, slap: 4510, leaveLabel: 4620,
    end: 5000, shelf: 5380,
  };
  T.out = T.shelf;
  const DWELL = 500;                               // one inspection: lean in, then shake the head
  const LEAN = 210;                                // ...of which the lean
  const RELIEF_MS = 700;                           // a turkey's hop of relief after he moves on

  // ---- the scene: 400 units tall, as wide as its box ----
  // The art is drawn across x -400..1400 around a centre of 500; the viewBox
  // is `x0 0 W 400`, W from the box's aspect (layout()), so the farm fills
  // any width. Everyone stands on the ground plane: x across, y the depth
  // (the feet), z the height above the ground (only a lifted turkey has one).
  // The production column (v.col) takes the right of the view; the pen
  // (v.yard) is the rest, a fenced trapezoid a little narrower at the back.
  const MID = 500;
  const SUN_X = 596;                               // shadows fall away from it
  const LIFT_Z = 127;                              // a lifted turkey's feet, in farmer units (just over his head)
  const HELD_GROW = 1.6;                           // a lifted turkey is drawn this much bigger
  const PHASES = ['caught', 'held', 'tossed', 'away', 'shelved'];
  const SCARE_R = 62;                              // how close he gets before a turkey ducks
  // the pen: its fence (back / front depth, sides slanting in by `slant`
  // per unit of depth) and the rows the flock stands in (y0..y1)
  const PEN = { back: 224, front: 388, y0: 240, y1: 366, slant: 0.2 };
  const penL = (Y, y) => Y.l + (Y.front - y) * Y.slant;
  const penR = (Y, y) => Y.r - (Y.front - y) * Y.slant;
  // ---- the production column: its own 300 x 400 units, scaled by v.col.s ----
  const COL_W = 300;
  // the belt's centre line: right along the top under the oven (A), round the
  // right-hand pulley, left (B: the packer, the labeller), round the
  // left-hand pulley, and right again (C) to the shelf
  const BELT = { ax: 186, ay: 79.5, rx: 254, rr: 26.5, by: 132.5, lx: 46, lr: 24.5, cy: 181.5, cx: 252 };
  const BELT_D = `M${BELT.ax} ${BELT.ay}H${BELT.rx}A${BELT.rr} ${BELT.rr} 0 0 1 ${BELT.rx} ${BELT.by}H${BELT.lx}A${BELT.lr} ${BELT.lr} 0 0 0 ${BELT.lx} ${BELT.cy}H${BELT.cx}`;
  // where each stretch ends, as a distance along the belt
  const SEG = (() => {
    const a = BELT.rx - BELT.ax, r = a + Math.PI * BELT.rr, b = r + BELT.rx - BELT.lx, l = b + Math.PI * BELT.lr;
    return { a, r, b, l, c: l + BELT.cx - BELT.lx };
  })();
  const PACK_X = 160, LABEL_X = 88, END_X = 244;
  const ST = { out: 14, pack: SEG.r + BELT.rx - PACK_X, label: SEG.r + BELT.rx - LABEL_X, end: SEG.l + END_X - BELT.lx };
  const PK_B = 0.52;                               // a package on the belt (it's ~58 x 48 at 1)
  const HOPPER = { x: 34, y: 2 };                  // the hopper's mouth
  // where the package is on the belt: one eased move per station, so it runs in beats
  const ROUTE = [[T.outOven, ST.out], [T.atPack, ST.pack], [T.leavePack, ST.pack], [T.atLabel, ST.label],
    [T.leaveLabel, ST.label], [T.end, ST.end]];
  // ---- the shelf, in column units: the sign, the rows between rows0 and rows1, the base ----
  const SH = { x: 4, w: 292, sign: 191, rows0: 216, rows1: 386, base: 398 };
  const PARTY_MS = 2800;                           // the full shelf's celebration

  const views = new Map();
  const isOn = (doc) => doc.documentElement.getAttribute('data-theme') === 'thanksgiving';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const seeded = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const backOut = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;   // arrives with a little overshoot
  const lerp = (a, b, u) => a + (b - a) * u;
  const reduced = (doc) => !!doc.defaultView.matchMedia && doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const persp = (y) => 0.62 + 0.36 * clamp((y - 200) / 190, 0, 1);
  const soundOn = (doc) => { const m = doc.getElementById('wheel-mute'); return !!m && m.getAttribute('aria-checked') !== 'true'; };
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (doc, tag, cls) => { const e = doc.createElementNS(NS, tag); if (cls) e.setAttribute('class', cls); return e; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- a turkey: facing left, feet at (0, 0), about 46 units tall ----------
  const FEATHER = 'M0 0C-5.6-9-5.8-21 0-27 5.8-21 5.6-9 0 0Z';
  const TAIL = [-66, -44, -22, 0, 22, 44, 66].map((a, i) =>
    `<g transform="translate(6 -19) rotate(${a})"><path class="fy-fe c${i % 3} o" d="${FEATHER}"/><path class="fy-fe-tip" d="M-3.6-19.5C-2.4-24.4 2.4-24.4 3.6-19.5 2-21.2-2-21.2-3.6-19.5Z"/></g>`).join('');
  const TURKEY = `
    <g class="fy-bird">
      <g class="fy-tail">${TAIL}</g>
      <g class="fy-legs">
        <path class="fy-leg l" d="M-3-8.5L-4.4 0M-8 .2H-1.4M-4.4 0L-6.6 1.6"/>
        <path class="fy-leg r" d="M3.4-8.5L4.4 0M1.4.2H8M4.4 0L2.4 1.6"/>
      </g>
      <g class="fy-torso">
        <ellipse class="fy-body o" cx="2" cy="-17" rx="13.4" ry="11.2"/>
        <ellipse class="fy-chest" cx="-5.4" cy="-15.6" rx="5.8" ry="7.4"/>
        <path class="fy-scallop" d="M-9-12q2 2 4 0 2 2 4 0M-8-17q2 2 4 0 2 2 4 0"/>
        <path class="fy-wing o" d="M1.5-22.5C10-23.5 15.5-17.5 13.6-10.4 9.6-8.6 3-11.5.2-16.4Z"/>
        <path class="fy-wing-line" d="M5-19.5C8-18 10-15.5 10.8-12.4M3-17C5.5-15.5 7-13.5 7.6-11.2"/>
        <text class="fy-tag"></text>
        <g class="fy-head">
          <path class="fy-neck" d="M-5.6-21.5C-9.6-25.5-11-29.5-11.2-33"/>
          <circle class="fy-skin o" cx="-12" cy="-34.4" r="4.8"/>
          <path class="fy-wattle o" d="M-13.6-31.2C-15.6-27.4-12.6-24.8-10.4-28.2Z"/>
          <path class="fy-snood" d="M-15.2-35.6C-17.4-33.4-17.6-29.6-16.4-27.4"/>
          <path class="fy-beak shut o" d="M-16.2-35.6L-21.4-33.8L-16.2-32.4Z"/>
          <g class="fy-beak open"><path class="o" d="M-16-36.6L-22-38.6L-16.2-34.4Z"/><path class="fy-beak-in" d="M-16.2-34.4L-21-33.8-16.2-32.8Z"/><path class="o" d="M-16-33L-21-29.8L-16.4-32Z"/></g>
          <g class="fy-eye"><circle class="fy-eye-w" cx="-12.4" cy="-35.8" r="2"/><circle class="fy-pupil" cx="-13.2" cy="-35.8" r="1.05"/></g>
          <path class="fy-brow" d="M-15-39.6L-10.8-39"/>
          <path class="fy-shut" d="M-14.4-35.6Q-12.4-34-10.4-35.6"/>
        </g>
      </g>
      <g class="fy-puff"><g transform="translate(10 -32) rotate(30) scale(.32)"><path class="fy-fe c1 o" d="${FEATHER}"/></g><g transform="translate(-4 -38) rotate(-40) scale(.28)"><path class="fy-fe c2 o" d="${FEATHER}"/></g><g transform="translate(16 -22) rotate(70) scale(.3)"><path class="fy-fe c0 o" d="${FEATHER}"/></g></g>
      <text class="fy-bang" x="-11" y="-47">!</text>
    </g>`;
  const PALETTES = 3;
  const palOf = (id) => hash(id + 'p') % PALETTES;

  // ---------- the farmer ----------
  // farmer.js draws him (or her) to the teacher's own look: FarmerArt.apply().
  // Facing left, feet at (0, 0), about 112 units to the top of the head.

  // ---------- the production column, in column units ----------
  // Three layers with the shelf and the package between them: COL_BACK (the
  // wall, the belt and its pulleys), then the shelf, the package, and
  // COL_FRONT (the hopper, the oven, which hides the package while it
  // cooks, the packer and the labeller).
  const COL_BACK = `
    <rect class="fc-wall" x="-6" y="-12" width="312" height="424" rx="12"/>
    <path class="fc-rivets" d="M8 -2h0M292 -2h0M8 186h0M292 186h0"/>
    <path class="fl-rail" d="M190 87H254M46 140H254M46 189H250"/>
    <circle class="fl-drum o" cx="${BELT.rx}" cy="${(BELT.ay + BELT.by) / 2}" r="${BELT.rr - 4.5}"/>
    <circle class="fl-drum o" cx="${BELT.lx}" cy="${(BELT.by + BELT.cy) / 2}" r="${BELT.lr - 4.5}"/>
    <path class="fl-spokes"/>
    <circle class="fl-hub" cx="${BELT.rx}" cy="${(BELT.ay + BELT.by) / 2}" r="3.4"/><circle class="fl-hub" cx="${BELT.lx}" cy="${(BELT.by + BELT.cy) / 2}" r="3.4"/>
    <path class="fl-band-o" d="${BELT_D}"/><path class="fl-band" d="${BELT_D}"/><path class="fl-slats" d="${BELT_D}"/>`;
  const COL_FRONT = `
    <g class="fl-hopper">
      <path class="fl-pipe o" d="M36 22H50V36H64V50H36Z"/>
      <path class="fl-hop o" d="M6 0H62L52 25H32Z"/>
      <ellipse class="fl-hop-mouth" cx="34" cy="1" rx="26" ry="3.6"/>
      <rect class="fl-hop-rim o" x="3" y="-3.4" width="62" height="4.6" rx="2"/>
    </g>
    <g class="fl-oven">
      <g class="fl-smoke"><circle cx="150" cy="0" r="4.5"/><circle cx="152" cy="-6" r="6"/><circle cx="149" cy="-13" r="7.5"/></g>
      <g class="fl-oven-body">
        <rect class="fl-oven-box o" x="62" y="4" width="136" height="72" rx="9"/>
        <rect class="fl-oven-strip o" x="69" y="10" width="122" height="13" rx="4"/>
        <circle class="fl-knob o" cx="80" cy="16.5" r="3.4"/><circle class="fl-knob o" cx="91" cy="16.5" r="3.4"/>
        <circle class="fl-lamp" cx="102" cy="16.5" r="2.3"/>
        <circle class="fl-dial o" cx="180" cy="16.5" r="4.8"/><path class="fl-dial-hand" d="M180 16.5V12.8"/>
        <rect class="fl-win o" x="74" y="28" width="98" height="40" rx="6"/>
        <rect class="fl-win-glow" x="74" y="28" width="98" height="40" rx="6"/>
        <path class="fl-coil" d="M80 62q4-4 8 0t8 0 8 0 8 0 8 0 8 0 8 0 8 0 8 0 8 0 8 0"/>
        <path class="fl-win-shine" d="M82 33L92 62M90 33L93 42"/>
        <g class="fl-hatch"><rect class="fl-hatch-mouth" x="196" y="44" width="9" height="32" rx="2"/><g class="fl-flap"><rect class="o" x="196" y="44" width="9" height="32" rx="2"/><path d="M199 48V72M202 48V72"/></g></g>
      </g>
      <g class="fl-puff"><circle cx="214" cy="52" r="7"/><circle cx="222" cy="42" r="9"/><circle cx="212" cy="34" r="6"/></g>
    </g>
    <g class="fl-packer">
      <rect class="fl-foil o" x="${PACK_X - 30}" y="82" width="60" height="7" rx="3.5"/>
      <rect class="fl-pk-head o" x="${PACK_X - 24}" y="87" width="48" height="11" rx="3"/>
      <text class="fl-pk-word" x="${PACK_X}" y="92.8">PACK</text>
      <g class="fl-stamp"><rect class="fl-press o" x="${PACK_X - 17}" y="97" width="34" height="5" rx="1.5"/></g>
    </g>
    <g class="fl-labeller">
      <circle class="fl-lab-roll o" cx="${LABEL_X - 20}" cy="91" r="7.5"/><circle class="fl-lab-core" cx="${LABEL_X - 20}" cy="91" r="2.8"/>
      <rect class="fl-lab-box o" x="${LABEL_X - 13}" y="86" width="26" height="12" rx="3"/>
      <g class="fl-arm"><path class="fl-arm-rod" d="M${LABEL_X} 97V101"/><rect class="fl-arm-pad o" x="${LABEL_X - 11}" y="99" width="22" height="5" rx="1.5"/></g>
    </g>`;

  // ---------- a package: origin at the bottom of its tray, ~58 wide, 48 tall ----------
  // Out of the oven it's just the golden roast turkey (steaming); the packer
  // puts it on a white foam tray under clear film (.packed), the labeller
  // adds the small name label at the bottom (.labelled). The turkey is the
  // thing you see; the film has a shine and a few drops of moisture.
  const PACK = `<g class="pk-in">
    <g class="pk-steam"><path d="M-10-42q-4-6 0-12t0-12"/><path d="M2-46q-4-6 0-12t0-12"/><path d="M14-42q-4-6 0-12t0-12"/></g>
    <path class="pk-tray-in" d="M-26-14H26L29-11H-29Z"/>
    <g class="pk-roast">
      <ellipse class="pk-body o" cx="0" cy="-24" rx="21" ry="12.5"/>
      <ellipse class="pk-breast" cx="-3" cy="-28.5" rx="12" ry="5.2"/>
      <path class="pk-leg o" d="M-9-27C-18-26-24-32-21-37.5-18-42-12-38.6-8.6-32.6Z"/><path class="pk-bone" d="M-20-37L-23.4-41.4"/><circle class="pk-frill o" cx="-24.6" cy="-43" r="2.8"/>
      <path class="pk-leg o" d="M9-27C18-26 24-32 21-37.5 18-42 12-38.6 8.6-32.6Z"/><path class="pk-bone" d="M20-37L23.4-41.4"/><circle class="pk-frill o" cx="24.6" cy="-43" r="2.8"/>
      <path class="pk-gloss" d="M-13-31Q-5-35.4 5-33.6M14-22Q17-25 17-29"/>
    </g>
    <path class="pk-tray o" d="M-29-12H29L26 0H-26Z"/><path class="pk-tray-hi" d="M-27-8H27M-26.5-4H26.5"/>
    <path class="pk-film" d="M-29-12C-31-36-19-48 0-48 19-48 31-36 29-12Z"/>
    <path class="pk-film-hi" d="M-21-33Q-16-42-6-44.5M22-29Q24-23 23.5-17"/>
    <g class="pk-drops"><circle cx="-14" cy="-19" r="1.2"/><circle cx="12" cy="-41" r=".9"/><circle cx="18" cy="-22" r="1.4"/><circle cx="-7" cy="-42" r=".8"/><circle cx="6" cy="-17" r="1"/><circle cx="-23" cy="-26" r=".9"/><circle cx="16" cy="-35" r=".7"/></g>
    <g class="pk-label"><rect class="pk-tag o" x="-25" y="-17" width="50" height="15.5" rx="2"/><rect class="pk-tag-band" x="-24.4" y="-16.4" width="48.8" height="2.4" rx="1"/><text class="pk-name" x="0" y="-8"></text></g>
    <g class="pk-feathers"><path class="fy-fe c1 o" d="${FEATHER}" transform="translate(-14 -30) rotate(-30) scale(.45)"/><path class="fy-fe c0 o" d="${FEATHER}" transform="translate(12 -34) rotate(35) scale(.4)"/><path class="fy-fe c2 o" d="${FEATHER}" transform="translate(0 -44) scale(.4)"/></g>
  </g>`;

  // ---------- the farmyard ----------
  // Drawn wide (x -400..1400): the old square scene sits in the middle
  // (300..700), with more farm either side for wider boxes. The scenery is
  // still: only the flock, the farmer and the line move. Seeded, so every
  // window draws the same farm.
  function bgMarkup() {
    const r = seeded(20251127);
    const R = (a, b) => a + r() * (b - a);
    const f = (n) => n.toFixed(1);
    // a tree: trunk + crowns
    const tree = (x, base, top, crowns) => '<g class="fy-tree">'
      + `<path class="fy-trunk" d="M${x} ${base}V${top}"/>`
      + crowns.map(([cx, cy, cr, c]) => `<circle class="fy-crown c${c} o" cx="${cx}" cy="${cy}" r="${cr}"/>`).join('') + '</g>';
    const trees = [
      tree(-150, 196, 166, [[-150, 152, 19, 0], [-164, 166, 12, 2]]),
      tree(-50, 198, 170, [[-50, 158, 16, 1]]),
      tree(70, 196, 164, [[70, 150, 20, 2], [56, 164, 13, 0], [86, 162, 14, 1]]),
      tree(140, 198, 172, [[140, 162, 14, 0]]),
      tree(318, 196, 172, [[318, 160, 15, 1]]),
      tree(652, 196, 164, [[652, 152, 17, 0], [640, 164, 11, 1]]),
      tree(672, 198, 170, [[674, 160, 13, 2]]),
      tree(780, 196, 162, [[780, 148, 19, 1], [766, 162, 12, 2]]),
      tree(905, 198, 168, [[905, 154, 17, 0], [920, 166, 11, 2]]),
      tree(985, 196, 172, [[985, 160, 14, 1]]),
      tree(1090, 196, 164, [[1090, 152, 18, 2], [1104, 164, 12, 0]]),
      tree(1200, 198, 170, [[1200, 158, 16, 1]]),
    ].join('');
    // clouds, still
    const cloud = (x, y, s) => `<g class="fy-cloud" transform="translate(${x} ${y}) scale(${s})">`
      + '<path class="fy-cloud-b" d="M-34 2C-36-6-26-11-17-8-13-18 3-21 10-12 18-17 32-12 32-3 40-2 40 6 32 6H-30C-38 6-38 2-34 2Z"/>'
      + '<path class="fy-cloud-u" d="M-30 6H32C36 6 38 4 37 2 30 4 12 5-6 4-20 4-30 3-36 2-37 5-34 6-30 6Z"/></g>';
    const clouds = cloud(-250, 40, 1.2) + cloud(-40, 72, 0.8) + cloud(190, 52, 1.1) + cloud(330, 26, 1.4) + cloud(520, 64, 0.85)
      + cloud(760, 34, 1.5) + cloud(960, 86, 0.75) + cloud(1120, 46, 1.15) + cloud(1300, 70, 0.9);
    // grass tufts along the fence and at the front
    const tuft = (x, y, s) => `<g transform="translate(${f(x)} ${f(y)}) scale(${s.toFixed(2)})"><path class="fy-tuft" d="M-4.5 0Q-4.5-4-3-7.5Q-3.2-3.6-1.6 0M-1.4 0Q-1-6 .6-9.5Q.6-4.4 1.6 0M1.8 0Q2.6-3.8 5-6.5Q3.8-3 4.4 0"/></g>`;
    let tufts = '';
    for (let i = 0; i < 46; i++) tufts += tuft(R(-380, 1380), R(217, 234), R(0.9, 1.5));
    for (let i = 0; i < 26; i++) tufts += tuft(R(-380, 1380), R(384, 399), R(1.5, 2.2));
    let straw = '';
    for (let i = 0; i < 70; i++) { const a = R(-0.6, 0.6), l = R(6, 10); straw += `M${f(R(-380, 1380))} ${f(R(226, 396))}l${f(Math.cos(a) * l)} ${f(Math.sin(a) * l)}`; }
    let feed = '';
    for (let i = 0; i < 40; i++) feed += `<circle cx="${f(R(-300, 1300))}" cy="${f(R(250, 392))}"/>`;
    let posts = '';
    for (let x = -392; x <= 1400; x += 46) posts += `M${x} 194V216`;
    const pumpkin = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse class="fy-pumpkin o" cx="0" cy="-6" rx="9" ry="6.6"/><path class="fy-pumpkin-rib" d="M-3.4-12C-5.4-8-5.4-4-3.4-.2M3.4-12C5.4-8 5.4-4 3.4-.2M0-12.6V.4"/><path class="fy-pumpkin-stem" d="M0-12C0-15 1.4-16.4 3-16.8"/></g>`;
    const pumpkins = pumpkin(238, 222, 1) + pumpkin(256, 225, 0.8) + pumpkin(732, 221, 0.95) + pumpkin(750, 225, 0.75) + pumpkin(-30, 222, 1) + pumpkin(1048, 223, 0.9) + pumpkin(1066, 226, 0.7);
    return `
      <defs>
        <linearGradient id="fy-g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset=".62"/><stop offset="1"/></linearGradient>
        <linearGradient id="fy-g-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient>
        <radialGradient id="fy-g-sun"><stop offset="0"/><stop offset=".45"/><stop offset="1"/></radialGradient>
        <radialGradient id="fy-g-glow" gradientUnits="userSpaceOnUse" cx="${SUN_X}" cy="170" r="520"><stop offset="0"/><stop offset=".5"/><stop offset="1"/></radialGradient>
        <linearGradient id="fy-g-dusk" x1="0" y1="0" x2="0" y2="1"><stop offset=".5"/><stop offset="1"/></linearGradient>
        <linearGradient id="fy-g-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0"/><stop offset="1"/></linearGradient>
        <filter id="fy-glowf" x="-60%" y="-60%" width="220%" height="220%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="1.4" result="ring"/>
          <feFlood class="fy-glow-c"/><feComposite in2="ring" operator="in" result="ringc"/>
          <feGaussianBlur in="ringc" stdDeviation="2.4" result="glow"/>
          <feMerge><feMergeNode in="glow"/><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect class="fy-sky" x="-400" width="1800" height="216"/>
      <circle class="fy-sunglow" cx="${SUN_X}" cy="170" r="260"/>
      <circle class="fy-sun" cx="${SUN_X}" cy="170" r="70"/>
      <g class="fy-clouds">${clouds}</g>
      <path class="fy-hill-far" d="M-400 172C-300 150-200 158-100 164S60 146 160 166 280 150 300 176C360 150 420 160 480 168S600 140 700 158C780 168 860 142 960 152S1160 168 1260 150 1400 160V216H-400Z"/>
      <path class="fy-hill-near" d="M-400 194C-260 182-120 186 20 190S260 180 330 192 520 186 640 194 880 178 1040 188 1260 184 1400 190V216H-400Z"/>
      <g class="fy-trees">${trees}</g>
      <g class="fy-barn">
        <rect class="fy-silo o" x="450" y="96" width="24" height="110"/>
        <path class="fy-silo-top o" d="M450 96C450 80 474 80 474 96Z"/>
        <path class="fy-silo-ring" d="M450 120H474M450 146H474M450 172H474"/>
        <path class="fy-barn-wall o" d="M348 122H452V206H348Z"/>
        <path class="fy-barn-boards" d="M361 124V206M374 124V206M387 124V150M413 124V150M426 124V206M439 124V206"/>
        <path class="fy-barn-roof o" d="M340 126L360 94 400 76 440 94 460 126Z"/>
        <path class="fy-barn-trim" d="M346 124L362 96 400 80 438 96 454 124"/>
        <path class="fy-barn-loft o" d="M388 96H412V118H388Z"/>
        <path class="fy-hay-loft" d="M390 118L393 108 397 116 400 106 404 116 407 109 410 118Z"/>
        <path class="fy-barn-in" d="M378 150H422V206H378Z"/>
        <path class="fy-barn-hay" d="M380 206C384 194 392 190 400 196 408 190 416 194 420 206Z"/>
        <g class="fy-door l"><path class="fy-barn-door o" d="M378 150H400V206H378Z"/><path class="fy-barn-x" d="M378 150L400 206M400 150L378 206M378 150H400V206H378Z"/></g>
        <g class="fy-door r"><path class="fy-barn-door o" d="M400 150H422V206H400Z"/><path class="fy-barn-x" d="M400 150L422 206M422 150L400 206M400 150H422V206H400Z"/></g>
        <path class="fy-vane-pole" d="M400 77V50M395 60H405"/>
        <g class="fy-vane">
          <path class="fy-vane-arrow" d="M384 54H415M415 54L410 50.6M415 54L410 57.4M384 54L380 50.4H385.4L387.6 54 385.4 57.6H380Z"/>
          <path class="fy-vane-cock" d="M395 52C394 47 397 43.6 401 44 401.6 41.6 404.4 41.4 404.6 43.6 406.6 43 407.8 45 406.4 46.4L408.2 47.6 406 48.4C406.6 50.4 405.4 52 403.6 52Z M394.6 48C391 46.4 390.4 43 391.6 41 392.8 43.4 394 44.6 396 45Z"/>
        </g>
      </g>
      <g class="fy-missing" hidden></g>
      <g class="fy-bales">
        <rect class="fy-bale o" x="552" y="178" width="46" height="22" rx="3"/><rect class="fy-bale o" x="600" y="182" width="42" height="20" rx="3"/>
        <rect class="fy-bale o" x="570" y="158" width="44" height="21" rx="3"/>
        <path class="fy-bale-line" d="M562 178V200M588 178V200M610 182V202M632 182V202M580 158V179M604 158V179"/>
        <circle class="fy-roll o" cx="506" cy="194" r="15"/><path class="fy-roll-sp" d="M506 194m-4 0a4 4 0 1 1 8 0a8 8 0 1 1-16 0a11.5 11.5 0 1 1 23 0"/>
        <circle class="fy-roll o" cx="532" cy="198" r="11"/><path class="fy-roll-sp" d="M532 198m-3 0a3 3 0 1 1 6 0a6 6 0 1 1-12 0"/>
        <rect class="fy-bale o" x="186" y="182" width="44" height="20" rx="3"/><rect class="fy-bale o" x="198" y="163" width="40" height="20" rx="3"/>
        <path class="fy-bale-line" d="M198 182V202M218 182V202M208 163V183M226 163V183"/>
        <circle class="fy-roll o" cx="1010" cy="196" r="14"/><path class="fy-roll-sp" d="M1010 196m-4 0a4 4 0 1 1 8 0a8 8 0 1 1-16 0"/>
        <rect class="fy-bale o" x="-110" y="182" width="44" height="20" rx="3"/><path class="fy-bale-line" d="M-98 182V202M-78 182V202"/>
      </g>
      <g class="fy-fence">
        <path class="fy-rail" d="M-400 200H1400M-400 211H1400"/>
        <path class="fy-post" d="${posts}"/>
      </g>
      <path class="fy-ground" d="M-400 214C-200 210 200 209 500 210S1100 211 1400 214V400H-400Z"/>
      <g class="fy-pumpkins">${pumpkins}</g>
      <path class="fy-straw-bits" d="${straw}"/>
      <g class="fy-feed">${feed}</g>
      <g class="fy-grass">${tufts}</g>
      <g class="fy-sign"></g>`;
  }

  // ---------- the farm sign: "<display name>'s Turkey Farm" ----------
  // A hand-painted board on two posts at the back of the yard, left of the
  // barn. The name is the profile's display_name (never the username); with
  // none it just says TURKEY FARM. Board units; the origin is the ground
  // between the posts.
  const SIGN_MAX = 176;                            // the widest board
  let measurer = null;
  const measure = (doc, text, font) => {
    measurer = measurer || doc.createElement('canvas').getContext('2d');
    measurer.font = font;
    return measurer.measureText(text).width;
  };
  function signLines() {
    const u = window.FarmerArt ? FarmerArt.user() : null;
    const name = String((u && u.display_name) || '').trim();
    return name ? [`${name}'s`, 'TURKEY FARM'] : ['TURKEY FARM'];
  }
  function renderSign(v) {
    const lines = signLines(), key = lines.join('|');
    if (v.signKey === key) return;
    v.signKey = key;
    const fam = v.doc.defaultView.getComputedStyle(v.el).getPropertyValue('--font-body').trim() || 'sans-serif';
    const two = lines.length === 2;
    const per = measure(v.doc, lines[0], `700 10px ${fam}`) / 10;           // width per px of type
    const fs = Math.min(two ? 15 : 16, (SIGN_MAX - 24) / per);
    const sub = 8.4, subW = two ? measure(v.doc, lines[1], `700 ${sub}px ${fam}`) + 0.2 * sub * (lines[1].length - 1) : 0;
    const w = clamp(Math.max(per * fs, subW) + 24, 96, SIGN_MAX), h = two ? 36 : 26;
    const x = w / 2, top = -18 - h, bot = -18, px = x - 13;
    const n = (k) => k.toFixed(1);
    const nails = [-px, px].map((cx) => `<circle class="fy-sign-nail" cx="${n(cx)}" cy="${n(top + 4.6)}" r="1.1"/><circle class="fy-sign-nail" cx="${n(cx)}" cy="${n(bot - 4.6)}" r="1.1"/>`).join('');
    const grain = `M${n(-x + 8)} ${n(top + h * 0.22)}q${n(w * 0.18)} -2 ${n(w * 0.34)} 0M${n(x * 0.1)} ${n(top + h * 0.3)}q${n(w * 0.16)} 1.6 ${n(w * 0.3)} 0`
      + `M${n(-x + 14)} ${n(top + h * 0.8)}q${n(w * 0.2)} 1.6 ${n(w * 0.4)} 0M${n(x * 0.3)} ${n(top + h * 0.86)}q${n(w * 0.1)} -1.4 ${n(w * 0.2)} 0`;
    v.sign.innerHTML = `<g transform="rotate(-1.4)">`
      + `<path class="fy-sign-post o" d="M${n(-px - 3)} 2V${n(top - 5)}H${n(-px + 3)}V2ZM${n(px - 3)} 2V${n(top - 5)}H${n(px + 3)}V2Z"/>`
      + `<rect class="fy-sign-board o" x="${n(-x)}" y="${n(top)}" width="${n(w)}" height="${h}" rx="3"/>`
      + (two ? `<path class="fy-sign-seam" d="M${n(-x + 1.5)} ${n(top + h / 2)}H${n(x - 1.5)}"/>` : '')
      + `<path class="fy-sign-grain" d="${grain}"/>`
      + `<path class="fy-sign-edge" d="M${n(-x + 2.5)} ${n(bot - 1.6)}H${n(x - 2.5)}"/>`
      + nails
      + (two
        ? `<text class="fy-sign-name" y="${n(top + h * 0.34)}" style="font-size:${n(fs)}px"></text><text class="fy-sign-sub" y="${n(top + h * 0.77)}" style="font-size:${sub}px">${lines[1]}</text>`
        : `<text class="fy-sign-name" y="${n(top + h / 2)}" style="font-size:${n(fs)}px">${lines[0]}</text>`)
      + '</g>';
    if (two) v.sign.querySelector('.fy-sign-name').textContent = lines[0];   // the teacher's own text: never markup
    v.signW = w;
    placeSign(v);
  }
  // at the back of the yard against the left edge of the view, smaller if
  // it would run into the barn
  function placeSign(v) {
    if (!v.signW || v.x0 === undefined) return;
    const room = 334 - (v.x0 + 14);
    const s = clamp(room / v.signW, 0.7, 1.25);
    const cx = v.x0 + 14 + (v.signW * s) / 2;
    v.sign.setAttribute('transform', `translate(${cx.toFixed(1)} 221) scale(${s.toFixed(3)})`);
  }
  // ---------- the MISSING flyer: today's absentees, tacked to the barn ----------
  // A weathered lost-pet poster on the barn wall left of the doors: MISSING,
  // a little turkey, then first names (FLY_ROWS at most, then "+N more"; the
  // whole list in its <title>, on hover). Only while someone is absent; still.
  const FLY_ROWS = 3, FLY_STEP = 4.6;
  const flyShort = (n) => (n.length > 8 ? n.slice(0, 7) + '…' : n);
  function renderMissing(v) {
    const names = v.missing || [];
    v.fly.toggleAttribute('hidden', !names.length);
    if (!names.length) { v.fly.innerHTML = ''; return; }
    const doc = v.doc;
    const over = names.length > FLY_ROWS + 1;              // "+1 more" would take a row anyway
    const shown = over ? names.slice(0, FLY_ROWS) : names.slice(0, FLY_ROWS + 1);
    const rows = shown.length + (over ? 1 : 0);
    // it fits the wall panel left of the doors (x 348-378, under the eaves)
    const w = 26, h = 23 + (rows - 1) * FLY_STEP + 3;
    // the paper, its bottom-right corner curling up, a nail at the top
    v.fly.innerHTML = `<g transform="translate(363 131) rotate(-4)">`
      + `<path class="fy-fly-paper o" d="M${-w / 2} 0H${w / 2}V${h - 5}L${w / 2 - 5} ${h}H${-w / 2}Z"/>`
      + `<path class="fy-fly-stain" d="M${-w / 2 + 2.5} ${(h * 0.7).toFixed(1)}q3 -2.4 6 .8M${w / 2 - 7} 4.6q2.4 1.6 4.8 0"/>`
      + `<path class="fy-fly-curl o" d="M${w / 2} ${h - 5}L${w / 2 - 5} ${h}Q${w / 2 - 4.4} ${h - 4.6} ${w / 2 - 6.6} ${h - 6.2}Q${w / 2 - 2.4} ${h - 5.6} ${w / 2} ${h - 5}Z"/>`
      + `<circle class="fy-fly-nail" cx="0" cy="1.6" r=".8"/>`
      + `<text class="fy-fly-head" x="0" y="7.6">MISSING</text>`
      // a little turkey, side on: tail fan, body, head with beak and wattle, legs
      + `<g class="fy-fly-pic" transform="translate(0 13.6)">`
      + `<path d="M2.6-1.6l2.8-3M3.2-.6l3.6-1.6M3.4.6l3.6.2"/>`
      + `<ellipse cx=".6" cy="0" rx="3.8" ry="2.8"/>`
      + `<path d="M-2.4-1.4Q-3.2-2.4-3-3.6"/><circle cx="-3.2" cy="-4" r="1.3"/>`
      + `<path d="M-4.4-4.2l-1.3.4 1.2.4M-3.8-3l-.2 1.2M-.4 2.8v2M1.6 2.8v2"/></g>`
      + `<g class="fy-fly-names"></g>`
      + `</g><title></title>`;
    const list = v.fly.querySelector('.fy-fly-names');
    shown.forEach((n, i) => {
      const t = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', '0'); t.setAttribute('y', (23 + i * FLY_STEP).toFixed(1));
      t.textContent = flyShort(n);                          // student names: never markup
      list.appendChild(t);
    });
    if (over) {
      const t = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', '0'); t.setAttribute('y', (23 + FLY_ROWS * FLY_STEP).toFixed(1));
      t.setAttribute('class', 'fy-fly-more');
      t.textContent = `+${names.length - FLY_ROWS} more`;
      list.appendChild(t);
    }
    v.fly.querySelector('title').textContent = `Missing today: ${(v.missingFull || names).join(', ')}`;
  }
  // wheel.js: the period's absentees today ({ first, full } each), [] = none
  function setAbsent(doc, list) {
    const v = views.get(doc);
    if (!v) return;
    const sig = (list || []).map((x) => x.full).join('|');
    if (v.missingSig === sig) return;
    v.missingSig = sig;
    v.missing = (list || []).map((x) => x.first);
    v.missingFull = (list || []).map((x) => x.full);
    renderMissing(v);
  }

  // the profile changed (here, or in another window): the farmer's look and the sign
  function refreshProfile(v) {
    if (window.FarmerArt) FarmerArt.apply(v.farmer.g, FarmerArt.current());
    renderSign(v);
  }
  // warm low sunlight over everything, and a little dusk at the front
  const LIGHT = `<rect class="fy-warm" x="-400" width="1800" height="400"/><rect class="fy-dusk" x="-400" width="1800" height="400"/>`;
  const markup = () => `
    <svg class="fy-svg" viewBox="300 0 400 400" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      ${bgMarkup()}
      <g class="fy-pen"></g>
      <g class="fy-shadows"></g>
      <g class="fy-actors"></g>
      ${LIGHT}
    </svg>
    <span class="fy-left" aria-hidden="true"></span>
    <button type="button" class="fy-pour" hidden>Let them out</button>
    <div class="fy-name" aria-hidden="true"><span></span></div>
    <div class="fy-burst" aria-hidden="true"></div>
    <div class="fy-burst fy-burst-shelf" aria-hidden="true"></div>`;

  const LEAF = 'M50 4 57 22 66 16 64 36 80 26 76 38 92 40 80 52 86 58 64 62 66 72 52 66 52 92 48 92 48 66 34 72 36 62 14 58 20 52 8 40 24 38 20 26 36 36 34 16 43 22Z';
  const LEAF2 = 'M50 6C58 8 60 16 56 20 64 18 70 24 64 30 72 30 76 38 68 42 76 44 78 54 68 56 74 62 70 70 60 66 60 74 56 78 52 78L52 94 48 94 48 78C44 78 40 74 40 66 30 70 26 62 32 56 22 54 24 44 32 42 24 38 28 30 36 30 30 24 36 18 44 20 40 16 42 8 50 6Z';
  // distances in scene units, turned into px for this box (k = px per unit)
  function burstMarkup(k, n = 18) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.15, 0.15), d = rnd(88, 160) * k;
      const shape = i % 2 ? LEAF : LEAF2;
      s += `<i style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d * 0.6 - 24 * k).toFixed(1)}px;--fall:${(rnd(40, 88) * k).toFixed(1)}px;--r:${rnd(-260, 260).toFixed(0)}deg;--d:${(i % 6) * 40 + (n > 18 ? (i % 3) * 160 : 0)}ms;--c:var(--fy-burst-${i % 4})"><svg viewBox="0 0 100 100"><path d="${shape}"/></svg></i>`;
    }
    return s;
  }

  // A long shadow: a soft blot at the feet and a streak along the ground,
  // away from the low sun (local x = the streak; paint() turns and squashes it).
  const shade = (doc, len, wid, foot) => {
    const g = svgEl(doc, 'g', 'fy-shade');
    g.innerHTML = `<ellipse class="fy-shade-l" cx="${len / 2 - 2}" cy="0" rx="${len / 2 + 2}" ry="${wid}"/><circle class="fy-shade-c" r="${foot}"/>`;
    return g;
  };
  function placeShade(g, x, y, s, op) {
    const gx = clamp((x - SUN_X) / 340, -1.7, 1.7);
    const ang = Math.atan2(1, gx) * 180 / Math.PI;
    g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(1 .36) rotate(${ang.toFixed(1)}) scale(${s.toFixed(3)})`);
    g.style.opacity = op;
  }

  function build(doc) {
    if (views.has(doc)) return views.get(doc).el;
    const wrap = doc.querySelector('.wheel-wrap');
    if (!wrap) return null;
    const el = doc.createElement('div');
    el.className = 'farm';
    el.id = 'farm';
    el.dataset.state = '';
    el.innerHTML = markup();
    wrap.appendChild(el);
    const fg = svgEl(doc, 'g', 'fy-farmer');
    fg.dataset.pose = 'think';
    if (window.FarmerArt) FarmerArt.apply(fg, FarmerArt.current());
    const fsh = shade(doc, 118, 15, 18);
    // the column: the wall and the belt, the shelf, the package, the machines
    const col = svgEl(doc, 'g', 'fy-col');
    const back = svgEl(doc, 'g', 'fy-line-b');
    back.innerHTML = COL_BACK;
    const shelf = svgEl(doc, 'g', 'fy-shelf');
    shelf.innerHTML = '<g class="fs-frame"></g><path class="fs-boards o"/><path class="fs-empty"/><g class="fs-packs"></g>'
      + '<g class="fs-count"><rect class="o" rx="3"/><text></text></g>'
      + '<g class="fs-sold"><g class="fs-sold-in"><path class="fs-string"/><rect class="fs-sold-b o" rx="6"/><text class="fs-sold-t">SOLD OUT</text></g></g>';
    const items = svgEl(doc, 'g', 'fy-line-items');
    const front = svgEl(doc, 'g', 'fy-line-f');
    front.innerHTML = COL_FRONT;
    [back, shelf, items, front].forEach((g) => col.appendChild(g));
    // the pen's front fence stands among the actors (it's in front of the flock)
    const penFront = svgEl(doc, 'g', 'fy-pen-f');
    const q = (g, c) => g.querySelector(c);
    const v = {
      doc, el,
      svg: el.querySelector('.fy-svg'),
      actors: el.querySelector('.fy-actors'),
      shadows: el.querySelector('.fy-shadows'),
      penBack: el.querySelector('.fy-pen'),
      penFront,
      fly: el.querySelector('.fy-missing'),
      colG: col,
      left: el.querySelector('.fy-left'),
      pourBtn: el.querySelector('.fy-pour'),
      name: el.querySelector('.fy-name'),
      burst: el.querySelector('.fy-burst'),
      burstShelf: el.querySelector('.fy-burst-shelf'),
      birds: new Map(),                          // id -> turkey
      leaving: [],                               // turkeys fading out
      farmer: { g: fg, sh: fsh, x: 520, y: 330, face: 1, pose: 'think', depth: 330 },
      order: '',
      S: 1,
      // the view (layout() keeps these in step with the box)
      W: 400, x0: 300, k: 1, offX: 0, offY: 0, bw: 0, bh: 0,
      yard: null, home: null, col: { x: 0, y: 0, s: 1 },
      active: null, plan: null, held: null, done: new Set(), pickS: null,
      // the line: its layers, the package riding it, how far the belt has run
      line: { back, front, items, item: null, cls: null, slats: q(back, '.fl-slats'), spokes: q(back, '.fl-spokes'), pos: 0, drawn: null, idle: null, lastD: null },
      // the grocery shelf: one slot per student in the round (id -> its package)
      shelf: {
        g: shelf, frame: q(shelf, '.fs-frame'), boards: q(shelf, '.fs-boards'), empty: q(shelf, '.fs-empty'), packs: q(shelf, '.fs-packs'),
        count: q(shelf, '.fs-count rect'), countT: q(shelf, '.fs-count text'), sold: q(shelf, '.fs-sold'),
        items: new Map(), geom: null, filled: 0, cls: null,
      },
      fixed: [{ id: '#pen', g: penFront, depth: PEN.front }],
      partyUntil: 0,
      picked: null, total: 0, full: false, wasFull: undefined, off: false, pouring: false,
      incoming: new Map(),                       // id -> where it hops out of its package (not in the pen yet)
      sound: false, cluckAcc: 0, stepAt: 0,
      last: 0, timers: [],
    };
    v.sign = el.querySelector('.fy-sign');
    v.svg.insertBefore(col, v.actors);
    v.actors.appendChild(fg);
    v.actors.appendChild(penFront);
    v.shadows.appendChild(fsh);
    views.set(doc, v);
    shelfFrame(v);
    setView(v, 400, 300);
    v.pourBtn.addEventListener('click', (e) => { e.stopPropagation(); pour(v); });
    v.pourBtn.addEventListener('keydown', (e) => e.stopPropagation());
    const win = doc.defaultView;
    renderSign(v);
    if (doc.fonts) doc.fonts.ready.then(() => { v.signKey = null; renderSign(v); });
    doc.addEventListener('teacherpal:profile', () => refreshProfile(v));
    doc.addEventListener('teacherpal:farmer', () => refreshProfile(v));
    win.addEventListener('storage', (e) => { if (e.key === 'teacherpal.session') refreshProfile(v); });
    if (win.ResizeObserver) new win.ResizeObserver(() => layout(v)).observe(el);
    layout(v);
    const frame = (t) => { step(v, t); win.requestAnimationFrame(frame); };
    win.requestAnimationFrame(frame);
    return el;
  }

  // The scene is 400 units tall and as wide as the box allows: the viewBox
  // grows sideways round the middle of the drawing.
  function layout(v) {
    const bw = v.el.clientWidth, bh = v.el.clientHeight;
    if (!bw || !bh) return;
    const W = Math.round(clamp((400 * bw) / bh, 360, 1500));
    v.bw = bw; v.bh = bh;
    v.k = Math.min(bw / W, bh / 400);
    v.offX = (bw - W * v.k) / 2;
    v.offY = bh - 400 * v.k;
    v.el.style.setProperty('--u', `${v.k.toFixed(4)}px`);
    if (W === v.W && v.yard) { if (v.nameBird) placeName(v); placeShelfBurst(v); return; }
    setView(v, W, MID - W / 2);
    assignHomes(v);
    const f = v.farmer;
    if (!v.active) {
      if (v.held) f.x = clamp(f.x, v.x0 + 40, v.x0 + W - 30);
      else { f.x = v.home.x; f.y = v.home.y; f.face = 1; }
    }
    if (v.nameBird) placeName(v);
  }
  function setView(v, W, x0) {
    v.W = W; v.x0 = x0;
    v.svg.setAttribute('viewBox', `${x0.toFixed(1)} 0 ${W} 400`);
    // the column: a little under a third of the width (more in a narrow
    // window), standing on the bottom of the box
    const cw = clamp(W * (W >= 700 ? 0.31 : 0.42), 150, COL_W * 0.95), cs = cw / COL_W;   // ≤ 0.95: the hopper's rim stays in the box
    const c = v.col = { x: x0 + W - 6 - cw, y: 400 - 400 * cs, s: cs };
    v.colG.setAttribute('transform', `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) scale(${cs.toFixed(4)})`);
    // the pen: the rest of the width, the farmer's spot by its front right corner
    const Y = v.yard = { l: x0 + 16, r: c.x - 14, ...PEN };
    v.home = { x: penR(Y, 332) - 26, y: 332 };
    const fence = penMarkup(Y);
    v.penBack.innerHTML = fence.back;
    v.penFront.innerHTML = fence.front;
    placeShelfBurst(v);
    placeSign(v);
  }
  // The pen's fence: posts and two rails along each side, the back and sides
  // behind the flock, the front among the actors so it stands in front of it.
  function penMarkup(Y) {
    const f = (n) => n.toFixed(1);
    const run = (x0, y0, x1, y1, step) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, (y1 - y0) * 1.6) / step));
      const pts = [];
      for (let i = 0; i <= n; i++) { const u = i / n, y = lerp(y0, y1, u); pts.push({ x: lerp(x0, x1, u), y, h: 25 * persp(y), w: 4 * persp(y) }); }
      const rail = (k) => `M${pts.map((p) => `${f(p.x)} ${f(p.y - p.h * k)}`).join('L')}`;
      return pts.map((p) => `<rect class="fy-pen-post o" x="${f(p.x - p.w / 2)}" y="${f(p.y - p.h - 1.5)}" width="${f(p.w)}" height="${f(p.h + 1.5)}" rx="1"/>`).join('')
        + `<path class="fy-pen-rail" d="${rail(0.38)}${rail(0.78)}"/>`;
    };
    const bl = penL(Y, Y.back), br = penR(Y, Y.back), fl = penL(Y, Y.front), fr = penR(Y, Y.front);
    return {
      back: `<path class="fy-pen-floor" d="M${f(bl)} ${Y.back}H${f(br)}L${f(fr)} ${Y.front}H${f(fl)}Z"/>`
        + run(bl, Y.back, br, Y.back, 42) + run(bl, Y.back, fl, Y.front, 34) + run(br, Y.back, fr, Y.front, 34),
      front: run(fl, Y.front, fr, Y.front, 46),
    };
  }
  // scene units -> px in the box
  const toPx = (v, x, y) => ({ x: v.offX + (x - v.x0) * v.k, y: v.offY + y * v.k });

  // ---------- turkeys ----------
  // the little name on its body: first names as the wheel labels them, long ones cut
  const shortName = (s) => { s = String(s || ''); return s.length > 9 ? `${s.slice(0, 8).trimEnd()}…` : s; };
  function setTag(b) {
    const t = shortName(b.label);
    if (t === b.tagText) return;
    b.tagText = t;
    b.tag.textContent = t;
    b.tag.style.fontSize = `${Math.min(6.2, 22 / (Math.max(3, t.length) * 0.56)).toFixed(2)}px`;
  }
  function makeBird(v, item) {
    const doc = v.doc;
    const g = svgEl(doc, 'g', `fy-turkey p${palOf(item.id)}`);
    const h = hash(item.id + 'a'), h2 = hash(item.id + 'b');
    // every bird pecks, bobs, flaps, ruffles and looks about on its own beat
    g.setAttribute('style', `--peck:${(2.4 + (h % 1000) / 1000 * 2.6).toFixed(2)}s;--peck-d:${-((h >>> 10) % 3000)}ms;--flap:${(7 + ((h >>> 4) % 1000) / 1000 * 6).toFixed(2)}s;--flap-d:${-((h >>> 14) % 9000)}ms;--bob-d:${-((h >>> 6) % 900)}ms;`
      + `--ruf:${(8 + (h2 % 1000) / 1000 * 9).toFixed(2)}s;--ruf-d:${-((h2 >>> 10) % 12000)}ms;--look:${(5 + ((h2 >>> 3) % 1000) / 1000 * 5).toFixed(2)}s;--look-d:${-((h2 >>> 13) % 9000)}ms`);
    g.innerHTML = TURKEY;
    const sh = shade(doc, 44, 8, 11);
    v.actors.appendChild(g);
    v.shadows.appendChild(sh);
    const b = {
      id: item.id, label: item.label, g, sh, tag: g.querySelector('.fy-tag'), tagText: null, tagFace: 0,
      k: 0.92 + (hash(item.id + 'k') % 1000) / 1000 * 0.16,
      ord: hash(item.id + 'o'),
      hx: 0, hy: 0,                               // home spot in the yard
      px: 0, py: 0,                               // where it has wandered to
      tx: 0, ty: 0, nextWander: 0,                // where it is wandering to
      nextTurn: performance.now() + 1500 + (h2 % 6000),   // when it next turns round to look the other way
      ox: 0, oy: 0,                               // shuffled away from the farmer
      phase: '',                                  // once picked: hoisted, tossed, then on the line and the shelf
      x: 0, y: 0, z: 0, sc: 1, face: (h & 1) ? 1 : -1,
      mode: 'yard', placed: false, fly: null, cls: '',
    };
    setTag(b);
    return b;
  }

  // Draw the current list: add new turkeys, drop missing ones (the held one
  // is packed on the shelf; anyone taken off just fades), keep the rest.
  function sync(doc, list) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    const ids = new Set(list.map((x) => x.id));
    for (const [id, b] of v.birds) {
      if (ids.has(id)) continue;
      if (v.active && v.active.winnerId === id) continue;
      v.birds.delete(id);
      if (b === v.held) { v.held = null; hideName(v); if (!v.active) setPose(v, 'think'); }
      if (b.mode === 'held') drop(v, b);         // it's packed: on the shelf (v.picked) or nowhere
      else { b.mode = 'gone'; b.g.classList.add('leaving'); v.leaving.push(b); setTimeout(() => drop(v, b), 420); }
    }
    for (const item of list) {
      let b = v.birds.get(item.id);
      if (!b) {
        b = makeBird(v, item);
        v.birds.set(item.id, b);
        const from = v.incoming.get(item.id);
        if (from) { b.from = from; v.incoming.delete(item.id); }
        else if (v.built) { b.g.classList.add('born'); setTimeout(() => b.g.classList.remove('born'), 500); }
      }
      b.label = item.label;
      setTag(b);
    }
    v.built = true;
    assignHomes(v);
    renderShelf(v);
  }
  function drop(v, b) {
    b.g.remove(); b.sh.remove();
    v.leaving = v.leaving.filter((q) => q !== b);
  }
  const isPopout = (v) => v.doc.body.classList.contains('wheel-popout');

  // Home spots: staggered rows across the pen, so the flock reads as a
  // crowd at any class size and any width. Each row gets turkeys in
  // proportion to its width (the pen narrows a little toward the back), and
  // they are as big as the tightest row's spacing allows.
  function makeHomes(Y, n) {
    if (!n) return { pts: [], cw: 60 };
    const H = Y.y1 - Y.y0;
    const span = (y) => [penL(Y, y) + 14, penR(Y, y) - 12];
    const m = span((Y.y0 + Y.y1) / 2);
    const rows = clamp(Math.round(Math.sqrt((n * H * 1.8) / Math.max(40, m[1] - m[0]))), 1, 6);
    const ys = [], ws = [];
    for (let r = 0; r < rows; r++) {
      const y = rows === 1 ? Y.y0 + H * 0.55 : Y.y0 + (r / (rows - 1)) * H;
      const [a, b] = span(y);
      ys.push(y); ws.push(Math.max(20, b - a));
    }
    // turkeys per row, in proportion to its width (largest remainder)
    const tot = ws.reduce((a, b) => a + b, 0);
    const raw = ws.map((w) => (n * w) / tot), cnt = raw.map(Math.floor);
    let spare = n - cnt.reduce((a, b) => a + b, 0);
    raw.map((x, i) => [x - cnt[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (spare > 0) { cnt[i]++; spare--; } });
    const cw = Math.min(...ws.map((w, i) => (cnt[i] ? w / cnt[i] : Infinity)));
    const pts = [];
    ys.forEach((y, r) => {
      const a = span(y)[0], w = ws[r], c = w / Math.max(1, cnt[r]);
      const x0 = a + (r % 2 ? c * 0.3 : -c * 0.1);
      for (let i = 0; i < cnt[r]; i++) pts.push({ x: clamp(x0 + c * (i + 0.5), a, a + w), y });
    });
    return { pts, cw };
  }
  function assignHomes(v) {
    const list = [...v.birds.values()].filter((b) => b.mode !== 'held').sort((a, b) => a.ord - b.ord);
    const n = list.length;
    const { pts: homes, cw } = makeHomes(v.yard, n);
    v.S = clamp(cw / 44, 0.75, 1.3);
    list.forEach((b, i) => {
      const hm = homes[i] || { x: (v.yard.l + v.yard.r) / 2, y: 300 };
      const jx = ((hash(b.id + 'x') % 1000) / 1000 - 0.5) * 10, jy = ((hash(b.id + 'y') % 1000) / 1000 - 0.5) * 6;
      b.hx = hm.x + jx; b.hy = hm.y + jy;
      if (b.from) {                              // hopped out of its package: back to its spot
        b.x = b.from.x; b.y = b.from.y; b.z = b.from.z; b.sc = b.from.draw / (v.S * b.k * persp(b.from.y));
        startFly(v, b, { x: b.hx, y: b.hy, z: 0, sc: 1 }, { delay: b.from.delay, dur: 760, lift: 70, tumble: true });
        b.px = b.hx; b.py = b.hy; b.tx = b.hx; b.ty = b.hy;
        b.from = null; b.placed = true;
      } else if (!b.placed) {
        b.px = b.tx = b.x = b.hx; b.py = b.ty = b.y = b.hy; b.placed = true;
      }
    });
  }
  function startFly(v, b, to, { delay = 0, dur = 650, lift = 40, tumble = false } = {}) {
    b.mode = 'fly';
    b.tumble = tumble && !reduced(v.doc);
    b.fly = { from: { x: b.x, y: b.y, z: b.z, sc: b.sc }, to, t0: performance.now() + delay, dur: reduced(v.doc) ? 250 : dur, lift: reduced(v.doc) ? 0 : lift };
  }

  // ---------- the loop ----------
  function step(v, t) {
    const dt = Math.min(0.033, v.last ? (t - v.last) / 1000 : 0.016);
    v.last = t;
    if (!isOn(v.doc) || !v.el.offsetParent) return;      // other themes: idle
    const s = v.active;
    const el = s ? Date.now() - s.startedAt : 0;
    const f = v.farmer;
    if (s && v.plan) farmerStep(v, el);
    let near = 0;
    for (const b of v.birds.values()) {
      if (b.mode === 'yard') near += yardStep(v, b, el, dt, t);
      else if (b.mode === 'fly') flyStep(v, b, t);
      else if (b.mode === 'held') heldStep(v, b, el);
    }
    lineTick(v, t);
    // clucking rises as he passes: more nervous birds, faster and higher
    if (s && v.sound && el < T.point) {
      v.cluckAcc += dt * (0.8 + near * 2.6);
      if (v.cluckAcc >= 1) { v.cluckAcc = rnd(-0.2, 0.2); cluck(Math.min(1, near / 3)); }
    }
    if (s && v.sound && f.pose === 'walk' && t - v.stepAt > 190) { v.stepAt = t; footstep(); }
    paint(v);
  }

  // A turkey in the yard: wander about its spot (pecking and flapping are
  // CSS), shuffle away from the farmer when he comes close.
  function yardStep(v, b, el, dt, now) {
    const f = v.farmer, p = v.plan, s = v.active;
    const role = p ? p.roles.get(b.id) : null;
    let cls = '';
    let scared = 0;
    if (role === 'sneak' && s && el > T.start + 250 && el < T.point + 600) {
      // tiptoeing off toward the edge of the yard, hoping nobody notices
      const gx = p.sneakTo, d = gx - b.px;
      b.px += Math.sign(d) * Math.min(Math.abs(d), 34 * dt);
      b.face = d < 0 ? 1 : -1;
      cls = Math.abs(d) > 0.5 ? 'sneak' : 'sneak still';
    } else if (role === 'decoy' || role === 'winner') {
      // he's coming to look at this one: it stays put
      const st = p.stops.find((q) => q.bird === b);
      if (role === 'decoy' && st) {
        if (el >= st.t0 && el < st.t0 + LEAN + 60) { cls = 'inspected'; b.face = f.x < b.x ? 1 : -1; }
        else if (el >= st.t0 + LEAN + 60 && el < st.t1 + RELIEF_MS) cls = 'relief';
      }
    } else {
      // milling about
      if (now > b.nextWander) {
        b.nextWander = now + rnd(1800, 5200);
        b.tx = b.hx + rnd(-9, 9); b.ty = b.hy + rnd(-5, 5);
      }
      const dx = b.tx - b.px, dy = b.ty - b.py, d = Math.hypot(dx, dy);
      // if its spot moved (someone left the flock) it walks there briskly
      const sp = Math.hypot(b.hx - b.px, b.hy - b.py) > 14 ? 40 : 10;
      if (d > 0.6) {
        const k = Math.min(1, (sp * dt) / d);
        b.px += dx * k; b.py += dy * k;
        if (Math.abs(dx) > 0.3) b.face = dx < 0 ? 1 : -1;
        cls = 'walking';
      } else if (now > b.nextTurn) {
        // standing about: now and then it turns round to look the other way
        b.nextTurn = now + rnd(2600, 8000);
        b.face = -b.face;
      }
    }
    // shuffle away from the farmer while he's on the move
    let wx = 0, wy = 0;
    if (s && el < T.point + 200 && role !== 'decoy' && role !== 'winner') {
      const dx = b.px - f.x, dy = (b.py - f.y) * 1.7, d = Math.hypot(dx, dy) || 0.01;
      if (d < SCARE_R) {
        scared = 1 - d / SCARE_R;
        const push = (SCARE_R - d) * 0.55;
        wx = (dx / d) * push; wy = (dy / d) * push * 0.5 - push * 0.25;   // ...and a little back, behind the others
        if (role !== 'sneak') cls = 'scared';
      }
    }
    // once he points, the neighbours edge away from the chosen one, so it stands clear
    const w = s && el >= T.point - 150 && role !== 'winner' ? v.birds.get(s.winnerId) : null;
    if (w && w.mode === 'yard') {
      const R = 40 * v.S, dx = b.px - w.x, dy = (b.py - w.y) * 1.6, d = Math.hypot(dx, dy) || 0.01;
      if (d < R) {
        const push = (R - d) * 0.9;
        wx += (dx / d) * push; wy += (dy / d) * push * 0.6;
        scared = Math.max(scared, 0.3);
        if (role !== 'sneak') cls = 'scared';
      }
    }
    const k = Math.min(1, dt * (scared ? 6 : 2.2));
    b.ox += (wx - b.ox) * k; b.oy += (wy - b.oy) * k;
    // penned in: never through the fence
    const Y = v.yard;
    b.y = clamp(b.py + b.oy, Y.y0 - 10, Y.y1 + 8);
    b.x = clamp(b.px + b.ox, penL(Y, b.y) + 8, penR(Y, b.y) - 6);
    b.z = 0; b.sc += (1 - b.sc) * Math.min(1, dt * 6);
    setCls(b, cls);
    return scared;
  }
  function setCls(b, cls) {
    if (b.cls === cls) return;
    if (b.cls) b.cls.split(' ').forEach((c) => b.g.classList.remove(c));
    if (cls) cls.split(' ').forEach((c) => b.g.classList.add(c));
    b.cls = cls;
  }
  function flyStep(v, b, now) {
    const f = b.fly;
    const u = clamp((now - f.t0) / f.dur, 0, 1);
    if (u <= 0) { setCls(b, 'waiting'); return; }   // still in its package, its turn to come out
    const e = easeInOut(u);
    b.x = f.from.x + (f.to.x - f.from.x) * e;
    b.y = f.from.y + (f.to.y - f.from.y) * e;
    b.z = f.from.z + (f.to.z - f.from.z) * e + f.lift * Math.sin(Math.PI * u);
    b.sc = f.from.sc + ((f.to.sc ?? 1) - f.from.sc) * e;
    if (Math.abs(f.to.x - f.from.x) > 1) b.face = f.to.x < f.from.x ? 1 : -1;
    setCls(b, b.tumble ? 'flying tumbling' : 'flying');
    if (u >= 1) { b.mode = 'yard'; b.fly = null; b.tumble = false; b.px = b.x; b.py = b.y; b.ox = b.oy = 0; setCls(b, ''); }
  }
  function setPhase(b, ph) {
    if (b.phase === ph) return;
    PHASES.forEach((c) => b.g.classList.remove(c));
    if (ph) ph.split(' ').forEach((c) => b.g.classList.add(c));
    b.phase = ph;
  }
  // The picked turkey after the point: hoisted over his head, then lobbed in
  // an arc over the fence and into the hopper on top of the line. From then
  // on the line's package is it (phase 'away' hides this one), and then the
  // shelf ('shelved').
  function heldStep(v, b, el) {
    if (b.phase === 'away' || b.phase === 'shelved') return;
    const f = v.farmer, fs = persp(f.y);
    const E = v.active ? el : 1e9;
    const over = { x: f.x, y: f.y + 1, z: LIFT_Z * fs, sc: HELD_GROW };
    if (E < T.toss) {                            // up over his head
      const e = easeOut(clamp((E - T.grab) / (T.grabEnd - T.grab), 0, 1));
      const from = b.liftFrom || over;
      b.x = lerp(from.x, over.x, e); b.y = lerp(from.y, over.y, e);
      b.z = over.z * e; b.sc = lerp(1, over.sc, e);
      setPhase(b, 'held caught');
      return;
    }
    const m = hopperPoint(v, b);
    const u = clamp((E - T.toss) / (T.drop - T.toss), 0, 1);   // wheee: up, over the fence and in
    b.x = lerp(over.x, m.x, u); b.y = lerp(over.y, m.y, u);
    // up early, then across into the mouth: the hopper is near the top of the box, so the arc stays low
    b.z = lerp(over.z, m.z, 1 - (1 - u) ** 2) + 16 * fs * Math.sin(Math.PI * u);
    b.sc = lerp(over.sc, m.sc, Math.sqrt(u));   // shrinks early, so it stays on screen as it nears the top
    b.face = m.x < over.x ? 1 : -1;
    setPhase(b, 'tossed');
  }
  // the hopper's mouth, as a turkey dropping into it would be drawn there
  // (feet, height off the ground, scale)
  function hopperPoint(v, b) {
    const c = v.col, y = 392;
    return { x: c.x + HOPPER.x * c.s, y, z: y - (c.y + (HOPPER.y + 4) * c.s), sc: (0.42 * c.s) / (v.S * b.k * persp(y)) };
  }

  // ---------- the farmer's walk ----------
  function farmerStep(v, el) {
    const f = v.farmer, p = v.plan;
    let pose = 'walk';
    const seg = p.segs.find((q) => el < q.t1) || p.segs[p.segs.length - 1];
    if (el < T.start) pose = 'think';
    else if (seg.type === 'walk') {
      const u = clamp((el - seg.t0) / (seg.t1 - seg.t0), 0, 1), e = easeInOut(u);
      f.x = seg.from.x + (seg.to.x - seg.from.x) * e;
      f.y = seg.from.y + (seg.to.y - seg.from.y) * e;
      if (Math.abs(seg.to.x - seg.from.x) > 2) f.face = seg.to.x < seg.from.x ? 1 : -1;
      pose = u >= 1 ? 'lean' : 'walk';
    } else if (seg.type === 'dwell') {
      f.x = seg.at.x; f.y = seg.at.y;
      f.face = seg.bird.x < f.x ? 1 : -1;
      pose = el - seg.t0 < LEAN ? 'lean' : 'nope';
    }
    if (el >= T.point) {
      const w = p.winnerStop;
      f.x = w.at.x; f.y = w.at.y;
      if (el < T.grab) { f.face = w.bird.x < f.x ? 1 : -1; pose = 'point'; }
      else {
        f.face = v.col.x + HOPPER.x * v.col.s < f.x ? 1 : -1;   // turned to the hopper
        pose = el < T.toss ? 'lift' : el < T.drop + 240 ? 'toss' : 'cheer';
      }
    }
    once(v, 'freeze', el >= T.freeze, freeze);
    once(v, 'grab', el >= T.grab, lift);
    once(v, 'toss', el >= T.toss, () => v.sound && whoosh());
    setPose(v, pose);
  }
  const once = (v, key, due, fn) => { if (due && !v.done.has(key)) { v.done.add(key); fn(v); } };
  function setPose(v, pose) {
    const f = v.farmer;
    if (f.pose === pose) return;
    f.pose = pose;
    f.g.dataset.pose = pose;
  }

  // ---------- the production line ----------
  // Its clock is the pick's (T, from v.pickS, so it carries on after the
  // pick is over): how far down the belt the package is (routeD(), then
  // beltAt() for the spot), the machines' moments (classes on the front
  // layer), the package's look (classes on it). The belt creeps on in little
  // steps between picks, and during one it moves exactly with the package.
  function routeD(el) {
    if (el <= ROUTE[0][0]) return ROUTE[0][1];
    for (let i = 0; i < ROUTE.length - 1; i++) {
      const [t0, d0] = ROUTE[i], [t1, d1] = ROUTE[i + 1];
      if (el < t1) return d0 === d1 ? d0 : lerp(d0, d1, easeInOut((el - t0) / (t1 - t0)));
    }
    return ROUTE[ROUTE.length - 1][1];
  }
  // a package's spot (the bottom of its tray) at distance d along the belt,
  // tilting a little as it goes round a pulley
  function beltAt(d) {
    const B = BELT;
    let x, y, rot = 0;
    if (d <= SEG.a) { x = B.ax + d; y = B.ay; }
    else if (d <= SEG.r) {
      const u = (d - SEG.a) / (SEG.r - SEG.a), a = Math.PI * (u - 0.5);
      x = B.rx + B.rr * Math.cos(a); y = (B.ay + B.by) / 2 + B.rr * Math.sin(a); rot = 16 * Math.sin(Math.PI * u);
    } else if (d <= SEG.b) { x = B.rx - (d - SEG.r); y = B.by; }
    else if (d <= SEG.l) {
      const u = (d - SEG.b) / (SEG.l - SEG.b), a = -Math.PI * (0.5 + u);
      x = B.lx + B.lr * Math.cos(a); y = (B.by + B.cy) / 2 + B.lr * Math.sin(a); rot = -16 * Math.sin(Math.PI * u);
    } else { x = B.lx + (d - SEG.l); y = B.cy; }
    return { x, y: y - 3.5, rot };
  }
  const within = (el, a, b) => el >= a && el < b;
  function lineTick(v, now, elAt) {
    const el = elAt ?? (v.pickS ? Date.now() - v.pickS.startedAt : 1e9);
    const ln = v.line;
    let cls = '';
    if (within(el, T.drop - 40, T.drop + 420)) cls += ' gulp';
    if (within(el, T.drop, T.outOven + 80)) cls += ' cooking';
    if (within(el, T.outOven - 90, T.outOven + 220)) cls += ' out-open';
    if (within(el, T.outOven, T.outOven + 800)) cls += ' puff';
    if (within(el, T.stamp, T.stamp + 320)) cls += ' stamp';
    if (within(el, T.slap - 60, T.slap + 260)) cls += ' slap';
    if (ln.cls !== cls) { ln.cls = cls; ln.front.setAttribute('class', `fy-line-f${cls}`); }
    // the moments, once each
    if (v.active) {
      once(v, 'drop', el >= T.drop, intoHopper);
      once(v, 'reveal', el >= T.drop, reveal);
      if (v.sound) {
        once(v, 'out', el >= T.outOven, () => { ding(); hiss(); });
        once(v, 'go', el >= T.outOven + 40, clack);
        once(v, 'stamp', el >= T.packed - 10, thump);
        once(v, 'go2', el >= T.leavePack, clack);
        once(v, 'slap', el >= T.slap, click);
        once(v, 'go3', el >= T.leaveLabel, clack);
      }
    }
    const it = ln.item;
    if (it && el >= T.shelf) shelve(v);
    else if (it) {
      let x, y, sc = PK_B, rot = 0;
      if (el < T.end) {
        const p = beltAt(routeD(el));
        x = p.x; y = p.y; rot = p.rot;
      } else {                                   // off the end of the belt and down onto its slot on the shelf
        if (!it.to) it.to = shelfTarget(v, it.id);
        const u = clamp((el - T.end) / (T.shelf - T.end), 0, 1), e = easeInOut(u), p = beltAt(ST.end);
        x = lerp(p.x, it.to.x, e);
        y = lerp(p.y, it.to.y, e) - 22 * Math.sin(Math.PI * u);
        sc = lerp(PK_B, it.to.s, e);
        rot = Math.sin(Math.PI * 2 * u) * 6;
      }
      const k = `${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${sc.toFixed(3)}`;
      if (k !== it.k) { it.k = k; it.g.setAttribute('transform', `translate(${k})`); }
      let c = '';
      if (el < T.outOven) c += ' inside';
      if (within(el, T.outOven, T.outOven + 320)) c += ' emerge';
      if (within(el, T.outOven, T.outOven + 1600)) c += ' steaming';
      if (el >= T.packed) c += ' packed';
      if (within(el, T.packed, T.packed + 220)) c += ' squash';
      if (el >= T.slap) c += ' labelled';
      if (within(el, T.slap, T.slap + 300)) c += ' slapped';
      if (c !== it.cls) { it.cls = c; it.g.setAttribute('class', `fy-pack${c}`); }
    }
    beltStep(v, now, el);
    const sh = v.shelf;
    const scls = `${v.full ? ' full' : ''}${now < v.partyUntil ? ' party' : ''}${v.picked ? ' counting' : ''}`;
    if (sh.cls !== scls) { sh.cls = scls; sh.g.setAttribute('class', `fy-shelf${scls}`); }
  }
  // the belt: 10 units every 0.9s between picks (a gentle mechanical
  // rhythm), exactly the package's travel during one; the pulleys turn with it
  function beltStep(v, now, el) {
    const ln = v.line;
    const ph = now / 900;
    const idle = Math.floor(ph) * 10 + 10 * easeInOut(Math.min(1, (ph % 1) / 0.6));
    if (ln.item && el >= T.outOven && el < T.end) {
      const d = routeD(el);
      if (ln.lastD != null) ln.pos += d - ln.lastD;
      ln.lastD = d;
    } else {
      ln.lastD = null;
      if (ln.idle != null && !reduced(v.doc)) ln.pos += idle - ln.idle;
    }
    ln.idle = idle;
    if (ln.drawn !== null && Math.abs(ln.pos - ln.drawn) < 0.1) return;
    ln.drawn = ln.pos;
    ln.slats.style.strokeDashoffset = (-ln.pos % 10).toFixed(2);
    const f = (n) => n.toFixed(2);
    const spokes = (cx, cy, r, a) => [0, 1, 2].map((i) => {
      const t = a + (i * Math.PI) / 3, dx = Math.cos(t) * r, dy = Math.sin(t) * r;
      return `M${f(cx - dx)} ${f(cy - dy)}L${f(cx + dx)} ${f(cy + dy)}`;
    }).join('');
    const B = BELT;
    ln.spokes.setAttribute('d', spokes(B.rx, (B.ay + B.by) / 2, B.rr - 8, ln.pos / B.rr) + spokes(B.lx, (B.by + B.cy) / 2, B.lr - 8, -ln.pos / B.lr));
  }
  // the turkey drops into the hopper: from here the line's package is it
  // (cooking out of sight until it comes out of the oven)
  function intoHopper(v) {
    const b = v.held;
    if (!b) return;
    const ln = v.line;
    if (ln.item) ln.item.g.remove();
    const g = makePack(v, b.label, 'inside');
    ln.items.appendChild(g);
    ln.item = { g, id: b.id, cls: null, k: '', to: null };
    setPhase(b, 'away');
    if (v.sound) { thud(); rumble(); }
  }
  // ...and it lands on the shelf, with a bounce
  function shelve(v) {
    const ln = v.line, it = ln.item, b = v.held;
    ln.item = null;
    it.g.remove();
    if (!b || b.id !== it.id) return;
    setPhase(b, 'shelved');
    renderShelf(v);
    const p = v.shelf.items.get(b.id);
    if (p) { p.g.classList.add('landed'); setTimeout(() => p.g.classList.remove('landed'), 700); }
    if (v.sound && v.active) plunk();
  }

  // ---------- the grocery shelf ----------
  // One slot per student in the round (No repeats on), filled from the top
  // shelf down, left to right, the empty ones dashed, so the round's
  // progress reads at a glance; six slots and only the current winner with
  // No repeats off. Rows and columns give the biggest package that fits
  // (shelfGeom()). Column units, like the rest of the line.
  function shelfFrame(v) {
    const sh = v.shelf, { x, w } = SH, f = (n) => n.toFixed(1), top = SH.sign + 21;
    sh.frame.innerHTML = `<rect class="fs-back" x="${x + 6}" y="${top}" width="${w - 12}" height="${SH.base - top}"/>`
      + `<rect class="fs-post o" x="${x}" y="${top - 2}" width="7" height="${SH.base - top + 2}" rx="2"/>`
      + `<rect class="fs-post o" x="${x + w - 7}" y="${top - 2}" width="7" height="${SH.base - top + 2}" rx="2"/>`
      + `<rect class="fs-kick o" x="${x}" y="${SH.rows1}" width="${w}" height="${SH.base - SH.rows1}" rx="2"/>`
      + `<rect class="fs-sign o" x="${x - 3}" y="${SH.sign}" width="${w + 6}" height="21" rx="5"/>`
      + `<text class="fs-sign-t" x="${f(x + w / 2)}" y="${SH.sign + 10.8}">FRESH TURKEYS</text>`;
    const c = sh.count;
    c.setAttribute('x', f(x + w / 2 - 22)); c.setAttribute('y', SH.rows1 + 1.5); c.setAttribute('width', 44); c.setAttribute('height', 9.5);
    sh.countT.setAttribute('x', f(x + w / 2)); sh.countT.setAttribute('y', SH.rows1 + 6.4);
    // the SOLD OUT sign, over the shelf's own sign, on two short chains
    const a = w * 0.47;
    sh.sold.setAttribute('transform', `translate(${f(x + w / 2)} ${SH.sign + 10.5})`);
    sh.sold.querySelector('.fs-string').setAttribute('d', `M${f(-a * 0.6)}-16V-30M${f(a * 0.6)}-16V-30`);
    const b = sh.sold.querySelector('.fs-sold-b');
    b.setAttribute('x', f(-a)); b.setAttribute('y', -17); b.setAttribute('width', f(2 * a)); b.setAttribute('height', 34);
  }
  function shelfGeom(n) {
    const W = SH.w - 12, H = SH.rows1 - SH.rows0;
    let best = null;
    for (let r = 1; r <= 9; r++) {
      const c = Math.ceil(n / r), cw = W / c, rh = H / r;
      const s = Math.min(cw / 62, (rh - 6) / 50, 1.2);
      if (!best || s > best.s + 1e-6) best = { r, c, cw, rh, s };
    }
    return best;
  }
  // a slot: the middle of the board its package stands on
  const slotPos = (G, j) => ({ x: SH.x + 6 + G.cw * ((j % G.c) + 0.5), y: SH.rows0 + G.rh * (Math.floor(j / G.c) + 1) - 5 });
  // who's on the shelf: everyone picked this round (No repeats on), in
  // order, plus the winner just landed if it isn't on the list yet
  function shelfList(v) {
    const list = v.picked ? v.picked.map((p) => ({ id: p.id, label: p.label })) : [];
    const h = v.held;
    if (h && h.phase === 'shelved' && !list.some((p) => p.id === h.id)) list.push({ id: h.id, label: h.label });
    return list;
  }
  // where a package coming off the belt lands
  function shelfTarget(v, id) {
    const list = shelfList(v);
    let j = list.findIndex((p) => p.id === id);
    const others = list.filter((p) => p.id !== id).length;
    if (j < 0) j = others;
    const n = v.picked ? Math.max(v.total, others + 1, 1) : Math.max(6, others + 1);
    const G = shelfGeom(n), q = slotPos(G, j);
    return { x: q.x, y: q.y, s: G.s };
  }
  function setPackName(g, label) {
    const t = shortName(label), n = g.querySelector('.pk-name');
    n.textContent = t;
    n.style.fontSize = `${clamp(47 / (Math.max(3, t.length) * 0.52), 6, 12.5).toFixed(2)}px`;   // small, but as big as the label allows
  }
  function makePack(v, label, cls) {
    const g = svgEl(v.doc, 'g', `fy-pack${cls ? ` ${cls}` : ''}`);
    g.innerHTML = PACK;
    setPackName(g, label);
    return g;
  }
  function renderShelf(v, leaving = null) {
    const sh = v.shelf, list = shelfList(v);
    const n = v.picked ? Math.max(v.total, list.length, 1) : Math.max(6, list.length);
    const G = sh.geom = shelfGeom(n);
    sh.filled = list.length;
    const keep = new Set(list.map((p) => p.id));
    for (const [id, it] of sh.items) {
      if (keep.has(id) || it.goneAt) continue;
      const wait = leaving && leaving.get(id);
      if (wait != null) {                        // Let them out: it bursts open, then it's gone
        it.goneAt = performance.now() + wait;
        setTimeout(() => it.g.classList.add('burst'), wait);
        setTimeout(() => dropPack(v, id, it), wait + 520);
      } else dropPack(v, id, it);
    }
    list.forEach((p, j) => {
      let it = sh.items.get(p.id);
      if (it && it.goneAt) { dropPack(v, p.id, it); it = null; }
      if (!it) {
        it = { g: makePack(v, p.label, 'packed labelled'), label: p.label };
        sh.packs.appendChild(it.g);
        sh.items.set(p.id, it);
      } else if (it.label !== p.label) { it.label = p.label; setPackName(it.g, p.label); }
      const q = slotPos(G, j);
      it.x = q.x; it.y = q.y; it.s = G.s;
      it.g.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) scale(${G.s.toFixed(3)})`);
    });
    // the boards, and a dashed outline wherever a package is still to come
    let boards = '', empty = '';
    for (let r = 0; r < G.r; r++) boards += `M${SH.x + 6} ${(SH.rows0 + G.rh * (r + 1) - 5).toFixed(1)}H${SH.x + SH.w - 6}v5H${SH.x + 6}Z`;
    const a = 28 * G.s, h = 46 * G.s;
    for (let j = list.length; j < n; j++) {
      const q = slotPos(G, j);
      empty += `M${(q.x - a).toFixed(1)} ${(q.y - 1).toFixed(1)}v${(-h).toFixed(1)}h${(2 * a).toFixed(1)}v${h.toFixed(1)}Z`;
    }
    sh.boards.setAttribute('d', boards);
    sh.empty.setAttribute('d', empty);
    paintCount(v);
  }
  function dropPack(v, id, it) {
    it.g.remove();
    if (v.shelf.items.get(id) === it) v.shelf.items.delete(id);
  }
  // where the turkey in a package on the shelf is, as a pen turkey would be drawn there
  function packScenePos(v, it) {
    const c = v.col, y = 392;
    return { x: c.x + it.x * c.s, y, z: y - (c.y + (it.y - 8 * it.s) * c.s), draw: it.s * c.s * 0.9 };
  }

  function paint(v) {
    const f = v.farmer, fs = persp(f.y);
    f.g.setAttribute('transform', `translate(${f.x.toFixed(1)} ${f.y.toFixed(1)}) scale(${(fs * f.face).toFixed(3)} ${fs.toFixed(3)})`);
    if (f.drawnFace !== f.face) {                 // the "?" reads the right way round whichever way he faces
      f.drawnFace = f.face;
      f.g.querySelector('.ff-bubble-q').setAttribute('transform', f.face < 0 ? 'translate(-62 0) scale(-1 1)' : '');
    }
    placeShade(f.sh, f.x, f.y, fs, '1');
    f.depth = f.y;
    const all = [...v.birds.values(), ...v.leaving];
    for (const b of all) {
      const sc = v.S * b.k * persp(b.y) * b.sc;
      b.g.setAttribute('transform', `translate(${b.x.toFixed(1)} ${(b.y - b.z).toFixed(1)}) scale(${(sc * b.face).toFixed(3)} ${sc.toFixed(3)})`);
      if (b.tagFace !== b.face) {                // the name reads the right way round whichever way it faces
        b.tagFace = b.face;
        b.tag.setAttribute('transform', `translate(-0.6 -14.2) scale(${b.face} 1)`);
      }
      const lift = Math.min(1, b.z / 60);
      placeShade(b.sh, b.x, b.y, sc * (1 - lift * 0.5), b.mode === 'held' || b.cls === 'waiting' ? '0' : (1 - lift * 0.9).toFixed(2));
      b.depth = (b.mode === 'held' || (b.mode === 'fly' && b.z > 4)) ? 900 + b.y : b.y;
    }
    const list = [f, ...v.fixed, ...all].sort((a, b) => a.depth - b.depth);
    const key = list.map((q) => (q === f ? '*' : q.id)).join(',');
    if (key !== v.order) {
      v.order = key;
      // move only what's out of place: re-appending a node restarts its CSS
      // animations (a caught turkey's "!" popped over and over)
      const kids = v.actors.children;
      list.forEach((q, i) => { if (kids[i] !== q.g) v.actors.insertBefore(q.g, kids[i] || null); });
    }
  }

  // ---------- a pick ----------
  // Who he looks at, where he stands, and when: all from a seeded random of
  // the descriptor, so the pop-out walks the same route.
  function makePlan(v, s) {
    const rand = seeded(hash(`${s.winnerId}:${s.startedAt}`));
    const f = v.farmer;
    // where each one is standing (or about to land, if it's hopping down)
    const pos = (b) => (b.mode === 'fly' && b.fly ? b.fly.to : { x: b.px, y: b.py });
    const yard =[...v.birds.values()].filter((b) => b.mode === 'yard' || b.mode === 'fly').sort((a, b) => (a.id < b.id ? -1 : 1));
    const winner = v.birds.get(s.winnerId);
    const others = yard.filter((b) => b !== winner);
    // the ones he looks at are on his way (a wide yard would have him zigzag
    // across the screen): turkeys along the line to the winner, else the
    // winner's neighbours. A long way means one look instead of two.
    const wp = winner ? pos(winner) : { x: f.x, y: f.y };
    const ux = wp.x - f.x, uy = wp.y - f.y, L = Math.hypot(ux, uy) || 1;
    const along = (b) => { const q = pos(b); return ((q.x - f.x) * ux + (q.y - f.y) * uy) / (L * L); };
    const off = (b) => { const q = pos(b); return Math.abs((q.x - f.x) * uy - (q.y - f.y) * ux) / L; };
    const D = others.length >= 3 ? (L > 420 ? 1 : 2) : Math.min(1, others.length);
    const onWay = others.filter((b) => along(b) > 0.12 && along(b) < 0.88 && off(b) < 90);
    const byWinner = others.filter((b) => !onWay.includes(b)).sort((a, b) => Math.hypot(pos(a).x - wp.x, pos(a).y - wp.y) - Math.hypot(pos(b).x - wp.x, pos(b).y - wp.y));
    const pool = others.slice(), decoys = [];
    const cand = onWay.slice();
    for (let i = 0; i < D; i++) {
      const b = cand.length ? cand.splice(Math.floor(rand() * cand.length), 1)[0] : byWinner.shift();
      if (!b) break;
      decoys.push(b);
      pool.splice(pool.indexOf(b), 1);
    }
    // in the order he meets them, so the walk looks like a search
    decoys.sort((a, b) => along(a) - along(b));
    const roles = new Map();
    decoys.forEach((b) => roles.set(b.id, 'decoy'));
    if (winner) roles.set(winner.id, 'winner');
    let sneakTo = 0;
    if (pool.length >= 2) {
      const sn = pool[Math.floor(rand() * pool.length)], x = pos(sn).x;
      roles.set(sn.id, 'sneak');
      const Y = v.yard, y = pos(sn).y, a = penL(Y, y) + 10, b = penR(Y, y) - 8;
      sneakTo = x < (a + b) / 2 ? Math.max(a, x - 70) : Math.min(b, x + 70);
    }
    // stand beside each one, on the side he arrives from
    let at = { x: f.x, y: f.y };
    const stops = [...decoys, winner].filter(Boolean).map((b) => {
      const q = pos(b), side = Math.sign(at.x - q.x) || 1;
      const gap = 22 * v.S * b.k * persp(q.y) + 15 * persp(q.y);
      const sy = q.y - 2;   // a step behind, so the bird stays in view, and never out of the pen
      const spot = { x: clamp(q.x + side * gap, penL(v.yard, sy) + 10, penR(v.yard, sy) - 4), y: sy };
      const st = { bird: b, at: spot, from: at, dist: Math.max(40, Math.hypot(spot.x - at.x, (spot.y - at.y) * 1.4)) };
      at = spot;
      return st;
    });
    const walkMs = (T.point - T.start) - decoys.length * DWELL;
    const sum = stops.reduce((a, q) => a + q.dist, 0) || 1;
    const segs = [];
    let t = T.start;
    stops.forEach((st, i) => {
      const w = walkMs * st.dist / sum;
      segs.push({ type: 'walk', t0: t, t1: t + w, from: st.from, to: st.at });
      t += w;
      if (i < stops.length - 1) { st.t0 = t; st.t1 = t + DWELL; segs.push({ type: 'dwell', t0: t, t1: t + DWELL, at: st.at, bird: st.bird }); t += DWELL; }
    });
    segs.push({ type: 'end', t0: T.point, t1: Infinity });
    // a long way in the time he has: he jogs
    const pace = sum / Math.max(1, walkMs) > 0.26 ? 'run' : 'walk';
    const winnerStop = winner ? stops[stops.length - 1] : { at, bird: { x: at.x - 1 } };
    return { roles, stops, segs, sneakTo, winnerStop, pace };
  }
  function run(doc, s, { sound = false } = {}) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    v.timers.forEach(clearTimeout); v.timers = [];
    hideName(v);
    // a package still on its way (a window that never got to finish): onto the shelf
    if (v.line.item) shelve(v);
    // last pick's turkey, still on the shelf (No repeats off): its package
    // bursts open and it hops back out to its spot
    const h = v.held;
    v.held = null;
    if (h && v.birds.get(h.id) === h) {
      const it = v.shelf.items.get(h.id);
      const p = it ? packScenePos(v, it) : hopperPoint(v, h);
      renderShelf(v, new Map([[h.id, 0]]));
      setCls(h, '');
      setPhase(h, '');
      h.x = p.x; h.y = p.y; h.z = p.z; h.sc = p.draw ? p.draw / (v.S * h.k * persp(p.y)) : p.sc;
      startFly(v, h, { x: h.hx, y: h.hy, z: 0, sc: 1 }, { delay: 160, dur: 700, lift: 60, tumble: true });
      if (sound) popOut();
    }
    for (const b of v.birds.values()) if (b.mode === 'fly' && b.fly && b !== h) { b.mode = 'yard'; b.x = b.px = b.fly.to.x; b.y = b.py = b.fly.to.y; b.z = 0; b.sc = 1; b.tumble = false; setCls(b, ''); }
    v.active = s;
    v.pickS = s;
    v.done = new Set();
    v.sound = sound;
    v.cluckAcc = 0;
    v.plan = makePlan(v, s);
    v.farmer.g.dataset.pace = v.plan.pace;
    v.el.dataset.state = 'walking';
    paintPour(v);
  }
  // pointed at: it freezes mid-gobble, eyes wide
  function freeze(v) {
    const b = v.active && v.birds.get(v.active.winnerId);
    if (!b) return;
    setCls(b, '');
    b.face = v.farmer.x < b.x ? 1 : -1;
    setPhase(b, 'caught');
    if (v.sound) sting();
  }
  // he grabs it: from here on it is the held turkey, on the line's timeline
  function lift(v) {
    const b = v.active && v.birds.get(v.active.winnerId);
    if (!b) return;
    b.mode = 'held';
    b.liftFrom = { x: b.x, y: b.y };
    setPhase(b, 'held caught');
    v.held = b;
  }
  // it drops into the oven: the name, large, over the farm (up until the next pick)
  function reveal(v) {
    const b = v.held;
    if (!b) return;
    showName(v, b);
    if (v.sound) gobble();
  }
  function showName(v, b) {
    const label = b.label || '';
    v.name.firstChild.textContent = label;
    v.name.title = label;
    v.nameBird = b;
    placeName(v);
    v.name.classList.remove('go');
    void v.name.offsetWidth;
    v.name.classList.add('go');
    v.burst.innerHTML = burstMarkup(v.k);
    v.burst.classList.remove('go');
    void v.burst.offsetWidth;
    v.burst.classList.add('go');
  }
  // high over the middle of the farm, as big as fits (sizes in scene units,
  // so it is the same size against the scene at any width): readable from
  // the back of the room without watching the belt
  function placeName(v) {
    const label = v.name.title || '';
    const longest = Math.max(4, ...label.split(/\s+/).map((w) => w.length));
    const mid = toPx(v, (v.x0 + v.col.x) / 2, 0).x;   // over the middle of the farm
    const left = clamp(mid, v.bw * 0.25, v.bw * 0.75);
    const room = 2 * Math.min(left, v.bw - left) * 0.94;
    let size = Math.min(64, 560 / (longest * 0.56)) * v.k;
    size = Math.min(size, room / (Math.max(4, label.length) * 0.56 + 1.2));
    const bottom = v.bh * 0.95 - size * 1.45;
    v.name.style.setProperty('--fs', `${size.toFixed(1)}px`);
    v.name.style.left = `${left.toFixed(1)}px`;
    v.name.style.bottom = `${bottom.toFixed(1)}px`;
    v.burst.style.left = `${left.toFixed(1)}px`;
    v.burst.style.bottom = `${(bottom + size * 0.6).toFixed(1)}px`;
  }
  // the party's leaves come out of the middle of the shelf
  function placeShelfBurst(v) {
    if (!v.burstShelf || !v.bw) return;
    const c = v.col, p = toPx(v, c.x + (SH.x + SH.w / 2) * c.s, c.y + 300 * c.s);
    v.burstShelf.style.left = `${p.x.toFixed(1)}px`;
    v.burstShelf.style.bottom = `${(v.bh - p.y).toFixed(1)}px`;
  }
  function hideName(v) {
    v.nameBird = null;
    v.name.classList.remove('go');
    v.burst.classList.remove('go');
  }
  // the end: the winner's package on the shelf, the name over the scene
  // (even if this window missed frames; its sounds are skipped)
  function finish(doc, s) {
    const v = views.get(doc);
    if (!v) return;
    if (!v.active) v.active = s;
    if (!v.pickS) v.pickS = s;
    if (!v.plan) v.plan = makePlan(v, s);
    const el = Math.max(T.out, Date.now() - s.startedAt);
    v.sound = false;
    farmerStep(v, el);
    for (const b of v.birds.values()) if (b.mode === 'held') heldStep(v, b, el);
    lineTick(v, performance.now(), el);
    v.active = null;
    v.plan = null;
    v.el.dataset.state = 'picked';
    setPose(v, v.held ? 'cheer' : 'think');
    paintCount(v);
    paintPour(v);
  }
  function setWinner(doc, name, state) {
    const v = views.get(doc);
    if (!v) return;
    if (!name && !state && !v.active) v.el.dataset.state = '';
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
    for (const b of v.birds.values()) if (b !== v.held || !v.picked) n++;
    v.left.textContent = v.picked ? `${n} left` : `${n} in the yard`;
    v.shelf.countT.textContent = v.picked ? `${v.shelf.filled} / ${v.total}` : '';
    paintPour(v);
  }
  function paintPour(v) {
    v.pourBtn.hidden = !v.picked || isPopout(v) || !v.picked.length || v.pouring;
    v.pourBtn.disabled = !!v.active;
    v.pourBtn.classList.toggle('primary', v.full);
  }

  // ---------- the round: everyone picked so far is on the shelf ----------
  // wheel.js calls this after every change. Anyone who was on the shelf and
  // isn't any more (Let them out, Reset, No repeats off) bursts out of their
  // package and hops back to their spot; the last slot filling drops the
  // SOLD OUT sign.
  function setPicked(doc, list, total) {
    const v = views.get(doc);
    if (!v) return;
    const before = new Map();
    for (const [id, it] of v.shelf.items) if (!it.goneAt) before.set(id, packScenePos(v, it));
    const was = new Set((v.picked || []).map((p) => p.id));
    v.picked = list;
    v.total = Math.max(total || 0, list ? list.length : 0);
    // the winner just shelved, from a list that's just been emptied, comes out too
    const h = v.held;
    if (h && h.phase === 'shelved' && was.has(h.id) && !(list || []).some((p) => p.id === h.id)) {
      v.held = null;
      hideName(v);
      setPhase(h, '');
      if (!v.active) setPose(v, 'think');
    }
    const going = [...before.keys()].filter((id) => !shelfList(v).some((p) => p.id === id));
    const gap = reduced(v.doc) ? 0 : Math.min(70, 1200 / Math.max(1, going.length));
    const leaving = new Map(going.map((id, i) => [id, 120 + i * gap]));
    renderShelf(v, leaving);
    going.forEach((id) => tumbleOut(v, id, before.get(id), leaving.get(id) + 160));
    if (going.length && soundOn(v.doc) && !isPopout(v)) {
      const c = audio();
      if (c) going.forEach((_, i) => { if (i % 3 === 0) { const at = c.currentTime + (120 + i * gap) / 1000; popAt(c, at); cluckAt(c, at + 0.12, rnd(1, 1.3), 0.05); } });
    }
    const full = !!list && v.total > 0 && list.length >= v.total;
    if (full && v.wasFull === false) celebrate(v);
    v.wasFull = full;                            // undefined until now: a page that loads full doesn't party
    v.full = full;
    paintCount(v);
  }
  // one turkey out of its package and back to its spot in the yard
  function tumbleOut(v, id, p, delay) {
    const b = v.birds.get(id);
    if (!b || b.mode === 'gone') {               // not in the yard yet: sync() picks it up
      v.incoming.set(id, { ...p, delay });
      setTimeout(() => v.incoming.delete(id), 3000);
      return;
    }
    if (b === v.held) v.held = null;
    b.g.classList.remove('born');
    setPhase(b, '');
    b.x = p.x; b.y = p.y; b.z = p.z; b.sc = p.draw / (v.S * b.k * persp(p.y));
    startFly(v, b, { x: b.hx, y: b.hy, z: 0, sc: 1 }, { delay, dur: 760, lift: 70, tumble: true });
    b.px = b.tx = b.hx; b.py = b.ty = b.hy;
  }
  // the last slot filled: SOLD OUT drops (CSS, off .full), the sign flashes,
  // leaves burst out of the shelf and the bells ring
  function celebrate(v) {
    v.partyUntil = performance.now() + PARTY_MS;
    v.burstShelf.innerHTML = burstMarkup(v.k * clamp(v.shelf.w / 200, 0.8, 1.4), 28);
    v.burstShelf.classList.remove('go');
    void v.burstShelf.offsetWidth;
    v.burstShelf.classList.add('go');
    if (soundOn(v.doc) && !isPopout(v)) fanfare();
  }

  // "Let them out": the wheel says go (a saved list asks first), then
  // wheel.js empties the round and setPicked() bursts every package open
  function pour(v) {
    if (v.pouring || v.active || !v.picked || !v.picked.length) return;
    if (!v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset-request', { cancelable: true }))) return;
    v.pouring = true;
    v.el.setAttribute('aria-disabled', 'true');
    paintPour(v);
    const n = v.picked.length;
    v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset'));   // the round starts over
    setTimeout(() => {
      v.pouring = false;
      setDisabled(v.doc, v.off);
      paintCount(v);
    }, reduced(v.doc) ? 400 : 280 + Math.min(1200, n * 70) + 900);
  }

  // ---------- sound: clucks, footsteps, a sting, a big gobble ----------
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
  // one "bok": a squawky square through a bandpass, pitch dropping
  function cluckAt(c, at, p = 1, gain = 0.05) {
    const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(640 * p, at);
    o.frequency.exponentialRampToValueAtTime(360 * p, at + 0.07);
    f.type = 'bandpass'; f.frequency.value = 1150 * p; f.Q.value = 2.6;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.085);
    o.connect(f); f.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + 0.1);
  }
  function cluck(intensity) {
    const c = audio();
    if (!c) return;
    const p = 0.9 + intensity * 0.45 + rnd(-0.06, 0.06), at = c.currentTime;
    cluckAt(c, at, p, 0.035 + intensity * 0.035);
    if (Math.random() < 0.6) cluckAt(c, at + rnd(0.09, 0.13), p * 1.08, 0.03 + intensity * 0.03);
  }
  function footstep() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(130, at); o.frequency.exponentialRampToValueAtTime(60, at + 0.08);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.06, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.1);
  }
  // pointed at: dun, dun, DUNNN
  function sting() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [[220, 0, 0.16], [207.65, 0.19, 0.16], [164.81, 0.38, 0.7]].forEach(([fr, d, len]) => {
      const o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(), at = t0 + d;
      o.type = 'sawtooth'; o.frequency.value = fr; o2.type = 'square'; o2.frequency.value = fr / 2;
      f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.08, at + 0.02);
      g.gain.setValueAtTime(0.07, at + len * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(c.destination);
      o.start(at); o2.start(at); o.stop(at + len + 0.02); o2.stop(at + len + 0.02);
    });
  }
  // a burst of filtered noise (the throw, the belt, steam, the stamp's hit)
  function noiseAt(c, at, len, { type = 'lowpass', f0 = 400, f1 = f0, q = 1, gain = 0.05 } = {}) {
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = noiseBuf;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, at); f.frequency.exponentialRampToValueAtTime(f1, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.05, len / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    n.connect(f); f.connect(g); g.connect(c.destination);
    n.start(at); n.stop(at + len + 0.02);
  }
  const whoosh = () => { const c = audio(); if (!c) return; noiseAt(c, c.currentTime, 0.42, { type: 'bandpass', f0: 450, f1: 1900, q: 1.4, gain: 0.07 }); cluckAt(c, c.currentTime + 0.05, 1.35, 0.05); cluckAt(c, c.currentTime + 0.16, 1.45, 0.045); };
  // a low thump (onto the belt, under the stamp)
  function thumpAt(c, at, f0, gain) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f0 * 0.35, at + 0.12);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.18);
  }
  // onto the belt: a soft bump and an indignant cluck
  const thud = () => { const c = audio(); if (c) { thumpAt(c, c.currentTime, 170, 0.1); cluckAt(c, c.currentTime + 0.07, 1.25, 0.045); } };
  // the belt moving on: a soft clack-clack
  const clack = () => { const c = audio(); if (c) { noiseAt(c, c.currentTime, 0.05, { type: 'bandpass', f0: 1500, q: 5, gain: 0.03 }); noiseAt(c, c.currentTime + 0.1, 0.05, { type: 'bandpass', f0: 1150, q: 5, gain: 0.025 }); } };
  // in the oven: a warm low rumble; out of it: a puff of steam
  const rumble = () => { const c = audio(); if (c) noiseAt(c, c.currentTime, 0.4, { f0: 240, f1: 140, q: 0.8, gain: 0.06 }); };
  const hiss = () => { const c = audio(); if (c) noiseAt(c, c.currentTime, 0.5, { type: 'highpass', f0: 2600, f1: 5200, gain: 0.035 }); };
  // the packer's stamp: a heavy thump with a short metal ring
  function thump() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime;
    thumpAt(c, at, 120, 0.16);
    noiseAt(c, at, 0.06, { f0: 900, gain: 0.07 });
    [[392, 0.035, 0.3], [661, 0.022, 0.22], [1045, 0.012, 0.16]].forEach(([fr, gain, len]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + len + 0.02);
    });
  }
  // the labeller: a crisp click
  function click() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, o = c.createOscillator(), g = c.createGain();
    noiseAt(c, at, 0.025, { type: 'highpass', f0: 3200, gain: 0.08 });
    o.type = 'square'; o.frequency.value = 2300;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.03, at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.04);
  }
  // onto the shelf: a light plunk
  function plunk() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(560, at); o.frequency.exponentialRampToValueAtTime(300, at + 0.12);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.08, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.18);
  }
  // a package bursting open
  const popAt = (c, at) => noiseAt(c, at, 0.09, { type: 'bandpass', f0: 900, f1: 2600, q: 1.2, gain: 0.06 });
  // the oven's timer, as the turkey comes out: one bright bell
  function ding() {
    const c = audio();
    if (c) bell(c, c.currentTime, 1568, 0.12);
  }
  function bell(c, at, f0, g0) {
    [[f0, g0, 1.5], [f0 * 2, g0 * 0.3, 0.9], [f0 * 3, g0 * 0.12, 0.5]].forEach(([fr, gain, len]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + len + 0.02);
    });
  }
  // the full shelf: a run of bells up the scale, a ding-ding and happy clucks
  function fanfare() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [1047, 1319, 1568, 2093].forEach((fr, i) => bell(c, t0 + i * 0.13, fr, 0.08));
    bell(c, t0 + 0.62, 1568, 0.1); bell(c, t0 + 0.8, 1568, 0.1);
    [0.3, 0.42, 0.55, 0.7].forEach((d, i) => cluckAt(c, t0 + d, 1.1 + i * 0.08, 0.05));
  }
  // out of a package: a springy "boing" and two pleased clucks
  function popOut() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(240, at); o.frequency.exponentialRampToValueAtTime(680, at + 0.14);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.09, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.22);
    cluckAt(c, at + 0.18, 1.2, 0.05); cluckAt(c, at + 0.3, 1.3, 0.05);
  }
  // the big one: gobble-obble-obble, a warbling sawtooth sliding down
  function gobble() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [0, 0.2, 0.38].forEach((d, i) => {
      const at = t0 + d, len = i === 2 ? 0.42 : 0.17;
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      const lfo = c.createOscillator(), lg = c.createGain();
      const trem = c.createOscillator(), tg = c.createGain(), amp = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(760 - i * 70, at);
      o.frequency.exponentialRampToValueAtTime(430 - i * 40, at + len);
      lfo.frequency.value = 26; lg.gain.value = 70;
      lfo.connect(lg); lg.connect(o.frequency);
      trem.frequency.value = 19; tg.gain.value = 0.5; amp.gain.value = 0.5;
      trem.connect(tg); tg.connect(amp.gain);
      f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.3;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
      g.gain.setValueAtTime(0.14, at + len * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(f); f.connect(amp); amp.connect(g); g.connect(c.destination);
      [o, lfo, trem].forEach((x) => { x.start(at); x.stop(at + len + 0.03); });
    });
  }

  window.Farmyard = { DURATION_MS, SETTLE_MS, HOLDS_ROUND: true, isOn, busy, build, sync, run, finish, setWinner, setDisabled, setPicked, setAbsent };
})();
