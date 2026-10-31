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
// Auth — Supabase email/password. Accounts come from the Supabase dashboard
// or from self sign-up on login.html (only while an admin has it open, see
// signUp() below). Session persists in localStorage and refreshes itself
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
        display_name: prevUser && prevUser.display_name || null,
        is_admin: !!(prevUser && prevUser.is_admin),
        theme:    prevUser && prevUser.theme || null,
        teaches_periods: (prevUser && Array.isArray(prevUser.teaches_periods))
          ? prevUser.teaches_periods.slice()
          : null,
        setup_done: prevUser ? prevUser.setup_done !== false : true,
      }
    : prevUser;
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: Date.now() + expiresInMs,
    user,
  };
}

// Plain Supabase Auth: email + password underneath. The login form accepts
// either an email OR a username — if the input contains "@" we treat it as
// the email, otherwise we look it up in profiles.username (case-insensitive)
// to find the matching email. Password verification is Supabase's own; we
// never touch hashes. If the username isn't found we throw the same generic
// "Sign-in failed" so callers can't enumerate usernames.
// Sign-in errors: .code, and .field ('id' | 'password' | null) so the form
// can put the message under the right input.
function signInError(message, code, field) {
  const e = new Error(message);
  e.code = code; e.field = field || null;
  return e;
}

async function signIn(usernameOrEmail, password) {
  const raw = String(usernameOrEmail || '').trim();
  if (!raw || !password) throw new Error('Enter your username (or email) and password.');

  let email = raw.toLowerCase();
  if (!raw.includes('@')) {
    email = await lookupEmailByUsername(raw);
    if (!email) throw signInError('That username or password isn\'t right.', 'bad_credentials', 'password');
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error_description || data.msg || data.message || 'Sign-in failed.';
    if (/email not confirmed/i.test(msg) || data.error_code === 'email_not_confirmed') {
      const e = signInError('Confirm your email first: open the link we sent you, then sign in.', 'email_not_confirmed', 'id');
      e.email = email;
      throw e;
    }
    if (/invalid login credentials/i.test(msg) || data.error_code === 'invalid_credentials') {
      throw signInError('That username or password isn\'t right.', 'bad_credentials', 'password');
    }
    if (res.status === 429) throw signInError('Too many tries. Wait a minute, then try again.', 'rate_limited');
    throw signInError(msg, 'failed');
  }
  saveSession(normalizeSession(data));
  await hydrateProfileIntoSession();
  applyTheme((_session && _session.user && _session.user.theme) || DEFAULT_THEME);
  return _session;
}

// Username → email lookup so people can log in with just "khalid" instead
// of the full address: the email_for_username RPC (migration-self-signup.sql),
// falling back to the old anon-readable profiles table before that
// migration. Returns null when the username isn't found (the caller reports
// a generic error either way).
async function lookupEmailByUsername(username) {
  const u = String(username || '').trim();
  if (!u) return null;
  try {
    const email = await sb('rpc/email_for_username', { method: 'POST', body: { p_username: u } });
    return email || null;
  } catch { /* no RPC yet: the legacy lookup below */ }
  const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
  url.searchParams.set('select', 'email');
  url.searchParams.set('username', `ilike.${u}`);
  url.searchParams.set('limit', '1');
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return (rows[0] && rows[0].email) || null;
}

// The teacher's theme lives in profiles.theme, so it follows them from device
// to device; localStorage only caches it for the no-flash head script.
//   • a valid theme on the row  → that's the theme (an old id is renamed, and
//                                 the renamed one written back)
//   • NULL (never chosen on the server: every row from before
//     migration-theme-rename.sql) → adopt this browser's choice and save it,
//                                 so nobody loses the theme they picked
//   • no column / no row        → the database can't say: keep what we have
function profileTheme(p, cached) {
  const local = (() => {
    try { return normalizeTheme(localStorage.getItem(THEME_KEY)); } catch { return null; }
  })();
  if (!p || !('theme' in p)) {
    const t = normalizeTheme(cached) || local;
    return validTheme(t) ? t : DEFAULT_THEME;
  }
  if (p.theme == null) {
    const t = validTheme(local) ? local : DEFAULT_THEME;
    saveThemeToProfile(t);
    return t;
  }
  const t = normalizeTheme(p.theme);
  if (!validTheme(t)) return DEFAULT_THEME;
  if (t !== p.theme) saveThemeToProfile(t);
  return t;
}

// Fire-and-forget write of the theme to the signed-in teacher's profile.
function saveThemeToProfile(theme) {
  sb('rpc/set_my_theme', { method: 'POST', body: { p_theme: theme } })
    .catch((err) => console.error('theme save', err));
}

// Fill session.user with username / display_name / is_admin / theme /
// teaches_periods from the profiles row (which the trigger keeps in sync with
// auth.users). Runs at sign-in AND on every page load (see the bootstrap at
// the bottom of this file) — the session in localStorage is only a cache, so
// a profile edited in the SQL editor shows up on the next page view instead
// of waiting for a sign-out. Broadcasts what changed:
//   'teacherpal:profile'        — any field (nav.js repaints the USER chip)
//   'teacherpal:teachesPeriods' — the array changed (nav.js rebuilds the
//                                 teaches map so NOW / PREP stays right)
// and re-applies the theme if it was changed elsewhere.
async function hydrateProfileIntoSession() {
  if (!_session || !_session.user) return;
  try {
    const rows = await sb('profiles', {
      params: {
        user_id: `eq.${_session.user.id}`,
        select:  '*',   // own row only; * so a column a migration hasn't added yet can't fail the read
        limit:   '1',
      },
    });
    const p = rows && rows[0] ? rows[0] : {};
    const before = JSON.stringify(_session.user);
    const prevTeaches = JSON.stringify(_session.user.teaches_periods || null);

    _session.user.username        = p.username || null;
    _session.user.display_name    = p.display_name || null;
    _session.user.is_admin        = !!p.is_admin;
    _session.user.theme           = profileTheme(p, _session.user.theme);
    // No teaches_periods column (or no row) = nothing to learn: keep what we had.
    _session.user.teaches_periods = Array.isArray(p.teaches_periods)
      ? p.teaches_periods.slice()
      : (Array.isArray(_session.user.teaches_periods) ? _session.user.teaches_periods : [0, 1, 2, 3, 4, 5, 6, 7]);
    _session.user.setup_done      = p.setup_done !== false;   // missing column = an old account = done

    if (JSON.stringify(_session.user) === before) return;   // nothing moved
    saveSession(_session);
    if (currentTheme() !== _session.user.theme) applyTheme(_session.user.theme);
    if (JSON.stringify(_session.user.teaches_periods) !== prevTeaches) {
      document.dispatchEvent(new CustomEvent('teacherpal:teachesPeriods', {
        detail: { teachesPeriods: _session.user.teaches_periods.slice() },
      }));
    }
    document.dispatchEvent(new CustomEvent('teacherpal:profile', {
      detail: { user: _session.user },
    }));
  } catch (err) {
    console.error('profile hydrate failed', err);
  }
}

const isAdmin = () => !!(_session && _session.user && _session.user.is_admin);

// How to address the signed-in teacher: profiles.display_name ("Mr. Pal"),
// falling back to the username, then the local part of the email. Returns ''
// when there's no session. Set at sign-up, or in the SQL editor — the app
// never edits it afterwards.
function displayName() {
  const u = _session && _session.user;
  if (!u) return '';
  const dn = String(u.display_name || '').trim();
  if (dn) return dn;
  if (u.username) return u.username;
  return u.email ? u.email.split('@')[0] : '';
}

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

// ---------------------------------------------------------------------------
// Self sign-up (login.html) and the first-run setup flag.
//
// Sign-up is Supabase's own /auth/v1/signup with email confirmation on. The
// username and display name ride along as user metadata; the
// handle_new_user() trigger (migration-self-signup.sql) turns them into the
// profiles row (is_admin false, theme 'default', setup_done false), so no
// profile write is needed from a browser that has no session yet. Whether
// sign-up is open lives in app_settings (Admin page); while it's closed a
// trigger on auth.users rejects self sign-ups server-side too.
//
// The confirmation email links back to login.html with the tokens in the
// URL hash; completeAuthRedirect() turns that into a session.
// ---------------------------------------------------------------------------

const PASSWORD_MIN = 8;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,30}$/;

// Is self sign-up open? false when it's closed, or before the migration.
async function signupOpen() {
  try { return (await sb('rpc/signup_status', { method: 'POST', body: {} })) === true; }
  catch { return false; }
}

// true / false; throws when the check itself fails (network, no migration).
async function usernameAvailable(username) {
  return (await sb('rpc/username_available', { method: 'POST', body: { p_username: String(username || '').trim() } })) === true;
}

// Where the confirmation email sends people back to.
function authRedirectUrl() {
  const u = new URL(LOGIN_PAGE, location.href);
  u.search = ''; u.hash = '';
  return u.href;
}

// Errors carry .code (and .field, the form field to point at) so the page
// can show them in the right place.
function signupError(message, code, field) {
  const e = new Error(message);
  e.code = code; e.field = field || null;
  return e;
}

// → { confirm: true } when an email went out (the usual case), or
//   { confirm: false } when the project auto-confirms and we're signed in.
async function signUp({ email, password, username, displayName }) {
  const url = `${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(authRedirectUrl())}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      password,
      data: { username: String(username || '').trim(), display_name: String(displayName || '').trim() },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.error_code || data.code || '';
    const msg = String(data.msg || data.error_description || data.message || '');
    if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(msg)) {
      throw signupError('That email already has an account. Sign in instead.', 'email_taken', 'email');
    }
    if (code === 'weak_password' || /password/i.test(msg)) {
      throw signupError(msg || `Use at least ${PASSWORD_MIN} characters for your password.`, 'weak_password', 'password');
    }
    if (code === 'signup_disabled' || /signups? not allowed/i.test(msg)) {
      throw signupError('Sign-up is closed right now. Ask your admin for an account.', 'closed');
    }
    if (code === 'email_address_invalid' || /invalid.*email|email.*invalid/i.test(msg)) {
      throw signupError('That doesn\'t look like a working email address.', 'bad_email', 'email');
    }
    if (res.status === 429 || /rate limit/i.test(msg)) {
      throw signupError('Too many sign-up emails just now. Wait a few minutes and try again.', 'rate_limited');
    }
    if (/database error/i.test(msg)) {
      // Our triggers said no: sign-up closed, or the username went in the meantime.
      if (!(await signupOpen())) throw signupError('Sign-up is closed right now. Ask your admin for an account.', 'closed');
      const free = await usernameAvailable(username).catch(() => true);
      if (!free) throw signupError('That username was just taken. Try another.', 'username_taken', 'username');
    }
    throw signupError(msg || 'Sign-up failed. Try again.', 'failed');
  }
  if (data.access_token) {          // confirmation is off in this project
    saveSession(normalizeSession(data));
    await hydrateProfileIntoSession();
    applyTheme((_session && _session.user && _session.user.theme) || DEFAULT_THEME);
    return { confirm: false };
  }
  const user = data.user || data;
  // With confirmation on, Supabase answers an already-registered address
  // with a stand-in user that has no identities (it won't say so outright).
  if (user && Array.isArray(user.identities) && user.identities.length === 0) {
    throw signupError('That email already has an account. Sign in instead.', 'email_taken', 'email');
  }
  return { confirm: true };
}

async function resendSignupEmail(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/resend?redirect_to=${encodeURIComponent(authRedirectUrl())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ type: 'signup', email: String(email || '').trim().toLowerCase() }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = String(data.msg || data.error_description || data.message || '');
    if (res.status === 429 || /rate limit|seconds/i.test(msg)) throw new Error('Wait a minute before sending another email.');
    throw new Error(msg || 'Couldn\'t send the email. Try again.');
  }
}

// Landing back from a confirmation email: login.html#access_token=…&type=signup
// (or #error=…&error_description=… / ?error=… when the link is stale).
// → null (nothing in the URL), { error }, or { signedIn: true }.
// Clears the tokens out of the address bar either way.
async function completeAuthRedirect() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const errText = hash.get('error_description') || query.get('error_description');
  const token = hash.get('access_token');
  if (!errText && !token) return null;
  const clean = () => {
    const q = new URLSearchParams(location.search);
    ['error', 'error_code', 'error_description'].forEach((k) => q.delete(k));
    const qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
  };
  if (errText) {
    clean();
    const code = hash.get('error_code') || query.get('error_code') || '';
    return {
      error: code === 'otp_expired' || /expired|invalid/i.test(errText)
        ? 'That confirmation link has expired or was already used. Sign in below: if your email still needs confirming, you can send a new link from there.'
        : errText.replace(/\+/g, ' '),
    };
  }
  const type = hash.get('type') || '';
  clean();
  if (!['signup', 'magiclink', 'email', 'email_change', 'recovery'].includes(type)) {
    return { error: 'That link isn\'t one TeacherPal can use. Sign in with your password.' };
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { error: 'That link didn\'t work. Sign in with your password.' };
  const user = await res.json();
  saveSession(normalizeSession({
    access_token: token,
    refresh_token: hash.get('refresh_token'),
    expires_in: Number(hash.get('expires_in')) || 3600,
    user,
  }));
  await hydrateProfileIntoSession();
  applyTheme((_session && _session.user && _session.user.theme) || DEFAULT_THEME);
  return { signedIn: true, recovery: type === 'recovery' };
}

// "Forgot password?": Supabase's reset email. Takes a username or an email.
// Resolves the same way whether or not there is such an account, so the
// page can't be used to find out who has one.
async function requestPasswordReset(usernameOrEmail) {
  const raw = String(usernameOrEmail || '').trim();
  const email = raw.includes('@') ? raw.toLowerCase() : await lookupEmailByUsername(raw);
  if (!email) return;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(authRedirectUrl())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email }),
  });
  if (res.status === 429) throw new Error('Too many reset emails just now. Wait a few minutes and try again.');
  if (res.status >= 500) throw new Error('Couldn\'t send the email right now. Try again in a moment.');
}

// The new password, from the reset link's session (login.html's reset panel).
async function updatePassword(password) {
  if (!_session) throw signupError('That reset link has expired. Ask for a new one.', 'no_session');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${_session.access_token}` },
    body: JSON.stringify({ password }),
  });
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  const code = data.error_code || data.code || '';
  const msg = String(data.msg || data.error_description || data.message || '');
  if (code === 'same_password' || /different from the old/i.test(msg)) {
    throw signupError('That\'s your current password. Choose a new one.', 'same_password', 'password');
  }
  if (code === 'weak_password' || /password/i.test(msg)) throw signupError(msg, 'weak_password', 'password');
  if (res.status === 401) throw signupError('That reset link has expired. Ask for a new one.', 'no_session');
  throw signupError(msg || 'Couldn\'t save the new password. Try again.', 'failed');
}

// First-run setup (setup.html). New self-signed-up accounts start with
// profiles.setup_done = false; finishing or skipping the wizard sets it.
function needsSetup() {
  return !!(_session && _session.user && _session.user.setup_done === false);
}
async function markSetupDone() {
  if (_session && _session.user) { _session.user.setup_done = true; saveSession(_session); }
  await sb('rpc/set_my_setup_done', { method: 'POST', body: { p_done: true } });
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
// A confirmation email that came back to some other page (Supabase's Site
// URL, say) carries its tokens or error in the hash: hand it to the login
// page, which knows what to do with it.
const AUTH_LANDING = /(?:^#|&)(?:access_token|error_description)=/.test(location.hash);
if (AUTH_LANDING && !pageAllowsAnon()) {
  if (document.documentElement) document.documentElement.style.visibility = 'hidden';
  location.replace(LOGIN_PAGE + location.hash);
} else if (isConfigured()) {
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
// Admin read RPC — the users list on admin.html. Users are created and
// their passwords managed in the Supabase dashboard directly; there is no
// in-app create/reset flow anymore.
// ---------------------------------------------------------------------------

async function adminListUsers() {
  return sb('rpc/admin_list_users', { method: 'POST', body: {} });
}

// The self sign-up switch (app_settings.signup_open). Returns the new state.
async function adminSetSignupOpen(open) {
  return (await sb('rpc/admin_set_signup_open', { method: 'POST', body: { p_open: !!open } })) === true;
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
  // students and seating arrangements cascade in the database
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

// Every student in every period (bathroom quarter review, "All periods").
async function getAllStudents() {
  return sb('students', { params: { select: '*', order: 'sort_order.asc,name.asc' } });
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
// LEGACY: the old shared room + per-period seats. Nothing writes these any
// more (every arrangement owns its desks); they're read only as a fallback
// for rows from before migration-arrangement-layouts.sql.
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

// The period's LIVE seats (what Attendance shows) = its active arrangement.
// assignments: { "<pieceId>:<seatIndex>": "<student id>" }
// Falls back to the old seat_assignments table only when seating_arrangements
// doesn't exist yet (migration-seating-arrangements.sql not run).
async function getSeatAssignments(periodId) {
  let rows;
  try {
    rows = await sb('seating_arrangements', {
      params: { select: 'assignments', period_id: `eq.${periodId}`, is_active: 'is.true', limit: 1 },
    });
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    rows = await sb('seat_assignments', {
      params: { select: 'assignments', period_id: `eq.${periodId}`, limit: 1 },
    });
  }
  return rows[0] ? rows[0].assignments || {} : {};
}

// The period's LIVE chart: its active arrangement's own desks + seats →
// { layout, assignments } (layout null = no desks). Each arrangement owns its
// layout (migration-arrangement-layouts.sql); a row that predates that, or a
// project without seating_arrangements yet, falls back to the old shared room.
async function getActiveSeating(periodId) {
  let row = null;
  try {
    const rows = await sb('seating_arrangements', {
      params: { select: 'layout,assignments', period_id: `eq.${periodId}`, is_active: 'is.true', limit: 1 },
    });
    row = rows[0] || null;
    if (!row) return { layout: null, assignments: {} };
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }
  const assignments = row ? row.assignments || {} : await getSeatAssignments(periodId);
  const layout = row && row.layout && Array.isArray(row.layout.pieces) ? row.layout : await getRoomLayout().catch(() => null);
  return { layout, assignments };
}

// PostgREST's answer for a table it doesn't know about (404 / PGRST205)
function isMissingTableError(err) {
  return /\(404\)|PGRST20[0-9]|does not exist/.test(String(err && err.message));
}

// ---------------------------------------------------------------------------
// Seating arrangements — several named charts per period; at most one is
// active (is_active = what Attendance shows). Each owns BOTH its desk
// layout and its seats, so a draft can be a completely different room.
// ---------------------------------------------------------------------------

async function getSeatingArrangements(periodId) {
  return sb('seating_arrangements', {
    params: { select: '*', period_id: `eq.${periodId}`, order: 'created_at.asc' },
  });
}

async function createSeatingArrangement(periodId, { name, assignments = {}, layout = null, isActive = false }) {
  const rows = await sb('seating_arrangements', {
    method: 'POST',
    body: { period_id: periodId, name, assignments, layout, is_active: isActive, updated_at: new Date().toISOString() },
  });
  return rows[0];
}

// fields: any of { name, assignments, layout }
async function updateSeatingArrangement(id, fields) {
  const rows = await sb('seating_arrangements', {
    method: 'PATCH',
    params: { id: `eq.${id}` },
    body: { ...fields, updated_at: new Date().toISOString() },
  });
  return rows[0];
}

async function deleteSeatingArrangement(id) {
  return sb('seating_arrangements', { method: 'DELETE', params: { id: `eq.${id}` } });
}

// One transaction server-side: this one on, every other one in its period off.
async function setActiveSeatingArrangement(id) {
  return sb('rpc/set_active_seating_arrangement', { method: 'POST', body: { p_id: id } });
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

// "Sitting out" — here for today, but not in the grouping (nurse, testing,
// working alone). Grouping-only and deliberately NOT attendance: it never
// touches the attendance table or the absent cache, and like the absent cache
// it is keyed by date so it clears itself tomorrow.
// teacherpal.sitout.<periodId> = { date, ids }
const sitOutCacheKey = (periodId) => `teacherpal.sitout.${periodId}`;
function readSitOutCache(periodId) {
  try {
    const raw = JSON.parse(localStorage.getItem(sitOutCacheKey(periodId)) || 'null');
    if (raw && raw.date === todayKey() && Array.isArray(raw.ids)) return new Set(raw.ids);
  } catch { /* ignore */ }
  return new Set();
}
function writeSitOutCache(periodId, ids) {
  try {
    const list = [...ids];
    if (list.length === 0) localStorage.removeItem(sitOutCacheKey(periodId));
    else localStorage.setItem(sitOutCacheKey(periodId), JSON.stringify({ date: todayKey(), ids: list }));
  } catch { /* ignore */ }
}

// All periods' attendance rows for one date (the hub's period strip).
async function getAttendanceForDate(date) {
  return sb('attendance', { params: { select: 'period_id,marks', date: `eq.${date}` } });
}

// ---------------------------------------------------------------------------
// Pick lists — the Name Wheel's named rotations per period ("Board work",
// "Cold call"). A list's picked students are rows in pick_list_picks; no row
// = still to go. Picks last until the list is reset, across days and devices.
// ---------------------------------------------------------------------------

async function getPickLists(periodId) {
  return sb('pick_lists', {
    params: { select: '*', period_id: `eq.${periodId}`, order: 'sort_order.asc,created_at.asc' },
  });
}
async function createPickList(periodId, name, sortOrder = 0) {
  const rows = await sb('pick_lists', { method: 'POST', body: { period_id: periodId, name: name.trim(), sort_order: sortOrder } });
  return rows[0];
}
async function renamePickList(id, name) {
  const rows = await sb('pick_lists', { method: 'PATCH', params: { id: `eq.${id}` }, body: { name: name.trim() } });
  return rows[0];
}
// its picks go with it (cascade)
async function deletePickList(id) {
  return sb('pick_lists', { method: 'DELETE', params: { id: `eq.${id}` } });
}
// → [{ student_id, picked_at, manual }] oldest first
async function getPickListPicks(listId) {
  return sb('pick_list_picks', {
    params: { select: 'student_id,picked_at,manual', list_id: `eq.${listId}`, order: 'picked_at.asc' },
  });
}
// Mark picked. Picking someone already picked moves their date to now.
async function addPickListPick(listId, studentId, { manual = false, at = new Date().toISOString() } = {}) {
  const rows = await sb('pick_list_picks', {
    method: 'POST',
    params: { on_conflict: 'list_id,student_id' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { list_id: listId, student_id: studentId, picked_at: at, manual },
  });
  return rows[0];
}
async function removePickListPick(listId, studentId) {
  return sb('pick_list_picks', {
    method: 'DELETE',
    params: { list_id: `eq.${listId}`, student_id: `eq.${studentId}` },
    prefer: 'return=minimal',
  });
}
// Reset: everyone back to "still to go".
async function clearPickListPicks(listId) {
  return sb('pick_list_picks', { method: 'DELETE', params: { list_id: `eq.${listId}` }, prefer: 'return=minimal' });
}

// ---------------------------------------------------------------------------
// Courses — what a teacher teaches. Several periods share one through
// periods.course_id; lesson plans belong to the course, not the period.
// Attendance, seating, groups and bathroom stay per period.
// ---------------------------------------------------------------------------

async function getCourses() {
  return sb('courses', { params: { select: '*', order: 'sort_order.asc,name.asc' } });
}
async function createCourse(name, sortOrder = 0) {
  const rows = await sb('courses', { method: 'POST', body: { name: name.trim(), sort_order: sortOrder } });
  return rows[0];
}
async function renameCourse(id, name) {
  const rows = await sb('courses', { method: 'PATCH', params: { id: `eq.${id}` }, body: { name: name.trim() } });
  return rows[0];
}
// its periods become unassigned; its lesson plans and attachments are deleted (cascade)
async function deleteCourse(id) {
  return sb('courses', { method: 'DELETE', params: { id: `eq.${id}` } });
}
// courseId null = the period stands on its own
async function setPeriodCourse(periodId, courseId) {
  const rows = await sb('periods', { method: 'PATCH', params: { id: `eq.${periodId}` }, body: { course_id: courseId || null } });
  return rows[0];
}
// how many plans a course holds (the delete warning)
async function countCoursePlans(courseId) {
  const rows = await sb('lesson_plans', { params: { select: 'id', course_id: `eq.${courseId}` } });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Lesson plans — one row per (course, date): the plan every period of the
// course follows. A row keyed by a period instead is that period's own plan:
// a "split" for one day when the period belongs to a course, or the only plan
// of a period that has no course.
//   target = { courseId } | { periodId }      (exactly one)
// plan: { objective, agenda: [{ id, text, minutes|null, done }], materials, homework, notes }
// ---------------------------------------------------------------------------

const EMPTY_PLAN = () => ({ objective: '', agenda: [], materials: '', homework: '', notes: '' });
// PostgREST filter / insert columns for a target
const planWhere = (t) => (t.courseId ? { course_id: `eq.${t.courseId}` } : { period_id: `eq.${t.periodId}` });
const planOwner = (t) => (t.courseId ? { course_id: t.courseId } : { period_id: t.periodId });

async function getLessonPlan(target, date) {
  const rows = await sb('lesson_plans', { params: { select: '*', ...planWhere(target), date: `eq.${date}`, limit: 1 } });
  return rows[0] || null;
}

// every plan (course and period rows alike) between two dates, inclusive
async function getLessonPlansRange(dateFrom, dateTo) {
  return sb('lesson_plans', {
    params: { select: '*', and: `(date.gte.${dateFrom},date.lte.${dateTo})`, order: 'date.asc' },
  });
}

// upsert on (course_id, date) or (period_id, date)
async function saveLessonPlan(target, date, plan) {
  const saved = await sb('lesson_plans', {
    method: 'POST',
    params: { on_conflict: target.courseId ? 'course_id,date' : 'period_id,date' },
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      ...planOwner(target), date,
      objective: plan.objective || '', agenda: plan.agenda || [],
      materials: plan.materials || '', homework: plan.homework || '', notes: plan.notes || '',
      updated_at: new Date().toISOString(),
    },
  });
  return saved[0];
}

async function deleteLessonPlan(target, date) {
  return sb('lesson_plans', { method: 'DELETE', params: { ...planWhere(target), date: `eq.${date}` } });
}

// this target's plans, newest first (Copy from another day)
async function getRecentLessonPlans(target, limit = 30) {
  return sb('lesson_plans', { params: { select: '*', ...planWhere(target), order: 'date.desc', limit } });
}

// Every row of a table, paged past PostgREST's 1000-row cap (search index).
async function sbAll(table, params) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await sb(table, { params: { ...params, limit: 1000, offset } });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// every plan ever written (Lesson Plans search)
async function getAllLessonPlans() {
  return sbAll('lesson_plans', { select: '*', order: 'date.desc' });
}

// ---------------------------------------------------------------------------
// Lesson attachments — files and links on a plan's day, keyed exactly like
// the plans (target = { courseId } | { periodId }). Rows live in
// lesson_attachments; files in the private Storage bucket 'lesson-files' at
// <owner uid>/<course or period id>/<date>/<random id>.<ext> (the original name is the
// row's `name`). Storage policies only let a teacher touch their own uid
// folder; files are read through short-lived signed URLs, never public ones.
// row: { id, course_id, period_id, date, kind: 'file'|'link', name, storage_path, url, mime, size, sort_order }
// ---------------------------------------------------------------------------

const LESSON_BUCKET = 'lesson-files';
const LESSON_FILE_MAX = 50 * 1024 * 1024;    // matches the bucket's file_size_limit

const storageKeyUrl = (key) => `${SUPABASE_URL}/storage/v1/object/${LESSON_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function freshToken() {
  if (_session && _session.expires_at && Date.now() > _session.expires_at - 60_000) await refreshSession().catch(() => null);
}

// One Storage API call with the same refresh-once-on-401 rule as sb().
// send(headers) performs the request and resolves { ok, status, raw }.
async function storageCall(send) {
  if (!isConfigured()) throw new Error('Supabase is not configured.');
  await freshToken();
  let res = await send(authHeaders());
  // (Storage reports an expired token as 400/403 "jwt expired", not always 401)
  if ((res.status === 401 || (res.status >= 400 && /jwt/i.test(res.raw))) && _session) {
    if (!(await refreshSession().catch(() => null))) { saveSession(null); redirectToLogin(); throw new Error('Your session expired. Please sign in again.'); }
    res = await send(authHeaders());
  }
  if (!res.ok) {
    let msg = res.raw;
    try { const j = JSON.parse(res.raw); msg = j.message || j.error || msg; } catch {}
    if (/bucket not found/i.test(msg)) msg = 'the lesson-files bucket is missing — run migration-lesson-attachments.sql';
    throw new Error(`Storage ${res.status}: ${msg}`);
  }
  return res.raw ? (() => { try { return JSON.parse(res.raw); } catch { return res.raw; } })() : null;
}
const fetchRes = async (url, init) => { const r = await fetch(url, init); return { ok: r.ok, status: r.status, raw: await r.text() }; };

async function getLessonAttachments(target, date) {
  return sb('lesson_attachments', { params: { select: '*', ...planWhere(target), date: `eq.${date}`, order: 'sort_order.asc,created_at.asc' } });
}
// every attachment between two dates (inclusive) — cell and month counts
async function getLessonAttachmentsRange(dateFrom, dateTo) {
  return sb('lesson_attachments', { params: { select: '*', and: `(date.gte.${dateFrom},date.lte.${dateTo})`, order: 'date.asc' } });
}
// every attachment (Lesson Plans search)
async function getAllLessonAttachments() {
  return sbAll('lesson_attachments', { select: '*', order: 'date.desc' });
}

// Upload one File to Storage, then record it. onProgress(0..1) follows the
// upload (XHR — fetch can't report it). If the row can't be written the
// object is removed again, so nothing is left orphaned.
async function uploadLessonFile(target, date, file, { onProgress, sortOrder = 0 } = {}) {
  if (file.size > LESSON_FILE_MAX) throw new Error(`${file.name} is over the 50 MB limit.`);
  const user = currentUser();
  if (!user) throw new Error('Not signed in.');
  const ext = (file.name.match(/\.([A-Za-z0-9]{1,10})$/) || [])[1];
  const rand = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const key = `${user.id}/${target.courseId || target.periodId}/${date}/${rand}${ext ? `.${ext.toLowerCase()}` : ''}`;
  const mime = file.type || 'application/octet-stream';
  await storageCall((headers) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', storageKeyUrl(key));
    for (const [k, v] of Object.entries({ ...headers, 'Content-Type': mime, 'x-upsert': 'false', 'cache-control': '3600' })) xhr.setRequestHeader(k, v);
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, raw: xhr.responseText });
    xhr.onerror = () => reject(new Error(`Upload of ${file.name} failed — check the connection.`));
    xhr.send(file);
  }));
  try {
    const rows = await sb('lesson_attachments', { method: 'POST', body: { ...planOwner(target), date, kind: 'file', name: file.name.slice(0, 300), storage_path: key, mime, size: file.size, sort_order: sortOrder } });
    return rows[0];
  } catch (err) {
    await storageCall((h) => fetchRes(storageKeyUrl(key), { method: 'DELETE', headers: h })).catch(() => {});
    throw err;
  }
}

async function addLessonLink(target, date, { url, name, sortOrder = 0 }) {
  const rows = await sb('lesson_attachments', { method: 'POST', body: { ...planOwner(target), date, kind: 'link', url, name: (name || url).slice(0, 300), sort_order: sortOrder } });
  return rows[0];
}

// Copy attachments onto another target's day. Files are not duplicated in
// Storage: the new rows point at the same object, which is only removed when
// the last row using it is deleted.
async function copyLessonAttachments(rows, target, date, startOrder = 0) {
  if (!rows.length) return [];
  return sb('lesson_attachments', { method: 'POST', body: rows.map((a, i) => ({
    ...planOwner(target), date, kind: a.kind, name: a.name, storage_path: a.storage_path || null,
    url: a.url || null, mime: a.mime || null, size: a.size ?? null, sort_order: startOrder + i,
  })) });
}

// Removes the row, then the file once no other row uses it (copies share
// one object). A stray object is invisible; a row without its file would be
// a broken download — hence this order.
async function deleteLessonAttachment(att) {
  await sb('lesson_attachments', { method: 'DELETE', params: { id: `eq.${att.id}` } });
  const shared = att.kind === 'file' && att.storage_path
    ? await sb('lesson_attachments', { params: { select: 'id', storage_path: `eq.${att.storage_path}`, limit: 1 } }).catch(() => [{}])
    : [{}];
  if (!shared.length) {
    await storageCall((h) => fetchRes(storageKeyUrl(att.storage_path), { method: 'DELETE', headers: h })).catch((err) => console.warn('storage delete', err));
  }
}

// A short-lived URL for a private file. download: true makes the browser save
// it under its original name instead of showing it.
async function lessonFileUrl(att, { download = false, expiresIn = 600 } = {}) {
  const key = att.storage_path.split('/').map(encodeURIComponent).join('/');
  const data = await storageCall((h) => fetchRes(`${SUPABASE_URL}/storage/v1/object/sign/${LESSON_BUCKET}/${key}`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn }),
  }));
  const signed = data.signedURL || data.signedUrl;
  return `${SUPABASE_URL}/storage/v1${signed}${download ? `&download=${encodeURIComponent(att.name)}` : ''}`;
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

// Every period's rows that can belong to one quarter: timed trips dated in
// [from, to] (either end may be null = open) plus the manual tallies tagged
// with that quarter. The caller re-checks each trip's quarter against its
// own quarter dates, so a range a little too wide is harmless.
async function getBathroomQuarter(quarter, from, to) {
  const range = [from && `date.gte.${from}`, to && `date.lte.${to}`].filter(Boolean);
  const trips = range.length ? `and(manual.eq.false,${range.join(',')})` : 'manual.eq.false';
  // Paged: Supabase caps a response at 1000 rows, and a quarter of every
  // period can pass that.
  const PAGE = 1000, out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await sb('bathroom_log', {
      params: { select: '*', or: `(${trips},and(manual.eq.true,quarter.eq.${quarter}))`, order: 'out_at.asc,id.asc', limit: PAGE, offset },
    });
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
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

// Backfill a past trip by hand — used by the Bathroom settings dialog when
// entering paper-tracker records. out_at is required; in_at may be null
// (still-out) or a later ISO. date is the calendar day the trip belongs
// to (used for quarter attribution).
async function insertBathroomTrip({ periodId, studentId, date, outAt, inAt = null }) {
  const rows = await sb('bathroom_log', {
    method: 'POST',
    body: {
      period_id:  periodId,
      student_id: studentId,
      date,
      out_at:     outAt,
      in_at:      inAt,
    },
  });
  return rows[0];
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

// Roster numbers: each student's place in the period's roster sorted by last
// name (the last word of the name, then the whole name), from 1 — the number
// Aeries uses. A hand-set students.roster_number wins, and the alphabetical
// numbering skips the numbers those take. students = one period's rows.
// Returns Map<studentId, number>.
function rosterLastName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts[parts.length - 1] || '';
}
function rosterNumbers(students) {
  const nums = new Map();
  const taken = new Set();
  for (const s of students) {
    if (Number.isInteger(s.roster_number) && s.roster_number > 0) { nums.set(s.id, s.roster_number); taken.add(s.roster_number); }
  }
  const key = (s) => `${rosterLastName(s.name)} ${s.name}`;
  const rest = students.filter((s) => !nums.has(s.id))
    .sort((a, b) => key(a).localeCompare(key(b), undefined, { sensitivity: 'base' }));
  let n = 1;
  for (const s of rest) { while (taken.has(n)) n++; nums.set(s.id, n++); }
  return nums;
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
const DEFAULT_THEME = 'default';
const THEMES = [
  { id: 'default', label: 'Default' },
  { id: 'pink',    label: 'Pink'    },
  { id: 'halloween', label: 'Halloween' },
  { id: 'thanksgiving', label: 'Thanksgiving' },
];

// Old theme ids, from before the rename (migration-theme-rename.sql moves
// the profiles column over; this covers a stale localStorage / session cache
// and a database that hasn't been migrated yet). The head script in every
// page carries the same map.
const LEGACY_THEMES = { jarvis: 'default', marwa: 'pink', earthy: 'default' };
function normalizeTheme(id) { return (id && LEGACY_THEMES[id]) || id; }

function validTheme(id) { return !!(id && THEMES.some((t) => t.id === id)); }
function currentTheme() { return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME; }

// Apply and cache locally. Does not touch the server — call setMyTheme for that.
// A page whose <html> carries data-theme-lock (login.html) keeps its own
// theme on screen: the choice is still cached for the next page.
function applyTheme(theme) {
  theme = normalizeTheme(theme);
  const t = validTheme(theme) ? theme : DEFAULT_THEME;
  if (!document.documentElement.hasAttribute('data-theme-lock')) {
    document.documentElement.setAttribute('data-theme', t);
  }
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  document.dispatchEvent(new CustomEvent('teacherpal:theme', { detail: { theme: t } }));
}

// User-triggered theme change: apply immediately, save to server profile.
async function setMyTheme(theme) {
  theme = normalizeTheme(theme);
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

// Re-read the profile once per page load. The stored session is a cache;
// this is what makes a display_name / theme / is_admin / teaches_periods
// change made in the Supabase dashboard or SQL editor appear without
// signing out. Fire and forget — the page renders from the cached values
// immediately and repaints from 'teacherpal:profile' if anything differs.
if (isConfigured() && _session && !pageAllowsAnon()) {
  hydrateProfileIntoSession().catch(() => { /* logged inside */ });
}

document.addEventListener('DOMContentLoaded', () => {
  // Warn loudly if shared.js still has placeholder config.
  if (!isConfigured()) {
    setStatus('Supabase is not configured yet — paste your URL and anon key into shared.js.', 'error');
  }
});
