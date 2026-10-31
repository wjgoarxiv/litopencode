import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findLitOpenCodeCommand } from "../src/commands.ts";
import { recordNativeGoal } from "../src/native-goal-ledger.ts";
import { createRuntimePaths } from "../src/state.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context, until } from "../test-support/opencode-v2-fake.mjs";

// The native-goal wiring on OpenCode 2, driven through the real server setup and the fake host: a goal is
// created on lit-loop, start-work and litwork only, a goal the user made is left alone, and a finished goal
// of ours is cleared only after OpenCode's verdict and LitOpenCode's ledger both say done.

async function withHost(options, fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-goal-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const sessions = { ses_root: { id: "ses_root", agent: "lit-loop" }, ses_child: { id: "ses_child", parentID: "ses_root" } };
  const fake = createFakeV2Context({ directory: dir, sessions, ...options });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  let cleaned = false;
  const finish = async () => {
    if (cleaned) return;
    cleaned = true;
    await cleanup();
  };
  try {
    await fn(dir, fake, finish);
  } finally {
    await finish();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const prompt = (text, sessionID = "ses_root") => ({ sessionID, messageID: "msg_1", prompt: { text }, delivery: "queue" });
const lines = (fake) => fake.notices.map((notice) => notice.text);
const slashGoal = (fake) => fake.goalCommands.filter((command) => command.name === "goal");

async function ledgerEvents(dir) {
  const raw = await fs.readFile(createRuntimePaths(dir).ledgerFile, "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.type.startsWith("native-goal."));
}

async function markLedgerGoalComplete(dir, sessionId, at = new Date().toISOString()) {
  const paths = createRuntimePaths(dir);
  await fs.mkdir(path.dirname(paths.goalsFile), { recursive: true });
  const now = at;
  const goal = { id: "g1", sessionId, objective: "ship it", title: "ship it", status: "complete", createdAt: now, updatedAt: now, criteria: [], checkpoints: [], steering: [], reviewBlockers: [] };
  await fs.writeFile(paths.goalsFile, JSON.stringify({ version: 1, createdAt: now, updatedAt: now, activeGoalId: "g1", goals: [goal] }));
}

test("lit-loop sets a goal that carries the work and the completion conditions, and the ledger remembers its id", async () => {
  await withHost({}, async (dir, fake) => {
    await fake.run("session", "prompt", prompt("lit loop make the parser tests pass"));
    await until(() => fake.goals.has("ses_root") && lines(fake).length > 0);
    const [command] = slashGoal(fake);
    assert.equal(slashGoal(fake).length, 1);
    assert.match(command.text, /make the parser tests pass/u);
    assert.match(command.text, /ledger/iu);
    assert.match(command.text, /real-surface/iu);
    assert.match(lines(fake)[0], /^LitOpenCode goal: created/u);
    const events = await ledgerEvents(dir);
    assert.deepEqual(events.filter((event) => event.type === "native-goal.created").map((event) => event.goalID), [fake.goals.get("ses_root").id]);
  });
});

test("start-work and litwork set a goal as well", async () => {
  for (const text of ["start-work", "litwork finish the migration"]) {
    await withHost({}, async (_dir, fake) => {
      await fake.run("session", "prompt", prompt(text));
      await until(() => fake.goals.has("ses_root"));
      assert.equal(slashGoal(fake).length, 1, text);
    });
  }
});

test("a second lit-loop prompt keeps the goal it made: no second /goal, no second line", async () => {
  await withHost({}, async (_dir, fake, finish) => {
    await fake.run("session", "prompt", prompt("lit loop first"));
    await until(() => fake.goals.has("ses_root") && lines(fake).length > 0);
    await fake.run("session", "prompt", prompt("lit loop keep going"));
    await finish();
    assert.equal(slashGoal(fake).length, 1);
    assert.equal(lines(fake).length, 1);
  });
});

test("read-only routes and bare lit set no goal", async () => {
  await withHost({}, async (dir, fake, finish) => {
    for (const text of ["lit plan the release", "lit research hydrate models", "lit review the diff", "lit fix the typo", "hello there"]) {
      await fake.run("session", "prompt", prompt(text));
    }
    await finish();
    assert.equal(fake.goalCommands.length, 0);
    assert.equal(fake.notices.length, 0);
    assert.deepEqual(await ledgerEvents(dir), []);
  });
});

test("a child session never gets a goal", async () => {
  await withHost({}, async (_dir, fake, finish) => {
    await fake.run("session", "prompt", prompt("lit loop inside a subagent", "ses_child"));
    await finish();
    assert.equal(fake.goalCommands.length, 0);
  });
});

test("a goal the user made is reported once and never touched", async () => {
  const mine = { id: "goal_user", objective: "my own objective", status: "paused", reason: "Paused by the user", rounds: 3 };
  await withHost({ goals: { ses_root: mine } }, async (dir, fake, finish) => {
    await fake.run("session", "prompt", prompt("lit loop continue"));
    await until(() => lines(fake).length > 0);
    await fake.run("session", "prompt", prompt("lit loop continue again"));
    await finish();
    assert.equal(slashGoal(fake).length, 0);
    assert.deepEqual(fake.goals.get("ses_root"), mine);
    assert.equal(lines(fake).length, 1);
    assert.match(lines(fake)[0], /left yours alone/u);
    assert.deepEqual((await ledgerEvents(dir)).map((event) => event.type), ["native-goal.left-alone"]);
  });
});

test("a goal of ours paused by a server restart is resumed on the next lit-loop, and says so", async () => {
  const ours = { id: "goal_ours_1", objective: "ship it", status: "paused", reason: "The server restarted while the goal was active", rounds: 4 };
  await withHost({ goals: { ses_root: ours } }, async (dir, fake) => {
    await recordNativeGoal(dir, "ses_root", "lit-loop", { type: "native-goal.created", goalID: "goal_ours_1" });
    await fake.run("session", "prompt", prompt("lit loop continue"));
    await until(() => lines(fake).length > 0);
    assert.deepEqual(slashGoal(fake).map((command) => command.text), ["resume"]);
    assert.equal(fake.goals.get("ses_root").status, "active");
    assert.match(lines(fake)[0], /^LitOpenCode goal: resumed/u);
    assert.ok((await ledgerEvents(dir)).some((event) => event.type === "native-goal.resumed" && event.goalID === "goal_ours_1"));
  });
});

test("a goal of ours paused for another reason is reported, not resumed", async () => {
  const ours = { id: "goal_ours_2", objective: "ship it", status: "paused", reason: "Paused by the user", rounds: 4 };
  await withHost({ goals: { ses_root: ours } }, async (dir, fake, finish) => {
    await recordNativeGoal(dir, "ses_root", "lit-loop", { type: "native-goal.created", goalID: "goal_ours_2" });
    await fake.run("session", "prompt", prompt("lit loop continue"));
    await finish();
    assert.equal(slashGoal(fake).length, 0);
    assert.match(lines(fake)[0], /conflict/u);
    assert.equal(fake.goals.get("ses_root").status, "paused");
  });
});

test("idle: a met goal of ours is cleared only when the ledger is done too", async () => {
  const met = { id: "goal_ours_3", objective: "ship it", status: "complete", reason: "all criteria pass", rounds: 5 };
  await withHost({ goals: { ses_root: met } }, async (dir, fake) => {
    await recordNativeGoal(dir, "ses_root", "lit-loop", { type: "native-goal.created", goalID: "goal_ours_3" });
    await fake.run("session", "experimental.idle", { sessionID: "ses_root", background: [] });
    await until(() => lines(fake).length > 0);
    assert.match(lines(fake)[0], /conflict/u);
    assert.equal(slashGoal(fake).length, 0, "OpenCode met with an open ledger is never cleared");
    assert.ok(fake.goals.has("ses_root"));

    await markLedgerGoalComplete(dir, "ses_root");
    await fake.run("session", "experimental.idle", { sessionID: "ses_root", background: [] });
    await until(() => !fake.goals.has("ses_root"));
    assert.deepEqual(slashGoal(fake).map((command) => command.text), ["clear"]);
    assert.match(lines(fake).at(-1), /^LitOpenCode goal: cleared/u);
    assert.ok((await ledgerEvents(dir)).some((event) => event.type === "native-goal.cleared" && event.goalID === "goal_ours_3"));
  });
});

test("idle repeats nothing: the conflict is said once, and a session without an owned goal costs no read", async () => {
  const met = { id: "goal_ours_4", objective: "ship it", status: "complete", rounds: 5 };
  await withHost({ goals: { ses_root: met } }, async (dir, fake, finish) => {
    await recordNativeGoal(dir, "ses_root", "lit-loop", { type: "native-goal.created", goalID: "goal_ours_4" });
    for (let turn = 0; turn < 3; turn += 1) await fake.run("session", "experimental.idle", { sessionID: "ses_root", background: [] });
    await fake.run("session", "experimental.idle", { sessionID: "ses_other", background: [] });
    await finish();
    assert.equal(lines(fake).length, 1);
    assert.equal(fake.goalCommands.length, 0);
  });
});

test("idle on a goal the user made does nothing", async () => {
  const mine = { id: "goal_user_2", objective: "mine", status: "complete", rounds: 2 };
  await withHost({ goals: { ses_root: mine } }, async (dir, fake, finish) => {
    await markLedgerGoalComplete(dir, "ses_root");
    await fake.run("session", "experimental.idle", { sessionID: "ses_root", background: [] });
    await finish();
    assert.equal(fake.goalCommands.length, 0);
    assert.equal(fake.notices.length, 0);
    assert.deepEqual(fake.goals.get("ses_root"), mine);
  });
});

test("a host without the goal RPC records native-goal-unavailable once per route and sets nothing", async () => {
  for (const goalHost of ["none", "no-goal-plugin"]) {
    await withHost({ goalHost }, async (dir, fake, finish) => {
      await fake.run("session", "prompt", prompt("lit loop first"));
      await until(() => lines(fake).length > 0);
      await fake.run("session", "prompt", prompt("lit loop second"));
      await finish();
      assert.equal(fake.goalCommands.length, 0, goalHost);
      assert.equal(lines(fake).length, 1, goalHost);
      assert.match(lines(fake)[0], /native-goal-unavailable/u);
      assert.deepEqual((await ledgerEvents(dir)).map((event) => event.type), ["native-goal.unavailable"], goalHost);
    });
  }
});

test("a read-only route on a host without /goal says nothing about goals", async () => {
  await withHost({ goalHost: "none" }, async (dir, fake, finish) => {
    await fake.run("session", "prompt", prompt("lit plan the release"));
    await finish();
    assert.equal(fake.notices.length, 0);
    assert.deepEqual(await ledgerEvents(dir), []);
  });
});

test("an unreadable goal state never creates a goal over it", async () => {
  await withHost({ failGoalRead: true }, async (_dir, fake, finish) => {
    await fake.run("session", "prompt", prompt("lit loop go"));
    await finish();
    assert.equal(fake.goalCommands.length, 0);
    assert.match(lines(fake)[0] ?? "", /conflict/u);
  });
});

test("a rejected /goal is recorded, claims no ownership, and does not stop the work", async () => {
  await withHost({ failGoalCommand: true }, async (dir, fake, finish) => {
    const admitted = await fake.run("session", "prompt", prompt("lit loop go"));
    await finish();
    assert.equal(admitted.metadata?.litopencode?.mode, "lit-loop");
    const events = await ledgerEvents(dir);
    assert.deepEqual(events.map((event) => event.type), ["native-goal.failed"]);
    assert.equal(fake.notices.length, 0);
  });
});

test("a command the plugin sends (lit-loop) and an expanded command alias body both set a goal with their own work", async () => {
  await withHost({}, async (_dir, fake) => {
    const editor = fake.applyCommands();
    const definition = editor.commands.find((command) => command.name === "lit-loop");
    assert.ok(definition, "lit-loop is plugin-owned when no alias file exists");
    await definition.execute({ sessionID: "ses_root", prompt: { text: "tidy the logger" }, delivery: "queue" });
    const sent = fake.prompts.at(-1);
    await fake.run("session", "prompt", { sessionID: "ses_root", messageID: "msg_cmd", prompt: { text: sent.text }, metadata: sent.metadata, delivery: "queue" });
    await until(() => fake.goals.has("ses_root"));
    assert.match(slashGoal(fake)[0].text, /tidy the logger/u);
  });
  await withHost({}, async (_dir, fake) => {
    await fake.run("session", "prompt", prompt(`${findLitOpenCodeCommand("lit-loop").activationText}\n\nwire the exporter`));
    await until(() => fake.goals.has("ses_root"));
    assert.match(slashGoal(fake)[0].text, /wire the exporter/u);
  });
});

test("the expanded alias bodies of /litwork and /start-work qualify, and bare /lit does not", async () => {
  for (const [id, route] of [["litwork", "litwork"], ["lit-work", "litwork"], ["start-work", "start-work"]]) {
    await withHost({}, async (dir, fake) => {
      await fake.run("session", "prompt", prompt(`${findLitOpenCodeCommand(id).activationText}\n\nship the thing`));
      await until(() => fake.goals.has("ses_root"));
      assert.equal(slashGoal(fake).length, 1, id);
      assert.equal((await ledgerEvents(dir)).find((event) => event.type === "native-goal.created")?.route, route, id);
    });
  }
  await withHost({}, async (dir, fake, finish) => {
    await fake.run("session", "prompt", prompt(`${findLitOpenCodeCommand("lit").activationText}\n\ndo a small thing`));
    await finish();
    assert.equal(fake.goalCommands.length, 0, "/lit sets no goal");
    assert.deepEqual(await ledgerEvents(dir), []);
  });
});

test("the goal objective names the session id the ledger goal must use", async () => {
  await withHost({}, async (_dir, fake) => {
    await fake.run("session", "prompt", prompt("lit loop tidy it"));
    await until(() => fake.goals.has("ses_root"));
    assert.match(slashGoal(fake)[0].text, /--session-id ses_root/u);
  });
});

test("a ledger goal completed before the native goal existed does not close it", async () => {
  const met = { id: "goal_ours_5", objective: "ship it", status: "complete", rounds: 5 };
  await withHost({ goals: { ses_root: met } }, async (dir, fake, finish) => {
    await markLedgerGoalComplete(dir, "ses_root", "2020-01-01T00:00:00.000Z");
    await recordNativeGoal(dir, "ses_root", "lit-loop", { type: "native-goal.created", goalID: "goal_ours_5" });
    await fake.run("session", "experimental.idle", { sessionID: "ses_root", background: [] });
    await finish();
    assert.equal(fake.goalCommands.length, 0, "the old completion is not this goal's evidence");
    assert.match(lines(fake)[0] ?? "", /conflict/u);
  });
});

test("a host that cannot register the idle hook still starts", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-goal-idle-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  try {
    const fake = createFakeV2Context({ directory: dir, sessions: {} });
    const original = fake.context.session.hook;
    fake.context.session.hook = async (name, callback) => {
      if (name === "experimental.idle") throw new Error("unknown session hook experimental.idle");
      return original(name, callback);
    };
    const cleanup = await setupLitOpenCodeServer(fake.context);
    await cleanup();
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
