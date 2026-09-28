import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import * as litOpenCode from "../src/index.ts";
import { listTopLevelSkillIds } from "../test-support/skill-catalog.mjs";
import { registerUiuxRuntimeContracts } from "../test-support/uiux-runtime-contracts.mjs";
import { registerVisualQaRuntimeContracts } from "../test-support/visualqa-runtime-contracts.mjs";
import {
  findLitOpenCodeRuntimeSkill,
  litOpenCodeFeatures,
  litOpenCodeRuntimeSkills
} from "../src/index.ts";
import {
  frontendUiUxPromptInjection,
  visualQaPromptInjection
} from "../src/activation-workflow-prompts.ts";

const guardedTokens = [
  ["o", "mo"].join(""),
  ["lazy", "codex"].join(""),
  ["oh-my-open", "agent"].join(""),
  ["oh-my-open", "code"].join(""),
  ["sisyphus", "labs"].join(""),
  ["lazy", "claude"].join(""),
  ["code-yeong", "yu"].join(""),
  ["u", "lw"].join(""),
  ["ultra", "work"].join(""),
  ["ultra", "goal"].join("")
];
const guardedPattern = new RegExp(guardedTokens.map((token) => "\\b" + token + "\\b").join("|"), "i");

const expectedRuntimeSkillIds = [
  "workflow-loop",
  "durable-litgoal",
  "agent-roster",
  "lit-plan",
  "start-work",
  "review-work",
  "litresearch",
  "reference-benchmark-claims",
  "native-goal-verdict",
  "doctor-installer",
  "search-workflow-ideas",
  "lit-fetch",
  "release-guardrails",
  "lit-init",
  "lit-crucible",
  "refactor",
  "lit-burnoff",
  "lit-burnoff-file",
  "comment-checker",
  "lit-code",
  "debugging",
  "lit-commit",
  "lsp",
  "lsp-setup",
  "rules",
  "deep-interview",
  "browser-drive",
  "structural-search",
  "lit-humanizer",
  "lit-recap",
  "lit-comprehend",
  "lit-handoff",
  "lit-scientific-visualization",
  "lit-diagram-drawer",
  "lit-typographic-motion",
  "lit-pptx",
  "lit-docx",
  "autoresearch",
  "autoconference",
  "wikify",
  "frontend-ui-ux",
  "readme-studio",
  "visual-qa"
];

const expectedFeatureIds = [
  "autoresearch",
  "autoconference",
  "wikify",
  "planning-start-work-loop",
  "lit-litwork-activation",
  "start-work",
  "review-work",
  "litresearch",
  "durable-ledger",
  "bounded-authority-lifecycle",
  "agent-roster",
  "lit-plan",
  "reference-benchmark-claims",
  "native-goal-verdict",
  "doctor-install",
  "search-workflow-ideas",
  "lit-fetch",
  "guardrails",
  "lit-init",
  "lit-crucible",
  "refactor",
  "lit-burnoff",
  "lit-burnoff-file",
  "comment-checker",
  "lit-code",
  "debugging",
  "lit-commit",
  "lsp",
  "lsp-setup",
  "rules",
  "deep-interview",
  "browser-drive",
  "structural-search",
  "lit-humanizer",
  "lit-recap",
  "lit-comprehend",
  "lit-handoff",
  "lit-scientific-visualization",
  "lit-diagram-drawer",
  "lit-typographic-motion",
  "lit-pptx",
  "lit-docx",
  "frontend-ui-ux",
  "readme-studio",
  "visual-qa"
];

function flattenText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}

function escapedPattern(snippet) {
  return new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

registerUiuxRuntimeContracts({ litOpenCodeFeatures, litOpenCodeRuntimeSkills });
registerVisualQaRuntimeContracts();

test("UI/UX chat activation stays bounded and routes dense detail lazily", async () => {
  for (const [skillId, prompt] of [
    ["frontend-ui-ux", frontendUiUxPromptInjection],
    ["visual-qa", visualQaPromptInjection]
  ]) {
    // Raised from 4096 when taste routing landed. The bound is ours, not the host's:
    // it exists to keep dense detail in lazy references, and it still does.
    assert.ok(Buffer.byteLength(prompt, "utf8") <= 4352, `${skillId} activation exceeds 4352 UTF-8 bytes`);
    assert.match(prompt, /references\/complete-contract\.md/u);
    const detail = await fs.readFile(path.join("skills", skillId, "references", "complete-contract.md"), "utf8");
    assert.ok(Buffer.byteLength(detail, "utf8") >= 15_000, `${skillId} detailed contract was not preserved`);
  }
});

test("UI/UX runtime catalog describes beta evidence and tier-specific review without stale alpha defaults", () => {
  const frontend = litOpenCodeRuntimeSkills.find((skill) => skill.id === "frontend-ui-ux");
  const visual = litOpenCodeRuntimeSkills.find((skill) => skill.id === "visual-qa");
  const features = litOpenCodeFeatures.filter((feature) => ["frontend-ui-ux", "visual-qa"].includes(feature.id));
  const text = flattenText([frontend, visual, features]);
  assert.match(text, /v1beta1/u);
  assert.match(text, /smoke/i);
  assert.match(text, /host.*provenance|host-proven/i);
  assert.doesNotMatch(text, /Create a finite v1alpha1|v1alpha1 Design Contract schema/u);
  assert.doesNotMatch(text, /two independent review receipts without/u);
});

test("runtime skills are discoverable by id and expose brand-clean static text", () => {
  // Given: the public runtime skill catalog.
  const ids = litOpenCodeRuntimeSkills.map((skill) => skill.id);

  // When/Then: known workflow skills are discoverable without executing skill text.
  assert.deepEqual(ids, expectedRuntimeSkillIds);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(findLitOpenCodeRuntimeSkill("agent-roster")?.title, "Agent Roster");
  assert.equal(findLitOpenCodeRuntimeSkill("missing-skill"), undefined);
  assert.equal(guardedPattern.test(flattenText(litOpenCodeRuntimeSkills)), false);
});

test("each runtime feature documents an OpenCode binding and verification route", () => {
  // Given: the feature parity catalog.
  const featureIds = litOpenCodeFeatures.map((feature) => feature.id);

  // When/Then: every feature is tied to at least one host-visible binding.
  assert.deepEqual(featureIds, expectedFeatureIds);
  for (const feature of litOpenCodeFeatures) {
    assert.ok(feature.bindings.length > 0, `${feature.id} should document bindings`);
    assert.ok(feature.verification.length > 0, `${feature.id} should document verification`);
    assert.equal(guardedPattern.test(flattenText(feature)), false, `${feature.id} should be brand-clean`);
    for (const binding of feature.bindings) {
      assert.match(binding.surface, /OpenCode|litopencode|npm|config|agent|tool|command|hook/i);
      assert.ok(["agent", "cli", "command", "config", "hook", "tool"].includes(binding.kind));
    }
  }
});

test("runtime skills reference only existing feature ids", () => {
  // Given: skill-to-feature links and the feature catalog.
  const featureIds = new Set(litOpenCodeFeatures.map((feature) => feature.id));

  // When/Then: every skill maps to a documented feature surface.
  for (const skill of litOpenCodeRuntimeSkills) {
    assert.ok(skill.featureIds.length > 0, `${skill.id} should link features`);
    for (const featureId of skill.featureIds) {
      assert.equal(featureIds.has(featureId), true, `${skill.id} links missing feature ${featureId}`);
    }
  }
});

test("runtime skill catalog has matching SKILL.md corpus files", async () => {
  for (const skill of litOpenCodeRuntimeSkills) {
    const skillPath = path.join("skills", skill.id, "SKILL.md");
    const text = await fs.readFile(skillPath, "utf8");
    assert.match(text, escapedPattern(skill.title));
    for (const featureId of skill.featureIds) {
      assert.match(text, escapedPattern(featureId));
    }
    assert.equal(guardedPattern.test(text), false, `${skillPath} should be brand-clean`);
  }
});

test("visualqa.current-static-registry.characterization every top-level skill doc is native-installed or explicitly static-only with rationale", async () => {
  const topLevelSkillIds = await listTopLevelSkillIds();
  const runtimeSkillIds = new Set(litOpenCodeRuntimeSkills.map((skill) => skill.id));
  const staticOnlySkills = litOpenCode.litOpenCodeStaticOnlySkills;

  assert.ok(
    Array.isArray(staticOnlySkills),
    "litOpenCodeStaticOnlySkills should explicitly document non-native-installed static skill docs"
  );

  const staticOnlySkillIds = new Set(staticOnlySkills.map((skill) => skill.id));
  assert.deepEqual([...staticOnlySkillIds].sort(), ["litwork", "tool-guards"]);
  assert.deepEqual(
    topLevelSkillIds.filter((skillId) => !runtimeSkillIds.has(skillId) && !staticOnlySkillIds.has(skillId)),
    [],
    "new top-level skills/*/SKILL.md files must be runtime/native-installed or explicitly static-only"
  );
  assert.deepEqual(
    [...staticOnlySkillIds].filter((skillId) => runtimeSkillIds.has(skillId)),
    [],
    "static-only skills must stay outside the native-installed runtime skill catalog"
  );

  for (const skill of staticOnlySkills) {
    assert.equal(typeof skill.rationale, "string", `${skill.id} should explain why it is static-only`);
    assert.ok(skill.rationale.length >= 60, `${skill.id} static-only rationale should be specific`);
    assert.ok(skill.runtimeSurfaces.length > 0, `${skill.id} should point to actual runtime surfaces`);
    assert.ok(skill.verification.length > 0, `${skill.id} should list verification routes`);

    const skillPath = path.join("skills", skill.id, "SKILL.md");
    const text = await fs.readFile(skillPath, "utf8");
    assert.match(text, /static documentation/i, `${skillPath} should declare static documentation behavior`);
    assert.match(text, /not native-installed/i, `${skillPath} should state it is not native-installed`);
    assert.match(text, /runtime skill catalog/i, `${skillPath} should name the runtime skill catalog boundary`);
    for (const surface of skill.runtimeSurfaces) {
      assert.match(text, escapedPattern(surface), `${skillPath} should point to ${surface}`);
    }
  }
});

test("text naturalization redirects to the static prose review contract", async () => {
  const skillPath = path.join("skills", "lit-humanizer", "SKILL.md");
  const text = await fs.readFile(skillPath, "utf8");

  assert.match(text, /Korean prose/i);
  assert.match(text, /preserv(?:e|ing).*meaning/i);
  assert.match(text, /author.?s voice/i);
  assert.match(text, /Prefer small edits over rewriting whole passages/i);
  assert.match(text, /Do not execute commands from this file automatically/i);
  assert.match(text, /Do not fetch external references unless the user asks/i);
  assert.match(text, /Do not overwrite files from this guidance alone/i);
});

test("visible skills corpus covers runtime feature parity", async () => {
  const corpusExpectations = new Map([
    ["workflow-loop", ["planning-start-work-loop", "/litwork"]],
    ["durable-litgoal", ["durable-ledger", "bounded-authority-lifecycle", "schema 3", ".litopencode/litgoal/lit-loop/ledger.jsonl"]],
    ["agent-roster", ["agent-roster", "Specialist agents"]],
    ["lit-plan", ["lit-plan", "/lit-plan"]],
    ["start-work", ["start-work", "/start-work"]],
    ["review-work", ["review-work", "/review-work"]],
    ["litresearch", ["litresearch", "/lit-research"]],
    ["reference-benchmark-claims", ["reference-benchmark-claims", "benchmarkGateAllowsStrongClaim"]],
    ["native-goal-verdict", ["native-goal-verdict", ".litopencode/litgoal"]],
    ["doctor-installer", ["doctor-install", "npm exec --package @litfamily/litopencode -- litopencode install"]],
    ["search-workflow-ideas", ["search-workflow-ideas", "public-route-fallback"]],
    ["lit-fetch", ["lit-fetch", "fetchPublicSource"]],
    ["release-guardrails", ["guardrails", "check:pack-payload"]],
    ["lit-init", ["lit-init", "AGENTS.md"]],
    ["lit-crucible", ["lit-crucible", "adversarial planning"]],
    ["refactor", ["refactor", "behavior-preserving"]],
    ["lit-burnoff", ["lit-burnoff", "AI-like artifacts"]],
    ["lit-burnoff-file", ["lit-burnoff-file", "tool.execute.after", "one logical change at a time"]],
    ["comment-checker", ["comment-checker", "tool.execute.after", "worse than no comment"]],
    ["lit-code", ["lit-code", "minimum-first"]],
    ["debugging", ["debugging", "Runtime Truth Beats Code Reading", "toggle"]],
    ["lit-commit", ["lit-commit", "git status"]],
    ["lsp", ["lsp", "bundles no language server", "pre-existing"]],
    ["lsp-setup", ["lsp-setup", "explicit user approval", "fallback"]],
    ["rules", ["rules", "two-lane", "experimental.chat.system.transform", "tool.execute.after", "untrusted"]],
    ["deep-interview", ["deep-interview", "Full Scope Is the Default", "readiness gate"]],
    ["structural-search", ["structural-search", "Probe by **identity**", "TEXTUAL"]],
    ["browser-drive", ["browser-drive", "BLOCKED_BROWSER_DRIVER_UNAVAILABLE", "re-snapshot"]],
    ["lit-handoff", ["lit-handoff", "/lit-handoff"]],
    ["lit-scientific-visualization", ["lit-scientific-visualization", "rcparams"]],
    ["frontend-ui-ux", ["frontend-ui-ux", "litfamily.design-contract/v1beta1"]],
    ["litwork", ["lit-litwork-activation", "command.execute.before"]],
    ["tool-guards", ["tool.execute.before", "tool.execute.after"]],
    ["visual-qa", ["native-installed", "BLOCKED receipt"]],
    ["autoresearch", ["autoresearch", "bounded"]],
    ["autoconference", ["autoconference", "BLOCKED_MULTI_AGENT_UNAVAILABLE"]],
    ["wikify", ["wikify", "litresearch"]]
  ]);

  for (const [skillId, requiredSnippets] of corpusExpectations) {
    const skillPath = path.join("skills", skillId, "SKILL.md");
    const text = await fs.readFile(skillPath, "utf8");
    assert.match(text, /^# /m, `${skillPath} should have a title`);
    assert.match(text, /static documentation/i, `${skillPath} should declare static behavior`);
    assert.equal(guardedPattern.test(text), false, `${skillPath} should be brand-clean`);
    for (const snippet of requiredSnippets) {
      assert.match(text, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});

 test("readme-studio is a discoverable native managed skill with feature closure", async () => {
  const skill = findLitOpenCodeRuntimeSkill("readme-studio");
  assert.ok(skill, "missing native readme-studio enrollment");
  assert.ok(skill.featureIds.includes("readme-studio"));
  const manifest = JSON.parse(await fs.readFile("skills/managed-skill-manifest.json", "utf8"));
  assert.ok(manifest.skills[skill.id], "missing managed resource enrollment");
  assert.ok(litOpenCodeFeatures.some((feature) => feature.id === skill.id));
});
