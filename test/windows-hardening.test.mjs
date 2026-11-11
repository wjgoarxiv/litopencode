import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { commandPlan, execCommand, npmPlan, quoteForCmd } from "../src/cli/command-plan.ts";
import { findCommandOnPath } from "../src/cli/host-detect.ts";

// Windows is simulated by injecting the platform, PATH and file checks into each helper. Real Windows
// behaviour (the CVE-2024-27980 refusal itself) is not exercised here.
const PATHEXT = ".COM;.EXE;.BAT;.CMD";
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test("a .cmd shim is started through a shell with every argument quoted, a .exe directly", () => {
  const cmd = commandPlan("opencode", ["plugin", "@litfamily/litopencode@1.0.43", "--global", "--force"], { platform: "win32", find: () => "C:\\Program Files\\nodejs\\opencode.cmd" });
  assert.equal(cmd.shell, true);
  assert.equal(cmd.command, '"C:\\Program Files\\nodejs\\opencode.cmd"');
  assert.deepEqual(cmd.args, ['"plugin"', '"@litfamily/litopencode@1.0.43"', '"--global"', '"--force"']);
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
