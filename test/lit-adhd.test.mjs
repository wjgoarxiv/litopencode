import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { consumeNext, nextFile } from "../src/adhd-next.ts";
import { createChatMessageActivationHook, detectChatActivationMode } from "../src/activation.ts";
import { createCommandActivationHook, findLitOpenCodeCommand } from "../src/commands.ts";
import { secretShape } from "../src/secret-shapes.ts";
import { cellWidth as tuiCellWidth } from "../src/tui/mission-text.ts";
import { buildStore } from "../test-support/rewind-store.mjs";
import { collect, cellWidth, factsLine, gauge, guardSql, isRealCount, pulse, redact, renderBrief, SECRET_SHAPE_SOURCE } from "../skills/lit-adhd/scripts/rewind.mjs";

const engine = fileURLToPath(new URL("../skills/lit-adhd/scripts/rewind.mjs", import.meta.url));
const placeholder = /\?\/\?|\[\?\?\?\]|\d+\/\?|\?{2,}/u;
const NOW = Date.parse("2026-10-26T12:00:00Z");

const secrets = {
  github: "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5",
  openai: "sk-" + "proj1234567890abcdefghijKLMN",
  aws: "AKIA" + "IOSFODNN7EXAMPLE",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r",
  uri: "postgres://admin:hunter2pass@db.internal:5432/app",
  named: "DATABASE_PASSWORD=correct-horse-battery"
};

const sensitive = { github: secrets.github, openai: secrets.openai, aws: secrets.aws, jwt: secrets.jwt.split(".")[2], uri: "hunter2pass", named: "correct-horse-battery" };

async function repo(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-adhd-")));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  try {
    git("init", "-q", "-b", "feat/demo");
    git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "--allow-empty", "-m", "feat: first milestone");
    await run(dir, git);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const text = (value, role = "assistant", extra = {}) => ({ type: "text", text: value, role, ...extra });
const tool = (name, status, input = {}) => ({ type: "tool", tool: name, state: { status, input } });

function fixtureSessions(dir) {
  const min = 60_000;
  return [
    { id: "ses_wait", directory: dir, title: "Migrate the billing tables", created: NOW - 90 * min, updated: NOW - 20 * min,
      messages: [{ role: "user", parts: [text("migrate billing", "user")] }, { role: "assistant", parts: [tool("edit", "completed", { filePath: "/x/src/billing.ts" }), tool("question", "running", { question: "which schema" })] }],
      todos: [{ content: "write the migration", status: "completed" }, { content: "run it against staging", status: "pending" }, { content: "verify the totals", status: "pending" }] },
    { id: "ses_work", directory: dir, title: "Port the exporter", created: NOW - 30 * min, updated: NOW - 30_000,
      messages: [{ role: "user", parts: [text("port the exporter", "user")] }, { role: "assistant", parts: [tool("bash", "completed", { command: "npm test" }), text("tests are green so far")] }] },
    { id: "ses_idle", directory: dir, title: "New session - 2026-10-20", created: NOW - 5 * 24 * 60 * min, updated: NOW - 5 * 24 * 60 * min,
      messages: [{ role: "user", parts: [text("한국어 보고서 초안을 정리해줘 그리고 표도 넣어줘", "user")] }, { role: "assistant", parts: [text("초안을 정리했습니다.")] }] }
  ];
}

test("guardSql allows one SELECT over the four session tables and nothing else", () => {
  assert.doesNotThrow(() => guardSql("SELECT id FROM session WHERE id = ?"));
  assert.doesNotThrow(() => guardSql("SELECT m.id FROM message m JOIN part p ON p.message_id = m.id"));
  for (const sql of ["DELETE FROM session", "SELECT * FROM credential", "SELECT * FROM session; DROP TABLE part", "UPDATE todo SET status = 'x'", "PRAGMA writable_schema = ON", "SELECT * FROM kv", "SELECT 1"]) {
    assert.throws(() => guardSql(sql), undefined, sql);
  }
});

test("the engine's credential shapes are the plugin's credential shapes", () => {
  assert.equal(new RegExp(SECRET_SHAPE_SOURCE, "iu").source, secretShape.source);
});

test("the engine measures terminal cells the way the TUI does", () => {
  for (const sample of ["plain", "한국어 보고서", "mixed 한글 and text", "漢字かな", "ok ✓ ▶ ○", "🔥 fire"]) assert.equal(cellWidth(sample), tuiCellWidth(sample), sample);
});

test("redact removes every planted credential class, the home path and secret-named environment values", () => {
  const envValue = "env-secret-value-98765";
  const before = process.env.LITOPENCODE_ADHD_TEST_TOKEN;
  process.env.LITOPENCODE_ADHD_TEST_TOKEN = envValue;
  try {
    for (const [name, value] of Object.entries(secrets)) assert.equal(redact(`note ${value} end`).includes(sensitive[name]), false, name);
    assert.doesNotMatch(redact(`value ${envValue} here`), /env-secret-value/u);
    assert.doesNotMatch(redact(`${os.homedir()}/project/file.ts`), new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.match(redact(`${os.homedir()}/project/file.ts`), /^~\/project\/file\.ts$/u);
    assert.equal(redact("plain words stay"), "plain words stay");
  } finally {
    if (before === undefined) delete process.env.LITOPENCODE_ADHD_TEST_TOKEN;
    else process.env.LITOPENCODE_ADHD_TEST_TOKEN = before;
  }
});

test("a gauge needs a real total; unknown totals become known facts and a pulse", () => {
  assert.equal(gauge(3, 10), "[▉▉▉░░░░░░░] 3/10");
  assert.equal(gauge(3, 10, { ascii: true }), "[###-------] 3/10");
  for (const [done, total] of [[3, 0], [0, 0], [undefined, 5], [3, undefined], [3, Number.NaN], [6, 5], [-1, 5], [1.5, 4]]) assert.equal(gauge(done, total), undefined, `${done}/${total}`);
  assert.equal(isRealCount(0, 4), true);
  assert.equal(factsLine({ steps: 12, elapsedMin: 4, lastAction: "Edit README.md" }), "12 steps · 4m · last: Edit README.md");
  assert.equal(factsLine({ steps: 1 }), "1 step");
  assert.equal(factsLine({}), "nothing recorded yet");
  assert.doesNotMatch(`${pulse()}${pulse(true)}`, /\?/u);
});

test("the engine reads a fixture store read-only and builds cards, statuses and a recommendation", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: fixtureSessions(dir) });
      const before = createHash("sha256").update(await fs.readFile(file)).digest("hex");
      const report = await collect({ root: dir, db: file, now: NOW, session: "ses_wait" });
      assert.equal(report.schema, "litopencode.rewind/v1");
      assert.equal(report.source.store, "sqlite");
      assert.equal(report.groups.length, 1);
      assert.equal(report.groups[0].branch, "feat/demo");
      const byId = Object.fromEntries(report.groups[0].sessions.map((card) => [card.id, card]));
      assert.equal(byId.ses_wait.status, "waits-on-you");
      assert.deepEqual(byId.ses_wait.counts, { done: 1, total: 3, source: "todo list" });
      assert.equal(byId.ses_wait.next, "run it against staging");
      assert.equal(byId.ses_work.status, "working");
      assert.equal(byId.ses_work.counts, undefined, "no real total exists");
      assert.equal(byId.ses_work.facts.steps, 1);
      assert.match(byId.ses_work.facts.lastAction, /Run npm test/u);
      assert.equal(byId.ses_idle.status, "idle");
      assert.match(byId.ses_idle.goal, /한국어 보고서 초안/u, "an untitled session takes its first prompt as the goal");
      assert.equal(report.recommended.kind, "answer");
      assert.match(report.headline, /3 sessions · 1 waiting on you/u);
      assert.equal(createHash("sha256").update(await fs.readFile(file)).digest("hex"), before, "the store is untouched");
      assert.doesNotMatch(JSON.stringify(report), /SENTINEL-NEVER-READ/u, "tables outside the allowlist are never read");
      assert.doesNotMatch(JSON.stringify(report), placeholder);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("planted credentials in titles, prompts, replies and tool paths never reach the JSON or the brief", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      const sessions = [
        { id: "ses_s1", directory: dir, title: `deploy with ${secrets.github}`, created: NOW - 10 * 60_000, updated: NOW - 5 * 60_000,
          messages: [{ role: "user", parts: [text(`use ${secrets.openai} please`, "user")] }, { role: "assistant", parts: [tool("edit", "completed", { filePath: `/a/${secrets.aws}/f.ts` }), text(`connect to ${secrets.uri} and ${secrets.named} then ${secrets.jwt}`)] }] }
      ];
      buildStore(file, { sessions });
      const report = await collect({ root: dir, db: file, now: NOW });
      const output = JSON.stringify(report) + renderBrief(report);
      for (const [name, value] of Object.entries(secrets)) {
        assert.equal(output.includes(value), false, `${name} leaked`);
        assert.equal(output.includes(sensitive[name]), false, `${name} secret part leaked`);
      }
      assert.match(output, /\[redacted\]/u);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("unknown totals render no placeholder in JSON or in the brief, and a real total renders a bar", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: fixtureSessions(dir).filter((session) => session.id !== "ses_wait") });
      const report = await collect({ root: dir, db: file, now: NOW });
      const brief = renderBrief(report);
      assert.doesNotMatch(brief, placeholder);
      assert.doesNotMatch(brief, /\?/u, "no question-mark glyph at all");
      assert.doesNotMatch(brief, /\[[▉░]+\]/u, "no bar exists without a total");
      assert.match(brief, /1 step · 30m · last: Run npm test/u);
      assert.match(brief, /░▒▓▒░/u, "a working session without a total shows the pulse");
      await fs.mkdir(path.join(dir, "plans"));
      await fs.writeFile(path.join(dir, "plans", "p.md"), "# Demo — Work Plan\n\n- [x] 1. one\n- [x] 2. two\n- [ ] 3. three — detail\n- [ ] 4. four\n");
      const planned = renderBrief(await collect({ root: dir, db: file, now: NOW }));
      assert.match(planned, /`\[▉▉▉▉▉░░░░░\] 2\/4` plan steps/u);
      assert.match(planned, /▶ \*\*now\*\* · 3\. three/u);
      assert.match(planned, /✓ \d\d-\d\d · feat: first milestone/u);
      assert.match(planned, /○ \*\*later\*\* · 4\. four/u);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("the brief keeps every line within 120 cells with Hangul goals, boxes one recommendation and ends on go", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: [{ id: "ses_ko", directory: dir, title: "한국어 보고서 초안을 정리하고 표와 그림을 다듬어서 최종본으로 만들기", created: NOW - 50 * 60_000, updated: NOW - 40 * 60_000,
        messages: [{ role: "user", parts: [text("정리", "user")] }, { role: "assistant", parts: [text("한국어 문장을 다듬는 중입니다. 표와 그림의 위치를 다시 맞추고 있습니다.")] }],
        todos: [{ content: "표 정리", status: "completed" }, { content: "그림 위치 맞추기 그리고 최종 검토", status: "pending" }] }] });
      const brief = renderBrief(await collect({ root: dir, db: file, now: NOW, session: "ses_ko" }));
      for (const line of brief.split("\n")) assert.ok(cellWidth(line) <= 120, `${cellWidth(line)} cells: ${line}`);
      assert.equal(brief.match(/Recommended next step/gu)?.length, 1);
      assert.match(brief, /```\n╭─ Recommended next step ─+╮\n/u);
      assert.doesNotMatch(brief, /```text/u, "the box fence carries no language tag");
      const box = brief.split("\n").filter((line) => /^[╭│╰]/u.test(line));
      assert.equal(new Set(box.map(cellWidth)).size, 1, "every box line closes at the same column");
      assert.match(brief, /\n.*(go|say what to do).*$/u);
      const plain = renderBrief(await collect({ root: dir, db: file, now: NOW }), { ascii: true });
      assert.match(plain, /\+- Recommended next step/u);
      assert.doesNotMatch(plain, /[🧭🌿⚪🟢🟠🔴✅⏳▶╭│╰]/u, "--ascii prints no emoji or box glyph");
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("--write-next records a step for the asking session only, and go can consume it", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: [] });
      await fs.mkdir(path.join(dir, "plans"));
      await fs.writeFile(path.join(dir, "plans", "p.md"), "# Demo\n\n- [ ] 1. one\n- [ ] 2. two\n");
      const run = (...extra) => JSON.parse(execFileSync(process.execPath, [engine, "--json", "--root", dir, "--db", file, "--now", new Date(NOW).toISOString(), ...extra], { encoding: "utf8" }));
      assert.equal(run().nextRecord, null, "nothing is written without --write-next");
      await assert.rejects(fs.stat(path.join(dir, ".litopencode", "adhd")));
      const report = run("--session", "ses_me", "--write-next");
      assert.deepEqual(report.nextRecord, { kind: "plan", target: "plans/p.md" });
      const record = await consumeNext(dir, "ses_me", NOW);
      assert.deepEqual([record?.kind, record?.target, record?.sessionID], ["plan", "plans/p.md", "ses_me"]);
      assert.equal(await consumeNext(dir, "ses_other", NOW), undefined);
      await fs.mkdir(path.dirname(nextFile(dir, "ses_me")), { recursive: true });
      const decoy = path.join(dir, "decoy.json");
      await fs.writeFile(decoy, "keep");
      await fs.symlink(decoy, nextFile(dir, "ses_me"));
      assert.equal(run("--session", "ses_me", "--write-next").nextRecord, null, "a link is never written through");
      assert.equal(await fs.readFile(decoy, "utf8"), "keep");
      assert.throws(() => execFileSync(process.execPath, [engine, "--session", "../x"], { stdio: "pipe" }));
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("a paused spine in this session is recommended as continue and its recorded count leads the chain", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: [{ id: "ses_p", directory: dir, title: "Loop the migration", created: NOW - 60 * 60_000, updated: NOW - 30 * 60_000, messages: [{ role: "user", parts: [text("loop", "user")] }] }] });
      await fs.mkdir(path.join(dir, ".litopencode", "workflow-stack"), { recursive: true });
      await fs.writeFile(path.join(dir, ".litopencode", "workflow-stack", "ses_p.json"), JSON.stringify({ schema: "litopencode.workflow-stack/v1", sessionID: "ses_p", updatedAt: NOW, frames: [
        { skill: "lit-loop", status: "paused", at: NOW, phase: "work", done: 2, total: 5 }, { skill: "lit-brainstorm", status: "active", at: NOW }] }));
      const report = await collect({ root: dir, db: file, now: NOW, session: "ses_p", writeNext: true });
      assert.equal(report.groups[0].sessions[0].status, "paused");
      assert.deepEqual(report.groups[0].sessions[0].counts, { done: 2, total: 5, source: "lit-loop stage" });
      assert.equal(report.recommended.kind, "continue");
      assert.equal(report.nextRecord?.kind, "continue");
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("the legacy JSON store is read when no database exists, and a missing store is said in words", async () => {
  await repo(async (dir) => {
    const storage = path.join(dir, "..", `storage-${path.basename(dir)}`);
    try {
      await fs.mkdir(path.join(storage, "session", "proj"), { recursive: true });
      await fs.mkdir(path.join(storage, "message", "ses_old"), { recursive: true });
      await fs.mkdir(path.join(storage, "part", "msg_old1"), { recursive: true });
      await fs.writeFile(path.join(storage, "session", "proj", "ses_old.json"), JSON.stringify({ id: "ses_old", directory: dir, title: "Old style session", time: { created: NOW - 60_000 * 120, updated: NOW - 60_000 * 100 } }));
      await fs.writeFile(path.join(storage, "message", "ses_old", "msg_old1.json"), JSON.stringify({ id: "msg_old1", role: "user", time: { created: 1 } }));
      await fs.writeFile(path.join(storage, "part", "msg_old1", "prt_1.json"), JSON.stringify({ type: "text", text: "do the thing" }));
      const report = await collect({ root: dir, db: path.join(dir, "absent.db"), storage, now: NOW });
      assert.equal(report.source.store, "legacy");
      assert.equal(report.groups[0].sessions[0].goal, "Old style session");
      const none = await collect({ root: dir, db: path.join(dir, "absent.db"), storage: path.join(dir, "no-storage"), now: NOW });
      assert.equal(none.source.store, "none");
      assert.match(none.source.note, /no session database was found/u);
      assert.match(renderBrief(none), /No earlier sessions found here/u);
    } finally {
      await fs.rm(storage, { recursive: true, force: true });
    }
  });
});

test("lit adhd and lit rewind route to lit-adhd; neighbouring words keep their routes", () => {
  for (const text of ["lit adhd", "lit rewind", "lit-adhd", "lit-rewind", "Lit ADHD please", "lit adhd, where was I?", "lit adhd 다시 이어서"]) {
    assert.equal(detectChatActivationMode(text), "lit-adhd", text);
  }
  for (const text of [
    "lit debug the adhd screening form",
    "lit fix the rewind button in the player",
    "how to rewind a git branch",
    "rewind the branch",
    "`lit adhd`",
    "/lit-adhd lit",
    "lit adhdx report",
    "lit plan plans/lit-adhd.md"
  ]) {
    assert.notEqual(detectChatActivationMode(text), "lit-adhd", text);
  }
  assert.equal(detectChatActivationMode("lit plan the rewind feature"), "lit-plan");
});

test("the chat route and both slash commands carry the skill pointer and this session's id", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-adhd-route-"));
  try {
    const output = { message: { id: "msg_1", sessionID: "ses_route1", role: "user" }, parts: [{ id: "prt_1", sessionID: "ses_route1", messageID: "msg_1", type: "text", text: "lit adhd" }] };
    await createChatMessageActivationHook(dir)({ sessionID: "ses_route1", messageID: "msg_1", agent: "lit-loop" }, output);
    const chat = output.parts.slice(1).map((part) => part.text).join("\n");
    assert.match(chat, /skill name: lit-adhd/u);
    assert.match(chat, /session id for --session: ses_route1/u);
    for (const command of ["/lit-adhd", "/lit-rewind"]) {
      const slash = { parts: [] };
      await createCommandActivationHook(dir)({ sessionID: "ses_slash1", command, arguments: "" }, slash);
      const activation = slash.parts.at(-1);
      assert.equal(activation.metadata.litopencode.mode, "lit-adhd", command);
      assert.match(activation.text, /skill name: lit-adhd/u);
      assert.match(activation.text, /session id for --session: ses_slash1/u);
    }
    assert.equal(findLitOpenCodeCommand("lit-adhd").agent, undefined, "the collector runs a command, so the planning-only agent is never used");
    await assert.rejects(fs.stat(path.join(dir, ".litopencode", "adhd")), "routing alone writes nothing");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("ended sessions fold into one table row each, at most eight, and every row stays on one 120-column line", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      const day = 24 * 60 * 60_000;
      const sessions = Array.from({ length: 11 }, (_, index) => ({
        id: `ses_ended${index}`, directory: dir, title: `${"한국어 제목이 아주 긴 세션 ".repeat(3)}${index}`, created: NOW - (index + 2) * day, updated: NOW - (index + 1) * day - 37 * 60_000,
        messages: [{ role: "user", parts: [text("go", "user")] }, { role: "assistant", parts: [tool("edit", "completed", { filePath: `/x/f${index}.ts` }), tool("edit", "completed", { filePath: "/x/g.ts" })] }]
      }));
      sessions.push({ id: "ses_live", directory: dir, title: "Live one", created: NOW - 10 * 60_000, updated: NOW - 20_000, messages: [{ role: "user", parts: [text("x", "user")] }, { role: "assistant", parts: [tool("bash", "running", { description: "Run the gates" })] }] });
      buildStore(file, { sessions });
      const brief = renderBrief(await collect({ root: dir, db: file, now: NOW, maxSessions: 30 }));
      assert.match(brief, /### ⚪ Ended · 11\n\n\| id \| where \| goal \| ago \| done \|/u);
      const rows = brief.split("\n").filter((line) => /^\| `/u.test(line));
      assert.equal(rows.length, 8, "eight rows, then a count of the rest");
      assert.match(brief, /…and 3 more ended/u);
      for (const row of rows) {
        assert.ok(cellWidth(row) <= 120, `${cellWidth(row)} cells: ${row}`);
        assert.match(row, /\| \d+[mhd] \| 2 files \|$/u, "the age is its largest unit, done is a file count");
      }
      assert.equal((brief.match(/^> 🟢/gmu) ?? []).length, 1, "only the live session gets a card");
      assert.match(brief, /▶ Next: now: Run the gates/u, "a working card names what it is doing now");
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("the box always names a real step from the records when nothing can run on go", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: [{ id: "ses_old", directory: dir, title: "Tidy the parser", created: NOW - 3 * 60 * 60_000, updated: NOW - 2 * 60 * 60_000,
        messages: [{ role: "user", parts: [text("tidy", "user")] }, { role: "assistant", parts: [tool("read", "completed", { filePath: "/x/parser.ts" }), tool("grep", "completed", { pattern: "TODO" }), tool("read", "completed", { filePath: "/x/lexer.ts" })] }] }] });
      const report = await collect({ root: dir, db: file, now: NOW });
      assert.notEqual(report.recommended.kind, "none");
      assert.match(report.recommended.text, /Pick up "Tidy the parser" in /u);
      const brief = renderBrief(report);
      assert.doesNotMatch(brief, /No next step|Nothing is waiting/u);
      assert.match(brief, /Nothing runs on its own here/u);
      const card = (await collect({ root: dir, db: file, now: NOW })).groups[0].sessions[0];
      assert.deepEqual(card.tools, ["Read", "Search"], "tools used most, named not counted");
      buildStore(file, { sessions: [] });
      assert.match((await collect({ root: dir, db: file, now: NOW })).recommended.text, /say what to start/u);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("unfilled plan scaffolds never reach the roadmap or the recommendation", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: [] });
      await fs.mkdir(path.join(dir, "plans"));
      await fs.writeFile(path.join(dir, "plans", "template.md"), "# T\n\n- [ ] N. <title>\n- [ ] N. <title>\n");
      await fs.writeFile(path.join(dir, "plans", "same.md"), "# S\n\n- [ ] todo\n- [ ] todo\n");
      const report = await collect({ root: dir, db: file, now: NOW });
      assert.equal(report.groups.length, 0, "a worktree holding only scaffolds has nothing to show");
      assert.doesNotMatch(renderBrief(report), /<title>|‹title›/u);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("when the next step belongs to another session, go still answers and points there", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: fixtureSessions(dir) });
      const report = await collect({ root: dir, db: file, now: NOW, session: "ses_me", writeNext: true });
      assert.notEqual(report.recommended.sessionID, "ses_me");
      assert.equal(report.nextRecord?.kind, "elsewhere");
      assert.match(renderBrief(report), /go/u);
      const { routeGo } = await import("../src/adhd-next.ts");
      const reply = await routeGo({ projectRoot: dir, sessionID: "ses_me", text: "go", now: NOW });
      assert.equal(reply?.kind, "elsewhere");
      assert.ok(reply.text.includes(report.recommended.text), reply?.text);
      assert.match(reply.text, /do not start/u);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

// A worktree shaped like a finished port round: one plan fully ticked by a completed start-work run, one
// stale open plan from last month, a session that finished that run, one that went idle a moment ago and
// one whose session ended.
async function roundThree(dir) {
  const min = 60_000;
  await fs.mkdir(path.join(dir, "plans"));
  await fs.writeFile(path.join(dir, "plans", "port.md"), "# Port — Work Plan\n\n- [x] 1. pin the base\n- [x] 2. port the feature\n- [x] 3. docs and gates\n");
  await fs.writeFile(path.join(dir, "plans", "stale.md"), "# Stale\n\n- [ ] 1. an old idea\n- [ ] 2. never started\n");
  const old = new Date(NOW - 30 * 24 * 60 * min);
  await fs.utimes(path.join(dir, "plans", "stale.md"), old, old);
  const loop = path.join(dir, ".litopencode", "litgoal", "lit-loop");
  await fs.mkdir(loop, { recursive: true });
  await fs.writeFile(path.join(loop, "work-schema-3.json"), JSON.stringify({ schemaVersion: 3, sessionID: "ses_run", status: "completed", plan: { path: path.join(dir, "plans", "port.md") }, updatedAt: new Date(NOW - 10 * min).toISOString() }));
  const live = path.join(dir, ".litopencode", "liveness");
  await fs.mkdir(live);
  const mark = (id, state, at) => fs.writeFile(path.join(live, `${id}.json`), JSON.stringify({ version: 1, sessionId: id, state, at: new Date(at).toISOString(), herdrPane: null }));
  await mark("ses_quiet", "idle", NOW - 30_000);
  await mark("ses_gone", "ended", NOW - 4 * min);
  await mark("ses_me", "idle", NOW - 10_000);
  return [
    { id: "ses_run", directory: dir, title: "Run the port plan", created: NOW - 90 * min, updated: NOW - 10 * min - 2000,
      messages: [{ role: "user", parts: [text("start-work", "user")] }, { role: "assistant", parts: [tool("edit", "completed", { filePath: "/x/src/port.ts" })] }],
      todos: [{ content: "port the feature", status: "completed" }, { content: "docs and gates", status: "pending" }] },
    { id: "ses_quiet", directory: dir, title: "Answer a question about the card", created: NOW - 20 * min, updated: NOW - 60_000,
      messages: [{ role: "user", parts: [text("why", "user")] }, { role: "assistant", parts: [tool("read", "completed", { filePath: "/x/src/card.ts" })] }] },
    { id: "ses_gone", directory: dir, title: "Closed exploration", created: NOW - 40 * min, updated: NOW - 5 * min,
      messages: [{ role: "user", parts: [text("look", "user")] }, { role: "assistant", parts: [tool("grep", "completed", { pattern: "x" })] }] },
    { id: "ses_me", directory: dir, title: "Ask for the brief", created: NOW - 2 * min, updated: NOW - 20_000,
      messages: [{ role: "user", parts: [text("lit adhd", "user")] }, { role: "assistant", parts: [tool("bash", "running", { description: "Collect the brief" })] }] }
  ];
}

test("round three: a completed run and a fully ticked plan read done, liveness settles idle, and nothing repeats a done step", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: await roundThree(dir) });
      const report = await collect({ root: dir, db: file, now: NOW, session: "ses_me" });
      const group = report.groups[0];
      const byId = Object.fromEntries(group.sessions.map((card) => [card.id, card]));
      assert.equal(byId.ses_run.status, "done", "the session that completed the run");
      assert.equal(byId.ses_run.next, null, "a done session repeats no step");
      assert.equal(byId.ses_quiet.status, "idle", "an idle record newer than its last move beats the two-minute guess");
      assert.equal(byId.ses_gone.status, "idle", "an ended session is not running");
      assert.equal(byId.ses_me.status, "working", "the session running the brief is working whatever it last wrote");
      assert.deepEqual(group.plans.map((plan) => [plan.path, plan.complete]), [["plans/port.md", true]], "the finished plan is kept; the stale one is held to the window");
      assert.equal(report.recommended.kind === "plan", false, "a stale open plan is never recommended");
      assert.doesNotMatch(renderBrief(report, { sessionID: "ses_me" }), /an old idea/u);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("round three: the brief opens with done so far, doing now and next", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: await roundThree(dir) });
      const brief = renderBrief(await collect({ root: dir, db: file, now: NOW, session: "ses_me" }), { sessionID: "ses_me" });
      const [done, doing, next, blank] = brief.split("\n");
      assert.match(done, /^\*\*Done so far:\*\* feat: first milestone; `plans\/port\.md` \(start-work complete\) {2}$/u);
      assert.match(doing, /^\*\*Doing now:\*\* Ask for the brief {2}$/u);
      assert.match(next, /^\*\*Next:\*\* \S/u);
      assert.equal(blank, "");
      for (const line of [done, doing, next]) assert.ok(cellWidth(line) <= 120, line);
      const ascii = renderBrief(await collect({ root: dir, db: file, now: NOW }), { ascii: true });
      assert.match(ascii.split("\n")[1], /^\*\*Doing now:\*\* nothing running {2}$/u);
      const loop = path.join(dir, ".litopencode", "litgoal", "lit-loop", "work-schema-3.json");
      await fs.writeFile(loop, JSON.stringify({ schemaVersion: 3, sessionID: "ses_run", status: "active", plan: { path: path.join(dir, "plans", "port.md") }, updatedAt: new Date(NOW).toISOString() }));
      assert.match(renderBrief(await collect({ root: dir, db: file, now: NOW })).split("\n")[1], /^\*\*Doing now:\*\* start-work · plans\/port\.md {2}$/u);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("the opener names an open plan's step with go, and a finished plan with no run counts by its gauge", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: [] });
      await fs.mkdir(path.join(dir, "plans"));
      await fs.writeFile(path.join(dir, "plans", "a-done.md"), "# A\n\n- [x] 1. one\n- [x] 2. two\n");
      await fs.writeFile(path.join(dir, "plans", "b-open.md"), "# B\n\n- [x] 1. one\n- [ ] 2. two\n");
      const brief = renderBrief(await collect({ root: dir, db: file, now: NOW, session: "ses_me", writeNext: true }), { sessionID: "ses_me" });
      assert.match(brief.split("\n")[0], /`plans\/a-done\.md` `\[▉▉▉▉▉▉▉▉▉▉\] 2\/2`/u);
      assert.match(brief.split("\n")[2], /^\*\*Next:\*\* Start work on plans\/b-open\.md: 1 step left\. \(type `go`\)$/u);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("with no step for go, this worktree's HANDOFF.md Next item is the recommendation", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: [] });
      await fs.writeFile(path.join(dir, "HANDOFF.md"), "# Handoff\n\n## Done\n\n- the parser\n\n## Next Steps\n\n1. Wire the exporter to the CLI\n2. Later work\n");
      const report = await collect({ root: dir, db: file, now: NOW, session: "ses_me", writeNext: true });
      assert.equal(report.recommended.kind, "handoff");
      assert.match(report.recommended.text, /Wire the exporter to the CLI/u);
      assert.equal(report.nextRecord, null, "a handoff item does not run on go");
      assert.match(renderBrief(report), /Nothing runs on its own here/u);
      await fs.writeFile(path.join(dir, "HANDOFF.md"), "# Handoff\n\n## Next\n\n## Notes\n\n- not a step\n");
      assert.match((await collect({ root: dir, db: file, now: NOW })).recommended.text, /say what to start/u, "an empty Next section gives no step");
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

test("plans are read before sessions, and plans the read budget skipped are counted and reported", async () => {
  await repo(async (dir) => {
    const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
    try {
      buildStore(file, { sessions: [] });
      await fs.mkdir(path.join(dir, "plans"));
      const body = (name) => `# ${name}\n\n- [ ] 1. ${name} step ${"x".repeat(400)}\n`;
      for (const name of ["a", "b", "c"]) await fs.writeFile(path.join(dir, "plans", `${name}.md`), body(name));
      const report = await collect({ root: dir, db: file, now: NOW, budgetBytes: 1000 });
      assert.equal(report.plansSkipped, 1);
      assert.match(renderBrief(report), /1 plan was not read \(read budget used up\)/u);
      assert.equal((await collect({ root: dir, db: file, now: NOW })).plansSkipped, 0);
      assert.doesNotMatch(renderBrief(await collect({ root: dir, db: file, now: NOW })), /not read \(read budget/u);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});
