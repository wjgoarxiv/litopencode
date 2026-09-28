import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { comprehendPromptInjection } from "../src/activation.ts";
import { ensureCommandAliases } from "../src/cli/command-aliases.ts";
import {
  createCommandActivationHook,
  findLitOpenCodeCommand,
  litOpenCodeCommands
} from "../src/commands.ts";
import {
  detectChatActivationMode,
  findLitOpenCodeFeature,
  findLitOpenCodeRuntimeSkill,
  pluginModule,
  readLedgerEvents
} from "../src/index.ts";

const htmlCommentPattern = /<!--[\s\S]*?-->/;

function assertNoHtmlCommentArtifact(text, label) {
  assert.doesNotMatch(text, htmlCommentPattern, `${label} should not expose HTML comments or blank <!-- --> artifacts`);
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-comprehend-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// --- Activation routing tests ---

test("routes bounded lit-comprehend and comprehend triggers and rejects lookalikes", () => {
  // Given/When/Then: bounded trigger tokens route while natural-language, code, and slash mentions do not.
  for (const accepted of [
    "lit-comprehend",
    "lit-comprehend HEAD~5..HEAD",
    "lit-comprehend src/activation-routing.ts",
    "lit comprehend",
    "$lit-comprehend the session",
    "comprehend",
    "comprehend HEAD~5..HEAD",
    "$comprehend the session",
    "comprehend this change",
    "please comprehend"
  ]) {
    assert.equal(detectChatActivationMode(accepted), "lit-comprehend", `${accepted} should route to lit-comprehend`);
  }
  for (const rejected of [
    "explain this function to me",
    "설명해줘",
    "이해가 안 돼요",
    "what did you do in this session?",
    "comprehension test for the parser",
    "incomprehensible error message",
    "`comprehend`",
    "```text\ncomprehend\n```",
    "/lit-comprehend",
  ]) {
    assert.notEqual(detectChatActivationMode(rejected), "lit-comprehend", `${rejected} should not route to lit-comprehend`);
  }
});

test("natural-language explain phrases do NOT activate lit-comprehend", () => {
  // Given: common phrases that resemble comprehend but are ordinary requests.
  // These negative controls prove the activation is conservative.
  for (const phrase of [
    "explain the code",
    "explain this to me",
    "explain what happened",
    "설명해줘",
    "이해가 안 돼",
    "can you help me understand this?",
    "what does this function do?",
    "break this down for me"
  ]) {
    assert.notEqual(
      detectChatActivationMode(phrase),
      "lit-comprehend",
      `"${phrase}" must NOT activate lit-comprehend — false activation would turn a one-line answer into an artifact build`
    );
  }
});

// --- Command activation tests ---

test("lit-comprehend template carries methodology keywords and canonical sections", () => {
  const command = findLitOpenCodeCommand("lit-comprehend");

  assert.equal(command?.slash, "/lit-comprehend");
  assert.ok(litOpenCodeCommands.some((entry) => entry.id === "lit-comprehend"));
  for (const text of [comprehendPromptInjection, command?.activationText ?? ""]) {
    assertNoHtmlCommentArtifact(text, "lit-comprehend prompt template");
    assert.ok(text.includes("한눈에"));
    assert.ok(text.includes("이미 알고 있던 것"));
    assert.ok(text.includes("직관"));
    assert.ok(text.includes("바뀐 것"));
    assert.ok(text.includes("직접 만져보기"));
    assert.ok(text.includes("퀴즈"));
    assert.ok(text.includes("다음"));
    assert.ok(text.includes("delta"));
    assert.ok(text.includes("conceptual"));
    assert.ok(text.includes("micro-world"));
    assert.match(text, /internal records/i);
    assert.match(text, /material risk.*chat reply/i);
    assert.ok(text.includes("verify-explainer"));
    assert.ok(text.includes("~/.litopencode/lit-comprehend/"));
    assert.ok(text.includes("goals.json"));
    assert.ok(text.includes("ledger.jsonl"));
    assert.ok(text.includes("--en"));
    assert.ok(text.includes("--md"));
    assert.ok(text.includes("verbatim"));
    assert.ok(text.includes("lit-recap"));
    assert.match(text, /OUTSIDE|outside.*repo.*worktree|OUTSIDE the repo/i);
    assert.match(text, /<lit-loop-mode>/);
  }
});

test("lit-comprehend template carries execution gate contract", () => {
  for (const text of [comprehendPromptInjection]) {
    assert.match(text, /execution gate|EXECUTE DIRECTLY|CONFIRM FIRST/i, "prompt must document the execution gate");
    assert.match(text, /concrete target|explicit target/i, "gate must name the direct-execution condition");
    assert.match(text, /inferred|no explicit target|bare/i, "gate must name the confirm-first condition");
    assert.match(text, /approval|approve/i, "gate must require waiting for approval on inferred scope");
  }
});

test("activates /lit-comprehend command with ledger writes", async () => {
  await withTempDir(async (dir) => {
    const hook = createCommandActivationHook(dir);
    const output = { parts: [] };

    await hook({ command: "/lit-comprehend", sessionID: "session-comprehend", arguments: "" }, output);

    assert.equal(output.parts.length, 1);
    assert.equal(output.parts[0].type, "text");
    assertNoHtmlCommentArtifact(output.parts[0].text, "/lit-comprehend command output");
    assert.ok(output.parts[0].text.includes("한눈에"));
    assert.equal(output.parts[0].metadata.litopencode.command, "lit-comprehend");
    assert.equal(output.parts[0].metadata.litopencode.mode, "lit-comprehend");

    const events = await readLedgerEvents(dir);
    assert.ok(events.length > 0, "lit-comprehend should write a ledger activation event");
    assert.equal(events[0].command, "lit-comprehend");
  });
});

test("routes lit-comprehend chat messages with ledger activation event", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: {
        session: {
          async get() {
            return { data: { id: "session-comprehend-chat" } };
          }
        }
      },
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = {
      message: {
        id: "msg_comprehend",
        sessionID: "session-comprehend-chat",
        role: "user"
      },
      parts: [
        {
          id: "part-user-comprehend",
          sessionID: "session-comprehend-chat",
          messageID: "msg_comprehend",
          type: "text",
          text: "comprehend this session"
        }
      ]
    };

    await hooks["chat.message"]({ sessionID: "session-comprehend-chat", messageID: "msg_comprehend" }, output);

    assert.equal(output.parts.length, 2);
    assertNoHtmlCommentArtifact(output.parts[1].text, "lit-comprehend chat output");
    assert.ok(output.parts[1].text.includes("한눈에"));
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-comprehend");
  });
});

test("exposes lit-comprehend as an installed command alias", async () => {
  await withTempDir(async (dir) => {
    await ensureCommandAliases(dir);
    const aliasText = await fs.readFile(path.join(dir, "command", "lit-comprehend.md"), "utf8");

    assert.match(aliasText, /^litopencodeGenerated: true$/m);
    assertNoHtmlCommentArtifact(aliasText, "/lit-comprehend alias");
    assert.ok(aliasText.includes("한눈에"));
  });
});

test("registers lit-comprehend feature and runtime skill catalog entries", () => {
  assert.notEqual(findLitOpenCodeFeature("lit-comprehend"), undefined);
  assert.notEqual(findLitOpenCodeRuntimeSkill("lit-comprehend"), undefined);
});

// --- Skill assets tests ---

test("lit-comprehend skill directory contains scaffold, references, and verifier", () => {
  const skillRoot = path.join("skills", "lit-comprehend");
  assert.ok(existsSync(path.join(skillRoot, "SKILL.md")));
  assert.ok(existsSync(path.join(skillRoot, "assets", "explainer-scaffold.html")));
  assert.ok(existsSync(path.join(skillRoot, "references", "artifact-template.md")));
  assert.ok(existsSync(path.join(skillRoot, "references", "micro-worlds.md")));
  assert.ok(existsSync(path.join(skillRoot, "scripts", "verify-explainer.ts")));

  const scaffold = readFileSync(path.join(skillRoot, "assets", "explainer-scaffold.html"), "utf8");
  assert.doesNotMatch(scaffold, /<script[^>]+src\s*=/i, "scaffold should have no external scripts");
  assert.doesNotMatch(scaffold, /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*href\s*=/i, "scaffold should have no external stylesheets");
  assert.match(scaffold, /quiz-q/);
  assert.match(scaffold, /white-space\s*:\s*pre/);

  const skill = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.match(skill, /lit-comprehend/i);
  for (const section of ["한눈에", "이미 알고 있던 것", "직관", "바뀐 것", "직접 만져보기", "퀴즈", "다음"]) {
    assert.ok(skill.includes(section), `SKILL.md should mention canonical section: ${section}`);
  }
  assert.match(skill, /delta/i);
  assert.match(skill, /conceptual/i);
  assert.match(skill, /micro-world/i);
  assert.match(skill, /internal verification/i);
  assert.match(skill, /not a required section/i);
  assert.match(skill, /goals\.json/);
  assert.match(skill, /ledger\.jsonl/);
  assert.match(skill, /--en/);
  assert.match(skill, /--md/);
  assert.match(skill, /verbatim/);
  assert.match(skill, /lit-recap/);
});

test("SKILL.md documents the execution gate contract", () => {
  const skill = readFileSync(path.join("skills", "lit-comprehend", "SKILL.md"), "utf8");
  assert.match(skill, /execution gate/i, "SKILL.md must document the execution gate");
  assert.match(skill, /execute directly/i, "SKILL.md must name the direct-execution condition");
  assert.match(skill, /confirm first/i, "SKILL.md must name the confirm-first condition");
  assert.match(skill, /concrete target/i, "gate must describe explicit target paths/ranges");
  assert.match(skill, /bare/i, "gate must describe bare invocation as confirm-first");
  assert.match(skill, /cheap alternative/i, "gate confirmation must offer a cheap alternative when applicable");
  assert.match(skill, /approval/i, "gate must wait for approval before building");
});

// --- Verifier RED/GREEN tests ---

function runVerifier(artifactPath, repoRoot) {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--experimental-strip-types", path.join("skills", "lit-comprehend", "scripts", "verify-explainer.ts"), artifactPath, "--repo", repoRoot, "--json"],
      { encoding: "utf8", timeout: 15000, env: { ...process.env, NODE_NO_WARNINGS: "1" } }
    );
    return { exitCode: 0, result: JSON.parse(stdout) };
  } catch (error) {
    if (error.stdout) {
      try {
        return { exitCode: error.status ?? 1, result: JSON.parse(error.stdout) };
      } catch {
        return { exitCode: error.status ?? 1, result: null, stderr: error.stderr };
      }
    }
    return { exitCode: error.status ?? 1, result: null, stderr: error.stderr };
  }
}

function makeGoodArtifact(quotedFile, quotedLine) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Test</title>
<style>body{color:#333} pre{white-space:pre}</style></head><body>
<h2>한눈에</h2><p>Summary.</p>
<h2>이미 알고 있던 것</h2><p>Context.</p>
<h2>직관</h2><p>Intuition with toy data.</p>
<h2>바뀐 것</h2>
<pre data-src="${quotedFile}:1-2">${quotedLine}</pre>
<h2>직접 만져보기</h2><div class="world"><p>Simplified model.</p></div>
<h2>퀴즈</h2>
<div class="quiz-q" data-answer="2"><h4>Q1</h4>
<div class="opt" data-i="1">Wrong answer A</div><div class="fb" data-i="1">This is incorrect because X.</div>
<div class="opt" data-i="2">Correct answer</div><div class="fb" data-i="2">Correct because Y.</div>
<div class="opt" data-i="3">Wrong answer B</div><div class="fb" data-i="3">This is incorrect because Z.</div></div>
<div class="quiz-q" data-answer="1"><h4>Q2</h4>
<div class="opt" data-i="1">Correct answer</div><div class="fb" data-i="1">Right because A.</div>
<div class="opt" data-i="2">Wrong answer</div><div class="fb" data-i="2">Wrong because B.</div>
<div class="opt" data-i="3">Wrong answer</div><div class="fb" data-i="3">Wrong because C.</div></div>
<div class="quiz-q" data-answer="3"><h4>Q3</h4>
<div class="opt" data-i="1">Wrong</div><div class="fb" data-i="1">No, because D.</div>
<div class="opt" data-i="2">Wrong</div><div class="fb" data-i="2">No, because E.</div>
<div class="opt" data-i="3">Correct</div><div class="fb" data-i="3">Yes, because F.</div></div>
<h2>다음</h2><p>Next steps.</p>
</body></html>`;
}

test("GREEN: verifier passes a conforming artifact", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const quotedFile = "package.json";
    const quotedLine = readFileSync(path.join(repoRoot, quotedFile), "utf8").split("\n")[0];
    const artifactPath = path.join(dir, "2025-08-01-test-green.html");
    await fs.writeFile(artifactPath, makeGoodArtifact(quotedFile, quotedLine));

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.equal(exitCode, 0, `Verifier should pass, got: ${JSON.stringify(result, null, 2)}`);
    assert.equal(result.pass, true);
    const passCount = result.checks.filter((c) => c.status === "PASS").length;
    assert.ok(passCount >= 8, `Expected at least 8 PASS checks, got ${passCount}`);
  });
});

test("RED: verifier rejects phantom quote (lines absent from cited file)", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const artifactPath = path.join(dir, "2025-08-01-phantom.html");
    const html = makeGoodArtifact("package.json", "THIS LINE DOES NOT EXIST IN PACKAGE JSON AT ALL FABRICATED CONTENT");
    await fs.writeFile(artifactPath, html);

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for phantom quote");
    assert.ok(result.checks.some((c) => c.name === "quotes-real" && c.status === "FAIL"));
  });
});

test("RED: verifier rejects nonexistent file quote", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const artifactPath = path.join(dir, "2025-08-01-nofile.html");
    const html = makeGoodArtifact("this/file/does/not/exist.ts", "some content");
    await fs.writeFile(artifactPath, html);

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for nonexistent file");
    assert.ok(result.checks.some((c) => c.name === "quotes-real" && c.status === "FAIL"));
  });
});

test("RED: verifier rejects external resource reference", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const quotedLine = readFileSync(path.join(repoRoot, "package.json"), "utf8").split("\n")[0];
    const artifactPath = path.join(dir, "2025-08-01-external.html");
    let html = makeGoodArtifact("package.json", quotedLine);
    html = html.replace("</head>", '<script src="https://cdn.example.com/lib.js"></script></head>');
    await fs.writeFile(artifactPath, html);

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for external resource");
    assert.ok(result.checks.some((c) => c.name === "self-contained" && c.status === "FAIL"));
  });
});

test("RED: verifier rejects a missing required reader section", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const quotedLine = readFileSync(path.join(repoRoot, "package.json"), "utf8").split("\n")[0];
    const artifactPath = path.join(dir, "2025-08-01-missing-section.html");
    let html = makeGoodArtifact("package.json", quotedLine);
    html = html.replace("한눈에", "REMOVED SECTION");
    await fs.writeFile(artifactPath, html);

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for missing section");
    assert.ok(result.checks.some((c) => c.name === "sections" && c.status === "FAIL"));
  });
});

test("GREEN: status and evidence inventories are not required explainer sections", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const quotedLine = readFileSync(path.join(repoRoot, "package.json"), "utf8").split("\n")[0];
    const artifactPath = path.join(dir, "2025-08-01-concise.html");
    await fs.writeFile(artifactPath, makeGoodArtifact("package.json", quotedLine));

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.equal(exitCode, 0, `Verifier should accept a focused explainer: ${JSON.stringify(result, null, 2)}`);
    assert.ok(!result.checks.some((check) => check.name === "honesty-substantive"));
  });
});

test("RED: verifier rejects quiz option with no feedback", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const quotedLine = readFileSync(path.join(repoRoot, "package.json"), "utf8").split("\n")[0];
    const artifactPath = path.join(dir, "2025-08-01-no-feedback.html");
    let html = makeGoodArtifact("package.json", quotedLine);
    html = html.replace('<div class="fb" data-i="1">This is incorrect because X.</div>', '');
    await fs.writeFile(artifactPath, html);

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for missing feedback");
    assert.ok(result.checks.some((c) => c.name === "quiz" && c.status === "FAIL"));
  });
});

test("RED: verifier rejects positional tell", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const quotedLine = readFileSync(path.join(repoRoot, "package.json"), "utf8").split("\n")[0];
    const artifactPath = path.join(dir, "2025-08-01-positional.html");
    let html = makeGoodArtifact("package.json", quotedLine);
    html = html.replace(/data-answer="2"/g, 'data-answer="1"').replace(/data-answer="3"/g, 'data-answer="1"');
    await fs.writeFile(artifactPath, html);

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for positional tell");
    assert.ok(result.checks.some((c) => c.name === "quiz" && c.status === "FAIL" && c.detail.includes("Positional")));
  });
});

test("RED: verifier rejects ASCII box-drawing outside code blocks", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const quotedLine = readFileSync(path.join(repoRoot, "package.json"), "utf8").split("\n")[0];
    const artifactPath = path.join(dir, "2025-08-01-ascii.html");
    let html = makeGoodArtifact("package.json", quotedLine);
    html = html.replace("<h2>직관</h2><p>Intuition with toy data.</p>", "<h2>직관</h2><p>┌──────┐</p><p>│ box  │</p><p>└──────┘</p>");
    await fs.writeFile(artifactPath, html);

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for ASCII box art");
    assert.ok(result.checks.some((c) => c.name === "no-ascii-art" && c.status === "FAIL"));
  });
});

test("RED: verifier rejects code blocks without data-src attribution", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const quotedLine = readFileSync(path.join(repoRoot, "package.json"), "utf8").split("\n")[0];
    const artifactPath = path.join(dir, "2025-08-01-unattributed.html");
    let html = makeGoodArtifact("package.json", quotedLine);
    html = html.replace(/\s*data-src="[^"]*"/g, "");
    await fs.writeFile(artifactPath, html);

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for unattributed code blocks");
    assert.ok(result.checks.some((c) => c.name === "quotes-attributed" && c.status === "FAIL"));
  });
});

test("RED: verifier rejects artifact inside repo worktree", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = dir;
    const pkgJson = path.join(dir, "package.json");
    await fs.writeFile(pkgJson, '{"name":"test"}');
    const evidenceDir = path.join(dir, "evidence");
    await fs.mkdir(evidenceDir, { recursive: true });
    const artifactPath = path.join(evidenceDir, "2025-08-01-inside.html");
    const quotedLine = '{"name":"test"}';
    await fs.writeFile(artifactPath, makeGoodArtifact("package.json", quotedLine));

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for inside-repo artifact");
    assert.ok(result.checks.some((c) => c.name === "outside-repo" && c.status === "FAIL"));
  });
});

test("RED: verifier rejects non-date-prefixed filename", async () => {
  await withTempDir(async (dir) => {
    const repoRoot = process.cwd();
    const quotedLine = readFileSync(path.join(repoRoot, "package.json"), "utf8").split("\n")[0];
    const artifactPath = path.join(dir, "my-explainer.html");
    await fs.writeFile(artifactPath, makeGoodArtifact("package.json", quotedLine));

    const { exitCode, result } = runVerifier(artifactPath, repoRoot);
    assert.notEqual(exitCode, 0, "Verifier should fail for non-date-prefixed filename");
    assert.ok(result.checks.some((c) => c.name === "filename-dated" && c.status === "FAIL"));
  });
});
