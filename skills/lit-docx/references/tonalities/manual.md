# Manual

Pack: `templates/tonalities/manual.yaml` · dials density 9, variance 6 · accent #2E4A66 on the callout
rules and the sidebar rule.

## Purpose

A Manual is used, not read through: an operating procedure, a maintenance guide, an onboarding guide, a
safety procedure, a work instruction. The reader has a task in front of them and looks for the section
that covers it, follows numbered steps, stops at warnings and checks values in reference tables. Korean
절차서, 운영 지침, 작업 표준 and 매뉴얼 belong here.

## Wrong for

- A document reporting what happened rather than what to do: use a Report.
- A one-page instruction with three steps: use a Memo, with the steps as a numbered list.
- A policy or decision paper: use a Brief.

## Structure

| Feature | What the pack sets |
|---|---|
| Page 1 | title and subtitle over a document-control block between two hairlines: document (`short_title` or `title`), owner (`author`), organisation (`organization`), issued (`date`); the notice under it |
| Summary | prose; most manuals open with scope and responsibilities instead of a summary |
| Numbering | 1 / 1.1 / 1.1.1, so steps and sections can be cited ("see 3.2") |
| Components | callout (one style for every warning), sidebar, columns |
| Running head | header: short title; footer: folio right; none on page 1 |
| Contents | a short list of h1 headings with page numbers, when the source is long enough for about five pages |

The control block labels are 문서 / 작성 부서 / 기관 / 시행일 in Korean and Document / Owner /
Organisation / Issued in English. The block counts as a component kind for the gate's
`component.variety` check.

## Type scale

Body 10.5 pt, h1 14 pt, h2 12 pt, h3 10.5 pt bold, title 26.5 pt, table text 9.5 pt; sidebar text at table
size. Ragged right in both languages, which keeps step text from stretching. Decimal heading numbers sit
in a hanging indent wide enough for the widest number, so the heading texts of a level start on one line.

## Components

- **Callout, `kind=warning`.** A hazard, an irreversible step, a forbidden combination. Place it directly
  before the step it protects, not at the end of the section. All warnings share one style; there is no
  separate danger or caution colour. The budget is about one box per four pages, so a short manual gets
  one; the converter keeps warnings ahead of notes when it chooses. Write the most serious one as the box
  and fold the others into the step text.
- **Sidebar.** Definitions, contact numbers or reference values the reader looks up while following the
  text. Floats right at a third of the width by default. Needs two or three paragraphs after it before
  the next heading, or it stands full width.
- **Columns.** Two balanced blocks, such as the same check on two machine types.

## Writing the source

- Do not use a `::: cover` directive unless you want a kicker line above the title; the control block
  comes from the frontmatter.
- Open with scope and responsibilities: what the manual covers and who does what, stated as facts (which line, which equipment, which site); a list of what it is not for belongs in the reply.
- Write each procedure as a Markdown numbered list (`1.`, `2.`, …), one action per step, in the
  imperative. Each new list restarts at 1.
- Put conditions and values in tables (inspection items with their limits and the action when a limit is
  missed).
- Keep warnings short: what not to do, what happens if you do, what to do instead.
- End with the emergency or exception procedure, also as numbered steps.

## Source fragment

```markdown
---
title: Walk-in freezer daily check procedure
subtitle: Opening checks, temperature logging and alarm response for kitchen staff
author: Facilities Team
organization: Example catering site
date: 2026-11-20
short_title: Freezer daily checks
notice: Sample procedure. Equipment, limits and contacts are invented examples.
tonality: Manual
---

# Opening checks

Complete these checks before the first delivery is put away. They take about five minutes.

1. Read the display temperature and write it in the log with the time.
2. Check that the door closes fully and the seal shows no ice build-up.
3. Check the floor for water near the evaporator drain.

::: callout kind=warning title="Door left open"
Do not prop the door open during deliveries. The evaporator ices over within twenty minutes and the
freezer may take two hours to recover. Close the door between trolley loads.
:::

## Temperature limits

Table 1. Freezer temperature limits

| Reading | Status | Action |
|---|---|---|
| -18 °C or colder | Normal | Log and continue |
| -17 to -15 °C | Warning | Recheck in 30 minutes |
| Warmer than -15 °C | Alarm | Follow section 3 |
```

The h1 prints as `1 Opening checks` and the h2 as `1.1 Temperature limits`; the control block on page 1
lists Freezer daily checks, Facilities Team, Example catering site and 20 November 2026.

## Before delivery

- Every step is one action and starts with a verb.
- Every warning stands before the step it protects.
- Cross-references use the printed section numbers, which the converter assigns in order; check them
  after any section is added or removed.
- Reference tables give a value, a status and an action in every row.
