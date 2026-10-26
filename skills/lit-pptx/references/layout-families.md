# Layout families

A slide's `layout:` line names its family. The family decides what content the slide holds, how
the treatment's body zone is split into regions on the 12-column grid, and which title treatments
the slide may take. The engine knows 28 content families plus 9 cover, 6 section and 5 closing
variants (`FAMILIES` and `VARIANTS` in `scripts/lib/grid-resolver.js`). Each pack lists the ones it
draws; `node <skill>/run.mjs compile --list-layouts <tonality>` prints that list with the treatments
each family takes in the pack.

Use only the names in this file. An unknown name stops the compile with the full list. A known
family that the pack does not list still compiles, with a log note
(`slide 6: photo-grid is not a ledger layout family (...); drawn with its own geometry`), but it
then borrows geometry from outside the pack's design; treat the note as a sign the slide or the
pack is wrong.

## Source rules that apply to every family

- A slide starts with `layout: <family>`, optionally followed by `variant:` or `title:` lines, then a
  blank line, then the body. Slides are separated by a line holding only `---`.
- The first `#`, `##` or `###` heading is the title. Covers and sections use `#`; content slides `##`.
- A bullet that is only bold (`- **비용**`) opens a group; `(1)`, `(2)` lines under it are its
  sub-points. A bullet that starts with a bold head and continues (`- **입고** 납품 영수증 ...`) is a
  headed point; many families read the head as a label, a step name or a date. Write the colon after a
  run-in label (`- **요약:** 누리집에서 신청하면 …`): the compiler adds one when the label ends without a
  separator, because a bold word running into its sentence reads as part of it, and the gate fails a
  hand-set label without one (OF-118). A bold line with nothing after it opens a group and takes no
  colon.
- A line starting with `출처:`, `자료:`, `주:`, `Source:` or `Note:` is taken out of the takeaways
  and set as a source strip at the foot of the body (see `density-and-fill.md`). Closings keep
  theirs inside the next step instead.
- A pipe table is a table. `::: chart type=column|bar|line|area|pie|doughnut|stacked` around a pipe
  table is a native, editable chart (first column categories, one column per series;
  `unit="..."` states the unit once: as a level axis title, or nowhere on the axis when every series
  name in the legend already carries it). A series keeps one colour across the deck: alone on a chart
  it takes the colour it has beside the highlighted series elsewhere. `> ...` directly under a table or inside a chart fence is its
  caption, numbered automatically (`표 1.` / `Table 1.` for tables, `도 1.` / `Figure 1.` for charts
  and images; a number you type is replaced, not doubled).
- Body text and table cells that wrap are broken by the compiler at spaces: a number stays with its
  unit, and a short parenthetical such as `(▲ +3.9%)` (up to 16 characters) stays whole on its line.
- In the chart families (`chart-insight`, `full-chart`, `kpi-over-chart`, `dashboard-grid`) a plain
  pipe table whose data columns are all numbers over three or more rows is drawn as a chart anyway.
- `![caption](assets/example-a.png)` is an image; its alt text becomes its numbered caption. Paths
  resolve from the deck source's folder.
- `::: key-message` holds a lead sentence; `::: main-box` holds a boxed note; `::: notes` holds
  speaker notes that never appear on the slide.
- Cover slides accept only the title (and notes). A cover that shows a photograph takes the first
  image found anywhere in the deck; never put an image on the cover slide itself, the compile
  rejects it.
- Content slides accept titles, `key-message`, body text, `main-box`, tables, charts, images,
  captions and notes, plus the placement blocks `region`, `columns`, `box` and `shape` from
  `specs/markdown-slide-spec-v2.md`. Reach for `box` and `shape` last: a hand-placed box is never
  reflowed and the gate reports anything it covers.

## Text families

### text-column

- **Holds.** Running points, a short argument, a scope or method description.
- **Write it as.** Five or six headed points (`- **조사 기간** 2026년 9월 8~19일 ...`), or groups with
  sub-points, plus the source strip.
- **Behaviour.** Plain bullets keep a reading measure (about seven of twelve columns on the compact
  step) and leave the rest of the width empty. Two to five headed points that leave the body short
  run as rows instead, the head in its own column and the point beside it, spread down the page.
  Groups of sub-points under bold heads run in two columns. A slide that also holds a visual sets
  the visual on seven columns with the text beside it.
- **Packs.** atlas, chalk, paper, gazette. Legacy names `content` and `main` resolve here.

### text-two-column

- **Holds.** Two parallel halves of one argument: background and goals, scope and exclusions.
- **Write it as.** Four to six groups (`- **기획 배경**` with two or three `(1)` sub-points each).
- **Behaviour.** The groups are split at the group boundary nearest half the height, so each column
  starts with a heading. Too little text leaves both columns short; this family needs about 14
  lines a column at density 10.
- **Packs.** ledger, gazette, studio, computational-brutalism, bauhaus, riso, newsroom.

### summary-box-list

- **Holds.** The Korean briefing page: one boxed conclusion, then the itemised evidence (개조식).
- **Write it as.** A `::: key-message` with the one-line conclusion (up to three lines), then four to
  six headed groups with one or two sub-points each.
- **Behaviour.** The conclusion is set bold at lead size in an outlined box across the body (gazette
  draws the outline); the groups run in two columns under it. Without a key-message the first point
  becomes the box.
- **Packs.** gazette, neo-brutalism, riso.

### sidebar-note

- **Holds.** A main explanation with a fenced aside: a definition, a tip, the common mistake.
- **Write it as.** The main text (groups or headed points, ideally 14 lines or more), then
  `::: main-box` with the aside. Without a main-box the last text item becomes the aside.
- **Behaviour.** Main content on columns 1-8; the aside in a tinted box on columns 9-12, as tall as
  its text. An aside too short for its column first narrows to three columns at body size; if the
  main content still runs far past it, the aside stands across the top at lead size and the main
  points run in two columns under it.
- **Packs.** chalk, riso, newsroom.

### agenda

- **Holds.** The parts of the deck.
- **Write it as.** Three to six headed points, the head being the part name and the rest one line of
  what it covers: `- **처리 실적** 출고량, 비용, 정시 출고율의 분기 추이`.
- **Behaviour.** No numeral beside the title (OF-119): the rows carry the numbers. One numbered row
  per part (`01`, `02` ...), the name at lead size and the description
  under it, rows spread down to the floor at most 108 pt apart. The part names become the deck's
  index: `cover-index` lists them, section slides whose titles match a part name (or its description)
  number themselves by that position and show the part count, and in packs with an index display
  the section page repeats the agenda with the current part marked. Under kicker-numeral the
  numeral is the number of parts.
- **Packs.** ledger, chalk, gazette, neo-brutalism, bauhaus, riso.

### statement

- **Holds.** One line set large, and at most one support line.
- **Write it as.** The `#` heading, then one plain sentence of support.
- **Behaviour.** Drawn under the statement treatment in the pack's statement device (see "Display
  slides"). Ledger and gazette have no statement treatment and do not list the family; there the
  line becomes a top title over an empty body, which is rarely what you want.
- **Packs.** signal, atlas, chalk, paper, studio, night, computational-brutalism, neo-brutalism, bauhaus, riso, newsroom.

### quote

- **Holds.** A pull quote with its attribution.
- **Write it as.** The quote as a plain paragraph wrapped in quotation marks (`“...”`), then a line
  starting with `— ` naming the source. Never attribute a quote to a real person in a sample deck;
  name the interview or the document.
- **Behaviour.** Under the statement treatment the quote itself becomes the title shape and the
  attribution its support line; the opening quotation mark keeps the label check from reading the
  quote as a sentence title. Under top-rule it is set at title size below the heading.
- **Packs.** signal, chalk, paper, computational-brutalism, neo-brutalism, bauhaus, riso, newsroom.

## Number and table families

### kpi-row

- **Holds.** Four to six headline figures, each with its basis.
- **Write it as.** A pipe table: labels in the header row, the values in the first body row (each
  12 characters or fewer), and an optional second row giving each figure's basis or comparison (24
  characters or fewer): `| 412만 건 | ...` over `| 계획 대비 +4.1% | ...`. Then two or three takeaways and
  the source strip.
- **Behaviour.** Under a top title the figures run as a row of cards with labels and basis lines.
  On a narrow body, or when the visual is told to take the room, they run down the
  page as figure rows (value, label, basis). On the compact step a card row whose takeaways leave
  the body short becomes figure rows on seven columns with the takeaways beside. Values are never
  set above title size. A table that does not look like a KPI row falls back to `table-insight`.
- **Packs.** ledger, signal, atlas, studio, night, computational-brutalism, neo-brutalism, bauhaus, riso, newsroom.

### big-number

- **Holds.** One to four figures that carry the slide, with the evidence behind them.
- **Write it as.** A KPI table of one to four columns with a basis row, then three or four evidence
  points and the source strip.
- **Behaviour.** Every pack sets a `display.number` device, so the figures stand on a panel seven
  columns wide: one row per figure, the value at title size, its label and
  basis beside it. The panel is filled, tinted or outlined according to the pack and stays under
  half the page. The evidence runs beside the panel.
- **Packs.** ledger, signal, studio, night, neo-brutalism, bauhaus, riso, newsroom.

### table-insight

- **Holds.** A lookup table of five to eight rows with what it means.
- **Write it as.** The table, its caption, three or four takeaways, the source strip.
- **Behaviour.** The table takes eight columns and the takeaways four. When the takeaways are short
  enough that the slide would leave a band empty, they move under the table in two columns and the
  table's rows open up by up to one minimum row height each. Numbers are right-aligned in the pack's
  table style.
- **Packs.** ledger, signal, chalk, paper, gazette, computational-brutalism, neo-brutalism, bauhaus, riso, newsroom.

### ledger-table

- **Holds.** A full-width table that is the message: an account, a plan, a schedule, a status list.
- **Write it as.** Five to eight rows including a totals row (`합계` / `Total`, set bold), the caption,
  then three or four takeaways (they run under the table across the width).
- **Packs.** ledger, gazette, computational-brutalism.

### kpi-over-chart

- **Holds.** Headline figures and the trend behind them.
- **Write it as.** A KPI table with a basis row, then a `::: chart` fence, then one takeaway and the
  source and note lines.
- **Behaviour.** Figures across the top, the chart under them to the floor. Without both a KPI table
  and a chart it falls back to `chart-insight`.
- **Packs.** ledger, night, newsroom.

### dashboard-grid

- **Holds.** Two to four related small charts or tables seen together.
- **Write it as.** Two to four `::: chart` fences (or tables), each with its caption, then one
  takeaway and the source strip.
- **Behaviour.** Two panels sit side by side, three run across, four form a two-by-two grid; the
  takeaways run under the grid. With fewer than two visuals it falls back to `chart-insight`.
- **Packs.** ledger, night, computational-brutalism.

### matrix-2x2

- **Holds.** Four options placed on two axes (effect against effort, urgency against cost).
- **Write it as.** A table with exactly three header cells and two body rows. The first header names
  both axes, `효과 \ 난이도` or `Impact / Effort`; the other two headers are the column positions,
  the first cell of each row the row position. Each cell is `item · detail · detail`.

  ```text
  | 효과 \ 난이도 | 쉬움 | 어려움 |
  |---|---|---|
  | 큼 | 상차 도크 시간 조정 · 대기 −8분 · 11월 시행 | 자동 분류기 증설 · 검수 −7분 · 12월 설치 |
  | 작음 | 피킹 동선 재배치 · 피킹 −3분 · 10월 시행 | 포장재 규격 통일 · 포장 −1분 · 내년 검토 |
  ```

- **Behaviour.** Each quadrant shows its item as a head and each detail on its own line. Takeaways
  stand in the last four columns beside the matrix (under it on a narrow body). Any other table shape
  falls back to `table-insight`.
- **Packs.** ledger, gazette, computational-brutalism.

### comparison

- **Holds.** Two options, two periods, or plan against actual, judged on the same criteria.
- **Write it as.** Two columns with the same three or four labelled criteria on both sides:

  ```text
  :::: columns 1fr 1fr
  ::: col
  - **Hold the 16 November date**
    (1) Effort: two extra data engineers for five weeks
    (2) Cost: 84k EUR from contingency
  :::
  ::: col
  - **Move cutover to 7 December**
    (1) Effort: current team, no additions
    (2) Cost: 120k EUR for three more weeks of dual running
  :::
  ::::
  ```

  Then the source strip.
- **Behaviour.** When the points on both sides open with the same short label, the compact step
  draws a criteria column: the label once on the left, each side's text in its own column, one row
  per criterion spread down the page. The labels stand in the first column, level with their rows, and the two sides take the
  rest of the body; a label is a short name of three words at most, or the criteria stay inside the sides. A
  comparison dense with figures takes the data role, otherwise the content role. Without columns,
  bold-headed entries are split half and half; a visual without columns sits beside the text.
- **Packs.** all thirteen. The legacy name `summary` resolves here.

## Chart families

### chart-insight

- **Holds.** One chart and what it shows.
- **Write it as.** A `::: chart` fence with five to nine categories and a caption, two to four
  takeaways, the source strip and a note where a definition matters.
- **Behaviour.** The chart takes eight columns and the takeaways four. On the compact step the
  chart's values also appear as a small table under the takeaways when they fit (eight rows and four
  columns at most), else under the chart when the chart keeps at least 150 pt; takeaways too long
  for a third of the body take half.
- **Packs.** ledger, signal, paper, studio, night, computational-brutalism, neo-brutalism, bauhaus, riso, newsroom.

### full-chart

- **Holds.** A chart that needs the whole width: many categories, several series.
- **Write it as.** The chart, then one or two takeaways and the source strip; they run under it.
- **Packs.** ledger, signal, paper, night, computational-brutalism, newsroom.

## Sequence families

### process

- **Holds.** Two to five steps in order.
- **Write it as.** One bold head per step, numbered in the head (`- **1. Survey**`), with the step's
  text after the head or as `(1)` sub-points (they are joined into one line). Plain bullets after the
  steps are takeaways and run under them.
- **Behaviour.** On the compact step with a full-width body, each step is a row read across: numeral,
  step name, what happens. Up to four steps whose columns would stop high also run as rows.
- **Packs.** signal, chalk, neo-brutalism, bauhaus, riso.

### step-diagram

- **Holds.** A teaching sequence, each step with its own small worked value.
- **Write it as.** As `process`; include the number or formula each step produces.
- **Behaviour.** The same plan as `process`.
- **Packs.** chalk, computational-brutalism, neo-brutalism, bauhaus, riso.

### timeline

- **Holds.** Up to six dated events.
- **Write it as.** A table whose first column is the date, the second the event, and the rest (owner,
  status) joined under it; then two or three takeaways. Bullets with a bold date head also work when
  there is no table. Keep each event under about 20 Hangul or 40 Latin characters: an event cell has
  a sixth of the width and two lines.
- **Behaviour.** Dates sit over an axis; events and owners under it in equal slots; the takeaways
  under the axis. Room left over is shared evenly above the axis, between axis and takeaways, and
  under them. A single takeaway moves with the axis instead, the room shared over and under the
  pair; with a short title that still leaves a tall band under it (OF-109), so give a timeline two or
  three takeaways.
- **Packs.** ledger, atlas, gazette, studio, night, bauhaus, riso, newsroom.

## Image and figure families

### image-full

- **Holds.** One photograph that is the slide.
- **Write it as.** The title and one image line; nothing else.
- **Behaviour.** Always drawn under the overlay treatment: the picture bleeds to all edges, cropped
  to its own proportions, with the title and caption on a dark panel at the lower left.
- **Packs.** atlas, studio.

### image-split

- **Holds.** One image beside its explanation.
- **Write it as.** The image, then four or five headed points and the source strip.
- **Behaviour.** Image on seven columns, text on five.
- **Packs.** signal, atlas, chalk, studio, neo-brutalism, bauhaus, riso, newsroom.

### photo-grid

- **Holds.** Two or three images seen together.
- **Write it as.** Two or three image lines in a row (each with a caption), then one takeaway and the
  source strip. A fourth image is ignored. With one image it falls back to `image-split`.
- **Packs.** atlas, studio, riso.

### figure-pair

- **Holds.** Two figures to compare: before and after, condition A and B, day and night.
- **Write it as.** Two image lines, then one interpretation line that names the difference with
  numbers, then the source strip.
- **Behaviour.** The figures share the width equally at the same height; the text runs under them.
  With one figure it falls back to `figure-academic`.
- **Packs.** atlas, paper, newsroom.

### figure-academic

- **Holds.** One figure with numbered caption and its reading.
- **Write it as.** The image, three or four points, the source strip.
- **Behaviour.** Figure on eight columns, points on four.
- **Packs.** paper.

### asymmetric-feature

- **Holds.** One strong element (a photograph, a chart) beside a fuller explanation.
- **Write it as.** The visual, then four or five headed points and the source strip.
- **Behaviour.** The visual takes five columns and the text seven. A slide whose only visual is a
  one-row KPI table is drawn as `big-number`.
- **Packs.** signal, atlas, studio, bauhaus.

### method

- **Holds.** A formula and its terms, or a figure and its terms.
- **Write it as.** The formula as one plain (non-bullet) line, then four or five headed terms, each
  with one or two `(1)` sub-points, then the source strip.

  ```text
  budget = (1 − SLO) × total requests in the window

  - **SLO** service level objective
    (1) 99.95% of checkout requests succeed over a rolling 28 days
  ```

- **Behaviour.** On the compact step the formula runs across the top in the accent colour and the
  terms in two columns under it; on every step a formula with two or three columns of terms runs
  across. With a figure instead, the figure takes seven columns (five or four when the terms are
  long) and the terms run beside it; a figure at least twice as wide as tall runs across the body over
  its terms (two or three columns, the source closing the shortest) when it keeps 130 pt of height. A slide that holds a figure does not draw a
  formula line, so do not combine the two; put the formula in the figure's caption if both matter.
- **Packs.** chalk, paper, night, computational-brutalism.

## References

### references-appendix

- **Holds.** Eight to ten sources and definitions.
- **Write it as.** One bullet per entry, `- [1] ...`, sources first and definitions after.
- **Behaviour.** One entry per row, rows spread down the page with rules between. A list longer than
  the body steps down to label size, then runs in two columns.
- **Packs.** ledger, paper, gazette, computational-brutalism, newsroom.

## Covers

A cover takes its title from the `#` heading and its subtitle and meta line from the frontmatter:
`subtitle`, `date`, `department`, `presenter`. Write `layout: cover` to get the pack's first cover
that can be drawn, or name one. A named cover the deck cannot supply falls back to the next one in
the pack's list, with a note.

| Variant | Needs from the deck | What it draws | Packs |
|---|---|---|---|
| cover-typographic | nothing | Title large on the ground, subtitle and meta under it, drawn with the pack's cover device | ledger, signal, atlas, chalk, paper, gazette, night, bauhaus, computational-brutalism, neo-brutalism, newsroom, riso |
| cover-split-field | nothing | Title in the left columns beside a colour field bleeding off the right edge | signal, bauhaus, neo-brutalism, riso |
| cover-split-image | an image anywhere in the deck | Title on the left, the deck's first image filling the right side | atlas, paper, studio |
| cover-full-image | an image anywhere in the deck | The first image full-bleed with the title on a dark panel | atlas |
| cover-band | nothing | A deep band carrying the title, then the deck's parts (or its headline figures) across the page under it | gazette |
| cover-numeral | a year in the title or the `date:` | The year at title size in the accent over the title | signal, chalk, studio, night, bauhaus, neo-brutalism, riso |
| cover-index | an agenda, or two or more sections | Title on the left, the part names listed on the right | ledger, paper, gazette, computational-brutalism, newsroom |
| cover-figures | a KPI table somewhere in the deck | Title over the deck's first row of headline figures (up to four) | ledger, night, computational-brutalism, newsroom |
| cover-rail | nothing | A dark rail on the left holding organisation and date, the title beside it | chalk, studio |

Never invent a number to enable `cover-numeral` or `cover-figures`; the figures come from the deck.

## Sections

A section slide holds the `#` title (and may hold an image for `section-image`). It numbers itself
by its position in the agenda when its title matches an agenda part or its description, and then
shows the part count (`02 / 04`). In packs with `display.index` (ledger, paper, gazette, newsroom)
`section-rule` and `section-numeral` with an agenda become an index page: the part numeral over the
part title on the left, the whole agenda on the right with this part marked. A section with no
agenda behind it shows no numeral; it sets its title as a statement with a preview of the slides it
opens under it: each slide's title and up to two of its first lines, a bold run-in label keeping its
colon (`**결과:** …`), in a column from the left margin no wider than 70 % of the page or about 70
characters of body text (eight columns for Korean, six for English). Lines and then slides drop
until the preview fits above the body floor.

| Variant | What it draws | Packs |
|---|---|---|
| section-field | Title on a field-coloured ground | signal, atlas, paper, night, bauhaus, neo-brutalism, riso |
| section-numeral | Part number in the accent with the title | ledger, signal, chalk, studio, night, bauhaus, computational-brutalism, neo-brutalism, newsroom, riso |
| section-rail | Dark rail with the part number, title beside it | chalk, studio |
| section-image | The section slide's own image full-bleed with the title on a panel (needs an image on that slide) | atlas |
| section-rule | Title over a hairline, or the index page | ledger, paper, gazette, computational-brutalism, newsroom |
| section-band | Deep band; the deck's parts with this one marked, the title as a statement under the band | gazette |

## Closings

A closing other than the statement is a content slide whose title names the ask, drawn under a top
title. Write `layout: closing` for the pack's first closing, or name one.

| Variant | Write it as | What it draws | Packs |
|---|---|---|---|
| closing-ask | One `Next step:` line and a table of asks (item, amount or date, owner) | Action rows keyed by the amount column (same unit; each row gets a bar for its share and the total closes the list) or else the date column; the next step on the floor in the pack's closing device; a next-step line that fits the box sets on one line across it, a longer one keeps the reading measure, set as narrow as keeps its line count so no line ends on a lone word | ledger, signal, atlas, chalk, paper, gazette, bauhaus, computational-brutalism, neo-brutalism, newsroom, riso |
| closing-decision-box | One `결정할 것:` / `Decide:` line and a table of decisions | The decision bold at lead size in a box at the top, the table as action rows under it | ledger, gazette, night, computational-brutalism, neo-brutalism |
| closing-statement | The `##` ask and one support line; no table or image | The ask set as a statement | signal, night, bauhaus, neo-brutalism, newsroom, riso |
| closing-summary-list | Four to six one-line conclusions, or a visual plus points | Numbered conclusions spread down the page; with a visual, the visual on eight columns and the points in a box beside | chalk, paper, studio, bauhaus, computational-brutalism, newsroom, riso |
| closing-contact-split | A contact line and a table of asks | A field bleeding off the right and bottom edges holding each row's key and the total, starting where the rows' text ends (five to seven of twelve columns, never at the cost of a smaller row size); the asks down the left; the contact in a band that meets the field | atlas, studio |

A totals row (`합계`, `Total`) is never read as an action row, and dash-only cells are left out of
the detail line. Keep thank-you lines to a small line at most; the closing is for the ask.

## Display slides

Covers, sections, statements, big numbers and closing steps are drawn with the device the pack
names under `display:`. This is what makes a Signal cover look nothing like a Paper cover even
though both are `cover-typographic`.

| Pack | cover | statement | number | closing step | index |
|---|---|---|---|---|---|
| ledger | figures | (no statement) | tint | box | yes |
| signal | drench (field over the page) | open | field | band | |
| atlas | plate (field under the title) | drench (field over the page) | tint | band | |
| chalk | rail | drench | tint | box | |
| paper | rules (journal title page) | rules | outline | rules | yes |
| gazette | band | (no statement) | outline | box | yes |
| studio | plain | rules (two hairlines on the open page) | tint | band | |
| night | numeral | open | tint | band | |
| computational-brutalism | drench (field over the page) | drench | outline | box | |
| neo-brutalism | plate (field under the title) | drench | field | box | |
| bauhaus | geometry (shapes in grid cells) | geometry (sentence left, shapes from column 10) | field | rules | |
| riso | drench | drench | field | band | |
| newsroom | band | rules | tint | rules | yes |

Devices the earlier packs do not use:

- `geometry` (bauhaus): the cover puts the title on the left half and an elementary composition on the
  right half, each shape in its own grid cell (a square in the accent tint, a circle in the accent, a
  bar in ink, a triangle in the field). A statement, a quote and a closing statement put the sentence
  on the left and a narrower composition from column 10 to the edge. Content slides carry no geometry.
- `drench` on a cover (computational-brutalism, riso): the field over the whole page, the title at
  the cover step in up to three balanced lines, anchored low.
- `plate` on a cover (neo-brutalism, as atlas): a field plate over a little under half the page, the
  title on it in at most two lines. A statement is never set on a plate: a sentence on a plate that
  covers less than half the page would leave the page above it open, so statements take `drench`.
- Grid marks and hard offset shadows are pack keys, not devices (`decoration: grid-marks`, `shadow:`,
  `edge-weight:`); `templates/tonalities/<id>/pack.yaml` states them and the sheet names them.

## How a deck keeps its variety

The gate (OF-111) wants the content slides to differ in layout: the title treatment (top-rule, side-rail, band,
bottom-anchor, overlay, none) times the body's column partition (one, two-even, two-asym, three, grid,
full-bleed). The count of distinct layouts must reach about 60 % of the content slides (capped at
five), and no layout may cover more than 40 %. Agendas and references count as content slides
here; covers, sections and closings do not.

The partition depends on the family and on the treatment. These are the readings the gate gave on
the example decks in `examples/`:

| Partition | Seen on |
|---|---|
| one | agenda, text-column, ledger-table, references-appendix |
| two-even | table-insight whose takeaways moved under the table |
| two-asym | chart-insight and image-split under top or bottom titles, big-number, sidebar-note, asymmetric-feature, figure-academic |
| grid | kpi-row cards, comparison criteria rows, matrix-2x2 under a top title, timeline, process and step-diagram, summary-box-list, text-two-column, photo-grid, figure-pair under bottom-anchor, method under band, kpi-over-chart |
| full-bleed | image-full |

When OF-111 fails, read which layout repeats, then change one repeated slide's family or put a
`title:` key on it (`title-treatments.md`). Do not add slides to dilute the count.
