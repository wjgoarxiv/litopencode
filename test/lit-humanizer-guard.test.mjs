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
  assert.equal(pledgeCases.document_cases.length, 13);
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

function patchRequest(patchText, callID = "patch-call", tool = "apply_patch") {
  return { tool, sessionID: "humanizer-session", callID, args: { patchText } };
}

const userPledge = "동일 조건의 독립 성능 비교로 쓰지 않음.";

test("pre-write guard refuses a pledge that an apply_patch add-file hunk writes, and lets a near-miss add pass", async () => {
  await temporary(async (_root, guard) => {
    await assert.rejects(
      guard.before(patchRequest(`*** Begin Patch\n*** Add File: report.md\n+# Report\n+${userPledge}\n*** End Patch`)),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
    await guard.before(patchRequest(`*** Begin Patch\n*** Add File: report.md\n+# Report\n+${pledgeCases.near_misses[0].text}\n*** End Patch`, "near-add"));
    // not a reader-facing path: same text is allowed
    await guard.before(patchRequest(`*** Begin Patch\n*** Add File: data.json\n+${userPledge}\n*** End Patch`, "json-add"));
    await guard.before(patchRequest(`*** Begin Patch\n*** Add File: evidence/notes.md\n+${userPledge}\n*** End Patch`, "internal-add"));
  });
});

test("pre-write guard checks apply_patch update hunks and moves against the real file", async () => {
  await temporary(async (root, guard) => {
    await fs.writeFile(path.join(root, "report.md"), "# Report\n본문 첫 줄.\n본문 둘째 줄.\n", "utf8");
    await assert.rejects(
      guard.before(patchRequest(`*** Begin Patch\n*** Update File: report.md\n@@\n # Report\n 본문 첫 줄.\n+${userPledge}\n*** End Patch`)),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
    await guard.before(patchRequest(`*** Begin Patch\n*** Update File: report.md\n@@\n-본문 둘째 줄.\n+본문 둘째 줄을 고쳤다.\n*** End Patch`, "near-update"));
    // a move target is the path that is saved
    await assert.rejects(
      guard.before(patchRequest(`*** Begin Patch\n*** Update File: report.md\n*** Move to: final.md\n@@\n 본문 둘째 줄.\n+${userPledge}\n*** End Patch`, "move")),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
    // one file in a multi-file patch is enough
    await assert.rejects(
      guard.before(patchRequest(`*** Begin Patch\n*** Add File: notes.json\n+{}\n*** Add File: second.md\n+${userPledge}\n*** End Patch`, "multi")),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
  });
});

test("pre-write guard lets an apply_patch hunk remove or keep a pledge that is already in the file", async () => {
  await temporary(async (root, guard) => {
    await fs.writeFile(path.join(root, "report.md"), `# Report\n${userPledge}\n본문.\n`, "utf8");
    await guard.before(patchRequest(`*** Begin Patch\n*** Update File: report.md\n@@\n # Report\n-${userPledge}\n 본문.\n*** End Patch`, "remove"));
    await guard.before(patchRequest(`*** Begin Patch\n*** Update File: report.md\n@@\n-본문.\n+본문을 고쳤다.\n*** End Patch`, "keep"));
    await guard.before(patchRequest(`*** Begin Patch\n*** Delete File: report.md\n*** End Patch`, "delete"));
    // a hunk whose context is missing is still scanned as appended text
    await assert.rejects(
      guard.before(patchRequest(`*** Begin Patch\n*** Update File: report.md\n@@\n 없는 줄.\n+${userPledge.replace("독립", "공정")}\n*** End Patch`, "lost-context")),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
  });
});

test("pre-write guard reports an unparsable apply_patch as unavailable and still allows it", async () => {
  await temporary(async (_root, guard) => {
    const input = patchRequest("not a patch", "bad-patch");
    await guard.before(input);
    const output = { title: "Patch", output: "done", metadata: {} };
    await guard.after(input, output);
    assert.match(output.output, /LIT_HUMANIZER_GUARD_UNAVAILABLE/u);
  });
});

const calloutPledge = "> **주의:** 이 표는 순위가 아닙니다.\n";

test("every pledge seen in produced deliverables lands on its rule and tier, and the block-tier ones are refused before the write", async () => {
  assert.equal(pledgeCases.pledges_observed.length, 26);
  for (const seen of pledgeCases.pledges_observed) {
    const hits = scanText(seen.text, shippedRules, "observed.md");
    assert.ok(hits.some((hit) => hit.rule === seen.rule && hit.severity === seen.severity),
      `${seen.text} must hit ${seen.rule}/${seen.severity}, got ${JSON.stringify(hits.map((hit) => hit.rule))}`);
  }
  await temporary(async (_root, guard) => {
    let index = 0;
    for (const seen of pledgeCases.pledges_observed.filter((entry) => entry.severity === "block")) {
      index += 1;
      await assert.rejects(
        guard.before({ ...request("write", "deliverable.md", { content: `${seen.text}\n` }), callID: `observed-${index}` }),
        new RegExp(`LIT_HUMANIZER_BLOCKED rule=${seen.rule}\\b`, "u"),
        seen.text
      );
    }
  });
});

test("pre-write guard refuses the widened pledge wording in both languages", async () => {
  await temporary(async (_root, guard) => {
    await assert.rejects(
      guard.before(request("write", "deliverable.md", { content: "This table is not a ranking.\n" })),
      /LIT_HUMANIZER_BLOCKED rule=en-negative-pledge\b/u
    );
    await assert.rejects(
      guard.before(request("write", "deliverable.md", { content: "이 문서는 제품을 비교하려는 것이 아닙니다.\n" })),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
  });
});

test("a bold-label callout is read as the author's own text, a plain quote stays quoted", async () => {
  await temporary(async (_root, guard) => {
    await assert.rejects(
      guard.before(request("write", "deliverable.md", { content: calloutPledge })),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
    await assert.rejects(
      guard.before(request("write", "deliverable.md", { content: "> **Note:** This table is not a ranking.\n" })),
      /LIT_HUMANIZER_BLOCKED rule=en-negative-pledge\b/u
    );
    await guard.before(request("write", "plain-quote.md", { content: "> 이 표는 순위가 아닙니다.\n" }));
    await guard.before(request("write", "plain-quote-en.md", { content: "> This table is not a ranking.\n" }));
    // rules without the callout context still skip the quote line
    await guard.before(request("write", "quoted-source.md", { content: "> **출처:** Source: user quote\n" }));
  });
});

test("reviewed false positives stay allowed", async () => {
  await temporary(async (_root, guard) => {
    await guard.before(request("write", "deliverable.md", { content: "숫자와 문자열은 서로 비교할 수 없습니다.\n" }));
    await guard.before(request("write", "deliverable-en.md", { content: "Do not compare these values directly; convert to SI first.\n" }));
  });
});

test("an edit and an apply_patch hunk that add a callout pledge are refused; a plain quote hunk is allowed", async () => {
  await temporary(async (root, guard) => {
    await fs.writeFile(path.join(root, "report.md"), "# Report\nBody line.\n", "utf8");
    await assert.rejects(
      guard.before(request("edit", "report.md", { oldString: "Body line.", newString: `Body line.\n${calloutPledge}` })),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
    await assert.rejects(
      guard.before(patchRequest(`*** Begin Patch\n*** Add File: callout.md\n+# Report\n+> **주의:** 이 표는 순위가 아닙니다.\n*** End Patch`, "callout-add")),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
    await assert.rejects(
      guard.before(patchRequest(`*** Begin Patch\n*** Update File: report.md\n@@\n # Report\n+> **주의:** 이 표는 순위가 아닙니다.\n*** End Patch`, "callout-update")),
      /LIT_HUMANIZER_BLOCKED rule=ko-negative-pledge\b/u
    );
    await guard.before(patchRequest(`*** Begin Patch\n*** Add File: quote.md\n+# Report\n+> 이 표는 순위가 아닙니다.\n*** End Patch`, "quote-add"));
    await fs.writeFile(path.join(root, "kept.md"), `# Report\n${calloutPledge}`, "utf8");
    await guard.before(request("edit", "kept.md", { oldString: "# Report", newString: "# Report v2" }));
  });
});
