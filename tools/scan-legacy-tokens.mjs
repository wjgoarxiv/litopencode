#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { verifyCanonicalFrontendCorpus } from "../skills/frontend-ui-ux/scripts/verify-canonical-corpus.mjs";
import { revalidateStableRegularFile } from "../skills/frontend-ui-ux/scripts/stable-file-read.mjs";

const LEGACY_TOKEN_PARTS = [
  ["om", "o"],
  ["oh-my-open", "agent"],
  ["oh-my-open", "code"],
  ["sisyphus", "labs"],
  ["lazy", "codex"],
  ["lazy", "claude"],
  ["code-yeong", "yu"],
  ["u", "lw"],
  ["ultra", "work"],
  ["ultra", "goal"]
];
const LEGACY_TOKENS = LEGACY_TOKEN_PARTS.map((parts) => parts.join(""));
const TOKEN_PATTERN = new RegExp(
  `(?<![A-Za-z0-9_])(${LEGACY_TOKENS.map(escapeRegex).join("|")})(?![A-Za-z0-9_])`,
  "giu"
);
const SKIPPED_DIRS = new Set([".git", ".litcodex", ".litopencode", "node_modules", "# REFERENCE"]);
const SKIPPED_FILES = new Set(["tools/scan-legacy-tokens.mjs", "tools/legacy-token-allowlist.json"]);
const SKIPPED_EXTENSIONS = [".tgz", ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z"];
const CANONICAL_REFERENCES_PATH = "skills/frontend-ui-ux/references";

class AllowlistError extends Error {
  constructor(message) {
    super(message);
    this.name = "AllowlistError";
  }
}

class ExternalTermError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExternalTermError";
  }
}

class CanonicalCorpusError extends Error {
  constructor(message) {
    super(message);
    this.name = "CanonicalCorpusError";
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    allowlist: "tools/legacy-token-allowlist.json",
    externalTerms: undefined,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--root" && next !== undefined) {
      options.root = next;
      index += 1;
    } else if (arg === "--allowlist" && next !== undefined) {
      options.allowlist = next;
      index += 1;
    } else if (arg === "--external-terms" && next !== undefined) {
      options.externalTerms = next;
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new AllowlistError(`unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function requireExternalString(entry, field, index) {
  const value = entry[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ExternalTermError(`terms[${index}].${field} must be a non-empty string`);
  }
  return value;
}

async function readExternalTerms(termsPath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(termsPath, "utf8"));
  } catch {
    throw new ExternalTermError("external terms file must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1 || !Array.isArray(parsed.terms)) {
    throw new ExternalTermError("external terms must be an object with version 1 and a terms array");
  }

  const ids = new Set();
  return parsed.terms.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ExternalTermError(`terms[${index}] must be an object`);
    }
    const id = requireExternalString(entry, "id", index);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) {
      throw new ExternalTermError(`terms[${index}].id must be an opaque identifier`);
    }
    if (ids.has(id)) {
      throw new ExternalTermError(`terms[${index}].id must be unique`);
    }
    ids.add(id);
    const value = requireExternalString(entry, "value", index);
    const matchMode = requireExternalString(entry, "matchMode", index);
    if (matchMode !== "substring" && matchMode !== "bounded") {
      throw new ExternalTermError(`terms[${index}].matchMode must be substring or bounded`);
    }
    return { id, value, matchMode };
  });
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function isSkippedFile(relativePath, extraSkippedFiles) {
  if (SKIPPED_FILES.has(relativePath) || extraSkippedFiles.has(relativePath)) {
    return true;
  }
  if (relativePath === "pack-report.json" || relativePath.endsWith(".pack-report.json")) {
    return true;
  }
  return SKIPPED_EXTENSIONS.some((extension) => relativePath.endsWith(extension));
}

function requireString(entry, field, index) {
  const value = entry[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new AllowlistError(`entries[${index}].${field} must be a non-empty string`);
  }
  return value;
}

async function readAllowlist(allowlistPath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(allowlistPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw new AllowlistError(`cannot read or parse allowlist: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
    throw new AllowlistError("allowlist must be an object with an entries array");
  }

  if (parsed.entries.length > 0) {
    throw new AllowlistError("allowlist entries are disabled; remove denied terms instead of exempting them");
  }

  return parsed.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AllowlistError(`entries[${index}] must be an object`);
    }
    const token = requireString(entry, "token", index).toLowerCase();
    if (!LEGACY_TOKENS.includes(token)) {
      throw new AllowlistError(`entries[${index}].token must be one of: ${LEGACY_TOKENS.join(", ")}`);
    }
    return {
      path: normalizeRelativePath(requireString(entry, "path", index)),
      token,
      reason: requireString(entry, "reason", index),
      removalCondition: requireString(entry, "removalCondition", index),
      match: requireString(entry, "match", index)
    };
  });
}

function isAllowed(match, allowlist) {
  return allowlist.some((entry) => (
    entry.path === match.path
    && entry.token === match.token
    && entry.match === match.line
  ));
}

async function collectFiles(root, extraSkippedFiles, skippedDirectories = new Set(), current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(current, entry.name);
    const relativePath = normalizeRelativePath(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(relativePath)) {
        files.push(...await collectFiles(root, extraSkippedFiles, skippedDirectories, fullPath));
      }
    } else if (entry.isFile() && !isSkippedFile(relativePath, extraSkippedFiles)) {
      files.push({ fullPath, relativePath });
    }
  }
  return files;
}

async function canonicalCapture(root) {
  const referencesRoot = path.join(root, ...CANONICAL_REFERENCES_PATH.split("/"));
  const manifestPath = path.join(referencesRoot, "_canonical-corpus", "manifest.json");
  try {
    await fs.lstat(manifestPath);
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return new Map();
    throw new CanonicalCorpusError(`cannot inspect canonical corpus manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const report = await verifyCanonicalFrontendCorpus(referencesRoot);
    return new Map(report.protectedPaths.map((relativePath) => {
      const record = report.capturedFiles.get(relativePath);
      if (!Buffer.isBuffer(record?.bytes) || !record.snapshot) throw new Error(`verified capture missing for ${relativePath}`);
      return [`${CANONICAL_REFERENCES_PATH}/${relativePath}`, record];
    }));
  } catch (error) {
    throw new CanonicalCorpusError(error instanceof Error ? error.message : String(error));
  }
}

function scanText(relativePath, text) {
  if (text.includes("\u0000")) {
    return [];
  }

  const matches = [];
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const tokenMatch of line.matchAll(TOKEN_PATTERN)) {
      matches.push({
        path: relativePath,
        lineNumber: lineIndex + 1,
        token: tokenMatch[1].toLowerCase(),
        line
      });
    }
  }
  return matches;
}

function redactExternalPath(relativePath, terms) {
  return terms.reduce((current, term) => current.replace(new RegExp(escapeRegex(term.value), "giu"), `[${term.id}]`), relativePath);
}

function scanExternalText(relativePath, text, terms) {
  if (text.includes("\u0000")) {
    return [];
  }

  const redactedPath = redactExternalPath(relativePath, terms);
  const matches = [];
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const term of terms) {
      const pattern = term.matchMode === "bounded"
        ? new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(term.value)}(?![A-Za-z0-9_])`, "giu")
        : new RegExp(escapeRegex(term.value), "giu");
      for (const match of line.matchAll(pattern)) {
        matches.push({
          path: redactedPath,
          lineNumber: lineIndex + 1,
          column: (match.index ?? 0) + 1,
          termId: term.id
        });
      }
    }
  }
  return matches;
}

function scanCaptured(capturedFiles, scanner) {
  let canonicalBytesScanned = 0;
  let canonicalProtectedMatches = 0;
  for (const [relativePath, record] of capturedFiles) {
    canonicalBytesScanned += record.bytes.byteLength;
    canonicalProtectedMatches += scanner(relativePath, record.bytes.toString("utf8")).length;
  }
  return {
    canonicalFilesScanned: capturedFiles.size,
    canonicalBytesScanned,
    canonicalProtectedMatches
  };
}

async function revalidateCapturedFiles(capturedFiles) {
  for (const [relativePath, record] of capturedFiles) {
    try {
      await revalidateStableRegularFile(record.snapshot);
    } catch (error) {
      throw new CanonicalCorpusError(
        `canonical snapshot revalidation failed for ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

async function scan(root, allowlist, extraSkippedFiles, capturedFiles) {
  const skippedDirectories = capturedFiles.size > 0 ? new Set([CANONICAL_REFERENCES_PATH]) : new Set();
  const files = await collectFiles(root, extraSkippedFiles, skippedDirectories);
  const matches = [];
  for (const file of files) {
    const text = await fs.readFile(file.fullPath, "utf8");
    matches.push(...scanText(file.relativePath, text));
  }

  const unallowlisted = matches.filter((match) => !isAllowed(match, allowlist));
  return {
    allowedCount: matches.length - unallowlisted.length,
    unallowlisted,
    ...scanCaptured(capturedFiles, scanText)
  };
}

async function scanExternal(root, terms, extraSkippedFiles, capturedFiles) {
  const skippedDirectories = capturedFiles.size > 0 ? new Set([CANONICAL_REFERENCES_PATH]) : new Set();
  const files = await collectFiles(root, extraSkippedFiles, skippedDirectories);
  const unallowlisted = [];
  for (const file of files) {
    const text = await fs.readFile(file.fullPath, "utf8");
    unallowlisted.push(...scanExternalText(file.relativePath, text, terms));
  }
  return {
    ok: unallowlisted.length === 0,
    unallowlisted,
    ...scanCaptured(capturedFiles, (relativePath, text) => scanExternalText(relativePath, text, terms))
  };
}

export async function scanLegacyTokens(options, hooks = {}) {
  const root = path.resolve(options.root);
  const capturedFiles = await canonicalCapture(root);
  let mode;
  let result;
  if (options.externalTermsPath !== undefined) {
    const terms = await readExternalTerms(options.externalTermsPath);
    const termsRelativePath = normalizeRelativePath(path.relative(root, options.externalTermsPath));
    result = await scanExternal(root, terms, new Set([termsRelativePath]), capturedFiles);
    mode = "external";
  } else {
    const allowlist = await readAllowlist(options.allowlistPath);
    const allowlistRelativePath = normalizeRelativePath(path.relative(root, options.allowlistPath));
    result = await scan(root, allowlist, new Set([allowlistRelativePath]), capturedFiles);
    mode = "legacy";
  }
  if (typeof hooks.afterCanonicalScan === "function") await hooks.afterCanonicalScan();
  await revalidateCapturedFiles(capturedFiles);
  return { mode, result };
}

function printMatches(matches) {
  for (const match of matches) {
    console.log(`${match.path}:${match.lineNumber}: ${match.line}`);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const root = path.resolve(options.root);
    const externalTermsPath = options.externalTerms === undefined
      ? undefined
      : path.isAbsolute(options.externalTerms)
        ? options.externalTerms
        : path.resolve(root, options.externalTerms);
    const allowlistPath = path.isAbsolute(options.allowlist)
      ? options.allowlist
      : path.resolve(root, options.allowlist);
    const execution = await scanLegacyTokens({ root, externalTermsPath, allowlistPath });
    const result = execution.result;
    if (options.externalTerms !== undefined) {
      if (options.json) {
        console.log(JSON.stringify(result));
      } else if (result.unallowlisted.length > 0) {
        console.log(`external-term scan failed: ${result.unallowlisted.length} unallowlisted match(es)`);
        for (const match of result.unallowlisted) {
          console.log(`${match.path}:${match.lineNumber} [${match.termId}]`);
        }
      } else {
        console.log("external-term scan passed: no matches");
      }
      process.exitCode = result.unallowlisted.length > 0 ? 1 : 0;
      return;
    }
    if (options.json) {
      console.log(JSON.stringify({ ok: result.unallowlisted.length === 0, ...result }));
      process.exitCode = result.unallowlisted.length > 0 ? 1 : 0;
      return;
    }

    if (result.unallowlisted.length > 0) {
      console.log(`legacy-token scan failed: ${result.unallowlisted.length} unallowlisted match(es)`);
      printMatches(result.unallowlisted);
      process.exitCode = 1;
      return;
    }

    const suffix = result.allowedCount === 1 ? "match" : "matches";
    console.log(`legacy-token scan passed: allowed ${result.allowedCount} ${suffix}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = error instanceof CanonicalCorpusError
      ? "canonical corpus scanner error"
      : error instanceof ExternalTermError
        ? "external-term scanner error"
        : "legacy-token allowlist error";
    console.error(`${prefix}: ${message}`);
    process.exitCode = 2;
  }
}

if (
  process.argv[1]
  && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))
) await main();
