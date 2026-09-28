import { createHash } from "node:crypto";

const schema = "litfamily.harness-speed-v2/comparison/v1";
const product = "litopencode";
const baselineHead = "4d4fa72648dc1b0277a4d8787768828b66ee3de8";
const baselineStatus = "09b2f68760bf47a94f0eb9bda264a9dc3f4117d77ef3f5c2f775083c712c2982";
const sourceArtifact = "301cdc5e3579637365c220abec961ebde1354fbdd37cbaf41f8c9e9f3171971f";
const fixtureHash = "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be";
const phases = Object.freeze(["startup_config", "rules_transform", "no_route_floor", "activation_ledger", "s2_continuation", "local_total"]);
const arms = Object.freeze(["baseline", "candidate"]);
const guardNames = Object.freeze(["correctness", "route", "banner", "ledger", "body", "payload", "direct", "compaction"]);
const providerFields = Object.freeze(["input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens"]);
const envelopeKeys = "baseline,blocks,candidate,context_bytes,fixture,guards,lever,product,provider,raw_content_retained,schema";
const proofKeys = "body_sha256,deterministic,host,loaded_sha256,mechanism,observed,surface";
const forbiddenFields = new Set(["prompt", "response", "transcript", "url", "request_id", "session_id", "credential", "authorization", "cookie", "api_key"]);
const misleadingFields = new Set(["verdict", "result", "claimedsuccess"]);
const sha256Pattern = /^[a-f0-9]{64}$/u;

export class HarnessSpeedV2ContractError extends Error {
  constructor(code, field = null) {
    super(field === null ? code : `${code}:${field}`);
    Object.assign(this, { name: "HarnessSpeedV2ContractError", code, field });
  }
}

function reject(code, field = null) {
  throw new HarnessSpeedV2ContractError(code, field);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPrivacy(value, location = "receipt") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPrivacy(entry, `${location}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (misleadingFields.has(key.toLowerCase().replace(/[_-]/gu, ""))) reject("MISLEADING_SUCCESS_FIELD", `${location}.${key}`);
    if (forbiddenFields.has(key.toLowerCase())) reject("FORBIDDEN_FIELD", `${location}.${key}`);
    assertPrivacy(entry, `${location}.${key}`);
  }
}

function assertInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) reject("INVALID_CANDIDATE_IDENTITY", field);
}

function assertHash(value, field, code) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) reject(code, field);
}

function assertIdentity(receipt) {
  if (!isObject(receipt)) reject("INVALID_RECEIPT_IDENTITY");
  if (Object.keys(receipt).sort().join(",") !== envelopeKeys) reject("UNEXPECTED_TOP_LEVEL_FIELD");
  if (receipt.schema !== schema || receipt.product !== product) reject("INVALID_RECEIPT_IDENTITY");
  if (!isObject(receipt.fixture) || receipt.fixture.bytes !== 1476 || receipt.fixture.sha256 !== fixtureHash) {
    reject("FIXTURE_IDENTITY_MISMATCH");
  }
  if (!isObject(receipt.baseline) || receipt.baseline.source !== "frozen_repaired") reject("INVALID_BASELINE_SOURCE");
  if (receipt.baseline.head !== baselineHead) reject("BASELINE_HEAD_MISMATCH");
  if (receipt.baseline.source_artifact_sha256 !== sourceArtifact) reject("BASELINE_SOURCE_ARTIFACT_MISMATCH");
  if (receipt.baseline.status_sha256 !== baselineStatus
    || receipt.baseline.status_bytes !== 474 || receipt.baseline.status_records !== 14) {
    reject("BASELINE_STATUS_MISMATCH");
  }
  assertHash(receipt.baseline.artifact_sha256, "baseline.artifact_sha256", "INVALID_BASELINE_IDENTITY");
  if (!isObject(receipt.candidate)) reject("INVALID_CANDIDATE_IDENTITY");
  if (receipt.candidate.head !== baselineHead) reject("CANDIDATE_HEAD_MISMATCH");
  if (receipt.candidate.base_source_artifact_sha256 !== sourceArtifact) reject("CANDIDATE_BASE_SOURCE_ARTIFACT_MISMATCH");
  assertHash(receipt.candidate.source_artifact_sha256, "candidate.source_artifact_sha256", "INVALID_CANDIDATE_SOURCE_ARTIFACT");
  if (receipt.candidate.source_artifact_sha256 === sourceArtifact) reject("CANDIDATE_SOURCE_ARTIFACT_NOT_DISTINCT");
  assertHash(receipt.candidate.artifact_sha256, "candidate.artifact_sha256", "INVALID_CANDIDATE_IDENTITY");
  assertHash(receipt.candidate.status_sha256, "candidate.status_sha256", "INVALID_CANDIDATE_IDENTITY");
  if (receipt.candidate.artifact_sha256 === receipt.baseline.artifact_sha256) reject("CANDIDATE_ARTIFACT_NOT_DISTINCT");
  if (receipt.candidate.status_sha256 === receipt.baseline.status_sha256) reject("CANDIDATE_STATUS_NOT_DISTINCT");
  assertInteger(receipt.candidate.status_bytes, "candidate.status_bytes", 1);
  assertInteger(receipt.candidate.status_records, "candidate.status_records", 0);
}

function assertSamples(value, field) {
  if (!Array.isArray(value) || value.length !== 5) reject("INVALID_SAMPLE_COUNT", field);
  value.forEach((sample, index) => {
    if (!isObject(sample) || Object.keys(sample).sort().join(",") !== "index,value_ms"
      || typeof sample.value_ms !== "number" || !Number.isFinite(sample.value_ms) || sample.value_ms < 0) {
      reject("INVALID_SAMPLE", `${field}[${index}]`);
    }
    if (sample.index !== index + 1) reject("INVALID_SAMPLE_INDEX", `${field}[${index}]`);
  });
  return value.map((sample) => sample.value_ms);
}

function collectSamples(receipt) {
  if (!Array.isArray(receipt.blocks) || receipt.blocks.length !== 6) reject("INVALID_BLOCK_COUNT");
  const collected = Object.fromEntries(arms.map((arm) => [arm, Object.fromEntries(phases.map((phase) => [phase, []]))]));
  receipt.blocks.forEach((block, index) => {
    const expectedOrder = index % 2 === 0 ? arms : [...arms].reverse();
    if (!isObject(block) || block.block !== index + 1) reject("INVALID_BLOCK_ID", `blocks[${index}]`);
    if (!Array.isArray(block.order) || block.order.length !== 2
      || block.order.some((arm, orderIndex) => arm !== expectedOrder[orderIndex])) reject("INVALID_ARM_ORDER", `blocks[${index}]`);
    for (const arm of arms) {
      if (!isObject(block.arms?.[arm])) reject("INVALID_ARM", `blocks[${index}].${arm}`);
      for (const phase of phases) {
        const values = assertSamples(block.arms[arm][phase], `blocks[${index}].${arm}.${phase}`);
        collected[arm][phase].push(...values);
      }
    }
  });
  return collected;
}

function nearestRank(values, percentile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function summarize(collected) {
  return Object.fromEntries(phases.map((phase) => {
    const baseline = collected.baseline[phase];
    const candidate = collected.candidate[phase];
    const baselineP95 = nearestRank(baseline, 0.95);
    const candidateP95 = nearestRank(candidate, 0.95);
    const gain = baselineP95 > 0 ? (baselineP95 - candidateP95) / baselineP95 : null;
    return [phase, {
      baseline_p50_ms: nearestRank(baseline, 0.5),
      baseline_p95_ms: baselineP95,
      candidate_p50_ms: nearestRank(candidate, 0.5),
      candidate_p95_ms: candidateP95,
      gain_ratio: gain
    }];
  }));
}

function assertPerformance(receipt, metrics) {
  const aggregate = metrics.local_total;
  if (aggregate.candidate_p50_ms > aggregate.baseline_p50_ms) reject("AGGREGATE_P50_REGRESSION");
  if (aggregate.candidate_p95_ms > aggregate.baseline_p95_ms) reject("AGGREGATE_P95_REGRESSION");
  for (const phase of phases) {
    if (metrics[phase].candidate_p95_ms > metrics[phase].baseline_p95_ms) reject("PHASE_P95_REGRESSION", phase);
  }
  const early = receipt.blocks.slice(0, 3).flatMap((block) => block.arms.baseline.local_total.map((sample) => sample.value_ms));
  const late = receipt.blocks.slice(3).flatMap((block) => block.arms.baseline.local_total.map((sample) => sample.value_ms));
  const earlyP95 = nearestRank(early, 0.95);
  const drift = earlyP95 > 0 ? Math.abs(nearestRank(late, 0.95) - earlyP95) / earlyP95 : null;
  if (drift === null || drift > 0.20) reject("BASELINE_DRIFT");
  if (!isObject(receipt.lever)) reject("INVALID_LEVER_KIND");
  if (receipt.lever.kind === "latency") {
    if (!phases.includes(receipt.lever.phase)) reject("INVALID_LEVER_PHASE");
    if (metrics[receipt.lever.phase].gain_ratio === null || metrics[receipt.lever.phase].gain_ratio < 0.15) {
      reject("SELECTED_LATENCY_GAIN_NOT_MET");
    }
  } else if (receipt.lever.kind !== "context_bytes") reject("INVALID_LEVER_KIND");
  return drift;
}

function assertSemanticAndProvider(receipt) {
  if (!isObject(receipt.guards)) reject("SEMANTIC_GUARD_FAILED");
  for (const name of guardNames) {
    const guard = receipt.guards[name];
    if (!isObject(guard) || guard.baseline !== true || guard.candidate !== true) reject("SEMANTIC_GUARD_FAILED", name);
  }
  if (!isObject(receipt.provider) || receipt.provider.calls !== 0 || receipt.provider.completions !== 0) {
    reject("PROVIDER_ACTIVITY_OBSERVED");
  }
  for (const field of providerFields) {
    if (receipt.provider[field] !== "UNAVAILABLE") reject("PROVIDER_FIELD_NOT_UNAVAILABLE", field);
  }
  if (receipt.raw_content_retained !== false) reject("RAW_CONTENT_RETAINED");
}

function assertContext(receipt) {
  const context = receipt.context_bytes;
  if (!isObject(context) || !Number.isSafeInteger(context.baseline) || context.baseline <= 0
    || !Number.isSafeInteger(context.candidate) || context.candidate < 0) reject("INVALID_CONTEXT_BYTES");
  const reduction = (context.baseline - context.candidate) / context.baseline;
  if (reduction > 0) {
    const proof = receipt.lever?.proof;
    if (!isObject(proof) || Object.keys(proof).sort().join(",") !== proofKeys
      || proof.mechanism !== "opencode_pre_request" || proof.observed !== true || proof.deterministic !== true
      || proof.host !== "opencode" || proof.surface !== "pre_request"
      || !sha256Pattern.test(proof.body_sha256 ?? "") || proof.loaded_sha256 !== proof.body_sha256) {
      reject("DETERMINISTIC_LOADER_PROOF_REQUIRED");
    }
  }
  if (receipt.lever?.kind === "context_bytes" && reduction < 0.25) reject("CONTEXT_REDUCTION_NOT_MET");
  return reduction;
}

export function validateV2Comparison(receipt) {
  assertPrivacy(receipt);
  assertIdentity(receipt);
  const collected = collectSamples(receipt);
  const metrics = summarize(collected);
  const baselineDrift = assertPerformance(receipt, metrics);
  assertSemanticAndProvider(receipt);
  const contextReduction = assertContext(receipt);
  return {
    schema: "litfamily.harness-speed-v2/verdict/v1",
    product,
    verdict: "PASS",
    cohort: { blocks: 6, samples_per_arm_phase: 30 },
    metrics: { aggregate: metrics.local_total, phases: metrics, baseline_drift_ratio: baselineDrift, context_reduction_ratio: contextReduction },
    provider: { calls: 0, completions: 0, fields: "UNAVAILABLE" },
    raw_content_retained: false
  };
}

export function validateV2FixtureBytes(bytes) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== 1476 || digest !== fixtureHash) reject("FIXTURE_IDENTITY_MISMATCH");
}
