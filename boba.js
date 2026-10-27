// boba.js — the Name Wheel's marwa skin: a bubble tea cup.
//
// Like cauldron.js (halloween), this only draws and animates. wheel.js owns
// the roster, the pool, No repeats and the pick itself (the winner is drawn
// FIRST with crypto.getRandomValues). Each student is one boba pearl settled
// at the bottom of the cup with their first name in small cream type (a
// detail for close up, not for the back of the room), and the cup visibly
// empties as No repeats takes pearls out.
//
// The CUP is the character (the pearls are just the mechanism): a face on
// its front, little arms and feet, and a mood (data-mood on .boba) that
// follows the pick — idle (smiling, blinking, a gentle bob), wow (the swirl:
// wide eyes, puffed cheeks, arms up, shaking), look (the pearl's trip: its
// eyes follow it up the straw), party (the reveal: ^ ^ eyes, arms thrown up,
// a bounce, hearts all round).
//
// A pick is the spin descriptor { startedAt, duration, settle, winnerId },
// played as a row of readable beats (~4s, all from the descriptor's
// timestamps, so the page, the full screen window and the mini window play
// the same pick):
//   0.0–1.0s  the cup shakes
//   0.15–2.3  the pearls swirl up into the tea, tumbling and bouncing off
//             the sides; the swirl builds, holds, then lets go
//   1.6       ONE pearl lights up (a pink ring, a size up) and separates
//   1.6–2.1   it is drawn across to the straw's mouth
//   2.1–3.1   it travels up through the (see-through) straw, in sips
//   3.1–3.35  it pops out of the top...
//   3.35      ...and comes to the FRONT: the page dims and the pearl grows
//             into a big disc in the middle of the screen with the name on it,
//             hearts bursting round it. A click or Space puts it away.
//
// With No repeats on, a SECOND CUP (the jar) stands beside it: empty and
// sleepy at the start of a round, it catches every picked pearl (the disc
// arcs over with a spin when the spotlight closes and drops in), fills as
// the main cup empties, gets happier as it goes, and celebrates when it's
// full. "Pour them back" tips it over and the pearls tumble back across.
//
// Everything is in the 400x400 box's units, drawn DY higher than the
// numbers say (one translate on both SVG layers and on the pearls) so the
// "N left" line fits under the cup; the pearls are HTML, placed in px from
// the box's rendered width. Exposed as window.Boba with the same
// shape as window.Cauldron, so wheel.js treats them as interchangeable skins.

(function () {
  // the timeline, ms from the start of a pick
  const T = {
    shake: 1000, swirl0: 150, swirlUp: 600, swirlDown: 1700, swirl1: 2300,
    pick: 1600, draw: 2100, top: 3100, pop: 3350, name: 3400, end: 4000,
  };
  const DURATION_MS = T.draw;
  const SETTLE_MS = T.end - T.draw;

  // the cup, in box units
  const CUP = { top: 150, bottom: 386, rimL: 84, rimR: 316, slope: 0.1624 };
  const TEA = 186;                                   // the pearls' ceiling (just under the surface)
  const FLOOR = 378;                                 // the pearls' floor
  const SWIRL_C = { x: 200, y: 285 };                // the swirl turns about here
  const STRAW_B = { x: 236, y: 370 };                // the straw's bottom end, in the tea
  const STRAW_T = { x: 271, y: 48 };                 // its top end, above the lid
  const strawAt = (p) => ({ x: STRAW_B.x + (STRAW_T.x - STRAW_B.x) * p, y: STRAW_B.y + (STRAW_T.y - STRAW_B.y) * p });
  const MOUTH = strawAt(0.04);                       // where a pearl goes in
  const OUT = { x: 274, y: 28 };                     // where it pops, just above the straw
  const STRAW_DEG = Math.atan2(STRAW_T.x - STRAW_B.x, STRAW_B.y - STRAW_T.y) * 180 / Math.PI;
  const IN_STRAW = 19;                               // the chosen pearl's size inside the straw
  const DY = -30;                                    // the whole drawing sits this much higher (centres it in the box)
  const FACE_C = { x: 186, y: 230 };                 // the middle of the cup's face (its eyes follow the pearl from here)
  const JAR_AREA = 42200;                            // the inside of the cup below the rim (box units²): sizes the jar's pearls
  const BURST_MS = 1600;                             // a burst plays (1.3s / 1.5s in the CSS), then resets
  const PARTY_MS = 2400;                             // how long the reveal's happy pose holds
  // stable per student: a size a touch off the others
  const hash = (id) => { let h = 2166136261; for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };

  const views = new Map();
  // Closing the spotlight in one window closes it in the others (page, pop-out,
  // mini window). Same channel as wheel.js, whose handlers ignore this type.
  const spotChan = ('BroadcastChannel' in window) ? new BroadcastChannel('teacherpal-wheel') : null;
  if (spotChan) spotChan.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'boba-dismiss') views.forEach((v) => dismiss(v, false, false));
  });
  const isOn = (doc) => doc.documentElement.getAttribute('data-theme') === 'marwa';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  // the inside of the cup's walls at height y (it tapers toward the bottom)
  const wallL = (y) => CUP.rimL + (y - CUP.top) * CUP.slope + 5;
  const wallR = (y) => CUP.rimR - (y - CUP.top) * CUP.slope - 5;

  // ---------- markup ----------
  // Condensation: a fixed scatter of dots and a few drips on the cup's
  // front, clear of the shine strip. Seeded so every
  // window draws the same cup.
  function condensation() {
    let seed = 7;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const out = [];
    for (let i = 0, tries = 0; i < 34 && tries < 400; tries++) {
      const y = 162 + r() * 205, x = lerp(wallL(y) + 4, wallR(y) - 4, r());
      const nearShine = Math.abs(x - (104 + (y - 172) * 0.1474)) < 9;
      if (nearShine) continue;
      const s = 1.1 + r() * 2.3;
      out.push(i % 9 === 4
        ? `<path class="bt-drip" d="M${x.toFixed(1)} ${(y - s * 1.6).toFixed(1)} Q${(x + s).toFixed(1)} ${(y + s * 0.6).toFixed(1)} ${x.toFixed(1)} ${(y + s * 1.4).toFixed(1)} Q${(x - s).toFixed(1)} ${(y + s * 0.6).toFixed(1)} ${x.toFixed(1)} ${(y - s * 1.6).toFixed(1)} Z"/>`
        : `<circle class="bt-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(2)}"/>`);
      i++;
    }
    return out.join('');
  }
  const STRAW = `M${STRAW_B.x} ${STRAW_B.y} L${STRAW_T.x} ${STRAW_T.y}`;
  const TEA_PATH = `M89 178 L120.5 377 Q122 382 131 382 L269 382 Q278 382 279.5 377 L311 178 Z`;
  const CUP_PATH = `M84 150 L120.5 377 Q122 386 131 386 L269 386 Q278 386 279.5 377 L316 150 Z`;
  // Back layer: the shadow, the cup's back, the tea and its foam, the
  // straw's inside. Then the pearls (HTML). Front layer: the cup's outline,
  // shine and condensation, the domed lid, and the straw's translucent wall
  // (so a pearl shows through it on the way up). The count sits under it all.
  const MARKUP = `
    <svg class="bt-back" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="bt-tea-grad" x1="0" y1="0" x2="0" y2="1"><stop class="bt-tea-top" offset="0"/><stop class="bt-tea-mid" offset="0.55"/><stop class="bt-tea-bot" offset="1"/></linearGradient>
        <radialGradient id="bt-contact-grad"><stop class="bt-contact-in" offset="0"/><stop class="bt-contact-out" offset="1"/></radialGradient>
        <clipPath id="bt-tea-clip"><path d="${TEA_PATH}"/></clipPath>
      </defs>
      <g transform="translate(0 ${DY})">
      <ellipse class="bt-contact" cx="200" cy="400" rx="124" ry="11"/>
      <ellipse class="bt-contact-core" cx="200" cy="399" rx="80" ry="3.6"/>
      <ellipse class="bt-foot" cx="156" cy="390" rx="19" ry="9"/>
      <ellipse class="bt-foot" cx="244" cy="390" rx="19" ry="9"/>
      <g class="bt-arm l"><path class="bt-limb" d="M103 258 L77 293"/><path class="bt-limb-fill" d="M103 258 L77 293"/></g>
      <g class="bt-arm r"><path class="bt-limb" d="M297 258 L323 293"/><path class="bt-limb-fill" d="M297 258 L323 293"/></g>
      <path class="bt-cup-back" d="${CUP_PATH}"/>
      <path class="bt-tea" d="${TEA_PATH}"/>
      <g clip-path="url(#bt-tea-clip)">
        <path class="bt-milk" d="M86 238 C126 212 158 262 204 240 S276 210 316 236"/>
        <path class="bt-milk thin" d="M86 268 C122 252 150 286 196 270 S262 250 316 268"/>
        <path class="bt-milk wisp" d="M120 212 C150 200 176 224 214 212"/>
        <path class="bt-tea-edge" d="${TEA_PATH}"/>
        <ellipse class="bt-meniscus" cx="200" cy="179.5" rx="110" ry="8.5"/>
      </g>
      <ellipse class="bt-foam" cx="200" cy="178" rx="111" ry="8.5"/>
      <path class="bt-straw-in" d="${STRAW}"/>
      </g>
    </svg>
    <div class="bt-pearls"></div>
    <svg class="bt-front" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <g transform="translate(0 ${DY})">
      <path class="bt-cup" d="${CUP_PATH}"/>
      <path class="bt-shine" d="M104 172 L132 362"/>
      <path class="bt-rim-light" d="M92.5 160 L125 370"/>
      <path class="bt-rim-light faint" d="M306 166 L279 356"/>
      <g class="bt-condensation">${condensation()}</g>
      <rect class="bt-lid-shadow" x="88" y="153" width="224" height="6" rx="3"/>
      <path class="bt-dome" d="M92 140 Q96 90 200 88 Q304 90 308 140 Z"/>
      <path class="bt-dome-shine" d="M116 130 Q122 104 162 97"/>
      <path class="bt-dome-glint" d="M282 112 Q288 120 290 128"/>
      <rect class="bt-band" x="76" y="138" width="248" height="16" rx="7"/>
      <path class="bt-band-hi" d="M84 141.6 L316 141.6"/>
      <path class="bt-straw" d="${STRAW}"/>
      <path class="bt-straw-shine" d="M${STRAW_B.x - 6} ${STRAW_B.y} L${STRAW_T.x - 6} ${STRAW_T.y + 4}"/>
      <ellipse class="bt-straw-rim" cx="${STRAW_T.x}" cy="${STRAW_T.y}" rx="12.5" ry="3.4" transform="rotate(${STRAW_DEG.toFixed(2)} ${STRAW_T.x} ${STRAW_T.y})"/>
      <g class="bt-face">
        <ellipse class="bf-blush" cx="136" cy="252" rx="10" ry="6"/>
        <ellipse class="bf-blush" cx="236" cy="252" rx="10" ry="6"/>
        <g class="bf-eye"><ellipse class="bf-white" cx="160" cy="228" rx="14" ry="15.5"/><g class="bf-look"><circle class="bf-pupil" cx="160" cy="229" r="9.5"/><circle class="bf-hi" cx="156.4" cy="224.6" r="3.4"/><circle class="bf-hi" cx="163.2" cy="233" r="1.6"/></g></g>
        <g class="bf-eye r"><ellipse class="bf-white" cx="212" cy="228" rx="14" ry="15.5"/><g class="bf-look"><circle class="bf-pupil" cx="212" cy="229" r="9.5"/><circle class="bf-hi" cx="208.4" cy="224.6" r="3.4"/><circle class="bf-hi" cx="215.2" cy="233" r="1.6"/></g></g>
        <path class="bf-wink" d="M199 230 Q212 218 225 230"/>
        <path class="bf-happy" d="M147 232 Q160 216 173 232 M199 232 Q212 216 225 232"/>
        <path class="bf-mouth bf-smile" d="M177 252 Q186 262 195 252"/>
        <ellipse class="bf-mouth bf-o" cx="186" cy="257" rx="5" ry="6"/>
        <path class="bf-mouth bf-open" d="M173 250 Q186 274 199 250 Z"/>
      </g>
      </g>
    </svg>
    <button type="button" class="bt-handle" id="boba-straw" aria-label="Pick a student" title="Click the cup (or press Space) to pick"></button>
    <div class="bt-burst" aria-hidden="true"></div>
    <div class="bt-burst cup" aria-hidden="true"></div>
    <p class="bt-counter" aria-live="polite"><b>0</b><span>left</span></p>`;
  // The jar: the same cup with no lid, no straw and no tea, open at the top,
  // and its own face (centred: there's no straw to dodge; high, near the
  // open rim, so a full round's pile stays under it) - sleepy eyes and
  // z's, open eyes, a big smile, then ^ ^ (CSS, off data-fill).
  const JAR_MARKUP = `
    <div class="bt-jar-cup" data-fill="sleepy">
      <svg class="bt-back" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
        <g transform="translate(0 ${DY})">
        <ellipse class="bt-contact-core" cx="200" cy="399" rx="100" ry="4.5"/>
        <ellipse class="bt-foot" cx="156" cy="390" rx="19" ry="9"/>
        <ellipse class="bt-foot" cx="244" cy="390" rx="19" ry="9"/>
        <g class="bt-arm l"><path class="bt-limb" d="M103 258 L77 293"/><path class="bt-limb-fill" d="M103 258 L77 293"/></g>
        <g class="bt-arm r"><path class="bt-limb" d="M297 258 L323 293"/><path class="bt-limb-fill" d="M297 258 L323 293"/></g>
        <path class="bt-cup-back" d="${CUP_PATH}"/>
        <ellipse class="bt-jar-mouth" cx="200" cy="150" rx="116" ry="9"/>
        </g>
      </svg>
      <div class="bt-pearls"></div>
      <svg class="bt-front" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
        <g transform="translate(0 ${DY})">
        <path class="bt-cup" d="${CUP_PATH}"/>
        <path class="bt-jar-lip" d="M84 150 Q200 168 316 150"/>
        <path class="bt-shine" d="M104 172 L132 362"/>
        <path class="bt-rim-light" d="M92.5 160 L125 370"/>
        <path class="bt-rim-light faint" d="M306 166 L279 356"/>
        <g class="bt-face" transform="translate(0 -36)">
          <ellipse class="bf-blush" cx="150" cy="252" rx="10" ry="6"/>
          <ellipse class="bf-blush" cx="250" cy="252" rx="10" ry="6"/>
          <g class="bf-eye"><ellipse class="bf-white" cx="174" cy="228" rx="14" ry="15.5"/><g class="bf-look"><circle class="bf-pupil" cx="174" cy="229" r="9.5"/><circle class="bf-hi" cx="170.4" cy="224.6" r="3.4"/><circle class="bf-hi" cx="177.2" cy="233" r="1.6"/></g></g>
          <g class="bf-eye r"><ellipse class="bf-white" cx="226" cy="228" rx="14" ry="15.5"/><g class="bf-look"><circle class="bf-pupil" cx="226" cy="229" r="9.5"/><circle class="bf-hi" cx="222.4" cy="224.6" r="3.4"/><circle class="bf-hi" cx="229.2" cy="233" r="1.6"/></g></g>
          <path class="bf-sleep" d="M161 229 Q174 239 187 229 M213 229 Q226 239 239 229"/>
          <path class="bf-happy" d="M161 232 Q174 216 187 232 M213 232 Q226 216 239 232"/>
          <path class="bf-mouth bf-smile" d="M191 252 Q200 262 209 252"/>
          <ellipse class="bf-mouth bf-o" cx="200" cy="256" rx="5" ry="6"/>
          <path class="bf-mouth bf-open" d="M187 250 Q200 274 213 250 Z"/>
          <text class="bf-z a" x="246" y="206">z</text>
          <text class="bf-z b" x="262" y="190">z</text>
        </g>
        </g>
      </svg>
      <div class="bt-burst cup jar" aria-hidden="true"></div>
    </div>
    <p class="bt-jar-count" aria-live="polite"><b>0</b> of <span>0</span> picked</p>
    <button type="button" class="bt-jar-pour" hidden title="Tip them all back into the cup and start a new round">Pour them back</button>`;

  function build(doc) {
    if (views.has(doc)) return views.get(doc).el;
    const wrap = doc.querySelector('.wheel-wrap');
    if (!wrap) return null;
    const el = doc.createElement('div');
    el.className = 'boba';
    el.id = 'boba';
    el.dataset.state = '';
    el.innerHTML = MARKUP;
    wrap.appendChild(el);
    const burst = el.querySelector('.bt-burst');
    const cupBurst = el.querySelector('.bt-burst.cup');
    const fill = (b, n, off) => { b.innerHTML = Array.from({ length: n }, (_, i) =>
      `<i class="${i % 3 === 2 ? 'spark' : 'heart'}" style="--a:${(i * 360 / n + off).toFixed(1)}deg;--d:${(0.55 + (i % 4) * 0.12).toFixed(2)};--s:${(0.8 + (i % 3) * 0.25).toFixed(2)}"></i>`).join(''); };
    fill(burst, 14, 6);
    fill(cupBurst, 16, 11);
    cupBurst.style.left = `${(FACE_C.x / 4).toFixed(2)}%`;
    cupBurst.style.top = `${((FACE_C.y + 20 + DY) / 4).toFixed(2)}%`;
    burst.style.left = `${(OUT.x / 4).toFixed(2)}%`;
    burst.style.top = `${((OUT.y + DY) / 4).toFixed(2)}%`;
    // The jar (No repeats): the layout's right-hand column (CSS grid area
    // "tray"), page only.
    const stage = doc.querySelector('.wheel-page .wheel-layout');
    let jar = null;
    if (stage) {
      const box = doc.createElement('aside');
      box.className = 'bt-jar';
      box.hidden = true;
      box.setAttribute('aria-label', 'Picked this round');
      box.innerHTML = JAR_MARKUP;
      stage.appendChild(box);
      const cup = box.querySelector('.bt-jar-cup');
      const jb = box.querySelector('.bt-burst');
      fill(jb, 16, 3);
      jb.style.left = '50%';
      jb.style.top = `${((230 + DY) / 4).toFixed(2)}%`;
      jar = {
        el: box, cup,
        layer: box.querySelector('.bt-pearls'),
        burst: jb,
        count: box.querySelector('.bt-jar-count b'),
        of: box.querySelector('.bt-jar-count span'),
        pour: box.querySelector('.bt-jar-pour'),
        pearls: new Map(),                       // id -> pearl (box units, like the cup's)
        total: 0,                                // everyone in this round
        r: 0, k: 0,
        wasFull: null, ready: false,
        partyUntil: 0, mood: '',
        pouring: false,
      };
    }
    const v = {
      doc, el, jar,
      picked: [],                                // [{ id, label }] in pick order (No repeats)
      incoming: new Set(),                       // ids tumbling back from the jar: hidden here until they land
      flyingId: null,                            // the picked pearl on its way over to the jar
      respawnId: null,                           // No repeats off: drops back in when the spotlight closes
      layer: el.querySelector('.bt-pearls'),
      burst, cupBurst,
      counter: el.querySelector('.bt-counter b'),
      pearls: new Map(),                         // id -> pearl
      k: 0, r: 12,
      active: null,
      gone: null,                                // id whose pearl left the cup
      from: null,                                // where the chosen one separated (box units)
      popped: false,
      revealed: false,
      partyUntil: 0,                             // the reveal's happy pose until then
      mood: '', lx: 0, ly: 0,
      last: 0,
      timers: [],
    };
    views.set(doc, v);
    if (jar) jar.pour.addEventListener('click', () => pour(v));
    const win = doc.defaultView;
    const frame = (t) => { step(v, t); win.requestAnimationFrame(frame); };
    win.requestAnimationFrame(frame);
    return el;
  }

  // ---------- pearls ----------
  function addPearl(v, id, fromTop) {
    const h = hash(id);
    const p = v.doc.createElement('span');
    p.className = 'bt-pearl';
    const s = 0.88 + ((h >>> 8) % 1000) / 1000 * 0.24;          // 0.88–1.12: hand-rolled, not stamped
    p.style.setProperty('--s', s.toFixed(3));
    p.innerHTML = '<span class="bt-pearl-name"></span>';
    v.layer.appendChild(p);
    const y = fromTop ? TEA + 4 : rnd(300, FLOOR - 8);
    const pearl = {
      id, el: p, s, label: '',
      x: lerp(wallL(y), wallR(y), rnd(0.15, 0.85)), y, vx: rnd(-20, 20), vy: 0, hidden: false,
    };
    v.pearls.set(id, pearl);
    if (v.incoming.has(id)) { pearl.hidden = true; p.classList.add('gone'); }
    return pearl;
  }
  // One pearl per name in the list (the wheel's displayList), its name on it
  // (the wheel's label: first names unless that's switched off), shortened to
  // fit; the type scales with the name's length (--n) and the pearl's size.
  const short = (t) => (t.length > 9 ? t.slice(0, 8) + '…' : t);
  // How big a name can be, in pearl diameters: the measured width at 100px
  // (Comfortaa 700) scaled so the ink spans 78% of the pearl. Before the font
  // is in, a per-letter estimate; the font load re-measures every pearl.
  let meas = null;
  const fontIn = () => !document.fonts || document.fonts.check('700 100px Comfortaa');
  function fitFor(t) {
    if (!fontIn()) return Math.min(0.3, 1.3 / Math.max(3, t.length));
    meas = meas || document.createElement('canvas').getContext('2d');
    meas.font = '700 100px Comfortaa';
    const w = meas.measureText(t).width / 100 || 1;   // em
    return Math.min(0.3, 0.78 / w);
  }
  if (document.fonts) document.fonts.load('700 100px Comfortaa').then(() => {
    views.forEach((v) => v.pearls.forEach((p) => { if (p.label) p.el.style.setProperty('--fit', fitFor(short(p.label)).toFixed(4)); }));
  }).catch(() => {});
  function setLabel(p, label) {
    if (p.label === label) return;
    p.label = label;
    const t = short(label);
    const span = p.el.querySelector('.bt-pearl-name');
    span.textContent = t;
    p.el.style.setProperty('--fit', fitFor(t).toFixed(4));
    p.el.title = label;
  }
  function sync(doc, list) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    const ids = new Set(list.map((x) => x.id));
    for (const [id, p] of v.pearls) {
      if (!ids.has(id) && !(v.active && v.active.winnerId === id)) { p.el.remove(); v.pearls.delete(id); }
    }
    for (const x of list) {
      let p = v.pearls.get(x.id);
      if (!p) p = addPearl(v, x.id, v.k > 0);
      else if (p.hidden && !v.active && v.gone === x.id && !v.incoming.has(x.id)) { show(p); v.gone = null; }
      setLabel(p, x.label || '');
    }
    paintCount(v);
  }
  // back into the cup: it drops in from just under the surface
  function show(p) {
    p.hidden = false;
    p.el.classList.remove('gone', 'picked');
    p.el.style.width = p.el.style.height = '';
    p.y = TEA + 4; p.x = lerp(wallL(p.y), wallR(p.y), rnd(0.3, 0.7)); p.vx = 0; p.vy = 0;
  }
  function hide(v, p) {
    p.hidden = true;
    p.el.classList.add('gone');
    p.el.classList.remove('picked');
    v.gone = p.id;
    paintCount(v);
  }
  function paintCount(v) {
    let n = 0;
    for (const p of v.pearls.values()) if (!p.hidden) n++;
    v.counter.textContent = String(n);
    v.el.dataset.empty = n ? '' : '1';
  }

  // ---------- the loop ----------
  function step(v, t) {
    const dt = Math.min(0.033, v.last ? (t - v.last) / 1000 : 0.016);
    v.last = t;
    if (isOn(v.doc)) stepJar(v, dt);
    if (!isOn(v.doc) || !v.el.offsetParent) return;
    const B = v.el.clientWidth;
    if (!B) return;
    v.k = B / 400;
    // pearl size: fixed for any class up to ~28 (so the cup empties as names
    // go); only a bigger class shrinks them to fit the bottom of the cup
    const n = Math.max(1, v.pearls.size);
    const r = Math.min(14.5, Math.sqrt(0.5 * 37800 / (Math.PI * n)));
    v.r = r;
    v.layer.style.setProperty('--pr', `${(r * 2 * v.k).toFixed(1)}px`);

    const s = v.active;
    const el = s ? Date.now() - s.startedAt : Infinity;
    const chosen = s ? v.pearls.get(s.winnerId) : null;
    // the swirl: builds, holds for a beat, lets go
    const swirl = s ? smooth(T.swirl0, T.swirlUp, el) * (1 - smooth(T.swirlDown, T.swirl1, el)) : 0;
    if (s && chosen && !chosen.hidden && el >= T.pick) {
      if (!chosen.el.classList.contains('picked')) { chosen.el.classList.add('picked'); v.from = { x: chosen.x, y: chosen.y }; }
      if (el >= T.pop) pop(v, chosen);
      else paintChosen(v, chosen, el);
    }
    if (s && el >= T.name && !v.revealed) reveal(v);

    // the cup's mood: wow through the shake and swirl, watching once a pearl
    // is chosen (its eyes follow it), party at the reveal, otherwise idle
    const mood = s ? (el >= T.name ? 'party' : el >= T.pick ? 'look' : 'wow')
      : (Date.now() < v.partyUntil ? 'party' : 'idle');
    if (v.mood !== mood) { v.mood = mood; v.el.dataset.mood = mood; }
    let lx = 0, ly = 0;
    if (mood === 'look' && chosen && !chosen.hidden) {
      lx = Math.max(-1, Math.min(1, (chosen.x - FACE_C.x) / 90));
      ly = Math.max(-1, Math.min(1, (chosen.y - FACE_C.y) / 120));
    } else if (mood === 'look') { lx = 0.6; ly = -1; }               // it just left the top of the straw
    lx = Math.round(lx * 20) / 20; ly = Math.round(ly * 20) / 20;
    if (lx !== v.lx || ly !== v.ly) {
      v.lx = lx; v.ly = ly;
      v.el.style.setProperty('--lx', String(lx));
      v.el.style.setProperty('--ly', String(ly));
    }

    const live = [...v.pearls.values()].filter((p) => !p.hidden && !p.el.classList.contains('picked'));

    // physics: gravity, the swirl, soft collisions, the tapered walls
    const g = 900;
    for (const p of live) {
      p.vy += g * dt;
      if (swirl > 0) {
        // round and round about the middle of the tea, lifted up into it,
        // with a kick so they tumble rather than orbit
        const dx = p.x - SWIRL_C.x, dy = p.y - SWIRL_C.y;
        p.vx += (-dy * 9 + rnd(-1, 1) * 900) * swirl * dt;
        p.vy += (dx * 9 - rnd(0.6, 1.4) * 1500 + rnd(-1, 1) * 700) * swirl * dt;
      }
      p.vx *= Math.exp(-1.1 * dt); p.vy *= Math.exp(-0.6 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < live.length; i++) {
        const a = live[i];
        for (let j = i + 1; j < live.length; j++) {
          const b = live[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          // a little give (0.9), so a resting pile overlaps and clusters
          // like real boba instead of stacking in a neat grid
          const d = Math.hypot(dx, dy), min = r * (a.s + b.s) * 0.9;
          if (d >= min || d === 0) continue;
          const nx = dx / d, ny = dy / d, push = (min - d) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) { const j2 = -rv * 0.6; a.vx -= nx * j2; a.vy -= ny * j2; b.vx += nx * j2; b.vy += ny * j2; }
        }
      }
      for (const p of live) {
        const pr = r * p.s;
        if (p.y > FLOOR - pr) { p.y = FLOOR - pr; if (p.vy > 0) p.vy *= -0.35; p.vx *= 0.97; }
        if (p.y < TEA + pr) { p.y = TEA + pr; if (p.vy < 0) p.vy *= -0.5; }
        const L = wallL(p.y) + pr, R = wallR(p.y) - pr;
        if (p.x < L) { p.x = L; if (p.vx < 0) p.vx *= -0.7; }       // a bounce off the side
        if (p.x > R) { p.x = R; if (p.vx > 0) p.vx *= -0.7; }
      }
    }
    // lower pearls draw in front
    const k = v.k;
    for (const p of live) {
      const pr = r * p.s;
      p.el.style.zIndex = String(Math.round(p.y));
      p.el.style.transform = `translate(${((p.x - pr) * k).toFixed(1)}px, ${((p.y + DY - pr) * k).toFixed(1)}px)`;
    }
  }

  // Where the chosen pearl is at time `el` (box units), and how big. Each leg
  // has its own easing: an ease-in-out glide to the straw's mouth, a trip up
  // the straw in sips (eased, with three surges), then a quick hop out.
  function chosenPose(v, el, own) {
    const big = Math.min(v.r * 2 * 1.3, IN_STRAW + 2);
    if (el < T.draw) {
      const f = v.from || MOUTH;
      const p = easeInOut(clamp01((el - T.pick) / (T.draw - T.pick)));
      const grow = smooth(T.pick, T.pick + 160, el);
      return { x: lerp(f.x, MOUTH.x, p), y: lerp(f.y, MOUTH.y, p), D: lerp(own, big, grow) };
    }
    if (el < T.top) {
      const u = easeInOut(clamp01((el - T.draw) / (T.top - T.draw)));
      const sip = u - 0.6 * Math.sin(6 * Math.PI * u) / (6 * Math.PI);
      const at = strawAt(lerp(0.04, 1, sip));
      return { x: at.x, y: at.y, D: Math.min(big, IN_STRAW) };
    }
    const q = easeOut(clamp01((el - T.top) / (T.pop - T.top)));
    return { x: lerp(STRAW_T.x, OUT.x, q), y: lerp(STRAW_T.y, OUT.y, q), D: lerp(Math.min(big, IN_STRAW), big * 1.15, q) };
  }
  function paintChosen(v, p, el) {
    const pose = chosenPose(v, el, v.r * 2 * p.s);
    p.x = pose.x; p.y = pose.y;
    const k = v.k, D = pose.D * k;
    p.el.style.zIndex = '1000';                 // in front of the pile
    p.el.style.width = p.el.style.height = `${D.toFixed(1)}px`;
    p.el.style.transform = `translate(${(pose.x * k - D / 2).toFixed(1)}px, ${((pose.y + DY) * k - D / 2).toFixed(1)}px)`;
  }

  function pop(v, p) {
    if (v.popped) return;
    v.popped = true;
    spotlight(v, p);
    hide(v, p);
    p.el.style.width = p.el.style.height = '';
    fire(v.burst);
  }
  // Play a burst once, then take .go off again: its hearts end on
  // `fill-mode: forwards`, invisible but still parked far out from the cup,
  // and one parked below the page made main.page scroll after every pick
  // (the scrollbar came and went as the cup bobbed and lifted on hover).
  function fire(el) {
    clearTimeout(el._off);
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    el._off = setTimeout(() => el.classList.remove('go'), BURST_MS);
  }
  // The cup cheers behind the spotlight: the party pose, a bounce and hearts
  // all round it.
  function reveal(v) {
    v.revealed = true;
    v.el.dataset.state = 'picked';
    v.partyUntil = Date.now() + PARTY_MS;
    fire(v.cupBurst);
  }

  // ---------- the spotlight: the chosen pearl, big, in front of everything ----------
  // A fixed overlay on the page: a dimmed backdrop, the pearl as a big disc in
  // the middle with the name on it, hearts bursting round it and a quiet
  // "click or Space" line. It grows out of where the pearl left the straw
  // (FLIP: placed at its final size, started from the small pearl's box).
  // A click, Space, Enter or Esc puts it away; so does the next pick.
  function spotlight(v, p) {
    dismiss(v, true);
    const doc = v.doc, win = doc.defaultView;
    const name = p.label || '';
    const from = p.el.getBoundingClientRect();
    const o = doc.createElement('div');
    o.className = 'bt-spot';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-label', `Picked: ${name}`);
    o.innerHTML = `<div class="bt-spot-pearl"><span class="bt-spot-name"></span><div class="bt-spot-burst" aria-hidden="true">${
      Array.from({ length: 18 }, (_, i) => `<i class="${i % 3 === 2 ? 'spark' : 'heart'}" style="--a:${(i * 20 + 7)}deg;--d:${(0.5 + (i % 4) * 0.17).toFixed(2)};--s:${(0.8 + (i % 3) * 0.3).toFixed(2)}"></i>`).join('')
    }</div></div><p class="bt-spot-hint">Click or press Space to go back</p>`;
    const nameEl = o.querySelector('.bt-spot-name');
    nameEl.textContent = name;
    // the longest name still fits the disc: size in % of the disc's width
    const longest = Math.max(4, ...name.split(/s+/).map((w) => w.length));
    nameEl.style.setProperty('--fs', `${Math.min(22, 118 / longest).toFixed(1)}cqi`);
    doc.body.appendChild(o);
    const disc = o.querySelector('.bt-spot-pearl');
    const to = disc.getBoundingClientRect();
    if (from.width && to.width) {
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      disc.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${(from.width / to.width).toFixed(4)})`;
    }
    void disc.offsetWidth;
    o.classList.add('in');
    disc.style.transform = '';
    const close = () => dismiss(v);
    const onKey = (e) => {
      if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation();
      close();
    };
    o.addEventListener('click', close);
    win.addEventListener('keydown', onKey, true);       // capture: before wheel.js's Space-to-spin
    v.spot = { el: o, onKey, id: p.id };
    renderJar(v);                                 // keep the picked one out of the jar until it lands
  }
  function dismiss(v, now = false, tell = !now) {
    const sp = v.spot;
    if (!sp) return;
    v.spot = null;
    if (tell && spotChan) spotChan.postMessage({ type: 'boba-dismiss' });
    v.doc.defaultView.removeEventListener('keydown', sp.onKey, true);
    if (now) { sp.el.remove(); renderJar(v); return; }
    // No repeats: the pearl arcs over into the jar
    const listed = v.jar && !v.jar.el.hidden && v.picked.some((x) => x.id === sp.id);
    if (listed && sp.el.querySelector('.bt-spot-pearl')) { flyToJar(v, sp); return; }
    renderJar(v);
    if (v.respawnId) {                            // No repeats off: back into the cup
      const id = v.respawnId; v.respawnId = null;
      setTimeout(() => respawn(v, id), 200);
    }
    sp.el.classList.remove('in');
    sp.el.classList.add('out');
    setTimeout(() => sp.el.remove(), 260);
  }
  function respawn(v, id) {
    const q = v.pearls.get(id);
    if (q && q.hidden && !v.active) { show(q); if (v.gone === id) v.gone = null; paintCount(v); }
  }

  // ---------- the jar: who's been picked this round (No repeats) ----------
  // Its pearls live in the same box units as the cup's, so they share the
  // walls and the floor; their size comes from the round's head count, so a
  // full round fills the jar to just under its face.
  const jarR = (n) => Math.min(22, Math.sqrt(0.5 * JAR_AREA / (Math.PI * Math.max(1, n))));
  function addJarPearl(v, id, at) {
    const J = v.jar, h = hash(id);
    const el = v.doc.createElement('span');
    el.className = 'bt-pearl';
    const s = 0.88 + ((h >>> 8) % 1000) / 1000 * 0.24;
    el.style.setProperty('--s', s.toFixed(3));
    el.innerHTML = '<span class="bt-pearl-name"></span>';
    J.layer.appendChild(el);
    // already picked (a reload, a put-back elsewhere): it settles from low in the jar
    const y = at ? at.y : rnd(250, FLOOR - 10);
    const p = { id, el, s, label: '', x: at ? at.x : lerp(wallL(y), wallR(y), rnd(0.2, 0.8)), y, vx: at ? at.vx : 0, vy: at ? at.vy : 0 };
    J.pearls.set(id, p);
    return p;
  }
  function stepJar(v, dt) {
    const J = v.jar;
    if (!J || J.el.hidden || !J.cup.offsetParent) return;
    const B = J.cup.clientWidth;
    if (!B) return;
    const k = B / 400, r = jarR(J.total || J.pearls.size);
    if (k !== J.k || r !== J.r) { J.k = k; J.r = r; J.layer.style.setProperty('--pr', `${(r * 2 * k).toFixed(1)}px`); }
    const mood = Date.now() < J.partyUntil ? 'party' : '';
    if (J.mood !== mood) { J.mood = mood; J.cup.dataset.mood = mood; }
    const live = [...J.pearls.values()];
    for (const p of live) {
      p.vy += 900 * dt;
      p.vx *= Math.exp(-1.6 * dt); p.vy *= Math.exp(-0.6 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < live.length; i++) {
        const a = live[i];
        for (let m = i + 1; m < live.length; m++) {
          const b = live[m];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy), min = r * (a.s + b.s) * 0.9;
          if (d >= min || d === 0) continue;
          const nx = dx / d, ny = dy / d, push = (min - d) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) { const j2 = -rv * 0.6; a.vx -= nx * j2; a.vy -= ny * j2; b.vx += nx * j2; b.vy += ny * j2; }
        }
      }
      for (const p of live) {
        const pr = r * p.s;
        if (p.y > FLOOR - pr) { p.y = FLOOR - pr; if (p.vy > 0) p.vy *= -0.35; p.vx *= 0.97; }
        if (p.y > CUP.top) {                         // inside: the tapered walls (above the rim it's still falling in)
          const L = wallL(p.y) + pr, R = wallR(p.y) - pr;
          if (p.x < L) { p.x = L; if (p.vx < 0) p.vx *= -0.6; }
          if (p.x > R) { p.x = R; if (p.vx > 0) p.vx *= -0.6; }
        }
      }
    }
    for (const p of live) {
      const pr = r * p.s;
      p.el.style.zIndex = String(Math.round(p.y));
      p.el.style.transform = `translate(${((p.x - pr) * k).toFixed(1)}px, ${((p.y + DY - pr) * k).toFixed(1)}px)`;
    }
  }
  // The jar holds everyone picked this round except the one still in the
  // spotlight or on its way over (they join when they land).
  function renderJar(v) {
    const J = v.jar;
    if (!J) return;
    const skip = new Set([v.spot && v.spot.id, v.flyingId].filter(Boolean));
    const want = new Map(v.picked.filter((x) => !skip.has(x.id)).map((x) => [x.id, x]));
    for (const [id, p] of J.pearls) if (!want.has(id)) { p.el.remove(); J.pearls.delete(id); }
    for (const x of want.values()) setLabel(J.pearls.get(x.id) || addJarPearl(v, x.id, null), x.label);
    paintJar(v);
  }
  // The face, the count and the pour button follow how full it is.
  function paintJar(v) {
    const J = v.jar;
    if (!J) return;
    const n = J.pearls.size, total = Math.max(J.total, n);
    const full = total > 0 && n >= total;
    J.cup.dataset.fill = full ? 'full' : n >= total / 2 && n ? 'happy' : n ? 'content' : 'sleepy';
    J.count.textContent = String(n);
    J.of.textContent = String(total);
    J.el.dataset.full = full ? '1' : '';
    J.pour.hidden = !n && !J.pouring;
    J.pour.disabled = J.pouring || !!v.active;
    J.pour.classList.toggle('primary', full);
    if (full && J.wasFull === false && J.ready) celebrate(v);
    J.wasFull = full;
  }
  // Everyone's been picked: a hop, arms waving, hearts.
  function celebrate(v) {
    const J = v.jar;
    J.partyUntil = Date.now() + 2600;
    fire(J.burst);
    if (soundOn(v.doc)) cheerSound();
  }

  // Fly an element (already where it starts, at transform: none) along an
  // arc to (dx, dy) px away: a quadratic curve bowed upward by `lift`, a spin,
  // and a scale. Plain rAF, so it is one smooth curve rather than a CSS
  // straight line.
  const reduced = (win) => win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function arc(win, el, { dx, dy, lift, dur, spin = 0, scale = 1, fade = false, delay = 0 }, done) {
    const cx = dx * 0.45, cy = Math.min(0, dy) - lift;
    let t0 = null;
    const frame = (now) => {
      if (t0 === null) t0 = now + delay;
      const t = clamp01((now - t0) / dur), u = easeInOut(t), w = 1 - u;
      const x = 2 * w * u * cx + u * u * dx, y = 2 * w * u * cy + u * u * dy;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(u * spin).toFixed(1)}deg) scale(${lerp(1, scale, easeOut(t)).toFixed(4)})`;
      if (fade) el.style.opacity = String(1 - smooth(0.8, 1, t));
      if (t < 1) win.requestAnimationFrame(frame); else done();
    };
    win.requestAnimationFrame(frame);
  }
  // The spotlight's disc, shrinking as it goes, arcs over the page with two
  // turns and drops in through the open top.
  function flyToJar(v, sp) {
    const J = v.jar, win = v.doc.defaultView;
    const disc = sp.el.querySelector('.bt-spot-pearl');
    const who = v.picked.find((x) => x.id === sp.id);
    v.flyingId = sp.id;
    const a = disc.getBoundingClientRect(), c = J.cup.getBoundingClientRect(), k = c.width / 400;
    const land = { x: rnd(160, 240), y: 70 };                   // box units, above the jar's mouth
    const bx = c.left + land.x * k, by = c.top + (land.y + DY) * k;
    const dx = bx - (a.left + a.width / 2), dy = by - (a.top + a.height / 2);
    const end = (jarR(J.total) * 2 * k) / a.width;
    const slow = reduced(win);
    sp.el.classList.add('flying');
    disc.style.transition = 'none';
    arc(win, disc, { dx, dy, lift: slow ? 0 : Math.max(120, Math.hypot(dx, dy) * 0.45), dur: slow ? 320 : 900, spin: slow ? 0 : 720, scale: end }, () => {
      sp.el.remove();
      v.flyingId = null;
      if (!v.picked.some((x) => x.id === sp.id)) { renderJar(v); return; }   // put back while it flew
      const p = addJarPearl(v, sp.id, { x: land.x, y: land.y, vx: dx > 0 ? 40 : -40, vy: 260 });
      setLabel(p, who ? who.label : '');
      renderJar(v);
      if (soundOn(v.doc)) plopSound();
    });
  }
  // Pour them back: the jar tips toward the cup and its pearls tumble across
  // one after another (top first), each on its own arc with a spin, and drop
  // into the cup. The round is reset as they leave (wheel.js clears
  // `called`); the cup keeps each one hidden until it lands (`incoming`).
  function pour(v) {
    const J = v.jar, doc = v.doc, win = doc.defaultView;
    if (!J || J.pouring || v.active || !J.pearls.size) return;
    // the wheel may say no (a saved pick list asks before it is reset)
    if (!doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset-request', { cancelable: true }))) return;
    J.pouring = true;
    J.el.dataset.state = 'pouring';
    setDisabled(doc, v.off);
    paintJar(v);
    const slow = reduced(win);
    setTimeout(() => {
      const items = [...J.pearls.values()].sort((p, q) => p.y - q.y);
      const B = v.el.getBoundingClientRect(), kc = B.width / 400;
      const STAGGER = slow ? 0 : Math.min(60, 1100 / items.length);
      items.forEach((p, i) => {
        // the tipped jar turns its pearls too: take the centre from the
        // (rotated) box and the size from the untransformed one
        const r0 = p.el.getBoundingClientRect(), w = p.el.offsetWidth;
        const cx0 = r0.left + r0.width / 2, cy0 = r0.top + r0.height / 2;
        const f = doc.createElement('span');
        f.className = 'bt-pearl bt-flyer';
        f.innerHTML = p.el.innerHTML;
        f.style.setProperty('--s', p.s.toFixed(3));
        f.style.setProperty('--pr', `${(w / p.s).toFixed(1)}px`);
        f.style.setProperty('--fit', p.el.style.getPropertyValue('--fit'));
        f.style.left = `${(cx0 - w / 2).toFixed(1)}px`;
        f.style.top = `${(cy0 - w / 2).toFixed(1)}px`;
        doc.body.appendChild(f);
        p.el.remove();
        J.pearls.delete(p.id);
        v.incoming.add(p.id);
        const tx = B.left + rnd(150, 250) * kc, ty = B.top + (110 + DY) * kc;
        arc(win, f, {
          dx: tx - cx0, dy: ty - cy0,
          lift: slow ? 0 : rnd(70, 140), dur: slow ? 300 : 700, spin: slow ? 0 : rnd(-540, -300),
          scale: (v.r * 2 * p.s * kc) / w, fade: true, delay: i * STAGGER,
        }, () => {
          f.remove();
          v.incoming.delete(p.id);
          const q = v.pearls.get(p.id);
          if (q && q.hidden) { show(q); paintCount(v); }
          if (soundOn(doc) && i % 2 === 0) blip(audio(), audio().currentTime, { type: 'triangle', f0: rnd(700, 1000), f1: 400, len: 0.05, gain: 0.04 });
        });
      });
      paintJar(v);
      doc.dispatchEvent(new CustomEvent('teacherpal:wheel-reset'));   // the round starts over
      setTimeout(() => {
        J.pouring = false;
        J.el.dataset.state = '';
        v.incoming.forEach((id) => { const q = v.pearls.get(id); if (q && q.hidden) show(q); });   // a flight that never finished
        v.incoming.clear();
        paintCount(v);
        setDisabled(doc, v.off);
        paintJar(v);
      }, items.length * STAGGER + (slow ? 300 : 700) + 200);
    }, slow ? 0 : 420);
  }
  // wheel.js hands over who's been called (No repeats on) and how many are
  // in the round, or null (No repeats off: no jar).
  function setPicked(doc, list, total) {
    const v = views.get(doc);
    if (!v || !v.jar) return;
    v.jar.el.hidden = !list;
    v.picked = list || [];
    v.jar.total = list ? Math.max(total || 0, v.picked.length) : 0;
    renderJar(v);
    v.jar.ready = true;
  }

  // ---------- a pick ----------
  function run(doc, s, { sound = false } = {}) {
    const v = views.get(doc) || (build(doc) && views.get(doc));
    if (!v) return;
    v.timers.forEach(clearTimeout); v.timers = [];
    if (v.respawnId) { respawn(v, v.respawnId); v.respawnId = null; }
    dismiss(v, true);
    v.active = s;
    v.revealed = false;
    v.popped = false;
    v.from = null;
    v.burst.classList.remove('go');
    v.cupBurst.classList.remove('go');
    v.partyUntil = 0;
    v.el.dataset.state = '';
    void v.el.offsetWidth;                        // restart the shake
    v.el.dataset.state = 'shaking';
    if (sound) bobaSound();
    paintJar(v);
  }
  function finish(doc, s, { respawn: respawnIt = false } = {}) {
    const v = views.get(doc);
    if (!v) return;
    v.active = null;
    // Land on the final pose even if this window missed frames (a hidden or
    // throttled window doesn't run rAF): the pearl gone from the cup and the
    // name up.
    const p = v.pearls.get(s.winnerId);
    if (p && !p.hidden && !v.popped) { spotlight(v, p); hide(v, p); p.el.style.width = p.el.style.height = ''; }
    else if (p && !p.hidden) { hide(v, p); p.el.style.width = p.el.style.height = ''; }
    v.popped = true;
    if (!v.revealed) reveal(v);
    v.el.dataset.state = 'picked';
    paintJar(v);
    // With No repeats off the pearl goes back in a moment later. With it on,
    // the cup stays one pearl lighter.
    if (respawnIt) {
      if (v.spot) v.respawnId = s.winnerId;
      else v.timers.push(setTimeout(() => respawn(v, s.winnerId), 1400));
    }
  }
  // the cup's state follows the pick (state: '' | 'boiling' (a pick is under
  // way) | 'picked'); the name itself is the result panel's
  function setWinner(doc, name, state) {
    const v = views.get(doc);
    if (!v) return;
    if (state === 'picked' && name) v.el.dataset.state = 'picked';
    else if (state === 'boiling') {
      if (!v.revealed && v.el.dataset.state !== 'shaking') v.el.dataset.state = 'shaking';
    } else if (!v.active) { v.el.dataset.state = ''; dismiss(v, true); }
  }
  function setDisabled(doc, off) {
    const v = views.get(doc);
    if (!v) return;
    v.off = !!off;
    const h = v.el.querySelector('.bt-handle');
    const no = v.off || busy(doc);                  // no picks while pearls are pouring back
    v.el.setAttribute('aria-disabled', String(no));
    if (h) h.disabled = no;
  }
  const busy = (doc) => { const v = views.get(doc); return !!v && (!!(v.jar && v.jar.pouring) || v.incoming.size > 0); };

  // ---------- sound: a shake, the slosh, a slurp up the straw, the pop ----------
  let ctx = null, noiseBuf = null;
  function audio() {
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
    if (ctx && !noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx;
  }
  // a burst of filtered noise; f0 → f1 is the filter's sweep
  function hiss(c, at, len, { f0 = 1200, f1 = f0, q = 1, gain = 0.1, type = 'bandpass', attack = 0.01 } = {}) {
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(at, Math.random() * 0.5); src.stop(at + len + 0.05);
  }
  function blip(c, at, { type = 'sine', f0 = 900, f1 = 600, len = 0.05, gain = 0.05 } = {}) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + len + 0.02);
  }
  function bobaSound() {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const t0 = c.currentTime, s = (ms) => t0 + ms / 1000;
    // the shake: eight rattly shakes of the cup, pearls knocking inside
    for (let i = 0; i < 8; i++) {
      hiss(c, s(i * 120), 0.09, { f0: 2600, f1: 1400, q: 1.4, gain: 0.07 });
      blip(c, s(i * 120 + rnd(10, 40)), { type: 'triangle', f0: rnd(500, 800), f1: 300, len: 0.04, gain: 0.04 });
    }
    // the swirl: a low slosh that swells and fades
    hiss(c, s(T.swirl0), (T.swirl1 - T.swirl0) / 1000, { f0: 380, f1: 520, q: 0.8, gain: 0.05, type: 'lowpass', attack: 0.4 });
    // the slurp: a rising, gurgling suck up the straw, one surge per sip
    hiss(c, s(T.draw - 80), (T.top - T.draw + 80) / 1000, { f0: 500, f1: 2200, q: 3, gain: 0.09, attack: 0.08 });
    for (let k = 0; k < 3; k++) {
      const at = T.draw + (T.top - T.draw) * (k + 0.35) / 3;
      blip(c, s(at), { f0: 260 + k * 90, f1: 520 + k * 140, len: 0.09, gain: 0.07 });
    }
    // the pop out of the straw, and a little sparkle
    blip(c, s(T.pop), { type: 'triangle', f0: 1200, f1: 240, len: 0.12, gain: 0.22 });
    blip(c, s(T.pop + 60), { f0: 1600, f1: 2600, len: 0.12, gain: 0.05 });
    blip(c, s(T.pop + 150), { f0: 2100, f1: 3200, len: 0.1, gain: 0.04 });
  }

  // the Name Wheel's mute switch (aria-checked = muted)
  const soundOn = (doc) => { const m = doc.getElementById('wheel-mute'); return !!m && m.getAttribute('aria-checked') !== 'true'; };
  function plopSound() {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    blip(c, c.currentTime + 0.02, { type: 'sine', f0: 520, f1: 180, len: 0.12, gain: 0.12 });
    blip(c, c.currentTime + 0.1, { type: 'triangle', f0: 900, f1: 500, len: 0.05, gain: 0.04 });
  }
  function cheerSound() {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    [660, 830, 990, 1320].forEach((f, i) => blip(c, c.currentTime + i * 0.09, { f0: f, f1: f * 1.02, len: 0.16, gain: 0.06 }));
  }

  window.Boba = { DURATION_MS, SETTLE_MS, HOLDS_ROUND: true, isOn, busy, build, sync, run, finish, setWinner, setDisabled, setPicked };
})();
