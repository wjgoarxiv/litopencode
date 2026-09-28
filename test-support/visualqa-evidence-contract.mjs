import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  validDesignContract,
  validEvidenceManifest,
  validReviewReceipt
} from "./uiux-visual-fixtures.mjs";

export function registerVisualQaEvidenceContract({ readOptionalText }) {
  test("visualqa.evidence-v1alpha1", async () => {
    const schemas = [
      {
        filePath: "skills/visual-qa/schemas/evidence-manifest-v1alpha1.json",
        id: "litfamily.evidence-manifest/v1alpha1",
        requiredTerms: [
          "design",
          "source",
          "capture",
          "created",
          "maximum",
          "viewport",
          "dpr",
          "locale",
          "inventory",
          "tier",
          "smoke",
          "full",
          "reference",
          "fresh",
          "verdict"
        ]
      },
      {
        filePath: "skills/visual-qa/schemas/review-receipt-v1alpha1.json",
        id: "litfamily.review-receipt/v1alpha1",
        requiredTerms: ["reviewer", "context", "input", "round", "finding", "severity", "verdict"]
      }
    ];
    for (const expected of schemas) {
      const text = await readOptionalText(expected.filePath);
      assert.notEqual(text, "", `visualqa.evidence-v1alpha1: missing capability file ${expected.filePath}`);
      assert.equal(JSON.parse(text).$id, expected.id);
      for (const term of expected.requiredTerms) {
        assert.match(text, new RegExp(term, "i"), `${expected.filePath} must define ${term}`);
      }
    }
    const evidenceSchema = JSON.parse(await readOptionalText(schemas[0].filePath));
    assert.ok(evidenceSchema.required.includes("capabilities"));
    assert.ok(evidenceSchema.required.includes("exception_references"));
    assert.deepEqual(
      evidenceSchema.properties.inventory.items.properties.status.enum,
      ["captured", "not_applicable", "accepted_exception", "blocked"]
    );
    for (const field of ["evidence_path", "evidence_hash"]) {
      assert.ok(evidenceSchema.properties.inventory.items.required.includes(field));
    }
    const receiptSchema = JSON.parse(await readOptionalText(schemas[1].filePath));
    for (const field of [
      "review_id",
      "fresh_context_id",
      "reviewer_capability_class",
      "input_hashes",
      "reviewed_inventory",
      "confidence",
      "independence_assertion",
      "started_at",
      "ended_at",
      "timeout_seconds",
      "timed_out",
      "cancelled"
    ]) {
      assert.ok(receiptSchema.required.includes(field), `Review Receipt must require ${field}`);
    }

    const scriptPath = "skills/visual-qa/scripts/visual-qa.mjs";
    const scriptText = await readOptionalText(scriptPath);
    assert.notEqual(scriptText, "", `visualqa.evidence-v1alpha1: missing capability file ${scriptPath}`);
    const visualQa = await import(pathToFileURL(path.resolve(scriptPath)).href);
    assert.equal(typeof visualQa.evaluateEvidenceFreshness, "function");
    assert.equal(typeof visualQa.completionConditionsForTier, "function");
    assert.equal(typeof visualQa.evaluateTierCompletion, "function");
    assert.equal(typeof visualQa.validateEvidenceManifest, "function");
    assert.equal(typeof visualQa.evaluateEvidenceManifest, "function");
    assert.equal(typeof visualQa.validateEvidenceManifestText, "function");
    assert.equal(typeof visualQa.validateReviewReceiptText, "function");
    assert.equal(typeof visualQa.readBoundedEvidenceManifestFile, "function");
    assert.equal(typeof visualQa.readBoundedReviewReceiptFile, "function");
    assert.equal(typeof visualQa.hashCanonicalValue, "function");
    assert.throws(
      () =>
        visualQa.validateEvidenceManifestText(
          '{"schema_id":"litfamily.evidence-manifest/v1alpha1","schema_id":"duplicate"}'
        ),
      /duplicate key/i
    );
    assert.throws(
      () =>
        visualQa.validateReviewReceiptText(
          '{"schema_id":"litfamily.review-receipt/v1alpha1","schema_id":"duplicate"}'
        ),
      /duplicate key/i
    );

    const boundedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-visual-contract-"));
    try {
      const evidencePath = path.join(boundedRoot, "evidence.json");
      const reviewPath = path.join(boundedRoot, "review.json");
      const invalidUtf8Path = path.join(boundedRoot, "invalid.json");
      const oversizedPath = path.join(boundedRoot, "oversized.json");
      const symlinkPath = path.join(boundedRoot, "evidence-link.json");
      await fs.writeFile(evidencePath, JSON.stringify(validEvidenceManifest()), "utf8");
      await fs.writeFile(reviewPath, JSON.stringify(validReviewReceipt()), "utf8");
      await fs.writeFile(invalidUtf8Path, Buffer.from([0xc3, 0x28]));
      await fs.writeFile(oversizedPath, Buffer.alloc(1025 * 1024, 0x20));
      await fs.symlink(evidencePath, symlinkPath);
      assert.equal(
        (await visualQa.readBoundedEvidenceManifestFile(evidencePath, { authorizedRoot: boundedRoot })).valid,
        true
      );
      assert.equal(
        (await visualQa.readBoundedReviewReceiptFile(reviewPath, { authorizedRoot: boundedRoot })).ok,
        true
      );
      await assert.rejects(
        visualQa.readBoundedEvidenceManifestFile(symlinkPath, { authorizedRoot: boundedRoot }),
        /symlink/i
      );
      await assert.rejects(
        visualQa.readBoundedEvidenceManifestFile(invalidUtf8Path, { authorizedRoot: boundedRoot }),
        /UTF-8/i
      );
      await assert.rejects(
        visualQa.readBoundedEvidenceManifestFile(oversizedPath, { authorizedRoot: boundedRoot }),
        /size|bytes|large/i
      );
      await assert.rejects(
        visualQa.readBoundedReviewReceiptFile("/dev/null", { authorizedRoot: "/dev", maxBytes: 1024 }),
        /regular file|device/i
      );
      await assert.rejects(
        visualQa.readBoundedReviewReceiptFile(reviewPath, {
          authorizedRoot: path.join(boundedRoot, "nested")
        }),
        /authorized root|outside/i
      );
    } finally {
      await fs.rm(boundedRoot, { recursive: true, force: true });
    }

    const evidence = {
      createdAt: "2026-07-24T00:00:00.000Z",
      maximumAgeSeconds: 600,
      expectedSourceHash: `sha256:${"1".repeat(64)}`,
      actualSourceHash: `sha256:${"1".repeat(64)}`,
      expectedCaptureHash: `sha256:${"2".repeat(64)}`,
      actualCaptureHash: `sha256:${"2".repeat(64)}`
    };
    const fresh = await visualQa.evaluateEvidenceFreshness({
      ...evidence,
      now: "2026-07-24T00:09:59.000Z"
    });
    assert.equal(fresh.fresh, true);
    assert.equal(fresh.accepted, true);

    const stale = await visualQa.evaluateEvidenceFreshness({
      ...evidence,
      now: "2026-07-24T00:10:01.000Z"
    });
    assert.equal(stale.fresh, false);
    assert.equal(stale.code, "BLOCKED_EVIDENCE_STALE");
    assert.notEqual(stale.verdict, "PASS");

    const mismatched = await visualQa.evaluateEvidenceFreshness({
      ...evidence,
      actualCaptureHash: `sha256:${"3".repeat(64)}`,
      now: "2026-07-24T00:09:59.000Z"
    });
    assert.equal(mismatched.accepted, false);
    assert.equal(mismatched.code, "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH");
    assert.notEqual(mismatched.verdict, "PASS");

    const expectedTierSignals = new Map([
      ["smoke", ["app-started", "primary-route", "critical-state"]],
      ["full", ["finite-inventory-complete", "mechanical-checks-complete", "accessibility-checks-complete"]],
      [
        "reference-fidelity",
        [
          "finite-inventory-complete",
          "reference-hash-match",
          "paired-captures-comparable",
          "reference-findings-complete"
        ]
      ]
    ]);
    const serializedConditions = new Set();
    for (const [tier, expectedSignals] of expectedTierSignals) {
      const conditions = await visualQa.completionConditionsForTier(tier);
      assert.ok(Array.isArray(conditions), `${tier} completion conditions must be finite`);
      assert.ok(conditions.length > 0 && conditions.length <= 12);
      for (const signal of expectedSignals) assert.ok(conditions.includes(signal), `${tier} must require ${signal}`);
      serializedConditions.add(JSON.stringify(conditions));

      const incomplete = await visualQa.evaluateTierCompletion({
        tier,
        completed: conditions.slice(0, -1)
      });
      assert.equal(incomplete.complete, false);
      assert.deepEqual(incomplete.missing, [conditions.at(-1)]);
      assert.notEqual(incomplete.verdict, "PASS");
      assert.equal((await visualQa.evaluateTierCompletion({ tier, completed: conditions })).complete, true);
    }
    assert.equal(serializedConditions.size, 3, "tiers must not share one completion rule");

    // The fixture derives the evidence inventory from the Design Contract, so
    // every id-bearing contract category already reconciles and the tier's
    // remaining kinds arrive as synthetic entries.
    const designContract = validDesignContract();
    const full = validEvidenceManifest({ contract: designContract });
    const sourceBytes = Buffer.from("evidence-contract source bytes");
    const captureArtifacts = [{
      capture_id: full.captures[0].capture_id,
      bytes: Buffer.from("evidence-contract capture bytes")
    }];
    full.captures[0].source_hash = visualQa.hashBytes(sourceBytes);
    full.captures[0].capture_hash = visualQa.hashBytes(captureArtifacts[0].bytes);
    const reviewedInventory = full.inventory.map(({ id, kind, status }) => ({ id, kind, status }));
    const reviewReceipts = [
      validReviewReceipt({ id: "review-a", reviewerId: "reviewer-a", contextId: "context-a" }),
      validReviewReceipt({
        id: "review-b",
        reviewerId: "reviewer-b",
        contextId: "context-b",
        capabilityId: "visual-reviewer-b"
      })
    ];
    for (const receipt of reviewReceipts) receipt.reviewed_inventory = reviewedInventory;
    full.design_contract_hash = visualQa.hashCanonicalValue(designContract);
    const evidenceManifestBytes = Buffer.from("evidence-contract immutable manifest input");
    const immutableHashes = {
      capture: visualQa.hashCaptureArtifacts(captureArtifacts),
      design_contract: full.design_contract_hash,
      evidence_manifest: visualQa.hashBytes(evidenceManifestBytes),
      source: visualQa.hashBytes(sourceBytes)
    };
    for (const receipt of reviewReceipts) receipt.input_hashes = { ...immutableHashes };
    full.review_receipt_hashes = reviewReceipts.map(visualQa.hashCanonicalValue);
    assert.deepEqual(visualQa.validateEvidenceManifest(full).valid, true);
    assert.equal(
      visualQa.evaluateEvidenceManifest(full, { now: "2026-07-24T00:05:00.000Z" }).verdict,
      "BLOCKED"
    );
    const bundle = {
      now: "2026-07-24T00:05:00.000Z",
      captureArtifacts,
      designContract,
      evidenceManifestBytes,
      reviewReceipts,
      sourceBytes
    };
    const ready = visualQa.evaluateEvidenceManifest(full, bundle);
    assert.equal(ready.verdict, "BLOCKED");
    assert.equal(ready.code, "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH");
    assert.ok(ready.diagnostics.includes("LEGACY_SCHEMA_V1ALPHA1"));
    for (const mutation of [
      (value) => { value.source_revision = null; },
      (value) => { value.captures[0].viewport = null; },
      (value) => { value.verdict = "INVALID"; }
    ]) {
      const invalid = structuredClone(full);
      mutation(invalid);
      assert.equal(visualQa.validateEvidenceManifest(invalid).valid, false);
      assert.notEqual(visualQa.evaluateEvidenceManifest(invalid, bundle).verdict, "PASS");
    }
    const declaredBlocked = structuredClone(full);
    declaredBlocked.verdict = "BLOCKED";
    assert.notEqual(visualQa.evaluateEvidenceManifest(declaredBlocked, bundle).verdict, "PASS");
    const critical = structuredClone(full);
    critical.findings = [{
      code: "CRITICAL_DEFECT",
      severity: "critical",
      evidence: [`sha256:${"8".repeat(64)}`]
    }];
    assert.notEqual(visualQa.evaluateEvidenceManifest(critical, bundle).verdict, "PASS");
    const missingContractInventory = structuredClone(full);
    missingContractInventory.inventory.shift();
    assert.equal(
      visualQa.evaluateEvidenceManifest(missingContractInventory, bundle).code,
      "BLOCKED_INVENTORY_RECONCILIATION"
    );
    const mismatchedReceipts = structuredClone(full);
    mismatchedReceipts.review_receipt_hashes[0] = `sha256:${"0".repeat(64)}`;
    assert.equal(
      visualQa.evaluateEvidenceManifest(mismatchedReceipts, bundle).code,
      "BLOCKED_REVIEW_RECONCILIATION"
    );
    for (const [capability, code] of [
      ["capture", "BLOCKED_RENDERER_UNAVAILABLE"],
      ["auth", "BLOCKED_AUTH_UNAVAILABLE"],
      ["test_account_safe", "BLOCKED_TEST_ACCOUNT_UNSAFE"],
      ["independent_review", "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"]
    ]) {
      const omitted = structuredClone(full);
      delete omitted.capabilities[capability];
      const result = visualQa.evaluateEvidenceManifest(omitted, bundle);
      assert.equal(result.verdict, "BLOCKED");
      assert.ok(result.codes.includes(code), `omitted ${capability} must produce ${code}`);
    }
    const staleCapture = structuredClone(full);
    staleCapture.captures[0].created_at = "2026-07-23T00:00:00.000Z";
    assert.equal(
      visualQa.evaluateEvidenceManifest(staleCapture, bundle).code,
      "BLOCKED_EVIDENCE_STALE"
    );
    const missing = structuredClone(full);
    missing.inventory[0].status = "blocked";
    assert.notEqual(
      visualQa.evaluateEvidenceManifest(missing, bundle).verdict,
      "PASS"
    );
  });
}
