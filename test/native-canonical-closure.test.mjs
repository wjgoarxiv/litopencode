import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "../test-support/cli-fixture.ts";
import { importInstalledPalette, assertRetainedCaches } from "../test-support/native-canonical-fixture.mjs";
import { ensureNativeSkills } from "../src/cli/native-skill-install.ts";

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
      NO_UPDATE_NOTIFIER: "1", LITOPENCODE_NO_AUTO_UPDATE: "1", LITOPENCODE_MOTION_PREWARM: "off"
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

for (const id of ["lit-scientific-visualization", "lit-handoff"]) {
  test(`default XDG install resolves every declared canonical file for ${id}`, async () => {
    await withDefaultInstall(async ({ root, cli }) => {
      const canonical = await declaredRoot(root, id);
      const command = await fs.readFile(path.join(root, "command", `${id}.md`), "utf8");
      assert.match(command, /Load the native .* skill from OpenCode first/);
      assert.match(command, /exact_source_root: \.\/canonical/);
      assert.ok(!command.includes(manifest.skills[id].canonicalRoot), "command must not send the user to an absent config vendor tree");
      const assets = manifest.skills[id].canonicalFiles;
      if (id === "lit-scientific-visualization") assert.equal(assets.length, 16);
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

for (const id of ["lit-scientific-visualization", "lit-handoff"]) {
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

for (const operation of ["doctor", "repeat"]) {
  test(`ordinary Python import keeps scientific ${operation} usable`, async (t) => {
    await withDefaultInstall(async (fixture) => {
      const imported = await importInstalledPalette(fixture, t);
      if (imported === null) return;
      if (operation === "doctor") {
        const result = fixture.cli(["doctor"]);
        assert.equal(JSON.parse(result.stdout).install.nativeSkills.ok, true, "regular native import must not corrupt installed integrity");
        assert.deepEqual(await fs.readFile(imported.cache), imported.bytes, "doctor must not alter bytecode");
      } else {
        const result = fixture.cli(["install", "--yes"]);
        assert.equal(result.status, 0, result.stderr);
        await assertRetainedCaches(fixture.root, imported.canonical, [{ path: imported.cache, bytes: imported.bytes }]);
      }
    });
  });
}

async function addOpaqueCaches(root, names = ["color_palettes.cpython-311.pyc"]) {
  const canonical = await declaredRoot(root, "lit-scientific-visualization");
  const directory = path.join(canonical, "assets", "__pycache__");
  await fs.mkdir(directory);
  const files = [];
  for (const name of names) {
    const file = path.join(directory, name);
    const bytes = Buffer.from(`opaque, not executable Python: ${name}\0\xff`, "utf8");
    await fs.writeFile(file, bytes);
    files.push({ path: file, bytes });
  }
  return { canonical, files };
}

test("repeat retains opaque optimized and multiple interpreter cache tags with exact receipts", async () => {
  await withDefaultInstall(async ({ root, cli }) => {
    const { canonical, files } = await addOpaqueCaches(root, [
      "color_palettes.cpython-311.pyc", "color_palettes.cpython-312.opt-1.pyc", "color_palettes.pypy310.opt-2.pyc"
    ]);
    const beforeDoctor = await treeSnapshot(root);
    const doctor = JSON.parse(cli(["doctor"]).stdout);
    assert.equal(doctor.install.nativeSkills.ok, true);
    assert.equal(doctor.install.nativeSkills.canonicalCacheFiles.length, 3);
    assert.deepEqual(await treeSnapshot(root), beforeDoctor);
    const repeat = cli(["install", "--yes"]);
    assert.equal(repeat.status, 0, repeat.stderr);
    const receipt = await assertRetainedCaches(root, canonical, files);
    assert.ok(!receipt.backup.startsWith(path.join(root, "skills") + path.sep));
    assert.equal(cli(["install", "--yes"]).status, 0);
    assert.equal((await fs.readdir(path.join(root, ".litopencode-canonical-backups"))).length, 1, "cacheless repeat must not create retention backups");
  });
});

for (const mutation of ["malformed-name", "missing-source", "modified-source", "cache-parent-symlink", "backup-parent-symlink"]) {
  test(`canonical cache retention refuses ${mutation} without touching owned state`, async () => {
    await withDefaultInstall(async ({ root, cli }) => {
      const { canonical } = await addOpaqueCaches(root, mutation === "malformed-name" ? ["color_palettes.pyc"] : undefined);
      if (mutation === "missing-source") await fs.rm(path.join(canonical, "assets", "color_palettes.py"));
      if (mutation === "modified-source") await fs.appendFile(path.join(canonical, "assets", "color_palettes.py"), "\n# personal\n");
      if (mutation === "cache-parent-symlink") {
        const target = path.join(root, "outside-cache");
        await fs.rename(path.join(canonical, "assets", "__pycache__"), target);
        await fs.symlink(target, path.join(canonical, "assets", "__pycache__"));
      }
      if (mutation === "backup-parent-symlink") {
        const outside = path.join(root, "outside-backups");
        await fs.mkdir(outside);
        await fs.writeFile(path.join(outside, "personal.txt"), "preserve\n");
        await fs.symlink(outside, path.join(root, ".litopencode-canonical-backups"));
      }
      const before = await treeSnapshot(root);
      const result = cli(["install", "--yes"]);
      assert.equal(result.status, 1, result.stderr);
      assert.deepEqual(await treeSnapshot(root), before);
    });
  });
}

const sourceMetadata = { ...JSON.parse(await fs.readFile("package.json", "utf8")), packageRoot: process.cwd() };

for (const rollbackFails of [false, true]) {
  test(`canonical cache replacement stage failure ${rollbackFails ? "retains uncertain backup" : "restores the exact previous tree"}`, async (t) => {
    await withDefaultInstall(async ({ root }) => {
      const { canonical, files } = await addOpaqueCaches(root);
      const target = path.dirname(canonical);
      const before = await treeSnapshot(target);
      const rename = fs.rename.bind(fs);
      t.mock.method(fs, "rename", async (source, destination) => {
        if (destination === target && source.endsWith(".stage")) throw new Error("controlled stage rename failure");
        if (rollbackFails && destination === target && source.includes(".litopencode-canonical-backups")) throw new Error("controlled rollback failure");
        return rename(source, destination);
      });
      try {
        await assert.rejects(ensureNativeSkills(root, sourceMetadata), rollbackFails ? /rollback unsafe or failed, state unknown/ : /previous tree was restored/);
      } finally {
        t.mock.restoreAll();
      }
      const parent = path.join(root, ".litopencode-canonical-backups");
      const [name] = await fs.readdir(parent);
      const prepared = JSON.parse(await fs.readFile(path.join(parent, name, "prepared.json"), "utf8"));
      assert.equal(prepared.caches[0].sha256, hash(files[0].bytes));
      if (rollbackFails) {
        await assert.rejects(fs.stat(target), { code: "ENOENT" });
        assert.deepEqual(await treeSnapshot(prepared.backup), before);
      } else {
        assert.deepEqual(await treeSnapshot(target), before);
        await assert.rejects(fs.stat(prepared.backup), { code: "ENOENT" });
      }
    });
  });
}

test("canonical cache backup container collision never clobbers a foreign directory", async (t) => {
  await withDefaultInstall(async ({ root }) => {
    const { canonical } = await addOpaqueCaches(root);
    const before = await treeSnapshot(path.dirname(canonical));
    const mkdir = fs.mkdir.bind(fs);
    let collision;
    t.mock.method(fs, "mkdir", async (directory, options) => {
      if (path.basename(path.dirname(directory)) === ".litopencode-canonical-backups") {
        collision = directory;
        await mkdir(directory, options);
        await fs.writeFile(path.join(directory, "foreign.txt"), "do not clobber\n");
        throw Object.assign(new Error("controlled exclusive-directory collision"), { code: "EEXIST" });
      }
      return mkdir(directory, options);
    });
    try {
      await assert.rejects(ensureNativeSkills(root, sourceMetadata), /exclusive-directory collision/);
    } finally {
      t.mock.restoreAll();
    }
    assert.deepEqual(await treeSnapshot(path.dirname(canonical)), before);
    assert.equal(await fs.readFile(path.join(collision, "foreign.txt"), "utf8"), "do not clobber\n");
    await assert.rejects(fs.stat(path.join(collision, "prepared.json")), { code: "ENOENT" });
  });
});

test("canonical source drift after backup preparation refuses the move and preserves the edit", async (t) => {
  await withDefaultInstall(async ({ root }) => {
    const { canonical, files } = await addOpaqueCaches(root);
    const source = path.join(canonical, "assets", "color_palettes.py");
    const edited = Buffer.concat([await fs.readFile(source), Buffer.from("\n# concurrent personal edit\n")]);
    const write = fs.writeFile.bind(fs);
    t.mock.method(fs, "writeFile", async (file, ...args) => {
      const result = await write(file, ...args);
      if (path.basename(file) === "prepared.json") await write(source, edited);
      return result;
    });
    try {
      await assert.rejects(ensureNativeSkills(root, sourceMetadata), /modified|changed/);
    } finally {
      t.mock.restoreAll();
    }
    assert.deepEqual(await fs.readFile(source), edited);
    assert.deepEqual(await fs.readFile(files[0].path), files[0].bytes);
    const parent = path.join(root, ".litopencode-canonical-backups");
    const [name] = await fs.readdir(parent);
    await assert.rejects(fs.stat(path.join(parent, name, "skill")), { code: "ENOENT" });
  });
});

test("canonical backup parent swap refuses unsafe rollback and preserves both outside bytes and recovery tree", async (t) => {
  await withDefaultInstall(async ({ root }) => {
    const { canonical } = await addOpaqueCaches(root);
    const target = path.dirname(canonical);
    const before = await treeSnapshot(target);
    const parent = path.join(root, ".litopencode-canonical-backups");
    const movedParent = path.join(root, "retained-parent-after-swap");
    const outside = path.join(root, "outside-canary");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "personal.txt"), "never overwrite\n");
    const outsideBefore = await treeSnapshot(outside);
    const rename = fs.rename.bind(fs);
    t.mock.method(fs, "rename", async (source, destination) => {
      const result = await rename(source, destination);
      if (source === target && destination.startsWith(parent + path.sep)) {
        await rename(parent, movedParent);
        await fs.symlink(outside, parent);
      }
      return result;
    });
    try {
      await assert.rejects(ensureNativeSkills(root, sourceMetadata), /state unknown/);
    } finally {
      t.mock.restoreAll();
    }
    assert.deepEqual(await treeSnapshot(outside), outsideBefore);
    const [name] = await fs.readdir(movedParent);
    assert.deepEqual(await treeSnapshot(path.join(movedParent, name, "skill")), before);
    assert.equal(await fs.readlink(parent), outside);
    await assert.rejects(fs.stat(target), { code: "ENOENT" });
  });
});

test("ordinary cache repeat supports a config ancestor alias bound to the same real directory", async (t) => {
  await withDefaultInstall(async (fixture) => {
    const imported = await importInstalledPalette(fixture, t);
    if (imported === null) return;
    const alias = path.join(fixture.env.HOME, "config-alias");
    await fs.symlink(path.dirname(fixture.root), alias, "dir");
    const aliasedRoot = path.join(alias, path.basename(fixture.root));
    assert.equal(await fs.realpath(aliasedRoot), await fs.realpath(fixture.root));
    const result = runCli(["install", "--root", aliasedRoot, "--yes", "--no-auto-update"], {
      cwd: fixture.project, env: fixture.env, timeout: 30000
    });
    assert.equal(result.status, 0, result.stderr);
    await assertRetainedCaches(fixture.root, imported.canonical, [{ path: imported.cache, bytes: imported.bytes }]);
    assert.equal(await fs.readlink(alias), path.dirname(fixture.root));
  });
});

test("canonical retention rejects a config ancestor alias redirected after preparation", async (t) => {
  await withDefaultInstall(async ({ root, env }) => {
    const { canonical, files } = await addOpaqueCaches(root);
    const alias = path.join(env.HOME, "config-alias");
    await fs.symlink(path.dirname(root), alias, "dir");
    const aliasedRoot = path.join(alias, path.basename(root));
    const outside = path.join(env.HOME, "outside-config");
    await fs.mkdir(path.join(outside, path.basename(root)), { recursive: true });
    await fs.writeFile(path.join(outside, "personal.txt"), "untouched\n");
    const outsideBefore = await treeSnapshot(outside);
    const write = fs.writeFile.bind(fs);
    t.mock.method(fs, "writeFile", async (file, ...args) => {
      const result = await write(file, ...args);
      if (path.basename(file) === "prepared.json") {
        await fs.unlink(alias);
        await fs.symlink(outside, alias, "dir");
      }
      return result;
    });
    try {
      await assert.rejects(ensureNativeSkills(aliasedRoot, sourceMetadata), /root changed/);
    } finally {
      t.mock.restoreAll();
    }
    assert.deepEqual(await treeSnapshot(outside), outsideBefore);
    assert.deepEqual(await fs.readFile(files[0].path), files[0].bytes);
    assert.equal(await fs.readlink(alias), outside);
    assert.equal((await fs.stat(path.dirname(canonical))).isDirectory(), true);
  });
});
