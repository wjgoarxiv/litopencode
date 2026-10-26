# Studio

Studio is a magazine spread. The 12-column grid is visible as fine column hairlines, titles carry a
bar in the left margin or open a page at display size, splits are asymmetric, real numbers are set prominently on
tinted panels, and a dark ochre accent marks the one thing to look at. Pack file:
`templates/tonalities/studio/pack.yaml`.

## Use it for

- Annual reviews and impact reports told as a story with photographs and a few charts.
- Exhibition, programme and place proposals (전시 기획, 공간 제안).
- Public lectures and editorial narratives where images and figures alternate.

## Wrong for

- Dense data reviews: editorial white space starves tables. Studio lists no table family.
- Korean reading briefs: gazette.
- Decks with no photographs and few numbers: the editorial grid then frames nothing.

## Palette roles

| Role | Colour | Used for |
|---|---|---|
| ground / surface | white / warm pale grey `#F2F2F0` | background, rail, number tint |
| ink / ink-muted | near-black `#141414` / grey `#525252` | text |
| line | warm grey `#D2D2CE` | column hairlines, rules |
| accent | dark ochre `#8A5A00` | the one thing to look at |
| accent-deep / accent-tint | deep brown `#4D3200` / pale sand `#F5ECD9` | deep text / number panel tint |
| field / on-field | near-black / white | closing field, caption panel |
| positive / negative | green `#1E7A3F` / red `#B3261E` | signed deltas |
| series | ochre, ink, grey, slate blue | charts |

## Type

Pretendard throughout. Compact ramp at density 10; display tracks tight (−2). Cover and statement titles take the hero step (60 pt) when their words fit; `hero: false` in the front matter turns it off. A figure is never larger than a title.

## Dials

Density 10, variance 8: up to five treatments, all five of the pack's. Studio decks show the most
title variety of the eight.

## Title treatments by role

| Role | Default treatment |
|---|---|
| content | side-rail |
| data | top-plain-large |
| data-takeaway | side-rail |
| sequence | side-rail |
| image | side-rail |
| statement | statement |
| reference | side-rail |
| definition | side-rail |

An image slide takes the side rail: the picture and its facts split unevenly in the body under the
title.

Treatments: side-rail, statement, top-plain-large, bottom-anchor, overlay. The statement is drawn
`rules`: the sentence on the open page between a hairline above it and one under its support line
(the earlier offset rail beside it stood empty). Studio has no
kicker-numeral; sequences take the side rail.

## Families and variants

Families: asymmetric-feature, big-number, image-split, image-full, photo-grid, text-two-column,
chart-insight, kpi-row, timeline, comparison, statement.

Covers: cover-split-image (takes the first image in the deck), cover-rail, cover-numeral. Sections:
section-numeral, section-rail. Closings: closing-contact-split, closing-summary-list.

Display devices: no cover device of its own (covers draw their variant plainly), statement `rules`,
big number on a tint, closing step in a `band`.

## Tables and charts

- Tables `open`: no header fill, one rule under the header, no banding, numbers right-aligned,
  totals bold. Studio lists no table family, so tables appear only as KPI rows and closing asks.
- Charts: no gridlines, direct labels, the accent on one series. Column hairlines run
  in the gutter beside a chart's takeaways.
- Images: no frame.

## Decoration vocabulary

column-hairlines, numeral, rail-fill, colour-field, caption-band.

## Fill behaviour

`fill-order`: change-family, step-up (off at density 10), anchor-visual, distribute.

## Writing for Studio

- Keep titles short: about 29 Korean glyphs per line at reading size and two lines at most; a longer
  title moves the slide to another treatment.
- Alternate: an image slide, a numbers slide, a text slide. Studio's variance rewards a deck whose
  slides genuinely differ in job.
- `text-two-column` needs four to six groups with two or three sub-points each to fill both columns
  at density 10.
- Large numerals must be real figures with a basis row; the engine caps them at title size anyway.
- Timeline events get a sixth of the width each; keep them short (`Homework help in all 25 rooms`
  rather than a full clause).
- When OF-111 reports a repeated layout, the usual fix is a `title:` key on one repeated slide
  (`top-plain-large` on a chart slide, `bottom-anchor` on a timeline, `side-rail` on a KPI row).

## Avoid

- Large numerals that are not real figures.
- Column hairlines through text.
- Two side-rail slides with the same split in a row.
- Centred body text.

## A sample fragment

```text
---
tonality: studio
title: Harbour promenade proposal 2027
date: 2026-10-06
notice: Sample data and stand-in photos
---
layout: asymmetric-feature

## The promenade today

![North pier at dusk, 2026](assets/example-b.png)

- **Length** 2.4 km from the ferry terminal to the old customs house
- **Visitors** about 9,000 on a summer weekend day, 1,200 on a winter weekday
- **Seating** 46 benches, none shaded, none with backs
- **Lighting** 31% of the route under 10 lx after dark
- Source: Example City visitor counts and lighting survey, 2026
---
layout: kpi-row
title: side-rail

## What the first phase delivers

| Shaded seats | Lit route | Trees | Cost |
|---|---|---|---|
| 180 | 100% | 64 | 3.8M EUR |
| was 0 | above 10 lx | native species | phase 1 of 2 |

- Phase 1 covers the 1.1 km between the terminal and the market hall
- Source: Example City outline design, September 2026
```

## Examples

- `examples/07-annual-story-studio-en.md`: English reading-rooms annual review, 9 slides.
- `examples/12-exhibition-proposal-studio-ko.md`: Korean architecture photo exhibition proposal,
  9 slides.
