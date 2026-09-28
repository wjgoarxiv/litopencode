import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { describe, it } from "node:test";
import { localListenSkipReason } from "../test-support/network-capability.ts";
import { fetchPublicSource } from "../src/index.ts";

async function withServer(handler, fn) {
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

describe("lit-fetch edge-case fixture-server tests", () => {
  listenerIt("fetch classifier accepts meaningful vendor JSON and rejects empty JSON proof", async () => {
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": request.url === "/empty" ? "application/json" : "application/vnd.api+json" });
      response.end(request.url === "/empty" ? "{}" : JSON.stringify({ data: { type: "articles", id: "public-record" } }));
    }, async (baseUrl) => {
      const vendor = await fetchPublicSource(`${baseUrl}/vendor`, { allowPrivateNetwork: true });
      const empty = await fetchPublicSource(`${baseUrl}/empty`, { allowPrivateNetwork: true });
      assert.equal(vendor.ok, true);
      assert.equal(vendor.contentType, "application/vnd.api+json");
      assert.equal(empty.verdict, "route_coverage_incomplete");
      assert.equal(empty.fetchVerdict.positiveProof, false);
    });
  });

  listenerIt("HTTP 200 problem media types and error-shaped JSON are not positive content proof", async () => {
    await withServer((request, response) => {
      const problemMediaType = request.url === "/problem";
      response.writeHead(200, { "content-type": problemMediaType ? "application/problem+json" : "application/json" });
      response.end(JSON.stringify(problemMediaType
        ? { type: "about:blank", title: "Access denied", status: 403, detail: "Authentication required" }
        : { error: "upstream denied the request", status: 403 }));
    }, async (baseUrl) => {
      const problem = await fetchPublicSource(`${baseUrl}/problem`, { allowPrivateNetwork: true });
      const errorShape = await fetchPublicSource(`${baseUrl}/error`, { allowPrivateNetwork: true });

      for (const result of [problem, errorShape]) {
        assert.equal(result.ok, false);
        assert.equal(result.verdict, "route_coverage_incomplete");
        assert.equal(result.fetchVerdict.positiveProof, false);
        assert.equal(result.content, undefined);
      }
    });
  });

  listenerIt("HTTP 200 JSON with object-valued error fields is not positive content proof", async () => {
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url === "/error-object"
        ? { error: { code: "access_denied", detail: "The public route failed" } }
        : { errors: { primary: { code: "upstream_failure" } } }));
    }, async (baseUrl) => {
      const errorObject = await fetchPublicSource(`${baseUrl}/error-object`, { allowPrivateNetwork: true });
      const errorsObject = await fetchPublicSource(`${baseUrl}/errors-object`, { allowPrivateNetwork: true });

      for (const result of [errorObject, errorsObject]) {
        assert.equal(result.ok, false);
        assert.equal(result.verdict, "route_coverage_incomplete");
        assert.equal(result.fetchVerdict.positiveProof, false);
        assert.equal(result.content, undefined);
      }
    });
  });

  listenerIt("HTTP status verdict wins over response-size overflow", async () => {
    await withServer((_request, response) => {
      response.writeHead(401, { "content-type": "text/html" });
      response.end("x".repeat(128));
    }, async (baseUrl) => {
      const result = await fetchPublicSource(`${baseUrl}/large-login`, { allowPrivateNetwork: true, maxBytes: 16 });
      assert.equal(result.verdict, "authentication_required");
      assert.equal(result.fetchVerdict.routeCoverageComplete, false);
    });
  });

  listenerIt("fetch verdict mirrors untried routes and strips URL fragments", async () => {
    await withServer((_request, response) => {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("authentication required");
    }, async (baseUrl) => {
      const result = await fetchPublicSource(`${baseUrl}/login?access_token=secret#fragment-secret`, { allowPrivateNetwork: true });
      assert.deepEqual(result.fetchVerdict.untriedRoutes, result.untriedRoutes);
      assert.equal(result.fetchVerdict.routeCoverageComplete, false);
      assert.doesNotMatch(JSON.stringify(result), /fragment-secret/);
      assert.match(result.url, /access_token=%5Bredacted%5D/);
    });
  });

  it("all public-fetch URL surfaces redact every query value, userinfo, and fragment without network access", async () => {
    // Given: AWS-style and ordinary query values plus URL userinfo and a fragment.
    const input = [
      "https://user-secret:password-secret@example.invalid/article",
      "?X-Amz-Signature=aws-signature-secret&provider_token=provider-secret&topic=ordinary-secret&empty=",
      "#fragment-secret"
    ].join("");

    // When: the reviewed resolver returns no address, so no socket can be opened.
    const result = await fetchPublicSource(input, { resolveHostname: async () => [] });

    // Then: every result/trace/verdict URL keeps query keys but exposes no supplied value.
    const serialized = JSON.stringify(result);
    assert.equal(result.verdict, "blocked");
    for (const secret of [
      "user-secret",
      "password-secret",
      "aws-signature-secret",
      "provider-secret",
      "ordinary-secret",
      "fragment-secret"
    ]) {
      assert.doesNotMatch(serialized, new RegExp(secret));
    }
    for (const key of ["X-Amz-Signature", "provider_token", "topic", "empty"]) {
      assert.match(serialized, new RegExp(`${key}=%5Bredacted%5D`));
    }
    assert.equal(result.url, result.fetchVerdict.url);
    assert.equal(result.finalUrl, result.fetchVerdict.finalUrl);
    assert.ok(result.trace.every((entry) => !entry.url.includes("#")));
    assert.ok(result.attempts.every((entry) => !entry.url.includes("#")));
  });

  it("malformed public-fetch URL output does not repeat embedded credential-like text", async () => {
    const result = await fetchPublicSource("https://user-secret:password-secret@/path?topic=ordinary-secret#fragment-secret");

    assert.equal(result.verdict, "invalid_input");
    assert.equal(result.url, "[invalid-url]");
    assert.doesNotMatch(JSON.stringify(result), /user-secret|password-secret|ordinary-secret|fragment-secret/);
  });

  listenerIt("HTML error templates are not positive content proof", async () => {
    await withServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><title>404 Not Found</title><body>Page not found</body></html>");
    }, async (baseUrl) => {
      const result = await fetchPublicSource(`${baseUrl}/missing`, { allowPrivateNetwork: true });
      assert.equal(result.ok, false);
      assert.equal(result.verdict, "route_coverage_incomplete");
      assert.equal(result.fetchVerdict.positiveProof, false);
    });
  });

  listenerIt("substantive HTML articles may discuss access-wall vocabulary without becoming a wall", async () => {
    await withServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end([
        "<html><title>Access-control terminology</title><article>",
        "<h1>How public readers classify access failures</h1>",
        "<p>This public technical article explains why a sign in required message can indicate authentication, ",
        "why publishers say subscribe to continue at a paywall, and why checking your browser or CAPTCHA text ",
        "can indicate an interstitial. These phrases are examples in substantive documentation, not controls.</p>",
        "</article></html>"
      ].join(""));
    }, async (baseUrl) => {
      const result = await fetchPublicSource(`${baseUrl}/article`, { allowPrivateNetwork: true });

      assert.equal(result.ok, true);
      assert.equal(result.verdict, "success");
      assert.equal(result.fetchVerdict.positiveProof, true);
    });
  });

  listenerIt("substantive article and main prose may discuss error and auth vocabulary", async () => {
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      if (request.url === "/error-article") {
        response.end([
          "<html><title>Error terminology</title><article>",
          "<h1>Why HTTP clients report 404 Not Found</h1>",
          "<p>This substantive technical article explains that a 404 Not Found response can be a routing signal, ",
          "while page not found text may come from a public error template. Engineers should inspect status, ",
          "content type, and evidence before deciding whether a requested record actually exists.</p>",
          "</article></html>"
        ].join(""));
        return;
      }
      response.end([
        "<html><title>Authentication terminology</title><main>",
        "<h1>How documentation describes authentication walls</h1>",
        "<p>This substantive public guide discusses sign in required and authentication required messages, ",
        "including why some publishers say subscribe to continue or checking your browser. These phrases are ",
        "quoted as classification examples in ordinary prose and are not login, paywall, or challenge controls.</p>",
        "</main></html>"
      ].join(""));
    }, async (baseUrl) => {
      for (const path of ["/error-article", "/auth-main"]) {
        const result = await fetchPublicSource(`${baseUrl}${path}`, { allowPrivateNetwork: true });
        assert.equal(result.ok, true);
        assert.equal(result.verdict, "success");
        assert.equal(result.fetchVerdict.positiveProof, true);
      }
    });
  });

  listenerIt("structural login, paywall, and challenge templates remain access walls", async () => {
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      if (request.url === "/login") {
        response.end('<main><form action="/login"><label>Password<input type="password"></label><button>Sign in</button></form></main>');
        return;
      }
      if (request.url === "/paywall") {
        response.end(`<article>${"Public preview text. ".repeat(20)}</article><dialog class="paywall">Subscribe to continue</dialog>`);
        return;
      }
      response.end('<main class="cf-challenge"><form><div class="g-recaptcha">Verify you are human</div></form></main>');
    }, async (baseUrl) => {
      assert.equal((await fetchPublicSource(`${baseUrl}/login`, { allowPrivateNetwork: true })).verdict, "authentication_required");
      assert.equal((await fetchPublicSource(`${baseUrl}/paywall`, { allowPrivateNetwork: true })).verdict, "paywall");
      assert.equal((await fetchPublicSource(`${baseUrl}/challenge`, { allowPrivateNetwork: true })).verdict, "blocked");
    });
  });
});
