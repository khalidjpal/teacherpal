// The games' Leaderboard (leaderboard.html): running standings per class,
// summed from every Family Feud and Jeopardy game ended with teams split from
// that period's roster (game_results, recorded by game-end.js), plus hand
// adjustments. Nothing stores a total: standings are worked out here.
//
//   Home          where the page opens: the period, that class's top three,
//                 and the way into everything else.
//   Standings     every student on the roster, ranked by points (ties share a
//                 rank); first in crimson, second and third in violet. ± per
//                 row adjusts a student's points.
//   Games played  every game, newest first, with a switch for whether it
//                 counts. Games from before a Reset stay, marked, and can't
//                 count again.
//   Full screen   the projector view: the top three on a podium, then 4–10.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const GAME_NAMES = { feud: 'Family Feud', quiz: 'Jeopardy' };

  let periodId = null;
  let students = [];
  let games = [];
  let adjustments = [];
  let rows = [];          // the standings: [{ id, name, points, games, adjust, rank }]
  let ready = true;       // false = migration-leaderboard.sql not run
  let loadSeq = 0;
  let adjFor = null;      // the student the adjust dialog is open on

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const fmtPts = (n) => n.toLocaleString();
  const periodName = () => { const o = $('lb-period').selectedOptions[0]; return o && o.value ? o.textContent : ''; };

  // ---------- the standings ----------
  function standings() {
    const by = new Map(students.map((s) => [s.id, { id: s.id, name: s.name, points: 0, games: 0, adjust: 0 }]));
    for (const g of games) {
      if (!g.counts || g.cleared_at) continue;
      for (const t of g.teams || []) for (const m of t.members || []) {
        const r = by.get(m.id);
        if (!r) continue;               // no longer on this roster
        r.points += +m.points || 0;
        r.games++;
      }
    }
    for (const a of adjustments) {
      const r = by.get(a.student_id);
      if (r) { r.points += a.points; r.adjust += a.points; }
    }
    const out = [...by.values()].sort((a, b) => b.points - a.points || b.games - a.games || a.name.localeCompare(b.name));
    out.forEach((r, i) => { r.rank = i > 0 && out[i - 1].points === r.points ? out[i - 1].rank : i + 1; });
    return out;
  }
  const medal = (r) => (r.points > 0 && r.rank <= 3 ? ['gold', 'silver', 'bronze'][r.rank - 1] : '');

  function paintStandings() {
    rows = standings();
    const list = $('lb-list');
    const empty = $('lb-empty');
    if (!periodId) { rows = []; list.replaceChildren(); empty.hidden = false; empty.textContent = 'Add a period in Rosters first.'; return; }
    if (!students.length) { list.replaceChildren(); empty.hidden = false; empty.textContent = 'This class has no students yet.'; return; }
    const anyone = rows.some((r) => r.points || r.games);
    empty.hidden = anyone;
    if (!anyone) empty.textContent = ready
      ? 'No games yet. End a Family Feud or Jeopardy game with teams split from this class, and the points show up here.'
      : 'The leaderboard isn\'t set up yet: run migration-leaderboard.sql in Supabase.';
    list.replaceChildren(...rows.map((r) => {
      const li = el('li', 'lb-row');
      const m = medal(r);
      if (m) li.dataset.medal = m;
      if (!r.points && !r.games) li.classList.add('zero');
      const rank = el('span', 'lb-rank', String(r.rank));
      rank.setAttribute('aria-label', `Rank ${r.rank}`);
      const name = el('span', 'lb-name', r.name);
      name.title = r.name;
      const pts = el('b', 'lb-pts', fmtPts(r.points));
      if (r.adjust) { const a = el('small', 'lb-adj', `${r.adjust > 0 ? '+' : '−'}${fmtPts(Math.abs(r.adjust))} adjusted`); pts.append(a); }
      const gp = el('span', 'lb-games-n', String(r.games));
      gp.setAttribute('aria-label', plural(r.games, 'game'));
      const b = el('button', 'lb-adj-btn icon-btn');
      b.type = 'button'; b.dataset.adjust = r.id; b.disabled = !ready;
      b.title = `Adjust ${r.name}'s points`; b.setAttribute('aria-label', b.title);
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v6M9 8h6M9 17h6"/></svg>';
      li.append(rank, name, pts, gp, b);
      return li;
    }));
  }

  // ---------- the home screen ----------
  function paintHome() {
    const top = rows.filter((r) => r.points > 0).slice(0, 3);
    const none = !top.length;
    $('lb-trio').hidden = none;
    $('lb-none').hidden = !none;
    if (none) {
      const [t, sub] = !ready ? ['Not set up yet', 'Run migration-leaderboard.sql in Supabase.']
        : !periodId ? ['No classes yet', 'Add a period in Rosters.']
        : !students.length ? ['No students yet', 'Add this class in Rosters.']
        : ['No games yet', 'Split this class into teams in Family Feud or Jeopardy, then end the game.'];
      $('lb-none-t').textContent = t;
      $('lb-none-s').textContent = sub;
    }
    // 2nd, 1st, 3rd: the leader in the middle
    $('lb-trio').replaceChildren(...(none ? [] : [1, 0, 2]).map((i) => {
      const r = top[i];
      const li = el('li', 'lb-pod');
      li.dataset.place = String(i + 1);
      if (!r) { li.classList.add('open'); li.append(el('span', 'lb-pod-rank', String(i + 1)), el('span', 'lb-pod-name', '—')); return li; }
      li.dataset.medal = medal(r) || 'bronze';
      const name = el('span', 'lb-pod-name', r.name);
      name.title = r.name;
      const pts = el('b', 'lb-pod-pts', fmtPts(r.points));
      pts.append(el('small', null, ' pts'));
      li.append(el('span', 'lb-pod-rank', String(r.rank)), name, pts);
      return li;
    }));
    const counted = games.filter((g) => g.counts && !g.cleared_at).length;
    $('lb-meta').textContent = ready && periodId && students.length ? `${plural(students.length, 'student')} · ${plural(counted, 'game')}` : '';
    $('lb-go').disabled = !periodId;
    $('lb-go-history').disabled = !periodId;
    $('lb-go-settings').disabled = !ready;
  }

  // ---------- the projector view ----------
  function paintShow() {
    $('lb-show-period').textContent = periodName();
    const top = rows.filter((r) => r.points > 0);
    $('lb-show-empty').hidden = top.length > 0;
    // the podium: 2nd, 1st, 3rd, so the winner stands in the middle
    const podium = top.slice(0, 3);
    const order = podium.length === 3 ? [1, 0, 2] : (podium.length === 2 ? [1, 0] : [0]);
    $('lb-podium').replaceChildren(...(podium.length ? order : []).map((i) => {
      const r = podium[i];
      const li = el('li', 'lb-step');
      li.dataset.medal = medal(r) || 'bronze';
      li.dataset.place = String(i + 1);
      li.append(el('span', 'lb-step-rank', String(r.rank)), el('span', 'lb-step-name', r.name), el('b', 'lb-step-pts', `${fmtPts(r.points)} pts`));
      return li;
    }));
    $('lb-rest').replaceChildren(...top.slice(3, 10).map((r) => {
      const li = el('li', 'lb-rest-row');
      if (medal(r)) li.dataset.medal = medal(r);
      li.append(el('span', 'lb-rank', String(r.rank)), el('span', 'lb-name', r.name), el('b', 'lb-pts', fmtPts(r.points)));
      return li;
    }));
  }

  // ---------- games played ----------
  function scoresLine(g) {
    const frag = document.createDocumentFragment();
    (g.teams || []).forEach((t, i) => {
      if (i) frag.append(el('span', 'lb-sep', '·'));
      const s = el('span', 'lb-ts' + (t.won ? ' won' : ''));
      s.append(el('span', 'lb-tn', t.name), el('b', 'lb-tv', String(t.score)));
      s.title = `${t.name}${t.won ? ' (won)' : ''}: ${(t.members || []).map((m) => m.name).join(', ') || 'no students'}`;
      frag.append(s);
    });
    return frag;
  }
  function fmtWhen(iso) {
    const d = new Date(iso);
    return {
      day: d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
      time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    };
  }
  function paintHistory() {
    const list = $('lb-games');
    const empty = $('lb-hempty');
    empty.hidden = games.length > 0;
    if (!games.length) empty.textContent = ready ? 'No games played with this class yet.' : 'The leaderboard isn\'t set up yet: run migration-leaderboard.sql in Supabase.';
    list.replaceChildren(...games.map((g) => {
      const li = el('li', 'lb-game');
      if (g.cleared_at) li.classList.add('cleared');
      else if (!g.counts) li.classList.add('off');
      const w = fmtWhen(g.played_at);
      const when = el('span', 'lb-when');
      when.append(el('b', null, w.day), el('span', null, w.time));
      const game = el('span', 'lb-gname', GAME_NAMES[g.game] || g.game);
      const set = el('span', 'lb-set', g.set_name || '—');
      set.title = g.set_name || '';
      const sc = el('span', 'lb-scores'); sc.append(scoresLine(g));
      const cell = el('span', 'lb-count');
      if (g.cleared_at) {
        cell.append(el('span', 'lb-tag', 'Before reset'));
        cell.title = `Reset on ${new Date(g.cleared_at).toLocaleDateString()}`;
      } else {
        const b = el('button', 'lb-switch');
        b.type = 'button'; b.setAttribute('role', 'switch');
        b.setAttribute('aria-checked', String(!!g.counts));
        b.dataset.game = g.id;
        b.title = g.counts ? 'Counts toward the standings. Click to leave it out' : 'Left out of the standings. Click to count it';
        b.setAttribute('aria-label', `Count the ${GAME_NAMES[g.game] || ''} game of ${w.day} toward the standings`);
        b.append(el('span', 'lb-knob'), el('span', 'lb-switch-t', g.counts ? 'Counts' : 'Just for fun'));
        cell.append(b);
      }
      li.append(when, game, set, sc, cell);
      return li;
    }));
  }

  // ---------- loading ----------
  async function load() {
    const seq = ++loadSeq;
    if (!periodId) { students = []; games = []; adjustments = []; paintAll(); return; }
    try {
      const [s, g, a] = await Promise.all([
        getStudents(periodId),
        getGameResults(periodId).catch((e) => { if (isMissingTableError(e)) { ready = false; return []; } throw e; }),
        getLeaderboardAdjustments(periodId).catch((e) => { if (isMissingTableError(e)) { ready = false; return []; } throw e; }),
      ]);
      if (seq !== loadSeq) return;
      students = s; games = g; adjustments = a;
      if (!ready) setStatus('The leaderboard needs migration-leaderboard.sql: run it in the Supabase SQL editor.', 'error');
    } catch (err) {
      if (seq === loadSeq) showError(err);
    }
    paintAll();
  }
  function paintAll() {
    paintStandings();
    paintShow();
    paintHistory();
    paintHome();
    $('lb-reset').disabled = !ready || !periodId;
    $('lb-settings-btn').disabled = !ready;
  }

  // ---------- views: home, standings, games played ----------
  const page = document.querySelector('.leaderboard-page');
  function showView(v) {
    page.dataset.view = v;
    // one period select, moved to where it's needed
    const sel = $('lb-period');
    const slot = $(v === 'home' ? 'lb-home-slot' : 'lb-head-slot');
    if (sel.parentNode !== slot) slot.append(sel);
    if (v === 'home') return;
    const hist = v === 'history';
    $('lb-tab-standings').setAttribute('aria-selected', String(!hist));
    $('lb-tab-history').setAttribute('aria-selected', String(hist));
    $('lb-tab-standings').tabIndex = hist ? -1 : 0;
    $('lb-tab-history').tabIndex = hist ? 0 : -1;
    $('lb-standings').hidden = hist;
    $('lb-history').hidden = !hist;
  }
  // keyboard activation (detail 0) moves focus along; a click doesn't leave a ring behind
  $('lb-go').addEventListener('click', (e) => { showView('standings'); if (!e.detail) $('lb-tab-standings').focus(); });
  $('lb-go-history').addEventListener('click', (e) => { showView('history'); if (!e.detail) $('lb-tab-history').focus(); });
  $('lb-back').addEventListener('click', (e) => { showView('home'); if (!e.detail) $('lb-go').focus(); });
  // Esc goes back home (not while a dialog is open, and not the Esc that
  // just left full screen)
  let presentOffAt = 0;
  document.addEventListener('teacherpal:present', (e) => { if (!e.detail || !e.detail.on) presentOffAt = Date.now(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || page.dataset.view === 'home') return;
    if (document.querySelector('dialog[open]') || document.body.classList.contains('present') || Date.now() - presentOffAt < 300) return;
    showView('home');
    $('lb-go').focus();
  });
  $('lb-tab-standings').addEventListener('click', () => showView('standings'));
  $('lb-tab-history').addEventListener('click', () => showView('history'));
  document.querySelector('.lb-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const hist = $('lb-tab-history').getAttribute('aria-selected') !== 'true';
    showView(hist ? 'history' : 'standings');
    $(hist ? 'lb-tab-history' : 'lb-tab-standings').focus();
    e.preventDefault();
  });

  // ---------- counts / just for fun ----------
  $('lb-games').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-game]');
    if (!b) return;
    const g = games.find((x) => x.id === b.dataset.game);
    if (!g || g.cleared_at) return;
    const next = !g.counts;
    g.counts = next; paintAll();
    b.disabled = true;
    try {
      await setGameCounts(g.id, next);
    } catch (err) {
      g.counts = !next; paintAll();
      showError(err);
    }
  });

  // ---------- reset ----------
  $('lb-reset').addEventListener('click', async () => {
    if (!periodId) return;
    const n = periodName() || 'this class';
    if (!confirm(`Reset the ${n} leaderboard?\n\nEveryone goes back to 0 points. The games stay under Games played, marked "Before reset", but no longer count. This can't be undone.`)) return;
    try {
      await resetLeaderboard(periodId);
      setStatus(`${n}'s standings are back to 0.`, 'ok');
      await load();
    } catch (err) { showError(err); }
  });

  // ---------- adjust a student's points ----------
  const adjDlg = $('lb-adjust');
  function paintAdjust() {
    const r = rows.find((x) => x.id === adjFor);
    if (!r) return;
    $('lb-adj-name').textContent = r.name;
    $('lb-adj-total').textContent = `${fmtPts(r.points)} points now`;
    const mine = adjustments.filter((a) => a.student_id === adjFor);
    $('lb-adj-list').replaceChildren(...mine.map((a) => {
      const li = el('li', 'lb-adj-item');
      li.append(el('b', a.points > 0 ? 'plus' : 'minus', `${a.points > 0 ? '+' : '−'}${fmtPts(Math.abs(a.points))}`),
        el('span', 'lb-adj-note', a.note || 'No note'),
        el('span', 'lb-adj-date', new Date(a.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })));
      const x = el('button', 'lb-adj-del icon-btn', '×');
      x.type = 'button'; x.dataset.del = a.id; x.title = 'Remove this adjustment'; x.setAttribute('aria-label', x.title);
      li.append(x);
      return li;
    }));
  }
  $('lb-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-adjust]');
    if (!b) return;
    adjFor = b.dataset.adjust;
    $('lb-adj-points').value = '';
    $('lb-adj-note').value = '';
    $('lb-adj-err').textContent = '';
    paintAdjust();
    adjDlg.showModal();
    $('lb-adj-points').focus();
  });
  $('lb-adj-cancel').addEventListener('click', () => adjDlg.close());
  $('lb-adjust-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = Math.round(+$('lb-adj-points').value);
    if (!n) { $('lb-adj-err').textContent = 'Type how many points to add, or a minus number to take some away.'; return; }
    $('lb-adj-save').disabled = true;
    try {
      const row = await addLeaderboardAdjustment(periodId, adjFor, n, $('lb-adj-note').value);
      adjustments.push(row);
      paintAll();
      adjDlg.close();
    } catch (err) {
      $('lb-adj-err').textContent = `Couldn't save: ${err.message || err}`;
    } finally {
      $('lb-adj-save').disabled = false;
    }
  });
  $('lb-adj-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (!confirm('Remove this adjustment?')) return;
    try {
      await deleteLeaderboardAdjustment(b.dataset.del);
      adjustments = adjustments.filter((a) => a.id !== b.dataset.del);
      paintAll();
      paintAdjust();
    } catch (err) { $('lb-adj-err').textContent = `Couldn't remove it: ${err.message || err}`; }
  });

  // ---------- settings ----------
  const setDlg = $('lb-settings');
  function syncSetMode() { $('lb-wpoints').disabled = !document.querySelector('input[name="lb-wmode"][value="fixed"]').checked; }
  async function openSettings() {
    $('lb-set-err').textContent = '';
    let s = LEADERBOARD_DEFAULTS;
    try { s = await getLeaderboardSettings(); } catch (err) {
      if (isMissingTableError(err)) { setStatus('The leaderboard needs migration-leaderboard.sql: run it in the Supabase SQL editor.', 'error'); return; }
      showError(err);
    }
    document.querySelector(`input[name="lb-wmode"][value="${s.winnerMode}"]`).checked = true;
    $('lb-wpoints').value = s.winnerPoints;
    $('lb-lpoints').value = s.loserPoints;
    syncSetMode();
    setDlg.showModal();
  }
  document.querySelectorAll('input[name="lb-wmode"]').forEach((r) => r.addEventListener('change', syncSetMode));
  $('lb-settings-btn').addEventListener('click', openSettings);
  $('lb-go-settings').addEventListener('click', openSettings);
  $('lb-set-cancel').addEventListener('click', () => setDlg.close());
  $('lb-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('lb-set-save').disabled = true;
    try {
      await saveLeaderboardSettings({
        winnerMode: document.querySelector('input[name="lb-wmode"]:checked').value,
        winnerPoints: $('lb-wpoints').value,
        loserPoints: $('lb-lpoints').value,
      });
      setDlg.close();
      setStatus('Saved.', 'ok');
    } catch (err) {
      $('lb-set-err').textContent = `Couldn't save: ${err.message || err}`;
    } finally {
      $('lb-set-save').disabled = false;
    }
  });

  // ---------- start ----------
  $('lb-period').addEventListener('change', (e) => { periodId = e.target.value || null; setLastPeriodId(periodId); load(); });
  // another tab ended a game: catch up on coming back
  document.addEventListener('visibilitychange', () => { if (!document.hidden && periodId) load(); });

  showView('home');
  (async () => {
    try {
      const periods = (typeof navReady !== 'undefined' ? (await navReady).periods : null) || await getPeriods();
      periodId = fillPeriodSelect($('lb-period'), periods) || null;
    } catch (err) { showError(err); }
    await load();
    if (location.hash === '#settings' && ready) openSettings();
  })();
})();
