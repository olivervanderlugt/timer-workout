/* storage.js — WT.storage: versioned localStorage wrapper. FROZEN. */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var KEYS = {
    SETTINGS: 'wt.settings',
    PRESETS: 'wt.presets'
  };

  /* localStorage can throw (private mode, some file:// contexts) — degrade to memory. */
  var memory = {};
  var usable = (function () {
    try {
      var t = '__wt_test__';
      localStorage.setItem(t, '1');
      localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  })();

  function get(key, fallback) {
    try {
      var raw = usable ? localStorage.getItem(key) : memory[key];
      if (raw == null) return fallback;
      var val = JSON.parse(raw);
      if (val == null || typeof val !== 'object') return fallback;
      return val;
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      var raw = JSON.stringify(value);
      if (usable) localStorage.setItem(key, raw);
      else memory[key] = raw;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Per-key migration tables: MIGRATIONS[key][fromVersion] = fn(data) -> data. Empty in v1. */
  var MIGRATIONS = {};
  var CURRENT_VERSION = 1;

  function migrate() {
    Object.keys(KEYS).forEach(function (k) {
      var key = KEYS[k];
      var data = get(key, null);
      if (!data || typeof data.version !== 'number') return;
      var table = MIGRATIONS[key] || {};
      var changed = false;
      while (data.version < CURRENT_VERSION && table[data.version]) {
        data = table[data.version](data);
        changed = true;
      }
      if (changed) set(key, data);
    });
  }

  WT.storage = {
    KEYS: KEYS,
    get: get,
    set: set,
    migrate: migrate,
    isPersistent: function () { return usable; }
  };
})();
