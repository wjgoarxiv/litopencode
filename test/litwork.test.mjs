import { activationDiscipline } from "../src/activation-probe.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  litActivationBanner,
  createChatMessageActivationHook,
  detectChatActivationMode,
  litPlanPromptInjection,
  litOpenCodeCommands,
  litOpenCodeTools,
  pluginModule,
  readLedgerEvents
} from "../src/index.ts";
import { litLoopPromptInjection, reviewWorkPromptInjection } from "../src/activation.ts";

const repoRoot = path.resolve(".");
const htmlCommentPattern = /<!--[\s\S]*?-->/;

function stripHtmlCommentLines(text) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("<!--") && trimmed.endsWith("-->"));
    })
    .join("\n")
    .trim();
}

async function skillBody(name) {
  const text = stripHtmlCommentLines(await fs.readFile(path.join(repoRoot, "skills", name, "SKILL.md"), "utf8"));
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end === -1 ? text : text.slice(end + "\n---\n".length).trim();
}

function assertNoHtmlCommentArtifact(text, label) {
  assert.doesNotMatch(text, htmlCommentPattern, `${label} should not expose HTML comments or blank <!-- --> artifacts`);
}

const litCrucibleDepthAnchors = [
  "Surviving insights for lit-plan",
  "independent read-only lanes",
  "Cross-check",
  "Defense",
  "Rejected approaches",
  "READY FOR lit-plan",
  "BLOCKED BEFORE lit-plan",
  "Do not edit"
];

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-litwork-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function createToolContext(dir) {
  return {
    sessionID: "session-litwork",
    messageID: "message-litwork",
    agent: "lit-loop",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {}
  };
}

function rootSessionClient() {
  return {
    session: {
      get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } })
    }
  };
}

test("exposes unique lit and litwork command activation metadata", () => {
  // Given: the public command activation surface.
  const ids = litOpenCodeCommands.map((command) => command.id);
  const slashes = litOpenCodeCommands.map((command) => command.slash);

  // When/Then: workflow commands are present with unique ids and visible banner text.
  assert.deepEqual(ids.sort(), [
    "autoconference",
    "autoconference-analyze",
    "autoconference-debate",
    "autoconference-plan",
    "autoconference-resume",
    "autoconference-ship",
    "autoconference-survey",
    "autoresearch",
    "autoresearch-debug",
    "autoresearch-fix",
    "autoresearch-learn",
    "autoresearch-plan",
    "autoresearch-predict",
    "autoresearch-reason",
    "autoresearch-scenario",
    "autoresearch-security",
    "autoresearch-ship",
    "browser-drive",
    "debugging",
    "deep-interview",
    "lit-commit",
    "lit-crucible",
    "lit-init",
    "lit",
    "lit-comprehend",
    "lit-goal",
    "lit-handoff",
    "lit-loop",
    "lit-plan",
    "lit-recap",
    "lit-research",
    "lit-scientific-visualization",
    "lit-work",
    "litgoal",
    "litresearch",
    "litwork",
    "lsp",
    "lsp-setup",
    "lit-code",
    "refactor",
    "lit-burnoff",
    "lit-burnoff-file",
    "lit-fetch",
    "review-work",
    "rules",
    "start-work",
    "structural-search",
    "lit-humanizer",
    "wikify-ingest",
    "wikify-init",
    "wikify-lint",
    "wikify-query",
    "wikify-save"
  ].sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(slashes).size, slashes.length);
  assert.ok(slashes.includes("/lit-research"));
  assert.ok(slashes.includes("/start-work"));
  assert.ok(slashes.includes("/review-work"));
  assert.ok(slashes.includes("/lit-humanizer"));
  assert.equal(litActivationBanner, "🔥 LIT IGNITED · lit-loop 🔥");
  for (const command of litOpenCodeCommands) {
    assert.equal(command.banner, `🔥 LIT IGNITED · ${activationDiscipline(command.id)} 🔥`);
    assert.ok(command.activationText.includes(`🔥 **LIT IGNITED · ${activationDiscipline(command.id)}** 🔥`));
    assert.match(command.activationText, /lit-loop|start-work|review-work|litresearch|litgoal|lit-plan|init deep|lit-crucible|lit-handoff|scientific-visualization|refactor|lit-burnoff|lit-code|debugging|lit-commit|lsp|rules|deep-interview|lit-comprehend|browser-drive/i);
  }
});

test("lit-plan activation hands approved plans to lit-implement", () => {
  assert.match(litPlanPromptInjection, /lit-implement through \/start-work/);
  assert.doesNotMatch(litPlanPromptInjection, /hand execution to lit-loop through \/start-work/);
  assert.match(litPlanPromptInjection, /Do not start implementation yourself/);
});

test("lit-plan activation produces proportionate objective-achievable checklists", () => {
  // Given: the OpenCode-native planning prompt exposed by /lit-plan and chat activation.
  // When/Then: it requires an execution-ready contract without padding simple work.
  assert.match(litPlanPromptInjection, /one bounded objective/i);
  assert.match(litPlanPromptInjection, /explicit non-goals/i);
  assert.match(litPlanPromptInjection, /action, output, and verification/i);
  assert.match(litPlanPromptInjection, /dependencies and order/i);
  assert.match(litPlanPromptInjection, /resolve material unknowns|resolved or gated unknowns/i);
  assert.match(litPlanPromptInjection, /failure or decision branches/i);
  assert.match(litPlanPromptInjection, /DoneClaim/i);
  assert.match(litPlanPromptInjection, /proportionate/i);
  assert.match(litPlanPromptInjection, /SDD-like gates/i);
  assert.match(litPlanPromptInjection, /no padding/i);
});

test("review-work activation supports draft-plan review without weakening completed-work review", () => {
  // Given: the shared review-work command/chat prompt.
  // When/Then: it selects a review mode from the supplied artifact and never implements a draft.
  assert.match(reviewWorkPromptInjection, /draft-plan review mode/i);
  assert.match(reviewWorkPromptInjection, /scope/i);
  assert.match(reviewWorkPromptInjection, /objective achievability/i);
  assert.match(reviewWorkPromptInjection, /checklist atomicity/i);
  assert.match(reviewWorkPromptInjection, /acceptance.*evidence/i);
  assert.match(reviewWorkPromptInjection, /failure\/decision\/cleanup/i);
  assert.match(reviewWorkPromptInjection, /PASS.*ITERATE.*NEEDS-CONTEXT/i);
  assert.match(reviewWorkPromptInjection, /revise only when needed/i);
  assert.match(reviewWorkPromptInjection, /never implement/i);
  assert.match(reviewWorkPromptInjection, /completed-work mode/i);
  assert.match(reviewWorkPromptInjection, /five lanes/i);
});

function composedSection(text, heading, nextHeading) {
  const start = text.indexOf(heading);
  const end = text.indexOf(nextHeading, start + heading.length);
  assert.ok(start >= 0 && end > start, `expected bounded section ${heading}`);
  return text.slice(start, end);
}

test("lit-loop default completion guidance qualifies review depth by tier", () => {
  const completion = composedSection(litLoopPromptInjection, "## Completion Standard", "## Loop State Machine");
  const state = composedSection(litLoopPromptInjection, "## Loop State Machine", "## Applying the Loop to Documentation");
  const skills = composedSection(litLoopPromptInjection, "## Coordination With Skills", "## Failure Recovery");

  for (const [label, section] of [["completion", completion], ["state", state], ["skills", skills]]) {
    assert.match(section, /(?:LIGHT[\s\S]{0,260}self-review|self-review[\s\S]{0,260}LIGHT)/i, `${label} should name the LIGHT self-review path`);
    assert.match(section, /HEAVY[\s\S]{0,260}(?:five[- ]lanes?|full review)/i, `${label} should retain the HEAVY full-review path`);
    assert.match(section, /explicit(?:ly)?[\s\S]{0,100}(?:review|release)/i, `${label} should preserve explicit review/release handling`);
  }
  assert.doesNotMatch(state, /\*\*Review\*\* challenges the DoneClaim through five lanes\./, "state must not retain the unconditional five-lane sentence");
  assert.doesNotMatch(skills, /Use `review-work` before completion\./, "skills must not retain the unconditional review-work sentence");
});

test("user-facing activation texts omit HTML comment artifacts except the exact handoff source", async () => {
  const handoffOriginal = await fs.readFile(path.join("vendor", "handoff", "SKILL.md"), "utf8");
  const handoffTemplate = await fs.readFile(path.join("vendor", "handoff", "templates", "HANDOFF.md"), "utf8");
  for (const command of litOpenCodeCommands) {
    if (command.id === "lit-handoff") {
      assert.ok(command.activationText.includes(handoffOriginal));
      assert.ok(command.activationText.includes(handoffTemplate));
      continue;
    }
    assertNoHtmlCommentArtifact(command.activationText, `${command.id} activation text`);
  }
  assertNoHtmlCommentArtifact(litPlanPromptInjection, "lit-plan prompt injection");
});

test("workflow prompts and review surfaces enforce minimum-first discipline", async () => {
  const agents = await fs.readFile(path.join(repoRoot, "src", "agents", "defaults.ts"), "utf8");
  const activation = await fs.readFile(path.join(repoRoot, "src", "activation.ts"), "utf8");
  const reviewSkill = await fs.readFile(path.join(repoRoot, "skills", "review-work", "SKILL.md"), "utf8");

  assert.match(agents, /minimum-first/i);
  assert.match(agents, /does this need to exist/i);
  assert.match(agents, /already-installed dependency/i);

  assert.match(activation, /minimum-first/i);
  assert.match(activation, /single-task or few-task/i);
  assert.match(activation, /avoidable custom code/i);
  assert.match(activation, /external-source/i);

  assert.match(reviewSkill, /minimum-first/i);
  assert.match(reviewSkill, /avoidable custom code/i);
  assert.match(reviewSkill, /unnecessary helpers?/i);
  assert.match(reviewSkill, /external-source/i);

  for (const command of litOpenCodeCommands.filter((entry) => ["lit", "lit-loop", "lit-plan", "start-work", "review-work"].includes(entry.id))) {
    assert.match(command.activationText, /minimum-first|avoidable custom code/i, `${command.id} should carry minimum-first review guidance`);
  }
});

test("registers OpenCode tools and command hook through the plugin server", async () => {
  await withTempDir(async (dir) => {
    // Given: a plugin server rooted in a temporary worktree.
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });

    // When: OpenCode inspects hooks and activates /start-work plus a Lit sibling command.
    const output = { parts: [] };
    await hooks["command.execute.before"]({ command: "/start-work", sessionID: "session-command", arguments: "" }, output);
    await hooks["command.execute.before"]({ command: "/lit-research", sessionID: "session-command", arguments: "" }, output);

    // Then: command and tool surfaces are consumable and the durable ledger records activation.
    assert.deepEqual(Object.keys(hooks.tool).sort(), ["lit", "litwork", "review-work", "start-work", "wikify"]);
    assert.equal(typeof hooks.tool.lit.execute, "function");
    assert.equal(typeof hooks.tool.litwork.execute, "function");
    assert.equal(typeof hooks.tool["start-work"].execute, "function");
    assert.equal(typeof hooks.tool["review-work"].execute, "function");
    assert.equal(typeof hooks.tool.wikify.execute, "function");
    assert.equal(typeof hooks["command.execute.before"], "function");
    assert.equal(typeof hooks["chat.message"], "function");
    assert.equal(output.parts.length, 2);
    assert.equal(output.parts[0].type, "text");
    assert.match(output.parts[0].id, /^prt/);
    assert.match(output.parts[0].messageID, /^msg/);
    assert.match(output.parts[0].text, /start-work/);
    assertNoHtmlCommentArtifact(output.parts[0].text, "/start-work command output");
    assert.equal(output.parts[1].type, "text");
    assert.match(output.parts[1].id, /^prt/);
    assert.match(output.parts[1].messageID, /^msg/);
    assert.match(output.parts[1].text, /litresearch/);
    assertNoHtmlCommentArtifact(output.parts[1].text, "/lit-research command output");
    assert.deepEqual(await readLedgerEvents(dir), [
      {
        type: "command.activated",
        command: "start-work",
        arguments: { present: false, redacted: false, length: 0 },
        sessionID: "session-command",
        timestamp: (await readLedgerEvents(dir))[0].timestamp
      },
      {
        type: "command.activated",
        command: "lit-research",
        arguments: { present: false, redacted: false, length: 0 },
        sessionID: "session-command",
        timestamp: (await readLedgerEvents(dir))[1].timestamp
      }
    ]);
  });
});

test("injects lit-loop prompt through chat.message when explicit long-work terms accompany bare lit", async () => {
  await withTempDir(async (dir) => {
    const workflowSkill = await skillBody("workflow-loop");
    // Given: an OpenCode chat.message hook with a user text part containing standalone lit.
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = {
      message: {
        id: "msg_lit",
        sessionID: "session-lit",
        role: "user"
      },
      parts: [
        {
          id: "part-user",
          sessionID: "session-lit",
          messageID: "msg_lit",
          type: "text",
          text: "Please continue this long-running task across turns with a durable ledger. lit"
        }
      ]
    };

    // When: OpenCode delivers the message to the plugin.
    await hooks["chat.message"]({ sessionID: "session-lit", messageID: "msg_lit", agent: "lit-loop" }, output);

    // Then: LitOpenCode appends a visible directive and records only redacted trigger metadata.
    assert.equal(output.parts.length, 2);
    assert.equal(output.parts[1].synthetic, undefined);
    assert.match(output.parts[1].id, /^prt/);
    assert.match(output.parts[1].messageID, /^msg/);
    assert.match(output.parts[1].text, /^🔥 LIT IGNITED · lit-loop 🔥/u);
    assert.match(output.parts[1].text, /<lit-loop-mode>/);
    assert.match(output.parts[1].text, /# Enter lit-loop/);
    assert.match(output.parts[1].text, /# Durable state/);
    assert.match(output.parts[1].text, /\.litopencode\/litgoal\/lit-loop\/brief\.md/);
    assert.match(output.parts[1].text, /# Verify progress/);
    assert.match(output.parts[1].text, /TESTS ALONE NEVER PROVE DONE/);
    assert.match(output.parts[1].text, /# Checkpoint evidence/);
    assert.match(output.parts[1].text, /# OpenCode goal handoff/);
    assert.match(output.parts[1].text, /OpenCode does not expose a native goal primitive/);
    assert.match(output.parts[1].text, /# Continue or stop/);
    assertNoHtmlCommentArtifact(output.parts[1].text, "explicit long-work lit chat output");
    assert.ok(output.parts[1].text.includes(workflowSkill), "explicit long-work lit should include the full workflow-loop skill body");
    assert.ok(output.parts[1].text.split("\n").length > 70);
    const rawLedger = await fs.readFile(path.join(dir, ".litopencode", "litgoal", "lit-loop", "ledger.jsonl"), "utf8");
    assert.doesNotMatch(rawLedger, /please continue/);
    assert.deepEqual(
      (await readLedgerEvents(dir)).map((event) => event.type),
      ["prompt.activated"]
    );
  });
});

test("routes a bounded bare lit request to direct verified work and keeps explicit long work on lit-loop", async () => {
  const boundedText = "Fix the typo in the first README heading and report the changed line. lit";
  const longText = "Handle this long-running task across turns, keep a durable ledger, and continue until every criterion is proven. lit";
  assert.equal(detectChatActivationMode(boundedText), "lit-task");
  assert.equal(detectChatActivationMode(longText), "lit-loop");

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
    const output = {
      message: {
        id: "msg_bounded_lit",
        sessionID: "session_bounded_lit",
        role: "user"
      },
      parts: [
        {
          id: "part_bounded_lit",
          sessionID: "session_bounded_lit",
          messageID: "msg_bounded_lit",
          type: "text",
          text: boundedText
        }
      ]
    };

    await hooks["chat.message"](
      { sessionID: "session_bounded_lit", messageID: "msg_bounded_lit", agent: "lit-loop" },
      output
    );

    assert.equal(output.parts.length, 2);
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-task");
    assert.match(output.parts[1].text, /<lit-task-mode>/);
    assert.match(output.parts[1].text, /Read the relevant files and current state first/);
    assert.match(output.parts[1].text, /Do not load skill documentation before inspecting the task and repository/);
    assert.match(output.parts[1].text, /Verify with the relevant test or check before reporting/);
    assert.match(output.parts[1].text, /compare the result with ordinary use/iu);
    assert.match(output.parts[1].text, /natural attribution or footnotes/iu);
    assert.doesNotMatch(output.parts[1].text, /\.litopencode\/litgoal\/lit-loop|append-only ledger|subagents/i);
    await assert.rejects(
      fs.access(path.join(dir, ".litopencode", "litgoal", "lit-loop", "ledger.jsonl")),
      (error) => error.code === "ENOENT",
      "a bounded activation must not create a durable work ledger"
    );
  });
});

test("injects planning-only lit-plan prompt when bare lit is typed in lit-plan mode", async () => {
  await withTempDir(async (dir) => {
    const litPlanSkill = await skillBody("lit-plan");
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = {
      message: {
        id: "msg_lit_plan",
        sessionID: "session-lit-plan",
        role: "user"
      },
      parts: [
        {
          id: "part-user-plan",
          sessionID: "session-lit-plan",
          messageID: "msg_lit_plan",
          type: "text",
          text: "please plan this lit"
        }
      ]
    };

    await hooks["chat.message"]({ sessionID: "session-lit-plan", messageID: "msg_lit_plan", agent: "lit-plan" }, output);

    assert.equal(output.parts.length, 2);
    assert.match(output.parts[1].text, /^🔥 LIT IGNITED · lit-plan 🔥/u);
    assert.match(output.parts[1].text, /<lit-plan-mode>/);
    assert.doesNotMatch(output.parts[1].text, /<lit-loop-mode>/);
    assert.match(output.parts[1].text, /must not implement/i);
    assert.match(output.parts[1].text, /explicit user confirmation/i);
    assert.match(output.parts[1].text, /start-work/);
    assert.match(output.parts[1].text, /review-work/);
    assert.doesNotMatch(output.parts[1].text, /write only the plan/i);
    assert.match(output.parts[1].text, /report the plan in chat/i);
    assert.match(output.parts[1].text, /explore-before-ask/i);
    assert.match(output.parts[1].text, /approval gate/i);
    assert.match(output.parts[1].text, /collect -> verify -> design -> adversarial -> synthesize/i);
    assert.match(output.parts[1].text, /dirty worktree/i);
    assert.match(output.parts[1].text, /stale state/i);
    assert.match(output.parts[1].text, /misleading success output/i);
    assert.match(output.parts[1].text, /prompt injection/i);
    assertNoHtmlCommentArtifact(output.parts[1].text, "lit-plan chat output");
    assert.ok(output.parts[1].text.includes(litPlanSkill), "lit-plan chat injection should include the full lit-plan skill body");
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-plan");
  });
});

test("routes natural lit keywords to the matching prompt injection", async () => {
  await withTempDir(async (dir) => {
    const startWorkSkill = await skillBody("start-work");
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = {
      message: {
        id: "msg_keyword_plan",
        sessionID: "session-keyword-plan",
        role: "user"
      },
      parts: [
        {
          id: "part-keyword-plan",
          sessionID: "session-keyword-plan",
          messageID: "msg_keyword_plan",
          type: "text",
          text: "lit plan this release"
        }
      ]
    };

    await hooks["chat.message"]({ sessionID: "session-keyword-plan", messageID: "msg_keyword_plan", agent: "lit-loop" }, output);

    assert.equal(output.parts.length, 2);
    assert.match(output.parts[1].text, /<lit-plan-mode>/);
    assert.doesNotMatch(output.parts[1].text, /<lit-loop-mode>/);
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-plan");
    assert.deepEqual(
      (await readLedgerEvents(dir)).map((event) => [event.type, event.mode]),
      [["prompt.activated", "lit-plan"]]
    );
  });
});

test("keeps trailing bare lit in research prose on the lit-loop prompt", async () => {
  assert.equal(detectChatActivationMode("Please make an in-depth research regarding this. Lit"), "lit-loop");

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
    const output = {
      message: {
        id: "msg_trailing_lit_research_prose",
        sessionID: "session-trailing-lit-research-prose",
        role: "user"
      },
      parts: [
        {
          id: "part-trailing-lit-research-prose",
          sessionID: "session-trailing-lit-research-prose",
          messageID: "msg_trailing_lit_research_prose",
          type: "text",
          text: "Please make an in-depth research regarding this. Lit"
        }
      ]
    };

    await hooks["chat.message"](
      {
        sessionID: "session-trailing-lit-research-prose",
        messageID: "msg_trailing_lit_research_prose",
        agent: "lit-loop"
      },
      output
    );

    assert.equal(output.parts.length, 2);
    assert.match(output.parts[1].text, /<lit-loop-mode>/);
    assert.match(output.parts[1].text, /# Enter lit-loop/);
    assert.doesNotMatch(output.parts[1].text, /Activate litresearch/);
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-loop");
  });
});

test("routes natural review and start-work keywords without pretending chat can switch agents", async () => {
  assert.equal(detectChatActivationMode("please lit review this package"), "review-work");
  assert.equal(detectChatActivationMode("lit start work on the approved plan"), "start-work");

  await withTempDir(async (dir) => {
    const startWorkSkill = await skillBody("start-work");
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = {
      message: {
        id: "msg_keyword_start",
        sessionID: "session-keyword-start",
        role: "user"
      },
      parts: [
        {
          id: "part-keyword-start",
          sessionID: "session-keyword-start",
          messageID: "msg_keyword_start",
          type: "text",
          text: "lit start work on the approved plan"
        }
      ]
    };

    await hooks["chat.message"]({ sessionID: "session-keyword-start", messageID: "msg_keyword_start", agent: "lit-loop" }, output);

    assert.equal(output.parts.length, 2);
    assert.match(output.parts[1].text, /^🔥 LIT IGNITED · start-work 🔥/u);
    assert.match(output.parts[1].text, /<start-work-mode>/);
    assert.match(output.parts[1].text, /BLOCKED:/);
    assert.match(output.parts[1].text, /run \/start-work/i);
    assert.match(output.parts[1].text, /lit-implement/i);
    assertNoHtmlCommentArtifact(output.parts[1].text, "start-work chat output");
    assert.ok(output.parts[1].text.includes(startWorkSkill), "start-work chat block should include the full start-work skill body");
    assert.equal(output.parts[1].metadata.litopencode.mode, "start-work");
  });
});

test("routes bare lit-crucible chat text to planning-only Lit Crucible", async () => {
  assert.equal(detectChatActivationMode("lit-crucible this release"), "lit-crucible");
  assert.equal(detectChatActivationMode("please lit-crucible this release"), "lit-crucible");
  assert.equal(detectChatActivationMode("lit lit-crucible this release"), "lit-crucible");
  assert.equal(detectChatActivationMode("/lit-crucible lit"), undefined);
  assert.equal(detectChatActivationMode("/lit-init lit"), undefined);
  assert.equal(detectChatActivationMode("`lit-crucible this`"), undefined);
  assert.equal(detectChatActivationMode("```\nlit-crucible this\n```"), undefined);
  assert.equal(detectChatActivationMode("lit-cruciblee geometry"), undefined);

  await withTempDir(async (dir) => {
    const litCrucibleSkill = await skillBody("lit-crucible");
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = {
      message: { id: "msg_lit-crucible", sessionID: "session-lit-crucible", role: "user" },
      parts: [
        {
          id: "part-lit-crucible",
          sessionID: "session-lit-crucible",
          messageID: "msg_lit-crucible",
          type: "text",
          text: "lit-crucible this release"
        }
      ]
    };

    await hooks["chat.message"]({ sessionID: "session-lit-crucible", messageID: "msg_lit-crucible", agent: "lit-loop" }, output);

    assert.equal(output.parts.length, 2);
    assert.match(output.parts[1].text, /^🔥 LIT IGNITED · lit-crucible 🔥/u);
    assert.match(output.parts[1].text, /<lit-crucible-mode>/);
    assert.match(output.parts[1].text, /planning-only/i);
    for (const anchor of litCrucibleDepthAnchors) {
      assert.ok(output.parts[1].text.includes(anchor), `lit-crucible chat injection should include ${anchor}`);
    }
    assertNoHtmlCommentArtifact(output.parts[1].text, "lit-crucible chat output");
    assert.ok(output.parts[1].text.includes(litCrucibleSkill), "lit-crucible chat injection should include the full lit-crucible skill body");
    assert.doesNotMatch(output.parts[1].text, /<lit-loop-mode>/);
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-crucible");
  });
});

test("routes bare static workflow skill names through chat activation", async () => {
  assert.equal(detectChatActivationMode("lit-init"), "lit-init");
  assert.equal(detectChatActivationMode("please lit-init this repo"), "lit-init");
  assert.equal(detectChatActivationMode("litresearch this package"), "lit-research");
  assert.equal(detectChatActivationMode("lit-research this package"), "lit-research");
  assert.equal(detectChatActivationMode("start-work"), "start-work");
  assert.equal(detectChatActivationMode("please start-work the approved plan"), undefined);
  assert.equal(detectChatActivationMode("review-work"), "review-work");
  assert.equal(detectChatActivationMode("please review-work this package"), "review-work");
  assert.equal(detectChatActivationMode("litgoal"), "lit-goal");
  assert.equal(detectChatActivationMode("lit-goal"), "lit-goal");
  assert.equal(detectChatActivationMode("start-workflow notes"), undefined);
  assert.equal(detectChatActivationMode("initialization deep dive"), undefined);

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
    const initDeepSkill = await skillBody("lit-init");
    const litResearchSkill = await skillBody("litresearch");
    const startWorkSkill = await skillBody("start-work");
    const reviewWorkSkill = await skillBody("review-work");
    const litGoalSkill = await skillBody("durable-litgoal");
    const visualQaSkill = await skillBody("visual-qa");
    const cases = [
      ["lit-init", "lit-init", initDeepSkill],
      ["litresearch this package", "lit-research", litResearchSkill],
      ["start-work", "start-work", startWorkSkill],
      ["review-work", "review-work", reviewWorkSkill],
      ["litgoal", "lit-goal", litGoalSkill],
      ["lit-goal", "lit-goal", litGoalSkill],
      ["visual-qa inspect the rendered page", "visual-qa", visualQaSkill]
    ];

    for (const [text, mode, expected] of cases) {
      const output = {
        message: { id: `msg_${mode}`, sessionID: `session_${mode}`, role: "user" },
        parts: [
          {
            id: `part_${mode}`,
            sessionID: `session_${mode}`,
            messageID: `msg_${mode}`,
            type: "text",
            text
          }
        ]
      };

      await hooks["chat.message"]({ sessionID: `session_${mode}`, messageID: `msg_${mode}`, agent: "lit-loop" }, output);

      assert.equal(output.parts.length, 2);
      assert.equal(output.parts[1].metadata.litopencode.mode, mode);
      assertNoHtmlCommentArtifact(output.parts[1].text, `${text} chat output`);
      assert.ok(output.parts[1].text.includes(expected), `${text} should include its full skill body`);
      if (mode === "start-work") assert.match(output.parts[1].text, /run \/start-work/i);
      if (mode === "visual-qa") {
        assert.match(output.parts[1].text, /litfamily\.evidence-manifest\/v1beta1/u);
        assert.match(output.parts[1].text, /alpha.*cannot PASS/is);
      }
    }
  });
});

test("LitResearch chat activation ignores quoted, copied, and explanatory mentions", () => {
  // Given: inert mentions plus the supported bare and natural invocation forms.
  const inertMentions = [
    "> litresearch",
    "> lit research",
    '"litresearch"',
    '"lit research"',
    "'lit-research'",
    "'lit research'",
    "“lit research”",
    "‘litresearch’",
    'A quoted example says "lit research papers".',
    "A quoted example says 'lit research papers'.",
    "설명에는 “lit research papers”라는 문구가 있다.",
    "A copied example follows:\n> lit research papers",
    "`litresearch`",
    "```\nlitresearch\n```",
    "I wrote the word litresearch in this explanation",
    "litresearcher",
    "prelitresearch"
  ];

  // When: chat routing classifies each message.
  const inertModes = inertMentions.map((message) => detectChatActivationMode(message));

  // Then: inert mentions stay inactive while explicit routes still select LitResearch.
  assert.deepEqual(inertModes, inertMentions.map(() => undefined));
  assert.equal(detectChatActivationMode("litresearch"), "lit-research");
  assert.equal(detectChatActivationMode("lit-research this package"), "lit-research");
  assert.equal(detectChatActivationMode("lit research hydrate papers"), "lit-research");
  assert.equal(detectChatActivationMode("/litresearch"), undefined);
});

test("natural keyword hook ignores slash commands and code-only mentions", async () => {
  assert.equal(detectChatActivationMode("/start-work please"), undefined);
  assert.equal(detectChatActivationMode("/start-work please lit"), undefined);
  assert.equal(detectChatActivationMode("/review-work lit"), undefined);
  assert.equal(detectChatActivationMode("/lit-crucible lit"), undefined);
  assert.equal(detectChatActivationMode("/lit-init lit"), undefined);
  assert.equal(detectChatActivationMode("please use /lit plan"), undefined);
  assert.equal(detectChatActivationMode("/help then lit"), "lit-task");
  assert.equal(detectChatActivationMode("lit /tmp/foo"), "lit-task");
  assert.equal(detectChatActivationMode("lit /literal"), "lit-task");
  assert.equal(detectChatActivationMode("lit /litmus"), "lit-task");
  assert.equal(detectChatActivationMode("`lit plan`"), undefined);
  assert.equal(detectChatActivationMode("```\nlit review\n```"), undefined);
  assert.equal(detectChatActivationMode("split planning text"), undefined);
  assert.equal(detectChatActivationMode("lit research hydrate papers"), "lit-research");
  assert.equal(detectChatActivationMode("lit goal define acceptance"), "lit-goal");
});

test("chat activation appends prompt even when durable ledger init fails", async () => {
  await withTempDir(async (dir) => {
    const fileRoot = path.join(dir, "not-a-directory");
    await fs.writeFile(fileRoot, "file blocks ledger directory creation");
    const hook = createChatMessageActivationHook(fileRoot);
    const output = {
      message: { id: "msg_ledger_failure", sessionID: "session-ledger-failure", role: "user" },
      parts: [
        {
          id: "part-ledger-failure",
          sessionID: "session-ledger-failure",
          messageID: "msg_ledger_failure",
          type: "text",
          text: "Handle this long-running task across turns and keep a durable ledger. lit"
        }
      ]
    };

    await hook({ sessionID: "session-ledger-failure", messageID: "msg_ledger_failure", agent: "lit-loop" }, output);

    assert.equal(output.parts.length, 2);
    assert.match(output.parts[1].text, /<lit-loop-mode>/);
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-loop");
  });
});

test("chat activation falls back to output message agent when input agent is absent", async () => {
  await withTempDir(async (dir) => {
    const hook = createChatMessageActivationHook(dir);
    const output = {
      message: { id: "msg_output_agent", sessionID: "session-output-agent", role: "user", agent: "lit-plan" },
      parts: [
        {
          id: "part-output-agent",
          sessionID: "session-output-agent",
          messageID: "msg_output_agent",
          type: "text",
          text: "lit"
        }
      ]
    };

    await hook({ sessionID: "session-output-agent", messageID: "msg_output_agent" }, output);

    assert.equal(output.parts.length, 2);
    assert.match(output.parts[1].text, /<lit-plan-mode>/);
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-plan");
  });
});

test("/lit-plan command activates planning-only handoff instead of lit-loop execution", async () => {
  await withTempDir(async (dir) => {
    const litPlanSkill = await skillBody("lit-plan");
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

    await hooks["command.execute.before"]({ command: "/lit-plan", sessionID: "session-command", arguments: "" }, output);

    assert.equal(output.parts.length, 1);
    assert.match(output.parts[0].text, /<lit-plan-mode>/);
    assert.doesNotMatch(output.parts[0].text, /<lit-loop-mode>/);
    assert.match(output.parts[0].text, /must not implement/i);
    assert.match(output.parts[0].text, /explicit user confirmation/i);
    assert.match(output.parts[0].text, /start-work/);
    assert.match(output.parts[0].text, /review-work/);
    assert.doesNotMatch(output.parts[0].text, /write only the plan/i);
    assert.match(output.parts[0].text, /report the plan in chat/i);
    assert.match(output.parts[0].text, /explore-before-ask/i);
    assert.match(output.parts[0].text, /approval gate/i);
    assert.match(output.parts[0].text, /collect -> verify -> design -> adversarial -> synthesize/i);
    assert.match(output.parts[0].text, /dirty worktree/i);
    assert.match(output.parts[0].text, /stale state/i);
    assert.match(output.parts[0].text, /misleading success output/i);
    assert.match(output.parts[0].text, /prompt injection/i);
    assertNoHtmlCommentArtifact(output.parts[0].text, "/lit-plan command output");
    assert.ok(output.parts[0].text.includes(litPlanSkill), "/lit-plan command should include the full lit-plan skill body");
    assert.equal(output.parts[0].metadata.litopencode.mode, "lit-plan");
  });
});

test("/start-work and /review-work expose reference-grade execution and review contracts", async () => {
  await withTempDir(async (dir) => {
    const startWorkSkill = await skillBody("start-work");
    const reviewWorkSkill = await skillBody("review-work");
    const hooks = await pluginModule.server({ directory: dir, worktree: dir, project: {}, client: rootSessionClient(), experimental_workspace: { register() {} }, serverUrl: new URL("http://localhost:4096"), $: {} });
    const output = { parts: [] };

    await hooks["command.execute.before"]({ command: "/start-work", sessionID: "session-command", arguments: "" }, output);
    await hooks["command.execute.before"]({ command: "/review-work", sessionID: "session-command", arguments: "" }, output);

    assert.match(output.parts[0].text, /<start-work-mode>/);
    assert.equal(output.parts[0].text.startsWith(`🔥 LIT IGNITED · start-work 🔥\n<start-work-mode>`), true);
    assert.match(output.parts[0].text, /execution-only/i);
    assert.match(output.parts[0].text, /approved plan/i);
    assert.doesNotMatch(output.parts[0].text, /current durable goal/i);
    assert.match(output.parts[0].text, /do not redesign/i);
    assert.match(output.parts[0].text, /BLOCKED/i);
    assert.equal(output.parts[0].metadata.litopencode.mode, "start-work");
    assert.match(output.parts[0].text, /maximum safe subagent delegation/i);
    assert.match(output.parts[0].text, /DoneClaim/i);
    assert.match(output.parts[0].text, /independent verifier/i);
    assert.match(output.parts[0].text, /FullyDone/i);
    assert.match(output.parts[0].text, /cleanup receipt/i);
    assert.match(output.parts[0].text, /adversarial QA/i);
    assertNoHtmlCommentArtifact(output.parts[0].text, "/start-work command output");
    assert.ok(output.parts[0].text.includes(startWorkSkill), "/start-work command should include the full start-work skill body");
    assert.match(output.parts[1].text, /five-lane/i);
    assert.match(output.parts[1].text, /scope\/diff/i);
    assert.match(output.parts[1].text, /tests\/evidence/i);
    assert.match(output.parts[1].text, /package\/payload/i);
    assert.match(output.parts[1].text, /security\/provenance/i);
    assert.match(output.parts[1].text, /real-surface\/docs/i);
    assert.match(output.parts[1].text, /cleanup receipts/i);
    assert.match(output.parts[1].text, /all lanes/i);
    assertNoHtmlCommentArtifact(output.parts[1].text, "/review-work command output");
    assert.ok(output.parts[1].text.includes(reviewWorkSkill), "/review-work command should include the full review-work skill body");
  });
});

test("start-work tool returns execution-only approved-plan contract", async () => {
  await withTempDir(async (dir) => {
    const result = await litOpenCodeTools["start-work"].execute({ action: "start" }, createToolContext(dir));

    assert.match(result.output, /<start-work-mode>/);
    assert.match(result.output, /execution-only/i);
    assert.match(result.output, /approved plan/i);
    assert.doesNotMatch(result.output, /current durable goal/i);
    assert.match(result.output, /do not redesign/i);
    assert.match(result.output, /BLOCKED/i);
    assert.equal(result.metadata.command, "start-work");
  });
});

test("does not activate bare lit for substrings or compound tokens", async () => {
  await withTempDir(async (dir) => {
    // Given: the OpenCode chat.message hook and non-triggering words.
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const blockedTexts = ["split", "literal", "litmus", "lithium", "glitter", "lit-review", "lit_loop"];

    for (const [index, text] of blockedTexts.entries()) {
      const output = {
        message: {
          id: `message-no-${index}`,
          sessionID: "session-no",
          role: "user"
        },
        parts: [
          {
            id: `part-no-${index}`,
            sessionID: "session-no",
            messageID: `message-no-${index}`,
            type: "text",
            text
          }
        ]
      };

      // When: OpenCode delivers text that should not ignite LitOpenCode.
      await hooks["chat.message"]({ sessionID: "session-no", messageID: `message-no-${index}` }, output);

      // Then: no synthetic lit-loop directive is appended.
      assert.equal(output.parts.length, 1, text);
    }
    assert.deepEqual(await readLedgerEvents(dir), []);
  });
});

test("redacts command arguments before durable ledger persistence", async () => {
  await withTempDir(async (dir) => {
    // Given: a plugin server and command input containing token-shaped user text.
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const fakeSecret = "token=fake-litwork-secret";
    const output = { parts: [] };

    // When: /litwork is activated with secret-bearing arguments.
    await hooks["command.execute.before"]({ command: "/litwork", sessionID: "session-command", arguments: fakeSecret }, output);

    // Then: the durable ledger records only bounded metadata, never the raw argument text.
    const rawLedger = await fs.readFile(path.join(dir, ".litopencode", "litgoal", "lit-loop", "ledger.jsonl"), "utf8");
    assert.doesNotMatch(rawLedger, /fake-litwork-secret/);
    assert.doesNotMatch(rawLedger, /token=/);
    const [event] = await readLedgerEvents(dir);
    assert.deepEqual(event.arguments, { present: true, redacted: true, length: fakeSecret.length });
  });
});

test("drives lit and litwork tools through durable ledger operations", async () => {
  await withTempDir(async (dir) => {
    // Given: OpenCode-style tool context for the current worktree.
    const context = createToolContext(dir);

    // When: workflow tools are executed through their real handlers.
    const litResult = await litOpenCodeTools.lit.execute({ action: "activate" }, context);
    const litworkResult = await litOpenCodeTools.litwork.execute({ action: "start" }, context);
    const startWorkResult = await litOpenCodeTools["start-work"].execute({ action: "start" }, context);
    const reviewWorkResult = await litOpenCodeTools["review-work"].execute({ action: "review" }, context);
    const status = await litOpenCodeTools.litwork.execute({ action: "status" }, context);

    // Then: results show activation text and ledger-backed status.
    for (const [result, discipline] of [[reviewWorkResult, "review-work"], [litResult, "lit-loop"], [litworkResult, "lit-loop"], [startWorkResult, "start-work"]]) {
      assert.equal(result.output.split("\n")[0], `🔥 LIT IGNITED · ${activationDiscipline(discipline)} 🔥`);
      assert.match(result.output, /Your first reply line MUST be exactly:/u);
      assert.match(result.output, new RegExp(`🔥 \\*\\*LIT IGNITED · ${activationDiscipline(discipline)}\\*\\* 🔥`, "u"));
      assert.match(result.output, /Emit it once/u);
    }
    assert.match(litResult.output, /Ledger initialized/);
    assert.match(litworkResult.output, /Work loop start recorded/);
    assert.match(startWorkResult.output, /start-work/);
    assert.match(reviewWorkResult.output, /review-work/);
    assert.match(reviewWorkResult.output, /draft plan/i);
    assert.match(reviewWorkResult.output, /PASS, ITERATE, or NEEDS-CONTEXT/i);
    assert.match(reviewWorkResult.output, /five-lane/i);
    assert.match(status.output, /tool\.lit\.activated/);
    assert.match(status.output, /tool\.litwork\.started/);
    assert.match(status.output, /tool\.start-work\.started/);
    assert.match(status.output, /tool\.review-work\.started/);
    assert.deepEqual(
      (await readLedgerEvents(dir)).map((event) => event.type),
      ["tool.lit.activated", "tool.litwork.started", "tool.start-work.started", "tool.review-work.started"]
    );
  });
});

test("blocks in-place start-work tool execution from lit-plan so /start-work can switch to lit-implement", async () => {
  await withTempDir(async (dir) => {
    // Given: a lit-plan agent context, where tool execution would not switch OpenCode agents.
    const context = {
      ...createToolContext(dir),
      agent: "lit-plan"
    };

    // When: lit-plan attempts to execute the start-work tool directly.
    const result = await litOpenCodeTools["start-work"].execute({ action: "start" }, context);

    // Then: it gets a hard blocker instead of an execution prompt it might continue in planning mode.
    assert.match(result.output, /^BLOCKED:/);
    assert.match(result.output, /run \/start-work/i);
    assert.match(result.output, /lit-implement/i);
    assert.doesNotMatch(result.output, /<start-work-mode>/);
    assert.deepEqual(
      (await readLedgerEvents(dir)).map((event) => event.type),
      ["tool.start-work.blocked_lit_plan"]
    );
  });
});

test("drives lit tool with root worktree through the directory ledger", async () => {
  await withTempDir(async (dir) => {
    // Given: OpenCode can provide / as the worktree for global config sessions.
    const context = {
      ...createToolContext(dir),
      agent: undefined,
      worktree: "/"
    };

    // When: the lit tool is executed through its real handler.
    const result = await litOpenCodeTools.lit.execute({ action: "activate" }, context);

    // Then: the ledger is written under the OpenCode directory, not the filesystem root.
    assert.match(result.output, /Ledger initialized/);
    const events = await readLedgerEvents(dir);
    assert.deepEqual(
      events.map((event) => event.type),
      ["tool.lit.activated"]
    );
    assert.equal("agent" in events[0], false);
  });
});
