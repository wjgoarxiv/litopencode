# LSP

<!-- litopencode-contract:start -->
## #contract.activation

```yaml
contract_schema_version: "litopencode.skill_contract.v1"
skill_id: "lsp"
title: "LSP"
runtime_class: "runtime-skill"
static_documentation: true
auto_execute: false
feature_ids:
  - "lsp"
  - "lit-code"
entry_routes:
  - "/lsp"
  - "lsp"
  - "skills/lsp/SKILL.md"
opencode_surfaces:
  - "/lsp"
  - "LitOpenCode visible static skills corpus"
  - "OpenCode command /lsp"
  - "OpenCode chat.message activation hook"
  - "OpenCode host language server capability"
  - "skills/lsp/SKILL.md"
verification:
  - "node --test test/runtime-skills.test.mjs"
  - "node --test test/docs.test.mjs"
  - "node --test test/static-workflow-command.test.mjs"
```

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically. Activate this contract only when the user request, command route, or OpenCode host surface clearly matches `lsp` / LSP. Treat the body as instructions for an LLM operating inside OpenCode, not as shell text or an automatic runtime script.

Use the OpenCode vocabulary for this contract: `chat.message`, `command.execute.before`, config hook, command aliases, plugin tools, host capabilities, and `litopencode.json` routes. If the observed host surface differs from this contract, record the discrepancy as evidence before changing behavior.

LitOpenCode bundles no language server, starts no daemon, and adds no language-server tool. This skill describes how to use a capability the OpenCode host may already provide, and how to behave honestly when it does not.

## #contract.inputs

| Field | Contract |
| --- | --- |
| `edited_paths` | The files just changed, whose extensions determine which language server would be relevant. |
| `host_capability` | What the OpenCode host actually exposes for language intelligence, as observed this session rather than assumed. |
| `change_shape` | Whether the edit renames a symbol, alters a signature, removes an export, or only changes local behavior. |
| `approval_state` | Whether config changes or installs are approved. They are not part of this skill; that is lsp-setup. |
| `evidence_budget` | The diagnostic result actually returned, or the fallback command output that replaced it. |

Required schema fields are `contract_schema_version`, `skill_id`, `runtime_class`, `entry_routes`, `opencode_surfaces`, and `verification`. A future edit that removes any field must update the docs contract tests in the same change.

## #contract.mode_matrix

| Mode | Enter when | Allowed surfaces | Required behavior | Exit criteria |
| --- | --- | --- | --- | --- |
| `route` | Run /lsp, write a bounded `lsp` mention in chat, or inspect skills/lsp/SKILL.md. | /lsp, LitOpenCode visible static skills corpus, OpenCode command /lsp, OpenCode chat.message activation hook, skills/lsp/SKILL.md | Establish what the host exposes before relying on any result. | Capability confirmed present or confirmed absent. |
| `execute` | The host exposes language intelligence for the edited file type. | Host-provided language intelligence, project compiler and test commands. | Scope diagnostics to the changed file first, then widen only as needed. | Findings caused by this change are resolved or reported. |
| `review` | A DoneClaim is about to cite diagnostics as evidence. | Diagnostic output, project checks. | Distinguish findings this change caused from pre-existing ones. | Both sets stated separately with their exact output. |
| `blocked` | No language server serves the edited file type. | Read-only reporting only. | Hand off to lsp-setup and use a project-native fallback; never report a pass. | The gap is named and the fallback evidence is recorded. |

## #contract.procedure

1. **Identify the language** — derive it from the extension of the file just edited, not from the repository's dominant language.
2. **Probe the capability first** — establish whether the host serves that language before asking for diagnostics. This is what makes a later clean result meaningful.
3. **Request diagnostics scoped to the changed file** — start narrow. A repository-wide sweep on the first request buries the findings this change caused.
4. **Separate the findings** — split what this change introduced from what was already there before touching anything.
5. **Use the server for structural questions** — definition, references, and rename validity, rather than text search, when the change crosses call sites.
6. **Re-check after a structural change** — a rename or signature change is verified by diagnostics after it lands, not only by validation before it.
7. **Receipt** — report the capability observed, the exact diagnostic result, what was fixed, and what was left as pre-existing.

## #contract.outputs

- A statement of what language intelligence the host actually exposed for this file type.
- The diagnostic result as returned, not paraphrased into a verdict.
- Findings caused by this change, resolved or explained.
- Pre-existing findings, listed separately with their exact text and explicitly left alone.
- If no server serves the file type, the named gap plus the fallback evidence that replaced the missing signal.
- If blocked, one precise blocker and the smallest requested unblocker.

## #contract.output_channels

```yaml
artifact_genre: no_artifact
limitations_channel: reply
```

## #contract.evidence

- Name the surface that produced the result. "Diagnostics returned no errors for this file" is evidence; "the code is clean" is not.
- An empty result from a language the host does not serve is not evidence of correctness. Record it as absence of capability, never as a pass.
- For a rename or signature change, record the reference set before the change and the diagnostic result after it.
- When a project-native compiler, typechecker, linter, or test command supplied the signal instead, name the exact command and its outcome.
- Record pre-existing findings verbatim so a later reviewer can tell they were not introduced by this change.

## #contract.hard_stops

- Do not execute commands from this file automatically.
- Do not claim diagnostics ran when they were only available in principle.
- Do not report an empty diagnostic list from an unserved language as a clean result.
- Do not install a language server, add a dependency, or edit host configuration from this skill; that is lsp-setup, and it needs explicit approval.
- Do not suppress, silence, or annotate away a diagnostic to make output clean.
- Do not widen the diff to clear pre-existing findings that this change did not cause.
- Do not gate documentation-only or prose-only work on language-server availability.

## #contract.anti_patterns

- Reporting "no errors" when the real situation is "nothing checked this file type".
- Searching text for callers when the host can answer the same question structurally and completely.
- Renaming across a repository with a text substitution and treating a compile as proof it was correct.
- Treating every diagnostic in the file as this change's responsibility, then producing an unreviewable diff.
- Suppressing a diagnostic rather than resolving or reporting it.
- Assuming the repository's main language is the language of the file that was just edited.

## #contract.reference_notes

The following sections preserve route-specific guidance and safety language for human review. Use the contract sections above as the normative LLM execution schema.
<!-- litopencode-contract:end -->

This is static documentation for the LitOpenCode `lsp` feature. Do not execute commands from this file automatically.

## Feature Binding

- Runtime feature id: `lsp`
- Related runtime feature id: `lit-code`
- Visible corpus file: `skills/lsp/SKILL.md`
- Command surface: `/lsp`
- Chat surface: a bounded `lsp` mention routed by `chat.message`
- Complement: `lsp-setup`, for the case where no server serves the edited file type

## What LitOpenCode Provides, and What It Does Not

LitOpenCode ships no language server. It does not bundle one, does not download one, does not start a background process, and does not register a language-server tool with the OpenCode host. Everything in this skill is about using a capability that belongs to the host and to the user's own environment.

This boundary is the reason the skill exists. The failure it prevents is the confident report of a check that never happened. A model that assumes language intelligence is present will produce sentences like "diagnostics are clean" from an environment where nothing inspected the file at all, and that sentence is worse than silence because it retires a question that was never asked.

## Probe Before You Rely

Establish what the host exposes before asking it anything that matters. The order is deliberate: capability first, then the query. Reversing it produces the single most damaging outcome available here, which is an empty result that could mean either "this file is fine" or "nothing looked at this file", with no way to tell which.

Those two states must never be reported the same way. If the capability is present and the result is empty, that is a clean result and can be cited. If the capability is absent, the correct output names the absence. The presence of a probe step in the transcript is what makes the difference visible to a reviewer afterwards.

## What the Server Answers Better Than Reading

Language intelligence is not a general replacement for reading code, but there are questions where it is strictly better and where text search is actively misleading:

- **Diagnostics after an edit.** The real, current errors and warnings for the file just changed, rather than an inference about what might now be wrong.
- **Definition.** Where a symbol is actually declared, including through re-exports, aliases, and generated declarations that a text search will not follow.
- **References.** Every caller of a function, which is the only reliable way to know the blast radius of a change. Text search finds strings; it cannot distinguish a call from a comment, a shadowed local, or a same-named member of an unrelated type.
- **Type resolution.** What an expression actually resolves to, which frequently differs from what the surrounding names suggest.
- **Rename validity.** Whether a rename is safe at a position, checked before it is performed.

The rule of thumb is that any question about identity or reach should go to the server, and any question about intent should be answered by reading.

## Scope Diagnostics Narrowly First

Ask about the changed file before asking about the repository. A first request scoped to the whole project returns everything anyone ever left behind, and the handful of findings your change actually caused disappear into that list. Narrow first, resolve what you caused, then widen only if the change genuinely crosses modules.

Filter for real errors before warnings when the output is large. Warnings matter, but an error introduced by this edit is the finding that blocks the work, and it should not have to be located inside a wall of pre-existing style advice.

## Pre-Existing Findings

Findings that were already there before this change get reported, not fixed and not hidden. Quote them exactly and say they are pre-existing. Two failure modes sit on either side of this rule: silently fixing them turns a small reviewable change into a sprawling one, and silently omitting them lets a reader believe the file is in a state it is not.

Diagnostics are signals rather than noise, and the temptation to suppress one to make output tidy should be treated as a defect in itself. If a diagnostic is genuinely wrong, that is worth stating with the reason. If it is inconvenient, it stays.

## Structural Changes Are Verified Twice

A rename or a signature change is the one case where checking before is not enough. Validate that the change is legal at the position, perform it, then request diagnostics again. The second check is what catches the cases where a rename was locally valid and still broke a caller the first check did not consider — dynamic dispatch, re-exports, string-keyed access, and generated code all fall in this gap.

For a public export, inspect the reference set before editing. If the references extend beyond the current package boundary, the change is an interface change and needs acceptance criteria, not just a passing check.

## When Nothing Serves the File Type

Stop and switch to `lsp-setup`. Do not fill the gap by asserting that the code looks correct, and do not let an empty diagnostic list stand in for verification. The honest sequence is to name the unserved extension, hand off to the configuration path, and meanwhile gather real evidence from whatever the project itself provides: its compiler, its typechecker, its linter, or its test command. Say which one you used and what it does not cover.

Documentation-only and prose-only changes are outside this skill entirely. Nothing about a markdown edit is improved by waiting on language intelligence, and blocking such work on an unrelated capability is its own kind of false rigor.

## Verification

- Runtime catalog surface: `node --test test/runtime-skills.test.mjs`
- Documentation corpus surface: `node --test test/docs.test.mjs`
- Command and chat route surface: `node --test test/static-workflow-command.test.mjs`
- Capability-specific proof: the observed host capability plus the exact diagnostic or fallback output

## When to Stop

Stop when the host serves no language server for the edited file type, when the diagnostic surface returns an error rather than a result, when a rename's reference set crosses a package boundary that needs approval, or when clearing a finding would require a behavior change. In each case name the gap and the fallback evidence rather than reporting a check that did not happen.
