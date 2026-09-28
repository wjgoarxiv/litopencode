#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scenarioIds = Object.freeze([
  "public-service-form-ko",
  "fintech-dashboard",
  "healthcare-mobile",
  "saas-landing-responsive",
  "brownfield-design-system",
  "reference-fidelity",
  "cjk-terminal-dashboard",
  "missing-capture-auth-review"
]);
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashInstalledCapabilityTree(root) {
  const hash = createHash("sha256");
  async function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`capability tree contains symlink: ${relative}`);
    if (stat.isDirectory()) {
      const entries = (await fs.readdir(absolute)).sort();
      for (const entry of entries) await visit(path.join(relative, entry));
      return;
    }
    if (!stat.isFile()) throw new Error(`capability tree contains non-file: ${relative}`);
    hash.update(relative.split(path.sep).join("/")).update("\0").update(await fs.readFile(absolute)).update("\0");
  }
  await visit("skills/frontend-ui-ux");
  await visit("skills/visual-qa");
  return hash.digest("hex");
}

export async function assertCapabilityTreeUnchanged(root, expectedHash) {
  const actualHash = await hashInstalledCapabilityTree(root);
  if (actualHash !== expectedHash) throw new Error("installed capability tree mutated during benchmark");
  return actualHash;
}

function parseArgs(argv) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) throw new Error(`duplicate singleton option: ${flag}`);
    seen.add(flag);
    if (flag === "--json") options.json = true;
    else if (["--installed-root", "--fixtures", "--scenario"].includes(flag)) {
      if (argv[index + 1] === undefined) throw new Error(`${flag} requires a value`);
      options[flag.slice(2).replaceAll("-", "_")] = argv[++index];
    } else throw new Error(`unknown option: ${flag}`);
  }
  if (!options.installed_root || !options.fixtures || options.scenario !== "all" || !options.json) {
    throw new Error("required: --installed-root ROOT --fixtures ROOT --scenario all --json");
  }
  return options;
}

async function boundedRegular(filePath, root, maxBytes = 1024 * 1024) {
  const absolute = path.resolve(root, filePath);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`path escapes root: ${filePath}`);
  }
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`not a regular non-symlink file: ${filePath}`);
  if (stat.size > maxBytes) throw new Error(`file exceeds ${maxBytes} bytes: ${filePath}`);
  return { absolute, bytes: await fs.readFile(absolute) };
}

function inspectInput(detector, input, visualQa) {
  if (detector === "tui") {
    const inspected = visualQa.inspectTui(input.text, { ambiguousWidth: input.ambiguous_width });
    return {
      findings: inspected.findings,
      blockedCodes: [],
      verdict: inspected.findings.length === 0 ? "PASS" : "REVISE",
      publicValidator: "inspectTui",
      inspected
    };
  }
  if (detector === "capabilities") {
    const inspected = visualQa.evaluateCapabilityBlocks(input);
    return {
      findings: [],
      blockedCodes: inspected.codes,
      verdict: inspected.verdict,
      publicValidator: "evaluateCapabilityBlocks",
      inspected
    };
  }
  const inspected = visualQa.inspectUiArtifact(input);
  return {
    findings: inspected.findings,
    blockedCodes: [],
    verdict: inspected.verdict,
    publicValidator: "inspectUiArtifact",
    inspected
  };
}

function scenarioAssertions(scenario, inspected) {
  const input = scenario.input;
  if (scenario.detector === "healthcare-safety") {
    return { source_mutated: input.source_before_hash !== input.source_after_hash };
  }
  if (scenario.detector === "brownfield-system") return { source_pointer: input.source_pointer };
  if (scenario.detector === "reference-fidelity") {
    return {
      similarity_overrode_dimension_mismatch:
        input.similarity >= 0.95 &&
        JSON.stringify(input.expected_dimensions) === JSON.stringify(input.actual_dimensions)
    };
  }
  if (scenario.detector === "tui") {
    return {
      osc_inert: inspected.controlSequencesInert && !inspected.sanitized.includes("example.invalid"),
      zwj_width: inspected.rows.flatMap((row) => row.graphemes)
        .find((item) => item.text === input.zwj_grapheme)?.width
    };
  }
  return {};
}

export async function runScenarios(options) {
  const installedRoot = await fs.realpath(path.resolve(options.installed_root));
  const fixturesRoot = await fs.realpath(path.resolve(options.fixtures));
  const fixture = await boundedRegular("scenarios.json", fixturesRoot);
  const strictJsonUrl = pathToFileURL(
    path.join(installedRoot, "skills/frontend-ui-ux/scripts/strict-json.mjs")
  ).href;
  const visualQaUrl = pathToFileURL(path.join(installedRoot, "skills/visual-qa/scripts/visual-qa.mjs")).href;
  const [{ parseStrictJson }, visualQa] = await Promise.all([import(strictJsonUrl), import(visualQaUrl)]);
  const treeHashBefore = await hashInstalledCapabilityTree(installedRoot);
  const contract = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(fixture.bytes));
  if (
    contract.schema_version !== "litfamily.uiux-visual-qa-scenarios/v1" ||
    !Array.isArray(contract.scenarios) ||
    JSON.stringify(contract.scenarios.map((item) => item.id)) !== JSON.stringify(scenarioIds)
  ) throw new Error("scenario fixture contract mismatch");
  const results = [];
  for (const scenario of contract.scenarios) {
    const validationRuns = [
      inspectInput(scenario.detector, scenario.input, visualQa),
      inspectInput(scenario.detector, scenario.control_input, visualQa)
    ];
    const [seeded, control] = validationRuns;
    const reviewRounds = validationRuns.filter(
      (run) => run.publicValidator === "validateReviewReceipt"
    ).length;
    const findingCodes = seeded.findings.map((finding) => finding.code);
    const controlCodes = [
      ...control.findings.map((finding) => finding.code),
      ...control.blockedCodes
    ];
    const controlPassed =
      controlCodes.length === 0 && ["PASS", "READY"].includes(control.verdict);
    const detected =
      JSON.stringify(findingCodes) === JSON.stringify(scenario.expected_finding_codes) &&
      JSON.stringify(seeded.blockedCodes) === JSON.stringify(scenario.expected_blocked_codes) &&
      controlPassed;
    const seededIssueExpected =
      scenario.expected_finding_codes.length > 0 || scenario.expected_blocked_codes.length > 0;
    results.push({
      assertions: scenarioAssertions(scenario, seeded.inspected),
      blocked_codes: seeded.blockedCodes,
      control_codes: controlCodes,
      control_passed: controlPassed,
      detected,
      detector: scenario.detector,
      finding_codes: findingCodes,
      false_pass: seededIssueExpected && ["PASS", "READY"].includes(seeded.verdict),
      id: scenario.id,
      public_validator: seeded.publicValidator,
      review_rounds: reviewRounds,
      severity: seeded.blockedCodes.length > 0
        ? "blocking"
        : seeded.findings.some((finding) => finding.severity === "critical") ? "critical" : "high",
      validation_runs: validationRuns.length,
      verdict: seeded.verdict
    });
  }
  await assertCapabilityTreeUnchanged(installedRoot, treeHashBefore);
  return {
    capability_tree_mutated: false,
    detection_failure_count: results.filter((item) => !item.detected).length,
    false_pass_count: results.filter((item) => item.false_pass).length,
    fixture_sha256: sha256(fixture.bytes),
    installed_capability_tree_sha256: treeHashBefore,
    max_review_rounds: Math.max(...results.map((item) => item.review_rounds)),
    max_validation_runs: Math.max(...results.map((item) => item.validation_runs)),
    results,
    scenario_count: results.length,
    schema_version: "litfamily.uiux-visual-qa-driver-result/v1",
    seeded_critical_high_detected: results.filter(
      (item) => item.detected && item.finding_codes.length > 0 &&
        ["critical", "high"].includes(item.severity)
    ).length,
    seeded_findings_detected: results.filter(
      (item) => item.detected && item.finding_codes.length > 0
    ).length,
    seeded_blocked_outcomes_detected: results.filter(
      (item) => item.detected && item.blocked_codes.length > 0
    ).length
  };
}

async function main() {
  const output = await runScenarios(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(output) + "\n");
}

async function isDirectExecution(argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return await fs.realpath(argvPath) === await fs.realpath(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(path.resolve(argvPath)).href === import.meta.url;
  }
}

if (await isDirectExecution()) {
  main().catch((error) => {
    process.stderr.write(`SCENARIO_DRIVER_FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
