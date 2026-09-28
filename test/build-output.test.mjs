import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

const repositoryRoot = path.resolve(".");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function withIsolatedBuildProject(fn, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-build-output-"));
  try {
    if (options.source !== false) {
      await fs.cp(path.join(repositoryRoot, "src"), path.join(root, "src"), { recursive: true });
    }
    await fs.mkdir(path.join(root, "tools"));
    for (const relativePath of ["package.json", "tsconfig.json", "tsconfig.build.json", "tools/run-build.mjs"]) {
      await fs.copyFile(path.join(repositoryRoot, relativePath), path.join(root, relativePath));
    }
    if (options.compiler !== false) {
      await fs.symlink(
        path.join(repositoryRoot, "node_modules"),
        path.join(root, "node_modules"),
        process.platform === "win32" ? "junction" : "dir"
      );
    }
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function runBuild(root) {
  return spawnSync(npmCommand, ["run", "build"], { cwd: root, encoding: "utf8" });
}

async function compiledFiles(root, relativeDir = "dist") {
  const directory = path.join(root, relativeDir);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...await compiledFiles(root, relativePath));
    else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) files.push(relativePath);
  }
  return files;
}

test("repo-native build removes orphan dist outputs and retains only source-backed compilation", async () => {
  await withIsolatedBuildProject(async (root) => {
    const orphanJavaScript = path.join(root, "dist", "cli", "orphan.js");
    const orphanDeclaration = path.join(root, "dist", "cli", "orphan.d.ts");
    await fs.mkdir(path.dirname(orphanJavaScript), { recursive: true });
    await fs.writeFile(orphanJavaScript, "export const orphan = true;\n");
    await fs.writeFile(orphanDeclaration, "export declare const orphan = true;\n");

    const result = runBuild(root);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    await assert.rejects(fs.access(orphanJavaScript), { code: "ENOENT" });
    await assert.rejects(fs.access(orphanDeclaration), { code: "ENOENT" });
    for (const expected of ["dist/index.js", "dist/index.d.ts", "dist/inert-data.js", "dist/inert-data.d.ts"]) {
      assert.equal((await fs.stat(path.join(root, expected))).isFile(), true, `expected compiled output ${expected}`);
    }
    for (const outputPath of await compiledFiles(root)) {
      const sourcePath = outputPath.endsWith(".d.ts")
        ? `src/${outputPath.slice("dist/".length, -".d.ts".length)}.ts`
        : `src/${outputPath.slice("dist/".length, -".js".length)}.ts`;
      assert.equal((await fs.stat(path.join(root, sourcePath))).isFile(), true, `${outputPath} must have ${sourcePath}`);
    }
  });
});

test("repo-native build refuses a symlinked dist without touching its target", async () => {
  await withIsolatedBuildProject(async (root) => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-build-output-canary-"));
    try {
      const canary = path.join(external, "user-file.txt");
      await fs.writeFile(canary, "preserve me\n");
      await fs.symlink(external, path.join(root, "dist"), process.platform === "win32" ? "junction" : "dir");

      const result = runBuild(root);

      assert.notEqual(result.status, 0, "a symlinked dist must fail closed");
      assert.match(result.stderr, /build failed:.*dist.*symbolic link/i);
      assert.equal(await fs.readFile(canary, "utf8"), "preserve me\n");
      assert.deepEqual(await fs.readdir(external), ["user-file.txt"]);
    } finally {
      await fs.rm(external, { recursive: true, force: true });
    }
  });
});

test("source-present build fails closed without TypeScript and cannot accept stale dist", async () => {
  await withIsolatedBuildProject(async (root) => {
    const staleJavaScript = path.join(root, "dist", "index.js");
    const staleDeclaration = path.join(root, "dist", "index.d.ts");
    const staleBytes = "export const staleBuild = true;\n";
    await fs.mkdir(path.dirname(staleJavaScript), { recursive: true });
    await fs.writeFile(staleJavaScript, staleBytes);
    await fs.writeFile(staleDeclaration, "export declare const staleBuild = true;\n");

    const build = runBuild(root);

    assert.notEqual(build.status, 0, "source-present builds require the TypeScript compiler");
    assert.match(build.stderr, /build failed: TypeScript dev dependency is not installed/i);
    assert.equal(await fs.readFile(staleJavaScript, "utf8"), staleBytes, "failure must occur before dist cleanup");

    const packageGuard = spawnSync(npmCommand, ["run", "check:pack-payload"], { cwd: root, encoding: "utf8" });
    assert.notEqual(packageGuard.status, 0, "package guard must not accept stale compiled output");
    assert.doesNotMatch(packageGuard.stdout, /pack payload guard passed/u);
    assert.match(`${packageGuard.stdout}\n${packageGuard.stderr}`, /build failed: TypeScript dev dependency is not installed/i);
    assert.equal(await fs.readFile(staleJavaScript, "utf8"), staleBytes, "package guard failure must preserve stale evidence");
  }, { compiler: false });
});

test("packed skip requires the canonical src tree to be entirely absent", async () => {
  await withIsolatedBuildProject(async (root) => {
    const sourceEntry = path.join(root, "src", "index.ts");
    const staleEntry = path.join(root, "dist", "index.js");
    const staleBytes = "export const missingIndexCanary = true;\n";
    await fs.rm(sourceEntry);
    await fs.mkdir(path.dirname(staleEntry), { recursive: true });
    await fs.writeFile(staleEntry, staleBytes);

    const result = runBuild(root);

    assert.notEqual(result.status, 0, "an existing src tree without index.ts must not enter packed mode");
    assert.match(result.stderr, /build failed:.*source entry.*missing/i);
    assert.equal(await fs.readFile(staleEntry, "utf8"), staleBytes);
  });

  await withIsolatedBuildProject(async (root) => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-source-tree-canary-"));
    try {
      const externalIndex = path.join(external, "index.ts");
      const staleEntry = path.join(root, "dist", "index.js");
      const staleBytes = "export const sourceTreeSymlinkCanary = true;\n";
      await fs.writeFile(externalIndex, "export const externalSource = true;\n");
      await fs.symlink(external, path.join(root, "src"), process.platform === "win32" ? "junction" : "dir");
      await fs.mkdir(path.dirname(staleEntry), { recursive: true });
      await fs.writeFile(staleEntry, staleBytes);

      const result = runBuild(root);

      assert.notEqual(result.status, 0, "a symlinked src tree must fail closed");
      assert.match(result.stderr, /build failed:.*source tree.*regular non-symlink directory/i);
      assert.equal((await fs.lstat(path.join(root, "src"))).isSymbolicLink(), true);
      assert.equal(await fs.readFile(externalIndex, "utf8"), "export const externalSource = true;\n");
      assert.equal(await fs.readFile(staleEntry, "utf8"), staleBytes);
    } finally {
      await fs.rm(external, { recursive: true, force: true });
    }
  }, { source: false });

  await withIsolatedBuildProject(async (root) => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-source-index-canary-"));
    try {
      const sourceEntry = path.join(root, "src", "index.ts");
      const externalIndex = path.join(external, "index.ts");
      await fs.rm(sourceEntry);
      await fs.writeFile(externalIndex, "export const externalIndex = true;\n");
      await fs.symlink(externalIndex, sourceEntry, "file");

      const result = runBuild(root);

      assert.notEqual(result.status, 0, "a symlinked src/index.ts must fail closed");
      assert.equal((await fs.lstat(sourceEntry)).isSymbolicLink(), true);
      assert.equal(await fs.readFile(externalIndex, "utf8"), "export const externalIndex = true;\n");
    } finally {
      await fs.rm(external, { recursive: true, force: true });
    }
  });

  await withIsolatedBuildProject(async (root) => {
    const sourceEntry = path.join(root, "src", "index.ts");
    await fs.rm(sourceEntry);
    await fs.mkdir(sourceEntry);

    const result = runBuild(root);

    assert.notEqual(result.status, 0, "directory-as-src/index.ts must fail closed");
    assert.equal((await fs.stat(sourceEntry)).isDirectory(), true);
  });
});

test("source-less packed build skips without a compiler and preserves compiled bytes", async () => {
  await withIsolatedBuildProject(async (root) => {
    const builtEntry = path.join(root, "dist", "index.js");
    const packedBytes = "export const packedArtifact = true;\n";
    await fs.mkdir(path.dirname(builtEntry), { recursive: true });
    await fs.writeFile(builtEntry, packedBytes);

    const result = runBuild(root);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /build skipped: source files are not present in this packed artifact/i);
    assert.equal(await fs.readFile(builtEntry, "utf8"), packedBytes);
  }, { source: false, compiler: false });
});

test("repo-native build refuses nested dist symlinks before deleting generated output", async () => {
  await withIsolatedBuildProject(async (root) => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-build-output-nested-canary-"));
    try {
      const canary = path.join(external, "user-file.txt");
      const retainedOutput = path.join(root, "dist", "retained.js");
      await fs.writeFile(canary, "preserve nested target\n");
      await fs.mkdir(path.dirname(retainedOutput), { recursive: true });
      await fs.writeFile(retainedOutput, "export const retained = true;\n");
      await fs.symlink(external, path.join(root, "dist", "linked"), process.platform === "win32" ? "junction" : "dir");

      const result = runBuild(root);

      assert.notEqual(result.status, 0, "nested dist symlinks must fail closed");
      assert.match(result.stderr, /build failed:.*dist contains a symbolic link/i);
      assert.equal(await fs.readFile(canary, "utf8"), "preserve nested target\n");
      assert.equal(await fs.readFile(retainedOutput, "utf8"), "export const retained = true;\n");
      assert.deepEqual(await fs.readdir(external), ["user-file.txt"]);
    } finally {
      await fs.rm(external, { recursive: true, force: true });
    }
  });
});

test("repo-native build rejects a dangling top-level dist symlink without replacing it", async () => {
  await withIsolatedBuildProject(async (root) => {
    const missingTarget = path.join(root, "missing-dist-target");
    const distPath = path.join(root, "dist");
    await fs.symlink(missingTarget, distPath, process.platform === "win32" ? "junction" : "dir");

    const result = runBuild(root);

    assert.notEqual(result.status, 0, "dangling dist symlinks must fail closed");
    assert.match(result.stderr, /build failed:.*dist.*symbolic link/i);
    assert.equal((await fs.lstat(distPath)).isSymbolicLink(), true);
    assert.equal(await fs.readlink(distPath), missingTarget);
    await assert.rejects(fs.access(missingTarget), { code: "ENOENT" });
  });
});

test("source-less packed skip rejects non-canonical dist and index boundaries", async () => {
  await withIsolatedBuildProject(async (root) => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-packed-dist-canary-"));
    try {
      const externalIndex = path.join(external, "index.js");
      await fs.writeFile(externalIndex, "export const external = true;\n");
      await fs.symlink(external, path.join(root, "dist"), process.platform === "win32" ? "junction" : "dir");

      const result = runBuild(root);

      assert.notEqual(result.status, 0, "source-less skip must reject a symlinked dist directory");
      assert.equal((await fs.lstat(path.join(root, "dist"))).isSymbolicLink(), true);
      assert.equal(await fs.readFile(externalIndex, "utf8"), "export const external = true;\n");
    } finally {
      await fs.rm(external, { recursive: true, force: true });
    }
  }, { source: false, compiler: false });

  await withIsolatedBuildProject(async (root) => {
    const indexDirectory = path.join(root, "dist", "index.js");
    await fs.mkdir(indexDirectory, { recursive: true });

    const result = runBuild(root);

    assert.notEqual(result.status, 0, "source-less skip must reject directory-as-index");
    assert.equal((await fs.stat(indexDirectory)).isDirectory(), true);
  }, { source: false, compiler: false });

  await withIsolatedBuildProject(async (root) => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-packed-index-canary-"));
    try {
      const externalIndex = path.join(external, "index.js");
      const indexPath = path.join(root, "dist", "index.js");
      await fs.writeFile(externalIndex, "export const externalIndex = true;\n");
      await fs.mkdir(path.dirname(indexPath), { recursive: true });
      await fs.symlink(externalIndex, indexPath, "file");

      const result = runBuild(root);

      assert.notEqual(result.status, 0, "source-less skip must reject a symlinked index entry");
      assert.equal((await fs.lstat(indexPath)).isSymbolicLink(), true);
      assert.equal(await fs.readFile(externalIndex, "utf8"), "export const externalIndex = true;\n");
    } finally {
      await fs.rm(external, { recursive: true, force: true });
    }
  }, { source: false, compiler: false });

  await withIsolatedBuildProject(async (root) => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-packed-nested-canary-"));
    try {
      const packedIndex = path.join(root, "dist", "index.js");
      const nestedLink = path.join(root, "dist", "nested-link");
      const externalCanary = path.join(external, "user-file.txt");
      const packedBytes = "export const packedNestedCanary = true;\n";
      await fs.mkdir(path.dirname(packedIndex), { recursive: true });
      await fs.writeFile(packedIndex, packedBytes);
      await fs.writeFile(externalCanary, "preserve nested packed target\n");
      await fs.symlink(external, nestedLink, process.platform === "win32" ? "junction" : "dir");

      const result = runBuild(root);

      assert.notEqual(result.status, 0, "source-less skip must reject nested dist symlinks");
      assert.match(result.stderr, /build failed:.*dist contains a symbolic link/i);
      assert.equal((await fs.lstat(nestedLink)).isSymbolicLink(), true);
      assert.equal(await fs.readFile(externalCanary, "utf8"), "preserve nested packed target\n");
      assert.equal(await fs.readFile(packedIndex, "utf8"), packedBytes);
    } finally {
      await fs.rm(external, { recursive: true, force: true });
    }
  }, { source: false, compiler: false });

  await withIsolatedBuildProject(async (root) => {
    const packedIndex = path.join(root, "dist", "index.js");
    const danglingLink = path.join(root, "dist", "dangling-link");
    const missingTarget = path.join(root, "missing-packed-target");
    const packedBytes = "export const packedDanglingCanary = true;\n";
    await fs.mkdir(path.dirname(packedIndex), { recursive: true });
    await fs.writeFile(packedIndex, packedBytes);
    await fs.symlink(missingTarget, danglingLink, process.platform === "win32" ? "junction" : "dir");

    const result = runBuild(root);

    assert.notEqual(result.status, 0, "source-less skip must reject dangling nested dist symlinks");
    assert.match(result.stderr, /build failed:.*dist contains a symbolic link/i);
    assert.equal((await fs.lstat(danglingLink)).isSymbolicLink(), true);
    assert.equal(await fs.readlink(danglingLink), missingTarget);
    await assert.rejects(fs.access(missingTarget), { code: "ENOENT" });
    assert.equal(await fs.readFile(packedIndex, "utf8"), packedBytes);
  }, { source: false, compiler: false });
});
