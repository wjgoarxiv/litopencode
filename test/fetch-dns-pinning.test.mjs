import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { publicFetch } from "../skills/lit-hijack/scripts/hijack.mjs";
import { fetchAssets } from "../skills/lit-typographic-motion/engine/assets.mjs";

// DNS rebinding: a name that answers the hop check with a public address and the connection with a
// private one. lit-hijack and the motion asset fetch must connect to the address the check approved.
// The request is faked at node:http(s) level and asks the lookup it was handed, as net.connect does.
const PUBLIC = "93.184.216.34";

function rebinding() {
  const asked = new Map();
  return async (host) => {
    const n = asked.get(host) ?? 0;
    asked.set(host, n + 1);
    return [{ address: n === 0 ? PUBLIC : "127.0.0.1", family: 4 }];
  };
}

function fakeRequest(connected, body, type = "text/html") {
  return (href, options, onResponse) => {
    const req = new EventEmitter();
    req.end = () => {
      const host = new URL(href).hostname;
      options.lookup(host, { all: true }, (_error, list) => {
        connected.push(...list.map(({ address }) => address));
        options.lookup(host, {}, (_error, address) => {
          connected.push(address);
          const res = Readable.from([Buffer.from(body)]);
          res.statusCode = 200;
          res.headers = { "content-type": type };
          onResponse(res);
        });
      });
    };
    return req;
  };
}

test("a lit-hijack capture connects to the address its hop check approved, not a second answer", async () => {
  const connected = [];
  const result = await publicFetch("https://rebind.example/post", { lookup: rebinding(), request: fakeRequest(connected, "<title>t</title>") });
  assert.equal(result.buffer.toString("utf8"), "<title>t</title>");
  assert.ok(connected.length >= 2);
  assert.deepEqual([...new Set(connected)], [PUBLIC]);
});

test("a lit-hijack http hop is pinned the same way", async () => {
  const connected = [];
  await publicFetch("http://rebind.example/post", { lookup: rebinding(), request: fakeRequest(connected, "ok"), httpRequest: fakeRequest(connected, "ok") });
  assert.deepEqual([...new Set(connected)], [PUBLIC]);
});

test("the motion asset fetch connects to the address its hop check approved", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "lit-pin-"));
  try {
    const connected = [];
    const html = '<html><head><title>Orbit</title><meta property="og:image" content="https://rebind.example/a.png"></head></html>';
    await fetchAssets({ out, url: "https://rebind.example/", lookup: rebinding(), request: fakeRequest(connected, html) }).catch(() => undefined);
    assert.ok(connected.length >= 2, "the page request went through the pinned request");
    assert.deepEqual([...new Set(connected)], [PUBLIC]);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
