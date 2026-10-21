import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createChatMessageActivationHook, detectChatActivationMode } from "../src/activation.ts";
import { promptForChatActivationMode } from "../src/activation-routing.ts";
import { createCommandActivationHook, findLitOpenCodeCommand, litOpenCodeCommands } from "../src/commands.ts";
import { expectedManagedSkillFiles, managedSkillDiscoveryDescription } from "../src/cli/managed-skill-assets.ts";
import { findLitOpenCodeRuntimeSkill, litOpenCodeFeatures } from "../src/index.ts";
import { renamedSkillAliases } from "../src/skill-renames.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

const skillPath = (id, ...rest) => path.join("skills", id, ...rest);
const read = (...parts) => fs.readFile(path.join(...parts), "utf8");

async function chatText(text, sessionID = "session-brainstorm") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-brainstorm-"));
  try {
    const output = {
      message: { id: "msg_1", sessionID, role: "user" },
      parts: [{ id: "prt_1", sessionID, messageID: "msg_1", type: "text", text }]
    };
    await createChatMessageActivationHook(dir)({ sessionID, messageID: "msg_1", agent: "lit-loop" }, output);
    return output.parts.slice(1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("the brainstorm route words reach lit-brainstorm, and the neighbouring routes keep their meaning", () => {
  for (const text of [
    "lit brainstorm a name for my app",
    "lit brainstorming product names",
    "lit ideation for the onboarding flow",
    "lit ideate a few launch themes",
    "lit idea for a weekend project",
    "lit ideas to cut the build time",
    "lit-brainstorm a name for my app",
    "please lit brainstorm ways to make the dashboard faster",
    "lit brainstorm how to refactor the debugging story"
  ]) assert.equal(detectChatActivationMode(text), "lit-brainstorm", text);

  assert.equal(detectChatActivationMode("lit plan the migration"), "lit-plan");
  assert.equal(detectChatActivationMode("lit interview me about the export feature"), "lit-task");
  assert.equal(detectChatActivationMode("lit review plan"), "review-work");
  assert.equal(detectChatActivationMode("lit goal define acceptance"), "litgoal");
  assert.equal(detectChatActivationMode("lit fix the bug"), "lit-task");
});

test("inert mentions of the brainstorm routes stay inert", () => {
  for (const text of [
    "`lit brainstorm`",
    "```\nlit ideation\n```",
    "> lit brainstorm a name",
    "/lit-brainstorm lit",
    "split brainstorm notes",
    "I wrote the word lit-brainstormer in a note"
  ]) assert.equal(detectChatActivationMode(text), undefined, text);
});

test("brainstorm words in paths, file names and later arguments never hijack another route", () => {
  for (const [text, mode] of [
    ["start-work plans/lit-ideas.md", "start-work"],
    ["start-work .litopencode/plans/lit-idea.md", "start-work"],
    ["start-work plans/lit-brainstorm.md", "start-work"],
    ["lit start work plans/lit-ideation.md", "start-work"],
    ["lit plan the lit ideas page", "lit-plan"],
    ["lit plan plans/lit-ideas.md", "lit-plan"],
    ["lit plan: lit idea board for the team", "lit-plan"],
    ["lit fix the bug in src/lit-idea.ts", "lit-task"],
    ["lit fix src/lit ideas.ts", "lit-task"],
    ["lit review plans/lit-brainstorm.md", "review-work"],
    ["review-work ./plans/lit-ideas.md", "review-work"],
    ["lit plan the \"lit brainstorm\" screen", "lit-plan"]
  ]) assert.equal(detectChatActivationMode(text), mode, text);
});

test("chat activation points at the installed lit-brainstorm skill and stays read-only", async () => {
  const parts = await chatText("lit brainstorm a name for my app");
  assert.equal(parts.length, 1);
  const [part] = parts;
  assert.equal(part.metadata.litopencode.mode, "lit-brainstorm");
  assert.match(part.text, /^🔥 LIT IGNITED · lit-brainstorm 🔥/u);
  assert.match(part.text, /<lit-brainstorm-mode>/u);
  assert.match(part.text, /skill name: lit-brainstorm/u);
  assert.match(part.text, /never implement/iu);
  assert.match(part.text, /deep-interview/u);
  assert.match(part.text, /lit-plan/u);
  assert.ok(Buffer.byteLength(part.text, "utf8") < 6_000, "the activation points at the skill instead of pasting it");
});

test("lit-brainstorm is an installed command with its own mode", async () => {
  const command = findLitOpenCodeCommand("lit-brainstorm");
  assert.equal(command?.slash, "/lit-brainstorm");
  assert.ok(litOpenCodeCommands.some((entry) => entry.id === "lit-brainstorm"));
  assert.equal(command.agent, undefined, "brainstorming may write its own notes, so it is not routed to the planning-only agent");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-brainstorm-command-"));
  try {
    const output = { parts: [] };
    await createCommandActivationHook(dir)({ sessionID: "session-command", command: "/lit-brainstorm", arguments: "a name for my app" }, output);
    const activation = output.parts.at(-1);
    assert.equal(activation.metadata.litopencode.mode, "lit-brainstorm");
    assert.match(activation.text, /skill name: lit-brainstorm/u);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("lit-brainstorm is enrolled in the runtime catalog, the feature list and the managed skill tree", () => {
  const skill = findLitOpenCodeRuntimeSkill("lit-brainstorm");
  assert.ok(skill, "missing runtime skill");
  assert.deepEqual(skill.featureIds, ["lit-brainstorm"]);
  const feature = litOpenCodeFeatures.find((entry) => entry.id === "lit-brainstorm");
  assert.ok(feature, "missing feature");
  assert.ok(feature.bindings.some((binding) => binding.kind === "command" && binding.id === "lit-brainstorm"));
  assert.ok(feature.bindings.some((binding) => binding.kind === "config" && binding.id === "skills/lit-brainstorm/SKILL.md"));
  const files = expectedManagedSkillFiles("lit-brainstorm");
  assert.ok(files.includes("SKILL.md"));
  assert.ok(files.filter((file) => file.startsWith("references/")).length >= 4);
  assert.match(managedSkillDiscoveryDescription("lit-brainstorm"), /brainstorm/iu);
});

test("install ships the whole lit-brainstorm folder and doctor sees it", async () => {
  await withTempDir(async (dir) => {
    const install = runCli(["install", "--root", dir]);
    assert.equal(install.status, 0, install.stderr);
    for (const file of await fs.readdir(skillPath("lit-brainstorm", "references"))) {
      await fs.access(path.join(dir, "skills", "lit-brainstorm", "references", file));
    }
    assert.match(await read(dir, "skills", "lit-brainstorm", "SKILL.md"), /^---\nname: lit-brainstorm\n/u);
    assert.match(await read(dir, "command", "lit-brainstorm.md"), /lit-brainstorm/u);
    const doctor = JSON.parse(runCli(["doctor", "--root", dir]).stdout);
    assert.equal(doctor.install.ok, true);
    assert.ok(doctor.install.nativeSkills.present.includes("lit-brainstorm"));
    assert.ok(doctor.install.commandAliases.present.includes("lit-brainstorm"));
    assert.deepEqual(doctor.install.nativeSkills.missing, []);
  });
});

test("the lit-brainstorm corpus is dense, closed and names its neighbours", async () => {
  const body = await read(skillPath("lit-brainstorm", "SKILL.md"));
  assert.ok(Buffer.byteLength(body, "utf8") >= 14_000, "SKILL.md is not a stub");
  for (const heading of [
    "## #contract.activation",
    "## #contract.mode_matrix",
    "## #contract.procedure",
    "## #contract.hard_stops",
    "## #contract.anti_patterns"
  ]) assert.ok(body.includes(heading), heading);
  for (const phrase of ["deep-interview", "lit-plan", "lit-crucible", "diverge", "converge", "never implements", ".litopencode/brainstorm", "task"]) {
    assert.ok(body.includes(phrase), `missing ${phrase}`);
  }
  for (const word of ["brainstorm", "brainstorming", "ideation", "ideate", "idea", "ideas"]) {
    assert.match(body, new RegExp(`\`lit ${word}\``, "u"), `route word ${word}`);
  }
  const references = await fs.readdir(skillPath("lit-brainstorm", "references"));
  assert.ok(references.length >= 4);
  for (const file of references) {
    assert.ok(body.includes(`references/${file}`), `SKILL.md never points at ${file}`);
    const text = await read(skillPath("lit-brainstorm", "references", file));
    assert.ok(Buffer.byteLength(text, "utf8") >= 2_500, `${file} is not a stub`);
  }
  for (const match of body.matchAll(/references\/([A-Za-z0-9._-]+\.md)/gu)) {
    await fs.access(skillPath("lit-brainstorm", "references", match[1]));
  }
});

test("deep-interview sends open brainstorming to lit-brainstorm", async () => {
  const body = await read(skillPath("deep-interview", "SKILL.md"));
  assert.match(body, /open-ended[^\n]*`lit-brainstorm`/u);
});

test("litgoal is one name on every surface and says what it owns", async () => {
  const body = await read(skillPath("litgoal", "SKILL.md"));
  assert.match(body, /^---\nname: litgoal\ndescription: .+\n---\n/u);
  assert.ok(body.includes("litgoal sets and keeps the finish line; lit-loop and start-work run toward it."));
  await assert.rejects(fs.access(skillPath("durable-litgoal")), { code: "ENOENT" });
  assert.equal(findLitOpenCodeRuntimeSkill("durable-litgoal"), undefined);
  assert.ok(findLitOpenCodeRuntimeSkill("litgoal"));
  assert.equal(findLitOpenCodeCommand("litgoal")?.id, "litgoal");
  assert.equal(detectChatActivationMode("litgoal"), "litgoal");
  assert.equal(detectChatActivationMode("lit-goal"), "litgoal");
  assert.equal(detectChatActivationMode("lit goal define acceptance"), "litgoal");
  assert.deepEqual(renamedSkillAliases.litgoal, ["durable-litgoal"]);
  assert.equal(detectChatActivationMode("durable-litgoal"), "litgoal");
  assert.match(promptForChatActivationMode("litgoal", "litgoal"), /sets and keeps the finish line/u);
  assert.match(findLitOpenCodeCommand("litgoal").description, /finish line/iu);
});

test("review-work names plan review and work review, picks one from what exists, and lets the user force one", async () => {
  const skill = await read(skillPath("review-work", "SKILL.md"));
  const prompt = promptForChatActivationMode("review-work", "lit review");
  for (const text of [skill, prompt]) {
    assert.match(text, /plan review/iu);
    assert.match(text, /work review/iu);
    assert.match(text, /lit review plan/u);
    assert.match(text, /lit review work/u);
  }
  assert.match(skill, /ticked/iu);
  assert.match(skill, /neither[^\n]*ask/iu);
  assert.match(skill, /first (?:report )?line[^\n]*Review mode:/iu);
  assert.match(prompt, /Review mode:/u);

  const forcedNote = (text) => /\nMode forced by the user: (plan|work) review\.$/u.exec(text)?.[1];
  assert.equal(forcedNote(promptForChatActivationMode("review-work", "lit review plan")), "plan");
  assert.equal(forcedNote(promptForChatActivationMode("review-work", "lit review work")), "work");
  assert.equal(forcedNote(promptForChatActivationMode("review-work", "review-work plan")), "plan");
  assert.equal(forcedNote(promptForChatActivationMode("review-work", "lit review the plan for auth")), undefined);
  assert.equal(forcedNote(prompt), undefined);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-review-command-"));
  try {
    const output = { parts: [] };
    await createCommandActivationHook(dir)({ sessionID: "session-review", command: "/review-work", arguments: "plan" }, output);
    assert.equal(forcedNote(output.parts.at(-1).text), "plan");
    const plain = { parts: [] };
    await createCommandActivationHook(dir)({ sessionID: "session-review-2", command: "/review-work", arguments: "the auth change" }, plain);
    assert.equal(forcedNote(plain.parts.at(-1).text), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("the docs list the new skill, the renamed litgoal and the review modes in both languages", async () => {
  for (const page of ["docs/reference.md", "docs/reference-Ko-KR.md", "docs/skills.md", "docs/skills-Ko-KR.md"]) {
    const text = await read(page);
    assert.match(text, /lit-brainstorm/u, `${page} names lit-brainstorm`);
    assert.match(text, /\/review-work plan/u, `${page} names the forced plan review`);
    assert.match(text, /\/litgoal/u, `${page} names /litgoal`);
    assert.doesNotMatch(text, />durable-litgoal</u, `${page} no longer lists the old skill id as a skill`);
  }
  assert.match(await read("docs/migration.md"), /`litgoal` \(formerly `durable-litgoal`/u);
  assert.match(await read("CHANGELOG.md"), /`lit-brainstorm`/u);
});
