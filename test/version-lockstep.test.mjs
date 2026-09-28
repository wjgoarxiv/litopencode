import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const checkerPath = path.resolve("tools/check-version-lockstep.mjs");
const packagePath = path.resolve("package.json");
const registryPath = path.resolve("tools/version-manifests.json");

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-version-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function writePackagePair(dir, packageJson, lockfileJson) {
  const packagePath = path.join(dir, "package.json");
  const lockfilePath = path.join(dir, "package-lock.json");
  await writeJson(packagePath, packageJson);
  await writeJson(lockfilePath, lockfileJson);
  return { packagePath, lockfilePath };
}

function runChecker(packagePath, lockfilePath) {
  return spawnSync(process.execPath, [checkerPath, "--package", packagePath, "--lockfile", lockfilePath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function runRepositoryChecker() {
  return spawnSync(process.execPath, [checkerPath], { cwd: process.cwd(), encoding: "utf8" });
}

function runRepositoryCheckerFrom(cwd) {
  return spawnSync(process.execPath, [checkerPath], { cwd, encoding: "utf8" });
}

function trackedVersionFiles(version) {
  const listing = spawnSync("git", ["ls-files", "-z"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(listing.error, undefined, listing.error?.message);
  assert.equal(listing.status, 0, listing.stderr);
  const escaped = version.replace(/\./gu, "\\.");
  return listing.stdout
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => {
      let text;
      try {
        text = readFileSync(path.resolve(relativePath), "utf8");
      } catch {
        return false;
      }
      return text.includes(version) || text.includes(escaped);
    })
    .sort();
}

test("matching package and lockfile versions pass", async () => {
  await withTempDir(async (dir) => {
    const { packagePath, lockfilePath } = await writePackagePair(
      dir,
      { name: "litopencode", version: "1.2.3" },
      {
        name: "litopencode",
        version: "1.2.3",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "litopencode",
            version: "1.2.3"
          }
        }
      }
    );

    const result = runChecker(packagePath, lockfilePath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /version lockstep passed: litopencode@1\.2\.3/);
  });
});

test("packed package without a lockfile skips source-only lockstep", async () => {
  await withTempDir(async (dir) => {
    const packagePath = path.join(dir, "package.json");
    const lockfilePath = path.join(dir, "package-lock.json");
    await writeJson(packagePath, { name: "litopencode", version: "1.2.3" });

    const result = runChecker(packagePath, lockfilePath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /version lockstep skipped: package-lock\.json not present for litopencode@1\.2\.3/);
  });
});

test("top-level lockfile package mismatch fails closed", async () => {
  await withTempDir(async (dir) => {
    const { packagePath, lockfilePath } = await writePackagePair(
      dir,
      { name: "litopencode", version: "1.2.3" },
      {
        name: "litopencode",
        version: "2.0.0",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "litopencode",
            version: "1.2.3"
          }
        }
      }
    );

    const result = runChecker(packagePath, lockfilePath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /lockfile root version mismatch/);
  });
});

test("root package entry mismatch fails closed", async () => {
  await withTempDir(async (dir) => {
    const { packagePath, lockfilePath } = await writePackagePair(
      dir,
      { name: "litopencode", version: "1.2.3" },
      {
        name: "litopencode",
        version: "1.2.3",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "litopencode-renamed",
            version: "1.2.3"
          }
        }
      }
    );

    const result = runChecker(packagePath, lockfilePath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /lockfile packages\[""\] name mismatch/);
  });
});

test("malformed json fails closed", async () => {
  await withTempDir(async (dir) => {
    const packagePath = path.join(dir, "package.json");
    const lockfilePath = path.join(dir, "package-lock.json");
    await fs.writeFile(packagePath, "{");
    await writeJson(lockfilePath, {
      name: "litopencode",
      version: "1.2.3",
      lockfileVersion: 3
    });

    const result = runChecker(packagePath, lockfilePath);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot read or parse package.json/);
  });
});

test("missing required fields fail closed", async () => {
  await withTempDir(async (dir) => {
    const { packagePath, lockfilePath } = await writePackagePair(
      dir,
      { name: "litopencode" },
      {
        name: "litopencode",
        version: "1.2.3",
        lockfileVersion: 3
      }
    );

    const result = runChecker(packagePath, lockfilePath);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /package.json version must be a non-empty string/);
  });
});

test("the repository registry guard accepts all classified version sites", () => {
  const result = runRepositoryChecker();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /version lockstep passed: @litfamily\/litopencode@/u);
});

test("dependency strings matching the package version are not product version sites", async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "tools"));
    await writeJson(path.join(dir, "package.json"), { name: "litopencode", version: "1.2.3" });
    await writeJson(path.join(dir, "package-lock.json"), {
      name: "litopencode",
      version: "1.2.3",
      lockfileVersion: 3,
      packages: {
        "": { name: "litopencode", version: "1.2.3" },
        "node_modules/example": {
          version: "1.2.3",
          resolved: "https://registry.npmjs.org/example/-/example-1.2.3.tgz"
        }
      },
      dependencies: { example: "^1.2.3" }
    });
    await writeJson(path.join(dir, "tools/version-manifests.json"), {
      schema: "litopencode.version-lockstep/v1",
      manifests: [
        { path: "package.json", kind: "pinned", occurrences: 1, why: "package identity" },
        { path: "package-lock.json", kind: "derived", occurrences: 2, why: "lockfile identities" }
      ]
    });

    const result = runRepositoryCheckerFrom(dir);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /version lockstep passed: litopencode@1\.2\.3/u);
  });
});

test("every tracked file carrying either version spelling is registered", () => {
  const version = JSON.parse(readFileSync(packagePath, "utf8")).version;
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.ok(registry && Array.isArray(registry.manifests), "registry must contain a manifests array");
  const registered = registry.manifests.map((entry) => entry.path).sort();
  assert.deepEqual(registered, [...new Set(registered)].sort(), "registry paths must be unique");
  assert.deepEqual(
    registered,
    trackedVersionFiles(version),
    "every tracked file carrying the literal or escaped release must be registered exactly once"
  );
  for (const entry of registry.manifests) {
    assert.ok(["pinned", "history", "derived"].includes(entry.kind), `bad kind for ${entry.path}`);
    assert.equal(Number.isInteger(entry.occurrences), true, `occurrences missing for ${entry.path}`);
    assert.ok(entry.occurrences > 0, `occurrences must be positive for ${entry.path}`);
    assert.equal(typeof entry.why, "string", `why missing for ${entry.path}`);
    assert.ok(entry.why.trim().length > 0, `why must be non-empty for ${entry.path}`);
  }
});
