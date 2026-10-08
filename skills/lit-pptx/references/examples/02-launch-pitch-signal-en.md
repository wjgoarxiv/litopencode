---
tonality: signal
title: RiserWatch 2026 launch plan
subtitle: Leak detection for apartment risers, building by building
date: 2026-10-06
department: Example Building Systems
presenter: Launch team
notice: Sample data for illustration only
---
layout: cover-numeral

# RiserWatch 2026 launch plan
---
layout: statement

# One sensor per riser, not one per flat

Twelve clamp-on units cover a 120-flat block from the basement plant room
---
layout: big-number

## Water damage cost per building, 2025

| Average claim | Claims per building | Repair downtime | Share from risers |
|---|---|---|---|
| 38,400 USD | 2.7 a year | 11 days | 46% |
| per claim, 2025 | 120-flat block | per incident | of insured leaks |

- Riser leaks run behind walls for days before anyone sees a stain
- Insurers in the pilot region raised premiums 9% for blocks over 25 years old
- Source: Example Insurers Association loss report 2025, 1,840 claims
- Note: a riser is the vertical supply pipe that feeds every flat on one stack
---
layout: image-split

## The RiserWatch unit on a supply stack

![RiserWatch clamp unit on a 50 mm copper riser](assets/example-a.png)

- **Clamp-on** fits 32-80 mm copper or PEX risers without cutting the pipe
- **Acoustic sensing** listens for the hiss of a pinhole leak at 0.2 L/min
- **Battery** lasts five years on one lithium cell, reporting twice an hour
- **Alerts** go to the building manager app and the insurer portal together
- Source: Example Building Systems bench tests, March-June 2026
---
layout: process

## Installation and alert path

- **1. Survey**
  (1) Map risers from the building plans, typically 8-14 stacks per block
  (2) Check plant-room access and gateway signal on one visit
- **2. Clamp and pair**
  (1) Fit one unit per stack in the basement, about 20 minutes each
  (2) Register units to the gateway over a sub-GHz radio link
- **3. Learn**
  (1) Record seven days of normal flow noise as each riser's baseline
  (2) Tag pump cycles and night-time quiet hours automatically
- **4. Alert**
  (1) Flag a leak when noise stays above baseline for 30 minutes
  (2) Notify the manager app and the insurer portal at the same time
- Median install: 3.5 hours per building, no flat visits
- Source: pilot installation log, 6 buildings, April-August 2026
---
layout: kpi-row

## Pilot results across six buildings

| Leaks found | Median detection | Avoided damage | False alerts | Install time |
|---|---|---|---|---|
| 14 | 3.2 hours | 410k USD | 2 | 3.5 hours |
| Apr-Aug 2026 | after leak start | insurer estimate | in 5 months | per building |

- Every leak was found before water reached a ceiling below
- Both false alerts came from one pump room with a failing valve
- Source: Example Building Systems pilot report, September 2026
---
layout: chart-insight

## Detection time, pilot versus stain reports

::: chart type=bar unit="hours"
| Building | RiserWatch | Stain report |
|---|---|---|
| Block A | 2.1 | 41 |
| Block B | 3.0 | 56 |
| Block C | 4.4 | 33 |
| Block D | 2.8 | 72 |
| Block E | 3.6 | 48 |
| Block F | 3.4 | 60 |
> Hours from estimated leak start to first report, by building (sample data)
:::

- Stain reports took 33-72 hours; the sensor took under five
- Source: pilot report and insurer claim notes, 2026
- Note: stain report times are from earlier claims in the same buildings
---
layout: comparison

## RiserWatch against flat-level sensors

:::: columns 1fr 1fr
::: col
- **RiserWatch**
  (1) Units: one per riser, about 12 per block
  (2) Cost: 9,600 USD installed for a 120-flat block
  (3) Access: plant room only, no flat visits
  (4) Coverage: hidden pipe runs inside walls
:::
::: col
- **Flat-level sensors**
  (1) Units: one or two per flat, about 180 per block
  (2) Cost: 21,000 USD installed for the same block
  (3) Access: every flat, booked one by one
  (4) Coverage: only leaks that reach the floor
:::
::::

- Source: Example Building Systems cost model, October 2026 list prices
---
layout: table-insight
title: bottom-anchor

## Revenue model per building

| Item | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Hardware and install | 9,600 USD | 0 | 0 |
| Monitoring subscription | 1,440 USD | 1,440 USD | 1,440 USD |
| Insurer data fee | 600 USD | 600 USD | 600 USD |
| Battery and service | 0 | 0 | 240 USD |
| Total per building | 11,640 USD | 2,040 USD | 2,280 USD |

> Revenue per 120-flat building, list prices (sample data)

- Gross margin reaches 58% in year 2 once hardware is paid off
- Insurer fee is paid by the insurer, not the building
- Source: Example Building Systems pricing sheet, October 2026
---
layout: closing-ask

## Seed round and first 200 buildings

- Next step: term sheet review on 4 November, first close by 15 December

| Use of funds | Amount | Timing |
|---|---|---|
| Production run of 3,000 units | 1.2M USD | Q1 2027 |
| Installer network in two cities | 0.6M USD | Q1-Q2 2027 |
| Insurer integration and portal | 0.4M USD | Q2 2027 |
| Sales and pilot support | 0.3M USD | 2027 |

> Seed round of 2.5M USD (sample data)
