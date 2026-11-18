import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureCommandAliases } from "../src/cli/command-aliases.ts";
import { managedSkillDefinition } from "../src/cli/managed-skill-assets.ts";
import { createCommandActivationHook, findLitOpenCodeCommand } from "../src/commands.ts";
import { promptForChatActivationMode } from "../src/activation-routing.ts";
import { detectChatActivationMode, findLitOpenCodeFeature, findLitOpenCodeRuntimeSkill } from "../src/index.ts";
import { addMember, archiveTeam, herdrAvailable, initTeam, pickDistribution, teamStatus } from "../skills/lit-team/scripts/team.mjs";

async function withDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-team-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("lit team <goal> routes to lit-team and lookalikes stay inert", () => {
  for (const text of ["lit team port the parser and the docs", "lit-team ship the three fixes", "please lit team this migration"]) {
    assert.equal(detectChatActivationMode(text), "lit-team", text);
  }
  for (const text of ["the lit teamwork page", "`lit team`", "plans/lit-team.md is stale", "lit teams page"]) {
    assert.notEqual(detectChatActivationMode(text), "lit-team", text);
  }
  const prompt = promptForChatActivationMode("lit-team", "lit team port the parser");
  assert.match(prompt, /This session is the orchestrator/u);
  assert.match(prompt, /herdr panes only when HERDR_ENV=1 and herdr is on PATH/u);
  assert.match(prompt, /No member commits or pushes/u);
  assert.match(prompt, /skill name: lit-team/u);
});

test("the orchestrator picks the distribution deterministically and says why in one line", () => {
  assert.equal(pickDistribution({ slices: 3 }).distribution, "subagents");
  assert.equal(pickDistribution({ slices: 3, sameFiles: true, watch: true, herdr: true }).distribution, "worktrees", "same files beat everything");
  assert.equal(pickDistribution({ slices: 40, similar: true }).distribution, "batches");
  assert.equal(pickDistribution({ slices: 9 }).distribution, "batches", "more than six slices are batched");
  assert.equal(pickDistribution({ slices: 2, watch: true, herdr: true }).distribution, "herdr");
  const fallback = pickDistribution({ slices: 2, watch: true, herdr: false });
  assert.equal(fallback.distribution, "subagents");
  assert.match(fallback.line, /^Team: 2 subagents .*herdr is not available here/u);
  assert.equal(herdrAvailable({ HERDR_ENV: "1" }, () => false), false);
  assert.equal(herdrAvailable({}, () => true), false);
  assert.equal(herdrAvailable({ HERDR_ENV: "1" }, () => true), true);
});

test("the packet gives each member a four-part brief, its own scratch folder and the team rules", async () => {
  await withDir(async (dir) => {
    initTeam(dir, "parser", { goal: "port the parser", distribution: "subagents", now: Date.parse("2026-11-18T09:00:00Z") });
    const { brief } = addMember(dir, "parser", "core", { task: "port lexer", deliverable: "src/lexer.ts", scope: "src/lexer.ts", verify: "npm test" });
    assert.match(brief, /^TASK: port lexer\nDELIVERABLE: src\/lexer\.ts\nSCOPE: src\/lexer\.ts\nVERIFY: npm test\n/u);
    assert.match(brief, /Never commit, push/u);
    assert.match(brief, /Temporary files go only in \.litopencode\/team\/parser\/members\/core\/scratch/u);
    assert.throws(() => addMember(dir, "parser", "core", { task: "a", deliverable: "b", scope: "c", verify: "d" }), /already exists/u);
    assert.throws(() => addMember(dir, "parser", "docs", { task: "a", deliverable: "b", scope: "c" }), /--verify is required/u);
    assert.throws(() => initTeam(dir, "../escape", { goal: "x", distribution: "subagents" }), /slug/u);
  });
});

test("status marks working, stalled and done members, and archive keeps a receipt", async () => {
  await withDir(async (dir) => {
    initTeam(dir, "t", { goal: "g", distribution: "subagents" });
    addMember(dir, "t", "a", { task: "a", deliverable: "a", scope: "a", verify: "a" });
    addMember(dir, "t", "b", { task: "b", deliverable: "b", scope: "b", verify: "b" });
    const now = Date.now();
    assert.deepEqual(teamStatus(dir, "t", { now }).members.map((m) => m.state), ["working", "working"]);
    assert.deepEqual(teamStatus(dir, "t", { now: now + 20 * 60_000 }).members.map((m) => m.state), ["stalled", "stalled"]);
    await fs.writeFile(path.join(dir, ".litopencode/team/t/members/a/report.md"), "done\n");
    const later = teamStatus(dir, "t", { now: now + 20 * 60_000 });
    assert.deepEqual(later.members.map((m) => m.state), ["done", "stalled"]);
    assert.equal(later.done, false);
    const archived = archiveTeam(dir, "t");
    assert.match(archived.path, /^\.litopencode\/team\/archive\/t-/u);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, archived.path, "receipt.json"), "utf8")).members.length, 2);
  });
});

test("lit-team is enrolled: command, alias, feature, runtime skill, managed asset and installed skill", async () => {
  const command = findLitOpenCodeCommand("lit-team");
  assert.equal(command?.slash, "/lit-team");
  assert.match(command.banner, /LIT IGNITED · lit-team/u);
  assert.ok(findLitOpenCodeFeature("lit-team").bindings.some((binding) => binding.kind === "command"));
  assert.equal(findLitOpenCodeRuntimeSkill("lit-team")?.featureIds[0], "lit-team");
  assert.ok(managedSkillDefinition("lit-team"));
  await withDir(async (dir) => {
    await ensureCommandAliases(dir);
    assert.match(await fs.readFile(path.join(dir, "command", "lit-team.md"), "utf8"), /^litopencodeGenerated: true$/mu);
    const output = { parts: [] };
    await createCommandActivationHook(dir)({ command: "/lit-team", sessionID: "s1", arguments: "port the parser" }, output);
    assert.equal(output.parts.at(-1).metadata.litopencode.mode, "lit-team");
  });
  const skill = await fs.readFile(path.resolve("skills/lit-team/SKILL.md"), "utf8");
  for (const phrase of ["TASK", "DELIVERABLE", "SCOPE", "VERIFY", "git worktree", "HERDR_ENV=1", "team.mjs status", "No member commits"]) assert.ok(skill.includes(phrase), phrase);
});
