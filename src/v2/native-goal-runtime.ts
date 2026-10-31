// Drives OpenCode 2's native `/goal` for lit-loop, start-work and litwork. The host has no goal setter:
// the goal is read through the `opencode.goal` RPC and changed by sending the `/goal` command to the
// session (`session.command`). Policy lives in native-goal.ts; this file reads the state, performs the one
// action it returns, prints one line per change as a notice row, and records it in the ledger. Nothing here
// throws: a failed step is recorded and the work carries on with the ledger alone.
import {
  ledgerGoalDone,
  nativeGoalOwnership,
  recordNativeGoal,
  recordNativeGoalUnavailable,
  type NativeGoalLedgerEvent
} from "../native-goal-ledger.ts";
import { litOpenCodeCommands } from "../commands.ts";
import {
  decideNativeGoal,
  nativeGoalLine,
  nativeGoalObjective,
  nativeGoalRoute,
  type NativeGoalAction,
  type NativeGoalRecord,
  type NativeGoalRoute
} from "./native-goal.ts";

/** The `opencode.goal` RPC contract as JSON Schema, so the package needs no runtime import of the host's schema library. */
const goalDefinition = Object.freeze({
  id: "opencode.goal",
  methods: Object.freeze({
    get: Object.freeze({
      input: Object.freeze({ type: "object", properties: Object.freeze({ sessionID: Object.freeze({ type: "string" }) }), required: Object.freeze(["sessionID"]) }),
      output: Object.freeze({})
    })
  }),
  events: Object.freeze({
    changed: Object.freeze({ schema: Object.freeze({ type: "object" as const, properties: Object.freeze({ sessionID: Object.freeze({ type: "string" }) }), required: Object.freeze(["sessionID"]) }) })
  })
});

export type GoalRpcClientLike = { readonly get: (input: { readonly sessionID: string }) => Promise<unknown> };

export type NativeGoalHostLike = {
  /** `context.rpc`; absent on a host that has no RPC domain. */
  readonly rpc?: (definition: typeof goalDefinition) => GoalRpcClientLike;
  readonly session: {
    readonly command: (input: { readonly sessionID: string; readonly name: string; readonly text: string; readonly delivery?: "steer" | "queue" }) => Promise<unknown>;
    readonly synthetic: (input: {
      readonly sessionID: string;
      readonly text: string;
      readonly description?: string;
      readonly metadata?: Readonly<Record<string, string>>;
      readonly resume?: boolean;
    }) => Promise<unknown>;
  };
};

type Read = { readonly supported: false } | { readonly supported: true; readonly goal: NativeGoalRecord | null | "unreadable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGoal(value: unknown): NativeGoalRecord | null | "unreadable" {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.objective !== "string") return "unreadable";
  if (value.status !== "active" && value.status !== "paused" && value.status !== "complete") return "unreadable";
  return { id: value.id, objective: value.objective, status: value.status, ...(typeof value.reason === "string" ? { reason: value.reason } : {}) };
}

/** OpenCode 2.2.5 answers an RPC it does not register with type `rpc.unavailable`; any other failure is a failed read. */
function hostLacksGoalRpc(error: unknown): boolean {
  return isRecord(error) && error.type === "rpc.unavailable";
}

function failureDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : isRecord(error) ? String(error.message ?? error.type ?? "failed") : String(error);
  return text.replace(/\s+/gu, " ").slice(0, 160);
}

/** A prompt the host expanded from an installed command alias file arrives as the command body, unmarked. */
export function aliasGoalRoute(input: string): { readonly route: NativeGoalRoute; readonly work: string } | undefined {
  const text = input.trimStart();
  for (const command of litOpenCodeCommands) {
    const head = command.activationText.trim();
    if (head === "" || !text.startsWith(head)) continue;
    const route = nativeGoalRoute(command.id, "");
    return route === undefined ? undefined : { route, work: text.slice(head.length) };
  }
  return undefined;
}

export function createNativeGoal(options: { readonly projectRoot: string; readonly host: NativeGoalHostLike }) {
  const { projectRoot, host } = options;
  const client = host.rpc === undefined ? undefined : host.rpc(goalDefinition);
  const said = new Set<string>();
  const running = new Set<Promise<void>>();

  async function read(sessionID: string): Promise<Read> {
    if (client === undefined) return { supported: false };
    try {
      return { supported: true, goal: parseGoal(await client.get({ sessionID })) };
    } catch (error) {
      return hostLacksGoalRpc(error) ? { supported: false } : { supported: true, goal: "unreadable" };
    }
  }

  async function notice(sessionID: string, line: string, key: string): Promise<void> {
    if (line === "" || said.has(key)) return;
    said.add(key);
    try {
      await host.session.synthetic({ sessionID, text: line, description: line, metadata: { source: "litopencode-goal" }, resume: false });
    } catch { // no-excuse-ok: catch -- a missing notice row must not stop the work; the ledger holds the record.
      return;
    }
  }

  async function fail(sessionID: string, route: string | undefined, step: string, error: unknown): Promise<void> {
    await recordNativeGoal(projectRoot, sessionID, route, { type: "native-goal.failed", step, detail: failureDetail(error) });
  }

  async function perform(sessionID: string, route: string | undefined, action: NativeGoalAction, goal: NativeGoalRecord | null | "unreadable", work: string): Promise<void> {
    const record = goal === null || goal === "unreadable" ? undefined : goal;
    const key = (name: string) => `${sessionID}:${name}:${record?.id ?? ""}:${action.kind === "report-conflict" ? action.reason : ""}`;
    switch (action.kind) {
      case "none":
      case "keep":
        return;
      case "unavailable": {
        if (route !== undefined) await recordNativeGoalUnavailable(projectRoot, sessionID, route, "opencode-2-without-goal-rpc");
        await notice(sessionID, nativeGoalLine(action, { route }), key("unavailable"));
        return;
      }
      case "report-user-goal": {
        if (!said.has(key("user-goal")) && record !== undefined) {
          await recordNativeGoal(projectRoot, sessionID, route, { type: "native-goal.left-alone", goalID: record.id, status: record.status });
        }
        await notice(sessionID, nativeGoalLine(action, { route, ...(record === undefined ? {} : { goal: record }) }), key("user-goal"));
        return;
      }
      case "report-conflict": {
        if (!said.has(key("conflict"))) {
          await recordNativeGoal(projectRoot, sessionID, route, { type: "native-goal.conflict", goalID: record?.id ?? "", reason: action.reason });
        }
        await notice(sessionID, nativeGoalLine(action, { route, ...(record === undefined ? {} : { goal: record }) }), key("conflict"));
        return;
      }
      case "create": {
        const objective = nativeGoalObjective(work, sessionID);
        try {
          await host.session.command({ sessionID, name: "goal", text: objective, delivery: "queue" });
        } catch (error) {
          await fail(sessionID, route, "create", error);
          return;
        }
        const after = await read(sessionID);
        const created = after.supported && after.goal !== null && after.goal !== "unreadable" && after.goal.objective === objective ? after.goal : undefined;
        if (created === undefined) {
          await fail(sessionID, route, "create", "the goal was not readable after /goal; ownership not claimed");
          return;
        }
        await recordNativeGoal(projectRoot, sessionID, route, { type: "native-goal.created", goalID: created.id });
        await notice(sessionID, nativeGoalLine(action, { route, goal: created }), key("created"));
        return;
      }
      case "resume":
      case "clear": {
        if (record === undefined) return;
        const control = action.kind;
        try {
          await host.session.command({ sessionID, name: "goal", text: control, delivery: "queue" });
        } catch (error) {
          await fail(sessionID, route, control, error);
          return;
        }
        const event: NativeGoalLedgerEvent = control === "resume" ? { type: "native-goal.resumed", goalID: record.id } : { type: "native-goal.cleared", goalID: record.id };
        await recordNativeGoal(projectRoot, sessionID, route, event);
        await notice(sessionID, nativeGoalLine(action, { route, goal: record }), key(control));
        return;
      }
    }
  }

  /** One decision for one session: `route` set on an activation, absent on an idle check. */
  async function step(sessionID: string, route: string | undefined, work: string): Promise<void> {
    const owned = await nativeGoalOwnership(projectRoot, sessionID);
    if (route === undefined && owned.goalID === undefined) return;
    const state = await read(sessionID);
    const goal = state.supported ? state.goal : null;
    const action = decideNativeGoal({
      route,
      supported: state.supported,
      goal,
      ownedGoalID: owned.goalID,
      ledgerDone: owned.goalID === undefined ? false : await ledgerGoalDone(projectRoot, sessionID, owned.createdAt),
      resumes: owned.resumes
    });
    await perform(sessionID, route, action, goal, work);
  }

  /** One step at a time per session, so a repeated activation sees the goal the first one made. */
  const chains = new Map<string, Promise<void>>();

  function track(sessionID: string, run: () => Promise<void>): Promise<void> {
    const previous = chains.get(sessionID) ?? Promise.resolve();
    const safe = previous.then(run).catch(() => undefined).finally(() => {
      running.delete(safe);
      if (chains.get(sessionID) === safe) chains.delete(sessionID);
    });
    chains.set(sessionID, safe);
    running.add(safe);
    return safe;
  }

  return {
    /** Starts the goal step for a qualifying activation without holding up the user's prompt. */
    activate(sessionID: string, route: NativeGoalRoute, work: string): Promise<void> {
      return track(sessionID, () => step(sessionID, route, work));
    },
    /** The session finished its model work: clear a finished owned goal or report a conflict. */
    idle(sessionID: string): Promise<void> {
      return track(sessionID, () => step(sessionID, undefined, ""));
    },
    /** Resolves when every started goal step has finished. */
    async settled(): Promise<void> {
      while (running.size > 0) await Promise.all([...running]);
    }
  };
}

export type NativeGoal = ReturnType<typeof createNativeGoal>;
