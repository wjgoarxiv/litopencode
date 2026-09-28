import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { litOpenCodeAgents, registerLitOpenCodeAgents } from "../agents.ts";
import { defaultGlobalConfigFile, defaultGlobalConfigJson, mergeConfigs, readLitOpenCodeConfigFile, type LitOpenCodeConfig } from "../config.ts";
import { diagnoseModelRoutes, effectiveAuthoredAgentRoutes, UnsafeModelRouteError } from "../model-route-policy.ts";
import { litOpenCodeConfigFileForOpenCodeRoot } from "../state.ts";
import { isRecord, readJsonObjectIfPresent } from "./json.ts";
import { installModelEfforts, isModelProvider, modelMenuRows, stripFastSuffix } from "./model-catalog.ts";
import { classifyModelConfig, selectedLitConfig } from "./model-policy.ts";
import type { AgentConfigTarget } from "../agents/types.ts";
import type { InstallModelEffort, InstallModelRoute, InstallModelSelection, InstallPermissionMode, InstallReport, ModelConfigClassification } from "./types.ts";

type AtomicWriteOverrides = {
  readonly rename?: (from: string, to: string) => Promise<void>;
};

export async function writeTextAtomically(
  filePath: string,
  text: string,
  overrides: AtomicWriteOverrides = {}
): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), "." + path.basename(filePath) + ".tmp-" + randomUUID());
  try {
    await fs.writeFile(tempPath, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await (overrides.rename ?? fs.rename)(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function readValidatedConfig(root: string): Promise<Record<string, unknown> | null> {
  const filePath = litOpenCodeConfigFileForOpenCodeRoot(root);
  if ((await readLitOpenCodeConfigFile(filePath)) === undefined) return null;
  return await readJsonObjectIfPresent(filePath);
}

function sameJson(left: Record<string, unknown> | null, right: Record<string, unknown>): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

function uniformExistingVariant(config: Record<string, unknown> | null): string | undefined {
  if (config === null || !isRecord(config.categories)) return undefined;
  const variants = Object.values(config.categories).map((category) =>
    isRecord(category) && typeof category.variant === "string" ? category.variant : undefined
  );
  const first = variants[0];
  return first !== undefined && variants.every((variant) => variant === first) ? first : undefined;
}

export async function readInstallModelClassification(root: string): Promise<ModelConfigClassification> {
  return classifyModelConfig(await readValidatedConfig(root));
}

const installCategories = ["planning", "execution", "review", "research"] as const;
const installEfforts: readonly InstallModelEffort[] = installModelEfforts;

function existingInstallRoute(value: unknown): InstallModelRoute | undefined {
  if (!isRecord(value) || typeof value.provider !== "string" || !isModelProvider(value.provider)) return undefined;
  if (typeof value.model !== "string" || value.model.includes("/") || value.reasoningEffort !== undefined) return undefined;
  const model = value.provider === "openai" ? stripFastSuffix(value.model) : value.model;
  const row = modelMenuRows(value.provider).find((candidate) => candidate.model === model);
  if (row === undefined) return undefined;
  if (value.variant === undefined) return { provider: value.provider, model: value.model };
  if (typeof value.variant !== "string" || !installEfforts.includes(value.variant as InstallModelEffort)) return undefined;
  if (!row.efforts.includes(value.variant as InstallModelEffort)) return undefined;
  return { provider: value.provider, model: value.model, effort: value.variant as InstallModelEffort };
}

function sameInstallRoute(left: InstallModelRoute, right: InstallModelRoute): boolean {
  return left.provider === right.provider && left.model === right.model && left.effort === right.effort;
}

export async function readInstallModelSelection(root: string): Promise<InstallModelSelection | undefined> {
  const existing = await readValidatedConfig(root);
  if (existing === null) return undefined;
  const categories = existing.categories;
  if (!isRecord(categories)) return undefined;
  const routes = installCategories.map((category) => existingInstallRoute(categories[category]));
  const [planning, execution, review, research] = routes;
  if (planning === undefined || execution === undefined || review === undefined || research === undefined) return undefined;
  if (!sameInstallRoute(planning, review) || !sameInstallRoute(execution, research)) return undefined;
  return { ...planning, helper: execution };
}

export async function assertExistingModelRoutesSafe(root: string): Promise<void> {
  const existing = await readValidatedConfig(root);
  if (existing === null) return;
  const config = mergeConfigs(defaultGlobalConfigFile(), existing as Partial<LitOpenCodeConfig>);
  const diagnostics = diagnoseModelRoutes(effectiveAuthoredAgentRoutes(config, Object.keys(config.agents)));
  if (diagnostics.length > 0) throw new UnsafeModelRouteError(diagnostics);
}

function hostAgents(value: unknown): Record<string, Record<string, unknown>> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("Malformed OpenCode host config: agent must be an object.");
  const agents: Record<string, Record<string, unknown>> = {};
  for (const [agentId, agent] of Object.entries(value)) {
    if (!isRecord(agent)) throw new Error(`Malformed OpenCode host config: agent.${agentId} must be an object.`);
    agents[agentId] = agent;
  }
  return agents;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectedRoute(
  agentId: string,
  value: unknown
): NonNullable<InstallReport["routes"]>["managed"][string] {
  if (!isRecord(value)) throw new Error(`Unsafe installer route: managed agent ${agentId} is not an object.`);
  return {
    agentId,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.variant === "string" ? { variant: value.variant } : {}),
    ...(typeof value.reasoningEffort === "string" ? { reasoningEffort: value.reasoningEffort } : {}),
    status: "configured"
  };
}

export async function describeInstallRoutes(
  root: string,
  hostConfig: Record<string, unknown> | null,
  selection: InstallModelSelection | undefined,
  permissionMode: InstallPermissionMode,
  permissionModeExplicit: boolean,
  outputStyle: string
): Promise<NonNullable<InstallReport["routes"]>> {
  const existing = await readValidatedConfig(root);
  const selected = selectedLitConfig(existing, selection, permissionMode, permissionModeExplicit, outputStyle);
  const effective = mergeConfigs(defaultGlobalConfigFile(), selected as Partial<LitOpenCodeConfig>);
  const existingAgents = hostAgents(hostConfig?.agent);
  const target = { agent: { ...existingAgents } } as unknown as AgentConfigTarget;
  registerLitOpenCodeAgents(target, effective);
  const registeredAgents = target.agent;
  if (!isRecord(registeredAgents)) throw new Error("Unsafe installer route: registered agent map is malformed.");

  const managed = Object.fromEntries(
    litOpenCodeAgents.map((agent) => [agent.id, projectedRoute(agent.id, registeredAgents[agent.id])])
  );
  const preservedAgents = Object.entries(existingAgents)
    .filter(([agentId, agent]) => sameJsonValue(agent, registeredAgents[agentId]))
    .map(([agentId]) => agentId);
  const planningAgent = registeredAgents["lit-plan"];
  const planningPermissions = isRecord(planningAgent) ? (planningAgent.permission as unknown) : undefined;
  const planningTools = isRecord(planningAgent) ? planningAgent.tools : undefined;
  if (
    !isRecord(planningAgent) ||
    !isRecord(planningPermissions) ||
    planningPermissions.edit !== "deny" ||
    planningPermissions.bash !== "deny" ||
    planningPermissions.task !== "deny" ||
    !isRecord(planningTools) ||
    planningTools.write !== false ||
    planningTools.edit !== false ||
    planningTools.bash !== false ||
    planningTools.task !== false
  ) {
    throw new Error("Unsafe installer route: lit-plan planning-only permissions are not enforced.");
  }

  return {
    managed,
    preservedAgents,
    planningOnly: {
      agentId: "lit-plan",
      permissions: { edit: "deny", bash: "deny", task: "deny" },
      tools: { write: false, edit: false, bash: false, task: false }
    }
  };
}

export async function readExistingOutputStyle(root: string): Promise<string> {
  const config = await readValidatedConfig(root);
  const style = config?.outputStyle;
  return typeof style === "string" ? style : "off";
}

export async function describeLitConfigMutation(
  root: string,
  selection: InstallModelSelection | undefined,
  permissionMode: InstallPermissionMode,
  permissionModeExplicit: boolean,
  outputStyle: string = "off"
): Promise<InstallReport["litopencodeConfig"]> {
  const filePath = litOpenCodeConfigFileForOpenCodeRoot(root);
  const existing = await readValidatedConfig(root);
  const defaults = defaultGlobalConfigJson();
  const selected = selectedLitConfig(existing, selection, permissionMode, permissionModeExplicit, outputStyle);
  const existingPermissionMode =
    existing?.permissionMode === "balanced" || existing?.permissionMode === "yolo" ? existing.permissionMode : "safe";
  const existingOutputStyle = typeof existing?.outputStyle === "string" ? existing.outputStyle : "off";
  const modelChanged = selection !== undefined && !sameJson(existing, selected);
  const permissionChanged = permissionModeExplicit
    ? existingPermissionMode !== permissionMode
    : permissionMode !== "safe" && existingPermissionMode !== permissionMode;
  const outputStyleChanged = outputStyle !== "off" && existingOutputStyle !== outputStyle;
  const existingVariant = uniformExistingVariant(existing);
  return {
    path: filePath,
    alreadyPresent: existing !== null,
    changed: existing === null || modelChanged || permissionChanged || outputStyleChanged,
    agents: isRecord(defaults.agents) ? Object.keys(defaults.agents) : [],
    categories: isRecord(defaults.categories) ? Object.keys(defaults.categories) : [],
    model: {
      ...(selection ?? {}),
      classification: classifyModelConfig(existing),
      ...(existingVariant === undefined ? {} : { existingVariant }),
      changed: modelChanged
    },
    permissionMode: {
      mode: permissionModeExplicit || permissionMode !== "safe" ? permissionMode : existingPermissionMode,
      changed: permissionChanged
    },
    outputStyle: {
      style: outputStyle !== "off" ? outputStyle : existingOutputStyle,
      changed: outputStyleChanged
    }
  };
}

export async function ensureLitConfig(
  root: string,
  selection: InstallModelSelection | undefined,
  permissionMode: InstallPermissionMode,
  permissionModeExplicit: boolean,
  outputStyle: string = "off"
): Promise<void> {
  const filePath = litOpenCodeConfigFileForOpenCodeRoot(root);
  const existing = await readValidatedConfig(root);
  const next = selectedLitConfig(existing, selection, permissionMode, permissionModeExplicit, outputStyle);
  if (sameJson(existing, next)) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeTextAtomically(filePath, JSON.stringify(next, null, 2) + "\n");
}
