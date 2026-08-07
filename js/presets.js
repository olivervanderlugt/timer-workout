/* presets.js — WT.presets: CRUD over WT.storage.KEYS.PRESETS. */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var KEY = WT.storage.KEYS.PRESETS;
  var emitter = WT.util.createEmitter();

  function emptyState() {
    return { version: 1, items: [] };
  }

  function isValidItem(it) {
    return !!it && typeof it === 'object' &&
      typeof it.id === 'string' &&
      typeof it.name === 'string' &&
      typeof it.modeId === 'string' &&
      !!it.config && typeof it.config === 'object';
  }

  /* Reads + validates shape; corrupt/malformed data never crashes, falls back to empty. */
  function read() {
    var data;
    try {
      data = WT.storage.get(KEY, null);
    } catch (e) {
      data = null;
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
      return emptyState();
    }
    var items = data.items.filter(isValidItem).map(function (it) {
      return {
        id: it.id,
        name: it.name,
        modeId: it.modeId,
        config: it.config,
        createdAt: typeof it.createdAt === 'number' ? it.createdAt : Date.now(),
        updatedAt: typeof it.updatedAt === 'number' ? it.updatedAt : Date.now()
      };
    });
    return { version: 1, items: items };
  }

  function write(state) {
    WT.storage.set(KEY, state);
    emitter.emit('change', state.items.slice());
  }

  function list() {
    return read().items.slice();
  }

  function get(id) {
    var items = read().items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return undefined;
  }

  function save(data) {
    data = data || {};
    var state = read();
    var now = Date.now();
    var item = {
      id: WT.util.uid(),
      name: data.name,
      modeId: data.modeId,
      config: data.config || {},
      createdAt: now,
      updatedAt: now
    };
    state.items.push(item);
    write(state);
    return item;
  }

  function update(id, patch) {
    patch = patch || {};
    var state = read();
    var item = null;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) { item = state.items[i]; break; }
    }
    if (!item) return null;
    if (patch.name !== undefined) item.name = patch.name;
    if (patch.modeId !== undefined) item.modeId = patch.modeId;
    if (patch.config !== undefined) item.config = patch.config;
    item.updatedAt = Date.now();
    write(state);
    return item;
  }

  function remove(id) {
    var state = read();
    var before = state.items.length;
    state.items = state.items.filter(function (it) { return it.id !== id; });
    if (state.items.length === before) return false;
    write(state);
    return true;
  }

  /* Returns an unsubscribe function. fn is called with the new items array on every change. */
  function onChange(fn) {
    emitter.on('change', fn);
    return function () { emitter.off('change', fn); };
  }

  WT.presets = {
    list: list,
    get: get,
    save: save,
    update: update,
    remove: remove,
    onChange: onChange
  };
})();
