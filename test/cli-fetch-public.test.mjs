import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { runCli, runCliAsync, withTempDir } from "../test-support/cli-fixture.ts";
import { localListenSkipReason } from "../test-support/network-capability.ts";

test("fetch-public CLI prints structured JSON for an explicitly allowed local fixture", { skip: localListenSkipReason }, async () => {
  await withTempDir(async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<main>CLI fixture body</main>");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address();
      const result = await runCliAsync(["fetch-public", `http://127.0.0.1:${port}/page`, "--json", "--allow-private-network"]);

      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true);
      assert.equal(output.verdict, "success");
      assert.match(output.content, /CLI fixture body/);
      assert.equal(output.trace.some((entry) => entry.route === "direct-http"), true);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});

test("fetch-public CLI fails closed with JSON for blocked private targets", () => {
  const result = runCli(["fetch-public", "http://127.0.0.1/", "--json"]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.verdict, "blocked");
});

test("fetch-public CLI returns JSON for network failures", () => {
  const result = runCli(["fetch-public", "http://127.0.0.1:1/unavailable", "--json", "--allow-private-network", "--timeout", "200"]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.verdict, "upstream_error");
});
