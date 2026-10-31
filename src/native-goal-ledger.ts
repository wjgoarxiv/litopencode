// The native-goal records in LitOpenCode's own ledger (`.litopencode/litgoal`). OpenCode's goal has no
// owner field, so the ledger is where LitOpenCode remembers which goal id it created, how often it
// resumed it, and that a host had no `/goal`. Every write is best-effort: a ledger failure never blocks
// the work, and a read failure reads as "owns nothing", which only makes LitOpenCode do less.
import { createLitGoalOperations, readEvidenceLedger } from "./ledger.ts";

export type NativeGoalLedgerEvent =
  | { readonly type: "native-goal.created"; readonly goalID: string }
  | { readonly type: "native-goal.resumed"; readonly goalID: string }
  | { readonly type: "native-goal.cleared"; readonly goalID: string }
  | { readonly type: "native-goal.left-alone"; readonly goalID: string; readonly status: string }
  | { readonly type: "native-goal.conflict"; readonly goalID: string; readonly reason: string }
  | { readonly type: "native-goal.failed"; readonly step: string; readonly detail: string }
  | { readonly type: "native-goal.unavailable"; readonly host: string };

export type NativeGoalOwnership = { readonly goalID: string | undefined; readonly resumes: number; readonly createdAt: string | undefined };

export async function recordNativeGoal(projectRoot: string, sessionID: string, route: string | undefined, event: NativeGoalLedgerEvent): Promise<boolean> {
  try {
    const operations = createLitGoalOperations(projectRoot);
    await operations.init();
    await operations.append({ ...event, sessionID, ...(route === undefined ? {} : { route }), timestamp: new Date().toISOString() });
    return true;
  } catch { // no-excuse-ok: catch -- a ledger failure must never block the user's work.
    return false;
  }
}

/** The goal id LitOpenCode created for this session and has not cleared, with its resume count. */
export async function nativeGoalOwnership(projectRoot: string, sessionID: string): Promise<NativeGoalOwnership> {
  let goalID: string | undefined;
  let createdAt: string | undefined;
  let resumes = 0;
  try {
    for (const event of await createLitGoalOperations(projectRoot).read()) {
      if (event["sessionID"] !== sessionID || typeof event["goalID"] !== "string") continue;
      if (event.type === "native-goal.created") {
        goalID = event["goalID"];
        createdAt = typeof event["timestamp"] === "string" ? event["timestamp"] : undefined;
        resumes = 0;
      } else if (event.type === "native-goal.cleared" && event["goalID"] === goalID) {
        goalID = undefined;
        createdAt = undefined;
      } else if (event.type === "native-goal.resumed" && event["goalID"] === goalID) {
        resumes += 1;
      }
    }
  } catch { // no-excuse-ok: catch -- an unreadable ledger reads as "owns nothing", so LitOpenCode touches nothing.
    return { goalID: undefined, resumes: 0, createdAt: undefined };
  }
  return { goalID, resumes, createdAt };
}

/** OpenCode 1 and older OpenCode 2 hosts have no `/goal`: say so once per session and route. */
export async function recordNativeGoalUnavailable(projectRoot: string, sessionID: string, route: string, host: string): Promise<void> {
  if (await nativeGoalRecorded(projectRoot, sessionID, "native-goal.unavailable", route)) return;
  await recordNativeGoal(projectRoot, sessionID, route, { type: "native-goal.unavailable", host });
}

/**
 * True when the evidence ledger holds a goal for this session that is complete and was last written after
 * the native goal was created. A session's first ledger goal stays complete for good, so an older one must
 * not close a later native goal.
 */
export async function ledgerGoalDone(projectRoot: string, sessionID: string, since?: string): Promise<boolean> {
  try {
    const state = await readEvidenceLedger(projectRoot);
    const floor = since === undefined ? Number.NaN : Date.parse(since);
    return state.goals.some((goal) => goal.sessionId === sessionID && goal.status === "complete" && (Number.isNaN(floor) || Date.parse(goal.updatedAt) >= floor));
  } catch { // no-excuse-ok: catch -- an unreadable evidence ledger is not done.
    return false;
  }
}

/** Whether the ledger already holds an event of this type for the session (used to say a thing once). */
export async function nativeGoalRecorded(projectRoot: string, sessionID: string, type: NativeGoalLedgerEvent["type"], route?: string): Promise<boolean> {
  try {
    return (await createLitGoalOperations(projectRoot).read()).some((event) => event.type === type && event["sessionID"] === sessionID && (route === undefined || event["route"] === route));
  } catch { // no-excuse-ok: catch -- an unreadable ledger cannot prove the record exists.
    return false;
  }
}
