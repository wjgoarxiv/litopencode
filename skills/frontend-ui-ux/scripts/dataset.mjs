import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { parseStrictJson } from "./strict-json.mjs";

export const canonicalDatasetSha256 = "a89011236a6ff14e12ec55fccbfab1bbd40ae34614cea5710c022121aa841bb8";
export const canonicalDatasetBytes = 1_023_482;
export const canonicalDatasetRecords = 2_277;
const maximumDatasetBytes = 4 * 1024 * 1024;
const datasetUrl = new URL("../data/design-intelligence.json", import.meta.url);
let canonicalDatasetPromise;

function normalizedExpectedHash(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError("expectedSha256 must be a string");
  const normalized = value.startsWith("sha256:") ? value.slice(7) : value;
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new Error("expectedSha256 must contain 64 lowercase hexadecimal digits");
  return normalized;
}

function assertRecord(record, index, ids) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Malformed design-intelligence dataset record ${index}: expected object`);
  }
  if (typeof record.record_id !== "string" || record.record_id === "") {
    throw new Error(`Malformed design-intelligence dataset record ${index}: missing record_id`);
  }
  if (typeof record.domain !== "string" || record.domain === "") {
    throw new Error(`Malformed design-intelligence dataset record ${index}: missing domain`);
  }
  if (ids.has(record.record_id)) throw new Error(`Malformed design-intelligence dataset: duplicate record_id ${record.record_id}`);
  ids.add(record.record_id);
}

export async function validateDesignIntelligenceDataset({ data, expectedSha256 } = {}) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data ?? "", "utf8");
  if (bytes.length > maximumDatasetBytes) throw new Error("Design-intelligence dataset exceeds 4 MiB");
  const expected = normalizedExpectedHash(expectedSha256);
  if (expected !== undefined) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw new Error(`Corrupt design-intelligence dataset checksum: expected ${expected}, got ${actual}`);
  }
  const parsed = parseStrictJson(bytes.toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.records)) {
    throw new Error("Malformed design-intelligence dataset: records array is required");
  }
  const ids = new Set();
  parsed.records.forEach((record, index) => assertRecord(record, index, ids));
  return parsed;
}

export async function readCanonicalDesignIntelligence() {
  canonicalDatasetPromise ??= fs.readFile(datasetUrl).then(async (data) => {
    if (data.length !== canonicalDatasetBytes) {
      throw new Error(`Corrupt canonical design-intelligence byte count: expected ${canonicalDatasetBytes}, got ${data.length}`);
    }
    const parsed = await validateDesignIntelligenceDataset({ data, expectedSha256: canonicalDatasetSha256 });
    if (parsed.records.length !== canonicalDatasetRecords) {
      throw new Error(
        `Corrupt canonical design-intelligence record count: expected ${canonicalDatasetRecords}, got ${parsed.records.length}`
      );
    }
    return parsed;
  });
  return canonicalDatasetPromise;
}
