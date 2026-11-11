import assert from "node:assert/strict";
import { test } from "node:test";
import { promptForChatActivationMode } from "../src/activation-routing.ts";
import { litOpenCodeDefaultAgents } from "../src/agents/defaults.ts";
import { readFileSync } from "node:fs";

test("loop and approved-plan agents hand user-facing web work to the measured interface gate", () => {
  for (const id of ["lit-loop", "lit-implement"]) {
    const prompt = litOpenCodeDefaultAgents.find((agent) => agent.id === id)?.prompt;
    assert.match(prompt, /user-facing web interface/);
    assert.match(prompt, /frontend-ui-ux/);
    assert.match(prompt, /probe\.mjs --path/);
    assert.match(prompt, /RS matrix/);
    assert.match(prompt, /HIGH/);
    assert.match(prompt, /CLI or backend-only/);
  }
});

test("loop activation adds a concrete hand-off for interface work only", () => {
  const ui = promptForChatActivationMode("lit-loop", "Create a web app with a user-facing dashboard lit");
  assert.match(ui, /Interface hand-off for this request:/);
  assert.match(ui, /frontend-ui-ux/);
  assert.match(ui, /probe\.mjs --path/);
  for (const request of ["Implement a CLI parser lit", "Build a backend-only API lit"]) {
    assert.doesNotMatch(promptForChatActivationMode("lit-loop", request), /Interface hand-off for this request:/);
  }
});

test("the installed interface pointer gives its install line, and the hand-off says to report the slice unverified", () => {
  const skill = readFileSync(new URL("../skills/frontend-ui-ux/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /wjgoarxiv-skills/);
  assert.ok(skill.includes('cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/frontend-ui-ux" ~/.config/opencode/skills/frontend-ui-ux'));
  const ui = promptForChatActivationMode("lit-loop", "Create a web app with a user-facing dashboard lit");
  assert.match(ui, /report the interface slice as unverified/);
});
