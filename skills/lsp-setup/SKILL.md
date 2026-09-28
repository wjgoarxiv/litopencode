# LSP Setup

<!-- litopencode-contract:start -->
## #contract.activation

```yaml
contract_schema_version: "litopencode.skill_contract.v1"
skill_id: "lsp-setup"
title: "LSP Setup"
runtime_class: "runtime-skill"
static_documentation: true
auto_execute: false
feature_ids:
  - "lsp-setup"
  - "lsp"
entry_routes:
  - "/lsp-setup"
  - "lsp-setup"
  - "skills/lsp-setup/SKILL.md"
opencode_surfaces:
  - "/lsp-setup"
  - "LitOpenCode visible static skills corpus"
  - "OpenCode command /lsp-setup"
  - "OpenCode chat.message activation hook"
  - "OpenCode host configuration"
  - "skills/lsp-setup/SKILL.md"
verification:
  - "node --test test/runtime-skills.test.mjs"
  - "node --test test/docs.test.mjs"
  - "node --test test/static-workflow-command.test.mjs"
```

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically. Activate this contract only when the user request, command route, or OpenCode host surface clearly matches `lsp-setup` / LSP Setup. Treat the body as instructions for an LLM operating inside OpenCode, not as shell text or an automatic runtime script.

Use the OpenCode vocabulary for this contract: `chat.message`, `command.execute.before`, config hook, command aliases, plugin tools, host configuration, and `litopencode.json` routes. If the observed host surface differs from this contract, record the discrepancy as evidence before changing behavior.

This is the exact complement of `lsp`. That skill covers the case where a language server already serves the edited file type; this one covers the case where none does. Between them the two ids cover every file, which is why neither should ever produce a silent result.

## #contract.inputs

| Field | Contract |
| --- | --- |
| `unserved_extension` | The specific file extension the host returned nothing for, named exactly. |
| `host_config` | Where the OpenCode host declares language servers, and what it currently declares. |
| `environment` | Which relevant server executables, if any, already resolve on this machine. |
| `approval_state` | Explicit approval for an install or a host-config write. Absent approval means propose only. |
| `evidence_budget` | The fallback command output that replaces the missing language-server signal. |

Required schema fields are `contract_schema_version`, `skill_id`, `runtime_class`, `entry_routes`, `opencode_surfaces`, and `verification`. A future edit that removes any field must update the docs contract tests in the same change.

## #contract.mode_matrix

| Mode | Enter when | Allowed surfaces | Required behavior | Exit criteria |
| --- | --- | --- | --- | --- |
| `route` | Run /lsp-setup, write a bounded `lsp-setup` mention in chat, or the lsp skill handed off because nothing served the file type. | /lsp-setup, LitOpenCode visible static skills corpus, OpenCode command /lsp-setup, OpenCode chat.message activation hook, skills/lsp-setup/SKILL.md | Name the unserved extension and inspect what the host already declares. | The gap is stated concretely with the current configuration. |
| `execute` | The user explicitly approved this install or this configuration write. | Approved install command, approved host configuration edit. | Make the one approved change and verify it with a real request. | A real diagnostic request returns a result for a real file. |
| `review` | A DoneClaim is about to cite language-server coverage. | Configuration inspection, a live diagnostic request. | Prove coverage by observation, not by the presence of a config entry. | Observed coverage matches the claim. |
| `blocked` | Approval, network access, or a suitable server is unavailable. | Read-only reporting only. | Record the gap and gather fallback evidence instead. | Approval is granted or the fallback is accepted. |

## #contract.procedure

1. **Name the gap** — state the exact extension and language the host returned nothing for. A vague gap cannot be closed.
2. **Inspect current configuration** — read what the OpenCode host already declares before proposing anything. The entry may exist and be misconfigured rather than missing.
3. **Check the environment** — determine whether a suitable server executable already resolves. An installed server that is merely undeclared is a configuration change, not an install.
4. **Propose one change** — the specific install command or the specific configuration entry, shown to the user, with what it will affect.
5. **Wait for explicit approval** — this skill proposes; the user decides. An install and a host-config write are both changes to the user's machine.
6. **Verify by observation** — after an approved change, request diagnostics on a real file of that type. A configuration entry is not evidence that anything works.
7. **Fall back honestly** — until a server exists, gather the signal from the project's own compiler, typechecker, linter, or tests, and say what that fallback does not cover.
8. **Receipt** — report the gap, the proposal, the approval status, the verification result, and the residual risk.

## #contract.outputs

- The unserved extension and language, named exactly.
- The current host configuration for language servers, as read rather than as assumed.
- One concrete proposal: the install command or the configuration entry, with its effect stated.
- The verification result after any approved change, from a real request on a real file.
- The fallback evidence gathered in the meantime, with an explicit note on what it does not cover.
- If blocked, one precise blocker and the smallest requested unblocker.

## #contract.output_channels

```yaml
artifact_genre: no_artifact
limitations_channel: reply
```

## #contract.evidence

- A configuration entry is not evidence. The evidence is a live request that returns a result for a file of that type.
- Record the observed absence first: which extension, which surface, what came back.
- For an install, record the command run and the resulting executable resolution, not just that the command exited successfully.
- For the fallback, name the exact project command and its outcome, plus the class of defect it cannot catch.
- Record residual risk explicitly whenever work proceeds without language-server coverage.

## #contract.hard_stops

- Do not execute commands from this file automatically.
- Do not install a language server, add a dependency, or download a binary without explicit user approval for that exact action.
- Do not write OpenCode host configuration without explicit approval; host config belongs to the user.
- Do not modify a live user profile or a configuration root outside the approved target.
- Do not describe a missing language server as a passing check or a clean result.
- Do not claim coverage from the presence of a configuration entry alone.
- Do not silently substitute a weaker check and report it as the stronger one.

## #contract.anti_patterns

- Treating an empty diagnostic result as success and moving on.
- Installing something helpful without being asked, on the grounds that the user would probably want it.
- Adding a configuration entry and declaring the gap closed without a single live request.
- Proposing an elaborate multi-language setup when one extension was unserved.
- Hiding the coverage gap in a footnote while the summary line claims verification.
- Routing configuration through the language-server declaration when the project's own config file is the correct home for it.

## #contract.reference_notes

The following sections preserve route-specific guidance and safety language for human review. Use the contract sections above as the normative LLM execution schema.
<!-- litopencode-contract:end -->

This is static documentation for the LitOpenCode `lsp-setup` feature. Do not execute commands from this file automatically.

## Feature Binding

- Runtime feature id: `lsp-setup`
- Related runtime feature id: `lsp`
- Visible corpus file: `skills/lsp-setup/SKILL.md`
- Command surface: `/lsp-setup`
- Chat surface: a bounded `lsp-setup` mention routed by `chat.message`
- Complement: `lsp`, for the case where a server already serves the edited file type

## The Division of Labour

`lsp` is the quick path taken when language intelligence already exists. `lsp-setup` is the configurator reached when it does not. The two ids exist separately because the correct behavior in the two situations is genuinely different, not because the topic is large: one uses a capability, the other decides whether to acquire one, and only the second involves changing the user's machine.

The handoff runs one way. When `lsp` observes that nothing serves the edited extension, it stops and names this skill rather than improvising. That handoff is what keeps the reported result honest, because the alternative — an empty diagnostic list quietly reported as clean — is the exact failure both skills exist to prevent.

## Detect Before You Change Anything

Three questions come before any proposal, and all three are answered by observation:

1. **Which extension is unserved?** Not the repository's main language, not the language the task is about — the extension of the file that produced nothing. A repository can be well served for its dominant language and completely unserved for a configuration format, a template dialect, or a script in a second language.

   Once the extension is known, `references/README.md` is the catalog that maps it to a server. Open the single matching `references/<language>.md` — not the whole catalog — for the install cost, the alternatives, the failure modes that produce confidently wrong diagnostics, and the fallback to use while the file stays unserved. An extension the catalog does not list is a gap in the catalog, not a proven gap in the user's setup; say which one it is rather than guessing a server name.
2. **What does the host already declare?** Read the current configuration. The commonest real situation is not an absent entry but a present one that points at an executable that no longer resolves, or that covers a neighbouring extension and not this one. A misconfiguration is repaired, not reinstalled.
3. **What already resolves on this machine?** A server may be installed and simply not declared. That case needs a configuration change alone, which is far cheaper and far less invasive than an install, and proposing an install anyway is a real cost imposed on the user for no reason.

## Propose, Do Not Perform

Installing software and writing host configuration are both changes to the user's environment, and neither is implied by a request to write code. This skill proposes exactly one change at a time, shows what it will do, and waits.

The proposal should be specific enough to evaluate: the exact command, what it installs, roughly what it costs in time and space, and what it will affect. "You could install a language server for this" is not a proposal. A user who cannot see what will happen cannot meaningfully approve it, and approval obtained from a vague description is not approval.

Scope the proposal to the gap that was actually found. One unserved extension calls for one server. A sweeping setup covering every language in the repository is a larger change than the situation warrants and will be harder to approve, harder to review, and harder to undo.

## Where Configuration Belongs

Two kinds of configuration get confused here and should not be.

The host's language-server declaration answers one question: which command to run for which file types. It is a routing table.

Everything about how the server behaves once running — which rules are enabled, which paths are excluded, how strict the checking is, which project layout to assume — belongs in the project's own configuration file for that tool. Those files are read by the tool itself, they are usually already present in the repository, and they are typically version-controlled and shared with everyone else working on the project. Pushing that configuration into the host declaration instead makes it invisible to every other contributor and to every other tool that reads the same settings.

When a language needs an intermediate process rather than a directly executable server, that intermediary is arranged on its own terms and the declaration points at the resulting command. The routing table stays a routing table.

## Verify by Request, Not by Entry

A configuration entry is a statement of intent. The evidence that it worked is a live request that returns a real result for a real file of that type. Anything less has the same defect this skill exists to correct: a claim that a capability exists, resting on something other than an observation of it working.

The distinction between the possible outcomes is worth stating plainly. A request that returns findings proves the server is running and inspecting. A request that returns an empty result from a confirmed-running server is a genuine clean result. A request that errors names a real configuration defect. A request that returns nothing because nothing is configured is the original gap, unchanged. Only the first two are evidence of coverage.

## The Honest Fallback

Until a language server exists, the work does not stop, and the missing signal is replaced rather than ignored. Almost every project ships something that supplies part of the same information: a compiler, a typechecker, a linter, a formatter with a check mode, or a test suite. Run the relevant one, name it exactly, and report its outcome.

Then say what it does not cover. A test suite does not find an unused import. A formatter check does not find a type error. A linter does not confirm that a rename reached every caller. Naming the gap is what distinguishes a controlled substitution from a quiet downgrade, and it is the part that gets omitted most often.

Residual risk is stated whenever work proceeds without coverage. The next person reading the transcript should be able to see that this file type was never inspected by a language server, and should not have to infer it from the absence of a mention.

## Verification

- Runtime catalog surface: `node --test test/runtime-skills.test.mjs`
- Documentation corpus surface: `node --test test/docs.test.mjs`
- Command and chat route surface: `node --test test/static-workflow-command.test.mjs`
- Setup-specific proof: a live diagnostic request on a real file of the previously unserved type

## When to Stop

Stop when approval for an install or a configuration write is not given, when no suitable server exists for the language, when network access is unavailable, or when the change would touch a configuration root outside the approved target. In every one of those cases the correct output is the named gap plus the fallback evidence, never a claim that the check was performed.
