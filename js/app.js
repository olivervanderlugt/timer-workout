/* app.js — WT.app: boot sequence, screen router, global shortcuts. Integrator-owned. */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var SCREENS = {
    home: { el: 'screen-home', ui: function () { return WT.uiHome; } },
    config: { el: 'screen-config', ui: function () { return WT.uiConfig; } },
    run: { el: 'screen-run', ui: function () { return WT.uiRun; } },
    settings: { el: 'screen-settings', ui: function () { return WT.uiSettings; } }
  };

  var current = 'home';

  function sessionLive() {
    if (current !== 'run' || !WT.uiRun || !WT.uiRun.getStatus) return false;
    var s = WT.uiRun.getStatus();
    return s === 'running' || s === 'paused';
  }

  function go(screen, params) {
    var target = SCREENS[screen];
    if (!target) return;
    var prev = SCREENS[current];
    if (prev && current !== screen) {
      var prevUi = prev.ui();
      if (prevUi && prevUi.hide) prevUi.hide();
      var prevEl = document.getElementById(prev.el);
      if (prevEl) prevEl.classList.remove('active');
    }
    current = screen;
    var el = document.getElementById(target.el);
    if (el) el.classList.add('active');
    var ui = target.ui();
    if (ui && ui.show) ui.show(params || {});
    /* History entry so the back button/gesture leaves sub-screens gracefully. */
    if (screen !== 'home') {
      try { history.pushState({ screen: screen }, ''); } catch (e) { /* file:// quirks */ }
    }
  }

  function onPopState() {
    if (current === 'home') return;
    if (current === 'run' && sessionLive() && !confirm('Leave the running workout?')) {
      try { history.pushState({ screen: current }, ''); } catch (e) { /* ignore */ }
      return;
    }
    go('home');
  }

  function onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var click = function (id) {
      var el = document.getElementById(id);
      if (el && getComputedStyle(el).display !== 'none') el.click();
    };
    if (current === 'run') {
      if (e.code === 'Space') { e.preventDefault(); click('btn-pause'); }
      else if (e.key === 'f' || e.key === 'F') click('btn-fullscreen');
      else if (e.key === 'l' || e.key === 'L') click('btn-lap');
      else if (e.key === 'Escape') click('btn-stop');
    } else if (e.key === 'Escape' && current !== 'home') {
      go('home');
    }
  }

  function loadSettings() {
    var defaults = { version: 1, theme: 'hardcore', soundPack: 'referee', volume: 0.8, lastMode: null, lastConfigs: {} };
    var s = WT.storage.get(WT.storage.KEYS.SETTINGS, defaults);
    if (!s || typeof s !== 'object') s = defaults;
    return s;
  }

  function boot() {
    WT.storage.migrate();
    var settings = loadSettings();

    if (WT.themes && WT.themes.apply) WT.themes.apply(settings.theme);
    if (WT.audio) {
      if (WT.audio.setPack) WT.audio.setPack(settings.soundPack);
      if (WT.audio.setVolume) WT.audio.setVolume(typeof settings.volume === 'number' ? settings.volume : 0.8);
    }

    ['uiHome', 'uiConfig', 'uiRun', 'uiSettings'].forEach(function (name) {
      var ui = WT[name];
      if (ui && ui.init) {
        try { ui.init(); } catch (e) { console.error('init failed: ' + name, e); }
      }
    });

    /* Safety-net audio unlock on first gesture (iOS autoplay policy). */
    var unlockOnce = function () {
      if (WT.audio && WT.audio.unlock) WT.audio.unlock();
      document.removeEventListener('pointerdown', unlockOnce);
    };
    document.addEventListener('pointerdown', unlockOnce);

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', function (e) {
      if (sessionLive()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });

    go('home');
  }

  WT.app = { go: go, boot: boot };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
