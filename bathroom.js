// bathroom.js — Bathroom Tracker.
//
// New layout:
//   • Top control bar: period select + AUTO, date + TODAY, quarter badge,
//     settings gear, fullscreen. Settings (flag min, max out, passes/quarter,
//     quarter dates) live in a dialog opened from the gear — nothing else
//     spills onto the main view.
//   • Out-now strip appears only when at least one student is out — big
//     cards with live timer + End timer button. Flagged (past limit) →
//     red timer.
//   • Student grid: name + four small pass-checkboxes that fill left-to-right
//     as passes are used. Card visibly dims + shows OUT badge when out; card
//     locks (dashed border, No passes badge) when 4 used.
//   • Log & History collapsed by default in a <details> at the bottom; two
//     tabs inside, click a name in History to see per-student breakdown.
//
// Click flow: click a card → confirm dialog → Start timer signs out. On the
// Out-now card, End timer signs the student back in (that's what fills the
// next checkbox on their grid card + logs the trip).
//
// All data via shared.js (bathroom_log); settings in localStorage.

function initBathroom({ mount = '#bathroom' } = {}) {
  const root = document.querySelector(mount);
  if (!root) return;
  const $  = (id) => root.querySelector(`#${id}`);

  // ---------- settings + quarter overrides + per-period mode (localStorage) ----------
  const SETTINGS_KEY = 'teacherpal.bathroom.settings';
  const QUARTERS_KEY = 'teacherpal.bathroom.quarters';
  const MODES_KEY    = 'teacherpal.bathroom.modes';   // { <periodId>: 'quick' | 'timer' }
  let settings = { flagMinutes: 8, maxOut: 2, passLimit: 4 };
  try { settings = { ...settings, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }; } catch { /* ignore */ }
  let quartersOverride = null;   // null → use schedule.js QUARTERS
  try {
    const stored = JSON.parse(localStorage.getItem(QUARTERS_KEY) || 'null');
    if (Array.isArray(stored) && stored.length === 4) quartersOverride = stored;
  } catch { /* ignore */ }
  let modes = {};
  try { modes = JSON.parse(localStorage.getItem(MODES_KEY) || '{}') || {}; } catch { /* ignore */ }
  let mode = 'timer';   // will be set per-period at load time; timer keeps existing behaviour as default
  const saveSettings  = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };
  const saveQuarters  = () => { try {
    if (quartersOverride) localStorage.setItem(QUARTERS_KEY, JSON.stringify(quartersOverride));
    else localStorage.removeItem(QUARTERS_KEY);
  } catch { /* ignore */ } };
  const saveModes     = () => { try { localStorage.setItem(MODES_KEY, JSON.stringify(modes)); } catch { /* ignore */ } };
  // Prefer the local override for quarter-of calculations. Falls back to
  // schedule.js QUARTERS via quarterOf() so nothing else in the app has to
  // know we allow overrides.
  const activeQuarters = () => quartersOverride || QUARTERS;
  const quarterFor = (ymd) => {
    const qs = activeQuarters();
    for (const qt of qs) if (ymd >= qt.start && ymd <= qt.end) return qt.q;
    if (ymd < qs[0].start) return qs[0].q;
    for (let i = qs.length - 1; i >= 0; i--) if (ymd > qs[i].end) return qs[i].q;
    return qs[0].q;
  };

  const SETTINGS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  root.innerHTML = `
    <div class="br-top">
      <label class="dash-field"><span class="hud-key">Period</span><select id="br-period" aria-label="Period"></select></label>
      <button type="button" class="hud-chip" id="br-follow" aria-pressed="true" title="Follow the bell schedule">Auto</button>
      <label class="dash-field"><span class="hud-key">Date</span><input type="date" id="br-date" aria-label="Date"></label>
      <button type="button" class="hud-chip" id="br-today" hidden>Today</button>
      <span class="spacer"></span>
      <span class="br-quarter-badge" id="br-quarter" title="Current quarter">Q1</span>
      <button type="button" class="icon-btn" id="br-settings-btn" title="Bathroom settings" aria-label="Bathroom settings">${SETTINGS_ICON}</button>
      <button type="button" class="icon-btn" data-fullscreen aria-pressed="false" title="Full screen (F)" aria-label="Toggle full screen"><span class="when-off">↗</span><span class="when-on">↙</span></button>
    </div>

    <div class="br-mode-row">
      <div class="br-mode-toggle" role="tablist" aria-label="Sign-out mode">
        <button type="button" class="br-mode" role="tab" data-mode="quick">Quick tap</button>
        <button type="button" class="br-mode" role="tab" data-mode="timer">Timer</button>
      </div>
      <span class="br-mode-hint" id="br-mode-hint"></span>
    </div>

    <section class="br-out-strip" id="br-out-strip" hidden aria-label="Out now">
      <div class="br-out-strip-head">
        <h3>Out now <span class="br-out-count" id="br-out-count">0</span> <span class="hud-key">of ${settings.maxOut}</span></h3>
      </div>
      <div class="br-out-cards" id="br-out-cards"></div>
    </section>

    <section class="br-grid-wrap" aria-label="Students">
      <div class="br-search-row">
        <input type="search" id="br-search" class="br-search" placeholder="Search students…" autocomplete="off" spellcheck="false" aria-label="Search students">
      </div>
      <div class="br-grid" id="br-grid"></div>
      <div class="br-search-empty" id="br-search-empty" hidden></div>
      <div class="chart-empty" id="br-empty" hidden></div>
    </section>

    <details class="br-log-panel" id="br-log-panel">
      <summary>
        <span>Log &amp; history</span>
        <span class="hud-key" id="br-log-summary">— trips today</span>
      </summary>
      <div class="br-log-inner">
        <div class="br-log-tabs" role="tablist">
          <button type="button" class="br-tab active" role="tab" data-tab="log" aria-selected="true">Today's log</button>
          <button type="button" class="br-tab" role="tab" data-tab="history" aria-selected="false">History</button>
        </div>
        <div class="br-log-body">
          <ul class="br-list" id="br-log-list"></ul>
          <div id="br-history-view" hidden></div>
        </div>
      </div>
    </details>

    <div class="br-undo-toast" id="br-undo" hidden role="status" aria-live="polite">
      <span class="br-undo-msg" id="br-undo-msg"></span>
      <button type="button" id="br-undo-btn">Undo</button>
    </div>

    <dialog id="br-settings-dialog" class="br-settings-dialog">
      <form method="dialog">
        <h3>Bathroom settings</h3>
        <div class="br-settings-grid">
          <label class="br-settings-field">
            <span>Flag after</span>
            <span><input type="number" id="set-flag" min="1" max="60"> <span class="hud-key">min</span></span>
            <small>Timer turns red past this limit.</small>
          </label>
          <label class="br-settings-field">
            <span>Max out at once</span>
            <input type="number" id="set-max" min="1" max="10">
            <small>How many students may be out simultaneously.</small>
          </label>
          <label class="br-settings-field">
            <span>Passes per quarter</span>
            <input type="number" id="set-limit" min="0" max="20">
            <small>How many bathroom passes each student gets each quarter.</small>
          </label>
        </div>

        <h4>Quarter dates</h4>
        <p class="br-settings-note">Override the calendar quarters used to count passes. Defaults come from <code>schedule.js</code>.</p>
        <div class="br-quarters-grid" id="br-quarters-grid"></div>
        <div class="br-dialog-actions between">
          <button type="button" class="link" id="br-quarters-reset">Reset quarters to defaults</button>
        </div>

        <h4>Manual backfill</h4>
        <p class="br-settings-note">Enter trips from paper tracking. Additions save straight to the database — no need to hit Save.</p>
        <div class="br-backfill">
          <label class="br-bf-student">
            <span>Student</span>
            <select id="bf-student"></select>
          </label>

          <div class="br-bf-row">
            <label>
              <span class="hud-key">Date</span>
              <input type="date" id="bf-date">
            </label>
            <label>
              <span class="hud-key">Time</span>
              <input type="time" id="bf-time" step="60">
            </label>
            <label>
              <span class="hud-key">Duration</span>
              <span><input type="number" id="bf-duration" min="0" max="60" step="1"> <span class="hud-key">min</span></span>
            </label>
            <button type="button" class="primary small" id="bf-add-trip">Add trip</button>
          </div>

          <div class="br-bf-row">
            <label>
              <span class="hud-key">Bulk</span>
              <span>Add <input type="number" id="bf-bulk-n" min="1" max="20" value="1" style="width:3.4rem"> to <span id="bf-bulk-q" class="hud-val">Q1</span> tally</span>
            </label>
            <button type="button" class="small" id="bf-add-bulk">Add passes</button>
          </div>

          <div class="br-bf-msg" id="bf-msg" role="status" aria-live="polite"></div>

          <div class="br-bf-list-head">Existing entries</div>
          <ul class="br-bf-list" id="bf-list"></ul>
        </div>

        <div class="br-dialog-actions">
          <button value="cancel">Close</button>
          <button value="ok" class="primary">Save settings</button>
        </div>
      </form>
    </dialog>`;

  // ---------- state ----------
  let periods = [], byNumber = new Map();
  let periodId = null, date = todayKey();
  let students = [];
  let trips = [];         // today's rows for this period
  let history = [];       // all rows for this period, all dates
  let followBell = true, loadSeq = 0;
  let activeTab = 'log';
  let historyStudent = null;   // if set, showing a specific student's history detail

  const studentById = (id) => students.find((s) => s.id === id);
  const isToday = () => date === todayKey();
  const isTrip = (t) => !t.manual;
  const tripQuarter = (t) => (t.manual ? t.quarter : quarterFor(t.date));
  // Passes "used" = completed trips + manual tallies. An in-progress trip
  // does NOT count until the student returns — that's when the next
  // checkbox fills. Effective pass count for gating a new sign-out includes
  // the in-progress trip if any, via `effectiveUsed` below.
  const usedIn = (sid, q) => history
    .filter((t) => t.student_id === sid && tripQuarter(t) === q && (t.manual || t.in_at))
    .reduce((s, t) => s + (t.manual ? (Number(t.count) || 0) : 1), 0);
  const outTrips = () => trips.filter((t) => isTrip(t) && !t.in_at);
  const effectiveUsed = (sid, q) => usedIn(sid, q) + (outOf(sid) ? 1 : 0);
  const outOf = (sid) => outTrips().find((t) => t.student_id === sid);
  const elapsedSec = (t, now = Date.now()) =>
    Math.max(0, Math.floor(((t.in_at ? new Date(t.in_at).getTime() : now) - new Date(t.out_at).getTime()) / 1000));
  const fmtDur = (s) => { const m = Math.floor(s / 60), sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}`; };
  const fmtClock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const flagged = (t) => !t.in_at && elapsedSec(t) >= settings.flagMinutes * 60;
  // Quick-tap trips are inserted with out_at === in_at (see doQuickTap /
  // insertBathroomTrip). Distinguish them in the log so a "12:35 → 12:35 · 0:00"
  // row can be labelled "quick tap" instead of looking like a timer bug.
  // doQuickTap inserts both timestamps as the *same* ISO string; a timer
  // trip's out_at (server default now()) and in_at (client
  // new Date().toISOString()) come from different moments and different
  // clocks so their strings can't collide.
  const isQuickTap = (t) => !!t.in_at && t.in_at === t.out_at;
  function tripLabel(t) {
    if (!t.in_at) return `${fmtClock(t.out_at)} · still out`;
    if (isQuickTap(t)) return `${fmtClock(t.out_at)} · quick tap`;
    return `${fmtClock(t.out_at)} → ${fmtClock(t.in_at)} · ${fmtDur(elapsedSec(t))}`;
  }

  // ---------- rendering ----------
  function renderGrid() {
    const grid = $('br-grid'), empty = $('br-empty');
    if (!periodId) {
      empty.hidden = false;
      empty.innerHTML = periods.length
        ? '<p>Pick a period.</p>'
        : '<p>No periods yet.</p><a class="hud-chip" href="roster.html">Set up rosters</a>';
      grid.hidden = true;
      return;
    }
    if (!students.length) {
      empty.hidden = false;
      empty.innerHTML = '<p>No students in this period.</p><a class="hud-chip" href="roster.html">Add students</a>';
      grid.hidden = true;
      return;
    }
    empty.hidden = true;
    grid.hidden = false;

    const q = quarterFor(date);
    $('br-quarter').textContent = q;

    grid.innerHTML = students.map((s) => {
      const out = outOf(s.id);
      const usedDone = usedIn(s.id, q);          // completed passes only
      const effUsed  = usedDone + (out ? 1 : 0); // includes in-flight
      const locked = !out && settings.passLimit > 0 && usedDone >= settings.passLimit;
      const cls = ['br-card', out && 'out', locked && 'locked'].filter(Boolean).join(' ');
      const boxes = settings.passLimit > 0
        ? Array.from({ length: settings.passLimit }, (_, i) => {
            if (i < usedDone) return '<span class="br-pass used" aria-hidden="true"></span>';
            if (i === usedDone && out) return '<span class="br-pass pending" aria-hidden="true"></span>';
            return '<span class="br-pass" aria-hidden="true"></span>';
          }).join('')
        : `<span class="br-pass-unlimited">${effUsed}</span>`;
      const badge = out
        ? '<span class="br-badge out-badge">Out</span>'
        : (locked ? '<span class="br-badge locked-badge">No passes</span>' : '');
      const remaining = settings.passLimit - usedDone;
      const title = out
        ? `${s.name} is out — end their timer in the Out-now strip`
        : (locked
            ? `${s.name} used all ${settings.passLimit} passes this ${q} — raise passes-per-quarter in settings to override`
            : (mode === 'quick'
                ? `Tap to log one pass for ${s.name} (${remaining} of ${settings.passLimit} left)`
                : `Send ${s.name} to the bathroom (${remaining} of ${settings.passLimit} left)`));
      return `
        <button type="button" class="${cls}" data-student="${s.id}" title="${escapeHtml(title)}"${out || locked ? ' aria-disabled="true"' : ''}>
          ${badge}
          <span class="br-card-name">${escapeHtml(s.name)}</span>
          <span class="br-passes" aria-label="${effUsed} of ${settings.passLimit || '∞'} passes used this ${q}">${boxes}</span>
        </button>`;
    }).join('');
    // reapply any active search filter after re-render
    if (typeof applySearchFilter === 'function') applySearchFilter();
  }

  function renderOutStrip() {
    const strip = $('br-out-strip');
    const cards = $('br-out-cards');
    const out = outTrips();
    strip.hidden = out.length === 0;
    $('br-out-count').textContent = out.length;
    cards.innerHTML = out.map((t) => {
      const s = studentById(t.student_id);
      const flag = flagged(t);
      return `
        <div class="br-out-card${flag ? ' flagged' : ''}" data-trip="${t.id}">
          <div class="br-out-name">${escapeHtml(s ? s.name : '?')}</div>
          <div class="br-out-timer" data-trip-timer="${t.id}">${fmtDur(elapsedSec(t))}</div>
          <button type="button" class="primary br-end-btn" data-end="${t.id}">End timer</button>
        </div>`;
    }).join('');
  }

  function renderLogPanel() {
    const q = quarterFor(date);
    const timed = trips.filter(isTrip);
    $('br-log-summary').textContent = `${isToday() ? 'today' : date} · ${timed.length} trip${timed.length === 1 ? '' : 's'} · ${q}`;

    // Toggle tab visibility
    $('br-log-list').hidden = activeTab !== 'log';
    $('br-history-view').hidden = activeTab !== 'history';
    root.querySelectorAll('.br-tab').forEach((b) => {
      const on = b.dataset.tab === activeTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });

    if (activeTab === 'log') {
      $('br-log-list').innerHTML = timed.slice().reverse().map((t) => {
        const s = studentById(t.student_id);
        return `<li>
          <span class="br-log-name">${escapeHtml(s ? s.name : '?')}</span>
          <span class="br-log-times">${escapeHtml(tripLabel(t))}</span>
          <button type="button" class="link br-del" data-trip="${t.id}" title="Delete this trip">×</button>
        </li>`;
      }).join('') || '<li class="none">No trips yet today.</li>';
    } else {
      renderHistoryView();
    }
  }

  function renderHistoryView() {
    const view = $('br-history-view');
    const q = quarterFor(date);
    if (historyStudent) {
      const s = studentById(historyStudent);
      const rows = history.filter((t) => t.student_id === historyStudent && !t.manual);
      const manualRow = history.find((t) => t.student_id === historyStudent && t.manual && t.quarter === q);
      const manualCount = manualRow ? Number(manualRow.count) || 0 : 0;
      view.innerHTML = `
        <div class="br-hist-detail-head">
          <button type="button" class="link" id="br-hist-back">← back</button>
          <h4>${escapeHtml(s ? s.name : '?')}</h4>
        </div>
        <div class="br-hist-manual">
          <span class="hud-key">${q} manual tally</span>
          <button type="button" class="small" data-adj="-1" aria-label="Minus one">−</button>
          <span class="br-manual-n">${manualCount}</span>
          <button type="button" class="small" data-adj="1" aria-label="Plus one">+</button>
          <span class="hud-key">used ${usedIn(historyStudent, q)}/${settings.passLimit || '∞'}</span>
        </div>
        <ul class="br-list">${
          rows.map((t) => `<li>
            <span class="br-log-name">${escapeHtml(t.date)}</span>
            <span class="br-log-times">${escapeHtml(tripLabel(t))}</span>
          </li>`).join('') || '<li class="none">No timed trips.</li>'
        }</ul>`;
      view.querySelector('#br-hist-back').addEventListener('click', () => { historyStudent = null; renderLogPanel(); });
      view.querySelectorAll('[data-adj]').forEach((b) => b.addEventListener('click', async () => {
        const cur = usedManualIn(historyStudent, q);
        const next = Math.max(0, cur + Number(b.dataset.adj));
        try {
          const row = await setManualTally(periodId, historyStudent, q, next);
          history = history.filter((t) => !(t.student_id === historyStudent && t.manual && t.quarter === q));
          if (row) history.unshift(row);
        } catch (err) { showError(err); return; }
        renderGrid(); renderLogPanel();
      }));
      return;
    }
    // Summary list per student for the current quarter
    const by = new Map();
    for (const t of history) {
      if (tripQuarter(t) !== q) continue;
      const b = by.get(t.student_id) || { used: 0, trips: 0, manual: 0, sec: 0 };
      if (t.manual) { const n = Number(t.count) || 0; b.manual += n; b.used += n; }
      else { b.trips++; b.used++; b.sec += elapsedSec(t); }
      by.set(t.student_id, b);
    }
    const rows = [...by.entries()]
      .map(([sid, b]) => ({ sid, ...b, name: (studentById(sid) || {}).name || '?' }))
      .filter((r) => r.used > 0)
      .sort((a, b) => b.used - a.used);
    view.innerHTML = `
      <p class="br-hist-note">Passes used this ${q} — click a name for detail.</p>
      <ul class="br-list">${
        rows.map((r) => `<li class="${settings.passLimit > 0 && r.used >= settings.passLimit ? 'flagged' : ''}">
          <button type="button" class="link br-hist-who" data-student="${r.sid}">${escapeHtml(r.name)}</button>
          <span class="br-log-times">${r.used}/${settings.passLimit || '∞'} · ${r.trips ? `${r.trips} timed · ${Math.round(r.sec / 60)} min` : 'tallies only'}${r.manual ? ` · ${r.manual} manual` : ''}</span>
        </li>`).join('') || '<li class="none">No passes used yet this quarter.</li>'
      }</ul>`;
    view.querySelectorAll('.br-hist-who').forEach((b) => b.addEventListener('click', () => { historyStudent = b.dataset.student; renderLogPanel(); }));
  }

  const usedManualIn = (sid, q) => {
    const row = history.find((t) => t.student_id === sid && t.manual && t.quarter === q);
    return row ? Number(row.count) || 0 : 0;
  };

  // Live tick: update timers + flag state without full re-render.
  setInterval(() => {
    const now = Date.now();
    root.querySelectorAll('[data-trip-timer]').forEach((el) => {
      const t = trips.find((x) => x.id === el.dataset.tripTimer);
      if (t) el.textContent = fmtDur(elapsedSec(t, now));
    });
    root.querySelectorAll('.br-out-card').forEach((el) => {
      const t = trips.find((x) => x.id === el.dataset.trip);
      if (t) el.classList.toggle('flagged', flagged(t));
    });
  }, 1000);

  // ---------- search ----------
  // Filter is DOM-only (add/remove .br-hidden on cards) so re-renders
  // triggered by ticks/actions don't need to know about it. On every full
  // renderGrid we re-apply the current search term.
  const $search = $('br-search');
  function currentSearch() { return $search.value.trim().toLowerCase(); }
  function applySearchFilter() {
    const q = currentSearch();
    const grid = $('br-grid');
    let shown = 0, total = 0;
    grid.querySelectorAll('.br-card').forEach((card) => {
      total++;
      const name = (card.querySelector('.br-card-name')?.textContent || '').toLowerCase();
      const hit = !q || name.includes(q);
      card.classList.toggle('br-hidden', !hit);
      if (hit) shown++;
    });
    const empty = $('br-search-empty');
    if (q && total > 0 && shown === 0) {
      empty.hidden = false;
      empty.textContent = `No student matches "${$search.value.trim()}".`;
    } else {
      empty.hidden = true;
    }
  }
  $search.addEventListener('input', applySearchFilter);
  $search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $search.value) {
      e.preventDefault();
      $search.value = '';
      applySearchFilter();
    }
  });

  $('br-grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-student]'); if (!btn) return;
    const sid = btn.dataset.student;
    const student = studentById(sid);
    if (!student) return;
    if (outOf(sid)) { setStatus(`${student.name} is already out — end their timer on the Out-now strip.`, 'info'); return; }
    if (settings.passLimit > 0 && usedIn(sid, quarterFor(date)) >= settings.passLimit) {
      setStatus(`${student.name} has no passes left this ${quarterFor(date)}. Raise passes-per-quarter in settings to override.`, 'error');
      return;
    }
    if (mode === 'quick') { await doQuickTap(student); return; }
    // ---- timer mode: immediate signout, undo for mistaps ----
    if (outTrips().length >= settings.maxOut) {
      setStatus(`${settings.maxOut} already out — wait for someone to come back.`, 'error');
      return;
    }
    try {
      const row = await bathroomSignOut(periodId, sid, date);
      trips.push(row);
      history.unshift(row);
    } catch (err) { showError(err); return; }
    renderGrid(); renderOutStrip(); renderLogPanel();
    showUndoToast(`${student.name} — timer started`, trips[trips.length - 1].id);
  });

  // ---------- quick tap ----------
  async function doQuickTap(student) {
    const nowIso = new Date().toISOString();
    try {
      const row = await insertBathroomTrip({
        periodId, studentId: student.id, date,
        outAt: nowIso, inAt: nowIso,
      });
      history.unshift(row);
      trips.push(row);
      renderGrid(); renderLogPanel();
      flashCard(student.id);
      showUndoToast(`${student.name} — pass logged`, row.id);
    } catch (err) { showError(err); }
  }

  function flashCard(sid) {
    const card = root.querySelector(`.br-card[data-student="${sid}"]`);
    if (!card) return;
    card.classList.remove('br-flash');
    // force reflow so the animation restarts if this student is tapped twice in a row
    // eslint-disable-next-line no-unused-expressions
    void card.offsetWidth;
    card.classList.add('br-flash');
    setTimeout(() => card.classList.remove('br-flash'), 900);
  }

  // ---------- undo toast ----------
  let undoTimer = null;
  function showUndoToast(msg, tripId) {
    const toast = $('br-undo');
    $('br-undo-msg').textContent = msg;
    toast.dataset.tripId = tripId;
    toast.hidden = false;
    toast.classList.remove('hiding');
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndoToast, 6000);
  }
  function hideUndoToast() {
    const toast = $('br-undo');
    if (toast.hidden) return;
    toast.classList.add('hiding');
    setTimeout(() => { toast.hidden = true; toast.classList.remove('hiding'); delete toast.dataset.tripId; }, 200);
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
  }
  $('br-undo-btn').addEventListener('click', async () => {
    const toast = $('br-undo');
    const id = toast.dataset.tripId;
    if (!id) return;
    try {
      await deleteBathroomTrip(id);
      history = history.filter((x) => x.id !== id);
      trips   = trips.filter((x) => x.id !== id);
      renderGrid(); renderOutStrip(); renderLogPanel();
      hideUndoToast();
      setStatus('Undone.', 'ok');
    } catch (err) { showError(err); }
  });

  // ---------- mode toggle ----------
  function applyMode() {
    root.setAttribute('data-mode', mode);
    root.querySelectorAll('.br-mode').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    const hint = $('br-mode-hint');
    if (hint) {
      hint.textContent = mode === 'quick'
        ? 'One tap = one pass. Fills the checkbox immediately. Undo appears for 6 seconds.'
        : 'Tap to confirm → timer starts. End timer signs the student back in.';
    }
    hideUndoToast();
  }
  function loadModeForPeriod() {
    mode = (periodId && modes[periodId] === 'quick') ? 'quick' : 'timer';
    applyMode();
  }
  root.querySelectorAll('.br-mode').forEach((b) => b.addEventListener('click', () => {
    const newMode = b.dataset.mode === 'quick' ? 'quick' : 'timer';
    if (newMode === mode) return;
    mode = newMode;
    if (periodId) { modes[periodId] = mode; saveModes(); }
    applyMode();
    renderGrid();   // refresh tooltips per mode
  }));

  $('br-out-cards').addEventListener('click', async (e) => {
    const btn = e.target.closest('.br-end-btn'); if (!btn) return;
    const id = btn.dataset.end;
    const trip = trips.find((t) => t.id === id);
    if (!trip) return;
    try {
      const saved = await bathroomSignIn(id);
      Object.assign(trip, saved);
      history = history.map((t) => (t.id === id ? trip : t));
      const s = studentById(trip.student_id);
      setStatus(`${s ? s.name : 'Student'} back after ${fmtDur(elapsedSec(trip))}.`, 'ok');
    } catch (err) { showError(err); return; }
    renderGrid(); renderOutStrip(); renderLogPanel();
  });

  $('br-log-list').addEventListener('click', async (e) => {
    const b = e.target.closest('.br-del'); if (!b) return;
    const t = trips.find((x) => x.id === b.dataset.trip); if (!t) return;
    const s = studentById(t.student_id);
    if (!confirm(`Delete ${s ? s.name : 'this'} trip at ${fmtClock(t.out_at)}?`)) return;
    try { await deleteBathroomTrip(t.id); } catch (err) { showError(err); return; }
    trips = trips.filter((x) => x !== t);
    history = history.filter((x) => x.id !== t.id);
    renderGrid(); renderOutStrip(); renderLogPanel();
  });

  // Tab switching
  root.querySelectorAll('.br-tab').forEach((b) => b.addEventListener('click', () => {
    activeTab = b.dataset.tab;
    historyStudent = null;   // reset detail view when swapping tabs
    renderLogPanel();
  }));

  // ---------- settings dialog ----------
  function openSettings() {
    const d = $('br-settings-dialog');
    $('set-flag').value = settings.flagMinutes;
    $('set-max').value = settings.maxOut;
    $('set-limit').value = settings.passLimit;
    const qs = activeQuarters();
    $('br-quarters-grid').innerHTML = qs.map((qt, i) => `
      <div class="br-quarter-row">
        <span class="hud-key">${qt.q}</span>
        <input type="date" data-q="${i}" data-field="start" value="${qt.start}">
        <span>to</span>
        <input type="date" data-q="${i}" data-field="end" value="${qt.end}">
      </div>`).join('');

    // Manual backfill — populate student dropdown, set defaults, render list.
    // The date field remembers its last value across additions so entering
    // a run of trips for one day is fast.
    const bfStudent = $('bf-student');
    bfStudent.innerHTML = students.map((s) =>
      `<option value="${s.id}">${escapeHtml(s.name)}</option>`
    ).join('');
    if (!bfStudent.options.length) {
      bfStudent.innerHTML = '<option value="">— pick a period with students first —</option>';
    }
    if (!$('bf-date').value) $('bf-date').value = date;   // default to viewed date
    if (!$('bf-time').value) $('bf-time').value = '';
    if (!$('bf-duration').value) $('bf-duration').value = '';
    $('bf-bulk-n').value = 1;
    $('bf-msg').textContent = '';
    updateBulkQuarter();
    renderBackfillList();

    d.returnValue = '';
    d.showModal();
    d.addEventListener('close', function onClose() {
      d.removeEventListener('close', onClose);
      if (d.returnValue !== 'ok') return;
      settings.flagMinutes = Math.max(1, Number($('set-flag').value) || 8);
      settings.maxOut      = Math.max(1, Number($('set-max').value)  || 2);
      settings.passLimit   = Math.max(0, Number($('set-limit').value) || 0);
      saveSettings();
      const nq = qs.map((qt) => ({ q: qt.q, start: qt.start, end: qt.end }));
      d.querySelectorAll('[data-q]').forEach((inp) => {
        const idx = Number(inp.dataset.q);
        nq[idx][inp.dataset.field] = inp.value;
      });
      const isDefault = nq.every((qt, i) => qt.start === QUARTERS[i].start && qt.end === QUARTERS[i].end);
      quartersOverride = isDefault ? null : nq;
      saveQuarters();
      renderGrid(); renderOutStrip(); renderLogPanel();
    }, { once: true });
  }
  $('br-settings-btn').addEventListener('click', openSettings);
  $('br-quarters-reset').addEventListener('click', () => {
    const d = $('br-settings-dialog');
    d.querySelectorAll('[data-q]').forEach((inp) => {
      const idx = Number(inp.dataset.q);
      inp.value = QUARTERS[idx][inp.dataset.field];
    });
  });

  // ---------- backfill helpers + wiring ----------
  function updateBulkQuarter() {
    const d = $('bf-date').value || date;
    $('bf-bulk-q').textContent = quarterFor(d);
  }
  function bfFlash(text, kind = 'ok') {
    const el = $('bf-msg');
    el.textContent = text || '';
    el.dataset.kind = kind;
  }
  function renderBackfillList() {
    const list = $('bf-list');
    const sid = $('bf-student').value;
    if (!sid) { list.innerHTML = '<li class="none">Pick a student to see their history.</li>'; return; }
    const rows = history
      .filter((t) => t.student_id === sid)
      .slice()
      .sort((a, b) => {
        // manual rows first (grouped by quarter), then trips newest-first
        if (a.manual && !b.manual) return -1;
        if (!a.manual && b.manual) return 1;
        if (a.manual && b.manual) return (a.quarter || '').localeCompare(b.quarter || '');
        return (b.date || '').localeCompare(a.date || '') ||
               String(b.out_at || '').localeCompare(String(a.out_at || ''));
      });
    if (!rows.length) { list.innerHTML = '<li class="none">No entries for this student yet.</li>'; return; }
    list.innerHTML = rows.map((t) => {
      if (t.manual) {
        return `<li class="bf-manual" data-id="${t.id}" data-q="${t.quarter}" data-sid="${t.student_id}">
          <span class="bf-desc"><strong>${escapeHtml(t.quarter)}</strong> manual tally</span>
          <span class="bf-count">
            <button type="button" class="small" data-adj="-1" aria-label="Minus one">−</button>
            <span class="bf-n">${Number(t.count) || 0}</span>
            <button type="button" class="small" data-adj="1" aria-label="Plus one">+</button>
          </span>
          <button type="button" class="link bf-del" data-manual="1" title="Remove tally entirely">×</button>
        </li>`;
      }
      return `<li class="bf-trip" data-id="${t.id}">
        <span class="bf-desc">${escapeHtml(t.date)} <span class="bf-q">${escapeHtml(tripQuarter(t))}</span></span>
        <span class="bf-times">${escapeHtml(tripLabel(t))}</span>
        <button type="button" class="link bf-del" title="Delete this trip">×</button>
      </li>`;
    }).join('');
  }
  $('bf-student').addEventListener('change', () => { renderBackfillList(); bfFlash(''); });
  $('bf-date').addEventListener('change', updateBulkQuarter);

  $('bf-add-trip').addEventListener('click', async () => {
    if (!periodId) { bfFlash('Pick a period first.', 'error'); return; }
    const sid = $('bf-student').value;
    const d   = $('bf-date').value;
    const tm  = $('bf-time').value;         // 'HH:MM' or ''
    const dur = Number($('bf-duration').value) || 0;
    if (!sid) { bfFlash('Pick a student.', 'error'); return; }
    if (!d)   { bfFlash('Pick a date.',   'error'); return; }
    // If no time, use noon so it lands squarely inside the given date.
    const outIso = new Date(`${d}T${tm || '12:00'}:00`).toISOString();
    const inIso  = dur > 0 ? new Date(new Date(outIso).getTime() + dur * 60000).toISOString() : null;
    const btn = $('bf-add-trip');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const row = await insertBathroomTrip({ periodId, studentId: sid, date: d, outAt: outIso, inAt: inIso });
      history.unshift(row);
      if (row.date === date) trips.push(row);
      const s = studentById(sid);
      bfFlash(`Added ${s ? s.name : 'student'}'s trip on ${d}${tm ? ' at ' + tm : ''}${dur ? ` · ${dur} min` : ''}.`, 'ok');
      renderBackfillList();
      renderGrid(); renderOutStrip(); renderLogPanel();
      // Fast-repeat: keep student/date, clear time+duration, focus time.
      $('bf-time').value = '';
      $('bf-duration').value = '';
      $('bf-time').focus();
    } catch (err) {
      bfFlash(err.message || 'Add failed.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Add trip';
    }
  });

  $('bf-add-bulk').addEventListener('click', async () => {
    if (!periodId) { bfFlash('Pick a period first.', 'error'); return; }
    const sid = $('bf-student').value;
    const n = Math.max(1, Number($('bf-bulk-n').value) || 0);
    const q = quarterFor($('bf-date').value || date);
    if (!sid) { bfFlash('Pick a student.', 'error'); return; }
    const btn = $('bf-add-bulk');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const next = usedManualIn(sid, q) + n;
      const row = await setManualTally(periodId, sid, q, next);
      history = history.filter((t) => !(t.student_id === sid && t.manual && t.quarter === q));
      if (row) history.unshift(row);
      const s = studentById(sid);
      bfFlash(`Added ${n} pass${n === 1 ? '' : 'es'} to ${s ? s.name : 'student'}'s ${q} tally.`, 'ok');
      renderBackfillList();
      renderGrid(); renderOutStrip(); renderLogPanel();
      // reset bulk count for the next entry
      $('bf-bulk-n').value = 1;
    } catch (err) {
      bfFlash(err.message || 'Add failed.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Add passes';
    }
  });

  $('bf-list').addEventListener('click', async (e) => {
    const li = e.target.closest('li'); if (!li) return;

    // Manual tally: −/+ adjust
    const adj = e.target.closest('[data-adj]');
    if (adj && li.classList.contains('bf-manual')) {
      const sid = $('bf-student').value;
      const q   = li.dataset.q;
      const cur = usedManualIn(sid, q);
      const next = Math.max(0, cur + Number(adj.dataset.adj));
      try {
        const row = await setManualTally(periodId, sid, q, next);
        history = history.filter((t) => !(t.student_id === sid && t.manual && t.quarter === q));
        if (row) history.unshift(row);
      } catch (err) { bfFlash(err.message || 'Change failed.', 'error'); return; }
      renderBackfillList(); renderGrid(); renderOutStrip(); renderLogPanel();
      return;
    }

    // Remove buttons
    const del = e.target.closest('.bf-del');
    if (!del) return;
    if (li.classList.contains('bf-manual')) {
      const sid = $('bf-student').value;
      const q   = li.dataset.q;
      if (!confirm(`Remove ${q} manual tally for this student?`)) return;
      try {
        await setManualTally(periodId, sid, q, 0);
        history = history.filter((t) => !(t.student_id === sid && t.manual && t.quarter === q));
      } catch (err) { bfFlash(err.message || 'Remove failed.', 'error'); return; }
    } else {
      const id = li.dataset.id;
      const t = history.find((x) => x.id === id);
      if (!t) return;
      if (!confirm(`Delete ${t.date} trip at ${fmtClock(t.out_at)}?`)) return;
      try {
        await deleteBathroomTrip(id);
        history = history.filter((x) => x.id !== id);
        trips = trips.filter((x) => x.id !== id);
      } catch (err) { bfFlash(err.message || 'Delete failed.', 'error'); return; }
    }
    renderBackfillList(); renderGrid(); renderOutStrip(); renderLogPanel();
  });

  // ---------- period / date ----------
  function selectPeriod(id, { manual = false } = {}) {
    if (manual) { followBell = false; $('br-follow').setAttribute('aria-pressed', 'false'); }
    if (id === periodId) { if (!id) { renderGrid(); renderOutStrip(); renderLogPanel(); } return; }
    periodId = id; $('br-period').value = id || ''; setLastPeriodId(id);
    hideUndoToast();
    loadModeForPeriod();
    load();
  }
  function followTheBell(d, sched) {
    if (!followBell || !isToday() || !byNumber.size) return;
    const n = suggestedPeriod(d, sched, (k) => byNumber.has(k));
    if (n !== null && byNumber.get(n).id !== periodId) selectPeriod(byNumber.get(n).id);
  }
  document.addEventListener('teacherpal:tick', (e) => followTheBell(e.detail.now, e.detail.sched));

  $('br-period').addEventListener('change', (e) => selectPeriod(e.target.value, { manual: true }));
  $('br-follow').addEventListener('click', () => {
    followBell = !followBell;
    $('br-follow').setAttribute('aria-pressed', String(followBell));
    if (followBell) { const d = new Date(); followTheBell(d, resolveSchedule(d, navState.overrides)); }
  });
  $('br-date').value = date;
  $('br-date').addEventListener('change', (e) => {
    if (!e.target.value) return;
    date = e.target.value;
    $('br-today').hidden = isToday();
    historyStudent = null;
    load();
  });
  $('br-today').addEventListener('click', () => {
    date = todayKey();
    $('br-date').value = date;
    $('br-today').hidden = true;
    historyStudent = null;
    load();
  });

  async function load() {
    const seq = ++loadSeq;
    students = []; trips = []; history = [];
    if (!periodId) { renderGrid(); renderOutStrip(); renderLogPanel(); return; }
    try {
      const [st, tr, hi] = await Promise.all([
        getStudents(periodId),
        getBathroomLog(periodId, date).catch((err) => {
          setStatus(`Bathroom log unavailable — run migration-lessons-bathroom.sql in the Supabase SQL editor. (${err.message})`, 'error');
          return [];
        }),
        getBathroomHistory(periodId).catch(() => []),
      ]);
      if (seq !== loadSeq) return;
      students = st; trips = tr; history = hi;
    } catch (err) { showError(err); }
    renderGrid(); renderOutStrip(); renderLogPanel();
  }

  navReady.then((nav) => {
    periods = nav.periods; byNumber = nav.byNumber;
    const d = new Date();
    const n = suggestedPeriod(d, resolveSchedule(d, nav.overrides), (k) => byNumber.has(k));
    const fallback = fillPeriodSelect($('br-period'), periods);
    periodId = null;
    selectPeriod(n !== null ? byNumber.get(n).id : fallback);
  });
}
