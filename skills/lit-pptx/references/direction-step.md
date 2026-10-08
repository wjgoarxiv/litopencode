# Choosing a direction before the first slide

A LitOpenCode deck is drawn from a tonality pack: palette roles, a type ramp, the title treatments
the pack allows, the layout families it lists, its cover, section and closing variants, and two
dials. Eight packs ship in `templates/tonalities/`. The engine never guesses a look on its own, so
the first decision of every build is which pack to compile under. This file is the procedure for
making that decision quickly, recording it, and telling the user what was chosen.

The step costs a few minutes and saves the most expensive failure in slide work: a deck that is
correct slide by slide but wrong as a whole, because a stage pitch was set as a dense reading
document or a briefing paper was set as a keynote.

## What the step produces

1. One tonality id written into the deck's frontmatter (`tonality: ledger`).
2. Two named alternatives, with the reason each one lost.
3. The density and variance the deck compiles at, and any move away from the pack default.
4. A direction card kept in the task's working notes (the build log), and a two or three sentence
   summary of it in the reply.

Nothing else is decided here. Layout families per slide come next, while outlining; they are
recorded on the card because a pack that cannot carry a planned slide is a wrong pack.

## No questions on a bare request

A bare request ("발표자료 만들어 줘", "make a deck from these notes", a bare `lit` slide request)
gets no question about colours, fonts or style. Read the request and any sources, pick the
direction yourself, build the whole deck, and say in the reply what was chosen and what the
alternatives were. The user corrects a finished deck faster than they answer an abstract style
question.

Ask only in two cases:

- the user has explicitly left the look open and wants to see options ("어떤 느낌이 좋을지 모르겠어",
  "show me a few styles"): build the compare strip below instead of asking in words;
- a dial would have to move by more than 2 from the pack default to meet the brief (see "Dials").

## Step 1: read four facts off the brief

Infer each fact when the brief does not state it, and write the inference on the card so the user
can correct it later.

| Fact | What to settle | Why it matters |
|---|---|---|
| Deck type | One of the eight types below, or the nearest one | Gives the starting candidate order |
| Delivery | Spoken in a room, sent ahead and read alone, or both | Read decks favour Gazette and Ledger; stage decks favour Signal and Night |
| Room | Lit office, screen share, dark hall, printed handout | A dark hall pulls Night forward; print rules Night out |
| Language | Korean, English or mixed | Korean glyphs take about twice the width of Latin letters, which tightens title budgets |

## Step 2: start from the deck type

Each deck type has an ordered shortlist. The first entry wins when no signal in step 3 moves it.
All eight packs default to density 10; the variance shown is each pack's own default.

| Deck type | First choice | Second | Third |
|---|---|---|---|
| Pitch or proposal (투자·제안) | signal (v6) | studio (v8) | atlas (v7) when the product is physical and photographed |
| Management review (경영·사업 실적) | ledger (v5) | gazette (v4) when circulated in Korean before the meeting | night (v6) when presented on a stage screen |
| Research talk (연구 발표) | paper (v5) | night (v6) for a large dark auditorium | chalk (v6) for a tutorial-style talk |
| Lecture or training (강의·교육) | chalk (v6) | paper (v5) | studio (v8) for a public lecture with images |
| Data review (데이터·지표 리뷰) | night (v6) | ledger (v5) | paper (v5) when the review is a written analysis |
| Image-led showcase (제품·현장·포트폴리오) | atlas (v7) | studio (v8) | signal (v6) for a launch moment |
| Korean reading brief (보고서형 덱) | gazette (v4) | ledger (v5) | none |
| Status update (주간·월간 보고) | ledger (v5) | gazette (v4) | night (v6) |

A request that fits none of these takes the nearest type, and the card says "other, treated as
status update" or similar.

## Step 3: measure the outline and reorder

Write a rough outline first: one line per slide naming its job and the visual it needs (table,
chart, image, numbers, steps, prose). Count on that outline, not on the raw notes. Apply the rules
in this order; ties keep the deck-type order, so the same source always lands on the same pack.

| Rule | Fires when | Move |
|---|---|---|
| Named by the user | The brief or an earlier turn names a tonality | Use it. Still write the card and still name two alternatives |
| Legacy template named | The brief names AZURE-PRO, AZURE-A2Z, BOILERPLATE-PRETENDARD or BOILERPLATE-A2Z | Compile with `--template` as named; offer two tonalities as alternatives |
| Read, not presented | "미리 배포", "보고서", "sent ahead", "for the board pack" | gazette to the front for Korean, ledger otherwise |
| Table-heavy | 30 % or more of slides hold a table | ledger or gazette up one place |
| Chart-heavy | 30 % or more of slides hold a chart | ledger, night or paper up one place |
| Image-heavy | 30 % or more of slides hold a photograph or screenshot | atlas or studio up one place; gazette down one place |
| Long bodies | average body over about 150 Hangul or 300 Latin characters per content slide | gazette or ledger up; signal down |
| Short bodies | average body under about 40 Hangul or 80 Latin characters | signal or studio up |
| Citations | numbered references, DOIs, a references slide | paper up one place |
| Teaching shape | definitions, equations, or a how-it-works sequence of three or more steps | chalk or paper up one place |
| Dark room | keynote hall, demo day, stage | night up one place |
| Missing carrier | the pack has no family or title that can carry a planned slide | drop that pack from the shortlist |

The last rule overrides taste. The packs differ in what they can draw:

- ledger, gazette and atlas have no `statement` title treatment; a statement slide there is set as
  a top title, the largest the pack has, and the compile log says so;
- atlas lists no table, chart or references family; an outline with a results table does not fit
  it, however many photographs it also has;
- gazette lists no chart family; a chart-led Korean report belongs to ledger;
- signal lists no `ledger-table`, `dashboard-grid` or `references-appendix`;
- night lists no image family at all, so a photograph-led slide does not fit it, and its two
  closings are a statement and a decision box;
- only atlas and studio carry `image-full`, and only atlas, studio and paper have a cover that uses
  a photograph.

Run `node <skill>/run.mjs compile --list-layouts <tonality>` to see a pack's exact families, the
treatments each family takes in that pack, and its cover, section and closing variants.

### A worked case

A Korean seminar on battery recycling for an industry association, 25 minutes, projected in a lit
conference room, with nine content slides planned: three charts, two tables, two process
diagrams, one photograph and a references slide.

- Deck type: research talk, so paper, night, chalk.
- Chart share 3/9 = 33 %: paper (already first) stays first.
- Table share 2/9 = 22 %: does not fire.
- References slide present: paper up (already first).
- Two process slides of four steps each: chalk up one place, above night.
- The room is lit: night gets no lift.

Result: paper, alternatives chalk and night. The card says chalk would fit better if the audience
were students rather than practitioners.

## Step 4: the direction card

Write the card before the first slide and keep it with the task's notes. It is working evidence,
not slide content, and it is shown to the user only in summary unless they ask for it.

```text
DIRECTION
  deck type      research talk (연구 발표), industry seminar, 25 min, lit room
  delivery       presented; file shared afterwards
  tonality       paper            alternatives: chalk, night
  reason         figures and citations carry the talk; 33 % chart slides, references present
  signals        chart share, citations, teaching shape (moved chalk above night)
  dials          density 10, variance 5 (pack defaults)
  role map       content top-rule | data top-rule | data-takeaway bottom-anchor | definition side-rail
  families       cover-index, section-rule, text-column, method, figure-academic, chart-insight x2,
                 table-insight, comparison, closing-summary-list, references-appendix
  wrong if       the audience is students: chalk's step rhythm and definition boxes teach better
```

Every line is required. If you cannot fill `tonality` and `reason`, stop and ask; there is no
silent default look. The `wrong if` line is the first thing a reviewer checks: when it turns out to
be true, rebuild under the alternative it names rather than patching slides.

Copy the role map from the tonality sheet (`tonalities/<id>.md`). The engine may still give a slide
another treatment the family allows when that slide fills better under it, and the variety pass
may move one slide to add a layout; the compile log prints each move (`variety: slide 3 drawn
under bottom-anchor ...`) and a `Treatments:` line with the final choice per slide.

## Step 5: tell the user

In the reply, next to the delivered files, say the choice, the reason and the two alternatives in
plain words. Keep it short; the card itself stays in the notes.

> paper 톤으로 만들었습니다. 그림과 인용이 발표를 끌고 가는 자료라서입니다. 수강생 대상이라면
> chalk, 어두운 대강당이라면 night도 맞습니다.

> Built in Signal: a live pitch with one idea per slide. Studio would suit a slower editorial
> story; Atlas would suit a product that is mostly photographed.

Name sample data as sample data in the same reply when the deck uses any (see `notice:` in
`density-and-fill.md`).

## Dials

Two integers in the frontmatter override the pack defaults for one deck.

```yaml
density: 9
variance: 6
```

- **density** (1-10) chooses the grid, the type ramp, the gaps and padding, the minimum table row,
  and how much empty band a content slide may leave. Every pack defaults to 10, the compact step.
  For a deck projected to a room of more than about 40 people, lowering it to 8 or 9 (body 14 pt,
  dense grid) is the usual move. See `density-and-fill.md`.
- **variance** (1-10) caps how many distinct title treatments one deck mixes: 2 at variance 1-3,
  3 at 4, 4 at 5-6, 5 at 7 and above, never more than the pack lists. Variance under 4 is only for
  a user who asks for a uniform deck; the gate then reports the low variety as MEDIUM instead of
  passing it silently.

The skill may move either dial by at most 2 from the pack default without asking, and the card
records the move ("density 8, lowered 2 for a 300-seat hall"). A larger move needs the user's
word. `node <skill>/run.mjs compile` prints the dials it used on its first line
(`Tonality ledger · density 10 · variance 5 · 16:9 compact grid`); check that line against the card.

Two neighbouring keys are not dials but belong to the same decision:

- `canvas: 4:3` switches every pack to its 4:3 grid (all eight list both canvases);
- `faces: a2z` (or `--faces a2z`) switches the display and numeral faces to A2Z. Pretendard is the
  default in every pack, and A2Z is used only when the user asks for it.

## The compare strip

When the user wants to see options, render the first three slides of the same source under the
chosen pack and the two alternatives, and show the nine pages as three labelled rows before writing
the rest of the deck. The content and order are identical in every row; only the pack changes.

```sh
# strip.md: the deck's frontmatter plus its first three slides
for t in paper chalk night; do
  node <skill>/run.mjs compile strip.md --tonality "$t" --pptx "strip-$t.pptx"
  node <skill>/run.mjs qa "strip-$t.pptx"
done
# then render each strip deck to page images as the skill's render step describes, and show them
```

`--tonality` overrides the frontmatter, so one strip source serves all three rows. A strip of
three slides is below the gate's variety thresholds (OF-110 starts at eight slides, OF-111 at
three content slides), so the deck-level checks do not judge it; judge the strip by eye. Do not argue for a row in the message beyond the card's reason. When the
user picks, change the card's reason to "picked by the user from the strip" and build the deck.

Do not build a strip for a bare request. It is a response to an explicit wish to compare, not a
default step.

## Legacy templates

AZURE-PRO, AZURE-A2Z, BOILERPLATE-PRETENDARD and BOILERPLATE-A2Z keep their names and their single
look. Use one only when the user names it or an existing source already says `template:`. Compile
with `--template <NAME>`; a `title:` key on any slide is then an error, because a legacy template
has one title look. The gate treats a legacy deck's variety checks (OF-110, OF-111) and the label
check (OF-114) as MEDIUM: the user asked for one look, so low variety is reported, not failed. The
reply still names two tonalities as alternatives.

## Failure patterns this step prevents

- **Same pack for every topic.** If the last three decks in a session all compiled under one pack
  and the briefs differ, rerun step 3 honestly.
- **Pack picked for its colour.** The colour is the least important part of a pack. Choose by
  delivery, content shape and the families the outline needs.
- **A pack that cannot carry the outline.** Discovered at compile time as a log note such as
  `slide 6: table-insight is not a atlas layout family ... drawn with its own geometry`. That slide
  then borrows geometry from outside the pack; change the pack or the slide's job.
- **Silent dial moves.** A density of 6 written into the frontmatter without a card line is the
  same as a silent style change.
- **Asking instead of building.** A bare request answered with "which style do you prefer?" has
  failed the step.
- **Choosing by example deck.** The worked examples in `examples/` show what each pack looks like
  with real content; they are not templates to copy. Write the user's deck from the user's facts.

## Where to go next

- `tonalities/<id>.md`: what each pack is for, its role map, families and variants.
- `title-treatments.md`: the eight title treatments and how a slide gets one.
- `layout-families.md`: what each family holds and what the source must contain for it.
- `density-and-fill.md`: the density steps, readable floors, fill policies and what to write per
  slide so the gate passes on substance rather than padding.
- `examples/`: twelve compiled decks across all eight packs, each passing
  `node <skill>/run.mjs qa`.
