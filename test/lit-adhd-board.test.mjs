import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildStore } from "../test-support/rewind-store.mjs";
import { cellWidth, collect, kpiBar, renderBoard, renderBrief } from "../skills/lit-adhd/scripts/rewind.mjs";

// The KPI board is the default brief: do this now, at a glance, milestones, done lately, still to do, don't forget.
delete process.env.HERDR_ENV;

const engine = fileURLToPath(new URL("../skills/lit-adhd/scripts/rewind.mjs", import.meta.url));
const NOW = Date.parse("2026-11-10T12:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const text = (value, role = "assistant") => ({ type: "text", text: value, role });
const tool = (name, status, input = {}) => ({ type: "tool", tool: name, state: { status, input } });

async function repo(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-board-")));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  const file = path.join(dir, "..", `store-${path.basename(dir)}.db`);
  try {
    git("init", "-q", "-b", "feat/board");
    git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "--allow-empty", "-m", "feat: first milestone");
    await run(dir, file, git);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(file, { force: true });
  }
}

// Two plans in the window (one fully ticked, one half done), one stale open plan, one session waiting on the
// user, one plain idle session and the asking session; the plans folder is untracked, so the worktree is dirty.
async function fixture(dir, file) {
  await fs.mkdir(path.join(dir, "plans"));
  await fs.writeFile(path.join(dir, "plans", "a-shipped.md"), "# Ship the exporter — Work Plan\n\n- [x] 1. pin the base\n- [x] 2. port the exporter\n- [x] 3. docs and gates\n");
  await fs.writeFile(path.join(dir, "plans", "b-half.md"), "# Billing migration — Work Plan\n\n- [x] 1. write the migration\n- [x] 2. dry run\n- [ ] 3. run it against staging — detail\n- [ ] 4. verify the totals\n");
  await fs.writeFile(path.join(dir, "plans", "c-stale.md"), "# Old dashboard idea\n\n- [ ] 1. sketch\n- [ ] 2. build\n");
  const old = new Date(NOW - 30 * DAY);
  await fs.utimes(path.join(dir, "plans", "c-stale.md"), old, old);
  const fresh = new Date(NOW - 10 * MIN);
  await fs.utimes(path.join(dir, "plans", "b-half.md"), fresh, fresh);
  buildStore(file, { sessions: [
    { id: "ses_wait0123456789abcdef", directory: dir, title: "Migrate the billing tables", created: NOW - 90 * MIN, updated: NOW - 20 * MIN,
      messages: [{ role: "user", parts: [text("migrate", "user")] }, { role: "assistant", parts: [tool("question", "running", { question: "which schema" })] }] },
    { id: "ses_idle", directory: dir, title: "Tidy the parser", created: NOW - 3 * 60 * MIN, updated: NOW - 2 * 60 * MIN,
      messages: [{ role: "user", parts: [text("tidy", "user")] }, { role: "assistant", parts: [tool("read", "completed", { filePath: "/x/parser.ts" })] }] },
    { id: "ses_me", directory: dir, title: "Ask for the brief", created: NOW - 2 * MIN, updated: NOW - 20_000,
      messages: [{ role: "user", parts: [text("lit adhd", "user")] }] },
  ] });
}

const sections = (board) => board.split("\n").filter((line) => line.startsWith("## "));

test("kpiBar draws ten cells of full and light blocks with k/n and a percentage, or nothing without a real total", () => {
  assert.equal(kpiBar(3, 10), "███░░░░░░░ 3/10 (30%)");
  assert.equal(kpiBar(11, 11), "██████████ 11/11 (100%)");
  assert.equal(kpiBar(0, 4), "░░░░░░░░░░ 0/4 (0%)");
  assert.equal(kpiBar(12, 24), "█████░░░░░ 12/24 (50%)");
  assert.equal(kpiBar(3, 10, { ascii: true }), "###------- 3/10 (30%)");
  for (const [done, total] of [[1, 0], [undefined, 3], [4, 3], [1.5, 3]]) assert.equal(kpiBar(done, total), undefined);
});

test("the board keeps its six sections in order, in English and in Korean", async () => {
  await repo(async (dir, file) => {
    await fixture(dir, file);
    const report = await collect({ root: dir, db: file, now: NOW, session: "ses_me" });
    assert.deepEqual(sections(renderBoard(report)), ["## 🎯 Do this now", "## 📊 At a glance", "## 🏁 Milestones", "## ✅ Done lately", "## ⬜ Still to do", "## 🔔 Don't forget"]);
    assert.deepEqual(sections(renderBoard(report, { lang: "ko" })), ["## 🎯 지금 할 일", "## 📊 한눈에 보기", "## 🏁 마일스톤", "## ✅ 최근 끝낸 일", "## ⬜ 남은 일", "## 🔔 잊지 말 것"]);
  });
});

test("bucket counts, the overall bar and the milestone rows come from the records", async () => {
  await repo(async (dir, file) => {
    await fixture(dir, file);
    const report = await collect({ root: dir, db: file, now: NOW, session: "ses_me" });
    // Rows: 3 + 2 ticked = 5 done; the half plan's current row is in progress, its last row is left; the
    // waiting question adds one item that waits on the user. The stale plan is not counted.
    assert.deepEqual(report.board.tiles, { done: 5, active: 1, waiting: 1, left: 1 });
    assert.deepEqual(report.board.overall, { done: 5, total: 8 });
    const board = renderBoard(report);
    assert.match(board, /\| ✅ Done \| 🔄 In progress \| ⏳ Waiting on you \| ⬜ Left \|\n\|:--:\|:--:\|:--:\|:--:\|\n\| 5 \| 1 \| 1 \| 1 \|/u);
    assert.match(board, /^Overall {2}██████░░░░ 5\/8 \(63%\)$/mu);
    assert.match(board, /^\| Billing migration \| 🔄 In progress \| █████░░░░░ 2\/4 \(50%\) \| 10m ago \|$/mu);
    assert.match(board, /^\| Ship the exporter \| ✅ Done \| ██████████ 3\/3 \(100%\) \| [^|]+ \|$/mu);
    assert.doesNotMatch(board, /Old dashboard idea \| /u, "a stale plan is a reminder, never a milestone row");
    const ko = renderBoard(report, { lang: "ko" });
    assert.match(ko, /\| ✅ 끝남 \| 🔄 진행 중 \| ⏳ 나를 기다림 \| ⬜ 남음 \|/u);
    assert.match(ko, /^전체 진행 {2}██████░░░░ 5\/8 \(63%\)$/mu);
    assert.match(ko, /^\| Billing migration \| 🔄 진행 중 \| █████░░░░░ 2\/4 \(50%\) \| 10분 전 \|$/mu);
  });
});

test("do this now names one plain action, one reason and the exact text to type", async () => {
  await repo(async (dir, file) => {
    await fixture(dir, file);
    const board = renderBoard(await collect({ root: dir, db: file, now: NOW, session: "ses_me" }));
    const now = board.split("\n").slice(0, 4);
    assert.equal(now[0], "## 🎯 Do this now");
    assert.match(now[1], /^\*\*Answer the question in "Migrate the billing tables"\*\* — /u);
    assert.match(now[2], /^👉 Type: open that session and reply there$/u);
    // With only the half plan open and nothing waiting, the step is the plan, armed for go here.
    buildStore(file, { sessions: [] });
    const armed = await collect({ root: dir, db: file, now: NOW, session: "ses_me", writeNext: true });
    assert.equal(armed.nextRecord?.kind, "plan");
    const plan = renderBoard(armed, { lang: "ko" }).split("\n");
    assert.match(plan[1], /^\*\*Billing migration 계획 시작하기\*\* — 남은 단계 2개$/u);
    assert.equal(plan[2], "👉 입력: `go`");
  });
});

test("done lately holds at most five, newest first; still to do holds seven in plan order with the rest counted", async () => {
  await repo(async (dir, file) => {
    buildStore(file, { sessions: [] });
    await fs.mkdir(path.join(dir, "plans"));
    const rows = (ticked, open) => [...Array.from({ length: ticked }, (_, i) => `- [x] ${i + 1}. done step ${i + 1}`), ...Array.from({ length: open }, (_, i) => `- [ ] ${ticked + i + 1}. open step ${ticked + i + 1}`)].join("\n");
    await fs.writeFile(path.join(dir, "plans", "big.md"), `# Big plan\n\n${rows(8, 10)}\n`);
    const report = await collect({ root: dir, db: file, now: NOW });
    assert.equal(report.board.doneLately.length, 5);
    assert.equal(report.board.doneMore, 3);
    assert.equal(report.board.remaining.length, 7);
    assert.equal(report.board.remainingMore, 3);
    const board = renderBoard(report);
    assert.match(board, /## ✅ Done lately\n- done step 8\n- done step 7\n/u, "newest first, numbering dropped");
    assert.match(board, /## ⬜ Still to do\n1\. open step 9\n2\. open step 10\n/u);
    assert.match(board, /^7\. open step 15\n…and 3 more$/mu);
    assert.match(renderBoard(report, { lang: "ko" }), /^…외 3개$/mu);
  });
});

test("reminders are action-shaped, most urgent first, and capped at five", async () => {
  await repo(async (dir, file) => {
    await fixture(dir, file);
    await fs.writeFile(path.join(dir, "HANDOFF.md"), "# H\n\n## Next\n\n1. Wire the exporter to the CLI\n");
    const report = await collect({ root: dir, db: file, now: NOW, session: "ses_me" });
    const kinds = report.board.reminders.map((entry) => entry.kind);
    assert.deepEqual(kinds, ["waiting", "uncommitted", "stale", "handoff"]);
    const board = renderBoard(report);
    const lines = board.slice(board.indexOf("## 🔔 Don't forget")).split("\n").slice(1).filter(Boolean);
    assert.ok(lines.length <= 5);
    for (const line of lines) assert.match(line, /^- \S+ .+ → .+$/u, line);
    assert.match(lines[0], /^- ⏳ "Migrate the billing tables" asks you a question → open that session and answer it$/u);
    assert.match(lines[1], /^- 💾 \d+ uncommitted changes? \(litopencode-board-\w+\) → review them, then commit or discard$/u);
    assert.match(lines[2], /^- 🕰️ Plan untouched for 30 days: Old dashboard idea → decide whether to resume or drop it$/u);
    assert.match(lines[3], /^- 📌 HANDOFF\.md next: Wire the exporter to the CLI → start it when you are ready$/u);
    const ko = renderBoard(report, { lang: "ko" });
    assert.match(ko, /^- 💾 커밋 안 된 변경 \d+개 \(litopencode-board-\w+\) → 확인하고 커밋하거나 되돌리기$/mu);
    assert.match(ko, /^- 🕰️ 30일째 멈춘 계획: Old dashboard idea → 이어 할지, 접을지 정하기$/mu);
    // Many waiting sessions still yield five reminders at most.
    buildStore(file, { sessions: Array.from({ length: 7 }, (_, i) => ({ id: `ses_q${i}`, directory: dir, title: `Question ${i}`, created: NOW - 60 * MIN, updated: NOW - 30 * MIN,
      messages: [{ role: "assistant", parts: [tool("question", "running", { question: "x" })] }] })) });
    assert.equal((await collect({ root: dir, db: file, now: NOW })).board.reminders.length, 5);
  });
});

test("the board shows no session id, commit hash, raw status code or internal path", async () => {
  await repo(async (dir, file, git) => {
    await fixture(dir, file);
    const live = path.join(dir, ".litopencode", "liveness");
    await fs.mkdir(live, { recursive: true });
    await fs.writeFile(path.join(live, "ses_idle.json"), JSON.stringify({ version: 1, sessionId: "ses_idle", state: "ended", at: new Date(NOW - 2 * 60 * MIN).toISOString(), herdrPane: null }));
    const hash = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    for (const lang of ["en", "ko"]) {
      const board = renderBoard(await collect({ root: dir, db: file, now: NOW, session: "ses_me" }), { lang });
      assert.doesNotMatch(board, /ses_|wait0123|\bwaiting-on-user\b|\bwaits-on-you\b|\bidle\b|\bended\b|plans\/|\.litopencode/u, board);
      assert.equal(board.includes(hash.slice(0, 7)), false, "no commit hash");
      assert.equal(board.includes(dir), false, "no absolute path");
    }
    void git;
  });
});

test("empty sections print one plain line, and an empty window still has a step", async () => {
  await repo(async (dir, file) => {
    buildStore(file, { sessions: [] });
    const report = await collect({ root: dir, db: file, now: NOW });
    const board = renderBoard(report);
    for (const line of ["No open plan or goal", "Nothing finished lately", "Nothing left", "Nothing to remember"]) assert.match(board, new RegExp(`^${line}$`, "mu"), line);
    assert.match(board, /^\| 0 \| 0 \| 0 \| 0 \|$/mu);
    assert.match(board, /^Overall {2}no checklist on record yet$/mu);
    const ko = renderBoard(report, { lang: "ko" });
    for (const line of ["열린 계획이나 목표가 없어요", "최근 끝낸 일이 없어요", "남은 일이 없어요", "잊지 말 것이 없어요"]) assert.match(ko, new RegExp(`^${line}$`, "mu"), line);
    assert.match(board.split("\n")[1], /^\*\*Say what to start\*\* — /u);
  });
});

test("the board stays at about forty lines (42 at most) and 120 cells, even when every list overflows", async () => {
  await repo(async (dir, file) => {
    await fs.mkdir(path.join(dir, "plans"));
    for (let p = 0; p < 7; p += 1) {
      await fs.writeFile(path.join(dir, "plans", `p${p}.md`), `# 한국어로 된 아주 긴 계획 이름 ${p} ${"그리고 더 긴 설명 ".repeat(4)}\n\n- [x] 1. ${"끝난 단계 ".repeat(12)}\n- [ ] 2. ${"남은 단계 ".repeat(12)}\n- [ ] 3. three\n`);
    }
    buildStore(file, { sessions: Array.from({ length: 6 }, (_, i) => ({ id: `ses_q${i}`, directory: dir, title: `질문 ${i} ${"긴 제목 ".repeat(10)}`, created: NOW - 60 * MIN, updated: NOW - 30 * MIN,
      messages: [{ role: "assistant", parts: [tool("question", "running", { question: "x" })] }] })) });
    for (const lang of ["en", "ko"]) {
      const board = renderBoard(await collect({ root: dir, db: file, now: NOW }), { lang });
      const lines = board.split("\n");
      assert.ok(lines.length <= 42, `${lines.length} lines`);
      assert.match(board, /^\| …and \d+ more \| \| \| \|$|^\| …외 \d+개 \| \| \| \|$/mu, "milestones past four fold into one row");
      for (const line of lines) assert.ok(cellWidth(line) <= 120, `${cellWidth(line)} cells: ${line}`);
    }
  });
});

test("the per-session detail appears only on request, under the board", async () => {
  await repo(async (dir, file) => {
    await fixture(dir, file);
    const report = await collect({ root: dir, db: file, now: NOW, session: "ses_me" });
    const plain = renderBrief(report, { sessionID: "ses_me" });
    assert.equal(plain, renderBoard(report, { sessionID: "ses_me" }), "the default brief is the board");
    assert.doesNotMatch(plain, /Recommended next step|### 🌿|WAITS ON YOU/u);
    const detail = renderBrief(report, { sessionID: "ses_me", detail: true });
    assert.ok(detail.startsWith(plain), "the board comes first");
    assert.match(detail.slice(plain.length), /## 🔎 Session detail[\s\S]*WAITS ON YOU[\s\S]*Recommended next step/u);
    const cli = (...extra) => execFileSync(process.execPath, [engine, "--brief", "--root", dir, "--db", file, "--now", new Date(NOW).toISOString(), "--session", "ses_me", ...extra], { encoding: "utf8" });
    assert.doesNotMatch(cli(), /Session detail/u);
    assert.match(cli("--detail"), /## 🔎 Session detail/u);
    assert.match(cli("--lang", "ko"), /^## 🎯 지금 할 일$/mu);
    assert.match(cli("--lang", "ko", "--detail"), /## 🔎 세션 자세히/u);
    assert.throws(() => execFileSync(process.execPath, [engine, "--lang", "fr"], { stdio: "pipe" }));
    const json = JSON.parse(execFileSync(process.execPath, [engine, "--json", "--root", dir, "--db", file, "--now", new Date(NOW).toISOString(), "--lang", "ko"], { encoding: "utf8" }));
    assert.match(json.boardText, /^## 🎯 지금 할 일/u);
    assert.deepEqual(Object.keys(json.board).sort(), ["doneLately", "doneMore", "milestones", "now", "overall", "remaining", "remainingMore", "reminders", "tiles"]);
  });
});

test("go stays the word only when a step is armed here; lanes say to wait; ascii keeps plain glyphs", async () => {
  await repo(async (dir, file) => {
    await fs.mkdir(path.join(dir, "plans"));
    await fs.writeFile(path.join(dir, "plans", "p.md"), "# Demo\n\n- [x] 1. one\n- [ ] 2. two\n");
    buildStore(file, { sessions: [{ id: "ses_lane", directory: dir, title: "Port the exporter", created: NOW - 30 * MIN, updated: NOW - 30_000,
      messages: [{ role: "assistant", parts: [tool("bash", "running", { description: "Run the gates" })] }] }] });
    const held = await collect({ root: dir, db: file, now: NOW, session: "ses_me", writeNext: true });
    assert.equal(held.recommended.kind, "lanes");
    const board = renderBoard(held, { sessionID: "ses_me" });
    assert.doesNotMatch(board, /👉 Type: `go`/u);
    assert.match(board, /^👉 Wait: until "Port the exporter" finishes$/mu);
    assert.match(board, /^- 🏃 1 lane still working → don't type `go` until it finishes$/mu);
    assert.match(renderBoard(held, { lang: "ko" }), /^👉 기다리기: "Port the exporter" 끝날 때까지$/mu);
    assert.match(renderBoard(held, { lang: "ko" }), /^- 🏃 아직 일하는 레인 1개 → 끝날 때까지 `go` 치지 않기$/mu);
    const ascii = renderBoard(held, { ascii: true });
    assert.doesNotMatch(ascii, /[🎯📊🏁✅⬜🔔🔄⏳👉🏃💾🕰️📌█░]/u, "--ascii prints no emoji or block glyph");
    assert.match(ascii, /^## Do this now$/mu);
    assert.match(ascii, /#####-----/u);
  });
});
