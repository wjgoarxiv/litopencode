#!/usr/bin/env node
// Replacement real-surface QA: the negative gate matrix.
//
// Every row is exercised against the runtime this package actually ships: the
// integrity rows run the shipped `litopencode doctor` against an isolated
// temporary OpenCode root, and the payload row runs the shipped pack guard.
// Nothing is reimplemented here. The Design Contract and Visual QA rows left with
// frontend-ui-ux and visual-qa, which moved to wjgoarxiv-skills; their validators
// no longer ship here, so there is nothing of LitOpenCode's own for them to test.
//
// A row whose observed answer is a blocked capability rather than a failed check
// may carry a divergence note: `expected=` is the outcome the shipped contract
// requires and `standing-matrix=` is the shorthand it diverges from.
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CleanupLedger,
  assertBuiltRuntime,
  formatRow,
  installIntoIsolatedRoot,
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
    const { openCodeRoot, homeDir } = await installIntoIsolatedRoot(ledger);
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
