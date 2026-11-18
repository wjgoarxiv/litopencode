import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { litRecapPromptInjection } from "../src/activation.ts";
import { adhdViewForPrompt, promptForChatActivationMode } from "../src/activation-routing.ts";
import { ensureCommandAliases } from "../src/cli/command-aliases.ts";
import { ensureNativeSkills } from "../src/cli/native-skill-install.ts";
import { createCommandActivationHook, findLitOpenCodeCommand } from "../src/commands.ts";
import { detectChatActivationMode, findLitOpenCodeFeature, findLitOpenCodeRuntimeSkill } from "../src/index.ts";

const moved = "lit-recap moved into lit-adhd (lit adhd recap).";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-lit-recap-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("the old recap words open lit-adhd and its lookalikes stay inert", () => {
  for (const accepted of ["lit recap", "litrecap", "recap", "recap this session", "리캡", "please 리캡 해줘", "lit-recap", "/litrecap now", "lit adhd recap"]) {
    assert.equal(detectChatActivationMode(accepted), "lit-adhd", accepted);
  }
  for (const rejected of ["recapture the flag", "recapitalize it", "리캡처 해줘", "리캡션", "`recap`", "```\nrecap\n```"]) {
    assert.notEqual(detectChatActivationMode(rejected), "lit-adhd", rejected);
  }
  assert.equal(detectChatActivationMode("/lit-recap please"), undefined, "a slash mention is the command's job");
});

test("each wording picks its lit-adhd view, and only the old words add the moved note", () => {
  assert.deepEqual(adhdViewForPrompt("lit adhd"), { view: "card", movedFrom: false, lang: "ko" });
  assert.deepEqual(adhdViewForPrompt("lit adhd 자세히"), { view: "detail", movedFrom: false, lang: "ko" });
  assert.deepEqual(adhdViewForPrompt("lit adhd recap"), { view: "recap", movedFrom: false, lang: "ko" });
  assert.deepEqual(adhdViewForPrompt("lit adhd recap ses_4f2a9c"), { view: "recap", movedFrom: false, lang: "ko", recapSession: "ses_4f2a9c" });
  assert.deepEqual(adhdViewForPrompt("lit recap"), { view: "recap", movedFrom: true, lang: "ko" });
  assert.match(promptForChatActivationMode("lit-adhd", "lit recap"), /View for this request: recap\. Add --recap --moved\. Show the collector's output from its first line/u);
  assert.match(promptForChatActivationMode("lit-adhd", "lit adhd recap ses_4f2a9c"), /Add --recap ses_4f2a9c\. Show/u);
  assert.doesNotMatch(promptForChatActivationMode("lit-adhd", "lit adhd recap"), /--moved/u);
  assert.match(promptForChatActivationMode("lit-adhd", "lit adhd"), /View for this request: card/u);
});

test("/lit-recap stays a read-only command that opens the recap view with the moved note", async () => {
  await withTempDir(async (dir) => {
    const command = findLitOpenCodeCommand("lit-recap");
    assert.equal(command?.slash, "/lit-recap");
    assert.equal(command.readOnly, true);
    assert.ok(litRecapPromptInjection.includes("Add --recap --moved."));
    const output = { parts: [] };
    await createCommandActivationHook(dir)({ command: "/lit-recap", sessionID: "session-recap", arguments: "" }, output);
    const part = output.parts.at(-1);
    assert.equal(part.metadata.litopencode.command, "lit-recap");
    assert.equal(part.metadata.litopencode.mode, "lit-adhd");
    assert.ok(part.text.includes("Add --recap --moved."));
    assert.match(part.text, /skill name: lit-adhd/u);
    assert.match(part.text, /LitOpenCode session id for --session: session-recap/u);
  });
});

test("/lit-adhd detail and /lit-adhd recap pick their views from the arguments", async () => {
  await withTempDir(async (dir) => {
    const hook = createCommandActivationHook(dir);
    for (const [args, view] of [["", "card"], ["detail", "detail"], ["recap", "recap"]]) {
      const output = { parts: [] };
      await hook({ command: "/lit-adhd", sessionID: "s1", arguments: args }, output);
      assert.match(output.parts.at(-1).text, new RegExp(`View for this request: ${view}\\.`, "u"), args);
    }
  });
});

test("the lit-recap skill is gone from the catalog; its command alias remains and points at lit-adhd", async () => {
  assert.equal(findLitOpenCodeRuntimeSkill("lit-recap"), undefined);
  assert.equal(findLitOpenCodeFeature("lit-recap"), undefined);
  await assert.rejects(fs.access(path.resolve("skills/lit-recap")));
  assert.ok(findLitOpenCodeFeature("lit-adhd").bindings.some((binding) => /\/lit-recap/u.test(binding.surface)));
  await withTempDir(async (dir) => {
    await ensureCommandAliases(dir);
    const alias = await fs.readFile(path.join(dir, "command", "lit-recap.md"), "utf8");
    assert.match(alias, /^litopencodeGenerated: true$/mu);
    assert.ok(alias.includes("Add --recap --moved."));
  });
});

test("an install removes the lit-recap copy an earlier install wrote and keeps a user-owned one", async () => {
  const metadata = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8"));
  await withTempDir(async (dir) => {
    const old = path.join(dir, "skills", "lit-recap");
    await fs.mkdir(old, { recursive: true });
    await fs.writeFile(path.join(old, "SKILL.md"), "---\nname: lit-recap\ndescription: old\nlitopencodeGenerated: true\n---\n\n# Lit Recap\n");
    await ensureNativeSkills(dir, { name: metadata.name, version: metadata.version, packageRoot: path.resolve(".") });
    await assert.rejects(fs.access(old), "the managed copy is removed");
  });
});

test("the collector prints the moved note as the first line of the recap view (code-owned, not model-placed)", async () => {
  await withTempDir(async (dir) => {
    const { execFileSync } = await import("node:child_process");
    const run = (...extra) => execFileSync(process.execPath, [path.resolve("skills/lit-adhd/scripts/rewind.mjs"), "--brief", "--root", dir, "--db", path.join(dir, "none.db"), "--storage", path.join(dir, "none"), "--recap", ...extra], { encoding: "utf8" });
    assert.equal(run("--moved").split("\n")[0], moved);
    assert.notEqual(run().split("\n")[0], moved);
  });
});

test("lit-adhd language is picked by code: Korean unless the prompt asks for English", async () => {
  const { promptForChatActivationMode } = await import("../src/activation-routing.ts");
  const cases = [
    ["lit adhd", "ko"],
    ["lit adhd what should I do next", "ko"],
    ["lit adhd show me where things stand please", "ko"],
    ["lit adhd 자세히", "ko"],
    ["lit adhd --en", "en"],
    ["lit adhd in English", "en"],
    ["lit adhd 영어로", "en"],
    ["lit recap --en", "en"],
  ];
  for (const [prompt, lang] of cases) {
    const text = promptForChatActivationMode("lit-adhd", prompt);
    assert.match(text, new RegExp(`Language for this request: ${lang}\\. Pass --lang ${lang}\\.`, "u"), prompt);
    assert.doesNotMatch(text, /en for an English request/u, "the model never guesses the language");
  }
  const command = { parts: [] };
  await createCommandActivationHook(process.cwd())({ command: "/lit-adhd", sessionID: "ses_l", arguments: "next steps" }, command);
  assert.match(command.parts.at(-1).text, /Pass --lang ko\./u);
});
