# Workout Timer — Architecture Spec (v1)

Zero-dependency static workout-timer site. Works hosted (GitHub Pages/Netlify) **and** opened directly as `file://`. No build step, no CDNs, no asset files. All JS files are classic `<script>` tags loaded in dependency order; each attaches one namespace to the single global `window.WT`.

## Hard rules
- **No ES modules** (`type="module"` breaks on `file://`). Classic scripts only.
- **No external resources** of any kind. Fonts = system stacks. Icons = inline SVG. Sounds = Web Audio synthesis.
- **Timer math from wall clock only**: state derives from a `performance.now()` anchor + prefix sums. Never accumulate ticks.
- Audio cues for the current segment are **pre-scheduled on the AudioContext clock** so they fire on time in throttled background tabs.
- `AudioContext` must be created/resumed from a user gesture (`WT.audio.unlock()` on Start).
- Frozen files (do not edit; contracts live there): `index.html`, `css/base.css`, `js/util.js`, `js/storage.js`, this file.

## Files & ownership
```
index.html            frozen scaffold: all screens, IDs, script order
css/base.css          frozen: reset + CSS token contract (:root defaults = Dark Gym)
css/layout.css        Agent B — screens, forms, run view, responsive
css/themes.css        Agent B — [data-theme] token overrides (4 themes)
js/util.js            frozen: WT.util
js/storage.js         frozen: WT.storage
js/modes.js           Agent A — WT.modes (registry + config→segment compiler)
js/engine.js          Agent A — WT.engine (generic segment engine)
js/audio.js           Agent A — WT.audio (synth + 4 sound packs + scheduling)
js/themes.js          Agent B — WT.themes (registry + apply)
js/presets.js         Agent C — WT.presets (CRUD over storage)
js/clock.js           Agent C — WT.clock (live local clock, second-aligned)
js/system.js          Agent C — WT.system (fullscreen + wake lock)
js/ui-home.js         Agent B — WT.uiHome
js/ui-config.js       Agent C — WT.uiConfig (form generated from mode field descriptors)
js/ui-run.js          Agent B — WT.uiRun (engine ↔ DOM/audio binding)
js/ui-settings.js     Agent C — WT.uiSettings
js/app.js             Integrator — WT.app (boot, router, shortcuts)
test/harness.html     Agent A — engine/compiler unit tests + audio bench
```
Script order in index.html: util → storage → modes → engine → audio → themes → presets → clock → system → ui-home → ui-config → ui-run → ui-settings → app.

## Segment shape (central data contract)
```js
{ type: 'prep'|'work'|'rest',   // drives color + sound
  label: 'WORK',                // big text under digits
  durationMs: 60000 | null,     // null = open-ended (stopwatch)
  round: 3, totalRounds: 8 }    // optional → "ROUND 3/8"
```

## WT.modes (js/modes.js)
`WT.modes.list` → array of `{id, name, description, fields, defaults, compile, oneTap?}` for:
- `emom`   — fields: interval (s, default 60), rounds (default 10), prep (default 10). Compile: `[prep] + rounds × [work(interval)]`.
- `hiit`   — work (30), rest (15), rounds (8), prep (10). Compile: `[prep] + rounds × [work, rest]`, **no trailing rest**.
- `tabata` — one-tap (`oneTap: true`, skips config): HIIT with work 20 / rest 10 / rounds 8 / prep 10.
- `amrap`  — minutes (12), prep (10). Compile: `[prep, work(minutes)]`, label "AMRAP".
- `timer`  — minutes (15), prep (5). Long-duration (stretching). Label "TIMER".
- `stopwatch` — no fields. Compile: `[{type:'work', label:'STOPWATCH', durationMs:null}]`.

Field descriptor: `{key, label, type: 'duration'|'int'|'minutes', default, min, max}`. `WT.modes.get(id)`; `compile(config)` returns `Segment[]`. ui-config renders forms generically from `fields` — never hardcodes modes.

## WT.engine (js/engine.js)
`WT.engine.create({segments, now})` → instance. `now` defaults to `() => performance.now()` (injectable for tests only).
- Methods: `start()`, `pause()`, `resume()`, `skip()`, `stop()`, `lap()`, `getState()`, `on/off(event, fn)`.
- `getState()` → `{status: 'idle'|'running'|'paused'|'finished', segmentIndex, segment, remainingMs, elapsedInSegmentMs, totalElapsedMs, laps}`. Open-ended segment → `remainingMs: null`.
- Events: `tick(state)`; `segmentStart({segment, index, boundaryPerfTime})`; `countdown({secondsLeft})`; `pause`; `resume`; `finish`; `lap({lapMs, laps})`; `stop`.
- Accuracy: on start store anchor + prefix sums of durations; every tick recompute `elapsed = now() - anchor - totalPausedMs` and derive index/remaining. Pause stores `pausedAt`; resume adds to `totalPausedMs`. Catch-up after throttling may emit multiple ordered `segmentStart`s in one tick — consumers must tolerate this.
- Ticker: rAF while visible + 250ms setInterval safety net.
- `segmentStart.boundaryPerfTime` = the precise performance.now() time the boundary falls on (for audio scheduling).

## WT.audio (js/audio.js)
- `init()` lazy; `unlock()` (call from user gesture — create/resume ctx); `setPack(id)`; `setVolume(0..1)` (master gain); `getPacks()` → `[{id, name}]`.
- `scheduleSegmentAudio(segment, boundaryPerfTime)` — called on each segmentStart: schedule at absolute AudioContext times (convert via `ctx.currentTime - performance.now()/1000` offset) the 3 countdown beeps at segEnd−3/−2/−1 s and the boundary tone at segEnd (workStart/restStart per next segment type, or `finish` if last). Skip for open-ended segments.
- `cancelScheduled()` — stop all pending nodes (on pause/skip/stop).
- `playNow(cueName)` — immediate cue: 'lap', 'pause', or any pack cue (settings preview).
- Synth: `tone({freq, ms, wave, gain})` osc + gain envelope (5ms attack, exp release, no clicks). Cues may be arrays (arpeggio).
- 4 packs: `classic` (square gym beep), `chime` (soft sine), `referee` (sawtooth buzzer), `8bit` (square arpeggios). Cue names: `countdown, workStart, restStart, finish, lap, pause`.

## WT.themes (js/themes.js) + css/themes.css
- `WT.themes.list` → `[{id, name, pairedSoundPack}]`; `apply(id)` sets `document.documentElement.dataset.theme` + updates `<meta name="theme-color">`. No persistence here (settings own that).
- Themes: `dark-gym` (default, pack referee), `high-contrast` (pack classic), `minimal-light` (pack chime), `retro-lcd` (pack 8bit).
- All styling uses only tokens declared in base.css `:root`: `--bg, --bg-raised, --fg, --fg-muted, --accent, --accent-work, --accent-rest, --accent-prep, --danger, --radius, --font-display, --font-ui, --shadow`.
- Segment coloring: `#screen-run[data-segment-type="work"] { --run-accent: var(--accent-work) }` etc.

## WT.presets (js/presets.js)
`list()`, `get(id)`, `save({name, modeId, config})` (adds id/createdAt), `update(id, patch)`, `remove(id)`, `onChange(fn)`. Stores **config, not segments** (recompiled at start). Uses WT.storage.

## WT.clock (js/clock.js)
`mount(el)` / `unmount()` — `toLocaleTimeString` (local TZ/DST native). Tick aligned to the second: `setTimeout(tick, 1000 - Date.now() % 1000)`.

## WT.system (js/system.js)
- `toggleFullscreen()`, `isFullscreen()`, `onFullscreenChange(fn)` — feature-detect; hide button if API absent (iPhone Safari).
- `acquireWakeLock()` → `{ok, reason?}` (try/catch; missing on file:// — degrade with hint), `releaseWakeLock()`; re-acquire on visibilitychange while running.

## UI contracts (element IDs are frozen in index.html)
- **#screen-home**: `#home-clock`, `#btn-settings`, `.mode-tile[data-mode]` ×6, `#preset-list`.
- **#screen-config**: `#btn-config-back`, `#config-title`, `#config-form`, `#config-summary`, `#btn-start`, `#btn-save-preset`.
- **#screen-run** (carries `data-segment-type`): `#run-progress`, `#run-clock`, `#run-label`, `#run-time`, `#run-round`, `#run-next`, `#lap-list`, `#btn-pause`, `#btn-skip`, `#btn-lap`, `#btn-stop`, `#btn-fullscreen`.
- **#screen-settings**: `#btn-settings-close`, `#theme-list`, `#sound-list`, `#volume-slider`, `#wake-status`.
- Each ui-*.js exposes `show(params)` / `hide()`. Screens toggle via `.active` class; router is `WT.app.go(screenId, params)`.
- ui-run.show({segments, meta}) creates engine, binds events → DOM + audio, owns controls. Tap on digits toggles pause. Tenths shown under 10s. Digits use `tabular-nums`.

## Storage schema (WT.storage.KEYS)
```js
// wt.settings
{ version: 1, theme, soundPack, volume, lastMode, lastConfigs: {modeId: config} }
// wt.presets
{ version: 1, items: [{id, name, modeId, config, createdAt, updatedAt}] }
```
Reads validate shape; corrupt values fall back to defaults, never crash.

## Session state machine
Statuses: `idle | running | paused | finished` (prep is just a running segment of type 'prep').
Key transitions: start → unlock audio + wake lock + schedule prep audio; segmentStart → recolor via data-segment-type, update label/round/next, reschedule audio; pause → cancelScheduled + release wake lock; resume → reschedule remainder; finish → fanfare + summary state; stop → confirm if >10s elapsed, home.
