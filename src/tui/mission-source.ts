// Gathers the mission input from the OpenCode TUI state and the project's evidence ledger. The state
// shape is the slice of `api.state` the plugin reads, so tests can pass a plain object.
import fs from "node:fs";
import path from "node:path";
import { readLitMark, type LitMark, type MissionInput, type TodoInput } from "./mission-model.ts";
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
  part(messageID: string): ReadonlyArray<{ readonly type?: string; readonly metadata?: unknown }>;
};

/** The same root the server plugin uses: the worktree unless it is the filesystem root, else the directory. */
export function missionProjectRoot(paths: MissionStateSource["path"]): string | undefined {
  const worktree = paths.worktree?.trim();
  if (worktree !== undefined && worktree !== "" && worktree !== "/") return worktree;
  const directory = paths.directory?.trim();
  return directory === undefined || directory === "" ? undefined : directory;
}

type LedgerCache = { readonly file: string; readonly stamp: string; readonly value: unknown };

/**
 * Reads goals.json under `root`, refusing symbolic links and oversized files. The result is cached
 * on mtime and size, so calling it on every refresh costs one lstat.
 */
export function createLedgerReader(): (root: string | undefined) => unknown {
  let cache: LedgerCache | undefined;
  return (root) => {
    if (root === undefined) return undefined;
    const file = path.join(root, ".litopencode", "litgoal", "lit-loop", "goals.json");
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file);
    } catch {
      return undefined;
    }
    if (!stat.isFile() || stat.size > ledgerByteLimit) return undefined;
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    if (cache?.file === file && cache.stamp === stamp) return cache.value;
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      value = undefined;
    }
    cache = { file, stamp, value };
    return value;
  };
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

export function readMissionInput(state: MissionStateSource, sessionID: string, ledger: unknown, now: number): MissionInput {
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
    now
  };
}

export type CardInput = { readonly chips: readonly SkillChip[]; readonly contextPercent: number | null; readonly branch?: string };

/** What the band card shows beside the mission: the session's skill chips, context use and git branch. */
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
  const branch = state.vcs?.branch?.trim();
  return {
    chips: skillChips(uses, { since, busy: status === "busy" || status === "retry" }),
    contextPercent: contextPercent(state, messages),
    ...(branch === undefined || branch === "" ? {} : { branch })
  };
}
