import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "../test-support/cli-fixture.ts";

const manifest = JSON.parse(await fs.readFile("skills/managed-skill-manifest.json", "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function withDefaultInstall(fn, customRoot = false) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "loc-closure-")));
  try {
    const root = customRoot ? path.join(home, "custom-root") : path.join(home, "config", "opencode");
    const bin = path.join(home, "bin");
    const tmp = path.join(home, "tmp");
    const project = path.join(home, "project");
    await Promise.all([root, bin, tmp, project].map((dir) => fs.mkdir(dir, { recursive: true })));
    const host = path.join(bin, "opencode");
    await fs.writeFile(host, `#!${process.execPath}
` + [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'if (process.argv[2] !== "plugin") process.exit(2);',
      'fs.writeFileSync(path.join(process.env.XDG_CONFIG_HOME, "opencode", "opencode.jsonc"), JSON.stringify({ plugin: [process.argv[3]] }));'
    ].join("\n"), { mode: 0o755 });
    const env = {
      HOME: home, TMPDIR: tmp, XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_DATA_HOME: path.join(home, "data"), XDG_STATE_HOME: path.join(home, "state"),
      XDG_CACHE_HOME: path.join(home, "cache"), PATH: bin + path.delimiter + path.dirname(process.execPath),
      NO_UPDATE_NOTIFIER: "1", LITOPENCODE_NO_AUTO_UPDATE: "1"
    };
    const cli = (args) => runCli([...args, ...(customRoot ? ["--root", root] : []), "--no-auto-update"], { cwd: project, env, timeout: 30000 });
    const install = cli(["install", "--yes"]);
    assert.equal(install.status, 0, install.stderr);
    await fn({ root, cli, env, project });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function declaredRoot(root, id) {
  const wrapperRoot = path.join(root, "skills", id);
  const wrapper = await fs.readFile(path.join(wrapperRoot, "SKILL.md"), "utf8");
  const declared = /^exact_source_root: (.+)$/m.exec(wrapper)?.[1];
  assert.ok(declared, `${id} must declare its actual canonical root`);
  const resolved = path.resolve(wrapperRoot, declared);
  assert.ok(resolved.startsWith(root + path.sep), `${id} must resolve inside the installed config root`);
  return resolved;
}

for (const id of ["lit-handoff"]) {
  test(`default XDG install resolves every declared canonical file for ${id}`, async () => {
    await withDefaultInstall(async ({ root, cli }) => {
      const canonical = await declaredRoot(root, id);
      const command = await fs.readFile(path.join(root, "command", `${id}.md`), "utf8");
      assert.match(command, /Load the native .* skill from OpenCode first/);
      assert.match(command, /exact_source_root: \.\/canonical/);
      assert.ok(!command.includes(manifest.skills[id].canonicalRoot), "command must not send the user to an absent config vendor tree");
      const assets = manifest.skills[id].canonicalFiles;
      for (const asset of assets) {
        assert.equal(hash(await fs.readFile(path.join(canonical, asset.path))), asset.sha256, asset.path);
      }
      assert.equal(cli(["install", "--yes"]).status, 0);
      for (const asset of assets) {
        assert.equal(hash(await fs.readFile(path.join(canonical, asset.path))), asset.sha256, asset.path);
      }
    });
  });

  test(`doctor rejects missing installed canonical closure for ${id} even when package source is intact`, async () => {
    await withDefaultInstall(async ({ root, cli }) => {
      const canonical = await declaredRoot(root, id);
      const asset = manifest.skills[id].canonicalFiles.find((file) => file.path !== "SKILL.md");
      await fs.rm(path.join(canonical, asset.path), { force: true });
      const doctor = cli(["doctor"]);
      const report = JSON.parse(doctor.stdout);
      assert.equal(report.install.nativeSkills.ok, false);
      assert.ok(report.install.nativeSkills.invalid.includes(id));
      assert.deepEqual(report.install.nativeSkills.sourceInvalid, []);
      assert.ok(report.install.nativeSkills.invalidAssets.some((file) => file.includes(asset.path)));
    });
  });
}

async function treeSnapshot(root) {
  const records = [];
  async function walk(directory, prefix = "") {
    for (const name of (await fs.readdir(directory)).sort()) {
      const relative = path.posix.join(prefix, name);
      const file = path.join(directory, name);
      const stat = await fs.lstat(file);
      const kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : "file";
      records.push([relative, kind, stat.mode, kind === "link" ? await fs.readlink(file) : kind === "file" ? hash(await fs.readFile(file)) : null]);
      if (kind === "directory") await walk(file, relative);
    }
  }
  await walk(root);
  return records;
}

for (const id of ["lit-handoff"]) {
  for (const mutation of ["modified", "missing", "foreign", "foreign-directory", "symlink", "root-symlink"]) {
    test(`repeat install preserves ${mutation} canonical state for ${id}`, async () => {
      await withDefaultInstall(async ({ root, cli }) => {
        const canonical = await declaredRoot(root, id);
        const file = path.join(canonical, "SKILL.md");
        if (mutation === "modified") await fs.appendFile(file, "\nPersonal edit.\n");
        if (mutation === "missing") await fs.rm(file);
        if (mutation === "foreign") await fs.writeFile(path.join(canonical, "personal.txt"), "Do not delete.\n");
        if (mutation === "foreign-directory") await fs.mkdir(path.join(canonical, "personal"));
        if (mutation === "symlink") {
          const victim = path.join(root, "external-owned-canary.txt");
          await fs.writeFile(victim, "Never follow this link.\n");
          await fs.rm(file);
          await fs.symlink(victim, file);
        }
        if (mutation === "root-symlink") {
          const victim = path.join(root, "external-owned-canonical");
          await fs.rename(canonical, victim);
          await fs.symlink(victim, canonical);
        }
        const before = await treeSnapshot(root);
        const doctor = cli(["doctor"]);
        const report = JSON.parse(doctor.stdout);
        assert.equal(report.install.nativeSkills.ok, false);
        assert.ok(report.install.nativeSkills.invalid.includes(id));
        const install = cli(["install", "--yes"]);
        assert.equal(install.status, 1, install.stderr);
        assert.match(install.stderr, /canonical|symbolic link/);
        assert.deepEqual(await treeSnapshot(root), before, "refusal must preserve all installed bytes, modes, paths, and links");
      });
    });
  }

  test(`custom-root install upgrades a flat managed ${id} wrapper without changing vendor source`, async () => {
    await withDefaultInstall(async ({ root, cli }) => {
      const canonical = await declaredRoot(root, id);
      const sourceRoot = manifest.skills[id].canonicalRoot;
      const wrapperFile = path.join(root, "skills", id, "SKILL.md");
      const wrapper = await fs.readFile(wrapperFile, "utf8");
      await fs.rm(canonical, { recursive: true });
      await fs.writeFile(wrapperFile, wrapper.replaceAll("./canonical", sourceRoot));
      assert.equal(cli(["install", "--yes"]).status, 0);
      const restored = await declaredRoot(root, id);
      for (const asset of manifest.skills[id].canonicalFiles) {
        assert.equal(hash(await fs.readFile(path.join(restored, asset.path))), asset.sha256, asset.path);
        assert.equal(hash(await fs.readFile(path.resolve("skills", id, sourceRoot, asset.path))), asset.sha256, asset.path);
      }
    }, true);
  });
}
