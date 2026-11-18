import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { VERDICT_RULES_VERSION, coverageOf, decideVerdict, nextCursor, provenDone, renderVerdict } from "../skills/lit-adhd/scripts/verdict.mjs";

const engine = path.resolve("skills/lit-adhd/scripts/rewind.mjs");
const card = (id, status, goal, extra = {}) => ({ id, status, goal, facts: {}, ...extra });
const report = ({ sessions = [], recommended = { kind: "none" }, reminders = [], finished = {}, store = "sqlite", plansSkipped = 0, nextRecord = null, herdr } = {}) => ({
  source: { store, ...(herdr ? { herdr } : {}) },
  plansSkipped,
  groups: [{ worktree: "app", current: true, sessions, finished: { commits: [], runs: [], plans: [], ...finished } }],
  recommended,
  nextRecord,
  board: { reminders, milestones: [] }
});

// Hand-labelled snapshots: what a person reading the records would say the one thing to do is.
const scenarios = [
  ["own parked boundary", report({ sessions: [card("ses_me", "waits-on-you", "ship the parser", { boundary: "bash rm" })], recommended: { kind: "answer", sessionID: "ses_me", say: { own: true, boundary: "bash rm", goal: "ship the parser" } } }), "approve-own-boundary", "lit approve"],
  ["another session asks a question", report({ sessions: [card("ses_me", "working", "now"), card("ses_b", "waits-on-you", "name the CLI")], recommended: { kind: "answer", sessionID: "ses_b", say: { own: false, goal: "name the CLI" } } }), "answer-session", null],
  ["a blocked session", report({ sessions: [card("ses_c", "blocked", "fix CI")], recommended: { kind: "session", sessionID: "ses_c", say: { reason: "blocked", goal: "fix CI" } } }), "blocked-session", null],
  ["own paused discipline with go armed", report({ sessions: [card("ses_me", "paused", "migrate db")], recommended: { kind: "continue", sessionID: "ses_me", say: { goal: "migrate db" } }, nextRecord: { kind: "continue" } }), "resume-own", "go"],
  ["lanes at work", report({ sessions: [card("ses_d", "working", "lane one"), card("ses_e", "working", "lane two")], recommended: { kind: "lanes", lanes: 2, sessionID: "ses_d", say: { lanes: 2 } } }), "wait-lanes", null],
  ["own run active", report({ recommended: { kind: "work", sessionID: "ses_me", say: {} }, nextRecord: { kind: "work" } }), "continue-own-run", "go"],
  ["another session's run", report({ recommended: { kind: "session", sessionID: "ses_f", say: { reason: "run-elsewhere", plan: "Parser plan" } } }), "follow-other-run", null],
  ["single open plan", report({ recommended: { kind: "plan", sessionID: "ses_me", target: "plans/p.md", say: { plan: "Parser plan", left: 3 } }, nextRecord: { kind: "plan" } }), "start-single-plan", "go"],
  ["uncommitted changes, nothing else", report({ recommended: { kind: "none" }, reminders: [{ kind: "uncommitted", count: 4, worktree: "app" }] }), "uncommitted-work", "git status"],
  ["handoff next item", report({ recommended: { kind: "handoff", sessionID: "ses_me", say: { item: "write the release notes" } } }), "handoff-next", null],
  ["an unfinished session", report({ sessions: [card("ses_g", "idle", "draft docs", { next: "add examples" })], recommended: { kind: "session", sessionID: "ses_g", say: { reason: "unfinished", goal: "draft docs" } } }), "pick-up-session", null],
  ["everything read and nothing to do", report({ recommended: { kind: "none" } }), null, null]
];

test("the rule ladder matches the hand-labelled snapshots (at least 8 of 10)", () => {
  let matched = 0;
  for (const [name, snapshot, rule, type] of scenarios) {
    const verdict = decideVerdict(snapshot);
    if (verdict.rule === rule && (verdict.action?.type ?? null) === type) matched += 1;
    else assert.fail(`${name}: got ${verdict.rule} / ${verdict.action?.type}`);
  }
  assert.ok(matched >= Math.ceil(scenarios.length * 0.8), `${matched}/${scenarios.length}`);
  assert.equal(VERDICT_RULES_VERSION, "litopencode.adhd-verdict/v1");
});

test("the Korean card is about six lines in the fixed order and carries a fingerprint", () => {
  const snapshot = report({ sessions: [card("ses_b", "waits-on-you", "name the CLI")], recommended: { kind: "plan", sessionID: "ses_me", target: "plans/p.md", say: { plan: "Parser plan", left: 3 } }, nextRecord: { kind: "plan" }, reminders: [{ kind: "unpushed", count: 2, worktree: "app" }, { kind: "stale", days: 9, title: "Old idea" }] });
  const { text } = renderVerdict(snapshot, { lang: "ko", cursor: { at: new Date(2026, 10, 18, 18, 2).toISOString(), seen: [] } });
  const lines = text.split("\n");
  assert.ok(lines.length >= 5 && lines.length <= 6, text);
  assert.match(lines[0], /^18:02 이후: 0개 끝남, 1개가 너를 기다림$/u);
  assert.match(lines[1], /^지금 할 일: "Parser plan" 계획 실행 시작 #[0-9a-f]{6}$/u);
  assert.equal(lines[2], "입력: `go`");
  assert.match(lines[3], /^이유: .+ · 안 하면: .+$/u);
  assert.match(lines[4], /^다음 대기: "name the CLI" 세션이 답을 기다림 · 네 확인 필요: app의 커밋 2개를 push 할까\? \(\+1\)$/u);
  assert.equal(lines[5], "읽음 1/1 세션");
  assert.match(renderVerdict(snapshot, { lang: "en" }).text, /^First look — no baseline yet\nDo now: start work on "Parser plan" #[0-9a-f]{6}\nType: `go`/u);
});

test("a push is only ever a question, never the action (canary)", () => {
  for (const [, snapshot] of scenarios) {
    const action = decideVerdict({ ...snapshot, board: { ...snapshot.board, reminders: [...snapshot.board.reminders, { kind: "unpushed", count: 3, worktree: "app" }] } }).action;
    assert.doesNotMatch(`${action?.kind ?? ""} ${action?.type ?? ""}`, /push|publish|release|tag/iu);
  }
});

test("only proven items count as finished; a session that says done does not", () => {
  const claimed = report({ sessions: [card("ses_x", "done", "claims to be done")] });
  assert.deepEqual(provenDone(claimed), []);
  const proven = report({ finished: { commits: ["fix parser"], runs: ["plans/p.md"], plans: [{ path: "plans/p.md", done: 3, total: 3 }, { path: "plans/q.md", done: 1, total: 3 }] } });
  assert.deepEqual(provenDone(proven), ["commit:app:fix parser", "run:app:plans/p.md", "plan:app:plans/p.md"]);
  const since = { at: new Date(2026, 0, 1).toISOString(), seen: ["commit:app:fix parser"] };
  assert.equal(decideVerdict(proven, { cursor: since }).newlyDone, 2);
});

test("nothing to do is said only when every source was read (mutation: drop the store)", () => {
  assert.equal(decideVerdict(report()).code, "ALL_CLEAR");
  assert.match(renderVerdict(report()).text, /^처음 봄 — 비교할 기준 없음\n지금 할 일 없음 — 확인한 기록 0개\n읽음 0\/0 세션$/u);
  for (const blind of [report({ store: "none" }), report({ plansSkipped: 2 }), report({ herdr: "unknown" })]) {
    assert.equal(decideVerdict(blind).code, "UNKNOWN");
    assert.equal(coverageOf(blind).full, false);
    assert.match(renderVerdict(blind).text, /판단 보류 — 못 읽은 기록이 있음\n읽음 \d\/\d 세션 — 못 읽음: /u);
  }
});

test("an action whose records moved is withdrawn on the next look", () => {
  const before = scenarios[7][1];
  const shown = decideVerdict(before);
  const cursor = nextCursor(shown, Date.parse("2026-11-18T09:00:00Z"));
  assert.equal(cursor.fp, shown.action.fp);
  assert.doesNotMatch(renderVerdict(before, { cursor }).text, /철회/u, "same records, same action");
  const after = report({ recommended: { kind: "plan", sessionID: "ses_me", target: "plans/p.md", say: { plan: "Parser plan", left: 2 } }, nextRecord: { kind: "plan" } });
  assert.match(renderVerdict(after, { cursor }).text.split("\n")[0], new RegExp(`지난 할 일 #${cursor.fp} 철회 — 상태가 바뀜`, "u"));
});

test("the collector keeps the user's last look in .litopencode/adhd/cursor.json only with --write-cursor", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-adhd-cursor-"));
  try {
    const run = (...extra) => execFileSync(process.execPath, [engine, "--brief", "--root", dir, "--db", path.join(dir, "none.db"), "--storage", path.join(dir, "none"), ...extra], { encoding: "utf8" });
    assert.match(run(), /^처음 봄/u);
    await assert.rejects(fs.access(path.join(dir, ".litopencode", "adhd", "cursor.json")));
    run("--write-cursor", "--now", "2026-11-18T09:00:00Z");
    const cursor = JSON.parse(await fs.readFile(path.join(dir, ".litopencode", "adhd", "cursor.json"), "utf8"));
    assert.equal(cursor.schema, "litopencode.adhd-cursor/v1");
    assert.doesNotMatch(run(), /^처음 봄/u, "the second look compares against the first");
    assert.match(run("--recap"), /this worktree family/u, "the recap view prints the session cards");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
