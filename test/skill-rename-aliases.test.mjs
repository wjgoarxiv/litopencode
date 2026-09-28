import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createChatMessageActivationHook, detectChatActivationMode } from "../src/activation.ts";
import { createCommandActivationHook, findLitOpenCodeCommand, litOpenCodeCommands } from "../src/commands.ts";
import { ensureCommandAliases, inspectCommandAliases } from "../src/cli/command-aliases.ts";
import { ensureNativeSkills } from "../src/cli/native-skills.ts";

const otherRenames = [
  ["hyperplan", "lit-crucible"],
  ["init-deep", "lit-init"],
  ["git-master", "lit-commit"],
  ["remove-ai-slops", "lit-burnoff"],
  ["ai-slop-remover", "lit-burnoff-file"],
  ["public-source-fetch", "lit-fetch"],
  ["programming", "lit-code"]
];
const humanizerAliases = ["lit-korean", "text-naturalization", "text-neutralization", "korean-ai-slop-remover"];
const renames = [...otherRenames, ...humanizerAliases.map((alias) => [alias, "lit-humanizer"])];
const migrationTrees = [...otherRenames, ["lit-korean", "lit-humanizer"]];
const metadata = { name: "litopencode", version: JSON.parse(await fs.readFile("package.json", "utf8")).version, packageRoot: path.resolve(".") };
async function temporary(t) {
  await fs.mkdir("evidence", { recursive: true });
  const root = await fs.mkdtemp(path.resolve("evidence/skill-rename-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
for (const [oldId, newId] of renames) {
  test(`alias ${oldId} -> ${newId}: bare and slash select new skill with one note`, async (t) => {
    const root = await temporary(t);
    const note = `Note: \`${oldId}\` now routes to \`${newId}\`; use the canonical name for new invocations.`;
    assert.equal(detectChatActivationMode(`please ${oldId} now`), newId);
    assert.equal(detectChatActivationMode(newId), newId);
    for (const inert of [`\`${oldId}\``, `> ${oldId}`, `"${oldId}"`, `${oldId}-extra`, `/${oldId}`]) {
      assert.equal(detectChatActivationMode(inert), undefined, inert);
    }
    const output = { message: { id: "msg", sessionID: "session" }, parts: [{ type: "text", text: oldId }] };
    await createChatMessageActivationHook(root)({ sessionID: "session" }, output);
    const injected = output.parts.find((part) => part.metadata?.litopencode);
    assert.equal(injected?.metadata.litopencode.mode, newId);
    assert.equal(injected.text.split(note).length - 1, 1);
    assert.match(injected.text, new RegExp(`skill_id: ["']?${newId}["']?`), "the canonical skill body must be embedded");
    assert.equal(findLitOpenCodeCommand(oldId)?.id, newId);
    assert.ok(!litOpenCodeCommands.some(({ id }) => id === oldId));
    const slash = { parts: [] };
    await createCommandActivationHook(root)({ sessionID: "session", command: oldId, arguments: "" }, slash);
    assert.equal(slash.parts.filter((part) => part.text?.includes(note)).length, 1);
    assert.equal(slash.parts.at(-1).metadata.litopencode.mode, newId);
    assert.match(slash.parts.at(-1).text, new RegExp(`skill_id: ["']?${newId}["']?`));
  });
}
test("rename install/update removes managed old skill trees and installs redirect stubs", async (t) => {
  const root = await temporary(t);
  for (const [oldId] of migrationTrees) {
    const dir = path.join(root, "skills", oldId);
    await fs.mkdir(dir, { recursive: true });
    const entry = oldId === "lit-korean"
      ? await fs.readFile("test/fixtures/retired-lit-korean/SKILL.md")
      : Buffer.from(`---\nname: ${oldId}\nmetadata:\n  litopencodeGenerated: "true"\n---\nOld managed skill.\n`);
    await fs.writeFile(path.join(dir, "SKILL.md"), entry);
  }
  await ensureNativeSkills(root, metadata);
  await ensureCommandAliases(root);
  for (const [oldId, newId] of migrationTrees) {
    await assert.rejects(fs.stat(path.join(root, "skills", oldId)), { code: "ENOENT" });
    assert.match(await fs.readFile(path.join(root, "skills", newId, "SKILL.md"), "utf8"), new RegExp(`name: ${newId}`));
  }
  for (const [oldId, newId] of renames) {
    const stub = await fs.readFile(path.join(root, "command", `${oldId}.md`), "utf8");
    assert.ok(stub.includes(`/${newId}`));
    assert.equal(stub.split("Note: ").length - 1, 1);
    assert.ok(!stub.includes("# Installed skill body"));
  }
  const listing = await inspectCommandAliases(root);
  assert.ok(renames.every(([oldId]) => !listing.expected.includes(oldId)));
  await ensureNativeSkills(root, metadata);
  assert.ok(renames.every(([oldId]) => !listing.present.includes(oldId)));
});

test("rename migration preserves user-owned old skills and occupied new names", async (t) => {
  const root = await temporary(t);
  for (const id of ["hyperplan", "init-deep", "lit-init"]) {
    await fs.mkdir(path.join(root, "skills", id), { recursive: true });
    await fs.writeFile(path.join(root, "skills", id, "SKILL.md"), id === "init-deep"
      ? '---\nmetadata:\n  litopencodeGenerated: "true"\n---\nManaged previous installation.'
      : `User-owned ${id}`);
  }
  await ensureNativeSkills(root, metadata);
  assert.equal(await fs.readFile(path.join(root, "skills/hyperplan/SKILL.md"), "utf8"), "User-owned hyperplan");
  assert.equal(await fs.readFile(path.join(root, "skills/lit-init/SKILL.md"), "utf8"), "User-owned lit-init");
  assert.ok((await fs.stat(path.join(root, "skills/init-deep"))).isDirectory());
});

test("Lit Korean update removes the exact managed copy but preserves a changed copy with one warning", async (t) => {
  const root = await temporary(t);
  const oldTree = path.join(root, "skills", "lit-korean");
  await fs.mkdir(oldTree, { recursive: true });
  const fixture = await fs.readFile("test/fixtures/retired-lit-korean/SKILL.md");
  const aliases = JSON.parse(await fs.readFile("skills/skill-rename-aliases.json", "utf8"));
  const expectedHash = "d50edcb844eb128abd12eb233c504f38751ab858e1b0eb39456eaca221a60348";
  assert.equal(createHash("sha256").update(fixture).digest("hex"), expectedHash);
  assert.deepEqual(aliases["lit-humanizer"], humanizerAliases);

  await fs.writeFile(path.join(oldTree, "SKILL.md"), fixture);
  await ensureNativeSkills(root, metadata);
  await assert.rejects(fs.stat(oldTree), { code: "ENOENT" });

  await fs.mkdir(oldTree, { recursive: true });
  const changed = Buffer.concat([fixture, Buffer.from("\nUser addition.\n")]);
  await fs.writeFile(path.join(oldTree, "SKILL.md"), changed);
  const originalWrite = process.stderr.write;
  let warning = "";
  process.stderr.write = ((chunk, ...args) => {
    warning += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return true;
  });
  try {
    await ensureNativeSkills(root, metadata);
  } finally {
    process.stderr.write = originalWrite;
  }

  assert.equal(await fs.readFile(path.join(oldTree, "SKILL.md"), "utf8"), changed.toString("utf8"));
  assert.equal((warning.match(/kept previous skill lit-korean/gu) ?? []).length, 1);
  assert.equal(warning.trim().split("\n").length, 1);
  assert.match(await fs.readFile(path.join(root, "skills", "lit-humanizer", "SKILL.md"), "utf8"), /name: lit-humanizer/u);
});

test("rename migration refuses symlinked old trees and preserves their targets", async (t) => {
  const root = await temporary(t);
  const outside = path.join(root, "user-owned");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "SKILL.md"), "User-owned target");
  await fs.mkdir(path.join(root, "skills"));
  await fs.symlink(outside, path.join(root, "skills/hyperplan"));
  await assert.rejects(ensureNativeSkills(root, metadata), /symbolic link/);
  assert.equal(await fs.readFile(path.join(outside, "SKILL.md"), "utf8"), "User-owned target");
});

test("old command redirects preserve user ownership and do not hijack command hooks", async (t) => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, "command"));
  const oldCommand = path.join(root, "command/hyperplan.md");
  await fs.writeFile(oldCommand, "My planning command");
  await ensureCommandAliases(root);
  assert.equal(await fs.readFile(oldCommand, "utf8"), "My planning command");
  const output = { parts: [] };
  await createCommandActivationHook(root, { commandAliasRoot: root })({ sessionID: "session", command: "/hyperplan", arguments: "" }, output);
  assert.deepEqual(output.parts, []);
});

test("renamed skill sources declare only canonical frontmatter names", async () => {
  for (const [oldId, newId] of renames) {
    const body = await fs.readFile(path.join("skills", newId, "SKILL.md"), "utf8");
    assert.match(body, new RegExp(`^---\\nname: ${newId}\\ndescription: .+\\n---\\n`));
    if (newId !== "lit-humanizer") assert.ok(!body.replace(/test\/[^\s`"]+/gu, "").includes(oldId), newId);
  }
});

test("one-release alias registry and generated migration map agree", async () => {
  const aliases = JSON.parse(await fs.readFile("skills/skill-rename-aliases.json", "utf8"));
  const manifest = JSON.parse(await fs.readFile("skills/managed-skill-manifest.json", "utf8"));
  assert.deepEqual(aliases, Object.fromEntries([
    ...otherRenames.map(([oldId, newId]) => [newId, oldId]),
    ["lit-humanizer", humanizerAliases]
  ]));
  assert.deepEqual(manifest.renamedSkills, aliases);
});

test("old command redirect refuses a symlink without writing through it", async (t) => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, "command"));
  const target = path.join(root, "user-command.md");
  await fs.writeFile(target, "litopencodeGenerated: true\nUser content");
  await fs.symlink(target, path.join(root, "command/hyperplan.md"));
  await assert.rejects(ensureCommandAliases(root), /Unsafe command redirect destination/);
  assert.equal(await fs.readFile(target, "utf8"), "litopencodeGenerated: true\nUser content");
});

test("rename aliases preserve workflow-family, execution, review, and refactor precedence", () => {
  for (const [text, mode] of [
    ["autoresearch debug programming errors", "autoresearch-debug"],
    ["start-work programming task", "start-work"],
    ["review-work programming changes", "review-work"],
    ["refactor programming helpers", "refactor"]
  ]) assert.equal(detectChatActivationMode(text), mode, text);
});
