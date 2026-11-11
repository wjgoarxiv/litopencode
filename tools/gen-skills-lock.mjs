#!/usr/bin/env node
// Regenerates skills.lock.json: a measured row per top-level skill (SKILL.md size and SHA-256, file count, total
// bytes, one SHA-256 over every file) and the sorted `npm pack --dry-run --json --ignore-scripts` file list.
//
//   node tools/gen-skills-lock.mjs                       rewrite the measured half (skills, pack)
//   node tools/gen-skills-lock.mjs --check               verify only; exit 1 when stale or out of budget
//   node tools/gen-skills-lock.mjs --accept-new <id>     give a new skill its first budget (repeatable)
//   node tools/gen-skills-lock.mjs --drop <id>           remove the budget of a skill that is gone (repeatable)
//
// `policy` and `budgets` are hand-owned and kept byte for byte by every run. A skill with no budget, a budget with
// no skill, or a skill outside its budget is a violation, and while one stands nothing is written. This is what
// stops a floor from moving quietly: removing a skill, regenerating and adding it back smaller is refused until
// someone names the skill with --drop and then --accept-new. Raise a budget by hand when a skill grows on purpose;
// never lower one to make a run pass.
//
// Only files git tracks are measured, so an untracked .DS_Store or a local render never makes the lock stale. A
// tracked file deleted on disk counts as gone. Outside a git checkout (synthetic test trees) every file on disk
// counts.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_PATH = path.join(REPO_ROOT, "skills.lock.json");
export const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const SCHEMA = "litopencode.skills-lock/v1";
const NOTE =
  "Written by npm run gen:skills-lock (skills, pack). policy and budgets are edited by hand and kept by every run; " +
  "--accept-new <id> and --drop <id> are the only ways a budget appears or disappears.";
const CEILING_FACTOR = 1.5;

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Compare path segment by segment so `a/x` sorts before `a-b/x`, the order a directory walk gives.
const segmentKey = (relativePath) => relativePath.split("/").join("\u0000");
const bySegments = (left, right) => (segmentKey(left) < segmentKey(right) ? -1 : segmentKey(left) > segmentKey(right) ? 1 : 0);

function walkDisk(base, rel = "") {
  const out = [];
  for (const entry of readdirSync(path.join(base, rel), { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkDisk(base, next));
    else out.push(next);
  }
  return out;
}

/** Files below skillsDir, relative to it, that count toward the lock. */
export function trackedSkillFiles(skillsDir) {
  const git = spawnSync("git", ["ls-files", "-z", "--", "."], { cwd: skillsDir, encoding: "utf8" });
  if (git.status !== 0) return walkDisk(skillsDir);
  return git.stdout
    .split("\u0000")
    .filter((relativePath) => relativePath !== "" && existsSync(path.join(skillsDir, relativePath)));
}

/** One measured row per directory that holds a SKILL.md; loose files such as the managed manifest are skipped. */
export function measureSkills(skillsDir, files = trackedSkillFiles(skillsDir)) {
  const grouped = new Map();
  for (const relativePath of [...files].sort(bySegments)) {
    const slash = relativePath.indexOf("/");
    if (slash < 0) continue;
    const id = relativePath.slice(0, slash);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(relativePath.slice(slash + 1));
  }
  const measured = {};
  for (const id of [...grouped.keys()].sort()) {
    const inner = grouped.get(id);
    if (!inner.includes("SKILL.md")) continue;
    let total = 0;
    let ledger = "";
    for (const rel of inner) {
      const bytes = readFileSync(path.join(skillsDir, id, rel));
      total += bytes.length;
      ledger += `${rel}\t${bytes.length}\t${digest(bytes)}\n`;
    }
    const skillMd = readFileSync(path.join(skillsDir, id, "SKILL.md"));
    measured[id] = {
      skillMd: { bytes: skillMd.length, sha256: digest(skillMd) },
      files: inner.length,
      bytes: total,
      sha256: digest(ledger)
    };
  }
  return measured;
}

/** The sorted file list npm would publish; dist/ must already be built. */
export function packedFiles(root = REPO_ROOT) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`npm pack --dry-run failed: ${result.stderr}`);
  return JSON.parse(result.stdout)[0].files.map((entry) => entry.path.split(path.sep).join("/")).sort();
}

const ceiling = (value) => Math.ceil((value * CEILING_FACTOR) / 1000) * 1000;

/** A first budget for a skill named with --accept-new: today's size is the floor, half again is the ceiling. */
export function firstBudget(row) {
  return {
    minSkillBytes: Math.floor(row.skillMd.bytes / 100) * 100,
    maxSkillBytes: ceiling(row.skillMd.bytes),
    minFiles: row.files,
    maxFiles: Math.ceil(row.files * CEILING_FACTOR),
    maxBytes: ceiling(row.bytes)
  };
}

export function budgetViolations(measured, budgets) {
  const problems = [];
  const ids = [...new Set([...Object.keys(measured), ...Object.keys(budgets)])].sort();
  for (const id of ids) {
    const row = measured[id];
    const budget = budgets[id];
    if (budget === undefined) {
      problems.push(`${id}: new skill without a budget (gen:skills-lock -- --accept-new ${id})`);
      continue;
    }
    if (row === undefined) {
      problems.push(`${id}: budget for a missing skill (gen:skills-lock -- --drop ${id})`);
      continue;
    }
    const skillMdBytes = row.skillMd.bytes;
    if (skillMdBytes < budget.minSkillBytes) problems.push(`${id}: SKILL.md ${skillMdBytes} B < budget ${budget.minSkillBytes} B`);
    if (skillMdBytes > budget.maxSkillBytes) problems.push(`${id}: SKILL.md ${skillMdBytes} B > budget ${budget.maxSkillBytes} B`);
    if (row.files < budget.minFiles) problems.push(`${id}: ${row.files} files < budget ${budget.minFiles}`);
    if (row.files > budget.maxFiles) problems.push(`${id}: ${row.files} files > budget ${budget.maxFiles}`);
    if (row.bytes > budget.maxBytes) problems.push(`${id}: ${row.bytes} B in all > budget ${budget.maxBytes} B`);
  }
  return problems;
}

const sortedObject = (record) => Object.fromEntries(Object.entries(record).sort(([left], [right]) => (left < right ? -1 : 1)));

/** Measures the tree and carries policy and budgets over; only --accept-new seeds and only --drop removes. */
export function buildLock({ skillsDir = SKILLS_DIR, pack, previous = {}, acceptNew = [], drop = [] }) {
  const skills = measureSkills(skillsDir);
  const kept = previous.budgets ?? {};
  for (const id of acceptNew) {
    if (skills[id] === undefined || kept[id] !== undefined) throw new Error(`--accept-new ${id}: not a new skill`);
  }
  for (const id of drop) {
    if (skills[id] !== undefined || kept[id] === undefined) throw new Error(`--drop ${id}: not a missing skill`);
  }
  const budgets = {};
  for (const [id, budget] of Object.entries(kept)) if (!drop.includes(id)) budgets[id] = budget;
  for (const id of acceptNew) budgets[id] = firstBudget(skills[id]);
  return {
    schema: SCHEMA,
    note: NOTE,
    policy: previous.policy ?? {},
    budgets: sortedObject(budgets),
    skills,
    pack: [...pack].sort()
  };
}

export const readLock = (lockPath = LOCK_PATH) => JSON.parse(readFileSync(lockPath, "utf8"));
export const serializeLock = (lock) => `${JSON.stringify(lock, null, 2)}\n`;

/** Rows and pack entries that differ between two locks, for a readable stale report. */
export function lockDrift(recorded, fresh) {
  const drift = [];
  for (const id of [...new Set([...Object.keys(recorded.skills ?? {}), ...Object.keys(fresh.skills)])].sort()) {
    if (JSON.stringify(recorded.skills?.[id]) !== JSON.stringify(fresh.skills[id])) drift.push(`  skill     ${id}`);
  }
  const before = new Set(recorded.pack ?? []);
  const after = new Set(fresh.pack);
  for (const file of fresh.pack) if (!before.has(file)) drift.push(`  packed    ${file}`);
  for (const file of before) if (!after.has(file)) drift.push(`  unpacked  ${file}`);
  return drift;
}

function parseArgs(argv) {
  const options = { check: false, noPack: false, lockPath: LOCK_PATH, skillsDir: SKILLS_DIR, acceptNew: [], drop: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--check") options.check = true;
    else if (arg === "--no-pack") options.noPack = true;
    else if (arg === "--lock" && next !== undefined) options.lockPath = path.resolve(argv[++index]);
    else if (arg === "--skills" && next !== undefined) options.skillsDir = path.resolve(argv[++index]);
    else if (arg === "--accept-new" && next !== undefined) options.acceptNew.push(argv[++index]);
    else if (arg === "--drop" && next !== undefined) options.drop.push(argv[++index]);
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.check && (options.acceptNew.length > 0 || options.drop.length > 0)) {
    throw new Error("--check never changes budgets; run without --check to use --accept-new or --drop");
  }
  const previous = existsSync(options.lockPath) ? readLock(options.lockPath) : {};
  const pack = options.noPack ? previous.pack ?? [] : packedFiles();
  const lock = buildLock({ skillsDir: options.skillsDir, pack, previous, acceptNew: options.acceptNew, drop: options.drop });
  const problems = budgetViolations(lock.skills, lock.budgets);
  if (problems.length > 0) {
    console.log(`skills.lock.json not written: ${problems.length} budget violation(s)`);
    for (const problem of problems) console.log(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  const text = serializeLock(lock);
  const current = existsSync(options.lockPath) && readFileSync(options.lockPath, "utf8") === text;
  const summary = `${Object.keys(lock.skills).length} skills, ${lock.pack.length} packed files`;
  if (options.check) {
    if (current) {
      console.log(`skills lock check passed (${summary})`);
      return;
    }
    console.log("skills.lock.json is stale: run npm run gen:skills-lock");
    for (const line of lockDrift(previous, lock)) console.log(line);
    process.exitCode = 1;
    return;
  }
  if (!current) writeFileSync(options.lockPath, text);
  for (const id of options.acceptNew) {
    const budget = lock.budgets[id];
    console.log(
      `seeded budget: ${id} (SKILL.md ${budget.minSkillBytes}-${budget.maxSkillBytes} B, ` +
        `${budget.minFiles}-${budget.maxFiles} files, ${budget.maxBytes} B in all)`
    );
  }
  for (const id of options.drop) console.log(`dropped budget: ${id}`);
  console.log(`skills.lock.json ${current ? "already current" : "updated"} (${summary})`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`skills lock error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
