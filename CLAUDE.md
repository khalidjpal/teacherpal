# TeacherPal

A teacher hub web app for West High: a period dashboard (live seating chart + attendance + bell-schedule status), rosters, Create Groups, and a seating chart.
Built for a classroom projector — big type, high contrast, minimal chrome.
Dark dashboard look with a subtle pink accent (see design-ref.png).

## Stack

- **Plain HTML / CSS / JS. No npm, no bundler, no build step, no framework.**
  Open any `.html` file in a browser and it works.
- **Supabase** (Postgres + PostgREST) as the backend, called directly over the
  REST API with `fetch`. No `@supabase/supabase-js` client.
- **Vercel** static hosting. Deploys the repo root as-is; no `vercel.json` needed.
- **Supabase Auth (email/password), no public sign-up.** Accounts are created
  in the Supabase dashboard; every request goes as an authenticated user with
  a Bearer access token. The anon key is still shipped (harmless — RLS blocks
  it) so future student-facing pages (if any) can hit their own
  narrow-policy tables without a login. See the Auth section below.

## Screens

Eleven screens behind **four grouped dropdowns** in the top nav (built by
`nav.js` on every page), mirroring the hub's sections: **Daily**
(Attendance, Bathroom) · **Teacher Tools** (Create Groups, Timer, Noise
Meter, Name Wheel) · **Planning** (Lesson Plans, Seating) · **System**
(Schedule, Rosters, Admin). The brand at the left is the link to the hub. The active
screen gets `aria-current="page"` (pink fill). The nav bar also carries
the live readouts — clock, date, SCHED, NOW period + countdown — and the
full-screen toggle. There is no sidebar; every page uses the full width.

| Screen | File | What it is for |
|--------|------|----------------|
| Hub | `index.html` | **Launcher only**: the tools as a balanced grid of HUD panels (icon · name · a few words). No live data, no Supabase calls of its own |
| Attendance | `attendance.html` | Taking roll: the seating chart large and central with click-to-cycle, counts, absent/tardy lists, Copy list, Reset, date control; the screen to project |
| Lesson Plans | `lessons.html` | Writing plans: a Mon–Fri week grid across all periods (jump to any date, ← → ↑ ↓ to move) with the full editor for the selected cell beside it |
| Create Groups | `groups.html` | Random / formula groups, projector view in full screen |
| Timer | `timer.html` | Classroom countdown / stopwatch: big digits, presets, ±1 min, mute, pop-out + Picture-in-Picture for the projector while another tab is active |
| Name Wheel | `wheel.html` | Cold-calling: spin a wheel of the period's present students, big name in the middle, no-repeats mode, projector pop-out |
| Noise Meter | `noise.html` | Room volume from the laptop mic: big green/amber/red meter, three zones with activity presets, "Too loud" hold + chime, pop-out for the projector. Mic only while you hold it on |
| Seating | `seating.html` | Room builder + seat assignment |
| Bathroom | `bathroom.html` | Bathroom tracker: tap a card to sign out (quick tap or timer); live Out-now strip with End timer, per-student pass checkboxes, red flag past the limit; toolbar is just period + gear, settings + date + log/history collapsed out of the main view |
| Rosters | `roster.html` | Setup: periods + students |
| Schedule | `schedule.html` | Setup: bell-schedule overrides + reference |

## File structure

| File           | Purpose |
|----------------|---------|
| `login.html`   | Sign-in page (`body.hub.no-auth`): HUD-styled email/password form; loads only `shared.js` and calls `signIn(email, password)`. Redirects back to `?from=…` on success, else `index.html` |
| `admin.html`   | Admin-only read-only user list. Users are created and passwords set in the Supabase dashboard. Guarded client-side (`isAdmin()` → redirect). Loads `shared.js`, `schedule.js`, `nav.js` |
| `migration-auth.sql` | One-off migration that adds `owner_id` to every table, backfills existing rows to Khalid's uuid, drops the "TEMP anon full access" policies and creates per-owner select/insert/update/delete policies. Run in the Supabase SQL editor before deploying the auth code |
| `migration-usernames.sql` | Historical: added the `profiles` table (user_id, username, email). Username-based sign-in is retired; the column is now nullable and only used as an optional display name |
| `migration-admin.sql` | Historical: added `profiles.is_admin` and the admin RPCs. The write RPCs (`admin_create_user`, `admin_reset_password`) are dropped by `migration-simplify-auth.sql`; `admin_list_users` stays, and `profiles.is_admin` stays |
| `migration-simplify-auth.sql` | Drops the admin write RPCs, adds `on_auth_user_created` + `on_auth_user_email_change` triggers so every dashboard-created user gets a profiles row automatically, makes `profiles.username` nullable, and backfills missing profiles rows |
| `migration-rekey-owner.sql` | One-off migration for when the auth user was deleted and recreated: repoints every `owner_id` from the old UID to the new one and rebuilds the `profiles.khalid` row |
| `migration-themes.sql` | One-off migration that adds `profiles.theme text default 'jarvis'` and the `set_my_theme(text)` SECURITY DEFINER RPC (validated `^[a-z0-9_-]+$`, updates only the caller's own row) |
| `migration-teaches-periods.sql` | One-off migration that adds `profiles.teaches_periods integer[]` (each entry 0-7) and the `set_my_teaches_periods(int[])` RPC. Seeds `khalid` to `{1,2,3,5,6}` and `marwa` to `{2,3,4,5,6}` |
| `migration-display-name.sql` | One-off migration that adds `profiles.display_name text` (how the teacher is addressed — the top-bar USER chip) and seeds `khalid` → "Mr. Pal", `marwa` → "Ms. Mohammadi" |
| `index.html`   | Hub launcher (`body.hub.launcher`): `.hub-sections` — four labelled sections (Daily, Teacher tools, Planning, System) each with its own `.hub-panels` row of `.hud-panel` links; loads only `shared.js`, `schedule.js`, `nav.js` (top bar **without** nav links — the panels are the nav) |
| `attendance.html` | Attendance screen: `#attendance` in **full** mode — big chart + side column with counts, lists, Copy, Reset, date |
| `nav.js`       | Shared top bar: renders brand + nav links + readouts + full-screen button into `<header class="topbar">`, marks the active page, runs the clock / bell status (`teacherpal:tick`), exposes `navReady` (periods, overrides, teaches, byNumber). Loaded on every page after `shared.js` + `schedule.js`. |
| `lessons.html` | Lesson Plans screen: week grid (inline script) + `#lesson` editor from `lesson.js` |
| `bathroom.html` | Bathroom Tracker screen: `#bathroom` built by `bathroom.js` |
| `lesson.js`    | `initLessonPanel({ mount, follow, onChange })` — the lesson-plan editor (objective, checkable agenda with minutes, materials, homework, notes; inline editing, 800ms autosave, empty state, Copy from period / Copy yesterday). `follow: true` tracks `teacherpal:period` (hub); otherwise `panel.show(periodId, date)`. |
| `bathroom.js`  | `initBathroom()` — the bathroom tracker (tiles, sign out/in, live elapsed, flag + cap settings in localStorage, log, history). |
| `timer.html`   | Timer screen: the `.timer-stage` (mode toggle, label, big display + ring, presets, custom min/sec, start/reset/±1, mute, Pop out, PiP, full screen) — loads `timer.js`. |
| `timer.js`     | Countdown + stopwatch logic, plus `buildDial()` / `paintDial()` for the themed dial. **End-timestamp model**: state is `{ mode, running, paused, label, muted, targetMs, endsAt, remainingAtPause, startedAt, elapsedAtPause, zeroed }` in `localStorage['teacherpal.timer.state']`; every window computes the display from `Date.now()` against `endsAt`/`startedAt`, so tab-throttling doesn't drift. `BroadcastChannel('teacherpal-timer')` syncs main ↔ pop-out ↔ PiP. Web Audio API beep on zero (respects mute). `documentPictureInPicture.requestWindow()` on Chrome for an always-on-top floating display. Space toggles start/pause. |
| `noise.html`   | Noise Meter screen: the `.noise-stage` (activity presets, big reading + bar + zone word, Start/Stop, chime mute, Pop out, full screen, the two zone sliders, privacy line) — loads `noise.js`. |
| `noise.js`     | Mic → `AnalyserNode` → RMS → a 35–95 relative "dB" reading, 500ms rolling average, three zones, "Too loud" after 3s in the red, optional chime. Polls on `setInterval` (**not** rAF — rAF freezes in a background window and the pop-out would stall). `BroadcastChannel('teacherpal-noise')` feeds the pop-out. Opens the mic only on Start; stops every track on Stop and on `pagehide`. Nothing is recorded or sent anywhere. |
| `wheel.html`   | Name Wheel screen: control row (period, AUTO, count, First names / No repeats / Reset / tick mute / Pop out / full screen) then the wheel, Spin, the picked-student actions and the called strip — loads `wheel.js`. |
| `wheel.js`     | The wheel: draws the slices as SVG into `#wheel-rotor` (the only thing that spins), runs the spin on rAF with an ease-out, ticks as each slice passes the pointer, and syncs the pop-out over `BroadcastChannel('teacherpal-wheel')`. **Winner is drawn first** (`crypto.getRandomValues`), then the landing rotation is computed — the animation can't bias it. |
| `wheel-popout.html` | Read-only projector wheel (`body.wheel-popout`): same dial filling the window, fed by broadcast, no controls. |
| `noise-popout.html` | Read-only projector pop-out (`body.noise-popout`): reading + bar + zone word, fed over BroadcastChannel. Never opens a mic of its own; says so when the main window isn't answering. |
| `timer-popout.html` | Minimal read-only pop-out window (`body.timer-popout`): label + display + the same themed dial filling the window, no controls; listens for state via BroadcastChannel. |
| `migration-lessons-bathroom.sql` | One-off migration creating `lesson_plans` + `bathroom_log` (incl. the manual-tally columns; run in the Supabase SQL editor) |
| `seed-bathroom-q1.sql` | Seed: Q1 used-pass tallies from the paper tracker — name-matches students per period, creates three missing students, upserts manual tallies, reports unmatched names in its last result set |
| `attendance.js` | `initAttendance({ mode: 'full' \| 'compact' })` builds and runs the attendance view (chart or tiles, click-to-cycle, AUTO period, date, counts, lists, Copy, Reset, autosave). Data only via `shared.js`; bell data via `navReady`. |
| `room.js`      | Seating-room geometry shared by the builder and the hub chart: `G`, `TYPES`, `FRONT`, `pieceTransform`, `bbox`, `labelStyle`, `roomBounds`. No DOM state, no Supabase. |
| `shared.js`    | Supabase config + REST client + data helpers + small UI helpers. **The only file that talks to Supabase.** |
| `schedule.js`  | West High bell schedules as data (`SCHEDULES`, `FINALS_PAIRS`, `SCHEDULE_OPTIONS`) + pure helpers: `resolveSchedule(date, overrides)`, `scheduleStatus(now, sched, teaches)`, `teachingMap(periods, teachesPeriods?)`, `parsePeriodName`, `dateKey`, `formatCountdown`, `fmt12`, `fmtWallClock(date, {hour12, seconds})`. No DOM, no Supabase. |
| `formula.js`   | Shared Formula **algorithms and modal only** — never rule data: type metadata per scope (`RULE_TYPES`, `SCOPE_TYPES`, `KEY_TYPES`), priorities (`sortByPriority`, `priorityWeight`, `planRules`), feasibility (`findImpossibleHard`, `confirmImpossible`), the `annealAssign()` solver, `groupWithFormula()`, `summarizeRun()`, `absentTodayFor()`, `createFormulaModal({ scope, … })`. No Supabase calls. |
| `style.css`    | Shared styling for every page (dark pink dashboard theme; all tokens at the top) |
| `roster.html`  | Two-panel roster: period panel (search, sort, add, import modal, edit mode, full screen) + name-card grid with undo-toast remove |
| `groups.html`  | **Create Groups**: three panels across the top — **Group size** (mode toggle + number), **Roster** (period, one-line summary, Edit Roster → the roster modal) and **Create** (big Create Groups / Reshuffle button, Formula, Follow-rules switch, gear, full screen) — with the group cards filling everything below. First names is the only field left in the `.groups-settings-dialog`. FLIP-animated: names fly out of the Roster panel on Create and between cards on Reshuffle |
| `seating.html` | Freeform room builder: palette of desk pieces on a zoomable dot-grid canvas (Arrange Room), then drag names onto seats (Assign Seats); layout shared, seats per period, autosave, full screen |
| `migration-room-builder.sql` | One-off migration for the room builder tables (run in the Supabase SQL editor) |
| `migration-seating-rules.sql` | One-off migration creating the formula rules table (run in the Supabase SQL editor) |
| `migration-rule-scopes.sql` | One-off migration splitting rules into `scope` = seating / grouping (copies existing rules into both, then `notify pgrst`) |
| `migration-attendance.sql` | One-off migration creating the `attendance` table (run in the Supabase SQL editor) |
| `migration-schedule-overrides.sql` | One-off migration creating `schedule_overrides` + seeding the six finals dates (run in the Supabase SQL editor) |
| `schedule.html` | Schedule admin: date → schedule overrides (add / remove, finals pair, note) and a bell-schedule reference table with the roster's classes filled in |
| `schema.sql`   | Tables + RLS policies. Run in the Supabase SQL editor. Safe to re-run. |
| `design-ref.png` | Visual reference for the current theme (blue in the image = pink here) |

Every page: `<link rel="stylesheet" href="style.css">`, an **empty**
`<header class="topbar"></header>` (nav.js fills it), then at the end of
`<body>`: `shared.js`, `schedule.js`, (`formula.js` on Seating and Create
Groups, `room.js` on Seating / hub / attendance), `nav.js`, then the page's
own script (`attendance.js` + `initAttendance()` on Attendance; `lesson.js`
on Lesson Plans; `bathroom.js` on Bathroom; `timer.js` on Timer; nothing on
the hub; an inline `<script>` elsewhere). Pages should have a
`<div id="status" class="status"></div>` so `setStatus()` / `showError()`
have somewhere to write.

## Auth — multi-tenant model

TeacherPal is multi-user. Every teacher has their own periods, students, room,
seating, attendance, lessons, bathroom log and schedule overrides — nothing is
shared across accounts.

- **Plain Supabase Auth: email + password.** Accounts are created and
  passwords set entirely in the Supabase dashboard → Authentication →
  Users. There is no in-app create-user or reset-password flow. If a
  teacher forgets their password, the admin resets it from the dashboard
  (or from an SQL editor via Supabase's Auth Admin API); Supabase's
  own email-recovery flow also works if you leave Site URL / Redirect
  URLs configured (see below), because we don't intercept it any more.
  `login.html` posts email + password to
  `/auth/v1/token?grant_type=password`; on success the session is stored
  in `localStorage['teacherpal.session']` = `{ access_token,
  refresh_token, expires_at, user: { id, email, username, display_name,
  is_admin, theme,
  teaches_periods } }`. `hydrateProfileIntoSession()` runs right after the
  token exchange and fills in the profile fields.
- **The stored session is only a cache of the profile.**
  `hydrateProfileIntoSession()` therefore also runs **once on every page
  load** (fire-and-forget, from the bootstrap at the bottom of
  `shared.js`), so a `display_name` / `theme` / `is_admin` /
  `teaches_periods` changed in the SQL editor or dashboard shows up on the
  next page view instead of waiting for a sign-out. The page paints from
  the cached values first; if anything differs the helper saves the
  session, re-applies the theme, and dispatches `teacherpal:profile`
  (`detail.user`) — plus `teacherpal:teachesPeriods` when that array moved.
  `nav.js` listens and repaints the USER chip in place (it does **not**
  re-render the bar — that would re-wire the settings menu's document
  listeners).
- **Automatic profiles row per auth user.** `migration-simplify-auth.sql`
  installs a trigger `on_auth_user_created` on `auth.users` that inserts a
  matching `profiles` row (defaults: `is_admin=false`, `theme='jarvis'`,
  `teaches_periods={0..7}`) whenever the dashboard creates a user. A
  companion trigger `on_auth_user_email_change` keeps `profiles.email` in
  sync when the dashboard email is edited. `profiles.username` is
  nullable — set it manually if you want a display name, otherwise the
  app falls back to the email local part.
- **Session-first page load.** `shared.js` runs at the top of every page:
  it reads the stored session, and if there is none — and the page does
  not carry `body.no-auth` — hides the page (`visibility: hidden`) and
  `location.replace('login.html?from=…')`. `sb()` refreshes 60s before
  expiry and after any 401; a failed refresh clears the session and
  redirects to login with the same `from`.
- **`shared.js` is the only auth surface.** Exposed helpers:
  `signIn(email, password)`, `signOut()` (POSTs `/auth/v1/logout`, clears
  storage, redirects to login), `refreshSession()`, `hasSession()`,
  `isAdmin()`, `currentUser()` → `{ id, email, username, display_name,
  is_admin, theme, teaches_periods }`, `hydrateProfileIntoSession()`,
  `displayName()` → `display_name` → `username` → email local part (`''`
  with no session); the app only ever reads it, names are set in SQL.
  Read-only admin RPC: `adminListUsers()` →
  `[{ user_id, email, username, is_admin, created_at, last_sign_in_at }]`.
  Theme: `THEMES` (registry), `applyTheme(id)`, `currentTheme()`,
  `setMyTheme(id)` (applies locally + POSTs `set_my_theme` RPC to persist
  on the profile).
  Teaches-periods: `currentTeachesPeriods()` → `int[]` or `null`,
  `setMyTeachesPeriods(arr)` (dedupes / sorts / clamps to 0-7 client-side,
  updates local session, dispatches `teacherpal:teachesPeriods`, POSTs
  `set_my_teaches_periods` RPC).
- **Top-bar account chip + sign-out** (`nav.js`): every page except the hub
  shows `USER <displayName()>` — display_name → username → email local
  part (`accountLabel()` in `nav.js` wraps it) — and a small door-arrow
  icon-button; on
  the hub the chip still appears in the readout row. Both hide on
  `body.no-auth` pages.
- **`body.no-auth`** — the one escape hatch. Pages carrying this class skip
  the auth check and stay accessible to anonymous visitors. Today only
  `login.html` uses it. Any future student-facing page should carry this
  class and get its own narrow anon RLS policies on its own tables —
  never grant anon access to any of the teacher-owned tables.
- **Session storage sits in `localStorage`, not cookies.** Two tabs share
  the session; a sign-out in one tab logs the other out on its next
  request (the refresh fails → redirect).
- **Admin flag.** `profiles.is_admin boolean` (default false). Attached to
  `session.user.is_admin` at sign-in; `isAdmin()` reads it.
  Set the flag manually for admins in the SQL editor:
  `update public.profiles set is_admin = true where email = '…';`
  `nav.js` filters entries marked `admin: true` out of the top nav for
  non-admins. `admin.html` is a read-only user list; user creation and
  password reset happen in the Supabase dashboard.
- **Display name.** `profiles.display_name text` (nullable) — how the
  teacher is addressed: "Mr. Pal", "Ms. Mohammadi". Attached to
  `session.user.display_name`; `displayName()` falls back to `username`,
  then the email's local part. Set it in the SQL editor
  (`migration-display-name.sql` seeds the two accounts); there is no
  in-app editor and no RPC — the client only reads it. Shown in the top-bar
  USER chip; a change lands on the next page load via the profile refresh
  above, no sign-out needed.
- **Teaches-periods.** `profiles.teaches_periods integer[]` (each 0-7,
  default all eight). Attached to `session.user.teaches_periods`;
  `currentTeachesPeriods()` returns the sorted array. **Source of truth
  for which bell periods count as "yours" vs "prep":**
    - `teachingMap(periods, teachesPeriods)` (schedule.js) is
      seeded from `teaches_periods` first, then overlaid with course
      names from any matching roster entry (`parsePeriodName`). A bell
      number in the map is "taught"; missing → `scheduleStatus`
      renders it as `PREP`.
    - `fillPeriodSelect(select, periods)` (shared.js) filters roster
      entries whose parsed bell number isn't in `teaches_periods`.
      Entries whose name has no bell number always pass through.
    - The bell schedule itself (`SCHEDULES` in schedule.js) still
      contains every period — real school timetable. Only display
      of "mine vs prep" is filtered.
  Change it in the top-bar gear menu → **Periods I teach** (0-7
  checkboxes). Toggling any checkbox calls `setMyTeachesPeriods(arr)`,
  which broadcasts `teacherpal:teachesPeriods`; `nav.js` listens and
  rebuilds `navState.teaches` so the NOW readout updates without a
  page reload.

## Database schema

All tables live in `public`. Ids are `uuid` with `gen_random_uuid()` defaults.
**Every table has `owner_id uuid not null default auth.uid() references
auth.users(id) on delete cascade`** — the tables below omit it from the
column list for brevity, but it is there on every row. Reads are RLS-filtered
to `owner_id = auth.uid()`; INSERTs get the owner from the column default
(the client never sends `owner_id`).

### `periods`
| column       | type        | notes |
|--------------|-------------|-------|
| `id`         | uuid        | PK |
| `name`       | text        | e.g. "Period 3" |
| `sort_order` | integer     | display order, default 0 |
| `created_at` | timestamptz | default now() |

### `students`
| column       | type        | notes |
|--------------|-------------|-------|
| `id`         | uuid        | PK |
| `period_id`  | uuid        | FK → periods.id, `on delete cascade` |
| `name`       | text        | |
| `sort_order` | integer     | display order within period, default 0 |
| `created_at` | timestamptz | default now() |

### `room_layouts` — one shared room **per owner** (the same physical classroom for every period, but each teacher has their own row)
| column       | type        | notes |
|--------------|-------------|-------|
| `id`         | uuid        | PK |
| `key`        | text        | default `'default'`; **UNIQUE (key, owner_id)** — the app only ever uses this one row per owner |
| `layout`     | jsonb       | `{ version: 2, grid: 24, front: { x, y, w, h }, pieces: [{ id, type, x, y, rotation }] }` |
| `updated_at` | timestamptz | set by the client on save |

`x`/`y` are in grid units (24px at zoom 1); `type` is one of `single`, `pair`,
`row3`, `group4`, `group6`, `round`, `teacher`; `rotation` is any angle in
degrees (integer, 0–359) about the piece centre. `version: 2` marks free
angles — v1 layouts only ever held 0/90/180/270 and load unchanged, so no
migration was needed for the change.
Piece geometry (desk rectangles, seat offsets) is **not** stored — it comes
from the `TYPES` table in `room.js`, so the JSON stays small and the
shapes can be tuned without a migration.

### `seat_assignments` — one row per period
| column        | type        | notes |
|---------------|-------------|-------|
| `id`          | uuid        | PK |
| `period_id`   | uuid        | FK → periods.id, `on delete cascade`, **UNIQUE** |
| `assignments` | jsonb       | `{ "<pieceId>:<seatIndex>": "<student uuid>", ... }` |
| `updated_at`  | timestamptz | set by the client on save |

Seat ids are derived from the piece (`<piece.id>:<index into TYPES[type].seats>`),
so switching periods keeps the desks and swaps the names. Both saves are
upserts (`on_conflict=key,owner_id` / `on_conflict=period_id` with
`Prefer: resolution=merge-duplicates`). The old grid table `seating_charts`
is unused; `migration-room-builder.sql` creates the two tables above and has
an optional, commented-out `drop table` for it.

### `seating_rules` — Formula rules, one row per (period, scope)

**Seating rules and grouping rules are two completely separate data sets.**
The `scope` column says which: `'seating'` rows are read/written only by
`seating.html`, `'grouping'` rows only by `groups.html`. A rule added on one
page never appears on, or affects, the other. Each scope has its own rule
list, its own priority order, and its own "Formula on/off" toggle.

| column        | type        | notes |
|---------------|-------------|-------|
| `id`          | uuid        | PK |
| `period_id`   | uuid        | FK → periods.id, `on delete cascade` |
| `scope`       | text        | `'seating'` \| `'grouping'` (check constraint); **UNIQUE (period_id, scope)** |
| `rules`       | jsonb       | `[{ id, type, a, b?, hard }]` in priority order (index 0 = highest). Seating types: `apart` · `together` · `close` · `front` · `back`. Grouping types: `apart` · `together` · `close` only — front/back do not exist in that scope. `a`/`b` are student uuids; pair rules stored once, applied both ways; `hard` = "Must meet" (missing → `RULE_TYPES[type].defaultHard`) |
| `use_formula` | boolean     | this scope's toggle (Seating: Randomize follows the rules; Grouping: Create Groups / Reshuffle follow them) |
| `updated_at`  | timestamptz | set by the client on save |

Upsert is `POST /seating_rules?on_conflict=period_id,scope`. The table name
is historical — it holds both scopes.

### `attendance` — one row per (period, date)
| column       | type        | notes |
|--------------|-------------|-------|
| `id`         | uuid        | PK |
| `period_id`  | uuid        | FK → periods.id, `on delete cascade` |
| `date`       | date        | local calendar day; **UNIQUE (period_id, date)** |
| `marks`      | jsonb       | `{ "<student uuid>": { status: 'absent' \| 'tardy', at: ISO } }` — **present students are not stored**; `at` is when the mark was made (shown next to tardies) |
| `updated_at` | timestamptz | set by the client on save |

Upsert is `POST /attendance?on_conflict=period_id,date`. Written by the hub
(click-to-cycle) and by Create Groups' Edit Roster (absent only — it keeps
existing tardies). Looking back at a past day is just a different `date`.

### `lesson_plans` — one row per (period, date)
| column       | type        | notes |
|--------------|-------------|-------|
| `id`         | uuid        | PK |
| `period_id`  | uuid        | FK → periods.id, `on delete cascade` |
| `date`       | date        | **UNIQUE (period_id, date)** |
| `objective`  | text        | learning target |
| `agenda`     | jsonb       | `[{ id, text, minutes|null, done }]` in order — `done` is the live class checklist |
| `materials`  | text        | materials / links |
| `homework`   | text        | |
| `notes`      | text        | |
| `updated_at` | timestamptz | set by the client on save |

Upsert is `POST /lesson_plans?on_conflict=period_id,date`. A plan is "empty"
when every text field is blank and no agenda item has text; the editor shows
the "Add a lesson plan" prompt until then.

### `bathroom_log` — one row per trip
| column       | type        | notes |
|--------------|-------------|-------|
| `id`         | uuid        | PK |
| `period_id`  | uuid        | FK → periods.id, `on delete cascade` |
| `student_id` | uuid        | FK → students.id, `on delete cascade` |
| `date`       | date        | local calendar day |
| `out_at`     | timestamptz | sign-out time (= `in_at` on manual rows) |
| `in_at`      | timestamptz | null while the student is out |
| `manual`     | boolean     | **true = a tally, not a timed trip** (seeded from the paper tracker or adjusted by hand); never shows as "out" or in the daily log |
| `quarter`    | text        | `'Q1'..'Q4'` on manual rows; timed trips derive their quarter from `date` via `quarterOf()` |
| `count`      | integer     | passes used (manual rows); 1 on trips |
| `created_at` | timestamptz | |

Indexes on `(period_id, date)`, `(student_id)`, and a partial unique index
`(student_id, quarter) where manual` — one tally row per student per quarter.
**Passes used in a quarter = manual count + timed trips in that quarter.** The
flag limit, max-out cap and passes-per-quarter allowance (default 4) are
per-browser settings (`teacherpal.bathroom.settings`).

### `schedule_overrides` — dates that don't follow the weekday default
| column        | type        | notes |
|---------------|-------------|-------|
| `id`          | uuid        | PK |
| `date`        | date        | **UNIQUE (date, owner_id)** — the calendar day (local) |
| `schedule`    | text        | `early_release` \| `regular` \| `minimum` \| `double_second` \| `homecoming` \| `finals` \| `no_school` (check constraint) |
| `finals_pair` | text        | `'1-2'` \| `'3-4'` \| `'5-6'`; **required iff** `schedule = 'finals'` (check constraint) |
| `note`        | text        | optional, shown in the override list |
| `created_at`  | timestamptz | default now() |

The bell schedules themselves are **not** in the database — they are data in
`schedule.js`. This table only maps a date to one of them (**per owner** — each
teacher has their own override calendar). Upsert is
`POST /schedule_overrides?on_conflict=date,owner_id`. The historical seed of
finals dates only exists in old projects backfilled to Khalid; new accounts
add their own on `schedule.html`.

### RLS
RLS is enabled on every table (the project enables it automatically, and
`schema.sql` enables it explicitly too). Each teacher-owned table has four
policies — `<table> owner select`, `<table> owner insert`,
`<table> owner update`, `<table> owner delete` — all for the `authenticated`
role, all keyed to `owner_id = auth.uid()`. Nothing here is readable by
anon; the old `TEMP anon full access` policies were removed in
`migration-auth.sql`. When you add a new table, follow the same pattern:
`owner_id uuid not null default auth.uid() references auth.users(id) on
delete cascade`, enable RLS, add the four per-owner policies in a `DO $$`
block (never `CREATE POLICY IF NOT EXISTS` — not valid Postgres), and put
`owner_id` in any per-user uniqueness constraint.

Any future student-facing page (one where students, not the teacher, hit
the app) would need its own tables *outside* the owner_id model, with
narrow anon policies scoped to what those students should be able to do —
never grant anon access to any of the teacher-owned tables above.

## `shared.js` API

Low level: `sb(table, { method, params, body, prefer })` — one wrapper around
`fetch` to `${SUPABASE_URL}/rest/v1/<table>`. `params` become PostgREST query
params (`{ id: 'eq.<uuid>', select: '*', order: 'name.asc' }`). Writes default
to `Prefer: return=representation` so inserted/updated rows come back.
Refreshes the access token 60s before expiry, and on any 401 tries a refresh
once then retries; a failed refresh clears the session and redirects to
`login.html`.

Auth:
- `signIn(email, password)` → stores session; `signOut()` → clears storage,
  POSTs `/auth/v1/logout`, redirects to login.
- `refreshSession()` → uses the stored refresh token; returns the new
  session or `null` on failure.
- `hasSession()`, `currentUser()` → `{ id, email }` or `null`,
  `currentSession()` → the whole record (`access_token`, `refresh_token`,
  `expires_at`, `user`).
- `displayName()` → the teacher's name for UI copy (`profiles.display_name`,
  else `username`, else the email's local part; `''` with no session).
- `authHeaders()` — picks the access token when signed in, else the anon
  key. Only `sb()` calls this.
- `body.no-auth` — a page carrying this class opts out of the login
  redirect (currently only `login.html`).

Data helpers (owner_id is filled by the DB default, so no helper here ever
sends it):
- `getPeriods()`, `createPeriod(name, sortOrder)`, `renamePeriod(id, name)`, `deletePeriod(id)`
- `getStudents(periodId)`, `addStudents(periodId, names[], startSortOrder)`, `updateStudent(id, fields)`, `deleteStudent(id)`, `countStudents()` (all periods, ids only)
- `getRoomLayout()` → layout object or `null`; `saveRoomLayout(layout)` (upsert on `key,owner_id`)
- `getSeatAssignments(periodId)` → `{}` when none; `saveSeatAssignments(periodId, assignments)` (upsert on `period_id`)
- `getAttendance(periodId, date)` → `{ marks, updatedAt }` or `null`; `saveAttendance(periodId, date, marks)` (upsert on `period_id,date`). Plus the same-browser cache helpers `readAbsentCache(periodId)` / `writeAbsentCache(periodId, ids)` (`teacherpal.absent.<periodId>` = `{ date, ids }`, today only), `absentIdsOf(marks)` and `todayKey()`.
- `readSitOutCache(periodId)` / `writeSitOutCache(periodId, ids)` — "sitting out" for grouping (`teacherpal.sitout.<periodId>` = `{ date, ids }`, today only, this browser only). **Not attendance**: it never writes the `attendance` table or the absent cache. Used by Create Groups only.
- `getAttendanceForDate(date)` → `[{ period_id, marks }]` for every period; `countStudentsByPeriod()` → `Map<periodId, n>`
- `getLessonPlan(periodId, date)` → row or `null`; `getLessonPlansRange(from, to)` (week view); `saveLessonPlan(periodId, date, plan)` (upsert on `period_id,date`); `deleteLessonPlan(periodId, date)`; `EMPTY_PLAN()`
- `getBathroomLog(periodId, date)`, `getBathroomHistory(periodId)` (all dates, newest first, ≤2000), `bathroomSignOut(periodId, studentId, date)` → row, `bathroomSignIn(id)` → row, `deleteBathroomTrip(id)`, `setManualTally(periodId, studentId, quarter, count)` (read-then-write because the uniqueness is a partial index; count 0 deletes)
- `getScheduleOverrides()` → rows ordered by date; `saveScheduleOverride({ date, schedule, finals_pair, note })` (upsert on `date,owner_id`; `finals_pair` is nulled unless `schedule === 'finals'`); `deleteScheduleOverride(id)`
- `getFormulaRules(periodId, scope)` → `{ rules, useFormula }` for **that scope only**; `saveFormulaRules(periodId, scope, rules, useFormula)` (upsert on `period_id,scope`). `scope` must be `'seating'` or `'grouping'` (`assertScope` throws otherwise). No helper reads or writes both scopes in one operation.

Full screen: `toggleFullscreen()` / `enterFullscreen()` / `exitFullscreen()`,
`isPresent()`, `setPresentMode(on, { remember })`, `isTyping(el)`; any
`[data-fullscreen]` button is wired automatically and mirrors the state in
`aria-pressed`; pages listen for `document` event `teacherpal:present`
(`detail.on`). See the Design rules for behaviour.

UI helpers: `fillPeriodSelect(selectEl, periods, preferredId)` (remembers the
last-used period in `localStorage`), `getLastPeriodId()` / `setLastPeriodId()`,
`escapeHtml()`, `shuffle()`, `setStatus(msg, 'info'|'ok'|'error')`, `showError(err)`,
`isConfigured()`.

## Rules — keep future sessions consistent

1. **No npm, no build step, no frameworks, no ES modules.** Plain script tags.
   Everything in `shared.js` is a global on purpose.
2. **All Supabase access goes through `shared.js`.** (`formula.js` is UI +
   solver only and takes rules in/out through callbacks.) Pages never call `fetch`
   on the Supabase URL, never touch `/auth/v1/*` themselves, never touch the
   anon key, never build REST URLs. Add a helper in `shared.js` instead.
   `authHeaders()` is the one place that decides which bearer to send.
3. **The anon key is public by design** (it is shipped to browsers). Security
   comes from RLS policies, not from hiding the key. Never put a service-role
   key anywhere in this repo.
4. **`schema.sql` must stay idempotent**: `create table if not exists`, and
   policies wrapped in `DO $$ ... END $$` blocks that check `pg_policies`
   first. **Never use `CREATE POLICY IF NOT EXISTS`** (not valid Postgres).
5. **Every teacher-owned table needs `owner_id` + four per-owner policies.**
   `owner_id uuid not null default auth.uid() references auth.users(id) on
   delete cascade`, then RLS enabled, then select/insert/update/delete
   policies for the `authenticated` role, all keyed to
   `owner_id = auth.uid()` (see the DO block at the bottom of `schema.sql`).
   Any per-user uniqueness constraint must include `owner_id` (`(key,
   owner_id)`, `(date, owner_id)`, …). Client helpers **never** send
   `owner_id` — the DB default fills it. The **only** exception would be
   tables for a future student-facing page (one loaded without a session),
   which would get their own narrow anon policies and live outside the
   ownership model; anon must never be able to touch a teacher-owned table.
6. **Keep the table/column listing comment at the top of `schema.sql`** in
   sync with the tables, and keep the schema tables in this file in sync too.
7. **Projector-first UI.** Fluid root font (14–22px, scales with the screen), large buttons, high contrast. There is
   **one** big-screen mode for the whole app — the full-screen system in
   `shared.js` (`body.present`, see the Design rules) — never add a
   page-local "present" or fullscreen toggle; hook the `teacherpal:present`
   event and hide chrome with `.no-present` instead.
8. **Escape user text with `escapeHtml()`** whenever student/period names go
   into `innerHTML`.
9. **`cascade` deletes are relied on**: deleting a period deletes its students
   and its seat assignments in the database, so the client does not clean up.
10. Deploy is just `git push` — Vercel serves the repo root. Don't add a build
    command or output directory.
11. **Seating rules and grouping rules are separate data sets**, scoped by
    `seating_rules.scope`. `seating.html` uses `RULE_SCOPE = 'seating'`,
    `groups.html` uses `RULE_SCOPE = 'grouping'`, and every load/save passes
    that constant. `shared.js` and `formula.js` share **algorithms only,
    never rule data** — don't add code that merges, copies or reads across
    scopes (the one-off migration was the only exception).
12. **Bell schedules (and quarters) are data in `schedule.js`, never
    hard-coded elsewhere.** `QUARTERS` holds the Q1–Q4 date ranges
    (`quarterOf(ymd)`, `currentQuarter()`); Q2/Q4 end on the finals weeks,
    the other boundaries are placeholders — adjust them to the real calendar.
    Don't put a year calendar (holidays, minimum days) in code — those are
    `schedule_overrides` rows managed on `schedule.html`. Period ↔ class
    mapping comes from the roster period *names* (`parsePeriodName`), not from
    `sort_order`, so name periods "3rd Period - English 9" / "Period 3 …".
13. **Attendance has one source of truth: the `attendance` table.** The
    localStorage key `teacherpal.absent.<periodId>` is only a same-browser
    cache of today's absentees (so Seating's Formula and Create Groups can
    read it synchronously); every page that changes attendance writes the
    table *and* the cache through the `shared.js` helpers. Tardy = present
    for grouping/seating purposes. **"Sitting out" is not attendance** — it
    is a grouping-only, same-day, same-browser list
    (`teacherpal.sitout.<periodId>`, `read/writeSitOutCache`) and must never
    be written into the `attendance` table or the absent cache: a student at
    the nurse who was marked present stays present in the record.
15. **The hub is a launcher and stays one.** It pulls no data: every tool
    loads its own data on its own screen. Cross-module events still exist
    for pages that want them — `attendance.js` broadcasts `teacherpal:period
    { periodId, date }` and `teacherpal:attendance { … counts }` and exposes
    `window.attendanceView.selectPeriod(id)`; `nav.js` broadcasts
    `teacherpal:tick { now, sched, status }` every second (use it instead of
    your own `setInterval` for clock-driven UI).
14. **Seating geometry lives in `room.js`** (`TYPES`, `G`, `FRONT`, `bbox`,
    `labelStyle`, `roomBounds`). Any page that draws the room loads it;
    don't copy the table.

## Themes — per-user visual styles

TeacherPal ships two themes, one per teacher's taste:

- **`jarvis`** — the original dark HUD (deep plum-navy, near-black cards,
  subtle pink accent, Orbitron uppercase labels, corner ticks). Default for
  every account and every logged-out page. See the Design rules below.
- **`marwa`** — a **pure colour swap of jarvis** with four tiny extras. Same
  layout, spacing, radii, borders, fonts, weights, tracks, shadows,
  animations and components: only palette tokens differ (light cream-pink
  ground, white cards, deep-plum text, bubblegum-pink accent) with
  equivalent contrast. The intentional additions: **12-hour clock with
  AM/PM** in the topbar (`fmtWallClock({ hour12: true })` when
  `currentTheme() === 'marwa'`); the **original mascot set** (bunny,
  axolotl, cat, cloud, star) used on empty states, the login hero and a
  hub-corner flourish; and **stronger hub-card outlines** — `--hud-line`
  (0.24 alpha) is near-invisible on cream, so `.hub-section .hud-panel`
  rests at 0.55 with hover stepping to 0.95 plus darker ticks and a rose
  shadow over the shared lift/glow (`.setup` cards stay quieter at 0.34).
  Scoped to the hub: tool pages' `.hud-box` keeps the quieter line.
  And a **faint heart pattern** on the page background — see `--body-pattern`
  below. The **Timer dial** is the one component with a real per-theme skin
  (segment ring vs gradient arc, Comfortaa digits, sentence-case label,
  reacting mascot, heart burst at zero) — see the Timer section. Everywhere
  else: no HUD tick suppression, no sentence-case override, no separate
  fonts, no rounded-card overrides — layout changes to jarvis carry into
  marwa automatically.
- **`--body-pattern` / `--body-pattern-size`** — the per-theme page texture,
  wired in as the **first background layer** of `body` (and of `body.hub`,
  which sets its own background). jarvis leaves it `none`; marwa sets an
  inline-SVG data URI of three small hearts per 96px tile, at different
  sizes and angles, in `#F3BFD4` at 32% — a shade off `--bg-0`, so it reads
  as texture up close and disappears from the back of the room. It is a
  *background layer*, so it is always behind cards and can never land on
  text; cards are opaque in marwa, so the hearts only show in the gutters.
  The projector pop-outs (`body.timer-popout`, `body.noise-popout`) set
  `background-image: none` to stay flat. No image file — data URI only.

Storage & flow:

- **`profiles.theme text default 'jarvis'`**. Attached to
  `session.user.theme` at sign-in (via `hydrateProfileIntoSession`) and
  preserved through refreshes.
- **`shared.js`**: `THEMES` (the registry), `applyTheme(id)` (attribute +
  localStorage + `teacherpal:theme` event), `currentTheme()`,
  `setMyTheme(id)` (also calls `set_my_theme` RPC to persist server-side).
- **Head script.** Every page has a tiny synchronous `<script>` in `<head>`
  before the stylesheet link — it reads `localStorage['teacherpal.theme']`
  and sets `data-theme` on `<html>` so the correct tokens apply *before*
  the CSS parses. No flash of the wrong theme even on the login page.
- **Settings menu.** `nav.js` renders a small gear-icon `<details>` widget
  in the top bar. Inside: radio-style theme options from `THEMES`. Changing
  the selection calls `setMyTheme` immediately. Available on every page,
  including login (where the choice is only local until sign-in).

To add a new theme:

1. Add `{ id: 'my-theme', label: 'My Theme' }` to `THEMES` in `shared.js`.
2. Copy the `:root[data-theme="marwa"] { … }` colour block in `style.css`
   and rename the selector to `:root[data-theme="my-theme"]`. Swap the
   colour values only — leave structural tokens (fonts, radii, tracks,
   spacing, font-weights) alone so the layout stays identical.
3. Test at 1366×768, 1080p, 4K and 375px, and on the projector.

The `set_my_theme(text)` RPC validates `^[a-z0-9_-]+$` and length ≤ 40 so
any junk name is rejected at the server. Unknown ids on the client just
fall back to the default (no matching `:root[data-theme=…]` block); harmless.

### Marwa mascots

Marwa ships an original cast of 5 characters (nothing copied from Sanrio /
Hello Kitty / Miffy / any existing IP — drawn from simple geometric
primitives in the palette). All 48×48 viewBox, bold sticker style, each a
CSS variable inside the marwa token block:

| id        | Character                              | Where it appears |
|-----------|----------------------------------------|------------------|
| `bunny`   | round bunny with a bow                 | `.chart-empty`, hub-launcher corner flourish |
| `axolotl` | smiling axolotl with rose feather gills| `.empty-state`, login hero |
| `cat`     | round cat with a bow                   | `.list-empty` |
| `cloud`   | sleepy cloud, closed-arc eyes          | (available via `.marwa-mascot`) |
| `star`    | 5-point star                           | `.lesson-empty` |

Drop one anywhere with `<span class="marwa-mascot" data-mascot="bunny"></span>`
(defaults 3rem square; hidden in other themes). In any theme other than
`marwa` the element collapses to `display:none`.

## Design rules — dark premium dashboard (pink)

Reference: `design-ref.png` (a dark fintech dashboard) with its blue swapped
for a subtle pink. Deep plum-navy ground with a soft radial glow, near-black
cards with 24px corners, faint 1px borders with a pink glow line along the top
edge, white medium-weight card titles with a square outlined ↗ button at the
top-right, bordered pill chips, outlined percentage badges, slim progress
bars, muted gray secondary text. This is the **jarvis theme**, the default.
See the Themes section below for the per-user switcher and the `marwa` theme.
All styling lives in `style.css`; pages carry almost no inline styling.

- **Tokens first, per theme.** Every color, gradient, shadow, font, radius and
  typographic track is a CSS variable defined inside a
  `:root[data-theme="<id>"] { ... }` block. Structural tokens (spacing,
  font sizes, transition, touch, page-pad) live in the shared `:root {…}`
  block. `:root, :root[data-theme="jarvis"]` share the same values, so an
  unstyled page (no `data-theme` attribute yet) still renders correctly.
  Never hard-code a hex color, radius or shadow anywhere else.
- **Palette.** Ground `--bg-0 #151320` → `--bg-1 #1E1A2E` (radial glow on
  `body`, plus a faint pink glow at the top). Surfaces `--card #0D0B14`,
  `--card-2 #15121F` (inputs, chips, wells, rows), `--card-3 #1C1828`
  (hover). Borders `--border rgba(255,255,255,.06)`, `--border-strong .12`,
  `--border-hover .16`. Text `--text #FFFFFF`, `--text-2 #C9C4D4`,
  `--text-muted #8B8699`. Accent `--accent #F07FAE`, `--accent-deep
  #D9578F`, `--accent-soft` / `--accent-glow` (rgba tints), secondary
  `--lavender #B79CF5`, `--danger #FF7A8A`, `--ok #6FD3A6`.
- **Card recipe** (`.card`, `.tile`, `.group`, and `.neu-raised` which now
  aliases it): `background: var(--card)`, `1px solid var(--border)`,
  `--radius-lg` (24px), `--shadow-card`, `padding: var(--space-5)`, a `::before`
  1px `--gradient-glow-top` line across the top edge, hover → `--border-hover`
  (+ `--shadow-card-hover` and a 2px lift on tiles). Inner rows/wells use
  `--card-2` with `--radius-md` (14px). Controls use `--radius-sm` (10px).
- **Card header.** `<div class="card-head"><h2>Title</h2><button
  class="corner-btn">↗</button></div>` — title white `--fw-medium`
  `--fs-lg`, button 2.3rem square, `--border-strong`, `--card-2`, pink on
  hover. Only add a `.corner-btn` when it triggers a real existing action
  (roster → full screen, groups → full screen). The hub does not use cards at all —
  it has its own HUD panels (see the Hub bullet below).
- **Accent is sparse.** Pink is for: active/pressed fills (`--gradient-accent`,
  fading to transparent), primary buttons, progress fills (`--gradient-bar`),
  selection rings, badge outlines, tile icons and the glow line. **Never pink
  body text** — names, group results, seating names and all copy are white
  (`--text`) or muted gray. Lavender is the contrast accent (e.g. the "Coming
  soon" badge, duplicate warnings).
- **Small parts.** `.chip` = pill, thin `--border-strong`, `--card-2`, icon +
  text (student counts, unseated count). `.pct` = small outlined badge in
  accent color (seated %, `GROUP N` labels). `.progress > .fill` = 0.35rem
  rounded bar with `--gradient-bar` and a soft glow. `.stat .value/.label`
  for big bold numbers with a muted label (period title uses `--fs-stat`).
- **Pressed / active / selected — app-wide.** One rule block targets
  `button[aria-pressed="true"]`, `.neu-btn.active`, `[role="switch"]
  [aria-checked="true"]`, `.tab[aria-current="page"]`, `.seg input:checked +
  span`, `.segment:has(input:checked)`, `details[open] > summary`,
  `select:focus`: `--gradient-accent` fill, `--accent` border,
  `--shadow-pressed` inner ring/glow, white text, pink icon, plus the
  `.when-off` / `.when-on` label swap (pencil "Edit roster" ↔ check "Done",
  ✓ on selected sort/segment). `:active` scales to 0.97 (off under
  reduced-motion). New toggles must use `aria-pressed` / `aria-current`.
- **Full screen = the one big-screen mode (`shared.js`).** `body.present`
  is the layout: the nav links and `.no-present` elements disappear, the app
  shell becomes one column, the topbar slims, and everything scales up for
  distance viewing — `html:has(body.present)` raises the root font to
  `clamp(16px, 0.72vw + 0.6vh, 26px)`, cards / groups / HUD boxes / student
  cards get 2px borders, status-bar readouts grow (`.hud-val` 1.05rem,
  `.hud-key` 0.72rem). The browser Fullscreen API
  (`documentElement.requestFullscreen({ navigationUI: 'hide' })`) is layered
  on top whenever the browser allows it; if it refuses (no gesture) the
  layout still applies. **Controls**: every topbar has an `.icon-btn.fs-btn`
  with `[data-fullscreen]` (enter/exit corner-arrow icons swapped by
  `.when-off/.when-on`; the hub uses a `.hud-chip.fs-chip` FULL/EXIT); the
  Create Groups and Seating toolbars and the Rosters "Present" buttons call
  the same thing. **F** toggles (ignored while typing in an input / select
  / textarea / contenteditable, while any `<dialog>` is open, or with
  Ctrl/Alt/Meta); **Esc** exits (the browser handles Esc in true fullscreen
  and `fullscreenchange` then drops `body.present`, so the buttons stay in
  sync when the browser leaves on its own). A floating `.fs-float` toolbar
  (injected by `shared.js`, bottom-right, 55% opacity until hovered) has
  **Nav** — toggles `body.show-nav`, which shows the top-bar nav links
  again while full screen stays on — and
  **Exit**, plus a "Press F for full screen" hint when the layout is on but
  true fullscreen isn't. **Remembered**: `teacherpal.fullscreen` in
  localStorage; on load `'1'` re-applies the layout (without writing) so
  navigating between pages doesn't fight you — true fullscreen needs a new
  gesture, hence the hint; `pagehide`/`beforeunload` set `fsLeaving` so
  the browser's own exit during navigation isn't saved as "off".
  In full screen the top nav links hide (readouts + toggle stay; the
  floating **Nav** brings the links back). **Per page** (all via the
  `teacherpal:present` event): Attendance screen — the chart goes edge to
  edge with the side column narrowed, `#exp-counts` (P/A/T) shows in the
  chart header, lists/tiles larger; hub — the panel grid hides (Nav
  brings the links back); Create Groups — the projector view: big
  group cards (2.1rem names), animations intact, Space reshuffles, the
  `.present-only` bar shows Reshuffle + the hint, entering with no groups
  yet creates them; Seating — forces Assign mode, hides sidebar/bars,
  `fitToScreen()` (again after 350ms for the fullscreen resize), 2px
  seat borders, 14px labels, the front marker stays at its real position;
  Rosters — leaves edit mode, big name cards only. Test in headless Edge by
  setting `localStorage.teacherpal.fullscreen = '1'` before `shared.js`
  loads (the API itself can't run without a gesture).
- **Type system — three faces, HUD flavoured (no Inter anywhere).** All from
  Google Fonts; every page carries the same `<link>` (Orbitron 500/600/700,
  Rajdhani 500/600/700, Share Tech Mono 400, `display=swap`) plus the two
  `preconnect`s. The faces are tokens at the top of `style.css` — change
  them there, nowhere else:
  - `--font-display` **Orbitron** (fallback Rajdhani → Segoe UI → system):
    **short text only**, always uppercase and tracked (`--track-display`
    0.14em for headings, `--track-label` 0.18em for small labels). Used for
    the brand, page titles, card `h2`s (0.78rem, muted), the roster
    `.period-title`, `GROUP N` labels, hub tool names, the nav tabs
    (0.6rem), dialog titles (Formula, Import, Today's roster, the
    "can't all hold" warning), `.hud-key` labels, the front-of-room marker,
    empty-state lines. **Never** for paragraphs, lists,
    names, or anything longer than a few words — it gets unreadable fast.
  - `--font-mono` **Share Tech Mono** (fallback JetBrains Mono → system
    mono; `--hud-mono` aliases it): every figure and technical label —
    clock, countdown, `.hud-val`, counts (`.att-counts b`, `.stat .value`),
    chips, the groups preview ("25 → 6 groups"), zoom %, save states,
    status lines/toasts, `kbd` shortcut hints, bell-table times, override
    dates, roster numbers, the rotation angle. Always
    `font-variant-numeric: tabular-nums` (the face is monospaced anyway) so
    the clock never jitters. It has one weight — use size/colour for
    emphasis, never `bold`.
  - `--font-body` **Rajdhani** (fallback Segoe UI → system sans) is `--font`
    and the default: buttons, form fields, roster lists, hints, paragraphs,
    modal bodies. Rajdhani is condensed with a small x-height, so the scale
    was retuned for it: `--fs-xs` 0.86 · `--fs-sm` 0.98 · `--fs-md` 1.08 ·
    `--fs-lg` 1.25 · `--fs-xl` 1.6 · `--fs-2xl` 2.4rem, body weight
    `--fw-regular` = 500 (400 is too thin on the dark ground), buttons 600,
    body tracking `--track-body` 0.01em. Control labels that read as HUD
    but must stay narrow (segmented toggles, Formula tabs, rule-type chips,
    priority dividers) are Rajdhani **uppercase 600 tracked 0.1em**, not
    Orbitron — Orbitron there made the one-row toolbars wrap.
  - **Student names are Rajdhani, heavier and a touch larger** so they carry
    on a projector: roster names 1.15rem/700, group cards 1.7rem/700
    (2.1rem in full screen), pool chips 1.12rem/600, seat labels 700
    (11px in the builder, 14px in the hub's compact room, 15px there in
    full screen, 14px on the Seating page in full screen), attendance
    tiles/lists 600.
  - The whole mapping lives in one "Type system" block at the end of
    `style.css` (it deliberately comes last so it wins over component
    rules). Hierarchy still comes from size/weight and white-vs-muted, not
    colour.
- **Contrast for the projector.** Group results ≥ `--fs-xl` (`--fs-2xl` in
  full screen) white on `--card` with thin `--border` dividers; seating desk
  names white `--fw-semibold` on `--card-3`; roster names 1.05rem/600 white.
  Muted text is `--text-muted` (#8B8699, ~5:1 on `--card`) and nothing
  dimmer; pink text only on badges/labels ≥ `--fs-xs` semibold.
- **Icons are inline SVG** (24×24, `stroke="currentColor"`, width 2,
  `aria-hidden="true"`). No emoji, icon fonts or image URLs.
- **Hub (`index.html`) is a HUD / command center** — the JARVIS-style
  dashboard direction. It is the one page that is allowed to look "sci-fi":
  thin precise lines, small tracked uppercase labels, monospace data, corner
  brackets and a faint grid. Every other page keeps the calmer dashboard
  chrome above. Pink is still the only accent (never blue); it is the HUD
  line colour and glows **only on hover/focus**. No emoji, no libraries.
  - **Tokens** live in `style.css` under the HUD block: `--hud` (= accent),
    `--hud-line` / `--hud-line-strong` (pink at 0.28 / 0.7 alpha),
    `--hud-glow` / `--hud-glow-soft`, `--hud-grid` / `--hud-scan` (texture
    at ≤ 0.035 alpha), `--hud-mono` (= `--font-mono`, Share Tech Mono), `--hud-tick` / `--hud-tick-hover` (corner bracket length 0.9rem →
    1.6rem), `--hud-in` 420ms and `--hud-stagger` 60ms. Change looks by
    editing tokens, not selectors.
  - **Shell**: `body.hub` has a soft top radial pink wash and a fixed
    `::before` layer with the grid + 3px scanlines, radially masked so it
    fades toward the edges and never sits above content (`z-index: 0`,
    `body.hub .app` is `z-index: 1`). `attendance.html` shares `body.hub`.
  - **Hub = launcher** (`.launcher-page` > `.hub-sections`): a vertical
    stack of `.hub-section` groups, each with a small `.hub-section-title`
    heading + a `.hub-panels` flex-wrap row of `.hud-panel` links.
    `max-width: 82rem`, centred, `gap` between sections
    `clamp(1.5rem, 3vw, 2.5rem)`. Cards inside a section have
    `flex: 1 1 15rem; max-width: 20rem; min-height: clamp(9.5rem, 20vh, 12.5rem)`
    so 1..N cards flow naturally without an outer grid template. Sections
    in order: **Daily** (Attendance, Bathroom), **Teacher tools**
    (Create Groups, Timer, Noise Meter, Name Wheel), **Planning** (Lesson Plans, Seating), **System**
    (Schedule, Rosters — both `.setup` dashed + quieter). Adding a tool
    means one `<a class="hud-panel">` inside the right `<section>`; no
    CSS grid template to reflow. Each panel is only a thin-line SVG icon
    (2.6rem) and the tracked `.hud-name` under it, centred as a pair —
    **no sub-line, no live data, no counts, no Supabase** (the only requests on the
    page are nav.js's readouts, as on every page). Don't put dashboards
    back on the hub; a tool that needs a summary shows it on its own
    screen. Marwa scopes a mascot per section (bunny / star / cloud /
    cat) as an accent glyph before the section title.
    The hub's top bar has **no nav links** (`body.launcher` → `nav.js` skips
    them and adds `.topnav.no-links`, which also keeps the wordmark text
    visible at every width); every other page keeps the full nav, and the
    wordmark links to `index.html` everywhere. The floating full-screen Nav
    button is hidden on the hub since there are no links to show.
  - **Top bar = nav + readouts on every page** (`header.topbar.hud-bar.topnav`,
    rendered by `nav.js`): brand "TeacherPal" left in 0.32em-tracked caps
    with a small rotated pink square; then `.nav-links` holding the four
    `.nav-group` dropdowns (see the nav bullet below); right side is
    `.hud-status` of
    `.hud-stat` pairs (`.hud-key` muted tracked label + `.hud-val` tabular
    mono): TIME (hh:mm:ss), DATE, **SCHED** (today's schedule `short` name,
    `*` when it comes from an override; an `a.hud-link` to `schedule.html`),
    **NOW** (the live line from `scheduleStatus()`, recomputed every second
    together with the clock — see the Schedule model below), then the
    `.fs-btn` full-screen toggle. `#hud-now[data-state]` dims passing /
    break / before-school lines to `--text-2` and after-school / weekend /
    no-school to muted. **Everything shares one row** — grouping the nav
    into four triggers freed the space, so `header.topnav` is a single
    `"brand nav read tail"` grid; below 1100px the readouts drop to their
    own row again. Below 1600px the readout key labels drop, below
    1200px the date, below 900px SCHED. Periods +
    overrides are fetched once per page load (`navReady`); the schedule is
    re-resolved only when the date key rolls over; every second nav.js
    dispatches `teacherpal:tick { now, sched, status }`.
  - **HUD boxes** (`.hud-box`): the tool screens' sections are boxes with
    the panel's faint `--hud-line` border, translucent `--card` fill and
    the four `.tick` corner spans (tick rules target `.hud-panel, .hud-box`).
    Small mono controls inside are `.hud-chip` (AUTO / TODAY; `aria-pressed`
    = pink outline + glow) and `.dash-field` (mono `.hud-key` label +
    select / date input on the dark HUD fill).
  - **Lesson plan panel** (`lesson.js`, `.lesson-panel` hud-box, used on the
    Lesson Plans screen): header = "LESSON PLAN <period> · <date>", agenda
    progress (`done/total · N MIN`), save state, COPY FROM PERIOD / COPY
    YESTERDAY chips. Body = sections with small display-face labels; every
    field is a borderless `textarea.lp-text` (auto-grows, border appears on
    hover/focus) so it reads as text but edits inline; the agenda is an
    `ol.lp-agenda` of `.lp-item` rows (checkbox → `done` + strike-through,
    number, text input, minutes input, × on hover; Enter adds the next item,
    Backspace on an empty item removes it). Autosave 800ms after the last
    edit via `saveLessonPlan`; `beforeunload` warns while dirty. **Empty
    state** (`.lesson-empty`): no row and nothing typed → "No lesson plan
    yet · <period> · <date>" with **Add a lesson plan** (opens the editor
    with one blank agenda line), Copy from another period, Copy yesterday's
    plan. Copy-from-period opens a `<dialog>` listing the other periods'
    plans for that date (disabled when none); Copy yesterday uses the
    previous weekday; both confirm before replacing a non-empty plan.
    `onChange` lets the week view mirror edits. `follow: true` (track
    `teacherpal:period`) exists but is unused now.
  - **The nav is four grouped dropdowns**, defined by `NAV_SECTIONS` in
    `nav.js` (Daily · Teacher Tools · Planning · System — the hub's own
    sections). Add a screen to the right section there and every page's nav
    updates; `NAV_ITEMS` is still derived from it as a flat list. Each
    section is a `.nav-group` holding a `.tab.nav-trigger` button and an
    absolutely-positioned `.nav-menu` panel, so **opening a menu never
    shifts the bar**. The trigger for the section containing the current
    page carries `data-here="1"` (pink fill); the page's own item inside
    carries `aria-current="page"`.
    **Interaction** (`wireNavMenus`): hover opens after `NAV_OPEN_MS` 120
    and closes after `NAV_CLOSE_MS` 280, and because the panel lives
    *inside* `.nav-group`, travelling to it counts as staying hovered.
    Click/tap toggles (hover handlers skip `pointerType === 'touch'`), a
    document click outside closes, and keyboard is full: Enter/Space/↓ opens
    to the first item, ↑ opens to the last, ↑/↓/Home/End move within the
    menu, Esc closes and returns focus to the trigger, Tab closes behind
    you, and focus leaving the group closes it. Add a screen there and every page's nav updates.
    All items fit one row at 1366px because the brand text collapses to its
    mark below 1400px and the tabs tighten; if it ever overflows, the
    nav-links wrap to their own row below the readouts (see the 1500px
    breakpoint in `style.css`).
- **Lesson Plans screen** (`lessons.html`): `.lessons-layout` = `.week-box`
  (58%) + `#lesson` editor (42%). The week grid (`.week-grid`, sticky day
  headers, `9rem` period column + 5 day columns, rows `minmax(5.2rem,1fr)`)
  shows one `.wk-cell` per period × day with the plan summary (objective,
  else the agenda joined by ·, 3-line clamp) and `done/total`; `.has-plan`
  fills, `.today` outlines, `.selected` glows. ← WEEK / WEEK → / TODAY /
  JUMP TO date; ← → move a school day, ↑ ↓ a period. Plans load per week
  with `getLessonPlansRange`; `panel.show(pid, date)` opens the editor and
  its `onChange` updates the cell live. Opens on the bell's current period,
  today.
- **Bathroom Tracker** (`bathroom.html` + `bathroom.js`). Layout is a single
  column: `.br-top` control bar → `.br-mode-row` → `.br-out-strip` (only
  when someone's out in timer mode) → `.br-grid` of student cards →
  `<details class="br-log-panel">` collapsible log + history at the
  bottom. Settings live in a `<dialog>` reached from the gear button in
  the top bar — the main view stays clean.
  **The toolbar is deliberately almost empty**: `.br-top` holds the period
  select and the settings gear, nothing else, and `.br-mode-row` is a
  **centred** row directly above the grid with the Quick tap / Timer
  toggle and the student search box. Everything else that used to sit up
  there was removed on purpose, so don't put it back: **no AUTO chip**
  (the bell is followed automatically — `followBell` starts true and only
  a manual period change turns it off for the session, a reload follows
  again), **no mode hint line**, **no quarter badge** (the quarter is in
  the log panel's summary line), **no full-screen button** (the top bar
  already has one), and **no date field** — the date + TODAY chip live
  inside the Log & History panel (`.br-log-tabs-row`, tabs left, date
  right), since another day is only something you look at there. The date
  still drives the grid as well as the log, so changing it force-opens the
  panel (`$('br-log-panel').open = true`) rather than leaving the only way
  back collapsed. `.bathroom-page` / `.bathroom` use `--space-3` gaps and
  `.br-top` a `--space-2` vertical pad so the grid starts high.
  **Two sign-out modes** (segmented pill on the main view, saved per
  period in `localStorage['teacherpal.bathroom.modes']`):
    - **Timer** (default): click a card → `bathroomSignOut` runs
      immediately (no confirmation), the student appears in the out-now
      strip with a live m:ss timer, and a 6-second undo bubble shows in
      case of a mistap. Each `.br-out-card` has an **End timer** button
      that calls `bathroomSignIn` — that's when the next `.br-pass`
      checkbox on the grid card fills. Past the flag limit the out-now
      card turns red and pulses.
    - **Quick tap**: one tap on a card immediately calls
      `insertBathroomTrip` with `out_at = in_at = now`, which counts as a
      completed pass (fills the checkbox on the spot). No confirmation,
      no out-now strip entry, no timer. The card flashes green for
      ~800 ms and a floating undo toast (`.br-undo-toast`, bottom-centre)
      offers **Undo** for 6 s — undo calls `deleteBathroomTrip`.
      The `maxOut` cap doesn't apply here (nobody is "out"); the
      per-quarter pass limit and existing-out-student blocks still do.
  Both modes write to the same `bathroom_log` rows, so log entries and
  quarter counts stay consistent. The active mode changes only the click
  handler branch and the card tooltip; everything else (grid, search,
  log/history, settings) is mode-agnostic. **States**: `.br-card.out` = dimmed + `Out` badge
  (can't be signed out twice); `.br-card.locked` = passes used ≥ limit,
  dashed red border + `No passes` badge (raise passes-per-quarter in the
  settings dialog to override). Grid `.br-pass` boxes: filled solid =
  completed pass, dashed = pending (their current in-progress trip),
  empty = unused. **Settings dialog** (`#br-settings-dialog`) holds
  Flag-after min, Max out at once, Passes per quarter, and per-quarter
  start/end date overrides. Quarter overrides live in
  `teacherpal.bathroom.quarters` (localStorage; only affects the bathroom
  page's `quarterFor()` — the rest of the app still uses
  `schedule.js`'s `QUARTERS`). Other settings in
  `teacherpal.bathroom.settings` (`{ flagMinutes: 8, maxOut: 2, passLimit: 4 }`).
  **Log & History** collapsible: two tabs. Today's log = chronological
  trips with hover-× delete. History = quarter-scoped summary per
  student, click a name for the detail view (per-quarter manual tally
  with −/+, list of timed trips across all dates). Seeding from paper:
  `seed-bathroom-q1.sql` (match rules: normalised exact → first + last
  word → first name + a shared surname, each only when unique in the
  period).
  - Don't add taglines, descriptions or sub-lines to the tool panels — the
    icon and the name are the whole card; if a tool needs explaining, fix
    the tool. (`.hud-sub` still exists in the stylesheet for the unused
    `.hud-panel.compact` variant; the hub doesn't use it.) Don't reuse the
    HUD look on tool pages.
- **Timer** (`timer.html` + `timer.js`). One `.timer-stage` `.hud-box`
  centred on the page: mode segmented control (Countdown / Stopwatch), a
  40-char label input, then the display — a `.timer-display-wrap` holding
  the digits, an optional overhead label, and **the themed dial** — one SVG
  (`.timer-dial`) with two skins, built once per document by `buildDial()`
  and painted by `paintDial(doc, now)` (page, pop-out and PiP all call the
  same pair):
    - **jarvis — arc reactor.** 60 `.dial-segs` ticks around the rim, lit in
      accent with a glow and going dark one by one as time drains
      (`i >= round(remaining * 60)` → `.off`), over a faint `.dial-inner`
      ring and 36 `.dial-marks` degree markings (every 3rd longer). Mono
      digits with a glow; label above in tracked uppercase. The smooth arc
      is hidden.
    - **marwa — soft.** One thick `.dial-arc` (`stroke-width: 7`, round
      caps, `pathLength=1`, `stroke-dashoffset` drains it) filled with the
      `#timer-arc-grad` accent→lavender gradient; segments, marks and inner
      ring hidden. Digits in **Comfortaa** (rounded), label in **sentence
      case** — the one place marwa overrides `text-transform`. A
      `.timer-mascot` (bunny) sits under the dial and reacts: `calm`
      breathe → `excited` wiggle in the final minute → `party` bounce at
      zero.
  **States** come from `data-state` on `.timer-display-wrap`: `warn` (final
  minute) pulses the ring in both themes; `alert` (zero) flashes the whole
  dial via `.timer-flash` in jarvis and fires `.timer-burst` (hearts +
  sparkles flying outward, `--marwa-burst-heart` / `-spark`) in marwa.
  `data-mode="stopwatch"` hides the progress but keeps the dial frame.
  **`state.zeroed`** holds the time's-up state after the auto-pause —
  without it the celebration vanished a frame after it appeared, and the
  display fell back to the full target instead of 0:00. Cleared by start /
  reset / preset / +1 min / mode change.
  Under the dial: preset chips
  (1/3/5/10/15 min) + custom min/sec inputs (hidden while running), Start
  → Pause → Resume, Reset, ±1 min (visible only while running/paused),
  and an extras row with Mute (`aria-checked`), Pop out, Picture-in-Picture
  (Chrome only — button hidden without `documentPictureInPicture`) and
  the full-screen icon. **Countdown accuracy**: the source of truth is
  `state.endsAt = Date.now() + remaining` (or `state.startedAt` in
  stopwatch mode); every window renders from `Date.now()` against those
  anchors, so a background-throttled tab never drifts. Last minute pulls
  the display to `--accent` (warn); at zero it flips to `--danger`, plays a
  three-note beep via Web Audio (respects mute) and auto-pauses. **Cross-window
  sync** on `BroadcastChannel('teacherpal-timer')`: the main window is the
  only writer, popouts and PiP request state on open and re-render from
  broadcasts; if the main window is gone, the popout falls back to
  `localStorage['teacherpal.timer.state']`. **Pop out**
  (`window.open('timer-popout.html', 'teacherpal-timer', 'popup=yes,720×420')`)
  is a bare `body.timer-popout` — label + display + ring, no controls,
  loads the same `timer.js` in popout mode. **Picture-in-Picture**
  (`documentPictureInPicture.requestWindow({ width: 420, height: 260 })`)
  clones the same markup into the always-on-top window and copies the
  parent's `data-theme` so tokens carry over. Closing pop-out or PiP does
  not stop the timer — it keeps running in the main window and its state
  outlives a page unload via localStorage. Space toggles start/pause when
  not typing. In full screen the mode row / setup / actions / extras hide
  and the display fills the screen.
- **Name Wheel** (`wheel.html` + `wheel-popout.html` + `wheel.js`).
  **Two columns** (`.wheel-layout`, `1.1fr / 0.9fr`, stacking to one column
  under 900px): the machine fills the left (`.wheel-stage` > `.wheel-wrap`,
  sized by height so it fills its column without ever scrolling the page),
  and `.wheel-side` on the right holds the result over the controls.
  **`.wheel-result`** shows "Spin to pick a student" until the first spin,
  then the winner large and bold: `result-in` scales it up from 0.45 with a
  spring overshoot as it fades in, plus a `.wheel-glow` flash (jarvis) or
  `.wheel-sparks` hearts and stars flying outward (marwa). The name **stays
  until the next spin**, when `result-out` shrinks it away — which is why
  `renderWinner()` leaves the text in place while `spin` is set instead of
  clearing it (clearing would leave nothing to animate). Under it sits the
  small `.wheel-result-sub`: the remaining count and the contextual
  put-back / take-off button. Controls follow below: the "press the hub or
  Space" hint, period + AUTO, then the toggles (No repeats, tick mute,
  First names, Reset, Pop out, full screen) and the `.wheel-called` chips.
  **The hub IS the Spin button** (`.wheel-hub-btn`, `#wheel-spin`): a small
  disc at the centre, 28% of the wrap = radius 14 in viewBox units, with
  hover (accent ring + glow + a nudge up in scale), pressed (scale down,
  inset shadow) and disabled states. It sits **outside `#wheel-rotor`**, so
  the wheel turns around it while it stays put, and `renderControls()` keeps
  its label fixed and flips `disabled` + `data-spinning` instead of
  rewording it. Space still calls `startSpin()` directly. There is no
  separate Spin button any more. The page's SVG carries no hub disc (the
  button is the disc) and no name — that lives in the result panel; only
  the pop-out fills `.wheel-hub-name`, since the projector has no right
  column and no button. The smaller page hub also buys label room:
  `drawWheel` uses `R - 18` for the page and `R - 24` for the pop-out's
  larger disc.
  **Fairness is structural**: `startSpin()` draws the winner first with
  `crypto.getRandomValues` (rejection-sampled so every index is equally
  likely), *then* solves for the rotation that parks that slice under the
  pointer — `to = 270 − centre − jitter`, plus 5-7 whole turns. The
  animation is a picture of a decision already made, so nothing about the
  easing or the frame rate can skew it.
  **Spin physics** (`runSpin()`): a **CSS transition** on `#wheel-rotor`
  (`transform`, 4500ms, `cubic-bezier(0.17, 0.67, 0.12, 0.99)`) — fast off
  the line, then a long tail where the last degrees crawl. It aims 4°
  *past* the mark and a second 460ms transition corrects back to `to`, which
  is the settle bounce. The rotor therefore uses a **CSS transform**, not
  the SVG `transform` attribute (attributes don't transition), turning about
  an explicit `transform-box: view-box` + `transform-origin: 50px 50px` so
  it can't wobble off centre. Under `prefers-reduced-motion` it collapses to
  a 400ms move with no overshoot.
  **`rotation` is a running total that only ever increases** — never wrapped
  back into 0-360. Each spin is built as `from + (5-6 whole turns) + the
  offset that lands the slice`, so `to` is always far past `from`; wrapping
  it (an earlier version normalised at the end) is exactly what lets a
  second spin target an angle the wheel is already sitting on and appear
  dead. `finishSpin()` leaves the transform where the settle put it and just
  records `rotation = s.to`, so nothing snaps at either end.
  **The reduced-motion trap (this cost a debugging round).** The app-wide
  rule `@media (prefers-reduced-motion: reduce) { * { transition: none
  !important } }` **outranks inline styles**, so on a machine with Windows
  animation effects off the rotor's inline transition never ran: the wheel
  teleported to the answer and looked like a dead button. The spin is the
  tool's entire function and only runs on an explicit click, so `#wheel-rotor`
  is exempted in that media query — and because `!important` wins, `wheel.js`
  drives the timing through `--wheel-dur` / `--wheel-ease` custom properties
  (set by `setTransition()` alongside the shorthand) which the exemption
  reads. Reduced motion still drops the bounce, the ring pulse, the hub
  pop-in and the mascot. **Any future inline-transition animation faces the
  same trap** — check `getComputedStyle().transitionDuration`, not the
  inline value, when an animation mysteriously doesn't run.
  **Nothing may touch the wheel mid-spin**: `syncWheel()`, `rebuildPool()`'s
  redraw and `autoPick()` all bail while `spin` is set (the next
  `startSpin()` re-syncs), and `applyRotation()` — which kills the
  transition to place the resting wheel — bails too. A stuck `spin` can
  never wedge the button either: `startSpin()` settles a spin whose end time
  has already passed and carries on with the click.
  **Ticks** are scheduled, not polled: `scheduleTicks()` inverts the easing
  curve (`bezier().timeAt`) to find when each slice crosses the pointer, so
  the ticks spread out exactly as the wheel slows (measured: ~48ms apart at
  the start, 300-1000ms at the end), with a 40ms floor so the opening burst
  doesn't machine-gun. The Spin button is disabled for the whole run and
  **the hub name only appears in `finishSpin()`**, after everything has
  stopped.
  **Who's on it**: the period's roster minus today's absentees (the
  `attendance` table, falling back to `readAbsentCache`) minus
  `readSitOutCache` — the same two exclusions Create Groups uses. AUTO
  follows the bell via `suggestedPeriod()`, exactly like Attendance.
  **No repeats** (default on) drops each pick into `called`
  (`teacherpal.wheel.called.<periodId>`, date-keyed so it clears overnight);
  when the pool empties it refills automatically. The count chip reads
  "N left of M". Picked students can be removed or put back from the row
  under the wheel, or restored by clicking their chip in the called strip.
  **`displayList` lags `pool` by one spin on purpose** — the winner stays on
  the wheel under the pointer until the next spin starts, otherwise the
  landing you just watched vanishes instantly.
  **Labels**: first names by default with the growing last-name prefix (the
  same rule as Create Groups, sharing `teacherpal.groups.firstNames`), drawn
  along each slice's middle radius and mirrored on the left half so nothing
  reads upside down. Font size is fitted **deterministically** from slice
  count *and* name length against the rim-to-hub gap — measuring with
  `getComputedTextLength()` is unreliable because the webfont usually hasn't
  loaded yet, and marwa's wider Comfortaa would run under the hub.
  **It is drawn as a machine, not a flat circle.** One square SVG
  (`viewBox="0 0 100 100"`, no stand): a `.housing` ring around the rim with
  a thicker `.housing-foot` arc across the bottom, a `.wheel-axle` of four
  bolts on the diagonals (clear of the name), and the pointer on a
  `.bracket` at the top. Depth comes from two overlay circles —
  `.face-sheen` (a radial gradient across the face) and `.face-ish` (an
  inner shadow at the rim). The wheel **fills its column**: `height: 100%`
  with `aspect-ratio: 1/1` and `max-width: 100%`, so it takes the column's
  height and clamps to its width when that is tighter; `.wheel-stage`'s
  small padding is the only margin. At 1280×720 that lands it at ~96% of the
  column height (a little less in marwa, which gives the mascot a row).
  **Slices** take a graduated ramp: `rampIndex()` alternates between the
  dark half (`--wheel-r0…r3`) and the light half (`r4…r7`), so each slice is
  an obvious step from its neighbour while the wheel still reads as one
  family, and an odd count pushes the last slice clear of the first. Names
  are near-white with a dark outline (`stroke` + `paint-order: stroke`) so
  they carry on every step, sized to fit the rim-to-hub gap and **shortened
  with an ellipsis** once that would take them under 2.6 units rather than
  running into the hub.
  **The pointer flicks** on the same schedule as the ticks (a 130ms
  `pointer-flick` keyframe, added even when muted), so it reads as being
  knocked by each passing segment and slows with the wheel.
  **Two skins, all from tokens** (no hard-coded colours in either):
    - **jarvis** — magenta ramp on a dark metal frame, mono uppercase names,
      a static `#wheel-dial` instrument ring outside the rim (degree ticks
      every 10°, longer every 30°, four corner brackets; built by
      `buildDialRing()` *outside* the rotor so it never spins), a sharp
      accent chevron pointer, a dark hub with the winner in the display
      face. Spinning adds a motion glow to the rim; landing lights the
      winning slice with `--wheel-won` and pulses the ring once. The stage
      is a `.hud-box` with corner ticks like the other jarvis pages.
    - **marwa** — the same machine in rose porcelain (`--wheel-metal`,
      `--wheel-housing`, rounder legs and bracket), pastel slice ramp,
      Comfortaa sentence-case names with a light halo, no instrument ring,
      a rounded drop pointer, a white hub with an accent ring, and a mascot
      under the wheel that wiggles while spinning and hops when a name
      lands. It also gets a slightly smaller wheel, since the mascot row
      costs height and the page still has to fit 1280×720.
  A Web Audio tick fires as each slice crosses the pointer (mute toggle,
  main window only so the pop-out doesn't double it), and the pop-out gets
  `{ list, rotation, spin, winnerId }` over `BroadcastChannel` and runs the
  same `runSpin()` descriptor, so both windows follow the same curve.
- **Noise Meter** (`noise.html` + `noise-popout.html` + `noise.js`). One
  `.noise-stage` `.hud-box`: the `.seg` of activity presets (Silent work /
  Partner talk / Group work — each moves both zone handles), then the
  `.noise-meter` (huge mono reading + `dB≈` unit, a pill `.noise-bar` whose
  `.noise-fill` grows and recolours, boundary marks on the track, the
  QUIET / OK / TOO LOUD scale, and the zone word), then Start/Stop, the
  chime `role="switch"`, Pop out, full screen, the two range handles
  ("Quiet up to" / "Too loud above") and the privacy line.
  **Measurement**: `getUserMedia({ audio: { echoCancellation: false,
  noiseSuppression: false, autoGainControl: false } })` — those three would
  normalise away the thing being measured — into an `AnalyserNode`
  (`fftSize` 2048). Each poll takes the RMS of `getFloatTimeDomainData`,
  converts to dBFS, and maps −70..0 dBFS onto a **35..95 display scale**
  (`DB_MIN`/`DB_MAX`); thresholds use the same units. It is a repeatable
  relative level, **not calibrated SPL**, and the page says so.
  **Smoothing** is a 500ms rolling average (`SMOOTH_MS`) so a cough or a
  dropped book doesn't spike the room. **Zones**: below `quiet` →
  `quiet`, below `loud` → `ok`, else `loud`; `data-zone` on `.noise-meter`
  drives every colour (`--noise-quiet/ok/loud`, defined per theme).
  **"Too loud"** needs `LOUD_HOLD_MS` 3000 of continuous red before
  `data-alert="1"` (flashing red reading + ringed bar) and a two-note Web
  Audio chime, rate-limited to one per 12s and skipped when muted.
  **Polling is `setInterval(50ms)`, never rAF** — rAF stops in a
  backgrounded window, which is exactly the pop-out-on-the-projector case;
  a timer only throttles to ~1s there. **Pop-out**
  (`window.open('noise-popout.html', …)`) is read-only and fed over
  `BroadcastChannel('teacherpal-noise')` at ~10/s; it never opens a mic of
  its own and shows "Press Start on the Noise Meter tab" when no state has
  arrived for 2s. **Mic lifecycle**: opens only on Start; Stop and
  `pagehide`/`beforeunload` stop every track and close the AudioContext.
  Nothing is recorded, buffered or uploaded — each poll reads the live
  signal and discards it. Settings (preset, both handles, mute) live in
  `teacherpal.noise.settings`; dragging a handle sets the preset to
  `custom`. Full screen hides the chrome (`.no-present`) and scales the
  reading/bar/zone word for the room.
- **Attendance view (`attendance.js`) — the Attendance screen.**
  `.attendance[data-mode="full"]` is a grid `minmax(0,1fr) clamp(19rem, 26vw,
  26rem)` — the `.att-chart` box on the left, `.att-side` (counts card with
  Copy / Reset / save state, then the lists box) on the right; the chart
  header holds PERIOD, AUTO, DATE + TODAY, the seated note, FIRST NAMES and
  EXPAND. (A 'compact' mode once fed the hub; only 'full' is used now.)
  - **Period**: `#period-select` + an **AUTO** chip. While AUTO is pressed
    (default) and the date is today, every clock tick calls
    `suggestedPeriod(now, sched, n => byNumber.has(n))` — the bell period
    happening now if a roster period maps to it (`parsePeriodName`), else the
    next taught period, else the last one — and switches the select when it
    changes. Changing the select by hand turns AUTO off; clicking AUTO turns
    it back on and jumps immediately. `#att-date` (defaults to today) views
    or fixes any past day; a TODAY chip appears when it isn't today, and AUTO
    never moves a past date.
  - **Chart** (`.hub-chart` > `.hub-room`): the shared room drawn with the
    same `.piece / .seat / .seat-label / .desk-block / .table-top /
    .piece.front` markup as the builder (geometry from `room.js`), scaled by
    `fitRoom()` (centred, dot grid scaled to match, re-fit by a
    `ResizeObserver`). **Full mode** fits `roomBounds` (whole room, zoom
    0.2–2.4, 12px margin). **Compact mode crops to what matters**:
    `fitBounds()` takes only pieces with an occupied seat — no teacher desk,
    empty desks or front marker — with a 4px margin and zoom up to 4, so the
    seats get the whole panel (~0.75 zoom at 1366px). Compact seat labels
    are sized by `fitLabels()`: one line at `LABEL_PX` 18px in room units,
    shrunk with a canvas `measureText` only for names wider than the seat,
    never below `LABEL_MIN` 13px — so names land at 11–14 screen px on a
    laptop; if that ever gets too small, widen the column, don't shrink
    the text. The state ring is 2px / the A·T badge 12px so both survive
    the scale-down. Read-only: no drag, no rotate, no palette. Occupied seats
    are `<button class="seat taken" data-student>`; labels counter-rotate
    via `labelStyle`. **Names**: the FIRST NAMES chip (default on, saved in
    `teacherpal.hub.firstNames`; the compact view has its own key
    `teacherpal.hub.firstNames.compact`, also default on) shows first names only, disambiguating
    shared first names with a growing last-name prefix exactly like Create
    Groups; off = "First L." for everyone. Students who have no seat appear
    in a `.att-tiles.small` "NOT SEATED" strip under the room so they can
    still be marked. Header right shows `SEATING 27/27 SEATED`.
  - **Expand** = the shared full-screen mode (the chip is
    a `[data-fullscreen]` button, EXPAND ↔ EXIT via `.when-off/.when-on`; F
    and the top-bar button do the same). In `body.present` the side column
    narrows, the chart fills the rest, and `#exp-counts` (P / A / T) shows
    in the chart header. Attendance clicks work identically in both sizes.
  - **No chart yet** (no room pieces, or nobody seated for the period): the
    roster is a `.att-tiles` grid of `.att-tile` buttons (same
    `data-student` / `data-status` contract) and the header reads
    `ROSTER NO SEATING CHART · BUILD ONE` linking to `seating.html`.
    Empty states (`.chart-empty`) link to Rosters.
  - **Click to cycle**: one delegated click handler on `.dash-left` for any
    `[data-student]` → `cycle(id)`: none → `absent` → `tardy` → none.
    Marking stores `{ status, at: now }`; tardy `at` is shown as "9:42 AM"
    in the list and in the copied text. State is painted purely through
    `data-status` on every element for that student: absent = 45% opacity,
    `--att-absent` (danger red) outline/inset ring and soft fill; tardy =
    `--att-tardy` (amber #F5B84B) outline and soft fill; both get a mono
    `::after` badge (A / T) tucked into the top-right corner. Tokens
    `--att-absent(-soft)` / `--att-tardy(-soft)` sit in the HUD block. A
    `.dash-legend` line explains the colours and the click.
  - **Side column**: `.att-card` = `.att-counts` "**23** present · **2**
    absent · **2** tardy" (present = roster − absent − tardy; red / amber
    numbers) plus the action row; `.att-lists-box` (`flex: 1`) = two
    `.att-list` columns (ABSENT nn / TARDY nn, names in roster order at
    `--fs-md`, tardy time in amber mono, "none" when empty). Actions (full
    mode): **Copy list**
    (writes `Absent: A, B / Tardy: C (9:42 AM)` with "none" for empty
    sides via `navigator.clipboard`, textarea fallback, and echoes it in
    `#status`), **Reset attendance** (confirm → `marks = {}` → immediate
    save) and the mono `.save-state` (SAVING… / ● SAVED green / NOT SAVED
    red). `beforeunload` warns while a save is pending.
  - **Persistence**: every click calls `scheduleSave()` — 500ms debounce,
    then `saveAttendance(periodId, date, marks)` and, when the date is
    today, `writeAbsentCache(periodId, absentIdsOf(marks))` so Create Groups
    and Seating see the same absentees. `loadPeriod()` fetches students,
    seat assignments and the day's attendance in parallel, drops marks for
    students no longer on the roster, and guards against stale responses
    with a load sequence number. If the table is missing the page says
    "run migration-attendance.sql" and still shows the chart.
- **Schedule model — `schedule.js` (West High bell schedules).**
  `SCHEDULES[key]` = `{ name, short, segments }` built from `P(n, start,
  end, note?)` (a class period) and `B(label, start, end)` (Lunch / Break /
  Activity), 24-hour `'HH:MM'`, listed in clock order. Keys: `early_release`
  (Monday default), `regular` ("Tues–Fri", Tue–Fri default), `minimum`,
  `double_second` (two period-2 segments whose `note` names the assembly
  half), `homecoming`, `finals` (`pairs['1-2'|'3-4'|'5-6']`, two 120-min
  periods + break), `no_school` (no segments). `scheduleFor(key, pair)`
  flattens finals into `{ key, name: 'Finals · Periods 1/2', short, segments,
  finalsPair }`. **Resolution**: `resolveSchedule(date, overrides)` — a row
  in `schedule_overrides` whose `date === dateKey(date)` always wins;
  otherwise `defaultScheduleKey` (Mon → early_release, Tue–Fri → regular,
  Sat/Sun → a synthetic `weekend` schedule with no segments). **Classes**:
  `teachingMap(periods)` → `Map<bellPeriodNumber, course>` via
  `parsePeriodName("3rd Period - English 9")` = `{ n: 3, course: 'English
  9' }` (also "Period 6", "P3 Biology"; unparseable names are skipped).
  **Status** `scheduleStatus(now, sched, teaches)` → `{ state, label, parts,
  text }` with `text = [label, ...parts].join(' · ')`:
  `PERIOD 3 · ENGLISH 9 · 22:14 REMAINING` (course, or `PREP` for a period
  not on the roster; assembly halves add `1ST ASSEMBLY`), `LUNCH · 39:40
  REMAINING` / `BREAK` / `ACTIVITY`, `PASSING · 4:32 to Period 4` (also to
  Lunch), `BEFORE SCHOOL · Period 1 in 1:12:00` (counts to the first period
  actually taught, else the first bell), `SCHOOL DAY COMPLETE`, `WEEKEND`,
  `NO SCHOOL`. `formatCountdown` is `h:mm:ss` over an hour, else `m:ss`.
  States: `period | break | passing | before | after | weekend | no-school`.
- **Schedule page** (`schedule.html`, nav tab "Schedule" after Rosters in
  the setup group; also linked from the hub's SCHED stat). Two cards in
  `.schedule-layout` (30rem + 1fr, stacks under 900px). **Schedule
  overrides**: a `.today-line` (today's schedule, "(override)" / "(weekday
  default)", and the live status), the weekday-default hint, an `.ov-form`
  (date input defaulting to today, schedule select from
  `SCHEDULE_OPTIONS`, a finals-pair select shown only for Finals, optional
  note, "Save override" = upsert on date) and the `.ov-list` of `.ov-row`s
  (date · schedule name + note · trash icon-button with a confirm; past rows
  at 45% opacity, today's row pink-ringed). **Bell schedules**: a select of
  all eight schedules (five + three finals pairs, opening on today's), a
  `.chip` saying "Monday default / Tue–Fri default / By override only", and
  a `.bell-table` (Block · Time in the printed 12-hour form via `fmt12` ·
  Class from the roster or italic "Prep"; break rows muted; the segment
  happening right now gets `.live` with a pink left bar). Re-renders every
  second. If the table is missing the page shows a "run
  migration-schedule-overrides.sql" error and still renders the reference.
- **Create Groups page** (`groups.html`; the nav tab and hub panel also say
  "Create Groups"). **Three panels across the top, results below.**
  `.groups-panels` (`.no-present`) is a 3-column grid (`--ctl: 2.2rem`,
  one column under 900px) of `.gp-panel` cards, each headed by a small
  tracked `.gp-title`:
    1. **Group size** — the `.seg.mode-seg` "Groups" / "Per group" toggle
       and the number input, nothing else. The number's meaning lives in
       its `aria-label` / `title`, kept in sync by `updateSummary()`,
       which also sets `min` 1 vs 2.
    2. **Roster** — the period select, the one-line `#roster-summary`
       ("26 present · 1 absent · 2 sitting out", also written by
       `updateSummary()`) and **Edit Roster**. **The roster list itself is
       not on the page**: the full per-student panel lives in
       `<dialog id="attendance-dialog">` and closing it returns to the
       summary.
    3. **Create** — `#btn-shuffle` full-width (3.2rem, accent glow),
       reading **Create Groups** then **Reshuffle**; under it a `.gp-row`
       with **Formula**, the **Follow rules** `role="switch"`
       (`#btn-use-formula`, moved out of the settings dialog), the gear
       and the full-screen button.
  `.gp-panel > :last-child { margin-top: auto }` drops each panel's last
  control onto a common bottom line.
  **`.stage` is just the results** and takes every pixel under the panels
  (`flex: 1 1 auto`, one `1fr` row) so the group cards are the focus.
  `.results` is `repeat(auto-fit, minmax(11rem, 1fr))` — auto-fit collapses
  the tracks it doesn't need, so six groups land on **one row** and the
  page fits 1280×720 without scrolling (full screen uses the same minimum
  for the same reason). `.stage.has-groups .results` switches to
  `align-content: stretch` so the cards share the height. Empty, `.results`
  shows a dashed box with "PRESS CREATE GROUPS" (suppressed by
  `.stage.no-students` when the `#empty` line is already saying it).
  `.groups-page` sets `scrollbar-gutter: stable` and hides its empty
  `.status`. **Nothing inside `.stage` may get an `overflow`** — the FLIP
  chips fly in from the Roster panel *above* the stage and a scroll
  container clips them mid-flight (that is exactly how the animation got
  lost once); the page scrolls, the stage doesn't. For the same reason
  `flipTo()` sets `main.page`'s `scrollTop = 0` before measuring First:
  First and Last measured at different scroll offsets would send every
  chip flying from the wrong place. **No counts on the bar and no preview
  line**: how many groups you get is the number you typed, and any problem
  (no students, everyone absent, number < 1) is reported by `doShuffle()`
  through `setStatus()` when you press the button. **First names only** is
  now the single field in the gear's `.groups-settings-dialog`. Full
  screen hides `.groups-panels` and the `.present-only` `#present-bar`
  (big Reshuffle + "Space reshuffles · Esc exits") takes over above the
  stage. Attendance lives in
  `<dialog id="attendance-dialog">`. On load, today's `attendance` row
  (`getAttendance(periodId, todayKey())`) wins: its absent ids become the
  `absent` set (tardy = present) and the cache is refreshed; without a row
  the same-browser cache `readAbsentCache()` is used. Every change
  (`saveAbsent()`) writes the cache and, debounced 400ms, upserts the row —
  setting/clearing `absent` marks while keeping any tardies the hub
  recorded. So attendance taken on the hub is already reflected here and
  vice versa; it resets tomorrow because it is keyed by date.
  **Absent vs sitting out — two separate states.** `absent` is attendance
  (synced both ways, above). `sitOut` is *grouping only*: here today, but
  out of the groups (nurse, pulled for testing, working alone). It lives in
  `teacherpal.sitout.<periodId>` via `readSitOutCache` / `writeSitOutCache`,
  is keyed by date so it clears overnight, is per browser, and **never
  touches the attendance table or the absent cache**. Two helpers split the
  roster: `presentStudents()` (not absent — drives the roster summary and
  the first-name disambiguation set) and `groupingStudents()` (not absent
  and not sitting out — drives `doShuffle`, the group count and the
  Formula run). Toggling: the per-student **Sit out** button in `<dialog
  id="attendance-dialog">`, where each row has an absent checkbox *and*
  a sit-out toggle (disabled when the student is already absent) and the
  header counts `N present · N absent · N sitting out` ("Everyone in"
  clears both), or **click a name in a group card** (chips carry
  `role="button"` + `tabindex`; Enter/Space work too) — that one is off
  in full screen so a stray click on the projector can't drop someone.
  Sitting-out names are dimmed + struck through
  (`.name-chip.sitting-out`); since there is no pool they simply don't
  appear in the cards. Toggling while groups are on screen says
  "press Reshuffle to rebuild". **Formula rules involving someone sitting
  out are dropped for that run** exactly like an absence — `doShuffle`
  passes the `groupingStudents()` ids into `rulesForPresent` /
  `planRules`, and the modal's `absent:` callback gets the union of both
  sets so those rules read as "out today · rules ignored".
  Mode / number / first-names are remembered in `teacherpal.groups.*`. "First names only" =
  text before the first space; present students sharing one get a growing
  last-name prefix ("Maria G.", "Brandon Ce." / "Brandon Cl.").
  **Formula on Create Groups**: the Create panel has the same "Formula on/off"
  switch (saved per period as the grouping row's `use_formula`) and a Formula button
  opening the shared modal (`scope: 'grouping'` → grouping types and labels,
  footer button "Create Groups"), reading/writing only grouping-scope rules
  via `getFormulaRules(periodId, 'grouping')` / `saveFormulaRules(…)`. With the toggle on, `doShuffle()` first runs
  `findImpossibleHard(…, 'grouping', { groupCount, groupMax })` and, if
  anything is impossible, `confirmImpossible()` (Cancel aborts; Run anyway
  demotes those rules), then `groupWithFormula(present, g, rules, nameOf,
  { demote })` and `summarizeRun()` for the status line. With no grouping
  rules it refuses with a hint. Results go through the same `flipTo()`
  animation. Seating's `populateWithFormula()` follows the identical
  check → confirm → solve → summarize flow.
- **Create Groups animation (FLIP, plain CSS + JS).** `#stage` holds one
  `.name-chip` element per grouped student (kept in a `chips` Map) inside
  `.group > .group-names`. There is no pool any more, so there are **two
  take-off points**: a chip that was already in a card flies from where it
  stood (Reshuffle), and a chip appearing for the first time flies out of
  the **Roster panel** — `transformOrigin: center`, `scale(0.35)` and
  `opacity: 0` → 1 (the first Create). `flipTo()` measures First rects and
  the Roster panel's box, calls `mountGroups()` (new `.group.enter` cards
  built into `#results`), inverts with `translate(...) scale(...)`, forces
  a reflow, then plays with `transform 520ms cubic-bezier(.34,1.56,.64,1)`
  (+ `opacity 240ms`) and a per-chip delay (`120ms + i * min(18ms, 600/n)`,
  shuffled order) so the total stays ≈1–1.5s; cards drop `.enter`
  (opacity/scale 260ms) before names arrive. A reshuffle first adds
  `.shuffling` (chips lift/wiggle 320ms — skipped when there is nothing on
  screen yet) and then flies chips from old card to new. `setAnimating()`
  disables the buttons/select while running. Under `prefers-reduced-motion`
  the stage simply fades. Full screen uses the same stage; Space reshuffles.
  **Two things quietly kill the flight, so don't reintroduce them:** an
  `overflow` on `#stage` or any ancestor between it and `main.page` (the
  chips are clipped mid-flight), and starting a run at a non-zero
  `main.page.scrollTop` (First and Last get measured from different
  origins) — `flipTo()` zeroes the scroll before measuring for exactly
  that reason. To test the flight in headless Edge on this machine (OS
  animations off) pass `--blink-settings=prefersReducedMotion=false`;
  note the animation clock is frozen under `--virtual-time-budget`, so
  screenshots show start/end states only — check
  `document.getAnimations()` instead of trying to catch a frame.
- **Seating Chart = freeform room builder** (`seating.html`). Compact
  `.seat-bar` (period, **Arrange Room / Assign Seats** `.seg` toggle,
  mode-specific tools, undo/redo, zoom −/%/+/Fit, Saved indicator, full screen)
  over a `.seat-side` sidebar + `.viewport` canvas. **The room is infinite**:
  the `.viewport` paints the dot grid (`background-size = G*zoom`,
  `background-position = pan`) so it fills the panel at every zoom, and
  `.room` is a zero-size origin transformed with `translate(pan) scale(zoom)`
  that pieces hang off at any coordinate, negative included — nothing is
  ever clamped to a room rectangle;
  `clientToRoom()` converts pointer coords; Ctrl+wheel zooms around the
  cursor, wheel pans, `fitToScreen()` frames all pieces. Pieces are `.piece`
  divs at `left:0; top:0` placed with `transform: translate3d(x*G, y*G, 0)
  rotate(deg)` (composited — never top/left), rotated about their centre; each holds
  `.seat` boxes (`data-seat="<pieceId>:<i>"`) and, for the teacher desk, a
  `.desk-block`; `.seat-label` counter-rotates so names stay upright (its box
  is the seat width when roughly level, the height when roughly sideways,
  the smaller side at odd angles). `bbox()` gives the axis-aligned box of the
  rotated piece (`w|cos|+h|sin|` × `w|sin|+h|cos|`) — snapping, marquee and
  fit all use it, so edge-snapping works against rotated pieces too. **All dragging is pointer events + pointer capture**
  (`touch-action: none`) so it works on an iPad. **Drag feel** (copied from
  RotationPal's hand-rolled court-bubble drag, not dnd-kit): 3px activation,
  then `.lifting` (z-index + brightness, no transition); every pointermove
  only stores numbers and calls `frame(fn)` — a one-slot
  `requestAnimationFrame` batcher, so there is exactly one DOM write per
  refresh; the piece follows the pointer 1:1 with **no snapping during the
  drag**, while a dashed `.snap-ghost` per piece shows where `snapBox()`
  (round to grid, then snap edges to nearby pieces within 0.75 units — how
  single desks "click" together) will land it. On release: `flushFrame()`,
  state set to the snapped spot, `.settling` (`transition: transform 120ms
  ease`) eases the DOM there, then `commit()` runs once after 130ms (one
  render, one autosave). Nothing re-renders or saves mid-drag. Palette drags
  show the same snap ghost on the canvas; pan, marquee, rotation (transforms
  + `.seat-label` restyle via `data-w/data-h`, no element replacement) and
  name drags all go through `frame()` too. Headless Edge does not run rAF
  under `--virtual-time-budget` — shim it onto `setTimeout` in test hooks. Shift-click toggles; **left-drag on empty canvas pans** (grab cursor),
  **Shift+drag box-selects** (`.marquee`), Space / the hand button /
  middle-mouse also pan; plain wheel scrolls the canvas, Shift+wheel scrolls
  sideways, Ctrl+wheel / trackpad pinch zooms about the cursor. **Rotation is a toggled mode**: a
  selected piece shows only its outline; R or the Rotate button
  (`aria-pressed` while on) calls `enterRotate()`, which captures `base` and a
  `rotSession` (ids, shared centre from `selectionGeom()`) and shows the
  `.rot-handle` on the piece's local "up", the `.rot-line`, a dashed
  `.rot-ring` and the `.rot-label` ("37°"). While it is on, a pointerdown on
  the handle **or the piece body** starts a rotate drag (`beginRotateDrag()`
  re-measures start angles so nothing jumps); `rotateTo()` follows the
  pointer angle around the centre, snaps to 15° with Shift and to
  0/90/180/270 within 3°, and orbits multi-selections around the shared
  centre — all batched through `frame()`. Releasing keeps the mode on. R
  again, Enter, or a click on empty canvas / another piece →
  `confirmRotate()` (keeps the angle; one `commit()` = one undo step, skipped
  if nothing turned; a click on another piece then selects it as normal);
  Esc → `cancelRotate()` restores the state from when the mode began.
  Duplicate (Ctrl+D),
  Delete (Del) act on the selection; the Front marker moves but can't rotate
  or be deleted. Assign mode locks pieces; names drag from the `.student-chip`
  list (unseated ones have a pink border) or from a seat, drop target found
  with `elementFromPoint` → `placeStudent()` (swap when occupied) or
  `unseat()` when dropped on the sidebar; Randomize fills every seat,
  Clear seats empties, "First names" shares the `teacherpal.groups.firstNames`
  setting. **Undo/redo** is a snapshot stack of `{ front, pieces, assignments }`
  (`base` is captured before a change, `commit()` pushes it); Ctrl+Z /
  Ctrl+Shift+Z / Ctrl+Y. **Autosave**: `commit()` marks `dirty.layout` /
  `dirty.seats`, `scheduleSave()` debounces 600ms then upserts via
  `saveRoomLayout` / `saveSeatAssignments` and sets the `.save-state` text
  (Saving… / ● Saved / Not saved); `beforeunload` warns if dirty. Full
  screen forces Assign, hides sidebar/bars and fits the room with 14px labels.
  If the room tables are missing the page still loads periods and shows a
  "run migration-room-builder.sql" error.
- **Formula system — `formula.js`: shared code, separate data.** Each page
  owns one rule set per period in its own `scope` (see the `seating_rules`
  schema) and passes `scope` into every helper and into
  `createFormulaModal({ scope })`; the modal is the same component pointed
  at different data. **Rule model**: `{ id, type, a, b?, hard }`; the array
  order is the priority list. `RULE_TYPES[type]` holds `pair` and
  `defaultHard`; `SCOPE_TYPES[scope]` lists which types exist in a scope and
  their wording — seating: "Don't sit near / Should sit next to / Can be
  close to / In the front / In the back"; grouping: "Should not be grouped
  with / Should be grouped with / Fine together" (no front/back at all — the
  chips, number keys 4–5 and `planRules` simply don't include them). Shared
  helpers: `ruleLabel`, `ruleSentence(r, nameOf, scope)`, `ruleContradictions`,
  `rulesForPresent`, `absentTodayFor`.
  **Priority & weights** (`planRules(rules, presentIds, scope, demote)`): drop
  rules that don't apply (absent participant, type not in this scope), order
  with `sortByPriority()` (all "Must meet" first, then "Try to meet", each
  keeping their list order) and attach a `weight`: hard = `HARD_WEIGHT` 1000
  (a broken must always outweighs every soft rule combined); soft = linear
  from `SOFT_MAX` 30 for the top soft rule down to `SOFT_MIN` 3 for the
  last, so when not everything fits the higher one wins. Rules in the
  `demote` set are treated as soft for that run (`demoted: true`, shown as
  'run as "try"' in the summary).
  **Feasibility first** (`findImpossibleHard(rules, nameOf, ctx, info)`):
  before solving, hard rules that cannot all hold are named with a reason —
  hard apart+together on one pair, hard front+back on one student, a
  must-together chain longer than the biggest group (`info.groupMax`), an
  apart pair joined by a together-chain, a mutually-apart clique bigger than
  `info.groupCount` (greedy clique), or more hard front/back students than
  zone seats. Pages call `confirmImpossible()` (a small `<dialog>`) — Cancel
  aborts, "Run anyway" demotes exactly those rules. **Solver**
  `annealAssign({ items, slots, evaluate })`: simulated annealing over slot
  swaps, 4000 steps, T 20→0.5, 6 random restarts, keep the best; every run
  starts from a fresh shuffle so reshuffles differ. `evaluate` returns
  `{ score, unmet: [{ rule, why }] }`; `summarizeRun()` turns that into
  "Grouped/Seated using formula · all N rules met." or "… · 2 rules missed:
  A ↔ B: … (must — ended up in the same group); …".
  **Groups** (`groupWithFormula`): balanced group-size slots; apart in the
  same group / together split cost the rule's weight, close split costs
  0.1×weight (mild, never listed as missed); a together-chain longer than
  the group size is explained in `notes` ("… they were split"). **Seating**
  (`evaluateSeating` in seating.html): apart near / together not adjacent
  / front outside the K closest seats cost the weight, back is a 0.2×
  pull, close a 0.02× pull per unit; front/back capacity for the check is
  K (tagged count) and the farther half.
  **Modal** (`createFormulaModal(opts)`, one per page from callbacks:
  `context`, `students`, `absent`, `displayName`, `getRules`/`setRules`,
  `populateLabel`, `onPopulate`): 75vw × 75vh, header with Rules / Priority
  tabs. **Rules tab**: roster with search + rule-count pills; the student's
  rules as colour-coded cards (type label, names, a "Must meet / Try to meet"
  pill that toggles, ×), and an Add-rule area (type chips with 1–5 shortcuts,
  other-student select, a "Must meet" checkbox defaulting from
  `defaultHard`); new hard rules join at the bottom of the hard band, soft at
  the end. **Priority tab**: every rule in one draggable list (HTML5 DnD,
  band-locked — a rule can't be dragged across the divider; toggle Must/Try
  to change band) with "Must meet — constraints" / "Try to meet — highest
  first" dividers. Keyboard (one document listener while open, skipped while
  typing): ↑/↓ walk students (Rules) or rules (Priority), letters search,
  1–5 pick a type, Enter adds, click a rule to highlight then **M** toggles
  must/try, **Ctrl+↑/↓** moves it within its band, Del removes, Esc clears
  search → leaves the add row → closes, Ctrl+Enter runs `onPopulate`.
- **Layout is unchanged by theme work**: app shell grid (top bar / main,
  no sidebar) locked to `100dvh`, fluid root font, rem everywhere, each tool
  scrolls internally, roster is a sticky panel + numbered `columns: 18rem`
  list, the seating room is a zoom/pan canvas, full screen hides the nav
  links and slims the header. Check new work at 1366×768, 1080p, 4K and 375px.

## Dev server — start this at the beginning of every session

Run live-server in the background so the app opens in the browser and
auto-reloads on every file save:

```
npx --yes live-server --port=8080
```

URL: **http://127.0.0.1:8080**. Check first whether it is already up
(`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/` returns 200)
before starting another one. `npx` runs it from the npm cache — it must not add
a `package.json` or `node_modules` to the repo (rule 1 still applies).

## Setup (first time)

1. Run `schema.sql` in the Supabase SQL editor.
2. Paste the project URL and anon key into the two constants at the top of
   `shared.js` (Supabase dashboard → Settings → API).
3. Push to the Vercel-connected repo, or open `index.html` locally.
