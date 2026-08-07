/* ui-settings.js — WT.uiSettings: theme/sound/volume/wake-lock settings screen. */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var elThemeList, elSoundList, elVolumeSlider, elWakeStatus, elClose;
  var volumeDebounceTimer = null;

  /* Decorative swatch colors per theme id — kept simple/self-contained rather than
     depending on css/themes.css class names owned by another agent. */
  var THEME_SWATCHES = {
    'hardcore': ['#000000', '#ff2222', '#37b6ff'],
    'modern-white': ['#f6f7f8', '#101114', '#e11d2e'],
    'dark-gym': ['#0d0f12', '#e5484d', '#3b82f6'],
    'retro-lcd': ['#04140a', '#39ff6a', '#0a2414'],
    'high-contrast': ['#000000', '#ffffff', '#ff3b30']
  };

  function defaultSettings() {
    return { version: 1, theme: 'hardcore', soundPack: 'referee', volume: 0.8, lastMode: null, lastConfigs: {} };
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

  function renderThemes(settings) {
    if (!elThemeList) return;
    elThemeList.innerHTML = '';
    var themes = (WT.themes && WT.themes.list) || [];
    themes.forEach(function (theme) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'theme-card';
      card.dataset.theme = theme.id;
      var selected = settings.theme === theme.id;
      if (selected) card.classList.add('selected');
      card.setAttribute('aria-pressed', selected ? 'true' : 'false');

      var swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      var colors = THEME_SWATCHES[theme.id] || ['#888888', '#aaaaaa', '#cccccc'];
      colors.forEach(function (c) {
        var chip = document.createElement('span');
        chip.className = 'theme-swatch-color';
        chip.style.backgroundColor = c;
        swatch.appendChild(chip);
      });

      var name = document.createElement('span');
      name.className = 'theme-name';
      name.textContent = theme.name;

      card.appendChild(swatch);
      card.appendChild(name);
      card.addEventListener('click', function () { selectTheme(theme); });

      elThemeList.appendChild(card);
    });
  }

  function selectTheme(theme) {
    var settings = loadSettings();
    if (WT.themes && WT.themes.apply) WT.themes.apply(theme.id);
    settings.theme = theme.id;

    if (theme.pairedSoundPack && theme.pairedSoundPack !== settings.soundPack) {
      var useMatching = window.confirm('Use matching sound pack?');
      if (useMatching) {
        settings.soundPack = theme.pairedSoundPack;
        if (WT.audio && WT.audio.setPack) WT.audio.setPack(theme.pairedSoundPack);
      }
    }

    saveSettings(settings);
    renderThemes(settings);
    renderSounds(settings);
  }

  function renderSounds(settings) {
    if (!elSoundList) return;
    elSoundList.innerHTML = '';
    var packs = (WT.audio && WT.audio.getPacks && WT.audio.getPacks()) || [];
    packs.forEach(function (pack) {
      var row = document.createElement('div');
      row.className = 'sound-row';
      var selected = settings.soundPack === pack.id;
      if (selected) row.classList.add('selected');

      var selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'sound-select-btn';
      selectBtn.textContent = pack.name;
      selectBtn.setAttribute('aria-pressed', selected ? 'true' : 'false');
      selectBtn.addEventListener('click', function () { selectSoundPack(pack); });

      var previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'sound-preview-btn';
      previewBtn.textContent = 'Preview';
      previewBtn.setAttribute('aria-label', 'Preview ' + pack.name);
      previewBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        previewPack(pack.id);
      });

      row.appendChild(selectBtn);
      row.appendChild(previewBtn);
      elSoundList.appendChild(row);
    });
  }

  /* No WT.audio.previewCue exists — approximate a preview by temporarily switching the
     active pack, playing the cue, then restoring the previous pack shortly after. This
     does not persist the temporary switch. */
  function previewPack(packId) {
    if (!WT.audio) return;
    var settings = loadSettings();
    var previous = settings.soundPack;
    if (WT.audio.unlock) WT.audio.unlock();
    if (WT.audio.setPack) WT.audio.setPack(packId);
    if (WT.audio.playNow) WT.audio.playNow('workStart');
    if (previous && previous !== packId && WT.audio.setPack) {
      setTimeout(function () {
        WT.audio.setPack(previous);
      }, 50);
    }
  }

  function selectSoundPack(pack) {
    var settings = loadSettings();
    settings.soundPack = pack.id;
    saveSettings(settings);
    if (WT.audio && WT.audio.setPack) WT.audio.setPack(pack.id);
    renderSounds(settings);
  }

  function onVolumeInput(e) {
    var v = Number(e.target.value);
    if (isNaN(v)) return;
    var vol = WT.util.clamp(v, 0, 100) / 100;
    if (WT.audio && WT.audio.setVolume) WT.audio.setVolume(vol);

    if (volumeDebounceTimer) clearTimeout(volumeDebounceTimer);
    volumeDebounceTimer = setTimeout(function () {
      var settings = loadSettings();
      settings.volume = vol;
      saveSettings(settings);
    }, 300);
  }

  function renderWakeStatus() {
    if (!elWakeStatus) return;
    var supported = !!(navigator && navigator.wakeLock);
    elWakeStatus.textContent = supported
      ? 'Screen will stay awake during workouts'
      : 'Screen may sleep — your browser/context doesn’t support wake lock (needs HTTPS)';
  }

  function onClose() {
    if (WT.app && WT.app.go) WT.app.go('home');
  }

  function show() {
    var settings = loadSettings();
    renderThemes(settings);
    renderSounds(settings);
    if (elVolumeSlider) {
      var vol = typeof settings.volume === 'number' ? settings.volume : 0.8;
      elVolumeSlider.value = String(Math.round(WT.util.clamp(vol, 0, 1) * 100));
    }
    renderWakeStatus();
  }

  function hide() {
    if (volumeDebounceTimer) {
      clearTimeout(volumeDebounceTimer);
      volumeDebounceTimer = null;
    }
  }

  function init() {
    elThemeList = WT.util.qs('#theme-list');
    elSoundList = WT.util.qs('#sound-list');
    elVolumeSlider = WT.util.qs('#volume-slider');
    elWakeStatus = WT.util.qs('#wake-status');
    elClose = WT.util.qs('#btn-settings-close');

    if (elVolumeSlider) elVolumeSlider.addEventListener('input', onVolumeInput);
    if (elClose) elClose.addEventListener('click', onClose);
  }

  WT.uiSettings = {
    show: show,
    hide: hide,
    init: init
  };
})();
