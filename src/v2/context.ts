// The slice of the OpenCode 2 server plugin context that LitOpenCode uses. The host entry passes the
// real `Plugin.Context` here, so the compiler checks this shape against `@opencode/plugin`; tests pass a
// plain object with the same members.
import type { SessionLookup } from "../session-lineage.ts";
import type { AgentEditorLike, ModelEditorLike, PermissionEvaluationLike, SessionModelDomainLike } from "./agents.ts";
import type { CommandEditorLike, CommandSessionLike } from "./commands.ts";
import type { EventDomainLike, EventModelLike, EventSessionLike } from "./events.ts";
import type { ToolAfterEvent, ToolBeforeEvent } from "./hooks.ts";
import type { NativeGoalHostLike } from "./native-goal-runtime.ts";
import type { ContextEvent, PromptEvent } from "./session-hooks.ts";
import type { ToolEditorLike } from "./tools.ts";

export type Registration = { readonly dispose: () => Promise<void> };
export type Transform<Editor> = (callback: (editor: Editor) => void) => Promise<Registration>;
type Callback<Input> = (input: Input) => Promise<void> | void;

export type LocationLike = {
  readonly directory: string;
  readonly project: { readonly directory: string };
};

type ToolHook = {
  (name: "execute.before", callback: Callback<ToolBeforeEvent>): Promise<Registration>;
  (name: "execute.after", callback: Callback<ToolAfterEvent>): Promise<Registration>;
};

export type SessionInfoLike = { readonly parentID?: string; readonly agent?: string };

type SessionHook = {
  (name: "prompt", callback: Callback<PromptEvent>): Promise<Registration>;
  (name: "context", callback: Callback<ContextEvent>): Promise<Registration>;
  (name: "compaction", callback: Callback<ContextEvent>): Promise<Registration>;
  (name: "experimental.idle", callback: Callback<{ readonly sessionID: string }>): Promise<Registration>;
};

export type SessionDomainLike = {
  readonly get: (input: { readonly sessionID: string }) => Promise<SessionInfoLike>;
};

export type ServerContextLike = {
  readonly location: LocationLike;
  readonly agent: { readonly transform: Transform<AgentEditorLike> };
  readonly tool: { readonly transform: Transform<ToolEditorLike>; readonly hook: ToolHook };
  readonly permission: { readonly hook: (name: "evaluate", callback: Callback<PermissionEvaluationLike>) => Promise<Registration> };
  readonly command: { readonly transform: Transform<CommandEditorLike> };
  readonly rpc?: NativeGoalHostLike["rpc"];
  readonly session: SessionDomainLike & SessionModelDomainLike & CommandSessionLike & EventSessionLike & NativeGoalHostLike["session"] & { readonly hook: SessionHook };
  readonly event: EventDomainLike;
  readonly model: EventModelLike & { readonly transform: Transform<ModelEditorLike> };
};

/** The project LitOpenCode keeps its ledger in: the project root, else the directory OpenCode opened. */
export function projectRootFromLocation(location: LocationLike): string {
  const project = location.project.directory.trim();
  if (project !== "" && project !== "/") return project;
  const directory = location.directory.trim();
  return directory === "" ? "." : directory;
}

/** Session lineage and agent from OpenCode 2; a failed lookup throws, and callers treat that as a child session. */
export function createSessionLookupV2(session: SessionDomainLike): SessionLookup & ((sessionID: string) => Promise<{ readonly parentID?: string; readonly agent?: string }>) {
  return async (sessionID: string) => {
    const info = await session.get({ sessionID });
    const parentID = typeof info.parentID === "string" && info.parentID.length > 0 ? info.parentID : undefined;
    const agent = typeof info.agent === "string" && info.agent.length > 0 ? info.agent : undefined;
    return { ...(parentID === undefined ? {} : { parentID }), ...(agent === undefined ? {} : { agent }) };
  };
}
