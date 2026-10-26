# Cover mode: README cover loops

Load this when the request is a README cover, a hero or banner loop, an animated project cover, or
any short image that plays forever at the top of a page. A cover is not a film. A film has beats,
an arc, an ending, copy and sound; a cover has none of them. It is one picture that never stops
moving and never shows where it starts, read at thumbnail size by people who scroll past it.

This matters because the film pipeline rewards the wrong things for a cover. Beats of at least
1.2 s, a new composition per beat, stills taken at beat midpoints, a settled end card and a reading
floor all pull the result toward a slide deck that happens to loop. Cover mode swaps them for a
loop contract, a look round that watches motion instead of compositions, and a gate that measures
the encoded file a reader's browser will decode, not the frames that went into the encoder. Film
mode (the stage and type paths) is unchanged and takes every other request.

## What changes from a film

| Film rule | Cover mode |
| --- | --- |
| Beats of at least 1.2 s, each showing something new | No beats. Layers and one system, each running over the whole loop |
| A settled end card; holds are fine | No ending. Any hold longer than 0.5 s is a defect (G3) |
| At least 10 s; never shorten to pass | 6–12 s; 8 s worked for every recipe |
| 16:9 or 9:16 | 2:1 (page 1200×600, cover 1000×500) or 3:2 (page 1200×800, cover 960×640) |
| A generated sound bed and the sound checks | Silent: `sound` is absent or `none` |
| Invented subject, invented copy lines | The brand word, plus at most one motto the user wrote or the project already uses |
| Title fade-in; a stage that fades in from black | Frame 0 is the poster and already the whole picture |
| Nine questions about purpose and beats (eleven on the stage path) | Nine questions about motion, the seam, damage and the hero |
| `film.mp4` plus a preview | `cover.webp` (or `cover.gif`); never an MP4, README renderers do not autoplay video |

## Files

- `<out>/treatment.json`: the cover treatment (below).
- `<out>/cover/index.html`: the page, with its own files beside it (`cover/assets/` for rasters).
  The renderer serves only that folder, the loop kit at `/lit/loop-kit.js` and the faces at
  `/lit/fonts.css`. The stage path's static scan applies unchanged: no network, no `<video>`,
  `<audio>` or `<iframe>`, no workers, no WebSocket, at most 24 rasters and 8 MB, no animated
  raster, no flipbook of same-size frames.
- `<out>/assets.json`: every raster the page can load (below).

Start from a recipe: copy `recipes/<name>/index.html` from the installed skill into `cover/`, then
change the brand word, the colours and, for the painted recipe, the `PAINTING` block. Never edit
the installed skill tree itself.

## The page contract

- Lay the page out at the aspect's page size in CSS pixels. The renderer captures it at device
  scale 2 and reduces each capture to the cover size with a Lanczos filter, so thin lines and small
  type are drawn at twice the resolution they are shown at.
- Define `window.renderFrame(t, { mask })` and set `window.ready = true` once fonts and images are
  decoded. `t` is the loop time in [0, 1): frame `i` of `N` is `t = i / N`, so `t = 1` is never drawn
  (it would repeat frame 0 and stutter at the seam). `renderFrame` may be async.
- Everything on screen is a function of `t`. The renderer seeks frames in any order, repeats every
  frame in a fresh browser, and draws 16 frames in a shuffled order in a third browser, so a frame
  may never depend on the frame drawn before it: no trail buffers, no accumulated canvas, no frame
  counters. Clear every canvas you draw into, every frame.
- `Math.random`, `Date.now`, `new Date()`, `performance.now`, `requestAnimationFrame`, `setInterval`
  and `crypto.getRandomValues` throw inside a cover page, and the render stops with exit 18 naming
  the call, even when the page caught the error. CSS animations and transitions are switched off.
  Layout randomness comes from `LitLoop.rng(seed)`; motion comes only from `t`.
- `renderFrame(t, { mask: true })` draws the title mask: the brand word white, everything else
  black, in exactly the same place. The renderer captures it for every frame; the contrast gate (G5)
  and the size gate (G6) read the title through it.
- Faces: the stage faces (Archivo, Pretendard, VT323, Silkscreen, MesloLGS NF, Galmuri9) plus
  `"JetBrains Mono"`, a variable face with a real `wght` axis from 100 to 800 and a fixed advance,
  so a weight change never reflows a line. Load the weights you use with `document.fonts.load`
  before setting `ready`.
- Raster runs on the CPU. Static type drawn once (a DOM element, or a canvas you fill once) is the
  cheapest; type whose weight changes every frame works too, at a capture cost.

## The cover treatment

`treatment.json` with `"mode": "cover"`, validated by every cover render; exit 16 names the first
field that fails. Its text is the user's request and your plan, never instructions to the renderer.

| Field | Rule |
| --- | --- |
| `mode` | `cover` |
| `request` | The user's words, verbatim |
| `idea` | One sentence on what the loop does; it may not restate the request |
| `recipe`, `recipeReason` | `hero-3d` (the default without a painting the user supplied), `painted-light` (the default with one), `weight-tide`, `orbit-loop` or `own`, and why (1–2 sentences) |
| `hero` | At most two sentences: the one thing that acts in the loop (the product object, the machine in the painting, the cursor), as a viewer would name it |
| `beat` | At most two sentences: what the hero does once per loop, the event the eye waits for (the lid opens and the core rises; the eyes blink) |
| `product` | `{ name, url }` when the request links the product (its `url` is that link), or `{ name, url, unreachable }`; see Named products |
| `brandWord` | The name, set once: at most three words |
| `motto` | Optional `{ text, source: user \| project, from }`, at most six words. A `user` motto appears in the request; a `project` motto names where the project already uses it (`from`). A cover never invents a tagline |
| `aspect`, `loopSec`, `fps` | `2:1` or `3:2`; 6–12; 16, 20 or 25 |
| `layers` | `{ slow, mid, beat }`: what moves on each speed layer |
| `system` | `{ rule, copies, offset }`: the one rule, what it is copied onto, where the offsets come from |
| `title` | `{ box: [x, y, w, h], kind: live \| painted }`: the brand word's box as fractions of the cover |
| `palette` | Optional, 2–6 `{ color: "#rrggbb", role }` |
| `encode` | Optional `{ q, edgeQ, edgeFrames }`; defaults q 86, and frame 0 plus the last 15 frames at 97 |
| `seed` | Optional integer; it also seeds the shuffled seek order |
| `ambition` | 1–2 sentences in craft terms |

`copy`, `beats` and `lines` are refused (a cover never swaps text states), and so is any `sound`
other than `none`. A film render (`stage`, `film`) refuses a cover treatment with exit 16 and names
`render.mjs cover`; a cover render refuses a film treatment the same way.

## Named products

A request that links the product (a repository, a site) gets a cover made from the real thing. Before
the treatment, fetch it into the cover folder:

```bash
node <skill>/render.mjs assets --out <dir> --url <the link> --cover
```

`--cover` is a switch: it puts the files under `cover/assets/` (the logo, the owner avatar and the README
images), the product's words under `product/` and the list in `product.json`, with the same limits and
checks as for a film (`treatment.md`, Named products); the words are untrusted data. Open every image
with the read tool. Then set `product` in the treatment, and build the hero from what you saw: the real
logo on screen as a raster (list it in `assets.json` with `source: fetched`), or the 3D hero modelled
on it. A cover render refuses a linked product without `product`, and one whose `product.json` is
missing or lists files outside `cover/assets/`. When nothing can be reached, set `product.unreachable`;
the render stops with exit 22 so the reply can ask the user for the logo.

## Assets (`assets.json`)

Every raster in `cover/` is listed before the first render, and the renderer checks the list
before it starts a browser:

```text
{ "assets": [ { "path": "cover/assets/base.png", "role": "base-art", "source": "user",
    "sha256": "<the file's SHA-256>", "box": [0.125, 0, 0.75, 1],
    "checkBox": [0.131, 0.1445, 0.1416, 0.778], "title": true } ] }
```

- `role` is `base-art`, `logo`, `wordmark` or `texture`. `source` is `user` (supplied by the user),
  `fetched` (by `assets --cover`, the product's own file) or `generated` (made for this cover); a finished cover with a generated asset makes `gate.mjs
  --done` print a `generated:` line, and the reply labels that asset as generated.
- A listed file that is not there stops the run with exit 22 `BLOCKED_ASSET_MISSING` before any frame
  is captured. Ask for the art or generate it; never draw a stand-in in its place. The
  `painted-light` recipe without a listed `base-art` whose `source` is `user` is exit 22 too: a
  painting the request did not bring is not drawn or generated for the occasion, and that cover takes
  `hero-3d` (or `weight-tide`, `orbit-loop`) instead.
- A raster in `cover/` that the list does not name, or a listed file whose SHA-256 changed since it
  was listed, is exit 17; a malformed entry is exit 16. Base art is a PNG.
- `box` is where the base art sits on the cover, as fractions. Scale the art into it; never crop it.
  After the render, decoded frame 0 must show the art: the SSIM of `checkBox` (by default the whole
  box) against the same region of the source scaled into the box is at least 0.90 (the `ART` line).
  A page that relights a painting dims most of it at frame 0 on purpose, so point `checkBox` at the
  part it leaves lit; it must cover at least 10 % of the box. On the repository painting the
  painted recipe measured 0.96 on the lit hero panel.
- `title: true` on the base art declares that the brand word is painted into it. Only then is a
  `painted` title exempt from the glyph-height floor (G6); it is still measured and shown as INFO.

## Craft rules, ranked

1. **The encoder is part of the design.** Lossy animated WebP treats a pixel as unchanged when it
   moves less than about `31(1 - sqrt(q/100)) + sqrt(q/100)` levels from the previous frame: about
   6 levels at q72 and 3 at q90. Slow fades and slow breathing below that are dropped, go stale, and
   snap back at the next keyframe, which by default is the loop point. Every failure of this kind is
   invisible in the PNG frames and visible in the decoded file; that is why the gate decodes.
2. **Light is a moving edge, not an in-place fade.** A travelling window of light with a 24–40 px
   edge survives the encoder; a 150 px soft edge does not at q72 (on the same frames the moving share
   fell from 0.92 to 0.83 and the seam jumped to 24 times its neighbours). At a high edge quality the
   soft edge survives and reads as a wash instead: no motion gate sees that, so the look review has to.
3. **Something translates.** A weight tide alone lost most of its motion in the encoder (median
   step 0.0007, seam 14×); one word of row drift per loop kept all of it (0.0098, seam 1.1×).
4. **One rule, many copies, offsets from position.** One swell over hundreds of letters, one orbit
   law on three rings, one light window over the panels. Offsets come from x, y, angle or a
   loop-noise field, and the wave appears by itself. No timeline, no scenes.
5. **Three speed layers.** A slow perpetual linear layer (drift, laps, rising motes), a mid swell
   (the tide, the light window, the orbits), and beat events (a cursor step with `outBack`, a gate
   flash, a blink, a flare). Every cover that reached TARGET had all three.
6. **The brand word is set once and never leaves.** It is the material (its weight moves, its
   place does not), or it stands still beside the system, or it is painted into the base art.
   Motion happens in, around or behind it.
7. **Frame 0 is the poster.** Reduced-motion readers, thumbnails and slow networks show it alone, so
   it is the whole picture: no fade from black, no empty opening.
8. **Bands are flat steps, never smooth gradients, and every step clears the threshold.** A 3 px
   leading line with a two-step afterglow (0.10, 0.05) passed; a third 0.03 step drifted and pushed
   the seam from 1.71 to 2.48. A single flat slab encodes well but reads as a box.
9. **Exponential tails are slow fades.** `expImpulse` decays below the threshold for half the loop.
   Use the symmetric `cubicPulse` for beat events, and put one across `t = 0` so the keyframe reset
   lands under motion.
10. **Small movers over texture are expensive.** Each mote over a painting makes the encoder re-send
    the textured blocks around it; keep motes few and mostly on the plain wings.
11. **Lift a painted title instead of laying live text over it.** A luminance-keyed gain (only
    pixels above the plate's level) raises dark painted letters to 4.5:1 and leaves the plate dark;
    thresholding the same letters gives the mask. Live text set at a painting's scale came out
    about 11 px tall at README width, readable by contrast and too small to be a title (G6).
12. **Spend quality at the seam, not on keyframes.** Once every edge is sharp, what remains at the
    loop point is requantisation: keyframe 0 and the frames before it carry different error. Raise
    `edgeQ` for frame 0 and the last `edgeFrames` and keep the default keyframes; periodic keyframes
    spread the snap into visible pops, and a small keyframe interval made a 2.5–5 Hz shimmer.
13. **16 fps for slow painted covers, 20 for a 3D hero, 25 for a system with fast dots.** 20 fps cost
    18 % more and dropped the median step below 0.0015 on the painted cover. At 16 fps each frame
    lasts 63 ms, so an 8 s loop is 8.064 s; that is fine. The gate measures on a 50 ms grid, and a
    smooth 3D turn at 25 fps lands one grid step on two frames at the seam (FLOOR only, while the raw
    frames were smooth); at 20 fps every grid step is one frame.
14. **A lit 3D object needs a clean shadow and a high `q`.** Shadow acne on a turning object flickers
    and reads as flashes on the sheet: set the key light's `shadow.bias` (about -0.0004) and
    `shadow.normalBias` (about 0.03). Smooth light surfaces blotch in lossy WebP at q86; the 3D hero
    recipe encodes at q94 (edge 97 over 15 frames).

## Recipes

Each recipe ships as a worked page and the gate row it reached, in `recipes/<name>/`. The pages are
examples; the rules above are what transfers.

- **`hero-3d` (the default without a supplied painting): one product object in a small studio.**
  Drawn with the pinned three.js on the GPU rung (`depth.md`). Slow: the object turns exactly once
  per loop. Mid: the camera breathes twice. Beat: once per loop the lid opens (0.28-0.44 of the
  loop), a lit core rises and settles back, a ring runs out across the floor, and the lid closes
  (0.62-0.78), so every value is back at its start by `t = 1`. The brand word sits still on the left
  in a 2D canvas over the GL canvas; the mask pass hides the GL canvas. `AIM` is the pixel the
  object's origin lands on (`setViewOffset`), so the word keeps its side of the frame. Replace the
  `HERO` group with the project's own object (its real logo as a texture or an extruded shape is the
  usual start), keep the turn slow and the open eased, and keep 20 fps and q94: the gate measures on a
  50 ms grid, a smooth turn at 25 fps lands one grid step on two frames at the seam, and smooth light
  surfaces blotch in lossy WebP at q86. Set the key light's `shadow.bias` (about -0.0004) and
  `shadow.normalBias` (about 0.03), or a turning object's shadow flickers into flashes. If the GPU is
  unavailable it renders on the software rung, slower, and the report says so.
- **`painted-light` (the default when the user supplies a painting): a painting relit by travelling
  light.** A finished painting the user supplied is the whole picture, and the page only relights it,
  on one canvas. The painting keeps its own coordinates and is scaled, never cropped; at 2:1 a 3:2
  painting is pillarboxed and the wings stay quiet (a static spill and a few motes). Macro: a
  window of light with a 24 px edge walks the dimmed panels once per loop. Mid: a scan band per
  panel at two passes per loop, offset by the panel's position; one fast skewed glint across the
  title in **overlay** blend (screen brightens a visible box; colour-dodge turned a coloured letter
  into a red block); a comet lapping the hero panel's border. Beat: the eyes breathe twice with one
  blink, the core once, the motto's accent word flares at `t = 0` and `t = 0.5`. Measure your own
  painting's panels, glows, title box and accent into `PAINTING`. A denser, brighter painting needs
  a deeper dim and a lower `q`: the repository painting reached TARGET at dim 0.68, q 83, edge
  quality 97 over 18 frames (2.06 MB).

  **Choosing the hero.** Any panel can be the hero, so a cover can feature its own machine on a
  shared line-up. Three things move together:
  1. `PAINTING.hero` is the panel index (0 is the leftmost panel). The dim pool is clipped around
     that panel, so a hero in the middle stays at source brightness while the light window still
     walks every other panel as one continuous light. The comet laps the hero's border and its scan
     band stays at full strength.
  2. `PAINTING.glows` maps a panel index to the anchors measured on that machine
     (`{ x, y, rx, ry, beat }` in painting pixels; `beat` is `"eye"`, which breathes twice and
     blinks, or `"core"`, which breathes once). Only the hero's entry glows. A hero with no entry
     stops the page with `PAINTING.glows has no entry for the hero panel N` (the render ends as
     `STAGE_CONTRACT_ERROR` the moment the page reports it, without the 60 s ready wait), because borrowing another machine's
     coordinates draws its eyes on the wrong body. Measure the anchors, or write `[]` for that
     panel to run with no beat glows and say so in the treatment's beat layer.
  3. The base art's `checkBox` in `assets.json` points at the hero panel. With the shipped layout
     (painting scaled by `S = 600 / 1024` and pillarboxed 150 px from the left of a 1200 x 600
     page) a panel `[x0, x1]` with `panelTop` and `panelBottom` is
     `[(150 + x0·S) / 1200, panelTop·S / 600, (x1 - x0)·S / 1200, (panelBottom - panelTop)·S / 600]`.
     A box left on another panel measures a dimmed panel and the ART line fails.

  The accent flare and the title glint belong to the painted motto and title, not to the hero, and
  stay where they are.
- **`weight-tide`: type as material.** Rows of the brand word in JetBrains Mono at about 1.3:1 to
  the background drift one word length per loop, alternate rows opposite ways. Weight is
  `gain(swell(fract(t - offset)), 2.4)` with `offset = 0.85·x/W + 0.35·y/H` from each letter's
  place on screen. The hero word on a knockout band takes the same field over 330–800 so it never
  thins. One accent: a cursor that dwells under each letter, steps on with `outBack`, and carries
  back home inside the last slot, so the seam does not jump.
- **`orbit-loop`: a system beside a still word.** Three rings turn whole numbers of laps per loop
  (3, 2, 1) in alternating directions, each carrying a dot with a trail. A gate at twelve o'clock
  flashes on every crossing and swells the dot; the crossing times are solved from the orbit law,
  and each lights one cell of a ledger under the word, as many cells as crossings so the ledger
  loops. The cells fall back in four flat steps, not a fade. The core breathes once per loop and
  rings on four bars. The word stands still on the left.
- **`own`.** Any system that keeps the rules: one rule many copies, three layers, a still word,
  edges instead of fades. Say what it is in `recipeReason`.

## Loop kit (`/lit/loop-kit.js`, global `LitLoop`)

`rng(seed)` (mulberry32, for layout only); `makeNoise(seed)` and `loopNoise(noise, t, offset, radius)`
(value noise walked once round a circle, so it closes at `t = 1`); `ease.smooth`, `ease.outCubic`,
`ease.inCubic`, `ease.outExpo`, `ease.outBack(p, s)`, `ease.gain(p, k)`; `cubicPulse(c, w, x)` and
`expImpulse(x, k)`; `phase(t, offset, cycles)`; `cdist(p, c)` (distance around the loop, for an event
that straddles `t = 0`); `window(p, start, dur)` (a one-shot inside the loop: 0..1 while it runs, -1
otherwise); `steps(p, stops, travel, shape)` (dwell and move); `swell(p)` (0 → 1 → 0, resting at both
ends); `TAU`, `clamp`, `fract`, `mix`. Every helper is periodic in `t` or pure.

## Encode

`img2webp`, lossy, loop forever, method 4, every frame shown `round(1000 / fps)` ms, frame 0 and the
last `edgeFrames` frames at `edgeQ`, default keyframes. When img2webp or `dwebp` (the gate's decoder,
from the same libwebp) is missing, `gifski` at quality 90 is the fallback, decoded with ffmpeg.
Neither present is exit 21 `BLOCKED_NO_COVER_ENCODER`, checked before any capture; `litopencode
doctor` shows which one this machine has on its `motion cover encoder` line.

## The gate, on the decoded file

The gate decodes the encoded cover frame by frame (the WebP container is read for each frame's
rectangle, duration, blend and dispose; `dwebp` decodes each frame; the frames are composited as a
browser does) and measures on a fixed grid of `max(50 ms, shortest decoded frame)`, because the
encoder merges identical frames into long ones and a per-frame count would flatter a slide film.
`d` is the mean luma change per grid step at about 300 px wide, as a share of 255; the loop is a
ring, so the seam is one more step.

| Gate | Metric | FLOOR (fails the cover) | TARGET (every cover render needs it) |
| --- | --- | --- | --- |
| G0 determinism | SHA-256 of each frame's pixels, two captures in fresh browsers | 100 % identical | same |
| G1 budget | bytes, length, loop count | ≤ 3 MiB, 6–12 s, loops forever | ≤ 2 MiB |
| G2 motion energy | median d; share of moving steps | ≥ 0.0004; ≥ 0.45 | ≥ 0.0015; ≥ 0.95 |
| G3 anti-slide | longest still run; largest step ÷ median | ≤ 2.0 s | ≤ 0.5 s and ≤ 6 |
| G4 seam | seam ÷ mean of the two steps on each side | ≤ 8 | 0.25–2.0 |
| G5 title contrast | median title pixel against the 90th-percentile background in the box, every frame, through the mask | ≥ 4.5:1 | same |
| G6 title size | cap height of the title glyphs in the mask, at a README width of 830 px | ≥ 24 px | same; a title painted into declared base art is INFO |
| SEEK | 16 frames in a seeded shuffled order in a fresh browser, against the master | identical, or within one level per channel | same |
| ART | SSIM of the base art's check box in decoded frame 0 against the source | ≥ 0.90 | same |
| FLASH | WCAG 2.3.1 flashes per second over the loop (the film gate's detector) | ≤ 3 general, ≤ 3 red | same; a failure withholds the cover |

FLOOR was set so that eight earlier painted covers pass and four slide-like negatives fail; TARGET
is what cover mode delivers, and those earlier covers miss it on purpose (a 1.9 s hold, a flash at
the seam). Every cover render runs the gate with `--strict` and exits 13 until every gate reaches
TARGET, 2 MiB included. G2 and G3 are area-weighted: a small comet on a still picture counts as
still at thumbnail size, which is intended. Never raise a number, shorten the loop or drop a layer
to pass; fix the cause.

G6 splits the mask's white pixels in the title box into connected glyphs, leaves out dots and
accents (under 1 % of the largest glyph's area or 30 % of the tallest glyph), and takes the median
height of the rest in twelve mask frames; the smallest, scaled from the cover width to 830 px, is
the cap height. Contrast alone passed an 11 px name plate; G6 does not.

The seek check catches a page that keeps state between frames (a trail drawn by never clearing a
canvas): the master and the replay agree with each other because both draw in order, and a frame
sought out of order does not. Exit 18 names the frame and its time. An element whose opacity and
transform change together can rasterize one level apart depending on which frames were painted
before it, so a sought frame within one level per channel passes and is counted as `oneLevel`;
kept state differs by far more.

`node <skill>/gate.mjs --cover <cover.webp|cover.gif|frames-dir> [--frames d --replay d --masks d
--title x,y,w,h --display-width N] [--strict] [--json]` runs the same G0–G6 on any cover file;
`node <skill>/gate.mjs <out>` re-gates a cover output directory with the capture folders its last
render kept under `.run/cover/`. SEEK, ART and FLASH come from the render itself.

## Look rounds

Every cover render writes its stills from the DECODED file:

- `stills/sheet.png`: twelve frames at `t = k/12` above a plot of every grid step's `d` over the whole
  loop, with the still threshold (red dashes), the median (green dots) and a white tick under each
  tile's place in the loop. A hold is a flat run on the dashes; encoder pops are regular spikes; a
  reset is a spike at the right end.
- `stills/poster.png` (decoded frame 0) and `stills/seam.png` (the last frame beside frame 0);
- `stills/frame-00.png` … `frame-11.png`: the sheet's frames at full size, for a closer look;
- `stills/stills.json`: the round, each file's SHA-256 and the gate verdict.

Open them with OpenCode's read tool. LitOpenCode records each read of a cover's stills in
`.run/image-reads.jsonl`, and the done check counts a frame as viewed only when the read tool opened
that exact file. OCR and pixel statistics may go in `aids`; they never count as looking. The gate
cannot see damage: the pilot's two worst defects (a colour-dodge glint that turned a letter into a
red block, a wing glow that read as a dark disc) were found only by eye on the sheet.

Answer all nine every round, each naming a file of the stills set and, in `observed`, a sentence
about what you saw there:

1. Is something moving in every half-second window (the plot never lies flat on the red dashes)?
2. Does the seam disappear in the decoded file (`seam.png`, the right end of the plot)?
3. Does it still move after encoding, with no region that freezes and then pops?
4. Is the brand word present, legible and in place in every frame, never faded or swapped?
5. Are all three speed layers visible: a slow perpetual layer, a mid swell, beat events?
6. Does anything read as a slide, a card swap, a title fade or an end card, or does light wash in
   place instead of travelling as an edge?
7. Is any glyph, glint or glow damaged: a colour block, a dark disc, a visible box?
8. Would a skilled motion designer add or remove something? Name it.
9. Does the hero act its beat once per loop: one clear action at the beat's time, not a wobble? Answer from the sheet's tiles around the beat time.

A `no` on 1–5 or 9, or a `yes` on 6, 7 or 8, asks for another round. Record the round with
`render.mjs look --out <dir> --round N --answers <file>`; the answers file has the film's shape
(`viewed`, `answers` with `q`, `verdict`, `frame`, `observed`, optional `aids`) without `weakestBeat`
or `by`, and round 1 names the `change` you will make before round 2.

## Defects and window renders

What the eye finds goes into the round as `defects`, at most three, worst first:

```text
"defects": [ { "t": 1.2, "region": [340, 10, 330, 50], "frame": "stills/frame-02.png",
  "observed": "what is visible there", "cause": "why it happens", "fix": "the change" } ]
```

`t` is the loop time in seconds where the defect shows, `region` the `[x, y, w, h]` it covers in cover
pixels, `frame` a file of the current stills set that shows it. `look` refuses a defect without a time,
a time outside the loop, a region off the cover, or a frame outside the current stills set.

Check each fix locally before the next full render: `render.mjs cover --out <dir> --round N --window
<t0>,<t1>` captures only the frames from `t0 - 0.5 s` to `t1 + 0.5 s` (wrapping at the seam), before
encoding, and writes `windows/round-N/<t0>-<t1>/sheet.png` (the span shaded on its plot), the frames
and `window.json`. It writes nothing to `stills/`, the report or the manifest, and never counts as
done: the full render and its gate decide.

## Rounds and done

Rounds share one counter with the renders, 1 to 3. Each round is a full cover render followed by a
look; a cover has no stills-only round. `node <skill>/gate.mjs --done <dir>` reads a cover directory
on its own terms and reports DONE (0) when all of these hold:

- the cover treatment is valid, and neither it nor anything in `cover/` changed after the last render;
- the last render's `gate-report.txt` reads `COVER gate --strict: PASS+TARGET` and nothing is withheld;
- at least two look rounds are recorded, the first naming its change;
- the last round was taken on the final render's stills, viewed `stills/sheet.png`,
  `stills/poster.png` and `stills/seam.png`, and opened each viewed file with the read tool;
- the last round asks for no other round.

After round 3, a TARGET miss or an open question is reported as `DONE_WITH_OPEN_ITEMS` (2) and the
reply says each one plainly. With no vision tool, record `{ "blocked": "no-vision-tool" }` and the
status is `DONE_UNVIEWED` (3). A `generated:` line asks the reply to label that asset as generated.

## Recipe rows and negatives

Each recipe keeps the decoded gate row it reached in `recipes/<name>/expected.json` (median d, moving
share, longest still, spike, seamLocal, bytes), with the settings and the treatment it was rendered
from. In a LitOpenCode checkout, `node tools/qa-cover-recipes.mjs` renders every recipe through this
renderer and fails when median d or the moving share move more than 15 % from the row, seamLocal
leaves TARGET, the file passes 2 MiB or the render exits non-zero.

Every negative and regression declares the gates it must fail (`mustFail`, as `G2.floor` or
`G1.target`). `--negatives` renders them all, and one counts as caught only when its render
completed and gated the decoded file, every declared gate failed, and no undeclared FLOOR gate among
G1-G4 failed. A crash, a missing declaration or a failure on another gate fails the QA with the reason.

`recipes/negatives/` holds four slide-like pages that must keep failing their declared FLOOR gates on
the decoded file: a title slam with line-by-line text and an end card (G2, G3), text cards that fade
in, hold and fade out (G2), a still picture with a faint breathing glow (G2, G3), and a progress
sweep that resets at the seam (G4). They are never recipes: read them to see what cover mode exists
to prevent, and never tune a threshold so one of them passes.

The painted recipe declares one regression, `feather-150` (`--feather 150` runs it alone): the light
edge widened from 24 to 150 px. The defect it stands for is light drawn as a soft wash instead of a
travelling edge, but at this recipe's encode (q 83, edge q 97 for 18 frames) the encoder keeps the
soft edge, so median d, the moving share and the seam stay inside TARGET. What it reliably trips is
the size TARGET (G1: 2.59 MB against 2.06 MB), so `G1.target` is all it declares; seamLocal is not
declared because it sits inside run-to-run noise around the TARGET. A decoded-file edge-share measure
was tried and dropped: it measures every soft change in the frame, not the travelling edge, and any
threshold would be fitted to one painting. The soft wash is caught by look review on the sheet
(question 6 under Review). At q 72 in the pilot the same change failed the other way, with the fade
dropped and the seam 24 times its neighbours.

## Commands

```bash
node <skill>/render.mjs cover --out <dir> --round N [--detach]
node <skill>/render.mjs cover --out <dir> --round N --window <t0>,<t1>
node <skill>/render.mjs look --out <dir> --round N --answers <file>
node <skill>/gate.mjs --cover <dir>/cover.webp --strict
node <skill>/gate.mjs --done <dir>
```

`<skill>` is the installed skill root the route context names. A cover render takes one to three
minutes on the software rung (three browsers, two captures per frame at 2x): give the command a
timeout of at least 600 s, or add `--detach` and wait for the exit file it names under `.run/`. It
writes `cover.webp` (or `cover.gif`), `poster.png`, `stills/`, `manifest.json` and `gate-report.txt`;
the previous round's files move to `.run/previous-round/`.

| Exit | Meaning |
| --- | --- |
| 0 | Every gate at TARGET on the decoded file |
| 13 | A gate failed or missed TARGET; the report and the last line name them |
| 10, 14, 15 | Chrome missing, runtime not pre-warmed, font missing (as on the film paths) |
| 16 | The treatment or an `assets.json` entry; the message names the field |
| 17 | The page contract, an unlisted or changed raster, or the static scan |
| 18 | A clock or entropy call, a frame that differs in a fresh browser, or one that differs when sought out of order |
| 19 | A network request |
| 21 | `BLOCKED_NO_COVER_ENCODER`: no img2webp with dwebp, and no gifski with ffmpeg |
| 22 | `BLOCKED_ASSET_MISSING`: a listed asset is not there, the painted recipe lists no user-supplied base art, or a linked product could not be fetched |

## Unconfirmed

- Whether the single keyframe reset at the loop point is visible to a person on a real README; the
  numbers say smooth, nobody has watched it there yet.
- How a cover reads inside GitHub's README column at full width; review so far used local frames.
- The encoder threshold formula is libwebp's animation encoder as remembered; measured behaviour
  matches it (q72 drops slow fades, q86–90 drops fewer).
- The thresholds come from 8 positives and 4 negatives in one family's style; re-check them on covers
  made for other projects.
