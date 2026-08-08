/* audio.js — WT.audio: Web Audio synth, 4 sound packs, absolute-time scheduling. Agent A.
 *
 * Public API:
 *   init()                       lazy no-op setup (ctx is created on demand)
 *   unlock()                     call from a user gesture: creates/resumes the
 *                                AudioContext. Returns a Promise<boolean> that
 *                                settles once the context is really running —
 *                                await it before scheduling, because
 *                                ctx.currentTime is frozen while suspended.
 *   setPack(id) / getPacks()     'classic' | 'chime' | 'referee' | '8bit'
 *   setVolume(v)                 0..1 → master gain
 *   buildScheduleItems(segments, fromIndex, elapsedInSegmentMs, nowPerf)
 *   scheduleWorkoutAudio(items)  queue many segments at once (see below)
 *   scheduleSegmentAudio(segment, boundaryPerfTime, opts)
 *   cancelScheduled()            stop all pending scheduled nodes (pause/skip/stop)
 *   playNow(cueName)             immediate cue: any pack cue incl. 'lap'/'pause'
 *   tone(spec[, whenCtxTime])    low-level synth: {freq, ms, wave, gain}
 *   silentSwitchRisk()           true on iOS with no audioSession API
 *
 * Scheduling model — why the whole run is queued at once:
 *   Web Audio plays whatever is already queued on its own clock even when JS
 *   timers are throttled to a crawl (backgrounded tab) or frozen outright
 *   (locked phone). Queueing one segment at a time on each engine segmentStart
 *   therefore loses every cue after the first backgrounded segment: the event
 *   arrives late and its cues land in the past, where scheduleCue drops them.
 *   So ui-run queues the entire remaining workout up front through
 *   scheduleWorkoutAudio(), and re-queues on the events that invalidate that
 *   schedule: resume, skip, and the context returning from a suspension.
 *
 * scheduleWorkoutAudio(items) — items are {segment, boundaryPerfTime,
 *   nextType, isLast} in order, as produced by buildScheduleItems(). Cues are
 *   queued up to HORIZON_S ahead so a very long run does not create thousands
 *   of nodes at once; the returned {scheduled, complete} reports whether the
 *   tail was truncated, so the caller can top up as the run advances.
 *
 * scheduleSegmentAudio(segment, boundaryPerfTime, opts):
 *   Queues one segment. `boundaryPerfTime` is the performance.now() time that
 *   segment begins. At absolute AudioContext times:
 *     - 3 countdown beeps at segmentEnd − 3s / − 2s / − 1s
 *     - the boundary tone AT segment end.
 *   The boundary cue depends on what FOLLOWS this segment, which only the
 *   caller knows, so it is passed via opts = { nextType: 'work'|'rest'|null,
 *   isLast: boolean }: isLast → 'finish'; nextType 'rest' → 'restStart';
 *   otherwise → 'workStart'. Open-ended segments (durationMs null) schedule
 *   nothing. Cues whose time is already in the past are skipped.
 *   perf→ctx conversion: ctxTime = perfMs/1000 + (ctx.currentTime − performance.now()/1000).
 *   That offset shifts whenever the context is suspended — ctx.currentTime
 *   stops while performance.now() runs on — which is the other reason a
 *   resumed context must re-schedule instead of trusting what it queued before.
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

  /* How far ahead cues are queued. Long enough to survive any plausible
   * screen-lock or backgrounded stretch mid-workout, short enough that a
   * 99-round run does not allocate every oscillator at once. */
  var HORIZON_S = 900;

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

  /* iOS mutes Web Audio when the hardware silent switch is on unless the page
   * declares itself as playback rather than ambient audio. Must be set before
   * the context exists. Unsupported everywhere else, hence the feature test. */
  function claimPlaybackSession() {
    try {
      if (navigator.audioSession && 'type' in navigator.audioSession) {
        navigator.audioSession.type = 'playback';
      }
    } catch (e) { /* ignore */ }
  }

  /* True where the silent switch will mute cues and we cannot opt out of it:
   * an iOS device (incl. iPadOS masquerading as a Mac) without audioSession. */
  function silentSwitchRisk() {
    if (!supported) return false;
    try {
      if (navigator.audioSession && 'type' in navigator.audioSession) return false;
      var ua = navigator.userAgent || '';
      return /iPad|iPhone|iPod/.test(ua) ||
        (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
    } catch (e) {
      return false;
    }
  }

  function ensureCtx() {
    if (!supported) return null;
    if (!ctx) {
      try {
        claimPlaybackSession();
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

  /* Resolves true once the context is running. Callers that schedule after a
   * suspension must wait for it: while suspended ctx.currentTime is frozen, so
   * the perf→ctx offset is stale and every cue would land in the past. */
  function unlock() {
    var c = ensureCtx();
    if (!c) return Promise.resolve(false);
    if (c.state !== 'suspended' && c.state !== 'interrupted') {
      return Promise.resolve(c.state === 'running');
    }
    try {
      var p = c.resume();
      if (p && typeof p.then === 'function') {
        return p.then(function () { return true; }, function () { return false; });
      }
    } catch (e) {
      return Promise.resolve(false);
    }
    return Promise.resolve(c.state === 'running');
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

  /* Pure: turn "we are `elapsedInSegmentMs` into segment `fromIndex` at
   * `nowPerf`" into the ordered cue list for the rest of the run. Stops at the
   * first open-ended segment — nothing after one has a knowable time. No
   * AudioContext involved, so this is unit-testable headlessly. */
  function buildScheduleItems(segments, fromIndex, elapsedInSegmentMs, nowPerf) {
    var items = [];
    if (!segments || !segments.length) return items;
    var i = fromIndex;
    if (!(i >= 0)) i = 0;
    var cursor = nowPerf - (elapsedInSegmentMs || 0);
    for (; i < segments.length; i++) {
      var s = segments[i];
      if (!s || s.durationMs == null) break;
      var next = segments[i + 1];
      items.push({
        segment: s,
        boundaryPerfTime: cursor,
        nextType: next ? next.type : null,
        isLast: !next
      });
      cursor += s.durationMs;
    }
    return items;
  }

  /* Queue the whole remaining run. Returns {scheduled, complete}; complete is
   * false when the horizon cut the tail off, so the caller knows to top up. */
  function scheduleWorkoutAudio(items) {
    var out = { scheduled: 0, complete: true };
    if (!supported || !items || !items.length) return out;
    var c = ensureCtx();
    if (!c) return out;
    var limit = c.currentTime + HORIZON_S;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.segment || it.segment.durationMs == null) continue;
      if (perfToCtx(it.boundaryPerfTime + it.segment.durationMs) > limit) {
        out.complete = false;
        break;
      }
      scheduleSegmentAudio(it.segment, it.boundaryPerfTime, it);
      out.scheduled++;
    }
    return out;
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
    buildScheduleItems: buildScheduleItems,
    scheduleWorkoutAudio: scheduleWorkoutAudio,
    scheduleSegmentAudio: scheduleSegmentAudio,
    cancelScheduled: cancelScheduled,
    playNow: playNow,
    silentSwitchRisk: silentSwitchRisk
  };
})();
