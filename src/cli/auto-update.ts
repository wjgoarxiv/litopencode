import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { defaultOpenCodeConfigRoot } from "../state.ts";
import { compareStableVersions, parseStableVersion, requestRegistryLatestVersion } from "./update-notifier.ts";
import { readPackageMetadata } from "./json.ts";

export const autoUpdatePackageName = "@litfamily/litopencode";
export const autoUpdateTimeoutMs = 30_000;
/** npm install, staged install, and post-install doctor each have this bound. */
export const autoUpdateTransactionBoundMs = autoUpdateTimeoutMs * 3;
export const autoUpdateLockTimeoutMs = 2_000;
/** Keep a live owner protected for the whole bounded transaction plus one command window. */
export const autoUpdateInstallLockStaleMs = autoUpdateTransactionBoundMs + autoUpdateTimeoutMs;
export const autoUpdateRecursionEnv = "LITOPENCODE_AUTO_UPDATE_IN_PROGRESS";

const stateRootName = ".litopencode";
const receiptFileName = "auto-update-receipt.json";
const journalFileName = "auto-update-journal.jsonl";
const installLockFileName = "auto-update-install.lock";
const maxCommandOutputBytes = 4 * 1024 * 1024;

type CommandOutput = {
  readonly stdout?: string;
  readonly stderr?: string;
};

export type AutoUpdateReason = "plugin" | "management";

export type InteractiveAutoUpdateGate = {
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly env: NodeJS.ProcessEnv;
  readonly stdinIsTTY: boolean | undefined;
  readonly stdoutIsTTY: boolean | undefined;
  readonly stderrIsTTY: boolean | undefined;
  readonly configRoot?: string;
};

export type AutoUpdateRunResult = {
  readonly status: "updated" | "rolled-back" | "skipped" | "failed";
  readonly reason?: string;
  readonly currentVersion?: string;
  readonly targetVersion?: string;
  readonly spec?: string;
  readonly receiptPath?: string;
  readonly backupPath?: string;
  readonly priorStateVerified?: boolean;
  readonly stagedStateKnown?: boolean;
  readonly rollback?: { readonly ok: boolean; readonly error?: string };
};

export type AutoUpdateCommandOptions = {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeout: number;
  readonly maxBuffer: number;
};

export type AutoUpdateOptions = {
  readonly reason: AutoUpdateReason;
  readonly homeDir?: string;
  readonly configRoot: string;
  readonly currentVersion: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly argv?: readonly string[];
  readonly fetchLatestVersion?: () => Promise<string>;
  /** Runtime for the staged CLI; defaults to {@link childNodeExecutable}. */
  readonly nodeExecutable?: string;
  readonly runCommand?: (
    command: string,
    args: readonly string[],
    options: AutoUpdateCommandOptions
  ) => Promise<CommandOutput>;
};

type SnapshotEntry = {
  readonly relativePath: string;
  readonly existed: boolean;
  readonly kind?: "file" | "directory";
};

type Snapshot = {
  readonly path: string;
  readonly entries: readonly SnapshotEntry[];
};

type InstallLock = {
  readonly path: string;
  readonly token: string;
};

type DoctorReceipt = {
  readonly ok: boolean;
  readonly exitCode?: number;
  readonly package?: { readonly name?: string; readonly version?: string };
  readonly error?: string;
};

type AutoUpdateReceipt = {
  readonly schemaVersion: 1;
  readonly status: AutoUpdateRunResult["status"];
  readonly reason: AutoUpdateReason;
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly spec: string;
  readonly configRoot: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly journalPath: string;
  readonly backupPath: string;
  readonly backupRetained: boolean;
  readonly priorStateVerified: boolean;
  readonly stagedStateKnown: boolean;
  readonly doctor: DoctorReceipt;
  readonly rollback: { readonly ok: boolean; readonly error?: string };
};

const execFileAsync = promisify(execFile);

/**
 * The staged CLI needs Node. Inside OpenCode the plugin runs on a Bun-compiled
 * host binary, and process.execPath names that binary rather than a Node
 * runtime, so fall back to `node` on PATH there.
 */
export function childNodeExecutable(
  execPath: string = process.execPath,
  versions: NodeJS.ProcessVersions | Readonly<Record<string, string | undefined>> = process.versions
): string {
  if (versions.bun === undefined && /^node(\.exe)?$/iu.test(path.basename(execPath.replaceAll("\\", "/")))) return execPath;
  return "node";
}

function stateRoot(homeDir: string): string {
  return path.join(homeDir, stateRootName);
}

export function autoUpdateInstallLockPath(homeDir: string = os.homedir()): string {
  return path.join(stateRoot(homeDir), installLockFileName);
}

export function autoUpdateJournalPath(homeDir: string = os.homedir()): string {
  return path.join(stateRoot(homeDir), journalFileName);
}

export function autoUpdateReceiptPath(homeDir: string = os.homedir()): string {
  return path.join(stateRoot(homeDir), receiptFileName);
}

function truthyEnvironmentValue(value: string | undefined): boolean {
  return value !== undefined;
}

export function isAutoUpdateDisabled(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = []): boolean {
  return (
    argv.includes("--no-auto-update") ||
    truthyEnvironmentValue(env.LITOPENCODE_NO_AUTO_UPDATE) ||
    truthyEnvironmentValue(env.NO_UPDATE_NOTIFIER) ||
    truthyEnvironmentValue(env.LITOPENCODE_NO_UPDATE_CHECK) ||
    truthyEnvironmentValue(env[autoUpdateRecursionEnv]) ||
    truthyEnvironmentValue(env.CI)
  );
}

export function shouldRunInteractiveAutoUpdate(input: InteractiveAutoUpdateGate): boolean {
  if (input.exitCode !== 0) return false;
  if (input.argv[0] !== "install" && input.argv[0] !== "doctor") return false;
  if (input.argv.some((arg) => arg === "--dry-run" || arg === "--json" || arg === "--help" || arg === "-h")) return false;
  if (input.stdinIsTTY !== true || input.stdoutIsTTY !== true || input.stderrIsTTY !== true) return false;
  return !isAutoUpdateDisabled(input.env, input.argv);
}

/**
 * Keep npm child processes deliberately boring. In particular, npm config files,
 * tokens, proxy credentials, and arbitrary `npm_config_*` values are not inherited.
 */
export function sanitizedNpmEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  const safeKeys = [
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "SystemRoot",
    "SYSTEMROOT",
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR"
  ];
  for (const key of safeKeys) {
    if (env[key] !== undefined) child[key] = env[key];
  }
  child[autoUpdateRecursionEnv] = "1";
  child.LITOPENCODE_NO_AUTO_UPDATE = "1";
  child.NO_UPDATE_NOTIFIER = "1";
  child.LITOPENCODE_NO_UPDATE_CHECK = "1";
  return child;
}

function commandFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const candidate = error as Error & { readonly stderr?: unknown; readonly stdout?: unknown; readonly code?: unknown; readonly signal?: unknown };
  const stderr = typeof candidate.stderr === "string" ? candidate.stderr.trim() : "";
  const stdout = typeof candidate.stdout === "string" ? candidate.stdout.trim() : "";
  const code = candidate.code === undefined ? "" : String(candidate.code);
  const signal = candidate.signal === undefined ? "" : String(candidate.signal);
  return [stderr ? `stderr: ${stderr}` : "", stdout ? `stdout: ${stdout}` : "", code ? `code: ${code}` : "", signal ? `signal: ${signal}` : "", !stderr && !stdout && !code && !signal ? error.message : ""]
    .filter(Boolean)
    .join("; ");
}

async function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: AutoUpdateCommandOptions
): Promise<CommandOutput> {
  return await execFileAsync(command, [...args], options);
}

async function bounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`automatic update command exceeded ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function ensurePrivateStateRoot(homeDir: string): Promise<string> {
  const directory = stateRoot(homeDir);
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("automatic update state root is unsafe");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("automatic update state root is not user-owned");
    // Project-local state for a project at HOME shares this directory and was
    // created with default permissions; tighten our own directory instead of
    // refusing every update.
    if ((stat.mode & 0o077) !== 0) await fs.chmod(directory, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  }
  return directory;
}

async function readLockTimestamp(lockPath: string): Promise<number | undefined> {
  try {
    const stat = await fs.lstat(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    const parsed = JSON.parse(await fs.readFile(lockPath, "utf8")) as Record<string, unknown>;
    return typeof parsed.acquiredAt === "number" ? parsed.acquiredAt : undefined;
  } catch {
    return undefined;
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireInstallLock(homeDir: string): Promise<InstallLock | undefined> {
  await ensurePrivateStateRoot(homeDir);
  const lockPath = autoUpdateInstallLockPath(homeDir);
  const deadline = Date.now() + autoUpdateLockTimeoutMs;
  while (Date.now() < deadline) {
    const token = randomUUID();
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ token, acquiredAt: Date.now() })}\n`, "utf8");
      await handle.close();
      return { path: lockPath, token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const acquiredAt = await readLockTimestamp(lockPath);
      if (acquiredAt !== undefined && Date.now() - acquiredAt >= autoUpdateInstallLockStaleMs) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      await pause(25);
    }
  }
  return undefined;
}

async function releaseInstallLock(lock: InstallLock): Promise<void> {
  if ((await readLockTimestamp(lock.path)) === undefined) return;
  let ownerToken: string | undefined;
  try {
    const parsed = JSON.parse(await fs.readFile(lock.path, "utf8")) as Record<string, unknown>;
    ownerToken = typeof parsed.token === "string" ? parsed.token : undefined;
  } catch {
    return;
  }
  if (ownerToken === lock.token) await fs.rm(lock.path, { force: true });
}

async function appendJournal(homeDir: string, event: string, fields: Record<string, unknown>): Promise<void> {
  const journalPath = autoUpdateJournalPath(homeDir);
  await ensurePrivateStateRoot(homeDir);
  try {
    const stat = await fs.lstat(journalPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("automatic update journal is unsafe");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("automatic update journal is not user-owned");
    if ((stat.mode & 0o077) !== 0) throw new Error("automatic update journal is not private");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.appendFile(journalPath, `${JSON.stringify({ schemaVersion: 1, event, at: Date.now(), ...fields })}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await fs.chmod(journalPath, 0o600).catch(() => undefined);
}

async function tryAppendJournal(homeDir: string, event: string, fields: Record<string, unknown>): Promise<void> {
  try {
    await appendJournal(homeDir, event, fields);
  } catch {
    // Journal failure must not skip the restore attempt. The receipt remains
    // the authoritative failure surface when the journal itself is unsafe.
  }
}

async function lstatKind(filePath: string): Promise<SnapshotEntry["kind"] | undefined> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) throw new Error(`automatic update refuses symbolic-link backup source: ${filePath}`);
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "directory";
    throw new Error(`automatic update refuses special backup source: ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function captureSnapshot(configRoot: string, homeDir: string): Promise<Snapshot> {
  const snapshotPath = path.join(stateRoot(homeDir), `.auto-update-backup-${randomUUID()}`);
  await fs.mkdir(snapshotPath, { recursive: true, mode: 0o700 });
  const entries: SnapshotEntry[] = [];
  for (const relativePath of ["opencode.json", "opencode.jsonc", "litopencode.json", "command", "skills"]) {
    const source = path.join(configRoot, relativePath);
    const kind = await lstatKind(source);
    if (kind === undefined) {
      entries.push({ relativePath, existed: false });
      continue;
    }
    const destination = path.join(snapshotPath, relativePath);
    await fs.cp(source, destination, { recursive: kind === "directory", force: false, errorOnExist: false, dereference: false });
    entries.push({ relativePath, existed: true, kind });
  }
  await fs.writeFile(path.join(snapshotPath, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return { path: snapshotPath, entries };
}

async function ensureConfigRoot(configRoot: string): Promise<void> {
  try {
    const stat = await fs.lstat(configRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`automatic update config root is unsafe: ${configRoot}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.mkdir(configRoot, { recursive: true, mode: 0o700 });
  }
}

async function restoreSnapshot(configRoot: string, snapshot: Snapshot): Promise<void> {
  // Re-check the root immediately before restoring. The updater never writes
  // through a root that was replaced with a symlink while the child command
  // was running.
  await ensureConfigRoot(configRoot);
  for (const entry of snapshot.entries) {
    const target = path.join(configRoot, entry.relativePath);
    await fs.rm(target, { recursive: true, force: true });
    if (!entry.existed) continue;
    const source = path.join(snapshot.path, entry.relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: entry.kind === "directory", force: false, errorOnExist: false, dereference: false });
  }
}

async function fingerprintPath(filePath: string): Promise<string> {
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink()) return `link:${await fs.readlink(filePath)}`;
  if (stat.isFile()) {
    const hash = createHash("sha256");
    hash.update(await fs.readFile(filePath));
    return `file:${hash.digest("hex")}`;
  }
  if (stat.isDirectory()) {
    const children = await fs.readdir(filePath);
    children.sort();
    const parts: string[] = [];
    for (const child of children) {
      parts.push(`${child}:${await fingerprintPath(path.join(filePath, child))}`);
    }
    return `dir:${parts.join("|")}`;
  }
  return `special:${stat.mode}`;
}

async function verifySnapshot(configRoot: string, snapshot: Snapshot): Promise<boolean> {
  try {
    await ensureConfigRoot(configRoot);
    for (const entry of snapshot.entries) {
      const target = path.join(configRoot, entry.relativePath);
      let targetFingerprint: string | undefined;
      try {
        targetFingerprint = await fingerprintPath(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      }
      if (!entry.existed) {
        if (targetFingerprint !== undefined) return false;
        continue;
      }
      if (targetFingerprint === undefined) return false;
      const sourceFingerprint = await fingerprintPath(path.join(snapshot.path, entry.relativePath));
      if (targetFingerprint !== sourceFingerprint) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function writeReceipt(homeDir: string, receipt: AutoUpdateReceipt): Promise<void> {
  await ensurePrivateStateRoot(homeDir);
  const receiptPath = autoUpdateReceiptPath(homeDir);
  const temporary = `${receiptPath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, receiptPath);
  await fs.chmod(receiptPath, 0o600).catch(() => undefined);
}

function parseDoctorOutput(output: CommandOutput, currentVersion: string): DoctorReceipt {
  try {
    const parsed = JSON.parse(output.stdout ?? "") as Record<string, unknown>;
    const packageRecord = parsed.package as Record<string, unknown> | undefined;
    const install = parsed.install as Record<string, unknown> | undefined;
    const packageName = typeof packageRecord?.name === "string" ? packageRecord.name : undefined;
    const version = typeof packageRecord?.version === "string" ? packageRecord.version : undefined;
    const ok = packageName === autoUpdatePackageName && version === currentVersion && install?.ok === true;
    return { ok, package: { name: packageName, version }, ...(ok ? {} : { error: "post-install doctor did not verify exact package identity and install surfaces" }) };
  } catch (error) {
    return { ok: false, error: `post-install doctor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function packageEntrypoint(stageRoot: string, targetVersion: string): Promise<string> {
  const packageRoot = path.join(stageRoot, "node_modules", autoUpdatePackageName);
  const packageMetadata = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
  if (packageMetadata.name !== autoUpdatePackageName || packageMetadata.version !== targetVersion) {
    throw new Error("npm install produced a package with an unexpected stable name or version");
  }
  if (parseStableVersion(packageMetadata.version) === undefined) throw new Error("npm install produced a non-stable package version");
  const entrypoint = path.join(packageRoot, "bin", "litopencode.cjs");
  const stat = await fs.lstat(entrypoint);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("npm install produced an unsafe CLI entrypoint");
  return entrypoint;
}

async function updateTransaction(
  options: AutoUpdateOptions,
  homeDir: string,
  currentVersion: string,
  targetVersion: string,
  runCommand: NonNullable<AutoUpdateOptions["runCommand"]>
): Promise<AutoUpdateRunResult> {
  const startedAt = Date.now();
  const spec = `${autoUpdatePackageName}@${targetVersion}`;
  const journalPath = autoUpdateJournalPath(homeDir);
  await ensureConfigRoot(options.configRoot);
  const snapshot = await captureSnapshot(options.configRoot, homeDir);
  const stageRoot = path.join(stateRoot(homeDir), `.auto-update-stage-${randomUUID()}`);
  let doctor: DoctorReceipt = { ok: false, error: "post-install doctor did not run" };
  let rollback = { ok: true } as { ok: boolean; error?: string };
  let status: AutoUpdateRunResult["status"] = "failed";
  // A staged package is considered known while no host mutation has started.
  // Once an installer/doctor child is in flight, a timeout or signal makes the
  // resulting host state unknown until the snapshot is restored and verified.
  let stagedStateKnown = true;
  let priorStateVerified = false;
  try {
    await fs.mkdir(stageRoot, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(stageRoot, "package.json"), '{"private":true}\n', { encoding: "utf8", mode: 0o600 });
    const npmrcPath = path.join(stageRoot, ".npmrc");
    await fs.writeFile(npmrcPath, "# LitOpenCode automatic-update transaction\n", { encoding: "utf8", mode: 0o600 });
    await appendJournal(homeDir, "begin", { reason: options.reason, currentVersion, targetVersion, spec, configRoot: options.configRoot });
    const childEnv = {
      ...sanitizedNpmEnvironment(options.env),
      // Prevent npm from reading a user's HOME/.npmrc while retaining a
      // deterministic, empty config for registry resolution.
      NPM_CONFIG_USERCONFIG: npmrcPath
    };
    const npmArgs = [
      "install",
      "--prefix",
      stageRoot,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--no-save",
      spec
    ];
    await bounded(() => runCommand("npm", npmArgs, { cwd: stageRoot, env: childEnv, timeout: autoUpdateTimeoutMs, maxBuffer: maxCommandOutputBytes }), autoUpdateTimeoutMs);
    await appendJournal(homeDir, "npm-install", { spec });
    const entrypoint = await packageEntrypoint(stageRoot, targetVersion);
    const nodeExecutable = options.nodeExecutable ?? childNodeExecutable();
    const installArgs = [entrypoint, "install", "--root", options.configRoot, "--no-model-prompt", "--no-permission-prompt", "--no-auto-update"];
    stagedStateKnown = false;
    await bounded(
      () => runCommand(nodeExecutable, installArgs, { cwd: options.configRoot, env: childEnv, timeout: autoUpdateTimeoutMs, maxBuffer: maxCommandOutputBytes }),
      autoUpdateTimeoutMs
    );
    stagedStateKnown = true;
    await appendJournal(homeDir, "install", { spec });
    const doctorArgs = [entrypoint, "doctor", "--root", options.configRoot, "--json", "--no-auto-update"];
    stagedStateKnown = false;
    const doctorOutput = await bounded(
      () => runCommand(nodeExecutable, doctorArgs, { cwd: options.configRoot, env: childEnv, timeout: autoUpdateTimeoutMs, maxBuffer: maxCommandOutputBytes }),
      autoUpdateTimeoutMs
    );
    doctor = parseDoctorOutput(doctorOutput, targetVersion);
    stagedStateKnown = doctor.package?.name !== undefined && doctor.package.version !== undefined;
    await appendJournal(homeDir, "doctor", { ok: doctor.ok, package: doctor.package, error: doctor.error });
    if (!doctor.ok) throw new Error(doctor.error ?? "post-install doctor failed");
    status = "updated";
    await appendJournal(homeDir, "updated", { spec });
  } catch (error) {
    const failure = commandFailure(error);
    await tryAppendJournal(homeDir, "failure", { error: failure });
    try {
      await restoreSnapshot(options.configRoot, snapshot);
      priorStateVerified = await verifySnapshot(options.configRoot, snapshot);
      if (!priorStateVerified) throw new Error("automatic update rollback could not verify the prior config and managed surfaces");
      rollback = { ok: true };
      status = "rolled-back";
      await tryAppendJournal(homeDir, "rollback", { ok: true, priorStateVerified, stagedStateKnown });
    } catch (rollbackError) {
      rollback = { ok: false, error: commandFailure(rollbackError) };
      status = "failed";
      await tryAppendJournal(homeDir, "rollback", { ok: false, error: rollback.error, priorStateVerified, stagedStateKnown });
    }
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true });
    if (status === "updated") await fs.rm(snapshot.path, { recursive: true, force: true });
  }

  const receipt: AutoUpdateReceipt = {
    schemaVersion: 1,
    status,
    reason: options.reason,
    currentVersion,
    targetVersion,
    spec,
    configRoot: options.configRoot,
    startedAt,
    finishedAt: Date.now(),
    journalPath,
    backupPath: snapshot.path,
    backupRetained: status !== "updated",
    priorStateVerified: status === "updated" ? true : priorStateVerified,
    stagedStateKnown,
    doctor,
    rollback
  };
  await writeReceipt(homeDir, receipt);
  return {
    status,
    currentVersion,
    targetVersion,
    spec,
    receiptPath: autoUpdateReceiptPath(homeDir),
    backupPath: snapshot.path,
    priorStateVerified: receipt.priorStateVerified,
    stagedStateKnown,
    ...(status === "rolled-back" || status === "failed" ? { rollback } : {})
  };
}

export async function runAutoUpdate(options: AutoUpdateOptions): Promise<AutoUpdateRunResult> {
  const env = options.env ?? process.env;
  if (isAutoUpdateDisabled(env, options.argv)) return { status: "skipped", reason: "disabled" };
  if (parseStableVersion(options.currentVersion) === undefined) return { status: "skipped", reason: "invalid-current-version" };
  const homeDir = options.homeDir ?? os.homedir();
  const fetchLatestVersion = options.fetchLatestVersion ?? requestRegistryLatestVersion;
  let targetVersion: string;
  try {
    targetVersion = await bounded(fetchLatestVersion, autoUpdateTimeoutMs);
  } catch {
    return { status: "skipped", currentVersion: options.currentVersion, reason: "registry-unavailable" };
  }
  if (parseStableVersion(targetVersion) === undefined) return { status: "skipped", currentVersion: options.currentVersion, reason: "invalid-latest-version" };
  const comparison = compareStableVersions(targetVersion, options.currentVersion);
  if (comparison !== 1) return { status: "skipped", currentVersion: options.currentVersion, targetVersion, reason: "up-to-date" };

  let lock: InstallLock | undefined;
  try {
    lock = await acquireInstallLock(homeDir);
  } catch {
    // Nothing has been mutated yet, so the current install stays usable.
    return { status: "skipped", currentVersion: options.currentVersion, targetVersion, reason: "state-unavailable" };
  }
  if (lock === undefined) return { status: "skipped", currentVersion: options.currentVersion, targetVersion, reason: "install-lock-busy" };
  try {
    await ensurePrivateStateRoot(homeDir);
    const runCommand = options.runCommand ?? defaultRunCommand;
    return await updateTransaction(options, homeDir, options.currentVersion, targetVersion, runCommand);
  } finally {
    await releaseInstallLock(lock);
  }
}

/**
 * A failed transaction is safe to leave in place only when the old managed
 * state was restored and verified. Unknown child state or an unverified
 * rollback must stop the host from claiming a successful install.
 */
export function canContinueAfterAutoUpdate(result: AutoUpdateRunResult): boolean {
  if (result.status === "updated" || result.status === "skipped") return true;
  return result.status === "rolled-back" && result.rollback?.ok === true && result.priorStateVerified === true && result.stagedStateKnown === true;
}

export function autoUpdateDiagnostic(result: AutoUpdateRunResult): string {
  const receipt = result.receiptPath ?? autoUpdateReceiptPath();
  const backup = result.backupPath === undefined ? "" : ` Retained backup: ${result.backupPath}.`;
  return `Automatic update stopped without claiming success (${result.status}). Inspect the receipt at ${receipt}.${backup}`;
}

export type AutoUpdateReceiptSummary = {
  readonly status: AutoUpdateReceipt["status"];
  readonly backupPath: string;
  readonly backupRetained: boolean;
  readonly priorStateVerified: boolean;
  readonly stagedStateKnown: boolean;
  readonly rollbackOk: boolean;
  readonly finishedAt: number;
};

/** Read only the bounded safety summary used by doctor; never echo command output. */
export async function readAutoUpdateReceipt(homeDir: string = os.homedir()): Promise<AutoUpdateReceiptSummary | { readonly status: "unreadable" } | undefined> {
  const receiptPath = autoUpdateReceiptPath(homeDir);
  try {
    const stat = await fs.lstat(receiptPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return { status: "unreadable" };
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return { status: "unreadable" };
    if ((stat.mode & 0o077) !== 0) return { status: "unreadable" };
    const parsed = JSON.parse(await fs.readFile(receiptPath, "utf8")) as Partial<AutoUpdateReceipt>;
    if (
      parsed.schemaVersion !== 1 ||
      (parsed.status !== "updated" && parsed.status !== "rolled-back" && parsed.status !== "failed" && parsed.status !== "skipped") ||
      typeof parsed.backupPath !== "string" ||
      typeof parsed.backupRetained !== "boolean" ||
      typeof parsed.priorStateVerified !== "boolean" ||
      typeof parsed.stagedStateKnown !== "boolean" ||
      typeof parsed.rollback?.ok !== "boolean" ||
      typeof parsed.finishedAt !== "number"
    ) {
      return { status: "unreadable" };
    }
    return {
      status: parsed.status,
      backupPath: parsed.backupPath,
      backupRetained: parsed.backupRetained,
      priorStateVerified: parsed.priorStateVerified,
      stagedStateKnown: parsed.stagedStateKnown,
      rollbackOk: parsed.rollback.ok,
      finishedAt: parsed.finishedAt
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return { status: "unreadable" };
  }
}

async function isLocalCheckout(packageRoot: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path.join(packageRoot, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

export async function runPluginAutoUpdate(): Promise<AutoUpdateRunResult> {
  const metadata = await readPackageMetadata();
  if (await isLocalCheckout(metadata.packageRoot)) return { status: "skipped", reason: "local-checkout" };
  return await runAutoUpdate({
    reason: "plugin",
    configRoot: defaultOpenCodeConfigRoot(),
    currentVersion: metadata.version,
    env: process.env
  });
}

export async function runInteractiveAutoUpdate(input: InteractiveAutoUpdateGate): Promise<AutoUpdateRunResult> {
  if (!shouldRunInteractiveAutoUpdate(input)) return { status: "skipped", reason: "ineligible" };
  const metadata = await readPackageMetadata();
  if (await isLocalCheckout(metadata.packageRoot)) return { status: "skipped", reason: "local-checkout" };
  return await runAutoUpdate({
    reason: "management",
    configRoot: input.configRoot ?? defaultOpenCodeConfigRoot(),
    currentVersion: metadata.version,
    env: input.env,
    argv: input.argv
  });
}
