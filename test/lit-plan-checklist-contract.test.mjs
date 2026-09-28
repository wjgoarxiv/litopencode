import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { litOpenCodeAgents, registerLitOpenCodeAgents } from "../src/agents.ts";
import { litOpenCodeCommands, litPlanPromptInjection, pluginModule } from "../src/index.ts";

const repoRoot = path.resolve(".");
const scaffoldScript = path.join(repoRoot, "skills", "lit-plan", "scripts", "scaffold-plan.mjs");
const checklistTemplate = `## TODOs

- [ ] 1. <title> — Action: <action>; Output: <output>; Verification: <verification>

## Final verification

- [ ] F1. <title> — Verification: <verification>`;
const concreteChecklist = `## TODOs

- [ ] 1. Validate handoff rows — Action: Check active rows for concrete fields; Output: A handoff readiness verdict; Verification: Run the focused checklist contract test

## Final verification

- [ ] F1. Replay the checker CLI — Verification: Check a concrete plan through scaffold-plan.mjs`;

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-plan-contract-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function runScaffolder(args, cwd) {
  return spawnSync(process.execPath, [scaffoldScript, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function rootSessionClient() {
  return {
    session: {
      get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } })
    }
  };
}

test("lit-plan agent prompt carries the chat-safe checklist handoff without relaxing permissions", () => {
  const planner = litOpenCodeAgents.find((agent) => agent.id === "lit-plan");
  assert.ok(planner);
  assert.ok(planner.prompt.includes(checklistTemplate));

  const config = {};
  registerLitOpenCodeAgents(config);
  assert.equal(config.agent["lit-plan"].permission.edit, "deny");
  assert.equal(config.agent["lit-plan"].permission.bash, "deny");
  assert.equal(config.agent["lit-plan"].permission.task, "deny");
  assert.equal(config.agent["lit-plan"].tools.write, false);
  assert.equal(config.agent["lit-plan"].tools.edit, false);
  assert.equal(config.agent["lit-plan"].tools.bash, false);
  assert.equal(config.agent["lit-plan"].tools.task, false);
});

test("lit-plan activation prompt carries the exact chat-safe checklist handoff", () => {
  assert.ok(litPlanPromptInjection.includes(checklistTemplate));
});

test("lit-plan static skill makes file scaffolding optional and shows the exact chat template", async () => {
  const skill = await fs.readFile(path.join(repoRoot, "skills", "lit-plan", "SKILL.md"), "utf8");
  assert.ok(skill.includes(checklistTemplate));
  assert.match(skill, /optional operator|optional file-backed helper/i);
  assert.doesNotMatch(skill, /Before recording any draft state, run the scaffolder|Do NOT hand-build the skeleton|only shape the structural self-check/i);
});

test("optional file-backed scaffolder emits the same checklist handoff grammar", async () => {
  await withTempDir(async (dir) => {
    const result = runScaffolder(["contract", "--draft-only"], dir);
    assert.equal(result.status, 0, result.stderr);
    const draft = await fs.readFile(path.join(dir, ".litopencode", "plans", "contract.md"), "utf8");
    assert.ok(draft.includes(checklistTemplate));
    assert.doesNotMatch(draft, /^## Checklist$/mu);
  });
});

test("scaffolder check accepts a concrete active handoff and rejects structural near misses", async () => {
  await withTempDir(async (dir) => {
    const valid = path.join(dir, "valid.md");
    const wrongHeading = path.join(dir, "wrong-heading.md");
    const nested = path.join(dir, "nested.md");
    const indented = path.join(dir, "indented.md");
    const fenced = path.join(dir, "fenced.md");
    await Promise.all([
      fs.writeFile(valid, concreteChecklist),
      fs.writeFile(wrongHeading, concreteChecklist.replace("## TODOs", "## Checklist")),
      fs.writeFile(nested, concreteChecklist.replace("- [ ] 1.", "- parent\n  - [ ] 1.")),
      fs.writeFile(indented, concreteChecklist.replace("- [ ] F1.", "  - [ ] F1.")),
      fs.writeFile(fenced, `\`\`\`markdown\n${concreteChecklist}\n\`\`\``)
    ]);

    assert.equal(runScaffolder(["--check", valid], dir).status, 0);
    for (const nearMiss of [wrongHeading, nested, indented, fenced]) {
      const result = runScaffolder(["--check", nearMiss], dir);
      assert.equal(result.status, 1, `${path.basename(nearMiss)} should be rejected\n${result.stdout}\n${result.stderr}`);
    }
  });
});

test("scaffolder check rejects placeholder, whitespace-only, and completed-only handoffs", async () => {
  await withTempDir(async (dir) => {
    const cases = new Map([
      ["placeholder.md", checklistTemplate],
      ["tbd.md", concreteChecklist.replace("Check active rows for concrete fields", "TBD")],
      ["todo.md", concreteChecklist.replace("A handoff readiness verdict", "ToDo")],
      ["ellipsis.md", concreteChecklist.replace("Run the focused checklist contract test", "...")],
      ["implementation-title.md", concreteChecklist.replace("Validate handoff rows", "   ")],
      ["action.md", concreteChecklist.replace("Check active rows for concrete fields", "   ")],
      ["output.md", concreteChecklist.replace("A handoff readiness verdict", "   ")],
      ["implementation-verification.md", concreteChecklist.replace("Run the focused checklist contract test", "   ")],
      ["final-title.md", concreteChecklist.replace("Replay the checker CLI", "   ")],
      ["final-verification.md", concreteChecklist.replace("Check a concrete plan through scaffold-plan.mjs", "   ")],
      ["completed-only.md", concreteChecklist.replaceAll("- [ ]", "- [x]")]
    ]);

    const unexpectedPasses = [];
    for (const [name, contents] of cases) {
      const file = path.join(dir, name);
      await fs.writeFile(file, contents);
      const result = runScaffolder(["--check", file], dir);
      if (result.status !== 1) unexpectedPasses.push(`${name}: status ${result.status}\n${result.stdout}\n${result.stderr}`);
    }
    assert.deepEqual(unexpectedPasses, [], `these handoffs should be rejected:\n${unexpectedPasses.join("\n")}`);
  });
});

test("scaffolder check accepts mixed active and completed rows with concrete fields", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "mixed.md");
    await fs.writeFile(file, concreteChecklist
      .replace(
        "- [ ] 1. Validate handoff rows — Action: Check active rows for concrete fields; Output: A handoff readiness verdict; Verification: Run the focused checklist contract test",
        "- [x] 1. Inspect the handoff — Action: Read the active sections; Output: Section evidence; Verification: Record the inspected headings\n- [ ] 2. Validate handoff rows — Action: Check active rows for concrete fields; Output: A handoff readiness verdict; Verification: Run the focused checklist contract test"
      )
      .replace(
        "- [ ] F1. Replay the checker CLI — Verification: Check a concrete plan through scaffold-plan.mjs",
        "- [x] F1. Inspect the focused result — Verification: Confirm the expected contract cases ran\n- [ ] F2. Replay the checker CLI — Verification: Check a concrete plan through scaffold-plan.mjs"
      ));

    const result = runScaffolder(["--check", file], dir);
    assert.equal(result.status, 0, `mixed active/completed rows should be accepted\n${result.stdout}\n${result.stderr}`);
  });
});

test("scaffolder check excludes fenced, nested, and incidental decoy rows when active rows are valid", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "decoys.md");
    await fs.writeFile(file, `## Notes

- [ ] 8. Incidental checkbox without handoff fields

\`\`\`markdown
## TODOs
- [ ] 4. Fenced placeholder — Action: <action>; Output: <output>; Verification: <verification>
## Final verification
- [ ] F9. Fenced placeholder — Verification: <verification>
\`\`\`

## TODOs

  - [ ] 7. Nested placeholder — Action: <action>; Output: <output>; Verification: <verification>
- [ ] 1. Validate handoff rows — Action: Check active rows for concrete fields; Output: A handoff readiness verdict; Verification: Run the focused checklist contract test

## Risks

- [ ] F6. Incidental final-looking checkbox

## Final verification

- [ ] F1. Replay the checker CLI — Verification: Check a concrete plan through scaffold-plan.mjs
  - [ ] F5. Nested placeholder — Verification: <verification>

## DoneClaim

- [ ] Incidental completion checkbox
`);

    const result = runScaffolder(["--check", file], dir);
    assert.equal(result.status, 0, `decoy rows should be excluded\n${result.stdout}\n${result.stderr}`);
  });
});

test("scaffolder check rejects malformed column-zero rows in active handoff sections", async () => {
  await withTempDir(async (dir) => {
    const malformedImplementation = path.join(dir, "malformed-implementation.md");
    const malformedFinal = path.join(dir, "malformed-final.md");
    const malformedMarker = path.join(dir, "malformed-marker.md");
    const emptyMarker = path.join(dir, "empty-marker.md");
    await Promise.all([
      fs.writeFile(malformedImplementation, concreteChecklist.replace("- [ ] 1.", "- [ ] one.")),
      fs.writeFile(malformedFinal, concreteChecklist.replace("- [ ] F1.", "- [ ] final.")),
      fs.writeFile(malformedMarker, concreteChecklist.replace(
        "- [ ] 1. Validate handoff rows",
        "- [q] 9. Malformed marker — Action: Reject this row; Output: A blocked handoff; Verification: Observe a non-zero check\n- [ ] 1. Validate handoff rows"
      )),
      fs.writeFile(emptyMarker, concreteChecklist.replace(
        "- [ ] F1. Replay the checker CLI",
        "- [] F9. Empty marker — Verification: Observe a non-zero check\n- [ ] F1. Replay the checker CLI"
      ))
    ]);

    const unexpectedPasses = [];
    for (const file of [malformedImplementation, malformedFinal, malformedMarker, emptyMarker]) {
      const result = runScaffolder(["--check", file], dir);
      if (result.status !== 1) unexpectedPasses.push(`${path.basename(file)}: status ${result.status}\n${result.stdout}\n${result.stderr}`);
    }
    assert.deepEqual(unexpectedPasses, [], `these malformed rows should be rejected:\n${unexpectedPasses.join("\n")}`);
  });
});

test("scaffolder check keeps implementation and final-verification numbering consecutive", async () => {
  await withTempDir(async (dir) => {
    const implementationGap = path.join(dir, "implementation-gap.md");
    const finalGap = path.join(dir, "final-gap.md");
    await Promise.all([
      fs.writeFile(implementationGap, concreteChecklist.replace("- [ ] 1.", "- [ ] 2.")),
      fs.writeFile(finalGap, concreteChecklist.replace("- [ ] F1.", "- [ ] F2."))
    ]);

    for (const file of [implementationGap, finalGap]) {
      const result = runScaffolder(["--check", file], dir);
      assert.equal(result.status, 1, `${path.basename(file)} should be rejected\n${result.stdout}\n${result.stderr}`);
    }
  });
});

test("scaffolder check keeps a four-tilde fence open across a shorter three-tilde run", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "shorter-tilde-closer.md");
    await fs.writeFile(file, concreteChecklist.replace(
      "- [ ] 1. Validate handoff rows",
      "~~~~markdown\n~~~\n## Risks\n~~~~\n\n- [ ] 1. Validate handoff rows"
    ));

    const result = runScaffolder(["--check", file], dir);
    assert.equal(result.status, 0, `shorter tilde run must not close the fence\n${result.stdout}\n${result.stderr}`);
  });
});

test("scaffolder check keeps a four-tilde fence open when a candidate closer has a non-whitespace suffix", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "suffixed-tilde-closer.md");
    await fs.writeFile(file, concreteChecklist.replace(
      "- [ ] 1. Validate handoff rows",
      "~~~~markdown\n~~~~not-a-close\n## Risks\n~~~~\n\n- [ ] 1. Validate handoff rows"
    ));

    const result = runScaffolder(["--check", file], dir);
    assert.equal(result.status, 0, `suffixed tilde run must not close the fence\n${result.stdout}\n${result.stderr}`);
  });
});

test("scaffolder check ignores an H2 inside a valid matching fence", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "fenced-h2.md");
    await fs.writeFile(file, concreteChecklist.replace(
      "- [ ] 1. Validate handoff rows",
      "~~~~markdown\n## Risks\n~~~~\n\n- [ ] 1. Validate handoff rows"
    ));

    const result = runScaffolder(["--check", file], dir);
    assert.equal(result.status, 0, `fenced H2 must not replace the active TODOs section\n${result.stdout}\n${result.stderr}`);
  });
});

test("scaffolder check rejects an implementation row after the active H2 changes to Risks", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "implementation-under-risks.md");
    await fs.writeFile(file, concreteChecklist.replace(
      "- [ ] 1. Validate handoff rows",
      "## Risks\n\n- [ ] 1. Validate handoff rows"
    ));

    const result = runScaffolder(["--check", file], dir);
    assert.equal(result.status, 1, `implementation row under Risks should be rejected\n${result.stdout}\n${result.stderr}`);
  });
});

test("scaffolder check rejects a final-verifier row after the active H2 changes to DoneClaim", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "final-after-doneclaim.md");
    await fs.writeFile(file, concreteChecklist.replace(
      "- [ ] F1. Replay the checker CLI",
      "## DoneClaim\n\n- [ ] F1. Replay the checker CLI"
    ));

    const result = runScaffolder(["--check", file], dir);
    assert.equal(result.status, 1, `final-verifier row under DoneClaim should be rejected\n${result.stdout}\n${result.stderr}`);
  });
});

test("OpenCode /lit-plan command hook emits the exact chat checklist template", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = { parts: [] };
    await hooks["command.execute.before"](
      { command: "/lit-plan", sessionID: "session-plan-contract", arguments: "" },
      output
    );

    assert.equal(output.parts.length, 1);
    assert.ok(output.parts[0].text.includes(checklistTemplate));
    assert.equal(output.parts[0].metadata.litopencode.mode, "lit-plan");
  });
});

test("OpenCode /start-work command route selects lit-implement", () => {
  const startWork = litOpenCodeCommands.find((command) => command.slash === "/start-work");
  assert.equal(startWork?.agent, "lit-implement");
});
