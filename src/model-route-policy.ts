import {
  effectiveAgentConfig,
  type LitOpenCodeAgentModelConfig,
  type LitOpenCodeConfig
} from "./config.ts";
import {
  defaultOpenAiRoutes,
  newGenerationOpenAiModels,
  openAiModelEfforts,
  previousGenerationOpenAiModels,
  previousGpt6OpenAiModels,
  replacedRetiredEffort,
  stripFastSuffix
} from "./cli/model-catalog.ts";

export type ModelRouteDiagnostic = {
  readonly agentId: string;
  readonly code:
    | "astra_effort_unsupported"
    | "astra_effort_conflict"
    | "model_effort_unsupported"
    | "model_effort_conflict";
  readonly model: string;
  readonly effort: string;
};

export type ModelRouteProjection = {
  readonly agentId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly variant?: string;
  readonly reasoningEffort?: string;
  readonly status: "configured" | "unsafe";
};

const safeAstraEfforts = new Set<string>(openAiModelEfforts(defaultOpenAiRoutes.lead.model));
// The managed rows whose effort is checked; other GPT-5.6 ids stay user-owned as before.
const guardedModels = new Set<string>([
  newGenerationOpenAiModels.sol,
  previousGpt6OpenAiModels.sol,
  newGenerationOpenAiModels.luna,
  previousGenerationOpenAiModels.luna,
  previousGenerationOpenAiModels.terra
]);

function dispatchedModel(route: LitOpenCodeAgentModelConfig): string | undefined {
  if (route.model === undefined) return undefined;
  if (route.provider === undefined || route.model.includes("/")) return route.model;
  return route.provider + "/" + route.model;
}

export function unqualifiedModel(dispatchId: string): string {
  const separator = dispatchId.lastIndexOf("/");
  const model = separator === -1 ? dispatchId : dispatchId.slice(separator + 1);
  return stripFastSuffix(model);
}

function dispatchedProvider(dispatchId: string): string | undefined {
  const separator = dispatchId.indexOf("/");
  return separator === -1 ? undefined : dispatchId.slice(0, separator);
}

function describedEffort(route: LitOpenCodeAgentModelConfig): string {
  if (route.variant !== undefined && route.reasoningEffort !== undefined) {
    return `variant=${route.variant}, reasoningEffort=${route.reasoningEffort}`;
  }
  return route.reasoningEffort ?? route.variant ?? "unspecified";
}

export function effectiveAuthoredAgentRoutes(
  config: LitOpenCodeConfig,
  agentIds: readonly string[]
): Record<string, LitOpenCodeAgentModelConfig> {
  const routes: Record<string, LitOpenCodeAgentModelConfig> = {};
  for (const agentId of agentIds) routes[agentId] = effectiveAgentConfig(config, agentId);
  return routes;
}

export function diagnoseModelRoutes(
  routes: Readonly<Record<string, LitOpenCodeAgentModelConfig>>
): readonly ModelRouteDiagnostic[] {
  const diagnostics: ModelRouteDiagnostic[] = [];
  for (const [agentId, route] of Object.entries(routes)) {
    const model = dispatchedModel(route);
    if (model === undefined) continue;
    const provider = dispatchedProvider(model);
    if (provider !== undefined && provider !== "openai") continue;
    const modelId = unqualifiedModel(model);
    const effort = describedEffort(route);
    if (modelId === newGenerationOpenAiModels.astra) {
      const variantUnsafe = route.variant !== undefined && !safeAstraEfforts.has(route.variant);
      const reasoningUnsafe = route.reasoningEffort !== undefined && !safeAstraEfforts.has(route.reasoningEffort);
      if (variantUnsafe || reasoningUnsafe || (route.variant === undefined && route.reasoningEffort === undefined)) {
        diagnostics.push({ agentId, code: "astra_effort_unsupported", model, effort });
      }
      if (route.variant !== undefined && route.reasoningEffort !== undefined && route.variant !== route.reasoningEffort) {
        diagnostics.push({ agentId, code: "astra_effort_conflict", model, effort });
      }
      continue;
    }
    // Each guarded row accepts exactly the efforts OpenCode offers for it.
    if (!guardedModels.has(modelId)) continue;
    const supported = new Set<string>(openAiModelEfforts(modelId));
    const variantUnsafe = route.variant !== undefined && !supported.has(route.variant);
    const reasoningUnsafe = route.reasoningEffort !== undefined && !supported.has(route.reasoningEffort);
    if (variantUnsafe || reasoningUnsafe || (route.variant === undefined && route.reasoningEffort === undefined)) {
      diagnostics.push({ agentId, code: "model_effort_unsupported", model, effort });
    }
    if (route.variant !== undefined && route.reasoningEffort !== undefined && route.variant !== route.reasoningEffort) {
      diagnostics.push({ agentId, code: "model_effort_conflict", model, effort });
    }
  }
  return diagnostics;
}

export function projectModelRoutesForDiagnostics(
  routes: Readonly<Record<string, LitOpenCodeAgentModelConfig>>,
  diagnostics: readonly ModelRouteDiagnostic[]
): Readonly<Record<string, ModelRouteProjection>> {
  const unsafeAgentIds = new Set(diagnostics.map((diagnostic) => diagnostic.agentId));
  const projected: Record<string, ModelRouteProjection> = {};
  for (const [agentId, route] of Object.entries(routes)) {
    projected[agentId] = {
      agentId,
      ...(route.provider === undefined ? {} : { provider: route.provider }),
      ...(route.model === undefined ? {} : { model: route.model }),
      ...(route.variant === undefined ? {} : { variant: route.variant }),
      ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
      status: unsafeAgentIds.has(agentId) ? "unsafe" : "configured"
    };
  }
  return projected;
}

export class UnsafeModelRouteError extends Error {
  readonly name = "UnsafeModelRouteError";
  readonly diagnostics: readonly ModelRouteDiagnostic[];

  constructor(diagnostics: readonly ModelRouteDiagnostic[]) {
    const summary = diagnostics
      .map((diagnostic) => {
        switch (diagnostic.code) {
          case "astra_effort_unsupported":
            return `${diagnostic.agentId}: Astra requires ${[...safeAstraEfforts].join(", ")} (${diagnostic.model}, ${diagnostic.effort})`;
          case "astra_effort_conflict":
            return `${diagnostic.agentId}: Astra effort fields conflict (${diagnostic.model}, ${diagnostic.effort})`;
          case "model_effort_unsupported":
            return `${diagnostic.agentId}: ${diagnostic.model} accepts ${openAiModelEfforts(unqualifiedModel(diagnostic.model)).join(", ")} (${diagnostic.model}, ${diagnostic.effort})`;
          case "model_effort_conflict":
            return `${diagnostic.agentId}: ${diagnostic.model} effort fields conflict (${diagnostic.model}, ${diagnostic.effort})`;
        }
      })
      .join("; ");
    super(`Unsafe effective agent model route: ${summary}`);
    this.diagnostics = diagnostics;
  }
}

export function assertSafeEffectiveAgentRoutes(
  config: LitOpenCodeConfig,
  agentIds: readonly string[]
): void {
  const diagnostics = diagnoseModelRoutes(effectiveAuthoredAgentRoutes(config, agentIds));
  if (diagnostics.length > 0) throw new UnsafeModelRouteError(diagnostics);
}

export type RetiredEffortRoute = { readonly section: "categories" | "agents"; readonly id: string; readonly model: string };

function isRouteRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The saved routes in a litopencode.json object that still name an effort OpenCode no longer offers. */
export function retiredEffortRoutes(config: unknown): readonly RetiredEffortRoute[] {
  const found: RetiredEffortRoute[] = [];
  if (!isRouteRecord(config)) return found;
  for (const section of ["categories", "agents"] as const) {
    const entries = config[section];
    if (!isRouteRecord(entries)) continue;
    for (const [id, route] of Object.entries(entries)) {
      if (!isRouteRecord(route) || typeof route.model !== "string") continue;
      const provider = typeof route.provider === "string" ? route.provider : undefined;
      const effort = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
      if (replacedRetiredEffort(provider, route.model, effort(route.variant)) === undefined && replacedRetiredEffort(provider, route.model, effort(route.reasoningEffort)) === undefined) continue;
      found.push({ section, id, model: route.model.slice(route.model.indexOf("/") + 1) });
    }
  }
  return found;
}

export function retiredEffortWarning(route: RetiredEffortRoute): string {
  return `ultra is no longer offered by OpenCode for ${route.model} (${route.section}.${route.id}); the next install moves it to max.`;
}
