/* clock.js — WT.clock: live local-time clock, second-aligned, single mount point. */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var currentEl = null;
  var timerId = null;

  function render() {
    if (!currentEl) return;
    var now = new Date();
    currentEl.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function clearTimer() {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function tick() {
    render();
    if (!currentEl) return;
    timerId = setTimeout(tick, 1000 - (Date.now() % 1000));
  }

  /* Mounting elsewhere moves the (single) live clock instance. */
  function mount(el) {
    if (!el) return;
    clearTimer();
    currentEl = el;
    render();
    timerId = setTimeout(tick, 1000 - (Date.now() % 1000));
  }

  function unmount() {
    clearTimer();
    currentEl = null;
  }

  WT.clock = {
    mount: mount,
    unmount: unmount
  };
})();
