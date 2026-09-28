import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BACKUP_DIR, PAIRS, check, checkNpmReadme } from "../tools/readme-for-npm.mjs";

const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const pin = `https://cdn.jsdelivr.net/npm/@litfamily/litopencode@${pkg.version}/`;
const guide = PAIRS[0].guide;

async function withFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-readme-for-npm-"));
  try {
    await fs.mkdir(path.join(root, "tools"));
    await fs.copyFile("tools/readme-for-npm.mjs", path.join(root, "tools", "readme-for-npm.mjs"));
    await fs.copyFile("package.json", path.join(root, "package.json"));
    for (const { npm, target } of PAIRS) {
      await fs.copyFile(npm, path.join(root, npm));
      await fs.copyFile(target, path.join(root, target));
    }
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function run(root, command) {
  return spawnSync(process.execPath, [path.join(root, "tools", "readme-for-npm.mjs"), command], { cwd: root, encoding: "utf8" });
}

test("the npm README pages pass their own invariants", () => {
  assert.deepEqual(check(), []);
});

test("the npm README check rejects stale pins, relative targets, a missing guide link and oversize pages", () => {
  const good = `![cover](${pin}docs/assets/cover-motion.webp)\n\n[Full guide](${guide})\n`;
  assert.deepEqual(checkNpmReadme(good, { version: pkg.version, guide }), []);
  assert.match(checkNpmReadme(good.replace(`@${pkg.version}/`, "@0.0.1/"), { version: pkg.version, guide }).join("\n"), /does not match package version/u);
  assert.match(checkNpmReadme(`${good}![x](./docs/assets/cover.webp)\n`, { version: pkg.version, guide }).join("\n"), /relative or non-https target \.\/docs/u);
  assert.match(checkNpmReadme(`${good}<img src="docs/assets/x.png" />\n`, { version: pkg.version, guide }).join("\n"), /relative or non-https target docs/u);
  assert.match(checkNpmReadme(good.replace(guide, "https://example.invalid/"), { version: pkg.version, guide }).join("\n"), /missing the GitHub full-guide link/u);
  assert.match(checkNpmReadme(`${good}[x](${pin}docs/release-checklist.md)\n`, { version: pkg.version, guide }).join("\n"), /release checklist/u);
  assert.match(checkNpmReadme(good + "x".repeat(40 * 1024), { version: pkg.version, guide }).join("\n"), /exceeds the/u);
  assert.match(checkNpmReadme(good, { version: pkg.version, guide, githubText: "short" }).join("\n"), /more than half of the GitHub page/u);
});

test("apply swaps the npm pages in, stays idempotent, and restore puts the GitHub pages back byte-identical", async () => {
  await withFixture(async (root) => {
    const before = new Map();
    for (const { target } of PAIRS) before.set(target, await fs.readFile(path.join(root, target)));

    const applied = run(root, "apply");
    assert.equal(applied.status, 0, applied.stderr);
    for (const { npm, target } of PAIRS) {
      assert.deepEqual(await fs.readFile(path.join(root, target)), await fs.readFile(path.join(root, npm)), `${target} holds the npm page`);
      assert.deepEqual(await fs.readFile(path.join(root, BACKUP_DIR, target)), before.get(target), `${target} is backed up`);
    }
    const again = run(root, "apply");
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stderr, /already applied/u);
    assert.equal(again.stdout, "", "status stays off stdout so `npm pack --json` output remains valid JSON");

    const restored = run(root, "restore");
    assert.equal(restored.status, 0, restored.stderr);
    for (const { target } of PAIRS) assert.deepEqual(await fs.readFile(path.join(root, target)), before.get(target), `${target} restored byte-identical`);
    await assert.rejects(fs.stat(path.join(root, BACKUP_DIR)), { code: "ENOENT" });
    assert.match(run(root, "restore").stderr, /nothing to restore/u);
  });
});

test("restore refuses a tampered backup and apply refuses a half-applied tree", async () => {
  await withFixture(async (root) => {
    assert.equal(run(root, "apply").status, 0);
    await fs.appendFile(path.join(root, BACKUP_DIR, "README.md"), "tampered\n");
    const restored = run(root, "restore");
    assert.equal(restored.status, 1);
    assert.match(restored.stderr, /does not match its recorded hash/u);
  });
  await withFixture(async (root) => {
    assert.equal(run(root, "apply").status, 0);
    await fs.writeFile(path.join(root, "README.md"), "edited while applied\n");
    const again = run(root, "apply");
    assert.equal(again.status, 1);
    assert.match(again.stderr, /run restore first/u);
  });
});

test("packing applies the npm pages and restores the GitHub pages, and the swap inputs never ship", async () => {
  assert.match(pkg.scripts.prepack, /node tools\/readme-for-npm\.mjs apply$/u);
  assert.equal(pkg.scripts.postpack, "node tools/readme-for-npm.mjs restore");
  const npmignore = (await fs.readFile(".npmignore", "utf8")).split("\n");
  for (const entry of ["README-npm.md", "README-npm-Ko-KR.md", `${BACKUP_DIR}/`, "tools/readme-for-npm.mjs"]) {
    assert.ok(npmignore.includes(entry), `.npmignore excludes ${entry}`);
  }
  assert.ok((await fs.readFile(".gitignore", "utf8")).split("\n").includes(`${BACKUP_DIR}/`), ".gitignore keeps the backup untracked");
  for (const { npm } of PAIRS) {
    assert.doesNotMatch(npm, /^readme\./iu, `${npm} must not start with "README." because npm always packs README.* files`);
  }
});
