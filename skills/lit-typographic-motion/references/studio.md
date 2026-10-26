# Studio: house styles, register, shots, the board and the house file

Read this for every stage film, after `treatment.md`. It is what makes two films from one studio look
alike, what makes a film full by default, and what lets the user see the film before the full render.
Covers keep their own recipes (`cover.md`); the type path takes the style choice and the board only.

One principle runs through every part: a decision the model used to make again on each run is now data
the page is built from, or a check the renderer runs. Prose that only asks for consistency does not
produce it.

## The flow

1. **Look question.** Before `treatment.json`, one `question` tool call asks Path, Style, Format and
   Register together; the rules' pick below is first, marked `(Recommended)`. A question the prompt
   already answers is left out, and "you choose" or "알아서" skips the call. A non-interactive run takes
   the picks and says so in one line.
2. **Treatment.** It names one style, one register and a shot per beat (`layout`, `hero`, `transition`).
   The validator accepts only the style the rules choose, so one request always gets one style.
3. **Scaffold** (stage path). `render.mjs scaffold --out <d>` writes `stage/index.html`; draw each shot
   in its `DRAW` function and keep the structure. A 3D film also gets the world (`depth.md`).
4. **Board round** (round 1). `stage --round 1 --stills-only` writes the stills and `stills/board.png`
   and runs the board check; exit 13 names each failed rule before anything is encoded.
5. **Film.** The full render, the same rules plus the whole-film ones, and the gate.
6. **House.** A passed film records its style in `motion-house.json` beside the output folder.

## Register: rich is the default

`register` is `rich` unless the request asks for a calm, quiet, simple or minimal film (미니멀, 잔잔,
차분, 조용, 심플, 절제, minimal, calm, quiet, simple, understated, sparse, serene), which makes it
`minimal`. The validator refuses `minimal` without that ask and `rich` with it. The type path has no
register.

A rich stage film is full the way a dense product film is:

- **A filled frame.** At each shot midpoint the QA cuts the frame into 4 by 3 regions and calls one
  empty when under 15 % of it carries anything. `RICH-FILL` fails when more than 2 of the 12 regions are
  empty in more than one shot (the closing shot may breathe). A hero alone on a dark floor does not fill
  a frame: put the world's parts around it as DOM panels (a live counter, a scrolling log, stage pills, a
  progress readout, the product's own screens at a size that reads).
- **Dense, real labels.** Name the parts, readouts and tabs the viewer would read on the real thing; a
  named product uses its own names. Decor text (`LitStage.text(el, { decor: true })`) may fill up to 25 %
  of the text area and is exempt from the style rules.
- **A moving camera.** Push-in, truck, crane, orbit, rack focus or parallax in most shots; a locked
  shot is the exception.
- **Accent colours by role.** Besides its core palette each style carries accents, each for one role (a
  state, a category, a path); a rich palette may list them, at most 14 colours in all. A minimal film
  keeps 3 to 6.
- **A scored film.** `sound.mode: score` (`sound.md`); only a minimal film takes the style's bed
  (`generated`).
- **Full 3D where the subject allows it** (`depth.md`): `depth: "3d"`, and `render3d: "blender"` when
  Blender is installed and the request asks for high-quality, cinematic or photoreal 3D.

A minimal film keeps one hero on an open ground. Density never lifts the flash audit's limits: meet it
with slower light changes, lower-contrast detail behind a move, motion blur and cuts.

## House styles

A style is `styles/<id>.json`: palette and accent roles, faces per type role, the type scale per
format, leading, motion tokens (eases, durations, staggers, springs per object class, the ambient
travel), the hand-offs it uses, its ground, its score genre and beds, and what it never does. Four ship:

| Style | Look | Hand-offs | Score genre | Bed (minimal) |
|---|---|---|---|---|
| `swiss-signal` (default) | Ink ground, bone type, one teal signal, one amber moment | cut, wipe, match, push | house | glass, A minor, 104 |
| `tidal` | Indigo ground with a slow teal-to-violet flow, one coral moment | dissolve, match, wipe | deep-house | air, D major, 84 |
| `terminalcore` | Navy terminal, phosphor type, one signal hue, no easing | cut, wipe | tech-house | pulse, E minor, 120 |
| `paper` | Warm paper ground, near-black ink, clay signal, one blue moment | cut, match, wipe, iris, push | garage | warm, F major, 96 |

`swiss-signal`, `tidal` and `terminalcore` are also the type engine's presets; `paper` is stage-only.
`render.mjs styles --out <d> [--format 16:9|9:16]` renders one demo board per style and
`<d>/styles.png` with the four side by side; show it when the user wants to choose.

## Choosing the style

First match wins; the validator refuses anything else and names the rule that chose:

1. The request names a style (its id, or 페이퍼, 타이달, 터미널코어, 스위스 시그널).
2. The project's `motion-house.json`.
3. A keyword: terminal words take `terminalcore`; calm or wave words (물결, 파도, 잔잔한, 흐름, wave,
   tide, calm) take `tidal`; warm or paper words (따뜻한, 밝은, 종이, 손그림, warm, cozy, paper,
   hand-drawn) take `paper` on the stage path.
4. The genre: `explainer` takes `paper`, `brand-mood` takes `tidal`.
5. Otherwise `swiss-signal`.

On the stage path the palette may list only the style's colours (a rich film adds its accents),
`typePlan.faces` only its faces, a minimal film's bed one of the style's beds, and the score takes the
style's genre unless `sound.genre` names another. The type path's brief `style` must equal the
treatment's or be left out.

## Shots and layouts

Each beat is a shot with `layout` (`title`, `split`, `split-alt`, `stage`, `full`, `hero`), `hero` (the
one move the eye follows), `transition` (a word from the style's list; the last shot is `end`) and an
optional `lines` (the copy lines it shows; a `full` shot shows none). The zone table is in
`treatment.md`, "Shot grid". Two adjacent shots never share a layout, and a film of four or more
shots uses at least three layouts. One hero move leads each shot; in a rich film the labelled parts move
50 to 70 % as far and start 0.1 to 0.2 s later, the layers drift at their own depths, and ambient
motion never stops.

## The page: style.css, style.js and the kit

The renderer serves `/lit/style.css` (custom properties, the ground, the role classes `.lit-display`,
`.lit-headline`, `.lit-body`, `.lit-label` and the colour classes `.lit-ink`, `.lit-muted`,
`.lit-signal`, `.lit-accent`, `.lit-knockout`) and `/lit/style.js` (`window.LitStyle` with the tokens
and zones in pixels, `window.LitTimeline` with the shots). The kit reads them: `LitStage.shot(t)`
(index, layout, transition, local, p, `enter`, `exit`), `LitStage.zone(layout, part)`,
`LitStage.place(el, layout, part)`, `LitStage.tokens()` and `LitStage.plate(...)` for a Blender plate.
The treatment, page, stills, board, sound cues and gate all read one timeline.

## The board round

A stills-only render writes `stills/board.png`: one keyframe per shot with its number, time, layout and
hand-off under it and its hero move in words, the type zone dashed over the frame, and a header with
the style, palette, format, length and sound. It also runs the board check, writes `stills/check.json`
and prints the verdict on the board.

- Exit 0: open the board and every still with the read tool, record round 1 with its change, render the
  film.
- Exit 13 `BOARD_CHECK_FAIL`: each failed rule is named. Fix the page and render the board again; a
  full render would fail the same rules.

The board is a deliverable; the reply names it.

## Style rules in the gate

All FAIL on the stage path, on the board round and the full render alike unless marked:

| Rule | Fails when | Typical fix |
|---|---|---|
| `TEXT-OVERLAP` | Two visible text runs overlap by more than 8 % of the smaller box at a QA sample, or across a hand-off (marked `(cut)`) | Fewer lines per shot, the `split` layout, let one line leave before the next arrives |
| `TEXT-ON-STYLE` | Settled copy is off the style's colours or faces, or more than 4 % off the type scale | Use the role and colour classes |
| `TEXT-ZONE` | Settled copy sits outside its shot's type zone, or any copy shows in a `full` shot | Shorter copy, a smaller role, a layout with a larger zone |
| `FLAT-FRAME` (full render) | More than 1 s (2 s at the open or close) of frames whose luminance spread is under 0.02 | Draw the shot; never leave a stub `DRAW` |
| `DEAD-AIR` (full render) | More than 0.5 s in a row (0.4 s more at the open, 0.6 s more at the close) where under 2.5 % of the frame carries anything | Keep the protagonist or the next subject on screen through the hand-off |
| `ASSET-USED` (named product) | `product.assets` lists files and the page loads none | Show the real logo, screenshot or README image |
| `RICH-FILL` (rich, measured) | See Register; skipped for a minimal film | Panels, labels and layers around the hero |

Non-copy text off the scale is a WARN. The cut samples judge overlap only.

## Preview

When the request asks for a preview or storyboard first (미리보기, 스토리보드, 콘티, preview,
storyboard), set `preview: true`. The film is then done at its board: the check passed, the board and
every still opened and recorded. The reply shows the board and says the film is not rendered yet; on the
user's go, set `preview` to false and render.

## The house file

`motion-house.json` sits beside the output folder:

```json
{ "schema": "litopencode.motion-house/v1", "style": "<style id>", "createdAt": "<time>", "films": [{ "dir": "<folder>", "style": "<style id>", "path": "<stage or type>", "format": "<16:9 or 9:16>", "durationSec": 0, "at": "<time>" }] }
```

The renderer writes it when a full render passes with nothing withheld; the first film sets the house
style and later films are appended. While it exists new films in that folder take it; a request that
names another style wins for that film only. To change it, edit `style` or delete the file.

## What stays free

The subject, the idea, the copy, the drawing, the hero moves and the arc stay the model's, under the
concept rules in `treatment.md`. The studio fixes how a film looks and is built, never what it is about.
