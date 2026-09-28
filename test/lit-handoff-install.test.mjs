import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateManagedSkillSource } from "../src/cli/native-skills.ts";
import { packageId, runCli } from "../test-support/cli-fixture.ts";
import { withHandoffTempDir } from "../test-support/lit-handoff-fixture.mjs";

test("installer keeps the native handoff wrapper flat and doctor verifies the vendored source", async () => {
  await withHandoffTempDir(async (dir) => {
    const install = runCli(["install", "--root", dir]);
    assert.equal(install.status, 0, install.stderr);

    await assert.rejects(fs.stat(path.join(dir, "skills", "lit-handoff", "original")), { code: "ENOENT" });

    const firstDoctor = runCli(["doctor", "--root", dir]);
    assert.equal(firstDoctor.status, 0, firstDoctor.stderr);
    const firstReport = JSON.parse(firstDoctor.stdout);
    assert.equal(firstReport.install.plugin.expected, packageId);
    assert.deepEqual(firstReport.install.nativeSkills.invalid, []);

    assert.deepEqual(firstReport.install.nativeSkills.invalidAssets, []);
  });
});

test("source preflight rejects altered, extra, and symlinked handoff payload entries", async () => {
  await withHandoffTempDir(async (dir) => {
    const sourceRoot = path.join(dir, "skills", "lit-handoff");
    const metadata = { name: "litopencode", version: "test", packageRoot: dir };
    await fs.mkdir(path.dirname(sourceRoot), { recursive: true });
    await fs.cp(path.join("skills", "lit-handoff"), sourceRoot, { recursive: true });
    await fs.cp("vendor", path.join(dir, "vendor"), { recursive: true });
    await validateManagedSkillSource(metadata, "lit-handoff");

    const template = path.join(dir, "vendor", "handoff", "templates", "HANDOFF.md");
    const originalTemplate = await fs.readFile(template);
    await fs.writeFile(template, "altered\n");
    await assert.rejects(validateManagedSkillSource(metadata, "lit-handoff"), /SHA-256/);
    await fs.writeFile(template, originalTemplate);

    const extra = path.join(dir, "vendor", "handoff", "local.jsonl");
    await fs.writeFile(extra, "{}\n");
    await assert.rejects(validateManagedSkillSource(metadata, "lit-handoff"), /altered file set/);
    await fs.rm(extra);

    const target = path.join(dir, "outside-template.md");
    await fs.writeFile(target, originalTemplate);
    await fs.rm(template);
    await fs.symlink(target, template);
    await assert.rejects(validateManagedSkillSource(metadata, "lit-handoff"), /altered file set|symbolic link/);
  });
});

test("installer preserves and reports a pre-existing handoff directory without an entrypoint", async () => {
  await withHandoffTempDir(async (dir) => {
    const collisionDir = path.join(dir, "skills", "lit-handoff");
    const receipt = path.join(collisionDir, "user-notes.md");
    await fs.mkdir(collisionDir, { recursive: true });
    await fs.writeFile(receipt, "user-owned\n");

    const install = runCli(["install", "--root", dir]);
    assert.notEqual(install.status, 0);
    assert.equal(await fs.readFile(receipt, "utf8"), "user-owned\n");
    await assert.rejects(fs.stat(path.join(collisionDir, "SKILL.md")), { code: "ENOENT" });
    await assert.rejects(fs.stat(path.join(dir, "opencode.json")), { code: "ENOENT" });
    assert.match(install.stderr, /lit-handoff.*collision|collision.*lit-handoff/i);
  });
});

test("installer rejects a symlinked handoff destination without writing through it", async () => {
  await withHandoffTempDir(async (dir) => {
    const outside = path.join(dir, "outside");
    const skillsDir = path.join(dir, "skills");
    await fs.mkdir(outside);
    await fs.mkdir(skillsDir);
    await fs.symlink(outside, path.join(skillsDir, "lit-handoff"));

    const install = runCli(["install", "--root", dir]);
    assert.notEqual(install.status, 0);
    await assert.rejects(fs.stat(path.join(outside, "SKILL.md")), { code: "ENOENT" });
    assert.match(install.stderr, /symbolic link|symlink/i);
  });
});

test("installer accepts an intentional symlinked native skills root", async () => {
  await withHandoffTempDir(async (dir) => {
    // Given: OpenCode's global skills directory intentionally points at a shared skills directory.
    const root = path.join(dir, "config");
    const sharedSkills = path.join(dir, "shared-skills");
    await fs.mkdir(root);
    await fs.mkdir(sharedSkills);
    await fs.symlink(sharedSkills, path.join(root, "skills"));

    // When: LitOpenCode installs its managed native skills through the host-facing root.
    const install = runCli(["install", "--root", root]);

    // Then: installation succeeds, preserves the link, and doctor verifies the canonical target.
    assert.equal(install.status, 0, install.stderr);
    assert.equal(await fs.readlink(path.join(root, "skills")), sharedSkills);
    assert.match(await fs.readFile(path.join(sharedSkills, "lit-handoff", "SKILL.md"), "utf8"), /name: lit-handoff/);
    const doctor = runCli(["doctor", "--root", root]);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).install.nativeSkills.ok, true);
  });
});

test("installer preserves a user-owned lit-handoff collision", async () => {
  await withHandoffTempDir(async (dir) => {
    const custom = "---\nname: lit-handoff\n---\n# User-owned handoff\n";
    const entrypoint = path.join(dir, "skills", "lit-handoff", "SKILL.md");
    await fs.mkdir(path.dirname(entrypoint), { recursive: true });
    await fs.writeFile(entrypoint, custom);

    const install = runCli(["install", "--root", dir]);
    assert.equal(install.status, 0, install.stderr);
    assert.equal(await fs.readFile(entrypoint, "utf8"), custom);
    await assert.rejects(fs.stat(path.join(dir, "skills", "lit-handoff", "original")), { code: "ENOENT" });
    const doctor = JSON.parse(runCli(["doctor", "--root", dir]).stdout);
    assert.ok(doctor.install.nativeSkills.present.includes("lit-handoff"));
    assert.deepEqual(doctor.install.nativeSkills.invalid, []);
  });
});
