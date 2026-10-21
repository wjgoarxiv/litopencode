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
    readonly state?: { readonly status?: string };
    readonly time?: { readonly created?: number; readonly ran?: number };
  }>;
};

export type MissionDataV2 = {
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

export function missionStateFromV2(data: MissionDataV2, directory: string | undefined): MissionStateSource {
  const index = new Map<string, V2Message>();
  return {
    path: directory === undefined ? {} : { directory },
    provider: [],
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
      return (message.content ?? [])
        .filter((item) => item.type === "tool" && typeof item.name === "string")
        .map((item) => ({ type: "tool", tool: item.name, state: { status: item.state?.status, time: { start: item.time?.ran ?? item.time?.created } } }));
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
