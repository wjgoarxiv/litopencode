Composition decides what a user notices first and how fast the second attempt goes. Settle order, grid, rhythm, and density as recorded decisions before any styling.

## Reading order before styling

Rank the blocks on the route by importance, then build the markup in that order.

- Number the blocks 1..n; block 1 answers why the user came.
- One `h1` per route; heading levels descend with no skipped level.
- Source order equals visual order equals tab order; never fix structure with CSS ordering.
- The primary action is reachable in the first viewport at 320 CSS px.

## Grid strategy and licensed breaks

Choose one grid per page family and record it. A grid that changes per screen is not a grid.

- Columns: 12 desktop, 8 tablet, 4 at 320 px; gutters come from the spacing scale.
- Hold measure at 45-75 Latin characters, 25-40 CJK; add columns, do not widen.
- Break the grid only for full-bleed media, a wide table, or a canvas.
- Each break carries a written reason and a system decision or exception id.

## Spacing scale and vertical rhythm

One scale owns every gap. Ad-hoc pixel values are where drift begins.

- Base 4 px; steps 4, 8, 12, 16, 24, 32, 48, 64.
- The gap between two groups is at least double the gap inside either group.
- The parent container owns vertical gaps; children carry no outer margin.
- Any off-scale value needs an exception id before it ships.

## Density follows task frequency

Derive density from how often the primary user repeats the task, not from taste.

- Once or rarely: 48 px controls, one decision per screen.
- Daily: 36-40 px rows, shortcuts for the top three actions.
- Hourly or faster: 28-32 px rows, interactive targets still 24 x 24 CSS px or larger.
- Two frequencies on one route: ship a density toggle, not an average of both.

## Page families and their consequences

Assign one family per route and accept its consequences.

- **Index** — one scan column, fixed row height, sticky filters. Forces virtualization.
- **Record** — identity header plus sectioned body. Actions reachable while the body scrolls.
- **Entry** — single column, 640 px max, one decision per step. Needs per-field errors and a summary.
- **Board** — fixed tile grid. Every tile needs empty, stale, and error states.
- **Workspace** — tool regions around a work area. Keyboard focus must be able to leave it.
- **Configuration** — grouped label-and-control rows, no cards. Search runs over headings.

## App shell or document, per route

Decide the scroll model per route. Mixing them doubles scrollbars and loses scroll position.

- Shell: persistent navigation, scrolling confined to one region, content swapped per route.
- Shell obligations: focus moves on navigation, skip link into the region, scroll restored per route.
- Document: page-level scroll, chrome scrolls away, no inner scroll containers.
- Document obligations: stable heading outline, return-to-top past three viewports.
- Never nest two independently scrolling regions at 320 px.

## Spend empty space on purpose

Space groups content more cheaply than a border. Use it before drawing anything.

- Group with space first, a rule second, a container third.
- Size a blank region for the longest real string plus 40% growth.
- Never add ornament to fill a gap real content will occupy.

## Composition review checklist

Run all six before composition enters the contract. The independent review pass replays them from the contract hash.

1. Stylesheet disabled: reading order still correct.
2. One tab pass: order matches visuals, focus always visible.
3. 320 px width: no horizontal scroll, no clipped control.
4. 200% zoom: nothing overlaps, every control reachable.
5. Longest-string and largest-record states still readable.
6. Every grid break, off-scale gap, and density exception has an id.

## Failure patterns

Reject styling before reading order, ad-hoc spacing, or density chosen without the task frequency. Every route needs a page family; use space before cards so containers retain meaning.
