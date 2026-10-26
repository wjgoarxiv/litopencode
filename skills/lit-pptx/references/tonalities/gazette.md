# Gazette

Gazette is a Korean briefing paper set as slides. A slate header band carries the title on content
pages, a boxed one-line conclusion sits on top, itemised evidence fills two columns at reading size,
and a red key line is the only accent. It is built for decks that are read at a desk, not presented.
Pack file: `templates/tonalities/gazette/pack.yaml`.

## Use it for

- 보고서형 덱: policy briefings, internal reports and proposals circulated before a meeting.
- 경영 보고 decks that are read alone, with tables, schedules and a decision page.
- Any Korean deck with long bodies (about 150 Hangul or more per content slide).

## Wrong for

- A live talk: the density that serves a reader overwhelms a listener. Use signal, night or ledger.
- Chart-led content: Gazette lists no chart family. A chart-heavy report belongs to ledger.
- Photo-led content.
- English decks: it works, but its conventions (개조식, 붙임, 건의 사항) are Korean document habits.

## Palette roles

| Role | Colour | Used for |
|---|---|---|
| ground / surface | white / pale slate `#F1F4F8` | background, table banding |
| ink / ink-muted | deep slate `#1A2230` / grey `#4A5568` | text |
| line | grey-blue `#C8D0DA` | grid rules, box outline |
| accent | key-line red `#A61B1B` | the key line only |
| accent-deep / accent-tint | slate blue `#233A4F` / pale slate `#E8EEF4` | deep text / tint |
| field / on-field | slate blue `#233A4F` / white | header band, table header, cover band |
| positive / negative | green `#1E7A3F` / ink | gains; losses in ink with their sign |
| series | red, slate blue, grey, olive | charts (rare here) |

## Type

Pretendard throughout. Compact ramp at density 10 (body 13 pt, tables 11 pt). Cover and statement titles take the hero step (60 pt) when their words fit; `hero: false` in the front matter turns it off. A figure is never larger than a title.

## Dials

Density 10, variance 4: exactly three title treatments in a deck of eight or more slides. Gazette is
the pack most likely to need a `title:` key to satisfy the variety checks, because its pages are
meant to look alike.

## Title treatments by role

| Role | Default treatment |
|---|---|
| content | band |
| data | top-rule |
| data-takeaway | side-rail |
| sequence | kicker-numeral |
| image | side-rail |
| statement | band (no statement treatment) |
| reference | top-rule |
| definition | side-rail |

Treatments: band, top-rule, kicker-numeral, side-rail. Top-rule draws a hairline across the width.

## Families and variants

Families: summary-box-list, text-two-column, text-column, ledger-table, table-insight, comparison,
timeline, matrix-2x2, agenda, references-appendix.

Covers: cover-band, cover-typographic, cover-index. Sections: section-band, section-rule. Closings:
closing-decision-box (건의 사항), closing-ask.

Display devices: cover `band`, big number in an `outline`, closing decision in a `box` with an
outline, and `index: true`: a section page repeats the agenda with the current part marked.

## Tables and charts

- Tables `header-fill`: slate blue header with white labels, a full grid of rules, pale slate
  banding, numbers right-aligned, totals bold. The densest table style of the eight.
- Charts: hairline gridlines, direct labels.
- Images: hairline frame.

## Decoration vocabulary

header-band, box-outline, hairline-rule, numeral.

## Fill behaviour

`fill-order`: step-up (off at density 10), distribute, change-family, anchor-visual.

## Writing for Gazette

- Open with `summary-box-list`: a `::: key-message` of one to three lines that states the proposal
  with its numbers, then four to six headed groups (현황, 원인, 방안, 재원, 운영, 일정) of one or two
  sub-points each.
- Keep 개조식 discipline: each level a real sub-point, five items or fewer per level, the same
  endings throughout a list (noun endings or -함/-임 forms in bullets are fine; titles stay labels).
- Tables are the evidence: seven rows with a totals row is normal here.
- End with `closing-decision-box` (건의 사항) and a `references-appendix` titled 붙임.
- No more than three text families in a row; break them with a table, a timeline or a matrix.

## Avoid

- English section kickers.
- Red for anything but the key line.
- A summary box longer than three lines.
- More than three text families in a row.

## A sample fragment

```text
---
tonality: gazette
title: 공공도서관 야간 개관 확대 방안
date: 2026-10-06
notice: 예시 데이터
---
layout: summary-box-list

## 핵심 요약

::: key-message
2027년부터 구립도서관 12곳의 평일 개관을 22시까지 늘리고, 연 운영비 9.4억 원은 인력 재배치로 절반을 충당하는 안
:::

- **현황** 평일 18시 폐관 도서관 12곳, 18시 이후 이용 요청 연 3,100건
  (1) 직장인 회원 비율 41%, 평일 이용률은 21%에 그침
- **방안** 22시까지 연장, 열람실과 대출 창구만 운영
  (1) 야간 인력 24명 중 12명은 주간 인력 재배치
- **재원** 연 9.4억 원, 재배치로 4.6억 원 절감
  (1) 순증 예산 4.8억 원
- **효과** 평일 방문 연 18만 명 증가 예상
  (1) 시범 운영 2곳의 야간 방문은 하루 평균 160명
- **운영** 열람실 좌석 60%와 무인 반납기만 개방
  (1) 야간 안전 요원 1명씩 배치, 경비 용역에 포함
- **일정** 27년 1월 4곳, 7월 8곳으로 두 단계 확대
  (1) 1단계 이용률 30% 미만이면 2단계 대상 조정
- 출처: 예시구 도서관 이용 통계(2026년 1~8월), 시범 운영 결과
```

## Examples

- `examples/06-policy-briefing-gazette-ko.md`: Korean public EV-charging policy briefing, 11 slides.
