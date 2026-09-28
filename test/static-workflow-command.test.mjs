import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureCommandAliases } from "../src/cli/command-aliases.ts";
import { ensureNativeSkills } from "../src/cli/native-skills.ts";
import {
  createCommandActivationHook,
  findLitOpenCodeCommand,
  litOpenCodeCommands
} from "../src/commands.ts";
import { promptForChatActivationMode } from "../src/activation-routing.ts";
import {
  detectChatActivationMode,
  findLitOpenCodeRuntimeSkill,
  litOpenCodeFeatures,
  readLedgerEvents
} from "../src/index.ts";

const wiredOrphanSkills = [
  { id: "refactor", title: "Refactor", chat: "please refactor this module", inert: "refactoring is fun" },
  { id: "lit-burnoff", title: "Lit Burnoff", chat: "clean the draft then lit-burnoff", inert: "lit-burnoffy" },
  { id: "lit-code", title: "Lit Code", chat: "lit-code discipline for this fix", inert: "lit-codes" },
  { id: "lit-commit", title: "Lit Commit", chat: "lit-commit this dirty worktree", inert: "lit-commity" },
  { id: "debugging", title: "Debugging", chat: "help me with debugging this crash", inert: "debugging-session notes" },
  { id: "lsp", title: "LSP", chat: "ask the lsp for diagnostics", inert: "lsps everywhere" },
  { id: "lsp-setup", title: "LSP Setup", chat: "run lsp-setup for this language", inert: "lsp-setups galore" },
  { id: "deep-interview", title: "Deep Interview", chat: "start a deep-interview on this ask", inert: "deep-interviews" },
  // rules ships a command but deliberately no chat token: the bare word is far too common.
  { id: "rules", title: "Rules", commandOnly: true },
  { id: "structural-search", title: "Structural Search", chat: "find every call site that passes a callback", inert: "find the bug in the parser" },
  { id: "browser-drive", title: "Browser Drive", chat: "use browser-drive on the settings page", inert: "browser-driven testing" },
];

const litCrucibleDepthAnchors = [
  "Frame",
  "Ground",
  "Fan out",
  "Critique",
  "Defend",
  "Distill",
  "Surviving insights for lit-plan",
  "independent read-only lanes",
  "Cross-check",
  "Defense",
  "Rejected approaches",
  "readiness verdict",
  "READY FOR lit-plan",
  "BLOCKED BEFORE lit-plan",
  "Do not edit"
];
const htmlCommentPattern = /<!--[\s\S]*?-->/;

function stripHtmlCommentLines(text) {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/u, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("<!--") && trimmed.endsWith("-->"));
    })
    .join("\n")
    .trim();
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-static-command-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function skillBody(name) {
  return stripHtmlCommentLines(await fs.readFile(path.join("skills", name, "SKILL.md"), "utf8"));
}

function assertNoHtmlCommentArtifact(text, label) {
  assert.doesNotMatch(text, htmlCommentPattern, `${label} should not expose HTML comments or blank <!-- --> artifacts`);
}

function assertEmbeddedSkillContract(commandName, text) {
  assert.match(text, /## #contract\.activation/, `${commandName} should embed contract activation guidance`);
  assert.match(text, /## #contract\.inputs/, `${commandName} should embed contract input schema`);
  assert.match(text, /## #contract\.procedure/, `${commandName} should embed contract procedure`);
  assert.match(text, /## #contract\.evidence/, `${commandName} should embed evidence requirements`);
}

test("exposes lit-crucible and lit-init as installed slash command surfaces", async () => {
  await withTempDir(async (dir) => {
    const crucible = findLitOpenCodeCommand("lit-crucible");
    const initDeep = findLitOpenCodeCommand("lit-init");
    const litCrucibleSkill = await skillBody("lit-crucible");
    const initDeepSkill = await skillBody("lit-init");

    await ensureCommandAliases(dir);
    const litCrucibleAlias = await fs.readFile(path.join(dir, "command", "lit-crucible.md"), "utf8");
    const initDeepAlias = await fs.readFile(path.join(dir, "command", "lit-init.md"), "utf8");

    assert.equal(crucible?.slash, "/lit-crucible");
    assert.equal(crucible?.agent, "lit-plan");
    assert.equal(initDeep?.slash, "/lit-init");
    assert.ok(litOpenCodeCommands.some((entry) => entry.id === "lit-crucible"));
    assert.ok(litOpenCodeCommands.some((entry) => entry.id === "lit-init"));
    assert.match(litCrucibleAlias, /^litopencodeGenerated: true$/m);
    assertNoHtmlCommentArtifact(litCrucibleAlias, "/lit-crucible alias");
    assert.match(litCrucibleAlias, /Lit Crucible/);
    assert.match(litCrucibleAlias, /adversarial planning/i);
    assert.match(litCrucibleAlias, /planning-only/i);
    assertEmbeddedSkillContract("/lit-crucible", litCrucibleAlias);
    assert.ok(litCrucibleAlias.includes(litCrucibleSkill), "/lit-crucible alias should include the full lit-crucible skill body");
    assert.match(initDeepAlias, /^litopencodeGenerated: true$/m);
    assertNoHtmlCommentArtifact(initDeepAlias, "/lit-init alias");
    assert.match(initDeepAlias, /Lit Init/);
    assert.match(initDeepAlias, /AGENTS\.md/);
    assertEmbeddedSkillContract("/lit-init", initDeepAlias);
    assert.ok(initDeepAlias.includes(initDeepSkill), "/lit-init alias should include the full lit-init skill body");
  });
});

test("activates lit-crucible and lit-init command hooks with concrete workflow guidance", async () => {
  await withTempDir(async (dir) => {
    const hook = createCommandActivationHook(dir);
    const litCrucibleOutput = { parts: [] };
    const initDeepOutput = { parts: [] };
    const litCrucibleSkill = await skillBody("lit-crucible");
    const initDeepSkill = await skillBody("lit-init");

    await hook({ command: "/lit-crucible", sessionID: "session-lit-crucible", arguments: "plan risky change" }, litCrucibleOutput);
    await hook({ command: "/lit-init", sessionID: "session-lit-init", arguments: "refresh repo guidance" }, initDeepOutput);

    assert.equal(litCrucibleOutput.parts.length, 1);
    assert.match(litCrucibleOutput.parts[0].text, /Lit Crucible/);
    assert.match(litCrucibleOutput.parts[0].text, /planning-only/i);
    assertNoHtmlCommentArtifact(litCrucibleOutput.parts[0].text, "/lit-crucible hook output");
    assertEmbeddedSkillContract("/lit-crucible hook", litCrucibleOutput.parts[0].text);
    for (const anchor of litCrucibleDepthAnchors) {
      assert.ok(litCrucibleOutput.parts[0].text.includes(anchor), `/lit-crucible command hook should include ${anchor}`);
    }
    assert.ok(litCrucibleOutput.parts[0].text.includes(litCrucibleSkill), "/lit-crucible command hook should include the full lit-crucible skill body");
    assert.equal(litCrucibleOutput.parts[0].metadata.litopencode.command, "lit-crucible");
    assert.equal(litCrucibleOutput.parts[0].metadata.litopencode.mode, "lit-crucible");

    assert.equal(initDeepOutput.parts.length, 1);
    assert.match(initDeepOutput.parts[0].text, /Lit Init/);
    assert.match(initDeepOutput.parts[0].text, /AGENTS\.md/);
    assertNoHtmlCommentArtifact(initDeepOutput.parts[0].text, "/lit-init hook output");
    assertEmbeddedSkillContract("/lit-init hook", initDeepOutput.parts[0].text);
    assert.ok(initDeepOutput.parts[0].text.includes(initDeepSkill), "/lit-init command hook should include the full lit-init skill body");
    assert.equal(initDeepOutput.parts[0].metadata.litopencode.command, "lit-init");
    assert.equal(initDeepOutput.parts[0].metadata.litopencode.mode, "lit-init");

    const events = await readLedgerEvents(dir);
    assert.deepEqual(events.map((event) => event.command), ["lit-crucible", "lit-init"]);
    assert.deepEqual(events.map((event) => event.arguments.redacted), [true, true]);
  });
});

test("slash command activations include the matching static skill body", async () => {
  await withTempDir(async (dir) => {
    const hook = createCommandActivationHook(dir);
    const output = { parts: [] };
    const workflowSkill = await skillBody("workflow-loop");
    const startWorkSkill = await skillBody("start-work");
    const reviewWorkSkill = await skillBody("review-work");
    const litResearchSkill = await skillBody("litresearch");
    const litGoalSkill = await skillBody("durable-litgoal");
    const litRecapSkill = await skillBody("lit-recap");

    await ensureCommandAliases(dir);
    const litworkAlias = await fs.readFile(path.join(dir, "command", "litwork.md"), "utf8");
    const startWorkAlias = await fs.readFile(path.join(dir, "command", "start-work.md"), "utf8");
    const reviewWorkAlias = await fs.readFile(path.join(dir, "command", "review-work.md"), "utf8");
    const litResearchAlias = await fs.readFile(path.join(dir, "command", "lit-research.md"), "utf8");
    const litGoalAlias = await fs.readFile(path.join(dir, "command", "litgoal.md"), "utf8");
    const litRecapAlias = await fs.readFile(path.join(dir, "command", "lit-recap.md"), "utf8");

    assert.ok(litworkAlias.includes(workflowSkill), "/litwork alias should include the full workflow-loop skill body");
    assertNoHtmlCommentArtifact(litworkAlias, "/litwork alias");
    assert.ok(startWorkAlias.includes(startWorkSkill), "/start-work alias should include the full start-work skill body");
    assertNoHtmlCommentArtifact(startWorkAlias, "/start-work alias");
    assert.ok(reviewWorkAlias.includes(reviewWorkSkill), "/review-work alias should include the full review-work skill body");
    assertNoHtmlCommentArtifact(reviewWorkAlias, "/review-work alias");
    assert.ok(litResearchAlias.includes(litResearchSkill), "/lit-research alias should include the full litresearch skill body");
    assertNoHtmlCommentArtifact(litResearchAlias, "/lit-research alias");
    assert.ok(litGoalAlias.includes(litGoalSkill), "/litgoal alias should include the full durable-litgoal skill body");
    assertNoHtmlCommentArtifact(litGoalAlias, "/litgoal alias");
    assert.ok(litRecapAlias.includes(litRecapSkill), "/lit-recap alias should include the full lit-recap skill body");
    assertNoHtmlCommentArtifact(litRecapAlias, "/lit-recap alias");

    await hook({ command: "/litwork", sessionID: "session-litwork", arguments: "" }, output);
    await hook({ command: "/start-work", sessionID: "session-start-work", arguments: "" }, output);
    await hook({ command: "/review-work", sessionID: "session-review-work", arguments: "" }, output);
    await hook({ command: "/litresearch", sessionID: "session-litresearch", arguments: "investigate source" }, output);
    await hook({ command: "/litgoal", sessionID: "session-litgoal", arguments: "bind objective" }, output);
    await hook({ command: "/lit-recap", sessionID: "session-lit-recap", arguments: "--brief" }, output);

    assert.equal(output.parts.length, 6);
    assert.ok(output.parts[0].text.includes(workflowSkill), "/litwork hook should include the full workflow-loop skill body");
    assertNoHtmlCommentArtifact(output.parts[0].text, "/litwork hook output");
    assert.ok(output.parts[1].text.includes(startWorkSkill), "/start-work hook should include the full start-work skill body");
    assertNoHtmlCommentArtifact(output.parts[1].text, "/start-work hook output");
    assert.ok(output.parts[2].text.includes(reviewWorkSkill), "/review-work hook should include the full review-work skill body");
    assertNoHtmlCommentArtifact(output.parts[2].text, "/review-work hook output");
    assert.ok(output.parts[3].text.includes(litResearchSkill), "/litresearch hook should include the full litresearch skill body");
    assertNoHtmlCommentArtifact(output.parts[3].text, "/litresearch hook output");
    assert.ok(output.parts[4].text.includes(litGoalSkill), "/litgoal hook should include the full durable-litgoal skill body");
    assertNoHtmlCommentArtifact(output.parts[4].text, "/litgoal hook output");
    assert.ok(output.parts[5].text.includes(litRecapSkill), "/lit-recap hook should include the full lit-recap skill body");
    assertNoHtmlCommentArtifact(output.parts[5].text, "/lit-recap hook output");
    assert.equal(output.parts[0].metadata.litopencode.mode, "lit-loop");
    assert.equal(output.parts[1].metadata.litopencode.mode, "start-work");
    assert.equal(output.parts[2].metadata.litopencode.mode, "lit-loop");
    assert.equal(output.parts[3].metadata.litopencode.mode, "lit-research");
    assert.equal(output.parts[4].metadata.litopencode.mode, "lit-loop");
    assert.equal(output.parts[5].metadata.litopencode.mode, "lit-recap");
  });
});

test("wired orphan skills reach a command alias, a command hook, and a chat route", async () => {
  await withTempDir(async (dir) => {
    const hook = createCommandActivationHook(dir);
    await ensureCommandAliases(dir);

    for (const { id, title, chat, inert, commandOnly } of wiredOrphanSkills) {
      const command = findLitOpenCodeCommand(id);
      const body = await skillBody(id);
      const alias = await fs.readFile(path.join(dir, "command", `${id}.md`), "utf8");
      const output = { parts: [] };

      await hook({ command: `/${id}`, sessionID: `session-${id}`, arguments: "" }, output);

      assert.equal(command?.slash, `/${id}`);
      assert.ok(litOpenCodeCommands.some((entry) => entry.id === id));
      assert.match(alias, /^litopencodeGenerated: true$/m);
      assertNoHtmlCommentArtifact(alias, `/${id} alias`);
      assert.ok(alias.includes(body), `/${id} alias should include the full ${id} skill body`);
      assertEmbeddedSkillContract(`/${id}`, alias);

      assert.equal(output.parts.length, 1);
      assert.match(output.parts[0].text, new RegExp(title));
      assert.ok(output.parts[0].text.includes(body), `/${id} hook should include the full ${id} skill body`);
      assert.equal(output.parts[0].metadata.litopencode.command, id);
      assert.equal(output.parts[0].metadata.litopencode.mode, id);
      assertNoHtmlCommentArtifact(output.parts[0].text, `/${id} hook output`);

      if (commandOnly) {
        // A command-only skill must not claim a chat token it does not own.
        assert.equal(detectChatActivationMode(`please follow the ${id} here`), undefined);
      } else {
        // The chat route is what makes the skill reachable without the user knowing the slash name.
        assert.equal(detectChatActivationMode(chat), id, `${chat} should route to ${id}`);
        assert.ok(promptForChatActivationMode(id).includes(body), `${id} chat prompt should carry the skill body`);
        // A compound word that merely contains the token must stay inert.
        assert.notEqual(detectChatActivationMode(inert), id, `${inert} should not route to ${id}`);
      }
      // The slash mention suppresses double activation: the command hook already injected the body.
      assert.equal(detectChatActivationMode(`/${id} do the thing`), undefined);
    }

    const events = await readLedgerEvents(dir);
    assert.deepEqual(events.map((event) => event.command), wiredOrphanSkills.map((entry) => entry.id));
  });
});

test("rules docs, catalogs, and /rules output describe the shipped two-lane engine", async () => {
  await withTempDir(async (dir) => {
    const hook = createCommandActivationHook(dir);
    const output = { parts: [] };
    const skill = await skillBody("rules");
    const runtimeSkill = JSON.stringify(findLitOpenCodeRuntimeSkill("rules"));
    const feature = JSON.stringify(litOpenCodeFeatures.find((entry) => entry.id === "rules"));
    const readme = await fs.readFile("README.md", "utf8");
    const releaseChecklist = await fs.readFile(path.join("docs", "release-checklist.md"), "utf8");
    const surfaces = new Map([
      ["skills/rules/SKILL.md", skill],
      ["runtime skill catalog", runtimeSkill],
      ["feature catalog", feature],
      ["README.md", readme],
      ["docs/release-checklist.md", releaseChecklist]
    ]);
    const staleNoEngine = /(?:ships|has) no rules (?:discovery |injection )?engine|no discovery pass|no per-edit injection/i;

    await hook({ command: "/rules", sessionID: "session-rules-engine", arguments: "show active rule lanes" }, output);
    surfaces.set("/rules hook output", output.parts[0].text);

    for (const [label, text] of surfaces) {
      assert.doesNotMatch(text, staleNoEngine, `${label} must not deny the shipped rules engine`);
      assert.match(text, /two[- ]lane/i, `${label} should identify the two-lane engine`);
    }
    for (const text of [skill, runtimeSkill, feature, output.parts[0].text]) {
      assert.match(text, /experimental\.chat\.system\.transform/);
      assert.match(text, /tool\.execute\.after/);
      assert.match(text, /untrusted/i);
    }
    assert.equal(output.parts.length, 1);
    assert.equal(output.parts[0].metadata.litopencode.command, "rules");
    assert.equal(output.parts[0].metadata.litopencode.mode, "rules");
  });
});

test("design intent reaches frontend-ui-ux before editing starts, and visual-qa answers to its own name", async () => {
  // These two skills carry YAML frontmatter, which the runtime strips before inlining. Assert on
  // distinctive body content rather than the raw file, so the check does not depend on which
  // stripping helper produced it.
  const carriesBody = (mode, heading) => {
    const prompt = promptForChatActivationMode(mode);
    assert.match(prompt, /# Installed skill body/, `${mode} prompt should inline the skill body`);
    assert.ok(prompt.includes(heading), `${mode} prompt should contain ${heading}`);
    assert.doesNotMatch(prompt, /^name: /m, `${mode} prompt should not leak YAML frontmatter`);
  };

  // The plan's own consumer probe. Before this route existed it returned no activation, so the
  // capability was reachable only from the post-edit hook — after the work had already begun.
  assert.equal(detectChatActivationMode("design a new settings page UI"), "frontend-ui-ux");
  assert.equal(detectChatActivationMode("redesign the dashboard layout"), "frontend-ui-ux");
  assert.equal(detectChatActivationMode("build a login screen UI"), "frontend-ui-ux");
  assert.equal(detectChatActivationMode("frontend-ui-ux"), "frontend-ui-ux");
  carriesBody("frontend-ui-ux", "# Frontend UI/UX");

  // Both halves are required, because either alone is far too common to be a signal.
  assert.equal(detectChatActivationMode("design the database schema"), undefined);
  assert.equal(detectChatActivationMode("implement the interface for the parser"), undefined);
  assert.equal(detectChatActivationMode("add a retry to the fetch helper"), undefined);
  assert.equal(detectChatActivationMode("review the design docs"), undefined);

  // visual-qa is name-shaped: the id is distinctive on its own, hyphenated or spaced.
  assert.equal(detectChatActivationMode("visual-qa this page"), "visual-qa");
  assert.equal(detectChatActivationMode("run visual qa on the new modal"), "visual-qa");
  carriesBody("visual-qa", "# Visual QA");

  // Neither route may outrank a more specific one.
  assert.equal(detectChatActivationMode("refactor the page loader"), "refactor");
  assert.equal(detectChatActivationMode("lit plan the new dashboard"), "lit-plan");
});

test("design intent reaches frontend-ui-ux in Korean, with the same verb-and-noun conjunction", () => {
  // The person these plugins are for writes Korean, so an English-only route leaves the capability
  // unreachable for exactly the prompts it exists for.
  for (const text of [
    "설정 페이지 UI를 새로 디자인해줘",
    "디자인 시스템을 만들어줘",
    "대시보드 레이아웃을 개편하고 싶어",
    "로그인 화면을 만들어줘",
    "사이드바 컴포넌트를 제작해줘"
  ]) {
    assert.equal(detectChatActivationMode(text), "frontend-ui-ux", `${text} should reach frontend-ui-ux`);
  }

  // Korean stems are matched as substrings so agglutination works: 디자인해줘 / 개편하고 / 다듬어
  // all carry endings attached directly to the stem.
  assert.equal(detectChatActivationMode("모달을 다듬어줘"), "frontend-ui-ux");
  assert.equal(detectChatActivationMode("홈페이지를 만들어줘"), "frontend-ui-ux", "compounds like 홈페이지 must still match");

  // The negatives are what prove the conjunction still holds. A making verb alone is not a signal.
  for (const text of [
    "API 클라이언트를 만들어줘",
    "데이터베이스 마이그레이션을 새로 만들어줘",
    "데이터베이스 스키마를 디자인해줘",
    "인터페이스를 구현해줘",
    "이 함수에 재시도 로직을 추가해줘"
  ]) {
    assert.equal(detectChatActivationMode(text), undefined, `${text} should stay inert`);
  }
});

test("structural-search routes on a syntax-shaped search and stays inert for a text-shaped one", () => {
  // Nobody types the skill name, so the route is intent-shaped: a search-or-rewrite verb AND a noun
  // naming a syntax shape. Either half alone is far too common to be a signal.
  for (const text of [
    "find every call site that passes a callback",
    "rewrite these imports",
    "locate declarations of this form",
    "codemod the function signatures",
    "structural-search"
  ]) {
    assert.equal(detectChatActivationMode(text), "structural-search", `${text} should reach structural-search`);
  }

  // Text-shaped requests are text searches; the skill says so and the route must agree.
  for (const text of ["find the bug in the parser", "search the docs for the changelog", "replace the logo image"]) {
    assert.equal(detectChatActivationMode(text), undefined, `${text} should stay inert`);
  }

  // It must not displace a more specific route.
  assert.equal(detectChatActivationMode("refactor the page loader"), "refactor");
  assert.equal(detectChatActivationMode("design a new settings page UI"), "frontend-ui-ux");
  assert.equal(detectChatActivationMode("ask the lsp for diagnostics"), "lsp");
});

test("structural-search shape vocabulary admits syntactic terms only, never semantic ones", () => {
  // CORRECTION to an earlier pin in this file. `callers` was added here on the argument that
  // "find all the callers" and "find every call site" are the same request. They are not: the second
  // constrains argument shape, the first asks WHO calls a symbol. skills/structural-search/SKILL.md:149
  // says so outright — "Finding every caller of a function is a language-server question" — so the
  // router was contradicting the skill's own routing table, and the body is the authority.
  for (const text of [
    "find every call site that passes a callback",
    "migrate the call sites to the new signature",
    "rewrite these imports",
    "rewrite these imports by syntax shape",
    "locate declarations of this form",
    "codemod the function signatures"
  ]) {
    assert.equal(detectChatActivationMode(text), "structural-search", `${text} should reach structural-search`);
  }

  // WHO questions belong to the language server and must NOT route here, however they are phrased.
  for (const text of [
    "find all the callers",
    "find all callers of parseConfig",
    "find references to this symbol",
    "find all usages of the old helper",
    "locate the invocations of this helper",
    "find the call graph of parse"
  ]) {
    assert.equal(detectChatActivationMode(text), undefined, `${text} is a semantic question, not a syntax shape`);
  }

  // Bare `signatures` was dropped for a different reason: it is not semantic, it is ambiguous.
  assert.equal(detectChatActivationMode("search the changelog for signatures"), undefined, "cryptographic, not code");
  assert.equal(detectChatActivationMode("search for references to the old API in the docs"), undefined, "prose, not source");

  // The verb half is what rejects compiler vocabulary used to DISCUSS a construct rather than match
  // one. These must stay silent, and they are why the verb half is not widened alongside the shape
  // half: adding `check` and `update` to it turns two of them into false positives.
  for (const text of [
    "add a declaration for this variable",
    "update the import statement at the top",
    "the AST output is confusing, explain it",
    "check the call site of this bug",
    "fix the type declaration in types.d.ts",
    "document the signature of this API",
    "this declaration is in the wrong file"
  ]) {
    assert.equal(detectChatActivationMode(text), undefined, `${text} must stay inert`);
  }

  // KNOWN MISS, pinned deliberately so it is a recorded limit rather than a surprise. `show` and
  // `list` are ordinary search verbs a user would reasonably use, and they are absent on purpose:
  // widening the verb half is what breaks the negatives above. Closeout section 19i has the class.
  assert.equal(detectChatActivationMode("show me the call graph"), undefined);
  assert.equal(detectChatActivationMode("list all callers of this function"), undefined);
});

test("generated-file marker detection preserves custom files that mention marker text", async () => {
  await withTempDir(async (dir) => {
    const customCommand = [
      "---",
      "description: custom lit command",
      "---",
      "",
      "Custom command body that documents litopencodeGenerated: true without opting into overwrite.",
      ""
    ].join("\n");
    const customSkill = [
      "---",
      "name: workflow-loop",
      "description: custom workflow skill",
      "---",
      "",
      "Custom skill body that documents litopencodeGenerated: true without opting into overwrite.",
      ""
    ].join("\n");
    const legacyGeneratedCommand = [
      "---",
      "description: old generated litwork command",
      "---",
      "",
      "<!-- Generated by litopencode install. -->",
      "",
      "old generated content",
      ""
    ].join("\n");

    await fs.mkdir(path.join(dir, "command"), { recursive: true });
    await fs.writeFile(path.join(dir, "command", "lit.md"), customCommand, "utf8");
    await fs.writeFile(path.join(dir, "command", "litwork.md"), legacyGeneratedCommand, "utf8");
    await fs.mkdir(path.join(dir, "skills", "workflow-loop"), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", "workflow-loop", "SKILL.md"), customSkill, "utf8");

    await ensureCommandAliases(dir);
    await ensureNativeSkills(dir, { name: "litopencode", version: "0.1.39", packageRoot: path.resolve(".") });

    assert.equal(await fs.readFile(path.join(dir, "command", "lit.md"), "utf8"), customCommand);
    assert.equal(await fs.readFile(path.join(dir, "skills", "workflow-loop", "SKILL.md"), "utf8"), customSkill);
    const rewrittenLegacy = await fs.readFile(path.join(dir, "command", "litwork.md"), "utf8");
    assert.match(rewrittenLegacy, /^litopencodeGenerated: true$/m);
    assertNoHtmlCommentArtifact(rewrittenLegacy, "rewritten legacy generated command");
  });
});

 test("authorized frontend build context reaches production without a second approval gate", () => {
  assert.equal(detectChatActivationMode("build a bilingual landing page UI"), "frontend-ui-ux");
  const context = promptForChatActivationMode("frontend-ui-ux");
  assert.match(context, /working implementation/i);
  assert.match(context, /review-only.*plan-only/is);
  assert.doesNotMatch(context, /implement only after approval|does not render|Freeze intent/);
  assert.equal(detectChatActivationMode("explain the UI event log"), undefined);
  assert.equal(detectChatActivationMode("review the design docs"), undefined);
});
