import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const version = JSON.parse(fsSync.readFileSync(path.resolve("package.json"), "utf8")).version;

test("packed CLI ships an import-safe detached update helper", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-update-packed-"));
  try {
    const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", dir], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(pack.status, 0, pack.stderr);
    const extract = spawnSync("tar", ["-xzf", path.join(dir, `litfamily-litopencode-${version}.tgz`), "-C", dir], {
      encoding: "utf8"
    });
    assert.equal(extract.status, 0, extract.stderr);

    const helper = path.join(dir, "package", "dist", "cli", "update-check.js");
    await fs.access(helper);
    const autoUpdate = path.join(dir, "package", "dist", "cli", "auto-update.js");
    await fs.access(autoUpdate);
    const autoUpdateModule = await import(pathToFileURL(autoUpdate).href);
    assert.equal(typeof autoUpdateModule.runAutoUpdate, "function");
    const imported = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", "await import('./package/dist/cli/update-check.js')"],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, HOME: dir, XDG_CONFIG_HOME: path.join(dir, "xdg") }
      }
    );
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "");
    assert.equal(imported.stderr, "");
    await assert.rejects(fs.access(path.join(dir, ".litopencode", "update-check.json")), { code: "ENOENT" });

    const privateRoute = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          "const helper = await import('./package/dist/cli/update-check.js');",
          "if (typeof helper.runUpdateCheckHelper !== 'function') throw new Error('missing private helper route');",
          "let calls = 0;",
          "await helper.runUpdateCheckHelper(['--refresh'], async () => { calls += 1; });",
          "await helper.runUpdateCheckHelper(['not-refresh'], async () => { calls += 100; });",
          "if (calls !== 1) throw new Error('private helper route count: ' + calls);",
          "console.log('packed-update-helper:private-refresh:injected-no-registry');"
        ].join(" ")
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, HOME: dir, XDG_CONFIG_HOME: path.join(dir, "xdg") }
      }
    );
    assert.equal(privateRoute.status, 0, privateRoute.stderr);
    assert.match(privateRoute.stdout, /^packed-update-helper:private-refresh:injected-no-registry\s*$/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
