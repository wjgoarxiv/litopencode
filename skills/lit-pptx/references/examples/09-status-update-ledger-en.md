---
tonality: ledger
title: Finance system migration, week 40 status
subtitle: Cutover readiness, open defects and budget to date
date: 2026-10-06
department: Example Manufacturing finance programme
presenter: Programme management office
notice: Sample data for illustration only
---
layout: cover-typographic

# Finance system migration, week 40 status
---
layout: kpi-row

## Programme status at week 40

| Plan complete | Open defects | Test pass rate | Budget spent | Days to cutover |
|---|---|---|---|---|
| 78% | 64 | 91.4% | 3.12M EUR | 41 |
| plan 82% | week 39: 81 | target 95% | of 4.10M EUR | cutover 16 Nov |

- Two of five workstreams are behind; data migration is the critical path
- Source: Example Manufacturing PMO tracker, week 40 (29 Sep-3 Oct 2026)
- Note: plan complete is the share of planned tasks closed, weighted by effort
---
layout: ledger-table

## Workstream status and owners

| Workstream | Complete | Plan | Open defects | Status | Owner |
|---|---|---|---|---|---|
| General ledger | 92% | 90% | 6 | on track | Finance ops |
| Accounts payable | 85% | 86% | 11 | on track | Procurement |
| Accounts receivable | 81% | 84% | 9 | watch | Sales ops |
| Fixed assets | 74% | 78% | 12 | behind | Controlling |
| Data migration | 61% | 72% | 26 | behind | IT data team |
| Total | 78% | 82% | 64 | behind | PMO |

> Workstream status at week 40 (sample data)

- Data migration holds 26 of 64 open defects and is 11 points behind plan
- Fixed assets is behind because asset history from 2009-2014 needs manual mapping
- Accounts receivable moved to watch after two customer-master defects in week 40
- General ledger and payables can finish early and lend two testers to fixed assets
- Source: Example Manufacturing PMO tracker, week 40
---
layout: chart-insight

## Open defects by week and severity

::: chart type=column unit="defects"
| Week | Critical | Major | Minor |
|---|---|---|---|
| W35 | 9 | 38 | 51 |
| W36 | 8 | 35 | 49 |
| W37 | 7 | 33 | 44 |
| W38 | 6 | 29 | 47 |
| W39 | 5 | 26 | 50 |
| W40 | 3 | 21 | 40 |
> Open defects by severity, weeks 35-40 (sample data)
:::

- Critical defects fell from 9 to 3 in six weeks
- Minor defects are flat because new test cycles keep finding them
- Source: Example Manufacturing defect log, weeks 35-40
---
layout: timeline

## Path to cutover

| When | Milestone | Owner |
|---|---|---|
| 10 Oct | Third mock data load, full volume | IT data team |
| 17 Oct | User acceptance test sign-off | Finance ops |
| 31 Oct | Go or no-go review | Steering group |
| 9 Nov | Opening balances frozen | Controlling |
| 16 Nov | Cutover weekend and first close | PMO |

> Milestones to cutover (sample data)

- The third mock load is the one milestone with no slack left
- Source: Example Manufacturing cutover plan v4
---
layout: comparison

## Options for the data migration delay

:::: columns 1fr 1fr
::: col
- **Hold the 16 November date**
  (1) Effort: two extra data engineers for five weeks
  (2) Cost: 84k EUR from contingency
  (3) Risk: fixed-asset history loaded after go-live
  (4) Close: October close in the old system as planned
:::
::: col
- **Move cutover to 7 December**
  (1) Effort: current team, no additions
  (2) Cost: 120k EUR for three more weeks of dual running
  (3) Risk: cutover lands next to year-end close
  (4) Close: November close in the old system
:::
::::

- Source: PMO options paper, 2 October 2026
---
layout: big-number

## Budget position at week 40

| Spent to date | Committed | Contingency left |
|---|---|---|
| 3.12M EUR | 0.71M EUR | 0.27M EUR |
| of 4.10M EUR | contracts signed | before option A |

- Forecast at completion is 4.02M EUR without the delay options
- Option A would leave 186k EUR of contingency
- Source: Example Manufacturing programme finance report, September 2026
---
layout: closing-ask

## Requests to the steering group

- Next step: decision at the steering group on 13 October

| Request | Amount | By |
|---|---|---|
| Approve option A, hold 16 November | 84k EUR | 13 Oct |
| Release two data engineers from plant IT | none | 14 Oct |
| Confirm go or no-go review date | none | 13 Oct |

> Requests for the steering group (sample data)
---
layout: references-appendix

## Sources and definitions

- [1] Example Manufacturing PMO tracker, week 40 export (sample)
- [2] Example Manufacturing defect log, weeks 35-40 (sample)
- [3] Cutover plan version 4, 26 September 2026 (sample)
- [4] PMO options paper on the data migration delay, 2 October 2026 (sample)
- [5] Programme finance report, September 2026 (sample)
- [6] Plan complete: closed planned tasks weighted by estimated effort
- [7] Critical defect: blocks a period-end process with no workaround
- [8] Test pass rate: passed test cases over executed test cases in the current cycle
- [9] Mock load: a full-volume rehearsal of the data migration on a copy of production
