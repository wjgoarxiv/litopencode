import fs from "node:fs/promises";
import path from "node:path";

/**
 * Packed import probes intentionally run before npm installs the extracted
 * package. Stage only the package's declared runtime dependencies as symlinks
 * so those probes exercise the packed dist without bringing dev dependencies
 * (including host-only types) into the fixture.
 */
export async function seedPackedRuntimeDependencies(packageRoot) {
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    const source = path.resolve("node_modules", ...dependencyName.split("/"));
    const sourceStat = await fs.lstat(source);
    if (!sourceStat.isDirectory()) throw new Error(`runtime dependency is not a directory: ${dependencyName}`);
    const target = path.join(packageRoot, "node_modules", ...dependencyName.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.symlink(source, target, process.platform === "win32" ? "junction" : "dir");
  }
}
