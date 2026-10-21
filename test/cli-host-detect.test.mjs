import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgs } from "../src/cli/args.ts";
import { confirmUnplacedOpenCode, detectOpenCodeHosts, findCommandOnPath, resolveCommandPackage } from "../src/cli/host-detect.ts";

// OpenCode 1 (`opencode`, npm opencode-ai) and OpenCode 2 (`opencode2` or `opencode`, npm @opencode/cli)
// can sit side by side and share ~/.config/opencode. The installer and doctor need to know which are
// there, and they find out without starting either host: from the package behind each command.
async function withRoot(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-host-detect-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const packages = (map) => async (command) => map[command];

test("OpenCode 1 as opencode and OpenCode 2 as opencode2 are detected together", async () => {
  await withRoot(async (root) => {
    const result = await detectOpenCodeHosts({
      root,
      resolvePackage: packages({ opencode: { name: "opencode-ai", version: "1.19.3" }, opencode2: { name: "@opencode/cli", version: "2.0.32" } })
    });
    assert.equal(result.mode, "both");
    assert.equal(result.v1Command, "opencode");
    assert.equal(result.v2Command, "opencode2");
    assert.deepEqual(result.binaries, [
      { command: "opencode", major: 1, version: "1.19.3" },
      { command: "opencode2", major: 2, version: "2.0.32" }
    ]);
  });
});

test("an opencode command that is OpenCode 2 and no OpenCode 1 means v2 only", async () => {
  await withRoot(async (root) => {
    const result = await detectOpenCodeHosts({ root, resolvePackage: packages({ opencode: { name: "@opencode/cli", version: "2.0.32" } }) });
    assert.equal(result.mode, "v2");
    assert.equal(result.v1Command, undefined);
    assert.equal(result.v2Command, "opencode");
  });
});

test("a command is placed by following its link to the npm package; an opencode2 with no package is still OpenCode 2", async () => {
  await withRoot(async (root) => {
    const pkg = path.join(root, "lib", "node_modules", "opencode-ai");
    await fs.mkdir(path.join(pkg, "bin"), { recursive: true });
    await fs.writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "opencode-ai", version: "1.18.35" }));
    await fs.writeFile(path.join(pkg, "bin", "opencode.exe"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const bin = path.join(root, "bin");
    await fs.mkdir(bin);
    await fs.symlink(path.join(pkg, "bin", "opencode.exe"), path.join(bin, "opencode"));
    await fs.writeFile(path.join(bin, "opencode2"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const previous = process.env.PATH;
    process.env.PATH = bin;
    try {
      assert.deepEqual(await resolveCommandPackage("opencode"), { name: "opencode-ai", version: "1.18.35" });
      const result = await detectOpenCodeHosts({ root: path.join(root, "config") });
      assert.equal(result.mode, "both");
      assert.deepEqual(result.binaries.map((binary) => binary.command), ["opencode"]);
      assert.deepEqual(result.unplaced, [{ command: "opencode2", major: 2 }]);
    } finally {
      process.env.PATH = previous;
    }
  });
});

test("with no host found, config files are the evidence", async () => {
  await withRoot(async (root) => {
    const none = { resolvePackage: async () => undefined };
    assert.equal((await detectOpenCodeHosts({ root, ...none })).mode, "none");
    await fs.writeFile(path.join(root, "cli.json"), "{}");
    assert.equal((await detectOpenCodeHosts({ root, ...none })).mode, "v2");
    await fs.writeFile(path.join(root, "tui.json"), "{}");
    const both = await detectOpenCodeHosts({ root, ...none });
    assert.equal(both.mode, "both");
    assert.deepEqual(both.evidence, { cliJson: true, tuiJson: true });
  });
});

test("--host overrides detection, and only auto, v1, v2 and both are accepted", async () => {
  assert.equal(parseArgs(["install"]).host, "auto");
  for (const host of ["auto", "v1", "v2", "both"]) assert.equal(parseArgs(["install", "--host", host]).host, host);
  assert.throws(() => parseArgs(["install", "--host", "v3"]), /--host must be one of auto, v1, v2, both/u);
  assert.throws(() => parseArgs(["install", "--host"]), /--host requires a value/u);
  await withRoot(async (root) => {
    const result = await detectOpenCodeHosts({ root, resolvePackage: packages({ opencode: { name: "opencode-ai", version: "1.19.3" } }), override: "v2" });
    assert.equal(result.mode, "v2");
    assert.equal(result.override, "v2");
    assert.equal(result.v1Command, "opencode");
  });
});

// Review H1: OpenCode 1 installed outside npm (the curl installer, Homebrew, mise, a Windows shim) has no
// npm package behind `opencode`. It must keep its OpenCode 1 install next to an OpenCode 2 `opencode2`.
async function withPath(root, layout, fn) {
  const bin = path.join(root, "bin");
  await fs.mkdir(bin, { recursive: true });
  for (const [command, target] of Object.entries(layout)) {
    if (target === "script") {
      await fs.writeFile(path.join(bin, command), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      continue;
    }
    if (target.startsWith("link:")) {
      await fs.symlink(path.join(bin, target.slice(5)), path.join(bin, command));
      continue;
    }
    const pkg = path.join(root, "lib", "node_modules", ...target.split("/"));
    await fs.mkdir(path.join(pkg, "bin"), { recursive: true });
    await fs.writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: target, version: target === "opencode-ai" ? "1.19.3" : "2.0.32" }));
    await fs.writeFile(path.join(pkg, "bin", "opencode.exe"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await fs.symlink(path.join(pkg, "bin", "opencode.exe"), path.join(bin, command));
  }
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try {
    await fn();
  } finally {
    process.env.PATH = previous;
  }
}

test("an opencode outside npm next to an npm opencode2 and a tui.json means both hosts", async () => {
  await withRoot(async (root) => {
    const config = path.join(root, "config");
    await fs.mkdir(config);
    await fs.writeFile(path.join(config, "tui.json"), "{}");
    await withPath(root, { opencode: "script", opencode2: "@opencode/cli" }, async () => {
      const result = await detectOpenCodeHosts({ root: config });
      assert.equal(result.mode, "both");
      assert.equal(result.v1Command, "opencode");
      assert.equal(result.v2Command, "opencode2");
    });
  });
});

test("an opencode outside npm with only a cli.json is not taken for OpenCode 2 only", async () => {
  await withRoot(async (root) => {
    const config = path.join(root, "config");
    await fs.mkdir(config);
    await fs.writeFile(path.join(config, "cli.json"), "{}");
    await withPath(root, { opencode: "script" }, async () => {
      const result = await detectOpenCodeHosts({ root: config });
      assert.notEqual(result.mode, "v2");
      assert.equal(result.v1Command, "opencode");
    });
  });
});

test("an opencode outside npm that is the same file as opencode2 is OpenCode 2, never OpenCode 1", async () => {
  await withRoot(async (root) => {
    await withPath(root, { opencode2: "script", opencode: "link:opencode2" }, async () => {
      const result = await detectOpenCodeHosts({ root: path.join(root, "config") });
      assert.equal(result.mode, "v2");
      assert.equal(result.v1Command, undefined);
    });
  });
});

test("on Windows a command is found through PATHEXT and an npm .cmd shim is placed by the package it names", async () => {
  await withRoot(async (root) => {
    const bin = path.join(root, "npm");
    const pkg = path.join(bin, "node_modules", "opencode-ai");
    await fs.mkdir(pkg, { recursive: true });
    await fs.writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "opencode-ai", version: "1.19.3" }));
    await fs.writeFile(path.join(bin, "opencode.cmd"), '@ECHO off\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n', { mode: 0o755 });
    const env = { PATH: bin, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    assert.equal(findCommandOnPath("opencode", env, "win32"), path.join(bin, "opencode.cmd"));
    assert.deepEqual(await resolveCommandPackage("opencode", env, "win32"), { name: "opencode-ai", version: "1.19.3" });
  });
});

// Review round 2, N1: only OpenCode 2 ships `opencode2`, so one on PATH is OpenCode 2 even when no npm package
// stands behind it and it is not the same file as `opencode`.
test("an opencode2 outside npm counts as OpenCode 2, also when it is a separate file", async () => {
  await withRoot(async (root) => {
    await withPath(root, { opencode2: "script" }, async () => {
      const only = await detectOpenCodeHosts({ root: path.join(root, "config") });
      assert.equal(only.v2Command, "opencode2");
      assert.equal(only.mode, "v2");
    });
  });
  await withRoot(async (root) => {
    await withPath(root, { opencode: "script", opencode2: "script" }, async () => {
      const pair = await detectOpenCodeHosts({ root: path.join(root, "config") });
      assert.equal(pair.v2Command, "opencode2");
      assert.deepEqual(pair.unplaced, [{ command: "opencode", major: 1 }, { command: "opencode2", major: 2 }]);
    });
  });
});

test("N1: an opencode outside npm that answers 2.x is confirmed as OpenCode 2 before anything runs it", async () => {
  await withRoot(async (root) => {
    await withPath(root, { opencode: "script" }, async () => {
      const guessed = await detectOpenCodeHosts({ root: path.join(root, "config") });
      assert.equal(guessed.mode, "v1");
      const asked = [];
      const confirmed = await confirmUnplacedOpenCode(guessed, async (command) => {
        asked.push(command);
        return "2.0.32";
      });
      assert.deepEqual(asked, ["opencode"]);
      assert.equal(confirmed.mode, "v2");
      assert.equal(confirmed.v1Command, undefined);
      assert.equal(confirmed.v2Command, "opencode");
      const v1 = await confirmUnplacedOpenCode(guessed, async () => "1.18.35");
      assert.equal(v1.mode, "v1");
      const unknown = await confirmUnplacedOpenCode(guessed, async () => undefined);
      assert.equal(unknown.mode, "v1", "an unreadable version keeps the OpenCode 1 guess");
    });
  });
});

test("N2: on Windows a stray package.json above the npm folder does not hide the shim's package", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "my-dotfiles", version: "0.0.1" }));
    const bin = path.join(root, "npm");
    const pkg = path.join(bin, "node_modules", "@opencode", "cli");
    await fs.mkdir(pkg, { recursive: true });
    await fs.writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "@opencode/cli", version: "2.0.32" }));
    await fs.writeFile(path.join(bin, "opencode2.cmd"), '@ECHO off\r\n"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe"   %*\r\n', { mode: 0o755 });
    const env = { PATH: bin, PATHEXT: ".CMD" };
    assert.deepEqual(await resolveCommandPackage("opencode2", env, "win32"), { name: "@opencode/cli", version: "2.0.32" });
  });
});
