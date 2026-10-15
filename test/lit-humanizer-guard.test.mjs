import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDeliverableHedgeGuard } from "../src/deliverable-hedge-guard.ts";
import { parseRules, scanText } from "../skills/lit-humanizer/scripts/core.mjs";

const pledgeRuleIds = new Set(["ko-negative-pledge", "ko-negative-pledge-repeat", "en-negative-pledge"]);
const pledgeCases = JSON.parse(readFileSync(new URL("./fixtures/lit-humanizer/pledge-cases.json", import.meta.url), "utf8"));
const shippedRules = parseRules(readFileSync(new URL("../skills/lit-humanizer/rules.json", import.meta.url), "utf8"));
const severityRank = { warn: 1, block: 2 };

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

test("block rules apply to prose formats only, never to structured config or data files", async () => {
  await temporary(async (_root, guard) => {
    const prose = [".adoc", ".htm", ".html", ".md", ".mdx", ".org", ".rst", ".svg", ".tex", ".txt", ".xhtml"];
    for (const extension of prose) {
      await assert.rejects(
        guard.before(request("write", `deliverable${extension}`, { content: "Source: unrequested report\n" })),
        /LIT_HUMANIZER_BLOCKED/u,
        extension
      );
    }
    const structured = [".csv", ".json", ".jsonc", ".tsv", ".xml", ".yaml", ".yml"];
    for (const extension of structured) {
      await guard.before(request("write", `config${extension}`, { content: "Source: generated\nprovenance: true\nevidence: none\n" }));
    }
    await guard.before(request("write", "argocd/application.yaml", {
      content: "spec:\n  source:\n    repoURL: https://example.invalid/repo.git\n"
    }));
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

test("inside a Bun host the detector still runs under Node, not under the host binary", { skip: process.platform === "win32" ? "POSIX shell stand-in" : false }, async () => {
  // OpenCode runs plugins in a Bun-compiled binary, so process.execPath names that binary. The stand-in
  // behaves like it: it treats the worker path as an unknown subcommand and exits non-zero.
  const host = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-humanizer-bun-host-"));
  const hostBinary = path.join(host, "opencode");
  await fs.writeFile(hostBinary, "#!/bin/sh\necho \"unknown command: $1\" >&2\nexit 1\n", { mode: 0o755 });
  const realExecPath = process.execPath;
  process.execPath = hostBinary;
  try {
    await temporary(async (_root, guard) => {
      await assert.rejects(
        guard.before(request("write", "deliverable.md", { content: "Source: unrequested report\n" })),
        /LIT_HUMANIZER_BLOCKED.*en-plain-meta-label/u
      );
    });
  } finally {
    process.execPath = realExecPath;
    await fs.rm(host, { recursive: true, force: true });
  }
});

test("the rule set carries the three pledge rules at block tier and the widened status-negation at warn", () => {
  for (const id of pledgeRuleIds) {
    assert.equal(shippedRules.find((rule) => rule.id === id)?.severity, "block", id);
  }
  assert.equal(shippedRules.find((rule) => rule.id === "ko-negative-pledge")?.scope, "line");
  assert.equal(shippedRules.find((rule) => rule.id === "ko-negative-pledge-repeat")?.scope, "document");
  assert.equal(shippedRules.find((rule) => rule.id === "en-negative-pledge")?.scope, "sentence");
  assert.equal(shippedRules.find((rule) => rule.id === "ko-status-negation")?.severity, "warn");
  assert.equal(shippedRules.length, 54);
});

test("all 15 pledges land on the expected rule and tier through the shipped engine", () => {
  assert.equal(pledgeCases.pledges.length, 15);
  for (const pledge of pledgeCases.pledges) {
    const hits = scanText(pledge.text, shippedRules, "pledge.md");
    if (pledge.severity === "none") {
      assert.deepEqual(hits.map((hit) => hit.rule), [], `pledge ${pledge.n} must stay clean`);
      continue;
    }
    const top = Math.max(0, ...hits.map((hit) => severityRank[hit.severity]));
    assert.equal(top, severityRank[pledge.severity], `pledge ${pledge.n} top tier`);
    assert.ok(hits.some((hit) => hit.rule === pledge.rule && hit.severity === pledge.severity),
      `pledge ${pledge.n} must hit ${pledge.rule}/${pledge.severity}, got ${JSON.stringify(hits.map((hit) => hit.rule))}`);
  }
});

test("no near-miss, reviewed sentence or operating rule hits a pledge rule", () => {
  for (const group of ["near_misses", "near_misses_review"]) {
    assert.ok(pledgeCases[group].length > 0, group);
    for (const near of pledgeCases[group]) {
      const hits = scanText(near.text, shippedRules, "near-miss.md").filter((hit) => pledgeRuleIds.has(hit.rule));
      assert.deepEqual(hits.map((hit) => hit.rule), [], `${group}: ${near.text}`);
    }
  }
});

test("whole-document cases block or stay clean exactly as expected for their rule", () => {
  assert.equal(pledgeCases.document_cases.length, 8);
  for (const doc of pledgeCases.document_cases) {
    const blocked = scanText(doc.text, shippedRules, "document.md").some((hit) => hit.rule === doc.rule && hit.severity === "block");
    assert.equal(blocked, doc.expect === "block", `${doc.rule} expected ${doc.expect}: ${JSON.stringify(doc.text)}`);
  }
});

test("pre-write guard refuses every block-tier pledge and names the rule, and lets warn-only and clean text pass", async () => {
  await temporary(async (_root, guard) => {
    let index = 0;
    for (const pledge of pledgeCases.pledges) {
      index += 1;
      const input = { ...request("write", "deliverable.md", { content: `${pledge.text}\n` }), callID: `pledge-${index}` };
      if (pledge.severity === "block") {
        await assert.rejects(guard.before(input), new RegExp(`LIT_HUMANIZER_BLOCKED rule=${pledge.rule}\\b`, "u"), `pledge ${pledge.n}`);
      } else {
        await guard.before(input);
      }
    }
    let nearIndex = 0;
    for (const near of [...pledgeCases.near_misses, ...pledgeCases.near_misses_review]) {
      nearIndex += 1;
      await guard.before({ ...request("write", "deliverable.md", { content: `${near.text}\n` }), callID: `near-miss-${nearIndex}` });
    }
  });
});

test("pre-write guard still refuses a pledge when a later line is padded with long whitespace runs, and answers inside its own scan timeout", async () => {
  const userSentence = "동일 조건의 독립 성능 비교로 쓰지 않음.";
  const padded = [
    ["emphasis lookalike after a status word", `${userSentence}\n검증된${" ".repeat(4096)}x\n`],
    ["pledge verb followed by a very long run", `${userSentence}\n해석하지${" ".repeat(65536)}x\n`]
  ];
  await temporary(async (_root, guard) => {
    let index = 0;
    for (const [label, content] of padded) {
      index += 1;
      const started = performance.now();
      await assert.rejects(
        guard.before({ ...request("write", "deliverable.md", { content }), callID: `padded-${index}` }),
        /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u,
        label
      );
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 1000, `${label}: guard took ${Math.round(elapsed)} ms, scan timeout is 1500 ms`);
    }
  });
});

test("pre-write guard refuses a pledge that an edit adds and keeps a pledge that was already in the file", async () => {
  await temporary(async (root, guard) => {
    const pledge = pledgeCases.pledges[0].text;
    await fs.writeFile(path.join(root, "report.md"), `${pledge}\nBody line.\n`, "utf8");
    await guard.before(request("edit", "report.md", { oldString: "Body line.", newString: "Body line, revised." }));
    await assert.rejects(
      guard.before(request("edit", "report.md", { oldString: "Body line.", newString: pledgeCases.pledges[1].text })),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
  });
});
