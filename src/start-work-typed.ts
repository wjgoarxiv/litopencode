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
import { parseScopeRoots } from "./plan-scope-roots.ts";

// Typed start-work: the user's own typed `start-work [plan]`, `/start-work [plan]`, `lit approve`,
// `lit deny` and `lit cancel` drive the schema-3 bounded-authority lifecycle without a pasted JSON
// directive. The grants stay what the strict `start-work init {json}` path would need for an ordinary run:
// read, write and execute under the worktree root. A step outside them is parked while the run keeps
// going; approve and deny settle the parked queue and are optional, and cancel ends the run from any
// window of the project. Commit, push, publish, release, version-bump, host-config and destructive
// actions are still refused by the lifecycle itself, so nothing here can grant them.

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

/** The plan's own `Scope roots:` lines, granted at start so the run never pauses for a folder the plan named. */
async function planScopeGrants(projectRoot: string, plan: string): Promise<Array<{ action: string; root: string }>> {
  const file = path.resolve(projectRoot, plan);
  const stat = await fs.lstat(file).catch(() => undefined);
  if (stat === undefined || !stat.isFile() || stat.size > 256 * 1024) return [];
  const text = await fs.readFile(file, "utf8");
  return parseScopeRoots(text, projectRoot).flatMap((scope) => scope.actions.map((action) => ({ action, root: scope.root })));
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
    pendingBoundary: null,
    parked: state.parkedBoundaries.length
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
        text: `LitOpenCode: a start-work run is already ${state.status} in this workspace. Continue it, or finish it, or type lit cancel to end it before starting another.`
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
        { action: "execute", root: "." },
        ...(await planScopeGrants(input.projectRoot, plan))
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

/** `lit approve` / `lit deny` as the whole prompt; both settle the whole parked queue. */
export function boundaryVerdict(text: string): BoundaryVerdict | undefined {
  const match = /^lit\s+(approve|deny)[.!?]*$/iu.exec(text.trim());
  return match === null ? undefined : (match[1].toLowerCase() as BoundaryVerdict);
}

const describe = (entry: { readonly action: string; readonly root: string }): string => `${entry.action} on ${entry.root}`;

/**
 * Settles the parked steps of the run this session owns, all at once. Approve grants each of them (up to
 * the grant cap; the rest stay parked) and deny refuses each of them for the rest of the run. The run keeps
 * going either way; only `lit cancel` ends it. Anything else is a sentence and no change.
 */
export async function answerBoundary(input: {
  readonly projectRoot: string;
  readonly sessionID: string;
  readonly verdict: BoundaryVerdict;
  readonly options?: BoundedAuthorityOptions;
}): Promise<string> {
  const lifecycle = createBoundedAuthorityLifecycle(input.projectRoot, input.options);
  const state = await currentState(lifecycle).catch(() => undefined);
  if (state === undefined || state.status !== "active" || state.parkedBoundaries.length === 0) {
    return "LitOpenCode: nothing is waiting for your approval (no step is parked), so lit approve and lit deny change nothing.";
  }
  if (state.sessionID !== input.sessionID) {
    return "LitOpenCode: the parked steps belong to a run owned by another session; answer them there. Nothing changed.";
  }
  try {
    const result = await lifecycle.settleParked({
      schemaVersion: 3,
      requestId: `typed-${input.verdict}-${randomUUID()}`,
      workId: state.workId,
      sessionID: input.sessionID,
      trustedUser: true,
      verdict: input.verdict
    });
    const listed = result.settled.map(describe).join("; ");
    if (input.verdict === "deny") {
      return `${receipt(result.state)}\nLitOpenCode: refused ${result.settled.length} parked step${result.settled.length === 1 ? "" : "s"} (${listed}); the run keeps going without them. Type lit cancel to end it.`;
    }
    const extra = [
      result.remaining.length > 0 ? ` ${result.remaining.length} stayed parked because the run already holds the most grants it can (${result.remaining.map(describe).join("; ")}).` : "",
      result.dropped.length > 0 ? ` ${result.dropped.length} were dropped because the path is gone or is a link (${result.dropped.map(describe).join("; ")}).` : ""
    ].join("");
    return `${receipt(result.state)}\nLitOpenCode: approved ${listed}. The run continues; only those steps were granted and nothing else was widened.${extra}`;
  } catch (error) {
    if (error instanceof LifecycleConflictError || error instanceof LifecycleSafetyError) {
      return `LitOpenCode: the answer was not applied (${error.message}). Nothing changed.`;
    }
    throw error;
  }
}

/** `lit cancel` / `lit 취소` as the whole prompt, spaces or tabs between the words. */
export function typedCancel(text: string): boolean {
  if (typeof text !== "string" || text.length > 512) return false;
  return /^lit[ \t]+(?:cancel|취소)[.!?]*$/iu.test(text.trim());
}

async function lifecycleStatusAt(root: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(root, ".litopencode", "litgoal", "lit-loop", "work-schema-3.json"), "utf8");
    const status = (JSON.parse(raw) as { status?: unknown }).status;
    return typeof status === "string" ? status : undefined;
  } catch {
    return undefined;
  }
}

/** The main checkout of a linked worktree: `.git` is a file naming the gitdir, whose commondir is the shared one. */
async function mainCheckoutOf(root: string): Promise<string | undefined> {
  const dotGit = path.join(root, ".git");
  const stat = await fs.lstat(dotGit).catch(() => undefined);
  if (stat === undefined || !stat.isFile() || stat.size > 4096) return undefined;
  const match = /^gitdir:\s*(.+)$/mu.exec(await fs.readFile(dotGit, "utf8"));
  if (match === null) return undefined;
  const gitdir = path.resolve(root, match[1].trim());
  const commonText = await fs.readFile(path.join(gitdir, "commondir"), "utf8").catch(() => undefined);
  if (commonText === undefined) return undefined;
  const common = path.resolve(gitdir, commonText.trim());
  const commonStat = await fs.lstat(common).catch(() => undefined);
  if (commonStat === undefined || commonStat.isSymbolicLink() || !commonStat.isDirectory()) return undefined;
  return path.dirname(common);
}

/** Where a cancel looks: the plugin's project root, the host directory, then the main checkout of a linked worktree. */
export async function cancelRoots(projectRoot: string, directory?: string): Promise<string[]> {
  const roots = [path.resolve(projectRoot)];
  if (directory !== undefined && directory.trim() !== "" && path.resolve(directory) !== roots[0]) roots.push(path.resolve(directory));
  const main = await mainCheckoutOf(roots[0]);
  if (main !== undefined && !roots.includes(main)) roots.push(main);
  return roots;
}

/** Ends the project's start-work run from the user's own typed `lit cancel`, in whichever window they typed it. */
export async function cancelTypedWork(input: {
  readonly projectRoot: string;
  readonly sessionID: string;
  readonly messageID: string;
  readonly directory?: string;
  readonly options?: BoundedAuthorityOptions;
}): Promise<string> {
  try {
    const roots = await cancelRoots(input.projectRoot, input.directory);
    let target: string | undefined;
    for (const root of roots) {
      const status = await lifecycleStatusAt(root);
      if (status === "active" || status === "paused") {
        target = root;
        break;
      }
    }
    if (target === undefined) return "LitOpenCode: no start-work run is active here, so lit cancel changed nothing.";
    const lifecycle = createBoundedAuthorityLifecycle(target, input.options);
    const result = await lifecycle.userCancel({ schemaVersion: 3, requestId: `typed-cancel-${input.messageID}`, sessionID: input.sessionID, trustedUser: true });
    if (result.outcome === "nothing" || result.state === undefined) return "LitOpenCode: no start-work run is active here, so lit cancel changed nothing.";
    const plan = path.relative(target, result.state.plan.path) || result.state.plan.path;
    return `${receipt(result.state)}\nLitOpenCode: the user cancelled the start-work run on ${plan}. It is over: stop its work, emit no progress fence, and reply in one line that it was cancelled.`;
  } catch (error) {
    if (error instanceof LifecycleConflictError && /lock timed out/u.test(error.message)) {
      return "LitOpenCode: the run is busy writing its state; send lit cancel again.";
    }
    const name = error instanceof Error ? error.name : "Error";
    return `LitOpenCode: the cancel was not applied (${name}). Nothing changed.`;
  }
}

/** The one-line notice for a session whose run another window cancelled; read once. */
export async function takeCancelNotice(projectRoot: string, sessionID: string): Promise<string | undefined> {
  try {
    const notice = await createBoundedAuthorityLifecycle(projectRoot).consumeCancelNotice(sessionID);
    if (notice === undefined) return undefined;
    const plan = path.relative(projectRoot, notice.plan) || notice.plan;
    return `LitOpenCode: the user cancelled the start-work run on ${plan} from another window. It is over. Stop its plan work and emit no litopencode-progress fence; tell the user in one line.`;
  } catch {
    return undefined;
  }
}
