import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import {
  LifecycleConflictError,
  LifecycleSafetyError,
  createBoundedAuthorityLifecycle,
  parseFencedProgress,
  type BoundedAuthorityOptions,
  type LifecycleInitRequest,
  type LifecycleResumeRequest,
  type LifecycleTerminalRequest
} from "./bounded-authority.ts";

type EventHook = NonNullable<Hooks["event"]>;
type OpenCodeClient = PluginInput["client"];

export type StartWorkLifecycleDirective = {
  readonly action: "init" | "resume" | "cancel" | "complete" | "status";
  readonly payload: Readonly<Record<string, unknown>>;
};

export function parseStartWorkLifecycleDirective(
  text: string,
  options: { readonly chat?: boolean } = {}
): StartWorkLifecycleDirective | undefined {
  if (typeof text !== "string" || text.length > 16_384) return undefined;
  const candidate = options.chat === true
    ? /^start-work (init|resume|cancel|complete|status)(?: (\{[^\r\n]*\}))?$/u.exec(text.trim())
    : /^(init|resume|cancel|complete|status)(?: (\{[^\r\n]*\}))?$/u.exec(text.trim());
  if (candidate === null) return undefined;
  if (candidate[1] === "status" && candidate[2] === undefined) return { action: "status", payload: {} };
  if (candidate[2] === undefined) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(candidate[2]);
  } catch {
    return undefined;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  return { action: candidate[1] as StartWorkLifecycleDirective["action"], payload: payload as Record<string, unknown> };
}

export async function applyTrustedStartWorkDirective(
  projectRoot: string,
  sessionID: string,
  directive: StartWorkLifecycleDirective,
  options: BoundedAuthorityOptions = {}
): Promise<{ readonly text: string; readonly status: string; readonly revision?: number; readonly workId?: string }> {
  if (directive.action !== "status" && directive.payload.schemaVersion !== 3) {
    throw new LifecycleSafetyError("Trusted lifecycle directives must explicitly declare schemaVersion 3.");
  }
  const lifecycle = createBoundedAuthorityLifecycle(projectRoot, options);
  let state;
  switch (directive.action) {
    case "status":
      state = await lifecycle.read();
      break;
    case "init":
      state = (await lifecycle.init({
        ...directive.payload,
        schemaVersion: 3,
        sessionID,
        trustedUser: true
      } as LifecycleInitRequest)).state;
      break;
    case "resume":
      state = (await lifecycle.resume({
        ...directive.payload,
        schemaVersion: 3,
        sessionID,
        trustedUser: true
      } as LifecycleResumeRequest)).state;
      break;
    case "cancel":
      state = (await lifecycle.cancel({
        ...directive.payload,
        schemaVersion: 3,
        sessionID,
        trustedUser: true
      } as LifecycleTerminalRequest)).state;
      break;
    case "complete":
      state = (await lifecycle.complete({
        ...directive.payload,
        schemaVersion: 3,
        sessionID,
        trustedUser: true
      } as LifecycleTerminalRequest)).state;
      break;
  }
  const receipt = {
    schemaVersion: 3,
    kind: "bounded-authority-lifecycle",
    action: directive.action,
    workId: state.workId,
    revision: state.revision,
    status: state.status,
    pendingBoundary: state.pendingBoundary === null ? null : {
      id: state.pendingBoundary.id,
      action: state.pendingBoundary.action
    }
  };
  return {
    text: `<bounded-authority-lifecycle>\n${JSON.stringify(receipt)}\n</bounded-authority-lifecycle>`,
    status: state.status,
    revision: state.revision,
    workId: state.workId
  };
}

async function assistantMessage(client: OpenCodeClient, projectRoot: string, sessionID: string, messageID: string): Promise<boolean> {
  try {
    const result = await client.session.message({
      path: { id: sessionID, messageID },
      query: { directory: projectRoot }
    });
    const info: unknown = (result as { data?: { info?: unknown } }).data?.info;
    return typeof info === "object" && info !== null && (info as { role?: unknown }).role === "assistant";
  } catch {
    return false;
  }
}

export function createBoundedAuthorityEventHook(
  projectRoot: string,
  client: OpenCodeClient | undefined,
  options: BoundedAuthorityOptions = {}
): EventHook {
  const lifecycle = createBoundedAuthorityLifecycle(projectRoot, options);
  return async ({ event }) => {
    if (client === undefined || event.type !== "message.part.updated") return;
    const part = event.properties.part;
    if (part.type !== "text" || typeof part.text !== "string") return;
    let progress;
    try {
      progress = parseFencedProgress(part.text);
    } catch {
      return;
    }
    if (progress === undefined) return;
    if (!(await assistantMessage(client, projectRoot, part.sessionID, part.messageID))) return;

    try {
      const recorded = await lifecycle.recordProgress({
        ...progress,
        sessionID: part.sessionID,
        messageID: part.messageID,
        partID: part.id
      });
      if (
        recorded.dispatchRequired !== true ||
        recorded.continuation === undefined ||
        recorded.continuationMessageID === undefined
      ) return;
      try {
        await client.session.promptAsync({
          path: { id: part.sessionID },
          query: { directory: projectRoot },
        body: {
          messageID: recorded.continuationMessageID,
          parts: [{ type: "text", text: recorded.continuation }]
          }
        });
      } catch {
        return;
      }
      await lifecycle.markContinuationSent({
        workId: recorded.state.workId,
        sessionID: recorded.state.sessionID,
        revision: recorded.state.revision,
        messageID: part.messageID,
        partID: part.id
      });
    } catch (error) {
      if (error instanceof LifecycleConflictError || error instanceof LifecycleSafetyError) return;
      throw error;
    }
  };
}
