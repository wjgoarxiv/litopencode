import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAutoUpdateReceipt } from "./cli/auto-update.ts";
import { compareStableVersions } from "./cli/update-notifier.ts";

// OpenCode keeps running the plugin code it loaded at start, so an update installed meanwhile (by the
// automatic update at start, or by the CLI from a terminal) waits for the next start. The TUI compares
// the version it loaded with what is installed now and, when the install is newer, asks for a restart.
// It never starts anything itself: inside the OpenCode host, `process.execPath` is the host binary.

/** The newest stable installed version strictly newer than the loaded one, or undefined. */
export function restartVersion(loaded: unknown, installed: readonly unknown[]): string | undefined {
  let newest: string | undefined;
  for (const candidate of installed) {
    if (compareStableVersions(candidate, loaded) !== 1) continue;
    if (newest === undefined || compareStableVersions(candidate, newest) === 1) newest = candidate as string;
  }
  return newest;
}

/**
 * What is installed now: the package.json version under `packageRoot`, then the target of an automatic
 * update whose receipt says it was installed. Unreadable or malformed sources are left out.
 */
export async function readInstalledVersions(packageRoot: string, homeDir: string = os.homedir()): Promise<string[]> {
  const versions: string[] = [];
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
    const version = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).version : undefined;
    if (typeof version === "string") versions.push(version);
  } catch {
    // No readable package.json; the receipt may still say what was installed.
  }
  const receipt = await readAutoUpdateReceipt(homeDir).catch(() => undefined);
  if (receipt !== undefined && receipt.status === "updated" && receipt.targetVersion !== undefined) versions.push(receipt.targetVersion);
  return versions;
}
