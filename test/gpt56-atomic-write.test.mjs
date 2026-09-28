import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("atomic config write preserves the target and cleans its temp file when rename fails", async () => {
  // Given: an existing config and an injected rename failure.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-atomic-"));
  try {
    const target = path.join(dir, "litopencode.json");
    await fs.writeFile(target, "before\n");
    const installConfig = await import("../src/cli/install-config.ts");
    assert.equal(typeof installConfig.writeTextAtomically, "function");
    let attemptedTempPath;

    // When: the atomic replacement reaches rename and the host reports an interruption.
    await assert.rejects(
      installConfig.writeTextAtomically(target, "after\n", {
        async rename(from) {
          attemptedTempPath = from;
          throw new Error("simulated rename interruption");
        }
      }),
      /simulated rename interruption/
    );

    // Then: the previous bytes survive and no task-created temp file remains.
    assert.equal(await fs.readFile(target, "utf8"), "before\n");
    assert.equal(typeof attemptedTempPath, "string");
    await assert.rejects(fs.access(attemptedTempPath), { code: "ENOENT" });
    assert.deepEqual((await fs.readdir(dir)).sort(), ["litopencode.json"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
