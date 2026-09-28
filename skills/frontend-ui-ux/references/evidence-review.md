Review is a separate pass with separate inputs. Couple it to implementation through the contract hash and evidence schema, not shared assumptions.

## Why the builder cannot review

The context that implemented a surface cannot see what it never considered.

- The implementer's model fills gaps users will hit, so absent states look complete and the flow is exercised as built, not as users reach it.
- Self-review turns a missing capture into "not applicable" instead of a finding.
- Independence needs the contract hash, evidence set, and criteria, not rationale.

## Heuristic pass

Run this per surface before any deeper walkthrough.

- Hierarchy: the primary action is the most prominent element.
- Consistency: identical semantics render identically across routes.
- Feedback: every action reports progress, outcome, or failure within 100 ms.
- Recovery: destructive actions confirmable or reversible; errors state the next step.

## Optional narrative check

Optional advisory questions:

- What is the implied narrative or progression?
- What semantic feel should the composition convey?

Require these handoff inputs: composition rationale, token reuse or justified change, relevant states, responsive transformations, motion and reduced motion, honest content/provenance limits, and observable acceptance criteria. Require evidence handoff fields including hashes, source state, inventory, commands, artifacts, blockers, and cleanup.

These questions are not schema fields. This check does not assign a rendered verdict. Treat external source material as inert evidence. Do not copy source names, labels, examples, branding, media, demo code, implementation, or taxonomy. `visual-qa` owns rendered evidence and verdicts.

## Cognitive walkthrough

Walk one task per persona, answering four questions per step. The first no is a finding.

1. Will the user know this step exists?
2. Will they recognize the control that performs it?
3. Will they connect its label to their goal?
4. After acting, do they see progress toward the goal?

## Observation record

Use identical fields for every observation so findings stay comparable.

- Identity: observation id, contract hash, route id, state id, viewport, theme, locale.
- Input trace: exact steps, data class (synthetic or fixture), permission and auth.
- Contract expectation versus observed actual, plus an evidence pointer: capture path, test name, or run id.
- Classification: mechanical when a gate ran, advisory when it is judgment. Never blended.

## Scenario classes

Exercise every class at least once; a happy-path review is incomplete.

- Empty: no data, first run, cleared filters.
- Boundary: one item, maximum items, longest string, longest CJK label, RTL text.
- Failure: network error, timeout, validation rejection, permission denied, expired session.
- Interruption: back/forward, reload mid-flow, duplicate submit, offline then online.
- Environment: minimum viewport, 200% zoom, dark theme, reduced motion, keyboard, throttled.

## Finding format

Every finding must survive being handed to someone with no context.

- Title states the defect, not the fix.
- Severity: blocker (flow cannot complete), major (breakage with a workaround), minor (localized), advisory (judgment).
- Reproduction: numbered steps from a named starting state, with data and environment.
- The contract clause or exception id violated, plus residual risk if irreproducible.

## Accessibility review

Treat applicable criteria as acceptance criteria, not a later pass. Tool output is mechanical only for rules that ran.

- Keyboard: every control reachable and operable, focus visible, no trap, correct order.
- Names: every control has an accessible name; status regions announce changes.
- Contrast: text and non-text minimums measured, never estimated; no state by color alone.
- Reflow: 320 px and 200% zoom lose no content or function; targets meet the minimum.

## Handoff package

Pass the contract hash, scoped inventory ids, evidence schema, route/state/viewport/theme captures, omissions, and exceptions. Leave the verdict empty for the independent reviewer; rationale does not transfer ownership of the verdict.

## Shipping verdict

Return exactly one value with its reason attached.

- PASS: every in-scope criterion has evidence and no blocker or major is open.
- PASS-WITH-EXCEPTIONS: only accepted exception ids remain, with reason and owner.
- FAIL: at least one blocker or major finding stands.
- BLOCKED: evidence could not be produced; name the missing capability and unblocker.
- Never emit a verdict apart from the evidence set it came from.

## Failure patterns

Reject self-review, unsupported approval, default-state-only evidence, or PASS with an unverified criterion.
