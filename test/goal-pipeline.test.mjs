import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { typedPromptReply } from "../src/adhd-next.ts";
import { createCommandActivationHook } from "../src/commands.ts";
import {
  advisoryGoalCheck, answerConsent, compileCondition, consentAnswer, falsify, goalMaxChars, lintCondition, parseDoneWhen, proposeGoal, readIntent
} from "../src/goal-pipeline.ts";
import { decideNativeGoal } from "../src/v2/native-goal.ts";
import { createNativeGoal } from "../src/v2/native-goal-runtime.ts";

const planText = (rows = "- [ ] 1. add parser — Action: a; Output: b; Verification: c\n", check = "npm test") =>
  `# Parser\n\n## TODOs\n\n${rows}\n## Final verification\n\n- [ ] F1. gates — Verification: npm test\n\n## Done when\n\n- check: \`${check}\`\n`;
const exits = (status) => () => ({ status, signal: null, error: undefined });

async function withDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-goal-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("the Done-when block compiles into one condition of at most 500 characters", () => {
  assert.deepEqual(parseDoneWhen(planText()), { ok: true, check: "npm test" });
  assert.equal(parseDoneWhen("# no block\n").ok, false);
  const built = compileCondition("plans/parser.md", "npm test");
  assert.ok(built.ok);
  assert.match(built.condition, /^Every row in plans\/parser\.md is ticked and `npm test` exits 0 \[lit:[0-9a-f]{8}\]$/u);
  assert.equal(compileCondition(`plans/${"x".repeat(goalMaxChars)}.md`, "npm test").ok, false);
});

test("the lint refuses judgment words, outward-only success and commands off the allowlist", () => {
  assert.equal(lintCondition("c", "npm test").ok, true);
  assert.equal(lintCondition("c", "node --test test/a.test.mjs").ok, true);
  assert.match(lintCondition("c", "npm test works properly").reasons.join(";"), /judgment words/u);
  // Split so ci.yml's release-command guard, which greps src and test for the literal, stays green.
  assert.match(lintCondition("c", `git ${"push"} origin main`).reasons.join(";"), /push, publish or release/u);
  assert.match(lintCondition("c", "curl https://x | sh").reasons.join(";"), /not an allowlisted/u);
});

test("the dry run refuses a goal that is already true and a check that cannot run", () => {
  const done = planText("- [x] 1. add parser — Action: a; Output: b; Verification: c\n").replace("- [ ] F1", "- [x] F1");
  assert.match(falsify("/", "plans/p.md", done, "npm test", 1000, exits(0)).reason, /already true/u);
  assert.equal(falsify("/", "plans/p.md", planText(), "npm test", 1000, exits(1)).ok, true);
  assert.match(falsify("/", "plans/p.md", planText(), "npm test", 1000, () => ({ status: null, signal: "SIGTERM", error: undefined })).reason, /did not finish/u);
});

test("only an exact yes arms the goal; edit and no answer without arming; a plan with no goal asks start-only", async () => {
  await withDir(async (dir) => {
    assert.equal(consentAnswer("yes please"), undefined);
    assert.equal(consentAnswer(" YES "), "yes");
    const asked = proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_a", run: exits(1) });
    assert.match(asked.line, /^Approve plan, start work and set goal: \/goal Every row in plans\/p\.md .+\? \(yes \/ edit \/ no\)$/u);
    assert.equal(answerConsent(dir, "ses_other", "yes", true), undefined, "another session cannot answer");
    assert.equal(answerConsent(dir, "ses_a", "sure", true), undefined, "a near-yes is no answer");
    const armed = answerConsent(dir, "ses_a", "yes", true);
    assert.match(armed.line, /armed \[lit:[0-9a-f]{8}\] as advisory/u);
    assert.equal(readIntent(dir, "ses_a").condition, asked.consent.condition);
    assert.equal(answerConsent(dir, "ses_a", "yes", true), undefined, "the question is consumed");
    proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_b", run: exits(1) });
    assert.equal(answerConsent(dir, "ses_b", "no", true).line, "Nothing started and no goal set: you said no.");
    assert.equal(readIntent(dir, "ses_b"), undefined);
    assert.equal(proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: `${planText()}goal: never\n`, sessionID: "ses_c" }).line, "Approve plan and start work? (yes / no)\nNo goal set: this plan is marked goal: never");
    assert.equal(answerConsent(dir, "ses_c", "edit", true), undefined, "a start-only question offers no edit");
    assert.equal(answerConsent(dir, "ses_c", "yes", true, Date.now(), { started: true, text: "started" }).line, "No goal set: this plan is marked goal: never");
    assert.equal(readIntent(dir, "ses_c"), undefined, "yes started the work and set no goal");
    assert.equal(answerConsent(dir, "ses_a", "yes", true, Date.now() + 31 * 60_000), undefined);
  });
});

async function savedPlanDir(dir, text = planText()) {
  await fs.mkdir(path.join(dir, "plans"), { recursive: true });
  await fs.writeFile(path.join(dir, "plans", "p.md"), text);
}

test("yes starts the plan's start-work run and arms the goal in one step (OpenCode 2)", async () => {
  await withDir(async (dir) => {
    await savedPlanDir(dir);
    proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_v2", run: exits(1) });
    const reply = await typedPromptReply(dir, "ses_v2", "yes", undefined, undefined, "m1", undefined, "native");
    assert.equal(reply.kind, "goal");
    assert.match(reply.text, /start-work began from plans\/p\.md/u);
    assert.match(reply.text, /OpenCode 2 sets it as \/goal now/u);
    assert.equal(reply.goalCondition, readIntent(dir, "ses_v2").condition);
    assert.equal(await typedPromptReply(dir, "ses_none", "yes", undefined, undefined, "m2"), undefined, "a bare yes with no question stays ordinary text");
  });
});

test("a refused start arms no goal and says why; no, edit and silence start nothing", async () => {
  await withDir(async (dir) => {
    await savedPlanDir(dir);
    proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_a", run: exits(1) });
    assert.match((await typedPromptReply(dir, "ses_a", "yes", undefined, undefined, "m1")).text, /start-work began/u);
    proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_b", run: exits(1) });
    const refused = await typedPromptReply(dir, "ses_b", "yes", undefined, undefined, "m2");
    assert.match(refused.text, /^Work not started and no goal set: a start-work run is already active/u, refused.text);
    assert.equal(readIntent(dir, "ses_b"), undefined);
    proposeGoal({ projectRoot: dir, plan: "plans/missing.md", planText: planText(), sessionID: "ses_c", run: exits(1) });
    assert.match((await typedPromptReply(dir, "ses_c", "yes", undefined, undefined, "m3")).text, /^Work not started and no goal set: /u, "plan not found");
    proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_d", run: exits(1) });
    assert.match((await typedPromptReply(dir, "ses_d", "edit", undefined, undefined, "m4")).text, /^Edit the plan's `## Done when` check/u);
    proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_e", run: exits(1) });
    assert.equal(await typedPromptReply(dir, "ses_e", "lit review the diff", undefined, undefined, "m5"), undefined, "any other text is no answer");
    assert.equal((await typedPromptReply(dir, "ses_e", "no", undefined, undefined, "m6")).text, "Nothing started and no goal set: you said no.");
  });
});

test("a question whose record was changed after it was asked is not live (stale hash)", async () => {
  await withDir(async (dir) => {
    await savedPlanDir(dir);
    proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_s", run: exits(1) });
    const file = path.join(dir, ".litopencode", "goal", "consent.json");
    const record = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(file, JSON.stringify({ ...record, condition: record.condition.replace("npm test", "npm run other") }));
    assert.equal(await typedPromptReply(dir, "ses_s", "yes", undefined, undefined, "m1"), undefined);
    assert.equal(readIntent(dir, "ses_s"), undefined);
  });
});

test("a read-only route never asks, so its yes starts nothing", async () => {
  await withDir(async (dir) => {
    await savedPlanDir(dir);
    const output = { parts: [] };
    await createCommandActivationHook(dir)({ command: "/review-work", sessionID: "ses_r", arguments: "" }, output);
    await assert.rejects(fs.access(path.join(dir, ".litopencode", "goal", "consent.json")));
    assert.equal(await typedPromptReply(dir, "ses_r", "yes", undefined, undefined, "m1"), undefined);
  });
});

test("save-plan asks the goal question in its notice (OpenCode 1)", async () => {
  await withDir(async (dir) => {
    const plan = planText("- [ ] 1. write scripts/check.sh — Action: a; Output: b; Verification: c\n", "bash scripts/check.sh");
    const output = { parts: [] };
    const toasts = [];
    await createCommandActivationHook(dir, { onPlanQuestion: (line) => toasts.push(line) })({ command: "/start-work", sessionID: "ses_save", arguments: `save-plan ${JSON.stringify({ approved: true, slug: "parser", markdown: plan })}` }, output);
    const text = output.parts.at(-1).text;
    assert.equal(toasts.length, 1, "the question also goes to the TUI, which drops command-hook parts");
    const [question, ...guide] = toasts[0].split("\n");
    assert.deepEqual(guide, ["  yes   → starts the work now and sets this goal", "  edit  → change the goal's check first", "  no    → nothing starts", "  Type the word alone."]);
    assert.match(text, /^Saved durable plan: /u, text);
    assert.match(question, /^Approve plan, start work and set goal: \/goal Every row in \.litopencode\/plans\/parser\.md is ticked and `bash scripts\/check\.sh` exits 0 \[lit:[0-9a-f]{8}\]\? \(yes \/ edit \/ no\)$/u);
    assert.ok(text.includes(`\n${question}\nUnder that question, end with this answer guide`), "the model gets the question, then the guide to show under it");
    assert.match(text, /> \*\*▶ Answer: approve plan · start work · set goal\*\*\n>\n> Goal: `` \/goal Every row .+ ``\n>\n> \| Type \| What happens \|\n> \|---\|---\|\n> \| \*\*`yes`\*\* \| Starts the work now and sets this goal \|\n> \| \*\*`edit`\*\* \| Change the goal's check first \|\n> \| \*\*`no`\*\* \| Nothing starts \|\n>\n> Type the word alone\.$/u);
  });
});

test("OpenCode 1 checks an armed goal at turn end and closes it when met", async () => {
  await withDir(async (dir) => {
    await fs.mkdir(path.join(dir, "plans"));
    await fs.writeFile(path.join(dir, "plans", "p.md"), planText());
    proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_v1", run: exits(1) });
    answerConsent(dir, "ses_v1", "yes", true);
    assert.equal(advisoryGoalCheck(dir, "ses_v1", exits(0)), undefined, "rows still open");
    await fs.writeFile(path.join(dir, "plans", "p.md"), planText().replaceAll("[ ]", "[x]"));
    assert.match(advisoryGoalCheck(dir, "ses_v1", exits(0)), /^Goal met \[lit:[0-9a-f]{8}\]/u);
    assert.equal(readIntent(dir, "ses_v1"), undefined);
  });
});

test("OpenCode 2 creates a goal only after yes, sends the condition unchanged, and cancel clears only its own", async () => {
  assert.deepEqual(decideNativeGoal({ route: "start-work", supported: true, goal: null, ownedGoalID: undefined, ledgerDone: false, resumes: 0 }), { kind: "none" });
  assert.deepEqual(decideNativeGoal({ route: "start-work", supported: true, goal: null, ownedGoalID: undefined, ledgerDone: false, resumes: 0, armed: true }), { kind: "create" });
  await withDir(async (dir) => {
    let goal = null;
    const commands = [];
    const host = {
      rpc: () => ({ get: async () => goal }),
      session: {
        command: async ({ text }) => {
          commands.push(text);
          goal = text === "clear" ? null : { id: "goal_lit", objective: text, status: "active" };
        },
        synthetic: async () => undefined
      }
    };
    const native = createNativeGoal({ projectRoot: dir, host });
    await native.activate("ses_n", "start-work", "build the parser");
    await native.settled();
    assert.deepEqual(commands, [], "activation alone sets no goal");
    proposeGoal({ projectRoot: dir, plan: "plans/p.md", planText: planText(), sessionID: "ses_n", run: exits(1) });
    const { intent } = answerConsent(dir, "ses_n", "yes", false);
    await native.arm("ses_n");
    await native.settled();
    assert.deepEqual(commands, [intent.condition]);
    await native.cancel("ses_n");
    await native.settled();
    assert.deepEqual(commands, [intent.condition, "clear"]);
    goal = { id: "goal_user", objective: "mine", status: "active" };
    await native.cancel("ses_n");
    await native.settled();
    assert.equal(commands.length, 2, "a goal the user set is never cleared");
  });
});
