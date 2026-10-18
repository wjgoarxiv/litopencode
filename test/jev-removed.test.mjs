import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createLitOpenCodePlugin } from "../src/server.ts";

// The Jev skill hint was removed in favour of letting the model pick skills on its own. These checks
// fail if the hint, its environment switches or a call to its hosted API find their way back in.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const removedFeature = /jev|typesafe/iu;

async function filesUnder(directory) {
  const found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(entryPath));
    else found.push(entryPath);
  }
  return found;
}

test("the shipped source and build carry no skill-hint client, switch or endpoint", async () => {
  const offenders = [];
  for (const directory of ["src", "dist", "bin", "rules"]) {
    const root = path.join(repoRoot, directory);
    const exists = await fs.stat(root).then(() => true, () => false);
    if (!exists) continue;
    for (const file of await filesUnder(root)) {
      if (removedFeature.test(path.basename(file))) offenders.push(path.relative(repoRoot, file));
      else if (removedFeature.test(await fs.readFile(file, "utf8").catch(() => ""))) offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("an old switch and key in the environment make no request, add no part and show no toast", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-no-hint-"));
  const saved = {
    fetch: globalThis.fetch,
    flag: process.env.LITOPENCODE_JEV,
    key: process.env.TYPESAFE_API_KEY,
    xdg: process.env.XDG_CONFIG_HOME
  };
  const requests = [];
  const toasts = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    throw new Error("no network in this test");
  };
  process.env.LITOPENCODE_JEV = "1";
  process.env.TYPESAFE_API_KEY = "test-key-not-real-0000";
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  try {
    const client = {
      session: { get: async () => ({ data: {} }) },
      tui: { showToast: async (options) => { toasts.push(options); } }
    };
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped", reason: "disabled" }))({ directory: dir, worktree: dir, client });
    const output = {
      message: { id: "msg_plain", sessionID: "session_plain", role: "user" },
      parts: [{ id: "part_plain", sessionID: "session_plain", messageID: "msg_plain", type: "text", text: "이 문단을 자연스럽게 다듬어줘" }]
    };
    await hooks["chat.message"]({ sessionID: "session_plain", messageID: "msg_plain" }, output);
    await hooks.dispose();
    assert.deepEqual(requests, []);
    assert.equal(output.parts.length, 1, "the user's turn reaches the model unchanged");
    assert.deepEqual(toasts, []);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [["LITOPENCODE_JEV", saved.flag], ["TYPESAFE_API_KEY", saved.key], ["XDG_CONFIG_HOME", saved.xdg]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});
