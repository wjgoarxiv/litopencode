import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectChatActivationMode, promptForChatActivationMode } from "../src/activation-routing.ts";
import { findLitOpenCodeCommand } from "../src/commands.ts";
import { expectedManagedSkillFiles, managedSkillDefinition, managedSkillDiscoveryDescription } from "../src/cli/managed-skill-assets.ts";
import { findLitOpenCodeRuntimeSkill } from "../src/skills.ts";
import { runCli } from "../src/cli.ts";
import { destinationState } from "../src/cli/native-skill-integrity.ts";
import { movedSkillInstallSequence, movedSkillMoveAsideLine, movedSkillPreflightLine, movedSkillReceiptLine } from "../src/moved-skills.ts";
import { runCli as runBin } from "../test-support/cli-fixture.ts";

// Five content families left LitOpenCode for the separate wjgoarxiv-skills collection. Each skill id stays
// as a same-name pointer: OpenCode's native skill picker, the `lit` routes and /lit-scientific-visualization
// still land on it, and it says what moved, where it lives now, and the OpenCode install lines. OpenCode
// keeps one skill per name, so the lines move the pointer folder aside into a dated backup outside every folder
// OpenCode reads skills from, then copy the extension into its place and write a receipt inside it.
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
    assert.ok(stub.includes(`\`\`\`sh\n${movedSkillInstallSequence(id).join("\n")}\n\`\`\``), "carries the four lines in order: check, move aside, copy, receipt");
    assert.doesNotMatch(stub, /\brm -r/u, "never deletes the folder the user may have added files to");
    assert.match(stub, /To update, run the four lines again/u);
    assert.match(stub, /To remove the copy, run the second line/u);
    assert.ok(stub.includes("https://github.com/wjgoarxiv/wjgoarxiv-skills"), "names the public collection");
    assert.match(stub, /litopencode install/u, "says the installer leaves the copied folder alone");
    assert.match(stub, /## #contract\.activation/u);
    for (const pattern of privatePath) assert.doesNotMatch(stub, pattern);
  });

  test(`${id} pointer is SKILL.md alone, small, and installs as SKILL.md only`, () => {
    const files = walk(path.join(root, "skills", id)).map((file) => path.relative(path.join(root, "skills", id), file));
    assert.deepEqual(files, ["SKILL.md"]);
    assert.ok(Buffer.byteLength(stubOf(id)) < 5000, `${Buffer.byteLength(stubOf(id))} bytes`);
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

test("the check line names every user folder OpenCode reads skills from, and only reads", () => {
  const line = movedSkillPreflightLine("lit-docx");
  for (const dir of ["~/.config/opencode/skills/", "~/.agents/skills/", "~/.claude/skills/"]) assert.ok(line.includes(`${dir}lit-docx`), dir);
  assert.match(line, /^ls -d /u);
});

test("the backup folder sits outside every folder OpenCode 1 and 2 read skills from", () => {
  const line = movedSkillMoveAsideLine("lit-docx");
  assert.match(line, /^d=~\/\.config\/opencode\/extension-backups\/\$\(date \+%Y%m%d-%H%M%S\); /u);
  // Folders the hosts scan (OpenCode 1 `opencode debug skill`, OpenCode 2 watcher log, both probed in an isolated home).
  for (const scanned of [/\/skills?\//u, /\.agents\//u, /\.claude\//u]) assert.doesNotMatch(line.slice(0, line.indexOf(";")), scanned);
  assert.doesNotMatch(line, /\brm\b/u);
});

const shells = ["bash", "zsh"].filter((shell) => spawnSync(shell, ["-c", "true"]).status === 0);

for (const shell of shells) {
  test(`${shell}: the four lines move the pointer and a user file aside whole, copy clean, write a receipt, and survive litopencode install`, () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "litopencode-ext-lines-")));
    try {
      const home = path.join(dir, "home");
      const configRoot = path.join(home, ".config", "opencode");
      const clone = path.join(dir, "clone");
      const variant = path.join(clone, "variants", "litopencode", "lit-docx");
      mkdirSync(path.join(variant, "scripts"), { recursive: true });
      const copied = "---\nname: lit-docx\ndescription: Collection copy of the Word document skill.\n---\n\n# lit-docx\n";
      writeFileSync(path.join(variant, "SKILL.md"), copied);
      writeFileSync(path.join(variant, "scripts", "build.py"), "print('build')\n");
      // XDG_CONFIG_HOME points elsewhere so --root is not the default root and no `opencode plugin` runs.
      const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(dir, "xdg-config"), XDG_CACHE_HOME: path.join(dir, "cache") };
      assert.equal(runBin(["install", "--root", configRoot], { env }).status, 0);
      const target = path.join(configRoot, "skills", "lit-docx");
      writeFileSync(path.join(target, "notes.md"), "mine\n");
      const run = (line) => spawnSync(shell, ["-c", line.replaceAll("<path to your wjgoarxiv-skills clone>", clone)], { env, encoding: "utf8" });
      const [check, aside, copy, receipt] = movedSkillInstallSequence("lit-docx");
      assert.equal(run(check).stdout.trim(), "~/.config/opencode/skills/lit-docx".replace("~", home), "the check lists the occupied target");
      for (const line of [aside, copy, receipt]) assert.equal(run(line).status, 0, line);
      const backups = path.join(configRoot, "extension-backups");
      const [stamp] = readdirSync(backups);
      assert.match(stamp, /^\d{8}-\d{6}$/u);
      const saved = path.join(backups, stamp, "lit-docx");
      assert.equal(readFileSync(path.join(saved, "notes.md"), "utf8"), "mine\n", "the user file moved with the folder");
      assert.match(readFileSync(path.join(saved, "SKILL.md"), "utf8"), /moved to wjgoarxiv-skills/u, "the pointer moved whole");
      assert.deepEqual(readdirSync(target).sort(), [".litfamily-extension.json", "SKILL.md", "scripts"], "no nesting and no merge");
      const first = JSON.parse(readFileSync(path.join(target, ".litfamily-extension.json"), "utf8"));
      assert.deepEqual(Object.keys(first), ["id", "source", "variant", "installed_at"]);
      assert.equal(first.source, variant);
      assert.equal(first.variant, "litopencode");
      assert.match(first.installed_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u);

      // A LitOpenCode update leaves the extension and its receipt alone: the folder carries no generated marker.
      const before = readFileSync(path.join(target, ".litfamily-extension.json"), "utf8");
      const update = runBin(["install", "--root", configRoot], { env });
      assert.equal(update.status, 0, update.stderr);
      assert.equal(readFileSync(path.join(target, "SKILL.md"), "utf8"), copied);
      assert.equal(readFileSync(path.join(target, ".litfamily-extension.json"), "utf8"), before);
      const report = JSON.parse(runBin(["doctor", "--root", configRoot], { env }).stdout);
      assert.ok(report.install.nativeSkills.preserved.includes("lit-docx"));
      assert.deepEqual(report.install.nativeSkills.invalid, []);

      // Updating the extension is the same lines again: the old copy goes aside whole and the receipt is rewritten.
      writeFileSync(path.join(variant, "SKILL.md"), `${copied}\nv2\n`);
      spawnSync("sleep", ["1"]);
      for (const line of [aside, copy, receipt.replace("%Y-%m-%dT%H:%M:%SZ", "2099-01-01T00:00:00Z")]) assert.equal(run(line).status, 0, line);
      assert.equal(readdirSync(backups).length, 2);
      assert.match(readFileSync(path.join(target, "SKILL.md"), "utf8"), /v2/u);
      assert.equal(JSON.parse(readFileSync(path.join(target, ".litfamily-extension.json"), "utf8")).installed_at, "2099-01-01T00:00:00Z");
      assert.deepEqual(readdirSync(target).sort(), [".litfamily-extension.json", "SKILL.md", "scripts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const shell of shells) {
  test(`${shell}: in a home where OpenCode has no skills folder yet, the lines still install one clean copy`, () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "litopencode-ext-empty-")));
    try {
      const home = path.join(dir, "home");
      mkdirSync(home);
      const variant = path.join(dir, "clone", "variants", "litopencode", "visual-qa");
      mkdirSync(variant, { recursive: true });
      writeFileSync(path.join(variant, "SKILL.md"), "copy\n");
      const lines = movedSkillInstallSequence("visual-qa").map((line) => line.replaceAll("<path to your wjgoarxiv-skills clone>", path.join(dir, "clone")));
      const results = lines.map((line) => spawnSync(shell, ["-c", line], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" }));
      assert.equal(results[0].stdout, "", "nothing to report");
      for (const result of results.slice(1)) assert.equal(result.status, 0, result.stderr);
      const target = path.join(home, ".config", "opencode", "skills", "visual-qa");
      assert.deepEqual(readdirSync(target).sort(), [".litfamily-extension.json", "SKILL.md"]);
      assert.equal(existsSync(path.join(home, ".config", "opencode", "extension-backups")), false, "nothing was moved aside");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("the installer's ownership check reads a receipt-bearing extension copy as preserved", async () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "litopencode-ext-state-")));
  try {
    const folder = path.join(dir, "skills", "visual-qa");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "SKILL.md"), "---\nname: visual-qa\ndescription: copy\n---\n");
    writeFileSync(path.join(folder, ".litfamily-extension.json"), "{}\n");
    assert.equal((await destinationState(dir, { id: "visual-qa" })).kind, "preserved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the receipt line writes valid JSON naming the id, source, variant and time", () => {
  const line = movedSkillReceiptLine("readme-studio");
  assert.ok(line.endsWith("> ~/.config/opencode/skills/readme-studio/.litfamily-extension.json"));
  assert.ok(line.includes('"variant":"litopencode"'));
  assert.ok(line.includes(' readme-studio "<path to your wjgoarxiv-skills clone>/variants/litopencode/readme-studio" '));
});

test("every README and the skills page give the same four lines and no delete", () => {
  for (const [file, id] of [["README.md", "<skill>"], ["README-Ko-KR.md", "<skill>"], ["README-npm.md", "<skill>"], ["README-npm-Ko-KR.md", "<skill>"], ["docs/skills.md", "lit-docx"], ["docs/skills-Ko-KR.md", "lit-docx"]]) {
    const text = readFileSync(path.join(root, file), "utf8");
    assert.ok(text.includes(`\`\`\`sh\n${movedSkillInstallSequence(id).join("\n")}\n\`\`\``), file);
    assert.doesNotMatch(text, /rm -r ~\/\.config\/opencode\/skills/u, file);
  }
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
    assert.ok(Buffer.byteLength(text) <= 5120, `${Buffer.byteLength(text)} bytes`);
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
