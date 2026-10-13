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
import { readSkillUse, skillChips, type SkillChip, type SkillUse } from "./mission-skills.ts";

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
    return { status: work.status, iterations: work.iterations, ...(plan === undefined ? {} : { plan }) };
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

export type CardInput = { readonly chips: readonly SkillChip[]; readonly busy: boolean; readonly contextPercent: number | null; readonly branch?: string };

/**
 * What the band card shows beside the mission: the session's skill chips, whether a turn is running,
 * context use and git branch. OpenCode keeps each session's last `session.status` ({ type: "busy" },
 * "retry" or "idle"); a session it has not seen run has none, which counts as not running.
 */
export function readCardInput(state: MissionStateSource, sessionID: string): CardInput {
  const messages = state.session.messages(sessionID);
  const uses: SkillUse[] = [];
  let since: number | undefined;
  for (const message of messages) {
    const at = num(message.time?.created);
    if (message.role === "user") since = at;
    for (const part of state.part(message.id)) {
      const use = readSkillUse(part, at);
      if (use !== undefined) uses.push(use);
    }
  }
  const status = state.session.status(sessionID)?.type;
  const busy = status === "busy" || status === "retry";
  const branch = state.vcs?.branch?.trim();
  return {
    chips: skillChips(uses, { since, busy }),
    busy,
    contextPercent: contextPercent(state, messages),
    ...(branch === undefined || branch === "" ? {} : { branch })
  };
}
