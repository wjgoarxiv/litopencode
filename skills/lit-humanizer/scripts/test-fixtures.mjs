#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseRules, scanText } from "./core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rules = parseRules(readFileSync(resolve(root, "rules.json"), "utf8"));
const cases = JSON.parse(readFileSync(resolve(root, "fixtures/rule-cases.json"), "utf8"));
const counts = { positive: 0, negative: 0, tier: 0, caption: 0 };

for (const rule of rules) {
  assert(cases.positive[rule.id], `missing positive case: ${rule.id}`);
  assert(cases.negative[rule.id], `missing clean negative case: ${rule.id}`);
  assert(scanText(cases.positive[rule.id], [rule], `${rule.id}-positive.txt`).length > 0, `${rule.id} missed its positive case`);
  assert.equal(scanText(cases.negative[rule.id], [rule], `${rule.id}-negative.txt`).length, 0, `${rule.id} hit its clean negative case`);
  counts.positive += 1;
  counts.negative += 1;
}

const metaRules = rules.filter((rule) => ["ko-plain-meta-label", "en-plain-meta-label"].includes(rule.id));
for (const fixture of cases.contextCases.plainSourceAttached) {
  const findings = scanText(fixture.text, metaRules, `caption-${fixture.name}.md`);
  if (fixture.clean) assert.equal(findings.length, 0, `${fixture.name} should be exempt`);
  else assert(findings.length > 0, `${fixture.name} should remain detectable`);
  counts.caption += 1;
}

for (const fixture of cases.contextCases.tierRegressions) {
  const rule = rules.find((candidate) => candidate.id === fixture.rule);
  assert(rule, `${fixture.name} references missing rule ${fixture.rule}`);
  const findings = scanText(fixture.text, [rule], `tier-${fixture.name}.txt`);
  if (fixture.expect === "clean") assert.equal(findings.length, 0, `${fixture.name} should remain clean`);
  else assert(findings.some((finding) => finding.severity === fixture.expect), `${fixture.name} should ${fixture.expect}`);
  counts.tier += 1;
}

const realLines = readFileSync(resolve(root, "fixtures/pos-real.txt"), "utf8").split(/\r?\n/u).filter(Boolean);
assert.equal(realLines.length, 26, "the real-line fixture set must remain complete");
const recalled = realLines.filter((line) => scanText(line, rules, "fixtures/pos-real.txt").length > 0).length;
assert(recalled >= 19, `detector recall fell below 19/26: ${recalled}/26`);

const officeExtractor = resolve(root, "scripts/extract_office_text.py");
for (const [name, expected] of [["minimal.docx", "I hope this helps."], ["minimal.pptx", "Source: report table 4."]]) {
  const file = resolve(root, "fixtures/office", name);
  const extracted = spawnSync("python3", [officeExtractor, file], { encoding: "utf8", timeout: 1500, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(extracted.status, 0, `${name} extraction failed: ${extracted.stderr}`);
  assert(extracted.stdout.includes(expected), `${name} did not yield expected text`);
}

process.stdout.write(`Detector fixtures passed: ${rules.length} block/warn rules, ${counts.positive} positive, ${counts.negative} clean negative, ${counts.tier} tier regressions, ${counts.caption} caption/context cases, ${recalled}/26 real lines recalled.\n`);
process.stdout.write("DOCX and PPTX standard-library extraction fixtures passed; no human-prose corpus is packaged.\n");
