import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { migrateLegacyVendorPaths, legacyVendorPaths } from "../src/cli/vendor-path-migration.ts";

const vendorRoot = path.resolve("vendor");
const activePathFiles = [
  "skills/managed-skill-manifest.json",
  "src/activation-managed-prompts.ts",
  "skills/lit-handoff/SKILL.md",
  "skills/lit-scientific-visualization/SKILL.md",
  ".npmignore",
  "tools/check-pack-payload.mjs"
];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function withFixture(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-vendor-paths-"));
  const sourceRoot = path.join(root, "source", "vendor");
  const targetRoot = path.join(root, "target", "vendor");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });
  try {
    for (const { legacy, canonical } of legacyVendorPaths) {
      const shippedRoot = path.join(vendorRoot, canonical);
      const legacyRoot = path.join(vendorRoot, legacy);
      const source = await fs.lstat(shippedRoot).then(() => shippedRoot).catch(() => legacyRoot);
      await fs.cp(source, path.join(sourceRoot, canonical), { recursive: true });
      await fs.cp(source, path.join(targetRoot, canonical), { recursive: true });
    }
    await callback({ sourceRoot, targetRoot });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function treeDigest(root) {
  const records = [];
  async function walk(directory, relative = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(directory, entry.name);
      const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const stat = await fs.lstat(child);
      if (stat.isDirectory()) {
        records.push(`directory\0${childRelative}`);
        await walk(child, childRelative);
      } else if (stat.isFile()) {
        records.push(`file\0${childRelative}\0${digest(await fs.readFile(child))}\0${stat.mode & 0o7777}`);
      } else {
        records.push(`unsafe\0${childRelative}`);
      }
    }
  }
  await walk(root);
  return records.sort();
}

test("canonical vendor roots are present and active references use unnumbered paths", async () => {
  const manifest = JSON.parse(await fs.readFile("skills/managed-skill-manifest.json", "utf8"));
  for (const { legacy, canonical } of legacyVendorPaths) {
    assert.equal((await fs.lstat(path.join(vendorRoot, canonical))).isDirectory(), true, canonical);
    await assert.rejects(fs.lstat(path.join(vendorRoot, legacy)), { code: "ENOENT" });
    assert.equal(manifest.skills[`lit-${canonical}`]?.canonicalRoot, `../../vendor/${canonical}`);
  }
  for (const relativePath of activePathFiles) {
    const text = await fs.readFile(relativePath, "utf8");
    for (const { legacy } of legacyVendorPaths) {
      assert.doesNotMatch(text, new RegExp(`vendor/${legacy}(?:/|\\b)`, "u"), relativePath);
    }
  }
});

test("pristine manifest-owned numbered roots migrate without byte, mode, or duplicate loss", async () => {
  await withFixture(async ({ sourceRoot, targetRoot }) => {
    const before = new Map();
    for (const { legacy, canonical } of legacyVendorPaths) {
      const canonicalPath = path.join(targetRoot, canonical);
      before.set(canonical, await treeDigest(canonicalPath));
      await fs.rename(canonicalPath, path.join(targetRoot, legacy));
    }

    await migrateLegacyVendorPaths(sourceRoot, targetRoot);

    for (const { legacy, canonical } of legacyVendorPaths) {
      assert.equal((await fs.lstat(path.join(targetRoot, canonical))).isDirectory(), true, canonical);
      await assert.rejects(fs.lstat(path.join(targetRoot, legacy)), { code: "ENOENT" });
      assert.deepEqual(await treeDigest(path.join(targetRoot, canonical)), before.get(canonical));
    }
  });
});

for (const [kind, mutate] of [
  ["modified", async (root) => fs.writeFile(path.join(root, "SKILL.md"), "modified\n")],
  ["foreign", async (root) => fs.writeFile(path.join(root, "foreign.txt"), "foreign\n")],
  ["fifo", async (root) => {
    const preserved = `${root}.preserved`;
    await fs.rename(root, preserved);
    const { status } = spawnSync("mkfifo", [root], { stdio: "ignore" });
    if (status !== 0) throw new Error("mkfifo fixture creation failed");
  }],
  ["symlink", async (root) => {
    const preserved = `${root}.preserved`;
    await fs.rename(root, preserved);
    await fs.symlink(preserved, root, "dir");
  }],
  ["nonregular", async (root) => {
    const preserved = `${root}.preserved`;
    await fs.rename(root, preserved);
    await fs.writeFile(root, "not a directory\n");
  }],
  ["unsupported", async (root) => fs.symlink(path.join(root, "SKILL.md"), path.join(root, "unsupported-link"), "file")]
]) {
  if (kind === "fifo" && process.platform === "win32") continue;
  for (const { legacy, canonical } of legacyVendorPaths) {
    test(`refuses ${kind} installed ${legacy} before any replacement`, async () => {
      await withFixture(async ({ sourceRoot, targetRoot }) => {
        const canonicalPath = path.join(targetRoot, canonical);
        const legacyPath = path.join(targetRoot, legacy);
        await fs.rename(canonicalPath, legacyPath);
        await mutate(legacyPath);
        await assert.rejects(migrateLegacyVendorPaths(sourceRoot, targetRoot), /legacy|unsafe|modified|unsupported/i);
        await fs.lstat(legacyPath);
        await assert.rejects(fs.lstat(canonicalPath), { code: "ENOENT" });
      });
    });
  }
}
