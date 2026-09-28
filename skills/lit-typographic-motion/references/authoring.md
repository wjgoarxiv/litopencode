# Authoring: brief schema and the scene/engine contract

## The brief (`motion-brief.json`)

On the type path the brief lays out the scenes; it comes after the treatment (`treatment.md`), which
fixes the copy, the length, the sound and the beats. Everything else is derived from the two files,
deterministically.

```json
{
  "title": "<the film's own name, printed only when it is also a copy line>",
  "description": "<one line about the film, used for the preset keyword check>",
  "preset": "<swiss-signal, terminalcore or tidal; omit to let MO-B-00 pick>",
  "bpm": "<40-240>",
  "seed": "<integer>",
  "audio": "<optional path to a supplied track>",
  "scenes": [
    { "scene": "title-slam", "text": "<copy line>" },
    { "scene": "karaoke", "text": "<copy line>" },
    { "scene": "kinetic-list", "heading": "<copy line>", "items": ["<item>", "<item>"] },
    { "scene": "counter", "from": "<number>", "to": "<number>", "label": "<copy line>" },
    { "scene": "signature", "text": "<Latin copy line>", "font": "<EMS stroke font>" },
    { "scene": "end-card", "text": "<copy line>", "sub": "<copy line>", "paragraph": "<optional credit block>" }
  ]
}
```

The values are placeholders that only show each field's shape; the render refuses a brief that still
holds one. The copy comes from the treatment's `copy.lines`: the user's words when they gave words,
otherwise lines written from the treatment's subject. The treatment's `durationSec` sets the length:
every hold scales up by the same factor (never below its reading floor), and when the floors force a
longer film the report says so.

| Field | Rule |
| --- | --- |
| `scenes` | Ordered shots. Omit it to give `lines` instead (first line = title slam, middle lines = karaoke, last = end-card sub line). |
| `preset` / `style` | An explicit style. Leave both out to let MO-B-00 pick. The report says "user-specified" only when the request names the preset; otherwise "agent default". |
| `bpm` | Tier-1 grid, 40..240; default 100 (MO-A-14). Ignored when an audio file yields a beat grid. |
| `seed` | Run seed for every pass seed (`fnv1a32(runSeed:sceneId:shotIndex:pass)`, MO-SH-01). |
| `audio` | Tier 2: analysed once, offline, by the pre-warmed librosa venv; absent or failed analysis falls back to Tier 1 with a warning (MO-A-19). |
| `minDurationSec` | Stretches the last shot so the film is at least this long (never shorter than 3 s); the treatment's `durationSec` is the usual target. |

Scene kinds: `title-slam` (one line, display voice), `karaoke` (one line revealed one 어절 at a
time, wrapped at word boundaries when long), `kinetic-list` (two or more items appearing one per
step), `counter` (a number counting from `from` to `to`, with an optional label), `signature`
(Latin text written by a single-stroke EMS pen; `font` is one of EMSAllure, EMSFelix, EMSOsmotron,
EMSReadability, EMSTech) and `end-card` (title, optional sub line and optional paragraph).
Give each repeated scene its own `sceneId` only if you need to address it; repeats become shot 1,
shot 2 of the same scene id.

## Timeline (Phase 1)

- Tier 1 (default): each shot holds `1.25 x` its reading floor (MO-A-09/10), at least two beats
  (MO-A-16), and every start is a grid beat, so every cut lands within one frame of a beat
  (MO-A-15). Reveal steps are at least 0.35 s (MO-A-12) and land on beats too.
- Reading floor, one function (MO-C-07/08): `line`/`scene` = max(0.9 s Latin or 1.0 s with Hangul,
  0.2 s per Hangul syllable + words / 3.3); `word` = max(0.5, same rate); `reveal` = 0.35 s. A
  line/scene must also stay under 17 Latin characters per second. These numbers are provisional.
- Tier 2: the beat grid replaces the fixed BPM; the same rules apply against it.
- Tier 3 (`--word-timing`) is opt-in only and fails closed in this build (see runtime.md).

The render refuses to start (exit 13, pre-flight) if the generated timeline breaks any of these,
or if any character of the brief is missing from the font it resolves to (MO-D-04).

## What the engine does with a scene

A scene is a pure function of the frame: `f.t` (film seconds), `f.lt`/`f.p` (time and 0..1 progress
inside its own window), its timeline entry and its reveal units. Every beat inside a scene is a
function of `f.lt` or `f.p`, never a frame number (MO-A-06). The engine then:

1. renders the pinned sub-sample times `t_n + (shutter/fps)((i + 0.5)/N - 0.5)` (MO-A-28; master
   `--samples 4 --shutter 0.5`, stills and previews one sample);
2. composites each sample in linear HDR: the preset's layout passes, the type layer (glyphs from
   real font outlines), then the filter passes;
3. averages the samples, runs the post chain once with the centre sample's overrides, in the fixed
   order bloom and halation, chromatic aberration, tone shoulder, grain, vignette, flash,
   shake/zoom, invert (§A7), and applies sRGB exactly once;
4. reads the 8-bit frame back and sends the same bytes to the frame hash, the flash audit and ffmpeg.

Post overrides a scene may return, with their neutral values (MO-A-58): `exposure` 1, `bloom` 0,
`bloomThreshold` 0.85, `bloomKnee` 0, `bloomRadius` 0, `halation` 0, `ca` 0, `grain` 0, `vignette` 0,
`fade` 1, `flash` 0, `shake` [0,0], `zoom` 1, `invert` false. `invert` may change only on a cut and
must then hold two beats; every rise of `flash` above 0.1 and every `invert` change counts as an
event, and a shot allows at most two events in any one-second window (MO-SH-03).

A scene that carries state across frames is `stateful`: CRT phosphor persistence reads the three
previous frames' pre-CRT images, so on a seek the engine re-renders those frames first (preroll).
This keeps a seeked still byte-identical to the same frame of a sequential video (MO-A-25).

## Frame log (`render.jsonl`)

One line per pass per frame (`{"frame", "pass", "draws", "uniforms"}`) written by the single
uniform setter, and one frame line (`"pass": null`) with `rgbaSha256`, `sampleTimes`, `textBoxes`
(each drawn text's bbox, font, size, weight, voice and script runs), `graphics` (non-glyph element
boxes), `fills`, the effective post values, the flash transitions and the glyph-ink pixel count.
The gate reads these records; it never re-detects text from pixels.

## Starter scene craft notes

- Title slam: largest size that fits 1440 px, placed low-left on the grid; enters in 180 ms from a
  scale of 1.04 (never from collapsed) with Latin width stepping from 125 to 100; tracking stays at
  -0.035em or looser.
- Karaoke: glyph positions come from the whole line's layout, so revealed words never shift.
- Kinetic list: items step in 24 px from the left on their beat; line height 1.5 (Latin) or 1.6
  (Hangul).
- Counter: the value steps at 15 updates per second and the digit block stays small so changing
  digits never fill a quarter of a 10-degree window.
- Signature: pen travel is distributed over each character's own time window.
- End card: title, sub line and an optional 60-75 character paragraph; the one accent mark lives
  here when the preset has an accent and the card is at most 10% of the film.
