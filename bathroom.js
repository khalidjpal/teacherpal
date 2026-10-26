// bathroom.js — Bathroom Tracker.
//
// New layout:
//   • One centred control island under the top bar: period select (no
//     label), the Quick tap / Timer toggle, the student search and the
//     settings gear. The bell is followed automatically (no AUTO button);
//     full screen is the top bar's job. Settings (flag min, max out,
//     passes/quarter, quarter dates) live in a dialog opened from the gear.
//   • Date + Today live inside the Log panel — looking at another day is the
//     only reason to move it.
//   • Student grid: name + four small pass-checkboxes that fill left-to-right
//     as passes are used. Card visibly dims + shows OUT badge when out; card
//     locks (dashed border, No passes badge) when 4 used. It scrolls
//     internally so the two panels below always stay on screen.
//   • Two fixed-height panels under the grid, side by side:
//       – Out now: live timers + End timer per student, "Nobody out" when
//         empty. Always rendered, so the row never changes height.
//       – Log: the day's trips (name · out → back · duration · remove) with
//         a ‹ day › switcher + calendar button in its header. Its History
//         button opens the quarter review (see "quarter review" below).
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
    <!-- One control island, centred under the top bar: period, mode, search,
         gear. It shrink-wraps its contents; the grid below is full width. -->
    <div class="br-bar">
      <select id="br-period" aria-label="Period"></select>
      <div class="br-mode-toggle" role="tablist" aria-label="Sign-out mode">
        <button type="button" class="br-mode" role="tab" data-mode="quick">Quick tap</button>
        <button type="button" class="br-mode" role="tab" data-mode="timer">Timer</button>
      </div>
      <input type="search" id="br-search" class="br-search" placeholder="Search students…" autocomplete="off" spellcheck="false" aria-label="Search students">
      <button type="button" class="icon-btn" id="br-settings-btn" title="Bathroom settings" aria-label="Bathroom settings">${SETTINGS_ICON}</button>
    </div>

    <section class="br-grid-wrap" aria-label="Students">
      <div class="br-grid" id="br-grid"></div>
      <div class="br-search-empty" id="br-search-empty" hidden></div>
      <div class="chart-empty" id="br-empty" hidden></div>
    </section>

    <!-- Two fixed-height cards under the grid. Both bodies scroll internally
         so neither one resizes as students come and go. -->
    <div class="br-panels">
      <section class="br-panel" aria-label="Out now">
        <div class="br-panel-head">
          <h3>Out now</h3>
          <span class="br-out-count"><span id="br-out-count">0</span><span class="hud-key" id="br-out-max"> / ${settings.maxOut}</span></span>
        </div>
        <div class="br-panel-body">
          <div class="br-out-cards" id="br-out-cards"></div>
          <p class="br-none" id="br-out-none">Nobody out</p>
        </div>
      </section>

      <section class="br-panel" aria-label="Log">
        <div class="br-panel-head">
          <h3>Log</h3>
          <!-- Day switcher: ‹ day › plus a calendar button that opens the
               native picker. The date input sits under the button (opacity 0)
               so there is still a real control if showPicker() is missing. -->
          <div class="br-daynav">
            <button type="button" class="br-day-step" id="br-prev-day" title="Previous day" aria-label="Previous day">‹</button>
            <button type="button" class="br-day-label" id="br-day-label" title="Back to today">Today</button>
            <button type="button" class="br-day-step" id="br-next-day" title="Next day" aria-label="Next day">›</button>
            <span class="br-cal">
              <button type="button" class="br-day-step" id="br-cal-btn" title="Jump to a date" aria-label="Jump to a date">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>
              </button>
              <input type="date" id="br-date" aria-label="Jump to a date">
            </span>
          </div>
          <button type="button" class="br-hist-btn" id="br-hist-btn" title="Pass history by quarter">History</button>
        </div>
        <div class="br-panel-body">
          <ul class="br-list" id="br-log-list"></ul>
        </div>
      </section>
    </div>

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
    </dialog>

    <!-- Quarter review: every student's passes for one quarter, one period or
         all of them, with a per-student drill-down, CSV and a printable
         paper-tracker sheet. Opened by the Log panel's History button. -->
    <dialog id="br-review" class="br-review-dialog" aria-labelledby="rv-title">
      <div class="rv-head">
        <h3 id="rv-title">Pass history</h3>
        <div class="br-mode-toggle" id="rv-quarters" role="group" aria-label="Quarter"></div>
        <select id="rv-period" aria-label="Period"></select>
        <span class="rv-spacer"></span>
        <button type="button" class="small" id="rv-csv">Export CSV</button>
        <button type="button" class="small" id="rv-print" title="Print the paper-tracker sheet">Print</button>
        <button type="button" class="icon-btn" id="rv-close" title="Close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="rv-range" id="rv-range"></p>
      <div class="rv-body" id="rv-body"></div>
    </dialog>`;

  // ---------- state ----------
  let periods = [], byNumber = new Map();
  let periodId = null, date = todayKey();
  let students = [];
  let trips = [];         // today's rows for this period
  let history = [];       // all rows for this period, all dates
  let followBell = true, loadSeq = 0;

  const studentById = (id) => students.find((s) => s.id === id);
  const isToday = () => date === todayKey();
  const isTrip = (t) => !t.manual;
  const tripQuarter = (t) => (t.manual ? t.quarter : quarterFor(t.date));
  // Passes "used" = completed trips + manual tallies. An in-progress trip
  // does NOT count until the student returns — that's when the next
  // checkbox fills. A trip from an earlier day whose timer was never ended
  // does count — the student went. The grid and the quarter review both
  // count through passValue(), so they always agree.
  const passValue = (t) => (t.manual
    ? (Number(t.count) || 0)
    : (t.in_at || t.date < todayKey() ? 1 : 0));
  const usedIn = (sid, q) => history
    .filter((t) => t.student_id === sid && tripQuarter(t) === q)
    .reduce((s, t) => s + passValue(t), 0);
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

    grid.innerHTML = students.map((s) => {
      const out = outOf(s.id);
      // completed passes only (on a past day an unended trip already counts
      // in usedIn — take it back out so it shows once, as the pending box)
      const usedDone = usedIn(s.id, q) - (out ? passValue(out) : 0);
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
        ? `${s.name} is out — end their timer in the Out now panel`
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

  // The Out-now panel never hides — an empty one keeps the row the same
  // height, so nothing below it jumps when a student leaves or comes back.
  function renderOutStrip() {
    const cards = $('br-out-cards');
    const out = outTrips();
    $('br-out-count').textContent = out.length;
    $('br-out-max').textContent = ` / ${settings.maxOut}`;
    $('br-out-none').hidden = out.length > 0;
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

  // "Today" reads as Today; any other day as "Mon, Sep 21".
  function dayLabel(ymd) {
    if (ymd === todayKey()) return 'Today';
    const d = new Date(`${ymd}T00:00`);
    return Number.isNaN(d.getTime())
      ? ymd
      : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function renderDayNav() {
    const today = isToday();
    $('br-day-label').textContent = dayLabel(date);
    $('br-day-label').disabled = today;
    $('br-next-day').disabled = today;   // nothing is logged in the future
    $('br-date').value = date;
  }

  function renderLogPanel() {
    renderDayNav();
    const timed = trips.filter(isTrip);
    // Newest first: name · out → back · duration · remove
    $('br-log-list').innerHTML = timed.slice().reverse().map((t) => {
      const s = studentById(t.student_id);
      let times, dur;
      if (!t.in_at)            { times = `${fmtClock(t.out_at)} → —`;                    dur = 'out now'; }
      else if (isQuickTap(t))  { times = fmtClock(t.out_at);                              dur = 'quick tap'; }
      else                     { times = `${fmtClock(t.out_at)} → ${fmtClock(t.in_at)}`;  dur = fmtDur(elapsedSec(t)); }
      return `<li>
        <span class="br-log-name">${escapeHtml(s ? s.name : '?')}</span>
        <span class="br-log-times">${escapeHtml(times)}</span>
        <span class="br-log-dur">${escapeHtml(dur)}</span>
        <button type="button" class="link br-del" data-trip="${t.id}" title="Delete this trip">×</button>
      </li>`;
    }).join('') || `<li class="none">No trips ${isToday() ? 'yet today' : `on ${dayLabel(date)}`}.</li>`;
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
    if (outOf(sid)) { setStatus(`${student.name} is already out — end their timer in the Out now panel.`, 'info'); return; }
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

  // History opens the quarter review dialog (built further down).
  $('br-hist-btn').addEventListener('click', () => openReview());

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

  // ---------- quarter review ----------
  // Its own data, separate from the grid's: one fetch per quarter across
  // every period (getBathroomQuarter), counted with the same passValue() and
  // the same quarter dates (activeQuarters → Settings) as the grid. A trip's
  // quarter comes from its date, so a finished quarter never changes as new
  // ones begin; editing a quarter's dates in Settings re-buckets old trips.
  // Paper-tracker tallies count toward the quarter they're tagged with.
  const rv = { q: null, periodId: null, sort: 'used', dir: 1, studentId: null, rows: [], students: [], seq: 0, loading: false, error: null, msg: '' };

  // The periods the main select offers (the ones you teach), in its order.
  const rvPeriods = () => [...$('br-period').options]
    .filter((o) => o.value)
    .map((o) => ({ id: o.value, name: o.textContent }));
  const rvInScope = () => rvPeriods().filter((p) => rv.periodId === 'all' || p.id === rv.periodId);
  const periodShort = (name) => { const p = parsePeriodName(name || ''); return p ? `P${p.n}` : (name || '?'); };
  const fmtDay = (ymd) => new Date(`${ymd}T00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtMD  = (ymd) => { const [, m, d] = ymd.split('-'); return `${Number(m)}/${Number(d)}`; };
  const fmtRange = (a, b) => {
    const da = new Date(`${a}T00:00`), db = new Date(`${b}T00:00`);
    const md = { month: 'short', day: 'numeric' };
    return `${da.toLocaleDateString([], md)} – ${db.toLocaleDateString([], { ...md, year: 'numeric' })}`;
  };
  const fmtMins = (sec) => `${Math.round(sec / 60)} min`;

  function quarterRange(q) {
    const qs = activeQuarters(), i = qs.findIndex((x) => x.q === q), next = qs[i + 1];
    return {
      start: qs[i].start, end: qs[i].end,
      // fetch window, matching quarterFor(): days before Q1 count as Q1 and
      // break days after a quarter count toward the quarter that just ended
      from: i === 0 ? null : qs[i].start,
      to: next ? shiftDate(next.start, -1) : null,
    };
  }

  // One entry per student in scope (zeros included), roster order.
  function rvStats() {
    const scope = new Set(rvInScope().map((p) => p.id));
    const by = new Map(rv.students
      .filter((s) => scope.has(s.period_id))
      .map((s) => [s.id, { s, used: 0, logged: 0, paper: 0, sec: 0, trips: [] }]));
    for (const t of rv.rows) {
      const b = by.get(t.student_id);
      if (!b || tripQuarter(t) !== rv.q) continue;
      b.used += passValue(t);
      if (t.manual) { b.paper += Number(t.count) || 0; continue; }
      b.trips.push(t);
      if (passValue(t)) b.logged++;
      if (t.in_at && !isQuickTap(t)) b.sec += elapsedSec(t);
    }
    return [...by.values()];
  }

  function rvSorted(list) {
    const order = new Map(rvPeriods().map((p, i) => [p.id, i]));
    const byName = (a, b) => a.s.name.localeCompare(b.s.name);
    const cmp = {
      used:   (a, b) => b.used - a.used || byName(a, b),
      name:   byName,
      period: (a, b) => order.get(a.s.period_id) - order.get(b.s.period_id) || byName(a, b),
    }[rv.sort] || byName;
    return list.slice().sort((a, b) => cmp(a, b) * rv.dir);
  }

  function passBoxes(n) {
    const lim = settings.passLimit;
    if (!lim) return `<span class="br-pass-unlimited">${n}</span>`;
    const boxes = Array.from({ length: lim }, (_, i) => `<span class="br-pass${i < n ? ' used' : ''}"></span>`).join('');
    return `<span class="br-passes" aria-hidden="true">${boxes}</span>${n > lim ? `<span class="rv-over">+${n - lim}</span>` : ''}`;
  }

  function renderReview() {
    const qs = activeQuarters(), cur = quarterFor(todayKey());
    $('rv-quarters').innerHTML = qs.map((x) => `
      <button type="button" class="br-mode${x.q === rv.q ? ' active' : ''}" data-q="${x.q}" aria-pressed="${x.q === rv.q}"
        title="${escapeHtml(fmtRange(x.start, x.end))}${x.q === cur ? ' · current quarter' : ''}">${x.q}${x.q === cur ? '<span class="rv-now" aria-hidden="true"></span>' : ''}</button>`).join('');
    const r = quarterRange(rv.q);
    $('rv-range').innerHTML = `${rv.q} · ${escapeHtml(fmtRange(r.start, r.end))} <span class="rv-src">quarter dates from Settings</span>`
      + (rv.msg ? ` <span class="rv-msg">${escapeHtml(rv.msg)}</span>` : '');
    const busy = rv.loading || !!rv.error;
    $('rv-csv').disabled = busy;
    $('rv-print').disabled = busy;
    $('rv-csv').title = rv.studentId ? "Export this student's trips" : 'Export this summary';

    const body = $('rv-body');
    if (rv.error) { body.innerHTML = `<p class="rv-empty error">Couldn't load the log: ${escapeHtml(rv.error)}</p>`; return; }
    if (rv.loading) { body.innerHTML = '<p class="rv-empty">Loading…</p>'; return; }
    body.innerHTML = rv.studentId ? reviewDetailHtml() : reviewSummaryHtml();
  }

  function reviewSummaryHtml() {
    const list = rvStats(), lim = settings.passLimit, all = rv.periodId === 'all';
    const total = list.reduce((n, b) => n + b.used, 0);
    const maxed = lim ? list.filter((b) => b.used >= lim).length : null;
    const never = list.filter((b) => b.used === 0).length;
    const avg = list.length ? total / list.length : 0;
    const pName = new Map(rvPeriods().map((p) => [p.id, p.name]));
    const head = (key, label) => {
      const on = rv.sort === key;
      const down = on && (key === 'used' ? rv.dir === 1 : rv.dir === -1);
      return `<th${on ? ` aria-sort="${down ? 'descending' : 'ascending'}"` : ''}>
        <button type="button" class="rv-sort${on ? ' on' : ''}" data-sort="${key}">${label}<span class="rv-arrow" aria-hidden="true">${on ? (down ? '▾' : '▴') : ''}</span></button></th>`;
    };
    const rows = rvSorted(list).map((b) => {
      const cls = lim && b.used >= lim ? 'maxed' : (b.used === 0 ? 'zero' : '');
      const parts = [b.logged && `${b.logged} logged`, b.paper && `${b.paper} paper`].filter(Boolean);
      return `<tr class="${cls}">
        <td><button type="button" class="rv-who" data-student="${b.s.id}">${escapeHtml(b.s.name)}</button></td>
        ${all ? `<td class="rv-mono" title="${escapeHtml(pName.get(b.s.period_id) || '')}">${escapeHtml(periodShort(pName.get(b.s.period_id)))}</td>` : ''}
        <td class="rv-used">${passBoxes(b.used)}<span class="rv-n">${b.used}${lim ? `/${lim}` : ''}</span></td>
        <td class="rv-mono">${parts.join(' · ') || '—'}</td>
        <td class="rv-mono">${b.sec ? fmtMins(b.sec) : '—'}</td>
      </tr>`;
    }).join('');
    return `
      <div class="rv-stats">
        <div class="rv-stat"><b>${maxed ?? '—'}</b><span>${lim ? `used all ${lim}` : 'no pass limit set'}</span></div>
        <div class="rv-stat"><b>${never}</b><span>never used one</span></div>
        <div class="rv-stat"><b>${avg.toFixed(1)}</b><span>${all ? 'average' : 'class average'}${lim ? ` of ${lim}` : ''}</span></div>
        <div class="rv-stat"><b>${total}</b><span>passes · ${list.length} student${list.length === 1 ? '' : 's'}</span></div>
      </div>
      <div class="rv-table-wrap">
        <table class="rv-table">
          <thead><tr>${head('name', 'Student')}${all ? head('period', 'Period') : ''}${head('used', 'Passes')}<th>Trips</th><th>Time out</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="${all ? 5 : 4}" class="rv-empty">No students${all ? '' : ' in this period'}.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="rv-hint">Click a name for that student's trips. "Paper" = passes from the paper tracker, which have no date or time.</p>`;
  }

  function reviewDetailHtml() {
    const b = rvStats().find((x) => x.s.id === rv.studentId);
    if (!b) return '<p class="rv-empty">That student isn\'t in this period.</p><button type="button" class="link" id="rv-back">← All students</button>';
    const lim = settings.passLimit;
    const pName = (rvPeriods().find((p) => p.id === b.s.period_id) || {}).name || '';
    const trips = b.trips.slice().sort((x, y) => String(x.out_at).localeCompare(String(y.out_at)));
    const timed = trips.filter((t) => t.in_at && !isQuickTap(t));
    const rows = trips.map((t) => {
      let back, dur;
      if (!t.in_at)          { back = passValue(t) ? 'never ended' : 'out now'; dur = '—'; }
      else if (isQuickTap(t)) { back = '—'; dur = 'quick tap'; }
      else                   { back = fmtClock(t.in_at); dur = fmtDur(elapsedSec(t)); }
      return `<tr><td>${escapeHtml(fmtDay(t.date))}</td><td class="rv-mono">${escapeHtml(fmtClock(t.out_at))}</td>
        <td class="rv-mono">${escapeHtml(back)}</td><td class="rv-mono">${escapeHtml(dur)}</td></tr>`;
    }).join('');
    return `
      <div class="rv-detail-head">
        <button type="button" class="link" id="rv-back">← All students</button>
        <h4>${escapeHtml(b.s.name)}</h4>
        <span class="pct" title="${escapeHtml(pName)}">${escapeHtml(periodShort(pName))}</span>
        <span class="rv-used">${passBoxes(b.used)}<span class="rv-n">${b.used}${lim ? `/${lim}` : ''} used in ${rv.q}</span></span>
      </div>
      <div class="br-hist-manual">
        <span class="hud-key">${rv.q} paper tally</span>
        <button type="button" class="small" data-adj="-1" aria-label="Remove one paper pass"${b.paper ? '' : ' disabled'}>−</button>
        <span class="br-manual-n">${b.paper}</span>
        <button type="button" class="small" data-adj="1" aria-label="Add one paper pass">+</button>
        <span class="rv-src">passes from the paper tracker (no date or time)</span>
      </div>
      <div class="rv-table-wrap">
        <table class="rv-table">
          <thead><tr><th>Date</th><th>Out</th><th>Back</th><th>Duration</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="rv-empty">No logged trips in ${rv.q}.</td></tr>`}</tbody>
        </table>
      </div>
      ${timed.length ? `<p class="rv-hint">${timed.length} timed trip${timed.length === 1 ? '' : 's'} · ${fmtMins(b.sec)} out in total · ${fmtDur(Math.round(b.sec / timed.length))} average</p>` : ''}`;
  }

  async function rvLoad() {
    const seq = ++rv.seq;
    rv.loading = true; rv.error = null; rv.msg = '';
    renderReview();
    const r = quarterRange(rv.q);
    try {
      const [rows, studs] = await Promise.all([
        getBathroomQuarter(rv.q, r.from, r.to),
        rv.students.length ? rv.students : getAllStudents(),
      ]);
      if (seq !== rv.seq) return;
      rv.rows = rows; rv.students = studs;
    } catch (err) {
      if (seq !== rv.seq) return;
      rv.rows = []; rv.error = err.message || String(err);
    }
    rv.loading = false;
    renderReview();
  }

  function openReview() {
    const ps = rvPeriods();
    $('rv-period').innerHTML = '<option value="all">All periods</option>'
      + ps.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    rv.periodId = ps.some((p) => p.id === periodId) ? periodId : 'all';
    $('rv-period').value = rv.periodId;
    rv.q = quarterFor(todayKey());
    rv.sort = 'used'; rv.dir = 1; rv.studentId = null;
    rv.students = [];   // re-read the rosters each time it opens
    rvLoad();           // renders the quarter buttons synchronously, so…
    $('br-review').showModal();
    root.querySelector('#rv-quarters .active')?.focus();   // …focus lands on the open quarter
  }

  async function rvAdjustTally(delta) {
    const s = rv.students.find((x) => x.id === rv.studentId);
    if (!s) return;
    const isTally = (t) => t.student_id === s.id && t.manual && t.quarter === rv.q;
    const row = rv.rows.find(isTally);
    const next = Math.max(0, (row ? Number(row.count) || 0 : 0) + delta);
    try {
      const saved = await setManualTally(s.period_id, s.id, rv.q, next);
      rv.rows = rv.rows.filter((t) => !isTally(t));
      if (saved) rv.rows.push(saved);
      if (s.period_id === periodId) {          // keep the grid behind in step
        history = history.filter((t) => !isTally(t));
        if (saved) history.unshift(saved);
        renderGrid();
      }
      rv.msg = '';
    } catch (err) { rv.msg = `Couldn't save: ${err.message || err}`; }
    renderReview();
  }

  $('rv-quarters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (!b || b.dataset.q === rv.q) return;
    rv.q = b.dataset.q;   // an open student stays open: same student, other quarter
    rvLoad();
  });
  $('rv-period').addEventListener('change', (e) => {
    rv.periodId = e.target.value;
    rv.studentId = null;
    if (rv.sort === 'period' && rv.periodId !== 'all') { rv.sort = 'used'; rv.dir = 1; }
    renderReview();
  });
  $('rv-body').addEventListener('click', (e) => {
    const who = e.target.closest('.rv-who');
    if (who) { rv.studentId = who.dataset.student; renderReview(); $('rv-back')?.focus(); return; }
    const sort = e.target.closest('.rv-sort');
    if (sort) {
      if (rv.sort === sort.dataset.sort) rv.dir = -rv.dir;
      else { rv.sort = sort.dataset.sort; rv.dir = 1; }
      renderReview();
      root.querySelector(`.rv-sort[data-sort="${rv.sort}"]`)?.focus();
      return;
    }
    if (e.target.closest('#rv-back')) {
      const sid = rv.studentId;
      rv.studentId = null; renderReview();
      root.querySelector(`.rv-who[data-student="${sid}"]`)?.focus();
      return;
    }
    const adj = e.target.closest('[data-adj]');
    if (adj) rvAdjustTally(Number(adj.dataset.adj));
  });
  $('rv-close').addEventListener('click', () => $('br-review').close());

  // ---- CSV ----
  // Cells starting with = + - @ are prefixed with ' so a spreadsheet never
  // runs a student name as a formula.
  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  function downloadCsv(name, rows) {
    const text = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const fileSafe = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();

  $('rv-csv').addEventListener('click', () => {
    const r = quarterRange(rv.q), lim = settings.passLimit;
    const pName = new Map(rvPeriods().map((p) => [p.id, p.name]));
    if (rv.studentId) {
      const b = rvStats().find((x) => x.s.id === rv.studentId);
      if (!b) return;
      const per = pName.get(b.s.period_id) || '';
      const out = [['Student', 'Period', 'Quarter', 'Date', 'Out', 'Back', 'Minutes out', 'Type']];
      if (b.paper) out.push([b.s.name, per, rv.q, '', '', '', '', `paper tally: ${b.paper} pass${b.paper === 1 ? '' : 'es'}`]);
      b.trips.slice().sort((x, y) => String(x.out_at).localeCompare(String(y.out_at))).forEach((t) => {
        const quick = isQuickTap(t);
        out.push([b.s.name, per, rv.q, t.date, fmtClock(t.out_at),
          t.in_at && !quick ? fmtClock(t.in_at) : '',
          t.in_at && !quick ? (elapsedSec(t) / 60).toFixed(1) : '',
          !t.in_at ? (passValue(t) ? 'timer never ended' : 'out now') : (quick ? 'quick tap' : 'timed')]);
      });
      out.push([], [`Passes used in ${rv.q} (${r.start} to ${r.end})`, `${b.used}${lim ? ` of ${lim}` : ''}`]);
      downloadCsv(`bathroom-${rv.q}-${fileSafe(b.s.name)}.csv`, out);
      return;
    }
    const out = [['Quarter', 'Quarter start', 'Quarter end', 'Period', 'Student', 'Passes used', 'Pass limit', 'Logged trips', 'Paper tally', 'Minutes out']];
    rvSorted(rvStats()).forEach((b) => out.push([rv.q, r.start, r.end, pName.get(b.s.period_id) || '', b.s.name,
      b.used, lim || '', b.logged, b.paper, Math.round(b.sec / 60)]));
    const scope = rv.periodId === 'all' ? 'all-periods' : fileSafe(pName.get(rv.periodId) || 'period');
    downloadCsv(`bathroom-${rv.q}-${scope}.csv`, out);
  });

  // ---- print: the paper-tracker sheet ----
  // One page per period: # · student · one box per pass (the date it was
  // used, ✓ for a paper-tracker pass) · total. Roster order, like the paper
  // sheet. Printed from a hidden iframe so none of the app's dark theme or
  // layout reaches the page.
  $('rv-print').addEventListener('click', () => {
    const r = quarterRange(rv.q), lim = settings.passLimit;
    const stats = new Map(rvStats().map((b) => [b.s.id, b]));
    const marksOf = (b) => [
      ...Array(b.paper).fill('✓'),
      ...b.trips.filter((t) => passValue(t))
        .sort((x, y) => String(x.out_at).localeCompare(String(y.out_at)))
        .map((t) => fmtMD(t.date)),
    ];
    const cols = lim || Math.max(4, ...[...stats.values()].map((b) => b.used));
    const today = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const sections = rvInScope().map((p) => {
      const roster = rv.students.filter((s) => s.period_id === p.id).map((s) => stats.get(s.id)).filter(Boolean);
      const body = roster.map((b, i) => {
        const marks = marksOf(b);
        const cells = Array.from({ length: cols }, (_, k) => `<td class="pass">${escapeHtml(marks[k] || '')}</td>`).join('');
        const over = b.used > cols ? ` (+${b.used - cols})` : '';
        return `<tr${lim && b.used >= lim ? ' class="maxed"' : ''}><td class="num">${i + 1}</td><td class="name">${escapeHtml(b.s.name)}</td>${cells}<td class="total">${b.used}${over}</td></tr>`;
      }).join('') || `<tr><td colspan="${cols + 3}">No students.</td></tr>`;
      return `<section>
        <header>
          <div><h1>Bathroom Pass Tracker</h1><div class="per">${escapeHtml(p.name)}</div></div>
          <div class="meta"><b>${rv.q}</b> · ${escapeHtml(fmtRange(r.start, r.end))}<br>${escapeHtml(displayName())}</div>
        </header>
        <table>
          <thead><tr><th class="num">#</th><th class="name">Student</th>${Array.from({ length: cols }, (_, k) => `<th>Pass ${k + 1}</th>`).join('')}<th class="total">Total</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
        <footer><span>Each box: the date the pass was used · ✓ = from the paper tracker (no date)</span><span>Printed ${escapeHtml(today)}</span></footer>
      </section>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bathroom passes ${rv.q}</title><style>
      @page { size: letter portrait; margin: 0.5in; }
      * { box-sizing: border-box; }
      body { margin: 0; font: 11pt Arial, Helvetica, sans-serif; color: #000; background: #fff; }
      section { break-after: page; page-break-after: always; }
      section:last-child { break-after: auto; page-break-after: auto; }
      header { display: flex; justify-content: space-between; align-items: flex-end; gap: 12pt; border-bottom: 2pt solid #000; padding-bottom: 4pt; margin-bottom: 8pt; }
      h1 { margin: 0; font-size: 16pt; }
      .per { font-size: 12pt; margin-top: 2pt; }
      .meta { text-align: right; font-size: 10pt; line-height: 1.4; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1pt solid #000; padding: 2pt 5pt; height: 19pt; }
      th { font-size: 9pt; background: #e8e8e8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .num { width: 24pt; text-align: center; color: #333; }
      th.name, td.name { width: 40%; text-align: left; }
      td.pass { text-align: center; font-size: 10pt; }
      .total { width: 48pt; text-align: center; font-weight: bold; }
      tr.maxed td { background: #e8e8e8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tr { break-inside: avoid; }
      footer { display: flex; justify-content: space-between; margin-top: 6pt; font-size: 8.5pt; color: #333; }
    </style></head><body>${sections}</body></html>`;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open(); doc.write(html); doc.close();
    const w = frame.contentWindow;
    w.addEventListener('afterprint', () => frame.remove());
    setTimeout(() => frame.remove(), 120000);   // in case afterprint never fires
    w.focus(); w.print();
  });

  // ---------- period / date ----------
  // The bell is followed automatically — there is no AUTO button. Picking a
  // period by hand stops it for the rest of the session, so your choice isn't
  // yanked away at the next bell; a reload goes back to following.
  function selectPeriod(id, { manual = false } = {}) {
    if (manual) followBell = false;
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
  // ---------- day switcher (Log panel header) ----------
  // The date drives the student grid as well as the log, so every path here
  // goes through one function that reloads the day.
  function goToDate(ymd) {
    if (!ymd || ymd === date) return;
    date = ymd;
    renderDayNav();
    load();
  }
  const shiftDate = (ymd, days) => {
    const d = new Date(`${ymd}T00:00`);
    d.setDate(d.getDate() + days);
    return dateKey(d);
  };
  $('br-date').value = date;
  $('br-date').addEventListener('change', (e) => goToDate(e.target.value));
  $('br-prev-day').addEventListener('click', () => goToDate(shiftDate(date, -1)));
  $('br-next-day').addEventListener('click', () => goToDate(shiftDate(date, 1)));
  $('br-day-label').addEventListener('click', () => goToDate(todayKey()));
  $('br-cal-btn').addEventListener('click', () => {
    const el = $('br-date');
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    // No showPicker (or it refused): reveal the real input instead.
    el.closest('.br-cal').classList.add('bare');
    el.focus();
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
