const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const tierConditions = Object.freeze({
  smoke: Object.freeze(["app-started", "primary-route", "critical-state"]),
  full: Object.freeze([
    "finite-inventory-complete",
    "mechanical-checks-complete",
    "accessibility-checks-complete"
  ]),
  "reference-fidelity": Object.freeze([
    "finite-inventory-complete",
    "reference-hash-match",
    "paired-captures-comparable",
    "reference-findings-complete"
  ])
});
export const tierInventory = Object.freeze({
  smoke: Object.freeze(["route", "interaction", "viewport-min", "viewport-max"]),
  full: Object.freeze([
    "route",
    "screen",
    "state",
    "viewport",
    "theme",
    "permission",
    "auth",
    "error",
    "loading",
    "empty",
    "tui-size"
  ]),
  "reference-fidelity": Object.freeze([
    "route",
    "screen",
    "state",
    "viewport",
    "theme",
    "permission",
    "auth",
    "error",
    "loading",
    "empty",
    "tui-size",
    "reference-comparison"
  ])
});
export const capabilityCodes = Object.freeze({
  capture: "BLOCKED_RENDERER_UNAVAILABLE",
  auth: "BLOCKED_AUTH_UNAVAILABLE",
  test_account_safe: "BLOCKED_TEST_ACCOUNT_UNSAFE",
  independent_review: "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"
});
const rootKeys = ["schema_id", "design_contract_hash", "source_revision", "tier", "created_at", "maximum_age_seconds", "freshness", "capabilities", "captures", "inventory", "mechanical_checks", "accessibility_checks", "tui_checks", "review_receipt_hashes", "findings", "exception_references", "cleanup", "verdict"];
const captureKeys = ["capture_id", "source_hash", "capture_hash", "created_at", "viewport", "dpr", "os", "runtime", "runtime_version", "font_set", "locale", "reduced_motion", "animation_settling", "color_scheme", "auth_owner", "process_owner"];
const betaCaptureKeys = [...captureKeys, "path", "byte_length", "width", "height"];
const checkKeys = ["id", "status", "evidence_path", "evidence_hash"];
const betaCheckKeys = [...checkKeys, "channel"];
export const evidenceChannels = Object.freeze([
  "tests",
  "browser",
  "keyboard",
  "accessibility-tree",
  "screen-reader",
  "performance",
  "localization"
]);
const maximumTextCharacters = 4096;
const drivePrefix = /^[A-Za-z]:/u;
const pathControlCharacter = /[\u0000-\u001f\u007f]/u;
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const exact = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
function isEvidenceText(value) {
  return typeof value === "string" && value.length > 0 && [...value].length <= maximumTextCharacters;
}
export function isSchemaRelativeCapturePath(value) {
  if (
    !isEvidenceText(value) ||
    value.startsWith("/") ||
    value.includes("/") ||
    value.includes("\\") ||
    drivePrefix.test(value) ||
    pathControlCharacter.test(value)
  ) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
function parseTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}
function matchingHashes(input) {
  return (
    typeof input.expectedSourceHash === "string" &&
    input.expectedSourceHash === input.actualSourceHash &&
    typeof input.expectedCaptureHash === "string" &&
    input.expectedCaptureHash === input.actualCaptureHash
  );
}
function checkEvidenceItem(item, statuses, betaPath = false, requireChannel = false) {
  return (
    object(item) &&
    isEvidenceText(item.id) &&
    statuses.includes(item.status) &&
    (betaPath ? isSchemaRelativeCapturePath(item.evidence_path) : isEvidenceText(item.evidence_path)) &&
    (!requireChannel || evidenceChannels.includes(item.channel)) &&
    hashPattern.test(item.evidence_hash)
  );
}
export function validateEvidenceManifest(manifest) {
  const errors = [];
  if (!object(manifest)) return { valid: false, errors: ["manifest must be an object"] };
  if (!exact(manifest, rootKeys)) errors.push("manifest contains unknown fields");
  const beta = manifest.schema_id === "litfamily.evidence-manifest/v1beta1";
  if (!beta && manifest.schema_id !== "litfamily.evidence-manifest/v1alpha1") {
    errors.push("schema_id must be exact v1alpha1 or v1beta1");
  }
  if (!hashPattern.test(manifest.design_contract_hash)) errors.push("design_contract_hash is invalid");
  if (!isEvidenceText(manifest.source_revision)) {
    errors.push("source_revision must be non-empty text");
  }
  if (!tierInventory[manifest.tier]) errors.push("tier is invalid");
  if (parseTime(manifest.created_at) === undefined) errors.push("created_at is invalid");
  if (
    !Number.isFinite(manifest.maximum_age_seconds) ||
    manifest.maximum_age_seconds <= 0 ||
    manifest.maximum_age_seconds > 86400
  ) {
    errors.push("maximum_age_seconds must be finite and between 1 and 86400");
  }
  if (!exact(manifest.freshness, ["assessed_at", "expires_at", "fresh", "contract_hash_match", "source_hash_match", "capture_hash_match"])) errors.push("freshness is required or contains unknown fields");
  else {
    for (const key of ["fresh", "contract_hash_match", "source_hash_match", "capture_hash_match"]) {
      if (typeof manifest.freshness[key] !== "boolean") errors.push(`freshness.${key} must be boolean`);
    }
    if (parseTime(manifest.freshness.assessed_at) === undefined || parseTime(manifest.freshness.expires_at) === undefined) {
      errors.push("freshness timestamps are invalid");
    }
  }
  if (!exact(manifest.capabilities, Object.keys(capabilityCodes))) errors.push("capabilities are required or contain unknown fields");
  else {
    for (const key of Object.keys(capabilityCodes)) {
      if (typeof manifest.capabilities[key] !== "boolean") errors.push(`capabilities.${key} must be boolean`);
    }
  }
  if (!Array.isArray(manifest.captures) || manifest.captures.length === 0 || manifest.captures.length > 10000) {
    errors.push("captures must be finite and non-empty");
  } else {
    for (const capture of manifest.captures) {
      if (
        !exact(capture, beta ? betaCaptureKeys : captureKeys) ||
        !hashPattern.test(capture.source_hash) ||
        !hashPattern.test(capture.capture_hash) ||
        parseTime(capture.created_at) === undefined ||
        !Number.isFinite(capture.dpr) ||
        capture.dpr <= 0 ||
        capture.dpr > 8 ||
        !Array.isArray(capture.font_set) ||
        capture.font_set.length === 0 ||
        capture.font_set.some((font) => !isEvidenceText(font)) ||
        typeof capture.reduced_motion !== "boolean" ||
        ["capture_id", "viewport", "os", "runtime", "runtime_version", "locale", "animation_settling",
          "color_scheme", "auth_owner", "process_owner"].some(
          (field) => !isEvidenceText(capture[field])
        )
      ) errors.push("capture metadata is incomplete");
      if (beta && (
        !isSchemaRelativeCapturePath(capture.path) ||
        !Number.isInteger(capture.byte_length) || capture.byte_length < 1 || capture.byte_length > 25 * 1024 * 1024 ||
        !Number.isInteger(capture.width) || capture.width < 1 || capture.width > 16384 ||
        !Number.isInteger(capture.height) || capture.height < 1 || capture.height > 16384
      )) errors.push("beta material capture metadata is invalid");
    }
  }
  if (!Array.isArray(manifest.inventory) || manifest.inventory.length === 0 || manifest.inventory.length > 10000) {
    errors.push("inventory must be finite and non-empty");
  } else {
    for (const item of manifest.inventory) {
      if (
        !exact(item, ["id", "kind", "status", "exception_id", "evidence_path", "evidence_hash"]) ||
        !checkEvidenceItem(item, ["captured", "not_applicable", "accepted_exception", "blocked"], beta) ||
        !isEvidenceText(item.kind) ||
        (item.status === "accepted_exception"
          ? !isEvidenceText(item.exception_id)
          : item.exception_id !== null)
      ) errors.push("inventory item is invalid");
    }
    if (new Set(manifest.inventory.map((item) => item.id)).size !== manifest.inventory.length) {
      errors.push("inventory ids must be unique");
    }
  }
  for (const field of ["mechanical_checks", "accessibility_checks", "tui_checks"]) {
    const checks = manifest[field];
    if (
      !Array.isArray(checks) ||
      checks.length === 0 ||
      checks.length > 10000 ||
      checks.some(
        (item) =>
          !exact(item, beta ? betaCheckKeys : checkKeys) ||
          !checkEvidenceItem(item, ["pass", "fail", "blocked", "not_applicable"], beta, beta)
      )
    ) errors.push(`${field} must contain finite evidence-backed checks`);
  }
  const expectedReviewReceipts = beta && manifest.tier === "smoke" ? 0 : 2;
  if (
    !Array.isArray(manifest.review_receipt_hashes) ||
    manifest.review_receipt_hashes.length !== expectedReviewReceipts ||
    new Set(manifest.review_receipt_hashes).size !== expectedReviewReceipts ||
    manifest.review_receipt_hashes.some((hash) => !hashPattern.test(hash))
  ) errors.push(beta && manifest.tier === "smoke"
    ? "smoke evidence without review inventory requires zero review receipt hashes"
    : "full and reference-fidelity evidence require exactly two distinct review receipt hashes");
  if (
    !Array.isArray(manifest.findings) ||
    manifest.findings.some(
      (finding) =>
        !exact(finding, ["code", "severity", "evidence"]) ||
        !isEvidenceText(finding.code) ||
        !["critical", "high", "medium", "low", "info"].includes(finding.severity) ||
        !Array.isArray(finding.evidence) ||
        finding.evidence.length === 0 ||
        finding.evidence.some((hash) => !hashPattern.test(hash))
    ) ||
    !Array.isArray(manifest.exception_references) ||
    manifest.exception_references.some((id) => !isEvidenceText(id)) ||
    new Set(manifest.exception_references).size !== manifest.exception_references.length
  ) {
    errors.push("findings and exception_references must be arrays");
  }
  if (
    !exact(manifest.cleanup, ["owned_processes_stopped", "temporary_artifacts_removed", "remaining"]) ||
    typeof manifest.cleanup.owned_processes_stopped !== "boolean" ||
    typeof manifest.cleanup.temporary_artifacts_removed !== "boolean" ||
    !Array.isArray(manifest.cleanup.remaining) ||
    manifest.cleanup.remaining.length > 1000 ||
    manifest.cleanup.remaining.some((item) => !isEvidenceText(item))
  ) errors.push("cleanup receipt is incomplete");
  if (!["PASS", "REVISE", "FAIL", "BLOCKED"].includes(manifest.verdict)) errors.push("verdict is invalid");
  return { valid: errors.length === 0, errors };
}
export function evaluateEvidenceFreshness(input = {}) {
  if (!matchingHashes(input)) {
    return { accepted: false, fresh: false, code: "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH", verdict: "BLOCKED" };
  }
  if (!Number.isFinite(input.maximumAgeSeconds) || input.maximumAgeSeconds < 0) {
    throw new Error("maximumAgeSeconds must be a non-negative finite number");
  }
  const age = parseTime(input.now) - parseTime(input.createdAt);
  // A capture dated after the moment it is being assessed is a broken clock or a
  // forged timestamp, not old evidence, so it gets its own code instead of being
  // reported as stale.
  if (Number.isFinite(age) && age < 0) {
    return { accepted: false, fresh: false, code: "BLOCKED_EVIDENCE_FUTURE", verdict: "BLOCKED" };
  }
  if (!Number.isFinite(age) || age > input.maximumAgeSeconds * 1000) {
    return { accepted: false, fresh: false, code: "BLOCKED_EVIDENCE_STALE", verdict: "BLOCKED" };
  }
  return { accepted: true, fresh: true, verdict: "READY" };
}
export function completionConditionsForTier(tier) {
  if (!tierConditions[tier]) throw new Error(`Unknown visual-QA tier: ${String(tier)}`);
  return [...tierConditions[tier]];
}
export function evaluateTierCompletion({ tier, completed } = {}) {
  if (!Array.isArray(completed)) throw new Error("completed must be an array");
  const conditions = completionConditionsForTier(tier);
  const unknown = completed.filter((condition) => !conditions.includes(condition));
  if (unknown.length > 0) throw new Error(`Unknown ${tier} completion condition: ${unknown[0]}`);
  const missing = conditions.filter((condition) => !new Set(completed).has(condition));
  return { complete: missing.length === 0, missing, tier, verdict: missing.length === 0 ? "READY" : "REVISE" };
}
