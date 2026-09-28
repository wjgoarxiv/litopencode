// Boundary coverage for the dataset-free litfamily.design-contract/v1alpha1.
//
// The earlier revision of this file proved id/text/collection maxima against a
// contract that carried a dataset identity group. That group is gone and the
// per-field maxima went with it: total input is now capped by the bounded reader
// instead. The boundaries that survive are closed field ranges, mandatory typed
// id prefixes, referential integrity, authenticated-surface coupling, closed
// enums, strict UTC instants, and the validator exit-code contract, so those are
// what this file asserts. validateDesignContract answers { valid, schema, issues }
// and never throws for an already-parsed value.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { test } from "node:test";
import { validDesignContract } from "../test-support/uiux-visual-fixtures.mjs";
import { validateDesignContract } from "../skills/frontend-ui-ux/scripts/design-contract.mjs";

const schemaPath = "skills/frontend-ui-ux/schemas/design-contract-v1alpha1.json";
const validatorPath = "skills/frontend-ui-ux/scripts/uiux.mjs";

function accepts(mutate, label) {
  const contract = validDesignContract();
  mutate(contract);
  const result = validateDesignContract(contract);
  assert.equal(result.valid, true, `${label}: ${result.issues.join("; ")}`);
}

function rejects(mutate, label) {
  const contract = validDesignContract();
  mutate(contract);
  const result = validateDesignContract(contract);
  assert.equal(result.valid, false, `${label} must be rejected`);
  assert.ok(result.issues.length > 0, `${label} must explain itself`);
}

function openObjectSchemas(node, pointer = "#", found = []) {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => openObjectSchemas(entry, `${pointer}/${index}`, found));
    return found;
  }
  if (node === null || typeof node !== "object") return found;
  if (Object.hasOwn(node, "properties") && node.additionalProperties !== false) found.push(pointer);
  for (const [key, value] of Object.entries(node)) openObjectSchemas(value, `${pointer}/${key}`, found);
  return found;
}

test("uiux.design-contract-schema-declares-runtime-boundaries", () => {
  const schemaText = fs.readFileSync(schemaPath, "utf8");
  const schema = JSON.parse(schemaText);

  assert.equal(schema.$id, "litfamily.design-contract/v1alpha1");
  assert.deepEqual(schema.required, [
    "schema_id",
    "contract_id",
    "source_hash",
    "intent",
    "direction",
    "inventory",
    "accessibility",
    "localization",
    "performance",
    "evidence_policy",
    "omissions",
    "accepted_exceptions"
  ]);
  assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());
  assert.equal(
    /dataset|corpus|record_count|design[-_ ]intelligence/i.test(schemaText),
    false,
    "the contract must carry no dataset, corpus, or record-count obligation"
  );
  assert.deepEqual(openObjectSchemas(schema), [], "every object level must close additionalProperties");

  assert.equal(schema.$defs.id.pattern, "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._/-]*$");
  assert.equal(schema.$defs.hash.pattern, "^[0-9a-f]{64}$");
  assert.deepEqual(schema.properties.source_hash, { $ref: "#/$defs/hash" });
  assert.deepEqual(schema.properties.inventory.properties.references.items.properties.sha256, {
    $ref: "#/$defs/hash"
  });

  assert.equal(schema.properties.accessibility.properties.target.const, "WCAG 2.2 AA");
  assert.equal(schema.properties.direction.properties.principles.minItems, 3);
  assert.equal(schema.properties.direction.properties.principles.maxItems, 7);
  for (const category of ["routes", "regions", "components", "interactions"]) {
    assert.equal(schema.properties.inventory.properties[category].minItems, 1, category);
  }
  for (const [field, minimum, maximum] of [
    ["lcp_ms", 1, 60000],
    ["cls", 0, 1],
    ["inp_ms", 1, 60000],
    ["initial_js_kb", 0, 1048576],
    ["initial_css_kb", 0, 1048576]
  ]) {
    const dimension = schema.properties.performance.properties[field];
    assert.equal(dimension.minimum, minimum, `performance.${field} lower bound`);
    assert.equal(dimension.maximum, maximum, `performance.${field} upper bound`);
  }
  assert.deepEqual(schema.$defs.deviation.required, ["id", "reason", "owner"]);
  assert.deepEqual(Object.keys(schema.$defs.deviation.properties).sort(), [
    "expires_at",
    "id",
    "owner",
    "reason"
  ]);
});

test("uiux.design-contract-enforces-closed-field-ranges", () => {
  const ranges = [
    ["accessibility.zoom_percent", (c, v) => { c.accessibility.zoom_percent = v; }, 200, 400],
    ["localization.text_expansion_percent", (c, v) => { c.localization.text_expansion_percent = v; }, 0, 300],
    ["performance.lcp_ms", (c, v) => { c.performance.lcp_ms = v; }, 1, 60000],
    ["performance.inp_ms", (c, v) => { c.performance.inp_ms = v; }, 1, 60000],
    ["performance.initial_js_kb", (c, v) => { c.performance.initial_js_kb = v; }, 0, 1048576],
    ["performance.initial_css_kb", (c, v) => { c.performance.initial_css_kb = v; }, 0, 1048576],
    ["viewport.width", (c, v) => { c.inventory.viewports[0].width = v; }, 240, 16384],
    ["viewport.height", (c, v) => { c.inventory.viewports[0].height = v; }, 240, 16384]
  ];
  for (const [label, set, minimum, maximum] of ranges) {
    accepts((contract) => set(contract, minimum), `${label} lower bound`);
    accepts((contract) => set(contract, maximum), `${label} upper bound`);
    rejects((contract) => set(contract, minimum - 1), `${label} below lower bound`);
    rejects((contract) => set(contract, maximum + 1), `${label} above upper bound`);
    rejects((contract) => set(contract, minimum + 0.5), `${label} fractional`);
  }

  // cls is the only non-integer dimension, and it is still closed on both ends.
  accepts((contract) => { contract.performance.cls = 0; }, "cls lower bound");
  accepts((contract) => { contract.performance.cls = 1; }, "cls upper bound");
  accepts((contract) => { contract.performance.cls = 0.25; }, "cls fractional");
  rejects((contract) => { contract.performance.cls = -0.01; }, "cls below lower bound");
  rejects((contract) => { contract.performance.cls = 1.01; }, "cls above upper bound");

  accepts((contract) => { contract.direction.principles = ["a", "b", "c"]; }, "three principles");
  accepts(
    (contract) => { contract.direction.principles = ["a", "b", "c", "d", "e", "f", "g"]; },
    "seven principles"
  );
  rejects((contract) => { contract.direction.principles = ["a", "b"]; }, "two principles");
  rejects(
    (contract) => { contract.direction.principles = ["a", "b", "c", "d", "e", "f", "g", "h"]; },
    "eight principles"
  );
  rejects((contract) => { contract.direction.principles = ["a", "a", "b"]; }, "repeated principle");

  for (const field of ["audiences", "tasks", "qualities"]) {
    rejects((contract) => { contract.intent[field] = []; }, `empty intent.${field}`);
    rejects((contract) => { contract.intent[field] = [" "]; }, `blank intent.${field}`);
  }
  rejects((contract) => { contract.localization.locales = []; }, "empty locales");
  rejects((contract) => { contract.evidence_policy.required_channels = []; }, "empty required_channels");
  rejects(
    (contract) => { contract.evidence_policy.required_channels = ["tests", "tests"]; },
    "repeated required_channels"
  );

  assert.equal(validateDesignContract(undefined).valid, false);
  assert.equal(validateDesignContract([]).valid, false);
});

test("uiux.design-contract-enforces-typed-ids-integrity-and-closed-enums", () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.deepEqual(schema.properties.inventory.properties.states.items.properties.kind.enum, [
    "loading",
    "empty",
    "error",
    "success",
    "disabled",
    "permission",
    "offline",
    "ready"
  ]);

  const closedEnums = [
    [
      (c, v) => { c.inventory.states[0].kind = v; },
      ["loading", "empty", "error", "success", "disabled", "permission", "offline", "ready"],
      "state kind"
    ],
    [
      (c, v) => { c.inventory.interactions[0].input_modes = [v]; },
      ["keyboard", "pointer", "touch", "voice", "switch"],
      "input mode"
    ],
    [
      (c, v) => { c.inventory.viewports[0].category = v; },
      ["compact", "medium", "expanded"],
      "viewport category"
    ],
    [
      (c, v) => { c.inventory.references[0].kind = v; },
      ["user-provided", "repo-local", "generated", "measured"],
      "reference kind"
    ],
    [(c, v) => { c.direction.token_strategy = v; }, ["reuse", "extend", "create"], "token strategy"],
    [
      (c, v) => { c.evidence_policy.required_channels = [v]; },
      ["tests", "browser", "keyboard", "accessibility-tree", "screen-reader", "performance", "localization"],
      "evidence channel"
    ]
  ];
  for (const [set, allowed, label] of closedEnums) {
    for (const value of allowed) accepts((contract) => set(contract, value), `${label} ${value}`);
    rejects((contract) => set(contract, "unsupported"), `unsupported ${label}`);
    rejects((contract) => set(contract, allowed[0].toUpperCase()), `uppercased ${label}`);
  }

  // Typed prefixes are mandatory, so a grammatical id under the wrong prefix is
  // still a defect.
  for (const [label, set] of [
    ["contract_id", (c, v) => { c.contract_id = v; }],
    ["route id", (c, v) => { c.inventory.routes[0].id = v; }],
    ["region id", (c, v) => { c.inventory.regions[0].id = v; }],
    ["component id", (c, v) => { c.inventory.components[0].id = v; }],
    ["interaction id", (c, v) => { c.inventory.interactions[0].id = v; }],
    ["state id", (c, v) => { c.inventory.states[0].id = v; }],
    ["viewport id", (c, v) => { c.inventory.viewports[0].id = v; }],
    ["reference id", (c, v) => { c.inventory.references[0].id = v; }]
  ]) {
    rejects((contract) => set(contract, "thing:one"), `${label} under a foreign prefix`);
    rejects((contract) => set(contract, "Route:One"), `${label} with uppercase`);
    rejects((contract) => set(contract, "route"), `${label} without a prefix`);
  }
  rejects((contract) => { contract.source_hash = contract.source_hash.toUpperCase(); }, "uppercase source_hash");
  rejects(
    (contract) => { contract.inventory.references[0].sha256 = "g".repeat(64); },
    "non-hexadecimal reference digest"
  );
  rejects((contract) => { contract.source_hash = "a".repeat(63); }, "short source_hash");

  for (const [label, set] of [
    ["region", (c) => { c.inventory.regions[0].route_id = "route:absent"; }],
    ["interaction", (c) => { c.inventory.interactions[0].route_id = "route:absent"; }],
    ["state", (c) => { c.inventory.states[0].route_id = "route:absent"; }],
    ["component", (c) => { c.inventory.components[0].region_id = "region:absent"; }],
    ["authenticated surface", (c) => { c.inventory.authenticated_surfaces[0].route_id = "route:absent"; }]
  ]) {
    rejects(set, `${label} pointing at an undeclared parent`);
  }

  rejects((contract) => { contract.inventory.routes[0].primary = false; }, "no primary route");
  rejects((contract) => { contract.inventory.interactions[0].critical = false; }, "no critical interaction");
  rejects((contract) => { contract.inventory.regions = []; }, "no regions");
  rejects((contract) => { contract.inventory.components = []; }, "no components");
  rejects((contract) => { contract.inventory.references = {}; }, "references that are not an array");

  // Authentication safety is a coupling between routes and surfaces, not a
  // per-item flag.
  rejects((contract) => { contract.inventory.authenticated_surfaces = []; }, "locked route without a surface");
  rejects(
    (contract) => { contract.inventory.authenticated_surfaces[0].route_id = "route:apply"; },
    "public route with a surface"
  );
  rejects(
    (contract) => { contract.inventory.authenticated_surfaces[0].safe_test_account = false; },
    "surface without a safe test account"
  );
  rejects((contract) => {
    delete contract.inventory.authenticated_surfaces[0].safe_test_account;
  }, "surface omitting the safe test account");
  rejects((contract) => {
    contract.inventory.authenticated_surfaces.push({
      route_id: "route:status",
      owner: "second-owner",
      safe_test_account: true
    });
  }, "route claimed by two surfaces");
});

test("uiux.design-contract-rejects-nonfinite-values-and-unknown-keys", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    rejects((contract) => { contract.performance.cls = value; }, `non-finite cls ${value}`);
    rejects((contract) => { contract.performance.lcp_ms = value; }, `non-finite lcp_ms ${value}`);
    rejects((contract) => { contract.inventory.viewports[0].width = value; }, `non-finite width ${value}`);
  }
  rejects((contract) => { contract.performance.cls = "0.1"; }, "stringified cls");
  rejects((contract) => { contract.accessibility.keyboard = "true"; }, "stringified boolean");

  // The former dataset identity is the canonical unknown key: reintroducing it,
  // or any other unlisted key, is a contract defect at every object level.
  for (const [label, set] of [
    ["root", (c) => { c.dataset_identity = { record_count: 1 }; }],
    ["intent", (c) => { c.intent.dataset = "corpus"; }],
    ["inventory", (c) => { c.inventory.datasets = []; }],
    ["route", (c) => { c.inventory.routes[0].dataset = "corpus"; }],
    ["accessibility", (c) => { c.accessibility.dataset = "corpus"; }],
    ["performance", (c) => { c.performance.dataset_ms = 1; }],
    ["evidence_policy", (c) => { c.evidence_policy.dataset_hash = "a".repeat(64); }],
    ["deviation", (c) => { c.omissions[0].dataset = "corpus"; }]
  ]) {
    rejects(set, `unknown key on ${label}`);
  }
  for (const key of ["source_hash", "intent", "inventory", "evidence_policy", "omissions"]) {
    rejects((contract) => { delete contract[key]; }, `missing ${key}`);
  }
  rejects((contract) => { contract.schema_id = "litfamily.design-contract/v1alpha2"; }, "foreign schema id");
});

test("uiux.design-contract-expiry-is-strict-iso-8601-utc", () => {
  for (const expiresAt of [
    1798675200000,
    "2026-12-31",
    "2026-12-31T00:00:00",
    "2026-12-31T00:00:00z",
    "2026-12-31T00:00:00.123456Z",
    "2026-12-31T09:00:00+09:00",
    "2026-12-31T00:00:00+00:00",
    "2026-02-31T00:00:00Z",
    "2026-12-31T24:00:00Z",
    "Thu, 31 Dec 2026 00:00:00 GMT"
  ]) {
    rejects(
      (contract) => { contract.accepted_exceptions[0].expires_at = expiresAt; },
      `untrusted expiry ${String(expiresAt)}`
    );
  }
  for (const expiresAt of ["2026-12-31T00:00:00Z", "2026-12-31T00:00:00.123Z"]) {
    accepts((contract) => { contract.accepted_exceptions[0].expires_at = expiresAt; }, expiresAt);
  }
  // expires_at is REQUIRED on an accepted exception and OPTIONAL on an omission. An accepted
  // exception forgives a gating finding, so it must say when it stops doing so; the evidence gate
  // rejects an undated one with BLOCKED_EXCEPTION_RECONCILIATION, and the contract previously
  // permitted a document that gate could never use.
  rejects((contract) => { delete contract.accepted_exceptions[0].expires_at; }, "accepted exception with no expiry");
  // An omission records work that was not done and forgives nothing, so it keeps its optional expiry.
  accepts((contract) => { delete contract.omissions[0].expires_at; }, "omission with no expiry");
  accepts((contract) => { contract.omissions[0].expires_at = "2026-12-31T00:00:00Z"; }, "omission with an expiry");
  rejects((contract) => { delete contract.omissions[0].owner; }, "omission without an owner");
});

test("uiux.design-contract-validate-honors-the-exit-code-contract", () => {
  function validate(input) {
    return spawnSync(process.execPath, [validatorPath, "validate"], {
      cwd: process.cwd(),
      encoding: "utf8",
      input
    });
  }

  const valid = validate(JSON.stringify(validDesignContract()));
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stderr, "");
  assert.ok(valid.stdout.endsWith("\n"), "canonical output must end with a newline");
  assert.equal(valid.stdout.split("\n").filter(Boolean).length, 1, "stdout must be one line of JSON");
  assert.deepEqual(JSON.parse(valid.stdout), {
    diagnostics: ["LEGACY_SCHEMA_V1ALPHA1"],
    evidence_eligible: false,
    issues: [],
    schema: "litfamily.design-contract/v1alpha1",
    valid: true
  });

  const broken = validDesignContract();
  broken.accessibility.zoom_percent = 199;
  const invalid = validate(JSON.stringify(broken));
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.equal(invalid.stderr, "");
  const envelope = JSON.parse(invalid.stdout);
  assert.equal(envelope.valid, false);
  assert.equal(envelope.schema, "litfamily.design-contract/v1alpha1");
  assert.ok(envelope.issues.length > 0, "an invalid contract must report issues on stdout");

  for (const [label, input, pattern] of [
    ["duplicate key", '{"schema_id":"a","schema_id":"b"}', /duplicate key/i],
    ["trailing data", '{"schema_id":"a"} extra', /trailing|malformed/i]
  ]) {
    const untrusted = validate(input);
    assert.equal(untrusted.status, 2, `${label} must exit 2`);
    assert.equal(untrusted.stdout, "", `${label} must write nothing to stdout`);
    assert.match(untrusted.stderr, pattern);
  }
});
