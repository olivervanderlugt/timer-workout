/* modes.js — WT.modes: mode registry + config→Segment[] compiler. Agent A.
 *
 * Each mode: { id, name, description, fields, defaults, compile, oneTap? }
 * Field descriptor: { key, label, type: 'duration'|'int'|'minutes', default, min, max }
 *   - 'duration' fields are in SECONDS, 'minutes' fields in MINUTES (converted here),
 *     'int' fields are plain counts.
 * compile(config) resolves missing keys from defaults, clamps every value to the
 * field's [min, max], and returns Segment[]:
 *   { type: 'prep'|'work'|'rest', label, durationMs|null, round?, totalRounds? }
 * Zero-duration segments (prep 0, rest 0) are omitted from the output.
 */
(function () {
  'use strict';
  window.WT = window.WT || {};

  var SEC = 1000;
  var MIN_MS = 60000;

  function field(key, label, type, def, min, max) {
    return { key: key, label: label, type: type, default: def, min: min, max: max };
  }

  function clampField(f, value) {
    var n = Number(value);
    if (!isFinite(n)) n = f.default;
    n = Math.round(n);
    return WT.util.clamp(n, f.min, f.max);
  }

  /* Merge config over defaults, clamp everything to field bounds. */
  function resolveConfig(fields, config) {
    var out = {};
    config = config || {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var v = (config[f.key] == null) ? f.default : config[f.key];
      out[f.key] = clampField(f, v);
    }
    return out;
  }

  function defaultsOf(fields) {
    var d = {};
    for (var i = 0; i < fields.length; i++) d[fields[i].key] = fields[i].default;
    return d;
  }

  function pushPrep(segs, prepSec) {
    if (prepSec > 0) {
      segs.push({ type: 'prep', label: 'GET READY', durationMs: prepSec * SEC });
    }
  }

  /* ---- compilers ---- */

  function makeEmomCompile(fields) {
    return function (config) {
      var c = resolveConfig(fields, config);
      var segs = [];
      pushPrep(segs, c.prep);
      for (var r = 1; r <= c.rounds; r++) {
        segs.push({
          type: 'work', label: 'WORK', durationMs: c.interval * SEC,
          round: r, totalRounds: c.rounds
        });
      }
      return segs;
    };
  }

  /* Shared by hiit + tabata. [prep] + rounds × [work, rest], NO trailing rest. */
  function makeHiitCompile(fields) {
    return function (config) {
      var c = resolveConfig(fields, config);
      var segs = [];
      pushPrep(segs, c.prep);
      for (var r = 1; r <= c.rounds; r++) {
        segs.push({
          type: 'work', label: 'WORK', durationMs: c.work * SEC,
          round: r, totalRounds: c.rounds
        });
        if (r < c.rounds && c.rest > 0) {
          segs.push({
            type: 'rest', label: 'REST', durationMs: c.rest * SEC,
            round: r, totalRounds: c.rounds
          });
        }
      }
      return segs;
    };
  }

  /* amrap / timer: [prep] + single work segment of `minutes`. */
  function makeSingleCompile(fields, label) {
    return function (config) {
      var c = resolveConfig(fields, config);
      var segs = [];
      pushPrep(segs, c.prep);
      segs.push({ type: 'work', label: label, durationMs: c.minutes * MIN_MS });
      return segs;
    };
  }

  function compileStopwatch() {
    return [{ type: 'work', label: 'STOPWATCH', durationMs: null }];
  }

  /* ---- field sets ---- */

  var emomFields = [
    field('interval', 'Interval (sec)', 'duration', 60, 5, 600),
    field('rounds', 'Rounds', 'int', 10, 1, 99),
    field('prep', 'Prep (sec)', 'duration', 10, 0, 120)
  ];

  var hiitFields = [
    field('work', 'Work (sec)', 'duration', 30, 5, 600),
    field('rest', 'Rest (sec)', 'duration', 15, 0, 600),
    field('rounds', 'Rounds', 'int', 8, 1, 99),
    field('prep', 'Prep (sec)', 'duration', 10, 0, 120)
  ];

  var tabataFields = [
    field('work', 'Work (sec)', 'duration', 20, 5, 600),
    field('rest', 'Rest (sec)', 'duration', 10, 0, 600),
    field('rounds', 'Rounds', 'int', 8, 1, 99),
    field('prep', 'Prep (sec)', 'duration', 10, 0, 120)
  ];

  var amrapFields = [
    field('minutes', 'Minutes', 'minutes', 12, 1, 180),
    field('prep', 'Prep (sec)', 'duration', 10, 0, 120)
  ];

  var timerFields = [
    field('minutes', 'Minutes', 'minutes', 15, 1, 180),
    field('prep', 'Prep (sec)', 'duration', 5, 0, 120)
  ];

  /* ---- registry ---- */

  var list = [
    {
      id: 'emom', name: 'EMOM',
      description: 'Every minute on the minute — repeat an interval for N rounds.',
      fields: emomFields, defaults: defaultsOf(emomFields),
      compile: makeEmomCompile(emomFields)
    },
    {
      id: 'hiit', name: 'HIIT',
      description: 'Work / rest intervals for N rounds.',
      fields: hiitFields, defaults: defaultsOf(hiitFields),
      compile: makeHiitCompile(hiitFields)
    },
    {
      id: 'tabata', name: 'Tabata',
      description: '20s on / 10s off × 8. One tap to start.',
      fields: tabataFields, defaults: defaultsOf(tabataFields),
      compile: makeHiitCompile(tabataFields),
      oneTap: true
    },
    {
      id: 'amrap', name: 'AMRAP',
      description: 'As many rounds as possible in a set time.',
      fields: amrapFields, defaults: defaultsOf(amrapFields),
      compile: makeSingleCompile(amrapFields, 'AMRAP')
    },
    {
      id: 'timer', name: 'Timer',
      description: 'Simple long countdown — stretching, holds, rest days.',
      fields: timerFields, defaults: defaultsOf(timerFields),
      compile: makeSingleCompile(timerFields, 'TIMER')
    },
    {
      id: 'stopwatch', name: 'Stopwatch',
      description: 'Open-ended count-up with laps.',
      fields: [], defaults: {},
      compile: compileStopwatch
    }
  ];

  function get(id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  WT.modes = { list: list, get: get };
})();
