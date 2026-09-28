import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createGoals,
  readEvidenceLedger,
  recordEvidence
} from "../../src/index.ts";
import { createRuntimePaths } from "../../src/state.ts";

async function withProject(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-evidence-stress-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  }
}

async function seedGoal(dir) {
  return await createGoals(dir, {
    sessionId: "s1",
    objective: "prove the ledger",
    criteria: ["the CLI writes goals.json", "a retry keeps prior evidence"],
    now: "2026-01-01T00:00:00.000Z"
  });
}

test("40 concurrent evidence mutations preserve every state entry and matching audit event", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const refs = Array.from({ length: 40 }, (_, index) => `concurrent-${index}`);

    await Promise.all(refs.map((ref) => recordEvidence(dir, { criterionId: "C1", kind: "note", ref })));

    const state = await readEvidenceLedger(dir);
    const recordedRefs = state.goals[0].criteria[0].evidence.map((entry) => entry.ref);
    assert.deepEqual(new Set(recordedRefs), new Set(refs));
    assert.equal(recordedRefs.length, refs.length);
    const paths = createRuntimePaths(dir);
    const events = (await fs.readFile(paths.ledgerFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((event) => event.type === "evidence.recorded" && refs.includes(event.ref));
    assert.equal(events.length, refs.length);
    assert.deepEqual(new Set(events.map((event) => event.ref)), new Set(refs));
  });
});
