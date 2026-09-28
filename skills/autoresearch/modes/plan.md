---
name: autoresearch:plan
description: |
  Planning-only 7-step setup wizard that produces a complete research proposal and
  approval packet without writing files or executing an evaluator or research loop.
  TRIGGER when: user wants to set up a research project; user wants to plan before
  running the loop; user says "plan my research"; user has a goal but no research.md;
  user invokes /autoresearch-plan.
  DO NOT TRIGGER when: research.md already exists and the user wants to run the loop;
  user wants a one-shot answer; user wants to debug, not optimize.
allowed-tools:
  - Read
  - Glob
  - Grep
---

# autoresearch:plan — Research Setup Wizard

## OpenCode authority envelope

This planning document is inert guidance. `lit-plan` records the objective, evaluator, finite budget,
canonical roots, proposed write set, rollback policy, and review gate before any mutation, including
an interactive run. Only explicit `/start-work` may perform bounded writes, commands, evaluation, or
reversion within an approved packet; this route itself remains read-only.

A planning-only 7-step interview that produces a proposed `research.md`, an optional evaluator draft,
and an approval packet before a single experiment runs. It must not write files, run an evaluator, or
execute a research loop. Every proposed write and evaluator command is handed to explicit `/start-work`
after the user approves the packet.

`scripts/init_research.py` is an incomplete scaffold helper, not a completed research artifact. Its
output deliberately retains labeled placeholders for the baseline, current approach, search space,
and references. The plan may propose a helper invocation, but explicit `/start-work` must run it,
complete the approved placeholders, validate the resulting fields, and record the baseline receipt
before any experiment.

## Wizard Protocol

**One step at a time.** Present the step title and question(s). Wait for the user's response. Summarize what you recorded ("Got it — the proposal will set metric: accuracy, direction: maximize"). Then proceed to the next step.

**Do not skip steps.** Each step produces a proposal field that feeds Step 7. If the user's answer is vague, probe once for specificity, then record your best interpretation and note it as an assumption.

---

## Step 1 — Goal Clarification

**Probe for specificity. Vague goals produce useless research loops.**

Ask:
1. "What are you trying to improve or discover?"
2. "What does success look like in concrete terms — not 'better', but what number or outcome?"
3. "Is there anything this work must NOT break?"

**Probe rules:**
- If the answer contains words like "better", "faster", "improve" without a reference point → ask "compared to what baseline?"
- If no domain is mentioned → ask "what system/file/model/prompt are we working on?"
- If multiple goals are stated → ask "if you could only achieve one of these, which one?"

**Record:** `goal_statement` (1-2 sentences, specific and measurable)

---

## Step 2 — Metric Definition

**What to measure, how to measure it, and what direction counts as progress.**

Ask:
1. "What is the single number that determines if this experiment succeeded or failed?"
2. "Are you maximizing or minimizing it?"
3. "What value would make you stop and say 'we're done'? That's the target."
4. "Is this metric noisy? (e.g., varies between runs due to randomness or timing)"

**Guide the user if stuck:**
- Performance → latency (ms), throughput (req/s), memory (MB) — direction: minimize
- Quality → accuracy (%), F1, LLM-judge score (1-10) — direction: maximize
- Cost → tokens, dollars, lines of code — direction: minimize

**Record:** `metric_name`, `direction` (maximize/minimize), `target_value`, `noise_runs` (1 if deterministic, 3-5 if noisy)

---

## Step 3 — Search Space Mapping

**Enumerate what can change and, critically, what must not.**

Ask:
1. "What files, parameters, configs, or components can the agent modify?"
2. "What must never change? (test sets, APIs, data formats, production files)"
3. "Are there any values with hard limits? (e.g., latency must never exceed 2s even if the metric improves)"

**Probe rules:**
- If the allowed scope is very broad → ask "can you narrow it? Broad search spaces waste iterations."
- If no forbidden list is given → explicitly confirm: "So the agent has free rein except for what you just listed — is that right?"

**Record:** `allowed_changes` (bullet list), `forbidden_changes` (bullet list), `guard` (optional hard constraint)

---

## Step 4 — Constraint Elicitation

**Scope the loop before it starts.**

Ask:
1. "How many iterations should the agent run? (default: 20 — more = more thorough, takes longer)"
2. "Do you want the agent to pause for your review at any point, or run fully unattended?"
3. "Any resource limits? (time per experiment, memory, API rate limits, cost caps)"

**If the user wants a long unattended run:**
- Set `pause_every: never` only after a finite time and iteration budget is approved.
- Route execution through `/start-work`; this port starts no daemon or background shell process.
- Monitor from bounded ledger and local artifact receipts.

**If the user wants periodic reviews:**
- Ask: "Every how many iterations?" → set `pause_every: N`

**Record:** `max_iterations`, `pause_every`, `time_budget_per_experiment` (default: 5 minutes), any resource constraints

---

## Step 5 — Evaluator Design

**Can measurement be automated? This determines loop speed and quality.**

Ask: "Can the success metric be measured by running a script? For example, `python evaluate.py` that outputs a number."

### If YES — draft an evaluator proposal:

Guide the user to produce a script that prints:
```json
{"pass": true, "score": 0.94}
```

Ask clarifying questions:
- "Where is the test data / benchmark?"
- "What command runs the current implementation?"
- "What command extracts the metric from the output?"

Offer an inert `evaluate.py` starter draft based on their answers. Use the appropriate example below as
proposal text only. The approval packet must name the intended path, interpreter, inputs, expected JSON,
timeout, and root; explicit `/start-work` owns any later file write or execution.

**Template — timing/benchmark (minimize):**
```python
#!/usr/bin/env python3
import json, subprocess, statistics, time
times = []
for _ in range(3):
    t0 = time.perf_counter()
    subprocess.run(["python", "TARGET_SCRIPT.py"], check=True)
    times.append(time.perf_counter() - t0)
median = statistics.median(times)
print(json.dumps({"pass": median < TARGET_VALUE, "score": median}))
```

**Template — accuracy/quality (maximize):**
```python
#!/usr/bin/env python3
import json, subprocess
result = subprocess.run(["python", "test_suite.py"], capture_output=True, text=True)
score = float(result.stdout.strip().split("score:")[-1].strip())
print(json.dumps({"pass": score > TARGET_VALUE, "score": score}))
```

**Keep policy:** Ask: "Keep only if strictly better than best so far (`score_improvement`), or keep anything that passes the threshold (`pass_only`)?"

### If NO — record manual evaluation:

Note in research.md: `Evaluator: _(none — agent judges manually)_`

Explain: "The agent will evaluate each experiment using its own judgment. This is slower and less reliable than a script — consider adding a script later."

**Record:** `evaluator_command` (or `none`), `keep_policy`

---

## Step 6 — Baseline Verification Proposal

**Specify the baseline dry-run gate without executing it in `lit-plan`.** A measured baseline is mandatory
before the research loop starts, but explicit `/start-work` performs the approved evaluator run and records
stdout, stderr, exit status, and the parsed score.

If an evaluator was designed in Step 5, include this inert command in the approval packet:

```bash
# Proposed evaluator dry run for explicit /start-work
python evaluate.py
```

**Expected output:** a JSON line like `{"pass": true, "score": 0.73}`

**Execution acceptance for `/start-work`:**
- On exit 0 and schema-valid output, record the score as iteration 0 and continue to the approved setup writes.
- If the user supplied a prior measured baseline, label its provenance and require `/start-work` to confirm it.

**Failure acceptance for `/start-work`:**
- On non-zero exit, timeout, invalid JSON, or crash, stop before setup writes and return a blocked receipt.
- Any evaluator correction requires a revised proposal and approval; do not improvise it inside planning.

If no evaluator (manual evaluation), ask the user for the current value and record it as a user-supplied,
weaker-evidence baseline in the proposal.

**Record:** `baseline_score` (iteration 0 value)

---

## Step 7 — Proposal and Approval Packet

**Render the fully populated proposed `research.md` and request approval. Do not write it.**

If `scripts/init_research.py` is available, describe it as an incomplete scaffold and include this
proposed `/start-work` action:

```bash
python scripts/init_research.py \
  --goal "GOAL_STATEMENT" \
  --metric "METRIC_NAME" \
  --direction "DIRECTION" \
  --target "TARGET_VALUE" \
  --evaluator "EVALUATOR_COMMAND" \
  --output ./research-dir/
```

If the script is not available, include this intended `research.md` content in the proposal packet:

```markdown
# Research: GOAL_TITLE

## Goal
GOAL_STATEMENT

## Success Metric
- **Metric:** METRIC_NAME
- **Target:** TARGET_VALUE
- **Direction:** DIRECTION

## Constraints
- **Max iterations:** MAX_ITERATIONS
- **Time budget per experiment:** 5 minutes
- **Pause for review every:** PAUSE_EVERY
- **Evaluator:** EVALUATOR_COMMAND
- **Keep policy:** KEEP_POLICY
- **Guard:** GUARD (if any)
- **Noise runs:** NOISE_RUNS
- **Min delta:** 0

## Current Approach
BASELINE_DESCRIPTION

## Search Space
- **Allowed changes:** ALLOWED_CHANGES
- **Forbidden changes:** FORBIDDEN_CHANGES

## Context & References
REFERENCES (if any)

---

## History
| # | Change | Metric | Result | Timestamp |
|---|--------|--------|--------|-----------|
| 0 | Baseline | BASELINE_SCORE | -- | TODAY |
```

**Proposal packet:**

1. Name the canonical intended paths for `research.md`, optional `evaluate.py`, and result artifacts.
2. Include the evaluator dry-run, expected output, timeout, write set, forbidden paths, finite budget,
   rollback behavior, stale-state rule, and cancellation rule.
3. If the helper is selected, identify every remaining placeholder and require `/start-work` to fill
   and validate it before the baseline gate. Helper exit zero proves only scaffold creation.
4. Ask the user to approve or revise this approval packet. Only after approval, print the execution handoff:

```
Approve this proposal, then invoke explicit `/start-work` to run the evaluator gate, write the
approved files, and begin the bounded loop. Inspect receipts with `scripts/check_progress.sh`
only when that read path is part of the approved authority packet.
```

5. Chain suggestion: "After `/start-work` completes the loop, run `/autoresearch-ship` for readiness review and a human-only irreversible-action handoff."

---

## Output Checklist

Before declaring the planning wizard complete, verify:

- [ ] Proposed `research.md` has all sections populated (no `TBD` or `TODO` placeholders)
- [ ] Baseline source is identified; mechanical confirmation remains an explicit `/start-work` gate
- [ ] Evaluator draft and dry-run acceptance contract are included when automation was chosen
- [ ] Proposal packet and approval packet name exact writes, commands, roots, budget, rollback, and stops
- [ ] No file write or evaluator execution occurred in `lit-plan`
