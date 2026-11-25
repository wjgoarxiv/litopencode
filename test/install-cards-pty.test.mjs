import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const repo = path.resolve(import.meta.dirname, "..");
const bin = path.join(repo, "bin", "litopencode.cjs");
const python = spawnSync("python3", ["-c", "import pty, termios"], { encoding: "utf8" });
const skip = process.platform === "win32" || python.status !== 0 ? "requires POSIX PTY and python3" : false;
const gateway = { provider: { "my-gateway": { models: Object.fromEntries(Array.from({ length: 180 }, (_, index) => [`coder-${String(100 + index)}b`, {}])) }, "local-lab": { models: { "qwen-mini": {} } } } };
// What was printed after the mark, as words.
const strip = (text) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "").replace(/\r+\n/gu, "\n").replace(/^[\s\S]*?litopencode v/u, "");
// Each wait starts where the last one matched, so a title is this card's and "Ctrl+C stop" its last row.
const card = (title, send) => [`${title}[\\s\\S]*?Ctrl\\+C stop`, send];
const down = "\u001b[B";

async function withRoot(run) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-cards-"));
  try {
    const root = path.join(home, "config");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "opencode.json"), JSON.stringify(gateway));
    const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, "xdg"), XDG_DATA_HOME: path.join(home, "data"), XDG_CACHE_HOME: path.join(home, "cache"),
      LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor", NO_UPDATE_NOTIFIER: "1", LITOPENCODE_GLYPHS: "basic" };
    for (const key of ["CI", "NO_COLOR", "FORCE_COLOR", "LC_CTYPE", "OPENAI_API_KEY", "XAI_API_KEY", "LITOPENCODE_AGENT_FILE_PROMPT", "LITOPENCODE_AGENT_FILE", "COLORFGBG"]) delete env[key];
    return await run({ root, env, home });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

function tty({ root, env, home }, steps, { args = [], cols = 100, rows = 40 } = {}) {
  const result = spawnSync("python3", [path.join(repo, "test-support", "installed-tty.py")], {
    input: JSON.stringify({ argv: [process.execPath, bin, "install", "--root", root, "--no-auto-update", ...args], cwd: home, env, steps, cols, rows }),
    encoding: "utf8", timeout: 100_000, maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.timedOut, false, strip(receipt.output).slice(-3000));
  assert.doesNotMatch(receipt.output, /Select \d+-\d+ \[/u, "no plain prompt was shown");
  return receipt;
}
const settings = async (root) => JSON.parse(await fs.readFile(path.join(root, "litopencode.json"), "utf8"));

test("the real installer asks every question as a card and stores what the plain prompts store", { skip, timeout: 400_000 }, async () => {
  let drawn;
  await withRoot(async (place) => {
    const receipt = tty(place, [
      card("Lead provider", "\r"), card("Lead model", "\r"), card("Lead reasoning effort", `${down}\r`),
      card("Helper provider", "2\r"), card("Helper model", "coder-17"), ["6 of 180|10 of 180", `${down}\r`],
      card("Model route", "\r"), card("Permissions", "j\r"), card("Output style", "3\r"), card("LitFamily block", "y")
    ]);
    const text = strip(receipt.output);
    assert.equal(receipt.exit, 0, text);
    assert.equal(receipt.stepsSent, 10, text);
    assert.match(text, /LIT 1\/10[\s\S]*LIT 4\/10[\s\S]*LIT 5\/9[\s\S]*LIT 9\/9/u);
    assert.match(text, /OPENAI_API_KEY is not set and OpenCode has no stored openai/u);
    assert.match(text, /LitOpenCode \S+ is installed[\s\S]*Restart OpenCode, press Tab, choose lit-loop/u);
    assert.match(await fs.readFile(path.join(place.root, "AGENTS.md"), "utf8"), /lit/u);
    drawn = await settings(place.root);
    assert.equal(drawn.outputStyle, "eli5");
    assert.equal(drawn.permissionMode, "balanced");
  });
  await withRoot(async ({ root, env, home }) => {
    const plain = spawnSync(process.execPath, [bin, "install", "--root", root, "--no-auto-update", "--model-prompt", "--no-permission-prompt", "--permission-mode", "balanced", "--no-agent-file"], {
      cwd: home, env, input: "0\n0\n4\n2\n71\n\n", encoding: "utf8"
    });
    assert.equal(plain.status, 0, plain.stderr);
    const { outputStyle, ...rest } = drawn;
    assert.equal(outputStyle, "eli5");
    const { outputStyle: untouched, ...stored } = await settings(root);
    assert.equal(untouched ?? "off", "off");
    assert.deepEqual(rest, stored, "the same routes and permissions as the plain prompts");
  });
});

test("Ctrl+C at any card before the install ends with exit 1, the same message and nothing written", { skip, timeout: 400_000 }, async () => {
  const before = [
    [card("Lead provider", "\u0003")],
    [card("Lead provider", "2\r"), card("Lead model", "\u0003")],
    [card("Lead provider", "4\r"), card("Lead model", "\u0003")],
    [card("Lead provider", "2\r"), card("Lead model", "\r"), card("Helper provider", "3\r"), card("Helper model", "\r"), card("Model route", "\u0003")]
  ];
  for (const steps of before) {
    await withRoot(async (place) => {
      const receipt = tty(place, steps, { cols: 80, rows: 24 });
      const text = strip(receipt.output);
      assert.equal(receipt.exit, 1, text);
      assert.equal(receipt.stepsSent, steps.length, text);
      assert.match(text, /stopped\n ✗ Installer stopped before completion\.\n\nERROR: Aborted with Ctrl\+C\n/u);
      assert.ok(receipt.output.lastIndexOf("\u001b[?25h") > receipt.output.lastIndexOf("\u001b[?25l"), "the cursor is back");
      assert.deepEqual(await fs.readdir(place.root), ["opencode.json"]);
    });
  }
});

test("a typed model is checked in its card; a No at the block is stored; a saved route is the current one", { skip, timeout: 400_000 }, async () => {
  await withRoot(async (place) => {
    const typed = tty(place, [
      card("Lead provider", "4\r"), card("Lead model", "my-gateway/nope\r"), ["does not list my-gateway/nope", "\u0015local-lab/qwen-mini\r"],
      card("Helper provider", "\r"), card("Helper model", "\r"), card("Model route", "\r"), card("Permissions", "\r"), card("Output style", "\r"), card("LitFamily block", "n")
    ], { cols: 80, rows: 24 });
    assert.equal(typed.exit, 0, strip(typed.output));
    assert.match(strip(typed.output).replace(/\s+│\n\s*│\s+/gu, " "), /does not list my-gateway\/nope\.[^❯]*[^.]\. 2 tries left\./u);
    const stored = await settings(place.root);
    assert.deepEqual([stored.categories.planning.provider, stored.categories.planning.model], ["local-lab", "qwen-mini"]);
    assert.equal(stored.agentFile, "off");
    await assert.rejects(fs.access(path.join(place.root, "AGENTS.md")), { code: "ENOENT" });
  });
  await withRoot(async (place) => {
    const first = tty(place, [], { args: ["--yes", "--provider", "xai", "--model", "grok-4.3", "--no-agent-file"] });
    assert.equal(first.exit, 0);
    assert.doesNotMatch(first.output, /\u001b\[\?25l/u, "--yes draws no card");
    const again = tty(place, [card("Lead provider", "\r"), card("Lead model", "\u0003")]);
    assert.match(strip(again.output), /❯ 1 xAI Grok[^\n]* current/u);
  });
});

test("a failed step stays on screen with the error, and the terminal is restored", { skip, timeout: 120_000 }, async () => {
  await withRoot(async (place) => {
    await fs.writeFile(path.join(place.root, "skills"), "not a folder");
    const receipt = tty(place, [card("Output style", "\r")], { args: ["--no-model-prompt", "--no-permission-prompt", "--no-agent-file"] });
    const text = strip(receipt.output);
    assert.equal(receipt.exit, 1, text);
    assert.match(text, /✗ Host config[\s\S]*INSTALL STOPPED[\s\S]*✗ Stage +Host config[\s\S]*✗ Reason [\s\S]*\n\nERROR: /u);
    assert.ok(receipt.output.lastIndexOf("\u001b[?25h") > receipt.output.lastIndexOf("\u001b[?25l"));
  });
});
