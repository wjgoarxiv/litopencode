import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  LifecycleConflictError,
  LifecycleSafetyError,
  createBoundedAuthorityLifecycle,
  type BoundedAuthorityOptions,
  type BoundedAuthorityState
} from "./bounded-authority.ts";
import { resolveLatestDurablePlan } from "./durable-plan.ts";

// Typed start-work: the user's own typed `start-work [plan]`, `/start-work [plan]`, `lit approve` and
// `lit deny` drive the schema-3 bounded-authority lifecycle without a pasted JSON directive. The grants
// stay what the strict `start-work init {json}` path would need for an ordinary run: read, write and
// execute under the worktree root. Commit, push, publish, release, version-bump, host-config and
// destructive actions are still refused by the lifecycle itself, so nothing here can grant them.

export type TypedStartResult = {
  readonly started: boolean;
  readonly text: string;
  /** True when no plan resolved: the ordinary start-work activation says what it always said, with no extra sentence. */
  readonly quiet?: boolean;
};

const planFile = /^[\w./@ -]{1,240}\.md$/u;
const openRow = /^- \[ \] \d+\./mu;
const planDirectories = ["plans", path.join(".litopencode", "plans")];

/** Plan argument of a typed start-work prompt: undefined when the prompt is not one, "" for a bare one. */
export function typedStartArgument(text: string): string | undefined {
  const match = /^(?:\/)?(?:start-work|lit\s+start\s+work)(?:\s+(\S[^\r\n]*))?[.!?]*$/iu.exec(text.trim());
  if (match === null) return undefined;
  const argument = (match[1] ?? "").trim();
  if (argument === "") return "";
  return planFile.test(argument) ? argument : undefined;
}

async function singleOpenPlan(projectRoot: string): Promise<string | undefined> {
  const open: string[] = [];
  for (const directory of planDirectories) {
    let names: string[];
    try {
      names = await fs.readdir(path.join(projectRoot, directory));
    } catch {
      continue;
    }
    for (const name of names.filter((entry) => entry.endsWith(".md"))) {
      const file = path.join(projectRoot, directory, name);
      const stat = await fs.lstat(file).catch(() => undefined);
      if (stat === undefined || !stat.isFile() || stat.size > 256 * 1024) continue;
      if (openRow.test(await fs.readFile(file, "utf8"))) open.push(path.join(directory, name));
    }
  }
  return open.length === 1 ? open[0] : undefined;
}

async function resolvePlan(projectRoot: string, explicit: string | undefined): Promise<string | undefined> {
  if (explicit !== undefined && explicit !== "") return explicit;
  const durable = await resolveLatestDurablePlan(projectRoot).catch(() => undefined);
  if (durable !== undefined) return durable.relativePath;
  return singleOpenPlan(projectRoot);
}

async function currentState(lifecycle: ReturnType<typeof createBoundedAuthorityLifecycle>): Promise<BoundedAuthorityState | undefined> {
  try {
    return await lifecycle.read();
  } catch (error) {
    if (error instanceof LifecycleConflictError) return undefined;
    throw error;
  }
}

function receipt(state: BoundedAuthorityState): string {
  return `<bounded-authority-lifecycle>\n${JSON.stringify({
    schemaVersion: 3,
    kind: "bounded-authority-lifecycle",
    workId: state.workId,
    revision: state.revision,
    status: state.status,
    pendingBoundary: state.pendingBoundary === null ? null : { id: state.pendingBoundary.id, action: state.pendingBoundary.action }
  })}\n</bounded-authority-lifecycle>`;
}

/**
 * Starts a bounded run for the typed prompt: resolves the plan (named, else the latest durable plan, else the
 * only open plan), then calls lifecycle init on the user's behalf. Any refusal returns started:false with a
 * sentence; the caller then runs the ordinary start-work activation so the old behaviour stays the fallback.
 */
export async function startTypedWork(input: {
  readonly projectRoot: string;
  readonly sessionID: string;
  readonly plan?: string;
  readonly options?: BoundedAuthorityOptions;
}): Promise<TypedStartResult> {
  const lifecycle = createBoundedAuthorityLifecycle(input.projectRoot, input.options);
  try {
    const plan = await resolvePlan(input.projectRoot, input.plan);
    if (plan === undefined) {
      return { started: false, quiet: true, text: "LitOpenCode: no approved plan was found to start. Name one, for example start-work plans/my-plan.md, or approve a plan with lit-plan first." };
    }
    const state = await currentState(lifecycle);
    if (state !== undefined && state.status !== "cancelled" && state.status !== "completed") {
      return {
        started: false,
        text: `LitOpenCode: a start-work run is already ${state.status} in this workspace. Continue it, or finish or cancel it before starting another.`
      };
    }
    const started = await lifecycle.init({
      schemaVersion: 3,
      requestId: `typed-start-${randomUUID()}`,
      sessionID: input.sessionID,
      trustedUser: true,
      expectedRevision: state?.revision ?? 0,
      planPath: plan,
      worktree: null,
      authorized: true,
      authority: [
        { action: "read", root: "." },
        { action: "write", root: "." },
        { action: "execute", root: "." }
      ]
    });
    return {
      started: true,
      text: `${receipt(started.state)}\nLitOpenCode: start-work began from ${plan}. It may read, write and run commands under this workspace; commit, push, publish, release and version changes need a separate yes from the user.`
    };
  } catch (error) {
    if (error instanceof LifecycleConflictError || error instanceof LifecycleSafetyError) {
      return { started: false, text: `LitOpenCode: start-work was not started (${error.message}).` };
    }
    throw error;
  }
}

export type BoundaryVerdict = "approve" | "deny";

/** `lit approve` / `lit deny` as the whole prompt. */
export function boundaryVerdict(text: string): BoundaryVerdict | undefined {
  const match = /^lit\s+(approve|deny)[.!?]*$/iu.exec(text.trim());
  return match === null ? undefined : (match[1].toLowerCase() as BoundaryVerdict);
}

/**
 * Answers the pending boundary of the run this session owns. Approve resumes with exactly that boundary;
 * deny cancels the run, because the lifecycle has no refused-and-still-paused state. Anything else is a
 * sentence and no change.
 */
export async function answerBoundary(input: {
  readonly projectRoot: string;
  readonly sessionID: string;
  readonly verdict: BoundaryVerdict;
  readonly options?: BoundedAuthorityOptions;
}): Promise<string> {
  const lifecycle = createBoundedAuthorityLifecycle(input.projectRoot, input.options);
  const state = await currentState(lifecycle).catch(() => undefined);
  if (state === undefined || state.status !== "paused" || state.pendingBoundary === null) {
    return "LitOpenCode: nothing is waiting for your approval, so lit approve and lit deny change nothing.";
  }
  if (state.sessionID !== input.sessionID) {
    return "LitOpenCode: the run waiting for approval belongs to another session; answer it there. Nothing changed.";
  }
  const boundary = state.pendingBoundary;
  const base = {
    schemaVersion: 3 as const,
    requestId: `typed-${input.verdict}-${randomUUID()}`,
    workId: state.workId,
    sessionID: input.sessionID,
    expectedRevision: state.revision,
    trustedUser: true
  };
  try {
    if (input.verdict === "approve") {
      const resumed = await lifecycle.resume({ ...base, grant: { action: boundary.action, root: boundary.root } });
      return `${receipt(resumed.state)}\nLitOpenCode: approved ${boundary.action} on ${boundary.root}. The run continues; that one boundary is now granted and nothing else was widened.`;
    }
    const cancelled = await lifecycle.cancel(base);
    return `${receipt(cancelled.state)}\nLitOpenCode: denied ${boundary.action} on ${boundary.root}. The start-work run has ended, because a refused boundary cannot stay paused. Nothing was changed by that step. To run it again, say start-work (or /start-work) and answer the boundary differently.`;
  } catch (error) {
    if (error instanceof LifecycleConflictError || error instanceof LifecycleSafetyError) {
      return `LitOpenCode: the answer was not applied (${error.message}). Nothing changed.`;
    }
    throw error;
  }
}
