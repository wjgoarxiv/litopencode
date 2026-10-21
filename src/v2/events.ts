// The OpenCode 2 event stream. OpenCode 2 gives plugins no `event` hook; the plugin subscribes itself and
// the subscription ends when the plugin instance is cleaned up. Two OpenCode 1 state machines run on it:
// bounded-authority progress, now read from the finished assistant text (`session.text.ended`), and the
// automatic handoff, which keeps its OpenCode 1 logic and is fed translated events plus a small client
// that maps its calls onto the OpenCode 2 session API.
import type { PluginInput } from "@opencode-ai/plugin";
import { createAutoHandoff, type AutoHandoff } from "../auto-handoff-hooks.ts";
import {
  LifecycleConflictError,
  LifecycleSafetyError,
  createBoundedAuthorityLifecycle,
  parseFencedProgress,
  type BoundedAuthorityOptions
} from "../bounded-authority.ts";
import type { AutoHandoffConfig } from "../config.ts";
import type { SessionLookup } from "../session-lineage.ts";
import type { RuntimePaths } from "../state.ts";

export type StreamEvent = { readonly type: string; readonly data?: unknown };

export type EventDomainLike = {
  readonly subscribe: (options?: { readonly signal?: AbortSignal }) => AsyncIterable<StreamEvent>;
};

export type ModelInfoLike = { readonly providerID: string; readonly modelID?: string; readonly id: string; readonly limit?: { readonly context?: number } };

export type EventSessionLike = {
  readonly prompt: (input: { readonly sessionID: string; readonly text: string; readonly id?: string }) => Promise<unknown>;
  readonly compact: (input: { readonly sessionID: string }) => Promise<unknown>;
};

export type EventModelLike = {
  readonly list: () => Promise<readonly ModelInfoLike[] | { readonly data: readonly ModelInfoLike[] }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

type StepModel = { readonly sessionID: string; readonly providerID: string; readonly modelID: string; readonly agent?: string; readonly started: number };

/**
 * The calls the OpenCode 1 automatic handoff makes, answered by OpenCode 2. There is no server toast on
 * OpenCode 2, so the client has no `tui`; the handoff's own notices are not shown there.
 */
function handoffClient(session: EventSessionLike, model: EventModelLike, statuses: ReadonlyMap<string, unknown>): PluginInput["client"] {
  const client = {
    session: {
      async promptAsync(input: { path: { id: string }; body: { system?: string; parts?: readonly { text?: string }[] } }) {
        const text = [input.body.system, ...(input.body.parts ?? []).map((part) => part.text)].filter((part): part is string => typeof part === "string" && part !== "").join("\n\n");
        await session.prompt({ sessionID: input.path.id, text });
        return { data: {} };
      },
      async summarize(input: { path: { id: string } }) {
        await session.compact({ sessionID: input.path.id });
        return { data: true };
      },
      async status() {
        return { data: Object.fromEntries(statuses) };
      }
    },
    config: {
      async providers() {
        const listed = await model.list();
        const models = Array.isArray(listed) ? listed : (listed as { data: readonly ModelInfoLike[] }).data;
        const providers = new Map<string, Record<string, unknown>>();
        for (const entry of models) {
          const byId = providers.get(entry.providerID) ?? {};
          byId[entry.modelID ?? entry.id] = { limit: entry.limit };
          providers.set(entry.providerID, byId);
        }
        return { data: { providers: [...providers].map(([id, models]) => ({ id, models })) } };
      }
    }
  };
  return client as unknown as PluginInput["client"];
}

export type V2EventOptions = {
  readonly projectRoot: string;
  readonly paths: Pick<RuntimePaths, "autoHandoffFile">;
  readonly autoHandoffConfig: AutoHandoffConfig;
  readonly boundedAuthority: BoundedAuthorityOptions;
  readonly getSession: SessionLookup;
  readonly session: EventSessionLike;
  readonly model: EventModelLike;
  readonly onSessionDeleted: (sessionID: string) => void;
};

export function createV2Events(options: V2EventOptions) {
  const statuses = new Map<string, unknown>();
  const steps = new Map<string, StepModel>();
  const lifecycle = createBoundedAuthorityLifecycle(options.projectRoot, options.boundedAuthority);
  const autoHandoff: AutoHandoff = createAutoHandoff({
    projectRoot: options.projectRoot,
    paths: options.paths,
    client: handoffClient(options.session, options.model, statuses),
    config: options.autoHandoffConfig,
    getSession: options.getSession
  });

  // Translated into the OpenCode 1 event shapes the handoff state machine reads.
  async function toHandoff(type: string, properties: Record<string, unknown>): Promise<void> {
    await autoHandoff.event({ event: { type, properties } } as Parameters<AutoHandoff["event"]>[0]);
  }

  async function recordProgress(sessionID: string, messageID: string, ordinal: number, text: string): Promise<void> {
    let progress;
    try {
      progress = parseFencedProgress(text);
    } catch {
      return;
    }
    if (progress === undefined) return;
    const partID = `${messageID}:text:${ordinal}`;
    try {
      const recorded = await lifecycle.recordProgress({ ...progress, sessionID, messageID, partID });
      if (recorded.dispatchRequired !== true || recorded.continuation === undefined || recorded.continuationMessageID === undefined) return;
      try {
        // The id is the host's dedupe key: a replayed text end admits the same message, not a second one.
        await options.session.prompt({ sessionID, text: recorded.continuation, id: recorded.continuationMessageID });
      } catch {
        return;
      }
      await lifecycle.markContinuationSent({ workId: recorded.state.workId, sessionID: recorded.state.sessionID, revision: recorded.state.revision, messageID, partID });
    } catch (error) {
      if (error instanceof LifecycleConflictError || error instanceof LifecycleSafetyError) return;
      throw error;
    }
  }

  async function handle(event: StreamEvent): Promise<void> {
    const data = isRecord(event.data) ? event.data : {};
    const sessionID = str(data.sessionID);
    if (sessionID === undefined) return;
    switch (event.type) {
      case "session.deleted":
        statuses.delete(sessionID);
        // A step cut short (abort, crash) never ends; its entry goes with its session.
        for (const [messageID, step] of steps) if (step.sessionID === sessionID) steps.delete(messageID);
        options.onSessionDeleted(sessionID);
        await toHandoff("session.deleted", { info: { id: sessionID } });
        return;
      case "session.step.started": {
        const messageID = str(data.assistantMessageID);
        const model = isRecord(data.model) ? data.model : {};
        const providerID = str(model.providerID);
        const modelID = str(model.id);
        if (messageID === undefined || providerID === undefined || modelID === undefined) return;
        steps.set(messageID, { sessionID, providerID, modelID, ...(str(data.agent) === undefined ? {} : { agent: str(data.agent) }), started: typeof data.started === "number" ? data.started : Date.now() });
        return;
      }
      case "session.step.ended": {
        const messageID = str(data.assistantMessageID);
        const step = messageID === undefined ? undefined : steps.get(messageID);
        if (messageID === undefined || step === undefined) return;
        steps.delete(messageID);
        await toHandoff("message.updated", {
          info: {
            id: messageID,
            role: "assistant",
            sessionID,
            providerID: step.providerID,
            modelID: step.modelID,
            ...(step.agent === undefined ? {} : { mode: step.agent }),
            tokens: data.tokens,
            time: { created: step.started },
            ...(data.finish === "error" ? { error: { name: "StepError" } } : {})
          }
        });
        return;
      }
      case "session.status":
        statuses.set(sessionID, data.status);
        await toHandoff("session.status", { sessionID, status: data.status });
        return;
      case "session.idle":
        await toHandoff("session.idle", { sessionID });
        return;
      case "session.compaction.ended":
        await toHandoff("session.compacted", { sessionID });
        return;
      case "session.text.ended": {
        const messageID = str(data.assistantMessageID);
        if (messageID === undefined || typeof data.text !== "string") return;
        await recordProgress(sessionID, messageID, typeof data.ordinal === "number" ? data.ordinal : 0, data.text);
        return;
      }
      default:
        return;
    }
  }

  /** Reads the stream until stopped. A failing handler never ends the subscription. */
  function start(events: EventDomainLike): () => Promise<void> {
    const controller = new AbortController();
    const loop = (async () => {
      try {
        for await (const event of events.subscribe({ signal: controller.signal })) {
          if (controller.signal.aborted) break;
          try {
            await handle(event);
          } catch { // no-excuse-ok: catch -- one bad event must not stop the plugin from reading the rest.
          }
        }
      } catch { // no-excuse-ok: catch -- the stream closes with an error when the instance stops.
      }
    })();
    return async () => {
      controller.abort();
      await loop;
    };
  }

  return {
    handle,
    start,
    /** Steps started and not yet ended. */
    pendingSteps: (): number => steps.size,
    route: autoHandoff.route,
    /** The saved handoff, handed back once after a compaction. */
    async systemText(sessionID: string): Promise<readonly string[]> {
      const output = { system: [] as string[] };
      await autoHandoff.systemTransform({ sessionID } as Parameters<AutoHandoff["systemTransform"]>[0], output as Parameters<AutoHandoff["systemTransform"]>[1]);
      return output.system;
    }
  };
}
