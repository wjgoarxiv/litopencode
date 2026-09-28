A device name is not a threshold. Set each one where a named element fails, attach one verb per region, and carry the table into the Design Contract as finite data.

## Signals the layout reacts to

Enumerate every signal before choosing a number. Width alone breaks on the first long translation.

- Viewport width and height, plus container width for components with an unknown parent.
- Content pressure: longest label, widest numeric column, worst translated string.
- Pointer class, hover capability, keyboard-only and assistive-technology traversal.
- Settings: root font scale, zoom, locale, writing mode, reduced motion, forced colors.
- Data volume: 0, 1, typical, 10x rows, and partial payloads.

## Thresholds derived from content

Shrink the real surface until something named fails, then record what failed.

- Record `id | width | element | failure`: `bp-2 | 720 | order table | sixth column clips`.
- Container queries for reusable components; viewport queries for frame and navigation.
- Hold 3-5 per surface; a sixth means two layouts compete for one region.

## Transformation verbs

Assign one verb per region per threshold. A sentence of intent is not implementable.

- `reflow` — same content, different column count or flow axis.
- `stack` — a horizontal pair becomes vertical, source order unchanged.
- `collapse` — persistent chrome becomes a disclosure: sidebar to drawer, tabs to select.
- `reveal` — an affordance withheld at narrow width returns once space exists.
- `defer` — content moves to another panel or route with a labelled path back.
- `truncate` — bounded clip, full value reachable elsewhere, never the only copy.
- `swap` — a different primitive carries the same state: table to card list.

Refuse bare `hide`: content removed with no path to it is loss, not adaptation.

## Priority when space runs out

Rank regions once per surface, then apply that ranking at every threshold.

- `P1` always rendered, `P2` collapsible behind a control, `P3` deferrable to another surface.
- `P1` survives 320 CSS px at 200% zoom with no horizontal scroll and no clipped control.
- Two `P1` regions competing for one space is a blocked decision, not a silent truncation.
- The primary action is `P1` in every state, empty and error included.

## Type and spacing across thresholds

Move by discrete token steps; interpolation without stated bounds is unreviewable.

- Body copy at or above 16 px effective; never disable user zoom.
- Hold measure at 45-75 Latin or 25-40 CJK characters; add a column, never widen one.
- Clamp headings between two named bounds, 24 px to 40 px, not an open ratio.
- Scale section padding by step; keep intra-component padding fixed.

## Target geometry by input class

Specify targets per modality; one global number wastes space or fails touch.

- Coarse pointer: 44 x 44 CSS px with at least 8 px between adjacent targets.
- Fine pointer: 24 x 24 CSS px hit area minimum, which may exceed the painted glyph.
- Hover, long-press, and right-click are accelerators, each with a visible equivalent.
- Read capability from `pointer` and `hover` queries, never from width.

## Condition matrix

Exercise this grid before any completion claim; each cell is acceptance criteria.

- Widths 320, 375, 414, 768, 1024, 1280, 1440, 1920 CSS px.
- Heights 480 landscape and 640 short window; zoom 200%; text-only reflow 400%.
- Light, dark, forced colors; longest supported locale; RTL when shipped.
- Data at 0, 1, typical, 10x; an unexercised cell is an omission id, not a pass.

## Review data

Keep rows in the contract, keyed by its hash: id, width, failure, region verb, and priority. Capture only contract widths; a changed threshold needs a new hash and capture.

## Failure patterns

Reject device labels without thresholds and actions, defaults untested against real content, CSS order that diverges from DOM/focus order, and shrinking controls instead of reflowing.
