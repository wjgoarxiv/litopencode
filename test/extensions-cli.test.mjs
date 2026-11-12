import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { mock, test } from "node:test";
import { extensionsNoticeLines } from "../src/extensions-notice.ts";
import { runExtensionsCommand } from "../src/cli/extensions.ts";
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

// ---------------------------------------------------------------- review fixes

// A local "shelf" repository and a cache cloned from it, so update can fetch without the network.
function gitIn(cwd, ...args) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: cwd } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function withCachedShelf({ dir, clone, env }) {
  const shelf = path.join(dir, "shelf");
  cpSync(clone, shelf, { recursive: true });
  gitIn(shelf, "init", "-q", "-b", "main");
  gitIn(shelf, "add", "-A");
  gitIn(shelf, "commit", "-q", "-m", "v1");
  const cache = path.join(env.XDG_CACHE_HOME, "litopencode", "extensions-src");
  mkdirSync(path.dirname(cache), { recursive: true });
  gitIn(dir, "clone", "-q", shelf, cache);
  return { shelf, cache };
}

test("update ignores GIT_DIR and GIT_WORK_TREE from the caller, so the user's repository is never fetched into or reset", () => {
  sandbox(({ cli, dir, clone, env, target }) => {
    const { shelf } = withCachedShelf({ dir, clone, env });
    assert.equal(cli(["extensions", "install", "lit-docx", "--yes"]).status, 0);
    writeFileSync(path.join(shelf, "variants", "litopencode", "lit-docx", "SKILL.md"), "---\nname: lit-docx\ndescription: v2\n---\n");
    gitIn(shelf, "commit", "-q", "-am", "v2");

    const decoy = path.join(dir, "decoy");
    mkdirSync(decoy);
    gitIn(decoy, "init", "-q", "-b", "main");
    writeFileSync(path.join(decoy, "work.txt"), "unsaved work\n");
    gitIn(decoy, "add", "work.txt");
    gitIn(decoy, "commit", "-q", "-m", "mine");
    writeFileSync(path.join(decoy, "work.txt"), "edited, not committed\n");
    const head = gitIn(decoy, "rev-parse", "HEAD");

    const updated = cli(["extensions", "update", "--yes"], { GIT_DIR: path.join(decoy, ".git"), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: path.join(decoy, ".git", "index") });
    assert.equal(updated.status, 0, updated.stderr);
    assert.match(updated.stdout, /lit-docx: updated/u);
    assert.match(readFileSync(path.join(target("lit-docx"), "SKILL.md"), "utf8"), /v2/u);
    assert.equal(readFileSync(path.join(decoy, "work.txt"), "utf8"), "edited, not committed\n", "the caller's work tree is untouched");
    assert.equal(gitIn(decoy, "rev-parse", "HEAD"), head);
  });
});

test("a competing copy is named once when the working directory is the home folder", () => {
  sandbox(({ home, env }) => {
    const personal = path.join(home, ".agents", "skills", "lit-docx");
    mkdirSync(personal, { recursive: true });
    writeFileSync(path.join(personal, "SKILL.md"), "---\nname: lit-docx\ndescription: mine\n---\n");
    const list = runBin(["extensions", "list", "--json"], { env, cwd: home });
    assert.equal(list.status, 0, list.stderr);
    assert.deepEqual(JSON.parse(list.stdout).extensions.find((entry) => entry.id === "lit-docx").competing, [personal]);
    const check = JSON.parse(runBin(["extensions", "check", "--json"], { env, cwd: home }).stdout);
    assert.equal(check.needsAction.filter((issue) => issue.id === "lit-docx").length, 1);
  });
});

test("only a litopencode receipt makes a folder installed, and the source rewrite keeps fields it does not know", () => {
  sandbox(({ cli, dir, clone, target }) => {
    mkdirSync(target("lit-pptx"), { recursive: true });
    writeFileSync(path.join(target("lit-pptx"), "SKILL.md"), "---\nname: lit-pptx\ndescription: copied by hand\n---\n");
    writeFileSync(path.join(target("lit-pptx"), ".litfamily-extension.json"), JSON.stringify({ id: "lit-pptx", source: clone, variant: "another-product", installed_at: "2026-11-01T00:00:00Z" }));
    assert.equal(JSON.parse(cli(["extensions", "list", "--json"]).stdout).extensions.find((entry) => entry.id === "lit-pptx").state, "user-managed");
    const refused = cli(["extensions", "remove", "lit-pptx", "--yes"]);
    assert.equal(refused.status, 1);
    assert.ok(existsSync(path.join(target("lit-pptx"), "SKILL.md")));

    assert.equal(cli(["extensions", "install", "lit-docx", "--from", clone, "--yes"]).status, 0);
    const receiptFile = path.join(target("lit-docx"), ".litfamily-extension.json");
    writeFileSync(receiptFile, `${JSON.stringify({ ...receiptOf(target("lit-docx")), note: "kept" })}\n`);
    const other = path.join(dir, "other-clone");
    cpSync(clone, other, { recursive: true });
    assert.equal(cli(["extensions", "update", "lit-docx", "--from", other, "--yes"]).status, 0);
    const receipt = receiptOf(target("lit-docx"));
    assert.equal(receipt.note, "kept");
    assert.equal(receipt.source, path.join(other, "variants", "litopencode", "lit-docx"));
  });
});

test("a move across volumes stops with a plain reason and leaves the old folder in place", async () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "litopencode-extensions-exdev-")));
  const previousHome = process.env.HOME;
  try {
    const home = path.join(dir, "home");
    const root = path.join(home, ".config", "opencode");
    const clone = path.join(dir, "clone");
    const variant = path.join(clone, "variants", "litopencode", "lit-docx");
    mkdirSync(variant, { recursive: true });
    writeFileSync(path.join(variant, "SKILL.md"), "---\nname: lit-docx\ndescription: shelf\n---\n");
    const mine = path.join(root, "skills", "lit-docx");
    mkdirSync(mine, { recursive: true });
    writeFileSync(path.join(mine, "SKILL.md"), "mine\n");
    process.env.HOME = home;
    const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(dir, "cache") };
    const rename = mock.method(fsp, "rename", async () => {
      throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
    });
    try {
      const result = await runExtensionsCommand(["install", "lit-docx", "--from", clone, "--yes"], env, dir);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /different volumes/u);
      assert.match(result.stderr, /Nothing was moved/u);
    } finally {
      rename.mock.restore();
    }
    assert.equal(readFileSync(path.join(mine, "SKILL.md"), "utf8"), "mine\n");
    assert.deepEqual(readdirSync(path.join(root, "skills")), ["lit-docx"], "the stage is cleaned up");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an update dry run fetches nothing: it says it compared with the cache, or that the comparison waits for the fetch", () => {
  sandbox(({ cli, dir, clone, env }) => {
    assert.equal(cli(["extensions", "install", "lit-docx", "--from", clone, "--yes"]).status, 0);
    const cache = path.join(env.XDG_CACHE_HOME, "litopencode", "extensions-src");
    const noCache = cli(["extensions", "update"]);
    assert.equal(noCache.status, 0, noCache.stderr);
    assert.doesNotMatch(noCache.stdout, /would update/u);
    assert.match(noCache.stdout, /lit-docx: installed; compared with the shelf after the fetch/u);
    assert.match(noCache.stdout, /No cached copy yet/u);
    assert.equal(existsSync(cache), false, "a dry run clones nothing");

    rmSync(path.join(env.XDG_CACHE_HOME), { recursive: true, force: true });
    withCachedShelf({ dir, clone, env });
    const cached = cli(["extensions", "update"]);
    assert.equal(cached.status, 0, cached.stderr);
    assert.match(cached.stdout, /Compared with the cached copy in .+--yes fetches the shelf first, so the result may differ\./u);
    assert.equal(existsSync(path.join(cache, ".git", "FETCH_HEAD")), false, "a dry run fetches nothing");
  });
});

test("check reports a stage folder an interrupted install left behind", () => {
  sandbox(({ cli, root }) => {
    const stage = path.join(root, "skills", ".lit-docx.0f8fad5b-d9cb-469f-a165-70867728950e.stage");
    mkdirSync(stage, { recursive: true });
    writeFileSync(path.join(stage, "SKILL.md"), "half\n");
    const check = cli(["extensions", "check"]);
    assert.equal(check.status, 1);
    assert.ok(check.stdout.includes(`rm -r "${stage}"`), check.stdout);
  });
});

test("extensions help names --root", () => {
  sandbox(({ cli }) => {
    assert.match(cli(["extensions", "--help"]).stdout, /--root <OpenCode config folder>/u);
  });
});
