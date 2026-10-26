# Ledger

Ledger sets a deck like a set of accounts made readable: small exact type, with
tables and figure rows doing most of the talking. Colour is rationed to two jobs, marking the
current period and the one number that matters. Pack file: `templates/tonalities/ledger/pack.yaml`.

## Use it for

- Management and business reviews read closely, on screen or at the table (경영 실적, 사업부 리뷰).
- Weekly and monthly status updates with work items, owners, defects and budget.
- Data reviews where the audience questions every figure and wants the table, not just the chart.
- Any deck where 30 % or more of the slides hold a table or chart and the reader has time.

## Wrong for

- A live pitch with little data: Ledger's restraint makes a thin deck look thinner. Use signal.
- A Korean briefing that is read as prose with boxed conclusions: gazette fits that better.
- Photo-led showcases: Ledger lists no image family.
- A dark keynote hall: night.

## Palette roles

| Role | Colour | Used for |
|---|---|---|
| ground | white `#FFFFFF` | every slide background |
| surface | pale grey `#F2F4F6` | rail fill, quiet panels |
| ink / ink-muted | near-black slate `#16212C` / slate grey `#4B5866` | text, secondary text |
| line | light grey `#D0D6DC` | hairlines, table rules |
| accent | deep teal green `#0E6B5A` | the current period, the figure that matters, accent rule |
| accent-deep / accent-tint | dark teal `#0A4438` / pale mint `#E2F0EC` | field and table header / number panel tint |
| field / on-field | dark teal `#0A4438` / white | table header row, filled devices |
| positive / negative | green `#1E7A3F` / red `#B3261E` | signed deltas |
| series | teal, slate, ochre, steel blue | chart series in that order |

## Type

Pretendard Regular and Bold throughout (A2Z display and numerals only with `faces: a2z`). At
density 10 the compact ramp applies: body 13 pt, labels and table cells 11 pt, sources 9 pt, titles
26 pt. Titles track slightly tight. Cover and statement titles take the hero step (60 pt) when their words fit; `hero: false` in the front matter turns it off. A figure is never larger than a title.

## Dials

Density 10, variance 5: at most four title treatments in one deck, of the pack's four.

## Title treatments by role

| Role | Default treatment |
|---|---|
| content | top-rule |
| data | top-rule |
| data-takeaway | side-rail |
| sequence | kicker-numeral |
| image | bottom-anchor |
| statement | side-rail (no statement treatment; a statement slide becomes a top-rule title) |
| reference | top-rule |
| definition | side-rail |

The pack's treatments are top-rule, side-rail, kicker-numeral and bottom-anchor; a slide may take
any of them that its family allows (`--list-layouts ledger` prints the pairs). Its top-rule draws
the short accent bar (`accent-rule`), not a hairline. kicker-numeral appears on the agenda (the
part count) and on content slides after a section (the part number).

## Families and variants

Families: kpi-row, kpi-over-chart, dashboard-grid, ledger-table, table-insight, chart-insight,
full-chart, big-number, comparison, timeline, matrix-2x2, agenda, text-two-column,
references-appendix.

Covers: cover-figures (needs a KPI table in the deck), cover-typographic, cover-index (needs an
agenda or two sections). Sections: section-rule, section-numeral. Closings: closing-decision-box,
closing-ask.

Display devices: the cover device is `figures`, big numbers stand on a tinted panel, a closing's
next step sits in a box, and `index: true` turns section-rule pages into an index of the agenda
with the current part marked.

## Tables and charts

- Tables in the `ledger` style: the header row is the deck's one dark mass (dark teal field, white
  labels); rules under the header and above the totals only; no banding; numbers right-aligned;
  totals bold.
- Charts: hairline gridlines, direct labels, one accent on muted series.
- Images (rare here): hairline frame.

## Decoration vocabulary

accent-rule, hairline-rule, rail-fill, numeral. Nothing else is drawn: no cards for counts that are
not results, no colour fields on content slides.

## Fill behaviour

`fill-order`: step-up (off at density 10), distribute, anchor-visual, change-family. Ledger slides
fill by spreading first; a short table slide therefore shows its gaps between rows and takeaways
rather than a larger font.

## Avoid

- KPI cards for counts that are not results (a headcount is not a KPI unless it is the result).
- More than one accent on a chart; highlight the current period only.
- Tables stretched by padding; add rows or takeaways instead.
- Side-rail on two data slides in a row.

## A sample fragment

```text
---
tonality: ledger
title: 2026년 3분기 구매 원가 리뷰
date: 2026-10-06
notice: 예시 데이터
---
layout: kpi-row

## 3분기 구매 원가 핵심 지표

| 구매액 | 단가 변동 | 절감액 | 계약 준수율 | 긴급 발주 |
|---|---|---|---|---|
| 1,920억 원 | +2.4% | 31억 원 | 94.1% | 38건 |
| 계획 대비 −1.8% | 전년 동기 대비 | 목표 28억 원 | 목표 95% | 전 분기 52건 |

- 원자재 단가 상승분 2.4% 중 1.1%p를 장기 계약으로 흡수
- 긴급 발주는 생산 계획 확정 시점을 사흘 앞당긴 뒤 27% 줄어듦
- 출처: 예시 기업 구매 시스템 집계(2026년 7~9월)
- 주: 단가 변동은 상위 50개 품목의 물량 가중 평균
---
layout: ledger-table

## 품목군별 구매액과 단가 변동

| 품목군 | 구매액 | 비중 | 단가 변동 | 절감액 |
|---|---|---|---|---|
| 철강재 | 640억 원 | 33% | +3.9% | 9억 원 |
| 수지류 | 410억 원 | 21% | +1.2% | 8억 원 |
| 전장 부품 | 380억 원 | 20% | +2.8% | 6억 원 |
| 포장재 | 190억 원 | 10% | −0.6% | 5억 원 |
| 기타 | 300억 원 | 16% | +1.5% | 3억 원 |
| 합계 | 1,920억 원 | 100% | +2.4% | 31억 원 |

> 표 1. 품목군별 3분기 구매 실적 (예시 데이터)

- 철강재가 단가 상승의 절반 이상을 차지
- 포장재는 규격 통일 뒤 유일하게 단가가 내림
- 수지류 절감 8억 원은 공급사 두 곳 경쟁 입찰 결과
- 출처: 예시 기업 구매 시스템 집계(2026년 7~9월)
```

## Examples

- `examples/01-ops-review-ledger-ko.md`: Korean logistics operations review, 11 slides.
- `examples/09-status-update-ledger-en.md`: English programme status update, 9 slides.
