// schedule.js — West High bell schedules as data, plus the pure functions that
// turn a date + time into "what is happening right now".
//
// No DOM and no Supabase in here. Overrides (one row per date, see
// schedule_overrides in schema.sql) are loaded through shared.js and passed
// in. Times are 24-hour 'HH:MM' strings; period 0 is the early "zero" period.

// ---------------------------------------------------------------------------
// Segment builders
// ---------------------------------------------------------------------------

// A class period. `note` is extra wording shown after the course (assembly halves).
function P(n, start, end, note) {
  return { kind: 'period', n, label: `Period ${n}`, start, end, note: note || null };
}
// A non-class block: Lunch, Break, Activity.
function B(label, start, end) {
  return { kind: 'break', label, start, end };
}

// ---------------------------------------------------------------------------
// The schedules. Segments are listed in clock order.
// ---------------------------------------------------------------------------

const SCHEDULES = {
  early_release: {
    name: 'Early Release Monday',
    short: 'EARLY RELEASE',
    segments: [
      P(0, '07:25', '08:24'),
      P(1, '08:30', '09:14'),
      P(2, '09:20', '10:04'),
      P(3, '10:10', '10:59'),
      P(4, '11:05', '11:49'),          // period 4 runs straight into lunch
      B('Lunch', '11:49', '12:29'),
      P(5, '12:35', '13:19'),
      P(6, '13:25', '14:09'),
      P(7, '14:14', '14:58'),
    ],
  },
  regular: {
    name: 'Tues–Fri',
    short: 'TUES–FRI',
    segments: [
      P(0, '07:25', '08:24'),
      P(1, '08:30', '09:29'),
      P(2, '09:35', '10:34'),
      P(3, '10:40', '11:45'),
      B('Lunch', '11:45', '12:25'),
      P(4, '12:31', '13:30'),
      P(5, '13:36', '14:35'),
      P(6, '14:41', '15:40'),
      P(7, '15:46', '16:45'),
    ],
  },
  minimum: {
    name: 'Minimum Day',
    short: 'MINIMUM DAY',
    segments: [
      P(0, '07:25', '08:24'),
      P(1, '08:30', '09:06'),
      P(2, '09:12', '09:48'),
      P(3, '09:54', '10:30'),
      B('Break', '10:30', '10:40'),
      P(4, '10:46', '11:22'),
      P(5, '11:28', '12:04'),
      P(6, '12:10', '12:46'),
      P(7, '12:52', '13:28'),
    ],
  },
  double_second: {
    name: 'Double 2nd Period Assembly',
    short: 'DOUBLE 2ND',
    segments: [
      P(0, '07:25', '08:24'),
      P(1, '08:30', '09:17'),
      P(2, '09:24', '10:21', '1st Assembly · MS, H, K, Theater'),
      P(2, '10:28', '11:25', '2nd Assembly · P, G, T, Gym/JROTC'),
      P(3, '11:32', '12:19'),
      B('Lunch', '12:19', '12:59'),
      P(4, '13:06', '13:53'),
      P(5, '14:00', '14:47'),
      P(6, '14:54', '15:40'),
    ],
  },
  homecoming: {
    name: 'Homecoming Activity',
    short: 'HOMECOMING',
    segments: [
      P(0, '07:25', '08:24'),
      P(1, '08:30', '09:23'),
      P(2, '09:29', '10:22'),
      P(3, '10:28', '11:21'),
      B('Activity', '11:21', '12:01'),
      B('Lunch', '12:01', '12:41'),
      P(4, '12:47', '13:40'),
      P(5, '13:46', '14:40'),
      P(6, '14:46', '15:40'),
    ],
  },
  // Finals: two 120-minute periods per day. The override row says which pair.
  finals: {
    name: 'Finals',
    short: 'FINALS',
    pairs: {
      '1-2': [P(1, '08:30', '10:30'), B('Break', '10:30', '10:40'), P(2, '10:46', '12:46')],
      '3-4': [P(3, '08:30', '10:30'), B('Break', '10:30', '10:40'), P(4, '10:46', '12:46')],
      '5-6': [P(5, '08:30', '10:30'), B('Break', '10:30', '10:40'), P(6, '10:46', '12:46')],
    },
  },
  no_school: {
    name: 'No School',
    short: 'NO SCHOOL',
    segments: [],
  },
};

const FINALS_PAIRS = ['1-2', '3-4', '5-6'];

// Choices offered by the override UI, in menu order.
const SCHEDULE_OPTIONS = [
  { key: 'minimum', name: 'Minimum Day' },
  { key: 'double_second', name: 'Double 2nd Period Assembly' },
  { key: 'homecoming', name: 'Homecoming Activity' },
  { key: 'finals', name: 'Finals' },
  { key: 'no_school', name: 'No School' },
  { key: 'early_release', name: 'Early Release (Monday schedule)' },
  { key: 'regular', name: 'Tues–Fri (regular schedule)' },
];

// ---------------------------------------------------------------------------
// Resolving which schedule a date follows
// ---------------------------------------------------------------------------

// 'YYYY-MM-DD' in local time (matches the `date` column as PostgREST returns it).
function dateKey(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// Weekday default: Monday = Early Release, Tue–Fri = regular, weekend = null.
function defaultScheduleKey(date) {
  const d = date.getDay();
  if (d === 0 || d === 6) return null;
  return d === 1 ? 'early_release' : 'regular';
}

// { key, name, short, segments, finalsPair } for a schedule key (+ pair for finals).
function scheduleFor(key, finalsPair) {
  const s = SCHEDULES[key];
  if (!s) throw new Error(`Unknown schedule: ${key}`);
  if (key === 'finals') {
    const pair = FINALS_PAIRS.includes(finalsPair) ? finalsPair : FINALS_PAIRS[0];
    const nice = pair.replace('-', '/');
    return { key, name: `Finals · Periods ${nice}`, short: `FINALS ${nice}`, segments: s.pairs[pair], finalsPair: pair };
  }
  return { key, name: s.name, short: s.short, segments: s.segments, finalsPair: null };
}

// An override for the date always beats the weekday default.
// overrides: rows from getScheduleOverrides() — [{ date, schedule, finals_pair, ... }]
function resolveSchedule(date, overrides) {
  const k = dateKey(date);
  const ov = (overrides || []).find((o) => o.date === k);
  if (ov) return { ...scheduleFor(ov.schedule, ov.finals_pair), override: ov };
  const key = defaultScheduleKey(date);
  if (!key) return { key: 'weekend', name: 'Weekend', short: 'WEEKEND', segments: [], finalsPair: null, override: null };
  return { ...scheduleFor(key), override: null };
}

// ---------------------------------------------------------------------------
// Roster period names → bell period numbers
// "3rd Period - English 9" → { n: 3, course: 'English 9' }; "Period 6" → { n: 6, course: null }
// ---------------------------------------------------------------------------

function parsePeriodName(name) {
  const s = String(name || '').trim();
  let m = s.match(/^(\d+)\s*(?:st|nd|rd|th)?\s*(?:period|per\.?|p)?\s*[-–—:·|]?\s*(.*)$/i)
       || s.match(/^(?:period|per\.?|p)\s*(\d+)\s*[-–—:·|]?\s*(.*)$/i);
  if (!m) return { n: null, course: null };
  return { n: Number(m[1]), course: m[2].trim() || null };
}

// Map<periodNumber, courseLabel> from the roster's period rows. Periods whose
// name has no number are skipped (they can't be placed on the bell schedule).
function teachingMap(periods) {
  const map = new Map();
  for (const p of periods || []) {
    const { n, course } = parsePeriodName(p.name);
    if (n !== null && !map.has(n)) map.set(n, course || p.name);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Live status
// ---------------------------------------------------------------------------

const toSec = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 3600 + m * 60; };

// 1:12:00 above an hour, otherwise m:ss (22:14, 4:32).
function formatCountdown(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

// 12-hour clock without am/pm, the way the bell schedule is printed ("10:46").
function fmt12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
}

// Which bell period the hub should open on: the period happening now if it
// is one the teacher has a roster for, otherwise the next taught period of
// the day, otherwise (after school) the last taught one. `taught(n)` says
// whether a roster period exists for bell period n. Returns n or null.
function suggestedPeriod(now, sched, taught) {
  const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const periods = sched.segments.filter((s) => s.kind === 'period' && taught(s.n));
  if (!periods.length) return null;
  const cur = periods.find((s) => t >= toSec(s.start) && t < toSec(s.end));
  if (cur) return cur.n;
  const next = periods.find((s) => toSec(s.start) > t);
  return next ? next.n : periods[periods.length - 1].n;
}

// What to show in the hub status bar right now.
// now: Date; sched: from resolveSchedule(); teaches: from teachingMap().
// Returns { state, label, parts, text } — `text` is the ready-made line.
function scheduleStatus(now, sched, teaches) {
  const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const segs = sched.segments;
  const done = (state, label, parts = []) => ({ state, label, parts, text: [label, ...parts].join(' · ') });

  if (sched.key === 'weekend') return done('weekend', 'WEEKEND');
  if (!segs.length) return done('no-school', sched.short === 'NO SCHOOL' ? 'NO SCHOOL' : sched.short);

  const nameOf = (seg) => (seg.kind === 'period' ? `Period ${seg.n}` : seg.label);
  const cur = segs.find((s) => t >= toSec(s.start) && t < toSec(s.end));
  if (cur) {
    const left = `${formatCountdown(toSec(cur.end) - t)} REMAINING`;
    if (cur.kind === 'period') {
      const course = teaches.has(cur.n) ? (teaches.get(cur.n) || '').toUpperCase() : 'PREP';
      const parts = [course, cur.note && cur.note.split(' · ')[0].toUpperCase(), left].filter(Boolean);
      return done('period', `PERIOD ${cur.n}`, parts);
    }
    return done('break', cur.label.toUpperCase(), [left]);
  }

  const first = segs[0], last = segs[segs.length - 1];
  if (t < toSec(first.start)) {
    // count down to the first period actually taught (else the first bell)
    const target = segs.find((s) => s.kind === 'period' && teaches.has(s.n)) || first;
    return done('before', 'BEFORE SCHOOL', [`${nameOf(target)} in ${formatCountdown(toSec(target.start) - t)}`]);
  }
  if (t >= toSec(last.end)) return done('after', 'SCHOOL DAY COMPLETE');

  const next = segs.find((s) => toSec(s.start) > t);
  return done('passing', 'PASSING', [`${formatCountdown(toSec(next.start) - t)} to ${nameOf(next)}`]);
}

// ---------------------------------------------------------------------------
// Quarters — used for bathroom-pass allowances (N passes per quarter).
// Dates are inclusive. Q2 and Q4 end on the finals weeks; Q1/Q3 starts and
// the Q1→Q2 / Q3→Q4 splits are best guesses — ADJUST to the real calendar.
// ---------------------------------------------------------------------------
const QUARTERS = [
  { q: 'Q1', start: '2026-08-10', end: '2026-10-09' },
  { q: 'Q2', start: '2026-10-12', end: '2026-12-18' },
  { q: 'Q3', start: '2027-01-04', end: '2027-03-12' },
  { q: 'Q4', start: '2027-03-15', end: '2027-05-28' },
];

// 'YYYY-MM-DD' → 'Q1'..'Q4'. Dates in a gap (breaks) count toward the quarter
// that just ended; before the year starts → Q1, after it ends → Q4.
function quarterOf(ymd) {
  for (const qt of QUARTERS) if (ymd <= qt.end) return ymd >= qt.start || qt === QUARTERS[0] ? qt.q : prevQuarter(qt.q);
  return QUARTERS[QUARTERS.length - 1].q;
}
function prevQuarter(q) { const i = QUARTERS.findIndex((x) => x.q === q); return QUARTERS[Math.max(0, i - 1)].q; }
const currentQuarter = () => quarterOf(dateKey(new Date()));
