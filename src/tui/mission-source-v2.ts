// The mission input on OpenCode 2. The mission model reads OpenCode 1 TUI state (messages with parts);
// OpenCode 2 has no parts, so this adapter presents its session data in that shape: a user message's
// metadata stands in for the part that carried the lit mark, and an assistant message's tool calls stand
// in for its tool parts. OpenCode 2 keeps no todo list, so todo progress comes from the ledger only.
import type { MissionStateSource } from "./mission-source.ts";

type V2Message = {
  readonly id: string;
  readonly type: string;
  readonly time?: { readonly created?: number };
  readonly metadata?: unknown;
  readonly agent?: string;
  readonly model?: { readonly providerID?: string; readonly id?: string };
  readonly tokens?: unknown;
  readonly content?: ReadonlyArray<{
    readonly type: string;
    readonly name?: string;
    readonly text?: string;
    readonly state?: { readonly status?: string; readonly input?: unknown; readonly metadata?: unknown };
    readonly time?: { readonly created?: number; readonly ran?: number; readonly completed?: number };
  }>;
};

type V2Model = { readonly providerID: string; readonly modelID: string; readonly limit?: { readonly context?: number } };

export type MissionDataV2 = {
  readonly location?: {
    readonly vcs?: { info(): { readonly branch?: { readonly current?: string } } | undefined };
    readonly model?: { list(): ReadonlyArray<V2Model> | undefined };
  };
  readonly session: {
    status(sessionID: string): "idle" | "running";
    readonly message: { list(sessionID: string): ReadonlyArray<unknown> };
    readonly permission: { list(sessionID: string): ReadonlyArray<unknown> | undefined };
    readonly form: { list(sessionID: string): ReadonlyArray<unknown> | undefined };
  };
};

function isMessage(value: unknown): value is V2Message {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string" && typeof (value as { type?: unknown }).type === "string";
}

/** OpenCode 2 session messages of one session, user and assistant only, in order. */
export function sessionMessagesV2(data: MissionDataV2, sessionID: string): readonly V2Message[] {
  return (data.session.message.list(sessionID) ?? []).filter(isMessage).filter((message) => message.type === "user" || message.type === "assistant");
}

/** The provider table the context figure reads: each model's context window, from the host's model list. */
function providersV2(data: MissionDataV2): MissionStateSource["provider"] {
  const byProvider = new Map<string, Record<string, { limit?: { context?: number } }>>();
  for (const model of data.location?.model?.list() ?? []) {
    const models = byProvider.get(model.providerID) ?? {};
    models[model.modelID] = { limit: { context: model.limit?.context } };
    byProvider.set(model.providerID, models);
  }
  return [...byProvider].map(([id, models]) => ({ id, models }));
}

export function missionStateFromV2(data: MissionDataV2, directory: string | undefined): MissionStateSource {
  const index = new Map<string, V2Message>();
  const branch = data.location?.vcs?.info()?.branch?.current?.trim();
  return {
    path: directory === undefined ? {} : { directory },
    ...(branch === undefined || branch === "" ? {} : { vcs: { branch } }),
    provider: providersV2(data),
    session: {
      messages(sessionID) {
        return sessionMessagesV2(data, sessionID).map((message) => {
          index.set(message.id, message);
          return {
            id: message.id,
            role: message.type,
            ...(message.agent === undefined ? {} : { agent: message.agent }),
            time: { created: message.time?.created },
            ...(message.model === undefined ? {} : { providerID: message.model.providerID, modelID: message.model.id }),
            ...(message.tokens === undefined ? {} : { tokens: message.tokens as never })
          };
        });
      },
      todo: () => [],
      status: (sessionID) => ({ type: data.session.status(sessionID) === "running" ? "busy" : "idle" }),
      permission: (sessionID) => data.session.permission.list(sessionID) ?? [],
      question: (sessionID) => data.session.form.list(sessionID) ?? []
    },
    part(messageID) {
      const message = index.get(messageID);
      if (message === undefined) return [];
      if (message.type === "user") return message.metadata === undefined ? [] : [{ metadata: message.metadata }];
      return (message.content ?? []).flatMap((item): ReturnType<MissionStateSource["part"]> => {
        if (item.type === "text" && typeof item.text === "string") return [{ type: "text", text: item.text }];
        if (item.type !== "tool" || typeof item.name !== "string") return [];
        return [{
          type: "tool",
          tool: item.name,
          state: {
            status: item.state?.status,
            input: item.state?.input,
            metadata: item.state?.metadata,
            time: { start: item.time?.ran ?? item.time?.created, ...(item.time?.completed === undefined ? {} : { end: item.time.completed }) }
          }
        }];
      });
    }
  };
}

export type LitMarkV2 = { readonly messageID: string; readonly name: string; readonly at: number };

/** The lit mark of the session's latest user message, if that message carries one. */
export function latestLitMarkV2(data: MissionDataV2, sessionID: string): LitMarkV2 | undefined {
  const latest = sessionMessagesV2(data, sessionID).filter((message) => message.type === "user").at(-1);
  const mark = latest === undefined || typeof latest.metadata !== "object" || latest.metadata === null
    ? undefined
    : (latest.metadata as { litopencode?: { mode?: unknown; command?: unknown } }).litopencode;
  const name = typeof mark?.mode === "string" ? mark.mode : typeof mark?.command === "string" ? mark.command : undefined;
  return latest === undefined || name === undefined || name === "" ? undefined : { messageID: latest.id, name, at: latest.time?.created ?? 0 };
}
