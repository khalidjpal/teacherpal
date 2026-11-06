// Jeopardy: a category-and-value quiz game for two to four teams.
//
// One file, three windows (like Family Feud):
//   * the main tab (quiz.html): the only writer. Holds the saved boards
//     (Supabase, quiz_boards, through shared.js), the game state, the
//     controls, the board editor and the teams dialog; plays the sounds.
//   * the full screen window (quiz-popout.html) and the mini window (the same
//     page at ?mini=1, in a Picture-in-Picture iframe): read-only, drawn from
//     what the main tab sends on BroadcastChannel('teacherpal-quiz'). They
//     load no shared.js and never touch Supabase. They are sent the board
//     with every clue blanked out but the open one (and its answer only once
//     it is shown: redacted()), so nothing on the projector, not even its page
//     source, gives a clue or an answer away.
//   * host mode: while the full screen window is open (it says "here" every
//     2s) the main tab shows the host view instead of the board: every clue
//     and its answer, the open clue's controls and the scores. The Host view
//     switch overrides that either way.
//
// A board: { id, name, categories: [{ name, clues: [{ q, a, double }] x5 }] (up to 6) }.
// A clue's value is its row: 100..500, times the round (Round 2 doubles them).
//
// Game state (localStorage teacherpal.quiz.game, so a reload keeps the game):
//   { boardId, round: 1|2, used: { key: 1 }, results: { key: { v, r: { team: 1|-1 } } },
//     teams: [{ name, adjust, members: [label] }] (2-4),
//     open: null | { key, c, r, phase: 'wager'|'clue'|'answer', wagerTeam, wager, at } }
//   key = `${boardId}:${round}:${c}-${r}`. A team's score is its `adjust` (a
//   hand-set correction) plus every result: + or − the clue's value (or the
//   wager). Scores can go negative.
(function () {
  'use strict';

  const POPOUT = document.body.classList.contains('qb-popout');
  const MINI = POPOUT && new URLSearchParams(location.search).get('mini') === '1';
  const GAME_KEY = 'teacherpal.quiz.game';
  const MUTE_KEY = 'teacherpal.quiz.muted';
  const CATS = 6, ROWS = 5, MAX_TEAMS = 4;
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('teacherpal-quiz') : null;
  const $ = (id) => document.getElementById(id);
  const valueOf = (r, round) => (r + 1) * 100 * (round === 2 ? 2 : 1);

  // The sample board: what the game plays before migration-quiz-boards.sql has
  // been run, or while a teacher has no boards of their own (Duplicate it to
  // make an editable copy).
  const SAMPLE = {
    id: 'sample', name: 'Sample board', sample: true,
    categories: [
      ['Parts of speech', [
        ['The part of speech for a person, place, thing or idea.', 'Noun'],
        ['In "She ran quickly," the word "quickly."', 'Adverb'],
        ['Words like "and," "but" and "or."', 'Conjunctions'],
        ['In "under the bridge," the word "under."', 'Preposition'],
        ['"Wow!" and "Ouch!" are this part of speech.', 'Interjection']]],
      ['Literary terms', [
        ['The time and place of a story.', 'Setting'],
        ['The main character of a story.', 'Protagonist'],
        ['A comparison using "like" or "as."', 'Simile'],
        ['Hints about what will happen later in a story.', 'Foreshadowing', true],
        ['When the audience knows something a character doesn\'t.', 'Dramatic irony']]],
      ['Punctuation', [
        ['The mark that ends a question.', 'Question mark'],
        ['The mark in "don\'t" and "Maria\'s."', 'Apostrophe'],
        ['The mark that introduces a list after a complete sentence.', 'Colon'],
        ['The mark that joins two related sentences without a conjunction.', 'Semicolon'],
        ['Two complete sentences joined only by a comma.', 'A comma splice']]],
      ['Spelling', [
        ['Which is right: "recieve" or "receive"?', 'Receive'],
        ['"Their," "there" or "they\'re": ___ going to the game.', 'They\'re'],
        ['Which is right: "definately" or "definitely"?', 'Definitely'],
        ['Which is right: "seperate" or "separate"?', 'Separate'],
        ['Which is right: "accommodate" or "accomodate"?', 'Accommodate']]],
      ['Famous authors', [
        ['He wrote Romeo and Juliet.', 'William Shakespeare'],
        ['She wrote Pride and Prejudice.', 'Jane Austen'],
        ['She wrote To Kill a Mockingbird.', 'Harper Lee'],
        ['He wrote The Great Gatsby.', 'F. Scott Fitzgerald'],
        ['He wrote Of Mice and Men.', 'John Steinbeck']]],
      ['Vocabulary', [
        ['A word that means the opposite of another word.', 'Antonym'],
        ['A word that means the same as another word.', 'Synonym'],
        ['To make something seem bigger or better than it is.', 'Exaggerate'],
        ['Happening at the same time.', 'Simultaneous'],
        ['Kind, generous and forgiving; it starts with "b."', 'Benevolent']]],
    ].map(([name, clues]) => ({ name, clues: clues.map(([q, a, d]) => ({ q, a, double: !!d })) })),
  };

  // ---------- board shape ----------
  const blankClue = () => ({ q: '', a: '', double: false });
  const blankCat = () => ({ name: '', clues: Array.from({ length: ROWS }, blankClue) });
  // always CATS x ROWS in the editor
  function fullCats(cats) {
    const out = [];
    for (let c = 0; c < CATS; c++) {
      const src = (cats || [])[c] || {};
      out.push({
        name: String(src.name || '').slice(0, 60),
        clues: Array.from({ length: ROWS }, (_, r) => {
          const k = (src.clues || [])[r] || {};
          return { q: String(k.q || '').slice(0, 500), a: String(k.a || '').slice(0, 200), double: !!k.double };
        }),
      });
    }
    return out;
  }
  const catUsed = (cat) => !!(cat && (cat.name.trim() || cat.clues.some((k) => k.q.trim() || k.a.trim())));
  // what's saved: up to the last category in use
  function trimCats(cats) {
    const full = fullCats(cats);
    let n = full.length;
    while (n > 0 && !catUsed(full[n - 1])) n--;
    return full.slice(0, n);
  }
  // the columns the game shows (keeps each column's index on the board)
  const playCols = (board) => (board ? fullCats(board.categories).map((cat, c) => ({ cat, c })).filter((x) => catUsed(x.cat)) : []);

  // ---------- text import ----------
  // Board: Macbeth                     (optional title line)
  // Characters                         (a line without a separator = a category)
  // He kills Duncan. | Macbeth         (a clue and its answer; 5 per category)
  // * She sleepwalks. | Lady Macbeth   (a leading * marks a double)
  // Also: tabs, " — " or " = " or "Answer:" between clue and answer,
  // "100 | clue | answer", "Q: … / A: …" on two lines, numbering and bullets,
  // blank lines anywhere. "(blank)" keeps a clue's place empty, so the text
  // the editor writes back reads in exactly as it was.
  const BLANK_CLUE = '(blank)', NO_CAT = '(no category name)';
  const DBL_RE = /\s*[[(]double[\])]\s*/i;
  function parseImport(text) {
    let name = '';
    const cats = [];
    let cur = null, extra = 0, orphan = 0, pendingQ = null;
    const push = (q, a) => {
      let double = false;
      q = q.replace(/^\$?(?:[1-9]00|1000)\s*[.:)\-–]\s+/, '');
      if (/^\*+\s*/.test(q)) { double = true; q = q.replace(/^\*+\s*/, ''); }
      if (DBL_RE.test(`${q} ${a}`)) { double = true; q = q.replace(DBL_RE, ' ').trim(); a = a.replace(DBL_RE, ' ').trim(); }
      if (!cur) { orphan++; return; }
      if (cur.clues.length >= ROWS) { extra++; return; }
      cur.clues.push({ q: q.trim().slice(0, 500), a: a.trim().slice(0, 200), double });
    };
    for (let line of String(text || '').split(/\r?\n/)) {
      line = line.trim().replace(/^(?:\d{1,2}[.)]|[-–•·▪●]+)\s+/, '');
      if (!line) continue;
      const title = line.match(/^(?:board|title)\s*:\s*(.+)$/i);
      if (title && !cats.length) { name = title[1].trim().slice(0, 80); continue; }
      if (line.toLowerCase() === BLANK_CLUE || /^[|—–-]$/.test(line)) {
        if (cur && cur.clues.length < ROWS) cur.clues.push(blankClue());
        else extra++;
        continue;
      }
      const qm = line.match(/^q\s*[:.)]\s*(.*)$/i);
      if (qm) { pendingQ = qm[1]; continue; }
      const am = line.match(/^a\s*[:.)]\s*(.*)$/i);
      if (am && pendingQ != null) { push(pendingQ, am[1]); pendingQ = null; continue; }
      let parts = line.split(/\s*\|\s*|\t+/).map((p) => p.trim());
      if (parts.length < 2) {
        const m = line.match(/^(.+?)\s+[—–]\s+(.+)$/) || line.match(/^(.+?)\s+=\s+(.+)$/) || line.match(/^(.+?)\s*(?:answer|ans)\s*:\s*(.+)$/i);
        if (m) parts = [m[1], m[2]];
      }
      if (parts.length >= 2 && parts.some(Boolean)) {
        if (parts.length >= 3 && /^\$?\d{2,4}\.?$/.test(parts[0])) parts.shift();
        push(parts[0], parts.slice(1).filter(Boolean).join(' / '));
        continue;
      }
      if (cats.length >= CATS) { cur = null; extra++; continue; }
      cur = { name: line === NO_CAT ? '' : line.replace(/^(?:category\s*:\s*|#+\s*)/i, '').replace(/:$/, '').trim().slice(0, 60), clues: [] };
      cats.push(cur);
    }
    const kept = cats.filter((c) => c.clues.length);
    return { name, categories: kept, all: cats, short: kept.filter((c) => c.clues.length < ROWS).length, extra: extra + orphan, skipped: extra + orphan + (cats.length - kept.length) };
  }
  // the board back as text, in the same format
  function boardText(cats) {
    const full = fullCats(cats);
    let n = full.length;
    while (n > 0 && !catUsed(full[n - 1])) n--;
    return full.slice(0, n).map((cat) => {
      let last = ROWS;
      while (last > 0 && !cat.clues[last - 1].q.trim() && !cat.clues[last - 1].a.trim()) last--;
      const lines = cat.clues.slice(0, last).map((k) => (!k.q.trim() && !k.a.trim() ? BLANK_CLUE : `${k.double ? '* ' : ''}${k.q.trim()} | ${k.a.trim()}`));
      return [cat.name.trim() || NO_CAT, ...lines].join('\n');
    }).join('\n\n');
  }

  // ---------- drawing (every window) ----------
  function buildStage(stage) {
    stage.innerHTML = `
      <div class="qb-boardwrap"><div class="qb-board" id="qb-board" role="grid" aria-label="Quiz board"></div></div>
      <div class="qb-mini-title" id="qb-mini-title"></div>
      <div class="qb-teams" id="qb-teams"></div>
      <div class="qb-clue" id="qb-clue" hidden>
        <div class="qb-clue-card" id="qb-clue-card">
          <div class="qb-clue-head" id="qb-clue-head"></div>
          <div class="qb-double" id="qb-double">
            <div class="qb-double-word">Double!</div>
            <div class="qb-wager-line" id="qb-wager-line"></div>
            ${POPOUT ? '' : `<div class="qb-wager-form">
              <div class="qb-wager-teams" id="qb-wager-teams" role="group" aria-label="Which team wagers"></div>
              <label class="qb-wager-amt"><span>Wager</span><input type="number" id="qb-wager" min="0" step="100" inputmode="numeric"><small id="qb-wager-max"></small></label>
              <button type="button" class="qb-go" id="qb-show-clue">Show the clue</button>
            </div>`}
          </div>
          <div class="qb-clue-text" id="qb-clue-text"></div>
          <div class="qb-clue-answer" id="qb-clue-answer"></div>
          ${POPOUT ? '' : `<div class="qb-clue-foot">
            <div class="qb-score-btns" id="qb-score-btns"></div>
            <div class="qb-clue-nav">
              <button type="button" class="qb-go" id="qb-reveal">Show answer <kbd>Space</kbd></button>
              <button type="button" id="qb-back">Back to board <kbd>Esc</kbd></button>
            </div>
          </div>`}
        </div>
      </div>
      <p class="qb-live" id="qb-live" aria-live="polite"></p>`;
  }

  const scoreOf = (st, k) => {
    let s = (st.teams[k] && st.teams[k].adjust) || 0;
    for (const res of Object.values(st.results || {})) if (res && res.r && res.r[k]) s += res.r[k] * res.v;
    return s;
  };
  const keyOf = (st, c, r) => `${st.boardId}:${st.round}:${c}-${r}`;

  let lastOpenKey = null;
  function render(view) {
    const { st, board } = view;
    const boardEl = $('qb-board');
    if (!boardEl) return;
    const cols = playCols(board);
    $('qb-mini-title').textContent = board ? board.name : '';
    // the grid: a header row of category names, then five rows of values
    boardEl.style.setProperty('--cols', Math.max(1, cols.length));
    const cells = [];
    for (const { cat } of cols) {
      const h = document.createElement('div');
      h.className = 'qb-cat'; h.setAttribute('role', 'columnheader');
      const span = document.createElement('span'); span.textContent = cat.name || '';
      h.appendChild(span);
      cells.push(h);
    }
    for (let r = 0; r < ROWS; r++) {
      for (const { cat, c } of cols) {
        const clue = cat.clues[r];
        const key = keyOf(st, c, r);
        const used = !!st.used[key];
        const el = document.createElement(POPOUT ? 'div' : 'button');
        if (!POPOUT) el.type = 'button';
        el.className = 'qb-cell';
        el.dataset.c = c; el.dataset.r = r;
        if (!clue.q.trim()) { el.classList.add('blank'); if (!POPOUT) el.disabled = true; }
        else if (used) {
          el.classList.add('used');
          if (!POPOUT) { el.title = 'Used. Click to open it again (to fix a score)'; el.setAttribute('aria-label', `${cat.name || 'Category'} ${valueOf(r, st.round)}, used`); }
        } else {
          const v = document.createElement('span'); v.className = 'qb-val'; v.textContent = valueOf(r, st.round);
          el.appendChild(v);
          if (!POPOUT) el.setAttribute('aria-label', `${cat.name || 'Category'} for ${valueOf(r, st.round)}`);
        }
        cells.push(el);
      }
    }
    if (!cols.length) {
      const p = document.createElement('div'); p.className = 'qb-empty'; p.textContent = 'This board has no clues yet. Open Game setup to fill it in.';
      cells.push(p);
    }
    boardEl.replaceChildren(...cells);
    fitCats();

    // the teams
    const tw = $('qb-teams');
    tw.style.setProperty('--n', st.teams.length);
    const scores = st.teams.map((_, k) => scoreOf(st, k));
    const top = Math.max(...scores);
    tw.replaceChildren(...st.teams.map((t, k) => {
      const d = document.createElement('div');
      d.className = 'qb-team';
      if (top > 0 && scores[k] === top && scores.some((s) => s !== top)) d.classList.add('lead');
      const nm = document.createElement('div'); nm.className = 'qb-team-name'; nm.textContent = t.name || `Team ${k + 1}`;
      const sc = document.createElement('div'); sc.className = 'qb-team-score'; sc.textContent = scores[k];
      if (scores[k] < 0) sc.classList.add('neg');
      d.append(nm, sc);
      if (t.members.length) {
        const m = document.createElement('div'); m.className = 'qb-team-members'; m.textContent = t.members.join(' · '); m.title = t.members.join(', ');
        d.appendChild(m);
      }
      return d;
    }));

    // the clue
    const overlay = $('qb-clue');
    const o = st.open;
    const cat = o && board ? fullCats(board.categories)[o.c] : null;
    const clue = cat ? cat.clues[o.r] : null;
    if (!o || !clue) { overlay.hidden = true; lastOpenKey = null; return; }
    overlay.hidden = false;
    overlay.dataset.phase = o.phase;
    overlay.classList.toggle('is-double', !!clue.double);
    const v = clue.double && o.wagerTeam != null ? o.wager : valueOf(o.r, st.round);
    $('qb-clue-head').textContent = clue.double && o.phase === 'wager'
      ? (cat.name || 'Category')
      : `${cat.name || 'Category'} · ${clue.double ? `Double · ${st.teams[o.wagerTeam] ? st.teams[o.wagerTeam].name : ''} wagers ${o.wager}` : valueOf(o.r, st.round)}`;
    $('qb-clue-text').textContent = clue.q;
    $('qb-clue-answer').textContent = clue.a;
    $('qb-wager-line').textContent = o.wagerTeam != null ? `${st.teams[o.wagerTeam].name} wagers ${o.wager}` : '';
    if (o.key !== lastOpenKey) {
      zoomFrom(o.c, o.r, o.phase === 'answer');
      lastOpenKey = o.key;
    }
    if (!POPOUT) paintClueControls(view, clue, v);
  }

  // the clue grows out of its cell (each window measures its own board)
  function zoomFrom(c, r, quiet) {
    const card = $('qb-clue-card'), stage = $('qb-stage');
    const cell = document.querySelector(`.qb-cell[data-c="${c}"][data-r="${r}"]`);
    card.classList.remove('zoom');
    if (!cell || quiet) return;
    const s = stage.getBoundingClientRect(), b = cell.getBoundingClientRect(), k = card.getBoundingClientRect();
    if (!k.width || !k.height) return;
    card.style.setProperty('--zx', `${(b.left + b.width / 2) - (k.left + k.width / 2)}px`);
    card.style.setProperty('--zy', `${(b.top + b.height / 2) - (k.top + k.height / 2)}px`);
    card.style.setProperty('--zsx', (b.width / k.width).toFixed(4));
    card.style.setProperty('--zsy', (b.height / k.height).toFixed(4));
    void card.offsetWidth;
    card.classList.add('zoom');
    void s;
  }

  // category names: shrink a long one until it fits its header cell
  function fitCats() {
    document.querySelectorAll('.qb-cat > span').forEach((sp) => {
      sp.style.fontSize = '';
      const cell = sp.parentElement;
      let size = parseFloat(getComputedStyle(sp).fontSize);
      const min = size * 0.5;
      while ((sp.scrollWidth > cell.clientWidth - 4 || sp.offsetHeight > cell.clientHeight - 4) && size > min) {
        size *= 0.92; sp.style.fontSize = `${size}px`;
      }
    });
  }

  // ---------- the pop-out / mini window ----------
  if (POPOUT) {
    document.body.classList.toggle('qb-mini-mode', MINI);
    buildStage($('qb-stage'));
    let heard = false, lastView = null;
    if (bc) {
      bc.onmessage = (ev) => {
        const d = ev.data;
        if (d && d.type === 'state') { heard = true; lastView = d; $('qb-waiting').hidden = true; render(d); }
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
    render({ st: { boardId: null, round: 1, used: {}, results: {}, teams: [{ name: 'Team 1', adjust: 0, members: [] }, { name: 'Team 2', adjust: 0, members: [] }], open: null }, board: null });
    setTimeout(() => { if (!heard) $('qb-waiting').hidden = false; }, 1500);
    addEventListener('resize', () => { if (lastView) fitCats(); });
    if (document.fonts) document.fonts.ready.then(() => fitCats());
    return;
  }

  // ---------- the main tab ----------
  const freshTeams = (n = 2) => Array.from({ length: n }, (_, k) => ({ name: `Team ${k + 1}`, adjust: 0, members: [] }));
  const freshGame = () => ({ boardId: null, round: 1, used: {}, results: {}, teams: freshTeams(), open: null });

  let boards = [SAMPLE];
  let bankReady = false;        // false = the table isn't there (sample board, read-only)
  let st = loadGame();
  const undo = [];
  let muted = localStorage.getItem(MUTE_KEY) === '1';

  function loadGame() {
    try {
      const g = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
      if (g && Array.isArray(g.teams) && g.teams.length >= 2 && g.teams.length <= MAX_TEAMS) {
        return {
          ...freshGame(), ...g,
          used: g.used || {}, results: g.results || {}, round: g.round === 2 ? 2 : 1,
          teams: g.teams.map((t, k) => ({ name: String(t.name || `Team ${k + 1}`), adjust: +t.adjust || 0, members: Array.isArray(t.members) ? t.members : [] })),
        };
      }
    } catch { /* ignore */ }
    return freshGame();
  }
  function saveGame() { try { localStorage.setItem(GAME_KEY, JSON.stringify(st)); } catch { /* ignore */ } }
  const currentBoard = () => boards.find((b) => b.id === st.boardId) || boards[0] || null;

  function view() {
    const b = currentBoard();
    return { type: 'state', st, board: b ? { id: b.id, name: b.name, categories: b.categories } : null };
  }
  // what the other windows get: every clue blanked out but the open one, whose
  // text arrives once the wager is in and its answer once it is shown
  function redacted(v) {
    if (!v.board) return v;
    const o = st.open;
    const categories = fullCats(v.board.categories).map((cat, c) => ({
      name: cat.name,
      clues: cat.clues.map((k, r) => {
        const has = !!(k.q && k.q.trim());
        if (!o || o.c !== c || o.r !== r) return { q: has ? '?' : '', a: '', double: false };
        return { q: o.phase === 'wager' ? '?' : k.q, a: o.phase === 'answer' ? k.a : '', double: !!k.double };
      }),
    }));
    return { ...v, board: { id: v.board.id, name: v.board.name, categories } };
  }
  const send = () => { if (bc) bc.postMessage(redacted(view())); };
  function commit() {
    // until the boards are in, don't let the sample board take over (or save
    // over) the game in progress
    if (listLoaded) {
      const b = currentBoard();
      if (b && st.boardId !== b.id) st.boardId = b.id;
      saveGame();
    }
    render(view());
    send();
    paintHost();
    $('qb-undo').disabled = !undo.length;
    $('qb-round-1').setAttribute('aria-pressed', String(st.round === 1));
    $('qb-round-2').setAttribute('aria-pressed', String(st.round === 2));
  }
  function act(fn) {
    undo.push(JSON.stringify(st));
    if (undo.length > 80) undo.shift();
    fn();
    commit();
  }
  function live(msg) { const el = $('qb-live'); if (el) el.textContent = msg; }

  // ---------- the clue flow ----------
  function clueAt(c, r) { const b = currentBoard(); return b ? fullCats(b.categories)[c].clues[r] : null; }
  function openCell(c, r) {
    const clue = clueAt(c, r);
    if (!clue || !clue.q.trim() || st.open) return;
    const key = keyOf(st, c, r);
    const again = !!st.used[key];
    const prev = st.results[key];
    act(() => {
      st.used[key] = 1;
      st.open = {
        key, c, r, at: Date.now(),
        phase: again ? 'answer' : (clue.double ? 'wager' : 'clue'),
        wagerTeam: again && prev && prev.wagerTeam != null ? prev.wagerTeam : null,
        wager: again && prev && prev.wagerTeam != null ? prev.v : 0,
      };
    });
    if (!again) (clue.double ? sound.double() : sound.open());
    live(clue.double && !again ? 'Double!' : clue.q);
  }
  function showAnswer() {
    if (!st.open || st.open.phase !== 'clue') return;
    act(() => { st.open.phase = 'answer'; });
    sound.reveal();
    const clue = clueAt(st.open.c, st.open.r);
    live(`Answer: ${clue ? clue.a : ''}`);
  }
  function closeClue() {
    if (!st.open) return;
    act(() => { st.open = null; });
  }
  function maxWager(k) { return Math.max(scoreOf(st, k), 500 * st.round); }
  function chooseWagerTeam(k) {
    if (!st.open || st.open.phase !== 'wager') return;
    act(() => {
      st.open.wagerTeam = k;
      st.open.wager = Math.min(maxWager(k), Math.max(0, st.open.wager || Math.min(maxWager(k), valueOf(st.open.r, st.round))));
    });
    $(hosting() ? 'qb-h-wager' : 'qb-wager').focus();
  }
  function setWager(n) {
    if (!st.open || st.open.wagerTeam == null) return;
    const v = Math.max(0, Math.min(maxWager(st.open.wagerTeam), Math.round(+n || 0)));
    st.open.wager = v;   // typing: not an undo step
    commit();
  }
  function startDouble() {
    if (!st.open || st.open.phase !== 'wager' || st.open.wagerTeam == null) return;
    act(() => { st.open.phase = 'clue'; });
    sound.open();
  }
  // right (+1) / wrong (-1) for a team on the open clue; pressing again clears it
  function mark(k, sign) {
    const o = st.open;
    if (!o || o.phase !== 'answer' || !st.teams[k]) return;
    const clue = clueAt(o.c, o.r);
    if (!clue) return;
    if (clue.double && o.wagerTeam != null && k !== o.wagerTeam) return;
    act(() => {
      const res = st.results[o.key] || { v: 0, r: {} };
      res.v = clue.double && o.wagerTeam != null ? o.wager : valueOf(o.r, st.round);
      if (clue.double) res.wagerTeam = o.wagerTeam;
      if (res.r[k] === sign) delete res.r[k]; else res.r[k] = sign;
      if (Object.keys(res.r).length) st.results[o.key] = res; else delete st.results[o.key];
    });
    const now = st.results[o.key] && st.results[o.key].r[k];
    if (now === 1) sound.right(); else if (now === -1) sound.wrong();
    live(`${st.teams[k].name}: ${scoreOf(st, k)}`);
  }
  // the controls on the clue card, and the same in the host view (main tab only)
  function paintClueControls(v, clue, value) {
    paintWager($('qb-wager-teams'), $('qb-wager'), $('qb-wager-max'), $('qb-show-clue'));
    $('qb-score-btns').replaceChildren(...scoreButtons(clue, value));
  }
  function paintWager(wt, inp, max, go) {
    const o = st.open;
    if (!o || o.phase !== 'wager') return;
    wt.replaceChildren(...st.teams.map((t, k) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.wteam = k;
      b.textContent = t.name; b.setAttribute('aria-pressed', String(o.wagerTeam === k));
      return b;
    }));
    inp.disabled = o.wagerTeam == null;
    if (document.activeElement !== inp) inp.value = o.wagerTeam == null ? '' : o.wager;
    max.textContent = o.wagerTeam == null ? 'Pick the team first' : `0 to ${maxWager(o.wagerTeam)}`;
    inp.max = o.wagerTeam == null ? 0 : maxWager(o.wagerTeam);
    go.disabled = o.wagerTeam == null;
  }
  function scoreButtons(clue, value) {
    const o = st.open;
    const res = st.results[o.key];
    const only = clue.double && o.wagerTeam != null ? o.wagerTeam : null;
    return st.teams.map((t, k) => {
      const row = document.createElement('div'); row.className = 'qb-sb';
      if (only != null && k !== only) row.hidden = true;
      const nm = document.createElement('span'); nm.className = 'qb-sb-name'; nm.textContent = t.name;
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'qb-ok'; ok.dataset.mark = `${k}:1`;
      ok.textContent = `+${value}`; ok.setAttribute('aria-pressed', String(!!(res && res.r[k] === 1)));
      ok.title = `${t.name} got it right (${k + 1})`;
      const no = document.createElement('button'); no.type = 'button'; no.className = 'qb-no'; no.dataset.mark = `${k}:-1`;
      no.textContent = `−${value}`; no.setAttribute('aria-pressed', String(!!(res && res.r[k] === -1)));
      no.title = `${t.name} got it wrong (Shift+${k + 1})`;
      row.append(nm, ok, no);
      return row;
    });
  }

  // ---------- host mode ----------
  let hostPref = null;         // null: follow the projector window; true / false: the switch (this visit)
  let projAt = 0;              // when the projector window last said "here"
  let shownProj = false;
  const projOn = () => Date.now() - projAt < 7000;
  const hosting = () => (hostPref == null ? projOn() : hostPref);
  function paintMode() {
    const on = hosting();
    shownProj = projOn();
    document.querySelector('.quiz-page').classList.toggle('hosting', on);
    $('qb-host').hidden = !on;
    $('qb-host-btn').setAttribute('aria-pressed', String(on));
    $('qb-proj').dataset.on = shownProj ? '1' : '0';
    $('qb-proj-text').textContent = shownProj ? 'Projector window is open' : 'No projector window';
    $('qb-proj-open').hidden = shownProj;
    if (!on) requestAnimationFrame(fitCats);   // the board was hidden: fit its names again
  }
  const PHASE = { wager: 'Projector: Double! (waiting for the wager)', clue: 'Projector: the clue', answer: 'Projector: the answer' };
  function paintHost() {
    const b = currentBoard();
    const grid = $('qb-hgrid');
    const cols = playCols(b);
    grid.style.setProperty('--cols', Math.max(1, cols.length));
    const cells = [];
    for (const { cat } of cols) {
      const h = document.createElement('div'); h.className = 'qb-hcat'; h.textContent = cat.name || '';
      cells.push(h);
    }
    for (let r = 0; r < ROWS; r++) {
      for (const { cat, c } of cols) {
        const clue = cat.clues[r];
        const key = keyOf(st, c, r);
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'qb-hc'; el.dataset.c = c; el.dataset.r = r;
        const v = document.createElement('span'); v.className = 'qb-hc-v'; v.textContent = valueOf(r, st.round);
        el.appendChild(v);
        if (!clue.q.trim()) {
          el.classList.add('blank'); el.disabled = true;
          const e = document.createElement('span'); e.className = 'qb-hc-q'; e.textContent = 'No clue';
          el.appendChild(e);
        } else {
          if (clue.double) { const d = document.createElement('span'); d.className = 'qb-hc-dbl'; d.textContent = 'Double'; v.appendChild(d); }
          const q = document.createElement('span'); q.className = 'qb-hc-q'; q.textContent = clue.q;
          const a = document.createElement('span'); a.className = 'qb-hc-a'; a.textContent = clue.a || '(no answer)';
          el.append(q, a);
          const used = !!st.used[key];
          if (used) {
            el.classList.add('used');
            const res = st.results[key];
            const line = document.createElement('span'); line.className = 'qb-hc-res';
            line.textContent = res ? Object.entries(res.r).map(([k, s]) => `${st.teams[k] ? st.teams[k].name : ''} ${s > 0 ? '+' : '−'}${res.v}`).join(' · ') : 'Played';
            el.appendChild(line);
          }
          if (st.open && st.open.key === key) el.classList.add('open');
          el.title = used ? 'Played. Click to open it again (to fix a score)' : 'Open it on the projector';
          el.setAttribute('aria-label', `${cat.name || 'Category'} ${valueOf(r, st.round)}${used ? ', played' : ''}: ${clue.q} Answer: ${clue.a}`);
        }
        cells.push(el);
      }
    }
    if (!cols.length) {
      const p = document.createElement('div'); p.className = 'qb-empty'; p.textContent = 'This board has no clues yet. Open Game setup to fill it in.';
      cells.push(p);
    }
    grid.replaceChildren(...cells);

    // the open clue
    const o = st.open;
    const cat = o && b ? fullCats(b.categories)[o.c] : null;
    const clue = cat ? cat.clues[o.r] : null;
    $('qb-hidle').hidden = !!clue;
    $('qb-hopen').hidden = !clue;
    if (clue) {
      $('qb-hopen').dataset.phase = o.phase;
      const value = clue.double && o.wagerTeam != null ? o.wager : valueOf(o.r, st.round);
      $('qb-hhead').textContent = `${cat.name || 'Category'} · ${clue.double ? (o.wagerTeam != null ? `Double · ${st.teams[o.wagerTeam].name} wagers ${o.wager}` : 'Double') : valueOf(o.r, st.round)}`;
      $('qb-hphase').textContent = PHASE[o.phase] || '';
      $('qb-hq').textContent = clue.q;
      $('qb-ha').textContent = clue.a || '(no answer)';
      $('qb-hwager').hidden = o.phase !== 'wager';
      paintWager($('qb-h-wteams'), $('qb-h-wager'), $('qb-h-wmax'), $('qb-h-start'));
      $('qb-h-score').replaceChildren(...scoreButtons(clue, value));
      $('qb-h-score').hidden = o.phase !== 'answer';
      $('qb-h-reveal').hidden = o.phase !== 'clue';
    }

    // the scores
    const scores = st.teams.map((_, k) => scoreOf(st, k));
    const top = Math.max(...scores);
    $('qb-hteams').replaceChildren(...st.teams.map((t, k) => {
      const d = document.createElement('div'); d.className = 'qb-ht';
      if (top > 0 && scores[k] === top && scores.some((s) => s !== top)) d.classList.add('lead');
      const nm = document.createElement('span'); nm.className = 'qb-ht-name'; nm.textContent = t.name || `Team ${k + 1}`;
      const sc = document.createElement('b'); sc.className = 'qb-ht-score'; sc.textContent = scores[k];
      if (scores[k] < 0) sc.classList.add('neg');
      d.append(nm, sc);
      return d;
    }));
  }

  function resetGame() {
    if (!confirm('Start a new game? Every score goes back to 0 and every clue comes back. Team names and members stay.')) return;
    act(() => {
      const teams = st.teams.map((t) => ({ ...t, adjust: 0 }));
      Object.assign(st, { used: {}, results: {}, open: null, round: 1, teams });
    });
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
    const tone = (c, freq, t0, dur, type = 'sine', vol = 0.16, to) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    };
    return {
      open() { const c = ac(); if (!c) return; const t = c.currentTime; tone(c, 220, t, 0.35, 'triangle', 0.12, 880); },
      reveal() { const c = ac(); if (!c) return; const t = c.currentTime; tone(c, 659.25, t, 0.35, 'sine', 0.16); tone(c, 987.77, t + 0.1, 0.6, 'sine', 0.16); },
      right() { const c = ac(); if (!c) return; const t = c.currentTime; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, t + i * 0.08, 0.45, 'triangle', 0.15)); },
      wrong() { const c = ac(); if (!c) return; const t = c.currentTime; tone(c, 110, t, 0.6, 'sawtooth', 0.18); tone(c, 116, t, 0.6, 'square', 0.08); },
      double() {
        const c = ac(); if (!c) return; const t = c.currentTime;
        [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(c, f, t + i * 0.06, 0.5, 'square', 0.07));
        tone(c, 1568, t + 0.4, 0.9, 'triangle', 0.12);
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
    $('qb-count').value = String(st.teams.length);
    const wrap = $('qb-team-cols');
    wrap.style.setProperty('--n', st.teams.length);
    wrap.replaceChildren(...st.teams.map((t, k) => {
      const col = document.createElement('section'); col.className = 'qb-team-col';
      const name = document.createElement('input'); name.type = 'text'; name.maxLength = 30; name.value = t.name; name.dataset.tname = k;
      name.setAttribute('aria-label', `Team ${k + 1} name`);
      const sl = document.createElement('label'); sl.className = 'qb-score-edit';
      const sp = document.createElement('span'); sp.textContent = 'Score';
      const sc = document.createElement('input'); sc.type = 'number'; sc.step = 'any'; sc.value = scoreOf(st, k); sc.dataset.tscore = k;
      sl.append(sp, sc);
      const ul = document.createElement('ul'); ul.className = 'qb-member-list';
      if (!t.members.length) {
        const li = document.createElement('li'); li.className = 'none'; li.textContent = 'No students yet'; ul.appendChild(li);
      } else {
        const next = st.teams[(k + 1) % st.teams.length].name;
        t.members.forEach((m, i) => {
          const li = document.createElement('li');
          const b = document.createElement('button'); b.type = 'button'; b.textContent = m; b.dataset.k = k; b.dataset.i = i;
          b.title = `Move to ${next}`;
          li.appendChild(b); ul.appendChild(li);
        });
      }
      col.append(name, sl, ul);
      return col;
    }));
  }
  function setTeamCount(n) {
    n = Math.max(2, Math.min(MAX_TEAMS, n));
    if (n === st.teams.length) return;
    act(() => {
      if (n > st.teams.length) {
        for (let k = st.teams.length; k < n; k++) st.teams.push({ name: `Team ${k + 1}`, adjust: 0, members: [] });
      } else {
        // the members of a removed team move to the last team left
        const gone = st.teams.splice(n);
        for (const t of gone) st.teams[n - 1].members.push(...t.members);
        st.teams[n - 1].members.sort((a, b) => a.localeCompare(b));
        for (const res of Object.values(st.results)) for (const k of Object.keys(res.r)) if (+k >= n) delete res.r[k];
      }
    });
    paintTeamsDialog();
  }
  async function splitClass() {
    const periodId = $('qb-period').value;
    if (!periodId) { setStatus('Add a period in Rosters first.', 'error'); return; }
    const n = st.teams.length;
    const btn = $('qb-split');
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
      if (present.length < n) { $('qb-split-note').textContent = present.length ? `Only ${present.length} here today: not enough for ${n} teams.` : 'Nobody in this period is marked present today.'; return; }
      let groups;
      let how = 'at random';
      if (rulesRow.useFormula && rulesRow.rules.length && typeof groupWithFormula === 'function') {
        const nameOf = (id) => { const s = students.find((x) => x.id === id); return s ? s.name : ''; };
        const ids = new Set(present.map((s) => s.id));
        const groupMax = Math.ceil(present.length / n);
        const problems = findImpossibleHard(rulesForPresent(rulesRow.rules, ids), nameOf, 'grouping', { groupCount: n, groupMax });
        const demote = new Set(problems.map((p) => p.rule.id));
        groups = groupWithFormula(present, n, rulesRow.rules, nameOf, { demote }).groups;
        how = 'by your grouping rules';
      } else {
        const mixed = shuffle(present.slice());
        groups = Array.from({ length: n }, (_, k) => mixed.filter((_, i) => i % n === k));
      }
      act(() => {
        groups.forEach((g, k) => { st.teams[k].members = g.map((s) => labelFor(s, present)).sort((a, b) => a.localeCompare(b)); });
      });
      const skipped = students.length - present.length;
      $('qb-split-note').textContent = `${present.length} students split ${how}${skipped ? ` (${skipped} absent or sitting out)` : ''}.`;
      paintTeamsDialog();
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- the board editor ----------
  // One board open at a time (draft). Two views of it: Paste (the whole board
  // as text, beside a live preview) and Clue by clue (the 6 x 5 grid and the
  // selected clue's form). Every change saves itself 700ms later; Close just
  // closes (after saving anything pending).
  const editor = $('qb-editor');
  const MODE_KEY = 'teacherpal.quiz.editMode';
  let editId = null;        // the board in the editor ('sample' = the read-only sample)
  let draft = null;         // { name, categories: CATS x ROWS, extra, blanked }
  let cell = { c: 0, r: 0 };
  let emode = localStorage.getItem(MODE_KEY) === 'grid' ? 'grid' : 'paste';
  const editable = () => bankReady && !!draft && editId !== 'sample';
  const clueCount = (cats) => cats.reduce((s, cat) => s + cat.clues.filter((k) => k.q.trim()).length, 0);

  function paintSave(text, kind) { const el = $('qb-save-state'); el.textContent = text; el.dataset.kind = kind || ''; }
  function paintPick() {
    const pick = $('qb-pick');
    const opts = boards.map((b) => [b.id, b.sample ? `${b.name} (built in)` : b.name]);
    if (bankReady) opts.push(['__new', '+ New board']);
    pick.replaceChildren(...opts.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; }));
    pick.value = editId || '';
  }
  function loadDraft(b) {
    editId = b ? b.id : null;
    draft = b ? { name: b.name, categories: fullCats(b.categories), extra: 0, blanked: false } : null;
    cell = { c: 0, r: 0 };
    $('qb-paste-text').value = draft ? boardText(draft.categories) : '';
    paintSave('');
    paintEditor();
  }
  function paintEditor() {
    const ro = !editable();
    paintPick();
    $('qb-f-name').value = draft ? draft.name : '';
    $('qb-f-name').disabled = ro;
    $('qb-dup').hidden = $('qb-delete').hidden = !bankReady;
    $('qb-dup').disabled = !editId;
    $('qb-delete').disabled = ro;
    $('qb-paste-text').readOnly = ro;
    $('qb-mode-paste').setAttribute('aria-pressed', String(emode === 'paste'));
    $('qb-mode-grid').setAttribute('aria-pressed', String(emode === 'grid'));
    $('qb-paste').hidden = emode !== 'paste';
    $('qb-gridmode').hidden = emode !== 'grid';
    $('qb-play').disabled = !editId;
    const note = $('qb-editor-note');
    note.dataset.sample = editId === 'sample' && bankReady ? '1' : '';
    if (editId === 'sample' && bankReady) note.textContent = 'This is the built-in sample board. Press Duplicate board for a copy you can change, or pick + New board.';
    else if (bankReady) note.textContent = '';
    if (emode === 'paste') paintPreview(); else paintGrid();
    paintCount();
  }
  function paintCount() {
    if (!draft) { $('qb-pv-count').textContent = ''; return; }
    const cats = trimCats(draft.categories);
    const clues = clueCount(cats);
    const dbl = cats.reduce((s, cat) => s + cat.clues.filter((k) => k.q.trim() && k.double).length, 0);
    const noAns = cats.reduce((s, cat) => s + cat.clues.filter((k) => k.q.trim() && !k.a.trim()).length, 0);
    const bits = [clues ? `${cats.length} categor${cats.length === 1 ? 'y' : 'ies'} · ${clues} clue${clues === 1 ? '' : 's'}${dbl ? ` · ${dbl} double${dbl === 1 ? '' : 's'}` : ''}` : 'No clues yet'];
    if (noAns) bits.push(`${noAns} without an answer`);
    if (draft.extra) bits.push(`${draft.extra} line${draft.extra === 1 ? '' : 's'} left out (6 categories, 5 clues each)`);
    $('qb-pv-count').textContent = bits.join(' · ');
  }
  // the preview: the board as it will play, with every clue and answer; a click opens that clue
  function paintPreview() {
    const box = $('qb-pv');
    const full = draft ? draft.categories : [];
    let n = full.length;
    while (n > 0 && !catUsed(full[n - 1])) n--;
    if (!n) {
      const p = document.createElement('p'); p.className = 'ed-empty';
      p.textContent = editable() ? 'Nothing yet' : 'No clues';
      box.style.removeProperty('--cols');
      box.replaceChildren(p);
      return;
    }
    box.style.setProperty('--cols', n);
    const parts = [];
    for (let c = 0; c < n; c++) {
      const h = document.createElement('div'); h.className = 'qb-pv-cat' + (full[c].name.trim() ? '' : ' unnamed');
      h.textContent = full[c].name.trim() || `Category ${c + 1}`;
      parts.push(h);
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < n; c++) {
        const k = full[c].clues[r];
        const b = document.createElement('button'); b.type = 'button'; b.className = 'qb-pv-cell'; b.dataset.c = c; b.dataset.r = r;
        const v = document.createElement('b'); v.textContent = valueOf(r, 1);
        if (k.double) { const d = document.createElement('i'); d.textContent = 'Double'; v.appendChild(d); }
        b.appendChild(v);
        if (!k.q.trim() && !k.a.trim()) { b.classList.add('empty'); const e = document.createElement('span'); e.className = 'qb-pv-q'; e.textContent = 'Empty'; b.appendChild(e); }
        else {
          const q = document.createElement('span'); q.className = 'qb-pv-q'; q.textContent = k.q.trim() || 'No clue yet';
          const a = document.createElement('span'); a.className = 'qb-pv-a'; a.textContent = k.a.trim() || 'No answer yet';
          if (!k.q.trim()) q.classList.add('missing');
          if (!k.a.trim()) a.classList.add('missing');
          b.append(q, a);
        }
        b.title = editable() ? 'Edit this clue' : 'See this clue';
        parts.push(b);
      }
    }
    box.replaceChildren(...parts);
  }
  function paintGrid() {
    const ro = !editable();
    const g = $('qb-egrid');
    const parts = [];
    for (let c = 0; c < CATS; c++) {
      const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 60; inp.className = 'qb-ecat';
      inp.placeholder = `Category ${c + 1}`; inp.dataset.cat = c; inp.value = draft ? draft.categories[c].name : ''; inp.disabled = ro;
      inp.setAttribute('aria-label', `Category ${c + 1} name`);
      parts.push(inp);
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < CATS; c++) {
        const k = draft ? draft.categories[c].clues[r] : blankClue();
        const b = document.createElement('button'); b.type = 'button'; b.className = 'qb-ecell'; b.dataset.c = c; b.dataset.r = r;
        if (cell.c === c && cell.r === r) b.setAttribute('aria-current', 'true');
        if (!k.q.trim()) b.classList.add('empty');
        if (k.double) b.classList.add('dbl');
        const v = document.createElement('b'); v.textContent = valueOf(r, 1);
        const t = document.createElement('span'); t.textContent = k.q.trim() || 'Empty';
        b.append(v, t);
        b.setAttribute('aria-label', `${(draft && draft.categories[c].name) || `Category ${c + 1}`}, ${valueOf(r, 1)}: ${k.q.trim() || 'empty'}`);
        parts.push(b);
      }
    }
    g.replaceChildren(...parts);
    paintCellForm();
  }
  function paintCellForm() {
    const ro = !editable();
    const k = draft ? draft.categories[cell.c].clues[cell.r] : blankClue();
    $('qb-cell-label').textContent = `${(draft && draft.categories[cell.c].name.trim()) || `Category ${cell.c + 1}`} · ${valueOf(cell.r, 1)}`;
    $('qb-f-q').value = k.q; $('qb-f-a').value = k.a; $('qb-f-double').checked = k.double;
    $('qb-f-q').disabled = $('qb-f-a').disabled = $('qb-f-double').disabled = ro;
  }
  function setMode(m) {
    if (emode === m) return;
    emode = m;
    localStorage.setItem(MODE_KEY, m);
    paintEditor();
  }
  function openCellInGrid(c, r) {
    cell = { c, r };
    setMode('grid');
    paintGrid();
    if (editable()) $('qb-f-q').focus();
  }
  // a change in the grid: the text follows, and it saves
  function gridEdited() {
    draft.extra = 0; draft.blanked = false;
    $('qb-paste-text').value = boardText(draft.categories);
    paintCount();
    scheduleSave();
  }
  function onPasteInput(e) {
    if (!editable()) return;
    const had = clueCount(trimCats(draft.categories));
    const res = parseImport(e.target.value);
    draft.categories = fullCats(res.all);
    draft.extra = res.extra;
    draft.blanked = had > 0 && !clueCount(trimCats(draft.categories)) && !e.target.value.trim();
    if (res.name && /^(?:new board|untitled board|imported board|)(?:\s\d+)?$/i.test(draft.name.trim())) {
      draft.name = res.name;
      $('qb-f-name').value = res.name;
    }
    paintPreview();
    paintCount();
    scheduleSave();
  }

  // ---------- autosave ----------
  let saveTimer = 0, pending = false, saving = Promise.resolve();
  function scheduleSave() {
    if (!editable()) return;
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
    const id = editId, d = draft;
    if (!d || !id || id === 'sample' || !bankReady) return;
    if (d.blanked) { paintSave('The box is empty, so nothing was saved. Ctrl+Z in the box brings it back.', 'error'); return; }
    try {
      const row = await updateQuizBoard(id, { name: d.name.trim() || 'Untitled board', categories: trimCats(d.categories) });
      const i = boards.findIndex((b) => b.id === id);
      if (i >= 0) boards[i] = row;
      if (draft === d && !pending) paintSave('Saved', 'ok');
      fillBoardSelect();
      if (draft === d) paintPick();
      commit();
    } catch (err) {
      paintSave(`Not saved: ${err.message || err}`, 'error');
    }
  }

  // ---------- boards ----------
  async function newBoard(name = 'New board', categories = []) {
    if (!bankReady) return null;
    await flushSave();
    try {
      const taken = new Set(boards.map((b) => b.name.toLowerCase()));
      let nm = name, k = 2;
      while (taken.has(nm.toLowerCase())) nm = `${name} ${k++}`;
      const row = await createQuizBoard({ name: nm.slice(0, 80), categories: trimCats(categories), sortOrder: boards.filter((b) => !b.sample).length });
      boards = boards.filter((b) => !b.sample).concat(row);
      fillBoardSelect();
      loadDraft(row);
      return row;
    } catch (err) {
      paintSave(`Couldn't make the board: ${err.message || err}`, 'error');
      paintPick();
      return null;
    }
  }
  async function duplicateBoard() {
    const b = boards.find((x) => x.id === editId);
    if (!b) return;
    await flushSave();
    const src = boards.find((x) => x.id === editId) || b;
    const row = await newBoard(src.sample ? 'My board' : `${src.name} (copy)`.slice(0, 80), src.categories);
    if (row) { paintSave(src.sample ? 'Copied the sample. Change anything.' : 'Duplicated. This is the copy.', 'ok'); $('qb-f-name').focus(); $('qb-f-name').select(); }
  }
  async function deleteBoard() {
    const b = boards.find((x) => x.id === editId);
    if (!b || !editable() || !confirm(`Delete the board "${b.name}"? This can't be undone.`)) return;
    clearTimeout(saveTimer); pending = false;
    await saving;
    try {
      await deleteQuizBoard(b.id);
      boards = boards.filter((x) => x.id !== b.id);
      if (!boards.length) boards = [SAMPLE];
      fillBoardSelect();
      if (st.boardId === b.id) { st.boardId = boards[0].id; st.open = null; }
      commit();
      loadDraft(boards[0]);
      paintSave('Deleted.', 'ok');
    } catch (err) { paintSave(`Couldn't delete: ${err.message || err}`, 'error'); }
  }
  async function closeEditor() {
    await flushSave();
    editor.close();
  }
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


  // ---------- the start screen ----------
  // Where the game opens (main tab only): the saved boards as cards, the
  // teams, and one big Start (Resume when a game is in progress). The board
  // stays covered (and inert) until then.
  const PLAYED_KEY = 'teacherpal.quiz.played';
  const startEl = $('qb-start');
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
    if (on) { selId = null; paintStart(); $('qb-gs-go').focus({ preventScroll: true }); }
  }
  function paintStart() {
    if (!startOn) return;
    const list = boards;
    const cur = currentBoard();
    if (!selId || !list.some((x) => x.id === selId)) selId = cur ? cur.id : (list[0] ? list[0].id : null);
    const wrap = $('qb-gs-cards');
    const m = played();
    if (!listLoaded) {
      const p = document.createElement('p'); p.className = 'gs-empty'; p.textContent = 'Loading your boards…';
      wrap.replaceChildren(p);
    } else if (bankReady && !ownBoards().length) {
      const item = document.createElement('div'); item.className = 'gs-item gs-first'; item.setAttribute('role', 'listitem');
      item.innerHTML = '<button type="button" class="gs-card gs-new" data-new><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><b>Make your first board</b><span class="gs-new-sub">Or press Start to try the sample board.</span></button>';
      wrap.replaceChildren(item);
    } else {
      const cards = list.map((x) => {
        const item = document.createElement('div'); item.className = 'gs-item'; item.setAttribute('role', 'listitem');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'gs-card'; b.dataset.id = x.id;
        b.setAttribute('aria-pressed', String(x.id === selId));
        const n = document.createElement('b'); n.className = 'gs-card-name'; n.textContent = x.name;
        const c = document.createElement('span'); c.className = 'gs-card-n'; c.textContent = (() => { const n = boardClues(x.categories); return n ? `${n} clue${n === 1 ? '' : 's'}` : 'No clues yet'; })();
        const w = document.createElement('span'); w.className = 'gs-card-when'; w.textContent = ago(m[x.id]);
        b.append(c, n, w); b.title = n.textContent;
        item.append(b);
        if (!(boardClues(x.categories))) { b.disabled = true; w.textContent = 'Empty'; }
        if (bankReady && !x.sample) {
          const pen = document.createElement('button'); pen.type = 'button'; pen.className = 'gs-edit'; pen.dataset.edit = x.id;
          pen.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
          pen.title = `Edit "${n.textContent}"`; pen.setAttribute('aria-label', pen.title);
          item.append(pen);
        }
        return item;
      });
      if (bankReady) {
        const add = document.createElement('div'); add.className = 'gs-item'; add.setAttribute('role', 'listitem');
        add.innerHTML = '<button type="button" class="gs-card gs-new" data-new><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><b>New board</b></button>';
        cards.push(add);
      }
      wrap.replaceChildren(...cards);
    }
    // the teams: names you can type over, and who's on them
    const row = $('qb-gs-teams');
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
    const go = $('qb-gs-go'), second = $('qb-gs-second'), note = $('qb-gs-progress'), pwrap = $('qb-gs-pwrap');
    const own = ownBoards().length;
    $('qb-gs-count').textContent = listLoaded && own ? `${own} board${own === 1 ? '' : 's'}` : '';
    const selItem = list.find((x) => x.id === selId);
    go.disabled = !listLoaded || !selItem || !((selItem && boardClues(selItem.categories)) || (bankReady && !ownBoards().length));
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
    const cur = currentBoard();
    const id = selId || (cur && cur.id);
    if (!id) return;
    if (fresh || !cur || id !== cur.id) startNew(id);
    markPlayed(id);
    setStart(false);
    
  }
  function inProgress() { return Object.keys(st.used || {}).length > 0 || Object.keys(st.results || {}).length > 0 || st.teams.some((t) => t.adjust) || st.round === 2; }
  function progressText() {
    const b = currentBoard();
    return `${b ? `"${b.name}", ` : ''}${st.teams.map((t, k) => `${t.name} ${scoreOf(st, k)}`).join(' · ')}`;
  }
  // a new game on this board: every clue back, scores to 0, the teams kept
  function startNew(id) {
    act(() => {
      st.boardId = id; st.used = {}; st.results = {}; st.open = null; st.round = 1;
      st.teams.forEach((t) => { t.adjust = 0; });
    });
  }

  // ---------- loading ----------
  function fillBoardSelect() { if (setup.open) paintSetup(); if (typeof startOn !== 'undefined' && startOn) paintStart(); }

  // ---------- Game setup ----------
  // Everything before the game, one section at a time: Boards (pick one,
  // make one, edit one), Get a board with AI (four steps and a paste box),
  // Teams, How to play. "Start the game" is always at the bottom.
  const setup = $('qb-setup');
  let setupSec = 'questions';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const boardClues = (cats) => (cats || []).reduce((n, c) => n + (c.clues || []).filter((x) => x && x.q && x.q.trim()).length, 0);
  const catCount = (cats) => (cats || []).filter((c) => (c.clues || []).some((x) => x && x.q && x.q.trim())).length;
  const ownBoards = () => boards.filter((b) => !b.sample);
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
    $('qb-split-note').textContent = '';
    if (!setup.open) setup.showModal();
    showSection(sec, true);
    try {
      const periods = (typeof navReady !== 'undefined' ? (await navReady).periods : null) || await getPeriods();
      const sel = $('qb-period');
      if (!sel.options.length) fillPeriodSelect(sel, periods);
    } catch (err) { showError(err); }
  }
  function setupFlash(text) {
    const el = $('qb-gh-flash');
    el.textContent = text;
    clearTimeout(setupFlash.t);
    setupFlash.t = setTimeout(() => { el.textContent = ''; }, 6000);
  }
  function paintSetup() {
    const cur = currentBoard();
    const cards = boards.map((b) => {
      const n = boardClues(b.categories);
      const on = !!cur && b.id === cur.id;
      const card = document.createElement('article');
      card.className = 'gh-card' + (on ? ' on' : '');
      const name = document.createElement('b'); name.className = 'gh-card-name'; name.textContent = b.name;
      const meta = document.createElement('span'); meta.className = 'gh-card-n';
      meta.textContent = n ? `${plural(catCount(b.categories), 'category').replace('categorys', 'categories')} · ${plural(n, 'clue')}` : 'No clues yet';
      card.append(name, meta);
      const acts = document.createElement('div'); acts.className = 'gh-card-acts';
      const use = document.createElement('button'); use.type = 'button'; use.className = 'primary gh-big'; use.dataset.use = b.id;
      use.textContent = on ? '✓ Playing now' : 'Use this board';
      use.disabled = on || !n;
      acts.appendChild(use);
      if (!b.sample && bankReady) {
        const e = document.createElement('button'); e.type = 'button'; e.dataset.edit = b.id; e.textContent = n ? 'Edit' : 'Add clues';
        acts.appendChild(e);
      }
      card.appendChild(acts);
      return card;
    });
    if (bankReady) {
      const add = document.createElement('div'); add.className = 'gh-card gh-new';
      add.innerHTML = '<b class="gh-card-name">Make a new board</b><div class="gh-card-acts"><button type="button" class="gh-big" data-new>+ Make a new board</button><button type="button" class="gh-link" data-goto="ai">Or get a board with AI</button></div>';
      cards.push(add);
    }
    $('qb-gh-cards').replaceChildren(...cards);
    $('qb-gh-note').textContent = bankReady ? (ownBoards().length ? '' : 'You don\'t have a board of your own yet. Make one below, or play the sample board to try the game.')
      : 'Saving your own boards isn\'t switched on yet (ask whoever set up TeacherPal to run migration-quiz-boards.sql). Until then you can play the sample board.';
    paintAi();
    paintSummary();
  }
  function paintSummary() {
    const cur = currentBoard();
    const names = st.teams.map((t) => t.name);
    $('qb-gh-summary').textContent = `${cur ? cur.name : 'No board'} · ${names.length > 2 ? `${names.length} teams` : names.join(' vs ')}`;
  }
  function aiFound() { return parseImport($('qb-gh-text').value); }
  function paintAi() {
    const p = aiFound();
    const n = boardClues(p.categories);
    const has = !!$('qb-gh-text').value.trim();
    const msg = $('qb-gh-msg');
    if (!bankReady) { msg.textContent = 'Saving boards isn\'t switched on yet, so this box can\'t save one.'; msg.dataset.kind = 'error'; }
    else if (!has) { msg.textContent = ''; msg.dataset.kind = ''; }
    else if (n) { msg.textContent = `Found ${plural(p.categories.length, 'category').replace('categorys', 'categories')} and ${plural(n, 'clue')}. Give the board a name and save it.`; msg.dataset.kind = 'ok'; }
    else { msg.textContent = 'No clues found yet. Each category needs its clues on the lines under it, written as clue | answer.'; msg.dataset.kind = 'error'; }
    $('qb-gh-save').disabled = !n || !bankReady;
    if (!p.name || $('qb-gh-name').dataset.typed) return;
    $('qb-gh-name').value = p.name;
  }
  async function saveAi() {
    const p = aiFound();
    if (!boardClues(p.categories) || !bankReady) return;
    const btn = $('qb-gh-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    const row = await newBoard($('qb-gh-name').value.trim() || p.name || 'New board', p.categories);
    btn.textContent = 'Save this board';
    if (!row) { $('qb-gh-msg').textContent = 'Couldn\'t save the board. Check your connection and try again.'; $('qb-gh-msg').dataset.kind = 'error'; btn.disabled = false; return; }
    act(() => { st.boardId = row.id; st.open = null; });
    $('qb-gh-text').value = ''; $('qb-gh-name').value = ''; delete $('qb-gh-name').dataset.typed;
    paintSetup();
    showSection('questions', true);
    setupFlash(`Saved "${row.name}". It's ready to play.`);
  }
  function onSetupClick(e) {
    const nav = e.target.closest('.gh-nav [data-sec]');
    if (nav) { showSection(nav.dataset.sec, true); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { showSection(go.dataset.goto, true); return; }
    const use = e.target.closest('[data-use]');
    if (use) {
      const b = boards.find((x) => x.id === use.dataset.use);
      if (b && b.id !== st.boardId) { act(() => { st.boardId = b.id; st.open = null; }); paintSetup(); setupFlash(`Now playing "${b.name}".`); }
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const b = boards.find((x) => x.id === ed.dataset.edit);
      if (!b) return;
      loadDraft(b);
      editor.showModal();
      if (emode === 'paste' && editable() && !$('qb-paste-text').value.trim()) $('qb-paste-text').focus();
      return;
    }
    if (e.target.closest('[data-new]')) {
      editor.showModal();
      newBoard().then((row) => { if (row) { setMode('paste'); $('qb-paste-text').focus(); } });
    }
  }
  async function loadBoards() {
    try {
      const rows = await getQuizBoards();
      bankReady = true;
      boards = rows.length ? rows : [SAMPLE];
      $('qb-editor-note').textContent = '';
    } catch (err) {
      bankReady = false;
      boards = [SAMPLE];
      const missing = /quiz_boards|does not exist|schema cache|404/i.test(String(err && (err.message || err)));
      $('qb-editor-note').textContent = missing
        ? 'Run migration-quiz-boards.sql in Supabase to make and save your own boards. Until then the game plays the sample board.'
        : `Couldn't load your boards (${err.message || err}). Playing the sample board.`;
      setStatus(missing ? 'Playing the sample board. Run migration-quiz-boards.sql to make your own.' : 'Couldn\'t load your boards; playing the sample board.', missing ? 'info' : 'error');
    }
    listLoaded = true;
    if (!boards.some((b) => b.id === st.boardId)) { st.boardId = boards[0].id; st.open = null; }
    fillBoardSelect();
    commit();
    paintStart();
  }

  // ---------- wiring ----------
  buildStage($('qb-stage'));
  fillBoardSelect();
  commit();
  paintMode();
  loadBoards();
  addEventListener('resize', fitCats);
  if (document.fonts) document.fonts.ready.then(fitCats);

  $('qb-board').addEventListener('click', (e) => {
    const b = e.target.closest('.qb-cell');
    if (b && !b.disabled) openCell(+b.dataset.c, +b.dataset.r);
  });
  $('qb-clue').addEventListener('click', (e) => {
    const t = e.target;
    const m = t.closest('[data-mark]');
    if (m) { const [k, s] = m.dataset.mark.split(':'); mark(+k, +s); return; }
    const w = t.closest('[data-wteam]');
    if (w) { chooseWagerTeam(+w.dataset.wteam); return; }
    if (t.closest('#qb-back')) { closeClue(); return; }
    if (t.closest('#qb-show-clue')) { startDouble(); return; }
    if (t.closest('#qb-reveal')) { showAnswer(); return; }
    if (t.closest('button, input, label')) return;
    if (st.open && st.open.phase === 'clue') showAnswer();   // a click on the clue shows the answer
  });
  $('qb-wager').addEventListener('input', (e) => setWager(e.target.value));
  $('qb-wager').addEventListener('change', (e) => { setWager(e.target.value); e.target.value = st.open ? st.open.wager : ''; });
  $('qb-wager').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setWager(e.target.value); startDouble(); } });

  $('qb-undo').addEventListener('click', () => { if (undo.length) { st = JSON.parse(undo.pop()); commit(); } });
  $('qb-reset').addEventListener('click', resetGame);
  $('qb-round-1').addEventListener('click', () => { if (st.round !== 1) act(() => { st.round = 1; st.open = null; }); });
  $('qb-round-2').addEventListener('click', () => { if (st.round !== 2) act(() => { st.round = 2; st.open = null; }); });
  $('qb-hclue').addEventListener('click', (e) => {
    const t = e.target;
    const m = t.closest('[data-mark]');
    if (m) { const [k, s] = m.dataset.mark.split(':'); mark(+k, +s); return; }
    const w = t.closest('[data-wteam]');
    if (w) { chooseWagerTeam(+w.dataset.wteam); return; }
    if (t.closest('#qb-h-back')) { if (!st.open || st.open.phase !== 'wager' || confirm('Close the double without playing it?')) closeClue(); return; }
    if (t.closest('#qb-h-start')) { startDouble(); return; }
    if (t.closest('#qb-h-reveal')) showAnswer();
  });
  $('qb-h-wager').addEventListener('input', (e) => setWager(e.target.value));
  $('qb-h-wager').addEventListener('change', (e) => { setWager(e.target.value); e.target.value = st.open ? st.open.wager : ''; });
  $('qb-h-wager').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setWager(e.target.value); startDouble(); } });

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
  $('qb-gs-go').addEventListener('click', () => startGo(false));
  $('qb-gs-second').addEventListener('click', () => {
    const cur = currentBoard();
    if (cur && selId === cur.id) startGo(true);       // Start over
    else { selId = cur ? cur.id : selId; startGo(false); }   // Resume the game in progress
  });
  $('qb-gs-setup').addEventListener('click', () => openSetup('questions'));
  $('qb-gs-howto').addEventListener('click', () => openSetup('howto'));
  $('qb-gs-roster').addEventListener('click', () => openSetup('teams'));
  $('qb-gs-teams').addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (k == null) return;
    st.teams[+k].name = e.target.value.trim().slice(0, 30) || `Team ${+k + 1}`;
    commit();
  });
  setup.addEventListener('close', () => { if (startOn) { selId = null; paintStart(); } });
  $('qb-setup-btn').addEventListener('click', () => openSetup(setupSec));
  $('qb-setup-close').addEventListener('click', () => setup.close());
  $('qb-gh-start').addEventListener('click', () => { const b = currentBoard(); setup.close(); if (startOn) { if (b) markPlayed(b.id); setStart(false); } });
  setup.addEventListener('click', onSetupClick);
  setup.addEventListener('close', () => { $('qb-setup-btn').focus(); });
  $('qb-gh-copy').addEventListener('click', (e) => copyText($('qb-gh-prompt').textContent, e.currentTarget));
  $('qb-gh-text').addEventListener('input', paintAi);
  $('qb-gh-name').addEventListener('input', (e) => { e.target.dataset.typed = e.target.value ? '1' : ''; if (!e.target.value) delete e.target.dataset.typed; });
  $('qb-gh-save').addEventListener('click', saveAi);
  editor.addEventListener('close', () => { if (setup.open) paintSetup(); if (startOn) paintStart(); });
  $('qb-count').addEventListener('change', (e) => setTeamCount(+e.target.value));
  $('qb-split').addEventListener('click', splitClass);
  $('qb-clear-members').addEventListener('click', () => { act(() => { st.teams.forEach((t) => { t.members = []; }); }); paintTeamsDialog(); });
  $('qb-period').addEventListener('change', (e) => setLastPeriodId(e.target.value));
  $('qb-team-cols').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.tname != null) { st.teams[+t.dataset.tname].name = t.value.trim().slice(0, 30) || `Team ${+t.dataset.tname + 1}`; commit(); paintSummary(); }
  });
  $('qb-team-cols').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.tscore != null && t.value !== '') {
      const k = +t.dataset.tscore;
      const want = Math.round(+t.value || 0);
      act(() => { st.teams[k].adjust += want - scoreOf(st, k); });
    }
  });
  $('qb-team-cols').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const k = +b.dataset.k, to = (k + 1) % st.teams.length;
    act(() => {
      const [m] = st.teams[k].members.splice(+b.dataset.i, 1);
      st.teams[to].members.push(m);
      st.teams[to].members.sort((a, c) => a.localeCompare(c));
    });
    paintTeamsDialog();
  });

  // editor
  $('qb-editor-close').addEventListener('click', closeEditor);
  editor.addEventListener('cancel', (e) => { e.preventDefault(); closeEditor(); });
  $('qb-pick').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (v === '__new') { if (await newBoard()) { $('qb-f-name').focus(); $('qb-f-name').select(); } return; }
    await flushSave();
    const b = boards.find((x) => x.id === v);
    if (b) loadDraft(b);
  });
  $('qb-f-name').addEventListener('input', (e) => {
    if (!editable()) return;
    draft.name = e.target.value.slice(0, 80);
    const o = $('qb-pick').selectedOptions[0];
    if (o) o.textContent = draft.name.trim() || 'Untitled board';
    scheduleSave();
  });
  $('qb-dup').addEventListener('click', duplicateBoard);
  $('qb-delete').addEventListener('click', deleteBoard);
  $('qb-mode-paste').addEventListener('click', () => setMode('paste'));
  $('qb-mode-grid').addEventListener('click', () => setMode('grid'));
  $('qb-paste-text').addEventListener('input', onPasteInput);
  $('qb-pv').addEventListener('click', (e) => {
    const b = e.target.closest('.qb-pv-cell');
    if (b) openCellInGrid(+b.dataset.c, +b.dataset.r);
  });
  $('qb-ai-copy').addEventListener('click', (e) => copyText($('qb-ai-prompt').textContent, e.currentTarget));
  $('qb-egrid').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.cat == null || !editable()) return;
    draft.categories[+t.dataset.cat].name = t.value.slice(0, 60);
    $('qb-cell-label').textContent = `${draft.categories[cell.c].name.trim() || `Category ${cell.c + 1}`} · ${valueOf(cell.r, 1)}`;
    gridEdited();
  });
  $('qb-egrid').addEventListener('click', (e) => {
    const b = e.target.closest('.qb-ecell');
    if (!b) return;
    cell = { c: +b.dataset.c, r: +b.dataset.r };
    $('qb-egrid').querySelectorAll('.qb-ecell[aria-current]').forEach((x) => x.removeAttribute('aria-current'));
    b.setAttribute('aria-current', 'true');
    paintCellForm();
    if (editable()) $('qb-f-q').focus();
  });
  const syncCell = () => {
    if (!editable()) return;
    const k = draft.categories[cell.c].clues[cell.r];
    k.q = $('qb-f-q').value.slice(0, 500); k.a = $('qb-f-a').value.slice(0, 200); k.double = $('qb-f-double').checked;
    const b = $('qb-egrid').querySelector(`.qb-ecell[data-c="${cell.c}"][data-r="${cell.r}"]`);
    if (b) { b.classList.toggle('empty', !k.q.trim()); b.classList.toggle('dbl', k.double); b.querySelector('span').textContent = k.q.trim() || 'Empty'; }
    gridEdited();
  };
  ['qb-f-q', 'qb-f-a'].forEach((id) => $(id).addEventListener('input', syncCell));
  $('qb-f-double').addEventListener('change', syncCell);
  // Enter in the answer box moves to the next clue down (then the next column)
  $('qb-f-a').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const n = cell.r < ROWS - 1 ? { c: cell.c, r: cell.r + 1 } : { c: (cell.c + 1) % CATS, r: 0 };
    const b = $('qb-egrid').querySelector(`.qb-ecell[data-c="${n.c}"][data-r="${n.r}"]`);
    if (b) b.click();
  });
  $('qb-play').addEventListener('click', async () => {
    await flushSave();
    if (!editId) return;
    if (editId !== st.boardId) act(() => { st.boardId = editId; st.open = null; });
    editor.close();
    setup.close();
  });

  // keys: Space shows the answer, then goes back; Esc back; 1-4 right, Shift+1-4 wrong; Ctrl+Z undo
  document.addEventListener('keydown', (e) => {
    if (startOn || document.querySelector('dialog[open]') || isTyping(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('qb-undo').click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || !st.open) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (st.open.phase === 'clue') showAnswer();
      else if (st.open.phase === 'answer') closeClue();
    } else if (e.key === 'Escape') {
      if (st.open.phase !== 'wager' || confirm('Close the double without playing it?')) { e.preventDefault(); closeClue(); }
    } else if (st.open.phase === 'answer') {
      const d = /^Digit([1-4])$/.exec(e.code);
      if (d && +d[1] <= st.teams.length) { e.preventDefault(); mark(+d[1] - 1, e.shiftKey ? -1 : 1); }
    }
  });

  window.__quizParse = parseImport;   // for tests
})();
