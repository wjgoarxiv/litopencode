import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-wikify-surface-"));
const isolatedEnvironment = {
  HOME: path.join(root, "home"),
  XDG_CONFIG_HOME: path.join(root, "xdg", "config"),
  XDG_CACHE_HOME: path.join(root, "xdg", "cache"),
  XDG_DATA_HOME: path.join(root, "xdg", "data"),
  LITOPENCODE_NO_AUTO_UPDATE: "1",
  NO_UPDATE_NOTIFIER: "1",
  LITOPENCODE_NO_UPDATE_CHECK: "1"
};

async function snapshotDirectoryState(directory) {
  const entries = [];
  async function visit(current, relativePath) {
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    const entryPath = relativePath === "" ? "." : relativePath;
    if (stat.isSymbolicLink()) {
      entries.push({ path: entryPath, kind: "symlink", target: await fs.readlink(current) });
      return;
    }
    if (stat.isDirectory()) {
      entries.push({ path: entryPath, kind: "directory" });
      for (const child of (await fs.readdir(current)).sort()) {
        await visit(path.join(current, child), relativePath === "" ? child : path.join(relativePath, child));
      }
      return;
    }
    if (stat.isFile()) {
      entries.push({
        path: entryPath,
        kind: "file",
        sha256: createHash("sha256").update(await fs.readFile(current)).digest("hex")
      });
      return;
    }
    entries.push({ path: entryPath, kind: "special" });
  }
  await visit(directory, "");
  return entries;
}

async function snapshotProfileState() {
  const roots = {
    home: isolatedEnvironment.HOME,
    xdgConfig: isolatedEnvironment.XDG_CONFIG_HOME,
    xdgCache: isolatedEnvironment.XDG_CACHE_HOME,
    xdgData: isolatedEnvironment.XDG_DATA_HOME
  };
  const state = {};
  for (const [name, directory] of Object.entries(roots)) state[name] = await snapshotDirectoryState(directory);
  return state;
}

const previousEnvironment = Object.fromEntries(
  Object.keys(isolatedEnvironment).map((key) => [key, process.env[key]])
);
for (const [key, value] of Object.entries(isolatedEnvironment)) process.env[key] = value;
const profileStateBefore = await snapshotProfileState();
let receipt;
try {
  const { default: plugin } = await import("../dist/index.js");
  const hooks = await plugin({ directory: root, worktree: root });
  const config = {};
  await hooks.config(config);
  const context = {
    sessionID: "surface-session",
    messageID: "surface-message",
    agent: "lit-loop",
    directory: root,
    worktree: root,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {}
  };
  const captured = await hooks.tool.wikify.execute({
    action: "capture",
    kind: "decision",
    text: "Use claims.jsonl as the only project knowledge authority.",
    evidenceRef: "README.md:165",
    source: "surface-probe"
  }, context);
  const afterOutput = {
    title: "Structured tool receipt",
    output: "Raw tool output remains inert.",
    metadata: {
      litopencodeKnowledgeCapture: {
        kind: "fact",
        text: "An automatic tool receipt starts in review-needed state.",
        evidenceRef: "README.md:204",
        source: "surface-probe"
      }
    }
  };
  await hooks["tool.execute.after"](
    { tool: "evidence-recorder", sessionID: "surface-session", callID: "surface-call", args: {} },
    afterOutput
  );
  const automaticReceipt = afterOutput.metadata?.litopencodeKnowledgeReceipt;
  if (
    automaticReceipt?.status !== "captured" ||
    !/^kn_[a-f0-9]{24}$/u.test(automaticReceipt.id) ||
    automaticReceipt.state !== "review-needed"
  ) {
    throw new Error("the tool.execute.after hook did not emit a captured review-needed receipt");
  }
  const saved = await hooks.tool.wikify.execute({ action: "save", id: captured.metadata.id }, context);
  if (saved.metadata.state !== "accepted") throw new Error("the tool did not accept the captured record");

  const chatOutput = {
    message: { id: "surface-chat-message", agent: "lit-loop" },
    parts: [{ id: "surface-chat-part", type: "text", text: "Which knowledge file is authoritative?" }]
  };
  await hooks["chat.message"](
    { sessionID: "surface-session", messageID: "surface-chat-message", agent: "lit-loop" },
    chatOutput
  );
  const commandOutput = { parts: [] };
  await hooks["command.execute.before"](
    { command: "/wikify-query", arguments: "project knowledge authority", sessionID: "surface-session" },
    commandOutput
  );

  const claimsPath = path.join(root, ".litopencode", "knowledge", "claims.jsonl");
  const claims = await fs.readFile(claimsPath, "utf8");
  await hooks.dispose();
  const profileStateAfter = await snapshotProfileState();
  receipt = {
    status: "PASS",
    surfaces: {
      config: config.agent?.["lit-loop"] !== undefined,
      tool: typeof hooks.tool.wikify.execute === "function",
      toolExecuteAfter: automaticReceipt.status === "captured" && automaticReceipt.state === "review-needed",
      chatMessage: chatOutput.parts.some((part) => part.metadata?.litopencodeKnowledge !== undefined),
      commandExecuteBefore: commandOutput.parts.some((part) => part.metadata?.litopencodeKnowledge !== undefined)
    },
    artifact: {
      path: claimsPath,
      lineCount: claims.trim().split("\n").length,
      sha256: createHash("sha256").update(claims).digest("hex")
    },
    automaticReceipt: {
      id: automaticReceipt.id,
      state: automaticReceipt.state
    },
    profileState: {
      before: profileStateBefore,
      after: profileStateAfter
    },
    liveProfileMutated: JSON.stringify(profileStateBefore) !== JSON.stringify(profileStateAfter)
  };
} finally {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(root, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ ...receipt, cleanup: { root, removed: true } }, null, 2)}\n`);
