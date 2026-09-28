import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { litOpenCodeTools, readLedgerEventsLenient } from "../src/index.ts";
import { createRuntimePaths } from "../src/state.ts";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-lenient-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function createToolContext(dir) {
  return {
    sessionID: "lenient-status-session",
    messageID: "lenient-status-message",
    agent: "lit-loop",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {}
  };
}

test("readLedgerEventsLenient skips invalid lines and reports diagnostics", async () => {
  await withTempDir(async (dir) => {
    const paths = createRuntimePaths(dir);
    await fs.mkdir(paths.litLoopDir, { recursive: true });
    // One valid event, one legacy event (uses "event" key instead of "type"),
    // one empty-type event.
    await fs.writeFile(
      paths.ledgerFile,
      [
        '{"type":"goal.created","goalId":"G1"}',
        '{"event":"goal.started","goal":"test","evidence":"test evidence"}',
        '{"type":"","goalId":"G2"}',
        '{"type":"loop.tick","count":1}'
      ].join("\n") + "\n"
    );

    const result = await readLedgerEventsLenient(dir);

    assert.equal(result.events.length, 2);
    assert.equal(result.events[0].type, "goal.created");
    assert.equal(result.events[1].type, "loop.tick");
    assert.equal(result.skipped.length, 2);
    assert.equal(result.skipped[0].line, 2);
    assert.match(result.skipped[0].error, /non-empty string/);
    assert.equal(result.skipped[1].line, 3);
    assert.equal(result.filePath, paths.ledgerFile);
  });
});

test("lit tool status succeeds with diagnostic when ledger has invalid events", async () => {
  await withTempDir(async (dir) => {
    const paths = createRuntimePaths(dir);
    await fs.mkdir(paths.litLoopDir, { recursive: true });
    await fs.writeFile(
      paths.ledgerFile,
      [
        '{"type":"tool.lit.activated","sessionID":"s1"}',
        '{"event":"goal.started","goal":"test","evidence":"test evidence"}',
        '{"type":"loop.tick","count":1}'
      ].join("\n") + "\n"
    );

    const result = await litOpenCodeTools.lit.execute(
      { action: "status" },
      createToolContext(dir)
    );

    // Must not throw; must return valid events.
    assert.match(result.output, /tool\.lit\.activated/);
    assert.match(result.output, /loop\.tick/);
    // Must surface a bounded diagnostic about the skipped line.
    assert.match(result.output, /1 invalid ledger event/);
    assert.match(result.output, /non-empty string/);
    assert.equal(result.metadata.eventCount, 2);
    assert.equal(result.metadata.skippedCount, 1);
  });
});

test("litwork tool status succeeds with diagnostic when ledger has invalid events", async () => {
  await withTempDir(async (dir) => {
    const paths = createRuntimePaths(dir);
    await fs.mkdir(paths.litLoopDir, { recursive: true });
    await fs.writeFile(
      paths.ledgerFile,
      [
        '{"type":"tool.litwork.started","sessionID":"s1"}',
        '{"event":"criterion.passed","goal":"test","evidence":"e"}',
        '{"event":"criterion.failed","goal":"test","evidence":"e"}'
      ].join("\n") + "\n"
    );

    const result = await litOpenCodeTools.litwork.execute(
      { action: "status" },
      createToolContext(dir)
    );

    assert.match(result.output, /tool\.litwork\.started/);
    assert.match(result.output, /2 invalid ledger event/);
    assert.equal(result.metadata.eventCount, 1);
    assert.equal(result.metadata.skippedCount, 2);
  });
});

test("readLedgerEventsLenient returns empty diagnostics for a clean ledger", async () => {
  await withTempDir(async (dir) => {
    const paths = createRuntimePaths(dir);
    await fs.mkdir(paths.litLoopDir, { recursive: true });
    await fs.writeFile(paths.ledgerFile, '{"type":"ok","value":1}\n');

    const result = await readLedgerEventsLenient(dir);

    assert.equal(result.events.length, 1);
    assert.equal(result.skipped.length, 0);
  });
});

test("readLedgerEventsLenient handles malformed JSON lines gracefully", async () => {
  await withTempDir(async (dir) => {
    const paths = createRuntimePaths(dir);
    await fs.mkdir(paths.litLoopDir, { recursive: true });
    await fs.writeFile(
      paths.ledgerFile,
      '{"type":"ok"}\n{ not-json }\n'
    );

    const result = await readLedgerEventsLenient(dir);

    assert.equal(result.events.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].line, 2);
    assert.match(result.skipped[0].error, /Malformed ledger JSON/);
  });
});

test("strict readLedgerEvents still rejects malformed ledger lines", async () => {
  // Ensure the strict path is not weakened.
  const { readLedgerEvents, LedgerParseError } = await import("../src/ledger.ts");
  await withTempDir(async (dir) => {
    const paths = createRuntimePaths(dir);
    await fs.mkdir(paths.litLoopDir, { recursive: true });
    await fs.writeFile(
      paths.ledgerFile,
      '{"type":"ok"}\n{"event":"legacy","goal":"test","evidence":"e"}\n'
    );

    await assert.rejects(readLedgerEvents(dir), LedgerParseError);
  });
});
