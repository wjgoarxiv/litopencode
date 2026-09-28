import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { startWorkPromptInjection } from "../src/activation.ts";
import { litOpenCodeAgents } from "../src/agents.ts";

test("execution agents and start-work expose the OpenCode-native advisory 20 ceiling", () => {
  // Given: the registered default agent prompts and start-work activation text.
  const byId = new Map(litOpenCodeAgents.map((agent) => [agent.id, agent]));

  // When: execution surfaces are inspected as users and workers receive them.
  const executionText = [
    byId.get("lit-loop")?.prompt ?? "",
    byId.get("lit-implement")?.prompt ?? "",
    startWorkPromptInjection
  ].join("\n");

  // Then: they cap concurrent delegation at 20 without claiming host hard enforcement.
  assert.match(executionText, /at most 20 concurrent subagents/i);
  assert.match(executionText, /advisory/i);
  assert.match(executionText, /no verified .*hard-limit setting/i);
  assert.equal(byId.get("lit-plan")?.tools.includes("write"), false);
  assert.equal(byId.get("lit-plan")?.tools.includes("edit"), false);
  assert.equal(byId.get("lit-plan")?.tools.includes("bash"), false);
});

test("installed start-work guidance and release docs state capability limits accurately", async () => {
  // Given: the shipped skill/operational reference and repository-only release checklist.
  const [skill, readme, checklist] = await Promise.all([
    fs.readFile("skills/start-work/SKILL.md", "utf8"),
    fs.readFile("docs/reference.md", "utf8"),
    fs.readFile("docs/release-checklist.md", "utf8")
  ]);

  // When: capability wording is read from the corresponding documentation surfaces.
  const corpus = [skill, readme, checklist].join("\n");

  // Then: SOL/LUNA routing, offered efforts, explicit-selection 372K/334.8K limits, and advisory 20 are explicit.
  assert.match(corpus, /gpt-5\.6-sol/);
  assert.match(corpus, /gpt-5\.6-luna/);
  assert.match(corpus, /high.*xhigh.*max/is);
  assert.match(corpus, /372K.*context.*ceiling/is);
  assert.match(corpus, /334\.8K.*compaction/is);
  assert.match(corpus, /default.*preserv|no-model-prompt.*preserv/is);
  assert.match(corpus, /20.*advisory/is);
  assert.doesNotMatch(corpus, /hard-enforced 20|hard 20-worker/i);
});
