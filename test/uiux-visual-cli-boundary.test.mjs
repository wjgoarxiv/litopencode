import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const maxStdinBytes = 1024 * 1024;
const commands = [
  {
    args: ["skills/frontend-ui-ux/scripts/uiux.mjs", "retrieve"],
    duplicate: '{"query":"button","query":"link","domains":["components"]}'
  },
  {
    args: ["skills/visual-qa/scripts/visual-qa.mjs", "capabilities"],
    duplicate: '{"captureAvailable":false,"captureAvailable":true}'
  }
];

function run(args, input) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: null,
    input,
    maxBuffer: 4 * 1024 * 1024
  });
}

test("uiux.cli-stdin-strict-bounded", () => {
  const attacks = [
    { input: Buffer.from([0xc3, 0x28]), pattern: /UTF-8/i },
    { input: Buffer.alloc(maxStdinBytes + 1, 0x20), pattern: /size|bytes|large|limit/i },
    { input: Buffer.from('{"x":"\\u0000"}\0'), pattern: /NUL/i },
    { input: Buffer.from("{} trailing"), pattern: /trailing|malformed/i }
  ];
  for (const command of commands) {
    const duplicate = run(command.args, Buffer.from(command.duplicate));
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr.toString("utf8"), /duplicate key/i);
    for (const attack of attacks) {
      const result = run(command.args, attack.input);
      assert.notEqual(result.status, 0, `${command.args[0]} must reject hostile stdin`);
      assert.match(result.stderr.toString("utf8"), attack.pattern);
    }
  }
});

test("visualqa.cli-empty-capabilities-blocks-stably", () => {
  const first = run(commands[1].args, Buffer.from("{}"));
  const second = run(commands[1].args, Buffer.from("{}"));
  assert.equal(first.status, 0, first.stderr.toString("utf8"));
  assert.equal(second.status, 0, second.stderr.toString("utf8"));
  assert.equal(first.stdout.toString("utf8"), second.stdout.toString("utf8"));
  assert.deepEqual(JSON.parse(first.stdout.toString("utf8")), {
    codes: [
      "BLOCKED_RENDERER_UNAVAILABLE",
      "BLOCKED_AUTH_UNAVAILABLE",
      "BLOCKED_TEST_ACCOUNT_UNSAFE",
      "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"
    ],
    verdict: "BLOCKED"
  });
});

test("uiux.importer-direct-guard-canonicalizes-aliased-paths", async () => {
  const importer = await import(
    new URL("../skills/frontend-ui-ux/scripts/import-design-intelligence.mjs", import.meta.url)
  );
  assert.equal(typeof importer.isDirectExecution, "function");
  assert.equal(
    await importer.isDirectExecution(
      "/tmp/litopencode-alias/scripts/import-design-intelligence.mjs",
      "/private/tmp/litopencode-alias/scripts/import-design-intelligence.mjs",
      { realpath: async (value) => value.replace("/tmp/", "/private/tmp/") }
    ),
    true
  );
  assert.equal(
    path.basename("skills/frontend-ui-ux/scripts/import-design-intelligence.mjs"),
    "import-design-intelligence.mjs"
  );
});

test("uiux.importer-rejects-parent-symlink-escape", async () => {
  const importer = await import(
    new URL("../skills/frontend-ui-ux/scripts/import-design-intelligence.mjs", import.meta.url)
  );
  assert.equal(typeof importer.resolveContainedRegularFile, "function");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-importer-symlink-"));
  const root = path.join(temporary, "root");
  const outside = path.join(temporary, "outside");
  try {
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "source.csv"), "safe,data\n");
    fs.symlinkSync(outside, path.join(root, "parent"));
    await assert.rejects(
      importer.resolveContainedRegularFile("parent/source.csv", root),
      /escape|contain|symlink/i
    );
    fs.mkdirSync(path.join(root, "contained"));
    fs.writeFileSync(path.join(root, "contained/source.csv"), "safe,data\n");
    assert.equal(
      await importer.resolveContainedRegularFile("contained/source.csv", root),
      fs.realpathSync(path.join(root, "contained/source.csv"))
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
