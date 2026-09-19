// bathroom.js — the Bathroom Tracker screen. Click a student to sign them out
// (timestamped), click again to sign them back in; elapsed time counts live;
// anyone out longer than the flag limit turns red; a cap limits how many can
// be out at once; per-student history shows who goes constantly.
// Data through shared.js (bathroom_log); settings in localStorage.

function initBathroom({ mount = '#bathroom' } = {}) {
  const root = document.querySelector(mount);
  if (!root) return;
  const $ = (id) => root.querySelector(`#${id}`);
  const TICKS = '<span class="tick tl" aria-hidden="true"></span><span class="tick tr" aria-hidden="true"></span><span class="tick bl" aria-hidden="true"></span><span class="tick br" aria-hidden="true"></span>';
  const SETTINGS_KEY = 'teacherpal.bathroom.settings';
  let settings = { flagMinutes: 8, maxOut: 2, passLimit: 4 };   // passLimit = passes per quarter
  try { settings = { ...settings, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }; } catch { /* ignore */ }
  const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

  root.innerHTML = `
    <section class="hud-box br-main" aria-label="Students" style="--i:0">
      ${TICKS}
      <div class="dash-head">
        <label class="dash-field"><span class="hud-key">PERIOD</span><select id="br-period" aria-label="Period"></select></label>
        <button type="button" class="hud-chip" id="br-follow" aria-pressed="true" title="Follow the bell schedule">AUTO</button>
        <label class="dash-field"><span class="hud-key">DATE</span><input type="date" id="br-date" aria-label="Date"></label>
        <button type="button" class="hud-chip" id="br-today" hidden>TODAY</button>
        <span class="spacer"></span>
        <label class="dash-field" title="Flag anyone out longer than this"><span class="hud-key">FLAG AFTER</span><input type="number" id="br-flag" min="1" max="60" value="${settings.flagMinutes}"><span class="hud-key">MIN</span></label>
        <label class="dash-field" title="How many students may be out at once"><span class="hud-key">MAX OUT</span><input type="number" id="br-max" min="1" max="10" value="${settings.maxOut}"></label>
        <label class="dash-field" title="Passes allowed per student per quarter"><span class="hud-key">PASSES /</span><span class="hud-val" id="br-quarter">Q1</span><input type="number" id="br-limit" min="0" max="20" value="${settings.passLimit}"></label>
        <button type="button" class="hud-chip" data-fullscreen aria-pressed="false" title="Full screen (F)"><span class="when-off">EXPAND</span><span class="when-on">EXIT</span></button>
      </div>
      <div class="br-status"><span class="hud-key">OUT NOW</span><span class="hud-val" id="br-out-count">0</span><span class="hud-key">OF</span><span class="hud-val" id="br-max-val">${settings.maxOut}</span><span class="spacer"></span><span class="hud-val hud-quiet" id="br-hint">Click a name to sign out · click again to sign in · n/${settings.passLimit} = passes used this quarter</span></div>
      <div class="br-tiles" id="br-tiles"></div>
      <div class="chart-empty" id="br-empty" hidden></div>
    </section>

    <aside class="br-side">
      <section class="hud-box br-out" aria-label="Out now" style="--i:1">
        ${TICKS}
        <h3><span class="hud-key">OUT NOW</span></h3>
        <ul class="br-list" id="br-out-list"></ul>
      </section>
      <section class="hud-box br-log" aria-label="Log" style="--i:2">
        ${TICKS}
        <h3><span class="hud-key">LOG</span><span class="hud-val" id="br-log-date"></span></h3>
        <ul class="br-list" id="br-log-list"></ul>
      </section>
      <section class="hud-box br-freq" aria-label="Frequent" style="--i:3">
        ${TICKS}
        <h3><span class="hud-key">HISTORY</span><span class="hud-val hud-quiet" id="br-hist-title">ALL DATES · THIS PERIOD</span></h3>
        <ul class="br-list" id="br-freq-list"></ul>
        <div class="br-history" id="br-history" hidden></div>
      </section>
    </aside>`;

  // ---------- state ----------
  let periods = [], byNumber = new Map();
  let periodId = null, date = todayKey();
  let students = [];
  let trips = [];                // today's rows for this period
  let history = [];              // all rows for this period (all dates)
  let followBell = true, loadSeq = 0;
  const studentById = (id) => students.find((s) => s.id === id);
  const isToday = () => date === todayKey();
  const quarter = () => quarterOf(date);                       // the quarter of the day being viewed
  const isTrip = (t) => !t.manual;                               // manual rows are tallies, not timed trips
  const tripQuarter = (t) => (t.manual ? t.quarter : quarterOf(t.date));
  // passes used by a student in a quarter = manual tally count + timed trips
  const usedIn = (sid, q) => history.filter((t) => t.student_id === sid && tripQuarter(t) === q).reduce((s, t) => s + (t.manual ? (Number(t.count) || 0) : 1), 0);
  const outTrips = () => trips.filter((t) => isTrip(t) && !t.in_at);
  const outOf = (sid) => outTrips().find((t) => t.student_id === sid);
  const elapsedSec = (t, now = Date.now()) => Math.max(0, Math.floor(((t.in_at ? new Date(t.in_at).getTime() : now) - new Date(t.out_at).getTime()) / 1000));
  const fmtDur = (s) => { const m = Math.floor(s / 60), sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}`; };
  const fmtClock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const flagged = (t) => !t.in_at && elapsedSec(t) >= settings.flagMinutes * 60;

  // ---------- rendering ----------
  function renderTiles() {
    const tiles = $('br-tiles'), empty = $('br-empty');
    empty.hidden = students.length > 0;
    tiles.hidden = students.length === 0;
    if (!periodId) { empty.hidden = false; empty.innerHTML = periods.length ? '<p>Pick a period.</p>' : '<p>No periods yet.</p><a class="hud-chip" href="roster.html">Set up rosters</a>'; return; }
    if (!students.length) { empty.innerHTML = '<p>No students in this period.</p><a class="hud-chip" href="roster.html">Add students</a>'; return; }
    const q = quarter();
    $('br-quarter').textContent = q;
    tiles.innerHTML = students.map((s) => {
      const out = outOf(s.id);
      const used = usedIn(s.id, q);
      const blocked = !out && settings.passLimit > 0 && used >= settings.passLimit;
      const cls = 'br-tile' + (out ? ' out' : '') + (out && flagged(out) ? ' flagged' : '') + (blocked ? ' blocked' : '') + (!blocked && settings.passLimit > 0 && used === settings.passLimit - 1 ? ' last' : '');
      return `<button type="button" class="${cls}" data-student="${s.id}" title="${escapeHtml(s.name)} · ${used}/${settings.passLimit} passes used in ${q}">
        <span class="br-name">${escapeHtml(s.name)}</span>
        <span class="br-meta">${out ? `<span class="br-elapsed" data-trip="${out.id}">${fmtDur(elapsedSec(out))}</span>` : `<span class="br-used">${used}/${settings.passLimit}</span>`}</span>
      </button>`;
    }).join('');
  }
  function renderSide() {
    const out = outTrips();
    $('br-out-count').textContent = out.length;
    $('br-max-val').textContent = settings.maxOut;
    $('br-out-list').innerHTML = out.map((t) => {
      const s = studentById(t.student_id);
      return `<li class="${flagged(t) ? 'flagged' : ''}"><span>${escapeHtml(s ? s.name : '?')}</span><span class="br-elapsed at" data-trip="${t.id}">${fmtDur(elapsedSec(t))}</span></li>`;
    }).join('') || '<li class="none">nobody out</li>';
    $('br-log-date').textContent = isToday() ? 'TODAY' : date;
    $('br-log-list').innerHTML = trips.filter(isTrip).slice().reverse().map((t) => {
      const s = studentById(t.student_id);
      return `<li><span>${escapeHtml(s ? s.name : '?')}</span><span class="at">${fmtClock(t.out_at)}${t.in_at ? ` → ${fmtClock(t.in_at)} · ${fmtDur(elapsedSec(t))}` : ' · out'}</span><button type="button" class="link br-del" data-trip="${t.id}" title="Delete this trip">×</button></li>`;
    }).join('') || '<li class="none">no trips</li>';
    renderFreq();
  }
  function renderFreq() {
    const q = quarter();
    $('br-hist-title').textContent = `${q} · THIS PERIOD`;
    const by = new Map();
    for (const t of history) {
      if (tripQuarter(t) !== q) continue;
      const b = by.get(t.student_id) || { used: 0, trips: 0, manual: 0, sec: 0, days: new Set() };
      if (t.manual) { b.manual += Number(t.count) || 0; b.used += Number(t.count) || 0; }
      else { b.trips++; b.used++; b.sec += elapsedSec(t); b.days.add(t.date); }
      by.set(t.student_id, b);
    }
    const rows = [...by.entries()].map(([sid, b]) => ({ sid, ...b, name: (studentById(sid) || {}).name || '?' })).filter((r) => r.used > 0).sort((a, b) => b.used - a.used);
    $('br-freq-list').innerHTML = rows.map((r) => {
      const at = [`${r.used}/${settings.passLimit}`, r.trips ? `${r.trips} timed · ${Math.round(r.sec / 60)} min` : '', r.manual ? `${r.manual} manual` : ''].filter(Boolean).join(' · ');
      return `<li class="${settings.passLimit > 0 && r.used >= settings.passLimit ? 'flagged' : ''}"><button type="button" class="link br-who" data-student="${r.sid}">${escapeHtml(r.name)}</button><span class="at">${at}</span></li>`;
    }).join('') || '<li class="none">no passes used yet</li>';
  }
  function showHistory(sid) {
    const box = $('br-history');
    const s = studentById(sid);
    const q = quarter();
    const rows = history.filter((t) => t.student_id === sid && !t.manual);
    const manual = history.find((t) => t.student_id === sid && t.manual && t.quarter === q);
    const manualCount = manual ? Number(manual.count) || 0 : 0;
    box.hidden = false;
    box.innerHTML = `<h4>${escapeHtml(s ? s.name : '?')} <button type="button" class="link" id="br-history-close">close</button></h4>
      <div class="br-manual"><span class="hud-key">${q} MANUAL TALLY</span>
        <button type="button" class="small" data-adj="-1" aria-label="Minus one">−</button>
        <span class="hud-val" id="br-manual-n">${manualCount}</span>
        <button type="button" class="small" data-adj="1" aria-label="Plus one">+</button>
        <span class="hud-key">USED ${usedIn(sid, q)}/${settings.passLimit}</span></div>
      <ul class="br-list">${rows.map((t) => `<li><span>${t.date}</span><span class="at">${fmtClock(t.out_at)}${t.in_at ? ` → ${fmtClock(t.in_at)} · ${fmtDur(elapsedSec(t))}` : ' · out'}</span></li>`).join('') || '<li class="none">no timed trips</li>'}</ul>`;
    box.querySelector('#br-history-close').addEventListener('click', () => { box.hidden = true; });
    box.querySelectorAll('[data-adj]').forEach((b) => b.addEventListener('click', async () => {
      const next = Math.max(0, (history.find((t) => t.student_id === sid && t.manual && t.quarter === q) || { count: 0 }).count * 1 + Number(b.dataset.adj));
      try {
        const row = await setManualTally(periodId, sid, q, next);
        history = history.filter((t) => !(t.student_id === sid && t.manual && t.quarter === q));
        if (row) history.unshift(row);
      } catch (err) { showError(err); return; }
      renderTiles(); renderSide(); showHistory(sid);
    }));
  }
  // live elapsed times, once a second
  setInterval(() => {
    const now = Date.now();
    root.querySelectorAll('[data-trip].br-elapsed').forEach((el) => { const t = trips.find((x) => x.id === el.dataset.trip); if (t) el.textContent = fmtDur(elapsedSec(t, now)); });
    root.querySelectorAll('.br-tile.out').forEach((el) => { const t = outOf(el.dataset.student); el.classList.toggle('flagged', !!t && flagged(t)); });
    root.querySelectorAll('#br-out-list li').forEach((li, i) => { const t = outTrips()[i]; if (t) li.classList.toggle('flagged', flagged(t)); });
  }, 1000);

  // ---------- actions ----------
  $('br-tiles').addEventListener('click', async (e) => {
    const tile = e.target.closest('[data-student]'); if (!tile) return;
    const sid = tile.dataset.student;
    const out = outOf(sid);
    try {
      if (out) {
        const saved = await bathroomSignIn(out.id);
        Object.assign(out, saved);
        history = history.map((t) => (t.id === out.id ? out : t));
        setStatus(`${studentById(sid).name} back · ${fmtDur(elapsedSec(out))}.`, 'ok');
      } else {
        if (outTrips().length >= settings.maxOut) { setStatus(`${settings.maxOut} already out — wait for someone to come back.`, 'error'); return; }
        const used = usedIn(sid, quarter());
        if (settings.passLimit > 0 && used >= settings.passLimit) { setStatus(`${studentById(sid).name} has used ${used} of ${settings.passLimit} passes in ${quarter()} — no more this quarter (raise PASSES / ${quarter()} to override).`, 'error'); return; }
        const row = await bathroomSignOut(periodId, sid, date);
        trips.push(row); history.unshift(row);
        setStatus(`${studentById(sid).name} out at ${fmtClock(row.out_at)}.`, 'info');
      }
    } catch (err) { showError(err); return; }
    renderTiles(); renderSide();
  });
  $('br-log-list').addEventListener('click', async (e) => {
    const b = e.target.closest('.br-del'); if (!b) return;
    const t = trips.find((x) => x.id === b.dataset.trip); if (!t) return;
    if (!confirm(`Delete ${(studentById(t.student_id) || {}).name}'s trip at ${fmtClock(t.out_at)}?`)) return;
    try { await deleteBathroomTrip(t.id); } catch (err) { showError(err); return; }
    trips = trips.filter((x) => x !== t); history = history.filter((x) => x.id !== t.id);
    renderTiles(); renderSide();
  });
  $('br-freq-list').addEventListener('click', (e) => { const b = e.target.closest('.br-who'); if (b) showHistory(b.dataset.student); });
  $('br-flag').addEventListener('change', (e) => { settings.flagMinutes = Math.max(1, Number(e.target.value) || 8); saveSettings(); renderTiles(); renderSide(); });
  $('br-max').addEventListener('change', (e) => { settings.maxOut = Math.max(1, Number(e.target.value) || 2); saveSettings(); renderSide(); });
  $('br-limit').addEventListener('change', (e) => { settings.passLimit = Math.max(0, Number(e.target.value) || 0); saveSettings(); renderTiles(); renderSide(); });

  // ---------- period / date ----------
  function selectPeriod(id, { manual = false } = {}) {
    if (manual) { followBell = false; $('br-follow').setAttribute('aria-pressed', 'false'); }
    if (id === periodId) { if (!id) { renderTiles(); renderSide(); } return; }
    periodId = id; $('br-period').value = id || ''; setLastPeriodId(id);
    load();
  }
  function followTheBell(d, sched) {
    if (!followBell || !isToday() || !byNumber.size) return;
    const n = suggestedPeriod(d, sched, (k) => byNumber.has(k));
    if (n !== null && byNumber.get(n).id !== periodId) selectPeriod(byNumber.get(n).id);
  }
  document.addEventListener('teacherpal:tick', (e) => followTheBell(e.detail.now, e.detail.sched));
  $('br-period').addEventListener('change', (e) => selectPeriod(e.target.value, { manual: true }));
  $('br-follow').addEventListener('click', () => { followBell = !followBell; $('br-follow').setAttribute('aria-pressed', String(followBell)); if (followBell) { const d = new Date(); followTheBell(d, resolveSchedule(d, navState.overrides)); } });
  $('br-date').value = date;
  $('br-date').addEventListener('change', (e) => { if (!e.target.value) return; date = e.target.value; $('br-today').hidden = isToday(); load(); });
  $('br-today').addEventListener('click', () => { date = todayKey(); $('br-date').value = date; $('br-today').hidden = true; load(); });

  async function load() {
    const seq = ++loadSeq;
    students = []; trips = []; history = [];
    $('br-history').hidden = true;
    if (!periodId) { renderTiles(); renderSide(); return; }
    try {
      const [st, tr, hi] = await Promise.all([
        getStudents(periodId),
        getBathroomLog(periodId, date).catch((err) => { setStatus(`Bathroom log unavailable — run migration-lessons-bathroom.sql in the Supabase SQL editor. (${err.message})`, 'error'); return []; }),
        getBathroomHistory(periodId).catch(() => []),
      ]);
      if (seq !== loadSeq) return;
      students = st; trips = tr; history = hi;
    } catch (err) { showError(err); }
    renderTiles(); renderSide();
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
