import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "../test-support/cli-fixture.ts";

async function withHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-update-cli-"));
  try {
    await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

function isolatedEnv(home, extra = {}) {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "xdg"),
    ...extra
  };
}

async function assertNoUpdateCache(home) {
  await assert.rejects(fs.access(path.join(home, ".litopencode", "update-check.json")), { code: "ENOENT" });
}

test("doctor --json stays valid JSON and never creates update state", async () => {
  await withHome(async (home) => {
    const result = runCli(["doctor", "--json", "--root", path.join(home, "root")], { env: isolatedEnv(home) });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).package.name, "@litfamily/litopencode");
    assert.equal(result.stderr, "");
    await assertNoUpdateCache(home);
  });
});

test("piped doctor, dry-run install, help, and errors remain update-check silent", async () => {
  await withHome(async (home) => {
    const env = isolatedEnv(home);
    const commands = [
      ["doctor", "--root", path.join(home, "doctor-root")],
      ["install", "--dry-run", "--root", path.join(home, "install-root")],
      ["fetch-public", "http://127.0.0.1/", "--json"],
      ["--help"],
      ["unknown-command"]
    ];
    for (const args of commands) {
      const result = runCli(args, { env });
      assert.doesNotMatch(result.stderr, /update available|npm exec --yes --package @litfamily\/litopencode@/i, args.join(" "));
    }
    await assertNoUpdateCache(home);
  });
});

test("plugin, server, and CLI module imports have no update side effects", async () => {
  await withHome(async (home) => {
    const script = [
      "await import('./dist/index.js');",
      "await import('./dist/server.js');",
      "await import('./dist/cli.js');",
      "await new Promise((resolve) => setTimeout(resolve, 100));"
    ].join(" ");
    const { spawnSync } = await import("node:child_process");
    const imported = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: isolatedEnv(home)
    });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "");
    assert.equal(imported.stderr, "");
    await assertNoUpdateCache(home);
  });
});
