import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { takePendingExtensionsNotice } from "../src/extensions-notice.ts";
import { adhdSuggestDue } from "../src/tui/mission-source.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

// LitOpenCode keeps a small append-only record of the notices it already printed (a hash and a time) and of
// how each bounded run ended. Its repeated surfaces consult it; a missing or damaged record changes nothing.

async function withProject(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-shown-")));
  try {
    await fs.mkdir(path.join(dir, ".litopencode"));
    await fs.mkdir(path.join(dir, "src"));
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "PLAN.md"), "# Plan\n\n- [ ] 1. one\n");
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const recordLines = async (dir) =>
  (await fs.readFile(path.join(dir, ".litopencode", "shown.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));

// ---- the record itself ----

test("a notice's hash ignores whitespace and a recorded notice is found, but not before the cut-off time", async () => {
  const record = await import("../src/shown-record.ts");
  await withProject(async (dir) => {
    const file = path.join(dir, ".litopencode", "shown.jsonl");
    assert.equal(record.noticeHash("A  notice\n here"), record.noticeHash("A notice here"));
    assert.notEqual(record.noticeHash("A notice here"), record.noticeHash("Another notice"));
    const hash = record.noticeHash("A notice here");
    assert.equal(record.noticeShown(file, hash), false, "no record yet");
    record.recordNotice(file, hash, Date.parse("2026-01-01T10:00:00Z"));
    assert.equal(record.noticeShown(file, hash), true);
    assert.equal(record.noticeShown(file, hash, Date.parse("2026-01-01T09:00:00Z")), true);
    assert.equal(record.noticeShown(file, hash, Date.parse("2026-01-02T00:00:00Z")), false, "recorded before the cut-off");
    assert.equal(record.noticeShown(file, record.noticeHash("Another notice")), false);
  });
});

test("a damaged record shows the notice, and a damaged line does not hide the others", async () => {
  const record = await import("../src/shown-record.ts");
  await withProject(async (dir) => {
    const file = path.join(dir, ".litopencode", "shown.jsonl");
    const hash = record.noticeHash("A notice here");
    await fs.writeFile(file, "not json at all\n{broken\n");
    assert.equal(record.noticeShown(file, hash), false);
    record.recordNotice(file, hash);
    assert.equal(record.noticeShown(file, hash), true, "the valid line after the damaged ones counts");
    await fs.rm(file);
    await fs.mkdir(file);
    assert.equal(record.noticeShown(file, hash), false, "a record that cannot be read shows the notice");
    assert.doesNotThrow(() => record.recordNotice(file, hash), "a record that cannot be written is not an error");
  });
});

// ---- the lit-adhd start suggestion ----

test("the lit-adhd suggestion is offered once a day in a workspace, across launches", async () => {
  await withProject(async (dir) => {
    const now = new Date(2026, 4, 5, 10, 0, 0).getTime();
    assert.equal(adhdSuggestDue(new Map(), dir, now), true, "first launch of the day");
    assert.equal(adhdSuggestDue(new Map(), dir, now + 60_000), false, "a second launch the same day stays quiet");
    assert.equal(adhdSuggestDue(new Map(), dir, now + 3 * 60 * 60_000), false, "and a third");
    assert.equal(adhdSuggestDue(new Map(), dir, now + 25 * 60 * 60_000), true, "the next day may suggest again");
  });
});

test("a damaged or unwritable record leaves the suggestion at once-per-launch, as before", async () => {
  await withProject(async (dir) => {
    const now = new Date(2026, 4, 5, 10, 0, 0).getTime();
    await fs.writeFile(path.join(dir, ".litopencode", "shown.jsonl"), "{{{\n");
    const days = new Map();
    assert.equal(adhdSuggestDue(days, dir, now), true);
    assert.equal(adhdSuggestDue(days, dir, now + 60_000), false, "the in-memory day still holds inside one launch");
  });
  const missing = path.join(os.tmpdir(), "litopencode-shown-missing", "ws");
  const days = new Map();
  assert.equal(adhdSuggestDue(days, missing, Date.now()), true, "no state folder: nothing can be recorded and nothing is created");
  await assert.rejects(fs.stat(path.join(os.tmpdir(), "litopencode-shown-missing")), { code: "ENOENT" });
});

// ---- the installer's extensions notice ----

const installArgs = (root) => ["install", "--root", root, "--provider", "openai", "--model", "gpt-5.6-luna", "--effort", "high", "--no-agent-file"];

async function installOnce(root) {
  const result = runCli(installArgs(root), { env: { ...process.env, HOME: path.dirname(path.dirname(root)) } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ?? "";
}

// A second full install in one root takes over a minute even on the released code, so a repeat is seeded:
// the record already holds the hash of the notice a clean install prints.
const cleanNoticeHash = async () => {
  const { extensionsNoticeLines } = await import("../src/extensions-notice.ts");
  const { noticeHash } = await import("../src/shown-record.ts");
  return noticeHash(extensionsNoticeLines([], false).join("\n"));
};
const shownLine = (hash) => `${JSON.stringify({ kind: "notice", hash, at: new Date().toISOString() })}\n`;

test("an install prints and leaves the extensions notice once, and records its hash", async () => {
  await withTempDir(async (dir) => {
    const root = path.join(dir, "xdg-config", "opencode");
    const first = await installOnce(root);
    assert.match(first, /LitFamily extensions/);
    assert.match((await takePendingExtensionsNotice(root)) ?? "", /LitFamily extensions/, "the first session relays it");
    const record = await fs.readFile(path.join(root, ".litopencode-shown.jsonl"), "utf8");
    assert.equal(JSON.parse(record.trim()).hash, await cleanNoticeHash());
  });
});

test("an install whose notice was already shown prints and relays nothing about it", async () => {
  await withTempDir(async (dir) => {
    const root = path.join(dir, "xdg-config", "opencode");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, ".litopencode-shown.jsonl"), shownLine(await cleanNoticeHash()));
    const repeat = await installOnce(root);
    assert.doesNotMatch(repeat, /LitFamily extensions/, "the repeat install stays quiet about it");
    assert.equal(await takePendingExtensionsNotice(root), undefined, "and leaves nothing to relay");
  });
});

test("a changed notice text is a new notice, and a damaged record shows it again", async () => {
  await withTempDir(async (dir) => {
    const root = path.join(dir, "xdg-config", "opencode");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, ".litopencode-shown.jsonl"), shownLine("0123456789abcdef"));
    assert.match(await installOnce(root), /LitFamily extensions/, "another notice's hash does not hide this one");
  });
  await withTempDir(async (dir) => {
    const root = path.join(dir, "xdg-config", "opencode");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, ".litopencode-shown.jsonl"), "garbage\n{{\n");
    assert.match(await installOnce(root), /LitFamily extensions/);
  });
});

// ---- how a bounded run ended ----

const init = (lifecycle) => lifecycle.init({
  schemaVersion: 3, requestId: "init-1", sessionID: "owner", trustedUser: true, expectedRevision: 0, planPath: "PLAN.md",
  worktree: null, authorized: true, authority: [{ action: "write", root: "src" }]
});
const terminal = (state, requestId) => ({ schemaVersion: 3, requestId, workId: state.workId, sessionID: "owner", expectedRevision: state.revision, trustedUser: true });
let counter = 0;
const fence = (state, overrides = {}) => {
  counter += 1;
  return { schemaVersion: 3, workId: state.workId, sessionID: "owner", revision: state.revision, progressId: `p-${counter}`, messageID: `m-${counter}`, partID: `pt-${counter}`, summary: `step ${counter}`, ...overrides };
};

test("a completed run is recorded as sent", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    await lifecycle.complete(terminal(started, "done-1"));
    const lines = await recordLines(dir);
    assert.deepEqual(lines.map((line) => [line.kind, line.outcome, line.workId]), [["run-end", "sent", started.workId]]);
  });
});

test("a cancelled run is recorded as nothing, whether by the run or by the user", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    await lifecycle.cancel(terminal(started, "cancel-1"));
    assert.deepEqual((await recordLines(dir)).map((line) => line.outcome), ["nothing"]);
  });
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    await init(lifecycle);
    await lifecycle.userCancel({ schemaVersion: 3, requestId: "user-cancel-1", sessionID: "owner", trustedUser: true });
    assert.deepEqual((await recordLines(dir)).map((line) => line.outcome), ["nothing"]);
  });
});

test("a run that parks a step is recorded as waiting once, not again for the same wait", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    const parked = await lifecycle.recordProgress(fence(started, { boundary: { action: "write", root: "docs" } }));
    assert.equal(parked.outcome, "parked");
    const again = await lifecycle.recordProgress(fence(parked.state, { boundary: { action: "write", root: "docs" }, summary: "again" }));
    assert.equal(again.outcome, "parked");
    assert.deepEqual((await recordLines(dir)).map((line) => line.outcome), ["waiting"]);
  });
});

test("a run that only makes progress records nothing", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    await lifecycle.recordProgress(fence(started));
    await assert.rejects(fs.stat(path.join(dir, ".litopencode", "shown.jsonl")), { code: "ENOENT" });
  });
});

test("an unwritable record never stops the run", async () => {
  await withProject(async (dir) => {
    await fs.mkdir(path.join(dir, ".litopencode", "shown.jsonl"));
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    const done = await lifecycle.complete(terminal(started, "done-2"));
    assert.equal(done.state.status, "completed");
  });
});
