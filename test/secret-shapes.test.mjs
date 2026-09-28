import assert from "node:assert/strict";
import { test } from "node:test";
import { containsSecret } from "../src/secret-shapes.ts";

test("the shared detector rejects credential-bearing auth headers for any scheme", () => {
  for (const value of [
    "Authorization: Digest credentials=secret",
    "Proxy-Authorization: Custom credentials=secret"
  ]) {
    assert.equal(containsSecret(value), true, value);
  }
});

test("the shared detector accepts a bare Token phrase but preserves Basic and Bearer rejection", () => {
  assert.equal(containsSecret("Token ordinary-value"), false);
  assert.equal(containsSecret(`Basic ${"B".repeat(24)}`), true);
  assert.equal(containsSecret(`Bearer ${"R".repeat(24)}`), true);
  assert.equal(containsSecret("BearerToken is an ordinary identifier"), false);
});

test("the shared detector sees a bearer credential after a C1 CSI sequence", () => {
  const c1Csi = String.fromCodePoint(0x9b);
  const credential = "C".repeat(24);

  assert.equal(containsSecret(`Bearer${c1Csi}?25l${credential}`), true);
  assert.equal(containsSecret(`Bearer\t${credential}`), true);
  assert.equal(containsSecret(`Bearer\n${credential}`), true);
});
