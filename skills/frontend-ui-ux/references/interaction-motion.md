An interaction is specified when its states, latency band, and focus moves are written under an id. Hand those ids to the independent review pass through the design contract hash.

## State inventory

Enumerate the applicable states for each surface before styling any of them.

- `default`, `hover`, `focus-visible`, `active`, `selected`, `disabled`, `read-only`.
- `loading`, `empty`, `partial`, `error`, `success`, `offline`, `permission-denied`.
- `destructive-confirm` wherever the action cannot be undone.
- Every state needs a visual and programmatic expression; `disabled` needs a stated reason.

## Feedback matched to consequence

Size feedback to the cost of the action, not to implementation convenience.

- Under 100 ms: change in place. No spinner, no toast.
- 100 ms to 1 s: inline skeleton or progress in the affected region only.
- Over 1 s: determinate progress plus a cancel control.
- Irreversible: a confirmation naming the object and effect; typed confirmation for bulk deletion.
- Failure: a persistent inline message with retry; a vanishing toast is not a report.

## Input and validation timing

Validate when the user finishes a thought, never mid-thought.

- Format checks on blur, cross-field checks on submit, nothing on every keystroke.
- Live feedback only to confirm a constraint being met, announced politely.
- Never clear entered values on error; keep them and mark the field.
- Debounce search 200-300 ms, cancel superseded requests, keep the last valid result.

## Focus management

Focus is state. Decide origin, destination, and return for every transition.

- On open, move focus into the new region: the dialog or its first control, never `body`.
- Trap focus in modal dialogs only; non-modal panels stay escapable by Tab.
- On dismissal, return focus to the exact trigger; if it is gone, focus its surviving container and announce it.
- After deleting a row, focus the next sibling, not the top of the list.
- On route change, focus the new heading and announce the title.

## Gestures and keyboard equivalents

Treat every gesture as an accelerator for something reachable another way.

- Swipe-to-delete needs a visible delete control; drag reorder needs modifier-plus-arrow.
- Pinch needs zoom controls; long-press needs a context-menu key path.
- Any multipoint or path-dependent gesture needs a single-pointer alternative.
- Announce the result ("moved to row 3 of 12"); offer undo for 5 s after a deletion.

## Motion justification test

Keep motion only when it answers yes to one of these; otherwise delete it.

- Does it show where an element came from or went?
- Does it hold continuity across a layout or route change?
- Does it expose a state change that would otherwise be invisible?

## Choreography

Give every animated property an explicit duration and curve.

- 100-150 ms micro-feedback, 200-300 ms enter and exit, up to 400 ms for a full-screen change.
- Decelerate on enter, accelerate on exit; no bounce or overshoot on data.
- Stagger 30-50 ms per item, capped at 5; the rest arrive together.
- One moving focal region per view. Two competing animations read as a defect.

## Reduced motion

Remove the travel, keep the message.

- Substitute an instant change or a cross-fade of 100 ms or less.
- Keep progress, direction cues, and status changes in static form.
- Stop autoplay, loops, and parallax; expose a play control.

## Per-interaction record

Hand review one record per interaction, keyed by id, coupled through the contract hash.

- Trigger, target, precondition, and permitted inputs.
- Applicable states with visual and programmatic expression for each.
- Latency band with its feedback; focus origin, destination, and return target.
- Animated property, duration, easing, and the reduced-motion substitute.
- Failure path, undo window, and announcement text.

## Failure patterns

Reject hover-only specifications, broken focus return, feedback mismatched to latency, gesture-only controls, and reduced motion that merely slows the animation.
