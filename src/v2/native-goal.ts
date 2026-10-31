// Policy for OpenCode 2's native `/goal`. It is pure: the route, the goal record the host reports and the
// state of LitOpenCode's own ledger go in; one action comes out. The host has no setter for a goal, only
// the `/goal` command, and that command replaces any goal that exists, so every create is decided here
// first. LitOpenCode manages only a goal it created (the ledger remembers the id); a goal the user made
// is reported and never touched. Done needs two things: OpenCode's verdict and the ledger.
import { containsSecret } from "../secret-shapes.ts";

export type NativeGoalRoute = "lit-loop" | "start-work" | "litwork";

export type NativeGoalRecord = {
  readonly id: string;
  readonly objective: string;
  readonly status: "active" | "paused" | "complete";
  readonly reason?: string;
};

export type NativeGoalInput = {
  /** The route that is activating now; absent on an idle check. */
  readonly route: string | undefined;
  /** Whether this host answers the `opencode.goal` RPC. */
  readonly supported: boolean;
  /** The host's goal for the session: null when none, "unreadable" when the read failed. */
  readonly goal: NativeGoalRecord | null | "unreadable";
  /** The goal id LitOpenCode created for this session, from its ledger. */
  readonly ownedGoalID: string | undefined;
  /** Whether LitOpenCode's evidence ledger marks the session's goal complete. */
  readonly ledgerDone: boolean;
  /** How many times LitOpenCode already resumed the owned goal. */
  readonly resumes: number;
};

export type NativeGoalAction =
  | { readonly kind: "none" }
  | { readonly kind: "create" }
  | { readonly kind: "keep" }
  | { readonly kind: "resume" }
  | { readonly kind: "clear" }
  | { readonly kind: "report-user-goal" }
  | { readonly kind: "report-conflict"; readonly reason: string }
  | { readonly kind: "unavailable" };

const goalRoutes: ReadonlySet<string> = new Set(["lit-loop", "start-work", "litwork"]);

/** The host pauses a goal on a restart; it is the only pause that is safe to resume without asking. */
const restartPause = "The server restarted while the goal was active";
const maxResumes = 2;
const maxObjective = 4000;

const completionConditions =
  "Done only when all of these hold: the change works and the project's tests pass; a real-surface check of the path a user touches has run; temporary files are cleaned up with a cleanup receipt; and LitOpenCode's evidence ledger (.litopencode/litgoal) marks the goal complete.";

/** The qualifying route for a chat mode or command id, or undefined for every other route. */
export function nativeGoalRoute(mode: string, text: string): NativeGoalRoute | undefined {
  if (mode === "lit-loop" || mode === "start-work") return mode;
  if (mode === "litwork" || mode === "lit-work") return "litwork";
  if (mode !== "lit-task") return undefined;
  const first = text.trim().replace(/^\//u, "").split(/\s+/u)[0]?.toLowerCase();
  return first === "litwork" || first === "lit-work" ? "litwork" : undefined;
}

export function decideNativeGoal(input: NativeGoalInput): NativeGoalAction {
  const routed = input.route !== undefined;
  if (routed && !goalRoutes.has(input.route as string)) return { kind: "none" };
  if (!input.supported) return routed ? { kind: "unavailable" } : { kind: "none" };
  const goal = input.goal;
  if (goal === "unreadable") return routed ? { kind: "report-conflict", reason: "the goal state could not be read, so none was set" } : { kind: "none" };
  if (goal === null) return routed ? { kind: "create" } : { kind: "none" };
  if (input.ownedGoalID === undefined || goal.id !== input.ownedGoalID) return routed ? { kind: "report-user-goal" } : { kind: "none" };
  if (goal.status === "complete") {
    return input.ledgerDone ? { kind: "clear" } : { kind: "report-conflict", reason: "OpenCode says the goal is met but the ledger is still open" };
  }
  if (goal.status === "paused") {
    if (goal.reason === restartPause && input.resumes < maxResumes) return routed ? { kind: "resume" } : { kind: "none" };
    return routed ? { kind: "report-conflict", reason: `the goal is paused${goal.reason === undefined ? "" : ` (${oneLine(goal.reason, 60)})`} and needs a person to resume it` } : { kind: "none" };
  }
  return { kind: "keep" };
}

function oneLine(value: string, limit: number): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** The text sent to `/goal`: the work, then the conditions OpenCode's reviewer judges it against. */
export function nativeGoalObjective(work: string, sessionID?: string): string {
  const flat = work.replace(/\s+/gu, " ").trim();
  const subject = flat === "" || containsSecret(flat) ? "the work requested in this session" : flat;
  const conditions = sessionID === undefined || !/^[A-Za-z0-9_-]{1,80}$/u.test(sessionID) ? completionConditions : `${completionConditions} Open that ledger goal with --session-id ${sessionID}.`;
  const room = maxObjective - conditions.length - 2;
  return `${oneLine(subject, room)}\n\n${conditions}`;
}

/** The single line announced for an action; an empty string when nothing changed. */
export function nativeGoalLine(action: NativeGoalAction, detail: { readonly route?: string; readonly goal?: Pick<NativeGoalRecord, "id" | "status" | "objective"> }): string {
  const id = detail.goal === undefined ? "" : ` ${detail.goal.id.slice(0, 8)}`;
  switch (action.kind) {
    case "create": return `LitOpenCode goal: created for ${detail.route ?? "this work"}; OpenCode judges it, the ledger must agree`;
    case "resume": return `LitOpenCode goal: resumed${id} after a server restart`;
    case "clear": return `LitOpenCode goal: cleared${id}; OpenCode's verdict and the ledger both say done`;
    case "report-user-goal": return `LitOpenCode goal: left yours alone${detail.goal === undefined ? "" : ` (${detail.goal.status}: ${oneLine(detail.goal.objective, 60)})`}`;
    case "report-conflict": return `LitOpenCode goal: conflict, ${oneLine(action.reason, 120)}; not reporting done`;
    case "unavailable": return "LitOpenCode goal: native-goal-unavailable (this OpenCode has no /goal); the ledger carries the work";
    default: return "";
  }
}
