# Stage path: authoring a page the renderer films

Load this after the treatment says `path: stage`. On the stage path you are the illustrator, the
animator and the editor: you write one page that draws the film as a function of time, and the
renderer captures it frame by frame, deterministically, then gates, checks and encodes it. The page
is yours; the kit gives motion primitives, never ready-made scenes, objects or layouts.

## Files

- `<out>/treatment.json`: the treatment (see `treatment.md`).
- `<out>/stage/index.html`: the page. Put its own SVG, PNG, JPG, WebP, JS, CSS and WAV files beside
  it under `stage/`. Write everything yourself; never install, download or copy a third-party library
  into the stage directory.
- Rasters are textures and stills, never a frame sequence: at most 24 raster files and 8 MB in total.
  Ten or more rasters of one size (a flipbook), or any animated GIF, APNG or WebP, stops the render
  with exit 17.

## The page contract

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/lit/fonts.css">
<script src="/lit/stage-kit.js"></script>
<body>…your SVG, DOM and canvases…</body>
<script>
  const COPY = { /* every on-screen line, in one place, so copy is easy to edit */ };
  LitStage.define({ width: 1920, height: 1080, fps: 60, duration: 16, render(t) { /* draw frame t */ } });
</script>
```

- `LitStage.define({ width, height, fps, duration, render })` (or `window.litStage = { … }`). The size
  must match the treatment's `format`: 1920x1080 for 16:9, 1080x1920 for 9:16. `fps` is 60, or 30 when
  the treatment says so. `duration` in seconds must land within ±10 % of `durationSec`.
- `render(t)` draws the frame at time `t` in seconds. Make it a pure function of `t` where you can;
  that keeps every frame seekable and deterministic.
- You may also use CSS animations and transitions, the Web Animations API, SVG SMIL, and
  `requestAnimationFrame` with Canvas2D or WebGL. The renderer drives all of them from a virtual
  clock: `Date`, `performance.now`, timers, `requestAnimationFrame`, `requestIdleCallback`,
  `document.timeline` and `Math.random` (seeded from the treatment's `seed`) all read film time.
- The page is served from `http://lit.stage/` with no listening socket. Only files inside `stage/`,
  the kit and the fonts are served; `..` and symlinks that leave the directory are refused.
- Fonts: `/lit/fonts.css` declares the product's faces with `font-display: block`: `Archivo` (widths
  75 %, 100 %, 125 %; weights 400, 700, 900), `LitOpenCode Sans` (400, 700; Hangul), `VT323`,
  `Silkscreen` (400, 700), `MesloLGS NF` and `Galmuri9`. Use only these; the QA checks the platform
  font behind every copy line.

## Forbidden (the render stops)

| Stops with | What |
| --- | --- |
| 17 `STAGE_CONTRACT_ERROR` | `<video>`, `<audio>`, `<iframe>`, `<object>`, `<embed>`, `<frame>`; `new Audio()`, `AudioContext`, `OfflineAudioContext`; `Worker`, `SharedWorker`, service workers; no `LitStage.define`; a wrong size; a flipbook or animated raster; a copy line never found on screen |
| 18 `STAGE_NONDETERMINISTIC` | a frame that differs between two fresh replays: wall-clock reads such as `performance.timeOrigin`, `crypto.getRandomValues`, or state that depends on how fast frames arrive |
| 19 `STAGE_NETWORK_REQUEST` | any request outside the stage origin; an absolute `http(s)://` or `//host` URL in a stage file (W3C namespace URIs such as `http://www.w3.org/2000/svg` are fine); `preconnect`, `dns-prefetch`, `prefetch` or `prerender` links; `WebSocket`, `WebTransport`, `RTCPeerConnection` |

A page that asks for a WebGL context and gets none stops with exit 11.

## Kit reference (`/lit/stage-kit.js`, global `LitStage`)

Easing. Named curves plus `bezier()`:

```js
const e = LitStage.ease.snap(0.4);                  // also linear, in/out/inOut Quad..Quint, Sine, Expo, Circ, Back, glide, settle, exit, anticipate
const custom = LitStage.bezier(0.2, 0.9, 0.1, 1)(p);
```

Spring (closed form, exact at any `t`):

```js
const y = LitStage.spring({ stiffness: 180, damping: 14, from: 80, to: 0 })(t - 1.2);
```

Keyframes over numbers, arrays or colours:

```js
const x = LitStage.kf(t, [{ t: 0, v: -200 }, { t: 1.4, v: 0, ease: "settle" }, { t: 3, v: 40, ease: "glide" }]);
```

Timing windows, staggers and sequences:

```js
const p = LitStage.at(t, 2.0, 0.8, "snap");          // 0..1 inside [2.0, 2.8]
const delay = LitStage.stagger(i, { each: 0.06, from: "center", n: items.length });
const s = LitStage.seq([["enter", 0.6], ["hold", 2.4], ["leave", 0.5]], 4); s.hold.progress(t);
```

Seeded random (the treatment's `seed` by default):

```js
const r = LitStage.rand(); const jitter = r.range(-4, 4); const pick = r.pick(list);
```

Text splitting, grapheme- and 어절-aware:

```js
const parts = LitStage.splitText(el, { by: "grapheme" });  // or "word" (a Hangul 어절 stays whole) or "line"
```

SVG path drawing and a single-subpath morph (multi-subpath morphs are unsupported; morph each
subpath on its own):

```js
LitStage.drawPath(pathEl, LitStage.at(t, 0.5, 1.5, "glide"));
const shape = LitStage.morph(fromD, toD); pathEl.setAttribute("d", shape(p));
```

Masks, clips and colour:

```js
LitStage.clip.circle(el, p, { cx: 30, cy: 60 }); LitStage.clip.wipe(el, p, "left"); LitStage.clip.iris(el, p);
LitStage.mask.linear(el, p, { angle: 120, soft: 10 }); LitStage.mask.radial(el, p);
el.style.fill = LitStage.mix("#1b3a4b", "#e0a458", p);   // mixed in linear light
```

Text registration for the QA:

```js
LitStage.text(titleEl);                                   // one reading run
LitStage.text(signEl, { decor: true });                   // illustrative text inside a drawn subject
LitStage.text({ content: "…", x, y, w, h });              // canvas or WebGL text, every frame it is drawn
```

## How the QA reads the stage

- Every `copy.lines` entry must appear on screen at some beat; a missing line stops the render with
  exit 17 and quotes it. Keep copy in DOM or SVG text where you can; canvas copy is found through its
  registration, but its contrast is not measured (a WARN).
- Copy runs FAIL on contrast (3.0 for large type, 4.5 for body; large means at least 3 % of the
  frame's short side), on leaving the central 90 % title-safe area and on a hold shorter than the
  reading floor. Decor runs only WARN on contrast, are exempt from title-safe and the reading floor,
  may not carry a copy line, and may cover at most 25 % of the visible text area.
- A run equal to or containing the request, the idea, a file name or a word such as path, preset,
  gate, beat or treatment is a WARN the look must answer.
- Canvas text drawn without registration is not measured (a WARN the look must answer).
- The subject must be drawn: when every word is hidden, at least half of the beat midpoints still
  carry visible structure outside the text boxes.

## Determinism

- The renderer replays the clock from 0 in a fresh browser and compares 8-16 sample frames by the
  SHA-256 of their pixels. A mismatch stops with exit 18, naming the frame and the first region.
- Filters (`blur()`, `backdrop-filter`, `mix-blend-mode`, `box-shadow`, SVG `feGaussianBlur`, Canvas2D
  `shadowBlur`) and WebGL shaders are deterministic on the software renderer the stage uses.
- Seed every random choice from `LitStage.rand()` or `Math.random()` (both seeded); never read
  `crypto.getRandomValues` or `performance.timeOrigin`.

## Rendering

- Stills round: `node render.mjs stage --out <d> --stills-only --round 1` (about 20 s): the beat
  midpoints, a strip around every cut and a 12-frame contact sheet, no encode.
- Film: `node render.mjs stage --out <d> --round N`. Give the command a timeout of at least 600 s; a
  15 s 1080x1920 film with its checks takes a few minutes. Never shorten the film to save render time.
  Progress is written to `<d>/.run/progress.json`. When the host's command timeout is shorter, add
  `--detach`: the render continues in the background, and `<d>/.run/render-exit.json` holds its exit
  code when it ends (the log is `<d>/.run/render.log`).
- Outputs: `film.mp4` (H.264, BT.709, sound muxed), `preview.webp` or `.gif`, `poster.png`,
  `reduced-motion.png` (the final beat's midpoint), `manifest.json`, `gate-report.txt`, `stills/`,
  `sheet/` and `sound-cues.json`.

## Sound on the stage

The default is the generated bed (`sound.mode: generated`). To score the film yourself, write a WAV
into `stage/` and set `sound: { mode: "authored", file: "stage/<name>.wav", plan }`. The page itself
never plays audio: audio elements and audio contexts are forbidden, and the renderer muxes the track.
