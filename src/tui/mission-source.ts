// Gathers the mission input from the OpenCode TUI state and the project's own records: the evidence
// ledger, the bounded work record with its plan checklist, and litresearch run folders. The state
// shape is the slice of `api.state` the plugin reads, so tests can pass a plain object.
import fs from "node:fs";
import path from "node:path";
import {
  planChecklist,
  readLitMark,
  readWorkState,
  type LitMark,
  type LiveStep,
  type MissionInput,
  type ResearchInput,
  type ResearchStage,
  type TodoInput,
  type WorkInput
} from "./mission-model.ts";
import { isLaneResult, isReviewLane, type LaneReports, type ReviewLane, type LaneResult } from "./mission-looks.ts";
import { readSkillUse, skillChips, type SkillChip, type SkillUse } from "./mission-skills.ts";
import { isRealCount, type ThreadRow, type ThreadSource } from "./mission-threads.ts";
import { readSiblingStacksSync, readStackSync, type WorkflowStack } from "../workflow-stack.ts";
import { readLivenessSync, type LivenessRecord } from "../session-liveness.ts";

const ledgerByteLimit = 1024 * 1024;

type MessageLike = {
  readonly id: string;
  readonly role: string;
  readonly agent?: unknown;
  readonly time?: { readonly created?: unknown };
  readonly providerID?: unknown;
  readonly modelID?: unknown;
  readonly tokens?: { readonly input?: unknown; readonly output?: unknown; readonly reasoning?: unknown; readonly cache?: { readonly read?: unknown; readonly write?: unknown } };
};

export type MissionStateSource = {
  readonly path: { readonly worktree?: string; readonly directory?: string };
  readonly vcs?: { readonly branch?: string };
  readonly provider: ReadonlyArray<{ readonly id: string; readonly models: Readonly<Record<string, { readonly limit?: { readonly context?: number } }>> }>;
  readonly session: {
    messages(sessionID: string): ReadonlyArray<MessageLike>;
    todo(sessionID: string): ReadonlyArray<TodoInput>;
    status(sessionID: string): { readonly type: string; readonly message?: string } | undefined;
    permission(sessionID: string): ReadonlyArray<unknown>;
    question(sessionID: string): ReadonlyArray<unknown>;
  };
  part(messageID: string): ReadonlyArray<{ readonly type?: string; readonly tool?: unknown; readonly state?: unknown; readonly metadata?: unknown }>;
};

/** The same root the server plugin uses: the worktree unless it is the filesystem root, else the directory. */
export function missionProjectRoot(paths: MissionStateSource["path"]): string | undefined {
  const worktree = paths.worktree?.trim();
  if (worktree !== undefined && worktree !== "" && worktree !== "/") return worktree;
  const directory = paths.directory?.trim();
  return directory === undefined || directory === "" ? undefined : directory;
}

type FileCache = { readonly file: string; readonly stamp: string; readonly value: unknown };

/**
 * A reader for one regular file that refuses symbolic links and files over 1 MiB, cached on mtime and
 * size so a call on every refresh costs one lstat.
 */
function createFileReader<T>(parse: (text: string) => T): (file: string) => T | undefined {
  let cache: FileCache | undefined;
  return (file) => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file);
    } catch {
      return undefined;
    }
    if (!stat.isFile() || stat.size > ledgerByteLimit) return undefined;
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    if (cache?.file === file && cache.stamp === stamp) return cache.value as T | undefined;
    let value: T | undefined;
    try {
      value = parse(fs.readFileSync(file, "utf8"));
    } catch {
      value = undefined;
    }
    cache = { file, stamp, value };
    return value;
  };
}

function litLoopDir(root: string): string {
  return path.join(root, ".litopencode", "litgoal", "lit-loop");
}

/** Reads goals.json under `root`, refusing symbolic links and oversized files. */
export function createLedgerReader(): (root: string | undefined) => unknown {
  const read = createFileReader<unknown>((text) => JSON.parse(text));
  return (root) => (root === undefined ? undefined : read(path.join(litLoopDir(root), "goals.json")));
}

/**
 * Reads this session's bounded work from work-schema-3.json and the checklist of the plan it names.
 * The plan must be a regular file inside `root`; anything else leaves the checklist out.
 */
export function createWorkReader(): (root: string | undefined, sessionID: string) => WorkInput | undefined {
  const readState = createFileReader<unknown>((text) => JSON.parse(text));
  const readPlan = createFileReader(planChecklist);
  return (root, sessionID) => {
    if (root === undefined) return undefined;
    const work = readWorkState(readState(path.join(litLoopDir(root), "work-schema-3.json")), sessionID);
    if (work === undefined) return undefined;
    const inside = work.planPath !== "" && path.isAbsolute(work.planPath) && !path.relative(path.resolve(root), work.planPath).startsWith("..");
    const plan = inside ? readPlan(work.planPath) : undefined;
    return { status: work.status, iterations: work.iterations, ...(plan === undefined ? {} : { plan }), ...(work.boundary === true ? { boundary: true } : {}) };
  };
}

function lstatOrUndefined(file: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(file);
  } catch {
    return undefined;
  }
}

function readSmall(file: string, stat: fs.Stats | undefined): string {
  if (stat === undefined || !stat.isFile() || stat.size > ledgerByteLimit) return "";
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

const verifiedWords = new Set(["verified", "abstained", "unresolved", "refuted"]);

/**
 * What a litresearch run folder says so far. The skill keeps a root-owned journal.md, an append-only
 * claim-graph.jsonl and a final report.md; the stage is read from them: a report is synthesis, a
 * claim with a gate result is verify, a journal whose last heading names EXPAND is expand, claims are
 * a wave (numbered by the highest `wave` field or `## Wave` heading), and nothing yet is decompose.
 */
export function readResearchRun(journal: string, claimGraph: string, reported: boolean, touchedAt: number): ResearchInput {
  let claims = 0;
  let verified = 0;
  let gated = false;
  let waveField = 0;
  for (const line of claimGraph.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof row !== "object" || row === null) continue;
    claims += 1;
    const record = row as Record<string, unknown>;
    if (typeof record.wave === "number" && Number.isFinite(record.wave)) waveField = Math.max(waveField, Math.floor(record.wave));
    const verdict = [record.gate, record.status, record.verdict].find((value) => typeof value === "string" && verifiedWords.has(value.toLowerCase()));
    if (verdict !== undefined) {
      gated = true;
      if (String(verdict).toLowerCase() === "verified") verified += 1;
    }
  }
  const headings = journal.split(/\r?\n/u).filter((line) => /^#{1,6}\s/u.test(line)).map((line) => line.replace(/^#+\s*/u, "").toLowerCase());
  const waveHeadings = headings.filter((heading) => /^wave\b/u.test(heading)).length;
  const last = headings.at(-1) ?? "";
  const waves = Math.max(waveField, waveHeadings, claims > 0 ? 1 : 0);
  const stage: ResearchStage = reported || /^synth/u.test(last)
    ? "synthesis"
    : gated || /^verif/u.test(last)
      ? "verify"
      : /^expand\b/u.test(last)
        ? "expand"
        : waves > 0 ? "wave" : "decompose";
  return { stage, waves, claims, verified, reported, touchedAt };
}

/**
 * The most recently written run under .litopencode/litgoal/lit-loop/research/, or undefined when
 * there is none. Symbolic links are skipped and only the three known files are read.
 */
export function readLatestResearchRun(root: string | undefined): ResearchInput | undefined {
  if (root === undefined) return undefined;
  const base = path.join(litLoopDir(root), "research");
  const baseStat = lstatOrUndefined(base);
  if (baseStat === undefined || !baseStat.isDirectory()) return undefined;
  let latest: { readonly dir: string; readonly touchedAt: number; readonly files: Readonly<Record<string, fs.Stats | undefined>> } | undefined;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    const files = Object.fromEntries(["journal.md", "claim-graph.jsonl", "report.md"].map((name) => [name, lstatOrUndefined(path.join(dir, name))]));
    const touchedAt = Math.max(lstatOrUndefined(dir)?.mtimeMs ?? 0, ...Object.values(files).map((stat) => stat?.mtimeMs ?? 0));
    if (latest === undefined || touchedAt > latest.touchedAt) latest = { dir, touchedAt, files };
  }
  if (latest === undefined) return undefined;
  const report = latest.files["report.md"];
  return readResearchRun(
    readSmall(path.join(latest.dir, "journal.md"), latest.files["journal.md"]),
    readSmall(path.join(latest.dir, "claim-graph.jsonl"), latest.files["claim-graph.jsonl"]),
    report !== undefined && report.isFile() && report.size > 0,
    latest.touchedAt
  );
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function contextPercent(state: MissionStateSource, messages: ReadonlyArray<MessageLike>): number | null {
  const last = [...messages].reverse().find((message) => message.role === "assistant" && num(message.tokens?.output) > 0);
  if (last === undefined) return null;
  const tokens = num(last.tokens?.input) + num(last.tokens?.output) + num(last.tokens?.reasoning) + num(last.tokens?.cache?.read) + num(last.tokens?.cache?.write);
  const limit = state.provider.find((provider) => provider.id === last.providerID)?.models[String(last.modelID)]?.limit?.context;
  return typeof limit === "number" && limit > 0 ? (tokens / limit) * 100 : null;
}

/**
 * The tool the session's latest assistant message is running: its name and `time.start` from the
 * running tool part. The input is never read.
 */
export function readLiveStep(state: MissionStateSource, messages: ReadonlyArray<MessageLike>): LiveStep | undefined {
  const last = [...messages].reverse().find((message) => message.role === "assistant");
  if (last === undefined) return undefined;
  let live: LiveStep | undefined;
  for (const part of state.part(last.id)) {
    if (part.type !== "tool" || typeof part.tool !== "string" || typeof part.state !== "object" || part.state === null) continue;
    const toolState = part.state as { readonly status?: unknown; readonly time?: { readonly start?: unknown } };
    const start = toolState.time?.start;
    if (toolState.status !== "running" || typeof start !== "number" || !Number.isFinite(start)) continue;
    if (live === undefined || start >= live.start) live = { tool: part.tool, start };
  }
  return live;
}

export type MissionRecords = { readonly work?: WorkInput; readonly research?: ResearchInput };

export function readMissionInput(state: MissionStateSource, sessionID: string, ledger: unknown, now: number, records: MissionRecords = {}): MissionInput {
  const messages = state.session.messages(sessionID);
  const marks: LitMark[] = [];
  let agent: string | undefined;
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (typeof message.agent === "string") agent = message.agent;
    const at = num(message.time?.created);
    for (const part of state.part(message.id)) {
      const mark = readLitMark(part.metadata, at);
      if (mark !== undefined) marks.push(mark);
    }
  }
  const status = state.session.status(sessionID);
  const live = readLiveStep(state, messages);
  return {
    marks,
    ...(agent === undefined ? {} : { agent }),
    todos: state.session.todo(sessionID),
    ledger,
    ...(status === undefined ? {} : { sessionStatus: status.type }),
    ...(status?.type === "retry" && typeof status.message === "string" ? { retryMessage: status.message } : {}),
    pendingPermissions: state.session.permission(sessionID).length,
    pendingQuestions: state.session.question(sessionID).length,
    contextPercent: contextPercent(state, messages),
    ...(records.work === undefined ? {} : { work: records.work }),
    ...(records.research === undefined ? {} : { research: records.research }),
    ...(live === undefined ? {} : { live }),
    now
  };
}

export type CardInput = {
  readonly chips: readonly SkillChip[];
  readonly busy: boolean;
  readonly contextPercent: number | null;
  readonly branch?: string;
  /** Two or more lanes of work, from the stack, `task` calls and sibling sessions. */
  readonly threads?: readonly ThreadRow[];
  /** Another session here moved lately, so an idle card can name `lit adhd`. */
  readonly earlier?: boolean;
  /** The lanes review-work has reported since its latest start; present once a review ran here. */
  readonly lanes?: LaneReports;
  /** OpenCode holds a permission request or a question for this session. */
  readonly asked?: boolean;
  /** The last message is the user's. */
  readonly userSpokeLast?: boolean;
  /** The last reply opens with `BLOCKED:`. */
  readonly blockedReply?: boolean;
};

/** A completed `review-work` call with action `lane`: one lane's reported result. */
export function readLaneReport(part: unknown): { readonly lane: ReviewLane; readonly result: LaneResult } | undefined {
  if (!isRecord(part) || part.type !== "tool" || part.tool !== "review-work" || !isRecord(part.state) || part.state.status !== "completed") return undefined;
  const input = isRecord(part.state.input) ? part.state.input : {};
  if (input.action !== "lane" || !isReviewLane(input.lane) || !isLaneResult(input.result)) return undefined;
  return { lane: input.lane, result: input.result };
}

/**
 * True when the reply's first line of prose opens with `BLOCKED:`. The ignition mark comes first on the
 * host (a fenced LIT block from experimental.text.complete, and the model's `LIT IGNITED` line), so those
 * lines and blank ones are passed over; anything else ends the search.
 */
export function opensBlocked(parts: readonly unknown[]): boolean {
  const text = parts.map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "")).join("\n");
  let fenced = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || trimmed === "" || trimmed.includes("LIT IGNITED")) continue;
    return /^BLOCKED:/u.test(trimmed);
  }
  return false;
}

/**
 * What the band card shows beside the mission: the session's skill chips, whether a turn is running,
 * context use and git branch. OpenCode keeps each session's last `session.status` ({ type: "busy" },
 * "retry" or "idle"); a session it has not seen run has none, which counts as not running.
 */
export function readCardInput(state: MissionStateSource, sessionID: string): CardInput {
  const messages = state.session.messages(sessionID);
  const uses: SkillUse[] = [];
  let since: number | undefined;
  // A new review start clears the lanes, so the border shows only this review's reports.
  let lanes: Partial<Record<ReviewLane, LaneResult>> | undefined;
  for (const message of messages) {
    const at = num(message.time?.created);
    if (message.role === "user") since = at;
    for (const part of state.part(message.id)) {
      const report = readLaneReport(part);
      if (report !== undefined) {
        lanes = { ...lanes, [report.lane]: report.result };
        continue;
      }
      const use = readSkillUse(part, at);
      if (use !== undefined) uses.push(use);
      const action = isRecord(part) && isRecord(part.state) && isRecord(part.state.input) ? part.state.input.action : undefined;
      if (use?.name === "review-work" && action !== "status" && action !== "lane") lanes = {};
    }
  }
  const status = state.session.status(sessionID)?.type;
  const busy = status === "busy" || status === "retry";
  const branch = state.vcs?.branch?.trim();
  const last = messages.at(-1);
  const asked = state.session.permission(sessionID).length > 0 || state.session.question(sessionID).length > 0;
  return {
    chips: skillChips(uses, { since, busy }),
    busy,
    contextPercent: contextPercent(state, messages),
    ...(branch === undefined || branch === "" ? {} : { branch }),
    ...(lanes === undefined ? {} : { lanes }),
    ...(asked ? { asked } : {}),
    ...(last?.role === "user" ? { userSpokeLast: true } : {}),
    ...(last?.role === "assistant" && opensBlocked(state.part(last.id)) ? { blockedReply: true } : {})
  };
}

export const earlierWorkWindowMs = 7 * 24 * 60 * 60_000;
const siblingFreshMs = 15 * 60_000;
const siblingMax = 6;
const taskLingerMs = 30_000;
const recentAssistantMessages = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countsOf(done: number | undefined, total: number | undefined): { readonly done?: number; readonly total?: number } {
  return isRealCount(done, total) ? { done, total } : {};
}

function taskSources(state: MissionStateSource, sessionID: string, now: number): { readonly sources: ThreadSource[]; readonly children: ReadonlySet<string> } {
  const sources: ThreadSource[] = [];
  const children = new Set<string>();
  const assistants = state.session.messages(sessionID).filter((message) => message.role === "assistant").slice(-recentAssistantMessages);
  for (const message of assistants) {
    for (const part of state.part(message.id)) {
      if (part.type !== "tool" || part.tool !== "task" || !isRecord(part.state)) continue;
      const toolState = part.state;
      const status = toolState.status;
      const time = isRecord(toolState.time) ? toolState.time : {};
      const start = typeof time.start === "number" ? time.start : undefined;
      const end = typeof time.end === "number" ? time.end : undefined;
      if (status !== "running" && status !== "completed" && status !== "error") continue;
      if (status !== "running" && (end === undefined || now - end > taskLingerMs)) continue;
      const input = isRecord(toolState.input) ? toolState.input : {};
      const metadata = isRecord(toolState.metadata) ? toolState.metadata : {};
      const child = typeof metadata.sessionId === "string" ? metadata.sessionId : undefined;
      if (child !== undefined) children.add(child);
      const todos = child === undefined ? [] : state.session.todo(child).filter((todo) => todo.status !== "cancelled");
      const done = todos.filter((todo) => todo.status === "completed").length;
      const name = typeof input.description === "string" && input.description.trim() !== "" ? input.description.trim() : typeof input.subagent_type === "string" ? input.subagent_type : "subagent";
      // A running task last moved when its own session did; its start time alone would read a long, busy run as idle.
      const moved = child === undefined ? undefined : lastActivity(state, child);
      sources.push({
        kind: "task",
        name,
        status: status === "running" ? "working" : status === "completed" ? "done" : "failed",
        ...countsOf(done, todos.length),
        ...(start === undefined ? {} : { startedAt: start }),
        touchedAt: end ?? (start === undefined && moved === undefined ? now : Math.max(start ?? 0, moved ?? 0))
      });
    }
  }
  return { sources, children };
}

/** The latest time any message of a session was created or completed, if it has one. */
function lastActivity(state: MissionStateSource, sessionID: string): number | undefined {
  let latest: number | undefined;
  for (const message of state.session.messages(sessionID)) {
    for (const at of [message.time?.created, (message.time as { readonly completed?: unknown } | undefined)?.completed]) {
      if (typeof at === "number" && Number.isFinite(at) && (latest === undefined || at > latest)) latest = at;
    }
  }
  return latest;
}

function stackSources(stack: WorkflowStack | undefined): ThreadSource[] {
  return (stack?.frames ?? []).map((frame) => ({
    kind: "stack" as const,
    name: frame.skill,
    status: frame.status === "active" ? ("working" as const) : ("paused" as const),
    ...countsOf(frame.done, frame.total),
    ...(frame.phase === undefined ? {} : { phase: frame.phase }),
    touchedAt: frame.at
  }));
}

/** `<skill> · <herdr pane>` when the session runs in a herdr pane, else the last four characters of its id. */
function siblingName(skill: string, sessionID: string, liveness: LivenessRecord | undefined): string {
  return `${skill} · ${liveness?.herdrPane ?? sessionID.slice(-4)}`;
}

/** A sibling's own liveness record settles its status: ended reads done, idle reads idle (a held frame stays paused). */
function siblingSource(stack: WorkflowStack, liveness: LivenessRecord | undefined, finishedAt: number | undefined): ThreadSource {
  const top = stack.frames.find((frame) => frame.status === "active") ?? stack.frames[stack.frames.length - 1];
  const endedAt = liveness?.state === "ended" ? Date.parse(liveness.at) : finishedAt;
  const status = endedAt !== undefined ? "done" : top.status !== "active" ? "paused" : liveness?.state === "idle" ? "idle" : "working";
  return {
    kind: "session",
    name: siblingName(top.skill, stack.sessionID, liveness),
    status,
    ...countsOf(top.done, top.total),
    ...(top.phase === undefined ? {} : { phase: top.phase }),
    touchedAt: Math.max(stack.updatedAt, liveness === undefined ? 0 : Date.parse(liveness.at)),
    ...(endedAt === undefined ? {} : { doneAt: endedAt }),
    ...(liveness === undefined && finishedAt === undefined ? {} : { settled: true })
  };
}

/** Another session's start-work run that completed, with when, read from the bounded work record. */
function finishedWork(root: string, sessionID: string, now: number): { readonly sessionID: string; readonly at: number } | undefined {
  const file = path.join(litLoopDir(root), "work-schema-3.json");
  const stat = lstatOrUndefined(file);
  if (stat === undefined || !stat.isFile() || stat.size > ledgerByteLimit) return undefined;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(raw) || raw.schemaVersion !== 3 || raw.status !== "completed" || typeof raw.sessionID !== "string" || raw.sessionID === sessionID) return undefined;
    const at = typeof raw.updatedAt === "string" ? Date.parse(raw.updatedAt) : Number.NaN;
    return Number.isFinite(at) && at <= now && now - at <= siblingFreshMs ? { sessionID: raw.sessionID, at } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The lanes beside this session's own mission: its workflow stack frames, its running `task` calls and
 * the stacks of other sessions in the workspace that moved in the last fifteen minutes, read with their
 * liveness records. Another session's completed start-work run shows as done. Only counts that are real
 * totals are carried; the input of a tool call is read for its description alone.
 */
export function readThreadSources(state: MissionStateSource, sessionID: string, root: string | undefined, now: number): ThreadSource[] {
  const tasks = taskSources(state, sessionID, now);
  if (root === undefined) return tasks.sources;
  const siblings = readSiblingStacksSync(root, sessionID, { now, freshMs: siblingFreshMs, max: siblingMax }).filter((stack) => !tasks.children.has(stack.sessionID));
  const finished = finishedWork(root, sessionID, now);
  const others = siblings.map((stack) => siblingSource(stack, readLivenessSync(root, stack.sessionID), stack.sessionID === finished?.sessionID ? finished.at : undefined));
  if (finished !== undefined && !siblings.some((stack) => stack.sessionID === finished.sessionID) && !tasks.children.has(finished.sessionID)) {
    others.push({ kind: "session", name: siblingName("start-work", finished.sessionID, readLivenessSync(root, finished.sessionID)), status: "done", touchedAt: finished.at, doneAt: finished.at, settled: true });
  }
  return [...stackSources(readStackSync(root, sessionID)), ...tasks.sources, ...others];
}

/**
 * Whether earlier work exists for the band's idle hint and the one suggestion: another session here
 * touched its workflow stack within `withinMs`.
 */
/** When the session's last message and its last user prompt were created, from the reactive store. */
export function messageTimes(state: MissionStateSource, sessionID: string): { readonly lastAt?: number; readonly lastPromptAt?: number } {
  let lastAt: number | undefined;
  let lastPromptAt: number | undefined;
  for (const message of state.session.messages(sessionID)) {
    const created = message.time?.created;
    if (typeof created !== "number") continue;
    if (lastAt === undefined || created > lastAt) lastAt = created;
    if (message.role === "user" && (lastPromptAt === undefined || created > lastPromptAt)) lastPromptAt = created;
  }
  return { ...(lastAt === undefined ? {} : { lastAt }), ...(lastPromptAt === undefined ? {} : { lastPromptAt }) };
}

/** The way back in is offered after this long without a message in the session. */
export const adhdBreakMs = 30 * 60_000;

/** The idle card names lit adhd in a fresh session or after a break, only when earlier work exists. */
export function wayBackDue(lastActivityAt: number | undefined, now: number, earlier: boolean): boolean {
  return earlier && (lastActivityAt === undefined || now - lastActivityAt >= adhdBreakMs);
}

function localDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** At most one start suggestion per workspace per local day; records the day when it answers true. */
export function adhdSuggestDue(days: Map<string, string>, root: string, now: number): boolean {
  const day = localDay(now);
  if (days.get(root) === day) return false;
  days.set(root, day);
  return true;
}

export function hasEarlierWork(root: string | undefined, sessionID: string, now: number, withinMs: number): boolean {
  return root !== undefined && readSiblingStacksSync(root, sessionID, { now, freshMs: withinMs, max: 1 }).length > 0;
}
