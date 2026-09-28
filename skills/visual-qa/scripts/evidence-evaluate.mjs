import { createHash } from "node:crypto";
import fs from "node:fs";
import { canonicalJson } from "./canonical-json.mjs";
import { validateDesignContract } from "./design-contract.mjs";
import {
  capabilityCodes,
  evidenceChannels,
  isSchemaRelativeCapturePath,
  tierInventory,
  validateEvidenceManifest
} from "./evidence.mjs";
import { validateReviewIndependence } from "./review.mjs";
import { inspectPng } from "./png.mjs";

const time = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function blocked(code, extra = {}) {
  return { code, codes: [code], verdict: "BLOCKED", ...extra };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function unchangedFileIdentity(left, right) {
  return sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function readDescriptorBoundMaterial(descriptor, maximumBytes = 25 * 1024 * 1024) {
  const before = fs.fstatSync(descriptor);
  if (!before.isFile() || before.size > maximumBytes) throw new Error("material evidence must be a bounded regular file descriptor");
  const bytes = Buffer.alloc(before.size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  const extra = Buffer.alloc(1);
  const hasExtra = fs.readSync(descriptor, extra, 0, 1, before.size) !== 0;
  const after = fs.fstatSync(descriptor);
  if (offset !== bytes.length || hasExtra || !unchangedFileIdentity(before, after)) {
    throw new Error("material evidence identity or bytes changed during descriptor-bound read");
  }
  return bytes;
}

function registerTransferredDescriptors(materialFileDescriptors) {
  const descriptors = new Map();
  const owned = new Set();
  const descriptorLabels = new Map();
  let error;
  if (!Array.isArray(materialFileDescriptors)) {
    error = "beta evidence requires caller-authorized, already-open material file descriptors";
  } else {
    for (const entry of materialFileDescriptors) {
      const entryObject = entry !== null && typeof entry === "object";
      const descriptor = entryObject && Object.hasOwn(entry, "descriptor") ? entry.descriptor : undefined;
      if (Number.isInteger(descriptor) && descriptor >= 0) owned.add(descriptor);
      if (
        !entryObject ||
        Object.keys(entry).length !== 2 ||
        !Object.hasOwn(entry, "path") ||
        !Object.hasOwn(entry, "descriptor") ||
        !isSchemaRelativeCapturePath(entry.path) ||
        !Number.isInteger(descriptor) ||
        descriptor < 0
      ) {
        error ??= "material descriptors must bind an exact path label to one open descriptor";
        continue;
      }
      if (descriptors.has(entry.path)) {
        error ??= "material descriptor path labels must be unique";
        continue;
      }
      if (descriptorLabels.has(descriptor)) {
        error ??= "one transferred descriptor cannot satisfy more than one path label";
        continue;
      }
      descriptors.set(entry.path, descriptor);
      descriptorLabels.set(descriptor, entry.path);
    }
  }
  let closed = false;
  return {
    descriptors,
    error,
    close() {
      if (closed) return;
      closed = true;
      for (const descriptor of owned) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // A transferred descriptor is closed at most once by this evaluator;
          // an invalid or already-closed fd still cannot escape the ownership boundary.
        }
      }
    }
  };
}

function descriptorCoverageError(manifest, ownership) {
  if (ownership.error !== undefined) return ownership.error;
  const expectedPaths = new Set([
    ...manifest.captures.map((capture) => capture.path),
    ...manifest.inventory.map((item) => item.evidence_path),
    ...["mechanical_checks", "accessibility_checks", "tui_checks"].flatMap(
      (field) => manifest[field].map((item) => item.evidence_path)
    )
  ]);
  if (
    ownership.descriptors.size !== expectedPaths.size ||
    [...expectedPaths].some((evidencePath) => !ownership.descriptors.has(evidencePath))
  ) return "material descriptors must exactly cover every manifest evidence path";
  return undefined;
}

function materialEvidenceArtifacts(manifest, descriptors) {
  if (manifest.schema_id !== "litfamily.evidence-manifest/v1beta1") return undefined;
  const cache = new Map();
  const readPointer = (evidencePath, expectedHash) => {
    const cacheKey = `${evidencePath}\u0000${expectedHash}`;
    if (!cache.has(cacheKey)) {
      const bytes = readDescriptorBoundMaterial(descriptors.get(evidencePath));
      if (hashBytes(bytes) !== expectedHash) throw new Error("material evidence hash does not match its manifest pointer");
      cache.set(cacheKey, bytes);
    }
    return cache.get(cacheKey);
  };
  const artifacts = manifest.captures.map((capture) => {
    const bytes = readPointer(capture.path, capture.capture_hash);
    if (bytes.length !== capture.byte_length) throw new Error("capture byte length does not match the beta manifest");
    const png = inspectPng(bytes);
    if (!png.ok || png.width !== capture.width || png.height !== capture.height) {
      throw new Error("capture is not a valid PNG with the declared dimensions");
    }
    return { capture_id: capture.capture_id, bytes };
  });
  const captures = new Set(manifest.captures.map((capture) => `${capture.path}\u0000${capture.capture_hash}`));
  for (const item of manifest.inventory) {
    readPointer(item.evidence_path, item.evidence_hash);
    if (item.status === "captured" && !captures.has(`${item.evidence_path}\u0000${item.evidence_hash}`)) {
      throw new Error(`captured inventory ${item.id} is not linked to a declared material capture`);
    }
  }
  for (const field of ["mechanical_checks", "accessibility_checks", "tui_checks"]) {
    for (const item of manifest[field]) readPointer(item.evidence_path, item.evidence_hash);
  }
  const passingChannels = new Set();
  for (const field of ["mechanical_checks", "accessibility_checks", "tui_checks"]) {
    for (const item of manifest[field]) if (item.status === "pass") passingChannels.add(item.channel);
  }
  return { artifacts, passingChannels };
}

export function hashCanonicalValue(value) {
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return `sha256:${digest}`;
}

export function canonicalEvidenceManifestBytes(manifest) {
  return Buffer.from(canonicalJson(manifest));
}

function canonicalManifestBytesMatch(manifest, value) {
  try {
    const actual = Buffer.isBuffer(value)
      ? value
      : ArrayBuffer.isView(value)
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : value instanceof ArrayBuffer
          ? Buffer.from(value)
          : typeof value === "string"
            ? Buffer.from(value)
            : undefined;
    return actual !== undefined && actual.equals(canonicalEvidenceManifestBytes(manifest));
  } catch {
    return false;
  }
}

export function hashBytes(value) {
  let bytes;
  if (typeof value === "string") bytes = Buffer.from(value);
  else if (Buffer.isBuffer(value)) bytes = value;
  else if (ArrayBuffer.isView(value)) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  else if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
  else throw new TypeError("immutable input must be bytes or text");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function hashCaptureArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new TypeError("captureArtifacts must be a non-empty array");
  }
  const normalized = artifacts.map((artifact) => {
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      Object.keys(artifact).some((key) => !["capture_id", "bytes"].includes(key)) ||
      typeof artifact.capture_id !== "string" ||
      artifact.capture_id.length === 0
    ) throw new TypeError("capture artifact must contain exact capture_id and bytes");
    return { capture_id: artifact.capture_id, hash: hashBytes(artifact.bytes) };
  }).sort((left, right) => left.capture_id.localeCompare(right.capture_id));
  if (new Set(normalized.map((item) => item.capture_id)).size !== normalized.length) {
    throw new Error("capture artifact ids must be unique");
  }
  return hashCanonicalValue(normalized);
}

// Evidence kind expected for each id-bearing Design Contract inventory category.
// Authenticated surfaces are keyed by route rather than by their own id, so they
// reconcile through the route entry they unlock.
const inventoryKinds = Object.freeze({
  routes: "route",
  regions: "region",
  components: "component",
  interactions: "interaction",
  states: "state",
  viewports: "viewport",
  references: "reference-comparison"
});

function inventoryResult(manifest, contract, receipts) {
  const required = new Map();
  for (const [category, kind] of Object.entries(inventoryKinds)) {
    for (const item of contract.inventory[category]) required.set(item.id, kind);
  }
  const actual = new Map(manifest.inventory.map((item) => [item.id, item]));
  const contractMismatches = [...required].flatMap(([id, kind]) => {
    const item = actual.get(id);
    return item && item.kind === kind ? [] : [`${id}:${kind}`];
  });
  const expectedTuples = new Set(
    manifest.inventory.map(({ id, kind, status }) => canonicalJson({ id, kind, status }))
  );
  const receiptMismatches = receipts.flatMap((receipt) => {
    const reviewed = new Set(receipt.reviewed_inventory.map((item) => canonicalJson(item)));
    if (
      reviewed.size === expectedTuples.size &&
      [...expectedTuples].every((item) => reviewed.has(item))
    ) return [];
    return [receipt.review_id];
  });
  return { contractMismatches, receiptMismatches };
}

function immutableResult(manifest, options) {
  try {
    const source = hashBytes(options.sourceBytes);
    const evidence = hashBytes(options.evidenceManifestBytes);
    const capture = hashCaptureArtifacts(options.captureArtifacts);
    const artifacts = new Map(options.captureArtifacts.map((item) => [item.capture_id, hashBytes(item.bytes)]));
    const captureMismatch =
      artifacts.size !== manifest.captures.length ||
      manifest.captures.some(
        (item) => item.source_hash !== source || artifacts.get(item.capture_id) !== item.capture_hash
      );
    if (captureMismatch) return { valid: false };
    const expected = {
      capture,
      design_contract: manifest.design_contract_hash,
      evidence_manifest: evidence,
      source
    };
    const valid = options.reviewReceipts.every((receipt) =>
      Object.entries(expected).every(([key, value]) => receipt.input_hashes[key] === value)
    );
    return { expected, valid };
  } catch {
    return { valid: false };
  }
}

function referencedExceptions(manifest, contract, now) {
  const byId = new Map(contract.accepted_exceptions.map((item) => [item.id, item]));
  const referenced = manifest.exception_references.map((id) => byId.get(id));
  if (referenced.some((item) => !item)) return { valid: false, values: [] };
  const current = time(now);
  if (
    current === undefined ||
    referenced.some((item) => time(item.expires_at) === undefined || current > time(item.expires_at))
  ) return { valid: false, values: [] };
  return { valid: true, values: referenced };
}

// A gating finding is only forgiven when its code names a current, owned,
// referenced accepted exception in the Design Contract.
function findingAccepted(finding, exceptions) {
  if (!["critical", "high"].includes(finding.severity)) return true;
  return exceptions.some((exception) => exception.id === finding.code);
}

// Returns the freshness code for a manifest, or undefined when its timestamps are
// usable. Evidence dated after the assessment moment is separated from evidence
// that simply aged out: the first means the clock or the timestamp is wrong and no
// age can be computed, the second means a real capture is too old to trust.
function freshnessCode(manifest, now) {
  const current = time(now);
  const created = time(manifest.created_at);
  const assessed = time(manifest.freshness.assessed_at);
  const expires = time(manifest.freshness.expires_at);
  const maximumAge = manifest.maximum_age_seconds * 1000;
  const captured = manifest.captures.map((capture) => time(capture.created_at));
  if (
    current === undefined ||
    [created, assessed, expires].some((value) => value === undefined) ||
    captured.some((value) => value === undefined)
  ) return "BLOCKED_EVIDENCE_STALE";
  if (current < created || current < assessed || captured.some((value) => current < value)) {
    return "BLOCKED_EVIDENCE_FUTURE";
  }
  if (
    current > expires ||
    current - created > maximumAge ||
    captured.some((value) => current - value > maximumAge)
  ) return "BLOCKED_EVIDENCE_STALE";
  return undefined;
}

function evaluateEvidenceManifestOwned(
  manifest,
  options,
  descriptorOwnership
) {
  const {
    now = new Date().toISOString(),
    captureArtifacts,
    designContract,
    evidenceManifestBytes,
    reviewReceipts,
    sourceBytes
  } = options;
  const validation = validateEvidenceManifest(manifest);
  const beta = manifest?.schema_id === "litfamily.evidence-manifest/v1beta1";
  const capabilityBlocks = [];
  const requiresAuth = Array.isArray(manifest?.inventory) && manifest.inventory.some((item) => item?.kind === "auth");
  const requiresReview = designContract?.evidence_policy?.independent_review_required === true ||
    manifest?.tier !== "smoke" || (
    Array.isArray(manifest?.review_receipt_hashes) && manifest.review_receipt_hashes.length > 0
  );
  const requiredCapabilities = [
    "capture",
    ...(requiresAuth ? ["auth", "test_account_safe"] : []),
    ...(requiresReview ? ["independent_review"] : [])
  ];
  for (const capability of requiredCapabilities) {
    const code = capabilityCodes[capability];
    if (manifest?.capabilities?.[capability] !== true) capabilityBlocks.push(code);
  }
  if (capabilityBlocks.length > 0) {
    return {
      code: capabilityBlocks[0],
      codes: capabilityBlocks,
      validation,
      verdict: "BLOCKED"
    };
  }
  if (!validation.valid) return blocked("BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH", { validation });
  if (beta) {
    const descriptorError = descriptorCoverageError(manifest, descriptorOwnership);
    if (descriptorError !== undefined) {
      return blocked("BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH", { reason: descriptorError });
    }
  }
  if (designContract === undefined || !Array.isArray(reviewReceipts)) {
    return blocked("BLOCKED_REVIEW_RECONCILIATION");
  }
  const contractValidation = validateDesignContract(designContract);
  if (!contractValidation.valid || (beta && contractValidation.evidence_eligible !== true)) {
    return blocked("BLOCKED_INVENTORY_RECONCILIATION", { reason: contractValidation.issues.join("; ") });
  }
  if (hashCanonicalValue(designContract) !== manifest.design_contract_hash) {
    return blocked("BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH");
  }
  if (beta) {
    let sourceHash;
    try {
      sourceHash = hashBytes(sourceBytes);
    } catch {
      return blocked("BLOCKED_IMMUTABLE_INPUT_MISMATCH");
    }
    if (designContract.source_hash !== sourceHash.slice("sha256:".length)) {
      return blocked("BLOCKED_IMMUTABLE_INPUT_MISMATCH");
    }
    if (designContract.evidence_policy.independent_review_required === true) {
      return blocked("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
    }
  }
  const exceptions = referencedExceptions(manifest, designContract, now);
  if (!exceptions.valid) return blocked("BLOCKED_EXCEPTION_RECONCILIATION");
  const currentExceptionIds = new Set(exceptions.values.map((item) => item.id));
  if (
    manifest.inventory.some(
      (item) =>
        item.status === "accepted_exception" &&
        (!manifest.exception_references.includes(item.exception_id) || !currentExceptionIds.has(item.exception_id))
    )
  ) return blocked("BLOCKED_EXCEPTION_RECONCILIATION");
  if (beta && manifest.tier !== "smoke") {
    // OpenCode does not currently expose a host-origin attestation for reviewer output.
    // Model-authored receipt JSON is self-attested and cannot unlock higher-tier PASS.
    return blocked("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
  }
  const review = beta && manifest.tier === "smoke" && reviewReceipts.length === 0
    ? { independent: false, verdict: "PASS" }
    : validateReviewIndependence(reviewReceipts, {
      acceptedExceptions: exceptions.values,
      maximumAgeSeconds: manifest.maximum_age_seconds,
      now
    });
  // A missing or unusable review is BLOCKED; a review that ran and rejected the
  // work is FAIL and keeps its own code, because telling the user a capability was
  // absent when a reviewer actually said no would hide a real defect.
  if (review.verdict === "BLOCKED") return blocked(review.code, { review });
  if (review.verdict !== "PASS") return { code: review.code, review, verdict: review.verdict };
  if (beta && !canonicalManifestBytesMatch(manifest, evidenceManifestBytes)) {
    return blocked("BLOCKED_IMMUTABLE_INPUT_MISMATCH");
  }
  let materialArtifacts = captureArtifacts;
  if (beta) {
    try {
      const material = materialEvidenceArtifacts(manifest, descriptorOwnership.descriptors);
      materialArtifacts = material.artifacts;
      const missingChannels = designContract.evidence_policy.required_channels.filter(
        (channel) => evidenceChannels.includes(channel) && !material.passingChannels.has(channel)
      );
      if (missingChannels.length > 0) {
        return blocked("BLOCKED_INVENTORY_RECONCILIATION", { missingChannels });
      }
    } catch (error) {
      return blocked("BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH", {
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  const immutable = immutableResult(manifest, {
    captureArtifacts: materialArtifacts,
    evidenceManifestBytes,
    reviewReceipts,
    sourceBytes
  });
  if (!immutable.valid) return blocked("BLOCKED_IMMUTABLE_INPUT_MISMATCH");
  const expectedReceipts = new Set(manifest.review_receipt_hashes);
  const actualReceipts = reviewReceipts.map(hashCanonicalValue);
  if (
    actualReceipts.length !== expectedReceipts.size ||
    actualReceipts.some((hash) => !expectedReceipts.has(hash))
  ) return blocked("BLOCKED_REVIEW_RECONCILIATION");
  const reconciliation = inventoryResult(manifest, designContract, reviewReceipts);
  if (reconciliation.contractMismatches.length > 0 || reconciliation.receiptMismatches.length > 0) {
    return blocked("BLOCKED_INVENTORY_RECONCILIATION", { reconciliation });
  }
  const freshness = freshnessCode(manifest, now);
  if (freshness !== undefined) return blocked(freshness);
  if (
    !manifest.freshness.fresh ||
    !manifest.freshness.contract_hash_match ||
    !manifest.freshness.source_hash_match ||
    !manifest.freshness.capture_hash_match
  ) return blocked("BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH");
  // An incomplete cleanup receipt means safe termination or safe removal could not
  // be carried out, so the run has no trustworthy end state. That is an absent
  // capability, not a revision request, and it outranks any finding below.
  if (
    !manifest.cleanup.owned_processes_stopped ||
    !manifest.cleanup.temporary_artifacts_removed ||
    manifest.cleanup.remaining.length > 0
  ) return blocked("BLOCKED_CLEANUP_INCOMPLETE", { cleanup: manifest.cleanup });
  const missingKinds = tierInventory[manifest.tier].filter(
    (kind) => !manifest.inventory.some((item) => item.kind === kind)
  );
  const incomplete =
    missingKinds.length > 0 ||
    manifest.inventory.some((item) => item.status === "blocked") ||
    [...manifest.mechanical_checks, ...manifest.accessibility_checks, ...manifest.tui_checks].some(
      (item) => item.status === "fail" || item.status === "blocked"
    );
  if (incomplete) return { code: "EVIDENCE_INCOMPLETE", missingKinds, verdict: "REVISE" };
  if (manifest.findings.some((finding) => !findingAccepted(finding, exceptions.values))) {
    return { code: "UNACCEPTED_GATING_FINDING", verdict: "REVISE" };
  }
  if (manifest.verdict !== "PASS") {
    return { code: "DECLARED_NON_PASS", declaredVerdict: manifest.verdict, verdict: manifest.verdict };
  }
  if (!beta) {
    return blocked("BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH", {
      diagnostics: ["LEGACY_SCHEMA_V1ALPHA1"],
      evidence_eligible: false
    });
  }
  return { codes: [], evidence_eligible: beta, verdict: "PASS" };
}

export function evaluateEvidenceManifest(manifest, options = {}) {
  const normalizedOptions = options !== null && typeof options === "object" ? options : {};
  let materialFileDescriptors;
  try {
    materialFileDescriptors = normalizedOptions.materialFileDescriptors;
  } catch (error) {
    return blocked("BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH", {
      reason: `material descriptor path open failed: ${
        error instanceof Error ? error.message : "material descriptors could not be opened"
      }`
    });
  }
  const descriptorOwnership = registerTransferredDescriptors(materialFileDescriptors);
  try {
    return evaluateEvidenceManifestOwned(manifest, normalizedOptions, descriptorOwnership);
  } finally {
    descriptorOwnership.close();
  }
}
