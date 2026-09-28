import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const script = path.resolve("skills/frontend-ui-ux/scripts/uiux.mjs");

// The CLI is reached through a symlink whenever the skill is installed into a
// linked skills root, so the entrypoint guard has to survive one.
function symlinkedEntrypoint() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-uiux-symlink-"));
  const link = path.join(dir, "uiux-link.mjs");
  fs.symlinkSync(script, link);
  return { dir, link };
}

function run(entry, args, input) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input
  });
}

test("invalid design contract still exits nonzero through a symlinked entrypoint", () => {
  const { dir, link } = symlinkedEntrypoint();
  try {
    const direct = run(script, ["validate"], "{}");
    const linked = run(link, ["validate"], "{}");
    assert.equal(direct.status, 1, "baseline: direct invocation rejects an invalid contract");
    assert.equal(linked.status, 1, "symlinked invocation must reject it too, not exit 0 silently");
    assert.notEqual(linked.stdout.trim(), "", "symlinked invocation must still emit the result");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown subcommand still exits 2 through a symlinked entrypoint", () => {
  const { dir, link } = symlinkedEntrypoint();
  try {
    const linked = run(link, ["definitely-not-a-subcommand"], "{}");
    assert.equal(linked.status, 2);
    assert.match(linked.stderr, /Usage: node uiux\.mjs/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
