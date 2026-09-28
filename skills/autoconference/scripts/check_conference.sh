#!/usr/bin/env bash
# check_conference.sh - Lightweight progress monitor for autoconference runs
# Usage: check_conference.sh [conference_dir]

CONF_DIR="${1:-.}"
CONF_DIR="${CONF_DIR%/}"  # strip trailing slash

CONF_MD="$CONF_DIR/conference.md"
RESULTS_TSV="$CONF_DIR/conference_results.tsv"
EVENTS_JSONL="$CONF_DIR/conference_events.jsonl"
SYNTHESIS_MD="$CONF_DIR/synthesis.md"
FINAL_REPORT_MD="$CONF_DIR/final_report.md"

if [[ ! -d "$CONF_DIR" || ! -f "$CONF_MD" ]]; then
    printf 'Status:     not initialized\n'
    exit 2
fi

NODE_BINARY="${NODE_BINARY:-node}"
if ! command -v "$NODE_BINARY" >/dev/null 2>&1; then
    printf 'Status:     BLOCKED_NODE_UNAVAILABLE\n'
    exit 3
fi

# ── Parse conference.md ───────────────────────────────────────────────────────

if [[ -f "$CONF_MD" ]]; then
    # First non-empty line after "## Goal"
    goal=$(awk '/^## Goal/{found=1; next} found && /[^[:space:]]/{print; exit}' \
           "$CONF_MD")
    # max_rounds: line matching "max_rounds", "Rounds:", or scaffolded "Max rounds:"
    max_rounds=$(grep -m1 -iE 'max_rounds|Rounds:' "$CONF_MD" \
                  | grep -oE '[0-9]+' \
                  | head -1)
    # Researcher count: prefer scaffolded "Count", fall back to named researcher entries
    researcher_count=$(grep -m1 -iE '\*\*Count:\*\*|^count:' "$CONF_MD" \
                       | grep -oE '[0-9]+' \
                       | head -1)
    if [[ -z "$researcher_count" ]]; then
        researcher_count=$(grep -cE '^\s*-\s+\*\*Name\*\*:|^\s*-\s+name:' "$CONF_MD" 2>/dev/null) || researcher_count=0
    fi
    # Direction
    direction=$(grep -m1 -i '\*\*Direction:\*\*' "$CONF_MD" \
                | sed 's/.*\*\*Direction:\*\*[[:space:]]*//' \
                | sed 's/[[:space:]]*$//' \
                | tr '[:upper:]' '[:lower:]')
    # Target
    target=$(grep -m1 -i '\*\*Target:\*\*' "$CONF_MD" \
              | sed 's/.*\*\*Target:\*\*[[:space:]]*//' \
              | sed 's/[[:space:]]*$//')
else
    goal="?"; max_rounds="?"; researcher_count="?"; direction="maximize"; target="?"
fi

[[ -z "$goal"              ]] && goal="?"
[[ -z "$max_rounds"        ]] && max_rounds="?"
[[ -z "$researcher_count"  ]] && researcher_count="?"
[[ -z "$direction"          ]] && direction="maximize"
[[ -z "$target"            ]] && target="?"

# ── Parse conference_results.tsv ──────────────────────────────────────────────

best_metric="?"; best_researcher="?"; result_count="0"

if [[ -f "$RESULTS_TSV" ]]; then
    # Expect conference-level columns:
    # round, researcher, iteration, metric_value, delta, delta_pct, status, description,
    # evaluator_source, peer_review_verdict, timestamp
    # Track best metric value and which researcher achieved it
    best_val=""
    while IFS=$'\t' read -r f_round f_researcher f_iteration f_metric f_rest; do
        [[ -z "$f_researcher" ]] && continue
        result_count=$(( result_count + 1 ))
        val="$f_metric"
        if [[ "$val" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then
            if [[ -z "$best_val" ]]; then
                best_val="$val"
                best_researcher="$f_researcher"
            else
                if [[ "$direction" == "minimize" ]]; then
                    better=$(awk -v a="$val" -v b="$best_val" 'BEGIN{print (a<b)?1:0}')
                else
                    better=$(awk -v a="$val" -v b="$best_val" 'BEGIN{print (a>b)?1:0}')
                fi
                if [[ "$better" == "1" ]]; then
                    best_val="$val"
                    best_researcher="$f_researcher"
                fi
            fi
        fi
    done < <(tail -n +2 "$RESULTS_TSV" | grep -v '^[[:space:]]*$')

    if [[ -n "$best_val" ]]; then
        best_metric="$best_val"
    fi
    [[ -z "$best_researcher" ]] && best_researcher="?"
fi

# ── Parse conference_events.jsonl ─────────────────────────────────────────────

current_round="0"; last_event_type="?"; last_event_ts="?"; stuck_count="0"; terminal_event_state="none"

if [[ -f "$EVENTS_JSONL" ]]; then
    # Count current and legacy round completion event names.
    completed_rounds=$(grep -Ec '"round\.completed"|"round\.[0-9]+\.completed"' "$EVENTS_JSONL" 2>/dev/null) || completed_rounds=0
    current_round="$completed_rounds"

    # Count "researcher.stuck" events
    stuck_count=$(grep -c '"researcher\.stuck"' "$EVENTS_JSONL" 2>/dev/null) || stuck_count=0
    if ! terminal_event_state=$("$NODE_BINARY" - "$EVENTS_JSONL" "$RESULTS_TSV" "$researcher_count" "$max_rounds" "$direction" <<'NODE'
const fs = require("node:fs");

const [eventsPath, resultsPath, researcherCountRaw, maxRoundsRaw, direction] = process.argv.slice(2);
const researcherCount = Number(researcherCountRaw);
const maxRounds = Number(maxRoundsRaw);
const allowedVerdicts = new Set([
  "TARGET_MET", "CONVERGED", "BUDGET_EXHAUSTED", "STALLED", "CANCELLED", "BLOCKED"
]);
const allowedStatuses = new Set(["baseline", "kept", "reverted", "failed"]);
const allowedPeerVerdicts = new Set(["validated", "challenged", "overturned", "-"]);
const expectedHeader = ["round", "researcher", "iteration", "metric_value", "delta", "delta_pct", "status", "description", "evaluator_source", "peer_review_verdict", "timestamp"];

function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const normalized = value.includes(".") ? value : value.replace(/Z$/u, ".000Z");
  return parsed.toISOString() === normalized;
}

function finiteNumber(value) {
  return typeof value === "string"
    && /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)
    && Number.isFinite(Number(value));
}

function parseResults() {
  if (!Number.isInteger(researcherCount) || researcherCount < 1 || researcherCount > 26
    || !Number.isInteger(maxRounds) || maxRounds < 1 || !new Set(["maximize", "minimize"]).has(direction)
    || !fs.existsSync(resultsPath)) return { valid: false, rows: [] };
  const configuredResearchers = new Set(Array.from({ length: researcherCount }, (_, index) => String.fromCharCode(65 + index)));
  const lines = fs.readFileSync(resultsPath, "utf8").split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines[0] !== expectedHeader.join("\t")) return { valid: false, rows: [] };
  const keys = new Set();
  const rows = [];
  let experimentCount = 0;
  for (const line of lines.slice(1)) {
    if (line === "") return { valid: false, rows };
    const fields = line.split("\t");
    if (fields.length !== expectedHeader.length) return { valid: false, rows };
    const [roundRaw, researcher, iterationRaw, metricRaw, delta, deltaPct, status, description, evaluator, peerVerdict, timestamp] = fields;
    if (!/^\d+$/u.test(roundRaw) || !/^\d+$/u.test(iterationRaw) || !configuredResearchers.has(researcher)
      || !finiteNumber(metricRaw) || !(delta === "-" || finiteNumber(delta))
      || !(deltaPct === "-" || /^-?(?:\d+(?:\.\d+)?|\.\d+)%$/u.test(deltaPct))
      || !allowedStatuses.has(status) || description.trim() === "" || evaluator.trim() === ""
      || !allowedPeerVerdicts.has(peerVerdict) || !validTimestamp(timestamp)) return { valid: false, rows };
    const round = Number(roundRaw);
    const iteration = Number(iterationRaw);
    const key = `${round}:${researcher}:${iteration}`;
    if (!Number.isSafeInteger(round) || round < 1 || round > maxRounds || !Number.isSafeInteger(iteration)
      || keys.has(key)) return { valid: false, rows };
    if (iteration === 0) {
      if (status !== "baseline" || delta !== "-" || deltaPct !== "-" || peerVerdict !== "-") {
        return { valid: false, rows };
      }
    } else {
      if (status === "baseline") return { valid: false, rows };
      experimentCount += 1;
    }
    keys.add(key);
    rows.push({ round, researcher, iteration, metric: Number(metricRaw), status });
  }
  return { valid: true, rows, configuredResearchers, experimentCount };
}

const results = parseResults();
if (!results.valid) {
  process.stdout.write("invalid");
  process.exit(0);
}
const resultCount = results.experimentCount;

let latest;
const completedRounds = new Map();
let invalidRoundReceipt = false;
for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/u)) {
  if (line.trim() === "") continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }
  if (event !== null && typeof event === "object" && !Array.isArray(event)) {
    if (event.event === "round.completed") {
      const payload = event.payload;
      const validPayload = payload !== null && typeof payload === "object" && !Array.isArray(payload)
        && Number.isInteger(payload.round) && payload.round >= 1 && payload.round <= maxRounds
        && typeof payload.best_metric === "number" && Number.isFinite(payload.best_metric)
        && results.configuredResearchers.has(payload.best_researcher) && typeof payload.converged === "boolean";
      if (!validTimestamp(event.timestamp) || !validPayload || completedRounds.has(payload?.round)) {
        invalidRoundReceipt = true;
        continue;
      }
      const candidates = results.rows.filter((row) => row.round === payload.round && row.status !== "failed");
      const bestMetric = candidates.reduce((best, row) => direction === "minimize"
        ? Math.min(best, row.metric) : Math.max(best, row.metric), direction === "minimize" ? Infinity : -Infinity);
      const reconciled = candidates.length > 0 && payload.best_metric === bestMetric
        && candidates.some((row) => row.researcher === payload.best_researcher && row.metric === bestMetric);
      if (!reconciled) invalidRoundReceipt = true;
      else completedRounds.set(payload.round, payload);
    }
    if (event.event === "conference.completed") latest = event;
  }
}

if (latest === undefined) {
  process.stdout.write("none");
  process.exit(0);
}

const payload = latest.payload;
const roundCount = completedRounds.size;
const roundsAreSequential = Array.from({ length: roundCount }, (_, index) => index + 1)
  .every((round) => completedRounds.has(round));
const resultRounds = new Set(results.rows.map((row) => row.round));
const rowsReconciled = resultRounds.size === roundCount && [...resultRounds].every((round) => completedRounds.has(round));
const baselinesReconciled = [...completedRounds.keys()].every((round) =>
  [...results.configuredResearchers].every((researcher) =>
    results.rows.some((row) => row.round === round && row.researcher === researcher
      && row.iteration === 0 && row.status === "baseline")));
const validPayload = payload !== null
  && typeof payload === "object"
  && !Array.isArray(payload)
  && payload.synthesis_path === "synthesis.md"
  && payload.final_report_path === "final_report.md"
  && Number.isInteger(payload.total_iterations)
  && payload.total_iterations >= 0
  && payload.total_iterations === resultCount
  && Number.isInteger(payload.total_rounds)
  && payload.total_rounds >= 0
  && payload.total_rounds === roundCount
  && roundsAreSequential
  && Number.isInteger(payload.researcher_count)
  && payload.researcher_count >= 1
  && payload.researcher_count === researcherCount
  && rowsReconciled
  && baselinesReconciled;
const valid = validTimestamp(latest.timestamp)
  && allowedVerdicts.has(latest.terminal_verdict)
  && validPayload
  && !invalidRoundReceipt;
process.stdout.write(valid ? "valid" : "invalid");
NODE
    ); then
        printf 'Status:     BLOCKED_NODE_RUNTIME_ERROR\n'
        exit 3
    fi

    # Last event: extract type and timestamp from the last non-empty line
    last_line=$(grep -v '^[[:space:]]*$' "$EVENTS_JSONL" | tail -1)
    if [[ -n "$last_line" ]]; then
        # Extract event type — value of "event" or "type" key
        last_event_type=$(printf '%s' "$last_line" \
                          | grep -oE '"(event|type)"\s*:\s*"[^"]+"' \
                          | head -1 \
                          | grep -oE '"[^"]+"\s*$' \
                          | tr -d '"' \
                          | sed 's/^[[:space:]]*//')
        # Extract timestamp — value of "ts", "timestamp", or "time" key
        last_event_ts=$(printf '%s' "$last_line" \
                        | grep -oE '"(ts|timestamp|time)"\s*:\s*"[^"]+"' \
                        | head -1 \
                        | grep -oE '"[^"]+"\s*$' \
                        | tr -d '"' \
                        | sed 's/^[[:space:]]*//')
    fi
fi

[[ -z "$last_event_type" ]] && last_event_type="?"
[[ -z "$last_event_ts"   ]] && last_event_ts=""

# ── Determine run status ──────────────────────────────────────────────────────

if [[ -f "$CONF_MD" ]] && grep -q 'Scaffold status:[[:space:]]*INCOMPLETE' "$CONF_MD"; then
    run_status="incomplete scaffold"
elif [[ "$terminal_event_state" == "invalid" ]]; then
    run_status="terminal invalid"
elif [[ "$terminal_event_state" == "valid" ]] && [[ -s "$SYNTHESIS_MD" ]] && [[ -s "$FINAL_REPORT_MD" ]] && [[ "$result_count" -gt 0 ]]; then
    run_status="COMPLETE"
elif [[ "$terminal_event_state" == "valid" ]]; then
    run_status="terminal incomplete"
elif [[ "$current_round" -gt 0 || "$result_count" -gt 0 || "$last_event_type" != "?" ]]; then
    run_status="progress recorded"
else
    run_status="ready; no progress recorded"
fi

# ── Build display strings ─────────────────────────────────────────────────────

round_display="${current_round} / ${max_rounds}"

# Format last event with timestamp if available
if [[ -n "$last_event_ts" ]]; then
    last_event_display="${last_event_type} @ ${last_event_ts}"
else
    last_event_display="$last_event_type"
fi

# Add stuck researcher info if any
if [[ "$stuck_count" -gt 0 ]]; then
    researcher_display="${researcher_count} (${stuck_count} stuck)"
else
    researcher_display="$researcher_count"
fi

# Truncate long strings to keep box tidy (max ~44 chars for value column)
_trunc() {
    local s="$1" max="${2:-44}"
    if [[ ${#s} -gt $max ]]; then
        printf '%s' "${s:0:$((max-1))}…"
    else
        printf '%s' "$s"
    fi
}

val_w=44

conf_val=$(_trunc "${CONF_DIR}/" $val_w)
goal_val=$(_trunc "$goal" $val_w)
round_val=$(_trunc "$round_display" $val_w)
researcher_val=$(_trunc "$researcher_display" $val_w)
metric_val=$(_trunc "${best_metric} (${best_researcher})" $val_w)
target_val=$(_trunc "$target" $val_w)
status_val=$(_trunc "$run_status" $val_w)
last_val=$(_trunc "$last_event_display" $val_w)

# ── Box drawing ───────────────────────────────────────────────────────────────

inner_w=54  # fixed inner width for clean alignment
border=$(printf '─%.0s' $(seq 1 $inner_w))

_pad_row() {
    local label="$1" value="$2"
    local content="  ${label}${value}"
    local pad=$(( inner_w - ${#content} ))
    if [[ $pad -lt 0 ]]; then
        local max_val=$(( inner_w - ${#label} - 2 ))
        value="${value:0:$((max_val-1))}…"
        content="  ${label}${value}"
        pad=0
    fi
    printf '│%s%*s│\n' "$content" "$pad" ""
}

printf '┌─ autoconference progress ─%s┐\n' "$(printf '─%.0s' $(seq 1 $((inner_w - 28))))"
_pad_row "Conference:   " "$conf_val"
_pad_row "Goal:         " "$goal_val"
_pad_row "Round:        " "$round_val"
_pad_row "Researchers:  " "$researcher_val"
_pad_row "Best metric:  " "$metric_val"
_pad_row "Target:       " "$target_val"
_pad_row "Status:       " "$status_val"
_pad_row "Last event:   " "$last_val"
printf '└%s┘\n' "$border"

if [[ "$run_status" == "terminal invalid" ]]; then
    exit 4
fi
exit 0
