# Choosing a direction before writing

A Word document built by this skill takes its page structure from one of six tonality packs in
`templates/tonalities/`: Report, Brief, Manual, Proposal, Memo and Journal. The pack decides what stands
on page 1, how the summary is set, whether headings carry numbers, which page components the source may
use, what the running head carries and whether a contents list appears. Colour plays almost no part:
every pack sets text and headings in near-black ink, and four of the six allow one muted accent on two
kinds of element at most.

The pack is chosen before a line of the Markdown source is written, because the choice changes the
source itself. A Brief wants its first section written as three or four paragraphs that each open with
a finished sentence. A Manual wants numbered steps. A Proposal wants a budget table and one decision box.
Rewriting a Report source into a Brief after the fact usually means rewriting most of it.

This file covers the decision: the inputs, the mapping from document type to candidates, how content
signals reorder the candidates, the direction card that records the choice, the dials, and what to do
when the request names a journal instead of a look.

## Two cases that skip the choice

**A named publisher.** When the user names a journal or publisher profile (Elsevier, ACS, IEEE, Nature,
or the Korean generic profile by name), the document goes down the publisher path and no tonality is
picked. Convert with `python3 <skill>/run.py md-to-docx draft.md draft.docx --publisher elsevier` and gate
with `python3 <skill>/run.py qa draft.docx --source draft.md --publisher elsevier --kind manuscript`. The
converter refuses `--tonality` together with `--publisher`, and it also stops when the frontmatter holds
`tonality:` while `--publisher` is given. A manuscript keeps the publisher's own section order, heading
case and caption style; nothing in this file applies to it.

**A bare request.** A bare `lit` request for a report, or any request that gives a topic and nothing
else, asks no questions. Pick the tonality from the tables below, write the direction card, build the
document and say in the reply which tonality was used and which two were considered. A question about
format, font or look costs the user a round trip and almost never changes the outcome; the card makes the
choice visible so the user can redirect it in one sentence.

An explicit request that asks for a different look ("make it a one-page brief instead", "use the manual
layout") overrides the tables. So does a frontmatter `tonality:` line the user wrote. The skill keeps the
user's choice even when the signals point elsewhere, and says so on the card.

## The three inputs

**Document type.** What the user calls the document and what it is for: a results report, a briefing for
a decision, an operating procedure, a funding or investment proposal, a notice or memo, a long-form essay
or research summary. Korean requests often name the type directly (보고서, 검토 보고, 절차서, 제안서,
안내문, 기획서). When the type is ambiguous, the purpose decides: a document that asks a reader to approve
something within days is a Brief or a Memo even if the user said "report".

**Reader.** Who reads it and how. A department head deciding on a budget reads the first page and the
decision box. A technician following a procedure reads one section at a time with the document open on a
bench. A committee member reads a long paper at a desk. The reader sets the length budget and whether the
summary must stand alone.

**Content signals.** What the source material actually holds: how many tables, how many figures, how much
prose, how many numbered procedures or warnings, which language, and the expected length. When the user
supplies files, count these from the files. When the skill writes the content itself, count them from the
outline before drafting.

## Document type to candidates

Each row lists the candidates in order; the first is the default. The dials are each pack's own values
(the `dials:` line of its YAML), which the converter uses unless told otherwise.

| Document type or wording | Candidates, default first | Pack dials of the default |
|---|---|---|
| Results report, analysis, periodic report (보고서, 결과 보고, 분석, 실적) | Report, Brief, Manual | density 9, variance 5 |
| Decision briefing of one to three pages (검토 보고, 현황 보고, 개조식 보고) | Brief, Memo, Report | density 9, variance 3 |
| Procedure, guide, manual, onboarding (절차서, 매뉴얼, 가이드, 운영 지침) | Manual, Report | density 9, variance 6 |
| Proposal, plan, pitch, funding request (제안서, 기획서, 계획서, 사업 계획) | Proposal, Report, Brief | density 8, variance 6 |
| Notice, memo, letter of one or two pages (안내문, 공지, 메모, 협조 요청) | Memo, Brief | density 9, variance 2 |
| Essay, white paper, newsletter, research summary not for a journal | Journal, Report | density 9, variance 6 |
| Manuscript for a named journal | that publisher profile | none |

## Signals that reorder the candidates

Signals change the order inside a row. They never pull in a tonality from outside the row: a proposal with
many tables becomes a Report-first proposal, not a Manual.

| Signal in the source or outline | Effect on the order |
|---|---|
| Four or more tables, or tables make up more than about 30 % of the blocks | Report or Manual moves up |
| Three or more figures | Proposal or Journal moves up |
| Under about 900 words, or the user says one or two pages | Memo or Brief moves up |
| English, mostly continuous prose, few tables | Journal moves up |
| Many warnings, numbered procedures or check items | Manual moves up |
| A single decision the reader must make, with a deadline | Brief moves up, and the decision goes in a `kind=key` callout |
| A budget table and a schedule | Proposal moves up |

When two signals pull in opposite directions, the purpose wins. A forty-row data appendix attached to a
two-page decision is still a Brief; the appendix becomes a second document or a short table of the five
rows the decision depends on.

## What each tonality sets

Read this table when two candidates seem equally good. Two tonalities chosen for the same source should
differ in at least three of these columns, which is also what the gate's `--compare` mode checks.

| Tonality | Page 1 | Summary form | Heading numbers | Components it accepts | Running head | Contents |
|---|---|---|---|---|---|---|
| Report | masthead title block, series line with date | prose, optional key-figure strip | Korean Ⅰ. / 1. / 가., English 1 / 1.1 | keyfigures, callout, columns | footer: short title left, folio right | from about five pages |
| Brief | compact masthead, decision box directly under it | numbered points ① to ④, bold lead sentence each | none; each h1 opens under a hairline | callout (one), columns | footer: folio right | never |
| Manual | title over a document-control block | prose | 1 / 1.1 | callout, sidebar, columns | header: short title; footer: folio right | from about five pages |
| Proposal | separate typographic cover page | prose with one key-figure strip | none | keyfigures, callout (one), columns | footer: folio centred | never |
| Memo | label, subject as title, To / From / Date rows | prose | none | none | footer: folio right, from page 2 | never |
| Journal | masthead with byline, abstract, keywords | prose (abstract above) | 1 / 1.1 | callout | header: short title left, folio right | never |

No tonality prints a running head on the page that carries the title block; the Proposal prints none on
its cover and starts the folio at 1 on the first body page.

## The direction card

Before building, write a direction card. It goes in the reply (short form) and in the task's build log
(full form). It is the record of why the document looks the way it does, and it is the checklist the
draft is written against.

The card has eight lines:

1. **Type.** The document type in the user's words, plus the purpose in one clause.
2. **Reader.** Who reads it and how far they read.
3. **Tonality and two alternatives.** The chosen pack, then two candidates from the same row with the
   reason each lost.
4. **Reason from signals.** The counted signals that decided the order: table count, figure count, word
   estimate, language, procedures, decision.
5. **Dials.** Density and variance, normally the pack's values. Any change is stated with its reason.
6. **Page 1 and headings.** What the title block or cover holds (kicker, subtitle, byline, notice, lead
   sentence) and how headings are treated (numbered or not, the hairline in a Brief).
7. **Components.** Each component the source will use, with a one-line purpose. A component without a
   purpose line is not used. Headings, paragraphs, lists, tables and figures are not components and are
   not listed.
8. **Wrong if.** One sentence naming the fact that would make this direction the wrong one. This is the
   line a reviewer checks first.

A full card for the Korean report among the worked examples:

```text
Direction card
Type: 시설 운영 결과 보고서 (사내 충전소 1년 실적과 2027년 예산 승인)
Reader: 경영지원본부장과 재무팀. 요약과 결정 요청을 먼저 읽고 표는 필요한 곳만 확인
Tonality: Report
  Alternative Brief: 결정 사항은 하나지만 근거 표가 5개라 3쪽 안에 들어가지 않음
  Alternative Manual: 절차 문서가 아님
Signals: 표 5개, 그림 0개, 약 3,400자, 한국어, 결정 요청 1건
Dials: density 9, variance 5 (팩 기본값)
Page 1: masthead, series line "시설 운영 보고 2026-4호" with date, subtitle, byline, notice under the rule
Headings: Ⅰ. / 1. numbered in ink, no rules
Components:
  keyfigures: 요약의 1년 실적 세 가지(충전 횟수, 기당 일평균, 순운영비), 각각 기준 표기
  callout key: 2027년 추가 예산 승인 요청
Wrong if: 독자가 이미 실적을 알고 있어 결정 요청만 필요하다면 Brief가 맞다
```

The short form in the reply is two or three sentences: the tonality, the two alternatives and the reason
in plain words. For example: "Built as a Report (numbered sections, contents from five pages, one
key-figure strip). A Brief was the alternative if only the budget decision mattered; a Manual does not fit
a results document."

## The dials

Each pack carries two dials, both integers from 1 to 10. The converter accepts them from the command line
(`--density 8`) or from frontmatter (`density: 8`), and prints the values it used in its success line, for
example `[tonality=Report, density=9, variance=5, locale=ko]`.

**Density** is the dial that changes the page. It selects the margins and the body leading:

| Density | Margins top / bottom / sides (mm) | Korean body pitch | English body pitch |
|---|---|---|---|
| 1 to 2 | 30 / 32 / 30 | 185 % of size | 140 % |
| 3 to 4 | 28 / 30 / 28 | 185 % | 140 % |
| 5 to 6 | 27 / 29 / 27 | 180 % | 137 % |
| 7 | 26 / 28 / 26 | 180 % | 137 % |
| 8 | 26 / 28 / 26 | 175 % | 133 % |
| 9 | 25 / 27 / 25 | 175 % | 133 % |
| 10 | 24 / 26 / 25 | 175 % | 133 % |

Density 3 or lower also adds half a point to the body size. The side margins never drop under 25 mm, so
the text block on A4 stays at 160 mm or narrower whatever the dial says.

**Variance** describes how far the layout may depart from the pack's plainest form: how freely the source
mixes components, side-by-side blocks and figure sizes. The converter validates it and prints it, and in
this engine version no layout value is computed from it. It belongs on the card as a statement of intent:
a variance of 2 or 3 means the author keeps to paragraphs, tables and at most one box; 6 means the author
may use the full component set the pack allows, within the budget.

**Moving a dial.** Move either dial by at most 2 from the pack value without asking, and state the change
and its reason on the card. A density of 7 for a Report that will be read on paper by older readers is a
reasonable unasked change; a density of 3 for the same Report changes its character and needs the user's
word. Density cannot rescue a document that is too long for its tonality: a Brief that runs to five pages
at density 10 is a Report.

## Saying it and keeping it

The card is written once, before the build, and changed only when the build shows the direction was
wrong. If the gate reports `component.variety` on a four-page Report, the fix is to add a component the
card already justifies or to cut the document to three pages, not to add a box with no purpose. If the
rendered pages show a Brief spilling to four pages, the direction was wrong; rewrite as a Report and
update the card's Wrong-if line to say what happened.

Record the card in the task's build log next to the conversion line and the qa JSON. When the user asks
why the document looks as it does, the card is the answer.

## Comparing two directions

When the user wants to see alternatives, build the same source in two tonalities and compare them:

```bash
python3 <skill>/run.py md-to-docx draft.md report.docx --tonality Report
python3 <skill>/run.py md-to-docx draft.md brief.docx --tonality Brief
python3 <skill>/run.py qa report.docx --source draft.md --compare brief.docx
```

The compare run fails with `tonality.structure` when the two documents differ in fewer than three of the
six structural features (title block, summary form, heading numbering, component set, running head,
contents). Two packs that pass this still need a human look at the first pages of each; the check proves
the structures differ, not that both are good. A source written for one tonality rarely reads well in
another, so a comparison is a decision aid, not a deliverable.

## Failure patterns

- **Choosing by colour.** The packs are not themes. Choosing Proposal "because it looks warmer" gives a
  separate cover page and a centred folio to a document that needed numbered sections.
- **A Report for everything.** The default row is a starting point. A one-page notice set as a Report
  gets a contents check, a series line and Roman numerals it has no use for.
- **Asking instead of choosing.** A bare request gets a built document and a card, not a menu.
- **A component without a purpose line.** If the card cannot say what a callout is for in one line, the
  content belongs in a paragraph.
- **Overriding the user.** A frontmatter `tonality:` written by the user, or an explicit instruction,
  stays even when the signals disagree; the card notes the disagreement.
- **Mixing paths.** A tonality and a publisher in the same run is refused by the converter. A journal
  submission never takes a tonality, and a tonality document is never gated with `--kind manuscript`.

## Where to look next

- `components.md`: the directive syntax the converter accepts and the component budget.
- `page-composition.md`: the page, the type, Korean conventions and pagination.
- `tonalities/<name>.md`: one sheet per pack, with a short source fragment.
- `examples/`: nine complete sources across all six tonalities, each converted and gated.
