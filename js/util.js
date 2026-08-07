/* util.js — WT.util. FROZEN. */
(function () {
  'use strict';
  window.WT = window.WT || {};

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function uid() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /**
   * Format ms as clock time. Under 1 hour: "m:ss" (or "m:ss.t" with showTenths).
   * Negative values clamp to 0.
   */
  function formatClock(ms, opts) {
    ms = Math.max(0, ms);
    var showTenths = opts && opts.showTenths;
    var totalSec = showTenths ? Math.floor(ms / 100) / 10 : Math.ceil(ms / 1000);
    var sec = showTenths ? totalSec % 60 : totalSec % 60;
    var min = Math.floor(totalSec / 60);
    if (showTenths) {
      var whole = Math.floor(sec);
      var tenth = Math.floor((sec - whole) * 10 + 0.0001);
      return min + ':' + pad2(whole) + '.' + tenth;
    }
    return min + ':' + pad2(sec);
  }

  /** Format ms as "h:mm:ss" when >= 1h, else "m:ss". */
  function formatHMS(ms) {
    ms = Math.max(0, ms);
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
    return m + ':' + pad2(s);
  }

  function createEmitter() {
    var listeners = {};
    return {
      on: function (event, fn) {
        (listeners[event] = listeners[event] || []).push(fn);
      },
      off: function (event, fn) {
        var arr = listeners[event];
        if (!arr) return;
        var i = arr.indexOf(fn);
        if (i !== -1) arr.splice(i, 1);
      },
      emit: function (event, payload) {
        var arr = listeners[event];
        if (!arr) return;
        arr.slice().forEach(function (fn) {
          try { fn(payload); } catch (e) { console.error('WT emitter error [' + event + ']', e); }
        });
      }
    };
  }

  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  WT.util = {
    pad2: pad2,
    clamp: clamp,
    uid: uid,
    formatClock: formatClock,
    formatHMS: formatHMS,
    createEmitter: createEmitter,
    qs: qs,
    qsa: qsa
  };
})();
