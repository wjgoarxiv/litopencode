import assert from "node:assert/strict";
import { test } from "node:test";
import { probeBrowserDriver } from "../skills/browser-drive/scripts/capability-probe.mjs";

const RESOLVER_COMMAND = process.platform === "win32" ? "where.exe" : "command";

test("browser-drive requires an anchored exact agent-browser identity", () => {
  for (const banner of [
    "not-agent-browser-helper 9.9.9",
    "agent-browser-helper 9.9.9",
    "other agent-browser 9.9.9"
  ]) {
    const report = probeBrowserDriver({
      path: "/tmp/agent-browser",
      runCommand(command) {
        return command === RESOLVER_COMMAND
          ? { status: 0, stdout: "/tmp/agent-browser\n" }
          : { status: 0, stdout: `${banner}\n` };
      }
    });
    assert.equal(report.status, "unverified-identity", banner);
    assert.equal(report.blocker, "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED", banner);
  }
});

test("browser-drive rejects the wrapper spoof without exposing the reported banner", () => {
  const banner = "agent-browser wrapper 1.0";
  const report = probeBrowserDriver({
    path: "/tmp/agent-browser",
    runCommand(command) {
      return command === RESOLVER_COMMAND
        ? { status: 0, stdout: "/tmp/agent-browser\n" }
        : { status: 0, stdout: `${banner}\n` };
    }
  });
  assert.equal(report.status, "unverified-identity");
  assert.equal(report.version, null);
  assert.equal(JSON.stringify(report).includes(banner), false);
  assert.equal(report.blocker, "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED");
});
