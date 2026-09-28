import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import * as litOpenCode from "../src/index.ts";
import { litHandoffPromptInjection } from "../src/activation.ts";
import {
  canonicalHandoffAssets,
  handoffBanner,
  rootSessionClient,
  sha256,
  withHandoffTempDir
} from "../test-support/lit-handoff-fixture.mjs";

test("canonical handoff mirror preserves every authored byte", async () => {
  const mirroredFiles = [];
  async function walk(dir, prefix = "") {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else mirroredFiles.push(relative);
    }
  }

  for (const [relativePath, expectedHash] of canonicalHandoffAssets) {
    const packaged = await fs.readFile(path.join("vendor", "handoff", relativePath));
    assert.equal(sha256(packaged), expectedHash, relativePath);
  }
  await walk(path.join("vendor", "handoff"));
  assert.deepEqual(mirroredFiles.sort(), [...canonicalHandoffAssets.keys()].sort());
});

test("handoff adapter publishes MIT provenance without altering the mirror", async () => {
  const license = await fs.readFile(path.join("vendor", "licenses", "022_handoff-MIT.txt"), "utf8");
  const provenance = await fs.readFile(path.join("vendor", "provenance", "022_handoff.md"), "utf8");
  const readme = await fs.readFile("README.md", "utf8");

  assert.match(license, /MIT License/);
  assert.match(provenance, /022_handoff/);
  assert.match(provenance, /MIT applies to\s+all four exact authored files under `vendor\/handoff\//i);
  for (const expectedHash of canonicalHandoffAssets.values()) assert.match(provenance, new RegExp(expectedHash));
  assert.match(readme, /\/lit-handoff/);
  assert.match(readme, /bare `handoff`|bare <code>handoff<\/code>/i);
});

test("lit-handoff is enrolled in command and runtime catalogs", () => {
  const skill = litOpenCode.findLitOpenCodeRuntimeSkill("lit-handoff");
  const command = litOpenCode.litOpenCodeCommands.find((candidate) => candidate.id === "lit-handoff");

  assert.equal(skill?.title, "Lit Handoff");
  assert.deepEqual(skill?.featureIds, ["lit-handoff", "doctor-install"]);
  assert.equal(command?.slash, "/lit-handoff");
  assert.equal(command?.banner, handoffBanner);
  assert.equal(command?.activationText.startsWith(`${handoffBanner}\n`), true);
});

test("handoff prompt reads the complete original contract and resolves its template", async () => {
  const prompt = String(litHandoffPromptInjection ?? "");
  const original = await fs.readFile(path.join("vendor", "handoff", "SKILL.md"), "utf8");
  const template = await fs.readFile(path.join("vendor", "handoff", "templates", "HANDOFF.md"), "utf8");

  assert.equal(prompt.startsWith(`${handoffBanner}\n<lit-handoff-mode>`), true);
  assert.match(prompt, /SKILL_ROOT.*canonical\//s);
  assert.ok(prompt.includes(original), "prompt should contain the complete original SKILL.md");
  assert.ok(prompt.includes(template), "prompt should contain the resolved template body");
});

test("only exact bare handoff chat text activates the native route", () => {
  assert.equal(litOpenCode.detectChatActivationMode("handoff"), "lit-handoff");
  assert.equal(litOpenCode.detectChatActivationMode("  handoff\n"), "lit-handoff");
  for (const text of [
    "please handoff",
    "handoff notes",
    "discuss the handoff",
    "`handoff`",
    "```\nhandoff\n```",
    "\"handoff\"",
    "/lit-handoff"
  ]) {
    assert.equal(litOpenCode.detectChatActivationMode(text), undefined, text);
  }
});

test("a multipart message containing handoff plus unrelated text stays inert", async () => {
  await withHandoffTempDir(async (dir) => {
    const hooks = await litOpenCode.pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const secret = "private-user-text-must-not-persist";
    const output = {
      message: { id: "msg_handoff", sessionID: "session-handoff", role: "user" },
      parts: [
        { id: "part-handoff", sessionID: "session-handoff", messageID: "msg_handoff", type: "text", text: "handoff" },
        { id: "part-secret", sessionID: "session-handoff", messageID: "msg_handoff", type: "text", text: secret }
      ]
    };

    await hooks["chat.message"](
      { sessionID: "session-handoff", messageID: "msg_handoff", agent: "lit-loop" },
      output
    );

    assert.equal(output.parts.length, 2);
    await assert.rejects(
      fs.readFile(path.join(dir, ".litopencode", "litgoal", "lit-loop", "ledger.jsonl"), "utf8"),
      { code: "ENOENT" }
    );
  });
});

test("a complete exact-bare handoff message activates with fixed ledger metadata", async () => {
  await withHandoffTempDir(async (dir) => {
    const hooks = await litOpenCode.pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = {
      message: { id: "msg_handoff_exact", sessionID: "session-handoff-exact", role: "user" },
      parts: [
        { id: "part-handoff", sessionID: "session-handoff-exact", messageID: "msg_handoff_exact", type: "text", text: "  handoff\n" }
      ]
    };

    await hooks["chat.message"](
      { sessionID: "session-handoff-exact", messageID: "msg_handoff_exact", agent: "lit-loop" },
      output
    );

    assert.equal(output.parts.length, 2);
    assert.equal(output.parts[1].text.startsWith(`${handoffBanner}\n`), true);
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-handoff");
    assert.equal(output.parts[1].metadata.litopencode.trigger, "handoff");
    const ledger = await fs.readFile(path.join(dir, ".litopencode", "litgoal", "lit-loop", "ledger.jsonl"), "utf8");
    assert.match(ledger, /"trigger":"handoff"/);
  });
});

test("/lit-handoff injects the exact banner through the command hook", async () => {
  await withHandoffTempDir(async (dir) => {
    const hooks = await litOpenCode.pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = { parts: [] };

    await hooks["command.execute.before"](
      { command: "/lit-handoff", sessionID: "session-command", arguments: "sensitive argument" },
      output
    );

    assert.equal(output.parts.length, 1);
    assert.equal(output.parts[0].text.startsWith(`${handoffBanner}\n`), true);
    assert.equal(output.parts[0].metadata.litopencode.mode, "lit-handoff");
    const ledger = await fs.readFile(path.join(dir, ".litopencode", "litgoal", "lit-loop", "ledger.jsonl"), "utf8");
    assert.doesNotMatch(ledger, /sensitive argument/);
  });
});

test("managed prompt helpers are internal rather than new root exports", () => {
  assert.equal("litHandoffPromptInjection" in litOpenCode, false);
  assert.equal("scientificVisualizationPromptInjection" in litOpenCode, false);
  assert.equal("createCommandActivationHook" in litOpenCode, false);
});
