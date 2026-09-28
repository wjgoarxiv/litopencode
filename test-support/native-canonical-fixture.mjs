import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function importInstalledPalette({ root, env, project }, t) {
  const wrapperRoot = path.join(root, "skills", "lit-scientific-visualization");
  const wrapper = await fs.readFile(path.join(wrapperRoot, "SKILL.md"), "utf8");
  const declared = /^exact_source_root: (.+)$/m.exec(wrapper)?.[1];
  assert.ok(declared);
  const canonical = path.resolve(wrapperRoot, declared);
  const pythonEnv = { ...env, PATH: process.env.PATH, PYTHONNOUSERSITE: "1" };
  delete pythonEnv.PYTHONDONTWRITEBYTECODE;
  delete pythonEnv.PYTHONPYCACHEPREFIX;
  const result = spawnSync(process.env.LITOPENCODE_SCIENTIFIC_PYTHON?.trim() || "python3", [
    "-c",
    "import sys, json; sys.path.insert(0, sys.argv[1]); import color_palettes; print(json.dumps({'cache': color_palettes.__cached__, 'dont_write': sys.dont_write_bytecode, 'cache_prefix': sys.pycache_prefix}))",
    path.join(canonical, "assets")
  ], { cwd: project, env: pythonEnv, encoding: "utf8", timeout: 15000 });
  if (result.error?.code === "ENOENT") {
    t.skip("Python is optional; native ordinary-import proof requires an available interpreter");
    return null;
  }
  assert.equal(result.status, 0, result.stderr);
  const imported = JSON.parse(result.stdout);
  assert.equal(imported.dont_write, false);
  assert.equal(imported.cache_prefix, null);
  assert.equal(path.dirname(imported.cache), path.join(canonical, "assets", "__pycache__"));
  const bytes = await fs.readFile(imported.cache);
  assert.ok(bytes.length > 0, "ordinary import must write actual bytecode");
  return { canonical, cache: imported.cache, bytes };
}

export async function assertRetainedCaches(root, canonical, expected) {
  const parent = path.join(root, ".litopencode-canonical-backups");
  const names = await fs.readdir(parent);
  assert.equal(names.length, 1, "one immutable backup container per cache-bearing replacement");
  const container = path.join(parent, names[0]);
  const receipt = JSON.parse(await fs.readFile(path.join(container, "receipt.json"), "utf8"));
  assert.equal(receipt.state, "retained");
  assert.equal(receipt.backup, path.join(container, "skill"));
  const records = expected.map(({ path: file, bytes }) => ({
    path: path.relative(canonical, file).split(path.sep).join("/"),
    sha256: createHash("sha256").update(bytes).digest("hex")
  })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual([...receipt.caches].sort((a, b) => a.path.localeCompare(b.path)), records);
  for (const { path: file, bytes } of expected) {
    assert.deepEqual(await fs.readFile(path.join(receipt.backup, "canonical", path.relative(canonical, file))), bytes);
    await assert.rejects(fs.lstat(file), { code: "ENOENT" });
  }
  return receipt;
}
