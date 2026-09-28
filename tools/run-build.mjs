#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectRoot = fs.realpathSync(process.cwd());
const tscBin = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");
const sourceRoot = path.join(projectRoot, "src");
const sourceEntry = path.join(projectRoot, "src", "index.ts");
const builtEntry = path.join(projectRoot, "dist", "index.js");

function lstatNoFollow(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function assertNoSymlinks(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) throw new Error(`dist contains a symbolic link: ${entryPath}`);
    if (stat.isDirectory()) assertNoSymlinks(entryPath);
  }
}

function generatedDistPath() {
  if (projectRoot === path.parse(projectRoot).root) throw new Error("project root cannot be the filesystem root");
  const distPath = path.resolve(projectRoot, "dist");
  if (path.dirname(distPath) !== projectRoot || path.basename(distPath) !== "dist") {
    throw new Error(`unsafe dist path: ${distPath}`);
  }
  const stat = lstatNoFollow(distPath);
  if (stat === undefined) return distPath;
  if (stat.isSymbolicLink()) throw new Error(`dist is a symbolic link: ${distPath}`);
  if (!stat.isDirectory()) throw new Error(`dist is not a directory: ${distPath}`);
  assertNoSymlinks(distPath);
  return distPath;
}

const sourceRootStat = lstatNoFollow(sourceRoot);
if (sourceRootStat === undefined) {
  try {
    const distPath = path.resolve(projectRoot, "dist");
    const distStat = lstatNoFollow(distPath);
    if (distStat === undefined) throw new Error("dist is missing");
    if (distStat.isSymbolicLink()) throw new Error(`dist is a symbolic link: ${distPath}`);
    if (!distStat.isDirectory()) throw new Error(`dist is not a directory: ${distPath}`);
    assertNoSymlinks(distPath);
    const builtStat = lstatNoFollow(builtEntry);
    if (builtStat === undefined) throw new Error(`packed entry is missing: ${builtEntry}`);
    if (builtStat.isSymbolicLink()) throw new Error(`packed entry is a symbolic link: ${builtEntry}`);
    if (!builtStat.isFile()) throw new Error(`packed entry is not a regular file: ${builtEntry}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`build failed: source files are missing and packed dist is unsafe: ${message}`);
    process.exit(1);
  }
  console.log("build skipped: source files are not present in this packed artifact.");
  process.exit(0);
}
if (sourceRootStat.isSymbolicLink() || !sourceRootStat.isDirectory()) {
  console.error(`build failed: source tree is not a regular non-symlink directory: ${sourceRoot}`);
  process.exit(1);
}

const sourceStat = lstatNoFollow(sourceEntry);
if (sourceStat === undefined) {
  console.error(`build failed: source entry is missing from the existing source tree: ${sourceEntry}`);
  process.exit(1);
}
if (!sourceStat.isFile()) {
  console.error(`build failed: source entry is not a regular non-symlink file: ${sourceEntry}`);
  process.exit(1);
}

const compilerStat = lstatNoFollow(tscBin);
if (compilerStat === undefined || !compilerStat.isFile()) {
  console.error("build failed: TypeScript dev dependency is not installed.");
  process.exit(1);
}

try {
  fs.rmSync(generatedDistPath(), { recursive: true, force: true });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build failed: refusing to replace generated dist: ${message}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.build.json"], {
  cwd: projectRoot,
  encoding: "utf8",
  stdio: "inherit"
});

process.exit(result.status ?? 1);
