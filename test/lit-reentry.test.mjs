import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { persistApprovedPlan } from "../src/durable-plan.ts";
import { createLitOpenCodePlugin } from "../src/server.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

const bytes = (value) => Buffer.byteLength(value, "utf8");
const rereadLine = /SKILL\.md|skill tool|Installed skill|first reply line MUST/iu;

async function withPlugin(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-reentry-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }) } };
  const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
  let counter = 0;
  const send = async (text, sessionID = "ses_a", agent = "lit-loop") => {
    counter += 1;
    const messageID = `msg_${counter}`;
    const output = {
      message: { id: messageID, sessionID, role: "user" },
      parts: [{ id: `prt_${counter}`, sessionID, messageID, type: "text", text }]
    };
    await hooks["chat.message"]({ sessionID, messageID, agent }, output);
    return output.parts.slice(1).map((part) => part.text).join("\n");
  };
  try {
    await run({ dir, hooks, send });
  } finally {
    await hooks.dispose();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("five lit prompts of one discipline: the first is full, the rest are short notes without a skill re-read", async () => {
  await withPlugin(async ({ send }) => {
    const first = await send("lit fix the bug");
    assert.match(first, /<lit-task-mode>/u);
    assert.match(first, /first reply line MUST/u);
    for (const text of ["lit add a test", "lit tighten the error text", "lit check the docs", "lit run it once more"]) {
      const note = await send(text);
      assert.ok(bytes(note) <= 600, `${text}: ${bytes(note)} bytes`);
      assert.match(note, /already active/u);
      assert.match(note, /lit-task/u);
      assert.doesNotMatch(note, rereadLine);
      assert.doesNotMatch(note, /<lit-task-mode>/u);
    }
  });
});

test("the active discipline survives a plain turn, and a compaction makes the next lit full again", async () => {
  await withPlugin(async ({ hooks, send }) => {
    await send("lit fix the bug");
    assert.equal(await send("thanks, looks right"), "");
    assert.match(await send("lit add a test"), /already active/u);
    await hooks["experimental.session.compacting"]({ sessionID: "ses_a" }, { context: [] });
    assert.match(await send("lit add another test"), /<lit-task-mode>/u);
  });
});

test("a different discipline switches with the full activation, once", async () => {
  await withPlugin(async ({ send }) => {
    assert.match(await send("lit loop the migration"), /<lit-loop-mode>/u);
    assert.match(await send("lit plan the rollout"), /<lit-plan-mode>/u);
    const again = await send("lit plan the second phase");
    assert.match(again, /already active/u);
    assert.match(again, /planning-only/u);
    assert.ok(bytes(again) <= 600);
  });
});

test("a bare lit over an approved plan resumes it and writes no new plan", async () => {
  await withPlugin(async ({ dir, send }) => {
    await persistApprovedPlan(dir, {
      schemaVersion: 1,
      slug: "ship-it",
      markdown: "# Plan\n\n## TODOs\n\n- [ ] 1. Do it — Action: do; Output: done; Verification: test",
      approved: true,
      requestId: "ship-it-1",
      revision: 1
    });
    const text = await send("lit");
    assert.match(text, /resuming existing work/u);
    assert.match(text, /\.litopencode\/plans\/ship-it\.md/u);
    assert.match(text, /do not write a new plan/u);
    assert.doesNotMatch(text, /Ask one short question/u);
    assert.deepEqual(await fs.readdir(path.join(dir, ".litopencode", "plans")), ["ship-it.md"]);
  });
});

test("a bare lit over an active start-work record resumes it", async () => {
  await withPlugin(async ({ dir, send }) => {
    const record = path.join(dir, ".litopencode", "litgoal", "lit-loop", "work-schema-3.json");
    await fs.mkdir(path.dirname(record), { recursive: true });
    await fs.writeFile(record, JSON.stringify({ schemaVersion: 3, status: "active" }));
    assert.match(await send("lit continue"), /resuming existing work \(start-work record\)/u);
  });
});

test("lit new and lit restart send the full activation even while the discipline is active", async () => {
  await withPlugin(async ({ send }) => {
    await send("lit fix the bug");
    assert.match(await send("lit new fix a second bug"), /<lit-task-mode>/u);
    assert.match(await send("lit add a test"), /already active/u);
    assert.match(await send("lit restart the whole thing"), /<lit-task-mode>/u);
  });
});

test("only a bare lit with no active work asks for confirmation", async () => {
  await withPlugin(async ({ send }) => {
    const bare = await send("lit");
    assert.match(bare, /<lit-task-mode>/u);
    assert.match(bare, /Ask one short question/u);
    const task = await send("lit fix X", "ses_b");
    assert.match(task, /<lit-task-mode>/u);
    assert.doesNotMatch(task, /Ask one short question/u);
    assert.match(await send("lit", "ses_b"), /already active/u);
  });
});

test("a different session id starts fresh", async () => {
  await withPlugin(async ({ send }) => {
    await send("lit fix the bug", "ses_a");
    assert.match(await send("lit add a test", "ses_a"), /already active/u);
    assert.match(await send("lit add a test", "ses_b"), /<lit-task-mode>/u);
  });
});

test("corrupt plan and start-work state fall back to the first activation without failing", async () => {
  await withPlugin(async ({ dir, send }) => {
    const plans = path.join(dir, ".litopencode", "plans");
    await fs.mkdir(plans, { recursive: true });
    await fs.writeFile(path.join(plans, "broken.md"), "<!-- litopencode-durable-plan: {not json -->\n# broken");
    const loop = path.join(dir, ".litopencode", "litgoal", "lit-loop");
    await fs.mkdir(loop, { recursive: true });
    await fs.writeFile(path.join(loop, "work-schema-3.json"), "{not json");
    const text = await send("lit continue");
    assert.match(text, /<lit-task-mode>/u);
    assert.doesNotMatch(text, /resuming existing work/u);
  });
});

test("lit plan points at the installed skill instead of pasting it", async () => {
  await withPlugin(async ({ send }) => {
    const plan = await send("lit plan the rollout");
    assert.ok(bytes(plan) < 8000, `${bytes(plan)} bytes`);
    assert.doesNotMatch(plan, /# Installed skill body/u);
    assert.match(plan, /skill tool/u);
    assert.match(plan, /\blit-plan\b/u);
    assert.match(plan, /planning only|plan only/iu);
  });
});

async function withV2(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-reentry-v2-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const fake = createFakeV2Context({
    directory: dir,
    sessions: { ses_a: { id: "ses_a", agent: "lit-loop" }, ses_b: { id: "ses_b", agent: "lit-loop" } }
  });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  const ask = async (text, sessionID = "ses_a") => {
    await fake.run("session", "prompt", { sessionID, messageID: `msg_${Math.random()}`, prompt: { text }, delivery: "queue" });
    const event = await fake.run("session", "context", {
      sessionID, agent: "lit-loop", model: { providerID: "openai", id: "gpt-test" }, system: [], messages: [], options: {}, tools: {}
    });
    return event.system.map((part) => part.text).filter((part) => part.includes("<lit-") || part.includes("LitOpenCode:"));
  };
  try {
    await run({ dir, fake, ask });
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("OpenCode 2: the repeat keeps the loaded activation and adds only a short note", async () => {
  await withV2(async ({ ask }) => {
    const first = await ask("lit fix the bug");
    assert.equal(first.length, 1);
    assert.match(first[0], /<lit-task-mode>/u);
    for (const text of ["lit add a test", "lit tighten the error text"]) {
      const parts = await ask(text);
      const note = parts.find((part) => /already active/u.test(part));
      assert.ok(note !== undefined, text);
      assert.ok(bytes(note) <= 600);
      assert.doesNotMatch(note, rereadLine);
      assert.equal(parts.filter((part) => part.includes("<lit-task-mode>")).length, 1);
    }
    assert.ok((await ask("lit plan X")).some((part) => part.includes("<lit-plan-mode>")));
    assert.equal((await ask("lit fix it", "ses_b")).filter((part) => part.includes("<lit-task-mode>")).length, 1);
  });
});

test("OpenCode 2: lit plan carries a pointer to the skill, not its body", async () => {
  await withV2(async ({ ask }) => {
    const parts = await ask("lit plan the rollout");
    const activation = parts.find((part) => part.includes("<lit-plan-mode>"));
    assert.ok(activation !== undefined);
    assert.ok(bytes(activation) < 8000);
    assert.doesNotMatch(activation, /# Installed skill body/u);
  });
});
