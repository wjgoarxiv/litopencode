import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import litOpenCodePlugin from "../src/index.ts";

async function withPlugin(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-humanizer-host-"));
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
  const hooks = await litOpenCodePlugin({ directory: root, worktree: root });
  try {
    await run(root, hooks);
  } finally {
    await hooks.dispose?.();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    await fs.rm(root, { recursive: true, force: true });
  }
}

function beforeRequest(tool, callID, args) {
  return { tool, sessionID: "humanizer-host-session", callID, args };
}

test("the real system-transform hook injects the always-on humanizer rule", async () => {
  await withPlugin(async (_root, hooks) => {
    const output = { system: ["host system prompt"] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "humanizer-system-session" }, output);
    const injected = output.system.join("\n");
    assert.match(injected, /Preserve the user(?:&#39;|')s meaning/u);
    assert.match(injected, /lit-humanizer/u);
    assert.match(injected, /material risk once/u);
  });
});

test("the real pre-write hook blocks added source labels without skill activation", async () => {
  await withPlugin(async (_root, hooks) => {
    const request = beforeRequest("write", "humanizer-block", {
      filePath: "reports/final.md",
      content: "Source: draft report\n"
    });
    await assert.rejects(
      hooks["tool.execute.before"](request, { args: request.args }),
      /LIT_HUMANIZER_BLOCKED.*en-plain-meta-label/u
    );
  });
});

test("clean writes pass and warning-tier wording returns as advisory context", async () => {
  await withPlugin(async (_root, hooks) => {
    const clean = beforeRequest("write", "humanizer-clean", {
      filePath: "reports/final.md",
      content: "The report contains three examples.\n"
    });
    await hooks["tool.execute.before"](clean, { args: clean.args });

    const warning = beforeRequest("write", "humanizer-warning", {
      filePath: "reports/another.md",
      content: "We delve into the measured results.\n"
    });
    await hooks["tool.execute.before"](warning, { args: warning.args });
    const output = { title: "Write", output: "Wrote reports/another.md", metadata: {} };
    await hooks["tool.execute.after"](warning, output);
    assert.match(output.output, /LIT_HUMANIZER_WARN/u);
    assert.equal(output.metadata.litopencodeHumanizerGuard?.tier, "warn");
  });
});

test("an edit may retain old findings but cannot add a new block-tier line", async () => {
  await withPlugin(async (root, hooks) => {
    await fs.mkdir(path.join(root, "reports"), { recursive: true });
    await fs.writeFile(path.join(root, "reports", "legacy.md"), "Source: existing line\nKeep this sentence.\n", "utf8");
    const safeEdit = beforeRequest("edit", "humanizer-existing", {
      filePath: "reports/legacy.md",
      oldString: "Keep this sentence.",
      newString: "Keep this clear sentence."
    });
    await hooks["tool.execute.before"](safeEdit, { args: safeEdit.args });

    const unsafeEdit = beforeRequest("edit", "humanizer-added", {
      filePath: "reports/legacy.md",
      oldString: "Keep this sentence.",
      newString: "Source: new unrequested label"
    });
    await assert.rejects(
      hooks["tool.execute.before"](unsafeEdit, { args: unsafeEdit.args }),
      /LIT_HUMANIZER_BLOCKED/u
    );
  });
});

test("Office text is checked after creation and tells the model to fix and rebuild", async () => {
  await withPlugin(async (root, hooks) => {
    const relative = "reports/minimal.pptx";
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.copyFile("skills/lit-humanizer/fixtures/office/minimal.pptx", path.join(root, relative));
    const request = beforeRequest("write", "humanizer-office", { filePath: relative });
    const output = { title: "Write", output: `Created ${relative}`, metadata: {} };
    await hooks["tool.execute.after"](request, output);
    assert.match(output.output, /LIT_HUMANIZER_OFFICE_BLOCK_HIT/u);
    assert.match(output.output, /fix the source and rebuild/iu);
  });
});
