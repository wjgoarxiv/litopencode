// Organic enrollment of the start-work autopilot and the suggestion tier: each piece is reached through the
// host entry points users touch (the OpenCode 1 plugin hooks and the OpenCode 2 server setup), and the new
// modules ship in the package build. A port that passed its unit tests but fired on nothing fails here.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { createLitOpenCodePlugin } from "../src/server.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context, until } from "../test-support/opencode-v2-fake.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planText = "# p\n\n## Todos\n\n- [ ] 1. a\n- [ ] 2. b\n\n## Done when\n\ncheck: `node check.mjs`\n";

async function withDir(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-autopilot-enroll-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  try {
    await fs.mkdir(path.join(dir, "plans"));
    await fs.writeFile(path.join(dir, "plans", "p.md"), planText);
    await fs.writeFile(path.join(dir, "check.mjs"), "process.exit(0);\n");
    await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const tickAll = (dir) => fs.writeFile(path.join(dir, "plans", "p.md"), planText.replaceAll("- [ ]", "- [x]"));

test("OpenCode 1: typed start-work attaches the autopilot, bash is parked, lit approve x answers, and idle closes the run", async () => {
  await withDir(async (dir) => {
    const prompts = [];
    const toasts = [];
    const client = {
      session: {
        get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }),
        promptAsync: async (input) => { prompts.push(input); return { data: {} }; }
      },
      tui: { showToast: async (input) => { toasts.push(input.body); return { data: true }; } }
    };
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
    const send = async (text, id) => {
      const output = { message: { id, sessionID: "ses_owner", role: "user" }, parts: [{ id: `p_${id}`, sessionID: "ses_owner", messageID: id, type: "text", text }] };
      await hooks["chat.message"]({ sessionID: "ses_owner", messageID: id, agent: "build" }, output);
      return output.parts.slice(1).map((part) => part.text).join("\n");
    };
    try {
      assert.match(await send("start-work plans/p.md", "m1"), /Autopilot is on for this run/u);
      await assert.rejects(
        hooks["tool.execute.before"]({ tool: "bash", sessionID: "ses_owner", callID: "c1" }, { args: { command: "git push origin main" } }),
        /parked \[X\] `git push origin main`/u
      );
      assert.ok(toasts.some((toast) => /Parked \[X\]/u.test(toast.message)), "the park ping reaches the TUI");
      await hooks["tool.execute.before"]({ tool: "bash", sessionID: "ses_owner", callID: "c2" }, { args: { command: "cat plans/p.md" } });
      await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_owner" } } });
      assert.match(prompts.at(-1).body.parts[0].text, /Continue the start-work run/u, "the driver continues the turn");
      assert.match(await send("lit approve x ", "m2"), /not the exact answer/u);
      await tickAll(dir);
      await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_owner" } } });
      const inbox = prompts.at(-1);
      assert.equal(inbox.body.noReply, true, "the inbox is shown without asking the model for a reply");
      assert.match(inbox.body.parts[0].text, /^LitOpenCode start-work \(wrap-up\)/u);
      assert.equal((await createBoundedAuthorityLifecycle(dir).read()).status, "active", "an outward parked step keeps the run open");
      assert.match(await send("lit deny", "m3"), /Dropped 1 parked step/u);
      await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_owner" } } });
      assert.match(prompts.at(-1).body.parts[0].text, /^LitOpenCode start-work \(done\)/u);
      assert.equal((await createBoundedAuthorityLifecycle(dir).read()).status, "completed");
      for (const sent of prompts) assert.doesNotMatch(sent.body.parts[0].text, /lit cancel/u);
    } finally {
      await hooks.dispose();
    }
  });
});

test("OpenCode 1: a plain prompt without lit gets the suggestion note as a synthetic part", async () => {
  await withDir(async (dir) => {
    const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }) } };
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
    try {
      const output = { message: { id: "m1", sessionID: "ses_a", role: "user" }, parts: [{ id: "p1", sessionID: "ses_a", messageID: "m1", type: "text", text: "plot this csv" }] };
      await hooks["chat.message"]({ sessionID: "ses_a", messageID: "m1", agent: "build" }, output);
      const added = output.parts.slice(1);
      assert.equal(added.length, 1);
      assert.equal(added[0].synthetic, true);
      assert.match(added[0].text, /- lit-scientific-visualization: /u);
    } finally {
      await hooks.dispose();
    }
  });
});

test("OpenCode 2: the shell tool is parked, the turn end drives the run, and the inbox is a synthetic message", async () => {
  await withDir(async (dir) => {
    const sessions = { ses_root: { id: "ses_root", agent: "build" } };
    const fake = createFakeV2Context({ directory: dir, sessions });
    const cleanup = await setupLitOpenCodeServer(fake.context);
    try {
      await fake.run("session", "prompt", { sessionID: "ses_root", messageID: "m1", prompt: { text: "start-work plans/p.md" }, delivery: "queue" });
      await assert.rejects(fake.run("tool", "execute.before", { tool: "shell", sessionID: "ses_root", agent: "build", messageID: "m1", id: "c1", input: { command: "git push origin main" } }), /parked \[X\]/u);
      const noticesFile = path.join(dir, ".litopencode", "notices.jsonl");
      assert.match(readFileSync(noticesFile, "utf8"), /Parked \[X\]/u, "the park ping goes to the notices file the TUI shows");
      await tickAll(dir);
      fake.emit({ type: "session.execution.succeeded", data: { sessionID: "ses_root" } });
      await until(() => fake.notices.some((notice) => /^LitOpenCode start-work \(wrap-up\)/u.test(notice.text)));
      const inbox = fake.notices.find((notice) => /^LitOpenCode start-work \(wrap-up\)/u.test(notice.text));
      assert.equal(inbox.resume, false);
      assert.equal((await createBoundedAuthorityLifecycle(dir).read()).status, "active");
    } finally {
      await cleanup();
    }
  });
});

test("the new modules ship in the build and the shipped rule set matches the gate", () => {
  for (const name of ["autopilot", "autopilot-shell", "autopilot-plan", "autopilot-hooks", "suggestion-tier"]) {
    assert.ok(existsSync(path.join(repoRoot, "src", `${name}.ts`)), name);
    assert.ok(existsSync(path.join(repoRoot, "dist", `${name}.js`)), `dist/${name}.js is built`);
  }
  const server = readFileSync(path.join(repoRoot, "src", "server.ts"), "utf8");
  const v2 = readFileSync(path.join(repoRoot, "src", "v2", "server.ts"), "utf8");
  for (const source of [server, v2]) {
    assert.match(source, /createAutopilotRuntime\(/u);
    assert.match(source, /suggestion: suggestionNote/u);
    assert.match(source, /autopilotAnswer:/u);
  }
});
