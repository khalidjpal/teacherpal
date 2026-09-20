// nav.js — the shared top bar on every page: brand, horizontal nav, live
// status readouts (clock · date · schedule · current period + countdown) and
// the full-screen toggle. Loaded after shared.js and schedule.js.
//
// It fills <header class="topbar"> itself, marks the current page, and
// exposes:
//   navReady  — Promise<{ periods, overrides, teaches, byNumber }>
//   'teacherpal:tick' — document event every second, detail { now, sched }
// so pages (the attendance view) don't fetch periods/overrides twice.

const NAV_ITEMS = [
  { href: 'index.html', label: 'Hub' },
  { href: 'attendance.html', label: 'Attendance' },
  { href: 'lessons.html', label: 'Lesson Plans' },
  { href: 'groups.html', label: 'Create Groups' },
  { href: 'seating.html', label: 'Seating' },
  { href: 'bathroom.html', label: 'Bathroom' },
  { href: 'wordle.html', label: 'Wordle' },
  { href: 'schedule.html', label: 'Schedule' },
  { href: 'roster.html', label: 'Rosters', setup: true },
];

const navPad = (n) => String(n).padStart(2, '0');
const navState = { periods: [], overrides: [], teaches: new Map(), byNumber: new Map(), today: null };

function currentPage() {
  const file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  return file === '' ? 'index.html' : file;
}

const SIGN_OUT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';

function renderTopNav() {
  const header = document.querySelector('header.topbar');
  if (!header) return;
  const page = currentPage();
  const links = NAV_ITEMS.map((it) => {
    const cur = it.href === page ? ' aria-current="page"' : '';
    return `<a class="tab${it.setup ? ' setup' : ''}" href="${it.href}"${cur}>${it.label}</a>`;
  }).join('');
  // the hub (body.launcher) shows no links — its panels are the navigation;
  // every other page keeps the full nav, and the wordmark always links home
  const noLinks = document.body.classList.contains('launcher');
  const user = typeof currentUser === 'function' ? currentUser() : null;
  const showAccount = !!user;   // pages without a session (wordle) hide it
  header.classList.add('hud-bar', 'topnav');
  header.classList.toggle('no-links', noLinks);
  header.innerHTML = `
    <a class="hud-brand" href="index.html"><span class="hud-brand-mark" aria-hidden="true"></span>TeacherPal</a>
    ${noLinks ? '' : `<nav class="nav-links" aria-label="Screens">${links}</nav>`}
    <span class="spacer"></span>
    <div class="hud-status" aria-live="off">
      <span class="hud-stat"><span class="hud-key">TIME</span><span class="hud-val" id="hud-time">--:--:--</span></span>
      <span class="hud-stat"><span class="hud-key">DATE</span><span class="hud-val" id="hud-date">—</span></span>
      <a class="hud-stat hud-link" href="schedule.html" title="Bell schedules and overrides"><span class="hud-key">SCHED</span><span class="hud-val" id="hud-sched">—</span></a>
      <span class="hud-stat"><span class="hud-key">NOW</span><span class="hud-val" id="hud-now">—</span></span>
    </div>
    ${showAccount ? `<span class="hud-stat hud-account" title="Signed in as ${escapeHtml(user.username || user.email || '')}${user.username && user.email ? ' (' + escapeHtml(user.email) + ')' : ''}"><span class="hud-key">USER</span><span class="hud-val" id="hud-user">${escapeHtml(user.username || user.email || '')}</span></span>` : ''}
    ${showAccount ? `<button type="button" class="icon-btn signout-btn" id="signout-btn" title="Sign out" aria-label="Sign out">${SIGN_OUT_ICON}</button>` : ''}
    <button type="button" class="icon-btn fs-btn" data-fullscreen aria-pressed="false" title="Full screen (F)" aria-label="Toggle full screen"><span class="when-off">${FS_ICON_ENTER}</span><span class="when-on">${FS_ICON_EXIT}</span></button>`;

  const soBtn = header.querySelector('#signout-btn');
  if (soBtn) soBtn.addEventListener('click', () => { if (typeof signOut === 'function') signOut(); });
}

// today's schedule, re-resolved only when the date rolls over
function navSchedFor(d) {
  const k = dateKey(d);
  if (!navState.today || navState.today.key !== k) {
    const sched = resolveSchedule(d, navState.overrides);
    navState.today = { key: k, sched };
    const el = document.getElementById('hud-sched');
    if (el) {
      el.textContent = sched.short + (sched.override ? ' *' : '');
      el.title = sched.name + (sched.override ? ' (override)' : ' (weekday default)');
    }
  }
  return navState.today.sched;
}

function navTick() {
  const d = new Date();
  const t = document.getElementById('hud-time'), dt = document.getElementById('hud-date'), now = document.getElementById('hud-now');
  if (!t) return;
  t.textContent = `${navPad(d.getHours())}:${navPad(d.getMinutes())}:${navPad(d.getSeconds())}`;
  dt.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  const sched = navSchedFor(d);
  const st = scheduleStatus(d, sched, navState.teaches);
  now.textContent = st.text;
  now.dataset.state = st.state;
  document.dispatchEvent(new CustomEvent('teacherpal:tick', { detail: { now: d, sched, status: st } }));
}

renderTopNav();   // nav.js is loaded at the end of <body>, so the header exists

// periods + overrides feed the readouts; pages reuse them through navReady
const navReady = (async () => {
  if (!isConfigured()) return navState;
  try {
    const [periods, overrides] = await Promise.all([
      getPeriods(),
      getScheduleOverrides().catch((err) => { console.error('schedule overrides', err); setStatus(`Schedule overrides unavailable — run migration-schedule-overrides.sql. (${err.message})`, 'error'); return []; }),
    ]);
    navState.periods = periods;
    navState.overrides = overrides;
    navState.teaches = teachingMap(periods);
    navState.byNumber = new Map();
    for (const p of periods) { const { n } = parsePeriodName(p.name); if (n !== null && !navState.byNumber.has(n)) navState.byNumber.set(n, p); }
    navState.today = null;
  } catch (err) { console.error('nav', err); }
  navTick();
  return navState;
})();

// (shared.js wires [data-fullscreen] buttons at DOMContentLoaded, which fires after this script)

navTick();
setInterval(navTick, 1000);
