import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { adhdNextTtlMs, consumeNext, detectGoWord, nextFile, routeGo, writeNext } from "../src/adhd-next.ts";
import { createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { createLitOpenCodePlugin } from "../src/server.ts";
import { emptyStack, pauseSpine, startSpine, writeStack } from "../src/workflow-stack.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

async function workspace(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-go-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  try {
    await run(dir);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function pausedLoop(dir, sessionID = "ses_a") {
  const now = Date.now();
  await writeStack(dir, pauseSpine(startSpine(emptyStack(sessionID), "lit-loop", now - 5000), now - 1000, { phase: "work", done: 2, total: 5 }));
}

async function withPlugin(dir, run) {
  const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }) } };
  const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
  const send = async (text, sessionID = "ses_a", agent = "build") => {
    const output = { message: { id: "msg_x", sessionID, role: "user" }, parts: [{ id: "prt_x", sessionID, messageID: "msg_x", type: "text", text }] };
    await hooks["chat.message"]({ sessionID, messageID: "msg_x", agent }, output);
    return output.parts.slice(1).map((part) => part.text).join("\n");
  };
  try {
    await run(send);
  } finally {
    await hooks.dispose();
  }
}

test("detectGoWord accepts the whole prompt only", () => {
  for (const word of ["go", "Go", "go!", "lit go", "ㄱㄱ", "고", "진행", " 진행. "]) assert.equal(detectGoWord(word), true, word);
  for (const word of ["go to the store", "let's go", "고마워", "go `ls`", "`go`", "진행 상황 알려줘", "lit go fix", ""]) assert.equal(detectGoWord(word), false, word);
});

test("a next-step record is read once, only for its own session and only within 30 minutes", async () => {
  await workspace(async (dir) => {
    const now = Date.now();
    await writeNext(dir, { kind: "continue", target: "lit-loop", at: now - 60_000, sessionID: "ses_a" });
    assert.equal((await consumeNext(dir, "ses_b", now))?.kind, undefined);
    assert.equal((await consumeNext(dir, "ses_a", now))?.kind, "continue");
    assert.equal(await consumeNext(dir, "ses_a", now), undefined, "read once");
    await writeNext(dir, { kind: "continue", target: "lit-loop", at: now - adhdNextTtlMs - 60_000, sessionID: "ses_a" });
    assert.equal(await consumeNext(dir, "ses_a", now), undefined, "31 minutes is expired");
    await writeNext(dir, { kind: "continue", target: "lit-loop", at: now - adhdNextTtlMs + 60_000, sessionID: "ses_a" });
    assert.equal((await consumeNext(dir, "ses_a", now))?.kind, "continue", "29 minutes is alive");
    await fs.writeFile(nextFile(dir, "ses_a"), "{not json");
    assert.equal(await consumeNext(dir, "ses_a", now), undefined);
    await fs.writeFile(nextFile(dir, "ses_a"), JSON.stringify({ schema: "litopencode.adhd-next/v1", kind: "continue", target: "x", at: now, sessionID: "ses_other" }));
    assert.equal(await consumeNext(dir, "ses_a", now), undefined, "a record naming another session is ignored");
    assert.equal(await consumeNext(dir, "../escape", now), undefined);
  });
});

test("a next-step link is never followed", async () => {
  await workspace(async (dir) => {
    const target = path.join(dir, "target.json");
    await fs.writeFile(target, JSON.stringify({ schema: "litopencode.adhd-next/v1", kind: "continue", target: "x", at: Date.now(), sessionID: "ses_a" }));
    await fs.mkdir(path.dirname(nextFile(dir, "ses_a")), { recursive: true });
    await fs.symlink(target, nextFile(dir, "ses_a"));
    assert.equal(await consumeNext(dir, "ses_a", Date.now()), undefined);
    assert.equal(await fs.readFile(target, "utf8").then(Boolean), true, "the link target is untouched");
  });
});

test("go without a live record is plain text through the chat hook", async () => {
  await workspace(async (dir) => {
    await pausedLoop(dir);
    await withPlugin(dir, async (send) => {
      for (const word of ["go", "고", "진행", "ㄱㄱ", "lit go"]) {
        const text = await send(word);
        assert.doesNotMatch(text, /back in lit-loop/u, word);
      }
    });
  });
});

test("go with a live record returns a paused lit-loop through the same resume as lit continue", async () => {
  await workspace(async (dir) => {
    await pausedLoop(dir);
    await withPlugin(dir, async (send) => {
      await writeNext(dir, { kind: "continue", target: "lit-loop", at: Date.now(), sessionID: "ses_a" });
      assert.doesNotMatch(await send("go", "ses_b"), /back in lit-loop/u, "another session does not consume it");
      const text = await send("go");
      assert.match(text, /back in lit-loop at work 2\/5/u);
      assert.equal(await consumeNext(dir, "ses_a", Date.now()), undefined, "consumed");
      assert.doesNotMatch(await send("go"), /back in lit-loop/u, "a second go has nothing to follow");
    });
  });
});

test("go inside a sentence or a code span never consumes the record", async () => {
  await workspace(async (dir) => {
    await pausedLoop(dir);
    await withPlugin(dir, async (send) => {
      await writeNext(dir, { kind: "continue", target: "lit-loop", at: Date.now(), sessionID: "ses_a" });
      for (const text of ["go to the store", "run `go`", "고마워 진행 상황은 어때"]) assert.doesNotMatch(await send(text), /back in lit-loop/u, text);
      assert.equal((await consumeNext(dir, "ses_a", Date.now()))?.kind, "continue");
    });
  });
});

test("go on a single open plan starts it through the typed path; an expired record does nothing", async () => {
  await workspace(async (dir) => {
    await fs.mkdir(path.join(dir, "plans"), { recursive: true });
    await fs.writeFile(path.join(dir, "plans", "one.md"), "# plan\n\n- [ ] 1. first\n");
    await withPlugin(dir, async (send) => {
      await writeNext(dir, { kind: "plan", target: "plans/one.md", at: Date.now() - adhdNextTtlMs - 1000, sessionID: "ses_a" });
      assert.doesNotMatch(await send("go"), /start-work began/u);
      await assert.rejects(() => createBoundedAuthorityLifecycle(dir).read());
      await writeNext(dir, { kind: "plan", target: "plans/one.md", at: Date.now(), sessionID: "ses_a" });
      assert.match(await send("go"), /start-work began from plans\/one\.md/u);
      assert.equal((await createBoundedAuthorityLifecycle(dir).read()).status, "active");
    });
  });
});

test("go on a plan with Scope roots lines starts with those grants, so the run does not pause for them", async () => {
  await workspace(async (dir) => {
    const outside = path.join(dir, "outside-data");
    await fs.mkdir(outside);
    await fs.mkdir(path.join(dir, "project", "plans"), { recursive: true });
    const project = path.join(dir, "project");
    await fs.writeFile(
      path.join(project, "plans", "one.md"),
      `# plan\n\nScope roots: ${outside} (read, write)\n\n## Todos\n\n- [ ] 1. read ${outside}/a.csv\n`
    );
    await withPlugin(project, async (send) => {
      await writeNext(project, { kind: "plan", target: "plans/one.md", at: Date.now(), sessionID: "ses_a" });
      assert.match(await send("go"), /start-work began from plans\/one\.md/u);
      const state = await createBoundedAuthorityLifecycle(project).read();
      assert.equal(state.status, "active");
      assert.equal(state.pendingBoundary, null);
      for (const action of ["read", "write"]) {
        assert.ok(state.authority.grants.some((grant) => grant.action === action && grant.root === outside), action);
      }
      assert.equal(state.authority.grants.some((grant) => grant.root === outside && grant.action === "execute"), false);
    });
  });
});

test("go never answers a pending boundary: lit approve does", async () => {
  await workspace(async (dir) => {
    await fs.mkdir(path.join(dir, "plans"), { recursive: true });
    await fs.mkdir(path.join(dir, "nested"));
    await fs.writeFile(path.join(dir, "plans", "one.md"), "# plan\n\n- [ ] 1. first\n");
    await withPlugin(dir, async (send) => {
      await send("start-work");
      const lifecycle = createBoundedAuthorityLifecycle(dir);
      const state = await lifecycle.read();
      await lifecycle.pause({ schemaVersion: 3, requestId: "p1", workId: state.workId, sessionID: "ses_a", expectedRevision: state.revision, boundary: { action: "write", root: "nested" } });
      await writeNext(dir, { kind: "work", target: "start-work", at: Date.now(), sessionID: "ses_a" });
      await send("go");
      assert.equal((await lifecycle.read()).status, "paused", "go leaves the boundary pending");
      assert.match(await send("lit approve"), /approved write on/u);
      assert.equal((await lifecycle.read()).status, "active");
    });
  });
});

test("approve and go are not routed in a child session", async () => {
  await workspace(async (dir) => {
    await pausedLoop(dir);
    const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id, parentID: "ses_root" } }) } };
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
    try {
      await writeNext(dir, { kind: "continue", target: "lit-loop", at: Date.now(), sessionID: "ses_a" });
      const output = { message: { id: "m", sessionID: "ses_a", role: "user" }, parts: [{ id: "p", sessionID: "ses_a", messageID: "m", type: "text", text: "go" }] };
      await hooks["chat.message"]({ sessionID: "ses_a", messageID: "m", agent: "build" }, output);
      assert.equal(output.parts.length, 1);
      assert.equal((await consumeNext(dir, "ses_a", Date.now()))?.kind, "continue", "the record is still there");
    } finally {
      await hooks.dispose();
    }
  });
});

test("routeGo is inert for a kind that no longer applies", async () => {
  await workspace(async (dir) => {
    await writeNext(dir, { kind: "continue", target: "lit-loop", at: Date.now(), sessionID: "ses_a" });
    assert.equal(await routeGo({ projectRoot: dir, sessionID: "ses_a", text: "go" }), undefined, "no paused spine");
  });
});

test("the v2 prompt hook follows go the same way", async () => {
  await workspace(async (dir) => {
    await pausedLoop(dir);
    const fake = createFakeV2Context({ directory: dir, sessions: { ses_a: { id: "ses_a", agent: "build" } } });
    const cleanup = await setupLitOpenCodeServer(fake.context);
    const ask = async (text) => {
      await fake.run("session", "prompt", { sessionID: "ses_a", messageID: `msg_${Math.random()}`, prompt: { text }, delivery: "queue" });
      const event = await fake.run("session", "context", { sessionID: "ses_a", agent: "build", model: { providerID: "openai", id: "gpt-test" }, system: [], messages: [], options: {}, tools: {} });
      return event.system.map((part) => part.text).join("\n");
    };
    try {
      assert.doesNotMatch(await ask("go"), /back in lit-loop/u);
      await writeNext(dir, { kind: "continue", target: "lit-loop", at: Date.now(), sessionID: "ses_a" });
      assert.match(await ask("go"), /back in lit-loop at work 2\/5/u);
    } finally {
      await cleanup();
    }
  });
});
