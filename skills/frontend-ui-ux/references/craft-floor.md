# Craft floor and responsive pass

This is the authored rule sheet for the interface probe. `scripts/probe-thresholds.json` is the executable value register. Keep a changed number in that one file, then update this explanation and its fixture; never adjust a value after reading an A/B judge result. DET means the browser can inspect a signal. JUDG needs a reviewer, even when the browser offers a count. The probe records `not_verified` for a signal it cannot observe. A clean source search is never a rendered PASS.

## Typography

| Rule | Working decision |
| --- | --- |
| CF-101 | Measure prose containers with at least two rendered lines: paragraphs, long list items, quotes and definitions. Aim for 60–75 characters per Latin line. The longest line over 90 Latin or 60 CJK characters is MEDIUM. Do not score nav strips or tickers as prose. |
| CF-102 | Score heading leading only when the heading wraps. Ordinary headings use 1.2–1.35; display headings at 40px or larger may sit at 1.05. |
| CF-103 | Score wrapped body copy below 1.4 Latin or 1.5 CJK as MEDIUM. Targets are 1.5 and 1.6 respectively; exceeding a target raises nothing. Labels, chips and controls are outside this rule. |
| CF-104 | A row that wraps to at least three lines keeps leading at or above 1.4. |
| CF-105 | Use balanced wrapping for headings. A tiny last body line is a reviewer cue, not an automatic failure. |
| CF-106 | Numeric columns and live numbers need tabular figures, a matching font feature, or genuinely monospace digits. |
| CF-107 | Controls and nav labels use sentence case; preserve product names and acronyms. |
| CF-108 | At 390px, census no more than seven type roles and two display/body families plus one mono. A recorded exception is a review decision. |
| CF-109 | Text below 18px stays at weight 400 or higher; 100–300 weights belong only to display text of at least 28px. |

## Colour and grouping

| Rule | Working decision |
| --- | --- |
| CF-201 | Small text and placeholder text clear 4.5:1. Large or bold text and component boundaries clear 3:1. Composite translucent layers before deriving the ratio; unresolved image pixels become `not_verified`. |
| CF-202 | Focused and unfocused styles must differ. Native `outline-style: auto` passes. A custom ring needs 2px and 3:1; an inadequate indicator is MEDIUM, no change is HIGH. The probe focuses a control without clicking or pressing it. |
| CF-203 | APCA is advisory alongside the WCAG pair: body Lc 75/90, other text 60/75, large text 45/60, UI 30. It cannot block alone. |
| CF-204 | Sample imagery or gradients behind glyphs when same-origin pixels are available. Cross-origin paint remains `not_verified`. |
| CF-205 | At most one high-saturation interactive accent cluster per view. Count filled emphasis surfaces of at least 24×24px, not every coloured border. Review decides whether separate status hues are justified. |
| CF-206 | Hues within 15 degrees serve one semantic colour. |
| CF-207 | Status has text, icon or pattern as well as colour; absence of a second channel is HIGH. |
| CF-301 | Spacing values at least 4px sit within 1px of a 4px multiple. One to three distinct off-scale values are LOW; more than three are MEDIUM. Skip auto margins. |
| CF-302 | Where repeated sibling gaps reveal a group boundary, its gap is at least twice the within-group gap. Uniform sequences without a boundary pass. |
| CF-303 | Adjacent non-interactive filled blocks need 12px; borderless unrelated blocks need 24px. Interactive neighbours use CF-702 instead. |
| CF-304 | A heading gets more breathing room above than below. |
| CF-305 | At phone widths, a full-width primary control stays roughly 16px inside the viewport. |
| CF-306 | Prefer a parent `gap` to per-child margins for a repeated rhythm; review the exception. |

## Surfaces and motion

| Rule | Working decision |
| --- | --- |
| CF-401 | For a rounded child that traces its parent's content box, compare each corner with outer radius minus padding; allow the rule register's tolerance. Skip icon-sized children and heavily padded parents. |
| CF-402 | A border plus a near-zero-blur edge shadow redraws the same edge. A soft ambient shadow is acceptable. |
| CF-403 | A hard offset shadow needs a recorded visual register; otherwise flag it for review. |
| CF-404 | A primary action should not carry a chromatic, large-blur halo. Parse blur, colour and offset rather than banning all shadows. |
| CF-405 | Photo outlines should be thin and low saturation, not a loud accent border. |
| CF-406 | Modal scrims use a solid or near-solid veil, not backdrop blur by reflex. |
| CF-407 | Grids, radial halos, marquees and stripe pseudo-elements are reviewer cues unless tied to content. |
| CF-501 | Keep the named motion set: enter 420ms `(0.16,1,0.3,1)`, UI 180ms `(0.2,0.8,0.2,1)`, exit 160ms `(0.4,0,1,1)`. Compare durations within 10ms and curve points within 5%. |
| CF-502 | Press feedback is about scale .96 over 150ms, ease-out; never shrink below .95. With no scriptable pressed state, record `not_verified`. |
| CF-503 | Entrances start at scale .95 or above. A confirmed running violation is MEDIUM; a declared but unused keyframe is LOW. This rule never raises HIGH. |
| CF-504 | Exit is shorter than its paired entrance and reverses its path. |
| CF-505 | Routine feedback has no spring overshoot. Inspect curve points outside about -.1…1.1 or bounce/elastic names. |
| CF-506 | Frequently repeated list/row interactions stay at 150ms or less, or instant; do not classify a small toolbar merely by item count. |
| CF-507 | `will-change` may name only transform, opacity or filter, and only while an effect runs. A stale hint at rest is a medium finding. |
| CF-508 | Continuous motion uses transform/opacity rather than width, height, margin or padding. |
| CF-509 | Reduced motion preserves reachable controls and states; a disabled animation must not strand content. |
| CF-510 | Replay entrances and feedback slowly before sign-off; write down what reads wrong. This is a review task, not a machine threshold. |

## Icons, targets and words

| Rule | Working decision |
| --- | --- |
| CF-601 | Keep one icon grid and coherent stroke family; a second unrelated set requires review. |
| CF-602 | Render icons around 1–1.25× adjacent cap height, with a 16px minimum. |
| CF-603 | Icon-only controls need a discoverable name; a destructive control also needs visible wording. |
| CF-604 | Check optical alignment by eye; equal bounding boxes can still look off. |
| CF-701 | Under 24×24px is HIGH absent the WCAG 2.5.8 spacing exception. At viewport widths up to 768px, 24–43px is MEDIUM, or HIGH for the primary action. Inline prose links have their own exception. |
| CF-702 | Neighbouring hit regions clear 8px on coarse pointers or 4px on fine pointers. |
| CF-703 | Destructive actions stay at least 44×44px on every pointer class. |
| CF-704 | Hover/drag-only behavior needs a keyboard or tap route; if neither route can be exercised, report `not_verified`, never an invented failure or pass. |
| CF-801 | Lead action labels with a plain verb. |
| CF-802 | Match tone to stakes: warm for welcome, neutral for routine, calm for error, serious for loss/security. |
| CF-803 | Errors identify the event and a recovery action, not only a generic refusal. |
| CF-804 | Keep one capitalization policy across labels, with named exceptions. |
| CF-805 | A toggle label names the state when it is on. |
| CF-806 | A placeholder is an example, not the field's only label. |
| CF-807 | Placeholder text meets the same small-text contrast floor. |

## RS matrix and handoff

RS-001 requires light-mode passes at 320, 390, 768 and 1440px. RS-002 adds a 390px dark pass; RS-003 adds a 390px reduced-motion pass. RS-004 is a 720×450 CSS-viewport approximation of 1440px at 200% zoom, reported explicitly as such. The driver records each pass and screenshots. A missing required pass exits 2 with `BLOCKED: matrix incomplete`, unless a measured or derived HIGH has already set exit 1.

| Rule | Working decision |
| --- | --- |
| RS-005 | Breakpoints follow content failure widths. A familiar framework value is only a review cue. |
| RS-006 | Check document scroll width at every state; the tolerance lives in `probe-thresholds.json` so the measurement contract can be corrected in one place. |
| RS-007 | Exclude accessibility-hidden text and declared truncation. Detect clipped primary copy as HIGH and overlapping secondary copy as MEDIUM. |
| RS-008 | Text entry controls are at least 16px on touch phone widths. |
| RS-009 | An edge-fixed control accounts for safe-area insets; inspect the declaration or mark it unverified. |
| RS-010 | A horizontal rail shows 16–32px of its next item. |
| RS-011 | Run RTL mirroring only if content or locale needs it, then inspect logical properties. |
| RS-012 | Re-sample a claimed pass in a second width or state before calling it stable. |

The output row order is `Severity | Rule | Where | Measured | Fix`. Every entry carries its rule id, actual value, threshold, viewport, selector and Measured/Derived tier. Judgment belongs in the reviewer table as Inferred. Remaining HIGH findings block the completion claim unless the user-facing result states the specific limitation and its reason.
