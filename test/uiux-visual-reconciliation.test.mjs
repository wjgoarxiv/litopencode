import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  createBetaMaterialEvidence,
  validBetaDesignContract,
  validDesignContract,
  validEvidenceManifest,
  validReviewReceipt
} from "../test-support/uiux-visual-fixtures.mjs";
import { validateDesignContract } from "../skills/frontend-ui-ux/scripts/design-contract.mjs";
import { validateDesignContract as validateVisualDesignContract } from "../skills/visual-qa/scripts/design-contract.mjs";
import * as visualQa from "../skills/visual-qa/scripts/visual-qa.mjs";

function buildBundle() {
  const designContract = validDesignContract();
  const manifest = validEvidenceManifest({ contract: designContract });
  designContract.accepted_exceptions = [];
  const sourceBytes = Buffer.from("source revision bytes");
  const captureArtifacts = [{ capture_id: "capture/one", bytes: Buffer.from("capture artifact bytes") }];
  manifest.captures[0].source_hash = visualQa.hashBytes(sourceBytes);
  manifest.captures[0].capture_hash = visualQa.hashBytes(captureArtifacts[0].bytes);
  const reviewed = manifest.inventory.map(({ id, kind, status }) => ({ id, kind, status }));
  const reviewReceipts = [
    validReviewReceipt({ id: "review-a", reviewerId: "reviewer-a", contextId: "context-a" }),
    validReviewReceipt({
      id: "review-b",
      reviewerId: "reviewer-b",
      contextId: "context-b",
      capabilityId: "visual-reviewer-b"
    })
  ];
  for (const receipt of reviewReceipts) receipt.reviewed_inventory = structuredClone(reviewed);
  const evidenceManifestBytes = Buffer.from("immutable evidence manifest review input");
  const bundle = {
    now: "2026-07-24T00:05:00.000Z",
    captureArtifacts,
    designContract,
    evidenceManifestBytes,
    reviewReceipts,
    sourceBytes
  };
  seal(manifest, bundle);
  return { bundle, manifest };
}

function seal(manifest, bundle) {
  manifest.design_contract_hash = visualQa.hashCanonicalValue(bundle.designContract);
  const inputHashes = {
    capture: visualQa.hashCaptureArtifacts(bundle.captureArtifacts),
    design_contract: manifest.design_contract_hash,
    evidence_manifest: visualQa.hashBytes(bundle.evidenceManifestBytes),
    source: visualQa.hashBytes(bundle.sourceBytes)
  };
  for (const receipt of bundle.reviewReceipts) receipt.input_hashes = { ...inputHashes };
  manifest.review_receipt_hashes = bundle.reviewReceipts.map(visualQa.hashCanonicalValue);
}

function alignReviewedInventory(manifest, bundle) {
  const reviewed = manifest.inventory.map(({ id, kind, status }) => ({ id, kind, status }));
  for (const receipt of bundle.reviewReceipts) receipt.reviewed_inventory = structuredClone(reviewed);
  seal(manifest, bundle);
}

test("visualqa.exact-immutable-input-and-inventory-reconciliation", () => {
  const { bundle, manifest } = buildBundle();
  assert.equal(visualQa.evaluateEvidenceManifest(manifest, bundle).code, "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH");

  for (const field of ["design_contract", "evidence_manifest", "source", "capture"]) {
    const changed = structuredClone(bundle.reviewReceipts);
    changed[0].input_hashes[field] = `sha256:${"0".repeat(64)}`;
    const result = visualQa.evaluateEvidenceManifest(manifest, { ...bundle, reviewReceipts: changed });
    assert.notEqual(result.verdict, "PASS", `${field} mismatch must not PASS`);
  }

  const swapped = structuredClone(manifest);
  const route = swapped.inventory.find((item) => item.kind === "route");
  const screen = swapped.inventory.find((item) => item.kind === "screen");
  [route.kind, screen.kind] = [screen.kind, route.kind];
  assert.equal(
    visualQa.evaluateEvidenceManifest(swapped, bundle).code,
    "BLOCKED_INVENTORY_RECONCILIATION"
  );

  const receiptStatusMismatch = structuredClone(bundle.reviewReceipts);
  receiptStatusMismatch[0].reviewed_inventory[0].status = "accepted_exception";
  const receiptStatusManifest = structuredClone(manifest);
  receiptStatusManifest.review_receipt_hashes = receiptStatusMismatch.map(visualQa.hashCanonicalValue);
  assert.equal(
    visualQa.evaluateEvidenceManifest(
      receiptStatusManifest,
      { ...bundle, reviewReceipts: receiptStatusMismatch }
    ).code,
    "BLOCKED_INVENTORY_RECONCILIATION"
  );
});

test("visualqa.v1alpha1 remains diagnostic and can never return PASS", () => {
  const { bundle, manifest } = buildBundle();
  const result = visualQa.evaluateEvidenceManifest(manifest, bundle);
  assert.notEqual(result.verdict, "PASS");
  assert.equal(result.evidence_eligible, false);
  assert.ok(result.diagnostics?.includes("LEGACY_SCHEMA_V1ALPHA1"));
});

test("beta Design Contract validators enforce every schema text field at 1..512 characters", () => {
  const textFields = [
    ["tokens.value", (contract, value) => { contract.tokens[0].value = value; }],
    ["tokens.usage", (contract, value) => { contract.tokens[0].usage = value; }],
    ["component_behaviors.keyboard_behavior", (contract, value) => { contract.component_behaviors[0].keyboard_behavior = value; }],
    ["responsive_transformations.behavior", (contract, value) => { contract.responsive_transformations[0].behavior = value; }],
    ["motion.reduced_motion_behavior", (contract, value) => { contract.motion.reduced_motion_behavior = value; }],
    ["motion.transitions.easing", (contract, value) => { contract.motion.transitions[0].easing = value; }],
    ["acceptance_criteria.observable", (contract, value) => { contract.acceptance_criteria[0].observable = value; }]
  ];
  for (const [validatorName, validator] of [
    ["frontend-ui-ux", validateDesignContract],
    ["visual-qa", validateVisualDesignContract]
  ]) {
    for (const [field, set] of textFields) {
      const boundary = validBetaDesignContract();
      set(boundary, "x".repeat(512));
      assert.equal(validator(boundary).valid, true, `${validatorName} must accept ${field} at 512 characters`);
      for (const [label, value] of [
        ["empty", ""],
        ["multiline", "line one\nline two"],
        ["513 characters", "x".repeat(513)]
      ]) {
        const invalid = validBetaDesignContract();
        set(invalid, value);
        assert.equal(validator(invalid).valid, false, `${validatorName} must reject ${field} at ${label}`);
      }
    }
  }
});

test("visualqa.smoke capabilities follow the requested inventory while higher tiers require host review provenance", () => {
  const root = fs.mkdtempSync("/tmp/litopencode-tiered-capabilities-");
  try {
    const smoke = createBetaMaterialEvidence(visualQa, root);
    assert.deepEqual(visualQa.evaluateEvidenceManifest(smoke.manifest, smoke.bundle), {
      codes: [], evidence_eligible: true, verdict: "PASS"
    });

    for (const tier of ["full", "reference-fidelity"]) {
      const candidate = createBetaMaterialEvidence(visualQa, root, { tier });
      candidate.manifest.capabilities.independent_review = true;
      candidate.manifest.review_receipt_hashes = [
        `sha256:${"e".repeat(64)}`,
        `sha256:${"f".repeat(64)}`
      ];
      const result = visualQa.evaluateEvidenceManifest(candidate.manifest, candidate.bundle);
      assert.equal(result.verdict, "BLOCKED");
      assert.equal(result.code, "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("visualqa.evidence-v1beta1 binds a material PNG and blocks self-attested full review", async () => {
  const schemaPath = "skills/visual-qa/schemas/evidence-manifest-v1beta1.json";
  assert.equal(JSON.parse(fs.readFileSync(schemaPath, "utf8")).$id, "litfamily.evidence-manifest/v1beta1");
  const root = fs.mkdtempSync("/tmp/litopencode-beta-evidence-");
  try {
    const candidate = createBetaMaterialEvidence(visualQa, root);
    const { bundle, captureBytes, manifest } = candidate;
    assert.deepEqual(visualQa.evaluateEvidenceManifest(manifest, bundle), {
      codes: [], evidence_eligible: true, verdict: "PASS"
    });

    const capturePathPattern = new RegExp(
      JSON.parse(fs.readFileSync(schemaPath, "utf8")).$defs.materialPath.pattern
    );
    const invalidCapturePaths = [
      path.join(root, "captures", "primary.png"),
      `../${path.basename(root)}/captures/primary.png`,
      "nested/primary.png",
      "captures\\primary.png",
      "C:captures/primary.png",
      ""
    ];
    for (const capturePath of invalidCapturePaths) {
      const changed = structuredClone(manifest);
      changed.captures[0].path = capturePath;
      assert.equal(capturePathPattern.test(capturePath), false, `schema must reject ${JSON.stringify(capturePath)}`);
      assert.equal(visualQa.validateEvidenceManifest(changed).valid, false, `runtime schema must reject ${JSON.stringify(capturePath)}`);
      const result = visualQa.evaluateEvidenceManifest(changed, bundle);
      assert.equal(result.code, "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH");
      assert.notEqual(result.verdict, "PASS");
    }

    for (const capturePath of ["missing.png", "nested/missing.png", "../outside.png"]) {
      const changed = structuredClone(manifest);
      changed.captures[0].path = capturePath;
      assert.notEqual(visualQa.evaluateEvidenceManifest(changed, bundle).verdict, "PASS");
    }

    const nonImage = structuredClone(manifest);
    fs.writeFileSync(path.join(root, manifest.captures[0].path), "not a png");
    nonImage.captures[0].capture_hash = visualQa.hashBytes(Buffer.from("not a png"));
    nonImage.captures[0].byte_length = Buffer.byteLength("not a png");
    assert.notEqual(visualQa.evaluateEvidenceManifest(nonImage, bundle).verdict, "PASS");

    fs.writeFileSync(path.join(root, manifest.captures[0].path), captureBytes);
    const unavailable = structuredClone(manifest);
    unavailable.capabilities.capture = false;
    assert.ok(visualQa.evaluateEvidenceManifest(unavailable, bundle).codes.includes("BLOCKED_RENDERER_UNAVAILABLE"));

    const selfAttested = structuredClone(manifest);
    selfAttested.tier = "full";
    selfAttested.review_receipt_hashes = [`sha256:${"e".repeat(64)}`, `sha256:${"f".repeat(64)}`];
    assert.equal(visualQa.evaluateEvidenceManifest(selfAttested, bundle).code, "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("visualqa.gating-findings-require-current-owned-referenced-exception", () => {
  const { bundle, manifest } = buildBundle();
  // A gating finding names the accepted exception that forgives it, so the
  // finding code and the Design Contract exception id are the same identifier.
  manifest.findings = [{
    code: "exception:high-defect",
    severity: "high",
    evidence: [`sha256:${"8".repeat(64)}`]
  }];
  assert.notEqual(visualQa.evaluateEvidenceManifest(manifest, bundle).verdict, "PASS");

  bundle.designContract.accepted_exceptions = [{
    id: "exception:high-defect",
    reason: "Time-bounded approved deviation.",
    owner: "design-owner",
    expires_at: "2026-07-25T00:00:00.000Z"
  }];
  manifest.exception_references = ["exception:high-defect"];
  seal(manifest, bundle);
  assert.equal(visualQa.evaluateEvidenceManifest(manifest, bundle).code, "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH");

  for (const mutation of [
    (contract) => { contract.accepted_exceptions[0].owner = ""; },
    (contract) => { contract.accepted_exceptions[0].expires_at = "2026-07-23T00:00:00.000Z"; },
    (_contract, value) => { value.exception_references = ["exception:unknown"]; }
  ]) {
    const value = structuredClone(manifest);
    const contract = structuredClone(bundle.designContract);
    mutation(contract, value);
    const changedBundle = { ...bundle, designContract: contract };
    seal(value, changedBundle);
    assert.notEqual(visualQa.evaluateEvidenceManifest(value, changedBundle).verdict, "PASS");
  }
});

test("visualqa.runtime-schema-conformance-shares-bounds-and-uniqueness", () => {
  const schema = JSON.parse(
    fs.readFileSync("skills/visual-qa/schemas/evidence-manifest-v1alpha1.json", "utf8")
  );
  const designSchema = JSON.parse(
    fs.readFileSync("skills/frontend-ui-ux/schemas/design-contract-v1alpha1.json", "utf8")
  );
  assert.equal(schema.properties.maximum_age_seconds.maximum, 86400);
  assert.equal(schema.properties.exception_references.uniqueItems, true);
  // The dataset-free contract records a deviation as id/reason/owner with an
  // optional expiry; expiry strictness is enforced by the validator, not here.
  for (const field of ["id", "reason", "owner"]) {
    assert.ok(designSchema.$defs.deviation.required.includes(field));
  }
  assert.equal(designSchema.$defs.deviation.required.includes("expires_at"), false);
  assert.equal(designSchema.$defs.deviation.additionalProperties, false);
  const { manifest } = buildBundle();
  manifest.maximum_age_seconds = 86401;
  assert.equal(visualQa.validateEvidenceManifest(manifest).valid, false);
  const duplicate = validEvidenceManifest();
  duplicate.exception_references = ["exception:a", "exception:a"];
  assert.equal(visualQa.validateEvidenceManifest(duplicate).valid, false);
});

test("visualqa.accepted-exception-inventory-requires-exact-current-reference", () => {
  const unlinked = buildBundle();
  unlinked.manifest.inventory[0].status = "accepted_exception";
  alignReviewedInventory(unlinked.manifest, unlinked.bundle);
  assert.notEqual(
    visualQa.evaluateEvidenceManifest(unlinked.manifest, unlinked.bundle).verdict,
    "PASS",
    "accepted_exception status without an exact exception link must not PASS"
  );

  const linked = buildBundle();
  linked.manifest.inventory[0].status = "accepted_exception";
  linked.manifest.inventory[0].exception_id = "exception:route-inventory";
  linked.manifest.exception_references = ["exception:route-inventory"];
  linked.bundle.designContract.accepted_exceptions = [{
    id: "exception:route-inventory",
    reason: "Temporary route inventory deviation.",
    owner: "route-owner",
    expires_at: "2026-07-25T00:00:00.000Z"
  }];
  alignReviewedInventory(linked.manifest, linked.bundle);
  assert.equal(
    visualQa.evaluateEvidenceManifest(linked.manifest, linked.bundle).code,
    "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH"
  );

  const missingReference = structuredClone(linked.manifest);
  missingReference.exception_references = [];
  assert.notEqual(
    visualQa.evaluateEvidenceManifest(missingReference, linked.bundle).verdict,
    "PASS"
  );
  const expiredBundle = structuredClone(linked.bundle);
  expiredBundle.designContract.accepted_exceptions[0].expires_at = "2026-07-23T00:00:00.000Z";
  const expiredManifest = structuredClone(linked.manifest);
  alignReviewedInventory(expiredManifest, expiredBundle);
  assert.notEqual(
    visualQa.evaluateEvidenceManifest(expiredManifest, expiredBundle).verdict,
    "PASS"
  );
});

test("uiux.design-contract-all-id-bearing-categories-are-globally-unique", async (t) => {
  const inventoryCategories = ["routes", "regions", "components", "interactions", "states", "viewports", "references"];

  for (const category of inventoryCategories) {
    await t.test(`inventory.${category} rejects an intra-category duplicate`, () => {
      const contract = validDesignContract();
      contract.inventory[category].push(structuredClone(contract.inventory[category][0]));
      const result = validateDesignContract(contract);
      assert.equal(result.valid, false);
      assert.ok(result.issues.some((issue) => /unique/i.test(issue)), result.issues.join("; "));
    });
  }
  for (const category of ["omissions", "accepted_exceptions"]) {
    await t.test(`${category} rejects an intra-category duplicate`, () => {
      const contract = validDesignContract();
      contract[category].push(structuredClone(contract[category][0]));
      const result = validateDesignContract(contract);
      assert.equal(result.valid, false);
      assert.ok(result.issues.some((issue) => /unique/i.test(issue)), result.issues.join("; "));
    });
  }
  // Mandatory typed prefixes stop cross-inventory collisions structurally, so
  // global uniqueness has to be proven where prefixes are free: deviation ids.
  for (const [label, borrow] of [
    ["an inventory id", (contract) => contract.inventory.routes[0].id],
    ["the contract id", (contract) => contract.contract_id],
    ["an omission id", (contract) => contract.omissions[0].id]
  ]) {
    await t.test(`accepted_exceptions may not reuse ${label}`, () => {
      const contract = validDesignContract();
      contract.accepted_exceptions[0].id = borrow(contract);
      const result = validateDesignContract(contract);
      assert.equal(result.valid, false);
      assert.ok(result.issues.some((issue) => /unique/i.test(issue)), result.issues.join("; "));
    });
  }
});

// A gating finding one reviewer raised, in the shape a review receipt requires.
function gatingReceiptFinding(code) {
  return {
    code,
    severity: "critical",
    message: "a gating finding",
    evidence_pointers: [{ path: "capture/one", hash: visualQa.hashBytes(Buffer.from("finding evidence")) }]
  };
}

function reviewPair(code) {
  const hashes = {
    capture: visualQa.hashBytes(Buffer.from("c")),
    design_contract: visualQa.hashBytes(Buffer.from("d")),
    evidence_manifest: visualQa.hashBytes(Buffer.from("e")),
    source: visualQa.hashBytes(Buffer.from("s"))
  };
  return [
    validReviewReceipt({ id: "review-a", reviewerId: "reviewer-a", contextId: "context-a" }),
    validReviewReceipt({ id: "review-b", reviewerId: "reviewer-b", contextId: "context-b", capabilityId: "visual-reviewer-b" })
  ].map((receipt) => ({ ...receipt, input_hashes: { ...hashes }, findings: [gatingReceiptFinding(code)] }));
}

test("visualqa.review-independence-refuses-an-undated-or-expired-exception-on-the-direct-call-path", () => {
  const now = "2026-07-24T00:05:00.000Z";
  const code = "exception:legacy-chart";
  const base = { id: code, reason: "Chart migration is staged.", owner: "design" };
  const call = (acceptedExceptions) =>
    visualQa.validateReviewIndependence(structuredClone(reviewPair(code)), { acceptedExceptions, now });

  // The exact abuse: a caller hands the function raw contract.accepted_exceptions -- the obvious
  // thing to pass -- carrying an exception whose id matches a critical finding.
  assert.notEqual(call([{ ...base }]).verdict, "PASS", "an UNDATED exception must not forgive a gating finding");
  assert.equal(call([{ ...base }]).code, "FAIL_REVIEW_GATING_FINDING");
  assert.notEqual(
    call([{ ...base, expires_at: "2020-01-01T00:00:00.000Z" }]).verdict,
    "PASS",
    "an EXPIRED exception must not forgive a gating finding"
  );
  assert.notEqual(call([{ ...base, expires_at: "not-a-date" }]).verdict, "PASS", "an unparseable expiry must not forgive");
  assert.notEqual(call(undefined).verdict, "PASS", "the permissive [] default must forgive nothing");

  // The guard must not break legitimate forgiveness.
  assert.equal(call([{ ...base, expires_at: "2026-12-31T00:00:00.000Z" }]).verdict, "PASS");

  // The guard lives inside the function, so the guarantee does not depend on the caller. Proven by
  // reproducing the old behaviour here: matching on id alone would have accepted every row above.
  const idOnlyMatch = (exceptions) => exceptions.some((exception) => exception.id === code);
  assert.equal(idOnlyMatch([{ ...base }]), true, "id-only matching is what the guard replaced");
});

test("visualqa.composed-path-is-unchanged-and-names-the-layer-that-rejected", () => {
  const code = "exception:legacy-chart";
  const dated = { id: code, reason: "Chart migration is staged.", owner: "design", expires_at: "2026-12-31T00:00:00.000Z" };

  function evaluate(exception) {
    const { bundle, manifest } = buildBundle();
    bundle.designContract.accepted_exceptions = exception === undefined ? [] : [exception];
    manifest.findings = [{ code, severity: "critical", evidence: [visualQa.hashBytes(Buffer.from("finding evidence"))] }];
    manifest.exception_references = exception === undefined ? [] : [exception.id];
    for (const receipt of bundle.reviewReceipts) receipt.findings = [gatingReceiptFinding(code)];
    seal(manifest, bundle);
    return visualQa.evaluateEvidenceManifest(manifest, bundle);
  }

  // A current, referenced exception reaches only the alpha diagnostic boundary; it can no longer PASS.
  assert.equal(evaluate(dated).code, "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH");

  // LAYER 1 — the CONTRACT layer. Now that expires_at is required on an accepted exception, an
  // undated one makes the contract itself invalid, so evidence-evaluate.mjs rejects it at its
  // validateDesignContract call, which runs before the exception reconciliation check. The block
  // carries the specific reason rather than a bare code.
  const undated = evaluate({ id: code, reason: "Chart migration is staged.", owner: "design" });
  assert.equal(undated.verdict, "BLOCKED");
  assert.equal(undated.code, "BLOCKED_INVENTORY_RECONCILIATION", "the contract layer rejects it first");
  assert.match(undated.reason, /expires_at/, "and says which field was missing");

  // LAYER 2 — the EXCEPTION layer. A well-formed but stale exception passes contract validation and
  // is rejected by referencedExceptions() on expiry.
  const expired = evaluate({ id: code, reason: "Chart migration is staged.", owner: "design", expires_at: "2020-01-01T00:00:00.000Z" });
  assert.equal(expired.verdict, "BLOCKED");
  assert.equal(expired.code, "BLOCKED_EXCEPTION_RECONCILIATION", "the exception layer rejects a stale exception");

  // An exception that exists and is current but is NOT referenced by the manifest reaches the
  // REVIEW layer, which rejects it with the review code.
  const unreferenced = (() => {
    const { bundle, manifest } = buildBundle();
    bundle.designContract.accepted_exceptions = [dated];
    manifest.findings = [{ code, severity: "critical", evidence: [visualQa.hashBytes(Buffer.from("finding evidence"))] }];
    manifest.exception_references = [];
    for (const receipt of bundle.reviewReceipts) receipt.findings = [gatingReceiptFinding(code)];
    seal(manifest, bundle);
    return visualQa.evaluateEvidenceManifest(manifest, bundle);
  })();
  assert.equal(unreferenced.verdict, "FAIL");
  assert.equal(unreferenced.code, "FAIL_REVIEW_GATING_FINDING", "the review layer rejects, not the evidence layer");
});
