# Density and fill

LitOpenCode decks are dense by default. Every pack ships at density 10, the compact step, because
the user's standing verdict on earlier rounds was that slides held too little ("더 빽빽하게"). This
file explains what the density dial changes, the readable floors nothing goes below, what the
engine does when a slide comes out short, what the source has to contain so a slide fills with
substance, and how the gate measures the result.

The one-line rule: **fill a slide with facts the reader needs, never with size or decoration.**
The engine will not invent content and will not enlarge type on the compact step, so a short
source produces a visibly short slide and a gate finding. The fix is always in the source.

## The density dial

`density:` in the frontmatter (1-10) overrides the pack default for one deck. The skill may lower
it by up to 2 without asking (record it on the direction card); a bigger move needs the user's
word. Each step selects a row of `DENSITY_BANDS` in `scripts/lib/grid-resolver.js`:

| Density | Grid (16:9 side margin) | Ramp: body / label / source pt | Item / group / block gap | Padding | Min table row | Lines per text column | Empty band allowed | Type step-up to fill |
|---|---|---|---|---|---|---|---|---|
| 1-2 | airy (60) | presented: 18 / 14 / 12 | 18 / 36 / 48 | 24 | 36 | 6 | 28 % | yes |
| 3-4 | standard (48) | presented: 18 / 14 / 12 | 12 / 24 / 36 | 24 | 32 | 8 | 24 % | yes |
| 5-6 | standard (48) | reading: 14 / 12 / 10 | 6 / 18 / 24 | 18 | 24 | 12 | 18 % | yes |
| 7-8 | dense (36) | reading: 14 / 12 / 10 | 6 / 12 / 24 | 12 | 22 | 16 | 14 % | yes |
| 9 | dense (36) | reading: 14 / 12 / 10 | 6 / 12 / 24 | 12 | 20 | 18 | 12 % | no |
| 10 | compact (24) | compact: 13 / 11 / 9 | 6 / 12 / 18 | 12 | 18 | 22 | 12 % | no |

Titles stay at 26 pt (display 36, cover 44) from density 5 upward, so lowering density changes the
body, not the hierarchy. The compile prints the dials and grid it used on its first line:
`Tonality night · density 10 · variance 6 · 16:9 compact grid`.

### What the compact step adds

- **Grid.** On 16:9: 24 pt margins, twelve 54 pt columns, 24 pt gutters (24 + 12 x 54 + 11 x 24 + 24 =
  960). On 4:3: 24 pt margins, 45 pt columns, 12 pt gutters.
- **Title zone.** A top-rule title frame is as tall as its lines, its rule 6 pt under it, and the body
  18 pt under the rule, so a one-line title leaves the body from about y 92 instead of 120. A band
  keeps its 108 pt height and the body follows at 120. Side-rail and bottom-anchor are unchanged.
- **No type inflation.** Step-up is off: on density 9 and 10 the engine never sets body text a ramp
  step larger to fill space. Comparisons, headed rows and agendas stay at body size too.
- **More per slide.** KPI rows hold up to six figures; chart slides also show the chart's values as a
  small table where it fits; comparison rows draw a criteria column; process rows read across;
  references step down and run in two columns before they overflow.

### When to lower it

Lower to 8 or 9 (body 14 pt, dense grid) for a deck projected in a large room or read from the back
of a hall: a keynote over about 40 people, a classroom without individual screens. Keep 10 for
anything read on a screen or a desk, which is most decks. Never lower density to hide a thin
source; that only moves the empty band from the gate to the reader.

## Readable floors

Nothing on the compact step goes below these sizes, and nothing in a source can ask it to:

| Text | Floor | Compact size |
|---|---|---|
| Body text, takeaways, step text | 12 pt | 13 pt |
| Table cells, captions, labels | 11 pt | 11 pt |
| Source and note strip | 9 pt | 9 pt |

The engine reaches density by cutting margins, gaps and padding, not by shrinking type below these.
If a slide's content does not fit at these sizes, the engine first drops leads to body size and
gaps to the item gap; if it still overflows, the gate reports the overflowing frame and the slide
must be split or cut. Never use `::: box` with a tiny `role` to squeeze text in.

## The source strip

Any line in a content slide's text that starts with `출처:`, `자료:`, `주:`, `Source:` or `Note:` is
lifted out of the takeaways and set at the foot of the body at source size, full width, under a
hairline where the pack draws hairlines. The strip costs the takeaway column nothing and puts the
provenance where a reader looks for it.

- Write `출처:` / `Source:` on every content slide that carries a figure: who measured it, over
  what period, from which document.
- Add `주:` / `Note:` when a definition changes the reading: how a ratio is computed, what counts as
  a failure, which baseline a delta uses.
- Closings keep these lines inside their next-step device rather than in a strip.
- The strip text is 9 pt and the gate's empty-band check (OF-109) ignores text that small, so a
  strip does not count as filling the body. It is evidence, not filler.

## The sample-data notice

When any figure, name or photograph in the deck is invented or stands in for the real one, say so in
the frontmatter:

```yaml
notice: 예시 데이터 · 실제 수치로 바꿔 쓰는 샘플
```

The engine sets this line as a small tag in the footer zone of every slide, in the pack's colours.
Name the sample status in the reply as well. Never leave bracketed placeholders (a company name or "to be decided"
in square brackets) in a source; write a plausible labelled sample instead, or leave the item out.

## Fill policies: what the engine does with a short slide

After laying a content slide out, the engine measures the empty band between the last content and
the body floor. If it is larger than the band the density allows (12 % at density 10), it tries the
pack's `fill-order` one policy at a time, keeping a policy only when it fills more without
overflowing:

| Policy | What it does | On density 10 |
|---|---|---|
| `step-up` | Body text one ramp step larger | Off |
| `distribute` | Item gaps one step up (to at most 24 pt), group and block gaps one step up (to at most 48 pt) | On |
| `anchor-visual` | The chart, image or table takes the room left; a KPI card row turns into figure rows | On |
| `change-family` | A better family for the content | Never automatic; the log asks you to do it |

Each pack orders these differently. Ledger, gazette and chalk effectively spread first (their
`step-up` is off at density 10); atlas, paper and night let the visual take the room first; studio
lists a family change first and signal second; the engine never changes a family by itself, so
those two fall through to letting the visual take the room and then spreading. The compile log prints
one `fill:` line per slide that started short:

```text
fill: slide 4 band 0.29 -> 0.24 (distribute)
fill: slide 6 band 0.20 -> 0.20 (none: nothing on the slide can grow; choose a fuller family)
```

The second line is the important one. It means the slide is short because the source is short, and
no policy can help. Add the facts the slide is missing (next section) or move the content to a
family that suits its amount; `layout-families.md` lists what each family expects.

The title treatment never buys the body room: every treatment draws in the slide grid's one title
zone over the same body (y 120-486), so a short body is filled by its own layout, never by moving the
title. The engine never pads cards with filler. Decoration (the pack's list plus the deck's
`decoration:` kinds) adds texture and structure to a full slide; it never stands in for missing
content.

Some families also spread on their own when the body is short: headed points become rows, agenda
rows spread down to the floor, timeline room is shared above and below the axis, table takeaways
move under the table, references spread with rules. These moves never add words.

### A short column beside a full one

A column can stand empty beside a full one even when the body reaches the floor: two short
takeaways beside a chart, a source line at the column's foot and nothing between them. The engine
reads each text or picture column against the column beside it (its tallest empty band, from the
top of the pair down to where the longer column ends) and fills a column that leaves more than 40 %
of the body empty. It tries, in order, and only by layout:

1. The visual takes columns: the takeaway column narrows (down to three columns) and wraps onto more
   lines while the chart or picture grows; a picture keeps taking columns while either side leaves a
   fifth of the body empty. Takeaways never get a smaller size for it.
2. The points step up to lead size when they fit and keep twelve glyphs a line.
3. The room left is shared between the points, at most a sixth of the body per gap.
4. Two or three short points beside a chart that still leave the column empty run under the chart,
   side by side, and the chart with its values takes the body's width.
5. A short sidebar note first takes a narrower column at body size; if the main column still runs
   far past it, the note stands across the top at lead size and the main points run in two columns
   under it. Under a side title the note stands in the rail.
6. Beside figure rows (kpi-row, big-number) the takeaways' column is read down to the body floor,
   since the rows stop where their spacing ends: short points run under the rows, or share the room
   beside them when running under would leave a band between rows and points.
7. A title under which a column still stays empty is unfit for the slide when another title fits.

The source strip closing a column counts as a block but never hides the band above it, and the
chart's values table under the takeaways moves and is read with their column. The gate reads the
same way (OF-115). When a slide still fails, the source is short: one more real takeaway,
the values the chart stands on, or a family that suits the amount.

## What to write per slide

A dense slide is a slide that answers the reader's next question before it is asked. For every
content slide, check the source holds these five things; most short slides miss two of them.

1. **Basis.** What the number is measured on: per building, per 1,000 kg of water, at 0.1 MPa,
   weighted by effort, a 1 % request sample.
2. **Comparison.** Against what: plan, last year, the previous quarter, a target, the other option,
   the baseline model.
3. **Period.** When: 2026년 7~9월, weeks 35-40, January to September, as of 30 September.
4. **Source.** Who produced it: the `출처:` / `Source:` line.
5. **Implication.** What it means or what happens next: the takeaway, the decision it supports, the
   follow-up date.

Counts that make a slide read as finished at density 10:

| Element | Target |
|---|---|
| KPI row | 4-6 figures, each with a basis row (`계획 대비 +4.1%`, `target 99.95%`) |
| Table | 5-8 body rows, a totals row where the rows add up |
| Comparison | 3-4 labelled criteria rows, the same labels on both sides |
| Chart | 5-9 categories, a caption, 2-4 takeaways, a source line |
| Timeline | 5-6 events with owners, 2-3 takeaways |
| Text slide | 5-6 headed points or 4-6 groups with sub-points |
| Method | a formula line plus 4-5 terms with one or two sub-points each |
| References | 8-10 entries, sources then definitions |
| Closing | 3-5 asks or decisions with amounts or dates and owners |

### A short slide and the same slide filled

Short (compiles, but the band is empty and the reader has questions):

```text
---
layout: chart-insight

## 월별 출고 건수

::: chart type=column
| 월 | 출고 |
|---|---|
| 7월 | 131 |
| 8월 | 137 |
| 9월 | 144 |
:::

- 출고가 늘었음
```

Filled (same slide job; every added line comes from the source material, none from imagination):

```text
---
layout: chart-insight

## 월별 출고 건수, 2025년과 2026년 비교

::: chart type=column unit="만 건"
| 월 | 2025년 | 2026년 |
|---|---|---|
| 7월 | 118 | 131 |
| 8월 | 124 | 137 |
| 9월 | 133 | 144 |
> 월별 출고 건수, 2025년과 2026년 비교 (예시 데이터)
:::

- 세 달 모두 전년보다 8~11% 많았고, 9월이 분기 최대
- 9월 증가분의 70%가 이천 센터 자동 분류기 가동 뒤 처리량
- 4분기 성수기에는 평시의 1.6배까지 늘어날 전망
- 출처: 예시 물류 WMS 출고 실적(2025년 7월~2026년 9월)
- 주: 출고 건수는 반품 재출고를 제외한 주문 기준
```

The first version also breaks two rules on its own: the title has no comparison or period, and the
takeaway is a bare claim (`늘었음`) with no figure.

### Numbers stay honest

- No hero numerals. The hero step belongs to cover, section and statement titles that fit it. The engine
  caps every number it sets (KPI values, big-number panels, cover figures, closing keys, section
  numerals) at the title size of the ramp; do not try to get around that with a `box` or `shape`.
- A figure is never larger than the title, and a figure without a basis is not a KPI.
- Signed deltas carry their sign and unit (`+4.1%`, `−3.6%`, `+0.5%p`, `▲ 12%`). In signal, where
  the accent is red, losses keep the ink colour and rely on the `▼` sign.
- Keep one unit per column; put the unit in the header or the chart's `unit=`.
- Round to what the source supports and keep the rounding consistent within a slide.

## How the gate measures density

`node <skill>/run.mjs qa deck.pptx` reports three density-related findings. Only HIGH findings and
the composition failure fail the gate; read the MEDIUM ones as a to-do list.

- **OF-109, empty band (per slide).** The largest vertical gap between content blocks on a content
  slide, measured from under the title to 0.55 in above the bottom edge (or above a bottom title),
  ignoring text of 10.5 pt or less, which means the source strip and captions do not count. A gap of
  25 % or more is MEDIUM, over 35 % is HIGH. Cards are measured the same way inside themselves.
  Typical causes: a method slide with three short terms, a sidebar-note with six lines of main text,
  a closing summary with four one-line items, a timeline with one takeaway.
- **OF-112, deck median band.** Each content slide's empty band against the density's cap (12 % at
  density 10) is MEDIUM; a deck whose median band exceeds 20 % fails.
- **Composition fill (`low_content_fill`).** An older whole-slide check: on every slide except the
  first and the last, the area of text, tables, charts and pictures that start between 1.7 in and
  6.7 in from the top must cover at least 12 % of the content area. Blocks that start higher than
  1.7 in are not counted at all. On the compact step a top title's body starts near 1.3 in, so a
  slide whose table and takeaways both start at the top can fail even when it looks full. The
  remedies that worked on the example decks:
  - give a `table-insight` slide three or four takeaways, so they either run beside the table at
    length or move under it in two columns;
  - give a `ledger-table` slide three or four takeaways under the table;
  - give a mid-deck `statement` slide its one support line;
  - give a `dashboard-grid` four panels, so the second row starts lower;
  - or put the title at the bottom (`title: bottom-anchor` where the pack allows it), since the
    bottom title itself is counted.

Other checks that interact with density: OF-102 flags a line measure over 38 Hangul or 90 Latin
characters (HIGH) or a narrow column under 10 characters a line over three lines (MEDIUM); OF-101
flags too many accent hues on one slide; the layout inventory flags any text frame whose estimated
text height exceeds the frame. Shorten the text; do not reach for smaller type.

## A density pass, in order

1. Compile. Read every `fill:` line ending in `none` and every `note:` line.
2. Run the gate. List OF-109 HIGH slides and any `low_content_fill` slides.
3. For each, add the missing basis, comparison, period, source or implication from the source
   material. If the material has nothing more, change the family to one that suits the amount
   (`layout-families.md`) or merge the slide with its neighbour.
4. Recompile and rerun the gate until it exits 0. MEDIUM findings may remain; HIGH may not.
5. Render and look at the pages. A passing gate is not a visual review.
