# Signal

Signal is a talk where every slide says one thing at size. A white ground, near-black type set
large, very few words per slide, and one hot red-orange accent reserved for the protagonist: the
product, the ask, the figure the room should remember. Pack file:
`templates/tonalities/signal/pack.yaml`.

## Use it for

- Investor and partner pitches, presented live in 10-15 minutes.
- Product launches and internal kick-offs where the speaker carries the detail.
- Proposal decks that must land three or four numbers and one ask.

## Wrong for

- Decks that are read later without the speaker: the large-type rhythm loses the reader. Use
  ledger or gazette.
- Table-heavy content: Signal lists `table-insight` but no `ledger-table`, `dashboard-grid` or
  `references-appendix`.
- Research talks with citations: paper.

## Palette roles

| Role | Colour | Used for |
|---|---|---|
| ground / surface | white / pale zinc `#F4F4F5` | background, quiet panels |
| ink / ink-muted | near-black violet-grey `#15131A` / grey `#55525C` | text |
| line | light zinc `#D4D4D8` | hairlines, table rules |
| accent | red-orange `#C8361A` | the protagonist only |
| accent-deep / accent-tint | dark rust `#6E1A0C` / pale coral `#FBE7E2` | deep text on tint / table protagonist row |
| field / on-field | red-orange / white | cover drench, number panel, split field |
| positive / negative | green `#1E7A3F` / ink | gains in green; losses stay in ink and carry `▼` |
| series | red-orange, ink, grey, slate blue | chart series |

Because the accent is red, a loss is never red here; write the sign (`▼ 4%`, `−4%`).

## Type

Pretendard throughout; A2Z only on request. Compact ramp at density 10 (body 13, title 26,
display 36). Display text tracks tighter (−2) than titles (−1); figures are proportional, which
suits large single numbers more than columns.

## Dials

Density 10, variance 6: up to four of its four treatments in one deck. For a large hall, lowering
density to 8 is a sensible move (record it on the card).

## Title treatments by role

| Role | Default treatment |
|---|---|
| content | top-plain-large |
| data | top-rule |
| data-takeaway | top-plain-large |
| sequence | top-rule |
| image | bottom-anchor |
| statement | statement |
| reference | top-rule |
| definition | top-rule |

Treatments: statement, top-plain-large, bottom-anchor, top-rule. Its top-rule draws a hairline
(the pack has no accent bar). The statement is drawn `open`: the sentence on the white ground, no
plate.

## Families and variants

Families: statement, big-number, image-split, asymmetric-feature, process, kpi-row, chart-insight,
full-chart, comparison, table-insight, quote.

Covers: cover-numeral (a year in the title or date), cover-typographic (drawn with the `drench`
device: the field over the whole page, title anchored low), cover-split-field. Sections:
section-field, section-numeral. Closings: closing-statement (no table or image), closing-ask.

Display devices: cover `drench`, statement `open`, big number on a `field` panel, closing step in a
`band`.

## Tables and charts

- Tables `open`: no header fill, rules at top and bottom only, no banding, numbers right-aligned,
  totals bold, and the protagonist row tinted pale coral.
- Charts: no gridlines, direct labels, the accent on one series and the rest muted, annotation on.
- Images may bleed and crop; no frame.

## Decoration vocabulary

colour-field, hairline-rule, numeral. No cards at all, no accent bar under titles.

## Fill behaviour

`fill-order`: step-up (off at density 10), change-family, anchor-visual, distribute. A short Signal
slide is a cue to pick a family that suits one idea (statement, big-number) rather than to stretch
a list.

## Writing for Signal

- One idea per slide, but the idea still has its basis: a big-number slide carries the basis row and
  three evidence lines; a KPI row carries five figures with their comparisons.
- A mid-deck statement slide needs its one support line, or the composition check reports the
  page as nearly empty.
- Keep bullet lists to four items; Signal's own avoid list says so.
- Two lines of display text at most per title.

## Avoid

- Red for losses (losses carry `▼` in ink).
- More than two lines of display text.
- Cards.
- Bullet lists longer than four items.

## A sample fragment

```text
---
tonality: signal
title: Fieldbook 2027 launch plan
date: 2026-10-06
notice: Sample data
---
layout: statement

# Site notes that file themselves

Photos, voice notes and measurements tagged to the drawing in under ten seconds
---
layout: big-number

## Time spent on site reports, before and after

| Report time | Rework requests | Photos filed | Adoption |
|---|---|---|---|
| 14 min | −61% | 98% | 83% |
| per visit, was 52 | after 3 months | to the right drawing | of pilot engineers |

- Pilot across 9 contractors and 140 engineers, May-September 2026
- Most time saved on matching photos to drawing references
- Source: Example Fieldbook pilot log, 2026
---
layout: closing-statement

## 400 sites by the end of 2027

Seed round of 3M USD, first close 15 December
```

## Examples

- `examples/02-launch-pitch-signal-en.md`: English hardware launch pitch, 10 slides.
- `examples/10-investor-pitch-signal-ko.md`: Korean software investor pitch, 9 slides.
