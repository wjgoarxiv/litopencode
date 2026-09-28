#!/usr/bin/env node
// Replacement real-surface QA: the negative gate matrix.
//
// Every row is exercised against the runtime this package actually ships. The
// Design Contract and Visual QA rows run the installed `uiux.mjs` and
// `visual-qa.mjs` out of an isolated temporary OpenCode root, the integrity rows
// run the shipped `litopencode doctor`, and the payload row runs the shipped
// pack guard. Nothing is reimplemented here.
//
// Two rows diverge from the shorthand in the standing matrix. That shorthand
// says FAIL where this runtime, by its own documented vocabulary, answers with a
// BLOCKED_* code because a blocked capability outranks a failed check. Those
// rows carry both tokens: `expected=` is the outcome the shipped contract
// requires and `standing-matrix=` is the shorthand it diverges from. They are
// never silently rewritten.
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { boundedCjkBox, buildEvidenceBundle, buildValidSmokeEvidenceBundle, rgbaPng, validDesignContract, validReviewReceipt } from "./qa-real-surface-fixtures.mjs";
import {
  CleanupLedger,
  assertBuiltRuntime,
  formatRow,
  installIntoIsolatedRoot,
  isolatedEnv,
  repoRoot,
  runNode,
  tamperRestoreProbe
} from "./qa-real-surface-harness.mjs";

const blockedOutranksFail = "blocked-outranks-fail";
const divergenceReasons = Object.freeze({
  [blockedOutranksFail]:
    "the standing matrix says FAIL, but this runtime answers with a BLOCKED_* code because a blocked capability outranks a failed check"
});

// The standing matrix in row order. Emitting in this order and refusing to run
// with a row missing is what keeps a row from being silently dropped.
const standingMatrixOrder = Object.freeze([
  "valid-design-contract",
  "malformed-duplicate-key-contract",
  "valid-evidence-bundle",
  "missing-capture",
  "stale-evidence",
  "future-dated-evidence",
  "auth-unavailable",
  "renderer-ownership-unverified",
  "capture-bytes-changed-after-manifest",
  "incomplete-cleanup",
  "same-context-self-review",
  "reviewer-unavailable",
  "unsafe-test-account",
  "bounded-png-tui-cjk",
  "tampered-installed-resource",
  "restored-installed-resource",
  "forbidden-package-paths"
]);

function parseArgs(argv) {
  const options = { injectWrongExpectation: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--inject-wrong-expectation") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--inject-wrong-expectation requires a row id");
      options.injectWrongExpectation = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown option: ${flag}`);
  }
  return options;
}

function jsonCli(scriptPath, operation, payload, env) {
  const result = runNode(scriptPath, [operation], { input: JSON.stringify(payload), env });
  if (result.status !== 0) {
    return { exitCode: result.status, error: result.stderr.trim() };
  }
  return { exitCode: 0, value: JSON.parse(result.stdout) };
}

// Reduces a validator answer to a single outcome token: its first code when it
// reports one, otherwise its verdict.
function outcome(value) {
  const codes = value.codes ?? (value.code === undefined ? [] : [value.code]);
  return codes.length === 0 ? value.verdict ?? "UNKNOWN" : codes[0];
}

function cliOutcome(result) {
  if (result.error !== undefined) return `CLI_ERROR(${result.error})`;
  return outcome(result.value);
}

async function designContractRows(record, uiuxScript, env) {
  const contract = validDesignContract();
  const valid = runNode(uiuxScript, ["validate"], { input: JSON.stringify(contract), env });
  record({
    id: "valid-design-contract",
    matrix: "PASS",
    expected: "PASS",
    observed: valid.status === 0 && JSON.parse(valid.stdout).valid === true ? "PASS" : "FAIL",
    detail: `exit=${valid.status}`
  });

  const duplicateKeyText = JSON.stringify(contract).replace(
    '"contract_id":',
    '"contract_id":"contract:shadow","contract_id":'
  );
  const duplicate = runNode(uiuxScript, ["validate"], { input: duplicateKeyText, env });
  const ruleBreaking = { ...contract, schema_id: "litfamily.design-contract/v0" };
  const malformed = runNode(uiuxScript, ["validate"], { input: JSON.stringify(ruleBreaking), env });
  const duplicateRejected = duplicate.status === 2 && /duplicate key/iu.test(duplicate.stderr);
  const malformedRejected = malformed.status === 1 && JSON.parse(malformed.stdout).valid === false;
  record({
    id: "malformed-duplicate-key-contract",
    matrix: "FAIL",
    expected: "FAIL",
    observed: duplicateRejected && malformedRejected ? "FAIL" : "PASS",
    detail: `duplicate-key exit=${duplicate.status} rule-violation exit=${malformed.status}`
  });
}

async function evidenceBundleRows(record, visualQa, evidenceRoot) {
  const valid = buildValidSmokeEvidenceBundle(visualQa, evidenceRoot);
  const validResult = visualQa.evaluateEvidenceManifest(valid.manifest, valid.bundle);

  const sourceMismatch = buildEvidenceBundle(visualQa, evidenceRoot);
  sourceMismatch.designContract.source_hash = "f".repeat(64);
  sourceMismatch.manifest.design_contract_hash = visualQa.hashCanonicalValue(sourceMismatch.designContract);
  sourceMismatch.bundle.evidenceManifestBytes = visualQa.canonicalEvidenceManifestBytes(sourceMismatch.manifest);
  const sourceMismatchBlocked = visualQa.evaluateEvidenceManifest(
    sourceMismatch.manifest,
    sourceMismatch.bundle
  ).verdict === "BLOCKED";

  const reviewRequired = buildEvidenceBundle(visualQa, evidenceRoot);
  reviewRequired.designContract.evidence_policy.independent_review_required = true;
  reviewRequired.manifest.design_contract_hash = visualQa.hashCanonicalValue(reviewRequired.designContract);
  reviewRequired.bundle.evidenceManifestBytes = visualQa.canonicalEvidenceManifestBytes(reviewRequired.manifest);
  const reviewPolicyBlocked = outcome(visualQa.evaluateEvidenceManifest(
    reviewRequired.manifest,
    reviewRequired.bundle
  )) === "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE";

  const missingChannel = buildEvidenceBundle(visualQa, evidenceRoot);
  missingChannel.designContract.evidence_policy.required_channels.push("performance");
  missingChannel.manifest.design_contract_hash = visualQa.hashCanonicalValue(missingChannel.designContract);
  missingChannel.bundle.evidenceManifestBytes = visualQa.canonicalEvidenceManifestBytes(missingChannel.manifest);
  const channelBlocked = visualQa.evaluateEvidenceManifest(
    missingChannel.manifest,
    missingChannel.bundle
  ).verdict === "BLOCKED";

  const missingPointer = buildEvidenceBundle(visualQa, evidenceRoot);
  await fs.rm(path.join(evidenceRoot, missingPointer.manifest.mechanical_checks[0].evidence_path));
  const pointerBlocked = visualQa.evaluateEvidenceManifest(
    missingPointer.manifest,
    missingPointer.bundle
  ).verdict === "BLOCKED";

  const textBoundary = buildEvidenceBundle(visualQa, evidenceRoot);
  textBoundary.manifest.source_revision = "x".repeat(4096);
  const accepts4096 = visualQa.validateEvidenceManifest(textBoundary.manifest).valid;
  textBoundary.manifest.source_revision += "x";
  const rejects4097 = !visualQa.validateEvidenceManifest(textBoundary.manifest).valid;

  const nestedPath = buildEvidenceBundle(visualQa, evidenceRoot);
  nestedPath.manifest.captures[0].path = "nested/primary.png";
  const nestedBlocked = !visualQa.validateEvidenceManifest(nestedPath.manifest).valid;

  const unrelatedManifestBytes = buildEvidenceBundle(visualQa, evidenceRoot);
  unrelatedManifestBytes.bundle.evidenceManifestBytes = Buffer.from('{"unrelated":true}');
  const unrelatedBytesBlocked = outcome(visualQa.evaluateEvidenceManifest(
    unrelatedManifestBytes.manifest,
    unrelatedManifestBytes.bundle
  )) === "BLOCKED_IMMUTABLE_INPUT_MISMATCH";

  const notApplicableChannel = buildEvidenceBundle(visualQa, evidenceRoot);
  notApplicableChannel.manifest.accessibility_checks.find(
    (item) => item.channel === "keyboard"
  ).status = "not_applicable";
  notApplicableChannel.bundle.evidenceManifestBytes = visualQa.canonicalEvidenceManifestBytes(
    notApplicableChannel.manifest
  );
  const notApplicableBlocked = visualQa.evaluateEvidenceManifest(
    notApplicableChannel.manifest,
    notApplicableChannel.bundle
  ).missingChannels?.includes("keyboard") === true;

  const rootOnly = buildEvidenceBundle(visualQa, evidenceRoot);
  const rootOnlyBlocked = visualQa.evaluateEvidenceManifest(rootOnly.manifest, {
    now: rootOnly.bundle.now,
    designContract: rootOnly.bundle.designContract,
    evidenceManifestBytes: rootOnly.bundle.evidenceManifestBytes,
    reviewReceipts: rootOnly.bundle.reviewReceipts,
    sourceBytes: rootOnly.bundle.sourceBytes,
    evidenceRoot
  }).verdict === "BLOCKED";

  const boundaryCoverage = sourceMismatchBlocked && reviewPolicyBlocked && channelBlocked &&
    pointerBlocked && accepts4096 && rejects4097 && nestedBlocked && unrelatedBytesBlocked &&
    notApplicableBlocked && rootOnlyBlocked;
  record({
    id: "valid-evidence-bundle",
    matrix: "PASS",
    expected: "PASS",
    observed: validResult.verdict === "PASS" && boundaryCoverage ? "PASS" : "FAIL",
    detail: `beta-material=true source=${sourceMismatchBlocked} review=${reviewPolicyBlocked} ` +
      `channels=${channelBlocked} pointers=${pointerBlocked} text4096/4097=${accepts4096}/${rejects4097} ` +
      `nested=${nestedBlocked} canonical-bytes=${unrelatedBytesBlocked} not-applicable=${notApplicableBlocked} ` +
      `descriptor-only=${rootOnlyBlocked}`
  });

  const missingCapture = buildEvidenceBundle(visualQa, evidenceRoot);
  missingCapture.manifest.capabilities.capture = false;
  record({
    id: "missing-capture",
    matrix: "FAIL or explicit BLOCKED",
    expected: "BLOCKED_RENDERER_UNAVAILABLE",
    observed: outcome(visualQa.evaluateEvidenceManifest(missingCapture.manifest, missingCapture.bundle)),
    detail: "capabilities.capture=false"
  });

  // The manifest is hashed while the capture bytes say one thing and evaluated
  // after those bytes changed, which is exactly the post-manifest tamper case.
  const tamperedCapture = buildEvidenceBundle(visualQa, evidenceRoot);
  await fs.writeFile(
    path.join(evidenceRoot, tamperedCapture.manifest.captures[0].path),
    Buffer.from("qa-real-surface capture bytes -- mutated after the manifest was written")
  );
  record({
    id: "capture-bytes-changed-after-manifest",
    matrix: "FAIL",
    expected: "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH",
    divergence: blockedOutranksFail,
    observed: outcome(visualQa.evaluateEvidenceManifest(tamperedCapture.manifest, tamperedCapture.bundle)),
    detail: "capture bytes mutated after hashing"
  });

  const incompleteCleanup = buildEvidenceBundle(visualQa, evidenceRoot);
  incompleteCleanup.manifest.cleanup = {
    owned_processes_stopped: false,
    temporary_artifacts_removed: false,
    remaining: ["renderer pid 4242", "/tmp/qa-capture-scratch"]
  };
  incompleteCleanup.bundle.evidenceManifestBytes = visualQa.canonicalEvidenceManifestBytes(
    incompleteCleanup.manifest
  );
  record({
    id: "incomplete-cleanup",
    matrix: "BLOCKED_CLEANUP_INCOMPLETE",
    expected: "BLOCKED_CLEANUP_INCOMPLETE",
    observed: outcome(visualQa.evaluateEvidenceManifest(incompleteCleanup.manifest, incompleteCleanup.bundle)),
    detail: "cleanup.remaining is non-empty"
  });
}

function capabilityRows(record, visualQaScript, env) {
  const freshInput = {
    createdAt: "2026-07-24T00:00:00.000Z",
    maximumAgeSeconds: 600,
    expectedSourceHash: `sha256:${"1".repeat(64)}`,
    actualSourceHash: `sha256:${"1".repeat(64)}`,
    expectedCaptureHash: `sha256:${"2".repeat(64)}`,
    actualCaptureHash: `sha256:${"2".repeat(64)}`
  };
  record({
    id: "stale-evidence",
    matrix: "BLOCKED_EVIDENCE_STALE",
    expected: "BLOCKED_EVIDENCE_STALE",
    observed: cliOutcome(jsonCli(visualQaScript, "freshness", { ...freshInput, now: "2026-07-24T00:10:01.000Z" }, env)),
    detail: "601s past a 600s maximum age"
  });
  record({
    id: "future-dated-evidence",
    matrix: "BLOCKED_EVIDENCE_FUTURE",
    expected: "BLOCKED_EVIDENCE_FUTURE",
    observed: cliOutcome(jsonCli(visualQaScript, "freshness", { ...freshInput, now: "2026-07-23T23:59:00.000Z" }, env)),
    detail: "capture dated after the assessment moment"
  });

  const ready = { captureAvailable: true, authAvailable: true, testAccountSafe: true, independentReviewAvailable: true };
  record({
    id: "auth-unavailable",
    matrix: "BLOCKED_AUTH_UNAVAILABLE",
    expected: "BLOCKED_AUTH_UNAVAILABLE",
    observed: cliOutcome(jsonCli(visualQaScript, "capabilities", { ...ready, authAvailable: false }, env)),
    detail: "capabilities operation"
  });
  record({
    id: "unsafe-test-account",
    matrix: "BLOCKED_TEST_ACCOUNT_UNSAFE",
    expected: "BLOCKED_TEST_ACCOUNT_UNSAFE",
    observed: cliOutcome(jsonCli(visualQaScript, "capabilities", { ...ready, testAccountSafe: false }, env)),
    detail: "capabilities operation"
  });
  record({
    id: "renderer-ownership-unverified",
    matrix: "BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED",
    expected: "BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED",
    observed: cliOutcome(jsonCli(visualQaScript, "ownership", {
      projectRoot: repoRoot,
      pid: 4242,
      command: "qa-renderer",
      port: 4173,
      sessionScoped: true
    }, env)),
    detail: "sessionId is unproven"
  });
}

function reviewRows(record, visualQaScript, env) {
  const first = validReviewReceipt({ id: "review/a", reviewer: "reviewer-a", context: "shared-context", capability: "product-inspection" });
  const second = validReviewReceipt({ id: "review/b", reviewer: "reviewer-b", context: "shared-context", capability: "accessibility-inspection" });
  const selfReview = jsonCli(visualQaScript, "review", [first, second], env);
  record({
    id: "same-context-self-review",
    matrix: "FAIL",
    expected: "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
    divergence: blockedOutranksFail,
    observed: cliOutcome(selfReview),
    detail: `reason=${selfReview.value?.reason ?? "none"}`
  });

  const lone = jsonCli(visualQaScript, "review", [validReviewReceipt({ id: "review/only", reviewer: "reviewer-a" })], env);
  record({
    id: "reviewer-unavailable",
    matrix: "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
    expected: "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
    observed: cliOutcome(lone),
    detail: `reason=${lone.value?.reason ?? "none"}`
  });
}

function boundedRenderingRow(record, visualQaScript, env) {
  const png = jsonCli(visualQaScript, "png", {
    base64: rgbaPng(2, 2, [
      255, 255, 255, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 255, 255, 255, 255
    ]).toString("base64")
  }, env);
  const asciiTui = jsonCli(visualQaScript, "tui", { text: "status: ready\nqueue: 0" }, env);
  const cjkTui = jsonCli(visualQaScript, "tui", { text: boundedCjkBox }, env);

  const pngOk = png.value?.ok === true && png.value.width === 2 && png.value.height === 2;
  const asciiOk = asciiTui.value?.findings.length === 0;
  const cjkRows = cjkTui.value?.rows ?? [];
  const cjkOk =
    cjkTui.value?.findings.length === 0 &&
    cjkRows.length === 3 &&
    cjkRows.every((row) => row.width === 6);

  record({
    id: "bounded-png-tui-cjk",
    matrix: "PASS",
    expected: "PASS",
    observed: pngOk && asciiOk && cjkOk ? "PASS" : "FAIL",
    detail: `png=${pngOk} tui=${asciiOk} cjk=${cjkOk} cjk_row_widths=${cjkRows.map((row) => row.width).join(",")}`
  });
}

async function integrityRows(record, openCodeRoot, homeDir) {
  const probe = await tamperRestoreProbe(openCodeRoot, homeDir);
  record({
    id: "tampered-installed-resource",
    matrix: "doctor/integrity FAIL",
    expected: "FAIL",
    observed: probe.tampered.ok === false && probe.tampered.invalidAssets.length > 0 ? "FAIL" : "PASS",
    detail: `invalidAssets=${probe.tampered.invalidAssets.join(",") || "none"}`
  });
  record({
    id: "restored-installed-resource",
    matrix: "PASS",
    expected: "PASS",
    observed: probe.restored.ok === true && probe.restored.invalid.length === 0 ? "PASS" : "FAIL",
    detail: `sha256_restored=${probe.restoredSha256 === probe.originalSha256}`
  });
  return probe;
}

function forbiddenPackagePathsRow(record) {
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (pack.status !== 0) {
    record({
      id: "forbidden-package-paths",
      matrix: "0",
      expected: "0",
      observed: "UNEXERCISED",
      unexercised: true,
      detail: `npm pack --dry-run exited ${pack.status}: ${(pack.stderr ?? "").trim().slice(0, 200)}`
    });
    return;
  }
  const guard = runNode(path.join(repoRoot, "tools", "check-pack-payload.mjs"), ["--stdin"], { input: pack.stdout });
  const passed = /pack payload guard passed: (\d+) files? checked/u.exec(guard.stdout);
  const failed = /pack payload guard failed: (\d+) forbidden/u.exec(guard.stdout);
  record({
    id: "forbidden-package-paths",
    matrix: "0",
    expected: "0",
    observed: passed !== null ? "0" : failed !== null ? failed[1] : "UNEXERCISED",
    ...(passed === null && failed === null ? { unexercised: true } : {}),
    detail: passed !== null ? `${passed[1]} payload files checked` : guard.stdout.trim().split("\n")[0]
  });
}

// The single comparator every row and the negative control share. A mismatch on
// a row that never ran is BLOCKED with its reason; a mismatch on a row that ran
// and answered differently is FAIL.
function rowStatus(row, expected) {
  if (row.observed === expected) return "PASS";
  if (row.unexercised === true || String(row.observed).startsWith("CLI_ERROR")) return "BLOCKED";
  return "FAIL";
}

// The negative control proves the comparator itself can fail. It feeds a real
// observed outcome and a deliberately wrong expectation through the same
// rowStatus used by every matrix row.
function negativeControl(rows) {
  const sample = rows.find((row) => row.status === "PASS");
  if (sample === undefined) return { detected: false, reason: "no passing row to invert" };
  const injectedExpectation = `${sample.expected}_DELIBERATELY_WRONG`;
  const status = rowStatus(sample, injectedExpectation);
  return { detected: status !== "PASS", row: sample.id, injectedExpectation, observed: sample.observed, status };
}

async function main() {
  assertBuiltRuntime();
  const options = parseArgs(process.argv.slice(2));
  const ledger = new CleanupLedger();
  const rows = [];
  const record = (row) => {
    const expected = options.injectWrongExpectation === row.id ? `${row.expected}_DELIBERATELY_WRONG` : row.expected;
    rows.push({ ...row, expected, status: rowStatus(row, expected) });
  };

  try {
    const { sandbox, openCodeRoot, homeDir } = await installIntoIsolatedRoot(ledger);
    const env = isolatedEnv(homeDir);
    const uiuxScript = path.join(openCodeRoot, "skills", "frontend-ui-ux", "scripts", "uiux.mjs");
    const visualQaScript = path.join(openCodeRoot, "skills", "visual-qa", "scripts", "visual-qa.mjs");
    const visualQa = await import(pathToFileURL(visualQaScript).href);

    for (const script of [uiuxScript, visualQaScript]) {
      const stat = await fs.lstat(script);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`installed CLI is not a regular file: ${script}`);
    }

    await designContractRows(record, uiuxScript, env);
    await evidenceBundleRows(record, visualQa, path.join(sandbox, "evidence"));
    capabilityRows(record, visualQaScript, env);
    reviewRows(record, visualQaScript, env);
    boundedRenderingRow(record, visualQaScript, env);
    await integrityRows(record, openCodeRoot, homeDir);
    forbiddenPackagePathsRow(record);
  } finally {
    await ledger.removeAll();
  }

  for (const id of standingMatrixOrder) {
    if (rows.some((row) => row.id === id)) continue;
    rows.push({
      id,
      expected: "any",
      observed: "UNEXERCISED",
      unexercised: true,
      status: "BLOCKED",
      detail: "the driver produced no result for this standing-matrix row"
    });
  }
  rows.sort((left, right) => standingMatrixOrder.indexOf(left.id) - standingMatrixOrder.indexOf(right.id));

  process.stdout.write("NEGATIVE GATE MATRIX (replacement real-surface QA)\n");
  rows.forEach((row, index) => process.stdout.write(`${formatRow(index, row)}\n`));

  const control = negativeControl(rows);
  process.stdout.write(
    `NEGATIVE-CONTROL row=${control.row ?? "none"} injected-expected=${control.injectedExpectation ?? "none"} ` +
    `observed=${control.observed ?? "none"} mismatch-detected=${control.detected ? "YES" : "NO"}\n`
  );

  const divergent = rows.filter((row) => row.divergence !== undefined);
  for (const row of divergent) {
    process.stdout.write(
      `MATRIX-DIVERGENCE ${row.id} standing-matrix=${row.matrix} shipped-contract=${row.expected}: ` +
      `${divergenceReasons[row.divergence] ?? row.divergence}\n`
    );
  }
  process.stdout.write(`${ledger.render("negative-gate-matrix")}\n`);

  const failedRows = rows.filter((row) => row.status !== "PASS");
  process.stdout.write(
    `SUMMARY rows=${rows.length} passing=${rows.length - failedRows.length} not-passing=${failedRows.length} ` +
    `divergences=${divergent.length} cleanup-incomplete=${ledger.incomplete.length}\n`
  );
  if (failedRows.length > 0 || !control.detected || ledger.incomplete.length > 0) {
    process.stdout.write("NEGATIVE GATE MATRIX FAILED\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("NEGATIVE GATE MATRIX PASSED\n");
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`NEGATIVE_GATE_MATRIX_ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
