import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const scannerPath = path.resolve("tools/scan-legacy-tokens.mjs");

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-legacy-scan-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeAllowlist(dir, entries) {
  const allowlistPath = path.join(dir, "allowlist.json");
  await fs.writeFile(allowlistPath, JSON.stringify({ entries }, null, 2));
  return allowlistPath;
}

function guardedToken(...parts) {
  return parts.join("");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function runScanner(root, allowlistPath) {
  return spawnSync(process.execPath, [scannerPath, "--root", root, "--allowlist", allowlistPath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function runExternalScanner(root, termsPath, extraArgs = []) {
  return spawnSync(process.execPath, [scannerPath, "--root", root, "--external-terms", termsPath, ...extraArgs], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

test("clean package surface passes without legacy tokens", async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "litopencode" }));
    await fs.writeFile(path.join(dir, "src", "index.js"), "export const pluginId = 'litopencode';\n");
    const allowlistPath = await writeAllowlist(dir, []);

    const result = runScanner(dir, allowlistPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /legacy-token scan passed/);
  });
});

test("clean packed surface passes when the source allowlist is absent", async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "litopencode" }));
    await fs.writeFile(path.join(dir, "src", "index.js"), "export const pluginId = 'litopencode';\n");

    const result = runScanner(dir, path.join(dir, "tools", "legacy-token-allowlist.json"));

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /legacy-token scan passed: allowed 0 matches/);
  });
});

test("unallowlisted seeded fixture fails closed", async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "src"));
    const shortToken = guardedToken("om", "o");
    const longToken = guardedToken("lazy", "codex");
    await fs.writeFile(path.join(dir, "src", "fixture.txt"), `Remove ${shortToken} and ${longToken} before release.\n`);
    const allowlistPath = await writeAllowlist(dir, []);

    const result = runScanner(dir, allowlistPath);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /legacy-token scan failed: 2 unallowlisted match\(es\)/);
    assert.match(result.stdout, /src\/fixture\.txt:1/);
  });
});

test("full guarded token set is scanned fail-closed", async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "src"));
    const guardedTokens = [
      guardedToken("om", "o"),
      guardedToken("oh-my-open", "agent"),
      guardedToken("oh-my-open", "code"),
      guardedToken("sisyphus", "labs"),
      guardedToken("lazy", "codex"),
      guardedToken("lazy", "claude"),
      guardedToken("code-yeong", "yu"),
      guardedToken("u", "lw"),
      guardedToken("ultra", "work"),
      guardedToken("ultra", "goal")
    ];
    await fs.writeFile(path.join(dir, "src", "fixture.txt"), guardedTokens.join("\n"));
    const allowlistPath = await writeAllowlist(dir, []);

    const result = runScanner(dir, allowlistPath);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /legacy-token scan failed: 10 unallowlisted match\(es\)/);
    for (let index = 1; index <= guardedTokens.length; index += 1) {
      assert.match(result.stdout, new RegExp(`src/fixture\\.txt:${index}`));
    }
    for (const token of guardedTokens) {
      assert.match(result.stdout, new RegExp(escapeRegex(token), "u"));
    }
  });
});

test("legacy token matching is case-insensitive", async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "docs"));
    const mixedCaseToken = guardedToken("Om", "O");
    await fs.writeFile(path.join(dir, "docs", "fixture.txt"), `Remove ${mixedCaseToken} before release.\n`);
    const allowlistPath = await writeAllowlist(dir, []);

    const result = runScanner(dir, allowlistPath);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /docs\/fixture\.txt:1/);
  });
});

test("non-empty allowlist entries fail closed", async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "src", "index.js"), "export {};\n");
    const allowlistPath = await writeAllowlist(dir, [
      {
        path: "src/index.js",
        token: guardedToken("om", "o"),
        reason: "missing removal condition should fail"
      }
    ]);

    const result = runScanner(dir, allowlistPath);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /legacy-token allowlist error/);
    assert.match(result.stderr, /allowlist entries are disabled/);
  });
});

test("allowlist entries are not release exemptions", async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "docs"));
    const shortToken = guardedToken("om", "o");
    const allowedLine = `Historical migration note mentions ${shortToken}.\n`;
    await fs.writeFile(path.join(dir, "docs", "migration.md"), allowedLine);
    const allowlistPath = await writeAllowlist(dir, [
      {
        path: "docs/migration.md",
        token: shortToken,
        match: allowedLine.trimEnd(),
        reason: "documents a migration source label for removal tracking",
        removalCondition: "remove after the migration note no longer needs the source label"
      }
    ]);

    const result = runScanner(dir, allowlistPath);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /allowlist entries are disabled/);
  });
});

test("word-ish boundaries avoid embedded-token false positives", async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "src"));
    const embeddedLongWord = ["ultra", "lazy", "codex", "ical"].join("");
    await fs.writeFile(path.join(dir, "src", "terms.txt"), `ordinaryword and ${embeddedLongWord} are not legacy labels.\n`);
    const allowlistPath = await writeAllowlist(dir, []);

    const result = runScanner(dir, allowlistPath);

    assert.equal(result.status, 0, result.stderr);
  });
});

test("external-term scanner reports opaque ids without raw term or context", async () => {
  await withTempDir(async (dir) => {
    const termRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-external-terms-"));
    const rawTerm = ["fixture", "secret"].join("-");
    const termsPath = path.join(termRoot, "terms.json");
    try {
      await fs.mkdir(path.join(dir, "docs"));
      await fs.writeFile(path.join(dir, "docs", "probe.txt"), `do not leak ${rawTerm} in reports\n`);
      await fs.mkdir(path.join(dir, `${rawTerm}-path`));
      await fs.writeFile(path.join(dir, `${rawTerm}-path`, "probe.txt"), `path should not leak ${rawTerm}\n`);
      await fs.writeFile(termsPath, JSON.stringify({
        version: 1,
        terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }]
      }));

      const textResult = runExternalScanner(dir, termsPath);
      assert.equal(textResult.status, 1);
      assert.match(textResult.stdout, /external-term scan failed: 2 unallowlisted match\(es\)/);
      assert.match(textResult.stdout, /docs\/probe\.txt:1 \[term-a\]/);
      assert.equal(textResult.stdout.includes(rawTerm), false);
      assert.equal(textResult.stderr.includes(rawTerm), false);

      const jsonResult = runExternalScanner(dir, termsPath, ["--json"]);
      assert.equal(jsonResult.status, 1);
      assert.equal(jsonResult.stdout.includes(rawTerm), false);
      const report = JSON.parse(jsonResult.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.unallowlisted[0].termId, "term-a");
      assert.equal("token" in report.unallowlisted[0], false);
      assert.equal("line" in report.unallowlisted[0], false);
      assert.equal(report.unallowlisted.some((entry) => entry.path.includes(rawTerm)), false);
    } finally {
      await fs.rm(termRoot, { recursive: true, force: true });
    }
  });
});

test("external-term scanner rejects malformed external-term JSON with controlled output", async () => {
  await withTempDir(async (dir) => {
    const termRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-external-terms-"));
    const termsPath = path.join(termRoot, "terms.json");
    try {
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "litopencode" }));
      await fs.writeFile(termsPath, "{not json");

      const result = runExternalScanner(dir, termsPath);

      assert.equal(result.status, 2);
      assert.match(result.stderr, /external-term scanner error/i);
      assert.doesNotMatch(result.stderr, /SyntaxError|stack/i);
    } finally {
      await fs.rm(termRoot, { recursive: true, force: true });
    }
  });
});
