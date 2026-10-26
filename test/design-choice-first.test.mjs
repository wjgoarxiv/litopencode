import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Each design skill asks the user to pick the look with OpenCode's question tool before the step that builds.
const designSkills = [
  ["lit-pptx", "**Compile.**"],
  ["lit-docx", "**Convert.**"],
  ["frontend-ui-ux", "scripts/design-lock.mjs init"],
  ["lit-schematic", "**Build.**"],
  ["lit-diagram-drawer", "**Draft a complete static document.**"],
  ["readme-studio", "Compose original pixel accents"],
  ["lit-typographic-motion", "Round 1 (stills)"],
];

function procedure(id) {
  const skill = readFileSync(join(root, "skills", id, "SKILL.md"), "utf8");
  const start = skill.indexOf("## #contract.procedure");
  assert.ok(start >= 0, `${id} has a procedure section`);
  return skill.slice(start);
}

describe("design skills ask for the look first", () => {
  for (const [id, buildStep] of designSkills) {
    it(`${id} asks with the question tool before ${buildStep}`, () => {
      const text = procedure(id);
      const ask = text.indexOf("OpenCode's `question` tool");
      const build = text.indexOf(buildStep);
      assert.ok(ask >= 0, `${id} names OpenCode's question tool`);
      assert.ok(build >= 0, `${id} still has its build step`);
      assert.ok(ask < build, `${id} asks before it builds`);
      const step = text.slice(Math.max(0, ask - 600), ask + 600);
      assert.match(step, /two to four/u, `${id} offers two to four options`);
      assert.match(step, /Recommended/u, `${id} puts the recommended option first`);
      assert.match(step, /you choose/u, `${id} skips the question when the user leaves the choice open`);
      assert.match(step, /non-interactive|cannot ask/u, `${id} names the non-interactive fallback`);
      assert.match(step, /say(?:s)? so in one line/u, `${id} reports the fallback pick in one line`);
    });
  }
});

describe("design routes carry the same ask-first rule", () => {
  const cases = [
    ["frontend-ui-ux", "lit build a landing page for a kayak rental", /lock the look/u],
    ["lit-task", "lit draw a P&ID for a pump skid", /load lit-schematic/u],
    ["lit-task", "lit draw an architecture diagram of the login flow", /load lit-diagram-drawer/u],
    ["lit-task", "lit make a 10 slide deck about our Q3 results", /load lit-pptx/u],
    ["lit-task", "lit write a report docx on warehouse safety", /load lit-docx/u],
    ["lit-task", "make a short video explaining how a heat pump moves warmth lit", /load lit-typographic-motion/u],
  ];
  for (const [mode, text, load] of cases) {
    it(`${text} asks before building`, async () => {
      const { promptForChatActivationMode } = await import("../dist/activation-routing.js");
      const prompt = promptForChatActivationMode(mode, text);
      assert.match(prompt, load);
      assert.match(prompt, /ask the user to pick it with OpenCode's question tool: two to four options, the recommended one first/u);
      assert.match(prompt, /non-interactive run with no question tool, take the recommended option and say so in one line/u);
      assert.doesNotMatch(prompt, /without asking a style question|ask no questions/u);
    });
  }
});
