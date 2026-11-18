import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { detectChatActivationMode } from "../src/activation.ts";
import { promptForChatActivationMode } from "../src/activation-routing.ts";
import { registerLitOpenCodeAgents } from "../src/agents.ts";
import { createCommandActivationHook, findLitOpenCodeCommand } from "../src/commands.ts";
import { expectedManagedSkillFiles, managedSkillDiscoveryDescription } from "../src/cli/managed-skill-assets.ts";
import { defaultGlobalConfigFile, mergeConfigs } from "../src/config.ts";
import { findLitOpenCodeRuntimeSkill, litOpenCodeFeatures } from "../src/index.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

const skillDir = path.resolve("skills/ultra-brainstorm");

test("ultra-brainstorm routes ahead of lit brainstorm, and inert mentions stay inert", () => {
  for (const text of ["ultra-brainstorm names for the CLI", "lit ultra-brainstorm a pricing model", "lit ultra brainstorm onboarding ideas"]) {
    assert.equal(detectChatActivationMode(text), "ultra-brainstorm", text);
  }
  assert.equal(detectChatActivationMode("lit brainstorm names for the CLI"), "lit-brainstorm");
  for (const text of ["`ultra-brainstorm` is a skill", "how does ultra-brainstorm work?", "/ultra-brainstorm now"]) {
    assert.notEqual(detectChatActivationMode(text), "ultra-brainstorm", text);
  }
});

test("the activation asks the launch question first and points at the installed skill", () => {
  const text = promptForChatActivationMode("ultra-brainstorm", "lit ultra-brainstorm a pricing model");
  assert.match(text, /LIT IGNITED · ultra-brainstorm/u);
  assert.match(text, /ONE launch question before anything runs/u);
  assert.match(text, /lit-ideator/u);
  assert.match(text, /skill name: ultra-brainstorm/u);
});

test("/ultra-brainstorm is a command with its own mode", async () => {
  assert.equal(findLitOpenCodeCommand("ultra-brainstorm")?.slash, "/ultra-brainstorm");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-ultra-command-"));
  try {
    const output = { parts: [] };
    await createCommandActivationHook(dir)({ sessionID: "s1", command: "/ultra-brainstorm", arguments: "a name" }, output);
    assert.equal(output.parts.at(-1).metadata.litopencode.mode, "ultra-brainstorm");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("ultra-brainstorm is enrolled in the catalog, the features and the managed skill tree", () => {
  assert.deepEqual(findLitOpenCodeRuntimeSkill("ultra-brainstorm")?.featureIds, ["ultra-brainstorm"]);
  const feature = litOpenCodeFeatures.find((entry) => entry.id === "ultra-brainstorm");
  assert.ok(feature.bindings.some((binding) => binding.kind === "command" && binding.id === "ultra-brainstorm"));
  assert.ok(feature.bindings.some((binding) => binding.kind === "agent" && binding.id === "lit-ideator"));
  assert.deepEqual([...expectedManagedSkillFiles("ultra-brainstorm")].sort(), ["SKILL.md", "references/lenses.md", "scripts/estimate.mjs"]);
  assert.match(managedSkillDiscoveryDescription("ultra-brainstorm"), /launch question/u);
});

test("lit-ideator runs the helper route at its lowest effort with every tool off", () => {
  const target = {};
  registerLitOpenCodeAgents(target, defaultGlobalConfigFile());
  const ideator = target.agent["lit-ideator"];
  assert.equal(ideator.mode, "subagent");
  assert.equal(ideator.model, "openai/gpt-6-luna");
  assert.equal(ideator.variant, "none");
  for (const tool of ["read", "write", "edit", "bash", "webfetch", "task", "skill"]) assert.equal(ideator.tools[tool], false, tool);
  const chosen = {};
  registerLitOpenCodeAgents(chosen, mergeConfigs(defaultGlobalConfigFile(), { agents: { "lit-ideator": { category: "research", variant: "low" } } }));
  assert.equal(chosen.agent["lit-ideator"].variant, "low", "the user's own variant wins");
});

test("the estimator prints the cost line, refuses bad counts and caps a run at 900", () => {
  const script = path.join(skillDir, "scripts", "estimate.mjs");
  assert.equal(
    execFileSync(process.execPath, [script, "100"], { encoding: "utf8" }).trim(),
    "100 idea lanes (lit-ideator: helper route, lowest effort) + 4 reducers (lit-explorer: helper route) + 1 judge (lit-oracle: lead route) ≈ 3.5–6.7M tokens, most of it this session re-reading its context once per lane"
  );
  // Calibrated from one real 100-lane OpenCode 2 run (4.88M tokens in all); per-lane figures count only the 51
  // lanes that answered. low = lanes × (3.7k + 30k) + reducers × 19.8k + 24.5k; high = lanes × (5.2k + 60k) + reducers × 28.9k + 40k.
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [script, "300", "--json"], { encoding: "utf8" })), { lanes: 300, reducers: 10, judges: 1, tokensLow: 10_332_500, tokensHigh: 19_889_000 });
  const measured = JSON.parse(execFileSync(process.execPath, [script, "100", "--json"], { encoding: "utf8" }));
  assert.ok(measured.tokensLow <= 4_882_266 && 4_882_266 <= measured.tokensHigh, "the measured 100-lane run sits inside the range");
  for (const bad of ["0", "1.5", "901", "many"]) {
    assert.throws(() => execFileSync(process.execPath, [script, bad], { stdio: "pipe" }), bad);
  }
});

test("the skill keeps the launch gate, the three stages and at least 30 lenses", async () => {
  const body = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
  for (const phrase of ["Never launch before the user answered the launch question", "lit-ideator", "lit-explorer", "lit-oracle", ".litopencode/brainstorm/<slug>/", "BLOCKED:", "pick, combine or widen"]) {
    assert.ok(body.includes(phrase), phrase);
  }
  const lenses = (await fs.readFile(path.join(skillDir, "references", "lenses.md"), "utf8")).split("\n").filter((line) => /^\d+\. /u.test(line));
  assert.ok(lenses.length >= 30, `${lenses.length} lenses`);
});

test("install ships the ultra-brainstorm folder and its command alias", async () => {
  await withTempDir(async (dir) => {
    const install = runCli(["install", "--root", dir]);
    assert.equal(install.status, 0, install.stderr);
    for (const file of ["SKILL.md", "references/lenses.md", "scripts/estimate.mjs"]) await fs.access(path.join(dir, "skills", "ultra-brainstorm", file));
    assert.match(await fs.readFile(path.join(dir, "command", "ultra-brainstorm.md"), "utf8"), /ultra-brainstorm/u);
    const doctor = JSON.parse(runCli(["doctor", "--root", dir]).stdout);
    assert.ok(doctor.install.nativeSkills.present.includes("ultra-brainstorm"));
    assert.ok(doctor.install.commandAliases.present.includes("ultra-brainstorm"));
  });
});

test("a plain no to the launch question ends the run at once; silence still launches nothing", async () => {
  const { ultraBrainstormPromptInjection } = await import("../src/activation.ts");
  const skill = await (await import("node:fs/promises")).readFile("skills/ultra-brainstorm/SKILL.md", "utf8");
  for (const text of [skill, ultraBrainstormPromptInjection]) {
    assert.match(text, /a plain `?no`? \(?[^)]*\)?\s*ends (?:the run|it) at once/iu);
    assert.match(text, /Ultra-brainstorm cancelled; nothing ran\./u);
  }
  assert.match(skill, /no second question/u);
  assert.match(skill, /silence is no/u);
});

test("the launch answer parser reads a count from the picked option's full label", () => {
  const script = path.join(skillDir, "scripts", "estimate.mjs");
  const read = (text) => JSON.parse(execFileSync(process.execPath, [script, "--answer"], { encoding: "utf8", input: text }));
  // OpenCode's question tool hands back the picked option's label verbatim.
  for (const [text, lanes] of [["100 (recommended minimum)", 100], ["(Recommended) 100 (recommended minimum)", 100], ["300명 (Recommended)", 300], ["300", 300], ["  1,000 ", undefined], ["250 lanes please", 250]]) {
    assert.deepEqual(read(text), lanes === undefined ? { answer: "ask", reason: "over 900" } : { answer: "launch", lanes }, text);
  }
  assert.deepEqual(read("100 or 300?"), { answer: "ask", reason: "more than one count" });
  assert.deepEqual(read("sounds good"), { answer: "ask", reason: "no count" });
  for (const text of ["no", "No.", "cancel", "취소", "아니요"]) assert.deepEqual(read(text), { answer: "stop" }, text);
  const skill = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  assert.match(skill, /estimate\.mjs --answer/u, "the skill reads the reply through the script");
  assert.match(promptForChatActivationMode("ultra-brainstorm", "ultra-brainstorm names"), /estimate\.mjs --answer/u);
});

test("a launch reply with shell syntax is read from a quoted heredoc as data, never run", async () => {
  const script = path.join(skillDir, "scripts", "estimate.mjs");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-answer-"));
  try {
    for (const [reply, expected] of [["100 $(touch x) (recommended minimum)", { answer: "launch", lanes: 100 }], ["`touch y` no", { answer: "ask", reason: "no count" }]]) {
      const command = `"${process.execPath}" "${script}" --answer <<'LIT_REPLY_END_9Q7'\n${reply}\nLIT_REPLY_END_9Q7\n`;
      assert.deepEqual(JSON.parse(execFileSync("/bin/sh", ["-c", command], { cwd: dir, encoding: "utf8" })), expected, reply);
    }
    assert.deepEqual(await fs.readdir(dir), [], "nothing in the reply ran");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  const skill = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  assert.doesNotMatch(skill, /--answer "/u, "the reply never goes on the command line");
  assert.match(skill, /--answer <<'LIT_REPLY_END_9Q7'/u);
  const prompt = promptForChatActivationMode("ultra-brainstorm", "ultra-brainstorm names");
  assert.doesNotMatch(prompt, /--answer "/u);
  assert.match(prompt, /<<'LIT_REPLY_END_9Q7'/u);
});

test("the reply never goes in as an argument, and a reply line equal to the delimiter means ask again", () => {
  const script = path.join(skillDir, "scripts", "estimate.mjs");
  for (const extra of [["100"], ["(Recommended) 100"], ["--", "100"]]) {
    assert.throws(() => execFileSync(process.execPath, [script, "--answer", ...extra], { stdio: "pipe", input: "100" }), /unknown argument|stdin/u, extra.join(" "));
  }
  const rule = /a line equal to `LIT_REPLY_END_9Q7`[^.]*do not run[^.]*ask (?:once more|again)/iu;
  assert.match(readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), rule);
  assert.match(promptForChatActivationMode("ultra-brainstorm", "ultra-brainstorm names"), rule);
});
