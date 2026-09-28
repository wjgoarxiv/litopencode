import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repositoryRoot = path.resolve(".");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...options
  });
}

async function withTempDir(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-runtime-deps-"));
  try {
    await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function packInto(directory) {
  const packed = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory]);
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(packed.stdout)[0];
  return path.join(directory, metadata.filename);
}

async function makeConsumer(directory, name) {
  const consumer = path.join(directory, name);
  await fs.mkdir(consumer);
  await fs.writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({ name, version: "1.0.0", private: true }, null, 2) + "\n"
  );
  return consumer;
}

function isolatedNpmEnv(directory, suffix, strict = false) {
  const home = path.join(directory, `home-${suffix}`);
  return {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: path.join(directory, `tmp-${suffix}`),
    npm_config_cache: path.join(directory, `npm-cache-${suffix}`),
    npm_config_engine_strict: strict ? "true" : "false",
    PATH: process.env.PATH
  };
}

test("packed consumer installs do not resolve effect/ini and stay engine-clean", async () => {
  await withTempDir(async (directory) => {
    const archive = await packInto(directory);
    const plainConsumer = await makeConsumer(directory, "plain-consumer");
    const strictConsumer = await makeConsumer(directory, "strict-consumer");

    const plain = run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", archive], {
      cwd: plainConsumer,
      env: isolatedNpmEnv(directory, "plain")
    });
    const strict = run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", archive], {
      cwd: strictConsumer,
      env: isolatedNpmEnv(directory, "strict", true)
    });
    const plainOutput = `${plain.stdout}\n${plain.stderr}`;
    const strictOutput = `${strict.stdout}\n${strict.stderr}`;

    assert.equal(plain.status, 0, plainOutput);
    assert.doesNotMatch(plainOutput, /EBADENGINE/u, plainOutput);
    assert.equal(strict.status, 0, strictOutput);

    const tree = run("npm", ["ls", "ini", "effect", "--all", "--json", "--depth=6"], {
      cwd: strictConsumer,
      env: isolatedNpmEnv(directory, "strict-tree", true)
    });
    const parsed = JSON.parse(tree.stdout);
    assert.equal(parsed.dependencies?.ini, undefined, JSON.stringify(parsed, null, 2));
    assert.equal(parsed.dependencies?.effect, undefined, JSON.stringify(parsed, null, 2));
  });
});

test("runtime tool factory owns the zod schema and keeps the host package type-only", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies?.zod, "4.1.8");
  assert.equal(packageJson.dependencies?.["@opencode-ai/plugin"], undefined);
  assert.equal(packageJson.devDependencies?.["@opencode-ai/plugin"], "^1.17.6");

  const [{ z }, { tool }] = await Promise.all([
    import("zod"),
    import("../src/tool-kit.ts")
  ]);
  assert.equal(tool.schema, z);
  const schema = tool.schema.string().describe("runtime dependency probe").optional();
  assert.equal(schema.safeParse(undefined).success, true);
  assert.equal(schema.safeParse("registered").success, true);
  assert.equal(schema.safeParse(42).success, false);
});
