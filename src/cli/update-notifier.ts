import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import type { IncomingHttpHeaders, IncomingMessage, RequestOptions } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPackageMetadata } from "./json.ts";

const packageName = "@litfamily/litopencode";
const cacheSchemaVersion = 1;
const updateCacheMaxBytes = 64 * 1024;
const updateLockOwnerMaxBytes = 4 * 1024;

export const npmLatestUrl = "https://registry.npmjs.org/%40litfamily%2Flitopencode/latest";
export const updateTimeoutMs = 3000;
export const updateResponseMaxBytes = 64 * 1024;
export const updateCheckIntervalMs = 24 * 60 * 60 * 1000;
export const updateLockStaleMs = 10 * 1000;

export type UpdateCache = {
  readonly schemaVersion: 1;
  readonly packageName: "@litfamily/litopencode";
  readonly latestVersion?: string;
  readonly checkedAt?: number;
  readonly failedAt?: number;
  readonly attemptedAt?: number;
  readonly ownerGeneration?: string;
};

type UpdateNotifierGate = {
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly env: NodeJS.ProcessEnv;
  readonly stdinIsTTY: boolean | undefined;
  readonly stdoutIsTTY: boolean | undefined;
  readonly stderrIsTTY: boolean | undefined;
};

type RunUpdateNotifierOptions = UpdateNotifierGate & {
  readonly homeDir?: string;
  readonly currentVersion?: string;
  readonly now?: number;
  readonly writeStderr?: (text: string) => void;
  readonly launchRefresh?: () => void;
};

type RefreshUpdateCacheOptions = {
  readonly homeDir?: string;
  readonly now?: number;
  readonly clock?: () => number;
  readonly fetchLatestVersion?: () => Promise<string>;
};

type RegistryResponse = Pick<IncomingMessage, "statusCode" | "headers"> & AsyncIterable<Uint8Array | string>;
type RegistryRequest = {
  destroy(error?: Error): void;
  once(event: "error", listener: (error: Error) => void): unknown;
};
type RegistryTransport = (
  url: string,
  options: RequestOptions,
  callback: (response: RegistryResponse) => void
) => RegistryRequest;
type DetachedUpdateChild = {
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
};
type DetachedUpdateSpawn = (
  command: string,
  args: string[],
  options: { readonly detached: true; readonly stdio: "ignore"; readonly env: NodeJS.ProcessEnv }
) => DetachedUpdateChild;
type RefreshLock = {
  readonly path: string;
  readonly generation: string;
  readonly acquiredAt: number;
};
type UpdateCacheCommitGuard = {
  readonly transition: RefreshLock;
  readonly refresh: RefreshLock;
  readonly expectedCacheOwnerGeneration?: string;
};
type SafeFileRead =
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "missing" }
  | { readonly status: "unsafe" };
type SafeDirectoryStatus = "safe" | "missing" | "unsafe";
type UpdateCacheRead =
  | { readonly status: "safe"; readonly cache: UpdateCache | undefined }
  | { readonly status: "unsafe" };
type LockOwnerRead =
  | { readonly status: "valid"; readonly owner: RefreshLock }
  | { readonly status: "missing" | "invalid" | "unsafe" };

export function parseStableVersion(value: unknown): readonly [bigint, bigint, bigint] | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return undefined;
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

export function compareStableVersions(left: unknown, right: unknown): -1 | 0 | 1 | undefined {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  if (!leftParts || !rightParts) return undefined;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function updateCachePath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".litopencode", "update-check.json");
}

export function updateLockPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".litopencode", "update-check.lock");
}

export function updateTransitionLockPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".litopencode", "update-check.transition.lock");
}

function safeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function currentUserOwns(stats: fsSync.Stats): boolean {
  return typeof process.getuid !== "function" || stats.uid === process.getuid();
}

function hasPrivateMode(stats: fsSync.Stats): boolean {
  return process.platform === "win32" || (stats.mode & 0o077) === 0;
}

function safePrivateDirectory(stats: fsSync.Stats): boolean {
  return stats.isDirectory() && currentUserOwns(stats) && hasPrivateMode(stats);
}

function safePrivateFile(stats: fsSync.Stats, maximumBytes: number): boolean {
  return stats.isFile() && stats.size <= maximumBytes && currentUserOwns(stats) && hasPrivateMode(stats);
}

function sameFilesystemEntry(left: fsSync.Stats, right: fsSync.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function safeReadFlags(): number {
  let flags = fsSync.constants.O_RDONLY;
  if (typeof fsSync.constants.O_NOFOLLOW === "number") flags |= fsSync.constants.O_NOFOLLOW;
  if (typeof fsSync.constants.O_NONBLOCK === "number") flags |= fsSync.constants.O_NONBLOCK;
  return flags;
}

function missingFilesystemEntry(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function safeDirectoryStatus(directoryPath: string): Promise<SafeDirectoryStatus> {
  try {
    return safePrivateDirectory(await fs.lstat(directoryPath)) ? "safe" : "unsafe";
  } catch (error) {
    return missingFilesystemEntry(error) ? "missing" : "unsafe";
  }
}

function safeDirectoryStatusSync(directoryPath: string): SafeDirectoryStatus {
  try {
    return safePrivateDirectory(fsSync.lstatSync(directoryPath)) ? "safe" : "unsafe";
  } catch (error) {
    return missingFilesystemEntry(error) ? "missing" : "unsafe";
  }
}

async function ensureSafePrivateDirectory(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
  if ((await safeDirectoryStatus(directoryPath)) !== "safe") {
    throw new Error("update state directory is unsafe");
  }
}

async function readSafeRegularFile(filePath: string, maximumBytes: number): Promise<SafeFileRead> {
  let handle: fs.FileHandle | undefined;
  try {
    const pathStats = await fs.lstat(filePath);
    if (!safePrivateFile(pathStats, maximumBytes)) return { status: "unsafe" };
    handle = await fs.open(filePath, safeReadFlags());
    const descriptorStats = await handle.stat();
    if (!safePrivateFile(descriptorStats, maximumBytes) || !sameFilesystemEntry(pathStats, descriptorStats)) {
      return { status: "unsafe" };
    }
    const bytes = Buffer.alloc(maximumBytes + 1);
    let totalBytes = 0;
    while (totalBytes < bytes.length) {
      const { bytesRead } = await handle.read(bytes, totalBytes, bytes.length - totalBytes, totalBytes);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
    }
    if (totalBytes > maximumBytes) return { status: "unsafe" };
    return { status: "ok", text: bytes.subarray(0, totalBytes).toString("utf8") };
  } catch (error) {
    return missingFilesystemEntry(error) ? { status: "missing" } : { status: "unsafe" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function readSafeRegularFileSync(filePath: string, maximumBytes: number): SafeFileRead {
  let descriptor: number | undefined;
  try {
    const pathStats = fsSync.lstatSync(filePath);
    if (!safePrivateFile(pathStats, maximumBytes)) return { status: "unsafe" };
    descriptor = fsSync.openSync(filePath, safeReadFlags());
    const descriptorStats = fsSync.fstatSync(descriptor);
    if (!safePrivateFile(descriptorStats, maximumBytes) || !sameFilesystemEntry(pathStats, descriptorStats)) {
      return { status: "unsafe" };
    }
    const bytes = Buffer.alloc(maximumBytes + 1);
    let totalBytes = 0;
    while (totalBytes < bytes.length) {
      const bytesRead = fsSync.readSync(descriptor, bytes, totalBytes, bytes.length - totalBytes, totalBytes);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
    }
    if (totalBytes > maximumBytes) return { status: "unsafe" };
    return { status: "ok", text: bytes.subarray(0, totalBytes).toString("utf8") };
  } catch (error) {
    return missingFilesystemEntry(error) ? { status: "missing" } : { status: "unsafe" };
  } finally {
    if (descriptor !== undefined) {
      try {
        fsSync.closeSync(descriptor);
      } catch {
        // A failed close does not make an advisory read actionable.
      }
    }
  }
}

export function parseUpdateCache(value: unknown): UpdateCache | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== cacheSchemaVersion || candidate.packageName !== packageName) return undefined;

  const latestVersion = candidate.latestVersion;
  const checkedAt = candidate.checkedAt;
  const failedAt = candidate.failedAt;
  const attemptedAt = candidate.attemptedAt;
  const ownerGeneration = candidate.ownerGeneration;
  const hasSuccessfulResult = latestVersion !== undefined || checkedAt !== undefined;
  if (hasSuccessfulResult && (parseStableVersion(latestVersion) === undefined || !safeTimestamp(checkedAt))) return undefined;
  if (failedAt !== undefined && !safeTimestamp(failedAt)) return undefined;
  if (attemptedAt !== undefined && !safeTimestamp(attemptedAt)) return undefined;
  if (ownerGeneration !== undefined && (typeof ownerGeneration !== "string" || ownerGeneration.length === 0 || attemptedAt === undefined)) {
    return undefined;
  }
  if (!hasSuccessfulResult && failedAt === undefined && attemptedAt === undefined) return undefined;

  return {
    schemaVersion: 1,
    packageName,
    ...(hasSuccessfulResult ? { latestVersion: latestVersion as string, checkedAt: checkedAt as number } : {}),
    ...(failedAt === undefined ? {} : { failedAt }),
    ...(attemptedAt === undefined ? {} : { attemptedAt }),
    ...(ownerGeneration === undefined ? {} : { ownerGeneration: ownerGeneration as string })
  };
}

async function readUpdateCacheState(cachePath: string): Promise<UpdateCacheRead> {
  const read = await readSafeRegularFile(cachePath, updateCacheMaxBytes);
  if (read.status === "unsafe") return { status: "unsafe" };
  if (read.status === "missing") return { status: "safe", cache: undefined };
  try {
    return { status: "safe", cache: parseUpdateCache(JSON.parse(read.text)) };
  } catch {
    return { status: "safe", cache: undefined };
  }
}

export async function readUpdateCache(cachePath: string): Promise<UpdateCache | undefined> {
  const read = await readUpdateCacheState(cachePath);
  return read.status === "safe" ? read.cache : undefined;
}

function lockIsOwnedBySync(lock: RefreshLock): boolean {
  if (safeDirectoryStatusSync(lock.path) !== "safe") return false;
  const read = readSafeRegularFileSync(path.join(lock.path, "owner.json"), updateLockOwnerMaxBytes);
  if (read.status !== "ok") return false;
  try {
    const parsed = JSON.parse(read.text) as Record<string, unknown>;
    const generation = typeof parsed.generation === "string" ? parsed.generation : parsed.token;
    return generation === lock.generation && safeTimestamp(parsed.acquiredAt);
  } catch {
    return false;
  }
}

function updateCacheCommitIsOwned(cachePath: string, guard: UpdateCacheCommitGuard): boolean {
  if (guard.expectedCacheOwnerGeneration !== undefined) {
    const read = readSafeRegularFileSync(cachePath, updateCacheMaxBytes);
    if (read.status !== "ok") return false;
    try {
      const current = parseUpdateCache(JSON.parse(read.text));
      if (current?.ownerGeneration !== guard.expectedCacheOwnerGeneration) return false;
    } catch {
      return false;
    }
  }
  if (!lockIsOwnedBySync(guard.refresh)) return false;
  return lockIsOwnedBySync(guard.transition);
}

async function commitUpdateCacheAtomically(
  cachePath: string,
  cache: UpdateCache,
  guard?: UpdateCacheCommitGuard
): Promise<boolean> {
  const directory = path.dirname(cachePath);
  await ensureSafePrivateDirectory(directory);
  const temporaryPath = path.join(directory, `.update-check.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (guard && !updateCacheCommitIsOwned(cachePath, guard)) return false;
    fsSync.renameSync(temporaryPath, cachePath);
    return true;
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function writeUpdateCacheAtomically(cachePath: string, cache: UpdateCache): Promise<void> {
  await commitUpdateCacheAtomically(cachePath, cache);
}

export function shouldRunUpdateNotifier(input: UpdateNotifierGate): boolean {
  if (input.exitCode !== 0) return false;
  if (input.argv[0] !== "install" && input.argv[0] !== "doctor") return false;
  if (input.argv.some((arg) => arg === "--dry-run" || arg === "--json" || arg === "--help" || arg === "-h")) return false;
  if (input.stdinIsTTY !== true || input.stdoutIsTTY !== true || input.stderrIsTTY !== true) return false;
  if (input.env.CI !== undefined) return false;
  if (input.env.NO_UPDATE_NOTIFIER !== undefined || input.env.LITOPENCODE_NO_UPDATE_CHECK !== undefined) return false;
  return true;
}

export function shouldRefreshUpdateCache(cache: UpdateCache | undefined, now: number): boolean {
  if (cacheHasFutureTimestamp(cache, now)) return true;
  if (cache?.failedAt !== undefined && now - cache.failedAt < updateCheckIntervalMs) return false;
  if (cache?.checkedAt !== undefined && now - cache.checkedAt < updateCheckIntervalMs) return false;
  if (cache?.attemptedAt !== undefined && now - cache.attemptedAt < updateCheckIntervalMs) return false;
  return true;
}

function cacheHasFutureTimestamp(cache: UpdateCache | undefined, now: number): boolean {
  return cache !== undefined && [cache.checkedAt, cache.failedAt, cache.attemptedAt]
    .some((timestamp) => timestamp !== undefined && timestamp > now);
}

function successfulCacheFields(cache: UpdateCache | undefined, now: number): Pick<UpdateCache, "latestVersion" | "checkedAt"> {
  if (
    cache === undefined ||
    cacheHasFutureTimestamp(cache, now) ||
    cache.latestVersion === undefined ||
    cache.checkedAt === undefined
  ) {
    return {};
  }
  return { latestVersion: cache.latestVersion, checkedAt: cache.checkedAt };
}

export function renderUpdateNotice(currentVersion: unknown, latestVersion: unknown): string | undefined {
  if (compareStableVersions(latestVersion, currentVersion) !== 1) return undefined;
  return [
    `LitOpenCode update available: ${String(currentVersion)} -> ${String(latestVersion)}`,
    `Run: npm exec --yes --package @litfamily/litopencode@${String(latestVersion)} -- litopencode install --no-model-prompt --no-permission-prompt --no-auto-update`,
    "Restart OpenCode after installing."
  ].join("\n");
}

function contentType(headers: IncomingHttpHeaders): string | undefined {
  const value = headers["content-type"];
  return typeof value === "string" ? value : undefined;
}

export async function readRegistryLatestVersion(response: RegistryResponse): Promise<string> {
  if (response.statusCode !== 200) throw new Error("npm latest endpoint must return exact status 200");
  const responseContentType = contentType(response.headers);
  if (!responseContentType || !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(responseContentType)) {
    throw new Error("npm latest endpoint must return a JSON content type");
  }

  const declaredLength = response.headers["content-length"];
  if (typeof declaredLength === "string" && /^\d+$/.test(declaredLength) && BigInt(declaredLength) > BigInt(updateResponseMaxBytes)) {
    throw new Error("npm latest response exceeds 64 KiB");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > updateResponseMaxBytes) throw new Error("npm latest response exceeds 64 KiB");
    chunks.push(buffer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("npm latest endpoint returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("npm latest endpoint returned an invalid package record");
  }
  const record = parsed as Record<string, unknown>;
  if (record.name !== packageName) throw new Error("npm latest endpoint returned the wrong package identity");
  if (parseStableVersion(record.version) === undefined) throw new Error("npm latest endpoint returned an invalid stable version");
  return record.version as string;
}

export function requestRegistryLatestVersionWithTransport(transport: RegistryTransport): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: RegistryRequest | undefined;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };
    const deadline = setTimeout(() => {
      const error = new Error("npm latest request exceeded the 3 second total timeout");
      finish(() => {
        request?.destroy(error);
        reject(error);
      });
    }, updateTimeoutMs);
    try {
      request = transport(
        npmLatestUrl,
        {
          headers: {
            accept: "application/json",
            "user-agent": "litopencode-update-check"
          }
        },
        (response) => {
          void readRegistryLatestVersion(response).then(
            (version) => finish(() => resolve(version)),
            (error: unknown) => finish(() => {
              const responseError = error instanceof Error ? error : new Error(String(error));
              request?.destroy(responseError);
              reject(responseError);
            })
          );
        }
      );
      request.once("error", (error) => finish(() => reject(error)));
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export function requestRegistryLatestVersion(): Promise<string> {
  return requestRegistryLatestVersionWithTransport((url, options, callback) => https.get(url, options, callback));
}

async function readLockOwner(lockPath: string): Promise<LockOwnerRead> {
  if ((await safeDirectoryStatus(lockPath)) !== "safe") return { status: "unsafe" };
  const read = await readSafeRegularFile(path.join(lockPath, "owner.json"), updateLockOwnerMaxBytes);
  if (read.status === "unsafe") return { status: "unsafe" };
  if (read.status === "missing") return { status: "missing" };
  try {
    const parsed = JSON.parse(read.text) as Record<string, unknown>;
    const generation = typeof parsed.generation === "string" ? parsed.generation : parsed.token;
    if (typeof generation !== "string" || generation.length === 0 || !safeTimestamp(parsed.acquiredAt)) {
      return { status: "invalid" };
    }
    return { status: "valid", owner: { path: lockPath, generation, acquiredAt: parsed.acquiredAt } };
  } catch {
    return { status: "invalid" };
  }
}

async function lockOwner(lockPath: string): Promise<RefreshLock | undefined> {
  const read = await readLockOwner(lockPath);
  return read.status === "valid" ? read.owner : undefined;
}

async function lockIsStale(lockPath: string, now: number): Promise<boolean> {
  const read = await readLockOwner(lockPath);
  if (read.status === "unsafe") return false;
  if (read.status === "valid") {
    return read.owner.acquiredAt > now || now - read.owner.acquiredAt >= updateLockStaleMs;
  }
  try {
    const stats = await fs.lstat(lockPath);
    if (!safePrivateDirectory(stats)) return false;
    return stats.mtimeMs > now || now - stats.mtimeMs >= updateLockStaleMs;
  } catch {
    return true;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function lockIsOwnedBy(lock: RefreshLock): Promise<boolean> {
  return (await lockOwner(lock.path))?.generation === lock.generation;
}

async function acquireTransitionLock(homeDir: string | undefined): Promise<RefreshLock> {
  const lockPath = updateTransitionLockPath(homeDir);
  await ensureSafePrivateDirectory(path.dirname(lockPath));
  const deadline = Date.now() + updateLockStaleMs + 1000;
  while (true) {
    const generation = randomUUID();
    const acquiredAt = Date.now();
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      const owner = { path: lockPath, generation, acquiredAt };
      try {
        await fs.writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify({ generation, acquiredAt })}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
        return owner;
      } catch (error) {
        await fs.rm(lockPath, { recursive: true, force: true });
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStatus = await safeDirectoryStatus(lockPath);
      if (lockStatus === "missing") {
        if (Date.now() >= deadline) throw new Error("update transition mutex acquisition timed out");
        continue;
      }
      if (lockStatus === "unsafe") {
        throw new Error("update transition mutex is unsafe");
      }
      const ownerRead = await readSafeRegularFile(path.join(lockPath, "owner.json"), updateLockOwnerMaxBytes);
      if (ownerRead.status === "unsafe") throw new Error("update transition mutex owner is unsafe");
      const currentNow = Date.now();
      // Never age-evict this mutex: an owner paused at a filesystem await can still resume and mutate.
      if (currentNow >= deadline) throw new Error("update transition mutex acquisition timed out");
      await wait(10);
    }
  }
}

async function releaseOwnedLock(lock: RefreshLock): Promise<void> {
  const owner = await lockOwner(lock.path);
  if (owner?.generation !== lock.generation) return;
  await fs.rm(lock.path, { recursive: true, force: true });
}

async function withTransitionLock<T>(
  homeDir: string | undefined,
  operation: (transition: RefreshLock) => Promise<T>
): Promise<T> {
  const transition = await acquireTransitionLock(homeDir);
  try {
    return await operation(transition);
  } finally {
    await releaseOwnedLock(transition);
  }
}

async function acquireRefreshLock(homeDir: string | undefined, clock: () => number): Promise<RefreshLock | undefined> {
  return withTransitionLock(homeDir, async (transition) => {
    const lockPath = updateLockPath(homeDir);
    if (!(await lockIsOwnedBy(transition))) return undefined;
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await lockIsStale(lockPath, clock()))) return undefined;
      if (!(await lockIsOwnedBy(transition))) return undefined;
      await fs.rm(lockPath, { recursive: true, force: true });
      await fs.mkdir(lockPath, { mode: 0o700 });
    }

    const generation = randomUUID();
    try {
      if (!(await lockIsOwnedBy(transition))) return undefined;
      const acquiredAt = clock();
      const owner = { path: lockPath, generation, acquiredAt };
      await fs.writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify({ generation, acquiredAt })}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      return owner;
    } catch (error) {
      if (await lockIsOwnedBy(transition)) await fs.rm(lockPath, { recursive: true, force: true });
      throw error;
    }
  });
}

async function reserveRefreshAttempt(
  homeDir: string | undefined,
  cachePath: string,
  lock: RefreshLock,
  clock: () => number
): Promise<boolean> {
  return withTransitionLock(homeDir, async (transition) => {
    const owner = await lockOwner(lock.path);
    if (owner?.generation !== lock.generation) return false;
    const cacheRead = await readUpdateCacheState(cachePath);
    if (cacheRead.status === "unsafe") return false;
    const current = cacheRead.cache;
    if (!shouldRefreshUpdateCache(current, clock())) return false;
    if ((await lockOwner(lock.path))?.generation !== lock.generation) return false;
    if (!(await lockIsOwnedBy(transition))) return false;
    const attemptedAt = clock();
    return commitUpdateCacheAtomically(cachePath, {
      schemaVersion: 1,
      packageName,
      ...successfulCacheFields(current, attemptedAt),
      attemptedAt,
      ownerGeneration: lock.generation
    }, {
      transition,
      refresh: lock
    });
  });
}

type RefreshCompletion =
  | { readonly status: "success"; readonly latestVersion: string }
  | { readonly status: "failure" };

async function commitRefreshCompletion(
  homeDir: string | undefined,
  cachePath: string,
  lock: RefreshLock,
  clock: () => number,
  completion: RefreshCompletion
): Promise<boolean> {
  return withTransitionLock(homeDir, async (transition) => {
    const owner = await lockOwner(lock.path);
    if (owner?.generation !== lock.generation) return false;
    const cacheRead = await readUpdateCacheState(cachePath);
    if (cacheRead.status === "unsafe") return false;
    const current = cacheRead.cache;
    if (current?.ownerGeneration !== lock.generation) return false;

    if ((await lockOwner(lock.path))?.generation !== lock.generation) return false;
    if (!(await lockIsOwnedBy(transition))) return false;
    const completedAt = clock();
    let committed: boolean;
    if (completion.status === "success") {
      committed = await commitUpdateCacheAtomically(cachePath, {
        schemaVersion: 1,
        packageName,
        latestVersion: completion.latestVersion,
        checkedAt: completedAt
      }, {
        transition,
        refresh: lock,
        expectedCacheOwnerGeneration: lock.generation
      });
    } else {
      committed = await commitUpdateCacheAtomically(cachePath, {
        schemaVersion: 1,
        packageName,
        ...successfulCacheFields(current, completedAt),
        failedAt: completedAt
      }, {
        transition,
        refresh: lock,
        expectedCacheOwnerGeneration: lock.generation
      });
    }
    if (!committed) return false;
    if ((await lockOwner(lock.path))?.generation !== lock.generation) return false;
    if (!(await lockIsOwnedBy(transition))) return false;
    await fs.rm(lock.path, { recursive: true, force: true });
    return true;
  });
}

async function releaseRefreshLock(homeDir: string | undefined, lock: RefreshLock): Promise<void> {
  await withTransitionLock(homeDir, async (transition) => {
    if ((await lockOwner(lock.path))?.generation !== lock.generation) return;
    if (!(await lockIsOwnedBy(transition))) return;
    await fs.rm(lock.path, { recursive: true, force: true });
  });
}

export async function refreshUpdateCache(options: RefreshUpdateCacheOptions = {}): Promise<void> {
  const stateDirectory = path.dirname(updateCachePath(options.homeDir));
  if ((await safeDirectoryStatus(stateDirectory)) === "unsafe") return;
  const transitionPath = updateTransitionLockPath(options.homeDir);
  const transitionStatus = await safeDirectoryStatus(transitionPath);
  if (transitionStatus === "unsafe") return;
  if (transitionStatus === "safe") {
    const ownerRead = await readSafeRegularFile(path.join(transitionPath, "owner.json"), updateLockOwnerMaxBytes);
    if (ownerRead.status === "unsafe") return;
  }
  const fixedNow = options.now;
  const clock = options.clock ?? (fixedNow === undefined ? Date.now : () => fixedNow);
  const cachePath = updateCachePath(options.homeDir);
  const lock = await acquireRefreshLock(options.homeDir, clock);
  if (!lock) return;
  try {
    if (!(await reserveRefreshAttempt(options.homeDir, cachePath, lock, clock))) return;
    try {
      const latestVersion = await (options.fetchLatestVersion ?? requestRegistryLatestVersion)();
      if (parseStableVersion(latestVersion) === undefined) throw new Error("update check returned an invalid stable version");
      await commitRefreshCompletion(options.homeDir, cachePath, lock, clock, { status: "success", latestVersion });
    } catch {
      await commitRefreshCompletion(options.homeDir, cachePath, lock, clock, { status: "failure" });
    }
  } finally {
    await releaseRefreshLock(options.homeDir, lock);
  }
}

function detachedUpdateEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SystemRoot", "SYSTEMROOT", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"]) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  return childEnv;
}

export function launchDetachedUpdateRefreshWith(
  spawnProcess: DetachedUpdateSpawn,
  env: NodeJS.ProcessEnv,
  execPath: string,
  helperPath: string
): void {
  const child = spawnProcess(execPath, [helperPath, "--refresh"], {
    detached: true,
    stdio: "ignore",
    env: detachedUpdateEnvironment(env)
  });
  child.once("error", () => undefined);
  child.unref();
}

export function launchDetachedUpdateRefresh(env: NodeJS.ProcessEnv = process.env): void {
  const helperPath = fileURLToPath(new URL("./update-check.js", import.meta.url));
  launchDetachedUpdateRefreshWith(spawn, env, process.execPath, helperPath);
}

export async function runUpdateNotifier(options: RunUpdateNotifierOptions): Promise<void> {
  if (!shouldRunUpdateNotifier(options)) return;
  try {
    const metadata = options.currentVersion === undefined ? await readPackageMetadata() : undefined;
    if (metadata && metadata.name !== packageName) return;
    const currentVersion = options.currentVersion ?? metadata?.version;
    if (parseStableVersion(currentVersion) === undefined) return;

    const stateDirectory = path.dirname(updateCachePath(options.homeDir));
    if ((await safeDirectoryStatus(stateDirectory)) === "unsafe") return;
    const now = options.now ?? Date.now();
    const cacheRead = await readUpdateCacheState(updateCachePath(options.homeDir));
    if (cacheRead.status === "unsafe") return;
    const cache = cacheRead.cache;
    const notice = cache?.latestVersion === undefined || cacheHasFutureTimestamp(cache, now)
      ? undefined
      : renderUpdateNotice(currentVersion, cache.latestVersion);
    if (notice) (options.writeStderr ?? ((text) => process.stderr.write(text)))(`${notice}\n`);
    if (shouldRefreshUpdateCache(cache, now)) (options.launchRefresh ?? (() => launchDetachedUpdateRefresh(options.env)))();
  } catch {
    // Update checks are advisory and must never change CLI command behavior.
  }
}
