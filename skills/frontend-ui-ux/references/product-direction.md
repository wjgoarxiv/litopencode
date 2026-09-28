Direction work settles who the interface serves, which task must never fail, and what would prove the answer wrong. Hand the facts, journeys, and open questions to the Design Contract.

## Audience of record

Write one primary user and at most two secondaries. A wider audience is an open question, not a decision.

- Role, the decision this person owns, and return frequency: hourly, daily, monthly, once.
- Conditions: device class, network floor, interruptions, shared or private screen.
- Assistive setup as a real profile: magnifier, screen reader, switch input, no pointer.
- Locales in scope with a fallback, and the non-audience kept as a non-goal.

## The critical task and its stages

Name the one task whose failure makes the interface worthless, then give each stage an exit condition.

- Start state, end state, and the artifact proving completion.
- Step ceiling and elapsed-time ceiling for the intended path.
- Entry and orient: how the user arrives, and the fact proving the right place.
- Act and confirm: the smallest saveable unit of progress, and the evidence returned.
- Recover: where the path is abandoned today, the undo window, what is never retyped.

## Success signals with thresholds

Fix numbers while no direction is preferred. A signal without a number cannot fail.

- Completion rate for the primary user with a floor; median and p95 time to confirm.
- Errors per submission, and repeat attempts in one session.
- Keyboard-only completion at 100%; no exception id is available here.
- One counter-signal whose appearance retires the direction.

## Knowledge-gap register

Register the unknown instead of designing over it. Each gap gets an id and a route out.

- Fields: `gap-NNN`, question, blocked decision, method, owner, deadline, fallback default.
- Methods are actions: read the route, count real records, ask one closed question.
- A gap with no method becomes a recorded assumption plus its cost if wrong.
- A gap blocking a system decision forces `blocked` mode, never a plausible invention.

## Scenarios the default design forgets

One scenario per condition, naming the breakage and the required behavior.

- Low vision: text at 200%, reflow at 320 CSS px, no horizontal scroll, no text baked into imagery.
- Keyboard only: Tab, Shift-Tab, Enter, Escape reach every action; focus at 3:1; no trap.
- Screen reader: heading outline stands alone, controls named, errors bound to their fields.
- Low bandwidth: usable at 400 kbps and 300 ms latency; useful paint before fonts resolve.
- Unfamiliar language: icon with label, no idiom, 40% string growth, wide characters as two cells.

## Bounded direction alternatives

Carry two or three candidates. One inevitable answer means nothing was examined.

- Per candidate: favored user, task accelerated, task slowed, cost.
- Candidates differ on structure, sequence, or density, not on color.
- Invariants: accessibility floors, state inventory, locale and performance budgets.
- One line per candidate naming the observation that kills it.

## Decision checkpoints

Pass these in order. Practitioner confidence is not a checkpoint.

1. Audience and critical task confirmed by the user, or `blocked`.
2. Thresholds agreed; every blocking gap closed or defaulted with its risk written down.
3. One direction selected against the invariants; losers kept with reject reasons.
4. Contract validates as evidence-eligible `litfamily.design-contract/v1beta2` and its hash is recorded; valid `litfamily.design-contract/v1beta1` documents remain accepted and evidence-eligible; alpha is diagnostic-only.

## Research output package

Hand exactly this forward. Anything outside it is not research output.

- Users, non-audience, critical task with both ceilings and stages.
- Thresholds, counter-signal, gap-register status, inclusive scenarios.
- Candidate directions, reject reasons, and the selected direction.
- Assumptions, omission ids, exception ids, and the contract hash the independent review pass reads.

## Failure patterns

Reject demographic-only audiences, adjective-based success, deferred accessibility, and a single direction presented as inevitable without real alternatives.
