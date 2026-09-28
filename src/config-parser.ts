import fs from "node:fs/promises";
import { nativeReasoningEfforts } from "./cli/model-catalog.ts";
import type { AgentPermission, AgentToolId } from "./agents/types.ts";
import type {
  JsonObject,
  JsonValue,
  BoundedAuthorityConfig,
  KnowledgeConfig,
  LitOpenCodeAgentModelConfig,
  LitOpenCodeCategoryConfig,
  LitOpenCodeConfig,
  LitOpenCodePermissionMode,
  LogLevel,
  ReasoningEffort,
  TextVerbosity
} from "./config.ts";

export class LitOpenCodeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LitOpenCodeConfigError";
  }
}

const logLevels = new Set<LogLevel>(["silent", "error", "info", "debug"]);
const permissionModes = new Set<LitOpenCodePermissionMode>(["safe", "balanced", "yolo"]);
const outputStyleIds = new Set<string>(["off", "asd-ste100", "asd-ste100-ko", "eli5", "eli5-ko"]);
const reasoningEfforts = new Set<ReasoningEffort>(nativeReasoningEfforts);
const textVerbosities = new Set<TextVerbosity>(["low", "medium", "high"]);
const toolIds = new Set<AgentToolId>(["read", "write", "edit", "bash", "webfetch", "grep"]);
const permissions = new Set<AgentPermission>(["ask", "allow", "deny"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, filePath: string, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalBoolean(value: unknown, filePath: string, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be boolean.`);
  }
  return value;
}

function optionalNumber(value: unknown, filePath: string, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be a finite number.`);
  }
  return value;
}

function boundedInteger(value: unknown, filePath: string, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new LitOpenCodeConfigError(
      `Malformed LitOpenCode config at ${filePath}: ${field} must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return value as number;
}

function parseBoundedAuthority(
  value: unknown,
  filePath: string
): Partial<BoundedAuthorityConfig> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: boundedAuthority must be an object.`);
  }
  const supported = new Set(["maxEvents", "maxHistory", "maxReceipts", "maxContextBytes"]);
  for (const key of Object.keys(value)) {
    if (!supported.has(key)) {
      throw new LitOpenCodeConfigError(
        `Malformed LitOpenCode config at ${filePath}: boundedAuthority.${key} is not a supported setting.`
      );
    }
  }
  const parsed: {
    maxEvents?: number;
    maxHistory?: number;
    maxReceipts?: number;
    maxContextBytes?: number;
  } = {};
  if (value.maxEvents !== undefined) parsed.maxEvents = boundedInteger(value.maxEvents, filePath, "boundedAuthority.maxEvents", 2, 512);
  if (value.maxHistory !== undefined) parsed.maxHistory = boundedInteger(value.maxHistory, filePath, "boundedAuthority.maxHistory", 1, 256);
  if (value.maxReceipts !== undefined) parsed.maxReceipts = boundedInteger(value.maxReceipts, filePath, "boundedAuthority.maxReceipts", 4, 512);
  if (value.maxContextBytes !== undefined) {
    parsed.maxContextBytes = boundedInteger(value.maxContextBytes, filePath, "boundedAuthority.maxContextBytes", 1024, 1_048_576);
  }
  return parsed;
}

function parseKnowledge(value: unknown, filePath: string): Partial<KnowledgeConfig> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: knowledge must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (key !== "capture") {
      throw new LitOpenCodeConfigError(
        `Malformed LitOpenCode config at ${filePath}: knowledge.${key} is not a supported setting.`
      );
    }
  }
  const capture = optionalBoolean(value.capture, filePath, "knowledge.capture");
  return capture === undefined ? {} : { capture };
}

function optionalReasoningEffort(value: unknown, filePath: string, field: string): ReasoningEffort | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !reasoningEfforts.has(value as ReasoningEffort)) {
    throw new LitOpenCodeConfigError(
      `Malformed LitOpenCode config at ${filePath}: ${field} must be one of ${nativeReasoningEfforts.join(", ")}.`
    );
  }
  return value as ReasoningEffort;
}

function optionalTextVerbosity(value: unknown, filePath: string, field: string): TextVerbosity | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !textVerbosities.has(value as TextVerbosity)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be one of low, medium, high.`);
  }
  return value as TextVerbosity;
}

function parseTools(value: unknown, filePath: string, field: string): Partial<Record<AgentToolId, boolean>> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be an object.`);
  }
  const tools: Partial<Record<AgentToolId, boolean>> = {};
  for (const [tool, enabled] of Object.entries(value)) {
    if (!toolIds.has(tool as AgentToolId)) {
      throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field}.${tool} is not a supported tool id.`);
    }
    if (typeof enabled !== "boolean") {
      throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field}.${tool} must be boolean.`);
    }
    tools[tool as AgentToolId] = enabled;
  }
  return tools;
}

function parsePermission(
  value: unknown,
  filePath: string,
  field: string
): LitOpenCodeAgentModelConfig["permission"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be an object.`);
  }
  const parsed: { edit?: AgentPermission; bash?: AgentPermission; webfetch?: AgentPermission } = {};
  for (const key of ["edit", "bash", "webfetch"] as const) {
    const permission = value[key];
    if (permission === undefined || permission === null) continue;
    if (typeof permission !== "string" || !permissions.has(permission as AgentPermission)) {
      throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field}.${key} must be one of ask, allow, deny.`);
    }
    parsed[key] = permission as AgentPermission;
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function assertJsonValue(value: unknown, filePath: string, field: string): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be finite JSON.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertJsonValue(item, filePath, `${field}[${index}]`);
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, filePath, `${field}.${key}`);
    return;
  }
  throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be JSON-compatible.`);
}

function parseProviderOptions(value: unknown, filePath: string, field: string): JsonObject | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be an object.`);
  }
  assertJsonValue(value, filePath, field);
  return value as JsonObject;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function parseAgentModelConfig(value: unknown, filePath: string, field: string): LitOpenCodeAgentModelConfig {
  if (!isRecord(value)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be an object.`);
  }
  return removeUndefined({
    provider: optionalString(value.provider, filePath, `${field}.provider`),
    model: optionalString(value.model, filePath, `${field}.model`),
    variant: optionalString(value.variant, filePath, `${field}.variant`),
    category: optionalString(value.category, filePath, `${field}.category`),
    reasoningEffort: optionalReasoningEffort(value.reasoningEffort, filePath, `${field}.reasoningEffort`),
    textVerbosity: optionalTextVerbosity(value.textVerbosity, filePath, `${field}.textVerbosity`),
    thinking: optionalBoolean(value.thinking, filePath, `${field}.thinking`),
    temperature: optionalNumber(value.temperature, filePath, `${field}.temperature`),
    topP: optionalNumber(value.topP ?? value.top_p, filePath, `${field}.topP`),
    maxTokens: optionalNumber(value.maxTokens, filePath, `${field}.maxTokens`),
    promptAppend: optionalString(value.promptAppend ?? value.prompt_append, filePath, `${field}.promptAppend`),
    tools: parseTools(value.tools, filePath, `${field}.tools`),
    permission: parsePermission(value.permission, filePath, `${field}.permission`),
    providerOptions: parseProviderOptions(value.providerOptions, filePath, `${field}.providerOptions`)
  });
}

function parseCategoryConfig(value: unknown, filePath: string, field: string): LitOpenCodeCategoryConfig {
  const parsed = parseAgentModelConfig(value, filePath, field);
  const { category: _category, ...categoryConfig } = parsed;
  return categoryConfig;
}

function parseNamedMap<T>(
  value: unknown,
  filePath: string,
  field: string,
  parseItem: (item: unknown, filePath: string, field: string) => T
): Record<string, T> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} must be an object.`);
  }
  const parsed: Record<string, T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.trim().length === 0) {
      throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${field} keys must be non-empty.`);
    }
    parsed[key] = parseItem(item, filePath, `${field}.${key}`);
  }
  return parsed;
}

function parseConfig(value: unknown, filePath: string): Partial<LitOpenCodeConfig> {
  if (!isRecord(value)) {
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: expected a JSON object.`);
  }
  const config: Partial<LitOpenCodeConfig> = {};
  if ("enabled" in value) {
    if (typeof value.enabled !== "boolean") {
      throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: enabled must be boolean.`);
    }
    config.enabled = value.enabled;
  }
  if ("logLevel" in value) {
    if (typeof value.logLevel !== "string" || !logLevels.has(value.logLevel as LogLevel)) {
      throw new LitOpenCodeConfigError(
        `Malformed LitOpenCode config at ${filePath}: logLevel must be one of silent, error, info, debug.`
      );
    }
    config.logLevel = value.logLevel as LogLevel;
  }
  if ("permissionMode" in value) {
    if (typeof value.permissionMode !== "string" || !permissionModes.has(value.permissionMode as LitOpenCodePermissionMode)) {
      throw new LitOpenCodeConfigError(
        `Malformed LitOpenCode config at ${filePath}: permissionMode must be one of safe, balanced, yolo.`
      );
    }
    config.permissionMode = value.permissionMode as LitOpenCodePermissionMode;
  }
  if ("outputStyle" in value) {
    if (typeof value.outputStyle !== "string" || !outputStyleIds.has(value.outputStyle)) {
      throw new LitOpenCodeConfigError(
        `Malformed LitOpenCode config at ${filePath}: outputStyle must be one of off, asd-ste100, asd-ste100-ko, eli5, eli5-ko.`
      );
    }
    config.outputStyle = value.outputStyle;
  }
  if ("boundedAuthority" in value) {
    config.boundedAuthority = parseBoundedAuthority(value.boundedAuthority, filePath) as BoundedAuthorityConfig;
  }
  if ("knowledge" in value) {
    config.knowledge = parseKnowledge(value.knowledge, filePath) as KnowledgeConfig;
  }
  config.categories = parseNamedMap(value.categories, filePath, "categories", parseCategoryConfig);
  config.agents = parseNamedMap(value.agents, filePath, "agents", parseAgentModelConfig);
  return config;
}

export async function readLitOpenCodeConfigFile(filePath: string): Promise<Partial<LitOpenCodeConfig> | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new LitOpenCodeConfigError(`Malformed LitOpenCode config at ${filePath}: ${reason}`);
  }
  return parseConfig(parsed, filePath);
}
