#!/usr/bin/env node
// The repository README is the GitHub page; the npm package page is README-npm*.md.
// `apply` swaps the npm pages in before packing, `restore` puts the GitHub pages back
// byte-identical, and `check` validates the npm pages.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BACKUP_DIR = ".readme-npm-backup";
export const PAIRS = [
  { npm: "README-npm.md", target: "README.md", guide: "https://github.com/wjgoarxiv/litopencode#readme" },
  { npm: "README-npm-Ko-KR.md", target: "README-Ko-KR.md", guide: "https://github.com/wjgoarxiv/litopencode/blob/master/README-Ko-KR.md" }
];
// An npm page stays a short card: at most half of its GitHub page and 32 KiB.
export const MAX_NPM_README_BYTES = 32 * 1024;
export const MAX_NPM_TO_GITHUB_RATIO = 0.5;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

class SwapError extends Error {}

function linkTargets(text) {
  return [
    ...[...text.matchAll(/\]\(([^)\s]+)\)/gu)].map((match) => match[1]),
    ...[...text.matchAll(/\b(?:href|src|srcset)="([^"]+)"/gu)].map((match) => match[1].split(/[\s,]/u)[0])
  ];
}

export function checkNpmReadme(text, { version, guide, githubText }) {
  const problems = [];
  const pinPrefix = "https://cdn.jsdelivr.net/npm/@litfamily/litopencode@";
  const pins = [...text.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/@litfamily\/litopencode@([^/\s)"]+)\//gu)];
  if (pins.length === 0) problems.push("no jsDelivr asset pinned to the package");
  for (const [, pinned] of pins) {
    if (pinned !== version) problems.push(`jsDelivr pin ${pinned} does not match package version ${version}`);
  }
  for (const target of linkTargets(text)) {
    if (target.startsWith("#") || target.startsWith("https://")) continue;
    problems.push(`relative or non-https target ${target}`);
  }
  if (!text.includes(`](${guide})`)) problems.push(`missing the GitHub full-guide link ${guide}`);
  if (text.includes(`${pinPrefix}${version}/docs/release-checklist.md`)) problems.push("links the repository-only release checklist");
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_NPM_README_BYTES) problems.push(`${bytes} bytes exceeds the ${MAX_NPM_README_BYTES}-byte cap`);
  if (githubText !== undefined && bytes > Buffer.byteLength(githubText) * MAX_NPM_TO_GITHUB_RATIO) {
    problems.push(`${bytes} bytes is more than half of the GitHub page`);
  }
  return problems;
}

function readVersion(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
}

function backupState(root) {
  const manifestPath = path.join(root, BACKUP_DIR, "manifest.json");
  if (!fs.existsSync(path.join(root, BACKUP_DIR))) return undefined;
  if (!fs.existsSync(manifestPath)) throw new SwapError(`${BACKUP_DIR} exists without manifest.json; inspect it before continuing`);
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function check(root = ROOT) {
  const version = readVersion(root);
  const state = backupState(root);
  const problems = [];
  for (const pair of PAIRS) {
    const text = fs.readFileSync(path.join(root, pair.npm), "utf8");
    const githubPath = state ? path.join(root, BACKUP_DIR, pair.target) : path.join(root, pair.target);
    const githubText = fs.readFileSync(githubPath, "utf8");
    for (const problem of checkNpmReadme(text, { version, guide: pair.guide, githubText })) problems.push(`${pair.npm}: ${problem}`);
  }
  return problems;
}

export function apply(root = ROOT) {
  const problems = check(root);
  if (problems.length > 0) throw new SwapError(`npm README check failed:\n${problems.join("\n")}`);
  const state = backupState(root);
  if (state) {
    const applied = PAIRS.every((pair) =>
      fs.readFileSync(path.join(root, pair.target)).equals(fs.readFileSync(path.join(root, pair.npm))));
    if (!applied) throw new SwapError(`${BACKUP_DIR} exists but the npm pages are not in place; run restore first`);
    return "already applied";
  }
  const backup = path.join(root, BACKUP_DIR);
  fs.mkdirSync(backup);
  const files = {};
  for (const pair of PAIRS) {
    const original = fs.readFileSync(path.join(root, pair.target));
    fs.writeFileSync(path.join(backup, pair.target), original);
    files[pair.target] = sha256(original);
  }
  fs.writeFileSync(path.join(backup, "manifest.json"), `${JSON.stringify({ files }, null, 2)}\n`);
  for (const pair of PAIRS) fs.copyFileSync(path.join(root, pair.npm), path.join(root, pair.target));
  return "applied";
}

export function restore(root = ROOT) {
  const state = backupState(root);
  if (!state) return "nothing to restore";
  const backup = path.join(root, BACKUP_DIR);
  for (const pair of PAIRS) {
    const saved = fs.readFileSync(path.join(backup, pair.target));
    if (sha256(saved) !== state.files[pair.target]) throw new SwapError(`${BACKUP_DIR}/${pair.target} does not match its recorded hash`);
  }
  for (const pair of PAIRS) fs.copyFileSync(path.join(backup, pair.target), path.join(root, pair.target));
  fs.rmSync(backup, { recursive: true });
  return "restored";
}

function main(argv) {
  const [command] = argv;
  try {
    // Status goes to stderr: npm mixes lifecycle stdout into `npm pack --json` output.
    if (command === "apply") console.error(`readme-for-npm: ${apply()}`);
    else if (command === "restore") console.error(`readme-for-npm: ${restore()}`);
    else if (command === "check") {
      const problems = check();
      if (problems.length > 0) {
        for (const problem of problems) console.error(`readme-for-npm: ${problem}`);
        return 1;
      }
      console.error("readme-for-npm: npm README pages pass");
    } else {
      console.error("usage: node tools/readme-for-npm.mjs apply|restore|check");
      return 2;
    }
    return 0;
  } catch (error) {
    console.error(`readme-for-npm: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// Compare real paths so a run through a symlinked directory (macOS /var -> /private/var) still executes.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
