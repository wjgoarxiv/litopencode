import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRuntimePaths } from "../state.ts";
import type {
  CliResult,
  InstallModelSelection,
  InstallPermissionMode,
  InstallProgress,
  InstallReport,
  InstallStageLabel,
  ModelPromptMode,
  PackageMetadata,
  PluginMutation,
  PermissionPromptMode
} from "./types.ts";
import { describeCommandAliasMutation, ensureCommandAliases, inspectCommandAliases } from "./command-aliases.ts";
import { execCommand } from "./command-plan.ts";
import { openCodeHostCapabilities } from "./host-capabilities.ts";
import { applyHostLimits, describeHostLimitMutation, ensureHostLimits } from "./host-limits.ts";
import {
  assertExistingModelRoutesSafe,
  migrateRetiredEfforts,
  describeInstallRoutes,
  describeLitConfigMutation,
  ensureLitConfig,
  OpenCodeConfigCommentError,
  readExistingOutputStyle,
  readInstallModelClassification,
  readInstallModelSelection,
  renderOpenCodeConfig,
  writeOpenCodeConfig
} from "./install-config.ts";
import { readJsonObjectIfPresent, readPackageMetadata, readTextIfPresent } from "./json.ts";
import { renderInstallReport, wrapReceiptLine } from "./install-report.ts";
import { renderLitOpenCodeWordmark } from "./install-tui.ts";
import { promptModelSelection, promptOutputStyle, promptPermissionMode } from "./model-routing.ts";
import { litOpenCodeConfigFileForOpenCodeRoot } from "../state.ts";
import { describeNativeSkillMutation, ensureNativeSkills, inspectNativeSkills } from "./native-skills.ts";
import { installAgentFile, planAgentFile } from "./agent-file-command.ts";
import { applyPluginMutation, describePluginMutation, isLitOpenCodeEntry } from "./plugin-mutation.ts";
import { prewarmMotionRuntime } from "./motion-runtime.ts";
import { applyCliJsonCleanup, applyTuiWrites, backupTuiFiles, inspectTuiPlugin, planCliJsonCleanup, planTuiInstall, skippedTuiPlan } from "./tui-config.ts";
import { confirmUnplacedOpenCode, detectOpenCodeHosts, targetsV1, targetsV2, type HostChoice, type HostDetection } from "./host-detect.ts";


type OpenCodeInstallTarget = {
  readonly value: string;
  readonly label: string;
};

type CommandFailure = Error & {
  readonly code?: unknown;
  readonly signal?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
};

function withProgress<T>(
  progress: InstallProgress | undefined,
  label: InstallStageLabel,
  task: () => Promise<T>
): Promise<T> {
  return progress === undefined ? task() : progress.run(label, task);
}

function pluginSpec(metadata: Pick<PackageMetadata, "name" | "version">): string {
  return metadata.name + "@" + metadata.version;
}

async function isLitOpenCodePathEntry(root: string, value: unknown): Promise<boolean> {
  if (typeof value !== "string" || isLitOpenCodeEntry(value)) return false;
  if (!(path.isAbsolute(value) || value.startsWith("."))) return false;
  const metadata = await readJsonObjectIfPresent(path.join(path.resolve(root, value), "package.json"));
  return metadata?.name === "litopencode" || metadata?.name === "@litfamily/opencode" || metadata?.name === "@litfamily/litopencode";
}

function defaultOpenCodeRoot(): string {
  const configHome = process.env.XDG_CONFIG_HOME;
  if (configHome && configHome.length > 0) return path.join(configHome, "opencode");
  return path.join(os.homedir(), ".config", "opencode");
}

function shouldUseOpenCodeInstaller(root: string): boolean {
  return path.resolve(root) === path.resolve(defaultOpenCodeRoot());
}

function openCodeConfigCandidates(root: string): readonly string[] {
  const resolvedRoot = path.resolve(root);
  return [path.join(resolvedRoot, "opencode.json"), path.join(resolvedRoot, "opencode.jsonc")];
}

async function openCodeManagedConfigFile(root: string): Promise<string> {
  const [jsonFile, jsoncFile] = openCodeConfigCandidates(root);
  if (await pathExists(jsonFile)) return jsonFile;
  if (await pathExists(jsoncFile)) return jsoncFile;
  return jsoncFile;
}

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return "";
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function commandFailureDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const failure = error as CommandFailure;
  const parts: string[] = [];
  const stderr = stripAnsi(outputText(failure.stderr)).trim();
  const stdout = stripAnsi(outputText(failure.stdout)).trim();
  const code = typeof failure.code === "number" || typeof failure.code === "string" ? String(failure.code) : "";
  const signal = typeof failure.signal === "string" ? failure.signal : "";

  if (stderr.length > 0) parts.push("stderr:\n" + stderr);
  if (stdout.length > 0) parts.push("stdout:\n" + stdout);
  if (code.length > 0) parts.push("exit code: " + code);
  if (signal.length > 0) parts.push("signal: " + signal);
  if (parts.length === 0 && error.message.length > 0) parts.push(error.message);
  return parts.join("\n\n");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function isLocalSourcePackage(packageRoot: string): Promise<boolean> {
  const realPackageRoot = await fs.realpath(packageRoot);
  return (await pathExists(path.join(realPackageRoot, ".git"))) && (await pathExists(path.join(realPackageRoot, "src")));
}

async function openCodeInstallTarget(metadata: PackageMetadata): Promise<OpenCodeInstallTarget> {
  if (await isLocalSourcePackage(metadata.packageRoot)) {
    const realPackageRoot = await fs.realpath(metadata.packageRoot);
    return { value: realPackageRoot, label: metadata.name + "@" + metadata.version + " (local checkout)" };
  }
  const spec = pluginSpec(metadata);
  return { value: spec, label: spec };
}

async function openCodeVersion(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await execCommand(command, ["--version"], { timeout: 15_000, maxBuffer: 64 * 1024 });
    return String(stdout);
  } catch {
    return undefined;
  }
}

async function installWithOpenCode(target: OpenCodeInstallTarget, command = "opencode"): Promise<void> {
  try {
    await execCommand(command, ["plugin", target.value, "--global", "--force"], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 4
    });
  } catch (error) {
    const detail = commandFailureDetail(error);
    throw new Error("OpenCode plugin install failed for " + target.label + (detail ? ":\n" + detail : ""));
  }
}

async function normalizedPluginEntries(
  root: string,
  target: OpenCodeInstallTarget,
  pluginValue: readonly unknown[]
): Promise<unknown[]> {
  const nextPlugin: unknown[] = [];
  let registered = false;
  for (const entry of pluginValue) {
    const id = Array.isArray(entry) ? entry[0] : entry;
    if (id === target.value || isLitOpenCodeEntry(entry) || (await isLitOpenCodePathEntry(root, id))) {
      if (!registered) nextPlugin.push(Array.isArray(entry) ? [target.value, ...entry.slice(1)] : target.value);
      registered = true;
    } else {
      nextPlugin.push(entry);
    }
  }
  return nextPlugin;
}

async function normalizeOpenCodeEntries(root: string, target: OpenCodeInstallTarget): Promise<void> {
  for (const configFile of openCodeConfigCandidates(root)) {
    const config = await readJsonObjectIfPresent(configFile);
    const pluginValue = config?.plugin;
    if (!Array.isArray(pluginValue)) continue;
    const nextPlugin = await normalizedPluginEntries(root, target, pluginValue);
    if (JSON.stringify(nextPlugin) === JSON.stringify(pluginValue)) continue;
    await writeOpenCodeConfig(configFile, { ...config, plugin: nextPlugin });
  }
}

function v2PluginEntryId(value: unknown): unknown {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return (value as { package?: unknown }).package;
  return value;
}

/**
 * OpenCode 2 merges its own `plugins` key with the OpenCode 1 `plugin` list and refuses a second plugin
 * with the same id, so a LitOpenCode entry under `plugins` is removed when OpenCode 2 is a target. The
 * one registration stays in `plugin`, which both hosts read.
 */
export function withoutV2PluginEntries(config: Record<string, unknown> | null): Record<string, unknown> | null {
  if (config === null || !Array.isArray(config.plugins)) return config;
  const kept = config.plugins.filter((entry) => !isLitOpenCodeEntry(v2PluginEntryId(entry)));
  return kept.length === config.plugins.length ? config : { ...config, plugins: kept };
}

// OpenCode 1 refuses to start when the shared config holds the OpenCode 2 `permissions` key, and OpenCode 2
// keeps `policies` there too. LitOpenCode never writes either; this check makes that a hard rule.
const hostOnlyKeys = ["permissions", "policies"] as const;

export function assertNoHostOnlyKeysAdded(before: Record<string, unknown> | null, next: Record<string, unknown> | null): void {
  for (const key of hostOnlyKeys) {
    if (next !== null && key in next && JSON.stringify(next[key]) !== JSON.stringify(before?.[key])) {
      throw new Error(`Refusing to write the OpenCode 2 \`${key}\` key into the shared config.`);
    }
  }
}

// Works out every OpenCode config edit the install will make before anything is written, and returns
// the refusal when one of them would delete a user comment. On the default root OpenCode registers the
// plugin itself; LitOpenCode then only cleans up stale entries and sets host limits.
async function commentLossRefusal(
  root: string,
  configFile: string,
  target: OpenCodeInstallTarget,
  before: Record<string, unknown> | null,
  mutation: PluginMutation,
  reconfigureHostLimits: boolean,
  useOpenCodeInstaller: boolean,
  stripV2Plugins = false
): Promise<string | undefined> {
  const planned: { readonly file: string; readonly next: Record<string, unknown> | null }[] = [];
  const v2 = (next: Record<string, unknown> | null) => (stripV2Plugins ? withoutV2PluginEntries(next) : next);
  if (!useOpenCodeInstaller) {
    const next = applyPluginMutation(before, mutation, target.value);
    planned.push({ file: configFile, next: v2(reconfigureHostLimits ? applyHostLimits(next) : next) });
  } else {
    for (const file of openCodeConfigCandidates(root)) {
      const config = file === configFile ? before : await readJsonObjectIfPresent(file);
      let next = config;
      const pluginValue = config?.plugin;
      if (config !== null && Array.isArray(pluginValue)) {
        const registered = file === configFile &&
          !pluginValue.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === target.value)
          ? [...pluginValue, target.value]
          : pluginValue;
        const normalized = await normalizedPluginEntries(root, target, registered);
        if (JSON.stringify(normalized) !== JSON.stringify(registered)) next = { ...config, plugin: normalized };
      }
      planned.push({ file, next: v2(file === configFile && reconfigureHostLimits ? applyHostLimits(next) : next) });
    }
  }
  try {
    for (const { file, next } of planned) {
      if (next !== null) renderOpenCodeConfig(file, await readTextIfPresent(file), next);
    }
  } catch (error) {
    if (error instanceof OpenCodeConfigCommentError) return error.message;
    throw error;
  }
  return undefined;
}

async function verifyInstalledSurfaces(
  root: string,
  configFile: string,
  target: OpenCodeInstallTarget,
  metadata: PackageMetadata,
  selectedModel: InstallModelSelection | undefined,
  selectedPermissionMode: InstallPermissionMode,
  selectedPermissionExplicit: boolean,
  selectedOutputStyle: string,
  host: HostDetection = { mode: "v1", binaries: [], evidence: { cliJson: false, tuiJson: false } }
): Promise<void> {
  const config = await readJsonObjectIfPresent(configFile);
  const pluginEntries = Array.isArray(config?.plugin) ? config.plugin : [];
  const pluginIds = pluginEntries.map((entry) =>
    typeof entry === "string" ? entry : Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : ""
  );
  const targetCount = pluginIds.filter((id) => id === target.value).length;
  const staleLitEntries = pluginIds.filter((id) => id !== target.value && isLitOpenCodeEntry(id));
  const litConfig = await describeLitConfigMutation(root, selectedModel, selectedPermissionMode, selectedPermissionExplicit, selectedOutputStyle);
  const commandAliases = await inspectCommandAliases(root);
  const nativeSkills = await inspectNativeSkills(root, metadata);
  const failures: string[] = [];
  if (targetCount !== 1 || staleLitEntries.length > 0) failures.push("plugin registration");
  if (targetsV1(host.mode)) {
    const tui = await inspectTuiPlugin(root, target.value);
    if (!tui.ok) failures.push("TUI plugin registration in " + tui.path);
  }
  if (targetsV2(host.mode)) {
    if (withoutV2PluginEntries(config) !== config) failures.push("duplicate LitOpenCode entry under plugins");
    if ((await planCliJsonCleanup(root)).removed > 0) failures.push("LitOpenCode entry left in cli.json");
  }
  if (litConfig.changed) failures.push("LitOpenCode routes");
  if (!commandAliases.ok) failures.push("command aliases: " + commandAliases.missing.join(", "));
  if (!nativeSkills.ok) {
    const details = [...new Set([...nativeSkills.missing, ...nativeSkills.invalid])];
    failures.push("native skills: " + details.join(", "));
  }
  if (metadata.name !== "@litfamily/litopencode") failures.push("package identity");
  if (failures.length > 0) throw new Error("Install verification failed: " + failures.join("; "));
}

export async function install(
  root: string,
  dryRun: boolean,
  modelSelection: InstallModelSelection | undefined = undefined,
  modelPrompt: ModelPromptMode = "auto",
  permissionMode: InstallPermissionMode = "safe",
  permissionModeExplicit = false,
  permissionPrompt: PermissionPromptMode = "auto",
  progress?: InstallProgress,
  outputStylePrompt: PermissionPromptMode = "auto",
  host: HostChoice = "auto",
  agentFileChoice: { readonly assumeYes: boolean; readonly skip: boolean } = { assumeYes: false, skip: false }
): Promise<CliResult> {
  const retiredNotice = await migrateRetiredEfforts(root, dryRun);
  if (retiredNotice !== undefined) process.stdout.write(retiredNotice + "\n");
  await assertExistingModelRoutesSafe(root);
  const classification = await readInstallModelClassification(root);
  const currentModel = await readInstallModelSelection(root);
  const existingOutputStyle = await readExistingOutputStyle(root);
  const selectedModel = await promptModelSelection(
    modelSelection,
    modelPrompt,
    dryRun,
    classification,
    litOpenCodeConfigFileForOpenCodeRoot(root),
    currentModel
  );
  const selectedPermission = await promptPermissionMode(permissionMode, permissionPrompt, dryRun);
  const selectedOutputStyle = await promptOutputStyle(existingOutputStyle, outputStylePrompt, dryRun);
  const selectedPermissionMode = selectedPermission.mode;
  const selectedPermissionExplicit = permissionModeExplicit || selectedPermission.explicit;
  const metadata = await readPackageMetadata();
  const activeProgress = dryRun ? undefined : progress;
  if (activeProgress !== undefined) {
    await activeProgress.start(pluginSpec(metadata));
  }
  const spec = pluginSpec(metadata);
  const located = await withProgress(activeProgress, "Resolve package", async () => {
    const paths = createRuntimePaths(root);
    const useOpenCodeInstaller = shouldUseOpenCodeInstaller(root);
    const target = useOpenCodeInstaller ? await openCodeInstallTarget(metadata) : { value: spec, label: spec };
    // A custom root says nothing about which host reads it, so only its config files count there.
    const detection = await detectOpenCodeHosts({
      root,
      override: host,
      ...(useOpenCodeInstaller ? {} : { resolvePackage: async () => undefined })
    });
    return { paths, useOpenCodeInstaller, target, detection };
  });
  const resolveFor = (detection: HostDetection) => {
    const forV1 = targetsV1(detection.mode);
    const forV2 = targetsV2(detection.mode);
    // `opencode plugin` is the OpenCode 1 command; OpenCode 2 installs the package itself on first load.
    const runInstaller = located.useOpenCodeInstaller && forV1;
    const opencodeIsV2 = [...detection.binaries, ...(detection.unplaced ?? [])].some((found) => found.command === "opencode" && found.major === 2);
    if (runInstaller && detection.v1Command === undefined && opencodeIsV2) {
      throw new Error("Found no OpenCode 1 command: `opencode` is OpenCode 2, and `opencode plugin` would change OpenCode 2's config. Install for OpenCode 2 with --host v2, or put OpenCode 1 on PATH as `opencode`.");
    }
    return { ...located, detection, runInstaller, forV1, forV2 };
  };
  type Resolved = ReturnType<typeof resolveFor>;
  const inspect = async (current: Resolved) => {
    const configFile = current.useOpenCodeInstaller
      ? await openCodeManagedConfigFile(root)
      : current.paths.opencodeConfigFile;
    const before = await readJsonObjectIfPresent(configFile);
    return {
      configFile,
      before,
      mutation: describePluginMutation(before, current.target.value),
      litopencodeConfig: await describeLitConfigMutation(
        root,
        selectedModel,
        selectedPermissionMode,
        selectedPermissionExplicit,
        selectedOutputStyle
      ),
      commandAliases: await describeCommandAliasMutation(root),
      nativeSkills: await describeNativeSkillMutation(root, metadata),
      hostLimits: describeHostLimitMutation(before, selectedModel !== undefined),
      tui: current.forV1 ? await planTuiInstall(root, current.target.value) : skippedTuiPlan(root),
      cliJson: current.forV2 ? await planCliJsonCleanup(root) : { path: path.join(path.resolve(root), "cli.json"), removed: 0 },
      routes: dryRun
        ? await describeInstallRoutes(
            root,
            before,
            selectedModel,
            selectedPermissionMode,
            selectedPermissionExplicit,
            selectedOutputStyle
          )
        : undefined
    };
  };
  const refusalFor = async (current: Resolved, plan: Awaited<ReturnType<typeof inspect>>) =>
    (await commentLossRefusal(
      root,
      plan.configFile,
      current.target,
      plan.before,
      plan.mutation,
      plan.hostLimits.reconfigure,
      current.runInstaller,
      current.forV2
    )) ?? plan.tui.blocked ?? plan.cliJson.blocked;
  let resolved = resolveFor(located.detection);
  let inspected = await withProgress(activeProgress, "Read OpenCode config", async () => inspect(resolved));
  let blocked = await refusalFor(resolved, inspected);
  // A real install that passed every refusal is about to run `opencode plugin`. An `opencode` only guessed
  // to be OpenCode 1 answers `--version` first, so an OpenCode 2 installed outside npm gets the OpenCode 2
  // setup instead. A dry run and a refused install start nothing.
  if (blocked === undefined && !dryRun && resolved.runInstaller) {
    const confirmed = await confirmUnplacedOpenCode(resolved.detection, openCodeVersion);
    if (confirmed !== resolved.detection) {
      resolved = resolveFor(confirmed);
      inspected = await inspect(resolved);
      blocked = await refusalFor(resolved, inspected);
    }
  }
  const { configFile, before, mutation, litopencodeConfig, commandAliases, nativeSkills, hostLimits, routes, tui, cliJson } = inspected;
  const v2PluginsChanged = resolved.forV2 && withoutV2PluginEntries(before) !== before;
  const agentFileInput = { root, version: metadata.version, ...agentFileChoice };
  const report: InstallReport = {
    dryRun,
    path: configFile,
    litopencodeConfig,
    ...(dryRun ? { agentFile: await planAgentFile(agentFileInput) } : {}),
    plugin: mutation.plugin,
    commandAliases,
    nativeSkills,
    tui: tui.report,
    patch: mutation.patch,
    changed: mutation.changed || litopencodeConfig.changed || commandAliases.changed || nativeSkills.changed || hostLimits.changed || tui.report.changed || cliJson.removed > 0 || v2PluginsChanged,
    ...(blocked === undefined ? {} : { blocked }),
    routes,
    hostLimits: { path: configFile, ...hostLimits },
    capabilities: openCodeHostCapabilities(),
    package: { name: metadata.name, version: metadata.version },
    host: {
      mode: resolved.detection.mode,
      binaries: resolved.detection.binaries,
      ...(resolved.detection.unplaced === undefined ? {} : { unplaced: resolved.detection.unplaced }),
      evidence: resolved.detection.evidence,
      ...(resolved.detection.override === undefined ? {} : { override: resolved.detection.override })
    },
    cliJson: { path: cliJson.path, removed: cliJson.removed, changed: cliJson.removed > 0 }
  };

  if (dryRun) {
    return {
      exitCode: blocked === undefined ? 0 : 1,
      stdout: JSON.stringify(report, null, 2),
      ...(blocked === undefined ? {} : { stderr: "ERROR: " + blocked })
    };
  }

  if (nativeSkills.collisions.length > 0) {
    throw new Error(
      "Native skill collision: refusing to overwrite pre-existing roots without managed entrypoints: " +
        nativeSkills.collisions.join(", ")
    );
  }

  if (blocked !== undefined) throw new OpenCodeConfigCommentError(blocked);

  await withProgress(activeProgress, "Write litopencode.json", async () => {
    await ensureLitConfig(root, selectedModel, selectedPermissionMode, selectedPermissionExplicit, selectedOutputStyle);
    await ensureNativeSkills(root, metadata);
    await ensureCommandAliases(root);
  });

  await withProgress(activeProgress, "Register plugin", async () => {
    if (resolved.runInstaller) {
      // The package's `./tui` export makes `opencode plugin` add the TUI entry itself, so back up
      // first, then normalize whatever it wrote without a second backup.
      await backupTuiFiles(tui);
      // Both config candidates as they were, so an OpenCode 2 key added to either one is caught.
      const candidates = openCodeConfigCandidates(root);
      const snapshots = new Map(await Promise.all(candidates.map(async (file) => [file, await readJsonObjectIfPresent(file)] as const)));
      await installWithOpenCode(resolved.target, resolved.detection.v1Command ?? "opencode");
      const installed = await readJsonObjectIfPresent(configFile);
      if (!Array.isArray(installed?.plugin) || !installed.plugin.some((entry) =>
        (Array.isArray(entry) ? entry[0] : entry) === resolved.target.value
      )) throw new Error("OpenCode did not register the requested package target");
      await normalizeOpenCodeEntries(root, resolved.target);
      if (resolved.forV2) {
        for (const file of candidates) {
          const current = await readJsonObjectIfPresent(file);
          const stripped = withoutV2PluginEntries(current);
          if (stripped === current || stripped === null) continue;
          assertNoHostOnlyKeysAdded(snapshots.get(file) ?? null, stripped);
          await writeOpenCodeConfig(file, stripped);
        }
      }
      await ensureHostLimits(configFile, await readJsonObjectIfPresent(configFile), hostLimits.reconfigure);
      const settled = await planTuiInstall(root, resolved.target.value);
      if (settled.blocked !== undefined) throw new OpenCodeConfigCommentError(settled.blocked);
      await applyTuiWrites(settled.writes, { backup: false });
      for (const file of candidates) assertNoHostOnlyKeysAdded(snapshots.get(file) ?? null, await readJsonObjectIfPresent(file));
      return;
    }
    await applyTuiWrites(tui.writes);
    const withPlugin = applyPluginMutation(before, mutation, resolved.target.value);
    const limited = hostLimits.reconfigure ? applyHostLimits(withPlugin) : withPlugin;
    const next = resolved.forV2 ? withoutV2PluginEntries(limited) : limited;
    assertNoHostOnlyKeysAdded(before, next);
    if (next === null || JSON.stringify(next) === JSON.stringify(before)) return;
    await writeOpenCodeConfig(configFile, next);
  });
  if (resolved.forV2) await applyCliJsonCleanup(cliJson);
  await withProgress(activeProgress, "Verify install", async () =>
    verifyInstalledSurfaces(
      root,
      configFile,
      resolved.target,
      metadata,
      selectedModel,
      selectedPermissionMode,
      selectedPermissionExplicit,
      selectedOutputStyle,
      resolved.detection
    )
  );
  await activeProgress?.complete();
  // The block is the last step: it asks a question, and a refusal here never undoes a finished install.
  const agentFileLine = wrapReceiptLine(await installAgentFile(agentFileInput));
  // MO-A-42: the installer attempts the motion pre-warm; a failure never fails the install.
  const motionReceipt = wrapReceiptLine(prewarmMotionRuntime(metadata.packageRoot));

  return {
    exitCode: 0,
    stdout: activeProgress === undefined
      ? renderLitOpenCodeWordmark(pluginSpec(metadata), false) + "\n" + renderInstallReport(report) + "\n" + agentFileLine + "\n" + motionReceipt
      : agentFileLine + "\n" + motionReceipt
  };
}
