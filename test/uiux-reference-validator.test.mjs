import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectUiArtifact } from "../skills/visual-qa/scripts/artifact.mjs";

const hash = `sha256:${"a".repeat(64)}`;

function validReference() {
  return {
    kind: "reference-fidelity",
    expected_dimensions: [1440, 900],
    actual_dimensions: [1440, 900],
    expected_hash: hash,
    actual_hash: hash
  };
}

test("uiux.reference-validator-never-passes-invalid-equal-dimensions", () => {
  for (const dimensions of [
    undefined,
    null,
    [],
    [1440],
    [1440, 900, 1],
    [1440, "900"],
    [1440, NaN],
    [1440, Infinity],
    [0, 900],
    [-1, 900]
  ]) {
    const input = validReference();
    input.expected_dimensions = dimensions;
    input.actual_dimensions = dimensions;
    assert.throws(() => inspectUiArtifact(input), /dimension/i, String(dimensions));
  }
});

test("uiux.reference-validator-requires-canonical-sha256-identities", () => {
  for (const invalidHash of [
    undefined,
    null,
    "",
    "a".repeat(64),
    `sha256:${"A".repeat(64)}`,
    `sha256:${"a".repeat(63)}`,
    `md5:${"a".repeat(64)}`
  ]) {
    const input = validReference();
    input.expected_hash = invalidHash;
    input.actual_hash = invalidHash;
    assert.throws(() => inspectUiArtifact(input), /sha256|hash/i, String(invalidHash));
  }
  assert.deepEqual(inspectUiArtifact(validReference()), { findings: [], verdict: "PASS" });
});
