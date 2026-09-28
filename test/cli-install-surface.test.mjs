import { withMarkTerminal } from "../test-support/lit-mark-fixture.mjs";
import { banner, lockup } from "../src/lit-mark.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import litOpenCodePlugin from "../src/index.ts";
import { install } from "../src/cli/install.ts";
import * as installTui from "../src/cli/install-tui.ts";
import { packageId, runCli, withTempDir } from "../test-support/cli-fixture.ts";
import { createBetaMaterialEvidence, validBetaDesignContract } from "../test-support/uiux-visual-fixtures.mjs";

const htmlCommentPattern = /<!--[\s\S]*?-->/;
const ansiEscapePattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;

test("minimum-first CLI keeps help with its only consumer", async () => {
  await assert.rejects(fs.access("src/cli/help.ts"), { code: "ENOENT" });
  const cliSource = await fs.readFile("src/cli.ts", "utf8");
  const argsSource = await fs.readFile("src/cli/args.ts", "utf8");
  assert.match(cliSource, /function helpText\(/);
  assert.doesNotMatch(argsSource, /\.\/help\.ts|helpText/);
});

function stripAnsi(value) {
  return value.replace(ansiEscapePattern, "");
}

function assertNoHtmlCommentArtifact(text, label) {
  assert.doesNotMatch(text, htmlCommentPattern, `${label} should not expose HTML comments or blank <!-- --> artifacts`);
}

test("visualqa.current-lit-plan-deny.characterization preserves edit bash and task denial", async () => {
  const hooks = await litOpenCodePlugin({ directory: process.cwd(), worktree: process.cwd() });
  try {
    const config = {};
    await hooks.config(config);
    assert.equal(config.agent["lit-plan"].permission.edit, "deny");
    assert.equal(config.agent["lit-plan"].permission.bash, "deny");
    assert.equal(config.agent["lit-plan"].permission.task, "deny");
    assert.equal(config.agent["lit-plan"].tools.write, false);
    assert.equal(config.agent["lit-plan"].tools.edit, false);
    assert.equal(config.agent["lit-plan"].tools.bash, false);
    assert.equal(config.agent["lit-plan"].tools.task, false);
  } finally {
    await hooks.dispose?.();
  }
});

test("integration.installed-nested-assets", async () => {
  await withTempDir(async (dir) => {
    const installResult = runCli(["install", "--root", dir]);
    assert.equal(installResult.status, 0, installResult.stderr);

    const requiredInstalledPaths = [
      "skills/readme-studio/SKILL.md",
      "skills/readme-studio/references/production.md",
      "skills/readme-studio/references/decoration-patterns.md",
      "skills/readme-studio/scripts/check-facts.mjs",
      "skills/readme-studio/templates/typography/outline.mjs",
      "skills/readme-studio/templates/remotion/package-lock.json",
      "skills/readme-studio/templates/hyperframes/index.motion.json",
      "skills/frontend-ui-ux/SKILL.md",
      "skills/frontend-ui-ux/references/production.md",
      "skills/frontend-ui-ux/references/default-editorial-pixel.json",
      "skills/frontend-ui-ux/schemas/design-contract-v1alpha1.json",
      "skills/frontend-ui-ux/schemas/design-contract-v1beta1.json",
      "skills/frontend-ui-ux/schemas/design-contract-v1beta2.json",
      "skills/frontend-ui-ux/data/design-intelligence.json",
      "skills/frontend-ui-ux/data/PROVENANCE.json",
      "skills/frontend-ui-ux/data/LICENSE",
      "skills/frontend-ui-ux/data/THIRD-PARTY-NOTICE.txt",
      "skills/frontend-ui-ux/scripts/uiux.mjs",
      "skills/browser-drive/SKILL.md",
      "skills/browser-drive/scripts/capability-probe.mjs",
      "skills/browser-drive/references/snapshot-act-loop.md",
      "skills/lit-comprehend/assets/explainer-scaffold.html",
      "skills/lit-comprehend/references/artifact-template.md",
      "skills/lit-comprehend/references/micro-worlds.md",
      "skills/lit-comprehend/scripts/verify-explainer.ts",
      "skills/visual-qa/SKILL.md",
      "skills/visual-qa/schemas/evidence-manifest-v1alpha1.json",
      "skills/visual-qa/schemas/evidence-manifest-v1beta1.json",
      "skills/visual-qa/schemas/review-receipt-v1alpha1.json",
      "skills/visual-qa/scripts/visual-qa.mjs"
    ];

    for (const relativePath of requiredInstalledPaths) {
      try {
        const stat = await fs.stat(path.join(dir, relativePath));
        assert.equal(stat.isFile(), true, `integration.installed-nested-assets: expected ${relativePath}`);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          assert.fail(`integration.installed-nested-assets: missing installed capability file ${relativePath}`);
        }
        throw error;
      }
    }

    const doctor = runCli(["doctor", "--root", dir]);
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.deepEqual(report.install.nativeSkills.missing, []);
    assert.deepEqual(report.install.nativeSkills.invalid, []);
    assert.ok(report.install.nativeSkills.present.includes("frontend-ui-ux"));
    assert.ok(report.install.nativeSkills.present.includes("visual-qa"));
  });
});

test("integration.installed visual-qa validates beta PNG evidence with its sibling absent and restored", async () => {
  await withTempDir(async (dir) => {
    const installResult = runCli(["install", "--root", dir]);
    assert.equal(installResult.status, 0, installResult.stderr);
    const sibling = path.join(dir, "skills", "frontend-ui-ux");
    const preserved = path.join(dir, "frontend-ui-ux.preserved");
    const siblingSkill = await fs.readFile(path.join(sibling, "SKILL.md"));
    const installedUiux = await import(pathToFileURL(path.join(sibling, "scripts", "uiux.mjs")).href);
    const uiuxBoundary = validBetaDesignContract();
    uiuxBoundary.tokens[0].usage = "x".repeat(512);
    assert.equal(installedUiux.validateDesignContract(uiuxBoundary).valid, true);
    uiuxBoundary.tokens[0].usage += "x";
    assert.equal(installedUiux.validateDesignContract(uiuxBoundary).valid, false);
    await fs.rename(sibling, preserved);
    try {
      const visualQa = await import(pathToFileURL(path.join(dir, "skills", "visual-qa", "scripts", "visual-qa.mjs")).href);
      const visualDesign = await import(pathToFileURL(path.join(dir, "skills", "visual-qa", "scripts", "design-contract.mjs")).href);
      const visualBoundary = validBetaDesignContract();
      visualBoundary.acceptance_criteria[0].observable = "x".repeat(512);
      assert.equal(visualDesign.validateDesignContract(visualBoundary).valid, true);
      visualBoundary.acceptance_criteria[0].observable += "x";
      assert.equal(visualDesign.validateDesignContract(visualBoundary).valid, false);
      const material = createBetaMaterialEvidence(visualQa, path.join(dir, "evidence"));
      assert.equal(visualQa.evaluateEvidenceManifest(material.manifest, material.bundle).verdict, "PASS");
      for (const capturePath of [
        path.join(material.bundle.evidenceRoot, "captures", "primary.png"),
        `../${path.basename(material.bundle.evidenceRoot)}/captures/primary.png`
      ]) {
        const invalid = structuredClone(material.manifest);
        invalid.captures[0].path = capturePath;
        assert.equal(visualQa.validateEvidenceManifest(invalid).valid, false);
        assert.equal(
          visualQa.evaluateEvidenceManifest(invalid, material.bundle).code,
          "BLOCKED_SCHEMA_OR_PAYLOAD_MISMATCH"
        );
      }
      const full = createBetaMaterialEvidence(visualQa, path.join(dir, "full-evidence"), { tier: "full" });
      full.manifest.capabilities.independent_review = true;
      full.manifest.review_receipt_hashes = [`sha256:${"e".repeat(64)}`, `sha256:${"f".repeat(64)}`];
      assert.equal(
        visualQa.evaluateEvidenceManifest(full.manifest, full.bundle).code,
        "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"
      );
    } finally {
      await fs.rename(preserved, sibling);
    }
    assert.deepEqual(await fs.readFile(path.join(sibling, "SKILL.md")), siblingSkill);
  });
});

test("install writes opencode plugin config with branded progress output", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["install", "--root", dir]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LitOpenCode/);
    assert.match(result.stdout, /OpenCode plugin setup/);
    assert.match(result.stdout, /Install summary/);
    assert.match(result.stdout, /Routes/);
    assert.match(result.stdout, /Files/);
    assert.match(result.stdout, /Progress/);
    assert.match(result.stdout, /OpenCode config/);
    assert.match(result.stdout, /litopencode/);
    assert.match(result.stdout, /Complete/);
    assert.match(result.stdout, /\[ok\]\s+Resolve package/);
    assert.match(result.stdout, /Write litopencode\.json/);
    assert.match(result.stdout, /command aliases written/);
    assert.match(result.stdout, /Agents\s+lit-loop, lit-plan, lit-implement/);
    assert.match(result.stdout, /Model\s+Role-split shipped defaults/);
    assert.match(result.stdout, /Shipped defaults\s+GPT-6 Astra\/xhigh lead \+ planning\/review; GPT-6 Luna\/max\s+execution\/research helpers/);
    assert.match(result.stdout, /Override order\s+project merges after global; per-agent routes override\s+categories/);
    assert.doesNotMatch(result.stdout, /^\s*\{/);

    const output = JSON.parse(await fs.readFile(path.join(dir, "opencode.json"), "utf8"));
    assert.deepEqual(output.plugin, [packageId]);
    const litConfig = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    assert.equal(litConfig.$schema, "https://litopencode.dev/config.schema.json");
    assert.equal(litConfig.agents["lit-loop"].category, "execution");
    assert.equal(litConfig.agents["lit-explorer"].category, "research");
    assert.equal(litConfig.agents["lit-librarian"].category, "research");
    for (const category of ["planning", "review"]) {
      assert.equal(litConfig.categories[category].provider, "openai");
      assert.equal(litConfig.categories[category].model, "gpt-6-astra");
      assert.equal(litConfig.categories[category].variant, "xhigh");
    }
    assert.equal(litConfig.categories.execution.variant, "max");
    assert.equal(litConfig.categories.execution.model, "gpt-6-luna");
    assert.equal(litConfig.categories.research.variant, "max");
    assert.equal(litConfig.categories.research.model, "gpt-6-luna");
    assert.deepEqual(litConfig.boundedAuthority, {
      maxEvents: 64,
      maxHistory: 32,
      maxReceipts: 64,
      maxContextBytes: 65536
    });
    assert.deepEqual(litConfig.knowledge, { capture: true });
    assert.match(result.stdout, /Authority lifecycle\s+schema 3/);
    const startWorkCommand = await fs.readFile(path.join(dir, "command", "start-work.md"), "utf8");
    const reviewWorkCommand = await fs.readFile(path.join(dir, "command", "review-work.md"), "utf8");
    const litResearchCommand = await fs.readFile(path.join(dir, "command", "lit-research.md"), "utf8");
    const litCrucibleSkill = await fs.readFile(path.join(dir, "skills", "lit-crucible", "SKILL.md"), "utf8");
    const initDeepSkill = await fs.readFile(path.join(dir, "skills", "lit-init", "SKILL.md"), "utf8");
    const litResearchSkill = await fs.readFile(path.join(dir, "skills", "litresearch", "SKILL.md"), "utf8");
    assert.match(startWorkCommand, /^litopencodeGenerated: true$/m);
    assertNoHtmlCommentArtifact(startWorkCommand, "generated /start-work command");
    assert.match(startWorkCommand, /^agent: lit-implement$/m);
    assert.match(startWorkCommand, /<start-work-mode>/);
    assert.match(startWorkCommand, /execution-only/i);
    assert.doesNotMatch(startWorkCommand, /current durable goal/i);
    assert.match(reviewWorkCommand, /Activate review-work/);
    assertNoHtmlCommentArtifact(reviewWorkCommand, "generated /review-work command");
    assert.match(litResearchCommand, /Activate litresearch/);
    assert.match(litResearchCommand, /^agent: lit-loop$/m);
    assert.match(litResearchCommand, /# Installed skill body/);
    assert.match(litResearchCommand, /# LitResearch/);
    assertNoHtmlCommentArtifact(litResearchCommand, "generated /lit-research command");
    assert.match(litCrucibleSkill, /^---\nname: lit-crucible\n/m);
    assert.match(litCrucibleSkill, /^description: \|-/m);
    assert.match(litCrucibleSkill, /^metadata:\n  litopencodeGenerated: "true"$/m);
    assertNoHtmlCommentArtifact(litCrucibleSkill, "generated lit-crucible skill");
    assert.match(litCrucibleSkill, /^# Lit Crucible/m);
    assert.match(initDeepSkill, /^---\nname: lit-init\n/m);
    assert.match(initDeepSkill, /^description: \|-/m);
    assert.match(initDeepSkill, /^metadata:\n  litopencodeGenerated: "true"$/m);
    assertNoHtmlCommentArtifact(initDeepSkill, "generated lit-init skill");
    assert.match(initDeepSkill, /^# Lit Init/m);
    assert.match(litResearchSkill, /^---\nname: litresearch\n/m);
    assert.match(litResearchSkill, /^description: \|-/m);
    assert.match(litResearchSkill, /^metadata:\n  litopencodeGenerated: "true"$/m);
    assertNoHtmlCommentArtifact(litResearchSkill, "generated litresearch skill");
    assert.match(litResearchSkill, /^# LitResearch/m);
    const doctor = runCli(["doctor", "--root", dir]);
    assert.equal(doctor.status, 0, doctor.stderr);
    const doctorOutput = JSON.parse(doctor.stdout);
    assert.equal(doctorOutput.install.ok, true);
    assert.equal(doctorOutput.install.plugin.ok, true);
    assert.equal(doctorOutput.install.plugin.expected, packageId);
    assert.equal(doctorOutput.install.plugin.present, true);
    assert.deepEqual(doctorOutput.install.commandAliases.missing, []);
    assert.ok(doctorOutput.install.commandAliases.present.includes("start-work"));
    assert.ok(doctorOutput.install.commandAliases.present.includes("litresearch"));
    assert.deepEqual(doctorOutput.install.nativeSkills.missing, []);
    assert.ok(doctorOutput.install.nativeSkills.present.includes("lit-crucible"));
    assert.ok(doctorOutput.install.nativeSkills.present.includes("litresearch"));
    assert.equal(doctorOutput.state.boundedAuthority.schemaVersion, 3);
    assert.equal(doctorOutput.state.boundedAuthority.maxEvents, 64);
    assert.match(doctorOutput.state.boundedAuthority.stateFile, /work-schema-3\.json$/);
    assert.equal(doctorOutput.state.knowledge.captureEnabled, true);
    assert.match(doctorOutput.state.knowledge.authority, /\.litopencode\/knowledge\/claims\.jsonl$/u);
    assert.equal(doctorOutput.state.knowledge.hardQueryLimitBytes, 4096);
    await assert.rejects(fs.stat(path.join(dir, ".litopencode")), { code: "ENOENT" });
  });
});

test("install report wraps whole words within an 80-column terminal", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["install", "--root", dir]);
    assert.equal(result.status, 0, result.stderr);

    for (const [index, line] of result.stdout.split("\n").entries()) {
      assert.ok(Array.from(line).length <= 80, `line ${index + 1} exceeds 80 columns: ${line}`);
    }
    assert.doesNotMatch(result.stdout, /SO\nL\/TERRA/);
    assert.doesNotMatch(result.stdout, /cate\ngories/);
    assert.match(result.stdout, /routes override\n {21}categories/);
  });
});

test("installer stages wrap real work and verification blocks a false ready receipt", async () => {
  await withTempDir(async (dir) => {
    const stages = [];
    let completed = false;
    const progress = {
      async start() {},
      async run(label, task) {
        stages.push(label);
        const result = await task();
        if (label === "Register plugin") {
          await fs.rm(path.join(dir, "command", "lit-plan.md"));
        }
        return result;
      },
      async complete() {
        completed = true;
      },
      async fail() {}
    };

    await assert.rejects(
      install(dir, false, undefined, "never", "safe", false, "never", progress),
      /Install verification failed: command aliases: lit-plan/
    );
    assert.deepEqual(stages, [
      "Resolve package",
      "Read OpenCode config",
      "Write litopencode.json",
      "Register plugin",
      "Verify install"
    ]);
    assert.equal(completed, false);
  });
});

test("install TUI logo uses LitOpenCode brand colors and polished lockup", async () => {
  const output = withMarkTerminal(() => installTui.renderInstallTuiLogo("litopencode@0.1.11"));
  assert.match(output, /\u001b\[38;2;255;99;55m/);
  assert.match(output, /\u001b\[38;2;215;247;91m/u);
  assert.match(output, /\u001b\[38;2;242;239;223m/u);
  assert.match(output, /━{46}/);
  const visible = stripAnsi(output);
  assert.ok(visible.includes(banner[0]));
  assert.match(visible, /litopencode v0\.1\.11/u);
  assert.doesNotMatch(visible, /🔥  l  i  t  opencode/u);
  assert.match(output, /╭─ INSTALL/);
  assert.match(output, /OpenCode plugin installer/i);
  assert.match(output, /writes begin at 03 \/ 05/i);
});

test("install TUI respects NO_COLOR without losing its information hierarchy", () => {
  const output = withMarkTerminal(() => installTui.renderInstallTuiLogo("litopencode@0.1.45"), { color: false });

  assert.doesNotMatch(output, /\u001b\[/);
  assert.ok(output.includes(lockup("litopencode v0.1.45", banner).join("\n")));
  assert.match(output, /v0\.1\.45/);
  assert.match(output, /litopencode@0\.1\.45/);
});

test("install TUI progress emits no ANSI eraser under NO_COLOR", async () => {
  const noColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  const chunks = [];
  try {
    const progress = installTui.createInstallTui({ write: (value) => chunks.push(value) });
    await progress.start("litopencode@0.1.45");
    await progress.run("Verify install", async () => {});
    await progress.complete();
  } finally {
    if (noColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = noColor;
  }

  assert.doesNotMatch(chunks.join(""), /\u001b\[/);
});

test("install TUI renders a persistent numbered stage with purpose and state when color is enabled", () => {
  if (typeof installTui.renderInstallTuiStage !== "function") {
    assert.fail("renderInstallTuiStage must expose the numbered installer timeline");
    return;
  }

  const running = installTui.renderInstallTuiStage("Register plugin", "running", 0);
  const complete = installTui.renderInstallTuiStage("Register plugin", "complete", 0);
  const visibleRunning = stripAnsi(running);
  const visibleComplete = stripAnsi(complete);

  assert.match(visibleRunning, /04 \/ 05\s+PLUGIN/);
  assert.match(visibleRunning, /Register through OpenCode/i);
  assert.match(visibleRunning, /⠋/);
  assert.match(visibleComplete, /✓/);
  assert.match(visibleComplete, /Plugin registered/);
});

test("install TUI completion receipt gives one clear next action", () => {
  if (typeof installTui.renderInstallTuiCompletion !== "function") {
    assert.fail("renderInstallTuiCompletion must expose the final installer receipt");
    return;
  }

  const output = installTui.renderInstallTuiCompletion();
  assert.match(output, /INSTALL READY/);
  assert.match(output, /Restart OpenCode/);
  assert.match(output, /press Tab/i);
});

test("install TUI animates a running stage and retains its completion receipt", async () => {
  const chunks = [];
  const progress = installTui.createInstallTui({ write: (value) => chunks.push(value) });

  await progress.start("litopencode@0.1.45");
  await progress.run("Register plugin", async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  await progress.complete();

  const output = chunks.join("");
  assert.match(output, /⠋/);
  assert.match(output, /⠙|⠹/);
  assert.match(output, /✓.*Plugin registered/);
  assert.match(output, /INSTALL READY/);
});

test("TTY JSON installs suppress the progress mark and machine-output escapes", () => {
  withMarkTerminal(() => {
    assert.equal(installTui.shouldRenderInstallTui(["install", "--json"]), false);
    assert.equal(installTui.shouldRenderInstallTui(["install", "--dry-run"]), false);
    assert.equal(installTui.shouldRenderInstallTui(["install"]), true);
  });
});

test("readme-studio doctor rejects tampered and missing installed resources", async () => {
  await withTempDir(async (dir) => {
    assert.equal(runCli(["install", "--root", dir]).status, 0);
    const resource = path.join(dir, "skills/readme-studio/templates/typography/outline.mjs");
    const original = await fs.readFile(resource);
    await fs.appendFile(resource, "\n// altered\n");
    const altered = runCli(["doctor", "--root", dir]);
    assert.match(JSON.stringify(JSON.parse(altered.stdout).install.nativeSkills.invalid), /readme-studio/);
    assert.match(altered.stdout, /readme-studio/);
    await fs.writeFile(resource, original);
    await fs.rename(resource, `${resource}.preserved`);
    const missing = runCli(["doctor", "--root", dir]);
    assert.match(JSON.stringify(JSON.parse(missing.stdout).install.nativeSkills.invalid), /readme-studio/);
    assert.match(missing.stdout, /readme-studio/);
  });
});
