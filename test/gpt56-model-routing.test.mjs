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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-gpt56-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options
  });
}

test("writes the explicit legacy lead route while fresh helpers use GPT-6 Luna", async () => {
  // Given: an isolated OpenCode root with no LitOpenCode route config.
  await withTempDir(async (dir) => {
    // When: the installer receives an explicit canonical model and supported effort.
    const result = runCli([
      "install",
      "--root",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5.6-luna",
      "--effort",
      "max"
    ]);

    // Then: the explicit lead route is preserved while fresh helper defaults use GPT-6 Luna/max.
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    for (const category of ["planning", "review"]) {
      assert.equal(config.categories[category].provider, "openai");
      assert.equal(config.categories[category].model, "gpt-5.6-luna");
      assert.equal(config.categories[category].variant, "max");
    }
    for (const category of ["execution", "research"]) {
      assert.equal(config.categories[category].provider, "openai");
      assert.equal(config.categories[category].model, "gpt-6-luna");
      assert.equal(config.categories[category].variant, "max");
    }
    const serialized = JSON.stringify(config);
    assert.doesNotMatch(serialized, /contextWindow|context_window|compaction|concurrency|maxConcurrent/i);
    assert.match(result.stdout, /Context ceiling 372K\s+hard/i);
    assert.match(result.stdout, /Compaction 334\.8K\s+hard/i);
    assert.match(result.stdout, /Concurrency 20\s+advisory/i);
    assert.match(result.stdout, /Existing route\s+fresh/i);
    assert.match(result.stdout, /Effort\s+max/i);
  });
});

test("writes the 372K host ceiling and 90 percent compaction reserve for the offered model", async () => {
  // Given: an isolated OpenCode root with unrelated provider settings.
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, "opencode.json");
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          provider: { openai: { models: { "custom-model": { limit: { context: 1000, output: 100 } } } } }
        },
        null,
        2
      ) + "\n"
    );

    // When: the installer configures an offered OpenAI route.
    const result = runCli([
      "install",
      "--root",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5.6-luna",
      "--effort",
      "high"
    ]);

    // Then: the offered model receives the exact 372K ceiling and 37.2K reserve yields a 334.8K trigger.
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.deepEqual(config.compaction, { auto: true, reserved: 37200 });
    for (const model of ["gpt-6-luna", "gpt-5.6-luna"]) {
      assert.deepEqual(config.provider.openai.models[model].limit, {
        context: 372000,
        input: 372000,
        output: 128000
      });
    }
    assert.deepEqual(config.provider.openai.models["custom-model"].limit, { context: 1000, output: 100 });
  });
});

test("preserves host limits until the user explicitly selects LUNA", async () => {
  // Given: an existing third-party OpenCode config with a version-pinned LitOpenCode plugin.
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, "opencode.json");
    const before =
      JSON.stringify(
        {
          plugin: [packageJson.name + "@" + packageJson.version],
          compaction: { auto: false, reserved: 12345 },
          provider: { "third-party": { models: { alpha: { limit: { context: 8000, output: 1000 } } } } }
        },
        null,
        2
      ) + "\n";
    await fs.writeFile(configPath, before);

    // When: the installer runs without model selection or an interactive model prompt.
    const result = runCli(["install", "--root", dir, "--no-model-prompt"]);

    // Then: it creates LitOpenCode routes without rewriting the user-owned host model or compaction config.
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fs.readFile(configPath, "utf8"), before);
    assert.match(result.stdout, /context and compaction limits preserved; select\s+LUNA to reconfigure/i);
  });
});

test("fails closed when an existing OpenCode host-limit container is malformed", async () => {
  // Given: an isolated root with a non-object provider container that must not be replaced.
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, "opencode.json");
    const before = JSON.stringify({ provider: "invalid" }, null, 2) + "\n";
    await fs.writeFile(configPath, before);

    // When: the installer applies the host-native context policy.
    const result = runCli([
      "install",
      "--root",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5.6-luna",
      "--effort",
      "high"
    ]);

    // Then: it rejects the malformed container and leaves the user file byte-identical.
    assert.equal(result.status, 1);
    assert.equal(await fs.readFile(configPath, "utf8"), before);
    assert.match(result.stderr, /Malformed OpenCode host config: provider must be an object/i);
  });
});

test("defaults the explicit interactive chooser to the Astra lead and Luna helper rows", async () => {
  // Given: a fresh isolated root and an explicitly requested model chooser.
  await withTempDir(async (dir) => {
    // When: the user accepts every recommended default.
    const result = runCli(["install", "--root", dir, "--model-prompt"], { input: "\n\n\n\n\n" });

    // Then: planning/review get the recommended lead, execution/research the recommended helper.
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    for (const category of ["planning", "review"]) {
      assert.equal(config.categories[category].provider, "openai");
      assert.equal(config.categories[category].model, "gpt-6-astra");
      assert.equal(config.categories[category].variant, "xhigh");
    }
    for (const category of ["execution", "research"]) {
      assert.equal(config.categories[category].provider, "openai");
      assert.equal(config.categories[category].model, "gpt-6-luna");
      assert.equal(config.categories[category].variant, "max");
    }
  });
});

test("reports configured hard 372K and 334.8K OpenCode capability states", async () => {
  // Given: a normal isolated install with deterministic Luna/high routing.
  await withTempDir(async (dir) => {
    const install = runCli([
      "install",
      "--root",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5.6-luna",
      "--effort",
      "high"
    ]);
    assert.equal(install.status, 0, install.stderr);

    // When: doctor inspects the installed surface.
    const doctor = runCli(["doctor", "--root", dir]);

    // Then: it distinguishes configured host-enforced limits from the advisory worker ceiling.
    assert.equal(doctor.status, 0, doctor.stderr);
    const output = JSON.parse(doctor.stdout);
    assert.equal(output.capabilities.contextCeiling372k.status, "hard");
    assert.equal(output.capabilities.autoCompaction334800.status, "hard");
    assert.equal(output.capabilities.subagentConcurrency20.status, "advisory");
    assert.equal(output.hostLimits.status, "configured");
    assert.equal(output.hostLimits.contextCeilingTokens, 372000);
    assert.equal(output.hostLimits.compactionTriggerTokens, 334800);
    assert.match(output.capabilities.subagentConcurrency20.reason, /20/);
  });
});

test("classifies only a homogeneous four-category GPT-5.5 route as managed legacy", async () => {
  // Given: the exact homogeneous legacy category shape written by an older installer.
  await withTempDir(async (dir) => {
    const legacy = {
      categories: Object.fromEntries(
        ["planning", "execution", "review", "research"].map((category) => [
          category,
          { provider: "openai", model: "gpt-5.5", variant: "high", textVerbosity: "medium" }
        ])
      ),
      agents: {
        "lit-loop": { category: "execution" },
        "lit-plan": { category: "planning" }
      }
    };
    await fs.writeFile(path.join(dir, "litopencode.json"), JSON.stringify(legacy, null, 2) + "\n");

    // When: a dry run reads the route without reconfiguration consent.
    const result = runCli(["install", "--root", dir, "--dry-run"]);

    // Then: the report marks managed legacy and proposes no model rewrite.
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.litopencodeConfig.model.classification, {
      class: "managed_legacy",
      originalDispatchId: "openai/gpt-5.5"
    });
    assert.equal(report.litopencodeConfig.model.changed, false);
  });
});

test("reports a preserved provider-qualified dispatch and variant instead of session default", async () => {
  // Given: a homogeneous provider-qualified alias that is user-owned, not package-managed legacy.
  await withTempDir(async (dir) => {
    const config = {
      categories: Object.fromEntries(
        ["planning", "execution", "review", "research"].map((category) => [
          category,
          { model: "openai/gpt-5.5", variant: "high", textVerbosity: "medium" }
        ])
      )
    };
    await fs.writeFile(path.join(dir, "litopencode.json"), JSON.stringify(config, null, 2) + "\n");

    // When: install preserves current routes without reopening the chooser.
    const result = runCli(["install", "--root", dir, "--no-model-prompt"]);

    // Then: the report names the original dispatch and effort rather than a session default.
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Existing route\s+openai\/gpt-5\.5 \(high\)/i);
    assert.doesNotMatch(result.stdout, /Existing route\s+managed_legacy/i);
    assert.doesNotMatch(result.stdout, /Model\s+OpenCode session default/i);
  });
});

test("preserves mixed and false-positive routes byte-identically without explicit consent", async () => {
  // Given: a mixed current/custom config including the gpt-5.60 false-positive boundary.
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "litopencode.json");
    const mixed = {
      categories: {
        planning: { provider: "openai", model: "gpt-5.6-sol", variant: "high" },
        execution: { provider: "openai", model: "gpt-5.6-terra", variant: "xhigh" },
        review: { provider: "openai", model: "gpt-5.60", variant: "medium" },
        research: { provider: "custom-provider", model: "custom-model", variant: "high" }
      },
      agents: { "lit-loop": { category: "execution", model: "agent-override" } }
    };
    const before = JSON.stringify(mixed, null, 4) + "\n";
    await fs.writeFile(filePath, before);

    // When: install disables the model prompt.
    const result = runCli(["install", "--root", dir, "--no-model-prompt"]);

    // Then: model routing bytes are unchanged and no unsupported limit key appears.
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fs.readFile(filePath, "utf8"), before);
    assert.doesNotMatch(before, /context|compaction|concurr/i);
  });
});

test("rejects an out-of-range legacy picker choice without changing route config bytes", async () => {
  // Given: a homogeneous legacy route eligible for an interactive upgrade offer.
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "litopencode.json");
    const legacy = {
      categories: Object.fromEntries(
        ["planning", "execution", "review", "research"].map((category) => [
          category,
          { provider: "openai", model: "gpt-5.4", variant: "high", textVerbosity: "medium" }
        ])
      )
    };
    const before = JSON.stringify(legacy, null, 3) + "\n";
    await fs.writeFile(filePath, before);

    // When: the user attempts a third model choice that is not SOL or TERRA.
    const result = runCli(["install", "--root", dir, "--model-prompt"], { input: "5\n" });

    // Then: selection fails closed and the route file remains byte-identical.
    assert.equal(result.status, 1);
    assert.equal(await fs.readFile(filePath, "utf8"), before);
    assert.match(result.stdout, /managed GPT-5\.4\/GPT-5\.5 route detected/i);
    assert.match(result.stderr, /Invalid selection: 5/);
  });
});

test("repeats an explicit Luna max route with stable bytes across every category", async () => {
  // Given: an isolated root and deterministic Luna/max flags.
  await withTempDir(async (dir) => {
    const args = [
      "install",
      "--root",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5.6-luna",
      "--effort",
      "max"
    ];
    const first = runCli(args);
    assert.equal(first.status, 0, first.stderr);
    const filePath = path.join(dir, "litopencode.json");
    const before = await fs.readFile(filePath, "utf8");

    // When: the same deterministic install runs again.
    const second = runCli(args);

    // Then: the route bytes are stable and every category uses Luna/max.
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await fs.readFile(filePath, "utf8"), before);
    const config = JSON.parse(before);
    for (const category of ["planning", "review"]) {
      assert.equal(config.categories[category].model, "gpt-5.6-luna");
      assert.equal(config.categories[category].variant, "max");
    }
    for (const category of ["execution", "research"]) {
      assert.equal(config.categories[category].model, "gpt-6-luna");
      assert.equal(config.categories[category].variant, "max");
    }
  });
});
