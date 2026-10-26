# Title treatments

A title treatment decides how a slide's title looks: how large it is, what colour it takes and what
comes with it (a rule, a band, a rail, a numeral, a panel). The engine knows eight
(`scripts/lib/grid-resolver.js`, `TREATMENTS`). Each pack allows four or five of them, maps every
slide role to one default, and the renderer may pick another allowed one per slide when that slide
fills better under it. None of them moves the title: every content title sits in the slide grid's one
title zone (`scripts/lib/slide-grid.js`: columns 1-10, y 36, 72 pt tall) and its body starts at y 120,
whichever treatment and whichever tonality draws it; a statement sits in the display title zone. The
deck gets its variety from three to five treatments for different slide jobs, and a reader never has
to look for the title.

This file covers what each treatment draws, which packs allow it, how a slide gets its
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

Geometry is in points on the 16:9 canvas (12 columns, 24 pt margins, 78 pt pitch); the 4:3 canvas keeps
the same y values. The density dial changes type and spacing inside the zones, never the zones. Glyph
budgets are for Korean at the presented ramp, with the reading ramp in brackets; Latin text takes about
twice as many characters.

| Treatment | Title | Comes with | Body | Fits | Budget |
|---|---|---|---|---|---|
| `top-rule` | the title zone, title size | a short accent rule or a full hairline 4 pt under the title's last line | y 120-486 | content and data pages that are read | two lines of about 23 glyphs (29) |
| `top-plain-large` | the title zone, display size | nothing | y 120-486 | comparison, image-split, pages that open on one claim | one line of about 17 glyphs (two of 21) |
| `side-rail` | the title zone, title size | a bar in the left margin: the page's full height in the rail colour when the pack fills its rail, else as tall as the title zone in the accent | y 120-486 | a chart or picture with its takeaways, a comparison with labelled criteria | as `top-rule` |
| `band` | the title zone, title size, in the on-field colour | the field colour from the page's top edge to the title zone's foot (y 108) | y 120-486 | Korean briefing pages, data pages, a newspaper masthead | as `top-rule` |
| `statement` | the display title zone (columns 1-9, y 132-348), display or hero size, centred | an optional support line in the support zone (y 372) | none: the text is the content | a pull quote, or a display-led deck the user asked for | three lines of about 15 glyphs |
| `overlay` | a dark panel at the lower left over a full-bleed picture | the panel at 88 % opacity, a caption on it | none: the picture is the content | full-picture slides | two lines of about 15 glyphs |
| `kicker-numeral` | the title zone, title size | the numeral at cover size in the aside zone right of the title (columns 11-12), in the accent colour; the part number, never an agenda's row count | y 120-486 | steps, numbered recommendations | as `top-rule` |
| `bottom-anchor` | the title zone, title size | a heavy rule (2 to 4 pt) across the columns at the zone's foot | y 120-486 | chart-led, figure-led and big-picture slides | as `top-rule` |

Over budget, the engine moves the slide to another allowed treatment and says so in a `note:` line;
a `title:` key that asks for an over-budget treatment stops the compile, because a pinned choice
that cannot hold the title is an authoring error. Shorten the title or pick another treatment.

Details that decide a choice:

- **kicker-numeral.** The engine supplies the number; you never type it. On an `agenda` slide it is
  never used: the rows are numbered, and a count beside the title read as a stray section number
  (OF-119). On a content slide that follows a section slide it is that section's part number (taken
  from the agenda position when the section title matches an agenda entry, otherwise counted).
  Closings never take it, and a slide with no such number cannot be drawn under it, so slides before
  the first section never show it. A deck with an agenda and no section therefore has one treatment
  fewer to mix; open a part when OF-110 asks for a third.
- **statement.** No table, chart or image on the slide and at most one text block besides the title.
  A slide that breaks this falls back to another treatment. A statement is a pull quote or the one
  framing line of a live pitch; a claim is not a slide title, so most decks need none. In ledger and
  gazette a `statement` slide is drawn as the largest top title the pack has, and the compile log
  notes it. Studio frames it between two hairlines on the open page (`display.statement: rules`).
- **overlay.** Only on a slide with an image, and only in the `image-full` family, which takes no
  other treatment. The image's alt text becomes the numbered caption. Contrast is judged on the
  panel, never on the photograph.
- **bottom-anchor.** The upper part must be a visual (chart, table, image or KPI row), or the slide
  must hold at most one text block; a text-only slide with several blocks cannot take it. The visual
  gets the body's full height under the title.
- **side-rail.** What belongs beside the title (a comparison's criteria labels, a chart's takeaways,
  the source and note) is set in the body, level with its rows. A bar in the left margin marks the
  title; it carries no text.

Never move a title by hand with a free box: the zone is the slide grid's, and a nudged title breaks
the one place every theme keeps.

## Which packs allow what

| Treatment | ledger | signal | atlas | chalk | paper | gazette | studio | night | computational-brutalism | neo-brutalism | bauhaus | riso | newsroom |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| top-rule | yes | yes | | yes | yes | yes | | | yes | | yes | | yes |
| top-plain-large | | yes | yes | | | | yes | yes | yes | yes | | yes | |
| side-rail | yes | | yes | yes | yes | yes | yes | yes | yes | | yes | yes | |
| band | | | | | | yes | | yes | | yes | | yes | yes |
| statement | | yes | yes | yes | yes | | yes | yes | yes | yes | yes | yes | yes |
| overlay | | | yes | | | | yes | | | | | | |
| kicker-numeral | yes | | | yes | | yes | | yes | | yes | yes | yes | yes |
| bottom-anchor | yes | yes | yes | | yes | | yes | | yes | yes | yes | | yes |

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
   `top-rule`, Chalk sets its criteria as row heads in the body under a `side-rail` title; that title holds even when
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
- **OF-111.** Content slides vary their composition: the title treatment times the body's column
  partition (one, two-even, two-asym, three, grid, full-bleed) must reach about 60 % of the
  content-slide count in distinct values (capped at five), and no one layout may cover more than
  40 % of the content slides.
- **OF-113.** Every content title keeps one frame and every statement keeps the display frame
  (x, y, width, height within 1 pt), whatever its treatment. A title over a full-bleed picture keeps
  its own panel. Never position a title by hand with `::: box`; the frame will drift and the check
  fails.
- **OF-114.** Titles and the cover subtitle are labels, as described at the top of this file.
- **OF-115.** A text or picture column of a two-column body fails when its tallest empty band, from
  the top of the pair down to where the longer column ends, passes 40 % of the body (a source strip
  at its foot counts as a block but does not hide the band above it). A takeaway column that stops
  short of the visual beside it, a title panel taller than its text and a plate under an empty page
  fail too.
- **OF-116.** `node <skill>/run.mjs qa deck.pptx --sibling other.pptx` compares two tonalities of
  one source: every slide must place its title frame and its body's top-left corner in the same
  spot. A tonality changes the look and never the place.
- **OF-118.** A point that opens with a bold label and runs on in regular weight keeps a separator
  after the label (`**요약:** …`). The compiler adds the colon when the source leaves it out, so this
  fires on a label set by hand.
- **OF-119.** An agenda title stands without a numeral beside it; the agenda's rows carry the numbers.

## Choosing well

- Let the roles do the work. A deck whose slides have real jobs (a table slide, a chart slide with a
  takeaway, an agenda, a process) gets its variety from the pack's role map without any `title:`.
- Keep titles inside the two-line budget of the title zone; a longer one moves the slide to another
  treatment, and a pinned one stops the compile.
- Use bottom-anchor when the visual is the evidence and the heavy rule closes the label: a big
  chart, a photo pair, a KPI row. A data slide with a takeaway reads best under it or side-rail.
- A claim is not a title. It opens the body under a label; `statement` stays for pull quotes. A
  sequence wants kicker-numeral only when the number is real, and Korean briefing pages use band.
- Do not chase five treatments. Three or four that each mean something are better than five that
  vary for their own sake.
