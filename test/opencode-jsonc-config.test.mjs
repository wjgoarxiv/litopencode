import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readJsonObjectIfPresent } from "../src/cli/json.ts";
import { applyHostLimits, ensureHostLimits } from "../src/cli/host-limits.ts";
import { renderOpenCodeConfig } from "../src/cli/install-config.ts";
import { editJsoncObject, parseJsonc } from "../src/cli/jsonc.ts";
import { packageId, runCli, withTempDir } from "../test-support/cli-fixture.ts";

// OpenCode reads its config as JSONC: line and block comments and trailing commas are legal, in
// opencode.jsonc and opencode.json alike. LitOpenCode reads the same file, so it must accept the same
// syntax, and it must never silently delete the comments a user wrote there.
const commentedConfig = `// my config
{
  "$schema": "https://opencode.ai/config.json", // a URL keeps its // inside the string
  /* block comment */
  "model": "openai/gpt-5", // note
  "theme": "a /* not a comment */ value",
  "plugin": [
    "other-plugin",
  ],
}
`;

test("the OpenCode config reader accepts comments and trailing commas and leaves string contents alone", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "opencode.jsonc");
    await fs.writeFile(file, commentedConfig);
    assert.deepEqual(await readJsonObjectIfPresent(file), {
      $schema: "https://opencode.ai/config.json",
      model: "openai/gpt-5",
      theme: "a /* not a comment */ value",
      plugin: ["other-plugin"]
    });
  });
});

test("install --dry-run reads a commented default-root opencode.jsonc instead of aborting", async () => {
  await withTempDir(async (dir) => {
    const root = path.join(process.env.XDG_CONFIG_HOME, "opencode");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "opencode.jsonc"), commentedConfig);

    const result = runCli(["install", "--dry-run"], { env: { ...process.env, HOME: dir } });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.path, path.join(root, "opencode.jsonc"));
    assert.equal(output.plugin.currentCount, 1);
    assert.deepEqual(output.plugin.add.length, 1);
    assert.equal(await fs.readFile(path.join(root, "opencode.jsonc"), "utf8"), commentedConfig);
  });
});

test("doctor finds the plugin in a config with an inline comment and a trailing comma", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "opencode.jsonc"),
      `{\n  "model": "openai/gpt-5", // note\n  "plugin": [\n    "${packageId}",\n  ],\n}\n`
    );

    const result = runCli(["doctor", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.install.plugin.present, true);
    assert.equal(output.install.plugin.ok, true);
    assert.equal(output.install.plugin.error, undefined);
  });
});

test("install registers the plugin in a commented config and keeps every comment", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "opencode.json");
    await fs.writeFile(file, commentedConfig);

    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    const written = await fs.readFile(file, "utf8");
    for (const comment of ["// my config", "// a URL keeps its // inside the string", "/* block comment */", "// note"]) {
      assert.ok(written.includes(comment), `${comment} was dropped:\n${written}`);
    }
    const parsed = await readJsonObjectIfPresent(file);
    assert.deepEqual(parsed.plugin, ["other-plugin", packageId]);
    assert.equal(parsed.model, "openai/gpt-5");
  });
});

test("host limits edit a commented config in place and keep the comments outside the edited entries", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "opencode.jsonc");
    await fs.writeFile(file, commentedConfig);

    await ensureHostLimits(file, await readJsonObjectIfPresent(file), true);

    const written = await fs.readFile(file, "utf8");
    for (const comment of ["// my config", "/* block comment */", "// note"]) {
      assert.ok(written.includes(comment), `${comment} was dropped:\n${written}`);
    }
    const parsed = await readJsonObjectIfPresent(file);
    assert.equal(parsed.compaction.auto, true);
    assert.equal(typeof parsed.provider.openai.models, "object");
    assert.deepEqual(parsed.plugin, ["other-plugin"]);
  });
});

test("an edit that would delete a comment fails closed and names the exact entry to add", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "opencode.jsonc");
    const original = `{\n  "provider": {\n    // keep my provider note\n    "openai": {}\n  }\n}\n`;
    await fs.writeFile(file, original);

    await assert.rejects(
      ensureHostLimits(file, await readJsonObjectIfPresent(file), true),
      (error) => {
        assert.match(error.message, /comment/u);
        assert.match(error.message, /"provider": \{/u);
        assert.ok(error.message.includes(file), error.message);
        return true;
      }
    );
    assert.equal(await fs.readFile(file, "utf8"), original);
  });
});

test("install that cannot keep a comment refuses before it writes anything", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "opencode.json");
    const original = `{\n  "provider": {\n    // keep my provider note\n    "openai": {}\n  }\n}\n`;
    await fs.writeFile(file, original);

    const result = runCli(["install", "--root", dir, "--provider", "openai", "--model", "gpt-5.6-luna", "--effort", "high"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /"provider": \{/u);
    assert.equal(await fs.readFile(file, "utf8"), original);
    await assert.rejects(fs.stat(path.join(dir, "litopencode.json")), { code: "ENOENT" });
  });
});

test("tokenizer: an escaped quote before // stays inside the string", () => {
  assert.deepEqual(parseJsonc('{"a": "x\\"// y", // real comment\n"b": "\\\\"// after an escaped backslash\n}'), {
    a: 'x"// y',
    b: "\\"
  });
});

test("tokenizer: trailing commas inside nested values are accepted", () => {
  assert.deepEqual(parseJsonc('{"a": {"b": [1, 2,], "c": {"d": true,},},}'), { a: { b: [1, 2], c: { d: true } } });
});

test("tokenizer: an unterminated block comment is rejected with a clear error", () => {
  assert.throws(() => parseJsonc('{"a": 1 /* never closed\n}'), /unterminated block comment.*line 1/iu);
});

test("tokenizer: a leading BOM is read and kept on write", () => {
  const text = '\uFEFF{\n  // note\n  "a": 1\n}\n';
  assert.deepEqual(parseJsonc(text), { a: 1 });
  const edited = editJsoncObject(text, { a: 1, b: 2 });
  assert.equal(edited.ok, true);
  assert.ok(edited.text.startsWith("\uFEFF{"), JSON.stringify(edited.text));
  assert.deepEqual(parseJsonc(edited.text), { a: 1, b: 2 });
  assert.ok(renderOpenCodeConfig("x.json", '\uFEFF{"a": 1}', { a: 2 }).startsWith("\uFEFF{"));
});

test("tokenizer: a CRLF file stays CRLF after an edit", () => {
  const text = '{\r\n  // note\r\n  "plugin": [\r\n    "x"\r\n  ]\r\n}\r\n';
  const edited = editJsoncObject(text, { plugin: ["x", "y"], compaction: { auto: true } });
  assert.equal(edited.ok, true);
  assert.doesNotMatch(edited.text.replace(/\r\n/gu, ""), /\n/u, JSON.stringify(edited.text));
  assert.deepEqual(parseJsonc(edited.text), { plugin: ["x", "y"], compaction: { auto: true } });
});

test("tokenizer: an append after a last member with an inline comment keeps the comment", () => {
  const edited = editJsoncObject('{\n  "a": 1 // keep\n}\n', { a: 1, b: [1] });
  assert.equal(edited.ok, true);
  assert.match(edited.text, /\/\/ keep/u);
  assert.deepEqual(parseJsonc(edited.text), { a: 1, b: [1] });
});

const providerComment = `{\n  "provider": {\n    // keep my provider note\n    "openai": {}\n  }\n}\n`;

test("install --dry-run reports the refusal the real install would make, with the same exit code", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "opencode.json");
    await fs.writeFile(file, providerComment);

    const result = runCli(["install", "--dry-run", "--root", dir, "--provider", "openai", "--model", "gpt-5.6-luna", "--effort", "high"]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.dryRun, true);
    assert.match(output.blocked, /Refusing to rewrite/u);
    assert.match(output.blocked, /"provider": \{/u);
    assert.match(result.stderr, /Refusing to rewrite/u);
    assert.equal(await fs.readFile(file, "utf8"), providerComment);
  });
});

test("default-root install refuses a comment-deleting plugin cleanup before it writes or runs OpenCode", async () => {
  await withTempDir(async (dir) => {
    const root = path.join(process.env.XDG_CONFIG_HOME, "opencode");
    await fs.mkdir(root, { recursive: true });
    const file = path.join(root, "opencode.jsonc");
    const original = `{\n  "plugin": [\n    // mine\n    "@litfamily/litopencode@0.9.0",\n    "other-plugin"\n  ]\n}\n`;
    await fs.writeFile(file, original);
    const bin = path.join(dir, "bin");
    await fs.mkdir(bin);
    const marker = path.join(dir, "opencode-ran");
    await fs.writeFile(path.join(bin, "opencode"), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });

    const result = runCli(["install"], { env: { ...process.env, HOME: dir, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Refusing to rewrite .*"plugin" entry/u);
    assert.equal(await fs.readFile(file, "utf8"), original);
    await assert.rejects(fs.stat(marker), { code: "ENOENT" });
    await assert.rejects(fs.stat(path.join(root, "litopencode.json")), { code: "ENOENT" });
  });
});

test("install still registers the plugin when host limits are already configured", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "opencode.json");
    await fs.writeFile(file, JSON.stringify(applyHostLimits(null), null, 2) + "\n");

    const result = runCli(["install", "--root", dir, "--provider", "openai", "--model", "gpt-5.6-luna", "--effort", "high"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readJsonObjectIfPresent(file)).plugin, [packageId]);
  });
});
