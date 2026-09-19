// lesson.js — lesson plans. One plan per (period, date):
//   { objective, agenda: [{ id, text, minutes|null, done }], materials, homework, notes }
//
//   initLessonPanel({ mount, follow: false })  Lesson Plans screen: driven by
//                                              panel.show(periodId, date)
//   follow: true would track the attendance view's teacherpal:period event
//   (unused since the hub became a launcher).
//
// Everything is editable inline (plain fields styled as text), autosaved to
// Supabase 800ms after the last edit through shared.js, with a Saved indicator.
// No Supabase calls of its own.

function initLessonPanel({ mount = '#lesson', follow = true, onChange = null } = {}) {
  const root = document.querySelector(mount);
  if (!root) return null;
  const $ = (id) => root.querySelector(`#${id}`);
  const TICKS = '<span class="tick tl" aria-hidden="true"></span><span class="tick tr" aria-hidden="true"></span><span class="tick bl" aria-hidden="true"></span><span class="tick br" aria-hidden="true"></span>';
  const uid = () => Math.random().toString(36).slice(2, 9);
  const fmtDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
  const shiftDate = (ymd, days) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d + days); return dateKey(dt); };
  // previous weekday (Mon → Fri)
  const prevSchoolDay = (ymd) => { let d = shiftDate(ymd, -1); const [y, m, dd] = d.split('-').map(Number); const wd = new Date(y, m - 1, dd).getDay(); if (wd === 0) d = shiftDate(d, -2); else if (wd === 6) d = shiftDate(d, -1); return d; };
  const isEmptyPlan = (p) => !p.objective.trim() && !p.materials.trim() && !p.homework.trim() && !p.notes.trim() && !p.agenda.some((a) => a.text.trim());

  root.classList.add('hud-box', 'lesson-panel');
  root.innerHTML = `
    ${TICKS}
    <div class="lesson-head">
      <span class="hud-stat"><span class="hud-key">LESSON PLAN</span><span class="hud-val" id="lp-title">—</span></span>
      <span class="spacer"></span>
      <span class="hud-stat" id="lp-progress" hidden><span class="hud-key">AGENDA</span><span class="hud-val" id="lp-progress-val"></span></span>
      <span class="save-state hud-mono" id="lp-save" aria-live="polite"></span>
      <button type="button" class="hud-chip" id="lp-copy-period" title="Copy this date's plan from another period">COPY FROM PERIOD</button>
      <button type="button" class="hud-chip" id="lp-copy-prev" title="Copy the previous school day's plan for this period">COPY YESTERDAY</button>
    </div>

    <div class="lesson-empty" id="lp-empty" hidden>
      <p class="lesson-empty-title">No lesson plan yet</p>
      <p class="lesson-empty-sub" id="lp-empty-sub"></p>
      <div class="lesson-empty-actions">
        <button type="button" class="primary" id="lp-add">Add a lesson plan</button>
        <button type="button" id="lp-empty-copy-period">Copy from another period</button>
        <button type="button" id="lp-empty-copy-prev">Copy yesterday's plan</button>
      </div>
    </div>

    <div class="lesson-body" id="lp-body" hidden>
      <section class="lp-field">
        <h4>Objective / learning target</h4>
        <textarea id="lp-objective" class="lp-text lp-objective" rows="1" placeholder="Students will be able to…"></textarea>
      </section>
      <section class="lp-field lp-agenda-field">
        <h4>Agenda <span class="lp-hint">check items off as you go · Enter adds the next</span></h4>
        <ol class="lp-agenda" id="lp-agenda"></ol>
        <button type="button" class="link lp-add-item" id="lp-add-item">+ Add activity</button>
      </section>
      <div class="lp-cols">
        <section class="lp-field">
          <h4>Materials / links</h4>
          <textarea id="lp-materials" class="lp-text" rows="1" placeholder="Slides, handouts, URLs…"></textarea>
        </section>
        <section class="lp-field">
          <h4>Homework</h4>
          <textarea id="lp-homework" class="lp-text" rows="1" placeholder="Due next class…"></textarea>
        </section>
      </div>
      <section class="lp-field">
        <h4>Notes</h4>
        <textarea id="lp-notes" class="lp-text" rows="1" placeholder="Reminders, differentiation, what to bring…"></textarea>
      </section>
    </div>

    <dialog class="lesson-dialog card" id="lp-dialog">
      <form method="dialog" class="lesson-dialog-form">
        <h3 id="lp-dialog-title">Copy from another period</h3>
        <div id="lp-dialog-list" class="lesson-dialog-list"></div>
        <div class="lesson-dialog-actions"><button type="button" id="lp-dialog-close">Cancel</button></div>
      </form>
    </dialog>`;

  // ---------- state ----------
  let periodId = null, date = todayKey();
  let periods = [];
  let plan = EMPTY_PLAN();
  let exists = false;            // a row exists in Supabase
  let saveTimer = null, loadSeq = 0, dirty = false;

  const periodName = (id) => (periods.find((p) => p.id === id) || {}).name || '';

  // ---------- rendering ----------
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; }
  function setSave(state) {
    const el = $('lp-save');
    el.dataset.state = state;
    el.textContent = state === 'saving' ? 'SAVING…' : state === 'saved' ? '● SAVED' : state === 'error' ? 'NOT SAVED' : '';
  }
  function renderHead() {
    $('lp-title').textContent = periodId ? `${periodName(periodId).toUpperCase()} · ${fmtDate(date).toUpperCase()}` : '—';
    const items = plan.agenda.filter((a) => a.text.trim());
    const done = items.filter((a) => a.done).length;
    const mins = items.reduce((s, a) => s + (Number(a.minutes) || 0), 0);
    $('lp-progress').hidden = !items.length;
    $('lp-progress-val').textContent = `${done}/${items.length}${mins ? ` · ${mins} MIN` : ''}`;
  }
  function render() {
    renderHead();
    const empty = !exists && isEmptyPlan(plan);
    $('lp-empty').hidden = !empty;
    $('lp-body').hidden = empty;
    $('lp-empty-sub').textContent = periodId ? `${periodName(periodId)} · ${fmtDate(date)}` : 'Pick a period';
    root.classList.toggle('is-empty', empty);
    if (empty) return;
    for (const k of ['objective', 'materials', 'homework', 'notes']) { const ta = $(`lp-${k}`); if (ta.value !== plan[k]) ta.value = plan[k]; autoGrow(ta); }
    renderAgenda();
  }
  function renderAgenda() {
    const list = $('lp-agenda');
    list.innerHTML = plan.agenda.map((a, i) => `
      <li class="lp-item${a.done ? ' done' : ''}" data-id="${a.id}">
        <input type="checkbox" class="lp-done" ${a.done ? 'checked' : ''} aria-label="Done">
        <span class="lp-num">${i + 1}</span>
        <input type="text" class="lp-item-text" value="${escapeHtml(a.text)}" placeholder="Activity…">
        <input type="number" class="lp-min" min="0" max="300" value="${a.minutes ?? ''}" placeholder="min" aria-label="Minutes">
        <button type="button" class="lp-remove" aria-label="Remove activity" title="Remove">×</button>
      </li>`).join('');
  }

  // ---------- editing ----------
  function markDirty() {
    dirty = true;
    renderHead();
    if (onChange) onChange({ periodId, date, plan });
    scheduleSave();
  }
  for (const k of ['objective', 'materials', 'homework', 'notes']) {
    const ta = $(`lp-${k}`);
    ta.addEventListener('input', () => { plan[k] = ta.value; autoGrow(ta); markDirty(); });
  }
  const itemOf = (el) => plan.agenda.find((a) => a.id === el.closest('.lp-item').dataset.id);
  $('lp-agenda').addEventListener('input', (e) => {
    const a = itemOf(e.target); if (!a) return;
    if (e.target.classList.contains('lp-item-text')) a.text = e.target.value;
    else if (e.target.classList.contains('lp-min')) a.minutes = e.target.value === '' ? null : Number(e.target.value);
    markDirty();
  });
  $('lp-agenda').addEventListener('change', (e) => {
    if (!e.target.classList.contains('lp-done')) return;
    const a = itemOf(e.target); if (!a) return;
    a.done = e.target.checked;
    e.target.closest('.lp-item').classList.toggle('done', a.done);
    markDirty();
  });
  $('lp-agenda').addEventListener('click', (e) => {
    const btn = e.target.closest('.lp-remove'); if (!btn) return;
    const a = itemOf(btn); plan.agenda = plan.agenda.filter((x) => x !== a);
    renderAgenda(); markDirty();
  });
  $('lp-agenda').addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('lp-item-text')) return;
    if (e.key === 'Enter') { e.preventDefault(); const a = itemOf(e.target); addItem(plan.agenda.indexOf(a) + 1); }
    if (e.key === 'Backspace' && e.target.value === '' && plan.agenda.length > 1) {
      e.preventDefault(); const a = itemOf(e.target); const i = plan.agenda.indexOf(a);
      plan.agenda = plan.agenda.filter((x) => x !== a); renderAgenda(); markDirty();
      const prev = $('lp-agenda').querySelectorAll('.lp-item-text')[Math.max(0, i - 1)]; if (prev) prev.focus();
    }
  });
  function addItem(at = plan.agenda.length) {
    plan.agenda.splice(at, 0, { id: uid(), text: '', minutes: null, done: false });
    renderAgenda(); markDirty();
    const input = $('lp-agenda').querySelectorAll('.lp-item-text')[at]; if (input) input.focus();
  }
  $('lp-add-item').addEventListener('click', () => addItem());
  $('lp-add').addEventListener('click', () => {
    exists = true;                     // show the editor; it's saved on the first edit
    if (!plan.agenda.length) plan.agenda.push({ id: uid(), text: '', minutes: null, done: false });
    render();
    $('lp-objective').focus();
  });

  // ---------- autosave ----------
  function scheduleSave(delay = 800) {
    if (!periodId) return;
    clearTimeout(saveTimer);
    setSave('saving');
    const pid = periodId, d = date, snapshot = JSON.parse(JSON.stringify(plan));
    saveTimer = setTimeout(async () => {
      try {
        await saveLessonPlan(pid, d, snapshot);
        if (pid === periodId && d === date) { exists = true; dirty = false; setSave('saved'); }
      } catch (err) { setSave('error'); showError(err); }
    }, delay);
  }
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- load ----------
  async function load() {
    const seq = ++loadSeq;
    clearTimeout(saveTimer); dirty = false;
    plan = EMPTY_PLAN(); exists = false; setSave('');
    if (!periodId) { render(); return; }
    try {
      const row = await getLessonPlan(periodId, date);
      if (seq !== loadSeq) return;
      if (row) {
        exists = true;
        plan = { objective: row.objective || '', agenda: Array.isArray(row.agenda) ? row.agenda.map((a) => ({ id: a.id || uid(), text: a.text || '', minutes: a.minutes ?? null, done: !!a.done })) : [], materials: row.materials || '', homework: row.homework || '', notes: row.notes || '' };
        setSave('saved');
      }
    } catch (err) {
      if (seq !== loadSeq) return;
      setStatus(`Lesson plans unavailable — run migration-lessons-bathroom.sql in the Supabase SQL editor. (${err.message})`, 'error');
    }
    render();
  }

  // ---------- copy from … ----------
  function applyCopy(src, label) {
    if (!isEmptyPlan(plan) && !confirm(`Replace the current plan with ${label}?`)) return;
    plan = { objective: src.objective || '', agenda: (src.agenda || []).map((a) => ({ id: uid(), text: a.text || '', minutes: a.minutes ?? null, done: false })), materials: src.materials || '', homework: src.homework || '', notes: src.notes || '' };
    exists = true;
    render(); markDirty();
    setStatus(`Copied ${label}.`, 'ok');
  }
  async function copyFromPeriod() {
    if (!periodId) return;
    const others = periods.filter((p) => p.id !== periodId);
    const list = $('lp-dialog-list');
    $('lp-dialog-title').textContent = `Copy from another period · ${fmtDate(date)}`;
    list.innerHTML = '<p class="hint">Loading…</p>';
    $('lp-dialog').showModal();
    const rows = await Promise.all(others.map((p) => getLessonPlan(p.id, date).catch(() => null)));
    list.innerHTML = others.map((p, i) => {
      const r = rows[i];
      const has = r && !isEmptyPlan({ objective: r.objective || '', agenda: r.agenda || [], materials: r.materials || '', homework: r.homework || '', notes: r.notes || '' });
      return `<button type="button" class="lesson-dialog-row" data-i="${i}" ${has ? '' : 'disabled'}>
        <span class="ld-name">${escapeHtml(p.name)}</span>
        <span class="ld-sub">${has ? escapeHtml((r.objective || (r.agenda || []).map((a) => a.text).filter(Boolean).join(' · ') || 'plan').slice(0, 90)) : 'no plan for this date'}</span>
      </button>`;
    }).join('') || '<p class="hint">No other periods.</p>';
    list.onclick = (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const i = Number(b.dataset.i);
      $('lp-dialog').close();
      applyCopy(rows[i], `${others[i].name}'s plan`);
    };
  }
  async function copyPrev() {
    if (!periodId) return;
    const prev = prevSchoolDay(date);
    try {
      const row = await getLessonPlan(periodId, prev);
      if (!row) { setStatus(`No plan for ${periodName(periodId)} on ${fmtDate(prev)}.`, 'info'); return; }
      applyCopy(row, `${fmtDate(prev)}'s plan`);
    } catch (err) { showError(err); }
  }
  $('lp-copy-period').addEventListener('click', copyFromPeriod);
  $('lp-empty-copy-period').addEventListener('click', copyFromPeriod);
  $('lp-copy-prev').addEventListener('click', copyPrev);
  $('lp-empty-copy-prev').addEventListener('click', copyPrev);
  $('lp-dialog-close').addEventListener('click', () => $('lp-dialog').close());

  // ---------- wiring ----------
  navReady.then((nav) => { periods = nav.periods; renderHead(); });
  if (follow) {
    document.addEventListener('teacherpal:period', (e) => {
      const { periodId: pid, date: d } = e.detail;
      if (pid === periodId && d === date) return;
      periodId = pid; date = d;
      load();
    });
  }

  return {
    show(pid, d) { if (pid === periodId && d === date) return; periodId = pid; date = d; load(); },
    get periodId() { return periodId; },
    get date() { return date; },
  };
}
