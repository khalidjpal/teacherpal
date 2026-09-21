// noise.js — classroom noise meter.
//
// Measures room volume live with getUserMedia + an AnalyserNode and paints a
// big green/yellow/red meter for the projector.
//
// PRIVACY: the audio never leaves the AnalyserNode. Nothing is recorded, no
// buffer is kept, nothing is uploaded — we read the current RMS of the live
// signal each frame and throw the samples away. The mic only opens on an
// explicit Start click and every track is stopped on Stop and on pagehide.
//
// Two views, the same shape as the Timer:
//   • main window (this file, when body has no .noise-popout class) — owns
//     the mic, the settings and the alert logic; the only writer.
//   • pop-out (noise-popout.html) — read-only meter, fed over
//     BroadcastChannel('teacherpal-noise'). A pop-out never opens a mic of
//     its own: if the main window goes away it just says so.
//
// Scale: browser mics are not calibrated, so "dB" here is a repeatable
// relative reading, not SPL. RMS → dBFS → a 35..95 display range that feels
// like room-noise numbers. Thresholds are in those same units.

(function () {
  const isPopout = document.body.classList.contains('noise-popout');
  const CH = 'teacherpal-noise';
  const SETTINGS_KEY = 'teacherpal.noise.settings';
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel(CH) : null;

  // display scale
  const DB_MIN = 35;
  const DB_MAX = 95;
  const SMOOTH_MS = 500;      // rolling average window — rides out a cough
  const LOUD_HOLD_MS = 3000;  // how long in the red before "Too loud" shows
  const CHIME_COOLDOWN_MS = 12000;
  const BROADCAST_MS = 100;

  // Presets: each sets both boundaries. Quiet ends / Too loud begins.
  const PRESETS = {
    silent:  { label: 'Silent work',  quiet: 46, loud: 56 },
    partner: { label: 'Partner talk', quiet: 58, loud: 70 },
    group:   { label: 'Group work',   quiet: 66, loud: 78 },
  };

  const defaultState = () => ({
    running: false,
    db: DB_MIN,          // smoothed reading
    zone: 'off',         // 'off' | 'quiet' | 'ok' | 'loud'
    alert: false,        // held in the red long enough to call it
    preset: 'partner',
    quiet: PRESETS.partner.quiet,
    loud:  PRESETS.partner.loud,
    muted: false,
  });

  let state = defaultState();

  // ---------- settings (main window only) ----------
  function loadSettings() {
    if (isPopout) return;
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (s && typeof s === 'object') {
        // 'custom' is a real value here — the handles were dragged off a preset
        state.preset = (s.preset === 'custom' || PRESETS[s.preset]) ? s.preset : state.preset;
        state.quiet  = clampDb(Number(s.quiet) || state.quiet);
        state.loud   = clampDb(Number(s.loud)  || state.loud);
        state.muted  = !!s.muted;
        orderThresholds();
      }
    } catch { /* ignore */ }
  }
  function saveSettings() {
    if (isPopout) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        preset: state.preset, quiet: state.quiet, loud: state.loud, muted: state.muted,
      }));
    } catch { /* ignore */ }
  }

  const clampDb = (v) => Math.min(DB_MAX, Math.max(DB_MIN, Math.round(v)));
  function orderThresholds() {
    // keep at least 2 units of "OK" band between the two handles
    if (state.loud < state.quiet + 2) state.loud = Math.min(DB_MAX, state.quiet + 2);
    if (state.quiet > state.loud - 2) state.quiet = Math.max(DB_MIN, state.loud - 2);
  }

  function broadcast() {
    if (bc) bc.postMessage({ type: 'state', state });
  }

  // ---------- audio capture ----------
  let stream = null, audioCtx = null, analyser = null, sourceNode = null;
  let buf = null, pollId = null, samples = [];
  let loudSince = null, lastChime = 0, lastBroadcast = 0;

  // Poll on a timer, not requestAnimationFrame: rAF stops dead in a
  // backgrounded or minimised window, which is exactly what happens when the
  // pop-out is on the projector and this tab is behind something. A timer is
  // throttled to ~1s in the background instead of frozen, so the meter and
  // the "too loud" hold keep working.
  const POLL_MS = 50;

  function levelFromRms(rms) {
    // -70 dBFS (a quiet room) .. 0 dBFS (clipping) → DB_MIN..DB_MAX
    const dbfs = 20 * Math.log10(Math.max(rms, 1e-8));
    const t = (Math.max(-70, Math.min(0, dbfs)) + 70) / 70;
    return DB_MIN + t * (DB_MAX - DB_MIN);
  }

  function zoneFor(db) {
    if (!state.running) return 'off';
    if (db < state.quiet) return 'quiet';
    if (db < state.loud) return 'ok';
    return 'loud';
  }

  async function start() {
    if (state.running) return;
    try {
      // autoGainControl / noiseSuppression would fight the measurement —
      // the browser would quietly normalise exactly what we're trying to read.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      const msg = (err && err.name === 'NotAllowedError')
        ? 'Microphone blocked. Allow mic access for this site in the browser address bar, then press Start again.'
        : `Could not open the microphone (${(err && err.name) || 'error'}).`;
      if (typeof setStatus === 'function') setStatus(msg, 'error');
      return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch { /* ignore */ } }
    sourceNode = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    // Note: the analyser is intentionally NOT connected to the destination —
    // routing the mic to the speakers would feed back through the room.
    sourceNode.connect(analyser);
    buf = new Float32Array(analyser.fftSize);

    samples = [];
    loudSince = null;
    state.running = true;
    if (typeof setStatus === 'function') setStatus('Listening — audio stays in this browser.', 'ok');
    render();
    broadcast();
    pollId = setInterval(tick, POLL_MS);
  }

  function stop() {
    if (pollId) { clearInterval(pollId); pollId = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (sourceNode) { try { sourceNode.disconnect(); } catch { /* ignore */ } sourceNode = null; }
    if (audioCtx) { try { audioCtx.close(); } catch { /* ignore */ } audioCtx = null; }
    analyser = null; buf = null; samples = [];
    loudSince = null;
    state.running = false;
    state.db = DB_MIN;
    state.zone = 'off';
    state.alert = false;
    if (typeof setStatus === 'function') setStatus('Microphone off.', 'info');
    render();
    broadcast();
  }

  function tick() {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);

    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);

    // rolling average over SMOOTH_MS so one dropped book doesn't spike the room
    const now = performance.now();
    samples.push({ t: now, v: levelFromRms(rms) });
    while (samples.length && now - samples[0].t > SMOOTH_MS) samples.shift();
    let avg = 0;
    for (const s of samples) avg += s.v;
    state.db = samples.length ? avg / samples.length : DB_MIN;
    state.zone = zoneFor(state.db);

    // "Too loud" only after it *stays* in the red
    if (state.zone === 'loud') {
      if (loudSince == null) loudSince = now;
      if (!state.alert && now - loudSince >= LOUD_HOLD_MS) {
        state.alert = true;
        if (!state.muted && now - lastChime > CHIME_COOLDOWN_MS) { lastChime = now; chime(); }
      }
    } else {
      loudSince = null;
      state.alert = false;
    }

    render();
    if (now - lastBroadcast > BROADCAST_MS) { lastBroadcast = now; broadcast(); }
  }

  // ---------- gentle chime (its own short-lived context) ----------
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [[660, 0], [880, 0.18]];
      for (const [freq, at] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime + at);
        gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + at + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.45);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.5);
      }
      setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 1200);
    } catch { /* ignore */ }
  }

  // ---------- render (shared by the page and the pop-out) ----------
  const pct = (db) => Math.min(100, Math.max(0, ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100));

  const ZONE_WORD = { off: 'Mic off', quiet: 'Quiet', ok: 'OK', loud: 'Too loud' };

  function render() {
    const meter = document.getElementById('noise-meter');
    if (!meter) return;
    const fill = document.getElementById('noise-fill');
    const read = document.getElementById('noise-db');
    const zone = document.getElementById('noise-zone');
    const bar  = document.getElementById('noise-bar');

    meter.dataset.zone = state.zone;
    meter.dataset.alert = state.alert ? '1' : '0';
    meter.dataset.running = state.running ? '1' : '0';

    if (fill) fill.style.width = state.running ? `${pct(state.db)}%` : '0%';
    if (read) read.textContent = state.running ? String(Math.round(state.db)) : '—';
    if (zone) zone.textContent = state.alert ? 'Too loud' : ZONE_WORD[state.zone];
    if (bar) {
      bar.setAttribute('aria-valuenow', String(Math.round(state.running ? state.db : DB_MIN)));
      bar.setAttribute('aria-valuetext', `${Math.round(state.db)} of ${DB_MAX}, ${ZONE_WORD[state.zone]}`);
    }

    // zone boundary markers on the track
    const mq = document.getElementById('mark-quiet');
    const ml = document.getElementById('mark-loud');
    if (mq) mq.style.left = `${pct(state.quiet)}%`;
    if (ml) ml.style.left = `${pct(state.loud)}%`;

    if (!isPopout) renderControls();
  }

  function renderControls() {
    const startBtn = document.getElementById('noise-start');
    if (startBtn) {
      startBtn.textContent = state.running ? 'Stop' : 'Start';
      startBtn.classList.toggle('primary', !state.running);
      startBtn.setAttribute('aria-pressed', String(state.running));
    }
    const mute = document.getElementById('noise-mute');
    if (mute) mute.setAttribute('aria-checked', String(state.muted));

    const qIn = document.getElementById('noise-quiet');
    const lIn = document.getElementById('noise-loud');
    if (qIn && document.activeElement !== qIn) qIn.value = String(state.quiet);
    if (lIn && document.activeElement !== lIn) lIn.value = String(state.loud);
    const qOut = document.getElementById('noise-quiet-out');
    const lOut = document.getElementById('noise-loud-out');
    if (qOut) qOut.textContent = String(state.quiet);
    if (lOut) lOut.textContent = String(state.loud);

    document.querySelectorAll('input[name="noise-preset"]').forEach((r) => {
      r.checked = r.value === state.preset;
    });
  }

  // ---------- main window ----------
  function wireControls() {
    document.getElementById('noise-start').addEventListener('click', () => {
      if (state.running) stop(); else start();
    });

    const mute = document.getElementById('noise-mute');
    mute.addEventListener('click', () => {
      state.muted = !state.muted;
      saveSettings();
      render();
      broadcast();
    });

    document.querySelectorAll('input[name="noise-preset"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (!r.checked) return;
        const p = PRESETS[r.value];
        if (!p) return;
        state.preset = r.value;
        state.quiet = p.quiet;
        state.loud = p.loud;
        loudSince = null;
        state.alert = false;
        saveSettings();
        render();
        broadcast();
      });
    });

    const qIn = document.getElementById('noise-quiet');
    const lIn = document.getElementById('noise-loud');
    const readSliders = () => {
      state.quiet = clampDb(Number(qIn.value));
      state.loud  = clampDb(Number(lIn.value));
      orderThresholds();
      state.preset = 'custom';          // moving a handle leaves the preset
      document.querySelectorAll('input[name="noise-preset"]').forEach((r) => { r.checked = false; });
      loudSince = null;
      state.alert = false;
      saveSettings();
      render();
      broadcast();
    };
    qIn.addEventListener('input', readSliders);
    lIn.addEventListener('input', readSliders);

    document.getElementById('noise-popout-btn').addEventListener('click', () => {
      const w = window.open('noise-popout.html', 'teacherpal-noise', 'popup=yes,width=760,height=440');
      if (w) w.focus();
      setTimeout(broadcast, 300);
    });
  }

  if (!isPopout) {
    loadSettings();
    document.addEventListener('DOMContentLoaded', () => {
      wireControls();
      render();
      if (bc) bc.onmessage = (ev) => {
        if (ev.data && ev.data.type === 'request-state') broadcast();
      };
    });
    // The mic must not outlive the page.
    window.addEventListener('pagehide', stop);
    window.addEventListener('beforeunload', stop);
  } else {
    // ---------- pop-out: read-only, never opens a mic ----------
    let lastMsg = 0;
    document.addEventListener('DOMContentLoaded', () => {
      if (bc) {
        bc.onmessage = (ev) => {
          if (ev.data && ev.data.type === 'state') {
            lastMsg = Date.now();
            state = { ...defaultState(), ...ev.data.state };
            render();
            const link = document.getElementById('noise-link');
            if (link) link.hidden = true;
          }
        };
        bc.postMessage({ type: 'request-state' });
      }
      render();
      // If nothing answers, say so instead of showing a dead meter.
      setInterval(() => {
        const link = document.getElementById('noise-link');
        if (!link) return;
        const stale = Date.now() - lastMsg > 2000;
        link.hidden = !stale;
        if (stale && state.running) { state.running = false; state.zone = 'off'; state.alert = false; render(); }
      }, 1000);
    });
  }
})();
