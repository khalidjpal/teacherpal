// attendance.js — the attendance view: the read-only seating chart (or roster
// tiles) with click-to-cycle Present → Absent → Tardy, the counts, absent /
// tardy lists, Copy list, Reset and the date control, autosaved per period
// per day. Used by attendance.html: initAttendance({ mode: 'full' }).
// (A 'compact' mode once fed the hub; the hub is a launcher now, so only
// 'full' is used — the mode switch is kept minimal and harmless.)
// Needs shared.js (data), schedule.js + nav.js (bell + navReady), room.js.
// No Supabase calls of its own — everything goes through shared.js helpers.

function initAttendance({ mount = '#attendance', mode = 'full' } = {}) {
  const root = document.querySelector(mount);
  if (!root) return;
  root.dataset.mode = mode;
  const full = mode === 'full';
  const $ = (id) => root.querySelector(`#${id}`);
  const pad = (n) => String(n).padStart(2, '0');
  const TICKS = '<span class="tick tl" aria-hidden="true"></span><span class="tick tr" aria-hidden="true"></span><span class="tick bl" aria-hidden="true"></span><span class="tick br" aria-hidden="true"></span>';

  // ---------- markup ----------
  root.innerHTML = `
    <section class="hud-box att-chart" aria-label="Attendance chart" style="--i:0">
      ${TICKS}
      <div class="dash-head">
        <label class="dash-field"><span class="hud-key">PERIOD</span><select id="period-select" aria-label="Period"></select></label>
        <button type="button" class="hud-chip" id="btn-follow" aria-pressed="true" title="Follow the bell schedule — the period happening now is selected automatically">AUTO</button>
        ${full ? `<label class="dash-field"><span class="hud-key">DATE</span><input type="date" id="att-date" aria-label="Attendance date"></label>
        <button type="button" class="hud-chip" id="btn-today" hidden>TODAY</button>` : ''}
        <span class="spacer"></span>
        <span class="hud-stat exp-only" id="exp-counts"></span>
        <span class="hud-stat"><span class="hud-key" id="chart-kind">CHART</span><span class="hud-val hud-quiet" id="chart-note"></span></span>
        <button type="button" class="hud-chip" id="btn-first" aria-pressed="true" title="Show first names only on seats">FIRST NAMES</button>
        ${full
          ? `<button type="button" class="hud-chip" data-fullscreen aria-pressed="false" title="Full screen for taking attendance (F · Esc to return)"><span class="when-off">EXPAND</span><span class="when-on">EXIT</span></button>`
          : `<a class="hud-chip hud-chip-accent" href="attendance.html" title="Open the full Attendance screen">OPEN ATTENDANCE →</a>`}
      </div>
      <div class="hub-chart" id="chart"><div class="hub-room" id="room"></div></div>
      <div class="att-tiles" id="tiles" hidden></div>
      <div class="unseated" id="unseated" hidden>
        <span class="hud-key">NOT SEATED</span>
        <div class="att-tiles small" id="unseated-tiles"></div>
      </div>
      <div class="chart-empty" id="chart-empty" hidden></div>
      <div class="dash-legend">
        <span class="lg lg-present">PRESENT</span>
        <span class="lg lg-absent">ABSENT · A</span>
        <span class="lg lg-tardy">TARDY · T</span>
        <span class="lg-hint">Click a name to cycle Present → Absent → Tardy${full ? ' · F full screen' : ''}</span>
      </div>
    </section>

    <aside class="att-side">
      <section class="hud-box att-card" aria-label="Attendance summary" style="--i:1">
        ${TICKS}
        <div class="att-counts" id="att-counts" aria-live="polite">—</div>
        <div class="att-actions">
          ${full
            ? `<button type="button" class="small" id="btn-copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy list</button>
               <button type="button" class="small ghost" id="btn-reset">Reset attendance</button>`
            : `<a class="small btn" href="attendance.html">Take attendance →</a>`}
          <span class="spacer"></span>
          <span class="save-state hud-mono" id="save-state" aria-live="polite"></span>
        </div>
      </section>
      <section class="hud-box att-lists-box" aria-label="Absent and tardy students" style="--i:2">
        ${TICKS}
        <div class="att-lists">
          <div class="att-list">
            <h3><span class="hud-key">ABSENT</span><span class="hud-val" id="absent-n">0</span></h3>
            <ul id="absent-list" class="att-names"></ul>
          </div>
          <div class="att-list">
            <h3><span class="hud-key">TARDY</span><span class="hud-val" id="tardy-n">0</span></h3>
            <ul id="tardy-list" class="att-names"></ul>
          </div>
        </div>
      </section>
    </aside>`;

  // ---------- state ----------
  let periods = [];
  let byNumber = new Map();        // bell period number → period row
  let students = [];
  let layout = null;               // shared room layout (or null if none)
  let assignments = {};            // seatId → studentId for the current period
  let marks = {};                  // studentId → { status: 'absent'|'tardy', at }
  let currentPeriodId = null;
  let viewDate = todayKey();       // the attendance day being shown (compact mode is always today)
  let followBell = true;           // AUTO: the select tracks the bell schedule
  let saveTimer = null, loadSeq = 0;

  const studentById = (id) => students.find((s) => s.id === id);
  const isToday = () => viewDate === todayKey();
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // Seat labels. Default = first name only (so it fits a small seat); two
  // students sharing a first name get a growing last-name prefix ("Maria G.",
  // "Brandon Ce." / "Brandon Cl."). Off = "First L." for everyone.
  const FIRST_KEY = full ? 'teacherpal.hub.firstNames' : 'teacherpal.hub.firstNames.compact';   // compact defaults to first names
  let firstNames = true;
  try { firstNames = localStorage.getItem(FIRST_KEY) !== '0'; } catch { /* ignore */ }
  const firstName = (n) => n.trim().split(/\s+/)[0] || n;
  const lastName = (n) => { const p = n.trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : ''; };
  function shortName(s) {
    const first = firstName(s.name), last = lastName(s.name);
    if (!firstNames) return last ? `${first} ${last[0]}.` : first;
    const twins = students.filter((o) => firstName(o.name).toLocaleLowerCase() === first.toLocaleLowerCase());
    if (twins.length < 2 || !last) return first;
    for (let k = 1; k <= last.length; k++) {
      const mine = last.slice(0, k).toLocaleLowerCase();
      if (twins.every((o) => o === s || lastName(o.name).slice(0, k).toLocaleLowerCase() !== mine)) return `${first} ${last.slice(0, k)}.`;
    }
    return s.name;
  }
  $('btn-first').setAttribute('aria-pressed', String(firstNames));
  $('btn-first').addEventListener('click', () => {
    firstNames = !firstNames;
    $('btn-first').setAttribute('aria-pressed', String(firstNames));
    try { localStorage.setItem(FIRST_KEY, firstNames ? '1' : '0'); } catch { /* ignore */ }
    renderChart();
  });

  // full screen: the chart box changes size — re-fit (twice: once after the class change, once after the browser resize)
  document.addEventListener('teacherpal:present', () => { renderSummary(); requestAnimationFrame(fitRoom); setTimeout(fitRoom, 350); });

  // ---------- period selection ----------
  function selectPeriod(id, { manual = false } = {}) {
    if (manual) { followBell = false; $('btn-follow').setAttribute('aria-pressed', 'false'); }
    if (id === currentPeriodId) { if (!id) renderAll(); return; }
    currentPeriodId = id;
    $('period-select').value = id || '';
    setLastPeriodId(id);
    loadPeriod();
  }
  // AUTO: whenever the bell moves to another period the teacher has a
  // roster for, switch to it (today only — a past day stays put).
  function followTheBell(d, sched) {
    if (!followBell || !isToday() || !byNumber.size) return;
    const n = suggestedPeriod(d, sched, (k) => byNumber.has(k));
    if (n !== null && byNumber.get(n).id !== currentPeriodId) selectPeriod(byNumber.get(n).id);
  }
  document.addEventListener('teacherpal:tick', (e) => followTheBell(e.detail.now, e.detail.sched));
  $('period-select').addEventListener('change', (e) => selectPeriod(e.target.value, { manual: true }));
  $('btn-follow').addEventListener('click', () => {
    followBell = !followBell;
    $('btn-follow').setAttribute('aria-pressed', String(followBell));
    if (followBell) { const d = new Date(); followTheBell(d, resolveSchedule(d, navState.overrides)); }
  });

  // ---------- date control (full mode only) ----------
  if (full) {
    $('att-date').value = viewDate;
    $('att-date').addEventListener('change', (e) => {
      if (!e.target.value) return;
      viewDate = e.target.value;
      $('btn-today').hidden = isToday();
      loadPeriod();
    });
    $('btn-today').addEventListener('click', () => {
      viewDate = todayKey();
      $('att-date').value = viewDate;
      $('btn-today').hidden = true;
      loadPeriod();
    });
  }

  // ---------- load one period + day ----------
  async function loadPeriod() {
    const seq = ++loadSeq;
    students = []; assignments = {}; marks = {};
    setSaveState('');
    // the hub's period strip and lesson panel follow the attendance view
    document.dispatchEvent(new CustomEvent('teacherpal:period', { detail: { periodId: currentPeriodId, date: viewDate } }));
    if (!currentPeriodId) { renderAll(); return; }
    try {
      const [st, seats, att] = await Promise.all([
        getStudents(currentPeriodId),
        getSeatAssignments(currentPeriodId).catch(() => ({})),
        getAttendance(currentPeriodId, viewDate).catch((err) => {
          setStatus(`Attendance table unavailable — run migration-attendance.sql in the Supabase SQL editor. (${err.message})`, 'error');
          return null;
        }),
      ]);
      if (seq !== loadSeq) return;                 // a newer load won
      students = st;
      assignments = seats || {};
      const ids = new Set(students.map((s) => s.id));
      marks = {};
      for (const [id, m] of Object.entries((att && att.marks) || {})) if (ids.has(id) && m && m.status) marks[id] = m;
      if (isToday()) writeAbsentCache(currentPeriodId, absentIdsOf(marks));
      setSaveState(att ? 'saved' : '');
    } catch (err) { showError(err); }
    renderAll();
  }

  function renderAll() { renderChart(); renderSummary(); }

  // =====================================================================
  // Chart: the room with names in seats (read-only), or name tiles
  // =====================================================================
  const room = $('room'), chart = $('chart');
  const seatedIds = () => new Set(Object.values(assignments).filter((id) => studentById(id)));

  function renderChart() {
    const seated = seatedIds();
    const hasChart = layout && layout.pieces.length > 0 && seated.size > 0;
    const empty = $('chart-empty');
    chart.hidden = !hasChart;
    $('tiles').hidden = hasChart || students.length === 0;
    $('unseated').hidden = true;
    empty.hidden = true;

    if (!currentPeriodId) {
      empty.hidden = false; chart.hidden = true; $('tiles').hidden = true;
      empty.innerHTML = periods.length ? '<p>Pick a period.</p>' : '<p>No periods yet.</p><a class="hud-chip" href="roster.html">Set up rosters</a>';
      $('chart-kind').textContent = 'CHART'; $('chart-note').textContent = '';
      return;
    }
    if (students.length === 0) {
      empty.hidden = false; chart.hidden = true;
      empty.innerHTML = '<p>No students in this period.</p><a class="hud-chip" href="roster.html">Add students</a>';
      $('chart-kind').textContent = 'CHART'; $('chart-note').textContent = '';
      return;
    }

    if (hasChart) {
      $('chart-kind').textContent = 'SEATING';
      $('chart-note').textContent = `${seated.size}/${students.length} SEATED`;
      renderRoom();
      const unseated = students.filter((s) => !seated.has(s.id));
      if (unseated.length) {
        $('unseated').hidden = false;
        $('unseated-tiles').innerHTML = unseated.map(tileHtml).join('');
      }
    } else {
      $('chart-kind').textContent = 'ROSTER';
      $('chart-note').innerHTML = `NO SEATING CHART · <a href="seating.html">BUILD ONE</a>`;
      $('tiles').innerHTML = students.map(tileHtml).join('');
    }
  }

  function tileHtml(s) {
    const m = marks[s.id];
    return `<button type="button" class="att-tile" data-student="${s.id}" data-status="${m ? m.status : ''}" title="${escapeHtml(s.name)}">${escapeHtml(shortName(s))}</button>`;
  }

  // Compact chart labels: one line, sized to fill the seat — LABEL_PX in room
  // units (so it scales with the zoom), shrunk only for names that don't fit,
  // never below LABEL_MIN. The full-size screen keeps the CSS sizes.
  const LABEL_PX = 18, LABEL_MIN = 13;
  const measureCtx = document.createElement('canvas').getContext('2d');
  function fitLabels() {
    if (full) return;
    const face = getComputedStyle(document.body).fontFamily || 'sans-serif';
    measureCtx.font = `700 ${LABEL_PX}px ${face}`;
    room.querySelectorAll('.seat .seat-label').forEach((lb) => {
      const text = lb.textContent.trim();
      if (!text) return;
      const avail = parseFloat(lb.style.width) - 2;
      const w = measureCtx.measureText(text).width;
      lb.style.fontSize = `${w > avail ? Math.max(LABEL_MIN, Math.floor(LABEL_PX * avail / w)) : LABEL_PX}px`;
    });
  }
  if (!full && document.fonts && document.fonts.ready) document.fonts.ready.then(fitLabels);

  // Compact chart crop: only pieces with an occupied seat count (no teacher
  // desk, no empty desks off in a corner, no front marker), so the seats get
  // the whole panel. Falls back to the full room when nothing is seated.
  function fitBounds() {
    if (full) return roomBounds(layout);
    const used = layout.pieces.filter((p) => (TYPES[p.type] || { seats: [] }).seats.some((_, i) => studentById(assignments[`${p.id}:${i}`])));
    if (!used.length) return roomBounds(layout);
    const items = used.map(bbox);
    return {
      minX: Math.min(...items.map((b) => b.x)), minY: Math.min(...items.map((b) => b.y)),
      maxX: Math.max(...items.map((b) => b.x + b.w)), maxY: Math.max(...items.map((b) => b.y + b.h)),
    };
  }

  function renderRoom() {
    room.innerHTML = '';
    const f = layout.front;
    const front = document.createElement('div');
    front.className = 'piece front';
    front.style.width = `${FRONT.w * G}px`;
    front.style.height = `${FRONT.h * G}px`;
    front.style.transform = pieceTransform(f.x, f.y, 0);
    front.innerHTML = '<span class="front-text">Front of room</span>';
    room.appendChild(front);

    for (const p of layout.pieces) {
      const t = TYPES[p.type];
      if (!t) continue;
      const el = document.createElement('div');
      el.className = `piece ${p.type}` + (t.round ? ' is-round' : '');
      el.style.width = `${t.w * G}px`;
      el.style.height = `${t.h * G}px`;
      el.style.transform = pieceTransform(p.x, p.y, p.rotation || 0);
      if (t.round) { const top = document.createElement('div'); top.className = 'table-top'; el.appendChild(top); }
      (t.desks || []).forEach(([x, y, w, h]) => {
        const d = document.createElement('div');
        d.className = 'desk-block';
        d.style.cssText = `left:${x * G}px;top:${y * G}px;width:${w * G}px;height:${h * G}px`;
        d.innerHTML = `<span class="seat-label" style="${labelStyle(p, w, h)}">${t.text || ''}</span>`;
        el.appendChild(d);
      });
      t.seats.forEach(([x, y, w, h], i) => {
        const sid = assignments[`${p.id}:${i}`];
        const s = sid ? studentById(sid) : null;
        const seat = document.createElement(s ? 'button' : 'div');
        seat.className = 'seat' + (s ? ' taken' : '');
        if (s) { seat.type = 'button'; seat.dataset.student = s.id; seat.dataset.status = marks[s.id] ? marks[s.id].status : ''; seat.title = s.name; }
        seat.style.cssText = `left:${x * G}px;top:${y * G}px;width:${w * G}px;height:${h * G}px`;
        seat.innerHTML = `<span class="seat-label" style="${labelStyle(p, w, h)}">${s ? escapeHtml(shortName(s)) : ''}</span>`;
        el.appendChild(seat);
      });
      room.appendChild(el);
    }
    fitLabels();
    fitRoom();
  }

  // Scale the whole room to fit the chart box, centred.
  function fitRoom() {
    if (!layout || chart.hidden) return;
    const r = chart.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const { minX, minY, maxX, maxY } = fitBounds();
    const padPx = full ? (isPresent() ? 24 : 12) : 4;
    const w = (maxX - minX) * G, h = (maxY - minY) * G;
    const zoom = Math.max(0.2, Math.min((r.width - padPx * 2) / w, (r.height - padPx * 2) / h, full ? 2.4 : 4));
    const px = (r.width - w * zoom) / 2 - minX * G * zoom;
    const py = (r.height - h * zoom) / 2 - minY * G * zoom;
    room.style.transform = `translate(${px}px, ${py}px) scale(${zoom})`;
    chart.style.backgroundSize = `${G * zoom}px ${G * zoom}px`;
    chart.style.backgroundPosition = `${px}px ${py}px`;
  }
  new ResizeObserver(() => fitRoom()).observe(chart);

  // ---------- click to cycle: Present → Absent → Tardy → Present ----------
  root.querySelector('.att-chart').addEventListener('click', (e) => {
    const el = e.target.closest('[data-student]');
    if (!el) return;
    cycle(el.dataset.student);
  });
  function cycle(id) {
    const cur = marks[id] && marks[id].status;
    const next = !cur ? 'absent' : cur === 'absent' ? 'tardy' : null;
    if (next) marks[id] = { status: next, at: new Date().toISOString() };
    else delete marks[id];
    root.querySelectorAll(`[data-student="${id}"]`).forEach((el) => { el.dataset.status = next || ''; });
    renderSummary();
    scheduleSave();
  }

  // =====================================================================
  // Summary, copy, reset, autosave
  // =====================================================================
  function renderSummary() {
    const absent = students.filter((s) => marks[s.id] && marks[s.id].status === 'absent');
    const tardy = students.filter((s) => marks[s.id] && marks[s.id].status === 'tardy');
    const present = students.length - absent.length - tardy.length;
    $('att-counts').innerHTML = currentPeriodId && students.length
      ? `<b>${present}</b> present <i>·</i> <b class="c-absent">${absent.length}</b> absent <i>·</i> <b class="c-tardy">${tardy.length}</b> tardy`
      : '—';
    $('exp-counts').innerHTML = students.length ? `<span class="hud-key">P</span><span class="hud-val">${present}</span><span class="hud-key c-absent">A</span><span class="hud-val">${absent.length}</span><span class="hud-key c-tardy">T</span><span class="hud-val">${tardy.length}</span>` : '';
    $('absent-n').textContent = pad(absent.length);
    $('tardy-n').textContent = pad(tardy.length);
    $('absent-list').innerHTML = absent.map((s) => `<li>${escapeHtml(s.name)}</li>`).join('') || '<li class="none">none</li>';
    $('tardy-list').innerHTML = tardy.map((s) => `<li>${escapeHtml(s.name)}<span class="at">${fmtTime(marks[s.id].at)}</span></li>`).join('') || '<li class="none">none</li>';
    if (full) $('btn-copy').disabled = $('btn-reset').disabled = !currentPeriodId || students.length === 0;
    document.dispatchEvent(new CustomEvent('teacherpal:attendance', { detail: { periodId: currentPeriodId, date: viewDate, present, absent: absent.length, tardy: tardy.length, total: students.length } }));
  }

  function listText() {
    const absent = students.filter((s) => marks[s.id] && marks[s.id].status === 'absent').map((s) => s.name);
    const tardy = students.filter((s) => marks[s.id] && marks[s.id].status === 'tardy').map((s) => `${s.name} (${fmtTime(marks[s.id].at)})`);
    return `Absent: ${absent.length ? absent.join(', ') : 'none'} / Tardy: ${tardy.length ? tardy.join(', ') : 'none'}`;
  }
  if (full) {
    $('btn-copy').addEventListener('click', async () => {
      const text = listText();
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
        else {
          const ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        }
        setStatus(`Copied: ${text}`, 'ok');
      } catch (err) { showError(err); }
    });
    $('btn-reset').addEventListener('click', () => {
      if (!Object.keys(marks).length) { setStatus('Nothing to reset — everyone is present.', 'info'); return; }
      const p = periods.find((x) => x.id === currentPeriodId);
      if (!confirm(`Reset attendance for ${p ? p.name : 'this period'} on ${viewDate}? Everyone goes back to present.`)) return;
      marks = {};
      root.querySelectorAll('[data-student]').forEach((el) => { el.dataset.status = ''; });
      renderSummary();
      scheduleSave(0);
    });
  }

  function setSaveState(state) {
    const el = $('save-state');
    el.dataset.state = state;
    el.textContent = state === 'saving' ? 'SAVING…' : state === 'saved' ? '● SAVED' : state === 'error' ? 'NOT SAVED' : '';
  }
  function scheduleSave(delay = 500) {
    clearTimeout(saveTimer);
    setSaveState('saving');
    const pid = currentPeriodId, date = viewDate, snapshot = JSON.parse(JSON.stringify(marks));
    saveTimer = setTimeout(async () => {
      try {
        await saveAttendance(pid, date, snapshot);
        if (date === todayKey()) writeAbsentCache(pid, absentIdsOf(snapshot));   // Create Groups reads this
        if (pid === currentPeriodId && date === viewDate) setSaveState('saved');
      } catch (err) {
        setSaveState('error');
        showError(err);
      }
    }, delay);
  }
  window.addEventListener('beforeunload', (e) => {
    if ($('save-state').dataset.state === 'saving') { e.preventDefault(); e.returnValue = ''; }
  });

  // =====================================================================
  // Boot — periods / overrides come from nav.js (navReady), the room from shared.js
  // =====================================================================
  (async () => {
    if (!isConfigured()) { renderAll(); return; }
    try {
      const [nav, savedRoom] = await Promise.all([navReady, getRoomLayout().catch(() => null)]);
      periods = nav.periods;
      byNumber = nav.byNumber;
      layout = savedRoom && Array.isArray(savedRoom.pieces) ? { front: { x: 20, y: 3, w: FRONT.w, h: FRONT.h }, ...savedRoom } : null;
      const d = new Date();
      const sched = resolveSchedule(d, nav.overrides);
      // open on the bell's period if there is one, else the last-used period
      const n = suggestedPeriod(d, sched, (k) => byNumber.has(k));
      const fallback = fillPeriodSelect($('period-select'), periods);
      currentPeriodId = null;
      selectPeriod(n !== null ? byNumber.get(n).id : fallback);
    } catch (err) { showError(err); }
  })();

  const api = {
    refit: fitRoom,
    selectPeriod: (id) => selectPeriod(id, { manual: true }),
    get periodId() { return currentPeriodId; },
    get date() { return viewDate; },
  };
  window.attendanceView = api;
  return api;
}
