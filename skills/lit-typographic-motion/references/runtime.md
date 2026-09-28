# Runtime, pre-warm and BLOCKED codes

## Pre-warm once, read-only afterwards

`litopencode motion-runtime install` runs outside any sandboxed session. It installs, into
`${XDG_CACHE_HOME:-~/.cache}/litopencode/motion-runtime/`:

- the engine's pinned JavaScript packages (`playwright-core`, `opentype.js`, `ws`) with
  `npm ci --omit=dev --ignore-scripts` from the lockfile inside this skill, plus a lockfile receipt;
- the fetched fonts and their licence files, each checked against its pinned sha256 (`fonts/pins.json`):
  Galmuri9 with its OFL text, MesloLGS NF with the Apache-2.0 notice, the Apache-2.0 text and the
  Vera/Arev notices; the official Pretendard Regular only if the lit-pptx Hangul pair is missing;
- with `--audio`, a Python venv holding the hash-pinned librosa set from `requirements-audio.txt`
  (`pip install --require-hashes --only-binary=:all:`).

`litopencode install` attempts the same pre-warm and prints one receipt line; a failure never fails
the install. A render never installs, fetches or repairs anything: it checks hashes and receipts and
stops with a named state.

`litopencode motion-runtime status` and `litopencode doctor` report five probes on every run:
Chrome (path and version), ffmpeg (version and the preview encoder rung: `libwebp_anim`, `img2webp`
or GIF), the WebGL2 renderer string from a real headless probe, the software-GL or unknown-renderer
warning, and the pre-warm state naming what is missing and the command that fixes it.

## Exit codes

| Exit | Name | Meaning | Fix |
| --- | --- | --- | --- |
| 0 | OK | the requested mode finished; for `film`, the gate passed | none |
| 10 | BLOCKED_NO_CHROME | Chrome is missing or failed to start headless; the message carries its first error line | install Chrome or set `CHROME_PATH` |
| 11 | BLOCKED_NO_WEBGL2 | Chrome ran but no rung produced a WebGL2 context | check GPU drivers; the SwiftShader rung is already tried |
| 12 | BLOCKED_NO_FFMPEG_FOR_VIDEO | a film was requested without ffmpeg | install ffmpeg; `--stills-only`, `stills` and `sheet` still work |
| 13 | GATE_FAIL_QA | pre-flight or the full gate failed; the report names the rules | fix and rerun the next round |
| 14 | BLOCKED_DEPS_NOT_PREWARMED | the pinned packages are absent (or Tier-3 models are requested) | `litopencode motion-runtime install` outside the session |
| 15 | BLOCKED_FONT_FETCH | a required font is missing or its bytes do not match the pin | `litopencode motion-runtime install`; a mismatch is never accepted |
| 16 | BLOCKED_TREATMENT_INVALID | `treatment.json` is missing or a field breaks its rule; the message names the field | fix that field (`treatment.md`) |
| 17 | STAGE_CONTRACT_ERROR | the stage page broke its contract: no `LitStage.define`, a wrong size, a forbidden element or API, a flipbook or animated raster, a path outside `stage/`, or a copy line never found on screen | fix the page (`stage.md`) |
| 18 | STAGE_NONDETERMINISTIC | a sample frame differs between the master and a fresh replay from 0; the message names the frame and the first region | remove the clock or random source the renderer does not drive |
| 19 | STAGE_NETWORK_REQUEST | the page requested something outside the stage origin, or a stage file names an external URL | make the asset local |
| 20 | SOUND_INVALID | the planned track is missing from the film, too long or short, too loud, or a generated bed starts silent | fix the track or its plan |

## Chrome, egress and the sandbox

- Launch ladder (MO-A-51), first rung that yields a real `getContext('webgl2')` in the page wins and
  is recorded as `chromeFlags`: the platform GPU rung (macOS `--use-angle=metal`, Linux
  `--use-angle=gl`, Windows `--use-angle=d3d11`), then `--use-angle=swiftshader
  --enable-unsafe-swiftshader`. The anti-throttling flags are always appended. The Chrome profile
  lives in `<out>/.run/` and is removed on exit; Chrome is driven over a pipe, so no control port.
- Frame egress: a WebSocket on `127.0.0.1:0`. If the sandbox refuses to listen, each frame's
  readback buffer is pulled over CDP instead. Either way the hash, the flash audit and ffmpeg see
  the same bytes.
- A software renderer (SwiftShader, llvmpipe, softpipe, lavapipe, Apple Software Renderer,
  Microsoft Basic Render Driver) is allowed and labelled: one sample per frame, tidal octaves
  halved (at least 3), CRT persistence off, affected pass ranges marked `downgraded`.

## The stage renderer

- The stage path always uses the software rung (SwiftShader, CPU raster) with the compositor, image
  and animation flags that keep capture deterministic, `--mute-audio`, `--force-color-profile=srgb`,
  `--force-device-scale-factor=1`, the window at the format size, and the mock-keychain flags.
- The page is served from the synthetic origin `http://lit.stage/` through request interception, so
  nothing listens on a port; every other request fails and is recorded (exit 19), and a host
  resolver rule maps every other host to nothing as a backstop.
- Three browsers run side by side: the master capture, a fresh replay for the determinism samples and
  a separate QA replay that hides text to measure ink. The master never changes a style.
- Fonts come from this skill and the pre-warmed cache; an unwarmed cache stops with exit 14.

## Sound

- Generated (the default under bare `lit`, on both paths): a deterministic bed from the treatment,
  built in code with no network or model weights: tempo, pulse and a chord pad, plus the accents the
  beats ask for. 48 kHz 16-bit stereo, exactly the film's length, peaks at most -2 dBFS, integrated
  loudness about -16 LUFS (ITU-R BS.1770-4, measured in this code). `sound-cues.json` lists every cue
  against its cut. `node render.mjs sound --out <d>` builds it on its own.
- Supplied or authored tracks are always muxed, whatever the audio-analysis tier's state, padded or
  trimmed to the film with a 50 ms fade. AAC at 256 kb/s.

## Audio analysis tiers (the type path's cut grid)

- Tier 1 (default): text reading time and a BPM grid.
- Tier 2: a supplied audio file is analysed once by the pre-warmed venv into a beat grid for this
  run only. An absent venv, a venv that no longer matches its pins, or a failed analysis falls back
  to Tier 1 with a warning; the venv is never repaired in the session.
- Tier 3 (`--word-timing`, opt-in only): `motion-runtime install --word-timing` states the download
  size and every model pin before downloading and fails closed unless each model has a pinned id,
  revision and a verified licence that allows commercial use. This build pins no licence-verified
  Korean alignment model, so the install fails closed and a render with `--word-timing` exits 14.
  MMS_FA and madmom weights, aubio and essentia are never used at any tier.
