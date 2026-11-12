#!/usr/bin/env node
// Adds the SHA-256 of every file this build installs into a skills root to skills/shipped-skill-files.json.
// The installer reads that list to tell its own files from the ones a user added or edited inside a skill folder
// it is about to replace; the user's are copied out first. Hashes are only ever added, so a later version still
// recognises what earlier ones wrote.
//
//   node tools/gen-shipped-skill-files.mjs                       add the current build (needs dist/, run npm run build)
//   node tools/gen-shipped-skill-files.mjs --add-tree <skills>   also add every file under an installed skills root

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIST_PATH = path.join(REPO_ROOT, "skills", "shipped-skill-files.json");
const NOTE =
  "SHA-256 of every file a LitOpenCode release installed into a skill folder. Written by npm run gen:shipped-skill-files; " +
  "entries are only ever added. The installer copies any other file in a folder it replaces to .litopencode-skill-backups.";

function walk(base, rel = "") {
  const out = [];
  for (const entry of readdirSync(path.join(base, rel), { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(base, next));
    else if (entry.isFile()) out.push(next);
  }
  return out;
}

function treeHashes(skillsRoot) {
  return walk(skillsRoot).map((file) => createHash("sha256").update(readFileSync(path.join(skillsRoot, file))).digest("hex"));
}

function currentBuildHashes() {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "litopencode-shipped-"));
  try {
    const root = path.join(scratch, "config");
    const env = { ...process.env, HOME: scratch, XDG_CONFIG_HOME: path.join(scratch, "xdg"), XDG_CACHE_HOME: path.join(scratch, "cache") };
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "bin", "litopencode.cjs"), "install", "--root", root, "--no-agent-file"], {
      cwd: scratch, env, encoding: "utf8"
    });
    if (result.status !== 0) throw new Error(`install into a scratch root failed:\n${result.stderr}`);
    return treeHashes(path.join(root, "skills"));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const extraTrees = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--add-tree" && args[index + 1] !== undefined) extraTrees.push(path.resolve(args[++index]));
  else throw new Error(`Unknown argument: ${args[index]}`);
}

let existing = [];
try {
  existing = JSON.parse(readFileSync(LIST_PATH, "utf8")).sha256;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const hashes = new Set(existing);
const before = hashes.size;
for (const hash of currentBuildHashes()) hashes.add(hash);
for (const tree of extraTrees) for (const hash of treeHashes(tree)) hashes.add(hash);
writeFileSync(LIST_PATH, `${JSON.stringify({ schemaVersion: 1, note: NOTE, sha256: [...hashes].sort() }, null, 1)}\n`);
console.log(`shipped-skill-files: ${hashes.size} hashes (${hashes.size - before} added)`);
