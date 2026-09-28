Visual language is named roles with numbers attached, not a collection of assets. Record each role in the contract so drift can be counted later.

## Type roles, not typefaces

Define roles by function. A component picks a role, never a raw size or weight.

- Roles: page title, section title, body, meta, label, numeric, mono. Cap at seven.
- Each role fixes size, weight, line height, and letter spacing.
- Two roles within 2 px are one role; a new role retires an old one.
- The numeric role uses tabular figures so digits align in a column.
- CJK: locale-ordered fallback stack, line height 1.7 or more, no synthetic italic, no CJK letter spacing.

## Color roles carry the meaning

Name the roles before the values. A raw palette carries no meaning and cannot be themed.

- Roles: canvas, surface, surface-raised, text-primary, text-secondary, border, focus, accent, four status.
- Components reference roles only; a literal like `blue-500` in a component is a defect.
- One accent, one meaning. If it marks selection and the primary action, split it.
- Status never rests on color alone; pair it with a glyph, text, or position.

## Contrast obligations

State the number, then measure against the composited background, overlays included.

- Text below 24 px, or below 18.7 px bold: 4.5:1; at or above those sizes: 3:1.
- Icons, chart marks, and control boundaries carrying meaning: 3:1.
- Focus indicator: 3:1 against adjacent colors, 2 CSS px or thicker, never off for pointer input.
- Disabled controls are exempt from the ratio but must not rely on dimming alone.

## Surface, depth, and elevation as one system

Treat background, border, shadow, and z-index as one system with a fixed level count.

- Levels: base, raised, overlay, modal. Four is the ceiling.
- Each level fixes surface role, border, shadow, and z-index band together.
- Shadow never carries hierarchy alone; pair it with a border so forced colors keeps the boundary.
- In dark mode, separate surfaces by lightness, not heavier shadow.

## Icons: one family, one metaphor register

Keep metaphors consistent across one family. Mixed metaphors cost more than mixed strokes.

- One family, one grid size, one stroke weight, one corner treatment.
- An icon ships with a label unless that glyph and meaning is labeled elsewhere.
- Reject obsolete, culture-bound, or double-booked metaphors; test against the unfamiliar-language user.
- Each icon is decorative with an empty name, or meaningful with a real one. Never neither.

## Imagery and its failure modes

Classify every image and name how it fails before adding it.

- Content image needs alt text, decorative takes empty alt, data imagery needs a text equivalent.
- No text baked into an image: translated and zoomed text must reflow.
- Declare a fixed aspect-ratio box and focal point; nothing critical crops at 320 px.
- Overlay text needs a scrim measured on the worst pixel region, not the average.

## Data display follows the question

Choose the display form from the question, not the shape of the data.

- "What is it now?" — one number with label and unit; add trend only if change drives a decision.
- "How did it change?" — a line with an honest axis; never truncate zero when comparing magnitude.
- "Which is the outlier?" — sortable table or scatter; never a form that averages it away.
- Every display declares empty, single-point, loading, and too-many-series states.

## Drift checks against the build

Run these against the built interface, not the mockup.

- Count distinct font sizes; more than the role count is drift.
- Count distinct color values; any not traceable to a role is a defect.
- Count elevation levels and z-index bands; over four is drift.
- Compare one route across light, dark, and forced-colors modes.
- Fix each drift, or record an exception id under the contract hash the independent review pass reads.

## Failure patterns

Reject type without roles or measurements, unmeasured contrast, unnamed meaningful icons, and depth conveyed only by shadow.
