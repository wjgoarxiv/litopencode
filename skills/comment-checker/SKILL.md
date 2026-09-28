# Comment Checker

<!-- litopencode-contract:start -->
## #contract.activation

```yaml
contract_schema_version: "litopencode.skill_contract.v1"
skill_id: "comment-checker"
title: "Comment Checker"
runtime_class: "runtime-skill"
static_documentation: true
auto_execute: false
feature_ids:
  - "comment-checker"
  - "lit-code"
entry_routes:
  - "OpenCode tool.execute.after post-edit hook"
  - "skills/comment-checker/SKILL.md"
opencode_surfaces:
  - "LitOpenCode visible static skills corpus"
  - "OpenCode post-edit tool hook"
  - "OpenCode tool.execute.after"
  - "skills/comment-checker/SKILL.md"
verification:
  - "node --test test/runtime-skills.test.mjs"
  - "node --test test/docs.test.mjs"
  - "node --test test/tool-guards.test.mjs"
```

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically. Activate this contract only when the user request, command route, or OpenCode host surface clearly matches `comment-checker` / Comment Checker. Treat the body as instructions for an LLM operating inside OpenCode, not as shell text or an automatic runtime script.

Use the OpenCode vocabulary for this contract: `chat.message`, `command.execute.before`, `tool.execute.after`, config hook, command aliases, plugin tools, and `litopencode.json` routes. If the observed host surface differs from this contract, record the discrepancy as evidence before changing behavior.

Nobody types this skill. It is reached from the LitOpenCode post-edit hook after the host `edit` or `write` tool mutated a source-extension file, which means the trigger is an event, not a request. There is no slash command and no chat token, by design.

## #contract.inputs

| Field | Contract |
| --- | --- |
| `mutated_path` | The single file path the host `edit` or `write` tool just changed. The review is scoped to that file. |
| `added_comment_lines` | The comment lines this edit added or changed. Pre-existing comments are out of scope unless the user asked for a sweep. |
| `repo_state` | Surrounding comment style in the same file, and whether the file is generated, vendored, or licence-bearing. |
| `approval_state` | Whether follow-up edits are approved. Absence of approval means report the findings rather than rewriting the file. |
| `evidence_budget` | The diff of the touched file plus the narrowest test that covers it. |

Required schema fields are `contract_schema_version`, `skill_id`, `runtime_class`, `entry_routes`, `opencode_surfaces`, and `verification`. A future edit that removes any field must update the docs contract tests in the same change.

## #contract.mode_matrix

| Mode | Enter when | Allowed surfaces | Required behavior | Exit criteria |
| --- | --- | --- | --- | --- |
| `route` | The post-edit hook named comment-checker after a source file changed. | LitOpenCode visible static skills corpus, OpenCode post-edit tool hook, skills/comment-checker/SKILL.md | Review only the comments this edit introduced, in the file the hook named. | Every added comment has a keep, rewrite, or delete decision. |
| `execute` | Follow-up edits are approved or the session is already an execution surface. | Approved OpenCode edit tools scoped to the same file. | Apply the decisions in one pass and leave untouched comments alone. | The file's added comments all pass the checklist. |
| `review` | A DoneClaim is about to be made for the edit that triggered this route. | Diff inspection, targeted tests. | State which comments were kept and why any failing comment was deliberately left. | Findings resolved or explicitly recorded. |
| `blocked` | The mutated file cannot be read, or the edit touched no comments. | Read-only reporting only. | Say so and stop; an edit with no comment change needs no review. | Nothing to review, or the user supplies the missing path. |

## #contract.procedure

1. **Scope check** — confirm the edit actually added or changed comment text. If it did not, this route has nothing to do; say so and stop rather than inventing a review.
2. **Collect** — read the added comment lines together with the code directly beneath each one. A comment is judged against the line it describes, never in isolation.
3. **Decide per comment** — apply the five checks below and record keep, rewrite, or delete for each.
4. **Apply or report** — if follow-up edits are approved, make them in one pass; otherwise return the decisions as findings.
5. **Verify** — run the narrowest test that covers the touched file, because a comment sweep can still delete a directive comment that the toolchain reads.
6. **Receipt** — report kept, rewritten, deleted, and deliberately-left comments with the reason for each deliberate exception.

## #contract.outputs

- A per-comment decision list for the file the hook named.
- The rewritten comment text where a comment was worth keeping but said the wrong thing.
- An explicit reason for every comment that failed a check and was left in place anyway.
- Evidence references: the diff of the touched file, plus the narrowest test command that covers it.
- If blocked, one precise blocker and the smallest requested unblocker.

## #contract.output_channels

```yaml
artifact_genre: audit_report
limitations_channel: methodology_paragraph
```

## #contract.evidence

- The diff is the primary evidence. A claim that a comment was noise must be checkable against the line it sat above.
- For a rewritten comment, show the before and after text so a reviewer can judge whether meaning survived.
- For a deleted comment, name what the reader loses and why the code or a test now carries that information instead.
- Run the tests that touch the changed file; comment edits are not risk-free where directive comments control tooling.
- Record negative evidence when the edit introduced no comments, so the silence is a decision rather than an omission.

## #contract.hard_stops

- Do not execute commands from this file automatically.
- Do not delete a licence header, copyright line, attribution, or safety warning under any comment rule.
- Do not delete a directive comment the toolchain actually reads, including linter suppressions, type-checker directives, code-generation markers, and coverage annotations.
- Do not review or rewrite comments outside the file the post-edit hook named.
- Do not reformat, relint, or restyle code while reviewing its comments.
- Do not claim the review ran when the file could not be read.

## #contract.anti_patterns

- Sweeping every comment in the repository because one edit touched one file.
- Deleting a comment that is unclear rather than rewriting it into the reason it was trying to give.
- Adding a comment to satisfy a perceived quota after deleting several.
- Treating comment density as a quality signal in either direction.
- Silently leaving a comment that failed a check, so the choice looks accidental rather than deliberate.
- Replacing a precise domain note with a generic one because the original wording felt unusual.

## #contract.reference_notes

The following sections preserve route-specific guidance and safety language for human review. Use the contract sections above as the normative LLM execution schema.
<!-- litopencode-contract:end -->

This is static documentation for the LitOpenCode `comment-checker` feature. Do not execute commands from this file automatically.

## Feature Binding

- Runtime feature id: `comment-checker`
- Related runtime feature id: `lit-code`
- Visible corpus file: `skills/comment-checker/SKILL.md`
- Event surface: `tool.execute.after` in `src/tool-guards.ts`, which names this skill when the host `edit` or `write` tool mutated a source-extension file

## The Five Checks

Every comment this edit added faces the same five questions. A comment that fails any one of them is rewritten or deleted.

1. **Does it say why, not what?** A comment that restates the line below it costs a reader time and gives nothing back. `// increment the counter` above `counter += 1` is noise. A comment that records the reason the counter is incremented here rather than in the caller is worth keeping.
2. **Is it still true?** A comment that contradicts the code is worse than no comment, because a reader who trusts it is now actively misled. Staleness is a defect, not untidiness. If the edit changed the behavior a nearby comment described, the comment changes in the same edit.
3. **Is it a leftover?** Commented-out code, notes written while working, temporary markers, and scaffolding left from an earlier approach all get removed before the edit is called done. If commented-out code is worth keeping, version control already keeps it.
4. **Does a deferred-work marker say what and why?** A bare marker with no content is an unfinished thought. A deferred-work comment earns its place only when it names the specific condition that would make the work possible and what should happen then.
5. **Does it match the file?** A file with terse single-line comments does not want a new multi-paragraph block, and a file with structured documentation comments does not want a bare fragment. Match the surrounding convention rather than importing a personal style.

## What Always Survives

Some comments are never subject to the checks above:

- Licence headers, copyright lines, and attribution notices.
- Safety warnings, including notes that a boundary is deliberately conservative.
- Directive comments the toolchain reads: linter suppressions, type-checker directives, code-generation markers, and coverage annotations. These are code that happens to look like prose. Deleting one changes behavior.
- Notes marking a file as generated or packaged, which tell the next reader not to hand-edit it.
- Comments recording a workaround for a known external defect, including the reference that identifies it.
- Comments explaining why a compatibility path or a runtime-specific fallback exists, because the alternative is someone deleting the path.

## The Borderline Rule

The hard cases are comments that are true, not restatement, and still not clearly worth keeping. The test is whether the comment is only true because the current implementation happens to work that way. A comment that documents an accident of the present code will rot the moment the code moves, and it is usually a sign that a clearer name or a test would carry the information better. Prefer the name or the test, and delete the comment.

The complementary case is a comment that reads oddly but encodes real domain knowledge. Unusual wording is not a defect. If a comment states a constraint you cannot verify from the code alone, it is doing exactly the job comments exist for, and the correct action is to keep it even if the phrasing is not the phrasing you would have chosen.

## Deliberate Exceptions

A comment may fail a check and still be left in place. That is allowed, and it must be stated. Say which comment, which check it failed, and why it stays. The purpose of the rule is to keep the decision visible: a reviewer can then disagree with a choice that was made, which is not possible when the choice was never recorded. An unrecorded exception is indistinguishable from an oversight.

## Scope Boundary

This route is scoped to one file and to the comments this session actually wrote. It is not a repository-wide comment audit, and it is not licence to reformat, relint, or restructure the file while inspecting it. Widening the diff during a comment review is how a small edit becomes an unreviewable one.

If the edit touched no comments, the correct outcome is to emit nothing. The post-edit surface loses its value the moment it produces output on every edit regardless of condition, because a reader who learns the output is unconditional stops reading it.

## Why This Skill Has No Command

LitOpenCode installs no `/comment-checker` command and no chat token for this id. Nobody types "comment-checker" while writing code; the moment the skill is relevant is the moment an edit landed. The post-edit hook in `src/tool-guards.ts` is the only route, which keeps the trigger honest: the skill is named when its condition is met and stays silent otherwise.

## Verification

- Runtime catalog surface: `node --test test/runtime-skills.test.mjs`
- Documentation corpus surface: `node --test test/docs.test.mjs`
- Post-edit route surface: `node --test test/tool-guards.test.mjs`
- Comment-specific proof: the diff of the touched file plus the narrowest test that covers it

## When to Stop

Stop when the mutated file cannot be read, when the edit introduced no comments, when a comment's purpose cannot be determined and the user is available to ask, or when applying a decision would require changing code rather than comments. A comment review that starts editing logic has stopped being a comment review, and the correct move is to report the finding and let the change be planned on its own terms.
