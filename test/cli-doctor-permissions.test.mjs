import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { litOpenCodeAgents } from "../src/agents.ts";
import { packageId, packageVersion, runCli, withTempDir } from "../test-support/cli-fixture.ts";

test("doctor reports package, config, and state paths without writing runtime files", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["doctor", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.package.name, "@litfamily/litopencode");
    assert.equal(output.package.version, packageVersion);
    assert.equal(output.config.source, "defaults");
    assert.equal(output.opencodeConfig.path, path.join(path.resolve(dir), "litopencode.json"));
    assert.equal(output.opencodeConfig.exists, false);
    assert.equal(output.install.ok, false);
    assert.equal(output.install.plugin.ok, false);
    assert.equal(output.install.plugin.expected, packageId);
    assert.equal(output.install.commandAliases.ok, false);
    assert.match(output.install.commandAliases.path, /command$/);
    assert.ok(output.install.commandAliases.missing.includes("lit"));
    assert.ok(output.install.commandAliases.missing.includes("start-work"));
    assert.equal(output.install.nativeSkills.ok, false);
    assert.match(output.install.nativeSkills.path, /skills$/);
    assert.ok(output.install.nativeSkills.missing.includes("workflow-loop"));
    assert.ok(output.install.nativeSkills.missing.includes("lit-crucible"));
    assert.deepEqual(output.opencodeConfig.effective["lit-loop"], {
      agentId: "lit-loop",
      provider: "openai",
      model: "openai/gpt-6-astra",
      variant: "xhigh",
      reasoningEffort: "xhigh",
      status: "configured"
    });
    assert.deepEqual(Object.keys(output.opencodeConfig.effective), litOpenCodeAgents.map((agent) => agent.id));
    assert.deepEqual(output.opencodeConfig.routeDiagnostics, []);
    assert.equal(output.state.runtimeDir, path.join(path.resolve(dir), ".litopencode"));
    assert.equal(output.state.runtimeExists, false);
    await assert.rejects(fs.stat(path.join(dir, ".litopencode")), { code: "ENOENT" });
  });
});

test("doctor diagnoses unsafe model routes without rewriting user config", async () => {
  // Given: a user-owned route file containing low-effort and conflicting Luna overrides.
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "litopencode.json");
    const before = JSON.stringify(
      {
        agents: {
          "lit-loop": { provider: "openai", model: "gpt-5.6-luna", variant: "medium" },
          "lit-librarian": { provider: "openai", model: "gpt-5.6-luna", variant: "low" },
          "lit-explorer": {
            provider: "openai",
            model: "gpt-5.6-luna",
            variant: "high",
            reasoningEffort: "xhigh"
          }
        }
      },
      null,
      2
    ) + "\n";
    await fs.writeFile(filePath, before);

    // When: the read-only doctor inspects effective authored-agent routes.
    const result = runCli(["doctor", "--root", dir]);

    // Then: both unsafe routes are reported and the original bytes are preserved.
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.opencodeConfig.routeDiagnostics, [
      { agentId: "lit-loop", code: "luna_effort_below_high", model: "openai/gpt-5.6-luna", effort: "medium" },
      { agentId: "lit-librarian", code: "luna_effort_below_high", model: "openai/gpt-5.6-luna", effort: "low" },
      {
        agentId: "lit-explorer",
        code: "luna_xhigh_forbidden",
        model: "openai/gpt-5.6-luna",
        effort: "variant=high, reasoningEffort=xhigh"
      },
      {
        agentId: "lit-explorer",
        code: "luna_effort_conflict",
        model: "openai/gpt-5.6-luna",
        effort: "variant=high, reasoningEffort=xhigh"
      }
    ]);
    assert.equal(await fs.readFile(filePath, "utf8"), before);
  });
});

test("doctor names partial plugin, command alias, and native skill install gaps without writing", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [packageId] }, null, 2));
    await fs.mkdir(path.join(dir, "command"), { recursive: true });
    await fs.writeFile(path.join(dir, "command", "lit.md"), "# custom lit command\n");
    await fs.mkdir(path.join(dir, "skills", "workflow-loop"), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", "workflow-loop", "SKILL.md"), "# custom workflow loop\n");

    const result = runCli(["doctor", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.install.ok, false);
    assert.equal(output.install.plugin.ok, true);
    assert.equal(output.install.commandAliases.ok, false);
    assert.ok(output.install.commandAliases.present.includes("lit"));
    assert.ok(output.install.commandAliases.missing.includes("start-work"));
    assert.equal(output.install.nativeSkills.ok, false);
    assert.ok(output.install.nativeSkills.present.includes("workflow-loop"));
    assert.ok(output.install.nativeSkills.missing.includes("lit-crucible"));
    await assert.rejects(fs.stat(path.join(dir, ".litopencode")), { code: "ENOENT" });
  });
});

test("install dry-run prints exact opencode.json mutation without writing", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["install", "--dry-run", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.dryRun, true);
    assert.equal(output.path, path.join(path.resolve(dir), "opencode.json"));
    assert.deepEqual(output.plugin, {
      alreadyPresent: false,
      currentCount: 0,
      resultCount: 1,
      add: [packageId]
    });
    assert.deepEqual(output.patch, [{ op: "add", path: "/plugin", value: [packageId] }]);
    assert.equal(output.changed, true);
    assert.deepEqual(output.litopencodeConfig, {
      path: path.join(path.resolve(dir), "litopencode.json"),
      alreadyPresent: false,
      changed: true,
      agents: [
        "lit-loop",
        "lit-plan",
        "lit-implement",
        "lit-architect",
        "lit-forge",
        "lit-oracle",
        "lit-prover",
        "lit-sentinel",
        "lit-librarian",
        "lit-explorer",
        "lit-archive-researcher",
        "lit-verdict-oracle",
        "lit-strategy-planner",
        "lit-forge-worker",
        "lit-systems-architect",
        "lit-critical-reviewer",
        "lit-context-cartographer",
        "lit-persistence-runner"
      ],
      categories: ["planning", "execution", "review", "research"],
      model: {
        classification: { class: "fresh", originalDispatchId: null },
        changed: false
      },
      permissionMode: {
        mode: "safe",
        changed: false
      },
      outputStyle: {
        style: "off",
        changed: false
      }
    });
    assert.equal(Object.hasOwn(output, "before"), false);
    assert.equal(Object.hasOwn(output, "after"), false);
    await assert.rejects(fs.stat(path.join(dir, "opencode.json")), { code: "ENOENT" });
    await assert.rejects(fs.stat(path.join(dir, "litopencode.json")), { code: "ENOENT" });
    await assert.rejects(fs.stat(path.join(dir, ".litopencode")), { code: "ENOENT" });
  });
});

for (const [label, args, expected] of [
  ["YOLO", ["--yolo"], "yolo"],
  ["balanced", ["--permission-mode", "balanced"], "balanced"]
]) {
  test(`install dry-run previews explicit ${label} permission mode without writing`, async () => {
    await withTempDir(async (dir) => {
      const result = runCli(["install", "--dry-run", "--root", dir, ...args]);

      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.dryRun, true);
      assert.equal(output.litopencodeConfig.permissionMode.mode, expected);
      assert.equal(output.litopencodeConfig.permissionMode.changed, true);
      assert.equal(output.litopencodeConfig.changed, true);
      assert.equal(output.changed, true);
      await assert.rejects(fs.stat(path.join(dir, "opencode.json")), { code: "ENOENT" });
      await assert.rejects(fs.stat(path.join(dir, "litopencode.json")), { code: "ENOENT" });
    });
  });
}

test("install dry-run previews explicit safe mode as a downgrade from existing automation", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "litopencode.json"), JSON.stringify({ permissionMode: "yolo" }, null, 2));
    const result = runCli(["install", "--dry-run", "--root", dir, "--permission-mode", "safe"]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.litopencodeConfig.permissionMode.mode, "safe");
    assert.equal(output.litopencodeConfig.permissionMode.changed, true);
    assert.equal(output.litopencodeConfig.changed, true);
  });
});

test("install writes explicit safe mode to clear existing automation preference", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "litopencode.json"), JSON.stringify({ permissionMode: "balanced" }, null, 2));
    const result = runCli(["install", "--root", dir, "--no-model-prompt", "--permission-mode", "safe"]);

    assert.equal(result.status, 0, result.stderr);
    const litConfig = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    assert.equal(litConfig.permissionMode, "safe");
  });
});

test("install permission prompt writes selected balanced mode", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["install", "--root", dir, "--no-model-prompt", "--permission-prompt"], { input: "1\n" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Choose LitOpenCode permission behavior/);
    assert.match(result.stdout, /Permissions\s+Balanced/);
    const litConfig = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    assert.equal(litConfig.permissionMode, "balanced");
  });
});

test("install dry-run does not echo existing opencode secrets", async () => {
  await withTempDir(async (dir) => {
    const fakeSecret = "fake-secret-for-dry-run-redaction";
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ auth: { token: fakeSecret }, plugin: ["existing-plugin"] }, null, 2));
    const result = runCli(["install", "--dry-run", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(fakeSecret));
    const output = JSON.parse(result.stdout);
    assert.equal(output.dryRun, true);
    assert.equal(output.path, path.join(path.resolve(dir), "opencode.json"));
    assert.deepEqual(output.plugin.add, [packageId]);
    assert.equal(output.plugin.currentCount, 1);
    assert.equal(output.plugin.resultCount, 2);
    assert.equal(output.litopencodeConfig.changed, true);
    assert.deepEqual(output.patch, [{ op: "add", path: "/plugin/-", value: packageId }]);
    assert.equal(output.changed, true);
    assert.equal(Object.hasOwn(output, "before"), false);
    assert.equal(Object.hasOwn(output, "after"), false);
  });
});

test("doctor fails clearly on malformed LitOpenCode config", async () => {
  await withTempDir(async (dir) => {
    const runtime = path.join(dir, ".litopencode");
    await fs.mkdir(runtime);
    await fs.writeFile(path.join(runtime, "config.json"), "{ bad-json");
    const result = runCli(["doctor", "--root", dir]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CONFIG_ERROR: Malformed LitOpenCode config/);
  });
});

test("install writes explicit YOLO permission mode and doctor reports it", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["install", "--root", dir, "--yolo"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Permissions\s+YOLO/);
    assert.match(result.stdout, /Restart OpenCode/);
    const litConfig = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    assert.equal(litConfig.permissionMode, "yolo");
    const doctor = runCli(["doctor", "--root", dir]);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).opencodeConfig.permissionMode, "yolo");
  });
});
