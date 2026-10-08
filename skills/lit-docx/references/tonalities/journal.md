# Journal

Pack: `templates/tonalities/journal.yaml` · dials density 9, variance 6 · no accent.

## Purpose

Journal is for long-form reading at a desk: a white paper, an essay, a newsletter feature, a research
summary written for practitioners or a committee rather than for a named journal. The body is set in two
columns with a title block that carries the byline, an abstract and keywords, close in feel to a
publisher's article page but built by the tonality engine. The reader goes through the argument in order.

A manuscript for submission to a named journal is not a Journal tonality document. It goes down the
publisher path: `--publisher elsevier` (or acs, ieee, nature) for conversion and `--publisher elsevier
--kind manuscript` for the gate.

## Wrong for

- A submission to a named journal: use the publisher profile.
- Many wide tables: two columns cut a table of four or more columns out into full-width bands, and a
  document made mostly of bands reads badly. Use a Report.
- A decision document: use a Brief.

## Structure

| Feature | What the pack sets |
|---|---|
| Page 1 | masthead: series line (kicker and date), title, subtitle, byline, affiliations and corresponding address when given, a rule in ink, the notice, then the abstract and keywords from the frontmatter; the two-column body starts under it on the same page |
| Summary | the frontmatter abstract, set under the label 초록 / Abstract |
| Numbering | 1 / 1.1 / 1.1.1, for cross-references in the text ("see section 3") |
| Components | callout only; the two-column body counts as columns for the gate |
| Running head | header: short title left, folio right; none on page 1 |
| Contents | never |

## Type scale

Body 10.5 pt; Latin body text in Times New Roman, Hangul and all headings in Pretendard. h1 13.5 pt, h2
12 pt, h3 10.5 pt bold, title 26.5 pt. Ragged right in both languages, which avoids wide word spaces in a
narrow column. Columns are 6 mm apart; figures are held to 40 % of the frame height.

The English body leading in Times New Roman is 133 % at density 9, written to Word as Multiple 1.16,
because Times New Roman's single line is about 1.15 em where Pretendard's is 1.53 em.

## Components

- **Callout.** One `kind=note` box for a reading aid, such as how to read a measurement or a definition
  the argument depends on. The box takes the column width.
- **Tables.** Three columns or fewer stay inside the column at its width; four or more span both columns
  with their caption. Prefer narrow tables.
- No key figures, no sidebar, no extra `columns` block: the page is already two columns.

## Writing the source

- Put the abstract in the frontmatter as `abstract:` (one paragraph, quoted) and the keywords as a list
  `keywords: [a, b, c]`. Do not repeat the abstract as a body section.
- Use `author:` for a team or a single byline. `authors:` as a list of names and `affiliations:` as a
  numbered mapping are also printed, the affiliations at note size under the byline.
- Write in sections with clear noun-phrase headings. Avoid the names Introduction, Methods, Results and
  Discussion unless the document really is an article in that form; the prose lint applies manuscript
  rules (citation density, passive voice) to sections with those names.
- Keep paragraphs moderate in length; a two-column page shows a long paragraph as a wall.
- Number tables and refer to them by number; the converter keeps each caption with its table.

## Source fragment

```markdown
---
title: 오래된 학교 건물의 겨울철 실내 공기
subtitle: 환기 횟수와 이산화탄소 농도 측정 요약
author: 예시 교육청 시설연구팀
organization: 예시 교육청(가상 기관)
date: 2026-12-10
short_title: 학교 건물 겨울철 실내 공기
abstract: "초등학교 교실 18곳에서 2025년 겨울 8주 동안 이산화탄소 농도를 측정했다. 쉬는 시간마다 창문을 연 교실은 수업 중 평균 1,050ppm을 유지했고, 창문을 열지 않은 교실은 2,300ppm까지 올랐다."
keywords: [실내 공기, 이산화탄소, 교실 환기, 학교 시설]
notice: 예시 연구 요약. 기관, 교실, 측정값은 모두 가정이다.
tonality: Journal
---

# 측정 배경

겨울철 교실은 난방 효율 때문에 창문을 닫아 두는 시간이 길다. 이 글은 환기 습관에 따라 수업 중
이산화탄소 농도가 얼마나 달라지는지를 정리한다.

## 측정 교실

표 1. 측정 교실 구성

| 구분 | 교실 수 (곳) | 평균 면적 (m²) |
|---|---:|---:|
| 1990년대 준공 | 10 | 66 |
| 2000년대 준공 | 8 | 68 |
```

The h1 prints as `1 측정 배경`; the table has three columns and stays inside the left column.

## Before delivery

- The abstract states the finding with its numbers; the body does not open by repeating it.
- Cross-references match the printed section numbers.
- No table wider than three columns unless it must be; each wide table becomes a full-width band.
- The qa run passes; with `--layout`, check that no band leaves a column nearly empty above it.
