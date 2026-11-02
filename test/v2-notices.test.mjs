import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createV2Events } from "../src/v2/events.ts";
import { appendNotice, createNoticeTail } from "../src/v2/notices.ts";

// OpenCode 2's server cannot raise a toast: its plugin context only subscribes to events. The server half of
// LitOpenCode therefore leaves each popup it would have shown (the automatic-handoff notices) in a small
// append-only file under the project's .litopencode, and the TUI half, which can raise toasts, reads the lines
// that appear after it started and shows them.
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-notices-"));
const file = (dir) => path.join(dir, ".litopencode", "notices.jsonl");
const notice = (message, extra = {}) => ({ title: "LitOpenCode auto-handoff", message, variant: "info", duration: 8000, ...extra });

test("a notice is one JSON line the tail returns once, in order, and never the history from before it started", () => {
  const dir = temp();
  appendNotice(file(dir), notice("old news"));
  const tail = createNoticeTail(file(dir));
  assert.deepEqual(tail.poll(), [], "history before the tail started is not replayed");
  appendNotice(file(dir), notice("first"));
  appendNotice(file(dir), notice("second", { variant: "warning" }));
  const got = tail.poll();
  assert.deepEqual(got.map((entry) => [entry.message, entry.variant]), [["first", "info"], ["second", "warning"]]);
  assert.deepEqual(tail.poll(), [], "read once");
  appendNotice(file(dir), notice("third"));
  assert.deepEqual(tail.poll().map((entry) => entry.message), ["third"]);
});

test("two tails each get every notice, since each TUI shows its own toast", () => {
  const dir = temp();
  const a = createNoticeTail(file(dir));
  const b = createNoticeTail(file(dir));
  appendNotice(file(dir), notice("shared"));
  assert.equal(a.poll().length, 1);
  assert.equal(b.poll().length, 1);
});

test("a missing file, a torn last line, junk and out-of-shape entries are skipped without throwing", () => {
  const dir = temp();
  const tail = createNoticeTail(file(dir));
  assert.deepEqual(tail.poll(), []);
  fs.mkdirSync(path.dirname(file(dir)), { recursive: true });
  fs.writeFileSync(file(dir), ["not json", JSON.stringify({ message: 4 }), JSON.stringify({ title: "t", message: "m", variant: "loud" }), JSON.stringify(notice("kept")), '{"title":"torn'].join("\n"));
  assert.deepEqual(tail.poll().map((entry) => entry.message), ["kept"], "a half-written last line waits for its newline");
  fs.appendFileSync(file(dir), '"}\n');
  assert.deepEqual(tail.poll(), [], "the completed line still is not a valid notice, and does not repeat what was read");
});

test("text is bounded and the variant and duration are normalised", () => {
  const dir = temp();
  const tail = createNoticeTail(file(dir));
  appendNotice(file(dir), notice("x".repeat(5000), { title: "t".repeat(500), duration: 10 ** 9 }));
  const [entry] = tail.poll();
  assert.ok(entry.message.length <= 400 && entry.title.length <= 80);
  assert.ok(entry.duration >= 1000 && entry.duration <= 15_000);
});

test("the file stays small: past its cap it is rewritten with the newest lines, and a tail keeps up", () => {
  const dir = temp();
  const tail = createNoticeTail(file(dir));
  for (let index = 0; index < 400; index += 1) appendNotice(file(dir), notice(`n${index} ${"y".repeat(200)}`));
  assert.ok(fs.statSync(file(dir)).size < 80_000, "bounded");
  const got = tail.poll();
  assert.equal(got.at(-1)?.message.startsWith("n399 "), true, "the newest survives the rewrite");
  appendNotice(file(dir), notice("after"));
  assert.deepEqual(tail.poll().map((entry) => entry.message), ["after"]);
});

test("appending to an unwritable place never throws; the notice is simply lost", () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, ".litopencode"), "a file where the folder should be");
  assert.doesNotThrow(() => appendNotice(file(dir), notice("nowhere")));
});

test("a symbolic link in place of the file is not followed", () => {
  const dir = temp();
  const outside = path.join(dir, "outside.jsonl");
  fs.writeFileSync(outside, "");
  fs.mkdirSync(path.dirname(file(dir)), { recursive: true });
  fs.symlinkSync(outside, file(dir));
  appendNotice(file(dir), notice("through a link"));
  assert.equal(fs.readFileSync(outside, "utf8"), "");
  assert.deepEqual(createNoticeTail(file(dir)).poll(), []);
});

test("the automatic handoff's toast calls land in the notices file on OpenCode 2", async () => {
  const dir = temp();
  const noticesFile = file(dir);
  const events = createV2Events({
    projectRoot: dir,
    paths: { autoHandoffFile: path.join(dir, "auto-handoff.json"), noticesFile },
    autoHandoffConfig: { enabled: true, percent: 50 },
    boundedAuthority: {},
    getSession: async (id) => ({ id, agent: "lit-loop" }),
    session: { prompt: async () => { throw new Error("refused"); }, compact: async () => undefined },
    model: { list: async () => [{ id: "openai/gpt-test", modelID: "gpt-test", providerID: "openai", name: "t", limit: { context: 1000 } }] },
    onSessionDeleted: () => undefined
  });
  const send = (type, data) => events.handle({ id: `evt_${type}`, created: Date.now(), type, data });
  await send("session.step.started", { sessionID: "ses_root", assistantMessageID: "msg_a1", agent: "lit-loop", model: { providerID: "openai", id: "gpt-test" }, started: Date.now() });
  await send("session.step.ended", { sessionID: "ses_root", assistantMessageID: "msg_a1", finish: "stop", cost: 0, tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } });
  await send("session.status", { sessionID: "ses_root", status: { type: "idle" } });
  await send("session.idle", { sessionID: "ses_root" });
  const lines = fs.existsSync(noticesFile) ? fs.readFileSync(noticesFile, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  assert.ok(lines.some((entry) => entry.variant === "warning" && /could not be started/u.test(entry.message)), JSON.stringify(lines));
  assert.equal(lines[0].title, "LitOpenCode auto-handoff");
});
