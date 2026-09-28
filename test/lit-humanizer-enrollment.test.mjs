import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { detectChatActivationMode } from "../src/activation.ts";
import { findLitOpenCodeCommand } from "../src/commands.ts";
import { findLitOpenCodeFeature } from "../src/features.ts";
import { litOpenCodeRuntimeSkills } from "../src/skills.ts";
import { managedSkillDefinition } from "../src/cli/managed-skill-assets.ts";
import { ensureCommandAliases } from "../src/cli/command-aliases.ts";

test("lit-humanizer is registered, routed, packaged, and invocable as one managed skill", async (t) => {
  const id = "lit-humanizer";
  const skillRoot = path.resolve("skills", id);
  const [skill, feature, command, manifest] = [
    litOpenCodeRuntimeSkills.find((item) => item.id === id),
    findLitOpenCodeFeature(id),
    findLitOpenCodeCommand(id),
    managedSkillDefinition(id)
  ];
  assert.ok(skill, "runtime skill catalog must register lit-humanizer");
  assert.ok(feature, "doctor/feature catalog must register lit-humanizer");
  assert.ok(command, "command catalog must expose /lit-humanizer");
  assert.ok(manifest, "managed-skill manifest must package its complete resource tree");
  assert.equal(detectChatActivationMode("Please use lit-humanizer to revise this paragraph."), id);
  assert.equal(detectChatActivationMode("Please use lit-korean to revise this paragraph."), id);
  for (const alias of ["lit-korean", "text-naturalization", "text-neutralization", "korean-ai-slop-remover"]) {
    assert.equal(findLitOpenCodeCommand(alias)?.id, id, `${alias} must resolve to the canonical command`);
  }

  const required = [
    "SKILL.md", "rules.json", "NOTICE", "references/rewrite-playbook.md",
    "references/ko-metrics.md", "examples/readme/before.md", "examples/readme/after.md",
    "scripts/detect.mjs", "scripts/extract_office_text.py", "assets"
  ];
  for (const relative of required) {
    const stat = await fs.stat(path.join(skillRoot, relative));
    assert.ok(stat.isFile() || stat.isDirectory(), `${relative} must ship`);
  }
  const managedFiles = new Set([
    ...manifest.distributionFiles,
    ...manifest.canonicalFiles.map((asset) => asset.path)
  ]);
  assert.ok(managedFiles.has("rules.json"));
  assert.ok(managedFiles.has("scripts/detect.mjs"));
  assert.ok([...managedFiles].some((file) => file.startsWith("references/")));

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-humanizer-command-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await ensureCommandAliases(root);
  const current = await fs.readFile(path.join(root, "command", "lit-humanizer.md"), "utf8");
  assert.match(current, /lit-humanizer/u);
  for (const alias of ["lit-korean", "text-naturalization", "text-neutralization", "korean-ai-slop-remover"]) {
    const redirect = await fs.readFile(path.join(root, "command", `${alias}.md`), "utf8");
    assert.match(redirect, /lit-humanizer/u, `${alias} must redirect to lit-humanizer`);
  }
});

test("long source-based deliverables preserve requested facts, units, and caveats", async () => {
  const body = await fs.readFile(path.join("skills", "lit-humanizer", "SKILL.md"), "utf8");
  assert.match(body, /For long source-based reports and slides, keep a temporary fact ledger and verify each requested fact and qualifier in every deliverable\./u);
  assert.match(body, /State each measure with its unit, population, and date\./u);
  assert.match(body, /Put the supported measurement and any explicit correction in the same sentence; state causal limits as what the evidence cannot establish\./u);
  assert.match(body, /Keep eligibility and outreach priority, activity counts and unique people, observed measurements and causal conclusions, and spending and budget ceilings clearly distinct in their own sentences\./u);
});
