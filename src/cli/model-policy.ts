import { defaultGlobalConfigJson } from "../config.ts";
import { isRecord } from "./json.ts";
import {
  defaultOpenAiRoutes,
  legacyManagedModelIds,
  openAiModelEfforts,
  previousGenerationOpenAiModels
} from "./model-catalog.ts";
import type { InstallModelSelection, InstallPermissionMode, ModelConfigClassification } from "./types.ts";

type NormalizedRoute = {
  readonly provider: string;
  readonly model: string;
  readonly dispatchId: string;
  readonly qualifiedModel: boolean;
  readonly variant?: string;
  readonly hasLegacyEffort: boolean;
  readonly raw: Record<string, unknown>;
};

const categoryIds = ["planning", "execution", "review", "research"] as const;
const leadCategoryIds = new Set(["planning", "review"]);
const canonicalModels = new Set<string>([defaultOpenAiRoutes.helper.model, previousGenerationOpenAiModels.luna]);
const offeredEfforts = new Set<string>(openAiModelEfforts(previousGenerationOpenAiModels.luna));
const astraEfforts = new Set<string>(openAiModelEfforts(defaultOpenAiRoutes.lead.model));
const legacyModels = new Set<string>(legacyManagedModelIds);
const managedLegacyRouteKeys = new Set(["provider", "model", "variant", "textVerbosity"]);

function normalizedRoute(value: unknown): NormalizedRoute | undefined {
  if (!isRecord(value) || typeof value.model !== "string") return undefined;
  const slashIndex = value.model.indexOf("/");
  const modelProvider = slashIndex > 0 ? value.model.slice(0, slashIndex) : undefined;
  const model = slashIndex > 0 ? value.model.slice(slashIndex + 1) : value.model;
  const provider = typeof value.provider === "string" ? value.provider : modelProvider;
  if (provider === undefined || (modelProvider !== undefined && provider !== modelProvider)) return undefined;
  return {
    provider,
    model,
    dispatchId: slashIndex > 0 ? value.model : provider + "/" + model,
    qualifiedModel: slashIndex > 0,
    ...(typeof value.variant === "string" ? { variant: value.variant } : {}),
    hasLegacyEffort: value.reasoningEffort !== undefined,
    raw: value
  };
}

function isExactManagedLegacyRoute(route: NormalizedRoute): boolean {
  const keys = Object.keys(route.raw);
  return (
    keys.length === managedLegacyRouteKeys.size &&
    keys.every((key) => managedLegacyRouteKeys.has(key)) &&
    route.provider === "openai" &&
    !route.qualifiedModel &&
    legacyModels.has(route.model) &&
    route.variant === "high" &&
    route.raw.textVerbosity === "medium" &&
    !route.hasLegacyEffort
  );
}

function result(className: ModelConfigClassification["class"], originalDispatchId: string | null = null): ModelConfigClassification {
  return { class: className, originalDispatchId };
}

function hasRouteOverride(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && ["provider", "model", "variant", "reasoningEffort"].some((field) => value[field] !== undefined);
}

function originalDispatch(value: Record<string, unknown>): string | null {
  if (typeof value.model !== "string") return null;
  if (value.model.includes("/")) return value.model;
  return typeof value.provider === "string" ? value.provider + "/" + value.model : value.model;
}

function customOverrides(rawConfig: Record<string, unknown>): readonly Record<string, unknown>[] {
  const agents = isRecord(rawConfig.agents) ? Object.values(rawConfig.agents).filter(hasRouteOverride) : [];
  const categories = isRecord(rawConfig.categories)
    ? Object.entries(rawConfig.categories)
        .filter(([id]) => !categoryIds.includes(id as (typeof categoryIds)[number]))
        .map(([, value]) => value)
        .filter((value): value is Record<string, unknown> => isRecord(value))
    : [];
  return [...agents, ...categories];
}

function uniqueOriginalDispatch(overrides: readonly Record<string, unknown>[]): string | null {
  const dispatches = [...new Set(overrides.map(originalDispatch).filter((value): value is string => value !== null))];
  return dispatches.length === 1 ? dispatches[0] : null;
}

export function classifyModelConfig(rawConfig: Record<string, unknown> | null): ModelConfigClassification {
  if (rawConfig === null) return result("fresh");
  const overrides = customOverrides(rawConfig);
  if (overrides.length > 0) return result("custom", uniqueOriginalDispatch(overrides));
  if (!isRecord(rawConfig.categories)) return result("fresh");
  const categories = rawConfig.categories;
  const keys = Object.keys(categories);
  const routes = categoryIds.map((id) => normalizedRoute(categories[id]));
  if (routes.every((route) => route === undefined)) return result("fresh");
  if (keys.length !== categoryIds.length || routes.some((route) => route === undefined)) {
    return result("mixed");
  }
  const definedRoutes = routes.filter((route): route is NormalizedRoute => route !== undefined);
  const first = definedRoutes[0];
  if (first === undefined) return result("fresh");
  const homogeneous = definedRoutes.every(
    (route) => route.dispatchId === first.dispatchId && route.variant === first.variant
  );
  if (!homogeneous || definedRoutes.some((route) => route.hasLegacyEffort)) return result("mixed");
  if (definedRoutes.every(isExactManagedLegacyRoute)) {
    return result("managed_legacy", first.dispatchId);
  }
  if (first.qualifiedModel) return result("custom", first.dispatchId);
  if (
    first.provider === "openai" &&
    first.model === defaultOpenAiRoutes.lead.model &&
    first.variant !== undefined &&
    astraEfforts.has(first.variant)
  ) {
    return result("astra_managed", first.dispatchId);
  }
  if (
    first.provider === "openai" &&
    canonicalModels.has(first.model) &&
    (first.variant === undefined || offeredEfforts.has(first.variant))
  ) {
    return result("gpt56_managed", first.dispatchId);
  }
  if (first.provider === "openai" && (first.model === previousGenerationOpenAiModels.family || first.model.startsWith(previousGenerationOpenAiModels.family + "-"))) {
    return result("gpt56_other", first.dispatchId);
  }
  return result("custom", first.dispatchId);
}

export function selectedLitConfig(
  rawConfig: Record<string, unknown> | null,
  selection: InstallModelSelection | undefined,
  permissionMode: InstallPermissionMode = "safe",
  permissionModeExplicit = false,
  outputStyle: string = "off"
): Record<string, unknown> {
  const config = rawConfig === null ? defaultGlobalConfigJson() : { ...rawConfig };
  if (permissionModeExplicit || permissionMode === "balanced" || permissionMode === "yolo") {
    config.permissionMode = permissionMode;
  }
  if (outputStyle !== "off") {
    config.outputStyle = outputStyle;
  }
  if (selection === undefined) return config;

  const defaults = defaultGlobalConfigJson();
  const defaultCategories = isRecord(defaults.categories) ? defaults.categories : {};
  const existingCategories = isRecord(config.categories) ? config.categories : {};
  const categories: Record<string, unknown> = { ...existingCategories };
  const helper = selection.helper;

  for (const id of Object.keys(defaultCategories)) {
    if (!leadCategoryIds.has(id) && helper === undefined) continue;
    const route = leadCategoryIds.has(id) ? selection : helper;
    if (route === undefined) continue;
    const current = isRecord(categories[id]) ? categories[id] : {};
    const category = { ...current };
    delete category.reasoningEffort;
    categories[id] = {
      ...category,
      provider: route.provider,
      model: route.model,
      ...(route.effort === undefined ? {} : { variant: route.effort })
    };
  }
  return { ...config, categories };
}
