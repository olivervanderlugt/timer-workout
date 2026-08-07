/* ui-config.js — WT.uiConfig: generic config form built from WT.modes.get(modeId).fields. */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var elTitle, elForm, elSummary, elStart, elSavePreset, elBack;

  var currentMode = null;
  var currentModeId = null;
  var currentConfig = null;
  var currentPresetId = null;

  function defaultSettings() {
    return { version: 1, theme: 'dark-gym', soundPack: 'referee', volume: 0.8, lastMode: null, lastConfigs: {} };
  }

  function loadSettings() {
    var s = WT.storage.get(WT.storage.KEYS.SETTINGS, null);
    if (!s || typeof s !== 'object') return defaultSettings();
    var d = defaultSettings();
    return {
      version: 1,
      theme: typeof s.theme === 'string' ? s.theme : d.theme,
      soundPack: typeof s.soundPack === 'string' ? s.soundPack : d.soundPack,
      volume: typeof s.volume === 'number' ? s.volume : d.volume,
      lastMode: typeof s.lastMode === 'string' ? s.lastMode : d.lastMode,
      lastConfigs: (s.lastConfigs && typeof s.lastConfigs === 'object') ? s.lastConfigs : {}
    };
  }

  function saveSettings(settings) {
    WT.storage.set(WT.storage.KEYS.SETTINGS, settings);
  }

  function clampField(field, v) {
    var lo = (field.min !== undefined && field.min !== null) ? field.min : -Infinity;
    var hi = (field.max !== undefined && field.max !== null) ? field.max : Infinity;
    return WT.util.clamp(v, lo, hi);
  }

  function stepFor(field) {
    return field.type === 'duration' ? 5 : 1;
  }

  function formatDurationSec(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + WT.util.pad2(s);
  }

  function fieldDisplay(field, value) {
    if (field.type === 'duration') return formatDurationSec(value);
    if (field.type === 'minutes') return value + ' min';
    return String(value);
  }

  function buildForm(mode, initial) {
    elForm.innerHTML = '';
    currentConfig = {};
    var fields = mode.fields || [];

    fields.forEach(function (field) {
      var raw = (initial && initial[field.key] !== undefined) ? initial[field.key] : field.default;
      currentConfig[field.key] = clampField(field, raw);

      var row = document.createElement('div');
      row.className = 'field-row';

      var label = document.createElement('label');
      label.className = 'field-label';
      label.textContent = field.label;
      row.appendChild(label);

      var stepper = document.createElement('div');
      stepper.className = 'stepper';

      var minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'stepper-btn';
      minusBtn.textContent = '−';
      minusBtn.setAttribute('aria-label', 'Decrease ' + field.label);

      var valueEl = document.createElement('span');
      valueEl.className = 'stepper-value';
      valueEl.textContent = fieldDisplay(field, currentConfig[field.key]);

      var plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'stepper-btn';
      plusBtn.textContent = '+';
      plusBtn.setAttribute('aria-label', 'Increase ' + field.label);

      function applyDelta(sign) {
        var step = stepFor(field);
        var next = clampField(field, currentConfig[field.key] + sign * step);
        currentConfig[field.key] = next;
        valueEl.textContent = fieldDisplay(field, next);
        updateSummary();
      }

      minusBtn.addEventListener('click', function () { applyDelta(-1); });
      plusBtn.addEventListener('click', function () { applyDelta(1); });

      stepper.appendChild(minusBtn);
      stepper.appendChild(valueEl);
      stepper.appendChild(plusBtn);
      row.appendChild(stepper);

      elForm.appendChild(row);
    });
  }

  function updateSummary() {
    if (!elSummary || !currentMode) return;
    var segments = [];
    try {
      segments = (currentMode.compile && currentMode.compile(currentConfig)) || [];
    } catch (e) {
      segments = [];
    }

    var totalMs = 0;
    var openEnded = false;
    segments.forEach(function (seg) {
      if (seg.durationMs == null) openEnded = true;
      else totalMs += seg.durationMs;
    });

    var fields = currentMode.fields || [];
    var parts = fields.map(function (field) {
      return fieldDisplay(field, currentConfig[field.key]) + ' ' + String(field.label).toLowerCase();
    });

    var totalStr = openEnded ? 'open-ended' : 'total ' + WT.util.formatHMS(totalMs);
    var summary = parts.length ? parts.join(' · ') + ' · ' + totalStr : totalStr;
    elSummary.textContent = summary;
  }

  function flashSaved() {
    if (!elSavePreset) return;
    var original = elSavePreset.textContent;
    elSavePreset.textContent = 'Saved ✓';
    elSavePreset.disabled = true;
    setTimeout(function () {
      elSavePreset.textContent = original;
      elSavePreset.disabled = false;
    }, 1200);
  }

  function onStart() {
    if (!currentMode || !currentModeId) return;

    var settings = loadSettings();
    settings.lastConfigs = settings.lastConfigs || {};
    settings.lastConfigs[currentModeId] = currentConfig;
    settings.lastMode = currentModeId;
    saveSettings(settings);

    var segments = [];
    try {
      segments = (currentMode.compile && currentMode.compile(currentConfig)) || [];
    } catch (e) {
      segments = [];
    }

    if (WT.app && WT.app.go) {
      WT.app.go('run', { segments: segments, meta: { title: currentMode.name } });
    }
  }

  function onSavePreset() {
    if (!currentMode || !currentModeId || !WT.presets) return;
    var defaultName = currentMode.name || 'Workout';
    var name = window.prompt('Preset name', defaultName);
    if (name === null) return; /* cancelled */
    name = (name || '').trim() || defaultName;

    var existing = currentPresetId && WT.presets.get(currentPresetId);
    if (existing) {
      WT.presets.update(currentPresetId, { name: name, modeId: currentModeId, config: currentConfig });
    } else {
      var saved = WT.presets.save({ name: name, modeId: currentModeId, config: currentConfig });
      currentPresetId = saved && saved.id;
    }
    flashSaved();
  }

  function onBack() {
    if (WT.app && WT.app.go) WT.app.go('home');
  }

  function show(params) {
    params = params || {};
    currentModeId = params.modeId;
    currentMode = (WT.modes && WT.modes.get) ? WT.modes.get(currentModeId) : null;
    if (!currentMode) return;
    currentPresetId = params.presetId || null;

    if (elTitle) elTitle.textContent = currentMode.name || '';

    var initial = null;
    if (currentPresetId && WT.presets) {
      var preset = WT.presets.get(currentPresetId);
      if (preset && preset.config) initial = preset.config;
    }
    if (!initial) {
      var settings = loadSettings();
      if (settings.lastConfigs && settings.lastConfigs[currentModeId]) {
        initial = settings.lastConfigs[currentModeId];
      }
    }

    buildForm(currentMode, initial || {});
    updateSummary();
  }

  function hide() {
    /* Screen visibility is toggled by the router; nothing to tear down. */
  }

  function init() {
    elTitle = WT.util.qs('#config-title');
    elForm = WT.util.qs('#config-form');
    elSummary = WT.util.qs('#config-summary');
    elStart = WT.util.qs('#btn-start');
    elSavePreset = WT.util.qs('#btn-save-preset');
    elBack = WT.util.qs('#btn-config-back');

    if (elForm) elForm.addEventListener('submit', function (e) { e.preventDefault(); });
    if (elStart) elStart.addEventListener('click', onStart);
    if (elSavePreset) elSavePreset.addEventListener('click', onSavePreset);
    if (elBack) elBack.addEventListener('click', onBack);
  }

  WT.uiConfig = {
    show: show,
    hide: hide,
    init: init
  };
})();
