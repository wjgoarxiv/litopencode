---
tonality: paper
title: Low-temperature CO2 methanation on Ni-Ce catalysts
subtitle: Activity, stability and the role of ceria oxygen vacancies
date: 2026-10-06
department: Example Institute of Catalysis
presenter: Example research group
notice: Sample data for illustration only
---
layout: cover-index

# Low-temperature CO2 methanation on Ni-Ce catalysts
---
layout: section-rule

# Background and method
---
layout: text-column

## Research question and scope

- **Question** whether ceria loading lowers the light-off temperature of Ni catalysts below 250 °C
- **Why it matters** grid-coupled methanation units cycle often, and cold starts waste hydrogen
- **Scope** five catalysts, 10 wt% Ni on Al2O3 with 0-20 wt% CeO2
- **Conditions** H2/CO2 = 4, GHSV 24,000 mL g-1 h-1, 0.1 MPa, 150-400 °C
- **Not covered** sulfur poisoning and pressurised operation above 1 MPa
- Source: Example group lab notebook, March-August 2026
---
layout: method

## Rate expression and fitted terms

r = k · p_CO2^a · p_H2^b / (1 + K_H2O · p_H2O)

- **r** CO2 consumption rate
  (1) mol per gram of surface Ni per second, below 10% conversion
- **k** rate constant
  (1) Arrhenius form, k = A · exp(−Ea / RT)
- **a, b** reaction orders in CO2 and H2
  (1) a between 0.21 and 0.34, b between 0.48 and 0.62
- **K_H2O** water adsorption term
  (1) accounts for product inhibition above 220 °C
- **Fit** least squares over 42 runs at 180-260 °C
  (1) R² = 0.97, residuals without trend in temperature
- Note: rates are normalised by surface Ni from H2 chemisorption
- Source: Example group kinetic dataset, runs 101-142
---
layout: figure-academic

## Reactor setup and catalyst bed

![Fixed-bed quartz reactor with online gas chromatograph, 6 mm inner diameter](assets/example-a.png)

- 100 mg catalyst diluted with 400 mg SiC to keep the bed isothermal
- Thermocouple in the bed centre, gradient under 2 K at full conversion
- Products analysed every 12 minutes by GC with TCD and FID
- Source: Example group reactor log, 2026
---
layout: section-rule

# Results
---
layout: chart-insight

## CO2 conversion by temperature and ceria loading

::: chart type=line unit="%"
| Temperature | 0 wt% Ce | 5 wt% Ce | 10 wt% Ce | 20 wt% Ce |
|---|---|---|---|---|
| 175 °C | 2 | 4 | 9 | 7 |
| 200 °C | 6 | 13 | 27 | 21 |
| 225 °C | 17 | 34 | 58 | 49 |
| 250 °C | 38 | 61 | 79 | 72 |
| 275 °C | 62 | 77 | 84 | 81 |
> CO2 conversion versus temperature for four ceria loadings (sample data)
:::

- 10 wt% Ce reaches 50% conversion at 219 °C, 45 K below the Ni-only catalyst
- 20 wt% Ce performs worse than 10 wt%, consistent with Ni sites covered by ceria
- Source: Example group activity runs, three repeats each
- Note: equilibrium conversion at 250 °C under these conditions is 93%
---
layout: table-insight
title: bottom-anchor

## Catalyst properties and kinetic parameters

| Catalyst | Ni dispersion | O vacancy ratio | Ea (kJ/mol) | T50 (°C) |
|---|---|---|---|---|
| Ni/Al2O3 | 6.1% | 0.00 | 92 | 264 |
| Ni-5Ce | 7.4% | 0.18 | 84 | 241 |
| Ni-10Ce | 8.9% | 0.27 | 76 | 219 |
| Ni-15Ce | 8.2% | 0.25 | 78 | 224 |
| Ni-20Ce | 7.0% | 0.21 | 81 | 231 |

> Properties of the five catalysts; T50 is the temperature at 50% conversion (sample data)

- Lower Ea tracks the oxygen vacancy ratio across all five samples
- Dispersion peaks at 10 wt% Ce and falls as ceria starts to cover Ni
- Source: H2 chemisorption, XPS Ce3+ fraction and fitted kinetics
---
layout: figure-pair

## Spent catalyst after 100 hours on stream

![Ni-only catalyst after 100 h, mean Ni particle 18 nm](assets/example-b.png)
![Ni-10Ce after 100 h, mean Ni particle 9 nm](assets/example-c.png)

- Ceria slows Ni sintering: particle growth of 29% against 140% for the Ni-only catalyst after 100 h at 250 °C, with conversion loss of 3 points against 14
- Source: TEM counts of 300 particles per sample, stability runs 201-204
---
layout: comparison

## Contributions and limits of this study

:::: columns 1fr 1fr
::: col
- **Contributions**
  (1) Activity: T50 lowered by 45 K with 10 wt% Ce
  (2) Mechanism: Ea linked to the O vacancy ratio
  (3) Stability: sintering cut by a factor of five
  (4) Data: kinetic set of 42 runs released
:::
::: col
- **Limits**
  (1) Activity: tested at 0.1 MPa only
  (2) Mechanism: vacancy ratio from ex situ XPS
  (3) Stability: 100 h, short of plant duty cycles
  (4) Data: one Ni loading, one support
:::
::::

- Source: this work; comparison with industrial targets from reference 6
---
layout: closing-summary-list

## Conclusions and next experiments

- Ceria at 10 wt% gives the lowest light-off temperature of the five catalysts
- Apparent activation energy falls in step with the oxygen vacancy ratio
- Excess ceria covers Ni and costs both dispersion and activity
- Ceria slows Ni sintering over 100 hours at 250 °C
- Next: in situ DRIFTS at 200 °C to identify the formate pathway
- Next: a 500-hour cycling test at 1 MPa with daily cold starts
---
layout: references-appendix

## References

- [1] Example A. et al., Ni catalysts for CO2 methanation, Example Journal of Catalysis 412 (2025) 101-115
- [2] Example B. et al., Ceria promotion in Ni systems, Example Applied Catalysis 330 (2024) 1220-1234
- [3] Example C. et al., Oxygen vacancies and CO2 activation, Example Surface Science 79 (2025) 55-68
- [4] Example D. et al., Rate laws for CO2 hydrogenation, Example Chemical Engineering 18 (2023) 301-319
- [5] Example E. et al., Sintering of supported Ni, Example Materials Letters 64 (2024) 88-96
- [6] Example F., Power-to-gas reactor requirements, Example Energy Review 9 (2025) 12-40
- [7] Example G. et al., XPS of Ce3+ and Ce4+, Example Spectroscopy 51 (2022) 433-447
- [8] Example H. et al., Dynamic operation of methanation units, Example Process Journal 27 (2026) 7-21
- [9] Example I. et al., Thermodynamic limits of CO2 methanation, Example Thermo Letters 15 (2023) 210-219
