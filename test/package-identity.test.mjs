import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { test } from "node:test";
import { applyPluginMutation, describePluginMutation, isLitOpenCodeEntry } from "../src/cli/plugin-mutation.ts";
import { npmLatestUrl, parseUpdateCache, readRegistryLatestVersion } from "../src/cli/update-notifier.ts";
import { autoUpdatePackageName } from "../src/cli/auto-update.ts";

const target = "@litfamily/litopencode@1.2.3";
test("scoped package registration migrates published and local candidate identities and preserves tuple options", () => {
  for (const value of ["litopencode", "litopencode@0.1.21", "@litfamily/opencode", "@litfamily/opencode@0.2.7", "@litfamily/litopencode", target, [target, {}]]) {
    assert.equal(isLitOpenCodeEntry(value), true, JSON.stringify(value));
  }
  const options = { enabled: true, custom: "keep" };
  const before = { plugin: [["litopencode@0.1.21", options], target, "foreign"], custom: true };
  const after = applyPluginMutation(before, describePluginMutation(before, target), target);
  assert.deepEqual(after, { plugin: [[target, options], "foreign"], custom: true });
  assert.equal(describePluginMutation(after, target).changed, false);
  assert.deepEqual(before.plugin[0], ["litopencode@0.1.21", options]);
});

test("package matching preserves foreign names, paths and malformed entries", () => {
  for (const value of ["@litfamily/litopencode-extra", "@foreign/opencode", "litopencode-extra", "https://example.com/litopencode", "./litopencode", "@litfamily/litopencode/extra", " @litfamily/litopencode", {}, [42]]) {
    assert.equal(isLitOpenCodeEntry(value), false, JSON.stringify(value));
    const before = { plugin: [value] };
    assert.deepEqual(applyPluginMutation(before, describePluginMutation(before, target), target).plugin, [value, target]);
  }
});

test("scoped updates use encoded registry identity and discard old-package cache authority", () => {
  assert.equal(autoUpdatePackageName, "@litfamily/litopencode");
  assert.equal(npmLatestUrl, "https://registry.npmjs.org/%40litfamily%2Flitopencode/latest");
  const cache = { schemaVersion: 1, packageName: "@litfamily/litopencode", latestVersion: "1.2.3", checkedAt: 1000 };
  assert.deepEqual(parseUpdateCache(cache), cache);
  assert.equal(parseUpdateCache({ ...cache, packageName: "litopencode" }), undefined);
});

test("package and lock select the full product name at the approved local release version", async () => {
  const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await fs.readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "@litfamily/litopencode");
  assert.equal(pkg.version, "1.0.13");
  assert.deepEqual(pkg.bin, { litopencode: "bin/litopencode.cjs" });
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
});

test("intermediate local config tuples keep options and foreign lookalikes", () => {
  const options = { custom: "keep", enabled: false };
  const foreign = ["@litfamily/opencode-extra", "@litfamily/opencode/extra", " @litfamily/opencode"];
  for (const id of ["@litfamily/opencode", "@litfamily/opencode@0.2.7"]) {
    const before = { plugin: [[id, options], "litopencode@0.2.7", target, ...foreign] };
    const after = applyPluginMutation(before, describePluginMutation(before, target), target);
    assert.deepEqual(after.plugin, [[target, options], ...foreign]);
    assert.deepEqual(before.plugin[0], [id, options]);
    assert.equal(describePluginMutation(after, target).changed, false);
  }
});

test("registry and cache reject published, intermediate and foreign package identities", async () => {
  for (const name of ["litopencode", "@litfamily/opencode", "@foreign/litopencode"]) {
    const response = Readable.from([JSON.stringify({ name, version: "1.2.3" })]);
    response.statusCode = 200;
    response.headers = { "content-type": "application/json" };
    await assert.rejects(readRegistryLatestVersion(response), /wrong package identity/);
    assert.equal(parseUpdateCache({ schemaVersion: 1, packageName: name, latestVersion: "1.2.3", checkedAt: 1000 }), undefined);
  }
});
