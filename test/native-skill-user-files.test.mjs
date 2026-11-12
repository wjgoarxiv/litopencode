import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

// A skill folder LitOpenCode wrote can also hold files the user put there. Replacing the folder (an update, or a
// skill that became a pointer) must never take those files with it: they are copied to a dated folder outside the
// skills root first, the install says where, and the dry run lists them as preserved.
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function walk(dir, prefix = "") {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), relative));
    else out.push(relative);
  }
  return out.sort();
}

test("user files inside a managed skill folder are backed up outside the skills root before the folder is replaced", async () => {
  await withTempDir(async (dir) => {
    const root = path.join(dir, "config");
    const first = runCli(["install", "--root", root]);
    assert.equal(first.status, 0, first.stderr);
    const skill = path.join(root, "skills", "lit-pptx");
    await fs.writeFile(path.join(skill, "my-notes.md"), "# my deck notes\n");
    await fs.mkdir(path.join(skill, "references"), { recursive: true });
    await fs.writeFile(path.join(skill, "references", "components.md"), "components\nmy own line\n");
    // A file whose bytes LitOpenCode ships is its own, wherever it sits, and is not copied out.
    const shipped = await fs.readFile(path.join(root, "skills", "lit-plan", "scripts", "scaffold-plan.mjs"));
    await fs.writeFile(path.join(skill, "scaffold-plan.mjs"), shipped);
    await fs.mkdir(path.join(skill, "__pycache__"), { recursive: true });
    await fs.writeFile(path.join(skill, "__pycache__", "x.cpython-312.pyc"), "bytecode");
    // Make the folder stale so the installer replaces it.
    const entry = path.join(skill, "SKILL.md");
    await fs.writeFile(entry, (await fs.readFile(entry, "utf8")).replace(/\n$/u, "\nstale line from an older version\n"));

    const dry = runCli(["install", "--root", root, "--dry-run"]);
    assert.equal(dry.status, 0, dry.stderr);
    const report = JSON.parse(dry.stdout);
    assert.ok(report.nativeSkills.write.includes("lit-pptx"));
    assert.deepEqual(report.nativeSkills.preserveFiles, [
      "lit-pptx/SKILL.md",
      "lit-pptx/my-notes.md",
      "lit-pptx/references/components.md"
    ]);
    assert.equal(report.nativeSkills.backupRoot, path.join(root, ".litopencode-skill-backups"));
    assert.equal((await fs.readdir(root)).includes(".litopencode-skill-backups"), false, "the dry run writes nothing");

    const result = runCli(["install", "--root", root]);
    assert.equal(result.status, 0, result.stderr);
    const backups = path.join(root, ".litopencode-skill-backups");
    const [stamp] = await fs.readdir(backups);
    assert.match(stamp, /^\d{4}-\d{2}-\d{2}/u, "the backup folder is dated");
    const backup = path.join(backups, stamp);
    assert.ok(result.stdout.replace(/\s+/gu, "").includes(backup.replace(/\s+/gu, "")), "the install prints the backup folder");
    assert.match(result.stdout, /3 files/u);
    assert.deepEqual(await walk(backup), ["lit-pptx/SKILL.md", "lit-pptx/my-notes.md", "lit-pptx/references/components.md"]);
    assert.equal(await fs.readFile(path.join(backup, "lit-pptx", "my-notes.md"), "utf8"), "# my deck notes\n");
    assert.equal(await fs.readFile(path.join(backup, "lit-pptx", "references", "components.md"), "utf8"), "components\nmy own line\n");
    assert.deepEqual(await walk(skill), ["SKILL.md"], "the pointer replaced the folder");
    assert.ok(path.relative(path.join(root, "skills"), backup).startsWith(".."), "the backup is outside the skills root");

    const again = runCli(["install", "--root", root]);
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(again.stdout, /Kept \d+ files?/u, "a clean folder needs no backup");
    assert.deepEqual(await fs.readdir(backups), [stamp]);
  });
});

test("every file a fresh install writes into the skills root is known shipped content", async () => {
  await withTempDir(async (dir) => {
    const root = path.join(dir, "config");
    const result = runCli(["install", "--root", root]);
    assert.equal(result.status, 0, result.stderr);
    const known = new Set(JSON.parse(await fs.readFile(path.resolve("skills", "shipped-skill-files.json"), "utf8")).sha256);
    const skills = path.join(root, "skills");
    const missing = [];
    for (const file of await walk(skills)) {
      if (!known.has(sha(await fs.readFile(path.join(skills, file))))) missing.push(file);
    }
    assert.deepEqual(missing, [], "run npm run gen:shipped-skill-files after changing a skill, so the next version can tell these files from the user's");
  });
});

test("a failed plugin registration leaves the installed skills as they were", async () => {
  await withTempDir(async (dir) => {
    const configHome = path.join(dir, "xdg");
    const opencodeRoot = path.join(configHome, "opencode");
    const binDir = path.join(dir, "bin");
    await fs.mkdir(binDir, { recursive: true });
    const skill = path.join(opencodeRoot, "skills", "lit-pptx");
    await fs.mkdir(skill, { recursive: true });
    const oldEntry = "---\nname: lit-pptx\ndescription: old\nmetadata:\n  litopencodeGenerated: \"true\"\n---\n\nold full body\n";
    await fs.writeFile(path.join(skill, "SKILL.md"), oldEntry);
    await fs.writeFile(path.join(skill, "my-notes.md"), "keep me\n");
    await fs.writeFile(path.join(opencodeRoot, "opencode.json"), JSON.stringify({ plugin: ["@litfamily/litopencode@1.0.43"] }, null, 2));
    const fakeOpenCode = path.join(binDir, "opencode");
    await fs.writeFile(fakeOpenCode, "#!/bin/sh\nexit 23\n");
    await fs.chmod(fakeOpenCode, 0o755);

    const result = runCli(["install", "--yes", "--no-auto-update"], {
      env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, XDG_CONFIG_HOME: configHome }
    });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /plugin install failed/u);
    assert.equal(await fs.readFile(path.join(skill, "SKILL.md"), "utf8"), oldEntry, "the old skill was not swapped");
    assert.equal(await fs.readFile(path.join(skill, "my-notes.md"), "utf8"), "keep me\n");
    assert.equal((await fs.readdir(opencodeRoot)).includes(".litopencode-skill-backups"), false);
  });
});
