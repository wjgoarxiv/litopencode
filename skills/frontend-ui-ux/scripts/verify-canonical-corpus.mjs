#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readStableRegularFile } from "./stable-file-read.mjs";

const EXPECTED = Object.freeze({
  commit: "8ec16c5129df7b9778959e8367657d0e79c2c3bb",
  tree: "9188410be0af35f2421ba300d91a0d7a7341caf0",
  roots: Object.freeze(["design", "designpowers", "perfection", "ui-ux-db"]),
  count: 167,
  bytes: 2_596_349,
  digest: "f6959eeae02685102df9fbedafb2c437be4d51df8e102f9fcf32298f7674e7d7",
  legal: Object.freeze([
    Object.freeze({ path: "_canonical-corpus/LICENSE", sha256: "b083425948376611de9b92b0aeb7377e604505756ea427e541a34d9b030d4dc1" }),
    Object.freeze({ path: "_canonical-corpus/ATTRIBUTION.md", sha256: "a73cd147a533442218a9adef53d99e0eaf15c10d8db4819d9d1542727f077b92" }),
    Object.freeze({ path: "_canonical-corpus/LICENSE-Apache-2.0.txt", sha256: "9d95806a26532623360eb84bb17d298f394b55ef73fb4c0796d99b4319b2b0da" })
  ])
});
const MANIFEST_FIELDS = ["schemaVersion", "source", "roots", "count", "bytes", "digest", "legal", "files"];
const STRUCTURAL_DIRECTORIES = Object.freeze(["_canonical-corpus", ...EXPECTED.roots]);
const MAX_CANONICAL_FILE_BYTES = 8 * 1024 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== fields.length || fields.some((field, index) => actual[index] !== field)) {
    throw new Error(`${label} has an unexpected field schema`);
  }
}

function safeRelative(value, label) {
  if (typeof value !== "string" || value === "" || value.includes("\\") || path.posix.isAbsolute(value)) {
    throw new Error(`${label} must be a canonical POSIX relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} escapes the canonical root`);
  }
  return value;
}

async function snapshotDirectory(absolute, label) {
  let stat;
  try {
    stat = await fs.lstat(absolute, { bigint: true });
  } catch (error) {
    throw new Error(`cannot inspect ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} is a symbolic link`);
  if (!stat.isDirectory()) throw new Error(`${label} is a special file, not a directory`);
  return Object.freeze({ dev: stat.dev, ino: stat.ino, ctimeNs: stat.ctimeNs, mtimeNs: stat.mtimeNs });
}

async function assertDirectoryIdentity(absolute, label, expected) {
  const actual = await snapshotDirectory(absolute, label);
  if (
    actual.dev !== expected.dev
    || actual.ino !== expected.ino
    || actual.ctimeNs !== expected.ctimeNs
    || actual.mtimeNs !== expected.mtimeNs
  ) {
    throw new Error(`${label} identity changed during verification`);
  }
}

async function inventoryDirectory(referencesRoot, relativeRoot) {
  const files = [];
  const directories = [];
  const unsafe = [];
  async function walk(relative) {
    const absolute = path.join(referencesRoot, ...relative.split("/"));
    let entries;
    try {
      entries = await fs.readdir(absolute, { withFileTypes: true });
    } catch (error) {
      throw new Error(`cannot read canonical directory ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const entry of entries) {
      const next = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) unsafe.push(`${next} :: symbolic link`);
      else if (entry.isDirectory()) {
        directories.push(next);
        await walk(next);
      } else if (entry.isFile()) files.push(next);
      else unsafe.push(`${next} :: special file`);
    }
  }
  await walk(relativeRoot);
  return { files, directories, unsafe };
}

async function readRegularFile(referencesRoot, relative, options = {}) {
  try {
    return await readStableRegularFile(referencesRoot, relative, {
      maxBytes: MAX_CANONICAL_FILE_BYTES,
      expectedSize: options.expectedSize,
      expectedSha256: options.expectedSha256,
      afterRead: options.afterRead
    });
  } catch (error) {
    throw new Error(`cannot read canonical file ${relative}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateManifestShape(manifest) {
  exactFields(manifest, MANIFEST_FIELDS, "canonical manifest");
  if (manifest.schemaVersion !== 1) throw new Error("canonical manifest schemaVersion must be 1");
  exactFields(manifest.source, ["commit", "tree"], "canonical manifest source");
  if (manifest.source.commit !== EXPECTED.commit || manifest.source.tree !== EXPECTED.tree) {
    throw new Error("canonical manifest source metadata mismatch");
  }
  if (JSON.stringify(manifest.roots) !== JSON.stringify(EXPECTED.roots)) throw new Error("canonical manifest roots mismatch");
  if (manifest.count !== EXPECTED.count || manifest.bytes !== EXPECTED.bytes || manifest.digest !== EXPECTED.digest) {
    throw new Error("canonical manifest aggregate metadata mismatch");
  }
  if (JSON.stringify(manifest.legal) !== JSON.stringify(EXPECTED.legal)) throw new Error("canonical manifest legal metadata mismatch");
  if (!Array.isArray(manifest.files) || manifest.files.length !== EXPECTED.count) {
    throw new Error("canonical manifest file count mismatch");
  }
  let previous = "";
  for (const [index, entry] of manifest.files.entries()) {
    exactFields(entry, ["path", "size", "sha256"], `canonical manifest files[${index}]`);
    safeRelative(entry.path, `canonical manifest files[${index}].path`);
    if (!EXPECTED.roots.some((root) => entry.path.startsWith(`${root}/`))) throw new Error(`canonical manifest path has an unknown root: ${entry.path}`);
    if (entry.path <= previous) throw new Error("canonical manifest paths must be unique and sorted");
    previous = entry.path;
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error(`canonical manifest size is invalid: ${entry.path}`);
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error(`canonical manifest SHA-256 is invalid: ${entry.path}`);
  }
}

export async function verifyCanonicalFrontendCorpus(referencesRoot, options = {}) {
  const root = path.resolve(referencesRoot);
  const capturedFiles = new Map();
  const capture = async (relative, expected = {}) => {
    const result = await readRegularFile(root, relative, {
      ...expected,
      afterRead: options.afterFileRead
    });
    capturedFiles.set(relative, Object.freeze({ bytes: result.bytes, snapshot: result.snapshot }));
    return result.bytes;
  };
  const directorySnapshots = new Map();
  directorySnapshots.set("", await snapshotDirectory(root, "references root"));
  for (const relative of STRUCTURAL_DIRECTORIES) {
    directorySnapshots.set(relative, await snapshotDirectory(path.join(root, relative), `canonical directory ${relative}`));
  }
  const manifestRelative = "_canonical-corpus/manifest.json";
  const manifestBytes = await capture(manifestRelative);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("canonical manifest is not valid JSON");
  }
  validateManifestShape(manifest);

  const legalInventory = await inventoryDirectory(root, "_canonical-corpus");
  if (legalInventory.unsafe.length > 0) throw new Error(`canonical legal directory contains ${legalInventory.unsafe.join(", ")}`);
  const expectedLegalFiles = [manifestRelative, ...EXPECTED.legal.map((entry) => entry.path)].sort();
  const actualLegalFiles = [...legalInventory.files].sort();
  if (JSON.stringify(actualLegalFiles) !== JSON.stringify(expectedLegalFiles)) throw new Error("canonical legal directory has an altered file set");

  const inventory = (await Promise.all(EXPECTED.roots.map((name) => inventoryDirectory(root, name))));
  const unsafe = inventory.flatMap((entry) => entry.unsafe);
  if (unsafe.length > 0) throw new Error(`canonical corpus contains ${unsafe.join(", ")}`);
  const actualPaths = inventory.flatMap((entry) => entry.files).sort();
  const expectedPaths = manifest.files.map((entry) => entry.path);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error("canonical corpus has an altered file set (missing or extra path)");

  let bytes = 0;
  const digestLines = [];
  for (const entry of manifest.files) {
    const value = await capture(entry.path, { expectedSize: entry.size, expectedSha256: entry.sha256 });
    const actualHash = sha256(value);
    if (value.byteLength !== entry.size || actualHash !== entry.sha256) throw new Error(`canonical corpus SHA-256 or size changed: ${entry.path}`);
    bytes += value.byteLength;
    digestLines.push(`${actualHash}  ${entry.path}\n`);
  }
  const digest = sha256(digestLines.join(""));
  if (bytes !== EXPECTED.bytes || digest !== EXPECTED.digest) throw new Error("canonical corpus aggregate digest mismatch");

  for (const entry of EXPECTED.legal) {
    const value = await capture(entry.path, { expectedSha256: entry.sha256 });
    if (sha256(value) !== entry.sha256) throw new Error(`canonical legal SHA-256 mismatch: ${entry.path}`);
  }


  for (const [relative, snapshot] of directorySnapshots) {
    const absolute = relative === "" ? root : path.join(root, relative);
    const label = relative === "" ? "references root" : `canonical directory ${relative}`;
    await assertDirectoryIdentity(absolute, label, snapshot);
  }

  const report = {
    ok: true,
    commit: EXPECTED.commit,
    tree: EXPECTED.tree,
    count: EXPECTED.count,
    bytes,
    digest,
    protectedPaths: [...expectedPaths, manifestRelative, ...EXPECTED.legal.map((entry) => entry.path)].sort()
  };
  Object.defineProperty(report, "capturedFiles", {
    value: capturedFiles,
    enumerable: false,
    writable: false
  });
  return report;
}

function parseCliArgs(argv) {
  let root;
  let rootSeen = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      if (rootSeen) throw new Error("duplicate option: --root");
      rootSeen = true;
      const value = argv[index + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        throw new Error("--root requires one path value");
      }
      root = path.resolve(value);
      index += 1;
    } else if (argument === "--json") {
      if (json) throw new Error("duplicate option: --json");
      json = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown option: ${argument}`);
    } else {
      throw new Error(`unexpected positional argument: ${argument}`);
    }
  }
  return {
    root: root ?? path.resolve(fileURLToPath(new URL("../references/", import.meta.url))),
    json
  };
}

async function main() {
  const wantsJson = process.argv.slice(2).includes("--json");
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const report = await verifyCanonicalFrontendCorpus(options.root);
    if (options.json) console.log(JSON.stringify(report));
    else console.log(`canonical frontend corpus verified: ${report.count} files, ${report.bytes} bytes, ${report.digest}`);
  } catch (error) {
    const report = { ok: false, error: error instanceof Error ? error.message : String(error) };
    if (wantsJson) console.log(JSON.stringify(report));
    else console.error(`canonical frontend corpus verification failed: ${report.error}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))
) await main();
