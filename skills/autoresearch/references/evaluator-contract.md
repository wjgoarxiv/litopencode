# Evaluator Contract

## OpenCode authority envelope

This reference is inert guidance. `lit-plan` must approve the evaluator command, finite budget,
canonical read roots, output schema, timeout, write set, and review gate before any mutation,
including an interactive run. Only explicit `/start-work` may perform bounded evaluation or related
writes within that packet; without it this contract remains read-only.

The mechanical evaluator is an optional but recommended component for Tier 1 environments. It removes human judgment from the keep/revert decision (Principle 2: Mechanical Verification).

## Setup

In `research.md` Constraints section, add:

```
- **Evaluator:** `python evaluate.py`
- **Keep policy:** score_improvement
```

## JSON Contract

The evaluator command must print a single JSON object to stdout:

```json
{"pass": true, "score": 0.94}
```

`score` is always interpreted as **higher is better**. For metrics you minimize, emit the negated metric value as `score` (for example, RMSE `0.031` becomes `"score": -0.031`). This keeps `score_improvement` unambiguous across maximize and minimize tasks.

Evaluators may include extra fields for readability; old evaluators with only `pass` and `score` remain valid:

```json
{"pass": false, "score": -0.42, "metric_value": 0.42}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pass` | boolean | yes | Did the experiment meet the minimum bar? |
| `score` | number | no (but recommended) | Comparison score; higher is always better |
| `metric_value` | number | no | Optional raw metric value for humans/plots; may be lower-is-better |

**Evaluator source field in TSV:** When a mechanical evaluator runs, the `evaluator_source` column in `autoresearch-results.tsv` records `mechanical`; put the bounded command and receipt in `research_log.md`. Without an evaluator, record `agent` or `manual` according to who accepted the measurement.

## Execution Rules

1. Probe the approved host for Python 3. The packaged Python standard-library wrapper is portable on
   Darwin, Linux, and Windows and does not assume the GNU `timeout` utility:
   `python3 scripts/run_with_deadline.py 300 -- python evaluate.py`. Pass the evaluator as separate
   arguments after `--`; do not join untrusted text into a shell command. On POSIX it starts an isolated
   process group and, at deadline, snapshots known descendants, signals that group plus the known PIDs,
   and reaps the direct child. On Windows it starts a new process group and attempts the system
   `taskkill /T /F` tree operation. These are best-effort cleanup operations, not containment: a child may
   detach with `setsid`, re-parent, race the snapshot, or otherwise escape discovery. The portable backend
   therefore returns exit code 125 and
   `BLOCKED_PROCESS_TREE_CLEANUP_UNVERIFIED` after every timeout. Stop the workflow, manually inspect and
   stop residual processes, record the cleanup receipt, and require fresh approval before continuing.
   Exit code 124 is reserved for a future host backend that can actually prove complete process-tree
   containment and cleanup; a process-group or `taskkill` success alone never earns 124.
2. Parse stdout as JSON — find the first line that is valid JSON
3. Apply the keep policy
4. Log the evaluator output in `research_log.md`

## Error Handling

| Error | Action |
|-------|--------|
| Non-zero exit code | Treat as failed experiment — revert and continue |
| Invalid / no JSON in stdout | Treat as failed experiment — revert and continue |
| Deadline exceeded with host-proven containment (exit code 124) | Treat as failed experiment — revert and continue; the portable backend does not currently emit this |
| `BLOCKED_PROCESS_TREE_CLEANUP_UNVERIFIED` (exit code 125) | Stop, manually inspect and stop residual processes, and record cleanup; do not continue while descendants may remain |
| `pass: false` with `pass_only` policy | Revert and continue |
| `score` lower than previous best with `score_improvement` policy | Revert and continue |

## Keep Policies

**`score_improvement` (default):** Keep the experiment only if `score` strictly exceeds the previous best score. If `score` is absent from the JSON, fall back to `pass` field only. For minimize tasks, this requires `score = -metric_value` so a smaller metric produces a larger score.

**`pass_only`:** Keep any experiment where `pass` is `true`, regardless of score. Use when the metric is categorical (pass/fail) rather than continuous.

## Tier Fallback

- **Tier 1:** Evaluator runs mechanically as specified
- **Tier 2/3:** No shell access — fall back to agent's own judgment (manual evaluation). Log `evaluator_source: agent` in TSV.

## Example Evaluators

### Accuracy evaluator
```python
#!/usr/bin/env python3
import json, subprocess
result = subprocess.run(["python", "test_classifier.py"], capture_output=True, text=True)
accuracy = float(result.stdout.strip().split("accuracy:")[-1].strip())
print(json.dumps({"pass": accuracy > 0.9, "score": accuracy}))
```

### Benchmark evaluator (timing, minimize)
```python
#!/usr/bin/env python3
import json, subprocess, statistics, time
times = []
for _ in range(3):
    t0 = time.perf_counter()
    subprocess.run(["python", "sort.py"], check=True)
    times.append(time.perf_counter() - t0)
median = statistics.median(times)
print(json.dumps({"pass": median < 0.5, "score": -median, "metric_value": median}))
```

### RMSE evaluator (regression, minimize)
```python
#!/usr/bin/env python3
import json, math, csv
from predict import predict
with open("test_data.csv") as f:
    rows = list(csv.DictReader(f))
rmse = math.sqrt(sum((float(r["y"]) - predict(float(r["x"])))**2 for r in rows) / len(rows))
print(json.dumps({"pass": rmse < 0.05, "score": -rmse, "metric_value": rmse}))
```

## Notes

- The evaluator runs in the **research project directory**, not the skill directory
- Keep evaluators fast (<30s ideally, with the approved hard deadline set to 300 seconds by default)
- Evaluators must be deterministic — avoid random seeds unless averaged over multiple runs
- The evaluator is a read-only measurement and receives no file-write authority
