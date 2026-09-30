import { withMarkTerminal } from "../test-support/lit-mark-fixture.mjs";
import { banner, lockup } from "../src/lit-mark.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

const categories = ["planning", "execution", "review", "research"];
const leadCategories = ["planning", "review"];
const helperCategories = ["execution", "research"];

// A pinned host catalog so the xai menu never depends on the developer's ~/.cache.
const fixtureCatalog = {
  xai: {
    id: "xai",
    env: ["XAI_API_KEY"],
    models: {
      "grok-4.6": { id: "grok-4.6", reasoning: true, release_date: "2026-08-12", reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }] },
      "grok-4.5": { id: "grok-4.5", reasoning: true, release_date: "2026-07-08", reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }] },
      "grok-4.3": { id: "grok-4.3", reasoning: true, release_date: "2026-04-17", reasoning_options: [{ type: "effort", values: ["low", "high"] }] },
      "grok-4.20-0309-non-reasoning": { id: "grok-4.20-0309-non-reasoning", reasoning: false, release_date: "2026-03-09" },
      "grok-imagine-image-2.0": { id: "grok-imagine-image-2.0", reasoning: false, release_date: "2026-08-07" }
    }
  },
  openai: { id: "openai", env: ["OPENAI_API_KEY"], models: { "gpt-5.6-luna": { id: "gpt-5.6-luna", reasoning: true } } }
};

async function withHostEnv(dir, run) {
  const cacheHome = path.join(dir, "xdg-cache");
  const dataHome = path.join(dir, "xdg-data");
  await fs.mkdir(path.join(cacheHome, "opencode"), { recursive: true });
  await fs.mkdir(path.join(dataHome, "opencode"), { recursive: true });
  await fs.writeFile(path.join(cacheHome, "opencode", "models.json"), JSON.stringify(fixtureCatalog));
  const env = { ...process.env, XDG_CACHE_HOME: cacheHome, XDG_DATA_HOME: dataHome, NO_COLOR: "1" };
  env.OPENAI_API_KEY = "openai-credential-sentinel";
  delete env.XAI_API_KEY;
  delete env.CI;
  await run(env, { cacheHome, dataHome });
}

async function readRoutes(dir) {
  return JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8")).categories;
}

test("explicit flags route lead and helper categories separately across providers", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (env) => {
      const result = runCli(
        ["install", "--root", dir, "--provider", "xai", "--model", "grok-4.6", "--effort", "xhigh", "--subagent-model", "openai/gpt-5.6-luna", "--subagent-effort", "max"],
        { env }
      );
      assert.equal(result.status, 0, result.stderr);
      const routes = await readRoutes(dir);
      for (const id of leadCategories) {
        assert.equal(routes[id].provider, "xai");
        assert.equal(routes[id].model, "grok-4.6");
        assert.equal(routes[id].variant, "xhigh");
      }
      for (const id of helperCategories) {
        assert.equal(routes[id].provider, "openai");
        assert.equal(routes[id].model, "gpt-5.6-luna");
        assert.equal(routes[id].variant, "max");
      }
      assert.match(result.stdout, /╭─ MODEL ROUTE/u);
      assert.match(result.stdout, /│ Provider\s+xai \/ openai/u);
      assert.match(result.stdout, /│ Lead\s+grok-4\.6 · xhigh/u);
      assert.match(result.stdout, /│ Helpers\s+gpt-5\.6-luna · max/u);
      assert.match(result.stdout, /XAI_API_KEY/u);
    });
  });
});

test("openai lead models default to their policy effort while an omitted helper keeps Luna/max", async () => {
  const matrix = [
    ["gpt-6-astra", "xhigh"],
    ["gpt-5.6-sol", "xhigh"],
    ["gpt-5.6-luna", "max"],
    ["gpt-5.6", "high"],
    ["gpt-5.6-terra", "xhigh"]
  ];
  for (const [model, effort] of matrix) {
    await withTempDir(async (dir) => {
      await withHostEnv(dir, async (env) => {
        const result = runCli(["install", "--root", dir, "--provider", "openai", "--model", model], { env });
        assert.equal(result.status, 0, result.stderr);
        const routes = await readRoutes(dir);
        for (const id of leadCategories) {
          assert.equal(routes[id].provider, "openai", model);
          assert.equal(routes[id].model, model);
          assert.equal(routes[id].variant, effort, model);
        }
        for (const id of helperCategories) {
          assert.equal(routes[id].provider, "openai", model);
          assert.equal(routes[id].model, "gpt-6-luna", model);
          assert.equal(routes[id].variant, "max", model);
        }
      });
    });
  }
});

test("an unknown model id or forbidden pair is refused before any write", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (env) => {
      const rejected = [
        [["--provider", "xai", "--model", "grok-99"], /grok-99/u],
        [["--provider", "openai", "--model", "gpt-5.5"], /gpt-5\.5/u],
        [["--provider", "anthropic", "--model", "claude"], /anthropic/u],
        [["--provider", "openai", "--model", "gpt-5.6-luna", "--effort", "xhigh"], /Luna.*high.*max/iu],
        [["--provider", "openai", "--model", "gpt-6-astra-fast"], /gpt-6-astra-fast|not offered/iu],
        [["--provider", "xai", "--model", "grok-4.6", "--effort", "max"], /grok-4\.6.*max/iu],
        [["--provider", "openai", "--model", "gpt-5.6-sol", "--subagent-model", "xai/grok-99"], /grok-99/u]
      ];
      for (const [args, message] of rejected) {
        const result = runCli(["install", "--root", dir, ...args], { env });
        assert.equal(result.status, 2, args.join(" "));
        assert.match(result.stderr, message, args.join(" "));
      }
      await assert.rejects(fs.stat(path.join(dir, "litopencode.json")), { code: "ENOENT" });
    });
  });
});

test("interactive chooser asks provider, lead, helper provider, helper in contract order and writes xai lead routes", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (env) => {
      // provider=xai, lead=grok-4.6, helper provider=<default xai>, helper=<default>, Enter to continue
      const result = runCli(["install", "--root", dir, "--model-prompt"], { env, input: "1\n0\n\n\n\n" });
      assert.equal(result.status, 0, result.stderr);
      const out = result.stdout;
      assert.match(out, /Choose the provider for LitOpenCode agents\.\n\s+0\. OpenAI GPT-6 family \/ GPT-5\.6 previous generation\s+\(openai\)\n\s+1\. xAI Grok\s+\(xai\)\nSelect 0-1 \[0\]:/u);
      assert.match(out, /Choose the LEAD model \(plans and reviews\)\./u);
      assert.match(out, /0\. grok-4\.6\s+· xhigh/u);
      assert.match(out, /1\. grok-4\.5\s+· high/u);
      assert.match(out, /2\. grok-4\.3\s+· high/u);
      assert.doesNotMatch(out, /grok-imagine|non-reasoning/u);
      assert.ok(out.indexOf("Choose the provider for LitOpenCode agents.") < out.indexOf("Choose the LEAD model"));
      assert.ok(out.indexOf("Choose the LEAD model") < out.indexOf("Choose the provider for HELPER agents"));
      assert.ok(out.indexOf("Choose the provider for HELPER agents") < out.indexOf("Choose the HELPER model"));
      assert.match(out, /Choose the provider for HELPER agents[^\n]*\n[\s\S]*?Select 0-1 \[1\]:/u);
      assert.match(out, /╭─ MODEL ROUTE\n│ Provider\s+xai\n│ Lead\s+grok-4\.6 · xhigh\n│ Helpers\s+grok-4\.6 · xhigh\n│ Writes\s+\S*litopencode\.json\s+\(managed keys only\)\n│ Warning\s+XAI_API_KEY is not set[^\n]*\n╰─ Enter to continue · Ctrl-C to abort \(nothing written yet\)/u);
      const routes = await readRoutes(dir);
      for (const id of categories) {
        assert.equal(routes[id].provider, "xai");
        assert.equal(routes[id].model, "grok-4.6");
        assert.equal(routes[id].variant, "xhigh");
      }
    });
  });
});

test("existing role routes are loaded as the model picker defaults", async () => {
  await withTempDir(async (dir) => {
    const current = {
      categories: {
        planning: { provider: "openai", model: "gpt-5.6-sol", variant: "xhigh" },
        execution: { provider: "openai", model: "gpt-5.6-luna", variant: "max" },
        review: { provider: "openai", model: "gpt-5.6-sol", variant: "xhigh" },
        research: { provider: "openai", model: "gpt-5.6-luna", variant: "max" }
      }
    };
    await fs.writeFile(path.join(dir, "litopencode.json"), JSON.stringify(current, null, 2) + "\n");
    const { readInstallModelSelection } = await import("../dist/cli/install-config.js");
    assert.deepEqual(await readInstallModelSelection(dir), {
      provider: "openai",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      helper: { provider: "openai", model: "gpt-5.6-luna", effort: "max" }
    });
  });
});

test("openai menu lists Astra plus the legacy rows and the helper menu defaults to Luna", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (env) => {
      // provider=openai(default), lead=sol(default), helper provider default, helper default(luna), Enter
      const result = runCli(["install", "--root", dir, "--model-prompt"], { env, input: "\n\n\n\n\n" });
      assert.equal(result.status, 0, result.stderr);
      const out = result.stdout;
      assert.match(out, /0\. gpt-6-astra\s+· xhigh\s+— frontier reasoning \(recommended lead\)/u);
      assert.match(out, /1\. gpt-6\.1-sol\s+· xhigh\s+— coding lead \(recommended alternative\)/u);
      assert.match(out, /2\. gpt-6-luna\s+· max\s+— balanced \(recommended helper\)/u);
      assert.match(out, /3\. gpt-6-sol\s+· xhigh\s+— coding lead, previous generation/u);
      assert.match(out, /4\. gpt-5\.6-sol\s+· xhigh\s+— deepest reasoning, previous generation/u);
      assert.match(out, /5\. gpt-5\.6-luna\s+· max\s+— balanced, previous generation/u);
      assert.match(out, /6\. gpt-5\.6\s+· high\s+— previous generation/u);
      assert.match(out, /7\. gpt-5\.6-terra\s+· xhigh\s+— previous generation/u);
      assert.match(out, /Choose the HELPER model[^\n]*\n[\s\S]*?Select 0-7 \[2\]:/u);
      assert.doesNotMatch(out, /Warning/u);
      const routes = await readRoutes(dir);
      for (const id of leadCategories) {
        assert.equal(routes[id].model, "gpt-6-astra");
        assert.equal(routes[id].variant, "xhigh");
      }
      for (const id of helperCategories) {
        assert.equal(routes[id].model, "gpt-6-luna");
        assert.equal(routes[id].variant, "max");
      }
    });
  });
});

test("--model-prompt forces the prompt on a gpt56_other route; without it the route is kept", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (env) => {
      const filePath = path.join(dir, "litopencode.json");
      const other = {
        categories: Object.fromEntries(categories.map((id) => [id, { provider: "openai", model: "gpt-5.6-luna-fast", variant: "max" }]))
      };
      const before = JSON.stringify(other, null, 2) + "\n";
      await fs.writeFile(filePath, before);

      const kept = runCli(["install", "--root", dir], { env });
      assert.equal(kept.status, 0, kept.stderr);
      assert.equal(await fs.readFile(filePath, "utf8"), before);
      assert.doesNotMatch(kept.stdout, /Choose the provider/u);
      assert.match(kept.stdout, /Route class\s+gpt56_other/u);

      const forced = runCli(["install", "--root", dir, "--model-prompt"], { env, input: "\n\n\n\n\n" });
      assert.equal(forced.status, 0, forced.stderr);
      assert.match(forced.stdout, /Choose the provider for LitOpenCode agents/u);
      const routes = await readRoutes(dir);
      assert.equal(routes.planning.model, "gpt-6-astra");
      assert.equal(routes.execution.model, "gpt-6-luna");
    });
  });
});

test("--yes keeps today's split shipped route and never prompts", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (env) => {
      const result = runCli(["install", "--root", dir, "--yes", "--model-prompt"], { env, input: "1\n0\n" });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /Choose the provider/u);
      const routes = await readRoutes(dir);
      for (const id of leadCategories) {
        assert.equal(routes[id].provider, "openai");
        assert.equal(routes[id].model, "gpt-6-astra");
        assert.equal(routes[id].variant, "xhigh");
      }
      for (const id of helperCategories) {
        assert.equal(routes[id].provider, "openai");
        assert.equal(routes[id].model, "gpt-6-luna");
        assert.equal(routes[id].variant, "max");
      }
    });
  });
});

test("route policy normalises a -fast id before every guard", async () => {
  const { diagnoseModelRoutes } = await import("../dist/model-route-policy.js");
  const codes = (route) => diagnoseModelRoutes({ agent: route }).map((diagnostic) => diagnostic.code);
  assert.deepEqual(codes({ provider: "openai", model: "gpt-5.6-luna-fast", variant: "xhigh" }), ["luna_xhigh_forbidden"]);
  assert.deepEqual(codes({ model: "openai/gpt-5.6-luna-fast", variant: "medium" }), ["luna_effort_below_high"]);
  assert.deepEqual(codes({ model: "openai/gpt-5.6-terra-fast", variant: "low" }), ["terra_effort_below_high"]);
  assert.deepEqual(codes({ provider: "openai", model: "gpt-5.6-luna-fast", variant: "max" }), []);
  assert.deepEqual(codes({ provider: "openai", model: "gpt-6-astra-fast", variant: "xhigh" }), []);
});

test("installer refuses a -fast id whose effort breaks the policy before any write", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (env) => {
      const filePath = path.join(dir, "litopencode.json");
      const unsafe = {
        categories: Object.fromEntries(categories.map((id) => [id, { provider: "openai", model: "gpt-5.6-luna-fast", variant: "xhigh" }]))
      };
      const before = JSON.stringify(unsafe, null, 2) + "\n";
      await fs.writeFile(filePath, before);
      const result = runCli(["install", "--root", dir], { env });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Luna plus xhigh is forbidden/u);
      assert.equal(await fs.readFile(filePath, "utf8"), before);
    });
  });
});

test("install banner renders the family frame with product, version and stage frame", async () => {
  const installTui = await import("../dist/cli/install-tui.js");
  const output = withMarkTerminal(() => installTui.renderInstallTuiLogo("litopencode@0.2.1"), { color: false });
  const rule = "  " + "━".repeat(46);
  assert.equal(output.split("\n").filter((line) => line === rule).length, 2);
  const expectedWordmark = lockup("litopencode v0.2.1", banner).join("\n");
  assert.ok(output.includes(expectedWordmark), "canonical LIT mark and product lockup missing");
  assert.doesNotMatch(output, /🔥  l  i  t  opencode/u);
  for (const line of expectedWordmark.split("\n")) assert.ok(Array.from(line).length <= 80, line);
  assert.match(output, /\n  ╭─ INSTALL\n(  │ 0[1-5] · [^\n]+\n){5}  ╰─ /u);
  assert.match(output, /│ 01 · Resolve\s{2,}Resolve package root/u);
});
