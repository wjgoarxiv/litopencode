import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const skillDir = path.resolve("skills/debugging");
const referencesDir = path.join(skillDir, "references");
const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

const runtimes = fs
  .readdirSync(path.join(referencesDir, "runtimes"))
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .map((name) => name.replace(/\.md$/, ""))
  .sort();

// A reference tree nothing routes to never loads, which is indistinguishable from
// not shipping it. The skill body has to name each entry point.
test("the skill body routes to every reference entry point", () => {
  for (const entry of ["references/runtimes/", "references/escalation.md", "references/tools.md"]) {
    assert.ok(skill.includes(entry), `SKILL.md must route to ${entry}`);
  }
});

test("runtime notes cover the runtimes the siblings cover", () => {
  assert.deepEqual(runtimes, [
    "bundled-js-binary",
    "go",
    "native-binary",
    "node",
    "python",
    "rust"
  ]);
});

test("each runtime note carries a concrete observation command", () => {
  for (const runtime of runtimes) {
    const body = fs.readFileSync(path.join(referencesDir, "runtimes", `${runtime}.md`), "utf8");
    assert.match(body, /```bash/, `${runtime}.md must show a runnable command`);
  }
});

test("escalation states the two-round reframe rule and its three passes", () => {
  const body = fs.readFileSync(path.join(referencesDir, "escalation.md"), "utf8");
  assert.match(body, /two consecutive failed hypothesis rounds/i);
  assert.match(body, /reframe/i);
  assert.match(body, /widen the boundary/i);
  assert.match(body, /invert the assumption/i);
  assert.match(body, /follow the data/i);
});

test("tool notes keep the authorization boundary explicit", () => {
  const body = fs.readFileSync(path.join(referencesDir, "tools.md"), "utf8");
  assert.match(body, /approval|permitted|authoriz/i);
});
