import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as visualQa from "../skills/visual-qa/scripts/visual-qa.mjs";
import {
  buildEvidenceBundle,
  buildValidSmokeEvidenceBundle,
  validDesignContract
} from "../tools/qa-real-surface-fixtures.mjs";

test("negative-gate valid evidence uses beta smoke material and only requested capabilities", () => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-matrix-evidence-"));
  try {
    const fixture = buildValidSmokeEvidenceBundle(visualQa, evidenceRoot);

    assert.equal(fixture.manifest.schema_id, "litfamily.evidence-manifest/v1beta1");
    assert.equal(fixture.manifest.tier, "smoke");
    assert.deepEqual(fixture.manifest.capabilities, {
      capture: true,
      auth: false,
      test_account_safe: false,
      independent_review: false
    });
    assert.equal(fixture.manifest.inventory.some((item) => item.kind === "auth"), false);
    assert.equal(fixture.bundle.reviewReceipts.length, 0);

    const capture = fixture.manifest.captures[0];
    const captureBytes = fs.readFileSync(path.join(evidenceRoot, capture.path));
    assert.deepEqual(captureBytes.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
    assert.equal(capture.byte_length, captureBytes.length);
    assert.equal(capture.capture_hash, visualQa.hashBytes(captureBytes));
    assert.equal(visualQa.evaluateEvidenceManifest(fixture.manifest, fixture.bundle).verdict, "PASS");
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
});

test("all negative-gate contract and evidence fixtures use beta material surfaces", () => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-matrix-beta-"));
  try {
    assert.equal(validDesignContract().schema_id, "litfamily.design-contract/v1beta1");
    for (const fixture of [
      buildEvidenceBundle(visualQa, evidenceRoot),
      buildValidSmokeEvidenceBundle(visualQa, evidenceRoot)
    ]) {
      assert.equal(fixture.designContract.schema_id, "litfamily.design-contract/v1beta1");
      assert.equal(fixture.manifest.schema_id, "litfamily.evidence-manifest/v1beta1");
      assert.equal(fixture.bundle.evidenceRoot, evidenceRoot);
      assert.equal(fixture.bundle.captureArtifacts, undefined);
    }
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
});
