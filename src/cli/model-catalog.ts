import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { isRecord } from "./json.ts";
import type { InstallModelEffort, InstallModelRoute } from "./types.ts";

export type ModelProvider = "openai" | "xai";

export type ModelMenuRow = {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly effort: InstallModelEffort;
  readonly efforts: readonly InstallModelEffort[];
  readonly hint: string;
};

export type ProviderMenuRow = {
  readonly provider: ModelProvider;
  readonly label: string;
  readonly credentialEnv: string;
};

export const providerMenu: readonly ProviderMenuRow[] = [
  { provider: "openai", label: "OpenAI GPT-6 family / GPT-5.6 previous generation", credentialEnv: "OPENAI_API_KEY" },
  { provider: "xai", label: "xAI Grok", credentialEnv: "XAI_API_KEY" }
];

export const installModelEfforts = Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"] as const);
export const nativeReasoningEfforts = Object.freeze(["none", "minimal", ...installModelEfforts] as const);

export const defaultOpenAiRoutes = Object.freeze({
  lead: Object.freeze({ provider: "openai", model: "gpt-6-astra", effort: "xhigh" }),
  helper: Object.freeze({ provider: "openai", model: "gpt-6-luna", effort: "max" })
});
export const newGenerationOpenAiModels = Object.freeze({
  astra: defaultOpenAiRoutes.lead.model,
  sol: "gpt-6.1-sol",
  luna: defaultOpenAiRoutes.helper.model
} as const);

// gpt-6-sol stays accepted for existing configs. Like the GPT-5.6 ids it is a
// previous generation, but it keeps exact-id semantics: no inferred -fast alias.
export const previousGpt6OpenAiModels = Object.freeze({
  sol: "gpt-6-sol"
} as const);

export const previousGenerationOpenAiModels = Object.freeze({
  sol: "gpt-5.6-sol",
  terra: "gpt-5.6-terra",
  luna: "gpt-5.6-luna",
  family: "gpt-5.6"
} as const);

export const legacyManagedModelIds = Object.freeze(["gpt-5.4", "gpt-5.5"] as const);
export const legacyFastAliasModels = Object.freeze([
  previousGenerationOpenAiModels.sol,
  previousGenerationOpenAiModels.terra,
  previousGenerationOpenAiModels.luna,
  previousGenerationOpenAiModels.family
] as const);
export const hostLimitModelIds = Object.freeze([
  defaultOpenAiRoutes.helper.model,
  previousGenerationOpenAiModels.luna
] as const);

// The OpenAI rows are the product policy, not the host catalog. Keep every
// supported effort here so the picker, flags, config reader, and route guard
// all consume one catalog rather than maintaining independent literal lists.
export const openaiRows: readonly ModelMenuRow[] = [
  { provider: "openai", model: defaultOpenAiRoutes.lead.model, effort: defaultOpenAiRoutes.lead.effort, efforts: installModelEfforts, hint: "frontier reasoning (recommended lead)" },
  { provider: "openai", model: newGenerationOpenAiModels.sol, effort: "xhigh", efforts: installModelEfforts, hint: "coding lead (recommended alternative)" },
  { provider: "openai", model: defaultOpenAiRoutes.helper.model, effort: defaultOpenAiRoutes.helper.effort, efforts: installModelEfforts.slice(0, 5), hint: "balanced (recommended helper)" },
  { provider: "openai", model: previousGpt6OpenAiModels.sol, effort: "xhigh", efforts: installModelEfforts, hint: "coding lead, previous generation" },
  { provider: "openai", model: previousGenerationOpenAiModels.sol, effort: "xhigh", efforts: ["high", "xhigh", "max"], hint: "deepest reasoning, previous generation" },
  { provider: "openai", model: previousGenerationOpenAiModels.luna, effort: "max", efforts: ["high", "max"], hint: "balanced, previous generation" },
  { provider: "openai", model: previousGenerationOpenAiModels.family, effort: "high", efforts: ["high", "xhigh", "max"], hint: "previous generation" },
  { provider: "openai", model: previousGenerationOpenAiModels.terra, effort: "xhigh", efforts: ["high", "xhigh"], hint: "previous generation" }
];

export const openaiProviderModels = Object.freeze({
  [newGenerationOpenAiModels.astra]: Object.freeze({ name: "GPT-6 Astra", reasoning: true, temperature: false, tool_call: true }),
  [newGenerationOpenAiModels.sol]: Object.freeze({ name: "GPT-6.1 Sol", reasoning: true, temperature: false, tool_call: true }),
  [previousGpt6OpenAiModels.sol]: Object.freeze({ name: "GPT-6 Sol", reasoning: true, temperature: false, tool_call: true }),
  [newGenerationOpenAiModels.luna]: Object.freeze({ name: "GPT-6 Luna", reasoning: true, temperature: false, tool_call: true })
});

export function openAiModelRow(model: string): ModelMenuRow | undefined {
  return openaiRows.find((row) => row.model === model);
}

export function openAiModelEfforts(model: string): readonly InstallModelEffort[] {
  return openAiModelRow(model)?.efforts ?? [];
}

export function isInstallModelEffort(value: string): value is InstallModelEffort {
  return (installModelEfforts as readonly string[]).includes(value);
}

export function openaiModelHelpLine(): string {
  return openaiRows
    .map((row) => `${row.model}·${row.effort} (${row.efforts.join("/")})`)
    .join(", ");
}

export function shippedDefaultsSummary(): string {
  return `GPT-6 Astra/${defaultOpenAiRoutes.lead.effort} lead + planning/review; GPT-6 Luna/${defaultOpenAiRoutes.helper.effort} execution/research helpers`;
}

export function legacyFastAliasHelp(): string {
  return "The previous-generation GPT-5.6 rows retain their <id>-fast aliases; GPT-6 rows have no inferred -fast alias.";
}

export function modelEffortHelp(): string {
  return `GPT-6 Astra and Sol accept ${installModelEfforts.join(", ")}; GPT-6 Luna accepts ${openAiModelEfforts(newGenerationOpenAiModels.luna).join(", ")} and rejects ultra.`;
}

// Used only when the host catalog (~/.cache/opencode/models.json) is absent or unreadable.
const fallbackXaiRows: readonly ModelMenuRow[] = [
  { provider: "xai", model: "grok-4.6", effort: "xhigh", efforts: ["low", "medium", "high", "xhigh"], hint: "frontier reasoning (catalog unavailable)" },
  { provider: "xai", model: "grok-4.5", effort: "high", efforts: ["low", "medium", "high"], hint: "catalog unavailable" },
  { provider: "xai", model: "grok-4.3", effort: "high", efforts: ["low", "medium", "high"], hint: "catalog unavailable" }
];

const xaiRowLimit = 3;

export function hostCatalogPath(): string {
  const cacheHome = process.env.XDG_CACHE_HOME;
  const base = cacheHome && cacheHome.length > 0 ? cacheHome : path.join(os.homedir(), ".cache");
  return path.join(base, "opencode", "models.json");
}

function isEffort(value: unknown): value is InstallModelEffort {
  return typeof value === "string" && isInstallModelEffort(value);
}

function catalogEfforts(entry: Record<string, unknown>): readonly InstallModelEffort[] {
  if (!Array.isArray(entry.reasoning_options)) return [];
  const values: InstallModelEffort[] = [];
  for (const option of entry.reasoning_options) {
    if (!isRecord(option) || option.type !== "effort" || !Array.isArray(option.values)) continue;
    for (const value of option.values) if (isEffort(value) && !values.includes(value)) values.push(value);
  }
  return values.sort((left, right) => installModelEfforts.indexOf(left) - installModelEfforts.indexOf(right));
}

function xaiRowsFromCatalog(): readonly ModelMenuRow[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fsSync.readFileSync(hostCatalogPath(), "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.xai) || !isRecord(parsed.xai.models)) return undefined;
  const rows: { row: ModelMenuRow; release: string }[] = [];
  for (const [id, entry] of Object.entries(parsed.xai.models)) {
    if (!isRecord(entry) || entry.reasoning !== true) continue;
    const efforts = catalogEfforts(entry);
    if (efforts.length === 0) continue;
    const release = typeof entry.release_date === "string" ? entry.release_date : "";
    const top = efforts[efforts.length - 1];
    if (top === undefined) continue;
    rows.push({ row: { provider: "xai", model: id, effort: top, efforts, hint: "released " + (release || "unknown") }, release });
  }
  if (rows.length === 0) return undefined;
  rows.sort((left, right) => (left.row.model === "grok-4.6" ? -1 : right.row.model === "grok-4.6" ? 1 : right.release.localeCompare(left.release)));
  return rows.slice(0, xaiRowLimit).map((entry) => entry.row);
}

export function modelMenuRows(provider: ModelProvider): readonly ModelMenuRow[] {
  if (provider === "openai") return openaiRows;
  return xaiRowsFromCatalog() ?? fallbackXaiRows;
}

export function isModelProvider(value: string): value is ModelProvider {
  return providerMenu.some((row) => row.provider === value);
}

export function providerCredentialEnv(provider: string): string | undefined {
  return providerMenu.find((row) => row.provider === provider)?.credentialEnv;
}

// OpenCode exposes `<id>-fast` as a priority-tier alias for previous-generation
// OpenAI rows; GPT-6 rows remain exact model ids.
export function stripFastSuffix(model: string): string {
  return legacyFastAliasModels.includes(model as (typeof legacyFastAliasModels)[number])
    ? model
    : model.endsWith("-fast") && legacyFastAliasModels.includes(model.slice(0, -"-fast".length) as (typeof legacyFastAliasModels)[number])
      ? model.slice(0, -"-fast".length)
      : model;
}

export function resolveModelRoute(
  provider: string,
  model: string,
  effort: InstallModelEffort | undefined,
  optionName: string
): InstallModelRoute {
  if (!isModelProvider(provider)) {
    throw new Error(optionName + " provider must be one of " + providerMenu.map((row) => row.provider).join(", ") + " (got " + provider + ")");
  }
  const rows = modelMenuRows(provider);
  const row = rows.find((candidate) => candidate.model === (provider === "openai" ? stripFastSuffix(model) : model));
  if (row === undefined) {
    throw new Error(optionName + " model " + provider + "/" + model + " is not offered; choose one of " + rows.map((candidate) => candidate.model).join(", "));
  }
  if (effort !== undefined && !row.efforts.includes(effort)) {
    if (row.model === previousGenerationOpenAiModels.luna) throw new Error("Luna effort must be high or max");
    throw new Error(provider + "/" + model + " accepts effort " + row.efforts.join(", ") + " (got " + effort + ")");
  }
  return { provider, model, effort: effort ?? row.effort };
}
