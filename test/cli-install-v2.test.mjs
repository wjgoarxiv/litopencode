import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseJsonc } from "../src/cli/jsonc.ts";
import { litOpenCodeCommands } from "../src/commands.ts";
import { pluginOwnedCommandIds } from "../src/v2/commands.ts";
import { packageId, runCli, withTempDir } from "../test-support/cli-fixture.ts";

// Installing for OpenCode 2. OpenCode 2 reads the same opencode.json as OpenCode 1 and loads plugins
// from its `plugin` list, installs the package itself on first load, ignores tui.json once it has its own
// cli.json, and loads the TUI of an active server plugin on its own. A LitOpenCode pin in cli.json or a
// second entry under OpenCode 2's own `plugins` key would shadow or duplicate the plugin.
async function readConfig(file) {
  return parseJsonc(await fs.readFile(file, "utf8"));
}

async function exists(file) {
  return fs.stat(file).then(() => true, () => false);
}

test("an OpenCode 2 install registers one plugin entry and clears LitOpenCode from plugins and cli.json", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["other-plugin"], plugins: ["@litfamily/litopencode@1.0.0", "keep-me"] }, null, 2));
    const cliJson = `{\n  // my terminal settings\n  "theme": { "name": "opencode" },\n  "plugins": ["@litfamily/litopencode@1.0.0", { "package": "litopencode", "options": {} }, "herdr-tui"]\n}\n`;
    await fs.writeFile(path.join(dir, "cli.json"), cliJson);
    const result = runCli(["install", "--root", dir, "--host", "v2", "--yes"]);
    assert.equal(result.status, 0, result.stderr);

    const config = await readConfig(path.join(dir, "opencode.json"));
    assert.deepEqual(config.plugin, ["other-plugin", packageId]);
    assert.deepEqual(config.plugins, ["keep-me"]);
    assert.equal("permissions" in config, false);
    assert.equal("policies" in config, false);

    const cli = await fs.readFile(path.join(dir, "cli.json"), "utf8");
    assert.match(cli, /\/\/ my terminal settings/u);
    assert.deepEqual(parseJsonc(cli).plugins, ["herdr-tui"]);
    assert.equal(await fs.readFile(path.join(dir, "cli.json.litopencode-backup"), "utf8"), cliJson);
    assert.equal(await exists(path.join(dir, "tui.json")), false, "OpenCode 2 needs no tui.json entry");
  });
});

test("an OpenCode 2 install writes no alias for a plugin-owned command, and each lit command exists exactly once", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["install", "--root", dir, "--host", "v2", "--yes"]);
    assert.equal(result.status, 0, result.stderr);
    const aliasIds = (await fs.readdir(path.join(dir, "command"))).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3));
    const pluginOwned = pluginOwnedCommandIds([dir]);
    assert.deepEqual(pluginOwned, []);
    for (const id of pluginOwned) assert.ok(!aliasIds.includes(id), `alias written for plugin-owned ${id}`);
    const everyCommand = [...aliasIds.filter((id) => litOpenCodeCommands.some((command) => command.id === id)), ...pluginOwned];
    assert.deepEqual([...everyCommand].sort(), litOpenCodeCommands.map((command) => command.id).sort());
    assert.equal(new Set(everyCommand).size, everyCommand.length);
  });
});

test("cli.json alone is evidence of OpenCode 2, and both hosts get their surfaces when tui.json is there too", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "cli.json"), JSON.stringify({ plugins: ["litopencode"] }));
    const v2 = runCli(["install", "--root", dir, "--dry-run", "--yes"]);
    assert.equal(v2.status, 0, v2.stderr);
    const report = JSON.parse(v2.stdout);
    assert.equal(report.host.mode, "v2");
    assert.equal(report.cliJson.removed, 1);
    assert.equal(report.tui.changed, false);
    assert.equal(parseJsonc(await fs.readFile(path.join(dir, "cli.json"), "utf8")).plugins.length, 1, "a dry run writes nothing");

    await fs.writeFile(path.join(dir, "tui.json"), JSON.stringify({ plugin: [] }));
    const both = JSON.parse(runCli(["install", "--root", dir, "--dry-run", "--yes"]).stdout);
    assert.equal(both.host.mode, "both");
    assert.equal(both.tui.changed, true);
    assert.equal(both.cliJson.removed, 1);
  });
});

test("on the default root an OpenCode 2 host is never run: no `opencode plugin`, not even `--version`", async () => {
  await withTempDir(async (dir) => {
    const configHome = path.join(dir, "xdg");
    const binDir = path.join(dir, "bin");
    const cliPackage = path.join(dir, "lib", "node_modules", "@opencode", "cli");
    const log = path.join(dir, "calls.log");
    await fs.mkdir(path.join(configHome, "opencode"), { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(path.join(cliPackage, "bin"), { recursive: true });
    await fs.writeFile(path.join(cliPackage, "package.json"), JSON.stringify({ name: "@opencode/cli", version: "2.0.32" }));
    await fs.writeFile(path.join(cliPackage, "bin", "opencode.exe"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexit 9\n`, { mode: 0o755 });
    await fs.symlink(path.join(cliPackage, "bin", "opencode.exe"), path.join(binDir, "opencode"));
    const result = runCli(["install", "--yes", "--no-auto-update"], {
      env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, XDG_CONFIG_HOME: configHome }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await exists(log), false, "the OpenCode 2 binary was started");
    const configFile = (await exists(path.join(configHome, "opencode", "opencode.json"))) ? "opencode.json" : "opencode.jsonc";
    const config = await readConfig(path.join(configHome, "opencode", configFile));
    assert.equal(config.plugin.length, 1);
    assert.equal(await exists(path.join(configHome, "opencode", "tui.json")), false);
  });
});

// Review H1: OpenCode 1 installed outside npm (no package behind `opencode`) next to an npm OpenCode 2 as
// `opencode2` must still get `opencode plugin` and its tui.json entry, and OpenCode 2 its own surfaces.
async function hostBin(dir, { opencode, opencode2 }) {
  const binDir = path.join(dir, "bin");
  const log = path.join(dir, "calls.log");
  await fs.mkdir(binDir, { recursive: true });
  const fakeV1 = path.join(dir, "fake-opencode.mjs");
  await fs.writeFile(fakeV1, [
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    `await fs.appendFile(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`,
    "if (process.argv[2] !== 'plugin') process.exit(2);",
    "const configFile = path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'opencode.json');",
    "const parsed = JSON.parse(await fs.readFile(configFile, 'utf8'));",
    "const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : [];",
    "if (!plugins.includes(process.argv[3])) plugins.push(process.argv[3]);",
    "await fs.writeFile(configFile, JSON.stringify({ ...parsed, plugin: plugins }, null, 2) + '\\n');"
  ].join("\n"));
  const v2Package = path.join(dir, "lib", "node_modules", "@opencode", "cli");
  await fs.mkdir(path.join(v2Package, "bin"), { recursive: true });
  await fs.writeFile(path.join(v2Package, "package.json"), JSON.stringify({ name: "@opencode/cli", version: "2.0.32" }));
  await fs.writeFile(path.join(v2Package, "bin", "opencode.exe"), `#!/bin/sh\necho "v2 $@" >> ${JSON.stringify(log)}\nexit 9\n`, { mode: 0o755 });
  for (const [command, kind] of [["opencode", opencode], ["opencode2", opencode2]]) {
    if (kind === "v1-outside-npm") await fs.writeFile(path.join(binDir, command), "#!/bin/sh\nexec " + JSON.stringify(process.execPath) + " " + JSON.stringify(fakeV1) + ' "$@"\n', { mode: 0o755 });
    if (kind === "v2-npm") await fs.symlink(path.join(v2Package, "bin", "opencode.exe"), path.join(binDir, command));
  }
  return { binDir, log };
}

test("default root: an OpenCode 1 outside npm keeps its install next to an npm opencode2", async () => {
  await withTempDir(async (dir) => {
    const configHome = path.join(dir, "xdg");
    const root = path.join(configHome, "opencode");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: [] }, null, 2));
    await fs.writeFile(path.join(root, "tui.json"), JSON.stringify({ plugin: [] }, null, 2));
    const { binDir, log } = await hostBin(dir, { opencode: "v1-outside-npm", opencode2: "v2-npm" });
    const env = { ...process.env, PATH: binDir + path.delimiter + "/usr/bin:/bin", XDG_CONFIG_HOME: configHome };
    const dry = JSON.parse(runCli(["install", "--dry-run", "--yes", "--no-auto-update"], { env }).stdout);
    assert.equal(dry.host.mode, "both");
    const result = runCli(["install", "--yes", "--no-auto-update"], { env });
    assert.equal(result.status, 0, result.stderr);
    const calls = await fs.readFile(log, "utf8");
    assert.match(calls, /^plugin /mu, "OpenCode 1 got its `opencode plugin` run");
    assert.doesNotMatch(calls, /^v2 /mu, "the OpenCode 2 binary was started");
    const tui = await readConfig(path.join(root, "tui.json"));
    assert.equal(tui.plugin.length, 1, "OpenCode 1 got its TUI entry");
  });
});

test("review L2: --host v1 refuses when the only opencode is OpenCode 2, without starting it", async () => {
  await withTempDir(async (dir) => {
    const configHome = path.join(dir, "xdg");
    await fs.mkdir(path.join(configHome, "opencode"), { recursive: true });
    const { binDir, log } = await hostBin(dir, { opencode: "v2-npm" });
    const env = { ...process.env, PATH: binDir + path.delimiter + "/usr/bin:/bin", XDG_CONFIG_HOME: configHome };
    const result = runCli(["install", "--host", "v1", "--yes", "--no-auto-update"], { env });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /no OpenCode 1 command/iu);
    assert.equal(await exists(log), false, "the OpenCode 2 binary was started");
  });
});

test("review L8: the install receipt names no tui.json on an OpenCode 2-only install, and still does for OpenCode 1", async () => {
  await withTempDir(async (dir) => {
    const v2 = runCli(["install", "--root", dir, "--host", "v2", "--yes"]);
    assert.equal(v2.status, 0, v2.stderr);
    assert.doesNotMatch(v2.stdout, /TUI config/u);
    const v1 = runCli(["install", "--root", dir, "--host", "v1", "--yes"]);
    assert.equal(v1.status, 0, v1.stderr);
    assert.match(v1.stdout, /TUI config/u);
  });
});

test("review L1: an OpenCode 2 key that appears in the second config file during `opencode plugin` fails the install", async () => {
  await withTempDir(async (dir) => {
    const configHome = path.join(dir, "xdg");
    const root = path.join(configHome, "opencode");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: [] }, null, 2));
    await fs.writeFile(path.join(root, "opencode.jsonc"), JSON.stringify({ theme: "x" }, null, 2));
    const { binDir } = await hostBin(dir, { opencode: "v1-outside-npm" });
    const script = path.join(dir, "fake-opencode.mjs");
    await fs.appendFile(script, "\nawait fs.writeFile(path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'opencode.jsonc'), JSON.stringify({ theme: 'x', permissions: [] }));\n");
    const env = { ...process.env, PATH: binDir + path.delimiter + "/usr/bin:/bin", XDG_CONFIG_HOME: configHome };
    const result = runCli(["install", "--host", "v1", "--yes", "--no-auto-update"], { env });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /`permissions` key/u);
  });
});

test("review N1: an OpenCode 2 outside npm installed as `opencode` gets the OpenCode 2 setup, never `opencode plugin`", async () => {
  await withTempDir(async (dir) => {
    const configHome = path.join(dir, "xdg");
    const root = path.join(configHome, "opencode");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: [] }, null, 2));
    const before = await fs.readFile(path.join(root, "opencode.json"), "utf8");
    const binDir = path.join(dir, "bin");
    const log = path.join(dir, "calls.log");
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(binDir, "opencode"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nif [ "$1" = "--version" ]; then echo "2.0.32"; exit 0; fi\nexit 9\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: binDir + path.delimiter + "/usr/bin:/bin", XDG_CONFIG_HOME: configHome };

    const forced = runCli(["install", "--host", "v1", "--yes", "--no-auto-update"], { env });
    assert.equal(forced.status, 1, forced.stdout);
    assert.match(forced.stderr, /no OpenCode 1 command/iu);
    assert.equal(await fs.readFile(path.join(root, "opencode.json"), "utf8"), before, "config changed by a refused install");

    const result = runCli(["install", "--yes", "--no-auto-update"], { env });
    assert.equal(result.status, 0, result.stderr);
    const calls = await fs.readFile(log, "utf8");
    assert.doesNotMatch(calls, /^plugin /mu, "`opencode plugin` ran on OpenCode 2");
    assert.match(calls, /^--version$/mu);
    const config = await readConfig(path.join(root, "opencode.json"));
    assert.equal(config.plugin.length, 1);
    assert.equal(await exists(path.join(root, "tui.json")), false);
  });
});
