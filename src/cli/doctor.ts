import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { litOpenCodeAgents, registerLitOpenCodeAgents } from "../agents.ts";
import { defaultGlobalConfigFile, loadConfig, mergeConfigs, readLitOpenCodeConfigFile } from "../config.ts";
import {
  diagnoseModelRoutes,
  effectiveAuthoredAgentRoutes,
  retiredEffortRoutes,
  retiredEffortWarning,
  projectModelRoutesForDiagnostics
} from "../model-route-policy.ts";
import { createRuntimePaths, litOpenCodeConfigFileForOpenCodeRoot } from "../state.ts";
import type { CliResult } from "./types.ts";
import type { AgentConfigTarget } from "../agents/types.ts";
import { isRecord, readJsonObjectIfPresent, readPackageMetadata } from "./json.ts";
import { parseJsonc } from "./jsonc.ts";
import { inspectCommandAliases } from "./command-aliases.ts";
import { inspectNativeSkills } from "./native-skills.ts";
import { openCodeHostCapabilities } from "./host-capabilities.ts";
import { inspectHostCompactionPoint, inspectHostLimits } from "./host-limits.ts";
import {
  autoHandoffEnvEnabled,
  autoHandoffEnvPercent,
  createAutoHandoffSettings
} from "../auto-handoff.ts";
import { inspectLspCapability } from "./lsp-capability.ts";
import { probeMotionRuntime } from "./motion-runtime.ts";
import { agentFileState, globalAgentFilePath, readAgentFileMode } from "./agent-file.ts";
import { isLitOpenCodeEntry } from "./plugin-mutation.ts";
import { inspectTuiPlugin, planCliJsonCleanup } from "./tui-config.ts";
import { detectOpenCodeHosts, targetsV1, targetsV2, type HostChoice } from "./host-detect.ts";
import { defaultOpenCodeConfigRoot } from "../state.ts";
import {
  autoUpdateCheckPath,
  autoUpdateInstallLockPath,
  autoUpdateJournalPath,
  autoUpdateReceiptPath,
  isAutoUpdateDisabled,
  readAutoUpdateCheck,
  readAutoUpdateReceipt
} from "./auto-update.ts";

const updateNow = "npx @litfamily/litopencode@latest install";

/** Each row says what a cause means and the one thing to do about it. */
const autoUpdateRemedies = [
  { cause: "next-start", meaning: "A newer version is installed, but the OpenCode that installed it still runs the old one.", remedy: "Quit and start OpenCode again." },
  { cause: "offline", meaning: "OpenCode could not reach the npm registry at its last start, so nothing was checked.", remedy: "Check the network or proxy. The next OpenCode start checks again." },
  { cause: "backoff", meaning: "The last update to this version failed and was undone, so OpenCode waits a day before trying it again.", remedy: `Run \`${updateNow}\` to update now, or wait a day or for a newer release.` },
  { cause: "timeout", meaning: "A step of the last update ran past its 30 second limit and was undone.", remedy: `Usually a slow network. Run \`${updateNow}\` once while online.` },
  { cause: "missing-command", meaning: "npm or node was not on the PATH OpenCode started with, so the update could not run.", remedy: `Install Node.js where OpenCode can find it, or update by hand with \`${updateNow}\`.` },
  { cause: "install-failed", meaning: "The last update failed and the old setup was put back.", remedy: `Run \`${updateNow}\` and read what it prints.` },
  { cause: "stopped", meaning: "The last update could not prove the old setup came back, so the plugin refuses to load.", remedy: `Run \`${updateNow}\`. The kept backup folder holds the old files.` },
  { cause: "lock-busy", meaning: "Another OpenCode start held the update lock.", remedy: "Nothing to do; the next start tries again. If it repeats with no OpenCode open, delete the lock file." },
  { cause: "opted-out", meaning: "Automatic update is switched off by --no-auto-update or by CI, NO_UPDATE_NOTIFIER, LITOPENCODE_NO_AUTO_UPDATE or LITOPENCODE_NO_UPDATE_CHECK.", remedy: "Remove the switch from the environment OpenCode starts in." },
  { cause: "local-checkout", meaning: "The plugin runs from a git checkout, which is never updated automatically.", remedy: "Pull the checkout with git, or install the published package." }
] as const;

type AutoUpdateCause = (typeof autoUpdateRemedies)[number]["cause"];

const skipCauses: Readonly<Record<string, AutoUpdateCause>> = {
  "registry-unavailable": "offline",
  backoff: "backoff",
  "install-lock-busy": "lock-busy",
  disabled: "opted-out",
  "local-checkout": "local-checkout"
};

/**
 * Doctor reads the receipt and the record each OpenCode start leaves behind. It
 * cannot see inside a running OpenCode, so "running" means the last start seen.
 */
export async function inspectAutoUpdate(input: {
  readonly homeDir?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly pinnedVersion: string | null;
}): Promise<Record<string, unknown>> {
  const enabled = !isAutoUpdateDisabled(input.env);
  const receipt = await readAutoUpdateReceipt(input.homeDir);
  const lastCheck = await readAutoUpdateCheck(input.homeDir);
  const summary = receipt === undefined || receipt.status === "unreadable" ? undefined : receipt;
  let cause: AutoUpdateCause | null = null;
  let nextStart: string | null = null;
  if (summary !== undefined && (summary.status === "failed" || (summary.status === "rolled-back" && !(summary.rollbackOk && summary.priorStateVerified && summary.stagedStateKnown)))) {
    cause = "stopped";
  } else if (lastCheck?.reason !== undefined && skipCauses[lastCheck.reason] !== undefined) {
    cause = skipCauses[lastCheck.reason];
  } else if (lastCheck?.status === "rolled-back" && summary?.failure !== undefined) {
    cause = summary.failure.missingCommand ? "missing-command" : summary.failure.timedOut ? "timeout" : "install-failed";
  } else if (summary?.status === "updated" && summary.targetVersion !== undefined) {
    const running = lastCheck?.runningVersion ?? summary.currentVersion;
    if (running !== undefined && running !== summary.targetVersion) {
      cause = "next-start";
      nextStart = `installed ${summary.targetVersion}, running ${running}: takes effect the next time OpenCode starts`;
    }
  }
  if (cause === null && !enabled) cause = "opted-out";
  return {
    enabled,
    state: cause === null ? (lastCheck === undefined ? "unknown" : "current") : cause === "next-start" ? "next-start" : "attention",
    cause,
    nextStart,
    pinnedVersion: input.pinnedVersion,
    lastCheck: lastCheck ?? null,
    proof: "Doctor reads files only. It cannot see which version a running OpenCode has loaded; restarting OpenCode is the sure way.",
    remedies: autoUpdateRemedies,
    installLock: autoUpdateInstallLockPath(input.homeDir),
    journal: autoUpdateJournalPath(input.homeDir),
    receipt: autoUpdateReceiptPath(input.homeDir),
    check: autoUpdateCheckPath(input.homeDir),
    lastReceipt: receipt
  };
}

function pluginSpec(metadata: { readonly name: string; readonly version: string }): string {
  return metadata.name + "@" + metadata.version;
}

function pluginEntryId(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
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
      const parsed: unknown = parseJsonc(raw);
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

/**
 * The project the plugin would use from here: OpenCode's worktree is the git root above the working
 * directory, and without one the directory itself.
 */
export function doctorProjectRoot(cwd: string = process.cwd()): string {
  const start = path.resolve(cwd);
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fsSync.existsSync(path.join(dir, ".git"))) return dir;
    if (path.dirname(dir) === dir) return start;
  }
}

/** OpenCode 2's update policy for plugins, read from the shared `autoupdate` setting and its opt-out variable. */
export function openCode2UpdatePolicy(config: Record<string, unknown> | null, env: NodeJS.ProcessEnv = process.env): "auto" | "notify" | "off" {
  const disabled = env.OPENCODE_DISABLE_AUTOUPDATE;
  if (disabled !== undefined && disabled !== "" && disabled !== "0" && disabled.toLowerCase() !== "false") return "off";
  const value = config?.autoupdate;
  if (value === false) return "off";
  if (value === "notify") return "notify";
  return "auto";
}

async function litEntryCount(root: string, config: Record<string, unknown> | null, packageName: string): Promise<number> {
  const entries = [
    ...(Array.isArray(config?.plugin) ? config.plugin : []),
    ...(Array.isArray(config?.plugins) ? config.plugins : [])
  ];
  let count = 0;
  for (const entry of entries) {
    const id = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as { package?: unknown }).package : pluginEntryId(entry);
    if (isLitOpenCodeEntry(id) || (typeof id === "string" && (await isLocalPackageEntry(root, id, packageName)))) count += 1;
  }
  return count;
}

export async function doctor(root: string, hostChoice: HostChoice = "auto"): Promise<CliResult> {
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
  // The TUI panel is optional, so a missing entry is reported here without failing install.ok.
  const tui = await inspectTuiPlugin(root, installPlugin.present && installPlugin.configured !== null ? installPlugin.configured : installPlugin.expected);
  const hostConfig = await readOpenCodeConfig(root);
  const motion = probeMotionRuntime(metadata.packageRoot);
  // The plugin keeps the auto-handoff setting per project, so doctor reads it from the project too.
  const project = doctorProjectRoot();
  const projectPaths = createRuntimePaths(project);
  const projectLitConfig = await readLitOpenCodeConfigFile(projectPaths.configFile);
  const autoHandoffConfig = projectLitConfig === undefined ? effectiveOpenCodeConfig : mergeConfigs(effectiveOpenCodeConfig, projectLitConfig);
  const autoHandoff = await createAutoHandoffSettings({
    stateFile: projectPaths.autoHandoffFile,
    config: autoHandoffConfig.autoHandoff
  }).resolve();
  const hostCompaction = inspectHostCompactionPoint(hostConfig.config);
  // Doctor never starts a host: it reads the npm package behind each command, and on a custom root only
  // that root's config files.
  const defaultRoot = path.resolve(root) === path.resolve(defaultOpenCodeConfigRoot());
  const host = await detectOpenCodeHosts({
    root,
    override: hostChoice,
    ...(defaultRoot ? {} : { resolvePackage: async () => undefined })
  });
  const forV1 = targetsV1(host.mode);
  const forV2 = targetsV2(host.mode);
  const pluginEntries = await litEntryCount(root, hostConfig.config, metadata.name);
  const cliJson = await planCliJsonCleanup(root).then(
    (plan) => ({ path: plan.path, stale: plan.removed }),
    (error: unknown) => ({ path: path.join(path.resolve(root), "cli.json"), stale: 0, error: error instanceof Error ? error.message : String(error) })
  );
  const hostOnlyPresent = ["permissions", "policies"].filter((key) => hostConfig.config !== null && key in hostConfig.config);
  const hostOnlyKeys = {
    present: hostOnlyPresent,
    breaksOpenCode1: forV1 && hostOnlyPresent.includes("permissions"),
    note: "OpenCode 1 refuses to start when the shared opencode.json holds the OpenCode 2 `permissions` key. LitOpenCode never writes `permissions` or `policies`."
  };
  const openCode2Ok = !forV2 || (pluginEntries === 1 && cliJson.stale === 0);
  const autoHandoffWarnings = [...autoHandoff.warnings];
  if (autoHandoff.enabled && autoHandoff.percent !== null && hostCompaction.percent !== null && autoHandoff.percent >= hostCompaction.percent) {
    autoHandoffWarnings.push(
      `OpenCode compacts on its own at about ${hostCompaction.percent}% of the context window. Your ${autoHandoff.percent}% is at or above that, so the host compacts first and the handoff has no time to run. Choose a percent below ${hostCompaction.percent}.`
    );
  }

  const agentFilePath = globalAgentFilePath(root);
  const agentFileMode = await readAgentFileMode(root);
  const agentFileBlock = agentFileMode === "off" ? "off" : agentFileState({ path: agentFilePath, version: metadata.version });

  return {
    exitCode: 0,
    stdout: JSON.stringify(
      {
        package: metadata,
        agentFile: {
          path: agentFilePath,
          state: agentFileBlock,
          mode: agentFileMode,
          line: `AGENT_FILE: ${agentFileBlock} (${agentFilePath}; change: litopencode agent-file on|off)`
        },
        capabilities: openCodeHostCapabilities(),
        hostLimits: { path: hostConfig.path, ...inspectHostLimits(hostConfig.config) },
        host: {
          mode: host.mode,
          binaries: host.binaries,
          ...(host.unplaced === undefined ? {} : { unplaced: host.unplaced }),
          evidence: host.evidence,
          ...(host.override === undefined ? {} : { override: host.override }),
          updatePolicy: forV2 ? openCode2UpdatePolicy(hostConfig.config) : null,
          note: "OpenCode 1 runs as `opencode` and OpenCode 2 as `opencode2` when both are installed; they share this config folder."
        },
        lsp: {
          ...inspectLspCapability(hostConfig.config),
          ...(forV2 ? { openCode2: "OpenCode 2 accepts the lsp settings but does not run language servers, so it reports no diagnostics from them." } : {})
        },
        autoHandoff: {
          enabled: autoHandoff.enabled,
          percent: autoHandoff.percent,
          sources: autoHandoff.sources,
          project,
          stateFile: projectPaths.autoHandoffFile,
          env: { enabled: autoHandoffEnvEnabled, percent: autoHandoffEnvPercent },
          host: { autoCompaction: hostCompaction.autoCompaction, compactionPercent: hostCompaction.percent },
          compaction: "The plugin starts compaction itself after the handoff is saved; the user does not need to run /compact.",
          warnings: autoHandoffWarnings
        },
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
          routeDiagnostics,
          retiredEfforts: retiredEffortRoutes(await readJsonObjectIfPresent(openCodeLitConfigPath)).map(retiredEffortWarning)
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
        autoUpdate: await inspectAutoUpdate({
          env: process.env,
          pinnedVersion: installPlugin.configured?.startsWith(`${metadata.name}@`) === true ? installPlugin.configured.slice(metadata.name.length + 1) : null
        }),
        install: {
          ok: installPlugin.ok && commandAliases.ok && nativeSkills.ok && openCode2Ok && !hostOnlyKeys.breaksOpenCode1,
          plugin: installPlugin,
          pluginEntries,
          cliJson,
          hostOnlyKeys,
          commandAliases,
          nativeSkills,
          tui
        }
      },
      null,
      2
    )
  };
}
