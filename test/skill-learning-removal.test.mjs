import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createToolExecuteAfterHook } from "../src/hooks.ts";
import { runCli } from "../src/cli.ts";
import { litOpenCodeCommands } from "../src/commands.ts";
import { litOpenCodeFeatures } from "../src/features.ts";
import { litOpenCodeRuntimeSkills } from "../src/skills.ts";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("skill-learning routes, runtime, and package resources are absent", async () => {
  assert.equal(litOpenCodeRuntimeSkills.some(({ id }) => id === "skill-observer"), false);
  assert.equal(litOpenCodeFeatures.some(({ id }) => id === "skill-observer"), false);
  assert.equal(litOpenCodeCommands.some(({ id }) => id === "skill-observer"), false);
  assert.doesNotMatch((await runCli(["help"])).stdout, /skill-loop|skill-curator|skill-observer/);
  assert.notEqual((await runCli(["skill-loop", "list"])).exitCode, 0);
  assert.notEqual((await runCli(["skill-curator", "status"])).exitCode, 0);
  for (const resource of ["../src/skill-observer.ts", "../src/skill-loop", "../skills/skill-observer"]) {
    await assert.rejects(readdir(new URL(resource, import.meta.url)));
  }
  const manifest = JSON.parse(await readFile(new URL("../skills/managed-skill-manifest.json", import.meta.url), "utf8"));
  assert.equal(Object.hasOwn(manifest.skills, "skill-observer"), false);
});

test("the actual tool-after hook creates no skill-learning state and leaves stale files byte-identical", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "litopencode-skill-learning-removal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = path.join(root, ".litopencode");
  await mkdir(runtime);
  const stale = new Map([
    ["pending-review.json", Buffer.from('{"schema":"stale-review"}\n')],
    ["skill-loop-state.json", Buffer.from('{"schema":"stale-loop"}\n')],
    ["skill-ledger.jsonl", Buffer.from('{"schema":"stale-ledger"}\n')]
  ]);
  for (const [name, bytes] of stale) await writeFile(path.join(runtime, name), bytes);
  const before = new Map([...stale].map(([name, bytes]) => [name, digest(bytes)]));

  const hook = createToolExecuteAfterHook({ projectRoot: root });
  const input = { tool: "read", sessionID: "removal-proof", callID: "call-1", args: {} };
  const output = { output: "tool result", metadata: {} };
  await hook(input, output);

  assert.equal(output.output, "tool result");
  assert.equal(JSON.stringify(output.metadata), "{}");
  for (const [name, expected] of before) {
    assert.equal(digest(await readFile(path.join(runtime, name))), expected, `${name} changed`);
  }
  assert.deepEqual((await readdir(runtime)).sort(), [...stale.keys()].sort());
});
