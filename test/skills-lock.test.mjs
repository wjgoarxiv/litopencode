// skills.lock.json is the one generated pin for the shipped skills: a measured row per top-level skill and the npm
// pack file list. `npm run gen:skills-lock` writes those; `policy` (the corpus floor read by docs.test.mjs) and the
// per-skill `budgets` are edited by hand and survive every run. The first two tests hold the real tree to the lock;
// the rest pin how the generator treats budgets, untracked files and refusals.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  LOCK_PATH,
  SKILLS_DIR,
  budgetViolations,
  buildLock,
  firstBudget,
  lockDrift,
  measureSkills,
  packedFiles,
  readLock,
  serializeLock
} from "../tools/gen-skills-lock.mjs";

const generator = path.resolve("tools/gen-skills-lock.mjs");
const runGenerator = (...args) => spawnSync(process.execPath, [generator, ...args], { encoding: "utf8" });

function makeSkill(root, id, skillMdBytes, extra = {}) {
  fs.mkdirSync(path.join(root, id), { recursive: true });
  fs.writeFileSync(path.join(root, id, "SKILL.md"), "s".repeat(skillMdBytes));
  for (const [rel, text] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(root, id, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, id, rel), text);
  }
}

test("skills.lock.json is current (run npm run gen:skills-lock after a skill or pack change)", () => {
  const recorded = readLock();
  const fresh = buildLock({ pack: packedFiles(), previous: recorded });
  assert.deepEqual(lockDrift(recorded, fresh), [], "skills.lock.json is stale: run npm run gen:skills-lock");
  assert.equal(serializeLock(fresh), fs.readFileSync(LOCK_PATH, "utf8"));
});

test("every shipped skill has one budget and stays inside it", () => {
  const recorded = readLock();
  const measured = measureSkills(SKILLS_DIR);
  assert.deepEqual(Object.keys(recorded.budgets).sort(), Object.keys(measured).sort(), "one budget per shipped skill");
  assert.deepEqual(budgetViolations(measured, recorded.budgets), []);
});

test("the hand-owned policy carries the corpus floor docs.test.mjs used to hard-code", () => {
  const { policy } = readLock();
  assert.equal(policy.corpusWordFloor, 42_789);
  assert.equal(policy.minSkillDocs, 23);
  const docsTest = fs.readFileSync("test/docs.test.mjs", "utf8");
  assert.doesNotMatch(docsTest, /42_789|>= 23\b/, "the floor lives in the lock policy, not in the test");
  assert.equal(readLock().budgets["lit-typographic-motion"]?.maxSkillBytes, 5000, "the motion pointer is capped like every moved-skill stub");
});

test("budget checks catch a placeholder SKILL.md, a trimmed skill and a bloated one", () => {
  const budgets = { a: { minSkillBytes: 15_000, maxSkillBytes: 30_000, minFiles: 4, maxFiles: 10, maxBytes: 90_000 } };
  assert.deepEqual(budgetViolations({ a: { skillMd: { bytes: 16_000 }, files: 5, bytes: 40_000 } }, budgets), []);
  assert.deepEqual(budgetViolations({ a: { skillMd: { bytes: 61 }, files: 5, bytes: 24_000 } }, budgets), [
    "a: SKILL.md 61 B < budget 15000 B"
  ]);
  assert.deepEqual(budgetViolations({ a: { skillMd: { bytes: 16_000 }, files: 2, bytes: 30_000 } }, budgets), [
    "a: 2 files < budget 4"
  ]);
  assert.equal(budgetViolations({ a: { skillMd: { bytes: 31_000 }, files: 11, bytes: 99_000 } }, budgets).length, 3);
});

test("a budget appears only with --accept-new and disappears only with --drop", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-lock-"));
  try {
    makeSkill(root, "kept", 14_000, { "references/a.md": "alpha" });
    makeSkill(root, "fresh", 20_123, { "references/a.md": "beta" });
    fs.writeFileSync(path.join(root, "managed-skill-manifest.json"), "{}");
    const previous = {
      policy: { corpusWordFloor: 10 },
      budgets: {
        kept: { minSkillBytes: 13_000, maxSkillBytes: 99_000, minFiles: 2, maxFiles: 9, maxBytes: 99_000 },
        gone: { minSkillBytes: 1, maxSkillBytes: 2, minFiles: 1, maxFiles: 2, maxBytes: 2 }
      }
    };
    const untold = buildLock({ skillsDir: root, pack: [], previous });
    assert.deepEqual(Object.keys(untold.skills), ["fresh", "kept"], "loose files below skills/ are not skills");
    assert.deepEqual(untold.budgets.gone, previous.budgets.gone);
    assert.equal(untold.budgets.fresh, undefined);
    assert.deepEqual(budgetViolations(untold.skills, untold.budgets), [
      "fresh: new skill without a budget (gen:skills-lock -- --accept-new fresh)",
      "gone: budget for a missing skill (gen:skills-lock -- --drop gone)"
    ]);

    const told = buildLock({ skillsDir: root, pack: ["z", "a"], previous, acceptNew: ["fresh"], drop: ["gone"] });
    assert.deepEqual(told.policy, previous.policy);
    assert.deepEqual(told.budgets.kept, previous.budgets.kept, "an existing budget is never rewritten");
    assert.equal(told.budgets.gone, undefined);
    assert.deepEqual(told.budgets.fresh, firstBudget(told.skills.fresh));
    assert.deepEqual(told.budgets.fresh, { minSkillBytes: 20_100, maxSkillBytes: 31_000, minFiles: 2, maxFiles: 3, maxBytes: 31_000 });
    assert.deepEqual(told.pack, ["a", "z"]);
    assert.deepEqual(buildLock({ skillsDir: root, pack: ["a", "z"], previous: told }), told, "deterministic");
    assert.throws(() => buildLock({ skillsDir: root, pack: [], previous: told, acceptNew: ["kept"] }), /--accept-new kept: not a new skill/);
    assert.throws(() => buildLock({ skillsDir: root, pack: [], previous: told, drop: ["kept"] }), /--drop kept: not a missing skill/);

    fs.writeFileSync(path.join(root, "kept", "references", "a.md"), "alpha2");
    assert.notEqual(buildLock({ skillsDir: root, pack: [], previous: told }).skills.kept.sha256, told.skills.kept.sha256, "a reference edit moves the skill hash");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removing a skill, regenerating and adding it back smaller cannot lower its floor", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-lock-readd-"));
  const skills = path.join(root, "skills");
  const lockFile = path.join(root, "skills.lock.json");
  const run = (...extra) => runGenerator("--skills", skills, "--lock", lockFile, "--no-pack", ...extra);
  try {
    makeSkill(skills, "lit-plan", 36_000);
    const budget = { minSkillBytes: 35_900, maxSkillBytes: 54_000, minFiles: 1, maxFiles: 2, maxBytes: 54_000 };
    fs.writeFileSync(lockFile, JSON.stringify({ policy: {}, budgets: { "lit-plan": budget }, skills: {}, pack: [] }));
    let result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const current = fs.readFileSync(lockFile, "utf8");

    fs.rmSync(path.join(skills, "lit-plan"), { recursive: true });
    result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /lit-plan: budget for a missing skill/);
    assert.equal(fs.readFileSync(lockFile, "utf8"), current, "the orphan budget stays");

    makeSkill(skills, "lit-plan", 13_100);
    result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /lit-plan: SKILL\.md 13100 B < budget 35900 B/);
    assert.equal(fs.readFileSync(lockFile, "utf8"), current, "the smaller copy meets the old floor");

    fs.rmSync(path.join(skills, "lit-plan"), { recursive: true });
    result = run("--drop", "lit-plan");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /dropped budget: lit-plan/);
    const dropped = fs.readFileSync(lockFile, "utf8");

    makeSkill(skills, "lit-plan", 13_100);
    result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /lit-plan: new skill without a budget/);
    assert.equal(fs.readFileSync(lockFile, "utf8"), dropped, "a new skill is not seeded on its own");

    result = run("--accept-new", "lit-plan");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /seeded budget: lit-plan \(SKILL\.md 13100-20000 B/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only git-tracked skill files are measured: an untracked .DS_Store leaves the lock as it is", () => {
  const recorded = readLock();
  const id = Object.keys(recorded.skills).sort()[0];
  const stray = path.join(SKILLS_DIR, id, ".DS_Store");
  assert.equal(fs.existsSync(stray), false, `${stray} already exists`);
  try {
    fs.writeFileSync(stray, "finder metadata");
    assert.deepEqual(measureSkills(SKILLS_DIR)[id], recorded.skills[id]);
  } finally {
    fs.rmSync(stray, { force: true });
  }
});

test("the generator refuses to write while a skill breaks its budget, and --check never writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-lock-cli-"));
  try {
    makeSkill(root, "tiny", 11);
    const lockFile = path.join(root, "lock.json");
    const before = JSON.stringify({
      policy: {},
      budgets: { tiny: { minSkillBytes: 13_000, maxSkillBytes: 20_000, minFiles: 1, maxFiles: 2, maxBytes: 20_000 } },
      skills: {},
      pack: []
    });
    fs.writeFileSync(lockFile, before);
    let result = runGenerator("--skills", root, "--lock", lockFile, "--no-pack");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /tiny: SKILL\.md 11 B < budget 13000 B/);
    assert.equal(fs.readFileSync(lockFile, "utf8"), before, "nothing written");

    fs.writeFileSync(path.join(root, "tiny", "SKILL.md"), "s".repeat(14_000));
    result = runGenerator("--skills", root, "--lock", lockFile, "--no-pack", "--check");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /stale/);
    assert.equal(fs.readFileSync(lockFile, "utf8"), before, "--check never writes");
    result = runGenerator("--skills", root, "--lock", lockFile, "--no-pack", "--check", "--drop", "tiny");
    assert.equal(result.status, 2, "--check refuses budget flags");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the lock and its generator are wired into npm scripts and stay out of the package", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["gen:skills-lock"], "npm run build && node tools/gen-skills-lock.mjs");
  assert.equal(pkg.scripts["check:skills-lock"], "npm run build && node tools/gen-skills-lock.mjs --check");
  const { pack } = readLock();
  assert.equal(pack.includes("skills.lock.json"), false);
  assert.equal(pack.includes("tools/gen-skills-lock.mjs"), false);
  assert.ok(pack.includes("skills/managed-skill-manifest.json"), "the pack list is the real package");
});
