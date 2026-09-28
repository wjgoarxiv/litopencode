import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const update = await import("../src/cli/update-notifier.ts");

async function withHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-update-review-"));
  try {
    await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

function eligibleRun(home, now, stderr, launchRefresh) {
  return {
    argv: ["doctor"],
    exitCode: 0,
    env: {},
    stdinIsTTY: true,
    stdoutIsTTY: true,
    stderrIsTTY: true,
    homeDir: home,
    currentVersion: "0.1.54",
    now,
    writeStderr: (text) => stderr.push(text),
    launchRefresh
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function interceptSafeRead(targetPath, afterRead) {
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]) !== targetPath) return handle;
    let intercepted = false;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "read") {
          return async (...readArgs) => {
            const result = await target.read(...readArgs);
            if (!intercepted) {
              intercepted = true;
              await afterRead();
            }
            return result;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  };
  return () => {
    fs.open = originalOpen;
  };
}

async function replaceTransitionOwner(home, generation = "takeover") {
  const lockPath = update.updateTransitionLockPath(home);
  await fs.rm(lockPath, { recursive: true, force: true });
  await fs.mkdir(lockPath, { mode: 0o700 });
  await fs.writeFile(
    path.join(lockPath, "owner.json"),
    `${JSON.stringify({ generation, acquiredAt: Date.now() })}\n`,
    { mode: 0o600 }
  );
}

test("future cache timestamps neither notify nor suppress refresh", async () => {
  await withHome(async (home) => {
    const now = Date.now();
    const cases = [
      { latestVersion: "0.1.99", checkedAt: now + 1 },
      { latestVersion: "0.1.99", checkedAt: now - 1, failedAt: now + 1 },
      { latestVersion: "0.1.99", checkedAt: now - 1, attemptedAt: now + 1 }
    ];

    for (const fields of cases) {
      await update.writeUpdateCacheAtomically(update.updateCachePath(home), {
        schemaVersion: 1,
        packageName: "@litfamily/litopencode",
        ...fields
      });
      const stderr = [];
      let launches = 0;
      await update.runUpdateNotifier(eligibleRun(home, now, stderr, () => {
        launches += 1;
      }));
      assert.deepEqual(stderr, [], JSON.stringify(fields));
      assert.equal(launches, 1, JSON.stringify(fields));
    }
  });
});

test("unsafe cache files and state directory metadata disable the foreground notifier", async () => {
  const validCache = {
    schemaVersion: 1,
    packageName: "@litfamily/litopencode",
    latestVersion: "0.1.99",
    checkedAt: 0
  };
  const cases = [
    {
      label: "oversized cache",
      setup: async (home) => {
        const state = path.join(home, ".litopencode");
        await fs.mkdir(state, { mode: 0o700 });
        const cachePath = update.updateCachePath(home);
        await fs.writeFile(cachePath, JSON.stringify(validCache), { mode: 0o600 });
        await fs.truncate(cachePath, 1024 * 1024);
      }
    },
    {
      label: "symlink cache",
      setup: async (home) => {
        const state = path.join(home, ".litopencode");
        await fs.mkdir(state, { mode: 0o700 });
        const target = path.join(home, "outside-cache.json");
        await fs.writeFile(target, JSON.stringify(validCache), { mode: 0o600 });
        await fs.symlink(target, update.updateCachePath(home));
      }
    },
    {
      label: "group-readable cache",
      setup: async (home) => {
        const state = path.join(home, ".litopencode");
        await fs.mkdir(state, { mode: 0o700 });
        const cachePath = update.updateCachePath(home);
        await fs.writeFile(cachePath, JSON.stringify(validCache), { mode: 0o600 });
        await fs.chmod(cachePath, 0o640);
      }
    },
    {
      label: "group-readable state directory",
      setup: async (home) => {
        const state = path.join(home, ".litopencode");
        await fs.mkdir(state, { mode: 0o700 });
        await fs.chmod(state, 0o750);
        await fs.writeFile(update.updateCachePath(home), JSON.stringify(validCache), { mode: 0o600 });
      }
    }
  ];

  for (const scenario of cases) {
    await withHome(async (home) => {
      await scenario.setup(home);
      const stderr = [];
      let launches = 0;
      await update.runUpdateNotifier(eligibleRun(home, Date.now(), stderr, () => {
        launches += 1;
      }));
      assert.deepEqual(stderr, [], scenario.label);
      assert.equal(launches, 0, scenario.label);
    });
  }
});

test("async bounded cache reads assemble deterministic short reads through EOF", async () => {
  await withHome(async (home) => {
    const cachePath = update.updateCachePath(home);
    const expected = {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      latestVersion: "0.1.53",
      checkedAt: 123
    };
    await update.writeUpdateCacheAtomically(cachePath, expected);

    const originalOpen = fs.open;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) !== cachePath) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "read") {
            return (buffer, offset, length, position) =>
              target.read(buffer, offset, Math.min(length, 7), position);
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    };
    try {
      assert.deepEqual(await update.readUpdateCache(cachePath), expected);
    } finally {
      fs.open = originalOpen;
    }
  });
});

test("async short reads cannot accept a valid JSON prefix with trailing bytes", async () => {
  await withHome(async (home) => {
    const state = path.join(home, ".litopencode");
    const cachePath = update.updateCachePath(home);
    const validPrefix = JSON.stringify({
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      latestVersion: "0.1.53",
      checkedAt: 123
    });
    await fs.mkdir(state, { mode: 0o700 });
    await fs.writeFile(cachePath, `${validPrefix}TRAILING`, { mode: 0o600 });

    const originalOpen = fs.open;
    let firstRead = true;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) !== cachePath) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "read") {
            return (buffer, offset, length, position) => {
              const limitedLength = firstRead ? Math.min(length, Buffer.byteLength(validPrefix)) : length;
              firstRead = false;
              return target.read(buffer, offset, limitedLength, position);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    };
    try {
      assert.equal(await update.readUpdateCache(cachePath), undefined);
    } finally {
      fs.open = originalOpen;
    }
  });
});

test("sync bounded ownership reads assemble deterministic short reads through EOF", async () => {
  await withHome(async (home) => {
    const originalReadSync = fsSync.readSync;
    fsSync.readSync = (descriptor, buffer, offset, length, position) =>
      originalReadSync(descriptor, buffer, offset, Math.min(length, 7), position);
    try {
      await update.refreshUpdateCache({
        homeDir: home,
        now: 123,
        fetchLatestVersion: async () => "0.1.53"
      });
      assert.deepEqual(await update.readUpdateCache(update.updateCachePath(home)), {
        schemaVersion: 1,
        packageName: "@litfamily/litopencode",
        latestVersion: "0.1.53",
        checkedAt: 123
      });
    } finally {
      fsSync.readSync = originalReadSync;
    }
  });
});

test("cache and lock-owner FIFOs are rejected without blocking", async (context) => {
  if (process.platform === "win32") {
    context.skip("FIFO semantics are unavailable on Windows");
    return;
  }

  await withHome(async (home) => {
    const state = path.join(home, ".litopencode");
    await fs.mkdir(state, { mode: 0o700 });
    const cachePath = update.updateCachePath(home);
    const cacheFifo = spawnSync("mkfifo", [cachePath], { encoding: "utf8" });
    if (cacheFifo.status !== 0) {
      context.skip(`mkfifo unavailable: ${cacheFifo.stderr}`);
      return;
    }

    const cacheProbe = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const update = await import('./src/cli/update-notifier.ts'); await update.readUpdateCache(process.argv[1]);",
        cachePath
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 500 }
    );
    assert.equal(cacheProbe.status, 0, cacheProbe.error?.message ?? cacheProbe.stderr);

    await fs.rm(cachePath, { force: true });
    const refreshLock = update.updateLockPath(home);
    await fs.mkdir(refreshLock, { mode: 0o700 });
    const ownerFifo = spawnSync("mkfifo", [path.join(refreshLock, "owner.json")], { encoding: "utf8" });
    assert.equal(ownerFifo.status, 0, ownerFifo.stderr);
    const lockProbe = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          "const update = await import('./src/cli/update-notifier.ts');",
          "await update.refreshUpdateCache({ homeDir: process.argv[1], fetchLatestVersion: async () => '0.1.53' });"
        ].join(" "),
        home
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 500 }
    );
    assert.equal(lockProbe.status, 0, lockProbe.error?.message ?? lockProbe.stderr);
  });
});

test("a symlink lock owner cannot authorize stale-lock takeover", async () => {
  await withHome(async (home) => {
    const state = path.join(home, ".litopencode");
    await fs.mkdir(state, { mode: 0o700 });
    const refreshLock = update.updateLockPath(home);
    await fs.mkdir(refreshLock, { mode: 0o700 });
    const outsideOwner = path.join(home, "outside-owner.json");
    await fs.writeFile(
      outsideOwner,
      JSON.stringify({ generation: "forged-owner", acquiredAt: 0 }),
      { mode: 0o600 }
    );
    await fs.symlink(outsideOwner, path.join(refreshLock, "owner.json"));

    let fetches = 0;
    await update.refreshUpdateCache({
      homeDir: home,
      now: Date.now(),
      fetchLatestVersion: async () => {
        fetches += 1;
        return "0.1.53";
      }
    });
    assert.equal(fetches, 0);
    assert.equal((await fs.lstat(path.join(refreshLock, "owner.json"))).isSymbolicLink(), true);
  });
});

test("unsafe refresh-lock and owner metadata cannot authorize stale-lock takeover", async () => {
  const scenarios = [
    {
      label: "group-accessible lock directory",
      setup: async (lockPath) => {
        await fs.chmod(lockPath, 0o750);
        await fs.writeFile(
          path.join(lockPath, "owner.json"),
          JSON.stringify({ generation: "unsafe-lock", acquiredAt: 0 }),
          { mode: 0o600 }
        );
      }
    },
    {
      label: "group-readable owner",
      setup: async (lockPath) => {
        const ownerPath = path.join(lockPath, "owner.json");
        await fs.writeFile(ownerPath, JSON.stringify({ generation: "unsafe-owner", acquiredAt: 0 }), {
          mode: 0o600
        });
        await fs.chmod(ownerPath, 0o640);
      }
    },
    {
      label: "oversized owner",
      setup: async (lockPath) => {
        const ownerPath = path.join(lockPath, "owner.json");
        await fs.writeFile(ownerPath, JSON.stringify({ generation: "huge-owner", acquiredAt: 0 }), {
          mode: 0o600
        });
        await fs.truncate(ownerPath, 16 * 1024);
      }
    }
  ];

  for (const scenario of scenarios) {
    await withHome(async (home) => {
      const state = path.join(home, ".litopencode");
      await fs.mkdir(state, { mode: 0o700 });
      const refreshLock = update.updateLockPath(home);
      await fs.mkdir(refreshLock, { mode: 0o700 });
      await scenario.setup(refreshLock);

      let fetches = 0;
      await update.refreshUpdateCache({
        homeDir: home,
        now: Date.now(),
        fetchLatestVersion: async () => {
          fetches += 1;
          return "0.1.53";
        }
      });
      assert.equal(fetches, 0, scenario.label);
      await fs.access(refreshLock);
    });
  }
});

test("foreign-owned cache state is rejected when ownership can be exercised", async (context) => {
  if (typeof process.getuid !== "function" || process.getuid() !== 0 || typeof process.getgid !== "function") {
    context.skip("changing ownership requires a POSIX root test process");
    return;
  }

  await withHome(async (home) => {
    const state = path.join(home, ".litopencode");
    await fs.mkdir(state, { mode: 0o700 });
    await fs.writeFile(update.updateCachePath(home), JSON.stringify({
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      latestVersion: "0.1.99",
      checkedAt: 0
    }), { mode: 0o600 });
    await fs.chown(update.updateCachePath(home), 1, process.getgid());

    const stderr = [];
    let launches = 0;
    await update.runUpdateNotifier(eligibleRun(home, Date.now(), stderr, () => {
      launches += 1;
    }));
    assert.deepEqual(stderr, []);
    assert.equal(launches, 0);
  });
});

test("attempt reservations are parsed and throttle only bounded past attempts", () => {
  const now = Date.now();
  const recent = update.parseUpdateCache({
    schemaVersion: 1,
    packageName: "@litfamily/litopencode",
    attemptedAt: now - 1
  });
  assert.deepEqual(recent, {
    schemaVersion: 1,
    packageName: "@litfamily/litopencode",
    attemptedAt: now - 1
  });
  assert.equal(update.shouldRefreshUpdateCache(recent, now), false);
  assert.equal(update.shouldRefreshUpdateCache({ ...recent, attemptedAt: now + 1 }, now), true);
  assert.equal(
    update.shouldRefreshUpdateCache({ ...recent, attemptedAt: now - update.updateCheckIntervalMs }, now),
    true
  );
});

test("concurrent refreshes coalesce behind an atomic product-owned lock", async () => {
  assert.equal(typeof update.updateLockPath, "function");
  await withHome(async (home) => {
    const now = Date.now();
    let fetches = 0;
    let startFirst;
    let finishFirst;
    const firstStarted = new Promise((resolve) => {
      startFirst = resolve;
    });
    const firstFinished = new Promise((resolve) => {
      finishFirst = resolve;
    });

    const first = update.refreshUpdateCache({
      homeDir: home,
      now,
      fetchLatestVersion: async () => {
        fetches += 1;
        startFirst();
        await firstFinished;
        return "0.1.53";
      }
    });
    await firstStarted;

    const reserved = await update.readUpdateCache(update.updateCachePath(home));
    assert.equal(reserved.attemptedAt, now);
    await fs.access(update.updateLockPath(home));

    await update.refreshUpdateCache({
      homeDir: home,
      now,
      fetchLatestVersion: async () => {
        fetches += 1;
        return "0.1.54";
      }
    });
    assert.equal(fetches, 1);

    finishFirst();
    await first;
    assert.deepEqual(await update.readUpdateCache(update.updateCachePath(home)), {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      latestVersion: "0.1.53",
      checkedAt: now
    });
    await assert.rejects(fs.access(update.updateLockPath(home)), { code: "ENOENT" });
  });
});

test("a refresh owner timestamps acquisition after transition contention", async () => {
  await withHome(async (home) => {
    const transitionPath = update.updateTransitionLockPath(home);
    const initialNow = Date.now();
    let currentNow = initialNow;
    await fs.mkdir(path.dirname(transitionPath), { mode: 0o700 });
    await fs.mkdir(transitionPath, { mode: 0o700 });
    await fs.writeFile(
      path.join(transitionPath, "owner.json"),
      `${JSON.stringify({ generation: "delayed-transition", acquiredAt: initialNow })}\n`,
      { mode: 0o600 }
    );

    const firstFetchStarted = deferred();
    const releaseFirstFetch = deferred();
    const first = update.refreshUpdateCache({
      homeDir: home,
      now: initialNow,
      clock: () => currentNow,
      fetchLatestVersion: async () => {
        firstFetchStarted.resolve();
        await releaseFirstFetch.promise;
        return "0.1.53";
      }
    });

    await delay(25);
    currentNow += update.updateLockStaleMs + 1;
    await fs.rm(transitionPath, { recursive: true, force: true });
    await firstFetchStarted.promise;

    const owner = JSON.parse(
      await fs.readFile(path.join(update.updateLockPath(home), "owner.json"), "utf8")
    );
    assert.equal(owner.acquiredAt, currentNow);

    let secondFetches = 0;
    await update.refreshUpdateCache({
      homeDir: home,
      now: currentNow,
      clock: () => currentNow,
      fetchLatestVersion: async () => {
        secondFetches += 1;
        return "0.1.54";
      }
    });
    assert.equal(secondFetches, 0);

    releaseFirstFetch.resolve();
    await first;
    assert.deepEqual(await update.readUpdateCache(update.updateCachePath(home)), {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      latestVersion: "0.1.53",
      checkedAt: currentNow
    });
  });
});

test("transition acquisition retries when the prior owner releases between EEXIST and lstat", async () => {
  await withHome(async (home) => {
    const transitionPath = update.updateTransitionLockPath(home);
    await fs.mkdir(path.dirname(transitionPath), { mode: 0o700 });
    await fs.mkdir(transitionPath, { mode: 0o700 });
    await fs.writeFile(
      path.join(transitionPath, "owner.json"),
      `${JSON.stringify({ generation: "departing-owner", acquiredAt: Date.now() })}\n`,
      { mode: 0o600 }
    );

    const originalLstat = fs.lstat;
    let transitionStats = 0;
    fs.lstat = async (...args) => {
      if (String(args[0]) === transitionPath) {
        transitionStats += 1;
        if (transitionStats === 2) {
          await fs.rm(transitionPath, { recursive: true, force: true });
        }
      }
      return originalLstat(...args);
    };
    try {
      let fetches = 0;
      await update.refreshUpdateCache({
        homeDir: home,
        now: 123,
        fetchLatestVersion: async () => {
          fetches += 1;
          return "0.1.53";
        }
      });
      assert.equal(fetches, 1);
      assert.equal((await update.readUpdateCache(update.updateCachePath(home))).latestVersion, "0.1.53");
    } finally {
      fs.lstat = originalLstat;
    }
  });
});

test("stale lock recovery refreshes and removes the abandoned owner", async () => {
  assert.equal(typeof update.updateLockPath, "function");
  assert.equal(typeof update.updateLockStaleMs, "number");
  await withHome(async (home) => {
    const now = Date.now();
    const lockPath = update.updateLockPath(home);
    await fs.mkdir(path.dirname(lockPath), { mode: 0o700 });
    await fs.mkdir(lockPath, { mode: 0o700 });
    await fs.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ token: "abandoned", acquiredAt: now - update.updateLockStaleMs - 1 }),
      { mode: 0o600 }
    );
    let fetches = 0;
    await update.refreshUpdateCache({
      homeDir: home,
      now,
      fetchLatestVersion: async () => {
        fetches += 1;
        return "0.1.53";
      }
    });
    assert.equal(fetches, 1);
    assert.equal((await update.readUpdateCache(update.updateCachePath(home))).latestVersion, "0.1.53");
    await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
  });
});

test("interrupted reservation remains a bounded throttle after stale-lock recovery", async () => {
  await withHome(async (home) => {
    const now = Date.now();
    const attemptedAt = now - 1000;
    await update.writeUpdateCacheAtomically(update.updateCachePath(home), {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      attemptedAt
    });
    const lockPath = update.updateLockPath(home);
    await fs.mkdir(lockPath, { mode: 0o700 });
    await fs.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ token: "interrupted", acquiredAt: now - update.updateLockStaleMs - 1 }),
      { mode: 0o600 }
    );
    let fetches = 0;
    await update.refreshUpdateCache({
      homeDir: home,
      now,
      fetchLatestVersion: async () => {
        fetches += 1;
        return "0.1.53";
      }
    });
    assert.equal(fetches, 0);
    assert.equal((await update.readUpdateCache(update.updateCachePath(home))).attemptedAt, attemptedAt);
    await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
  });
});

test("a stale owner failure re-reads cache and cannot erase a concurrent success", async () => {
  assert.equal(typeof update.updateLockPath, "function");
  await withHome(async (home) => {
    const base = Date.now() - update.updateCheckIntervalMs - 100;
    const newerAttempt = Date.now() - 50;
    let rejectFirst;
    let firstStartedResolve;
    const firstStarted = new Promise((resolve) => {
      firstStartedResolve = resolve;
    });
    const first = update.refreshUpdateCache({
      homeDir: home,
      now: base,
      fetchLatestVersion: () => new Promise((_resolve, reject) => {
        rejectFirst = reject;
        firstStartedResolve();
      })
    });
    await firstStarted;

    await fs.rm(update.updateLockPath(home), { recursive: true, force: true });
    await update.refreshUpdateCache({
      homeDir: home,
      now: newerAttempt,
      fetchLatestVersion: async () => "0.1.54"
    });
    rejectFirst(new Error("older request failed"));
    await first;

    const cache = await update.readUpdateCache(update.updateCachePath(home));
    assert.equal(cache.latestVersion, "0.1.54");
    assert.equal(cache.checkedAt, newerAttempt);
    assert.equal(cache.failedAt, undefined);
  });
});

test("old owner paused after the actual completion read cannot overwrite a newer commit", async () => {
  await withHome(async (home) => {
    const cachePath = update.updateCachePath(home);
    const oldNow = Date.now() - update.updateCheckIntervalMs - 100;
    const newNow = Date.now() - 10;
    const originalReadFile = fs.readFile;
    let pauseOldCompletionRead = false;
    const oldRead = deferred();
    const resumeOld = deferred();

    const restoreReadIntercept = interceptSafeRead(cachePath, async () => {
      if (pauseOldCompletionRead) {
        try {
          await originalReadFile(path.join(update.updateTransitionLockPath(home), "owner.json"), "utf8");
        } catch {
          return;
        }
        pauseOldCompletionRead = false;
        oldRead.resolve();
        await resumeOld.promise;
      }
    });

    try {
      const oldWorker = update.refreshUpdateCache({
        homeDir: home,
        now: oldNow,
        fetchLatestVersion: async () => {
          pauseOldCompletionRead = true;
          return "0.1.53";
        }
      });
      await oldRead.promise;

      await fs.rm(update.updateTransitionLockPath(home), { recursive: true, force: true });
      await update.refreshUpdateCache({
        homeDir: home,
        now: newNow,
        fetchLatestVersion: async () => "0.1.54"
      });
      assert.equal((await update.readUpdateCache(cachePath)).latestVersion, "0.1.54");

      resumeOld.resolve();
      await oldWorker;

      const finalCache = await update.readUpdateCache(cachePath);
      assert.equal(finalCache.latestVersion, "0.1.54");
      assert.equal(finalCache.checkedAt, newNow);
      assert.equal(typeof update.updateTransitionLockPath, "function");
      await assert.rejects(fs.access(update.updateLockPath(home)), { code: "ENOENT" });
      await assert.rejects(fs.access(update.updateTransitionLockPath(home)), { code: "ENOENT" });
    } finally {
      resumeOld.resolve();
      restoreReadIntercept();
    }
  });
});

test("old owner paused after its completion temp write cannot rename over a newer commit", async () => {
  await withHome(async (home) => {
    const cachePath = update.updateCachePath(home);
    const stateDirectory = path.dirname(cachePath);
    const oldNow = Date.now() - update.updateCheckIntervalMs - 100;
    const newNow = Date.now() - 10;
    const originalWriteFile = fs.writeFile;
    const oldTempWritten = deferred();
    const resumeOldRename = deferred();
    let pauseOldCompletionWrite = false;

    fs.writeFile = async (...args) => {
      const result = await originalWriteFile(...args);
      const filePath = String(args[0]);
      if (
        pauseOldCompletionWrite &&
        path.dirname(filePath) === stateDirectory &&
        path.basename(filePath).startsWith(".update-check.") &&
        filePath.endsWith(".tmp")
      ) {
        pauseOldCompletionWrite = false;
        oldTempWritten.resolve();
        await resumeOldRename.promise;
      }
      return result;
    };

    let oldWorker;
    try {
      oldWorker = update.refreshUpdateCache({
        homeDir: home,
        now: oldNow,
        fetchLatestVersion: async () => {
          pauseOldCompletionWrite = true;
          return "0.1.53";
        }
      });
      await oldTempWritten.promise;

      await fs.rm(update.updateTransitionLockPath(home), { recursive: true, force: true });
      await update.refreshUpdateCache({
        homeDir: home,
        now: newNow,
        fetchLatestVersion: async () => "0.1.54"
      });
      assert.equal((await update.readUpdateCache(cachePath)).latestVersion, "0.1.54");

      resumeOldRename.resolve();
      await oldWorker;

      const finalCache = await update.readUpdateCache(cachePath);
      assert.equal(finalCache.latestVersion, "0.1.54");
      assert.equal(finalCache.checkedAt, newNow);
      assert.deepEqual((await fs.readdir(stateDirectory)).filter((entry) => entry.endsWith(".tmp")), []);
    } finally {
      resumeOldRename.resolve();
      await Promise.allSettled([oldWorker].filter(Boolean));
      fs.writeFile = originalWriteFile;
    }
  });
});

test("a transition owner is not age-taken while paused at the completion boundary", async () => {
  await withHome(async (home) => {
    const cachePath = update.updateCachePath(home);
    const oldNow = Date.now() - update.updateCheckIntervalMs - 100;
    const newNow = Date.now() - 10;
    const originalReadFile = fs.readFile;
    const oldRead = deferred();
    const resumeOld = deferred();
    const newerFetchStarted = deferred();
    let pauseOldCompletionRead = false;

    const restoreReadIntercept = interceptSafeRead(cachePath, async () => {
      if (pauseOldCompletionRead) {
        try {
          await originalReadFile(path.join(update.updateTransitionLockPath(home), "owner.json"), "utf8");
        } catch {
          return;
        }
        pauseOldCompletionRead = false;
        oldRead.resolve();
        await resumeOld.promise;
      }
    });

    let oldWorker;
    let newerWorker;
    try {
      oldWorker = update.refreshUpdateCache({
        homeDir: home,
        now: oldNow,
        fetchLatestVersion: async () => {
          pauseOldCompletionRead = true;
          return "0.1.53";
        }
      });
      await oldRead.promise;

      const transitionOwnerPath = path.join(update.updateTransitionLockPath(home), "owner.json");
      const transitionOwner = JSON.parse(await originalReadFile(transitionOwnerPath, "utf8"));
      await fs.writeFile(
        transitionOwnerPath,
        `${JSON.stringify({ ...transitionOwner, acquiredAt: Date.now() - update.updateLockStaleMs - 1 })}\n`
      );

      newerWorker = update.refreshUpdateCache({
        homeDir: home,
        now: newNow,
        fetchLatestVersion: async () => {
          newerFetchStarted.resolve();
          return "0.1.54";
        }
      });
      const fetchedWhileOwnerWasPaused = await Promise.race([
        newerFetchStarted.promise.then(() => true),
        delay(150).then(() => false)
      ]);

      resumeOld.resolve();
      await Promise.all([oldWorker, newerWorker]);
      assert.equal(fetchedWhileOwnerWasPaused, false);
      assert.equal((await update.readUpdateCache(cachePath)).latestVersion, "0.1.54");
    } finally {
      resumeOld.resolve();
      await Promise.allSettled([oldWorker, newerWorker].filter(Boolean));
      restoreReadIntercept();
    }
  });
});

test("stale transition scheduler cannot replace a refresh owner after takeover", async () => {
  await withHome(async (home) => {
    const now = Date.now();
    const refreshLockPath = update.updateLockPath(home);
    const refreshOwnerPath = path.join(refreshLockPath, "owner.json");
    await fs.mkdir(path.dirname(refreshLockPath), { mode: 0o700 });
    await fs.mkdir(refreshLockPath, { mode: 0o700 });
    await fs.writeFile(
      refreshOwnerPath,
      `${JSON.stringify({ generation: "existing-refresh", acquiredAt: now - update.updateLockStaleMs - 1 })}\n`,
      { mode: 0o600 }
    );
    await update.writeUpdateCacheAtomically(update.updateCachePath(home), {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      attemptedAt: now
    });

    const originalReadFile = fs.readFile;
    const originalMkdir = fs.mkdir;
    const scheduleRead = deferred();
    const resumeSchedule = deferred();
    const refreshOwnerRecreated = deferred();
    let detectRefreshRecreate = false;

    const restoreReadIntercept = interceptSafeRead(refreshOwnerPath, async () => {
      try {
        await originalReadFile(path.join(update.updateTransitionLockPath(home), "owner.json"), "utf8");
      } catch {
        return;
      }
      scheduleRead.resolve();
      await resumeSchedule.promise;
    });
    fs.mkdir = async (...args) => {
      const result = await originalMkdir(...args);
      if (detectRefreshRecreate && String(args[0]) === refreshLockPath) refreshOwnerRecreated.resolve();
      return result;
    };

    let worker;
    try {
      worker = update.refreshUpdateCache({
        homeDir: home,
        now,
        fetchLatestVersion: async () => "0.1.53"
      });
      await scheduleRead.promise;
      await replaceTransitionOwner(home);
      detectRefreshRecreate = true;
      resumeSchedule.resolve();

      const recreatedAfterTakeover = await Promise.race([
        refreshOwnerRecreated.promise.then(() => true),
        delay(100).then(() => false)
      ]);
      assert.equal(recreatedAfterTakeover, false);
      assert.equal(JSON.parse(await originalReadFile(refreshOwnerPath, "utf8")).generation, "existing-refresh");
    } finally {
      resumeSchedule.resolve();
      await fs.rm(update.updateTransitionLockPath(home), { recursive: true, force: true });
      await Promise.allSettled([worker].filter(Boolean));
      restoreReadIntercept();
      fs.mkdir = originalMkdir;
    }
  });
});

test("stale transition reservation cannot write cache bytes after takeover", async () => {
  await withHome(async (home) => {
    const cachePath = update.updateCachePath(home);
    const now = Date.now();
    const initialCache = {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      failedAt: now - update.updateCheckIntervalMs
    };
    await update.writeUpdateCacheAtomically(cachePath, initialCache);
    const originalReadFile = fs.readFile;
    const originalRename = fs.rename;
    const reservationRead = deferred();
    const resumeReservation = deferred();
    const cacheRenamed = deferred();
    let pauseReservationRead = true;
    let detectCacheRename = false;

    const restoreReadIntercept = interceptSafeRead(cachePath, async () => {
      if (pauseReservationRead) {
        pauseReservationRead = false;
        reservationRead.resolve();
        await resumeReservation.promise;
      }
    });
    fs.rename = async (...args) => {
      const result = await originalRename(...args);
      if (detectCacheRename && String(args[1]) === cachePath) cacheRenamed.resolve();
      return result;
    };

    let worker;
    try {
      worker = update.refreshUpdateCache({
        homeDir: home,
        now,
        fetchLatestVersion: async () => "0.1.53"
      });
      await reservationRead.promise;
      await replaceTransitionOwner(home);
      detectCacheRename = true;
      resumeReservation.resolve();

      const renamedAfterTakeover = await Promise.race([
        cacheRenamed.promise.then(() => true),
        delay(100).then(() => false)
      ]);
      assert.equal(renamedAfterTakeover, false);
      assert.deepEqual(JSON.parse(await originalReadFile(cachePath, "utf8")), initialCache);
    } finally {
      resumeReservation.resolve();
      await fs.rm(update.updateTransitionLockPath(home), { recursive: true, force: true });
      await Promise.allSettled([worker].filter(Boolean));
      restoreReadIntercept();
      fs.rename = originalRename;
    }
  });
});

test("stale transition releaser cannot remove a newer refresh owner after takeover", async () => {
  await withHome(async (home) => {
    const now = Date.now();
    const refreshLockPath = update.updateLockPath(home);
    const refreshOwnerPath = path.join(refreshLockPath, "owner.json");
    await update.writeUpdateCacheAtomically(update.updateCachePath(home), {
      schemaVersion: 1,
      packageName: "@litfamily/litopencode",
      attemptedAt: now
    });

    const originalReadFile = fs.readFile;
    const releaseRead = deferred();
    const resumeRelease = deferred();
    let refreshOwnerReads = 0;

    const restoreReadIntercept = interceptSafeRead(refreshOwnerPath, async () => {
      refreshOwnerReads += 1;
      if (refreshOwnerReads === 2) {
        releaseRead.resolve();
        await resumeRelease.promise;
      }
    });

    let worker;
    try {
      worker = update.refreshUpdateCache({
        homeDir: home,
        now,
        fetchLatestVersion: async () => "0.1.53"
      });
      await releaseRead.promise;
      await replaceTransitionOwner(home);
      await fs.writeFile(
        refreshOwnerPath,
        `${JSON.stringify({ generation: "newer-refresh", acquiredAt: now })}\n`
      );
      resumeRelease.resolve();
      await worker;

      assert.equal(JSON.parse(await originalReadFile(refreshOwnerPath, "utf8")).generation, "newer-refresh");
    } finally {
      resumeRelease.resolve();
      await Promise.allSettled([worker].filter(Boolean));
      await fs.rm(update.updateTransitionLockPath(home), { recursive: true, force: true });
      await fs.rm(refreshLockPath, { recursive: true, force: true });
      restoreReadIntercept();
    }
  });
});

test("registry request enforces the real three-second total deadline", async () => {
  assert.equal(typeof update.requestRegistryLatestVersionWithTransport, "function");
  class HangingRequest extends EventEmitter {
    destroy(error) {
      this.destroyError = error;
      this.emit("error", error);
    }
  }
  const request = new HangingRequest();
  const startedAt = Date.now();
  await assert.rejects(
    update.requestRegistryLatestVersionWithTransport(() => request),
    /3 second total timeout/i
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 2900, `deadline fired too early: ${elapsed}ms`);
  assert.ok(elapsed < 5000, `deadline fired too late: ${elapsed}ms`);
  assert.match(request.destroyError.message, /3 second total timeout/i);
});

test("registry request deadline destroys a valid response whose body never ends", async () => {
  class HangingBodyRequest extends EventEmitter {
    destroyCalls = 0;
    destroy(error) {
      this.destroyCalls += 1;
      this.destroyError = error;
      if (error) this.emit("error", error);
    }
  }
  const request = new HangingBodyRequest();
  const response = {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {});
    }
  };

  const startedAt = Date.now();
  await assert.rejects(
    update.requestRegistryLatestVersionWithTransport((_url, _options, callback) => {
      queueMicrotask(() => callback(response));
      return request;
    }),
    /3 second total timeout/i
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 2900, `deadline fired too early: ${elapsed}ms`);
  assert.ok(elapsed < 5000, `deadline fired too late: ${elapsed}ms`);
  assert.equal(request.destroyCalls, 1);
  assert.match(request.destroyError.message, /3 second total timeout/i);
});

test("registry request destroys an invalid response before clearing its total deadline", async () => {
  class InvalidResponseRequest extends EventEmitter {
    destroyCalls = 0;
    destroy(error) {
      this.destroyCalls += 1;
      this.destroyError = error;
      if (error) this.emit("error", error);
    }
  }
  const request = new InvalidResponseRequest();
  const response = {
    statusCode: 503,
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {});
    }
  };

  await assert.rejects(
    update.requestRegistryLatestVersionWithTransport((_url, _options, callback) => {
      queueMicrotask(() => callback(response));
      return request;
    }),
    /status 200/i
  );
  assert.equal(request.destroyCalls, 1);
  assert.match(request.destroyError.message, /status 200/i);
});

test("detached launcher filters credentials, handles spawn errors, and unreferences the child", () => {
  assert.equal(typeof update.launchDetachedUpdateRefreshWith, "function");
  const child = new EventEmitter();
  let unrefCalls = 0;
  child.unref = () => {
    unrefCalls += 1;
  };
  let invocation;
  update.launchDetachedUpdateRefreshWith(
    (command, args, options) => {
      invocation = { command, args, options };
      return child;
    },
    {
      HOME: "/safe-home",
      NODE_EXTRA_CA_CERTS: "/safe-ca.pem",
      ["NPM_" + "TOKEN"]: "must-not-pass",
      npm_config_userconfig: "/secret/npmrc",
      HTTPS_PROXY: "http://credential-bearing-proxy.invalid"
    },
    "/node",
    "/package/dist/cli/update-check.js"
  );

  assert.equal(invocation.command, "/node");
  assert.deepEqual(invocation.args, ["/package/dist/cli/update-check.js", "--refresh"]);
  assert.equal(invocation.options.detached, true);
  assert.equal(invocation.options.stdio, "ignore");
  assert.deepEqual(invocation.options.env, {
    HOME: "/safe-home",
    NODE_EXTRA_CA_CERTS: "/safe-ca.pem"
  });
  assert.equal(unrefCalls, 1);
  assert.doesNotThrow(() => child.emit("error", new Error("spawn failed")));
});
