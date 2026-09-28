# Style bibles

A style bible is the one page you write before any scene exists. It fixes the palette, the three
type voices, the motion vocabulary, the pass stack, the layout grid, what to avoid and what must be
original. The engine reads the preset data in `engine/constants.mjs`; this page is the reasoning a
scene author applies on top of it. Every preset below is expressed in this product's own words.

## Template (fill one per film)

| Field | What to write | Why it matters |
| --- | --- | --- |
| Idea | One sentence: the film's single visual metaphor for this brief | Stops a film becoming a slideshow of effects |
| Preset | `swiss-signal`, `terminalcore` or `tidal`, and the reason (keyword hit or user choice) | The report states the pick and why (MO-B-00) |
| Palette | The preset's named colours; which one is the signal, which the rare accent | One signal hue plus at most one accent cluster (MO-C-29) |
| Voices | Display, machine and body voice, with the fonts each script resolves to | Hangul always uses the lit-pptx pair; Latin display may step width |
| Motion | The named tokens used (slam, hold, snap-cut, drift, surge-punch, type-in) | No ad hoc curves; the engine only knows named tokens (MO-A-08) |
| Passes | The pass order from the preset | GLSL coverage on every frame is a gate rule (MO-C-01) |
| Grid | Columns, gutter, margin, baseline | Everything glyph-shaped stays inside title-safe (96 px / 54 px) |
| Anti-slop | Three things this film will not do | Reviewed at the Look step |
| Originality | Where this film's shapes and copy come from | Nothing is reused from another film |

## Auto-pick (MO-B-00)

Whole-word match over the brief's own text, first row wins, and an explicit style always wins.
Latin words match at word boundaries; Korean words match at the start of a token, never inside a
longer word.

| Brief mentions | Preset |
| --- | --- |
| 터미널, CRT, 해커, terminal, hacker | `terminalcore` |
| 물결, 파도, 잔잔한, 흐름, gradient, wave, tide, calm | `tidal` |
| anything else | `swiss-signal` |

`system`, `status`, 시스템 and a bare `flow` are deliberately not keywords: they appear in briefs
about payment systems, design systems and workflows that want nothing terminal-like.

## `swiss-signal` (default)

- Palette: ink `#0C0E13` background, bone `#E9EBE4` type, teal signal `#0F7A82`, amber accent
  `#D9A441` for exactly one moment, graphite `#4B5058` for hairlines.
- Contrast facts: bone on ink is about 16:1. Teal on ink is about 3.8:1, so teal is a rule, a bar or
  large type (32 px and up, or 25 px bold) only, never body copy.
- Voices: Archivo display (static width x weight instances; width steps are Latin-only), MesloLGS NF
  for small machine annotations, the lit-pptx LitOpenCode Sans pair for Hangul running text.
- Motion: `slam` (180 ms on the proven deceleration curve) lands a title on a downbeat, `hold`
  keeps it still, `snap-cut` changes scene with no easing. Nothing bounces.
- Passes: `swiss-grid` hairline rules, then a low-strength Bayer `dither` as a print texture, then
  the engine's post chain (grain, halation, vignette).
- Grid: 12 columns, 24 px gutter, 96 px margin, 8 px baseline; asymmetric placement, generous
  negative space, small annotations beside large type rather than under it.
- Avoid: every word fading in at centre, one ease for everything, glitch with no reason, any
  multi-hue gradient, bloom on anything but the signal, a hold so long it reads as a stall.

## `terminalcore`

- Palette: navy `#05070A` background, panel `#0C1116` window fill, phosphor green `#39FF6A` as the
  one signal (the blue `#2FB6FF` alternate is never mixed in the same film), dim grey `#7C8B93`.
- Voices: Galmuri9 for Korean pixel display (the outline build; the bitmap-strike build renders
  blank), VT323 for Latin pixel display, Silkscreen for chrome labels, MesloLGS NF for readouts.
  Galmuri and VT323 never share one readout line.
- Motion: `type-in` at the terminal's character rate (a Hangul 어절 appears whole), `boot-flicker`
  bursts bounded by the CRT flicker cap, `hard-cut` on beats.
- Passes: `terminal-ui` (window chrome, meters, caret on one Canvas2D layer), then `crt`
  (scanlines, curvature, persistence, capped flicker), then `dither`, then rare `glitch` hits.
  Glitch hits and boot bursts share the two-events-per-second ceiling per shot (MO-SH-03).
- Grid: 1.5 px window chrome on a flat grid; text aligned to the character cell.
- Avoid: falling code rain, neon purple haze, glitch as constant texture, both signal hues at once,
  pixel type set below its grid floor (Galmuri9 at multiples of 9 px, at least 45 px).

## `tidal`

- Palette: indigo `#0E1420` background, off-white `#E8ECEF` type, deep teal `#124559` and violet
  `#4C3B6E` gradient stops, coral `#E07856` for one punctuation moment.
- Contrast facts: off-white clears 8:1 on every stop, so type sits directly on the flow.
- Voices: Archivo display used calmly (little width or weight motion), LitOpenCode Sans for Hangul,
  MesloLGS NF for small timestamps.
- Motion: `drift` (a slow in-out curve over seconds, matched to the flow speed) and a short
  `surge-punch` tied to a gradient surge. No hold-then-snap rhythm as the default.
- Passes: `tidal-gradient` (domain-warped noise flow, seeded per shot), then `swiss-grid` for
  layout discipline, then at most one rare `glitch` hit per shot.
- Avoid: a rainbow ramp, bloom on the gradient itself, glitch as texture, a flow so fast that held
  type smears under motion blur.

## Originality rules for every preset

Invent this brief's own visual idea for each shot. Never reuse another film's palette values, scene
concepts, motifs, lyric text or plate imagery. The palette pattern (one signal, one rare accent)
transfers; specific colours from elsewhere do not.
