// Taste dials on litfamily.design-contract/v1beta2.
//
// v1beta2 is v1beta1 plus one optional `taste` object, and nothing else. The
// point of the additive rule is negative: a v1beta1 document must keep the
// meaning it had before this file existed, and a v1beta2 document that omits
// taste must still be complete. Both are asserted here, not assumed.
//
// A defect in a dial produces exactly one issue. A reviewer fixing a dial wants
// the dial named, not every consequence of the same mistake listed back at them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { validBetaDesignContract, validDesignContract } from "../test-support/uiux-visual-fixtures.mjs";
import {
  designContractBeta2SchemaId,
  designContractBetaSchemaId,
  validateDesignContract
} from "../skills/frontend-ui-ux/scripts/design-contract.mjs";

const schemaPath = "skills/frontend-ui-ux/schemas/design-contract-v1beta2.json";

function beta2(taste) {
  const contract = { ...validBetaDesignContract(), schema_id: designContractBeta2SchemaId };
  if (taste !== undefined) contract.taste = taste;
  return contract;
}

function tasteIssues(result) {
  return result.issues.filter((issue) => issue.includes("taste"));
}

test("v1beta2 without taste is complete and evidence-eligible", () => {
  const result = validateDesignContract(beta2());
  assert.equal(result.valid, true, result.issues.join("; "));
  assert.equal(result.schema, "litfamily.design-contract/v1beta2");
  assert.equal(result.evidence_eligible, true);
  assert.deepEqual(result.diagnostics, []);
});

test("v1beta2 accepts the three dials at both ends of the range", () => {
  for (const dials of [
    { variance: 1, motion: 1, density: 1 },
    { variance: 10, motion: 10, density: 10 },
    { variance: 8, motion: 6, density: 3 }
  ]) {
    const result = validateDesignContract(beta2(dials));
    assert.equal(result.valid, true, `${JSON.stringify(dials)}: ${result.issues.join("; ")}`);
    assert.equal(result.evidence_eligible, true);
  }
});

test("every taste defect is rejected as exactly one issue naming the dial", () => {
  const cases = [
    [{ variance: 11, motion: 5, density: 5 }, /taste\.variance/u],
    [{ variance: 0, motion: 5, density: 5 }, /taste\.variance/u],
    [{ variance: 5.5, motion: 5, density: 5 }, /taste\.variance/u],
    [{ variance: "8", motion: 5, density: 5 }, /taste\.variance/u],
    [{ variance: 5, motion: 5 }, /taste\.density/u],
    [{ variance: 5, motion: 5, density: 5, rhythm: 5 }, /rhythm/u],
    ["bold", /taste must be an object/u],
    [[], /taste must be an object/u],
    [null, /taste must be an object/u]
  ];
  for (const [taste, expected] of cases) {
    const result = validateDesignContract(beta2(taste));
    const named = tasteIssues(result);
    assert.equal(result.valid, false, `${JSON.stringify(taste)} must be rejected`);
    assert.equal(named.length, 1, `${JSON.stringify(taste)} produced ${named.length} taste issues: ${named.join("; ")}`);
    assert.match(named[0], expected);
  }
});

test("v1beta1 keeps the meaning it had before taste existed", () => {
  const untouched = validateDesignContract(validBetaDesignContract());
  assert.equal(untouched.valid, true, untouched.issues.join("; "));
  assert.equal(untouched.schema, designContractBetaSchemaId);
  assert.equal(untouched.evidence_eligible, true);

  const smuggled = { ...validBetaDesignContract(), taste: { variance: 5, motion: 5, density: 5 } };
  const result = validateDesignContract(smuggled);
  assert.equal(result.valid, false, "v1beta1 must not silently accept a v1beta2 key");
  assert.match(result.issues.join("\n"), /unsupported key taste/u);
});

test("v1alpha1 stays migration-only and never gains taste", () => {
  const result = validateDesignContract(validDesignContract());
  assert.equal(result.schema, "litfamily.design-contract/v1alpha1");
  assert.deepEqual(result.diagnostics, ["LEGACY_SCHEMA_V1ALPHA1"]);
  assert.equal(result.evidence_eligible, false);

  const smuggled = { ...validDesignContract(), taste: { variance: 5, motion: 5, density: 5 } };
  assert.equal(validateDesignContract(smuggled).valid, false);
});

test("an unknown schema id is still refused by name", () => {
  const result = validateDesignContract({ ...validBetaDesignContract(), schema_id: "litfamily.design-contract/v1beta3" });
  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /litfamily\.design-contract\/v1beta2/u);
});

test("the v1beta2 schema file is v1beta1 plus one optional taste object", () => {
  const beta1 = JSON.parse(fs.readFileSync("skills/frontend-ui-ux/schemas/design-contract-v1beta1.json", "utf8"));
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.equal(schema.$id, "litfamily.design-contract/v1beta2");
  assert.equal(schema.properties.schema_id.const, "litfamily.design-contract/v1beta2");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, beta1.required, "v1beta2 must require exactly what v1beta1 required");
  assert.deepEqual(
    Object.keys(schema.properties).filter((key) => !Object.hasOwn(beta1.properties, key)),
    ["taste"],
    "taste is the only key v1beta2 adds"
  );
  const taste = schema.$defs.taste;
  assert.equal(taste.additionalProperties, false);
  assert.deepEqual(taste.required, ["variance", "motion", "density"]);
  for (const dial of ["variance", "motion", "density"]) {
    assert.deepEqual(
      { type: taste.properties[dial].type, minimum: taste.properties[dial].minimum, maximum: taste.properties[dial].maximum },
      { type: "integer", minimum: 1, maximum: 10 }
    );
  }
});
