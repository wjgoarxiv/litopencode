import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  LedgerParseError,
  appendLedgerEvent,
  createLitGoalOperations,
  initializeLitGoal,
  readLedgerEvents,
  recoverLedgerTemps
} from "../src/ledger.ts";
import { createRuntimePaths } from "../src/state.ts";
import { createLitGoalOperations as exportedCreateLitGoalOperations } from "../src/index.ts";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-ledger-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("initializes durable litgoal and lit-loop ledger paths", async () => {
  await withTempDir(async (dir) => {
    // Given: a clean project root.
    const paths = createRuntimePaths(dir);

    // When: the durable goal loop is initialized.
    const initialized = await initializeLitGoal(dir);

    // Then: the expected directories and empty ledger exist.
    assert.equal(initialized.paths.ledgerFile, paths.ledgerFile);
    assert.equal(await fs.readFile(paths.ledgerFile, "utf8"), "");
    assert.equal((await fs.stat(paths.litGoalDir)).isDirectory(), true);
    assert.equal((await fs.stat(paths.litLoopDir)).isDirectory(), true);
  });
});

test("appends and reads JSONL ledger events atomically", async () => {
  await withTempDir(async (dir) => {
    // Given: an initialized durable ledger.
    await initializeLitGoal(dir);

    // When: multiple typed events are appended.
    await appendLedgerEvent(dir, { type: "goal.created", goalId: "alpha", active: true });
    await appendLedgerEvent(dir, { type: "loop.tick", count: 1, nested: { ok: true } });

    // Then: read returns events in ledger order.
    assert.deepEqual(await readLedgerEvents(dir), [
      { type: "goal.created", goalId: "alpha", active: true },
      { type: "loop.tick", count: 1, nested: { ok: true } }
    ]);
  });
});

test("preserves all events when appends happen concurrently", async () => {
  await withTempDir(async (dir) => {
    // Given: an initialized durable ledger and many independent event writers.
    await initializeLitGoal(dir);
    const expectedIds = Array.from({ length: 80 }, (_, index) => `event-${index}`);

    // When: all writers append at the same time.
    await Promise.all(expectedIds.map((eventId) => appendLedgerEvent(dir, { type: "loop.tick", eventId })));

    // Then: no append is lost.
    const events = await readLedgerEvents(dir);
    assert.equal(events.length, expectedIds.length);
    assert.deepEqual(new Set(events.map((event) => event.eventId)), new Set(expectedIds));
  });
});

test("recovers from partial temp files without treating them as ledger events", async () => {
  await withTempDir(async (dir) => {
    // Given: a partial atomic-write temp file next to a valid ledger.
    const paths = createRuntimePaths(dir);
    await initializeLitGoal(dir);
    await fs.writeFile(path.join(paths.litLoopDir, "ledger.jsonl.tmp-seeded"), "{ partial");

    // When: recovery runs before a normal append/read cycle.
    const recovery = await recoverLedgerTemps(dir);
    await appendLedgerEvent(dir, { type: "goal.resumed", goalId: "alpha" });

    // Then: the partial temp is removed and only durable ledger events are read.
    assert.deepEqual(recovery.removedTempFiles, ["ledger.jsonl.tmp-seeded"]);
    await assert.rejects(fs.stat(path.join(paths.litLoopDir, "ledger.jsonl.tmp-seeded")), { code: "ENOENT" });
    assert.deepEqual(await readLedgerEvents(dir), [{ type: "goal.resumed", goalId: "alpha" }]);
  });
});

test("rejects malformed event input without mutating the ledger", async () => {
  await withTempDir(async (dir) => {
    // Given: an empty initialized ledger.
    await initializeLitGoal(dir);

    // When: malformed event input is appended.
    await assert.rejects(appendLedgerEvent(dir, { goalId: "missing-type" }), LedgerParseError);
    await assert.rejects(appendLedgerEvent(dir, { type: "bad.undefined", value: undefined }), LedgerParseError);

    // Then: no partial or invalid event is persisted.
    assert.deepEqual(await readLedgerEvents(dir), []);
  });
});

test("fails closed when durable ledger lines are malformed", async () => {
  await withTempDir(async (dir) => {
    // Given: a ledger file with one valid line and one malformed JSON line.
    const paths = createRuntimePaths(dir);
    await initializeLitGoal(dir);
    await fs.writeFile(paths.ledgerFile, '{"type":"ok"}\n{ not-json }\n');

    // When/Then: reading fails instead of silently skipping corrupted durable data.
    await assert.rejects(readLedgerEvents(dir), LedgerParseError);
  });
});

test("exposes goal and loop operations through the public tool surface", async () => {
  await withTempDir(async (dir) => {
    // Given: the public operation factory exported from the plugin module.
    const operations = createLitGoalOperations(dir);
    const exportedOperations = exportedCreateLitGoalOperations(dir);

    // When: the operation surface initializes, appends, recovers, and reads.
    await operations.init();
    const appendResult = await exportedOperations.append({ type: "loop.started", source: "test" });
    const recovery = await exportedOperations.recover();

    // Then: callers can drive durable goal/loop behavior through the exported surface.
    assert.equal(typeof operations.init, "function");
    assert.equal(typeof operations.append, "function");
    assert.equal(typeof operations.read, "function");
    assert.equal(typeof operations.recover, "function");
    assert.equal(appendResult.event.type, "loop.started");
    assert.deepEqual(recovery.removedTempFiles, []);
    assert.deepEqual(await operations.read(), [{ type: "loop.started", source: "test" }]);
  });
});
