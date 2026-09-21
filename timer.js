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
    const minsIn = document.getElementById('timer-mins');
    const secsIn = document.getElementById('timer-secs');
    if (minsIn) minsIn.value = Math.floor(state.targetMs / 60000);
    if (secsIn) secsIn.value = Math.floor((state.targetMs % 60000) / 1000);
    commit();
  }

  function start() {
    alertedZero = false;
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
    alertedZero = false;
    commit();
  }
  function adjust(ms) {
    if (state.mode !== 'countdown') return;
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
    if (!state.running && !state.paused) return '';
    const r = remainingMs(now);
    if (r <= 0) return 'alert';
    if (r <= 60_000) return 'warn';
    return '';
  }

  function render(now = Date.now()) {
    const disp = document.getElementById('timer-display');
    const lbl  = document.getElementById('timer-label');
    const startBtn = document.getElementById('timer-start');
    const setup    = document.getElementById('timer-setup');
    const ring     = document.getElementById('timer-ring');
    const ringFg   = document.getElementById('timer-ring-fg');
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
    if (setup)  setup.hidden = state.mode !== 'countdown' || state.running || state.paused;
    if (plus)   plus.hidden  = state.mode !== 'countdown' || (!state.running && !state.paused);
    if (minus)  minus.hidden = state.mode !== 'countdown' || (!state.running && !state.paused);

    if (ring && ringFg) {
      if (state.mode === 'countdown') {
        ring.hidden = false;
        // pathLength=1 so stroke-dashoffset is 0..1
        const remaining = 1 - progress(now);
        ringFg.setAttribute('stroke-dasharray', '1');
        ringFg.setAttribute('stroke-dashoffset', String(1 - remaining));
      } else {
        ring.hidden = true;
      }
    }

    // beep on transition to zero
    if (state.mode === 'countdown' && state.running && remainingMs(now) <= 0 && !alertedZero) {
      alertedZero = true;
      beep();
      // auto-pause at zero so the alert style holds
      if (!isPopout) {
        state.running = false; state.paused = false; state.endsAt = null;
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
    // copy stylesheet + set theme
    const link = pipWin.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'style.css';
    pipWin.document.head.appendChild(link);
    pipWin.document.documentElement.setAttribute('data-theme',
      document.documentElement.getAttribute('data-theme') || 'jarvis');
    pipWin.document.body.className = 'timer-popout';
    pipWin.document.body.innerHTML = `
      <div class="timer-popout-inner">
        <div class="timer-label" id="pip-label"></div>
        <div class="timer-display-wrap">
          <div class="timer-display" id="pip-display">00:00</div>
          <svg class="timer-ring" id="pip-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="timer-ring-bg" cx="50" cy="50" r="46"/>
            <circle class="timer-ring-fg" id="pip-ring-fg" cx="50" cy="50" r="46" pathLength="1"/>
          </svg>
        </div>
      </div>`;
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
    const ring = d.getElementById('pip-ring');
    const fg   = d.getElementById('pip-ring-fg');
    if (!disp) return;
    disp.textContent = fmt(displayMs(now));
    disp.className   = 'timer-display ' + classifyDisplay(now);
    lbl.textContent  = state.label || '';
    lbl.classList.toggle('empty', !state.label);
    if (ring && fg) {
      if (state.mode === 'countdown') {
        ring.hidden = false;
        const remaining = 1 - progress(now);
        fg.setAttribute('stroke-dasharray', '1');
        fg.setAttribute('stroke-dashoffset', String(1 - remaining));
      } else {
        ring.hidden = true;
      }
    }
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
