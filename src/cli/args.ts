import os from "node:os";
import path from "node:path";
import { installModelEfforts, isInstallModelEffort, resolveModelRoute } from "./model-catalog.ts";
import type { InstallModelEffort, InstallModelRoute, InstallModelSelection, InstallPermissionMode, LoopArgs, ModelPromptMode, ParsedArgs, PermissionPromptMode } from "./types.ts";

export const loopCommands = [
  "create-goals",
  "status",
  "record-evidence",
  "checkpoint",
  "steer",
  "complete-goals",
  "record-review-blockers"
] as const;

export type LoopCommand = (typeof loopCommands)[number];

export function isLoopCommand(command: string | undefined): command is LoopCommand {
  return loopCommands.some((candidate) => candidate === command);
}

function defaultOpenCodeRoot(): string {
  const configHome = process.env.XDG_CONFIG_HOME;
  if (configHome && configHome.length > 0) return path.join(configHome, "opencode");
  return path.join(os.homedir(), ".config", "opencode");
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let command = argv[0];
  let root = defaultOpenCodeRoot();
  let dryRun = false;
  let provider: string | undefined;
  let model: string | undefined;
  let effort: InstallModelEffort | undefined;
  let subagentModel: string | undefined;
  let subagentEffort: InstallModelEffort | undefined;
  let yes = false;
  let modelPrompt: ModelPromptMode = "auto";
  let permissionMode: ParsedArgs["permissionMode"] = "safe";
  let permissionModeExplicit = false;
  let permissionPrompt: PermissionPromptMode = "auto";
  let fetchPublicUrl: string | undefined;
  let fetchPublicJson = false;
  let fetchPublicAllowPrivateNetwork = false;
  let fetchPublicTimeoutMs: number | undefined;
  let fetchPublicMaxBytes: number | undefined;
  let projectRoot = process.cwd();
  let loopJson = false;
  let force = false;
  let needsUserDecision = false;
  let sessionId: string | undefined;
  let objective: string | undefined;
  let title: string | undefined;
  const criteria: string[] = [];
  let criterionId: string | undefined;
  let kind: string | undefined;
  let ref: string | undefined;
  let detail: string | undefined;
  let status: string | undefined;
  let summary: string | undefined;
  let directive: string | undefined;
  let resolve: string | undefined;

  if (command === "--help" || command === "-h") {
    command = "help";
  }

  const loop = isLoopCommand(command);
  const requireLoopValue = (arg: string, value: string | undefined): string => {
    if (!loop) throw new Error(`Unknown argument: ${arg}`);
    const cleaned = cleanOption(value, arg);
    if (cleaned === undefined) throw new Error(`${arg} requires a value`);
    return cleaned;
  };

  const firstOptionIndex = command === "fetch-public" ? 2 : 1;
  if (command === "fetch-public") {
    fetchPublicUrl = cleanOption(argv[1], "fetch-public URL");
    if (!fetchPublicUrl) throw new Error("fetch-public requires a URL");
  }

  for (let index = firstOptionIndex; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root" || arg === "--workdir") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      root = value;
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--no-auto-update") {
      continue;
    }
    if (arg === "--json") {
      if (command === "fetch-public") fetchPublicJson = true;
      else if (loop) loopJson = true;
      else if (command !== "doctor") throw new Error(`Unknown argument: ${arg}`);
      continue;
    }
    if (arg === "--project") {
      projectRoot = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--session-id") {
      sessionId = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--objective") {
      objective = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--title") {
      title = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--criterion") {
      criteria.push(requireLoopValue(arg, argv[index + 1]));
      index += 1;
      continue;
    }
    if (arg === "--criterion-id") {
      criterionId = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--kind") {
      kind = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--ref") {
      ref = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--detail") {
      detail = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--status") {
      status = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--summary") {
      summary = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--directive") {
      directive = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--resolve") {
      resolve = requireLoopValue(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--force") {
      if (!loop) throw new Error(`Unknown argument: ${arg}`);
      force = true;
      continue;
    }
    if (arg === "--needs-user-decision") {
      if (!loop) throw new Error(`Unknown argument: ${arg}`);
      needsUserDecision = true;
      continue;
    }
    if (arg === "--allow-private-network") {
      if (command !== "fetch-public") throw new Error(`Unknown argument: ${arg}`);
      fetchPublicAllowPrivateNetwork = true;
      continue;
    }
    if (arg === "--timeout") {
      if (command !== "fetch-public") throw new Error(`Unknown argument: ${arg}`);
      const value = argv[index + 1];
      if (!value) throw new Error("--timeout requires a value");
      fetchPublicTimeoutMs = parsePositiveInteger(value, "--timeout");
      index += 1;
      continue;
    }
    if (arg === "--max-bytes") {
      if (command !== "fetch-public") throw new Error(`Unknown argument: ${arg}`);
      const value = argv[index + 1];
      if (!value) throw new Error("--max-bytes requires a value");
      fetchPublicMaxBytes = parsePositiveInteger(value, "--max-bytes");
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      const value = argv[index + 1];
      if (!value) throw new Error("--provider requires a value");
      provider = value;
      index += 1;
      continue;
    }
    if (arg === "--model") {
      const value = argv[index + 1];
      if (!value) throw new Error("--model requires a value");
      model = value;
      index += 1;
      continue;
    }
    if (arg === "--effort") {
      const value = argv[index + 1];
      if (!value) throw new Error("--effort requires a value");
      effort = parseModelEffort(value, "--effort");
      index += 1;
      continue;
    }
    if (arg === "--subagent-model") {
      const value = argv[index + 1];
      if (!value) throw new Error("--subagent-model requires a value");
      subagentModel = value;
      index += 1;
      continue;
    }
    if (arg === "--subagent-effort") {
      const value = argv[index + 1];
      if (!value) throw new Error("--subagent-effort requires a value");
      subagentEffort = parseModelEffort(value, "--subagent-effort");
      index += 1;
      continue;
    }
    if (arg === "--yes") {
      yes = true;
      continue;
    }
    if (arg === "--model-prompt" || arg === "--select-model") {
      modelPrompt = "always";
      continue;
    }
    if (arg === "--no-model-prompt") {
      modelPrompt = "never";
      continue;
    }
    if (arg === "--permission-prompt" || arg === "--select-permissions") {
      permissionPrompt = "always";
      continue;
    }
    if (arg === "--no-permission-prompt") {
      permissionPrompt = "never";
      continue;
    }
    if (arg === "--permission-mode") {
      const value = argv[index + 1];
      if (!value) throw new Error("--permission-mode requires a value");
      permissionMode = parsePermissionMode(value, "--permission-mode");
      permissionModeExplicit = true;
      permissionPrompt = "never";
      index += 1;
      continue;
    }
    if (arg === "--yolo") {
      permissionMode = "yolo";
      permissionModeExplicit = true;
      permissionPrompt = "never";
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      command = "help";
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    command,
    root,
    fetchPublicUrl,
    fetchPublicJson,
    fetchPublicAllowPrivateNetwork,
    fetchPublicTimeoutMs,
    fetchPublicMaxBytes,
    dryRun,
    permissionMode,
    permissionModeExplicit,
    permissionPrompt: yes ? "never" : permissionPrompt,
    modelSelection: resolveModelSelection(provider, model, effort, subagentModel, subagentEffort),
    modelPrompt: yes ? "never" : modelPrompt,
    outputStylePrompt: yes ? "never" : "auto",
    loop: {
      projectRoot,
      json: loopJson,
      force,
      needsUserDecision,
      sessionId,
      objective,
      title,
      criteria: Object.freeze([...criteria]),
      criterionId,
      kind,
      ref,
      detail,
      status,
      summary,
      directive,
      resolve,
    } satisfies LoopArgs
  };
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(optionName + " requires a positive integer");
  return parsed;
}

function parsePermissionMode(value: string, optionName: string): InstallPermissionMode {
  const cleaned = cleanOption(value, optionName);
  if (cleaned === "safe" || cleaned === "balanced" || cleaned === "yolo") return cleaned;
  throw new Error(optionName + " must be one of safe, balanced, yolo");
}

function parseModelEffort(value: string, optionName: string): InstallModelEffort {
  const cleaned = cleanOption(value, optionName);
  if (cleaned !== undefined && isInstallModelEffort(cleaned)) return cleaned;
  throw new Error(optionName + " must be one of " + installModelEfforts.join(", "));
}

function cleanOption(value: string | undefined, optionName: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(optionName + " requires a non-empty value");
  return trimmed;
}

function resolveModelSelection(
  providerValue: string | undefined,
  modelValue: string | undefined,
  effort: InstallModelEffort | undefined,
  subagentModelValue: string | undefined,
  subagentEffort: InstallModelEffort | undefined
): InstallModelSelection | undefined {
  const provider = cleanOption(providerValue, "--provider");
  const model = cleanOption(modelValue, "--model");
  const subagentModel = cleanOption(subagentModelValue, "--subagent-model");
  if (provider === undefined && model === undefined) {
    if (effort !== undefined) throw new Error("--effort requires --model");
    if (subagentModel !== undefined || subagentEffort !== undefined) throw new Error("--subagent-model requires --model");
    return undefined;
  }
  if (provider !== undefined && model === undefined) throw new Error("--provider requires --model");
  if (model === undefined) return undefined;

  const slashIndex = model.indexOf("/");
  let lead: InstallModelRoute;
  if (provider === undefined) {
    if (slashIndex <= 0 || slashIndex === model.length - 1) {
      throw new Error("--model requires --provider unless the value is provider/model");
    }
    lead = resolveModelRoute(model.slice(0, slashIndex), model.slice(slashIndex + 1), effort, "--model");
  } else {
    if (slashIndex >= 0) throw new Error("Use --model <model> with --provider, or pass --model provider/model without --provider");
    lead = resolveModelRoute(provider, model, effort, "--model");
  }
  if (subagentModel === undefined) {
    if (subagentEffort !== undefined) throw new Error("--subagent-effort requires --subagent-model");
    return lead;
  }
  const helperSlash = subagentModel.indexOf("/");
  const helper =
    helperSlash > 0 && helperSlash < subagentModel.length - 1
      ? resolveModelRoute(subagentModel.slice(0, helperSlash), subagentModel.slice(helperSlash + 1), subagentEffort, "--subagent-model")
      : resolveModelRoute(lead.provider, subagentModel, subagentEffort, "--subagent-model");
  return { ...lead, helper };
}
