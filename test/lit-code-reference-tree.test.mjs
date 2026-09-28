import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const skillDir = path.resolve("skills/lit-code");
const referencesDir = path.join(skillDir, "references");
const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

const languages = fs
  .readdirSync(referencesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// A reference tree nothing routes to never loads. The skill body must name each
// language directory, and each directory must index its own files.
test("the skill body routes to every language directory", () => {
  assert.deepEqual(languages, ["go", "python", "rust", "typescript"]);
  for (const language of languages) {
    assert.ok(skill.includes(`references/${language}/`), `SKILL.md must route to references/${language}/`);
  }
});

test("each language indexes its own files", () => {
  for (const language of languages) {
    const dir = path.join(referencesDir, language);
    const index = fs.readFileSync(path.join(dir, "README.md"), "utf8");
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md");
    assert.notEqual(files.length, 0, `${language} must ship reference files`);
    for (const file of files) {
      assert.ok(index.includes(`(${file})`), `${language}/README.md must link ${file}`);
    }
  }
});

test("language guidance defers to the surrounding project", () => {
  const top = fs.readFileSync(path.join(referencesDir, "README.md"), "utf8");
  assert.match(top, /matching the surrounding code outranks/i);
  assert.match(skill, /the project wins/i);
});

test("no reference smuggles another harness's paths", () => {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
    );
  for (const file of walk(referencesDir)) {
    const body = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(body, /plugins\/litclaude|plugins\/litcodex|lithermes-plugin/, `${file} must stay harness-local`);
  }
});
