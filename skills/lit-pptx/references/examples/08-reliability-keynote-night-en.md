---
tonality: night
title: Checkout platform reliability, 2026 review
subtitle: Latency, incidents and error budget across three regions
date: 2026-10-06
department: Example Commerce platform engineering
presenter: Reliability team
notice: Sample data for illustration only
---
layout: cover-figures

# Checkout platform reliability, 2026 review
---
layout: kpi-row

## Reliability at a glance, January to September

| Availability | p99 latency | Incidents | Error budget used | Mean time to restore |
|---|---|---|---|---|
| 99.962% | 412 ms | 17 | 76% | 38 min |
| target 99.95% | target 450 ms | 2025: 26 | of 9-month budget | 2025: 61 min |

- Availability met target in eight of nine months; May missed it by 0.04 points
- Source: Example Commerce SLO dashboard, January-September 2026
- Note: availability counts successful checkout requests over all checkout requests
---
layout: full-chart

## p99 checkout latency by month and region

::: chart type=line unit="ms"
| Month | EU | US | APAC |
|---|---|---|---|
| Jan | 398 | 421 | 512 |
| Feb | 402 | 418 | 498 |
| Mar | 391 | 409 | 476 |
| Apr | 388 | 402 | 455 |
| May | 446 | 431 | 470 |
| Jun | 384 | 397 | 441 |
| Jul | 379 | 392 | 428 |
| Aug | 381 | 389 | 419 |
| Sep | 377 | 386 | 412 |
> p99 latency of the checkout API by region (sample data)
:::

- APAC fell from 512 ms to 412 ms after the edge cache moved to two local sites in March
- Source: Example Commerce tracing data, 1% request sample
---
layout: dashboard-grid

## Incident profile by cause and severity

::: chart type=bar unit="incidents"
| Cause | Count |
|---|---|
| Config change | 6 |
| Dependency | 5 |
| Capacity | 3 |
| Code defect | 3 |
> Incidents by root cause (sample data)
:::

::: chart type=column unit="minutes"
| Severity | Median restore |
|---|---|
| SEV1 | 52 |
| SEV2 | 37 |
| SEV3 | 24 |
> Median minutes to restore by severity (sample data)
:::

::: chart type=column unit="incidents"
| Region | Count |
|---|---|
| EU | 7 |
| US | 6 |
| APAC | 4 |
> Incidents by region (sample data)
:::

::: chart type=line unit="incidents"
| Quarter | Count |
|---|---|
| Q1 | 8 |
| Q2 | 6 |
| Q3 | 3 |
> Incidents per quarter (sample data)
:::

- Config changes caused six of 17 incidents; all six shipped outside the canary path
- Source: Example Commerce incident register, January-September 2026
---
layout: big-number
title: top-plain-large

## Error budget burn in May

| Budget burned | Duration | Requests failed |
|---|---|---|
| 31% | 3 h 40 min | 1.9M |
| in one incident | SEV1, 14 May | 0.8% of the day |

- One payment-provider timeout cascaded into retries that saturated the EU gateway
- Retries without backoff tripled load within six minutes
- Fix: retry budget per client and a circuit breaker on the provider call
- Source: post-incident review PIR-2026-014
---
layout: method
title: band

## Error budget calculation

budget = (1 − SLO) × total requests in the window

- **SLO** service level objective
  (1) 99.95% of checkout requests succeed over a rolling 28 days
- **Window** rolling 28 days
  (1) about 410M checkout requests at current volume
- **Budget** failed requests the window may hold
  (1) 0.05% of 410M, about 205,000 requests
- **Burn rate** speed of spending the budget
  (1) failed requests per hour divided by the hourly budget
- **Alert** paging rule
  (1) page when the 1-hour burn rate exceeds 14 or the 6-hour rate exceeds 6
- Source: Example Commerce SLO policy v3, February 2026
---
layout: comparison

## Change process before and after canary gating

:::: columns 1fr 1fr
::: col
- **Before, January-April**
  (1) Rollout: config pushed to all regions at once
  (2) Detection: median 11 minutes after the push
  (3) Incidents: four from config changes
  (4) Rollback: manual, median 19 minutes
:::
::: col
- **After, May-September**
  (1) Rollout: 1% canary for 20 minutes per region
  (2) Detection: median 4 minutes, inside the canary
  (3) Incidents: two from config changes
  (4) Rollback: automatic on burn-rate alert, 3 minutes
:::
::::

- Source: Example Commerce change log and incident register, 2026
---
layout: timeline

## Reliability roadmap, Q4 2026 to Q2 2027

| When | What | Owner |
|---|---|---|
| Oct 2026 | Canary gating for feature flags | Platform |
| Nov 2026 | Retry budgets in all client SDKs | Payments |
| Jan 2027 | Second APAC region active-active | Infra |
| Mar 2027 | Chaos test of provider failover | Reliability |
| May 2027 | SLO raised to 99.97% | Product |

- Raising the SLO halves the error budget, so it waits for the APAC region
- The March chaos test checks failover before the SLO goes up in May
- Source: Example Commerce platform roadmap, October 2026
---
layout: closing-decision-box

## Decisions for the Q4 roadmap

- Decide: fund the second APAC region and adopt retry budgets as a release gate

| Decision | Cost | When | Owner |
|---|---|---|---|
| Second APAC region | 0.9M USD a year | 20 Oct | Infra |
| Retry budget as a gate | none | 27 Oct | Payments |
| Flag canary gating | 2 engineer-months | 3 Nov | Platform |

> Decisions requested (sample data)
