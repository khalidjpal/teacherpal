// formula.js — the shared "Formula" ALGORITHMS and modal used by the Seating
// Chart and Create Groups pages. Only code is shared here: the rule DATA is
// two separate sets per period — scope 'seating' (used by seating.html) and
// scope 'grouping' (used by groups.html) — each with its own rules, priority
// order and "Formula on/off" toggle, loaded/saved by the page through
// shared.js getFormulaRules/saveFormulaRules(periodId, scope, …). Nothing in
// this file ever touches both scopes.
//
// A rule: { id, type, a, b?, hard }
//   seating types:  apart | together | close | front | back
//   grouping types: apart | together | close          (front/back do not exist here)
//   pair rules are stored once and apply both ways
//   hard = true  → "Must meet": a constraint, only broken when impossible
//   hard = false → "Try to meet": scored by its position in the priority list
// The rules array order IS the priority order (index 0 = highest).

// ---------------------------------------------------------------------------
// Rule metadata + per-page wording
// ---------------------------------------------------------------------------

const RULE_TYPES = {
  apart:    { pair: true,  defaultHard: true },
  together: { pair: true,  defaultHard: false },
  close:    { pair: true,  defaultHard: false },
  front:    { pair: false, defaultHard: true },
  back:     { pair: false, defaultHard: false },
};
// Which types exist in each scope, with that scope's wording and number-key shortcut
const SCOPE_TYPES = {
  seating:  { apart: "Don't sit near", together: 'Should sit next to', close: 'Can be close to', front: 'In the front', back: 'In the back' },
  grouping: { apart: 'Should not be grouped with', together: 'Should be grouped with', close: 'Fine together' },
};
const KEY_TYPES = { 1: 'apart', 2: 'close', 3: 'together', 4: 'front', 5: 'back' };
const scopeTypes = (scope) => Object.keys(SCOPE_TYPES[scope] || SCOPE_TYPES.seating);
const typeInScope = (type, scope) => !!(SCOPE_TYPES[scope] || SCOPE_TYPES.seating)[type];
const HARD_WEIGHT = 1000;          // a broken "must" costs this — always above every soft rule combined
const SOFT_MAX = 30, SOFT_MIN = 3; // soft rules are worth 30 → 3 by priority position

const ruleLabel = (type, scope = 'seating') => (SCOPE_TYPES[scope] || SCOPE_TYPES.seating)[type] || type;
const ruleIsPair = (type) => !!(RULE_TYPES[type] && RULE_TYPES[type].pair);
const ruleIsHard = (r) => (r.hard === undefined ? !!RULE_TYPES[r.type]?.defaultHard : !!r.hard);
const ruleSamePair = (r, a, b) => (r.a === a && r.b === b) || (r.a === b && r.b === a);
const rulesForStudent = (rules, sid) => rules.filter((r) => r.a === sid || r.b === sid);

// Hard rules first, then soft, each keeping their relative order
function sortByPriority(rules) {
  return [...rules.filter(ruleIsHard), ...rules.filter((r) => !ruleIsHard(r))];
}
// Weight of a rule given its rank among the rules that apply to this run
function priorityWeight(r, rank, softCount) {
  if (ruleIsHard(r)) return HARD_WEIGHT;
  if (softCount <= 1) return SOFT_MAX;
  return SOFT_MAX - ((SOFT_MAX - SOFT_MIN) * rank) / (softCount - 1);
}

// "Josh ↔ Michael: don't sit near" / "Josh: in the front"
function ruleSentence(r, nameOf, ctx = 'seating') {
  const label = ruleLabel(r.type, ctx).toLowerCase();
  return ruleIsPair(r.type) ? `${nameOf(r.a)} ↔ ${nameOf(r.b)}: ${label}` : `${nameOf(r.a)}: ${label}`;
}

// apart + together on the same pair; front + back on one student
function ruleContradictions(rules, nameOf, ctx = 'seating') {
  const out = [];
  for (const r of rules) {
    if (r.type === 'together' && rules.some((o) => o.type === 'apart' && ruleSamePair(o, r.a, r.b))) out.push(`${ruleSentence(r, nameOf, ctx)} — but also "${ruleLabel('apart', ctx).toLowerCase()}"`);
    if (r.type === 'front' && rules.some((o) => o.type === 'back' && o.a === r.a)) out.push(`${ruleSentence(r, nameOf, ctx)} — but also "in the back"`);
  }
  return out;
}

// Only rules whose participants are all present (absent students are skipped for the run)
function rulesForPresent(rules, presentIds) {
  return rules.filter((r) => presentIds.has(r.a) && (!ruleIsPair(r.type) || presentIds.has(r.b)));
}

// Today's absentees as marked in Create Groups' "Edit Roster" (localStorage, today only)
function absentTodayFor(periodId) {
  try {
    const raw = JSON.parse(localStorage.getItem(`teacherpal.absent.${periodId}`) || 'null');
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (raw && raw.date === today && Array.isArray(raw.ids)) return new Set(raw.ids);
  } catch { /* ignore */ }
  return new Set();
}

// ---------------------------------------------------------------------------
// Feasibility: which HARD rules cannot all hold, before we even search.
// Returns [{ rule, why }] — the pages show these and offer to run anyway
// (demoting exactly those rules to soft).
//   ctx 'grouping': { groupCount, groupMax }
//   ctx 'seating': { frontSeats, backSeats }  (capacity of the zones)
// ---------------------------------------------------------------------------

function findImpossibleHard(rules, nameOf, ctx, info) {
  const hard = rules.filter(ruleIsHard).filter((r) => typeInScope(r.type, ctx));
  const bad = new Map();   // rule.id → why
  const flag = (r, why) => { if (!bad.has(r.id)) bad.set(r.id, why); };

  // direct contradictions between two hard rules
  for (const r of hard) {
    if (r.type === 'together') { const o = hard.find((x) => x.type === 'apart' && ruleSamePair(x, r.a, r.b)); if (o) { flag(r, `contradicts "${ruleSentence(o, nameOf, ctx)}"`); } }
    if (r.type === 'front') { const o = hard.find((x) => x.type === 'back' && x.a === r.a); if (o) flag(r, `contradicts "${ruleSentence(o, nameOf, ctx)}"`); }
  }

  // "together" chains: merge into clusters
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const r of hard) if (r.type === 'together') parent.set(find(r.a), find(r.b));
  const clusterOf = (id) => find(id);
  const members = new Map();
  for (const r of hard) if (r.type === 'together') for (const id of [r.a, r.b]) { const c = clusterOf(id); if (!members.has(c)) members.set(c, new Set()); members.get(c).add(id); }

  if (ctx === 'grouping') {
    // a must-be-together chain longer than the biggest group
    for (const r of hard) if (r.type === 'together') {
      const size = members.get(clusterOf(r.a)).size;
      if (size > info.groupMax) flag(r, `${size} students must be grouped together but groups hold at most ${info.groupMax}`);
    }
    // an "apart" pair that a together-chain forces into one group
    for (const r of hard) if (r.type === 'apart' && parent.has(r.a) && parent.has(r.b) && clusterOf(r.a) === clusterOf(r.b)) flag(r, 'a "must be grouped with" chain puts them in the same group');
    // more mutually-apart students (a clique) than groups
    const apartAdj = new Map();
    for (const r of hard) if (r.type === 'apart') { for (const [x, y] of [[r.a, r.b], [r.b, r.a]]) { if (!apartAdj.has(x)) apartAdj.set(x, new Set()); apartAdj.get(x).add(y); } }
    const clique = greedyClique(apartAdj);
    if (clique.length > info.groupCount) {
      for (const r of hard) if (r.type === 'apart' && clique.includes(r.a) && clique.includes(r.b)) flag(r, `${clique.length} students must all be kept apart but there are only ${info.groupCount} groups`);
    }
  } else {
    const fronts = new Set(hard.filter((r) => r.type === 'front').map((r) => r.a));
    const backs = new Set(hard.filter((r) => r.type === 'back').map((r) => r.a));
    if (fronts.size > info.frontSeats) for (const r of hard) if (r.type === 'front') flag(r, `${fronts.size} students must be in the front but only ${info.frontSeats} seat${info.frontSeats === 1 ? '' : 's'} count as front`);
    if (backs.size > info.backSeats) for (const r of hard) if (r.type === 'back') flag(r, `${backs.size} students must be in the back but only ${info.backSeats} seat${info.backSeats === 1 ? '' : 's'} count as back`);
    for (const r of hard) if (r.type === 'apart' && parent.has(r.a) && parent.has(r.b) && clusterOf(r.a) === clusterOf(r.b)) flag(r, 'a "must sit next to" chain puts them together');
  }
  return hard.filter((r) => bad.has(r.id)).map((r) => ({ rule: r, why: bad.get(r.id) }));
}

// Largest set of mutually-"apart" students we can find greedily (good enough for classroom sizes)
function greedyClique(adj) {
  let best = [];
  for (const start of adj.keys()) {
    const c = [start];
    for (const cand of adj.keys()) if (cand !== start && c.every((m) => adj.get(m).has(cand))) c.push(cand);
    if (c.length > best.length) best = c;
  }
  return best;
}

// Prepare a run: order by priority, drop rules that don't apply, attach weights.
// demote: Set of rule ids to treat as soft for this run (the "run anyway" path).
function planRules(rules, presentIds, ctx, demote = new Set()) {
  const applicable = rulesForPresent(rules, presentIds).filter((r) => typeInScope(r.type, ctx))
    .map((r) => (demote.has(r.id) ? { ...r, hard: false, demoted: true } : r));
  const ordered = sortByPriority(applicable);
  const soft = ordered.filter((r) => !ruleIsHard(r));
  return ordered.map((r) => ({ ...r, weight: priorityWeight(r, ruleIsHard(r) ? 0 : soft.indexOf(r), soft.length) }));
}

// ---------------------------------------------------------------------------
// Solver: simulated annealing over slot swaps, several random restarts, keep
// the best. Generic — Seating uses seats as slots, Create Groups uses group
// membership slots. evaluate(map: itemId → slot) must return { score, unmet }.
// ---------------------------------------------------------------------------

function annealAssign({ items, slots, evaluate, steps = 4000, restarts = 6, T0 = 20, Tmin = 0.5 }) {
  const n = items.length, m = slots.length;
  const size = Math.max(n, m);
  let best = null;
  for (let restart = 0; restart < restarts; restart++) {
    // arr[slotIndex] = item index, or -1 for an empty slot (indexes >= m are "left out")
    const arr = shuffle([...items.map((_, i) => i), ...Array(Math.max(0, size - n)).fill(-1)]);
    const toMap = (a) => { const map = new Map(); a.forEach((ii, si) => { if (ii >= 0 && si < m) map.set(items[ii].id, slots[si]); }); return map; };
    let cur = evaluate(toMap(arr)).score;
    let T = T0;
    for (let step = 0; step < steps; step++) {
      const i = Math.floor(Math.random() * size), j = Math.floor(Math.random() * size);
      if (i === j) continue;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      const next = evaluate(toMap(arr)).score;
      const d = next - cur;
      if (d <= 0 || Math.random() < Math.exp(-d / T)) cur = next;
      else [arr[i], arr[j]] = [arr[j], arr[i]];
      T = Math.max(Tmin, T * 0.999);
      if (cur === 0) break;
    }
    const map = toMap(arr);
    const ev = evaluate(map);
    if (!best || ev.score < best.score) best = { map, score: ev.score, unmet: ev.unmet };
    if (best.score === 0) break;
  }
  return best;
}

// Human summary of a run: { ok, text } — "all N rules met" or which were missed and why
function summarizeRun(plan, unmet, nameOf, ctx, extra = []) {
  const verb = ctx === 'grouping' ? 'Grouped' : 'Seated';
  const notes = [...extra];
  if (unmet.length) {
    notes.push(`${unmet.length} rule${unmet.length === 1 ? '' : 's'} missed: ` + unmet.map((u) => `${ruleSentence(u.rule, nameOf, ctx)} (${ruleIsHard(u.rule) ? 'must' : u.rule.demoted ? 'run as "try"' : 'try'}${u.why ? ' — ' + u.why : ''})`).join('; '));
  }
  const ok = notes.length === 0;
  return { ok, text: ok ? `${verb} using formula · all ${plan.length} rule${plan.length === 1 ? '' : 's'} met.` : `${verb} using formula · ${notes.join(' · ')}` };
}

// ---------------------------------------------------------------------------
// Grouping with the formula (Create Groups).
//   apart → not the same group, together → same group, close → mild pull
//   to the same group; front/back ignored (seating only).
// Returns { groups, plan, unmet: [{ rule, why }], notes, impossible }
// ---------------------------------------------------------------------------

function groupWithFormula(present, groupCount, rules, nameOf, { demote = new Set() } = {}) {
  const g = Math.max(1, Math.min(groupCount, present.length));
  const base = Math.floor(present.length / g), extra = present.length % g;
  const groupMax = base + (extra ? 1 : 0);
  const slots = [];
  for (let k = 0; k < g; k++) for (let s = 0; s < base + (k < extra ? 1 : 0); s++) slots.push({ group: k });
  const presentIds = new Set(present.map((s) => s.id));
  const plan = planRules(rules, presentIds, 'grouping', demote);

  const evaluate = (groupOf) => {
    let score = 0;
    const unmet = [];
    for (const r of plan) {
      const A = groupOf.get(r.a), B = groupOf.get(r.b);
      if (!A || !B) continue;
      const same = A.group === B.group;
      if (r.type === 'apart' && same) { score += r.weight; unmet.push({ rule: r, why: 'ended up in the same group' }); }
      else if (r.type === 'together' && !same) { score += r.weight; unmet.push({ rule: r, why: 'ended up in different groups' }); }
      else if (r.type === 'close' && !same) score += r.weight * 0.1;   // mild: never listed as "missed"
    }
    return { score, unmet };
  };
  const best = annealAssign({ items: present, slots, evaluate });
  const groups = Array.from({ length: g }, () => []);
  for (const st of present) { const slot = best.map.get(st.id); if (slot) groups[slot.group].push(st); }

  // explain together-chains (hard or soft) longer than a group
  const notes = [];
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const r of plan) if (r.type === 'together') parent.set(find(r.a), find(r.b));
  const clusters = new Map();
  for (const st of present) { if (!parent.has(st.id)) continue; const root = find(st.id); if (!clusters.has(root)) clusters.set(root, []); clusters.get(root).push(st.id); }
  for (const ids of clusters.values()) if (ids.length > groupMax) notes.push(`${ids.map(nameOf).join(', ')} should be grouped together, but that needs a group of ${ids.length} and groups hold ${groupMax === base ? base : `${base}–${groupMax}`} — they were split`);
  return { groups, plan, unmet: best.unmet, notes, groupMax, groupCount: g };
}

// ---------------------------------------------------------------------------
// The Formula modal (shared UI). One instance per page:
//   const formula = createFormulaModal({
//     scope: 'seating' | 'grouping',
//     periodName: () => string, students: () => [{id,name}], absent: () => Set,
//     displayName: (student) => string,
//     getRules: () => rules, setRules: (rules) => void,          // page persists them
//     populateLabel: 'Populate', onPopulate: () => void,
//   });
//   formula.open(); formula.close(); formula.setSummary(text); formula.render();
// ---------------------------------------------------------------------------

function createFormulaModal(opts) {
  const ctx = opts.scope || opts.context || 'seating';      // 'seating' | 'grouping'
  const L = (type) => ruleLabel(type, ctx);
  const types = scopeTypes(ctx);
  const keyOfType = Object.fromEntries(Object.entries(KEY_TYPES).map(([k, t]) => [t, k]));

  const dialog = document.createElement('dialog');
  dialog.id = 'formula-dialog';
  dialog.className = 'formula-dialog';
  dialog.setAttribute('aria-labelledby', 'formula-title');
  dialog.innerHTML = `
    <div class="formula-inner" id="formula-inner" tabindex="-1">
      <header class="formula-header">
        <div>
          <h2 id="formula-title">Formula</h2>
          <p class="formula-sub"><span id="formula-period"></span> · <span id="formula-count">0 rules</span></p>
        </div>
        <div class="formula-tabs" role="tablist">
          <button type="button" class="formula-tab" role="tab" data-tab="rules" aria-selected="true">Rules</button>
          <button type="button" class="formula-tab" role="tab" data-tab="priority" aria-selected="false">Priority</button>
        </div>
        <button type="button" class="corner-btn" id="formula-x" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div id="formula-warnings" class="formula-warnings" hidden></div>
      <div class="formula-body" id="formula-body-rules">
        <div class="formula-roster">
          <input type="search" id="formula-filter" class="search" placeholder="Search students…" autocomplete="off" aria-label="Filter students">
          <div id="formula-list" class="formula-list"></div>
        </div>
        <div class="formula-detail" id="formula-detail"><p class="hint">Pick a student on the left.</p></div>
      </div>
      <div class="formula-priority" id="formula-body-priority" hidden>
        <p class="hint">Drag to reorder. When not everything fits, rules nearer the top win. <strong>Must meet</strong> rules are constraints and always outrank <strong>Try to meet</strong> rules.</p>
        <div id="priority-list" class="priority-list"></div>
      </div>
      <footer class="formula-footer">
        <p class="formula-keys" aria-label="Keyboard shortcuts">
          <kbd>↑</kbd><kbd>↓</kbd> move · type to search · <kbd>1</kbd>–<kbd>${scopeTypes(opts.scope || opts.context || 'seating').length}</kbd> type · <kbd>Enter</kbd> add · <kbd>M</kbd> must/try · <kbd>Ctrl</kbd><kbd>↑</kbd><kbd>↓</kbd> reorder · <kbd>Del</kbd> remove · <kbd>Esc</kbd> clear/close · <kbd>Ctrl</kbd><kbd>Enter</kbd> ${escapeHtml((opts.populateLabel || 'Populate').toLowerCase())}
          <span class="hint" id="formula-summary"></span>
        </p>
        <button type="button" class="primary big" id="formula-populate">${escapeHtml(opts.populateLabel || 'Populate')}</button>
      </footer>
    </div>`;
  document.body.appendChild(dialog);

  const $ = (id) => dialog.querySelector('#' + id);
  const inner = $('formula-inner');
  let tab = 'rules';
  let focus = null;        // student id shown on the right
  let ruleFocus = null;    // highlighted rule id (Delete removes, M toggles, Ctrl+↑↓ moves)
  let addType = 'apart';   // chosen chip

  const byId = (id) => opts.students().find((s) => s.id === id);
  const nameOf = (id) => { const s = byId(id); return s ? opts.displayName(s) : '?'; };
  const rules = () => opts.getRules();
  const setRules = (r) => { opts.setRules(r); render(); };

  function filtered() {
    const q = ($('formula-filter').value || '').trim().toLocaleLowerCase();
    return opts.students().slice().sort((a, b) => a.name.localeCompare(b.name)).filter((s) => !q || s.name.toLocaleLowerCase().includes(q));
  }
  function keepFocus() {
    if (!dialog.open) return;
    const a = document.activeElement;
    if (!a || a === document.body || !dialog.contains(a)) inner.focus({ preventScroll: true });
  }
  const priorityBadge = (r) => `<button type="button" class="prio-toggle${ruleIsHard(r) ? ' hard' : ''}" data-toggle="${r.id}" title="Click or press M to switch">${ruleIsHard(r) ? 'Must meet' : 'Try to meet'}</button>`;

  function ruleCard(r, { withHandle = false } = {}) {
    return `<div class="fd-rule type-${r.type}${ruleFocus === r.id ? ' active' : ''}${ruleIsHard(r) ? ' is-hard' : ''}" data-rule="${r.id}" tabindex="0"${withHandle ? ' draggable="true"' : ''}>
      ${withHandle ? '<span class="drag-handle" aria-hidden="true">⋮⋮</span>' : ''}
      <span class="fd-rule-type">${escapeHtml(L(r.type))}</span>
      <span class="fd-rule-text">${escapeHtml(ruleIsPair(r.type) ? `${nameOf(r.a)} ↔ ${nameOf(r.b)}` : nameOf(r.a))}</span>
      ${priorityBadge(r)}
      <button type="button" class="fd-remove" data-rule="${r.id}" aria-label="Remove rule" title="Remove (Del)">×</button>
    </div>`;
  }

  function render() {
    const all = rules(), absent = opts.absent();
    $('formula-count').textContent = `${all.length} rule${all.length === 1 ? '' : 's'}`;
    const warn = ruleContradictions(all, nameOf, ctx);
    $('formula-warnings').hidden = warn.length === 0;
    $('formula-warnings').innerHTML = warn.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join('');
    dialog.querySelectorAll('.formula-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('formula-body-rules').hidden = tab !== 'rules';
    $('formula-body-priority').hidden = tab !== 'priority';

    if (tab === 'priority') {
      const ordered = sortByPriority(all);
      const hardN = ordered.filter(ruleIsHard).length;
      $('priority-list').innerHTML = ordered.length
        ? ordered.map((r, i) => (i === hardN && hardN > 0 ? '<div class="prio-divider"><span>Try to meet — highest first</span></div>' : '') + (i === 0 && hardN > 0 ? '<div class="prio-divider"><span>Must meet — constraints</span></div>' : '') + (i === 0 && hardN === 0 ? '<div class="prio-divider"><span>Try to meet — highest first</span></div>' : '') + ruleCard(r, { withHandle: true })).join('')
        : '<p class="hint">No rules yet — add some on the Rules tab.</p>';
      keepFocus();
      return;
    }

    const visible = filtered();
    if (focus && !visible.some((s) => s.id === focus)) focus = visible[0] ? visible[0].id : null;
    $('formula-list').innerHTML = visible.map((s) => {
      const k = rulesForStudent(all, s.id).length;
      return `<button type="button" class="formula-student${focus === s.id ? ' active' : ''}${absent.has(s.id) ? ' absent' : ''}" data-student="${s.id}">
        <span class="fs-name">${escapeHtml(opts.displayName(s))}</span>${k ? `<span class="pct fs-badge">${k}</span>` : ''}
      </button>`;
    }).join('') || '<p class="hint">No matching students.</p>';
    const active = $('formula-list').querySelector('.formula-student.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });

    const st = focus ? byId(focus) : null;
    const detail = $('formula-detail');
    if (!st) { detail.innerHTML = '<p class="hint">Pick a student on the left.</p>'; keepFocus(); return; }
    const others = opts.students().filter((o) => o.id !== st.id).sort((a, b) => a.name.localeCompare(b.name));
    const mine = sortByPriority(rulesForStudent(all, st.id));
    detail.innerHTML = `
      <h3 class="fd-name">${escapeHtml(st.name)}${absent.has(st.id) ? ' <span class="fd-absent">absent today · rules ignored</span>' : ''}</h3>
      <p class="fd-count hint">${mine.length ? `${mine.length} rule${mine.length === 1 ? '' : 's'}` : 'No rules yet'}</p>
      <div class="fd-rules">${mine.map((r) => ruleCard(r)).join('')}</div>
      <form class="fd-add" id="fd-add">
        <h4 class="fd-add-title">Add rule</h4>
        <div class="rule-types" role="radiogroup" aria-label="Rule type">${types.map((k) => `<button type="button" class="rule-type type-${k}" data-type="${k}" role="radio" aria-checked="${k === addType}">${escapeHtml(L(k))}<kbd>${keyOfType[k]}</kbd></button>`).join('')}</div>
        <div class="fd-add-row">
          <select id="fd-other" aria-label="Other student">${others.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
          <label class="fd-hard"><input type="checkbox" id="fd-hard"${RULE_TYPES[addType].defaultHard ? ' checked' : ''}> Must meet</label>
          <button type="submit" class="primary">Add rule</button>
        </div>
      </form>`;
    const otherSel = $('fd-other');
    const sync = () => {
      otherSel.hidden = !ruleIsPair(addType);
      detail.querySelectorAll('.rule-type').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === addType)));
    };
    detail.querySelectorAll('.rule-type').forEach((b) => b.addEventListener('click', () => { addType = b.dataset.type; $('fd-hard').checked = RULE_TYPES[addType].defaultHard; sync(); inner.focus({ preventScroll: true }); }));
    sync();
    $('fd-add').addEventListener('submit', (e) => {
      e.preventDefault();
      const type = addType, b = ruleIsPair(type) ? otherSel.value : undefined;
      if (ruleIsPair(type) && !b) return;
      if (!typeInScope(type, ctx)) return;
      if (all.some((r) => r.type === type && (ruleIsPair(type) ? ruleSamePair(r, st.id, b) : r.a === st.id))) return;   // already there
      const hard = $('fd-hard').checked;
      const rule = { id: Math.random().toString(36).slice(2, 9), type, a: st.id, ...(b ? { b } : {}), hard };
      // new rules join at the bottom of their band (hard rules above soft)
      const next = hard ? [...all.filter(ruleIsHard), rule, ...all.filter((r) => !ruleIsHard(r))] : [...all, rule];
      setRules(next);
      inner.focus({ preventScroll: true });
    });
    keepFocus();
  }

  // ---- rule actions ----
  function removeRule(id) {
    if (!id) return;
    if (ruleFocus === id) ruleFocus = null;
    setRules(rules().filter((r) => r.id !== id));
  }
  function toggleHard(id) {
    if (!id) return;
    const all = rules().map((r) => (r.id === id ? { ...r, hard: !ruleIsHard(r) } : r));
    setRules(sortByPriority(all));
  }
  function moveRule(id, dir) {
    if (!id) return;
    const ordered = sortByPriority(rules());
    const i = ordered.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    if (ruleIsHard(ordered[i]) !== ruleIsHard(ordered[j])) return;   // can't cross the must/try divider by moving
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    setRules(ordered);
    const el = dialog.querySelector(`.fd-rule[data-rule="${id}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function open() {
    $('formula-period').textContent = opts.periodName() || '';
    $('formula-summary').textContent = '';
    $('formula-filter').value = '';
    ruleFocus = null; tab = 'rules';
    render();
    dialog.showModal();
    inner.focus({ preventScroll: true });
  }
  function close() {
    if (!dialog.open || dialog.classList.contains('closing')) return;
    dialog.classList.add('closing');
    setTimeout(() => { dialog.classList.remove('closing'); dialog.close(); }, 170);
  }

  // ---- clicks ----
  dialog.querySelectorAll('.formula-tab').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); inner.focus({ preventScroll: true }); }));
  $('formula-list').addEventListener('click', (e) => { const b = e.target.closest('.formula-student'); if (b) { focus = b.dataset.student; ruleFocus = null; render(); } });
  const onRuleClick = (e) => {
    const tg = e.target.closest('.prio-toggle');
    if (tg) { toggleHard(tg.dataset.toggle); return; }
    const rm = e.target.closest('.fd-remove');
    if (rm) { removeRule(rm.dataset.rule); return; }
    const row = e.target.closest('.fd-rule');
    if (row) { ruleFocus = ruleFocus === row.dataset.rule ? null : row.dataset.rule; render(); }
  };
  $('formula-detail').addEventListener('click', onRuleClick);
  $('priority-list').addEventListener('click', onRuleClick);
  $('formula-filter').addEventListener('input', render);
  $('formula-x').addEventListener('click', close);
  $('formula-populate').addEventListener('click', () => { close(); opts.onPopulate && opts.onPopulate(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });          // backdrop
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });              // native Esc

  // ---- drag to reorder on the Priority tab (HTML5 DnD; band-locked) ----
  let dragId = null;
  $('priority-list').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.fd-rule'); if (!row) return;
    dragId = row.dataset.rule; row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
  });
  $('priority-list').addEventListener('dragover', (e) => {
    const row = e.target.closest('.fd-rule'); if (!row || !dragId || row.dataset.rule === dragId) return;
    const a = rules().find((r) => r.id === dragId), b = rules().find((r) => r.id === row.dataset.rule);
    if (!a || !b || ruleIsHard(a) !== ruleIsHard(b)) return;                 // stay within the band
    e.preventDefault();
    const mid = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    row.classList.toggle('drop-before', e.clientY < mid); row.classList.toggle('drop-after', e.clientY >= mid);
  });
  $('priority-list').addEventListener('dragleave', (e) => { const row = e.target.closest('.fd-rule'); if (row) row.classList.remove('drop-before', 'drop-after'); });
  $('priority-list').addEventListener('drop', (e) => {
    const row = e.target.closest('.fd-rule'); if (!row || !dragId) return;
    e.preventDefault();
    const before = row.classList.contains('drop-before');
    const ordered = sortByPriority(rules()).filter((r) => r.id !== dragId);
    const moving = rules().find((r) => r.id === dragId);
    let at = ordered.findIndex((r) => r.id === row.dataset.rule) + (before ? 0 : 1);
    ordered.splice(at, 0, moving);
    ruleFocus = dragId; dragId = null;
    setRules(ordered);
  });
  $('priority-list').addEventListener('dragend', () => { dragId = null; dialog.querySelectorAll('.dragging, .drop-before, .drop-after').forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after')); });

  // ---- one document-level keydown listener, live only while the modal is open ----
  document.addEventListener('keydown', (e) => {
    if (!dialog.open || dialog.classList.contains('closing')) return;
    const t = e.target && e.target.nodeType === 1 ? e.target : document.body;
    const inText = !!(t.matches && t.matches('input[type="search"], input[type="text"], textarea'));
    const inSelect = !!(t.matches && t.matches('select'));
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && ctrl) { e.preventDefault(); close(); opts.onPopulate && opts.onPopulate(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      const filter = $('formula-filter');
      if (tab === 'rules' && filter.value) { filter.value = ''; render(); inner.focus({ preventScroll: true }); return; }
      if (inSelect || (t.closest && t.closest('.fd-add'))) { t.blur(); inner.focus({ preventScroll: true }); return; }
      close();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ctrl) {            // move the highlighted rule
      e.preventDefault(); moveRule(ruleFocus, e.key === 'ArrowDown' ? 1 : -1); return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (inSelect) return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      if (tab === 'priority') {                                                // walk the priority list
        const ordered = sortByPriority(rules()); if (!ordered.length) return;
        const i = ordered.findIndex((r) => r.id === ruleFocus);
        ruleFocus = ordered[Math.max(0, Math.min(ordered.length - 1, i < 0 ? 0 : i + dir))].id; render(); return;
      }
      const list = filtered(); if (!list.length) return;
      const i = list.findIndex((s) => s.id === focus);
      focus = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + dir))].id; ruleFocus = null; render();
      return;
    }
    if (e.key === 'Enter') {
      if (inText) { e.preventDefault(); const first = filtered()[0]; if (first) { focus = first.id; render(); } inner.focus({ preventScroll: true }); return; }
      const form = $('fd-add');
      if (form && tab === 'rules') { e.preventDefault(); form.requestSubmit(); }
      return;
    }
    if (inText) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inSelect) { e.preventDefault(); removeRule(ruleFocus); return; }
    if (e.key.toLowerCase() === 'm' && !ctrl && !inSelect) { e.preventDefault(); toggleHard(ruleFocus); return; }
    if (KEY_TYPES[e.key] && !ctrl && tab === 'rules' && $('fd-add')) {
      if (!typeInScope(KEY_TYPES[e.key], ctx)) return;                       // this scope has no such type
      e.preventDefault();
      if (inSelect) t.blur();
      addType = KEY_TYPES[e.key];
      render();
      return;
    }
    if (e.key.length === 1 && /[a-z]/i.test(e.key) && !ctrl && !inSelect && tab === 'rules') {
      e.preventDefault();
      const f = $('formula-filter');
      f.value += e.key; f.focus(); render();
    }
  });

  return {
    open, close, render,
    isOpen: () => dialog.open,
    setSummary: (text) => { $('formula-summary').textContent = text || ''; },
    focusStudent: (id) => { focus = id; },
    showTab: (name) => { tab = name; render(); },
    el: dialog,
  };
}

// ---------------------------------------------------------------------------
// "Some must-meet rules can't all hold" confirm (shared by both pages).
// Returns a Promise<Set<ruleId>> of rules to demote, or null if cancelled.
// ---------------------------------------------------------------------------

function confirmImpossible(problems, nameOf, ctx) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'impossible-dialog';
    dlg.innerHTML = `
      <div class="impossible-inner">
        <h3>These "Must meet" rules can't all hold</h3>
        <ul>${problems.map((p) => `<li><strong>${escapeHtml(ruleSentence(p.rule, nameOf, ctx))}</strong><span>${escapeHtml(p.why)}</span></li>`).join('')}</ul>
        <p class="hint">Run anyway and the solver treats ${problems.length === 1 ? 'this rule' : 'the lowest-priority of these'} as "Try to meet" for this run — the rest still count as must. Or cancel and edit the rules.</p>
        <div class="impossible-actions">
          <button type="button" data-act="cancel">Cancel</button>
          <button type="button" class="primary" data-act="run">Run anyway</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) done(b.dataset.act === 'run' ? new Set(problems.map((p) => p.rule.id)) : null);
      else if (e.target === dlg) done(null);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    dlg.showModal();
  });
}
