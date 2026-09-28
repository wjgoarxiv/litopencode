import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { persistApprovedPlan, resolveLatestDurablePlan } from "../src/durable-plan.ts";
import { pluginModule } from "../src/index.ts";

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-durable-plan-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function waitForPath(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function waitForOptionalPath(filePath, timeoutMs = 1000) {
  try {
    await waitForPath(filePath, timeoutMs);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("timed out waiting for ")) return false;
    throw error;
  }
}

async function waitForAnyPath(filePaths, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const [index, filePath] of filePaths.entries()) {
      try {
        await fs.access(filePath);
        return index;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for one of ${filePaths.join(", ")}`);
}

function collectChild(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function rootSessionClient() {
  return {
    session: {
      get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } })
    }
  };
}

const approvedPlan = (overrides = {}) => ({
  schemaVersion: 1,
  slug: "session-a",
  markdown: "# Plan from session A\n\n## TODOs\n\n- [ ] 1. Keep going — Action: Resume; Output: Found plan; Verification: This test",
  approved: true,
  requestId: "save-session-a-1",
  revision: 1,
  ...overrides
});

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function savePlanArgument(request) {
  return `save-plan ${JSON.stringify(request)}`;
}

async function commandHooks(dir) {
  return pluginModule.server({
    directory: dir,
    worktree: dir,
    project: {},
    client: rootSessionClient(),
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost:4096"),
    $: {}
  });
}

test("a plan written in one process is found by the next process", async () => {
  await withTempDir(async (dir) => {
    const request = approvedPlan();
    const commandModule = new URL("../src/commands.ts", import.meta.url).href;
    const writer = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { createCommandActivationHook } from ${JSON.stringify(commandModule)};
const hook = createCommandActivationHook(process.env.LITOPENCODE_PLAN_ROOT);
const output = { parts: [] };
await hook({ command: "/start-work", sessionID: "session-a", arguments: ${JSON.stringify(savePlanArgument(request))} }, output);
if (output.parts.length !== 1 || output.parts[0].metadata?.litopencode?.operation !== "save-plan") {
  process.stderr.write(JSON.stringify(output));
  process.exit(2);
}`
      ],
      { cwd: dir, encoding: "utf8", env: { ...process.env, LITOPENCODE_PLAN_ROOT: dir } }
    );
    assert.equal(writer.status, 0, writer.stderr);

    const reader = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { resolveLatestDurablePlan } from ${JSON.stringify(new URL("../src/durable-plan.ts", import.meta.url).href)};
const plan = await resolveLatestDurablePlan(process.env.LITOPENCODE_PLAN_ROOT);
if (plan === undefined) {
  process.stderr.write("no plan\\n");
  process.exit(2);
}
process.stdout.write(plan.relativePath + "\\n" + plan.text);`
      ],
      { cwd: dir, encoding: "utf8", env: { ...process.env, LITOPENCODE_PLAN_ROOT: dir } }
    );

    assert.equal(reader.status, 0, reader.stderr);
    assert.match(reader.stdout, /\.litopencode\/plans\/session-a\.md/);
    assert.match(reader.stdout, /Plan from session A/);
  });
});

test("concurrent processes have one durable-plan writer and one blocked or replayed result", async () => {
  await withTempDir(async (dir) => {
    const commandModule = new URL("../src/commands.ts", import.meta.url).href;
    const readyA = path.join(dir, "concurrent-ready-a");
    const readyB = path.join(dir, "concurrent-ready-b");
    const release = path.join(dir, "concurrent-release");
    const workerScript = `import fs from "node:fs/promises";
const originalRename = fs.rename.bind(fs);
const readyPath = process.env.LITOPENCODE_READY;
const releasePath = process.env.LITOPENCODE_RELEASE;
async function waitForRelease() {
  while (true) {
    try {
      await fs.access(releasePath);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
fs.rename = async (...args) => {
  await fs.writeFile(readyPath, "ready", { flag: "wx" });
  await waitForRelease();
  return originalRename(...args);
};
const { createCommandActivationHook } = await import(${JSON.stringify(commandModule)});
const hook = createCommandActivationHook(process.env.LITOPENCODE_PLAN_ROOT);
const output = { parts: [] };
await hook({ command: "/start-work", sessionID: process.env.LITOPENCODE_SESSION, arguments: process.env.LITOPENCODE_ARGUMENTS }, output);
process.stdout.write(JSON.stringify(output.parts));`;
    const requests = [
      approvedPlan({ slug: "concurrent", requestId: "concurrent-a", markdown: "# Concurrent A" }),
      approvedPlan({ slug: "concurrent", requestId: "concurrent-b", markdown: "# Concurrent B" })
    ];
    const children = requests.map((request, index) => spawn(
      process.execPath,
      ["--input-type=module", "-e", workerScript],
      {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          LITOPENCODE_PLAN_ROOT: dir,
          LITOPENCODE_READY: index === 0 ? readyA : readyB,
          LITOPENCODE_RELEASE: release,
          LITOPENCODE_SESSION: `concurrent-${index}`,
          LITOPENCODE_ARGUMENTS: savePlanArgument(request)
        }
      }
    ));

    const childResults = children.map(collectChild);
    try {
      const firstReadyIndex = await waitForAnyPath([readyA, readyB]);
      await waitForOptionalPath([readyA, readyB][1 - firstReadyIndex]);
      await fs.writeFile(release, "release");
      const results = await Promise.all(childResults);
      for (const result of results) assert.equal(result.code, 0, result.stderr);
      const parts = results.map((result) => JSON.parse(result.stdout)[0]);
      const saved = parts.filter((part) => part.metadata?.litopencode?.replayed !== true && part.metadata?.litopencode?.blocked !== true);
      const blockedOrReplayed = parts.filter((part) => part.metadata?.litopencode?.blocked === true || part.metadata?.litopencode?.replayed === true);
      assert.equal(saved.length, 1, JSON.stringify(parts));
      assert.equal(blockedOrReplayed.length, 1, JSON.stringify(parts));
      const plan = await resolveLatestDurablePlan(dir);
      assert.ok(plan !== undefined);
      assert.ok(["# Concurrent A\n", "# Concurrent B\n"].includes(plan.text));
      assert.equal(await exists(path.join(dir, ".litopencode", "plans", "concurrent.md.lock")), false);
    } finally {
      await fs.writeFile(release, "release").catch(() => undefined);
      for (const child of children) {
        if (child.exitCode === null) child.kill();
      }
      await Promise.allSettled(childResults);
    }
  });
});

test("/start-work names the durable plan written by an earlier session", async () => {
  await withTempDir(async (dir) => {
    await persistApprovedPlan(
      dir,
      approvedPlan({
        slug: "handoff",
        markdown: "# Plan from an earlier session\n\n## TODOs\n\n- [ ] 1. Execute — Action: Start; Output: Work; Verification: This hook",
        requestId: "save-handoff-1"
      })
    );
    const hooks = await commandHooks(dir);
    const output = { parts: [] };
    await hooks["command.execute.before"]({ command: "/start-work", sessionID: "later-session", arguments: "" }, output);
    assert.match(output.parts[0].text, /Durable plan: \.litopencode\/plans\/handoff\.md/);
    assert.match(output.parts[0].text, /Plan from an earlier session/);
    assert.match(output.parts[0].text, /does not grant start-work authority/i);
  });
});

test("/start-work save-plan persists an explicitly approved chat plan without granting execution authority", async () => {
  await withTempDir(async (dir) => {
    const hooks = await commandHooks(dir);
    const request = approvedPlan({ slug: "chat-handoff", requestId: "chat-handoff-1" });
    const output = { parts: [] };

    await hooks["command.execute.before"]({
      command: "/start-work",
      sessionID: "writer-session",
      arguments: savePlanArgument(request)
    }, output);

    assert.equal(output.parts.length, 1);
    assert.equal(output.parts[0].metadata.litopencode.operation, "save-plan");
    assert.equal(output.parts[0].metadata.litopencode.authorityGranted, false);
    assert.match(output.parts[0].text, /Saved durable plan: \.litopencode\/plans\/chat-handoff\.md/);
    assert.match(output.parts[0].text, /does not grant start-work authority/i);
    assert.equal(await (await resolveLatestDurablePlan(dir))?.text, `${request.markdown}\n`);
    assert.equal(await exists(path.join(dir, ".litopencode", "litgoal")), false);
  });
});

test("malformed and unapproved save-plan arguments fail closed without persisting chat text", async () => {
  await withTempDir(async (dir) => {
    const hooks = await commandHooks(dir);
    const argumentsList = [
      "save-plan",
      "save-plan not-json",
      savePlanArgument(approvedPlan({ approved: false })),
      savePlanArgument(approvedPlan({ slug: "../escape" })),
      savePlanArgument(approvedPlan({ markdown: "   " }))
    ];

    for (const [index, argumentsText] of argumentsList.entries()) {
      const output = { parts: [] };
      await hooks["command.execute.before"]({
        command: "/start-work",
        sessionID: `blocked-${index}`,
        arguments: argumentsText
      }, output);
      assert.equal(output.parts.length, 1);
      assert.match(output.parts[0].text, /^BLOCKED:/u, argumentsText);
    }

    assert.equal(await resolveLatestDurablePlan(dir), undefined);
    assert.equal(await exists(path.join(dir, ".litopencode", "plans")), false);
  });
});

test("stale and repeated save-plan requests are rejected or replayed idempotently", async () => {
  await withTempDir(async (dir) => {
    const hooks = await commandHooks(dir);
    const request = approvedPlan({ slug: "repeatable", requestId: "repeatable-1" });

    const first = { parts: [] };
    await hooks["command.execute.before"]({ command: "/start-work", sessionID: "first", arguments: savePlanArgument(request) }, first);
    const beforeReplay = await fs.readFile(path.join(dir, ".litopencode", "plans", "repeatable.md"), "utf8");

    const replay = { parts: [] };
    await hooks["command.execute.before"]({ command: "/start-work", sessionID: "replay", arguments: savePlanArgument(request) }, replay);
    const afterReplay = await fs.readFile(path.join(dir, ".litopencode", "plans", "repeatable.md"), "utf8");
    assert.equal(afterReplay, beforeReplay);
    assert.equal(replay.parts[0].metadata.litopencode.replayed, true);
    assert.match(replay.parts[0].text, /already persisted|idempotent|replayed/i);

    const stale = { parts: [] };
    await hooks["command.execute.before"]({
      command: "/start-work",
      sessionID: "stale",
      arguments: savePlanArgument({
        ...request,
        markdown: "# Older replacement",
        requestId: "repeatable-0",
        revision: 1
      })
    }, stale);
    assert.match(stale.parts[0].text, /^BLOCKED:/u);
    assert.equal((await resolveLatestDurablePlan(dir))?.text, `${request.markdown}\n`);

    const conflict = { parts: [] };
    await hooks["command.execute.before"]({
      command: "/start-work",
      sessionID: "conflict",
      arguments: savePlanArgument({ ...request, markdown: "# Conflicting replay" })
    }, conflict);
    assert.match(conflict.parts[0].text, /^BLOCKED:/u);
  });
});

test("expired approved plans and malformed plan files are not resolved", async () => {
  await withTempDir(async (dir) => {
    const hooks = await commandHooks(dir);
    const expired = { parts: [] };
    await hooks["command.execute.before"]({
      command: "/start-work",
      sessionID: "expired",
      arguments: savePlanArgument(approvedPlan({
        slug: "expired",
        requestId: "expired-1",
        expiresAt: "2000-01-01T00:00:00.000Z"
      }))
    }, expired);
    assert.match(expired.parts[0].text, /^BLOCKED:/u);

    const plans = path.join(dir, ".litopencode", "plans");
    await fs.mkdir(plans, { recursive: true });
    await fs.writeFile(path.join(plans, "unapproved.md"), "# copied chat text\n");
    await fs.writeFile(path.join(plans, "malformed.md"), "<!-- litopencode-durable-plan: not-json -->\n# bad\n");
    assert.equal(await resolveLatestDurablePlan(dir), undefined);
  });
});

test("an interrupted staging file does not block the next approved save", async () => {
  await withTempDir(async (dir) => {
    const plans = path.join(dir, ".litopencode", "plans");
    await fs.mkdir(plans, { recursive: true });
    await fs.writeFile(path.join(plans, `resume.md.${process.pid}.tmp`), "partial write");

    await persistApprovedPlan(dir, approvedPlan({ slug: "resume", requestId: "resume-1" }));
    assert.equal((await resolveLatestDurablePlan(dir))?.relativePath, ".litopencode/plans/resume.md");
  });
});

test("an abandoned plan lock blocks fail-closed until it is manually removed", async () => {
  await withTempDir(async (dir) => {
    const plans = path.join(dir, ".litopencode", "plans");
    const lockPath = path.join(plans, "stale.md.lock");
    await fs.mkdir(lockPath, { recursive: true });
    await assert.rejects(
      persistApprovedPlan(dir, approvedPlan({ slug: "stale", requestId: "stale-1" })),
      /plan persistence lock is held/u
    );
    assert.equal(await exists(path.join(plans, "stale.md")), false);

    await fs.rm(lockPath, { recursive: true, force: true });
    await persistApprovedPlan(dir, approvedPlan({ slug: "stale", requestId: "stale-1" }));
    assert.equal((await resolveLatestDurablePlan(dir))?.text, `${approvedPlan().markdown}\n`);
  });
});

test("lit-plan chat activation remains planning-only and never saves its plan text", async () => {
  await withTempDir(async (dir) => {
    const hooks = await commandHooks(dir);
    const output = {
      message: { id: "msg-plan", sessionID: "session-plan", role: "user" },
      parts: [{
        id: "part-plan",
        sessionID: "session-plan",
        messageID: "msg-plan",
        type: "text",
        text: "lit plan # Plan text that must remain in chat"
      }]
    };
    await hooks["chat.message"]({ sessionID: "session-plan", messageID: "msg-plan", agent: "lit-plan" }, output);
    assert.match(output.parts.at(-1).text, /<lit-plan-mode>/u);
    assert.equal(await resolveLatestDurablePlan(dir), undefined);
    assert.equal(await exists(path.join(dir, ".litopencode", "plans")), false);
  });
});
