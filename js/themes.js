/* themes.js — WT.themes: registry + apply. No persistence (settings own that). */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var LIST = [
    { id: 'dark-gym', name: 'Dark Gym', pairedSoundPack: 'referee' },
    { id: 'high-contrast', name: 'High Contrast', pairedSoundPack: 'classic' },
    { id: 'minimal-light', name: 'Minimal Light', pairedSoundPack: 'chime' },
    { id: 'retro-lcd', name: 'Retro LCD', pairedSoundPack: '8bit' }
  ];

  var DEFAULT_ID = 'dark-gym';

  /* theme-color meta values, kept out of the public list shape per spec */
  var META_COLOR = {
    'dark-gym': '#0d0f12',
    'high-contrast': '#000000',
    'minimal-light': '#faf7f2',
    'retro-lcd': '#04140a'
  };

  function findTheme(id) {
    for (var i = 0; i < LIST.length; i++) {
      if (LIST[i].id === id) return LIST[i];
    }
    return null;
  }

  function apply(id) {
    var theme = findTheme(id) || findTheme(DEFAULT_ID);
    if (!theme) return;
    if (document.documentElement) {
      document.documentElement.dataset.theme = theme.id;
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', META_COLOR[theme.id] || META_COLOR[DEFAULT_ID]);
    }
    return theme;
  }

  function getCurrent() {
    var id = document.documentElement && document.documentElement.dataset
      ? document.documentElement.dataset.theme
      : null;
    return id || DEFAULT_ID;
  }

  WT.themes = {
    list: LIST,
    apply: apply,
    getCurrent: getCurrent
  };
})();
