// The Leaderboard (leaderboard.html, and leaderboard-popout.html for the
// projector): a standalone scorekeeper for whatever is happening in the room.
// Nothing here reads Family Feud or Jeopardy; scores are typed in.
//
//   Home         the saved scoreboards as cards, the picked one's top three,
//                Keep score, Projector window, Edit.
//   Keep score   a row per team or student: rank, name, score, −1 +1 +5 +10,
//                a box for any other amount (Enter), and Edit. Undo (Ctrl+Z)
//                steps back through every change. Every change saves itself.
//   Standings    full screen here, or the projector window: just the
//                standings, as big as fit.
//
// A scoreboard (scoreboards row, migration-scoreboards.sql):
//   { id, name, kind: 'teams'|'students', sortMode: 'score'|'order', periodId,
//     entries: [{ id, name, score, members: [{ id, name }], sid? }] }
// The main tab is the only writer. It broadcasts the open scoreboard on
// BroadcastChannel('teacherpal-scoreboard'); the projector window asks for it
// when it opens and says "here" every 2s.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const POPOUT = document.body.classList.contains('lb-popout');
  const CHANNEL = 'teacherpal-scoreboard';
  const MAX_ENTRIES = 200;
  const SCORE_MAX = 999999999;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  const fmt = (n) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString();
  const rid = () => Math.random().toString(36).slice(2, 9);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clampScore = (n) => Math.max(-SCORE_MAX, Math.min(SCORE_MAX, Math.round(n)));

  // ranks: by score, ties share a rank (1 1 3); the top three ranks are marked
  // unless everyone is level (a fresh board, all 0)
  function rankInfo(entries) {
    const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.score - a.e.score || a.i - b.i).map((x) => x.e);
    const rank = new Map();
    let r = 0, prev = null;
    sorted.forEach((e, k) => { if (prev === null || e.score !== prev) { r = k + 1; prev = e.score; } rank.set(e.id, r); });
    const level = entries.length < 2 || entries.every((e) => e.score === entries[0].score);
    const medal = (id) => {
      if (level) return '';
      const k = rank.get(id);
      return k === 1 ? 'gold' : k === 2 ? 'silver' : k === 3 ? 'bronze' : '';
    };
    return { sorted, rank, medal };
  }
  const setMedal = (node, m) => { if (m) node.dataset.medal = m; else delete node.dataset.medal; };

  // move a list's children to their new places smoothly (FLIP)
  function flip(list, mutate) {
    const before = new Map([...list.children].map((n) => [n.dataset.id, n.getBoundingClientRect()]));
    mutate();
    if (reduced() || !before.size) return;
    for (const n of list.children) {
      const b = before.get(n.dataset.id);
      if (!b) continue;
      const a = n.getBoundingClientRect();
      const dx = b.left - a.left, dy = b.top - a.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
  function bump(node) {
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
  }

  // ---------- the standings alone (full screen and the projector window) ----------
  const show = { title: $('lb-show-title'), list: $('lb-show-list'), empty: $('lb-show-empty') };
  function paintShow(board, noBoard) {
    const list = show.list;
    if (!board) {
      show.title.textContent = '';
      list.replaceChildren();
      show.empty.hidden = false;
      show.empty.textContent = noBoard;
      return;
    }
    show.title.textContent = board.name;
    const entries = board.entries;
    show.empty.hidden = entries.length > 0;
    show.empty.textContent = 'Nobody on this scoreboard yet.';
    const info = rankInfo(entries);
    const order = board.sortMode === 'order' ? entries : info.sorted;
    const n = order.length;
    const cols = n <= 7 ? 1 : n <= 16 ? 2 : n <= 30 ? 3 : 4;
    list.style.setProperty('--cols', cols);
    list.style.setProperty('--rows', Math.max(1, Math.ceil(n / cols)));
    list.dataset.cols = cols;
    const old = new Map([...list.children].map((li) => [li.dataset.id, li]));
    flip(list, () => {
      const rows = order.map((e) => {
        let li = old.get(e.id);
        if (!li) {
          li = el('li', 'lb-srow');
          li.dataset.id = e.id;
          li.append(el('span', 'lb-srank'), el('span', 'lb-sname'), el('b', 'lb-sscore'));
        }
        const [rk, nm, sc] = li.children;
        rk.textContent = String(info.rank.get(e.id));
        nm.textContent = e.name;
        nm.title = e.name;
        sc.textContent = fmt(e.score);
        if (li.dataset.score != null && +li.dataset.score !== e.score) bump(sc);
        li.dataset.score = String(e.score);
        setMedal(li, info.medal(e.id));
        return li;
      });
      list.replaceChildren(...rows);
    });
  }

  // ---------- the projector window: read-only, fed by the main tab ----------
  if (POPOUT) {
    const bc = new BroadcastChannel(CHANNEL);
    let heard = false;
    bc.onmessage = (m) => {
      const d = m.data || {};
      if (d.type !== 'state') return;
      heard = true;
      paintShow(d.board, 'Pick a scoreboard on the Leaderboard tab.');
      document.title = d.board ? `${d.board.name} — Leaderboard` : 'Leaderboard — projector';
    };
    bc.postMessage({ type: 'request-state' });
    const here = () => bc.postMessage({ type: 'here' });
    here();
    setInterval(here, 2000);
    addEventListener('pagehide', () => bc.postMessage({ type: 'bye' }));
    setTimeout(() => { if (!heard) paintShow(null, 'Open the Leaderboard tab to show a scoreboard here.'); }, 2000);
    const toggleFs = () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    };
    addEventListener('keydown', (e) => { if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFs(); });
    addEventListener('dblclick', toggleFs);
    return;
  }

  // ---------- the main tab ----------
  const BOARD_KEY = 'teacherpal.leaderboard.board';
  const page = document.querySelector('.leaderboard-page');
  let ready = true;           // false = migration-scoreboards.sql not run
  let loaded = false;
  let boards = [];            // newest first (as loaded)
  let cur = null;             // the open scoreboard (one of boards)
  let periods = null;         // for the setup dialog, loaded on first use

  function normEntries(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.filter((e) => e && typeof e === 'object').slice(0, MAX_ENTRIES).map((e) => {
      let id = String(e.id || rid());
      while (seen.has(id)) id = rid();
      seen.add(id);
      const out = {
        id,
        name: String(e.name || '').trim().slice(0, 60) || 'Unnamed',
        score: Number.isFinite(+e.score) ? clampScore(+e.score) : 0,
        members: Array.isArray(e.members) ? e.members.filter((m) => m && m.name).map((m) => ({ id: m.id || null, name: String(m.name).slice(0, 80) })) : [],
      };
      if (e.sid) out.sid = String(e.sid);
      if (e.pid) out.pid = String(e.pid);
      return out;
    });
  }
  // the quick-add buttons on each row: 1–6 whole numbers, not 0, no repeats
  const DEFAULT_BUTTONS = [1, 5, 10, -1];
  const BUTTON_MAX = 100000;
  function normButtons(list) {
    const out = [];
    for (const v of Array.isArray(list) ? list : []) {
      const n = Math.round(+v);
      if (!Number.isFinite(n) || !n || Math.abs(n) > BUTTON_MAX || out.includes(n)) continue;
      out.push(n);
      if (out.length === 6) break;
    }
    return out.length ? out : DEFAULT_BUTTONS.slice();
  }
  const btnText = (n) => (n > 0 ? '+' : '−') + Math.abs(n).toLocaleString();
  const fromRow = (r) => ({
    id: r.id,
    name: r.name || 'Scoreboard',
    kind: r.kind === 'students' ? 'students' : 'teams',
    sortMode: r.sort_mode === 'order' ? 'order' : 'score',
    periodId: r.period_id || null,
    buttons: normButtons(r.buttons),
    startScore: Number.isFinite(+r.start_score) ? clampScore(+r.start_score) : 0,
    updatedAt: r.updated_at || r.created_at || new Date().toISOString(),
    entries: normEntries(r.entries),
  });
  // "4 teams", "28 students", "5 classes" (Period vs period)
  function countText(b) {
    const n = b.entries.length;
    if (b.kind === 'students') return plural(n, 'student');
    if (n && b.entries.every((e) => e.pid)) return `${n.toLocaleString()} ${n === 1 ? 'class' : 'classes'}`;
    return plural(n, 'team');
  }
  function whenText(iso) {
    const d = new Date(iso);
    if (Number.isNaN(+d)) return '';
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const diff = Math.round((day(new Date()) - day(d)) / 864e5);
    if (diff <= 0) return 'today';
    if (diff === 1) return 'yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  // a team's members by first name, with a last initial where two share one
  function memberLine(members) {
    const first = (n) => n.trim().split(/\s+/)[0];
    const count = new Map();
    for (const m of members) count.set(first(m.name), (count.get(first(m.name)) || 0) + 1);
    return members.map((m) => {
      const f = first(m.name);
      if (count.get(f) < 2) return f;
      const parts = m.name.trim().split(/\s+/);
      return parts.length > 1 ? `${f} ${parts[parts.length - 1][0]}.` : f;
    }).join(', ');
  }

  // ---------- saving: every change, by itself ----------
  const pending = new Set();
  let saving = false, failed = false, saveTimer = 0, retryTimer = 0;
  function markDirty(b) {
    pending.add(b.id);
    b.updatedAt = new Date().toISOString();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaves, 250);
    paintSave();
  }
  async function flushSaves() {
    if (saving) return;
    const id = pending.values().next().value;
    if (!id) { paintSave(); return; }
    pending.delete(id);
    const b = boards.find((x) => x.id === id);
    if (!b) { flushSaves(); return; }
    saving = true;
    paintSave();
    try {
      await updateScoreboard(id, { name: b.name, entries: b.entries, sortMode: b.sortMode, periodId: b.periodId, buttons: b.buttons, startScore: b.startScore });
      failed = false;
    } catch (e) {
      console.error(e);
      pending.add(id);
      failed = true;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flushSaves, 4000);
    } finally {
      saving = false;
    }
    if (!failed && pending.size) flushSaves();
    else paintSave();
  }
  function paintSave() {
    const s = $('lb-save');
    const state = failed ? 'error' : (pending.size || saving) ? 'saving' : 'saved';
    s.dataset.state = state;
    s.textContent = !cur ? '' : state === 'error' ? 'Not saved, retrying' : state === 'saving' ? 'Saving…' : 'Saved';
  }
  addEventListener('beforeunload', (e) => { if (pending.size || saving) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- undo: every change is one step ----------
  let undo = [];
  function act(label, fn, opts = {}) {
    if (!cur) return;
    undo.push({ boardId: cur.id, label, name: cur.name, sortMode: cur.sortMode, periodId: cur.periodId, buttons: cur.buttons.slice(), startScore: cur.startScore, entries: JSON.stringify(cur.entries) });
    if (undo.length > 100) undo.shift();
    fn();
    markDirty(cur);
    paintAll(opts);
  }
  function doUndo() {
    const u = undo.pop();
    if (!u || !cur || u.boardId !== cur.id) { undo = []; paintHead(); return; }
    cur.name = u.name;
    cur.sortMode = u.sortMode;
    cur.periodId = u.periodId;
    cur.buttons = u.buttons;
    cur.startScore = u.startScore;
    cur.entries = JSON.parse(u.entries);
    holdUntil = 0;
    markDirty(cur);
    paintAll();
  }

  // ---------- scoring ----------
  function addPoints(id, d) {
    const e = cur && cur.entries.find((x) => x.id === id);
    if (!e || !d) return;
    act(`${d > 0 ? '+' : '−'}${Math.abs(d)} ${e.name}`, () => { e.score = clampScore(e.score + d); }, { scored: id, delta: d });
  }
  function parseAmount(s) {
    const t = String(s).replace(/[−–—]/g, '-').replace(/\s+/g, '');
    if (!/^[+-]?\d{1,9}$/.test(t)) return null;
    return parseInt(t, 10);
  }

  // ---------- painting ----------
  function paintAll(opts = {}) {
    paintHome();
    paintHead();
    paintScore(opts);
    if (document.body.classList.contains('present')) paintShow(cur, 'Pick a scoreboard on the Leaderboard home.');
    send();
  }

  function paintHome() {
    const wrap = $('lb-boards');
    const cards = boards.map((b) => {
      const c = el('button', 'lb-bcard');
      c.type = 'button';
      c.dataset.board = b.id;
      c.setAttribute('aria-pressed', String(cur === b));
      const nm = el('b', 'lb-bcard-name', b.name);
      c.title = b.name;
      c.append(nm, el('span', 'lb-bcard-meta', `${countText(b)} · ${whenText(b.updatedAt)}`));
      return c;
    });
    wrap.replaceChildren(...cards);
    // no scoreboards yet: the title, one line and the presets
    const empty = ready && loaded && !boards.length;
    $('lb-home').classList.toggle('is-empty', empty);
    $('lb-tagline').hidden = !empty;
    $('lb-preview').hidden = empty;
    $('lb-home-actions').hidden = empty;
    wrap.hidden = !ready || empty;
    $('lb-new-sec').hidden = !ready || !loaded;
    for (const b of $('lb-presets').querySelectorAll('button')) b.disabled = !ready || !loaded;

    const level = !cur || !cur.entries.length || cur.entries.every((e) => e.score === cur.entries[0].score);
    const none = !ready || !cur || !cur.entries.length || (level && cur.entries.length > 1) || (level && cur.entries[0].score === 0);
    $('lb-trio').hidden = none;
    $('lb-none').hidden = !none;
    if (none) {
      const [t, sub] = !loaded ? ['', '']
        : !ready ? ['Not set up yet', 'Run migration-scoreboards.sql in Supabase.']
        : !cur ? ['', '']
        : !cur.entries.length ? ['Nobody on it yet', 'Edit it to add teams or students.']
        : ['No points yet', cur.entries.slice(0, 6).map((e) => e.name).join(', ') + (cur.entries.length > 6 ? ` and ${cur.entries.length - 6} more` : '')];
      $('lb-none-t').textContent = t;
      $('lb-none-s').textContent = sub;
    }
    const info = cur ? rankInfo(cur.entries) : null;
    const top = info ? info.sorted.slice(0, 3) : [];
    // 2nd, 1st, 3rd: the leader in the middle
    $('lb-trio').replaceChildren(...(none ? [] : [1, 0, 2]).map((i) => {
      const r = top[i];
      const li = el('li', 'lb-pod');
      li.dataset.place = String(i + 1);
      if (!r) { li.classList.add('open'); li.append(el('span', 'lb-pod-rank', String(i + 1)), el('span', 'lb-pod-name', '—')); return li; }
      setMedal(li, info.medal(r.id) || 'bronze');
      const name = el('span', 'lb-pod-name', r.name);
      name.title = r.name;
      const pts = el('b', 'lb-pod-pts', fmt(r.score));
      li.append(el('span', 'lb-pod-rank', String(info.rank.get(r.id))), name, pts);
      return li;
    }));
    $('lb-meta').textContent = cur ? `${countText(cur)} · updated ${whenText(cur.updatedAt)}` : '';
    const go = $('lb-go');
    go.disabled = !ready || !loaded || !cur;
    $('lb-edit-home').closest('.lb-more').hidden = !cur;
  }

  function paintHead() {
    if (!cur) return;
    $('lb-board-name').textContent = cur.name;
    $('lb-board-name').title = cur.name;
    $('lb-sort-score').setAttribute('aria-pressed', String(cur.sortMode === 'score'));
    $('lb-sort-order').setAttribute('aria-pressed', String(cur.sortMode === 'order'));
    const u = undo[undo.length - 1];
    const ub = $('lb-undo');
    ub.disabled = !u || u.boardId !== cur.id;
    ub.title = ub.disabled ? 'Undo (Ctrl+Z)' : `Undo ${u.label} (Ctrl+Z)`;
    $('lb-reset').disabled = cur.entries.every((e) => e.score === cur.startScore);
    paintSave();
  }

  // On the laptop, sorting by score waits until the clicking stops, so a row
  // never jumps out from under the next click; the projector moves at once.
  let holdUntil = 0, holdTimer = 0;
  const rowMap = new Map();
  function displayOrder(info) {
    if (cur.sortMode === 'order') return cur.entries;
    const list = $('lb-entries');
    if (Date.now() < holdUntil && list.children.length) {
      const by = new Map(cur.entries.map((e) => [e.id, e]));
      const kept = [...list.children].map((n) => by.get(n.dataset.id)).filter(Boolean);
      const shown = new Set(kept.map((e) => e.id));
      return [...kept, ...cur.entries.filter((e) => !shown.has(e.id))];
    }
    return info.sorted;
  }
  function makeRow(id) {
    const li = el('li', 'lb-entry');
    li.dataset.id = id;
    const who = el('div', 'lb-who');
    who.append(el('span', 'lb-name'), el('span', 'lb-members'));
    const score = el('div', 'lb-score-cell');
    score.append(el('b', 'lb-num'));
    const pts = el('div', 'lb-pts');
    for (const d of cur.buttons.slice().sort((a, b) => a - b)) {
      const b = el('button', `lb-btn ${d < 0 ? 'lb-btn-outline' : 'lb-btn-secondary'} lb-pt`, btnText(d));
      b.type = 'button';
      b.dataset.d = String(d);
      pts.append(b);
    }
    const custom = el('input', 'lb-custom');
    custom.type = 'text';
    custom.inputMode = 'numeric';
    custom.autocomplete = 'off';
    custom.placeholder = '±';
    custom.maxLength = 10;
    custom.title = 'Any amount, then Enter (a minus takes points away)';
    pts.append(custom);
    const edit = el('button', 'lb-btn lb-btn-ghost lb-btn-icon lb-edit-entry');
    edit.type = 'button';
    edit.dataset.edit = '1';
    edit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>';
    li.append(el('span', 'lb-rank'), who, score, pts, edit);
    return li;
  }
  function paintScore(opts = {}) {
    const list = $('lb-entries');
    const emptyEl = $('lb-empty');
    if (!cur) { list.replaceChildren(); rowMap.clear(); emptyEl.hidden = true; return; }
    if (opts.scored && cur.sortMode === 'score') {
      holdUntil = Date.now() + 1300;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { holdUntil = 0; if (cur) paintScore(); }, 1350);
    }
    // the buttons changed (Edit): build the rows again
    const key = cur.buttons.join(',');
    if (list.dataset.btns !== key) { list.dataset.btns = key; list.replaceChildren(); rowMap.clear(); }
    const info = rankInfo(cur.entries);
    const order = displayOrder(info);
    const n = cur.entries.length;
    list.dataset.size = n <= 6 ? 'big' : 'many';
    emptyEl.hidden = n > 0;
    emptyEl.textContent = 'Nobody on this scoreboard yet. Edit it to add teams or students.';
    const ids = new Set(order.map((e) => e.id));
    for (const [id, li] of rowMap) if (!ids.has(id)) { li.remove(); rowMap.delete(id); }
    for (const e of order) {
      let li = rowMap.get(e.id);
      if (!li) { li = makeRow(e.id); rowMap.set(e.id, li); }
      li.querySelector('.lb-rank').textContent = String(info.rank.get(e.id));
      const nm = li.querySelector('.lb-name');
      nm.textContent = e.name;
      nm.title = e.name;
      const mem = li.querySelector('.lb-members');
      mem.textContent = cur.kind === 'teams' ? memberLine(e.members) : '';
      mem.hidden = !mem.textContent;
      const sc = li.querySelector('.lb-num');
      sc.textContent = fmt(e.score);
      sc.classList.toggle('neg', e.score < 0);
      setMedal(li, info.medal(e.id));
      for (const b of li.querySelectorAll('.lb-pt')) b.setAttribute('aria-label', `${b.textContent} for ${e.name}`);
      li.querySelector('.lb-custom').setAttribute('aria-label', `Points for ${e.name}`);
      li.querySelector('.lb-edit-entry').setAttribute('aria-label', `Edit ${e.name}`);
      li.querySelector('.lb-edit-entry').title = `Rename, set the score or remove ${e.name}`;
      if (opts.scored === e.id) {
        bump(sc);
        if (!reduced()) {
          const pop = el('span', `lb-delta${opts.delta < 0 ? ' neg' : ''}`, `${opts.delta > 0 ? '+' : '−'}${Math.abs(opts.delta)}`);
          li.querySelector('.lb-score-cell').append(pop);
          setTimeout(() => pop.remove(), 900);
        }
      }
    }
    // put rows in order, moving only the ones out of place, and keep focus
    const focused = document.activeElement;
    flip(list, () => {
      order.forEach((e, k) => {
        const li = rowMap.get(e.id);
        if (list.children[k] !== li) list.insertBefore(li, list.children[k] || null);
      });
    });
    if (focused && focused !== document.activeElement && list.contains(focused)) focused.focus({ preventScroll: true });
  }

  // ---------- views ----------
  function showView(v) {
    if (v === 'score' && !cur) v = 'home';
    page.dataset.view = v;
    if (v === 'score') { holdUntil = 0; paintScore(); }
  }
  function selectBoard(b) {
    if (cur === b) return;
    cur = b;
    undo = [];
    holdUntil = 0;
    rowMap.clear();
    $('lb-entries').replaceChildren();
    delete $('lb-entries').dataset.btns;
    try { if (b) localStorage.setItem(BOARD_KEY, b.id); } catch { /* ignore */ }
    paintAll();
  }

  // ---------- the projector window ----------
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
  let projAt = 0;
  const projOn = () => Date.now() - projAt < 7000;
  function send() {
    if (!bc) return;
    bc.postMessage({ type: 'state', board: cur ? { name: cur.name, sortMode: cur.sortMode, entries: cur.entries.map(({ id, name, score }) => ({ id, name, score })) } : null });
  }
  function paintProj() {
    for (const b of document.querySelectorAll('[data-projector]')) {
      b.classList.toggle('on', projOn());
      b.title = projOn() ? 'The projector window is open (click to bring it up)' : 'Opens a window you can make full screen on your projector';
    }
  }
  if (bc) {
    bc.onmessage = (m) => {
      const t = m.data && m.data.type;
      if (t === 'request-state') send();
      else if (t === 'here') { const was = projOn(); projAt = Date.now(); if (!was) paintProj(); }
      else if (t === 'bye') { projAt = 0; paintProj(); }
    };
    setInterval(paintProj, 2000);
  }
  function openProjector() {
    const w = window.open('leaderboard-popout.html', 'teacherpal-scoreboard', 'popup=yes,width=1100,height=700');
    if (!w) { setStatus('The browser blocked the window. Allow pop-ups for this site and try again.', 'error'); return; }
    w.focus();
  }

  // ---------- the entry dialog: rename, set the score, remove ----------
  const entryDlg = $('lb-entry');
  let entryId = null;
  function openEntry(id) {
    const e = cur && cur.entries.find((x) => x.id === id);
    if (!e) return;
    entryId = id;
    $('lb-entry-title').textContent = `Edit ${e.name}`;
    $('lb-e-name').value = e.name;
    $('lb-e-score').value = String(e.score);
    $('lb-e-err').textContent = '';
    entryDlg.showModal();
    $('lb-e-name').select();
  }
  $('lb-entry-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const e = cur && cur.entries.find((x) => x.id === entryId);
    if (!e) { entryDlg.close(); return; }
    const name = $('lb-e-name').value.trim().slice(0, 60);
    const score = parseAmount($('lb-e-score').value);
    if (!name) { $('lb-e-err').textContent = 'Give it a name.'; $('lb-e-name').focus(); return; }
    if (score == null) { $('lb-e-err').textContent = 'The score has to be a whole number, like 12 or -3.'; $('lb-e-score').focus(); return; }
    if (name !== e.name || score !== e.score) act(`edit ${e.name}`, () => { e.name = name; e.score = clampScore(score); });
    entryDlg.close();
  });
  $('lb-e-cancel').addEventListener('click', () => entryDlg.close());
  $('lb-e-remove').addEventListener('click', () => {
    const e = cur && cur.entries.find((x) => x.id === entryId);
    if (!e) return;
    if (!confirm(`Remove ${e.name} from this scoreboard? Their score goes with them.`)) return;
    act(`removing ${e.name}`, () => { cur.entries = cur.entries.filter((x) => x !== e); });
    entryDlg.close();
  });

  // ---------- setting up a scoreboard: from a preset, or editing the open one ----------
  const setupDlg = $('lb-setup');
  // { editing, preset, kind, periodId, entries, buttons, startScore, sortMode }
  let draft = null;
  const team = (name) => ({ id: rid(), name, score: 0, members: [] });
  const freshTeams = () => [team('Team 1'), team('Team 2')];
  const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const PRESETS = [
    { id: 'two', name: 'Two teams', line: 'Team 1 and Team 2, ready to go', kind: 'teams',
      icon: ICON('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20a5 5 0 0 1 10 0M11 20a5 5 0 0 1 10 0"/>'),
      start: freshTeams },
    { id: 'four', name: 'Four teams', line: 'Red, Blue, Green and Gold', kind: 'teams',
      icon: ICON('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
      start: () => ['Red', 'Blue', 'Green', 'Gold'].map(team) },
    { id: 'class', name: 'Whole class', line: 'Every student in a period, one by one', kind: 'students', period: true,
      icon: ICON('<circle cx="12" cy="7" r="3"/><circle cx="5" cy="9" r="2"/><circle cx="19" cy="9" r="2"/><path d="M6.5 20a5.5 5.5 0 0 1 11 0M2 18a3.5 3.5 0 0 1 5-3.2M22 18a3.5 3.5 0 0 0-5-3.2"/>'),
      start: () => [] },
    { id: 'tables', name: 'Table groups', line: 'A group per desk cluster in your seating chart', kind: 'teams', period: true,
      icon: ICON('<rect x="3" y="4" width="8" height="6" rx="1"/><rect x="13" y="4" width="8" height="6" rx="1"/><rect x="3" y="14" width="8" height="6" rx="1"/><rect x="13" y="14" width="8" height="6" rx="1"/>'),
      start: () => [] },
    { id: 'periods', name: 'Period vs period', line: 'One entry per class you teach', kind: 'teams',
      icon: ICON('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>'),
      start: () => [] },
    { id: 'teacher', name: 'Teacher vs class', line: 'Two entries: you and the class', kind: 'teams',
      icon: ICON('<circle cx="7" cy="7" r="3"/><path d="M2 20a5 5 0 0 1 10 0"/><path d="M14 12h7M17.5 8.5 21 12l-3.5 3.5"/>'),
      start: () => [team(displayName() || 'Teacher'), team('The class')] },
    { id: 'blank', name: 'Blank', line: 'Name everything yourself', kind: 'teams',
      icon: ICON('<path d="M12 5v14M5 12h14"/>'),
      start: freshTeams },
  ];
  const presetOf = (id) => PRESETS.find((p) => p.id === id) || null;
  $('lb-presets').replaceChildren(...PRESETS.map((p) => {
    const b = el('button', 'lb-preset');
    b.type = 'button';
    b.dataset.preset = p.id;
    b.innerHTML = `<span class="lb-preset-icon">${p.icon}</span>`;
    b.append(el('b', 'lb-preset-name', p.name), el('span', 'lb-preset-line', p.line));
    return b;
  }));

  // the button sets a teacher picks from, or their own
  const BUTTON_SETS = [[1, 5, 10, -1], [10, 25, 50, -10], [100, 200, 500, -100]];
  const sameSet = (a, b) => a.length === b.length && a.slice().sort((x, y) => x - y).every((v, i) => v === b.slice().sort((x, y) => x - y)[i]);
  function parseButtons(text) {
    const parts = String(text).split(/[\s,;]+/).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const n = parseAmount(p);
      if (n == null || !n || Math.abs(n) > BUTTON_MAX) return null;
      if (!out.includes(n)) out.push(n);
    }
    return out.length && out.length <= 6 ? out : null;
  }

  async function ensurePeriods() {
    if (periods) return periods;
    try { periods = await getPeriods(); } catch (e) { periods = []; console.error(e); }
    return periods;
  }
  // the periods this teacher teaches (the gear menu's Periods I teach)
  function taughtPeriods() {
    const teaches = currentTeachesPeriods();
    return (periods || []).filter((p) => {
      if (!teaches || typeof parsePeriodName !== 'function') return true;
      const { n } = parsePeriodName(p.name);
      return n === null || teaches.includes(n);
    });
  }
  const periodName = (pid) => { const p = (periods || []).find((x) => x.id === pid); return p ? p.name : ''; };

  async function openSetup(editing, presetId) {
    if (!ready) return;
    if (editing && !cur) return;
    const P = editing ? null : (presetOf(presetId) || presetOf('blank'));
    draft = editing
      ? { editing: true, preset: null, kind: cur.kind, periodId: cur.periodId, entries: JSON.parse(JSON.stringify(cur.entries)),
          buttons: cur.buttons.slice(), startScore: cur.startScore, sortMode: cur.sortMode }
      : { editing: false, preset: P.id, kind: P.kind, periodId: null, entries: P.start(),
          buttons: DEFAULT_BUTTONS.slice(), startScore: 0, sortMode: 'score' };
    draft.ownButtons = !BUTTON_SETS.some((set) => sameSet(set, draft.buttons));
    setupDlg.dataset.preset = editing ? 'edit' : P.id;
    $('lb-setup-title').textContent = editing ? 'Edit scoreboard' : P.name;
    $('lb-setup-line').textContent = editing ? '' : P.line;
    $('lb-s-name').value = editing ? cur.name : '';
    $('lb-s-name').placeholder = editing ? '' : defaultName(P, null);
    $('lb-s-save').textContent = editing ? 'Save' : 'Start';
    $('lb-s-delete').hidden = !editing;
    $('lb-s-kind-row').hidden = editing || P.id !== 'blank';
    $('lb-s-names').value = '';
    $('lb-s-start').value = String(draft.startScore);
    $('lb-s-btns').value = draft.buttons.join(', ');
    $('lb-s-note').textContent = '';
    $('lb-s-err').textContent = '';
    const sel = $('lb-s-period');
    sel.replaceChildren(el('option', null, 'Loading classes…'));
    paintSetup();
    setupDlg.showModal();
    (P && P.period ? sel : $('lb-s-name')).focus();
    const ps = await ensurePeriods();
    if (!setupDlg.open) return;
    if (ps.length) fillPeriodSelect(sel, ps, draft.periodId || undefined);
    else sel.replaceChildren(el('option', null, 'No classes yet'));
    if (!editing) {
      if (P.period && sel.value) await fillFromPeriod(sel.value);
      else if (P.id === 'periods') fillPeriods();
    }
    paintSetup();
  }
  function defaultName(P, pid) {
    const day = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (!P || P.id === 'blank') return `Scoreboard, ${day}`;
    if (P.period && pid && periodName(pid)) return `${P.name} · ${periodName(pid)}`.slice(0, 80);
    return `${P.name}, ${day}`;
  }

  // Period vs period: one entry per taught period
  function fillPeriods() {
    const list = taughtPeriods();
    draft.entries = list.map((p) => ({ ...team(p.name.slice(0, 60)), pid: p.id }));
    $('lb-s-note').textContent = list.length ? '' : 'No classes yet. Add them on the Rosters page.';
  }
  // Whole class / Table groups: what the chosen period has
  let fillSeq = 0;
  async function fillFromPeriod(pid) {
    const seq = ++fillSeq;
    const d = draft;
    const note = $('lb-s-note');
    note.textContent = 'Loading…';
    try {
      if (d.preset === 'class') {
        const students = await getStudents(pid);
        if (seq !== fillSeq || d !== draft) return;
        d.entries = students.slice(0, MAX_ENTRIES).map((s) => ({ ...team(s.name.slice(0, 60)), sid: s.id }));
        note.textContent = students.length ? '' : 'This class has no students yet.';
      } else {
        const [students, seating] = await Promise.all([getStudents(pid), getActiveSeating(pid)]);
        if (seq !== fillSeq || d !== draft) return;
        const { groups, unseated, anySeated } = tableGroups(seating && seating.layout, (seating && seating.assignments) || {}, students);
        d.entries = groups.slice(0, MAX_ENTRIES).map((g, k) => ({ ...team(`Group ${k + 1}`), members: g }));
        note.textContent = !groups.length ? 'This period has no seating chart yet. Build one on the Seating page.'
          : !anySeated ? 'Nobody is seated in this chart yet, so the groups are empty.'
          : unseated ? `${plural(unseated, 'student')} without a seat ${unseated === 1 ? 'isn’t' : 'aren’t'} in a group.` : '';
      }
      d.periodId = pid;
      $('lb-s-name').placeholder = defaultName(presetOf(d.preset), pid);
    } catch (e) {
      if (seq === fillSeq) note.textContent = 'Couldn’t load this class. Check the connection and try again.';
      console.error(e);
    }
    if (seq === fillSeq && d === draft) paintSetup();
  }
  // Desks that touch (or nearly) are one cluster. Each cluster with someone
  // seated at it is a group of those students; clusters in reading order.
  function tableGroups(layout, assignments, students) {
    const byId = new Map(students.map((s) => [s.id, s]));
    const pieces = layout && Array.isArray(layout.pieces)
      ? layout.pieces.filter((p) => typeof TYPES !== 'undefined' && TYPES[p.type] && TYPES[p.type].seats.length)
      : [];
    const boxes = pieces.map((p) => bbox(p));
    const up = pieces.map((_, i) => i);
    const find = (i) => (up[i] === i ? i : (up[i] = find(up[i])));
    const GAP = 0.6;
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x <= b.x + b.w + GAP && b.x <= a.x + a.w + GAP && a.y <= b.y + b.h + GAP && b.y <= a.y + a.h + GAP) up[find(i)] = find(j);
      }
    }
    const clusters = new Map();
    const seated = new Set();
    pieces.forEach((p, i) => {
      const root = find(i);
      if (!clusters.has(root)) clusters.set(root, { xs: [], ys: [], members: [] });
      const c = clusters.get(root);
      c.xs.push(boxes[i].cx);
      c.ys.push(boxes[i].cy);
      TYPES[p.type].seats.forEach((_, k) => {
        const s = byId.get(assignments[`${p.id}:${k}`]);
        if (s && !seated.has(s.id)) { seated.add(s.id); c.members.push({ id: s.id, name: s.name }); }
      });
    });
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    let list = [...clusters.values()].map((c) => ({ x: avg(c.xs), y: avg(c.ys), members: c.members }));
    const anySeated = seated.size > 0;
    if (anySeated) list = list.filter((c) => c.members.length);
    // rows of clusters front to back, left to right in each row
    list.sort((a, b) => a.y - b.y);
    const rows = [];
    for (const c of list) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(c.y - row[0].y) < 3) row.push(c); else rows.push([c]);
    }
    const groups = rows.flatMap((row) => row.sort((a, b) => a.x - b.x)).map((c) => c.members);
    return { groups, anySeated, unseated: anySeated ? students.filter((s) => !seated.has(s.id)).length : 0 };
  }

  function paintSetup() {
    const p = draft.preset;
    const teams = draft.kind === 'teams';
    setupDlg.dataset.kind = draft.kind;
    for (const b of setupDlg.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b.dataset.kind === draft.kind));
    const periodsBoard = draft.entries.length > 0 && draft.entries.every((e) => e.pid);
    const showClass = draft.editing ? !periodsBoard : !['periods', 'teacher'].includes(p);
    const canSplit = teams && p !== 'tables' && showClass;
    const canAddClass = !teams && p !== 'class' && showClass;
    $('lb-s-classgrp').hidden = !showClass;
    $('lb-s-split').hidden = !canSplit;
    $('lb-s-clear').hidden = !canSplit;
    $('lb-s-addclass').hidden = !canAddClass;
    $('lb-s-addteam').hidden = p === 'periods' || p === 'tables';
    const hasPeriod = !!$('lb-s-period').value && !!(periods && periods.length);
    $('lb-s-split').disabled = !hasPeriod || !draft.entries.length;
    $('lb-s-addclass').disabled = !hasPeriod;
    $('lb-s-clear').disabled = !draft.entries.some((e) => e.members.length);
    // scoring
    const own = draft.ownButtons;
    for (const b of setupDlg.querySelectorAll('[data-bset]')) {
      const k = b.dataset.bset;
      b.setAttribute('aria-pressed', String(k === 'own' ? own : !own && sameSet(BUTTON_SETS[+k], draft.buttons)));
    }
    $('lb-s-btns').hidden = !own;
    for (const b of setupDlg.querySelectorAll('[data-sort]')) b.setAttribute('aria-pressed', String(b.dataset.sort === draft.sortMode));
    if (teams) {
      $('lb-s-teams').replaceChildren(...draft.entries.map((t, k) => {
        const li = el('li', 'lb-s-team');
        li.dataset.k = String(k);
        const row = el('div', 'lb-s-row');
        const input = el('input');
        input.type = 'text';
        input.value = t.name;
        input.maxLength = 60;
        input.dataset.name = String(k);
        input.setAttribute('aria-label', `Entry ${k + 1} name`);
        const count = el('span', 'lb-s-count', t.members.length ? plural(t.members.length, 'student') : '');
        const x = el('button', 'lb-btn lb-btn-ghost lb-btn-icon lb-btn-sm', '×');
        x.type = 'button';
        x.dataset.drop = String(k);
        x.disabled = draft.entries.length < 2;
        x.setAttribute('aria-label', `Remove ${t.name}`);
        x.title = draft.editing && t.score !== draft.startScore ? `Remove ${t.name} (score ${fmt(t.score)})` : `Remove ${t.name}`;
        row.append(input, count, x);
        li.append(row);
        if (t.members.length) {
          const chips = el('ul', 'lb-chips');
          t.members.forEach((m, j) => {
            const c = el('li');
            const b = el('button', 'lb-chip', m.name);
            b.type = 'button';
            b.dataset.move = `${k}:${j}`;
            b.title = draft.entries.length > 1 ? `Move to ${draft.entries[(k + 1) % draft.entries.length].name}` : '';
            c.append(b);
            chips.append(c);
          });
          li.append(chips);
        }
        return li;
      }));
      $('lb-s-addteam').disabled = draft.entries.length >= MAX_ENTRIES;
    } else {
      $('lb-s-list').replaceChildren(...draft.entries.map((s, k) => {
        const li = el('li', 'lb-s-row');
        const input = el('input');
        input.type = 'text';
        input.value = s.name;
        input.maxLength = 60;
        input.dataset.name = String(k);
        input.setAttribute('aria-label', `Student ${k + 1}`);
        const x = el('button', 'lb-btn lb-btn-ghost lb-btn-icon lb-btn-sm', '×');
        x.type = 'button';
        x.dataset.drop = String(k);
        x.setAttribute('aria-label', `Remove ${s.name}`);
        li.append(input, x);
        return li;
      }));
    }
    $('lb-s-count-all').textContent = draft.entries.length ? `${countText(draft)} ` : '';
  }
  // typing only updates the draft (no repaint, so the caret stays)
  setupDlg.addEventListener('input', (e) => {
    if (!draft) return;
    const k = e.target.dataset && e.target.dataset.name;
    if (k != null && draft.entries[+k]) draft.entries[+k].name = e.target.value;
    if (e.target.id === 'lb-s-btns') { const b = parseButtons(e.target.value); if (b) draft.buttons = b; e.target.classList.remove('bad'); }
    if (e.target.id === 'lb-s-start') { const n = parseAmount(e.target.value); if (n != null) draft.startScore = clampScore(n); e.target.classList.remove('bad'); }
  });
  setupDlg.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !draft) return;
    if (t.dataset.kind && !draft.editing && t.dataset.kind !== draft.kind) {
      draft.kind = t.dataset.kind;
      draft.entries = draft.kind === 'teams' ? freshTeams() : [];
      $('lb-s-note').textContent = '';
      paintSetup();
    } else if (t.dataset.bset != null) {
      if (t.dataset.bset === 'own') {
        draft.ownButtons = true;
        paintSetup();
        $('lb-s-btns').value = draft.buttons.join(', ');
        $('lb-s-btns').focus();
        $('lb-s-btns').select();
      } else {
        draft.ownButtons = false;
        draft.buttons = BUTTON_SETS[+t.dataset.bset].slice();
        $('lb-s-btns').value = draft.buttons.join(', ');
        paintSetup();
      }
    } else if (t.dataset.sort) {
      draft.sortMode = t.dataset.sort === 'order' ? 'order' : 'score';
      paintSetup();
    } else if (t.dataset.drop != null) {
      draft.entries.splice(+t.dataset.drop, 1);
      paintSetup();
    } else if (t.dataset.move) {
      const [k, j] = t.dataset.move.split(':').map(Number);
      if (draft.entries.length < 2) return;
      const [m] = draft.entries[k].members.splice(j, 1);
      draft.entries[(k + 1) % draft.entries.length].members.push(m);
      paintSetup();
    }
  });
  $('lb-s-period').addEventListener('change', (e) => {
    if (e.target.value) setLastPeriodId(e.target.value);
    const P = draft && presetOf(draft.preset);
    if (P && P.period && e.target.value) fillFromPeriod(e.target.value);
    else paintSetup();
  });
  $('lb-s-addteam').addEventListener('click', () => {
    draft.entries.push({ ...team(`Team ${draft.entries.length + 1}`), score: draft.startScore });
    paintSetup();
    const inputs = $('lb-s-teams').querySelectorAll('input');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });
  $('lb-s-clear').addEventListener('click', () => {
    draft.entries.forEach((t) => { t.members = []; });
    $('lb-s-note').textContent = '';
    paintSetup();
  });
  // teams: today's students, shuffled and dealt round the teams
  $('lb-s-split').addEventListener('click', async () => {
    const pid = $('lb-s-period').value;
    if (!pid || !draft.entries.length) return;
    const btn = $('lb-s-split');
    btn.disabled = true;
    try {
      const [students, att] = await Promise.all([getStudents(pid), getAttendance(pid, todayKey()).catch(() => null)]);
      const absent = att ? absentIdsOf(att.marks) : readAbsentCache(pid);
      const here = students.filter((s) => !absent.has(s.id));
      if (!here.length) { $('lb-s-note').textContent = students.length ? 'Nobody in this class is marked present today.' : 'This class has no students yet.'; return; }
      const dealt = shuffle(here.slice());
      draft.entries.forEach((t) => { t.members = []; });
      dealt.forEach((s, i) => draft.entries[i % draft.entries.length].members.push({ id: s.id, name: s.name }));
      draft.entries.forEach((t) => t.members.sort((a, b) => a.name.localeCompare(b.name)));
      draft.periodId = pid;
      const out = students.length - here.length;
      $('lb-s-note').textContent = `${plural(here.length, 'student')} split into ${plural(draft.entries.length, 'team')}${out ? `; ${out} absent today left out` : ''}. Click a name to move it.`;
    } catch (e) {
      showError(e);
    } finally {
      paintSetup();
    }
  });
  // students: the whole roster (everyone, absent today or not: a scoreboard can run for days)
  $('lb-s-addclass').addEventListener('click', async () => {
    const pid = $('lb-s-period').value;
    if (!pid) return;
    const btn = $('lb-s-addclass');
    btn.disabled = true;
    try {
      const students = await getStudents(pid);
      const have = new Set(draft.entries.map((e) => e.sid).filter(Boolean));
      const add = students.filter((s) => !have.has(s.id)).slice(0, MAX_ENTRIES - draft.entries.length);
      for (const s of add) draft.entries.push({ ...team(s.name.slice(0, 60)), score: draft.startScore, sid: s.id });
      draft.periodId = pid;
      $('lb-s-note').textContent = !students.length ? 'This class has no students yet.' : add.length ? `Added ${plural(add.length, 'student')}.` : 'Everyone in this class is already on it.';
    } catch (e) {
      showError(e);
    } finally {
      paintSetup();
    }
  });
  function addTyped() {
    const box = $('lb-s-names');
    const have = new Set(draft.entries.map((e) => e.name.trim().toLowerCase()));
    const names = box.value.split(/\n/).map((x) => x.trim().slice(0, 60)).filter(Boolean);
    let added = 0;
    for (const n of names) {
      if (have.has(n.toLowerCase()) || draft.entries.length >= MAX_ENTRIES) continue;
      have.add(n.toLowerCase());
      draft.entries.push({ ...team(n), score: draft.startScore });
      added++;
    }
    box.value = '';
    $('lb-s-note').textContent = names.length && !added ? 'Those names are already on it.' : '';
    paintSetup();
    box.focus();
  }
  $('lb-s-add').addEventListener('click', addTyped);
  // Enter adds; Shift+Enter starts a new line for several names
  $('lb-s-names').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addTyped(); } });
  $('lb-s-cancel').addEventListener('click', () => setupDlg.close());
  $('lb-s-delete').addEventListener('click', async () => {
    if (!cur || !confirm(`Delete “${cur.name}”? Its scores go with it.`)) return;
    const gone = cur;
    try {
      pending.delete(gone.id);
      await deleteScoreboard(gone.id);
    } catch (e) { showError(e); return; }
    boards = boards.filter((b) => b !== gone);
    setupDlg.close();
    cur = null;
    selectBoard(boards[0] || null);
    showView('home');
    setStatus(`Deleted ${gone.name}.`, 'ok');
  });
  const shake = (input) => { input.classList.remove('bad'); void input.offsetWidth; input.classList.add('bad'); input.focus(); };
  $('lb-setup-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!draft) return;
    if (draft.kind === 'students' && $('lb-s-names').value.trim()) addTyped();
    const err = $('lb-s-err');
    const start = parseAmount($('lb-s-start').value.trim() || '0');
    if (start == null) { err.textContent = 'The starting score has to be a whole number, like 0 or 100.'; shake($('lb-s-start')); return; }
    const buttons = draft.ownButtons ? parseButtons($('lb-s-btns').value) : draft.buttons;
    if (!buttons) { err.textContent = 'Buttons: up to 6 whole numbers, not 0, like 1, 5, 10, -1.'; shake($('lb-s-btns')); return; }
    const entries = normEntries(draft.entries
      .map((e, k) => ({ ...e, name: e.name.trim() || (draft.kind === 'teams' ? `Team ${k + 1}` : '') }))
      .filter((e) => e.name));
    if (!entries.length) {
      err.textContent = draft.preset === 'tables' ? 'No groups to keep score for. Pick a period with a seating chart.'
        : draft.preset === 'periods' ? 'No classes to keep score for yet.'
        : draft.kind === 'teams' ? 'Add at least one team.' : 'Add at least one student.';
      return;
    }
    err.textContent = '';
    const startScore = clampScore(start);
    const name = $('lb-s-name').value.trim().slice(0, 80) || defaultName(presetOf(draft.preset), draft.periodId);
    if (draft.editing) {
      act('editing the scoreboard', () => {
        cur.name = name;
        cur.entries = entries;
        cur.periodId = draft.periodId;
        cur.buttons = normButtons(buttons);
        cur.startScore = startScore;
        cur.sortMode = draft.sortMode;
      });
      setupDlg.close();
      return;
    }
    entries.forEach((e) => { e.score = startScore; });
    const btn = $('lb-s-save');
    btn.disabled = true;
    try {
      const row = await createScoreboard({ name, kind: draft.kind, entries, sortMode: draft.sortMode, periodId: draft.periodId, buttons: normButtons(buttons), startScore });
      // before the second migration the row comes back without them
      const b = fromRow({ buttons: normButtons(buttons), start_score: startScore, ...row });
      if (!scoreboardExtrasSaved()) { b.buttons = normButtons(buttons); b.startScore = startScore; }
      boards.unshift(b);
      setupDlg.close();
      selectBoard(b);
      showView('score');
    } catch (e) {
      err.textContent = isMissingTableError(e) ? 'The Leaderboard needs migration-scoreboards.sql: run it in the Supabase SQL editor.' : 'Couldn’t save. Check the connection and try again.';
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- wiring ----------
  $('lb-boards').addEventListener('click', (e) => {
    const c = e.target.closest('.lb-bcard');
    if (!c) return;
    const b = boards.find((x) => x.id === c.dataset.board);
    if (b) selectBoard(b);
  });
  $('lb-boards').addEventListener('dblclick', (e) => { if (e.target.closest('[data-board]') && cur) showView('score'); });
  $('lb-go').addEventListener('click', () => { if (cur) showView('score'); });
  $('lb-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (b && !b.disabled) openSetup(false, b.dataset.preset);
  });
  $('lb-edit-home').addEventListener('click', () => openSetup(true));
  $('lb-edit').addEventListener('click', () => openSetup(true));
  $('lb-back').addEventListener('click', () => { showView('home'); $('lb-go').focus(); });
  for (const b of document.querySelectorAll('[data-projector]')) b.addEventListener('click', openProjector);
  $('lb-undo').addEventListener('click', doUndo);
  $('lb-reset').addEventListener('click', () => {
    if (!cur || !confirm(`Set every score back to ${fmt(cur.startScore)}? The names stay.`)) return;
    act('the reset', () => { cur.entries.forEach((e) => { e.score = cur.startScore; }); });
  });
  const setSort = (mode) => {
    if (!cur || cur.sortMode === mode) return;
    cur.sortMode = mode;
    holdUntil = 0;
    markDirty(cur);
    paintAll();
  };
  $('lb-sort-score').addEventListener('click', () => setSort('score'));
  $('lb-sort-order').addEventListener('click', () => setSort('order'));

  const entriesEl = $('lb-entries');
  entriesEl.addEventListener('click', (e) => {
    const li = e.target.closest('.lb-entry');
    if (!li) return;
    const pt = e.target.closest('[data-d]');
    if (pt) { addPoints(li.dataset.id, +pt.dataset.d); return; }
    if (e.target.closest('[data-edit]')) openEntry(li.dataset.id);
  });
  entriesEl.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('lb-custom')) return;
    if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const d = parseAmount(e.target.value);
    if (d == null || d === 0) {
      if (e.target.value.trim()) { e.target.classList.remove('bad'); void e.target.offsetWidth; e.target.classList.add('bad'); }
      return;
    }
    e.target.value = '';
    addPoints(e.target.closest('.lb-entry').dataset.id, d);
  });

  // Ctrl+Z undoes; Esc goes back home (not from a dialog, a field, or the Esc
  // that just left full screen)
  let presentOffAt = 0;
  document.addEventListener('teacherpal:present', (e) => {
    if (e.detail && e.detail.on) requestAnimationFrame(() => paintShow(cur, 'Pick a scoreboard on the Leaderboard home.'));
    else presentOffAt = Date.now();
  });
  addEventListener('resize', () => { if (document.body.classList.contains('present')) paintShow(cur, 'Pick a scoreboard on the Leaderboard home.'); });
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (isTyping(e.target) || page.dataset.view !== 'score') return;
      e.preventDefault();
      doUndo();
      return;
    }
    if (e.key !== 'Escape' || e.defaultPrevented || page.dataset.view === 'home') return;
    if (document.body.classList.contains('present') || Date.now() - presentOffAt < 300) return;
    showView('home');
    $('lb-go').focus();
  });

  // ---------- loading ----------
  async function load() {
    try {
      boards = (await getScoreboards()).map(fromRow);
      ready = true;
    } catch (e) {
      boards = [];
      if (isMissingTableError(e)) {
        ready = false;
        setStatus('The Leaderboard needs migration-scoreboards.sql: run it in the Supabase SQL editor.', 'error');
      } else {
        showError(e);
      }
    }
    loaded = true;
    let want = null;
    try { want = localStorage.getItem(BOARD_KEY); } catch { /* ignore */ }
    const b = boards.find((x) => x.id === want) || boards[0] || null;
    cur = null;
    selectBoard(b);
    if (!b) paintAll();
  }
  // coming back to the tab picks up changes made on another device
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !ready || !loaded || pending.size || saving || document.querySelector('dialog[open]')) return;
    try {
      const fresh = (await getScoreboards()).map(fromRow);
      if (pending.size || saving) return;
      const byId = new Map(fresh.map((x) => [x.id, x]));
      const keep = cur && byId.get(cur.id);
      if (keep && cur && JSON.stringify(keep.entries) !== JSON.stringify(cur.entries)) undo = [];
      boards = fresh;
      cur = null;
      selectBoard(keep || boards[0] || null);
      if (page.dataset.view === 'score' && !cur) showView('home');
    } catch { /* keep what's on screen */ }
  });

  showView('home');
  paintAll();
  load();
})();
