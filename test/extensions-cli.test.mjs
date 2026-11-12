import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extensionsNoticeLines } from "../src/extensions-notice.ts";
import { runCli as runBin } from "../test-support/cli-fixture.ts";

// `litopencode extensions` does the pointer's four lines in code: it checks for same-name skills OpenCode also reads,
// moves an existing folder whole into a dated backup, copies the shelf's OpenCode edition in and writes the receipt.
// Every verb that writes is a dry run until --yes. Each test runs the built CLI in a throwaway home.
function sandbox(fn) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "litopencode-extensions-cli-")));
  try {
    const home = path.join(dir, "home");
    const project = path.join(dir, "project");
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    const root = path.join(home, ".config", "opencode");
    const clone = path.join(dir, "clone");
    const variant = (id) => path.join(clone, "variants", "litopencode", id);
    for (const id of ["lit-docx", "lit-pptx", "lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization"]) {
      mkdirSync(path.join(variant(id), "scripts"), { recursive: true });
      writeFileSync(path.join(variant(id), "SKILL.md"), `---\nname: ${id}\ndescription: Shelf copy of ${id}.\n---\n\n# ${id}\n`);
      writeFileSync(path.join(variant(id), "scripts", "run.py"), "print('run')\n");
    }
    const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(dir, "cache") };
    const cli = (args, extra = {}) => runBin(args, { env: { ...env, ...extra }, cwd: project });
    fn({ dir, home, root, clone, variant, env, cli, target: (id) => path.join(root, "skills", id), backups: path.join(root, "extension-backups") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const receiptOf = (folder) => JSON.parse(readFileSync(path.join(folder, ".litfamily-extension.json"), "utf8"));

test("install is a dry run until --yes, then copies one clean extension with a receipt", () => {
  sandbox(({ cli, clone, target, backups, variant }) => {
    const dry = cli(["extensions", "install", "lit-docx", "--from", clone]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /dry run/iu);
    assert.match(dry.stdout, /--yes/u);
    assert.equal(existsSync(target("lit-docx")), false, "a dry run writes nothing");

    const done = cli(["extensions", "install", "lit-docx", "--from", clone, "--yes"]);
    assert.equal(done.status, 0, done.stderr);
    assert.deepEqual(readdirSync(target("lit-docx")).sort(), [".litfamily-extension.json", "SKILL.md", "scripts"]);
    const receipt = receiptOf(target("lit-docx"));
    assert.deepEqual(Object.keys(receipt), ["id", "source", "variant", "installed_at", "sha256"]);
    assert.equal(receipt.source, variant("lit-docx"));
    assert.equal(receipt.variant, "litopencode");
    assert.match(receipt.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(existsSync(backups), false, "nothing was there, so nothing moved aside");

    const list = JSON.parse(cli(["extensions", "list", "--json"]).stdout);
    assert.equal(list.extensions.length, 9);
    const docx = list.extensions.find((entry) => entry.id === "lit-docx");
    assert.equal(docx.state, "installed");
    assert.equal(docx.receipt.source, variant("lit-docx"));
    assert.equal(list.extensions.find((entry) => entry.id === "lit-pptx").state, "not-installed");
    assert.equal(cli(["extensions", "check"]).status, 0, "a fresh install leaves nothing to fix");
  });
});

test("install over the pointer and a user file moves the folder whole aside and leaves one live copy that litopencode install keeps", () => {
  sandbox(({ cli, clone, target, backups, root }) => {
    assert.equal(cli(["install", "--root", root], { XDG_CONFIG_HOME: path.join(root, "..", "elsewhere") }).status, 0);
    writeFileSync(path.join(target("lit-docx"), "notes.md"), "mine\n");
    const listed = JSON.parse(cli(["extensions", "list", "--json"]).stdout).extensions.find((entry) => entry.id === "lit-docx");
    assert.equal(listed.state, "not-installed");
    assert.equal(listed.pointer, true);

    const done = cli(["extensions", "install", "lit-docx", "--from", clone, "--yes"]);
    assert.equal(done.status, 0, done.stderr);
    const [stamp] = readdirSync(backups);
    assert.match(stamp, /^\d{8}-\d{6}(-\d+)?$/u);
    assert.equal(readFileSync(path.join(backups, stamp, "lit-docx", "notes.md"), "utf8"), "mine\n");
    assert.match(readFileSync(path.join(backups, stamp, "lit-docx", "SKILL.md"), "utf8"), /moved to wjgoarxiv-skills/u);
    assert.deepEqual(readdirSync(target("lit-docx")).sort(), [".litfamily-extension.json", "SKILL.md", "scripts"]);
    assert.ok(done.stdout.includes(path.join(backups, stamp, "lit-docx")), "names where the old folder went");
    const leftovers = readdirSync(path.join(root, "skills")).filter((entry) => entry.includes("lit-docx"));
    assert.deepEqual(leftovers, ["lit-docx"], "no stage folder is left beside it");

    const before = readFileSync(path.join(target("lit-docx"), ".litfamily-extension.json"), "utf8");
    assert.equal(cli(["install", "--root", root], { XDG_CONFIG_HOME: path.join(root, "..", "elsewhere") }).status, 0);
    assert.equal(readFileSync(path.join(target("lit-docx"), ".litfamily-extension.json"), "utf8"), before);
    const doctor = JSON.parse(cli(["doctor", "--root", root]).stdout);
    assert.ok(doctor.install.nativeSkills.preserved.includes("lit-docx"));
    assert.match(doctor.extensions.line, /^EXTENSIONS: 1 installed/u);
    assert.match(doctor.extensions.line, /litopencode extensions check/u);
  });
});

test("a same-name personal skill stops install and is named; --allow-shadow installs with a warning and never touches it", () => {
  sandbox(({ cli, clone, target, home }) => {
    const personal = path.join(home, ".agents", "skills", "lit-docx");
    mkdirSync(personal, { recursive: true });
    writeFileSync(path.join(personal, "SKILL.md"), "---\nname: lit-docx\ndescription: mine\n---\n");
    const stopped = cli(["extensions", "install", "lit-docx", "--from", clone, "--yes"]);
    assert.equal(stopped.status, 1);
    assert.ok(`${stopped.stdout}${stopped.stderr}`.includes(personal), "names the competing folder");
    assert.match(`${stopped.stdout}${stopped.stderr}`, /--allow-shadow/u);
    assert.equal(existsSync(target("lit-docx")), false, "nothing was written");

    const check = cli(["extensions", "check"]);
    assert.equal(check.status, 1);
    assert.ok(check.stdout.includes(personal));
    assert.doesNotMatch(check.stdout, /mv "[^"]+" "[^"]*extension-backups/u, "the fix never parks a user's skill where prune-backups deletes");
    const listed = JSON.parse(cli(["extensions", "list", "--json"]).stdout).extensions.find((entry) => entry.id === "lit-docx");
    assert.deepEqual(listed.competing, [personal]);

    const allowed = cli(["extensions", "install", "lit-docx", "--from", clone, "--yes", "--allow-shadow"]);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(`${allowed.stdout}${allowed.stderr}`, /warning/iu);
    assert.equal(readFileSync(path.join(personal, "SKILL.md"), "utf8"), "---\nname: lit-docx\ndescription: mine\n---\n");
    assert.equal(receiptOf(target("lit-docx")).id, "lit-docx");
  });
});

test("update reports current, then reinstalls a changed source with a second backup", () => {
  sandbox(({ cli, clone, target, backups, variant }) => {
    assert.equal(cli(["extensions", "install", "lit-docx", "--from", clone, "--yes"]).status, 0);
    const current = cli(["extensions", "update", "--from", clone, "--yes"]);
    assert.equal(current.status, 0, current.stderr);
    assert.match(current.stdout, /lit-docx: current/u);
    assert.equal(existsSync(backups), false);

    writeFileSync(path.join(variant("lit-docx"), "SKILL.md"), "---\nname: lit-docx\ndescription: v2\n---\n");
    const first = receiptOf(target("lit-docx")).sha256;
    const dry = cli(["extensions", "update", "lit-docx", "--from", clone]);
    assert.match(dry.stdout, /lit-docx: would update/u);
    assert.equal(receiptOf(target("lit-docx")).sha256, first, "a dry run writes nothing");
    const updated = cli(["extensions", "update", "--from", clone, "--yes"]);
    assert.equal(updated.status, 0, updated.stderr);
    assert.match(updated.stdout, /lit-docx: updated/u);
    assert.notEqual(receiptOf(target("lit-docx")).sha256, first);
    assert.match(readFileSync(path.join(target("lit-docx"), "SKILL.md"), "utf8"), /v2/u);
    const [stamp] = readdirSync(backups);
    assert.equal(receiptOf(path.join(backups, stamp, "lit-docx")).sha256, first, "the old copy moved aside with its receipt");
  });
});

test("update compares by content hash only: a new source with the same content stays current and only the receipt's source changes", () => {
  sandbox(({ cli, dir, clone, target, backups }) => {
    assert.equal(cli(["extensions", "install", "lit-docx", "--from", clone, "--yes"]).status, 0);
    const before = receiptOf(target("lit-docx"));
    const other = path.join(dir, "other-clone");
    cpSync(clone, other, { recursive: true });
    const moved = path.join(other, "variants", "litopencode", "lit-docx");

    const dry = cli(["extensions", "update", "lit-docx", "--from", other]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /lit-docx: current/u);
    assert.doesNotMatch(dry.stdout, /would update/u);
    assert.deepEqual(receiptOf(target("lit-docx")), before, "a dry run writes nothing");

    const done = cli(["extensions", "update", "--from", other, "--yes"]);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /lit-docx: current/u);
    assert.doesNotMatch(done.stdout, /updated/u);
    assert.equal(existsSync(backups), false, "same content makes no backup");
    assert.deepEqual(receiptOf(target("lit-docx")), { ...before, source: moved }, "only the source field is rewritten");
    assert.deepEqual(readdirSync(target("lit-docx")).sort(), [".litfamily-extension.json", "SKILL.md", "scripts"], "no stage or temp file is left");
  });
});

test("remove refuses a user folder and moves a receipt-carrying copy into the backups", () => {
  sandbox(({ cli, clone, target, backups, root }) => {
    mkdirSync(target("lit-pptx"), { recursive: true });
    writeFileSync(path.join(target("lit-pptx"), "SKILL.md"), "---\nname: lit-pptx\ndescription: my own\n---\n");
    const refused = cli(["extensions", "remove", "lit-pptx", "--yes"]);
    assert.equal(refused.status, 1);
    assert.ok(`${refused.stdout}${refused.stderr}`.includes(target("lit-pptx")));
    assert.equal(readFileSync(path.join(target("lit-pptx"), "SKILL.md"), "utf8"), "---\nname: lit-pptx\ndescription: my own\n---\n");
    const check = cli(["extensions", "check"]);
    assert.equal(check.status, 1, "a folder without a receipt needs a look");
    assert.match(check.stdout, /litopencode extensions install lit-pptx/u);

    assert.equal(cli(["extensions", "install", "lit-docx", "--from", clone, "--yes"]).status, 0);
    const dry = cli(["extensions", "remove", "lit-docx"]);
    assert.equal(dry.status, 0);
    assert.ok(existsSync(target("lit-docx")), "a dry run writes nothing");
    const removed = cli(["extensions", "remove", "lit-docx", "--yes"]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(target("lit-docx")), false);
    const [stamp] = readdirSync(backups);
    assert.equal(receiptOf(path.join(backups, stamp, "lit-docx")).id, "lit-docx");
    assert.match(removed.stdout, /litopencode install/u, "says how to bring the pointer back");
    assert.ok(existsSync(path.join(root, "skills", "lit-pptx")));
  });
});

test("prune-backups lists sizes as a dry run and deletes only with --yes, only inside extension-backups", () => {
  sandbox(({ cli, backups, root }) => {
    const old = path.join(backups, "20200101-000000", "lit-docx");
    const recent = path.join(backups, "20991231-000000", "lit-pptx");
    for (const folder of [old, recent]) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, "SKILL.md"), "x".repeat(2048));
    }
    const outside = path.join(root, "keep.txt");
    writeFileSync(outside, "keep\n");
    const undated = path.join(backups, "parked-by-hand", "lit-docx");
    mkdirSync(undated, { recursive: true });
    writeFileSync(path.join(undated, "SKILL.md"), "mine\n");
    const dry = cli(["extensions", "prune-backups", "--older-than", "30"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(dry.stdout.includes(path.join(backups, "20200101-000000")));
    assert.ok(!dry.stdout.includes("20991231-000000"), "--older-than leaves the newer backup out");
    assert.match(dry.stdout, /KB|B\b/u);
    assert.ok(existsSync(old), "a dry run deletes nothing");
    const done = cli(["extensions", "prune-backups", "--older-than", "30", "--yes"]);
    assert.equal(done.status, 0, done.stderr);
    assert.equal(existsSync(path.join(backups, "20200101-000000")), false);
    assert.ok(existsSync(recent));
    assert.ok(existsSync(outside));
    const all = cli(["extensions", "prune-backups", "--yes"]);
    assert.equal(all.status, 0, all.stderr);
    assert.equal(existsSync(recent), false);
    assert.ok(existsSync(undated), "a folder that is not a dated backup is never deleted");
  });
});

test("a missing --from or a missing git stops before any write and points at --from", () => {
  sandbox(({ cli, dir, target, env }) => {
    const missing = cli(["extensions", "install", "lit-docx", "--from", path.join(dir, "nope"), "--yes"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /variants\/litopencode/u);
    assert.equal(existsSync(target("lit-docx")), false);

    const noGitPath = path.join(dir, "empty-bin");
    mkdirSync(noGitPath);
    const offline = runBin(["extensions", "install", "lit-docx", "--yes"], { env: { ...env, PATH: noGitPath }, cwd: dir });
    assert.equal(offline.status, 1);
    assert.match(offline.stderr, /git/u);
    assert.match(offline.stderr, /--from/u);
    assert.equal(existsSync(target("lit-docx")), false, "never half-installs");
    assert.equal(existsSync(path.join(env.XDG_CACHE_HOME, "litopencode", "extensions-src")), false);
  });
});

test("a family selects its skills, an unknown id is refused, and a symlinked destination fails closed", () => {
  sandbox(({ cli, clone, target, dir }) => {
    const family = cli(["extensions", "install", "--family", "figures", "--from", clone]);
    assert.equal(family.status, 0, family.stderr);
    for (const id of ["lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization"]) assert.match(family.stdout, new RegExp(id, "u"));
    assert.doesNotMatch(family.stdout, /lit-docx/u);
    assert.equal(cli(["extensions", "install", "not-a-skill", "--from", clone]).status, 2);
    assert.equal(cli(["extensions", "frobnicate"]).status, 2);

    const elsewhere = path.join(dir, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(path.dirname(target("lit-docx")), { recursive: true });
    symlinkSync(elsewhere, target("lit-docx"));
    const refused = cli(["extensions", "install", "lit-docx", "--from", clone, "--yes"]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /symbolic link/u);
    assert.deepEqual(readdirSync(elsewhere), []);
  });
});

test("help and the install notice name the extensions verbs; the four lines stay as the manual route", () => {
  sandbox(({ cli }) => {
    const help = cli(["--help"]).stdout;
    for (const verb of ["list", "check", "install", "update", "remove", "prune-backups"]) {
      assert.ok(help.includes(`litopencode extensions ${verb}`), verb);
    }
  });
  const notice = extensionsNoticeLines().join("\n");
  assert.match(notice, /litopencode extensions install <skill>/u);
  assert.match(notice, /\.litfamily-extension\.json/u);
  const flagged = extensionsNoticeLines([], true).join("\n");
  assert.match(flagged, /litopencode extensions check/u);
  assert.doesNotMatch(notice, /extensions check/u, "the check line appears only when check found something");
});
