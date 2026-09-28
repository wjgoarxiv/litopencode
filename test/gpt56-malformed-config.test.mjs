import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const packageJson = JSON.parse(fsSync.readFileSync(path.resolve("package.json"), "utf8"));
const binPath = path.resolve(packageJson.bin.litopencode);

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-malformed-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

test("installer rejects malformed JSON before prompting or writing", async () => {
  // Given: a malformed installer route file.
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "litopencode.json");
    const before = "{ malformed-json\n";
    await fs.writeFile(filePath, before);

    // When: install attempts to classify the current route.
    const result = runCli(["install", "--root", dir, "--model-prompt"]);

    // Then: it fails closed and preserves the original bytes without temp residue.
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CONFIG_ERROR: Malformed LitOpenCode config/i);
    assert.equal(await fs.readFile(filePath, "utf8"), before);
    assert.deepEqual((await fs.readdir(dir)).sort(), ["litopencode.json"]);
  });
});

test("installer rejects a malformed managed-looking route before mutation", async () => {
  // Given: four legacy-looking categories with an invalid providerOptions boundary value.
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "litopencode.json");
    const config = {
      categories: Object.fromEntries(
        ["planning", "execution", "review", "research"].map((category) => [
          category,
          {
            provider: "openai",
            model: "gpt-5.5",
            variant: "high",
            textVerbosity: "medium",
            ...(category === "planning" ? { providerOptions: ["invalid"] } : {})
          }
        ])
      )
    };
    const before = JSON.stringify(config, null, 2) + "\n";
    await fs.writeFile(filePath, before);

    // When: install validates before offering a migration.
    const result = runCli(["install", "--root", dir, "--model-prompt"]);

    // Then: invalid route schema is reported and no file is changed or left behind.
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CONFIG_ERROR: Malformed LitOpenCode config.*providerOptions/is);
    assert.equal(await fs.readFile(filePath, "utf8"), before);
    assert.deepEqual((await fs.readdir(dir)).sort(), ["litopencode.json"]);
  });
});
