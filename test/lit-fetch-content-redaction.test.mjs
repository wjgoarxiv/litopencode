import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { describe, it } from "node:test";
import { localListenSkipReason } from "../test-support/network-capability.ts";
import { fetchPublicSource } from "../src/index.ts";

async function withEchoServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function listenerIt(name, fn) {
  return it(name, { skip: localListenSkipReason }, fn);
}

describe("lit-fetch content-redaction fixture-server tests", () => {
  listenerIt("returned content removes source query and fragment values while preserving keys and public text", async () => {
    await withEchoServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end([
        "Stable public record.",
        "X-Amz-Signature=OPENCODE_ECHO_SECRET",
        "topic=ordinary-value",
        "encoded=encoded%20secret",
        "decoded=encoded secret",
        "fragment=fragment-secret"
      ].join(" "));
    }, async (baseUrl) => {
      const result = await fetchPublicSource([
        `${baseUrl}/echo?X-Amz-Signature=OPENCODE_ECHO_SECRET`,
        "&topic=ordinary-value&encoded=encoded%20secret",
        "#fragment-secret"
      ].join(""), { allowPrivateNetwork: true });

      assert.equal(result.ok, true);
      assert.equal(result.contentSafety?.untrusted, true);
      assert.match(result.content ?? "", /Stable public record/);
      assert.match(result.content ?? "", /X-Amz-Signature=/);
      assert.match(result.content ?? "", /topic=/);
      assert.match(result.content ?? "", /encoded=/);
      assert.match(result.content ?? "", /fragment=/);
      assert.doesNotMatch(
        JSON.stringify(result),
        /OPENCODE_ECHO_SECRET|ordinary-value|encoded%20secret|encoded secret|fragment-secret/
      );
    });
  });

  listenerIt("returned content removes values introduced by redirects", async () => {
    await withEchoServer((request, response) => {
      if (request.url?.startsWith("/start")) {
        response.writeHead(302, { location: "/final?provider_signature=redirect-secret#redirect-fragment" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("Stable redirect record provider_signature=redirect-secret fragment=redirect-fragment");
    }, async (baseUrl) => {
      const result = await fetchPublicSource(`${baseUrl}/start?source=source-secret`, { allowPrivateNetwork: true });

      assert.equal(result.ok, true);
      assert.match(result.content ?? "", /Stable redirect record/);
      assert.doesNotMatch(JSON.stringify(result), /source-secret|redirect-secret|redirect-fragment/);
    });
  });

  listenerIt("percent-encoding variants do not make ordinary text matching case-insensitive", async () => {
    await withEchoServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("Stable public record code=ABC lowercase-nonsecret=abc");
    }, async (baseUrl) => {
      const result = await fetchPublicSource(`${baseUrl}/case?code=ABC`, { allowPrivateNetwork: true });

      assert.equal(result.ok, true);
      assert.match(result.content ?? "", /code=\[redacted\]/);
      assert.match(result.content ?? "", /lowercase-nonsecret=abc/);
    });
  });
});
