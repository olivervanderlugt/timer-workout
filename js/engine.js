/* engine.js — WT.engine: generic drift-free segment engine. Agent A.
 *
 * WT.engine.create({segments, now}) → instance.
 *   segments: Segment[] (see SPEC). now: injectable clock for TESTS ONLY —
 *   when `now` is injected, no ticker is started; drive time by calling
 *   instance.tick() manually (tick() is public for exactly this reason;
 *   in production it is called by the internal rAF + interval ticker).
 *
 * Accuracy model (never accumulates ticks):
 *   elapsed = now() - anchor - totalPausedMs
 *   Segment boundaries are prefix sums of durations; every tick recomputes
 *   index/remaining from elapsed. Pause stores pausedAt; resume adds the gap
 *   to totalPausedMs. skip() rewinds the anchor so elapsed lands exactly on
 *   the next segment's start — all subsequent math stays consistent.
 *   Boundary perf time of segment i = anchor + totalPausedMs + cumStart[i].
 *
 * Catch-up: after tab throttling, a single tick emits every missed
 * segmentStart in order (consumers must tolerate this). Countdown events
 * (3/2/1s remaining, timed segments only) fire at most once per segment
 * occurrence and are never fired for segments already passed; values missed
 * during throttling are swallowed, not replayed.
 *
 * Events: tick(state), segmentStart({segment,index,boundaryPerfTime}),
 * countdown({secondsLeft}), pause, resume, finish (exactly once),
 * lap({lapMs,laps}), stop.
 */
(function () {
  'use strict';
  window.WT = window.WT || {};

  function create(opts) {
    opts = opts || {};
    var segments = opts.segments || [];
    var injectedNow = (typeof opts.now === 'function') ? opts.now : null;
    var now = injectedNow || function () { return performance.now(); };
    var useTicker = !injectedNow;

    var emitter = WT.util.createEmitter();

    /* Prefix sums. cumStart[i] = elapsed at which segment i begins;
     * cumEnd[i] = elapsed at which it ends (Infinity for open-ended). */
    var cumStart = [];
    var cumEnd = [];
    var totalMs = 0;
    (function () {
      var run = 0;
      for (var i = 0; i < segments.length; i++) {
        cumStart[i] = run;
        var d = segments[i].durationMs;
        cumEnd[i] = (d == null || run === Infinity) ? Infinity : run + d;
        run = cumEnd[i];
      }
      totalMs = segments.length ? cumEnd[segments.length - 1] : 0;
    })();

    var status = 'idle';           // 'idle'|'running'|'paused'|'finished'
    var anchor = 0;
    var totalPausedMs = 0;
    var pausedAt = 0;
    var frozenElapsed = 0;         // elapsed at the moment of finish
    var laps = [];
    var lastLapInSegMs = 0;
    var emittedIndex = -1;         // highest segment index whose segmentStart fired
    var finishedEmitted = false;
    var countdownFloor = {};       // segIndex -> lowest secondsLeft already emitted

    var rafId = null;
    var intervalId = null;

    /* ---- time helpers ---- */

    function rawElapsed() {
      if (status === 'idle') return 0;
      if (status === 'finished') return frozenElapsed;
      var t = (status === 'paused') ? pausedAt : now();
      var el = t - anchor - totalPausedMs;
      if (el < 0) el = 0;
      if (el > totalMs) el = totalMs; // totalMs may be Infinity (open-ended)
      return el;
    }

    function indexFor(el) {
      for (var i = 0; i < segments.length; i++) {
        if (el < cumEnd[i]) return i;
      }
      return segments.length - 1;
    }

    function boundaryPerfTime(i) {
      return anchor + totalPausedMs + cumStart[i];
    }

    function emitSegmentStart(i) {
      emitter.emit('segmentStart', {
        segment: segments[i],
        index: i,
        boundaryPerfTime: boundaryPerfTime(i)
      });
    }

    function doFinish(elAtFinish) {
      if (finishedEmitted) return;
      finishedEmitted = true;
      frozenElapsed = (totalMs !== Infinity) ? totalMs : elAtFinish;
      status = 'finished';
      stopTicker();
      emitter.emit('finish');
    }

    /* ---- ticker ---- */

    function startTicker() {
      stopTicker();
      if (typeof setInterval === 'function') {
        intervalId = setInterval(tick, 250);
      }
      if (typeof requestAnimationFrame === 'function') {
        var frame = function () {
          if (status !== 'running') { rafId = null; return; }
          tick();
          rafId = requestAnimationFrame(frame);
        };
        rafId = requestAnimationFrame(frame);
      }
    }

    function stopTicker() {
      if (intervalId != null) { clearInterval(intervalId); intervalId = null; }
      if (rafId != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
    }

    /* ---- core tick: recompute everything from elapsed ---- */

    function tick() {
      if (status !== 'running') return;
      var el = now() - anchor - totalPausedMs;
      if (el < 0) el = 0;

      if (totalMs !== Infinity && el >= totalMs) {
        // Emit any segmentStarts that were missed before the end, in order.
        while (emittedIndex < segments.length - 1) {
          emittedIndex++;
          emitSegmentStart(emittedIndex);
        }
        doFinish(el);
        emitter.emit('tick', getState());
        return;
      }

      var idx = indexFor(el);
      // Catch-up: emit every missed segmentStart in order.
      while (emittedIndex < idx) {
        emittedIndex++;
        emitSegmentStart(emittedIndex);
      }

      // Countdown 3/2/1 for the CURRENT timed segment only. Each value fires
      // at most once; values already passed (throttled tab) are swallowed
      // because we only ever emit strictly decreasing values per segment.
      if (cumEnd[idx] !== Infinity) {
        var remMs = cumEnd[idx] - el;
        var s = Math.ceil(remMs / 1000);
        if (s >= 1 && s <= 3) {
          var floor = (countdownFloor[idx] == null) ? 4 : countdownFloor[idx];
          if (s < floor) {
            countdownFloor[idx] = s;
            emitter.emit('countdown', { secondsLeft: s });
          }
        }
      }

      emitter.emit('tick', getState());
    }

    /* ---- public API ---- */

    function start() {
      if (status !== 'idle') return;
      anchor = now();
      totalPausedMs = 0;
      pausedAt = 0;
      frozenElapsed = 0;
      laps = [];
      lastLapInSegMs = 0;
      emittedIndex = -1;
      finishedEmitted = false;
      countdownFloor = {};
      status = 'running';
      if (!segments.length) {
        doFinish(0);
        return;
      }
      tick(); // emits segmentStart for index 0 immediately
      if (status === 'running' && useTicker) startTicker();
    }

    function pause() {
      if (status !== 'running') return;
      pausedAt = now();
      status = 'paused';
      stopTicker();
      emitter.emit('pause');
    }

    function resume() {
      if (status !== 'paused') return;
      totalPausedMs += now() - pausedAt;
      status = 'running';
      emitter.emit('resume');
      if (useTicker) startTicker();
      tick();
    }

    function skip() {
      if (status !== 'running' && status !== 'paused') return;
      var el = rawElapsed();
      var idx = indexFor(el);
      if (idx >= segments.length - 1 || cumStart[idx + 1] === Infinity) {
        doFinish(el);
        emitter.emit('tick', getState());
        return;
      }
      var target = cumStart[idx + 1];
      var ref = (status === 'paused') ? pausedAt : now();
      anchor = ref - totalPausedMs - target; // elapsed(ref) === target exactly
      emittedIndex = idx + 1;
      emitSegmentStart(idx + 1);
      emitter.emit('tick', getState());
    }

    function lap() {
      if (status !== 'running' && status !== 'paused') return;
      var el = rawElapsed();
      var idx = indexFor(el);
      if (cumEnd[idx] !== Infinity) return; // only meaningful on open-ended
      var inSeg = el - cumStart[idx];
      var lapMs = inSeg - lastLapInSegMs;
      lastLapInSegMs = inSeg;
      laps.push(lapMs);
      emitter.emit('lap', { lapMs: lapMs, laps: laps.slice() });
    }

    function stop() {
      if (status === 'idle') return;
      status = 'idle';
      stopTicker();
      emitter.emit('stop');
    }

    function getState() {
      if (!segments.length) {
        return {
          status: status, segmentIndex: -1, segment: null, remainingMs: 0,
          elapsedInSegmentMs: 0, totalElapsedMs: 0, laps: laps.slice()
        };
      }
      var el, idx;
      if (status === 'idle') {
        el = 0;
        idx = 0;
      } else {
        el = rawElapsed();
        idx = (status === 'finished') ? segments.length - 1 : indexFor(el);
      }
      var open = cumEnd[idx] === Infinity;
      return {
        status: status,
        segmentIndex: idx,
        segment: segments[idx],
        remainingMs: open ? null : Math.max(0, cumEnd[idx] - el),
        elapsedInSegmentMs: Math.max(0, el - cumStart[idx]),
        totalElapsedMs: el,
        laps: laps.slice()
      };
    }

    return {
      start: start,
      pause: pause,
      resume: resume,
      skip: skip,
      stop: stop,
      lap: lap,
      tick: tick, // public for tests / manual driving; ticker calls it too
      getState: getState,
      on: emitter.on,
      off: emitter.off
    };
  }

  WT.engine = { create: create };
})();
