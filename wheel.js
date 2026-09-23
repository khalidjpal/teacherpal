// wheel.js - random name wheel.
//
// FAIRNESS: the winner is drawn FIRST (crypto.getRandomValues over the pool),
// and only then is the landing rotation computed so that slice stops under the
// pointer. The animation cannot bias the result - it is just a picture of a
// decision already made.
//
// Two views, same shape as the Timer and the Noise Meter:
//   * main window (this file, when body has no .wheel-popout class) - owns the
//     roster, the pool and the spin; the only writer.
//   * pop-out (wheel-popout.html) - read-only wheel on the projector, fed over
//     BroadcastChannel('teacherpal-wheel'). A spin is broadcast as
//     { from, to, startedAt, duration }, so both windows animate the same
//     rotation from Date.now() instead of trying to keep two clocks in step.
//
// Who is on the wheel: the period's roster minus today's absentees (the
// attendance table, the same source as everywhere else) minus anyone sitting
// out in Create Groups. With "No repeats" on, picked students drop off until
// the pool empties and the wheel refills.

(function () {
  const isPopout = document.body.classList.contains('wheel-popout');
  const CH = 'teacherpal-wheel';
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel(CH) : null;

  const FIRST_KEY  = 'teacherpal.groups.firstNames';   // shared with Create Groups / Seating
  const MUTE_KEY   = 'teacherpal.wheel.muted';
  const REPEAT_KEY = 'teacherpal.wheel.noRepeats';
  const calledKey  = (pid) => `teacherpal.wheel.called.${pid}`;
  const removedKey = (pid) => `teacherpal.wheel.removed.${pid}`;

  const SPIN_MS = 4500;
  const MIN_TURNS = 5;                // whole rotations before the offset
  const R = 46;                       // slice radius in the 100x100 viewBox
  const COLORS = 6;                   // palette slots (.c0 ... .c5)

  // ---------- state ----------
  let periods = [], byNumber = new Map();
  let currentPeriodId = null;
  let roster = [];                    // everyone in the period
  let eligible = [];                  // roster minus absent minus sitting out
  let absentIds = new Set();          // kept so the off-list can say *why*
  let sitOutIds = new Set();          // (both are read-only here)
  let removed = new Set();            // taken off by hand today - see `removed`
  let pool = [];                      // eligible minus removed minus called
  let displayList = [];               // what is actually drawn. Lags `pool` by
                                      // one spin so the winner stays under the
                                      // pointer to be seen, and only drops off
                                      // when the next spin starts.
  let called = new Set();             // picked already (No repeats)
  let firstNamesOnly = true;
  let noRepeats = true;
  let muted = false;
  let followBell = true;
  let winnerId = null;
  let spin = null;                    // { from, to, startedAt, duration, winnerId }
  // Rotation is a RUNNING TOTAL that only ever increases - it is never
  // wrapped back into 0-360. Wrapping it was what made a second spin able to
  // target an angle the wheel was already sitting on.
  let rotation = 0;                   // accumulated rotor angle (deg)
  let timers = [];                    // spin + tick timeouts, cleared on restart
  let drawnSig = '';

  const $ = (id) => document.getElementById(id);
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- names (same rule as Create Groups) ----------
  const firstName = (n) => n.trim().split(/\s+/)[0] || n;
  const lastName = (n) => { const p = n.trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : ''; };
  function labelFor(student, all) {
    if (!firstNamesOnly) return student.name;
    const first = firstName(student.name);
    const twins = all.filter((s) => firstName(s.name).toLocaleLowerCase() === first.toLocaleLowerCase());
    const last = lastName(student.name);
    if (twins.length < 2 || !last) return first;
    for (let k = 1; k <= last.length; k++) {
      const mine = last.slice(0, k).toLocaleLowerCase();
      const unique = twins.every((s) => s === student || lastName(s.name).slice(0, k).toLocaleLowerCase() !== mine);
      if (unique) return `${first} ${last.slice(0, k)}.`;
    }
    return student.name;
  }
  // The pop-out has no roster of its own - the broadcast list carries the
  // labels, so fall back to those.
  const nameOf = (id) => {
    const s = roster.find((x) => x.id === id);
    if (s) return labelFor(s, eligible);
    const hit = displayList.find((d) => d.id === id);
    return hit ? hit.label : '';
  };

  // ---------- settings ----------
  function loadSettings() {
    try {
      firstNamesOnly = localStorage.getItem(FIRST_KEY) !== '0';
      muted = localStorage.getItem(MUTE_KEY) === '1';
      noRepeats = localStorage.getItem(REPEAT_KEY) !== '0';
    } catch { /* ignore */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      localStorage.setItem(REPEAT_KEY, noRepeats ? '1' : '0');
    } catch { /* ignore */ }
  }
  // Called and removed are both per period, per day - a fresh wheel every
  // morning - and both are this browser only. Neither touches attendance:
  // taking someone off the wheel says nothing about whether they are here.
  function loadIdSet(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || 'null');
      if (raw && raw.date === todayKey() && Array.isArray(raw.ids)) return new Set(raw.ids);
    } catch { /* ignore */ }
    return new Set();
  }
  function saveIdSet(key, set) {
    try {
      const ids = [...set];
      if (!ids.length) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ date: todayKey(), ids }));
    } catch { /* ignore */ }
  }
  const loadCalled = (pid) => loadIdSet(calledKey(pid));
  function saveCalled() { if (currentPeriodId) saveIdSet(calledKey(currentPeriodId), called); }
  function saveRemoved() { if (currentPeriodId) saveIdSet(removedKey(currentPeriodId), removed); }

  // ---------- wheel geometry ----------
  const pt = (a) => {
    const r = (a * Math.PI) / 180;
    return [50 + R * Math.cos(r), 50 + R * Math.sin(r)];
  };
  function slicePath(a0, a1) {
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    const large = (a1 - a0) > 180 ? 1 : 0;
    return `M50 50 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
  }
  // Slice fill: walk a pink/magenta ramp (--wheel-r0 ... r7), alternating
  // between its dark and light halves so every boundary is an obvious step
  // while the whole wheel still reads as one graduated set.
  const RAMP = 8;
  function rampIndex(i, n) {
    const half = RAMP / 2;
    let step = (i % 2 === 0)
      ? Math.floor(i / 2) % half                 // darks: r0..r3
      : half + (Math.floor(i / 2) % half);       // lights: r4..r7
    // an odd count puts the last slice next to the first - push it clear
    if (n % 2 === 1 && i === n - 1 && step === 0) step = 2;
    return step;
  }
  function labelSize(n) {
    if (n <= 8) return 5.2;
    if (n <= 14) return 4.2;
    if (n <= 22) return 3.4;
    if (n <= 30) return 2.8;
    return 2.3;
  }

  // Draw the slices into whichever document asks (page or pop-out).
  function drawWheel(doc, list) {
    const rotor = doc.getElementById('wheel-rotor');
    const empty = doc.getElementById('wheel-empty');
    if (!rotor) return;
    if (doc === document) drawnSig = list.map((s) => s.id + ':' + s.label).join('|');
    rotor.innerHTML = '';
    if (empty) empty.hidden = list.length > 0;
    if (!list.length) return;

    const NS = 'http://www.w3.org/2000/svg';
    const n = list.length;
    const seg = 360 / n;
    list.forEach((item, i) => {
      const a0 = i * seg, a1 = (i + 1) * seg;
      let shape;
      if (n === 1) {                                  // one name left: a full disc
        shape = doc.createElementNS(NS, 'circle');
        shape.setAttribute('cx', '50'); shape.setAttribute('cy', '50'); shape.setAttribute('r', String(R));
      } else {
        shape = doc.createElementNS(NS, 'path');
        shape.setAttribute('d', slicePath(a0, a1));
      }
      // r0-r7 is jarvis's graduated ramp; marwa repaints the same elements
      // from its pastel palette via the same classes.
      shape.setAttribute('class', `slice r${rampIndex(i, n)}`);
      shape.setAttribute('data-id', item.id);
      rotor.appendChild(shape);

      // Label along the slice's middle radius, ending near the rim. On the
      // left half it is drawn from the mirrored anchor (rotate mid+180 from
      // the opposite side) so it never reads upside down.
      const mid = a0 + seg / 2;
      const upright = mid <= 90 || mid >= 270;
      const text = doc.createElementNS(NS, 'text');
      text.setAttribute('class', 'slice-label');
      text.setAttribute('y', '50');
      text.setAttribute('dominant-baseline', 'central');
      // Size by slice count AND name length: a long name in a wide face
      // (marwa's Comfortaa) would otherwise run under the hub. Measuring here
      // is unreliable - the webfont often hasn't loaded yet - so this is a
      // deterministic fit against the rim-to-hub gap.
      // Size against the rim-to-hub gap, and once that would take the name
      // below a readable floor, shorten the name instead of letting it
      // overflow into the hub. Measuring is no good here - the webfont is
      // usually still loading - so this is a deterministic fit.
      // the page's hub is the small Spin button (radius 14); the pop-out
      // keeps a bigger disc for the winner's name, so it has less room
      const gap = isPopout ? R - 24 : R - 18;
      const wide = (document.documentElement.getAttribute('data-theme') || 'jarvis') !== 'marwa'
        ? 0.68        // jarvis: mono, uppercase - wider per character
        : 0.62;       // marwa: Comfortaa
      const MIN_SIZE = 2.6;
      let label = item.label;
      let size = Math.min(labelSize(n), gap / (wide * Math.max(1, label.length)));
      if (size < MIN_SIZE) {
        size = MIN_SIZE;
        const maxChars = Math.max(3, Math.floor(gap / (wide * size)));
        if (label.length > maxChars) label = label.slice(0, maxChars - 1).trim() + '…';
      }
      text.setAttribute('font-size', size.toFixed(2));
      if (upright) {
        text.setAttribute('x', String(50 + R - 3));
        text.setAttribute('text-anchor', 'end');
        text.setAttribute('transform', `rotate(${mid} 50 50)`);
      } else {
        text.setAttribute('x', String(50 - R + 3));
        text.setAttribute('text-anchor', 'start');
        text.setAttribute('transform', `rotate(${mid + 180} 50 50)`);
      }
      text.setAttribute('data-id', item.id);
      text.textContent = label;
      rotor.appendChild(text);

      // Long names (and marwa's wider face) would run past the hub, so squeeze
      // anything that doesn't fit the rim-to-hub gap instead of letting it
      // collide with the centre.
      try {
        const maxLen = R - 24;                       // hub radius 20 + padding
        if (text.getComputedTextLength && text.getComputedTextLength() > maxLen) {
          text.setAttribute('textLength', String(maxLen));
          text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
      } catch { /* not laid out yet - leave it */ }
    });

    // Thin glowing divider between slices (jarvis; hidden in marwa, which
    // separates its pastels with a plain white stroke instead).
    if (n > 1) {
      const divs = doc.createElementNS(NS, 'g');
      divs.setAttribute('class', 'slice-dividers');
      for (let i = 0; i < n; i++) {
        const [x, y] = pt(i * seg);
        const line = doc.createElementNS(NS, 'line');
        line.setAttribute('x1', '50'); line.setAttribute('y1', '50');
        line.setAttribute('x2', x.toFixed(2)); line.setAttribute('y2', y.toFixed(2));
        divs.appendChild(line);
      }
      rotor.appendChild(divs);
    }
  }

  // The static instrument ring around the wheel: degree ticks every 10 with a
  // longer mark every 30, plus four corner brackets. Drawn once per document,
  // outside the rotor so it never spins. jarvis only (CSS hides it in marwa).
  function buildDialRing(doc) {
    const dial = doc.getElementById('wheel-dial');
    if (!dial || dial.childElementCount) return;
    const NS = 'http://www.w3.org/2000/svg';
    for (let a = 0; a < 360; a += 10) {
      const long = a % 30 === 0;
      const line = doc.createElementNS(NS, 'line');
      line.setAttribute('x1', '50'); line.setAttribute('y1', long ? '1.5' : '2.4');
      line.setAttribute('x2', '50'); line.setAttribute('y2', '4.2');
      line.setAttribute('transform', `rotate(${a} 50 50)`);
      if (long) line.setAttribute('class', 'long');
      dial.appendChild(line);
    }
    for (const a of [45, 135, 225, 315]) {               // corner brackets
      const arc = doc.createElementNS(NS, 'path');
      const r = 48.6;
      const p = (deg) => {
        const rad = (deg * Math.PI) / 180;
        return `${(50 + r * Math.cos(rad)).toFixed(2)} ${(50 + r * Math.sin(rad)).toFixed(2)}`;
      };
      arc.setAttribute('d', `M${p(a - 9)} A${r} ${r} 0 0 1 ${p(a + 9)}`);
      arc.setAttribute('class', 'bracket');
      dial.appendChild(arc);
    }
  }

  // ---------- tick sound ----------
  let audioCtx = null;
  function tick() {
    if (muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1400, t);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.04);
    } catch { /* ignore */ }
  }

  // ---------- the spin ----------
  // The rotation is driven by a CSS transition on the rotor (compositor, so
  // it stays smooth), with a long ease-out tail: fast at first, then the last
  // few degrees crawl. A short settle transition afterwards gives the little
  // overshoot-and-correct bounce.
  const EASE = [0.17, 0.67, 0.12, 0.99];
  const EASE_CSS = `cubic-bezier(${EASE.join(', ')})`;
  const SETTLE_MS = 460;
  const OVERSHOOT = 4;            // degrees past the mark, corrected on settle

  // Evaluate the timing function, and invert it, so the ticks can be
  // scheduled at the moments the wheel actually passes each slice.
  function bezier(x1, y1, x2, y2) {
    const curve = (a, b) => (t) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
    const bx = curve(x1, x2), by = curve(y1, y2);
    const atTime = (x) => {                 // progress at time fraction x
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 24; i++) { if (bx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return by(t);
    };
    const timeAt = (p) => {                 // time fraction at progress p
      let lo = 0, hi = 1, x = p;
      for (let i = 0; i < 24; i++) { if (atTime(x) < p) lo = x; else hi = x; x = (lo + hi) / 2; }
      return x;
    };
    return { atTime, timeAt };
  }
  const ease = bezier(...EASE);

  function randInt(n) {
    if (window.crypto && window.crypto.getRandomValues) {
      // rejection sampling so every index is equally likely
      const max = Math.floor(0xffffffff / n) * n;
      const buf = new Uint32Array(1);
      let v;
      do { window.crypto.getRandomValues(buf); v = buf[0]; } while (v >= max);
      return v % n;
    }
    return Math.floor(Math.random() * n);
  }

  function startSpin() {
    if (!pool.length) return;
    if (spin) {
      // A spin that should already be over must never block the button: if
      // its end time has passed (a dropped timer, a throttled tab), settle it
      // now and carry on with this click.
      const due = spin.startedAt + spin.duration + spin.settle + 400;
      if (Date.now() < due) return;
      finishSpin(document, spin);
    }
    // The previous winner (still shown under the pointer) drops off now.
    const stale = displayList.length !== pool.length
      || displayList.some((d, i) => !pool[i] || pool[i].id !== d.id);
    if (stale) { winnerId = null; syncWheel(); }

    // 1. decide the winner - nothing about the animation touches this
    const idx = randInt(pool.length);
    const chosen = pool[idx];
    // 2. work out where the wheel must stop for that slice to sit under the
    //    pointer (top = screen angle 270), with a little jitter inside it.
    //    Built as "where we are + at least MIN_TURNS whole turns + whatever
    //    offset lands the slice", so `to` is always well past `from`.
    const seg = 360 / pool.length;
    const centre = idx * seg + seg / 2;
    const jitter = (Math.random() - 0.5) * seg * 0.6;
    const turns = MIN_TURNS + randInt(2);
    const from = rotation;
    const wanted = 270 - centre - jitter;              // desired angle, mod 360
    let to = from + turns * 360;
    to += (((wanted - to) % 360) + 360) % 360;         // ...plus the offset

    // Reduced motion drops the bounce, but keeps the spin itself: it is the
    // tool's whole function and only happens on an explicit click. A 400ms
    // version of five turns is a blur, not an accommodation.
    const slow = reduceMotion();
    winnerId = null;
    spin = {
      from, to,
      overshoot: slow ? 0 : OVERSHOOT,
      duration: SPIN_MS,
      settle: slow ? 0 : SETTLE_MS,
      slices: pool.length,
      startedAt: Date.now(),
      winnerId: chosen.id,
    };
    renderWinner();          // clears the hub - the name comes back at the end
    broadcast();
    renderControls();
    runSpin(document, spin, { sound: true });
  }

  // Set the rotor's transition. The duration and easing also go on custom
  // properties because the app-wide reduced-motion rule
  // (`* { transition: none !important }`) outranks the inline shorthand -
  // style.css re-reads them there so the spin still animates. See the
  // prefers-reduced-motion block in the Name Wheel CSS.
  function setTransition(rotor, ms, easing) {
    rotor.style.setProperty('--wheel-dur', `${ms}ms`);
    rotor.style.setProperty('--wheel-ease', easing);
    rotor.style.transition = ms ? `transform ${ms}ms ${easing}` : 'none';
  }

  // Animate one document's rotor through the spin. Both the page and the
  // pop-out call this with the same descriptor, so they run the same curve.
  function runSpin(doc, s, { sound = false } = {}) {
    const rotor = doc.getElementById('wheel-rotor');
    const stage = doc.getElementById('wheel-stage');
    if (!rotor) return;
    clearTimers();
    if (stage) stage.dataset.state = 'spinning';

    const target = s.to + s.overshoot;
    setTransition(rotor, 0, 'linear');
    rotor.style.transform = `rotate(${s.from}deg)`;
    void rotor.getBoundingClientRect();                 // commit the start angle
    setTransition(rotor, s.duration, EASE_CSS);
    rotor.style.transform = `rotate(${target}deg)`;

    scheduleTicks(doc, s, target, { sound: sound && !muted });

    // settle: correct the overshoot with a short ease-out, then reveal
    timers.push(setTimeout(() => {
      setTransition(rotor, s.settle, 'cubic-bezier(0.25, 0.1, 0.25, 1)');
      rotor.style.transform = `rotate(${s.to}deg)`;
    }, s.duration + 10));

    timers.push(setTimeout(() => finishSpin(doc, s), s.duration + s.settle + 40));
  }

  function finishSpin(doc, s) {
    clearTimers();
    // Keep the running total and leave the transform exactly where the settle
    // transition put it - no reset, so nothing can snap at the end.
    rotation = s.to;
    winnerId = s.winnerId;
    spin = null;
    if (!isPopout) {
      if (noRepeats) { called.add(winnerId); saveCalled(); }
      // Counts update, but the wheel keeps the winner under the pointer
      // until the next spin - the landing is the whole point.
      rebuildPool({ redraw: false });
      broadcast();
    }
    renderWinner();          // the name appears only now, fully stopped
    renderControls();
  }

  // One tick per slice passing the pointer. The times come from inverting the
  // easing curve, so they spread out exactly as the wheel slows down. The
  // pointer flicks on the same beats (even when muted) so it reads as being
  // knocked by each segment.
  function scheduleTicks(doc, s, target, { sound = false } = {}) {
    const seg = 360 / Math.max(1, s.slices);
    const total = target - s.from;
    const crossings = Math.floor(total / seg);
    const arm = doc.getElementById('wheel-pointer');
    let last = -Infinity;
    for (let k = 1; k <= crossings; k++) {
      const at = ease.timeAt((k * seg) / total) * s.duration;
      if (at - last < 40) continue;                    // don't machine-gun early on
      last = at;
      timers.push(setTimeout(() => {
        if (sound) tick();
        if (arm) {
          arm.classList.remove('flick');
          void arm.getBoundingClientRect();             // restart the animation
          arm.classList.add('flick');
        }
      }, at));
    }
    if (arm) timers.push(setTimeout(() => arm.classList.remove('flick'), s.duration + s.settle + 200));
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  // Only for the resting wheel - a spin owns the transform while it runs.
  function applyRotation(doc) {
    if (spin) return;
    const rotor = doc.getElementById('wheel-rotor');
    if (!rotor) return;
    setTransition(rotor, 0, 'linear');
    rotor.style.transform = `rotate(${rotation.toFixed(2)}deg)`;
  }

  // ---------- data ----------
  async function loadPeriod() {
    roster = []; eligible = []; pool = [];
    called = new Set(); removed = new Set();
    absentIds = new Set(); sitOutIds = new Set();
    winnerId = null;
    if (currentPeriodId) {
      try { roster = await getStudents(currentPeriodId); } catch (err) { showError(err); }
      const ids = new Set(roster.map((s) => s.id));
      try {
        const att = await getAttendance(currentPeriodId, todayKey());
        absentIds = att ? absentIdsOf(att.marks) : readAbsentCache(currentPeriodId);
      } catch { absentIds = readAbsentCache(currentPeriodId); }
      sitOutIds = readSitOutCache(currentPeriodId);
      eligible = roster.filter((s) => !absentIds.has(s.id) && !sitOutIds.has(s.id));
      called  = new Set([...loadCalled(currentPeriodId)].filter((id) => ids.has(id)));
      removed = new Set([...loadIdSet(removedKey(currentPeriodId))].filter((id) => ids.has(id)));
    }
    rebuildPool();
    broadcast();
  }

  // pool = eligible, minus the ones taken off by hand, minus the ones already
  // called (when No repeats is on). The refill compares against what is
  // *available* — a removed student must not keep the wheel from refilling.
  function rebuildPool({ redraw = true } = {}) {
    if (spin) redraw = false;          // never redraw the wheel mid-spin
    const available = eligible.filter((s) => !removed.has(s.id));
    if (noRepeats) {
      if (available.length && available.every((s) => called.has(s.id))) { called = new Set(); saveCalled(); }
      pool = available.filter((s) => !called.has(s.id));
    } else {
      pool = available;
    }
    if (redraw) syncWheel();
    renderLists();
    renderControls();
  }

  // ---------- add / remove ----------
  // All of this is display-only bookkeeping: `removed` lives in localStorage
  // keyed by today's date, so it clears overnight, and nothing here writes
  // attendance or the sit-out cache.
  function removeFromWheel(id) {
    if (!id || spin || removed.has(id)) return;
    removed.add(id); saveRemoved();
    rebuildPool();                     // redraws the wheel straight away
    broadcast();
  }
  function restoreToWheel(id) {
    if (!id || spin) return;
    let changed = false;
    if (removed.delete(id)) { saveRemoved(); changed = true; }
    if (called.delete(id))  { saveCalled();  changed = true; }
    if (!changed) return;
    rebuildPool();
    broadcast();
  }
  // Puts back everyone we took off — absent and sitting-out students are not
  // ours to restore, so they stay off.
  function restoreAll() {
    if (spin) return;
    removed = new Set(); saveRemoved();
    called = new Set();  saveCalled();
    winnerId = null;
    rebuildPool();
    broadcast();
  }

  // Draw whatever is in the pool right now. Called on load, on any explicit
  // change, and at the start of each spin - never the moment a spin lands.
  function syncWheel() {
    if (spin) return;                  // the next startSpin syncs instead
    displayList = pool.map((s) => ({ id: s.id, label: labelFor(s, eligible) }));
    drawWheel(document, displayList);
    applyRotation(document);
    renderWinner();
  }

  // ---------- render ----------
  function renderWinner() {
    const stage = $('wheel-stage');
    const name = winnerId ? nameOf(winnerId) : '';

    // the pop-out shows the name in the hub; the page shows it in the result
    // panel on the right
    const hub = $('wheel-hub-name');
    if (hub) {
      hub.textContent = name;
      hub.dataset.len = name.length > 11 ? 'long' : '';
    }
    const res = $('wheel-result-name');
    const panel = $('wheel-result');
    if (res && panel) {
      // While spinning, keep the old name in place and let the panel animate
      // it out - clearing it immediately would leave nothing to animate.
      if (winnerId) {
        res.textContent = name;
        res.dataset.len = name.length > 13 ? 'long' : '';
        panel.dataset.state = 'picked';
      } else if (spin) {
        panel.dataset.state = 'spinning';
      } else {
        res.textContent = '';
        panel.dataset.state = 'empty';
      }
    }
    if (stage) stage.dataset.state = winnerId ? 'picked' : (spin ? 'spinning' : '');
    const rotor = document.getElementById('wheel-rotor');
    if (rotor) {
      rotor.querySelectorAll('.slice').forEach((s) => {
        s.classList.toggle('won', !!winnerId && s.getAttribute('data-id') === winnerId);
      });
    }
    // marwa's mascot reacts to the landing (collapses in other themes)
    const mascot = $('wheel-mascot');
    if (mascot) mascot.dataset.mood = winnerId ? 'party' : (spin ? 'spin' : 'idle');
  }

  function renderControls() {
    if (isPopout) return;
    // the hub button keeps its label; the state shows as disabled/spinning
    const spinBtn = $('wheel-spin');
    if (spinBtn) {
      spinBtn.disabled = !!spin || pool.length === 0;
      spinBtn.dataset.spinning = spin ? '1' : '';
    }
    const avail = eligible.filter((s) => !removed.has(s.id)).length;
    const left = $('wheel-left');
    if (left) left.textContent = noRepeats ? `${pool.length} left of ${avail}` : `${avail} on the wheel`;
    const rep = $('wheel-norepeat');
    if (rep) rep.setAttribute('aria-checked', String(noRepeats));
    const fn = $('wheel-firstnames');
    if (fn) fn.setAttribute('aria-checked', String(firstNamesOnly));
    const mute = $('wheel-mute');
    if (mute) mute.setAttribute('aria-checked', String(muted));

    // put-back / take-off sit under the name; only the relevant one shows
    const back = $('wheel-back');
    const remove = $('wheel-remove');
    const has = !!winnerId && !spin;
    const isOut = has && (called.has(winnerId) || removed.has(winnerId));
    if (back) back.hidden = !has || !isOut;
    if (remove) remove.hidden = !has || isOut;
  }

  // Two compact chip lists under the controls: who is on the wheel (× takes
  // them off) and who is off it (with the reason, and a put-back for the two
  // reasons this page owns). Absent / sitting out are shown but not
  // restorable here — those belong to Attendance and Create Groups.
  function renderLists() {
    const on = $('wheel-on'), off = $('wheel-off');
    if (!on || !off) return;

    on.innerHTML = pool.map((s) =>
      `<button type="button" class="wheel-chip" data-remove="${s.id}" title="Take ${escapeHtml(s.name)} off the wheel">` +
      `${escapeHtml(labelFor(s, eligible))}<span aria-hidden="true">&times;</span></button>`
    ).join('') || '<span class="wheel-list-none">Nobody on the wheel</span>';

    // reason order: taken off by hand, already called, absent, sitting out
    const reason = (s) => (removed.has(s.id) ? 'removed'
      : (noRepeats && called.has(s.id)) ? 'called'
      : absentIds.has(s.id) ? 'absent'
      : sitOutIds.has(s.id) ? 'sitting out' : null);
    const LABEL = { removed: 'Off', called: 'Called', absent: 'Absent', 'sitting out': 'Sitting out' };
    const RANK  = { removed: 0, called: 1, absent: 2, 'sitting out': 3 };
    const rows = roster
      .map((s) => ({ s, why: reason(s) }))
      .filter((r) => r.why)
      .sort((a, b) => RANK[a.why] - RANK[b.why]);

    off.innerHTML = rows.map(({ s, why }) => {
      const label = escapeHtml(labelFor(s, roster));
      const tag = `<span class="wheel-why" data-why="${why}">${LABEL[why]}</span>`;
      return (why === 'removed' || why === 'called')
        ? `<button type="button" class="wheel-chip back" data-back="${s.id}" title="Put ${escapeHtml(s.name)} back on the wheel">${label}${tag}<span class="wheel-plus" aria-hidden="true">+</span></button>`
        : `<span class="wheel-chip static" title="${escapeHtml(s.name)} — ${LABEL[why].toLowerCase()} today">${label}${tag}</span>`;
    }).join('') || '<span class="wheel-list-none">Everyone is on</span>';

    const onN = $('wheel-on-n'), offN = $('wheel-off-n');
    if (onN) onN.textContent = String(pool.length);
    if (offN) offN.textContent = String(rows.length);
    const restore = $('wheel-restore-all');
    if (restore) restore.hidden = !rows.some((r) => r.why === 'removed' || r.why === 'called');
  }

  // ---------- broadcast ----------
  function broadcast() {
    if (!bc || isPopout) return;
    bc.postMessage({
      type: 'state',
      state: {
        list: displayList,
        rotation, spin, winnerId,
        left: pool.length, total: eligible.length, noRepeats,
        period: (periods.find((p) => p.id === currentPeriodId) || {}).name || '',
      },
    });
  }

  // A few sparkle/glow bits for the result panel (marwa shows them as hearts
  // and stars, jarvis as a single accent flash - see the CSS).
  function buildSparks(doc) {
    const box = doc.getElementById('wheel-sparks');
    if (!box || box.childElementCount) return;
    for (let i = 0; i < 6; i++) {
      const bit = doc.createElement('i');
      bit.className = i % 2 ? 'spark' : 'heart';
      bit.style.setProperty('--i', String(i));
      box.appendChild(bit);
    }
  }

  // ---------- main window ----------
  async function initMain() {
    loadSettings();
    drawWheel(document, []);
    buildDialRing(document);
    buildSparks(document);

    const nav = await navReady;
    periods = nav.periods || [];
    byNumber = nav.byNumber || new Map();
    fillPeriodSelect($('period-select'), periods, getLastPeriodId());
    currentPeriodId = $('period-select').value || null;

    // AUTO: open on (and then follow) the bell's current period
    autoPick(new Date(), nav.today ? nav.today.sched : null, { load: false });
    await loadPeriod();

    $('period-select').addEventListener('change', async () => {
      currentPeriodId = $('period-select').value || null;
      setLastPeriodId(currentPeriodId);
      followBell = false;
      $('btn-auto').setAttribute('aria-pressed', 'false');
      winnerId = null;
      await loadPeriod();
    });
    $('btn-auto').addEventListener('click', () => {
      followBell = !followBell;
      $('btn-auto').setAttribute('aria-pressed', String(followBell));
      if (followBell) autoPick(new Date(), null, { force: true });
    });
    document.addEventListener('teacherpal:tick', (e) => autoPick(e.detail.now, e.detail.sched));

    $('wheel-spin').addEventListener('click', startSpin);
    $('wheel-norepeat').addEventListener('click', () => {
      noRepeats = !noRepeats;
      saveSettings();
      rebuildPool();
      broadcast();
    });
    $('wheel-firstnames').addEventListener('click', () => {
      firstNamesOnly = !firstNamesOnly;
      try { localStorage.setItem(FIRST_KEY, firstNamesOnly ? '1' : '0'); } catch { /* ignore */ }
      rebuildPool();
      broadcast();
    });
    $('wheel-mute').addEventListener('click', () => {
      muted = !muted;
      saveSettings();
      renderControls();
    });
    $('wheel-remove').addEventListener('click', () => removeFromWheel(winnerId));
    $('wheel-back').addEventListener('click', () => restoreToWheel(winnerId));
    $('wheel-restore-all').addEventListener('click', restoreAll);
    $('wheel-on').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (btn) removeFromWheel(btn.getAttribute('data-remove'));
    });
    $('wheel-off').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-back]');
      if (btn) restoreToWheel(btn.getAttribute('data-back'));
    });
    // Clicking a slice takes that student off. Guarded by `spin` so a stray
    // click on the moving wheel (or on the landing) can't drop anyone.
    $('wheel-rotor').addEventListener('click', (e) => {
      if (spin) return;
      const el = e.target.closest('[data-id]');
      if (el) removeFromWheel(el.getAttribute('data-id'));
    });
    $('wheel-popout-btn').addEventListener('click', () => {
      const w = window.open('wheel-popout.html', 'teacherpal-wheel', 'popup=yes,width=820,height=720');
      if (w) w.focus();
      setTimeout(broadcast, 300);
    });

    // Space spins (not while typing or with a dialog open)
    document.addEventListener('keydown', (e) => {
      if (e.key !== ' ' || isTyping(e.target)) return;
      e.preventDefault();
      startSpin();
    });

    if (bc) bc.onmessage = (ev) => { if (ev.data && ev.data.type === 'request-state') broadcast(); };
    renderWinner();
    renderControls();
  }

  // Follow the bell while AUTO is on, the same rule the Attendance screen uses.
  function autoPick(now, sched, { force = false, load = true } = {}) {
    if (spin) return;                  // don't swap the roster out mid-spin
    if ((!followBell && !force) || !byNumber.size) return;
    const s = sched || (typeof navState !== 'undefined' && navState.today ? navState.today.sched : null);
    if (!s) return;
    const n = suggestedPeriod(now, s, (k) => byNumber.has(k));
    const wanted = n != null ? byNumber.get(n) : null;
    if (!wanted || wanted.id === currentPeriodId) return;
    currentPeriodId = wanted.id;
    $('period-select').value = wanted.id;
    setLastPeriodId(wanted.id);
    winnerId = null;
    if (load) loadPeriod();
  }

  // ---------- pop-out ----------
  function initPopout() {
    drawWheel(document, []);
    buildDialRing(document);
    if (bc) {
      bc.onmessage = (ev) => {
        if (!ev.data || ev.data.type !== 'state') return;
        const s = ev.data.state;
        const sig = s.list.map((x) => x.id + ':' + x.label).join('|');
        if (sig !== drawnSig) { displayList = s.list; drawWheel(document, s.list); }
        const label = document.getElementById('wheel-period');
        if (label) { label.textContent = s.period || ''; label.hidden = !s.period; }
        winnerId = s.winnerId;
        rotation = s.rotation;
        if (s.spin) {
          // a spin just started in the main window - run the same curve here
          if (!spin || spin.startedAt !== s.spin.startedAt) {
            spin = s.spin;
            runSpin(document, s.spin);          // no sound: the main window ticks
          }
        } else if (!spin) {
          applyRotation(document);
          renderWinner();
        }
      };
      bc.postMessage({ type: 'request-state' });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (isPopout) initPopout();
    else initMain().catch((err) => { console.error(err); if (typeof showError === 'function') showError(err); });
  });
})();
