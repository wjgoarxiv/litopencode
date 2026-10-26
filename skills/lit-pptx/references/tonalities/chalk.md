# Chalk

Chalk is a good teacher's board, cleaned up. Numbered steps, one concept marked per slide, a fenced
box for the definition or the common mistake, slightly rounded surfaces, a dark green-black rail and
a warm rust accent for the thing being taught. Pack file: `templates/tonalities/chalk/pack.yaml`.

## Use it for

- Lectures, training sessions and tutorials (강의, 특강, 사내 교육).
- Worked examples and how-to sequences with three or more steps.
- Research tutorials where definitions and formulas carry the talk.

## Wrong for

- Decision decks: the step rhythm reads as padding to an executive.
- Data reviews: Chalk lists only `table-insight` for numbers, no chart family.
- Pitches.

## Palette roles

| Role | Colour | Used for |
|---|---|---|
| ground / surface | off-white `#FAFBFC` / pale blue-grey `#EEF2F5` | background, aside boxes |
| ink / ink-muted | slate `#1F2933` / grey `#4E5A66` | text |
| line | grey `#CBD3DA` | rules |
| accent | rust `#9A3412` | the concept being taught, step numerals, formula |
| accent-deep / accent-tint | dark rust `#6B2409` / pale apricot `#FCEBE0` | table header text / table header fill |
| field / on-field | board green-black `#1F3B33` / white | the rail under a side title, cover rail |
| positive / negative | green `#1E7A3F` / red `#B3261E` | signed values |
| series | rust, board green, grey, blue | charts |

## Type

Pretendard throughout. Compact ramp at density 10. Surfaces take a 6 pt radius; chalk is the only light pack
with rounded corners (night, on its dark ground, is the other). Cover and statement titles take the hero step (60 pt) when their words fit; `hero: false` in the front matter turns it off. A figure is never larger than a title.

## Dials

Density 10, variance 6: up to four of its four treatments.

## Title treatments by role

| Role | Default treatment |
|---|---|
| content | top-rule |
| data | top-rule |
| data-takeaway | side-rail |
| sequence | kicker-numeral |
| image | side-rail |
| statement | statement |
| reference | top-rule |
| definition | side-rail |

Treatments: kicker-numeral, top-rule, side-rail, statement. The side rail is the board colour
(`rail: field`): a full-height bar in the left margin beside the title. The kicker numeral stands
right of the title, in the accent. The statement is drawn `drench`, on the field
over the whole page. Top-rule draws the short rust accent bar. A comparison sets its criteria as row
heads in the body under a `side-rail` title (`structure: comparison: side-rail`), kept even when the deck
already leans on the rail. The agenda draws no numeral (OF-119), so a chalk deck whose only kicker
was its agenda needs a step or sidebar slide under `kicker-numeral` to keep three treatments
(OF-110); a sidebar note set across the top adds a top-title grid slide that can push that
composition past 40 % of the content slides (OF-111).

## Families and variants

Families: step-diagram, process, method, sidebar-note, comparison, image-split, quote, agenda,
statement, text-column, table-insight.

Covers: cover-rail, cover-typographic, cover-numeral. Sections: section-numeral, section-rail.
Closings: closing-summary-list, closing-ask.

Display devices: cover `rail`, statement `drench`, big number on a tint, closing step in a `box`.

## Tables and charts

- Tables `header-fill`: a pale apricot header with dark rust labels, row rules, no banding, numbers
  right-aligned, totals bold.
- Charts (if a chart appears in a table-insight): hairline gridlines, direct labels.
- Images: no frame.

## Decoration vocabulary

accent-rule, mark-underline (listed; not drawn by the current engine), rail-fill, numeral.

## Fill behaviour

`fill-order`: distribute, step-up (off at density 10), change-family, anchor-visual. Teaching slides
are text-led, so a short Chalk slide spreads its gaps; the gate then reports the empty band, which
means the slide needs more worked detail.

## Writing for Chalk

- Put the definition or common mistake in `::: main-box` on a `sidebar-note` slide, never buried in
  a bullet. Give the main column enough material (five groups with two sub-points is about right at
  density 10).
- A `method` slide wants the formula as one plain line, then four or five terms each with one or two
  sub-points. The formula runs across the body's columns and the terms in two
  columns under it. Do not add a figure to the same slide; with a figure the formula line is not
  drawn.
- Number step heads in the text (`- **1. 목표 온도 강하**`) and give each step the value it produces.
- A `closing-summary-list` reads as finished with five or six one-line conclusions.

## Avoid

- More than one marked term per slide.
- Numerals on points that are not a sequence.
- Definitions buried in bullets instead of the aside.

## A sample fragment

```text
---
tonality: chalk
title: 회귀분석 입문 4주차
date: 2026-10-06
notice: 예시 강의 자료
---
layout: step-diagram

## 단순 회귀 기울기 계산 순서

- **1. 평균** x 평균 4.0, y 평균 12.6을 먼저 구함
- **2. 편차곱 합** Σ(x−x̄)(y−ȳ) = 38.4
- **3. 편차제곱 합** Σ(x−x̄)² = 16.0
- **4. 기울기** b = 38.4 / 16.0 = 2.4, 절편 a = 12.6 − 2.4 × 4.0 = 3.0
- 표본 5개의 손 계산 예시로, 스프레드시트 결과와 소수 둘째 자리까지 같음
- 출처: 예시 교재 4장 예제 4.1
```

## Examples

- `examples/04-lecture-chalk-ko.md`: Korean thermodynamics lecture on hydrate phase equilibria, 9
  slides.
