#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { readStableRegularFile } from "../skills/frontend-ui-ux/scripts/stable-file-read.mjs";

// Shown by the GitHub pages only; the npm cards never reference them, so they stay out of the package.
const GITHUB_ONLY_README_MEDIA = /^docs\/assets\/readme\/(?:jev-[^/]+\.webp|promo(?:-[^/]+)?\.[^/]+|promo-source(?:\/.*)?)$/u;

const FORBIDDEN_PATH_RULES = [
  { label: "original prompt provenance", pattern: /^INITIAL_PROMPT\.md$/u },
  { label: "handoff state document", pattern: /^HANDOFF\.md$/u },
  { label: "repository automation", pattern: /(^|\/)\.github(\/|$)/u },
  { label: "local asset generator", pattern: /^generate_cover\.py$/u },
  { label: "repository cover PNG", pattern: /^cover\.png$/u },
  { label: "repository cover vector", pattern: /^docs\/assets\/cover\.svg$/u },
  { label: "GitHub-only README media (Jev snapshots, promo film)", pattern: GITHUB_ONLY_README_MEDIA },
  { label: "unapproved README presentation asset", pattern: /^docs\/assets\/readme\/(?!(?:ascii-readme|badge-version|badge-license|lucide-book-open|lucide-play|lucide-shield-check)\.svg$|litopencode-wordmark\.svg$|litopencode-clay-icon\.png$|(?:litfamily-machines|poster)\.png$|ignition-film\.mp4$|ignition-readme\.gif$|(?:Lucide-LICENSE|JetBrainsMono-OFL)\.txt$)/u },
  { label: "maintainer release checklist", pattern: /^docs\/release-checklist\.md$/u },
  { label: "npm README source (packed as README.md / README-Ko-KR.md)", pattern: /^README-npm(?:-Ko-KR)?\.md$/u },
  { label: "GitHub README backup from the npm README swap", pattern: /^\.readme-npm-backup(?:\/|$)/u },
  { label: "npm README swap script", pattern: /^tools\/readme-for-npm\.mjs$/u },
  { label: "internal recon/spec document", pattern: /^docs\/(?:recon|spec)(\/|$)/u },
  { label: "implementation plan", pattern: /(^|\/)plans(\/|$)/u },
  { label: ".litcodex runtime state", pattern: /(^|\/)\.litcodex(\/|$)/u },
  { label: ".litopencode runtime state", pattern: /(^|\/)\.litopencode(\/|$)/u },
  { label: "hidden Lit-family runtime state", pattern: /(^|\/)\.lit[^/]*(\/|$)/u },
  { label: "Hermes runtime state", pattern: /(^|\/)\.hermes(\/|$)/u },
  { label: "other harness runtime state", pattern: /(^|\/)\.[o]mo(\/|$)/u },
  { label: "evidence artifact", pattern: /(^|\/)evidence(\/|$)/u },
  { label: "test file", pattern: /(^|\/)tests?(\/|$)/u },
  { label: "diagram AB or evidence artifact", pattern: /^skills\/lit-diagram-drawer\/(?:ab|evidence|\.work)(?:\/|$)/u },
  { label: "diagram naive foil", pattern: /^skills\/lit-diagram-drawer\/examples\/[^/]+\/constructed-naive-foil\.html$/u },
  { label: "diagram preview raster", pattern: /^skills\/lit-diagram-drawer\/.*\.(?:png|jpe?g|webp)$/iu },
  { label: "diagram Office proof script", pattern: /^skills\/lit-diagram-drawer\/scripts\/office-proof\.py$/u },
  { label: "diagram source archive path", pattern: /^skills\/lit-diagram-drawer\/(?:plans|_refs)(?:\/|$)/u },
  { label: "reference archive", pattern: /(^|\/)# REFERENCE(\/|$)/u },
  { label: "package archive", pattern: /\.tgz$/u },
  { label: "dependency directory", pattern: /(^|\/)node_modules(\/|$)/u },
  { label: "git directory", pattern: /(^|\/)\.git(\/|$)/u },
  { label: "Python bytecode", pattern: /(?:^|\/)(?:__pycache__(?:\/|$)|[^/]+\.pyc$)/u },
  { label: "local scanner allowlist", pattern: /^tools\/legacy-token-allowlist\.json$/u }
];

const MANAGED_MANIFEST_PATH = "skills/managed-skill-manifest.json";
const MAX_MANAGED_FILE_BYTES = 16 * 1024 * 1024;
const REQUIRED_README_PATHS = [
  "README.md",
  "README-Ko-KR.md",
  "LICENSE",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "docs/lit-mark.md",
  "docs/migration.md",
  "docs/privacy.md",
  "docs/reference-Ko-KR.md",
  "docs/reference.md",
  "docs/assets/cover.webp",
  "docs/assets/cover-motion.webp",
  "docs/assets/cover-motion-still.webp",
  "docs/assets/readme/ascii-readme.svg",
  "docs/assets/readme/badge-license.svg",
  "docs/assets/readme/badge-version.svg",
  "docs/assets/readme/JetBrainsMono-OFL.txt",
  "docs/assets/readme/Lucide-LICENSE.txt",
  "docs/assets/readme/ignition-film.mp4",
  "docs/assets/readme/ignition-readme.gif",
  "docs/assets/readme/litfamily-machines.png",
  "docs/assets/readme/litopencode-clay-icon.png",
  "docs/assets/readme/litopencode-wordmark.svg",
  "docs/assets/readme/lucide-book-open.svg",
  "docs/assets/readme/lucide-play.svg",
  "docs/assets/readme/lucide-shield-check.svg",
  "docs/assets/readme/poster.png"
];

// Every image the READMEs show must ship, except the GitHub-only media above: the npm pages load
// pinned package-CDN copies, and the GitHub pages load the same files by relative path. Inside a
// packed artifact the npm sources are absent and README.md / README-Ko-KR.md already hold the npm pages.
async function readmeImagePaths() {
  const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
  const prefix = `https://cdn.jsdelivr.net/npm/@litfamily/litopencode@${version}/`;
  const paths = new Set();
  const sources = [];
  for (const [npmSource, target] of [["README-npm.md", "README.md"], ["README-npm-Ko-KR.md", "README-Ko-KR.md"]]) {
    sources.push(target);
    try {
      await fs.access(npmSource);
      sources.push(npmSource);
    } catch {
      // Packed artifact: the target already is the npm page.
    }
  }
  for (const file of sources) {
    const text = await fs.readFile(file, "utf8");
    const targets = [
      ...[...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/gu)].map((match) => match[1]),
      ...[...text.matchAll(/\b(?:src|srcset)="([^"\s]+)"/gu)].map((match) => match[1])
    ];
    for (const target of targets) {
      if (target.startsWith(prefix)) paths.add(target.slice(prefix.length));
      else if (target.startsWith("./")) paths.add(target.slice(2));
    }
  }
  return [...paths].filter((imagePath) => !GITHUB_ONLY_README_MEDIA.test(imagePath));
}

async function readManagedManifest() {
  const raw = (await readStableRegularFile(process.cwd(), MANAGED_MANIFEST_PATH, {
    maxBytes: 2 * 1024 * 1024
  })).bytes.toString("utf8");
  const manifest = requireObject(JSON.parse(raw), "managed-skill manifest");
  if (manifest.schemaVersion !== 1) throw new PackPayloadError("unsupported managed-skill manifest schema", 2);
  const skills = requireObject(manifest.skills, "managed-skill manifest skills");
  if (manifest.vendorFiles !== undefined && !Array.isArray(manifest.vendorFiles)) {
    throw new PackPayloadError("managed-skill manifest vendorFiles must be an array", 2);
  }
  return { skills, vendorFiles: manifest.vendorFiles ?? [] };
}

function canonicalPackagePath(id, definition, relativePath) {
  if (definition.canonicalRoot === undefined) return `skills/${id}/${relativePath}`;
  if (typeof definition.canonicalRoot !== "string") {
    throw new PackPayloadError(`managed-skill manifest ${id} canonicalRoot must be a string`, 2);
  }
  const mapped = path.posix.normalize(path.posix.join("skills", id, definition.canonicalRoot, relativePath));
  if (!mapped.startsWith("vendor/")) {
    throw new PackPayloadError(`managed-skill manifest ${id} canonicalRoot must resolve below vendor/`, 2);
  }
  return mapped;
}

function requiredManagedPaths({ skills, vendorFiles }) {
  const required = [...REQUIRED_README_PATHS, MANAGED_MANIFEST_PATH, "skills/skill-rename-aliases.json"];
  for (const rawAsset of vendorFiles) {
    const asset = requireObject(rawAsset, "managed-skill manifest vendor asset");
    if (typeof asset.path !== "string" || typeof asset.sha256 !== "string") {
      throw new PackPayloadError("managed-skill manifest has a malformed vendor asset", 2);
    }
    required.push(`vendor/${asset.path}`);
  }
  for (const [id, rawDefinition] of Object.entries(skills)) {
    const definition = requireObject(rawDefinition, `managed-skill manifest ${id}`);
    if (!Array.isArray(definition.distributionFiles) || !Array.isArray(definition.canonicalFiles)) {
      throw new PackPayloadError(`managed-skill manifest ${id} has malformed file lists`, 2);
    }
    for (const relativePath of definition.distributionFiles) required.push(`skills/${id}/${relativePath}`);
    for (const rawAsset of definition.canonicalFiles) {
      const asset = requireObject(rawAsset, `managed-skill manifest ${id} canonical asset`);
      if (typeof asset.path !== "string" || typeof asset.sha256 !== "string") {
        throw new PackPayloadError(`managed-skill manifest ${id} has a malformed canonical asset`, 2);
      }
      required.push(canonicalPackagePath(id, definition, asset.path));
    }
  }
  return required;
}

function allowedCanonicalTestPaths(skills) {
  const allowed = new Set();
  for (const [id, rawDefinition] of Object.entries(skills)) {
    const definition = requireObject(rawDefinition, `managed-skill manifest ${id}`);
    for (const rawAsset of definition.canonicalFiles) {
      const asset = requireObject(rawAsset, `managed-skill manifest ${id} canonical asset`);
      if (typeof asset.path === "string") {
        const mapped = canonicalPackagePath(id, definition, asset.path);
        if (mapped.startsWith("vendor/scientific-visualization/tests/")) allowed.add(mapped);
      }
    }
  }
  return allowed;
}

class PackPayloadError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "PackPayloadError";
    this.exitCode = exitCode;
  }
}

function parseArgs(argv) {
  const options = {
    mode: "stdin",
    filePath: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--stdin") {
      options.mode = "stdin";
    } else if (arg === "--file" && next !== undefined) {
      options.mode = "file";
      options.filePath = next;
      index += 1;
    } else {
      throw new PackPayloadError(`unknown or incomplete argument: ${arg}`, 2);
    }
  }

  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readManifestText(options) {
  if (options.mode === "file") {
    return fs.readFile(path.resolve(options.filePath), "utf8");
  }
  return readStdin();
}

function parseManifest(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PackPayloadError(`cannot read or parse manifest: ${detail}`, 2);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PackPayloadError(`${label} must be a JSON object`, 2);
  }
  return value;
}

function normalizeManifestPath(value) {
  return value.split(path.sep).join("/");
}

function readManifestFiles(parsed) {
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new PackPayloadError("manifest must be the one-package array emitted by npm pack --dry-run --json", 2);
  }

  const packageEntry = requireObject(parsed[0], "manifest package");
  const files = packageEntry.files;
  if (!Array.isArray(files)) {
    throw new PackPayloadError("manifest package files must be an array", 2);
  }

  return files.map((entry, index) => {
    const fileEntry = requireObject(entry, `manifest package files[${index}]`);
    if (typeof fileEntry.path !== "string" || fileEntry.path.trim() === "") {
      throw new PackPayloadError(`manifest package files[${index}].path must be a non-empty string`, 2);
    }
    return normalizeManifestPath(fileEntry.path);
  });
}

function findForbiddenPaths(paths, allowedCanonicalTests, requiredManaged) {
  const matches = [];
  const requiredManagedSet = new Set(requiredManaged);
  const managedSkillPrefixes = new Set(
    requiredManaged
      .filter((manifestPath) => manifestPath.startsWith("skills/") && manifestPath !== MANAGED_MANIFEST_PATH)
      .map((manifestPath) => manifestPath.split("/").slice(0, 2).join("/") + "/")
  );
  if (requiredManaged.some((manifestPath) => manifestPath.startsWith("vendor/"))) managedSkillPrefixes.add("vendor/");
  for (const manifestPath of paths) {
    if (allowedCanonicalTests.has(manifestPath)) continue;
    if (
      [...managedSkillPrefixes].some((prefix) => manifestPath.startsWith(prefix)) &&
      !requiredManagedSet.has(manifestPath)
    ) {
      matches.push({ path: manifestPath, reason: "unexpected managed-skill payload" });
      continue;
    }
    const rule = FORBIDDEN_PATH_RULES.find((candidate) => candidate.pattern.test(manifestPath));
    if (rule !== undefined) {
      matches.push({ path: manifestPath, reason: rule.label });
    }
  }
  return matches;
}

function findMissingRequiredPaths(paths, requiredManaged) {
  const present = new Set(paths);
  return requiredManaged.filter((requiredPath) => !present.has(requiredPath));
}

async function inventorySourceTree(root) {
  const files = [];
  const unsafe = [];
  async function walk(directory, prefix = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink()) unsafe.push(relative);
      else if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
      else unsafe.push(relative);
    }
  }
  await walk(root);
  return { files: files.sort(), unsafe: unsafe.sort() };
}

async function findManagedSourceFailures(skills) {
  const failures = [];
  for (const [id, rawDefinition] of Object.entries(skills)) {
    const definition = requireObject(rawDefinition, `managed-skill manifest ${id}`);
    const root = path.resolve("skills", id);
    const expected = [
      ...definition.distributionFiles,
      ...(definition.canonicalRoot === undefined
        ? definition.canonicalFiles.map((asset) => requireObject(asset, `${id} canonical asset`).path)
        : [])
    ];
    const expectedSet = new Set(expected);
    const inventory = await inventorySourceTree(root);
    for (const unsafe of inventory.unsafe) failures.push(`skills/${id}/${unsafe} :: symbolic link or special file`);
    for (const relativePath of expected) {
      if (!inventory.files.includes(relativePath)) failures.push(`skills/${id}/${relativePath} :: missing source file`);
    }
    for (const relativePath of inventory.files) {
      if (!expectedSet.has(relativePath)) failures.push(`skills/${id}/${relativePath} :: unexpected source file`);
    }
    if (definition.canonicalRoot === undefined) {
      for (const rawAsset of definition.canonicalFiles) {
        const asset = requireObject(rawAsset, `${id} canonical asset`);
        try {
          const actual = (await readStableRegularFile(root, asset.path, {
            maxBytes: MAX_MANAGED_FILE_BYTES,
            expectedSha256: asset.sha256
          })).sha256;
          if (actual !== asset.sha256) failures.push(`skills/${id}/${asset.path} :: SHA-256 mismatch`);
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
          failures.push(`skills/${id}/${asset.path} :: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (definition.canonicalRoot !== undefined) {
      const canonicalRoot = path.resolve(root, definition.canonicalRoot);
      const canonicalExpected = definition.canonicalFiles.map((asset) => requireObject(asset, `${id} canonical asset`).path);
      let canonicalInventory;
      try {
        canonicalInventory = await inventorySourceTree(canonicalRoot);
      } catch (error) {
        failures.push(`vendor canonical root for ${id} :: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const unsafe of canonicalInventory.unsafe) failures.push(`vendor/${path.relative(path.resolve("vendor"), path.join(canonicalRoot, unsafe))} :: symbolic link or special file`);
      const expectedSet = new Set(canonicalExpected);
      for (const relativePath of canonicalExpected) {
        if (!canonicalInventory.files.includes(relativePath)) {
          failures.push(`${canonicalPackagePath(id, definition, relativePath)} :: missing source file`);
        }
      }
      for (const relativePath of canonicalInventory.files) {
        if (!expectedSet.has(relativePath)) {
          failures.push(`${canonicalPackagePath(id, definition, relativePath)} :: unexpected source file`);
        }
      }
      for (const rawAsset of definition.canonicalFiles) {
        const asset = requireObject(rawAsset, `${id} canonical asset`);
        try {
          const actual = (await readStableRegularFile(canonicalRoot, asset.path, {
            maxBytes: MAX_MANAGED_FILE_BYTES,
            expectedSha256: asset.sha256
          })).sha256;
          if (actual !== asset.sha256) failures.push(`${canonicalPackagePath(id, definition, asset.path)} :: SHA-256 mismatch`);
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
          failures.push(`${canonicalPackagePath(id, definition, asset.path)} :: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  return failures;
}

async function findManagedVendorFailures(skills, vendorFiles) {
  if (vendorFiles.length === 0 && !Object.values(skills).some((definition) => definition?.canonicalRoot !== undefined)) return [];
  const failures = [];
  const vendorRoot = path.resolve("vendor");
  let inventory;
  try {
    inventory = await inventorySourceTree(vendorRoot);
  } catch (error) {
    return [`vendor :: ${error instanceof Error ? error.message : String(error)}`];
  }
  const expected = new Set(vendorFiles.map((asset) => `vendor/${asset.path}`));
  for (const [id, rawDefinition] of Object.entries(skills)) {
    const definition = requireObject(rawDefinition, `managed-skill manifest ${id}`);
    if (definition.canonicalRoot === undefined) continue;
    for (const rawAsset of definition.canonicalFiles) {
      const asset = requireObject(rawAsset, `${id} canonical asset`);
      expected.add(canonicalPackagePath(id, definition, asset.path));
    }
  }
  for (const relativePath of inventory.unsafe) failures.push(`vendor/${relativePath} :: symbolic link or special file`);
  for (const relativePath of inventory.files) {
    if (!expected.has(`vendor/${relativePath}`)) failures.push(`vendor/${relativePath} :: unexpected source file`);
  }
  for (const rawAsset of vendorFiles) {
    const asset = requireObject(rawAsset, "managed-skill manifest vendor asset");
    try {
      const actual = (await readStableRegularFile(vendorRoot, asset.path, {
        maxBytes: MAX_MANAGED_FILE_BYTES,
        expectedSha256: asset.sha256
      })).sha256;
      if (actual !== asset.sha256) failures.push(`vendor/${asset.path} :: SHA-256 mismatch`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        failures.push(`vendor/${asset.path} :: missing source file`);
      } else failures.push(`vendor/${asset.path} :: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

function printForbiddenPaths(matches) {
  for (const match of matches) {
    console.log(`${match.path} :: ${match.reason}`);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const manifestText = await readManifestText(options);
    const manifest = parseManifest(manifestText);
    const files = readManifestFiles(manifest);
    const managedManifest = await readManagedManifest();
    const requiredManaged = requiredManagedPaths(managedManifest);
    const forbidden = findForbiddenPaths(files, allowedCanonicalTestPaths(managedManifest.skills), requiredManaged);

    if (forbidden.length > 0) {
      const suffix = forbidden.length === 1 ? "path" : "paths";
      console.log(`pack payload guard failed: ${forbidden.length} forbidden ${suffix}`);
      printForbiddenPaths(forbidden);
      process.exitCode = 1;
      return;
    }

    const missing = findMissingRequiredPaths(files, [...new Set([...requiredManaged, ...(await readmeImagePaths())])]);
    if (missing.length > 0) {
      const suffix = missing.length === 1 ? "path" : "paths";
      console.log(`pack payload guard failed: ${missing.length} required ${suffix} missing`);
      for (const missingPath of missing) console.log(missingPath);
      process.exitCode = 1;
      return;
    }

    const sourceFailures = [
      ...(await findManagedSourceFailures(managedManifest.skills)),
      ...(await findManagedVendorFailures(managedManifest.skills, managedManifest.vendorFiles))
    ];
    if (sourceFailures.length > 0) {
      const suffix = sourceFailures.length === 1 ? "failure" : "failures";
      console.log(`pack payload guard failed: ${sourceFailures.length} managed-source ${suffix}`);
      for (const failure of sourceFailures) console.log(failure);
      process.exitCode = 1;
      return;
    }

    const suffix = files.length === 1 ? "file" : "files";
    console.log(`pack payload guard passed: ${files.length} ${suffix} checked`);
  } catch (error) {
    if (error instanceof PackPayloadError) {
      console.error(`pack payload guard error: ${error.message}`);
      process.exitCode = error.exitCode;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`pack payload guard error: ${message}`);
    process.exitCode = 2;
  }
}

await main();
