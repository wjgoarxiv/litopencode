import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const exactPlan = {
  "public-service-form-ko": [
    "WCAG_2_4_7_FOCUS_VISIBLE",
    "WCAG_1_4_3_CONTRAST_MINIMUM"
  ],
  "fintech-dashboard": [
    "CHART_COLOR_ONLY_ENCODING",
    "CHART_NONVISUAL_FALLBACK_MISSING"
  ],
  "healthcare-mobile": [
    "DESTRUCTIVE_ACTION_CONFIRMATION_MISSING",
    "WCAG_2_5_8_TARGET_SIZE_MINIMUM"
  ],
  "saas-landing-responsive": [
    "RESPONSIVE_OVERFLOW",
    "REDUCED_MOTION_NOT_HONORED"
  ],
  "brownfield-design-system": [
    "DESIGN_TOKEN_BYPASS",
    "DUPLICATE_PRIMITIVE"
  ],
  "reference-fidelity": [
    "REFERENCE_DIMENSION_MISMATCH",
    "REFERENCE_SCREENSHOT_SUBSTITUTION"
  ],
  "cjk-terminal-dashboard": [
    "TUI_BORDER_TOPOLOGY_BROKEN"
  ],
  "missing-capture-auth-review": []
};
const exactBlocks = {
  "missing-capture-auth-review": [
    "BLOCKED_RENDERER_UNAVAILABLE",
    "BLOCKED_AUTH_UNAVAILABLE",
    "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"
  ]
};

test("uiux.scenario-driver-eight-contract", () => {
  const driverSource = fs.readFileSync("tools/run-uiux-visual-qa-scenarios.mjs", "utf8");
  assert.doesNotMatch(driverSource, /review_rounds:\s*2/u);
  for (const codes of Object.values(exactPlan)) {
    for (const code of codes) assert.doesNotMatch(driverSource, new RegExp(code));
  }
  const fixture = JSON.parse(
    fs.readFileSync("test/fixtures/uiux-visual-qa/scenarios.json", "utf8")
  );
  assert.equal(fixture.scenarios.length, 8);
  for (const scenario of fixture.scenarios) {
    assert.equal(typeof scenario.detector, "string");
    assert.equal(typeof scenario.input, "object");
    assert.equal("seeded_finding" in scenario, false);
    assert.equal("expected_finding" in scenario, false);
    assert.deepEqual(scenario.expected_finding_codes, exactPlan[scenario.id]);
    assert.deepEqual(scenario.expected_blocked_codes, exactBlocks[scenario.id] ?? []);
    assert.equal(typeof scenario.control_input, "object");
  }
  const result = spawnSync(
    process.execPath,
    [
      "tools/run-uiux-visual-qa-scenarios.mjs",
      "--installed-root",
      path.resolve("."),
      "--fixtures",
      path.resolve("test/fixtures/uiux-visual-qa"),
      "--scenario",
      "all",
      "--json"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema_version, "litfamily.uiux-visual-qa-driver-result/v1");
  assert.equal(output.scenario_count, 8);
  assert.equal(output.seeded_critical_high_detected, 7);
  assert.equal(output.seeded_findings_detected, 7);
  assert.equal(output.seeded_blocked_outcomes_detected, 1);
  assert.equal(output.detection_failure_count, 0);
  assert.equal(output.false_pass_count, 0);
  assert.equal(output.max_review_rounds, 0);
  assert.equal(output.max_validation_runs, 2);
  assert.match(output.fixture_sha256, /^[0-9a-f]{64}$/);
  assert.match(output.installed_capability_tree_sha256, /^[0-9a-f]{64}$/);
  assert.equal("installed_package_sha256" in output, false);
  assert.equal(output.capability_tree_mutated, false);
  assert.deepEqual(
    output.results.map((item) => item.id),
    [
      "public-service-form-ko",
      "fintech-dashboard",
      "healthcare-mobile",
      "saas-landing-responsive",
      "brownfield-design-system",
      "reference-fidelity",
      "cjk-terminal-dashboard",
      "missing-capture-auth-review"
    ]
  );
  assert.ok(output.results.every((item) => typeof item.detector === "string"));
  for (const item of output.results) {
    assert.deepEqual(item.finding_codes, exactPlan[item.id]);
    assert.deepEqual(item.blocked_codes, exactBlocks[item.id] ?? []);
    assert.equal(item.detected, true);
    assert.equal(item.verdict, item.id === "missing-capture-auth-review" ? "BLOCKED" : "REVISE");
    assert.equal(item.severity, item.id === "missing-capture-auth-review" ? "blocking" : "high");
    assert.equal(item.review_rounds, 0);
    assert.equal(item.validation_runs, 2);
    assert.equal(item.control_passed, true);
    assert.deepEqual(item.control_codes, []);
    assert.equal(item.public_validator, item.id === "cjk-terminal-dashboard"
      ? "inspectTui"
      : item.id === "missing-capture-auth-review" ? "evaluateCapabilityBlocks" : "inspectUiArtifact");
  }
  const byId = Object.fromEntries(output.results.map((item) => [item.id, item]));
  assert.equal(byId["healthcare-mobile"].assertions.source_mutated, false);
  assert.equal(byId["brownfield-design-system"].assertions.source_pointer, "src/components/Button.tsx:18");
  assert.equal(byId["reference-fidelity"].assertions.similarity_overrode_dimension_mismatch, false);
  assert.equal(byId["cjk-terminal-dashboard"].assertions.osc_inert, true);
  assert.equal(byId["cjk-terminal-dashboard"].assertions.zwj_width, 2);
});

test("uiux.scenario-driver-separates-false-passes-from-other-detection-failures", async () => {
  const { runScenarios } = await import("../tools/run-uiux-visual-qa-scenarios.mjs");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-scenario-accounting-"));
  try {
    const fixture = JSON.parse(
      fs.readFileSync("test/fixtures/uiux-visual-qa/scenarios.json", "utf8")
    );
    fixture.scenarios[0].expected_finding_codes = ["INTENTIONAL_MISMATCH"];
    fs.writeFileSync(path.join(temporary, "scenarios.json"), JSON.stringify(fixture));
    const mismatch = await runScenarios({
      installed_root: path.resolve("."),
      fixtures: temporary,
      scenario: "all",
      json: true
    });
    assert.equal(mismatch.detection_failure_count, 1);
    assert.equal(mismatch.false_pass_count, 0);

    fixture.scenarios[0].expected_finding_codes = exactPlan["public-service-form-ko"];
    fixture.scenarios[0].input = fixture.scenarios[0].control_input;
    fs.writeFileSync(path.join(temporary, "scenarios.json"), JSON.stringify(fixture));
    const falsePass = await runScenarios({
      installed_root: path.resolve("."),
      fixtures: temporary,
      scenario: "all",
      json: true
    });
    assert.equal(falsePass.detection_failure_count, 1);
    assert.equal(falsePass.false_pass_count, 1);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("uiux.scenario-capability-tree-guard-detects-a-restored-copy-mutation", async () => {
  const { assertCapabilityTreeUnchanged, hashInstalledCapabilityTree } =
    await import("../tools/run-uiux-visual-qa-scenarios.mjs");
  assert.equal(typeof hashInstalledCapabilityTree, "function");
  assert.equal(typeof assertCapabilityTreeUnchanged, "function");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-capability-tree-"));
  const installedRoot = path.join(temporary, "installed");
  try {
    fs.mkdirSync(path.join(installedRoot, "skills"), { recursive: true });
    for (const skill of ["frontend-ui-ux", "visual-qa"]) {
      fs.cpSync(path.join("skills", skill), path.join(installedRoot, "skills", skill), {
        recursive: true
      });
    }
    const expected = await hashInstalledCapabilityTree(installedRoot);
    const target = path.join(installedRoot, "skills/visual-qa/scripts/artifact.mjs");
    const original = fs.readFileSync(target);
    fs.appendFileSync(target, "\n// deliberate mutation control\n");
    await assert.rejects(
      assertCapabilityTreeUnchanged(installedRoot, expected),
      /capability tree mutated/i
    );
    fs.writeFileSync(target, original);
    await assert.doesNotReject(assertCapabilityTreeUnchanged(installedRoot, expected));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("uiux.scenario-driver-rejects-duplicate-singleton-flags", () => {
  const base = [
    "tools/run-uiux-visual-qa-scenarios.mjs",
    "--installed-root",
    path.resolve("."),
    "--fixtures",
    path.resolve("test/fixtures/uiux-visual-qa"),
    "--scenario",
    "all",
    "--json"
  ];
  for (const duplicate of [
    ["--installed-root", path.resolve(".")],
    ["--fixtures", path.resolve("test/fixtures/uiux-visual-qa")],
    ["--scenario", "all"],
    ["--json"]
  ]) {
    const result = spawnSync(process.execPath, [...base, ...duplicate], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0, `${duplicate[0]} duplicate must fail`);
    assert.match(result.stderr, /duplicate/i);
  }
});
