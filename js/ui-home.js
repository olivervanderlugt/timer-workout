/* ui-home.js — WT.uiHome: home screen (mode tiles + presets). */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var initialized = false;
  var clockMounted = false;

  function go(screen, params) {
    if (WT.app && typeof WT.app.go === 'function') {
      WT.app.go(screen, params);
    }
  }

  function fieldLabel(mode, key) {
    if (mode && mode.fields) {
      for (var i = 0; i < mode.fields.length; i++) {
        if (mode.fields[i].key === key) return mode.fields[i].label || key;
      }
    }
    return key;
  }

  function summarizeConfig(mode, config) {
    if (!config) return '';
    var parts = [];
    Object.keys(config).forEach(function (k) {
      parts.push(fieldLabel(mode, k) + ' ' + config[k]);
    });
    return parts.join(' · ');
  }

  function buildPresetRow(preset) {
    var mode = (WT.modes && WT.modes.get) ? WT.modes.get(preset.modeId) : null;
    var li = document.createElement('li');
    li.className = 'preset-item';
    li.dataset.id = preset.id;

    var main = document.createElement('button');
    main.type = 'button';
    main.className = 'preset-item-main';

    var name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = preset.name || (mode ? mode.name : 'Workout');

    var meta = document.createElement('span');
    meta.className = 'preset-meta';
    var modeName = mode ? mode.name : preset.modeId;
    var summary = summarizeConfig(mode, preset.config);
    meta.textContent = summary ? (modeName + ' · ' + summary) : modeName;

    main.appendChild(name);
    main.appendChild(meta);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'preset-delete-btn icon-btn';
    del.setAttribute('aria-label', 'Delete ' + (preset.name || 'preset'));
    del.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

    li.appendChild(main);
    li.appendChild(del);
    return li;
  }

  function render() {
    var listEl = document.getElementById('preset-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    var presets = (WT.presets && typeof WT.presets.list === 'function') ? WT.presets.list() : [];
    if (!presets || presets.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'preset-empty';
      empty.textContent = 'No saved workouts yet.';
      listEl.appendChild(empty);
      return;
    }
    presets.forEach(function (preset) {
      listEl.appendChild(buildPresetRow(preset));
    });
  }

  function startFromMode(mode) {
    if (!mode || typeof mode.compile !== 'function') return;
    if (WT.audio && typeof WT.audio.unlock === 'function') {
      try { WT.audio.unlock(); } catch (e) { /* ignore */ }
    }
    var segments = mode.compile(mode.defaults);
    go('run', { segments: segments, meta: { title: mode.name } });
  }

  function onModeGridClick(e) {
    var tile = e.target.closest ? e.target.closest('.mode-tile') : null;
    if (!tile) return;
    var modeId = tile.dataset.mode;
    var mode = (WT.modes && WT.modes.get) ? WT.modes.get(modeId) : null;
    if (!mode) return;
    if (mode.oneTap) {
      startFromMode(mode);
    } else {
      go('config', { modeId: modeId });
    }
  }

  function onPresetListClick(e) {
    var itemEl = e.target.closest ? e.target.closest('.preset-item') : null;
    if (!itemEl) return;
    var id = itemEl.dataset.id;
    if (!id) return;

    var delBtn = e.target.closest ? e.target.closest('.preset-delete-btn') : null;
    if (delBtn) {
      var preset = (WT.presets && WT.presets.get) ? WT.presets.get(id) : null;
      var label = preset ? preset.name : 'this workout';
      if (window.confirm('Delete "' + label + '"?')) {
        if (WT.presets && typeof WT.presets.remove === 'function') {
          WT.presets.remove(id);
        }
        render();
      }
      return;
    }

    var mainBtn = e.target.closest ? e.target.closest('.preset-item-main') : null;
    if (mainBtn) {
      var p = (WT.presets && WT.presets.get) ? WT.presets.get(id) : null;
      if (!p) return;
      var mode = (WT.modes && WT.modes.get) ? WT.modes.get(p.modeId) : null;
      if (!mode || typeof mode.compile !== 'function') return;
      if (WT.audio && typeof WT.audio.unlock === 'function') {
        try { WT.audio.unlock(); } catch (err) { /* ignore */ }
      }
      var segments = mode.compile(p.config);
      go('run', { segments: segments, meta: { title: p.name } });
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;

    var grid = document.querySelector('.mode-grid');
    if (grid) grid.addEventListener('click', onModeGridClick);

    var listEl = document.getElementById('preset-list');
    if (listEl) listEl.addEventListener('click', onPresetListClick);

    var settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () { go('settings'); });
    }

    render();

    if (WT.presets && typeof WT.presets.onChange === 'function') {
      WT.presets.onChange(render);
    }
  }

  function show() {
    render();
    if (WT.clock && typeof WT.clock.mount === 'function') {
      var el = document.getElementById('home-clock');
      if (el) {
        WT.clock.mount(el);
        clockMounted = true;
      }
    }
  }

  function hide() {
    if (clockMounted && WT.clock && typeof WT.clock.unmount === 'function') {
      WT.clock.unmount();
    }
    clockMounted = false;
  }

  WT.uiHome = {
    init: init,
    show: show,
    hide: hide
  };
})();
