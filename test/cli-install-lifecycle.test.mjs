import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { packageId, runCli, withTempDir } from "../test-support/cli-fixture.ts";

test("install preserves existing opencode config without echoing secrets", async () => {
  await withTempDir(async (dir) => {
    const fakeSecret = "fake-secret-for-install-redaction";
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ auth: { token: fakeSecret }, plugin: ["existing-plugin"] }, null, 2));
    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(fakeSecret));
    const output = JSON.parse(await fs.readFile(path.join(dir, "opencode.json"), "utf8"));
    assert.deepEqual(output.auth, { token: fakeSecret });
    assert.deepEqual(output.plugin, ["existing-plugin", packageId]);
    const litConfig = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    assert.equal(litConfig.agents["lit-plan"].category, "planning");
  });
});

test("install replaces tuple plugin entries and prunes duplicate litopencode entries", async () => {
  await withTempDir(async (dir) => {
    const pluginOptions = { enabled: true };
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [["litopencode@0.1.21", pluginOptions], "other-plugin", "litopencode"] }, null, 2));
    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(await fs.readFile(path.join(dir, "opencode.json"), "utf8"));
    assert.deepEqual(output.plugin, [[packageId, pluginOptions], "other-plugin"]);
  });
});

test("install preserves existing litopencode config", async () => {
  await withTempDir(async (dir) => {
    const existing = {
      agents: {
        "lit-loop": {
          provider: "openai",
          model: "custom-lit-loop",
          reasoningEffort: "medium"
        }
      }
    };
    await fs.writeFile(path.join(dir, "litopencode.json"), JSON.stringify(existing, null, 2));
    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /litopencode\.json preserved/);
    const litConfig = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    assert.deepEqual(litConfig, existing);
  });
});

test("install keeps plugin stable when current version is already present and creates missing route config", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [packageId] }, null, 2));
    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /plugin\[\] already ready/);
    assert.match(result.stdout, /litopencode\.json created/);
    const output = JSON.parse(await fs.readFile(path.join(dir, "opencode.json"), "utf8"));
    assert.deepEqual(output.plugin, [packageId]);
    assert.equal((await fs.stat(path.join(dir, "litopencode.json"))).isFile(), true);
  });
});

test("install replaces unversioned litopencode entries without duplicating the plugin", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["opencode-openai-codex-auth", "litopencode"] }, null, 2));
    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(await fs.readFile(path.join(dir, "opencode.json"), "utf8"));
    assert.deepEqual(output.plugin, ["opencode-openai-codex-auth", packageId]);
  });
});

for (const registration of ["named", "local-path", "intermediate-named", "intermediate-local-path"]) {
test(`default install migrates ${registration} tuples after OpenCode succeeds`, async () => {
  await withTempDir(async (dir) => {
    const configHome = path.join(dir, "xdg");
    const opencodeRoot = path.join(configHome, "opencode");
    const binDir = path.join(dir, "bin");
    const fakeOpenCode = path.join(binDir, "opencode");
    const fakeOpenCodeJs = path.join(dir, "fake-opencode.mjs");
    const configFile = path.join(opencodeRoot, "opencode.json");
    const stalePackage = path.join(dir, "stale-litopencode");

    await fs.mkdir(opencodeRoot, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(stalePackage, { recursive: true });
    await fs.writeFile(path.join(stalePackage, "package.json"), JSON.stringify({ name: registration.startsWith("intermediate-") ? "@litfamily/opencode" : "litopencode" }, null, 2));
    await fs.writeFile(configFile, JSON.stringify({ plugin: ["opencode-openai-codex-auth", [registration === "named" ? "litopencode@0.0.2" : registration === "intermediate-named" ? "@litfamily/opencode@0.2.7" : stalePackage, { enabled: true, custom: "preserved" }], stalePackage] }, null, 2));
    await fs.writeFile(fakeOpenCodeJs, [
      "import fs from 'node:fs/promises';",
      "import path from 'node:path';",
      "if (process.argv[2] !== 'plugin') process.exit(2);",
      "if (process.env.PHASE5_HOST_FAIL === '1') process.exit(23);",
      "if (process.env.PHASE5_HOST_NOOP === '1') process.exit(0);",
      "const target = process.argv[3];",
      "const configFile = path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'opencode.json');",
      "const parsed = JSON.parse(await fs.readFile(configFile, 'utf8'));",
      "const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : [];",
      "if (!plugins.includes(target)) plugins.push(target);",
      "await fs.writeFile(configFile, JSON.stringify({ ...parsed, plugin: plugins }, null, 2) + '\\n');"
    ].join("\n"));
    await fs.writeFile(fakeOpenCode, "#!/bin/sh\nexec node " + JSON.stringify(fakeOpenCodeJs) + ' "$@"\n');
    await fs.chmod(fakeOpenCode, 0o755);

    const originalRegistration = await fs.readFile(configFile);
    const noop = runCli(["install", "--yes", "--no-auto-update"], {
      env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, XDG_CONFIG_HOME: configHome, PHASE5_HOST_NOOP: "1" }
    });
    assert.equal(noop.status, 1, noop.stderr);
    assert.match(noop.stderr, /did not register the requested package target/);
    assert.deepEqual(await fs.readFile(configFile), originalRegistration);
    const result = runCli(["install"], {
      env: {
        ...process.env,
        PATH: binDir + path.delimiter + process.env.PATH,
        XDG_CONFIG_HOME: configHome
      }
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(await fs.readFile(configFile, "utf8"));
    const sourceRoot = await fs.realpath(process.cwd());
    const localSource = await Promise.all([
      fs.stat(path.join(sourceRoot, ".git")).then(() => true, () => false),
      fs.stat(path.join(sourceRoot, "src")).then((stat) => stat.isDirectory(), () => false)
    ]).then((conditions) => conditions.every(Boolean));
    const expectedInstallTarget = localSource ? sourceRoot : packageId;
    assert.deepEqual(output.plugin, ["opencode-openai-codex-auth", [expectedInstallTarget, { enabled: true, custom: "preserved" }]]);
    const configBeforeFailure = await fs.readFile(configFile);
    const failed = runCli(["install", "--yes", "--no-auto-update"], {
      env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, XDG_CONFIG_HOME: configHome, PHASE5_HOST_FAIL: "1" }
    });
    assert.equal(failed.status, 1, failed.stderr);
    assert.deepEqual(await fs.readFile(configFile), configBeforeFailure);
    const repeat = runCli(["install", "--yes", "--no-auto-update"], {
      env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, XDG_CONFIG_HOME: configHome }
    });
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.deepEqual(JSON.parse(await fs.readFile(configFile, "utf8")).plugin, output.plugin);
    const litConfig = JSON.parse(await fs.readFile(path.join(opencodeRoot, "litopencode.json"), "utf8"));
    assert.equal(litConfig.agents["lit-loop"].category, "execution");
  });
});

}
