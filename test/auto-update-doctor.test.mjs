import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const autoUpdate = await import("../src/cli/auto-update.ts");
const { inspectAutoUpdate } = await import("../src/cli/doctor.ts");

async function withHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-auto-update-doctor-"));
  await fs.mkdir(path.join(home, ".litopencode"), { recursive: true, mode: 0o700 });
  try {
    await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function writeReceipt(home, fields) {
  const receipt = {
    schemaVersion: 1,
    status: "updated",
    reason: "plugin",
    currentVersion: "0.4.1",
    targetVersion: "0.4.2",
    spec: "@litfamily/litopencode@0.4.2",
    configRoot: path.join(home, "cfg"),
    startedAt: 1_000,
    finishedAt: 2_000,
    journalPath: autoUpdate.autoUpdateJournalPath(home),
    backupPath: path.join(home, ".litopencode", ".auto-update-backup-x"),
    backupRetained: false,
    priorStateVerified: true,
    stagedStateKnown: true,
    doctor: { ok: true },
    rollback: { ok: true },
    ...fields
  };
  await fs.writeFile(autoUpdate.autoUpdateReceiptPath(home), JSON.stringify(receipt) + "\n", { encoding: "utf8", mode: 0o600 });
}

const remedyCauses = ["next-start", "offline", "backoff", "timeout", "missing-command", "install-failed", "stopped", "lock-busy", "opted-out", "local-checkout"];

test("doctor reports an installed update that the running OpenCode has not loaded yet", async () => {
  await withHome(async (home) => {
    await writeReceipt(home, {});
    await autoUpdate.recordAutoUpdateCheck(home, "0.4.1", { status: "updated", currentVersion: "0.4.1", targetVersion: "0.4.2" });
    const report = await inspectAutoUpdate({ homeDir: home, env: {}, pinnedVersion: "0.4.2" });
    assert.equal(report.state, "next-start");
    assert.equal(report.cause, "next-start");
    assert.match(report.nextStart, /installed 0\.4\.2, running 0\.4\.1/u);
    assert.match(report.nextStart, /next time OpenCode starts/u);
    assert.match(report.proof, /cannot/u);
    assert.deepEqual(report.remedies.map((row) => row.cause), remedyCauses);
    for (const row of report.remedies) {
      assert.ok(row.meaning.length > 0 && row.remedy.length > 0, row.cause);
      assert.ok(row.remedy.length <= 200, `${row.cause} remedy stays short`);
    }
  });
});

test("doctor reports current once an OpenCode start ran the installed version", async () => {
  await withHome(async (home) => {
    await writeReceipt(home, {});
    await autoUpdate.recordAutoUpdateCheck(home, "0.4.2", { status: "skipped", reason: "up-to-date", currentVersion: "0.4.2", targetVersion: "0.4.2" });
    const report = await inspectAutoUpdate({ homeDir: home, env: {}, pinnedVersion: "0.4.2" });
    assert.equal(report.state, "current");
    assert.equal(report.cause, null);
    assert.equal(report.nextStart, null);
  });
});

test("doctor names the cause of a skipped or failed update from the last check and receipt", async () => {
  const cases = [
    ["offline", undefined, { status: "skipped", reason: "registry-unavailable" }],
    ["lock-busy", undefined, { status: "skipped", reason: "install-lock-busy" }],
    ["local-checkout", undefined, { status: "skipped", reason: "local-checkout" }],
    ["opted-out", undefined, { status: "skipped", reason: "disabled" }],
    ["backoff", { status: "rolled-back", backupRetained: true, doctor: { ok: false }, failure: { step: "npm-install", timedOut: false, missingCommand: true } }, { status: "skipped", reason: "backoff" }],
    ["missing-command", { status: "rolled-back", backupRetained: true, doctor: { ok: false }, failure: { step: "npm-install", timedOut: false, missingCommand: true } }, { status: "rolled-back" }],
    ["timeout", { status: "rolled-back", backupRetained: true, doctor: { ok: false }, failure: { step: "install", timedOut: true, missingCommand: false } }, { status: "rolled-back" }],
    ["install-failed", { status: "rolled-back", backupRetained: true, doctor: { ok: false }, failure: { step: "doctor", timedOut: false, missingCommand: false } }, { status: "rolled-back" }],
    ["stopped", { status: "failed", backupRetained: true, priorStateVerified: false, rollback: { ok: false }, failure: { step: "install", timedOut: false, missingCommand: false } }, { status: "failed" }]
  ];
  for (const [cause, receipt, check] of cases) {
    await withHome(async (home) => {
      if (receipt !== undefined) await writeReceipt(home, receipt);
      await autoUpdate.recordAutoUpdateCheck(home, "0.4.1", { currentVersion: "0.4.1", targetVersion: "0.4.2", ...check });
      const report = await inspectAutoUpdate({ homeDir: home, env: {}, pinnedVersion: "0.4.1" });
      assert.equal(report.cause, cause, cause);
      assert.equal(report.state, "attention", cause);
      assert.equal(report.remedies.find((row) => row.cause === cause) !== undefined, true, cause);
    });
  }
});

test("doctor says opted out when its own environment switches automatic update off", async () => {
  await withHome(async (home) => {
    const report = await inspectAutoUpdate({ homeDir: home, env: { LITOPENCODE_NO_AUTO_UPDATE: "1" }, pinnedVersion: "0.4.1" });
    assert.equal(report.cause, "opted-out");
    assert.equal(report.enabled, false);
  });
});

test("doctor JSON carries the automatic-update report", async () => {
  const source = await fs.readFile(new URL("../src/cli/doctor.ts", import.meta.url), "utf8");
  assert.match(source, /autoUpdate: await inspectAutoUpdate\(/u);
});
