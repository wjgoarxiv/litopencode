# Report

Pack: `templates/tonalities/report.yaml` · dials density 9, variance 5 · accent #1F3A5F on the title rule
and callout rules.

## Purpose

A Report carries results and the evidence for them: a periodic operating report, a project close-out, an
analysis of a programme, a quarterly review. It runs from about four to thirty pages, its readers are
managers who read the summary closely and the rest selectively, and its tables do most of the arguing.

The Korean default follows the manner of a research institute's issue paper: continuous prose in the
plain declarative style (-다), sections numbered Ⅰ. / 1. / 가., tables with `<표 n>` captions, unit lines
and source lines. The government 개조식 style (□ ○ - lines ending in -함, -임) is a variant the user must
ask for; it is not the default.

## Wrong for

- A document that asks for one decision and has fewer than three supporting tables: that is a Brief.
- A procedure the reader follows step by step: that is a Manual.
- A request for money or approval of a new project with a budget and schedule: that is a Proposal.
- One or two pages of notice: that is a Memo.
- A long argument with few tables, written to be read through: that is a Journal.

## Structure

| Feature | What the pack sets |
|---|---|
| Page 1 | masthead title block: series line (kicker left, date right), title, subtitle, byline, one rule in the accent, the notice |
| Summary | prose under the first h1, with an optional key-figure strip after its first paragraph |
| Numbering | Korean Ⅰ. / 1. / 가.; English 1 / 1.1 / 1.1.1 |
| Components | keyfigures, callout, columns (three kinds at most, as always) |
| Running head | footer: short title left, folio right; none on page 1 |
| Contents | a short list of h1 headings with page numbers after the title block, when the source is long enough for about five pages |

The contents list is generated from the h1 headings; do not write one in the source. The page estimate is
about 1,500 Korean or 3,300 English characters per page, plus a line for every table row.

## Type scale

Body 10.5 pt Pretendard, h1 14.5 pt, h2 12.5 pt, h3 10.5 pt bold, title 26.5 pt, table text 9.5 pt,
note lines 9 pt. Korean body justified, English ragged right. Line pitch 175 % (Korean) and 133 %
(English) at density 9.

## Components

- **Key figures.** One strip in the summary with three or four results of the period, each with a basis
  line. Good: trips carried, availability against target, cost per trip. Poor: the number of sites, the
  project start date.
- **Callout.** Usually one `kind=key` box for the decision the report asks for, at the end. A report long
  enough for a second callout (about eight pages) may add one `kind=warning` for a risk that needs action
  before the next report.
- **Columns.** Rarely needed. Use for two parallel blocks of similar length, such as two sites or two
  options, inside a section.

A Report of four pages or more needs two component kinds to pass `component.variety`, because the
masthead does not count as one. Key figures in the summary and a decision callout are the usual pair.

## Writing the source

- Open with a `::: cover kicker="…"` directive when the report belongs to a series ("운영 보고 2026-4호",
  "Half-year operating report"); leave it out otherwise.
- Make the first h1 the summary (요약 / Summary). Its first paragraph states the main result with its
  number; the strip follows; the next paragraphs give the main problem and what is proposed.
- Give every following h1 an opening paragraph before its first h2.
- Put the evidence in tables with captions, a unit line where the header allows it, and `주:` / `자료:`
  lines. Discuss each table in the text: the sentence before it says what to look for, the sentence after
  it says what follows from it.
- End with the plan or decision section; a closing `kind=key` callout states exactly what is asked.
- Set `short_title:` for the footer.

## Source fragment

```markdown
---
title: 2026년 상반기 고객 상담 센터 운영 실적
subtitle: 응답 시간, 상담 건수, 인력 운영
author: 예시 서비스 고객지원팀
organization: 예시 서비스(가상 기업)
date: 2026-07-10
short_title: 상반기 상담 센터 실적
notice: 예시 데이터. 회사와 수치는 모두 가정이다.
tonality: Report
---

::: cover kicker="반기 운영 보고"
:::

# 요약

상반기 상담 건수는 18만 4,200건으로 작년 같은 기간보다 9% 늘었다. 평균 응답 시간은 2분 40초로
목표 3분 안에 들었지만, 3월 요금 개편 직후 두 주 동안은 6분을 넘었다.

::: keyfigures
- **18만 4,200건** 상반기 상담 건수
  - 2026. 1.~6., 전화·채팅 합계
- **2분 40초** 평균 응답 시간
  - 목표 3분, 상담 시스템 기록
- **87%** 1회 해결률
  - 재문의 7일 기준
:::

# 상담 건수

상담 건수는 요금 개편이 있었던 3월에 가장 많았다.

표 1. 1분기 월별 상담 건수

| 구분 | 1월 (건) | 2월 (건) | 3월 (건) |
|---|---:|---:|---:|
| 전화 | 18,400 | 17,900 | 26,100 |
| 채팅 | 9,800 | 10,200 | 14,600 |

자료: 상담 시스템 월간 집계(예시)
```

The three header cells after the first end in the same unit, so the converter writes `(단위: 건)` above
the table and the headers read 1월, 2월, 3월. The h1 headings print as Ⅰ. 요약 and Ⅱ. 상담 건수.

## Before delivery

- Every number in the summary and the strip matches the table that carries the same quantity, with the
  same rounding.
- Headings are noun phrases; no heading ends in -다 or -음.
- No ISO date outside the frontmatter `date:`.
- The qa run passes; with `--layout`, no page under 0.35 fill, no stranded heading, no split table.
