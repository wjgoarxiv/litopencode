#!/usr/bin/env node
// Regenerates the canonicalFiles SHA-256 sets in skills/managed-skill-manifest.json from disk and
// refuses agent-owned user skills if they intrude into the repository's shipped skill corpus.
//
// Two gates read that manifest as an EXACT file set: tools/check-pack-payload.mjs reports
// "unexpected managed-skill payload" for any file it does not list, and
// src/cli/native-skill-integrity.ts throws "has an altered file set". So adding or editing a managed
// skill asset requires the manifest to move in the same change, and the manifest had no generator.
//
//   node tools/gen-managed-skill-manifest.mjs            rewrite canonicalFiles from disk
//   node tools/gen-managed-skill-manifest.mjs --check     verify only; exit 1 on drift
//
// distributionFiles is a curated install list and is NEVER rewritten here — only read, so the files
// it already covers are excluded from canonicalFiles.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const renamedSkillIds = JSON.parse(readFileSync(new URL("../skills/skill-rename-aliases.json", import.meta.url), "utf8"));

const MANIFEST_PATH = "skills/managed-skill-manifest.json";

function walk(base, rel = "") {
  const out = [];
  for (const entry of readdirSync(path.join(base, rel), { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(base, next));
    else out.push(next);
  }
  return out;
}

function canonicalRoot(skillRoot, definition) {
  if (definition.canonicalRoot !== undefined && typeof definition.canonicalRoot !== "string") {
    throw new Error("managed-skill manifest canonicalRoot must be a string");
  }
  return path.resolve(skillRoot, definition.canonicalRoot ?? ".");
}

function refreshPinnedFiles(root, previous, label, discover = true) {
  const wanted = (discover ? walk(root) : previous.map((asset) => asset.path)).sort();
  const was = new Map(previous.map((asset) => [asset.path, asset.sha256]));
  const next = wanted.map((rel) => ({
    path: rel,
    sha256: createHash("sha256").update(readFileSync(path.join(root, rel))).digest("hex"),
  }));

  for (const asset of next) {
    const prior = was.get(asset.path);
    if (prior === undefined) drift.push(`  unpinned  ${label}/${asset.path}`);
    else if (prior !== asset.sha256) drift.push(`  changed   ${label}/${asset.path}`);
  }
  for (const rel of was.keys()) if (!wanted.includes(rel)) drift.push(`  missing   ${label}/${rel}`);
  return next;
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const drift = [];
if (JSON.stringify(manifest.renamedSkills) !== JSON.stringify(renamedSkillIds)) {
  drift.push("  changed   installer skill rename map");
  manifest.renamedSkills = renamedSkillIds;
}
const intrusions = [];
let pinned = 0;

function hasAgentOwnedMarker(text) {
  if (!text.startsWith("---\n")) return false;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return false;
  return /^\s{2}litopencodeAgentGenerated:\s*["']true["']\s*$/mu.test(text.slice(4, end));
}

for (const entry of readdirSync("skills", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skillPath = path.join("skills", entry.name, "SKILL.md");
  try {
    if (hasAgentOwnedMarker(readFileSync(skillPath, "utf8"))) {
      intrusions.push(`  AGENT_OWNED_REPO_SKILL_FORBIDDEN ${skillPath}`);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

for (const [id, definition] of Object.entries(manifest.skills)) {
  const skillRoot = path.join("skills", id);
  const root = canonicalRoot(skillRoot, definition);
  const distributed = new Set(definition.canonicalRoot === undefined ? definition.distributionFiles : []);
  const wanted = walk(root)
    .filter((rel) => !distributed.has(rel))
    .sort();

  const was = new Map(definition.canonicalFiles.map((asset) => [asset.path, asset.sha256]));
  const next = wanted.map((rel) => ({
    path: rel,
    sha256: createHash("sha256").update(readFileSync(path.join(root, rel))).digest("hex"),
  }));

  for (const asset of next) {
    const previous = was.get(asset.path);
    if (previous === undefined) drift.push(`  unpinned  ${id}/${asset.path}`);
    else if (previous !== asset.sha256) drift.push(`  changed   ${id}/${asset.path}`);
  }
  for (const rel of was.keys()) if (!wanted.includes(rel)) drift.push(`  missing   ${id}/${rel}`);

  definition.canonicalFiles = next;
  pinned += next.length;
}

if (manifest.vendorFiles !== undefined) {
  if (!Array.isArray(manifest.vendorFiles)) throw new Error("managed-skill manifest vendorFiles must be an array");
  manifest.vendorFiles = refreshPinnedFiles("vendor", manifest.vendorFiles, "vendor", false);
  pinned += manifest.vendorFiles.length;
}

if (intrusions.length > 0) {
  console.error(`managed-skill-manifest INTRUSION: ${intrusions.length} path(s)`);
  console.error(intrusions.join("\n"));
  process.exit(1);
}

if (drift.length === 0) {
  console.log(`managed-skill-manifest OK: ${pinned} canonical asset(s)`);
  process.exit(0);
}

if (process.argv.includes("--check")) {
  console.error(`managed-skill-manifest DRIFT: ${drift.length} path(s)`);
  console.error(drift.join("\n"));
  console.error("run: npm run gen:managed-skill-manifest");
  process.exit(1);
}

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`managed-skill-manifest WROTE: ${pinned} canonical asset(s) -> ${MANIFEST_PATH}`);
