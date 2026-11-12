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

test("the host loads the configured old plugin during registration with its self-update turned off", async () => {
  // `opencode plugin` loads the plugins already in the config. An older LitOpenCode there would update itself first
  // and replace the skill folders with an installer that keeps no user files, before this one could copy them out.
  await withTempDir(async (dir) => {
    const configHome = path.join(dir, "xdg");
    const opencodeRoot = path.join(configHome, "opencode");
    const binDir = path.join(dir, "bin");
    await fs.mkdir(opencodeRoot, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(opencodeRoot, "opencode.json"), JSON.stringify({ plugin: ["@litfamily/litopencode@1.0.38"] }, null, 2));
    const seen = path.join(dir, "plugin-env.txt");
    const fakeOpenCode = path.join(binDir, "opencode");
    await fs.writeFile(
      fakeOpenCode,
      `#!/bin/sh\nif [ "$1" = plugin ]; then printf '%s|%s' "$LITOPENCODE_NO_AUTO_UPDATE" "$LITOPENCODE_AUTO_UPDATE_IN_PROGRESS" > '${seen}'; fi\nexit 23\n`
    );
    await fs.chmod(fakeOpenCode, 0o755);
    const env = { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, XDG_CONFIG_HOME: configHome };
    delete env.LITOPENCODE_NO_AUTO_UPDATE;
    delete env.LITOPENCODE_AUTO_UPDATE_IN_PROGRESS;

    const result = runCli(["install", "--yes"], { env });
    assert.equal(result.status, 1, result.stdout);
    assert.equal(await fs.readFile(seen, "utf8"), "1|1");
  });
});

test("an untouched skill folder from any earlier release is recognised as shipped", async () => {
  // Generated SKILL.md files changed from release to release; one missing from the list would be reported as a file
  // the user added or changed. These are untouched installs of 1.0.0, 1.0.9, 1.0.30 and 1.0.42.
  const known = new Set(JSON.parse(await fs.readFile(path.resolve("skills", "shipped-skill-files.json"), "utf8")).sha256);
  const samples = {
    "1.0.0 autoconference/SKILL.md": "54fec02dfda952f68776b4d4146012907bb00d66b9c2fe4dea464a07089a3f09",
    "1.0.9 deep-interview/SKILL.md": "c08e8ca0697c2becbf250016249c4d98ae16847f9713c4dce587db2be85c5e58",
    "1.0.30 frontend-ui-ux/SKILL.md": "ece5fa0cf060dfbc6a139cdbf3d8f61122bf6f7c72976d65c5676e1192e3386d",
    "1.0.42 lit-adhd/SKILL.md": "aaf3bc04085c4f179a8fafbaef04259c45829d1efcf67368f66d063960a2030c",
    "1.0.42 start-work/SKILL.md": "a0ff462612219a68930f11c876700629e697c1bfd653db232ab05429b302aa87",
    "1.0.42 litgoal/SKILL.md": "b3594f2daf7f82324953e24c2f073e4432d9763723fa2f37b3482f279427ff12"
  };
  assert.deepEqual(Object.keys(samples).filter((name) => !known.has(samples[name])), []);
});
