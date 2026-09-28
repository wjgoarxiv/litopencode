# Look rounds, done and the reply

A film is not done when a command exits 0. It is done when a gate PASS, a valid treatment and at
least two recorded look rounds agree, and the last round looked at the final render's own frames.

## The stills set

Every render, `--stills-only` or full, writes the same set:

- `stills/beat-NN-mid.png`: the frame at each treatment beat's midpoint;
- `stills/cut-NN-strip.png`: a strip of three frames around every cut (-6, 0, +6 frames);
- `sheet/contact.png`: a 12-frame contact sheet across the whole film;
- `stills/stills.json`: the round, each file's SHA-256 and what each beat should show.

A full render adds `poster.png`. Open these files with OpenCode's read tool; only images passed to the
read tool count as viewed (LitOpenCode records each read of a film's stills). OCR or pixel statistics
may go in `aids` but never count as looking.

## The nine questions

Answer each against a frame you opened. `observed` is at least one sentence naming a concrete
visible detail in that frame; a bare yes or no is refused.

1. "A stranger would say this film is for: <…>". Ask a fresh subagent that gets only the contact sheet
   and the beat stills, never the request or the treatment, and record its sentence verbatim with
   `by: "blind"`; without a subagent, answer it yourself with `by: "self"`. `verdict: "yes"` when that
   reading matches the treatment's subject.
2. Does every beat show its `onScreen` plan?
3. Is the craft at the level `ambition` asks for (transitions, rhythm, depth, hierarchy)?
4. Is any request text, meta label, placeholder, file name or internal term on screen?
5. Does the ending land?
6. Does the sound follow the cuts? Answer from `sound-cues.json`.
7. Name one thing a skilled motion designer, given only the request, would have shown that this film
   does not. `verdict: "yes"` when you can name one; then revise.
8. Is any element on screen without a job in its beat?
9. Could every copy line be pasted unchanged into a film about a different subject? If yes, rewrite
   the copy from `subject.specifics`.

Another round is required after a "no" on 1, 2, 3, 5 or 6, a "yes" on 4, 8 or 9, or a nameable Q7.

## Recording a round

```sh
node render.mjs look --out <d> --round N --answers <answers.json>
```

```json
{
  "viewed": ["stills/beat-01-mid.png", "sheet/contact.png"],
  "weakestBeat": "<beat index and why>",
  "change": "<the change you will make before the next render>",
  "answers": [
    { "q": 1, "verdict": "<yes or no>", "frame": "sheet/contact.png", "observed": "<a sentence>", "by": "<blind or self>" }
  ]
}
```

- Rounds share one counter with renders (1-3): `look --round N` belongs to the stills set rendered
  with `--round N`, and each round is the previous one plus one.
- `look` refuses a frame that is not in the latest stills set, and stamps the round with the SHA-256
  of the current manifest (`stills/stills.json` after a stills round, `manifest.json` after a full
  render) and of each listed frame.
- Round 1 is always a stills round before the first full render; it must name the weakest beat and
  the change.
- The last round must view the poster, the contact sheet, every beat midpoint and every transition
  strip of the final render.
- If no image tool is reachable, record `"blocked": "no-vision-tool"`; the done check then ends with
  `DONE_UNVIEWED`, and the reply says in plain words that nobody viewed the frames.
- At most 3 rounds. After round 3, deliver with every open item stated plainly.

## Done

`node gate.mjs --done <d>` exits:

| Exit | Status | Meaning |
| --- | --- | --- |
| 0 | `DONE` | gate PASS, a valid treatment, 2+ look rounds (round 1 on stills with a change, the last on the final render's manifest and all its frames), no round still asking for another, and, under OpenCode, every viewed frame read with the read tool |
| 1 | `NOT DONE` | something above is missing; the reason names it |
| 2 | `DONE_WITH_OPEN_ITEMS` | round 3 is spent; deliver and state each open gate rule or look item |
| 3 | `DONE_UNVIEWED` | everything else holds, but the frames were not viewed |

The done check also compares the final treatment with the first valid one and prints `downgraded:`
for a length cut of more than 20 %, fewer subject beats, sound switched to none without a user
request, or a stage film moved to the type path. Never downgrade to pass: fix the cause (a scrim,
size, placement, timing or seeded randomness) or deliver with the failure stated.

## The reply

- Keep the product's activation line where it is; below it, no second banner and no emoji.
- Plain words, no internal names (no rule ids, no path or preset jargon).
- One line on the defaults chosen.
- A label on every invention (subject, name, facts, copy) and on generated sound.
- One plain line on what was checked: flash safety, legibility, and the frames looked at.
- Where the copy lives (the `COPY` object in `stage/index.html`, or the brief) and the one command
  that re-renders.
- Any `downgraded` item and any open look item or failed rule.

## Gate rows (both paths)

| Check | Path | Rule |
| --- | --- | --- |
| Flash (WCAG 2.3.1) | both | at most 3 general and 3 red flashes in any 1 s window, master and looping preview; the grid and window transpose for 9:16; a failure withholds every export |
| Size, fps, length | both | stage: exactly the format size, 60 or 30 fps, within ±10 % of `durationSec`; type: 1920x1080 at 60 fps |
| File sizes | both | preview at most 3 MB, poster at most 1 MB |
| Reduced-motion still | both | present; on the stage it is the final beat's midpoint |
| Near-black runs | both | no near-black stretch longer than twice the minimum hold |
| Sound | both, unless `none` | a stream within ±0.1 s of the video, sample peak at most -0.5 dBFS; a generated bed has no stretch below -50 dBFS RMS longer than 1.5 s in the first 3 s |
| Determinism | both | stage: 8-16 sample frames replayed from 0 in a fresh browser; type: the cut frames re-rendered and compared |
| Text | stage | copy found, contrast, title-safe, reading floor, fonts; decor limits; meta labels |
| Type rules | type | GLSL presence, contrast, reading time, tracking, Hangul, leading, measure, hue clusters, frame time, glyph coverage |
