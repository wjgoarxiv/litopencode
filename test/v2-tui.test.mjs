import assert from "node:assert/strict";
import { test } from "node:test";
import { setupLitOpenCodeTui } from "../src/v2/tui.ts";

// The OpenCode 2 TUI plugin, driven with a stand-in context and a stand-in UI runtime (jsx and signals),
// since OpenTUI and Solid come from the host at run time. Slots are claimed by path; renders return a
// function the host calls reactively.
function runtime(effects = [], roots = []) {
  return {
    jsx: (type, props) => ({ type, props }),
    createRoot(fn) {
      const root = { disposed: false };
      roots.push(root);
      return fn(() => {
        root.disposed = true;
      });
    },
    createEffect(fn) {
      effects.push(fn);
      fn();
    },
    createSignal(value) {
      let current = value;
      return [() => current, (next) => (current = next)];
    }
  };
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string") return node;
  if (typeof node === "function") return textOf(node());
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

function rgba(r, g, b) {
  return { r: r / 255, g: g / 255, b: b / 255, a: 1 };
}

function fakeTui(messages = {}) {
  const claims = [];
  const toasts = [];
  const listeners = [];
  const timers = { active: 0 };
  const store = { motion: true };
  const context = {
    options: {},
    location: { directory: "/tmp/litopencode-v2-tui-project" },
    app: { version: "2.0.32", channel: "latest" },
    themeMode: "dark",
    theme: {
      text: { base: rgba(230, 237, 243), muted: rgba(125, 133, 144) },
      border: { base: rgba(42, 49, 59) },
      background: { base: rgba(10, 10, 10), raised: { base: rgba(20, 20, 20), high: rgba(30, 30, 30) } }
    },
    ui: {
      slot(claim) {
        claims.push(claim);
        return () => claims.splice(claims.indexOf(claim), 1);
      },
      toast: { show: (options) => toasts.push(options) }
    },
    storage: { store: (_key, { initial }) => [Object.assign(initial, store), async () => undefined] },
    data: {
      listen(handler) {
        listeners.push(handler);
        return () => listeners.splice(listeners.indexOf(handler), 1);
      },
      session: {
        get: (id) => (id === "ses_child" ? { id, parentID: "ses_root" } : { id }),
        status: () => "idle",
        message: { list: (sessionID) => messages[sessionID] ?? [] },
        permission: { list: () => [] },
        form: { list: () => [] }
      },
      location: { default: () => ({ directory: "/tmp/litopencode-v2-tui-project" }) }
    }
  };
  return {
    context,
    claims,
    toasts,
    listeners,
    timers,
    emit: (details) => listeners.forEach((handler) => handler({ details })),
    claim: (path) => claims.find((claim) => claim.append === path)
  };
}

const userMessage = (id, text, metadata, created = Date.now()) => ({ id, type: "user", text, time: { created }, ...(metadata === undefined ? {} : { metadata }) });

test("the TUI claims the sidebar content and the prompt footer status slots", async () => {
  const fake = fakeTui();
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  assert.ok(fake.claim("sidebar.content"));
  assert.ok(fake.claim("prompt.footer.status"));
  await cleanup();
  assert.equal(fake.claims.length, 0);
  assert.equal(fake.listeners.length, 0);
});

test("the footer shows the ignition line for a lit turn and nothing otherwise", async () => {
  const messages = {
    ses_lit: [userMessage("msg_1", "lit fix it", { litopencode: { mode: "lit-task", trigger: "lit", source: "prompt" } })],
    ses_plain: [userMessage("msg_2", "hello")]
  };
  const fake = fakeTui(messages);
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  const footer = fake.claim("prompt.footer.status");
  assert.equal(textOf(footer.render({ mode: "normal", showDetails: false })), "");
  assert.match(textOf(footer.render({ sessionID: "ses_lit", mode: "normal", showDetails: false })), /^🔥 LIT IGNITED · lit-task$/u);
  assert.equal(textOf(footer.render({ sessionID: "ses_plain", mode: "normal", showDetails: false })), "");
  await cleanup();
});

test("a new lit-marked user message raises one ignition toast, inferred from its metadata", async () => {
  const messages = { ses_lit: [userMessage("msg_old", "hello")] };
  const fake = fakeTui(messages);
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  const footer = fake.claim("prompt.footer.status");
  footer.render({ sessionID: "ses_lit", mode: "normal", showDetails: false });
  messages.ses_lit.push(userMessage("msg_new", "lit review this", { litopencode: { mode: "review-work", trigger: "lit", source: "prompt" } }));
  fake.emit({ type: "session.inbox.delivered", data: { sessionID: "ses_lit" } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(fake.toasts.length, 1);
  assert.equal(fake.toasts[0].title, "🔥 LIT IGNITED");
  assert.equal(fake.toasts[0].variant, "warning");
  assert.equal(fake.toasts[0].sessionID, "ses_lit");
  assert.match(fake.toasts[0].message, /🔥 LIT IGNITED · review-work 🔥/u);
  fake.emit({ type: "session.status", data: { sessionID: "ses_lit" } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(fake.toasts.length, 1);
  await cleanup();
});

test("the sidebar panel stays empty without a session or an active mission", async () => {
  const fake = fakeTui({ ses_plain: [userMessage("msg_1", "hello")] });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  const sidebar = fake.claim("sidebar.content");
  assert.equal(textOf(sidebar.render({ sessionID: "ses_plain" })), "");
  await cleanup();
});

test("an active lit mission fills the sidebar panel with the theme's colours", async () => {
  const fake = fakeTui({ ses_lit: [userMessage("msg_1", "lit fix it", { litopencode: { mode: "lit-loop", trigger: "lit", source: "prompt" } })] });
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime());
  const sidebar = fake.claim("sidebar.content");
  const node = sidebar.render({ sessionID: "ses_lit" })();
  assert.equal(node.type, "box");
  assert.match(textOf(node.props.children), /\S/u);
  await cleanup();
});

test("a session whose history loads after the first render lights the panel when the store fills, without any event", async () => {
  const messages = { ses_lit: [] };
  const effects = [];
  const fake = fakeTui(messages);
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime(effects));
  const sidebar = fake.claim("sidebar.content");
  const panel = sidebar.render({ sessionID: "ses_lit" });
  assert.equal(textOf(panel), "");
  messages.ses_lit.push(userMessage("msg_1", "lit loop fix it", { litopencode: { mode: "lit-loop", trigger: "lit", source: "prompt" } }));
  for (const effect of effects) effect();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const node = panel();
  assert.equal(node?.type, "box");
  await cleanup();
});

test("review M5: after cleanup a late effect run arms no timer, and each session effect is owned by its own root and disposed", async () => {
  const messages = { ses_lit: [userMessage("msg_1", "lit loop fix it", { litopencode: { mode: "lit-loop", trigger: "lit", source: "prompt" } })], ses_b: [] };
  const effects = [];
  const roots = [];
  const fake = fakeTui(messages);
  const cleanup = await setupLitOpenCodeTui(fake.context, runtime(effects, roots));
  const armed = [];
  const timers = [];
  const original = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
  try {
    fake.claim("sidebar.content").render({ sessionID: "ses_lit" });
    fake.claim("sidebar.content").render({ sessionID: "ses_b" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await cleanup();
    globalThis.setTimeout = (...args) => {
      armed.push("timeout");
      const timer = original.setTimeout(...args);
      timers.push(timer);
      return timer;
    };
    globalThis.setInterval = (...args) => {
      armed.push("interval");
      const timer = original.setInterval(...args);
      timers.push(timer);
      return timer;
    };
    for (const effect of effects) effect();
    fake.listeners.forEach((handler) => handler({ details: { type: "session.status" } }));
  } finally {
    globalThis.setTimeout = original.setTimeout;
    globalThis.setInterval = original.setInterval;
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    await cleanup();
  }
  assert.deepEqual(armed, [], "a timer was armed after cleanup");
  assert.equal(roots.length, 2, "one root per tracked session, detached from the slot that first drew it");
  assert.deepEqual(roots.map((root) => root.disposed), [true, true]);
});
