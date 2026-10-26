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

test("a JSON credential with a quoted key is a credential", async () => {
  const { redact } = await import("../skills/lit-adhd/scripts/rewind.mjs");
  for (const value of ['{"password": "hunter2hunter"}', '{"api_key":"abcd1234efgh5678"}', "{'client_secret': 'zz99yy88xx77'}", '"auth_token" : "q1w2e3r4t5y6"']) {
    assert.equal(containsSecret(value), true, value);
    assert.doesNotMatch(redact(value, { envValues: [], home: "/nohome" }), /hunter2hunter|abcd1234efgh5678|zz99yy88xx77|q1w2e3r4t5y6/u, value);
  }
  for (const prose of ['the "password" field is required', 'set "token" in the config']) assert.equal(containsSecret(prose), false, prose);
});

test("the brief redacts a secret environment value in its URL-encoded and base64 forms too", async () => {
  const { redact } = await import("../skills/lit-adhd/scripts/rewind.mjs");
  const secret = "p@ss word/42+xyz";
  for (const form of [secret, encodeURIComponent(secret), Buffer.from(secret).toString("base64")]) {
    assert.doesNotMatch(redact(`see https://x.example/?q=${form} now`, { envValues: [secret], home: "/nohome" }), new RegExp(form.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&"), "u"), form);
  }
});
