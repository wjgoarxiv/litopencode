Access comes from the structure you choose, not a layer added later. Every applicable line here is a Design Contract acceptance criterion, exercised per channel and triaged by severity.

## Structure before attributes

Pick the element that carries the role. ARIA describes state; it implements nothing.

- Native `button`, `a[href]`, `input` with `label`, `table`, `dialog`. A click handler on `div` is a defect.
- One `h1` per view, no skipped level, headings naming content rather than size.
- ARIA only for state markup cannot express: `aria-expanded`, `aria-invalid`, `aria-current`.

## Visual access

Express access as token numbers, checkable without judgment.

- Text 4.5:1; 3:1 at 24 px or 19 px bold; 3:1 for control boundaries, icons, chart marks.
- Focus ring 2 px or thicker, 3:1 against control and surroundings, never removed for mouse.
- Re-measure in each shipped theme; a light-mode pass proves nothing about dark.

## Cognitive access

Reduce what the user must recall, infer, or race against.

- Navigation, primary action, and error placement identical across views.
- One primary action per view; destructive actions separated by position and label.
- No timeout under 20 s without an extend control; never discard entered data on expiry.

## Content and error text

Name the failure and the correction in one sentence.

- State what failed and the expected form: "Expiry is past. Enter a date after 07/2026."
- Anchor the message with `aria-describedby`; mark the field `aria-invalid`.
- Alt text carries function, not appearance; decoration takes `alt=""`.

## Localization

Treat every string as variable-length and every layout as mirrorable.

- One message per sentence with named placeholders and ICU plurals; never concatenate fragments.
- Budget +35% growth; lay out with the longest supported locale loaded.
- Mirror layout, directional icons, and progress in RTL; never mirror numerals or logos.

## CJK and IME checklist

Latin metrics and Latin input assumptions both fail here.

- Break between CJK characters; never before closing punctuation or inside a Latin token.
- Per-script fallback list with matched weights; a missing family shifts metrics silently.
- Line height 1.7-1.8 for CJK body against 1.5 for Latin; no `letter-spacing`, no uppercase.
- Composition: ignore `keydown` while `isComposing`; validate and submit on `compositionend`.
- Forms: accept full-width digits and Latin, normalize NFKC before validating, leave room for the candidate window.
- Width: East Asian Wide takes two terminal cells; measure display width, never string length.

## Adaptive preferences

Honor system settings as behavior, never as a cosmetic branch.

- `prefers-reduced-motion`: drop transform travel and parallax, keep the state change readable.
- `forced-colors`: system keywords, a border on every surface edge, no meaning in a dropped image.
- `prefers-contrast: more`: raise border and text contrast instead of adding shadow.
- Font scaling: size in `rem`, let containers grow in height, verify at 200% root size.

## Verification channels

Exercise each channel and record it. A skipped channel is an omission id, not a pass.

- Keyboard only: reach, operate, and escape every control with no pointer.
- One screen reader per shipped platform: name, role, state, announcement order.
- Zoom 200% and text-only reflow 400%, with forced colors and increased contrast on.
- A CJK locale pass with real strings; a real terminal render for CLI surfaces.

## Severity ladder

Rank by user impact. Fix cost never sets severity.

- `S1` task impossible without sight or a pointer, focus trapped, control unreachable. Blocks release.
- `S2` completable but costly: contrast failure, focus lost after dismissal, error never announced.
- `S3` friction only: skipped heading level, redundant alt text, weak contrast on decoration.
- `S4` tooling advisory no channel reproduced. Record it; do not gate on it.

## Reject

Invalid focus/ARIA patterns, access claims without a named test channel, and disabled zoom, invisible focus, or color-only status.
