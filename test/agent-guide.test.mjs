import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { agentCommands, agentGuide, agentPointer, installQuestions, pill } from "../src/cli/agent-guide.ts";
import { askAgentFileCard } from "../src/cli/agent-file-command.ts";
import { parseArgs } from "../src/cli/args.ts";
import { iconFontPins } from "../src/cli/icon-font.ts";
import { modelChoiceCards, promptModelSelection, promptOutputStyle, promptPermissionMode } from "../src/cli/model-routing.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";
import { fakeTerminal, keys, pause, utf8 } from "../test-support/card-terminal.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const bin = path.join(repo, "bin", "litopencode.cjs");
const python = spawnSync("python3", ["-c", "import pty, termios"], { encoding: "utf8" });
const noPty = process.platform === "win32" || python.status !== 0 ? "requires POSIX PTY and python3" : false;
const filesIn = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));

function throwaway(dir) {
  const home = path.join(dir, "home");
  fs.mkdirSync(path.join(home, "work"), { recursive: true });
  // A PATH with node's own folder only when it holds no host command; the CLI itself is started by path.
  const env = { PATH: "/usr/bin:/bin", HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, "data"), XDG_CACHE_HOME: path.join(home, "cache"), LANG: "en_US.UTF-8", TERM: "xterm-256color", NO_UPDATE_NOTIFIER: "1" };
  return { home, env, run: (args, extra = {}) => runCli(args, { cwd: path.join(home, "work"), env: { ...env, ...extra } }) };
}

function inTerminal({ home, env }, args, steps = [], size = {}) {
  const result = spawnSync("python3", [path.join(repo, "test-support", "installed-tty.py")], {
    input: JSON.stringify({ argv: [process.execPath, bin, ...args], cwd: path.join(home, "work"), env, steps, cols: 100, rows: 40, ...size }),
    encoding: "utf8", timeout: 100_000, maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("install --agent and --agent print the same plain bytes everywhere and write nothing", () => withTempDir(async (dir) => {
  const place = throwaway(dir);
  const guide = `${agentGuide()}\n`;
  for (const extra of [{}, { NO_COLOR: "1" }, { CI: "1" }, { TERM: "dumb" }, { LC_ALL: "C" }]) {
    for (const args of [["install", "--agent"], ["--agent"], ["install", "--yes", "--agent"], ["--agent", "--yes"], ["install", "--agent", "--dry-run", "--no-such-flag"], ["install", "--root", path.join(dir, "elsewhere"), "--agent"], ["--agent", "--json"]]) {
      const result = place.run(args, extra);
      assert.deepEqual([result.status, result.stdout, result.stderr], [0, guide, ""], `${args.join(" ")} ${JSON.stringify(extra)}`);
    }
  }
  assert.doesNotMatch(guide, /\u001b/u);
  assert.deepEqual(filesIn(dir), []);
}));

test("in a real terminal the guide is the same text and no file appears", { skip: noPty }, () => withTempDir(async (dir) => {
  const place = throwaway(dir);
  for (const args of [["install", "--agent"], ["--agent"]]) {
    const receipt = inTerminal(place, args);
    assert.equal(receipt.exit, 0);
    assert.equal(receipt.output.replaceAll("\r\n", "\n"), `${agentGuide()}\n`);
  }
  assert.deepEqual(filesIn(dir), []);
}));

test("the guide has its steps in order and asks for nothing it may not", () => {
  const guide = agentGuide();
  const order = ["LitOpenCode install guide for coding agents", "If you are a coding agent and your user asked you to install LitOpenCode, follow these steps. They are written for your user to read too.", agentCommands.preview, "Show your user what it would change.", "Keep every default", "Wait for your user's yes. Use only this package; add no other source, and do not approve hooks, trust or sign-in for your user.", agentCommands.install, "Update", agentCommands.doctor, "ROUND_ENDS:", "If a step fails, show your user the lines and stop.", pill, "--glyphs round", "--glyphs auto", "Only your user can"];
  let at = 0;
  for (const text of order) {
    const found = guide.indexOf(text, at);
    assert.ok(found >= 0, `missing or out of order: ${text}`);
    at = found + text.length;
  }
  assert.equal(pill, " LIT ");
  assert.match(agentCommands.install, /--yes --round$/u);
  for (const command of Object.values(agentCommands)) assert.match(command, /^npm exec --yes --package @litfamily\/litopencode@latest -- litopencode /u);
  assert.doesNotMatch(guide, /\bstar\b|sponsor|do not ask|don't ask|--yolo|curl /iu);
  assert.doesNotMatch(guide, /macOS (?:finds|picks|uses|falls back)/iu);
  for (const word of ["Terminal.app", "Non-ASCII Font", "fontFamily", "symbol_map"]) assert.ok(guide.includes(word), word);
});

// One record of what the installer really asks, through the same prompts it uses.
async function askedCards() {
  const asked = [];
  const cards = {
    choose: async ({ title, choices, initial }) => { asked.push({ title, answer: choices[initial].label }); return initial; },
    confirm: async ({ title, initial }) => { asked.push({ title, answer: initial ? "Yes" : "No" }); return initial; },
    proceed: async ({ title }) => { asked.push({ title, answer: "Continue" }); },
    busy: (title, waiting, task) => task(),
    warn() {}, skip() {}, panel() {}, notice() {}
  };
  await promptModelSelection(undefined, "always", false, { class: "fresh", originalDispatchId: null }, "/x/litopencode.json", undefined, () => ({ models: [], known: true }), cards);
  await promptPermissionMode("safe", "always", false, cards);
  await promptOutputStyle("off", "always", false, cards);
  await askAgentFileCard(cards, "/x/AGENTS.md");
  return asked;
}

test("drift: the guide lists exactly the questions the installer asks, with their real defaults", async () => {
  const asked = await askedCards();
  assert.equal(asked.length, modelChoiceCards + 3);
  assert.deepEqual(installQuestions.map(({ title }) => title), asked.map(({ title }) => title));
  for (const [index, { title, answer }] of asked.entries()) assert.ok(answer.toLowerCase().includes(installQuestions[index].default.toLowerCase()), `${title}: the installer marks ${answer}, the guide says ${installQuestions[index].default}`);
  const guide = agentGuide();
  for (const { title, default: value, flag, later } of installQuestions) {
    assert.ok(guide.includes(`${title}: ${value}`), title);
    assert.equal(flag === undefined, later !== undefined, title);
    if (flag === undefined) assert.ok(guide.includes(`your user can choose it later with ${later}`), title);
    else assert.ok(guide.includes(flag), title);
  }
});

test("drift: every flag in the guide is a flag the parser takes", () => {
  const argvOf = (command) => command.split(" -- litopencode ")[1].split(" ");
  for (const command of Object.values(agentCommands)) assert.doesNotThrow(() => parseArgs(argvOf(command)), command);
  const sample = { "--provider": ["--provider", "openai", "--model", "gpt-6-astra"], "--model": ["--provider", "openai", "--model", "gpt-6-astra"], "--effort": ["--model", "openai/gpt-6-astra", "--effort", "high"], "--subagent-model": ["--model", "openai/gpt-6-astra", "--subagent-model", "openai/gpt-6-luna"], "--subagent-effort": ["--model", "openai/gpt-6-astra", "--subagent-model", "openai/gpt-6-luna", "--subagent-effort", "max"], "--permission-mode": ["--permission-mode", "balanced"], "--glyphs": ["--glyphs", "round"], "--host": ["--host", "both"], "--package": [] };
  const flags = new Set(agentGuide().match(/--[a-z][a-z-]+/gu));
  for (const flag of flags) if (flag !== "--agent") assert.doesNotThrow(() => parseArgs(["install", ...(sample[flag] ?? [flag])]), flag);
  const install = parseArgs(argvOf(agentCommands.install));
  assert.deepEqual([install.assumeYes, install.round, install.modelPrompt, install.permissionPrompt, install.outputStylePrompt], [true, true, "never", "never", "never"]);
  assert.deepEqual([parseArgs(argvOf(agentCommands.preview)).dryRun, parseArgs(argvOf(agentCommands.preview)).round], [true, true], "the preview names the font");
});

test("drift: the README prompts give the same steps in full, in English and Korean", () => {
  for (const [file, yes] of [["README.md", /Wait for my yes/u], ["README-Ko-KR.md", /내가 좋다고 할 때까지 기다려/u]]) {
    const readme = fs.readFileSync(path.join(repo, file), "utf8");
    const prompt = readme.match(/<details>\n<summary>[^<]+<\/summary>\n[\s\S]*?```text\n([\s\S]*?)\n```\n\n<\/details>/u)?.[1];
    assert.ok(prompt, file);
    let at = -1;
    for (const command of [agentCommands.preview, agentCommands.install, agentCommands.doctor]) {
      assert.ok(prompt.indexOf(command) > at, `${file}: ${command}`);
      at = prompt.indexOf(command);
    }
    for (const { title, flag } of installQuestions) if (flag !== undefined) for (const part of flag.match(/--[a-z-]+/gu)) assert.ok(prompt.includes(part), `${file}: ${title} ${part}`);
    for (const text of [iconFontPins.files[0].name, "~/Library/Fonts", "~/.local/share/fonts", "ROUND_ENDS:", "--glyphs round", "--glyphs square", "--glyphs auto", pill, "install.ok", "install.plugin.ok", "install.nativeSkills.ok", "@litfamily/litopencode", "/lit-model"]) assert.ok(prompt.includes(text), `${file}: ${text}`);
    assert.match(prompt, yes, file);
    assert.match(prompt, /lit-loop/u, file);
    assert.doesNotMatch(prompt, /--agent|\bstar\b|--yolo/iu, `${file}: it stands alone for versions without --agent`);
  }
});

test("--help has one line for agents", () => {
  const lines = runCli(["--help"]).stdout.split("\n").filter((text) => text.startsWith("Are you an agent?"));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /litopencode@latest install --agent/u);
});

test("a run with no person at a terminal gets one pointer after the first banner line; JSON stays JSON", () => withTempDir(async (dir) => {
  const place = throwaway(dir);
  const root = path.join(dir, "root");
  fs.mkdirSync(root);
  const result = place.run(["install", "--yes", "--root", root]);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.split("\n");
  assert.deepEqual(lines.slice(0, 2), ["LIT · opencode", agentPointer]);
  assert.equal(lines.filter((text) => text === agentPointer).length, 1);
  assert.match(lines[2], /^litopencode v/u);
  JSON.parse(place.run(["install", "--dry-run", "--root", root]).stdout);
  JSON.parse(place.run(["doctor", "--root", root]).stdout);
}));

test("a run without progress screens gives a person at a terminal no pointer, and install prints none beside --json", () => withTempDir(async (dir) => {
  const place = throwaway(dir);
  const root = path.join(dir, "root");
  fs.mkdirSync(root);
  const cli = new URL("../src/cli.ts", import.meta.url).href;
  // The two streams only claim to be a terminal here; the run is the one a program gets from runCli.
  const code = `process.stdin.isTTY = true; process.stdout.isTTY = true; const { runCli } = await import(${JSON.stringify(cli)}); const result = await runCli(["install", "--yes", "--root", ${JSON.stringify(root)}]); console.log(result.stdout, result.stderr ?? "");`;
  const run = (env) => spawnSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: dir, env, encoding: "utf8" });
  const person = run(place.env);
  assert.match(person.stdout, /ROUND_ENDS:/u, person.stderr);
  assert.equal(person.stdout.includes(agentPointer), false);
  assert.equal(run({ ...place.env, CI: "1" }).stdout.split(agentPointer).length, 2);
  for (const args of [["install", "--yes", "--json"], ["install", "--dry-run", "--json"], ["doctor", "--json"]]) {
    const result = place.run([...args, "--root", root]);
    assert.equal(`${result.stdout}${result.stderr}`.includes(agentPointer), false, args.join(" "));
  }
}));

test("a person at a terminal gets no pointer line; the same terminal in CI does", { skip: noPty }, () => withTempDir(async (dir) => {
  const place = throwaway(dir);
  const root = path.join(dir, "root");
  fs.mkdirSync(root);
  const person = inTerminal(place, ["install", "--yes", "--root", root, "--no-auto-update"]);
  assert.equal(person.exit, 0, person.output);
  assert.equal(person.output.includes(agentPointer), false);
  assert.equal(person.output.match(/ROUND_ENDS:/gu).length, 1);
  const ci = inTerminal({ ...place, env: { ...place.env, CI: "1" } }, ["install", "--yes", "--root", root, "--no-auto-update"]);
  assert.equal(ci.output.split(agentPointer).length, 2);
}));

const listCard = { title: "Permissions", note: "Sets how much the agents may do.", choices: [{ label: "Safe", detail: "Do not relax" }, { label: "Balanced", detail: "Routine work runs" }], initial: 0 };
const longCard = { title: "Lead provider", note: "Pick one.", choices: Array.from({ length: 40 }, (_, index) => ({ label: `team/coder-${index}` })), initial: 0 };
const cardMakers = {
  choose: (cards) => cards.choose(listCard), filter: (cards) => cards.choose(longCard), confirm: (cards) => cards.confirm({ title: "LitFamily block", note: "Adds it.", initial: true }),
  proceed: (cards) => cards.proceed({ title: "Model route", note: "Enter goes on.", fields: [{ label: "Lead", value: "x" }], done: "x" }),
  type: (cards) => cards.type({ title: "Lead model", note: "Type it.", example: "my-gateway/coder", attempts: 3, exhausted: "no", read: () => ({ problem: "no" }) })
};

test("the first card carries the hint, the second does not, and no card grows or changes its count", async () => {
  for (const [name, make] of Object.entries(cardMakers)) {
    for (const [cols, rows] of [[100, 40], [80, 24], [40, 12]]) {
      const label = `${name} ${cols}x${rows}`;
      const term = fakeTerminal({ cols, rows, env: utf8 });
      term.cards.expect(2);
      const heights = [];
      for (const turn of [1, 2]) {
        const answer = make(term.cards);
        answer.catch(() => {});
        await pause(4);
        const lines = [...term.lines()];
        while (lines.at(-1) === "") lines.pop();
        const card = lines.slice(lines.findLastIndex((text) => text.startsWith(" ╭─  LIT")));
        assert.match(card[0], new RegExp(`LIT ${turn}/2`, "u"), label);
        heights.push(card.length);
        const hinted = card.filter((text) => text.includes(agentPointer)).length;
        assert.equal(hinted, turn === 1 && cols >= 80 ? 1 : 0, `${label} turn ${turn}\n${card.join("\n")}`);
        if (turn === 1) {
          if (name === "type") { for (const _ of [1, 2, 3]) { term.stdin.write(keys.enter); await pause(4); } } else term.stdin.write(keys.enter);
          await pause(8);
        } else { term.stdin.write(keys.ctrlC); await pause(4); }
      }
      assert.equal(heights[0], heights[1], `${label}: the hint adds no row`);
      assert.ok(heights[0] <= rows - 1, label);
    }
  }
});

test("without a host the install stops before it writes a file", { skip: process.platform === "win32" }, () => withTempDir(async (dir) => {
  const place = throwaway(dir);
  for (const args of [["install", "--yes"], ["install", "--yes", "--round"], ["install", "--yes", "--host", "v1"], ["install", "--yes", "--host", "both"], ["install"]]) {
    const result = place.run(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /Found no OpenCode[\s\S]*nothing was written/iu, args.join(" "));
    assert.deepEqual(filesIn(dir), [], args.join(" "));
  }
  const dry = place.run(["install", "--dry-run", "--round"]);
  assert.equal(dry.status, 0, "a preview needs no host");
  assert.deepEqual(filesIn(dir), []);
  const saved = path.join(place.home, ".config", "opencode", "litopencode.json");
  fs.mkdirSync(path.dirname(saved), { recursive: true });
  const before = JSON.stringify({ categories: { planning: { provider: "openai", model: "gpt-6-astra", effort: "ultra" } } });
  fs.writeFileSync(saved, before);
  assert.equal(place.run(["install", "--yes"]).status, 1);
  assert.deepEqual([filesIn(dir), fs.readFileSync(saved, "utf8")], [[saved], before], "a saved file stays byte for byte");
}));

test("without a host a person at a terminal is asked nothing", { skip: noPty }, () => withTempDir(async (dir) => {
  const place = throwaway(dir);
  const receipt = inTerminal(place, ["install", "--no-auto-update"]);
  assert.equal(receipt.exit, 1, receipt.output);
  assert.match(receipt.output, /Found no OpenCode/u);
  assert.doesNotMatch(receipt.output, /LIT 1\//u);
  assert.deepEqual(filesIn(dir), []);
}));

test("OpenCode 2 alone and OpenCode 1 alone still install on the default root", { skip: process.platform === "win32" }, () => withTempDir(async (dir) => {
  const host = (name, version) => {
    const folder = path.join(dir, `pkg-${name}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: version === 1 ? "opencode-ai" : "@opencode/cli", version: `${version}.20.0` }));
    // The OpenCode 1 stand-in registers the plugin as `opencode plugin <target> --global --force` does.
    fs.writeFileSync(path.join(folder, name), `#!${process.execPath}\nconst fs=require("node:fs"),p=require("node:path");if(process.argv[2]==="plugin"){const d=p.join(process.env.XDG_CONFIG_HOME,"opencode");fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,"opencode.jsonc"),JSON.stringify({plugin:[process.argv[3]]}));}\n`, { mode: 0o755 });
    return folder;
  };
  for (const [command, version] of [["opencode2", 2], ["opencode", 1]]) {
    const place = throwaway(path.join(dir, command));
    const result = place.run(["install", "--yes", "--glyphs", "round"], { PATH: `${host(command, version)}:/usr/bin:/bin` });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, /\nROUND_ENDS: shown\n$/u, command);
  }
}));
