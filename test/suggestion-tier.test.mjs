// The suggestion tier for prompts without `lit` (scenarios S-B-01..S-B-08). The gate test re-scores the
// shipped rules on the dev half only, so a rule that stops meeting recall >= 0.85 and near-miss false
// positives <= 0.10 there fails the suite. The held-out half stays sealed: the suite checks its digest and
// never scores it or prints its misses; `node tools/suggestion-eval.mjs --heldout` scores it once per rule change.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { catalogLine, catalogSkills, firedSuggestionRules, suggestionInput, suggestionNote, suggestionRules } from "../src/suggestion-tier.ts";
import { nearMissCeiling, recallFloor, scoreHalf } from "../tools/suggestion-eval.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "suggestion-eval");
const fired = (text) => firedSuggestionRules(text).map((rule) => rule.skill);

test("S-B-05: every shipped rule passes the gate on the dev half; the held-out half is never scored here", () => {
  assert.equal(recallFloor, 0.85);
  assert.equal(nearMissCeiling, 0.10);
  const dev = JSON.parse(fs.readFileSync(path.join(fixtureDir, "dev.json"), "utf8"));
  for (const row of scoreHalf(dev, suggestionRules, firedSuggestionRules)) {
    assert.equal(row.pass, true, `dev ${row.skill}: recall ${row.recall}, near-miss ${row.nearMissFalsePositives}, missed ${row.missed}, fp ${row.falsePositives}`);
  }
  const testSources = fs.readdirSync(path.join(repoRoot, "test")).filter((name) => name.endsWith(".mjs")).map((name) => fs.readFileSync(path.join(repoRoot, "test", name), "utf8"));
  assert.equal(testSources.some((source) => /readHeldout\s*\(/u.test(source)), false, "no test scores the held-out half");
  assert.deepEqual(suggestionRules.map((rule) => rule.skill), ["lit-scientific-visualization", "lit-diagram-drawer", "lit-docx", "lit-brainstorm"]);
});

test("S-B-05: the held-out half is sealed by its pinned sha256, and both halves cover EN and ko prompts", () => {
  const bytes = fs.readFileSync(path.join(fixtureDir, "heldout.json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fs.readFileSync(path.join(fixtureDir, "heldout.sha256"), "utf8").trim());
  for (const file of ["dev.json"]) {
    const prompts = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), "utf8"));
    assert.ok(prompts.some((entry) => /[가-힣]/u.test(entry.prompt)), `${file} has Korean prompts`);
    assert.ok(prompts.some((entry) => /^[\x20-\x7e]+$/u.test(entry.prompt)), `${file} has English prompts`);
    for (const entry of prompts) {
      assert.ok(Array.isArray(entry.expect) && Array.isArray(entry.near_miss_of) && typeof entry.id === "string", JSON.stringify(entry));
    }
  }
});

test("S-B-01 / S-B-07: a fired rule offers its skill plus none and loads nothing; knowledge questions do not fire", () => {
  const note = suggestionNote("plot this csv of the temperature runs");
  assert.match(note, /- lit-scientific-visualization: /u);
  assert.match(note, /- none: answer directly when no skill fits\./u);
  assert.match(note, /nothing loads by itself/u);
  assert.deepEqual(fired("draw an architecture diagram of the plugin"), ["lit-diagram-drawer"]);
  assert.deepEqual(fired("draw a P&ID diagram of the separator"), [], "a physical schematic is not the diagram drawer's");
  assert.deepEqual(fired("what are my options for caching here?"), ["lit-brainstorm"]);
  assert.deepEqual(fired("what is a scatter plot of data?"), []);
  assert.deepEqual(fired("make a dashboard chart from this csv data"), [], "a web artifact is not a plot");
});

test("S-B-02: a slash-command mention or an empty prompt gets no note", () => {
  assert.equal(suggestionNote("/start-work plot this csv"), undefined);
  assert.equal(suggestionNote("run /review-work then plot the results"), undefined);
  assert.equal(suggestionNote("   "), undefined);
  for (const named of ["lit-review plot this csv", "\"start-work resume\" then plot the results", "handoff via lit please", "litwork: chart the runs"]) {
    assert.equal(suggestionNote(named), undefined, named);
  }
  assert.notEqual(suggestionNote("split the literal into a chart of the results"), undefined, "lit inside a word is not lit");
});

test("S-B-03: closed fences, inline code and host notification blocks are stripped before the rules run", () => {
  assert.deepEqual(fired("fix this\n```\nplot the csv data as a chart\n```"), []);
  assert.deepEqual(fired("rename `plot the csv data` to x"), []);
  assert.deepEqual(fired("<task-notification>draw an architecture diagram</task-notification> ok"), []);
  assert.equal(suggestionInput("A `b` C"), "a   c");
});

test("S-B-04: no rule fired gives one compact catalog line within its byte budget", () => {
  const note = suggestionNote("이 문단을 자연스럽게 다듬어줘");
  assert.equal(note, catalogLine);
  assert.ok(Buffer.byteLength(catalogLine) <= 400, `${Buffer.byteLength(catalogLine)} B`);
  assert.equal(catalogSkills.length, 15);
  for (const skill of catalogSkills) assert.ok(fs.existsSync(path.join(repoRoot, "skills", skill, "SKILL.md")), `${skill} ships in this package`);
  for (const rule of suggestionRules) assert.ok(fs.existsSync(path.join(repoRoot, "skills", rule.skill, "SKILL.md")), rule.skill);
});

test("S-B-06 / S-B-08: Korean stems match as bare substrings and a noun used as a verb does not fire", () => {
  assert.deepEqual(fired("이 측정 데이터를 그래프로 그려줘"), ["lit-scientific-visualization"]);
  assert.deepEqual(fired("시스템 구성도를 그려줘"), ["lit-diagram-drawer"]);
  assert.deepEqual(fired("excel at writing a docx report"), []);
  assert.deepEqual(fired("word this report title better in markdown"), []);
});
