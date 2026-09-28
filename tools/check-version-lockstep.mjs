#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REGISTRY_FILE = "tools/version-manifests.json";
const REGISTRY_KINDS = new Set(["pinned", "history", "derived"]);

class VersionLockstepError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "VersionLockstepError";
    this.exitCode = exitCode;
  }
}

function parseArgs(argv) {
  const options = {
    packagePath: "package.json",
    lockfilePath: "package-lock.json"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--package" && next !== undefined) {
      options.packagePath = next;
      index += 1;
    } else if (arg === "--lockfile" && next !== undefined) {
      options.lockfilePath = next;
      index += 1;
    } else {
      throw new VersionLockstepError(`unknown or incomplete argument: ${arg}`, 2);
    }
  }

  return options;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (label === "package-lock.json" && error && error.code === "ENOENT") {
      return undefined;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new VersionLockstepError(`cannot read or parse ${label}: ${detail}`, 2);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VersionLockstepError(`${label} must be a JSON object`, 2);
  }
  return value;
}

function requireString(object, field, label) {
  const value = object[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new VersionLockstepError(`${label} ${field} must be a non-empty string`, 2);
  }
  return value;
}

function readPackageIdentity(parsedPackage) {
  const packageObject = requireObject(parsedPackage, "package.json");
  return {
    name: requireString(packageObject, "name", "package.json"),
    version: requireString(packageObject, "version", "package.json")
  };
}

function readLockfileIdentity(parsedLockfile) {
  if (parsedLockfile === undefined) {
    return undefined;
  }
  const lockfileObject = requireObject(parsedLockfile, "package-lock.json");
  return {
    name: requireString(lockfileObject, "name", "package-lock.json"),
    version: requireString(lockfileObject, "version", "package-lock.json"),
    packages: lockfileObject.packages
  };
}

function readRootPackageEntry(packages) {
  if (packages === undefined) {
    return undefined;
  }
  const packagesObject = requireObject(packages, "package-lock.json packages");
  const rootEntry = packagesObject[""];
  if (rootEntry === undefined) {
    return undefined;
  }
  const rootObject = requireObject(rootEntry, 'package-lock.json packages[""]');
  return {
    name: requireString(rootObject, "name", 'package-lock.json packages[""]'),
    version: requireString(rootObject, "version", 'package-lock.json packages[""]')
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new VersionLockstepError(`${label} mismatch: expected ${expected}, found ${actual}`, 1);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function countOccurrences(text, needle) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function countVersionOccurrences(text, version) {
  const escaped = version.replace(/\./gu, "\\.");
  return countOccurrences(text, version) + countOccurrences(text, escaped);
}

function countJsonIdentityVersionOccurrences(relativePath, text, version) {
  if (relativePath !== "package.json" && relativePath !== "package-lock.json") return undefined;

  const parsed = requireObject(JSON.parse(text), relativePath);
  if (relativePath === "package.json") return parsed.version === version ? 1 : 0;

  const rootEntry = readRootPackageEntry(parsed.packages);
  return Number(parsed.version === version) + Number(rootEntry?.version === version);
}

async function checkVersionRegistry(packagePath, version) {
  const repoRoot = path.dirname(packagePath);
  const registryPath = path.resolve(repoRoot, REGISTRY_FILE);
  const registry = requireObject(await readJson(registryPath, REGISTRY_FILE), REGISTRY_FILE);
  if (!Array.isArray(registry.manifests)) {
    throw new VersionLockstepError(`${REGISTRY_FILE} manifests must be an array`, 2);
  }

  const seen = new Set();
  for (const rawEntry of registry.manifests) {
    const entry = requireObject(rawEntry, `${REGISTRY_FILE} entry`);
    const relativePath = requireString(entry, "path", `${REGISTRY_FILE} entry`);
    const kind = requireString(entry, "kind", `${REGISTRY_FILE} entry ${relativePath}`);
    if (!REGISTRY_KINDS.has(kind)) {
      throw new VersionLockstepError(`${REGISTRY_FILE} entry ${relativePath} has unsupported kind ${kind}`, 2);
    }
    if (seen.has(relativePath)) {
      throw new VersionLockstepError(`${REGISTRY_FILE} contains duplicate path ${relativePath}`, 2);
    }
    seen.add(relativePath);
    if (!Number.isInteger(entry.occurrences) || entry.occurrences < 1) {
      throw new VersionLockstepError(`${REGISTRY_FILE} entry ${relativePath} occurrences must be a positive integer`, 2);
    }
    requireString(entry, "why", `${REGISTRY_FILE} entry ${relativePath}`);

    const absolutePath = path.resolve(repoRoot, relativePath);
    const relativeToRoot = path.relative(repoRoot, absolutePath);
    if (relativeToRoot === "" || relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
      throw new VersionLockstepError(`${REGISTRY_FILE} entry ${relativePath} escapes the repository`, 2);
    }

    let text;
    try {
      text = await fs.readFile(absolutePath, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new VersionLockstepError(`cannot read registered file ${relativePath}: ${detail}`, 2);
    }

    if (kind === "history") {
      const heading = new RegExp(`^##\\s+${escapeRegExp(version)}(?:\\s|$)`, "mu");
      if (!heading.test(text)) {
        throw new VersionLockstepError(`${relativePath} has no heading for the current package version`, 1);
      }
      continue;
    }

    const actual = countJsonIdentityVersionOccurrences(relativePath, text, version)
      ?? countVersionOccurrences(text, version);
    if (actual !== entry.occurrences) {
      throw new VersionLockstepError(`${relativePath} version occurrence mismatch: expected ${entry.occurrences}, found ${actual}`, 1);
    }
  }

  return registry.manifests.length;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const packagePath = path.resolve(options.packagePath);
    const lockfilePath = path.resolve(options.lockfilePath);
    const [parsedPackage, parsedLockfile] = await Promise.all([
      readJson(packagePath, "package.json"),
      readJson(lockfilePath, "package-lock.json")
    ]);
    const packageIdentity = readPackageIdentity(parsedPackage);
    const lockfileIdentity = readLockfileIdentity(parsedLockfile);
    if (lockfileIdentity === undefined) {
      console.log(`version lockstep skipped: package-lock.json not present for ${packageIdentity.name}@${packageIdentity.version}`);
      return;
    }
    const rootEntryIdentity = readRootPackageEntry(lockfileIdentity.packages);

    assertEqual(lockfileIdentity.name, packageIdentity.name, "lockfile root name");
    assertEqual(lockfileIdentity.version, packageIdentity.version, "lockfile root version");

    if (rootEntryIdentity !== undefined) {
      assertEqual(rootEntryIdentity.name, packageIdentity.name, 'lockfile packages[""] name');
      assertEqual(rootEntryIdentity.version, packageIdentity.version, 'lockfile packages[""] version');
    }

    if (options.packagePath === "package.json" && options.lockfilePath === "package-lock.json") {
      await checkVersionRegistry(packagePath, packageIdentity.version);
    }

    console.log(`version lockstep passed: ${packageIdentity.name}@${packageIdentity.version}`);
  } catch (error) {
    if (error instanceof VersionLockstepError) {
      console.error(`version lockstep failed: ${error.message}`);
      process.exitCode = error.exitCode;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`version lockstep failed: ${message}`);
    process.exitCode = 2;
  }
}

await main();
