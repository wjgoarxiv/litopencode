import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import { parseBoundedJson, readBoundedJsonFile } from "../skills/frontend-ui-ux/scripts/bounded-json.mjs";
import { parseStrictJson } from "../skills/frontend-ui-ux/scripts/strict-json.mjs";
import { readBoundedJsonStream } from "../skills/frontend-ui-ux/scripts/stdin-json.mjs";

async function codeOf(fn) {
  try {
    await fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

// Every trust failure lands on exit 2, so the code is the only thing that lets a
// caller tell a bad payload from a bad file from a bad argument.
test("malformed payloads report JSON_INVALID", async () => {
  assert.equal(await codeOf(() => parseStrictJson('{"a":1,"a":2}')), "JSON_INVALID");
  assert.equal(await codeOf(() => parseStrictJson("{oops}")), "JSON_INVALID");
  assert.equal(await codeOf(() => parseStrictJson("{}\0")), "JSON_INVALID");
  assert.equal(await codeOf(() => parseBoundedJson(Buffer.from([0xff, 0xfe, 0xfd]))), "JSON_INVALID");
  assert.equal(
    await codeOf(() => parseBoundedJson(Buffer.from('{"a":1}'), { maxBytes: 2 })),
    "JSON_INVALID"
  );
  assert.equal(
    await codeOf(() => readBoundedJsonStream(Readable.from([Buffer.alloc(64)]), { maxBytes: 8 })),
    "JSON_INVALID"
  );
});

test("bad arguments report ARGUMENT_INVALID", async () => {
  assert.equal(await codeOf(() => parseStrictJson(42)), "ARGUMENT_INVALID");
  assert.equal(await codeOf(() => parseBoundedJson("not a buffer")), "ARGUMENT_INVALID");
  assert.equal(await codeOf(() => parseBoundedJson(Buffer.from("{}"), { maxBytes: 0 })), "ARGUMENT_INVALID");
  assert.equal(await codeOf(() => readBoundedJsonFile("", { authorizedRoot: "/tmp" })), "ARGUMENT_INVALID");
  assert.equal(await codeOf(() => readBoundedJsonFile("/tmp/x.json", {})), "ARGUMENT_INVALID");
});

test("unusable files report FILE_INVALID", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-trust-"));
  try {
    const outside = path.join(os.tmpdir(), "outside.json");
    fs.writeFileSync(outside, "{}", "utf8");
    assert.equal(await codeOf(() => readBoundedJsonFile(outside, { authorizedRoot: root })), "FILE_INVALID");

    const link = path.join(root, "link.json");
    fs.symlinkSync(outside, link);
    assert.equal(await codeOf(() => readBoundedJsonFile(link, { authorizedRoot: root })), "FILE_INVALID");

    const big = path.join(root, "big.json");
    fs.writeFileSync(big, `{"pad":"${"x".repeat(4096)}"}`, "utf8");
    assert.equal(
      await codeOf(() => readBoundedJsonFile(big, { authorizedRoot: root, maxBytes: 16 })),
      "FILE_INVALID"
    );

    fs.rmSync(outside, { force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("error messages carry the CODE prefix", async () => {
  try {
    parseStrictJson('{"a":1,"a":2}');
    assert.fail("expected a throw");
  } catch (error) {
    assert.match(error.message, /^JSON_INVALID: /);
  }
});
