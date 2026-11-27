#!/usr/bin/env node
// Scores the suggestion-tier rules against the routing fixture.
//   node tools/suggestion-eval.mjs            dev half only
//   node tools/suggestion-eval.mjs --heldout  dev half, then the sealed held-out half
// The held-out half is refused when its sha256 differs from test/fixtures/suggestion-eval/heldout.sha256.
// A rule passes when recall >= 0.85 and near-miss false positives <= 0.10 on every scored half.
// Exit 1 when a shipped rule fails, so a rule that stopped meeting the gate cannot stay enrolled.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(root, "test", "fixtures", "suggestion-eval");
export const recallFloor = 0.85;
export const nearMissCeiling = 0.10;

export function scoreHalf(prompts, rules, fired) {
  return rules.map((rule) => {
    const positives = prompts.filter((entry) => entry.expect.includes(rule.skill));
    const nearMisses = prompts.filter((entry) => entry.near_miss_of.includes(rule.skill));
    const hit = positives.filter((entry) => fired(entry.prompt).some((item) => item.skill === rule.skill));
    const false_ = nearMisses.filter((entry) => fired(entry.prompt).some((item) => item.skill === rule.skill));
    const recall = positives.length === 0 ? 0 : hit.length / positives.length;
    const nearMissRate = nearMisses.length === 0 ? 0 : false_.length / nearMisses.length;
    return {
      skill: rule.skill,
      positives: positives.length,
      nearMisses: nearMisses.length,
      recall: Number(recall.toFixed(3)),
      nearMissFalsePositives: Number(nearMissRate.toFixed(3)),
      missed: positives.filter((entry) => !hit.includes(entry)).map((entry) => entry.id),
      falsePositives: false_.map((entry) => entry.id),
      pass: positives.length > 0 && recall >= recallFloor && nearMissRate <= nearMissCeiling
    };
  });
}

export function readHeldout() {
  const bytes = readFileSync(path.join(fixtureDir, "heldout.json"));
  const pinned = readFileSync(path.join(fixtureDir, "heldout.sha256"), "utf8").trim();
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== pinned) throw new Error(`held-out digest ${digest} differs from the pinned ${pinned}; refusing to score it`);
  return JSON.parse(bytes.toString("utf8"));
}

async function main() {
  const tier = await import(pathToFileURL(path.join(root, "src", "suggestion-tier.ts")).href);
  const dev = JSON.parse(readFileSync(path.join(fixtureDir, "dev.json"), "utf8"));
  const report = { dev: scoreHalf(dev, tier.suggestionRules, tier.firedSuggestionRules) };
  if (process.argv.includes("--heldout")) report.heldout = scoreHalf(readHeldout(), tier.suggestionRules, tier.firedSuggestionRules);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const failed = Object.values(report).flat().filter((row) => !row.pass);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
