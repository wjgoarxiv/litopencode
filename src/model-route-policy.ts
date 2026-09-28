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
  stripFastSuffix
} from "./cli/model-catalog.ts";

export type ModelRouteDiagnostic = {
  readonly agentId: string;
  readonly code:
    | "luna_effort_below_high"
    | "luna_xhigh_forbidden"
    | "luna_effort_conflict"
    | "terra_effort_below_high"
    | "terra_effort_conflict"
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

const safeLunaEfforts = new Set<string>(openAiModelEfforts(previousGenerationOpenAiModels.luna));
const safeTerraEfforts = new Set<string>(openAiModelEfforts(previousGenerationOpenAiModels.terra));
const safeAstraEfforts = new Set<string>(openAiModelEfforts(defaultOpenAiRoutes.lead.model));

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
    if (modelId === newGenerationOpenAiModels.sol || modelId === newGenerationOpenAiModels.luna) {
      const supported = new Set<string>(openAiModelEfforts(modelId));
      const variantUnsafe = route.variant !== undefined && !supported.has(route.variant);
      const reasoningUnsafe = route.reasoningEffort !== undefined && !supported.has(route.reasoningEffort);
      if (variantUnsafe || reasoningUnsafe || (route.variant === undefined && route.reasoningEffort === undefined)) {
        diagnostics.push({ agentId, code: "model_effort_unsupported", model, effort });
      }
      if (route.variant !== undefined && route.reasoningEffort !== undefined && route.variant !== route.reasoningEffort) {
        diagnostics.push({ agentId, code: "model_effort_conflict", model, effort });
      }
      continue;
    }
    if (modelId === previousGenerationOpenAiModels.luna) {
      const hasXhigh = route.variant === "xhigh" || route.reasoningEffort === "xhigh";
      if (
        (route.variant !== undefined && route.variant !== "xhigh" && !safeLunaEfforts.has(route.variant)) ||
        (route.reasoningEffort !== undefined && route.reasoningEffort !== "xhigh" && !safeLunaEfforts.has(route.reasoningEffort)) ||
        (route.variant === undefined && route.reasoningEffort === undefined)
      ) {
        diagnostics.push({ agentId, code: "luna_effort_below_high", model, effort });
      }
      if (hasXhigh) diagnostics.push({ agentId, code: "luna_xhigh_forbidden", model, effort });
      if (route.variant !== undefined && route.reasoningEffort !== undefined && route.variant !== route.reasoningEffort) {
        diagnostics.push({ agentId, code: "luna_effort_conflict", model, effort });
      }
      continue;
    }
    if (modelId !== previousGenerationOpenAiModels.terra) continue;
    if (
      (route.variant !== undefined && !safeTerraEfforts.has(route.variant)) ||
      (route.reasoningEffort !== undefined && !safeTerraEfforts.has(route.reasoningEffort)) ||
      (route.variant === undefined && route.reasoningEffort === undefined)
    ) {
      diagnostics.push({ agentId, code: "terra_effort_below_high", model, effort });
    }
    if (route.variant !== undefined && route.reasoningEffort !== undefined && route.variant !== route.reasoningEffort) {
      diagnostics.push({ agentId, code: "terra_effort_conflict", model, effort });
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
          case "luna_effort_below_high":
            return `${diagnostic.agentId}: Luna requires high or max (${diagnostic.model}, ${diagnostic.effort})`;
          case "luna_xhigh_forbidden":
            return `${diagnostic.agentId}: Luna plus xhigh is forbidden (${diagnostic.model}, ${diagnostic.effort})`;
          case "luna_effort_conflict":
            return `${diagnostic.agentId}: Luna effort fields conflict (${diagnostic.model}, ${diagnostic.effort})`;
          case "terra_effort_below_high":
            return `${diagnostic.agentId}: TERRA requires high or xhigh (${diagnostic.model}, ${diagnostic.effort})`;
          case "terra_effort_conflict":
            return `${diagnostic.agentId}: TERRA effort fields conflict (${diagnostic.model}, ${diagnostic.effort})`;
          case "astra_effort_unsupported":
            return `${diagnostic.agentId}: Astra requires low, medium, high, xhigh, or max (${diagnostic.model}, ${diagnostic.effort})`;
          case "astra_effort_conflict":
            return `${diagnostic.agentId}: Astra effort fields conflict (${diagnostic.model}, ${diagnostic.effort})`;
          case "model_effort_unsupported":
            return `${diagnostic.agentId}: ${diagnostic.model} accepts a supported catalog effort (${diagnostic.model}, ${diagnostic.effort})`;
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
