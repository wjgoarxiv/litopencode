---
name: autoconference:plan
description: |
  Planning-only 8-step wizard that produces a conference proposal and approval packet.
  TRIGGER when: user wants to set up a new conference, plan a conference, create conference.md.
  DO NOT TRIGGER when: user wants to run an existing conference (use autoconference).
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Autoconference Plan — 8-Step Setup Wizard

## OpenCode authority envelope

This planning document is inert guidance. `lit-plan` records a finite root-owned proposal, budget,
roots, packet schemas, and review contract before any mutation or delegation, including interactive
runs. Only explicit `/start-work` may consume an approved packet. Children remain depth-one and
packet-only; children must not write or mutate root-owned state, select models, or invoke routes.

*A planning-only wizard that produces a complete in-chat `conference.md` proposal and approval packet.
It must not write files, run an evaluator, dispatch agents, or execute a conference. Explicit
`/start-work` owns every approved write, evaluator verification, and conference action.*

`scripts/init_conference.py` is an incomplete scaffold helper, not a completed conference artifact.
It deliberately emits labeled placeholders for the baseline, allowed/forbidden scope, partition
details, and references. The planning route may propose invoking it, but explicit `/start-work` must
run the helper, fill every approved placeholder, validate the resulting file and task packet, and
record the evaluator receipt before Phase 1.

## Purpose

The `plan` wizard exists because launching a conference with a bad config wastes hours of compute. Each step probes the user's intent, validates feasibility, and encodes decisions into a proposed `conference.md` for user review.

**Output:** Proposed `conference.md` content plus one approval packet naming writes, evaluator gate,
task capability, budget, roots, forbidden actions, cancellation, resume, and review evidence.
**Does NOT:** Write files, run evaluators, spawn agents, or begin research.

---

## Wizard Protocol

Walk the user through all 8 steps in order. Do not skip steps. Do not assume answers — present options and wait for explicit confirmation.

After all 8 steps, render the proposal packet, ask for approval, and print the explicit `/start-work` handoff.

---

## Step 1: Goal Clarification

**Objective:** Arrive at a specific, measurable goal.

Ask the user:
> "What do you want to achieve with this conference? Describe it in one or two sentences."

After the user answers, probe for specificity:
- "What would success look like at the end? Describe the ideal output."
- "How will you know the conference worked?"
- "What is the concrete deliverable — a number, a document, a piece of code, an insight?"

**Push back on vague goals.** If the user says something like "I want to improve my model" or "I want better results", stop and ask:
> "That's a direction, but not yet a goal. Can you be more specific? For example: 'Improve model accuracy on the CIFAR-10 test set from 85% to above 90%' or 'Generate a synthesis document comparing retrieval strategies for long-context summarization.'"

Do NOT proceed to Step 2 until the goal is specific enough that a researcher agent could know what to work on.

**Record:** `goal` — the final agreed goal statement.

---

## Step 2: Mode Selection

**Objective:** Choose `metric` or `qualitative` mode.

Explain the two modes clearly:

> **Metric mode** — there is a numeric score that directly measures success. Researchers are evaluated by whether the number goes up (or down). Examples: accuracy, latency, F1 score, BLEU, loss, LLM judge score 1-10.

> **Qualitative mode** — success is about the quality of reasoning, writing, or synthesis. There is no single number, so an independent reviewer packet judges whether outputs satisfy the approved criteria. Examples: literature review synthesis, hypothesis generation, design exploration, writing quality improvement.

Help the user decide with this decision rule:
> "Can you measure success with a number that is reliably produced each iteration? → **metric**. Is success about the quality of reasoning, writing, or ideas — where 'good' requires a human (or LLM judge) to assess? → **qualitative**."

Warn about metric mode requirements:
> "Metric mode requires an evaluator script that can be run automatically. If you don't have a script that produces a number, start with qualitative mode — you can always switch."

**Record:** `mode` — `metric` or `qualitative`.

---

## Step 3: Metric + Evaluator Design

**Objective:** Define how success is measured and verify the evaluator works.

### For metric mode:

Ask:
1. "What is the metric name?" (e.g., "accuracy on test set", "p95 latency in ms", "LLM judge score 1-10")
2. "What is the target value?" (e.g., "> 95%", "< 50ms", "> 8.0")
3. "Is the direction maximize or minimize?"
4. "What is the baseline value right now — before any conference work?"
5. "What command or script produces the metric? I will place it in the approval packet for `/start-work` verification."

**DRY-RUN GATE:** Define the baseline verification command and acceptance contract now, but do not run
it in `lit-plan`. Explicit `/start-work` runs it after approval and captures stdout, stderr, exit status,
timeout, and parsed numeric output before any conference write or task dispatch.

```
[Proposed evaluator dry-run for explicit /start-work: {user's command}]
```

- If `/start-work` receives exit 0 and the expected numeric output, it records the measured baseline and may apply the approved setup writes.
- If it fails, times out, or produces unexpected output, `/start-work` stops before writes and returns a blocked receipt; a correction requires a revised proposal and approval.
- If the measured value differs from the user's expectation, pause for a new decision rather than beginning the conference.

The dry-run gate is non-negotiable, but it is an execution gate rather than planning authority.

### For qualitative mode:

Ask:
> "Describe what 'good' looks like for this conference. The independent reviewer packet will use this as its approved rubric. Be specific — vague criteria produce vague judgments."

Prompt for specificity if needed:
- "What makes a result clearly better than the baseline?"
- "What are the top 2-3 criteria the Reviewer should weight most heavily?"
- "Are there any disqualifying failure modes — outputs that should be marked 'overturned' regardless of surface quality?"

**Record:**
- Metric mode: `metric_name`, `metric_target`, `metric_direction`, `baseline_value`, `evaluator_command`
- Qualitative mode: `success_criteria` (multi-line description)

---

## Step 4: Researcher Count + Role Assignment

**Objective:** Decide how many researchers and whether a Devil's Advocate is needed.

Ask: "How many researchers should participate in this conference?"

Present options:
- **2 researchers** — Minimal. Good for A/B comparison of exactly two approaches. Use when you have two specific strategies you want to compare directly.
- **3 researchers** (recommended) — Balanced. Enough diversity for cross-pollination without excessive overhead. Suitable for most problems.
- **4–5 researchers** — Large-scale. For broad search spaces with many distinct strategies. Expect longer wall-clock time and higher token cost.

If the user already specified `count` in a partial conference.md, confirm it: "You mentioned N researchers earlier. Proceed with this?"

Next, ask about the Devil's Advocate:
> "Should one of the N researchers be a Devil's Advocate — deliberately pursuing contrarian strategies?"

Explain:
> "A Devil's Advocate is assigned to challenge the mainstream approach. They try the opposite of what seems obvious, test assumptions others take for granted, and explore strategies the other researchers would dismiss. This catches blind spots and occasionally discovers breakthroughs. If you have 3 researchers and add a Devil's Advocate, one of the 3 fills that role (no additional agent)."

**Record:** `count`, `devil_advocate` (yes/no), and if yes, which researcher slot (typically the last one, e.g., Researcher C for count=3).

---

## Step 5: Search Space Partitioning

**Objective:** Decide how researchers divide the search space.

Ask: "How should researchers divide the search space?"

Present options:
- **Assigned** (recommended) — Each researcher gets a specific focus area. Less overlap, more coverage. Researchers are assigned to distinct regions of the search space and should not duplicate each other's work.
- **Free** — All researchers explore the full space. More competition, potential redundancy. Useful when you're unsure how to partition, or when the search space is small enough that overlap is acceptable.

If `assigned`:
For each researcher slot (A, B, C, ...), ask:
> "What should Researcher {X} focus on? Describe their specific area of exploration."

Example prompts to help the user think:
- "If this is about ML training: Researcher A → architecture changes, Researcher B → data augmentation, Researcher C → optimization hyperparameters"
- "If this is about writing quality: Researcher A → structure and flow, Researcher B → evidence and citations, Researcher C → tone and clarity"
- "If Devil's Advocate is enabled: Researcher C's focus is the contrarian role — they challenge the assumptions of A and B"

If `free`: no per-researcher focus needed. All researchers receive the full search space description.

Also ask (for both modes):
- "What are researchers ALLOWED to change? (e.g., 'any code in src/models/, any training hyperparameter')"
- "What are researchers FORBIDDEN from changing? (e.g., 'test data, eval scripts, the model architecture')"

**Record:** `partitioning_strategy`, per-researcher focus areas (if assigned), `allowed_changes`, `forbidden_changes`.

---

## Step 6: Devil's Advocate Configuration

**Objective:** Configure the contrarian researcher's behavior (only if enabled in Step 4).

If Devil's Advocate was NOT enabled in Step 4, skip this step entirely.

If Devil's Advocate was enabled, configure their focus:

> "The Devil's Advocate (Researcher {X}) will deliberately challenge the mainstream approach. Let's define their contrarian mandate."

Ask:
1. "What assumptions does the mainstream approach make that should be challenged? (e.g., 'that larger batch size is better', 'that more context always helps', 'that the current prompt structure is optimal')"
2. "Are there specific 'anti-strategies' the Devil's Advocate should pursue? (e.g., 'try the smallest possible model', 'try removing the retrieval step entirely', 'try the simplest possible baseline')"
3. "Should the Devil's Advocate be allowed to propose changes that break the current evaluation metric (to stress-test the metric itself)?" → yes/no

Explain the Devil's Advocate role one more time to confirm the user understands:
> "The Devil's Advocate is not trying to win — they're trying to surface what everyone else is missing. Their best contribution is a finding that invalidates a shared assumption, even if their own metric score is low."

**Record:** `devil_advocate_mandate` — the contrarian researcher's specific instructions.

---

## Step 7: Execution Preference

**Objective:** Configure how the conference will run.

Ask: "Do you want this conference to run overnight / unattended, or interactively with pauses for your review?"

### If a long unattended budget is requested:

Explain:
> "This OpenCode port starts no daemon, shell-background coordinator, or separate loop helper. The
> approval packet records a finite budget and explicit `/start-work` owns the bounded execution.
> During approved execution, `scripts/check_conference.sh` may read the approved conference root to
> produce a status receipt; it grants no authority."

Ask:
- "What is your time budget? (e.g., '8h', '2h', '30m')"
- "What is the maximum number of rounds? (default: 4)"
- "What is the maximum total iterations across all researchers? (default: 60)"
- "What is the per-researcher timeout per round? (default: 30m)"

### If interactive:

Ask:
- "How often should I pause for your review?"
  - After every round (recommended for first run)
  - Every N rounds (ask for N)
  - Only on PIVOT events (when a researcher makes a radical strategy change)
  - Never — run to completion

Ask the same budget questions:
- "Time budget?"
- "Max rounds?"
- "Max total iterations?"
- "Per-researcher timeout?"

**Record:** `pause_every` (never / every_round / every_N_rounds / pivot_only), `time_budget`, `max_rounds`, `max_total_iterations`, `researcher_timeout`.

---

## Step 8: Proposal and Approval Packet

**Objective:** Render the fully populated proposed `conference.md` and obtain approval without writing it.

First, ask: "Where should `/start-work` write the approved conference.md file?"
- Default: `./conference/conference.md`
- If the directory does not exist, include its creation as a proposed write action.

Then render the in-chat proposal using `assets/conference_template.md` as the structural base. Fill in
every proposal field from Steps 1–7. If the approved execution chooses `scripts/init_conference.py`,
its exit zero proves only incomplete scaffold creation: `/start-work` must replace and validate every
labeled placeholder before accepting the file. Applying complete proposed bytes directly is a separate
bounded write option within the exact approved root.

### Field mapping:

| Template field | Source |
|---------------|--------|
| `{Title}` | Derive from goal (e.g., "Optimize CIFAR-10 Accuracy") |
| `Goal` | Step 1: goal statement |
| `Mode` | Step 2: metric / qualitative |
| `Success Metric` | Step 3 (metric mode only) |
| `Success Criteria` | Step 3 (qualitative mode only) |
| `Count` | Step 4 |
| `Iterations per round` | Step 7: default 5, or ask if not set |
| `Max rounds` | Step 7 |
| `Allowed changes` | Step 5 |
| `Forbidden changes` | Step 5 |
| `Search Space Partitioning → Strategy` | Step 5 |
| `Researcher A/B/C Focus` | Step 5 (if assigned) |
| `Max total iterations` | Step 7 |
| `Time budget` | Step 7 |
| `Researcher timeout` | Step 7 |
| `pause_every` | Step 7 |
| `Current Approach` | Step 1: baseline description |
| `Shared Knowledge` | Leave blank (auto-populated at runtime) |

If Devil's Advocate is enabled, add a comment in the Researcher A/B/C Focus section indicating which researcher is the Devil's Advocate and their mandate from Step 6.

Present the proposed file bytes and an approval packet. Then confirm to the user:

```
conference.md proposed for: {path}

Next steps:
1. Review the proposal and exact approval packet.
2. Approve it, then invoke explicit /start-work to run the evaluator gate and write the approved file.
3. If the incomplete scaffold helper is used, /start-work fills and validates all placeholders first.
4. /start-work may then run the bounded conference with live root task capability.
5. During approved execution, inspect receipts with scripts/check_conference.sh or the bounded event file.

Skill chain: plan → autoconference → ship
```

---

## Wizard Invariants

- Never write `conference.md` from `lit-plan`; explicit `/start-work` owns an approved write.
- Never skip the proposed DRY-RUN GATE in Step 3 for metric mode; explicit `/start-work` owns execution.
- Never proceed past Step 1 without a specific, measurable goal.
- Never add features the user didn't ask for (no extra researchers, no extra rounds).
- The wizard produces proposal text and one approval packet, not a filesystem artifact.
- The wizard does NOT start a conference, spawn researchers, or run any research.
