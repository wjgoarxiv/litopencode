import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Test-only guard data (MO-A-49): the spec's 61-row forbidden table, the two method-only files and
// the excluded Hershey trio. This file lives under test/, which never enters the pack.
const guardFile = "test/motion-forbidden-sha256.txt";
const rows = readFileSync(guardFile, "utf8").trim().split("\n");
const methodOnly = [
  "70da9c14dedbc4bba92906967f0b4e3cab024855ac740d2e89eb3a90ba983acc",
  "ac2f817836a14789b2f17e8e834714600621b316862bc855defd9f24785c5e8a"
];
const hershey = [
  "a7b9cb8f6465a66d7b1b2f774579749edf1f960b0ed929f0908bd97211f479fa",
  "bc0cbdca869d455d000e9961cca0191843cc1c2d7e134a732be2b5081b32eb3b",
  "63e5c88e6fd3a1c2b9a3c90b239c7af3086a15df80373cac80daedbf29b0c04a"
];
const forbidden = new Set([...rows.map((row) => row.split(/\s+/u)[0]), ...methodOnly, ...hershey]);
const sceneIdKeys = ["shoggoth", "paperclips", "leftturn", "ilya"];

const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// Hashing follows symlinks: statSync resolves the link, so a link into a forbidden directory is read.
function scanTree(root, set = forbidden, visited = new Set(), hits = []) {
  const actual = realpathSync(root);
  if (visited.has(actual)) return hits;
  visited.add(actual);
  for (const entry of readdirSync(root)) {
    const file = path.join(root, entry);
    const stat = statSync(file);
    if (stat.isDirectory()) scanTree(file, set, visited, hits);
    else if (stat.isFile() && set.has(digest(file))) hits.push(file);
  }
  return hits;
}

test("the guard table has the spec's 61 rows plus the method-only and Hershey hashes", () => {
  assert.equal(rows.length, 61);
  for (const row of rows) assert.match(row, /^[0-9a-f]{64} {2}\S+$/u);
  assert.equal(forbidden.size, 66);
});

test("tracked and new files contain none of the forbidden blobs", () => {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
  const hits = files.filter((file) => { try { return statSync(file).isFile() && forbidden.has(digest(file)); } catch { return false; } });
  assert.deepEqual(hits, []);
});

test("shipped engine files never carry the method-only timeline's scene-id keys", () => {
  const skillRoot = path.resolve("skills", "lit-typographic-motion");
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  for (const file of walk(skillRoot).filter((name) => /\.(?:mjs|js|json|md|py|txt)$/u.test(name) && path.resolve(name) !== path.resolve(guardFile))) {
    const text = readFileSync(file, "utf8").toLowerCase();
    for (const key of sceneIdKeys) assert.equal(new RegExp(`\\b${key}\\b`, "u").test(text), false, `${path.relative(skillRoot, file)} contains ${key}`);
  }
});

test("hash scanning follows symlinks", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ltm-symlink-hash-"));
  try {
    const hidden = mkdtempSync(path.join(os.tmpdir(), "ltm-hidden-"));
    writeFileSync(path.join(hidden, "blob.bin"), "synthetic forbidden bytes");
    symlinkSync(hidden, path.join(dir, "linked"), "dir");
    const synthetic = new Set([digest(path.join(hidden, "blob.bin"))]);
    assert.equal(scanTree(dir, synthetic).length, 1);
    rmSync(hidden, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the extracted pack tarball contains no forbidden blob", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ltm-pack-hash-"));
  try {
    const pack = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", tmp], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))[0];
    execFileSync("tar", ["-xzf", path.join(tmp, pack.filename), "-C", tmp]);
    assert.deepEqual(scanTree(path.join(tmp, "package")), []);
    assert.equal(pack.files.some((file) => file.path.includes("motion-forbidden")), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

const warmed = process.env.MOTION_TEST_XDG_CACHE_HOME;
test("a pre-warmed motion cache contains no forbidden blob", { skip: warmed ? false : "MOTION_TEST_XDG_CACHE_HOME is not set to a pre-warmed test cache" }, () => {
  assert.deepEqual(scanTree(path.join(warmed, "litopencode", "motion-runtime")), []);
});
