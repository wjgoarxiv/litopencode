import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createCommandActivationHook, findLitOpenCodeCommand } from "../src/commands.ts";
import { answerChoices, markdownGoalGuide, plainGoalGuide } from "../src/goal-guide.ts";
import { goalStatus } from "../src/goal-pipeline.ts";
import { createRuntimePaths } from "../src/state.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

// The answer guide under each goal question: the question lines stay byte for byte, and a guide that says what
// each answer word does follows them, plain on a toast or notice and as Markdown in a reply the model writes.

const PLAN_START_GUIDE = ["  yes  → starts the work now, with no goal", "  no   → nothing starts", "  Type the word alone."];

test("the question lines keep their exact bytes; their answer tails come from the guide's option lists", () => {
  assert.equal(goalStatus.asked("C"), "Approve plan, start work and set goal: /goal C? (yes / edit / no)");
  assert.equal(goalStatus.askedNoGoal("R"), "Approve plan and start work? (yes / no)\nNo goal set: R");
  assert.equal(goalStatus.loopAsked("C"), "Set goal for this lit-loop: /goal C? (yes / no)");
  assert.deepEqual(["plan-goal", "plan-start", "loop"].map(answerChoices), ["(yes / edit / no)", "(yes / no)", "(yes / no)"]);
});

test("the plain guide has one aligned row per answer word and no Markdown", () => {
  for (const kind of ["plan-goal", "plan-start", "loop"]) {
    const rows = plainGoalGuide(kind).split("\n");
    const words = answerChoices(kind).slice(1, -1).split(" / ");
    assert.equal(rows.length, words.length + 1, kind);
    assert.equal(rows.at(-1), "  Type the word alone.");
    assert.equal(new Set(rows.slice(0, -1).map((row) => row.indexOf("→"))).size, 1, `${kind} arrows align`);
    assert.deepEqual(rows.slice(0, -1).map((row) => row.trim().split(/\s+/u)[0]), words);
    assert.doesNotMatch(plainGoalGuide(kind), /[|*`>#]/u, kind);
    assert.ok(rows.every((row) => [...row].length <= 48), `${kind} fits a narrow toast`);
  }
  assert.deepEqual(plainGoalGuide("plan-start").split("\n"), PLAN_START_GUIDE);
});

test("the Markdown guide names the goal in a code span that survives the condition's backticks", () => {
  const guide = markdownGoalGuide("plan-goal", "Every row is ticked and `npm test` exits 0 [lit:abcd1234]");
  assert.match(guide, /^> \*\*▶ Answer: approve plan · start work · set goal\*\*\n>\n> Goal: `` \/goal Every row is ticked and `npm test` exits 0 \[lit:abcd1234\] ``\n/u);
  assert.equal(guide.split("\n").filter((line) => line.startsWith("> | **`")).length, 3);
  const start = markdownGoalGuide("plan-start");
  assert.doesNotMatch(start, /Goal:/u, "a start-only question names no goal");
  assert.match(start, /\n> \| \*\*`yes`\*\* \| Starts the work now, with no goal \|\n> \| \*\*`no`\*\* \| Nothing starts \|\n>\n> Type the word alone\.$/u);
  assert.match(markdownGoalGuide("loop", "plain"), /> Goal: `\/goal plain`\n/u);
});

async function withDir(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-goal-guide-")));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const startOnlyPlan = "# P\n\n## TODOs\n\n- [ ] 1. write a — Action: a; Output: b; Verification: c\n\ngoal: never\n";

test("OpenCode 1 save-plan with no goal: the toast and the model text carry the two-word guide", async () => {
  await withDir(async (dir) => {
    const output = { parts: [] };
    const toasts = [];
    await createCommandActivationHook(dir, { onPlanQuestion: (line) => toasts.push(line) })({ command: "/start-work", sessionID: "ses_g", arguments: `save-plan ${JSON.stringify({ approved: true, slug: "s", markdown: startOnlyPlan })}` }, output);
    assert.deepEqual(toasts[0].split("\n"), ["Approve plan and start work? (yes / no)", "No goal set: this plan is marked goal: never", ...PLAN_START_GUIDE]);
    const text = output.parts.at(-1).text;
    assert.match(text, /\nApprove plan and start work\? \(yes \/ no\)\nNo goal set: this plan is marked goal: never\nUnder that question, end with this answer guide, written in the user's language; keep `yes`, `no` as the exact English words:\n\n> \*\*▶ Answer: approve plan · start work\*\*\n/u);
  });
});

test("OpenCode 2 save-plan: the notice row shows the question line, then the plain guide", async () => {
  await withDir(async (dir) => {
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
    const fake = createFakeV2Context({ directory: dir, sessions: { ses_root: { id: "ses_root", agent: "lit-plan" } } });
    const cleanup = await setupLitOpenCodeServer(fake.context);
    try {
      const body = `${findLitOpenCodeCommand("start-work").activationText}\n\nsave-plan ${JSON.stringify({ approved: true, slug: "s", markdown: startOnlyPlan })}`;
      const saved = await fake.run("session", "prompt", { sessionID: "ses_root", messageID: "m1", prompt: { text: body }, delivery: "queue" });
      assert.equal(saved.metadata?.litopencode?.operation, "save-plan");
      const notices = (await fs.readFile(createRuntimePaths(dir).noticesFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line).message);
      const asked = notices.find((message) => message.startsWith("Approve plan and start work?"));
      assert.deepEqual(asked?.split("\n"), ["Approve plan and start work? (yes / no)", ...PLAN_START_GUIDE]);
    } finally {
      await cleanup();
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
  });
});
