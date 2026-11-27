// Host wiring of the start-work autopilot: patch bodies are guarded file by file, and no autopilot message
// adds more than its cap to the model's context (scenarios.md C-4 and C-6).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyTrustedStartWorkDirective } from "../src/bounded-authority-hooks.ts";
import { autopilotContextCap, createAutopilotRuntime, patchTargets } from "../src/autopilot-hooks.ts";
import { lifecyclePaths } from "../src/bounded-authority.ts";

const sessionID = "ses_owner";

async function started(rows) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-autopilot-hooks-")));
  fs.writeFileSync(path.join(root, "PLAN.md"), ["# Plan", "", "## Todos", ...rows, ""].join("\n"));
  await applyTrustedStartWorkDirective(root, sessionID, {
    action: "init",
    payload: { schemaVersion: 3, requestId: "init-1", expectedRevision: 0, planPath: "PLAN.md", worktree: null, authorized: true, authority: [{ action: "write", root: "." }] }
  });
  const runtime = createAutopilotRuntime({ projectRoot: root, directory: root });
  return { root, runtime, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("patchTargets reads every file a patch body names", () => {
  const body = [
    "*** Begin Patch", "*** Add File: src/new.mjs", "+x", "*** Update File: src/a.mjs", "*** Move to: src/b.mjs", "*** Delete File: old.txt", "*** End Patch",
    "--- a/docs/x.md", "+++ b/docs/x.md", "--- /dev/null", "+++ b/created.md"
  ].join("\n");
  assert.deepEqual([...patchTargets(body)].sort(), ["created.md", "docs/x.md", "old.txt", "src/a.mjs", "src/b.mjs", "src/new.mjs"].sort());
});

test("C-4: a patch that touches the run's state or .git is refused, and a patch naming no file is refused", async () => {
  const run = await started(["- [ ] 1. row"]);
  try {
    const call = (tool) => ({ tool, sessionID, callID: `c-${tool}` });
    await assert.rejects(run.runtime.beforeTool(call("apply_patch"), { patchText: "*** Begin Patch\n*** Add File: .litopencode/litgoal/lit-loop/autopilot.json.digest\n+0\n*** End Patch" }), /refused/u);
    await assert.rejects(run.runtime.beforeTool(call("patch"), { patchText: "--- a/.git/hooks/pre-commit\n+++ b/.git/hooks/pre-commit\n" }), /refused/u);
    await assert.rejects(run.runtime.beforeTool(call("apply_patch"), { patchText: "nothing a guard can read" }), /names no file/u);
    await run.runtime.beforeTool(call("apply_patch"), { patchText: "*** Begin Patch\n*** Add File: src/ok.mjs\n+0\n*** End Patch" });
  } finally {
    run.cleanup();
  }
});

async function inboxOf(runtime) {
  for (let turn = 0; turn < 4; turn += 1) {
    const decision = await runtime.turnEnd(sessionID);
    if (decision.kind === "wrap-up") return decision;
  }
  throw new Error("no inbox");
}

test("C-6: the inbox fits the context cap by construction; long rows are clipped", async () => {
  const run = await started([`- [ ] 1. ${"x".repeat(9000)}`, "  BLOCKED: waits for the user"]);
  try {
    const decision = await inboxOf(run.runtime);
    assert.ok(Buffer.byteLength(decision.text, "utf8") <= autopilotContextCap, `${Buffer.byteLength(decision.text, "utf8")} bytes`);
    assert.match(decision.text, /x…/u);
  } finally {
    run.cleanup();
  }
});

test("the snapshot holds only the steps the inbox shows, so lit approve x never runs an unseen step", async () => {
  const run = await started(["- [ ] 1. row", "  BLOCKED: waits for the user"]);
  try {
    const call = (id) => ({ tool: "bash", sessionID, callID: id });
    const long = (n) => `git pu${"sh"} origin ${"b".repeat(1400)}${n}`;
    for (const n of [1, 2, 3, 4, 5, 6]) await assert.rejects(run.runtime.beforeTool(call(`c${n}`), { command: long(n) }), /parked \[X\]/u);
    const inbox = await inboxOf(run.runtime);
    assert.ok(Buffer.byteLength(inbox.text, "utf8") <= autopilotContextCap);
    const state = JSON.parse(fs.readFileSync(run.runtime.autopilot.stateFile, "utf8"));
    assert.equal(state.parked.length, 6);
    assert.ok(state.snapshot.steps.length >= 1 && state.snapshot.steps.length < 6, `${state.snapshot.steps.length} shown`);
    for (const step of state.snapshot.steps) assert.ok(inbox.text.includes(step.command), "every snapshot step is in the shown text in full");
    const unseen = state.parked.filter((step) => !state.snapshot.steps.some((shown) => shown.id === step.id));
    for (const step of unseen) assert.equal(inbox.text.includes(step.command), false, "an unseen step is not in the text");
    assert.match(inbox.text, /\(\d+ more parked, not shown here; they are not part of this list\)/u);
  } finally {
    run.cleanup();
  }
});

test("a plain prompt or a side lit route mid-run does not switch the guard off", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-autopilot-side-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
  const { createLitOpenCodePlugin } = await import("../src/server.ts");
  fs.mkdirSync(path.join(root, "plans"));
  fs.writeFileSync(path.join(root, "plans", "p.md"), "# p\n\n## Todos\n\n- [ ] 1. a\n");
  const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }), promptAsync: async () => ({ data: {} }) } };
  const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: root, worktree: root, client });
  const send = async (text, id) => {
    const output = { message: { id, sessionID, role: "user" }, parts: [{ id: `p_${id}`, sessionID, messageID: id, type: "text", text }] };
    await hooks["chat.message"]({ sessionID, messageID: id, agent: "build" }, output);
  };
  const push = (id) => hooks["tool.execute.before"]({ tool: "bash", sessionID, callID: id }, { args: { command: "git pu" + "sh origin main" } });
  try {
    await send("start-work plans/p.md", "m1");
    await assert.rejects(push("c1"), /parked \[X\]/u);
    for (const [index, text] of ["thanks, carry on", "lit fix the typo in the readme", "lit loop tidy the tests", "lit-handoff", "lit plan the next step"].entries()) {
      await send(text, `m${index + 2}`);
      await assert.rejects(push(`c${index + 2}`), /already parked|parked \[X\]/u, text);
    }
  } finally {
    await hooks.dispose();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the guard fails closed: an unreadable run file, a state write error or a failed parent lookup refuses the call", async () => {
  const bash = (id, command = "git pu" + "sh origin main") => [{ tool: "bash", sessionID, callID: id }, { command }];
  const corrupt = await started(["- [ ] 1. row"]);
  try {
    fs.writeFileSync(lifecyclePaths(corrupt.root).lifecycleStateFile, "{not json");
    await assert.rejects(corrupt.runtime.beforeTool(...bash("c1", "cat PLAN.md")), /could not read the run state/u);
  } finally {
    corrupt.cleanup();
  }
  const stuck = await started(["- [ ] 1. row"]);
  try {
    fs.rmSync(stuck.runtime.autopilot.stateFile, { force: true });
    fs.mkdirSync(path.join(stuck.runtime.autopilot.stateFile, "blocker"), { recursive: true });
    await assert.rejects(stuck.runtime.beforeTool(...bash("c2")));
  } finally {
    stuck.cleanup();
  }
  const lane = await started(["- [ ] 1. row"]);
  try {
    const runtime = createAutopilotRuntime({ projectRoot: lane.root, directory: lane.root, getSession: async () => { throw new Error("lookup failed"); } });
    await assert.rejects(runtime.beforeTool({ tool: "bash", sessionID: "ses_child", callID: "c3" }, { command: "git pu" + "sh origin main" }), /could not check which run/u);
    await assert.rejects(runtime.beforeTool({ tool: "write", sessionID: "ses_child", callID: "c4" }, { filePath: "x.txt" }), /could not check which run/u);
  } finally {
    lane.cleanup();
  }
});

test("a shell command over 4 KB is refused and never stored", async () => {
  const run = await started(["- [ ] 1. row"]);
  try {
    await assert.rejects(run.runtime.beforeTool({ tool: "bash", sessionID, callID: "c1" }, { command: `git pu${"sh"} origin ${"a".repeat(5000)}` }), /the limit is 4096\. Nothing was stored/u);
    const state = fs.existsSync(run.runtime.autopilot.stateFile) ? JSON.parse(fs.readFileSync(run.runtime.autopilot.stateFile, "utf8")) : { parked: [] };
    assert.equal(state.parked.length, 0);
  } finally {
    run.cleanup();
  }
});

test("after a replay the redrawn inbox is budgeted after the replay lines, and fits with only shown steps listed", async () => {
  const run = await started(["- [ ] 1. row", "  BLOCKED: waits for the user"]);
  try {
    const long = (n) => `git pu${"sh"} origin ${"b".repeat(1300)}${n}`;
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await assert.rejects(run.runtime.beforeTool({ tool: "bash", sessionID, callID: `c${n}` }, { command: long(n) }), /parked \[X\]/u);
    await inboxOf(run.runtime);
    const answer = await run.runtime.answer(sessionID, "lit approve x", true);
    assert.equal(answer.handled, true);
    assert.match(answer.reply, /Replayed the \[X\] steps/u);
    assert.match(answer.reply, /Still parked:/u);
    assert.ok(Buffer.byteLength(answer.reply, "utf8") <= autopilotContextCap, `${Buffer.byteLength(answer.reply, "utf8")} bytes`);
    assert.doesNotMatch(answer.reply, /\[cut at/u, "nothing was cut by the backstop");
    const state = JSON.parse(fs.readFileSync(run.runtime.autopilot.stateFile, "utf8"));
    const redrawn = answer.reply.slice(answer.reply.indexOf("Still parked:"));
    for (const step of state.snapshot.steps) assert.ok(redrawn.includes(step.command), "every step of the new list is shown in full");
  } finally {
    run.cleanup();
  }
});
