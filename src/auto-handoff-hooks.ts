import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import { litHandoffPromptInjection } from "./activation-managed-prompts.ts";
import {
  assistantTokenTotal,
  autoHandoffDirective,
  autoHandoffMarker,
  createAutoHandoffSettings,
  handoffDigestText,
  readFreshHandoff,
  type AutoHandoffRouteMode,
  type AutoHandoffResolution
} from "./auto-handoff.ts";
import type { AutoHandoffConfig } from "./config.ts";
import { createSessionLookup, type SessionLookup } from "./session-lineage.ts";
import type { RuntimePaths } from "./state.ts";

type OpenCodeClient = PluginInput["client"];
type EventHook = NonNullable<Hooks["event"]>;
type SystemTransformHook = NonNullable<Hooks["experimental.chat.system.transform"]>;

export const compactReminder = "Handoff saved. Run /compact now.";

type Phase = "armed" | "crossed" | "sent" | "compacting" | "done";

type SessionState = {
  phase: Phase;
  root: boolean | undefined;
  model: { readonly providerID: string; readonly modelID: string; readonly agent: string | undefined } | undefined;
  observedPercent: number;
  sentAt: number | undefined;
  marker: string | undefined;
  sawActivity: boolean;
  digestArmed: boolean;
};

export type AutoHandoffOptions = {
  readonly projectRoot: string;
  readonly paths: Pick<RuntimePaths, "autoHandoffFile">;
  readonly client: OpenCodeClient | undefined;
  readonly config: AutoHandoffConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly getSession?: SessionLookup;
};

export type AutoHandoff = {
  readonly event: EventHook;
  readonly systemTransform: SystemTransformHook;
  readonly route: (text: string, mode: AutoHandoffRouteMode) => Promise<string | undefined>;
  readonly resolve: () => Promise<AutoHandoffResolution>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failed(result: unknown): boolean {
  return isRecord(result) && result.error !== undefined && result.error !== null;
}

/**
 * Opt-in automatic handoff for OpenCode. The plugin watches each assistant message's token count,
 * waits for the turn to end once the user's percent is reached, asks the model to save a handoff
 * that carries a session-bound marker, compacts the session itself after a verified handoff, and
 * hands the handoff back through the system prompt once, after the compaction.
 */
export function createAutoHandoff(options: AutoHandoffOptions): AutoHandoff {
  const settings = createAutoHandoffSettings({
    stateFile: options.paths.autoHandoffFile,
    config: options.config,
    ...(options.env === undefined ? {} : { env: options.env })
  });
  const client = options.client;
  const getSession = options.getSession ?? createSessionLookup(client);
  const directory = options.projectRoot;
  const sessions = new Map<string, SessionState>();
  const windows = new Map<string, number>();

  function stateFor(sessionID: string): SessionState {
    let state = sessions.get(sessionID);
    if (state === undefined) {
      state = {
        phase: "armed",
        root: undefined,
        model: undefined,
        observedPercent: 0,
        sentAt: undefined,
        marker: undefined,
        sawActivity: false,
        digestArmed: false
      };
      sessions.set(sessionID, state);
    }
    return state;
  }

  function toast(message: string, variant: "info" | "warning" = "info"): void {
    try {
      const pending = client?.tui?.showToast({ body: { title: "LitOpenCode auto-handoff", message, variant, duration: 8000 } });
      void pending?.catch(() => undefined);
    } catch { // no-excuse-ok: catch -- a missing or failing TUI must never stop the handoff.
    }
  }

  async function isRootSession(state: SessionState, sessionID: string): Promise<boolean> {
    if (state.root !== undefined) return state.root;
    if (getSession === undefined) return false;
    try {
      const session = await getSession(sessionID);
      if (session === undefined) return false;
      state.root = session.parentID === undefined;
      return state.root;
    } catch {
      return false;
    }
  }

  async function contextWindow(providerID: string, modelID: string): Promise<number | undefined> {
    const key = `${providerID}/${modelID}`;
    const known = windows.get(key);
    if (known !== undefined) return known;
    if (client?.config?.providers === undefined) return undefined;
    try {
      const result: unknown = await client.config.providers({ query: { directory } });
      const data = isRecord(result) ? result.data : undefined;
      const providers = isRecord(data) && Array.isArray(data.providers) ? data.providers : [];
      for (const provider of providers) {
        if (!isRecord(provider) || provider.id !== providerID || !isRecord(provider.models)) continue;
        const model = provider.models[modelID];
        const limit = isRecord(model) && isRecord(model.limit) ? model.limit.context : undefined;
        if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
          windows.set(key, limit);
          return limit;
        }
      }
    } catch { // no-excuse-ok: catch -- an unknown window only means no percent and no action.
    }
    return undefined;
  }

  async function onMessage(info: unknown): Promise<void> {
    if (!isRecord(info) || info.role !== "assistant" || typeof info.sessionID !== "string") return;
    const sessionID = info.sessionID;
    const state = stateFor(sessionID);

    const created = isRecord(info.time) ? info.time.created : undefined;
    if (state.phase === "sent" && state.sentAt !== undefined && typeof created === "number" && created >= state.sentAt) {
      state.sawActivity = true;
    }
    if (info.summary === true || (info.error !== undefined && info.error !== null)) return;
    const tokens = assistantTokenTotal(info);
    if (tokens === 0 || typeof info.providerID !== "string" || typeof info.modelID !== "string") return;
    state.model = {
      providerID: info.providerID,
      modelID: info.modelID,
      agent: typeof info.mode === "string" && info.mode !== "" ? info.mode : undefined
    };

    const resolved = await settings.resolve();
    if (!resolved.enabled || resolved.percent === null) return;
    if (!(await isRootSession(state, sessionID))) return;
    const window = await contextWindow(info.providerID, info.modelID);
    if (window === undefined) return;

    const reached = tokens * 100 >= resolved.percent * window;
    if (state.phase === "done" && !reached) state.phase = "armed";
    if (state.phase === "armed" && reached) {
      state.phase = "crossed";
      state.observedPercent = Math.floor((tokens * 100) / window);
    }
  }

  async function sendHandoffRequest(sessionID: string, state: SessionState): Promise<void> {
    const sentAt = Date.now();
    state.phase = "sent";
    state.sentAt = sentAt;
    state.marker = autoHandoffMarker(sessionID, sentAt);
    state.sawActivity = false;
    state.digestArmed = false;
    try {
      if (client === undefined) throw new Error("no client");
      const result: unknown = await client.session.promptAsync({
        path: { id: sessionID },
        query: { directory },
        body: {
          ...(state.model?.agent === undefined ? {} : { agent: state.model.agent }),
          ...(state.model === undefined ? {} : { model: { providerID: state.model.providerID, modelID: state.model.modelID } }),
          system: litHandoffPromptInjection,
          parts: [{ type: "text", text: autoHandoffDirective(state.observedPercent, state.marker) }]
        }
      });
      if (failed(result)) throw new Error("promptAsync refused");
    } catch {
      state.phase = "done";
      state.marker = undefined;
      toast("The automatic handoff could not be started. The conversation was left as it is.", "warning");
    }
  }

  async function sessionIsBusy(sessionID: string): Promise<boolean> {
    try {
      const result: unknown = await client?.session.status({ query: { directory } });
      const data = isRecord(result) ? result.data : undefined;
      const status = isRecord(data) ? data[sessionID] : undefined;
      return isRecord(status) && typeof status.type === "string" && status.type !== "idle";
    } catch {
      return false;
    }
  }

  async function startCompaction(sessionID: string, state: SessionState): Promise<void> {
    state.phase = "compacting";
    toast("Handoff saved. Compacting the conversation now.");
    try {
      if (client === undefined || state.model === undefined) throw new Error("no model");
      const result: unknown = await client.session.summarize({
        path: { id: sessionID },
        query: { directory },
        body: { providerID: state.model.providerID, modelID: state.model.modelID }
      });
      if (failed(result)) throw new Error("summarize refused");
      if (state.phase === "compacting") {
        state.phase = "done";
        state.digestArmed = true;
      }
    } catch {
      if (state.phase === "compacting") {
        state.phase = "done";
        toast(compactReminder);
      }
    }
  }

  async function afterHandoffReply(sessionID: string, state: SessionState): Promise<void> {
    if (!state.sawActivity || state.marker === undefined || state.sentAt === undefined) return;
    if (await sessionIsBusy(sessionID)) return;
    if (state.phase !== "sent") return;
    const fresh = await readFreshHandoff(options.projectRoot, state.marker, state.sentAt);
    if (state.phase !== "sent") return;
    if (fresh === undefined) {
      state.phase = "done";
      state.marker = undefined;
      toast(
        "No handoff carrying this session's marker was found, so the conversation was not compacted and nothing was lost.",
        "warning"
      );
      return;
    }
    // Compaction runs in the background: the host answers the request only when it has finished.
    void startCompaction(sessionID, state);
  }

  async function onIdle(sessionID: string): Promise<void> {
    const state = sessions.get(sessionID);
    if (state === undefined) return;
    if (state.phase === "crossed") {
      const resolved = await settings.resolve();
      if (state.phase !== "crossed") return;
      if (!resolved.enabled || resolved.percent === null) {
        state.phase = "armed";
        return;
      }
      await sendHandoffRequest(sessionID, state);
      return;
    }
    if (state.phase === "sent") await afterHandoffReply(sessionID, state);
  }

  function onCompacted(sessionID: string): void {
    const state = sessions.get(sessionID);
    if (state === undefined) return;
    // A compaction that arrives before any request was sent has already freed the context.
    if (state.phase === "crossed") {
      state.phase = "armed";
      return;
    }
    if (state.marker === undefined) return;
    if (state.phase === "sent" || state.phase === "compacting") state.phase = "done";
    if (state.phase === "done") state.digestArmed = true;
  }

  async function handle(hostEvent: Parameters<EventHook>[0]["event"]): Promise<void> {
    const properties: unknown = (hostEvent as { properties?: unknown }).properties;
    if (!isRecord(properties)) return;
    switch (hostEvent.type) {
      case "message.updated":
        await onMessage(properties.info);
        return;
      case "session.status": {
        const status = properties.status;
        const sessionID = properties.sessionID;
        if (typeof sessionID !== "string" || !isRecord(status)) return;
        if (status.type === "busy") {
          const state = sessions.get(sessionID);
          if (state?.phase === "sent") state.sawActivity = true;
        } else if (status.type === "idle") {
          await onIdle(sessionID);
        }
        return;
      }
      case "session.idle":
        if (typeof properties.sessionID === "string") await onIdle(properties.sessionID);
        return;
      case "session.compacted":
        if (typeof properties.sessionID === "string") onCompacted(properties.sessionID);
        return;
      case "session.deleted": {
        const info = properties.info;
        if (isRecord(info) && typeof info.id === "string") sessions.delete(info.id);
        return;
      }
      default:
        return;
    }
  }

  // The host publishes a turn's final usage update and its idle event in the same millisecond and does
  // not wait for a hook to finish, so handling them in parallel would let the idle event overtake the
  // usage update it depends on.
  let queue: Promise<void> = Promise.resolve();
  const event: EventHook = ({ event: hostEvent }) => {
    const run = queue.then(() => handle(hostEvent));
    queue = run.catch(() => undefined);
    return run;
  };

  const systemTransform: SystemTransformHook = async (input, output) => {
    if (typeof input.sessionID !== "string" || input.sessionID === "") return;
    const state = sessions.get(input.sessionID);
    if (state === undefined || !state.digestArmed || state.marker === undefined || state.sentAt === undefined) return;
    const { marker, sentAt } = state;
    state.digestArmed = false;
    state.marker = undefined;
    const fresh = await readFreshHandoff(options.projectRoot, marker, sentAt);
    if (fresh === undefined || !Array.isArray(output.system)) return;
    output.system.push(handoffDigestText(fresh.relativePath, fresh.text));
  };

  return { event, systemTransform, route: settings.route, resolve: settings.resolve };
}
