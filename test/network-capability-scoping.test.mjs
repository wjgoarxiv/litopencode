import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const forcedDeniedEnvironment = {
  ...process.env,
  LITOPENCODE_TEST_FORCE_LOCAL_LISTEN_DENIED: "1"
};
delete forcedDeniedEnvironment.NODE_TEST_CONTEXT;

test("forced loopback-listen denial is observable by fixture tests", () => {
  const probe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'import { localListenSupported } from "./test-support/network-capability.ts";',
        'if (localListenSupported) throw new Error("forced listen denial was ignored");'
      ].join("\n")
    ],
    {
      cwd: process.cwd(),
      env: forcedDeniedEnvironment,
      encoding: "utf8"
    }
  );

  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});

test("no-network security and connection-failure tests still run when loopback listen is denied", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-name-pattern",
      [
        "blocks private, malformed, and unsupported targets without opening a listener",
        "returns structured upstream_error for connection failures",
        "all public-fetch URL surfaces redact every query value",
        "malformed public-fetch URL output does not repeat embedded credential-like text",
        "fetch-public CLI fails closed with JSON for blocked private targets",
        "fetch-public CLI returns JSON for network failures"
      ].join("|"),
      "test/lit-fetch.test.mjs",
      "test/lit-fetch-edge.test.mjs",
      "test/cli-fetch-public.test.mjs"
    ],
    {
      cwd: process.cwd(),
      env: forcedDeniedEnvironment,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /# tests 6\b/);
  assert.match(result.stdout, /# pass 6\b/);
  assert.match(result.stdout, /# skipped 0\b/);
});
