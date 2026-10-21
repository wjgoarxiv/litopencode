import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// OpenCode 2 plugin types come from @opencode/plugin. They are for type checking only: the host hands
// the runtime modules to the plugin, so the package must never ship a runtime dependency on them.
const manifest = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));

test("the OpenCode 2 plugin types are pinned as an exact dev dependency only", () => {
  assert.equal(manifest.devDependencies?.["@opencode/plugin"], "2.0.32");
  assert.equal(manifest.dependencies?.["@opencode/plugin"], undefined);
  assert.equal(manifest.peerDependencies?.["@opencode/plugin"], undefined);
  assert.equal(manifest.optionalDependencies?.["@opencode/plugin"], undefined);
});

test("OpenCode 1 hosts older than the first one that loads object plugin entries are refused", () => {
  assert.equal(manifest.engines?.opencode, ">=1.18.29");
});
