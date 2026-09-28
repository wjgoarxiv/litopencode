import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { promptForChatActivationMode } from "../src/activation-routing.ts";
import { litOpenCodeFeatures, litOpenCodeRuntimeSkills } from "../src/index.ts";

const rejectedHashes = new Set([
  "79f6d8f5b427252fa3b1c11ecdbdb6bf610b944f7530b4de78f770f38741cfaa",
  "2d03c07a51c1793be8774664ff6594dcb6ecd3791cf718cd214c296c073fbb39",
  "5da81aba1bfbfd522b52db3156d68d483676ec6d3020a9f5fed684ba8af13335",
  "09868e9f1786765421ecf3f0f49c77006738efda82a76df43ed87f7a9bfe2467",
  "6fe762f45aff8c63fd95b9fcb1337b28921d6fa454e18a0e8158d4c8708d6d00",
  "0bd17f76a1a4c388aba42c6d1d39015fa84e405c3e0692397fe12762bd632b58",
  "1ec252de8b14b07d16966c48906ccb1c45c68bcd23557ad31d8c50a27f5f8c0f",
  "adead8fe6270e520c397cec9fbee4d606ab10bb80f749e018b42ec894c60d2e5",
  "c21fd950b6ada7bd2f029885d3e56bc66b7ff061cc8404c492eb301664aa9e5d",
  "8a590747551be847a904e3296fb2f35aa4e7feeb4970a61596c2375306462820",
  "c04ac37916f398ba621b2d9e1e4c1a69225eaad6d7fb0ad116c237ddeb1b2b68"
]);

const route = (prompt) => promptForChatActivationMode("lit-task", prompt);

test("bare lit routes report, slide, and joint Office requests through native skill guidance", () => {
  const document = route("시장 자료를 정리해서 제안서 작성해줘 lit");
  assert.match(document, /load lit-docx before drafting/u);
  assert.doesNotMatch(document, /load lit-pptx before drafting/u);
  const slides = route("Create a product presentation for our team lit");
  assert.match(slides, /load lit-pptx before drafting/u);
  assert.match(slides, /complete a realistic example without asking or leaving placeholders/u);
  const both = route("sources 폴더 자료로 보고서랑 발표자료 만들어줘 lit");
  assert.match(both, /load lit-docx and lit-pptx before drafting/u);
  for (const unrelated of ["Investigate the failing API test lit", "Translate this sentence lit", "Report the bug in the issue tracker lit"]) {
    assert.doesNotMatch(route(unrelated), /native skill tool to load lit-(?:docx|pptx)/u);
  }
});

test("Office skills are registered and carry installed scripts, templates, fonts, and pinned runtime locks", () => {
  for (const id of ["lit-pptx", "lit-docx"]) {
    assert.ok(litOpenCodeFeatures.some((feature) => feature.id === id));
    assert.ok(litOpenCodeRuntimeSkills.some((skill) => skill.id === id));
    const body = readFileSync(`skills/${id}/SKILL.md`, "utf8");
    assert.match(body, new RegExp(`skill_id: ${id}`));
    assert.match(body, /#contract\.evidence/u);
    assert.match(body, /#contract\.hard_stops/u);
    assert.ok(readFileSync(`skills/${id}/requirements.lock`).length > 100);
  }
  for (const rel of ["scripts/compile-deck.js", "scripts/qa_deck.py", "scripts/layout_inventory.py", "scripts/check_ooxml.py", "scripts/embed_fonts.py", "scripts/learn_template.py", "templates/enrolled/AZURE-PRO/template.yaml", "pretendard-font/LICENSE.txt", "package-lock.json"]) {
    assert.ok(readFileSync(`skills/lit-pptx/${rel}`).length > 0, rel);
  }
  for (const rel of ["scripts/convert_md_to_docx.py", "scripts/edit_docx.py", "scripts/convert_md_to_pdf.py", "scripts/slop_lint.py", "scripts/visual_audit.py", "templates/docx/korean-generic.docx", "templates/registry.yaml", "LICENSE-MIT.txt"]) {
    assert.ok(readFileSync(`skills/lit-docx/${rel}`).length > 0, rel);
  }
});

test("package contains none of the excluded source hashes", () => {
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" });
  assert.equal(pack.status, 0, pack.stderr);
  const files = JSON.parse(pack.stdout)[0].files.map((entry) => entry.path);
  for (const file of files) {
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    assert.equal(rejectedHashes.has(digest), false, `excluded source hash in package: ${file}`);
  }
  assert.equal(files.some((file) => /^skills\/lit-pptx\/ooxml\//u.test(file)), false);
  assert.equal(files.some((file) => /html2pptx/u.test(file)), false);
  assert.equal(files.some((file) => /^skills\/lit-pptx\/assets\/media\//u.test(file)), false);
  assert.equal(files.some((file) => /TEMPLATE-EXAMPLE-1/u.test(file)), false);
});
