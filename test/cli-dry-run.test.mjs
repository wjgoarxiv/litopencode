import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const cli = path.resolve("src/cli.ts");

function withSandbox(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-dry-run-")));
  const sandbox = { root, project: path.join(root, "project"), home: path.join(root, "home"), config: path.join(root, "config"), cache: path.join(root, "cache") };
  for (const dir of [sandbox.project, sandbox.home, sandbox.config]) fs.mkdirSync(dir, { recursive: true });
  try {
    return fn(sandbox);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run(sandbox, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: sandbox.project,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      HOME: sandbox.home,
      XDG_CONFIG_HOME: sandbox.config,
      XDG_CACHE_HOME: sandbox.cache,
      LITOPENCODE_NO_AUTO_UPDATE: "1",
      NO_UPDATE_NOTIFIER: "1",
      NO_COLOR: "1"
    }
  });
}

// Every file and directory under the sandbox, with a content hash for files.
function snapshot(root) {
  const entries = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      const rel = path.relative(root, full);
      if (stat.isDirectory()) {
        entries.push(`${rel}/`);
        walk(full);
      } else {
        entries.push(`${rel} ${createHash("sha256").update(fs.readFileSync(full)).digest("hex")}`);
      }
    }
  };
  walk(root);
  return entries.join("\n");
}

function real(sandbox, args) {
  const result = run(sandbox, args);
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  return result;
}

const goalArgs = ["create-goals", "--session-id", "s-1", "--objective", "Ship the thing", "--criterion", "it works"];

test("create-goals --dry-run reports what it would write and leaves the project untouched", () => {
  withSandbox((sandbox) => {
    const before = snapshot(sandbox.root);
    const dry = run(sandbox, [...goalArgs, "--dry-run"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /DRY RUN: nothing was written/u);
    assert.match(dry.stdout, /\.litopencode\/litgoal\/lit-loop\/goals\.json/u);
    assert.doesNotMatch(dry.stdout, /litopencode-dry-run-shadow/u, "the report names the project's own paths");
    assert.equal(snapshot(sandbox.root), before, "a dry run writes nothing");

    const json = run(sandbox, [...goalArgs, "--dry-run", "--json"]);
    assert.equal(json.status, 0, json.stderr);
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.dryRun, true);
    assert.ok(payload.wouldWrite.some((entry) => entry.path.endsWith(path.join("lit-loop", "goals.json")) && entry.change === "create"), json.stdout);
    assert.equal(payload.result.created, true);
    assert.equal(snapshot(sandbox.root), before, "a JSON dry run writes nothing");

    real(sandbox, goalArgs);
    assert.notEqual(snapshot(sandbox.root), before, "control: the same command without --dry-run writes the ledger");
  });
});

test("every loop writer honours --dry-run against an existing goal, and status --dry-run only reads", () => {
  withSandbox((sandbox) => {
    real(sandbox, goalArgs);
    real(sandbox, ["record-review-blockers", "--detail", "open question"]);
    const before = snapshot(sandbox.root);
    const writers = [
      [["record-evidence", "--criterion-id", "C1", "--kind", "green", "--ref", "test/a.test.mjs"], 0],
      [["checkpoint", "--summary", "halfway"], 0],
      [["steer", "--directive", "also cover the edge case", "--kind", "add_criterion"], 0],
      [["record-review-blockers", "--detail", "another question", "--needs-user-decision"], 0],
      [["record-review-blockers", "--resolve", "B1"], 0],
      [["complete-goals"], 1],
      [["create-goals", "--session-id", "s-1", "--objective", "Replace it", "--force"], 0],
      [["status"], 0]
    ];
    for (const [args, exitCode] of writers) {
      const dry = run(sandbox, [...args, "--dry-run"]);
      assert.equal(dry.status, exitCode, `${args.join(" ")}: ${dry.stdout}${dry.stderr}`);
      if (args[0] !== "status") assert.match(dry.stdout + dry.stderr, /DRY RUN: nothing was written/u, args.join(" "));
      assert.equal(snapshot(sandbox.root), before, `${args.join(" ")} --dry-run wrote nothing`);
    }
    const wouldChange = run(sandbox, ["checkpoint", "--summary", "halfway", "--dry-run", "--json"]);
    const payload = JSON.parse(wouldChange.stdout);
    assert.ok(payload.wouldWrite.some((entry) => entry.path.endsWith("ledger.jsonl") && entry.change === "update"), wouldChange.stdout);
  });
});
