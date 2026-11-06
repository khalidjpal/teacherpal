// Family Feud: a survey game for two teams.
//
// One file, three windows:
//   * the main tab (showdown.html): the only writer. Holds the question sets
//     (Supabase, survey_sets, through shared.js), the game state, the
//     controls, the editor and the team dialog; plays the sounds.
//   * the full screen window (showdown-popout.html) and the mini window (the
//     same page at ?mini=1, in a Picture-in-Picture iframe): read-only,
//     drawn from what the main tab sends on BroadcastChannel('teacherpal-showdown').
//     They load no shared.js and never touch Supabase. They are sent only the
//     answers already revealed (redacted()), so nothing on the projector,
//     not even its page source, gives an answer away.
//   * host mode: while the full screen window is open (it says "here" every
//     2s) the main tab shows the host view instead of the board: every answer
//     and its points as buttons, the pot, the strikes, the teams and the
//     controls. The Host view switch overrides that either way.
//
// Game state (localStorage teacherpal.showdown.game, so a reload keeps the game):
//   { setId, qIndex, questionId, revealed: [0|1|2 x8], strikes, pot, awardedTo,
//     teams: [{ name, score, members: [label] } x2], strikeAt, awardAt,
//     roster: null | { periodId, periodName, students: { label: { id, name } } } }
//   roster: set when the teams were split from a class, so End game can put
//   the game on that period's Leaderboard (game-end.js); null = just names.
//   revealed: 0 hidden, 1 shown and in the round's pot, 2 shown for nothing
//   (after the round was awarded, or "Show all").
(function () {
  'use strict';

  const POPOUT = document.body.classList.contains('sd-popout');
  const MINI = POPOUT && new URLSearchParams(location.search).get('mini') === '1';
  const GAME_KEY = 'teacherpal.showdown.game';
  const MUTE_KEY = 'teacherpal.showdown.muted';
  const SLOTS = 8;
  const STRIKE_MS = 1400;
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('teacherpal-showdown') : null;
  const $ = (id) => document.getElementById(id);

  // "Pencil 30", "Pencil - 30", "Pencil: 30", "Pencil (30)", "Pencil<tab>30"
  const ANSWER_RE = /^(.*?\S)[\s:\-–—=(]*?(\d{1,3})\s*\)?\s*(?:pts?|points?)?\.?$/i;

  // The starter set: also what the game plays before migration-survey-showdown.sql
  // has been run (or for a teacher with an empty bank), so it always works.
  const STARTER = [
    ['Name something you keep in your backpack.', 'Pencil 30 | Notebook 22 | Phone 18 | Water bottle 14 | Snack 9 | Charger 7'],
    ['Name something you find in a kitchen.', 'Fridge 28 | Stove 24 | Sink 18 | Table 12 | Microwave 10 | Dishes 8'],
    ['Name something students do after school.', 'Homework 26 | Sleep 20 | Play video games 18 | Sports 14 | Eat 12 | Work 10'],
    ['Name a food people eat for breakfast.', 'Eggs 30 | Cereal 22 | Toast 18 | Fruit 12 | Pancakes 10 | Coffee 8'],
    ['Name something you see in a classroom.', 'Desk 28 | Whiteboard 24 | Chairs 18 | Books 14 | Clock 9 | Backpack 7'],
    ['Name something people do on their phone.', 'Text 30 | Watch videos 24 | Listen to music 16 | Games 14 | Take photos 10 | Call someone 6'],
    ['Name a place people go on the weekend.', "Mall 26 | Park 22 | Movies 18 | Friend's house 14 | Beach 12 | Restaurant 8"],
    ["Name something in your mom's purse.", 'Keys 28 | Phone 22 | Wallet 18 | Lipstick 14 | Gum 10 | Tissues 8'],
  ].map(([question, a], i) => ({ id: `starter-${i}`, question, answers: parseAnswerLine(a) }));
  const STARTER_SET = { id: 'starter', name: 'Starter questions', questions: STARTER };

  // ---------- text import ----------
  function parseAnswerLine(line) {
    const out = [];
    for (const raw of line.split(/\s*\|\s*|\t{2,}/)) {
      const piece = raw.trim();
      if (!piece) continue;
      const m = piece.match(ANSWER_RE);
      if (!m) return null;
      const text = m[1].replace(/[\s:\-–—=(]+$/, '').trim();
      if (!text) return null;
      out.push({ text: text.slice(0, 60), points: Math.min(999, parseInt(m[2], 10)) });
    }
    return out.length ? out : null;
  }
  // ---------- pasting a whole game ----------
  // Questions are separated by a blank line: a question's first line is the
  // question, every line after it an answer. Forgiving about the rest:
  // numbering and bullets; "Pencil 30", "Pencil, 30", "Pencil - 30",
  // "Pencil: 30", "Pencil (30 pts)", "Pencil<tab>30", "30 - Pencil"; several
  // answers on one line split by | or ; (or commas); and answers with no
  // points at all, which get points from autoPoints(). A line that reads like
  // a question ("…?", "Name something…", "Q2:") starts a new question even
  // without a blank line.
  const MAX_Q = 100;
  const EMPTY_Q = '(no question yet)';
  const BULLET_RE = /^\s*(?:\(?(?:\d{1,2}|[a-hA-H])[.)]|[-–—•*·▪●◦>]+)\s+/;
  const Q_CUE = /^\s*q(?:uestion)?\s*\d*\s*[:.)\-–]\s*/i;
  const A_CUE = /^\s*a(?:nswers?)?\s*\d*\s*[:.)\-–]\s*/i;
  const TRAIL_RE = /^(.*?\S)[\s,:\-–—=(]*?(\d{1,3})\s*(?:pts?\.?|points?)?\s*\)?\.?$/i;
  const LEAD_RE = /^(\d{1,3})\s*(?:pts?\.?|points?)?\s*[-–—:|)=]\s*(.+)$/i;
  const PTS_ONLY = /^\d{1,3}\s*(?:pts?\.?|points?)?$/i;
  const clipA = (t) => String(t).trim().slice(0, 60);
  const looksLikeQuestion = (l) => /\?\s*$/.test(l)
    || /^name\s+(?:a|an|the|one|some|something|someone|somewhere|your|any|another)\b/i.test(l)
    || (/^(?:what|which|who|where|when|why|how)\b/i.test(l) && l.split(/\s+/).length >= 4);

  function oneAnswer(p) {
    p = p.replace(BULLET_RE, '').trim();
    let m = p.match(LEAD_RE);
    if (m) return { text: clipA(m[2]), points: Math.min(999, +m[1]), whole: p };
    m = p.match(TRAIL_RE);
    if (m) {
      const text = m[1].replace(/[\s,:\-–—=(]+$/, '').trim();
      if (text) return { text: clipA(text), points: Math.min(999, +m[2]), whole: p };
    }
    return { text: clipA(p), points: null, whole: p };
  }
  function splitAnswers(line) {
    let parts = line.split(/\s*[|;]\s*|\t{2,}/).filter(Boolean);
    if (parts.length === 1) {
      const c = line.split(/\s*,\s*/).filter(Boolean);
      if (c.length === 2 && PTS_ONLY.test(c[1])) parts = [line];                                   // "Pencil, 30"
      else if (c.length >= 3 && c.every((p) => p.split(/\s+/).length <= 4)) parts = c;             // "Pencil, Notebook, Phone"
      else if (c.length === 2 && c.every((p) => TRAIL_RE.test(p))) parts = c;                      // "Pencil 30, Notebook 22"
    }
    return parts.map(oneAnswer).filter((a) => a.text);
  }
  // descending, about 100 in all, the first clearly the biggest (each one 0.7 of the one above)
  function autoPoints(n) {
    if (n <= 0) return [];
    const w = Array.from({ length: n }, (_, i) => Math.pow(0.7, i));
    const sum = w.reduce((s, x) => s + x, 0);
    const raw = w.map((x) => (x / sum) * 100);
    const p = raw.map(Math.floor);
    const left = 100 - p.reduce((s, x) => s + x, 0);
    raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).slice(0, left).forEach(([, i]) => { p[i]++; });
    for (let i = n - 1; i >= 0; i--) p[i] = Math.max(p[i], i < n - 1 ? p[i + 1] + 1 : 1);
    return p;
  }
  // auto: every answer with text gets autoPoints by its place; otherwise only
  // the missing ones do (at their place's value)
  function fillPoints(q) {
    const live = q.answers.filter((a) => a.text.trim());
    const pts = autoPoints(live.length);
    live.forEach((a, i) => { if (q.auto || a.points == null || a.points === '') a.points = pts[i]; });
    q.answers.forEach((a) => { if (!a.text.trim()) a.points = null; });
  }
  function parseGame(text) {
    const qs = [];
    let cur = null, extra = 0;
    const start = (line) => {
      if (qs.length >= MAX_Q) { cur = null; extra++; return; }
      cur = { question: line === EMPTY_Q ? '' : line.slice(0, 300), answers: [] };
      qs.push(cur);
    };
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      let line = rawLine.trim();
      if (!line) { cur = null; continue; }                  // a blank line: the next line is a question
      let cue = false;
      const qc = line.match(Q_CUE);
      if (qc) { line = line.slice(qc[0].length).trim(); cue = true; }
      else if (cur) { const ac = line.match(A_CUE); if (ac) line = line.slice(ac[0].length).trim(); }
      line = line.replace(BULLET_RE, '').trim();
      if (!line || /^answers?\s*:?$/i.test(line)) continue;
      if (!cur || cue || (cur.answers.length && looksLikeQuestion(line))) {
        // the whole question on one line: "Name a pet? Dog, Cat, Fish" / "Name a color: Red | Blue"
        const one = line.match(/^(.{6,}?[?:])\s+(.+)$/);
        const inline = one ? splitAnswers(one[2]) : [];
        if (inline.length >= 2) { start(one[1].replace(/:$/, '').trim()); if (cur) cur.answers.push(...inline.slice(0, SLOTS)); extra += Math.max(0, inline.length - SLOTS); }
        else start(line);
        continue;
      }
      for (const a of splitAnswers(line)) {
        if (cur.answers.length >= SLOTS) extra++;
        else cur.answers.push(a);
      }
    }
    for (const q of qs) {
      const withPts = q.answers.filter((a) => a.points != null).length;
      // a stray number or two is part of the answer ("Route 66"), not its points
      if (withPts && withPts * 2 < q.answers.length) q.answers.forEach((a) => { if (a.points != null) { a.text = clipA(a.whole); a.points = null; } });
      q.auto = q.answers.every((a) => a.points == null);
      q.answers.forEach((a) => { delete a.whole; });
      fillPoints(q);
    }
    return { questions: qs, extra };
  }
  const sortAnswers = (a) => a.slice().sort((x, y) => y.points - x.points);
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 8);
  // what's saved and played: questions with text and at least one answer, every answer with points, highest first
  function cleanQuestions(qs) {
    return qs.filter((q) => q.question.trim() && q.answers.some((a) => a.text.trim())).map((q) => {
      const c = { id: q.id, question: q.question.trim().slice(0, 300), answers: q.answers.filter((a) => a.text.trim()).map((a) => ({ text: clipA(a.text), points: a.points })) };
      if (q.auto) c.auto = true;
      fillPoints(c);
      c.answers = sortAnswers(c.answers).slice(0, SLOTS);
      return c;
    });
  }

  // ---------- the board (every window) ----------
  function buildStage(stage) {
    const team = (k) => `
      <div class="sd-team" data-team="${k}">
        <div class="sd-team-name" id="sd-tname-${k}"></div>
        <div class="sd-score"><span id="sd-score-${k}">0</span></div>
        ${POPOUT ? '' : `<button type="button" class="sd-award" data-award="${k}" disabled>Give the points</button>`}
        <ul class="sd-members" id="sd-tmem-${k}"></ul>
      </div>`;
    const slots = Array.from({ length: SLOTS }, (_, i) => `
      <li class="sd-slot empty" data-i="${i}">
        <${POPOUT ? 'div' : 'button type="button"'} class="sd-card" ${POPOUT ? '' : `title="Reveal (${i + 1})"`}>
          <span class="sd-front"><span class="sd-num">${i + 1}</span></span>
          <span class="sd-back"><span class="sd-num">${i + 1}</span><span class="sd-ans"></span><span class="sd-pts"></span></span>
        </${POPOUT ? 'div' : 'button'}>
      </li>`).join('');
    stage.innerHTML = `
      ${team(0)}
      <div class="sd-center">
        <div class="sd-question">
          <span class="sd-asked">We asked 100 students…</span>
          <h2 class="sd-q" id="sd-q"></h2>
        </div>
        <div class="sd-pot" id="sd-pot">
          <span class="sd-pot-key">Points in play</span>
          <b id="sd-pot-val">0</b>
          <span class="sd-round-note" id="sd-round-note"></span>
        </div>
        <div class="sd-frame" id="sd-frame">
          <ol class="sd-board" id="sd-board">${slots}</ol>
          <span class="sd-sweep" aria-hidden="true"></span>
        </div>
        <div class="sd-strikes" id="sd-strikes" aria-label="Strikes">
          <span class="sd-x"></span><span class="sd-x"></span><span class="sd-x"></span>
        </div>
      </div>
      ${team(1)}
      <p class="sd-live" id="sd-live" aria-live="polite"></p>`;
    // the strike flash and the confetti cover the whole window
    if (!$('sd-flash')) {
      const f = document.createElement('div');
      f.className = 'sd-flash'; f.id = 'sd-flash'; f.setAttribute('aria-hidden', 'true');
      document.body.appendChild(f);
    }
  }

  let shownQ = null;          // the question id on screen (a change = no flip animation)
  let lastStrikeAt = 0, lastAwardAt = 0;
  let boardQuiet = false;     // the host view is up: no flash or confetti over the teacher's sheet
  // The flip, sparkle, sweep and confetti are CSS animations, never
  // transitions: the app-wide reduced-motion rule turns every transition off,
  // and on a machine with Windows animations off the reveal would just jump.
  function renderBoard(view) {
    const { st, q, num, total } = view;
    const board = $('sd-board');
    if (!board) return;
    const swap = shownQ !== (q ? q.id : null);
    $('sd-q').textContent = q ? q.question : 'No questions yet';
    const answers = q ? q.answers : [];
    // two columns, numbered down the left then the right; as many rows as needed
    const rows = Math.min(4, Math.max(2, Math.ceil(answers.length / 2)));
    board.style.setProperty('--rows', rows);
    $('sd-stage').dataset.rows = rows;
    board.querySelectorAll('.sd-slot').forEach((li, i) => {
      const a = answers[i];
      li.classList.toggle('empty', !a);
      li.hidden = i >= rows * 2;
      const shown = !!(a && st.revealed[i]);
      const was = li.classList.contains('flipped');
      li.classList.toggle('flipped', shown);
      li.classList.toggle('free', shown && st.revealed[i] === 2);
      if (!swap && shown !== was) animateFlip(li, shown);
      else if (swap) li.classList.remove('flipping', 'unflipping');
      li.querySelector('.sd-ans').textContent = a ? a.text : '';
      li.querySelector('.sd-pts').textContent = a ? a.points : '';
      const card = li.querySelector('.sd-card');
      if (card.tagName === 'BUTTON') {
        card.disabled = !a;
        card.setAttribute('aria-label', a ? (shown ? `${i + 1}: ${a.text}, ${a.points} points (click to hide)` : `Reveal answer ${i + 1}`) : `Empty slot ${i + 1}`);
      }
    });
    if (swap) {
      const first = shownQ === null && !q;
      shownQ = q ? q.id : null;
      if (q && !first) replay($('sd-frame'), 'sweeping', 1300);   // the spotlight crosses the new board
    }

    const lead = st.teams[0].score === st.teams[1].score ? -1 : (st.teams[0].score > st.teams[1].score ? 0 : 1);
    for (const k of [0, 1]) {
      const t = st.teams[k];
      $(`sd-tname-${k}`).textContent = t.name || `Team ${k + 1}`;
      $(`sd-score-${k}`).textContent = t.score;
      document.querySelector(`.sd-team[data-team="${k}"]`).classList.toggle('lead', lead === k);
      const ul = $(`sd-tmem-${k}`);
      ul.replaceChildren(...t.members.map((m) => { const li = document.createElement('li'); li.textContent = m; return li; }));
      ul.classList.toggle('two-col', t.members.length > 9);
      const btn = document.querySelector(`[data-award="${k}"]`);
      if (btn) {
        btn.disabled = st.pot <= 0;
        btn.textContent = st.pot > 0 ? `Give ${st.pot} to ${t.name || `Team ${k + 1}`}` : 'Give the points';
      }
    }
    const potEl = $('sd-pot-val');
    if (potEl.textContent !== String(st.pot) && !swap && st.pot > 0) replay($('sd-pot'), 'bump', 450);
    potEl.textContent = st.pot;
    $('sd-pot').classList.toggle('zero', st.pot <= 0);
    $('sd-strikes').querySelectorAll('.sd-x').forEach((x, i) => x.classList.toggle('on', i < st.strikes));
    $('sd-strikes').dataset.n = st.strikes;
    $('sd-round-note').textContent = roundNote(st);
    const qc = $('sd-qcount');
    if (qc) qc.textContent = total ? `Question ${num} of ${total}` : 'No questions';
    if (MINI) $('sd-q').title = q ? q.question : '';

    // a strike just now: the red flash and the huge X (every window)
    if (st.strikeAt && st.strikeAt !== lastStrikeAt) {
      const fresh = Date.now() - st.strikeAt < STRIKE_MS;
      lastStrikeAt = st.strikeAt;
      if (fresh && !swap && !boardQuiet) {
        flashStrike();
        replay($('sd-stage'), 'shake', 450);
        const x = $('sd-strikes').querySelectorAll('.sd-x')[st.strikes - 1];
        if (x) replay(x, 'stamp', 700);
      }
    }
    // the pot just went to a team: its panel lights up and confetti falls
    if (st.awardAt && st.awardAt !== lastAwardAt) {
      const fresh = Date.now() - st.awardAt < 1500;
      lastAwardAt = st.awardAt;
      if (fresh && st.awardedTo != null && !boardQuiet) {
        replay(document.querySelector(`.sd-team[data-team="${st.awardedTo}"]`), 'won', 1600);
        confetti(st.awardedTo);
      }
    }
  }
  function roundNote(st) {
    if (st.awardedTo != null) return `Round to ${st.teams[st.awardedTo].name || `Team ${st.awardedTo + 1}`}`;
    if (st.strikes >= 3) return 'Three strikes: the other team can steal';
    return '';
  }
  function replay(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    clearTimeout(el['_t' + cls]);
    el['_t' + cls] = setTimeout(() => el.classList.remove(cls), ms);
  }
  function animateFlip(li, shown) {
    li.classList.remove('flipping', 'unflipping');
    void li.offsetWidth;
    li.classList.add(shown ? 'flipping' : 'unflipping');
    clearTimeout(li._flip);
    li._flip = setTimeout(() => li.classList.remove('flipping', 'unflipping'), 900);
    if (shown) setTimeout(() => sparkle(li), 380);   // as the face comes round
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function sparkle(li) {
    const s = document.createElement('span');
    s.className = 'sd-spark'; s.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('i');
      const ang = rnd(0, Math.PI * 2), d = rnd(40, 110);
      p.style.cssText = `left:${rnd(4, 96)}%;top:${rnd(15, 85)}%;--dx:${Math.cos(ang) * d}px;--dy:${Math.sin(ang) * d * 0.6}px;--s:${rnd(0.5, 1.2)};animation-delay:${rnd(0, 120)}ms`;
      s.appendChild(p);
    }
    li.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }
  function confetti(k) {
    const c = document.createElement('div');
    c.className = 'sd-confetti'; c.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 110; i++) {
      const p = document.createElement('i');
      const from = k === 0 ? rnd(0, 55) : rnd(45, 100);   // more over the winning side
      p.style.cssText = `left:${from}%;--dx:${rnd(-18, 18)}vw;--r:${rnd(-720, 720)}deg;--d:${rnd(1.7, 3)}s;animation-delay:${rnd(0, 450)}ms;--w:${rnd(0.45, 0.95)}rem`;
      p.className = 'c' + (i % 5);
      c.appendChild(p);
    }
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3800);
  }
  let flashTimer = 0;
  function flashStrike() {
    const f = $('sd-flash');
    if (!f.firstChild) { const s = document.createElement('span'); s.className = 'sd-bigx'; f.appendChild(s); }
    f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => f.classList.remove('show'), STRIKE_MS);
  }

  // ---------- the pop-out / mini window ----------
  if (POPOUT) {
    document.body.classList.toggle('sd-mini-mode', MINI);
    buildStage($('sd-stage'));
    let heard = false;
    if (bc) {
      bc.onmessage = (ev) => {
        const d = ev.data;
        if (d && d.type === 'state') { heard = true; $('sd-waiting').hidden = true; renderBoard(d); }
      };
      bc.postMessage({ type: 'request-state' });
      // the projector window tells the main tab it's open (host mode follows it)
      if (!MINI) {
        const here = () => bc.postMessage({ type: 'here' });
        here();
        setInterval(here, 2000);
        document.addEventListener('visibilitychange', here);
        addEventListener('pagehide', () => bc.postMessage({ type: 'bye' }));
      }
    }
    // nothing yet: draw the saved game (empty questions) and say so
    renderBoard({ st: freshGame(), q: null, num: 0, total: 0 });
    setTimeout(() => { if (!heard) $('sd-waiting').hidden = false; }, 1500);
    return;
  }

  // ---------- the main tab ----------
  function freshTeams() { return [{ name: 'Team 1', score: 0, members: [] }, { name: 'Team 2', score: 0, members: [] }]; }
  function freshRound() { return { revealed: Array(SLOTS).fill(0), strikes: 0, pot: 0, awardedTo: null, strikeAt: 0, awardAt: 0 }; }
  function freshGame() { return { setId: null, qIndex: 0, questionId: null, teams: freshTeams(), roster: null, ...freshRound() }; }

  let sets = [];               // [{ id, name, questions }]: the teacher's question sets
  let fallbackSet = STARTER_SET;   // played while there are no sets (or no table: the old bank, else the starter set)
  let questions = STARTER;     // the playing set's questions
  let bankReady = false;       // false = survey_sets isn't there (read-only)
  let st = loadGame();
  const undo = [];
  let muted = localStorage.getItem(MUTE_KEY) === '1';

  function loadGame() {
    try {
      const g = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
      if (g && Array.isArray(g.teams) && g.teams.length === 2 && Array.isArray(g.revealed)) {
        const base = freshGame();
        const roster = g.roster && g.roster.periodId && g.roster.students && typeof g.roster.students === 'object' ? g.roster : null;
        return { ...base, ...g, roster, teams: g.teams.map((t, k) => ({ ...base.teams[k], ...t, members: Array.isArray(t.members) ? t.members : [] })) };
      }
    } catch { /* ignore */ }
    return freshGame();
  }
  function saveGame() { try { localStorage.setItem(GAME_KEY, JSON.stringify(st)); } catch { /* ignore */ } }
  const currentQ = () => questions[st.qIndex] || null;

  function view() { return { type: 'state', st, q: currentQ(), num: questions.length ? st.qIndex + 1 : 0, total: questions.length }; }
  // what the other windows get: the answers still hidden are blanked out
  function redacted(v) {
    if (!v.q) return v;
    const answers = v.q.answers.map((a, i) => (st.revealed[i] ? { text: a.text, points: a.points } : { text: '', points: '' }));
    return { ...v, q: { id: v.q.id, question: v.q.question, answers } };
  }
  const send = () => { if (bc) bc.postMessage(redacted(view())); };
  function commit() {
    questions = playingSet().questions;
    // until the sets are in, the board shows the starter set: don't let that
    // overwrite (or save over) the game in progress
    if (listLoaded) {
      if (st.qIndex >= questions.length) st.qIndex = Math.max(0, questions.length - 1);
      const q = currentQ();
      st.questionId = q ? q.id : null;
      saveGame();
    }
    renderBoard(view());
    send();
    paintHost();
    $('sd-undo').disabled = !undo.length;
    $('sd-end').disabled = !inProgress();
    // the arrows only stop at the ends, and then they say why
    const atFirst = st.qIndex <= 0, atLast = st.qIndex >= questions.length - 1;
    const arrow = (id, off, on, why) => { const el = $(id); el.disabled = off; el.title = off ? why : on; el.setAttribute('aria-label', off ? why : on.replace(/ (.)$/, '')); };
    arrow('sd-prev', atFirst, 'Previous question (←)', 'This is the first question');
    arrow('sd-next', atLast, 'Next question (→)', questions.length > 1 ? 'This is the last question' : 'This set has only one question');
    $('sd-strike').disabled = !currentQ() || st.strikes >= 3;
    const q2 = currentQ();
    $('sd-reveal-all').disabled = !q2 || q2.answers.every((_, i) => st.revealed[i]);
  }
  // every change to the game goes through here, so Undo can step back
  function act(fn) {
    undo.push(JSON.stringify(st));
    if (undo.length > 60) undo.shift();
    fn();
    commit();
  }

  function reveal(i) {
    const q = currentQ();
    const a = q && q.answers[i];
    if (!a) return;
    act(() => {
      if (st.revealed[i]) {               // a mistake: hide it again
        if (st.revealed[i] === 1) st.pot = Math.max(0, st.pot - a.points);
        st.revealed[i] = 0;
        return;
      }
      if (st.awardedTo == null) { st.revealed[i] = 1; st.pot += a.points; } else st.revealed[i] = 2;
      sound.ding(a.points);
      live(`${a.text}, ${a.points}`);
    });
  }
  function strike() {
    if (!currentQ() || st.strikes >= 3) return;
    act(() => { st.strikes++; st.strikeAt = Date.now(); });
    sound.buzz();
    live(`Strike ${st.strikes}`);
  }
  function award(k) {
    if (st.pot <= 0) return;
    act(() => {
      st.teams[k].score += st.pot;
      st.pot = 0;
      st.awardedTo = k;
      st.awardAt = Date.now();
    });
    sound.award();
    live(`${st.teams[k].name} now has ${st.teams[k].score}`);
  }
  function goTo(i) {
    if (!questions.length) return;
    const n = Math.max(0, Math.min(questions.length - 1, i));
    if (n === st.qIndex && st.questionId === questions[n].id) return;
    act(() => { Object.assign(st, freshRound()); st.qIndex = n; });
  }
  function revealAll() {
    const q = currentQ();
    if (!q) return;
    act(() => { q.answers.forEach((_, i) => { if (!st.revealed[i]) st.revealed[i] = 2; }); });
    sound.ding(10);
  }
  function resetGame() {
    if (!confirm('Start a new game? Both scores go back to 0 and the game goes back to question 1. Team names and members stay.')) return;
    act(() => {
      const teams = st.teams.map((t) => ({ ...t, score: 0 }));
      Object.assign(st, freshGame(), { teams });
    });
  }
  // End game: the final scores, then (teams from a roster) onto the
  // Leaderboard; the game then starts fresh on the start screen
  function endGame() {
    if (typeof openGameEnd !== 'function') return;
    const set = playingSet();
    openGameEnd({
      game: 'feud', palette: 'sd-game',
      setId: set ? set.id : null, setName: set ? set.name : '',
      teams: st.teams.map((t) => ({ name: t.name, score: t.score, members: t.members.slice() })),
      roster: st.roster,
      onEnd(saved) {
        act(() => {
          const teams = st.teams.map((t) => ({ ...t, score: 0 }));
          Object.assign(st, freshGame(), { teams, roster: st.roster, setId: st.setId });
        });
        setStart(true);
        setStatus(saved ? `Game saved to the ${(st.roster && st.roster.periodName) || 'class'} leaderboard.` : 'Game ended.', 'ok');
      },
    });
  }
  function live(msg) { const el = $('sd-live'); if (el) el.textContent = msg; }

  // ---------- host mode ----------
  let hostPref = null;         // null: follow the projector window; true / false: the switch (this visit)
  let projAt = 0;              // when the projector window last said "here"
  let shownProj = false;
  const projOn = () => Date.now() - projAt < 7000;
  const hosting = () => (hostPref == null ? projOn() : hostPref);
  function paintMode() {
    const on = hosting();
    boardQuiet = on;
    shownProj = projOn();
    document.querySelector('.showdown-page').classList.toggle('hosting', on);
    $('sd-host').hidden = !on;
    $('sd-host-btn').setAttribute('aria-pressed', String(on));
    $('sd-proj').dataset.on = shownProj ? '1' : '0';
    $('sd-proj-text').textContent = shownProj ? 'Projector window is open' : 'No projector window';
    $('sd-proj-open').hidden = shownProj;
  }
  function paintHost() {
    const q = currentQ();
    $('sd-host-qnum').textContent = questions.length ? `Question ${st.qIndex + 1} of ${questions.length}` : 'No questions';
    $('sd-host-q').textContent = q ? q.question : 'No questions yet. Open Game setup to add some.';
    const ol = $('sd-host-answers');
    const focused = document.activeElement && ol.contains(document.activeElement) ? document.activeElement.dataset.reveal : null;
    ol.replaceChildren(...(q ? q.answers : []).map((a, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sd-ha'; b.dataset.reveal = i;
      const r = st.revealed[i] || 0;
      b.dataset.state = r === 1 ? 'shown' : (r === 2 ? 'free' : 'hidden');
      b.setAttribute('aria-pressed', String(!!r));
      b.title = r ? 'On the board. Click to hide it again' : `Show it on the projector (${i + 1})`;
      const n = document.createElement('b'); n.className = 'sd-ha-n'; n.textContent = i + 1;
      const t = document.createElement('span'); t.className = 'sd-ha-t'; t.textContent = a.text;
      const p = document.createElement('span'); p.className = 'sd-ha-p'; p.textContent = a.points;
      const s = document.createElement('span'); s.className = 'sd-ha-s';
      s.textContent = r === 1 ? 'On the board' : (r === 2 ? 'Shown, no points' : 'Reveal');
      b.append(n, t, p, s);
      li.appendChild(b);
      return li;
    }));
    if (focused != null) { const f = ol.querySelector(`[data-reveal="${focused}"]`); if (f) f.focus(); }
    $('sd-host-pot').textContent = st.pot;
    const xs = $('sd-host-strikes');
    xs.querySelectorAll('span').forEach((x, i) => x.classList.toggle('on', i < st.strikes));
    xs.setAttribute('aria-label', `Strikes: ${st.strikes} of 3`);
    $('sd-host-note').textContent = roundNote(st);
    $('sd-host-teams').replaceChildren(...st.teams.map((t, k) => {
      const d = document.createElement('div'); d.className = 'sd-ht';
      if (t.score > st.teams[1 - k].score) d.classList.add('lead');
      const nm = document.createElement('span'); nm.className = 'sd-ht-name'; nm.textContent = t.name || `Team ${k + 1}`;
      const sc = document.createElement('b'); sc.className = 'sd-ht-score'; sc.textContent = t.score;
      const g = document.createElement('button'); g.type = 'button'; g.dataset.award = k; g.className = 'sd-ht-give';
      g.disabled = st.pot <= 0;
      g.textContent = st.pot > 0 ? `Give ${st.pot} to ${t.name || `Team ${k + 1}`}` : 'Give the points';
      d.append(nm, sc, g);
      return d;
    }));
  }

  // ---------- sound (Web Audio, this tab only) ----------
  const sound = (() => {
    let ctx = null;
    const ac = () => {
      if (muted) return null;
      try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    };
    const tone = (c, freq, t0, dur, type = 'sine', vol = 0.18) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    };
    return {
      ding() {   // a bright two-note bell
        const c = ac(); if (!c) return;
        const t = c.currentTime;
        tone(c, 1318.5, t, 0.5, 'sine', 0.2); tone(c, 2637, t, 0.25, 'sine', 0.05);
        tone(c, 1760, t + 0.12, 0.9, 'sine', 0.2); tone(c, 3520, t + 0.12, 0.3, 'sine', 0.04);
      },
      buzz() {   // a harsh low buzzer
        const c = ac(); if (!c) return;
        const t = c.currentTime;
        tone(c, 92, t, 0.75, 'sawtooth', 0.22); tone(c, 97, t, 0.75, 'square', 0.12); tone(c, 184, t, 0.75, 'sawtooth', 0.06);
      },
      award() {  // a rising chime
        const c = ac(); if (!c) return;
        const t = c.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, t + i * 0.09, 0.5, 'triangle', 0.16));
      },
    };
  })();

  // ---------- names (the same rule as Create Groups) ----------
  const firstName = (n) => n.trim().split(/\s+/)[0] || n;
  const lastName = (n) => { const p = n.trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : ''; };
  function labelFor(s, all) {
    const first = firstName(s.name);
    const twins = all.filter((x) => firstName(x.name).toLocaleLowerCase() === first.toLocaleLowerCase());
    const last = lastName(s.name);
    if (twins.length < 2 || !last) return first;
    for (let k = 1; k <= last.length; k++) {
      const mine = last.slice(0, k).toLocaleLowerCase();
      if (twins.every((x) => x === s || lastName(x.name).slice(0, k).toLocaleLowerCase() !== mine)) return `${first} ${last.slice(0, k)}.`;
    }
    return s.name;
  }

  // ---------- teams (in Game setup) ----------
  function paintTeamsDialog() {
    paintSummary();
    for (const k of [0, 1]) {
      if (document.activeElement !== $(`sd-name-${k}`)) $(`sd-name-${k}`).value = st.teams[k].name;
      $(`sd-team-h-${k}`).textContent = `${st.teams[k].name} · ${st.teams[k].members.length || 'no'} student${st.teams[k].members.length === 1 ? '' : 's'}`;
      const ul = $(`sd-members-${k}`);
      if (!st.teams[k].members.length) {
        const li = document.createElement('li'); li.className = 'none'; li.textContent = 'No students yet';
        ul.replaceChildren(li);
      } else {
        ul.replaceChildren(...st.teams[k].members.map((m, i) => {
          const li = document.createElement('li');
          const b = document.createElement('button'); b.type = 'button'; b.textContent = m; b.dataset.k = k; b.dataset.i = i;
          b.title = `Move to ${st.teams[1 - k].name}`;
          li.appendChild(b); return li;
        }));
      }
    }
  }
  // each student's label on the board, unique within the class, and the
  // label -> student map End game records the leaderboard from
  function rosterFor(periodId, present) {
    const label = new Map();
    const students = {};
    for (const s of present) {
      let l = labelFor(s, present);
      for (let n = 2; students[l]; n++) l = `${labelFor(s, present)} (${n})`;
      label.set(s.id, l);
      students[l] = { id: s.id, name: s.name };
    }
    const opt = $('sd-period').selectedOptions[0];
    return { label, info: { periodId, periodName: opt ? opt.textContent : '', students } };
  }
  async function splitClass() {
    const periodId = $('sd-period').value;
    if (!periodId) { setStatus('Add a period in Rosters first.', 'error'); return; }
    const btn = $('sd-split');
    btn.disabled = true;
    try {
      const [students, att, rulesRow] = await Promise.all([
        getStudents(periodId),
        getAttendance(periodId, todayKey()).catch(() => null),
        getFormulaRules(periodId, 'grouping').catch(() => ({ rules: [], useFormula: false })),
      ]);
      const absent = att ? absentIdsOf(att.marks) : readAbsentCache(periodId);
      const out = readSitOutCache(periodId);
      const present = students.filter((s) => !absent.has(s.id) && !out.has(s.id));
      if (present.length < 2) { $('sd-split-note').textContent = present.length ? 'Only one student is here today.' : 'Nobody in this period is marked present today.'; return; }
      let groups;
      let how = 'at random';
      if (rulesRow.useFormula && rulesRow.rules.length && typeof groupWithFormula === 'function') {
        const nameOf = (id) => { const s = students.find((x) => x.id === id); return s ? s.name : ''; };
        const ids = new Set(present.map((s) => s.id));
        const groupMax = Math.ceil(present.length / 2);
        const problems = findImpossibleHard(rulesForPresent(rulesRow.rules, ids), nameOf, 'grouping', { groupCount: 2, groupMax });
        const demote = new Set(problems.map((p) => p.rule.id));   // impossible "musts" run as "try"
        const res = groupWithFormula(present, 2, rulesRow.rules, nameOf, { demote });
        groups = res.groups;
        how = 'by your grouping rules';
      } else {
        const mixed = shuffle(present.slice());
        groups = [mixed.filter((_, i) => i % 2 === 0), mixed.filter((_, i) => i % 2 === 1)];
      }
      const roster = rosterFor(periodId, present);
      act(() => {
        st.roster = roster.info;
        groups.forEach((g, k) => { st.teams[k].members = g.map((s) => roster.label.get(s.id)).sort((a, b) => a.localeCompare(b)); });
      });
      const skipped = students.length - present.length;
      $('sd-split-note').textContent = `${present.length} students split ${how}${skipped ? ` (${skipped} absent or sitting out)` : ''}.`;
      paintTeamsDialog();
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- question sets ----------
  const normSet = (row) => ({ id: row.id, name: row.name, questions: Array.isArray(row.questions) ? row.questions : [] });
  function playingSet() { return sets.find((s) => s.id === st.setId) || sets[0] || fallbackSet; }
  // after the sets change: keep the game on its set and its question if they're still there
  function useSet() {
    const s = playingSet();
    if (st.setId !== s.id) { st.setId = s.id; Object.assign(st, freshRound()); st.qIndex = 0; st.questionId = null; }
    questions = s.questions;
    const at = questions.findIndex((q) => q.id === st.questionId);
    if (at >= 0) st.qIndex = at;
    else { Object.assign(st, freshRound()); st.qIndex = Math.min(st.qIndex, Math.max(0, questions.length - 1)); }
  }
  function playSet(id, qIndex = 0) {
    act(() => { st.setId = id; Object.assign(st, freshRound()); st.qIndex = 0; st.questionId = null; useSet(); st.qIndex = Math.max(0, Math.min(qIndex, questions.length - 1)); });
  }
  function fillGameSelect() { if (setup.open) paintSetup(); if (startOn) paintStart(); }
  function uniqueName(base) {
    const taken = new Set(sets.map((s) => s.name.trim().toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
  }

  // ---------- the editor ----------
  // One set open at a time (ed), on one of two tabs:
  //   paste: the paste box beside a live preview of what was read from it,
  //          "Add these questions", and the AI prompt under them.
  //   write: one question at a time, big: the question, answer rows (three
  //          to start, one more as the last fills, up to 8), points tucked
  //          on the right; "Save and add another"; "Question 3 of 5" with
  //          arrows; the questions so far down the left.
  // Every change saves itself 700ms later; the X and Done save anything pending.
  const editor = $('sd-editor');
  let ed = null;               // { id | null (not created yet), name, questions, readonly, extra }
  let edView = 'paste';        // 'paste' | 'write'
  let cur = 0;                 // the question open on the write tab
  const canEdit = () => !!ed && !ed.readonly && bankReady;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const qDone = (q) => q.question.trim() && q.answers.some((a) => a.text.trim());
  const qBlank = (q) => !q.question.trim() && !q.answers.some((a) => a.text.trim());
  const blankQ = () => ({ id: newId(), question: '', answers: [], auto: true });

  // a set still called what the app called it has no name of its own yet
  const DEFAULT_NAME = /^(new set|untitled set)( \d+)?$/i;
  function loadDraft(set) {
    const builtin = !set || set === fallbackSet;
    const fresh = builtin && bankReady;     // a new set, not saved until it has a question
    ed = {
      id: builtin ? null : set.id,
      name: fresh ? '' : set.name,
      questions: fresh ? [] : clone(set.questions),
      readonly: !bankReady,
      extra: 0,
      unnamed: fresh || (!builtin && DEFAULT_NAME.test(set.name.trim())),
      asked: false,                         // the name prompt shows once per set
    };
    hideAsk();
    cur = 0;
    edView = ed.questions.length || !canEdit() ? 'write' : 'paste';
    $('sd-paste-text').value = '';
    renaming(false);
    paintSave('');
    paintEditor();
  }
  // the set's name, as an editable title, and beside it a separate control
  // that only switches sets
  function paintPick() {
    paintTitle();
    const pick = $('sd-set-pick');
    const head = document.createElement('option');
    head.value = ''; head.textContent = 'Switch set'; head.disabled = true; head.hidden = true;
    const opts = sets.map((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = (x.id === ed.id ? '✓ ' : '') + x.name; return o; });
    if (bankReady) { const o = document.createElement('option'); o.value = '__new'; o.textContent = '+ New set'; opts.push(o); }
    pick.replaceChildren(head, ...opts);
    pick.value = '';
    pick.disabled = !bankReady || (!sets.length && !!ed.id);
    pick.hidden = !bankReady;
  }
  function paintTitle() {
    const t = $('sd-set-name');
    if (document.activeElement !== t) t.value = ed.unnamed ? '' : ed.name;
    t.disabled = !canEdit();
  }
  function paintEditor() {
    paintPick();
    $('sd-set-menu').hidden = !canEdit();
    $('sd-set-dup').disabled = $('sd-set-del').disabled = !ed.id;
    paintPlay();
    paintView();
  }
  const paintPlay = () => { $('sd-play-set').disabled = !ed.id || !cleanQuestions(ed.questions).length; };
  function paintTabs() {
    for (const [v, id] of [['paste', 'sd-tab-paste'], ['write', 'sd-tab-write']]) {
      const t = $(id), on = edView === v;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    }
    const n = ed.questions.filter((q) => !qBlank(q)).length;
    $('sd-tab-n').textContent = n ? String(n) : '';
  }
  function paintView() {
    if (edView === 'write' && !ed.questions.length && canEdit()) { ed.questions.push(blankQ()); cur = 0; }
    paintTabs();
    $('sd-paste').hidden = edView !== 'paste';
    $('sd-write').hidden = edView !== 'write';
    if (edView === 'paste') paintPasteView(); else paintWrite();
  }
  function showTab(v, focus) {
    if (v === edView) return;
    if (edView === 'write') dropBlank();
    edView = v;
    paintView();
    if (focus) focusTab();
  }
  function focusTab() {
    if (!canEdit()) return;
    if (edView === 'paste') $('sd-paste-text').focus();
    else { const q = ed.questions[cur]; const a = q && q.question.trim() && !q.answers.some((x) => x.text.trim()) ? firstEmptyAnswer() : null; (a || $('sd-wq-q')).focus(); }
  }
  function paintSave(text, kind) {
    const el = $('sd-save-state');
    el.textContent = text; el.dataset.kind = kind || '';
  }
  function flashEd(text) {
    const el = $('sd-ed-flash');
    el.textContent = text;
    clearTimeout(flashEd.t);
    flashEd.t = setTimeout(() => { el.textContent = ''; }, 5000);
  }

  // ---------- the paste tab ----------
  function paintPasteView() {
    $('sd-starter').hidden = ed.questions.some((q) => !qBlank(q)) || !canEdit();
    $('sd-paste-text').disabled = !canEdit();
    paintFound();
  }
  // the preview: every question read from the box, its answers and points
  function paintFound() {
    const { questions, extra } = parseGame($('sd-paste-text').value);
    const ok = questions.filter(qDone);
    const n = ok.length;
    $('sd-paste-add').disabled = !n || !canEdit();
    $('sd-paste-add').textContent = n ? `Add ${n} question${n === 1 ? '' : 's'}` : 'Add these questions';
    const bad = questions.length - n;
    $('sd-pv-count').textContent = questions.length
      ? `${n} question${n === 1 ? '' : 's'} found${bad ? ` · ${bad} not finished` : ''}${extra ? ` · ${extra} left out` : ''}` : '';
    const list = $('sd-pv-list');
    if (!questions.length) {
      const li = document.createElement('li'); li.className = 'sd-pv-empty';
      li.textContent = 'Nothing yet';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...questions.map((q, i) => {
      const li = document.createElement('li'); li.className = 'sd-pv-q' + (qDone(q) ? '' : ' bad');
      const h = document.createElement('div'); h.className = 'sd-pv-head';
      const num = document.createElement('span'); num.className = 'sd-pv-n'; num.textContent = i + 1;
      const t = document.createElement('span'); t.className = 'sd-pv-text'; t.textContent = q.question.trim() || 'No question';
      h.append(num, t);
      li.appendChild(h);
      if (!qDone(q)) {
        const w = document.createElement('p'); w.className = 'sd-pv-warn';
        w.textContent = q.question.trim() ? 'No answers yet: this one won’t be added' : 'No question: this one won’t be added';
        li.appendChild(w);
        return li;
      }
      const ol = document.createElement('ol'); ol.className = 'sd-pv-ans' + (q.auto ? ' auto' : '');
      q.answers.filter((a) => a.text.trim()).forEach((a) => {
        const r = document.createElement('li');
        const at = document.createElement('span'); at.textContent = a.text;
        const ap = document.createElement('b'); ap.textContent = a.points;
        r.append(at, ap); ol.appendChild(r);
      });
      li.appendChild(ol);
      if (q.auto) { const p = document.createElement('p'); p.className = 'sd-pv-auto'; p.textContent = 'Points filled in for you'; li.appendChild(p); }
      return li;
    }));
  }
  // what's in the box joins the set
  function addPasted() {
    if (!canEdit()) return false;
    const { questions, extra } = parseGame($('sd-paste-text').value);
    const found = questions.filter(qDone);
    if (!found.length) return false;
    found.forEach((q) => { q.id = newId(); });
    dropBlank();
    ed.questions.push(...found);
    ed.extra = extra;
    $('sd-paste-text').value = '';
    paintEditor();
    flashEd(`Added ${found.length} question${found.length === 1 ? '' : 's'}. See ${found.length === 1 ? 'it' : 'them'} on Write questions.${extra ? ` ${extra} answer${extra === 1 ? '' : 's'} left out (8 per question).` : ''}`);
    scheduleSave();
    askName(() => $('sd-paste-text').focus());
    return true;
  }

  // ---------- the write tab ----------
  // a totally empty question is dropped when you leave it (unless it's the only one)
  function dropBlank() {
    const q = ed && ed.questions[cur];
    if (q && qBlank(q) && ed.questions.length > 1) {
      ed.questions.splice(cur, 1);
      cur = Math.min(cur, ed.questions.length - 1);
    }
  }
  // how many answer rows to show: three to start, one empty row after the
  // last filled one, never more than 8
  function rowCount(q) {
    let last = -1;
    q.answers.forEach((a, j) => { if (a.text.trim()) last = j; });
    return Math.min(SLOTS, Math.max(3, last + 2));
  }
  function paintWrite() {
    const ro = !canEdit();
    const qs = ed.questions;
    cur = Math.max(0, Math.min(cur, qs.length - 1));
    const q = qs[cur];
    // the questions so far
    $('sd-wq-list').replaceChildren(...qs.map((x, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sd-wq-item'; b.dataset.go = i;
      if (i === cur) b.setAttribute('aria-current', 'true');
      const n = document.createElement('span'); n.className = 'sd-wq-item-n'; n.textContent = i + 1;
      const t = document.createElement('span'); t.className = 'sd-wq-item-t'; t.textContent = x.question.trim() || 'New question';
      if (!x.question.trim()) t.classList.add('blank');
      b.append(n, t);
      if (!qDone(x) && !qBlank(x)) { const w = document.createElement('span'); w.className = 'sd-wq-item-warn'; w.title = x.question.trim() ? 'Needs an answer' : 'Needs a question'; b.appendChild(w); b.title = w.title; }
      li.appendChild(b);
      return li;
    }));
    $('sd-wq-new').hidden = ro;
    const main = $('sd-wq-main');
    main.hidden = !q;
    if (!q) return;
    $('sd-wq-count').textContent = `Question ${cur + 1} of ${qs.length}`;
    $('sd-wq-prev').disabled = cur <= 0;
    $('sd-wq-next').disabled = cur >= qs.length - 1;
    const qt = $('sd-wq-q');
    if (document.activeElement !== qt) qt.value = q.question;
    qt.disabled = ro;
    fitText(qt);
    paintAnswers();
    $('sd-wq-auto').checked = !!q.auto;
    $('sd-wq-auto').disabled = ro;
    $('sd-wq-play').hidden = !ed.id || !qDone(q);
    $('sd-wq-dup').hidden = $('sd-wq-del').hidden = ro || qBlank(q);
    $('sd-wq-another').hidden = $('sd-wq-done').hidden = ro;
  }
  // one answer row: number, text, points, and × once it has text
  function answerRow(j) {
    const ro = !canEdit();
    const q = ed.questions[cur];
    const a = q.answers[j] || { text: '', points: null };
    const li = document.createElement('li'); li.className = 'sd-wq-a'; li.dataset.a = j;
    const num = document.createElement('span'); num.className = 'sd-wq-a-n'; num.textContent = j + 1;
    const t = document.createElement('input'); t.type = 'text'; t.className = 'sd-wq-a-text'; t.maxLength = 60; t.value = a.text; t.disabled = ro;
    t.placeholder = j === 0 ? 'The most popular answer' : j === 1 ? 'The next most popular' : 'Another answer';
    t.setAttribute('aria-label', `Answer ${j + 1}`);
    const p = document.createElement('input'); p.type = 'number'; p.className = 'sd-wq-a-pts' + (q.auto ? ' auto' : '');
    p.min = 0; p.max = 999; p.inputMode = 'numeric'; p.placeholder = 'pts'; p.disabled = ro;
    p.value = a.text.trim() && a.points != null ? a.points : '';
    p.setAttribute('aria-label', `Points for answer ${j + 1}`);
    const x = document.createElement('button'); x.type = 'button'; x.className = 'sd-wq-x'; x.dataset.rm = j;
    x.setAttribute('aria-label', `Remove answer ${j + 1}`); x.title = 'Remove'; x.textContent = '×';
    x.hidden = ro || !a.text.trim();
    li.append(num, t, p, x);
    return li;
  }
  function paintAnswers(focus) {
    const q = ed.questions[cur];
    const ol = $('sd-wq-ans');
    ol.replaceChildren(...Array.from({ length: rowCount(q) }, (_, j) => answerRow(j)));
    if (focus) {
      const el = ol.querySelector(`[data-a="${focus.a}"] ${focus.sel || '.sd-wq-a-text'}`);
      if (el) { el.focus(); if (focus.caret != null && el.setSelectionRange) el.setSelectionRange(focus.caret, focus.caret); }
    }
  }
  // while typing: rows are added or taken off the end, never rebuilt, so the
  // box being typed in stays put
  function syncRows() {
    const q = ed.questions[cur];
    const ol = $('sd-wq-ans');
    const want = rowCount(q);
    let have = ol.children.length;
    while (have < want) ol.appendChild(answerRow(have++));
    while (have > want && !ol.lastElementChild.contains(document.activeElement)) { ol.lastElementChild.remove(); have--; }
    [...ol.children].forEach((li) => { const a = q.answers[+li.dataset.a]; li.querySelector('.sd-wq-x').hidden = !canEdit() || !(a && a.text.trim()); });
  }
  const firstEmptyAnswer = () => [...$('sd-wq-ans').querySelectorAll('.sd-wq-a-text')].find((i) => !i.value.trim()) || null;
  // the bits of the write tab that follow a keystroke without a repaint
  function patchWrite() {
    const q = ed.questions[cur];
    $('sd-wq-ans').querySelectorAll('.sd-wq-a').forEach((li) => {
      const a = q.answers[+li.dataset.a];
      const p = li.querySelector('.sd-wq-a-pts');
      if (document.activeElement !== p) p.value = a && a.text.trim() && a.points != null ? a.points : '';
      p.classList.toggle('auto', !!q.auto);
    });
    $('sd-wq-auto').checked = !!q.auto;
    const item = $('sd-wq-list').querySelector(`[data-go="${cur}"]`);
    if (item) {
      const t = item.querySelector('.sd-wq-item-t');
      t.textContent = q.question.trim() || 'New question'; t.classList.toggle('blank', !q.question.trim());
      const warn = !qDone(q) && !qBlank(q);
      let w = item.querySelector('.sd-wq-item-warn');
      if (warn && !w) { w = document.createElement('span'); w.className = 'sd-wq-item-warn'; item.appendChild(w); }
      if (!warn && w) w.remove();
      item.title = warn ? (q.question.trim() ? 'Needs an answer' : 'Needs a question') : '';
    }
    $('sd-wq-play').hidden = !ed.id || !qDone(q);
    $('sd-wq-dup').hidden = $('sd-wq-del').hidden = qBlank(q);
    paintTabs();
  }
  function edited() {
    ed.extra = 0;
    paintPlay();
    scheduleSave();
  }
  function openQ(i, focusQ) {
    if (i < 0 || i >= ed.questions.length || i === cur) return;
    const leaving = ed.questions[cur];
    cur = i;
    if (leaving && qBlank(leaving) && ed.questions.length > 1) {
      const k = ed.questions.indexOf(leaving);
      ed.questions.splice(k, 1);
      if (k < cur) cur--;
    }
    paintWrite();
    if (focusQ && canEdit()) $('sd-wq-q').focus();
  }
  function newQuestion() {
    if (!canEdit()) return;
    dropBlank();
    ed.questions.push(blankQ());
    cur = ed.questions.length - 1;
    if (edView !== 'write') { edView = 'write'; paintView(); } else paintWrite();
    paintTabs();
    $('sd-wq-q').focus();
  }
  // "Save and add another": the open question has to be whole first
  function saveAndAnother() {
    if (!canEdit()) return;
    const q = ed.questions[cur];
    if (qBlank(q)) { $('sd-wq-q').focus(); return; }
    if (!q.question.trim()) { flashEd('Type the question first.'); $('sd-wq-q').focus(); return; }
    if (!q.answers.some((a) => a.text.trim())) { flashEd('Add at least one answer first.'); const a = firstEmptyAnswer(); if (a) a.focus(); return; }
    scheduleSave(); flushSave();
    const n = cur + 1;
    newQuestion();
    flashEd(`Question ${n} saved.`);
    askName(() => $('sd-wq-q').focus());
  }
  function onWriteInput(e) {
    const t = e.target;
    if (!canEdit() || !t.closest('#sd-write')) return;
    const q = ed.questions[cur];
    if (!q) return;
    if (t.id === 'sd-wq-q') { q.question = t.value.replace(/\n/g, ' ').slice(0, 300); fitText(t); patchWrite(); edited(); return; }
    if (t.id === 'sd-wq-auto') { q.auto = t.checked; if (q.auto) fillPoints(q); patchWrite(); edited(); return; }
    const row = t.closest('[data-a]');
    if (!row) return;
    const j = +row.dataset.a;
    while (q.answers.length <= j) q.answers.push({ text: '', points: null });
    const a = q.answers[j];
    if (t.classList.contains('sd-wq-a-text')) {
      a.text = t.value.slice(0, 60);
      if (q.auto) fillPoints(q);
      syncRows();   // one more row as the last one fills
    } else {
      a.points = t.value === '' ? null : Math.max(0, Math.min(999, Math.round(+t.value) || 0));
      q.auto = false;
    }
    patchWrite();
    edited();
  }
  function removeAnswer(j, focusPrev) {
    const q = ed.questions[cur];
    if (!q || j >= q.answers.length) return;
    q.answers.splice(j, 1);
    if (q.auto) fillPoints(q);
    paintAnswers({ a: Math.max(0, focusPrev ? j - 1 : j), caret: focusPrev ? 999 : 0 });
    patchWrite();
    edited();
  }
  // Enter in the question goes to the answers; Enter in an answer moves to the
  // next row (Enter in an empty row, once there's an answer, is "Save and add
  // another"); Backspace in an empty row goes back up; ↑ ↓ move between rows
  function onWriteKey(e) {
    const t = e.target;
    if (!canEdit() || !t.closest || !t.closest('#sd-write')) return;
    if (t.id === 'sd-wq-q' && e.key === 'Enter') {
      e.preventDefault();
      const a = $('sd-wq-ans').querySelector('.sd-wq-a-text'); if (a) a.focus();
      return;
    }
    const row = t.closest('[data-a]');
    if (!row) return;
    const j = +row.dataset.a;
    const inputs = [...$('sd-wq-ans').querySelectorAll(t.classList.contains('sd-wq-a-pts') ? '.sd-wq-a-pts' : '.sd-wq-a-text')];
    const q = ed.questions[cur];
    if (e.key === 'Enter') {
      e.preventDefault();
      if (t.classList.contains('sd-wq-a-text') && !t.value.trim() && q.answers.some((a) => a.text.trim())) { saveAndAnother(); return; }
      const next = $('sd-wq-ans').querySelector(`[data-a="${j + 1}"] .sd-wq-a-text`);
      if (next) next.focus(); else if (j >= SLOTS - 1) $('sd-wq-another').focus();
    } else if (e.key === 'ArrowDown' && inputs[j + 1]) { e.preventDefault(); inputs[j + 1].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (inputs[j - 1]) inputs[j - 1].focus(); else if (t.classList.contains('sd-wq-a-text')) $('sd-wq-q').focus(); }
    else if (e.key === 'Backspace' && t.classList.contains('sd-wq-a-text') && !t.value && j > 0) {
      e.preventDefault();
      if (j < q.answers.length) removeAnswer(j, true);
      else { const prev = inputs[j - 1]; prev.focus(); prev.setSelectionRange(prev.value.length, prev.value.length); }
    }
  }
  function onWriteClick(e) {
    const go = e.target.closest('[data-go]');
    if (go) { openQ(+go.dataset.go, true); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm && canEdit()) removeAnswer(+rm.dataset.rm, false);
  }
  function dupQuestion() {
    if (!canEdit()) return;
    const c = clone(ed.questions[cur]); c.id = newId();
    ed.questions.splice(cur + 1, 0, c);
    cur++;
    paintWrite(); paintTabs();
    $('sd-wq-q').focus(); $('sd-wq-q').select();
    edited();
    flashEd(`Duplicated as question ${cur + 1}.`);
  }
  function delQuestion() {
    if (!canEdit()) return;
    const q = ed.questions[cur];
    if (!qBlank(q) && !confirm(`Delete question ${cur + 1}${q.question.trim() ? `, "${q.question.trim()}"` : ''}?`)) return;
    ed.questions.splice(cur, 1);
    if (!ed.questions.length) ed.questions.push(blankQ());
    cur = Math.min(cur, ed.questions.length - 1);
    paintWrite(); paintTabs();
    edited();
  }
  const fitText = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  function showPaste() {
    if (!canEdit()) return;
    showTab('paste', true);
  }

  // ---------- the set's name ----------
  // The title is the name: click it (the whole name selects) and type.
  function renaming(on) {
    if (on && canEdit()) { const t = $('sd-set-name'); t.focus(); t.select(); }
  }
  function finishRename(keep) {
    const t = $('sd-set-name');
    if (!ed || t.disabled) return;
    const v = t.value.trim().slice(0, 60);
    if (!keep || !v) { t.value = ed.unnamed ? '' : ed.name; return; }
    if (!ed.unnamed && v === ed.name) return;
    ed.name = v; ed.unnamed = false; ed.asked = true;
    t.value = v;
    paintPick();
    if (ed.id || cleanQuestions(ed.questions).length) scheduleSave();
  }

  // Asked once, when an unnamed set gets its first questions: a small prompt
  // under the title with a name suggested from the first question.
  let askAfter = null;
  const askOpen = () => !$('sd-name-ask').hidden;
  function hideAsk() { $('sd-name-ask').hidden = true; askAfter = null; }
  function askName(after) {
    if (!canEdit() || !ed.unnamed || ed.asked || !cleanQuestions(ed.questions).length) return false;
    ed.asked = true;
    askAfter = after || null;
    const sug = suggestName(ed.questions);
    const inp = $('sd-name-ask-in');
    inp.value = sug ? uniqueName(sug) : '';
    $('sd-name-ask-hint').textContent = sug ? 'Suggested from your first question' : '';
    $('sd-name-ask').hidden = false;
    inp.focus(); inp.select();
    return true;
  }
  function finishAsk(save) {
    if (!askOpen()) return;
    const v = $('sd-name-ask-in').value.trim().slice(0, 60);
    const after = askAfter;
    hideAsk();
    if (save && v) { ed.name = v; ed.unnamed = false; }
    else if (!ed.name.trim()) ed.name = uniqueName('Untitled set');
    paintPick();
    scheduleSave();
    if (after) after(); else focusTab();
  }

  // A name from the first question's topic: a name in it ("Macbeth"), else
  // the short thing it asks for ("Name a fruit" → Fruit), else what follows
  // its first in / on / at / about ("…in your backpack" → Backpack).
  const STOP = new Set('a an the some any one something someone somewhere thing things that you your yours they their people person students student most most popular common might would could should can do does did is are was were be to of and or for with from by as it its this these those what which who whom whose when where why how many much often usually likely ever'.split(' '));
  const GENERIC = new Set('thing things word words reason reasons way ways place places item items kind type sort example time times job jobs'.split(' '));
  function suggestName(questions) {
    const q = (questions || []).find((x) => x.question && x.question.trim());
    if (!q) return '';
    const text = q.question.replace(/^\s*(we asked [^:.?]*[:.]\s*)/i, '').replace(/["“”]/g, '').trim();
    // a proper name, not at the start of the sentence: "Macbeth",
    // "Romeo and Juliet", "Lord of the Flies"
    const words = text.split(/\s+/).map((w) => w.replace(/[^A-Za-z'’-]/g, ''));
    const cap = (w) => /^[A-Z][a-z'’-]+$/.test(w || '');
    for (let i = 1; i < words.length; i++) {
      if (!cap(words[i]) || words[i].length < 3) continue;
      const out = [words[i]];
      let j = i + 1;
      while (j < words.length) {
        if (cap(words[j])) { out.push(words[j]); j++; continue; }
        if (/^(and|of|the)$/.test(words[j])) {
          let k = j; const glue = [];
          while (k < words.length && /^(and|of|the)$/.test(words[k])) glue.push(words[k++]);
          if (cap(words[k])) { out.push(...glue, words[k]); j = k + 1; continue; }
        }
        break;
      }
      return out.join(' ').slice(0, 40);
    }
    let t = text.toLowerCase().replace(/[?.!,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
    t = t.replace(/^(name|list|give|tell (me|us)?|think of|guess)\s+/, '')
      .replace(/^(a|an|one|the|some|something|someone|somewhere|a thing|things|anything)\s+/, '');
    const content = (str) => str.split(' ').filter((w) => w && !STOP.has(w) && !/^(means?|meant|keep|kept|see|sees|saw|find|found|get|gets|got|use|uses|used|make|makes|made|say|says|said|go|goes|went|like|likes|want|wants|need|needs)$/.test(w));
    const title = (ws) => ws.join(' ').replace(/(^|\s)\S/g, (m) => m.toUpperCase()).slice(0, 40);
    const all = t.split(' ');
    // what it asks for, up to the first "that / you / a student …"
    const headEnd = all.findIndex((w, i) => i > 0 && /^(that|which|who|you|your|people|a|an|the|students?|someone|might|would|could|should|in|on|at|to|for|about|during|when|where|with)$/.test(w));
    const head = content((headEnd < 0 ? all : all.slice(0, headEnd)).join(' '));
    const generic = head.length === 1 && GENERIC.has(head[0]);
    // short and specific: "a fruit", "a school subject", "a pizza topping"
    if (head.length && head.length <= 3 && !generic) return title(head);
    // else the object of the first in / on / at / to / about …
    const m = t.match(/\b(in|on|at|to|about|during|inside|around)\s+(.+)$/);
    if (m) { const obj = content(m[2].split(/\b(?:in|on|at|to|about|during|inside|around)\b/)[0]).slice(0, 2); if (obj.length) return title(obj); }
    // else what comes after a generic head: "a word that means brave" → Brave
    const rest = content(all.slice(headEnd < 0 ? all.length : headEnd).join(' ')).slice(0, 2);
    if (rest.length) return title(rest);
    return head.length ? title(head.slice(0, 2)) : '';
  }
  window.__showdownSuggest = suggestName;

  // ---------- autosave ----------
  let saveTimer = 0, pending = false, saving = Promise.resolve();
  function scheduleSave() {
    if (!canEdit()) return;
    pending = true;
    paintSave('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 700);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    if (!pending) return saving;
    pending = false;
    saving = saving.then(saveNow, saveNow);
    return saving;
  }
  async function saveNow() {
    const draft = ed;
    if (!draft || draft.readonly) return;
    const questions = cleanQuestions(draft.questions);
    if (!draft.id && !questions.length) { paintSave(''); return; }   // nothing to keep yet
    if (!draft.id && draft.unnamed && askOpen()) { pending = true; paintSave(''); return; }   // the name comes first
    if (!draft.name.trim()) draft.name = uniqueName('Untitled set');
    const name = draft.name.trim();
    try {
      let row;
      if (draft.id) row = await updateSurveySet(draft.id, { name, questions });
      else { row = await createSurveySet({ name, questions, sortOrder: sets.length }); draft.id = row.id; }
      const set = normSet(row);
      const i = sets.findIndex((s) => s.id === set.id);
      if (i >= 0) sets[i] = set; else sets.push(set);
      if (ed === draft && !pending) paintSave('Saved', 'ok');
      if (ed === draft) {
        paintPick();
        $('sd-set-dup').disabled = $('sd-set-del').disabled = false;
        $('sd-play-set').disabled = !questions.length;
      }
      fillGameSelect();
      useSet();
      commit();
    } catch (err) {
      paintSave(`Not saved: ${err.message || err}`, 'error');
    }
  }

  // ---------- sets in the editor ----------
  async function switchSet(id) {
    await flushSave();
    if (id === '__new') {
      if (!bankReady) return;
      loadDraft(null);
      $('sd-paste-text').focus();
      return;
    }
    const s = sets.find((x) => x.id === id);
    if (s) loadDraft(s);
  }
  async function duplicateSet() {
    if (!ed.id) return;
    await flushSave();
    try {
      const src = sets.find((s) => s.id === ed.id);
      const row = await createSurveySet({ name: uniqueName(`${src.name} (copy)`.slice(0, 60)), questions: clone(src.questions), sortOrder: sets.length });
      sets.push(normSet(row));
      fillGameSelect();
      loadDraft(sets[sets.length - 1]);
      paintSave('Duplicated. This is the copy.', 'ok');
    } catch (err) { paintSave(`Couldn't duplicate: ${err.message || err}`, 'error'); }
  }
  async function deleteSet() {
    if (!ed.id) return;
    const s = sets.find((x) => x.id === ed.id);
    const n = s ? s.questions.length : 0;
    if (!confirm(`Delete the set "${ed.name}"${n ? ` and its ${n} question${n === 1 ? '' : 's'}` : ''}? This can't be undone.`)) return;
    clearTimeout(saveTimer); pending = false;
    await saving;
    try {
      await deleteSurveySet(ed.id);
      sets = sets.filter((x) => x.id !== ed.id);
      fillGameSelect();
      useSet();
      commit();
      loadDraft(sets[0] || null);
      paintSave('Deleted.', 'ok');
    } catch (err) { paintSave(`Couldn't delete: ${err.message || err}`, 'error'); }
  }
  async function closeEditor() {
    finishRename(true);
    if (askOpen()) finishAsk(true);                       // closing keeps the name in the box
    else if (askName(() => closeEditor())) return;         // asked once, before it's saved as "Untitled set"
    await flushSave();
    editor.close();
  }
  // play the open set, from its first question or from the one given
  async function playFromEditor(qid) {
    if (askOpen()) finishAsk(true);
    else if (askName(() => playFromEditor(qid))) return;
    await flushSave();
    if (!ed.id) return;
    const at = qid ? Math.max(0, playingSetById(ed.id).questions.findIndex((x) => x.id === qid)) : 0;
    if (!qid && st.setId === ed.id) { editor.close(); setup.close(); return; }
    playSet(ed.id, at);
    editor.close();
    setup.close();
  }
  const playingSetById = (id) => sets.find((s) => s.id === id) || { questions: [] };
  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    const was = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = was; }, 1600);
  }

  // ---------- Game setup ----------
  // Everything before the game, one section at a time: Questions (pick a
  // set, make one, edit one), Get questions with AI (four steps and a paste
  // box), Teams, How to play. "Start the game" is always at the bottom.
  const setup = $('sd-setup');
  let setupSec = 'questions';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function showSection(sec, focus) {
    setupSec = sec;
    setup.querySelectorAll('.gh-nav [data-sec]').forEach((b) => { if (b.dataset.sec === sec) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    setup.querySelectorAll('.gh-sec').forEach((el) => { el.hidden = el.dataset.sec !== sec; });
    setup.querySelector('.gh-main').scrollTop = 0;
    if (sec === 'teams') paintTeamsDialog();
    if (focus) { const h = setup.querySelector(`.gh-sec[data-sec="${sec}"] h3`); if (h) h.focus(); }
  }
  async function openSetup(sec = 'questions') {
    paintSetup();
    $('sd-split-note').textContent = '';
    if (!setup.open) setup.showModal();
    showSection(sec, true);
    try {
      const periods = (typeof navReady !== 'undefined' ? (await navReady).periods : null) || await getPeriods();
      const sel = $('sd-period');
      if (!sel.options.length) fillPeriodSelect(sel, periods);
    } catch (err) { showError(err); }
  }
  function setupFlash(text) {
    const el = $('sd-gh-flash');
    el.textContent = text;
    clearTimeout(setupFlash.t);
    setupFlash.t = setTimeout(() => { el.textContent = ''; }, 6000);
  }
  function paintSetup() {
    const cur = playingSet();
    const cards = [];
    const list = sets.length ? sets : [fallbackSet];
    for (const set of list) {
      const n = set.questions.length;
      const on = set.id === cur.id;
      const builtin = set === fallbackSet;
      const card = document.createElement('article');
      card.className = 'gh-card' + (on ? ' on' : '');
      const name = document.createElement('b'); name.className = 'gh-card-name';
      name.textContent = builtin && bankReady ? 'Starter questions' : set.name;
      const meta = document.createElement('span'); meta.className = 'gh-card-n';
      meta.textContent = n ? plural(n, 'question') : 'No questions yet';
      card.append(name, meta);
      const acts = document.createElement('div'); acts.className = 'gh-card-acts';
      const use = document.createElement('button'); use.type = 'button'; use.className = 'primary gh-big'; use.dataset.use = set.id;
      use.textContent = on ? '✓ Playing now' : 'Use this set';
      use.disabled = on || !n;
      acts.appendChild(use);
      if (!builtin && bankReady) {
        const editB = document.createElement('button'); editB.type = 'button'; editB.dataset.edit = set.id;
        editB.textContent = n ? 'Edit' : 'Add questions';
        acts.appendChild(editB);
      }
      card.appendChild(acts);
      cards.push(card);
    }
    if (bankReady) {
      const add = document.createElement('div'); add.className = 'gh-card gh-new';
      add.innerHTML = '<b class="gh-card-name">Make a new set</b><div class="gh-card-acts"><button type="button" class="gh-big" data-new>+ Make a new set</button><button type="button" class="gh-link" data-goto="ai">Or get questions with AI</button></div>';
      cards.push(add);
    }
    $('sd-gh-cards').replaceChildren(...cards);
    $('sd-gh-note').textContent = bankReady ? (sets.length ? '' : 'You don\'t have any questions of your own yet. Make a set below, or play the starter questions to try the game.')
      : 'Saving your own questions isn\'t switched on yet (ask whoever set up TeacherPal to run migration-feud-sets.sql). Until then you can play these.';
    paintAi();
    paintSummary();
  }
  function paintSummary() {
    const cur = playingSet();
    $('sd-gh-summary').textContent = `${cur === fallbackSet && bankReady ? 'Starter questions' : cur.name} · ${plural(cur.questions.length, 'question')} · ${st.teams[0].name} vs ${st.teams[1].name}`;
    $('sd-gh-start').disabled = !cur.questions.length;
  }
  function aiFound() { return parseGame($('sd-gh-text').value).questions.filter(qDone); }
  function paintAi() {
    const n = aiFound().length;
    const has = !!$('sd-gh-text').value.trim();
    const msg = $('sd-gh-msg');
    if (!bankReady) { msg.textContent = 'Saving questions isn\'t switched on yet, so this box can\'t save them.'; msg.dataset.kind = 'error'; }
    else if (!has) { msg.textContent = ''; msg.dataset.kind = ''; }
    else if (n) { msg.textContent = `Found ${plural(n, 'question')}. Give them a name and save.`; msg.dataset.kind = 'ok'; }
    else { msg.textContent = 'No questions found yet. Each question needs its answers on the lines under it.'; msg.dataset.kind = 'error'; }
    const btn = $('sd-gh-save');
    btn.disabled = !n || !bankReady;
    btn.textContent = n ? `Save these ${plural(n, 'question')}` : 'Save these questions';
  }
  async function saveAi() {
    const found = aiFound();
    if (!found.length || !bankReady) return;
    found.forEach((q) => { q.id = newId(); });
    const name = $('sd-gh-name').value.trim().slice(0, 60) || uniqueName(suggestName(found) || 'Untitled set');
    const btn = $('sd-gh-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const row = await createSurveySet({ name, questions: cleanQuestions(found), sortOrder: sets.length });
      const set = normSet(row);
      sets.push(set);
      playSet(set.id);
      $('sd-gh-text').value = ''; $('sd-gh-name').value = '';
      paintSetup();
      showSection('questions', true);
      setupFlash(`Saved "${set.name}" with ${plural(set.questions.length, 'question')}. It's ready to play.`);
    } catch (err) {
      $('sd-gh-msg').textContent = `Couldn't save them: ${err.message || err}`; $('sd-gh-msg').dataset.kind = 'error';
      paintAi();
    }
  }
  function onSetupClick(e) {
    const nav = e.target.closest('.gh-nav [data-sec]');
    if (nav) { showSection(nav.dataset.sec, true); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { showSection(go.dataset.goto, true); return; }
    const use = e.target.closest('[data-use]');
    if (use) {
      const set = sets.find((x) => x.id === use.dataset.use) || (fallbackSet.id === use.dataset.use ? fallbackSet : null);
      if (set && set !== fallbackSet) { playSet(set.id); paintSetup(); setupFlash(`Now playing "${set.name}".`); }
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const set = sets.find((x) => x.id === edit.dataset.edit);
      if (!set) return;
      loadDraft(set);
      editor.showModal();
      focusTab();
      return;
    }
    if (e.target.closest('[data-new]')) {
      editor.showModal();
      switchSet('__new');
    }
  }


  // ---------- the start screen ----------
  // Where the game opens (main tab only): the saved question sets as cards, the
  // teams, and one big Start (Resume when a game is in progress). The board
  // stays covered (and inert) until then.
  const PLAYED_KEY = 'teacherpal.showdown.played';
  const startEl = $('sd-start');
  const pageEl = startEl.parentElement;
  let startOn = true;
  let selId = null;            // the card picked here (null: the one playing)
  let listLoaded = false;
  const played = () => { try { return JSON.parse(localStorage.getItem(PLAYED_KEY) || '{}') || {}; } catch { return {}; } };
  function markPlayed(id) { const m = played(); m[id] = Date.now(); try { localStorage.setItem(PLAYED_KEY, JSON.stringify(m)); } catch { /* ignore */ } }
  function ago(ms) {
    if (!ms) return 'Not played yet';
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const n = Math.round((day(new Date()) - day(new Date(ms))) / 86400000);
    if (n <= 0) return 'Played today';
    if (n === 1) return 'Played yesterday';
    if (n < 7) return `Played ${n} days ago`;
    return `Played ${new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  function setStart(on) {
    startOn = on;
    startEl.hidden = !on;
    pageEl.classList.toggle('starting', on);
    for (const el of pageEl.children) if (el !== startEl && el.id !== 'status') el.inert = on;
    if (on) { selId = null; paintStart(); $('sd-gs-go').focus({ preventScroll: true }); }
  }
  function paintStart() {
    if (!startOn) return;
    const list = (sets.length ? sets : [fallbackSet]);
    const cur = playingSet();
    if (!selId || !list.some((x) => x.id === selId)) selId = cur ? cur.id : (list[0] ? list[0].id : null);
    const wrap = $('sd-gs-cards');
    const m = played();
    if (!listLoaded) {
      const p = document.createElement('p'); p.className = 'gs-empty'; p.textContent = 'Loading your question sets…';
      wrap.replaceChildren(p);
    } else if (bankReady && !sets.length) {
      const item = document.createElement('div'); item.className = 'gs-item gs-first'; item.setAttribute('role', 'listitem');
      item.innerHTML = '<button type="button" class="gs-card gs-new" data-new><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><b>Make your first set</b><span class="gs-new-sub">Or press Start to try the starter questions.</span></button>';
      wrap.replaceChildren(item);
    } else {
      const cards = list.map((x) => {
        const item = document.createElement('div'); item.className = 'gs-item'; item.setAttribute('role', 'listitem');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'gs-card'; b.dataset.id = x.id;
        b.setAttribute('aria-pressed', String(x.id === selId));
        const n = document.createElement('b'); n.className = 'gs-card-name'; n.textContent = x === fallbackSet && bankReady ? 'Starter questions' : x.name;
        const c = document.createElement('span'); c.className = 'gs-card-n'; c.textContent = `${x.questions.length} question${x.questions.length === 1 ? '' : 's'}`;
        const w = document.createElement('span'); w.className = 'gs-card-when'; w.textContent = ago(m[x.id]);
        b.append(c, n, w); b.title = n.textContent;
        item.append(b);
        if (!(x.questions.length)) { b.disabled = true; w.textContent = 'Empty'; }
        if (bankReady && x !== fallbackSet) {
          const pen = document.createElement('button'); pen.type = 'button'; pen.className = 'gs-edit'; pen.dataset.edit = x.id;
          pen.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
          pen.title = `Edit "${n.textContent}"`; pen.setAttribute('aria-label', pen.title);
          item.append(pen);
        }
        return item;
      });
      if (bankReady) {
        const add = document.createElement('div'); add.className = 'gs-item'; add.setAttribute('role', 'listitem');
        add.innerHTML = '<button type="button" class="gs-card gs-new" data-new><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><b>New set</b></button>';
        cards.push(add);
      }
      wrap.replaceChildren(...cards);
    }
    // the teams: names you can type over, and who's on them
    const row = $('sd-gs-teams');
    if (row.children.length !== st.teams.length) {
      row.replaceChildren(...st.teams.map((t, k) => {
        const plate = document.createElement('label'); plate.className = 'gs-team';
        const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 30; inp.dataset.k = k;
        inp.setAttribute('aria-label', `Team ${k + 1} name`); inp.title = 'Click to rename';
        const sub = document.createElement('span'); sub.className = 'gs-team-sub';
        plate.append(inp, sub);
        return plate;
      }));
      row.dataset.n = st.teams.length;
    }
    st.teams.forEach((t, k) => {
      const plate = row.children[k];
      const inp = plate.querySelector('input');
      if (document.activeElement !== inp) inp.value = t.name;
      plate.querySelector('.gs-team-sub').textContent = t.members.length ? `${t.members.length} student${t.members.length === 1 ? '' : 's'}` : 'Click the name to rename';
    });
    // in progress? Resume first, so last period's game is never wiped by accident
    const going = inProgress();
    const same = !!cur && selId === cur.id;
    const go = $('sd-gs-go'), second = $('sd-gs-second'), note = $('sd-gs-progress'), pwrap = $('sd-gs-pwrap');
    const own = sets.length;
    $('sd-gs-count').textContent = listLoaded && own ? `${own} set${own === 1 ? '' : 's'}` : '';
    const selItem = list.find((x) => x.id === selId);
    go.disabled = !listLoaded || !selItem || !((selItem && selItem.questions.length) || (bankReady && !sets.length));
    if (going && same) {
      go.textContent = 'Resume game';
      pwrap.hidden = false; second.textContent = 'Start over';
      note.textContent = `Game in progress: ${progressText()}`;
    } else if (going) {
      go.textContent = 'Start game';
      pwrap.hidden = false; second.textContent = 'Resume that game';
      note.textContent = `Starting ends the game in progress: ${progressText()}`;
    } else {
      go.textContent = 'Start game';
      pwrap.hidden = true;
      note.textContent = '';
    }
  }
  function startGo(fresh) {
    const cur = playingSet();
    const id = selId || (cur && cur.id);
    if (!id) return;
    if (fresh || !cur || id !== cur.id) startNew(id);
    markPlayed(id);
    setStart(false);
    
  }
  function inProgress() { return st.teams.some((t) => t.score) || st.pot > 0 || st.strikes > 0 || st.revealed.some(Boolean) || st.qIndex > 0; }
  function progressText() {
    const s = playingSet();
    return `${st.teams[0].name} ${st.teams[0].score} – ${st.teams[1].score} ${st.teams[1].name}, question ${st.qIndex + 1} of ${s.questions.length}${st.pot > 0 ? `, ${st.pot} points in play` : ''}`;
  }
  // a new game on this set: question 1, scores back to 0, the teams kept
  function startNew(id) {
    act(() => {
      st.setId = id; Object.assign(st, freshRound()); st.qIndex = 0; st.questionId = null;
      st.teams.forEach((t) => { t.score = 0; });
      useSet(); st.qIndex = 0;
    });
  }

  // ---------- load the sets ----------
  async function loadSets() {
    const note = $('sd-editor-note');
    try {
      const rows = await getSurveySets();
      bankReady = true;
      sets = rows.map(normSet);
      note.textContent = '';
    } catch (err) {
      bankReady = false;
      sets = [];
      const missing = /survey_sets|does not exist|schema cache|404/i.test(String(err && (err.message || err)));
      fallbackSet = STARTER_SET;
      if (missing) {
        // the old one-bank table, if this account has one
        try {
          const old = await getSurveyQuestions();
          if (old.length) fallbackSet = { id: 'bank', name: 'My questions', questions: old.map((r) => ({ id: r.id, question: r.question, answers: r.answers })) };
        } catch { /* not there either: the starter set */ }
      }
      note.textContent = missing
        ? 'Run migration-feud-sets.sql in Supabase to edit your questions and keep several sets. Until then they are read-only.'
        : `Couldn't load your questions (${err.message || err}).`;
      setStatus(missing ? 'Family Feud: run migration-feud-sets.sql in Supabase to edit your questions.' : 'Couldn\'t load your questions; playing the starter set.', missing ? 'info' : 'error');
    }
    listLoaded = true;
    useSet();
    fillGameSelect();
    commit();
    paintStart();
  }

  // ---------- wiring ----------
  buildStage($('sd-stage'));
  commit();
  paintMode();
  loadSets();

  $('sd-board').addEventListener('click', (e) => {
    const li = e.target.closest('.sd-slot');
    if (li) reveal(+li.dataset.i);
  });
  $('sd-stage').addEventListener('click', (e) => {
    const b = e.target.closest('[data-award]');
    if (b) award(+b.dataset.award);
  });
  $('sd-strike').addEventListener('click', strike);
  $('sd-undo').addEventListener('click', () => { if (undo.length) { st = JSON.parse(undo.pop()); commit(); } });
  $('sd-prev').addEventListener('click', () => goTo(st.qIndex - 1));
  $('sd-next').addEventListener('click', () => goTo(st.qIndex + 1));
  $('sd-reveal-all').addEventListener('click', revealAll);
  $('sd-reset').addEventListener('click', resetGame);

  const muteBtn = $('sd-mute');
  const paintMute = () => { muteBtn.setAttribute('aria-checked', String(muted)); muteBtn.title = muted ? 'Sound off' : 'Sound on'; };
  paintMute();
  muteBtn.addEventListener('click', () => { muted = !muted; localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); paintMute(); });

  function openProjector() {
    hostPref = null;   // host mode follows the window from here
    const w = window.open('showdown-popout.html', 'teacherpal-showdown', 'popup=yes,width=1100,height=700');
    if (w) w.focus();
    setTimeout(send, 400);
  }
  $('sd-popout').addEventListener('click', openProjector);
  const pipBtn = $('sd-pip');
  if ('documentPictureInPicture' in window) {
    pipBtn.hidden = false;
    pipBtn.addEventListener('click', async () => {
      let pip;
      try { pip = await window.documentPictureInPicture.requestWindow({ width: 440, height: 300 }); } catch { return; }
      const d = pip.document;
      d.body.style.cssText = 'margin:0;height:100vh;overflow:hidden;background:#000';
      const frame = d.createElement('iframe');
      frame.src = new URL('showdown-popout.html?mini=1', location.href).href;
      frame.title = 'Family Feud';
      frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
      frame.addEventListener('load', () => setTimeout(send, 100));
      d.body.appendChild(frame);
    });
  }
  if (bc) {
    bc.onmessage = (ev) => {
      const t = ev.data && ev.data.type;
      if (t === 'request-state') send();
      else if (t === 'here') { const was = projOn(); projAt = Date.now(); if (!was) paintMode(); }
      else if (t === 'bye') { projAt = 0; paintMode(); }
    };
  }
  setInterval(() => { if (projOn() !== shownProj) paintMode(); }, 1000);
  $('sd-host-btn').addEventListener('click', () => { hostPref = !hosting(); paintMode(); });
  $('sd-proj-open').addEventListener('click', openProjector);
  $('sd-host').addEventListener('click', (e) => {
    const a = e.target.closest('[data-reveal]');
    if (a) { reveal(+a.dataset.reveal); return; }
    const b = e.target.closest('[data-award]');
    if (b) award(+b.dataset.award);
  });

  // teams

  // start screen
  setStart(true);
  startEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit], [data-new]')) { onSetupClick(e); return; }
    const card = e.target.closest('.gs-card');
    if (card && !card.disabled) { selId = card.dataset.id; paintStart(); return; }
    const a = e.target.closest('[data-gs]');
    if (a) openSetup(a.dataset.gs === 'ai' ? 'ai' : 'questions');
  });
  startEl.addEventListener('dblclick', (e) => { const card = e.target.closest('.gs-card:not(.gs-new)'); if (card && !card.disabled) { selId = card.dataset.id; startGo(false); } });
  $('sd-gs-go').addEventListener('click', () => startGo(false));
  $('sd-gs-second').addEventListener('click', () => {
    const cur = playingSet();
    if (cur && selId === cur.id) startGo(true);       // Start over
    else { selId = cur ? cur.id : selId; startGo(false); }   // Resume the game in progress
  });
  $('sd-gs-setup').addEventListener('click', () => openSetup('questions'));
  $('sd-gs-howto').addEventListener('click', () => openSetup('howto'));
  $('sd-gs-roster').addEventListener('click', () => openSetup('teams'));
  $('sd-gs-teams').addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (k == null) return;
    st.teams[+k].name = e.target.value.trim().slice(0, 30) || `Team ${+k + 1}`;
    commit();
  });
  setup.addEventListener('close', () => { if (startOn) { selId = null; paintStart(); } });
  $('sd-setup-btn').addEventListener('click', () => openSetup(setupSec));
  $('sd-setup-close').addEventListener('click', () => setup.close());
  $('sd-gh-start').addEventListener('click', () => { const id = playingSet().id; setup.close(); if (startOn) { markPlayed(id); setStart(false); } });
  setup.addEventListener('click', onSetupClick);
  setup.addEventListener('close', () => { $('sd-setup-btn').focus(); });
  $('sd-gh-copy').addEventListener('click', (e) => copyText($('sd-gh-prompt').textContent, e.currentTarget));
  $('sd-gh-text').addEventListener('input', paintAi);
  $('sd-gh-save').addEventListener('click', saveAi);
  editor.addEventListener('close', () => { if (setup.open) paintSetup(); if (startOn) paintStart(); });
  $('sd-split').addEventListener('click', splitClass);
  $('sd-clear-members').addEventListener('click', () => { act(() => { st.teams.forEach((t) => { t.members = []; }); st.roster = null; }); paintTeamsDialog(); });
  $('sd-end').addEventListener('click', endGame);
  for (const k of [0, 1]) {
    $(`sd-name-${k}`).addEventListener('input', (e) => {
      st.teams[k].name = e.target.value.trim().slice(0, 30) || `Team ${k + 1}`;
      commit();
      paintTeamsDialog();
      paintSummary();
    });
    $(`sd-members-${k}`).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      act(() => {
        const [m] = st.teams[k].members.splice(+b.dataset.i, 1);
        st.teams[1 - k].members.push(m);
        st.teams[1 - k].members.sort((a, c) => a.localeCompare(c));
      });
      paintTeamsDialog();
    });
  }
  $('sd-period').addEventListener('change', (e) => setLastPeriodId(e.target.value));


  // editor
  $('sd-editor-close').addEventListener('click', closeEditor);
  editor.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (askOpen()) { finishAsk(false); return; }
    if ($('sd-set-menu').open) { $('sd-set-menu').open = false; return; }
    closeEditor();
  });
  editor.addEventListener('input', onWriteInput);
  editor.addEventListener('click', (e) => {
    // a click outside the ⋯ menu closes it
    const menu = $('sd-set-menu');
    if (menu.open && !e.target.closest('#sd-set-menu')) menu.open = false;
    onWriteClick(e);
  });
  editor.addEventListener('keydown', onWriteKey);
  // the tabs: click, or ← → between them
  $('sd-tab-paste').addEventListener('click', () => showTab('paste', true));
  $('sd-tab-write').addEventListener('click', () => showTab('write', true));
  editor.querySelector('.sd-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    showTab(edView === 'paste' ? 'write' : 'paste');
    $(edView === 'paste' ? 'sd-tab-paste' : 'sd-tab-write').focus();
  });
  $('sd-paste-text').addEventListener('input', paintFound);
  $('sd-paste-add').addEventListener('click', addPasted);
  $('sd-name-ask-ok').addEventListener('click', () => finishAsk(true));
  $('sd-name-ask-later').addEventListener('click', () => finishAsk(false));
  $('sd-name-ask-in').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishAsk(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishAsk(false); }
  });
  $('sd-starter').addEventListener('click', () => {
    if (!canEdit()) return;
    dropBlank();
    ed.questions.push(...clone(STARTER).map((x) => ({ ...x, id: newId(), auto: false })));
    paintEditor();
    flashEd('Added the 8 built-in questions. See them on Write questions.');
    scheduleSave();
    askName(() => $('sd-paste-text').focus());
  });
  $('sd-wq-new').addEventListener('click', newQuestion);
  $('sd-wq-prev').addEventListener('click', () => openQ(cur - 1));
  $('sd-wq-next').addEventListener('click', () => openQ(cur + 1));
  $('sd-wq-another').addEventListener('click', saveAndAnother);
  $('sd-wq-done').addEventListener('click', closeEditor);
  $('sd-wq-dup').addEventListener('click', dupQuestion);
  $('sd-wq-del').addEventListener('click', delQuestion);
  $('sd-wq-play').addEventListener('click', () => { const q = ed.questions[cur]; if (q) playFromEditor(q.id); });
  $('sd-set-pick').addEventListener('change', (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (v && v !== ed.id) switchSet(v);
  });
  $('sd-set-rename').addEventListener('click', () => { $('sd-set-menu').open = false; renaming(true); });
  // a click on the title selects the whole name, so typing replaces it
  $('sd-set-name').addEventListener('mousedown', (e) => {
    const t = e.currentTarget;
    if (document.activeElement !== t && !t.disabled) { e.preventDefault(); t.focus(); t.select(); }
  });
  $('sd-set-name').addEventListener('focus', (e) => e.currentTarget.select());
  $('sd-set-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishRename(true); e.currentTarget.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishRename(false); e.currentTarget.blur(); }
  });
  $('sd-set-name').addEventListener('blur', () => finishRename(true));
  $('sd-set-dup').addEventListener('click', () => { $('sd-set-menu').open = false; duplicateSet(); });
  $('sd-set-del').addEventListener('click', () => { $('sd-set-menu').open = false; deleteSet(); });
  $('sd-play-set').addEventListener('click', () => playFromEditor(null));
  $('sd-ai-copy').addEventListener('click', (e) => copyText($('sd-ai-prompt').textContent, e.currentTarget));

  // keys: 1-8 reveal, X strike, ← → question, Ctrl+Z undo
  document.addEventListener('keydown', (e) => {
    if (startOn || document.querySelector('dialog[open]') || isTyping(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('sd-undo').click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-8]$/.test(e.key)) { e.preventDefault(); reveal(+e.key - 1); }
    else if (e.key.toLowerCase() === 'x') { e.preventDefault(); strike(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(st.qIndex + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(st.qIndex - 1); }
  });

  window.__showdownParse = parseGame;
  window.__showdownPoints = autoPoints;   // for tests
})();
