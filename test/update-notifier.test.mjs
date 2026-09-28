import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  compareStableVersions,
  npmLatestUrl,
  parseStableVersion,
  parseUpdateCache,
  readUpdateCache,
  readRegistryLatestVersion,
  refreshUpdateCache,
  renderUpdateNotice,
  runUpdateNotifier,
  shouldRefreshUpdateCache,
  shouldRunUpdateNotifier,
  updateCachePath,
  updateCheckIntervalMs,
  updateResponseMaxBytes,
  updateTimeoutMs,
  writeUpdateCacheAtomically
} from "../src/cli/update-notifier.ts";

function registryResponse({ statusCode = 200, contentType = "application/json; charset=utf-8", body }) {
  const response = Readable.from([body]);
  response.statusCode = statusCode;
  response.headers = { "content-type": contentType };
  return response;
}

test("stable semver parsing is strict and comparison uses arbitrary-size integers", () => {
  assert.deepEqual(parseStableVersion("1.2.3"), [1n, 2n, 3n]);
  assert.deepEqual(parseStableVersion("999999999999999999999999999999.0.1"), [999999999999999999999999999999n, 0n, 1n]);
  for (const value of ["1.2", "1.2.3-beta.1", "1.2.3+build", "01.2.3", "1.02.3", "v1.2.3", " 1.2.3 ", 123]) {
    assert.equal(parseStableVersion(value), undefined, String(value));
  }
  assert.equal(compareStableVersions("999999999999999999999.0.0", "2.0.0"), 1);
  assert.equal(compareStableVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareStableVersions("1.2.2", "1.2.3"), -1);
  assert.equal(compareStableVersions("1.2.3-beta", "1.2.3"), undefined);
});

test("cache parsing requires the package identity, stable version, and safe timestamps", () => {
  const valid = {
    schemaVersion: 1,
    packageName: "@litfamily/litopencode",
    latestVersion: "0.1.53",
    checkedAt: 1000,
    failedAt: 2000
  };
  assert.deepEqual(parseUpdateCache(valid), valid);
  assert.equal(parseUpdateCache({ ...valid, packageName: "other-package" }), undefined);
  assert.equal(parseUpdateCache({ ...valid, latestVersion: "0.1.54-rc.1" }), undefined);
  assert.equal(parseUpdateCache({ ...valid, checkedAt: -1 }), undefined);
  assert.deepEqual(
    parseUpdateCache({ schemaVersion: 1, packageName: "@litfamily/litopencode", failedAt: 2000 }),
    { schemaVersion: 1, packageName: "@litfamily/litopencode", failedAt: 2000 }
  );
});

test("cache lives only under the user LitOpenCode state root", () => {
  assert.equal(updateCachePath("/home/alice"), path.join("/home/alice", ".litopencode", "update-check.json"));
});

test("notifier gates allow only successful interactive install and doctor commands", () => {
  const eligible = {
    argv: ["doctor"],
    exitCode: 0,
    env: {},
    stdinIsTTY: true,
    stdoutIsTTY: true,
    stderrIsTTY: true
  };
  assert.equal(shouldRunUpdateNotifier(eligible), true);
  assert.equal(shouldRunUpdateNotifier({ ...eligible, argv: ["install"] }), true);

  const blocked = [
    { argv: ["help"] },
    { argv: ["fetch-public", "https://example.com"] },
    { argv: ["install", "--dry-run"] },
    { argv: ["doctor", "--json"] },
    { argv: ["doctor", "--help"] },
    { exitCode: 1 },
    { stdinIsTTY: false },
    { stdoutIsTTY: false },
    { stderrIsTTY: false },
    { env: { CI: "1" } },
    { env: { NO_UPDATE_NOTIFIER: "1" } },
    { env: { LITOPENCODE_NO_UPDATE_CHECK: "1" } }
  ];
  for (const override of blocked) {
    assert.equal(shouldRunUpdateNotifier({ ...eligible, ...override }), false, JSON.stringify(override));
  }
});

test("cached versions render a pinned, non-installing stderr notice", () => {
  assert.equal(
    renderUpdateNotice("0.1.54", "0.1.55"),
    [
      "LitOpenCode update available: 0.1.54 -> 0.1.55",
      "Run: npm exec --yes --package @litfamily/litopencode@0.1.55 -- litopencode install --no-model-prompt --no-permission-prompt --no-auto-update",
      "Restart OpenCode after installing."
    ].join("\n")
  );
  assert.equal(renderUpdateNotice("0.1.55", "0.1.55"), undefined);
  assert.equal(renderUpdateNotice("0.1.55", "0.1.54"), undefined);
  assert.equal(renderUpdateNotice("0.1.54", "0.1.55-rc.1"), undefined);
});

test("registry response accepts only the official package JSON contract", async () => {
  assert.equal(npmLatestUrl, "https://registry.npmjs.org/%40litfamily%2Flitopencode/latest");
  assert.equal(updateTimeoutMs, 3000);
  assert.equal(updateResponseMaxBytes, 64 * 1024);
  assert.equal(
    await readRegistryLatestVersion(registryResponse({ body: JSON.stringify({ name: "@litfamily/litopencode", version: "0.1.53" }) })),
    "0.1.53"
  );

  await assert.rejects(
    readRegistryLatestVersion(registryResponse({ statusCode: 304, body: "" })),
    /status 200/i
  );
  await assert.rejects(
    readRegistryLatestVersion(registryResponse({ contentType: "text/plain", body: "{}" })),
    /content type/i
  );
  await assert.rejects(
    readRegistryLatestVersion(registryResponse({ body: JSON.stringify({ name: "not-litopencode", version: "0.1.53" }) })),
    /package identity/i
  );
  await assert.rejects(
    readRegistryLatestVersion(registryResponse({ body: JSON.stringify({ name: "@litfamily/litopencode", version: "0.1.53-beta.1" }) })),
    /stable version/i
  );
  await assert.rejects(
    readRegistryLatestVersion(registryResponse({ body: "x".repeat(updateResponseMaxBytes + 1) })),
    /64 KiB/i
  );
});

test("failed attempts and successful checks are throttled for 24 hours", () => {
  const now = 2 * updateCheckIntervalMs;
  assert.equal(updateCheckIntervalMs, 24 * 60 * 60 * 1000);
  assert.equal(shouldRefreshUpdateCache(undefined, now), true);
  assert.equal(
    shouldRefreshUpdateCache({ schemaVersion: 1, packageName: "@litfamily/litopencode", failedAt: now - updateCheckIntervalMs + 1 }, now),
    false
  );
  assert.equal(
    shouldRefreshUpdateCache({ schemaVersion: 1, packageName: "@litfamily/litopencode", failedAt: now - updateCheckIntervalMs }, now),
    true
  );
  assert.equal(
    shouldRefreshUpdateCache({ schemaVersion: 1, packageName: "@litfamily/litopencode", latestVersion: "0.1.53", checkedAt: now - 1 }, now),
    false
  );
});

test("cache writes are atomic and leave no temporary sibling", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-update-cache-"));
  try {
    const cachePath = updateCachePath(home);
    const cache = {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      latestVersion: "0.1.55",
      checkedAt: 1234
    };
    await writeUpdateCacheAtomically(cachePath, cache);
    assert.deepEqual(JSON.parse(await fs.readFile(cachePath, "utf8")), cache);
    assert.deepEqual(await fs.readdir(path.dirname(cachePath)), ["update-check.json"]);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("an eligible run prints a prior result and launches but does not await refresh work", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-update-run-"));
  try {
    await writeUpdateCacheAtomically(updateCachePath(home), {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      latestVersion: "0.1.55",
      checkedAt: 0
    });
    const stderr = [];
    let launches = 0;
    await runUpdateNotifier({
      argv: ["doctor"],
      exitCode: 0,
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      homeDir: home,
      currentVersion: "0.1.54",
      now: updateCheckIntervalMs + 1,
      writeStderr: (text) => stderr.push(text),
      launchRefresh: () => {
        launches += 1;
      }
    });
    assert.equal(launches, 1);
    assert.deepEqual(stderr, [renderUpdateNotice("0.1.54", "0.1.55") + "\n"]);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("failed refresh preserves a prior version and records the throttle atomically", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-update-failure-"));
  try {
    const cachePath = updateCachePath(home);
    await writeUpdateCacheAtomically(cachePath, {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      latestVersion: "0.1.53",
      checkedAt: 1
    });
    await refreshUpdateCache({
      homeDir: home,
      now: 2 * updateCheckIntervalMs,
      fetchLatestVersion: async () => {
        throw new Error("offline");
      }
    });
    assert.deepEqual(await readUpdateCache(cachePath), {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      latestVersion: "0.1.53",
      checkedAt: 1,
      failedAt: 2 * updateCheckIntervalMs
    });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("refresh helper independently honors a recent failed-attempt throttle", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-update-throttle-"));
  try {
    const cachePath = updateCachePath(home);
    await writeUpdateCacheAtomically(cachePath, {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      failedAt: 5000
    });
    let fetches = 0;
    await refreshUpdateCache({
      homeDir: home,
      now: 5001,
      fetchLatestVersion: async () => {
        fetches += 1;
        return "0.1.53";
      }
    });
    assert.equal(fetches, 0);
    assert.deepEqual(await readUpdateCache(cachePath), {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      failedAt: 5000
    });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
