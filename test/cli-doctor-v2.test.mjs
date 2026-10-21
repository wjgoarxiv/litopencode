import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseJsonc } from "../src/cli/jsonc.ts";
import { packageId, runCli, withTempDir } from "../test-support/cli-fixture.ts";

// Doctor on a config folder that OpenCode 1 and OpenCode 2 share: it names the hosts it found, counts
// LitOpenCode entries across both plugin keys, flags a stale cli.json pin, warns about OpenCode 2-only
// keys that stop OpenCode 1, says that OpenCode 2 does not run language servers, and reports OpenCode 2's
// update policy. `tui remove` also clears cli.json.
test("doctor reports both hosts and the OpenCode 2 checks on a shared config folder", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [packageId], plugins: ["@litfamily/litopencode@1.0.0"], permissions: [], lsp: {} }, null, 2));
    await fs.writeFile(path.join(dir, "tui.json"), JSON.stringify({ plugin: [packageId] }));
    await fs.writeFile(path.join(dir, "cli.json"), JSON.stringify({ plugins: ["litopencode"] }));
    const result = runCli(["doctor", "--root", dir, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.host.mode, "both");
    assert.deepEqual(report.host.evidence, { cliJson: true, tuiJson: true });
    assert.equal(report.host.updatePolicy, "auto");
    assert.equal(report.install.pluginEntries, 2);
    assert.equal(report.install.cliJson.stale, 1);
    assert.deepEqual(report.install.hostOnlyKeys.present, ["permissions"]);
    assert.equal(report.install.hostOnlyKeys.breaksOpenCode1, true);
    assert.equal(report.install.ok, false);
    assert.match(report.lsp.openCode2, /does not run language servers/u);
  });
});

test("doctor on an OpenCode 1 folder keeps its OpenCode 1 view and shows OpenCode 2's policy only when it is a target", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [packageId], autoupdate: "notify" }, null, 2));
    await fs.writeFile(path.join(dir, "tui.json"), JSON.stringify({ plugin: [packageId] }));
    const report = JSON.parse(runCli(["doctor", "--root", dir, "--json"]).stdout);
    assert.equal(report.host.mode, "v1");
    assert.equal(report.install.pluginEntries, 1);
    assert.equal(report.install.hostOnlyKeys.present.length, 0);
    assert.equal(report.lsp.openCode2, undefined);
    const forced = JSON.parse(runCli(["doctor", "--root", dir, "--json", "--host", "v2"]).stdout);
    assert.equal(forced.host.mode, "v2");
    assert.equal(forced.host.updatePolicy, "notify");
  });
});

test("tui remove also takes LitOpenCode out of cli.json, with a backup, and a dry run writes nothing", async () => {
  await withTempDir(async (dir) => {
    const cli = `{\n  // keep\n  "plugins": ["herdr-tui", "${packageId}"]\n}\n`;
    await fs.writeFile(path.join(dir, "cli.json"), cli);
    const dry = JSON.parse(runCli(["tui", "remove", "--root", dir, "--dry-run"]).stdout);
    assert.equal(dry.cliJson.removed, 1);
    assert.equal(await fs.readFile(path.join(dir, "cli.json"), "utf8"), cli);
    const removed = JSON.parse(runCli(["tui", "remove", "--root", dir]).stdout);
    assert.equal(removed.cliJson.removed, 1);
    assert.equal(removed.cliJson.backup, path.join(dir, "cli.json.litopencode-backup"));
    assert.deepEqual(parseJsonc(await fs.readFile(path.join(dir, "cli.json"), "utf8")).plugins, ["herdr-tui"]);
    assert.match(await fs.readFile(path.join(dir, "cli.json"), "utf8"), /\/\/ keep/u);
  });
});

test("doctor counts a local checkout path entry as the one LitOpenCode registration", async () => {
  await withTempDir(async (dir) => {
    const checkout = path.join(dir, "checkout");
    await fs.mkdir(checkout);
    await fs.writeFile(path.join(checkout, "package.json"), JSON.stringify({ name: "@litfamily/litopencode", version: "0.0.0" }));
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [checkout] }, null, 2));
    await fs.writeFile(path.join(dir, "cli.json"), JSON.stringify({ plugins: [] }));
    const report = JSON.parse(runCli(["doctor", "--root", dir, "--json"]).stdout);
    assert.equal(report.host.mode, "v2");
    assert.equal(report.install.pluginEntries, 1);
  });
});

test("review M4: tui remove checks tui.json and cli.json before it writes either, and --host v1 leaves cli.json alone", async () => {
  await withTempDir(async (dir) => {
    const tui = JSON.stringify({ plugin: [packageId, "other-tui"] }, null, 2);
    await fs.writeFile(path.join(dir, "tui.json"), tui);
    await fs.writeFile(path.join(dir, "cli.json"), `{ "plugins": ["litopencode", }`);
    const failed = runCli(["tui", "remove", "--root", dir]);
    assert.notEqual(failed.status, 0, failed.stdout);
    assert.equal(await fs.readFile(path.join(dir, "tui.json"), "utf8"), tui, "tui.json was written before the cli.json refusal");
    assert.equal(await fs.stat(path.join(dir, "tui.json.litopencode-backup")).then(() => true, () => false), false);

    const v1 = runCli(["tui", "remove", "--root", dir, "--host", "v1"]);
    assert.equal(v1.status, 0, v1.stderr);
    const report = JSON.parse(v1.stdout);
    assert.equal(report.removed, 1);
    assert.equal(report.cliJson, undefined);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "tui.json"), "utf8")).plugin, ["other-tui"]);
    assert.equal(await fs.readFile(path.join(dir, "cli.json"), "utf8"), `{ "plugins": ["litopencode", }`);
  });
});
