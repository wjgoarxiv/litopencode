import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repo = path.resolve(import.meta.dirname, "..");
const python = spawnSync("python3", ["-c", "import pty, termios"], { encoding: "utf8" });
const blockGlyphs = /[█▓▀▄▌▐▖▗▘▝▙▛▜▟▚▞]/u;
const cases = [
  { name: "fresh --yes with empty CI", env: { CI: "" }, args: ["--yes"], ansi: false, fresh: true, style: "off" },
  { name: "--yes with empty CI", env: { CI: "" }, args: ["--yes"], ansi: false },
  { name: "--yes with empty NO_COLOR", env: { NO_COLOR: "" }, args: ["--yes"], ansi: false },
  { name: "automatic CI without --yes", env: { CI: "" }, args: [], ansi: false },
  { name: "non-TTY install preserves style without prompting", env: {}, args: [], ansi: false, tty: false },
  { name: "--yes with dumb terminal", env: { TERM: "dumb" }, args: ["--yes"], ansi: false, plain: true },
  { name: "--yes with non-UTF-8 locale", env: { LC_ALL: "C" }, args: ["--yes"], ansi: false, plain: true },
  { name: "--yes retains truecolor", env: {}, args: ["--yes"], ansi: true, color: /\u001b\[38;2;255;99;55m/u },
  { name: "interactive 256-color explicit style", env: { COLORTERM: "" }, args: ["--no-model-prompt", "--no-permission-prompt"], answers: ["3"], style: "eli5", ansi: true, color: /\u001b\[38;5;203m/u },
  { name: "interactive NO_COLOR explicit style", env: { NO_COLOR: "" }, args: ["--no-model-prompt", "--no-permission-prompt"], answers: ["4"], style: "eli5-ko", ansi: false },
  { name: "explicit CI permission prompt remains plain", env: { CI: "" }, args: ["--permission-prompt"], answers: ["0"], ansi: false }
];

test("packed CLI installs obey terminal and prompt policy on a real TTY", {
  skip: process.platform === "win32" || python.status !== 0 ? "requires POSIX PTY and python3" : false,
  timeout: 180_000
}, async (t) => {
  const scratchParent = path.join(repo, ".litcodex", "test-tmp");
  await fs.mkdir(scratchParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratchParent, "installer-tty-"));
  const receipts = [];
  try {
    const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
      cwd: repo, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, npm_config_cache: path.join(root, "npm-cache") }
    });
    assert.equal(packed.status, 0, packed.stderr);
    const tarball = path.join(root, JSON.parse(packed.stdout)[0].filename);
    const extracted = spawnSync("tar", ["-xzf", tarball, "-C", root], { encoding: "utf8" });
    assert.equal(extracted.status, 0, extracted.stderr);
    const bin = path.join(root, "package", "bin", "litopencode.cjs");
    for (const [index, scenario] of cases.entries()) {
      await t.test(scenario.name, async () => {
        const profile = path.join(root, `profile-${index}`);
        const config = path.join(profile, "config");
        await fs.mkdir(config, { recursive: true });
        // A previously selected style must survive unattended install/update.
        if (!scenario.fresh) await fs.writeFile(path.join(config, "litopencode.json"), JSON.stringify({ outputStyle: "asd-ste100-ko" }));
        const env = { ...process.env, HOME: profile, XDG_CONFIG_HOME: path.join(profile, "xdg"),
          LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor",
          // A successful TTY install otherwise launches a detached update check that writes into
          // HOME after the child exits, racing the scratch-root cleanup below.
          NO_UPDATE_NOTIFIER: "1" };
        for (const key of ["CI", "NO_COLOR", "FORCE_COLOR", "LC_CTYPE"]) delete env[key];
        Object.assign(env, scenario.env);
        const argv = [process.execPath, bin, "install", "--root", config, "--no-auto-update", ...scenario.args];
        const run = scenario.tty === false
          ? spawnSync(argv[0], argv.slice(1), { cwd: profile, env, input: "", encoding: "utf8", timeout: 30_000 })
          : spawnSync("python3", [path.join(repo, "test-support", "installed-tty.py")], {
            input: JSON.stringify({ argv, cwd: profile, env, answers: scenario.answers }),
            encoding: "utf8", timeout: 35_000, maxBuffer: 4 * 1024 * 1024
          });
        assert.equal(run.status, 0, run.stderr);
        const receipt = scenario.tty === false
          ? { exit: run.status, output: run.stdout + run.stderr, answers: [], timedOut: false, childReaped: true, ptyClosed: true }
          : JSON.parse(run.stdout);
        receipts.push({ name: scenario.name, ...receipt });
        assert.equal(receipt.exit, 0, receipt.output);
        assert.equal(receipt.timedOut, false);
        assert.equal(receipt.childReaped, true);
        assert.equal(receipt.ptyClosed, true);
        assert.deepEqual(receipt.answers, scenario.answers ?? [], "unexpected prompt was answered only to let the install finish");
        const installed = JSON.parse(await fs.readFile(path.join(config, "litopencode.json"), "utf8"));
        const skill = await fs.readFile(path.join(config, "skills", "lit-code", "SKILL.md"), "utf8");
        Object.assign(receipts.at(-1), { style: installed.outputStyle, installedSkill: skill.includes("lit-code") });
        assert.equal(installed.outputStyle ?? "off", scenario.style ?? "asd-ste100-ko");
        assert.match(skill, /lit-code/u);
        if (!scenario.answers) assert.doesNotMatch(receipt.output, /Choose an output style|Select \d+-\d+/u);
        assert.equal(receipt.output.includes("\u001b"), scenario.ansi, receipt.output);
        if (scenario.color) assert.match(receipt.output, scenario.color);
        if (scenario.plain) {
          assert.match(receipt.output, /(?:^|\n)LIT\r?\n/u);
          assert.doesNotMatch(receipt.output, blockGlyphs);
        } else {
          assert.match(receipt.output, blockGlyphs);
        }
      });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    if (process.env.LITOPENCODE_TTY_EVIDENCE_DIR) {
      const evidence = path.resolve(process.env.LITOPENCODE_TTY_EVIDENCE_DIR);
      assert.ok(evidence.startsWith(path.join(repo, ".litcodex") + path.sep));
      await fs.mkdir(evidence, { recursive: true });
      await fs.writeFile(path.join(evidence, "receipt.json"), JSON.stringify({ receipts, cleaned: true }, null, 2) + "\n");
    }
  }
});
