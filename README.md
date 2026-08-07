# Workout Timer

A zero-dependency workout timer web app. Works hosted as a static site **and** opened directly as a local file (double-click `index.html`) — no build step, no server, no external resources, fully offline.

## Features

- **6 timer modes**: EMOM, Intervals (work/rest), Tabata (one-tap 20s/10s × 8), AMRAP countdown, long-duration Timer, and Stopwatch with laps
- **Custom presets** — build, name, and save workouts (stored in your browser)
- **Drift-free timing** — all state derives from the wall clock, so timers stay exact even in throttled background tabs
- **Synthesized audio cues** — 3-2-1 countdown beeps and distinct work/rest/finish tones, pre-scheduled on the audio clock so they fire on time even when the tab is backgrounded; 4 switchable sound packs (Classic, Chime, Referee, 8-Bit)
- **4 themes** — Dark Gym, High Contrast, Minimal Light, Retro LCD
- **Live clock** (local timezone / DST automatic), fullscreen toggle, screen wake lock during workouts (HTTPS)
- Responsive: huge across-the-room digits on laptops/tablets, big touch targets on phones
- Keyboard shortcuts while running: `Space` pause/resume, `F` fullscreen, `L` lap, `Esc` stop — or tap the digits to pause

## Use it

- **Hosted**: serve the folder from any static host (GitHub Pages, Netlify, …)
- **Local**: just open `index.html` in a browser (wake lock needs HTTPS, everything else works)

## Development

Plain HTML/CSS/JS, classic script tags, single `window.WT` namespace. Architecture and module contracts are documented in [SPEC.md](SPEC.md). Engine/compiler unit tests and an audio bench live in `test/harness.html` — open it in a browser.
