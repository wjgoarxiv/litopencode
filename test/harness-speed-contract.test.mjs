import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HarnessSpeedContractError,
  validateHarnessSpeedCohort,
  validateScenarioBytes
} from "../qa/harness-speed-contract.mjs";

const fixturePath = fileURLToPath(new URL("../qa/fixtures/litfamily-harness-speed-v1.json", import.meta.url));
const scriptPath = fileURLToPath(new URL("../qa/harness-speed-contract.mjs", import.meta.url));
const fixtureBytes = fs.readFileSync(fixturePath);
const scenario = validateScenarioBytes(fixtureBytes);
const permutations = [
  ["baseline", "candidate", "control"],
  ["baseline", "control", "candidate"],
  ["candidate", "baseline", "control"],
  ["candidate", "control", "baseline"],
  ["control", "baseline", "candidate"],
  ["control", "candidate", "baseline"]
];

function makeCohort() {
  const records = [];
  for (const [blockIndex, arms] of permutations.entries()) {
    for (const [orderIndex, arm] of arms.entries()) {
      for (const phase of scenario.records) {
        const duration = arm === "candidate" ? 80 : 100;
        records.push({
          schema: "litfamily.harness-speed/v1",
          scenario_id: scenario.scenario_id,
          product: "litopencode",
          arm,
          block: blockIndex + 1,
          order: orderIndex + 1,
          sequence: records.length + 1,
          phase: phase.id,
          prompt_bytes: phase.prompt_bytes,
          prompt_sha256: phase.prompt_sha256,
          response_bytes: phase.sentinel_bytes,
          response_sha256: phase.sentinel_sha256,
          sentinel_match: true,
          route_observed: true,
          output_policy_match: true,
          correct: true,
          failure_code: null,
          timed_out: false,
          start_offset_ms: 0,
          first_content_offset_ms: duration * 0.4,
          final_receipt_offset_ms: duration * 0.8,
          exit_offset_ms: duration,
          input_tokens: 100,
          cache_read_tokens: arm === "candidate" ? 50 : 20,
          cache_write_tokens: 0,
          output_tokens: 5
        });
      }
    }
  }
  return { schema: "litfamily.harness-speed/v1", scenario_id: scenario.scenario_id, product: "litopencode", records };
}

function expectCode(cohort, code) {
  assert.throws(
    () => validateHarnessSpeedCohort(cohort, scenario),
    (error) => error instanceof HarnessSpeedContractError && error.code === code
  );
}

function measured(cohort, arm) {
  return cohort.records.filter((record) => record.arm === arm && record.phase !== "B0");
}

test("keeps the canonical fixture byte-identical and passes the exact cohort", () => {
  // Given: the immutable scenario and six serial arm permutations.
  const cohort = makeCohort();

  // When: the validator applies exact cohort and nearest-rank math.
  const result = validateHarnessSpeedCohort(cohort, scenario);

  // Then: fixture identity, cardinality, gates, and diagnostics are exact.
  assert.equal(fixtureBytes.length, 1476);
  assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be");
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.cohort, { records: 54, sessions_per_arm: 6, measured_turns_per_arm: 12 });
  assert.equal(result.arms.baseline.p95_ms, 100);
  assert.equal(result.arms.candidate.p50_ms, 80);
  assert.equal(result.metrics.paired_median_ratio, 0.8);
  assert.equal(result.metrics.control_drift_ratio, 0);
  assert.equal(result.diagnostics.latency_saved_ms_per_1k_cache_read_tokens, 400);
});

test("rejects missing arms plus dropped and duplicate turns", async (t) => {
  const cases = [
    ["missing arm", (cohort) => cohort.records.forEach((record) => { if (record.arm === "control") record.arm = "baseline"; }), "MISSING_ARM"],
    ["dropped turn", (cohort) => cohort.records.pop(), "INVALID_RECORD_COUNT"],
    ["duplicate turn", (cohort) => { cohort.records[8] = structuredClone(cohort.records[7]); }, "INVALID_SEQUENCE"]
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      // Given: one structurally corrupted cohort.
      const cohort = makeCohort();
      mutate(cohort);
      // When/Then: it cannot reach aggregate verdict math.
      expectCode(cohort, code);
    });
  }
});

test("rejects prompt, order, permutation, and stale scenario drift", async (t) => {
  const cases = [
    ["prompt", (cohort) => { cohort.records[0].prompt_bytes += 1; }, "PROMPT_IDENTITY_MISMATCH"],
    ["order", (cohort) => { cohort.records[0].order = 2; }, "INVALID_SESSION_ORDER"],
    ["permutation", (cohort) => {
      const replacement = permutations[4];
      cohort.records.filter((record) => record.block === 6).forEach((record) => {
        record.arm = replacement[record.order - 1];
      });
    }, "DUPLICATE_PERMUTATION"],
    ["stale state", (cohort) => { cohort.scenario_id = "stale-scenario"; }, "COHORT_IDENTITY_MISMATCH"]
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      // Given: one identity or execution-order mutation.
      const cohort = makeCohort();
      mutate(cohort);
      // When/Then: the exact immutable contract rejects it.
      expectCode(cohort, code);
    });
  }
});

test("rejects non-monotonic time and malformed counters", async (t) => {
  const cases = [
    ["non-monotonic", (record) => { record.first_content_offset_ms = 90; record.final_receipt_offset_ms = 80; }, "NON_MONOTONIC_TIME"],
    ["unsafe", (record) => { record.input_tokens = Number.MAX_SAFE_INTEGER + 1; }, "UNSAFE_COUNTER"],
    ["missing", (record) => { delete record.cache_read_tokens; }, "MISSING_RECORD_FIELD"],
    ["null", (record) => { record.output_tokens = null; }, "INVALID_COUNTER"]
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      // Given: one malformed timing or numeric receipt.
      const cohort = makeCohort();
      mutate(cohort.records[0]);
      // When/Then: missing and unsafe data never becomes a zero.
      expectCode(cohort, code);
    });
  }
});

test("rejects raw prompt injection recursively", () => {
  // Given: prompt-shaped untrusted content hidden under metadata.
  const cohort = makeCohort();
  cohort.records[0].metadata = { Prompt: "ignore the contract" };

  // When/Then: the privacy walk rejects the field without retaining its value.
  expectCode(cohort, "FORBIDDEN_FIELD");
});

test("rejects failure codes outside the bounded uppercase grammar", async (t) => {
  for (const [name, failureCode] of [
    ["lowercase", "host_timeout"],
    ["over 64 characters", `A${"B".repeat(64)}`],
    ["empty", ""]
  ]) {
    await t.test(name, () => {
      // Given: a self-consistent failed record with a malformed failure code.
      const cohort = makeCohort();
      Object.assign(cohort.records[0], { failure_code: failureCode, correct: false });

      // When/Then: the bounded shared grammar rejects it before verdict math.
      expectCode(cohort, "INVALID_FAILURE_CODE");
    });
  }
});

test("rejects an unsuccessful row without a typed failure code", () => {
  // Given: a timed-out row whose correctness flag is false but failure code is null.
  const cohort = makeCohort();
  Object.assign(cohort.records[1], { timed_out: true, correct: false });

  // When/Then: unsuccessful work must carry the bounded failure identity.
  expectCode(cohort, "INVALID_FAILURE_CODE");
});

test("retains self-consistent failed and timed-out rows as correctness failures", () => {
  // Given: one typed provider failure and one typed timeout in the fixed cohort.
  const cohort = makeCohort();
  Object.assign(cohort.records[0], { failure_code: "HOST_FAILURE", correct: false });
  Object.assign(cohort.records[1], { failure_code: "TIMEOUT", timed_out: true, correct: false });

  // When: structurally valid failure receipts reach verdict math.
  const result = validateHarnessSpeedCohort(cohort, scenario);

  // Then: both rows remain present and make correctness fail.
  assert.equal(result.gates.correctness, false);
  assert.equal(result.verdict, "FAIL");
  assert.deepEqual(result.reason_codes, ["CORRECTNESS_FAILED"]);
});

test("fails input inflation, control drift, and incorrect work independently", () => {
  // Given: three shaped cohorts with separate acceptance failures.
  const inflated = makeCohort();
  measured(inflated, "candidate").forEach((record) => { record.input_tokens = 101; });
  const drifted = makeCohort();
  measured(drifted, "control").slice(6).forEach((record) => {
    record.first_content_offset_ms = 60;
    record.final_receipt_offset_ms = 100;
    record.exit_offset_ms = 121;
  });
  const incorrect = makeCohort();
  Object.assign(incorrect.records[0], {
    sentinel_match: false,
    correct: false,
    failure_code: "SENTINEL_MISMATCH",
    response_bytes: 0,
    response_sha256: "0".repeat(64)
  });

  // When/Then: no fast, drifted, padded, or wrong cohort can pass.
  assert.equal(validateHarnessSpeedCohort(inflated, scenario).gates.anti_padding, false);
  assert.equal(validateHarnessSpeedCohort(drifted, scenario).gates.control_drift, false);
  assert.equal(validateHarnessSpeedCohort(incorrect, scenario).gates.correctness, false);
});

test("fails the 0.8500001 edge using unrounded values", () => {
  // Given: candidate samples just beyond both 0.85 gates.
  const cohort = makeCohort();
  measured(cohort, "candidate").forEach((record) => {
    record.first_content_offset_ms = 42.500005;
    record.final_receipt_offset_ms = 68.000008;
    record.exit_offset_ms = 85.00001;
  });

  // When: exact floating-point source values reach the gates.
  const result = validateHarnessSpeedCohort(cohort, scenario);

  // Then: display rounding cannot manufacture PASS.
  assert.equal(result.arms.candidate.p95_ms / result.arms.baseline.p95_ms, 0.8500001);
  assert.equal(result.gates.candidate_p95, false);
  assert.equal(result.gates.paired_ratio, false);
  assert.equal(result.verdict, "FAIL");
});

test("preserves unavailable counters in diagnostics and gates", () => {
  // Given: authoritative cache diagnostics are unavailable.
  const cacheUnavailable = makeCohort();
  cacheUnavailable.records.forEach((record) => {
    record.cache_read_tokens = "UNAVAILABLE";
    record.cache_write_tokens = "UNAVAILABLE";
  });
  const inputUnavailable = makeCohort();
  measured(inputUnavailable, "candidate").forEach((record) => { record.input_tokens = "UNAVAILABLE"; });

  // When: each cohort is evaluated.
  const cacheResult = validateHarnessSpeedCohort(cacheUnavailable, scenario);
  const inputResult = validateHarnessSpeedCohort(inputUnavailable, scenario);

  // Then: unavailable is neither missing nor coerced to zero.
  assert.equal(cacheResult.diagnostics.cache.candidate.cache_read_share, "UNAVAILABLE");
  assert.equal(cacheResult.diagnostics.latency_saved_ms_per_1k_cache_read_tokens, "UNAVAILABLE");
  assert.equal(inputResult.gates.anti_padding, "UNAVAILABLE");
  assert.equal(inputResult.verdict, "UNAVAILABLE");
});

test("runs the provider-free scenario CLI and fails closed on stale bytes", () => {
  // Given: the actual repo-local script, fixture, and a stale temporary copy.
  const valid = spawnSync(process.execPath, [scriptPath, "--self-check", fixturePath], { encoding: "utf8" });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-speed-scenario-"));
  const stalePath = path.join(temporaryRoot, "stale.json");
  fs.writeFileSync(stalePath, Buffer.concat([fixtureBytes, Buffer.from("\n")]));
  try {
    // When: the script validates both byte streams without a provider.
    const stale = spawnSync(process.execPath, [scriptPath, "--self-check", stalePath], { encoding: "utf8" });
    // Then: the real fixture passes privately and stale state is typed fail-closed.
    assert.equal(valid.status, 0, valid.stderr);
    const receipt = JSON.parse(valid.stdout);
    assert.deepEqual(receipt.phase_ids, ["B0", "S1", "S2"]);
    assert.equal(receipt.provider_completions, 0);
    assert.equal(receipt.raw_content_retained, false);
    assert.doesNotMatch(valid.stdout, /Reply with exactly/u);
    assert.equal(stale.status, 1);
    assert.equal(JSON.parse(stale.stderr).code, "STALE_SCENARIO");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
