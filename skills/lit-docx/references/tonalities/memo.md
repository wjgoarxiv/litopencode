# Memo

Pack: `templates/tonalities/memo.yaml` · dials density 9, variance 2 · no accent.

## Purpose

A Memo tells a group of people something they need to know or do, in one or two pages: a notice of works
or a schedule change, an internal memo, a request for cooperation, a short letter, a decision already
taken and now announced. Korean 안내문, 공지, 협조 요청 and 업무 연락 fit here. The reader wants the
subject, what changes, what they must do and whom to ask, and stops reading there.

## Wrong for

- A request that someone approve something: use a Brief, which puts the decision box first.
- More than two pages, or more than two tables: use a Report or a Manual.
- A procedure with warnings: use a Manual.

## Structure

| Feature | What the pack sets |
|---|---|
| Page 1 | no cover and no masthead: a small label (the kicker, default 메모 / Memo), the subject as the title at 1.8 times the body size, then rows of To / From / Date / Subject between two hairlines, then the notice |
| Summary | none; the first section says what happens |
| Numbering | none |
| Components | none; a callout or other directive is set as its bold title and plain text |
| Running head | footer: folio right, from page 2 |
| Contents | never |

The rows come from the lines of the `::: cover` body that start with `To:`, `From:`, `Date:`, `Subject:`,
`Cc:` or the Korean `받는 사람:`, `보내는 사람:`, `날짜:`, `제목:`, `참조:`. Several pairs may share a line
when separated by ` · `. When no date row is written, the frontmatter date is inserted after the sender,
formatted for the language (2026. 10. 12. or 12 October 2026). English values are capitalised. The block
counts as a component kind for the gate.

## Type scale

Korean body 10.5 pt, h1 12.5 pt, h2 11.5 pt, title 19 pt. English body 11 pt, h1 13 pt, h2 12 pt, title
20 pt. The smallest heading steps of any pack: in a memo the headings are signposts, not chapters.
Korean justified.

The pack sets `spacing: tight`, so a memo whose content allows stays on one page: line pitch at the low
end (Hangul 165 %, Latin 120 %), heading space of 12/5, 10/4, 9/3 and 8/3 pt before and after, table cells
2 pt top and bottom. A run-in head (a callout's bold title) keeps 12 pt above it, so it starts a block, and
a paragraph after a list stands 6 pt clear of the list's last item.

## Components

None. The memo's single structural device is its header block. A point that seems to need a box is
better written as the first sentence of its section. If the source holds a callout anyway, the converter
prints its title as a bold line and the body as plain paragraphs.

## Writing the source

- Put the To / From lines in the cover directive and give it a kicker that names the kind of memo (안내,
  공지, 협조 요청, Notice, Request).
- The title is the subject line: what, where, when ("본관 승강기 교체 공사 기간 이용 안내", "Car park
  closure, 3 to 7 November").
- Three to five short sections: what changes, what readers should do, any exceptions, whom to contact.
- One small table at most, for a schedule or a before-and-after comparison, with a caption.
- Polite address (합니다체) is normal in a Korean notice addressed to staff; keep it consistent through the
  memo.
- Give a named contact with an extension or address in the last section.

## Source fragment

```markdown
---
title: Car park closure for resurfacing, 3 to 7 November
author: Estates Office
organization: Example college
date: 2026-10-21
notice: Sample memo. Names, dates and locations are invented examples.
tonality: Memo
---

::: cover kicker="Notice"
To: All staff and students · From: Estates Office · Cc: Security desk
:::

# Closed area and dates

The main car park on Mill Lane will be closed from 07:00 on Monday 3 November until 18:00 on Friday
7 November while the surface is replaced. Blue-badge bays by the library entrance stay open.

# Where to park instead

Staff permits are valid at the Riverside overflow car park for the week. A shuttle minibus runs from
Riverside to the main entrance every fifteen minutes between 07:30 and 09:30 and between 16:00 and 18:30.

# Questions

Contact the Estates Office on extension 2210 or at estates@example.org.
```

The header block reads To, From, Date (21 October 2026, inserted after From) and Cc, with "Notice" above
the title.

## Before delivery

- The rendered memo is two pages or fewer; page 1 carries no folio. A memo that runs onto a second page
  and fills less than a quarter of it fails `memo.fit` (`qa --layout`): tighten the prose by the lines
  that spill; a memo that needs a real second page keeps it.
- The subject, the date of the change and the action required are on page 1.
- No component box appears; the qa output shows only the memo block.
- Contact details are real for the organisation or clearly marked as examples by the notice.
