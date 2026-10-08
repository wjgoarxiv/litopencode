# Title treatments

A title treatment answers four questions at once: where the title sits, how large it is set, what
is drawn with it, and where the body starts. The engine knows eight treatments
(`scripts/lib/grid-resolver.js`, `TREATMENTS`). Each pack allows four or five of them, maps every
slide role to one default, and the renderer may pick another allowed one per slide when that slide
fills better under it. A deck therefore mixes several title looks, but every slide that uses one
treatment puts its title in exactly the same frame.

This file covers the geometry of each treatment, which packs allow it, how a slide gets its
treatment, the per-slide `title:` key, and what the gate checks.

## Titles name a topic

Before geometry: every title and the cover subtitle is a noun-phrase label, never a sentence.

- Korean titles do not end in a sentence ending: no -다, -니다, -요, -죠, and no nominalised claim
  in -함, -됨, -음 (for example -었음, 있음).
- English titles carry no finite verb (is, are, was, has, will, grew, rose, fell, leads, beats,
  shows ...) and no closing period.
- A title ending in a question mark is not judged as a claim, and neither is a title that opens
  with a quotation mark, which is how a quote slide stays legal (see `quote` below).
- A trailing parenthesis is ignored when the gate reads the ending, so `(예시)` does not rescue a
  sentence.

| Sentence (fails OF-114) | Label (passes) |
|---|---|
| 김포 센터의 처리비가 가장 높다 | 거점별 건당 처리비 비교 |
| 오출고율이 크게 개선됨 | 분기별 오출고율 추이 |
| APAC latency fell by 100 ms | p99 latency by region, January to September |
| Config changes cause most incidents. | Incidents by root cause |

The claim moves into the slide: the first takeaway, a caption, or a `key-message` box. The gate
reports a sentence title as OF-114 HIGH under a tonality pack.

## The eight treatments

Positions below are for the 16:9 canvas on the compact grid that density 10 uses: 24 pt side
margins, 12 columns 54 pt wide with 24 pt gutters, so column *a* starts at 24 + 78(*a* − 1) pt and a
span of *n* columns is 78*n* − 24 pt wide. The canvas is 960 x 540 pt; the content floor is y 486.
On the 4:3 canvas the same column spans apply to its own grid. Sizes are steps of the compact ramp:
title 26 pt, display 36 pt, cover 44 pt.

### top-rule

- **Geometry.** Title across columns 1-12 at y 36, set at title size, one or two lines; the frame is
  exactly as tall as its lines. A rule sits 6 pt under the frame: a short accent bar one column wide
  and 4 pt thick in packs that list `accent-rule`, otherwise a 0.75 pt hairline across the full
  width. The body starts 18 pt under the rule, so a one-line title gives a body from about y 92.
- **Budget.** Two lines at most. On 16:9 one line holds roughly 33 Hangul or 60 Latin characters.
- **For.** The workhorse for content, data and reference slides that read top to bottom.
- **Packs.** ledger, signal, chalk, paper, gazette.

### top-plain-large

- **Geometry.** Title across columns 1-10 at y 36, at display size, no rule. One line takes a 54 pt
  frame, two lines 102 pt (each with a little extra for descenders). The body starts 18 pt under it.
- **Budget.** Two lines; about 21 Hangul or 38 Latin characters per line.
- **For.** Slides read at a distance: image splits, comparisons, KPI rows and timelines in packs
  built for rooms.
- **Packs.** signal, atlas, studio, night.

### side-rail

- **Geometry.** Title in columns 1-4 from y 36, at title size, up to four lines; the frame keeps one
  spare line so a rebalanced break never clips. Packs with `rail-fill` paint the rail from the
  canvas edge to half a gutter past column 4 (in chalk the rail is the dark field with a white
  title; elsewhere the light surface colour). Packs without it but with `hairline-rule` draw a
  0.75 pt line at the rail edge instead. The body is columns 5-12, starting level with the title.
- **Budget.** Four lines of a narrow measure: about 10 Hangul or 18 Latin characters a line.
- **For.** A data slide with its takeaway, a definition or method page, an editorial text page.
- **The rail under the title.** The rail carries what belongs beside the title: a comparison's
  criteria labels, level with their rows; a chart's, table's, figure's or picture's takeaways; the
  source and note at the rail's foot. A slide that would leave more than 40 % of the rail empty
  takes another treatment unless the source pins `title: side-rail`, and the gate reports a pinned
  rail left empty (OF-115).
- **Packs.** ledger, atlas, chalk, paper, gazette, studio, night.

### band

- **Geometry.** A field-coloured band across the whole canvas from y 0 to 108. The title sits in it
  across columns 1-11 at y 36, in the on-field colour. The body starts at y 120 on the compact step.
- **Budget.** Two lines, a little narrower than top-rule.
- **For.** Pages read like a document: Korean briefing pages, agenda pages, reference pages, and the
  data pages of a dark keynote.
- **Packs.** gazette, night.

### statement

- **Geometry.** The sentence or label itself is the slide: display size across columns 1-10, set in
  balanced lines and centred on the body's vertical middle. Studio frames it between two hairlines
  on the open page (its `display.statement: rules`). One support line may follow 24 pt below, in the
  muted ink. There is no body zone.
- **Budget.** Three lines.
- **When it can be drawn.** No table, chart or image on the slide, and at most one text block
  besides the title. A slide that breaks this falls back to another treatment.
- **For.** Pull quotes and the one framing line of a live pitch. Since the user's verdict on
  density, a claim is not a slide title; most decks need no statement at all.
- **Packs.** signal, atlas, chalk, paper, studio, night. In ledger and gazette a `statement` slide is
  drawn as the largest top title the pack has, and the compile log notes it.

### overlay

- **Geometry.** A picture fills the canvas edge to edge, cropped to its own proportions. A dark
  panel at 88 % opacity covers the lower left, from the canvas edge to just past column 7 and from
  y 324 to 516; the title sits in it at y 348, columns 1-7, in the on-field colour. Contrast is
  judged on the panel, never on the photograph.
- **Budget.** Two lines; about 19 Hangul or 34 Latin characters per line.
- **When it can be drawn.** Only on a slide with an image, and only in the `image-full` family,
  which takes no other treatment. The image's alt text becomes the numbered caption.
- **Packs.** atlas, studio.

### kicker-numeral

- **Geometry.** A real number at cover size in the accent colour sits in columns 1-2 at y 36; the
  title runs beside it in columns 3-12 at y 48, at title size. The body starts at y 120.
- **Budget.** One line only.
- **Where the number comes from.** The engine supplies it; you never type it. On an `agenda` slide it
  is never used: the rows are numbered, and a count beside the title read as a stray section number
  (OF-119). On a content slide that follows a section slide it is that
  section's part number (taken from the agenda position when the section title matches an agenda
  entry, otherwise counted). Closings never take it. A slide with no such number cannot be drawn
  under kicker-numeral, so slides before the first section never show it. A deck with an agenda and
  no section therefore has one treatment fewer to mix; open a part when OF-110 asks for a third.
- **For.** The opening slide of a numbered part.
- **Packs.** ledger, chalk, gazette, night.

### bottom-anchor

- **Geometry.** The title closes the page from below: columns 1-9 at title size, up to two lines,
  its last line standing on the body floor (y 486), so a one-line title starts lower than a
  two-line one. The 0.75 pt hairline across the width sits 12 pt above the title in packs that draw
  hairlines, and the visual zone runs from y 36 down to 24 pt above the title: what a short title
  does not use goes to the visual. The three columns beside the title stay empty by design.
- **Budget.** Two lines; about 25 Hangul or 45 Latin characters per line.
- **When it can be drawn.** The upper part must be a visual (chart, table, image or KPI row), or the
  slide must hold at most one text block. A text-only slide with several blocks cannot take it.
- **For.** Chart-led, figure-led and photo-led slides where the picture comes first.
- **Packs.** ledger, signal, atlas, paper, studio.

## Which packs allow what

| Treatment | ledger | signal | atlas | chalk | paper | gazette | studio | night |
|---|---|---|---|---|---|---|---|---|
| top-rule | yes | yes | | yes | yes | yes | | |
| top-plain-large | | yes | yes | | | | yes | yes |
| side-rail | yes | | yes | yes | yes | yes | yes | yes |
| band | | | | | | yes | | yes |
| statement | | yes | yes | yes | yes | | yes | yes |
| overlay | | | yes | | | | yes | |
| kicker-numeral | yes | | | yes | | yes | | yes |
| bottom-anchor | yes | yes | yes | | yes | | yes | |

## How a slide gets its treatment

Each layout family has a slide role and a list of treatments its geometry can take
(`FAMILIES` in `grid-resolver.js`). The roles are content, data, data-takeaway, sequence, image,
statement, reference and definition. A `comparison` counts as data when its text is dense with
figures (about one digit in 25 characters) and as content otherwise. A closing is a content slide
whose title names the ask, so it takes only top-rule, band or top-plain-large; `closing-statement`
takes only statement.

The choice runs in three passes.

1. **Resolver.** For every content slide the candidates are the pack's own title for the slide's
   family when its `structure:` map names one (Paper draws a comparison as a ruled table under
   `top-rule`, Chalk sets its criteria on the board rail under `side-rail`; that title holds even when
   the deck already leans on it, so two tonalities of one source differ in structure and not only in
   colour), else the pack's default for the slide's role; then the pack's other treatments that the family allows and that can be drawn on this
   slide (title within budget, numeral available, image present, statement conditions met).
2. **Renderer.** Each candidate is laid out and measured. The role default stays when its body fills
   to the density band, it is not the previous slide's treatment, and it has not yet covered about a
   third of the deck (at least three slides). Otherwise the candidate with the smallest empty band
   wins, with small penalties for repeating the previous slide or a treatment the deck already leans
   on. The variance dial stops new treatments once the deck reaches its maximum.
3. **Variety pass.** On a deck of eight or more slides at variance 4 and up, the engine makes sure
   at least three treatments appear, that no title zone (top, side, band, bottom) covers more than
   40 % of the content slides, and that the deck carries enough distinct layouts for OF-111. Each
   move is printed: `variety: slide 3 drawn under bottom-anchor so no title zone covers more than
   40 % of the content slides`.

The last compile line lists the outcome, for example
`Treatments: 2:top-rule 3:top-rule 4:top-rule 5:top-rule 6:top-rule 8:side-rail 9:bottom-anchor`.
Covers and sections are absent from it: they draw their variant's own title.

## The per-slide `title:` key

Put `title:` on the line after `layout:` to fix one slide's treatment:

```text
---
layout: chart-insight
title: bottom-anchor

## 월별 출고 건수, 2025년과 2026년 비교
```

The key set after `layout:` is closed: only `variant` and `title` are read, and the run of keys ends
at the first blank line or the first line that is not one of them. A mistyped key stays visible in
the body instead of being swallowed. The value must pass four checks or the compile stops with a
message naming the problem:

- it is one of the eight treatments;
- it is one of the pack's treatments;
- the slide's family allows it;
- it can be drawn on this slide (budget, numeral, image, statement conditions).

A cover or section slide rejects `title:` because its variant owns the title, and a legacy template
rejects it because it has a single title look.

Use the key sparingly and for a reason you can state:

- the gate reports OF-111 (too few layouts, or one layout over 40 % of the content slides) and a
  different treatment on one repeated slide fixes it;
- a comparison of two argued options reads better across the page under a top title than squeezed
  beside a rail (under a top title its labelled rows form a criteria grid);
- a table slide's takeaways are too short to sit beside it and you want the title below the table.

The examples in `examples/` use the key where the first compile showed one of these problems.

## Reading the compile log

| Log line | Meaning | Action |
|---|---|---|
| `note: slide 7: the title is longer than the top-rule budget; shorten it` | No allowed treatment fits the title, so the first one is used anyway | Shorten the label; move detail into the first takeaway |
| `note: slide 4: ledger has no statement title, so the sentence is drawn as a top-rule title` | A statement slide in a pack without the statement treatment | Accept it, or turn the slide into a content family |
| `variety: slide 5 drawn under top-plain-large so the deck carries 5 layouts` | The variety pass moved a slide | None; check the slide visually |
| `Slide 3: title "overlay" is not one of the ledger treatments (...)` | A `title:` value outside the pack | Pick one of the listed treatments |
| `Slide 6: the comparison family does not take "statement"; it allows ...` | A `title:` value the family cannot draw | Pick from the listed ones |

## What the gate checks

`node <skill>/run.mjs qa deck.pptx` prints JSON; any HIGH finding fails the gate. Six of its
deck-level checks concern titles:

- **OF-110.** The treatment is read from the title frame's geometry and what is drawn around it,
  then compared with the name the compiler wrote on the shape (`title@side-rail`). A mismatch is
  HIGH. A deck of eight or more slides must use at least three treatments, and no more than the
  variance allows.
- **OF-111.** Content slides vary their composition: the title zone times the body's column
  partition (one, two-even, two-asym, three, grid, full-bleed) must reach about 60 % of the
  content-slide count in distinct values (capped at five), and no one layout may cover more than
  40 % of the content slides.
- **OF-113.** Every slide that uses a treatment keeps the same title frame (x, y, width, size).
  A bottom title keeps its bottom edge instead of its top, which moves with the line count. Never
  position a title by hand with `::: box`; the frame will drift and the check fails.
- **OF-114.** Titles and the cover subtitle are labels, as described at the top of this file.
- **OF-115.** A bottom title whose last line ends more than 12 pt above the body floor, and a side
  rail more than 40 % empty under its title, fail. What stands in the rail under the title is the
  rail's: it neither changes the side-rail reading nor counts as a column of the body (OF-111).
  A text or picture column of a two-column body fails too when its tallest empty band, from the top
  of the pair down to where the longer column ends, passes 40 % of the body; a source strip at its
  foot counts as a block but does not hide the band above it.
- **OF-116.** `node <skill>/run.mjs qa deck.pptx --sibling other.pptx` compares two tonalities of
  one source: at least two content slides (one on a deck of fewer than four) must take another title
  zone or column partition.
- **OF-118.** A point that opens with a bold label and runs on in regular weight keeps a separator
  after the label (`**요약:** …`). The compiler adds the colon when the source leaves it out, so this
  fires on a label set by hand.
- **OF-119.** An agenda title stands without a numeral beside it; the agenda's rows carry the numbers.

## Choosing well

- Let the roles do the work. A deck whose slides have real jobs (a table slide, a chart slide with a
  takeaway, an agenda, a process) gets its variety from the pack's role map without any `title:`.
- A short title in a side rail reads as a design choice; a long one reads as a squeezed column.
  Keep rail titles to eight Korean words or fewer.
- Use bottom-anchor when the visual is the evidence and the label names it after the reader has
  looked: a big chart, a photo pair, a KPI row.
- Do not chase five treatments. Three or four that each mean something are better than five that
  vary for their own sake.
