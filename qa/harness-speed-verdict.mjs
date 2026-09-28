const ARMS = ["baseline", "candidate", "control"];
const UNAVAILABLE = "UNAVAILABLE";

function nearestRank(values, percentile, reject) {
  if (values.length === 0) reject("EMPTY_PERCENTILE");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function e2e(record) {
  return record.exit_offset_ms - record.start_offset_ms;
}

function numericSum(records, field, reject) {
  let total = 0;
  for (const record of records) {
    const value = record[field];
    if (value === UNAVAILABLE) return UNAVAILABLE;
    total += value;
    if (!Number.isSafeInteger(total)) reject("UNSAFE_COUNTER_SUM", field);
  }
  return total;
}

function armDiagnostics(records, reject) {
  const input = numericSum(records, "input_tokens", reject);
  const cache = numericSum(records, "cache_read_tokens", reject);
  const compatible = records.every((record) => typeof record.input_tokens === "number"
    && typeof record.cache_read_tokens === "number" && record.cache_read_tokens <= record.input_tokens);
  return {
    cache_read_share: typeof input === "number" && input > 0 && typeof cache === "number" ? cache / input : UNAVAILABLE,
    uncached_input_per_correct_turn: compatible && records.length > 0
      ? records.reduce((total, record) => total + record.input_tokens - record.cache_read_tokens, 0) / records.length
      : UNAVAILABLE
  };
}

export function evaluateHarnessSpeedRecords(records, reject) {
  const measured = Object.fromEntries(ARMS.map((arm) => [arm,
    records.filter((record) => record.arm === arm && record.phase !== "B0")]));
  const warmups = Object.fromEntries(ARMS.map((arm) => [arm,
    records.filter((record) => record.arm === arm && record.phase === "B0")]));
  const durations = Object.fromEntries(ARMS.map((arm) => [arm, measured[arm].map(e2e)]));
  const summaries = Object.fromEntries(ARMS.map((arm) => [arm, {
    warmups_correct: warmups[arm].filter((record) => record.correct).length,
    measured_correct: measured[arm].filter((record) => record.correct).length,
    p50_ms: nearestRank(durations[arm], 0.5, reject),
    p95_ms: nearestRank(durations[arm], 0.95, reject),
    total_input_tokens: numericSum(measured[arm], "input_tokens", reject)
  }]));
  const ratios = measured.candidate.map((candidate) => {
    const baseline = measured.baseline.find((record) => record.block === candidate.block && record.phase === candidate.phase);
    if (baseline === undefined || e2e(baseline) <= 0) reject("INVALID_PAIR", `${candidate.block}-${candidate.phase}`);
    return e2e(candidate) / e2e(baseline);
  });
  const earlyControl = durations.control.slice(0, 6);
  const lateControl = durations.control.slice(6);
  const earlyP95 = nearestRank(earlyControl, 0.95, reject);
  if (earlyP95 <= 0) reject("INVALID_CONTROL_BASELINE");
  const pairedMedianRatio = nearestRank(ratios, 0.5, reject);
  const controlDriftRatio = Math.abs(nearestRank(lateControl, 0.95, reject) - earlyP95) / earlyP95;
  const allCorrect = ARMS.every((arm) => summaries[arm].warmups_correct === 6
    && summaries[arm].measured_correct === 12);
  const baselineInput = summaries.baseline.total_input_tokens;
  const candidateInput = summaries.candidate.total_input_tokens;
  const antiPadding = typeof baselineInput === "number" && typeof candidateInput === "number"
    ? candidateInput <= baselineInput : UNAVAILABLE;
  const gates = {
    correctness: allCorrect,
    candidate_p95: summaries.candidate.p95_ms <= summaries.baseline.p95_ms * 0.85,
    candidate_p50: summaries.candidate.p50_ms <= summaries.baseline.p50_ms,
    paired_ratio: pairedMedianRatio <= 0.85,
    control_drift: controlDriftRatio <= 0.20,
    anti_padding: antiPadding
  };
  const candidateCache = numericSum(measured.candidate, "cache_read_tokens", reject);
  const cacheCompatible = [...measured.baseline, ...measured.candidate].every((record) =>
    typeof record.input_tokens === "number" && typeof record.cache_read_tokens === "number"
    && record.cache_read_tokens <= record.input_tokens);
  const latencySaved = cacheCompatible && typeof candidateCache === "number" && candidateCache > 0
    ? (durations.baseline.reduce((sum, value) => sum + value, 0)
      - durations.candidate.reduce((sum, value) => sum + value, 0)) / (candidateCache / 1000)
    : UNAVAILABLE;
  const reasonCodes = [];
  if (!gates.correctness) reasonCodes.push("CORRECTNESS_FAILED");
  if (!gates.candidate_p95) reasonCodes.push("CANDIDATE_P95_TARGET_NOT_MET");
  if (!gates.candidate_p50) reasonCodes.push("CANDIDATE_P50_REGRESSION");
  if (!gates.paired_ratio) reasonCodes.push("PAIRED_RATIO_TARGET_NOT_MET");
  if (!gates.control_drift) reasonCodes.push("ENVIRONMENT_DRIFT");
  if (gates.anti_padding === false) reasonCodes.push("INPUT_PADDING");
  if (gates.anti_padding === UNAVAILABLE) reasonCodes.push("INPUT_TOKENS_UNAVAILABLE");
  return {
    verdict: reasonCodes.length === 0 ? "PASS"
      : gates.anti_padding === UNAVAILABLE && reasonCodes.length === 1 ? UNAVAILABLE : "FAIL",
    reason_codes: reasonCodes,
    cohort: { records: 54, sessions_per_arm: 6, measured_turns_per_arm: 12 },
    arms: summaries,
    metrics: { paired_median_ratio: pairedMedianRatio, control_drift_ratio: controlDriftRatio },
    gates,
    diagnostics: {
      cache: Object.fromEntries(ARMS.map((arm) => [arm, armDiagnostics(measured[arm], reject)])),
      latency_saved_ms_per_1k_cache_read_tokens: latencySaved
    }
  };
}
