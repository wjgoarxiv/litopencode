# Paper

Paper is a journal page projected. Ink on white, hairline rules instead of fills, figures first,
numbered captions, booktabs tables, and a single deep crimson that always means "the proposed
method". Pack file: `templates/tonalities/paper/pack.yaml`.

## Use it for

- Research talks, thesis defences, lab meetings and seminars (연구 발표, 학위 심사).
- Technical reviews built on figures, tables and citations.
- Written analyses that will be read as a document after the talk.

## Wrong for

- Sales, launch and fundraising audiences: the restraint reads as cold. Use signal or studio.
- Photo-led showcases: Paper has figure families but no full-bleed image family.
- Status updates with owners and budgets: ledger.

## Palette roles

| Role | Colour | Used for |
|---|---|---|
| ground / surface | white / near-white grey `#F5F5F6` | background, quiet panels |
| ink / ink-muted | near-black `#111418` / grey `#50565E` | text |
| line | grey `#C9CDD2` | hairlines, booktabs rules |
| accent | deep crimson `#8C1C2B` | the proposed method, and nothing else |
| accent-deep / accent-tint | dark crimson `#5E121C` / pale rose `#F6E6E8` | deep text / rare tint |
| field / on-field | near-black / white | section field |
| positive / negative | green `#1E6B3A` / grey `#50565E` | gains; losses in muted ink with their sign |
| series | crimson, ink, grey, steel blue | charts, in series order |

## Type

Pretendard throughout. Compact ramp at density 10; titles at normal tracking. Cover and statement titles take the hero step (60 pt) when their words fit; `hero: false` in the front matter turns it off. A figure is never larger than a title.

## Dials

Density 10, variance 5: up to four of its four treatments.

## Title treatments by role

| Role | Default treatment |
|---|---|
| content | top-rule |
| data | top-rule |
| data-takeaway | bottom-anchor |
| sequence | top-rule |
| image | bottom-anchor |
| statement | statement |
| reference | top-rule |
| definition | side-rail |

Treatments: top-rule, bottom-anchor (the title closed by a heavy rule over a picture that takes the body's full height), side-rail, statement. There is no accent bar: a top-rule title
always sits on a full-width hairline. A comparison is drawn as a ruled table under a `top-rule` title
(`structure: comparison: top-rule`), kept even when the deck already leans on that title. Statements, covers and closings are drawn with `rules`:
hairlines above and below, like a journal title page.

## Families and variants

Families: figure-academic, figure-pair, method, chart-insight, full-chart, table-insight,
comparison, quote, statement, text-column, references-appendix.

Covers: cover-index (needs an agenda or two or more sections), cover-typographic, cover-split-image
(needs an image in the deck). Sections: section-rule, section-field. Closings:
closing-summary-list, closing-ask.

Display devices: cover `rules`, statement `rules`, big number in an `outline`, closing step under
`rules`, and `index: true`, so section-rule pages show the deck's parts with the current one marked.

## Tables and charts

- Tables in `booktabs` style: no header fill, horizontal rules over and under the header and at
  the foot only, no vertical rules, no banding, numbers right-aligned, totals bold.
- Charts: hairline gridlines, direct labels, series in order (the first series takes the crimson,
  so put the proposed method first).
- Images: no frame; every figure has a numbered caption from its alt text.

## Decoration vocabulary

hairline-rule, box-outline. Nothing else: no coloured card fills, no short bar under titles.

## Fill behaviour

`fill-order`: anchor-visual, distribute, step-up (off at density 10), change-family. Figures and
charts take the room first.

## Writing for Paper

- State the research question and scope on a text-column slide of headed points, not on a
  statement; claims are not titles.
- Put the proposed method in the first chart series and the first table row so it takes the accent.
- A method slide lists each fitted term with its range or value and how it was fitted.
- References: eight to ten entries in one style, sources first; a list too long for the body steps
  down to label size and then runs in two columns.
- With two section slides, the cover can be `cover-index` and lists both parts.

## Avoid

- The short accent bar under a title (the rule is a hairline).
- Coloured card fills.
- Figures without numbered captions.
- The accent on anything but the proposed method.

## A sample fragment

```text
---
tonality: paper
title: Membrane fouling in seawater pretreatment
date: 2026-10-06
notice: Sample data
---
layout: table-insight
title: bottom-anchor

## Flux decline by pretreatment, 500-hour runs

| Pretreatment | Initial flux (LMH) | Flux at 500 h | Decline | Cleaning cycles |
|---|---|---|---|---|
| Proposed coagulation + UF | 62 | 55 | 11% | 2 |
| UF only | 63 | 44 | 30% | 5 |
| Media filtration | 58 | 39 | 33% | 6 |
| Cartridge only | 60 | 31 | 48% | 9 |
| Untreated feed | 61 | 22 | 64% | 12 |

> Flux decline over 500 hours at 15 °C and 35 g/L salinity (sample data)

- The proposed train keeps flux within 11% of its start value
- Cleaning cycles fall from five to two against UF alone
- Source: Example lab pilot skid, runs P-31 to P-35, 2026
```

## Examples

- `examples/05-research-talk-paper-en.md`: English catalysis research talk, 12 slides.
