// Ending a game: the "End the game" dialog both games share (Family Feud and
// Jeopardy load it in their main tab; the projector windows don't). It shows
// the final scores and the winner, and, when the teams were split from a
// class roster, what each player earns on that period's Leaderboard (the
// teacher's settings, leaderboardAwards() in shared.js) with a "Count this
// game" switch, then records the game (recordGameResult) and hands back to
// the game, which starts fresh. Teams that are just names aren't recorded.
//
// openGameEnd({
//   game: 'feud' | 'quiz', palette: 'sd-game' | 'qb-game',
//   setId, setName,
//   teams: [{ name, score, members: [label] }],
//   roster: null | { periodId, periodName, students: { label: { id, name } } },
//   onEnd(saved: boolean),            // the game resets itself here
// })
(function () {
  'use strict';

  let dlg = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function build() {
    dlg = el('dialog', 'sd-dialog ge-dialog');
    dlg.setAttribute('aria-labelledby', 'ge-title');
    dlg.innerHTML = `
      <div class="sd-dialog-inner">
        <header class="sd-dialog-head"><h2 id="ge-title">End the game</h2></header>
        <div class="sd-dialog-body">
          <ol class="ge-scores" id="ge-scores"></ol>
          <p class="ge-winner" id="ge-winner"></p>
          <section class="ge-lb" id="ge-lb">
            <h3 class="ge-lb-h" id="ge-lb-h"></h3>
            <ul class="ge-awards" id="ge-awards"></ul>
            <label class="ge-count"><input type="checkbox" id="ge-counts" checked> <span>Count this game on the leaderboard</span></label>
            <p class="ge-note"><a href="leaderboard.html#settings" target="_blank" rel="noopener" class="ge-link">Change how points work</a></p>
          </section>
          <p class="ge-off" id="ge-off" hidden></p>
          <p class="ge-err" id="ge-err" role="alert"></p>
        </div>
        <footer class="sd-dialog-foot">
          <button type="button" id="ge-cancel">Keep playing</button>
          <button type="button" id="ge-go" class="primary">End game</button>
        </footer>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#ge-cancel').addEventListener('click', () => dlg.close());
  }

  async function openGameEnd(o) {
    if (!dlg) build();
    dlg.className = `sd-dialog ge-dialog ${o.palette || 'sd-game'}`;
    const $ = (id) => dlg.querySelector('#' + id);
    const err = $('ge-err'); err.textContent = '';

    // the scores, highest first
    const order = o.teams.map((t, k) => k).sort((a, b) => o.teams[b].score - o.teams[a].score);
    const scores = $('ge-scores');
    const placeholder = leaderboardAwards(o.teams, null);
    scores.replaceChildren(...order.map((k) => {
      const t = o.teams[k];
      const li = el('li', 'ge-team' + (placeholder[k].won ? ' won' : ''));
      li.append(el('span', 'ge-tname', t.name), el('b', 'ge-tscore', String(t.score)));
      if (placeholder[k].won) li.append(el('span', 'ge-tag', 'Winner'));
      return li;
    }));
    const winners = o.teams.filter((_, k) => placeholder[k].won).map((t) => t.name);
    $('ge-winner').textContent = (winners.length === 1 ? `${winners[0]} win${/s$/i.test(winners[0]) ? '' : 's'}!` : `${winners.join(' and ')} tie for the win!`);

    // who's on the roster, team by team
    const roster = o.roster && o.roster.periodId ? o.roster : null;
    const ids = o.teams.map((t) => t.members.map((m) => roster && roster.students[m]).filter(Boolean));
    const recordable = !!roster && ids.some((list) => list.length);
    let ready = recordable;
    let settings = null;
    $('ge-lb').hidden = true;
    $('ge-off').hidden = true;
    const go = $('ge-go');
    go.textContent = 'End game';
    go.disabled = false;
    if (!recordable) {
      $('ge-off').hidden = false;
      $('ge-off').textContent = "These teams weren't split from a class roster, so this game won't go on the leaderboard. To record one, split a class into teams in Game setup → Teams.";
    }
    if (!dlg.open) dlg.showModal();
    go.focus();

    if (recordable) {
      go.disabled = true;
      try {
        settings = await getLeaderboardSettings();
      } catch (e) {
        if (typeof isMissingTableError === 'function' && isMissingTableError(e)) {
          ready = false;
          $('ge-off').hidden = false;
          $('ge-off').textContent = "The leaderboard isn't set up yet, so this game won't be recorded. Run migration-leaderboard.sql in Supabase to turn it on.";
        } else settings = null;   // can't read them: the defaults
      }
      go.disabled = false;
      if (ready) {
        const awards = leaderboardAwards(o.teams, settings);
        $('ge-lb').hidden = false;
        $('ge-lb-h').textContent = `Leaderboard · ${roster.periodName || 'this class'}`;
        $('ge-awards').replaceChildren(...order.map((k) => {
          const li = el('li', 'ge-award' + (awards[k].won ? ' won' : ''));
          li.append(el('span', 'ge-aname', `${o.teams[k].name} (${plural(ids[k].length, 'student')})`), el('b', 'ge-apts', `+${awards[k].points} each`));
          return li;
        }));
        $('ge-counts').checked = true;
        go.textContent = 'End and save';
      }
    }

    go.onclick = async () => {
      err.textContent = '';
      if (!ready) { dlg.close(); o.onEnd(false); return; }
      const awards = leaderboardAwards(o.teams, settings);
      const teams = o.teams.map((t, k) => ({
        name: t.name, score: t.score, won: awards[k].won,
        members: ids[k].map((s) => ({ id: s.id, name: s.name, points: awards[k].points })),
      }));
      go.disabled = true;
      try {
        await recordGameResult({ periodId: roster.periodId, game: o.game, setId: o.setId, setName: o.setName, teams, counts: $('ge-counts').checked });
        dlg.close();
        o.onEnd(true);
      } catch (e) {
        err.textContent = `Couldn't save the game: ${e.message || e}. Try again, or press Keep playing.`;
      } finally {
        go.disabled = false;
      }
    };
  }

  window.openGameEnd = openGameEnd;
})();
