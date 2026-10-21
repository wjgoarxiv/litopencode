import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseJsonc } from "../src/cli/jsonc.ts";
import { packageId, runCli, withTempDir } from "../test-support/cli-fixture.ts";

// OpenCode lists TUI plugins in tui.json or tui.jsonc beside opencode.json. LitOpenCode adds its own
// `./tui` entry there with the same care it gives opencode.json: comments survive, other entries
// stay, nothing is duplicated, the file is backed up before it changes, and a dry run writes nothing.
const herdrEntry = "./herdr-tui-session.js";
const commentedTui = `// my TUI config
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "opencode", // keep this theme
  /* plugins below */
  "plugin": ["${herdrEntry}"],
}
`;

async function readPlugins(file) {
  return parseJsonc(await fs.readFile(file, "utf8")).plugin;
}

async function exists(file) {
  return fs.stat(file).then(() => true, () => false);
}

test("install creates tui.json with the LitOpenCode TUI entry when the root has no TUI config", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const parsed = parseJsonc(await fs.readFile(path.join(dir, "tui.json"), "utf8"));
    assert.equal(parsed.$schema, "https://opencode.ai/tui.json");
    assert.deepEqual(parsed.plugin, [packageId]);
    assert.equal(await exists(path.join(dir, "tui.jsonc")), false);
    assert.match(result.stdout, /TUI mission panel/u);
  });
});

test("install adds the TUI entry to a commented tui.jsonc, keeps every comment and the other plugin, and backs it up", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "tui.jsonc");
    await fs.writeFile(file, commentedTui);

    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const written = await fs.readFile(file, "utf8");
    for (const comment of ["// my TUI config", "// keep this theme", "/* plugins below */"]) {
      assert.ok(written.includes(comment), `${comment} was dropped:\n${written}`);
    }
    assert.deepEqual(await readPlugins(file), [herdrEntry, packageId]);
    assert.equal(await fs.readFile(`${file}.litopencode-backup`, "utf8"), commentedTui);
    assert.equal(await exists(path.join(dir, "tui.json")), false);
  });
});

test("a second install leaves the TUI config byte-identical and never duplicates the entry", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "tui.jsonc");
    await fs.writeFile(file, commentedTui);
    assert.equal(runCli(["install", "--root", dir]).status, 0);
    const first = await fs.readFile(file, "utf8");
    const firstStat = await fs.stat(`${file}.litopencode-backup`);

    const again = runCli(["install", "--root", dir]);

    assert.equal(again.status, 0, again.stderr);
    assert.equal(await fs.readFile(file, "utf8"), first);
    assert.deepEqual(await readPlugins(file), [herdrEntry, packageId]);
    assert.equal((await fs.stat(`${file}.litopencode-backup`)).mtimeMs, firstStat.mtimeMs);
  });
});

test("install replaces stale and duplicate LitOpenCode TUI entries with one current entry, keeping tuple options", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "tui.json");
    await fs.writeFile(file, JSON.stringify({ plugin: [["litopencode@0.1.0", { motion: false }], herdrEntry, "@litfamily/litopencode@1.0.1"] }, null, 2));

    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readPlugins(file), [[packageId, { motion: false }], herdrEntry]);
  });
});

test("with both tui.json and tui.jsonc present, install edits tui.json as OpenCode does and leaves tui.jsonc alone", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "tui.json"), `{\n  "plugin": []\n}\n`);
    const jsonc = `{\n  "plugin": ["${herdrEntry}"]\n}\n`;
    await fs.writeFile(path.join(dir, "tui.jsonc"), jsonc);

    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readPlugins(path.join(dir, "tui.json")), [packageId]);
    assert.equal(await fs.readFile(path.join(dir, "tui.jsonc"), "utf8"), jsonc);
  });
});

test("an existing LitOpenCode entry in tui.jsonc is kept there instead of adding a second one to tui.json", async () => {
  await withTempDir(async (dir) => {
    const json = `{\n  "plugin": []\n}\n`;
    await fs.writeFile(path.join(dir, "tui.json"), json);
    await fs.writeFile(path.join(dir, "tui.jsonc"), JSON.stringify({ plugin: [herdrEntry, "litopencode@0.9.0"] }, null, 2));

    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readPlugins(path.join(dir, "tui.jsonc")), [herdrEntry, packageId]);
    assert.equal(await fs.readFile(path.join(dir, "tui.json"), "utf8"), json);
  });
});

test("install --dry-run reports the planned TUI entry and writes no TUI file", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "tui.jsonc");
    await fs.writeFile(file, commentedTui);

    const result = runCli(["install", "--dry-run", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.tui.path, file);
    assert.equal(report.tui.changed, true);
    assert.deepEqual(report.tui.add, [packageId]);
    assert.equal(await fs.readFile(file, "utf8"), commentedTui);
    assert.equal(await exists(`${file}.litopencode-backup`), false);
    assert.equal(await exists(path.join(dir, "tui.json")), false);
  });
});

test("install refuses before writing anything when the TUI entry would delete a comment inside the plugin list", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "tui.jsonc");
    const original = `{\n  "plugin": [\n    // herdr keeps the pane in sync\n    "${herdrEntry}"\n  ]\n}\n`;
    await fs.writeFile(file, original);

    const dry = runCli(["install", "--dry-run", "--root", dir]);
    assert.equal(dry.status, 1);
    assert.match(dry.stderr, /"plugin": \[/u);

    const result = runCli(["install", "--root", dir]);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(file), result.stderr);
    assert.equal(await fs.readFile(file, "utf8"), original);
    assert.equal(await exists(path.join(dir, "litopencode.json")), false);
  });
});

test("tui remove deletes only LitOpenCode entries from both TUI files and keeps comments and other plugins", async () => {
  await withTempDir(async (dir) => {
    const jsonc = path.join(dir, "tui.jsonc");
    const json = path.join(dir, "tui.json");
    await fs.writeFile(jsonc, commentedTui.replace(`["${herdrEntry}"]`, `["${herdrEntry}", "${packageId}"]`));
    await fs.writeFile(json, JSON.stringify({ plugin: [["litopencode@0.2.0", { motion: false }]] }, null, 2));

    const dry = runCli(["tui", "remove", "--dry-run", "--root", dir]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).removed, 2);
    assert.deepEqual(await readPlugins(jsonc), [herdrEntry, packageId]);

    const result = runCli(["tui", "remove", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const written = await fs.readFile(jsonc, "utf8");
    for (const comment of ["// my TUI config", "// keep this theme", "/* plugins below */"]) {
      assert.ok(written.includes(comment), `${comment} was dropped:\n${written}`);
    }
    assert.deepEqual(await readPlugins(jsonc), [herdrEntry]);
    assert.deepEqual(await readPlugins(json), []);
    assert.ok((await fs.readFile(`${jsonc}.litopencode-backup`, "utf8")).includes(packageId));
  });
});

test("tui remove on a root without a LitOpenCode TUI entry changes nothing", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "tui.jsonc");
    await fs.writeFile(file, commentedTui);

    const result = runCli(["tui", "remove", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).removed, 0);
    assert.equal(await fs.readFile(file, "utf8"), commentedTui);
    assert.equal(await exists(`${file}.litopencode-backup`), false);
  });
});

test("doctor reports the TUI entry, the file it lives in, and a missing entry", async () => {
  await withTempDir(async (dir) => {
    const missing = JSON.parse(runCli(["doctor", "--root", dir]).stdout);
    assert.equal(missing.install.tui.present, false);
    assert.equal(missing.install.tui.path, path.join(dir, "tui.json"));

    await fs.writeFile(path.join(dir, "tui.jsonc"), commentedTui.replace(`["${herdrEntry}"]`, `["${herdrEntry}", "${packageId}"]`));
    const present = JSON.parse(runCli(["doctor", "--root", dir]).stdout);
    assert.equal(present.install.tui.present, true);
    assert.equal(present.install.tui.ok, true);
    assert.equal(present.install.tui.path, path.join(dir, "tui.jsonc"));
    assert.equal(present.install.tui.configured, packageId);
  });
});

test("the package exposes the TUI module through exports['./tui'], which OpenCode's loader resolves", async () => {
  const manifest = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(manifest.exports["./tui"].import, "./dist/host/tui.js");
  const module = await import("../dist/tui/mission-model.js");
  assert.equal(typeof module.buildMissionView, "function");
});
