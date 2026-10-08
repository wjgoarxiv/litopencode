# Proposal

Pack: `templates/tonalities/proposal.yaml` · dials density 8, variance 6 · accent #6E2639 on the cover
rule and the callout rules.

## Purpose

A Proposal asks for approval and money for something that does not exist yet: an investment, a pilot, a
new service, a funding application, a project plan. Its reader is a decision maker or a panel who wants to
know what will be done, what it costs, when it happens, what it returns and what could go wrong. Korean
제안서, 기획서, 사업 계획서 and 투자 품의 fit here.

## Wrong for

- Reporting results of something already running: use a Report.
- A decision on an existing arrangement, such as a rule change, that fits on two pages: use a Brief.
- A proposal of one page with no budget table: use a Memo or a Brief.

## Structure

| Feature | What the pack sets |
|---|---|
| Page 1 | a typographic cover page: kicker, the title left-aligned in the upper third, one short rule in the accent, the subtitle and the lead; byline, date and notice at the foot; no picture, no colour block |
| Summary | prose under the first h1, with one key-figure strip after its first paragraph |
| Numbering | none |
| Components | keyfigures, callout (one box), columns |
| Running head | footer: folio centred; the cover has none and the folio starts at 1 on the first body page |
| Contents | never |

The cover is its own section. The title is broken between words in at most three lines over ten of
twelve grid columns; the rule under it is 36 mm long and 1 pt thick.

## Type scale

Korean body 10.5 pt, h1 14.5 pt, h2 12.5 pt, title 28.5 pt. English body 11 pt, h1 15.5 pt, h2 13 pt,
title 29.5 pt. Figures may take up to 60 % of the frame height, the most of any pack, because proposals
often carry a site plan or a schematic. Korean justified.

## Components

- **Key figures.** One strip in the summary with the three numbers a decision maker weighs: output or
  benefit, annual saving or revenue, payback or cost per unit. Each basis line states the assumption
  behind the number. Never on the cover: a strip placed inside the cover directive is moved to the
  summary.
- **Callout.** One `kind=key` box with the decision request, normally at the end. The pack caps callouts
  at one.
- **Columns.** Two balanced option blocks, when the proposal compares a recommended option with an
  alternative.

## Writing the source

- Start with a `::: cover kicker="…"` directive whose body is one or two sentences saying what is
  proposed. That lead is the only text on the cover besides the title block.
- First h1: the summary. One paragraph on what is proposed and its scale, the strip, one paragraph on cost
  and timing.
- Then background (why now), what will be built or done, budget, schedule, benefits and risks, and the
  decision request.
- The budget table lists items with amounts in the header unit, a share column and a total row. The
  schedule table lists stages with dates written the reader's way (`2026년 11월`, `November 2026`).
- State each risk with its effect on the numbers in the strip ("payback rises to 6.7 years").

## Source fragment

```markdown
---
title: 본사 구내 어린이집 정원 확대 제안
subtitle: 정원 49명에서 79명으로, 2027년 9월 개원
author: 예시 은행 인사부
organization: 예시 은행(가상 기업)
date: 2026-12-01
notice: 예시 데이터. 회사, 정원, 금액은 모두 가정이다.
tonality: Proposal
---

::: cover kicker="복리후생 사업 제안"
본사 별관 1층을 리모델링해 직장 어린이집 정원을 30명 늘리는 계획이다.
:::

# 요약

별관 1층 사무 공간 410m²를 보육실 4개와 놀이실로 바꿔 정원을 49명에서 79명으로 늘리자고 제안한다.
현재 대기 아동은 61명이다.

::: keyfigures
- **30명** 정원 증가
  - 만 1~4세, 보육실 4개 기준
- **6억 8,000만 원** 리모델링·설비 비용
  - 업체 견적 3건의 중간값
- **49%** 대기 아동 해소율
  - 대기 61명 중 30명
:::

공사는 2027년 3월부터 5개월 동안 진행하고 9월에 새 반을 연다.
```

## Before delivery

- The cover holds the kicker, title, rule, subtitle, one lead sentence and the foot lines, nothing else.
- The strip's numbers appear again in the budget table or the text, identical.
- The decision callout states the amount, the budget line and the first step after approval.
- The budget table's shares add to 100.0 and its rows add to the total.
