// farmyard.js — the Name Wheel's thanksgiving skin: a farmer choosing a
// turkey in a farmyard instead of the wheel.
//
// Same shape as cauldron.js / boba.js: wheel.js still owns everything that
// matters (who's in, the fair draw, No repeats, the pop-out broadcast) and
// hands this file a spin descriptor { startedAt, duration, settle, winnerId }.
// One plump cartoon turkey per student (its first name small on its body),
// milling about in front of a barn and hay bales. The farmer stands to the
// right in a big thinking pose, beside a big cartoon oven with a glass door
// and a warm glow inside. A pick (~5s, the T timeline below): he strides
// along the flock, stops at a turkey or two, leans in and shakes his head;
// the turkeys near him duck and shuffle away, and one tries to sneak off. At
// the winner he stops and POINTS; it freezes mid-gobble. He hoists it over
// his head as the oven door drops open, turns and lobs it across the yard
// into the oven (legs flailing, whee), where it lands on an empty hook of
// the rotisserie spit, which has whirled round to meet it; the door clangs,
// the timer dings, and its name rises over the oven. The turkey is in on the
// joke: it is a ride, nobody cooks. With No repeats on it stays on the spit:
// the oven is where the round collects, one hook per student, filling ring by
// ring from the bottom, the count on its door, the rings turning slowly with
// the name of whoever passes the front showing. When the last hook fills, the
// oven celebrates; "Let them out" (or Reset) opens the door and they all
// tumble back into the yard. With No repeats off the winner rides until the
// next pick, then hops back out. The decoys and the sneaker come from a
// seeded random from the descriptor, so the pop-out plays the same pick.
// Never picks anything.
(() => {
  const DURATION_MS = 3300;
  const SETTLE_MS = 1700;                          // 5s in all
  // ms from the start of a pick. The walk ends at `point`; he hoists the
  // winner (grab..grabEnd) while the oven door drops open (doorOpen), lobs it
  // (toss..land) as the spit whirls an empty hook round to the front, the
  // door clangs shut, the timer dings, and the name rises at reveal. The spit
  // holds still with the new one at the front until `rest`.
  const T = {
    start: 150, point: 2300, freeze: 2340,
    grab: 2670, doorOpen: 2760, grabEnd: 2900,
    toss: 2980, land: 3560, ding: 3900, reveal: 4200, out: 4250,
    rest: 6800,
  };
  const DWELL = 500;                               // one inspection: lean in, then shake the head
  const LEAN = 210;                                // ...of which the lean
  const RELIEF_MS = 700;                           // a turkey's hop of relief after he moves on

  // ---- the scene: 400 units tall, as wide as its box ----
  // The art is drawn across x -400..1400 around a centre of 500; the viewBox
  // is `x0 0 W 400`, W from the box's aspect (layout()), so the yard fills
  // any width. Everyone stands on the ground plane: x across, y the depth
  // (the feet), z the height above the ground (only a lifted turkey has one).
  // The oven, the farmer's spot and the yard follow the view (v.oven, v.home,
  // v.yard): the oven at the right edge, his spot beside it, the yard the rest.
  const MID = 500;
  const SUN_X = 596;                               // shadows fall away from it
  const LIFT_Z = 127;                              // a lifted turkey's feet, in farmer units (just over his hat)
  const HELD_GROW = 1.6;                           // a lifted turkey is drawn this much bigger
  const PHASES = ['caught', 'held', 'tossed', 'baked'];
  const SCARE_R = 62;                              // how close he gets before a turkey ducks
  // the oven, in its own units: feet at y 0, 170 wide, 224 to the top of its
  // control panel; the window in the door spans y -178..-78
  const OV = { hw: 85, top: 224, win: { y0: -178, y1: -78 } };
  const OV_Y = 360;                                // where its feet stand in the yard
  // the spit: each ring is an ellipse seen from the front
  const RX = 52, RRY = 8;
  const IDLE_W = (Math.PI * 2) / 36;               // one turn every 36s
  const PARTY_MS = 2800;                           // the full oven's celebration

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

  // ---------- the farmer: facing left, feet at (0, 0), about 117 units to the hat ----------
  const arm = (cls, d, hx, hy, extra = '') => `<g class="ff-a ${cls}"><path class="ff-sleeve" d="${d}"/><circle class="ff-hand o" cx="${hx}" cy="${hy}" r="3.8"/>${extra}</g>`;
  const FARMER = `
    <g class="ff-body">
      <g class="ff-leg ff-leg-b"><rect class="ff-denim o" x="1.5" y="-41" width="9.6" height="35" rx="3"/><path class="ff-boot o" d="M1-7.6H11.6C12.6-3 12.4 0 8 0H1Z"/></g>
      <g class="ff-leg ff-leg-f"><rect class="ff-denim o" x="-11" y="-41" width="9.6" height="35" rx="3"/><path class="ff-boot o" d="M-1-7.6H-10C-17-7-17.8 0-12.6 0H-1Z"/></g>
      <g class="ff-upper">
        ${arm('ff-a-think ff-back', 'M10.5-72L21-60.5 14.5-50', 14.5, -50)}
        ${arm('ff-a-walk ff-back ff-swing-b', 'M10-72L12.4-47.5', 12.4, -47)}
        ${arm('ff-a-lean ff-back', 'M10.5-72L18.5-58 10-51.5', 10, -51.5)}
        ${arm('ff-a-nope ff-back', 'M10.5-72L21-60.5 14.5-50', 14.5, -50)}
        ${arm('ff-a-point ff-back', 'M10.5-72L21-60.5 14.5-50', 14.5, -50)}
        ${arm('ff-a-lift ff-back', 'M10-74L15-98 10.5-124', 10.5, -125)}
        ${arm('ff-a-toss ff-back', 'M10.5-72L-1-88-12-104', -12.4, -105)}
        <ellipse class="ff-shirt o" cx="0" cy="-58" rx="16.5" ry="21.5"/>
        <path class="ff-check" d="M-10-74V-40M-3-79V-37M4-79V-37M11-74V-40M-15-66H15M-16.4-56H16.4M-15-47H15"/>
        <path class="ff-bib o" d="M-11.5-70H11.5V-45C11.5-40-11.5-40-11.5-45Z"/>
        <path class="ff-strap" d="M-9.5-70L-12.5-79M9.5-70L12.5-79"/>
        <circle class="ff-button" cx="-8" cy="-67" r="1.6"/><circle class="ff-button" cx="8" cy="-67" r="1.6"/>
        <path class="ff-pocket" d="M-5-63H5V-56Q0-54-5-56Z"/>
        <g class="ff-head">
          <path class="ff-hair" d="M5-98C11-99 14-94 13-88 11-91 9-92 7-91Z"/>
          <circle class="ff-skin o" cx="-1" cy="-91.5" r="12.6"/>
          <ellipse class="ff-skin o" cx="10" cy="-90.5" rx="3" ry="4.2"/>
          <circle class="ff-blush" cx="-5" cy="-86" r="3"/>
          <ellipse class="ff-nose o" cx="-12.4" cy="-89.6" rx="4.6" ry="4"/>
          <g class="ff-mouth ff-m-smile"><path d="M-11-81.6Q-8-79.4-5-81.4"/></g>
          <g class="ff-mouth ff-m-hmm"><path d="M-11-81.2H-5.4"/></g>
          <g class="ff-mouth ff-m-grin"><path class="ff-grin" d="M-13-82.4Q-8-75.6-3.2-82Z"/></g>
          <path class="ff-stache o" d="M-17.4-85.2C-14.4-88.2-10.6-87.4-8.6-85.8-6.4-87.4-2.6-87.6 0-85 -3-82.6-6.4-82.6-8.6-84.2-11-82.4-15-82.6-17.4-85.2Z"/>
          <g class="ff-eye"><circle cx="-7" cy="-95.6" r="1.7"/></g>
          <path class="ff-brow" d="M-11-100.6Q-7.4-102.8-3.4-100.4"/>
          <path class="ff-hat-crown o" d="M-11.6-101.6C-11.8-113-8.4-117.4 0-117.4 8.4-117.4 11.8-113 11.6-101.6Z"/>
          <path class="ff-hat-band" d="M-11.7-106.4H11.7V-102.4H-11.7Z"/>
          <ellipse class="ff-hat-brim o" cx="0" cy="-101.6" rx="22" ry="4.6"/>
          <path class="ff-straw" d="M-18-101.6L-15-100M-8-103L-6-100.6M6-103L4-100.6M17-101.8L14.6-100"/>
        </g>
        ${arm('ff-a-think ff-front ff-tap', 'M-10.5-72L-19-59.5-11.6-80.4', -11.6, -80.6)}
        ${arm('ff-a-walk ff-front ff-swing-f', 'M-10-72L-12.4-47.5', -12.4, -47)}
        ${arm('ff-a-lean ff-front', 'M-10.5-72L-19-59.5-11.6-80.4', -11.6, -80.6)}
        ${arm('ff-a-nope ff-front ff-wag', 'M-10.5-72L-22-73-24.6-89', -24.6, -89.6, '<path class="ff-finger" d="M-24.6-91.4V-97.6"/>')}
        ${arm('ff-a-point ff-front', 'M-10.5-72L-44-64.6', -45, -64.4, '<path class="ff-finger" d="M-47-64L-54.4-62.4"/>')}
        ${arm('ff-a-lift ff-front', 'M-10-74L-15-98-10.5-124', -10.5, -125)}
        ${arm('ff-a-toss ff-front', 'M-10.5-72L-27-82-38-98', -38.6, -99)}
      </g>
      <g class="ff-bubble"><circle cx="-17" cy="-121" r="2.4"/><circle cx="-23" cy="-128" r="3.6"/><ellipse cx="-31" cy="-142" rx="11" ry="9.6"/><text class="ff-bubble-q" x="-31" y="-137.6">?</text></g>
      <g class="ff-alarm"><text x="-24" y="-124">!</text></g>
    </g>`;

  // ---------- the oven: front on, feet at (0, 0), 170 wide, 224 tall ----------
  // The door is hinged at the bottom (y -54) and drops open. Behind its window
  // the cavity: a warm glow, a glowing coil, and the spit (filled by
  // paintSpit(): the hoops, spokes and empty hooks, the turkeys behind the rod
  // and in front of it, and the names on top).
  const OVEN = `
    <ellipse class="fy-oven-light" cx="0" cy="2" rx="130" ry="28"/>
    <g class="fy-oven-body"><g class="fy-oven-shake">
      <rect class="fy-oven-foot o" x="-74" y="-14" width="18" height="14" rx="3"/><rect class="fy-oven-foot o" x="56" y="-14" width="18" height="14" rx="3"/>
      <rect class="fy-oven-back o" x="-76" y="-224" width="152" height="30" rx="9"/>
      <circle class="fy-oven-knob o" cx="-58" cy="-209" r="5.4"/><circle class="fy-oven-knob o" cx="-41" cy="-209" r="5.4"/>
      <circle class="fy-oven-lamp" cx="-22" cy="-209" r="3.2"/>
      <circle class="fy-oven-dial o" cx="30" cy="-209" r="10"/><path class="fy-oven-hand" d="M30-209V-216.5"/>
      <g class="fy-oven-bell"><path class="fy-oven-bell-b o" d="M52-224C52-234 66-234 66-224Z"/><circle class="fy-oven-bell-k o" cx="59" cy="-236" r="2.4"/></g>
      <rect class="fy-oven-box o" x="-85" y="-200" width="170" height="190" rx="12"/>
      <rect class="fy-oven-top o" x="-90" y="-204" width="180" height="9" rx="4.5"/>
      <rect class="fy-oven-cav o" x="-72" y="-188" width="144" height="134" rx="10"/>
      <g class="fy-oven-inside" clip-path="url(#fy-clip-oven)">
        <rect class="fy-oven-in" x="-72" y="-188" width="144" height="134"/>
        <rect class="fy-oven-glow" x="-72" y="-188" width="144" height="134"/>
        <path class="fy-oven-rail" d="M-64-184V-58M64-184V-58"/>
        <g class="fy-spit-frame"><path class="fy-hoops"/><path class="fy-spokes"/><path class="fy-hooks"/></g>
        <g class="fy-spit-back"></g>
        <path class="fy-rod" d="M0-190V-58"/><circle class="fy-rod-cap o" cx="0" cy="-184" r="3.4"/>
        <g class="fy-spit-front"></g>
        <g class="fy-spit-names"></g>
        <path class="fy-oven-coil" d="M-62-61q6-6 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0"/>
      </g>
      <g class="fy-oven-door">
        <path class="fy-oven-door-p o" fill-rule="evenodd" d="M-66-188H66Q72-188 72-182V-60Q72-54 66-54H-66Q-72-54-72-60V-182Q-72-188-66-188ZM-56-178H56Q60-178 60-174V-82Q60-78 56-78H-56Q-60-78-60-82V-174Q-60-178-56-178Z"/>
        <rect class="fy-oven-glass" x="-60" y="-178" width="120" height="100" rx="4"/>
        <path class="fy-oven-shine" d="M-50-172L-34-92M-38-172L-31-140"/>
        <rect class="fy-oven-handle o" x="-52" y="-196" width="104" height="7" rx="3.5"/>
        <g class="fy-oven-plate"><rect class="o" x="-27" y="-75" width="54" height="17" rx="5"/><text class="fy-oven-count" x="0" y="-66.2"></text></g>
      </g>
      <rect class="fy-oven-drawer o" x="-72" y="-48" width="144" height="30" rx="5"/><path class="fy-oven-pull" d="M-20-33H20"/>
    </g></g>
    <path class="fy-oven-clang" d="M-96-150L-110-160M-100-120H-116M-96-90L-110-80M96-150L110-160M100-120H116M96-90L110-80"/>
    <g class="fy-oven-puff"><circle cx="-26" cy="-150" r="14"/><circle cx="2" cy="-166" r="18"/><circle cx="30" cy="-148" r="12"/></g>
    <text class="fy-oven-ding" x="59" y="-246">DING!</text>`;

  // ---------- the farmyard ----------
  // Drawn wide (x -400..1400): the old square scene sits in the middle
  // (300..700), with more farm either side for wider boxes. Everything that
  // moves on its own (clouds, birds, trees, leaves, grass, the barn door, the
  // weathervane) is CSS; the per-item beats are inline vars, seeded so every
  // window draws the same farm.
  function bgMarkup() {
    const r = seeded(20251127);
    const R = (a, b) => a + r() * (b - a);
    const f = (n) => n.toFixed(1);
    // a tree: trunk + crowns, swaying about its foot
    const tree = (x, base, top, crowns) => `<g class="fy-tree" style="--tt:${f(R(4.5, 7.5))}s;--td:${f(-R(0, 7))}s">`
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
    // a few leaves letting go of the crowns and drifting down
    const leaves = [[652, 160], [780, 156], [70, 158], [318, 166], [905, 160], [674, 166], [-150, 160], [1090, 160], [140, 166], [985, 164]]
      .map(([x, y], i) => `<g transform="translate(${x} ${y})"><path class="fy-leaf c${i % 3}" style="--lt:${f(R(8, 13))}s;--ld:${f(-R(0, 13))}s;--lx:${f(R(-34, 34))}px" d="M0-3.4C2.4-3.2 3.4-1 3.2.4 3 2.4 1 3.4 0 3.4-1.2 1.6-2.4-.6 0-3.4Z"/></g>`).join('');
    // clouds drifting slowly across
    const cloud = (y, s, l) => `<g transform="translate(0 ${y})"><g class="fy-cloud" style="--cl:${l}s;--cd:${f(-R(0, l))}s"><g transform="scale(${s})">`
      + '<path class="fy-cloud-b" d="M-34 2C-36-6-26-11-17-8-13-18 3-21 10-12 18-17 32-12 32-3 40-2 40 6 32 6H-30C-38 6-38 2-34 2Z"/>'
      + '<path class="fy-cloud-u" d="M-30 6H32C36 6 38 4 37 2 30 4 12 5-6 4-20 4-30 3-36 2-37 5-34 6-30 6Z"/></g></g></g>';
    const clouds = cloud(34, 1.6, 190) + cloud(62, 1.1, 240) + cloud(98, 0.85, 160) + cloud(22, 1.25, 280) + cloud(82, 0.7, 210) + cloud(48, 1, 230);
    // now and then a few birds cross the sky
    const flyer = (x, y, s, d) => `<g transform="translate(${x} ${y}) scale(${s})"><path class="fy-flyer" style="--fd:${d}ms" d="M-6 0Q-3-3.6 0 0Q3-3.6 6 0"/></g>`;
    const birds = `<g class="fy-flock a" transform="translate(0 70)"><g class="fy-flock-move">${flyer(0, 0, 1, 0)}${flyer(-15, 6, 0.85, 120)}${flyer(-27, -3, 0.75, 220)}</g></g>`
      + `<g class="fy-flock b" transform="translate(0 44)"><g class="fy-flock-move">${flyer(0, 0, 0.8, 60)}${flyer(-12, 5, 0.7, 180)}</g></g>`;
    // grass tufts along the fence and at the front, each blowing on its own beat
    const tuft = (x, y, s) => `<g transform="translate(${f(x)} ${f(y)}) scale(${s.toFixed(2)})"><path class="fy-tuft" style="--gs:${f(R(2.2, 3.8))}s;--gd:${f(-R(0, 4))}s" d="M-4.5 0Q-4.5-4-3-7.5Q-3.2-3.6-1.6 0M-1.4 0Q-1-6 .6-9.5Q.6-4.4 1.6 0M1.8 0Q2.6-3.8 5-6.5Q3.8-3 4.4 0"/></g>`;
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
        <radialGradient id="fy-g-oven"><stop offset="0"/><stop offset="1"/></radialGradient>
        <radialGradient id="fy-g-ovenin" cy=".8" r=".8"><stop offset="0"/><stop offset=".55"/><stop offset="1"/></radialGradient>
        <clipPath id="fy-clip-oven"><rect x="-72" y="-188" width="144" height="134" rx="10"/></clipPath>
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
      <g class="fy-birds">${birds}</g>
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
      <g class="fy-fall">${leaves}</g>`;
  }
  // warm low sunlight over everything, and a little dusk at the front
  const LIGHT = `<rect class="fy-warm" x="-400" width="1800" height="400"/><rect class="fy-dusk" x="-400" width="1800" height="400"/>`;
  const markup = () => `
    <svg class="fy-svg" viewBox="300 0 400 400" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      ${bgMarkup()}
      <g class="fy-shadows"></g>
      <g class="fy-actors"></g>
      ${LIGHT}
    </svg>
    <span class="fy-left" aria-hidden="true"></span>
    <button type="button" class="fy-pour" hidden>Let them out</button>
    <div class="fy-name" aria-hidden="true"><span></span></div>
    <div class="fy-burst" aria-hidden="true"></div>
    <div class="fy-burst fy-burst-oven" aria-hidden="true"></div>`;

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
    fg.innerHTML = FARMER;
    fg.dataset.pose = 'think';
    const fsh = shade(doc, 118, 15, 18);
    const og = svgEl(doc, 'g', 'fy-oven');
    og.innerHTML = OVEN;
    const osh = shade(doc, 200, 36, 74);
    const q = (c) => og.querySelector(c);
    const v = {
      doc, el,
      svg: el.querySelector('.fy-svg'),
      actors: el.querySelector('.fy-actors'),
      shadows: el.querySelector('.fy-shadows'),
      left: el.querySelector('.fy-left'),
      pourBtn: el.querySelector('.fy-pour'),
      name: el.querySelector('.fy-name'),
      burst: el.querySelector('.fy-burst'),
      burstOven: el.querySelector('.fy-burst-oven'),
      birds: new Map(),                          // id -> turkey
      leaving: [],                               // turkeys fading out
      farmer: { g: fg, sh: fsh, x: 672, y: 340, face: 1, pose: 'think', depth: 340 },
      order: '',
      S: 1,
      // the view (layout() keeps these in step with the box)
      W: 400, x0: 300, k: 1, offX: 0, offY: 0, bw: 0, bh: 0,
      yard: null, home: null,
      active: null, plan: null, held: null, done: new Set(), pickS: null,
      oven: { g: og, sh: osh, id: '#oven', x: 0, y: OV_Y, s: 1, depth: OV_Y, cls: null, door: null, count: q('.fy-oven-count') },
      doorUntil: 0, puffUntil: 0, partyUntil: 0,
      // the spit: rings of hooks; items = the turkeys on it (id -> its drawing)
      spit: {
        back: q('.fy-spit-back'), front: q('.fy-spit-front'), names: q('.fy-spit-names'),
        hoops: q('.fy-hoops'), spokes: q('.fy-spokes'), hooks: q('.fy-hooks'),
        items: new Map(), geom: null, phi: 0, lock: null, filled: 0, order: '',
      },
      picked: null, total: 0, full: false, wasFull: undefined, off: false, pouring: false,
      incoming: new Map(),                       // id -> where it tumbles out of the oven (not in the yard yet)
      sound: false, cluckAcc: 0, stepAt: 0,
      last: 0, timers: [],
    };
    v.actors.appendChild(fg);
    v.shadows.appendChild(fsh);
    v.actors.appendChild(og);
    v.shadows.appendChild(osh);
    views.set(doc, v);
    setView(v, 400, 300);
    v.pourBtn.addEventListener('click', (e) => { e.stopPropagation(); pour(v); });
    v.pourBtn.addEventListener('keydown', (e) => e.stopPropagation());
    const win = doc.defaultView;
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
    if (W === v.W && v.yard) { if (v.nameBird) placeName(v, v.nameBird); placeOvenBurst(v); return; }
    setView(v, W, MID - W / 2);
    assignHomes(v);
    const f = v.farmer;
    if (!v.active) {
      if (v.held) f.x = clamp(f.x, v.x0 + 40, v.x0 + W - 30);
      else { f.x = v.home.x; f.y = v.home.y; f.face = 1; }
    }
    if (v.nameBird) placeName(v, v.nameBird);
  }
  function setView(v, W, x0) {
    v.W = W; v.x0 = x0;
    v.svg.setAttribute('viewBox', `${x0.toFixed(1)} 0 ${W} 400`);
    // the oven stands at the right edge, a little smaller in a narrow view;
    // the farmer's spot is beside it and the yard is everything to the left
    const o = v.oven;
    o.s = clamp(W / 680, 0.6, 1.3);
    o.x = x0 + W - 14 - OV.hw * o.s;
    o.g.setAttribute('transform', `translate(${o.x.toFixed(1)} ${o.y}) scale(${o.s.toFixed(3)})`);
    placeShade(o.sh, o.x, o.y, o.s, '1');
    v.home = { x: o.x - OV.hw * o.s - 30, y: 340 };   // where the farmer stands and thinks
    v.yard = { x0: x0 + 24, x1: v.home.x - 40, y0: 238, y1: 362 };
    placeOvenBurst(v);
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
      phase: '', hook: null,                      // once picked: hoisted, tossed, then on the spit (its hook)
      x: 0, y: 0, z: 0, sc: 1, face: (h & 1) ? 1 : -1,
      mode: 'yard', placed: false, fly: null, cls: '',
    };
    setTag(b);
    return b;
  }

  // Draw the current list: add new turkeys, drop missing ones (the held one
  // is in the oven; anyone taken off just fades), keep the rest.
  function sync(doc, list) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    const ids = new Set(list.map((x) => x.id));
    for (const [id, b] of v.birds) {
      if (ids.has(id)) continue;
      if (v.active && v.active.winnerId === id) continue;
      v.birds.delete(id);
      if (b === v.held) { v.held = null; hideName(v); if (!v.active) setPose(v, 'think'); }
      if (b.mode === 'held') drop(v, b);         // it's in the oven: on the spit (v.picked) or nowhere
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
    renderSpit(v);
  }
  function drop(v, b) {
    b.g.remove(); b.sh.remove();
    v.leaving = v.leaving.filter((q) => q !== b);
  }
  const isPopout = (v) => v.doc.body.classList.contains('wheel-popout');

  // Home spots: staggered rows across the yard, so the flock reads as a
  // crowd at any class size and any width. The rows follow the yard's shape
  // (a wide yard gets long rows), and the turkeys are as big as a row's
  // spacing allows.
  function makeHomes(Y, n) {
    if (!n) return { pts: [], cw: 60 };
    const W = Y.x1 - Y.x0, H = Y.y1 - Y.y0, pts = [];
    const rows = clamp(Math.round(Math.sqrt((n * H * 1.8) / W)), 1, 6);
    const per = Math.ceil(n / rows);
    const cw = W / per;
    for (let r = 0; r < rows; r++) {
      const inRow = r === rows - 1 ? n - per * (rows - 1) : per;
      const y = rows === 1 ? Y.y0 + H * 0.6 : Y.y0 + (r / (rows - 1)) * H;
      const x0 = Y.x0 + (W - cw * inRow) / 2 + (r % 2 ? cw * 0.3 : 0) - (r % 2 ? 0 : cw * 0.1);
      for (let i = 0; i < inRow; i++) pts.push({ x: clamp(x0 + cw * (i + 0.5), Y.x0, Y.x1), y });
    }
    return { pts, cw };
  }
  function assignHomes(v) {
    const list = [...v.birds.values()].filter((b) => b.mode !== 'held').sort((a, b) => a.ord - b.ord);
    const n = list.length;
    const { pts: homes, cw } = makeHomes(v.yard, n);
    v.S = clamp(cw / 44, 0.75, 1.3);
    list.forEach((b, i) => {
      const hm = homes[i] || { x: (v.yard.x0 + v.yard.x1) / 2, y: 300 };
      const jx = ((hash(b.id + 'x') % 1000) / 1000 - 0.5) * 10, jy = ((hash(b.id + 'y') % 1000) / 1000 - 0.5) * 6;
      b.hx = hm.x + jx; b.hy = hm.y + jy;
      if (b.from) {                              // tumbled out of the oven: back to its spot
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
    spitStep(v, dt);
    ovenTick(v, t);
    let near = 0;
    for (const b of v.birds.values()) {
      if (b.mode === 'yard') near += yardStep(v, b, el, dt, t);
      else if (b.mode === 'fly') flyStep(v, b, t);
      else if (b.mode === 'held') heldStep(v, b, el);
    }
    // clucking rises as he passes: more nervous birds, faster and higher
    if (s && v.sound && el < T.point) {
      v.cluckAcc += dt * (0.8 + near * 2.6);
      if (v.cluckAcc >= 1) { v.cluckAcc = rnd(-0.2, 0.2); cluck(Math.min(1, near / 3)); }
    }
    if (s && v.sound && f.pose === 'walk' && t - v.stepAt > 190) { v.stepAt = t; footstep(); }
    paint(v);
    paintSpit(v, t);
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
    b.x = clamp(b.px + b.ox, v.x0 + 6, v.oven.x - OV.hw * v.oven.s - 6); b.y = clamp(b.py + b.oy, v.yard.y0 - 12, 392);
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
    if (u <= 0) { setCls(b, 'waiting'); return; }   // still in the oven, its turn to come out
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
  // an arc across the yard and in at the oven door, landing on its hook
  // (b.hook, from aim()). From then on the spit draws it (phase 'baked'
  // hides this one).
  function heldStep(v, b, el) {
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
    const m = hookPoint(v, b);
    if (E < T.land) {                            // wheee: across the yard and in at the door
      const u = (E - T.toss) / (T.land - T.toss);
      b.x = lerp(over.x, m.x, u); b.y = lerp(over.y, m.y, u);
      b.z = lerp(over.z, m.z, u) + (46 + 0.2 * Math.abs(m.x - over.x)) * fs * Math.sin(Math.PI * u);
      b.sc = lerp(over.sc, m.sc, u);
      b.face = m.x < over.x ? 1 : -1;
      setPhase(b, 'tossed');
    } else if (b.phase !== 'baked') {            // on the hook: the spit has it now
      b.x = m.x; b.y = m.y; b.z = m.z; b.sc = m.sc;
      setPhase(b, 'baked');
      renderSpit(v);
      const it = v.spit.items.get(b.id);
      if (it) it.wonUntil = performance.now() + 2600;
    }
  }
  // where the lobbed turkey ends up: its hook at the front of its ring, as a
  // yard turkey would be drawn there (feet, height off the ground, scale)
  function hookPoint(v, b) {
    const o = v.oven, G = v.spit.geom || spitGeom(8);
    const q = slotOf(G, b.hook ?? 0), sc = G.sc;
    const feetY = G.ys[q.tier] + RRY + 28 * sc;
    const y = o.y + 2;
    return { x: o.x - 3 * sc * o.s, y, z: y - (o.y + feetY * o.s), sc: (sc * o.s) / (v.S * b.k * persp(y)) };
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
        f.face = v.oven.x < f.x ? 1 : -1;        // turned to the oven
        pose = el < T.toss ? 'lift' : el < T.land + 240 ? 'toss' : el < T.reveal ? 'think' : 'cheer';
      }
    }
    once(v, 'freeze', el >= T.freeze, freeze);
    once(v, 'grab', el >= T.grab, lift);
    once(v, 'door', el >= T.doorOpen, () => { v.puffUntil = performance.now() + 700; if (v.sound) creak(); });
    once(v, 'toss', el >= T.toss, () => { aim(v); if (v.sound) whoosh(); });
    once(v, 'land', el >= T.land, () => v.sound && clang());
    once(v, 'ding', el >= T.ding, () => v.sound && ding());
    once(v, 'reveal', el >= T.reveal, reveal);
    setPose(v, pose);
  }
  const once = (v, key, due, fn) => { if (due && !v.done.has(key)) { v.done.add(key); fn(v); } };
  function setPose(v, pose) {
    const f = v.farmer;
    if (f.pose === pose) return;
    f.pose = pose;
    f.g.dataset.pose = pose;
  }

  // ---------- the oven ----------
  // It stays put. The door drops open for the throw (doorOpen..land), and
  // whenever someone comes out (v.doorUntil); clang, ding, a puff of steam,
  // the whirl of the spit, and the party when the last hook fills.
  function ovenTick(v, now) {
    const o = v.oven;
    const el = v.pickS ? Date.now() - v.pickS.startedAt : 1e9;
    const door = (el >= T.doorOpen && el < T.land) || now < v.doorUntil ? 'open' : 'shut';
    let cls = '';
    if (el >= T.toss && el < T.land + 200) cls += ' whirl';
    if (el >= T.land && el < T.land + 340) cls += ' clang';
    if (el >= T.ding && el < T.ding + 420) cls += ' ding';
    if (now < v.puffUntil) cls += ' puff';
    if (now < v.partyUntil) cls += ' party';
    if (v.full) cls += ' full';
    if (v.picked && !isPopout(v)) cls += ' counting';
    if (o.cls !== cls) { o.cls = cls; o.g.setAttribute('class', `fy-oven${cls}`); }
    if (o.door !== door) { o.door = door; o.g.dataset.door = door; }
  }

  // ---------- the spit ----------
  // n hooks in rings (bottom ring first, so the oven fills from the bottom
  // up); each ring is RX × RRY seen from the front, its turkeys hanging from
  // hooks on spokes off the rod. A ring's hooks are spaced evenly, the rings
  // staggered by half a step. sc is how big a turkey on the spit is drawn.
  function spitGeom(n) {
    const tiers = n <= 10 ? 1 : n <= 22 ? 2 : 3;
    const counts = [];
    for (let i = 0; i < tiers; i++) counts.push(Math.floor(n / tiers) + (i < n % tiers ? 1 : 0));
    const most = Math.max(...counts, 1);
    const tierH = 94 / tiers;
    const sc = clamp(Math.min(tierH / 38, (RX * Math.PI * 2) / most / 24), 0.42, 1.2);
    // stack the rings in the middle of the window (a turkey reaches about
    // 13·sc above its hook at the back of a ring and 30·sc below at the front)
    const span = (tiers - 1) * tierH + 2 * RRY + 43 * sc;
    const bottom = (OV.win.y0 + OV.win.y1) / 2 + span / 2 - RRY - 30 * sc;
    const ys = counts.map((_, i) => bottom - i * tierH);
    return { n, tiers, counts, sc, ys };
  }
  function slotOf(G, j) {
    let i = 0, c = 0;
    while (i < G.tiers - 1 && j >= c + G.counts[i]) { c += G.counts[i]; i++; }
    return { tier: i, idx: j - c, count: Math.max(1, G.counts[i]) };
  }
  const slotAngle = (G, j) => { const q = slotOf(G, j); return (Math.PI * 2 * (q.idx + (q.tier % 2) * 0.5)) / q.count; };
  // who's on the spit: everyone picked this round (No repeats on), in order,
  // plus the winner just thrown in if it isn't on the list yet
  function spitList(v) {
    const list = v.picked ? v.picked.map((p) => ({ id: p.id, label: p.label })) : [];
    const h = v.held;
    if (h && h.phase === 'baked' && !list.some((p) => p.id === h.id)) list.push({ id: h.id, label: h.label });
    return list;
  }
  function renderSpit(v, leaving = null) {
    const sp = v.spit, list = spitList(v);
    const hooks = v.picked ? Math.max(v.total, list.length, 1) : Math.max(8, list.length);
    sp.geom = spitGeom(hooks);
    sp.filled = list.length;
    const keep = new Set(list.map((p) => p.id));
    for (const [id, it] of sp.items) {
      if (keep.has(id) || it.goneAt) continue;
      const wait = leaving && leaving.get(id);
      if (wait != null) { it.goneAt = performance.now() + wait; setTimeout(() => dropSpit(v, id, it), wait); }
      else dropSpit(v, id, it);
    }
    list.forEach((p, j) => {
      let it = sp.items.get(p.id);
      if (it && it.goneAt) { dropSpit(v, p.id, it); it = null; }
      if (!it) {
        const g = svgEl(v.doc, 'g', `fy-turkey fy-spitbird p${palOf(p.id)}`);
        g.innerHTML = `<g transform="translate(-3 28)">${TURKEY}</g>`;
        const name = svgEl(v.doc, 'text', 'fy-spit-name');
        sp.back.appendChild(g);
        sp.names.appendChild(name);
        it = { g, name, label: null, ph: (hash(p.id + 's') % 1000) / 160, lit: -1, op: -1, won: false, wonUntil: 0 };
        sp.items.set(p.id, it);
      }
      it.slot = j;
      if (it.label !== p.label) {
        it.label = p.label;
        const t = shortName(p.label);
        it.name.textContent = t;
        it.fs = clamp(Math.min(13, 96 / (Math.max(3, t.length) * 0.56)), 7, 13);
      }
    });
    // the hoops and the empty hooks don't move with the names; the spokes do (paintSpit)
    sp.hoops.setAttribute('d', sp.geom.ys.map((y) => `M${-RX} ${y.toFixed(1)}a${RX} ${RRY} 0 1 0 ${2 * RX} 0a${RX} ${RRY} 0 1 0 ${-2 * RX} 0`).join(''));
    sp.order = '';
    paintCount(v);
  }
  function dropSpit(v, id, it) {
    it.g.remove(); it.name.remove();
    if (v.spit.items.get(id) === it) v.spit.items.delete(id);
  }
  // where a turkey on the spit is in the scene, as a yard turkey would be drawn
  function spitScenePos(v, it) {
    const o = v.oven, y = o.y + 2;
    const feet = (it.ly ?? -110) + 28 * (it.lsc ?? 0.6);
    return { x: o.x + (it.lx ?? 0) * o.s, y, z: y - (o.y + feet * o.s), draw: (it.lsc ?? 0.6) * o.s };
  }
  // the rings turn slowly; through a throw (aim() .. T.rest) the pick's clock
  // drives them: a whirl to bring the empty hook to the front, then a pause
  function spitStep(v, dt) {
    const sp = v.spit, L = sp.lock;
    const el = L ? Date.now() - L.s.startedAt : 0;
    if (L && L.to != null && el >= T.toss) {
      if (el < T.land) sp.phi = lerp(L.from, L.to, easeInOut(clamp((el - T.toss) / (T.land - T.toss), 0, 1)));
      else { sp.phi = L.to; if (el >= T.rest) sp.lock = null; }
    } else sp.phi += IDLE_W * dt;
  }
  function aim(v) {
    const sp = v.spit, b = v.active && v.birds.get(v.active.winnerId);
    if (!b || !sp.lock) return;
    const list = spitList(v).filter((p) => p.id !== b.id);
    const hooks = v.picked ? Math.max(v.total, list.length + 1) : Math.max(8, list.length + 1);
    sp.geom = spitGeom(hooks);
    b.hook = list.length;
    const a = slotAngle(sp.geom, b.hook), TAU = Math.PI * 2;
    const back = (((-(sp.phi + a)) % TAU) + TAU) % TAU;   // how far round the hook has to come
    sp.lock.from = sp.phi;
    sp.lock.to = sp.phi + (reduced(v.doc) ? 0 : TAU) + back;
  }
  function paintSpit(v, now) {
    const sp = v.spit, G = sp.geom;
    if (!G || !isOn(v.doc)) return;
    const whirl = sp.lock && sp.lock.to != null && Date.now() - sp.lock.s.startedAt < T.land;
    let spokes = '', hooks = '';
    for (let j = 0; j < G.n; j++) {
      const q = slotOf(G, j), th = sp.phi + slotAngle(G, j), y0 = G.ys[q.tier];
      const x = RX * Math.sin(th), y = y0 + RRY * Math.cos(th);
      spokes += `M0 ${y0.toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}`;
      if (j >= sp.filled) hooks += `M${x.toFixed(1)} ${y.toFixed(1)}v3.4q0 2.8 2.8 2.8`;
    }
    sp.spokes.setAttribute('d', spokes);
    sp.hooks.setAttribute('d', hooks);
    const back = [], front = [];
    for (const it of sp.items.values()) {
      const q = slotOf(G, it.slot), th = sp.phi + slotAngle(G, it.slot);
      const c = Math.cos(th), s = Math.sin(th);
      const depth = (c + 1) / 2;                   // 1 at the front of the ring
      const lsc = G.sc * (0.62 + 0.38 * depth);
      const lx = RX * s, ly = G.ys[q.tier] + RRY * c;
      it.lx = lx; it.ly = ly; it.lsc = lsc;
      // facing the way it's going (right across the front), narrow at the sides
      const sx = (c >= 0 ? -1 : 1) * (0.36 + 0.64 * Math.abs(c));
      const swing = whirl ? -14 : Math.sin(now / 1100 + it.ph) * 5;
      it.g.setAttribute('transform', `translate(${lx.toFixed(1)} ${ly.toFixed(1)}) rotate(${swing.toFixed(1)}) scale(${(sx * lsc).toFixed(3)} ${lsc.toFixed(3)})`);
      const won = now < it.wonUntil;
      if (won !== it.won) { it.won = won; it.g.classList.toggle('won', won); it.lit = -1; }
      const lit = Math.round((0.4 + 0.6 * depth) * 40) / 40;
      if (lit !== it.lit) { it.lit = lit; it.g.style.filter = won ? 'url(#fy-glowf)' : `brightness(${lit})`; }
      // the name shows only on the turkey passing the front of its ring
      const a = Math.abs(Math.atan2(s, c)) / (Math.PI / q.count);
      const op = it.goneAt ? 0 : won ? 1 : Math.round(clamp(1.6 - 2.4 * a, 0, 1) * 20) / 20;
      if (op !== it.op) { it.op = op; it.name.style.opacity = op; }
      if (op > 0) {
        it.name.setAttribute('x', lx.toFixed(1));
        it.name.setAttribute('y', (ly + 11 * lsc).toFixed(1));
        it.name.style.fontSize = `${(it.fs * (won ? 1.1 : 1)).toFixed(2)}px`;
      }
      (c < 0 ? back : front).push({ it, c });
    }
    back.sort((a, b) => a.c - b.c); front.sort((a, b) => a.c - b.c);
    const key = back.map((q) => q.it.slot).join(',') + '|' + front.map((q) => q.it.slot).join(',');
    if (key !== sp.order) {
      sp.order = key;
      const put = (grp, arr) => { const kids = grp.children; arr.forEach((q, i) => { if (kids[i] !== q.it.g) grp.insertBefore(q.it.g, kids[i] || null); }); };
      put(sp.back, back); put(sp.front, front);
    }
  }

  // positions → transforms; draw order by depth (a lifted bird in front)
  function paint(v) {
    const f = v.farmer, fs = persp(f.y);
    f.g.setAttribute('transform', `translate(${f.x.toFixed(1)} ${f.y.toFixed(1)}) scale(${(fs * f.face).toFixed(3)} ${fs.toFixed(3)})`);
    if (f.drawnFace !== f.face) {                 // the "?" reads the right way round whichever way he faces
      f.drawnFace = f.face;
      f.g.querySelector('.ff-bubble-q').setAttribute('transform', f.face < 0 ? 'translate(-62 0) scale(-1 1)' : '');
    }
    placeShade(f.sh, f.x, f.y, fs, '1');
    f.depth = f.y;
    const o = v.oven;
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
    const list = [f, o, ...all].sort((a, b) => a.depth - b.depth);
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
      const Y = v.yard;
      sneakTo = x < (Y.x0 + Y.x1) / 2 ? Math.max(v.x0 + 8, x - 70) : Math.min(Y.x1 + 20, x + 70);
    }
    // stand beside each one, on the side he arrives from
    let at = { x: f.x, y: f.y };
    const stops = [...decoys, winner].filter(Boolean).map((b) => {
      const q = pos(b), side = Math.sign(at.x - q.x) || 1;
      const gap = 22 * v.S * b.k * persp(q.y) + 15 * persp(q.y);
      const spot = { x: clamp(q.x + side * gap, v.x0 + 16, v.x0 + v.W - 14), y: q.y - 2 };   // a step behind, so the bird stays in view
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
    // last pick's turkey, still on the spit (No repeats off): the door pops
    // open and it hops back out to its spot
    const h = v.held;
    v.held = null;
    if (h && v.birds.get(h.id) === h) {
      const it = v.spit.items.get(h.id);
      const p = it ? spitScenePos(v, it) : hookPoint(v, h);
      renderSpit(v);
      setCls(h, '');
      setPhase(h, '');
      h.x = p.x; h.y = p.y; h.z = p.z; h.sc = p.draw ? p.draw / (v.S * h.k * persp(p.y)) : p.sc;
      startFly(v, h, { x: h.hx, y: h.hy, z: 0, sc: 1 }, { delay: 140, dur: 700, lift: 60, tumble: true });
      v.doorUntil = performance.now() + 700;
      v.puffUntil = performance.now() + 700;
      if (sound) popOut();
    }
    for (const b of v.birds.values()) if (b.mode === 'fly' && b.fly && b !== h) { b.mode = 'yard'; b.x = b.px = b.fly.to.x; b.y = b.py = b.fly.to.y; b.z = 0; b.sc = 1; b.tumble = false; setCls(b, ''); }
    v.active = s;
    v.pickS = s;
    v.done = new Set();
    v.sound = sound;
    v.cluckAcc = 0;
    v.plan = makePlan(v, s);
    v.spit.lock = { s, from: null, to: null };
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
  // he grabs it: from here on it is the held turkey, on the oven's timeline
  function lift(v) {
    const b = v.active && v.birds.get(v.active.winnerId);
    if (!b) return;
    b.mode = 'held';
    b.liftFrom = { x: b.x, y: b.y };
    setPhase(b, 'held caught');
    v.held = b;
  }
  function reveal(v) {
    const b = v.active && v.birds.get(v.active.winnerId);
    if (!b) return;
    showName(v, b);
    if (v.sound) gobble();
  }
  // the name, large, above the oven
  function showName(v, b) {
    const label = b.label || '';
    v.name.firstChild.textContent = label;
    v.name.title = label;
    v.nameBird = b;
    placeName(v, b);
    v.name.classList.remove('go');
    void v.name.offsetWidth;
    v.name.classList.add('go');
    v.burst.innerHTML = burstMarkup(v.k);
    v.burst.classList.remove('go');
    void v.burst.offsetWidth;
    v.burst.classList.add('go');
  }
  // over the oven, in px for this box (sizes in scene units, so the name is
  // the same size against the scene at any width)
  function placeName(v, b) {
    const o = v.oven;
    const longest = Math.max(4, ...(b.label || '').split(/\s+/).map((w) => w.length));
    const size = Math.min(48, 352 / (longest * 0.56)) * v.k;
    const p = toPx(v, o.x, o.y - (OV.top + 16) * o.s);
    const left = clamp(p.x, v.bw * 0.12, v.bw * 0.88);
    const bottom = clamp(v.bh - p.y, v.bh * 0.2, v.bh - size * 1.55 - 6);   // never off the top
    v.name.style.setProperty('--fs', `${size.toFixed(1)}px`);
    v.name.style.left = `${left.toFixed(1)}px`;
    v.name.style.bottom = `${bottom.toFixed(1)}px`;
    v.burst.style.left = `${left.toFixed(1)}px`;
    v.burst.style.bottom = `${(bottom + size * 0.6).toFixed(1)}px`;
  }
  // the party's leaves come out of the oven's window
  function placeOvenBurst(v) {
    if (!v.burstOven || !v.bw) return;
    const o = v.oven, p = toPx(v, o.x, o.y - 128 * o.s);
    v.burstOven.style.left = `${p.x.toFixed(1)}px`;
    v.burstOven.style.bottom = `${(v.bh - p.y).toFixed(1)}px`;
  }
  function hideName(v) {
    v.nameBird = null;
    v.name.classList.remove('go');
    v.burst.classList.remove('go');
  }
  // the end: the winner on its hook, the name over the oven (even if this
  // window missed frames). The spit carries on turning after T.rest.
  function finish(doc, s) {
    const v = views.get(doc);
    if (!v) return;
    if (!v.active) v.active = s;
    if (!v.pickS) v.pickS = s;
    if (!v.spit.lock) v.spit.lock = { s, from: null, to: null };
    if (!v.plan) v.plan = makePlan(v, s);
    farmerStep(v, Math.max(T.out, Date.now() - s.startedAt));
    for (const b of v.birds.values()) if (b.mode === 'held') heldStep(v, b, T.out);
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
    v.oven.count.textContent = v.picked ? `${v.spit.filled} / ${v.total}` : '';
    paintPour(v);
  }
  function paintPour(v) {
    v.pourBtn.hidden = !v.picked || isPopout(v) || !v.picked.length || v.pouring;
    v.pourBtn.disabled = !!v.active;
    v.pourBtn.classList.toggle('primary', v.full);
  }

  // ---------- the round: everyone picked so far is on the spit ----------
  // wheel.js calls this after every change. Anyone who was on the spit and
  // isn't any more (Let them out, Reset, No repeats off) tumbles out of the
  // door back to their spot; the last hook filling sets the oven off.
  function setPicked(doc, list, total) {
    const v = views.get(doc);
    if (!v) return;
    const before = new Map();
    for (const [id, it] of v.spit.items) if (!it.goneAt) before.set(id, spitScenePos(v, it));
    const was = new Set((v.picked || []).map((p) => p.id));
    v.picked = list;
    v.total = Math.max(total || 0, list ? list.length : 0);
    // the winner still on its hook from a list that's just been emptied comes out too
    const h = v.held;
    if (h && h.phase === 'baked' && was.has(h.id) && !(list || []).some((p) => p.id === h.id)) {
      v.held = null;
      hideName(v);
      setPhase(h, '');
      if (!v.active) setPose(v, 'think');
    }
    const going = [...before.keys()].filter((id) => !spitList(v).some((p) => p.id === id));
    const gap = reduced(v.doc) ? 0 : Math.min(70, 1200 / Math.max(1, going.length));
    const leaving = new Map(going.map((id, i) => [id, 160 + i * gap]));
    renderSpit(v, leaving);
    going.forEach((id) => tumbleOut(v, id, before.get(id), leaving.get(id)));
    if (going.length) {
      const now = performance.now();
      v.doorUntil = Math.max(v.doorUntil, now + 260 + going.length * gap + 500);
      v.puffUntil = now + 700;
      if (soundOn(v.doc) && !isPopout(v)) { const c = audio(); if (c) going.forEach((_, i) => { if (i % 3 === 0) cluckAt(c, c.currentTime + (160 + i * gap) / 1000 + 0.1, rnd(1, 1.3), 0.05); }); }
    }
    const full = !!list && v.total > 0 && list.length >= v.total;
    if (full && v.wasFull === false) celebrate(v);
    v.wasFull = full;                            // undefined until now: a page that loads full doesn't party
    v.full = full;
    paintCount(v);
  }
  // one turkey out of the oven door and back to its spot in the yard
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
  // the last hook filled: the oven hops, rings, glows and throws leaves
  function celebrate(v) {
    v.partyUntil = performance.now() + PARTY_MS;
    v.burstOven.innerHTML = burstMarkup(v.k * v.oven.s, 28);
    v.burstOven.classList.remove('go');
    void v.burstOven.offsetWidth;
    v.burstOven.classList.add('go');
    if (soundOn(v.doc) && !isPopout(v)) fanfare();
  }

  // "Let them out": the wheel says go (a saved list asks first), then
  // wheel.js empties the round and setPicked() tumbles everyone out
  function pour(v) {
    if (v.pouring || v.active || !v.picked || !v.picked.length) return;
    if (!v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset-request', { cancelable: true }))) return;
    v.pouring = true;
    v.el.setAttribute('aria-disabled', 'true');
    paintPour(v);
    const n = v.picked.length;
    v.doorUntil = performance.now() + 2000;
    if (soundOn(v.doc)) creak();
    setTimeout(() => {
      v.doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset'));   // the round starts over
      setTimeout(() => {
        v.pouring = false;
        setDisabled(v.doc, v.off);
        paintCount(v);
      }, reduced(v.doc) ? 400 : 160 + Math.min(1200, n * 70) + 900);
    }, reduced(v.doc) ? 0 : 320);
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
  // a burst of filtered noise (the oven's casters, the throw, the clang's hit)
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
  // the oven door: a short metal creak
  const creak = () => { const c = audio(); if (c) { noiseAt(c, c.currentTime, 0.26, { type: 'bandpass', f0: 900, f1: 520, q: 6, gain: 0.05 }); noiseAt(c, c.currentTime + 0.2, 0.08, { f0: 300, gain: 0.05 }); } };
  const whoosh = () => { const c = audio(); if (!c) return; noiseAt(c, c.currentTime, 0.42, { type: 'bandpass', f0: 450, f1: 1900, q: 1.4, gain: 0.07 }); cluckAt(c, c.currentTime + 0.05, 1.35, 0.05); cluckAt(c, c.currentTime + 0.16, 1.45, 0.045); };
  // the door slams: a metal clang (inharmonic partials ringing down) on a hit
  function clang() {
    const c = audio();
    if (!c) return;
    const at = c.currentTime;
    noiseAt(c, at, 0.07, { type: 'highpass', f0: 1800, gain: 0.08 });
    [[310, 0.07, 0.75], [517, 0.06, 0.6], [843, 0.045, 0.45], [1291, 0.03, 0.35], [1984, 0.02, 0.22]].forEach(([fr, gain, len]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + len + 0.02);
    });
  }
  // the kitchen timer: one bright bell
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
  // the full oven: a run of bells up the scale, a ding-ding and a happy gobble
  function fanfare() {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    [1047, 1319, 1568, 2093].forEach((fr, i) => bell(c, t0 + i * 0.13, fr, 0.08));
    bell(c, t0 + 0.62, 1568, 0.1); bell(c, t0 + 0.8, 1568, 0.1);
    [0.3, 0.42, 0.55, 0.7].forEach((d, i) => cluckAt(c, t0 + d, 1.1 + i * 0.08, 0.05));
  }
  // the door pops open: a springy "boing" and two pleased clucks
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

  window.Farmyard = { DURATION_MS, SETTLE_MS, HOLDS_ROUND: true, isOn, busy, build, sync, run, finish, setWinner, setDisabled, setPicked };
})();
