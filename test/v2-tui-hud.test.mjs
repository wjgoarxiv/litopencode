import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupLitOpenCodeTui } from "../src/v2/tui.ts";
import { appendNotice } from "../src/v2/notices.ts";
import { v2StageNotices } from "../src/v2/tui-notices.ts";

// The OpenCode 2 HUD, driven with a stand-in context and UI runtime. The slots are the ones OpenCode 2
// publishes (@opencode/plugin SlotMap): the card goes in the app slot under the session, the stage chip next to
// the ignition line in prompt.footer.status, the home line in home.footer, the panel in sidebar.content.
function runtime(effects = [], columns = 120) {
  return {
    jsx: (type, props) => ({ type, props }),
    createRoot: (fn) => fn(() => undefined),
    createEffect(fn) {
      effects.push(fn);
      fn();
    },
    createSignal(value) {
      let current = value;
      return [() => current, (next) => (current = next)];
    },
    useTerminalDimensions: () => () => ({ width: columns, height: 40 })
  };
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string") return node;
  if (typeof node === "function") return textOf(node());
  if (Array.isArray(node)) return node.map(textOf).join(node.some((item) => item?.type === "text") ? "\n" : "");
  return textOf(node.props?.children);
}

const rgba = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255, a: 1 });
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const mark = (mode) => ({ litopencode: { mode, trigger: "lit", source: "prompt" } });
const user = (id, text, metadata, created = Date.now()) => ({ id, type: "user", text, time: { created }, ...(metadata === undefined ? {} : { metadata }) });
const assistant = (id, content = [], created = Date.now()) => ({
  id,
  type: "assistant",
  agent: "lit-loop",
  model: { providerID: "xai", id: "grok-4.7" },
  tokens: { input: 40000, output: 2000, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created },
  content
});

function fakeTui({ messages = {}, status = {}, options = {}, directory } = {}) {
  const claims = [];
  const toasts = [];
  const alerts = [];
  const listeners = [];
  const project = directory ?? fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-v2-hud-"));
  const context = {
    options,
    location: { directory: project },
    app: { version: "2.2.5", channel: "latest" },
    themeMode: "dark",
    theme: {
      text: { base: rgba(230, 237, 243), muted: rgba(125, 133, 144) },
      border: { base: rgba(42, 49, 59) },
      background: { base: rgba(10, 10, 10), raised: { base: rgba(20, 20, 20), high: rgba(30, 30, 30) } }
    },
    attention: { notify: async (input) => alerts.push(input) },
    ui: {
      slot(claim) {
        claims.push(claim);
        return () => claims.splice(claims.indexOf(claim), 1);
      },
      toast: { show: (toast) => toasts.push(toast) }
    },
    storage: { store: (_key, { initial }) => [Object.assign(initial, { motion: true }), async () => undefined] },
    data: {
      listen(handler) {
        listeners.push(handler);
        return () => listeners.splice(listeners.indexOf(handler), 1);
      },
      session: {
        get: (id) => (id === "ses_child" ? { id, parentID: "ses_lit" } : { id, time: { created: Date.now() } }),
        status: (id) => status[id] ?? "idle",
        message: { list: (id) => messages[id] ?? [] },
        permission: { list: () => [] },
        form: { list: () => [] }
      },
      location: {
        default: () => ({ directory: project }),
        vcs: { info: () => ({ branch: { current: "main" } }) },
        model: { list: () => [{ providerID: "xai", modelID: "grok-4.7", limit: { context: 500000 } }] }
      }
    }
  };
  const find = (placement, target) => claims.find((claim) => claim[placement] === target);
  const route = { current: { type: "home" } };
  context.ui.router = { current: () => route.current };
  return { context, claims, toasts, alerts, project, find, route, emit: (details) => listeners.forEach((handler) => handler({ details })) };
}

const band = (fake, sessionID) => {
  fake.route.current = sessionID === undefined ? { type: "home" } : { type: "session", sessionID };
  return textOf(fake.find("append", "app").render({}));
};

test("the HUD claims the OpenCode 2 slots: card in app, chip in the footer status, home line, sidebar panel", async () => {
  const fake = fakeTui();
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  assert.ok(fake.find("append", "app"), "status card");
  assert.ok(fake.find("append", "prompt.footer.status"), "ignition line and stage chip");
  assert.ok(fake.find("append", "home.footer"), "home line");
  assert.ok(fake.find("append", "sidebar.content"), "mission panel");
  await cleanup();
  assert.equal(fake.claims.length, 0);
});

test("the card shows on every session, lit or not, and nowhere else", async () => {
  const fake = fakeTui({ messages: { ses_plain: [user("m1", "hello")] } });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  assert.equal(band(fake, undefined), "", "the home route has no session, so no card");
  const text = band(fake, "ses_plain");
  assert.match(text, /🔥 LIT · ready/u);
  assert.match(text, /○ IDLE/u);
  assert.match(text, /add lit to a prompt to start/u);
  await cleanup();
});

test("a lit turn's card names the discipline, its skill chip, the branch and the context use", async () => {
  const messages = { ses_lit: [user("m1", "lit fix it", mark("lit-task")), assistant("m2")] };
  const fake = fakeTui({ messages });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  const text = band(fake, "ses_lit");
  assert.match(text, /🔥 LIT · lit-task/u);
  assert.match(text, /○ IDLE/u);
  assert.match(text, /skills\s+lit-task/u);
  assert.match(text, /ctx 8%/u, "42,000 of a 500,000-token window");
  assert.match(text, /⎇ main/u);
  await cleanup();
});

test("a running turn lights the work phase and the live step, and a skill tool call adds its chip", async () => {
  const messages = {
    ses_lit: [
      user("m1", "lit loop fix it", mark("lit-loop")),
      assistant("m2", [
        { type: "tool", name: "skill", state: { status: "completed", input: { name: "lit-plan" } }, time: { created: Date.now(), ran: Date.now() } },
        { type: "tool", name: "bash", state: { status: "running", input: { command: "npm test" } }, time: { created: Date.now(), ran: Date.now() - 9000 } }
      ])
    ]
  };
  const fake = fakeTui({ messages, status: { ses_lit: "running" } });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  const text = band(fake, "ses_lit");
  assert.doesNotMatch(text, /○ IDLE/u);
  assert.match(text, /bash · 0:0\d/u);
  assert.match(text, /lit-plan/u);
  assert.match(text, /lit-loop/u);
  assert.doesNotMatch(text, /npm test/u, "a tool's input is never shown");
  await cleanup();
});

test("OpenCode 2 tool names are read as they are: the skill tool's id and the subagent tool", async () => {
  const now = Date.now();
  const messages = {
    ses_lit: [
      user("m1", "lit loop fix it", mark("lit-loop")),
      assistant("m2", [
        { type: "tool", name: "skill", state: { status: "completed", input: { id: "lit-plan" } }, time: { created: now, ran: now } },
        { type: "tool", name: "subagent", state: { status: "running", input: { agent: "explore", description: "Map the repo", prompt: "p" } }, time: { created: now, ran: now - 3000 } },
        { type: "tool", name: "subagent", state: { status: "running", input: { agent: "review", description: "Check tests", prompt: "p" } }, time: { created: now, ran: now - 2000 } }
      ])
    ]
  };
  const fake = fakeTui({ messages, status: { ses_lit: "running" } });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  const text = band(fake, "ses_lit");
  assert.match(text, /lit-plan/u, "the skill chip, from input.id");
  assert.match(text, /2 lanes in parallel/u);
  assert.match(text, /Map the repo/u);
  assert.match(text, /Check tests/u);
  await cleanup();
});

test("a subagent session shows its parent's card marked as a lane", async () => {
  const messages = { ses_lit: [user("m1", "lit fix it", mark("lit-task")), assistant("m2")] };
  const fake = fakeTui({ messages });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  assert.match(band(fake, "ses_child"), /in lane/u);
  await cleanup();
});

test("the footer status line carries the stage chip beside the ignition line", async () => {
  const messages = { ses_lit: [user("m1", "lit loop fix it", mark("lit-loop"))] };
  const fake = fakeTui({ messages });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime([], 200));
  const text = textOf(fake.find("append", "prompt.footer.status").render({ sessionID: "ses_lit", mode: "normal", showDetails: false }));
  assert.match(text, /🔥 LIT IGNITED · lit-loop/u);
  assert.match(text, /🔥 LIT\s+interview|plan/u);
  assert.match(text, /review/u);
  assert.equal(textOf(fake.find("append", "prompt.footer.status").render({ mode: "normal", showDetails: false })), "");
  await cleanup();
});

test("the footer line steps down with the terminal width and is never cut mid-word", async () => {
  const messages = { ses_lit: [user("m1", "lit loop fix it", mark("lit-loop"))] };
  const widths = [];
  for (const columns of [200, 130, 100, 90, 70, 50, 30]) {
    const fake = fakeTui({ messages });
    const cleanup = await setupLitOpenCodeTui(fake.context, runtime([], columns));
    const text = textOf(fake.find("append", "prompt.footer.status").render({ sessionID: "ses_lit", mode: "normal", showDetails: false }));
    widths.push([columns, text]);
    await cleanup();
  }
  const at = (columns) => widths.find(([width]) => width === columns)?.[1] ?? "";
  assert.match(at(200), /🔥 LIT IGNITED · lit-loop {3}🔥 LIT.*review/u, "wide: mark and the whole chip");
  assert.match(at(100), /^🔥 LIT IGNITED · lit-loop {2}🔥 {2}\S+ $/u, "100 columns: mark and the small chip");
  assert.match(at(90), /^🔥 {2}\S+ {2}› review$/u, "90 columns: the mark's words go, the chip stays");
  assert.match(at(70), /^🔥 {2}\S+ $/u, "70 columns: the small chip");
  assert.equal(at(50), "", "50 columns: the host's own figures leave no room, so nothing");
  assert.equal(at(30), "");
  for (const [columns, text] of widths) assert.doesNotMatch(text, /IGNIT\b|IGNITE\b|lit-loo\b/u, `no cut word at ${columns}`);
});

test("the plan windows show on a Go session's card from the host's usage source, and nowhere else", async () => {
  const goMessage = (id) => ({ ...assistant(id), model: { providerID: "opencode-go", id: "glm" } });
  const reply = { data: { workspace: { id: "w", usageURL: "u" }, go: { rolling: { percent: 42, limited: false, resetsAt: 1 }, weekly: { percent: 18, limited: false, resetsAt: 1 }, monthly: { percent: 3, limited: false, resetsAt: 1 } }, budgets: [] } };
  let calls = 0;
  const messages = { ses_go: [user("m1", "lit fix it", mark("lit-task")), goMessage("m2")], ses_other: [user("m3", "lit fix it", mark("lit-task")), assistant("m4")] };
  const fake = fakeTui({ messages });
  fake.context.client = { usage: { limits: async () => { calls += 1; return reply; } } };
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  assert.doesNotMatch(band(fake, "ses_go"), /5h/u, "nothing before the first answer");
  await settle();
  assert.equal(calls, 1);
  assert.match(band(fake, "ses_go"), /5h 42% · 1w 18% · ⟳/u);
  assert.doesNotMatch(band(fake, "ses_other"), /5h|1w/u, "another provider's session has no such allowance");
  await cleanup();
});

test("a host with no usage source, or one that errors or is signed out, draws no figure and asks no more than needed", async () => {
  const messages = { ses_go: [user("m1", "lit fix it", mark("lit-task")), { ...assistant("m2"), model: { providerID: "opencode-go", id: "glm" } }] };
  for (const client of [undefined, {}, { usage: {} }, { usage: { limits: async () => { throw new Error("offline"); } } }, { usage: { limits: async () => ({ data: null }) } }]) {
    const fake = fakeTui({ messages });
    if (client !== undefined) fake.context.client = client;
    const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
    band(fake, "ses_go");
    await settle();
    assert.doesNotMatch(band(fake, "ses_go"), /5h|1w/u);
    await cleanup();
  }
});

test("popups the server left in the notices file are shown, only the ones after the TUI started", async () => {
  const messages = { ses_lit: [user("m1", "lit loop fix it", mark("lit-loop"))] };
  const fake = fakeTui({ messages });
  const file = path.join(fake.project, ".litopencode", "notices.jsonl");
  appendNotice(file, { title: "LitOpenCode auto-handoff", message: "from before", variant: "info", duration: 8000 });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  fake.find("append", "prompt.footer.status").render({ sessionID: "ses_lit", mode: "normal", showDetails: false });
  await settle();
  appendNotice(file, { title: "LitOpenCode auto-handoff", message: "Handoff saved. Compacting the conversation now.", variant: "info", duration: 8000 });
  fake.emit({ type: "session.status", data: { sessionID: "ses_lit" } });
  await settle();
  const shown = fake.toasts.filter((toast) => toast.title === "LitOpenCode auto-handoff");
  assert.deepEqual(shown.map((toast) => toast.message), ["Handoff saved. Compacting the conversation now."]);
  assert.equal(shown[0].variant, "info");
  assert.equal(shown[0].duration, 8000);
  await cleanup();
});

test("the home screen names the project's last goal", async () => {
  const fake = fakeTui();
  const dir = path.join(fake.project, ".litopencode", "litgoal", "lit-loop");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "goals.json"), JSON.stringify({ title: "Ship the HUD", status: "complete", criteria: [{ id: "C1", status: "pass" }, { id: "C2", status: "pass" }] }));
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  assert.match(textOf(fake.find("append", "home.footer").render({})), /lit ready · last: Ship the HUD ✓ 2\/2/u);
  await cleanup();
});

test("the home screen is empty when the project has no goal", async () => {
  const fake = fakeTui();
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  assert.equal(textOf(fake.find("append", "home.footer").render({})), "");
  await cleanup();
});

test("a finished goal raises its toast, and the finish alert goes out only when tui options opt in", async () => {
  for (const options of [{}, { notify: true }]) {
    const messages = { ses_lit: [user("m1", "lit loop fix it", mark("lit-loop"))] };
    const fake = fakeTui({ messages, options });
    const dir = path.join(fake.project, ".litopencode", "litgoal", "lit-loop");
    fs.mkdirSync(dir, { recursive: true });
    const write = (status, pass) => fs.writeFileSync(path.join(dir, "goals.json"), JSON.stringify({ title: "Ship the HUD", status, criteria: [{ id: "C1", status: pass ? "pass" : "pending" }] }));
    write("active", false);
    const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
    fake.find("append", "prompt.footer.status").render({ sessionID: "ses_lit", mode: "normal", showDetails: false });
    await settle();
    write("complete", true);
    fake.emit({ type: "session.status", data: { sessionID: "ses_lit" } });
    await settle();
    assert.ok(fake.toasts.some((toast) => /Complete/u.test(toast.title)), "the completion toast");
    assert.equal(fake.alerts.length, options.notify === true ? 1 : 0);
    if (options.notify === true) assert.equal(fake.alerts[0].title, "🔥 LIT complete");
    await cleanup();
  }
});

test("a bad options value keeps the card on, and band: false removes it", async () => {
  const fake = fakeTui({ options: { band: false } });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  assert.equal(fake.find("append", "app"), undefined);
  await cleanup();
});

const view = (overrides) => ({
  active: true,
  discipline: "lit-loop",
  family: "main",
  phase: "plan",
  steps: [
    { id: "interview", state: "done" },
    { id: "plan", state: "now" },
    { id: "work", state: "todo" },
    { id: "review", state: "todo" },
    { id: "done", state: "todo" }
  ],
  blockers: [],
  warnings: [],
  timeline: [],
  planSaved: true,
  complete: false,
  ...overrides
});

test("stage toasts: a move to the next stage, a switch of discipline, and a lane starting or finishing", () => {
  const plan = view({});
  const work = view({
    phase: "work",
    progress: { done: 3, total: 7 },
    steps: [
      { id: "interview", state: "done" },
      { id: "plan", state: "done" },
      { id: "work", state: "now" },
      { id: "review", state: "todo" },
      { id: "done", state: "todo" }
    ]
  });
  assert.deepEqual(v2StageNotices(undefined, work, [], []), [], "the first view never toasts");
  const moved = v2StageNotices(plan, work, [], []);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].title, "🔥 Stage");
  assert.match(moved[0].message, /work 3\/7/u);
  assert.deepEqual(v2StageNotices(work, work, [], []), []);
  const switched = v2StageNotices(plan, view({ discipline: "start-work" }), [], []);
  assert.equal(switched[0].title, "🔥 lit-loop → start-work");
  const row = (key, status) => ({ key, name: `lane ${key}`, status, facts: "" });
  const started = v2StageNotices(work, work, [], [row("a", "working")]);
  assert.match(started[0].message, /lane started · lane a/u);
  const finished = v2StageNotices(work, work, [row("a", "working")], []);
  assert.match(finished[0].message, /lane finished · lane a/u);
  const burst = v2StageNotices(work, work, [], [row("a", "working"), row("b", "working")]);
  assert.match(burst[0].message, /2 lanes started/u);
});
