import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { findLitOpenCodeCommand } from "../src/commands.ts";

const skillPath = new URL("../skills/litresearch/SKILL.md", import.meta.url);

test("LitResearch documents root-owned bounded research state and convergence", async () => {
  const body = await fs.readFile(skillPath, "utf8");
  for (const phrase of [
    "Root-owned research protocol",
    "native `task` tool",
    "sequentially",
    ".litopencode/litgoal/lit-loop/research/<run-id>/",
    "claim-graph.jsonl",
    "supports",
    "contradicts",
    "12 minutes total elapsed research budget",
    "at most 10 distinct source pages",
    "at most two waves total",
    "There is no minimum wave count",
    "## Requested-coverage matrix",
    "Map every requested category and deliverable field",
    "Do not replace a requested comparison with a related but unrequested fact.",
    "## Scientific-record pipeline",
    "needs_review",
    "%PDF",
    "Deliberate non-ports",
    "## Report contract",
    "## EXPAND"
  ]) assert.ok(body.includes(phrase), `missing LitResearch contract phrase: ${phrase}`);
  assert.match(body, /For a version comparison, pair each dimension across the named versions and state one\s+concrete migration effect\./u);
  assert.match(body, /child(?:ren)?\s+(?:has|have) no task delegation/i);
  assert.match(body, /untrusted data/i);
});

test("research command aliases select the root execution agent and research telemetry mode", () => {
  for (const id of ["litresearch", "lit-research"]) {
    const command = findLitOpenCodeCommand(id);
    assert.equal(command?.agent, "lit-loop", id);
    assert.match(command?.activationText ?? "", /litresearch/i, id);
  }
});
