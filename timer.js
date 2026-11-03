// timer.js — countdown + stopwatch for the classroom projector.
//
// End-timestamp model: the source of truth is `state.endsAt` (countdown) or
// `state.startedAt` (stopwatch). Every window computes the display from
// Date.now() against those anchors, so background-throttled tabs, popouts,
// and PiP all show the same time without ticking-drift.
//
// Two views:
//   • main window (this file, when body has no .timer-popout class)
//     — full controls, inputs, presets, extras
//   • popout / PiP (timer-popout.html) — read-only display, syncs via
//     BroadcastChannel('teacherpal-timer'). Also used inside PiP windows.
//
// The main view is the only writer. Popouts request state on open and
// re-render from broadcasts. Closing a popout does NOT stop the timer;
// state lives in the main window (and its localStorage) so it survives.

(function () {
  const isPopout = document.body.classList.contains('timer-popout');
  const CH = 'teacherpal-timer';
  const STORE_KEY = 'teacherpal.timer.state';
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel(CH) : null;

  const defaultState = () => ({
    mode:     'countdown',        // 'countdown' | 'stopwatch'
    running:  false,
    paused:   false,
    label:    '',
    muted:    false,
    // countdown
    targetMs: 5 * 60 * 1000,
    endsAt:   null,               // ms epoch when running; null otherwise
    remainingAtPause: null,       // ms remaining while paused
    // stopwatch
    startedAt: null,              // ms epoch when running
    elapsedAtPause: null,         // ms elapsed while paused
    // countdown reached 0:00 and is sitting there. The timer auto-pauses at
    // zero, so without this flag the "time's up" state (flash / celebration)
    // would vanish one frame after it appeared. Cleared by start/reset/±/mode.
    zeroed: false,
  });

  let state = defaultState();
  let pipWin = null;
  let pipTick = null;
  let alertedZero = false;        // debounce zero-alert so we don't beep every frame

  // --------- persistence ---------
  function loadState() {
    if (isPopout) return;   // popout receives from broadcast
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && typeof s === 'object') state = { ...defaultState(), ...s };
    } catch { /* ignore */ }
  }
  function saveState() {
    if (isPopout) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }
  function broadcast() {
    if (bc) bc.postMessage({ type: 'state', state });
  }
  function commit() {
    saveState();
    broadcast();
    render();
    updatePip();
  }

  // --------- time math ---------
  function remainingMs(now = Date.now()) {
    if (state.mode !== 'countdown') return 0;
    if (state.zeroed) return 0;   // sitting at 0:00 after the auto-pause
    if (state.running && state.endsAt != null) return Math.max(0, state.endsAt - now);
    if (state.paused && state.remainingAtPause != null) return state.remainingAtPause;
    return state.targetMs;
  }
  function elapsedMs(now = Date.now()) {
    if (state.mode !== 'stopwatch') return 0;
    if (state.running && state.startedAt != null) return now - state.startedAt;
    if (state.paused && state.elapsedAtPause != null) return state.elapsedAtPause;
    return 0;
  }
  function displayMs(now = Date.now()) {
    return state.mode === 'countdown' ? remainingMs(now) : elapsedMs(now);
  }
  function progress(now = Date.now()) {
    // 0..1 filled ratio (countdown: how much time consumed; stopwatch: unused)
    if (state.mode !== 'countdown' || !state.targetMs) return 0;
    return Math.min(1, Math.max(0, 1 - remainingMs(now) / state.targetMs));
  }
  function fmt(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  // --------- dial construction ---------
  // One SVG serves both themes: default lights SEGMENTS (they go dark one by
  // one as time runs out) over an instrument-style inner dial; pink draws the
  // smooth gradient arc instead. CSS decides which parts are visible, so this
  // builds everything once per document (page, pop-out and PiP each call it).
  const SEGMENTS = 60;        // one per second of a minute — reads as a clock
  const MARKS = 36;           // inner dial degree markings, every 10°

  // thanksgiving's dial: a pumpkin pie seen from above, in PIE_SLICES slices
  // that lift away one by one as time runs down (paintDial), leaving the dish.
  // Hidden by CSS in the other themes.
  const PIE_SLICES = 8;
  const pt = (r, deg) => {
    const a = deg * Math.PI / 180;
    return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
  };
  const wedge = (r, a0, a1) => `M50 50 L${pt(r, a0)} A${r} ${r} 0 0 1 ${pt(r, a1)} Z`;
  function pieSvg() {
    const step = 360 / PIE_SLICES;
    let slices = '';
    for (let i = 0; i < PIE_SLICES; i++) {
      const a0 = -90 + i * step, a1 = a0 + step, mid = (a0 + a1) / 2;
      const out = mid * Math.PI / 180;
      // the crimped edge: overlapping scallops pinched by a dark crease, each
      // with a baked highlight on its outer curve
      const crimps = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => {
        const a = a0 + step * f;
        const [x, y] = pt(37.6, a).split(' ');
        return `<ellipse class="tg-crimp" cx="${x}" cy="${y}" rx="2.9" ry="1.9" transform="rotate(${(a + 90).toFixed(1)} ${x} ${y})"/>`
          + `<path class="tg-crimp-hi" d="M${pt(38.6, a - 4)} A38.6 38.6 0 0 1 ${pt(38.6, a + 4)}"/>`;
      }).join('');
      slices += `<g class="tg-slice" style="--dx:${(Math.cos(out) * 9).toFixed(2)};--dy:${(Math.sin(out) * 9).toFixed(2)}">
          <path class="tg-crust" d="${wedge(40, a0, a1)}"/>
          <path class="tg-filling" d="${wedge(34, a0, a1)}"/>
          ${crimps}
          <path class="tg-shine" d="M${pt(23, a0 + 9)} A23 23 0 0 1 ${pt(23, a1 - 9)}"/>
          <path class="tg-cut" d="M50 50 L${pt(40, a0)}M50 50 L${pt(40, a1)}"/>
        </g>`;
    }
    const crumbs = [[30, 38, 0.9], [66, 30, 0.7], [72, 62, 1], [38, 70, 0.8], [56, 74, 0.6], [26, 56, 0.7], [62, 44, 0.5]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
    return `<svg class="tg-pie" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="tg-g-fill" cx="50%" cy="50%" r="50%"><stop offset="0"/><stop offset="0.7"/><stop offset="1"/></radialGradient>
          <radialGradient id="tg-g-well" cx="42%" cy="38%" r="70%"><stop offset="0"/><stop offset="1"/></radialGradient>
        </defs>
        <ellipse class="tg-shadow" cx="50" cy="52.5" rx="47" ry="46.5"/>
        <circle class="tg-dish" cx="50" cy="50" r="47"/>
        <circle class="tg-dish-rim" cx="50" cy="50" r="43.6"/>
        <circle class="tg-dish-well" cx="50" cy="50" r="41.6"/>
        <g class="tg-crumbs">${crumbs}</g>
        <g class="tg-slices">${slices}</g>
        <g class="tg-steam"><path d="M41 40q-3-5 0-10t0-10"/><path d="M50 37q3-5 0-10t0-10"/><path d="M59 40q-3-5 0-10t0-10"/></g>
        <g class="tg-fork"><g transform="translate(87.5 86.5) rotate(38) scale(1.15)">
          <path class="tg-tines" d="M-3.6 -14.5H-2.6V-8.5H-1.4V-14.5H-0.4V-8.5H0.4V-14.5H1.4V-8.5H2.6V-14.5H3.6V-7Q3.6 -4 1.2 -2.6V0H-1.2V-2.6Q-3.6 -4 -3.6 -7Z"/>
          <path class="tg-handle" d="M-1.2 0L-1.8 12Q-1.8 15 0 15Q1.8 15 1.8 12L1.2 0Z"/>
          <path class="tg-fork-hi" d="M-0.5 1.5L-0.85 12"/>
        </g></g>
      </svg>`;
  }

  // winter's dial: a snowman who melts as the time runs down (paintSnowman).
  // Built once, hidden by CSS in the other themes. The balls are ellipses
  // whose cx/cy/rx/ry are set as CSS properties, so they ease between ticks.
  // Feet on the snow at y 95 of the 100-unit box.
  const SM_G = 95;
  function snowmanSvg() {
    return `<svg class="wt-snowman" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <ellipse class="wt-ground" cx="50" cy="96.6" rx="47" ry="3.6"/>
        <g class="wt-puddle"><ellipse class="wt-pool" cx="50" cy="95.6" rx="8" ry="1.5"/><ellipse class="wt-pool-hi" cx="44" cy="95" rx="3" ry=".5"/></g>
        <g class="wt-man">
          <g class="wt-arm l"><path class="wt-stick" d="M0 0L-13-9M-8-5.4L-10.4-11M-11-7.6L-16.6-8"/></g>
          <g class="wt-arm r"><path class="wt-stick" d="M0 0L13-9M8-5.4L10.4-11M11-7.6L16.6-8"/></g>
          <ellipse class="wt-ball wt-b0" cx="50" cy="75" rx="20" ry="20"/>
          <ellipse class="wt-ball wt-b1" cx="50" cy="42" rx="17" ry="17"/>
          <g class="wt-buttons"><circle cx="0" cy="-7" r="1.5"/><circle cx="0" cy="0" r="1.5"/><circle cx="0" cy="7" r="1.5"/></g>
          <g class="wt-scarf"><path class="wt-scarf-band" d="M-11-1.6Q0 2.4 11-1.6V2.2Q0 6.2-11 2.2Z"/><path class="wt-scarf-tail" d="M5 1.6L9.4 14.6 4.2 15.4 1.6 2.6Z"/><path class="wt-scarf-stripe" d="M5.8 6.2L7.6 5.8M6.8 10L8.6 9.6"/></g>
          <ellipse class="wt-ball wt-b2" cx="50" cy="16" rx="9.5" ry="9.5"/>
          <g class="wt-face">
            <g class="wt-calm"><circle cx="-3.4" cy="-2.4" r="1.15"/><circle cx="2.6" cy="-2.4" r="1.15"/><path d="M-4.4 2.8Q-.6 6 3.4 2.8"/></g>
            <g class="wt-alarm"><circle class="wt-eye-w" cx="-3.6" cy="-2.4" r="2"/><circle class="wt-eye-w" cx="2.8" cy="-2.4" r="2"/><circle cx="-3.4" cy="-2.2" r=".95"/><circle cx="2.6" cy="-2.2" r=".95"/><path class="wt-brow" d="M-5.6-6.2L-1.8-5.4M5-6.2L1.2-5.4"/><ellipse cx="-.4" cy="4.2" rx="1.6" ry="2"/></g>
            <g class="wt-sweat"><path d="M7.4-6Q8.8-3.6 7.4-2.6Q6-3.6 7.4-6Z"/><path d="M-8.4-3Q-7.2-.8-8.4.2Q-9.6-.8-8.4-3Z"/></g>
          </g>
          <g class="wt-carrot"><path d="M0-.9L-9.5 .3 0 1.4Z"/><path class="wt-carrot-l" d="M-3 .1L-3.6 1M-6 .4L-6.4 1"/></g>
          <g class="wt-hat"><rect class="wt-hat-crown" x="-6.6" y="-11" width="13.2" height="11" rx="1"/><rect class="wt-hat-band" x="-6.6" y="-3.6" width="13.2" height="2.6"/><rect class="wt-hat-brim" x="-10.4" y="-1.4" width="20.8" height="2.4" rx="1.2"/></g>
          <g class="wt-coal"><circle cx="38" cy="95.4" r="1.1"/><circle cx="45" cy="96.4" r=".9"/><circle cx="57" cy="95.8" r="1"/></g>
        </g>
        <text class="wt-aww" x="50" y="78">aww…</text>
      </svg>`;
  }
  // m: how melted, 0 (whole) .. 1 (a puddle); alarm 0..1 in the final minute.
  // The head lasts: it shrinks and sinks into the slush but keeps its face to
  // the end, so the final minute's alarm is always visible.
  function paintSnowman(wrap, m, alarm, done) {
    const svg = wrap.querySelector('.wt-snowman');
    if (!svg) return;
    const cl = (v) => Math.max(0, Math.min(1, v));
    const a = cl(m / 0.45), b = cl((m - 0.3) / 0.45), c = cl((m - 0.6) / 0.4);
    // the bottom ball spreads first, then the middle, then the head sinks
    const b0 = { rx: 20 * (1 + 0.75 * a + 0.35 * b), ry: 20 * Math.max(0.1, 1 - 0.6 * a - 0.3 * b) };
    const b1 = { rx: 17 * (1 + 0.45 * b + 0.25 * c), ry: 17 * Math.max(0.08, 1 - 0.6 * b - 0.32 * c) };
    const b2 = { rx: 9.5 * (1 + 0.1 * c), ry: 9.5 * (1 - 0.3 * c) };
    b0.cy = SM_G - b0.ry;
    b1.cy = SM_G - 2 * b0.ry + 3 * (b0.ry / 20) - b1.ry;
    const top1 = b1.cy - b1.ry;
    b2.cy = top1 + 2.4 - b2.ry + 3 * c;
    const top2 = b2.cy - b2.ry;
    const set = (el, o) => { if (el) for (const k of ['rx', 'ry', 'cy']) if (o[k] !== undefined) el.style[k] = o[k].toFixed(2) + 'px'; };
    if (done) {   // all of him is puddle now
      Object.assign(b0, { rx: 40, ry: 0.4, cy: SM_G });
      Object.assign(b1, { rx: 30, ry: 0.3, cy: SM_G });
      Object.assign(b2, { rx: 12, ry: 0.2, cy: SM_G });
    }
    set(svg.querySelector('.wt-b0'), b0);
    set(svg.querySelector('.wt-b1'), b1);
    set(svg.querySelector('.wt-b2'), b2);
    const put = (sel, x, y, r = 0, sx = 1, sy = sx) => { const el = svg.querySelector(sel); if (el) el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`; };
    set(svg.querySelector('.wt-pool'), { rx: 8 + m * 38, ry: 1.5 + m * 3.4 });
    svg.dataset.done = done ? '1' : '';
    if (done) {
      // just the hat, the carrot and the scarf, lying in the puddle
      put('.wt-hat', 60, 95.2, -16, 0.9);
      put('.wt-carrot', 45, 95.2, -6);
      put('.wt-scarf', 50, 94.4, 0, 0.9, 0.7);
      put('.wt-arm.l', 31, 96, -30);
      put('.wt-arm.r', 70, 96.4, 32);
      put('.wt-face', 50, 104, 0, 0.001);
      put('.wt-buttons', 50, 104, 0, 0.001);
    } else {
      const hs = b2.ry / 9.5;
      put('.wt-hat', 50 + 1.4 * c, top2 + 1.4, -8 - 14 * c, 0.9 + 0.1 * hs);
      put('.wt-face', 50, b2.cy, 0, hs);
      put('.wt-carrot', 46.6 + 0.2 * c, b2.cy + 0.8 * hs, -6 * c - 4 * b, hs);
      put('.wt-scarf', 50, top1 + 1.2, 0, 1 + 0.3 * b + 0.2 * c, 1);
      // the sticks droop as the middle goes, but never below the slush
      const ay = Math.min(b1.cy - 3 * (b1.ry / 17), SM_G - 5);
      put('.wt-arm.l', 50 - b1.rx * 0.92, ay, -24 * b - 10 * c);
      put('.wt-arm.r', 50 + b1.rx * 0.92, ay, 24 * b + 10 * c);
      put('.wt-buttons', 50, b0.cy, 0, 1, Math.max(0.001, b0.ry / 20));
    }
    const btn = svg.querySelector('.wt-buttons');
    if (btn) btn.style.opacity = done ? 0 : Math.max(0, Math.min(1, (b0.ry - 9) / 5)).toFixed(2);
    // the digits ride on his middle; once it's too small for them they
    // float above him (frost on the night)
    const air = done || b1.ry < 10.5;
    wrap.dataset.digs = air ? 'air' : '';
    wrap.style.setProperty('--dig-y', (air ? (done ? 56 : Math.min(40, top2 - 14)) : b1.cy).toFixed(2));
    wrap.style.setProperty('--alarm', alarm.toFixed(3));
  }
  function buildDial(doc = document) {
    const NS = 'http://www.w3.org/2000/svg';
    const wrap = doc.getElementById('timer-dial-wrap');
    if (wrap && !wrap.querySelector('.tg-pie')) wrap.insertAdjacentHTML('afterbegin', pieSvg());
    if (wrap && !wrap.querySelector('.wt-snowman')) wrap.insertAdjacentHTML('afterbegin', snowmanSvg());
    const segs = doc.getElementById('timer-segs');
    const marks = doc.getElementById('timer-marks');
    const burst = doc.getElementById('timer-burst');
    if (segs && !segs.childElementCount) {
      for (let i = 0; i < SEGMENTS; i++) {
        const l = doc.createElementNS(NS, 'line');
        l.setAttribute('x1', '50'); l.setAttribute('y1', '5.5');
        l.setAttribute('x2', '50'); l.setAttribute('y2', '10.5');
        l.setAttribute('transform', `rotate(${(360 / SEGMENTS) * i} 50 50)`);
        segs.appendChild(l);
      }
    }
    if (marks && !marks.childElementCount) {
      for (let i = 0; i < MARKS; i++) {
        const long = i % 3 === 0;                       // a longer mark every 30°
        const l = doc.createElementNS(NS, 'line');
        l.setAttribute('x1', '50'); l.setAttribute('y1', long ? '15.5' : '16.5');
        l.setAttribute('x2', '50'); l.setAttribute('y2', '18.5');
        l.setAttribute('transform', `rotate(${(360 / MARKS) * i} 50 50)`);
        if (long) l.setAttribute('class', 'long');
        marks.appendChild(l);
      }
    }
    // pink's zero celebration: a few hearts + sparkles that fly outward
    if (burst && !burst.childElementCount) {
      for (let i = 0; i < 8; i++) {
        const bit = doc.createElement('i');
        bit.className = i % 2 ? 'spark' : 'heart';
        bit.style.setProperty('--i', String(i));
        burst.appendChild(bit);
      }
    }
  }

  // --------- audio (zero alert) ---------
  let audioCtx = null;
  function beep() {
    if (state.muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const times = [0, 0.35, 0.7];
      for (const t of times) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0, audioCtx.currentTime + t);
        gain.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.3);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + t);
        osc.stop(audioCtx.currentTime + t + 0.35);
      }
    } catch { /* ignore */ }
  }

  // --------- main-window init ---------
  if (!isPopout) {
    loadState();
    document.addEventListener('DOMContentLoaded', () => {
      buildDial(document);
      wireControls();
      render();
      startLoop();
      if (bc) bc.onmessage = (ev) => {
        if (ev.data && ev.data.type === 'request-state') broadcast();
      };
    });
  } else {
    // popout
    document.addEventListener('DOMContentLoaded', () => {
      buildDial(document);
      if (bc) bc.onmessage = (ev) => {
        if (ev.data && ev.data.type === 'state') {
          state = { ...defaultState(), ...ev.data.state };
          render();
        }
      };
      // ask the main window to send state
      if (bc) bc.postMessage({ type: 'request-state' });
      // fallback if main isn't around: read from localStorage
      loadState();
      render();
      startLoop();
    });
  }

  // --------- controls (main only) ---------
  function wireControls() {
    // mode
    document.querySelectorAll('input[name="timer-mode"]').forEach((r) => {
      r.checked = state.mode === r.value;
      r.addEventListener('change', () => {
        if (!r.checked) return;
        // reset when switching modes so leftover run-state doesn't carry over
        state.mode = r.value;
        state.running = false;
        state.paused = false;
        state.endsAt = null;
        state.remainingAtPause = null;
        state.startedAt = null;
        state.elapsedAtPause = null;
        state.zeroed = false;
        alertedZero = false;
        commit();
      });
    });

    // label
    const labelIn = document.getElementById('timer-label-in');
    labelIn.value = state.label || '';
    labelIn.addEventListener('input', () => { state.label = labelIn.value.trim(); commit(); });

    // preset buttons
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const seconds = Number(b.dataset.preset);
      setTarget(seconds * 1000);
    }));

    // min/sec inputs
    const minsIn = document.getElementById('timer-mins');
    const secsIn = document.getElementById('timer-secs');
    minsIn.value = Math.floor(state.targetMs / 60000);
    secsIn.value = Math.floor((state.targetMs % 60000) / 1000);
    const readCustom = () => setTarget((Math.max(0, Number(minsIn.value) || 0) * 60 + Math.max(0, Number(secsIn.value) || 0)) * 1000);
    minsIn.addEventListener('change', readCustom);
    secsIn.addEventListener('change', readCustom);

    // start/pause/resume
    document.getElementById('timer-start').addEventListener('click', () => {
      if (state.running) return pause();
      if (state.paused) return resume();
      return start();
    });
    document.getElementById('timer-reset').addEventListener('click', reset);
    document.getElementById('timer-plus').addEventListener('click', () => adjust(+60_000));
    document.getElementById('timer-minus').addEventListener('click', () => adjust(-60_000));

    // mute
    const mute = document.getElementById('timer-mute');
    mute.setAttribute('aria-checked', String(state.muted));
    mute.addEventListener('click', () => { state.muted = !state.muted; mute.setAttribute('aria-checked', String(state.muted)); commit(); });

    // pop out
    document.getElementById('timer-popout').addEventListener('click', openPopout);

    // pip (Chrome-only)
    const pipBtn = document.getElementById('timer-pip');
    if ('documentPictureInPicture' in window) {
      pipBtn.hidden = false;
      pipBtn.addEventListener('click', openPip);
    }
  }

  function setTarget(ms) {
    if (state.mode !== 'countdown') return;
    if (state.running || state.paused) return;   // don't shift a live timer via presets
    state.targetMs = Math.max(0, ms);
    state.zeroed = false;
    alertedZero = false;
    const minsIn = document.getElementById('timer-mins');
    const secsIn = document.getElementById('timer-secs');
    if (minsIn) minsIn.value = Math.floor(state.targetMs / 60000);
    if (secsIn) secsIn.value = Math.floor((state.targetMs % 60000) / 1000);
    commit();
  }

  function start() {
    alertedZero = false;
    state.zeroed = false;
    const now = Date.now();
    if (state.mode === 'countdown') {
      if (state.targetMs <= 0) return;
      state.endsAt = now + state.targetMs;
    } else {
      state.startedAt = now;
    }
    state.running = true; state.paused = false;
    commit();
  }
  function pause() {
    const now = Date.now();
    if (state.mode === 'countdown') {
      state.remainingAtPause = Math.max(0, (state.endsAt || now) - now);
      state.endsAt = null;
    } else {
      state.elapsedAtPause = now - (state.startedAt || now);
      state.startedAt = null;
    }
    state.running = false; state.paused = true;
    commit();
  }
  function resume() {
    const now = Date.now();
    if (state.mode === 'countdown') {
      state.endsAt = now + (state.remainingAtPause || 0);
      state.remainingAtPause = null;
    } else {
      state.startedAt = now - (state.elapsedAtPause || 0);
      state.elapsedAtPause = null;
    }
    state.running = true; state.paused = false;
    commit();
  }
  function reset() {
    state.running = false; state.paused = false;
    state.endsAt = null; state.remainingAtPause = null;
    state.startedAt = null; state.elapsedAtPause = null;
    state.zeroed = false;
    alertedZero = false;
    commit();
  }
  function adjust(ms) {
    if (state.mode !== 'countdown') return;
    if (ms > 0) { state.zeroed = false; alertedZero = false; }   // +1 min after zero clears it
    if (state.running) {
      state.endsAt = (state.endsAt || Date.now()) + ms;
    } else if (state.paused) {
      state.remainingAtPause = Math.max(0, (state.remainingAtPause || 0) + ms);
    } else {
      state.targetMs = Math.max(0, state.targetMs + ms);
      const minsIn = document.getElementById('timer-mins');
      const secsIn = document.getElementById('timer-secs');
      if (minsIn) minsIn.value = Math.floor(state.targetMs / 60000);
      if (secsIn) secsIn.value = Math.floor((state.targetMs % 60000) / 1000);
    }
    commit();
  }

  // --------- render ---------
  function classifyDisplay(now) {
    // last minute warn, zero alert (countdown only)
    if (state.mode !== 'countdown') return '';
    if (state.zeroed) return 'alert';            // holds after the auto-pause
    if (!state.running && !state.paused) return '';
    const r = remainingMs(now);
    if (r <= 0) return 'alert';
    if (r <= 60_000) return 'warn';
    return '';
  }

  // Paint the dial in whichever document it lives in (page, pop-out or PiP).
  function paintDial(doc, now) {
    const wrap = doc.getElementById('timer-dial-wrap');
    if (!wrap) return;
    const arc = doc.getElementById('timer-arc');
    const segs = doc.getElementById('timer-segs');
    const mascot = doc.getElementById('timer-mascot');
    const st = classifyDisplay(now);
    const countdown = state.mode === 'countdown';
    const remaining = countdown ? 1 - progress(now) : 1;

    wrap.dataset.state = st;                 // '' | 'warn' | 'alert' — drives pulse/flash/burst
    wrap.dataset.mode = state.mode;          // stopwatch hides the progress, keeps the dial frame

    if (arc) arc.setAttribute('stroke-dashoffset', String(1 - remaining));
    // the halloween pumpkin drains by this; its digits size by their length
    wrap.style.setProperty('--remaining', remaining.toFixed(4));
    const disp = doc.getElementById('timer-display') || doc.getElementById('pip-display');
    if (disp) disp.dataset.len = String(disp.textContent.length);
    if (segs) {
      const lit = Math.round(remaining * SEGMENTS);
      const lines = segs.children;
      for (let i = 0; i < lines.length; i++) lines[i].classList.toggle('off', i >= lit);
    }
    // thanksgiving's pie: one slice per eighth of the time; the last goes at zero
    const slices = wrap.querySelectorAll('.tg-slice');
    if (slices.length) {
      const lit = countdown ? Math.ceil(remaining * slices.length - 1e-6) : slices.length;
      slices.forEach((el, i) => el.classList.toggle('gone', i >= lit));
    }
    // winter's snowman: melts with the time; alarmed through the final minute
    if (wrap.querySelector('.wt-snowman')) {
      const left = countdown && (state.running || state.paused || state.zeroed) ? remainingMs(now) : Infinity;
      paintSnowman(wrap, countdown ? 1 - remaining : 0, left <= 60_000 ? Math.max(0, Math.min(1, 1 - left / 60_000)) : 0, st === 'alert');
    }
    const mood = st === 'alert' ? 'party' : (st === 'warn' ? 'excited' : (state.running ? 'calm' : 'idle'));
    wrap.dataset.mood = mood;                // pink's bunny: calm / excited / party
    if (mascot) mascot.dataset.mood = mood;
  }

  function render(now = Date.now()) {
    const disp = document.getElementById('timer-display');
    const lbl  = document.getElementById('timer-label');
    const startBtn = document.getElementById('timer-start');
    const setup    = document.getElementById('timer-setup');
    const plus     = document.getElementById('timer-plus');
    const minus    = document.getElementById('timer-minus');
    if (!disp) return;

    disp.textContent = fmt(displayMs(now));
    disp.className   = 'timer-display ' + classifyDisplay(now);
    lbl.textContent  = state.label || '';
    lbl.classList.toggle('empty', !state.label);

    if (startBtn) {
      startBtn.textContent = state.running ? 'Pause' : (state.paused ? 'Resume' : 'Start');
      startBtn.classList.toggle('primary', !state.running);
    }
    // Nothing appears or disappears between states, so nothing on the page moves
    // when you press Start: the setup row and ±1 min are always there and are
    // only disabled when they don't apply.
    const setupOff = state.mode !== 'countdown' || state.running || state.paused;
    const nudgeOff = state.mode !== 'countdown' || (!state.running && !state.paused);
    if (setup) {
      setup.classList.toggle('locked', setupOff);
      setup.querySelectorAll('input, button').forEach((el) => { el.disabled = setupOff; });
    }
    if (plus)  plus.disabled  = nudgeOff;
    if (minus) minus.disabled = nudgeOff;

    paintDial(document, now);

    // beep on transition to zero
    if (state.mode === 'countdown' && state.running && remainingMs(now) <= 0 && !alertedZero) {
      alertedZero = true;
      beep();
      // auto-pause at zero; `zeroed` keeps the time's-up state on screen
      if (!isPopout) {
        state.running = false; state.paused = false; state.endsAt = null;
        state.zeroed = true;
        saveState(); broadcast();
      }
    }
  }

  function startLoop() {
    function tick() {
      render();
      updatePip();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // --------- pop out (window.open) ---------
  function openPopout() {
    const w = window.open('timer-popout.html', 'teacherpal-timer', 'popup=yes,width=720,height=420');
    if (w) w.focus();
    // Broadcast so the new window's onload gets state right away
    setTimeout(() => broadcast(), 300);
  }

  // --------- Picture-in-Picture (Chrome) ---------
  async function openPip() {
    if (!('documentPictureInPicture' in window)) return;
    try {
      pipWin = await documentPictureInPicture.requestWindow({ width: 420, height: 260 });
    } catch { return; }
    // copy the stylesheets (style.css + the Google Fonts sheet, so the theme's
    // faces — Share Tech Mono, halloween's Pirata One — load there too) + set theme
    document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
      const link = pipWin.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = l.href;
      pipWin.document.head.appendChild(link);
    });
    pipWin.document.documentElement.setAttribute('data-theme',
      document.documentElement.getAttribute('data-theme') || 'default');
    pipWin.document.body.className = 'timer-popout';
    pipWin.document.body.innerHTML = `
      <div class="timer-popout-inner">
        <div class="timer-label" id="pip-label"></div>
        <div class="timer-display-wrap" id="timer-dial-wrap" data-state="" data-mode="countdown">
          <svg class="timer-dial" id="timer-dial" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="timer-arc-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop class="arc-from" offset="0%"/>
                <stop class="arc-to" offset="100%"/>
              </linearGradient>
            </defs>
            <circle class="dial-track" cx="50" cy="50" r="43"/>
            <circle class="dial-arc" id="timer-arc" cx="50" cy="50" r="43" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"/>
            <g class="dial-segs" id="timer-segs"></g>
            <circle class="dial-inner" cx="50" cy="50" r="33"/>
            <g class="dial-marks" id="timer-marks"></g>
          </svg>
          <div class="timer-display" id="pip-display">00:00</div>
          <span class="timer-flash" aria-hidden="true"></span>
          <span class="timer-burst" id="timer-burst" aria-hidden="true"></span>
        </div>
        <span class="timer-mascot pink-mascot" id="timer-mascot" data-mascot="bunny" data-mood="idle"></span>
      </div>`;
    buildDial(pipWin.document);
    pipWin.addEventListener('pagehide', () => {
      pipWin = null;
      if (pipTick) { clearInterval(pipTick); pipTick = null; }
    });
    updatePip();
  }
  function updatePip() {
    if (!pipWin || pipWin.closed) return;
    const now = Date.now();
    const d = pipWin.document;
    const disp = d.getElementById('pip-display');
    const lbl  = d.getElementById('pip-label');
    if (!disp) return;
    disp.textContent = fmt(displayMs(now));
    disp.className   = 'timer-display ' + classifyDisplay(now);
    lbl.textContent  = state.label || '';
    lbl.classList.toggle('empty', !state.label);
    paintDial(d, now);
  }

  // Keyboard: Space toggles start/pause (except while typing)
  if (!isPopout) {
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ' && !isTyping(e.target)) {
        e.preventDefault();
        const startBtn = document.getElementById('timer-start');
        if (startBtn) startBtn.click();
      }
    });
  }
})();
