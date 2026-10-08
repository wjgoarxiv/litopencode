# Page composition

This file describes the page every tonality builds and what the author controls from the Markdown
source: the A4 frame and its margins, the typeface and type sizes, colour, tables, Korean writing
conventions, leading, line breaking in Word, pagination, and the running head. Most of these are fixed
by the pack and applied by the converter; the author's part is to write a source that the fixed page
can carry without forcing it.

The look all six packs share is restraint. Black-ink text and headings, headings only a step or two
larger than the body, tables drawn with three rules, one accent colour at most, no tinted panels, no
decorative numerals. A document built this way is read for its content, and the few elements that do
stand out (a decision box, a key-figure strip) are noticed because nothing else competes with them.

## The frame

Every pack sets A4 (210 × 297 mm). The margins come from the density dial; at the density most packs use
(9) they are 25 mm at the top and sides and 27 mm at the bottom. The sides never drop below 25 mm and the
bottom is never smaller than the top, so the text block is 160 mm wide at most: about 40 to 45 Hangul
syllables or 75 to 85 Latin characters per line at 10.5 pt. The header and footer sit 12 mm from the
paper edge at most.

Journal sets the body in two columns 6 mm apart. A table with more than three columns in a Journal body
is lifted out into a full-width band, together with its caption, and the columns resume underneath; a
table of three columns or fewer stays inside its column at the column's width.

## Typeface and sizes

Pretendard is the face for Hangul, Latin and headings in every pack except Journal, which sets Latin body
text in Times New Roman and keeps Pretendard for Hangul and headings. The converter writes the face
names into the document defaults, every style, the theme fonts and the list glyphs, so a renderer has no
default face to fall back on. Do not ask for another face in a tonality document; a typeface requirement
from the user is a reason to use the publisher path or a supplied template.

Body text is 10.5 pt (11 pt for English Memo and English Proposal) and never smaller. The other sizes
are derived from it, rounded to the half point:

| Element | Report | Brief | Manual | Proposal | Memo | Journal |
|---|---|---|---|---|---|---|
| Body (Korean) | 10.5 | 10.5 | 10.5 | 10.5 | 10.5 | 10.5 |
| h1 | 14.5 | 13.5 | 14 | 14.5 | 12.5 | 13.5 |
| h2 | 12.5 | 12 | 12 | 12.5 | 11.5 | 12 |
| h3 | 10.5 bold | 10.5 bold | 10.5 bold | 10.5 bold | 10.5 bold | 10.5 bold |
| Title | 26.5 | 26.5 | 26.5 | 28.5 | 19 | 26.5 |

English Proposal steps up from its 11 pt body (h1 15.5, h2 13, title 29.5) and English Memo likewise
(h1 13, h2 12, title 20). Table text is 9.5 pt, note and source lines 9 pt and the running head 8.5 pt
(10, 9.5 and 9 pt under an 11 pt body); a key figure takes the h2 size. A title that would need a fourth line, or that holds a word wider than the
measure, is stepped down a point at a time until it fits in three lines.

## Headings

Headings are bold, left-aligned and in the body ink. Levels differ by size, weight and the space around
them, never by colour, underline or a box. Space above is about twice the space below (h1 22 pt above and
9 pt below, h2 15 and 6, h3 11 and 4), and every heading keeps with the paragraph that follows it. The only
rule a heading carries is the Brief's full-width hairline above each h1, which stands in for a section
number.

Use at most three levels. Open every h1 section with at least one paragraph before its first h2, so two
headings never stand back to back; the converter does not insert that paragraph for you.

Numbers, where the pack uses them, are added by the converter in plain ink at the heading's own size.
Do not type them in the source.

- Korean Report: `Ⅰ.` for h1, `1.` for h2, `가.` for h3, each followed by one space.
- English Report, Manual and Journal: `1`, `1.1`, `1.1.1`, followed by a tab, with the heading texts of a
  level aligned on one line however wide the widest number is.
- Brief, Proposal and Memo: no numbers.
- A back-matter heading (References, Acknowledgements, 참고문헌, 감사의 글) is never numbered.

A heading, the title and the subtitle are noun-phrase labels. The gate's `heading.declarative` check
fails a Korean label whose last word ends like a sentence (-다, -니다, -요, -죠, or a nominalised claim
such as -함, -됨, -있음) and an English label that ends with a full stop or contains an auxiliary (is,
are, has, will, can, does) or one of a list of finite verbs. That list includes words that are also nouns:
works, needs, leads, shows, cuts, pays, takes, saves, matters, drops. "Staffing needs" fails; "Staffing
requirements" passes. The finding goes in the first sentence under the heading, not in the heading.

## Colour

Each pack has a three-value ink palette: text #1A1A1A, muted #555555 for note lines and the running
head, line #8C8C8C for hairlines. Every style in the document is set to the ink, including the heading
styles the build does not use, so a reader who applies Heading 5 later still gets black text. Hyperlinks
are recoloured to the ink.

Four packs declare one accent and name at most two places for it:

| Pack | Accent | Places |
|---|---|---|
| Report | #1F3A5F | title rule, callout rules |
| Brief | #2D5A47 | title rule, callout rules |
| Manual | #2E4A66 | callout rules, sidebar rule |
| Proposal | #6E2639 | cover rule, callout rules |
| Memo | none | none |
| Journal | none | none |

The accent is never used on text, fills or headings. The gate's restraint checks fail a tonality
document that has more than one hue outside the ink, an accent on more than two kinds of element, a
coloured heading (`heading.ink`), an h1 more than 1.5 times the body (`heading.ratio`), a shaded data
table cell (`table.fill`), or a coloured or shaded notice in a page header (`furniture.chip`). These
are produced only by hand edits or a custom template; a source converted with a pack does not trigger
them.

## Paragraphs and alignment

Paragraphs are separated by space (6 pt after a Korean paragraph, 5 pt after an English one) and never
also by a first-line indent. Korean body text is justified in Report, Brief, Proposal and Memo, with
kinsoku on so a closing bracket or full stop never starts a line. Manual and Journal set Korean ragged
right. English text is ragged right in every pack.

## Leading

The body line pitch is a percentage of the body size: 175 % for Korean and 133 % for English at the
density most packs use, rising to 185 % and 140 % at low density. The converter writes it to Word as a
line-spacing multiple, and the multiple is not the percentage divided by 100.

A single line in Word is not 1.0 em. Measured on rendered pages, Pretendard's single line is about
1.55 em in Word and 1.51 em in LibreOffice; the converter uses the mean, 1.53 em. Times New Roman's is
about 1.15 em. The multiple is the pitch divided by that single-line height:

- Korean body at density 9: 1.75 / 1.53 = Multiple 1.14.
- English body in Pretendard at density 9: 1.33 / 1.53 = Multiple 0.87.
- English body in Journal (Times New Roman) at density 9: 1.33 / 1.15 = Multiple 1.16.

The habit of setting "1.6 line spacing" for Korean text produces a 245 % pitch with Pretendard, which is
why documents set that way look loose and run long. Headings use a 130 % pitch, captions, table cells and
note lines 140 %. When editing a converted document by hand, leave the paragraph spacing alone.

## Line breaking in Word

The converter marks the document Korean (`ko-KR` as the East Asian language of the defaults) and sets
`wordWrap` and `kinsoku` on in the Normal style. With these, Word wraps Hangul between words (어절) as a
Korean reader expects. LibreOffice ignores the setting and breaks Hangul between syllables whatever the
document says, so a page rendered through LibreOffice for checking shows syllable breaks that Word will
not show. Do not rewrite body text to move those breaks.

Titles, subtitles and headings are a different case: the converter breaks the title between words
itself, in the fewest and most even lines that fit, and the gate's `heading.wrap` check fails any
heading or title that a rendered page breaks inside a word. A heading that keeps failing is too long for
its column; shorten the label.

## Tables

Every tonality draws booktabs: a 1 pt rule above and below the table, a 0.5 pt rule under the header row,
no vertical rules, no inner horizontal rules, no fills. The header row is bold ink. A last row whose first
cell is 합계, 총계, 소계, 계, Total or Sum is bold under its own 0.5 pt rule. Cells have 3.5 pt padding above
and below and 5 pt at the sides.

A column whose body cells are all numbers is right-aligned in tabular figures. The test is strict: a cell
may hold a sign, digits with commas or points, an optional bracketed note, and a short unit after the
number (%, %p, 배, a Hangul unit of up to three syllables, or a Latin unit of up to three letters). A
currency symbol in front (£15,392, ₩2,000, $40) or free text in one cell makes the whole column text, and
the publisher-style audit then reports the numbers as misaligned. Put the currency or unit in the header
cell instead: `Cost (£)`, `금액 (만 원)`. A dash or an empty cell is allowed in a numeric column.

No column is made narrower than its longest word plus padding; the room is taken from the widest column.
Keep cell text short. A table is evidence, not prose: if a cell needs two sentences, the content belongs
in the text above the table.

## Korean conventions

These apply on every path, including publisher profiles:

- **Captions.** A table caption stands above its table as `<표 1> 제목`, a figure caption as `[그림 1] 제목`.
  Write `표 1. 제목` or `그림 1. 제목` in the source and the converter sets the bracket form with a bold
  label.
- **Units.** When every header cell after the first ends in the same unit in brackets, for example
  `2025년 (건)` and `2026년 (건)`, the unit moves out of the cells into one line `(단위: 건)` right-aligned
  above the table. Mixed units stay in the cells; that is correct, not a fault.
- **Notes and sources.** Below the table, `주:` first and `자료:` after it, each its own paragraph, at note
  size. A source written `출처:` is rewritten as `자료:`.
- **Dates.** `2025. 1. 2.` or `2025년 1월 2일` in the text; never `2025-01-02`. The converter rewrites ISO
  dates in the Korean body and formats the frontmatter `date:`, but not dates inside other frontmatter
  fields (subtitle, notice, abstract), so write those the Korean way yourself. Do not start a line with
  a hand-written date such as `2026. 3. 2.`: Markdown reads a line that opens with a number and a full
  stop as a numbered list. The gate's `date.iso` check fails any ISO date left in a Korean document.
- **Lists.** Write Markdown `-` lists; the converter draws them with an en dash at every level in Korean
  documents. A government-style `○` line typed as text is acceptable inside a 개조식 passage. A list of one
  item is set as a plain paragraph without a symbol. Numbered lists restart at 1 after any break.
- **No glyph markers.** No filled or hollow squares, arrowheads, check marks or emoji in headings, list
  heads or table cells.
- **Emphasis.** Hangul is emphasised by weight only. The converter removes italic from any run that holds
  Hangul. Use bold sparingly: a bold keyword in every sentence reads as machine-made.
- **Numbers and units.** Choose one spacing style for numbers and units and keep it (`12kW` or `12 kW`).
  A number written with a space before an SI unit is held together with a no-break space. A hyphen between
  two digits becomes an en dash (1–3); a spaced hyphen between words becomes an em dash, which the prose
  lint then reports, so use a comma or a full stop instead.

## Pagination

The converter never forces a page break before a heading. It keeps each heading with its next paragraph,
keeps a short paragraph (under 60 characters) after a heading with the paragraph after that, turns widow
and orphan control on, and keeps a closing paragraph of up to about four lines with the block before it,
so the last page never holds one orphaned paragraph. A component box does not split across pages, and a
box under a paragraph or list item stands 6 pt clear of it.

**Lists and headings.** A list of up to six items keeps together: every item but the last keeps with the
next, and a lead-in of a line or two right before it ("다음 단계는 아래와 같다.") keeps with the list. In
a two-column body a list of five or six items may break once: the lead-in keeps with the first two items
and the last two stay together, so the block no longer jumps to the next column and leaves a third of a
column empty. The last section of a single-column document, with no table or picture and about twelve
lines or fewer, keeps whole, so its paragraph goes to the last page with its list. In
a single-column body a heading keeps its short lead sentence (about 200 characters) with a table of up to
eight body rows it opens, caption and unit line included, so the heading and its sentence never wait at
a page foot while the table starts the next page.

**Short documents.** A source of about one page (the converter's estimate) is set with tight spacing in
any tonality, as a memo is, so it does not spill a few lines onto a second page. A section that opens
under a hairline right after a ruled box draws no second rule.

**Tables.** A table whose estimated height fits in 0.9 of the frame is kept on one page with its caption,
unit line and note lines. A long table, meaning a header plus six or more body rows, may break between
rows with the header row repeated, but only where a quarter of the frame or more is left: the header
stays with at least three body rows (or rows worth a quarter of the frame), and the last three body rows
stay together. Any other split fails the gate's `table.split` check.

Table columns: no column is narrower than its longest word, and a text column whose cells wrap while the
others hold their longest cell with room to spare takes that room; a header may take two lines, and no
column gives up room below its own longest data cell. Negative figures in tables take the minus sign
(−), Korean tables too. A sentence right above a table without a caption keeps 6 pt under itself. Under a
publisher profile the paragraph after a table stands three quarters of a body line clear, a paragraph
after a list 6 pt, and a list of up to six items keeps together. A table too tall for a page in any
case should be cut down to the rows the text discusses, with the full data in an appendix or a workbook.

**Figures.** A picture is scaled to the text width and to a share of the frame height set by the pack
(Proposal 60 %, Report and Manual 45 %, Brief, Memo and Journal 40 %), and keeps with its caption. A
figure caption on another page than its picture fails `figure.split`.

**Fill.** No body page may be filled to less than 0.35 of its frame; the cover and the last page are
exempt. A short page almost always comes from a large table or figure that could not fit in the space
left and moved whole to the next page. The fixes, in order: put a lead sentence or the paragraph that
discusses the table above it, move the table below the next paragraph, or shorten the table.

## Running heads and folios

The running head is set at 8.5 pt in the muted ink, regular weight, with the short title on one side and
the folio on the other, or the folio alone. It never appears on the page that carries the title block or
on a cover page. The folio is the page number alone, never "page / total". The short title is the
frontmatter `short_title`, or the title cut at a word boundary near 40 characters; give every document of
more than two pages a `short_title`.

| Pack | Header | Footer |
|---|---|---|
| Report | none | short title left, folio right |
| Brief | none | folio right |
| Manual | short title | folio right |
| Proposal | none | folio centred, starting at 1 after the cover |
| Memo | none | folio right |
| Journal | short title left, folio right | none |

## The sample-data notice

When the content is invented or illustrative, the frontmatter `notice:` states it once, in ink, at the
furniture size: under the title rule on a masthead, under the memo or control block, or at the foot of a
cover page. It is never repeated in page headers in a tonality document. Write it as a plain statement
("예시 데이터. 회사, 금액, 수치는 모두 가정이다." / "Sample report. The council, figures and costs are
invented examples.") and keep invented values realistic. Never leave a bracketed blank, a to-be-decided
marker, a run of capital X, doubled circles or a line of underscores in the source: the gate's content
check fails on any of them, and it also treats any short bracketed text without a digit, such as a
bracketed company name, as a blank.

## What the gate checks

`python3 <skill>/run.py qa draft.docx --source draft.md` runs the checks that read the Word file and the
source: file integrity, missing headings and blanks, prose lint on the source, and the structural and
restraint checks. Adding `--layout` renders the document through LibreOffice and adds the page checks.
The JSON report's `failure_reasons` lists what failed; `lint.prose`, `lint.design` and `output.findings`
hold the details.

| Check | Needs `--layout` | Usual cause | Fix in the source |
|---|---|---|---|
| `heading.declarative` | no | a heading written as a claim | rewrite as a noun phrase; move the claim into the first sentence |
| `heading.order` | no | an h3 straight under an h1, or a document opening at h3 | add the missing level or promote the heading |
| `date.iso` | no | an ISO date in a frontmatter text field or a table cell | write `2026. 10. 5.` |
| `component.budget` | no | a fourth component kind, a second key-figure strip | drop the component without a purpose line |
| `fill.page` | yes | a large table or figure pushed to the next page | lead sentence above it, or move it below the next paragraph |
| `heading.stranded` | yes | a heading over a table or figure that moved | a short lead sentence under the heading |
| `heading.wrap`, `title.lines` | yes | a label too long for its measure | shorten the label; move detail to the subtitle |
| `table.split` | yes | a table that fits a page split anyway, or a caption apart from its table | lead sentence above, or shorten the table |
| `figure.split` | yes | picture and caption on different pages | make the picture smaller in its source |
| `sidebar.overlap` | yes | too little text after a floating sidebar | add the paragraphs that belong there, or place the sidebar earlier |
| `component.variety` | yes | four or more pages and fewer than two component kinds | add a component the direction card justifies, or tighten to three pages |
| `cover.block` | yes | a filled shape over a quarter of the cover | a hand edit or template; rebuild from the source |
| `memo.fit` | yes | a memo spilling a few lines onto page 2 (under a quarter of the frame) | cut the lines that spill; the Memo pack's tight spacing already applies |
| `page.spill` | yes | page 2 of a two-page document under 0.4 of the frame, or a last page under an eighth | set the source on one page, give page 2 a whole section, or move the closing box earlier |
| `list.split` | yes | a list of up to six items over two pages or columns (one break of a five- or six-item list in a column, two items or more each side, is allowed) | keep the lead-in short; split a long list into two with a sentence between |
| `heading.apart` | yes | a heading and its lead sentence at a page foot, the table they open on the next page | a shorter lead, or the sentence under the table |
| `heading.column` | yes | in a two-column body a heading at the foot of a column, its first lines in the next column | the converter spans a `자료:` or `Source:` line with its page-wide table; otherwise a shorter paragraph before the heading |
| `columns.balance` | yes | in a two-column body a column stopping a quarter of the frame short beside one that runs to the foot, or a last page with one column under half the depth of the other | the converter closes the columns with a continuous break and lets a five- or six-item list break once; otherwise move a long block |
| `notice.dash` | no | a notice written `예시 데이터 — …` | write `예시 데이터: …` (quote the value in the frontmatter) |

For `component.variety`, the page-1 block counts as a kind when it is a cover page, a memo block, a
control block or the title page of a two-column Journal, and a Journal's two-column body counts as
columns. A four-page Report with a masthead therefore needs two of callout, key figures and columns.

The prose lint reads the source per h1 section. The rules most often hit by a fresh draft:

- sentence lengths that vary too little within a section of four or more sentences and 80 or more words
  (mix short and long sentences);
- a spaced hyphen between words, or two em dashes in one section;
- in Korean, three or more of 하였다, 되었다, 할 수 있다 and similar endings in one section, translationese
  (에 있어서, 살펴보면), and loanwords such as 리뷰 and 리서치;
- in English, stock words (delve, furthermore, moreover, leverage, robust, comprehensive), two hedges in
  one sentence (perhaps, potentially, could, might), and three or more intensifiers (very, highly,
  extremely) in one section.

Section names Introduction, Methods, Results and Discussion pull in manuscript rules (citations, passive
voice); a report does not need those names.
