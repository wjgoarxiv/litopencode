import fs from "node:fs/promises";
import path from "node:path";

export type TreeInventory = {
  readonly files: readonly string[];
  readonly directories: readonly string[];
  readonly unsafe: readonly string[];
};

export async function lstatIfPresent(filePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export function assertContained(base: string, target: string, label: string): void {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) return;
  throw new Error(`${label} escapes its managed root: ${target}`);
}

export async function assertPathComponentsSafe(base: string, target: string, label: string): Promise<void> {
  assertContained(base, target, label);
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedBase, resolvedTarget);
  const candidates = [resolvedBase];
  let current = resolvedBase;
  if (relative !== "") {
    for (const component of relative.split(path.sep)) {
      current = path.join(current, component);
      candidates.push(current);
    }
  }
  for (const candidate of candidates) {
    const stat = await lstatIfPresent(candidate);
    if (stat?.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${candidate}`);
  }
}

export async function resolveSafeDirectory(base: string, target: string, label: string): Promise<string> {
  const resolvedTarget = path.resolve(target);
  assertContained(base, resolvedTarget, label);
  await assertPathComponentsSafe(base, path.dirname(resolvedTarget), label);

  const stat = await lstatIfPresent(resolvedTarget);
  if (stat === null) return resolvedTarget;
  if (!stat.isSymbolicLink()) {
    if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${resolvedTarget}`);
    return resolvedTarget;
  }

  const canonicalTarget = await fs.realpath(resolvedTarget);
  if (!(await fs.stat(canonicalTarget)).isDirectory()) {
    throw new Error(`${label} symbolic link does not target a directory: ${resolvedTarget}`);
  }
  return canonicalTarget;
}

export async function inventoryTree(root: string): Promise<TreeInventory> {
  const files: string[] = [];
  const directories: string[] = [];
  const unsafe: string[] = [];

  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        unsafe.push(relative);
      } else if (entry.isDirectory()) {
        directories.push(relative);
        await walk(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        files.push(relative);
      } else {
        unsafe.push(relative);
      }
    }
  }

  await walk(root, "");
  return { files: files.sort(), directories: directories.sort(), unsafe: unsafe.sort() };
}

export function exactTreeFailures(inventory: TreeInventory, expectedFiles: readonly string[]): string[] {
  const failures = [...inventory.unsafe];
  const actualFiles = new Set(inventory.files);
  const expectedFileSet = new Set(expectedFiles);
  const expectedDirectorySet = new Set<string>();
  for (const file of expectedFiles) {
    let directory = path.posix.dirname(file);
    while (directory !== ".") {
      expectedDirectorySet.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  for (const file of expectedFiles) if (!actualFiles.has(file)) failures.push(file);
  for (const file of inventory.files) if (!expectedFileSet.has(file)) failures.push(file);
  for (const directory of inventory.directories) {
    if (!expectedDirectorySet.has(directory)) failures.push(directory + "/");
  }
  return [...new Set(failures)].sort();
}
