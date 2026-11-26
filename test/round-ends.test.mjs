import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { roundEndsLine } from "../src/cli/round-ends.ts";
import { fontFolders, iconFontInstalled, roundCaps, savedGlyphChoice } from "../src/round-glyphs.ts";
import { spawnSync } from "node:child_process";
import { agentCommands } from "../src/cli/agent-guide.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

const never = () => assert.fail("the fonts are not looked at");
const line = (facts = {}) => roundEndsLine({ surface: true, env: {}, platform: "darwin", saved: "auto", iconFont: () => false, ...facts });
const noPty = process.platform === "win32" || spawnSync("python3", ["-c", "import pty, termios"]).status !== 0 ? "requires POSIX PTY and python3" : false;
// A throwaway HOME hides the user's own fonts; the machine's folders stay in sight.
const noRoom = process.platform === "win32" ? "Windows gets no font" : iconFontInstalled(fontFolders({}, process.platform)) ? "an icon font is installed for the whole machine" : false;
const colour = { COLORTERM: "truecolor", TERM: "xterm-256color" };

test("environment setting, then saved choice, then auto", () => {
  for (const value of ["square", "basic", "SQUARE"]) assert.equal(roundCaps({ LITOPENCODE_GLYPHS: value, WT_SESSION: "x" }, never, "round"), false, value);
  for (const value of ["round", "nerd"]) assert.equal(roundCaps({ LITOPENCODE_GLYPHS: value }, never, "square"), true, value);
  assert.equal(roundCaps({ LITOPENCODE_GLYPHS: "auto", SSH_CONNECTION: "a" }, never, "round"), false, "auto in the environment beats a saved round");
  assert.equal(roundCaps({ SSH_CONNECTION: "a b c d" }, never, "round"), true, "a saved round holds over SSH");
  assert.equal(roundCaps({ WT_SESSION: "x" }, never, "square"), false);
  assert.equal(roundCaps({ SSH_CONNECTION: "a" }, never, "auto"), false);
  assert.equal(roundCaps({ LITOPENCODE_GLYPHS: "unknown" }, never, "round"), true);
});

test("the saved choice is read from litopencode.json; anything else there is auto", () => withTempDir(async (dir) => {
  const file = path.join(dir, "litopencode.json");
  assert.equal(savedGlyphChoice(dir), "auto");
  for (const [text, want] of [['{ "glyphs": "round" }', "round"], ['{ "glyphs": "square" } // mine', "square"], ['{ "glyphs": "nerd" }', "auto"], ["{", "auto"], ["[]", "auto"]]) {
    fs.writeFileSync(file, text);
    assert.equal(savedGlyphChoice(dir), want, text);
  }
}));

test("ROUND_ENDS says shown only for a confirmed choice, ready only for a terminal that draws the ends", () => {
  assert.equal(line({ saved: "round" }), "ROUND_ENDS: shown");
  assert.equal(line({ saved: "round", env: { SSH_CONNECTION: "a" } }), "ROUND_ENDS: shown");
  for (const env of [{ TERM_PROGRAM: "vscode" }, { TERM_PROGRAM: "ghostty" }, { WT_SESSION: "x" }, { KITTY_WINDOW_ID: "1" }]) {
    assert.equal(line({ env }), "ROUND_ENDS: ready in a dark full-colour terminal", JSON.stringify(env));
    assert.equal(line({ env: { ...env, ...colour }, stream: { isTTY: true } }), "ROUND_ENDS: ready", JSON.stringify(env));
  }
  assert.equal(line({ iconFont: () => true }), "ROUND_ENDS: check (icon font is here; show your user step 8 of install --agent)");
  assert.match(line({ env: { LITOPENCODE_GLYPHS: "round" } }), /^ROUND_ENDS: check \(LITOPENCODE_GLYPHS is round; show /u, "an environment setting is no confirmation");
});

// The install line of the guide up to its flags: it works on a machine without a global litopencode.
const npmExec = agentCommands.install.replace(" --yes --round", "");

test("ROUND_ENDS: square gives the reason and one fix", () => {
  assert.equal(line({ surface: false, saved: "round" }), `ROUND_ENDS: square (no surface enabled; run ${npmExec})`);
  assert.equal(line(), "ROUND_ENDS: square (no icon font; rerun install with --round)");
  assert.equal(line({ failure: "download failed" }), "ROUND_ENDS: square (font not installed (download failed); retry --round)");
  assert.match(line({ env: { SSH_CONNECTION: "a" }, iconFont: never }), /^ROUND_ENDS: square \(SSH; /u);
  assert.match(line({ platform: "win32" }), /^ROUND_ENDS: square \(Windows console; /u);
  assert.equal(line({ saved: "square" }), "ROUND_ENDS: square (choice is square; run install --glyphs auto)");
  assert.equal(line({ saved: "round", env: { LITOPENCODE_GLYPHS: "basic" } }), "ROUND_ENDS: square (choice is square; unset LITOPENCODE_GLYPHS)");
});

test("the colours of the terminal count only when stdout is one", () => {
  const cases = [[{ ...colour, NO_COLOR: "1" }, /NO_COLOR/u], [{ TERM: "dumb" }, /TERM=dumb/u], [{ ...colour, COLORFGBG: "0;15" }, /light ground/u], [{ TERM: "xterm-256color" }, /fewer colours/u]];
  for (const [env, reason] of cases) {
    for (const saved of ["auto", "round"]) {
      const shown = line({ env: { ...env, TERM_PROGRAM: "vscode" }, saved, stream: { isTTY: true } });
      assert.match(shown, /^ROUND_ENDS: square \([^;]+; [^)]+\)$/u);
      assert.match(shown, reason);
    }
    assert.match(line({ env: { ...env, TERM_PROGRAM: "vscode" } }), /^ROUND_ENDS: ready in/u);
  }
});

test("every ROUND_ENDS line fits 80 columns beside a full command and claims nothing about how macOS finds fonts", () => {
  const all = [line(), line({ saved: "round" }), line({ saved: "square" }), line({ surface: false }), line({ iconFont: () => true }), line({ env: { SSH_CONNECTION: "a" } }), line({ platform: "win32" }), line({ env: { LITOPENCODE_GLYPHS: "round" } }), line({ env: { LITOPENCODE_GLYPHS: "basic" } }),
    line({ failure: "that name is taken" }), line({ env: { WT_SESSION: "x" } }), ...[{ NO_COLOR: "1" }, { TERM: "dumb" }, { ...colour, COLORFGBG: "0;7" }, {}].map((env) => line({ env, stream: { isTTY: true } }))];
  for (const text of all) {
    assert.ok(text.replace(npmExec, "").length <= 80, `${text.length}: ${text}`);
    assert.doesNotMatch(text, /macos/iu);
    if (text.includes("litopencode install")) assert.ok(text.includes(npmExec), text);
  }
});

// The real installer on a custom root, in a throwaway HOME without a terminal.
function installer(dir) {
  const home = path.join(dir, "home");
  const root = path.join(dir, "config");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, "xdg"), XDG_DATA_HOME: path.join(home, "data"), LANG: "en_US.UTF-8", TERM: "xterm-256color", NO_UPDATE_NOTIFIER: "1" };
  const run = (args, extra = {}) => runCli([...args, "--root", root], { cwd: home, env: { ...env, ...extra } });
  const saved = () => JSON.parse(fs.readFileSync(path.join(root, "litopencode.json"), "utf8")).glyphs;
  const roundEnds = (result) => result.stdout.split("\n").filter((text) => text.includes("ROUND_ENDS:"));
  return { home, root, run, saved, roundEnds };
}

test("--glyphs is saved, a plain install keeps it, and --glyphs auto undoes it", () => withTempDir(async (dir) => {
  const { run, saved, roundEnds } = installer(dir);
  const first = run(["install", "--yes", "--glyphs", "round"]);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual([saved(), roundEnds(first)], ["round", ["ROUND_ENDS: shown"]]);
  assert.equal(first.stdout.trimEnd().split("\n").at(-1), "ROUND_ENDS: shown", "the line closes the output");
  const again = run(["install", "--yes"]);
  assert.deepEqual([again.status, saved(), roundEnds(again)], [0, "round", ["ROUND_ENDS: shown"]]);
  const background = run(["install", "--no-model-prompt", "--no-permission-prompt", "--no-auto-update"]);
  assert.deepEqual([background.status, saved()], [0, "round"], "the background update keeps the choice");
  const doctor = JSON.parse(run(["doctor"]).stdout);
  assert.deepEqual([doctor.roundEnds.choice, doctor.roundEnds.line], ["round", "ROUND_ENDS: shown"]);
  run(["install", "--yes", "--glyphs", "square"]);
  assert.equal(saved(), "square");
  assert.equal(run(["install", "--yes", "--glyphs", "auto"]).status, 0);
  assert.equal(saved(), "auto");
}));

const choices = [["auto", false], ["round", true], ["square", false]];
const chosen = (dir, choice) => {
  const root = path.join(dir, "xdg", "opencode");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "litopencode.json"), JSON.stringify({ glyphs: choice }));
  return root;
};
const overSsh = (dir, config) => ({ PATH: process.env.PATH, HOME: dir, USERPROFILE: dir, XDG_CONFIG_HOME: path.join(dir, config), SSH_CONNECTION: "a b c d", LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor", NO_UPDATE_NOTIFIER: "1" });

test("the plugin's surfaces follow the saved choice", () => withTempDir(async (dir) => {
  const module = new URL("../src/round-glyphs.ts", import.meta.url).href;
  for (const [choice, round] of choices) {
    chosen(dir, choice);
    const surface = spawnSync(process.execPath, ["--input-type=module", "--eval", `import { roundGlyphs } from ${JSON.stringify(module)}; process.stdout.write(String(roundGlyphs()));`], { env: overSsh(dir, "xdg"), encoding: "utf8" });
    assert.equal(surface.stdout, String(round), choice);
  }
}));

test("the installer's cards follow the saved choice", { skip: noPty }, () => withTempDir(async (dir) => {
  for (const [choice, round] of choices) {
    const root = chosen(dir, choice);
    // The default root needs a host before it draws a card, so the cards read a custom one.
    const run = spawnSync("python3", [path.resolve("test-support/installed-tty.py")], { input: JSON.stringify({ argv: [process.execPath, path.resolve("bin/litopencode.cjs"), "install", "--root", root, "--no-model-prompt", "--no-auto-update"], cwd: dir, env: overSsh(dir, "other"), steps: [["Permissions[\\s\\S]*?Ctrl\\+C stop", "\u0003"]], cols: 100, rows: 40 }), encoding: "utf8", maxBuffer: 1 << 24 });
    assert.equal(/[\ue0b4\ue0b6]/u.test(JSON.parse(run.stdout).output), round, choice);
  }
}));

const userFonts = (home) => process.platform === "darwin" ? path.join(home, "Library", "Fonts") : path.join(home, "data", "fonts");
const badArchive = (dir) => {
  const archive = path.join(dir, "bad.zip");
  fs.writeFileSync(archive, "not the pinned archive");
  return archive;
};

test("a bad archive still installs and says why no font came", { skip: noRoom }, () => withTempDir(async (dir) => {
  const { home, run, roundEnds } = installer(dir);
  const fonts = userFonts(home);
  const archive = badArchive(dir);
  const dry = run(["install", "--round", "--dry-run"], { LITOPENCODE_ICON_FONT_ARCHIVE: archive });
  const plan = JSON.parse(dry.stdout).roundEnds;
  assert.deepEqual([plan.choice, plan.iconFont.folder, plan.iconFont.files[0]], ["auto", fonts, "SymbolsNerdFontMono-Regular.ttf"]);
  const failed = run(["install", "--yes", "--round"], { LITOPENCODE_ICON_FONT_ARCHIVE: archive });
  assert.equal(failed.status, 0, failed.stderr);
  assert.match(failed.stdout, /ICON_FONT: not installed \(checksum differs\)/u);
  assert.deepEqual(roundEnds(failed), ["ROUND_ENDS: square (font not installed (checksum differs); retry --round)"]);
  assert.equal(fs.existsSync(fonts), false);
}));

test("a plain install adds no font; --round with one here adds nothing", () => withTempDir(async (dir) => {
  const { home, run, roundEnds } = installer(dir);
  const fonts = userFonts(home);
  const archive = badArchive(dir);
  assert.equal(run(["install", "--yes"]).status, 0);
  assert.equal(fs.existsSync(fonts), false);
  if (process.platform === "win32") assert.equal(JSON.parse(run(["install", "--round", "--dry-run"]).stdout).roundEnds.iconFont.state, "unsupported");
  fs.mkdirSync(fonts, { recursive: true });
  fs.writeFileSync(path.join(fonts, "HackNerdFont-Regular.ttf"), "mine");
  const here = run(["install", "--yes", "--round"], { LITOPENCODE_ICON_FONT_ARCHIVE: archive });
  assert.equal(here.status, 0, here.stderr);
  if (process.platform !== "win32") assert.match(here.stdout, /ICON_FONT: an icon font is already here/u);
  if (process.platform === "darwin" || process.platform === "linux") assert.match(roundEnds(here)[0], /^ROUND_ENDS: check /u);
  assert.deepEqual(fs.readdirSync(fonts), ["HackNerdFont-Regular.ttf"]);
  for (const text of here.stdout.split("\n")) assert.ok(Array.from(text).length <= 80, text);
}));

test("doctor without an install says no surface is on", () => withTempDir(async (dir) => {
  const { run } = installer(dir);
  assert.match(JSON.parse(run(["doctor"]).stdout).roundEnds.line, /no surface enabled/u);
}));

test("the new flags belong to install and take only the three choices", () => {
  for (const args of [["doctor", "--round"], ["doctor", "--glyphs", "round"], ["install", "--glyphs"], ["install", "--glyphs", "nerd"], ["icon-font"], ["icon-font", "add"]]) assert.equal(runCli(args).status, 2, args.join(" "));
});
