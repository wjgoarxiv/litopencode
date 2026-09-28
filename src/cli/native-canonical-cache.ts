import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CanonicalManagedAsset } from "./managed-skill-assets.ts";
import { exactTreeFailures, inventoryTree } from "./native-skill-tree.ts";

export type RetainedCanonicalCache = { readonly path: string; readonly sha256: string };

export async function inspectCanonicalTree(
  root: string,
  assets: readonly CanonicalManagedAsset[]
): Promise<{ failures: string[]; caches: RetainedCanonicalCache[] }> {
  const inventory = await inventoryTree(root);
  const expected = new Set(assets.map((asset) => asset.path));
  const failures = [...inventory.unsafe];
  const caches: RetainedCanonicalCache[] = [];
  // Bytecode is opaque user state, never validation input or an executable here.
  // Its source must still be one of the exact unchanged packaged Python files.
  for (const asset of assets) {
    if (!inventory.files.includes(asset.path)) continue;
    const actual = createHash("sha256").update(await fs.readFile(path.join(root, asset.path))).digest("hex");
    if (actual !== asset.sha256) failures.push(asset.path);
  }
  if (failures.length === 0) {
    for (const file of inventory.files) {
      if (expected.has(file)) continue;
      const directory = path.posix.dirname(file);
      if (path.posix.basename(directory) !== "__pycache__") continue;
      const match = /^(.*)\.(?:cpython-[0-9]+|pypy[0-9]+)(?:\.opt-[0-9]+)?\.pyc$/.exec(path.posix.basename(file));
      if (match === null) continue;
      const source = path.posix.join(path.posix.dirname(directory), `${match[1]}.py`);
      if (!expected.has(source) || !inventory.files.includes(source)) continue;
      caches.push({ path: file, sha256: createHash("sha256").update(await fs.readFile(path.join(root, file))).digest("hex") });
    }
  }
  failures.push(...exactTreeFailures(inventory, [...expected, ...caches.map((cache) => cache.path)]));
  return { failures: [...new Set(failures)].sort(), caches };
}
