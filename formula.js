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
  return { ok, text: ok ? `${verb} by your rules · all ${plan.length} rule${plan.length === 1 ? '' : 's'} kept.` : `${verb} by your rules · ${notes.join(' · ')}` };
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
//     periodId: () => id, periodName: () => string,
//     students: () => [{id,name}], absent: () => Set,
//     displayName: (student) => string,
//     getRules: () => rules, setRules: (rules) => void,          // page persists them
//     populateLabel: 'Populate', onPopulate: () => void,
//   });
//   formula.open(); formula.close(); formula.setSummary(text); formula.render();
//
// Rules tab = a relationship MAP: every student with a rule is a node, every
// pair rule a line between two nodes (styled by type, ● must / ○ try at its
// middle), front/back a badge on the node. Drag a node to move it, drag its
// port (or Shift+drag the node) onto another to add a rule, drag a name from
// the list onto the map to put them on it. Selecting a student (list, node or
// arrow keys) opens their rules in a floating popover beside their node. Node positions are a per-browser
// view setting (localStorage, per scope + period) — never rule data.
// Priority tab = the ordered list (ordering reads better as a list).
// ---------------------------------------------------------------------------

function createFormulaModal(opts) {
  const ctx = opts.scope || opts.context || 'seating';      // 'seating' | 'grouping'
  const L = (type) => ruleLabel(type, ctx);
  const types = scopeTypes(ctx);
  const pairTypes = types.filter(ruleIsPair);
  const soloTypes = types.filter((t) => !ruleIsPair(t));
  const BADGE = { front: 'Front', back: 'Back' };
  const populateLabel = opts.populateLabel || 'Populate';
  const legendLine = (t) => (t === 'apart' ? 'M1 4 L4.5 1.5 L8 6.5 L11.5 1.5 L15 6.5 L18.5 1.5 L22 6.5 L25.5 1.5 L27 4' : 'M1 4 H27');

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
        <aside class="formula-roster">
          <div class="fr-head">
            <input type="search" id="formula-filter" class="search" placeholder="Search students…" autocomplete="off" aria-label="Filter students">
            <span class="fr-count" id="formula-onmap"></span>
          </div>
          <div id="formula-list" class="formula-list"></div>
          <p class="fr-hint">Drag a name onto the map</p>
        </aside>
        <div class="fm-map" id="fm-map">
          <svg class="fm-edges" id="fm-edges"><g id="fm-edge-layer"></g><line class="fm-temp" id="fm-temp" x1="0" y1="0" x2="0" y2="0"/></svg>
          <div class="fm-nodes" id="fm-nodes"></div>
          <div class="fm-empty" id="fm-empty" hidden>
            <strong>No rules yet</strong>
            <span>Drag a name from the list onto the map, then drag from one student's dot to another to connect them.</span>
          </div>
          <div class="fm-tools">
            <span class="fm-tip">Drag a dot to another student to add a rule</span>
            <button type="button" id="fm-tidy" title="Lay the map out again, with as few crossing lines as possible">Tidy up</button>
          </div>
          <div class="fm-legend" aria-hidden="true">
            ${pairTypes.map((t) => `<span class="fm-leg type-${t}"><svg viewBox="0 0 28 8"><path d="${legendLine(t)}"/></svg>${escapeHtml(L(t))}</span>`).join('')}
            ${soloTypes.map((t) => `<span class="fm-badge type-${t} must">${BADGE[t] || escapeHtml(L(t))}</span>`).join('')}
            <span class="fm-leg"><i class="fm-dot must"></i>Must <i class="fm-dot"></i>Try</span>
          </div>
          <div class="fm-pop" id="fm-pop" hidden></div>
          <aside class="fm-panel" id="fm-panel" hidden aria-label="Selected student's rules"></aside>
        </div>
      </div>
      <div class="formula-priority" id="formula-body-priority" hidden>
        <p class="hint">Drag to reorder. When not everything fits, rules nearer the top win. <strong>Must meet</strong> rules are constraints and always outrank <strong>Try to meet</strong> rules.</p>
        <div id="priority-list" class="priority-list"></div>
      </div>
      <footer class="formula-footer">
        <p class="formula-keys" aria-label="Keyboard shortcuts">
          Drag a student's dot onto another to add a rule · <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> move · <kbd>M</kbd> must/try · <kbd>Del</kbd> delete · <kbd>Esc</kbd> back · <kbd>Ctrl</kbd><kbd>Enter</kbd> ${escapeHtml(populateLabel.toLowerCase())}
          <span class="hint" id="formula-summary"></span>
        </p>
        <button type="button" class="primary big" id="formula-populate">${escapeHtml(populateLabel)}</button>
      </footer>
    </div>`;
  document.body.appendChild(dialog);

  const $ = (id) => dialog.querySelector('#' + id);
  const inner = $('formula-inner');
  const map = $('fm-map'), layer = $('fm-edge-layer'), svg = $('fm-edges'), nodesEl = $('fm-nodes'), pop = $('fm-pop');
  let tab = 'rules';
  let focus = null;        // student id picked in the list / on the map
  let ruleFocus = null;    // selected rule id (Delete removes, M toggles, Ctrl+↑↓ moves, 1–5 retypes)
  let pos = new Map();     // student id → { x, y } as fractions of the map
  let staged = new Set();  // put on the map by hand (stay there with no rules)
  let popState = null;     // { kind: 'rule', id } | { kind: 'connect', a, b, x, y }
  let hoverId = null;
  let panelAt = null;      // { sid, x, y }: the rules popover, moved by hand for this student

  const byId = (id) => opts.students().find((s) => s.id === id);
  const nameOf = (id) => { const s = byId(id); return s ? opts.displayName(s) : '?'; };
  const rules = () => opts.getRules();
  const setRules = (r) => { opts.setRules(r); render(); };
  const newId = () => Math.random().toString(36).slice(2, 9);
  const size = () => ({ W: map.clientWidth, H: map.clientHeight });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const softSkin = () => typeof currentTheme === 'function' && currentTheme() === 'pink';   // paper + string
  const f1 = (n) => n.toFixed(1);

  // ---- node positions: a view setting, this browser only ----
  const mapKey = () => `teacherpal.formula.map.${ctx}.${(opts.periodId ? opts.periodId() : opts.periodName()) || ''}`;
  function loadPos() {
    pos = new Map();
    try {
      const o = JSON.parse(localStorage.getItem(mapKey()) || '{}');
      for (const [k, v] of Object.entries(o)) if (Array.isArray(v)) pos.set(k, { x: +v[0], y: +v[1] });
    } catch { /* storage off: lay out fresh */ }
  }
  function savePos() {
    try {
      const o = {};
      for (const [k, v] of pos) o[k] = [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000];
      localStorage.setItem(mapKey(), JSON.stringify(o));
    } catch { /* not fatal */ }
  }

  // Students on the map: everyone in a rule, plus anyone dropped there by hand
  function mapIds() {
    const known = new Set(opts.students().map((s) => s.id)), out = new Set();
    for (const r of rules()) { if (known.has(r.a)) out.add(r.a); if (r.b && known.has(r.b)) out.add(r.b); }
    for (const s of staged) if (known.has(s)) out.add(s);
    return [...out];
  }

  // ---- automatic layout: force-directed, best of several starts by crossings ----
  const NODE_H = 34;
  const nodeW = (sid) => Math.min(210, 34 + nameOf(sid).length * 8.5) + 22 * rules().filter((r) => !ruleIsPair(r.type) && r.a === sid).length;
  function pairLinks(ids) {
    const idx = new Map(ids.map((id, i) => [id, i])), seen = new Set(), out = [];
    for (const r of rules()) {
      if (!ruleIsPair(r.type) || !idx.has(r.a) || !idx.has(r.b) || r.a === r.b) continue;
      const i = idx.get(r.a), j = idx.get(r.b), key = i < j ? `${i},${j}` : `${j},${i}`;
      if (!seen.has(key)) { seen.add(key); out.push([i, j]); }
    }
    return out;
  }
  function crossings(P, links) {
    const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x) > 0;
    let n = 0;
    for (let s = 0; s < links.length; s++) for (let t = s + 1; t < links.length; t++) {
      const [a, b] = links[s], [c, d] = links[t];
      if (a === c || a === d || b === c || b === d) continue;
      if (ccw(P[a], P[b], P[c]) !== ccw(P[a], P[b], P[d]) && ccw(P[c], P[d], P[a]) !== ccw(P[c], P[d], P[b])) n++;
    }
    return n;
  }
  // Lays out `ids`; those in `keep` that already have a spot stay put.
  function autoLayout(ids, keep = new Set()) {
    const { W, H } = size();
    if (!W || !H || !ids.length) return;
    const n = ids.length, links = pairLinks(ids), w = ids.map(nodeW);
    const fixed = ids.map((id) => keep.has(id) && pos.has(id));
    const lim = (p, i) => {
      p.x = clamp(p.x, w[i] / 2 + 18, W - w[i] / 2 - 18);
      p.y = clamp(p.y, NODE_H / 2 + 52, H - NODE_H / 2 - 56);      // clear of the tools (top) and legend (bottom)
    };
    const k = clamp(Math.sqrt((W * H) / n) * 0.7, 120, 250);
    const g = k / Math.max(W, H);
    let best = null, bestScore = Infinity;
    const tries = fixed.some(Boolean) ? 4 : 10;
    for (let t = 0; t < tries; t++) {
      const P = ids.map((id, i) => {
        if (fixed[i]) return { x: pos.get(id).x * W, y: pos.get(id).y * H };
        const a = t === 0 ? (i / n) * Math.PI * 2 : Math.random() * Math.PI * 2;
        const rr = t === 0 ? 0.33 : 0.08 + Math.random() * 0.3;
        return { x: W / 2 + Math.cos(a) * W * rr, y: H / 2 + Math.sin(a) * H * rr };
      });
      const ITER = 300;
      for (let it = 0; it < ITER; it++) {
        const temp = (W / 10) * (1 - it / ITER) + 1;
        const D = P.map(() => ({ x: 0, y: 0 }));
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y;
          const sx = (w[i] + w[j]) / 2 / 95;                          // names are wide: count x in half-widths
          const d = Math.hypot(dx / sx, dy) || 0.01, f = (k * k) / d;
          D[i].x += (dx / d) * f; D[i].y += (dy / d) * f; D[j].x -= (dx / d) * f; D[j].y -= (dy / d) * f;
        }
        for (const [i, j] of links) {
          const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d = Math.hypot(dx, dy) || 0.01, f = (d * d) / k;
          D[i].x -= (dx / d) * f; D[i].y -= (dy / d) * f; D[j].x += (dx / d) * f; D[j].y += (dy / d) * f;
        }
        for (let i = 0; i < n; i++) {
          if (fixed[i]) continue;
          D[i].x += (W / 2 - P[i].x) * g * 4; D[i].y += (H / 2 - P[i].y) * g * 4;   // keep loose pieces off the walls
          const d = Math.hypot(D[i].x, D[i].y) || 1, step = Math.min(d, temp);
          P[i].x += (D[i].x / d) * step; P[i].y += (D[i].y / d) * step;
          lim(P[i], i);
        }
      }
      // push apart anything still overlapping; linked pairs keep a longer gap so their line shows
      const linked = new Set(links.map(([i, j]) => `${i},${j}`));
      let overlaps = 0;
      for (let pass = 0; pass < 80; pass++) {
        overlaps = 0;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const near = linked.has(`${i},${j}`) || linked.has(`${j},${i}`);
          const ox = (w[i] + w[j]) / 2 + (near ? 80 : 14) - Math.abs(P[i].x - P[j].x), oy = NODE_H + (near ? 56 : 14) - Math.abs(P[i].y - P[j].y);
          if (ox <= 0 || oy <= 0) continue;
          overlaps++;
          const share = fixed[i] ? [0, 1] : fixed[j] ? [1, 0] : [0.5, 0.5];
          if (fixed[i] && fixed[j]) continue;
          if (ox / (w[i] + w[j]) < oy / (NODE_H * 2)) {
            const s = P[i].x < P[j].x ? -1 : 1;
            P[i].x += s * ox * share[0]; P[j].x -= s * ox * share[1];
          } else {
            const s = P[i].y < P[j].y ? -1 : 1;
            P[i].y += s * oy * share[0]; P[j].y -= s * oy * share[1];
          }
          lim(P[i], i); lim(P[j], j);
        }
        if (!overlaps) break;
      }
      const len = links.reduce((sum, [i, j]) => sum + Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y), 0);
      const score = crossings(P, links) * 100 + overlaps * 400 + len / W;
      if (score < bestScore) { bestScore = score; best = P; }
    }
    best.forEach((p, i) => { if (!fixed[i]) pos.set(ids[i], { x: p.x / W, y: p.y / H }); });
    savePos();
  }

  // ---- rule actions ----
  function addRule(type, a, b) {               // → the rule id (an identical rule is reused)
    if (!typeInScope(type, ctx) || (ruleIsPair(type) && (!b || a === b))) return null;
    const all = rules();
    const same = all.find((r) => r.type === type && (ruleIsPair(type) ? ruleSamePair(r, a, b) : r.a === a));
    if (same) return same.id;
    const hard = RULE_TYPES[type].defaultHard;
    const rule = { id: newId(), type, a, ...(b ? { b } : {}), hard };
    // new rules join at the bottom of their band (hard rules above soft)
    opts.setRules(hard ? [...all.filter(ruleIsHard), rule, ...all.filter((r) => !ruleIsHard(r))] : [...all, rule]);
    return rule.id;
  }
  function removeRule(id) {
    const r = id && rules().find((q) => q.id === id);
    if (!r) return;
    staged.add(r.a); if (r.b) staged.add(r.b);       // their nodes stay where they are
    if (ruleFocus === id) ruleFocus = null;
    if (popState && popState.kind === 'rule' && popState.id === id) popState = null;
    setRules(rules().filter((q) => q.id !== id));
  }
  function toggleHard(id) {
    if (!id) return;
    setRules(sortByPriority(rules().map((r) => (r.id === id ? { ...r, hard: !ruleIsHard(r) } : r))));
  }
  function changeType(id, type) {
    const all = rules(), r = all.find((q) => q.id === id);
    if (!r || r.type === type || !typeInScope(type, ctx) || ruleIsPair(r.type) !== ruleIsPair(type)) return;
    const dup = all.find((q) => q.id !== id && q.type === type && (ruleIsPair(type) ? ruleSamePair(q, r.a, r.b) : q.a === r.a));
    if (dup) { ruleFocus = dup.id; popState = { kind: 'rule', id: dup.id }; setRules(all.filter((q) => q.id !== id)); return; }
    setRules(all.map((q) => (q.id === id ? { ...q, type } : q)));
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
  function selectRule(id) { ruleFocus = id; popState = id ? { kind: 'rule', id } : null; render(); }
  function toggleSolo(sid, type) {
    const r = rules().find((q) => q.type === type && q.a === sid);
    staged.add(sid);
    if (r) { removeRule(r.id); return; }
    addRule(type, sid);
    render();
  }
  function createFromPop(type) {
    if (!popState || popState.kind !== 'connect') return;
    const id = addRule(type, popState.a, popState.b);
    ruleFocus = id; popState = id ? { kind: 'rule', id } : null;
    render();
  }
  // The clearest spot on the map (fractions), for a student who isn't on it yet
  function emptySpot() {
    const { W, H } = size();
    const taken = mapIds().filter((id) => pos.has(id)).map((id) => pos.get(id));
    let best = { x: 0.5, y: 0.5 }, bd = -1;
    for (let fx = 0.1; fx <= 0.9001; fx += 0.05) for (let fy = 0.18; fy <= 0.82; fy += 0.04) {
      const d = taken.length ? Math.min(...taken.map((p) => Math.hypot(((p.x - fx) * W) / 1.8, (p.y - fy) * H))) : 1;
      if (d > bd) { bd = d; best = { x: fx, y: fy }; }
    }
    return best;
  }
  function flash(sid) {
    const n = nodesEl.querySelector(`.fm-node[data-sid="${sid}"]`);
    if (n) { n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash'); }
  }
  // Select a student: their node is outlined, their lines stay lit, their rules open in the panel
  function selectStudent(sid) {
    if (!mapIds().includes(sid)) { staged.add(sid); pos.set(sid, emptySpot()); savePos(); }
    if (focus !== sid) panelAt = null;
    focus = sid; ruleFocus = null; popState = null;
    render();
    flash(sid);
  }
  // Arrow keys: the nearest node in that direction
  function stepSelection(dx, dy) {
    const { W, H } = size(), ids = mapIds().filter((id) => pos.has(id));
    if (!ids.length) return;
    const at = (id) => ({ x: pos.get(id).x * W, y: pos.get(id).y * H });
    if (!focus || !ids.includes(focus)) {
      selectStudent(ids.slice().sort((a, b) => (at(a).y + at(a).x * 0.5) - (at(b).y + at(b).x * 0.5))[0]);
      return;
    }
    const o = at(focus);
    let best = null, bs = Infinity;
    for (const id of ids) {
      if (id === focus) continue;
      const p = at(id), rx = p.x - o.x, ry = p.y - o.y;
      const along = rx * dx + ry * dy, across = Math.abs(rx * dy - ry * dx);
      if (along <= 4 || across > along * 2.2) continue;              // within ~65° of the arrow
      const s = along + across * 2;
      if (s < bs) { bs = s; best = id; }
    }
    if (best) selectStudent(best);
  }

  // ---- rendering ----
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
  function ruleCard(r) {
    return `<div class="fd-rule type-${r.type}${ruleFocus === r.id ? ' active' : ''}${ruleIsHard(r) ? ' is-hard' : ''}" data-rule="${r.id}" tabindex="0" draggable="true">
      <span class="drag-handle" aria-hidden="true">⋮⋮</span>
      <span class="fd-rule-type">${escapeHtml(L(r.type))}</span>
      <span class="fd-rule-text">${escapeHtml(ruleIsPair(r.type) ? `${nameOf(r.a)} ↔ ${nameOf(r.b)}` : nameOf(r.a))}</span>
      ${priorityBadge(r)}
      <button type="button" class="fd-remove" data-rule="${r.id}" aria-label="Remove rule" title="Remove (Del)">×</button>
    </div>`;
  }

  function render() {
    const all = rules();
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
        ? ordered.map((r, i) => (i === hardN && hardN > 0 ? '<div class="prio-divider"><span>Try to meet — highest first</span></div>' : '') + (i === 0 && hardN > 0 ? '<div class="prio-divider"><span>Must meet — constraints</span></div>' : '') + (i === 0 && hardN === 0 ? '<div class="prio-divider"><span>Try to meet — highest first</span></div>' : '') + ruleCard(r)).join('')
        : '<p class="hint">No rules yet — add some on the Rules tab.</p>';
      keepFocus();
      return;
    }
    renderList();
    renderMap();
    renderPanel();
    keepFocus();
  }

  // The selected student's rules: change type, must/try, delete; front/back toggles
  function renderPanel() {
    const panel = $('fm-panel');
    const s = tab === 'rules' && focus && mapIds().includes(focus) && rulesForStudent(rules(), focus).length ? byId(focus) : null;
    panel.hidden = !s;
    if (!s) { panel.innerHTML = ''; return; }
    const mine = sortByPriority(rulesForStudent(rules(), s.id)), out = opts.absent().has(s.id);
    const typeSelect = (r) => `<select class="fp-type" data-rule="${r.id}" aria-label="Rule type">${(ruleIsPair(r.type) ? pairTypes : soloTypes).map((t) => `<option value="${t}"${t === r.type ? ' selected' : ''}>${escapeHtml(L(t))}</option>`).join('')}</select>`;
    panel.innerHTML = `
      <div class="fp-head">
        <div class="fp-title">
          <h3 class="fp-name">${escapeHtml(s.name)}</h3>
          <p class="fp-sub">${mine.length ? `${mine.length} rule${mine.length === 1 ? '' : 's'}` : 'No rules yet'}${out ? ' · <span class="fp-out">out today, rules ignored</span>' : ''}</p>
        </div>
        <button type="button" class="corner-btn" data-act="close" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="fp-rules">${mine.map((r) => `
        <div class="fp-rule type-${r.type}${ruleFocus === r.id ? ' sel' : ''}" data-rule="${r.id}">
          <div class="fp-row">${typeSelect(r)}<button type="button" class="fd-remove" data-act="delete" data-rule="${r.id}" aria-label="Delete rule" title="Delete rule">×</button></div>
          <div class="fp-row">${ruleIsPair(r.type) ? `<span class="fp-other">${escapeHtml(nameOf(r.a === s.id ? r.b : r.a))}</span>` : '<span class="fp-other"></span>'}${priorityBadge(r)}</div>
        </div>`).join('')}</div>
      <p class="fp-hint">Drag the dot on ${escapeHtml(opts.displayName(s))} onto another student to add a rule.</p>`;
    placePanel();
  }

  // Beside the selected node: to its right, flipped to its left when there's
  // no room, clamped inside the map. A hand-dragged spot wins while the same
  // student stays selected. The map itself never moves or narrows.
  function placePanel() {
    const panel = $('fm-panel');
    if (panel.hidden) return;
    const { W, H } = size(), pw = panel.offsetWidth, ph = panel.offsetHeight;
    let x, y;
    if (panelAt && panelAt.sid === focus) { x = panelAt.x; y = panelAt.y; }
    else {
      const node = nodesEl.querySelector(`.fm-node[data-sid="${focus}"]`);
      if (!node) return;
      const tools = nodesEl.querySelector('.fm-node-tools');
      const nx = parseFloat(node.style.left), ny = parseFloat(node.style.top);
      const half = Math.max(node.offsetWidth, tools ? tools.offsetWidth : 0) / 2, gap = 16;
      x = nx + half + gap;                                  // right of the node
      if (x + pw > W - 8) x = nx - half - gap - pw;          // no room: flip to the left
      y = ny - node.offsetHeight / 2 - 6;
    }
    panel.style.left = `${f1(clamp(x, 8, Math.max(8, W - pw - 8)))}px`;
    panel.style.top = `${f1(clamp(y, 8, Math.max(8, H - ph - 8)))}px`;
  }

  function renderList() {
    const all = rules(), absent = opts.absent(), onMap = new Set(mapIds());
    $('formula-list').innerHTML = filtered().map((s) => {
      const k = rulesForStudent(all, s.id).length;
      return `<button type="button" class="formula-student${focus === s.id ? ' active' : ''}${absent.has(s.id) ? ' absent' : ''}${onMap.has(s.id) ? ' on-map' : ''}" data-student="${s.id}" title="${escapeHtml(s.name)}${absent.has(s.id) ? ' — out today, rules ignored' : ''}">
        <span class="fs-name">${escapeHtml(opts.displayName(s))}</span>${k ? `<span class="fs-badge">${k}</span>` : ''}
      </button>`;
    }).join('') || '<p class="hint">No matching students.</p>';
    $('formula-onmap').textContent = `${onMap.size} on map`;
    const active = $('formula-list').querySelector('.formula-student.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  const tiltOf = (sid) => { let h = 0; for (const c of sid) h = (h * 31 + c.charCodeAt(0)) | 0; return ((Math.abs(h) % 9) - 4) * 0.5; };

  function renderMap() {
    const { W, H } = size();
    const ids = mapIds();
    if (W && ids.some((id) => !pos.has(id))) autoLayout(ids, new Set(ids.filter((id) => pos.has(id))));
    const all = rules(), absent = opts.absent();
    $('fm-empty').hidden = ids.length > 0;
    nodesEl.innerHTML = ids.map((sid) => {
      const s = byId(sid), p = pos.get(sid) || { x: 0.5, y: 0.5 };
      const solos = all.filter((r) => !ruleIsPair(r.type) && r.a === sid);
      const clash = solos.some((r) => r.type === 'front') && solos.some((r) => r.type === 'back');
      const badges = solos.map((r) => `<button type="button" class="fm-badge type-${r.type}${ruleIsHard(r) ? ' must' : ''}${ruleFocus === r.id ? ' sel' : ''}${clash ? ' conflict' : ''}" data-rule="${r.id}" title="${escapeHtml(L(r.type))} · ${ruleIsHard(r) ? 'must meet' : 'try to meet'}">${BADGE[r.type] || escapeHtml(L(r.type))}</button>`).join('');
      return `<div class="fm-node${focus === sid ? ' focused' : ''}${absent.has(sid) ? ' absent' : ''}" data-sid="${sid}" style="left:${f1(p.x * W)}px;top:${f1(p.y * H)}px;--tilt:${tiltOf(sid)}deg" title="${escapeHtml(s.name)}${absent.has(sid) ? ' — out today, rules ignored' : ''}">
        <span class="fm-pin" aria-hidden="true"></span><span class="fm-name">${escapeHtml(opts.displayName(s))}</span>${badges}<span class="fm-port" title="Drag onto another student to add a rule"></span>
      </div>`;
    }).join('');
    // keep every node wholly on the map (it narrows when the side panel opens)
    if (W) nodesEl.querySelectorAll('.fm-node').forEach((el) => {
      const p = pos.get(el.dataset.sid), hw = el.offsetWidth / 2 + 8, hh = el.offsetHeight / 2 + 6;
      const x = clamp(p.x * W, hw, Math.max(hw, W - hw)), y = clamp(p.y * H, hh, Math.max(hh, H - hh));
      if (Math.abs(x - p.x * W) > 0.5 || Math.abs(y - p.y * H) > 0.5) {
        pos.set(el.dataset.sid, { x: x / W, y: y / H });
        el.style.left = `${f1(x)}px`; el.style.top = `${f1(y)}px`;
      }
    });
    // the selected student's front/back sit right under their node — no separate window
    const fn = focus && nodesEl.querySelector(`.fm-node[data-sid="${focus}"]`);
    if (fn) {
      const mine = rulesForStudent(all, focus);
      const chips = soloTypes.map((t) => `<button type="button" class="fm-chip type-${t}" data-act="solo" data-type="${t}" aria-pressed="${mine.some((r) => r.type === t)}" title="${escapeHtml(L(t))}">${BADGE[t] || escapeHtml(L(t))}</button>`).join('')
        + (!mine.length && staged.has(focus) ? '<button type="button" class="fm-chip" data-act="unstage" title="Take them off the map">Remove</button>' : '');
      if (chips) {
        const tools = document.createElement('div');
        tools.className = 'fm-node-tools';
        tools.innerHTML = chips;
        nodesEl.appendChild(tools);
        const nx = parseFloat(fn.style.left), ny = parseFloat(fn.style.top), half = fn.offsetHeight / 2;
        let ty = ny + half + 8;
        if (ty + tools.offsetHeight > H - 6) ty = ny - half - 8 - tools.offsetHeight;   // no room below: above
        tools.style.left = `${f1(clamp(nx, tools.offsetWidth / 2 + 6, W - tools.offsetWidth / 2 - 6))}px`;
        tools.style.top = `${f1(ty)}px`;
      }
    }
    drawEdges();
    renderPop();
    placePanel();
  }

  // One curve per rule; several rules on one pair fan out side by side.
  // pink hangs them like string (a sag); the graph skins draw them straight.
  function edgeGeom(r, k, n, W, H, soft) {
    const A = pos.get(r.a), B = pos.get(r.b);
    const [P0, P1] = r.a < r.b ? [{ x: A.x * W, y: A.y * H }, { x: B.x * W, y: B.y * H }] : [{ x: B.x * W, y: B.y * H }, { x: A.x * W, y: A.y * H }];
    const dx = P1.x - P0.x, dy = P1.y - P0.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, off = (k - (n - 1) / 2) * 26;
    const sag = soft ? Math.min(44, len * 0.13) : 0;
    const C = { x: (P0.x + P1.x) / 2 + nx * off, y: (P0.y + P1.y) / 2 + ny * off + sag };
    const at = (t) => ({ x: (1 - t) * (1 - t) * P0.x + 2 * (1 - t) * t * C.x + t * t * P1.x, y: (1 - t) * (1 - t) * P0.y + 2 * (1 - t) * t * C.y + t * t * P1.y });
    const d = `M${f1(P0.x)} ${f1(P0.y)} Q${f1(C.x)} ${f1(C.y)} ${f1(P1.x)} ${f1(P1.y)}`;
    let line = d;
    if (r.type === 'apart') {                            // jagged: a zigzag riding the curve
      const steps = Math.max(6, Math.round(len / 10)), amp = soft ? 2.6 : 3.4, pts = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, p = at(t);
        const tx = 2 * (1 - t) * (C.x - P0.x) + 2 * t * (P1.x - C.x), ty = 2 * (1 - t) * (C.y - P0.y) + 2 * t * (P1.y - C.y);
        const tl = Math.hypot(tx, ty) || 1, o = i === 0 || i === steps ? 0 : (i % 2 ? amp : -amp);
        pts.push(`${f1(p.x - (ty / tl) * o)} ${f1(p.y + (tx / tl) * o)}`);
      }
      line = 'M' + pts.join(' L');
    }
    return { d, line, mid: at(0.5) };
  }
  function drawEdges() {
    const { W, H } = size();
    svg.setAttribute('viewBox', `0 0 ${W || 1} ${H || 1}`);
    const soft = softSkin(), groups = new Map();
    for (const r of rules()) {
      if (!ruleIsPair(r.type) || !pos.has(r.a) || !pos.has(r.b)) continue;
      const key = [r.a, r.b].sort().join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    let html = '';
    for (const list of groups.values()) {
      const clash = list.some((r) => r.type === 'apart') && list.some((r) => r.type === 'together');
      list.forEach((r, k) => {
        const g = edgeGeom(r, k, list.length, W, H, soft);
        html += `<g class="fm-edge type-${r.type} ${ruleIsHard(r) ? 'must' : 'try'}${ruleFocus === r.id ? ' sel' : ''}${clash ? ' conflict' : ''}" data-rule="${r.id}" data-a="${r.a}" data-b="${r.b}">
          <title>${escapeHtml(ruleSentence(r, nameOf, ctx))} · ${ruleIsHard(r) ? 'must meet' : 'try to meet'}</title>
          <path class="fm-hit" d="${g.d}"/><path class="fm-line" d="${g.line}"/><circle class="fm-mark" cx="${f1(g.mid.x)}" cy="${f1(g.mid.y)}" r="5"/></g>`;
      });
    }
    layer.innerHTML = html;
    applyHover();
  }
  let edgeRaf = 0;
  const scheduleEdges = () => { if (!edgeRaf) edgeRaf = requestAnimationFrame(() => { edgeRaf = 0; drawEdges(); }); };

  // Hovering a node lights its lines and the students at their other ends
  function applyHover() {
    const id = hoverId || (tab === 'rules' ? focus : null);
    map.classList.toggle('hovering', !!id);
    const linked = new Set(id ? [id] : []);
    layer.querySelectorAll('.fm-edge').forEach((g) => {
      const on = !!id && (g.dataset.a === id || g.dataset.b === id);
      g.classList.toggle('hl', on);
      if (on) { linked.add(g.dataset.a); linked.add(g.dataset.b); }
    });
    nodesEl.querySelectorAll('.fm-node').forEach((n) => n.classList.toggle('hl', linked.has(n.dataset.sid)));
  }

  const typeButtons = (list, act, isOn) => list.map((t) => `<button type="button" class="rule-type type-${t}" role="radio" aria-checked="${isOn(t)}" data-act="${act}" data-type="${t}">${escapeHtml(L(t))}</button>`).join('');
  function renderPop() {
    if (!popState || tab !== 'rules') { pop.hidden = true; return; }
    const { W, H } = size(), all = rules();
    let x, y, html;
    if (popState.kind === 'rule') {
      const r = all.find((q) => q.id === popState.id);
      if (!r || !pos.has(r.a)) { popState = null; pop.hidden = true; return; }
      if (ruleIsPair(r.type)) {
        const m = layer.querySelector(`.fm-edge[data-rule="${r.id}"] .fm-mark`);
        if (!m) { popState = null; pop.hidden = true; return; }
        x = +m.getAttribute('cx'); y = +m.getAttribute('cy');
      } else { x = pos.get(r.a).x * W; y = pos.get(r.a).y * H + NODE_H / 2; }
      html = `<div class="fm-pop-title">${escapeHtml(ruleIsPair(r.type) ? `${nameOf(r.a)} ↔ ${nameOf(r.b)}` : nameOf(r.a))}</div>
        <div class="fm-pop-types" role="radiogroup" aria-label="Rule type">${typeButtons(ruleIsPair(r.type) ? pairTypes : soloTypes, 'type', (t) => t === r.type)}</div>
        <div class="fm-pop-row">${priorityBadge(r)}<span class="spacer"></span><button type="button" class="fm-del danger" data-act="delete" title="Delete this rule (Del)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete rule</button></div>`;
    } else if (popState.kind === 'connect') {
      x = popState.x; y = popState.y;
      html = `<div class="fm-pop-title">${escapeHtml(nameOf(popState.a))} ↔ ${escapeHtml(nameOf(popState.b))}</div>
        <div class="fm-pop-types" role="radiogroup" aria-label="Rule type">${typeButtons(pairTypes, 'create', () => false)}</div>
        <p class="fm-pop-hint">Pick a rule · Esc cancels</p>`;
    } else {
      popState = null; pop.hidden = true; return;
    }
    pop.innerHTML = html;
    pop.hidden = false;
    // centred under the anchor, kept inside the map; flips above near the bottom
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top = y + 12;
    if (top + ph > H - 8) top = Math.max(8, y - ph - 12 - (popState.kind === 'connect' ? 0 : NODE_H));
    pop.style.left = `${f1(clamp(x - pw / 2, 8, Math.max(8, W - pw - 8)))}px`;
    pop.style.top = `${f1(top)}px`;
  }

  function open() {
    $('formula-period').textContent = opts.periodName() || '';
    $('formula-summary').textContent = '';
    $('formula-filter').value = '';
    ruleFocus = null; popState = null; hoverId = null; tab = 'rules';
    staged = new Set();
    loadPos();
    dialog.showModal();
    render();
    inner.focus({ preventScroll: true });
  }
  function close() {
    if (!dialog.open || dialog.classList.contains('closing')) return;
    dialog.classList.add('closing');
    setTimeout(() => { dialog.classList.remove('closing'); dialog.close(); }, 170);
  }

  // ---- clicks ----
  dialog.querySelectorAll('.formula-tab').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; popState = null; render(); inner.focus({ preventScroll: true }); }));
  $('priority-list').addEventListener('click', (e) => {
    const tg = e.target.closest('.prio-toggle');
    if (tg) { toggleHard(tg.dataset.toggle); return; }
    const rm = e.target.closest('.fd-remove');
    if (rm) { removeRule(rm.dataset.rule); return; }
    const row = e.target.closest('.fd-rule');
    if (row) { ruleFocus = ruleFocus === row.dataset.rule ? null : row.dataset.rule; render(); }
  });
  $('formula-filter').addEventListener('input', render);
  $('formula-x').addEventListener('click', close);
  $('fm-tidy').addEventListener('click', () => { autoLayout(mapIds()); renderMap(); inner.focus({ preventScroll: true }); });
  $('formula-populate').addEventListener('click', () => { close(); opts.onPopulate && opts.onPopulate(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });          // backdrop
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });              // native Esc

  pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  pop.addEventListener('click', (e) => {
    const tg = e.target.closest('.prio-toggle');
    if (tg) { toggleHard(tg.dataset.toggle); inner.focus({ preventScroll: true }); return; }
    const b = e.target.closest('[data-act]');
    if (!b || !popState) return;
    const act = b.dataset.act;
    if (act === 'type') changeType(popState.id, b.dataset.type);
    else if (act === 'delete') removeRule(popState.id);
    else if (act === 'create') createFromPop(b.dataset.type);
    inner.focus({ preventScroll: true });
  });

  nodesEl.addEventListener('click', (e) => {
    const b = e.target.closest('.fm-node-tools [data-act]');
    if (!b || !focus) return;
    if (b.dataset.act === 'solo') toggleSolo(focus, b.dataset.type);
    else if (b.dataset.act === 'unstage') { staged.delete(focus); focus = null; render(); }
    inner.focus({ preventScroll: true });
  });

  // ---- the side panel ----
  const panel = $('fm-panel');
  panel.addEventListener('pointerdown', (e) => {
    e.stopPropagation();                                   // not a canvas click, never a pan
    const head = e.target.closest('.fp-head');
    if (!head || e.button !== 0 || e.target.closest('button, select')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = parseFloat(panel.style.left) || 0, oy = parseFloat(panel.style.top) || 0;
    head.setPointerCapture(e.pointerId);
    panel.classList.add('dragging');
    const move = (ev) => { panelAt = { sid: focus, x: ox + ev.clientX - sx, y: oy + ev.clientY - sy }; placePanel(); };
    const up = () => { panel.classList.remove('dragging'); head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  panel.addEventListener('click', (e) => {
    const tg = e.target.closest('.prio-toggle');
    if (tg) { ruleFocus = tg.dataset.toggle; toggleHard(tg.dataset.toggle); inner.focus({ preventScroll: true }); return; }
    const b = e.target.closest('[data-act]');
    if (b) {
      const act = b.dataset.act;
      if (act === 'close') { focus = null; ruleFocus = null; popState = null; panelAt = null; render(); }
      else if (act === 'delete') removeRule(b.dataset.rule);
      else if (act === 'solo') toggleSolo(focus, b.dataset.type);
      else if (act === 'unstage') { staged.delete(focus); focus = null; render(); }
      inner.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('select')) return;
    const card = e.target.closest('.fp-rule');
    if (card) { ruleFocus = ruleFocus === card.dataset.rule ? null : card.dataset.rule; popState = null; render(); }
  });
  panel.addEventListener('change', (e) => {
    const sel = e.target.closest('.fp-type');
    if (!sel) return;
    ruleFocus = sel.dataset.rule;
    changeType(sel.dataset.rule, sel.value);
    inner.focus({ preventScroll: true });
  });

  // ---- the map: move nodes, draw connections, pick lines / badges ----
  let drag = null;   // { kind: 'move' | 'connect', sid, node, sx, sy, moved }
  const nodeAt = (cx, cy, not) => {
    const el = document.elementFromPoint(cx, cy);
    const n = el && el.closest && el.closest('.fm-node');
    return n && n.dataset.sid !== not && map.contains(n) ? n : null;
  };
  map.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || tab !== 'rules') return;
    if (e.target.closest('.fm-node-tools')) return;
    const badge = e.target.closest('.fm-badge');
    if (badge && !badge.closest('.fm-legend')) { e.preventDefault(); selectRule(badge.dataset.rule); inner.focus({ preventScroll: true }); return; }
    const edge = e.target.closest('.fm-edge');
    if (edge) { e.preventDefault(); selectRule(edge.dataset.rule); inner.focus({ preventScroll: true }); return; }
    const node = e.target.closest('.fm-node');
    if (!node) {
      if (e.target.closest('.fm-tools')) return;
      if (popState || ruleFocus || focus) { popState = null; ruleFocus = null; focus = null; panelAt = null; render(); }   // close everything
      inner.focus({ preventScroll: true });
      return;
    }
    e.preventDefault();
    drag = { kind: e.target.closest('.fm-port') || e.shiftKey ? 'connect' : 'move', sid: node.dataset.sid, node, sx: e.clientX, sy: e.clientY, moved: false };
    map.setPointerCapture(e.pointerId);
    inner.focus({ preventScroll: true });
  });
  map.addEventListener('pointermove', (e) => {
    if (!drag) {
      const n = e.target.closest && e.target.closest('.fm-node');
      const id = n ? n.dataset.sid : null;
      if (id !== hoverId) { hoverId = id; applyHover(); }
      return;
    }
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      popState = null; pop.hidden = true;
      hoverId = drag.kind === 'connect' ? drag.sid : null; applyHover();
      map.classList.add(drag.kind === 'move' ? 'moving' : 'connecting');
      if (drag.kind === 'move') drag.node.classList.add('lifting');
      const tools = nodesEl.querySelector('.fm-node-tools');
      if (tools) tools.remove();
    }
    const r = map.getBoundingClientRect(), { W, H } = size();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (drag.kind === 'move') {
      const hw = drag.node.offsetWidth / 2 + 10, hh = drag.node.offsetHeight / 2 + 6;   // keep the whole node on the map
      const p = { x: clamp(x, hw, W - hw) / W, y: clamp(y, hh, H - hh) / H };
      pos.set(drag.sid, p);
      drag.node.style.left = `${f1(p.x * W)}px`;
      drag.node.style.top = `${f1(p.y * H)}px`;
      scheduleEdges();
    } else {
      const p = pos.get(drag.sid), t = $('fm-temp');
      t.setAttribute('x1', f1(p.x * W)); t.setAttribute('y1', f1(p.y * H));
      t.setAttribute('x2', f1(x)); t.setAttribute('y2', f1(y));
      t.classList.add('on');
      const over = nodeAt(e.clientX, e.clientY, drag.sid);
      nodesEl.querySelectorAll('.fm-node').forEach((n) => n.classList.toggle('drop-target', n === over));
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    map.classList.remove('moving', 'connecting');
    $('fm-temp').classList.remove('on');
    nodesEl.querySelectorAll('.drop-target, .lifting').forEach((n) => n.classList.remove('drop-target', 'lifting'));
    if (!d.moved) {                                     // a click on a node
      selectStudent(d.sid);
      return;
    }
    if (d.kind === 'move') { savePos(); renderMap(); return; }
    hoverId = null; applyHover();
    const over = e.type === 'pointerup' && nodeAt(e.clientX, e.clientY, d.sid);
    if (over) {
      const r = map.getBoundingClientRect();
      popState = { kind: 'connect', a: d.sid, b: over.dataset.sid, x: e.clientX - r.left, y: e.clientY - r.top };
      ruleFocus = null;
      render();
    }
  };
  map.addEventListener('pointerup', endDrag);
  map.addEventListener('pointercancel', endDrag);
  map.addEventListener('pointerleave', () => { if (!drag && hoverId) { hoverId = null; applyHover(); } });

  // ---- the list: click to pick, drag a name onto the map ----
  let listDrag = null;   // { sid, sx, sy, ghost }
  const list = $('formula-list');
  const overMap = (cx, cy) => { const r = map.getBoundingClientRect(); return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom; };
  list.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.formula-student');
    if (!row || e.button !== 0) return;
    listDrag = { sid: row.dataset.student, sx: e.clientX, sy: e.clientY, ghost: null };
    row.setPointerCapture(e.pointerId);
  });
  list.addEventListener('pointermove', (e) => {
    if (!listDrag) return;
    if (!listDrag.ghost) {
      if (Math.hypot(e.clientX - listDrag.sx, e.clientY - listDrag.sy) < 5) return;
      listDrag.ghost = document.createElement('div');
      listDrag.ghost.className = 'fm-ghost';
      listDrag.ghost.textContent = nameOf(listDrag.sid);
      dialog.appendChild(listDrag.ghost);
      popState = null; pop.hidden = true;
    }
    listDrag.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
    map.classList.toggle('drop-hover', overMap(e.clientX, e.clientY));
  });
  const endListDrag = (e) => {
    if (!listDrag) return;
    const d = listDrag;
    listDrag = null;
    map.classList.remove('drop-hover');
    if (d.ghost) d.ghost.remove();
    if (!d.ghost) {                                     // a click: pick the student
      if (e.type !== 'pointerup') return;
      selectStudent(d.sid);
      inner.focus({ preventScroll: true });
      return;
    }
    if (e.type !== 'pointerup' || !overMap(e.clientX, e.clientY)) return;
    const r = map.getBoundingClientRect(), { W, H } = size();
    const over = nodeAt(e.clientX, e.clientY, d.sid);
    staged.add(d.sid);
    focus = d.sid;
    if (over) {                                         // dropped on someone: sit beside them and ask which rule
      if (!mapIds().includes(d.sid) || !pos.has(d.sid)) {
        const tp = pos.get(over.dataset.sid);
        pos.set(d.sid, { x: clamp(tp.x + 150 / W, 0.05, 0.95), y: clamp(tp.y + 70 / H, 0.08, 0.9) });
      }
      popState = { kind: 'connect', a: d.sid, b: over.dataset.sid, x: e.clientX - r.left, y: e.clientY - r.top };
    } else {
      pos.set(d.sid, { x: clamp((e.clientX - r.left) / W, 0.05, 0.95), y: clamp((e.clientY - r.top) / H, 0.08, 0.9) });
      popState = null;
    }
    savePos();
    render();
    inner.focus({ preventScroll: true });
  };
  list.addEventListener('pointerup', endListDrag);
  list.addEventListener('pointercancel', endListDrag);
  list.addEventListener('click', (e) => {                // keyboard activation of a row (no pointer)
    const row = e.target.closest('.formula-student');
    if (row && e.detail === 0) selectStudent(row.dataset.student);
  });

  new ResizeObserver(() => { if (dialog.open && tab === 'rules') renderMap(); }).observe(map);

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
    const at = ordered.findIndex((r) => r.id === row.dataset.rule) + (before ? 0 : 1);
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
      if (popState) { popState = null; render(); inner.focus({ preventScroll: true }); return; }
      const filter = $('formula-filter');
      if (tab === 'rules' && filter.value) { filter.value = ''; render(); inner.focus({ preventScroll: true }); return; }
      if (ruleFocus) { ruleFocus = null; render(); return; }
      if (focus && tab === 'rules') { focus = null; panelAt = null; render(); return; }
      close();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ctrl) {            // move the selected rule
      e.preventDefault(); moveRule(ruleFocus, e.key === 'ArrowDown' ? 1 : -1); return;
    }
    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (ARROWS[e.key] && !ctrl) {
      if (inText || inSelect) return;                                          // caret / option keys
      e.preventDefault();
      if (tab === 'priority') {                                                // walk the priority list
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const ordered = sortByPriority(rules()); if (!ordered.length) return;
        const i = ordered.findIndex((r) => r.id === ruleFocus);
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        ruleFocus = ordered[Math.max(0, Math.min(ordered.length - 1, i < 0 ? 0 : i + dir))].id; render(); return;
      }
      stepSelection(...ARROWS[e.key]);
      return;
    }
    if (e.key === 'Enter') {                                                   // in the search box: pick the first match
      if (tab === 'rules' && inText) { e.preventDefault(); const first = filtered()[0]; if (first) selectStudent(first.id); inner.focus({ preventScroll: true }); }
      return;
    }
    if (inText) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeRule(ruleFocus); return; }
    if (e.key.toLowerCase() === 'm' && !ctrl && ruleFocus) { e.preventDefault(); toggleHard(ruleFocus); return; }
    if (e.key.length === 1 && /[a-z]/i.test(e.key) && !ctrl && !e.altKey && tab === 'rules') {
      e.preventDefault();
      const fl = $('formula-filter');
      fl.value += e.key; fl.focus(); render();
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
