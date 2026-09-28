# Results Logging Protocol

## OpenCode authority envelope

This reference is inert schema guidance. `lit-plan` must approve the finite root-owned result paths,
budget, roots, packet schema, and review contract before any mutation or delegation, including
interactive runs. Only explicit `/start-work` may consume that approval. Children remain depth-one
and packet-only; children must not write or mutate root-owned state, select models, or invoke routes.

Structured logging for machine-readable experiment tracking at two levels: per-researcher (matching autoresearch format) and conference-level (adding researcher identity, round context, and peer review verdicts).

---

## Section 1 — Per-Researcher TSV (`researcher_{ID}_results.tsv`)

One file per researcher (e.g., `researcher_A_results.tsv`, `researcher_B_results.tsv`). Same schema as autoresearch's `autoresearch-results.tsv` for compatibility.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `iteration` | int | 0-indexed iteration number within the current round |
| `metric_value` | float | Measured metric value (or self-assessment score 1-10 in qualitative mode) |
| `delta` | float or `-` | Change from baseline (iteration 0 of this researcher) |
| `delta_pct` | string | Percentage change from baseline |
| `status` | enum | `baseline`, `kept`, `reverted` |
| `description` | string | One-line description of the change |
| `evaluator_source` | string | Source of the evaluation — e.g., `script:evaluate.py`, `review-packet:independent`, `self-assessment` |
| `timestamp` | ISO 8601 UTC | Real UTC instant in `YYYY-MM-DDTHH:MM:SS[.sss]Z` form |

### Example

```tsv
iteration	metric_value	delta	delta_pct	status	description	evaluator_source	timestamp
0	2.3991	-	-	baseline	Recursive quicksort with list comprehensions	script:benchmark.py	2026-03-18T10:00:00Z
1	1.8845	-0.5146	-21.4%	kept	Bottom-up iterative merge sort	script:benchmark.py	2026-03-18T10:05:00Z
2	1.7265	-0.6726	-28.0%	kept	Merge sort + insertion sort for subarrays < 32	script:benchmark.py	2026-03-18T10:10:00Z
3	1.9504	-0.4487	-18.7%	reverted	Natural merge sort with run detection	script:benchmark.py	2026-03-18T10:15:00Z
4	0.9817	-1.4174	-59.1%	kept	LSD radix sort base 256	script:benchmark.py	2026-03-18T10:20:00Z
```

### Notes

- **Qualitative mode:** `metric_value` holds the researcher's self-assessed quality score (1-10). The Reviewer's authoritative scores appear in the conference-level TSV.
- **Iteration numbering:** Resets to 0 at the start of each round for simplicity. The round context is captured in the conference-level TSV.
- **Baseline row:** The first row of each round uses `status: baseline` and `delta: -`.

---

## Section 2 — Conference-Level TSV (`conference_results.tsv`)

One file for the entire conference. Adds researcher identity, round context, and peer review verdicts on top of the per-researcher schema.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `round` | int | Conference round number (1-indexed) |
| `researcher` | string | Researcher identifier (`A`, `B`, `C`, ...) |
| `iteration` | int | Iteration within the round (0-indexed) |
| `metric_value` | float | Measured metric value |
| `delta` | float or `-` | Change from round baseline |
| `delta_pct` | string | Percentage change from round baseline |
| `status` | enum | `baseline`, `kept`, `reverted`, `failed` |
| `description` | string | One-line description of the change |
| `evaluator_source` | string | Source of the evaluation — e.g., `script:evaluate.py`, `review-packet:independent`, `self-assessment` |
| `peer_review_verdict` | enum | `validated`, `challenged`, `overturned`, `-` |
| `timestamp` | ISO 8601 | When the experiment completed |

### Example

```tsv
round	researcher	iteration	metric_value	delta	delta_pct	status	description	evaluator_source	peer_review_verdict	timestamp
1	A	0	2.3991	-	-	baseline	Recursive quicksort baseline	script:benchmark.py	-	2026-03-18T10:00:00Z
1	A	1	1.8845	-0.5146	-21.4%	kept	Bottom-up iterative merge sort	script:benchmark.py	validated	2026-03-18T10:05:00Z
1	A	2	1.7265	-0.6726	-28.0%	kept	Merge sort + insertion sort < 32	script:benchmark.py	validated	2026-03-18T10:10:00Z
1	B	0	2.4012	-	-	baseline	Recursive quicksort baseline	script:benchmark.py	-	2026-03-18T10:00:00Z
1	B	1	2.1500	-0.2512	-10.5%	kept	Heap sort implementation	script:benchmark.py	challenged	2026-03-18T10:07:00Z
1	B	2	1.9800	-0.4212	-17.5%	kept	Heap sort with Floyd's algorithm	script:benchmark.py	validated	2026-03-18T10:12:00Z
1	C	0	2.3950	-	-	baseline	Recursive quicksort baseline	script:benchmark.py	-	2026-03-18T10:00:00Z
1	C	1	0.9817	-1.4133	-59.1%	kept	LSD radix sort base 256	script:benchmark.py	validated	2026-03-18T10:08:00Z
2	A	0	1.7265	-	-	baseline	Round 2 start from best known	script:benchmark.py	-	2026-03-18T10:30:00Z
2	A	1	1.5100	-0.2165	-12.5%	kept	Merge sort + radix hybrid	script:benchmark.py	validated	2026-03-18T10:35:00Z
```

### Status Values

| Value | Meaning |
|-------|---------|
| `baseline` | Starting point for this researcher in this round |
| `kept` | Change improved the metric and was kept |
| `reverted` | Change did not improve metric; reverted to previous best |
| `failed` | Researcher crashed, timed out, or self-terminated before completing the iteration |

### Peer Review Verdict Values

| Value | Meaning |
|-------|---------|
| `validated` | Reviewer confirmed the claim holds |
| `challenged` | Reviewer flagged the claim as questionable; needs more evidence |
| `overturned` | Reviewer determined the claim is invalid |
| `-` | Not yet reviewed (e.g., baseline row, or round not yet complete) |

Every conference-level row must have exactly the eleven documented fields. For every completed round,
each configured researcher must have exactly one genuine iteration-0 `baseline` row with finite metric,
`-` delta/percentage, and `-` peer verdict; later rows are non-baseline experiments. `round` is an integer
from 1 through configured max rounds; `researcher` is one of the configured `A` through `Z` identifiers;
`iteration` is unique within that round/researcher tuple. Percentage, status, peer verdict, non-empty
description/source, and real UTC timestamp must match this schema. Missing or placeholder baselines,
extra/missing fields, unknown researchers, out-of-range rounds, duplicate evidence identities, invalid
enums, or non-finite metrics invalidate completion evidence.

---

## Section 3 — Event Log (`conference_events.jsonl`)

An append-only JSONL file recording all significant conference events. Each line is a JSON object. External tools can tail this file for real-time monitoring.

### Schema

```json
{
  "event": "<event_type>",
  "timestamp": "<ISO 8601>",
  "payload": { ... }
}
```

### Event Types

| Event | When | Payload Fields |
|-------|------|----------------|
| `conference.started` | Conference Chair initializes | `researchers`, `mode`, `goal`, `config_summary` |
| `round.started` | Each round begins | `round`, `researcher_states` |
| `researcher.iteration` | Researcher completes an iteration | `researcher`, `round`, `iteration`, `metric_value`, `delta`, `status` |
| `round.poster_session` | Poster session complete | `round`, `summary` |
| `round.peer_review` | Peer review complete | `round`, `validated_count`, `challenged_count`, `overturned_count` |
| `round.completed` | Round finishes | `round`, `best_metric`, `best_researcher`, `converged` |
| `researcher.stuck` | Researcher hits stuck Level 2+ | `researcher`, `round`, `stuck_level` |
| `conference.converged` | Convergence detected | `final_best_metric`, `round_count`, `reason` |
| `conference.completed` | Synthesis done | top-level `terminal_verdict`; payload `synthesis_path`, `final_report_path`, `total_iterations`, `total_rounds`, `researcher_count` |

### Example

```jsonl
{"event":"conference.started","timestamp":"2026-03-18T10:00:00Z","payload":{"researchers":3,"mode":"metric","goal":"Optimize inference latency","config_summary":"metric=p95_latency_ms, direction=minimize, target=<50ms"}}
{"event":"round.started","timestamp":"2026-03-18T10:00:05Z","payload":{"round":1,"researcher_states":["A:ready","B:ready","C:ready"]}}
{"event":"researcher.iteration","timestamp":"2026-03-18T10:05:00Z","payload":{"researcher":"A","round":1,"iteration":1,"metric_value":1.8845,"delta":-0.5146,"status":"kept"}}
{"event":"round.poster_session","timestamp":"2026-03-18T10:20:00Z","payload":{"round":1,"summary":"A: merge sort -28%, B: heap sort -17.5%, C: radix sort -59.1%"}}
{"event":"round.peer_review","timestamp":"2026-03-18T10:25:00Z","payload":{"round":1,"validated_count":5,"challenged_count":1,"overturned_count":0}}
{"event":"round.completed","timestamp":"2026-03-18T10:26:00Z","payload":{"round":1,"best_metric":0.9817,"best_researcher":"C","converged":false}}
{"event":"conference.completed","timestamp":"2026-03-18T11:45:00Z","terminal_verdict":"TARGET_MET","payload":{"synthesis_path":"synthesis.md","final_report_path":"final_report.md","total_iterations":45,"total_rounds":3,"researcher_count":3}}
```

Every valid `round.completed` payload contains an in-range integer `round`, finite numeric `best_metric`,
a configured `best_researcher`, and boolean `converged`. Its best researcher and metric must match the
direction-aware best non-failed conference TSV row for that round. Duplicate, incomplete, invalid, or
unreconciled round receipts invalidate completion even if a later receipt is valid. At terminal state,
TSV rounds and sequential completed-round receipts must name the same round set.

The terminal verdict is one of `TARGET_MET`, `CONVERGED`, `BUDGET_EXHAUSTED`, `STALLED`, `CANCELLED`,
or `BLOCKED`. The packaged status helper parses JSONL with the guaranteed Node runtime and validates
the latest valid-JSON `conference.completed` object. Its UTC timestamp must be real; artifact paths
must be exactly `synthesis.md` and `final_report.md`; and all three non-negative integer counts must
reconcile with fully schema-valid results TSV rows, reconciled `round.completed` events, configured max
rounds, and configured researcher count. `payload.total_iterations` counts only non-baseline experiment
rows across all researchers and rounds; required iteration-0 baseline rows are excluded.
Malformed JSON is ignored as an incomplete append. Valid JSON that names the terminal event but has a
missing or invalid verdict, payload, path, timestamp, or count is `terminal invalid` with exit code 4.
An unavailable Node command yields `BLOCKED_NODE_UNAVAILABLE` with exit code 3; a parser invocation
failure yields `BLOCKED_NODE_RUNTIME_ERROR` with the same exit code. Neither condition silently falls
back to another runtime.

---

## Usage

The TSV files and event log enable:

- **Programmatic analysis:** Load `conference_results.tsv` into pandas; plot per-researcher convergence curves; compute cross-researcher strategy comparison.
- **CI integration:** Parse the last row of `conference_results.tsv` to check if the target was met. Same pattern as autoresearch-skill.
- **Cross-project comparison:** Standardized format across all autoconference runs.
- **Bounded monitoring:** After an approved finite conference step, read at most the last 200 records from `conference_events.jsonl`, capture the snapshot, and stop.
- **Peer review accuracy analysis:** Compare `peer_review_verdict` against final synthesis outcomes to measure reviewer quality over time.

## Relationship to Other Output Files

| File | Purpose | Format | Audience |
|------|---------|--------|----------|
| `conference.md` | User configuration + Conference Log | Markdown | Humans |
| `researcher_{ID}_log.md` | Detailed per-iteration reasoning | Markdown | Humans |
| `researcher_{ID}_results.tsv` | Per-researcher machine-readable results | TSV | Scripts/CI |
| `conference_results.tsv` | Conference-level results with verdicts | TSV | Scripts/CI |
| `conference_events.jsonl` | Event stream for real-time monitoring | JSONL | Scripts/monitoring |
| `poster_session_round_N.md` | Session Chair's round summary | Markdown | Humans |
| `peer_review_round_N.md` | Reviewer's verdicts per round | Markdown | Humans |
| `synthesis.md` | Synthesizer's unified result | Markdown | Humans |
| `final_report.md` | Executive summary | Markdown | Humans |
