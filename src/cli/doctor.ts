import fs from "node:fs/promises";
import path from "node:path";
import { litOpenCodeAgents, registerLitOpenCodeAgents } from "../agents.ts";
import { defaultGlobalConfigFile, loadConfig, mergeConfigs, readLitOpenCodeConfigFile } from "../config.ts";
import {
  diagnoseModelRoutes,
  effectiveAuthoredAgentRoutes,
  projectModelRoutesForDiagnostics
} from "../model-route-policy.ts";
import { litOpenCodeConfigFileForOpenCodeRoot } from "../state.ts";
import type { CliResult } from "./types.ts";
import type { AgentConfigTarget } from "../agents/types.ts";
import { isRecord, readJsonObjectIfPresent, readPackageMetadata } from "./json.ts";
import { inspectCommandAliases } from "./command-aliases.ts";
import { inspectNativeSkills } from "./native-skills.ts";
import { openCodeHostCapabilities } from "./host-capabilities.ts";
import { inspectHostLimits } from "./host-limits.ts";
import { inspectLspCapability } from "./lsp-capability.ts";
import { probeMotionRuntime } from "./motion-runtime.ts";
import { isLitOpenCodeEntry } from "./plugin-mutation.ts";
import {
  autoUpdateInstallLockPath,
  autoUpdateJournalPath,
  autoUpdateReceiptPath,
  isAutoUpdateDisabled,
  readAutoUpdateReceipt
} from "./auto-update.ts";

function pluginSpec(metadata: { readonly name: string; readonly version: string }): string {
  return metadata.name + "@" + metadata.version;
}

function pluginEntryId(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function stripJsonComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

async function readOpenCodeConfig(root: string): Promise<{
  readonly path: string;
  readonly config: Record<string, unknown> | null;
  readonly error?: string;
}> {
  const resolvedRoot = path.resolve(root);
  const candidates = [path.join(resolvedRoot, "opencode.json"), path.join(resolvedRoot, "opencode.jsonc")];
  for (const candidate of candidates) {
    let raw: string;
    try {
      raw = await fs.readFile(candidate, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }

    try {
      const parsed: unknown = JSON.parse(candidate.endsWith(".jsonc") ? stripJsonComments(raw) : raw);
      return { path: candidate, config: isRecord(parsed) ? parsed : null, ...(isRecord(parsed) ? {} : { error: "expected object" }) };
    } catch (error) {
      return { path: candidate, config: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { path: candidates[0], config: null };
}

async function isLocalPackageEntry(root: string, value: string, packageName: string): Promise<boolean> {
  if (!(path.isAbsolute(value) || value.startsWith("."))) return false;
  const packagePath = path.join(path.isAbsolute(value) ? value : path.resolve(root, value), "package.json");
  const metadata = await readJsonObjectIfPresent(packagePath);
  return metadata?.name === packageName;
}

async function inspectPlugin(root: string, metadata: { readonly name: string; readonly version: string }): Promise<{
  readonly path: string;
  readonly expected: string;
  readonly configured: string | null;
  readonly present: boolean;
  readonly ok: boolean;
  readonly error?: string;
}> {
  const expected = pluginSpec(metadata);
  const openCodeConfig = await readOpenCodeConfig(root);
  const pluginValue = openCodeConfig.config?.plugin;
  const entries = Array.isArray(pluginValue) ? pluginValue : [];

  let configured: string | null = null;
  let present = false;
  for (const entry of entries) {
    const id = pluginEntryId(entry);
    if (id === expected || (await isLocalPackageEntry(root, id, metadata.name))) {
      configured = id;
      present = true;
      break;
    }
    if (configured === null && isLitOpenCodeEntry(entry)) configured = id;
  }

  return {
    path: openCodeConfig.path,
    expected,
    configured,
    present,
    ok: present && openCodeConfig.error === undefined,
    ...(openCodeConfig.error === undefined ? {} : { error: openCodeConfig.error })
  };
}

export async function doctor(root: string): Promise<CliResult> {
  const metadata = await readPackageMetadata();
  const loaded = await loadConfig(root);
  const openCodeLitConfigPath = litOpenCodeConfigFileForOpenCodeRoot(root);
  const openCodeLitConfig = await readLitOpenCodeConfigFile(openCodeLitConfigPath);
  const effectiveOpenCodeConfig =
    openCodeLitConfig === undefined ? defaultGlobalConfigFile() : mergeConfigs(defaultGlobalConfigFile(), openCodeLitConfig);
  const effectiveRoutes = effectiveAuthoredAgentRoutes(
    effectiveOpenCodeConfig,
    litOpenCodeAgents.map((agent) => agent.id)
  );
  const routeDiagnostics = diagnoseModelRoutes(effectiveRoutes);
  let reportedRoutes = effectiveRoutes;
  if (routeDiagnostics.length === 0) {
    const projectedTarget: AgentConfigTarget = {};
    registerLitOpenCodeAgents(projectedTarget, effectiveOpenCodeConfig);
    reportedRoutes = Object.fromEntries(
      litOpenCodeAgents.map((agent) => [
        agent.id,
        projectedTarget.agent?.[agent.id] === undefined
          ? effectiveRoutes[agent.id]
          : { ...effectiveRoutes[agent.id], ...projectedTarget.agent[agent.id] }
      ])
    ) as unknown as typeof effectiveRoutes;
  }

  const runtimeExists = await fs
    .stat(loaded.paths.runtimeDir)
    .then(() => true)
    .catch((error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    });
  const installPlugin = await inspectPlugin(root, metadata);
  const commandAliases = await inspectCommandAliases(root);
  const nativeSkills = await inspectNativeSkills(root, metadata);
  const hostConfig = await readOpenCodeConfig(root);
  const motion = probeMotionRuntime(metadata.packageRoot);

  return {
    exitCode: 0,
    stdout: JSON.stringify(
      {
        package: metadata,
        capabilities: openCodeHostCapabilities(),
        hostLimits: { path: hostConfig.path, ...inspectHostLimits(hostConfig.config) },
        lsp: inspectLspCapability(hostConfig.config),
        motion,
        config: {
          source: loaded.source,
          sources: loaded.sources,
          path: loaded.paths.configFile,
          enabled: loaded.config.enabled,
          logLevel: loaded.config.logLevel,
          knowledgeCapture: loaded.config.knowledge.capture
        },
        opencodeConfig: {
          path: openCodeLitConfigPath,
          exists: openCodeLitConfig !== undefined,
          permissionMode: effectiveOpenCodeConfig.permissionMode,
          agents: Object.keys(effectiveOpenCodeConfig.agents),
          categories: Object.keys(effectiveOpenCodeConfig.categories),
          effective: projectModelRoutesForDiagnostics(reportedRoutes, routeDiagnostics),
          routeDiagnostics
        },
        state: {
          runtimeDir: loaded.paths.runtimeDir,
          runtimeExists,
          stateFile: loaded.paths.stateFile,
          logFile: loaded.paths.logFile,
          ledgerFile: loaded.paths.ledgerFile,
          boundedAuthority: {
            schemaVersion: 3,
            stateFile: loaded.paths.lifecycleStateFile,
            eventsFile: loaded.paths.lifecycleEventsFile,
            ...loaded.config.boundedAuthority
          },
          knowledge: {
            directory: loaded.paths.knowledgeDir,
            authority: loaded.paths.knowledgeClaimsFile,
            captureEnabled: loaded.config.knowledge.capture,
            normalQueryBudgetBytes: 2048,
            hardQueryLimitBytes: 4096,
            derivedTruthFiles: false
          }
        },
        autoUpdate: {
          enabled: !isAutoUpdateDisabled(process.env),
          installLock: autoUpdateInstallLockPath(),
          journal: autoUpdateJournalPath(),
          receipt: autoUpdateReceiptPath(),
          lastReceipt: await readAutoUpdateReceipt()
        },
        install: {
          ok: installPlugin.ok && commandAliases.ok && nativeSkills.ok,
          plugin: installPlugin,
          commandAliases,
          nativeSkills
        }
      },
      null,
      2
    )
  };
}
