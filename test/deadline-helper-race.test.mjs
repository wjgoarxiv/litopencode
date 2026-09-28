import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("deadline helper stops the POSIX group before an escaped child can appear during discovery", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX process groups are unavailable on Windows");
    return;
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-deadline-helper-race-"));
  try {
    const bin = path.join(root, "bin");
    const sentinel = path.join(root, "escaped-sentinel.txt");
    await fs.mkdir(bin);
    const fakePs = path.join(bin, "ps");
    await fs.writeFile(fakePs, "#!/bin/sh\n/bin/ps \"$@\"\n/bin/sleep 0.25\n", { mode: 0o700 });

    const grandchild = `import pathlib,time; time.sleep(0.4); pathlib.Path(${JSON.stringify(sentinel)}).write_text("escaped")`;
    const parent = `import subprocess,sys,time; time.sleep(0.1); subprocess.Popen([sys.executable,"-c",${JSON.stringify(grandchild)}], start_new_session=True); time.sleep(5)`;
    const helper = "skills/autoresearch/scripts/run_with_deadline.py";
    const result = spawnSync("python3", [helper, "0.05", "--", "python3", "-c", parent], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` }
    });

    assert.equal(result.status, 125, result.stderr);
    assert.match(result.stderr, /BLOCKED_PROCESS_TREE_CLEANUP_UNVERIFIED/iu);
    await delay(800);
    await assert.rejects(fs.stat(sentinel), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
