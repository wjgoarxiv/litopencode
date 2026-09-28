import { litOpenCodeDefaultAgents } from "./defaults.ts";
import { litOpenCodeSpecialistAgents } from "./specialists.ts";
import { withReaderFacingCommunicationContract } from "../reader-facing-output.ts";
import {
  defaultGlobalConfigFile,
  configSectionWasAuthored,
  effectiveAgentConfig,
  type LitOpenCodeConfig,
  type LitOpenCodeAgentModelConfig,
  type ReasoningEffort
} from "../config.ts";
import {
  defaultOpenAiRoutes,
  newGenerationOpenAiModels,
  openAiModelEfforts,
  openaiProviderModels
} from "../cli/model-catalog.ts";
import { assertSafeEffectiveAgentRoutes } from "../model-route-policy.ts";
import type { AgentConfigTarget, AgentPermission, AgentToolId, LitOpenCodeAgent, OpenCodeAgentConfig } from "./types.ts";

export const litOpenCodeAgents = Object.freeze([
  ...litOpenCodeDefaultAgents,
  ...litOpenCodeSpecialistAgents
] satisfies readonly LitOpenCodeAgent[]);

const hostLeadRoute = Object.freeze({
  model: "openai/" + defaultOpenAiRoutes.lead.model,
  variant: defaultOpenAiRoutes.lead.effort,
  reasoningEffort: defaultOpenAiRoutes.lead.effort
});
const specialLeadAgentIds = Object.freeze(["momus", "litwork-reviewer"]);
const astraEfforts = new Set<ReasoningEffort>(openAiModelEfforts(newGenerationOpenAiModels.astra));

function toolsToConfig(tools: readonly AgentToolId[]): Record<string, boolean> {
  const enabledTools: Record<string, boolean> = {};
  for (const tool of tools) {
    enabledTools[tool] = true;
  }
  return enabledTools;
}

function toolsToPermission(tools: readonly AgentToolId[]): OpenCodeAgentConfig["permission"] {
  const permission: { edit?: AgentPermission; bash?: AgentPermission; webfetch?: AgentPermission; task?: AgentPermission } = {};
  if (tools.includes("edit") || tools.includes("write")) permission.edit = "allow";
  if (tools.includes("bash")) permission.bash = "allow";
  if (tools.includes("webfetch")) permission.webfetch = "allow";
  return Object.keys(permission).length > 0 ? permission : undefined;
}

const openCodePermissionKeys = Object.freeze([
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "external_directory",
  "todowrite",
  "question",
  "webfetch",
  "websearch",
  "lsp",
  "doom_loop",
  "skill"
] as const);

// Never invent a global `task` rule for an unconfigured user. If the user did
// set a global string/object policy, preserve it exactly; the lineage-aware
// runtime guard remains the authoritative child-session recursion boundary.
const globalPermissionExpansionKeys = Object.freeze(openCodePermissionKeys.filter((key) => key !== "task"));

function expandGlobalPermission(value: string): Record<string, string> {
  return {
    ...Object.fromEntries(globalPermissionExpansionKeys.map((key) => [key, value])),
    task: value
  };
}

function isPermissionObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function taskPermission(value: unknown): AgentPermission | undefined {
  const candidate = typeof value === "string" ? value : isPermissionObject(value) ? value.task : undefined;
  return candidate === "allow" || candidate === "ask" || candidate === "deny" ? candidate : undefined;
}

function applyYoloPermissionMode(config: AgentConfigTarget): void {
  const existing = config.permission;
  const basePermission =
    typeof existing === "string"
      ? expandGlobalPermission(existing)
      : isPermissionObject(existing)
        ? existing
        : {};
  config.permission = {
    ...basePermission,
    bash: "allow",
    edit: "allow",
    webfetch: "allow",
    external_directory: "allow"
  };
}

function applyBalancedPermissionMode(config: AgentConfigTarget): void {
  const existing = config.permission;
  const basePermission =
    typeof existing === "string"
      ? expandGlobalPermission(existing)
      : isPermissionObject(existing)
        ? existing
        : {};
  const existingBash = isPermissionObject(basePermission.bash) ? basePermission.bash : undefined;
  const dangerousAction = (pattern: string): "ask" | "deny" =>
    existingBash?.[pattern] === "deny" || existingBash?.["*"] === "deny" ? "deny" : "ask";
  config.permission = {
    ...basePermission,
    bash: {
      "*": "allow",
      ...(existingBash ?? {}),
      "rm -rf": dangerousAction("rm -rf"),
      "rm -rf *": dangerousAction("rm -rf *"),
      "rm -fr": dangerousAction("rm -fr"),
      "rm -fr *": dangerousAction("rm -fr *"),
      "sudo *": dangerousAction("sudo *"),
      "chmod -R *": dangerousAction("chmod -R *"),
      "chown -R *": dangerousAction("chown -R *"),
      "dd *": dangerousAction("dd *"),
      "mkfs *": dangerousAction("mkfs *")
    },
    edit: "allow",
    webfetch: "allow"
  };
}

function modePermission(agent: LitOpenCodeAgent): OpenCodeAgentConfig["permission"] {
  if (agent.id === "lit-plan") return { edit: "deny", bash: "deny", task: "deny" };
  if (agent.mode !== "primary") return { task: "deny" };
  return undefined;
}

function mergeTools(
  agent: LitOpenCodeAgent,
  override: LitOpenCodeAgentModelConfig["tools"] | undefined
): Record<string, boolean> {
  const tools: Record<string, boolean> = { ...toolsToConfig(agent.tools), ...(override ?? {}) };
  if (agent.id === "lit-plan") {
    tools.write = false;
    tools.edit = false;
    tools.bash = false;
    tools.task = false;
  }
  if (agent.mode !== "primary") {
    tools.task = false;
  }
  return tools;
}

function mergePermission(
  agent: LitOpenCodeAgent,
  override: LitOpenCodeAgentModelConfig["permission"] | undefined
): NonNullable<OpenCodeAgentConfig["permission"]> {
  return { ...(toolsToPermission(agent.tools) ?? {}), ...(override ?? {}), ...(modePermission(agent) ?? {}) };
}

function openCodeModel(override: LitOpenCodeAgentModelConfig): string | undefined {
  if (override.model === undefined) return undefined;
  if (override.provider === undefined || override.model.includes("/")) return override.model;
  return override.provider + "/" + override.model;
}

function hasAuthoredRouteFields(value: LitOpenCodeAgentModelConfig | undefined): boolean {
  return value !== undefined && ["provider", "model", "variant", "reasoningEffort"].some((field) =>
    Object.prototype.hasOwnProperty.call(value, field)
  );
}

function routeFields(value: LitOpenCodeAgentModelConfig): LitOpenCodeAgentModelConfig {
  return {
    ...(value.provider === undefined ? {} : { provider: value.provider }),
    ...(value.model === undefined ? {} : { model: value.model }),
    ...(value.variant === undefined ? {} : { variant: value.variant }),
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort })
  };
}

function leadCategoryRoute(config: LitOpenCodeConfig): LitOpenCodeAgentModelConfig | undefined {
  const planning = config.categories.planning;
  const review = config.categories.review;
  if (planning === undefined || review === undefined) return undefined;
  const planningFields = routeFields(planning);
  const reviewFields = routeFields(review);
  const leadCategoriesAuthored =
    configSectionWasAuthored(config, "categories", "planning") ||
    configSectionWasAuthored(config, "categories", "review");
  if (!leadCategoriesAuthored && configSectionWasAuthored(config, "categories", "execution")) {
    const execution = config.categories.execution;
    if (execution !== undefined) {
      const executionFields = routeFields(execution);
      if (executionFields.model !== undefined || executionFields.provider !== undefined) return executionFields;
    }
  }
  if (JSON.stringify(planningFields) === JSON.stringify(reviewFields)) {
    if (planningFields.model === undefined && planningFields.provider === undefined) return undefined;
    return planningFields;
  }
  if (leadCategoriesAuthored) {
    if (configSectionWasAuthored(config, "categories", "planning") && !configSectionWasAuthored(config, "categories", "review")) {
      return planningFields;
    }
    if (configSectionWasAuthored(config, "categories", "review") && !configSectionWasAuthored(config, "categories", "planning")) {
      return reviewFields;
    }
    return undefined;
  }

  return undefined;
}

function routeLeadAgent(
  config: LitOpenCodeConfig,
  authoredOverride: LitOpenCodeAgentModelConfig
): LitOpenCodeAgentModelConfig {
  // A user-owned lit-loop route is authoritative, even when it happens to
  // equal the old Luna/max default. Only a homogeneous lead category route
  // supplies the fresh/default lead when no direct route was authored.
  if (hasAuthoredRouteFields(config.agents["lit-loop"])) return authoredOverride;
  const lead = leadCategoryRoute(config);
  return lead === undefined ? authoredOverride : { ...authoredOverride, ...lead };
}

function applySpecialLeadRoute(
  agentTarget: NonNullable<AgentConfigTarget["agent"]>,
  agentId: string
): void {
  const existing = agentTarget[agentId];
  if (existing === undefined) return;
  if (["model", "variant", "reasoningEffort"].some((field) => Object.prototype.hasOwnProperty.call(existing, field))) return;
  agentTarget[agentId] = { ...existing, ...hostLeadRoute } as typeof existing;
}

function registerOpenAiProviderModels(config: AgentConfigTarget): void {
  const providers = config.provider ?? {};
  const openai = providers.openai;
  const models = openai?.models ?? {};
  const nextModels = { ...models };
  let changed = false;
  for (const [modelId, metadata] of Object.entries(openaiProviderModels)) {
    const existing = models[modelId];
    const next =
      existing === undefined
        ? { ...metadata }
        : {
            ...existing,
            ...(existing.name === undefined ? { name: metadata.name } : {}),
            ...(existing.reasoning === undefined ? { reasoning: metadata.reasoning } : {}),
            ...(existing.temperature === undefined ? { temperature: metadata.temperature } : {}),
            ...(existing.tool_call === undefined ? { tool_call: metadata.tool_call } : {})
          };
    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      nextModels[modelId] = next;
      changed = true;
    }
  }
  if (!changed) return;
  config.provider = {
    ...providers,
    openai: {
      ...(openai ?? {}),
      models: nextModels
    }
  };
}

function isAstraEffort(value: string): value is ReasoningEffort {
  return astraEfforts.has(value as ReasoningEffort);
}

function modelFields(override: LitOpenCodeAgentModelConfig): Partial<OpenCodeAgentConfig> {
  const model = openCodeModel(override);
  const nativeReasoningEffort =
    override.reasoningEffort ??
    (model === "openai/" + newGenerationOpenAiModels.astra && override.variant !== undefined && isAstraEffort(override.variant)
      ? override.variant
      : undefined);
  return {
    ...(model !== undefined ? { model } : {}),
    ...(override.variant !== undefined ? { variant: override.variant } : {}),
    ...(nativeReasoningEffort !== undefined ? { reasoningEffort: nativeReasoningEffort } : {}),
    ...(override.textVerbosity !== undefined ? { textVerbosity: override.textVerbosity } : {}),
    ...(override.thinking !== undefined ? { thinking: override.thinking } : {}),
    ...(override.temperature !== undefined ? { temperature: override.temperature } : {}),
    ...(override.topP !== undefined ? { top_p: override.topP } : {}),
    ...(override.maxTokens !== undefined ? { maxTokens: override.maxTokens } : {}),
    ...(override.providerOptions !== undefined ? { providerOptions: override.providerOptions } : {})
  };
}

export function toOpenCodeAgentConfig(
  agent: LitOpenCodeAgent,
  override: LitOpenCodeAgentModelConfig = {}
): OpenCodeAgentConfig {
  const permission = mergePermission(agent, override.permission);
  const authoredPrompt = override.promptAppend === undefined ? agent.prompt : agent.prompt + "\n\n" + override.promptAppend;
  const prompt = withReaderFacingCommunicationContract(authoredPrompt);
  return {
    description: agent.summary,
    prompt,
    mode: agent.mode === "primary" ? "all" : "subagent",
    tools: mergeTools(agent, override.tools),
    color: agent.color,
    maxSteps: agent.maxSteps,
    ...modelFields(override),
    ...(Object.keys(permission).length > 0 ? { permission } : {})
  };
}

export function registerLitOpenCodeAgents(
  config: AgentConfigTarget,
  litConfig: LitOpenCodeConfig = defaultGlobalConfigFile()
): void {
  const routeAgentIds = [
    ...litOpenCodeAgents.map((agent) => agent.id),
    ...specialLeadAgentIds.filter((agentId) => litConfig.agents[agentId] !== undefined)
  ];
  assertSafeEffectiveAgentRoutes(litConfig, routeAgentIds);
  registerOpenAiProviderModels(config);
  const existingBuild = config.agent?.build ?? {};
  const existingPlan = config.agent?.plan ?? {};
  const inheritedTaskPermission = taskPermission(config.permission);

  // The upstream AgentConfig permission type does not know the `task` key yet,
  // while the OpenCode host resolves it at runtime; widen at this boundary only.
  const agentTarget: NonNullable<AgentConfigTarget["agent"]> = {
    ...config.agent,
    build: {
      ...existingBuild,
      mode: "subagent",
      hidden: true,
      tools: { ...existingBuild.tools, task: false },
      permission: { ...existingBuild.permission, task: "deny" } as (typeof existingBuild)["permission"]
    },
    plan: {
      ...existingPlan,
      mode: "subagent",
      hidden: true,
      tools: { ...existingPlan.tools, task: false },
      permission: { ...existingPlan.permission, task: "deny" } as (typeof existingPlan)["permission"]
    }
  };
  config.agent = agentTarget;
  config.default_agent = "lit-loop";

  if (litConfig?.permissionMode === "balanced") {
    applyBalancedPermissionMode(config);
  }
  if (litConfig?.permissionMode === "yolo") {
    applyYoloPermissionMode(config);
  }

  const primaryTaskAllow = litConfig?.permissionMode === "yolo" || litConfig?.permissionMode === "balanced";
  for (const agent of litOpenCodeAgents) {
    const authoredOverride = effectiveAgentConfig(litConfig, agent.id);
    const override = agent.id === "lit-loop" ? routeLeadAgent(litConfig, authoredOverride) : authoredOverride;
    const agentConfig = toOpenCodeAgentConfig(agent, override);
    const entry =
      primaryTaskAllow && agent.mode === "primary" && agent.id !== "lit-plan"
        ? {
            ...agentConfig,
            permission: { ...agentConfig.permission, task: agentConfig.permission?.task ?? inheritedTaskPermission ?? "allow" }
          }
        : agentConfig;
    agentTarget[agent.id] = entry as NonNullable<AgentConfigTarget["agent"]>[string];
  }
  for (const agentId of specialLeadAgentIds) applySpecialLeadRoute(agentTarget, agentId);
}
