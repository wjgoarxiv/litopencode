# Night

Night is a stage screen in a dark room. A near-black blue ground, off-white type, an amber accent and
a soft blue second series, light numerals and big charts. It is the only dark pack, and a Night deck
is dark from cover to closing. Pack file: `templates/tonalities/night/pack.yaml`.

## Use it for

- Data and technical keynotes in a dark hall or on a large stage screen.
- Data reviews presented to a room: reliability, forecasting, analytics, operations metrics.
- Demo days and engineering all-hands where charts carry the talk.

## Wrong for

- Anything printed or read on paper: a dark ground wastes toner and loses contrast in print.
- Decks that mix dark and light slides: Night never mixes.
- Photo-led showcases: Night lists no image family.
- Long-form Korean reading briefs: gazette.

## Palette roles

| Role | Colour | Used for |
|---|---|---|
| ground | near-black blue `#0F1419` (never pure black) | every slide |
| surface | dark slate `#1A222B` | table header, rail, panels |
| ink / ink-muted | off-white `#E8EDF2` / blue-grey `#A3AEBA` | text |
| line | slate grey `#5A6672` | hairlines |
| accent | amber `#E3A857` | the highlighted series or figure |
| accent-deep / accent-tint | pale amber `#F2C98A` / dark umber `#2A2418` | emphasis text / protagonist row and number tint |
| field / on-field | deep blue slate `#1E2A36` / white | header band, section field |
| positive / negative | soft green `#6CC08B` / soft coral `#F08A7E` | signed deltas |
| series | amber, soft blue `#7FB8E0`, blue-grey, lilac | chart series |

## Type

Pretendard throughout. Compact ramp at density 10; display tracks tight (−2); figures tabular. On a
dark ground thin light type below 18 pt is avoided, which is why Night never uses a light weight.

## Dials

Density 10, variance 6: up to four of its five treatments. For a large keynote hall, density 8
(body 14 pt) is the usual card move.

## Title treatments by role

| Role | Default treatment |
|---|---|
| content | top-plain-large |
| data | band |
| data-takeaway | side-rail |
| sequence | kicker-numeral |
| image | top-plain-large |
| statement | statement |
| reference | band |
| definition | side-rail |

Treatments: top-plain-large, statement, side-rail, kicker-numeral, band. The band is the deep blue
slate field across the top. The statement is drawn `open` on the dark ground.

## Families and variants

Families: full-chart, chart-insight, kpi-row, kpi-over-chart, dashboard-grid, big-number, method,
comparison, timeline, statement.

Covers: cover-numeral (a year in the title or date; the cover device is `numeral`),
cover-typographic, cover-figures (needs a KPI table in the deck). Sections: section-numeral,
section-field. Closings: closing-statement, closing-decision-box.

Display devices: cover `numeral`, statement `open`, big number on a tint, closing step in a `band`.

## Tables and charts

- Tables `header-fill`: dark slate header with off-white labels, row rules, no banding, numbers
  right-aligned, totals bold, the protagonist row tinted umber.
- Charts: hairline gridlines, direct labels, amber on one series with the rest muted, annotation on.
  Charts are drawn native and editable, with the pack's body face named for Hangul axis labels.
  The amber goes to the current series: the latest period, else the measured series over its plan
  or target, else the last.
- Images: side bleed only, crop allowed, no frame.
- Figures brought in as pictures: a chart or diagram exported on white stands here as a white card
  with small grey labels. Put its dark variant beside it, named with `.dark` before the extension
  (`assets/flow.png` and `assets/flow.dark.png`); Night draws the variant at full size, and the gate
  fails a mostly-white figure on the dark ground (OF-117). Better still, give the numbers as a table
  and let the engine draw a native chart.

## Decoration vocabulary

header-band, hairline-rule, numeral, rail-fill. No glows, no neon, no saturated gradients.

## Fill behaviour

`fill-order`: anchor-visual, step-up (off at density 10), distribute, change-family. Charts take the
room first, which suits the pack.

## Writing for Night

- Lead with a KPI row of five figures with basis lines, or a `kpi-over-chart` that puts the trend
  under the figures.
- Use `dashboard-grid` with four panels when several small breakdowns belong together (by cause, by
  severity, by region, by quarter).
- A `method` slide with a formula reads well under the band treatment (`title: band`): the formula
  across the top, the terms in two columns. Give it five terms with sub-points.
- Keep one accent per chart: amber marks the series the slide is about.

## Avoid

- Neon or saturated glows.
- A pure black ground.
- Light slides mixed in.
- Thin light type below 18 pt.

## A sample fragment

```text
---
tonality: night
title: Search ranking quality review 2026
date: 2026-10-06
notice: Sample data
---
layout: kpi-over-chart

## Ranking quality, January to September

| NDCG@10 | Click-through | Zero-result rate | p95 latency | Queries a day |
|---|---|---|---|---|
| 0.612 | 31.4% | 2.1% | 186 ms | 4.8M |
| was 0.574 | was 28.9% | was 3.6% | target 200 ms | up 12% |

::: chart type=line unit="NDCG@10"
| Month | New ranker | Old ranker |
|---|---|---|
| Jan | 0.578 | 0.574 |
| Mar | 0.589 | 0.571 |
| May | 0.597 | 0.569 |
| Jul | 0.606 | 0.570 |
| Sep | 0.612 | 0.568 |
> NDCG@10 on the weekly judged query set (sample data)
:::

- Source: Example Search offline evaluation, 2,000 judged queries a week
- Note: NDCG@10 scores the top ten results against human relevance labels
```

## Examples

- `examples/08-reliability-keynote-night-en.md`: English platform reliability keynote, 9 slides.
- `examples/11-forecast-review-night-ko.md`: Korean electricity demand forecast review, 8 slides.
