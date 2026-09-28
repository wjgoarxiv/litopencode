import assert from "node:assert/strict";
import { banner } from "../src/lit-mark.ts";
import { test } from "node:test";
import { runCli } from "../test-support/cli-fixture.ts";

test("help flag prints usage", () => {
  const result = runCli(["--help"], { env: { ...process.env, LC_ALL: "en_US.UTF-8", TERM: "xterm-256color" } });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith(banner[0].padEnd(50) + "\n"));
  assert.doesNotMatch(result.stdout, /🔥  l  i  t  opencode/u);
  assert.match(result.stdout, /litopencode/);
  assert.match(result.stdout, /npm exec --package @litfamily\/litopencode -- litopencode install/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /install \[--dry-run\]/);
  assert.match(result.stdout, /--provider <openai\|xai> --model <id>/);
  assert.match(result.stdout, /--subagent-model/);
  assert.match(result.stdout, /--yes/);
  assert.match(result.stdout, /--model-prompt/);
  assert.match(result.stdout, /--effort <e>/);
  assert.match(result.stdout, /gpt-5\.6-luna/);
  assert.match(result.stdout, /--permission-prompt/);
  assert.match(result.stdout, /--permission-mode <safe\|balanced\|yolo>/);
  assert.match(result.stdout, /--yolo/);
  assert.match(result.stdout, /fetch-public/);
  assert.match(result.stdout, /schema-3 bounded-authority lifecycle/i);
  assert.match(result.stdout, /\/start-work init\|resume\|cancel\|complete\|status/);
});

test("help uses a plain LIT wordmark for non-UTF-8 and dumb terminals", () => {
  for (const locale of [{ LC_ALL: "C", TERM: "xterm" }, { LC_ALL: "en_US.UTF-8", TERM: "dumb" }]) {
    const result = runCli(["--help"], { env: { ...process.env, ...locale } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^LIT\nlitopencode v/u);
    assert.doesNotMatch(result.stdout, /[█▓▐▌]|\u001b/u);
  }
});

test("interactive doctor help renders one help mark and no doctor stderr mark", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const flag of ["--help", "-h"]) {
    const script = `
      import { main } from './dist/cli.js';
      Object.defineProperty(process.stdout, 'isTTY', { value: true });
      Object.defineProperty(process.stderr, 'isTTY', { value: true });
      await main(${JSON.stringify(["doctor", flag])});
    `;
    const env = { ...process.env, LC_ALL: "en_US.UTF-8", TERM: "xterm-256color", NO_COLOR: "1", NO_UPDATE_NOTIFIER: "1", LITOPENCODE_NO_AUTO_UPDATE: "1" };
    delete env.CI;
    // The node test runner sets FORCE_COLOR under a TTY; with NO_COLOR it makes node warn on stderr.
    delete env.FORCE_COLOR;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.startsWith(banner[0].padEnd(50) + "\n"));
    assert.equal(result.stderr, "");
  }
});
