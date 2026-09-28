A direction is a bounded decision with named consequences, not a mood. Write it so a reviewer who never saw the inspiration can accept or reject it.

## Eight neutral archetypes

Start from a structure, not a style. Each names what distinguishes it and the failure it carries.

- **Tabular ledger** — fixed column rhythm, hairlines, aligned numerals. Risk: every route reads as a data export.
- **Editorial column** — large type steps, wide measure, asymmetric placement. Risk: daily rescans stay slow.
- **Console dense** — small type, short rows, all controls exposed. Risk: breaks at 200% zoom, targets under 24 px.
- **Card stack** — bounded panels, radii, soft elevation. Risk: boundaries multiply until none mean anything.
- **Single plane** — one background, dividers only, no shadow. Risk: overlays lose their separation cue.
- **Monochrome plus one** — near-black and near-white, one accent. Risk: the accent must mean three things.
- **Gauge board** — numerals lead, tabular figures, deltas and meters. Risk: ornament is read as measurement.
- **Print-quiet** — heavy whitespace, few rules, muted palette. Risk: controls stop looking interactive.

## Hybridize on one axis

A hybrid turns to mush when both parents claim structure. Assign ownership first.

- Name the dominant archetype; it owns layout, density, and hierarchy.
- The donor contributes exactly one subsystem: type scale, surface and depth, or ornament.
- Every rule conflict resolves to the dominant, and that resolution is written down.
- Strip test: delete the donor subsystem. If the layout holds the hybrid is coherent; if it collapses the donor owned structure.
- Two parents setting density voids the hybrid. Pick one.

## Commit to numbers first

Convert the direction into values. An adjective cannot be checked later.

- Type: base size and step ratio.
- Density: row height, control height, minimum gap between targets.
- Depth: how many elevation levels exist, and what each means.
- Motion: longest duration and the reduced-motion substitute.
- Color: how many semantic roles exist, and the accent's single meaning.

## Direction card

One card per candidate. A card missing a field is not reviewable.

- `dir-NNN`, name, dominant archetype, donor subsystem or `none`.
- Favored user and the task this direction accelerates.
- Three commitments from the numbers above, stated as values.
- Accessibility floors already met, with measured ratios.
- Cost: new primitives and tokens, migration surface, affected consumers.
- The one screen this direction makes worse.
- Kill criteria: the observation that ends this direction.

## Review the card, not the render

Decide on the card. Renders come after, to check that decision.

- Reject any commitment that cannot be measured in the built interface.
- Reject when the favored task is not the critical task with no reason given.
- Reject a card without kill criteria; it cannot be falsified.
- Accept with an exception id when a floor is missed for a recorded reason.

## Refuse imitation

A reference may inform a direction; it may not become one. Classify it first.

- Name the user problem each borrowed trait solves. No answer, drop the trait.
- The direction differs from the reference on at least two numeric commitments.
- Taking palette, radii, and type scale together is copying, not influence.
- A fidelity target needs authorization, a recorded hash, and a named comparison scope.
- Never inherit a reference's contrast failures, text-as-image, or missing states.

## Carry the winner into the contract

Record the surviving direction unsoftened, losers attached.

- The selected `dir-NNN`, its commitments written as system decisions.
- Rejected cards kept with one-line reject reasons.
- The contract hash, which binds the independent review pass to these numbers.

## Failure patterns

Reject a single candidate without alternatives, archetype labels without layout consequences, or hybrids with conflicting parents. Replace vague adjectives with measurable commitments; do not relax them after implementation.
