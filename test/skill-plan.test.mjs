import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { detectChatActivationMode, skillPlanCompanions, skillPlanForPrompt } from "../src/activation-routing.ts";
import { createChatMessageActivationHook } from "../src/activation.ts";
import { buildSkillPlan, installedExtensionSkills, parseSkillHatch, skillPlanCap } from "../src/skill-plan.ts";

const plan = (text, installed) => {
  const mode = detectChatActivationMode(text);
  return mode === undefined ? undefined : skillPlanForPrompt(mode, text, installed);
};

test("a lit prompt that matches several content routes gets a capped, ordered skill plan", () => {
  const text = "lit build a dashboard page that plots the experiment results as a chart";
  assert.deepEqual([...skillPlanCompanions(text)], ["frontend-ui-ux", "lit-scientific-visualization"]);
  const block = plan(text);
  assert.ok(block);
  assert.match(block, /^<litopencode-skill-plan>\nSkill plan: 1 frontend-ui-ux \(primary\) \(not installed: litopencode extensions install frontend-ui-ux lit-scientific-visualization --yes\) → 2 lit-scientific-visualization \(not installed\)\n/u);
  assert.match(block, /native skill tool/u);
});

test("a Korean lit prompt collects its companions the same way", () => {
  const block = plan("lit 실험 데이터로 그래프를 그리고 발표자료 만들어줘");
  assert.ok(block);
  assert.match(block, /lit-pptx/u);
  assert.match(block, /lit-scientific-visualization/u);
});

test("a plain lit prompt stays one route and adds no plan block", () => {
  assert.equal(plan("lit fix the failing unit test in src/ledger.ts"), undefined);
  assert.equal(plan("build a dashboard page that plots experiment results"), undefined, "no lit word, no plan");
});

test("quoted, fenced and back-ticked text never adds a companion", () => {
  assert.equal(plan('lit fix the typo in "make a slide deck and a chart of the results"'), undefined);
  assert.equal(plan("lit fix the parser\n```\nmake a deck of the experiment results chart\n```"), undefined);
  assert.equal(plan("lit fix `draw an architecture diagram` in the README"), undefined);
});

test("an installed extension is named plainly and joins the catalog; a missing one gets one install line", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-skill-plan-"));
  try {
    const folder = path.join(root, "skills", "lit-scientific-visualization");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, ".litfamily-extension.json"), JSON.stringify({ id: "lit-scientific-visualization", variant: "litopencode", source: "x", installed_at: "now" }));
    const otherVariant = path.join(root, "skills", "lit-pptx");
    await fs.mkdir(otherVariant, { recursive: true });
    await fs.writeFile(path.join(otherVariant, ".litfamily-extension.json"), JSON.stringify({ id: "lit-pptx", variant: "litgrok" }));
    const installed = installedExtensionSkills(root);
    assert.deepEqual([...installed], ["lit-scientific-visualization"]);
    const block = plan("lit build a dashboard page that plots the experiment results as a chart", installed);
    assert.match(block, /2 lit-scientific-visualization \(user types \/lit-scientific-visualization\)/u);
    assert.match(block, /1 frontend-ui-ux \(primary\) \(not installed: litopencode extensions install frontend-ui-ux --yes\)/u);
    assert.doesNotMatch(block, /Catalog[^\n]*lit-pptx/u, "an uninstalled extension never appears in the catalog");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the plan never exceeds three skills and says what it left out", () => {
  const built = buildSkillPlan({ primary: "lit", companions: ["lit-docx", "lit-pptx", "lit-diagram-drawer", "frontend-ui-ux"], raw: "make them" });
  assert.equal(built.entries.length, skillPlanCap);
  assert.equal(built.entries[1].id, "lit-crucible", "three deliverables bring lit-crucible in first");
  assert.ok(built.dropped.some((entry) => entry.why === "over the cap"));
});

test("a risky design ask brings lit-crucible in as a companion, never as the primary", () => {
  const block = plan("lit redesign the architecture of the checkout page");
  assert.ok(block);
  assert.match(block, /1 frontend-ui-ux \(primary\) [^\n]*→ 2 lit-crucible/u);
  assert.equal(plan("lit explain the architecture of the checkout page"), undefined);
});

test("lit +viz +ui forces exactly that plan and routes the task without the plan names", () => {
  const hatch = parseSkillHatch("lit +viz +ui +nope chart the latency data");
  assert.deepEqual(hatch.skills, ["lit-scientific-visualization", "frontend-ui-ux"]);
  assert.deepEqual(hatch.unknown, ["nope"]);
  assert.equal(detectChatActivationMode("lit +ui +viz fix the flaky test"), "lit-task", "the +ui name does not route to the interface skill");
  const block = plan("lit +viz +ui +nope fix the flaky test");
  assert.match(block, /Skill plan: 1 lit \(primary\) → 2 lit-scientific-visualization [^\n]*→ 3 frontend-ui-ux/u);
  assert.match(block, /keep it exactly, add nothing and drop nothing/u);
  assert.match(block, /Ignored unknown plan names: \+nope/u);
  assert.doesNotMatch(block, /Catalog/u);
});

test("a read-only primary never gains a companion that writes", () => {
  const built = buildSkillPlan({ primary: "review-work", companions: ["frontend-ui-ux", "litresearch"], raw: "" });
  assert.deepEqual(built.entries.map((entry) => entry.id), ["review-work", "litresearch"]);
  assert.ok(built.dropped.some((entry) => entry.id === "frontend-ui-ux" && /read-only/u.test(entry.why)));
  const text = "lit review the diff that adds a chart of the experiment results";
  assert.equal(detectChatActivationMode(text), "review-work");
  assert.ok(skillPlanCompanions(text).includes("lit-scientific-visualization"));
  assert.equal(plan(text), undefined, "the only companion writes, so the review stays alone");
});

test("the OpenCode chat.message hook appends the plan to the activation part", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-skill-plan-hook-"));
  try {
    const hook = createChatMessageActivationHook(root, { extensionsNoticeRoot: path.join(root, "config") });
    const output = { message: { id: "msg_1" }, parts: [{ id: "p1", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "lit build a dashboard page that plots the experiment results as a chart" }] };
    await hook({ sessionID: "ses_1", messageID: "msg_1" }, output);
    const activation = output.parts.find((part) => part.metadata?.litopencode?.source === "chat.message" && part.metadata.litopencode.mode === "frontend-ui-ux");
    assert.ok(activation, "the interface activation part was added");
    assert.match(activation.text, /<litopencode-skill-plan>/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
