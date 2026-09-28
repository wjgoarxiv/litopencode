import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const toolPath = path.resolve("tools/run-harness-speed-local.mjs");

async function loadTool() {
  // Given: Todo 6 requires one provider-free OpenCode benchmark executable.
  const present = await fs.stat(toolPath).then(() => true, () => false);
  // When/Then: the focused test stays RED until that real tool exists.
  assert.equal(present, true, "Todo 6 benchmark tool is missing");
  return import(pathToFileURL(toolPath).href);
}

async function withFakePackage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-speed-tool-test-"));
  const packageRoot = path.join(root, "package");
  await fs.mkdir(path.join(packageRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "litopencode", version: "0.2.1", type: "module" }));
  await fs.writeFile(path.join(packageRoot, "dist", "index.js"), String.raw`
    import fs from "node:fs/promises";
    import path from "node:path";
    export default async function plugin(input) {
      return {
        async config(config) {
          config.agent = { "lit-loop": { prompt: "packed-agent-prompt", model: "openai/gpt-5.6-luna" } };
          config.default_agent = "lit-loop";
        },
        async "experimental.chat.system.transform"(hookInput, output) {
          output.system.push("<litopencode-repository-rules>" + input.directory + "</litopencode-repository-rules>");
        },
        async "chat.message"(hookInput, output) {
          const text = output.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
          if (!text.startsWith("lit\n")) return;
          output.parts.push({
            id: "prt_activation",
            sessionID: hookInput.sessionID,
            messageID: hookInput.messageID,
            type: "text",
            text: "🔥 LIT IGNITED · lit-loop 🔥\npacked activation",
            metadata: { litopencode: { mode: "lit-loop", source: "chat.message" } }
          });
          const ledger = path.join(input.directory, ".litopencode", "litgoal", "lit-loop", "ledger.jsonl");
          await fs.mkdir(path.dirname(ledger), { recursive: true });
          await fs.appendFile(ledger, JSON.stringify({ type: "prompt.activated", mode: "lit-loop", sessionID: hookInput.sessionID }) + "\n");
        },
        async dispose() {}
      };
    }
  `);
  try {
    await callback({ root, packageRoot });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("summarizes local monotonic samples with nearest-rank p50 and p95", async () => {
  const { summarizeDurations } = await loadTool();

  const summary = summarizeDurations([5, 1, 4, 3, 2]);

  assert.deepEqual(summary, { samples: 5, p50_ms: 3, p95_ms: 5 });
});

test("replays packed OpenCode hooks without a provider and removes isolated profiles", async () => {
  const { runPackedLocalBenchmark } = await loadTool();
  await withFakePackage(async ({ root, packageRoot }) => {
    const scenarioPath = path.resolve("qa/fixtures/litfamily-harness-speed-v1.json");

    const receipt = await runPackedLocalBenchmark({
      arm: "candidate",
      artifactSha256: "a".repeat(64),
      head: "4d4fa72648dc1b0277a4d8787768828b66ee3de8",
      packageRoot,
      samples: 12,
      scenarioPath,
      scratchParent: root
    });

    assert.equal(receipt.schema, "litfamily.harness-speed-local/v1");
    assert.equal(receipt.provider_completions, 0);
    assert.deepEqual(Object.keys(receipt.phases), [
      "packed_startup_config",
      "rules_transform",
      "no_route_floor",
      "chat_message_lit_activation_ledger",
      "s2_continuation",
      "local_total"
    ]);
    assert.equal(receipt.correctness.route, "lit-loop");
    assert.equal(receipt.correctness.banner, true);
    assert.equal(receipt.correctness.ledger_current_session, true);
    assert.equal(receipt.correctness.sentinel_fixture_only, true);
    assert.equal(receipt.correctness.provider_response_observed, false);
    assert.equal(receipt.adversarial.prompt_injection_inert, true);
    assert.equal(receipt.adversarial.stale_ledger_ignored, true);
    assert.equal(receipt.context_bytes.activation > 0, true);
    assert.deepEqual(receipt.cleanup, {
      temp_profiles_created: 12,
      temp_profiles_removed: 12,
      residual_temp_profiles: 0,
      processes_started: 0,
      processes_remaining: 0
    });
    assert.equal(JSON.stringify(receipt).includes("LIT_SPEED_"), false);
  });
});
