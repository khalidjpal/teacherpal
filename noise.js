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
  // The marwa mascot's mood follows the zone, but only once the zone has held
  // for this long — a reading hovering on a boundary would otherwise make the
  // bunny twitch between poses. Display only: zones, the 3s "Too loud" hold
  // and the chime still use the raw zone.
  const MOOD_HOLD_MS = 600;
  // The level bar and halloween's ghost share one zone-aligned scale, 0..1:
  // the quiet band fills 0–30%, OK 30–70%, the room above "too loud" 70–100%,
  // so the threshold markers always sit at 30% / 70% (QUIET_AT / LOUD_AT,
  // mirrored in style.css) and the fill crosses a marker exactly as the zone
  // changes.
  const QUIET_AT = 0.3, LOUD_AT = 0.7;

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
    mood: 'off',         // the mascot's pose: the zone, debounced (MOOD_HOLD_MS)
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
  let moodPending = null, moodSince = 0;

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
    moodPending = null;
    state.running = true;
    state.mood = 'quiet';
    if (typeof setStatus === 'function') setStatus('Listening', 'ok');
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
    state.mood = 'off';
    moodPending = null;
    if (typeof setStatus === 'function') setStatus('');   // the zone word already says "Mic off"
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

    // the mascot changes pose only once the new zone has held
    if (state.zone === state.mood) {
      moodPending = null;
    } else if (moodPending !== state.zone) {
      moodPending = state.zone; moodSince = now;
    } else if (now - moodSince >= MOOD_HOLD_MS) {
      state.mood = state.zone; moodPending = null;
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
  const ZONE_WORD = { off: 'Mic off', quiet: 'Quiet', ok: 'OK', loud: 'Too loud' };

  function render() {
    const meter = document.getElementById('noise-meter');
    if (!meter) return;
    const read = document.getElementById('noise-db');
    const zone = document.getElementById('noise-zone');
    const bar  = document.getElementById('noise-bar');

    meter.dataset.zone = state.zone;
    meter.dataset.alert = state.alert ? '1' : '0';
    meter.dataset.running = state.running ? '1' : '0';
    meter.dataset.mood = state.running ? (state.mood || state.zone) : 'off';
    renderLevel(meter);

    if (read) read.textContent = state.running ? String(Math.round(state.db)) : '—';
    if (zone) zone.textContent = state.alert ? 'Too loud' : ZONE_WORD[state.zone];
    if (bar) {
      bar.setAttribute('aria-valuenow', String(Math.round(state.running ? state.db : DB_MIN)));
      bar.setAttribute('aria-valuetext', `${Math.round(state.db)} of ${DB_MAX}, ${ZONE_WORD[state.zone]}`);
    }

    if (!isPopout) renderControls();
  }

  // ---------- marwa: the bunny is the meter ----------
  // Built into every .noise-meter (page and pop-out) but shown only in marwa;
  // the other themes show their own mascot or none. Every colour is
  // an --nm-* token, every pose is CSS off data-mood / data-alert, so a theme
  // switch from the gear menu needs no JS.
  const heartPath = (x, y, s) =>
    `<path transform="translate(${x} ${y}) scale(${s}) translate(-8 -8)" d="M8 14.5C8 14.5 1 10.2 1 5.6 1 3 3 1.2 5.2 1.2 6.6 1.2 7.5 2 8 2.8 8.5 2 9.4 1.2 10.8 1.2 13 1.2 15 3 15 5.6 15 10.2 8 14.5 8 14.5Z"/>`;
  const starPath = (x, y, s) =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -8 L2.2 -2.6 L8 -2.4 L3.4 1.2 L5 7 L0 3.6 L-5 7 L-3.4 1.2 L-8 -2.4 L-2.2 -2.6 Z"/>`;
  const dropPath = (x, y, s) =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -9 C3 -4 6 -0.5 6 3 A6 6 0 0 1 -6 3 C-6 -0.5 -3 -4 0 -9 Z"/>`;
  // each fx item sits in its own <g> so the CSS animation (on the <g>) never
  // fights the placement transform (on the <path>)
  const fx = (items) => items.map((p, i) => `<g style="--i:${i}">${p}</g>`).join('');
  const earSvg = (side, cx) => `
        <g class="nm-ear ${side}"><g class="nm-ear-wig">
          <ellipse class="nm-fur" cx="${cx}" cy="40" rx="15" ry="36"/>
          <ellipse class="nm-ear-in" cx="${cx}" cy="45" rx="7.5" ry="25"/>
        </g></g>`;
  const pawSvg = (side, cx) => `
      <g class="nm-paw ${side}">
        <ellipse class="nm-fur" cx="${cx}" cy="150" rx="13" ry="11"/>
        <path class="nm-toe" d="M${cx - 4} 145v5M${cx + 4} 145v5"/>
      </g>`;
  const MASCOT_SVG = `
  <svg class="nm-svg" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="nm-g-quiet"><stop offset="0"/><stop offset="1"/></radialGradient>
      <radialGradient id="nm-g-ok"><stop offset="0"/><stop offset="1"/></radialGradient>
      <radialGradient id="nm-g-loud"><stop offset="0"/><stop offset="1"/></radialGradient>
    </defs>
    <circle class="nm-halo quiet" cx="100" cy="112" r="100" fill="url(#nm-g-quiet)"/>
    <circle class="nm-halo ok"    cx="100" cy="112" r="100" fill="url(#nm-g-ok)"/>
    <circle class="nm-halo loud"  cx="100" cy="112" r="100" fill="url(#nm-g-loud)"/>
    <g class="nm-move">
      <ellipse class="nm-shadow" cx="100" cy="195" rx="60" ry="4.5"/>
      <ellipse class="nm-fur" cx="72" cy="187" rx="17" ry="8"/>
      <ellipse class="nm-fur" cx="128" cy="187" rx="17" ry="8"/>
      <ellipse class="nm-fur" cx="100" cy="160" rx="52" ry="33"/>
      <ellipse class="nm-tummy" cx="100" cy="166" rx="30" ry="20"/>
      <g class="nm-head">
        ${earSvg('l', 72)}${earSvg('r', 128)}
        <ellipse class="nm-fur" cx="100" cy="92" rx="56" ry="45"/>
        <ellipse class="nm-sheen" cx="74" cy="68" rx="13" ry="7.5" transform="rotate(-25 74 68)"/>
        <g class="nm-bow" transform="translate(130 52) rotate(14)">
          <path d="M0 0 L-16 -9 L-16 9Z"/><path d="M0 0 L16 -9 L16 9Z"/><circle class="nm-knot" r="4.8"/>
        </g>
        <ellipse class="nm-blush" cx="64" cy="105" rx="9.5" ry="5.6"/>
        <ellipse class="nm-blush" cx="136" cy="105" rx="9.5" ry="5.6"/>
        <g class="nm-eyes sleep"><path d="M69 89 Q78 97 87 89M113 89 Q122 97 131 89"/></g>
        <g class="nm-eyes open">
          <ellipse cx="78" cy="88" rx="6.5" ry="8"/><ellipse cx="122" cy="88" rx="6.5" ry="8"/>
          <circle class="nm-glint" cx="80.6" cy="84.8" r="2.4"/><circle class="nm-glint" cx="124.6" cy="84.8" r="2.4"/>
          <circle class="nm-glint" cx="76" cy="91.4" r="1.1"/><circle class="nm-glint" cx="120" cy="91.4" r="1.1"/>
        </g>
        <g class="nm-eyes wide">
          <ellipse cx="78" cy="88" rx="9" ry="11"/><ellipse cx="122" cy="88" rx="9" ry="11"/>
          <circle class="nm-glint" cx="81.5" cy="83.6" r="3.4"/><circle class="nm-glint" cx="125.5" cy="83.6" r="3.4"/>
          <circle class="nm-glint" cx="75" cy="92.6" r="1.5"/><circle class="nm-glint" cx="119" cy="92.6" r="1.5"/>
          <path class="nm-brow" d="M67 72 L87 66M113 66 L133 72"/>
        </g>
        <path class="nm-nose" d="M95.6 100.6 Q100 98.6 104.4 100.6 L100 105.2 Z"/>
        <path class="nm-mouth sleep" d="M94 109 Q97 112.4 100 109 Q103 112.4 106 109"/>
        <path class="nm-mouth open" d="M90 108.4 Q95 116 100 108.4 Q105 116 110 108.4"/>
        <path class="nm-mouth wide" d="M88 115 Q91 110 94 115 Q97 120 100 115 Q103 110 106 115 Q109 120 112 115"/>
      </g>
      ${pawSvg('l', 80)}${pawSvg('r', 120)}
    </g>
    <g class="nm-fx zzz">${fx(['<text x="148" y="50">z</text>', '<text x="162" y="33">z</text>', '<text x="177" y="16">z</text>'])}</g>
    <g class="nm-fx hearts">${fx([heartPath(30, 72, 0.9), heartPath(170, 64, 1.1), heartPath(22, 132, 0.75), heartPath(180, 126, 0.85)])}</g>
    <g class="nm-fx stars">${fx([starPath(52, 22, 1.1), starPath(100, 9, 1.3), starPath(148, 22, 1.1)])}</g>
    <g class="nm-fx drops">${fx([dropPath(28, 100, 1), dropPath(173, 96, 1.1), dropPath(165, 124, 0.75)])}</g>
  </svg>`;

  // ---------- halloween: a ghost rising from a grave ----------
  // Its HEIGHT is the level: --rise (0..1, the same zone-aligned scale as
  // the level bar) lifts it out of the grave; data-mood sets its face, arms,
  // colour and motion. The scene is static, the ghost is clipped at the
  // grave's mouth, so it really comes up out of the ground.
  const bat = (x, y, s, i) => `
      <g class="nh-bat b${i}" style="--i:${i}" transform="translate(${x} ${y}) scale(${s})"><g class="nh-bat-fly">
        <g class="nh-bat-perch"><path d="M-7 5 Q-9 -3 -4 -6 L-4.5 -11 L-1.5 -7.4 L1.5 -7.4 L4.5 -11 L4 -6 Q9 -3 7 5 Q0 9 -7 5Z"/></g>
        <g class="nh-bat-wings"><path d="M0 -1 Q-6 -9 -13 -6 Q-17 -9 -21 -4 Q-16 -3 -14 2 Q-9 -1 -4 4 Z"/><path d="M0 -1 Q6 -9 13 -6 Q17 -9 21 -4 Q16 -3 14 2 Q9 -1 4 4 Z"/><path d="M-4 4 Q-5 -4 -3 -6 L-3.5 -10 L-1 -7 L1 -7 L3.5 -10 L3 -6 Q5 -4 4 4 Q0 7 -4 4Z"/></g>
        <circle class="nh-bat-eye" cx="-1.8" cy="-3.6" r="0.9"/><circle class="nh-bat-eye" cx="1.8" cy="-3.6" r="0.9"/>
      </g></g>`;
  const tuft = (x, y, s) =>
    `<path class="nh-grass" transform="translate(${x} ${y}) scale(${s})" d="M-8 0 L-11 -10 L-5 -3 L-4 -15 L0 -4 L3 -13 L4 -3 L10 -11 L8 0 Z"/>`;
  const GHOST_SVG = `
  <svg class="nh-svg" viewBox="0 0 240 240" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="nh-g-glow"><stop offset="0"/><stop offset="0.55"/><stop offset="1"/></radialGradient>
      <linearGradient id="nh-g-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="0.68"/><stop offset="1"/></linearGradient>
      <linearGradient id="nh-g-wisp" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient>
      <clipPath id="nh-clip"><rect x="-40" y="-120" width="320" height="327"/></clipPath>
    </defs>
    <circle class="nh-aura" cx="148" cy="118" r="128" fill="url(#nh-g-glow)"/>
    <path class="nh-ground back" d="M4 222 Q8 205 60 202 Q112 196 160 199 Q222 198 236 214 Q238 227 220 228 L20 228 Q2 228 4 222 Z"/>
    <g class="nh-stone" transform="rotate(-5 54 212)">
      <path class="nh-stone-body" d="M22 214 L22 148 Q22 116 54 116 Q86 116 86 148 L86 214 Z"/>
      <path class="nh-stone-hi" d="M28 206 L28 150 Q28 124 50 121"/>
      <text class="nh-rip" x="54" y="160" text-anchor="middle">RIP</text>
      <path class="nh-crack" d="M74 122 L68 136 L74 144 L66 158 M54 176 L60 186"/>
    </g>
    <g class="nh-cross" transform="rotate(9 214 212)">
      <rect x="210" y="160" width="7" height="54" rx="1.5"/><rect x="200" y="172" width="27" height="6.5" rx="1.5"/>
    </g>
    <ellipse class="nh-hole" cx="148" cy="207" rx="46" ry="9"/>
    <g clip-path="url(#nh-clip)">
      <g transform="translate(148 35)">
        <g class="nh-rise"><g class="nh-float">
          <circle class="nh-halo" cx="0" cy="62" r="88" fill="url(#nh-g-glow)"/>
          <g class="nh-wisps">
            <path d="M-40 98 q-10 8 -4 18 q5 7 -3 14"/><path d="M42 92 q10 8 4 18 q-5 7 3 14"/><path d="M-20 126 q-6 10 1 18"/>
          </g>
          <g class="nh-ghost">
            <path class="nh-arm l" d="M-36 50 Q-58 64 -61 88 Q-61 97 -53 93 Q-49 76 -35 70 Z"/>
            <path class="nh-arm r" d="M36 50 Q58 64 61 88 Q61 97 53 93 Q49 76 35 70 Z"/>
            <g class="nh-tail"><path d="M-30 112 Q-36 140 -25 168"/><path d="M2 120 Q-5 150 6 172"/><path d="M28 112 Q37 142 25 164"/></g>
            <path class="nh-body" d="M0 0 C26 0 42 22 42 54 L44 112 Q40 124 34 116 Q30 132 22 120 Q16 140 8 124 Q2 146 -6 126 Q-14 142 -20 122 Q-28 134 -34 116 Q-40 126 -44 112 L-42 54 C-42 22 -26 0 0 0 Z"/>
            <path class="nh-sheen" d="M-30 40 Q-30 16 -12 9"/>
            <ellipse class="nh-blush" cx="-25" cy="58" rx="6" ry="3.4"/><ellipse class="nh-blush" cx="25" cy="58" rx="6" ry="3.4"/>
            <g class="nh-face sleep"><path d="M-21 44 Q-14 50 -7 44M7 44 Q14 50 21 44"/><path class="nh-o" d="M-3 60 Q0 62 3 60"/></g>
            <g class="nh-face happy">
              <ellipse cx="-14" cy="43" rx="5" ry="7"/><ellipse cx="14" cy="43" rx="5" ry="7"/>
              <circle class="nh-glint" cx="-12.4" cy="40.2" r="1.7"/><circle class="nh-glint" cx="15.6" cy="40.2" r="1.7"/>
              <path class="nh-smile" d="M-9 60 Q0 69 9 60"/>
            </g>
            <g class="nh-face wail">
              <ellipse cx="-15" cy="40" rx="7.5" ry="10.5" transform="rotate(12 -15 40)"/><ellipse cx="15" cy="40" rx="7.5" ry="10.5" transform="rotate(-12 15 40)"/>
              <ellipse class="nh-mouth" cx="0" cy="70" rx="9.5" ry="14"/>
            </g>
          </g>
        </g></g>
      </g>
    </g>
    <path class="nh-ground front" d="M8 225 Q28 210 102 207 A46 9 0 0 0 194 207 Q228 208 234 219 Q235 230 218 231 L24 231 Q6 231 8 225 Z"/>
    ${tuft(14, 218, 1.1)}${tuft(98, 210, 0.85)}${tuft(196, 209, 0.9)}${tuft(232, 214, 1.15)}${tuft(66, 216, 0.7)}
    ${bat(36, 117, 1.15, 0)}${bat(63, 113, 1, 1)}${bat(214, 158, 0.95, 2)}
  </svg>`;

  function buildMascot() {
    const meter = document.getElementById('noise-meter');
    if (!meter || meter.querySelector('.nm-stage')) return;
    const stage = document.createElement('div');
    stage.className = 'nm-stage noise-mascot';
    stage.innerHTML = MASCOT_SVG;
    const ghost = document.createElement('div');
    ghost.className = 'nh-stage noise-mascot';
    ghost.innerHTML = GHOST_SVG;
    meter.prepend(stage, ghost);
    // the level bar's rider (a heart, a bat, a leaf, a bright cap — per theme)
    const bar = document.getElementById('noise-bar');
    if (bar && !bar.querySelector('.noise-rider')) {
      const rider = document.createElement('span');
      rider.className = 'noise-rider';
      rider.setAttribute('aria-hidden', 'true');
      rider.innerHTML = '<i></i>';
      bar.appendChild(rider);
    }
  }

  // The smoothed reading on the zone-aligned 0..1 scale (see QUIET_AT).
  function levelFrac() {
    if (!state.running) return 0;
    const db = state.db, q = state.quiet, l = state.loud;
    let f;
    if (db < q) f = QUIET_AT * (db - DB_MIN) / Math.max(1, q - DB_MIN);
    else if (db < l) f = QUIET_AT + (LOUD_AT - QUIET_AT) * (db - q) / Math.max(1, l - q);
    else f = LOUD_AT + (1 - LOUD_AT) * Math.min(1, (db - l) / Math.max(6, l - q));
    return Math.max(0, Math.min(1, f));
  }
  // --level drives the bar's fill and rider (CSS eases between polls, so it
  // glides instead of stepping); --rise lifts the ghost, fully sunk while
  // the mic is off.
  function renderLevel(meter) {
    const f = levelFrac();
    meter.style.setProperty('--level', f.toFixed(4));
    meter.style.setProperty('--rise', state.running ? f.toFixed(3) : '-0.45');
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

    // the full privacy note sits behind the "?"
    const privacy = document.getElementById('noise-privacy-dialog');
    document.getElementById('noise-privacy-btn').addEventListener('click', () => privacy.showModal());

    document.getElementById('noise-popout-btn').addEventListener('click', () => {
      const w = window.open('noise-popout.html', 'teacherpal-noise', 'popup=yes,width=760,height=440');
      if (w) w.focus();
      setTimeout(broadcast, 300);
    });
  }

  if (!isPopout) {
    loadSettings();
    document.addEventListener('DOMContentLoaded', () => {
      buildMascot();
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
      buildMascot();
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
        if (stale && state.running) { state.running = false; state.zone = 'off'; state.alert = false; state.mood = 'off'; render(); }
      }, 1000);
    });
  }
})();
