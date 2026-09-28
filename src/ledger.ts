import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRuntimePaths, type RuntimePaths } from "./state.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = {
  readonly [key: string]: JsonValue;
};
export type JsonArray = readonly JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type LedgerEvent = JsonObject & {
  readonly type: string;
  readonly timestamp?: string;
};

export type LitGoalInitialization = {
  readonly paths: RuntimePaths;
};

export type LedgerAppendResult = {
  readonly paths: RuntimePaths;
  readonly event: LedgerEvent;
};

export type LedgerRecoveryReport = {
  readonly paths: RuntimePaths;
  readonly removedTempFiles: readonly string[];
};

export type LedgerReadDiagnostic = {
  readonly line: number;
  readonly error: string;
};

export type LenientLedgerReadResult = {
  readonly events: readonly LedgerEvent[];
  readonly skipped: readonly LedgerReadDiagnostic[];
  readonly filePath: string;
};

export type LitGoalOperations = {
  readonly init: () => Promise<LitGoalInitialization>;
  readonly append: (event: unknown) => Promise<LedgerAppendResult>;
  readonly read: () => Promise<readonly LedgerEvent[]>;
  readonly readLenient: () => Promise<LenientLedgerReadResult>;
  readonly recover: () => Promise<LedgerRecoveryReport>;
};

export class LedgerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerParseError";
  }
}

export class LedgerIoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerIoError";
  }
}

const ledgerTempPrefix = "ledger.jsonl.tmp-";
const goalsTempPrefix = "goals.json.tmp-";

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  if (kind === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function parseLedgerEvent(value: unknown): LedgerEvent {
  if (!isRecord(value)) {
    throw new LedgerParseError("Ledger event must be a JSON object.");
  }

  const copy: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isJsonValue(entry)) {
      throw new LedgerParseError(`Ledger event field ${key} is not JSON-serializable.`);
    }
    copy[key] = entry;
  }

  const eventType = copy["type"];
  if (typeof eventType !== "string" || eventType.trim() === "") {
    throw new LedgerParseError("Ledger event type must be a non-empty string.");
  }

  const timestamp = copy["timestamp"];
  if (timestamp !== undefined && typeof timestamp !== "string") {
    throw new LedgerParseError("Ledger event timestamp must be a string when present.");
  }

  return Object.freeze({ ...copy, type: eventType });
}

async function readUtf8IfPresent(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "";
    throw error;
  }
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
}

async function ensureLedgerFile(paths: RuntimePaths): Promise<void> {
  await fs.mkdir(paths.litLoopDir, { recursive: true });
  try {
    await fs.writeFile(paths.ledgerFile, "", { flag: "wx" });
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) return;
    throw error;
  }
}

function parseLedgerLine(line: string, lineNumber: number): LedgerEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new LedgerParseError(`Malformed ledger JSON at line ${lineNumber}: ${reason}`);
  }
  return parseLedgerEvent(parsed);
}

export async function initializeLitGoal(projectRoot: string): Promise<LitGoalInitialization> {
  const paths = createRuntimePaths(projectRoot);
  await fs.mkdir(paths.litLoopDir, { recursive: true });
  await ensureLedgerFile(paths);
  return { paths };
}

export async function recoverLedgerTemps(projectRoot: string): Promise<LedgerRecoveryReport> {
  const paths = createRuntimePaths(projectRoot);
  let entries: readonly string[];
  try {
    entries = await fs.readdir(paths.litLoopDir);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return { paths, removedTempFiles: [] };
    throw error;
  }

  const removedTempFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(ledgerTempPrefix) && !entry.startsWith(goalsTempPrefix)) continue;
    await removeIfPresent(path.join(paths.litLoopDir, entry));
    removedTempFiles.push(entry);
  }

  return { paths, removedTempFiles: Object.freeze(removedTempFiles) };
}

export async function appendLedgerEvent(projectRoot: string, event: unknown): Promise<LedgerAppendResult> {
  const parsed = parseLedgerEvent(event);
  const initialized = await initializeLitGoal(projectRoot);
  await fs.appendFile(initialized.paths.ledgerFile, `${JSON.stringify(parsed)}\n`, "utf8");
  return { paths: initialized.paths, event: parsed };
}

export async function readLedgerEvents(projectRoot: string): Promise<readonly LedgerEvent[]> {
  const paths = createRuntimePaths(projectRoot);
  const raw = await readUtf8IfPresent(paths.ledgerFile);
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  return Object.freeze(lines.map((line, index) => parseLedgerLine(line, index + 1)));
}

export async function readLedgerEventsLenient(projectRoot: string): Promise<LenientLedgerReadResult> {
  const paths = createRuntimePaths(projectRoot);
  const raw = await readUtf8IfPresent(paths.ledgerFile);
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  const events: LedgerEvent[] = [];
  const skipped: LedgerReadDiagnostic[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      events.push(parseLedgerLine(lines[i], i + 1));
    } catch (error) {
      skipped.push({
        line: i + 1,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    events: Object.freeze(events),
    skipped: Object.freeze(skipped),
    filePath: paths.ledgerFile
  };
}

export function createLitGoalOperations(projectRoot: string): LitGoalOperations {
  return Object.freeze({
    init: () => initializeLitGoal(projectRoot),
    append: (event: unknown) => appendLedgerEvent(projectRoot, event),
    read: () => readLedgerEvents(projectRoot),
    readLenient: () => readLedgerEventsLenient(projectRoot),
    recover: () => recoverLedgerTemps(projectRoot)
  });
}

// --- Evidence ledger -------------------------------------------------------
//
// The JSONL stream above is the append-only audit trail: it records that something happened.
// It cannot answer "is this goal done", because it has no criteria, no evidence kinds, and no
// pass/fail. The evidence ledger below adds that layer on top of the same directory: goals.json
// holds the machine state, brief.md holds the human-readable rendering, and every mutation still
// appends one audit line so the trail and the state can never silently disagree.

export const criterionStatuses = ["pending", "in_progress", "blocked", "pass", "fail"] as const;
export type CriterionStatus = (typeof criterionStatuses)[number];

// review_blocked and needs_user_decision exist so a goal stopped in review is distinguishable from
// an active one by status alone, without reading the blocker list.
export const goalStatuses = ["active", "blocked", "review_blocked", "needs_user_decision", "complete"] as const;
export type GoalStatus = (typeof goalStatuses)[number];

export const evidenceKinds = ["red", "green", "scenario", "cleanup", "note"] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

// Steering can redirect or extend a goal. It can never weaken the completion gate.
export const steeringKinds = ["redirect", "add_criterion", "narrow_scope", "reprioritize", "annotate"] as const;
export type SteeringKind = (typeof steeringKinds)[number];

export const evidenceLedgerVersion = 1;

export type EvidenceEntry = {
  readonly kind: EvidenceKind;
  readonly ref: string;
  readonly detail: string;
  readonly at: string;
};

export type Criterion = {
  readonly id: string;
  readonly scenario: string;
  readonly qaChannel: string;
  readonly testRef: string;
  readonly status: CriterionStatus;
  readonly evidence: readonly EvidenceEntry[];
};

export type Checkpoint = {
  readonly id: string;
  readonly at: string;
  readonly summary: string;
  readonly activeCriterion: string;
};

export type SteeringEntry = {
  readonly id: string;
  readonly at: string;
  readonly directive: string;
  readonly kind: SteeringKind;
  readonly criterionId?: string;
};

export type ReviewBlocker = {
  readonly id: string;
  readonly detail: string;
  readonly resolved: boolean;
  readonly needsUserDecision: boolean;
};

export type Goal = {
  readonly id: string;
  readonly sessionId: string;
  readonly objective: string;
  readonly title: string;
  readonly status: GoalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly criteria: readonly Criterion[];
  readonly checkpoints: readonly Checkpoint[];
  readonly steering: readonly SteeringEntry[];
  readonly reviewBlockers: readonly ReviewBlocker[];
};

export type EvidenceLedgerState = {
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly activeGoalId: string;
  readonly goals: readonly Goal[];
};

export type GateVerdict = {
  readonly passed: boolean;
  readonly goalId: string;
  readonly reasons: readonly string[];
};

export type EvidenceLedgerErrorCode =
  | "no_active_goal"
  | "invalid_value"
  | "criterion_not_found"
  | "evidence_overwrite_refused"
  | "steering_weakens_gate"
  | "goal_already_complete"
  | "recovery_required";

export class EvidenceLedgerError extends Error {
  readonly code: EvidenceLedgerErrorCode;
  constructor(code: EvidenceLedgerErrorCode, message: string) {
    super(message);
    this.name = "EvidenceLedgerError";
    this.code = code;
  }
}

// A steering directive may change what the goal is. It may not change what counts as done.
const steeringWeakeningPatterns: readonly RegExp[] = [
  /\bskip\s+(?:the\s+)?(?:test|tests|qa|review|gate|criteria|criterion|evidence)\b/iu,
  /\b(?:no|without)\s+(?:need\s+for\s+)?(?:test|tests|qa|review|evidence|proof)\b/iu,
  /\bdon'?t\s+(?:bother\s+)?(?:run|write|do)?\s*(?:the\s+)?(?:test|tests|qa|review)\b/iu,
  /\bauto[-\s]?complete\b/iu,
  /\bforce[-\s]complete\b/iu,
  /\bmark\s+(?:it\s+)?(?:as\s+)?(?:done|complete|passing|green)\b/iu,
  /\bignore\s+(?:the\s+)?(?:gate|failure|failures|blocker|blockers)\b/iu,
  /\bbypass\s+(?:the\s+)?(?:gate|review|qa)\b/iu
];

let goalsTempCounter = 0;
let evidenceTransactionTempCounter = 0;
const evidenceLockDirectoryName = ".evidence-ledger.lock";
const evidenceTransitionLockDirectoryName = ".evidence-ledger-transition.lock";
const evidenceLockOwnerFileName = "owner.json";
const evidenceTransitionRecoveryFileName = "recovery.json";
const evidenceTransactionFileName = "evidence-transaction.json";
const evidenceLockTimeoutMs = 2_000;
const evidenceStaleLockMs = 30_000;
const evidenceLockOwnerMaxBytes = 4_096;

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function nextId(prefix: string, existing: readonly string[]): string {
  let highest = 0;
  for (const id of existing) {
    const parsed = Number(id.startsWith(prefix) ? id.slice(prefix.length) : Number.NaN);
    if (Number.isInteger(parsed) && parsed > highest) highest = parsed;
  }
  return `${prefix}${highest + 1}`;
}

function requireOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new EvidenceLedgerError("invalid_value", `invalid ${label} '${value}' (valid: ${allowed.join(", ")})`);
  }
  return match;
}

function emptyEvidenceLedgerState(at: string): EvidenceLedgerState {
  return { version: evidenceLedgerVersion, createdAt: at, updatedAt: at, activeGoalId: "", goals: [] };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseEvidenceEntry(value: unknown): EvidenceEntry {
  const record = isRecord(value) ? value : {};
  return {
    kind: requireOneOf(asString(record["kind"], "note"), evidenceKinds, "evidence kind"),
    ref: asString(record["ref"]),
    detail: asString(record["detail"]),
    at: asString(record["at"])
  };
}

function parseCriterion(value: unknown): Criterion {
  const record = isRecord(value) ? value : {};
  const evidence = Array.isArray(record["evidence"])
    ? record["evidence"].map(parseEvidenceEntry)
    : typeof record["evidence"] === "string" && record["evidence"].trim() !== ""
      ? [{ kind: "note" as const, ref: record["evidence"], detail: "", at: "" }]
      : [];
  const rawStatus = asString(record["status"], "pending");
  return {
    id: asString(record["id"]),
    scenario: asString(record["scenario"]),
    qaChannel: asString(record["qaChannel"]),
    testRef: asString(record["testRef"]),
    status: requireOneOf(rawStatus === "passed" ? "pass" : rawStatus === "failed" ? "fail" : rawStatus, criterionStatuses, "criterion status"),
    evidence
  };
}

function parseGoal(value: unknown): Goal {
  const record = isRecord(value) ? value : {};
  const criteria = Array.isArray(record["criteria"]) ? record["criteria"] : [];
  const checkpoints = Array.isArray(record["checkpoints"]) ? record["checkpoints"] : [];
  const steering = Array.isArray(record["steering"]) ? record["steering"] : [];
  const blockers = Array.isArray(record["reviewBlockers"]) ? record["reviewBlockers"] : [];
  const rawStatus = asString(record["status"], "active");
  return {
    id: asString(record["id"]),
    sessionId: asString(record["sessionId"]),
    objective: asString(record["objective"]),
    title: asString(record["title"]),
    status: requireOneOf(rawStatus === "completed" ? "complete" : rawStatus, goalStatuses, "goal status"),
    createdAt: asString(record["createdAt"]),
    updatedAt: asString(record["updatedAt"]),
    criteria: criteria.map(parseCriterion),
    checkpoints: checkpoints.map((entry) => {
      const cp = isRecord(entry) ? entry : {};
      return {
        id: asString(cp["id"]),
        at: asString(cp["at"]),
        summary: asString(cp["summary"]),
        activeCriterion: asString(cp["activeCriterion"])
      };
    }),
    steering: steering.map((entry) => {
      const st = isRecord(entry) ? entry : {};
      return {
        id: asString(st["id"]),
        at: asString(st["at"]),
        directive: asString(st["directive"]),
        kind: requireOneOf(asString(st["kind"], "redirect"), steeringKinds, "steering kind"),
        ...(asString(st["criterionId"]) === "" ? {} : { criterionId: asString(st["criterionId"]) })
      };
    }),
    reviewBlockers: blockers.map((entry) => {
      const bl = isRecord(entry) ? entry : {};
      return {
        id: asString(bl["id"]),
        detail: asString(bl["detail"]),
        resolved: bl["resolved"] === true,
        needsUserDecision: bl["needsUserDecision"] === true
      };
    })
  };
}

function parseEvidenceLedgerState(value: unknown): EvidenceLedgerState {
  if (!isRecord(value)) throw new LedgerParseError("goals.json must contain a JSON object.");
  const goals = Array.isArray(value["goals"]) ? value["goals"] : [];
  return {
    version: typeof value["version"] === "number" ? value["version"] : evidenceLedgerVersion,
    createdAt: asString(value["createdAt"]),
    updatedAt: asString(value["updatedAt"]),
    activeGoalId: asString(value["activeGoalId"]),
    goals: goals.map(parseGoal)
  };
}

export async function readEvidenceLedger(projectRoot: string): Promise<EvidenceLedgerState> {
  const paths = createRuntimePaths(projectRoot);
  const raw = await readUtf8IfPresent(paths.goalsFile);
  if (raw.trim() === "") return emptyEvidenceLedgerState("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new LedgerParseError(`Malformed goals.json: ${reason}`);
  }
  return parseEvidenceLedgerState(parsed);
}

export function renderEvidenceBrief(state: EvidenceLedgerState): string {
  const lines: string[] = ["# LitOpenCode brief", ""];
  lines.push(`Updated: ${state.updatedAt || "(never)"}`);
  lines.push(`Active goal: ${state.activeGoalId || "(none)"}`);
  lines.push("");
  if (state.goals.length === 0) {
    lines.push("No goals recorded yet. Run `litopencode create-goals` to open one.");
    lines.push("");
    return lines.join("\n");
  }

  for (const goal of state.goals) {
    lines.push(`## ${goal.id} — ${goal.title || goal.objective}`);
    lines.push("");
    lines.push(`- status: **${goal.status}**`);
    lines.push(`- session: ${goal.sessionId}`);
    lines.push(`- objective: ${goal.objective}`);
    lines.push("");
    lines.push("### Success criteria");
    lines.push("");
    if (goal.criteria.length === 0) lines.push("- (none recorded)");
    for (const criterion of goal.criteria) {
      lines.push(`- [${criterion.status === "pass" ? "x" : " "}] ${criterion.id} \`${criterion.status}\` — ${criterion.scenario}`);
      for (const entry of criterion.evidence) {
        lines.push(`  - ${entry.kind}: ${entry.ref}${entry.detail === "" ? "" : ` — ${entry.detail}`}`);
      }
      if (criterion.evidence.length === 0) lines.push("  - (no evidence captured)");
    }
    lines.push("");
    if (goal.checkpoints.length > 0) {
      lines.push("### Checkpoints");
      lines.push("");
      for (const cp of goal.checkpoints) {
        lines.push(`- ${cp.id} ${cp.at}${cp.activeCriterion === "" ? "" : ` [${cp.activeCriterion}]`} — ${cp.summary}`);
      }
      lines.push("");
    }
    if (goal.steering.length > 0) {
      lines.push("### Steering");
      lines.push("");
      for (const st of goal.steering) lines.push(`- ${st.id} (${st.kind}) — ${st.directive}`);
      lines.push("");
    }
    if (goal.reviewBlockers.length > 0) {
      lines.push("### Review blockers");
      lines.push("");
      for (const bl of goal.reviewBlockers) {
        const flags = [bl.resolved ? "resolved" : "open", ...(bl.needsUserDecision ? ["needs user decision"] : [])];
        lines.push(`- ${bl.id} (${flags.join(", ")}) — ${bl.detail}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function writeEvidenceLedger(projectRoot: string, state: EvidenceLedgerState): Promise<EvidenceLedgerState> {
  const paths = createRuntimePaths(projectRoot);
  await fs.mkdir(paths.evidenceDir, { recursive: true });
  goalsTempCounter += 1;
  const tempFile = path.join(paths.litLoopDir, `${goalsTempPrefix}${process.pid}-${goalsTempCounter}`);
  try {
    await fs.writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempFile, paths.goalsFile);
  } catch (error) {
    await removeIfPresent(tempFile);
    throw new LedgerIoError(`Failed to write goals.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  await fs.writeFile(paths.briefFile, renderEvidenceBrief(state), "utf8");
  return state;
}

type EvidenceTransaction = {
  readonly version: 1;
  readonly mutationId: string;
  readonly state: EvidenceLedgerState;
  readonly event: LedgerEvent;
};

type EvidenceMutation<T> = {
  readonly state: EvidenceLedgerState;
  readonly event: LedgerEvent;
  readonly result: T;
};

function evidenceMutationPaths(projectRoot: string): {
  lockDir: string;
  ownerFile: string;
  transactionFile: string;
  transitionLockDir: string;
  transitionOwnerFile: string;
  transitionRecoveryFile: string;
} {
  const { litLoopDir } = createRuntimePaths(projectRoot);
  const lockDir = path.join(litLoopDir, evidenceLockDirectoryName);
  const transitionLockDir = path.join(litLoopDir, evidenceTransitionLockDirectoryName);
  return {
    lockDir,
    ownerFile: path.join(lockDir, evidenceLockOwnerFileName),
    transactionFile: path.join(litLoopDir, evidenceTransactionFileName),
    transitionLockDir,
    transitionOwnerFile: path.join(transitionLockDir, evidenceLockOwnerFileName),
    transitionRecoveryFile: path.join(transitionLockDir, evidenceTransitionRecoveryFileName)
  };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}

async function readEvidenceLockOwner(ownerFile: string): Promise<{ token: string; pid: number } | undefined> {
  const stat = await fs.lstat(ownerFile).catch((error: unknown) => {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (stat === undefined) return undefined;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > evidenceLockOwnerMaxBytes) {
    throw new LedgerIoError("Evidence ledger lock owner metadata is unsafe.");
  }
  const raw = await fs.readFile(ownerFile, "utf8").catch((error: unknown) => {
    if (hasErrorCode(error, "ENOENT")) return "";
    throw error;
  });
  if (raw === "") return undefined;
  if (Buffer.byteLength(raw, "utf8") > evidenceLockOwnerMaxBytes) {
    throw new LedgerIoError("Evidence ledger lock owner metadata is unsafe.");
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["token"] !== "string" || !Number.isSafeInteger(parsed["pid"])) return undefined;
    return { token: parsed["token"], pid: parsed["pid"] as number };
  } catch {
    return undefined;
  }
}

async function removeOwnedEvidenceLock(lockDir: string, ownerFile: string, token: string): Promise<void> {
  const owner = await readEvidenceLockOwner(ownerFile);
  if (owner?.token !== token) return;
  const retired = `${lockDir}.released-${randomUUID()}`;
  try {
    await fs.rename(lockDir, retired);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
  await fs.rm(retired, { recursive: true, force: true });
}

async function tryCreateEvidenceLock(lockDir: string, ownerFile: string, token: string): Promise<boolean> {
  const candidateLockDir = path.join(path.dirname(lockDir), `.${path.basename(lockDir)}.candidate-${randomUUID()}`);
  const candidateOwnerFile = path.join(candidateLockDir, path.basename(ownerFile));
  try {
    await fs.mkdir(candidateLockDir, { mode: 0o700 });
    await fs.writeFile(candidateOwnerFile, `${JSON.stringify({ token, pid: process.pid })}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    try {
      await fs.rename(candidateLockDir, lockDir);
      return true;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST") || hasErrorCode(error, "ENOTEMPTY")) return false;
      throw error;
    }
  } finally {
    await fs.rm(candidateLockDir, { recursive: true, force: true });
  }
}

type TransitionOwnerSnapshot =
  | { readonly status: "ownerless" }
  | { readonly status: "invalid" }
  | { readonly status: "valid"; readonly token: string; readonly pid: number };

async function readTransitionOwnerSnapshot(ownerFile: string): Promise<TransitionOwnerSnapshot> {
  const stat = await fs.lstat(ownerFile).catch((error: unknown) => {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (stat === undefined) return { status: "ownerless" };
  const owner = await readEvidenceLockOwner(ownerFile);
  return owner === undefined ? { status: "invalid" } : { status: "valid", ...owner };
}

function sameTransitionOwner(left: TransitionOwnerSnapshot, right: TransitionOwnerSnapshot): boolean {
  if (left.status !== right.status) return false;
  if (left.status !== "valid" || right.status !== "valid") return true;
  return left.token === right.token && left.pid === right.pid;
}

function transitionOwnerGeneration(owner: TransitionOwnerSnapshot): string {
  return owner.status === "valid" ? `${owner.token}:${owner.pid}` : owner.status;
}

function sameEvidenceLockOwner(
  left: { readonly token: string; readonly pid: number } | undefined,
  right: { readonly token: string; readonly pid: number } | undefined
): boolean {
  return left !== undefined && right !== undefined && left.token === right.token && left.pid === right.pid;
}

async function restoreMovedEvidenceRecoveryClaim(movedFile: string, claimFile: string): Promise<void> {
  try {
    await fs.link(movedFile, claimFile);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    if (hasErrorCode(error, "EEXIST")) {
      if ((await readEvidenceLockOwner(claimFile)) === undefined) {
        throw new LedgerIoError("Evidence ledger recovery claim metadata is unsafe.");
      }
    } else {
      throw error;
    }
  }
  await fs.rm(movedFile, { force: true });
}

async function tryRetireDeadEvidenceRecoveryClaim(claimFile: string): Promise<boolean> {
  const observed = await readEvidenceLockOwner(claimFile);
  if (observed === undefined || processIsAlive(observed.pid)) return false;
  const current = await readEvidenceLockOwner(claimFile);
  if (!sameEvidenceLockOwner(observed, current) || current === undefined || processIsAlive(current.pid)) return false;

  const movedFile = `${claimFile}.abandoned-${randomUUID()}`;
  try {
    await fs.rename(claimFile, movedFile);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return true;
    throw error;
  }
  const moved = await readEvidenceLockOwner(movedFile);
  if (sameEvidenceLockOwner(observed, moved) && moved !== undefined && !processIsAlive(moved.pid)) {
    await fs.rm(movedFile, { force: true });
    return true;
  }
  await restoreMovedEvidenceRecoveryClaim(movedFile, claimFile);
  return false;
}

async function removeOwnedEvidenceRecoveryClaim(claimFile: string, token: string): Promise<void> {
  const owner = await readEvidenceLockOwner(claimFile);
  if (owner?.token !== token) return;
  const movedFile = `${claimFile}.released-${randomUUID()}`;
  try {
    await fs.rename(claimFile, movedFile);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
  const moved = await readEvidenceLockOwner(movedFile);
  if (moved?.token === token) {
    await fs.rm(movedFile, { force: true });
    return;
  }
  await restoreMovedEvidenceRecoveryClaim(movedFile, claimFile);
}

async function tryRecoverEvidenceTransitionLock(projectRoot: string): Promise<boolean> {
  const { transitionLockDir, transitionOwnerFile, transitionRecoveryFile } = evidenceMutationPaths(projectRoot);
  const claimToken = randomUUID();
  try {
    await fs.writeFile(transitionRecoveryFile, `${JSON.stringify({ token: claimToken, pid: process.pid })}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return true;
    if (hasErrorCode(error, "EEXIST")) {
      return tryRetireDeadEvidenceRecoveryClaim(transitionRecoveryFile);
    }
    throw error;
  }

  let renamed = false;
  try {
    const observed = await readTransitionOwnerSnapshot(transitionOwnerFile);
    if (observed.status === "invalid") return false;
    if (observed.status === "valid" && processIsAlive(observed.pid)) return false;
    const current = await readTransitionOwnerSnapshot(transitionOwnerFile);
    if (!sameTransitionOwner(observed, current)) return false;
    if (current.status === "valid" && processIsAlive(current.pid)) return false;
    if ((await readEvidenceLockOwner(transitionRecoveryFile))?.token !== claimToken) return false;

    const abandoned = `${transitionLockDir}.abandoned-${randomUUID()}`;
    try {
      await fs.rename(transitionLockDir, abandoned);
      renamed = true;
      await fs.rm(abandoned, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return true;
      throw error;
    }
  } finally {
    if (!renamed) await removeOwnedEvidenceRecoveryClaim(transitionRecoveryFile, claimToken);
  }
}

async function removeOwnedEvidenceTransitionLock(
  lockDir: string,
  ownerFile: string,
  token: string
): Promise<void> {
  const owner = await readEvidenceLockOwner(ownerFile);
  if (owner?.token !== token) return;
  const retired = `${lockDir}.released-${randomUUID()}`;
  try {
    await fs.rename(lockDir, retired);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
  await fs.rm(retired, { recursive: true, force: true });
}

async function withEvidenceTransitionLock<T>(projectRoot: string, operation: (token: string) => Promise<T>): Promise<T> {
  const paths = createRuntimePaths(projectRoot);
  const { transitionLockDir, transitionOwnerFile } = evidenceMutationPaths(projectRoot);
  await fs.mkdir(paths.litLoopDir, { recursive: true });
  let lastProgressAt = Date.now();
  let observedGeneration = "";
  const token = randomUUID();
  while (true) {
    if (await tryCreateEvidenceLock(transitionLockDir, transitionOwnerFile, token)) break;
    const stat = await fs.lstat(transitionLockDir).catch((error: unknown) => {
      if (hasErrorCode(error, "ENOENT")) return undefined;
      throw error;
    });
    if (stat === undefined) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new LedgerIoError("Evidence ledger transition lock path is unsafe.");
    const owner = await readTransitionOwnerSnapshot(transitionOwnerFile);
    const generation = `${stat.dev}:${stat.ino}:${transitionOwnerGeneration(owner)}`;
    if (generation !== observedGeneration) {
      observedGeneration = generation;
      lastProgressAt = Date.now();
    }
    if (owner.status === "ownerless" || (owner.status === "valid" && !processIsAlive(owner.pid))) {
      if (await tryRecoverEvidenceTransitionLock(projectRoot)) continue;
    }
    // Never age-evict this mutex: its owner may be paused immediately before replacing a stale lock.
    if (Date.now() - lastProgressAt >= evidenceLockTimeoutMs) throw new LedgerIoError("Evidence ledger transition lock timed out.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  try {
    return await operation(token);
  } finally {
    await removeOwnedEvidenceTransitionLock(transitionLockDir, transitionOwnerFile, token);
  }
}

async function inspectEvidenceLock(lockDir: string, ownerFile: string): Promise<{
  readonly needsTransition: boolean;
  readonly generation: string;
}> {
  const stat = await fs.lstat(lockDir).catch((error: unknown) => {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (stat === undefined) return { needsTransition: true, generation: "absent" };
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new LedgerIoError("Evidence ledger lock path is unsafe.");
  const owner = await readEvidenceLockOwner(ownerFile);
  const ownerGeneration = owner === undefined ? "ownerless" : `${owner.token}:${owner.pid}`;
  const generation = `${stat.dev}:${stat.ino}:${ownerGeneration}`;
  if (Date.now() - stat.mtimeMs <= evidenceStaleLockMs) return { needsTransition: false, generation };
  return { needsTransition: owner === undefined || !processIsAlive(owner.pid), generation };
}

async function acquireEvidenceLedgerLock(projectRoot: string, token: string): Promise<void> {
  const { lockDir, ownerFile, transitionOwnerFile } = evidenceMutationPaths(projectRoot);
  let lastProgressAt = Date.now();
  let observedGeneration = "";
  while (true) {
    const inspection = await inspectEvidenceLock(lockDir, ownerFile);
    if (inspection.generation !== observedGeneration) {
      observedGeneration = inspection.generation;
      lastProgressAt = Date.now();
    }
    if (!inspection.needsTransition) {
      if (Date.now() - lastProgressAt >= evidenceLockTimeoutMs) throw new LedgerIoError("Evidence ledger lock timed out.");
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    const acquired = await withEvidenceTransitionLock(projectRoot, async (transitionToken) => {
      if (await tryCreateEvidenceLock(lockDir, ownerFile, token)) return true;
      const stat = await fs.lstat(lockDir).catch((error: unknown) => {
        if (hasErrorCode(error, "ENOENT")) return undefined;
        throw error;
      });
      if (stat === undefined) return false;
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new LedgerIoError("Evidence ledger lock path is unsafe.");
      if (Date.now() - stat.mtimeMs <= evidenceStaleLockMs) return false;
      const owner = await readEvidenceLockOwner(ownerFile);
      if (owner !== undefined && processIsAlive(owner.pid)) return false;
      if ((await readEvidenceLockOwner(transitionOwnerFile))?.token !== transitionToken) return false;

      const abandoned = `${lockDir}.abandoned-${randomUUID()}`;
      try {
        await fs.rename(lockDir, abandoned);
        await fs.rm(abandoned, { recursive: true, force: true });
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) throw error;
        return false;
      }
      return tryCreateEvidenceLock(lockDir, ownerFile, token);
    });
    lastProgressAt = Date.now();
    if (acquired) return;
    if (Date.now() - lastProgressAt >= evidenceLockTimeoutMs) throw new LedgerIoError("Evidence ledger lock timed out.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function withEvidenceLedgerLock<T>(projectRoot: string, operation: () => Promise<T>): Promise<T> {
  const { lockDir, ownerFile } = evidenceMutationPaths(projectRoot);
  const token = randomUUID();
  await acquireEvidenceLedgerLock(projectRoot, token);
  try {
    return await operation();
  } finally {
    await withEvidenceTransitionLock(projectRoot, async () => removeOwnedEvidenceLock(lockDir, ownerFile, token));
  }
}

async function ledgerContainsMutation(projectRoot: string, mutationId: string): Promise<boolean> {
  const raw = await readUtf8IfPresent(createRuntimePaths(projectRoot).ledgerFile);
  return raw.split("\n").some((line) => {
    if (line.trim() === "") return false;
    try {
      const parsed: unknown = JSON.parse(line);
      return isRecord(parsed) && parsed["mutationId"] === mutationId;
    } catch {
      return false;
    }
  });
}

async function writeEvidenceTransaction(projectRoot: string, transaction: EvidenceTransaction): Promise<void> {
  const { transactionFile } = evidenceMutationPaths(projectRoot);
  evidenceTransactionTempCounter += 1;
  const tempFile = `${transactionFile}.tmp-${process.pid}-${evidenceTransactionTempCounter}`;
  try {
    await fs.writeFile(tempFile, `${JSON.stringify(transaction, null, 2)}\n`, "utf8");
    await fs.rename(tempFile, transactionFile);
  } catch (error) {
    await removeIfPresent(tempFile);
    throw new LedgerIoError(`Failed to stage evidence transaction: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function commitEvidenceTransaction(projectRoot: string, transaction: EvidenceTransaction): Promise<void> {
  const { transactionFile } = evidenceMutationPaths(projectRoot);
  await writeEvidenceLedger(projectRoot, transaction.state);
  if (!(await ledgerContainsMutation(projectRoot, transaction.mutationId))) {
    await appendLedgerEvent(projectRoot, { ...transaction.event, mutationId: transaction.mutationId });
  }
  await removeIfPresent(transactionFile);
}

async function recoverEvidenceTransaction(projectRoot: string): Promise<void> {
  const { transactionFile } = evidenceMutationPaths(projectRoot);
  const raw = await readUtf8IfPresent(transactionFile);
  if (raw === "") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new LedgerParseError(`Malformed evidence transaction: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || parsed["version"] !== 1 || typeof parsed["mutationId"] !== "string") {
    throw new LedgerParseError("Malformed evidence transaction envelope.");
  }
  const transaction: EvidenceTransaction = {
    version: 1,
    mutationId: parsed["mutationId"],
    state: parseEvidenceLedgerState(parsed["state"]),
    event: parseLedgerEvent(parsed["event"])
  };
  await commitEvidenceTransaction(projectRoot, transaction);
}

async function refusePendingEvidenceTransaction(projectRoot: string): Promise<void> {
  const { transactionFile } = evidenceMutationPaths(projectRoot);
  const stat = await fs.lstat(transactionFile).catch((error: unknown) => {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (stat === undefined) return;
  const detail = stat.isSymbolicLink() || !stat.isFile() ? "unsafe pending evidence transaction" : "pending evidence transaction";
  throw new EvidenceLedgerError(
    "recovery_required",
    `${detail}; status is unavailable until the next mutation recovers it under the ledger lock`
  );
}

async function mutateEvidenceLedger<T>(
  projectRoot: string,
  operation: (state: EvidenceLedgerState) => EvidenceMutation<T> | Promise<EvidenceMutation<T>>
): Promise<T> {
  return withEvidenceLedgerLock(projectRoot, async () => {
    await recoverEvidenceTransaction(projectRoot);
    const mutation = await operation(await readEvidenceLedger(projectRoot));
    const transaction: EvidenceTransaction = {
      version: 1,
      mutationId: randomUUID(),
      state: mutation.state,
      event: mutation.event
    };
    await writeEvidenceTransaction(projectRoot, transaction);
    await commitEvidenceTransaction(projectRoot, transaction);
    return mutation.result;
  });
}

function activeGoalOf(state: EvidenceLedgerState): Goal {
  const goal = state.goals.find((candidate) => candidate.id === state.activeGoalId);
  if (goal === undefined) {
    throw new EvidenceLedgerError("no_active_goal", "no active goal; run create-goals first");
  }
  return goal;
}

function mutableActiveGoalOf(state: EvidenceLedgerState): Goal {
  const goal = activeGoalOf(state);
  if (goal.status === "complete") {
    throw new EvidenceLedgerError("goal_already_complete", `${goal.id} is complete and cannot be mutated or reopened`);
  }
  return goal;
}

function replaceGoal(state: EvidenceLedgerState, goal: Goal, at: string): EvidenceLedgerState {
  return {
    ...state,
    updatedAt: at,
    goals: state.goals.map((candidate) => (candidate.id === goal.id ? { ...goal, updatedAt: at } : candidate))
  };
}

export function evaluateGoalGate(goal: Goal): GateVerdict {
  const reasons: string[] = [];
  if (goal.criteria.length === 0) reasons.push("no success criteria defined");
  for (const criterion of goal.criteria) {
    const kinds = new Set(criterion.evidence.map((entry) => entry.kind));
    if (criterion.status !== "pass") reasons.push(`${criterion.id} status is '${criterion.status}' (need 'pass')`);
    if (!kinds.has("green")) reasons.push(`${criterion.id} missing RED to GREEN proof (green evidence)`);
    if (!kinds.has("scenario")) reasons.push(`${criterion.id} missing real-surface scenario evidence`);
  }
  for (const blocker of goal.reviewBlockers) {
    if (!blocker.resolved) reasons.push(`unresolved review blocker ${blocker.id}: ${blocker.detail}`);
  }
  return { passed: reasons.length === 0, goalId: goal.id, reasons: Object.freeze(reasons) };
}

export function countRecordedEvidence(goal: Goal): number {
  return goal.criteria.reduce((total, criterion) => total + criterion.evidence.length, 0);
}

export type CreateGoalsInput = {
  readonly sessionId: string;
  readonly objective: string;
  readonly title?: string;
  readonly criteria?: readonly string[];
  readonly force?: boolean;
  readonly now?: string;
};

export async function createGoals(projectRoot: string, input: CreateGoalsInput): Promise<Goal> {
  const at = nowIso(input.now);
  return mutateEvidenceLedger(projectRoot, (state) => {
    const existing = state.goals.find((goal) => goal.sessionId === input.sessionId);

    // A completed session is immutable even with --force. A fresh session opens beside it.
    if (existing?.status === "complete") {
      throw new EvidenceLedgerError("goal_already_complete", `${existing.id} is complete and cannot be mutated or reopened`);
    }
    if (existing !== undefined) {
      const recorded = countRecordedEvidence(existing);
      if (recorded > 0 && input.force !== true) {
        throw new EvidenceLedgerError(
          "evidence_overwrite_refused",
          `session '${input.sessionId}' already has ${recorded} recorded evidence entr${recorded === 1 ? "y" : "ies"} on ${existing.id}; ` +
            "pass --force to overwrite it deliberately, or use a fresh --session-id to open new state"
        );
      }
    }

    const criteria = (input.criteria ?? []).map((scenario, index) => ({
      id: `C${index + 1}`,
      scenario,
      qaChannel: "",
      testRef: "",
      status: "pending" as CriterionStatus,
      evidence: []
    }));
    const goal: Goal = {
      id: existing?.id ?? nextId("G", state.goals.map((candidate) => candidate.id)),
      sessionId: input.sessionId,
      objective: input.objective,
      title: input.title ?? "",
      status: "active",
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      criteria,
      checkpoints: [],
      steering: [],
      reviewBlockers: []
    };
    const goals = existing === undefined
      ? [...state.goals, goal]
      : state.goals.map((candidate) => (candidate.id === goal.id ? goal : candidate));
    const next: EvidenceLedgerState = {
      version: evidenceLedgerVersion,
      createdAt: state.createdAt === "" ? at : state.createdAt,
      updatedAt: at,
      activeGoalId: goal.id,
      goals
    };
    return {
      state: next,
      event: {
        type: "goal.created",
        goalId: goal.id,
        sessionId: goal.sessionId,
        criteria: goal.criteria.length,
        overwrote: existing === undefined ? false : true,
        forced: input.force === true,
        timestamp: at
      },
      result: goal
    };
  });
}

export type RecordEvidenceInput = {
  readonly criterionId: string;
  readonly kind: string;
  readonly ref: string;
  readonly detail?: string;
  readonly status?: string;
  readonly now?: string;
};

export async function recordEvidence(projectRoot: string, input: RecordEvidenceInput): Promise<Criterion> {
  const at = nowIso(input.now);
  const kind = requireOneOf(input.kind, evidenceKinds, "evidence kind");
  const status = input.status === undefined ? undefined : requireOneOf(input.status, criterionStatuses, "criterion status");
  return mutateEvidenceLedger(projectRoot, (state) => {
    const goal = mutableActiveGoalOf(state);
    const criterion = goal.criteria.find((candidate) => candidate.id === input.criterionId);
    if (criterion === undefined) {
      throw new EvidenceLedgerError("criterion_not_found", `criterion '${input.criterionId}' not found on ${goal.id}`);
    }

    // Evidence is append-only per criterion. A retry adds a new entry; it never rewrites an old one,
    // so a second attempt cannot erase the proof that the first attempt failed.
    const updated: Criterion = {
      ...criterion,
      status: status ?? criterion.status,
      evidence: [...criterion.evidence, { kind, ref: input.ref, detail: input.detail ?? "", at }]
    };
    const nextGoal: Goal = {
      ...goal,
      criteria: goal.criteria.map((candidate) => (candidate.id === updated.id ? updated : candidate))
    };
    return {
      state: replaceGoal(state, nextGoal, at),
      event: {
        type: "evidence.recorded",
        goalId: goal.id,
        criterionId: updated.id,
        evidenceKind: kind,
        ref: input.ref,
        criterionStatus: updated.status,
        timestamp: at
      },
      result: updated
    };
  });
}

export type CheckpointInput = {
  readonly summary: string;
  readonly activeCriterion?: string;
  readonly now?: string;
};

export async function recordCheckpoint(projectRoot: string, input: CheckpointInput): Promise<Checkpoint> {
  const at = nowIso(input.now);
  return mutateEvidenceLedger(projectRoot, (state) => {
    const goal = mutableActiveGoalOf(state);
    const checkpoint: Checkpoint = {
      id: nextId("CP", goal.checkpoints.map((entry) => entry.id)),
      at,
      summary: input.summary,
      activeCriterion: input.activeCriterion ?? ""
    };
    const nextGoal: Goal = { ...goal, checkpoints: [...goal.checkpoints, checkpoint] };
    return {
      state: replaceGoal(state, nextGoal, at),
      event: {
        type: "checkpoint.recorded",
        goalId: goal.id,
        checkpointId: checkpoint.id,
        activeCriterion: checkpoint.activeCriterion,
        timestamp: at
      },
      result: checkpoint
    };
  });
}

export type SteeringInput = {
  readonly directive: string;
  readonly kind?: string;
  readonly now?: string;
};

export function steeringWeakeningReason(directive: string): string | undefined {
  const match = steeringWeakeningPatterns.find((pattern) => pattern.test(directive));
  return match === undefined ? undefined : `directive matches a completion-weakening pattern (${match.source})`;
}

export async function recordSteering(projectRoot: string, input: SteeringInput): Promise<SteeringEntry> {
  const at = nowIso(input.now);
  const kind = requireOneOf(input.kind ?? "redirect", steeringKinds, "steering kind");
  const reason = steeringWeakeningReason(input.directive);
  if (reason !== undefined) {
    throw new EvidenceLedgerError(
      "steering_weakens_gate",
      `steering refused: ${reason}. Steering can redirect or extend the goal, never weaken the completion gate.`
    );
  }
  return mutateEvidenceLedger(projectRoot, (state) => {
    const goal = mutableActiveGoalOf(state);
    const directive = input.directive.trim();
    const criterionId = kind === "add_criterion"
      ? nextId("C", goal.criteria.map((criterion) => criterion.id))
      : undefined;
    const steering: SteeringEntry = {
      id: nextId("S", goal.steering.map((entry) => entry.id)),
      at,
      directive,
      kind,
      ...(criterionId === undefined ? {} : { criterionId })
    };
    const criteria = criterionId === undefined
      ? goal.criteria
      : [
          ...goal.criteria,
          {
            id: criterionId,
            scenario: directive,
            qaChannel: "",
            testRef: "",
            status: "pending" as CriterionStatus,
            evidence: []
          }
        ];
    const nextGoal: Goal = { ...goal, criteria, steering: [...goal.steering, steering] };
    return {
      state: replaceGoal(state, nextGoal, at),
      event: {
        type: "steering.recorded",
        goalId: goal.id,
        steeringId: steering.id,
        steeringKind: kind,
        ...(criterionId === undefined ? {} : { addedCriterionId: criterionId }),
        timestamp: at
      },
      result: steering
    };
  });
}

export type ReviewBlockerInput = {
  readonly detail: string;
  readonly needsUserDecision?: boolean;
  readonly now?: string;
};

export async function recordReviewBlocker(projectRoot: string, input: ReviewBlockerInput): Promise<ReviewBlocker> {
  const at = nowIso(input.now);
  return mutateEvidenceLedger(projectRoot, (state) => {
    const goal = mutableActiveGoalOf(state);
    const blocker: ReviewBlocker = {
      id: nextId("B", goal.reviewBlockers.map((entry) => entry.id)),
      detail: input.detail.trim(),
      resolved: false,
      needsUserDecision: input.needsUserDecision === true
    };
    const nextGoal: Goal = {
      ...goal,
      status: blocker.needsUserDecision ? "needs_user_decision" : "review_blocked",
      reviewBlockers: [...goal.reviewBlockers, blocker]
    };
    return {
      state: replaceGoal(state, nextGoal, at),
      event: {
        type: "review.blocked",
        goalId: goal.id,
        blockerId: blocker.id,
        goalStatus: nextGoal.status,
        needsUserDecision: blocker.needsUserDecision,
        timestamp: at
      },
      result: blocker
    };
  });
}

// Recording a blocker without a way to clear it would make review_blocked a terminal state and the
// completion gate unreachable forever, so resolution belongs to the same verb that opens a blocker.
export async function resolveReviewBlocker(
  projectRoot: string,
  input: { readonly blockerId: string; readonly now?: string }
): Promise<ReviewBlocker> {
  const at = nowIso(input.now);
  return mutateEvidenceLedger(projectRoot, (state) => {
    const goal = mutableActiveGoalOf(state);
    const blocker = goal.reviewBlockers.find((candidate) => candidate.id === input.blockerId);
    if (blocker === undefined) {
      throw new EvidenceLedgerError("criterion_not_found", `review blocker '${input.blockerId}' not found on ${goal.id}`);
    }

    const resolved: ReviewBlocker = { ...blocker, resolved: true };
    const reviewBlockers = goal.reviewBlockers.map((candidate) => (candidate.id === resolved.id ? resolved : candidate));
    const stillBlocked = reviewBlockers.some((candidate) => !candidate.resolved);
    const nextGoal: Goal = {
      ...goal,
      status: stillBlocked ? goal.status : "active",
      reviewBlockers
    };
    return {
      state: replaceGoal(state, nextGoal, at),
      event: {
        type: "review.blocker.resolved",
        goalId: goal.id,
        blockerId: resolved.id,
        goalStatus: nextGoal.status,
        timestamp: at
      },
      result: resolved
    };
  });
}

export type CompleteGoalsResult = {
  readonly completed: boolean;
  readonly goalId: string;
  readonly reasons: readonly string[];
};

export async function completeGoals(projectRoot: string, options: { readonly now?: string } = {}): Promise<CompleteGoalsResult> {
  const at = nowIso(options.now);
  return mutateEvidenceLedger<CompleteGoalsResult>(projectRoot, (state) => {
    const goal = mutableActiveGoalOf(state);
    const verdict = evaluateGoalGate(goal);
    if (!verdict.passed) {
      const result: CompleteGoalsResult = { completed: false, goalId: goal.id, reasons: verdict.reasons };
      const event: LedgerEvent = {
        type: "goal.completion.refused",
        goalId: goal.id,
        reasons: verdict.reasons.length,
        timestamp: at
      };
      return {
        state,
        event,
        result
      };
    }

    const result: CompleteGoalsResult = { completed: true, goalId: goal.id, reasons: [] };
    const event: LedgerEvent = { type: "goal.completed", goalId: goal.id, timestamp: at };
    return {
      state: replaceGoal(state, { ...goal, status: "complete" }, at),
      event,
      result
    };
  });
}

export type EvidenceLedgerStatus = {
  readonly activeGoalId: string;
  readonly goals: readonly Goal[];
  readonly gate?: GateVerdict;
};

export async function readEvidenceLedgerStatus(projectRoot: string): Promise<EvidenceLedgerStatus> {
  await refusePendingEvidenceTransaction(projectRoot);
  const state = await readEvidenceLedger(projectRoot);
  await refusePendingEvidenceTransaction(projectRoot);
  const goal = state.goals.find((candidate) => candidate.id === state.activeGoalId);
  return {
    activeGoalId: state.activeGoalId,
    goals: state.goals,
    ...(goal === undefined ? {} : { gate: evaluateGoalGate(goal) })
  };
}
