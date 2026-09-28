# Structural Search

<!-- litopencode-contract:start -->
## #contract.activation

```yaml
contract_schema_version: "litopencode.skill_contract.v1"
skill_id: "structural-search"
title: "Structural Search"
runtime_class: "runtime-skill"
static_documentation: true
auto_execute: false
feature_ids:
  - "structural-search"
  - "lit-code"
entry_routes:
  - "/structural-search"
  - "structural-search"
  - "skills/structural-search/SKILL.md"
opencode_surfaces:
  - "/structural-search"
  - "LitOpenCode visible static skills corpus"
  - "OpenCode command /structural-search"
  - "OpenCode chat.message activation hook"
  - "OpenCode host grep and glob tools"
  - "skills/structural-search/SKILL.md"
verification:
  - "node --test test/runtime-skills.test.mjs"
  - "node --test test/docs.test.mjs"
  - "node --test test/static-workflow-command.test.mjs"
```

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically. Activate this contract only when the user request, command route, or OpenCode host surface clearly matches `structural-search` / Structural Search. Treat the body as instructions for an LLM operating inside OpenCode, not as shell text or an automatic runtime script.

Use the OpenCode vocabulary for this contract: `chat.message`, `command.execute.before`, config hook, command aliases, plugin tools, host capabilities, and `litopencode.json` routes. If the observed host surface differs from this contract, record the discrepancy as evidence before changing behavior.

LitOpenCode bundles no structural engine and installs nothing. This skill describes how to use one the environment may already provide, and exactly how to behave when it does not.

## #contract.inputs

| Field | Contract |
| --- | --- |
| `shape` | The syntax shape being sought: a call, declaration, import, signature, control-flow form. Not a string. |
| `engine_state` | What an identity probe actually observed, not what an executable is named. One of available, absent, unknown. |
| `scope` | The bounded paths the search or rewrite may touch. A rewrite without a bounded scope is refused. |
| `intent` | Search only, or search-then-rewrite. Rewrite requires explicit approval and a preview first. |
| `evidence_budget` | The probe transcript, the query, the match set, and for a rewrite the diff plus a re-run proving the old shape is gone. |

Required schema fields are `contract_schema_version`, `skill_id`, `runtime_class`, `entry_routes`, `opencode_surfaces`, and `verification`. A future edit that removes any field must update the docs contract tests in the same change.

## #contract.mode_matrix

| Mode | Enter when | Allowed surfaces | Required behavior | Exit criteria |
| --- | --- | --- | --- | --- |
| `probe` | Any structural request, before anything else. | Version and help invocation only. | Establish engine identity by observation; never infer it from a name on PATH. | State available, absent, or unknown. |
| `search` | An engine is verified and the request is read-only. | The verified engine, host grep and glob. | Report the match set with paths and the query that produced it. | Matches reported, or an honest empty result. |
| `rewrite` | The user explicitly asked to change matching code AND an engine is verified. | The verified engine within bounded paths. | Preview without mutating, inspect every match class, apply, then format and verify. | Diff reviewed and a re-run shows the old shape gone. |
| `textual fallback` | No engine, or the target is strings, comments, filenames, or generated text. | Host grep and glob. | Label the result TEXTUAL and draw no syntax-level conclusion from it. | The label and its limits are stated. |
| `blocked` | A rewrite is requested with no engine, no bounded scope, or no approval. | Read-only reporting only. | Refuse the rewrite and name the smallest unblocker. | The user supplies the engine, scope, or approval. |

## #contract.procedure

1. **Decide whether the question is structural at all.** A literal string, a filename, or a log line is a text search. Structural search earns its cost when the target is a *shape*.
2. **Prefer the language server when it answers better.** Definitions, references, and rename blast radius are semantic questions the `lsp` skill routes to a real server. A structural engine matches syntax; it does not resolve types or follow re-exports.
3. **Probe the engine by identity.** Run its version or help and read the output. Never assume an executable is the tool its name suggests — short names collide with unrelated system commands, and running the wrong binary against a repository is the failure this step exists to prevent.
4. **State the engine state before searching.** Available, absent, or unknown. Unknown is not absent.
5. **Write the narrowest pattern that expresses the shape**, and run it read-only first.
6. **For a rewrite, preview before mutating.** Inspect every match class the preview shows; a pattern that matches four shapes will rewrite four shapes.
7. **Bound the paths.** A rewrite runs inside a named scope, never across an entire repository because the pattern happened to be valid there.
8. **Verify after.** Re-run the query to show the old shape is gone, read the diff, then run the formatter, typechecker, or tests that cover the touched files.
9. **Receipt.** Engine identity and version, the query, the match count, the bounded scope, the diff, and the re-run.

## #contract.outputs

- The engine state, as observed: available with version, absent, or unknown.
- The exact query, so the search is reproducible without re-deriving it.
- The match set with file paths, or an honest empty result.
- For a rewrite: the preview, the bounded scope, the diff, and the re-run showing the old shape absent.
- For a fallback: the textual command, its result, and an explicit TEXTUAL label.
- If blocked, one precise blocker and the smallest requested unblocker.

## #contract.output_channels

```yaml
artifact_genre: no_artifact
limitations_channel: reply
```

## #contract.evidence

- The probe transcript is evidence of the engine, not the presence of a name on PATH.
- Quote the query. A match count with no query cannot be checked or repeated.
- A textual fallback is labeled TEXTUAL at the point the result is reported, not in a footnote.
- For a rewrite, a re-run showing zero remaining matches of the old shape is the proof; a diff alone shows what changed, not that the change was complete.
- Record the parser or engine limits that applied, including any language the engine could not parse.
- Record negative evidence: a shape searched for and genuinely not present is a result worth stating.

## #contract.hard_stops

- Do not execute commands from this file automatically.
- Do not install a structural engine, add a dependency, or download a binary. LitOpenCode ships none and acquiring one is the user's decision.
- Do not run an executable because its name matches; verify identity first.
- Do not rewrite without explicit approval, a verified engine, a preview, and bounded paths.
- Do not present a textual fallback result as a structural finding.
- Do not claim a repository-wide guarantee from a search whose scope was narrower than the claim.
- Do not treat an empty result from an unparsed language as evidence the shape is absent.

## #contract.anti_patterns

- Reaching for a structural engine when a plain string search answers the question faster.
- Reaching for a structural engine when the language server answers it better and semantically.
- Writing a pattern broad enough to match shapes you did not enumerate, then rewriting all of them.
- Silently degrading to text search and reporting the result as though the syntax was understood.
- Treating a name on PATH as proof of the tool.
- Repository-wide rewrites justified by the pattern being syntactically valid everywhere.

## #contract.reference_notes

The following sections preserve route-specific guidance and safety language for human review. Use the contract sections above as the normative LLM execution schema.
<!-- litopencode-contract:end -->

This is static documentation for the LitOpenCode `structural-search` feature. Do not execute commands from this file automatically.

## Feature Binding

- Runtime feature id: `structural-search`
- Related runtime feature id: `lit-code`
- Visible corpus file: `skills/structural-search/SKILL.md`
- Command surface: `/structural-search`
- Chat surface: a search-or-rewrite verb aimed at a syntax shape, routed by `chat.message`
- Complements: `lsp` for semantic questions, `refactor` for behavior-preserving restructuring

## What This Buys Over Text Search

A regular expression matches bytes. A structural query matches the shape a parser sees, which is why
it survives the things that defeat regex: line breaks inside an argument list, an arbitrary number of
arguments, a comment sitting between the callee and its parenthesis, a differently-named receiver, or
whitespace nobody normalised.

The cases where it clearly wins are narrow and worth naming: every call to a function regardless of
how its arguments are spread; declarations of a particular form; imports of a specific module across
differing quote and ordering styles; a control-flow shape such as an unhandled branch or a discarded
result. Outside those, a plain search is faster and easier to check.

The cases where it clearly loses: anything about a *string*, a comment, a filename, or generated
output — those are text, and a structural engine will parse around them.

## Structural or Semantic — Two Different Questions

A structural engine matches syntax. It does not resolve types, follow re-exports, or know that two
differently-spelled names refer to the same symbol. Those are semantic questions, and where a
language server is available the `lsp` skill routes them to one that answers properly: where a symbol
is defined, every real caller, whether a rename is safe.

The practical split: ask the language server *who* and *what*, ask a structural engine *what shape*.
Finding every caller of a function is a language-server question. Finding every call that passes a
callback as the second argument is a structural one, because the shape is the criterion.

## The Capability Probe

LitOpenCode bundles no structural engine, so the first action of any structural request is to find
out whether one exists here.

Probe by **identity**, not by name. Run the candidate's version or help output and read it. A short
command name is not proof of the tool: short names collide with unrelated system utilities, and
running the wrong binary against a repository — especially with rewrite arguments — is precisely the
outcome this step prevents. If the output does not identify the tool you expected, treat the engine
as absent.

Report one of three states, and keep them distinct:

- **available** — the probe returned the expected identity. Record the version; behavior differs
  across versions and a recorded version makes a later result reproducible.
- **absent** — the probe ran and the tool is not there. Say so and switch to the labeled fallback.
- **unknown** — the probe could not run at all. This is not the same as absent. Reporting "no
  structural engine" when you were merely unable to look is the same false confidence as reporting a
  clean diagnostic result from a language the host never served.

Never install one. Acquiring a tool is the user's decision, and offering the install command is the
correct move where the capability is wanted.

## The Labeled Fallback

Without an engine, the host's `grep` and `glob` still answer many questions. Use them, and label the
result **TEXTUAL** where the result is reported.

The label is the whole point. A textual result may be right, but it was produced by matching bytes,
so it cannot support a claim about syntax: it will miss a call split across lines and match one
inside a comment. State what the fallback covered and what it structurally cannot. A fallback
reported as though the syntax had been understood is worse than no search, because the next reader
inherits a conclusion nobody can check.

## The Search-to-Rewrite Boundary

Searching is read-only and cheap to be wrong about. Rewriting is neither, so it carries four
preconditions, all required:

1. **Explicit approval** for the rewrite, not merely for the search that found the matches.
2. **A verified engine.** A rewrite through a textual fallback is a find-and-replace wearing a
   structural label; if that is genuinely what is wanted, say so plainly and treat it as such.
3. **A preview that mutates nothing**, inspected for every match class it reports. A pattern matching
   four shapes rewrites four shapes, and the one nobody enumerated is the one that breaks.
4. **Bounded paths.** Scope the rewrite to named directories or files. A pattern being syntactically
   valid across the whole repository is not a reason to apply it there.

Afterwards, re-run the query. Zero remaining matches of the old shape is the proof the rewrite was
complete; the diff only shows what changed. Then run the formatter, typechecker, or tests covering
the touched files, because a syntactically correct rewrite can still be wrong.

## Pattern Discipline

Write the narrowest pattern that expresses the shape, and read it back as "what else could this
match?" before running it — and always before rewriting with it. A metavariable that stands for any
expression will happily stand for one you did not have in mind.

Prefer several precise queries over one clever one. A pattern that needs a paragraph of explanation
is a pattern whose match set nobody will verify, and an unverified match set is how a rewrite reaches
code the author never considered.

## Verification

- Runtime catalog surface: `node --test test/runtime-skills.test.mjs`
- Documentation corpus surface: `node --test test/docs.test.mjs`
- Command and chat route surface: `node --test test/static-workflow-command.test.mjs`
- Search-specific proof: the probe transcript, the query, and for a rewrite the re-run showing the old shape absent

## When to Stop

Stop when no engine is available and the question genuinely requires syntax rather than text; when a
rewrite is requested without approval, bounded scope, or a preview; when the preview reveals match
classes that were not intended; when the engine cannot parse the target language, since an empty
result there is absence of capability rather than absence of the shape; or when a language server
would answer the question properly and is available. In each case name the gap rather than
substituting a weaker result for the one that was asked for.
