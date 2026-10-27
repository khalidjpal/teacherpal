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
// out in Create Groups. With "No repeats" on, picked students drop off.
//
// PICK LISTS: each period has named rotations ("Board work", "Cold call") in
// Supabase (pick_lists + pick_list_picks). The open list's picks ARE `called`:
// a pick stays picked across days and devices until the list is reset, so a
// round no longer refills itself - it says "Round complete" and offers Reset.
// Absent and sitting-out students are skipped, never marked. Without the
// migration the old behaviour stays: `called` is per day, in this browser.
//
// Two themes swap the wheel for a SKIN: halloween a cauldron (cauldron.js -
// names float in the brew as bubbles; a pick boils it, lifts the winner's
// bubble and pops it), marwa a bubble tea cup (boba.js - a pearl per
// student; a pick shakes the cup, swirls the pearls and draws one up the
// straw). Everything above still holds - the winner is drawn first, here -
// only the picture differs: runSpin() hands the spin descriptor to the
// active skin instead of turning the rotor. Both skins have the same shape
// (isOn, build, sync, run, finish, setWinner, setDisabled, DURATION_MS,
// SETTLE_MS).

(function () {
  const isPopout = document.body.classList.contains('wheel-popout');
  const CH = 'teacherpal-wheel';
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel(CH) : null;

  const FIRST_KEY  = 'teacherpal.groups.firstNames';   // shared with Create Groups / Seating
  const MUTE_KEY   = 'teacherpal.wheel.muted';
  const REPEAT_KEY = 'teacherpal.wheel.noRepeats';
  const calledKey  = (pid) => `teacherpal.wheel.called.${pid}`;
  const removedKey = (pid) => `teacherpal.wheel.removed.${pid}`;
  const listKey    = (pid) => `teacherpal.wheel.list.${pid}`;   // the open pick list, per period
  const DEFAULT_LIST = 'Cold call';                              // every period starts with one
  const NEW_LIST = '__new';

  const SPIN_MS = 4500;
  const MIN_TURNS = 5;                // whole rotations before the offset
  const R = 46;                       // slice radius in the 100x100 viewBox
  const RIM_PAD = 5;                  // names stop this far inside the rim, clear of the pointer
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
  let called = new Set();             // picked already: the open list's picks
                                      // (or today's, without pick lists)
  let lists = [];                     // this period's pick_lists rows
  let listId = null;                  // the open one
  let picks = new Map();              // student id -> { at, manual } on the open list
  let listsReady = false;             // false = no pick_lists table: per-day `called`
  let listsWarned = false;
  let loadSeq = 0;                    // drops a stale period load
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
  // The skins (each is a no-op outside its own theme), and the one that is
  // showing in a given document, if any.
  const skins = () => [window.Cauldron, window.Boba, window.Cornucopia].filter(Boolean);
  const skinFor = (doc = document) => skins().find((k) => k.isOn(doc)) || null;
  const eachSkin = (fn) => skins().forEach(fn);
  // the words follow the skin
  const onIt = () => (window.Cauldron && window.Cauldron === skinFor() ? 'in the brew'
    : window.Boba && window.Boba === skinFor() ? 'in the cup'
    : window.Cornucopia && window.Cornucopia === skinFor() ? 'in the horn' : 'on the wheel');
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
  function saveCalled() { if (currentPeriodId && !useLists()) saveIdSet(calledKey(currentPeriodId), called); }

  // ---------- pick lists ----------
  const useLists = () => listsReady && !!listId;
  const openList = () => lists.find((l) => l.id === listId) || null;
  const pickedCount = () => roster.filter((s) => picks.has(s.id)).length;
  function listWriteFailed(err) {
    showError(err);
    reloadPicks();                     // show what was actually saved
  }
  // writes go out one at a time, in order: a quick pick-then-unpick must
  // never reach the server the other way round
  let writes = Promise.resolve();
  const queueWrite = (fn) => { writes = writes.then(fn).catch(listWriteFailed); };
  // `called` changes go through these three, so the list is written as it moves
  function callAdd(id, { manual = false } = {}) {
    if (!useLists()) { called.add(id); saveCalled(); return; }
    const at = new Date().toISOString();
    picks.delete(id);                  // picked again: to the end, with the new date
    picks.set(id, { at, manual });
    called.add(id);
    const lid = listId;
    queueWrite(() => addPickListPick(lid, id, { manual, at }));
  }
  function callDelete(id) {
    if (!called.has(id) && !picks.has(id)) return false;
    called.delete(id);
    if (!useLists()) { saveCalled(); return true; }
    picks.delete(id);
    const lid = listId;
    queueWrite(() => removePickListPick(lid, id));
    return true;
  }
  function callClear() {
    called = new Set();
    if (!useLists()) { saveCalled(); return; }
    picks = new Map();
    const lid = listId;
    queueWrite(() => clearPickListPicks(lid));
  }

  // This period's lists, the remembered one open, and its picks. A period
  // with none gets "Cold call", so a pick always lands on a list.
  async function loadLists(pid, seq) {
    lists = []; listId = null; picks = new Map();
    if (!pid) return;
    try {
      lists = await getPickLists(pid);
      listsReady = true;
    } catch (err) {
      listsReady = false;
      if (!isMissingTableError(err)) showError(err);
      else if (!listsWarned) {
        listsWarned = true;
        setStatus('Run migration-pick-lists.sql in Supabase to keep pick lists. Until then, picks last for today only.', 'info');
      }
      return;
    }
    if (seq !== loadSeq) return;
    if (!lists.length) {
      try { lists = [await createPickList(pid, DEFAULT_LIST, 0)]; }
      catch { lists = await getPickLists(pid).catch(() => []); }   // another tab made it first
    }
    let remembered = null;
    try { remembered = localStorage.getItem(listKey(pid)); } catch { /* ignore */ }
    listId = (lists.find((l) => l.id === remembered) || lists[0] || {}).id || null;
    await loadPicks();
  }
  async function loadPicks() {
    const id = listId;
    const next = new Map();
    if (id) (await getPickListPicks(id)).forEach((r) => next.set(r.student_id, { at: r.picked_at, manual: !!r.manual }));
    if (id === listId) picks = next;
  }
  const pickedOnRoster = () => new Set([...picks.keys()].filter((id) => roster.some((s) => s.id === id)));
  // Picks made on another device (or after a failed write): read them again,
  // and repaint if anything moved. Never mid-spin.
  async function reloadPicks() {
    if (!useLists() || spin) return;
    const before = [...picks.keys()].join();
    await writes;                      // read after our own writes have landed
    try { await loadPicks(); } catch { return; }
    if (spin) return;
    called = pickedOnRoster();
    if ([...picks.keys()].join() !== before) { rebuildPool(); broadcast(); }
    else renderListBar();
  }
  async function switchList(id) {
    if (spin || !id || id === listId) { renderListBar(); return; }
    listId = id;
    try { localStorage.setItem(listKey(currentPeriodId), id); } catch { /* ignore */ }
    picks = new Map();
    try { await loadPicks(); } catch (err) { showError(err); }
    if (id !== listId) return;
    called = pickedOnRoster();
    winnerId = null;
    rebuildPool();
    broadcast();
  }
  const nameTaken = (name, except) => lists.some((l) => l !== except && l.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  async function newList() {
    const name = (prompt('Name the new list (for example "Board work" or "Read aloud"):') || '').trim().slice(0, 40);
    if (!name) { renderListBar(); return; }
    if (nameTaken(name)) {
      setStatus(`This period already has a list called “${name}”.`, 'error');
      renderListBar();
      return;
    }
    try {
      const row = await createPickList(currentPeriodId, name, lists.length);
      lists.push(row);
      await switchList(row.id);
    } catch (err) { showError(err); renderListBar(); }
  }
  async function renameList() {
    const list = openList();
    if (!list) return;
    const name = (prompt('Rename this list:', list.name) || '').trim().slice(0, 40);
    if (!name || name === list.name) return;
    if (nameTaken(name, list)) { setStatus(`This period already has a list called “${name}”.`, 'error'); return; }
    try { Object.assign(list, await renamePickList(list.id, name)); }
    catch (err) { showError(err); }
    renderListBar();
    renderPickDialog();
  }
  async function deleteList() {
    const list = openList();
    if (!list || lists.length < 2) return;
    if (!confirm(`Delete the list “${list.name}”?\n\nWho has been picked on it is forgotten. Your other lists are not affected.`)) return;
    try { await deletePickList(list.id); } catch (err) { showError(err); return; }
    lists = lists.filter((l) => l !== list);
    await switchList(lists[0].id);
    renderPickDialog();
  }
  // Reset = everyone back in. Asks first unless the caller already has.
  function confirmReset() {
    const list = openList();
    const n = pickedCount();
    if (!list || !n) return true;
    return confirm(`Start “${list.name}” over?\n\nThe ${n} student${n === 1 ? '' : 's'} picked so far go back in.`);
  }
  function resetList({ ask = true } = {}) {
    if (spin || (!called.size && !picks.size)) return;
    if (ask && useLists() && !confirmReset()) return;
    callClear();
    winnerId = null;
    rebuildPool();
    broadcast();
    renderPickDialog();
  }
  // Mark someone picked / not picked by hand (called on without the picker).
  // The wheel catches up when the dialog closes.
  function togglePicked(id) {
    if (spin || !roster.some((s) => s.id === id)) return;
    if (picks.has(id)) callDelete(id);
    else callAdd(id, { manual: true });
    renderListBar();
    renderPickDialog();
  }
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
  // marwa paints from its own five pastels (--wheel-p0 ... p4: pink, lavender,
  // mint, peach, butter) in order; every slice carries both classes so a live
  // theme switch repaints without a redraw. A count that leaves the last
  // slice on the first one's colour takes a colour clear of both neighbours.
  const PASTELS = 5;
  function pastelIndex(i, n) {
    let p = i % PASTELS;
    if (n > 1 && i === n - 1 && p === 0) p = 2;
    return p;
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
    eachSkin((k) => k.sync(doc, list));                       // the brew's bubbles / the capsules
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
      // r0-r7 is the graduated ramp; p0-p4 is marwa's pastel cycle.
      shape.setAttribute('class', `slice r${rampIndex(i, n)} p${pastelIndex(i, n)}`);
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
      // names run from RIM_PAD inside the rim (clear of the pointer tip) to
      // just outside the hub
      const gap = isPopout ? R - 26 : R - 20;
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
        text.setAttribute('x', String(50 + R - RIM_PAD));
        text.setAttribute('text-anchor', 'end');
        text.setAttribute('transform', `rotate(${mid} 50 50)`);
      } else {
        text.setAttribute('x', String(50 - R + RIM_PAD));
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
        const maxLen = gap;                          // same rim-to-hub gap as the fit
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
    const busySkin = skinFor();
    if (busySkin && busySkin.busy && busySkin.busy(document)) return;   // the jar pouring pearls back
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
    // A skin's timeline (the cauldron's boil and pop) replaces the spin's. The rotation is still worked out,
    // so a window showing the wheel instead still lands on the same name.
    const skin = skinFor();
    winnerId = null;
    spin = {
      from, to,
      overshoot: (slow || skin) ? 0 : OVERSHOOT,
      duration: skin ? skin.DURATION_MS : SPIN_MS,
      settle: skin ? skin.SETTLE_MS : (slow ? 0 : SETTLE_MS),
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
    const buddy = doc.getElementById('wheel-mascot');
    if (buddy) buddy.dataset.mood = 'spin';           // the pop-out never calls renderWinner mid-spin
    const skin = skinFor(doc);
    if (skin) {
      // a skin plays the pick (the cauldron) - then the same finish
      skin.run(doc, s, { sound: sound && !muted });
      timers.push(setTimeout(() => finishSpin(doc, s), s.duration + s.settle + 40));
      return;
    }

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
    const skin = skinFor(doc);
    if (skin) skin.finish(doc, s, { respawn: !noRepeats });
    if (!isPopout) {
      // a saved list records every pick (its history), No repeats or not
      if (useLists() || noRepeats) callAdd(winnerId);
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
    const seq = ++loadSeq;
    const pid = currentPeriodId;
    roster = []; eligible = []; pool = [];
    called = new Set(); removed = new Set();
    absentIds = new Set(); sitOutIds = new Set();
    winnerId = null;
    if (currentPeriodId) {
      try { roster = await getStudents(currentPeriodId); } catch (err) { showError(err); }
      await loadLists(pid, seq).catch(showError);
      if (seq !== loadSeq) return;
      const ids = new Set(roster.map((s) => s.id));
      try {
        const att = await getAttendance(currentPeriodId, todayKey());
        absentIds = att ? absentIdsOf(att.marks) : readAbsentCache(currentPeriodId);
      } catch { absentIds = readAbsentCache(currentPeriodId); }
      sitOutIds = readSitOutCache(currentPeriodId);
      eligible = roster.filter((s) => !absentIds.has(s.id) && !sitOutIds.has(s.id));
      called  = useLists() ? pickedOnRoster()
        : new Set([...loadCalled(currentPeriodId)].filter((id) => ids.has(id)));
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
      // A finished round refills itself - unless the skin holds it (the
      // bubble tea's jar stays full and celebrates until it's poured back).
      // A saved list never refills on its own: "Round complete" offers Reset.
      const holds = useLists() || (!isPopout && skinFor() && skinFor().HOLDS_ROUND);
      if (!holds && available.length && available.every((s) => called.has(s.id))) { called = new Set(); saveCalled(); }
      pool = available.filter((s) => !called.has(s.id));
    } else {
      pool = available;
    }
    if (redraw) syncWheel();
    renderEditButton();
    renderControls();
    renderPicked();
    renderListBar();
  }
  // Who's been called this round, in pick order, and how many are in the
  // round, for a skin that shows them (the bubble tea's jar); null with No
  // repeats off.
  function renderPicked() {
    const list = noRepeats
      ? [...called].map((id) => eligible.find((s) => s.id === id)).filter(Boolean)
        .map((s) => ({ id: s.id, label: labelFor(s, eligible) }))
      : null;
    const total = eligible.filter((s) => !removed.has(s.id)).length;
    eachSkin((k) => k.setPicked && k.setPicked(document, list, total));
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
    if (callDelete(id)) changed = true;
    if (!changed) return;
    rebuildPool();
    broadcast();
  }
  // ---- modal edits: change the sets, repaint the modal, and leave the wheel
  // alone until it closes (the dialog covers it anyway). -------------------
  function toggleOnWheel(id) {
    const s = roster.find((x) => x.id === id);
    if (!s || locked(s)) return;
    if (onWheel(id)) {
      removed.add(id); saveRemoved();
    } else {
      removed.delete(id); saveRemoved();
      callDelete(id);
    }
    renderRosterDialog();
  }
  function allOnWheel(on) {
    if (on) {
      removed = new Set(); saveRemoved();
      // a saved list keeps its picks: only Reset starts it over
      if (!useLists()) { called = new Set(); saveCalled(); }
      winnerId = null;
    } else {
      // everyone eligible goes off; absent / sitting out are already off
      eligible.forEach((s) => removed.add(s.id));
      saveRemoved();
    }
    renderRosterDialog();
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
    // the skins show the name too (above the cauldron / out of the capsule)
    eachSkin((k) => k.setWinner(document, name, winnerId ? 'picked' : (spin ? 'boiling' : '')));
  }

  function renderControls() {
    if (isPopout) return;
    // the hub button keeps its label; the state shows as disabled/spinning
    const spinBtn = $('wheel-spin');
    if (spinBtn) {
      spinBtn.disabled = !!spin || pool.length === 0;
      spinBtn.dataset.spinning = spin ? '1' : '';
    }
    eachSkin((k) => k.setDisabled(document, !!spin || pool.length === 0));
    const avail = eligible.filter((s) => !removed.has(s.id)).length;
    const left = $('wheel-left');
    if (left) left.textContent = noRepeats ? `${pool.length} left of ${avail}` : `${avail} ${onIt()}`;
    const sel = $('pick-list-select');
    if (sel) sel.disabled = !!spin;
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

  // ---------- wheel roster (the Edit wheel modal) ----------
  // Who is actually on the wheel right now. `pool` is the same set, but this
  // works per-id while the modal is open and the pool hasn't been rebuilt.
  const onWheel = (id) => eligible.some((s) => s.id === id)
    && !removed.has(id) && !(noRepeats && called.has(id));
  // Why someone isn't on it (null when they are)
  const offReason = (s) => (absentIds.has(s.id) ? 'absent'
    : sitOutIds.has(s.id) ? 'sitting out'
    : removed.has(s.id) ? 'off'
    : (noRepeats && called.has(s.id)) ? 'called' : null);
  const REASON_LABEL = { absent: 'Absent', 'sitting out': 'Sitting out', called: 'Picked', off: '' };
  // Absent / sitting out aren't ours to undo — Attendance and Create Groups
  // own those, so their chips are locked.
  const locked = (s) => absentIds.has(s.id) || sitOutIds.has(s.id);

  function renderRosterDialog() {
    const list = $('wheel-roster-list');
    if (!list) return;
    const on = roster.filter((s) => onWheel(s.id)).length;
    const count = $('wheel-roster-count');
    if (count) count.textContent = `${on} of ${roster.length} ${onIt()}`;
    list.innerHTML = roster.map((s) => {
      const is = onWheel(s.id);
      const why = is ? null : offReason(s);
      const tag = why && REASON_LABEL[why] ? `<span class="wr-why" data-why="${why}">${REASON_LABEL[why]}</span>` : '';
      const lock = locked(s);
      return `<button type="button" class="wr-chip" data-id="${s.id}" aria-pressed="${is}"${lock ? ' disabled' : ''}
        title="${escapeHtml(s.name)}${lock ? ` — ${REASON_LABEL[why].toLowerCase()} today` : (is ? ` — ${onIt()}` : ' — left out')}">
        <span class="wr-name">${escapeHtml(s.name)}</span>${tag}</button>`;
    }).join('') || '<p class="hint">No students in this period.</p>';
  }

  // The button by the controls carries the count.
  function renderEditButton() {
    const n = $('wheel-edit-n');
    if (!n) return;
    n.textContent = `${pool.length} on`;
    const btn = $('wheel-edit');
    if (btn) btn.title = `${pool.length} ${onIt()} — click to choose who's in`;
  }

  // ---------- pick list bar + the "Who's picked" dialog ----------
  // "Board work · 12 of 28 picked", or Round complete with Reset lit up once
  // everyone here has been picked.
  function renderListBar() {
    const bar = $('pick-list-bar');
    if (!bar || isPopout) return;
    bar.hidden = !useLists();
    if (!useLists()) return;
    const sel = $('pick-list-select');
    sel.innerHTML = lists.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')
      + `<option value="${NEW_LIST}">+ New list…</option>`;
    sel.value = listId;
    const list = openList();
    const n = pickedCount();
    const available = eligible.filter((s) => !removed.has(s.id));
    const done = available.length > 0 && available.every((s) => picks.has(s.id));
    const away = roster.filter((s) => !picks.has(s.id) && !available.includes(s)).length;
    bar.dataset.done = done ? '1' : '';
    $('pick-list-line').innerHTML = done
      ? `<b>Round complete</b> · everyone here has been picked${away ? ` (${away} not here still to go)` : ''}`
      : `${escapeHtml(list ? list.name : '')} · <b>${n}</b> of ${roster.length} picked`;
    const reset = $('pick-list-reset');
    reset.classList.toggle('primary', done);
    reset.disabled = !n;
    reset.title = list ? `Start “${list.name}” over` : '';
    $('pick-list-view').disabled = !roster.length;
  }

  function fmtPicked(iso) {
    const d = new Date(iso), now = new Date();
    const day = d.toDateString() === now.toDateString() ? 'Today'
      : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
    return `${day} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  // Picked (in the order they were called, with the date) and still to go.
  // Tap a name to move it across.
  function renderPickDialog() {
    const dlg = $('pick-list-dialog');
    if (!dlg || !dlg.open) return;
    const list = openList();
    $('pl-title').textContent = list ? list.name : '';
    const picked = [...picks.entries()]
      .map(([id, p]) => ({ s: roster.find((x) => x.id === id), p }))
      .filter((x) => x.s);
    const left = roster.filter((s) => !picks.has(s.id));
    $('pl-count').textContent = `${picked.length} of ${roster.length} picked`;
    $('pl-n-picked').textContent = picked.length;
    $('pl-n-left').textContent = left.length;
    $('pl-picked').innerHTML = picked.map(({ s, p }) => `<li><button type="button" class="pl-item" data-id="${s.id}" title="Put ${escapeHtml(s.name)} back in">
        <span class="pl-who">${escapeHtml(s.name)}</span>
        <span class="pl-when">${fmtPicked(p.at)}${p.manual ? ' · by hand' : ''}</span>
        <span class="pl-act">Unpick</span></button></li>`).join('')
      || '<li class="pl-none">Nobody yet</li>';
    $('pl-left').innerHTML = left.map((s) => {
      const why = absentIds.has(s.id) ? 'Absent today' : sitOutIds.has(s.id) ? 'Sitting out' : '';
      return `<li><button type="button" class="pl-item" data-id="${s.id}" title="Mark ${escapeHtml(s.name)} as picked">
        <span class="pl-who">${escapeHtml(s.name)}</span>
        <span class="pl-when">${why}</span>
        <span class="pl-act">Mark picked</span></button></li>`;
    }).join('') || '<li class="pl-none">Everyone has been picked</li>';
    const del = $('pl-delete');
    del.disabled = lists.length < 2;
    del.title = lists.length < 2 ? 'A period keeps at least one list' : 'Delete this list';
    $('pl-reset').disabled = !picked.length;
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

  // marwa's bunny beside the wheel. One inline SVG so its parts can move:
  // the pose is pure CSS off data-mood on #wheel-mascot (idle: calm, ears
  // relaxed; spin: ears perk, eyes go wide; party: happy eyes, a bounce and a
  // burst of hearts). Built in every theme, shown only in marwa.
  const BUDDY_SVG = `<svg class="wb-svg" viewBox="0 0 80 96" aria-hidden="true">
    <ellipse class="wb-shadow" cx="40" cy="92" rx="21" ry="3.2"/>
    <g class="wb-hop"><g class="wb-breathe">
      <g class="wb-ear wb-ear-l"><ellipse class="wb-fur" cx="29" cy="19" rx="6.6" ry="15.5"/><ellipse class="wb-inner" cx="29" cy="20.5" rx="2.8" ry="10"/></g>
      <g class="wb-ear wb-ear-r"><ellipse class="wb-fur" cx="51" cy="19" rx="6.6" ry="15.5"/><ellipse class="wb-inner" cx="51" cy="20.5" rx="2.8" ry="10"/></g>
      <ellipse class="wb-fur" cx="40" cy="74" rx="20.5" ry="16.5"/>
      <ellipse class="wb-belly" cx="40" cy="77.5" rx="11.5" ry="9.5"/>
      <ellipse class="wb-fur" cx="29.5" cy="89" rx="7.2" ry="3.9"/>
      <ellipse class="wb-fur" cx="50.5" cy="89" rx="7.2" ry="3.9"/>
      <circle class="wb-fur" cx="40" cy="48" r="20"/>
      <g class="wb-bow"><path d="M40 30.5 L33.5 26.5 L33.5 34.5 Z"/><path d="M40 30.5 L46.5 26.5 L46.5 34.5 Z"/><circle cx="40" cy="30.5" r="2.3"/></g>
      <circle class="wb-blush" cx="26.5" cy="54.5" r="3.3"/>
      <circle class="wb-blush" cx="53.5" cy="54.5" r="3.3"/>
      <g class="wb-eyes wb-eyes-calm">
        <ellipse class="wb-ink" cx="32.5" cy="48" rx="2.5" ry="3.1"/><ellipse class="wb-ink" cx="47.5" cy="48" rx="2.5" ry="3.1"/>
        <circle class="wb-shine" cx="33.4" cy="46.8" r="0.9"/><circle class="wb-shine" cx="48.4" cy="46.8" r="0.9"/>
      </g>
      <g class="wb-eyes wb-eyes-wide">
        <circle class="wb-ink" cx="32.5" cy="47.5" r="4.3"/><circle class="wb-ink" cx="47.5" cy="47.5" r="4.3"/>
        <circle class="wb-shine" cx="34" cy="45.8" r="1.6"/><circle class="wb-shine" cx="49" cy="45.8" r="1.6"/>
        <circle class="wb-shine" cx="31.3" cy="49.3" r="0.7"/><circle class="wb-shine" cx="46.3" cy="49.3" r="0.7"/>
        <path class="wb-line" d="M28.5 40.6 Q32.5 38.6 36 40.4 M44 40.4 Q47.5 38.6 51.5 40.6"/>
      </g>
      <g class="wb-eyes wb-eyes-happy">
        <path class="wb-line wb-thick" d="M29 49.2 Q32.5 44.4 36 49.2 M44 49.2 Q47.5 44.4 51 49.2"/>
      </g>
      <ellipse class="wb-nose" cx="40" cy="53.2" rx="1.6" ry="1.1"/>
      <path class="wb-line wb-mouth wb-mouth-calm" d="M36.6 55.6 Q38.3 57.6 40 55.9 Q41.7 57.6 43.4 55.6"/>
      <ellipse class="wb-ink wb-mouth wb-mouth-wow" cx="40" cy="58" rx="1.9" ry="2.4"/>
      <g class="wb-mouth wb-mouth-happy"><path class="wb-ink" d="M35 55.6 Q40 63.4 45 55.6 Z"/><path class="wb-tongue" d="M37.4 59.4 Q40 57.6 42.6 59.4 Q40 61.4 37.4 59.4 Z"/></g>
      <ellipse class="wb-fur" cx="31" cy="68" rx="5" ry="4"/>
      <ellipse class="wb-fur" cx="49" cy="68" rx="5" ry="4"/>
    </g></g>
  </svg>
  <span class="wb-burst">${'<i></i>'.repeat(8)}</span>`;
  function buildBuddy(doc) {
    const box = doc.getElementById('wheel-mascot');
    if (!box || box.childElementCount) return;
    box.innerHTML = BUDDY_SVG;
    box.querySelectorAll('.wb-burst i').forEach((bit, i) => bit.style.setProperty('--i', String(i)));
  }

  // ---------- main window ----------
  async function initMain() {
    loadSettings();
    eachSkin((k) => k.build(document));
    drawWheel(document, []);
    buildDialRing(document);
    buildSparks(document);
    buildBuddy(document);

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
    // halloween: the whole cauldron is the button (Space works too, below)
    const cauldron = $('cauldron');
    if (cauldron) {
      cauldron.setAttribute('role', 'button');
      cauldron.setAttribute('tabindex', '0');
      cauldron.setAttribute('aria-label', 'Stir the cauldron to pick a student');
      cauldron.addEventListener('click', startSpin);
      cauldron.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startSpin(); } });
    }
    // thanksgiving: the whole cornucopia scene is the button
    const horn = $('horn');
    if (horn) {
      horn.setAttribute('role', 'button');
      horn.setAttribute('tabindex', '0');
      horn.setAttribute('aria-label', 'Tip the cornucopia to pick a student');
      horn.addEventListener('click', startSpin);
      horn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === horn) { e.preventDefault(); startSpin(); } });
    }
    // marwa: the whole bubble tea cup (its hit area is #boba-straw, sized
    // over the cup in the CSS)
    const straw = $('boba-straw');
    if (straw) straw.addEventListener('click', startSpin);
    // The jar's / basket's "Pour them back" asks first on a saved list (the
    // skin cancels the pour on a no)...
    document.addEventListener('teacherpal:wheel-reset-request', (e) => {
      if (spin || (useLists() && !confirmReset())) e.preventDefault();
    });
    // ...then everyone called goes back in
    document.addEventListener('teacherpal:wheel-reset', () => resetList({ ask: false }));

    // ---- pick lists ----
    $('pick-list-select').addEventListener('change', (e) => {
      if (e.target.value === NEW_LIST) newList();
      else switchList(e.target.value);
    });
    $('pick-list-reset').addEventListener('click', () => resetList());
    const pickDialog = $('pick-list-dialog');
    $('pick-list-view').addEventListener('click', () => {
      if (spin || !useLists()) return;
      pickDialog.showModal();
      renderPickDialog();
    });
    pickDialog.addEventListener('click', (e) => {
      const item = e.target.closest('.pl-item');
      if (item) togglePicked(item.dataset.id);
    });
    $('pl-rename').addEventListener('click', renameList);
    $('pl-delete').addEventListener('click', deleteList);
    $('pl-reset').addEventListener('click', () => resetList());
    // the wheel catches up on Done and on close (Esc), like Edit who's in
    const afterPickEdit = () => { if (!spin) { rebuildPool(); broadcast(); } };
    $('pl-done').addEventListener('click', () => { pickDialog.close(); afterPickEdit(); });
    pickDialog.addEventListener('close', afterPickEdit);
    // picks made on another device show up when you come back to this tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) reloadPicks();
    });
    // a finished round is held only while the jar is on screen: leaving
    // marwa refills it like any other round
    document.addEventListener('teacherpal:theme', () => { if (!spin) { rebuildPool(); broadcast(); } });
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

    // ---- Edit wheel modal ----
    const rosterDialog = $('wheel-roster-dialog');
    $('wheel-edit').addEventListener('click', () => {
      if (spin) return;
      if (!roster.length) { setStatus('Pick a period with students first.', 'info'); return; }
      renderRosterDialog();
      rosterDialog.showModal();
    });
    $('wheel-roster-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.wr-chip');
      if (btn && !btn.disabled) toggleOnWheel(btn.dataset.id);
    });
    $('wheel-all-on').addEventListener('click', () => allOnWheel(true));
    $('wheel-all-off').addEventListener('click', () => allOnWheel(false));
    // The wheel catches up with the edits on close. Wired to both the button
    // and the dialog's `close` (Esc) — running it twice is harmless, missing
    // it would leave the wheel showing the old line-up.
    const afterRosterEdit = () => { rebuildPool(); broadcast(); };
    $('wheel-roster-done').addEventListener('click', () => { rosterDialog.close(); afterRosterEdit(); });
    rosterDialog.addEventListener('close', afterRosterEdit);
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
    // Mini window (Chrome's Document Picture-in-Picture): an always-on-top
    // window holding the same read-only view as the full screen window, in an
    // iframe - it is fed over the same BroadcastChannel, so it needs nothing
    // from here but a broadcast once it has loaded.
    const pipBtn = $('wheel-pip');
    if (pipBtn && 'documentPictureInPicture' in window) {
      pipBtn.hidden = false;
      pipBtn.addEventListener('click', async () => {
        let pip;
        try { pip = await window.documentPictureInPicture.requestWindow({ width: 420, height: 420 }); } catch { return; }
        const d = pip.document;
        d.body.style.cssText = 'margin:0;height:100vh;overflow:hidden;background:#000';
        const frame = d.createElement('iframe');
        frame.src = new URL('wheel-popout.html', location.href).href;
        frame.title = 'Name Wheel';
        frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
        frame.addEventListener('load', () => setTimeout(broadcast, 100));
        d.body.appendChild(frame);
      });
    }

    // Space spins (not while typing or with a dialog open)
    document.addEventListener('keydown', (e) => {
      if (e.key !== ' ' || isTyping(e.target) || document.querySelector('dialog[open]')) return;
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
    eachSkin((k) => k.build(document));
    drawWheel(document, []);
    buildDialRing(document);
    buildBuddy(document);
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
        noRepeats = !!s.noRepeats;           // the cauldron re-floats a popped name only without it
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
