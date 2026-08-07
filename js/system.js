/* system.js — WT.system: fullscreen + wake lock, with feature detection & webkit fallbacks. */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var doc = document;
  var docEl = doc.documentElement;

  function firstSupported(obj, names) {
    for (var i = 0; i < names.length; i++) {
      if (typeof obj[names[i]] === 'function') return names[i];
    }
    return null;
  }

  var requestFsName = firstSupported(docEl, [
    'requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen',
    'mozRequestFullScreen', 'msRequestFullscreen'
  ]);
  var exitFsName = firstSupported(doc, [
    'exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen',
    'mozCancelFullScreen', 'msExitFullscreen'
  ]);

  /* Feature flag so UI can hide the fullscreen button (e.g. iPhone Safari lacks this API). */
  var fullscreenSupported = !!(requestFsName && exitFsName);

  function fullscreenElement() {
    return doc.fullscreenElement || doc.webkitFullscreenElement ||
      doc.mozFullScreenElement || doc.msFullscreenElement || null;
  }

  function isFullscreen() {
    return !!fullscreenElement();
  }

  function toggleFullscreen() {
    if (!fullscreenSupported) return;
    try {
      if (isFullscreen()) {
        doc[exitFsName]();
      } else {
        docEl[requestFsName]();
      }
    } catch (e) {
      /* ignore — some browsers reject outside a user gesture */
    }
  }

  var fsEmitter = WT.util.createEmitter();
  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(function (evt) {
    doc.addEventListener(evt, function () {
      fsEmitter.emit('change', isFullscreen());
    });
  });

  function onFullscreenChange(fn) {
    fsEmitter.on('change', fn);
    return function () { fsEmitter.off('change', fn); };
  }

  /* ---- Wake lock ---- */
  var wakeLockSentinel = null;
  var wakeLockWanted = false; /* true while held and not explicitly released; drives re-acquire */

  function acquireWakeLock() {
    if (!('wakeLock' in navigator)) {
      return Promise.resolve({ ok: false, reason: 'unsupported' });
    }
    try {
      return navigator.wakeLock.request('screen').then(function (sentinel) {
        wakeLockSentinel = sentinel;
        wakeLockWanted = true;
        sentinel.addEventListener('release', function () {
          if (wakeLockSentinel === sentinel) wakeLockSentinel = null;
        });
        return { ok: true };
      }).catch(function (err) {
        return { ok: false, reason: (err && err.name) || 'error' };
      });
    } catch (e) {
      return Promise.resolve({ ok: false, reason: 'error' });
    }
  }

  function releaseWakeLock() {
    wakeLockWanted = false;
    if (wakeLockSentinel) {
      try { wakeLockSentinel.release(); } catch (e) { /* ignore */ }
      wakeLockSentinel = null;
    }
  }

  /* Auto re-acquire when tab becomes visible again, if a lock was held and not explicitly released. */
  doc.addEventListener('visibilitychange', function () {
    if (doc.visibilityState === 'visible' && wakeLockWanted && !wakeLockSentinel) {
      acquireWakeLock();
    }
  });

  WT.system = {
    fullscreenSupported: fullscreenSupported,
    toggleFullscreen: toggleFullscreen,
    isFullscreen: isFullscreen,
    onFullscreenChange: onFullscreenChange,
    acquireWakeLock: acquireWakeLock,
    releaseWakeLock: releaseWakeLock
  };
})();
