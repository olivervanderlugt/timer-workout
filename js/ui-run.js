/* ui-run.js — WT.uiRun: engine <-> DOM/audio binding for the run screen. */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var domBound = false;
  var engine = null;
  var segmentsRef = [];
  var metaRef = {};
  var lastShowParams = null;
  var totalDurationMs = null;
  var isOpenEndedSingle = false;
  var finished = false;
  var wakeHintShown = false;
  var runClockTimer = null;
  var audioComplete = true;   // false when the cue horizon truncated the run
  var scheduledThrough = -1;  // last segment index whose cues are queued
  var soundHintShown = false;
  var visibilityBound = false;

  /* ---------------------------------------------------------------- */
  /* helpers                                                            */
  /* ---------------------------------------------------------------- */

  function go(screen, params) {
    if (WT.app && typeof WT.app.go === 'function') {
      WT.app.go(screen, params);
    }
  }

  function fmtDuration(ms) {
    if (ms == null) return '';
    return WT.util.formatClock(ms);
  }

  function fmtTime(ms) {
    if (ms >= 3600000) return WT.util.formatHMS(ms);
    return WT.util.formatClock(ms);
  }

  function nextSegmentInfo(segments, index) {
    var next = segments[index + 1];
    if (!next) {
      return { text: 'Last segment', nextType: null, isLast: true };
    }
    var durText = next.durationMs == null ? '' : (' ' + fmtDuration(next.durationMs));
    return { text: 'Next: ' + next.label + durText, nextType: next.type, isLast: false };
  }

  function paintSegmentVisuals(segment, index) {
    var screenRun = document.getElementById('screen-run');
    if (screenRun) screenRun.dataset.segmentType = segment.type;

    var labelEl = document.getElementById('run-label');
    if (labelEl) labelEl.textContent = segment.label || '';

    var roundEl = document.getElementById('run-round');
    if (roundEl) {
      roundEl.textContent = (segment.round && segment.totalRounds)
        ? ('ROUND ' + segment.round + '/' + segment.totalRounds)
        : '';
    }

    var info = nextSegmentInfo(segmentsRef, index);
    var nextEl = document.getElementById('run-next');
    if (nextEl) nextEl.textContent = info.text;

    return info;
  }

  function setPauseIcon(showPlay) {
    var btn = document.getElementById('btn-pause');
    if (!btn) return;
    var pauseIco = btn.querySelector('.ico-pause');
    var playIco = btn.querySelector('.ico-play');
    if (pauseIco) pauseIco.style.display = showPlay ? 'none' : '';
    if (playIco) playIco.style.display = showPlay ? '' : 'none';
    if (!finished) {
      btn.setAttribute('aria-label', showPlay ? 'Resume' : 'Pause');
    }
  }

  function handleWakeLockResult(res) {
    if (res && res.ok) return;
    showWakeHint(res && res.reason);
  }

  function showToast(text) {
    var run = document.getElementById('screen-run');
    if (!run) return;
    var el = document.createElement('div');
    el.className = 'wake-hint-toast';
    el.textContent = text;
    run.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 4000);
  }

  function showWakeHint(reason) {
    if (wakeHintShown) return;
    wakeHintShown = true;
    showToast('Screen may turn off (wake lock unavailable)');
  }

  /* On an iOS version without the audioSession API the hardware silent switch
   * mutes every cue and nothing in the page can override it — say so once
   * rather than let the timer look broken. */
  function maybeShowSilentSwitchHint() {
    if (soundHintShown) return;
    if (!WT.audio || typeof WT.audio.silentSwitchRisk !== 'function') return;
    var risky = false;
    try { risky = WT.audio.silentSwitchRisk(); } catch (e) { return; }
    if (!risky) return;
    soundHintShown = true;
    showToast('No sound? Turn off the silent switch');
  }

  function acquireWakeLock() {
    if (!WT.system || typeof WT.system.acquireWakeLock !== 'function') {
      handleWakeLockResult({ ok: false, reason: 'unavailable' });
      return;
    }
    var res;
    try {
      res = WT.system.acquireWakeLock();
    } catch (e) {
      handleWakeLockResult({ ok: false, reason: 'error' });
      return;
    }
    if (res && typeof res.then === 'function') {
      res.then(handleWakeLockResult, function () { handleWakeLockResult({ ok: false }); });
    } else {
      handleWakeLockResult(res || { ok: false, reason: 'unavailable' });
    }
  }

  function releaseWakeLock() {
    if (WT.system && typeof WT.system.releaseWakeLock === 'function') {
      try { WT.system.releaseWakeLock(); } catch (e) { /* ignore */ }
    }
  }

  function startRunClock() {
    stopRunClock();
    function tick() {
      var el = document.getElementById('run-clock');
      if (el) el.textContent = new Date().toLocaleTimeString();
      runClockTimer = setTimeout(tick, 1000 - (Date.now() % 1000));
    }
    tick();
  }

  function stopRunClock() {
    if (runClockTimer) {
      clearTimeout(runClockTimer);
      runClockTimer = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* engine event handlers                                             */
  /* ---------------------------------------------------------------- */

  function onTick(state) {
    if (!state || !state.segment) return;
    var timeEl = document.getElementById('run-time');
    if (timeEl) {
      var openEnded = state.segment.durationMs == null;
      var ms = openEnded ? state.elapsedInSegmentMs : state.remainingMs;
      var text;
      if (ms >= 3600000) {
        text = WT.util.formatHMS(ms);
      } else {
        var showTenths = !openEnded && state.remainingMs != null && state.remainingMs < 10000;
        text = WT.util.formatClock(ms, { showTenths: showTenths });
      }
      timeEl.textContent = text;
    }

    if (totalDurationMs != null) {
      var progressEl = document.getElementById('run-progress');
      if (progressEl) {
        var p = WT.util.clamp(state.totalElapsedMs / totalDurationMs, 0, 1);
        progressEl.style.setProperty('--progress', p);
      }
    }
  }

  /* Queue every remaining cue in one go. The core of the fix: Web Audio keeps
   * playing what is already queued while JS is throttled or frozen, so the
   * schedule must not depend on events arriving on time.
   *
   * `topUp` extends a schedule the horizon truncated, leaving queued nodes
   * alone. That distinction matters: a top-up lands on a segment boundary,
   * exactly when that boundary's tone is sounding, and cancelling there would
   * clip the beep on every segment of a long run. */
  function rescheduleAudio(topUp) {
    if (!engine || !WT.audio) return;
    if (typeof WT.audio.scheduleWorkoutAudio !== 'function' ||
        typeof WT.audio.buildScheduleItems !== 'function') return;

    var state;
    try { state = engine.getState(); } catch (e) { return; }
    if (!state || state.status !== 'running' || !state.segment) return;

    var items = WT.audio.buildScheduleItems(
      segmentsRef, state.segmentIndex, state.elapsedInSegmentMs, performance.now()
    );

    if (topUp) {
      var already = scheduledThrough - state.segmentIndex + 1;
      if (already > 0) items = items.slice(already);
      if (!items.length) return;
    } else if (typeof WT.audio.cancelScheduled === 'function') {
      try { WT.audio.cancelScheduled(); } catch (e) { /* ignore */ }
    }

    var first = topUp ? scheduledThrough + 1 : state.segmentIndex;
    var res;
    try { res = WT.audio.scheduleWorkoutAudio(items); } catch (e) { return; }
    if (!res) return;
    scheduledThrough = first + res.scheduled - 1;
    audioComplete = res.complete !== false;
  }

  /* Bring the AudioContext back before re-queueing: while it is suspended its
   * clock is frozen, so anything scheduled against it would land in the past. */
  function resumeAudioThenReschedule() {
    if (!WT.audio || typeof WT.audio.unlock !== 'function') {
      rescheduleAudio();
      return;
    }
    var p;
    try { p = WT.audio.unlock(); } catch (e) { p = null; }
    if (p && typeof p.then === 'function') {
      p.then(function () { rescheduleAudio(); }, function () { /* ignore */ });
    } else {
      rescheduleAudio();
    }
  }

  /* Screen lock, app switch and tab switch all suspend the context and freeze
   * the ticker; coming back is the moment to restore both. */
  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (!engine) return;
    resumeAudioThenReschedule();
  }

  function onSegmentStart(payload) {
    if (!payload || !payload.segment) return;
    paintSegmentVisuals(payload.segment, payload.index);
    /* Cues for this segment were queued up front. Only extend the tail when
     * the horizon truncated the run and more of it is now within reach. */
    if (!audioComplete) rescheduleAudio(true);
  }

  function onCountdown() {
    var timeEl = document.getElementById('run-time');
    if (!timeEl) return;
    timeEl.classList.remove('pulse');
    void timeEl.offsetWidth; /* force reflow to restart animation */
    timeEl.classList.add('pulse');
  }

  function onPause() {
    var screenRun = document.getElementById('screen-run');
    if (screenRun) screenRun.classList.add('paused');
    setPauseIcon(true);
    if (WT.audio && typeof WT.audio.cancelScheduled === 'function') {
      try { WT.audio.cancelScheduled(); } catch (e) { /* ignore */ }
    }
    releaseWakeLock();
  }

  function onResume() {
    var screenRun = document.getElementById('screen-run');
    if (screenRun) screenRun.classList.remove('paused');
    setPauseIcon(false);
    acquireWakeLock();
    resumeAudioThenReschedule();
  }

  function onFinish() {
    var screenRun = document.getElementById('screen-run');
    if (screenRun) screenRun.classList.add('finished');
    var timeEl = document.getElementById('run-time');
    if (timeEl && engine) {
      var state = engine.getState();
      timeEl.textContent = fmtTime(state.totalElapsedMs || 0);
    }
    releaseWakeLock();
    finished = true;
    setPauseIcon(true);
    var btn = document.getElementById('btn-pause');
    if (btn) btn.setAttribute('aria-label', 'Restart');
  }

  function onLap(payload) {
    var list = document.getElementById('lap-list');
    if (!list || !payload) return;
    var num = payload.laps ? payload.laps.length : '';
    var li = document.createElement('li');
    li.className = 'lap-item';
    var idxSpan = document.createElement('span');
    idxSpan.className = 'lap-index';
    idxSpan.textContent = 'Lap ' + num;
    var timeSpan = document.createElement('span');
    timeSpan.className = 'lap-time';
    timeSpan.textContent = WT.util.formatClock(payload.lapMs, { showTenths: true });
    li.appendChild(idxSpan);
    li.appendChild(timeSpan);
    list.insertBefore(li, list.firstChild);
  }

  function bindEngine() {
    if (!engine) return;
    engine.on('tick', onTick);
    engine.on('segmentStart', onSegmentStart);
    engine.on('countdown', onCountdown);
    engine.on('pause', onPause);
    engine.on('resume', onResume);
    engine.on('finish', onFinish);
    engine.on('lap', onLap);
  }

  function unbindEngine() {
    if (!engine) return;
    engine.off('tick', onTick);
    engine.off('segmentStart', onSegmentStart);
    engine.off('countdown', onCountdown);
    engine.off('pause', onPause);
    engine.off('resume', onResume);
    engine.off('finish', onFinish);
    engine.off('lap', onLap);
  }

  /* ---------------------------------------------------------------- */
  /* controls                                                           */
  /* ---------------------------------------------------------------- */

  function togglePause() {
    if (!engine) return;
    if (finished) {
      restart();
      return;
    }
    var state = engine.getState();
    if (state.status === 'running') {
      engine.pause();
    } else if (state.status === 'paused') {
      engine.resume();
    }
  }

  function restart() {
    if (!lastShowParams) return;
    var params = lastShowParams;
    hide();
    show(params);
  }

  function bindDomOnce() {
    if (domBound) return;
    domBound = true;

    var pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', togglePause);

    var timeEl = document.getElementById('run-time');
    if (timeEl) timeEl.addEventListener('click', togglePause);

    var skipBtn = document.getElementById('btn-skip');
    if (skipBtn) {
      skipBtn.addEventListener('click', function () {
        if (!engine || typeof engine.skip !== 'function') return;
        /* skip() rewinds the anchor, so every boundary after it moves — the
           whole queued schedule is stale and has to be rebuilt. */
        engine.skip();
        rescheduleAudio();
      });
    }

    var lapBtn = document.getElementById('btn-lap');
    if (lapBtn) {
      lapBtn.addEventListener('click', function () {
        if (engine && typeof engine.lap === 'function') engine.lap();
      });
    }

    var stopBtn = document.getElementById('btn-stop');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        var elapsed = 0;
        if (engine) {
          var state = engine.getState();
          elapsed = state.totalElapsedMs || 0;
        }
        if (elapsed > 10000) {
          if (!window.confirm('Stop this workout?')) return;
        }
        if (engine) {
          try { engine.stop(); } catch (e) { /* ignore */ }
        }
        go('home');
      });
    }

    var fsBtn = document.getElementById('btn-fullscreen');
    if (fsBtn) {
      var fsSupported = (WT.system && typeof WT.system.fullscreenSupported === 'boolean')
        ? WT.system.fullscreenSupported
        : !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
      if (!fsSupported) {
        fsBtn.style.display = 'none';
      } else {
        fsBtn.addEventListener('click', function () {
          if (WT.system && typeof WT.system.toggleFullscreen === 'function') {
            WT.system.toggleFullscreen();
          }
        });
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* public API                                                         */
  /* ---------------------------------------------------------------- */

  function show(params) {
    params = params || {};
    lastShowParams = params;
    segmentsRef = params.segments || [];
    metaRef = params.meta || {};
    finished = false;
    wakeHintShown = false;
    audioComplete = true;
    scheduledThrough = -1;

    bindDomOnce();

    var screenRun = document.getElementById('screen-run');
    if (screenRun) {
      screenRun.classList.remove('finished');
      screenRun.classList.remove('paused');
    }
    var lapList = document.getElementById('lap-list');
    if (lapList) lapList.innerHTML = '';

    setPauseIcon(false);
    var pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) pauseBtn.setAttribute('aria-label', 'Pause');

    var allTimed = segmentsRef.length > 0 && segmentsRef.every(function (s) { return s.durationMs != null; });
    totalDurationMs = allTimed
      ? segmentsRef.reduce(function (sum, s) { return sum + s.durationMs; }, 0)
      : null;

    var progressEl = document.getElementById('run-progress');
    if (progressEl) progressEl.style.display = totalDurationMs == null ? 'none' : '';

    isOpenEndedSingle = segmentsRef.length === 1 && segmentsRef[0].durationMs == null;
    var skipBtn = document.getElementById('btn-skip');
    if (skipBtn) skipBtn.style.display = isOpenEndedSingle ? 'none' : '';
    var lapBtn = document.getElementById('btn-lap');
    if (lapBtn) lapBtn.style.display = isOpenEndedSingle ? '' : 'none';

    if (!WT.engine || typeof WT.engine.create !== 'function') {
      console.error('WT.uiRun.show: WT.engine is not available');
      return;
    }

    engine = WT.engine.create({ segments: segmentsRef });
    bindEngine();

    var st = engine.getState();
    if (st.segment) paintSegmentVisuals(st.segment, st.segmentIndex);
    onTick(st);

    if (!visibilityBound) {
      visibilityBound = true;
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    startRunClock();
    acquireWakeLock();

    engine.start();

    /* After start(), so the engine is running and the schedule covers the run
       from segment 0. unlock() first: on iOS the context is created suspended
       and its clock reads 0 until it resumes. */
    resumeAudioThenReschedule();
    maybeShowSilentSwitchHint();
  }

  function hide() {
    stopRunClock();
    if (engine) {
      try { engine.stop(); } catch (e) { /* ignore */ }
      unbindEngine();
    }
    if (WT.audio && typeof WT.audio.cancelScheduled === 'function') {
      try { WT.audio.cancelScheduled(); } catch (e) { /* ignore */ }
    }
    if (visibilityBound) {
      visibilityBound = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    releaseWakeLock();
    engine = null;
  }

  WT.uiRun = {
    show: show,
    hide: hide,
    getStatus: function () {
      if (!engine) return 'idle';
      try { return engine.getState().status; } catch (e) { return 'idle'; }
    }
  };
})();
