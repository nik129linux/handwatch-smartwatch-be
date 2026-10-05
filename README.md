# Hand Hygiene Watch

Hospital hand-hygiene smartwatch prototype + infection-control unit view.
The watch reminds and records in silence, on the body. The watch WILL be
wrong — a wrong mark is corrected with one tap and never shown as an
accusation. See `DEMO.md` for the 2-minute script.

## Run

- Desktop app: `npm start` (or the **Hand Hygiene Watch** launcher).
- Browser fallback: open `index.html`; unit view is `unit.html`.
- Works offline; English UI; sun/moon toggle (dark default, persisted).

## Controls

Crown wheel scrolls, crown click = Home, side button = privacy,
Esc = back. Panel: **▶ Guided shift** (~75 s story), free-mode event
buttons, sensor-noise slider, haptic vocabulary, event log.

## Layout

`index.html` stage (watch + panel) · `unit.html` unit view ·
`css/tokens.css` only raw colors · `css/watch.css` `css/stage.css` ·
`js/watch.js` router · `js/story.js` story + free-mode bus ·
`js/signal.js` `js/classifier.js` sensor synthesis + verdict ·
`js/sense.js` wiring · `js/scope.js` waveform · `js/log.js` 24 h store ·
`js/haptics.js` vibration vocabulary · `main.js` Electron shell.

## Rules (graded)

No sound ever · never red, no accusation wording on the watch ·
unit view has no per-person view · haptics `[60,120,60]` `[35]`
`[30,70,45,70,65]` `[400]` · contrast ≥ 4.5:1 both themes.

## Tests

`node tests/acceptance.js` (browser gate incl. hostile regressions §14) ·
`node tests/classifier.test.js` (no browser) ·
`node tests/electron-smoke.js` (desktop app; prefix `xvfb-run -a` on Wayland).
