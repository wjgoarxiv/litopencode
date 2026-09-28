import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPublicSource } from "../src/index.ts";
import { runCli } from "../test-support/cli-fixture.ts";

test("public fetch records the default private-network denial policy", async () => {
  // Given/When: a loopback URL is evaluated without the explicit override.
  const result = await fetchPublicSource("http://127.0.0.1:1/private");

  // Then: fail-closed behavior and its policy source are machine-readable.
  assert.equal(result.verdict, "blocked");
  assert.deepEqual(result.policy, {
    privateNetworkAllowed: false,
    source: "default-deny"
  });
});

test("public fetch records an explicit private-network option without broadening it", async () => {
  // Given/When: the reviewed option permits loopback evaluation but no server exists.
  const result = await fetchPublicSource("http://127.0.0.1:1/private", {
    allowPrivateNetwork: true,
    timeoutMs: 200
  });

  // Then: the guard relaxation is visible even though the request itself fails.
  assert.equal(result.verdict, "upstream_error");
  assert.deepEqual(result.policy, {
    privateNetworkAllowed: true,
    source: "explicit-option"
  });
});

test("fetch-public JSON reports both default and explicit private-network policies", () => {
  // Given/When: the actual CLI evaluates the same loopback target with and without its opt-in flag.
  const denied = runCli(["fetch-public", "http://127.0.0.1:1/private", "--json", "--timeout", "200"]);
  const allowed = runCli([
    "fetch-public",
    "http://127.0.0.1:1/private",
    "--json",
    "--allow-private-network",
    "--timeout",
    "200"
  ]);

  // Then: JSON consumers can distinguish default denial from an explicit test/dev override.
  assert.equal(denied.status, 1, denied.stderr);
  assert.equal(allowed.status, 1, allowed.stderr);
  assert.deepEqual(JSON.parse(denied.stdout).policy, {
    privateNetworkAllowed: false,
    source: "default-deny"
  });
  assert.deepEqual(JSON.parse(allowed.stdout).policy, {
    privateNetworkAllowed: true,
    source: "explicit-option"
  });
});
