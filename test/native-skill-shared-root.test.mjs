import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "../test-support/cli-fixture.ts";
import { withHandoffTempDir } from "../test-support/lit-handoff-fixture.mjs";

// Real incident this guards against: a user's ~/.config/opencode/skills was a symlink to their
// personal git repo ~/skills, and install silently wrote 39 managed skills into it. Install still
// intentionally follows that symlink (see the "installer accepts an intentional symlinked native
// skills root" test in lit-handoff-install.test.mjs); these tests only pin that the link and the
// git work tree it resolves into become visible in install and doctor output.

function envWithHome(homeDir) {
  return { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
}

test("installer and doctor report a symlinked native skills root inside a git work tree", async () => {
  await withHandoffTempDir(async (dir) => {
    const home = path.join(dir, "home");
    const root = path.join(dir, "config");
    const personalRepo = path.join(home, "personal-repo");
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(path.join(personalRepo, ".git"), { recursive: true });
    await fs.symlink(personalRepo, path.join(root, "skills"));
    const env = envWithHome(home);
    const repoRealpath = await fs.realpath(personalRepo);

    const dryRun = runCli(["install", "--root", root, "--dry-run"], { env });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryReport = JSON.parse(dryRun.stdout);
    assert.equal(dryReport.nativeSkills.link.path, path.join(root, "skills"));
    assert.equal(dryReport.nativeSkills.link.target, repoRealpath);
    assert.equal(dryReport.nativeSkills.link.gitRepositoryRoot, repoRealpath);

    const install = runCli(["install", "--root", root], { env });
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /Native skills link/);
    assert.match(install.stdout, /\(linked\s+directory\)/);
    assert.match(install.stdout, /Warning/);
    assert.match(install.stdout, /git\s+repository/);
    assert.equal(await fs.readlink(path.join(root, "skills")), personalRepo);

    const doctor = runCli(["doctor", "--root", root], { env });
    assert.equal(doctor.status, 0, doctor.stderr);
    const doctorReport = JSON.parse(doctor.stdout);
    assert.equal(doctorReport.install.nativeSkills.link.path, path.join(root, "skills"));
    assert.equal(doctorReport.install.nativeSkills.link.target, repoRealpath);
    assert.equal(doctorReport.install.nativeSkills.link.gitRepositoryRoot, repoRealpath);
    assert.equal(doctorReport.install.ok, true);
  });
});

test("installer and doctor report a symlinked native skills root that is not a git work tree", async () => {
  await withHandoffTempDir(async (dir) => {
    const home = path.join(dir, "home");
    const root = path.join(dir, "config");
    const sharedSkills = path.join(dir, "shared-skills");
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(sharedSkills, { recursive: true });
    await fs.symlink(sharedSkills, path.join(root, "skills"));
    const env = envWithHome(home);
    const sharedRealpath = await fs.realpath(sharedSkills);

    const dryRun = runCli(["install", "--root", root, "--dry-run"], { env });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryReport = JSON.parse(dryRun.stdout);
    assert.equal(dryReport.nativeSkills.link.target, sharedRealpath);
    assert.equal(dryReport.nativeSkills.link.gitRepositoryRoot, undefined);

    const install = runCli(["install", "--root", root], { env });
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /Native skills link/);
    assert.match(install.stdout, /\(linked\s+directory\)/);
    assert.doesNotMatch(install.stdout, /git\s+repository/);

    const doctor = runCli(["doctor", "--root", root], { env });
    assert.equal(doctor.status, 0, doctor.stderr);
    const doctorReport = JSON.parse(doctor.stdout);
    assert.equal(doctorReport.install.nativeSkills.link.target, sharedRealpath);
    assert.equal(doctorReport.install.nativeSkills.link.gitRepositoryRoot, undefined);
    assert.equal(doctorReport.install.ok, true);
  });
});

test("doctor lists a same-named user-level skill as shadowed without failing ok", async () => {
  await withHandoffTempDir(async (dir) => {
    const home = path.join(dir, "home");
    const root = path.join(dir, "config");
    const shadowRoot = path.join(home, ".agents", "skills");
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(path.join(shadowRoot, "lit-handoff"), { recursive: true });
    await fs.writeFile(path.join(shadowRoot, "lit-handoff", "SKILL.md"), "---\nname: lit-handoff\n---\nuser copy\n");
    const env = envWithHome(home);

    const install = runCli(["install", "--root", root], { env });
    assert.equal(install.status, 0, install.stderr);

    const doctor = runCli(["doctor", "--root", root], { env });
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    const shadow = report.install.nativeSkills.shadowedSkills.find((entry) => entry.id === "lit-handoff");
    assert.ok(shadow, "expected lit-handoff to be reported as shadowed by ~/.agents/skills");
    assert.ok(
      shadow.locations.some((location) => location.id === "user-agents" && location.root === shadowRoot),
      "expected the user-agents location to name " + shadowRoot
    );
    // Shadowing is a warning: it must not flip nativeSkills.ok or doctor's overall install.ok.
    assert.equal(report.install.nativeSkills.ok, true);
    assert.equal(report.install.ok, true);
  });
});

test("doctor does not report a shadow when the other root is the same realpath as the managed skills root", async () => {
  await withHandoffTempDir(async (dir) => {
    const home = path.join(dir, "home");
    const root = path.join(dir, "config");
    const workDir = path.join(dir, "workdir");
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });
    const env = envWithHome(home);

    const install = runCli(["install", "--root", root], { env });
    assert.equal(install.status, 0, install.stderr);

    const managedSkillsRoot = path.join(root, "skills");
    await fs.mkdir(path.join(workDir, ".agents"), { recursive: true });
    await fs.symlink(managedSkillsRoot, path.join(workDir, ".agents", "skills"));

    const doctor = runCli(["doctor", "--root", root], { env, cwd: workDir });
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    const shadow = report.install.nativeSkills.shadowedSkills.find((entry) => entry.id === "lit-handoff");
    assert.equal(shadow, undefined, "a same-realpath root is the managed tree, not a shadow");
  });
});
