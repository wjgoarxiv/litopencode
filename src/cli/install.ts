import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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
import { applyPluginMutation, describePluginMutation, isLitOpenCodeEntry } from "./plugin-mutation.ts";
import { prewarmMotionRuntime } from "./motion-runtime.ts";
import { applyTuiWrites, backupTuiFiles, inspectTuiPlugin, planTuiInstall } from "./tui-config.ts";

const execFileAsync = promisify(execFile);

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

async function installWithOpenCode(target: OpenCodeInstallTarget): Promise<void> {
  try {
    await execFileAsync("opencode", ["plugin", target.value, "--global", "--force"], {
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
  useOpenCodeInstaller: boolean
): Promise<string | undefined> {
  const planned: { readonly file: string; readonly next: Record<string, unknown> | null }[] = [];
  if (!useOpenCodeInstaller) {
    const next = applyPluginMutation(before, mutation, target.value);
    planned.push({ file: configFile, next: reconfigureHostLimits ? applyHostLimits(next) : next });
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
      planned.push({ file, next: file === configFile && reconfigureHostLimits ? applyHostLimits(next) : next });
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
  selectedOutputStyle: string
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
  const tui = await inspectTuiPlugin(root, target.value);
  const failures: string[] = [];
  if (targetCount !== 1 || staleLitEntries.length > 0) failures.push("plugin registration");
  if (!tui.ok) failures.push("TUI plugin registration in " + tui.path);
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
  outputStylePrompt: PermissionPromptMode = "auto"
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
  const resolved = await withProgress(activeProgress, "Resolve package", async () => {
    const paths = createRuntimePaths(root);
    const useOpenCodeInstaller = shouldUseOpenCodeInstaller(root);
    const target = useOpenCodeInstaller ? await openCodeInstallTarget(metadata) : { value: spec, label: spec };
    return { paths, useOpenCodeInstaller, target };
  });
  const inspected = await withProgress(activeProgress, "Read OpenCode config", async () => {
    const configFile = resolved.useOpenCodeInstaller
      ? await openCodeManagedConfigFile(root)
      : resolved.paths.opencodeConfigFile;
    const before = await readJsonObjectIfPresent(configFile);
    return {
      configFile,
      before,
      mutation: describePluginMutation(before, resolved.target.value),
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
      tui: await planTuiInstall(root, resolved.target.value),
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
  });
  const { configFile, before, mutation, litopencodeConfig, commandAliases, nativeSkills, hostLimits, routes, tui } = inspected;
  const blocked = (await commentLossRefusal(
    root,
    configFile,
    resolved.target,
    before,
    mutation,
    hostLimits.reconfigure,
    resolved.useOpenCodeInstaller
  )) ?? tui.blocked;
  const report: InstallReport = {
    dryRun,
    path: configFile,
    litopencodeConfig,
    plugin: mutation.plugin,
    commandAliases,
    nativeSkills,
    tui: tui.report,
    patch: mutation.patch,
    changed: mutation.changed || litopencodeConfig.changed || commandAliases.changed || nativeSkills.changed || hostLimits.changed || tui.report.changed,
    ...(blocked === undefined ? {} : { blocked }),
    routes,
    hostLimits: { path: configFile, ...hostLimits },
    capabilities: openCodeHostCapabilities(),
    package: { name: metadata.name, version: metadata.version }
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
    if (resolved.useOpenCodeInstaller) {
      // The package's `./tui` export makes `opencode plugin` add the TUI entry itself, so back up
      // first, then normalize whatever it wrote without a second backup.
      await backupTuiFiles(tui);
      await installWithOpenCode(resolved.target);
      const installed = await readJsonObjectIfPresent(configFile);
      if (!Array.isArray(installed?.plugin) || !installed.plugin.some((entry) =>
        (Array.isArray(entry) ? entry[0] : entry) === resolved.target.value
      )) throw new Error("OpenCode did not register the requested package target");
      await normalizeOpenCodeEntries(root, resolved.target);
      await ensureHostLimits(configFile, await readJsonObjectIfPresent(configFile), hostLimits.reconfigure);
      const settled = await planTuiInstall(root, resolved.target.value);
      if (settled.blocked !== undefined) throw new OpenCodeConfigCommentError(settled.blocked);
      await applyTuiWrites(settled.writes, { backup: false });
      return;
    }
    await applyTuiWrites(tui.writes);
    const withPlugin = applyPluginMutation(before, mutation, resolved.target.value);
    const next = hostLimits.reconfigure ? applyHostLimits(withPlugin) : withPlugin;
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    await writeOpenCodeConfig(configFile, next);
  });
  await withProgress(activeProgress, "Verify install", async () =>
    verifyInstalledSurfaces(
      root,
      configFile,
      resolved.target,
      metadata,
      selectedModel,
      selectedPermissionMode,
      selectedPermissionExplicit,
      selectedOutputStyle
    )
  );
  await activeProgress?.complete();
  // MO-A-42: the installer attempts the motion pre-warm; a failure never fails the install.
  const motionReceipt = wrapReceiptLine(prewarmMotionRuntime(metadata.packageRoot));

  return {
    exitCode: 0,
    stdout: activeProgress === undefined
      ? renderLitOpenCodeWordmark(pluginSpec(metadata), false) + "\n" + renderInstallReport(report) + "\n" + motionReceipt
      : motionReceipt
  };
}
