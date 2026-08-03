# Solitaire PWA — maintainer notes

Ad-free Klondike solitaire for an iPhone home screen (built for Kristofer's wife as a
replacement for an ad-riddled App Store app). Live at
**https://krissibt.github.io/solitaireMobile/** — GitHub Pages, `main` branch, root.

## Hard constraints (don't break these)

- **Zero external requests.** No CDNs, fonts, images, or analytics — the app must work
  fully offline once installed. Cards are inline SVG generated in `js/cards.js`.
- **No build step.** Plain ES modules, served as-is.
- **iOS Safari is the target.** The meta tags in `index.html` and the fixed-body /
  safe-area / touch-action CSS in `styles.css` are load-bearing; test on a real iPhone
  after touching them.
- **Minimal UI on purpose** (no scoring): clutter was the problem being solved.

## Releasing a change

1. Edit files, verify locally (below).
2. **Bump the `CACHE` version string in `sw.js`** — this is the entire release mechanism;
   without it installed apps keep the old files forever.
3. Commit, push to `main`. Pages redeploys in ~1 min; installed PWAs pick it up on the
   second launch after that.

## Architecture (12 files)

- `js/game.js` — pure rules engine, zero DOM. Cards are ints 0–51 (`suit = id/13|0`,
  `rank = id%13`). Piles referenced by string: `S`, `W`, `F0`–`F3`, `T0`–`T6`.
  Undo = invertible move log; a deal is fully defined by its PRNG `seed`.
- `js/layout.js` — ALL coordinate math (card size, pile positions, fan compression).
  Renderer and hit-testing both consume it; never compute geometry elsewhere.
- `js/render.js` — 52 card divs created once, moved only via `transform` (compositor).
  CSS transitions animate moves from wherever the card currently is.
- `js/input.js` — pointer state machine: tap vs drag (8px threshold), drop targeting by
  rect-overlap (not `elementFromPoint`), smart-move on tap. Emits actions; `main.js`
  mutates state.
- `js/main.js` — conductor: wires everything, HUD, dialogs, timer, persistence hooks.
- `js/cascade.js` — canvas win animation (never cleared → trail effect).
- `js/cards.js`, `js/audio.js` (WebAudio synth), `js/storage.js` (localStorage).
- `sw.js` — precache-all, cache-first, versioned cache name.

Dev hooks: `window.__sol` exposes state/layout/game/render + `act()`, `newGame(seed, mode)`,
`autoComplete()`, `undo()` in the console.

## Testing

```sh
node tests/engine-test.mjs          # pure-logic suite, no browser needed
python3 -m http.server 8642         # in repo root, then:
node tests/browser-test.mjs         # headless-Chromium E2E via raw WebDriver
```

The browser suite drives real synthetic touch input (taps, drags, illegal drops), checks
persistence across reload, forces a win to exercise auto-complete + cascade + stats, and
fails on any console error. Screenshots land in `tests/out/`.

### Snap Chromium/chromedriver gotchas (this machine)

- Launch the driver as `chromium.chromedriver`; do **not** pass a `binary:` path in
  capabilities (snap confinement makes `execvp /snap/bin/chromium` fail — omit it and
  the driver finds its own chromium).
- `--user-data-dir` must be under `~/snap/chromium/common/` — snap chromium cannot write
  to `/tmp` or hidden dirs like `~/.cache`.
- A killed session leaves a profile lock that makes the next session die with
  "Chrome instance exited": `rm -rf ~/snap/chromium/common/sol-wd/profile` fixes it.

## Bugs already learned the hard way

- iOS WebKit rejects `radial-gradient(120% 90% at …)` — the two-value size **requires
  the `ellipse` keyword** — and an invalid gradient inside the `background` shorthand
  killed the background-color with it (white canvas, invisible white-on-white UI).
  Keep `background-color` as its own longhand fallback; emulated-Chromium testing
  cannot catch WebKit-only parse failures.
- `#cascade` needs explicit `width/height: 100%`: an absolutely-positioned **replaced**
  element (canvas/img) does not stretch from `inset: 0` alone — it silently uses its
  intrinsic attribute size instead.
- Icons: ImageMagick mangles SVG gradients; render `icons/icon.svg` with Inkscape
  (no `feDropShadow` — old Inkscape drops the whole filtered group), then downscale.
