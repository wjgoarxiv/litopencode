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

function runNpm(args, cwd, home, extraEnv = {}) {
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
  delete env.LITOPENCODE_PUBLISH_FROM_CI;
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
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

test("a publish without the CI flag still runs the full suite, even inside Actions", async () => {
  const fixture = await createFixture({ failingSuite: true });
  try {
    const result = runNpm([
      "publish", "--dry-run", "--offline", "--foreground-scripts", "--registry=http://127.0.0.1:9",
    ], fixture.root, fixture.home, { GITHUB_ACTIONS: "true" });

    assert.notEqual(result.status, 0, resultText(result));
    assert.equal(await exists(path.join(fixture.root, suiteReceipt)), true, "the suite must run without the CI flag");
    assert.doesNotMatch(resultText(result), /the suite is not run again/u);
  } finally {
    await fs.rm(fixture.scratch, { recursive: true, force: true });
  }
});

test("the CI flag outside GitHub Actions refuses the publish before prepack", async () => {
  const fixture = await createFixture({ failingSuite: true });
  try {
    const result = runNpm([
      "publish", "--dry-run", "--offline", "--foreground-scripts", "--registry=http://127.0.0.1:9",
    ], fixture.root, fixture.home, { LITOPENCODE_PUBLISH_FROM_CI: "1", GITHUB_ACTIONS: undefined });

    assert.notEqual(result.status, 0, resultText(result));
    assert.match(resultText(result), /prepublish test gate refused: not a GitHub Actions run/u);
    assert.equal(await exists(path.join(fixture.root, suiteReceipt)), false, "the flag must not run the suite");
    assert.equal(await exists(path.join(fixture.root, prepackReceipt)), false, "prepack must not run after refusal");
  } finally {
    await fs.rm(fixture.scratch, { recursive: true, force: true });
  }
});

const sha = "0123456789abcdef0123456789abcdef01234567";
const ciEnv = { GITHUB_ACTIONS: "true", GITHUB_SHA: sha, GITHUB_REPOSITORY: "wjgoarxiv/litopencode", GITHUB_TOKEN: "gh-token" };
const cleanGit = (args) => (args[0] === "rev-parse" ? sha : "");
const respond = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const greenRun = { workflow_runs: [{ id: 99, head_sha: sha, conclusion: "success" }] };

test("the CI verdict passes only for a green ci.yml push run on the same clean commit", async () => {
  const { readCiVerdict } = await import("../tools/prepublish-test-gate.mjs");
  const requests = [];
  const fetchRun = async (url, init) => {
    requests.push({ url, authorization: init.headers.authorization });
    return respond(greenRun)();
  };
  const verdict = await readCiVerdict({ env: ciEnv, fetchRun, git: cleanGit });
  assert.equal(verdict.ok, true, verdict.detail);
  assert.deepEqual(requests, [{
    url: `https://api.github.com/repos/wjgoarxiv/litopencode/actions/workflows/ci.yml/runs?head_sha=${sha}&status=success&event=push&per_page=1`,
    authorization: "Bearer gh-token",
  }]);
});

test("the CI verdict refuses a missing, foreign, failed or unreadable run and an unfit checkout", async () => {
  const { readCiVerdict } = await import("../tools/prepublish-test-gate.mjs");
  const otherSha = "f".repeat(40);
  const cases = [
    { name: "no matching run", fetchRun: respond({ workflow_runs: [] }), expected: /no successful ci\.yml push run/u },
    { name: "other sha", fetchRun: respond({ workflow_runs: [{ id: 1, head_sha: otherSha, conclusion: "success" }] }), expected: /no successful/u },
    { name: "failure conclusion", fetchRun: respond({ workflow_runs: [{ id: 1, head_sha: sha, conclusion: "failure" }] }), expected: /no successful/u },
    { name: "HTTP error", fetchRun: respond({ message: "Bad credentials" }, 401), expected: /answered 401/u },
    { name: "offline", fetchRun: async () => { throw new TypeError("fetch failed"); }, expected: /unreachable: fetch failed/u },
    { name: "HEAD mismatch", git: (args) => (args[0] === "rev-parse" ? otherSha : ""), expected: /checkout is not/u, offline: true },
    { name: "dirty tree", git: (args) => (args[0] === "rev-parse" ? sha : "?? stray.txt"), expected: /local changes/u, offline: true },
    { name: "not in Actions", env: { ...ciEnv, GITHUB_ACTIONS: "false" }, expected: /not a GitHub Actions run/u, offline: true },
    { name: "bad repository string", env: { ...ciEnv, GITHUB_REPOSITORY: "wjgoarxiv/litopencode/../other" }, expected: /not a GitHub Actions run/u, offline: true },
  ];
  for (const testCase of cases) {
    let called = false;
    const fetchRun = testCase.fetchRun ?? respond(greenRun);
    const verdict = await readCiVerdict({
      env: testCase.env ?? ciEnv,
      git: testCase.git ?? cleanGit,
      fetchRun: async (...args) => { called = true; return fetchRun(...args); },
    });
    assert.equal(verdict.ok, false, testCase.name);
    assert.match(verdict.detail, testCase.expected, testCase.name);
    if (testCase.offline) assert.equal(called, false, `${testCase.name} must refuse before calling the GitHub API`);
  }
});

test("the publish workflow trusts the ci.yml run and holds no token, push or direct upload", async () => {
  const workflow = await fs.readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
  const forbidden = ["npm publi" + "sh", "NPM_" + "TOKEN", "NODE_AUTH_" + "TOKEN", "git pu" + "sh", "git ta" + "g", "--access publi" + "c"];
  assert.deepEqual(forbidden.filter((term) => workflow.includes(term)), []);
  assert.match(workflow, /^on:\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^ {2}(?:push|pull_request|schedule|release|workflow_run):/mu);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /permissions:\n {6}contents: read\n {6}actions: read\n {6}id-token: write/u);
  assert.doesNotMatch(workflow, /: write\b(?<!id-token: write)/u);
  assert.match(workflow, /LITOPENCODE_PUBLISH_FROM_CI: "1"/u);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(workflow, /timeout-minutes: 15/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.doesNotMatch(workflow, /run: npm test/u, "the suite belongs to ci.yml");
  for (const gate of ["npm run typecheck", "npm run scan:legacy-tokens", "npm run check:version", "node tools/check-pack-payload.mjs", "node tools/prepublish-test-gate.mjs", "npm stage publish"]) {
    assert.ok(workflow.includes(`run: ${gate}`), `publish.yml must run ${gate}`);
  }
});
