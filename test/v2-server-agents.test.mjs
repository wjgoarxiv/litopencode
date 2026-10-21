import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { litOpenCodeAgents } from "../src/agents.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

// On OpenCode 2 the agents arrive through ctx.agent.transform instead of the `config` hook. Permission
// names follow the host's renames (bash -> shell, task -> subagent, write/patch -> edit), and the last
// matching rule wins, so the planner's denials must come last.
async function withProject(permissionMode, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-agents-"));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  try {
    if (permissionMode !== undefined) {
      await fs.mkdir(path.join(dir, ".litopencode"), { recursive: true });
      await fs.writeFile(path.join(dir, ".litopencode", "config.json"), JSON.stringify({ permissionMode }));
    }
    await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function setupAgents(dir) {
  const fake = createFakeV2Context({ directory: dir });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  const editor = fake.applyAgents();
  return { fake, editor, cleanup };
}

const v1PermissionNames = ["bash", "task", "write", "patch"];

test("every LitOpenCode agent is created with its prompt, mode, steps and colour, and lit-loop is the default", async () => {
  await withProject(undefined, async (dir) => {
    const { editor, cleanup } = await setupAgents(dir);
    try {
      assert.equal(editor.defaultAgent(), "lit-loop");
      for (const agent of litOpenCodeAgents) {
        const created = editor.get(agent.id);
        assert.ok(created, agent.id);
        assert.match(created.system, /\S/u, agent.id);
        assert.equal(created.description, agent.summary, agent.id);
        assert.equal(created.mode, agent.mode === "primary" ? "all" : "subagent", agent.id);
        assert.equal(created.steps, agent.maxSteps, agent.id);
        assert.equal(created.color, agent.color, agent.id);
        for (const rule of created.permissions) assert.ok(!v1PermissionNames.includes(rule.action), `${agent.id} keeps ${rule.action}`);
      }
    } finally {
      await cleanup();
    }
  });
});

test("the host build and plan agents are hidden subagents that cannot start subagents", async () => {
  await withProject(undefined, async (dir) => {
    const { editor, cleanup } = await setupAgents(dir);
    try {
      for (const id of ["build", "plan"]) {
        const agent = editor.get(id);
        assert.equal(agent.mode, "subagent", id);
        assert.equal(agent.hidden, true, id);
        assert.deepEqual(agent.permissions.at(-1), { action: "subagent", resource: "*", effect: "deny" }, id);
      }
    } finally {
      await cleanup();
    }
  });
});

for (const mode of ["safe", "balanced", "yolo"]) {
  test(`lit-plan ends with edit, shell, subagent and Code Mode execute denials in ${mode} mode`, async () => {
    await withProject(mode, async (dir) => {
      const { fake, editor, cleanup } = await setupAgents(dir);
      try {
        const rules = editor.get("lit-plan").permissions;
        const tail = rules.slice(-4).map((rule) => `${rule.action}:${rule.resource}:${rule.effect}`).sort();
        assert.deepEqual(tail, ["edit:*:deny", "execute:*:deny", "shell:*:deny", "subagent:*:deny"]);
        // OpenCode 2 drops a tool from the request when the last rule matching its action denies "*"
        // (review M2: Code Mode `execute` can run `fetch` and catalog tools, so lit-plan must not get it).
        for (const action of ["edit", "shell", "subagent", "execute"]) {
          const last = rules.filter((rule) => rule.action === action || rule.action === "*").at(-1);
          assert.equal(`${last.resource}:${last.effect}`, "*:deny", `${mode} ${action}`);
        }
        // The host evaluates rules first; the permission hook is the second lock.
        const evaluation = { sessionID: "ses_1", agent: "lit-plan", action: "shell", resources: ["rm -rf ."], effect: "allow" };
        await fake.run("permission", "evaluate", evaluation);
        assert.equal(evaluation.effect, "deny");
        const codeMode = { sessionID: "ses_1", agent: "lit-plan", action: "execute", resources: ["*"], effect: "allow" };
        await fake.run("permission", "evaluate", codeMode);
        assert.equal(codeMode.effect, "deny");
        const other = { sessionID: "ses_1", agent: "lit-loop", action: "shell", resources: ["ls"], effect: "allow" };
        await fake.run("permission", "evaluate", other);
        assert.equal(other.effect, "allow");
      } finally {
        await cleanup();
      }
    });
  });
}

test("yolo mode lets the primary lead start subagents and run the shell", async () => {
  await withProject("yolo", async (dir) => {
    const { editor, cleanup } = await setupAgents(dir);
    try {
      const rules = editor.get("lit-loop").permissions;
      for (const action of ["shell", "subagent", "edit"]) {
        const last = rules.filter((rule) => (rule.action === action || rule.action === "*") && rule.resource === "*").at(-1);
        assert.equal(last.effect, "allow", action);
      }
    } finally {
      await cleanup();
    }
  });
});
