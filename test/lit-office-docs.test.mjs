import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { detectChatActivationMode, promptForChatActivationMode } from "../src/activation-routing.ts";
import { litOpenCodeFeatures, litOpenCodeRuntimeSkills } from "../src/index.ts";

const require = createRequire(import.meta.url);

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
  // The direction is chosen by the skill and named in the reply, never asked about.
  for (const prompt of [document, slides]) {
    assert.match(prompt, /choose its design direction \(tonality\) yourself and name it with two alternatives/u);
    assert.doesNotMatch(prompt, /use the skill defaults/u);
  }
  const both = route("sources 폴더 자료로 보고서랑 발표자료 만들어줘 lit");
  assert.match(both, /load lit-docx and lit-pptx before drafting/u);
  for (const unrelated of ["Investigate the failing API test lit", "Translate this sentence lit", "Report the bug in the issue tracker lit"]) {
    assert.doesNotMatch(route(unrelated), /native skill tool to load lit-(?:docx|pptx)/u);
  }
});

test("lit routes the 'turn X into a deck or report' shape to the Office skills, file-name dots included", () => {
  const routed = (prompt) => {
    const mode = detectChatActivationMode(prompt);
    assert.equal(mode, "lit-task", prompt);
    return promptForChatActivationMode(mode, prompt);
  };
  const deck = routed("lit turn notes.md into a 10-slide deck for Monday");
  assert.match(deck, /load lit-pptx before drafting/u);
  assert.doesNotMatch(deck, /load lit-docx/u);
  const report = routed("lit turn my notes into a Word report");
  assert.match(report, /load lit-docx before drafting/u);
  assert.doesNotMatch(report, /load lit-pptx/u);
  for (const prompt of ["lit turn notes.md into slides", "lit turn q3.v2.csv into a presentation", "lit turn the draft into a Word document"]) {
    assert.match(routed(prompt), /native skill tool to load lit-(?:docx|pptx) before drafting/u, prompt);
  }
  assert.match(routed("lit notes.md 메모 파일로 월요일 팀 회의용 슬라이드 10장 만들어줘"), /load lit-pptx before drafting/u);
  // "turn" without "into <office noun>" is not an authoring request, even beside an office word.
  for (const prompt of ["lit turn on dark mode", "lit turn on dark mode in the settings page", "lit turn the deck lights on, then report back", "lit turn the report filter into a dropdown"]) {
    assert.doesNotMatch(promptForChatActivationMode("lit-task", prompt), /native skill tool to load lit-(?:docx|pptx)/u, prompt);
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
  for (const rel of ["scripts/compile-deck.js", "scripts/qa_deck.py", "scripts/deck_output.py", "scripts/layout_inventory.py", "scripts/check_ooxml.py", "scripts/embed_fonts.py", "scripts/learn_template.py", "scripts/lib/grid-resolver.js", "scripts/lib/render-pack.js", "templates/enrolled/AZURE-PRO/template.yaml", "templates/tonalities/ledger/pack.yaml", "pretendard-font/LICENSE.txt", "package-lock.json"]) {
    assert.ok(readFileSync(`skills/lit-pptx/${rel}`).length > 0, rel);
  }
  for (const rel of ["scripts/convert_md_to_docx.py", "scripts/docx_design.py", "scripts/docx_layout.py", "scripts/craft_docx.py", "scripts/edit_docx.py", "scripts/convert_md_to_pdf.py", "scripts/slop_lint.py", "scripts/visual_audit.py", "templates/docx/korean-generic.docx", "templates/tonalities/report.yaml", "templates/registry.yaml", "LICENSE-MIT.txt"]) {
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

const deckTonalities = ["atlas", "chalk", "gazette", "ledger", "night", "paper", "signal", "studio"];
const docTonalities = ["brief", "journal", "manual", "memo", "proposal", "report"];
const treatments = ["top-rule", "top-plain-large", "side-rail", "band", "statement", "overlay", "kicker-numeral", "bottom-anchor"];

test("both Office skills choose and name a direction before building, and their libraries cover every tonality, treatment, family and component", () => {
  const deck = readFileSync("skills/lit-pptx/SKILL.md", "utf8");
  const doc = readFileSync("skills/lit-docx/SKILL.md", "utf8");
  for (const body of [deck, doc]) {
    assert.match(body, /direction card/u);
    assert.match(body, /two alternatives/u);
    assert.match(body, /noun-phrase|topic label/u);
    for (const ref of body.matchAll(/`(references\/[^`*<]+\.md)`/gu)) {
      const root = body === deck ? "skills/lit-pptx/" : "skills/lit-docx/";
      assert.ok(existsSync(root + ref[1]), `${root}${ref[1]}`);
    }
  }
  for (const id of deckTonalities) {
    assert.match(deck, new RegExp(`\`${id}\``, "u"));
    assert.ok(readFileSync(`skills/lit-pptx/references/tonalities/${id}.md`, "utf8").length > 3000, id);
    assert.ok(existsSync(`skills/lit-pptx/templates/tonalities/${id}/pack.yaml`), id);
  }
  for (const id of docTonalities) {
    assert.match(doc, new RegExp(`\`${id[0].toUpperCase()}${id.slice(1)}\``, "u"));
    assert.ok(readFileSync(`skills/lit-docx/references/tonalities/${id}.md`, "utf8").length > 3000, id);
    assert.ok(existsSync(`skills/lit-docx/templates/tonalities/${id}.yaml`), id);
  }
  const treatmentSheet = readFileSync("skills/lit-pptx/references/title-treatments.md", "utf8");
  for (const id of treatments) assert.match(treatmentSheet, new RegExp(`\\b${id}\\b`, "u"), id);
  const familySheet = readFileSync("skills/lit-pptx/references/layout-families.md", "utf8");
  for (const id of require("../skills/lit-pptx/scripts/lib/grid-resolver.js").familyIds()) assert.ok(familySheet.includes(id), id);
  const components = readFileSync("skills/lit-docx/references/components.md", "utf8");
  for (const kind of ["cover", "callout", "sidebar", "pullquote", "keyfigures", "columns"]) assert.ok(components.includes(`::: ${kind}`), kind);
  assert.ok(readdirSync("skills/lit-pptx/references/examples").filter((f) => f.endsWith(".md")).length >= 12);
  assert.ok(readdirSync("skills/lit-docx/references/examples").filter((f) => f.endsWith(".md")).length >= 9);
});

test("the reference libraries and tonality packs are enrolled in the managed manifest, so they install", () => {
  const manifest = JSON.parse(readFileSync("skills/managed-skill-manifest.json", "utf8"));
  for (const [id, dirs] of [["lit-pptx", ["references", "templates/tonalities"]], ["lit-docx", ["references", "templates/tonalities"]]]) {
    const pinned = new Set(manifest.skills[id].canonicalFiles.map((file) => file.path));
    for (const dir of dirs) {
      const walk = (rel) => readdirSync(`skills/${id}/${rel}`, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${rel}/${e.name}`) : [`${rel}/${e.name}`]));
      const files = walk(dir);
      assert.ok(files.length > 0, `${id}/${dir}`);
      for (const file of files) assert.ok(pinned.has(file), `${id}/${file} is not enrolled`);
    }
  }
});

test("the deck faces are the unmodified official Pretendard Regular and Bold, named Pretendard everywhere", () => {
  const faces = "skills/lit-pptx/pretendard-font/public/static";
  const pins = { "Pretendard-Regular.otf": "3ffbacde6ab8411f1d2db54bb9b1f0b3ee2a738932033722cf0388c06aed1c93", "Pretendard-Bold.otf": "2e91915fab54df71cc9598ebf608b2bdb54c6fe3c066ac61dff0bc44fca71cc7" };
  assert.deepEqual(readdirSync(faces).sort(), Object.keys(pins).sort());
  for (const [file, sha] of Object.entries(pins)) assert.equal(createHash("sha256").update(readFileSync(`${faces}/${file}`)).digest("hex"), sha, file);
  assert.match(readFileSync("skills/lit-pptx/pretendard-font/LICENSE.txt", "utf8"), /Reserved Font Name Pretendard/u);
  for (const rel of ["scripts/lib/font-map.js", "scripts/embed_fonts.py", "templates/enrolled/AZURE-PRO/template.yaml", "templates/tonalities/ledger/pack.yaml"]) {
    assert.match(readFileSync(`skills/lit-pptx/${rel}`, "utf8"), /Pretendard/u, rel);
  }
});
