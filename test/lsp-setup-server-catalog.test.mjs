import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const skillDir = path.resolve("skills/lsp-setup");
const referencesDir = path.join(skillDir, "references");
const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
const index = fs.readFileSync(path.join(referencesDir, "README.md"), "utf8");

const languages = fs
  .readdirSync(referencesDir)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .map((name) => name.replace(/\.md$/, ""))
  .sort();

// A reference tree nothing points at is the same defect as no reference tree: the
// skill body has to name the catalog for it to ever be loaded.
test("the skill body routes to the server catalog", () => {
  assert.match(skill, /references\/README\.md|references\//);
  assert.match(skill, /catalog/i);
});

test("every catalog entry is linked from the index", () => {
  assert.notEqual(languages.length, 0);
  for (const language of languages) {
    assert.ok(index.includes(`(${language}.md)`), `${language}.md must be linked from references/README.md`);
  }
});

test("every catalog entry names a server command and an extension set", () => {
  for (const language of languages) {
    const body = fs.readFileSync(path.join(referencesDir, `${language}.md`), "utf8");
    assert.match(body, /\*\*Server command:\*\*/, `${language}.md must name the server command`);
    assert.match(body, /\*\*Extensions:\*\*/, `${language}.md must name the extensions it serves`);
    assert.match(body, /## Honest fallback while unserved/, `${language}.md must state the fallback`);
  }
});

test("the catalog does not smuggle behavior config into host routing", () => {
  for (const language of languages) {
    const body = fs.readFileSync(path.join(referencesDir, `${language}.md`), "utf8");
    assert.doesNotMatch(
      body,
      /extensionToLanguage|plugins\/litclaude/,
      `${language}.md must not carry another harness's routing shape`
    );
  }
});
