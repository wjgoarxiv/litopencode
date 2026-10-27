import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseScopeRoots, uncoveredScopePaths } from "../src/plan-scope-roots.ts";

async function workspace(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-scope-")));
  try {
    const project = path.join(dir, "project");
    const outside = path.join(dir, "shared", "data");
    await fs.mkdir(project, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await run({ dir, project, outside });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const plan = (head, todos) => `# Plan\n\n${head}\n\n## TODOs\n\n${todos}\n\n## Final verification\n\n- [ ] F1. Done — Verification: /etc/outside-final\n`;

test("Scope roots lines parse to semantic grants; fenced, broad and forbidden lines do not", () => {
  const text = [
    "Scope roots: /srv/shared/data (read, write)",
    "Scope root: /srv/other (execute)",
    "Scope roots: / (read)",
    `Scope roots: ${os.homedir()} (read)`,
    "Scope roots: /srv/release (publish)",
    "```",
    "Scope roots: /srv/fenced (read)",
    "```"
  ].join("\n");
  assert.deepEqual(parseScopeRoots(text, "/project"), [
    { root: "/srv/shared/data", actions: ["read", "write"] },
    { root: "/srv/other", actions: ["execute"] }
  ]);
});

test("an outside todo path with no Scope roots line is reported with the line to paste", async () => {
  await workspace(async ({ project, outside }) => {
    const found = uncoveredScopePaths(plan("", `- [ ] 1. Read — Action: read ${outside}/table.csv; Output: x; Verification: y`), project);
    assert.deepEqual(found, [{ path: `${outside}/table.csv`, line: `Scope roots: ${outside} (read)` }]);
  });
});

test("covered, in-project, fenced, command-span and out-of-section paths are not reported", async () => {
  await workspace(async ({ project, outside }) => {
    const todos = [
      `- [ ] 1. In project — Action: edit ${project}/src/a.ts; Output: x; Verification: y`,
      `- [ ] 2. Covered — Action: read ${outside}/table.csv; Output: x; Verification: y`,
      "- [ ] 3. Command — Action: run `node /opt/tool/bin/cli.js --check`; Output: x; Verification: y",
      "```sh",
      "cat /opt/fenced/file.txt",
      "```"
    ].join("\n");
    assert.deepEqual(uncoveredScopePaths(plan(`Scope roots: ${outside} (read)`, todos), project), []);
  });
});

test("a one-path code span counts, and a folder too broad to grant gets a problem instead of a line", async () => {
  await workspace(async ({ project, outside }) => {
    const found = uncoveredScopePaths(plan("", `- [ ] 1. Read \`${outside}/a.csv\` and /nonexistent-top/x.txt`), project);
    assert.deepEqual(found.map((entry) => entry.line ?? "problem"), [`Scope roots: ${outside} (read)`, "problem"]);
    assert.match(found[1].problem, /narrower/u);
  });
});

test("a broad Scope roots line never covers anything", async () => {
  await workspace(async ({ project, outside }) => {
    const found = uncoveredScopePaths(plan("Scope roots: / (read)", `- [ ] 1. Read ${outside}/a.csv`), project);
    assert.equal(found.length, 1);
  });
});
