// Blocked and failed vocabulary for this skill.
//
// A BLOCKED code always names a capability that was absent, so the honest answer
// is "this could not be checked". A FAIL code names a check that ran and rejected
// the work. BLOCKED outranks FAIL: when a capability is missing there is no
// completed judgement to report, so the absent capability is reported first.
export const visualQaBlockedCodes = Object.freeze([
  "BLOCKED_RELEASE_BOUNDARY_UNRESOLVED",
  "BLOCKED_SOURCE_PROVENANCE_INVALID",
  "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH",
  "BLOCKED_RENDERER_UNAVAILABLE",
  "BLOCKED_AUTH_UNAVAILABLE",
  "BLOCKED_TEST_ACCOUNT_UNSAFE",
  "BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED",
  "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
  "BLOCKED_REVIEW_TIMEOUT",
  "BLOCKED_REVIEW_CANCELLED",
  "BLOCKED_REVIEW_RECONCILIATION",
  "BLOCKED_INVENTORY_RECONCILIATION",
  "BLOCKED_EXCEPTION_RECONCILIATION",
  "BLOCKED_IMMUTABLE_INPUT_MISMATCH",
  "BLOCKED_EVIDENCE_STALE",
  "BLOCKED_EVIDENCE_FUTURE",
  "BLOCKED_CLEANUP_INCOMPLETE"
]);

export const visualQaFailCodes = Object.freeze([
  "FAIL_REVIEW_VERDICT",
  "FAIL_REVIEW_GATING_FINDING"
]);

export function evaluateCapabilityBlocks(input = {}) {
  const codes = [];
  if (input.captureAvailable !== true) codes.push("BLOCKED_RENDERER_UNAVAILABLE");
  if (input.authAvailable !== true) codes.push("BLOCKED_AUTH_UNAVAILABLE");
  if (input.testAccountSafe !== true) codes.push("BLOCKED_TEST_ACCOUNT_UNSAFE");
  if (input.independentReviewAvailable !== true) codes.push("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
  return {
    codes,
    verdict: codes.length === 0 ? "READY" : "BLOCKED"
  };
}

// Renderer ownership is the gate in front of every reuse decision. A port that
// answers, a familiar process name, or a configured backend is not identity, so
// each element has to be proven for the current session and project before
// evidence that renderer produced can be attributed to this run. An unproven
// element is an absent capability, never a defect in the interface under review.
export function evaluateRendererOwnership(input = {}) {
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  const unproven = [];
  if (!text(input.sessionId)) unproven.push("sessionId");
  if (!text(input.projectRoot)) unproven.push("projectRoot");
  if (!Number.isInteger(input.pid) || input.pid <= 0) unproven.push("pid");
  if (!text(input.command)) unproven.push("command");
  if (input.port !== undefined && !(Number.isInteger(input.port) && input.port > 0 && input.port <= 65535)) {
    unproven.push("port");
  }
  if (input.sessionScoped !== true) unproven.push("sessionScoped");
  const codes = unproven.length === 0 ? [] : ["BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED"];
  return {
    codes,
    unproven,
    verdict: codes.length === 0 ? "READY" : "BLOCKED"
  };
}
