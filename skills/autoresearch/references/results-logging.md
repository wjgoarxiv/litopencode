# Results Logging Protocol

## OpenCode authority envelope

This reference is inert guidance. `lit-plan` must approve the result schema, finite budget, canonical
roots, output write set, rollback policy, and review gate before any mutation, including an
interactive run. Only explicit `/start-work` may perform bounded log writes, evaluation, or reversion
within that packet; without it this protocol grants no write authority.

Structured TSV logging for machine-readable experiment tracking.

## File: `autoresearch-results.tsv`

Every research project produces an `autoresearch-results.tsv` file alongside `research.md` and `research_log.md`. This file is append-only and machine-parseable.

## Format

Tab-separated values with these columns:

| Column | Type | Description |
|--------|------|-------------|
| `iteration` | int | 0-indexed iteration number |
| `metric_value` | float | Measured metric value |
| `delta` | float or `-` | Change from baseline (iteration 0) |
| `delta_pct` | string | Percentage change from baseline |
| `status` | enum | `baseline`, `kept`, `reverted`, `guard_violation`, `reference` |
| `description` | string | One-line description of the change |
| `evaluator_source` | string | `mechanical`, `agent`, or `manual` |
| `timestamp` | ISO 8601 UTC | Real UTC instant in `YYYY-MM-DDTHH:MM:SS[.sss]Z` form |

## Example

```tsv
iteration	metric_value	delta	delta_pct	status	description	evaluator_source	timestamp
0	2.3991	-	-	baseline	Recursive quicksort with list comprehensions	agent	2026-03-15T10:00:00Z
1	1.8845	-0.5146	-21.4%	kept	Bottom-up iterative merge sort	agent	2026-03-15T10:05:00Z
2	1.7265	-0.6726	-28.0%	kept	Merge sort + insertion sort for subarrays < 32	agent	2026-03-15T10:10:00Z
3	1.6939	-0.7052	-29.4%	kept	Merge sort + binary insertion sort chunk size 64	agent	2026-03-15T10:15:00Z
4	1.9504	-0.4487	-18.7%	reverted	Natural merge sort with run detection	agent	2026-03-15T10:20:00Z
5	0.9817	-1.4174	-59.1%	kept	LSD radix sort base 256	agent	2026-03-15T10:25:00Z
6	0.7513	-1.6478	-68.7%	kept	LSD radix sort base 65536	agent	2026-03-15T10:30:00Z
7	0.1780	-2.2211	-92.6%	reference	Python built-in sorted()	agent	2026-03-15T10:35:00Z
```

Every row must have exactly eight tab-separated fields. Terminal completion requires exactly one genuine
iteration-0 `baseline` row with a finite `metric_value`, `-` delta, and `-` percentage. Every later
iteration is a non-baseline experiment. `iteration` is a unique non-negative integer within the
configured maximum; `metric_value` and any non-`-` `delta` are finite numbers;
`delta_pct` is `-` or a numeric percentage; status and evaluator source use only the enums above;
description is non-empty; and timestamp is a real UTC instant. The initializer's row-0 `TBD` baseline is
only a scaffold placeholder: replace it with measured finite evidence before terminal completion. A
missing or placeholder baseline, baseline status after iteration 0, duplicate iteration, extra/missing
column, invalid enum, non-finite metric, or invalid timestamp makes completion evidence `terminal
invalid` rather than `COMPLETE`.

## Usage

The TSV file enables:
- **Programmatic analysis:** Load into pandas, plot convergence curves, compute statistics
- **CI integration:** Parse the last row to check if the target was met
- **Cross-project comparison:** Standardized format across all autoresearch-skill runs
- **Git-friendly:** TSV diffs clearly show which iterations were added

## Terminal Event

`autoresearch_events.jsonl` is the append-only lifecycle event stream. Initialization creates it
empty. The root `/start-work` loop appends `autoresearch.completed` only after it has accepted a
genuine terminal reason, a finite iteration-0 baseline, and a non-empty final report. The receipt
names the report rather than relying on file presence alone:

```json
{"event":"autoresearch.completed","timestamp":"2026-03-15T10:40:00Z","terminal_reason":"TARGET_MET","final_report_path":"final_report.md","results_path":"autoresearch-results.tsv","total_iterations":7}
```

Allowed terminal reasons are `TARGET_MET`, `BUDGET_EXHAUSTED`, `CANCELLED`, and `BLOCKED`. A terminal
event with a missing or empty `final_report.md`, or without a genuine finite baseline replacing the
scaffold's `TBD` row, is never `COMPLETE`. The packaged status helper uses the
guaranteed Node runtime to parse JSONL. The latest valid-JSON `autoresearch.completed` object must have
a real UTC timestamp, one allowed `terminal_reason`, the two exact relative artifact paths shown above,
and a non-negative integer `total_iterations` equal to the number of fully schema-valid non-baseline
experiment rows. The required iteration-0 baseline is evidence but is not included in that count.
Malformed JSON is
ignored as an incomplete write; valid JSON that names the terminal event but misses or violates any
field is `terminal invalid` with exit code 4. If Node cannot be resolved, status returns
`BLOCKED_NODE_UNAVAILABLE` with exit code 3 rather than silently changing parsers. A resolved Node
command that cannot execute the parser returns `BLOCKED_NODE_RUNTIME_ERROR`, also with exit code 3.

## Relationship to Other Output Files

| File | Purpose | Format | Audience |
|------|---------|--------|----------|
| `research.md` | Living research document with History table | Markdown | Humans |
| `research_log.md` | Detailed per-iteration analysis | Markdown | Humans |
| `autoresearch-results.tsv` | Machine-readable results | TSV | Scripts/CI |
| `autoresearch_events.jsonl` | Append-only lifecycle and terminal receipts | JSONL | Scripts/CI |
| `final_report.md` | Executive summary | Markdown | Humans |
