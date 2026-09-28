import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

test("explicit flags reject every model route outside the offered provider menus", async () => {
  await withTempDir(async (dir) => {
    const rejected = [
      ["--provider", "openai", "--model", "gpt-5.5"],
      ["--provider", "anthropic", "--model", "gpt-5.6-luna"],
      ["--model", "custom-provider/custom-model"]
    ];

    for (const args of rejected) {
      const result = runCli(["install", "--root", dir, ...args]);
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stderr, /is not offered|provider must be one of/i);
    }
    await assert.rejects(fs.stat(path.join(dir, "litopencode.json")), { code: "ENOENT" });
  });
});

test("interactive chooser offers only the contract provider and model rows", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["install", "--root", dir, "--model-prompt"], { input: "\n0\n\n\n\n" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OpenAI GPT-6 family \/ GPT-5\.6 previous generation/);
    assert.match(result.stdout, /xAI Grok/);
    assert.match(result.stdout, /gpt-5\.6-sol\s+· xhigh/);
    assert.doesNotMatch(result.stdout, /OpenAI custom|Anthropic custom|Google custom|GitHub Copilot|OpenCode custom|Use OpenCode session default|Custom model/);
    const config = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    assert.equal(config.categories.planning.model, "gpt-6-astra");
    assert.equal(config.categories.planning.variant, "xhigh");
    assert.equal(config.categories.execution.model, "gpt-6-luna");
    assert.equal(config.categories.execution.variant, "max");
    assert.equal(config.categories.research.model, "gpt-6-luna");
    assert.equal(config.categories.research.variant, "max");
  });
});

test("explicit Luna selection rejects effort below high without writing config", async () => {
  // Given: a fresh isolated root and a Luna route below the supported effort floor.
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "litopencode.json");

    // When: deterministic flags request Luna/medium.
    const result = runCli([
      "install",
      "--root",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5.6-luna",
      "--effort",
      "medium"
    ]);

    // Then: validation fails before any route file is written.
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Luna.*high.*max/i);
    await assert.rejects(fs.stat(filePath), { code: "ENOENT" });
  });
});

test("custom routes are preserved by default and rewritten in managed keys only under --model-prompt", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "litopencode.json");
    const custom = {
      categories: Object.fromEntries(
        ["planning", "execution", "review", "research"].map((id) => [
          id,
          { provider: "custom-provider", model: "custom-model", variant: "high" }
        ])
      )
    };
    const before = JSON.stringify(custom, null, 4) + "\n";
    await fs.writeFile(filePath, before);

    const kept = runCli(["install", "--root", dir], { input: "" });
    assert.equal(kept.status, 0, kept.stderr);
    assert.equal(await fs.readFile(filePath, "utf8"), before);
    assert.doesNotMatch(kept.stdout, /Choose the provider/);
    assert.match(kept.stdout, /Existing route\s+custom-provider\/custom-model \(high\)/i);

    const forced = runCli(["install", "--root", dir, "--model-prompt"], { input: "\n\n\n\n\n" });
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /Choose the provider for LitOpenCode agents/);
    const config = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(config.categories.planning.model, "gpt-6-astra");
    assert.equal(config.categories.planning.variant, "xhigh");
    assert.equal(config.categories.execution.model, "gpt-6-luna");
    assert.equal(config.categories.execution.variant, "max");
  });
});

test("agent-only and nonstandard routes are preserved by default and survive a forced rewrite", async () => {
  const configs = [
    { agents: { "lit-loop": { category: "execution", provider: "custom-provider", model: "agent-model" } } },
    { categories: { custom: { provider: "custom-provider", model: "category-model", variant: "high" } } }
  ];

  for (const config of configs) {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "litopencode.json");
      const before = JSON.stringify(config, null, 2) + "\n";
      await fs.writeFile(filePath, before);

      const kept = runCli(["install", "--root", dir], { input: "" });
      assert.equal(kept.status, 0, kept.stderr);
      assert.equal(await fs.readFile(filePath, "utf8"), before);
      assert.doesNotMatch(kept.stdout, /Choose the provider/);
      assert.match(kept.stdout, /Route class\s+custom/i);

      const forced = runCli(["install", "--root", dir, "--model-prompt"], { input: "\n\n\n\n\n" });
      assert.equal(forced.status, 0, forced.stderr);
      const written = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (config.agents !== undefined) {
        assert.deepEqual(written.agents, config.agents);
      } else {
        assert.deepEqual(written.categories.custom, config.categories.custom);
      }
      assert.equal(written.categories.planning.model, "gpt-6-astra");
    });
  }
});
