// B9 LitOpenCode repair wave: format-control credential reconstruction (B9-LOC-1),
// shell-free Windows resolver execution (B9-LOC-2), and the cleanup status tuple (B9-LOC-3).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BROWSER_DRIVE_BLOCKER,
  BROWSER_PROCESS_CLEANUP_FAILED,
  DRIVER_COMMAND,
  probeBrowserDriver,
  runCommandSync
} from "../skills/browser-drive/scripts/capability-probe.mjs";
// B9-LOC-2: shell-free Windows resolver execution.
test("the win32 probe resolves with where.exe and runs the resolved command without a shell", () => {
  for (const resolvedPath of ["C:\\Tools\\agent-browser.exe", "C:\\Program Files\\Agent Browser\\agent-browser.exe"]) {
    const calls = [];
    const report = probeBrowserDriver({
      path: "C:\\Tools",
      platform: "win32",
      runCommand(command, args, options) {
        calls.push({ command, args, options });
        return command === "where.exe"
          ? { status: 0, stdout: `${resolvedPath}\n`, stderr: "" }
          : { status: 0, stdout: `${DRIVER_COMMAND} 0.34.0\n`, stderr: "" };
      }
    });

    assert.equal(calls.length, 2, resolvedPath);
    assert.equal(calls[0].command, "where.exe");
    assert.deepEqual(calls[0].args, [DRIVER_COMMAND]);
    assert.equal(calls[0].options.shell, false, "the resolver must not use a shell");
    assert.equal(calls[1].command, resolvedPath, "the resolved path must be the argv[0], not shell text");
    assert.deepEqual(calls[1].args, ["--version"]);
    assert.equal(calls[1].options.shell, false, "the version run must not use a shell");
    assert.equal(report.status, "available", resolvedPath);
    assert.equal(report.command, resolvedPath);
  }
});

test("the win32 probe rejects indirectly executable and metacharacter command names", () => {
  const hostileResolutions = [
    "C:\\Tools\\agent-browser.cmd",
    "C:\\Tools\\agent-browser.bat",
    "C:\\Tools\\agent-browser",
    "C:\\Tools\\agent&calc.exe",
    "C:\\Tools\\agent|calc.exe",
    "C:\\Tools\\agent^browser.exe",
    "C:\\Tools\\agent%PATH%browser.exe",
    "C:\\Tools\\\"agent-browser\".exe"
  ];

  for (const hostile of hostileResolutions) {
    let versionCalled = false;
    const report = probeBrowserDriver({
      path: "C:\\Tools",
      platform: "win32",
      runCommand(command) {
        if (command === "where.exe") return { status: 0, stdout: `${hostile}\n`, stderr: "" };
        versionCalled = true;
        return { status: 0, stdout: `${DRIVER_COMMAND} 0.34.0\n`, stderr: "" };
      }
    });

    assert.equal(versionCalled, false, `${hostile} must never be executed`);
    assert.equal(report.status, "unavailable", hostile);
    assert.equal(report.blocker, BROWSER_DRIVE_BLOCKER.unavailable, hostile);
    assert.equal(report.command, null, hostile);
    assert.equal(JSON.stringify(report).includes(hostile), false, hostile);
  }
});

test("arguments with spaces and metacharacters pass through argv literally without a shell", (context) => {
  if (process.platform === "win32") {
    context.skip("the literal-argv probe uses a POSIX marker path");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-b9-argv-"));
  const marker = path.join(root, "marker.txt");
  const hostileArgument = `--note=value with spaces & echo injected > ${marker}; touch ${marker}`;
  let result;
  try {
    result = runCommandSync(
      process.execPath,
      ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", hostileArgument],
      { encoding: "utf8", cwd: root, timeout: 10_000 }
    );
    assert.equal(result.status, 0);
    assert.equal(result.error, undefined);
    assert.deepEqual(JSON.parse(result.stdout.trim()), [hostileArgument], "argv must arrive literally");
    assert.equal(fs.existsSync(marker), false, "no shell may interpret the metacharacters");
  } finally {
    if (result?.pid) {
      try {
        process.kill(-result.pid, "SIGKILL");
      } catch {
        // The owned group may already be gone.
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// B9-LOC-3: the cleanup status tuple, pinned in behavior and in the host-facing documentation.
test("a version-phase cleanup failure reports the exact blocked tuple", () => {
  const report = probeBrowserDriver({
    path: "/tmp/agent-browser",
    runCommand(command) {
      return command === (process.platform === "win32" ? "where.exe" : "command")
        ? { status: 0, stdout: "/tmp/agent-browser\n", stderr: "" }
        : {
          status: 0,
          stdout: `${DRIVER_COMMAND} 0.34.0\n`,
          stderr: "",
          error: { code: BROWSER_PROCESS_CLEANUP_FAILED }
        };
    }
  });

  assert.equal(report.status, "unverified-identity");
  assert.equal(report.command, "/tmp/agent-browser");
  assert.equal(report.version, null);
  assert.equal(report.blocker, BROWSER_DRIVE_BLOCKER.cleanup);
  assert.doesNotMatch(JSON.stringify(report), /BROWSER_PROCESS_CLEANUP_FAILED/u);
});

test("the host-facing documentation defines the cleanup status tuple exactly", () => {
  const browserDrive = fs.readFileSync("skills/browser-drive/SKILL.md", "utf8");
  assert.match(browserDrive, /`status` is `unverified-identity`, `version` is `null`, and `blocker` is\s+`BLOCKED_BROWSER_DRIVER_CLEANUP_FAILED`/u);
  assert.match(browserDrive, /`command` is `null` when resolution cleanup failed and the resolved path when\s+version-run cleanup failed/u);
  assert.match(browserDrive, /cleanup failure never reports `available`/u);

});
