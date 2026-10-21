// lesson.js — the lesson-plan editor. One plan per COURSE per day, shared by
// every period of that course:
//   { objective, agenda: [{ id, text, minutes|null, done }], materials, homework, notes }
// plus that day's attachments (files in Supabase Storage + links), which hang
// off the same (course, date) on their own — a file can come before any text.
//
// The editor edits a calendar ROW: { key, target, name, periods, isCourse }
//   target = { courseId } for a course, { periodId } for a period with no course.
// For a course, one period can be SPLIT off for one day: it gets its own plan
// (target { periodId }), started as a copy of the course's, until merged back.
//
//   const panel = initLessonPanel({ mount, rows, onChange, onAttachments, onScope })
//   panel.show(row, date, split?)  open a row's day (split = a period id → its own plan)
//   panel.upload(files)           attach files to the open plan (drop on a calendar cell)
//   panel.focusAttachment(id)     scroll to + flash one attachment (search results)
//
//   rows()                                              every calendar row (Copy from course)
//   onChange({ target, date, plan })                    text changed; plan null = removed (merge)
//   onAttachments({ type: 'add'|'remove', row })        an attachment was added / removed
//   onScope(split)                                      the editor moved between the course and a split
//
// Everything is editable inline (plain fields styled as text), autosaved to
// Supabase 800ms after the last edit through shared.js, with a Saved
// indicator. No Supabase calls of its own.

const LP_ICONS = {
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-3zm0 3v2"/>',
  slides: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/><path d="M7 8h6M7 11h4"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 12h6M9 15h6M9 18h4"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.5h16M4 15h16M10 4v16"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-8.5 8.5"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  clip: '<path d="m21 11-8.6 8.6a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15.6 7"/>',
  upload: '<path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  home: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  split: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 9c0 3 3 3 6 3h4"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
};
const lpIcon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LP_ICONS[name]}</svg>`;

// What kind of thing an attachment is — drives its icon, its label and what a click does.
function attachmentKind(a) {
  if (a.kind === 'link') {
    const u = String(a.url || '');
    if (/youtube\.com|youtu\.be|vimeo\.com/i.test(u)) return 'video';
    if (/docs\.google\.com\/presentation/i.test(u)) return 'slides';
    if (/docs\.google\.com\/spreadsheets/i.test(u)) return 'sheet';
    if (/docs\.google\.com\/document/i.test(u)) return 'doc';
    if (/\.pdf($|\?)/i.test(u)) return 'pdf';
    return 'link';
  }
  const m = String(a.mime || ''), ext = (String(a.name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (/presentation|powerpoint/.test(m) || ['ppt', 'pptx', 'key', 'odp'].includes(ext)) return 'slides';
  if (/spreadsheet|excel|csv/.test(m) || ['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(ext)) return 'sheet';
  if (/word|opendocument\.text|rtf|^text\//.test(m) || ['doc', 'docx', 'odt', 'rtf', 'txt', 'pages', 'md'].includes(ext)) return 'doc';
  return 'file';
}
const KIND_LABEL = { pdf: 'PDF', slides: 'Slides', doc: 'Doc', sheet: 'Sheet', image: 'Image', video: 'Video', audio: 'Audio', link: 'Link', file: 'File' };
function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
const youTubeId = (u) => (String(u).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/) || [])[1] || null;
// can it be shown inside the app? (PDFs, images, YouTube)
const previewable = (a) => (a.kind === 'file' && ['pdf', 'image'].includes(attachmentKind(a))) || (a.kind === 'link' && !!youTubeId(a.url));
// a readable name for a pasted URL when the teacher doesn't give one
function guessLinkName(url) {
  try {
    const u = new URL(url), host = u.hostname.replace(/^www\./, '');
    if (/youtube\.com|youtu\.be/.test(host)) return 'YouTube video';
    if (host === 'docs.google.com') {
      const t = (u.pathname.match(/^\/(presentation|document|spreadsheets|forms)/) || [])[1];
      return { presentation: 'Google Slides', document: 'Google Doc', spreadsheets: 'Google Sheet', forms: 'Google Form' }[t] || 'Google Docs';
    }
    if (host === 'drive.google.com') return 'Google Drive file';
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last ? `${host} · ${last}` : host;
  } catch { return url; }
}

function initLessonPanel({ mount = '#lesson', rows: allRows = () => [], onChange = null, onAttachments = null, onScope = null } = {}) {
  const root = document.querySelector(mount);
  if (!root) return null;
  const $ = (id) => root.querySelector(`#${id}`);
  const TICKS = '<span class="tick tl" aria-hidden="true"></span><span class="tick tr" aria-hidden="true"></span><span class="tick bl" aria-hidden="true"></span><span class="tick br" aria-hidden="true"></span>';
  const uid = () => Math.random().toString(36).slice(2, 9);
  const parse = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (ymd) => parse(ymd).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtLong = (ymd) => parse(ymd).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const shiftDate = (ymd, days) => { const d = parse(ymd); d.setDate(d.getDate() + days); return dateKey(d); };
  // previous weekday (Mon → Fri)
  const prevSchoolDay = (ymd) => { let d = shiftDate(ymd, -1); const wd = parse(d).getDay(); if (wd === 0) d = shiftDate(d, -2); else if (wd === 6) d = shiftDate(d, -1); return d; };
  const isEmptyPlan = (p) => !p || (!(p.objective || '').trim() && !(p.materials || '').trim() && !(p.homework || '').trim() && !(p.notes || '').trim() && !(p.agenda || []).some((a) => (a.text || '').trim()));
  const planSummary = (r) => (r.objective || '').trim() || (r.agenda || []).map((a) => a.text).filter(Boolean).join(' · ') || (r.homework || r.materials || r.notes || '').trim();

  root.classList.add('hud-box', 'lesson-panel');
  root.innerHTML = `
    ${TICKS}
    <div class="lesson-head">
      <div class="lesson-title">
        <span class="lesson-title-main" id="lp-title">—</span>
      </div>
      <span class="spacer"></span>
      <span class="save-state hud-mono" id="lp-save" aria-live="polite"></span>
      <span class="lp-more-wrap" id="lp-more-wrap">
        <button type="button" class="lp-quiet lp-more-btn" id="lp-more-btn" aria-haspopup="true" aria-expanded="false" title="Copy or split this plan" aria-label="More actions">${lpIcon('more')}</button>
        <span class="lp-split-menu lp-more-menu" id="lp-more-menu" hidden>
          <span class="lp-more-main" id="lp-more-main">
            <button type="button" id="lp-copy-period">${lpIcon('copy')}<em>Copy from course…</em></button>
            <button type="button" id="lp-copy-day">${lpIcon('calendar')}<em>Copy from day…</em></button>
            <span class="lp-split-wrap" id="lp-split-wrap" hidden><button type="button" id="lp-split-btn">${lpIcon('split')}<em>Split a period…</em></button></span>
          </span>
          <span class="lp-split-list" id="lp-split-menu" hidden></span>
        </span>
      </span>
    </div>
    <div class="lp-scope" id="lp-scope" hidden></div>

    <div class="lesson-empty" id="lp-empty" hidden>
      <p class="lesson-empty-sub">Pick a course and a day</p>
    </div>

    <div class="lesson-body" id="lp-body" hidden>
      <section class="lp-field lp-opt" id="lp-f-objective" hidden>
        <h4>Objective</h4>
        <textarea id="lp-objective" class="lp-text lp-objective" rows="1" placeholder=" "></textarea>
      </section>
      <section class="lp-field lp-agenda-field">
        <ol class="lp-agenda" id="lp-agenda"></ol>
        <div class="lp-agenda-foot">
          <button type="button" class="link lp-add-item" id="lp-add-item">+ Add activity</button>
          <span class="lp-budget hud-mono" id="lp-budget" hidden></span>
        </div>
      </section>
      <section class="lp-field">
        <h4>Materials</h4>
        <textarea id="lp-materials" class="lp-text" rows="1" placeholder=" "></textarea>
      </section>
      <section class="lp-field lp-opt" id="lp-f-homework" hidden>
        <h4>Homework</h4>
        <textarea id="lp-homework" class="lp-text" rows="1" placeholder=" "></textarea>
      </section>
      <section class="lp-field lp-att-field" id="lp-att-field">
        <ul class="lp-att-list" id="lp-att-list"></ul>
        <form class="lp-link-form" id="lp-link-form" hidden>
          <input type="text" id="lp-link-url" placeholder="Paste a link — Google Slides, Docs, YouTube…" aria-label="Link URL" autocomplete="off">
          <input type="text" id="lp-link-name" placeholder="Name (optional)" aria-label="Link name" autocomplete="off">
          <button type="submit" class="primary">Add</button>
          <button type="button" id="lp-link-cancel">Cancel</button>
        </form>
        <span class="lp-attach-wrap" id="lp-attach-wrap">
          <button type="button" class="link lp-add-item" id="lp-attach-btn" aria-haspopup="true" aria-expanded="false">+ Attach</button>
          <span class="lp-split-menu lp-attach-menu" id="lp-attach-menu" hidden>
            <button type="button" id="lp-pick">${lpIcon('upload')}<em>Upload files…</em></button>
            <button type="button" id="lp-link-btn">${lpIcon('link')}<em>Add a link…</em></button>
            <span class="lp-split-note">or drop files anywhere on the plan</span>
          </span>
        </span>
        <input type="file" id="lp-file" multiple hidden>
      </section>
      <section class="lp-field lp-notes-field">
        <h4>Notes</h4>
        <textarea id="lp-notes" class="lp-text lp-notes" rows="2" placeholder="What happened today?"></textarea>
      </section>
      <span class="lp-addfield-wrap" id="lp-addfield-wrap">
        <button type="button" class="lp-quiet" id="lp-addfield-btn" aria-haspopup="true" aria-expanded="false">+ Add field</button>
        <span class="lp-split-menu lp-addfield-menu" id="lp-addfield-menu" hidden></span>
      </span>
    </div>

    <div class="lp-dropping" aria-hidden="true"><span>${lpIcon('upload')}<b id="lp-drop-label">Drop to attach</b></span></div>

    <dialog class="lesson-dialog" id="lp-dialog">
      <form method="dialog" class="lesson-dialog-form">
        <div class="ld-head"><h3 id="lp-dialog-title">Copy</h3><button type="button" class="corner-btn" id="lp-dialog-close" aria-label="Close">${lpIcon('close')}</button></div>
        <div class="ld-pick" id="lp-dialog-pick" hidden>
          <label class="dash-field"><span class="hud-key">DATE</span><input type="date" id="lp-dialog-date"></label>
          <span class="hint" id="lp-dialog-date-note"></span>
        </div>
        <div id="lp-dialog-list" class="lesson-dialog-list"></div>
        <label class="ld-att"><input type="checkbox" id="lp-dialog-att" checked> Also copy attachments</label>
      </form>
    </dialog>

    <dialog class="lp-preview" id="lp-preview">
      <div class="lpp-inner">
        <div class="lpp-head">
          <span class="lpp-icon" id="lpp-icon"></span>
          <div class="lpp-title"><b id="lpp-name"></b><span id="lpp-meta"></span></div>
          <span class="spacer"></span>
          <a class="lp-mini" id="lpp-download" href="#">${lpIcon('download')}Download</a>
          <a class="lp-mini" id="lpp-open" href="#" target="_blank" rel="noopener">${lpIcon('external')}Open in new tab</a>
          <button type="button" class="corner-btn" id="lpp-close" aria-label="Close preview">${lpIcon('close')}</button>
        </div>
        <div class="lpp-body" id="lpp-body"></div>
      </div>
    </dialog>`;

  // ---------- state ----------
  let row = null, split = null, date = todayKey();   // split: the period whose own plan is open
  let splits = [];               // period ids of this course with their own plan today
  let plan = EMPTY_PLAN();
  let exists = false;            // a row exists in Supabase
  let saveTimer = null, loadSeq = 0, dirty = false;
  let attachments = [];          // this day's rows
  let attError = '';             // the attachments table/bucket isn't there yet
  let uploads = [];              // [{ tmp, key, date, name, size, progress, error }] in flight

  // what is being edited right now: the row's own plan, or a split period's
  const target = () => (split ? { periodId: split } : row ? row.target : null);
  const tkey = (t) => (t ? (t.courseId ? `c:${t.courseId}` : `p:${t.periodId}`) : '');
  const curKey = () => tkey(target());
  const here = (u) => u.key === curKey() && u.date === date;
  const periodOf = (id) => (row ? row.periods.find((p) => p.id === id) : null) || { id, label: '', name: '' };
  const planLabel = () => (row ? (split ? `${row.name} · ${periodOf(split).label} only` : row.name) : '');

  // ---------- rendering ----------
  function autoGrow(ta) {
    // Notes fills whatever height is left (flex); it only needs a floor as tall as its text
    if (ta.id === 'lp-notes') { ta.style.flex = 'none'; ta.style.height = 'auto'; const h = ta.scrollHeight; ta.style.flex = ''; ta.style.height = ''; ta.style.minHeight = `${h}px`; return; }
    ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`;
  }

  // ---------- time budget: planned minutes against the period's real length that day ----------
  let overridesList = [];
  if (typeof navReady !== 'undefined') navReady.then((nav) => { overridesList = (nav && nav.overrides) || []; renderBudget(); }).catch(() => {});
  const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  // minutes each of this plan's periods meets on `date` (a split → just that period)
  function periodLengths() {
    if (!row) return [];
    const sched = resolveSchedule(parse(date), overridesList);
    const ps = split ? [periodOf(split)] : row.periods;
    return ps.map((p) => {
      // double 2nd: period 2 meets twice, each class in one half → the longer block
      const segs = sched.segments.filter((s) => s.kind === 'period' && s.n === p.n);
      return { label: p.label, min: segs.length ? Math.max(...segs.map((s) => toMin(s.end) - toMin(s.start))) : null };
    }).filter((x) => x.min);
  }
  function renderBudget() {
    const el = $('lp-budget');
    if (!el) return;
    const lens = periodLengths();
    if (!row || !lens.length) { el.hidden = true; return; }
    const limit = Math.min(...lens.map((x) => x.min));   // a course is planned for its shortest period
    const planned = plan.agenda.reduce((s, a) => s + (Number(a.minutes) > 0 ? Number(a.minutes) : 0), 0);
    const left = limit - planned;
    el.hidden = false;
    el.dataset.state = left < 0 ? 'over' : 'ok';
    el.textContent = left < 0 ? `${-left} min over` : `${left} min left`;
    const differ = new Set(lens.map((x) => x.min)).size > 1;
    el.title = `${resolveSchedule(parse(date), overridesList).name}: ${lens.map((x) => `${x.label} ${x.min} min`).join(' · ')}${differ ? ' — counted against the shortest' : ''}`;
  }
  function setSave(state) {
    const el = $('lp-save');
    el.dataset.state = state;
    el.textContent = state === 'saving' ? 'SAVING…' : state === 'saved' ? 'SAVED' : state === 'error' ? 'NOT SAVED' : '';
  }
  function renderHead() {
    $('lp-title').textContent = row ? `${planLabel()} · ${fmtLong(date)}` : 'Pick a course and a day';
    $('lp-drop-label').textContent = row ? `Drop to attach to ${planLabel()} · ${fmtDate(date)}` : 'Drop to attach';
  }
  function render() {
    renderHead();
    const empty = !row;
    $('lp-empty').hidden = !empty;
    $('lp-body').hidden = empty;
    $('lp-more-wrap').hidden = empty;
    renderScope();
    root.classList.toggle('is-empty', empty);
    if (empty) return;
    renderFields();
    for (const k of ['objective', 'materials', 'homework', 'notes']) { const ta = $(`lp-${k}`); if (ta.value !== plan[k]) ta.value = plan[k]; autoGrow(ta); }
    renderAgenda();
    renderAttachments();
  }
  // Objective and Homework stay out of sight until they're added (+ Add field)
  // or have something in them; cleared and left, they fold away again.
  const OPTIONAL = { objective: 'Objective', homework: 'Homework' };
  let opened = new Set();
  const showsField = (k) => !!(plan[k] || '').trim() || opened.has(k);
  function renderFields() {
    for (const k of Object.keys(OPTIONAL)) $(`lp-f-${k}`).hidden = !showsField(k);
    $('lp-addfield-wrap').hidden = Object.keys(OPTIONAL).every(showsField);
  }
  function toggleAddField(open) {
    const menu = $('lp-addfield-menu');
    menu.hidden = !open;
    $('lp-addfield-btn').setAttribute('aria-expanded', String(open));
    if (open) menu.innerHTML = Object.keys(OPTIONAL).filter((k) => !showsField(k)).map((k) => `<button type="button" data-field="${k}"><em>${OPTIONAL[k]}</em></button>`).join('');
  }
  $('lp-addfield-btn').addEventListener('click', () => toggleAddField($('lp-addfield-menu').hidden));
  $('lp-addfield-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-field]'); if (!b) return;
    toggleAddField(false);
    opened.add(b.dataset.field); renderFields();
    const ta = $(`lp-${b.dataset.field}`); autoGrow(ta); ta.focus();
  });
  for (const k of Object.keys(OPTIONAL)) {
    $(`lp-${k}`).addEventListener('blur', () => { if (!plan[k].trim()) { opened.delete(k); renderFields(); } });
  }
  // Kept out of the way: a course shows its periods as one quiet line, and only
  // when a period has split off does a bar appear to switch between them.
  function renderScope() {
    const course = row && row.isCourse && row.periods.length > 1;
    const free = course ? row.periods.filter((p) => !splits.includes(p.id)) : [];
    $('lp-split-wrap').hidden = !course || !!split || free.length < 2;
    const bar = $('lp-scope');
    bar.hidden = !course || (!split && !splits.length);
    if (bar.hidden) { bar.innerHTML = ''; return; }
    bar.innerHTML = `
      <button type="button" class="lp-scope-chip${split ? '' : ' on'}" data-scope="" aria-pressed="${!split}">${escapeHtml(row.name)} plan<span>${row.periods.filter((p) => !splits.includes(p.id)).map((p) => escapeHtml(p.label)).join(' · ')}</span></button>
      ${splits.map((id) => `<button type="button" class="lp-scope-chip own${split === id ? ' on' : ''}" data-scope="${id}" aria-pressed="${split === id}">${lpIcon('split')}${escapeHtml(periodOf(id).label)} only</button>`).join('')}
      <span class="spacer"></span>
      ${split ? `<button type="button" class="lp-quiet" id="lp-merge" title="Delete this period's own plan for the day; it follows ${escapeHtml(row.name)} again">Merge back into ${escapeHtml(row.name)}</button>` : ''}`;
  }
  function setScope(next) {
    if (next === split) return;
    flush();
    split = next || null;
    if (onScope) onScope(split);
    load();
  }
  $('lp-scope').addEventListener('click', (e) => {
    if (e.target.closest('#lp-merge')) { mergeBack(); return; }
    const b = e.target.closest('[data-scope]');
    if (b) setScope(b.dataset.scope);
  });
  // The ⋯ menu: the occasional actions (copy, split). Split swaps the menu for the period list.
  function toggleMore(open) {
    $('lp-more-menu').hidden = !open;
    $('lp-more-btn').setAttribute('aria-expanded', String(open));
    toggleSplitMenu(false);
  }
  function toggleSplitMenu(open) {
    const menu = $('lp-split-menu');
    menu.hidden = !open;
    $('lp-more-main').hidden = open;
    if (open) {
      menu.innerHTML = `<span class="lp-split-note">Give one period its own plan for ${escapeHtml(fmtDate(date))}. It starts as a copy of today's ${escapeHtml(row.name)} plan.</span>`
        + row.periods.filter((p) => !splits.includes(p.id)).map((p) => `<button type="button" data-split="${p.id}">${escapeHtml(p.label)}<span>${escapeHtml(p.name)}</span></button>`).join('');
    }
  }
  $('lp-more-btn').addEventListener('click', () => toggleMore($('lp-more-menu').hidden));
  $('lp-split-btn').addEventListener('click', () => toggleSplitMenu(true));
  $('lp-more-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-split]');
    if (b) { toggleMore(false); splitOff(b.dataset.split); }
    else if (e.target.closest('#lp-copy-period, #lp-copy-day')) toggleMore(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!$('lp-more-menu').hidden && !e.target.closest('#lp-more-wrap')) toggleMore(false);
    if (!$('lp-addfield-menu').hidden && !e.target.closest('#lp-addfield-wrap')) toggleAddField(false);
    if (!$('lp-attach-menu').hidden && !e.target.closest('#lp-attach-wrap')) toggleAttach(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('lp-more-menu').hidden) { toggleMore(false); $('lp-more-btn').focus(); }
    if (!$('lp-addfield-menu').hidden) { toggleAddField(false); $('lp-addfield-btn').focus(); }
    if (!$('lp-attach-menu').hidden) { toggleAttach(false); $('lp-attach-btn').focus(); }
  });

  // Split: the period gets its own plan for the day — a copy of the course
  // plan's text and attachments (the files themselves are shared, not re-uploaded).
  async function splitOff(pid) {
    if (!row || !row.isCourse) return;
    flush();
    const t = { periodId: pid }, d = date;
    try {
      const saved = await saveLessonPlan(t, d, { ...JSON.parse(JSON.stringify(plan)), agenda: plan.agenda.map((a) => ({ ...a, id: uid() })) });
      if (onChange) onChange({ target: t, date: d, plan: saved });
      const copied = await copyLessonAttachments(attachments, t, d).catch((err) => { showError(err); return []; });
      copied.forEach((r) => onAttachments && onAttachments({ type: 'add', row: r }));
      splits = [...splits, pid];
      setStatus(`${periodOf(pid).label} has its own plan for ${fmtDate(d)}. Edits here don't change ${row.name}'s.`, 'ok');
      setScope(pid);
    } catch (err) { showError(err); }
  }
  // Merge back: delete the period's own plan (and its attachment rows) so it follows the course again.
  async function mergeBack() {
    if (!split) return;
    const pid = split, t = { periodId: pid }, d = date;
    if (!confirm(`Merge ${periodOf(pid).label} back into ${row.name} for ${fmtDate(d)}?\n\nIts own plan for this day is deleted and it follows the ${row.name} plan again.`)) return;
    clearTimeout(saveTimer); dirty = false;
    try {
      for (const a of attachments) { await deleteLessonAttachment(a); if (onAttachments) onAttachments({ type: 'remove', row: a }); }
      await deleteLessonPlan(t, d);
      if (onChange) onChange({ target: t, date: d, plan: null });
      splits = splits.filter((x) => x !== pid);
      setStatus(`${periodOf(pid).label} follows ${row.name} again.`, 'ok');
      setScope(null);
    } catch (err) { showError(err); }
  }

  function renderAgenda() {
    const list = $('lp-agenda');
    list.innerHTML = plan.agenda.map((a, i) => `
      <li class="lp-item" data-id="${a.id}">
        <span class="lp-num">${i + 1}</span>
        <input type="text" class="lp-item-text" value="${escapeHtml(a.text)}">
        <input type="number" class="lp-min" min="0" max="300" value="${a.minutes ?? ''}" placeholder="min" aria-label="Minutes">
        <button type="button" class="lp-remove" aria-label="Remove activity" title="Remove">×</button>
      </li>`).join('');
    renderBudget();
  }
  function attMeta(a) {
    const k = attachmentKind(a);
    if (a.kind === 'link') { try { return `${KIND_LABEL[k]} · ${new URL(a.url).hostname.replace(/^www\./, '')}`; } catch { return KIND_LABEL[k]; } }
    return `${KIND_LABEL[k]} · ${fmtBytes(a.size)}`;
  }
  function renderAttachments() {
    const busy = uploads.filter(here);
    const list = $('lp-att-list');
    if (attError) {
      list.innerHTML = `<li class="lp-att-missing">${escapeHtml(attError)}</li>`;
      $('lp-pick').disabled = $('lp-link-btn').disabled = true;
      return;
    }
    $('lp-pick').disabled = $('lp-link-btn').disabled = false;
    list.innerHTML = attachments.map((a) => {
      const k = attachmentKind(a), canSee = previewable(a);
      const title = a.kind === 'link' ? `Open ${a.url}` : canSee ? 'Preview' : 'Download';
      return `<li class="lp-att" data-id="${a.id}">
        <span class="lp-att-icon k-${k}">${lpIcon(k)}</span>
        <button type="button" class="lp-att-name" data-act="open" title="${escapeHtml(title)}">${escapeHtml(a.name)}</button>
        <span class="lp-att-meta">${escapeHtml(attMeta(a))}</span>
        <span class="lp-att-tools">
          ${canSee ? `<button type="button" class="icon-btn" data-act="preview" title="Preview" aria-label="Preview ${escapeHtml(a.name)}">${lpIcon('eye')}</button>` : ''}
          ${a.kind === 'file'
            ? `<button type="button" class="icon-btn" data-act="download" title="Download" aria-label="Download ${escapeHtml(a.name)}">${lpIcon('download')}</button>`
            : `<button type="button" class="icon-btn" data-act="open" title="Open in a new tab" aria-label="Open ${escapeHtml(a.name)}">${lpIcon('external')}</button>`}
          <button type="button" class="icon-btn danger" data-act="delete" title="Remove" aria-label="Remove ${escapeHtml(a.name)}">${lpIcon('trash')}</button>
        </span>
      </li>`;
    }).join('') + busy.map((u) => `
      <li class="lp-att uploading${u.error ? ' failed' : ''}" data-tmp="${u.tmp}">
        <span class="lp-att-icon k-${attachmentKind({ kind: 'file', name: u.name, mime: u.mime })}">${lpIcon(attachmentKind({ kind: 'file', name: u.name, mime: u.mime }))}</span>
        <span class="lp-att-name">${escapeHtml(u.name)}</span>
        <span class="lp-att-meta">${u.error ? escapeHtml(u.error) : `${Math.round(u.progress * 100)}% · ${fmtBytes(u.size)}`}</span>
        <span class="lp-att-tools">${u.error ? `<button type="button" class="icon-btn" data-act="dismiss" title="Dismiss" aria-label="Dismiss">${lpIcon('close')}</button>` : ''}</span>
        ${u.error ? '' : `<span class="lp-att-bar" style="--p:${u.progress}"></span>`}
      </li>`).join('');
  }

  // ---------- editing ----------
  function markDirty() {
    dirty = true;
    renderHead();
    renderBudget();
    if (onChange) onChange({ target: target(), date, plan });
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

  // ---------- attachments ----------
  async function upload(fileList) {
    const files = [...(fileList || [])].filter((f) => f && f.size !== undefined);
    if (!files.length || !row) return;
    if (attError) { setStatus(attError, 'error'); return; }
    const t = target(), k = tkey(t), d = date;
    let order = attachments.length + uploads.filter(here).length;
    const jobs = files.map((f) => ({ tmp: uid(), key: k, date: d, name: f.name, size: f.size, mime: f.type, progress: 0, error: '', file: f, order: order++ }));
    uploads.push(...jobs);
    render();
    await Promise.all(jobs.map(async (job) => {
      let last = 0;
      try {
        const added = await uploadLessonFile(t, d, job.file, {
          sortOrder: job.order,
          onProgress: (p) => { job.progress = p; const now = Date.now(); if (now - last > 120 || p === 1) { last = now; if (here(job)) renderAttachments(); } },
        });
        uploads = uploads.filter((u) => u !== job);
        if (here(job)) attachments.push(added);
        if (onAttachments) onAttachments({ type: 'add', row: added });
      } catch (err) {
        job.error = String(err.message || err).replace(/^Storage \d+: /, '');
      }
      if (here(job)) render();
    }));
    const failed = jobs.filter((j) => j.error).length;
    if (!failed) setStatus(`Attached ${files.length === 1 ? files[0].name : `${files.length} files`}.`, 'ok');
  }
  $('lp-pick').addEventListener('click', () => $('lp-file').click());
  // + Attach: one button, both ways in
  function toggleAttach(open) {
    $('lp-attach-menu').hidden = !open;
    $('lp-attach-btn').setAttribute('aria-expanded', String(open));
  }
  $('lp-attach-btn').addEventListener('click', () => toggleAttach($('lp-attach-menu').hidden));
  $('lp-attach-menu').addEventListener('click', (e) => { if (e.target.closest('button')) toggleAttach(false); });
  $('lp-file').addEventListener('change', (e) => { upload(e.target.files); e.target.value = ''; });

  // links
  function toggleLinkForm(open) {
    $('lp-link-form').hidden = !open;
    if (open) { $('lp-link-url').value = ''; $('lp-link-name').value = ''; $('lp-link-url').focus(); }
  }
  $('lp-link-btn').addEventListener('click', () => toggleLinkForm($('lp-link-form').hidden));
  $('lp-link-cancel').addEventListener('click', () => toggleLinkForm(false));
  $('lp-link-form').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toggleLinkForm(false); } });
  $('lp-link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let url = $('lp-link-url').value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try { new URL(url); } catch { setStatus("That doesn't look like a link.", 'error'); return; }
    const t = target(), d = date;
    try {
      const added = await addLessonLink(t, d, { url, name: $('lp-link-name').value.trim() || guessLinkName(url), sortOrder: attachments.length });
      if (tkey(t) === curKey() && d === date) attachments.push(added);
      if (onAttachments) onAttachments({ type: 'add', row: added });
      toggleLinkForm(false);
      render();
    } catch (err) { showError(err); }
  });

  // list actions
  const attById = (id) => attachments.find((a) => a.id === id);
  $('lp-att-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const li = btn.closest('.lp-att');
    if (btn.dataset.act === 'dismiss') { uploads = uploads.filter((u) => u.tmp !== li.dataset.tmp); render(); return; }
    const a = attById(li.dataset.id); if (!a) return;
    const act = btn.dataset.act;
    try {
      if (act === 'delete') {
        if (!confirm(`Remove “${a.name}” from this lesson?`)) return;
        await deleteLessonAttachment(a);
        attachments = attachments.filter((x) => x !== a);
        if (onAttachments) onAttachments({ type: 'remove', row: a });
        render();
      } else if (act === 'preview' || (act === 'open' && previewable(a) && a.kind === 'file')) openPreview(a);
      else if (act === 'open' && a.kind === 'link') window.open(a.url, '_blank', 'noopener');
      else if (act === 'download' || act === 'open') downloadFile(a);
    } catch (err) { showError(err); }
  });
  async function downloadFile(a) {
    const url = await lessonFileUrl(a, { download: true });
    const link = document.createElement('a');
    link.href = url; link.rel = 'noopener';
    document.body.appendChild(link); link.click(); link.remove();
  }

  // preview: PDFs and images through a signed URL; YouTube as an embed
  async function openPreview(a) {
    const dlg = $('lp-preview'), body = $('lpp-body'), k = attachmentKind(a);
    $('lpp-icon').className = `lpp-icon k-${k}`; $('lpp-icon').innerHTML = lpIcon(k);
    $('lpp-name').textContent = a.name;
    $('lpp-meta').textContent = attMeta(a);
    body.innerHTML = '<p class="lpp-loading">Loading…</p>';
    $('lpp-download').hidden = a.kind !== 'file';
    dlg.showModal();
    if (a.kind === 'link') {
      $('lpp-open').href = a.url;
      body.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${youTubeId(a.url)}" title="${escapeHtml(a.name)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      return;
    }
    try {
      const [view, dl] = await Promise.all([lessonFileUrl(a), lessonFileUrl(a, { download: true })]);
      if (!dlg.open) return;
      $('lpp-open').href = view; $('lpp-download').href = dl;
      body.innerHTML = k === 'image'
        ? `<img src="${escapeHtml(view)}" alt="${escapeHtml(a.name)}">`
        : `<iframe src="${escapeHtml(view)}" title="${escapeHtml(a.name)}"></iframe>`;
    } catch (err) { body.innerHTML = `<p class="lpp-loading">${escapeHtml(err.message)}</p>`; }
  }
  $('lpp-close').addEventListener('click', () => $('lp-preview').close());
  $('lp-preview').addEventListener('close', () => { $('lpp-body').innerHTML = ''; });
  $('lp-preview').addEventListener('click', (e) => { if (e.target === $('lp-preview')) $('lp-preview').close(); });

  // drag files anywhere onto the editor
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  root.addEventListener('dragenter', (e) => { if (!hasFiles(e) || !row) return; e.preventDefault(); dragDepth++; root.classList.add('drop-on'); });
  root.addEventListener('dragover', (e) => { if (!hasFiles(e) || !row) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  root.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; root.classList.remove('drop-on'); } });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; root.classList.remove('drop-on');
    upload(e.dataTransfer.files);
  });

  // ---------- autosave ----------
  function scheduleSave(delay = 800) {
    if (!row) return;
    clearTimeout(saveTimer);
    setSave('saving');
    const t = target(), d = date, snapshot = JSON.parse(JSON.stringify(plan));
    saveTimer = setTimeout(async () => {
      try {
        await saveLessonPlan(t, d, snapshot);
        if (tkey(t) === curKey() && d === date) { exists = true; dirty = false; setSave('saved'); }
      } catch (err) { setSave('error'); showError(err); }
    }, delay);
  }
  // a pending edit is saved at once before switching days, so nothing is lost
  function flush() {
    if (!dirty || !saveTimer) return;
    clearTimeout(saveTimer);
    saveLessonPlan(target(), date, JSON.parse(JSON.stringify(plan))).catch(showError);
    dirty = false;
  }
  window.addEventListener('beforeunload', (e) => { if (dirty || uploads.some((u) => !u.error)) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- load ----------
  const normalize = (row) => ({ objective: row.objective || '', agenda: Array.isArray(row.agenda) ? row.agenda.map((a) => ({ id: a.id || uid(), text: a.text || '', minutes: a.minutes ?? null, done: !!a.done })) : [], materials: row.materials || '', homework: row.homework || '', notes: row.notes || '' });
  async function load() {
    const seq = ++loadSeq;
    dirty = false;
    plan = EMPTY_PLAN(); exists = false; attachments = []; setSave('');
    toggleLinkForm(false); toggleMore(false); toggleAddField(false); toggleAttach(false); opened = new Set();
    if (!row) { splits = []; render(); return; }
    render();
    const t = target();
    const coursePeriods = row.isCourse ? row.periods.map((p) => p.id) : [];
    const [found, atts, dayRows, dayAtts] = await Promise.all([
      getLessonPlan(t, date).catch((err) => { if (seq === loadSeq) setStatus(`Lesson plans unavailable — run migration-lessons-bathroom.sql in the Supabase SQL editor. (${err.message})`, 'error'); return null; }),
      getLessonAttachments(t, date).then((r) => { attError = ''; return r; }).catch((err) => {
        attError = /lesson_attachments|relation|schema cache|404/i.test(err.message) ? 'Attachments are off — run migration-lesson-attachments.sql in the Supabase SQL editor.' : err.message;
        return [];
      }),
      coursePeriods.length ? getLessonPlansRange(date, date).catch(() => []) : [],
      coursePeriods.length ? getLessonAttachmentsRange(date, date).catch(() => []) : [],
    ]);
    if (seq !== loadSeq) return;
    // which of this course's periods have their own plan today
    splits = coursePeriods.filter((id) => dayRows.some((r) => r.period_id === id) || dayAtts.some((a) => a.period_id === id));
    if (split && !splits.includes(split)) splits.push(split);
    if (found) { exists = true; plan = normalize(found); setSave('saved'); }
    attachments = atts;
    render();
  }

  // ---------- copy from another period / day ----------
  // src: a plan row (or null when only attachments are copied); atts: the source's attachments
  async function applyCopy(src, label, atts) {
    const withAtt = $('lp-dialog-att').checked && atts.length;
    const hasText = src && !isEmptyPlan(src);
    if (hasText && !isEmptyPlan(plan) && !confirm(`Replace the current plan with ${label}?`)) return;
    if (hasText) {
      plan = { ...normalize(src), agenda: normalize(src).agenda.map((a) => ({ ...a, id: uid(), done: false })) };
      exists = true;
      render(); markDirty();
    }
    let added = 0;
    if (withAtt) {
      const have = new Set(attachments.map((a) => a.storage_path || a.url));
      const fresh = atts.filter((a) => !have.has(a.storage_path || a.url));
      try {
        const rows = await copyLessonAttachments(fresh, target(), date, attachments.length);
        attachments.push(...rows); added = rows.length;
        rows.forEach((row) => onAttachments && onAttachments({ type: 'add', row }));
      } catch (err) { showError(err); }
      render();
    }
    setStatus(`Copied ${label}${added ? ` with ${added} attachment${added === 1 ? '' : 's'}` : ''}.`, 'ok');
  }
  function dialogRow(i, title, r, atts) {
    const has = (r && !isEmptyPlan(r)) || atts.length;
    const sub = r && !isEmptyPlan(r) ? planSummary(r) : atts.length ? '' : 'no plan';
    return `<button type="button" class="lesson-dialog-row" data-i="${i}" ${has ? '' : 'disabled'}>
      <span class="ld-name">${escapeHtml(title)}</span>
      <span class="ld-sub">${escapeHtml(sub.slice(0, 110))}${atts.length ? `<span class="ld-clip">${lpIcon('clip')}${atts.length}</span>` : ''}</span>
    </button>`;
  }
  function openDialog(title, pick) {
    $('lp-dialog-title').textContent = title;
    $('lp-dialog-pick').hidden = !pick;
    $('lp-dialog-list').innerHTML = '<p class="hint">Loading…</p>';
    $('lp-dialog').showModal();
  }
  // every other calendar row's plan for this same day
  async function copyFromPeriod() {
    if (!row) return;
    const others = allRows().filter((r) => r.key !== row.key);
    openDialog(`Copy from another course · ${fmtDate(date)}`, false);
    const [plans, dayAtts] = await Promise.all([
      Promise.all(others.map((r) => getLessonPlan(r.target, date).catch(() => null))),
      getLessonAttachmentsRange(date, date).catch(() => []),
    ]);
    const attsOf = (r) => dayAtts.filter((a) => tkey(a.course_id ? { courseId: a.course_id } : { periodId: a.period_id }) === r.key);
    $('lp-dialog-list').innerHTML = others.map((r, i) => dialogRow(i, r.name, plans[i], attsOf(r))).join('') || '<p class="hint">No other courses.</p>';
    $('lp-dialog-list').onclick = async (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const i = Number(b.dataset.i);
      $('lp-dialog').close();
      const full = attsOf(others[i]).length ? await getLessonAttachments(others[i].target, date).catch(() => []) : [];
      applyCopy(plans[i], `${others[i].name}'s plan`, full);
    };
  }
  async function copyFromDay() {
    if (!row) return;
    openDialog(`Copy from another day · ${planLabel()}`, true);
    const pid = target(), pkey = tkey(pid);
    $('lp-dialog-date').value = prevSchoolDay(date);
    $('lp-dialog-date').max = '';
    // this period's other plans, newest first, plus a picked date
    const recent = (await getRecentLessonPlans(pid, 40).catch(() => [])).filter((r) => r.date !== date && !isEmptyPlan(r)).slice(0, 15);
    const range = recent.length ? await getLessonAttachmentsRange(recent[recent.length - 1].date, recent[0].date).catch(() => []) : [];
    const attsOf = (d) => range.filter((a) => tkey(a.course_id ? { courseId: a.course_id } : { periodId: a.period_id }) === pkey && a.date === d);
    const show = (rows) => {
      $('lp-dialog-list').innerHTML = rows.length
        ? rows.map((r, i) => dialogRow(i, fmtLong(r.date), r, attsOf(r.date))).join('')
        : '<p class="hint">No other plans here yet.</p>';
      $('lp-dialog-list').onclick = async (e) => {
        const b = e.target.closest('[data-i]'); if (!b) return;
        const r = rows[Number(b.dataset.i)];
        $('lp-dialog').close();
        applyCopy(r, `${fmtDate(r.date)}'s plan`, await getLessonAttachments(pid, r.date).catch(() => []));
      };
    };
    show(recent);
    $('lp-dialog-date-note').textContent = 'or pick one of the recent plans';
    $('lp-dialog-date').onchange = async (e) => {
      const d = e.target.value; if (!d) return;
      const [found, atts] = await Promise.all([getLessonPlan(pid, d).catch(() => null), getLessonAttachments(pid, d).catch(() => [])]);
      if ((!found || isEmptyPlan(found)) && !atts.length) { $('lp-dialog-date-note').textContent = `No plan on ${fmtDate(d)}.`; return; }
      $('lp-dialog').close();
      applyCopy(found, `${fmtDate(d)}'s plan`, atts);
    };
  }
  $('lp-copy-period').addEventListener('click', copyFromPeriod);
  $('lp-copy-day').addEventListener('click', copyFromDay);
  $('lp-dialog-close').addEventListener('click', () => $('lp-dialog').close());

  // ---------- wiring ----------
  return {
    show(r, d, sp = null) {
      if (r && row && r.key === row.key && d === date && (sp || null) === split) { row = r; renderHead(); renderScope(); return; }
      flush(); row = r; date = d; split = sp || null; load();
    },
    upload,
    focusAttachment(id) {
      const tryFlash = (n) => {
        const li = root.querySelector(`.lp-att[data-id="${id}"]`);
        if (!li) { if (n > 0) setTimeout(() => tryFlash(n - 1), 150); return; }
        li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash');
      };
      tryFlash(20);
    },
    get row() { return row; },
    get split() { return split; },
    get date() { return date; },
  };
}
