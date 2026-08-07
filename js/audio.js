/* audio.js — WT.audio: Web Audio synth, 4 sound packs, absolute-time scheduling. Agent A.
 *
 * Public API:
 *   init()                       lazy no-op setup (ctx is created on demand)
 *   unlock()                     call from a user gesture: creates/resumes AudioContext
 *   setPack(id) / getPacks()     'classic' | 'chime' | 'referee' | '8bit'
 *   setVolume(v)                 0..1 → master gain
 *   scheduleSegmentAudio(segment, boundaryPerfTime, opts)
 *   cancelScheduled()            stop all pending scheduled nodes (pause/skip/stop)
 *   playNow(cueName)             immediate cue: any pack cue incl. 'lap'/'pause'
 *   tone(spec[, whenCtxTime])    low-level synth: {freq, ms, wave, gain}
 *
 * scheduleSegmentAudio(segment, boundaryPerfTime, opts):
 *   Called by ui-run on each engine segmentStart. `boundaryPerfTime` is the
 *   exact performance.now() time the segment began (from the engine payload).
 *   Schedules, at absolute AudioContext times:
 *     - 3 countdown beeps at segmentEnd − 3s / − 2s / − 1s
 *     - the boundary tone AT segment end.
 *   The boundary cue depends on what FOLLOWS this segment, which only the
 *   caller knows, so it is passed via opts = { nextType: 'work'|'rest'|null,
 *   isLast: boolean }: isLast → 'finish'; nextType 'rest' → 'restStart';
 *   otherwise → 'workStart'. Open-ended segments (durationMs null) schedule
 *   nothing. Cues whose time is already in the past are skipped.
 *   perf→ctx conversion: ctxTime = perfMs/1000 + (ctx.currentTime − performance.now()/1000).
 *
 * If Web Audio is unavailable, every function is a safe no-op.
 */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var Ctor = window.AudioContext || window.webkitAudioContext;
  var supported = typeof Ctor === 'function';

  var ctx = null;
  var master = null;
  var volume = 0.8;
  var currentPack = 'classic';
  var scheduled = []; // [{osc, gain}] pending/playing nodes

  /* note helper: t = offset (s) within the cue */
  function n(t, freq, ms, wave, gain) {
    return { t: t, freq: freq, ms: ms, wave: wave, gain: gain };
  }

  /* 4 audibly distinct packs. Cues: countdown, workStart, restStart, finish, lap, pause. */
  var PACK_ORDER = ['classic', 'chime', 'referee', '8bit'];
  var PACKS = {
    classic: {
      name: 'Classic',
      cues: {
        countdown: [n(0, 880, 120, 'square', 0.40)],
        workStart: [n(0, 1320, 400, 'square', 0.45)],
        restStart: [n(0, 660, 400, 'square', 0.35)],
        finish: [n(0, 880, 140, 'square', 0.40), n(0.15, 1100, 140, 'square', 0.40),
                 n(0.30, 1320, 140, 'square', 0.40), n(0.45, 1760, 400, 'square', 0.45)],
        lap: [n(0, 1480, 80, 'square', 0.30)],
        pause: [n(0, 440, 160, 'square', 0.25)]
      }
    },
    chime: {
      name: 'Chime',
      cues: {
        countdown: [n(0, 659, 140, 'sine', 0.45)],
        workStart: [n(0, 523, 180, 'sine', 0.50), n(0.12, 784, 340, 'sine', 0.50)],
        restStart: [n(0, 784, 180, 'sine', 0.42), n(0.12, 523, 340, 'sine', 0.42)],
        finish: [n(0, 523, 200, 'sine', 0.45), n(0.16, 659, 200, 'sine', 0.45),
                 n(0.32, 784, 200, 'sine', 0.45), n(0.48, 1046, 500, 'sine', 0.50)],
        lap: [n(0, 988, 100, 'sine', 0.35), n(0.08, 1175, 150, 'sine', 0.35)],
        pause: [n(0, 392, 260, 'sine', 0.30)]
      }
    },
    referee: {
      name: 'Referee',
      cues: {
        countdown: [n(0, 420, 130, 'sawtooth', 0.30)],
        workStart: [n(0, 310, 650, 'sawtooth', 0.38)],
        restStart: [n(0, 240, 450, 'sawtooth', 0.32)],
        finish: [n(0, 300, 220, 'sawtooth', 0.35), n(0.30, 300, 220, 'sawtooth', 0.35),
                 n(0.60, 300, 550, 'sawtooth', 0.38)],
        lap: [n(0, 520, 90, 'sawtooth', 0.25)],
        pause: [n(0, 180, 240, 'sawtooth', 0.25)]
      }
    },
    '8bit': {
      name: '8-bit',
      cues: {
        countdown: [n(0, 1047, 70, 'square', 0.28)],
        workStart: [n(0, 523, 60, 'square', 0.28), n(0.06, 659, 60, 'square', 0.28),
                    n(0.12, 784, 60, 'square', 0.28), n(0.18, 1047, 140, 'square', 0.30)],
        restStart: [n(0, 1047, 60, 'square', 0.26), n(0.06, 784, 60, 'square', 0.26),
                    n(0.12, 659, 60, 'square', 0.26), n(0.18, 523, 140, 'square', 0.26)],
        finish: [n(0, 523, 60, 'square', 0.28), n(0.07, 659, 60, 'square', 0.28),
                 n(0.14, 784, 60, 'square', 0.28), n(0.21, 1047, 60, 'square', 0.28),
                 n(0.28, 1319, 60, 'square', 0.28), n(0.35, 1568, 220, 'square', 0.30)],
        lap: [n(0, 1568, 45, 'square', 0.24), n(0.05, 2093, 80, 'square', 0.24)],
        pause: [n(0, 262, 150, 'square', 0.22)]
      }
    }
  };

  function ensureCtx() {
    if (!supported) return null;
    if (!ctx) {
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
      } catch (e) {
        ctx = null;
        master = null;
        supported = false;
        return null;
      }
    }
    return ctx;
  }

  function init() {
    /* Lazy by design: the AudioContext itself is only created in unlock()/first
     * playback (must originate from a user gesture on iOS). */
  }

  function unlock() {
    var c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended' || c.state === 'interrupted') {
      try { c.resume(); } catch (e) { /* ignore */ }
    }
  }

  function setPack(id) {
    if (PACKS[id]) currentPack = id;
  }

  function getPacks() {
    var out = [];
    for (var i = 0; i < PACK_ORDER.length; i++) {
      out.push({ id: PACK_ORDER[i], name: PACKS[PACK_ORDER[i]].name });
    }
    return out;
  }

  function setVolume(v) {
    volume = WT.util.clamp(Number(v) || 0, 0, 1);
    if (master && ctx) {
      try { master.gain.setValueAtTime(volume, ctx.currentTime); }
      catch (e) { master.gain.value = volume; }
    }
  }

  /* Low-level synth: osc + gain envelope, 5ms linear attack then exponential
   * release to silence — no clicks. `when` is an absolute ctx time (default now). */
  function tone(spec, when) {
    var c = ensureCtx();
    if (!c) return;
    if (when == null) when = c.currentTime;
    var durS = (spec.ms || 150) / 1000;
    try {
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = spec.wave || 'sine';
      osc.frequency.value = spec.freq || 440;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(spec.gain != null ? spec.gain : 0.4, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + durS);
      osc.connect(g);
      g.connect(master);
      osc.start(when);
      osc.stop(when + durS + 0.05);
      var entry = { osc: osc, gain: g };
      scheduled.push(entry);
      osc.onended = function () {
        var i = scheduled.indexOf(entry);
        if (i !== -1) scheduled.splice(i, 1);
        try { g.disconnect(); } catch (e) { /* ignore */ }
      };
    } catch (e) { /* never let audio kill the app */ }
  }

  /* Schedule a named cue of the current pack at absolute ctx time `whenCtx`.
   * Notes whose start time is already in the past are skipped. */
  function scheduleCue(cueName, whenCtx) {
    var c = ensureCtx();
    if (!c) return;
    var pack = PACKS[currentPack];
    var notes = pack && pack.cues[cueName];
    if (!notes) return;
    for (var i = 0; i < notes.length; i++) {
      var at = whenCtx + notes[i].t;
      if (at < c.currentTime + 0.005) continue; // never schedule in the past
      tone(notes[i], at);
    }
  }

  function perfToCtx(perfMs) {
    return perfMs / 1000 + (ctx.currentTime - performance.now() / 1000);
  }

  function scheduleSegmentAudio(segment, boundaryPerfTime, opts) {
    if (!supported) return;
    if (!segment || segment.durationMs == null) return; // open-ended: nothing to schedule
    var c = ensureCtx();
    if (!c) return;
    opts = opts || {};
    var endCtx = perfToCtx(boundaryPerfTime + segment.durationMs);
    for (var s = 3; s >= 1; s--) {
      scheduleCue('countdown', endCtx - s);
    }
    var boundaryCue = opts.isLast ? 'finish'
      : (opts.nextType === 'rest' ? 'restStart' : 'workStart');
    scheduleCue(boundaryCue, endCtx);
  }

  function cancelScheduled() {
    var pending = scheduled.slice();
    scheduled.length = 0;
    for (var i = 0; i < pending.length; i++) {
      try { pending[i].osc.onended = null; } catch (e) { /* ignore */ }
      try { pending[i].osc.stop(0); } catch (e2) { /* ignore */ }
      try { pending[i].gain.disconnect(); } catch (e3) { /* ignore */ }
    }
  }

  function playNow(cueName) {
    var c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended' || c.state === 'interrupted') {
      try { c.resume(); } catch (e) { /* ignore */ }
    }
    scheduleCue(cueName, c.currentTime + 0.03);
  }

  WT.audio = {
    init: init,
    unlock: unlock,
    setPack: setPack,
    getPacks: getPacks,
    setVolume: setVolume,
    tone: tone,
    scheduleSegmentAudio: scheduleSegmentAudio,
    cancelScheduled: cancelScheduled,
    playNow: playNow
  };
})();
