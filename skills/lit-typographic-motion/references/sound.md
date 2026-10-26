# Sound: the per-film score and the minimal bed

Read this when the treatment's `sound.mode` is `score` or `generated`, and before answering the look
question about sound. The product builds the audio in its own code (no samples, no borrowed melodies)
and the same treatment always builds the same file.

## Which mode

| Mode | When | What it is |
|---|---|---|
| `score` | Every rich stage film under `lit` (the default) | A layered house-family track arranged on the film's shots, stems kept as files |
| `generated` | A minimal stage film, and the type path | The style's or preset's deterministic bed |
| `supplied` | The user gave a file | Their file, padded or trimmed to the film |
| `authored` | You wrote a WAV into `stage/` | `file` such as `stage/score.wav` |
| `none` | The user asked for silence, or `mutedByDesign: true` | No track |

The validator refuses `generated` on a rich stage film ("a rich film scores its own music"). The reply
labels a score or bed as generated.

## What the score is

The film seeds it: the request, the idea, the turn, the protagonist's name and the shots' purposes and
times feed one hash, which picks the key, the major or minor mode, the tempo inside the genre's band, one
of six chord progressions, a one-bar motif on the pentatonic scale and the percussion pattern. Two films
differ; one film never changes between renders.

The genre comes from the style (`swiss-signal` house, `tidal` deep-house, `terminalcore` tech-house,
`paper` garage) unless `sound.genre` names `house`, `tech-house`, `deep-house` or `garage`. A genre fixes
the tempo band (garage 130 to 134 BPM, house 120 to 126, tech-house 124 to 128, deep-house 118 to 122),
the kick, bass and stab patterns, the swing and whether a pad runs.

### Arrangement

The shots become sections: an intro, builds up to the turn, the **drop on the shot `story.beat`
names**, a break before a second drop when the film has room, and an outro. The bar grid is placed so
that a bar line falls exactly on the drop. The last half bar before it has no kick, so the drop hits from
silence: a riser leads into it and an impact lands on it. Each later section change gets its own riser,
reverse or downlifter. A shot's `sound` line may ask for an accent (`hit` on its cut, `rise` into the
next shot, `cadence` to close, `thin` to pare back) and the accents stem plays it on the cut it names.

### Stems

At least six audible stems are written to `sound/stems/<name>.wav`: `kick`, `clap`, `hats`, `perc`,
`bass`, `chords`, `lead`, `fx` and `accents`, plus the `return-reverb` and `return-delay` buses. Every
stem has its own pattern, gain, pan and high-pass (everything but the bass and kick is high-passed so
the low end stays clean). `sound/score.wav` is the mix; `sound-cues.json` lists each stem with its
settings and level.

### Mix

1. The kick ducks the bass, the chords and the lead (sidechain). The cue sheet reports the measured depth
   in dB; a score that does not duck is a defect.
2. A reverb and a tempo-synced delay take sends from the stems that need space.
3. The bus is compressed gently.
4. The master stage measures integrated loudness with ITU-R BS.1770-4 and sits it at -16 LUFS, then a
   lookahead limiter holds the peak under -2 dBFS so the AAC encode in the mp4 cannot clip it.

The pad's filter cutoff is clamped to the filter's stable range, so a sweep never blows up into noise.

## The minimal bed

`generated` needs `palette` (`glass`, `warm`, `pulse` or `air`), `key` such as `"D minor"` and `tempo` 60
to 180 BPM, and on the stage path it is one of the style's beds exactly. Shot `sound` lines may ask for
the same accents. The bed is a deterministic pad or arpeggio, loudness-matched the same way.

## Checks

`render.mjs sound --out <d>` builds the track from the current treatment and writes `sound-cues.json`.
The gate's sound rows read the muxed film: `SOUND-stream` (an audio stream is there, with its integrated
loudness), `SOUND-duration` (within 0.1 s of the video), `SOUND-peak` (under -0.5 dBFS) and
`SOUND-start` (no stretch under -50 dBFS longer than 1.5 s in the first 3 s; a WARN for a score, whose
intro may be sparse, a FAIL for a bed). Exit 20 (`SOUND_INVALID`) names a supplied or authored file that
fails the checks.

The look question "does the sound follow the cuts" is answered from `sound-cues.json`: the cut times, the
section changes and the accents that land on them. Name a real section or cue, not the file.
