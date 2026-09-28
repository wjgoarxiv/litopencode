import { createRuntimePaths, type RuntimePaths } from "./state.ts";
import type { AgentPermission, AgentToolId } from "./agents/types.ts";
import { readLitOpenCodeConfigFile } from "./config-parser.ts";
import { defaultOpenAiRoutes } from "./cli/model-catalog.ts";

export { LitOpenCodeConfigError, readLitOpenCodeConfigFile } from "./config-parser.ts";

export type LogLevel = "silent" | "error" | "info" | "debug";
export type LitOpenCodeConfigSource = "defaults" | "global" | "project" | "merged";
export type LitOpenCodePermissionMode = "safe" | "balanced" | "yolo";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type TextVerbosity = "low" | "medium" | "high";

export type BoundedAuthorityConfig = {
  readonly maxEvents: number;
  readonly maxHistory: number;
  readonly maxReceipts: number;
  readonly maxContextBytes: number;
};

export type KnowledgeConfig = {
  readonly capture: boolean;
};

export type JsonScalar = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonScalar | readonly JsonValue[] | JsonObject;

export type LitOpenCodeAgentModelConfig = {
  readonly provider?: string;
  readonly model?: string;
  readonly variant?: string;
  readonly category?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly textVerbosity?: TextVerbosity;
  readonly thinking?: boolean;
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly promptAppend?: string;
  readonly tools?: Partial<Record<AgentToolId, boolean>>;
  readonly permission?: {
    readonly edit?: AgentPermission;
    readonly bash?: AgentPermission;
    readonly webfetch?: AgentPermission;
  };
  readonly providerOptions?: JsonObject;
};

export type LitOpenCodeCategoryConfig = Omit<LitOpenCodeAgentModelConfig, "category">;

export type LitOpenCodeConfig = {
  enabled: boolean;
  logLevel: LogLevel;
  permissionMode: LitOpenCodePermissionMode;
  outputStyle: string;
  boundedAuthority: BoundedAuthorityConfig;
  knowledge: KnowledgeConfig;
  agents: Record<string, LitOpenCodeAgentModelConfig>;
  categories: Record<string, LitOpenCodeCategoryConfig>;
};

export type LoadedConfig = {
  config: LitOpenCodeConfig;
  paths: RuntimePaths;
  source: LitOpenCodeConfigSource;
  sources: readonly string[];
};

type AuthoredConfigSections = {
  readonly categories: ReadonlySet<string>;
  readonly agents: ReadonlySet<string>;
};

// The runtime receives a merged config, so keep source ownership alongside
// (rather than inside) the JSON-shaped config. This never serializes into a
// user file and lets the host hook distinguish a fresh default from an
// explicit value that happens to equal that default.
const authoredConfigSections = new WeakMap<object, AuthoredConfigSections>();

export function configSectionWasAuthored(
  config: LitOpenCodeConfig,
  section: keyof AuthoredConfigSections,
  id: string
): boolean {
  return authoredConfigSections.get(config)?.[section].has(id) ?? false;
}

export const defaultConfig: LitOpenCodeConfig = Object.freeze({
  enabled: true,
  logLevel: "info",
  permissionMode: "safe",
  outputStyle: "off",
  boundedAuthority: Object.freeze({
    maxEvents: 64,
    maxHistory: 32,
    maxReceipts: 64,
    maxContextBytes: 65_536
  }),
  knowledge: Object.freeze({ capture: true }),
  categories: Object.freeze({
    planning: Object.freeze({
      provider: defaultOpenAiRoutes.lead.provider,
      model: defaultOpenAiRoutes.lead.model,
      variant: defaultOpenAiRoutes.lead.effort,
      textVerbosity: "medium"
    }),
    execution: Object.freeze({
      provider: defaultOpenAiRoutes.helper.provider,
      model: defaultOpenAiRoutes.helper.model,
      variant: defaultOpenAiRoutes.helper.effort,
      textVerbosity: "medium"
    }),
    review: Object.freeze({
      provider: defaultOpenAiRoutes.lead.provider,
      model: defaultOpenAiRoutes.lead.model,
      variant: defaultOpenAiRoutes.lead.effort,
      textVerbosity: "medium"
    }),
    research: Object.freeze({
      provider: defaultOpenAiRoutes.helper.provider,
      model: defaultOpenAiRoutes.helper.model,
      variant: defaultOpenAiRoutes.helper.effort,
      textVerbosity: "medium"
    })
  }),
  agents: Object.freeze({
    "lit-loop": Object.freeze({ category: "execution" }),
    "lit-plan": Object.freeze({ category: "planning" }),
    "lit-implement": Object.freeze({ category: "execution" }),
    "lit-architect": Object.freeze({ category: "planning" }),
    "lit-forge": Object.freeze({ category: "execution" }),
    "lit-oracle": Object.freeze({ category: "review" }),
    "lit-prover": Object.freeze({ category: "review" }),
    "lit-sentinel": Object.freeze({ category: "review" }),
    "lit-librarian": Object.freeze({ category: "research" }),
    "lit-explorer": Object.freeze({ category: "research" }),
    "lit-archive-researcher": Object.freeze({ category: "review" }),
    "lit-verdict-oracle": Object.freeze({ category: "review" }),
    "lit-strategy-planner": Object.freeze({ category: "planning" }),
    "lit-forge-worker": Object.freeze({ category: "execution" }),
    "lit-systems-architect": Object.freeze({ category: "planning" }),
    "lit-critical-reviewer": Object.freeze({ category: "review" }),
    "lit-context-cartographer": Object.freeze({ category: "review" }),
    "lit-persistence-runner": Object.freeze({ category: "execution" })
  })
});

export const litOpenCodeConfigSchema = "https://litopencode.dev/config.schema.json";

function cloneDefaultConfig(): LitOpenCodeConfig {
  return mergeConfigs(defaultConfig, {});
}

export function mergeAgentModelConfig(
  base: LitOpenCodeAgentModelConfig | undefined,
  override: LitOpenCodeAgentModelConfig | undefined
): LitOpenCodeAgentModelConfig {
  const tools = { ...(base?.tools ?? {}), ...(override?.tools ?? {}) };
  const permission = { ...(base?.permission ?? {}), ...(override?.permission ?? {}) };
  const providerOptions = { ...(base?.providerOptions ?? {}), ...(override?.providerOptions ?? {}) };

  return {
    ...(base ?? {}),
    ...(override ?? {}),
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
    ...(Object.keys(permission).length > 0 ? { permission } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {})
  };
}

export function mergeConfigs(base: LitOpenCodeConfig, override: Partial<LitOpenCodeConfig>): LitOpenCodeConfig {
  const categories: Record<string, LitOpenCodeCategoryConfig> = { ...base.categories };
  for (const [id, category] of Object.entries(override.categories ?? {})) {
    categories[id] = mergeAgentModelConfig(categories[id], category);
  }

  const agents: Record<string, LitOpenCodeAgentModelConfig> = { ...base.agents };
  for (const [id, agent] of Object.entries(override.agents ?? {})) {
    agents[id] = mergeAgentModelConfig(agents[id], agent);
  }

  const merged = {
    enabled: override.enabled ?? base.enabled,
    logLevel: override.logLevel ?? base.logLevel,
    permissionMode: override.permissionMode ?? base.permissionMode,
    outputStyle: override.outputStyle ?? base.outputStyle,
    boundedAuthority: {
      ...base.boundedAuthority,
      ...(override.boundedAuthority ?? {})
    },
    knowledge: {
      ...base.knowledge,
      ...(override.knowledge ?? {})
    },
    categories,
    agents
  };
  const baseAuthored = authoredConfigSections.get(base);
  authoredConfigSections.set(merged, {
    categories: new Set([
      ...(baseAuthored?.categories ?? []),
      ...Object.keys(override.categories ?? {})
    ]),
    agents: new Set([
      ...(baseAuthored?.agents ?? []),
      ...Object.keys(override.agents ?? {})
    ])
  });
  return merged;
}


export function defaultGlobalConfigFile(): LitOpenCodeConfig {
  return cloneDefaultConfig();
}

export function defaultGlobalConfigJson(): Record<string, unknown> {
  return {
    "$schema": litOpenCodeConfigSchema,
    ...defaultGlobalConfigFile()
  };
}

export function effectiveAgentConfig(config: LitOpenCodeConfig, agentId: string): LitOpenCodeAgentModelConfig {
  const agentConfig = config.agents[agentId] ?? {};
  const categoryConfig = agentConfig.category ? config.categories[agentConfig.category] : undefined;
  return mergeAgentModelConfig(categoryConfig, agentConfig);
}

export async function loadConfig(projectRoot: string): Promise<LoadedConfig> {
  const paths = createRuntimePaths(projectRoot);
  const globalConfig = await readLitOpenCodeConfigFile(paths.globalConfigFile);
  const projectConfig = await readLitOpenCodeConfigFile(paths.configFile);
  const sources: string[] = [];
  let source: LitOpenCodeConfigSource = "defaults";
  let config = cloneDefaultConfig();

  if (globalConfig !== undefined) {
    config = mergeConfigs(config, globalConfig);
    sources.push(paths.globalConfigFile);
    source = "global";
  }
  if (projectConfig !== undefined) {
    config = mergeConfigs(config, projectConfig);
    sources.push(paths.configFile);
    source = source === "global" ? "merged" : "project";
  }

  return { config, paths, source, sources };
}
