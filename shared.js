// shared.js — the ONLY file that talks to Supabase.
//
// Loaded first on every page. Owns:
//   • Supabase REST client (`sb()`)
//   • Auth: sign in / out, session storage, token refresh, redirect-if-missing
//   • Data helpers (periods, students, room, attendance, lessons, bathroom, …)
//   • Full-screen system
//
// Multi-tenant: every table has an owner_id column with a default of
// auth.uid() at the DB level, so INSERTs from an authenticated session get
// the right owner for free. Reads are filtered by RLS; the client just
// queries as normal.

// ---------------------------------------------------------------------------
// Config — paste your project values here (Supabase dashboard > Settings > API)
// The anon key is public — it's safe to ship. Security comes from RLS.
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://pnkgblhdagusaysvclka.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2dibGhkYWd1c2F5c3ZjbGthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1OTA4OTgsImV4cCI6MjEwNTE2Njg5OH0.KqzPdCtU2kIl-i9qHGOOkotqlVlGS53jx5DcHydTmL4';

// ---------------------------------------------------------------------------
// Auth — Supabase email/password, no public sign-up (accounts created in the
// Supabase dashboard). Session persists in localStorage and refreshes itself
// silently. Pages without `body.no-auth` are redirected to login.html when
// there is no session (or the refresh fails).
// ---------------------------------------------------------------------------

const SESSION_KEY = 'teacherpal.session';
const LOGIN_PAGE = 'login.html';

function isConfigured() {
  return SUPABASE_URL.startsWith('http') && !SUPABASE_ANON_KEY.startsWith('PASTE_');
}

// Pages that don't require a session (login itself; add any student-facing
// pages here in the future).
function pageAllowsAnon() {
  const b = document.body;
  if (!b) return false;
  if (b.classList.contains('no-auth')) return true;
  const file = (location.pathname.split('/').pop() || '').toLowerCase();
  return file === LOGIN_PAGE;
}

let _session = null; // { access_token, refresh_token, expires_at (ms), user: { id, email } }

function readStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.access_token || !s.refresh_token) return null;
    return s;
  } catch { return null; }
}

function saveSession(s) {
  _session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

function currentSession() { return _session; }
function currentUser() { return _session ? _session.user : null; }
function hasSession() { return !!_session; }

// Turn Supabase's token response into our stored shape. Preserves the
// username we attached at sign-in (it doesn't come back from the token
// endpoint) across refreshes.
function normalizeSession(raw) {
  const expiresInMs = (raw.expires_in || 3600) * 1000;
  const prevUser = _session ? _session.user : null;
  const user = raw.user
    ? {
        id: raw.user.id,
        email: raw.user.email,
        username: prevUser && prevUser.username || null,
        is_admin: !!(prevUser && prevUser.is_admin),
        theme:    prevUser && prevUser.theme || null,
        teaches_periods: (prevUser && Array.isArray(prevUser.teaches_periods))
          ? prevUser.teaches_periods.slice()
          : null,
      }
    : prevUser;
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: Date.now() + expiresInMs,
    user,
  };
}

// Resolve a username to the account's profile row so we can call Supabase's
// email+password auth underneath *and* pick up is_admin in the same fetch.
// Reads the `profiles` table (anon-readable). Returns null when the username
// doesn't exist — the caller reports a generic "Sign-in failed" either way,
// so usernames can't be enumerated.
async function resolveUsernameToProfile(username) {
  const u = String(username || '').trim();
  if (!u) return null;
  const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
  url.searchParams.set('select', 'user_id,username,email,is_admin,theme,teaches_periods');
  url.searchParams.set('username', `ilike.${u}`);
  url.searchParams.set('limit', '1');
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return rows[0] || null;
}

// Back-compat alias — some code may still want just the email.
async function resolveUsernameToEmail(username) {
  const p = await resolveUsernameToProfile(username);
  return p ? p.email : null;
}

async function signIn(username, password) {
  const trimmed = String(username || '').trim();
  const profile = await resolveUsernameToProfile(trimmed);
  if (!profile) throw new Error('Sign-in failed.');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: profile.email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Sign-in failed.');   // generic on purpose — no enumeration
  const session = normalizeSession(data);
  if (session && session.user) {
    session.user.username = profile.username || trimmed;
    session.user.is_admin = !!profile.is_admin;
    session.user.theme    = profile.theme || DEFAULT_THEME;
    session.user.teaches_periods = Array.isArray(profile.teaches_periods)
      ? profile.teaches_periods.slice()
      : [0, 1, 2, 3, 4, 5, 6, 7];
  }
  saveSession(session);
  applyTheme(session && session.user ? session.user.theme : DEFAULT_THEME);
  return _session;
}

const isAdmin = () => !!(_session && _session.user && _session.user.is_admin);

// Bell periods the signed-in user teaches (0..7). Returns a sorted array of
// ints. Null means "not configured" — callers should treat that as
// "assume all periods". Used by scheduleStatus, teachingMap, and the
// period-select filter in fillPeriodSelect.
function currentTeachesPeriods() {
  if (!_session || !_session.user) return null;
  const t = _session.user.teaches_periods;
  return Array.isArray(t) ? t : null;
}

// Update the signed-in user's teaches_periods (server + local session +
// broadcast so nav.js can recompute the status readout without a reload).
async function setMyTeachesPeriods(periods) {
  const clean = [...new Set((periods || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 7))]
    .sort((a, b) => a - b);
  if (_session && _session.user) {
    _session.user.teaches_periods = clean;
    saveSession(_session);
    document.dispatchEvent(new CustomEvent('teacherpal:teachesPeriods', { detail: { teachesPeriods: clean } }));
  }
  try {
    await sb('rpc/set_my_teaches_periods', { method: 'POST', body: { p_periods: clean } });
  } catch (err) {
    console.error('save teaches_periods', err);
  }
  return clean;
}

async function signOut() {
  const s = _session;
  saveSession(null);
  if (s) {
    // Best effort — the local session is already cleared.
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` },
      });
    } catch { /* ignore */ }
  }
  redirectToLogin();
}

let _refreshInFlight = null;
async function refreshSession() {
  if (!_session || !_session.refresh_token) return null;
  // Coalesce concurrent callers — Supabase invalidates the refresh token
  // after use, so two parallel POSTs would 401 the second one.
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: _session.refresh_token }),
      });
      if (!res.ok) { saveSession(null); return null; }
      const data = await res.json();
      saveSession(normalizeSession(data));
      return _session;
    } finally {
      _refreshInFlight = null;
    }
  })();
  return _refreshInFlight;
}

function redirectToLogin() {
  if (pageAllowsAnon()) return;
  const here = location.pathname.split('/').pop() || 'index.html';
  const from = here.toLowerCase() === LOGIN_PAGE ? '' : `?from=${encodeURIComponent(here + location.search)}`;
  location.replace(LOGIN_PAGE + from);
}

// Loaded synchronously at the top of the file so page scripts don't try to
// hit Supabase without a session. Also kicks off a silent refresh if the
// token is close to expiring.
_session = readStoredSession();
if (isConfigured()) {
  if (!_session && !pageAllowsAnon()) {
    // Hide the page while we bounce to /login so the user doesn't see a flash.
    if (document.documentElement) document.documentElement.style.visibility = 'hidden';
    redirectToLogin();
  } else if (_session && _session.expires_at && Date.now() > _session.expires_at - 60_000) {
    // Fire and forget — sb() will also refresh on demand.
    refreshSession().catch(() => { /* handled inside */ });
  }
}

// ---------------------------------------------------------------------------
// Low-level REST client
// ---------------------------------------------------------------------------

// The bearer is the user's access token when signed in, otherwise the anon
// key (so unauthenticated pages, if any, can still hit their own narrow-
// policy tables).
function authHeaders() {
  const bearer = (_session && _session.access_token) || SUPABASE_ANON_KEY;
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${bearer}` };
}

// sb('students', { params: { select: '*', period_id: 'eq.<uuid>' } })
// sb('students', { method: 'POST', body: [...] })
// sb('students', { method: 'PATCH', params: { id: 'eq.<uuid>' }, body: {...} })
// sb('students', { method: 'DELETE', params: { id: 'eq.<uuid>' } })
async function sb(table, opts = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase is not configured. Paste your URL and anon key into shared.js.');
  }
  // Refresh proactively when the access token is within 60s of expiring.
  if (_session && _session.expires_at && Date.now() > _session.expires_at - 60_000) {
    await refreshSession().catch(() => { /* handled below */ });
  }
  const res = await sbFetch(table, opts);
  if (res.status === 401 && _session) {
    // Token was rejected — try once to refresh, then retry the request.
    const refreshed = await refreshSession().catch(() => null);
    if (refreshed) {
      const retry = await sbFetch(table, opts);
      if (retry.ok) return retry.data;
      if (retry.status === 401) {
        saveSession(null);
        redirectToLogin();
        throw new Error('Your session expired. Please sign in again.');
      }
      throw new Error(`${opts.method || 'GET'} ${table} failed (${retry.status}): ${retry.raw}`);
    }
    saveSession(null);
    redirectToLogin();
    throw new Error('Your session expired. Please sign in again.');
  }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${table} failed (${res.status}): ${res.raw}`);
  return res.data;
}

async function sbFetch(table, { method = 'GET', params, body, prefer } = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { ...authHeaders(), 'Content-Type': 'application/json' };
  const preferValue = prefer || (method === 'GET' ? '' : 'return=representation');
  if (preferValue) headers.Prefer = preferValue;
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
  return { ok: res.ok, status: res.status, raw, data };
}

// ---------------------------------------------------------------------------
// Admin RPCs — call the SECURITY DEFINER functions in migration-admin.sql.
// The functions themselves check that auth.uid() belongs to an admin, so a
// non-admin who bypasses the client-side gate still gets 'not authorized'.
// PostgREST maps RPCs to POST /rest/v1/rpc/<function_name> with a JSON body
// of named parameters. sb() handles the auth/refresh/401 flow the same as
// table calls.
// ---------------------------------------------------------------------------

// Synthetic email for admin-created accounts. Supabase Auth needs one
// internally (email+password grant), but TeacherPal signs in by username, so
// we don't ask the admin for a real address — we mint <username>@teacherpal.local
// deterministically. Password reset via email won't work for these accounts;
// use the admin page instead.
const SYNTHETIC_EMAIL_DOMAIN = 'teacherpal.local';
function syntheticEmailFor(username) {
  const local = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return `${local}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

async function adminCreateUser(username, password) {
  return sb('rpc/admin_create_user', {
    method: 'POST',
    body: {
      p_username: username,
      p_email:    syntheticEmailFor(username),
      p_password: password,
    },
  });
}

async function adminResetPassword(userId, password) {
  return sb('rpc/admin_reset_password', {
    method: 'POST',
    body: { p_user_id: userId, p_password: password },
  });
}

async function adminListUsers() {
  return sb('rpc/admin_list_users', { method: 'POST', body: {} });
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

async function getPeriods() {
  return sb('periods', { params: { select: '*', order: 'sort_order.asc,name.asc' } });
}

async function createPeriod(name, sortOrder = 0) {
  const rows = await sb('periods', { method: 'POST', body: { name, sort_order: sortOrder } });
  return rows[0];
}

async function renamePeriod(id, name) {
  const rows = await sb('periods', { method: 'PATCH', params: { id: `eq.${id}` }, body: { name } });
  return rows[0];
}

async function deletePeriod(id) {
  // students and seat_assignments cascade in the database
  return sb('periods', { method: 'DELETE', params: { id: `eq.${id}` } });
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

async function getStudents(periodId) {
  return sb('students', {
    params: { select: '*', period_id: `eq.${periodId}`, order: 'sort_order.asc,name.asc' },
  });
}

// names: array of strings. Returns the inserted rows.
async function addStudents(periodId, names, startSortOrder = 0) {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return [];
  const body = clean.map((name, i) => ({
    period_id: periodId,
    name,
    sort_order: startSortOrder + i,
  }));
  return sb('students', { method: 'POST', body });
}

// Total students across all periods (ids only — cheap). Used by the hub readout.
async function countStudents() {
  const rows = await sb('students', { params: { select: 'id' } });
  return rows.length;
}

// Map<periodId, studentCount> in one call (hub period strip)
async function countStudentsByPeriod() {
  const rows = await sb('students', { params: { select: 'period_id' } });
  const map = new Map();
  for (const r of rows) map.set(r.period_id, (map.get(r.period_id) || 0) + 1);
  return map;
}

async function updateStudent(id, fields) {
  const rows = await sb('students', { method: 'PATCH', params: { id: `eq.${id}` }, body: fields });
  return rows[0];
}

async function deleteStudent(id) {
  return sb('students', { method: 'DELETE', params: { id: `eq.${id}` } });
}

// ---------------------------------------------------------------------------
// Room layout (one shared room) + seat assignments (one row per period)
// ---------------------------------------------------------------------------

const ROOM_KEY = 'default';

// layout: { version, grid, front: {x,y,w,h}, pieces: [{ id, type, x, y, rotation }] }
async function getRoomLayout() {
  const rows = await sb('room_layouts', {
    params: { select: '*', key: `eq.${ROOM_KEY}`, limit: 1 },
  });
  return rows[0] ? rows[0].layout : null;
}

async function saveRoomLayout(layout) {
  // (key, owner_id) is the per-owner unique index — owner_id defaults to
  // auth.uid() at the DB, so we don't send it here.
  const saved = await sb('room_layouts', {
    method: 'POST',
    params: { on_conflict: 'key,owner_id' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { key: ROOM_KEY, layout, updated_at: new Date().toISOString() },
  });
  return saved[0];
}

// assignments: { "<pieceId>:<seatIndex>": "<student id>" }
async function getSeatAssignments(periodId) {
  const rows = await sb('seat_assignments', {
    params: { select: '*', period_id: `eq.${periodId}`, limit: 1 },
  });
  return rows[0] ? rows[0].assignments : {};
}

async function saveSeatAssignments(periodId, assignments) {
  const saved = await sb('seat_assignments', {
    method: 'POST',
    params: { on_conflict: 'period_id' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { period_id: periodId, assignments, updated_at: new Date().toISOString() },
  });
  return saved[0];
}

// ---------------------------------------------------------------------------
// Formula rules — one row per (period, scope). Seating rules and grouping
// rules are SEPARATE data sets: scope is 'seating' or 'grouping', and every
// read/write here touches exactly one scope. Only the algorithms in
// formula.js are shared, never the rule data.
// rules: [{ id, type, a, b?, hard }] in priority order; use_formula: this scope's toggle
// ---------------------------------------------------------------------------

const RULE_SCOPES = ['seating', 'grouping'];
function assertScope(scope) {
  if (!RULE_SCOPES.includes(scope)) throw new Error(`Unknown rule scope: ${scope}`);
}

async function getFormulaRules(periodId, scope) {
  assertScope(scope);
  const rows = await sb('seating_rules', {
    params: { select: '*', period_id: `eq.${periodId}`, scope: `eq.${scope}`, limit: 1 },
  });
  return rows[0] ? { rules: rows[0].rules || [], useFormula: !!rows[0].use_formula } : { rules: [], useFormula: false };
}

async function saveFormulaRules(periodId, scope, rules, useFormula) {
  assertScope(scope);
  const saved = await sb('seating_rules', {
    method: 'POST',
    params: { on_conflict: 'period_id,scope' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { period_id: periodId, scope, rules, use_formula: !!useFormula, updated_at: new Date().toISOString() },
  });
  return saved[0];
}

// ---------------------------------------------------------------------------
// Attendance — one row per (period, date). Present students are simply
// absent from `marks`; only absences and tardies are stored.
// marks: { "<student uuid>": { status: 'absent' | 'tardy', at: ISO timestamp } }
// ---------------------------------------------------------------------------

async function getAttendance(periodId, date) {
  const rows = await sb('attendance', {
    params: { select: '*', period_id: `eq.${periodId}`, date: `eq.${date}`, limit: 1 },
  });
  return rows[0] ? { marks: rows[0].marks || {}, updatedAt: rows[0].updated_at } : null;
}

async function saveAttendance(periodId, date, marks) {
  const saved = await sb('attendance', {
    method: 'POST',
    params: { on_conflict: 'period_id,date' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { period_id: periodId, date, marks, updated_at: new Date().toISOString() },
  });
  return saved[0];
}

// Today's absentees, cached in localStorage so Create Groups / Seating can
// read them without a round trip: teacherpal.absent.<periodId> = { date, ids }.
// The hub and Create Groups both write it; Supabase `attendance` is the truth.
const absentCacheKey = (periodId) => `teacherpal.absent.${periodId}`;
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function readAbsentCache(periodId) {
  try {
    const raw = JSON.parse(localStorage.getItem(absentCacheKey(periodId)) || 'null');
    if (raw && raw.date === todayKey() && Array.isArray(raw.ids)) return new Set(raw.ids);
  } catch { /* ignore */ }
  return new Set();
}
function writeAbsentCache(periodId, ids) {
  try {
    const list = [...ids];
    if (list.length === 0) localStorage.removeItem(absentCacheKey(periodId));
    else localStorage.setItem(absentCacheKey(periodId), JSON.stringify({ date: todayKey(), ids: list }));
  } catch { /* ignore */ }
}
// The ids marked absent in a marks object (tardy students count as present).
const absentIdsOf = (marks) => new Set(Object.keys(marks || {}).filter((id) => marks[id] && marks[id].status === 'absent'));

// All periods' attendance rows for one date (the hub's period strip).
async function getAttendanceForDate(date) {
  return sb('attendance', { params: { select: 'period_id,marks', date: `eq.${date}` } });
}

// ---------------------------------------------------------------------------
// Lesson plans — one row per (period, date).
// plan: { objective, agenda: [{ id, text, minutes|null, done }], materials, homework, notes }
// ---------------------------------------------------------------------------

const EMPTY_PLAN = () => ({ objective: '', agenda: [], materials: '', homework: '', notes: '' });

async function getLessonPlan(periodId, date) {
  const rows = await sb('lesson_plans', {
    params: { select: '*', period_id: `eq.${periodId}`, date: `eq.${date}`, limit: 1 },
  });
  return rows[0] || null;
}

// every plan between two dates (inclusive), for the week view
async function getLessonPlansRange(dateFrom, dateTo) {
  return sb('lesson_plans', {
    params: { select: '*', and: `(date.gte.${dateFrom},date.lte.${dateTo})`, order: 'date.asc' },
  });
}

async function saveLessonPlan(periodId, date, plan) {
  const saved = await sb('lesson_plans', {
    method: 'POST',
    params: { on_conflict: 'period_id,date' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      period_id: periodId, date,
      objective: plan.objective || '', agenda: plan.agenda || [],
      materials: plan.materials || '', homework: plan.homework || '', notes: plan.notes || '',
      updated_at: new Date().toISOString(),
    },
  });
  return saved[0];
}

async function deleteLessonPlan(periodId, date) {
  return sb('lesson_plans', { method: 'DELETE', params: { period_id: `eq.${periodId}`, date: `eq.${date}` } });
}

// ---------------------------------------------------------------------------
// Bathroom log — one row per trip. in_at is null while the student is out.
// ---------------------------------------------------------------------------

async function getBathroomLog(periodId, date) {
  return sb('bathroom_log', {
    params: { select: '*', period_id: `eq.${periodId}`, date: `eq.${date}`, order: 'out_at.asc' },
  });
}

// every trip for a period (all dates) — per-student history / frequency
async function getBathroomHistory(periodId) {
  return sb('bathroom_log', { params: { select: '*', period_id: `eq.${periodId}`, order: 'out_at.desc', limit: 2000 } });
}

async function bathroomSignOut(periodId, studentId, date) {
  const rows = await sb('bathroom_log', {
    method: 'POST',
    body: { period_id: periodId, student_id: studentId, date, out_at: new Date().toISOString() },
  });
  return rows[0];
}

async function bathroomSignIn(id) {
  const rows = await sb('bathroom_log', { method: 'PATCH', params: { id: `eq.${id}` }, body: { in_at: new Date().toISOString() } });
  return rows[0];
}

async function deleteBathroomTrip(id) {
  return sb('bathroom_log', { method: 'DELETE', params: { id: `eq.${id}` } });
}

// Manual tallies (paper tracker / adjustments): one row per (student, quarter)
// with manual = true, count = passes used, no time recorded. count 0 deletes.
// (The uniqueness is a partial index, which PostgREST upserts can't target,
// so this is a read-then-write.)
async function setManualTally(periodId, studentId, quarter, count) {
  const rows = await sb('bathroom_log', {
    params: { select: 'id', student_id: `eq.${studentId}`, quarter: `eq.${quarter}`, manual: 'eq.true', limit: 1 },
  });
  const existing = rows[0];
  if (count <= 0) {
    if (existing) await sb('bathroom_log', { method: 'DELETE', params: { id: `eq.${existing.id}` } });
    return null;
  }
  if (existing) {
    return (await sb('bathroom_log', { method: 'PATCH', params: { id: `eq.${existing.id}` }, body: { count, period_id: periodId } }))[0];
  }
  const now = new Date().toISOString();
  return (await sb('bathroom_log', {
    method: 'POST',
    body: { period_id: periodId, student_id: studentId, date: todayKey(), out_at: now, in_at: now, manual: true, quarter, count },
  }))[0];
}

// ---------------------------------------------------------------------------
// Schedule overrides — one row per date that does NOT follow the weekday
// default bell schedule (Minimum Day, Finals, No School, …). The schedules
// themselves live in schedule.js; this is only the date → schedule table.
// row: { id, date: 'YYYY-MM-DD', schedule, finals_pair: '1-2'|'3-4'|'5-6'|null, note }
// ---------------------------------------------------------------------------

async function getScheduleOverrides() {
  return sb('schedule_overrides', { params: { select: '*', order: 'date.asc' } });
}

async function saveScheduleOverride({ date, schedule, finals_pair = null, note = null }) {
  const saved = await sb('schedule_overrides', {
    method: 'POST',
    params: { on_conflict: 'date,owner_id' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { date, schedule, finals_pair: schedule === 'finals' ? finals_pair : null, note },
  });
  return saved[0];
}

async function deleteScheduleOverride(id) {
  return sb('schedule_overrides', { method: 'DELETE', params: { id: `eq.${id}` } });
}

// ---------------------------------------------------------------------------
// Small UI helpers shared by every page
// ---------------------------------------------------------------------------

const LAST_PERIOD_KEY = 'teacherpal.lastPeriodId';

function getLastPeriodId() {
  try { return localStorage.getItem(LAST_PERIOD_KEY); } catch { return null; }
}

function setLastPeriodId(id) {
  try { localStorage.setItem(LAST_PERIOD_KEY, id || ''); } catch { /* ignore */ }
}

// Fills a <select> with periods and restores the last-used one.
// Filters the roster to only the bell periods the signed-in user teaches
// (session.user.teaches_periods); roster entries whose name can't be
// parsed into a bell number always pass through so weird/legacy names
// don't silently disappear.
// Returns the selected period id (or null if there are no periods).
function fillPeriodSelect(selectEl, periods, preferredId) {
  selectEl.innerHTML = '';
  const teaches = currentTeachesPeriods();
  const list = teaches && typeof parsePeriodName === 'function'
    ? periods.filter((p) => {
        const { n } = parsePeriodName(p.name);
        return n === null || teaches.includes(n);
      })
    : periods;
  if (list.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No periods yet';
    selectEl.appendChild(opt);
    return null;
  }
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  }
  const wanted = preferredId || getLastPeriodId();
  const chosen = list.find((p) => p.id === wanted) ? wanted : list[0].id;
  selectEl.value = chosen;
  setLastPeriodId(chosen);
  return chosen;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Fisher-Yates; returns a new array.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shows a message in the page's #status element (if present).
function setStatus(message, kind = 'info') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message || '';
  // keep any extra classes the page put on the element (e.g. no-present)
  el.classList.remove('status-info', 'status-ok', 'status-error');
  if (message) el.classList.add(`status-${kind}`);
}

function showError(err) {
  console.error(err);
  setStatus(err.message || String(err), 'error');
}

// ---------------------------------------------------------------------------
// Full screen — ONE big-screen system for every page.
// `body.present` is the big-screen layout (rail + chrome hidden, `.no-present`
// elements gone, larger type/borders); the browser Fullscreen API is layered
// on top whenever it is allowed. Pages react through the 'teacherpal:present'
// event instead of keeping their own present/fullscreen code.
//   toggleFullscreen() / enterFullscreen() / exitFullscreen(), isPresent()
//   [data-fullscreen] buttons toggle it and mirror the state in aria-pressed
//   F toggles (not while typing / in a dialog), Esc exits, and the last state
//   is remembered in localStorage so it carries across page navigation.
// ---------------------------------------------------------------------------

const FS_KEY = 'teacherpal.fullscreen';
let fsLeaving = false;   // set while the page is unloading so a browser fullscreen exit on navigation isn't "remembered"

const isPresent = () => document.body.classList.contains('present');
const isTyping = (el) => !!(el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]'));

function syncFullscreenButtons() {
  const on = String(isPresent());
  document.querySelectorAll('[data-fullscreen]').forEach((b) => b.setAttribute('aria-pressed', on));
  const hint = document.querySelector('.fs-float .fs-hint');
  if (hint) hint.hidden = !isPresent() || !!document.fullscreenElement;
}

function setPresentMode(on, { remember = true } = {}) {
  const was = isPresent();
  document.body.classList.toggle('present', on);
  if (!on) document.body.classList.remove('show-nav');
  if (remember) { try { localStorage.setItem(FS_KEY, on ? '1' : '0'); } catch { /* ignore */ } }
  syncFullscreenButtons();
  if (was !== on) document.dispatchEvent(new CustomEvent('teacherpal:present', { detail: { on } }));
}

async function enterFullscreen() {
  setPresentMode(true);
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch { /* not allowed (no gesture / iframe) — the big-screen layout still applies */ }
  syncFullscreenButtons();
}

async function exitFullscreen() {
  setPresentMode(false);
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ }
}

function toggleFullscreen() { return isPresent() ? exitFullscreen() : enterFullscreen(); }

const FS_ICON_ENTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const FS_ICON_EXIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

document.addEventListener('DOMContentLoaded', () => {
  // floating controls, visible only in big-screen mode: bring the nav back / exit
  const float = document.createElement('div');
  float.className = 'fs-float';
  float.setAttribute('role', 'toolbar');
  float.setAttribute('aria-label', 'Full screen controls');
  float.innerHTML = `
    <span class="fs-hint" hidden>Press F for full screen</span>
    <button type="button" class="fs-nav" data-fs-nav aria-pressed="false" title="Show navigation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>Nav</button>
    <button type="button" class="fs-exit" data-fullscreen title="Exit full screen (Esc)">${FS_ICON_EXIT}Exit</button>`;
  document.body.appendChild(float);
  float.querySelector('[data-fs-nav]').addEventListener('click', (e) => {
    const on = document.body.classList.toggle('show-nav');
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('[data-fullscreen]').forEach((b) => b.addEventListener('click', toggleFullscreen));

  // carry the last state across pages (true fullscreen needs a gesture again — F re-arms it)
  let saved = null;
  try { saved = localStorage.getItem(FS_KEY); } catch { /* ignore */ }
  if (saved === '1') setPresentMode(true, { remember: false });
  syncFullscreenButtons();
});

document.addEventListener('fullscreenchange', () => {
  // the browser left fullscreen on its own (Esc, F11, another app) → leave big-screen mode too
  if (!document.fullscreenElement && isPresent() && !fsLeaving) setPresentMode(false);
  syncFullscreenButtons();
});
window.addEventListener('pagehide', () => { fsLeaving = true; });
window.addEventListener('beforeunload', () => { fsLeaving = true; });

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || isTyping(e.target) || document.querySelector('dialog[open]')) return;
  if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFullscreen(); }
  else if (e.key === 'Escape' && isPresent() && !document.fullscreenElement) exitFullscreen();
});

// ---------------------------------------------------------------------------
// Themes — per-user visual styles.
//
// The registry below is the source of truth for which themes exist. A theme
// is just a token block in style.css (`:root[data-theme="<id>"] { ... }`)
// plus optional theme-scoped overrides.
//
// A tiny inline script in every page's <head> runs *before* the stylesheet
// parses, and sets data-theme on <html> from localStorage['teacherpal.theme'].
// That's what prevents a flash of the wrong theme. This file just:
//   • keeps the applied theme in sync with the signed-in profile,
//   • exposes applyTheme / currentTheme / setMyTheme for the nav settings
//     menu and the login-time hydration.
// ---------------------------------------------------------------------------

const THEME_KEY = 'teacherpal.theme';
const DEFAULT_THEME = 'jarvis';
const THEMES = [
  { id: 'jarvis', label: 'Jarvis' },
  { id: 'marwa',  label: 'Marwa'  },
];

function validTheme(id) { return !!(id && THEMES.some((t) => t.id === id)); }
function currentTheme() { return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME; }

// Apply and cache locally. Does not touch the server — call setMyTheme for that.
function applyTheme(theme) {
  const t = validTheme(theme) ? theme : DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  document.dispatchEvent(new CustomEvent('teacherpal:theme', { detail: { theme: t } }));
}

// User-triggered theme change: apply immediately, save to server profile.
async function setMyTheme(theme) {
  const t = validTheme(theme) ? theme : DEFAULT_THEME;
  applyTheme(t);
  if (_session && _session.user) {
    _session.user.theme = t;
    saveSession(_session);
    try {
      await sb('rpc/set_my_theme', { method: 'POST', body: { p_theme: t } });
    } catch (err) {
      // Non-fatal — the theme is applied locally; server persistence is
      // best-effort.
      console.error('theme save', err);
    }
  }
}

// If we already have a stored session with a theme, apply it now so pages
// come up in the right theme even before the head script runs.
if (_session && _session.user && _session.user.theme) applyTheme(_session.user.theme);

document.addEventListener('DOMContentLoaded', () => {
  // Warn loudly if shared.js still has placeholder config.
  if (!isConfigured()) {
    setStatus('Supabase is not configured yet — paste your URL and anon key into shared.js.', 'error');
  }
});
