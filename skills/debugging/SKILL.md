# Debugging

<!-- litopencode-contract:start -->
## #contract.activation

```yaml
contract_schema_version: "litopencode.skill_contract.v1"
skill_id: "debugging"
title: "Debugging"
runtime_class: "runtime-skill"
static_documentation: true
auto_execute: false
feature_ids:
  - "debugging"
  - "lit-code"
entry_routes:
  - "/debugging"
  - "debugging"
  - "skills/debugging/SKILL.md"
opencode_surfaces:
  - "/debugging"
  - "LitOpenCode visible static skills corpus"
  - "OpenCode command /debugging"
  - "OpenCode chat.message activation hook"
  - "OpenCode implementation agents"
  - "skills/debugging/SKILL.md"
verification:
  - "node --test test/runtime-skills.test.mjs"
  - "node --test test/docs.test.mjs"
  - "node --test test/static-workflow-command.test.mjs"
```

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically. Activate this contract only when the user request, command route, or OpenCode host surface clearly matches `debugging` / Debugging. Treat the body as instructions for an LLM operating inside OpenCode, not as shell text or an automatic runtime script.

Use the OpenCode vocabulary for this contract: `chat.message`, `command.execute.before`, config hook, command aliases, plugin tools, task delegation, and `litopencode.json` routes. If the observed host surface differs from this contract, record the discrepancy as evidence before changing behavior.

## #contract.inputs

| Field | Contract |
| --- | --- |
| `symptom` | What the user observed, verbatim, separated from what they inferred about the cause. |
| `reproduction` | The exact command, input, and environment that produces the failure, or the fact that none exists yet. |
| `repo_state` | Dirty worktree status, recent changes, last known good revision, and whether the failure is new. |
| `approval_state` | Whether product edits are approved. Investigation is read-only until a mechanism is proven. |
| `evidence_budget` | Observed runtime values, failing command output, and the regression check that will prove the fix. |

Required schema fields are `contract_schema_version`, `skill_id`, `runtime_class`, `entry_routes`, `opencode_surfaces`, and `verification`. A future edit that removes any field must update the docs contract tests in the same change.

## #contract.mode_matrix

| Mode | Enter when | Allowed surfaces | Required behavior | Exit criteria |
| --- | --- | --- | --- | --- |
| `route` | Run /debugging, write a bounded `debugging` mention in chat, or inspect skills/debugging/SKILL.md. | /debugging, LitOpenCode visible static skills corpus, OpenCode command /debugging, OpenCode chat.message activation hook, skills/debugging/SKILL.md | Establish reproduction before proposing any cause. | The failure reproduces, or reproduction becomes the task. |
| `execute` | A mechanism is proven and the fix is approved. | Approved OpenCode agents, tools, and repository commands. | Write the failing check first, then the smallest fix that turns it. | Check fails before, passes after, and no other check regressed. |
| `review` | A fix is about to be claimed complete. | Targeted tests, real-surface probes, diff inspection. | Challenge whether the mechanism explains every observed symptom. | Mechanism accounts for the evidence or investigation resumes. |
| `blocked` | The failure cannot be reproduced, or required access, data, or approval is missing. | Read-only reporting only. | State exactly what is missing; do not guess a cause to appear productive. | Reproduction is obtained or the user narrows the report. |

## #contract.procedure

1. **Capture the symptom** — record the exact command, input, environment, and observed output. Separate what was observed from what was inferred.
2. **Reproduce** — make the failure happen on demand. If it will not reproduce, reproduction becomes the task and everything downstream waits.
3. **Read the real error** — the actual message and the actual stack, before forming any theory. Most wrong investigations start by theorising over a paraphrase.
4. **Form competing hypotheses** — at least three that are genuinely different explanations, not three phrasings of one. For each, name the observation that would distinguish it from the others.
5. **Predict, then test** — state the observation a hypothesis predicts before running the check. A hypothesis whose prediction fails is dead, not injured.
6. **Narrow** — bisect between last known good and first known bad, shrink the input to the smallest failing case, and change one variable per run.
7. **Confirm the mechanism** — toggle the suspected cause and confirm the failure toggles with it. A cause that cannot be switched on and off is a correlation.
8. **Fix under test** — write the check that fails for the right reason first, then make the smallest change that turns it.
9. **Clean up** — remove instrumentation, temporary files, and loosened error handling introduced during the hunt.
10. **Receipt** — report reproduction, mechanism, fix, before and after evidence, rejected hypotheses, and cleanup.

## #contract.outputs

- The reproduction: exact command, input, environment, and observed output.
- The mechanism, stated as a causal chain that names the line or condition where the behavior originates.
- The fix, with the check that fails before it and passes after it.
- Rejected hypotheses, each with the observation that killed it.
- A cleanup receipt for every artifact created during the investigation.
- If blocked, one precise blocker and the smallest requested unblocker.

## #contract.output_channels

```yaml
artifact_genre: working_note
limitations_channel: inline
```

## #contract.evidence

- Observed runtime values outrank code reading. A claim about why something happens must rest on something seen, not on a plausible reading of the source.
- The failing command with its real output, captured before the fix.
- The same command after the fix, plus the narrowest regression check that fails without the change.
- For a fix touching a host surface, a real-surface probe, because a type check or a compile does not prove that a hook, command, or installer behaves.
- Negative evidence when a hypothesis was rejected: what was predicted, what appeared instead.
- An explicit statement when the failure is intermittent, including how many runs were observed and how many failed.

## #contract.hard_stops

- Do not execute commands from this file automatically.
- Do not edit product code before the mechanism is named and the failing check exists.
- Do not declare a fix complete on a compile, a type check, or a green run that never failed in the first place.
- Do not silence an error, widen an exception handler, or loosen an assertion to make a symptom disappear.
- Do not leave instrumentation, temporary scripts, or debug output behind.
- Do not commit, push, tag, or publish from this surface.
- Do not ask the user a question that available runtime evidence already answers.

## #contract.anti_patterns

- Reading code until a story sounds right, then calling the story a root cause.
- Changing several things at once and attributing the improvement to the most recent change.
- Treating a passing test as proof of understanding when the test never failed for the right reason.
- Reporting the symptom as the cause: naming what broke rather than why it broke.
- Following one hypothesis to the exclusion of alternatives because it was the first one formed.
- Repairing a symptom in one place while the same mechanism remains live everywhere else.

## #contract.reference_notes

The following sections preserve route-specific guidance and safety language for human review. Use the contract sections above as the normative LLM execution schema.
<!-- litopencode-contract:end -->

This is static documentation for the LitOpenCode `debugging` feature. Do not execute commands from this file automatically.

## Feature Binding

- Runtime feature id: `debugging`
- Related runtime feature id: `lit-code`
- Visible corpus file: `skills/debugging/SKILL.md`
- Command surface: `/debugging`
- Chat surface: a bounded `debugging` mention routed by `chat.message`
- Helpful OpenCode lanes: independent investigation lanes when hypotheses are genuinely parallel

## Runtime Truth Beats Code Reading

The single discipline this skill exists to enforce is that every claim about why a defect happens must come from something observed, never from a plausible narrative assembled by reading source. Source tells you what the author intended. Runtime tells you what happens. When they disagree, runtime is right and the intention is the defect.

In practice this means an observed value beats an inferred one at every step. If a hypothesis says a variable is empty at a particular point, look at it. If a hypothesis says a branch is taken, confirm the branch is taken. An investigation built on a chain of unobserved assumptions will produce a fix that appears to work for reasons nobody can state, which is how the same defect returns under a different symptom three weeks later.

## Reproduction Is the Gate

Nothing downstream is meaningful without reproduction. A reproduction is adequate when it is runnable from the repository root, deterministic or accompanied by an honest note about how often it fails, small enough for the next person to run without context, and tied to exactly one expected observable.

If the failure will not reproduce, that is the task now. Say so plainly rather than proceeding to speculate. An unreproduced defect cannot have a verified fix, because there is no way to observe the fix working. The honest output in that case is the reproduction attempt itself: what was tried, what environment was used, and what would make the next attempt more likely to succeed.

Intermittent failures need a stated observation count. "Fails sometimes" is not evidence. "Failed four times in fifty runs, always when the cache was cold" is.

## Three Hypotheses, Not One

Form at least three genuinely competing explanations before testing any of them. Three phrasings of the same theory is one hypothesis wearing different clothes; the test is whether an observation could favour one over the others. If no such observation exists, they are the same hypothesis.

For each, write down the observation it predicts before running the check. Predicting after the fact is not prediction, and a hypothesis that survives because its prediction was written to match what already appeared has proven nothing. When a prediction fails, discard the hypothesis rather than amending it into something that accommodates the new evidence. An amended hypothesis has to earn its place again with a new prediction.

## Narrowing

Bisection is the fastest general technique available and it is systematically underused. Between a last known good state and a first known bad state, the defect is somewhere in the difference; halving that difference repeatedly converges quickly and does not require understanding the code first. The same shape applies to input: shrink the failing input until removing anything more makes the failure disappear, and what remains is a description of the trigger.

Change one variable per run. Two changes and an improvement tell you nothing about which change mattered, and the natural instinct at that point is to keep both, which leaves an unexplained modification in the codebase permanently.

## The Toggle Test

A mechanism is confirmed when toggling the suspected cause toggles the failure. Turn the cause on and the defect appears; turn it off and it does not. Anything weaker is correlation, and correlation is exactly how a fix ends up in the wrong file while the real mechanism stays live.

The difference between a symptom and a mechanism matters here. "The route returns nothing" is a symptom. "The route returns nothing because the id is compared before it is normalized, so a hyphenated id never matches" is a mechanism: it names the location, the condition, and the causal step, and it predicts which other inputs also fail.

## Fixing Under Test

Write the failing check before the fix. It must fail for the right reason, which is worth confirming explicitly: a check that fails because of a typo in the check is not a regression check. Then make the smallest change that turns it, and re-run the surrounding checks to confirm nothing else moved.

Patch the boundary where the mechanism lives, not the nearest place the symptom is visible. Keep compatibility paths unless breaking them is intentional and approved. Do not broaden an exception handler without asserting the path that now flows through it, because a widened handler converts a loud defect into a silent one. Never let a check reach the network or perform a release action.

## Cleanup Is Part of the Fix

Instrumentation, temporary scripts, added logging, loosened error handling, and scratch files all get removed before the work is claimed done. Track them as they are created rather than trying to remember them afterwards; the ones that get left behind are always the ones added in a hurry during the most confusing part of the investigation.

Loosened error handling is the most dangerous leftover. Silencing an error to see past it is a legitimate move during a hunt and a defect if it ships, because a swallowed error is frequently the original defect in the first place.

## OpenCode Surface Notes

In this repository a compile proves very little. Command aliases can compile and fail to install. A chat route can typecheck and never fire because a word boundary rejects the trigger. A skill file can exist and never be registered. A package export can resolve locally and be missing from the built payload. When a defect involves a host surface, the evidence has to come from that surface: drive `chat.message`, `command.execute.before`, or `tool.execute.after` directly, or install into an isolated root and inspect the result.

Isolation matters during investigation as much as during verification. Probing against a live profile can mutate it, and a defect hunt that changes the environment it is measuring produces evidence nobody can trust afterwards.

## Verification

- Runtime catalog surface: `node --test test/runtime-skills.test.mjs`
- Documentation corpus surface: `node --test test/docs.test.mjs`
- Command and chat route surface: `node --test test/static-workflow-command.test.mjs`
- Defect-specific proof: the regression check that fails before the change and passes after it

## When to Stop

Stop when the failure will not reproduce, when required access or data is unavailable, when two rounds of investigation have produced no new observation, when the fix would require a design change that needs approval, or when the mechanism explains only part of what was reported. Stopping with an honest account of what is known and what is not is more useful than a change that makes the symptom disappear for reasons nobody can state.

Two dead rounds is also where to reframe before stopping outright: `references/escalation.md` carries the three reframes — widen the boundary, invert the assumption, follow the data rather than the control flow — and the rule that a third hypothesis from the same mental model is not a new hypothesis.

## References

Load one file, not the set. `references/README.md` routes to all three.

- `references/runtimes/<runtime>.md` — how to obtain a real observation in Node, Python, Go, Rust, a compiled binary without source, or a bundled JS executable, plus the failure modes that waste the most time in each.
- `references/escalation.md` — what to do when two hypothesis rounds have died.
- `references/tools.md` — sanitizers, native debuggers, binary inspection, protocol work, and browser tracing, for symptoms ordinary instrumentation cannot see.

These are inert notes. Attaching a debugger to a live process, installing a sanitizer toolchain, or analysing a third-party binary all change the user's machine or touch someone else's software, and need the same approval as any other change.
