import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLitOpenCodePlugin } from "../src/server.ts";
import { litOpenCodeTools } from "../src/tools.ts";
import { statusCard } from "../src/tui/mission-band.ts";
import { activeSkillLook, lookOfSkill, reviewLanes, turnBreathMs, turnColor, turnGlow, waitingOnYou } from "../src/tui/mission-looks.ts";
import { buildMissionView, readWorkState } from "../src/tui/mission-model.ts";
import { idleMotion, planMotion, restingFrameFor, sampleMotion } from "../src/tui/mission-motion.ts";
import { rainbowAt } from "../src/tui/mission-rainbow.ts";
import { readCardInput, readMissionInput } from "../src/tui/mission-source.ts";
import { lineWidth, paletteFromTheme } from "../src/tui/mission-text.ts";
import { relativeLuminance } from "../src/tui/mission-rainbow.ts";

const now = Date.parse("2026-10-27T09:00:00.000Z");
const palette = paletteFromTheme(undefined);
const figures = { contextPercent: 12, inLane: false };
const view = (mode, extra = {}) => buildMissionView({ marks: [{ at: now - 60_000, mode }], todos: [], now, ...extra });
const plain = (line) => line.map((segment) => segment.text).join("");

function session({ user = [], assistant = [], status = "busy", permission = [], question = [], lastRole = "assistant" } = {}) {
  const messages = [{ id: "u1", role: "user", time: { created: now - 3000 } }];
  if (lastRole === "assistant") messages.push({ id: "a1", role: "assistant", time: { created: now - 2000 } });
  return {
    session: { messages: () => messages, todo: () => [], status: () => ({ type: status }), permission: () => permission, question: () => question },
    part: (id) => (id === "u1" ? user : assistant)
  };
}

function lookOf(state) {
  const mission = buildMissionView(readMissionInput(state, "ses_a", undefined, now));
  const card = readCardInput(state, "ses_a");
  return activeSkillLook(mission, card.chips, card.busy);
}

const tool = (name, input, status = "completed") => ({ type: "tool", tool: name, state: { status, input, time: { start: now - 1500 } } });

test("the look registry maps lit-adhd and lit-rewind to the rewind look and review-work to its lanes, nothing else", () => {
  assert.equal(lookOfSkill("lit-adhd"), "rewind");
  assert.equal(lookOfSkill("lit-rewind"), "rewind");
  assert.equal(lookOfSkill("review-work"), "review");
  for (const name of ["lit-plan", "lit-loop", "constructor", "toString", ""]) assert.equal(lookOfSkill(name), undefined, name);
  assert.equal(activeSkillLook(view("review-work"), [], true), "review");
  assert.equal(activeSkillLook(view("lit-plan"), [{ name: "review-work", current: true }], true), "review", "a chip lit by this turn is enough");
  assert.equal(activeSkillLook(view("lit-plan"), [{ name: "review-work", current: false }], true), undefined, "an old chip is not");
  assert.equal(activeSkillLook(view("review-work"), [], false), undefined, "a resting session wears no skill look");
});

test("every review-work route selects the review look: bare word, /review-work, its tool and a skill load", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-looks-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }) } };
  const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
  try {
    const chat = { message: { id: "msg_x", sessionID: "ses_a", role: "user" }, parts: [{ id: "prt_x", sessionID: "ses_a", messageID: "msg_x", type: "text", text: "lit review-work the last commit" }] };
    await hooks["chat.message"]({ sessionID: "ses_a", messageID: "msg_x", agent: "build" }, chat);
    assert.equal(lookOf(session({ user: chat.parts })), "review", "bare word");
    const command = { parts: [] };
    await hooks["command.execute.before"]({ command: "review-work", sessionID: "ses_a", arguments: "" }, command);
    assert.equal(lookOf(session({ user: command.parts })), "review", "slash command");
  } finally {
    await hooks.dispose();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
  assert.equal(lookOf(session({ assistant: [tool("review-work", { action: "review" })] })), "review", "its own tool");
  assert.equal(lookOf(session({ assistant: [tool("skill", { name: "review-work" })] })), "review", "a native skill load");
});

test("lane reports come from completed review-work lane calls, and a new review start clears them", () => {
  const card = readCardInput(session({ assistant: [
    tool("review-work", { action: "review" }),
    tool("review-work", { action: "lane", lane: "scope", result: "pass" }),
    tool("review-work", { action: "lane", lane: "security", result: "fail" }),
    tool("review-work", { action: "lane", lane: "tests", result: "pass" }, "error"),
    tool("review-work", { action: "lane", lane: "made-up", result: "pass" })
  ] }), "ses_a");
  assert.deepEqual(card.lanes, { scope: "pass", security: "fail" });
  const again = readCardInput(session({ assistant: [
    tool("review-work", { action: "lane", lane: "scope", result: "pass" }),
    tool("review-work", { action: "review" })
  ] }), "ses_a");
  assert.deepEqual(again.lanes, {}, "the second review starts with every lane dim");
  assert.equal(readCardInput(session({ assistant: [tool("skill", { name: "lit-plan" })] }), "ses_a").lanes, undefined, "no review, no lanes");
});

test("the review look splits the top border into five lanes, dim until each reports, with a real count", () => {
  const review = view("review-work");
  for (const width of [60, 90, 120, 160]) {
    const rows = statusCard({ view: review, frame: restingFrameFor(review), chips: [], busy: true, figures, lanes: { scope: "pass", security: "fail" } }, palette, width);
    for (const row of rows) assert.equal(lineWidth(row), width, `row width at ${width}`);
    assert.match(plain(rows[0]), /REVIEW 2\/5/u);
    const rules = rows[0].filter((segment) => /^─+$/u.test(segment.text));
    const lanes = rules.slice(-reviewLanes.length).length === reviewLanes.length ? rules : [];
    assert.ok(lanes.length >= reviewLanes.length, `five lane stretches at ${width}`);
    const colours = new Set(rows[0].filter((segment) => /^─+$/u.test(segment.text) && segment.fg === palette.borderSubtle).map((segment) => segment.fg));
    assert.equal(colours.size, 1, "unreported lanes are dim");
    assert.ok(rows[0].some((segment) => /^─+$/u.test(segment.text) && segment.fg === palette.error), "a failed lane shows as an error");
  }
  const none = statusCard({ view: review, frame: restingFrameFor(review), chips: [], busy: true, figures, lanes: {} }, palette, 120);
  assert.match(plain(none[0]), /REVIEW 0\/5/u, "no reports: zero, never a guess");
});

test("the review-work tool records a lane and refuses an unknown lane or verdict", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-lane-")));
  const context = { sessionID: "ses_a", messageID: "m", agent: "lit-loop", directory: dir, worktree: dir, abort: new AbortController().signal, metadata() {}, ask: async () => undefined };
  try {
    const ok = await litOpenCodeTools["review-work"].execute({ action: "lane", lane: "tests", result: "pass" }, context);
    assert.equal(ok.metadata.lane, "tests");
    const files = (await fs.readdir(dir, { recursive: true })).filter((file) => file.endsWith("ledger.jsonl"));
    assert.equal(files.length, 1);
    assert.match(await fs.readFile(path.join(dir, files[0]), "utf8"), /"type":"tool\.review-work\.lane".*"lane":"tests".*"result":"pass"/u);
    const bad = await litOpenCodeTools["review-work"].execute({ action: "lane", lane: "vibes", result: "pass" }, context);
    assert.match(bad.output, /^BLOCKED:/u);
    const badResult = await litOpenCodeTools["review-work"].execute({ action: "lane", lane: "tests", result: "maybe" }, context);
    assert.match(badResult.output, /^BLOCKED:/u);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("waiting on the user: asked now, or idle on a decision, a BLOCKED reply or a paused boundary; typing ends it", () => {
  const idle = { asked: false, userSpokeLast: false, blockedReply: false, boundary: false };
  const plan = view("lit-plan");
  assert.equal(waitingOnYou(plan, true, idle), false, "a working turn is not waiting");
  assert.equal(waitingOnYou(plan, true, { ...idle, asked: true }), true, "a permission or question waits even mid-turn");
  assert.equal(waitingOnYou(plan, false, { ...idle, blockedReply: true }), true);
  assert.equal(waitingOnYou(plan, false, { ...idle, boundary: true }), true);
  assert.equal(waitingOnYou(plan, false, { ...idle, boundary: true, userSpokeLast: true }), false, "the user typed");
  assert.equal(waitingOnYou(plan, true, { ...idle, blockedReply: true }), false, "the next turn runs");
  const decision = { ...plan, warnings: [{ kind: "decision", text: "goal needs your decision" }] };
  assert.equal(waitingOnYou(decision, false, idle), true);
  assert.equal(waitingOnYou(plan, false, idle), false, "an idle session with nothing pending is not waiting");
});

test("the wait signals are read from the session: a pending permission, the last speaker and a BLOCKED reply", () => {
  assert.equal(readCardInput(session({ permission: [{ id: "p" }] }), "ses_a").asked, true);
  assert.equal(readCardInput(session({ question: [{ id: "q" }] }), "ses_a").asked, true);
  assert.equal(readCardInput(session({ lastRole: "user" }), "ses_a").userSpokeLast, true);
  assert.equal(readCardInput(session({ status: "idle", assistant: [{ type: "text", text: "\nBLOCKED: the plan has no criteria" }] }), "ses_a").blockedReply, true);
  assert.equal(readCardInput(session({ status: "idle", assistant: [{ type: "text", text: "Done. Nothing BLOCKED: here" }] }), "ses_a").blockedReply, undefined);
  // The reply as OpenCode stores it: the ignition fence and the model's ignition line come before the report.
  const hosted = "```text\nLIT\n```\n\n🔥 **LIT IGNITED · lit-plan** 🔥\n\nBLOCKED: the release plan has no acceptance criteria yet.\n";
  assert.equal(readCardInput(session({ status: "idle", assistant: [{ type: "step-start" }, { type: "text", text: hosted }] }), "ses_a").blockedReply, true);
  assert.equal(readCardInput(session({ status: "idle", assistant: [{ type: "text", text: "```text\nBLOCKED: inside a fence\n```\nAll done." }] }), "ses_a").blockedReply, undefined, "a quoted BLOCKED is not a report");
  const raw = { schemaVersion: 3, sessionID: "s1", status: "paused", history: [], plan: { path: "/p.md" }, pendingBoundary: { id: "b1", action: "deploy" } };
  assert.equal(readWorkState(raw, "s1")?.boundary, true);
  assert.equal(readWorkState({ ...raw, pendingBoundary: null }, "s1")?.boundary, undefined);
});

test("YOUR TURN breathes slowly in amber, holds still under reduced motion, and wins over the rewind look", () => {
  const plan = view("lit-plan");
  for (const width of [60, 100, 160]) {
    const rows = statusCard({ view: plan, frame: restingFrameFor(plan), chips: [], busy: false, figures, turn: { glow: 0 } }, palette, width);
    for (const row of rows) assert.equal(lineWidth(row), width);
    assert.match(plain(rows[0]), /YOUR TURN/u);
    assert.equal(rows[0][0].fg, palette.warning, "amber border at rest of the breath");
  }
  assert.ok(turnBreathMs >= 2000, "a breath is two seconds or longer");
  assert.equal(turnGlow(now, false), 0, "reduced motion or NO_COLOR holds one colour");
  // Four ticks a second: the border's luminance moves only a little between ticks, so nothing flashes.
  let worst = 0;
  for (let t = 0; t < turnBreathMs * 2; t += 250) {
    const step = Math.abs(relativeLuminance(turnColor(palette, turnGlow(t + 250, true))) - relativeLuminance(turnColor(palette, turnGlow(t, true))));
    worst = Math.max(worst, step);
  }
  assert.ok(worst < 0.05, `largest luminance step per tick ${worst}`);
  const adhd = view("lit-adhd");
  const both = statusCard({ view: adhd, frame: restingFrameFor(adhd), chips: [], busy: false, figures, turn: { glow: 0 }, rainbow: rainbowAt(now) }, palette, 120);
  assert.match(plain(both[0]), /YOUR TURN/u);
  assert.doesNotMatch(plain(both[0]), /REWIND/u);
});

test("the done burst plays once when the goal reaches done, never on a routine turn and never under reduced motion", () => {
  const goal = (passed) => ({ title: "ship", status: passed === 2 ? "complete" : "active", createdAt: new Date(now - 120_000).toISOString(), updatedAt: new Date(now - 30_000).toISOString(), criteria: [{ id: "c1", scenario: "a", status: passed >= 1 ? "pass" : "pending", evidence: [] }, { id: "c2", scenario: "b", status: passed >= 2 ? "pass" : "pending", evidence: [] }], checkpoints: [], reviewBlockers: [] });
  const working = view("lit-loop", { ledger: { goals: [goal(1)], activeGoalId: undefined, goal: goal(1) } });
  const done = view("lit-loop", { ledger: { goal: goal(2) } });
  if (!done.complete) return assert.fail("fixture goal should read as complete");
  const burst = planMotion(working, done, now, idleMotion, true);
  assert.equal(burst.celebrate, true);
  assert.notEqual(sampleMotion(burst, now + 200).celebrate, undefined, "it plays");
  assert.equal(sampleMotion(burst, now + 60_000).celebrate, undefined, "then settles");
  assert.equal(planMotion(done, done, now, burst, true).celebrate, false, "a routine turn on a done goal does not replay it");
  assert.equal(planMotion(working, done, now, idleMotion, false).celebrate, false, "reduced motion");
});
