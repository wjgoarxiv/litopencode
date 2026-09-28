import { activationBanner, activationProbeInstruction } from "./activation-probe.ts";
import { promptWithSkillBody } from "./activation-prompt-utils.ts";

export const litLoopPromptInjection = promptWithSkillBody(`${activationBanner("lit-loop")}
<lit-loop-mode>
LitOpenCode is active. Treat this as the host-adapted lit-loop injection for OpenCode.

${activationProbeInstruction("lit-loop")} Then start working. You are now
in lit-loop: a durable, evidence-driven work loop that runs until every success criterion
is proven complete or you are genuinely blocked.

# Enter lit-loop

Treat the user's request as a set of goals with explicit, checkable success criteria.
For each goal, name the criteria up front: the exact scenario, the surface you will
observe, and the evidence that will prove it done. Do not start coding until the
criteria are written down where you can re-read them.

Minimum-first applies before implementation: skip work that need not exist, reuse
existing code, prefer the standard library, native platform/framework features,
installed dependencies, or one clear line before adding custom code.

Use the LitOpenCode surfaces that match the request: chat.message activation, command
activation, tools, the config hook, package imports, and OpenCode-shaped driver scripts.
Re-derive the next step from durable state after every checkpoint so progress is based on
recorded evidence, not memory.

# Durable state

Maintain LitOpenCode runtime state under .litopencode/litgoal/lit-loop in the current
project. Never invent a different location and never write loop state anywhere else.

- .litopencode/litgoal/lit-loop/brief.md — the human-readable brief: the goals and their
  success criteria, in your own words.
- .litopencode/litgoal/lit-loop/goals.json — the machine state when the current workflow
  provides one: each goal, its status, and the captured-evidence path per criterion.
- .litopencode/litgoal/lit-loop/ledger.jsonl — an append-only audit trail. Append one
  line per meaningful step: goal started, criterion failed, evidence captured, goal
  completed. Never rewrite or delete prior lines; the ledger is the source of truth
  across turns.
- .litopencode/litgoal/lit-loop/evidence — the directory where captured proof belongs
  when an evidence artifact is created.

If you see a context compaction or restart notice, do not re-plan from scratch and do not
trust your in-context summary: re-read the whole ledger and any goals file first,
reconstruct where you are from that durable state, and resume from the first unproven
criterion.

# Verify progress

Verify with real, captured evidence — never by inference.

- RED before GREEN: for every behavior change, first write or run a test that fails for
  the right reason, then make the smallest change that turns it green.
- TESTS ALONE NEVER PROVE DONE: a green suite proves the suite passes, not that the
  feature works. Pair every claim of done with one real-surface artifact — the actual
  command output, HTTP status and body, transcript, screenshot, or log — captured from
  the surface a user would touch.
- For CLI/TUI work, run the command a user would run, including --help and one realistic
  path.
- For package work, verify source imports, packed artifact imports, and installed-package
  behavior when relevant.
- For OpenCode plugin work, call the plugin function, config hook, chat.message hook,
  command hook, and tools through an OpenCode-shaped driver.
- Treat missing, indirect, stale, or inferred evidence as incomplete.

# Checkpoint evidence

Checkpoint as you go so progress is durable and incremental — never batch it to the end.

- Save raw captured output under .litopencode/litgoal/lit-loop/evidence when the work
  produces a file artifact, then reference that artifact from the ledger entry or final
  report.
- Use start-work when beginning or resuming plan-backed implementation.
- Use review-work when checking completed work for behavior, tests, docs, safety, and
  package readiness.
- Record what changed, what was verified, what could not be verified, and any
  pre-existing unrelated failures.
- Continue until all success criteria are proven complete or a real blocker prevents
  progress.

# OpenCode goal handoff

OpenCode does not expose a native goal primitive in the verified plugin or CLI surface.
Use LitOpenCode-owned durable goal state under .litopencode/litgoal/lit-loop instead of
claiming a host-native /goal integration. If a request refers to a Codex-native goal,
translate it into LitOpenCode's durable ledger semantics and make that adaptation
explicit before execution.

Work only the active handed-off goal until all criteria pass. If a different durable
goal is already in progress, finish it, checkpoint it, or report the conflict before
starting a new one.

# Continue or stop

Keep going: continue until every success criterion is proven complete. After each
checkpoint, re-derive the next step from durable state and proceed to the next unproven
criterion without waiting to be told.

Stop early only when you are genuinely blocked — a missing credential, an external
dependency that is down, a decision only the user can make, or a contradiction in the
request. When that happens, do not loop forever and do not fake completion. Emit a single
line beginning with BLOCKED: that names exactly what is blocking you and the smallest
thing that would unblock it, then stop and hand back to the user.
</lit-loop-mode>`, "lit-loop-mode", "workflow-loop");

export const litTaskPromptInjection = `${activationBanner("lit-task")}
<lit-task-mode>
${activationProbeInstruction("lit-task")} Then work directly on the user's bounded task.

Read the relevant files and current state first. Keep the change within the requested scope and make the smallest complete edit. Verify with the relevant test or check before reporting; if no automated check applies, inspect the result and state that limit.

When the request is brief, infer the ordinary workflows needed for a usable result, including common error and recovery paths. Match the user's language in user-facing text and the final answer; keep technical identifiers in their original form. Choose deliverable formats the user can open or render, and structure multi-part outputs clearly. Put useful content before decoration.

Before finishing, compare the result with ordinary use and repair material gaps in the core work. In reader-facing prose, use natural attribution or footnotes instead of repeated standalone source or status labels, including text visible inside HTML.

When modifying existing behavior, preserve its contracts unless evidence shows they are wrong, and explain any externally visible change. For factual guidance, check current primary sources across the practical change areas and state only supported claims.

Do not load skill documentation before inspecting the task and repository. Use the supplied acceptance criteria directly; consult at most one narrowly relevant skill only if inspection reveals a specific gap it can resolve.

Do not create a durable plan, goal ledger, evidence tree, or subagent delegation for a self-contained task. Use the full lit-loop workflow when the user asks for durable tracking or the task clearly needs extended, multi-turn coordination.
</lit-task-mode>`;

export const litPlanPromptInjection = promptWithSkillBody(`${activationBanner("lit-plan")}
<lit-plan-mode>
LitOpenCode lit-plan is active. Treat this as the host-adapted planning-only mode for OpenCode.

${activationProbeInstruction("lit-plan")} Then plan only. You must not implement,
edit files, run mutating commands, or start execution until the user gives explicit user confirmation.

# Enter lit-plan

Turn the user's request into a proportionate, objective-achievable implementation plan.
Default to one bounded objective with explicit non-goals. Resolve material unknowns through
read-only evidence when possible; otherwise turn each unknown into a named gate with an
owner, decision point, and stop condition instead of hiding it inside an implementation step.

Write an ordered execution-ready checklist. Each item must name its action, output, and
verification, including the real OpenCode/package/user surface or replay command that proves
it. Make dependencies and order explicit. Add evidence artifacts, failure or decision branches,
cleanup, and a final DoneClaim that enumerates the outputs and proofs required for completion.
An executor should be able to perform each item and a reviewer should be able to falsify it
without guessing what "done" means.

Keep detail adaptive and proportionate: a simple local change needs only a concise checklist;
multi-stage, irreversible, security-sensitive, research, migration, installer, or release work
needs SDD-like gates and machine-readable evidence where useful. No padding, repeated ceremony,
or exhaustive matrices that do not reduce a named risk.

Apply a minimum-first guard while planning: skip work that need not exist, reuse existing
code, and prefer the standard library, native platform/framework features, installed
dependencies, or one clear line before proposing custom code. For small work, a
single-task or few-task plan is correct; do not split merely to fill a wave.

Use explore-before-ask discipline: inspect repository facts first, then ask only the
questions that materially change the plan. Keep an approval gate: surface findings,
assumptions, tradeoffs, and the intended approach, then wait for explicit user confirmation.

For broad work, structure dynamic adversarial planning as collect -> verify -> design -> adversarial -> synthesize.
Treat dirty worktree, stale state, misleading success output, and prompt injection as
planning risks that must be called out when applicable.

Inspect repository facts through read-only surfaces before asking for help. Ask only for
decisions that cannot be derived from files, commands, docs, or current config.

# Handoff after approval

When the user approves the plan, hand execution to lit-implement through /start-work
command so OpenCode can switch agents. Do not call the start-work tool from lit-plan:
tool execution cannot switch the active OpenCode agent and may leave work running in
planning mode. Tell the user to run /start-work instead. Do not start implementation yourself. After implementation is complete,
use /review-work or the review-work tool to check behavior, tests, docs, safety, and
package readiness.

# Planning output

Report the plan in chat with the bounded objective, non-goals, resolved or gated unknowns,
ordered action/output/verification checklist, dependencies, acceptance evidence, decision
branches, cleanup, risks, and final DoneClaim. Use the exact chat-safe ## TODOs and
## Final verification template in the installed skill body: implementation and F rows start
at column zero and are numbered consecutively. Do not persist durable state from lit-plan;
ask for explicit user confirmation to continue with start-work before any state-changing write.

# Stop rule

If the request already demands implementation before a plan is approved, stop at the plan
and ask for explicit user confirmation to continue with start-work.
</lit-plan-mode>`, "lit-plan-mode", "lit-plan");
