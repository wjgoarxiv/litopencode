// The goal pipeline: a plan's `## Done when` block becomes one checkable goal condition, asked for once when
// `/start-work save-plan` saves the approved plan. The user's exact `yes` starts the start-work run for that plan
// and arms the goal in one step; a refused start arms nothing. On OpenCode 2 the
// armed condition becomes the native `/goal` (v2/native-goal-runtime.ts); OpenCode 1 has no goal, so the same
// check runs at session.idle as an advisory notice. The records live under `<project>/.litopencode/goal/`:
//
//   consent.json            the question: condition (or why there is none), its hash, the plan  (asked)
//   intent-<session>.json   the user's yes, bound to that hash                            (armed)
//
// A lit-loop or litwork run with no plan gets one question too: `Set goal for this lit-loop: /goal <condition>? (yes / no)`,
// where the condition is the project's test command exiting 0 with the objective done. Its consent carries
// `kind: "loop"` and no plan, and a `yes` arms the goal without starting any start-work run.
//
// Nothing here sets a host goal. A goal LitOpenCode did not create is never touched.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ledgerGoalDone } from "./native-goal-ledger.ts";
import { containsSecret } from "./secret-shapes.ts";

export const goalDirName = path.join(".litopencode", "goal");
export const goalMaxChars = 500;
export const consentTtlMs = 30 * 60_000;
export const falsifyTimeoutMs = 60_000;
export const goalStallChecks = 12;

/** The fixed status lines. The hooks print these and nothing else. */
export const goalStatus = Object.freeze({
  asked: (condition: string) => `Approve plan, start work and set goal: /goal ${condition}? (yes / edit / no)`,
  askedNoGoal: (reason: string) => `Approve plan and start work? (yes / no)\nNo goal set: ${reason}`,
  startRefused: (reason: string) => `Work not started and no goal set: ${reason}`,
  loopAsked: (condition: string) => `Set goal for this lit-loop: /goal ${condition}? (yes / no)`,
  skipped: (reason: string) => `No goal set: ${reason}`,
  armed: (id: string) => `LitOpenCode goal armed [lit:${id}]; OpenCode 2 sets it as /goal now.`,
  advisory: (id: string) => `LitOpenCode goal armed [lit:${id}] as advisory: this OpenCode has no /goal, so LitOpenCode checks the condition when each turn ends.`,
  set: (id: string) => `LitOpenCode goal set [lit:${id}]`,
  yours: "Your own goal is active; LitOpenCode left it alone.",
  notConfirmed: (condition: string) => `Goal not confirmed. Paste: /goal ${condition}`,
  met: (id: string) => `Goal met and cleared [lit:${id}]`,
  advisoryMet: (id: string) => `Goal met [lit:${id}]: every row is ticked and the check exits 0.`,
  advisoryLoopMet: (id: string) => `Goal met [lit:${id}]: the check exits 0 and the ledger marks the work done.`,
  cleared: (id: string, why: string) => `LitOpenCode goal cleared (${why}) [lit:${id}]`,
  edit: "Edit the plan's `## Done when` check, save the plan again with /start-work save-plan, and answer the new question.",
  declined: "Nothing started and no goal set: you said no."
});

const judgmentWords = [
  /(?<![a-z])works?(?![a-z])/iu, /(?<![a-z])working(?![a-z])/iu, /(?<![a-z])looks? (?:good|fine|right|nice|great)(?![a-z])/iu,
  /(?<![a-z])seems?(?![a-z])/iu, /(?<![a-z])properly(?![a-z])/iu, /(?<![a-z])correctly(?![a-z])/iu, /(?<![a-z])clean(?:ly)?(?![a-z])/iu,
  /(?<![a-z])nicely(?![a-z])/iu, /(?<![a-z])should (?:work|pass)(?![a-z])/iu, /(?<![a-z])as expected(?![a-z])/iu, /(?<![a-z])good enough(?![a-z])/iu,
  /잘\s*(?:동작|작동|돌아|돼|된다|되면)/u, /괜찮/u, /깔끔/u, /제대로/u, /문제\s*없/u, /완벽/u
];
// A success that is only an outward action proves nothing about the work and cannot be undone.
const outwardOnly = /^\s*(?:git\s+push|npm\s+publish|pnpm\s+publish|yarn\s+publish|gh\s+(?:release|pr\s+merge)|git\s+tag)(?![a-z])/iu;
// The test runners the falsifier may run. Anything else is refused before it runs.
const checkAllowlist = [
  /^npm (?:test|run [\w:.-]+)(?: --[\w-]+)*$/u,
  /^node --test(?: [\w./*-]+)*$/u,
  /^node [\w./-]+\.m?js(?: [\w./=-]+)*$/u,
  /^(?:pnpm|yarn|bun) (?:test|run [\w:.-]+)$/u,
  /^(?:pytest|python3? -m pytest)(?: [\w./:-]+)*$/u,
  /^cargo test(?: [\w-]+)*$/u,
  /^go test(?: [\w./-]+)*$/u,
  /^make (?:test|check|verify)$/u,
  /^(?:bash|sh) scripts\/[\w./-]+\.sh$/u
];

export const conditionHash = (condition: string): string => createHash("sha256").update(condition).digest("hex").slice(0, 16);
export const goalId = (plan: string, check: string): string => createHash("sha256").update(`${plan}\u0000${check}`).digest("hex").slice(0, 8);

export type GoalResult<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly reason: string };

/** The plan's `## Done when` block: one `check: \`<command>\`` line. */
export function parseDoneWhen(planText: string): GoalResult<{ readonly check: string }> {
  const lines = planText.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^##\s+Done when\s*$/iu.test(line));
  if (start === -1) return { ok: false, reason: "the plan has no `## Done when` block" };
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/u.test(line)) break;
    const match = /^\s*(?:[-*]\s+)?check:\s*`([^`\n]+)`\s*$/u.exec(line);
    if (match !== null) return { ok: true, check: match[1].trim() };
  }
  return { ok: false, reason: "the `## Done when` block names no `check:` command" };
}

/** `Every row in <plan> is ticked and \`<check>\` exits 0 [lit:<id>]`, or why it cannot be built. */
export function compileCondition(plan: string, check: string): GoalResult<{ readonly condition: string; readonly id: string }> {
  const id = goalId(plan, check);
  const condition = `Every row in ${plan} is ticked and \`${check}\` exits 0 [lit:${id}]`;
  if (condition.length > goalMaxChars) return { ok: false, reason: `the condition is over ${goalMaxChars} characters; point the check at one script` };
  return { ok: true, condition, id };
}

const loopObjectiveMax = 300;

/** The objective as a goal condition may carry it: one line, no slash-command lines, no credential-shaped text. */
export function normalizeLoopObjective(value: string): string {
  const flat = value
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("/"))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (flat === "") return "";
  if (containsSecret(flat)) return "the work requested in this session";
  return [...flat].slice(0, loopObjectiveMax).join("").trim();
}

/** A lit-loop's condition: its check exits 0 and its objective is done. No plan, so no rows. */
export function compileLoopCondition(objective: string, check: string): GoalResult<{ readonly condition: string; readonly id: string }> {
  const id = goalId(`loop\u0000${objective}`, check);
  const condition = `\`${check}\` exits 0 and this is done: ${objective} [lit:${id}]`;
  if (condition.length > goalMaxChars) return { ok: false, reason: `the condition is over ${goalMaxChars} characters; shorten the objective` };
  return { ok: true, condition, id };
}

/** Rejects judgment words, outward-only success, commands outside the allowlist and conditions over the cap. */
export function lintCondition(condition: string, check: string): { readonly ok: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  if (condition.length > goalMaxChars) reasons.push(`over ${goalMaxChars} characters`);
  const words = judgmentWords.map((pattern) => pattern.exec(check)?.[0]).filter((word): word is string => word !== undefined);
  if (words.length > 0) reasons.push(`judgment words cannot be checked (${words.join(", ")})`);
  if (outwardOnly.test(check)) reasons.push("a push, publish or release is not a check of the work");
  if (!checkAllowlist.some((pattern) => pattern.test(check))) reasons.push(`\`${check}\` is not an allowlisted test command`);
  return { ok: reasons.length === 0, reasons };
}

/** The plan's checklist rows, ticked or not. */
export function planRows(planText: string): { readonly total: number; readonly open: number } {
  const rows = planText.split(/\r?\n/u).filter((line) => /^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]/u.test(line));
  return { total: rows.length, open: rows.filter((line) => /\[ \]/u.test(line)).length };
}

export type CheckRunner = (command: string, args: readonly string[], options: { readonly cwd: string; readonly timeout: number }) => Pick<SpawnSyncReturns<string>, "status" | "signal" | "error">;

const defaultRunner: CheckRunner = (command, args, options) =>
  spawnSync(command, [...args], { cwd: options.cwd, encoding: "utf8", timeout: options.timeout, stdio: ["ignore", "ignore", "ignore"], shell: false });

/** Runs the allowlisted check once, time-boxed, with no shell: `pass`, `fail`, or why it could not run. */
export function runCheck(cwd: string, check: string, planText: string, timeoutMs = falsifyTimeoutMs, run: CheckRunner = defaultRunner): { readonly state: "pass" | "fail" } | { readonly state: "error"; readonly reason: string } {
  const [command, ...args] = check.split(/\s+/u);
  const result = run(command ?? "", args, { cwd, timeout: timeoutMs });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
    return { state: "error", reason: `\`${check}\` did not finish within ${Math.round(timeoutMs / 1000)} s` };
  }
  // A check script the plan itself creates is missing until the work runs: that is false now, not broken.
  const plannedScript = (command === "bash" || command === "sh") && args.length === 1 && planText.includes(args[0] ?? "");
  if (result.error !== undefined || (result.status === 127 && !plannedScript)) return { state: "error", reason: `\`${check}\` cannot run here` };
  return { state: result.status === 0 ? "pass" : "fail" };
}

/** The dry run: the condition must be false right now, or the goal would be met on its first check. */
export function falsify(cwd: string, plan: string, planText: string, check: string, timeoutMs = falsifyTimeoutMs, run: CheckRunner = defaultRunner): GoalResult<{ readonly open: number }> {
  const rows = planRows(planText);
  const result = runCheck(cwd, check, planText, timeoutMs, run);
  if (result.state === "error") return { ok: false, reason: result.reason };
  if (result.state === "pass" && rows.open === 0) return { ok: false, reason: `the goal is already true (${plan} is all ticked and \`${check}\` exits 0)` };
  return { ok: true, open: rows.open };
}

/** A lit-loop has no unticked rows to keep its goal false, so its check must fail right now. */
export function falsifyLoop(cwd: string, check: string, timeoutMs = falsifyTimeoutMs, run: CheckRunner = defaultRunner): GoalResult<{ readonly exit: "fail" }> {
  const result = runCheck(cwd, check, "", timeoutMs, run);
  if (result.state === "error") return { ok: false, reason: result.reason };
  if (result.state === "pass") return { ok: false, reason: `\`${check}\` already passes, so the goal would be met at once; write the failing test first` };
  return { ok: true, exit: "fail" };
}

export type GoalConsent = {
  readonly schema: "litopencode.goal-consent/v1";
  /** `loop` for a lit-loop or litwork question: no plan, and a `yes` starts nothing. */
  readonly kind?: "loop";
  readonly objective?: string;
  /** Empty when no goal can be set; `noGoal` then says why, and `yes` only starts the work. */
  readonly condition: string;
  readonly noGoal?: string;
  readonly hash: string;
  readonly id: string;
  /** The saved plan the question is about; null for a loop question. */
  readonly plan: string | null;
  readonly check: string;
  readonly sessionID: string;
  readonly askedAt: string;
};

export type GoalIntent = Omit<GoalConsent, "schema" | "askedAt"> & {
  readonly schema: "litopencode.goal-intent/v1";
  readonly armedAt: string;
  readonly closed?: string;
  readonly checks?: number;
};

const safeSession = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export function goalDir(projectRoot: string): string {
  return path.join(projectRoot, goalDirName);
}

function intentFile(projectRoot: string, sessionID: string): string {
  if (!safeSession.test(sessionID)) throw new Error("goal intent session id must match [A-Za-z0-9_-]");
  return path.join(goalDir(projectRoot), `intent-${sessionID}.json`);
}

function writeRecord(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.lstatSync(file, { throwIfNoEntry: false });
  if (existing !== undefined && !existing.isFile()) throw new Error(`${file} is not a regular file`);
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function readRecord(file: string): Record<string, unknown> | undefined {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 16_384) return undefined;
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch { // no-excuse-ok: catch -- a missing or torn record reads as no record.
    return undefined;
  }
}

/**
 * Compiles, lints and dry-runs the saved plan's `## Done when` block and records the question in consent.json.
 * Returns the one line to show: the question, or `No goal set: <reason>`. It never sets a goal.
 */
export function proposeGoal(input: {
  readonly projectRoot: string;
  readonly plan: string;
  readonly planText: string;
  readonly sessionID: string;
  readonly now?: number;
  readonly timeoutMs?: number;
  readonly run?: CheckRunner;
}): { readonly line: string; readonly consent?: GoalConsent } {
  const built = buildGoal(input);
  const consent: GoalConsent = {
    schema: "litopencode.goal-consent/v1",
    condition: built.ok ? built.condition : "",
    ...(built.ok ? {} : { noGoal: built.reason }),
    hash: consentHash(built.ok ? built.condition : "", input.plan),
    id: built.ok ? built.id : "",
    plan: input.plan,
    check: built.ok ? built.check : "",
    sessionID: input.sessionID,
    askedAt: new Date(input.now ?? Date.now()).toISOString()
  };
  try {
    writeRecord(path.join(goalDir(input.projectRoot), "consent.json"), consent);
  } catch { // no-excuse-ok: catch -- an unwritable state folder means no question, never a failed save.
    return { line: goalStatus.skipped(".litopencode/goal could not be written") };
  }
  return { line: built.ok ? goalStatus.asked(built.condition) : goalStatus.askedNoGoal(built.reason), consent };
}

function consentHash(condition: string, plan: string | null): string {
  return conditionHash(condition === "" ? `start:${plan}` : condition);
}

/**
 * The lit-loop question: compiles `<check> exits 0 and this is done: <objective>`, lints it and, unless
 * `falsifyNow` is false (the prompt hook cannot wait on a test run), dry-runs the check, which must fail now.
 * Records a `kind: "loop"` consent and returns the one line to show, or `No goal set: <reason>` and records nothing.
 */
export function proposeLoopGoal(input: {
  readonly projectRoot: string;
  readonly check: string;
  readonly objective: string;
  readonly sessionID: string;
  readonly now?: number;
  readonly timeoutMs?: number;
  readonly run?: CheckRunner;
  readonly falsifyNow?: boolean;
}): { readonly line: string; readonly consent?: GoalConsent } {
  const objective = normalizeLoopObjective(input.objective);
  const check = input.check.trim();
  if (objective === "") return { line: goalStatus.skipped("name what the loop should finish") };
  const built = compileLoopCondition(objective, check);
  if (!built.ok) return { line: goalStatus.skipped(built.reason) };
  const lint = lintCondition(built.condition, check);
  if (!lint.ok) return { line: goalStatus.skipped(lint.reasons.join("; ")) };
  if (input.falsifyNow !== false) {
    const dry = falsifyLoop(input.projectRoot, check, input.timeoutMs, input.run);
    if (!dry.ok) return { line: goalStatus.skipped(dry.reason) };
  }
  const consent: GoalConsent = {
    schema: "litopencode.goal-consent/v1",
    kind: "loop",
    condition: built.condition,
    hash: conditionHash(built.condition),
    id: built.id,
    plan: null,
    check,
    objective,
    sessionID: input.sessionID,
    askedAt: new Date(input.now ?? Date.now()).toISOString()
  };
  try {
    writeRecord(path.join(goalDir(input.projectRoot), "consent.json"), consent);
  } catch { // no-excuse-ok: catch -- an unwritable state folder means no question.
    return { line: goalStatus.skipped(".litopencode/goal could not be written") };
  }
  return { line: goalStatus.loopAsked(built.condition), consent };
}

/** A goal question is open for any session: fresh, so a stale file never blocks a new one. */
export function hasPendingConsent(projectRoot: string, now = Date.now()): boolean {
  const record = readRecord(path.join(goalDir(projectRoot), "consent.json"));
  if (typeof record?.askedAt !== "string") return false;
  const asked = Date.parse(record.askedAt);
  return Number.isFinite(asked) && now - asked >= 0 && now - asked <= consentTtlMs;
}

/** Any prompt that is not the loop question's yes or no settles it: the question is dropped, never carried over. */
export function dropLoopConsent(projectRoot: string, sessionID: string): void {
  if (liveConsent(projectRoot, sessionID)?.kind === "loop") fs.rmSync(path.join(goalDir(projectRoot), "consent.json"), { force: true });
}

function buildGoal(input: { readonly projectRoot: string; readonly plan: string; readonly planText: string; readonly timeoutMs?: number; readonly run?: CheckRunner }):
  GoalResult<{ readonly condition: string; readonly id: string; readonly check: string }> {
  if (/^goal:\s*never\s*$/mu.test(input.planText)) return { ok: false, reason: "this plan is marked goal: never" };
  const done = parseDoneWhen(input.planText);
  if (!done.ok) return done;
  const built = compileCondition(input.plan, done.check);
  if (!built.ok) return built;
  const lint = lintCondition(built.condition, done.check);
  if (!lint.ok) return { ok: false, reason: lint.reasons.join("; ") };
  const dry = falsify(input.projectRoot, input.plan, input.planText, done.check, input.timeoutMs, input.run);
  if (!dry.ok) return dry;
  return { ok: true, condition: built.condition, id: built.id, check: done.check };
}

/** `yes` (exactly, any case) arms; `edit` and `no` are answers too; anything else is no answer. */
export function consentAnswer(text: string): "yes" | "edit" | "no" | undefined {
  const answer = text.trim().toLowerCase();
  return answer === "yes" || answer === "edit" || answer === "no" ? answer : undefined;
}

/** The live question for this session: fresh, unchanged since it was asked, and asked here. */
export function liveConsent(projectRoot: string, sessionID: string, now = Date.now()): GoalConsent | undefined {
  const record = readRecord(path.join(goalDir(projectRoot), "consent.json"));
  if (record?.schema !== "litopencode.goal-consent/v1" || typeof record.condition !== "string" || typeof record.askedAt !== "string") return undefined;
  const loop = record.kind === "loop";
  if (loop ? record.plan !== null || record.condition === "" : typeof record.plan !== "string") return undefined;
  if (record.hash !== consentHash(record.condition, record.plan as string | null) || record.sessionID !== sessionID) return undefined;
  const asked = Date.parse(record.askedAt);
  if (!Number.isFinite(asked) || now - asked < 0 || now - asked > consentTtlMs) return undefined;
  return record as unknown as GoalConsent;
}

/**
 * Answers the live question; every answer consumes it. `start` is what starting the plan's start-work run
 * returned: a refused start arms nothing. Only a `yes` whose start went through writes the intent.
 */
export function answerConsent(
  projectRoot: string,
  sessionID: string,
  text: string,
  advisory: boolean,
  now = Date.now(),
  start?: { readonly started: boolean; readonly text: string }
): { readonly answer: "yes" | "edit" | "no"; readonly line: string; readonly intent?: GoalIntent } | undefined {
  const answer = consentAnswer(text);
  if (answer === undefined) return undefined;
  const consent = liveConsent(projectRoot, sessionID, now);
  if (consent === undefined) return undefined;
  // A start-only question and a loop question offer no edit: `edit` is not an answer to either.
  if (answer === "edit" && (consent.condition === "" || consent.kind === "loop")) return undefined;
  fs.rmSync(path.join(goalDir(projectRoot), "consent.json"), { force: true });
  if (answer === "edit") return { answer, line: goalStatus.edit };
  if (answer === "no") return { answer, line: consent.kind === "loop" ? goalStatus.skipped("you said no") : goalStatus.declined };
  if (start !== undefined && !start.started) return { answer, line: goalStatus.startRefused(start.text.replace(/^LitOpenCode:\s*/u, "")) };
  if (consent.condition === "") return { answer, line: goalStatus.skipped(consent.noGoal ?? "this plan has no checkable Done-when block") };
  const { schema: _schema, askedAt: _askedAt, ...rest } = consent;
  const intent: GoalIntent = { ...rest, schema: "litopencode.goal-intent/v1", armedAt: new Date(now).toISOString(), checks: 0 };
  try {
    writeRecord(intentFile(projectRoot, sessionID), intent);
  } catch { // no-excuse-ok: catch -- an unwritten intent arms nothing, and the line says so.
    return { answer, line: goalStatus.notConfirmed(consent.condition) };
  }
  return { answer, line: advisory ? goalStatus.advisory(consent.id) : goalStatus.armed(consent.id), intent };
}

/** The armed, still-open intent of a session. */
export function readIntent(projectRoot: string, sessionID: string): GoalIntent | undefined {
  let file: string;
  try {
    file = intentFile(projectRoot, sessionID);
  } catch {
    return undefined;
  }
  const record = readRecord(file);
  if (record?.schema !== "litopencode.goal-intent/v1" || typeof record.condition !== "string" || record.hash !== conditionHash(record.condition)) return undefined;
  return record.closed === undefined ? (record as unknown as GoalIntent) : undefined;
}

/** True when this session armed a goal that has since closed (met, stalled or cancelled). */
export function hasClosedIntent(projectRoot: string, sessionID: string): boolean {
  let file: string;
  try {
    file = intentFile(projectRoot, sessionID);
  } catch {
    return false;
  }
  const record = readRecord(file);
  return record?.schema === "litopencode.goal-intent/v1" && typeof record.closed === "string";
}

export function updateIntent(projectRoot: string, sessionID: string, change: Partial<Pick<GoalIntent, "closed" | "checks">>): void {
  const intent = readIntent(projectRoot, sessionID);
  if (intent === undefined) return;
  try {
    writeRecord(intentFile(projectRoot, sessionID), { ...intent, ...change });
  } catch { // no-excuse-ok: catch -- a stale intent only means one more advisory check.
    return;
  }
}

/**
 * The OpenCode 1 turn-end check: every row ticked and the check exits 0 closes the advisory goal as met; twelve
 * checks with the condition still false close it as stalled. Returns the line to show, or undefined.
 */
export function advisoryGoalCheck(projectRoot: string, sessionID: string, run: CheckRunner = defaultRunner): string | undefined {
  const intent = readIntent(projectRoot, sessionID);
  // A loop goal has no plan rows; advisoryLoopGoalCheck owns it.
  if (intent === undefined || intent.plan === null) return undefined;
  let planText: string;
  try {
    planText = fs.readFileSync(path.resolve(projectRoot, intent.plan), "utf8");
  } catch {
    updateIntent(projectRoot, sessionID, { closed: "plan unreadable" });
    return goalStatus.cleared(intent.id, "the plan cannot be read");
  }
  const checks = (intent.checks ?? 0) + 1;
  if (planRows(planText).open === 0 && runCheck(projectRoot, intent.check, planText, falsifyTimeoutMs, run).state === "pass") {
    updateIntent(projectRoot, sessionID, { closed: "met", checks });
    return goalStatus.advisoryMet(intent.id);
  }
  if (checks >= goalStallChecks) {
    updateIntent(projectRoot, sessionID, { closed: "stalled", checks });
    return goalStatus.cleared(intent.id, "stalled");
  }
  updateIntent(projectRoot, sessionID, { checks });
  return undefined;
}

/**
 * The OpenCode 1 turn-end check for a lit-loop goal, which has no plan rows: the check exits 0 and LitOpenCode's
 * evidence ledger marks the session's work complete (the check alone could already pass when the loop starts).
 * Twelve checks with the condition still false close it as stalled. Returns the line to show, or undefined.
 */
export async function advisoryLoopGoalCheck(projectRoot: string, sessionID: string, run: CheckRunner = defaultRunner): Promise<string | undefined> {
  const intent = readIntent(projectRoot, sessionID);
  if (intent === undefined || intent.plan !== null) return undefined;
  const checks = (intent.checks ?? 0) + 1;
  if (runCheck(projectRoot, intent.check, "", falsifyTimeoutMs, run).state === "pass" && await ledgerGoalDone(projectRoot, sessionID, intent.armedAt)) {
    updateIntent(projectRoot, sessionID, { closed: "met", checks });
    return goalStatus.advisoryLoopMet(intent.id);
  }
  if (checks >= goalStallChecks) {
    updateIntent(projectRoot, sessionID, { closed: "stalled", checks });
    return goalStatus.cleared(intent.id, "stalled");
  }
  updateIntent(projectRoot, sessionID, { checks });
  return undefined;
}
