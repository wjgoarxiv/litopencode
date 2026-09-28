import { canonicalJson, canonicalizeValue } from "./canonical-json.mjs";
import { readCanonicalDesignIntelligence } from "./dataset.mjs";

const maximumQueryBytes = 4096;
const maximumRecordsPerDomain = 20;
const maximumOutputBytes = 256 * 1024;
const domainAliases = Object.freeze({
  components: ["app-interface", "icons", "ui-reasoning", "ux-guidelines"]
});

function normalizeRequest(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("Retrieval request must be an object");
  }
  if (typeof request.query !== "string") throw new TypeError("Retrieval query must be a string");
  if (Buffer.byteLength(request.query, "utf8") > maximumQueryBytes) {
    throw new Error("Retrieval query exceeds 4 KiB (4096 UTF-8 bytes)");
  }
  if (!Array.isArray(request.domains) || request.domains.length === 0) {
    throw new Error("Retrieval request must name at least one domain");
  }
  const domains = [...new Set(request.domains)];
  if (domains.some((domain) => typeof domain !== "string" || domain === "")) {
    throw new Error("Retrieval domains must be non-empty strings");
  }
  const limit = request.limit === undefined ? maximumRecordsPerDomain : request.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumRecordsPerDomain) {
    throw new Error(`Retrieval limit must be an integer from 1 to ${maximumRecordsPerDomain}`);
  }
  return {
    query: request.query.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
    domains,
    limit
  };
}

function searchableText(record) {
  return Object.entries(record)
    .filter(([key]) => key !== "record_id")
    .map(([, value]) => (typeof value === "string" || typeof value === "number" ? String(value) : ""))
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
}

function rankedRecords(records, domain, query, limit) {
  const sourceDomains = domainAliases[domain] ?? [domain];
  const tokens = query.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return [];
  return records
    .filter((record) => sourceDomains.includes(record.domain))
    .map((record) => {
      const text = searchableText(record);
      const score = tokens.reduce((total, token) => total + (text.includes(token) ? 1 : 0), 0);
      return { record, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.record.record_id.localeCompare(right.record.record_id))
    .slice(0, limit)
    .map(({ record, score }) =>
      canonicalizeValue({
        ...record,
        domain,
        source_domain: record.domain,
        relevance: score
      })
    );
}

export async function retrieveDesignIntelligence(request) {
  const normalized = normalizeRequest(request);
  const dataset = await readCanonicalDesignIntelligence();
  const knownDomains = new Set(dataset.records.map((record) => record.domain));
  for (const domain of normalized.domains) {
    if (!(domain in domainAliases) && !knownDomains.has(domain)) throw new Error(`Unknown domain: ${domain}`);
  }
  const records = normalized.domains.flatMap((domain) =>
    rankedRecords(dataset.records, domain, normalized.query, normalized.limit)
  );
  const output = canonicalizeValue({
    fabricated: false,
    fallbackApplied: false,
    query: normalized.query,
    records,
    schema_version: "litfamily.design-intelligence-retrieval/v1alpha1",
    total: records.length
  });
  if (Buffer.byteLength(canonicalJson(output), "utf8") > maximumOutputBytes) {
    throw new Error("Retrieval output exceeds 256 KiB");
  }
  return output;
}
