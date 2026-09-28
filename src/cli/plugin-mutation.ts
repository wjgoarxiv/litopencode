import type { PluginMutation } from "./types.ts";

export function isLitOpenCodeEntry(value: unknown): boolean {
  const id = pluginEntryId(value);
  return ["litopencode", "@litfamily/opencode", "@litfamily/litopencode"].some((name) => id === name || id.startsWith(`${name}@`));
}

function pluginEntryId(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function replaceLitOpenCodeEntry(value: unknown, target: string): unknown {
  if (Array.isArray(value) && isLitOpenCodeEntry(value)) return [target, ...value.slice(1)];
  return target;
}

function normalizedPluginArray(pluginValue: readonly unknown[], target: string): readonly unknown[] {
  const firstLitEntry = pluginValue.find(isLitOpenCodeEntry);
  const replacement = firstLitEntry === undefined ? target : replaceLitOpenCodeEntry(firstLitEntry, target);
  let replaced = false;
  const next: unknown[] = [];
  for (const value of pluginValue) {
    if (!isLitOpenCodeEntry(value)) {
      next.push(value);
      continue;
    }
    if (replaced) continue;
    next.push(replacement);
    replaced = true;
  }
  return next;
}

export function describePluginMutation(config: Record<string, unknown> | null, target: string): PluginMutation {
  const pluginValue = config?.plugin;
  const pluginIsArray = Array.isArray(pluginValue);
  const existingIndex = pluginIsArray ? pluginValue.findIndex(isLitOpenCodeEntry) : -1;
  const targetIndex = pluginIsArray ? pluginValue.findIndex((value) => pluginEntryId(value) === target) : -1;
  const litEntryCount = pluginIsArray ? pluginValue.filter(isLitOpenCodeEntry).length : 0;
  const alreadyPresent = targetIndex >= 0 && litEntryCount === 1;
  const currentCount = pluginIsArray ? pluginValue.length : 0;

  if (alreadyPresent) {
    return {
      changed: false,
      plugin: { alreadyPresent: true, currentCount, resultCount: currentCount, add: [] },
      patch: []
    };
  }

  const add = [target];
  if (pluginIsArray) {
    if (existingIndex >= 0) {
      if (litEntryCount > 1) {
        return {
          changed: true,
          plugin: { alreadyPresent: targetIndex >= 0, currentCount, resultCount: currentCount - litEntryCount + 1, add },
          patch: [{ op: "replace", path: "/plugin", value: normalizedPluginArray(pluginValue, target) }]
        };
      }
      return {
        changed: true,
        plugin: { alreadyPresent: true, currentCount, resultCount: currentCount, add },
        patch: [{ op: "replace", path: `/plugin/${existingIndex}`, value: replaceLitOpenCodeEntry(pluginValue[existingIndex], target) }]
      };
    }
    return {
      changed: true,
      plugin: { alreadyPresent: false, currentCount, resultCount: currentCount + 1, add },
      patch: [{ op: "add", path: "/plugin/-", value: target }]
    };
  }

  const op = config !== null && Object.hasOwn(config, "plugin") ? "replace" : "add";
  return {
    changed: true,
    plugin: { alreadyPresent: false, currentCount, resultCount: 1, add },
    patch: [{ op, path: "/plugin", value: [target] }]
  };
}

export function applyPluginMutation(
  config: Record<string, unknown> | null,
  mutation: PluginMutation,
  target: string
): Record<string, unknown> {
  const next: Record<string, unknown> =
    config === null ? { "$schema": "https://opencode.ai/config.json" } : { ...config };
  if (!mutation.changed) return next;

  const pluginValue = next.plugin;
  if (Array.isArray(pluginValue)) {
    next.plugin = pluginValue.some(isLitOpenCodeEntry) ? normalizedPluginArray(pluginValue, target) : [...pluginValue, target];
    return next;
  }

  next.plugin = [target];
  return next;
}
