// nav.js — the shared top bar on every page: brand, horizontal nav, live
// status readouts (clock · date · schedule · current period + countdown) and
// the full-screen toggle. Loaded after shared.js and schedule.js.
//
// It fills <header class="topbar"> itself, marks the current page, and
// exposes:
//   navReady  — Promise<{ periods, overrides, teaches, byNumber }>
//   'teacherpal:tick' — document event every second, detail { now, sched }
// so pages (the attendance view) don't fetch periods/overrides twice.

// The nav mirrors the hub's sections: four triggers, each opening a menu of
// its pages. Add a screen to the right section here and every page's nav
// updates. The brand is the link to the hub itself.
const NAV_SECTIONS = [
  { id: 'daily', label: 'Daily', items: [
    { href: 'attendance.html', label: 'Attendance' },
    { href: 'bathroom.html', label: 'Bathroom' },
  ] },
  { id: 'tools', label: 'Teacher Tools', items: [
    { href: 'groups.html', label: 'Create Groups' },
    { href: 'timer.html', label: 'Timer' },
    { href: 'noise.html', label: 'Noise Meter' },
    { href: 'wheel.html', label: 'Name Wheel' },
  ] },
  { id: 'planning', label: 'Planning', items: [
    { href: 'lessons.html', label: 'Lesson Plans' },
    { href: 'seating.html', label: 'Seating' },
  ] },
  { id: 'system', label: 'System', items: [
    { href: 'schedule.html', label: 'Schedule' },
    { href: 'roster.html', label: 'Rosters' },
    { href: 'admin.html', label: 'Admin', admin: true },
  ] },
];
// flat list kept for anything that wants "every screen"
const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

const NAV_OPEN_MS = 120;     // hover-in delay, so a passing cursor doesn't open menus
const NAV_CLOSE_MS = 280;    // hover-out grace, so the menu survives the trip to it
const CARET = '<svg class="nav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

const navPad = (n) => String(n).padStart(2, '0');
const navState = { periods: [], overrides: [], teaches: new Map(), byNumber: new Map(), today: null };

function currentPage() {
  const file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  return file === '' ? 'index.html' : file;
}

const SIGN_OUT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';
const SETTINGS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

function renderTopNav() {
  const header = document.querySelector('header.topbar');
  if (!header) return;
  const page = currentPage();
  const admin = typeof isAdmin === 'function' && isAdmin();
  const links = NAV_SECTIONS.map((section) => {
    const items = section.items.filter((it) => !it.admin || admin);  // admin-only entries hide
    if (!items.length) return '';
    const here = items.some((it) => it.href === page);               // highlight the section we're in
    const menu = items.map((it) => {
      const cur = it.href === page ? ' aria-current="page"' : '';
      return `<a class="nav-item" role="menuitem" href="${it.href}"${cur}>${it.label}</a>`;
    }).join('');
    return `
      <div class="nav-group" data-section="${section.id}">
        <button type="button" class="tab nav-trigger"${here ? ' data-here="1"' : ''}
                aria-expanded="false" aria-haspopup="true" aria-controls="navmenu-${section.id}">
          ${section.label}${CARET}
        </button>
        <div class="nav-menu" id="navmenu-${section.id}" role="menu" aria-label="${section.label}" hidden>${menu}</div>
      </div>`;
  }).join('');
  // the hub (body.launcher) shows no links — its panels are the navigation;
  // every other page keeps the full nav, and the wordmark always links home
  const noLinks = document.body.classList.contains('launcher');
  const user = typeof currentUser === 'function' ? currentUser() : null;
  const showAccount = !!user;   // pages without a session hide it
  // How to address them: profiles.display_name → username → email local part.
  const shortName = accountLabel();
  const fullEmail = user ? (user.email || '') : '';
  header.classList.add('hud-bar', 'topnav');
  header.classList.toggle('no-links', noLinks);
  header.innerHTML = `
    <a class="hud-brand" href="index.html"><span class="hud-brand-mark" aria-hidden="true"></span>TeacherPal</a>
    ${noLinks ? '' : `<nav class="nav-links" aria-label="Screens">${links}</nav>`}
    <div class="hud-tail">
      ${showAccount ? `<span class="hud-stat hud-account" title="Signed in as ${escapeHtml(shortName)}${fullEmail && fullEmail !== shortName ? ' (' + escapeHtml(fullEmail) + ')' : ''}"><span class="hud-key">USER</span><span class="hud-val" id="hud-user">${escapeHtml(shortName)}</span></span>` : ''}
      ${renderSettingsMenu()}
      ${showAccount ? `<button type="button" class="icon-btn signout-btn" id="signout-btn" title="Sign out" aria-label="Sign out">${SIGN_OUT_ICON}</button>` : ''}
      <button type="button" class="icon-btn fs-btn" data-fullscreen aria-pressed="false" title="Full screen (F)" aria-label="Toggle full screen"><span class="when-off">${FS_ICON_ENTER}</span><span class="when-on">${FS_ICON_EXIT}</span></button>
    </div>
    <div class="hud-status" aria-live="off">
      <span class="hud-stat"><span class="hud-key">TIME</span><span class="hud-val" id="hud-time">--:--:--</span></span>
      <span class="hud-stat"><span class="hud-key">DATE</span><span class="hud-val" id="hud-date">—</span></span>
      <a class="hud-stat hud-link" href="schedule.html" title="Bell schedules and overrides"><span class="hud-key">SCHED</span><span class="hud-val" id="hud-sched">—</span></a>
      <span class="hud-stat"><span class="hud-key">NOW</span><span class="hud-val" id="hud-now">—</span></span>
    </div>`;

  const soBtn = header.querySelector('#signout-btn');
  if (soBtn) soBtn.addEventListener('click', () => { if (typeof signOut === 'function') signOut(); });
  wireSettingsMenu(header);
  wireNavMenus(header);
}

// Section dropdowns: hover with a short open delay and a longer close delay
// (so the cursor can travel to the panel), click/tap to toggle, full keyboard
// support. The panel lives inside .nav-group, so hovering it counts as
// hovering the group and it can't vanish underneath the pointer.
function wireNavMenus(header) {
  const groups = [...header.querySelectorAll('.nav-group')];
  if (!groups.length) return;
  let openTimer = null, closeTimer = null;

  const items = (g) => [...g.querySelectorAll('.nav-item')];
  const isOpen = (g) => g.dataset.open === '1';

  function open(g, { focusFirst = false } = {}) {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    groups.forEach((other) => { if (other !== g) close(other); });
    g.dataset.open = '1';
    g.querySelector('.nav-trigger').setAttribute('aria-expanded', 'true');
    g.querySelector('.nav-menu').hidden = false;
    if (focusFirst) { const first = items(g)[0]; if (first) first.focus(); }
  }
  function close(g) {
    if (!g) return;
    g.dataset.open = '';
    g.querySelector('.nav-trigger').setAttribute('aria-expanded', 'false');
    g.querySelector('.nav-menu').hidden = true;
  }
  const closeAll = () => { clearTimeout(openTimer); clearTimeout(closeTimer); groups.forEach(close); };

  groups.forEach((g) => {
    const trigger = g.querySelector('.nav-trigger');
    const menu = g.querySelector('.nav-menu');

    g.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;          // touch uses tap, not hover
      clearTimeout(closeTimer);
      openTimer = setTimeout(() => open(g), NAV_OPEN_MS);
    });
    g.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      clearTimeout(openTimer);
      closeTimer = setTimeout(() => close(g), NAV_CLOSE_MS);
    });

    // click / tap toggles (and is the whole story on touch)
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      if (isOpen(g)) close(g); else open(g);
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(g, { focusFirst: true });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        open(g);
        const list = items(g); if (list.length) list[list.length - 1].focus();
      } else if (e.key === 'Escape') {
        close(g);
      }
    });

    menu.addEventListener('keydown', (e) => {
      const list = items(g);
      const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(g); trigger.focus(); }
      else if (e.key === 'Tab') { close(g); }        // tabbing out closes behind you
    });

    // focus moving right out of the group closes it
    g.addEventListener('focusout', () => {
      setTimeout(() => { if (!g.contains(document.activeElement)) close(g); }, 0);
    });
  });

  document.addEventListener('click', (e) => { if (!e.target.closest('.nav-group')) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}

// Small gear dropdown: theme picker + "periods I teach" checkboxes.
// Rendered on every page (login included) so people can preview themes;
// the periods section only shows when there's a session (the setting
// lives on the profile).
function renderSettingsMenu() {
  const themes = (typeof THEMES !== 'undefined' && Array.isArray(THEMES)) ? THEMES : [];
  const current = (typeof currentTheme === 'function') ? currentTheme() : 'jarvis';
  const themeItems = themes.map((t) => `
    <label class="hud-menu-item">
      <input type="radio" name="theme" value="${escapeHtml(t.id)}"${t.id === current ? ' checked' : ''}>
      <span>${escapeHtml(t.label)}</span>
    </label>`).join('');

  let periodsBlock = '';
  const teaches = typeof currentTeachesPeriods === 'function' ? currentTeachesPeriods() : null;
  if (teaches !== null) {
    const set = new Set(teaches);
    const cells = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `
      <label class="hud-period"${set.has(n) ? ' data-on="1"' : ''}>
        <input type="checkbox" name="teach" value="${n}"${set.has(n) ? ' checked' : ''}>
        <span>${n}</span>
      </label>`).join('');
    periodsBlock = `
      <div class="hud-menu-title">Periods I teach</div>
      <div class="hud-periods">${cells}</div>`;
  }

  return `
    <details class="hud-settings" id="hud-settings">
      <summary class="icon-btn settings-btn" title="Settings" aria-label="Settings">${SETTINGS_ICON}</summary>
      <div class="hud-menu" role="menu">
        <div class="hud-menu-title">Theme</div>
        ${themeItems}
        ${periodsBlock}
      </div>
    </details>`;
}

function wireSettingsMenu(header) {
  const details = header.querySelector('#hud-settings');
  if (!details) return;
  // Close when clicking outside.
  document.addEventListener('click', (e) => {
    if (details.open && !details.contains(e.target)) details.open = false;
  });
  // Theme radios.
  details.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      if (typeof setMyTheme === 'function') setMyTheme(input.value);
      details.open = false;
    });
  });
  // Keep radios in sync with any programmatic theme change.
  document.addEventListener('teacherpal:theme', (e) => {
    const t = e.detail && e.detail.theme;
    details.querySelectorAll('input[name="theme"]').forEach((input) => {
      input.checked = input.value === t;
    });
  });
  // Teach-periods checkboxes: save on every toggle. Menu stays open so the
  // user can toggle several without losing their place.
  details.querySelectorAll('input[name="teach"]').forEach((input) => {
    input.addEventListener('change', () => {
      const selected = Array.from(details.querySelectorAll('input[name="teach"]:checked'))
        .map((el) => Number(el.value));
      input.closest('.hud-period').toggleAttribute('data-on', input.checked);
      if (typeof setMyTheme === 'function' && typeof setMyTeachesPeriods === 'function') {
        setMyTeachesPeriods(selected);
      }
    });
  });
}

// The name in the top-bar USER chip: display_name ("Mr. Pal"), else the
// username, else the email's local part.
function accountLabel() {
  if (typeof displayName === 'function') return displayName();
  const u = typeof currentUser === 'function' ? currentUser() : null;
  if (!u) return '';
  return u.username || (u.email ? u.email.split('@')[0] : '');
}

// shared.js re-reads the profile on every page load; when a field actually
// changed (a display_name set in SQL, say) repaint the USER chip in place
// rather than rebuilding the whole bar — re-rendering would re-wire the
// settings menu's document listeners.
document.addEventListener('teacherpal:profile', () => {
  const el = document.getElementById('hud-user');
  if (el) {
    const name = accountLabel();
    el.textContent = name;
    const chip = el.closest('.hud-account');
    const email = (typeof currentUser === 'function' && currentUser() && currentUser().email) || '';
    if (chip) chip.title = `Signed in as ${name}${email && email !== name ? ' (' + email + ')' : ''}`;
  }
});

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
  // 12h in marwa, 24h in jarvis (the default).
  const hour12 = (typeof currentTheme === 'function' && currentTheme() === 'marwa');
  t.textContent = fmtWallClock(d, { hour12, seconds: true });
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
    navState.teaches = teachingMap(periods, currentTeachesPeriods());
    navState.byNumber = new Map();
    for (const p of periods) { const { n } = parsePeriodName(p.name); if (n !== null && !navState.byNumber.has(n)) navState.byNumber.set(n, p); }
    navState.today = null;
  } catch (err) { console.error('nav', err); }
  navTick();
  return navState;
})();

// Rebuild the teaches map + rerender when the user changes which periods
// they teach in the settings menu.
document.addEventListener('teacherpal:teachesPeriods', (e) => {
  const t = e.detail && e.detail.teachesPeriods;
  navState.teaches = teachingMap(navState.periods, t);
  navState.today = null;
  navTick();
});

// (shared.js wires [data-fullscreen] buttons at DOMContentLoaded, which fires after this script)

navTick();
setInterval(navTick, 1000);
