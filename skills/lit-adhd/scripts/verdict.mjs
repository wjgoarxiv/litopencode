// The lit-adhd verdict card: about six lines that answer "so what do I do now?" from the collector's report
// alone. A versioned rule table picks ONE verdict, top rule first; the model only prints it.
//
//   1 what changed since the user last looked     `18:02 이후: 2개 끝남, 1개가 너를 기다림`
//   2 the one action and where                    `지금 할 일: <where> 에서 <action>`
//   3 the exact text to type                      `입력: \`go\``
//   4 why, and what not doing it costs            `이유: … · 안 하면: …`
//   5 what else waits on the user, two at most    `다음 대기: …`
//   6 coverage                                    `읽음 6/7 세션 — 못 읽음: …`
//
// Inputs are evidence-gated: a commit, a finished start-work run and a plan with every row ticked are proven;
// a session whose card merely reads `done` is a claim and never counts as finished. Every action carries a
// fingerprint of the records it rests on and a precondition; when the records move, the next card says the old
// action is withdrawn. A push, a publish or a release is never an action, only `네 확인 필요: <question>`.
// `지금 할 일 없음` appears only when every source was read. Pure: the cursor file is read and written by
// rewind.mjs, never here.
import { createHash } from "node:crypto";

export const VERDICT_RULES_VERSION = "litopencode.adhd-verdict/v1";
export const CURSOR_SCHEMA = "litopencode.adhd-cursor/v1";
const TEXT_MAX = 60;

const short = (text) => {
  const flat = String(text ?? "").replace(/[`*_|]/gu, "").replace(/\s+/gu, " ").trim();
  return flat.length <= TEXT_MAX ? flat : `${flat.slice(0, TEXT_MAX - 1)}…`;
};

export const fingerprint = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 6);

const LABELS = {
  ko: {
    since: (hhmm) => `${hhmm} 이후`,
    firstLook: "처음 봄 — 비교할 기준 없음",
    delta: (done, waiting) => `${done}개 끝남, ${waiting}개가 너를 기다림`,
    nothingChanged: "바뀐 것 없음",
    withdrawn: (fp) => `지난 할 일 #${fp} 철회 — 상태가 바뀜`,
    doNow: "지금 할 일",
    at: (where, action) => (where ? `${where} 에서 ${action}` : action),
    type: "입력",
    typeNothing: (where) => `없음 — ${where ?? "그 세션"}에서 직접`,
    typeWait: "없음 — 끝날 때까지 기다리기",
    why: "이유",
    ifNot: "안 하면",
    queue: "다음 대기",
    confirm: "네 확인 필요",
    read: (read, found) => `읽음 ${read}/${found} 세션`,
    missing: "못 읽음",
    nothing: (count) => `지금 할 일 없음 — 확인한 기록 ${count}개`,
    unknown: "판단 보류 — 못 읽은 기록이 있음",
    reasons: { store: "세션 저장소", plans: "계획 파일", herdr: "herdr 상태" },
    here: "이 세션",
    actions: {
      approve: "멈춘 단계를 승인하거나 거절",
      answer: (goal) => `"${goal}" 세션의 질문에 답하기`,
      blocked: (goal) => `"${goal}" 세션의 실패한 단계 보기`,
      resume: (goal) => `멈춘 "${goal}" 이어가기`,
      wait: (lanes) => `기다리기 — 다른 작업 ${lanes}개 진행 중`,
      continueRun: "진행 중인 start-work 계속하기",
      followRun: (plan) => `다른 세션의 start-work(${plan}) 따라가기`,
      startPlan: (plan) => `"${plan}" 계획 실행 시작`,
      dirty: (worktree, count) => `${worktree}의 바뀐 파일 ${count}개 확인`,
      handoff: (item) => `HANDOFF 다음 항목: ${item}`,
      pickUp: (goal) => `"${goal}" 세션 이어받기`,
      suggest: (item) => `다음 항목: ${item}`
    },
    why_: {
      approve: "작업이 네 승인을 기다림",
      answer: "그 세션이 네 답을 기다림",
      blocked: "마지막 단계가 실패했고 그 뒤로 아무것도 안 돌았음",
      resume: "이 세션의 작업이 멈춰 있음",
      wait: "다른 세션이 같은 곳에서 일하는 중",
      continueRun: "이 세션의 start-work가 진행 중",
      followRun: "다른 세션이 그 계획을 돌리는 중",
      startPlan: "열린 계획이 하나뿐이고 아무것도 안 돌고 있음",
      dirty: "커밋 안 된 변경이 있음",
      handoff: "HANDOFF.md의 다음 항목이 남아 있음",
      pickUp: "끝나지 않은 세션이 남아 있음",
      suggest: "다른 작업트리에 열린 계획이 있음"
    },
    ifNot_: {
      approve: "작업이 그 단계 없이 계속 감, 잃는 것 없음",
      answer: "그 세션이 계속 기다림",
      blocked: "그 세션이 계속 멈춰 있음",
      resume: "멈춘 그대로 남음",
      wait: "없음",
      continueRun: "남은 항목이 그대로 남음",
      followRun: "없음 — 그 세션이 계속 돌림",
      startPlan: "계획이 그대로 남음",
      dirty: "변경이 커밋 안 된 채 남음",
      handoff: "그 항목이 그대로 남음",
      pickUp: "그 세션이 그대로 남음",
      suggest: "그 계획이 그대로 남음"
    },
    push: (worktree, count) => `${worktree}의 커밋 ${count}개를 push 할까?`,
    stale: (title, days) => `"${title}" 계획이 ${days}일째 그대로 — 계속할지 닫을지`,
    waitingAt: (goal) => `"${goal}" 세션이 답을 기다림`,
    more: (n) => `(+${n})`
  },
  en: {
    since: (hhmm) => `Since ${hhmm}`,
    firstLook: "First look — no baseline yet",
    delta: (done, waiting) => `${done} finished, ${waiting} waiting on you`,
    nothingChanged: "nothing changed",
    withdrawn: (fp) => `last action #${fp} withdrawn — the state moved`,
    doNow: "Do now",
    at: (where, action) => (where ? `in ${where}: ${action}` : action),
    type: "Type",
    typeNothing: (where) => `nothing — act in ${where ?? "that session"}`,
    typeWait: "nothing — wait for them to finish",
    why: "Why",
    ifNot: "If not",
    queue: "Next waiting",
    confirm: "Your call",
    read: (read, found) => `Read ${read}/${found} sessions`,
    missing: "not read",
    nothing: (count) => `Nothing to do now — ${count} records checked`,
    unknown: "No verdict — some records were not read",
    reasons: { store: "session store", plans: "plan files", herdr: "herdr state" },
    here: "this session",
    actions: {
      approve: "approve or deny the parked steps",
      answer: (goal) => `answer the question in "${goal}"`,
      blocked: (goal) => `look at the failed step in "${goal}"`,
      resume: (goal) => `resume the paused "${goal}"`,
      wait: (lanes) => `wait — ${lanes} other lane(s) at work`,
      continueRun: "keep the running start-work going",
      followRun: (plan) => `follow the start-work on ${plan} in its own session`,
      startPlan: (plan) => `start work on "${plan}"`,
      dirty: (worktree, count) => `review ${count} changed file(s) in ${worktree}`,
      handoff: (item) => `HANDOFF next item: ${item}`,
      pickUp: (goal) => `pick up "${goal}"`,
      suggest: (item) => `next item: ${item}`
    },
    why_: {
      approve: "the run waits for your approval",
      answer: "that session waits for your answer",
      blocked: "its last step failed and nothing ran since",
      resume: "this session's work is paused",
      wait: "another session works here",
      continueRun: "this session's start-work is running",
      followRun: "another session runs that plan",
      startPlan: "one open plan and nothing running",
      dirty: "uncommitted changes",
      handoff: "HANDOFF.md still lists it next",
      pickUp: "an unfinished session is left",
      suggest: "another worktree has one open plan"
    },
    ifNot_: {
      approve: "the run goes on without those steps, nothing lost",
      answer: "that session keeps waiting",
      blocked: "that session stays stuck",
      resume: "it stays paused",
      wait: "nothing",
      continueRun: "the open rows stay open",
      followRun: "nothing — that session keeps running it",
      startPlan: "the plan stays as it is",
      dirty: "the changes stay uncommitted",
      handoff: "the item stays open",
      pickUp: "that session stays as it is",
      suggest: "that plan stays as it is"
    },
    push: (worktree, count) => `push ${count} commit(s) in ${worktree}?`,
    stale: (title, days) => `"${title}" untouched for ${days} days — keep or close?`,
    waitingAt: (goal) => `"${goal}" waits for an answer`,
    more: (n) => `(+${n})`
  }
};
export const VERDICT_LANGS = Object.keys(LABELS);

const cardsOf = (report) => (report.groups ?? []).flatMap((group) => (group.sessions ?? []).map((card) => ({ card, group })));
const reminders = (report, kind) => (report.board?.reminders ?? []).filter((entry) => entry.kind === kind);

/** Proven finished items, each with a stable id: commits, completed start-work runs, plans with every row ticked. */
export function provenDone(report) {
  return (report.groups ?? []).flatMap((group) => [
    ...(group.finished?.commits ?? []).map((subject) => `commit:${group.worktree}:${subject}`),
    ...(group.finished?.runs ?? []).map((plan) => `run:${group.worktree}:${plan}`),
    ...(group.finished?.plans ?? []).filter((plan) => plan.total > 0 && plan.done === plan.total).map((plan) => `plan:${group.worktree}:${plan.path}`)
  ]);
}

/** Which sources could not be read. A session store that did not open, skipped plans and an unknown herdr count. */
export function coverageOf(report) {
  const missing = [];
  if ((report.source?.store ?? "none") === "none") missing.push({ reason: "store", count: null });
  if ((report.plansSkipped ?? 0) > 0) missing.push({ reason: "plans", count: report.plansSkipped });
  if (report.source?.herdr === "unknown") missing.push({ reason: "herdr", count: null });
  const read = cardsOf(report).length;
  return { read, found: read + (missing.find((item) => item.reason === "store") ? 1 : 0), missing, full: missing.length === 0 };
}

const goalOf = (report, sessionID) => short(cardsOf(report).find(({ card }) => card.id === sessionID)?.card.goal ?? "");

/**
 * The rule table, top first. Each rule reads the report and returns null or the action:
 * `{ kind, where, arg, type, fp, pre }`. A change of order or meaning bumps VERDICT_RULES_VERSION.
 */
export const RULES = Object.freeze([
  ["approve-own-boundary", (r) => (r.recommended?.kind === "answer" && r.recommended.say?.own && r.recommended.say?.boundary ? { kind: "approve", where: null, type: "lit approve", fp: fingerprint(["approve", r.recommended.sessionID, r.recommended.say.boundary]), pre: "this session's run has parked steps" } : null)],
  ["answer-session", (r) => (r.recommended?.kind === "answer" ? { kind: "answer", where: goalOf(r, r.recommended.sessionID), arg: goalOf(r, r.recommended.sessionID), type: null, fp: fingerprint(["answer", r.recommended.sessionID]), pre: "that session's last turn waits on the user" } : null)],
  ["blocked-session", (r) => (r.recommended?.kind === "session" && r.recommended.say?.reason === "blocked" ? { kind: "blocked", where: short(r.recommended.say.goal), arg: short(r.recommended.say.goal), type: null, fp: fingerprint(["blocked", r.recommended.sessionID]), pre: "that session's last step failed" } : null)],
  ["resume-own", (r) => (r.recommended?.kind === "continue" ? { kind: "resume", where: null, arg: short(r.recommended.say?.goal), type: r.nextRecord?.kind === "continue" ? "go" : "lit continue", fp: fingerprint(["resume", r.recommended.sessionID]), pre: "this session's discipline is paused" } : null)],
  ["wait-lanes", (r) => (r.recommended?.kind === "lanes" ? { kind: "wait", where: null, arg: r.recommended.lanes, type: null, fp: fingerprint(["wait", r.recommended.lanes]), pre: "other lanes are working" } : null)],
  ["continue-own-run", (r) => (r.recommended?.kind === "work" ? { kind: "continueRun", where: null, type: r.nextRecord?.kind === "work" ? "go" : null, fp: fingerprint(["run", r.recommended.sessionID]), pre: "this session's start-work run is active" } : null)],
  ["follow-other-run", (r) => (r.recommended?.kind === "session" && r.recommended.say?.reason === "run-elsewhere" ? { kind: "followRun", where: null, arg: short(r.recommended.say.plan), type: null, fp: fingerprint(["follow", r.recommended.sessionID, r.recommended.say.plan]), pre: "another session's start-work run is active" } : null)],
  ["start-single-plan", (r) => (r.recommended?.kind === "plan" ? { kind: "startPlan", where: null, arg: short(r.recommended.say?.plan), type: r.nextRecord?.kind === "plan" ? "go" : `start-work ${r.recommended.target}`, fp: fingerprint(["plan", r.recommended.target, r.recommended.say?.left]), pre: "one open plan here and no run" } : null)],
  ["uncommitted-work", (r) => {
    const tree = reminders(r, "uncommitted")[0];
    return tree ? { kind: "dirty", where: null, arg: [tree.worktree, tree.count], type: "git status", fp: fingerprint(["dirty", tree.worktree, tree.count]), pre: "the worktree has uncommitted changes" } : null;
  }],
  ["handoff-next", (r) => (r.recommended?.kind === "handoff" ? { kind: "handoff", where: null, arg: short(r.recommended.say?.item), type: null, fp: fingerprint(["handoff", r.recommended.say?.item]), pre: "HANDOFF.md lists it next" } : null)],
  ["pick-up-session", (r) => (r.recommended?.kind === "session" ? { kind: "pickUp", where: short(r.recommended.say?.goal), arg: short(r.recommended.say?.goal), type: null, fp: fingerprint(["pickup", r.recommended.sessionID]), pre: "that session stopped with work left" } : null)],
  ["suggest-elsewhere", (r) => (r.recommended?.kind === "suggest" ? { kind: "suggest", where: short(r.recommended.say?.worktree), arg: short(r.recommended.say?.item), type: null, fp: fingerprint(["suggest", r.recommended.say?.item]), pre: "that plan row is still open" } : null)]
]);

/** The structured verdict: delta, the one action (or nothing / unknown), coverage and the proven ids. */
export function decideVerdict(report, { cursor = null } = {}) {
  const done = provenDone(report);
  const since = cursor && Number.isFinite(Date.parse(cursor.at)) ? Date.parse(cursor.at) : null;
  const seen = new Set(Array.isArray(cursor?.seen) ? cursor.seen : []);
  const waiting = cardsOf(report).filter(({ card }) => card.status === "waits-on-you").length;
  let action = null;
  let rule = null;
  for (const [name, test] of RULES) {
    action = test(report);
    if (action) {
      rule = name;
      break;
    }
  }
  const coverage = coverageOf(report);
  const code = action ? (action.kind === "wait" ? "WAIT" : action.kind === "approve" || action.kind === "answer" ? "NEEDS_YOU" : "ONE_ACTION") : coverage.full ? "ALL_CLEAR" : "UNKNOWN";
  const checked = done.length + cardsOf(report).length + (report.board?.milestones ?? []).length;
  return { version: VERDICT_RULES_VERSION, code, rule, action, since, newlyDone: since === null ? null : done.filter((id) => !seen.has(id)).length, waiting, coverage, checked, done };
}

const hhmm = (ms) => {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** The decision queue: what else waits on the user; irreversible steps only as questions. */
function queueOf(report, verdict, labels) {
  const items = [];
  for (const { card } of cardsOf(report)) {
    if (card.status !== "waits-on-you" || (verdict.action?.kind === "answer" && card.id === report.recommended?.sessionID) || verdict.action?.kind === "approve") continue;
    items.push(labels.waitingAt(short(card.goal)));
  }
  for (const entry of reminders(report, "unpushed")) items.push(`${labels.confirm}: ${labels.push(entry.worktree, entry.count)}`);
  for (const entry of reminders(report, "stale")) items.push(labels.stale(short(entry.title), entry.days));
  return items;
}

/** The card as text plus the structured verdict. `lang` is ko (the default) or en. */
export function renderVerdict(report, { lang = "ko", cursor = null } = {}) {
  const labels = LABELS[lang] ?? LABELS.ko;
  const verdict = decideVerdict(report, { cursor });
  const lines = [];
  if (verdict.since === null) lines.push(labels.firstLook);
  else {
    const changed = verdict.newlyDone === 0 && verdict.waiting === 0 ? labels.nothingChanged : labels.delta(verdict.newlyDone, verdict.waiting);
    const stale = typeof cursor?.fp === "string" && /^[0-9a-f]{6}$/u.test(cursor.fp) && cursor.fp !== (verdict.action?.fp ?? null);
    lines.push(`${labels.since(hhmm(verdict.since))}: ${changed}${stale ? ` · ${labels.withdrawn(cursor.fp)}` : ""}`);
  }
  const action = verdict.action;
  if (action) {
    const describe = labels.actions[action.kind];
    const text = typeof describe === "function" ? (Array.isArray(action.arg) ? describe(...action.arg) : describe(action.arg)) : describe;
    lines.push(`${labels.doNow}: ${labels.at(action.where, text)} #${action.fp}`);
    lines.push(`${labels.type}: ${action.type ? `\`${action.type}\`` : action.kind === "wait" ? labels.typeWait : labels.typeNothing(action.where)}`);
    lines.push(`${labels.why}: ${labels.why_[action.kind]} · ${labels.ifNot}: ${labels.ifNot_[action.kind]}`);
  } else {
    lines.push(verdict.code === "ALL_CLEAR" ? labels.nothing(verdict.checked) : labels.unknown);
  }
  const queue = queueOf(report, verdict, labels);
  if (queue.length > 0) lines.push(`${labels.queue}: ${queue.slice(0, 2).join(" · ")}${queue.length > 2 ? ` ${labels.more(queue.length - 2)}` : ""}`);
  const { read, found, missing } = verdict.coverage;
  lines.push(`${labels.read(read, found)}${missing.length > 0 ? ` — ${labels.missing}: ${missing.map((item) => `${labels.reasons[item.reason]}${item.count ? ` ${item.count}` : ""}`).join(", ")}` : ""}`);
  return { text: lines.join("\n"), verdict };
}

/** The next cursor: when the user looked, which proven items they have now seen, and the action shown. */
export function nextCursor(verdict, now) {
  return { schema: CURSOR_SCHEMA, at: new Date(now).toISOString(), seen: verdict.done.slice(0, 500), fp: verdict.action?.fp ?? null };
}
