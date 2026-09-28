import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDeliverableHedgeGuard } from "../src/deliverable-hedge-guard.ts";

async function temporary(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-humanizer-guard-"));
  const guard = createDeliverableHedgeGuard({ projectRoot: root });
  try {
    await run(root, guard);
  } finally {
    guard.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
}

function request(tool, relativePath, fields = {}) {
  return {
    tool,
    sessionID: "humanizer-session",
    callID: "humanizer-call",
    args: { filePath: relativePath, ...fields }
  };
}

test("tool.execute.before blocks new high-precision reader-facing text before a write", async () => {
  await temporary(async (_root, guard) => {
    await assert.rejects(
      guard.before(request("write", "deliverable.md", { content: "Source: unrequested report\n" })),
      /LIT_HUMANIZER_BLOCKED.*en-plain-meta-label/u
    );
  });
});

test("pre-existing hits, fenced code, quoted source text, and internal paths do not block", async () => {
  await temporary(async (root, guard) => {
    await fs.mkdir(path.join(root, "reports"), { recursive: true });
    await fs.writeFile(path.join(root, "reports", "existing.md"), "Source: old text\n", "utf8");
    await guard.before(request("write", "reports/existing.md", { content: "Source: old text\n" }));
    await guard.before(request("write", "reports/code.md", { content: "```text\nSource: sample\n```\n" }));
    await guard.before(request("write", "reports/quote.md", { content: "> Source: user quote\n" }));
    await guard.before(request("write", "plans/report.md", { content: "Source: internal plan\n" }));
  });
});

test("clean writes pass and warning-tier findings arrive as advisory context after the write", async () => {
  await temporary(async (_root, guard) => {
    const clean = request("write", "deliverable.md", { content: "The release contains three examples.\n" });
    await guard.before(clean);
    const warning = request("write", "warning.md", { content: "We delve into the results.\n" });
    await guard.before(warning);
    const output = { title: "Write", output: "Wrote warning.md", metadata: {} };
    await guard.after(warning, output);
    assert.match(output.output, /LIT_HUMANIZER_WARN/u);
    assert.equal(output.metadata.litopencodeHumanizerGuard?.tier, "warn");
  });
});

test("scanner crashes fail open and are reported in one visible line", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-humanizer-fail-open-"));
  const guard = createDeliverableHedgeGuard({
    projectRoot: root,
    scan: async () => { throw new Error("simulated scanner crash"); }
  });
  try {
    const input = request("write", "deliverable.md", { content: "Source: report\n" });
    await guard.before(input);
    const output = { title: "Write", output: "Wrote deliverable.md", metadata: {} };
    await guard.after(input, output);
    assert.match(output.output, /^Wrote deliverable\.md\n\nLIT_HUMANIZER_GUARD_UNAVAILABLE: [^\n]+$/u);
  } finally {
    guard.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
