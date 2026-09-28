import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { managedSkillDiscoveryDescription } from "../src/cli/managed-skill-assets.ts";
import {
  defaultAgentIds,
  litOpenCodeAgents,
  litOpenCodeSpecialistAgents,
  recommendedAgentIds,
  registerLitOpenCodeAgents
} from "../src/agents.ts";
import { litTool, litworkTool, reviewWorkTool, startWorkTool } from "../src/tools.ts";
import { defaultGlobalConfigFile, mergeConfigs } from "../src/config.ts";
import { diagnoseModelRoutes } from "../src/model-route-policy.ts";

const guardedTokens = [
  ["o", "mo"].join(""),
  ["lazy", "codex"].join(""),
  ["oh-my-open", "agent"].join(""),
  ["oh-my-open", "code"].join(""),
  ["sisyphus", "labs"].join(""),
  ["lazy", "claude"].join(""),
  ["code-yeong", "yu"].join(""),
  ["u", "lw"].join(""),
  ["ultra", "work"].join(""),
  ["ultra", "goal"].join("")
];
const guardedPattern = new RegExp(guardedTokens.map((token) => "\\b" + token + "\\b").join("|"), "i");

function flattenText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}

function promptLines(prompt) {
  return prompt.split("\n").map((line) => line.trim()).filter(Boolean);
}

function assertPromptContainsAll(prompt, snippets, label) {
  for (const snippet of snippets) {
    assert.match(prompt, new RegExp(snippet, "i"), `${label} should mention ${snippet}`);
  }
}

test("LitOpenCode exposes plan, implement, and loop primary default agents plus recommended role aliases", () => {
  assert.deepEqual(defaultAgentIds, ["lit-loop", "lit-plan", "lit-implement"]);
  assert.deepEqual(recommendedAgentIds, [
    "lit-loop",
    "lit-plan",
    "lit-implement",
    "lit-architect",
    "lit-forge",
    "lit-oracle",
    "lit-prover",
    "lit-sentinel",
    "lit-librarian"
  ]);

  const defaults = litOpenCodeAgents.filter((agent) => agent.defaultRole);
  assert.deepEqual(
    defaults.map((agent) => agent.id),
    defaultAgentIds
  );
  for (const agent of defaults) {
    assert.equal(agent.recommended, true, `${agent.id} should be recommended`);
    assert.match(agent.summary, /recommended/i, `${agent.id} should document the recommendation`);
    assert.equal(agent.mode, "primary", `${agent.id} should be a primary OpenCode agent`);
  }

  const recommendedRoles = litOpenCodeAgents.filter((agent) => agent.tier === "role");
  assert.deepEqual(
    recommendedRoles.map((agent) => agent.id),
    ["lit-architect", "lit-forge", "lit-oracle", "lit-prover", "lit-sentinel", "lit-librarian"]
  );
  assert.equal(recommendedRoles.every((agent) => agent.recommended), true);
  assert.equal(recommendedRoles.every((agent) => agent.mode === "subagent"), true);
});

test("LitOpenCode includes every upstream specialist as a brand-clean adapted entry", () => {
  assert.deepEqual(
    litOpenCodeSpecialistAgents.filter((agent) => agent.tier === "specialist").map((agent) => agent.id),
    [
      "lit-explorer",
      "lit-archive-researcher",
      "lit-verdict-oracle",
      "lit-strategy-planner",
      "lit-forge-worker",
      "lit-systems-architect",
      "lit-critical-reviewer",
      "lit-context-cartographer",
      "lit-persistence-runner"
    ]
  );
  assert.equal(litOpenCodeSpecialistAgents.filter((agent) => agent.tier === "specialist").every((agent) => !agent.recommended), true);
});

test("agent ids are unique and every registry entry is safe structured data", () => {
  const ids = litOpenCodeAgents.map((agent) => agent.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const agent of litOpenCodeAgents) {
    assert.equal(typeof agent.id, "string");
    assert.equal(typeof agent.name, "string");
    assert.equal(typeof agent.summary, "string");
    assert.equal(Array.isArray(agent.tools), true);
    assert.equal(Object.isFrozen(agent.tools), true);
    assert.ok(promptLines(agent.prompt).length >= 5, `${agent.id} should expose a deep static prompt`);
    assert.ok(agent.prompt.length >= 320, `${agent.id} prompt should carry role, evidence, and stop guidance`);
    assert.equal(guardedPattern.test(flattenText(agent)), false, `${agent.id} should be brand-clean`);
  }
});

test("agent registry can be merged into an OpenCode config object", () => {
  const config = {
    agent: {
      existing: {
        description: "keep me"
      }
    }
  };

  registerLitOpenCodeAgents(config);

  assert.equal(config.agent.existing.description, "keep me");
  assert.equal(config.default_agent, "lit-loop");
  assert.equal(config.agent.build.hidden, true);
  assert.equal(config.agent.plan.hidden, true);
  assert.equal(config.agent["lit-plan"].description.includes("LitOpenCode"), true);
  assert.equal(config.agent["lit-plan"].color, "#FACC15");
  assert.equal(config.agent["lit-plan"].permission.edit, "deny");
  assert.equal(config.agent["lit-plan"].permission.bash, "deny");
  assert.equal(config.agent["lit-plan"].permission.task, "deny");
  assert.equal(config.agent["lit-plan"].tools.task, false);
  assert.match(config.agent["lit-plan"].prompt, /must not implement/i);
  assert.match(config.agent["lit-plan"].prompt, /explicit user confirmation/i);
  assert.match(config.agent["lit-plan"].prompt, /start-work/);
  assert.match(config.agent["lit-plan"].prompt, /lit-implement/);
  assert.match(config.agent["lit-plan"].prompt, /do not call the start-work tool from lit-plan/i);
  assert.match(config.agent["lit-plan"].prompt, /run \/start-work/i);
  assert.match(config.agent["lit-plan"].prompt, /review-work/);
  assert.equal(config.agent["lit-implement"].mode, "all");
  assert.equal(config.agent["lit-implement"].color, "#FB923C");
  assert.match(config.agent["lit-implement"].prompt, /approved plan/i);
  assert.match(config.agent["lit-implement"].prompt, /do not redesign/i);
  assert.match(config.agent["lit-implement"].prompt, /review-work/i);
  assert.equal(config.agent["lit-loop"].mode, "all");
  assert.equal(config.agent["lit-loop"].color, "#FF5A1F");
  assert.match(config.agent["lit-loop"].prompt, /subagents/i);
  assert.match(config.agent["lit-loop"].prompt, /exist at all/i);
  assert.match(config.agent["lit-plan"].prompt, /exist at all/i);
  assert.match(config.agent["lit-implement"].prompt, /exist at all/i);
  assert.match(config.agent["lit-critical-reviewer"].prompt, /need to exist|already cover/i);
  assert.equal(config.agent["lit-architect"].mode, "subagent");
  assert.equal("hidden" in config.agent["lit-architect"], false);
  assert.equal(config.agent["lit-forge-worker"].mode, "subagent");
  assert.equal("hidden" in config.agent["lit-forge-worker"], false);
  assert.equal(guardedPattern.test(flattenText(config.agent)), false);
});

test("bounded lit mode overrides durable loop defaults and tool guidance", () => {
  const loop = litOpenCodeAgents.find((agent) => agent.id === "lit-loop");
  assert.ok(loop);
  assert.match(loop.prompt, /plugin-injected <lit-task-mode>/i);
  assert.match(loop.prompt, /Do not call the task, lit, litwork, start-work, or review-work tools/i);
  assert.match(loop.prompt, /Do not preload the workflow skills or agent roster/i);
  assert.match(loop.prompt, /Do not load skill documentation before inspecting the task and repository/i);
  assert.match(loop.prompt, /only for a task that inherently spans multiple turns|when the user explicitly asks/i);

  assert.match(litTool.description, /bare lit activation is automatic/i);
  assert.match(litworkTool.description, /only when the user asks for persistent tracking/i);
  assert.match(startWorkTool.description, /only through explicit/i);
  assert.match(reviewWorkTool.description, /only when the user explicitly requests/i);
});

test("agent registry ships the Astra lead/review routes and ordinary Luna helper routes", () => {
  const config = {};
  const defaults = defaultGlobalConfigFile();

  registerLitOpenCodeAgents(config);

  for (const agent of litOpenCodeAgents) {
    const category = agent.id === "lit-loop" ? "planning" : defaults.agents[agent.id].category;
    const expected = category === "planning" || category === "review"
      ? { model: "openai/gpt-6-astra", variant: "xhigh" }
      : { model: "openai/gpt-6-luna", variant: "max" };
    assert.equal(config.agent[agent.id].model, expected.model, `${agent.id} should use its shipped model default`);
    assert.equal(config.agent[agent.id].variant, expected.variant, `${agent.id} should use its shipped effort default`);
    if (expected.model === "openai/gpt-6-astra") assert.equal(config.agent[agent.id].reasoningEffort, "xhigh");
  }
});

test("agent registry applies LitOpenCode model routing overrides", () => {
  const config = {};
  const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
    categories: {
      execution: {
        provider: "openai",
        model: "gpt-lit-loop",
        reasoningEffort: "high",
        textVerbosity: "medium"
      }
    },
    agents: {
      "lit-loop": {
        temperature: 0.2,
        maxTokens: 4096,
        promptAppend: "Use the local litopencode.json routing policy.",
        tools: { bash: false },
        permission: { bash: "ask" }
      }
    }
  });

  registerLitOpenCodeAgents(config, litConfig);

  assert.equal(config.agent["lit-loop"].model, "openai/gpt-lit-loop");
  assert.equal("provider" in config.agent["lit-loop"], false);
  assert.equal(config.agent["lit-loop"].reasoningEffort, "high");
  assert.equal(config.agent["lit-loop"].textVerbosity, "medium");
  assert.equal(config.agent["lit-loop"].temperature, 0.2);
  assert.equal(config.agent["lit-loop"].maxTokens, 4096);
  assert.equal(config.agent["lit-loop"].tools.bash, false);
  assert.equal(config.agent["lit-loop"].permission.bash, "ask");
  assert.match(config.agent["lit-loop"].prompt, /local litopencode\.json routing policy/);
});

test("agent registry rejects Luna below high without silent fallback", () => {
  // Given: explicit unsafe agent routes that ordinary config loading must not rewrite.
  const unsafeRoutes = [
    { model: "gpt-5.6-luna", variant: "medium" },
    { model: "gpt-5.6-luna", variant: "high", reasoningEffort: "low" },
    { model: "gpt-5.6-luna", variant: "low", reasoningEffort: "high" },
    { model: "gpt-5.6-luna", variant: "high", reasoningEffort: "xhigh" }
  ];

  for (const route of unsafeRoutes) {
    const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
      agents: { "lit-loop": { provider: "openai", ...route } }
    });

    // When/Then: registration fails with the unsafe model named instead of substituting a default.
    assert.throws(
      () => registerLitOpenCodeAgents({}, litConfig),
      /unsafe.*lit-loop.*Luna/i
    );
  }
});

test("Luna diagnostics inspect both explicit effort fields and reject conflicts", () => {
  const diagnostics = diagnoseModelRoutes({
    "low-variant": {
      provider: "openai",
      model: "gpt-5.6-luna",
      variant: "low",
      reasoningEffort: "high"
    },
    "low-reasoning": {
      provider: "openai",
      model: "gpt-5.6-luna",
      variant: "high",
      reasoningEffort: "low"
    },
    "safe-conflict": {
      provider: "openai",
      model: "gpt-5.6-luna",
      variant: "high",
      reasoningEffort: "xhigh"
    },
    "valid-high": { provider: "openai", model: "gpt-5.6-luna", variant: "high" },
    "valid-xhigh": { provider: "openai", model: "gpt-5.6-luna", reasoningEffort: "xhigh" }
  });

  assert.deepEqual(diagnostics, [
    {
      agentId: "low-variant",
      code: "luna_effort_below_high",
      model: "openai/gpt-5.6-luna",
      effort: "variant=low, reasoningEffort=high"
    },
    {
      agentId: "low-variant",
      code: "luna_effort_conflict",
      model: "openai/gpt-5.6-luna",
      effort: "variant=low, reasoningEffort=high"
    },
    {
      agentId: "low-reasoning",
      code: "luna_effort_below_high",
      model: "openai/gpt-5.6-luna",
      effort: "variant=high, reasoningEffort=low"
    },
    {
      agentId: "low-reasoning",
      code: "luna_effort_conflict",
      model: "openai/gpt-5.6-luna",
      effort: "variant=high, reasoningEffort=low"
    },
    {
      agentId: "safe-conflict",
      code: "luna_xhigh_forbidden",
      model: "openai/gpt-5.6-luna",
      effort: "variant=high, reasoningEffort=xhigh"
    },
    {
      agentId: "safe-conflict",
      code: "luna_effort_conflict",
      model: "openai/gpt-5.6-luna",
      effort: "variant=high, reasoningEffort=xhigh"
    },
    {
      agentId: "valid-xhigh",
      code: "luna_xhigh_forbidden",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh"
    }
  ]);
});

test("lit-plan route overrides cannot weaken planning-only edit and bash guards", () => {
  const config = {};
  const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
    agents: {
      "lit-plan": {
        tools: { edit: true, bash: true },
        permission: { edit: "allow", bash: "allow" }
      }
    }
  });

  registerLitOpenCodeAgents(config, litConfig);

  assert.equal(config.agent["lit-plan"].permission.edit, "deny");
  assert.equal(config.agent["lit-plan"].permission.bash, "deny");
  assert.equal(config.agent["lit-plan"].tools.write, false);
  assert.equal(config.agent["lit-plan"].tools.edit, false);
  assert.equal(config.agent["lit-plan"].tools.bash, false);
  assert.equal(config.agent["lit-plan"].tools.task, false);
  assert.equal(config.agent["lit-plan"].permission.task, "deny");
});

test("YOLO permission mode allows execution surfaces while preserving lit-plan deny guards", () => {
  const config = {
    permission: {
      bash: "ask"
    }
  };
  const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
    permissionMode: "yolo"
  });

  registerLitOpenCodeAgents(config, litConfig);

  assert.deepEqual(config.permission, {
    bash: "allow",
    edit: "allow",
    webfetch: "allow",
    external_directory: "allow"
  });
  assert.equal("task" in config.permission, false);
  assert.equal(config.agent["lit-loop"].permission.task, "allow");
  assert.equal(config.agent["lit-implement"].permission.task, "allow");
  assert.equal(config.agent["lit-loop"].permission.bash, "allow");
  assert.equal(config.agent["lit-loop"].permission.edit, "allow");
  assert.equal(config.agent["lit-implement"].permission.bash, "allow");
  assert.equal(config.agent["lit-implement"].permission.edit, "allow");
  assert.equal(config.agent["lit-plan"].permission.edit, "deny");
  assert.equal(config.agent["lit-plan"].permission.bash, "deny");
  assert.equal(config.agent["lit-plan"].tools.write, false);
  assert.equal(config.agent["lit-plan"].tools.edit, false);
  assert.equal(config.agent["lit-plan"].tools.bash, false);
  assert.equal(config.agent["lit-plan"].tools.task, false);
  assert.equal(config.agent["lit-plan"].permission.task, "deny");
});

test("balanced permission mode allows automation while asking for dangerous bash patterns", () => {
  const config = {
    permission: {
      bash: "ask",
      read: "ask"
    }
  };
  const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
    permissionMode: "balanced"
  });

  registerLitOpenCodeAgents(config, litConfig);

  assert.deepEqual(config.permission.bash, {
    "*": "allow",
    "rm -rf": "ask",
    "rm -rf *": "ask",
    "rm -fr": "ask",
    "rm -fr *": "ask",
    "sudo *": "ask",
    "chmod -R *": "ask",
    "chown -R *": "ask",
    "dd *": "ask",
    "mkfs *": "ask"
  });
  assert.equal(config.permission.edit, "allow");
  assert.equal("task" in config.permission, false);
  assert.equal(config.permission.webfetch, "allow");
  assert.equal(config.permission.read, "ask");
  assert.equal(config.agent["lit-loop"].permission.task, "allow");
  assert.equal(config.agent["lit-loop"].permission.bash, "allow");
  assert.equal(config.agent["lit-implement"].permission.bash, "allow");
  assert.equal(config.agent["lit-plan"].permission.edit, "deny");
  assert.equal(config.agent["lit-plan"].permission.bash, "deny");
  assert.equal(config.agent["lit-plan"].permission.task, "deny");
  assert.equal(config.agent["lit-plan"].tools.task, false);
});

test("balanced permission mode preserves existing bash safety rules", () => {
  const config = {
    permission: {
      bash: {
        "*": "ask",
        [["git", "push *"].join(" ")]: "ask"
      }
    }
  };
  const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
    permissionMode: "balanced"
  });

  registerLitOpenCodeAgents(config, litConfig);

  assert.equal(config.permission.bash["*"], "ask");
  assert.equal(config.permission.bash[["git", "push *"].join(" ")], "ask");
  assert.equal(config.permission.bash["rm -rf *"], "ask");
  assert.equal(config.permission.edit, "allow");
  assert.equal(config.agent["lit-plan"].permission.bash, "deny");
});

test("balanced permission mode never downgrades existing dangerous bash deny rules", () => {
  const config = {
    permission: {
      bash: {
        "rm -rf *": "deny",
        "sudo *": "deny"
      }
    }
  };
  const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
    permissionMode: "balanced"
  });

  registerLitOpenCodeAgents(config, litConfig);

  assert.equal(config.permission.bash["rm -rf *"], "deny");
  assert.equal(config.permission.bash["sudo *"], "deny");
  assert.equal(config.permission.bash["rm -fr *"], "ask");
  assert.equal(config.permission.edit, "allow");
  assert.equal(config.agent["lit-plan"].permission.bash, "deny");
});

test("YOLO permission mode preserves an explicit top-level task policy behind the runtime guard", () => {
  const config = {
    permission: "ask"
  };
  const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
    permissionMode: "yolo"
  });

  registerLitOpenCodeAgents(config, litConfig);

  assert.equal(config.permission.bash, "allow");
  assert.equal(config.permission.edit, "allow");
  assert.equal(config.permission.task, "ask");
  assert.equal(config.permission.webfetch, "allow");
  assert.equal(config.permission.read, "ask");
  assert.equal(config.permission.external_directory, "allow");
  assert.equal(config.permission.skill, "ask");
  assert.equal(config.agent["lit-plan"].permission.edit, "deny");
  assert.equal(config.agent["lit-plan"].permission.bash, "deny");
});

test("LitOpenCode agents encode reference-grade OpenCode-native workflow contracts", () => {
  const byId = new Map(litOpenCodeAgents.map((agent) => [agent.id, agent]));

  assertPromptContainsAll(byId.get("lit-plan").prompt, [
    "explore-before-ask",
    "approval gate",
    "one bounded objective",
    "explicit non-goals",
    "action, output, and verification",
    "dependencies and order",
    "DoneClaim",
    "proportionate",
    "lit-implement",
    "collect",
    "verify",
    "design",
    "adversarial",
    "synthesize",
    "dirty worktree",
    "stale state",
    "misleading success output",
    "prompt injection"
  ], "lit-plan");

  assertPromptContainsAll(byId.get("lit-implement").prompt, [
    "approved plan",
    "do not redesign",
    "verifiable slices",
    "DoneClaim",
    "independent verifier",
    "review-work"
  ], "lit-implement");

  assertPromptContainsAll(byId.get("lit-loop").prompt, [
    "delegate only independent slices",
    "DoneClaim",
    "independent verifier",
    "FullyDone",
    "cleanup receipt",
    "adversarial QA"
  ], "lit-loop");

  assertPromptContainsAll(byId.get("lit-prover").prompt, [
    "malformed input",
    "cancel/resume",
    "stale state",
    "dirty worktree",
    "misleading success output",
    "prompt injection"
  ], "lit-prover");

  assertPromptContainsAll(byId.get("lit-sentinel").prompt, [
    "goal/constraints",
    "real-surface QA",
    "code quality",
    "security",
    "context/docs/package",
    "all lanes"
  ], "lit-sentinel");

  assertPromptContainsAll(byId.get("lit-librarian").prompt, [
    "SHA-pinned",
    "official docs",
    "date awareness",
    "source-backed"
  ], "lit-librarian");
});

test("agent-roster carries the parallel-lane coordination rules and is described by the fan-out moment", async () => {
  const body = await fs.readFile(path.join("skills", "agent-roster", "SKILL.md"), "utf8");

  // lit-team was recorded as a named non-port: the donor's mechanism is thread binding through a
  // bundled state CLI, and this host exposes no thread primitive. The genuine remainder that no
  // existing surface covered lives here instead of in a skill that could never run.
  assert.match(body, /Parallel Lane Coordination/);
  assert.match(body, /depth-one/i, "the delegation model must be stated, not assumed");
  assert.match(body, /non-overlapping/i, "lanes need disjoint slices");
  for (const state of ["pending", "active", "reported", "blocked", "archived"]) {
    assert.match(body, new RegExp(`\`${state}\``), `per-lane state ${state} must be named`);
  }
  assert.match(body, /\.litopencode\/litgoal/, "lane state belongs in the existing ledger, not a second store");
  assert.match(body, /cleanup receipt/i, "the aggregate completion claim must require one per lane");
  // The donor's own anti-pattern: do not invent subagent machinery the host does not expose.
  assert.match(body, /exposes no thread primitive/i);

  // The discovery description is what makes it reachable at the moment it is needed, so it must name
  // the fan-out trigger rather than echo the skill's own name.
  const description = managedSkillDiscoveryDescription("agent-roster");
  assert.match(description, /about to be split across several lanes|fans out/i);
  assert.doesNotMatch(description, /^Trigger when the user asks for agent-roster/);
});
