# Treatment: the film before any frame

Every film starts here. Write `treatment.json` in the run's output directory (the `--out` directory)
before any render. The render validates it first, on both paths and in `--stills-only` too, and stops
with exit 16 (`BLOCKED_TREATMENT_INVALID`) naming the first field that fails. A treatment is a
director's decision record: what the film is about, what the viewer sees in each beat, how it moves
and sounds, and what would make it excellent. Load the path reference only after `path` is set.

## Fields

"Normalized" below means NFC, lowercase, then every space and punctuation mark removed. Before any
comparison with `request`, every quoted span (`"…"`, `“…”`, `'…'`, `「…」`) is removed from it.

| Field | Rule |
| --- | --- |
| `request` | The user's words, verbatim, including the `lit` word if present. |
| `genre` | One of `announcement`, `brand-mood`, `event`, `explainer`, `motion-graphics`, `type-led`, `other`. |
| `path`, `pathReason` | `type` or `stage` by the path rule below; `pathReason` says why in one line. |
| `idea` | One sentence: the film's own idea. It may not share a normalized run of min(10, half the normalized request length) characters with the request. |
| `audience`, `channel` | Who watches, and where it plays. |
| `format`, `formatReason` | `16:9` (1920x1080) or `9:16` (1080x1920), with a reason tied to `channel`. |
| `durationSec` | 4-90. Unless the user asked for a length, `announcement`, `event`, `explainer` and `motion-graphics` run at least 10 s. |
| `beats[]` | `{t0, t1, purpose, onScreen, motion, sound}` in order, each at least 1.2 s, covering 0 to `durationSec` with no gap over 0.25 s. At least as many beats as the genre's arc has stages; `type-led` has one beat per supplied line. |
| `subject` | `{name, source: user or invented, specifics[]}` with at least 2 concrete specifics: what it is or does, for whom, one distinctive detail. `source: user` only when the request names it. |
| `visualDevices[]` | `{kind, role: subject, support or texture, beats[]}`; `beats` lists beat indices (from 0). Kinds: `illustration`, `diagram`, `chart`, `icon`, `shape`, `path`, `mask`, `depth3d`, `particles`, `grid`, `gradient`, `photo-texture`. |
| `typePlan` | `{faces[], hierarchy, maxWordsOnScreen}`; faces come from `Archivo`, `LitOpenCode Sans`, `VT323`, `Silkscreen`, `MesloLGS NF`, `Galmuri9`. Optional `showIndex: true` prints a shot index on the type path. |
| `palette[]` | 3-6 entries `{hex: "#rrggbb", role}`. |
| `sound` | `{mode, plan, ...}`. `mode` is `generated`, `supplied`, `authored` or `none`. |
| `copy` | `{source: user or invented, lines[]}`. |
| `inventions[]` | Every invented name, line, number and fact. Required when `copy.source` or `subject.source` is `invented`, and it must contain `subject.name`. |
| `ambition` | 1-2 sentences, in craft terms, on what would make this film excellent for this request. |
| `seed`, `fps` | Optional. `seed` fixes every random value on the stage (`Math.random` and the kit's `rand`); `fps` is 60 by default, 30 when the treatment says so. |

### Path rule

- `type` when the words themselves are the film: the user asked for kinetic type, a lyric or quote
  video, a title sequence or typographic motion, or supplied words with no other subject, at 16:9.
  The validator accepts `type` only with `copy.source: user` or a type-led cue in the request, and
  only at `16:9`.
- `stage` for every other film, including any film that needs shapes, drawn objects, diagrams or
  imagery beyond type. Supplied words on the stage path become stage copy.
- A 9:16 film always takes the stage path.

### Subject and devices

- On the stage path at least one device has `role: subject`: a drawn depiction of what the film is
  about, never a background. That device's beats cover at least half of `durationSec`.
- The stage path also needs at least 2 distinct counting kinds. `grid`, `gradient`, `particles` and
  `photo-texture` are always `role: texture` and never count.
- When the request names no subject, words or facts, invent one: a name, what it is or does, for
  whom, and one distinctive detail. List every invented part in `inventions[]` and label it in the
  reply. Write the copy from `subject.specifics`, never from the request's own wording.

### Copy

- `source: user`: every normalized line is a substring of the normalized request (quoted spans kept).
  Keep the user's words; do not polish them.
- `source: invented`: no line may share the idea's substring limit with the request. A line that
  could be pasted unchanged into a film about another subject is too generic; rewrite it from the
  specifics.

### Sound

- `generated` (the default under bare `lit`, on both paths): the product builds a deterministic bed
  from the treatment. It needs `palette` (`glass`: bell partials over a soft pad; `warm`: rounded saw
  pad and sub; `pulse`: plucked square arpeggio; `air`: sine pad with breath noise), `key` such as
  `"D minor"` or `"F# major"`, and `tempo` 60-180 BPM. Each beat's `sound` field may ask for an
  accent: a `hit` on its cut, a `rise` into the next beat, a `cadence` to close, or `thin` to pare
  the bed back for that beat. The reply labels the bed as generated.
- `supplied`: the user's file, `file` relative to the output directory or absolute.
- `authored`: a WAV you wrote into `stage/`, `file` such as `"stage/score.wav"`.
- `none`: only when the user asked for silence, or `mutedByDesign: true` when the channel plays muted.

Every track that is not `none` is muxed, padded or trimmed to the film with a 50 ms fade.

## Placeholder example

The values below only show each field's shape. They are placeholders, so this example never
validates, and a treatment whose free-text fields match half or more of it is refused as a copy
(`copiedExample`). Write every value for this film.

```json
{
  "request": "<the user's words, verbatim>",
  "genre": "<one genre>",
  "path": "<type or stage>",
  "pathReason": "<why this path, one line>",
  "idea": "<one sentence>",
  "audience": "<who watches>",
  "channel": "<where it plays>",
  "format": "<16:9 or 9:16>",
  "formatReason": "<tied to the channel>",
  "durationSec": "<4-90>",
  "beats": [
    { "t0": "<start s>", "t1": "<end s>", "purpose": "<arc stage>", "onScreen": "<what is drawn>", "motion": "<how it moves>", "sound": "<what the ear gets>" }
  ],
  "subject": { "name": "<name>", "source": "<user or invented>", "specifics": ["<what it is or does>", "<for whom>", "<one distinctive detail>"] },
  "visualDevices": [{ "kind": "<kind>", "role": "<subject, support or texture>", "beats": ["<beat index>"] }],
  "typePlan": { "faces": ["<face>"], "hierarchy": "<what reads first, second, third>", "maxWordsOnScreen": "<count>" },
  "palette": [{ "hex": "<#rrggbb>", "role": "<role>" }],
  "sound": { "mode": "<mode>", "plan": "<the sound's arc>", "palette": "<timbre palette>", "key": "<key>", "tempo": "<BPM>" },
  "copy": { "source": "<user or invented>", "lines": ["<line>"] },
  "inventions": ["<each invented name, line or fact>"],
  "ambition": "<1-2 sentences in craft terms>"
}
```

## Genre arcs

A beat is one stage of the arc; a long film gives a stage more than one beat. Length comes from the
arc, not from a word count.

- **announcement:** hook → context → key moment → details → close.
- **brand-mood:** motif → variation → peak → resolve.
- **event:** hook → what, when, where → highlight → close.
- **explainer:** question → steps → result → recap.
- **motion-graphics:** opening motif → set piece → set piece → peak → resolve.
- **type-led:** one breath per line, with emphasis and pause.
- **other:** at least three stages you name in `purpose`.

## Craft rules

- Show the subject; do not only name it. With the sound muted and every word hidden, the drawn
  subject alone should still suggest what the film is about.
- Aim for professional motion-design craft in every film: varied transitions (match cuts, masks,
  morphs), rhythm locked to the sound, layered depth, clear hierarchy, deliberate easing. Every beat
  shows something new. Length comes from the arc; never shorten the film or merge beats to pass a
  check.
- Put the subject's specifics on screen as drawn things, not as captions about them.
- Plan each cut against the sound: a hit lands on the cut, a rise leads into it, and the close has a
  cadence.
- The brief's or the request's own title never prints on screen unless it is the film's name and is
  in `copy.lines`; never print a file name, a preset name or a word such as path, beat or treatment.

## After the treatment

- Stage path: load `stage.md`.
- Type path: load `authoring.md`, `type-craft.md` and `style-bibles.md`.
- Both: `craft-loop.md` holds the look questions, rounds, done rules and reply; `runtime.md` holds the
  exit codes.
- The first valid treatment is kept. If a later one shortens the film by more than 20 %, removes
  subject beats, silences the sound without a user request or moves a stage film to the type path,
  the done check records it as `downgraded` and the reply must say so.
