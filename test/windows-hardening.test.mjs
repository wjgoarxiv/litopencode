import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { commandPlan, execCommand, npmPlan, quoteForCmd } from "../src/cli/command-plan.ts";
import { findCommandOnPath } from "../src/cli/host-detect.ts";
import { venvPythonMarker } from "../src/cli/office-dependencies.ts";
import * as motion from "../skills/lit-typographic-motion/engine/command.mjs";
import * as pptx from "../skills/lit-pptx/command.mjs";
import { waitForCoverReady } from "../skills/lit-typographic-motion/engine/cover/capture.mjs";

// Windows is simulated by injecting the platform, PATH and file checks into each helper. Real Windows
// behaviour (the CVE-2024-27980 refusal itself) is not exercised here.
const PATHEXT = ".COM;.EXE;.BAT;.CMD";
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const python = (code, ...args) => spawnSync("python3", ["-B", "-c", code, ...args], { encoding: "utf8", timeout: 30_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });

test("a .cmd shim is started through a shell with every argument quoted, a .exe directly", () => {
  const cmd = commandPlan("opencode", ["plugin", "@litfamily/litopencode@1.0.34", "--global", "--force"], { platform: "win32", find: () => "C:\\Program Files\\nodejs\\opencode.cmd" });
  assert.equal(cmd.shell, true);
  assert.equal(cmd.command, '"C:\\Program Files\\nodejs\\opencode.cmd"');
  assert.deepEqual(cmd.args, ['"plugin"', '"@litfamily/litopencode@1.0.34"', '"--global"', '"--force"']);
  const exe = commandPlan("opencode", ["--version"], { platform: "win32", find: () => "C:\\bin\\opencode.exe" });
  assert.deepEqual(exe, { command: "C:\\bin\\opencode.exe", args: ["--version"], shell: false });
  assert.deepEqual(commandPlan("opencode", ["--version"], { platform: "win32", find: () => undefined }), { command: "opencode", args: ["--version"], shell: false });
  assert.deepEqual(commandPlan("npm", ["ci"], { platform: "linux" }), { command: "npm", args: ["ci"], shell: false });
});

test("a shell argument that quotes cannot protect is refused, and a trailing backslash cannot escape the closing quote", () => {
  assert.equal(quoteForCmd("C:\\Users\\me\\"), '"C:\\Users\\me\\\\"');
  for (const bad of ['a"b', "%PATH%", "a\nb"]) assert.throws(() => quoteForCmd(bad), /may not contain/u);
  assert.throws(() => commandPlan("npm", ["ci", "--prefix", "C:\\a%b"], { platform: "win32", find: () => "C:\\n\\npm.cmd" }), /may not contain/u);
});

test("npm on Windows runs through node and npm-cli.js, never through a bare .cmd spawn", () => {
  const exists = (known) => (file) => known.includes(file);
  const viaExecpath = npmPlan(["ci"], { platform: "win32", env: { npm_execpath: "C:\\n\\node_modules\\npm\\bin\\npm-cli.js" }, execPath: "C:\\n\\node.exe", versions: {} });
  assert.deepEqual(viaExecpath, { command: "C:\\n\\node.exe", args: ["C:\\n\\node_modules\\npm\\bin\\npm-cli.js", "ci"], shell: false });
  // The OpenCode plugin host is Bun: execPath is the host binary, so npm is found beside its shim instead.
  const inBun = npmPlan(["ci"], {
    platform: "win32", env: { npm_execpath: "C:\\n\\npm-cli.js" }, execPath: "C:\\opencode\\opencode.exe", versions: { bun: "1.2.0" },
    find: (name) => (name === "npm" ? "C:\\n\\npm.cmd" : undefined),
    exists: exists(["C:\\n\\node_modules\\npm\\bin\\npm-cli.js", "C:\\n\\node.exe"])
  });
  assert.deepEqual(inBun, { command: "C:\\n\\node.exe", args: ["C:\\n\\node_modules\\npm\\bin\\npm-cli.js", "ci"], shell: false });
  const shimOnly = npmPlan(["ci", "--prefix", "C:\\tmp\\x"], { platform: "win32", env: {}, execPath: "C:\\opencode\\opencode.exe", versions: { bun: "1" }, find: () => "C:\\n\\npm.cmd", exists: () => false });
  assert.equal(shimOnly.shell, true);
  assert.equal(shimOnly.command, '"C:\\n\\npm.cmd"');
  assert.deepEqual(shimOnly.args, ['"ci"', '"--prefix"', '"C:\\tmp\\x"']);
  assert.deepEqual(npmPlan(["ci"], { platform: "darwin" }), { command: "npm", args: ["ci"], shell: false });
});

test("a failed child keeps its stderr and exit code in the error", async () => {
  await assert.rejects(execCommand(process.execPath, ["-e", "process.stderr.write('boom from child'); process.exit(3)"]), (error) => {
    assert.equal(error.code, 3);
    assert.match(error.stderr, /boom from child/u);
    return true;
  });
});

test("PATHEXT finds a .cmd or .exe, and the extensionless sh shim npm leaves beside it never matches", () => {
  const dir = tmp("lit-win-path-");
  try {
    fs.writeFileSync(path.join(dir, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
    assert.equal(findCommandOnPath("opencode", { PATH: dir, PATHEXT }, "win32"), undefined);
    fs.writeFileSync(path.join(dir, "opencode.cmd"), "@echo off\r\n");
    assert.equal(findCommandOnPath("opencode", { PATH: dir, PATHEXT }, "win32"), path.join(dir, "opencode.cmd"));
    assert.equal(findCommandOnPath("opencode.cmd", { PATH: dir, PATHEXT }, "win32"), path.join(dir, "opencode.cmd"));
    assert.equal(venvPythonMarker("win32"), "Scripts/python.exe");
    assert.equal(venvPythonMarker("linux"), "bin/python");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const [label, helpers] of [["motion engine", motion], ["lit-pptx", pptx]]) {
  test(`${label}: which matches ffmpeg.exe through PATHEXT on Windows and not a bare name`, () => {
    const dir = tmp("lit-win-which-");
    try {
      fs.writeFileSync(path.join(dir, "ffmpeg"), "sh shim");
      assert.equal(helpers.which("ffmpeg", { PATH: dir, PATHEXT }, "win32"), undefined);
      fs.writeFileSync(path.join(dir, "ffmpeg.exe"), "MZ");
      assert.equal(helpers.which("ffmpeg", { PATH: dir, PATHEXT }, "win32"), path.join(dir, "ffmpeg.exe"));
      assert.equal(helpers.which("ffmpeg", { PATH: `${dir}`, PATHEXT: ".EXE" }, "win32"), path.join(dir, "ffmpeg.exe"));
      assert.equal(helpers.which("ffmpeg", { PATH: dir }, "linux"), path.join(dir, "ffmpeg"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${label}: CRLF output splits into clean lines`, () => {
    assert.deepEqual(helpers.splitLines("C:\\a\\ffmpeg.exe\r\nC:\\b\\ffmpeg.exe\r\n"), ["C:\\a\\ffmpeg.exe", "C:\\b\\ffmpeg.exe", ""]);
    assert.deepEqual(helpers.splitLines("one\ntwo"), ["one", "two"]);
  });

  test(`${label}: npm and .cmd shims get a shell with quoted arguments on Windows only`, () => {
    const shim = helpers.npmPlan(["ci", "--ignore-scripts"], { platform: "win32", env: {}, execPath: "C:\\o\\opencode.exe", find: () => "C:\\n\\npm.cmd", exists: () => false });
    assert.deepEqual(shim, { command: '"C:\\n\\npm.cmd"', args: ['"ci"', '"--ignore-scripts"'], shell: true });
    const cli = helpers.npmPlan(["ci"], { platform: "win32", env: {}, execPath: "C:\\o\\opencode.exe", find: (name) => (name === "npm" ? "C:\\n\\npm.cmd" : undefined), exists: (file) => file.endsWith("npm-cli.js") });
    assert.deepEqual(cli, { command: "node", args: ["C:\\n\\node_modules\\npm\\bin\\npm-cli.js", "ci"], shell: false });
    assert.deepEqual(helpers.npmPlan(["ci"], { platform: "linux" }), { command: "npm", args: ["ci"], shell: false });
    assert.deepEqual(helpers.commandPlan("python", ["-V"], { platform: "win32", find: () => "C:\\py\\python.exe" }), { command: "C:\\py\\python.exe", args: ["-V"], shell: false });
    assert.throws(() => helpers.quoteForCmd("50%"), /may not contain/u);
  });
}

test("the two skills carry the same command helper, so a fix lands in both", () => {
  assert.equal(fs.readFileSync("skills/lit-pptx/command.mjs", "utf8"), fs.readFileSync("skills/lit-typographic-motion/engine/command.mjs", "utf8"));
});

test("the document skill hands back the child's exit code, and finds a venv interpreter per platform", () => {
  const dir = tmp("lit-win-run-");
  try {
    const script = path.join(dir, "exit3.py");
    fs.writeFileSync(script, "import sys\nsys.exit(3)\n");
    const result = python(
      "import importlib.util, pathlib, sys\n" +
      "spec = importlib.util.spec_from_file_location('run', sys.argv[1]); run = importlib.util.module_from_spec(spec); spec.loader.exec_module(run)\n" +
      "print(run.run_script(sys.executable, sys.argv[2], []))\n" +
      "print(run.venv_python(pathlib.PurePosixPath('/v'), 'win32'))\n" +
      "print(run.venv_python(pathlib.PurePosixPath('/v'), 'darwin'))\n",
      path.resolve("skills/lit-docx/run.py"), script
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), ["3", "/v/Scripts/python.exe", "/v/bin/python"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const pdfProbe = `
import sys, types
sys.dont_write_bytecode = True
stub = types.ModuleType("convert_md_to_docx")
for name in ("detect_locale", "fix_dashes", "fix_ellipsis", "fix_quotes", "fix_unit_spacing", "load_publisher", "normalize_double_spaces", "parse_frontmatter"):
    setattr(stub, name, lambda *a, **k: None)
sys.modules["convert_md_to_docx"] = stub
sys.path.insert(0, sys.argv[1])
import convert_md_to_pdf as pdf
from types import SimpleNamespace
publisher = {"latex": {"documentclass": "oblivoir", "cjk": {"main_font": "Pretendard"}}, "docx": {"font": {"body": {"family": "Times New Roman"}}}}
def fake(missing):
    def run(command, workdir=None):
        text = (workdir / command[-1]).read_text()
        gone = any("{%s}" % name in text for name in missing)
        return SimpleNamespace(returncode=1 if gone else 0, stdout='! Package fontspec Error: The font "x" cannot be found.' if gone else "", stderr="")
    return run
print(pdf.pdf_fonts("korean-generic", publisher, "ko"))
print(pdf.pdf_fonts("elsevier", publisher, "en"))
pdf.preflight_pdf_fonts("korean-generic", publisher, "ko", fake([]))
try:
    pdf.preflight_pdf_fonts("korean-generic", publisher, "ko", fake(["Pretendard"]))
except SystemExit as stop:
    print(stop)
try:
    pdf.preflight_pdf_fonts("elsevier", publisher, "en", fake(["Times New Roman"]))
except SystemExit as stop:
    print(stop)
pdf.preflight_pdf_fonts("elsevier", publisher, "en", fake(["Pretendard"]))
`;

test("a PDF profile whose font is missing is BLOCKED before XeLaTeX runs, naming the font and how to install it", () => {
  const result = python(pdfProbe, path.resolve("skills/lit-docx/scripts"));
  assert.equal(result.status, 0, result.stderr);
  const [ko, en, blockedKo, blockedEn] = result.stdout.trim().split("\n");
  assert.equal(ko, "[('Times New Roman', 'body text'), ('Pretendard', 'Korean text')]");
  assert.equal(en, "[('Times New Roman', 'body text')]");
  assert.match(blockedKo, /^BLOCKED: font 'Pretendard' \(Korean text of publisher 'korean-generic'\) is not installed/u);
  assert.match(blockedKo, /github\.com\/orioncactus\/pretendard/u);
  assert.match(blockedEn, /^BLOCKED: font 'Times New Roman' \(body text of publisher 'elsevier'\) is not installed.*ttf-mscorefonts-installer/u);
});

test("every PDF template loads longtable and defines \\tightlist, which pandoc's table and list output needs", () => {
  for (const profile of ["acs", "elsevier", "ieee", "korean-generic", "nature"]) {
    const template = fs.readFileSync(`skills/lit-docx/templates/latex/${profile}/template.tex`, "utf8");
    assert.match(template, /\\usepackage\{longtable,array\}/u, profile);
    assert.match(template, /\\providecommand\{\\tightlist\}/u, profile);
  }
});

test("the cover render stops at the page's first error instead of waiting out the 60 s ready wait", async () => {
  const never = { waitForFunction: () => new Promise(() => {}) };
  const failed = new Promise((resolve) => setTimeout(() => resolve("Error: ART.lights has no entry for the hero bay 4"), 20));
  const started = Date.now();
  await assert.rejects(waitForCoverReady(never, failed), /raised an error before it set window\.ready: Error: ART\.lights has no entry for the hero bay 4/u);
  assert.ok(Date.now() - started < 5_000, "the error must end the wait at once");
});

test("a page that never becomes ready and never errors still ends with the ready timeout, and a ready page passes", async () => {
  const timesOut = { waitForFunction: () => Promise.reject(new Error("Timeout 60000ms exceeded")) };
  await assert.rejects(waitForCoverReady(timesOut, new Promise(() => {}), 60000), /never set window\.ready = true within 60 s/u);
  const ready = { waitForFunction: () => Promise.resolve() };
  assert.equal(await waitForCoverReady(ready, new Promise(() => {})), undefined);
});
