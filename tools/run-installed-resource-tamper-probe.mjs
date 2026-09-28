#!/usr/bin/env node
// Replacement real-surface QA: installed-resource tamper and repair.
//
// Installs this working tree into an isolated temporary OpenCode root, proves
// the shipped doctor reports clean integrity, corrupts one pinned managed asset
// by a single byte, proves doctor names that exact asset and fails, restores the
// original bytes, proves doctor passes again, then removes the temporary root
// and prints a cleanup receipt. No live profile is read or written.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CleanupLedger,
  assertBuiltRuntime,
  installIntoIsolatedRoot,
  tamperRestoreProbe,
  tamperTargetRelativePath
} from "./qa-real-surface-harness.mjs";

function stage(label, expectation, actual, detail) {
  const ok = expectation === actual;
  process.stdout.write(`TAMPER ${label.padEnd(26)} expected=${expectation} observed=${actual} status=${ok ? "PASS" : "FAIL"} detail=${detail}\n`);
  return ok;
}

async function main() {
  assertBuiltRuntime();
  const ledger = new CleanupLedger();
  let probe;
  try {
    const { openCodeRoot, homeDir } = await installIntoIsolatedRoot(ledger);
    process.stdout.write(`TAMPER isolated-root ${openCodeRoot}\n`);
    process.stdout.write(`TAMPER pinned-resource ${tamperTargetRelativePath}\n`);
    probe = await tamperRestoreProbe(openCodeRoot, homeDir);
  } finally {
    await ledger.removeAll();
  }

  const namesTamperedAsset = probe.tampered.invalidAssets.includes("visual-qa/schemas/evidence-manifest-v1alpha1.json");
  const results = [
    stage("clean-install-integrity", "PASS", probe.clean.ok ? "PASS" : "FAIL", `invalid=${probe.clean.invalid.length}`),
    stage("tampered-integrity", "FAIL", probe.tampered.ok ? "PASS" : "FAIL", `invalidAssets=${probe.tampered.invalidAssets.join(",") || "none"}`),
    stage("tampered-names-asset", "PASS", namesTamperedAsset ? "PASS" : "FAIL", "doctor must name the corrupted pinned asset"),
    stage("restored-integrity", "PASS", probe.restored.ok ? "PASS" : "FAIL", `invalid=${probe.restored.invalid.length}`),
    stage("restored-bytes-identical", "PASS", probe.originalSha256 === probe.restoredSha256 ? "PASS" : "FAIL", `sha256=${probe.restoredSha256}`)
  ];

  process.stdout.write(`${ledger.render("installed-resource-tamper-probe")}\n`);
  if (results.some((ok) => !ok) || ledger.incomplete.length > 0) {
    process.stdout.write("INSTALLED RESOURCE TAMPER PROBE FAILED\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("INSTALLED RESOURCE TAMPER PROBE PASSED\n");
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`TAMPER_PROBE_ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
