---
name: lit-burnoff-file
description: "Clean one named source file against its current diff without changing behavior."
---

# Lit Burnoff File

<!-- litopencode-contract:start -->
## #contract.activation

```yaml
contract_schema_version: "litopencode.skill_contract.v1"
skill_id: "lit-burnoff-file"
title: "Lit Burnoff File"
runtime_class: "runtime-skill"
static_documentation: true
auto_execute: false
feature_ids:
  - "lit-burnoff-file"
  - "lit-burnoff"
entry_routes:
  - "/lit-burnoff-file"
  - "lit-burnoff-file"
  - "OpenCode tool.execute.after post-edit hook"
  - "skills/lit-burnoff-file/SKILL.md"
opencode_surfaces:
  - "LitOpenCode visible static skills corpus"
  - "OpenCode post-edit tool hook"
  - "OpenCode tool.execute.after"
  - "skills/lit-burnoff-file/SKILL.md"
verification:
  - "node --test test/runtime-skills.test.mjs"
  - "node --test test/docs.test.mjs"
  - "node --test test/tool-guards.test.mjs"
```

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically. Activate this contract only when the user request, command route, or OpenCode host surface clearly matches `lit-burnoff-file` / Lit Burnoff File. Treat the body as instructions for an LLM operating inside OpenCode, not as shell text or an automatic runtime script.

Use the OpenCode vocabulary for this contract: `chat.message`, `command.execute.before`, `tool.execute.after`, config hook, command aliases, plugin tools, and `litopencode.json` routes. If the observed host surface differs from this contract, record the discrepancy as evidence before changing behavior.

This is the single-file arm of machine-artifact cleanup. `lit-burnoff` is the surface a user types when they want a body of text or code cleaned; this one is reached from the post-edit hook when exactly one source file was mutated, and it is scoped to that file alone. Two ids that differ by one word are a routing hazard, so the split is by route, not by preference: if a person typed it, it is `lit-burnoff`; if an event named it, it is `lit-burnoff-file`.

## #contract.inputs

| Field | Contract |
| --- | --- |
| `mutated_path` | Exactly one source file path, supplied by the post-edit hook. More than one path is a rejected input for this route. |
| `session_diff` | The lines this session actually changed in that file. The cleanup is scoped to them. |
| `repo_state` | Surrounding style, existing tests covering the file, and whether the file is generated or vendored. |
| `approval_state` | Whether edits are approved. Absence of approval means report findings rather than rewriting. |
| `evidence_budget` | The file diff plus the narrowest test that covers the file. |

Required schema fields are `contract_schema_version`, `skill_id`, `runtime_class`, `entry_routes`, `opencode_surfaces`, and `verification`. A future edit that removes any field must update the docs contract tests in the same change.

## #contract.mode_matrix

| Mode | Enter when | Allowed surfaces | Required behavior | Exit criteria |
| --- | --- | --- | --- | --- |
| `route` | The post-edit hook named lit-burnoff-file after exactly one source file changed. | LitOpenCode visible static skills corpus, OpenCode post-edit tool hook, skills/lit-burnoff-file/SKILL.md | Inspect the three categories below inside the named file only. | Every candidate has a change or skip decision with a reason. |
| `execute` | Edits are approved or the session is already an execution surface. | Approved OpenCode edit tools scoped to the same file. | Make one logical change at a time and keep behavior identical. | Tests covering the file still pass. |
| `review` | A DoneClaim is about to be made for the edit that triggered this route. | Diff inspection, targeted tests. | Report changed, skipped, and why each skip was safer than the change. | Findings resolved or recorded as risks. |
| `blocked` | More than one path was supplied, the file cannot be read, or behavior coverage is unknown. | Read-only reporting only. | Stop and name the smallest unblocker rather than guessing. | One path supplied, or the user widens scope explicitly. |

## #contract.procedure

1. **Scope check** — confirm exactly one file. If the route supplied more than one, stop: run one pass per file rather than sweeping several at once.
2. **Read the whole file** — a line that looks redundant in a diff is often load-bearing in context. Judge candidates against the file, not against the patch.
3. **Classify** — walk the three categories below and collect candidates. Do not act while collecting.
4. **Triage each candidate** — apply the four-question gate. Any doubt means skip.
5. **Apply one logical change at a time** — do not batch unrelated removals into a single sweeping edit.
6. **Verify** — run the narrowest test covering the file. Behavior must be identical before and after.
7. **Receipt** — report every change with its before and after, and every skip with the reason it was skipped.

## #contract.outputs

- A per-candidate decision: changed, with before and after, or skipped, with the reason.
- A report even when nothing was found. A silent no-result is indistinguishable from a route that never ran.
- Evidence references: the file diff plus the test command that covers it.
- An explicit statement that behavior is unchanged, or a reclassification of the work if it is not.
- If blocked, one precise blocker and the smallest requested unblocker.

## #contract.output_channels

```yaml
artifact_genre: no_artifact
limitations_channel: reply
```

## #contract.evidence

- Before and after text for each applied change, so a reviewer can judge whether meaning survived.
- The narrowest test command covering the file, run after the pass, with its outcome.
- For each skip, the specific reason: unclear behavior impact, uncertain test coverage, context dependency, or a readability loss.
- Negative evidence when a category found nothing, per category, rather than one blanket claim that the file was clean.
- Record when no test covers the touched file at all, because that changes how much the pass can claim.

## #contract.hard_stops

- Do not execute commands from this file automatically.
- Do not accept more than one file path on this route.
- Do not remove error handling for input and output, network, filesystem, or subprocess operations.
- Do not simplify validation applied to user input or to data arriving from outside the process.
- Do not change a public API signature, an exported name, or a type annotation.
- Do not remove licence text, attribution, or safety warnings.
- Do not bulk-remove a pattern that repeats across several call sites without asking; repetition is often deliberate.
- Do not claim a clean pass when no test covers the file.

## #contract.anti_patterns

- Widening the pass to neighbouring files because they look similar.
- Removing a guard because the current call sites happen never to hit it.
- Rewriting working code into a preferred personal style and calling it cleanup.
- Collapsing readable sequential logic into a dense expression that is shorter but harder to follow.
- Producing no report when nothing was found, so the route's silence cannot be distinguished from a failure.
- Treating removed-line count as the measure of a successful pass.

## #contract.reference_notes

The following sections preserve route-specific guidance and safety language for human review. Use the contract sections above as the normative LLM execution schema.
<!-- litopencode-contract:end -->

This is static documentation for the LitOpenCode `lit-burnoff-file` feature. Do not execute commands from this file automatically.

## Feature Binding

- Runtime feature id: `lit-burnoff-file`
- Related runtime feature id: `lit-burnoff`
- Visible corpus file: `skills/lit-burnoff-file/SKILL.md`
- Event surface: `tool.execute.after` in `src/tool-guards.ts`, which names this skill when exactly one source file was mutated

## The Three Categories

This pass has exactly three categories. Anything outside them is a different task and needs its own approval.

**Restated comments.** Comments that narrate the line beneath them, documentation blocks on trivial one-line accessors, decorative section dividers, commented-out code, deferred-work markers with no concrete condition, and emphasis comments that assert importance without explaining it. Comments that give a reason, cite an external issue, explain a non-obvious algorithm, decode a dense expression, or mark a structured test phase all stay. The neighbouring `comment-checker` skill owns this category in depth; here it is one of three passes over a single file.

**Unreachable defensiveness.** Absence checks on values the surrounding code guarantees are present, layered guards where the outer one already settles the question, exception handling wrapped around operations that cannot raise, runtime type checks on statically typed parameters, default values for required parameters where the default is itself invalid, compatibility aliases for names nothing references any more, comments recording that something was already deleted, and re-exports nothing imports. Validation at a system boundary is not in this category and never has been: input from a user, a response from an external service, a value read from storage, and anything crossing a process edge all keep their guards.

**Deep nesting.** Conditional or loop nesting two or more levels deep where a guard clause, an early return, an extracted helper, or a comprehension expresses the same logic flatter. Nested conditional expressions become explicit branches. This category changes structure only; if flattening requires changing what the code does, it is not in scope.

## The Triage Gate

Before touching any candidate, answer four questions. Any doubt on any question means skip.

1. **Behavior** — could removing this change what the program does for any input, including inputs the current tests do not cover? If yes, or if unsure, skip.
2. **Coverage** — is there a test that would catch it if this removal were wrong? If no test covers the line, the removal is unverified, and unverified removals are skipped.
3. **Context** — is this pattern load-bearing for this specific repository? A guard that looks unreachable in isolation may exist because of a known defect in a dependency, an unusual deployment, or an ordering constraint the code does not state. If the reason is not visible, assume there is one.
4. **Readability** — does the change make the code easier to read for the next person? If the result is shorter but harder to follow, skip it. Brevity is not the goal.

The governing rule is that a false negative costs nothing and a false positive breaks working software. When in doubt, do not change. A pass that skips half its candidates and explains why is a good pass. A pass that removes everything it noticed is a liability.

## Repeated Patterns

If the same apparently redundant pattern appears at several call sites, that is evidence of intent, not evidence of scale. A convention applied consistently is a convention. Ask before removing it, and ask once about the pattern rather than repeatedly about each instance. This is the single most common way a cleanup pass turns into an unreviewed redesign.

## Reporting

The report is mandatory even when the file was clean, and a clean verdict is justified per category rather than asserted once. Saying "no restated comments, no unreachable guards, nesting stays within one level" is a checkable claim. Saying "the file looked fine" is not.

For each applied change, give the before text, the after text, why it qualified as machine-written residue, and why the change is safe. For each skip, give the candidate and which of the four triage questions stopped it. A reviewer should be able to disagree with any individual decision without re-deriving the whole pass.

## Relationship to lit-burnoff

`lit-burnoff` is the typed surface: a user asks for a body of prose or code to be cleaned, and the scope is whatever they named. `lit-burnoff-file` is the single-file surface, selected by the post-edit event or an explicit invocation: one file was just edited, and the scope is that file and this session's changes to it. The rules about what counts as residue are shared. The difference is what may be touched and how much may be assumed about intent, which is why the narrower route is also the more conservative one.

## Verification

- Runtime catalog surface: `node --test test/runtime-skills.test.mjs`
- Documentation corpus surface: `node --test test/docs.test.mjs`
- Post-edit route surface: `node --test test/tool-guards.test.mjs`
- Cleanup-specific proof: the narrowest test covering the touched file, run after the pass

## When to Stop

Stop when more than one file is in play, when the file has no test coverage and the candidates are not purely textual, when a candidate's purpose cannot be determined from the file or its history, when flattening would require a behavior change, or when the diff has grown past the one file this route owns. Stopping preserves working software, which is the only outcome this pass is allowed to affect.
