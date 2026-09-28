import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { litOpenCodeCommands } from "../src/commands.ts";
import { findLitOpenCodeFeature } from "../src/features.ts";
import { litOpenCodeRuntimeSkills } from "../src/skills.ts";
import { install } from "../src/cli/install.ts";
import { packageId, withTempDir } from "../test-support/cli-fixture.ts";
import { seedPackedRuntimeDependencies } from "../test-support/packed-runtime-dependencies.mjs";

test("deep-interview is enrolled across source catalogs and command routing", () => {
  const skill = litOpenCodeRuntimeSkills.find((candidate) => candidate.id === "deep-interview");
  assert.ok(skill, "deep-interview runtime skill should be catalogued");
  assert.ok(skill.featureIds.includes("deep-interview"));

  const feature = findLitOpenCodeFeature("deep-interview");
  assert.ok(feature, "deep-interview feature should be catalogued");
  assert.ok(feature.bindings.some((binding) => binding.kind === "command" && binding.id === "deep-interview"));
  assert.ok(feature.bindings.some((binding) => binding.kind === "hook" && binding.id === "chat.message"));

  const command = litOpenCodeCommands.find((candidate) => candidate.id === "deep-interview");
  assert.ok(command, "/deep-interview should be a command alias");
  assert.equal(command.agent, "lit-plan");
  assert.match(command.activationText, /deep-interview/iu);
  assert.match(command.activationText, /planning-only/iu);
});
test("deep-interview native installer writes its visible static skill and command alias", async () => {
  await withTempDir(async (dir) => {
    const result = await install(dir, false, undefined, "never", "safe", false, "never");
    assert.equal(result.exitCode, 0, result.stderr);
    await fs.access(path.join(dir, "skills", "deep-interview", "SKILL.md"));
    await fs.access(path.join(dir, "command", "deep-interview.md"));

    const skill = await fs.readFile(path.join(dir, "skills", "deep-interview", "SKILL.md"), "utf8");
    const command = await fs.readFile(path.join(dir, "command", "deep-interview.md"), "utf8");
    assert.match(skill, /name: deep-interview/iu);
    assert.match(skill, /planning-only/iu);
    assert.match(command, /agent: lit-plan/iu);
  });
});

test("deep-interview packed payload preserves catalog, command, and skill surfaces", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-deep-interview-pack-"));
  try {
    const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", dir], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(pack.status, 0, pack.stderr);
    const version = JSON.parse(fsSync.readFileSync(path.resolve("package.json"), "utf8")).version;
    const archive = path.join(dir, `litfamily-litopencode-${version}.tgz`);
    const extract = spawnSync("tar", ["-xzf", archive, "-C", dir], { encoding: "utf8" });
    assert.equal(extract.status, 0, extract.stderr);

    const packageDir = path.join(dir, "package");
    await seedPackedRuntimeDependencies(packageDir);
    const packed = await import(pathToFileURL(path.join(packageDir, "dist", "index.js")).href);
    assert.ok(packed.litOpenCodeRuntimeSkills.some((skill) => skill.id === "deep-interview"));
    assert.ok(packed.litOpenCodeFeatures.some((feature) => feature.id === "deep-interview"));
    assert.ok(packed.litOpenCodeCommands.some((command) => command.id === "deep-interview"));
    await fs.access(path.join(packageDir, "skills", "deep-interview", "SKILL.md"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
