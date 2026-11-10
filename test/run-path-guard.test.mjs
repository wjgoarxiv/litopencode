import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { createToolExecuteBeforeHook } from "../src/hooks.ts";
import { createRunPathGuard } from "../src/run-path-guard.ts";
import { createRuntimePaths } from "../src/state.ts";
import { createV2ToolHooks } from "../src/v2/hooks.ts";

async function withRun(fn, { start = true } = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-guard-")));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(dir, "xdg-data");
  try {
    await fs.mkdir(path.join(dir, "sub"), { recursive: true });
    await fs.writeFile(path.join(dir, "PLAN.md"), "# p\n\n- [ ] 1. a\n");
    await fs.writeFile(path.join(dir, ".env"), "A=1\n");
    if (start) {
      await createBoundedAuthorityLifecycle(dir).init({
        schemaVersion: 3, requestId: "init", sessionID: "owner", trustedUser: true, expectedRevision: 0, planPath: "PLAN.md", worktree: null, authorized: true,
        authority: [{ action: "read", root: "." }, { action: "write", root: "." }]
      });
    }
    await fn(dir);
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const lineage = { owner: {}, child: { parentID: "owner" }, other: {}, grandchild: { parentID: "child" } };
const getSession = async (id) => lineage[id];
const digest = async (dir) => createHash("sha256").update(await fs.readFile(createRuntimePaths(dir).lifecycleStateFile)).digest("hex");

test("the guard is inert with no run and for an unrelated session; it refuses the owner and a direct child, writing nothing", async () => {
  await withRun(async (dir) => {
    const guard = createRunPathGuard({ projectRoot: dir, getSession });
    await guard.before({ tool: "read", sessionID: "owner" }, { filePath: ".env" });
  }, { start: false });
  await withRun(async (dir) => {
    const guard = createRunPathGuard({ projectRoot: dir, getSession });
    const before = await digest(dir);
    await guard.before({ tool: "read", sessionID: "other" }, { filePath: ".env" });
    await guard.before({ tool: "read", sessionID: "grandchild" }, { filePath: ".env" });
    for (const sessionID of ["owner", "child", "unknown"]) {
      await assert.rejects(guard.before({ tool: "read", sessionID }, { filePath: ".env" }), (error) => /protected for this run/u.test(error.message) && /BLOCKED:/u.test(error.message), sessionID);
    }
    await guard.before({ tool: "read", sessionID: "owner" }, { filePath: "PLAN.md" });
    assert.equal(await digest(dir), before, "no park, no grant, no state write");
    // The run's own read grant on the whole project does not reopen a protected file.
    const state = await createBoundedAuthorityLifecycle(dir).read();
    assert.ok(state.authority.grants.some((grant) => grant.action === "read" && grant.root === dir));
  });
});

test("bash words, patch headers and search paths are checked; ordinary commands pass", async () => {
  await withRun(async (dir) => {
    const dataDir = path.join(process.env.XDG_DATA_HOME, "opencode");
    await fs.mkdir(dataDir, { recursive: true });
    const guard = createRunPathGuard({ projectRoot: dir, getSession });
    const fromData = createRunPathGuard({ projectRoot: dir, baseDirectory: dataDir, getSession });
    const refused = [
      [guard, "bash", { command: "cat ~/.ssh/config" }],
      [guard, "bash", { command: "cd sub && cat ../.env" }],
      [guard, "bash", { command: "rm .env" }],
      [guard, "bash", { command: "cat id_ed25519" }],
      [guard, "bash", { command: "cat server.pem" }],
      [fromData, "bash", { command: "cat auth.json" }],
      [guard, "bash", { command: "echo x >~/.zshrc" }],
      [guard, "bash", { command: "echo x >> ~/.zshrc" }],
      [guard, "bash", { command: 'cat "$HOME/.ssh/config"' }],
      [guard, "apply_patch", { patchText: "*** Begin Patch\n*** Delete File: .env\n*** End Patch" }],
      [guard, "apply_patch", { patchText: "*** Begin Patch\n*** Update File: a.txt\n*** Move to: .env.local\n*** End Patch" }],
      [guard, "write", { filePath: ".litopencode/litgoal/lit-loop/work-schema-3.json", content: "{}" }],
      [guard, "grep", { pattern: "x", path: path.join(os.homedir(), ".ssh") }]
    ];
    for (const [g, tool, args] of refused) await assert.rejects(g.before({ tool, sessionID: "owner" }, args), /protected/u, `${tool} ${JSON.stringify(args)}`);
    for (const [tool, args] of [["bash", { command: "cat README.md" }], ["bash", { command: "cat ~/.zshrc" }], ["bash", { command: "git status" }], ["read", { filePath: ".env.example" }], ["grep", { pattern: "x", path: "." }]]) {
      await guard.before({ tool, sessionID: "owner" }, args);
    }
  });
});

test("the v1 tool hook and the v2 tool hook both refuse a protected read during a run", async () => {
  await withRun(async (dir) => {
    const v1 = createToolExecuteBeforeHook({ getSession, projectRoot: dir, baseDirectory: dir });
    await assert.rejects(v1({ tool: "read", sessionID: "owner", callID: "c1" }, { args: { filePath: ".env" } }), /protected/u);
    await v1({ tool: "read", sessionID: "owner", callID: "c2" }, { args: { filePath: "PLAN.md" } });
    const hedge = { before: async () => {}, after: async () => {} };
    const v2 = createV2ToolHooks({ projectRoot: dir, knowledgeCaptureEnabled: false, getSession, deliverableHedgeGuard: hedge, baseDirectory: dir });
    await assert.rejects(v2.executeBefore({ tool: "read", sessionID: "owner", id: "c3", input: { path: ".env" } }), /protected/u);
    await v2.executeBefore({ tool: "read", sessionID: "owner", id: "c4", input: { path: "PLAN.md" } });
  });
});
