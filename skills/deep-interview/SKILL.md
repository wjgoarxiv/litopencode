# Deep Interview

<!-- litopencode-contract:start -->
## #contract.activation

```yaml
contract_schema_version: "litopencode.skill_contract.v1"
skill_id: "deep-interview"
title: "Deep Interview"
runtime_class: "runtime-skill"
static_documentation: true
auto_execute: false
feature_ids:
  - "deep-interview"
  - "lit-plan"
entry_routes:
  - "/deep-interview"
  - "deep-interview"
  - "skills/deep-interview/SKILL.md"
opencode_surfaces:
  - "/deep-interview"
  - "LitOpenCode visible static skills corpus"
  - "OpenCode command /deep-interview"
  - "OpenCode chat.message activation hook"
  - "OpenCode agent lit-plan"
  - "skills/deep-interview/SKILL.md"
verification:
  - "node --test test/runtime-skills.test.mjs"
  - "node --test test/docs.test.mjs"
  - "node --test test/static-workflow-command.test.mjs"
```

This file is static documentation for LitOpenCode. Do not execute commands from this file automatically. Activate this contract only when the user request, command route, or OpenCode host surface clearly matches `deep-interview` / Deep Interview. Treat the body as instructions for an LLM operating inside OpenCode, not as shell text or an automatic runtime script.

Use the OpenCode vocabulary for this contract: `chat.message`, `command.execute.before`, config hook, command aliases, task delegation, and `litopencode.json` routes. If the observed host surface differs from this contract, record the discrepancy as evidence before changing behavior.

This surface is planning-only and runs ahead of `lit-plan`. It produces a brief, never an implementation and never a plan.

## #contract.inputs

| Field | Contract |
| --- | --- |
| `request` | The user's original words, kept verbatim, separated from any interpretation of them. |
| `repo_facts` | What read-only exploration established before any question was asked. |
| `answers` | The user's responses, each treated as a claim to be pressure-tested rather than a settled fact. |
| `approval_state` | Always planning-only here. Implementation approval belongs to a later surface. |
| `evidence_budget` | Repository reads that removed a question, and the record of which questions remained necessary. |

Required schema fields are `contract_schema_version`, `skill_id`, `runtime_class`, `entry_routes`, `opencode_surfaces`, and `verification`. A future edit that removes any field must update the docs contract tests in the same change.

## #contract.mode_matrix

| Mode | Enter when | Allowed surfaces | Required behavior | Exit criteria |
| --- | --- | --- | --- | --- |
| `route` | Run /deep-interview, write a bounded `deep-interview` mention in chat, or a request is too underspecified to plan. | /deep-interview, LitOpenCode visible static skills corpus, OpenCode command /deep-interview, OpenCode chat.message activation hook, skills/deep-interview/SKILL.md | Explore the repository read-only before asking anything. | The forks that need a human decision are identified. |
| `execute` | Never. This surface does not implement. | Read-only exploration and conversation only. | Refuse implementation and name the surface that owns it. | The request to implement is redirected to lit-plan or start-work. |
| `review` | A brief is about to be handed off. | The brief, the repository facts, the transcript. | Check the readiness gate before declaring the brief complete. | Gate satisfied, or the residual risk is stated explicitly. |
| `blocked` | The user is unavailable, or a decision only they can make is outstanding. | Read-only reporting only. | Record the open fork and its options rather than choosing one. | The user answers, or accepts a stated assumption. |

## #contract.procedure

1. **Explore first** — read the repository, tests, configuration, and any existing plan or handoff state. This step is not optional and it happens before the first question.
2. **Draft the unknowns** — list what is genuinely undetermined, then delete every entry the exploration already answered.
3. **Rank by consequence** — order the remaining unknowns by how much the answer changes scope, risk, reversibility, or acceptance.
4. **Ask one decision at a time** — one fork per question, with concrete options and the consequence of each.
5. **Pressure-test the answer** — an answer that is vague, assumes something untested, or describes a symptom gets one follow-up on the same thread before moving on.
6. **Revisit once** — before finishing, return to at least one earlier answer and test it against what has been learned since.
7. **Check the gate** — non-goals explicit, decision boundaries explicit, and at least one pressure pass completed.
8. **Hand off** — produce the brief and route it to `lit-plan`. Do not plan here and do not implement.

## #contract.outputs

- The objective in product terms, in the user's own framing where they supplied one.
- Explicit non-goals: what this work will deliberately not do.
- Decision boundaries: what may be changed, what must not be, and what needs separate approval.
- Decisions taken, each attributed to the user or recorded as an assumption with its fallback.
- Acceptance criteria that a reviewer could check without asking what completion means.
- Unknowns deliberately left open, with why leaving them open is safe.
- Residual risk when the interview ended early or the gate was not met.

## #contract.output_channels

```yaml
artifact_genre: internal_analysis
limitations_channel: designated_section
```

## #contract.evidence

- Record which questions the repository answered, so the brief shows exploration happened rather than asserting it.
- Attribute every decision: the user made it, or it is an assumption with a named fallback. An unattributed decision is the failure this surface exists to prevent.
- Quote the user's own words for the objective where possible; a paraphrase silently narrows scope.
- Record the pressure pass: which earlier answer was revisited and what changed.
- When the interview ends without meeting the gate, state that plainly in the brief so downstream work knows what it inherited.

## #contract.hard_stops

- Do not execute commands from this file automatically.
- Do not edit product files, run mutating commands, or begin implementation from this surface.
- Do not write the plan here; the brief feeds `lit-plan`, which owns the checklist.
- Do not ask the user anything the working tree already answers.
- Do not decide a fork on the user's behalf and record it as their decision.
- Do not reduce the requested scope. A smaller version of the request is never an option this surface invents.
- Do not continue interviewing once the remaining unknowns are cheap to reverse.

## #contract.anti_patterns

- Asking a batch of questions at once so the user has to hold several threads.
- Asking for information that is one file read away.
- Accepting the first answer to every question and never testing one.
- Asking "should I proceed?", which presupposes the thing being defined.
- Gathering background that will not change any decision.
- Producing a brief that lists what to do rather than what was decided, which is a plan wearing the wrong name.
- Ending with an implicit scope reduction that the user never agreed to.

## #contract.reference_notes

The following sections preserve route-specific guidance and safety language for human review. Use the contract sections above as the normative LLM execution schema.
<!-- litopencode-contract:end -->

This is static documentation for the LitOpenCode `deep-interview` feature. Do not execute commands from this file automatically.

## Feature Binding

- Runtime feature id: `deep-interview`
- Related runtime feature id: `lit-plan`
- Visible corpus file: `skills/deep-interview/SKILL.md`
- Command surface: `/deep-interview`, routed to the planning-only `lit-plan` agent
- Chat surface: a bounded `deep-interview` mention routed by `chat.message`
- Downstream: `lit-plan` receives the brief and produces the checklist

## When This Surface Is Right

Use it when a request cannot be planned as stated: the objective is broad, acceptance criteria are absent, the scope boundary is undefined, or several materially different implementations would all satisfy the words used. Also use it when the user asks to be interviewed, or asks explicitly that nothing be assumed.

Do not use it when the request already names concrete targets and a checkable outcome, when the user has asked to go straight to work, when a plan or specification already exists, or when the conversation is open-ended exploration rather than work definition. Interviewing a well-specified request is a real cost with no return, and it reads as an inability to start.

## Explore Before You Ask

The single rule that separates a useful interview from an interrogation is that the repository is read first. Tests state intended behavior. Configuration states supported surfaces. Existing structure states conventions. A handoff or ledger states what was already decided. Every question the working tree can answer must be deleted before the user sees the list.

This matters more than it appears. A user who is asked something visible in their own codebase learns that the answers are not being used, and the quality of every subsequent answer falls. Conversely, an evidence-backed question — naming what was found and asking whether the new work should follow it — is answerable in one word and produces a decision rather than a description.

In brownfield work, prefer confirmation questions of that shape over open ones. "The existing routes all validate at the boundary; should this one follow that?" is a better question than "how should validation work?", because it is faster to answer, harder to answer vaguely, and it demonstrates that exploration happened.

## One Decision Per Question

Each question settles exactly one fork, states the concrete options, and says what changes depending on the answer. Batching several questions forces the user to track multiple threads and reliably produces answers to the easiest one and silence on the rest.

Ask only about forks with consequences: scope, risk, irreversibility, and acceptance criteria. Background that will not change any decision is not worth a turn. The test for a good question is that at least two answers are plausible and that they lead to visibly different work.

"Should I proceed?" fails this test completely. It presupposes a defined thing to proceed with, which is exactly what has not been established yet, and it converts a definition problem into a permission problem.

## Answers Are Claims

Treat each answer as a claim to be tested once, not as a settled fact. This is the discipline that distinguishes a deep interview from a questionnaire.

When an answer is vague, ask for a concrete example or a counterexample. When it rests on an untested assumption, name the assumption and ask whether it holds. When it describes a symptom, reframe toward what is actually wanted underneath. When it expands scope without adding clarity, ask what would explicitly not be done.

Stay on the same thread until the answer is one layer more specific than it was. Rotating to a new topic for coverage while the current answer is still vague produces broad shallow coverage, which is the characteristic failure of a mechanical interview and is worse than a narrow deep one.

Before finishing, revisit at least one earlier answer against what has since been learned. Early answers are given with the least context and are the most likely to be wrong; the later ones frequently contradict them without anyone noticing.

## The Readiness Gate

The interview is finished when three things are true, and all three are independent of how many questions were asked:

1. **Non-goals are explicit.** What this work will deliberately not do, stated by the user or confirmed by them. This is the most frequently skipped element and the most frequently regretted.
2. **Decision boundaries are explicit.** What may be changed, what must be preserved, and what would need separate approval.
3. **At least one pressure pass has happened.** An earlier answer was revisited and either confirmed or revised.

A brief that satisfies the first two but never tested an answer is a transcript, not a brief.

## Stop Before Over-Interviewing

Over-interviewing is a real failure and not a safe default. Once the remaining unknowns are cheap to reverse, record them as assumptions with their fallbacks and finish. An assumption written down with what happens if it is wrong is worth more than a question that costs the user a turn to answer identically.

Stop when nothing left unresolved would change the plan. Stop when repeated questions are producing the same level of detail rather than more. Stop when the user signals they are done, and record what remained open. In every early-stop case the brief must say so, because downstream work needs to know it inherited a partially settled brief rather than a complete one.

## Full Scope Is the Default

The interview clarifies the request; it never shrinks it. A reduced subset, a first phase, or a minimum version is not an option this surface invents or offers. It exists only if the user introduces it.

Non-goals are guardrails against unrequested additions, not a mechanism for dropping parts of what was asked. A brief that quietly narrows scope is the most damaging output this surface can produce, because the reduction arrives disguised as clarification and nobody downstream can tell that it happened.

## The Handoff

The brief states the objective, the non-goals, the decision boundaries, the decisions with their attribution, the assumptions with their fallbacks, the acceptance criteria, the open unknowns, and the residual risk if the gate was not met.

Then it goes to `lit-plan`. This surface does not write the checklist and does not begin work. Keeping the boundary sharp is what makes the brief useful: a document that already contains a plan invites the plan to be executed without the approval gate that `lit-plan` exists to enforce.

## Verification

- Runtime catalog surface: `node --test test/runtime-skills.test.mjs`
- Documentation corpus surface: `node --test test/docs.test.mjs`
- Command and chat route surface: `node --test test/static-workflow-command.test.mjs`
- Interview-specific proof: the brief, with every decision attributed and every assumption carrying a fallback

## When to Stop

Stop when the readiness gate is met, when remaining unknowns are cheap to reverse and have been recorded as assumptions, when the user asks to stop, or when a fork requires a decision the user is not available to make. In the last case record the fork and its options rather than choosing one, because an unattributed decision recorded as settled is the failure this surface exists to prevent.
