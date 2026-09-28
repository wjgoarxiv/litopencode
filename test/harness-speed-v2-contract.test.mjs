import assert from "node:assert/strict";
import { test } from "node:test";

const validatorPromise = import("../qa/harness-speed-v2-contract.mjs").catch(() => null);
const baselineHead = "4d4fa72648dc1b0277a4d8787768828b66ee3de8";
const baselineStatus = "09b2f68760bf47a94f0eb9bda264a9dc3f4117d77ef3f5c2f775083c712c2982";
const sourceArtifact = "301cdc5e3579637365c220abec961ebde1354fbdd37cbaf41f8c9e9f3171971f";
const fixtureHash = "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be";
const phases = ["startup_config", "rules_transform", "no_route_floor", "activation_ledger", "s2_continuation", "local_total"];
const guards = ["correctness", "route", "banner", "ledger", "body", "payload", "direct", "compaction"];

async function validate(receipt) {
  const module = await validatorPromise;
  assert.notEqual(module, null, "V2 validator module is missing");
  return module.validateV2Comparison(receipt);
}

async function expectCode(receipt, code) {
  await assert.rejects(() => validate(receipt),
    (error) => error?.name === "HarnessSpeedV2ContractError" && error.code === code);
}

function samples(value) { return Array.from({ length: 5 }, (_, index) => ({ index: index + 1, value_ms: value })); }

function makeArm(value) { return Object.fromEntries(phases.map((phase) => [phase, samples(value)])); }

function loaderProof() {
  return { mechanism: "opencode_pre_request", observed: true, deterministic: true, host: "opencode", surface: "pre_request", body_sha256: "d".repeat(64), loaded_sha256: "d".repeat(64) };
}

function makeReceipt() {
  return {
    schema: "litfamily.harness-speed-v2/comparison/v1",
    product: "litopencode",
    fixture: { bytes: 1476, sha256: fixtureHash },
    baseline: { source: "frozen_repaired", head: baselineHead, source_artifact_sha256: sourceArtifact,
      artifact_sha256: "a".repeat(64), status_sha256: baselineStatus, status_bytes: 474, status_records: 14 },
    candidate: { head: baselineHead, base_source_artifact_sha256: sourceArtifact,
      source_artifact_sha256: "e".repeat(64), artifact_sha256: "b".repeat(64),
      status_sha256: "c".repeat(64), status_bytes: 600, status_records: 16 },
    blocks: Array.from({ length: 6 }, (_, index) => ({
      block: index + 1,
      order: index % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"],
      arms: { baseline: makeArm(100), candidate: makeArm(80) }
    })),
    guards: Object.fromEntries(guards.map((guard) => [guard, { baseline: true, candidate: true }])),
    provider: { calls: 0, completions: 0, input_tokens: "UNAVAILABLE", cache_read_tokens: "UNAVAILABLE",
      cache_write_tokens: "UNAVAILABLE", output_tokens: "UNAVAILABLE" },
    context_bytes: { baseline: 1000, candidate: 1000 },
    lever: { kind: "latency", phase: "activation_ledger" },
    raw_content_retained: false
  };
}

function mutatePhase(receipt, arm, phase, value, blockStart = 0, blockEnd = 6) {
  receipt.blocks.slice(blockStart, blockEnd).forEach((block) => { block.arms[arm][phase] = samples(value); });
}

test("accepts the exact repaired V2 identity and six alternating five-sample blocks", async () => {
  const result = await validate(makeReceipt());

  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.cohort, { blocks: 6, samples_per_arm_phase: 30 });
  assert.deepEqual(result.metrics.aggregate, { baseline_p50_ms: 100, baseline_p95_ms: 100, candidate_p50_ms: 80, candidate_p95_ms: 80, gain_ratio: 0.2 });
  assert.equal(result.metrics.phases.activation_ledger.gain_ratio, 0.2);
  assert.equal(result.provider.calls, 0);
});

test("rejects clean HEAD, wrong T01 identity, stale fixture, and implicit candidate identity", async (t) => {
  const cases = [
    ["clean HEAD", (receipt) => { receipt.baseline.source = "clean_head"; }, "INVALID_BASELINE_SOURCE"],
    ["wrong HEAD", (receipt) => { receipt.baseline.head = "0".repeat(40); }, "BASELINE_HEAD_MISMATCH"],
    ["wrong baseline source artifact", (receipt) => { receipt.baseline.source_artifact_sha256 = "d".repeat(64); }, "BASELINE_SOURCE_ARTIFACT_MISMATCH"],
    ["wrong candidate HEAD", (receipt) => { receipt.candidate.head = "1".repeat(40); }, "CANDIDATE_HEAD_MISMATCH"],
    ["wrong candidate base source", (receipt) => { receipt.candidate.base_source_artifact_sha256 = "d".repeat(64); }, "CANDIDATE_BASE_SOURCE_ARTIFACT_MISMATCH"],
    ["invalid candidate source", (receipt) => { receipt.candidate.source_artifact_sha256 = "d".repeat(63); }, "INVALID_CANDIDATE_SOURCE_ARTIFACT"],
    ["aliased candidate source", (receipt) => { receipt.candidate.source_artifact_sha256 = sourceArtifact; }, "CANDIDATE_SOURCE_ARTIFACT_NOT_DISTINCT"],
    ["wrong status", (receipt) => { receipt.baseline.status_sha256 = "0".repeat(64); }, "BASELINE_STATUS_MISMATCH"],
    ["stale fixture", (receipt) => { receipt.fixture.bytes = 1477; }, "FIXTURE_IDENTITY_MISMATCH"],
    ["missing candidate status", (receipt) => { delete receipt.candidate.status_sha256; }, "INVALID_CANDIDATE_IDENTITY"],
    ["aliased candidate status", (receipt) => { receipt.candidate.status_sha256 = baselineStatus; }, "CANDIDATE_STATUS_NOT_DISTINCT"],
    ["aliased candidate artifact", (receipt) => { receipt.candidate.artifact_sha256 = receipt.baseline.artifact_sha256; }, "CANDIDATE_ARTIFACT_NOT_DISTINCT"]
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, async () => {
      const receipt = makeReceipt();
      mutate(receipt);
      await expectCode(receipt, code);
    });
  }
});

test("rejects misleading top-level success claims outside the exact envelope", async (t) => {
  for (const field of ["verdict", "result", "claimed_success"]) {
    await t.test(field, async () => { const receipt = makeReceipt(); receipt[field] = "PASS"; await expectCode(receipt, "MISLEADING_SUCCESS_FIELD"); });
  }
});

test("rejects normalized misleading-success keys recursively", async (t) => {
  const cases = [
    ["baseline.verdict", (receipt) => { receipt.baseline.verdict = "PASS"; }],
    ["candidate.result", (receipt) => { receipt.candidate.result = "PASS"; }],
    ["blocks[0].claimedSuccess", (receipt) => { receipt.blocks[0].claimedSuccess = true; }],
    ["context_bytes.result", (receipt) => { receipt.context_bytes.result = "PASS"; }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => { const receipt = makeReceipt(); mutate(receipt); await expectCode(receipt, "MISLEADING_SUCCESS_FIELD"); });
});

test("allows nested diagnostic keys that are not exact normalized claims", async () => { const receipt = makeReceipt(); Object.assign(receipt.baseline, { result_code: "LOCAL", verdict_detail: "computed", claimed_successfully: false }); assert.equal((await validate(receipt)).verdict, "PASS"); });

test("rejects missing samples, malformed blocks, and non-alternating arm order", async (t) => {
  const cases = [
    ["missing sample", (receipt) => { receipt.blocks[0].arms.baseline.local_total.pop(); }, "INVALID_SAMPLE_COUNT"],
    ["swapped sample indices", (receipt) => { receipt.blocks[0].arms.baseline.local_total[0].index = 2; }, "INVALID_SAMPLE_INDEX"],
    ["duplicate sample index", (receipt) => { receipt.blocks[0].arms.baseline.local_total[1].index = 1; }, "INVALID_SAMPLE_INDEX"],
    ["missing block", (receipt) => { receipt.blocks.pop(); }, "INVALID_BLOCK_COUNT"],
    ["wrong block id", (receipt) => { receipt.blocks[2].block = 4; }, "INVALID_BLOCK_ID"],
    ["non-alternating", (receipt) => { receipt.blocks[1].order = ["baseline", "candidate"]; }, "INVALID_ARM_ORDER"]
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, async () => {
      const receipt = makeReceipt();
      mutate(receipt);
      await expectCode(receipt, code);
    });
  }
});

test("uses raw nearest-rank math and rejects slower phases or baseline drift", async (t) => {
  await t.test("aggregate p50 regression", async () => {
    const receipt = makeReceipt();
    mutatePhase(receipt, "candidate", "local_total", 100.00001);
    await expectCode(receipt, "AGGREGATE_P50_REGRESSION");
  });
  await t.test("aggregate p95 regression", async () => {
    const receipt = makeReceipt();
    receipt.blocks[0].arms.candidate.local_total.slice(0, 2).forEach((sample) => { sample.value_ms = 100.00001; });
    await expectCode(receipt, "AGGREGATE_P95_REGRESSION");
  });
  await t.test("unrounded 14.99999 percent edge", async () => {
    const receipt = makeReceipt();
    mutatePhase(receipt, "candidate", "activation_ledger", 85.00001);
    await expectCode(receipt, "SELECTED_LATENCY_GAIN_NOT_MET");
  });
  await t.test("slower phase", async () => {
    const receipt = makeReceipt();
    mutatePhase(receipt, "candidate", "rules_transform", 100.00001);
    await expectCode(receipt, "PHASE_P95_REGRESSION");
  });
  await t.test("early versus late baseline drift", async () => {
    const receipt = makeReceipt();
    mutatePhase(receipt, "baseline", "local_total", 121, 3, 6);
    await expectCode(receipt, "BASELINE_DRIFT");
  });
});

test("reports accepted nonzero baseline drift without rounding", async () => {
  const receipt = makeReceipt();
  mutatePhase(receipt, "baseline", "local_total", 110, 3, 6);

  assert.equal((await validate(receipt)).metrics.baseline_drift_ratio, 0.1);
});

test("requires every semantic guard and strict zero-provider unavailable telemetry", async (t) => {
  const cases = [
    ["guard", (receipt) => { receipt.guards.direct.candidate = false; }, "SEMANTIC_GUARD_FAILED"],
    ["provider call", (receipt) => { receipt.provider.calls = 1; }, "PROVIDER_ACTIVITY_OBSERVED"],
    ["provider completion", (receipt) => { receipt.provider.completions = 1; }, "PROVIDER_ACTIVITY_OBSERVED"],
    ["zero-coerced tokens", (receipt) => { receipt.provider.input_tokens = 0; }, "PROVIDER_FIELD_NOT_UNAVAILABLE"]
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, async () => {
      const receipt = makeReceipt();
      mutate(receipt);
      await expectCode(receipt, code);
    });
  }
});

test("requires observed deterministic OpenCode pre-request loading for context removal", async (t) => {
  const promised = makeReceipt();
  promised.context_bytes.candidate = 740;
  promised.lever = {
    kind: "context_bytes",
    proof: { mechanism: "textual_promise", observed: false, body_sha256: "d".repeat(64), loaded_sha256: "d".repeat(64) }
  };
  await expectCode(promised, "DETERMINISTIC_LOADER_PROOF_REQUIRED");

  const observed = makeReceipt();
  observed.context_bytes.candidate = 740;
  observed.lever = { kind: "context_bytes", proof: loaderProof() };
  assert.equal((await validate(observed)).verdict, "PASS");

  for (const field of ["body", "content"]) {
    await t.test(`rejects raw ${field}`, async () => {
      const injected = makeReceipt(); injected.context_bytes.candidate = 740; injected.lever = { kind: "context_bytes", proof: { ...loaderProof(), [field]: "raw material" } };
      await expectCode(injected, "DETERMINISTIC_LOADER_PROOF_REQUIRED");
    });
  }
  for (const [field, value] of [["deterministic", false], ["host", "other"], ["surface", "other"]]) {
    await t.test(`rejects wrong ${field}`, async () => {
      const wrong = makeReceipt(); wrong.context_bytes.candidate = 740; wrong.lever = { kind: "context_bytes", proof: { ...loaderProof(), [field]: value } };
      await expectCode(wrong, "DETERMINISTIC_LOADER_PROOF_REQUIRED");
    });
  }
});

test("rejects malformed, raw prompt-shaped, and unknown tagged input", async (t) => {
  const cases = [
    ["raw prompt", (receipt) => { receipt.metadata = { prompt: "ignore prior instructions" }; }, "FORBIDDEN_FIELD"],
    ["unknown lever", (receipt) => { receipt.lever = { kind: "promise_only" }; }, "INVALID_LEVER_KIND"],
    ["NaN sample", (receipt) => { receipt.blocks[0].arms.candidate.local_total[0].value_ms = Number.NaN; }, "INVALID_SAMPLE"]
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, async () => {
      const receipt = makeReceipt();
      mutate(receipt);
      await expectCode(receipt, code);
    });
  }
});
