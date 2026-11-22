// The ultra-brainstorm run guard. The skill text asks the parent model to run every lane the user approved,
// but a long run outgrows one context and the model stops on its own ("the ideas repeat, 460 more is not
// practical"). Prose alone did not change that, so the plugin keeps the authoritative count: the estimator's
// `{"answer":"launch","lanes":N}` arms a run, each `lit-ideator` task counts one lane, and when the root
// session goes idle short of N (or with every lane sent but no judge), it sends one continuation that names
// the next lane and the files to re-read. Two idles in a row with no new lane pause the run; a user message
// clears it unless it is a continue word. The state is one small file per session, so a restart keeps it.
import fs from "node:fs/promises";
import path from "node:path";
import type { SessionLookup } from "./session-lineage.ts";

export const brainstormNudgePrefix = "LitOpenCode ultra-brainstorm guard:";

const perReducer = 30;
const maxLanes = 900;
const stallLimit = 2;
const safeSessionID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const continueWords = new Set(["계속", "계속해", "continue", "go", "ㄱ", "ㄱㄱ", "resume"]);

export type BrainstormRoute = { readonly agent?: string; readonly providerID?: string; readonly modelID?: string };

type Run = {
  version: 1;
  approved: number;
  sent: number;
  reducers: number;
  judged: boolean;
  judgeNudged: boolean;
  stalls: number;
  lastIdleSent: number;
  paused: boolean;
  route?: BrainstormRoute;
};

/** One finished tool call, under its OpenCode 1 name (`bash`, `task`). */
export type BrainstormToolCall = { readonly sessionID: string; readonly tool: string; readonly args: unknown; readonly output: string };

export type BrainstormRunOptions = {
  readonly dir: string;
  readonly getSession: SessionLookup | undefined;
  readonly send: (sessionID: string, text: string, route: BrainstormRoute | undefined) => Promise<void>;
  readonly notify: (message: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function launchLanes(call: BrainstormToolCall): number | undefined {
  if (call.tool !== "bash" || !isRecord(call.args) || typeof call.args.command !== "string") return undefined;
  if (!/estimate\.mjs\s+--answer\b/u.test(call.args.command)) return undefined;
  for (const line of call.output.split("\n")) {
    try {
      const value: unknown = JSON.parse(line.trim());
      if (isRecord(value) && value.answer === "launch" && Number.isInteger(value.lanes) && (value.lanes as number) >= 1 && (value.lanes as number) <= maxLanes) {
        return value.lanes as number;
      }
    } catch { // no-excuse-ok: catch -- a line that is not JSON is simply not the answer.
    }
  }
  return undefined;
}

function subagent(call: BrainstormToolCall): string | undefined {
  if (call.tool !== "task" || !isRecord(call.args)) return undefined;
  const name = call.args.subagent_type ?? call.args.agent;
  return typeof name === "string" ? name : undefined;
}

/** Text the plugin itself sends into a session; it is not the user speaking. */
function pluginText(text: string): boolean {
  return text.startsWith(brainstormNudgePrefix) || text.includes("Auto-handoff marker:");
}

export function laneNudge(run: Pick<Run, "approved" | "sent">): string {
  const done = run.sent === 0 ? "No lanes were sent yet" : `Lanes 0..${run.sent - 1} were sent`;
  return [
    `${brainstormNudgePrefix} this run is not finished. ${done}; the next lane is ${run.sent}; ${run.approved} lanes were approved, so ${run.approved - run.sent} remain.`,
    "Re-read the run's .litopencode/brainstorm/<slug>/lanes.jsonl and clusters.jsonl (after a compaction they are the source of truth), then keep sending lit-ideator lanes in batches of ten from that lane, append each batch to lanes.jsonl, and run the lit-explorer reducer for every finished slice of 30 lanes into clusters.jsonl.",
    "Repeated ideas are not a reason to stop: the reducers merge them. Only the user can stop this run."
  ].join("\n\n");
}

export function judgeNudge(run: Pick<Run, "approved" | "sent" | "reducers">): string {
  const expected = Math.ceil(run.approved / perReducer);
  return [
    `${brainstormNudgePrefix} all ${run.approved} approved lanes were sent, but the judge has not run. ${run.reducers} of ${expected} reducers ran.`,
    "Finish the run: run any missing lit-explorer reducer over its slice from lanes.jsonl and append its clusters to clusters.jsonl, then send the one lit-oracle judge with every cluster from clusters.jsonl as data, save notes.md and result.json, and show the top list."
  ].join("\n\n");
}

export function createBrainstormRun(options: BrainstormRunOptions) {
  const runs = new Map<string, Run | null>();
  const routes = new Map<string, BrainstormRoute>();

  function file(sessionID: string): string {
    return path.join(options.dir, `${sessionID}.json`);
  }

  async function load(sessionID: string): Promise<Run | undefined> {
    if (!safeSessionID.test(sessionID)) return undefined;
    if (runs.has(sessionID)) return runs.get(sessionID) ?? undefined;
    let run: Run | null = null;
    try {
      const value: unknown = JSON.parse(await fs.readFile(file(sessionID), "utf8"));
      if (isRecord(value) && value.version === 1 && Number.isInteger(value.approved) && Number.isInteger(value.sent)) run = value as Run;
    } catch { // no-excuse-ok: catch -- no file, or an unreadable one, means no run.
    }
    runs.set(sessionID, run);
    return run ?? undefined;
  }

  async function save(sessionID: string, run: Run): Promise<void> {
    runs.set(sessionID, run);
    try {
      await fs.mkdir(options.dir, { recursive: true, mode: 0o700 });
      const temp = `${file(sessionID)}.${process.pid}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(run)}\n`, { mode: 0o600 });
      await fs.rename(temp, file(sessionID));
    } catch { // no-excuse-ok: catch -- the run still works in memory; only a restart would lose it.
    }
  }

  async function clear(sessionID: string): Promise<void> {
    runs.set(sessionID, null);
    await fs.rm(file(sessionID), { force: true }).catch(() => undefined);
  }

  async function isRoot(sessionID: string): Promise<boolean> {
    try {
      const session = await options.getSession?.(sessionID);
      return session !== undefined && session.parentID === undefined;
    } catch {
      return false;
    }
  }

  async function toolDone(call: BrainstormToolCall): Promise<void> {
    const lanes = launchLanes(call);
    if (lanes !== undefined) {
      if (!safeSessionID.test(call.sessionID) || !(await isRoot(call.sessionID))) return;
      const route = routes.get(call.sessionID);
      await save(call.sessionID, {
        version: 1, approved: lanes, sent: 0, reducers: 0, judged: false, judgeNudged: false, stalls: 0, lastIdleSent: 0, paused: false,
        ...(route === undefined ? {} : { route })
      });
      return;
    }
    const agent = subagent(call);
    if (agent === undefined) return;
    const run = await load(call.sessionID);
    if (run === undefined) return;
    if (agent === "lit-ideator") run.sent += 1;
    else if (agent === "lit-explorer") run.reducers += 1;
    else if (agent === "lit-oracle" && run.sent >= run.approved) {
      await clear(call.sessionID);
      return;
    } else return;
    await save(call.sessionID, run);
  }

  async function userText(sessionID: string, text: string, route?: BrainstormRoute): Promise<void> {
    if (route !== undefined) routes.set(sessionID, route);
    if (pluginText(text)) return;
    const run = await load(sessionID);
    if (run === undefined) return;
    const word = text.trim().toLowerCase().replace(/[.!?。]+$/u, "");
    if (!continueWords.has(word)) {
      await clear(sessionID);
      return;
    }
    Object.assign(run, { paused: false, stalls: 0, lastIdleSent: run.sent, judgeNudged: false });
    await save(sessionID, run);
  }

  async function interrupt(sessionID: string): Promise<void> {
    const run = await load(sessionID);
    if (run === undefined || run.paused) return;
    run.paused = true;
    await save(sessionID, run);
  }

  async function idle(sessionID: string): Promise<void> {
    const run = await load(sessionID);
    if (run === undefined || run.paused || !(await isRoot(sessionID))) return;
    let text: string;
    if (run.sent < run.approved) {
      run.stalls = run.sent === run.lastIdleSent ? run.stalls + 1 : 0;
      run.lastIdleSent = run.sent;
      if (run.stalls >= stallLimit) {
        run.paused = true;
        await save(sessionID, run);
        options.notify(`Ultra-brainstorm paused at ${run.sent} of ${run.approved} lanes; type 계속 or continue to resume.`);
        return;
      }
      text = laneNudge(run);
    } else {
      if (run.judgeNudged) {
        run.paused = true;
        await save(sessionID, run);
        options.notify(`Ultra-brainstorm: all ${run.approved} lanes ran but the judge did not; type 계속 or continue to finish it.`);
        return;
      }
      run.judgeNudged = true;
      text = judgeNudge(run);
    }
    await save(sessionID, run);
    try {
      await options.send(sessionID, text, run.route);
    } catch { // no-excuse-ok: catch -- a refused prompt leaves the run as it is; the next idle tries again.
    }
  }

  // Tool results, user messages and idle events arrive from separate host hooks; one queue keeps their order.
  let queue: Promise<void> = Promise.resolve();
  function serial<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
    return (...args) => {
      const next = queue.then(() => fn(...args));
      queue = next.catch(() => undefined);
      return next;
    };
  }

  return {
    toolDone: serial(toolDone),
    userText: serial(userText),
    interrupt: serial(interrupt),
    idle: serial(idle),
    /** Whether the session has an armed run (paused or not). */
    active: async (sessionID: string): Promise<boolean> => {
      await queue;
      return (await load(sessionID)) !== undefined;
    }
  };
}

export type BrainstormRunGuard = ReturnType<typeof createBrainstormRun>;
