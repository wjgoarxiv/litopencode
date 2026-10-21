// LitOpenCode's agents on OpenCode 2. The roster, prompts, routes and permission modes are built by the
// same code the OpenCode 1 `config` hook uses; this module only re-expresses the result in OpenCode 2
// terms: an ordered permission ruleset instead of tool switches and a permission map, `system` instead
// of `prompt`, `steps` instead of `maxSteps`, and a model reference instead of a model string.
import { litOpenCodeAgents, registerLitOpenCodeAgents } from "../agents.ts";
import type { AgentConfigTarget } from "../agents/types.ts";
import { openAiModelEfforts, openaiProviderModels } from "../cli/model-catalog.ts";
import type { LitOpenCodeConfig } from "../config.ts";

export type PermissionEffect = "allow" | "deny" | "ask";
export type PermissionRule = { action: string; resource: string; effect: PermissionEffect };

export type AgentModelRef = { providerID: string; id: string; variant?: string };

/** The writable slice of an OpenCode 2 agent that LitOpenCode sets. */
export type EditableAgent = {
  system?: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden: boolean;
  color?: string;
  steps?: number;
  model?: AgentModelRef;
  permissions: PermissionRule[];
};

export type AgentEditorLike = {
  default(id: string | undefined): void;
  // The host types agent and model ids as branded strings; at run time they are plain strings, which is
  // what its own config migration writes, so the editor's agent is taken as the plain shape below.
  update(id: string, update: (agent: any) => void): void;
};

export type ModelEditorLike = {
  get(providerID: string, modelID: string): unknown;
  // Like the agent editor, the host hands out its own model objects; the fields set here are plain data.
  update(providerID: string, modelID: string, update: (model: any) => void): void;
};

/** Request settings OpenCode 2 keeps on an agent but does not send yet; the context hook sends them. */
export type AgentRequestOptions = Readonly<Record<string, unknown>>;

export type LitAgentPlan = {
  readonly agents: ReadonlyMap<string, EditableAgent>;
  readonly requestOptions: ReadonlyMap<string, AgentRequestOptions>;
  readonly hostAgents: readonly string[];
};

/**
 * Agents that only plan: the host rules deny them edits, the shell, subagents and Code Mode, and the
 * evaluate hook enforces it again. Code Mode (`execute`) runs model-written JavaScript with `fetch` and
 * the catalog tools, which OpenCode 1 never offered; a tool whose last matching rule denies "*" is left
 * out of the request entirely.
 */
export const planningOnlyAgents: ReadonlySet<string> = new Set(["lit-plan"]);
const planningDeniedActions: readonly string[] = ["edit", "shell", "subagent", "execute"];
const planningDeniedAliases: ReadonlySet<string> = new Set([...planningDeniedActions, "write", "patch", "bash", "task"]);

/** OpenCode 2 renamed these tools; a migrated rule must use the new name to keep matching. */
export function normalizeAction(action: string): string {
  if (action === "write" || action === "patch") return "edit";
  if (action === "task") return "subagent";
  if (action === "bash") return "shell";
  return action;
}

function isEffect(value: unknown): value is PermissionEffect {
  return value === "allow" || value === "deny" || value === "ask";
}

/**
 * Turns an OpenCode 1 permission map into ordered rules, the way OpenCode 2 migrates config files:
 * tool switches first (true allows, false denies), then permission keys, a later key replacing an
 * earlier one in place, and a pattern map becoming one rule per pattern in its written order.
 */
export function permissionRules(tools: Readonly<Record<string, boolean>> | undefined, permission: unknown): PermissionRule[] {
  const entries = new Map<string, unknown>();
  for (const [tool, enabled] of Object.entries(tools ?? {})) entries.set(normalizeAction(tool), enabled ? "allow" : "deny");
  if (isEffect(permission)) entries.set("*", permission);
  else if (typeof permission === "object" && permission !== null && !Array.isArray(permission)) {
    for (const [key, value] of Object.entries(permission)) entries.set(normalizeAction(key), value);
  }
  const rules: PermissionRule[] = [];
  for (const [action, value] of entries) {
    if (isEffect(value)) {
      rules.push({ action, resource: "*", effect: value });
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    for (const [resource, effect] of Object.entries(value)) if (isEffect(effect)) rules.push({ action, resource, effect });
  }
  return rules;
}

function modelRef(model: string | undefined, variant: string | undefined): AgentModelRef | undefined {
  if (model === undefined) return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return undefined;
  return {
    providerID: model.slice(0, slash),
    id: model.slice(slash + 1),
    ...(variant === undefined || variant === "" || variant.includes("#") ? {} : { variant })
  };
}

type V1Agent = {
  readonly description?: string;
  readonly prompt?: string;
  readonly mode?: string;
  readonly hidden?: boolean;
  readonly color?: string;
  readonly maxSteps?: number;
  readonly model?: string;
  readonly variant?: string;
  readonly tools?: Record<string, boolean>;
  readonly permission?: unknown;
  readonly reasoningEffort?: string;
  readonly textVerbosity?: string;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly maxTokens?: number;
};

function requestOptions(agent: V1Agent): AgentRequestOptions {
  return {
    ...(agent.temperature === undefined ? {} : { temperature: agent.temperature }),
    ...(agent.top_p === undefined ? {} : { topP: agent.top_p }),
    ...(agent.maxTokens === undefined ? {} : { maxTokens: agent.maxTokens }),
    ...(agent.reasoningEffort === undefined ? {} : { reasoningEffort: agent.reasoningEffort }),
    ...(agent.textVerbosity === undefined ? {} : { textVerbosity: agent.textVerbosity })
  };
}

/** Builds every agent edit from the LitOpenCode config, without touching the host. */
export function planLitAgents(config: LitOpenCodeConfig): LitAgentPlan {
  const target: AgentConfigTarget = {};
  registerLitOpenCodeAgents(target, config);
  // Balanced and yolo modes widen the global permission on OpenCode 1. A plugin cannot edit the global
  // ruleset on OpenCode 2, so the same rules lead each LitOpenCode agent's own ruleset instead.
  const globalRules = permissionRules(undefined, target.permission);
  const agents = new Map<string, EditableAgent>();
  const options = new Map<string, AgentRequestOptions>();
  for (const definition of litOpenCodeAgents) {
    const v1 = target.agent?.[definition.id] as V1Agent | undefined;
    if (v1 === undefined) continue;
    const rules = [...globalRules, ...permissionRules(v1.tools, v1.permission)];
    if (planningOnlyAgents.has(definition.id)) {
      for (const action of planningDeniedActions) rules.push({ action, resource: "*", effect: "deny" });
    }
    const model = modelRef(v1.model, v1.variant);
    agents.set(definition.id, {
      ...(v1.prompt === undefined ? {} : { system: v1.prompt }),
      ...(v1.description === undefined ? {} : { description: v1.description }),
      mode: v1.mode === "subagent" ? "subagent" : v1.mode === "primary" ? "primary" : "all",
      hidden: v1.hidden === true,
      ...(typeof v1.color === "string" && v1.color.startsWith("#") ? { color: v1.color } : {}),
      ...(typeof v1.maxSteps === "number" && Number.isInteger(v1.maxSteps) && v1.maxSteps > 0 ? { steps: v1.maxSteps } : {}),
      ...(model === undefined ? {} : { model }),
      permissions: rules
    });
    const request = requestOptions(v1);
    if (Object.keys(request).length > 0) options.set(definition.id, request);
  }
  return { agents, requestOptions: options, hostAgents: ["build", "plan"] };
}

/** Applies a plan inside ctx.agent.transform: creates or updates each agent, hides the host agents, sets the default. */
export function applyLitAgents(editor: AgentEditorLike, plan: LitAgentPlan): void {
  for (const id of plan.hostAgents) {
    editor.update(id, (agent: EditableAgent) => {
      agent.mode = "subagent";
      agent.hidden = true;
      agent.permissions.push({ action: "subagent", resource: "*", effect: "deny" });
    });
  }
  for (const [id, edit] of plan.agents) {
    editor.update(id, (agent: EditableAgent) => {
      const { permissions, ...fields } = edit;
      Object.assign(agent, fields);
      // Agent rules follow the host defaults the agent already carries; the last match wins.
      agent.permissions.push(...permissions.map((rule) => ({ ...rule })));
    });
  }
  editor.default("lit-loop");
}

/**
 * The OpenAI rows LitOpenCode routes to, added to the host catalog when it lacks one, as the OpenCode 1
 * `config` hook does. A row the host already has is left as the host made it, and the editor cannot
 * create a provider the user has not set up. Each effort becomes a variant shaped like the host's own
 * OpenAI rows, so a route such as `#xhigh` resolves.
 */
export function registerOpenAiProviderModels(editor: ModelEditorLike): void {
  for (const [modelID, metadata] of Object.entries(openaiProviderModels)) {
    if (editor.get("openai", modelID) !== undefined) continue;
    editor.update("openai", modelID, (model) => {
      model.name = metadata.name;
      model.capabilities = { tools: metadata.tool_call, input: ["text", "image"], output: ["text"], temperature: metadata.temperature };
      model.variants = openAiModelEfforts(modelID).map((effort) => ({
        id: effort,
        settings: { reasoningEffort: effort, reasoningSummary: "auto", include: ["reasoning.encrypted_content"] }
      }));
    });
  }
}

export type SessionModelInfoLike = { readonly parentID?: string; readonly agent?: string; readonly model?: unknown };
export type SessionModelDomainLike = {
  readonly get: (input: { readonly sessionID: string }) => Promise<SessionModelInfoLike>;
  readonly switchModel: (input: { readonly sessionID: string; readonly model: AgentModelRef }) => Promise<unknown>;
};
type CatalogModelLike = { readonly providerID: string; readonly id: string; readonly enabled?: boolean };
export type ModelListLike = {
  readonly list: () => Promise<readonly CatalogModelLike[] | { readonly data: readonly CatalogModelLike[] }>;
};

/**
 * OpenCode 2 runs a session that has no model of its own on the host default model: the agent's model
 * is only read by a client that creates the session (the TUI does, `opencode2 run` does not). This sets
 * such a root session to its agent's route, lit-loop when it names none, once the route is in the
 * catalog. A session with a model, a delegated child (the host gives it its agent's model) and an agent
 * LitOpenCode does not own keep the host's choice.
 */
export function createSessionModelRoute(plan: LitAgentPlan, session: SessionModelDomainLike, models: ModelListLike) {
  return async (sessionID: string): Promise<void> => {
    const info = await session.get({ sessionID });
    if (info.model !== undefined && info.model !== null) return;
    if (typeof info.parentID === "string" && info.parentID !== "") return;
    const route = plan.agents.get(typeof info.agent === "string" && info.agent !== "" ? info.agent : "lit-loop")?.model;
    if (route === undefined) return;
    const listed = await models.list();
    const available = Array.isArray(listed) ? listed : (listed as { data: readonly CatalogModelLike[] }).data;
    if (!available.some((model) => model.providerID === route.providerID && model.id === route.id && model.enabled !== false)) return;
    await session.switchModel({ sessionID, model: { ...route } });
  };
}

export type PermissionEvaluationLike = {
  readonly agent?: string;
  readonly action: string;
  effect: PermissionEffect;
  message?: string;
};

/** The second lock for planning-only agents: whatever the rules say, edits, the shell, subagents and Code Mode are denied. */
export function enforcePlanningOnly(evaluation: PermissionEvaluationLike): void {
  if (evaluation.agent === undefined || !planningOnlyAgents.has(evaluation.agent)) return;
  if (!planningDeniedAliases.has(evaluation.action)) return;
  evaluation.effect = "deny";
  evaluation.message = `${evaluation.agent} only plans. Ask lit-loop or run /start-work to change files or run commands.`;
}
