#!/usr/bin/env node
// Replacement real-surface QA: named behaviours that today only the unit tests
// prove, re-proved through the surfaces this package actually ships.
//
//   update-notifier-concurrency  -> the shipped detached refresh helper
//                                   dist/cli/update-check.js, run as a real
//                                   process against an isolated HOME
//   bounded-authority-lifecycle  -> the shipped plugin API exported from
//                                   dist/index.js, against an isolated project
//   subagent-depth-one           -> the shipped OpenCode `config` hook returned
//                                   by the dist/index.js plugin factory
//
// HOME, USERPROFILE and XDG_CONFIG_HOME are redirected to a temporary directory
// for this whole process before dist is imported, so nothing reads or writes a
// live profile.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CleanupLedger, assertBuiltRuntime, createTempRoot, isolatedEnv, repoRoot } from "./qa-real-surface-harness.mjs";

const day = 24 * 60 * 60 * 1000;
const updateCheckHelper = path.join(repoRoot, "dist", "cli", "update-check.js");

function check(results, behavior, name, expected, observed, detail = "") {
  const status = expected === observed ? "PASS" : "FAIL";
  results.push({ behavior, name, expected, observed, status, detail });
  return status === "PASS";
}

async function writePrivate(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(filePath), 0o700);
  await fs.writeFile(filePath, text, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

function runRefreshHelper(homeDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [updateCheckHelper, "--refresh"], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 0));
  });
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function seedUpdateState(homeDir, { cache, lock } = {}) {
  const stateDir = path.join(homeDir, ".litopencode");
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await fs.chmod(stateDir, 0o700);
  await fs.rm(path.join(stateDir, "update-check.json"), { force: true });
  await fs.rm(path.join(stateDir, "update-check.lock"), { recursive: true, force: true });
  await fs.rm(path.join(stateDir, "update-check.transition.lock"), { recursive: true, force: true });
  if (cache !== undefined) {
    await writePrivate(path.join(stateDir, "update-check.json"), `${JSON.stringify(cache, null, 2)}\n`);
  }
  if (lock !== undefined) {
    await fs.mkdir(path.join(stateDir, "update-check.lock"), { mode: 0o700 });
    await fs.chmod(path.join(stateDir, "update-check.lock"), 0o700);
    await writePrivate(path.join(stateDir, "update-check.lock", "owner.json"), `${JSON.stringify(lock)}\n`);
  }
  return stateDir;
}

async function updateNotifierConcurrency(results, ledger) {
  const behavior = "update-notifier-concurrency";
  const home = await createTempRoot(ledger, "update-home");
  const cachePath = path.join(home, ".litopencode", "update-check.json");
  const lockPath = path.join(home, ".litopencode", "update-check.lock");
  const now = Date.now();

  // A live peer reservation blocks a second refresher even when the cache is
  // long overdue: the fresh lock, not the interval, is what stops it.
  const inFlightCache = { schemaVersion: 1, packageName: "@litfamily/litopencode", attemptedAt: now - 25 * 60 * 60 * 1000, ownerGeneration: "peer-generation" };
  await seedUpdateState(home, { cache: inFlightCache, lock: { generation: "peer-generation", acquiredAt: now } });
  await runRefreshHelper(home);
  const afterLivePeer = await readJsonIfPresent(cachePath);
  check(
    results, behavior, "live-peer-reservation-respected", "peer-generation",
    afterLivePeer?.ownerGeneration ?? "none", "fresh peer lock present, cache overdue"
  );
  check(
    results, behavior, "live-peer-lock-not-stolen", "present",
    await fs.lstat(lockPath).then(() => "present").catch(() => "absent"), ""
  );

  // The same reservation with a stale lock is taken over and completed, which
  // clears the peer generation from the cache and removes the lock.
  await seedUpdateState(home, { cache: inFlightCache, lock: { generation: "peer-generation", acquiredAt: now - 60_000 } });
  await runRefreshHelper(home);
  const afterStalePeer = await readJsonIfPresent(cachePath);
  check(results, behavior, "stale-peer-lock-taken-over", "none", afterStalePeer?.ownerGeneration ?? "none", "lock acquiredAt 60s in the past");
  check(results, behavior, "stale-peer-lock-removed", "absent", await fs.lstat(lockPath).then(() => "present").catch(() => "absent"), "");
  check(results, behavior, "takeover-committed-a-result", "committed",
    afterStalePeer !== undefined && (afterStalePeer.failedAt !== undefined || afterStalePeer.checkedAt !== undefined) ? "committed" : "none", "");

  // A lock stamped in the future is a broken clock, not a live owner.
  await seedUpdateState(home, { cache: inFlightCache, lock: { generation: "peer-generation", acquiredAt: now + 60 * 60 * 1000 } });
  await runRefreshHelper(home);
  check(results, behavior, "future-dated-lock-evicted", "absent", await fs.lstat(lockPath).then(() => "present").catch(() => "absent"), "lock acquiredAt one hour in the future");

  // A future-dated cache is never trusted: it forces a refresh and its
  // future timestamps and stale result must not survive the refresh.
  await seedUpdateState(home, {
    cache: { schemaVersion: 1, packageName: "@litfamily/litopencode", latestVersion: "9.9.9", checkedAt: now + day }
  });
  await runRefreshHelper(home);
  const afterFutureCache = await readJsonIfPresent(cachePath);
  const timestamps = [afterFutureCache?.checkedAt, afterFutureCache?.failedAt, afterFutureCache?.attemptedAt]
    .filter((value) => value !== undefined);
  check(results, behavior, "future-dated-cache-refreshed", "refreshed",
    afterFutureCache !== undefined && afterFutureCache.latestVersion !== "9.9.9" ? "refreshed" : "kept", "cache checkedAt one day in the future");
  check(results, behavior, "future-dated-timestamps-discarded", "0",
    String(timestamps.filter((value) => value > Date.now()).length), `timestamps=${timestamps.length}`);

  // Six real helper processes race from a clean state. Exactly one committed
  // result may survive, with no reservation, no lock and no temporary file left.
  await seedUpdateState(home, {});
  await Promise.all(Array.from({ length: 6 }, () => runRefreshHelper(home)));
  const afterRace = await readJsonIfPresent(cachePath);
  const residue = (await fs.readdir(path.join(home, ".litopencode"))).sort();
  check(results, behavior, "concurrent-refresh-single-cache", "update-check.json", residue.join(","), `${residue.length} state entries`);
  check(results, behavior, "concurrent-refresh-no-open-reservation", "none", afterRace?.ownerGeneration ?? "none", "");
  check(results, behavior, "concurrent-refresh-committed-once", "committed",
    afterRace !== undefined && (afterRace.failedAt !== undefined || afterRace.checkedAt !== undefined) ? "committed" : "none", "");
}

async function boundedAuthorityLifecycle(results, ledger, plugin) {
  const behavior = "bounded-authority-cas-idempotency";
  const project = await createTempRoot(ledger, "bounded-authority");
  await fs.writeFile(path.join(project, "PLAN.md"), "# QA plan\n\n- prove CAS fail-closed idempotency\n", "utf8");
  const lifecycle = plugin.createBoundedAuthorityLifecycle(project);

  check(results, behavior, "schema-version", "3", String(plugin.boundedAuthoritySchemaVersion), "public export");

  const initRequest = {
    schemaVersion: 3,
    requestId: "request/init",
    sessionID: "session/qa",
    trustedUser: true,
    expectedRevision: 0,
    planPath: "PLAN.md",
    worktree: null,
    authorized: true,
    authority: [{ action: "read", root: project }]
  };
  const applied = await lifecycle.init(initRequest);
  check(results, behavior, "init-applied", "applied|1", `${applied.outcome}|${applied.state.revision}`, "");

  const replay = await lifecycle.init(initRequest);
  check(results, behavior, "identical-replay-is-idempotent", "replayed|1", `${replay.outcome}|${replay.state.revision}`, "same requestId, same payload");

  const mutated = await lifecycle
    .init({ ...initRequest, sessionID: "session/other" })
    .then(() => "no-error")
    .catch((error) => error.name);
  check(results, behavior, "replay-id-reuse-fails-closed", "LifecycleConflictError", mutated, "same requestId, different payload");

  const terminal = await lifecycle.complete({
    schemaVersion: 3,
    requestId: "request/complete",
    workId: applied.state.workId,
    sessionID: "session/qa",
    expectedRevision: 1,
    trustedUser: true
  });
  check(results, behavior, "terminal-advances-revision", "applied|2", `${terminal.outcome}|${terminal.state.revision}`, "");

  const staleCas = await lifecycle
    .init({ ...initRequest, requestId: "request/reinit-stale", expectedRevision: 0 })
    .then(() => "no-error")
    .catch((error) => `${error.name}:${/CAS revision mismatch/u.test(error.message) ? "cas" : "other"}`);
  check(results, behavior, "stale-cas-revision-rejected", "LifecycleConflictError:cas", staleCas, "expectedRevision 0 against revision 2");

  const wrongSchema = await lifecycle
    .init({ ...initRequest, schemaVersion: 2, requestId: "request/schema-2" })
    .then(() => "no-error")
    .catch((error) => error.name);
  check(results, behavior, "non-schema-3-rejected", "LifecycleSafetyError", wrongSchema, "schemaVersion 2");

  const currentCas = await lifecycle.init({ ...initRequest, requestId: "request/reinit-current", expectedRevision: 2 });
  check(results, behavior, "current-cas-revision-accepted", "applied|3", `${currentCas.outcome}|${currentCas.state.revision}`, "");

  // Concurrent identical requests through independent lifecycle handles on the
  // same state: the file lock plus the replay receipt must collapse them into a
  // single applied mutation.
  const raceProject = await createTempRoot(ledger, "bounded-authority-race");
  await fs.writeFile(path.join(raceProject, "PLAN.md"), "# race plan\n", "utf8");
  const raceRequest = { ...initRequest, requestId: "request/race", authority: [{ action: "read", root: raceProject }] };
  const outcomes = await Promise.allSettled(
    Array.from({ length: 4 }, () => plugin.createBoundedAuthorityLifecycle(raceProject).init(raceRequest))
  );
  const appliedCount = outcomes.filter((item) => item.status === "fulfilled" && item.value.outcome === "applied").length;
  const revisions = new Set(
    outcomes.filter((item) => item.status === "fulfilled").map((item) => item.value.state.revision)
  );
  check(results, behavior, "concurrent-identical-init-applies-once", "1", String(appliedCount), `settled=${outcomes.length}`);
  check(results, behavior, "concurrent-identical-init-one-revision", "1", String(revisions.size), `revisions=${[...revisions].join(",")}`);
}

async function subagentDepthOne(results, ledger, plugin) {
  const behavior = "subagent-depth-one-containment";
  const project = await createTempRoot(ledger, "subagent");
  const hooks = await plugin.default({ directory: project, worktree: project });
  const config = {};
  await hooks.config(config);

  const agents = Object.entries(config.agent ?? {});
  const subagents = agents.filter(([, entry]) => entry?.mode === "subagent");
  const leaking = subagents.filter(([, entry]) => entry.tools?.task !== false || entry.permission?.task !== "deny");
  const primaries = agents.filter(([, entry]) => entry?.mode === "all");

  check(results, behavior, "config-hook-registered-agents", "true", String(agents.length > 0), `agents=${agents.length}`);
  check(results, behavior, "subagent-population", "true", String(subagents.length >= 2), `subagents=${subagents.length}`);
  check(results, behavior, "no-subagent-receives-task", "0", String(leaking.length), `leaking=${leaking.map(([id]) => id).join(",") || "none"}`);
  check(
    results, behavior, "host-build-and-plan-contained", "true",
    String(["build", "plan"].every((id) => config.agent?.[id]?.mode === "subagent" && config.agent[id].tools?.task === false)),
    "OpenCode built-in build/plan agents"
  );
  check(
    results, behavior, "lit-plan-task-denied", "deny",
    config.agent?.["lit-plan"]?.permission?.task ?? "none",
    `mode=${config.agent?.["lit-plan"]?.mode ?? "none"}`
  );
  check(results, behavior, "primary-agents-present", "true", String(primaries.length > 0), `primaries=${primaries.length}`);
  await hooks.dispose?.();
}

async function main() {
  assertBuiltRuntime();
  const ledger = new CleanupLedger();
  const results = [];
  try {
    // Redirect the whole probe process away from the live profile before the
    // shipped runtime is imported.
    const home = await createTempRoot(ledger, "home");
    await fs.mkdir(path.join(home, "config"), { recursive: true });
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.XDG_CONFIG_HOME = path.join(home, "config");
    if (path.resolve(os.homedir()) !== path.resolve(home)) {
      throw new Error(`refusing to run: os.homedir() is ${os.homedir()} and not the isolated ${home}`);
    }

    const plugin = await import(pathToFileURL(path.join(repoRoot, "dist", "index.js")).href);
    await updateNotifierConcurrency(results, ledger);
    await boundedAuthorityLifecycle(results, ledger, plugin);
    await subagentDepthOne(results, ledger, plugin);
  } finally {
    await ledger.removeAll();
  }

  process.stdout.write("BEHAVIOR REPLACEMENT PROBES (replacement real-surface QA)\n");
  for (const item of results) {
    process.stdout.write(
      `BEHAVIOR ${item.behavior} ${item.name.padEnd(38)} expected=${item.expected} observed=${item.observed} status=${item.status}` +
      `${item.detail === "" ? "" : ` detail=${item.detail}`}\n`
    );
  }
  for (const behavior of [...new Set(results.map((item) => item.behavior))]) {
    const failed = results.filter((item) => item.behavior === behavior && item.status !== "PASS");
    process.stdout.write(`BEHAVIOR-VERDICT ${behavior} ${failed.length === 0 ? "REPLACED" : "NOT-REPLACED"} failures=${failed.length}\n`);
  }
  process.stdout.write(`${ledger.render("behavior-replacement-probes")}\n`);

  const failures = results.filter((item) => item.status !== "PASS");
  process.stdout.write(`SUMMARY checks=${results.length} passing=${results.length - failures.length} failing=${failures.length} cleanup-incomplete=${ledger.incomplete.length}\n`);
  if (failures.length > 0 || ledger.incomplete.length > 0) {
    process.stdout.write("BEHAVIOR REPLACEMENT PROBES FAILED\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("BEHAVIOR REPLACEMENT PROBES PASSED\n");
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`BEHAVIOR_PROBE_ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
