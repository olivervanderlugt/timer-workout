/* themes.js — WT.themes: registry + apply. No persistence (settings own that). */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var LIST = [
    { id: 'hardcore', name: 'Hardcore', pairedSoundPack: 'referee' },
    { id: 'modern-white', name: 'Modern White', pairedSoundPack: 'chime' },
    { id: 'dark-gym', name: 'Dark Gym', pairedSoundPack: 'classic' },
    { id: 'retro-lcd', name: 'Retro LCD', pairedSoundPack: '8bit' },
    { id: 'high-contrast', name: 'High Contrast', pairedSoundPack: 'classic' }
  ];

  var DEFAULT_ID = 'hardcore';

  /* theme-color meta values, kept out of the public list shape per spec */
  var META_COLOR = {
    'hardcore': '#000000',
    'modern-white': '#f6f7f8',
    'dark-gym': '#0d0f12',
    'retro-lcd': '#04140a',
    'high-contrast': '#000000'
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
