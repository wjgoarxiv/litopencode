import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { lineWidth, paletteFromTheme } from "../src/tui/mission-text.ts";
import { statusCard } from "../src/tui/mission-band.ts";
import { hasEarlierWork, readThreadSources } from "../src/tui/mission-source.ts";
import { pulseText, threadGauge, threadLineCount, threadsOf } from "../src/tui/mission-threads.ts";
import { workflowStackSchema } from "../src/workflow-stack.ts";

const now = Date.parse("2026-10-26T12:00:00.000Z");
const palette = paletteFromTheme(undefined);
const text = (line) => line.map((segment) => segment.text).join("");
const unknownMarks = /\?\/\?|\[\?\?\?\]|\d+\/\?|\?{2,}/u;
const idle = buildMissionView({ marks: [], todos: [], now });
const working = buildMissionView({ marks: [{ at: now - 7 * 60_000, mode: "lit-task" }], todos: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }], now });
const figures = { contextPercent: 12, inLane: false };

const lane = (name, extra = {}) => ({ kind: "task", name, status: "working", touchedAt: now - 30_000, startedAt: now - 3 * 60_000, ...extra });
const card = (view, extra = {}, width = 100) => statusCard({ view, frame: restingFrameFor(view, now), chips: [], figures, ...extra }, palette, width);

test("one lane keeps the old four-row card; two or more lanes add a fork line and one row per lane", () => {
  assert.equal(threadsOf([lane("only")], now), undefined);
  assert.equal(card(working).length, 4);
  const rows = threadsOf([lane("explore the api"), lane("write the tests"), lane("update the docs")], now);
  assert.equal(rows.length, 3);
  assert.equal(threadLineCount(rows), 4);
  const lines = card(working, { threads: rows });
  assert.equal(lines.length, 8);
  assert.match(text(lines[3]), /┬ 3 lanes in parallel/u);
  assert.match(text(lines[4]), /├─ explore the api/u);
  assert.match(text(lines[6]), /└─ update the docs/u);
  for (const line of lines) assert.equal(lineWidth(line), 100, text(line));
});

test("a paused parent keeps its real gauge while the side lane works", () => {
  const rows = threadsOf([
    { kind: "stack", name: "start-work", status: "paused", done: 3, total: 10, touchedAt: now - 60_000 },
    { kind: "stack", name: "lit-research", status: "working", touchedAt: now - 20_000, startedAt: now - 2 * 60_000 }
  ], now);
  const lines = card(working, { threads: rows }).map(text);
  assert.match(lines[4], /start-work\s+paused\s+\[▉▉░░░░░░\] 3\/10/u);
  assert.equal(threadGauge(3, 10, 8), "[▉▉░░░░░░] 3/10");
  assert.match(lines[5], /lit-research\s+working\s+2m ░|lit-research\s+working\s+2m [▓▒░]/u);
});

test("six lanes draw four rows and a +2 more line", () => {
  const rows = threadsOf(Array.from({ length: 6 }, (_, index) => lane(`lane ${index + 1}`)), now);
  assert.equal(threadLineCount(rows), 6);
  const lines = card(working, { threads: rows }).map(text);
  assert.equal(lines.length, 10);
  assert.match(lines[8], /└─ \+2 more/u);
  assert.match(lines[7], /├─ lane 4/u);
});

test("the card holds its height while lanes are live and drops to four rows once reserve is released", () => {
  const rows = threadsOf([lane("a"), lane("b"), lane("c")], now);
  const heights = [
    card(working, { threads: rows, reserve: 4 }).length,
    card(working, { threads: rows.slice(0, 2), reserve: 4 }).length,
    card(working, { reserve: 4 }).length,
    card(working, { reserve: 0 }).length
  ];
  assert.deepEqual(heights, [8, 8, 8, 4]);
  for (const line of card(working, { reserve: 4 })) assert.equal(lineWidth(line), 100);
});

test("a working lane untouched for five minutes reads as idle, and each status is a word", () => {
  const rows = threadsOf([lane("old", { touchedAt: now - 9 * 60_000 }), lane("new", { status: "done" }), lane("bad", { status: "failed" })], now);
  assert.deepEqual(rows.map((row) => row.status), ["idle", "done", "failed"]);
  const lines = card(working, { threads: rows }).map(text);
  assert.match(lines[4], /idle/u);
  assert.match(lines[5], /done/u);
  assert.match(lines[6], /failed/u);
});

test("unknown totals never draw a question-mark gauge: facts in words plus a pulse; only real totals draw a bar", () => {
  const rows = threadsOf([
    lane("no counts"),
    lane("zero total", { done: 0, total: 0 }),
    lane("half", { done: 2, total: 4 }),
    { kind: "stack", name: "lit-plan", status: "paused", phase: "step 4", touchedAt: now - 1000 }
  ], now);
  assert.equal(rows[1].total, undefined);
  assert.equal(threadsOf([lane("a"), lane("overshoot", { done: 5, total: 3 })], now)[1].total, undefined);
  const lines = card(working, { threads: rows, motion: true }, 110).map(text);
  for (const line of lines) assert.doesNotMatch(line, unknownMarks, line);
  assert.match(lines[4], /no counts\s+working\s+3m [░▒▓]{5}/u);
  assert.match(lines[6], /half\s+working\s+\[▉▉▉▉░░░░\] 2\/4/u);
  assert.match(lines[7], /lit-plan\s+paused\s+step 4/u);
  for (const state of [idle, working]) for (const width of [60, 80, 120]) assert.doesNotMatch(card(state, { threads: rows }, width).map(text).join("\n"), unknownMarks);
});

test("the pulse scans with motion and holds one frame without it", () => {
  const frames = new Set([0, 250, 500, 750, 1000, 1250].map((at) => pulseText(at, true)));
  assert.ok(frames.size >= 4);
  assert.equal(pulseText(0, false), pulseText(99_999, false));
  const rows = threadsOf([lane("a"), lane("b")], now);
  assert.equal(text(card(working, { threads: rows, motion: false })[4]), text(card(working, { threads: rows, motion: false })[4]));
});

test("rows fit narrow terminals and Hangul lane names by cell width", () => {
  const rows = threadsOf([lane("로그인 화면 테스트 작성과 문서 갱신"), lane("api 점검", { done: 1, total: 3 })], now);
  for (const width of [40, 60, 80]) for (const line of card(working, { threads: rows }, width)) assert.equal(lineWidth(line), width, text(line));
});

test("the idle card names lit adhd only when earlier work exists, and keeps the old words otherwise", () => {
  assert.match(text(card(idle)[1]), /add lit to a prompt to start/u);
  assert.match(text(card(idle, { earlier: true })[1]), /lit adhd to pick up where you left off/u);
  const withLast = card(idle, { earlier: true, last: { title: "hello.txt", passed: 2, total: 3, complete: false } }, 120);
  assert.match(text(withLast[1]), /last: hello\.txt ● 2\/3 {2}lit adhd to pick up where you left off/u);
  assert.doesNotMatch(text(withLast[1]), unknownMarks);
});

async function withStacks(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-threads-"));
  try {
    const dir = path.join(root, ".litopencode", "workflow-stack");
    await fs.mkdir(dir, { recursive: true });
    const write = (id, frames, updatedAt) => fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ schema: workflowStackSchema, sessionID: id, frames, updatedAt }));
    await run(root, dir, write);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const frame = (skill, status, at, extra = {}) => ({ skill, status, at, ...extra });
const emptyState = (parts = {}, todos = {}) => ({
  path: {},
  provider: [],
  session: {
    messages: () => [{ id: "m1", role: "assistant" }],
    todo: (id) => todos[id] ?? [],
    status: () => undefined,
    permission: () => [],
    question: () => []
  },
  part: (id) => parts[id] ?? []
});

test("sources come from this session's stack, its task calls and fresh sibling stacks; stale and linked ones are dropped", async () => {
  await withStacks(async (root, dir, write) => {
    await write("ses_self", [frame("start-work", "paused", now - 60_000, { done: 3, total: 10 }), frame("lit-research", "active", now - 5000)], now - 5000);
    await write("ses_fresh", [frame("lit-plan", "active", now - 120_000, { phase: "step 2" })], now - 120_000);
    await write("ses_stale", [frame("lit-loop", "active", now - 40 * 60_000)], now - 40 * 60_000);
    await write("ses_child", [frame("lit-task", "active", now - 1000)], now - 1000);
    await fs.writeFile(path.join(root, "outside.json"), JSON.stringify({ schema: workflowStackSchema, sessionID: "ses_link", frames: [frame("lit-loop", "active", now)], updatedAt: now }));
    await fs.symlink(path.join(root, "outside.json"), path.join(dir, "ses_link.json"));
    const task = (status, start, end, description, child) => ({ type: "tool", tool: "task", state: { status, input: { description, prompt: "SECRET PROMPT" }, metadata: { sessionId: child }, time: { start, ...(end === undefined ? {} : { end }) } } });
    const state = emptyState(
      { m1: [task("running", now - 90_000, undefined, "explore", "ses_child"), task("completed", now - 200_000, now - 10_000, "tests", "ses_t2"), task("completed", now - 900_000, now - 600_000, "old", "ses_t3")] },
      { ses_child: [{ content: "x", status: "completed" }, { content: "y", status: "pending" }] }
    );
    const sources = readThreadSources(state, "ses_self", root, now);
    assert.deepEqual(sources.map((source) => `${source.kind}:${source.name}:${source.status}`), [
      "stack:start-work:paused",
      "stack:lit-research:working",
      "task:explore:working",
      "task:tests:done",
      "session:lit-plan · resh:working"
    ]);
    assert.deepEqual([sources[0].done, sources[0].total], [3, 10]);
    assert.deepEqual([sources[2].done, sources[2].total], [1, 2]);
    assert.equal(sources[3].done, undefined);
    assert.doesNotMatch(JSON.stringify(sources), /SECRET PROMPT/u, "a task's prompt is never read");
    assert.equal(threadsOf(sources, now).length, 5);
    assert.equal(hasEarlierWork(root, "ses_self", now, 7 * 24 * 3_600_000), true);
    assert.equal(hasEarlierWork(root, "ses_only", now, 500), false);
  });
});

test("a workspace with no stack directory and no tasks has no lanes", async () => {
  await withStacks(async (root) => {
    assert.deepEqual(readThreadSources(emptyState(), "ses_self", root, now), []);
    assert.deepEqual(readThreadSources(emptyState(), "ses_self", undefined, now), []);
    assert.equal(hasEarlierWork(root, "ses_self", now, 1000), false);
  });
});

test("a subagent still writing after five minutes stays working; one whose session went quiet reads idle, never blocked", async () => {
  await withStacks(async (root) => {
    const task = (child) => ({ type: "tool", tool: "task", state: { status: "running", input: { description: child }, metadata: { sessionId: child }, time: { start: now - 20 * 60_000 } } });
    const childMessages = { busy: [{ id: "c1", role: "assistant", time: { created: now - 40_000 } }], quiet: [{ id: "c2", role: "assistant", time: { created: now - 12 * 60_000, completed: now - 11 * 60_000 } }] };
    const state = {
      path: {},
      provider: [],
      session: {
        messages: (id) => (id === "ses_self" ? [{ id: "m1", role: "assistant" }] : childMessages[id] ?? []),
        todo: () => [],
        status: () => undefined,
        permission: () => [],
        question: () => []
      },
      part: (id) => (id === "m1" ? [task("busy"), task("quiet")] : [])
    };
    const rows = threadsOf(readThreadSources(state, "ses_self", root, now), now);
    assert.deepEqual(rows.map((row) => `${row.name}:${row.status}`), ["busy:working", "quiet:idle"]);
    for (const row of rows) assert.ok(["working", "paused", "done", "failed", "idle"].includes(row.status), "no blocked or stalled status exists");
  });
});
