Foundations are the layer every component inherits, so a wrong decision spreads silently. Audit what exists, keep tokens in three layers, gate features behind a showcase.

## Audit before adding anything

Count what the project has and record it as `project_state`. A new token must beat it.

- List existing tokens and primitives with consumer counts read from files.
- Name duplicates: two spacing scales, three button variants, four greys.
- Record which primitives implement focus-visible, disabled, loading, error.
- Emit one decision per item: keep, merge, replace, or delete.

## Three token layers

Use exactly three layers and one direction of reference. A skipped layer forks themes.

- Layer 1, foundation: `grey-100`, `space-8`, `radius-4`, `dur-150`. No product meaning.
- Layer 2, semantic role: `surface`, `text-primary`, `border-focus`. Points at layer 1.
- Layer 3, component decision: `button-bg-hover`, `table-row-height`. Points at layer 2.
- Components read layers 3 and 2 only; naming a layer-1 value is a defect.
- A foundation value with no semantic role above it is unusable until one exists.

## Component anatomy checklist

A primitive is unfinished until every line below is answered in writing.

- Anatomy: container, slot order, label, description, icon slot, optional parts.
- Accessible contract: role, name source, keyboard interaction, announced changes.
- Content limits: shortest and longest string, 40% translation growth, CJK run, RTL mirror.
- API: props that exist, props that were refused, and why each was refused.

## State and variant budget

Bound both counts before implementation. Unbounded variants become a pile.

- States: default, hover, focus-visible, active, selected, disabled, read-only, loading, empty, error.
- Each variant maps to one purpose, written beside the name.
- Sizes are a bounded set; every interactive size keeps targets at 24 x 24 CSS px or larger.
- A new variant needs two existing consumers, or it stays a local override.

## Primitive showcase gate

Build one route rendering every primitive in every state before the first feature screen.

- One section per primitive, all states and variants visible without interaction.
- Rendered in light, dark, and forced-colors, at 320 px and at desktop width.
- 200% zoom with no overlap or clipping; one keyboard pass reaching every control.
- Feature work starts only when the showcase has no open defect or unrecorded exception.

## Theme architecture

Design every rendering mode at once. A mode added later arrives as a fork.

- Themes swap layer-2 values only; layers 1 and 3 stay untouched.
- Dark mode is not inversion: re-pick surfaces by lightness, cut saturation, re-measure ratios.
- Forced colors: system color keywords, a border on every surface boundary, not shadow alone.
- Reduced motion: ship an instant or opacity-only alternative, not a shorter animation.
- Contrast passing in light mode proves nothing about dark or forced colors.

## Aligning with an existing system

Change the system or record an exception. Never fork it quietly.

- Map each behavior to an existing primitive before proposing a new one.
- Extension order: use as-is, add a variant, add a prop, add a primitive. Stop at the first that works.
- Every divergence gets an exception id, reason, consumers, and a removal plan.
- Migrate one consumer family at a time with a passing check per stage.

## Foundations recorded in the contract

Record these decisions where they can be checked without you.

- Token layers plus the audit's keep, merge, replace, delete decisions.
- Component inventory with state lists, showcase route, and exception ids.
- Modes and widths actually verified, not intended.
- The contract hash, which couples the independent review pass to this stage.

## Governance reject list

Reject unaudited tokens, components coupled directly to foundations, themes that override component tokens, and unmeasured dark-mode inversion. Block feature work on an unreviewed showcase; migrate token names in stages.
