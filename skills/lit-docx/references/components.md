# Page components and the directive syntax

The Markdown source may hold six fenced directives: `cover`, `callout`, `sidebar`, `pullquote`,
`keyfigures` and `columns`, plus a `<!-- column-break -->` marker inside `columns`. The converter splits
them out before Markdown sees the text, so a fence never reaches the page. Everything else in the source
is ordinary Markdown: headings, paragraphs, lists, pipe tables, images and captions.

This file gives the exact syntax the converter accepts, what each directive produces, which tonalities
draw it, and the budget that keeps a document from turning into a page of boxes. A directive that is
valid but not drawn by the chosen tonality, or that falls outside the budget, is not lost: its content is
set as ordinary text, with its `title=` as a bold lead line.

## The budget

Most documents need no component at all beyond the page-1 block. A component earns its place when it
carries content that does not belong in the running order of the text: a decision the reader must make,
a warning that interrupts a procedure, definitions consulted out of sequence, the three numbers a summary
stands on. The rules:

- **Three kinds at most** beyond headings, paragraphs, lists, tables and figures. The kinds counted are
  callout, sidebar, keyfigures and columns. A fourth kind in the source is set as plain text.
- **One key-figure strip per document**, placed in the summary, with three or four real metrics that are
  comparable and each carry a basis (period, source or method). A second strip becomes a bulleted list. A
  strip is never a list of facts that are not measurements ("two sites", "phase 1").
- **Callouts about one per four pages**, for out-of-sequence content only: a decision request, a warning,
  a definition the reader needs before the next step. The converter estimates the page count and draws
  that many callouts, never fewer than one; a pack may cap the number lower (Brief and Proposal draw one).
  When the source has more callouts than the budget, the converter keeps a `kind=key` callout first, then
  warnings, then notes, each group in source order; the rest are set as text.
- **No pull quotes.** Every pack has them off. A pull quote that repeats a sentence of the body is
  dropped with a note; any other pull quote is set as a normal paragraph.
- **Sidebars in Manual only.**
- **Two columns only for balanced blocks.** The parts of a `columns` block must be within 20 % of each
  other in length, counted in characters without spaces or Markdown marks. An unbalanced block is set as
  one column with the break removed.
- **No box inside a box.** `columns` is refused inside a callout or sidebar; nesting a callout inside a
  callout is legal syntax but defeats the purpose of either.
- **A purpose line on the direction card** for every component the source uses. No line, no component.

The gate's `component.budget` check fails a tonality document with more than three kinds, more than one
key-figure strip, any pull quote, or key figures on a cover page.

## Grammar

```text
::: <name> [positional] [key=value] [key="value with spaces"]
<body: Markdown, which may contain further directives>
:::
```

- The opening line is three or more colons, a space, the directive name and its attributes.
- The closing line is the same number of colons on a line of its own. To put one directive inside
  another, give the outer fence more colons (`::::`) than the inner one.
- Values without spaces need no quotes (`kind=warning`, `width=third`). Values with spaces use double
  quotes (`title="Decision requested"`). A literal double quote inside a value is written `\"`.
- An unknown directive name, an unknown attribute, a repeated attribute, an unclosed fence and a closing
  fence with nothing open are all errors. The converter stops and names what it accepts; it does not
  guess.
- Fenced code blocks are left alone: a `:::` line inside a code fence is text.

Attributes each directive accepts:

| Directive | Positional | Attributes |
|---|---|---|
| `cover` | none | `kicker`, `variant`, `image` |
| `callout` | none | `kind` (required), `title` |
| `sidebar` | none | `title`, `width`, `float` |
| `pullquote` | none | `cite` |
| `keyfigures` | none | `cols` |
| `columns` | `1`, `2` or `3` | `gap`, `rule` |

## Which tonality draws what

| Tonality | cover block | callout | sidebar | keyfigures | columns |
|---|---|---|---|---|---|
| Report | masthead | yes | text | yes | yes |
| Brief | masthead | yes, one | text | text | yes |
| Manual | control block | yes | yes | text | yes |
| Proposal | cover page | yes, one | text | yes | yes |
| Memo | memo block | text | text | text | text |
| Journal | masthead | yes | text | text | already two columns |

"Text" means the content is set in the flow: a callout or sidebar as its bold title and body, key figures
as a bulleted list with each basis in parentheses after the label. A short block set this way is kept on one
page.

## `::: cover`

```markdown
::: cover kicker="시설 운영 보고 2026-4호"
본문 첫 쪽 제목 아래에 둘 한두 문장의 안내.
:::
```

The cover directive must be the first block of the body, straight after the frontmatter. It carries the
page-1 extras; the title, subtitle, byline, date and notice come from the frontmatter, and a cover with no
frontmatter `title:` is an error. What the block becomes depends on the tonality's title block, not on
the directive:

- **Masthead** (Report, Brief, Journal): a series line with the kicker on the left and the date on the
  right, the title, the subtitle, the byline, one rule, the notice, then the body text of the directive as
  a lead set half a point above the body size.
- **Cover page** (Proposal): the kicker, the title in the upper third, a short rule, the subtitle and the
  lead on a page of their own; byline, date and notice at the foot of that page. The body starts on the
  next page as page 1.
- **Memo block** (Memo): the kicker as the label (default 메모 or Memo), the title, and the rows of the
  body lines that start with `To:`, `From:`, `Date:`, `Subject:`, `Cc:` or their Korean forms `받는 사람:`,
  `보내는 사람:`, `날짜:`, `제목:`, `참조:`. Several pairs may share one line separated by ` · `. The
  frontmatter date is inserted after the sender when no date row is given.
- **Control block** (Manual): the title, the subtitle and a two-column block of document, owner,
  organisation and issue date (문서, 작성 부서, 기관, 시행일), filled from `short_title` (or `title`),
  `author`, `organization` and `date`. The kicker is printed above the title without a date.

An empty directive (opening and closing line only, or only a kicker) is valid; leave the directive out
altogether when there is no kicker and no lead.

`variant=` accepts `typographic`, `band`, `split` and `masthead` and rejects anything else, but every
tonality draws its own typographic block whatever the variant says; omit it. `image=` is accepted and not
drawn: covers carry no pictures. A `keyfigures` block placed inside a cover (with a longer outer fence) is
moved to the summary when the tonality draws key figures and left out with a note otherwise, because key
figures never stand on a cover.

## `::: callout kind=<note|key|warning> [title="…"]`

```markdown
::: callout kind=key title="결정 요청"
2027년 추가 예산 2,150만 원과 급속기 예약제 시행을 승인해 주시기 바랍니다.
:::
```

One callout style per document: a single-cell box with a 0.75 pt rule above and a 0.5 pt rule below, no
side rules, no fill, the title in bold ink at body size, the body in the body face. The rules take the
pack's accent where the pack lists `callout_rule` among its accent places (Report, Brief, Manual,
Proposal) and ink otherwise. The box does not split across pages and keeps with what follows.

The three kinds differ in label and priority, not in look. Default labels are 참고 / 핵심 / 주의 in Korean
and Note / Key point / Warning in English; a `title=` replaces the label and is almost always better.

- `kind=key` is the decision request or the one conclusion the reader must take away. In a Brief, the
  first key callout moves to the top of the body, straight under the title block. In other tonalities it
  usually closes the document.
- `kind=warning` interrupts a procedure: a hazard, an irreversible step, a combination that must not
  happen. Manual is its natural home.
- `kind=note` holds a definition or a reading aid the text depends on but does not argue.

A callout earns its place when removing it would leave the reader without a decision or a safety fact.
A summary restated in a box, a "tip", or a second copy of the conclusion does not.

## `::: sidebar [title="…"] [width=third|half] [float=right|left|none]`

```markdown
::: sidebar title="이 절차서의 용어" width=third float=right
**보관소**: 지하 1층 B-104호 임시 보관 시설.

**인계**: 용기를 넘기고 대장에 서명하는 절차.
:::
```

Manual only. A box beside the text with a 0.75 pt hairline down its left side in the pack's accent, no
fill, body text at table size (about 92 % of the body). Defaults are a third of the text width floating
right. A sidebar inside a two-column body does not float.

The converter measures the text between the sidebar and the next heading. When that text is shorter than
the box, the next heading would start beside it, so the sidebar loses its float and stands full width in
the flow. To keep a floating sidebar, place it at the start of a section with two or three paragraphs
after it, as the Manual example does under its first h2. A good sidebar holds definitions, contact
numbers or reference values the reader looks up while following the main text; a sidebar that repeats
the text beside it is padding.

## `::: pullquote [cite="…"]`

Accepted by the parser and drawn by no tonality. A pull quote that repeats a sentence already in the body
is dropped and the converter prints `Note: line N: the pull quote repeats the body and is left out`. Any
other pull quote becomes an ordinary paragraph. Write the sentence in the body instead.

## `::: keyfigures [cols=2|3|4]`

```markdown
::: keyfigures
- **1,050MWh** 연간 예상 발전량
  - 일평균 발전시간 3.6시간 가정, 공장 사용량의 11%
- **1억 5,900만 원** 연간 순절감액
  - 평균 단가 165원/kWh, 유지비 1,400만 원 차감
- **5.8년** 단순 회수 기간
  - 총사업비 9억 2,000만 원 기준
:::
```

The body is one list. Each item is `- **figure** label`, where the bold figure contains at least one
digit. An indented `- ` line under an item is that item's basis: the period, the source or the
assumption. One to eight items are accepted; three or four is the useful range. `cols=` sets the number
per row (default 3 in Report and Proposal, at most 4, never more than the number of items).

The strip is drawn as one borderless row with an ink hairline over each figure, the figure in bold at the
h2 size (one step above the body, never a display number), the label at table size and the basis at note
size in muted ink. Drawn in Report and Proposal; elsewhere the items become a bulleted list with the basis
in parentheses after the label.

Place the strip inside the summary, after its first paragraph. The figures must also appear in the text
or a table, with the same values and rounding: a reader who checks the 4,360만 원 in the strip against the
cost table must find 4,360. Metrics in one strip should be comparable in kind (outputs, costs, rates)
and drawn from the same period.

## `::: columns <1|2|3> [gap=<mm>] [rule=true]`

```markdown
::: columns 2
**방안 A. 전체 협력사 월 2회.** 196곳 모두에 매월 10일과 25일 지급을 적용한다. …
<!-- column-break -->
**방안 B. 중소 협력사만 월 2회.** 연 매출 100억 원 미만 148곳에만 적용한다. …
:::
```

With a `<!-- column-break -->` marker, each part goes in its own cell of one borderless row, tops aligned,
with the gap split between the cells; `rule=true` draws a hairline between them. Without a marker, the
block becomes a balanced column section that flows into as many columns as asked. `gap` is in
millimetres (the pack default is 6 mm).

Columns stand at the top level only, never inside a callout or sidebar, and the marker is an error
anywhere outside a `columns` block. The balance rule applies to the parts separated by markers: two
options of 119 and 107 characters pass; a paragraph beside a one-line note does not. Use columns for two
parallel things the reader compares: two options, before and after, two sites. A list split in half to
save space is not a comparison.

## Table captions and table styles

A table caption is the paragraph immediately before the table, written `표 1. 제목` in Korean or
`Table 1. Title` in English. There must be no other paragraph between the caption and the table. The
converter keeps the caption with the table, sets Korean captions as `<표 1> 제목` with the label in bold,
and bolds `Table 1.` in English. Figure captions written `그림 1. 제목` become `[그림 1] 제목`.

A caption may end with `{style=booktabs}`, `{style=banded}`, `{style=light-grid}` or
`{style=header-fill}`. Every tonality draws booktabs regardless and prints a note when another style is
named; the attribute only matters on the plain profile. Leave it out.

## Source and note lines

A paragraph straight after a table that starts with `주:`, `자료:`, `출처:`, `Note:`, `Notes:`, `Source:`
or `Sources:` is set as a note line: note size, muted ink, kept with the table. Korean `출처:` is
rewritten as `자료:`. Order them `주:` first, then `자료:`, each as its own paragraph (separate them with a
blank line, or the two lines merge into one paragraph with a line break).

## Misuse the gate will not catch

The gate counts components; it does not read them. These pass every check and still read as
machine-made:

- A callout in every section, each restating the section's first paragraph.
- Key figures that are not measurements, or figures with no basis line.
- A key-figure strip whose numbers differ from the table that carries the same quantity.
- Two columns holding unrelated content because the page "looked empty".
- A sidebar of definitions nobody needs, added because the Manual allows one.
- A `kind=warning` callout used for emphasis in a document with no hazard.
