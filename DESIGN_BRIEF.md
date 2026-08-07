# Design Overhaul Brief (v2)

Goal: a serious, gym-hardened look. Everything aligned on every device from 320px phones to 4K desktops. New default theme: **Hardcore** — pure black, huge RED digits. Add **Modern White**. Keep and polish the existing three.

## Non-negotiable constraints
- No external resources of any kind (no webfonts, no images). System font stacks, inline SVG, CSS only.
- Element **IDs are frozen** (JS binds to them). The `<script>` block order in index.html is frozen.
- These class names are **frozen** (JS creates or queries them): `active, finished, paused, pulse, selected, ico-pause, ico-play, mode-grid, mode-tile, preset-item, preset-item-main, preset-delete-btn, preset-empty, preset-meta, preset-name, field-row, field-label, stepper, stepper-btn, stepper-value, lap-item, lap-index, lap-time, theme-card, theme-name, theme-swatch, theme-swatch-color, sound-row, sound-select-btn, sound-preview-btn, wake-hint-toast, icon-btn, btn, btn-primary, btn-secondary`. You may add classes and wrapper elements in index.html, and restyle everything.
- `#screen-run[data-segment-type]` color logic must keep working in every theme.
- Both test suites must still pass afterwards (they check behavior, not styling).

## Theme roster (5) — `js/themes.js` list + `css/themes.css`
1. **`hardcore`** — NEW DEFAULT. Pure black `#000` everywhere. Run digits are RED and enormous. Palette: bg `#000`, raised `#111214`, fg `#ffffff`, muted `#8a8f98`, accent/work `#ff2222`, rest `#37b6ff` (cold steel blue), prep `#ffffff`, danger `#ff2222`. Sharp: radius 8px. Typography: heavy (800–900), uppercase display labels with wide letter-spacing (0.2em+). On the run screen the DIGITS themselves take the segment color (red during work) — introduce a `--run-digits` token (default `var(--fg)`) that hardcore sets to `var(--run-accent)`. Subtle red top progress bar. Think boxing-gym scoreboard.
2. **`modern-white`** — NEW. Clean, airy, premium-light: bg `#f6f7f8`, cards `#ffffff`, ink `#101114`, muted `#6b7280`, accent `#101114` (black buttons), work `#e11d2e`, rest `#2563eb`, prep `#f59e0b`, radius 16px, soft layered shadows, generous whitespace.
3. **`dark-gym`** — keep palette, polish only.
4. **`retro-lcd`** — keep, polish only (keep the digit-size cap fix).
5. **`high-contrast`** — keep (accessibility), polish only.
Sound pairings: hardcore→referee, modern-white→chime, dark-gym→classic, retro-lcd→8bit, high-contrast→classic.
**Default change**: every hardcoded `'dark-gym'` default (js/themes.js DEFAULT_ID, js/app.js, js/ui-config.js, js/ui-settings.js settings fallbacks) becomes `'hardcore'`. Update `THEME_SWATCHES` in ui-settings.js to the new palettes and add entries for the new themes.

## Alignment & layout system (css/base.css + css/layout.css)
- **Spacing scale**: 4/8/12/16/24/32/48 only. No ad-hoc values.
- **Content column**: home, config, and settings content sits in a centered column, `max-width: 720px`, side gutters `clamp(16px, 4vw, 32px)`. On ≥1100px home's mode grid may go 3-across (max-width 960px for the grid). The RUN screen stays full-bleed edge-to-edge always.
- **No horizontal overflow from 320px to 2560px.** Test both.
- Safe-area insets respected on every screen (notched phones).
- **Vertical rhythm**: consistent gaps between header/sections (24–32px), consistent card padding (16–20px).

## Per-screen punch list
**Home**: header baseline-aligned (title left, clock + gear right, all vertically centered); tiles equal height with a clear hierarchy — bold uppercase mode name, muted description, a thin accent bar or corner detail; obvious pressed/hover states; Tabata "one-tap" visually distinct (filled accent). Preset rows: name prominent, meta muted, delete affordance quiet until hover/focus; empty state centered and styled.
**Config**: field rows as aligned cards — label left, stepper right, identical row heights; stepper buttons ≥44px, value min-width so rows don't shift when digits change; summary as a distinct card/chip directly under the form (not floating in dead space); bottom action bar sticky with safe-area padding, Start visually dominant.
**Run** (the centerpiece): segment label small, uppercase, letterspaced ABOVE digits; digits massive, perfectly centered optically (account for line-height), `tabular-nums`; ROUND x/y as a subtle pill; "Next:" line quiet, below; progress bar 6px, accent-colored, full-width top; controls bottom-centered, evenly spaced, pause 50% larger than siblings; **landscape phones (e.g. 844×390): everything must fit without scroll — compact vertical spacing, digits sized by vh**; `.paused` dims everything but a clear resume state; `.finished` shows total time + a "DONE" treatment.
**Settings**: theme cards in a responsive grid (2-col phone, 3+ wide), each with a 3-color swatch strip of the REAL new palettes and a clear selected ring; sound rows aligned (name left, preview + select right, selected state obvious); volume row aligned with the same gutters; wake status as a quiet footnote.

## QA matrix (for the visual-QA pass)
Screens: home (with ≥1 saved preset), config (hiit), run (prep AND work states), settings.
Themes: all 5. Viewports: 360×740 (via iframe — headless min width is 500), 500×844, 844×500, 768×1024, 1440×900.
Checks: no clipped/overflowing text, no horizontal scroll, consistent gutters, digits fit, controls aligned, every theme legible (contrast), selected states visible, landscape run fits without scroll.
