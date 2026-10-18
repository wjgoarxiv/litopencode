import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgs } from "../src/cli/args.ts";

const autoUpdate = await import("../src/cli/auto-update.ts");
const npmTokenName = "NPM_" + "TOKEN";

function interactive(argv = ["doctor"], env = {}) {
  return {
    argv,
    exitCode: 0,
    env,
    stdinIsTTY: true,
    stdoutIsTTY: true,
    stderrIsTTY: true
  };
}

async function withFixture(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-auto-update-"));
  const root = path.join(home, "xdg", "opencode");
  await fs.mkdir(root, { recursive: true });
  try {
    await fn({ home, root });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

test("automatic update is default-on but respects new and legacy opt-out precedence", () => {
  assert.equal(parseArgs(["doctor", "--no-auto-update"]).command, "doctor");
  assert.ok(autoUpdate.autoUpdateInstallLockStaleMs > autoUpdate.autoUpdateTransactionBoundMs);
  assert.equal(autoUpdate.autoUpdateTransactionBoundMs, autoUpdate.autoUpdateTimeoutMs * 3);
  assert.equal(autoUpdate.isAutoUpdateDisabled({}), false);
  assert.equal(autoUpdate.isAutoUpdateDisabled({ LITOPENCODE_NO_AUTO_UPDATE: "1" }), true);
  assert.equal(autoUpdate.isAutoUpdateDisabled({ NO_UPDATE_NOTIFIER: "1" }), true);
  assert.equal(autoUpdate.isAutoUpdateDisabled({ LITOPENCODE_NO_UPDATE_CHECK: "1" }), true);
  assert.equal(autoUpdate.isAutoUpdateDisabled({ LITOPENCODE_NO_AUTO_UPDATE: "0" }), true);

  assert.equal(autoUpdate.shouldRunInteractiveAutoUpdate(interactive()), true);
  for (const blocked of [
    interactive(["doctor", "--json"]),
    interactive(["doctor", "--no-auto-update"]),
    interactive(["install", "--dry-run"]),
    interactive(["help"]),
    interactive(["doctor"], { CI: "1" }),
    { ...interactive(), stdinIsTTY: false },
    { ...interactive(), stdoutIsTTY: false },
    { ...interactive(), stderrIsTTY: false },
    interactive(["doctor"], { LITOPENCODE_NO_AUTO_UPDATE: "1" }),
    interactive(["doctor"], { NO_UPDATE_NOTIFIER: "1" })
  ]) {
    assert.equal(autoUpdate.shouldRunInteractiveAutoUpdate(blocked), false, JSON.stringify(blocked));
  }
});

test("a live transaction lock is not stolen inside the full bounded transaction horizon", async () => {
  await withFixture(async ({ home, root }) => {
    const state = path.join(home, ".litopencode");
    await fs.mkdir(state, { recursive: true, mode: 0o700 });
    const lockPath = autoUpdate.autoUpdateInstallLockPath(home);
    const acquiredAt = Date.now() - autoUpdate.autoUpdateInstallLockStaleMs + 10_000;
    await fs.writeFile(lockPath, JSON.stringify({ token: "live-owner", acquiredAt }) + "\n", { encoding: "utf8", mode: 0o600 });

    let commandCalled = false;
    const result = await autoUpdate.runAutoUpdate({
      reason: "management",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand: async () => {
        commandCalled = true;
        throw new Error("a live lock must prevent transaction commands");
      }
    });

    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "install-lock-busy");
    assert.equal(commandCalled, false);
    assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), { token: "live-owner", acquiredAt });
  });
});

test("a genuinely stale transaction lock is recovered before a new update", async () => {
  await withFixture(async ({ home, root }) => {
    const state = path.join(home, ".litopencode");
    await fs.mkdir(state, { recursive: true, mode: 0o700 });
    const lockPath = autoUpdate.autoUpdateInstallLockPath(home);
    await fs.writeFile(
      lockPath,
      JSON.stringify({ token: "dead-owner", acquiredAt: Date.now() - autoUpdate.autoUpdateInstallLockStaleMs - 1_000 }) + "\n",
      { encoding: "utf8", mode: 0o600 }
    );

    const runCommand = async (command, args) => {
      if (command === "npm") {
        const prefix = args[args.indexOf("--prefix") + 1];
        const packageRoot = path.join(prefix, "node_modules", "@litfamily/litopencode");
        await fs.mkdir(path.join(packageRoot, "bin"), { recursive: true });
        await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@litfamily/litopencode", version: "0.1.64" }));
        await fs.writeFile(path.join(packageRoot, "bin", "litopencode.cjs"), "#!/usr/bin/env node\n");
        return { stdout: "installed", stderr: "" };
      }
      if (args.includes("install")) return { stdout: "installed plugin", stderr: "" };
      return { stdout: JSON.stringify({ package: { name: "@litfamily/litopencode", version: "0.1.64" }, install: { ok: true } }), stderr: "" };
    };

    const result = await autoUpdate.runAutoUpdate({
      reason: "management",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand
    });

    assert.equal(result.status, "updated");
    await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
  });
});

test("automatic update runs an exact stable npm transaction, doctor barrier, and receipt with sanitized env", async () => {
  await withFixture(async ({ home, root }) => {
    const before = { $schema: "https://opencode.ai/config.json", plugin: ["litopencode@0.1.63", "other-plugin"] };
    await fs.writeFile(path.join(root, "opencode.json"), JSON.stringify(before, null, 2) + "\n");
    const calls = [];
    const runCommand = async (command, args, options) => {
      calls.push({ command, args: [...args], options });
      if (command === "npm") {
        const prefix = args[args.indexOf("--prefix") + 1];
        const packageRoot = path.join(prefix, "node_modules", "@litfamily/litopencode");
        await fs.mkdir(path.join(packageRoot, "bin"), { recursive: true });
        await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@litfamily/litopencode", version: "0.1.64" }));
        await fs.writeFile(path.join(packageRoot, "bin", "litopencode.cjs"), "#!/usr/bin/env node\n");
        return { stdout: "installed", stderr: "" };
      }
      if (args.includes("install")) {
        await fs.writeFile(
          path.join(root, "opencode.json"),
          JSON.stringify({ ...before, plugin: ["@litfamily/litopencode@0.1.64", "other-plugin"] }, null, 2) + "\n"
        );
        return { stdout: "installed plugin", stderr: "" };
      }
      return {
        stdout: JSON.stringify({
          package: { name: "@litfamily/litopencode", version: "0.1.64" },
          install: { ok: true }
        }),
        stderr: ""
      };
    };

    const result = await autoUpdate.runAutoUpdate({
      reason: "management",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: {
        HOME: home,
        PATH: process.env.PATH,
        [npmTokenName]: "must-not-pass",
        npm_config_userconfig: "/secret/npmrc"
      },
      fetchLatestVersion: async () => "0.1.64",
      runCommand
    });

    assert.equal(result.status, "updated");
    assert.equal(result.targetVersion, "0.1.64");
    assert.equal(result.spec, "@litfamily/litopencode@0.1.64");
    assert.equal(result.priorStateVerified, true);
    assert.equal(result.stagedStateKnown, true);
    assert.equal(autoUpdate.canContinueAfterAutoUpdate(result), true);
    assert.equal(calls[0].command, "npm");
    assert.deepEqual(calls[0].args.slice(0, 2), ["install", "--prefix"]);
    assert.ok(calls[0].args.includes("@litfamily/litopencode@0.1.64"));
    assert.equal(calls[0].options.timeout, autoUpdate.autoUpdateTimeoutMs);
    assert.equal(calls[0].options.env[npmTokenName], undefined);
    assert.equal(calls[0].options.env.npm_config_userconfig, undefined);
    assert.equal(calls[0].options.env.LITOPENCODE_AUTO_UPDATE_IN_PROGRESS, "1");
    assert.equal(JSON.parse(await fs.readFile(path.join(root, "opencode.json"), "utf8")).plugin[0], "@litfamily/litopencode@0.1.64");

    const receipt = JSON.parse(await fs.readFile(autoUpdate.autoUpdateReceiptPath(home), "utf8"));
    assert.equal(receipt.status, "updated");
    assert.equal(receipt.doctor.ok, true);
    const journal = await fs.readFile(autoUpdate.autoUpdateJournalPath(home), "utf8");
    assert.match(journal, /"event":"begin"/u);
    assert.match(journal, /"event":"doctor"/u);
    assert.match(journal, /"event":"updated"/u);
    await assert.rejects(fs.access(autoUpdate.autoUpdateInstallLockPath(home)), { code: "ENOENT" });
  });
});

test("failed post-install doctor rolls the config transaction back and leaves a recovery receipt", async () => {
  await withFixture(async ({ home, root }) => {
    const before = { $schema: "https://opencode.ai/config.json", plugin: ["litopencode@0.1.63"] };
    const configPath = path.join(root, "opencode.json");
    await fs.writeFile(configPath, JSON.stringify(before, null, 2) + "\n");
    const runCommand = async (_command, args) => {
      if (args.includes("install")) {
        await fs.writeFile(configPath, JSON.stringify({ ...before, plugin: ["@litfamily/litopencode@0.1.64"] }, null, 2) + "\n");
        return { stdout: "installed plugin", stderr: "" };
      }
      return { stdout: JSON.stringify({ package: { name: "@litfamily/litopencode", version: "0.1.64" }, install: { ok: false } }), stderr: "" };
    };

    const result = await autoUpdate.runAutoUpdate({
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand
    });

    assert.equal(result.status, "rolled-back");
    assert.equal(result.rollback.ok, true);
    assert.equal(result.priorStateVerified, true);
    assert.equal(result.stagedStateKnown, true);
    assert.equal(autoUpdate.canContinueAfterAutoUpdate(result), true);
    assert.deepEqual(JSON.parse(await fs.readFile(configPath, "utf8")), before);
    const receipt = JSON.parse(await fs.readFile(autoUpdate.autoUpdateReceiptPath(home), "utf8"));
    assert.equal(receipt.status, "rolled-back");
    assert.equal(receipt.rollback.ok, true);
    assert.equal(receipt.doctor.ok, false);
  });
});

test("failed post-install doctor restores tui.json byte-for-byte and removes a tui.jsonc the install created", async () => {
  await withFixture(async ({ home, root }) => {
    const tuiPath = path.join(root, "tui.json");
    const tuiBefore = Buffer.from('{\n  // user comment kept as written\n  "plugin": ["other-tui-plugin"],\t"theme": "x"\n}\n', "utf8");
    await fs.writeFile(path.join(root, "opencode.json"), '{"plugin":["@litfamily/litopencode@0.1.63"]}\n');
    await fs.writeFile(tuiPath, tuiBefore);
    const runCommand = async (command, args) => {
      if (command === "npm") {
        const prefix = args[args.indexOf("--prefix") + 1];
        const packageRoot = path.join(prefix, "node_modules", "@litfamily/litopencode");
        await fs.mkdir(path.join(packageRoot, "bin"), { recursive: true });
        await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@litfamily/litopencode", version: "0.1.64" }));
        await fs.writeFile(path.join(packageRoot, "bin", "litopencode.cjs"), "#!/usr/bin/env node\n");
        return { stdout: "installed", stderr: "" };
      }
      if (args.includes("install")) {
        await fs.writeFile(tuiPath, '{"plugin":["other-tui-plugin","@litfamily/litopencode@0.1.64"]}\n');
        await fs.writeFile(path.join(root, "tui.jsonc"), '{"plugin":["@litfamily/litopencode@0.1.64"]}\n');
        return { stdout: "installed plugin", stderr: "" };
      }
      return { stdout: JSON.stringify({ package: { name: "@litfamily/litopencode", version: "0.1.64" }, install: { ok: false } }), stderr: "" };
    };

    const result = await autoUpdate.runAutoUpdate({
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand
    });

    assert.equal(result.status, "rolled-back");
    assert.equal(result.rollback.ok, true);
    assert.equal(result.priorStateVerified, true);
    assert.ok((await fs.readFile(tuiPath)).equals(tuiBefore), "tui.json must be restored byte-for-byte");
    await assert.rejects(fs.access(path.join(root, "tui.jsonc")), { code: "ENOENT" });
  });
});

test("unknown staged state fails closed even after a verified rollback", async () => {
  await withFixture(async ({ home, root }) => {
    const before = { $schema: "https://opencode.ai/config.json", plugin: ["litopencode@0.1.63"] };
    const configPath = path.join(root, "opencode.json");
    await fs.writeFile(configPath, JSON.stringify(before, null, 2) + "\n");
    const runCommand = async (command, args) => {
      if (command === "npm") {
        const prefix = args[args.indexOf("--prefix") + 1];
        const packageRoot = path.join(prefix, "node_modules", "@litfamily/litopencode");
        await fs.mkdir(path.join(packageRoot, "bin"), { recursive: true });
        await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@litfamily/litopencode", version: "0.1.64" }));
        await fs.writeFile(path.join(packageRoot, "bin", "litopencode.cjs"), "#!/usr/bin/env node\n");
        return { stdout: "installed", stderr: "" };
      }
      if (args.includes("install")) {
        await fs.writeFile(configPath, JSON.stringify({ ...before, plugin: ["@litfamily/litopencode@0.1.64"] }, null, 2) + "\n");
        throw new Error("staged installer timed out after an unknown host write");
      }
      throw new Error("doctor must not run after an unknown installer state");
    };

    const result = await autoUpdate.runAutoUpdate({
      reason: "management",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand
    });

    assert.equal(result.status, "rolled-back");
    assert.equal(result.rollback.ok, true);
    assert.equal(result.priorStateVerified, true);
    assert.equal(result.stagedStateKnown, false);
    assert.equal(autoUpdate.canContinueAfterAutoUpdate(result), false);
    assert.match(autoUpdate.autoUpdateDiagnostic(result), /receipt/u);
    assert.deepEqual(JSON.parse(await fs.readFile(configPath, "utf8")), before);
  });
});

test("impossible rollback fails closed and retains the backup/receipt path", async () => {
  await withFixture(async ({ home, root }) => {
    const outside = path.join(home, "outside");
    await fs.mkdir(outside);
    const configPath = path.join(root, "opencode.json");
    await fs.writeFile(configPath, JSON.stringify({ plugin: ["litopencode@0.1.63"] }) + "\n");
    const runCommand = async (command, args) => {
      if (command === "npm") {
        const prefix = args[args.indexOf("--prefix") + 1];
        const packageRoot = path.join(prefix, "node_modules", "@litfamily/litopencode");
        await fs.mkdir(path.join(packageRoot, "bin"), { recursive: true });
        await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@litfamily/litopencode", version: "0.1.64" }));
        await fs.writeFile(path.join(packageRoot, "bin", "litopencode.cjs"), "#!/usr/bin/env node\n");
        return { stdout: "installed", stderr: "" };
      }
      if (args.includes("install")) {
        await fs.rm(root, { recursive: true, force: true });
        await fs.symlink(outside, root, "dir");
        throw new Error("installer failed after replacing the config root");
      }
      throw new Error("doctor must not run after rollback became impossible");
    };

    const result = await autoUpdate.runAutoUpdate({
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand
    });

    assert.equal(result.status, "failed");
    assert.equal(result.rollback.ok, false);
    assert.equal(result.priorStateVerified, false);
    assert.equal(autoUpdate.canContinueAfterAutoUpdate(result), false);
    assert.match(autoUpdate.autoUpdateDiagnostic(result), /Retained backup/u);
    const receipt = await autoUpdate.readAutoUpdateReceipt(home);
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.rollbackOk, false);
    assert.equal(receipt.backupRetained, true);
    assert.equal(receipt.priorStateVerified, false);
  });
});

function stagedPackageRunner(version, calls = []) {
  return async (command, args, options) => {
    calls.push({ command, args: [...args], options });
    if (command === "npm") {
      const prefix = args[args.indexOf("--prefix") + 1];
      const packageRoot = path.join(prefix, "node_modules", "@litfamily/litopencode");
      await fs.mkdir(path.join(packageRoot, "bin"), { recursive: true });
      await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@litfamily/litopencode", version }));
      await fs.writeFile(path.join(packageRoot, "bin", "litopencode.cjs"), "#!/usr/bin/env node\n");
      return { stdout: "installed", stderr: "" };
    }
    if (args.includes("install")) return { stdout: "installed plugin", stderr: "" };
    return { stdout: JSON.stringify({ package: { name: "@litfamily/litopencode", version }, install: { ok: true } }), stderr: "" };
  };
}

test("automatic update runs the staged CLI with Node, never with a Bun-compiled host binary", () => {
  // Inside OpenCode, process.execPath is the compiled host binary; handing it
  // the staged CLI prints host help and every plugin update rolls back.
  assert.equal(autoUpdate.childNodeExecutable("/usr/local/bin/node", { node: "22.22.0" }), "/usr/local/bin/node");
  assert.equal(autoUpdate.childNodeExecutable("C:\\node\\node.exe", { node: "22.22.0" }), "C:\\node\\node.exe");
  assert.equal(autoUpdate.childNodeExecutable("/opt/opencode/bin/opencode", { node: "24.3.0", bun: "1.3.0" }), "node");
  assert.equal(autoUpdate.childNodeExecutable("/opt/opencode/bin/opencode", { node: "24.3.0" }), "node");
  assert.equal(autoUpdate.childNodeExecutable("/usr/local/bin/node", { node: "24.3.0", bun: "1.3.0" }), "node");
});

test("automatic update passes the resolved Node runtime to the staged install and doctor", async () => {
  await withFixture(async ({ home, root }) => {
    const calls = [];
    const result = await autoUpdate.runAutoUpdate({
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      nodeExecutable: "/resolved/node",
      runCommand: stagedPackageRunner("0.1.64", calls)
    });

    assert.equal(result.status, "updated");
    assert.deepEqual(calls.map((call) => call.command), ["npm", "/resolved/node", "/resolved/node"]);
  });
});

test("automatic update tightens a user-owned state root left world-readable by earlier state writers", async () => {
  await withFixture(async ({ home, root }) => {
    const state = path.join(home, ".litopencode");
    await fs.mkdir(path.join(state, "litgoal"), { recursive: true });
    await fs.chmod(state, 0o755);

    const result = await autoUpdate.runAutoUpdate({
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand: stagedPackageRunner("0.1.64")
    });

    assert.equal(result.status, "updated");
    assert.equal((await fs.stat(state)).mode & 0o777, 0o700);
    assert.ok((await fs.stat(path.join(state, "litgoal"))).isDirectory());
  });
});

test("an unsafe state root skips the update before any mutation so the plugin still loads", async () => {
  await withFixture(async ({ home, root }) => {
    const elsewhere = path.join(home, "elsewhere");
    await fs.mkdir(elsewhere, { mode: 0o700 });
    await fs.symlink(elsewhere, path.join(home, ".litopencode"));
    const calls = [];

    const result = await autoUpdate.runAutoUpdate({
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand: stagedPackageRunner("0.1.64", calls)
    });

    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "state-unavailable");
    assert.equal(autoUpdate.canContinueAfterAutoUpdate(result), true);
    assert.deepEqual(calls, []);
    assert.deepEqual(await fs.readdir(elsewhere), []);
  });
});

async function writePrivateReceipt(home, fields) {
  const state = path.join(home, ".litopencode");
  await fs.mkdir(state, { recursive: true, mode: 0o700 });
  const receipt = {
    schemaVersion: 1,
    status: "rolled-back",
    reason: "plugin",
    currentVersion: "0.1.63",
    targetVersion: "0.1.64",
    spec: "@litfamily/litopencode@0.1.64",
    configRoot: path.join(home, "xdg", "opencode"),
    startedAt: Date.now() - 60_000,
    finishedAt: Date.now() - 60_000,
    journalPath: autoUpdate.autoUpdateJournalPath(home),
    backupPath: path.join(state, ".auto-update-backup-x"),
    backupRetained: true,
    priorStateVerified: true,
    stagedStateKnown: true,
    doctor: { ok: false },
    rollback: { ok: true },
    failure: { step: "npm-install", timedOut: true, missingCommand: false },
    ...fields
  };
  await fs.writeFile(autoUpdate.autoUpdateReceiptPath(home), JSON.stringify(receipt) + "\n", { encoding: "utf8", mode: 0o600 });
  return receipt;
}

test("a plugin start backs off for a day after a safe rollback of the same target", async () => {
  await withFixture(async ({ home, root }) => {
    await writePrivateReceipt(home, {});
    const calls = [];
    const options = {
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand: stagedPackageRunner("0.1.64", calls)
    };

    const result = await autoUpdate.runAutoUpdate(options);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "backoff");
    assert.equal(result.targetVersion, "0.1.64");
    assert.equal(autoUpdate.canContinueAfterAutoUpdate(result), true);
    assert.deepEqual(calls, []);
    assert.equal(autoUpdate.autoUpdateFailureBackoffMs, 24 * 60 * 60 * 1000);

    // An explicit install or doctor is the user's own request and is not held back.
    assert.equal((await autoUpdate.runAutoUpdate({ ...options, reason: "management" })).status, "updated");
  });
});

test("the backoff ends for a newer target, an old failure, or a rollback that could not be proven", async () => {
  for (const [label, fields, latest] of [
    ["newer target", {}, "0.1.65"],
    ["older than a day", { finishedAt: Date.now() - autoUpdate.autoUpdateFailureBackoffMs - 1_000 }, "0.1.64"],
    ["unknown staged state", { stagedStateKnown: false }, "0.1.64"],
    ["failed rollback", { status: "failed", rollback: { ok: false }, priorStateVerified: false }, "0.1.64"],
    ["updated receipt", { status: "updated", backupRetained: false, failure: undefined }, "0.1.64"]
  ]) {
    await withFixture(async ({ home, root }) => {
      await writePrivateReceipt(home, fields);
      const calls = [];
      const result = await autoUpdate.runAutoUpdate({
        reason: "plugin",
        homeDir: home,
        configRoot: root,
        currentVersion: "0.1.63",
        env: { HOME: home, PATH: process.env.PATH },
        fetchLatestVersion: async () => latest,
        runCommand: stagedPackageRunner(latest, calls)
      });
      assert.equal(result.status, "updated", label);
      assert.equal(calls.length, 3, label);
    });
  }
});

test("the receipt names the failed step, a timeout, and a missing command without keeping command output", async () => {
  await withFixture(async ({ home, root }) => {
    const missing = Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT", stderr: "secret-output" });
    const result = await autoUpdate.runAutoUpdate({
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand: async () => {
        throw missing;
      }
    });
    assert.equal(result.status, "rolled-back");
    const raw = await fs.readFile(autoUpdate.autoUpdateReceiptPath(home), "utf8");
    assert.deepEqual(JSON.parse(raw).failure, { step: "npm-install", timedOut: false, missingCommand: true });
    assert.doesNotMatch(raw, /secret-output/u);
    const summary = await autoUpdate.readAutoUpdateReceipt(home);
    assert.deepEqual(summary.failure, { step: "npm-install", timedOut: false, missingCommand: true });
    assert.equal(summary.targetVersion, "0.1.64");
    assert.equal(summary.currentVersion, "0.1.63");
  });

  await withFixture(async ({ home, root }) => {
    const runner = stagedPackageRunner("0.1.64");
    await autoUpdate.runAutoUpdate({
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand: async (command, args, options) => {
        if (args.includes("install") && command !== "npm") throw Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" });
        return await runner(command, args, options);
      }
    });
    const receipt = JSON.parse(await fs.readFile(autoUpdate.autoUpdateReceiptPath(home), "utf8"));
    assert.deepEqual(receipt.failure, { step: "install", timedOut: true, missingCommand: false });
  });
});

test("every plugin start leaves a private last-check record with the version that ran it", async () => {
  await withFixture(async ({ home }) => {
    const result = await autoUpdate.runPluginAutoUpdate({ homeDir: home });
    // The test runs from a git checkout, so the plugin path stops at the checkout guard.
    assert.equal(result.reason, "local-checkout");
    const checkPath = autoUpdate.autoUpdateCheckPath(home);
    assert.equal((await fs.stat(checkPath)).mode & 0o777, 0o600);
    const record = await autoUpdate.readAutoUpdateCheck(home);
    const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(record.runningVersion, pkg.version);
    assert.equal(record.status, "skipped");
    assert.equal(record.reason, "local-checkout");
    assert.equal(typeof record.at, "number");
  });

  await withFixture(async ({ home }) => {
    await autoUpdate.recordAutoUpdateCheck(home, "0.1.63", { status: "skipped", reason: "registry-unavailable", currentVersion: "0.1.63" });
    assert.equal((await autoUpdate.readAutoUpdateCheck(home)).reason, "registry-unavailable");
    // A state root that is not safe to write must never stop the plugin.
    const other = path.join(home, "other");
    await fs.mkdir(other);
    const linked = path.join(home, "linked");
    await fs.mkdir(linked);
    await fs.symlink(other, path.join(linked, ".litopencode"));
    await autoUpdate.recordAutoUpdateCheck(linked, "0.1.63", { status: "updated" });
    assert.deepEqual(await fs.readdir(other), []);
  });
});

test("a registry latest equal to the running version starts no transaction", async () => {
  await withFixture(async ({ home, root }) => {
    const calls = [];
    const result = await autoUpdate.runAutoUpdate({
      reason: "plugin",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.64",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand: stagedPackageRunner("0.1.64", calls)
    });

    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "up-to-date");
    assert.deepEqual(calls, []);
    assert.equal(await autoUpdate.readAutoUpdateReceipt(home), undefined);
  });
});

test("a post-install doctor that still reports the old version rolls the update back", async () => {
  await withFixture(async ({ home, root }) => {
    const before = { $schema: "https://opencode.ai/config.json", plugin: ["@litfamily/litopencode@0.1.63"] };
    const configPath = path.join(root, "opencode.json");
    await fs.writeFile(configPath, JSON.stringify(before, null, 2) + "\n");
    const staged = stagedPackageRunner("0.1.64");
    const runCommand = async (command, args, options) => {
      if (args.includes("doctor")) {
        return { stdout: JSON.stringify({ package: { name: "@litfamily/litopencode", version: "0.1.63" }, install: { ok: true } }), stderr: "" };
      }
      return staged(command, args, options);
    };

    const result = await autoUpdate.runAutoUpdate({
      reason: "management",
      homeDir: home,
      configRoot: root,
      currentVersion: "0.1.63",
      env: { HOME: home, PATH: process.env.PATH },
      fetchLatestVersion: async () => "0.1.64",
      runCommand
    });

    assert.equal(result.status, "rolled-back");
    const receipt = JSON.parse(await fs.readFile(autoUpdate.autoUpdateReceiptPath(home), "utf8"));
    assert.equal(receipt.doctor.ok, false);
    assert.equal(receipt.doctor.package.version, "0.1.63");
    assert.deepEqual(JSON.parse(await fs.readFile(configPath, "utf8")), before);
  });
});

test("a rollback whose restored bytes differ from the backup is not reported as verified", async () => {
  await withFixture(async ({ home, root }) => {
    const configPath = path.join(root, "opencode.json");
    await fs.writeFile(configPath, JSON.stringify({ plugin: ["@litfamily/litopencode@0.1.63"] }) + "\n");
    const runCommand = async (command, args) => {
      if (command === "npm") return stagedPackageRunner("0.1.64")(command, args);
      throw new Error("staged installer failed");
    };
    // Fault injection: the restore copy of opencode.json lands with one extra byte.
    const realCp = fs.cp;
    fs.cp = async (source, destination, options) => {
      await realCp(source, destination, options);
      if (String(source).includes(".auto-update-backup-") && destination === configPath) await fs.appendFile(configPath, " ");
    };
    let result;
    try {
      result = await autoUpdate.runAutoUpdate({
        reason: "plugin",
        homeDir: home,
        configRoot: root,
        currentVersion: "0.1.63",
        env: { HOME: home, PATH: process.env.PATH },
        fetchLatestVersion: async () => "0.1.64",
        runCommand
      });
    } finally {
      fs.cp = realCp;
    }

    assert.equal(result.status, "failed");
    assert.equal(result.priorStateVerified, false);
    assert.equal(result.rollback.ok, false);
    assert.equal(autoUpdate.canContinueAfterAutoUpdate(result), false);
    const receipt = await autoUpdate.readAutoUpdateReceipt(home);
    assert.equal(receipt.priorStateVerified, false);
    assert.equal(receipt.backupRetained, true);
  });
});
