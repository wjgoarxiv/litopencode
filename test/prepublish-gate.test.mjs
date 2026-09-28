import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
const gateScript = "node tools/prepublish-test-gate.mjs";
const prepackReceipt = "prepack-ran";
const suiteReceipt = "suite-ran";

function runNpm(args, cwd, home) {
  const env = {
    ...process.env,
    HOME: home,
    NPM_CONFIG_USERCONFIG: path.join(home, ".npmrc"),
    npm_config_userconfig: path.join(home, ".npmrc"),
    NPM_CONFIG_CACHE: path.join(home, "npm-cache"),
    npm_config_cache: path.join(home, "npm-cache"),
    NPM_CONFIG_REGISTRY: "http://127.0.0.1:9",
    npm_config_registry: "http://127.0.0.1:9",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
  };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(npmCommand, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
    env,
  });
}

async function createFixture({ testCommand = "node --test", failingSuite = false } = {}) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-prepublish-gate-"));
  const root = path.join(scratch, "package");
  const home = path.join(scratch, "home");
  await fs.mkdir(root);
  await fs.mkdir(home);
  const scripts = {
    test: testCommand,
    prepublishOnly: packageJson.scripts.prepublishOnly,
    prepack: `node -e "require('node:fs').writeFileSync('${prepackReceipt}', 'yes')"`,
  };
  await fs.mkdir(path.join(root, "tools"));
  await fs.copyFile(
    new URL("../tools/prepublish-test-gate.mjs", import.meta.url),
    path.join(root, "tools", "prepublish-test-gate.mjs"),
  );
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "litopencode-prepublish-gate-fixture",
    version: "1.0.0",
    scripts,
  }, null, 2));
  if (failingSuite) {
    await fs.mkdir(path.join(root, "test"));
    await fs.writeFile(path.join(root, "test", "fails.test.mjs"), [
      'import assert from "node:assert/strict";',
      'import { spawnSync } from "node:child_process";',
      'import { existsSync } from "node:fs";',
      'import { writeFileSync } from "node:fs";',
      'import { test } from "node:test";',
      `writeFileSync(new URL("../${suiteReceipt}", import.meta.url), "yes");`,
      'test("nested npm pack still creates its tarball", () => {',
      '  const npmExecPath = process.env.npm_execpath;',
      '  const command = npmExecPath ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");',
      '  const args = npmExecPath ? [npmExecPath, "pack", "--ignore-scripts"] : ["pack", "--ignore-scripts"];',
      '  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8" });',
      '  assert.equal(result.status, 0, `${result.stdout}\\n${result.stderr}`);',
      '  assert.equal(existsSync("litopencode-prepublish-gate-fixture-1.0.0.tgz"), true);',
      '});',
      'test("intentional prepublish gate failure", () => assert.fail("intentional prepublish gate suite failure"));',
      "",
    ].join("\n"));
  }
  return { home, root, scratch };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function resultText(result) {
  return `${result.stdout}\n${result.stderr}`;
}

test("prepublishOnly runs npm test", () => {
  assert.equal(packageJson.scripts.prepublishOnly, gateScript);
});

test("publish refuses a failing suite before prepack", async () => {
  const fixture = await createFixture({ failingSuite: true });
  try {
    const result = runNpm([
      "publish", "--dry-run", "--offline", "--foreground-scripts", "--registry=http://127.0.0.1:9",
    ], fixture.root, fixture.home);

    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(result.status, 0, resultText(result));
    assert.match(resultText(result), /intentional prepublish gate suite failure/u);
    assert.equal(await exists(path.join(fixture.root, suiteReceipt)), true, "the failing suite must actually start");
    assert.equal(await exists(path.join(fixture.root, prepackReceipt)), false, "prepack must not run after refusal");
  } finally {
    await fs.rm(fixture.scratch, { recursive: true, force: true });
  }
});

test("publish refuses when the test command cannot start", async () => {
  const fixture = await createFixture({ testCommand: "litopencode-missing-test-runner" });
  try {
    const result = runNpm([
      "publish", "--dry-run", "--offline", "--foreground-scripts", "--registry=http://127.0.0.1:9",
    ], fixture.root, fixture.home);

    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(result.status, 0, resultText(result));
    assert.equal(await exists(path.join(fixture.root, prepackReceipt)), false, "prepack must not run after refusal");
  } finally {
    await fs.rm(fixture.scratch, { recursive: true, force: true });
  }
});

test("npm pack and npm install do not invoke the publish-only suite", async () => {
  const fixture = await createFixture({ failingSuite: true });
  try {
    const packed = runNpm(["pack", "--dry-run", "--json", "--pack-destination", fixture.root], fixture.root, fixture.home);
    assert.equal(packed.status, 0, resultText(packed));
    assert.equal(await exists(path.join(fixture.root, suiteReceipt)), false, "npm pack must not run npm test");
    assert.equal(await exists(path.join(fixture.root, prepackReceipt)), true, "npm pack should retain its existing prepack behavior");

    await fs.rm(path.join(fixture.root, prepackReceipt));
    const installed = runNpm([
      "install", "--offline", "--no-audit", "--no-fund", "--package-lock=false", "--ignore-scripts=false",
    ], fixture.root, fixture.home);
    assert.equal(installed.status, 0, resultText(installed));
    assert.equal(await exists(path.join(fixture.root, suiteReceipt)), false, "npm install must not run npm test");
    assert.equal(await exists(path.join(fixture.root, prepackReceipt)), false, "npm install must not run prepack");
  } finally {
    await fs.rm(fixture.scratch, { recursive: true, force: true });
  }
});
