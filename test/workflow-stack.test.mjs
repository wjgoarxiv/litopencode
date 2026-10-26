import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  emptyStack,
  isSpineSkill,
  pauseSpine,
  pushSide,
  readStack,
  readSiblingStacks,
  resumeSpine,
  startSpine,
  writeStack
} from "../src/workflow-stack.ts";

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "litopencode-stack-"));
const progress = { phase: "work", done: 2, total: 5 };

test("a spine skill is lit-loop, lit-plan, start-work or lit-task; brainstorm is a side skill", () => {
  for (const skill of ["lit-loop", "lit-plan", "start-work", "lit-task"]) assert.equal(isSpineSkill(skill), true, skill);
  for (const skill of ["lit-brainstorm", "lit-recap", "lit-adhd", "lit-hijack"]) assert.equal(isSpineSkill(skill), false, skill);
});

test("push, pause, side-done and resume keep the spine's stage and k/n", () => {
  let stack = startSpine(emptyStack("ses_a"), "lit-loop", 1000);
  stack = pushSide(stack, "lit-brainstorm", 2000, progress);
  assert.deepEqual(stack.frames.map((frame) => [frame.skill, frame.status]), [["lit-loop", "paused"], ["lit-brainstorm", "active"]]);
  assert.deepEqual([stack.frames[0].phase, stack.frames[0].done, stack.frames[0].total], ["work", 2, 5]);
  const resumed = resumeSpine(stack, 3000);
  assert.equal(resumed.resumed?.skill, "lit-loop");
  assert.deepEqual(resumed.stack.frames.map((frame) => [frame.skill, frame.status]), [["lit-loop", "active"]]);
  assert.deepEqual([resumed.stack.frames[0].phase, resumed.stack.frames[0].done, resumed.stack.frames[0].total], ["work", 2, 5]);
});

test("a second side skill replaces the first side frame and leaves the paused spine alone", () => {
  let stack = startSpine(emptyStack("ses_a"), "lit-plan", 1000);
  stack = pushSide(stack, "lit-brainstorm", 2000, progress);
  stack = pushSide(stack, "lit-recap", 2500, progress);
  assert.deepEqual(stack.frames.map((frame) => frame.skill), ["lit-plan", "lit-recap"]);
  assert.equal(stack.frames[0].status, "paused");
  assert.equal(stack.frames[0].done, 2);
});

test("a side skill with no spine is a lone active frame and resume has nothing to return to", () => {
  const stack = pushSide(emptyStack("ses_a"), "lit-recap", 1000, undefined);
  assert.deepEqual(stack.frames.map((frame) => [frame.skill, frame.status]), [["lit-recap", "active"]]);
  assert.equal(resumeSpine(stack, 2000).resumed, undefined);
});

test("a new spine skill ends the old stack", () => {
  let stack = startSpine(emptyStack("ses_a"), "lit-loop", 1000);
  stack = pushSide(stack, "lit-brainstorm", 2000, progress);
  stack = startSpine(stack, "lit-plan", 3000);
  assert.deepEqual(stack.frames.map((frame) => [frame.skill, frame.status]), [["lit-plan", "active"]]);
});

test("pauseSpine never invents a count: an unknown total stays absent", () => {
  const stack = pauseSpine(startSpine(emptyStack("ses_a"), "lit-loop", 1000), 2000, { phase: "work" });
  assert.equal("done" in stack.frames[0], false);
  assert.equal("total" in stack.frames[0], false);
});

test("the store round-trips, refuses a symlinked file and a traversing session id", async () => {
  const root = await temp();
  try {
    const stack = pushSide(startSpine(emptyStack("ses_a"), "lit-loop", 1000), "lit-brainstorm", 2000, progress);
    await writeStack(root, stack);
    assert.deepEqual((await readStack(root, "ses_a"))?.frames, stack.frames);
    const dir = path.join(root, ".litopencode", "workflow-stack");
    await fs.writeFile(path.join(root, "elsewhere.json"), "{}");
    await fs.symlink(path.join(root, "elsewhere.json"), path.join(dir, "ses_link.json"));
    assert.equal(await readStack(root, "ses_link"), undefined);
    await assert.rejects(() => writeStack(root, emptyStack("../escape")), /session id/u);
    assert.equal(await readStack(root, "../escape"), undefined);
    await assert.rejects(() => fs.stat(path.join(root, ".litopencode", "escape.json")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a corrupt or oversized stack file reads as no stack", async () => {
  const root = await temp();
  try {
    const dir = path.join(root, ".litopencode", "workflow-stack");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "ses_bad.json"), "{not json");
    await fs.writeFile(path.join(dir, "ses_big.json"), "x".repeat(70_000));
    assert.equal(await readStack(root, "ses_bad"), undefined);
    assert.equal(await readStack(root, "ses_big"), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("sibling stacks skip the session's own file, links and stale files, and stop at the cap", async () => {
  const root = await temp();
  try {
    const now = 10_000_000;
    for (let index = 0; index < 8; index += 1) {
      await writeStack(root, startSpine(emptyStack(`ses_${index}`), "lit-loop", now - 1000));
    }
    await writeStack(root, startSpine(emptyStack("ses_old"), "lit-loop", now - 3_600_000));
    const found = await readSiblingStacks(root, "ses_0", { now, freshMs: 15 * 60_000, max: 6 });
    assert.equal(found.length, 6);
    assert.ok(found.every((stack) => stack.sessionID !== "ses_0" && stack.sessionID !== "ses_old"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
