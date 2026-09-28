import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { litOpenCodeAgents, registerLitOpenCodeAgents } from "../src/agents.ts";
import { createChatMessageActivationHook } from "../src/activation.ts";
import { defaultGlobalConfigFile, mergeConfigs } from "../src/config.ts";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-recursion-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function activationOutput(id, text) {
  return {
    message: { id: `msg_${id}`, sessionID: `session-${id}`, role: "user" },
    parts: [
      {
        id: `part-${id}`,
        sessionID: `session-${id}`,
        messageID: `msg_${id}`,
        type: "text",
        text
      }
    ]
  };
}

test("subagent-mode agents never receive the task tool so delegation stays depth-one", () => {
  const config = {};

  registerLitOpenCodeAgents(config);

  const subagents = litOpenCodeAgents.filter((agent) => agent.mode === "subagent");
  assert.ok(subagents.length > 0, "roster should include subagent-mode agents");
  for (const agent of subagents) {
    assert.equal(config.agent[agent.id].tools.task, false, `${agent.id} should not expose the task tool`);
    assert.equal(config.agent[agent.id].permission.task, "deny", `${agent.id} should deny task permission`);
  }
  for (const id of ["build", "plan"]) {
    assert.equal(config.agent[id].tools.task, false, `${id} should not expose the task tool`);
    assert.equal(config.agent[id].permission.task, "deny", `${id} should deny task permission`);
  }
});

test("subagent task lockdown survives user overrides in every permission mode", () => {
  for (const permissionMode of [undefined, "balanced", "yolo"]) {
    const config = {};
    const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
      ...(permissionMode === undefined ? {} : { permissionMode }),
      agents: {
        "lit-explorer": {
          tools: { task: true },
          permission: { task: "allow" }
        }
      }
    });

    registerLitOpenCodeAgents(config, litConfig);

    const label = permissionMode ?? "default";
    assert.equal(config.agent["lit-explorer"].tools.task, false, `${label} mode should keep the task tool disabled`);
    assert.equal(config.agent["lit-explorer"].permission.task, "deny", `${label} mode should keep task permission denied`);
  }
});

test("primary task grants never escalate an explicit per-agent task deny", () => {
  for (const permissionMode of ["balanced", "yolo"]) {
    const config = {};
    const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
      permissionMode,
      agents: { "lit-loop": { permission: { task: "deny" } } }
    });

    registerLitOpenCodeAgents(config, litConfig);

    assert.equal(config.agent["lit-loop"].permission.task, "deny", `${permissionMode} must preserve an explicit deny`);
    assert.equal(config.agent["lit-implement"].permission.task, "allow", `${permissionMode} still grants unconfigured primaries`);
  }
});

test("primary task grants inherit explicit global task policies", () => {
  for (const taskPolicy of ["ask", "deny"]) {
    const config = { permission: { task: taskPolicy } };
    const litConfig = mergeConfigs(defaultGlobalConfigFile(), { permissionMode: "yolo" });

    registerLitOpenCodeAgents(config, litConfig);

    assert.equal(config.permission.task, taskPolicy, "the global task rule must survive untouched");
    for (const id of ["lit-loop", "lit-implement"]) {
      assert.equal(config.agent[id].permission.task, taskPolicy, `${id} must not override the global task policy`);
    }
    assert.equal(config.agent["lit-plan"].permission.task, "deny", "lit-plan must not inherit a delegating global policy");
    assert.equal(config.agent["lit-plan"].tools.task, false);
  }
});

test("permission modes preserve explicit global string task policy behind the runtime guard", () => {
  for (const permissionMode of ["yolo", "balanced"]) {
    const config = { permission: "allow" };
    const litConfig = mergeConfigs(defaultGlobalConfigFile(), { permissionMode });

    registerLitOpenCodeAgents(config, litConfig);

		assert.equal(config.permission.task, "allow", `${permissionMode} must preserve the explicit global policy`);
    assert.equal(config.permission.edit, "allow", `${permissionMode} should keep other expanded keys`);
    for (const id of ["lit-loop", "lit-implement"]) {
      assert.equal(config.agent[id].permission.task, "allow", `${permissionMode} should allow task on primary ${id}`);
    }
    assert.equal(config.agent["lit-plan"].permission.task, "deny", `${permissionMode} must keep lit-plan non-delegating`);
    assert.equal(config.agent["lit-plan"].tools.task, false);
  }
});

test("global string task policy remains effective for custom primary agents", () => {
  for (const permissionMode of ["yolo", "balanced"]) {
    for (const taskPolicy of ["ask", "deny"]) {
      const config = { permission: taskPolicy, agent: { custom: { mode: "primary" } } };
      const litConfig = mergeConfigs(defaultGlobalConfigFile(), { permissionMode });
      registerLitOpenCodeAgents(config, litConfig);
      assert.equal(config.permission.task, taskPolicy);
      assert.equal(config.agent.custom.mode, "primary");
      assert.equal(config.agent.custom.permission, undefined);
    }
  }
});

test("permission modes do not invent a global task policy for an unconfigured user", () => {
	for (const permissionMode of ["yolo", "balanced"]) {
		const config = {};
		const litConfig = mergeConfigs(defaultGlobalConfigFile(), { permissionMode });
		registerLitOpenCodeAgents(config, litConfig);
		assert.equal("task" in config.permission, false, `${permissionMode} must leave global task unset`);
	}
});

test("chat activation skips child sessions even when delegated prompts contain triggers", async () => {
  await withTempDir(async (dir) => {
    const hook = createChatMessageActivationHook(dir, {
      getSession: async () => ({ parentID: "session-root" })
    });
    const output = activationOutput("child", "lit-crucible read-only lane: inspect the repo. lit");

    await hook({ sessionID: "session-child", messageID: "msg_child", agent: "lit-loop" }, output);

    assert.equal(output.parts.length, 1, "child sessions must not receive activation injections");
  });
});

test("chat activation remains available to confirmed root sessions", async () => {
  await withTempDir(async (dir) => {
    const hook = createChatMessageActivationHook(dir, {
      getSession: async () => ({ parentID: undefined })
    });
    const output = activationOutput("root", "lit");

    await hook({ sessionID: "session-root", messageID: "msg_root", agent: "lit-loop" }, output);

    assert.equal(output.parts.length, 2);
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-task");
  });
});

test("chat activation lookup errors fail closed for primary agent ids", async () => {
  await withTempDir(async (dir) => {
    const hook = createChatMessageActivationHook(dir, {
      getSession: async () => {
        throw new Error("session lookup unavailable");
      }
    });
    const output = activationOutput("lookup-error", "lit");

    await hook({ sessionID: "session-lookup-error", messageID: "msg_lookup_error", agent: "lit-loop" }, output);

    assert.equal(output.parts.length, 1, "unknown lineage must never reopen child prompt injection");
  });
});

test("chat activation missing lineage fails closed for primary agent ids", async () => {
  await withTempDir(async (dir) => {
    const hook = createChatMessageActivationHook(dir, {
      getSession: async () => undefined
    });
    const output = activationOutput("missing-lineage", "lit");

    await hook({ sessionID: "session-missing", messageID: "msg_missing", agent: "lit-loop" }, output);

    assert.equal(output.parts.length, 1, "missing lineage must never reopen child prompt injection");
  });
});

test("chat activation without a lineage surface skips known subagent agent ids", async () => {
  await withTempDir(async (dir) => {
    const hook = createChatMessageActivationHook(dir);
    const output = activationOutput("known-subagent", "lit-crucible lane. lit");

    await hook({ sessionID: "session-known-subagent", messageID: "msg_known_subagent", agent: "lit-explorer" }, output);

    assert.equal(output.parts.length, 1, "known subagents must not receive activation without lineage support");
  });
});
