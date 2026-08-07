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
  var lastNextType = null;
  var lastIsLast = false;
  var runClockTimer = null;

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

  function showWakeHint(reason) {
    if (wakeHintShown) return;
    wakeHintShown = true;
    var run = document.getElementById('screen-run');
    if (!run) return;
    var el = document.createElement('div');
    el.className = 'wake-hint-toast';
    el.textContent = 'Screen may turn off (wake lock unavailable)';
    run.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 4000);
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

  function onSegmentStart(payload) {
    if (!payload || !payload.segment) return;
    var info = paintSegmentVisuals(payload.segment, payload.index);
    lastNextType = info.nextType;
    lastIsLast = info.isLast;
    /* While paused (e.g. skip during pause) stay silent — onResume schedules. */
    if (engine && engine.getState().status === 'paused') return;
    if (WT.audio && typeof WT.audio.scheduleSegmentAudio === 'function') {
      WT.audio.scheduleSegmentAudio(payload.segment, payload.boundaryPerfTime, {
        nextType: info.nextType,
        isLast: info.isLast
      });
    }
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
    if (engine && WT.audio && typeof WT.audio.scheduleSegmentAudio === 'function') {
      var state = engine.getState();
      if (state.segment && state.segment.durationMs != null && state.remainingMs != null) {
        /* audio.js expects the segment START time (it adds durationMs for the
           end), so derive a virtual start: start = (now + remaining) - duration. */
        var boundaryPerfTime = performance.now() + state.remainingMs - state.segment.durationMs;
        WT.audio.scheduleSegmentAudio(state.segment, boundaryPerfTime, {
          nextType: lastNextType,
          isLast: lastIsLast
        });
      }
    }
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
        /* Drop the skipped segment's pending beeps before the new segment
           schedules its own (segmentStart re-schedules). */
        if (WT.audio && typeof WT.audio.cancelScheduled === 'function') {
          try { WT.audio.cancelScheduled(); } catch (e) { /* ignore */ }
        }
        engine.skip();
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
    lastNextType = null;
    lastIsLast = false;

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
    if (st.segment) {
      var info = paintSegmentVisuals(st.segment, st.segmentIndex);
      lastNextType = info.nextType;
      lastIsLast = info.isLast;
    }
    onTick(st);

    if (WT.audio && typeof WT.audio.unlock === 'function') {
      try { WT.audio.unlock(); } catch (e) { /* ignore */ }
    }

    startRunClock();
    acquireWakeLock();

    engine.start();
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
