const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const inputKeys = ["design_contract", "evidence_manifest", "source", "capture"];

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

// BLOCKED means a capability the review needed was absent: no second reviewer, a
// review that never finished, or bytes that could not be trusted. FAIL means the
// review ran to completion and rejected the work. The two are not
// interchangeable, because a BLOCKED receipt asks for a capability while a FAIL
// receipt asks for a fix. BLOCKED outranks FAIL, so every absent-capability check
// below runs before the two verdict checks.
function blocked(code, reason) {
  return { code, independent: false, reason, verdict: "BLOCKED" };
}

function failed(code, reason) {
  return { code, independent: true, reason, verdict: "FAIL" };
}

function exact(value, keys) {
  return object(value) && Object.keys(value).every((key) => keys.includes(key));
}

function validFinding(finding) {
  return (
    exact(finding, ["code", "severity", "evidence_pointers", "message"]) &&
    typeof finding.code === "string" &&
    finding.code.length > 0 &&
    ["critical", "high", "medium", "low", "info"].includes(finding.severity) &&
    typeof finding.message === "string" &&
    finding.message.length > 0 &&
    Array.isArray(finding.evidence_pointers) &&
    finding.evidence_pointers.length > 0 &&
    finding.evidence_pointers.every(
      (pointer) =>
        exact(pointer, ["path", "hash"]) &&
        typeof pointer.path === "string" &&
        pointer.path.length > 0 &&
        hashPattern.test(pointer.hash)
    )
  );
}

export function validateReviewReceipt(receipt) {
  const errors = [];
  if (!object(receipt)) return { ok: false, errors: ["receipt must be an object"] };
  const receiptKeys = [
    "schema_id", "review_id", "reviewer_id", "fresh_context_id", "reviewer_capability_class",
    "input_hashes", "reviewed_inventory", "findings", "confidence", "independence_assertion",
    "started_at", "ended_at", "timeout_seconds", "timed_out", "cancelled", "cancellation_reason",
    "round", "verdict"
  ];
  if (!exact(receipt, receiptKeys)) errors.push("receipt contains unknown fields");
  if (receipt.schema_id !== "litfamily.review-receipt/v1alpha1") errors.push("schema_id must be exact v1alpha1");
  for (const field of ["review_id", "reviewer_id", "fresh_context_id", "reviewer_capability_class"]) {
    if (typeof receipt[field] !== "string" || receipt[field].length === 0) errors.push(`${field} is required`);
  }
  if (
    !exact(receipt.input_hashes, inputKeys) ||
    inputKeys.some((key) => !hashPattern.test(receipt.input_hashes[key]))
  ) {
    errors.push("input_hashes must contain all immutable hashes");
  }
  if (
    !Array.isArray(receipt.reviewed_inventory) ||
    receipt.reviewed_inventory.length === 0 ||
    receipt.reviewed_inventory.length > 10000 ||
    receipt.reviewed_inventory.some(
      (item) =>
        !exact(item, ["id", "kind", "status"]) ||
        typeof item.id !== "string" ||
        item.id.length === 0 ||
        typeof item.kind !== "string" ||
        item.kind.length === 0 ||
        !["captured", "not_applicable", "accepted_exception", "blocked"].includes(item.status)
    ) ||
    new Set(receipt.reviewed_inventory.map((item) => item.id)).size !== receipt.reviewed_inventory.length
  ) errors.push("reviewed_inventory must be finite, non-empty, and unique");
  if (
    !Array.isArray(receipt.findings) ||
    receipt.findings.length > 10000 ||
    receipt.findings.some((finding) => !validFinding(finding))
  ) errors.push("findings must be finite and contain evidence pointers");
  if (!Number.isFinite(receipt.confidence) || receipt.confidence < 0 || receipt.confidence > 1) {
    errors.push("confidence must be between zero and one");
  }
  const assertion = receipt.independence_assertion;
  if (
    !exact(assertion, ["fresh_context", "same_immutable_inputs", "other_draft_received", "other_verdict_received"]) ||
    assertion.fresh_context !== true ||
    assertion.same_immutable_inputs !== true ||
    assertion.other_draft_received !== false ||
    assertion.other_verdict_received !== false
  ) errors.push("independence_assertion must exactly attest independent context");
  const started = timestamp(receipt.started_at);
  const ended = timestamp(receipt.ended_at);
  if (started === undefined || ended === undefined || ended < started) errors.push("review timestamps are invalid");
  if (!Number.isFinite(receipt.timeout_seconds) || receipt.timeout_seconds <= 0 || receipt.timeout_seconds > 3600) {
    errors.push("timeout_seconds must be finite and bounded");
  } else if (started !== undefined && ended !== undefined && ended - started > receipt.timeout_seconds * 1000) {
    errors.push("review elapsed time exceeds timeout_seconds");
  }
  if (typeof receipt.timed_out !== "boolean" || typeof receipt.cancelled !== "boolean") {
    errors.push("timed_out and cancelled must be boolean");
  }
  if (
    receipt.cancelled &&
    (typeof receipt.cancellation_reason !== "string" || receipt.cancellation_reason.length === 0)
  ) errors.push("cancelled review requires cancellation_reason");
  if (!receipt.cancelled && receipt.cancellation_reason !== null) {
    errors.push("active review cancellation_reason must be null");
  }
  if (!Number.isInteger(receipt.round) || receipt.round < 1 || receipt.round > 2) {
    errors.push("round must be one or two");
  }
  if (!["PASS", "REVISE", "FAIL", "BLOCKED"].includes(receipt.verdict)) errors.push("verdict is invalid");
  return { ok: errors.length === 0, errors };
}

function sameInputs(first, second) {
  return inputKeys.every((key) => first.input_hashes[key] === second.input_hashes[key]);
}

export function validateReviewIndependence(
  receipts,
  { acceptedExceptions = [], now = new Date().toISOString(), maximumAgeSeconds = 600 } = {}
) {
  if (!Array.isArray(receipts) || receipts.length !== 2) {
    return blocked("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE", "exactly two fresh review receipts are required");
  }
  const validations = receipts.map(validateReviewReceipt);
  if (receipts.some((receipt) => receipt?.timed_out === true)) {
    return blocked("BLOCKED_REVIEW_TIMEOUT", "an independent review timed out");
  }
  if (receipts.some((receipt) => receipt?.cancelled === true)) {
    return blocked("BLOCKED_REVIEW_CANCELLED", "an independent review was cancelled");
  }
  if (validations.some((result) => !result.ok)) {
    return blocked("BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH", "a review receipt is invalid");
  }
  const [first, second] = receipts;
  if (
    first.review_id === second.review_id ||
    first.reviewer_id === second.reviewer_id ||
    first.fresh_context_id === second.fresh_context_id ||
    first.reviewer_capability_class === second.reviewer_capability_class
  ) return blocked("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE", "review identities, contexts, and capabilities must differ");
  if (!sameInputs(first, second)) {
    return blocked("BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH", "reviewers must inspect identical immutable inputs");
  }
  const nowTime = timestamp(now);
  if (
    nowTime === undefined ||
    receipts.some((receipt) => {
      const ended = timestamp(receipt.ended_at);
      return ended === undefined || nowTime < ended || nowTime - ended > maximumAgeSeconds * 1000;
    })
  ) return blocked("BLOCKED_EVIDENCE_STALE", "review receipts are stale");
  if (receipts.some((receipt) => receipt.verdict !== "PASS")) {
    return failed("FAIL_REVIEW_VERDICT", "both independent review receipts must declare PASS");
  }
  const gatingFindings = receipts.flatMap((receipt) =>
    receipt.findings.filter((finding) => ["critical", "high"].includes(finding.severity))
  );
  // An exception only forgives while it is still current. This filter lives here, not in the caller,
  // because this function is an exported entry point with a permissive default: a caller that hands
  // it raw contract.accepted_exceptions -- the obvious thing to pass -- would otherwise have an
  // undated or long-expired exception silently forgive a critical finding and return PASS.
  const currentExceptions = acceptedExceptions.filter((exception) => {
    const expiry = timestamp(exception?.expires_at);
    return expiry !== undefined && nowTime <= expiry;
  });
  if (
    gatingFindings.some(
      (finding) => !currentExceptions.some((exception) => exception.id === finding.code)
    )
  ) {
    return failed("FAIL_REVIEW_GATING_FINDING", "an independent review reports an unaccepted gating finding");
  }
  return { independent: true, verdict: "PASS" };
}
