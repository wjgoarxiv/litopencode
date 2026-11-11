import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectChatActivationMode, promptForChatActivationMode } from "../src/activation-routing.ts";
import { findLitOpenCodeCommand } from "../src/commands.ts";
import { expectedManagedSkillFiles, managedSkillDefinition, managedSkillDiscoveryDescription } from "../src/cli/managed-skill-assets.ts";
import { findLitOpenCodeRuntimeSkill } from "../src/skills.ts";
import { runCli } from "../src/cli.ts";

// Five content families left LitOpenCode for the separate wjgoarxiv-skills collection. Each skill id stays
// as a same-name pointer: OpenCode's native skill picker, the `lit` routes and /lit-scientific-visualization
// still land on it, and it says what moved, where it lives now, and the one OpenCode install line. OpenCode
// keeps one skill per name, so the line replaces the pointer folder instead of adding a second copy.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const placeholder = "<path to your wjgoarxiv-skills clone>";
const moved = [
  { id: "lit-pptx", family: "decks", made: /PowerPoint decks?/u },
  { id: "lit-docx", family: "documents", made: /Word documents?/u },
  { id: "lit-diagram-drawer", family: "figures", made: /diagrams?/u },
  { id: "lit-schematic", family: "figures", made: /P&IDs?/u },
  { id: "lit-scientific-visualization", family: "figures", made: /publication-ready (?:scientific )?figures?/u },
  { id: "frontend-ui-ux", family: "design", made: /interfaces?/u },
  { id: "visual-qa", family: "design", made: /rendered (?:interfaces?|surfaces?)/u },
  { id: "lit-typographic-motion", family: "video-covers", made: /films?/u },
  { id: "readme-studio", family: "video-covers", made: /READMEs?/u }
];
const stubOf = (id) => readFileSync(path.join(root, "skills", id, "SKILL.md"), "utf8");
const installLine = (id) => `cp -R "${placeholder}/variants/litopencode/${id}" ~/.config/opencode/skills/${id}`;
const privatePath = [/~\/Desktop/u, /27_LITFAMILY/u, /\.worktrees\/(?!<)/u, /\/Users\/[a-z]/u, /39_wjgoarxiv/u];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);

for (const { id, family, made } of moved) {
  test(`${id} is a same-name pointer that names wjgoarxiv-skills, its family folder and the OpenCode install line`, () => {
    const stub = stubOf(id);
    assert.match(stub, new RegExp(`^---\\nname: ${id}\\n`, "u"));
    assert.match(stub, made);
    assert.match(stub, /wjgoarxiv-skills/u);
    assert.ok(stub.includes(`plugins/${family}/skills/${id}/`), "names the family folder in the collection");
    assert.ok(stub.includes(`rm -r ~/.config/opencode/skills/${id}`), "removes the pointer folder first");
    assert.ok(stub.includes(installLine(id)), "carries the one-skill OpenCode install line");
    assert.match(stub, /not published yet/u);
    assert.match(stub, /litopencode install/u, "says the installer leaves the copied folder alone");
    assert.match(stub, /## #contract\.activation/u);
    for (const pattern of privatePath) assert.doesNotMatch(stub, pattern);
  });

  test(`${id} pointer is SKILL.md alone, small, and installs as SKILL.md only`, () => {
    const files = walk(path.join(root, "skills", id)).map((file) => path.relative(path.join(root, "skills", id), file));
    assert.deepEqual(files, ["SKILL.md"]);
    assert.ok(Buffer.byteLength(stubOf(id)) < 4000, `${Buffer.byteLength(stubOf(id))} bytes`);
    assert.equal(managedSkillDefinition(id), undefined, "no longer a managed nested tree");
    assert.deepEqual(expectedManagedSkillFiles(id), ["SKILL.md"]);
  });

  test(`${id} registry text tells OpenCode's picker the skill moved`, () => {
    const skill = findLitOpenCodeRuntimeSkill(id);
    assert.ok(skill, "the id stays registered");
    const description = `${skill.summary} ${managedSkillDiscoveryDescription(id)}`;
    assert.match(description, /wjgoarxiv-skills/u);
    assert.match(description, /moved/iu);
  });
}

test("lit-typographic-motion pointer names the copy's one-time runtime step, run from the copied folder", () => {
  const stub = stubOf("lit-typographic-motion");
  assert.ok(stub.includes("node ~/.config/opencode/skills/lit-typographic-motion/runtime.mjs install"), "the copy's own installer, not a LitOpenCode command");
  assert.doesNotMatch(stub, /litopencode motion-runtime/u);
});

const routes = [
  ["lit 발표자료 만들어줘", "lit-task", "lit-pptx"],
  ["Make a 10-slide launch deck about our Q3 results. lit", "lit-task", "lit-pptx"],
  ["lit write a Word report about the office move", "lit-task", "lit-docx"],
  ["Create an architecture diagram of a message queue and its consumers. lit", "lit-task", "lit-diagram-drawer"],
  ["lit draw a P&ID of a heat exchanger loop with its control valves", "lit-task", "lit-schematic"],
  ["lit make a 10-second kinetic type title sequence for a product named Ember", "lit-task", "lit-typographic-motion"],
  ["design a new settings page UI", "frontend-ui-ux", "frontend-ui-ux"],
  ["visual-qa check the pricing page", "visual-qa", "visual-qa"],
  ["lit-scientific-visualization", "lit-scientific-visualization", "lit-scientific-visualization"]
];
const leftovers = [/qa\.mjs/u, /render\.mjs/u, /gate\.mjs/u, /--done/u, /design-lock\.mjs/u, /tonalit(?:y|ies)/u, /references\/production\.md/u, /rcparams/u, /treatment\.json/u];

for (const [prompt, mode, id] of routes) {
  test(`route "${prompt}" still reaches ${id} and carries its install line, not the old procedure`, () => {
    assert.equal(detectChatActivationMode(prompt), mode);
    const text = promptForChatActivationMode(mode, prompt);
    assert.match(text, new RegExp(`\\b${id}\\b`, "u"));
    assert.match(text, /wjgoarxiv-skills/u, "names where the skill went");
    assert.ok(text.includes(installLine(id)), "the injected context carries the install line");
    for (const pattern of leftovers) assert.doesNotMatch(text, pattern, `${prompt}: ${pattern}`);
    assert.ok(Buffer.byteLength(text) <= 4352, `${Buffer.byteLength(text)} bytes`);
  });
}

test("a deck and a report in one lit request route to both pointers", () => {
  const prompt = "lit 보고서랑 발표자료 둘 다 만들어줘";
  const text = promptForChatActivationMode(detectChatActivationMode(prompt), prompt);
  assert.ok(text.includes(installLine("lit-docx")));
  assert.ok(text.includes(installLine("lit-pptx")));
});

test("/lit-scientific-visualization keeps its slash command and now hands over the pointer", () => {
  const command = findLitOpenCodeCommand("/lit-scientific-visualization");
  assert.ok(command);
  assert.ok(command.activationText.includes(installLine("lit-scientific-visualization")));
  assert.match(command.activationText, /plugins\/figures\/vendor\/scientific-visualization\//u);
  assert.doesNotMatch(command.activationText, /# Exact original contract/u);
  assert.match(command.description, /moved/iu);
});

test("the moved runtimes and the vendored plot source are gone from the product", async () => {
  for (const file of [
    "vendor/scientific-visualization",
    "src/cli/motion-runtime.ts",
    "src/cli/office-dependencies.ts",
    "src/cli/scientific-visualization-dependencies.ts",
    "src/motion-image-reads.ts"
  ]) assert.equal(existsSync(path.join(root, file)), false, file);
  const result = await runCli(["motion-runtime"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr ?? "", /Unknown command: motion-runtime/u);
  const help = await runCli(["help"]);
  assert.doesNotMatch(help.stdout ?? "", /motion-runtime/u);
});

test("the package ships each moved id as SKILL.md alone and no vendored plot source", () => {
  const lock = JSON.parse(readFileSync(path.join(root, "skills.lock.json"), "utf8"));
  for (const { id } of moved) {
    assert.deepEqual(lock.pack.filter((file) => file.startsWith(`skills/${id}/`)), [`skills/${id}/SKILL.md`], id);
  }
  assert.deepEqual(lock.pack.filter((file) => file.startsWith("vendor/") && file.includes("scientific-visualization")), []);
});

test("no shipped skill, source file or doc names a private machine path for the collection", () => {
  const offenders = [];
  for (const dir of ["skills", "src", "docs"]) {
    for (const file of walk(path.join(root, dir))) {
      const bytes = readFileSync(file);
      if (bytes.includes(0)) continue;
      const text = bytes.toString("utf8");
      if (!text.includes("wjgoarxiv-skills")) continue;
      for (const pattern of privatePath) if (pattern.test(text)) offenders.push(`${path.relative(root, file)} ${pattern}`);
    }
  }
  assert.deepEqual(offenders, []);
});
