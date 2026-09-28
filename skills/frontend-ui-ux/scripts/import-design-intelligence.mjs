#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson } from "./canonical-json.mjs";
import { parseRfc4180 } from "./csv.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const exactCommit = "1307d97a72e6c1cda572cb65471ae5ce82995218";
const exactDatasetSha = "a89011236a6ff14e12ec55fccbfab1bbd40ae34614cea5710c022121aa841bb8";
const decoder = new TextDecoder("utf-8", { fatal: true });
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const provenancePath = path.resolve(scriptDir, "../data/PROVENANCE.json");
const datasetPath = path.resolve(scriptDir, "../data/design-intelligence.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") options.check = true;
    else if (["--source-root", "--expect-records", "--max-bytes"].includes(flag)) {
      if (argv[index + 1] === undefined) throw new Error(`${flag} requires a value`);
      options[flag.slice(2).replaceAll("-", "_")] = argv[++index];
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  if (!options.source_root || !options.check) {
    throw new Error("usage: import-design-intelligence.mjs --source-root ROOT --check --expect-records N --max-bytes N");
  }
  options.expect_records = Number(options.expect_records);
  options.max_bytes = Number(options.max_bytes);
  if (!Number.isSafeInteger(options.expect_records) || options.expect_records < 1) {
    throw new Error("--expect-records must be a positive integer");
  }
  if (!Number.isSafeInteger(options.max_bytes) || options.max_bytes < 1) {
    throw new Error("--max-bytes must be a positive integer");
  }
  return options;
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveContainedRegularFile(filePath, root) {
  const canonicalRoot = await fs.realpath(path.resolve(root));
  const absolute = path.resolve(canonicalRoot, filePath);
  const relative = path.relative(canonicalRoot, absolute);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`source path escapes root: ${filePath}`);
  }
  let parent = canonicalRoot;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    parent = path.join(parent, segment);
    const parentStat = await fs.lstat(parent);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
      throw new Error(`source parent must be a contained non-symlink directory: ${filePath}`);
    }
  }
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`source must be a regular non-symlink file: ${filePath}`);
  const resolved = await fs.realpath(absolute);
  if (!contained(canonicalRoot, resolved)) throw new Error(`resolved source escapes root: ${filePath}`);
  return resolved;
}

function normalizeSource(raw, entry) {
  if (raw.includes(0)) throw new Error(`NUL byte: ${entry.path}`);
  let text;
  try {
    text = decoder.decode(raw);
  } catch {
    throw new Error(`invalid UTF-8: ${entry.path}`);
  }
  text = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (entry.repair) {
    const exactRepair =
      entry.path === "src/ui-ux-pro-max/data/stacks/javafx.csv" &&
      entry.repair.rule === "backslash_quote_to_rfc4180_double_quote" &&
      entry.repair.occurrences === 18;
    if (!exactRepair || text.split('\\"').length - 1 !== 18) throw new Error(`unapproved repair: ${entry.path}`);
    text = text.replaceAll('\\"', '""');
    if (sha256(Buffer.from(text)) !== entry.repair.repaired_sha256) throw new Error(`repair hash mismatch: ${entry.path}`);
  }
  return text;
}

function entryRecords(rows, entry) {
  const header = rows[0];
  if (new Set(header).size !== header.length || JSON.stringify(header) !== JSON.stringify(entry.header)) {
    throw new Error(`header drift: ${entry.path}`);
  }
  if (rows.length - 1 !== entry.data_row_count) throw new Error(`row count drift: ${entry.path}`);
  const positions = Object.fromEntries(entry.selected_columns.map((column) => [column, header.indexOf(column)]));
  if (Object.values(positions).some((position) => position < 0)) throw new Error(`selected-column drift: ${entry.path}`);
  const stack = entry.path.includes("/stacks/") ? path.basename(entry.path, ".csv") : undefined;
  const domain = stack ? `stack/${stack}` : path.basename(entry.path, ".csv");
  const records = rows.slice(1).map((row, rowIndex) => {
    const record = Object.fromEntries(
      entry.selected_columns.map((column) => [column, row[positions[column]].trim()])
    );
    const number = Number(record.No);
    if (!Number.isSafeInteger(number) || number < 1 || String(number) !== record.No) {
      throw new Error(`non-canonical No: ${entry.path}:${rowIndex + 2}`);
    }
    record.No = number;
    record.domain = domain;
    record.record_id = `${domain}/${number}`;
    if (stack) record.stack = stack;
    return record;
  });
  if (records.length !== entry.normalized_record_count) throw new Error(`normalized count drift: ${entry.path}`);
  return records;
}

async function loadContract() {
  const provenance = parseStrictJson(await fs.readFile(provenancePath, "utf8"));
  if (
    provenance.source?.commit !== exactCommit ||
    provenance.import_manifest?.source_count !== 34 ||
    !Array.isArray(provenance.sources) ||
    provenance.sources.length !== 34 ||
    new Set(provenance.sources.map((entry) => entry.path)).size !== 34
  ) throw new Error("packaged provenance contract mismatch");
  return provenance;
}

export async function importDesignIntelligence(options) {
  const root = await fs.realpath(path.resolve(options.source_root));
  const provenance = await loadContract();
  const records = [];
  const ids = new Set();
  for (const entry of provenance.sources) {
    const file = await resolveContainedRegularFile(entry.path, root);
    const raw = await fs.readFile(file);
    if (sha256(raw) !== entry.raw_sha256) throw new Error(`source hash mismatch: ${entry.path}`);
    const rows = parseRfc4180(normalizeSource(raw, entry), entry.path);
    for (const record of entryRecords(rows, entry)) {
      if (ids.has(record.record_id)) throw new Error(`duplicate record id: ${record.record_id}`);
      ids.add(record.record_id);
      records.push(record);
    }
  }
  if (records.length !== options.expect_records) throw new Error(`record count mismatch: ${records.length}`);
  const bytes = Buffer.from(canonicalJson({
    records,
    schema_version: "litfamily.design-intelligence/v1",
    source_commit: exactCommit
  }));
  if (bytes.length > options.max_bytes) throw new Error(`payload exceeds byte limit: ${bytes.length}`);
  if (sha256(bytes) !== exactDatasetSha) throw new Error(`canonical dataset hash mismatch: ${sha256(bytes)}`);
  if (!(await fs.readFile(datasetPath)).equals(bytes)) throw new Error("packaged canonical dataset differs from import");
  return { bytes: bytes.length, records: records.length, sha256: exactDatasetSha };
}

export async function main(argv = process.argv.slice(2)) {
  const result = await importDesignIntelligence(parseArgs(argv));
  process.stdout.write(
    `status=SOURCE_CONTRACT_PASS records=${result.records} bytes=${result.bytes} sha256=${result.sha256}\n`
  );
}

export async function isDirectExecution(
  argvPath = process.argv[1],
  modulePath = fileURLToPath(import.meta.url),
  filesystem = fs
) {
  if (!argvPath) return false;
  const canonicalPath = (value) =>
    path.resolve(value)
      .replace(/^\/tmp\//u, "/private/tmp/")
      .replace(/^\/private\/(?:private\/)+tmp\//u, "/private/tmp/");
  try {
    return canonicalPath(await filesystem.realpath(argvPath)) === canonicalPath(await filesystem.realpath(modulePath));
  } catch {
    return canonicalPath(argvPath) === canonicalPath(modulePath);
  }
}

if (await isDirectExecution()) {
  main().catch((error) => {
    process.stderr.write(`status=SOURCE_CONTRACT_FAIL error=${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
