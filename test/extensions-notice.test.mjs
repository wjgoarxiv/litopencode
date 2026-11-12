import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLitOpenCodePlugin } from "../src/server.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { extensionsNoticeLines, pendingExtensionsNoticeName, previousVersionLeftovers, writePendingExtensionsNotice } from "../src/extensions-notice.ts";
import { packageVersion, runCli } from "../test-support/cli-fixture.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

// The nine file-making skills are LitFamily extensions now. The installer says so as it runs, and the first
// session after it relays the same notice once. Machine-readable output never carries it.
// The pointers' four lines (check, move aside, copy, receipt), split with shell continuations so each fits an
// 80-column terminal. None of them deletes anything.
const installBlock = [
  "  ls -d ~/.config/opencode/skills/<skill> ~/.agents/skills/<skill> \\",
  "    ~/.claude/skills/<skill> 2>/dev/null",
  "  d=~/.config/opencode/extension-backups/$(date +%Y%m%d-%H%M%S); \\",
  "    [ ! -e ~/.config/opencode/skills/<skill> ] || \\",
  '    { mkdir -p "$d" && mv ~/.config/opencode/skills/<skill> "$d/"; }',
  "  mkdir -p ~/.config/opencode/skills && \\",
  '  cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/<skill>" \\',
  "    ~/.config/opencode/skills/<skill>",
  "  printf \\",
  "    '{\"id\":\"%s\",\"source\":\"%s\",\"variant\":\"litopencode\",\"installed_at\":\"%s\"}\\n' \\",
  "    <skill> \\",
  '    "<path to your wjgoarxiv-skills clone>/variants/litopencode/<skill>" \\',
  '    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\',
  "    > ~/.config/opencode/skills/<skill>/.litfamily-extension.json"
];
const installLines = [installBlock.join("\n")];

test("the notice's lines delete nothing, fit 80 columns, and do what the pointer's one-line form does", () => {
  const lines = extensionsNoticeLines();
  assert.ok(lines.join("\n").includes(installBlock.join("\n")));
  assert.doesNotMatch(lines.join("\n"), /\brm\b/u);
  for (const line of installBlock) assert.ok(line.length <= 80, `${line.length}: ${line}`);
  const shells = ["bash", "zsh"].filter((shell) => spawnSync(shell, ["-c", "true"]).status === 0);
  for (const shell of shells) {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "litopencode-notice-lines-")));
    try {
      const home = path.join(dir, "home");
      const target = path.join(home, ".config", "opencode", "skills", "lit-docx");
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "notes.md"), "mine\n");
      const clone = path.join(dir, "clone");
      mkdirSync(path.join(clone, "variants", "litopencode", "lit-docx"), { recursive: true });
      writeFileSync(path.join(clone, "variants", "litopencode", "lit-docx", "SKILL.md"), "copy\n");
      const script = installBlock.join("\n").replaceAll("<skill>", "lit-docx").replaceAll("<path to your wjgoarxiv-skills clone>", clone);
      const result = spawnSync(shell, ["-c", script], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
      assert.equal(result.stdout.trim(), target, `${shell}: the check line lists the occupied folder`);
      const backups = path.join(home, ".config", "opencode", "extension-backups");
      const [stamp] = readdirSync(backups);
      assert.equal(readFileSync(path.join(backups, stamp, "lit-docx", "notes.md"), "utf8"), "mine\n", shell);
      assert.deepEqual(readdirSync(target).sort(), [".litfamily-extension.json", "SKILL.md"], shell);
      const receipt = JSON.parse(readFileSync(path.join(target, ".litfamily-extension.json"), "utf8"));
      assert.deepEqual([receipt.id, receipt.variant], ["lit-docx", "litopencode"], shell);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

async function withHome(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-extensions-")));
  const previous = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME };
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg-config");
  process.env.XDG_CACHE_HOME = path.join(dir, "xdg-cache");
  try {
    await fn(dir, {
      ...process.env,
      HOME: path.join(dir, "home"),
      XDG_CONFIG_HOME: path.join(dir, "xdg-config"),
      XDG_CACHE_HOME: path.join(dir, "xdg-cache")
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("install tells the user about the LitFamily extensions and leaves the notice for the first session", async () => {
  await withHome(async (dir, env) => {
    const root = path.join(dir, "config");
    const result = runCli(["install", "--root", root], { env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LitFamily extensions/u);
    assert.match(result.stdout, /core is complete and works on its own/u);
    assert.match(result.stdout, /https:\/\/github\.com\/wjgoarxiv\/wjgoarxiv-skills/u);
    assert.match(result.stdout, /full LitFamily experience/u);
    for (const line of installLines) assert.ok(result.stdout.includes(line), line);
    assert.match(result.stdout, /lit-pptx, lit-docx/u);
    assert.doesNotMatch(result.stdout, /left these behind/u, "a fresh install has nothing to clean up");
    assert.doesNotMatch(result.stdout, /\u001b\[/u, "a non-TTY run stays plain");
    const pending = await fs.readFile(path.join(root, pendingExtensionsNoticeName), "utf8");
    assert.match(pending, /LitFamily extensions/u);
    for (const line of installLines) assert.ok(pending.includes(line), line);
  });
});

test("an update names the caches the previous version left behind, by exact path", async () => {
  await withHome(async (dir, env) => {
    const root = path.join(dir, "config");
    const motion = path.join(env.XDG_CACHE_HOME, "litopencode", "motion-runtime");
    const office = path.join(env.XDG_CACHE_HOME, "litopencode", "office");
    const oldPlugin = path.join(env.XDG_CACHE_HOME, "opencode", "packages", "@litfamily", "litopencode@1.0.43");
    const currentPlugin = path.join(env.XDG_CACHE_HOME, "opencode", "packages", "@litfamily", `litopencode@${packageVersion}`);
    for (const directory of [motion, office, oldPlugin, currentPlugin]) await fs.mkdir(directory, { recursive: true });
    const result = runCli(["install", "--root", root], { env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /left these behind/u);
    for (const leftover of [motion, office, oldPlugin]) assert.ok(result.stdout.includes(leftover), leftover);
    assert.ok(!result.stdout.includes(currentPlugin), "the version just installed is not a leftover");
    assert.match(result.stdout, /you can delete them/u);
    const pending = await fs.readFile(path.join(root, pendingExtensionsNoticeName), "utf8");
    assert.ok(pending.includes(motion));
  });
});

test("many old plugin folders are named as one pattern, oldest to newest by version", async () => {
  await withHome(async (dir, env) => {
    const packages = path.join(env.XDG_CACHE_HOME, "opencode", "packages", "@litfamily");
    for (const version of ["1.0.9", "1.0.38", "1.0.43", packageVersion]) await fs.mkdir(path.join(packages, `litopencode@${version}`), { recursive: true });
    assert.deepEqual(await previousVersionLeftovers(packageVersion, env), [`${packages}/litopencode@<version>\n    (3 old versions, 1.0.9 to 1.0.43)`]);
  });
});

test("the dry run is pure JSON: no notice text and no pending notice file", async () => {
  await withHome(async (dir, env) => {
    const root = path.join(dir, "config");
    const result = runCli(["install", "--root", root, "--dry-run"], { env });
    assert.equal(result.status, 0, result.stderr);
    JSON.parse(result.stdout);
    assert.doesNotMatch(result.stdout, /LitFamily extensions/u);
    await assert.rejects(fs.lstat(path.join(root, pendingExtensionsNoticeName)), { code: "ENOENT" });
    const doctor = runCli(["doctor", "--root", root, "--json"], { env });
    assert.doesNotMatch(doctor.stdout, /LitFamily extensions/u);
  });
});

test("v1 chat: the first root session after an install relays the notice once; a child session leaves it", async () => {
  await withHome(async (dir) => {
    const project = path.join(dir, "project");
    await fs.mkdir(project, { recursive: true });
    const configRoot = path.join(process.env.XDG_CONFIG_HOME, "opencode");
    await fs.mkdir(configRoot, { recursive: true });
    await writePendingExtensionsNotice(configRoot, extensionsNoticeLines().join("\n"));
    const sessions = { ses_root: {}, ses_child: { parentID: "ses_root" }, ses_next: {} };
    const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id, ...sessions[requestPath.id] } }) } };
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: project, worktree: project, client });
    const send = async (sessionID, text, id) => {
      const output = { message: { id, sessionID, role: "user" }, parts: [{ id: `p_${id}`, sessionID, messageID: id, type: "text", text }] };
      await hooks["chat.message"]({ sessionID, messageID: id, agent: "build" }, output);
      return output.parts.slice(1);
    };
    try {
      assert.doesNotMatch((await send("ses_child", "hello", "m1")).map((part) => part.text).join("\n"), /LitFamily extensions/u);
      const first = await send("ses_root", "hello", "m2");
      const notice = first.find((part) => /LitFamily extensions/u.test(part.text));
      assert.ok(notice, "the first root turn carries the notice");
      assert.equal(notice.synthetic, true, "the notice is not shown as the user's own words");
      assert.match(notice.text, /once/u);
      assert.equal(first.length, 1, "the skill names in the notice start no workflow of their own");
      assert.doesNotMatch((await send("ses_root", "again", "m3")).map((part) => part.text).join("\n"), /LitFamily extensions/u);
      assert.doesNotMatch((await send("ses_next", "new session", "m4")).map((part) => part.text).join("\n"), /LitFamily extensions/u);
      await assert.rejects(fs.lstat(path.join(configRoot, pendingExtensionsNoticeName)), { code: "ENOENT" });
    } finally {
      await hooks.dispose();
    }
  });
});

test("v2 prompt: the first root prompt after an install carries the notice into the request once", async () => {
  await withHome(async (dir) => {
    const project = path.join(dir, "project");
    await fs.mkdir(project, { recursive: true });
    const configRoot = path.join(process.env.XDG_CONFIG_HOME, "opencode");
    await fs.mkdir(configRoot, { recursive: true });
    await writePendingExtensionsNotice(configRoot, "LitFamily extensions\nLitOpenCode's core is complete and works on its own.");
    const sessions = { ses_root: { id: "ses_root", agent: "build" } };
    const fake = createFakeV2Context({ directory: project, sessions });
    const cleanup = await setupLitOpenCodeServer(fake.context);
    const prompt = (sessionID, text, messageID) => fake.run("session", "prompt", { sessionID, messageID, prompt: { text }, delivery: "queue" });
    const system = async (sessionID) => (await fake.run("session", "context", { sessionID, agent: "build", model: { providerID: "openai", id: "gpt-test" }, system: [], messages: [], options: {}, tools: {} })).system.map((part) => part.text).join("\n");
    try {
      await prompt("ses_root", "hello", "v1");
      assert.match(await system("ses_root"), /LitFamily extensions/u);
      await prompt("ses_root", "again", "v2");
      assert.doesNotMatch(await system("ses_root"), /LitFamily extensions/u);
    } finally {
      await cleanup();
    }
  });
});
