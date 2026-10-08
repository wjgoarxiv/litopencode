# Brief

Pack: `templates/tonalities/brief.yaml` · dials density 9, variance 3 · accent #2D5A47 on the title rule
and callout rule.

## Purpose

A Brief puts a decision in front of someone who will read the first page and perhaps the second. It runs
one to three pages and is built conclusion first: the decision request stands directly under the title
block, then a summary of three or four numbered points, then the supporting sections. Korean 검토 보고,
현황 보고 and decision papers for a committee fit here, as do English decision briefs and options papers.

## Wrong for

- More than three pages of material, or four or more tables that all matter: use a Report and keep the
  decision callout.
- A notice that asks for no decision: use a Memo.
- A step-by-step procedure: use a Manual.
- A project funding request with budget and schedule detail: use a Proposal.

## Structure

| Feature | What the pack sets |
|---|---|
| Page 1 | compact masthead: series line, title, subtitle, byline, rule, notice; then the first `kind=key` callout, moved to the top by the converter wherever it stands in the source |
| Summary | the paragraphs of the first h1 become numbered points ① to ④, each opening with its first sentence in bold |
| Numbering | none; each h1 opens under a full-width ink hairline |
| Components | callout (one box at most), columns |
| Running head | footer: folio right; none on page 1 |
| Contents | never |

The summary treatment is automatic. The converter takes the plain paragraphs under the first h1, up to
four, prefixes ①, ②, ③, ④ and sets the first sentence of each in bold: everything up to the first `다.`,
or the first full stop, question mark or exclamation mark followed by a space. Lists, tables and
components in that section are left as they are. A fifth paragraph is left without a number.

## Type scale

Body 10.5 pt, h1 13.5 pt, h2 12 pt, h3 10.5 pt bold, title 26.5 pt. Korean justified. The h1 hairline is
0.5 pt in ink with 6 pt of space between the rule and the heading text.

## Components

- **Callout.** One `kind=key` box holding the decision request: who decides, what exactly, by when, at
  what cost. The pack caps callouts at one; any other callout is set as text with its title in bold.
- **Columns.** Two balanced blocks for options compared side by side. Each block opens with a bold label
  ("방안 A.", "Option B.") and states scope, cost and effect in the same order.

Key figures and sidebars are not drawn: the strip would compete with the numbered points, and the points
already carry the numbers.

## Writing the source

- Write the decision callout first or last; it ends up at the top either way. Phrase it as a request with
  the amount and the date.
- Make the first h1 the summary. Write three or four paragraphs. The first sentence of each must work
  alone in bold: a complete finding with its number. The rest of the paragraph supports it.
- Keep the first sentence free of decimal points before its end if possible; the bold lead stops at the
  first full stop followed by a space, which a decimal is not, but an abbreviation such as "approx. 40"
  is.
- Use one table at most for the current state, and keep it under eight rows.
- Close with risks and their mitigations. A Brief has no conclusion section: the conclusion is at the top.

## Source fragment

```markdown
---
title: 사옥 주차장 유료화 검토
subtitle: 월 정기권 도입과 방문객 무료 시간 조정
author: 예시 공사 총무부
organization: 예시 공사(가상 기관)
date: 2026-11-03
notice: 예시 데이터. 기관, 주차면 수, 요금은 모두 가정이다.
tonality: Brief
---

::: cover kicker="검토 보고"
:::

# 요약

직원 차량에 월 3만 원의 정기권을 도입하면 출근 시간대 만차 시각이 8시 40분에서 9시 20분으로 늦춰진다.
대중교통 지원금 신청자가 늘어 정기권 구매 차량이 등록 차량의 70% 수준에 머물 것으로 보았다.

방문객 무료 시간은 2시간에서 1시간으로 줄인다. 민원 상담 평균 체류 시간이 48분이어서 대부분의
방문객은 영향을 받지 않는다.

연간 순수입은 약 1억 2천만 원이다. 정기권 수입에서 주차 관제 장비 임차료와 관리 인건비를 뺀 값이다.

::: callout kind=key title="결정 요청"
2027년 1월부터 직원 월 정기권(3만 원)과 방문객 무료 1시간 기준을 시행하는 방안을 승인해 주시기 바랍니다.
:::
```

On the page the callout stands first under the title rule, followed by the hairline and the 요약 heading,
then three points ① ② ③ with their first sentences in bold.

## Before delivery

- The rendered document is three pages or fewer. If it is longer, the direction was wrong.
- Each numbered point's bold sentence states a finding, not a topic ("비용" is a topic; "연간 순수입은 약
  1억 2천만 원이다." is a finding).
- The decision callout names the amount, the start date and who must approve.
- Numbers in the points match the table and the option blocks.
