import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { typedPromptReply } from "../src/adhd-next.ts";
import { createActivationMemory } from "../src/activation-reentry.ts";
import { createChatMessageActivationHook } from "../src/activation.ts";
import { createCommandActivationHook, litOpenCodeCommands } from "../src/commands.ts";
import {
  advisoryLoopGoalCheck, answerConsent, compileLoopCondition, goalDir, proposeLoopGoal, readIntent
} from "../src/goal-pipeline.ts";
import { detectCheck, loopObjective, offerLoopGoal } from "../src/loop-goal.ts";
import { createRuntimePaths } from "../src/state.ts";
import { litOpenCodeTools } from "../src/tools.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context, until } from "../test-support/opencode-v2-fake.mjs";

// The lit-loop goal question: a run route's first activation asks `Set goal for this lit-loop: /goal <cond>? (yes / no)`
// when the project has a test command. The user's exact yes arms the goal and starts no start-work run.

const exits = (status) => () => ({ status, signal: null, error: undefined });
// A toast or notice carries the question line, then the plain answer guide under it.
const firstLine = (text) => text.split("\n")[0];
const LOOP_GUIDE = "  yes  → sets this goal for the lit-loop\n  no   → keeps working without a goal\n  Type the word alone.";
const QUESTION = /^Set goal for this lit-loop: \/goal `npm test` exits 0 and this is done: (.+) \[lit:[0-9a-f]{8}\]\? \(yes \/ no\)$/u;

async function withDir(fn, { test: script = "node --test" } = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-loop-goal-")));
  if (script !== null) await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: script } }));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const readConsent = async (dir) => JSON.parse(await fs.readFile(path.join(goalDir(dir), "consent.json"), "utf8"));
const exists = (file) => fs.access(file).then(() => true, () => false);

test("the project's test command comes from package.json, pytest, cargo or go, and is absent otherwise", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    assert.equal(detectCheck(dir), "npm test");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
    assert.equal(detectCheck(dir), undefined);
    await fs.writeFile(path.join(dir, "pytest.ini"), "");
    assert.equal(detectCheck(dir), "pytest");
    await fs.rm(path.join(dir, "pytest.ini"));
    await fs.writeFile(path.join(dir, "Cargo.toml"), "");
    assert.equal(detectCheck(dir), "cargo test");
    await fs.rm(path.join(dir, "Cargo.toml"));
    await fs.writeFile(path.join(dir, "go.mod"), "");
    assert.equal(detectCheck(dir), "go test ./...");
  }, { test: null });
});

test("the objective is the text after lit, without the route word", () => {
  assert.equal(loopObjective("lit loop fix the parser"), "fix the parser");
  assert.equal(loopObjective("lit-loop fix the parser"), "fix the parser");
  assert.equal(loopObjective("litwork finish the migration"), "finish the migration");
  assert.equal(loopObjective("lit +viz fix the parser in a loop"), "fix the parser in a loop");
  assert.equal(loopObjective("lit loop"), "");
});

test("a request that ends with the run word takes its objective from the words before it", () => {
  assert.equal(loopObjective("fix the parser lit loop"), "fix the parser");
  assert.equal(loopObjective("로그인 버튼 고쳐줘 lit loop"), "로그인 버튼 고쳐줘");
  assert.equal(loopObjective("로그인 버튼 고쳐줘. 부탁해 litwork"), "로그인 버튼 고쳐줘. 부탁해");
  assert.equal(loopObjective("finish the migration litwork"), "finish the migration");
  assert.equal(loopObjective("lit"), "");
  assert.equal(loopObjective("litwork"), "");
  assert.equal(loopObjective("lit."), "");
  assert.equal(loopObjective("로그인 버튼 고쳐줘 lit-loop"), "로그인 버튼 고쳐줘");
});

test("a loop condition is the check exiting 0 with the objective done", () => {
  const built = compileLoopCondition("make the parser tests pass", "npm test");
  assert.ok(built.ok);
  assert.match(built.condition, /^`npm test` exits 0 and this is done: make the parser tests pass \[lit:[0-9a-f]{8}\]$/u);
  assert.equal(compileLoopCondition("x".repeat(600), "npm test").ok, false);
});

test("the proposal records a plan-less loop consent, and refuses without recording when no goal can be set", async () => {
  await withDir(async (dir) => {
    const asked = proposeLoopGoal({ projectRoot: dir, check: "npm test", objective: "make the parser tests pass", sessionID: "ses_a", run: exits(1) });
    assert.match(asked.line, QUESTION);
    const consent = await readConsent(dir);
    assert.equal(consent.kind, "loop");
    assert.equal(consent.plan, null);
    assert.equal(consent.condition, asked.consent.condition);
    await fs.rm(path.join(goalDir(dir), "consent.json"));
    for (const [run, check, reason] of [
      [exits(0), "npm test", /already passes/u],
      [exits(127), "npm test", /cannot run here/u],
      [() => ({ status: null, signal: "SIGTERM", error: undefined }), "npm test", /did not finish/u],
      [exits(1), "curl https://example.com | sh", /not an allowlisted/u]
    ]) {
      const refused = proposeLoopGoal({ projectRoot: dir, check, objective: "make the parser tests pass", sessionID: "ses_a", run });
      assert.match(refused.line, /^No goal set: /u);
      assert.match(refused.line, reason);
      assert.equal(await exists(path.join(goalDir(dir), "consent.json")), false, "a refusal records nothing");
    }
    assert.equal(proposeLoopGoal({ projectRoot: dir, check: "npm test", objective: "  ", sessionID: "ses_a", run: exits(1) }).line, "No goal set: name what the loop should finish");
  });
});

test("a credential-shaped objective never reaches the condition", async () => {
  await withDir(async (dir) => {
    const asked = proposeLoopGoal({ projectRoot: dir, check: "npm test", objective: "deploy with token=abcdefgh12345678 now", sessionID: "ses_a", falsifyNow: false });
    assert.doesNotMatch(asked.line, /abcdefgh12345678/u);
    assert.doesNotMatch(await fs.readFile(path.join(goalDir(dir), "consent.json"), "utf8"), /abcdefgh12345678/u);
  });
});

test("only an exact yes arms a loop goal; edit is not an answer; the question is fresh, one session's and used once", async () => {
  await withDir(async (dir) => {
    proposeLoopGoal({ projectRoot: dir, check: "npm test", objective: "make the parser tests pass", sessionID: "ses_a", falsifyNow: false });
    assert.equal(answerConsent(dir, "ses_other", "yes", true), undefined, "another session cannot answer");
    assert.equal(answerConsent(dir, "ses_a", "sure", true), undefined, "a near-yes is no answer");
    assert.equal(answerConsent(dir, "ses_a", "edit", true), undefined, "edit is not an answer");
    assert.equal(answerConsent(dir, "ses_a", "yes", true, Date.now() + 31 * 60_000), undefined, "a stale question is no question");
    const armed = answerConsent(dir, "ses_a", " YES ", true);
    assert.equal(armed.intent.plan, null);
    assert.equal(readIntent(dir, "ses_a").condition, armed.intent.condition);
    assert.equal(answerConsent(dir, "ses_a", "yes", true), undefined, "the question is consumed");
    proposeLoopGoal({ projectRoot: dir, check: "npm test", objective: "again", sessionID: "ses_b", falsifyNow: false });
    assert.equal(answerConsent(dir, "ses_b", "no", true).line, "No goal set: you said no");
    assert.equal(readIntent(dir, "ses_b"), undefined);
  });
});

test("a typed yes to the loop question arms the goal and starts no work; any other prompt drops it", async () => {
  await withDir(async (dir) => {
    proposeLoopGoal({ projectRoot: dir, check: "npm test", objective: "make the parser tests pass", sessionID: "ses_a", falsifyNow: false });
    const yes = await typedPromptReply(dir, "ses_a", "yes", createActivationMemory(), undefined, "m1", undefined, "native");
    assert.equal(yes.kind, "goal");
    assert.equal(yes.mode, "lit-loop");
    assert.match(yes.text, /approved the lit-loop goal with yes/u);
    assert.doesNotMatch(yes.text, /start-work/u, "no run is started");
    assert.match(yes.goalCondition, /^`npm test` exits 0 and this is done: make the parser tests pass/u);
    assert.equal(yes.goalRoute, "lit-loop");
    assert.equal(await exists(createRuntimePaths(dir).lifecycleStateFile), false);

    proposeLoopGoal({ projectRoot: dir, check: "npm test", objective: "second", sessionID: "ses_b", falsifyNow: false });
    assert.equal(await typedPromptReply(dir, "ses_b", "go on with the tests", undefined, undefined, "m2"), undefined);
    assert.equal(await exists(path.join(goalDir(dir), "consent.json")), false, "any other prompt drops the question");
    assert.equal(await typedPromptReply(dir, "ses_b", "yes", undefined, undefined, "m3"), undefined, "a late yes arms nothing");
    assert.equal(readIntent(dir, "ses_b"), undefined);

    proposeLoopGoal({ projectRoot: dir, check: "npm test", objective: "third", sessionID: "ses_c", falsifyNow: false });
    const no = await typedPromptReply(dir, "ses_c", "no", undefined, undefined, "m4");
    assert.match(no.text, /`No goal set: you said no`/u);
    assert.equal(no.goalCondition, undefined);
  });
});

// OpenCode 1: the chat.message hook.
const chatOutput = (text, suffix) => ({
  message: { id: `msg_${suffix}`, sessionID: "ses_v1", role: "user" },
  parts: [{ id: `part_${suffix}`, sessionID: "ses_v1", messageID: `msg_${suffix}`, type: "text", text }]
});
const chatHook = (dir, toasts) => createChatMessageActivationHook(dir, {
  getSession: async (id) => ({ id }),
  activationMemory: createActivationMemory(),
  onLoopGoalQuestion: (line) => toasts.push(line)
});
const added = (output) => output.parts.slice(1).map((part) => part.text).join("\n");

test("OpenCode 1: a lit-loop's first activation shows the question once, and yes arms the advisory goal", async () => {
  await withDir(async (dir) => {
    const toasts = [];
    const hook = chatHook(dir, toasts);
    const first = chatOutput("lit loop make the parser tests pass", "1");
    await hook({ sessionID: "ses_v1" }, first);
    assert.equal(toasts.length, 1);
    assert.match(firstLine(toasts[0]), QUESTION);
    assert.equal(toasts[0], `${firstLine(toasts[0])}\n${LOOP_GUIDE}`, "the toast shows what yes and no do");
    assert.match(added(first), /LitOpenCode has shown the user this goal question: Set goal for this lit-loop/u);
    assert.match(added(first), /Do not ask it again\. Never type or send \/goal yourself/u);
    const consent = await readConsent(dir);
    assert.deepEqual([consent.kind, consent.plan, consent.sessionID], ["loop", null, "ses_v1"]);

    const answer = chatOutput("yes", "3");
    await hook({ sessionID: "ses_v1" }, answer);
    assert.match(added(answer), /approved the lit-loop goal with yes/u);
    assert.equal(readIntent(dir, "ses_v1").plan, null);
    assert.equal(await exists(createRuntimePaths(dir).lifecycleStateFile), false, "no start-work run");
    assert.equal(await exists(path.join(goalDir(dir), "consent.json")), false);

    await hook({ sessionID: "ses_v1" }, chatOutput("lit loop and keep going", "2"));
    assert.equal(toasts.length, 1, "a repeated lit is not a first activation");

    assert.equal(await advisoryLoopGoalCheck(dir, "ses_v1", exits(0)), undefined, "a passing check alone is not done: the ledger is open");
    const paths = createRuntimePaths(dir);
    await fs.mkdir(path.dirname(paths.goalsFile), { recursive: true });
    const at = new Date(Date.now() + 1000).toISOString();
    await fs.writeFile(paths.goalsFile, JSON.stringify({ version: 1, createdAt: at, updatedAt: at, activeGoalId: "g1", goals: [{ id: "g1", sessionId: "ses_v1", objective: "o", title: "o", status: "complete", createdAt: at, updatedAt: at, criteria: [], checkpoints: [], steering: [], reviewBlockers: [] }] }));
    assert.match(await advisoryLoopGoalCheck(dir, "ses_v1", exits(0)), /^Goal met \[lit:[0-9a-f]{8}\]: the check exits 0 and the ledger marks the work done\.$/u);
    assert.equal(readIntent(dir, "ses_v1"), undefined);
  });
});

test("OpenCode 1: litwork asks too; a prompt with no objective, no test command, litgoal or lit-plan asks nothing", async () => {
  await withDir(async (dir) => {
    const toasts = [];
    const hook = chatHook(dir, toasts);
    await hook({ sessionID: "ses_v1" }, chatOutput("litwork finish the migration", "1"));
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /this is done: finish the migration \[lit:/u);
  });
  await withDir(async (dir) => {
    const toasts = [];
    const hook = chatHook(dir, toasts);
    for (const [index, text] of ["lit loop", "lit goal ship the parser", "lit plan the parser rewrite", "lit review the diff", "start-work on the plan"].entries()) {
      await hook({ sessionID: `ses_${index}` }, chatOutput(text, String(index)));
    }
    assert.deepEqual(toasts, []);
    assert.equal(await exists(path.join(goalDir(dir), "consent.json")), false);
  });
  await withDir(async (dir) => {
    const toasts = [];
    await chatHook(dir, toasts)({ sessionID: "ses_v1" }, chatOutput("lit loop make the parser tests pass", "1"));
    assert.deepEqual(toasts, [], "no test command, no hook question");
  }, { test: null });
});

test("OpenCode 1: a request that ends with lit loop or litwork asks the goal question with the words before it", async () => {
  for (const [text, objective] of [
    ["make the parser tests pass lit loop", "make the parser tests pass"],
    ["로그인 버튼 고쳐줘 lit loop", "로그인 버튼 고쳐줘"],
    ["로그인 버튼 고쳐줘. 부탁해 litwork", "로그인 버튼 고쳐줘. 부탁해"],
  ]) {
    await withDir(async (dir) => {
      const toasts = [];
      await chatHook(dir, toasts)({ sessionID: "ses_v1" }, chatOutput(text, "1"));
      assert.equal(toasts.length, 1, text);
      assert.equal(QUESTION.exec(firstLine(toasts[0]))?.[1], objective, text);
    });
  }
  await withDir(async (dir) => {
    const toasts = [];
    const hook = chatHook(dir, toasts);
    for (const [index, text] of ["lit", "litwork", "lit continue", "what does litwork do?"].entries()) {
      await hook({ sessionID: `ses_${index}` }, chatOutput(text, String(index)));
    }
    assert.deepEqual(toasts, [], "no objective, or no run, asks nothing");
  });
});

test("OpenCode 1: plain lit at the start or the end, and lit-loop, ask the goal question with the task", async () => {
  for (const [text, objective] of [
    ["로그인 버튼 고쳐줘. 부탁해 lit", "로그인 버튼 고쳐줘. 부탁해"],
    ["로그인 버튼 고쳐줘 lit", "로그인 버튼 고쳐줘"],
    ["lit fix the parser", "fix the parser"],
    ["fix the date parsing bug in src/dates.js lit", "fix the date parsing bug in src/dates.js"],
    ["lit-loop 로그인 버튼 고쳐줘", "로그인 버튼 고쳐줘"],
    ["로그인 버튼 고쳐줘 lit-loop", "로그인 버튼 고쳐줘"],
  ]) {
    await withDir(async (dir) => {
      const toasts = [];
      await chatHook(dir, toasts)({ sessionID: "ses_v1" }, chatOutput(text, "1"));
      assert.equal(toasts.length, 1, text);
      assert.equal(QUESTION.exec(firstLine(toasts[0]))?.[1], objective, text);
    });
  }
  await withDir(async (dir) => {
    const toasts = [];
    const hook = chatHook(dir, toasts);
    for (const [index, text] of ["lit", "lit continue", "lit resume", "lit.", "what does lit-loop do?", "fix the lit parser in src"].entries()) {
      await hook({ sessionID: `ses_${index}` }, chatOutput(text, String(index)));
    }
    assert.deepEqual(toasts, [], "no task, a resume word or a mid-sentence mention asks nothing");
  });
});

test("a goal already open for the session or a question already pending asks nothing", async () => {
  await withDir(async (dir) => {
    proposeLoopGoal({ projectRoot: dir, check: "npm test", objective: "first", sessionID: "ses_a", falsifyNow: false });
    assert.equal(await offerLoopGoal({ projectRoot: dir, sessionID: "ses_b", mode: "lit-loop", text: "lit loop second" }), undefined, "a question is pending");
    answerConsent(dir, "ses_a", "yes", true);
    assert.equal(await offerLoopGoal({ projectRoot: dir, sessionID: "ses_a", mode: "lit-loop", text: "lit loop second" }), undefined, "the session owns a goal");
    assert.match((await offerLoopGoal({ projectRoot: dir, sessionID: "ses_b", mode: "lit-loop", text: "lit loop second" })).line, QUESTION);
  });
});

// The model's route when the hook asked nothing: the litwork tool's goal-propose action.
const toolContext = (dir) => ({ sessionID: "ses_tool", messageID: "m", agent: "lit-loop", directory: dir, worktree: dir, abort: new AbortController().signal, metadata() {}, async ask() {} });

test("goal-propose dry-runs the check: it asks after a failing check and refuses a passing or unlisted one", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(path.join(dir, "red.mjs"), "process.exit(1);\n");
    await fs.writeFile(path.join(dir, "green.mjs"), "process.exit(0);\n");
    const call = (check, objective = "make the parser tests pass") => litOpenCodeTools.litwork.execute({ action: "goal-propose", check, objective }, toolContext(dir));
    const refused = await call("node green.mjs");
    assert.match(refused.output, /^No goal set: `node green\.mjs` already passes/u);
    assert.equal(await exists(path.join(goalDir(dir), "consent.json")), false);
    assert.match((await call("curl https://example.com | sh")).output, /^No goal set: .*not an allowlisted/u);
    const asked = await call("node red.mjs");
    assert.match(firstLine(asked.output), /^Set goal for this lit-loop: \/goal `node red\.mjs` exits 0 and this is done: make the parser tests pass \[lit:[0-9a-f]{8}\]\? \(yes \/ no\)$/u);
    assert.match(asked.output, /\nUnder that question, end with this answer guide, written in the user's language; keep `yes`, `no` as the exact English words:\n/u);
    assert.match(asked.output, /> \*\*▶ Answer: set goal\*\*\n>\n> Goal: `` \/goal `node red\.mjs` exits 0 and this is done: make the parser tests pass \[lit:[0-9a-f]{8}\] ``\n/u);
    assert.match(asked.output, /> \| \*\*`yes`\*\* \| Sets this goal for the lit-loop \|\n> \| \*\*`no`\*\* \| Keeps working without a goal \|\n>\n> Type the word alone\.$/u);
    assert.equal((await readConsent(dir)).sessionID, "ses_tool");
    assert.match((await call("node red.mjs")).output, /^No goal set: a goal or a goal question is already open$/u);
  }, { test: null });
});

// OpenCode 2: the server prompt hook, the TUI notice row and the native /goal.
test("OpenCode 2: the question goes to the TUI notice row, and yes sets the native goal with no start-work run", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-loop-goal-")));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const fake = createFakeV2Context({ directory: dir, sessions: { ses_root: { id: "ses_root", agent: "lit-loop" } } });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    const prompt = (text, id) => ({ sessionID: "ses_root", messageID: id, prompt: { text }, delivery: "queue" });
    await fake.run("session", "prompt", prompt("lit loop make the parser tests pass", "m1"));
    const notices = (await fs.readFile(createRuntimePaths(dir).noticesFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const asked = notices.filter((notice) => QUESTION.test(firstLine(notice.message)));
    assert.equal(asked.length, 1, "the question reaches the TUI");
    assert.ok(asked[0].message.endsWith(`\n${LOOP_GUIDE}`), "the notice shows what yes and no do");
    assert.equal(fake.goalCommands.filter((command) => command.name === "goal").length, 0, "asking sets no goal");

    await fake.run("session", "prompt", prompt("yes", "m2"));
    await until(() => fake.goals.has("ses_root"));
    const [command] = fake.goalCommands.filter((entry) => entry.name === "goal");
    assert.match(command.text, /^`npm test` exits 0 and this is done: make the parser tests pass \[lit:[0-9a-f]{8}\]$/u);
    assert.equal(await exists(createRuntimePaths(dir).lifecycleStateFile), false, "yes starts no start-work run");

    await fake.run("session", "prompt", prompt("lit loop keep going", "m3"));
    const again = (await fs.readFile(createRuntimePaths(dir).noticesFile, "utf8")).split("\n").filter(Boolean).filter((line) => QUESTION.test(firstLine(JSON.parse(line).message)));
    assert.equal(again.length, 1, "a repeated lit asks nothing");
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("OpenCode 2: a request that ends with litwork asks the goal question with the words before it", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-loop-goal-tail-")));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const fake = createFakeV2Context({ directory: dir, sessions: { ses_root: { id: "ses_root", agent: "lit-loop" } } });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    await fake.run("session", "prompt", { sessionID: "ses_root", messageID: "m1", prompt: { text: "로그인 버튼 고쳐줘 litwork" }, delivery: "queue" });
    const notices = (await fs.readFile(createRuntimePaths(dir).noticesFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const asked = notices.map((notice) => QUESTION.exec(firstLine(notice.message))?.[1]).filter(Boolean);
    assert.deepEqual(asked, ["로그인 버튼 고쳐줘"]);
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("OpenCode 1: /lit-loop and /litwork with a task ask the goal question with that task", async () => {
  for (const [command, args, objective] of [["lit-loop", "로그인 버튼 고쳐줘", "로그인 버튼 고쳐줘"], ["litwork", "finish the migration", "finish the migration"]]) {
    await withDir(async (dir) => {
      const toasts = [];
      const output = { parts: [] };
      await createCommandActivationHook(dir, { onLoopGoalQuestion: (line) => toasts.push(line) })({ command, sessionID: "ses_v1", arguments: args }, output);
      assert.equal(toasts.length, 1, command);
      assert.equal(QUESTION.exec(firstLine(toasts[0]))?.[1], objective, command);
      assert.ok(output.parts.some((part) => /LitOpenCode has shown the user this goal question/u.test(part.text)), command);
      assert.equal((await readConsent(dir)).kind, "loop");
    });
  }
  await withDir(async (dir) => {
    const toasts = [];
    const hook = createCommandActivationHook(dir, { onLoopGoalQuestion: (line) => toasts.push(line) });
    for (const [index, [command, args]] of [["lit-loop", ""], ["litwork", "  "], ["review-work", "the last commit"], ["lit-plan", "the parser rewrite"]].entries()) {
      await hook({ command, sessionID: `ses_${index}`, arguments: args }, { parts: [] });
    }
    assert.deepEqual(toasts, [], "no task, or not a run command, asks nothing");
  });
});

test("OpenCode 2: /lit-loop and /litwork with a task ask the goal question, from the plugin command and the alias file", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-loop-goal-cmd-")));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const fake = createFakeV2Context({ directory: dir, sessions: { ses_cmd: { id: "ses_cmd", agent: "lit-loop" }, ses_alias: { id: "ses_alias", agent: "lit-loop" } } });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    const command = fake.applyCommands().commands.find((entry) => entry.name === "lit-loop");
    await command.execute({ sessionID: "ses_cmd", prompt: { text: "로그인 버튼 고쳐줘" }, delivery: "queue" });
    const sent = fake.prompts.at(-1);
    await fake.run("session", "prompt", { sessionID: "ses_cmd", messageID: "m1", prompt: { text: sent.text }, metadata: sent.metadata, delivery: "queue" });
    const head = litOpenCodeCommands.find((entry) => entry.id === "litwork").activationText;
    await fake.run("session", "prompt", { sessionID: "ses_alias", messageID: "m2", prompt: { text: `${head}\n\nfinish the migration` }, delivery: "queue" });
    const notices = (await fs.readFile(createRuntimePaths(dir).noticesFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const asked = notices.map((notice) => QUESTION.exec(firstLine(notice.message))?.[1]).filter(Boolean);
    assert.deepEqual(asked, ["로그인 버튼 고쳐줘"], "a pending question blocks a second one in the same project");
    await fs.rm(path.join(goalDir(dir), "consent.json"));
    await fake.run("session", "prompt", { sessionID: "ses_alias", messageID: "m3", prompt: { text: `${head}\n\nfinish the migration` }, delivery: "queue" });
    const again = (await fs.readFile(createRuntimePaths(dir).noticesFile, "utf8")).split("\n").filter(Boolean).map((line) => QUESTION.exec(firstLine(JSON.parse(line).message))?.[1]).filter(Boolean);
    assert.deepEqual(again, ["로그인 버튼 고쳐줘", "finish the migration"]);
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("OpenCode 2: a request that ends with plain lit, or starts with lit-loop, asks the goal question", async () => {
  for (const [text, objective] of [["로그인 버튼 고쳐줘. 부탁해 lit", "로그인 버튼 고쳐줘. 부탁해"], ["lit-loop 로그인 버튼 고쳐줘", "로그인 버튼 고쳐줘"]]) {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-loop-goal-plain-")));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
    const fake = createFakeV2Context({ directory: dir, sessions: { ses_root: { id: "ses_root", agent: "lit-loop" } } });
    const cleanup = await setupLitOpenCodeServer(fake.context);
    try {
      await fake.run("session", "prompt", { sessionID: "ses_root", messageID: "m1", prompt: { text }, delivery: "queue" });
      const notices = (await fs.readFile(createRuntimePaths(dir).noticesFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
      assert.deepEqual(notices.map((notice) => QUESTION.exec(firstLine(notice.message))?.[1]).filter(Boolean), [objective], text);
    } finally {
      await cleanup();
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

// A finished goal must not block the next question.
test("OpenCode 1: after the goal is met, a new lit loop asks again, even in the same session", async () => {
  await withDir(async (dir) => {
    const toasts = [];
    const hook = chatHook(dir, toasts);
    await hook({ sessionID: "ses_v1" }, chatOutput("lit loop make the parser tests pass", "1"));
    await hook({ sessionID: "ses_v1" }, chatOutput("yes", "2"));
    await hook({ sessionID: "ses_v1" }, chatOutput("lit loop keep going", "3"));
    assert.equal(toasts.length, 1, "while the goal is open nothing is asked again");
    const paths = createRuntimePaths(dir);
    await fs.mkdir(path.dirname(paths.goalsFile), { recursive: true });
    const at = new Date(Date.now() + 1000).toISOString();
    await fs.writeFile(paths.goalsFile, JSON.stringify({ version: 1, createdAt: at, updatedAt: at, activeGoalId: "g1", goals: [{ id: "g1", sessionId: "ses_v1", objective: "o", title: "o", status: "complete", createdAt: at, updatedAt: at, criteria: [], checkpoints: [], steering: [], reviewBlockers: [] }] }));
    assert.match(await advisoryLoopGoalCheck(dir, "ses_v1", exits(0)), /^Goal met/u);
    await hook({ sessionID: "ses_v1" }, chatOutput("lit loop add the lexer", "4"));
    assert.equal(toasts.length, 2, "a met goal does not block the next question");
    assert.match(toasts[1], /this is done: add the lexer \[lit:/u);
    await hook({ sessionID: "ses_v1" }, chatOutput("yes", "5"));
    assert.ok(readIntent(dir, "ses_v1"), "the second goal arms");
  });
});

test("OpenCode 2: after the native goal is cleared as met, a new lit loop asks again", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-loop-goal-again-")));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node -e 0" } }));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const fake = createFakeV2Context({ directory: dir, sessions: { ses_root: { id: "ses_root", agent: "lit-loop" } } });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    const prompt = (text, id) => ({ sessionID: "ses_root", messageID: id, prompt: { text }, delivery: "queue" });
    const questions = async () => (await fs.readFile(createRuntimePaths(dir).noticesFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line).message).filter((message) => QUESTION.test(firstLine(message)));
    await fake.run("session", "prompt", prompt("lit loop make the parser tests pass", "m1"));
    await fake.run("session", "prompt", prompt("yes", "m2"));
    await until(() => fake.goals.has("ses_root"));
    fake.goals.set("ses_root", { ...fake.goals.get("ses_root"), status: "complete" });
    await fake.run("session", "experimental.idle", { sessionID: "ses_root", background: [] });
    await until(() => !fake.goals.has("ses_root"));
    assert.equal((await questions()).length, 1);
    await fake.run("session", "prompt", prompt("lit loop add the lexer", "m3"));
    const asked = await questions();
    assert.equal(asked.length, 2, "a cleared goal does not block the next question");
    assert.match(asked[1], /this is done: add the lexer \[lit:/u);
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
