import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const scannerPath = path.resolve("tools/scan-legacy-tokens.mjs");
const referencesRoot = path.resolve("skills/frontend-ui-ux/references");

function runScanner(root, args = []) {
  return spawnSync(process.execPath, [scannerPath, "--root", root, ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

async function withProtectedFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-scanner-corpus-"));
  try {
    const target = path.join(root, "skills", "frontend-ui-ux", "references");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(referencesRoot, target, { recursive: true });
    await fs.mkdir(path.join(root, "tools"));
    await fs.writeFile(path.join(root, "tools", "legacy-token-allowlist.json"), "{\"entries\":[]}\n");
    await fn(root, target);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("scanner protects only an exactly verified canonical corpus", async () => {
  await withProtectedFixture(async (root) => {
    const result = runScanner(root, ["--json"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.allowedCount, 0);
    assert.equal(report.canonicalFilesScanned, 171);
    assert.ok(report.canonicalBytesScanned > 2_596_349);
  });
});

test("scanner still detects legacy copies and outside changes", async () => {
  await withProtectedFixture(async (root, target) => {
    const guarded = ["oh-my-open", "code"].join("");
    await fs.writeFile(path.join(root, "outside.md"), `outside ${guarded}\n`);
    const outside = runScanner(root);
    assert.equal(outside.status, 1);
    assert.match(outside.stdout, /outside\.md:1/u);

    await fs.rm(path.join(root, "outside.md"));
    const copied = await fs.readFile(path.join(target, "_canonical-corpus", "ATTRIBUTION.md"));
    await fs.writeFile(path.join(root, "copied-notice.md"), Buffer.concat([copied, Buffer.from(`\n${guarded}\n`)]));
    const copyResult = runScanner(root);
    assert.equal(copyResult.status, 1);
    assert.match(copyResult.stdout, /copied-notice\.md/u);
  });
});

test("external-term scanner excludes exact corpus but detects the term outside it", async () => {
  await withProtectedFixture(async (root) => {
    const termRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-external-term-source-"));
    const raw = ["oh-my-open", "code"].join("");
    const terms = path.join(termRoot, "terms.json");
    try {
      await fs.writeFile(terms, JSON.stringify({ version: 1, terms: [{ id: "external-a", value: raw, matchMode: "substring" }] }));
      const exact = runScanner(root, ["--external-terms", terms]);
      assert.equal(exact.status, 0, exact.stderr || exact.stdout);

      await fs.writeFile(path.join(root, "external-copy.md"), `copied ${raw}\n`);
      const outside = runScanner(root, ["--external-terms", terms, "--json"]);
      assert.equal(outside.status, 1);
      assert.equal(outside.stdout.includes(raw), false);
      assert.equal(JSON.parse(outside.stdout).unallowlisted[0].termId, "external-a");
    } finally {
      await fs.rm(termRoot, { recursive: true, force: true });
    }
  });
});

test("scanner refuses protection after corpus or manifest tamper", async (t) => {
  await t.test("corpus changed", async () => {
    await withProtectedFixture(async (root, target) => {
      await fs.appendFile(path.join(target, "design", "apple.md"), "tamper");
      const result = runScanner(root);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /canonical corpus/i);
    });
  });
  await t.test("manifest carrier", async () => {
    await withProtectedFixture(async (root, target) => {
      const manifestPath = path.join(target, "_canonical-corpus", "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      manifest.skipScannerFor = ["carrier"];
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
      const result = runScanner(root);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /canonical corpus/i);
    });
  });
});

test("scanner refuses canonical protection through a symlinked references root", async () => {
  await withProtectedFixture(async (root, target) => {
    const held = `${target}.held`;
    await fs.rename(target, held);
    await fs.symlink(path.basename(held), target);
    const result = runScanner(root);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /references root.*symbolic link/iu);
  });
});

async function assertCaptureToScanReplacementRejected(mutate) {
  await withProtectedFixture(async (root, target) => {
    const scanner = await import(pathToFileURL(scannerPath).href);
    assert.equal(typeof scanner.scanLegacyTokens, "function", "scanner must expose the capture-to-report transaction");
    await assert.rejects(
      scanner.scanLegacyTokens({
        root,
        allowlistPath: path.join(root, "tools", "legacy-token-allowlist.json")
      }, {
        async afterCanonicalScan() {
          await mutate(target);
        }
      }),
      /canonical.*(?:snapshot|identity|ancestor|revalidation)|ENOENT/iu
    );
  });
}

test("scanner rejects deterministic final-file replacement after captured bytes are scanned", async () => {
  await assertCaptureToScanReplacementRejected(async (target) => {
    const filePath = path.join(target, "design", "apple.md");
    await fs.rename(filePath, `${filePath}.captured`);
    await fs.writeFile(filePath, "replacement after canonical capture and scan\n");
  });
});

test("scanner rejects deterministic ancestor replacement after captured bytes are scanned", async () => {
  await assertCaptureToScanReplacementRejected(async (target) => {
    const directory = path.join(target, "design");
    const held = `${directory}.captured`;
    await fs.rename(directory, held);
    await fs.mkdir(directory);
    await fs.copyFile(path.join(held, "apple.md"), path.join(directory, "apple.md"));
  });
});
