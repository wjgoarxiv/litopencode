import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDeliverableHedgeGuard } from "../src/deliverable-hedge-guard.ts";
import * as engine from "../skills/lit-humanizer/scripts/core.mjs";

const cases = JSON.parse(readFileSync(new URL("./fixtures/lit-humanizer/negation-cluster-cases.json", import.meta.url), "utf8"));
const advice = /Say what the thing is first, then add the caveat once\. Example: write "18,420 visits in total, including repeat visits" instead of "18,420 is not the number of residents"\./u;

function clusterHits(text, file = "deliverable.md") {
  assert.equal(typeof engine.negationClusterFindings, "function", "core.mjs must export negationClusterFindings");
  return engine.negationClusterFindings(text, file).filter((finding) => finding.rule === "negation-cluster");
}

function tierOf(text) {
  const hits = clusterHits(text);
  if (hits.some((hit) => hit.severity === "block")) return "block";
  return hits.some((hit) => hit.severity === "warn") ? "warn" : null;
}

async function guarded(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-negation-cluster-"));
  const guard = createDeliverableHedgeGuard({ projectRoot: root });
  try {
    await run(guard);
  } finally {
    guard.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeThrough(guard, callID, content, filePath = "reports/summary.md") {
  const input = { tool: "write", sessionID: "negation-session", callID, args: { filePath, content } };
  await guard.before(input);
  const output = { title: "Write", output: `Wrote ${filePath}`, metadata: {} };
  await guard.after(input, output);
  return output;
}

test("the fixture set keeps sixteen positive and eighteen negative negation-cluster cases", () => {
  assert.equal(cases.positive.length, 16);
  assert.equal(cases.negative.length, 18);
  assert.ok(cases.positive.every((fixture) => fixture.expect === "block" || fixture.expect === "warn"));
});

test("every positive fixture gets its expected negation-cluster tier", () => {
  for (const fixture of cases.positive) {
    assert.equal(tierOf(fixture.text), fixture.expect, fixture.id);
  }
});

test("no negative fixture gives a negation-cluster finding", () => {
  for (const fixture of cases.negative) {
    assert.deepEqual(clusterHits(fixture.text), [], fixture.id);
  }
});

test("reworded negations count: two Korean rewords block, one stays silent", () => {
  assert.equal(tierOf("이용자 수로 읽을 수 없음. 주민 수로 보지 않음."), "block");
  assert.equal(tierOf("18,420명으로 읽을 수 없습니다."), null);
  assert.equal(tierOf("It does not mean residents and should not be read as a forecast."), "warn");
});

test("an English negation glued to a Hangul word is not counted", () => {
  assert.deepEqual(clusterHits("값은is not final, 수치는is not a count, 비율은isn't fixed."), []);
});

test("internal paths stay exempt from the negation-cluster check", () => {
  assert.deepEqual(clusterHits(cases.positive[0].text, "plans/notes.md"), []);
});

test("pre-write guard refuses every block-tier positive with the positive-first advice", async () => {
  await guarded(async (guard) => {
    for (const [index, fixture] of cases.positive.filter((item) => item.expect === "block").entries()) {
      const input = { tool: "write", sessionID: "negation-session", callID: `neg-block-${index}`, args: { filePath: "reports/summary.md", content: `${fixture.text}\n` } };
      await assert.rejects(guard.before(input), (error) => {
        assert.match(error.message, /^LIT_HUMANIZER_BLOCKED rule=negation-cluster /u, fixture.id);
        assert.match(error.message, advice, fixture.id);
        return true;
      });
    }
  });
});

test("pre-write guard lets each warn-tier positive through with the positive-first notice", async () => {
  await guarded(async (guard) => {
    for (const [index, fixture] of cases.positive.filter((item) => item.expect === "warn").entries()) {
      const output = await writeThrough(guard, `neg-warn-${index}`, `${fixture.text}\n`);
      assert.equal(output.metadata.litopencodeHumanizerGuard?.tier, "warn", fixture.id);
      assert.match(output.output, /LIT_HUMANIZER_WARN[^\n]*negation-cluster/u, fixture.id);
      assert.match(output.output, advice, fixture.id);
    }
  });
});

test("pre-write guard adds no notice for any negative fixture", async () => {
  await guarded(async (guard) => {
    for (const [index, fixture] of cases.negative.entries()) {
      const output = await writeThrough(guard, `neg-neg-${index}`, `${fixture.text}\n`);
      assert.equal(output.output, "Wrote reports/summary.md", fixture.id);
      assert.equal(output.metadata.litopencodeHumanizerGuard, undefined, fixture.id);
    }
  });
});

test("a negation cluster already in the file is not reported again by an unrelated edit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-negation-cluster-edit-"));
  const guard = createDeliverableHedgeGuard({ projectRoot: root });
  try {
    await fs.mkdir(path.join(root, "reports"), { recursive: true });
    await fs.writeFile(path.join(root, "reports", "old.md"), `${cases.positive[0].text}\n\nKeep this line.\n`, "utf8");
    const input = {
      tool: "edit", sessionID: "negation-session", callID: "neg-edit",
      args: { filePath: "reports/old.md", oldString: "Keep this line.", newString: "Keep this clear line." }
    };
    await guard.before(input);
    const output = { title: "Edit", output: "Edited reports/old.md", metadata: {} };
    await guard.after(input, output);
    assert.equal(output.output, "Edited reports/old.md");
  } finally {
    guard.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a flood of negation-cluster warns cannot push a real block past the detector output cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-negation-cluster-flood-"));
  const guard = createDeliverableHedgeGuard({ projectRoot: root, timeoutMs: 60_000 });
  try {
    const content = `${"is not is not\n\n".repeat(250_000)}Source: draft report\n`;
    const input = { tool: "write", sessionID: "negation-session", callID: "neg-flood", args: { filePath: "reports/flood.md", content } };
    await assert.rejects(guard.before(input), /LIT_HUMANIZER_BLOCKED.*en-plain-meta-label/u);
  } finally {
    guard.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
