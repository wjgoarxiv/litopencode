import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateHarnessSpeedRecords } from "./harness-speed-verdict.mjs";

const SCHEMA = "litfamily.harness-speed/v1";
const SCENARIO_ID = "litfamily-speed-lit-activation-v1";
const PRODUCT = "litopencode";
const SCENARIO_BYTES = 1476;
const SCENARIO_SHA256 = "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be";
const ARMS = ["baseline", "candidate", "control"];
const PHASES = ["B0", "S1", "S2"];
const COUNTERS = ["input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens"];
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const REQUIRED_FIELDS = [
  "schema", "scenario_id", "product", "arm", "block", "order", "sequence", "phase",
  "prompt_bytes", "prompt_sha256", "response_bytes", "response_sha256", "sentinel_match",
  "route_observed", "output_policy_match", "correct", "failure_code", "timed_out",
  "start_offset_ms", "first_content_offset_ms", "final_receipt_offset_ms", "exit_offset_ms",
  ...COUNTERS
];
const FORBIDDEN_FIELDS = new Set([
  "prompt", "response", "transcript", "url", "request_id", "thread_id", "session_id",
  "credential", "authorization", "cookie", "api_key"
]);
const UNAVAILABLE = "UNAVAILABLE";

export class HarnessSpeedContractError extends Error {
  constructor(code, field = null) {
    super(field === null ? code : `${code}:${field}`);
    this.name = "HarnessSpeedContractError";
    this.code = code;
    this.field = field;
  }
}

function reject(code, field = null) {
  throw new HarnessSpeedContractError(code, field);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPrivacy(value, location = "cohort") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPrivacy(entry, `${location}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) reject("FORBIDDEN_FIELD", `${location}.${key}`);
    assertPrivacy(entry, `${location}.${key}`);
  }
}

function assertSafeCounter(value, field) {
  if (value === UNAVAILABLE) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) reject("INVALID_COUNTER", field);
  if (!Number.isSafeInteger(value)) reject("UNSAFE_COUNTER", field);
}

function assertOffset(value, field, unavailableAllowed = false) {
  if (unavailableAllowed && value === UNAVAILABLE) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) reject("INVALID_TIME", field);
}

function phaseMap(scenario) {
  if (!isObject(scenario) || !Array.isArray(scenario.records) || scenario.scenario_id !== SCENARIO_ID) {
    reject("INVALID_SCENARIO");
  }
  return new Map(scenario.records.map((record) => [record.id, record]));
}

function validateRecord(record, index, scenarioPhases) {
  const location = `records[${index}]`;
  if (!isObject(record)) reject("INVALID_RECORD", location);
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(record, field)) reject("MISSING_RECORD_FIELD", `${location}.${field}`);
  }
  if (record.schema !== SCHEMA || record.scenario_id !== SCENARIO_ID || record.product !== PRODUCT) {
    reject("RECORD_IDENTITY_MISMATCH", location);
  }
  if (!ARMS.includes(record.arm)) reject("INVALID_ARM", `${location}.arm`);
  if (!Number.isInteger(record.block) || record.block < 1 || record.block > 6) reject("INVALID_BLOCK", location);
  if (!Number.isInteger(record.order) || record.order < 1 || record.order > 3) reject("INVALID_ORDER", location);
  if (!Number.isInteger(record.sequence) || record.sequence < 1 || record.sequence > 54) {
    reject("INVALID_SEQUENCE", location);
  }
  const expected = scenarioPhases.get(record.phase);
  if (!isObject(expected)) reject("INVALID_PHASE", `${location}.phase`);
  if (record.prompt_bytes !== expected.prompt_bytes || record.prompt_sha256 !== expected.prompt_sha256) {
    reject("PROMPT_IDENTITY_MISMATCH", location);
  }
  if (!Number.isSafeInteger(record.response_bytes) || record.response_bytes < 0) {
    reject("INVALID_RESPONSE_IDENTITY", location);
  }
  if (typeof record.response_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(record.response_sha256)) {
    reject("INVALID_RESPONSE_IDENTITY", location);
  }
  for (const field of ["sentinel_match", "route_observed", "output_policy_match", "correct", "timed_out"]) {
    if (typeof record[field] !== "boolean") reject("INVALID_BOOLEAN", `${location}.${field}`);
  }
  if (record.failure_code !== null
    && (typeof record.failure_code !== "string" || !FAILURE_CODE_PATTERN.test(record.failure_code))) {
    reject("INVALID_FAILURE_CODE", location);
  }
  const unsuccessful = !record.sentinel_match || !record.route_observed || !record.output_policy_match
    || record.timed_out || record.failure_code !== null;
  if (unsuccessful && record.failure_code === null) reject("INVALID_FAILURE_CODE", location);
  assertOffset(record.start_offset_ms, `${location}.start_offset_ms`);
  assertOffset(record.first_content_offset_ms, `${location}.first_content_offset_ms`, true);
  assertOffset(record.final_receipt_offset_ms, `${location}.final_receipt_offset_ms`);
  assertOffset(record.exit_offset_ms, `${location}.exit_offset_ms`);
  const first = record.first_content_offset_ms === UNAVAILABLE
    ? record.start_offset_ms
    : record.first_content_offset_ms;
  if (record.start_offset_ms > first || first > record.final_receipt_offset_ms
    || record.final_receipt_offset_ms > record.exit_offset_ms) reject("NON_MONOTONIC_TIME", location);
  for (const field of COUNTERS) assertSafeCounter(record[field], `${location}.${field}`);
  const derivedCorrect = !unsuccessful;
  if (record.correct !== derivedCorrect) reject("CORRECTNESS_MISMATCH", location);
  if (record.sentinel_match
    && (record.response_bytes !== expected.sentinel_bytes || record.response_sha256 !== expected.sentinel_sha256)) {
    reject("SENTINEL_IDENTITY_MISMATCH", location);
  }
}

function assertCohortShape(records) {
  const seenArms = new Set(records.map((record) => record.arm));
  for (const arm of ARMS) if (!seenArms.has(arm)) reject("MISSING_ARM", arm);
  if (records.length !== 54) reject("INVALID_RECORD_COUNT");
  const permutations = new Set();
  for (let block = 1; block <= 6; block += 1) {
    const blockArms = [];
    for (let order = 1; order <= 3; order += 1) {
      const start = ((block - 1) * 9) + ((order - 1) * 3);
      const session = records.slice(start, start + 3);
      const arm = session[0]?.arm;
      if (!ARMS.includes(arm)) reject("INVALID_SESSION_ARM", `block-${block}-order-${order}`);
      blockArms.push(arm);
      session.forEach((record, phaseIndex) => {
        const expectedSequence = start + phaseIndex + 1;
        if (record.sequence !== expectedSequence) reject("INVALID_SEQUENCE", `sequence-${expectedSequence}`);
        if (record.block !== block || record.order !== order || record.arm !== arm
          || record.phase !== PHASES[phaseIndex]) reject("INVALID_SESSION_ORDER", `sequence-${expectedSequence}`);
      });
    }
    if (new Set(blockArms).size !== 3) reject("INVALID_BLOCK_PERMUTATION", `block-${block}`);
    const permutation = blockArms.join(",");
    if (permutations.has(permutation)) reject("DUPLICATE_PERMUTATION", `block-${block}`);
    permutations.add(permutation);
  }
  if (permutations.size !== 6) reject("INCOMPLETE_PERMUTATIONS");
}

export function validateScenarioBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) reject("INVALID_SCENARIO_BYTES");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== SCENARIO_BYTES || digest !== SCENARIO_SHA256) reject("STALE_SCENARIO");
  const scenario = JSON.parse(bytes.toString("utf8"));
  phaseMap(scenario);
  return scenario;
}

export function validateHarnessSpeedCohort(cohort, scenario) {
  assertPrivacy(cohort);
  if (!isObject(cohort) || cohort.schema !== SCHEMA || cohort.scenario_id !== SCENARIO_ID
    || cohort.product !== PRODUCT || !Array.isArray(cohort.records)) reject("COHORT_IDENTITY_MISMATCH");
  const phases = phaseMap(scenario);
  cohort.records.forEach((record, index) => validateRecord(record, index, phases));
  assertCohortShape(cohort.records);
  return evaluateHarnessSpeedRecords(cohort.records, reject);
}

export function scenarioSurfaceReceipt(bytes) {
  const scenario = validateScenarioBytes(bytes);
  return {
    schema: "litfamily.harness-speed-surface/v1",
    product: PRODUCT,
    scenario_id: scenario.scenario_id,
    fixture_bytes: bytes.length,
    fixture_sha256: SCENARIO_SHA256,
    phase_ids: scenario.records.map((record) => record.id),
    provider_completions: 0,
    raw_content_retained: false,
    verdict: "PASS"
  };
}

function main(argv) {
  if (argv.length !== 2 || argv[0] !== "--self-check") reject("INVALID_CLI_USAGE");
  process.stdout.write(`${JSON.stringify(scenarioSurfaceReceipt(readFileSync(argv[1])))}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof HarnessSpeedContractError) {
      process.stderr.write(`${JSON.stringify({ verdict: "FAIL", code: error.code, field: error.field })}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
