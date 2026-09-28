import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertContained, assertPathComponentsSafe } from "./native-skill-tree.ts";

export const legacyVendorPaths = [
  { legacy: "022_handoff", canonical: "handoff" },
  { legacy: "045_scientific-visualization", canonical: "scientific-visualization" },
] as const;

/** Move only pristine, manifest-owned numbered vendor roots to their canonical names. */
export async function migrateLegacyVendorPaths(sourceRoot: string, targetRoot: string): Promise<void> {
  await requireDirectory(sourceRoot, "Vendor migration source");
  await requireDirectory(targetRoot, "Vendor migration target");
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  const moves: Array<readonly [string, string]> = [];

  for (const { legacy, canonical } of legacyVendorPaths) {
    const sourcePath = path.join(source, canonical);
    const legacyPath = path.join(target, legacy);
    const canonicalPath = path.join(target, canonical);
    await assertPathComponentsSafe(source, sourcePath, `Vendor source ${canonical}`);
    await assertPathComponentsSafe(target, legacyPath, `Legacy vendor ${legacy}`);
    await assertPathComponentsSafe(target, canonicalPath, `Canonical vendor ${canonical}`);

    const sourceStat = await lstatIfPresent(sourcePath);
    if (sourceStat === null || sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
      throw new Error(`Unsafe or missing canonical vendor source: ${canonical}`);
    }
    const legacyStat = await lstatIfPresent(legacyPath);
    if (legacyStat === null) continue;
    if (legacyStat.isSymbolicLink() || !legacyStat.isDirectory()) {
      throw new Error(`Unsafe legacy vendor path: ${legacy}`);
    }
    if (await lstatIfPresent(canonicalPath) !== null) {
      throw new Error(`Legacy and canonical vendor paths coexist: ${canonical}`);
    }

    const expected = await vendorTreeSignature(sourcePath);
    const actual = await vendorTreeSignature(legacyPath);
    if (!sameSignature(expected, actual)) {
      throw new Error(`Legacy vendor path is modified, foreign, or incomplete: ${legacy}`);
    }
    moves.push([legacyPath, canonicalPath]);
  }

  for (const [legacyPath, canonicalPath] of moves) await fs.rename(legacyPath, canonicalPath);
}

async function requireDirectory(directory: string, label: string): Promise<void> {
  const stat = await fs.lstat(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} is unsafe`);
}

async function lstatIfPresent(filePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function vendorTreeSignature(root: string): Promise<readonly string[]> {
  const entries: string[] = [];
  const visit = async (directory: string, relativePath: string): Promise<void> => {
    const directoryStat = await fs.lstat(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error(`Unsupported vendor entry: ${relativePath || "."}`);
    }
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(directory, entry.name);
      const childRelative = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
      const stat = await fs.lstat(child);
      if (stat.isSymbolicLink()) throw new Error(`Unsafe vendor symlink: ${childRelative}`);
      if (stat.isDirectory()) {
        entries.push(`directory\0${childRelative}\0${stat.mode & 0o7777}`);
        await visit(child, childRelative);
      } else if (stat.isFile()) {
        const digest = createHash("sha256").update(await fs.readFile(child)).digest("hex");
        entries.push(`file\0${childRelative}\0${digest}\0${stat.mode & 0o7777}`);
      } else {
        throw new Error(`Unsupported vendor entry: ${childRelative}`);
      }
    }
  };
  await visit(root, "");
  return entries.sort();
}

function sameSignature(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
