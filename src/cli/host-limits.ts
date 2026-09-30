import { isRecord } from "./json.ts";
import { writeTextAtomically } from "./install-config.ts";
import { hostLimitModelIds } from "./model-catalog.ts";
import fs from "node:fs/promises";
import path from "node:path";

export const contextCeilingTokens = 372000;
export const compactionTriggerTokens = 334800;
export const compactionReserveTokens = contextCeilingTokens - compactionTriggerTokens;
export const offeredOpenAiModels = hostLimitModelIds;

export type HostLimitMutation = {
  readonly reconfigure: boolean;
  readonly changed: boolean;
  readonly contextCeilingTokens: number;
  readonly compactionTriggerTokens: number;
  readonly compactionReserveTokens: number;
};

export type HostLimitState = {
  readonly status: "configured" | "unconfigured";
  readonly contextCeilingTokens: number;
  readonly compactionTriggerTokens: number;
  readonly compactionReserveTokens: number;
};

class HostConfigShapeError extends Error {
  readonly path: string;

  constructor(path: string) {
    super("Malformed OpenCode host config: " + path + " must be an object.");
    this.name = "HostConfigShapeError";
    this.path = path;
  }
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (isRecord(value)) return value;
  throw new HostConfigShapeError(path);
}

function modelLimit(): Record<string, number> {
  return {
    context: contextCeilingTokens,
    input: contextCeilingTokens,
    output: 128000
  };
}

export function applyHostLimits(config: Record<string, unknown> | null): Record<string, unknown> {
  const current = config ?? { "$schema": "https://opencode.ai/config.json" };
  const provider = optionalRecord(current.provider, "provider");
  const openai = optionalRecord(provider.openai, "provider.openai");
  const models = optionalRecord(openai.models, "provider.openai.models");
  const nextModels: Record<string, unknown> = { ...models };

  for (const model of offeredOpenAiModels) {
    const currentModel = optionalRecord(models[model], "provider.openai.models." + model);
    const limit = optionalRecord(currentModel.limit, "provider.openai.models." + model + ".limit");
    nextModels[model] = { ...currentModel, limit: { ...limit, ...modelLimit() } };
  }

  return {
    ...current,
    compaction: { ...optionalRecord(current.compaction, "compaction"), auto: true, reserved: compactionReserveTokens },
    provider: { ...provider, openai: { ...openai, models: nextModels } }
  };
}

export function describeHostLimitMutation(
  config: Record<string, unknown> | null,
  reconfigure: boolean
): HostLimitMutation {
  if (!reconfigure) {
    return {
      reconfigure,
      changed: false,
      contextCeilingTokens,
      compactionTriggerTokens,
      compactionReserveTokens
    };
  }
  return {
    reconfigure,
    changed: JSON.stringify(config) !== JSON.stringify(applyHostLimits(config)),
    contextCeilingTokens,
    compactionTriggerTokens,
    compactionReserveTokens
  };
}

export function inspectHostLimits(config: Record<string, unknown> | null): HostLimitState {
  const next = applyHostLimits(config);
  return {
    status: JSON.stringify(config) === JSON.stringify(next) ? "configured" : "unconfigured",
    contextCeilingTokens,
    compactionTriggerTokens,
    compactionReserveTokens
  };
}

export type HostCompactionPoint = {
  readonly autoCompaction: boolean;
  readonly percent: number | null;
};

// Only the window LitOpenCode itself configures gives a known percent; for any other model the host
// decides the window and the reserve, so no number is claimed.
export function inspectHostCompactionPoint(config: Record<string, unknown> | null): HostCompactionPoint {
  const compaction = config !== null && isRecord(config.compaction) ? config.compaction : {};
  if (compaction.auto === false) return { autoCompaction: false, percent: null };
  const configured = inspectHostLimits(config).status === "configured";
  return {
    autoCompaction: true,
    percent: configured ? Math.floor((compactionTriggerTokens * 100) / contextCeilingTokens) : null
  };
}

export async function ensureHostLimits(
  configPath: string,
  config: Record<string, unknown> | null,
  reconfigure: boolean
): Promise<void> {
  if (!reconfigure) return;
  const next = applyHostLimits(config);
  if (JSON.stringify(config) === JSON.stringify(next)) return;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await writeTextAtomically(configPath, JSON.stringify(next, null, 2) + "\n");
}
