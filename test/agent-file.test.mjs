// The LitFamily block in OpenCode's global AGENTS.md (<config root>/AGENTS.md): added on a yes, kept
// current on install, removed by `agent-file remove`, never touching the user's own text. Everything
// here runs in temp HOME / XDG folders; the real ~/.config/opencode and ~/.claude are never read.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { inspectBlock, removeBlock, upsertBlock } from "../src/cli/managed-block.ts";
import {
  AGENT_FILE_MAX_BYTES,
  agentFileBody,
  agentFileState,
  applyAgentFile,
  globalAgentFilePath
} from "../src/cli/agent-file.ts";
import { installAgentFile } from "../src/cli/agent-file-command.ts";
import { packageVersion, runCli } from "../test-support/cli-fixture.ts";

const START = (v) => `<!-- litfamily:litopencode:start v=${v} -->`;
const END = "<!-- litfamily:litopencode:end -->";
const block = { id: "litopencode", version: "1.0.0", body: "## LitFamily\n\n- rule one\n" };

async function withSandbox(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-agent-file-")));
  try {
    const home = path.join(dir, "home");
    // Not the XDG default: on the default root install runs the real `opencode plugin` command.
    const root = path.join(dir, "opencode-root");
    await fs.mkdir(home, { recursive: true });
    await fn({
      dir,
      home,
      root,
      file: path.join(root, "AGENTS.md"),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(dir, "xdg-config"),
        XDG_DATA_HOME: path.join(dir, "xdg-data"),
        XDG_CACHE_HOME: path.join(dir, "xdg-cache"),
        XDG_STATE_HOME: path.join(dir, "xdg-state"),
        LITOPENCODE_MOTION_PREWARM: "off",
        LITOPENCODE_NO_AUTO_UPDATE: "1",
        LITOPENCODE_NO_UPDATE_CHECK: "1",
        NO_UPDATE_NOTIFIER: "1"
      }
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const install = (sandbox, extra = [], options = {}) =>
  runCli(["install", "--root", sandbox.root, "--no-model-prompt", "--no-permission-prompt", "--no-auto-update", ...extra], {
    env: sandbox.env,
    input: "",
    ...options
  });
const agentFile = (sandbox, args, options = {}) =>
  runCli(["agent-file", ...args, "--root", sandbox.root], { env: sandbox.env, input: "", ...options });
const backups = async (root) => (await fs.readdir(root)).filter((name) => name.includes("litfamily-backup"));
const count = (text, needle) => text.split(needle).length - 1;

describe("managed block on text", () => {
  test("adds the block after the user's text and removes exactly what it added", () => {
    for (const original of ["", "mine\n", "# Title\n\nline\n\n", "no newline at the end", "mixed\r\nendings\n"]) {
      const added = upsertBlock(original, block);
      assert.equal(added.changed, true);
      assert.deepEqual(inspectBlock(added.text, "litopencode"), { state: "present", version: "1.0.0", created: false });
      assert.ok(added.text.startsWith(original), "the user's bytes stay first");
      assert.equal(removeBlock(added.text, "litopencode").text, original, JSON.stringify(original));
      const refreshed = upsertBlock(added.text, { ...block, version: "2.0.0", body: "## LitFamily\n\n- newer\n" });
      assert.equal(removeBlock(refreshed.text, "litopencode").text, original, `after a refresh: ${JSON.stringify(original)}`);
    }
  });

  test("a second upsert changes nothing and a refresh replaces only the bytes between the markers", () => {
    const first = upsertBlock("mine\n", block).text;
    assert.deepEqual(upsertBlock(first, block), { text: first, changed: false });
    const withTail = `${first}\nafter the block\n`;
    const next = upsertBlock(withTail, { ...block, version: "1.0.1", body: "## LitFamily\n\n- rule two\n" });
    assert.ok(next.text.startsWith("mine\n\n") && next.text.endsWith("\nafter the block\n"));
    assert.match(next.text, /rule two/u);
    assert.doesNotMatch(next.text, /rule one/u);
    assert.equal(inspectBlock(next.text, "litopencode").version, "1.0.1");
  });

  test("keeps CRLF files in CRLF and leaves another product's block alone", () => {
    const added = upsertBlock("mine\r\nsecond\r\n", block).text;
    assert.ok(!/[^\r]\n/u.test(added), "every new line ends with CRLF");
    const other = upsertBlock("mine\n", { id: "someother", version: "0.1.0", body: "other rules\n" }).text;
    const both = upsertBlock(other, block).text;
    assert.match(both, /other rules/u);
    assert.equal(removeBlock(both, "litopencode").text, other);
  });

  test("a start without an end, an end before the start, or two starts is malformed and refused", () => {
    const start = START("1.0.0");
    for (const text of [`${start}\nbody\n`, `${END}\n${start}\n`, `${start}\n${start}\n${END}\n`]) {
      assert.equal(inspectBlock(text, "litopencode").state, "malformed");
      assert.throws(() => upsertBlock(text, block), /malformed/u);
      assert.throws(() => removeBlock(text, "litopencode"), /malformed/u);
    }
  });
});

describe("the shipped block text", () => {
  test("stays under the size cap and speaks only of LitOpenCode and OpenCode", () => {
    for (const kind of ["global", "project"]) {
      const body = agentFileBody(kind);
      assert.ok(Buffer.byteLength(body) <= AGENT_FILE_MAX_BYTES, `${kind} block is ${Buffer.byteLength(body)} bytes`);
      assert.match(body, /LitOpenCode/u);
      assert.match(body, /OpenCode/u);
      assert.match(body, /\.litopencode\//u);
      assert.match(body, /Never push, publish, tag or bump a version/u);
      assert.doesNotMatch(body, /litclaude|litcodex|lithermes|litgrok|litmuse|litgravity|Claude Code|Codex|Hermes|Grok|Muse|Gemini/iu);
    }
    assert.match(agentFileBody("global"), /litopencode agent-file off/u);
  });
});

describe("agent file on disk", () => {
  test("creates a missing file, backs up an existing one once, writes nothing on a repeat or a dry run", async () => {
    await withSandbox(async ({ dir }) => {
      const fresh = path.join(dir, "fresh", "AGENTS.md");
      assert.equal(applyAgentFile({ path: fresh, ...block, action: "install" }).status, "created");
      assert.equal((await fs.readdir(path.dirname(fresh))).length, 1, "no backup for a file that did not exist");

      const target = path.join(dir, "AGENTS.md");
      await fs.writeFile(target, "mine\n");
      const dry = applyAgentFile({ path: target, ...block, action: "install", dryRun: true });
      assert.equal(dry.status, "dry-run");
      assert.match(dry.preview, /litfamily:litopencode:start/u);
      assert.equal(await fs.readFile(target, "utf8"), "mine\n");

      const first = applyAgentFile({ path: target, ...block, action: "install", now: new Date("2026-10-30T00:00:00Z") });
      assert.equal(first.status, "updated");
      assert.equal(await fs.readFile(first.backup, "utf8"), "mine\n");
      assert.equal(applyAgentFile({ path: target, ...block, action: "install" }).status, "unchanged");
      assert.equal((await fs.readdir(dir)).filter((name) => name.includes("litfamily-backup")).length, 1);
    });
  });

  test("uninstall restores the user's bytes and deletes a file it alone created", async () => {
    await withSandbox(async ({ dir }) => {
      const target = path.join(dir, "AGENTS.md");
      await fs.writeFile(target, "# Mine\r\n\r\nkeep me\r\n");
      applyAgentFile({ path: target, ...block, action: "install" });
      assert.equal(applyAgentFile({ path: target, ...block, action: "uninstall" }).status, "removed");
      assert.equal(await fs.readFile(target, "utf8"), "# Mine\r\n\r\nkeep me\r\n");
      assert.equal(applyAgentFile({ path: target, ...block, action: "uninstall" }).status, "absent");

      const made = path.join(dir, "made", "AGENTS.md");
      applyAgentFile({ path: made, ...block, action: "install" });
      assert.equal(applyAgentFile({ path: made, ...block, action: "uninstall" }).status, "removed");
      assert.equal(fsSync.existsSync(made), false);
    });
  });

  test("refuses a symlink, a directory, a malformed pair and a non-UTF-8 file, leaving each as it was", async () => {
    await withSandbox(async ({ dir }) => {
      const real = path.join(dir, "real.md");
      await fs.writeFile(real, "mine\n");
      const link = path.join(dir, "link.md");
      await fs.symlink(real, link);
      assert.equal(applyAgentFile({ path: link, ...block, action: "install" }).status, "refused-symlink");
      assert.equal(await fs.readFile(real, "utf8"), "mine\n");

      const folder = path.join(dir, "folder");
      await fs.mkdir(folder);
      assert.equal(applyAgentFile({ path: folder, ...block, action: "install" }).status, "refused-not-file");

      const broken = path.join(dir, "broken.md");
      await fs.writeFile(broken, `${START("1.0.0")}\nno end\n`);
      assert.equal(applyAgentFile({ path: broken, ...block, action: "install" }).status, "refused-malformed");
      assert.equal(await fs.readFile(broken, "utf8"), `${START("1.0.0")}\nno end\n`);

      const utf16 = path.join(dir, "utf16.md");
      await fs.writeFile(utf16, Buffer.from([0xff, 0xfe, 0x41, 0x00]));
      assert.equal(applyAgentFile({ path: utf16, ...block, action: "install" }).status, "refused-not-utf8");
    });
  });

  test("reports present, stale, absent, malformed and symlink states", async () => {
    await withSandbox(async ({ dir }) => {
      const target = path.join(dir, "AGENTS.md");
      assert.equal(agentFileState({ path: target, version: "1.0.0" }), "absent");
      await fs.writeFile(target, "mine\n");
      assert.equal(agentFileState({ path: target, version: "1.0.0" }), "absent");
      applyAgentFile({ path: target, ...block, action: "install" });
      assert.equal(agentFileState({ path: target, version: "1.0.0" }), "present v=1.0.0");
      assert.equal(agentFileState({ path: target, version: "1.0.1" }), "stale v=1.0.0");
      await fs.writeFile(target, `${START("1.0.0")}\n`);
      assert.equal(agentFileState({ path: target, version: "1.0.0" }), "malformed");
      const link = path.join(dir, "link.md");
      await fs.symlink(target, link);
      assert.equal(agentFileState({ path: link, version: "1.0.0" }), "symlink");
    });
  });

  test("follows XDG_CONFIG_HOME and the --root folder", () => {
    assert.equal(globalAgentFilePath("/tmp/x/opencode"), path.join("/tmp/x/opencode", "AGENTS.md"));
  });
});

const choice = (extra = {}) => ({ version: packageVersion, assumeYes: false, skip: false, ...extra });
const stored = async (root) => JSON.parse(await fs.readFile(path.join(root, "litopencode.json"), "utf8")).agentFile;

describe("the install step", () => {
  test("adds one block on a yes, keeps it on a repeat, and refreshes an older one without asking", async () => {
    await withSandbox(async (sandbox) => {
      await fs.mkdir(sandbox.root, { recursive: true });
      const original = "# My OpenCode rules\r\n\r\n- keep tests fast\r\n";
      await fs.writeFile(sandbox.file, original);
      const never = async () => assert.fail("a yes needs no question");

      const first = await installAgentFile({ root: sandbox.root, ...choice({ assumeYes: true }) }, sandbox.env, never);
      assert.match(first, /^AGENT_FILE: updated /u);
      const added = await fs.readFile(sandbox.file, "utf8");
      assert.ok(added.startsWith(original));
      assert.equal(count(added, "litfamily:litopencode:start"), 1);
      assert.equal((await backups(sandbox.root)).length, 1);

      const again = await installAgentFile({ root: sandbox.root, ...choice({ assumeYes: true }) }, sandbox.env, never);
      assert.match(again, /^AGENT_FILE: unchanged /u);
      assert.equal(await fs.readFile(sandbox.file, "utf8"), added);

      await fs.writeFile(sandbox.file, `mine\n\n${START("0.0.1")}\nold text\n${END}\n`);
      const refreshed = await installAgentFile({ root: sandbox.root, ...choice() }, sandbox.env, never);
      assert.match(refreshed, /^AGENT_FILE: updated /u);
      const text = await fs.readFile(sandbox.file, "utf8");
      assert.match(text, new RegExp(`start v=${packageVersion.replaceAll(".", "\\.")}`, "u"));
      assert.doesNotMatch(text, /old text/u);
      assert.ok(text.startsWith("mine\n\n"));
    });
  });

  test("asks only when there is no block yet; No stores off, Yes adds, and no terminal means skipped", async () => {
    await withSandbox(async (sandbox) => {
      const prompted = { ...sandbox.env, LITOPENCODE_AGENT_FILE_PROMPT: "1" };
      const quiet = { ...sandbox.env, LITOPENCODE_AGENT_FILE_PROMPT: "0" };
      const skipped = await installAgentFile({ root: sandbox.root, ...choice() }, quiet, async () => assert.fail("no terminal, no question"));
      assert.match(skipped, /^AGENT_FILE: skipped /u);
      assert.equal(fsSync.existsSync(sandbox.file), false);

      const no = await installAgentFile({ root: sandbox.root, ...choice() }, prompted, async () => false);
      assert.match(no, /^AGENT_FILE: off /u);
      assert.equal(fsSync.existsSync(sandbox.file), false);
      assert.equal(await stored(sandbox.root), "off");

      // A stored off beats --yes and the question.
      const yes = await installAgentFile({ root: sandbox.root, ...choice({ assumeYes: true }) }, prompted, async () => assert.fail("off is final"));
      assert.match(yes, /^AGENT_FILE: off /u);
      assert.equal(fsSync.existsSync(sandbox.file), false);
    });
  });

  test("a Yes at the question adds the block", async () => {
    await withSandbox(async (sandbox) => {
      const line = await installAgentFile({ root: sandbox.root, ...choice() }, { ...sandbox.env, LITOPENCODE_AGENT_FILE_PROMPT: "1" }, async () => true);
      assert.match(line, /^AGENT_FILE: created /u);
      assert.match(await fs.readFile(sandbox.file, "utf8"), /litfamily:litopencode:start/u);
    });
  });

  test("--no-agent-file leaves the file alone for that run, even over an existing block", async () => {
    await withSandbox(async (sandbox) => {
      await fs.mkdir(sandbox.root, { recursive: true });
      await fs.writeFile(sandbox.file, `${START("0.0.1")}\nold text\n${END}\n`);
      const line = await installAgentFile({ root: sandbox.root, ...choice({ assumeYes: true, skip: true }) }, sandbox.env);
      assert.match(line, /^AGENT_FILE: off /u);
      assert.match(await fs.readFile(sandbox.file, "utf8"), /old text/u);
      assert.equal(fsSync.existsSync(path.join(sandbox.root, "litopencode.json")), false, "a per-run skip stores nothing");
    });
  });

  test("never creates the file while ~/.claude/CLAUDE.md is what OpenCode would otherwise read", async () => {
    await withSandbox(async (sandbox) => {
      await fs.mkdir(path.join(sandbox.home, ".claude"), { recursive: true });
      await fs.writeFile(path.join(sandbox.home, ".claude", "CLAUDE.md"), "my claude rules\n");
      const line = await installAgentFile({ root: sandbox.root, ...choice({ assumeYes: true }) }, sandbox.env);
      assert.match(line, /^AGENT_FILE: skipped-claude-fallback /u);
      assert.equal(fsSync.existsSync(sandbox.file), false);

      // An AGENTS.md the user already has hides nothing new, and the host's own switch frees the fallback.
      await fs.mkdir(sandbox.root, { recursive: true });
      await fs.writeFile(sandbox.file, "mine\n");
      assert.match(await installAgentFile({ root: sandbox.root, ...choice({ assumeYes: true }) }, sandbox.env), /^AGENT_FILE: updated /u);
      await fs.rm(sandbox.file);
      const free = { ...sandbox.env, OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "1" };
      assert.match(await installAgentFile({ root: sandbox.root, ...choice({ assumeYes: true }) }, free), /^AGENT_FILE: created /u);
    });
  });

  test("a malformed or symlinked AGENTS.md is reported and left untouched", async () => {
    await withSandbox(async (sandbox) => {
      await fs.mkdir(sandbox.root, { recursive: true });
      await fs.writeFile(sandbox.file, `${START("1.0.0")}\nno end marker\n`);
      assert.match(await installAgentFile({ root: sandbox.root, ...choice({ assumeYes: true }) }, sandbox.env), /^AGENT_FILE: refused-malformed /u);
      assert.equal(await fs.readFile(sandbox.file, "utf8"), `${START("1.0.0")}\nno end marker\n`);

      await fs.rm(sandbox.file);
      const elsewhere = path.join(sandbox.dir, "elsewhere.md");
      await fs.writeFile(elsewhere, "elsewhere\n");
      await fs.symlink(elsewhere, sandbox.file);
      assert.match(await installAgentFile({ root: sandbox.root, ...choice({ assumeYes: true }) }, sandbox.env), /^AGENT_FILE: refused-symlink /u);
      assert.equal(await fs.readFile(elsewhere, "utf8"), "elsewhere\n");
    });
  });
});

describe("litopencode agent-file", () => {
  test("on adds the block and off removes it at once, each storing the setting; remove keeps the setting", async () => {
    await withSandbox(async (sandbox) => {
      await fs.mkdir(sandbox.root, { recursive: true });
      await fs.writeFile(sandbox.file, "mine\n");
      const on = agentFile(sandbox, ["on"]);
      assert.equal(on.status, 0, on.stderr);
      assert.match(await fs.readFile(sandbox.file, "utf8"), /litfamily:litopencode:start/u);
      assert.equal(await stored(sandbox.root), "on");
      const litConfig = JSON.parse(await fs.readFile(path.join(sandbox.root, "litopencode.json"), "utf8"));
      assert.ok(litConfig.agents, "a litopencode.json started by this command still carries the install defaults");

      const removed = agentFile(sandbox, ["remove"]);
      assert.match(removed.stdout, /AGENT_FILE: removed/u);
      assert.equal(await fs.readFile(sandbox.file, "utf8"), "mine\n");
      assert.equal(await stored(sandbox.root), "on");

      agentFile(sandbox, ["on"]);
      const off = agentFile(sandbox, ["off"]);
      assert.equal(off.status, 0, off.stderr);
      assert.equal(await fs.readFile(sandbox.file, "utf8"), "mine\n");
      assert.equal(await stored(sandbox.root), "off");
    });
  });

  test("a dry run writes nothing", async () => {
    await withSandbox(async (sandbox) => {
      const dry = agentFile(sandbox, ["on", "--dry-run"]);
      assert.equal(dry.status, 0, dry.stderr);
      assert.match(dry.stdout, /AGENT_FILE: dry-run/u);
      assert.equal(fsSync.existsSync(sandbox.file), false);
      assert.equal(fsSync.existsSync(path.join(sandbox.root, "litopencode.json")), false);
    });
  });

  test("project writes the project block into AGENTS.md without a backup", async () => {
    await withSandbox(async (sandbox) => {
      const repo = path.join(sandbox.dir, "repo");
      await fs.mkdir(repo);
      await fs.writeFile(path.join(repo, "AGENTS.md"), "# Repo rules\n");
      const first = runCli(["agent-file", "project", "--dir", repo], { env: sandbox.env, input: "" });
      assert.equal(first.status, 0, first.stderr);
      const text = await fs.readFile(path.join(repo, "AGENTS.md"), "utf8");
      assert.ok(text.startsWith("# Repo rules\n"));
      assert.equal(count(text, "litfamily:litopencode:start"), 1);
      assert.match(text, /\.litopencode\//u);
      assert.deepEqual((await fs.readdir(repo)).sort(), ["AGENTS.md"]);
      const second = runCli(["agent-file", "project", "--dir", repo], { env: sandbox.env, input: "" });
      assert.match(second.stdout, /AGENT_FILE: unchanged/u);
      assert.equal(await fs.readFile(path.join(repo, "AGENTS.md"), "utf8"), text);
      const bad = runCli(["agent-file", "project", "--dir", path.join(repo, "missing")], { env: sandbox.env, input: "" });
      assert.notEqual(bad.status, 0);
    });
  });

  test("refuses an unknown action", async () => {
    await withSandbox(async (sandbox) => {
      const result = runCli(["agent-file", "sideways"], { env: sandbox.env, input: "" });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /agent-file requires an action/u);
    });
  });
});

describe("litopencode install and doctor", () => {
  test("a full install writes nothing without a yes; --yes adds one block, repeats cleanly, and remove restores the bytes", async () => {
    await withSandbox(async (sandbox) => {
      await fs.mkdir(sandbox.root, { recursive: true });
      const original = "# My OpenCode rules\r\n\r\n- keep tests fast\r\n";
      await fs.writeFile(sandbox.file, original);

      const plain = install(sandbox);
      assert.equal(plain.status, 0, plain.stderr);
      assert.match(plain.stdout, /AGENT_FILE: skipped/u);
      assert.equal(await fs.readFile(sandbox.file, "utf8"), original);

      const dry = install(sandbox, ["--yes", "--dry-run"]);
      assert.equal(dry.status, 0, dry.stderr);
      assert.equal(JSON.parse(dry.stdout).agentFile.action, "add");
      assert.equal(await fs.readFile(sandbox.file, "utf8"), original);

      const first = install(sandbox, ["--yes"]);
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, /AGENT_FILE: updated/u);
      const added = await fs.readFile(sandbox.file, "utf8");
      assert.equal(count(added, "litfamily:litopencode:start"), 1);

      const second = install(sandbox, ["--yes"]);
      assert.match(second.stdout, /AGENT_FILE: unchanged/u);
      assert.equal(await fs.readFile(sandbox.file, "utf8"), added);
      assert.equal((await backups(sandbox.root)).length, 1);

      const doctor = () => JSON.parse(runCli(["doctor", "--root", sandbox.root, "--no-auto-update"], { env: sandbox.env, input: "" }).stdout).agentFile;
      assert.equal(doctor().state, `present v=${packageVersion}`);
      assert.equal(doctor().path, sandbox.file);
      assert.match(doctor().line, /^AGENT_FILE: present v=/u);

      assert.match(agentFile(sandbox, ["remove"]).stdout, /AGENT_FILE: removed/u);
      assert.equal(await fs.readFile(sandbox.file, "utf8"), original);
    });
  });

  test("the install question stores a No as off, and doctor then says off", async () => {
    await withSandbox(async (sandbox) => {
      const asked = install(sandbox, [], { env: { ...sandbox.env, LITOPENCODE_AGENT_FILE_PROMPT: "1" }, input: "n\n" });
      assert.equal(asked.status, 0, asked.stderr);
      assert.match(asked.stdout, /AGENT_FILE: off/u);
      assert.equal(fsSync.existsSync(sandbox.file), false);
      assert.equal(await stored(sandbox.root), "off");
      const skipped = install(sandbox, ["--yes", "--no-agent-file"]);
      assert.equal(skipped.status, 0, skipped.stderr);
      assert.equal(fsSync.existsSync(sandbox.file), false);
      const doctor = JSON.parse(runCli(["doctor", "--root", sandbox.root, "--no-auto-update"], { env: sandbox.env, input: "" }).stdout).agentFile;
      assert.equal(doctor.state, "off");
    });
  });
});
