# Atlas

Atlas is a picture book with captions. Photographs bleed to the edge, titles sit on dark panels
over pictures or under large images, text stays short and calm, and the photographs bring the
colour; the pack's own accent is a quiet navy. Pack file: `templates/tonalities/atlas/pack.yaml`.

## Use it for

- Field surveys and site reports where the photographs are the evidence (현장 조사, 시설 점검).
- Product showcases, portfolios, exhibitions and places.
- Any deck where 30 % or more of the slides hold a real photograph or screenshot.

## Wrong for

- Decks without real images: a look built around pictures turns into empty frames. Never ship grey
  placeholder boxes; if there are no photographs, pick another pack.
- Results tables and charts: Atlas lists no table, chart or references family. A survey with a
  results table belongs to studio (charts) or ledger (tables).
- Long reading text.

## Palette roles

| Role | Colour | Used for |
|---|---|---|
| ground / surface | white / pale grey `#F3F4F5` | background, rail |
| ink / ink-muted | charcoal `#1A1D21` / grey `#555B63` | text |
| line | light grey `#D6D9DD` | hairlines |
| accent | muted navy `#2B4C7E` | the one marked figure or label |
| accent-deep / accent-tint | dark navy `#1B2F4E` / pale blue-grey `#E6ECF4` | deep text / number tint |
| field / on-field | charcoal / white | caption panels, cover plate, closing field |
| positive / negative | green `#1E7A3F` / red `#B3261E` | signed deltas |
| series | navy, grey, bronze, sage | charts, if any |

## Type

Pretendard throughout. Compact ramp at density 10. Titles at normal tracking, display slightly
tight.

## Dials

Density 10, variance 7: up to five treatments, which is all of Atlas's five.

## Title treatments by role

| Role | Default treatment |
|---|---|
| content | side-rail |
| data | top-plain-large |
| data-takeaway | bottom-anchor |
| sequence | top-plain-large |
| image | overlay |
| statement | statement |
| reference | side-rail |
| definition | side-rail |

Treatments: overlay, bottom-anchor, side-rail, top-plain-large, statement. Overlay applies only to
`image-full`. The cover is drawn on a `plate`, the dark field under the text, that hugs the title
and its lines and bleeds off the page foot. A statement or quote stands on the whole-page field
(`drench`): a plate under the lower half would leave the page above it open.

## Families and variants

Families: image-full, image-split, photo-grid, figure-pair, asymmetric-feature, kpi-row,
comparison, timeline, text-column, statement.

Covers: cover-full-image and cover-split-image (both take the first image in the deck; the cover
slide itself holds only the title), cover-typographic. Sections: section-image (needs its own
image), section-field. Closings: closing-contact-split, closing-ask.

Display devices: cover `plate`, statement `drench`, big number on a tint, closing step in a `band`.

## Tables and charts

- Tables `light-grid`: no header fill, row rules, no banding, numbers right-aligned, totals bold.
  A table can only appear inside a family that holds one (kpi-row, a closing).
- Charts: hairline gridlines, direct labels.
- Images: no frame; pictures are cropped to their box with their own proportions, never stretched.

## Decoration vocabulary

caption-band, hairline-rule, colour-field. Text is never placed straight on a photograph; the
panel carries it.

## Fill behaviour

`fill-order`: anchor-visual, change-family, distribute, step-up. The picture takes the room first.

## Writing for Atlas

- Every image line needs a caption that says what, where and when (`중류 31번 지점, 포장 들뜸과
  배수구 막힘, 9월 15일`). The caption is numbered automatically.
- Pair photographs with numbers on the next slide: a KPI row of survey counts, a timeline of works.
- A figure pair needs one interpretation line with figures (`밤 조도 3 lx, 권장값의 3분의 1`).
- In image paths use `assets/...` relative to the deck source; the skill ships no photographs.

## Avoid

- Text placed straight on photographs.
- Images in card frames.
- More than three images in one row.
- Grey placeholder boxes in a delivered deck.

## A sample fragment

```text
---
tonality: atlas
title: 해안 산책로 시설 점검
date: 2026-10-06
notice: 예시 데이터와 대체 사진
---
layout: image-full

## 북측 구간 데크 침하 지점

![북측 3번 데크, 침하 4cm와 난간 흔들림, 9월 22일](assets/example-a.png)
---
layout: figure-pair

## 보수 전후의 남측 계단

![보수 전, 디딤판 균열 7곳](assets/example-b.png)
![보수 뒤, 미끄럼 방지 마감과 조명 2기](assets/example-c.png)

- 보수 뒤 야간 이용자는 하루 평균 140명에서 230명으로 늘었고 미끄럼 신고는 0건
- 출처: 예시 시설관리과 점검 기록(2026년 6~9월)
```

## Examples

- `examples/03-field-survey-atlas-ko.md`: Korean riverside park field survey, 9 slides.
