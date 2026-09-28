import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  detectChatActivationMode,
  promptForChatActivationMode
} from "../src/activation-routing.ts";
import { createChatMessageActivationHook } from "../src/activation.ts";
import { createCommandActivationHook, litOpenCodeCommands } from "../src/commands.ts";
import { litOpenCodeFeatures } from "../src/features.ts";
import { litOpenCodeRuntimeSkills } from "../src/skills.ts";
import { litOpenCodeTools } from "../src/tools.ts";
import { workflowFamilyPrompt } from "../src/workflow-families.ts";

const families = {
  autoresearch: {
    commit: "58a65afc174cd8c2fa162bb0d1953b0a88e5d419",
    sourceIdentifier: "060_autoresearch-skill",
    tree: "9102dfeba13a738d23971b69b6b6ad7bf425c923",
    modes: ["core", "debug", "fix", "learn", "plan", "predict", "reason", "scenario", "security", "ship"]
  },
  autoconference: {
    commit: "58a65afc174cd8c2fa162bb0d1953b0a88e5d419",
    sourceIdentifier: "064_autoconference-skill",
    tree: "8e73d89cefd9ca136f9c45a918517cc5e809fd57",
    modes: ["core", "analyze", "debate", "plan", "resume", "ship", "survey"]
  },
  wikify: {
    commit: "dfe8f8bc372c3bc153dd57697f4a36f366a63e74",
    sourceIdentifier: "llm-wikify",
    tree: "ca02699317261cf36f9f89e96186728013778da6",
    publicLocator: "https://github.com/wjgoarxiv/llm-wikify/tree/dfe8f8bc372c3bc153dd57697f4a36f366a63e74",
    modes: ["init", "ingest", "query", "save", "lint"]
  }
};

const commandIds = [
  "autoresearch", "autoresearch-debug", "autoresearch-fix", "autoresearch-learn", "autoresearch-plan",
  "autoresearch-predict", "autoresearch-reason", "autoresearch-scenario", "autoresearch-security", "autoresearch-ship",
  "autoconference", "autoconference-analyze", "autoconference-debate", "autoconference-plan",
  "autoconference-resume", "autoconference-ship", "autoconference-survey",
  "wikify-init", "wikify-ingest", "wikify-query", "wikify-save", "wikify-lint"
];

async function familyText(id) {
  const root = path.join("skills", id);
  const chunks = [await fs.readFile(path.join(root, "SKILL.md"), "utf8")];
  for (const mode of families[id].modes) chunks.push(await fs.readFile(path.join(root, "modes", `${mode}.md`), "utf8"));
  return chunks.join("\n");
}

async function markdownFiles(root) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

const authorityEnvelope = /## OpenCode authority envelope[\s\S]*?lit-plan[\s\S]*?explicit `?\/start-work`?/iu;

function assertNoSemanticMatches(markdown, filePath, policies) {
  for (const { label, pattern } of policies) {
    assert.doesNotMatch(markdown, pattern, `${filePath}: ${label}`);
  }
}

test("three semantic families are one managed top-level skill each with complete nested modes", async () => {
  const ids = litOpenCodeRuntimeSkills.map((skill) => skill.id);
  for (const [id, family] of Object.entries(families)) {
    assert.ok(ids.includes(id), `${id} should be a runtime skill`);
    const provenance = await fs.readFile(path.join("skills", id, "PROVENANCE.md"), "utf8");
    assert.match(provenance, new RegExp(family.commit));
    assert.ok(provenance.includes(`Owner source identifier: \`${family.sourceIdentifier}\``));
    assert.ok(provenance.includes(`Owner source tree: \`${family.tree}\``));
    assert.match(provenance, /included MIT license/u);
    assert.match(provenance, /managed manifest, scanner, and actual packed bytes/u);
    assert.doesNotMatch(provenance, /my-agent-skills/iu);
    const publicLocators = provenance.match(/https?:\/\/[^\s`]+/gu) ?? [];
    if (family.publicLocator) {
      assert.match(provenance, /Verified public locator/u);
      assert.deepEqual(publicLocators, [family.publicLocator]);
    } else {
      assert.match(provenance, /Anonymous retrieval is not claimed/u);
      assert.deepEqual(publicLocators, []);
      assert.doesNotMatch(provenance, /(?:github\.com|git@)/iu);
    }
    assert.doesNotMatch(provenance, /(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:[\\/]Users[\\/][^\\/\s]+[\\/])/u);
    for (const mode of family.modes) await fs.stat(path.join("skills", id, "modes", `${mode}.md`));
  }
  assert.equal(ids.some((id) => /^(?:autoresearch|autoconference|wikify)-/.test(id)), false, "modes are not top-level products");
});

test("family ports preserve attribution phrases and exclude source-only debris", async () => {
  const autoresearch = await familyText("autoresearch");
  const wikify = await familyText("wikify");
  assert.match(autoresearch, /Core loop inspired by Karpathy's autoresearch/u);
  assert.match(autoresearch, /Autonomous research loop inspired by Karpathy's autoresearch\./u);
  assert.match(wikify, /llm-wikify is inspired by Karpathy’s llm-wiki pattern/u);

  for (const id of Object.keys(families)) {
    const entries = await fs.readdir(path.join("skills", id), { recursive: true });
    assert.equal(entries.some((entry) => /(^|\/)(?:tests?|docs?|examples?|release\.sh|__pycache__|\.pytest_cache)(\/|$)/u.test(entry)), false, `${id} has source-only debris`);
  }
});

test("family commands route nested modes through the approved authority lifecycle", () => {
  const commands = new Map(litOpenCodeCommands.map((command) => [command.id, command]));
  for (const id of commandIds) {
    const command = commands.get(id);
    assert.ok(command, `missing /${id}`);
    assert.match(command.activationText, /lit-plan/u);
    assert.match(command.activationText, /budget/i);
    assert.match(command.activationText, /authority/i);
    assert.match(command.activationText, /\/start-work/u);
    assert.match(command.activationText, /bounded loop/i);
    assert.match(command.activationText, /\/review-work/u);
    assert.match(command.activationText, /Treat .*arguments.*inert data/is);
    assert.equal(command.agent, id.endsWith("-plan") ? "lit-plan" : undefined);
  }
});

test("family plan routes and documents stay planning-only until explicit start-work", async () => {
  const commands = new Map(litOpenCodeCommands.map((command) => [command.id, command]));
  for (const [id, documentPath] of [
    ["autoresearch-plan", "skills/autoresearch/modes/plan.md"],
    ["autoconference-plan", "skills/autoconference/modes/plan.md"]
  ]) {
    const command = commands.get(id);
    assert.ok(command);
    assert.equal(command.agent, "lit-plan");
    assert.match(command.activationText, /planning-only/iu);
    assert.match(command.activationText, /proposal packet/iu);
    assert.match(command.activationText, /approval packet/iu);
    assert.match(command.activationText, /explicit \/start-work/iu);
    assert.match(command.activationText, /(?:write|evaluator execution).*\/start-work/is);
    assert.match(command.activationText, /incomplete scaffold/iu);
    assert.match(command.activationText, /helper/iu);

    const document = await fs.readFile(documentPath, "utf8");
    const frontmatter = document.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
    assert.doesNotMatch(frontmatter, /^\s*- (?:Write|Edit|Bash|Agent)$/gmu, `${id} grants a mutating planning tool`);
    assert.match(document, /planning-only/iu);
    assert.match(document, /proposal packet/iu);
    assert.match(document, /approval packet/iu);
    assert.match(document, /explicit \/start-work/iu);
    assert.match(document, /must not (?:write|run|execute)/iu);

    const family = id.startsWith("autoresearch") ? "autoresearch" : "autoconference";
    const rootContract = await fs.readFile(`skills/${family}/SKILL.md`, "utf8");
    const planRow = rootContract.split("\n").find((line) => /^\| plan \|/u.test(line)) ?? "";
    assert.match(planRow, /planning-only/iu);
    assert.match(planRow, /proposal/iu);
    assert.match(planRow, /approval/iu);
  }
});

test("family plan command and chat activations do not initialize or append the durable ledger", async () => {
  for (const mode of ["autoresearch-plan", "autoconference-plan"]) {
    for (const surface of ["command", "chat"]) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `litopencode-${mode}-${surface}-`));
      try {
        const output = surface === "command"
          ? { parts: [] }
          : {
              message: { id: `msg-${mode}`, sessionID: `session-${mode}`, role: "user" },
              parts: [{
                id: `part-${mode}`,
                sessionID: `session-${mode}`,
                messageID: `msg-${mode}`,
                type: "text",
                text: mode.replace("-", " ")
              }]
            };
        if (surface === "command") {
          await createCommandActivationHook(root)(
            { command: `/${mode}`, sessionID: `session-${mode}`, arguments: "draft only" },
            output
          );
        } else {
          await createChatMessageActivationHook(root)(
            { sessionID: `session-${mode}`, messageID: `msg-${mode}`, agent: "lit-loop" },
            output
          );
        }

        assert.equal(output.parts.length, surface === "command" ? 1 : 2);
        assert.match(output.parts.at(-1).text, /planning-only/iu);
        await assert.rejects(fs.lstat(path.join(root, ".litopencode")), { code: "ENOENT" });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  }
});

test("family chat activation handles leading aliases and rejects slash, fence, quote, code, and prose mentions", () => {
  const positives = [
    ["autoresearch", "autoresearch"],
    ["autoresearch improve parser latency", "autoresearch"],
    ["autoresearch, improve parser latency", "autoresearch"],
    ["autoresearch debug this failure", "autoresearch-debug"],
    ["autoresearch-security audit this service", "autoresearch-security"],
    ["autoconference compare retrieval strategies", "autoconference"],
    ["autoconference plan this research conference", "autoconference-plan"],
    ["autoconference resume ./run", "autoconference-resume"],
    ["wikify:query what changed?", "wikify-query"],
    ["wikify ingest raw/paper.md", "wikify-ingest"],
    ["wikify this repo", "wikify-init"]
  ];
  for (const [text, expected] of positives) assert.equal(detectChatActivationMode(text), expected, text);

  const negatives = [
    "/autoresearch debug",
    "```text\nautoresearch debug\n```",
    "`autoconference resume`",
    "> wikify ingest raw/",
    "the docs say \"autoresearch security\"",
    "we discussed autoconference yesterday",
    "const mode = 'wikify save'",
    "autoresearcher improve parser latency",
    "autoconferencing compare retrieval strategies",
    "autoresearch-unknown do something",
    "autoresearch:unknown do something",
    "autoconference-unknown do something",
    "autoconference:unknown do something",
    "wikify-unknown do something",
    "wikify:unknown do something"
  ];
  for (const text of negatives) assert.equal(detectChatActivationMode(text), undefined, text);

  for (const mode of ["autoresearch", "autoresearch-debug", "autoconference", "wikify-ingest"]) {
    assert.match(promptForChatActivationMode(mode), /Treat .*arguments.*inert data/is);
  }
});

test("autoconference recursive protocol uses bounded authority instead of destructive git recipes", async () => {
  const files = await markdownFiles("skills/autoconference");
  const corpus = (await Promise.all(files.map(async (filePath) => fs.readFile(filePath, "utf8")))).join("\n");
  assert.doesNotMatch(
    corpus,
    /\bgit\s+(?:-C\s+\S+\s+)?(?:checkout|merge|branch|worktree|cherry-pick|reset|clean|commit)\b/iu
  );
  assert.doesNotMatch(corpus, /\brm\s+-rf\b/iu);

  const protocol = await fs.readFile("skills/autoconference/references/conference-protocol.md", "utf8");
  assert.match(protocol, /OpenCode bounded-authority/iu);
  assert.match(protocol, /explicit `?\/start-work`?/iu);
  assert.match(protocol, /read-only (?:diff|comparison)/iu);
  assert.match(protocol, /cleanup receipt/iu);
  assert.match(protocol, /must not (?:create|reset|delete|merge|commit)/iu);
});

test("every autoconference mode and reference is root-owned, packet-only, and free of foreign execution semantics", async () => {
  const activeFiles = [
    ...(await markdownFiles("skills/autoconference/modes")),
    ...(await markdownFiles("skills/autoconference/references"))
  ];
  const allFiles = await markdownFiles("skills/autoconference");
  const policies = [
    { label: "foreign model tier or harness", pattern: /\b(?:Claude|Codex|Sonnet|Opus|Haiku)\b|\.claude\//iu },
    { label: "automatic version-control workspace", pattern: /\b(?:worktrees?|branches?|cherry[- ]picks?)\b|\bconference\/best\b/iu },
    { label: "foreign command route", pattern: /\/(?:compare-worktrees|autoconference:[a-z-]+)/iu },
    {
      label: "child writes shared or root-owned state",
      pattern: /\b(?:child|researcher|session chair|reviewer|synthesizer)[^\n]{0,80}(?:(?:must|should|will|may|can)\s+(?!not\b)(?:write|append|update|modify|delete|remove|apply)|(?:writes|appends|updates|modifies|deletes|removes|applies))[^\n]{0,120}\b(?:shared knowledge|conference\.md|conference_results|conference_events|root-owned state)\b/iu
    }
  ];

  for (const filePath of activeFiles) {
    const markdown = await fs.readFile(filePath, "utf8");
    assert.match(markdown, authorityEnvelope, `${filePath}: missing approval envelope`);
    assert.match(markdown, /root-owned/iu, `${filePath}: missing root ownership`);
    assert.match(markdown, /packet-only/iu, `${filePath}: missing packet-only child rule`);
    assert.match(markdown, /child(?:ren)?[^\n]*(?:must not|cannot)[^\n]*(?:write|mutate|select|route)/iu, `${filePath}: child prohibition is incomplete`);
  }
  for (const filePath of allFiles) assertNoSemanticMatches(await fs.readFile(filePath, "utf8"), filePath, policies);

  const provenance = await fs.readFile("skills/autoconference/PROVENANCE.md", "utf8");
  assert.match(provenance, /adapted from/iu);
  assert.match(provenance, /operational (?:prompt|recovery|mode).*rewritten/isu);
  assert.doesNotMatch(provenance, /ported from|retains? .*prompt.*recovery/iu);
});

test("every autoresearch mode and reference gates mutation through approved lit-plan and start-work", async () => {
  const activeFiles = [
    ...(await markdownFiles("skills/autoresearch/modes")),
    ...(await markdownFiles("skills/autoresearch/references"))
  ];
  const policies = [
    { label: "unattended authority slogan", pattern: /\bNEVER ASK\b/iu },
    { label: "foreign model tier or harness", pattern: /\b(?:Claude|Codex|Sonnet|Opus|Haiku)\b|\.claude\//iu },
    { label: "foreign family route", pattern: /\/(?:autoresearch:[a-z-]+|autoconference:[a-z-]+)/iu },
    {
      label: "direct commit or stash",
      pattern: /\bgit\s+(?:commit|stash)\b|\b(?:commit|stash)\s+(?:the|these|changes|files|first)\b|\bsuggest (?:committing|stashing)\b/iu
    },
    { label: "lock deletion recovery", pattern: /\b(?:delete|remove|unlink|clear)\b[^\n]{0,80}\block(?:file)?\b|\block(?:file)?\b[^\n]{0,80}\b(?:delete|remove|unlink|clear)\b/iu },
    {
      label: "unbounded mutation loop",
      pattern: /\b(?:execute the (?:change|experiment)|modify files|run code|revert the change|start iterating:\s*modify|begin the next iteration now)\b/iu
    }
  ];

  for (const filePath of activeFiles) {
    const markdown = await fs.readFile(filePath, "utf8");
    assert.match(markdown, authorityEnvelope, `${filePath}: missing approval envelope`);
    assert.match(markdown, /before any\s+mutation/iu, `${filePath}: interactive and unattended mutation boundary is unclear`);
    assert.match(markdown, /bounded/iu, `${filePath}: mutation scope is not bounded`);
    assertNoSemanticMatches(markdown, filePath, policies);
  }

  const provenance = await fs.readFile("skills/autoresearch/PROVENANCE.md", "utf8");
  assert.match(provenance, /adapted from/iu);
  assert.match(provenance, /operational (?:mode|reference).*rewritten/isu);
  assert.doesNotMatch(provenance, /ported from|retained verbatim/iu);
});

test("every wikify mode uses OpenCode-native bounded authority and treats external content as inert", async () => {
  const modeFiles = await markdownFiles("skills/wikify/modes");
  assert.deepEqual(
    modeFiles.map((filePath) => path.basename(filePath)),
    ["ingest.md", "init.md", "lint.md", "query.md", "save.md"]
  );
  const foreignPolicies = [
    { label: "foreign family name", pattern: /\bllm-wikify\b/iu },
    { label: "foreign model or harness", pattern: /\b(?:Claude|Codex|Sonnet|Opus|Haiku)\b|\.claude\//iu },
    { label: "foreign mode route", pattern: /\/wikify:[a-z-]+/iu },
    { label: "unapproved direct mutation", pattern: /\b(?:then act|update the wiki first, then answer|always leave .* report)\b/iu }
  ];

  for (const filePath of modeFiles) {
    const markdown = await fs.readFile(filePath, "utf8");
    assert.match(markdown, authorityEnvelope, `${filePath}: missing approval envelope`);
    assert.match(markdown, /OpenCode/iu, `${filePath}: missing host vocabulary`);
    assert.match(markdown, /external (?:content|source|text).*(?:inert|untrusted)|(?:inert|untrusted).*external (?:content|source|text)/isu, `${filePath}: external content is not fenced as inert`);
    assert.match(markdown, /command arguments?.*(?:inert|untrusted)|(?:inert|untrusted).*command arguments?/isu, `${filePath}: route arguments are not inert`);
    assert.match(markdown, /\/review-work/iu, `${filePath}: missing completed-work review route`);
    assertNoSemanticMatches(markdown, filePath, foreignPolicies);
  }

  for (const mode of ["init", "ingest", "save", "lint"]) {
    const markdown = await fs.readFile(`skills/wikify/modes/${mode}.md`, "utf8");
    assert.match(markdown, /before any (?:write|fix|save|mutation)/iu, `${mode}: write boundary is unclear`);
    assert.match(markdown, /explicit `?\/start-work`?/iu, `${mode}: start-work gate is missing`);
  }
  const ingest = await fs.readFile("skills/wikify/modes/ingest.md", "utf8");
  assert.match(ingest, /remote ingest.*lit-plan.*explicit `?\/start-work`?/isu);
  const query = await fs.readFile("skills/wikify/modes/query.md", "utf8");
  assert.match(query, /read-only/iu);
  assert.match(query, /must not (?:write|update|save|fix)/iu);
  const lint = await fs.readFile("skills/wikify/modes/lint.md", "utf8");
  assert.match(lint, /bounded recovery/iu);
  assert.match(lint, /recovery-required/iu);
  assert.match(lint, /invalid stages?/iu);
  assert.match(lint, /unsafe stages?/iu);
  const wikify = await fs.readFile("skills/wikify/SKILL.md", "utf8");
  assert.match(wikify, /local user-owned state/iu);
  assert.match(wikify, /cooperative writers/iu);
  assert.match(wikify, /same-uid/iu);
  assert.match(wikify, /confidentiality/iu);
  assert.match(wikify, /`\/wikify-lint` has a narrow bounded snapshot-recovery exception/iu);
  assert.match(wikify, /may publish one validated staged\s+snapshot or remove stages that it proves invalid/iu);
  assert.match(wikify, /cannot change claim review semantics or modify wiki\s+or source files/iu);
});

test("recursive workflow references contain only approval-gated finite host probes", async () => {
  const policies = [
    { label: "stateful source-history bisection", pattern: /\bgit\s+bisect\b/iu },
    { label: "privilege escalation", pattern: /\bsudo\b/iu },
    { label: "attached or external tracing", pattern: /\b(?:strace|dtrace|dtruss|ptrace|py-spy)\b/iu },
    { label: "package installation", pattern: /\b(?:pip(?:3)?\s+install|python\s+-m\s+pip|npm\s+install|apt(?:-get)?\s+install|brew\s+install)\b/iu },
    { label: "unbounded log following", pattern: /\btail\s+-f\b|\b--follow\b/iu }
  ];
  for (const family of ["autoresearch", "autoconference"]) {
    for (const filePath of await markdownFiles(`skills/${family}`)) {
      assertNoSemanticMatches(await fs.readFile(filePath, "utf8"), filePath, policies);
    }
  }

  const investigation = await fs.readFile("skills/autoresearch/references/investigation-techniques.md", "utf8");
  assert.match(investigation, /approval-gated finite host probe/iu);
  assert.match(investigation, /explicit `?\/start-work`?/iu);
  assert.match(investigation, /(?:timeout|deadline)/iu);
  assert.match(investigation, /(?:maximum|bounded).*(?:lines|bytes|samples|events)/isu);
});

test("evaluator deadlines use the packaged portable Python wrapper instead of a GNU timeout assumption", async () => {
  const contract = await fs.readFile("skills/autoresearch/references/evaluator-contract.md", "utf8");
  assert.doesNotMatch(contract, /`?timeout\s+(?:5m|[0-9]+)/iu);
  assert.match(contract, /scripts\/run_with_deadline\.py/iu);
  assert.match(contract, /Python (?:3|standard library)/iu);

  const helper = "skills/autoresearch/scripts/run_with_deadline.py";
  const success = spawnSync("python3", [helper, "1", "--", "python3", "-c", 'print("{\\"pass\\": true}")'], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /"pass": true/u);

  const timedOut = spawnSync("python3", [helper, "0.05", "--", "python3", "-c", "import time; time.sleep(1)"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(timedOut.status, 125, timedOut.stderr);
  assert.match(timedOut.stderr, /BLOCKED_PROCESS_TREE_CLEANUP_UNVERIFIED/iu);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-deadline-tree-"));
  try {
    const sentinel = path.join(tempRoot, "delayed-sentinel.txt");
    const grandchild = `import pathlib,time; time.sleep(0.4); pathlib.Path(${JSON.stringify(sentinel)}).write_text("late")`;
    const parent = `import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",${JSON.stringify(grandchild)}], start_new_session=True); time.sleep(5)`;
    const treeTimeout = spawnSync("python3", [helper, "0.05", "--", "python3", "-c", parent], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(treeTimeout.status, 125, treeTimeout.stderr);
    await new Promise((resolve) => setTimeout(resolve, 650));
    await assert.rejects(fs.stat(sentinel), { code: "ENOENT" });
    assert.match(treeTimeout.stderr, /BLOCKED_PROCESS_TREE_CLEANUP_UNVERIFIED/iu);
    assert.match(treeTimeout.stderr, /best-effort/iu);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  assert.match(contract, /process group|taskkill/iu);
  assert.match(contract, /exit code 125/iu);
  assert.match(contract, /BLOCKED_PROCESS_TREE_CLEANUP_UNVERIFIED/iu);
  assert.match(contract, /manual(?:ly)?[^\n]*(?:inspect|cleanup|clean up|stop)/iu);
  assert.doesNotMatch(contract, /(?:verified|complete) (?:process[- ]tree )?cleanup[^\n]*process group/iu);
});

test("evaluator deadlines reject non-finite seconds as typed CLI input errors", async (t) => {
  const helper = "skills/autoresearch/scripts/run_with_deadline.py";
  for (const seconds of ["nan", "inf", "-inf", "1e309"]) {
    await t.test(seconds, () => {
      const optionTerminator = seconds.startsWith("-") ? ["--"] : [];
      const result = spawnSync("python3", [helper, ...optionTerminator, seconds, "--", "python3", "-c", "raise SystemExit(0)"], {
        cwd: process.cwd(),
        encoding: "utf8"
      });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /error: seconds must be finite and greater than zero/iu);
    });
  }
});

test("operational reference limits scaffold and status helper availability to Autoresearch and Autoconference", async () => {
  const readme = await fs.readFile("docs/reference.md", "utf8");
  const managedFamilies = readme.match(/### Managed workflow families[\s\S]*?(?=\n### |\n## )/u)?.[0] ?? "";
  assert.match(managedFamilies, /Autoresearch and Autoconference[\s\S]*scaffold\/status helpers/iu);
  assert.match(managedFamilies, /Wikify[\s\S]*(?:templates|contracts)[\s\S]*no scaffold or status\s+helper/iu);
  assert.doesNotMatch(managedFamilies, /(?:all three|their installed trees)[^\n]*helpers/iu);
  assert.match(readme, /Wikify probe checks five surfaces[\s\S]*tool\.execute\.after[\s\S]*chat\.message[\s\S]*command\.execute\.before/iu);
  assert.match(readme, /Wikify additionally owns[\s\S]*one bounded[\s\S]*wikify[\s\S]*tool[\s\S]*tool\.execute\.after/iu);
  assert.doesNotMatch(readme, /Autoresearch, Autoconference, and Wikify add command\/chat activation[^\n]*not tools/iu);
});

test("workflow visualization references resolve to the installed LitOpenCode command route", async () => {
  const commandRoutes = new Set(litOpenCodeCommands.map((command) => `/${command.id}`));
  assert.equal(commandRoutes.has("/lit-scientific-visualization"), true);
  for (const family of ["autoresearch", "autoconference"]) {
    const entries = await fs.readdir(`skills/${family}`, { recursive: true, withFileTypes: true });
    const textFiles = entries
      .filter((entry) => entry.isFile() && /\.(?:md|py|sh)$/u.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name));
    const corpus = (await Promise.all(textFiles.map((filePath) => fs.readFile(filePath, "utf8")))).join("\n");
    assert.doesNotMatch(corpus, /(?<!lit-)\/scientific-visualization\b/iu);
    assert.match(corpus, /\/lit-scientific-visualization\b/iu);
    for (const match of corpus.matchAll(/\/(?:lit-)?scientific-visualization\b/giu)) {
      assert.equal(commandRoutes.has(match[0]), true, `${family}: unknown visualization route ${match[0]}`);
    }
  }
});

test("conference scaffolder is parse-compatible with the declared Python 3.8 floor", async () => {
  const scriptPath = "skills/autoconference/scripts/init_conference.py";
  const source = await fs.readFile(scriptPath, "utf8");
  assert.doesNotMatch(source, /\b(?:list|dict|tuple|set)\[[^\]]+\]/u);
  const capability = spawnSync("python3", ["-c", "import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(), feature_version=(3, 8))", scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(capability.status, 0, capability.stderr);
  const contract = await fs.readFile("skills/autoconference/references/upstream-family-contract.md", "utf8");
  assert.match(contract, /Python 3\.8\+/u);
});

test("plan helpers execute as explicit incomplete scaffolds without wrong-harness instructions", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-family-scaffold-"));
  try {
    const cases = [
      {
        plan: "skills/autoresearch/modes/plan.md",
        script: "skills/autoresearch/scripts/init_research.py",
        checker: "skills/autoresearch/scripts/check_progress.sh",
        output: path.join(tempRoot, "research"),
        args: ["--goal", "Reduce parser latency", "--metric", "p95_ms", "--direction", "minimize", "--target", "< 10"],
        artifact: "research.md"
      },
      {
        plan: "skills/autoconference/modes/plan.md",
        script: "skills/autoconference/scripts/init_conference.py",
        checker: "skills/autoconference/scripts/check_conference.sh",
        output: path.join(tempRoot, "conference"),
        args: ["--goal", "Compare parser strategies", "--metric", "p95_ms", "--direction", "minimize", "--target", "< 10", "--researchers", "2", "--devils-advocate", "no"],
        artifact: "conference.md"
      }
    ];

    for (const fixture of cases) {
      const plan = await fs.readFile(fixture.plan, "utf8");
      const frontmatter = plan.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
      assert.doesNotMatch(frontmatter, /^\s*- (?:Write|Edit|Bash|Agent)$/gmu);
      assert.match(plan, /incomplete scaffold/iu);
      assert.match(plan, /placeholder/iu);
      assert.match(plan, /explicit `?\/start-work`?/iu);
      assert.doesNotMatch(plan, /helper[^\n]{0,120}(?:complete artifact|fully configured|leave no placeholders)/iu);

      const result = spawnSync("python3", [fixture.script, ...fixture.args, "--output", fixture.output], {
        cwd: process.cwd(),
        encoding: "utf8"
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /incomplete scaffold/iu);
      assert.match(result.stdout, /explicit \/start-work/iu);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /\b(?:Claude|Codex)\b|\.claude\//iu);
      const artifact = await fs.readFile(path.join(fixture.output, fixture.artifact), "utf8");
      assert.match(artifact, /Scaffold status:\s*INCOMPLETE/iu);
      assert.match(artifact, /placeholder/iu);
      assert.match(artifact, /explicit \/start-work/iu);

      const checkerSource = await fs.readFile(fixture.checker, "utf8");
      assert.doesNotMatch(checkerSource, /PID_FILE|kill\s+-0|loop active|run_status="running"/u);
      const freshStatus = spawnSync("bash", [fixture.checker, fixture.output], { cwd: process.cwd(), encoding: "utf8" });
      assert.equal(freshStatus.status, 0, freshStatus.stderr);
      assert.match(freshStatus.stdout, /Status:\s+incomplete scaffold/iu);
      assert.doesNotMatch(freshStatus.stdout, /\brunning\b|loop active/iu);

      await fs.writeFile(
        path.join(fixture.output, fixture.artifact),
        artifact.replace(/Scaffold status:\s*INCOMPLETE/iu, "Scaffold status: APPROVED")
      );
      if (fixture.artifact === "research.md") {
        await fs.appendFile(
          path.join(fixture.output, "autoresearch-results.tsv"),
          "1\t9\t-1\t-10%\tkept\tApproved bounded probe\tagent\t2026-07-29T00:05:00Z\n"
        );
      } else {
        await fs.appendFile(
          path.join(fixture.output, "conference_events.jsonl"),
          '{"event":"round.started","timestamp":"2026-07-29T00:00:00Z"}\n'
        );
      }
      const progressStatus = spawnSync("bash", [fixture.checker, fixture.output], { cwd: process.cwd(), encoding: "utf8" });
      assert.equal(progressStatus.status, 0, progressStatus.stderr);
      assert.match(progressStatus.stdout, /Status:\s+progress recorded/iu);
      assert.doesNotMatch(progressStatus.stdout, /\brunning\b|loop active/iu);
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow status helpers distinguish absent, scaffold, progress, terminal-incomplete, and complete states", async () => {
  const researchLogging = await fs.readFile("skills/autoresearch/references/results-logging.md", "utf8");
  assert.match(researchLogging, /autoresearch_events\.jsonl/iu);
  assert.match(researchLogging, /autoresearch\.completed/iu);
  assert.match(researchLogging, /final_report_path/iu);
  assert.match(researchLogging, /results_path/iu);
  assert.match(researchLogging, /total_iterations/iu);
  assert.match(researchLogging, /Node/iu);
  const conferenceLogging = await fs.readFile("skills/autoconference/references/results-logging.md", "utf8");
  for (const field of ["terminal_verdict", "total_iterations", "total_rounds", "researcher_count"]) {
    assert.match(conferenceLogging, new RegExp(field, "iu"));
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-family-status-states-"));
  const runStatus = (script, output, options = {}) => spawnSync("bash", [script, output], {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options
  });
  const assertState = (result, expected) => {
    const expectedCode = expected === "not initialized" ? 2 : expected === "terminal invalid" ? 4 : 0;
    assert.equal(result.status, expectedCode, result.stderr);
    assert.match(result.stdout, new RegExp(`Status:\\s+${expected}`, "iu"));
  };
  try {
    const research = path.join(tempRoot, "research");
    const researchChecker = "skills/autoresearch/scripts/check_progress.sh";
    assertState(runStatus(researchChecker, research), "not initialized");
    const researchInit = spawnSync("python3", [
      "skills/autoresearch/scripts/init_research.py",
      "--goal", "Track state transitions", "--metric", "score", "--direction", "maximize",
      "--target", "1", "--output", research
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(researchInit.status, 0, researchInit.stderr);
    const researchCheckerSource = await fs.readFile(researchChecker, "utf8");
    assert.doesNotMatch(researchCheckerSource, /python3\s+-/u);
    assert.match(researchCheckerSource, /NODE_BINARY/u);
    assert.match(researchCheckerSource, /BLOCKED_NODE_UNAVAILABLE/u);
    const researchNodeBlocked = runStatus(researchChecker, research, {
      env: { ...process.env, NODE_BINARY: "node-command-that-does-not-exist" }
    });
    assert.equal(researchNodeBlocked.status, 3, researchNodeBlocked.stderr);
    assert.match(researchNodeBlocked.stdout, /Status:\s+BLOCKED_NODE_UNAVAILABLE/iu);
    const researchNodeRuntimeError = runStatus(researchChecker, research, {
      env: { ...process.env, NODE_BINARY: "false" }
    });
    assert.equal(researchNodeRuntimeError.status, 3, researchNodeRuntimeError.stderr);
    assert.match(researchNodeRuntimeError.stdout, /Status:\s+BLOCKED_NODE_RUNTIME_ERROR/iu);
    assertState(runStatus(researchChecker, research), "incomplete scaffold");
    await fs.writeFile(
      path.join(research, "research.md"),
      (await fs.readFile(path.join(research, "research.md"), "utf8"))
        .replace(/Scaffold status:\s*INCOMPLETE/iu, "Scaffold status: APPROVED")
    );
    assertState(runStatus(researchChecker, research), "ready; no progress recorded");
    const researchResults = path.join(research, "autoresearch-results.tsv");
    await fs.writeFile(
      researchResults,
      (await fs.readFile(researchResults, "utf8")).replace(
        /^0\tTBD\t-\t-\tbaseline\tInitial state\tagent\t[^\n]+$/mu,
        "0\t0\t-\t-\tbaseline\tFinite baseline\tmechanical\t2026-07-29T00:00:00Z"
      )
    );
    await fs.appendFile(
      researchResults,
      "1\t0.5\t0.5\t50%\tkept\tBounded experiment\tagent\t2026-07-29T00:05:00Z\n"
    );
    assertState(runStatus(researchChecker, research), "progress recorded");
    await fs.appendFile(
      path.join(research, "autoresearch_events.jsonl"),
      '{"event":"autoresearch.completed"\n'
    );
    assertState(runStatus(researchChecker, research), "progress recorded");
    const researchTerminal = {
      event: "autoresearch.completed",
      timestamp: "2026-07-29T00:00:00Z",
      terminal_reason: "TARGET_MET",
      final_report_path: "final_report.md",
      results_path: "autoresearch-results.tsv",
      total_iterations: 1
    };
    for (const invalid of [
      { event: "autoresearch.completed", timestamp: "2026-07-29T00:00:00Z" },
      { ...researchTerminal, timestamp: "2026-07-29" },
      { ...researchTerminal, terminal_reason: "DONE" },
      { ...researchTerminal, final_report_path: "../final_report.md" },
      { ...researchTerminal, total_iterations: 2 }
    ]) {
      await fs.appendFile(path.join(research, "autoresearch_events.jsonl"), `${JSON.stringify(invalid)}\n`);
      assertState(runStatus(researchChecker, research), "terminal invalid");
    }
    await fs.appendFile(
      path.join(research, "autoresearch_events.jsonl"),
      `${JSON.stringify(researchTerminal)}\n`
    );
    assertState(runStatus(researchChecker, research), "terminal incomplete");
    await fs.writeFile(path.join(research, "final_report.md"), "");
    assertState(runStatus(researchChecker, research), "terminal incomplete");
    await fs.writeFile(path.join(research, "final_report.md"), "# Final report\n\nTarget met with evidence.\n");
    assertState(runStatus(researchChecker, research), "COMPLETE");

    const conference = path.join(tempRoot, "conference");
    const conferenceChecker = "skills/autoconference/scripts/check_conference.sh";
    assertState(runStatus(conferenceChecker, conference), "not initialized");
    const conferenceInit = spawnSync("python3", [
      "skills/autoconference/scripts/init_conference.py",
      "--goal", "Track conference states", "--metric", "score", "--direction", "maximize",
      "--target", "1", "--researchers", "1", "--output", conference
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(conferenceInit.status, 0, conferenceInit.stderr);
    const conferenceCheckerSource = await fs.readFile(conferenceChecker, "utf8");
    assert.doesNotMatch(conferenceCheckerSource, /python3\s+-/u);
    assert.match(conferenceCheckerSource, /NODE_BINARY/u);
    assert.match(conferenceCheckerSource, /BLOCKED_NODE_UNAVAILABLE/u);
    const conferenceNodeBlocked = runStatus(conferenceChecker, conference, {
      env: { ...process.env, NODE_BINARY: "node-command-that-does-not-exist" }
    });
    assert.equal(conferenceNodeBlocked.status, 3, conferenceNodeBlocked.stderr);
    assert.match(conferenceNodeBlocked.stdout, /Status:\s+BLOCKED_NODE_UNAVAILABLE/iu);
    const conferenceNodeRuntimeError = runStatus(conferenceChecker, conference, {
      env: { ...process.env, NODE_BINARY: "false" }
    });
    assert.equal(conferenceNodeRuntimeError.status, 3, conferenceNodeRuntimeError.stderr);
    assert.match(conferenceNodeRuntimeError.stdout, /Status:\s+BLOCKED_NODE_RUNTIME_ERROR/iu);
    assertState(runStatus(conferenceChecker, conference), "incomplete scaffold");
    await fs.writeFile(
      path.join(conference, "conference.md"),
      (await fs.readFile(path.join(conference, "conference.md"), "utf8"))
        .replace(/Scaffold status:\s*INCOMPLETE/iu, "Scaffold status: APPROVED")
    );
    assertState(runStatus(conferenceChecker, conference), "ready; no progress recorded");
    await fs.appendFile(
      path.join(conference, "conference_results.tsv"),
      "1\tA\t0\t0\t-\t-\tbaseline\tFinite baseline\tscript:test\t-\t2026-07-29T00:10:00Z\n" +
      "1\tA\t1\t0.5\t0.5\t50%\tkept\tBounded lane\tscript:test\tvalidated\t2026-07-29T00:20:00Z\n"
    );
    await fs.appendFile(
      path.join(conference, "conference_events.jsonl"),
      '{"event":"round.started","timestamp":"2026-07-29T00:00:00Z"}\n'
    );
    await fs.appendFile(
      path.join(conference, "conference_events.jsonl"),
      '{"event":"round.completed","timestamp":"2026-07-29T00:30:00Z","payload":{"round":1,"best_metric":0.5,"best_researcher":"A","converged":false}}\n'
    );
    assertState(runStatus(conferenceChecker, conference), "progress recorded");
    await fs.appendFile(
      path.join(conference, "conference_events.jsonl"),
      '{"event":"conference.completed"\n'
    );
    assertState(runStatus(conferenceChecker, conference), "progress recorded");
    const conferenceTerminal = {
      event: "conference.completed",
      timestamp: "2026-07-29T01:00:00Z",
      terminal_verdict: "TARGET_MET",
      payload: {
        synthesis_path: "synthesis.md",
        final_report_path: "final_report.md",
        total_iterations: 1,
        total_rounds: 1,
        researcher_count: 1
      }
    };
    for (const invalid of [
      { event: "conference.completed", timestamp: "2026-07-29T01:00:00Z" },
      { ...conferenceTerminal, timestamp: "2026-07-29" },
      { ...conferenceTerminal, terminal_verdict: "DONE" },
      { ...conferenceTerminal, payload: { ...conferenceTerminal.payload, synthesis_path: "../synthesis.md" } },
      { ...conferenceTerminal, payload: { ...conferenceTerminal.payload, total_rounds: 2 } }
    ]) {
      await fs.appendFile(path.join(conference, "conference_events.jsonl"), `${JSON.stringify(invalid)}\n`);
      assertState(runStatus(conferenceChecker, conference), "terminal invalid");
    }
    await fs.appendFile(
      path.join(conference, "conference_events.jsonl"),
      `${JSON.stringify(conferenceTerminal)}\n`
    );
    assertState(runStatus(conferenceChecker, conference), "terminal incomplete");
    await fs.writeFile(path.join(conference, "synthesis.md"), "# Synthesis\n\nAccepted evidence.\n");
    await fs.writeFile(path.join(conference, "final_report.md"), "");
    assertState(runStatus(conferenceChecker, conference), "terminal incomplete");
    await fs.writeFile(path.join(conference, "final_report.md"), "# Final report\n\nConference complete.\n");
    assertState(runStatus(conferenceChecker, conference), "COMPLETE");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("status helpers reject schema-incomplete valid JSON terminal events", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-terminal-schema-red-"));
  try {
    const research = path.join(tempRoot, "research");
    await fs.mkdir(research);
    await fs.writeFile(path.join(research, "research.md"), "## Goal\nSchema validation\n- **Direction:** maximize\n- **Max iterations:** 2\n");
    await fs.writeFile(
      path.join(research, "autoresearch-results.tsv"),
      "iteration\tmetric_value\tdelta\tdelta_pct\tstatus\tdescription\tevaluator_source\ttimestamp\n1\t1\t1\t100%\tkept\tresult\ttest\t2026-07-29\n"
    );
    await fs.writeFile(
      path.join(research, "autoresearch_events.jsonl"),
      '{"event":"autoresearch.completed","timestamp":"2026-07-29T00:00:00Z"}\n'
    );
    const researchStatus = spawnSync("bash", ["skills/autoresearch/scripts/check_progress.sh", research], {
      cwd: process.cwd(), encoding: "utf8"
    });
    assert.equal(researchStatus.status, 4, researchStatus.stderr);
    assert.match(researchStatus.stdout, /Status:\s+terminal invalid/iu);

    const conference = path.join(tempRoot, "conference");
    await fs.mkdir(conference);
    await fs.writeFile(
      path.join(conference, "conference.md"),
      "## Goal\nSchema validation\n- **Count:** 1\n- **Max rounds:** 1\n- **Direction:** maximize\n"
    );
    await fs.writeFile(
      path.join(conference, "conference_results.tsv"),
      "round\tresearcher\titeration\tmetric_value\n1\tA\t1\t1\n"
    );
    await fs.writeFile(
      path.join(conference, "conference_events.jsonl"),
      '{"event":"round.completed","timestamp":"2026-07-29T00:30:00Z","round":1}\n{"event":"conference.completed","timestamp":"2026-07-29T01:00:00Z"}\n'
    );
    const conferenceStatus = spawnSync("bash", ["skills/autoconference/scripts/check_conference.sh", conference], {
      cwd: process.cwd(), encoding: "utf8"
    });
    assert.equal(conferenceStatus.status, 4, conferenceStatus.stderr);
    assert.match(conferenceStatus.stdout, /Status:\s+terminal invalid/iu);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("initialized status helpers fail typed when the guaranteed Node runtime is unavailable", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-status-node-blocked-"));
  try {
    const research = path.join(tempRoot, "research");
    await fs.mkdir(research);
    await fs.writeFile(path.join(research, "research.md"), "## Goal\nNode probe\n");
    const result = spawnSync("bash", ["skills/autoresearch/scripts/check_progress.sh", research], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NODE_BINARY: "node-command-that-does-not-exist" }
    });
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stdout, /Status:\s+BLOCKED_NODE_UNAVAILABLE/iu);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("conference terminal counts reconcile only schema-valid round completion receipts", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-round-count-schema-"));
  try {
    await fs.writeFile(
      path.join(tempRoot, "conference.md"),
      "## Goal\nRound receipt validation\n- **Count:** 1\n- **Max rounds:** 1\n- **Direction:** maximize\n"
    );
    await fs.writeFile(
      path.join(tempRoot, "conference_results.tsv"),
      "round\tresearcher\titeration\tmetric_value\n1\tA\t1\t1\n"
    );
    await fs.writeFile(path.join(tempRoot, "synthesis.md"), "# Synthesis\n");
    await fs.writeFile(path.join(tempRoot, "final_report.md"), "# Final report\n");
    await fs.writeFile(
      path.join(tempRoot, "conference_events.jsonl"),
      '{"event":"round.completed"\n' +
      '{"event":"conference.completed","timestamp":"2026-07-29T01:00:00Z","terminal_verdict":"TARGET_MET","payload":{"synthesis_path":"synthesis.md","final_report_path":"final_report.md","total_iterations":1,"total_rounds":1,"researcher_count":1}}\n'
    );
    const result = spawnSync("bash", ["skills/autoconference/scripts/check_conference.sh", tempRoot], {
      cwd: process.cwd(), encoding: "utf8"
    });
    assert.equal(result.status, 4, result.stderr);
    assert.match(result.stdout, /Status:\s+terminal invalid/iu);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("terminal completion requires finite iteration-zero baselines and counts only experiments", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-baseline-count-contract-"));
  const researchHeader = "iteration\tmetric_value\tdelta\tdelta_pct\tstatus\tdescription\tevaluator_source\ttimestamp\n";
  const researchTerminal = '{"event":"autoresearch.completed","timestamp":"2026-07-29T01:00:00Z","terminal_reason":"TARGET_MET","final_report_path":"final_report.md","results_path":"autoresearch-results.tsv","total_iterations":1}\n';
  const conferenceHeader = "round\tresearcher\titeration\tmetric_value\tdelta\tdelta_pct\tstatus\tdescription\tevaluator_source\tpeer_review_verdict\ttimestamp\n";
  const conferenceEvents = '{"event":"round.completed","timestamp":"2026-07-29T00:30:00Z","payload":{"round":1,"best_metric":1,"best_researcher":"A","converged":false}}\n'
    + '{"event":"conference.completed","timestamp":"2026-07-29T01:00:00Z","terminal_verdict":"TARGET_MET","payload":{"synthesis_path":"synthesis.md","final_report_path":"final_report.md","total_iterations":1,"total_rounds":1,"researcher_count":1}}\n';
  const twoResearcherEvents = '{"event":"round.completed","timestamp":"2026-07-29T00:30:00Z","payload":{"round":1,"best_metric":1,"best_researcher":"A","converged":false}}\n'
    + '{"event":"conference.completed","timestamp":"2026-07-29T01:00:00Z","terminal_verdict":"TARGET_MET","payload":{"synthesis_path":"synthesis.md","final_report_path":"final_report.md","total_iterations":1,"total_rounds":1,"researcher_count":2}}\n';
  const runStatus = (script, root) => spawnSync("bash", [script, root], { cwd: process.cwd(), encoding: "utf8" });
  const assertState = (result, state, code) => {
    assert.equal(result.status, code, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`Status:\\s+${state}`, "iu"));
  };
  try {
    const researchCases = [
      ["baseline plus one experiment", "0\t0\t-\t-\tbaseline\tFinite baseline\tmechanical\t2026-07-29T00:00:00Z\n1\t1\t1\t100%\tkept\tExperiment\tmechanical\t2026-07-29T00:05:00Z\n", "COMPLETE", 0],
      ["missing baseline", "1\t1\t1\t100%\tkept\tExperiment\tmechanical\t2026-07-29T00:05:00Z\n", "terminal invalid", 4],
      ["placeholder baseline", "0\tTBD\t-\t-\tbaseline\tInitial state\tagent\t2026-07-29\n1\t1\t1\t100%\tkept\tExperiment\tmechanical\t2026-07-29T00:05:00Z\n", "terminal invalid", 4]
    ];
    for (const [label, rows, state, code] of researchCases) {
      await t.test(`autoresearch ${label}`, async () => {
        const root = path.join(tempRoot, `research-${label.replaceAll(" ", "-")}`);
        await fs.mkdir(root);
        await fs.writeFile(path.join(root, "research.md"), "## Goal\nBaseline contract\n- **Max iterations:** 2\n- **Direction:** maximize\n");
        await fs.writeFile(path.join(root, "autoresearch-results.tsv"), `${researchHeader}${rows}`);
        await fs.writeFile(path.join(root, "autoresearch_events.jsonl"), researchTerminal);
        await fs.writeFile(path.join(root, "final_report.md"), "# Final\n");
        assertState(runStatus("skills/autoresearch/scripts/check_progress.sh", root), state, code);
      });
    }

    const conferenceCases = [
      ["baseline plus one experiment", "1\tA\t0\t0\t-\t-\tbaseline\tFinite baseline\tscript:test\t-\t2026-07-29T00:00:00Z\n1\tA\t1\t1\t1\t100%\tkept\tExperiment\tscript:test\tvalidated\t2026-07-29T00:05:00Z\n", "COMPLETE", 0, 1, conferenceEvents],
      ["missing baseline", "1\tA\t1\t1\t1\t100%\tkept\tExperiment\tscript:test\tvalidated\t2026-07-29T00:05:00Z\n", "terminal invalid", 4, 1, conferenceEvents],
      ["placeholder baseline", "1\tA\t0\tTBD\t-\t-\tbaseline\tPlaceholder\tscript:test\t-\t2026-07-29T00:00:00Z\n1\tA\t1\t1\t1\t100%\tkept\tExperiment\tscript:test\tvalidated\t2026-07-29T00:05:00Z\n", "terminal invalid", 4, 1, conferenceEvents],
      ["missing configured researcher baseline", "1\tA\t0\t0\t-\t-\tbaseline\tFinite baseline\tscript:test\t-\t2026-07-29T00:00:00Z\n1\tA\t1\t1\t1\t100%\tkept\tExperiment\tscript:test\tvalidated\t2026-07-29T00:05:00Z\n", "terminal invalid", 4, 2, twoResearcherEvents]
    ];
    for (const [label, rows, state, code, researcherCount, events] of conferenceCases) {
      await t.test(`autoconference ${label}`, async () => {
        const root = path.join(tempRoot, `conference-${label.replaceAll(" ", "-")}`);
        await fs.mkdir(root);
        await fs.writeFile(path.join(root, "conference.md"), `## Goal\nBaseline contract\n- **Count:** ${researcherCount}\n- **Max rounds:** 1\n- **Direction:** maximize\n`);
        await fs.writeFile(path.join(root, "conference_results.tsv"), `${conferenceHeader}${rows}`);
        await fs.writeFile(path.join(root, "conference_events.jsonl"), events);
        await fs.writeFile(path.join(root, "synthesis.md"), "# Synthesis\n");
        await fs.writeFile(path.join(root, "final_report.md"), "# Final\n");
        assertState(runStatus("skills/autoconference/scripts/check_conference.sh", root), state, code);
      });
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("status helpers reject invalid TSV rows and unreconciled round receipts before COMPLETE", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-evidence-schema-"));
  const researchHeader = "iteration\tmetric_value\tdelta\tdelta_pct\tstatus\tdescription\tevaluator_source\ttimestamp\n";
  const conferenceHeader = "round\tresearcher\titeration\tmetric_value\tdelta\tdelta_pct\tstatus\tdescription\tevaluator_source\tpeer_review_verdict\ttimestamp\n";
  const runStatus = (script, root) => spawnSync("bash", [script, root], { cwd: process.cwd(), encoding: "utf8" });
  const assertInvalid = (result, label) => {
    assert.equal(result.status, 4, `${label}: ${result.stderr}\n${result.stdout}`);
    assert.match(result.stdout, /Status:\s+(?:evidence|terminal) invalid/iu, label);
  };
  try {
    const validResearchBaseline = "0\t0\t-\t-\tbaseline\tFinite baseline\tmechanical\t2026-07-29T00:00:00Z\n";
    const researchCases = [
      ["non-numeric metric", `${validResearchBaseline}1\tnot-a-number\t1\t100%\tkept\tresult\tagent\t2026-07-29T00:05:00Z`],
      ["non-decimal metric", `${validResearchBaseline}1\t0x10\t1\t100%\tkept\tresult\tagent\t2026-07-29T00:05:00Z`],
      ["unknown status", `${validResearchBaseline}1\t1\t1\t100%\taccepted\tresult\tagent\t2026-07-29T00:05:00Z`],
      ["unknown evaluator", `${validResearchBaseline}1\t1\t1\t100%\tkept\tsource\tscript:test\t2026-07-29T00:05:00Z`],
      ["invalid timestamp", `${validResearchBaseline}1\t1\t1\t100%\tkept\tresult\tagent\t2026-07-29`],
      ["extra column", `${validResearchBaseline}1\t1\t1\t100%\tkept\tresult\tagent\t2026-07-29T00:05:00Z\textra`],
      ["duplicate scaffold placeholders", "0\tTBD\t-\t-\tbaseline\tInitial state\tagent\t2026-07-29\n0\tTBD\t-\t-\tbaseline\tInitial state\tagent\t2026-07-29\n1\t1\t1\t100%\tkept\tresult\tagent\t2026-07-29T00:05:00Z"],
      ["placeholder collides with real row zero", "0\tTBD\t-\t-\tbaseline\tInitial state\tagent\t2026-07-29\n0\t1\t-\t-\tbaseline\tresult\tagent\t2026-07-29T00:05:00Z"]
    ];
    for (const [label, row] of researchCases) {
      await t.test(`autoresearch ${label}`, async () => {
        const root = path.join(tempRoot, `research-${label.replaceAll(" ", "-")}`);
        await fs.mkdir(root);
        await fs.writeFile(path.join(root, "research.md"), "## Goal\nEvidence\n- **Max iterations:** 2\n- **Direction:** maximize\n");
        await fs.writeFile(path.join(root, "autoresearch-results.tsv"), `${researchHeader}${row}\n`);
        await fs.writeFile(path.join(root, "final_report.md"), "# Final\n");
        await fs.writeFile(path.join(root, "autoresearch_events.jsonl"), '{"event":"autoresearch.completed","timestamp":"2026-07-29T01:00:00Z","terminal_reason":"TARGET_MET","final_report_path":"final_report.md","results_path":"autoresearch-results.tsv","total_iterations":1}\n');
        assertInvalid(runStatus("skills/autoresearch/scripts/check_progress.sh", root), label);
      });
    }

    const validConferenceBaseline = "1\tA\t0\t0\t-\t-\tbaseline\tFinite baseline\tscript:test\t-\t2026-07-29T00:00:00Z\n";
    const validConferenceExperiment = "1\tA\t1\t1\t1\t100%\tkept\tExperiment\tscript:test\tvalidated\t2026-07-29T00:05:00Z";
    const conferenceCases = [
      ["unknown researcher", `${validConferenceBaseline}1\tB\t1\t1\t1\t100%\tkept\tresult\tscript:test\tvalidated\t2026-07-29T00:05:00Z`, { round: 1, best_metric: 1, best_researcher: "B", converged: false }],
      ["round above configured maximum", `${validConferenceBaseline}2\tA\t1\t1\t1\t100%\tkept\tresult\tscript:test\tvalidated\t2026-07-29T00:05:00Z`, { round: 2, best_metric: 1, best_researcher: "A", converged: false }],
      ["non-numeric metric", `${validConferenceBaseline}1\tA\t1\tNaN\t1\t100%\tkept\tresult\tscript:test\tvalidated\t2026-07-29T00:05:00Z`, { round: 1, best_metric: 1, best_researcher: "A", converged: false }],
      ["non-decimal metric", `${validConferenceBaseline}1\tA\t1\t0x10\t1\t100%\tkept\tresult\tscript:test\tvalidated\t2026-07-29T00:05:00Z`, { round: 1, best_metric: 16, best_researcher: "A", converged: false }],
      ["invalid receipt payload", `${validConferenceBaseline}${validConferenceExperiment}`, { round: 1 }],
      ["receipt metric mismatch", `${validConferenceBaseline}${validConferenceExperiment}`, { round: 1, best_metric: 2, best_researcher: "A", converged: false }]
    ];
    for (const [label, row, receipt] of conferenceCases) {
      await t.test(`autoconference ${label}`, async () => {
        const root = path.join(tempRoot, `conference-${label.replaceAll(" ", "-")}`);
        await fs.mkdir(root);
        await fs.writeFile(path.join(root, "conference.md"), "## Goal\nEvidence\n- **Count:** 1\n- **Max rounds:** 1\n- **Direction:** maximize\n");
        await fs.writeFile(path.join(root, "conference_results.tsv"), `${conferenceHeader}${row}\n`);
        await fs.writeFile(path.join(root, "synthesis.md"), "# Synthesis\n");
        await fs.writeFile(path.join(root, "final_report.md"), "# Final\n");
        await fs.writeFile(path.join(root, "conference_events.jsonl"), `${JSON.stringify({ event: "round.completed", timestamp: "2026-07-29T00:30:00Z", payload: receipt })}\n${JSON.stringify({ event: "conference.completed", timestamp: "2026-07-29T01:00:00Z", terminal_verdict: "TARGET_MET", payload: { synthesis_path: "synthesis.md", final_report_path: "final_report.md", total_iterations: 1, total_rounds: 1, researcher_count: 1 } })}\n`);
        assertInvalid(runStatus("skills/autoconference/scripts/check_conference.sh", root), label);
      });
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("plan helper reinitialization removes known stale run artifacts and preserves user-owned files", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-family-reinitialize-"));
  const run = (script, args, options = {}) => spawnSync("python3", [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options
  });
  const missing = async (filePath) => assert.rejects(fs.stat(filePath), (error) => error?.code === "ENOENT", filePath);
  try {
    const research = path.join(tempRoot, "research");
    const researchArgs = ["--goal", "Reinitialize research", "--metric", "score", "--direction", "maximize", "--target", "1", "--output", research];
    assert.equal(run("skills/autoresearch/scripts/init_research.py", researchArgs).status, 0);
    await fs.writeFile(path.join(research, "final_report.md"), "stale completion");
    await fs.writeFile(path.join(research, "results.png"), "stale result");
    await fs.writeFile(path.join(research, ".autoresearch-loop.pid"), "999999");
    await fs.writeFile(path.join(research, "user-notes.md"), "preserve me");
    const researchReinit = run("skills/autoresearch/scripts/init_research.py", researchArgs, { input: "y\n" });
    assert.equal(researchReinit.status, 0, researchReinit.stderr);
    assert.match(researchReinit.stdout, /removed stale run artifacts/iu);
    for (const name of ["final_report.md", "results.png", ".autoresearch-loop.pid"]) await missing(path.join(research, name));
    assert.equal(await fs.readFile(path.join(research, "user-notes.md"), "utf8"), "preserve me");
    const researchStatus = spawnSync("bash", ["skills/autoresearch/scripts/check_progress.sh", research], { cwd: process.cwd(), encoding: "utf8" });
    assert.match(researchStatus.stdout, /Status:\s+incomplete scaffold/iu);
    assert.doesNotMatch(researchStatus.stdout, /COMPLETE/u);

    const conference = path.join(tempRoot, "conference");
    const conferenceArgs = ["--goal", "Reinitialize conference", "--metric", "score", "--direction", "maximize", "--target", "1", "--researchers", "3", "--output", conference];
    assert.equal(run("skills/autoconference/scripts/init_conference.py", conferenceArgs).status, 0);
    for (const [name, content] of [
      ["synthesis.md", "stale synthesis"],
      ["final_report.md", "stale completion"],
      ["poster_session_round_2.md", "stale poster"],
      ["peer_review_round_2.md", "stale review"],
      [".autoconference-loop.pid", "999999"]
    ]) await fs.writeFile(path.join(conference, name), content);
    await fs.writeFile(path.join(conference, "user-notes.md"), "preserve me");
    const conferenceReinit = run("skills/autoconference/scripts/init_conference.py", [
      "--goal", "Reinitialize conference", "--metric", "score", "--direction", "maximize", "--target", "1",
      "--researchers", "1", "--output", conference, "--force"
    ]);
    assert.equal(conferenceReinit.status, 0, conferenceReinit.stderr);
    assert.match(conferenceReinit.stdout, /removed stale run artifacts/iu);
    for (const name of [
      "synthesis.md", "final_report.md", "poster_session_round_2.md", "peer_review_round_2.md",
      ".autoconference-loop.pid", "researcher_B_log.md", "researcher_B_results.tsv", "researcher_C_log.md", "researcher_C_results.tsv"
    ]) await missing(path.join(conference, name));
    assert.equal(await fs.readFile(path.join(conference, "user-notes.md"), "utf8"), "preserve me");
    const conferenceStatus = spawnSync("bash", ["skills/autoconference/scripts/check_conference.sh", conference], { cwd: process.cwd(), encoding: "utf8" });
    assert.match(conferenceStatus.stdout, /Status:\s+incomplete scaffold/iu);
    assert.doesNotMatch(conferenceStatus.stdout, /COMPLETE/u);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("initializer approval surfaces describe managed reinitialization without claiming directory overwrite", async () => {
  const researchSource = await fs.readFile("skills/autoresearch/scripts/init_research.py", "utf8");
  assert.match(researchSource, /Reinitialize managed scaffold files while preserving regular user files\? \[y\/N\]/u);
  assert.doesNotMatch(researchSource, /Continue and add files\?/u);

  const conferenceHelp = spawnSync("python3", ["skills/autoconference/scripts/init_conference.py", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(conferenceHelp.status, 0, conferenceHelp.stderr);
  assert.match(conferenceHelp.stdout, /Reinitialize managed scaffold files while preserving\s+regular user files/iu);
  assert.doesNotMatch(conferenceHelp.stdout, /Overwrite existing output directory/iu);
});

test("plan helper stale cleanup preflights unsafe artifact types before removing anything", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-family-cleanup-preflight-"));
  const run = (script, args, options = {}) => spawnSync("python3", [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options
  });
  try {
    const research = path.join(tempRoot, "research");
    const researchArgs = ["--goal", "Preflight research", "--metric", "score", "--direction", "maximize", "--output", research];
    assert.equal(run("skills/autoresearch/scripts/init_research.py", researchArgs).status, 0);
    await fs.writeFile(path.join(research, "final_report.md"), "must survive failed cleanup");
    await fs.mkdir(path.join(research, "results.png"));
    const researchReinit = run("skills/autoresearch/scripts/init_research.py", researchArgs, { input: "y\n" });
    assert.notEqual(researchReinit.status, 0);
    assert.match(`${researchReinit.stdout}\n${researchReinit.stderr}`, /refusing to remove non-file run artifact/iu);
    assert.equal(await fs.readFile(path.join(research, "final_report.md"), "utf8"), "must survive failed cleanup");

    const conference = path.join(tempRoot, "conference");
    const conferenceArgs = ["--goal", "Preflight conference", "--metric", "score", "--direction", "maximize", "--target", "1", "--output", conference];
    assert.equal(run("skills/autoconference/scripts/init_conference.py", conferenceArgs).status, 0);
    await fs.writeFile(path.join(conference, "final_report.md"), "must survive failed cleanup");
    await fs.mkdir(path.join(conference, "synthesis.md"));
    const conferenceReinit = run("skills/autoconference/scripts/init_conference.py", [...conferenceArgs, "--force"]);
    assert.notEqual(conferenceReinit.status, 0);
    assert.match(`${conferenceReinit.stdout}\n${conferenceReinit.stderr}`, /refusing to remove non-file run artifact/iu);
    assert.equal(await fs.readFile(path.join(conference, "final_report.md"), "utf8"), "must survive failed cleanup");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("plan initializers reject symlink roots, symlink ancestors, and unsafe managed or stale destinations", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-family-init-trust-"));
  const fixtures = [
    {
      family: "research",
      script: "skills/autoresearch/scripts/init_research.py",
      args: ["--goal", "Protect research output", "--metric", "score", "--direction", "maximize", "--target", "1"],
      approve: { input: "y\n" },
      managed: "research.md",
      stale: "final_report.md"
    },
    {
      family: "conference",
      script: "skills/autoconference/scripts/init_conference.py",
      args: ["--goal", "Protect conference output", "--metric", "score", "--direction", "maximize", "--target", "1", "--researchers", "1"],
      approve: {},
      managed: "conference.md",
      stale: "synthesis.md"
    }
  ];
  const run = (fixture, output, options = {}) => spawnSync("python3", [
    fixture.script,
    ...fixture.args,
    "--output", output,
    ...(fixture.family === "conference" && options.force !== false ? ["--force"] : [])
  ], { cwd: process.cwd(), encoding: "utf8", ...fixture.approve, ...options });
  try {
    for (const fixture of fixtures) {
      const externalRoot = path.join(tempRoot, `${fixture.family}-external-root`);
      const linkedRoot = path.join(tempRoot, `${fixture.family}-linked-root`);
      await fs.mkdir(externalRoot);
      await fs.writeFile(path.join(externalRoot, "sentinel.txt"), "outside stays unchanged");
      await fs.symlink(externalRoot, linkedRoot, "dir");
      const rootResult = run(fixture, linkedRoot);
      assert.notEqual(rootResult.status, 0, `${fixture.family}: symlink output root was accepted`);
      assert.equal(await fs.readFile(path.join(externalRoot, "sentinel.txt"), "utf8"), "outside stays unchanged");
      assert.equal((await fs.readdir(externalRoot)).length, 1);

      const externalParent = path.join(tempRoot, `${fixture.family}-external-parent`);
      const linkedParent = path.join(tempRoot, `${fixture.family}-linked-parent`);
      await fs.mkdir(externalParent);
      await fs.symlink(externalParent, linkedParent, "dir");
      const ancestorResult = run(fixture, path.join(linkedParent, "run"));
      assert.notEqual(ancestorResult.status, 0, `${fixture.family}: symlink output ancestor was accepted`);
      assert.deepEqual(await fs.readdir(externalParent), []);

      const managedOutput = path.join(tempRoot, `${fixture.family}-managed`);
      assert.equal(run(fixture, managedOutput, { force: false }).status, 0);
      const externalManaged = path.join(tempRoot, `${fixture.family}-managed-external.txt`);
      await fs.writeFile(externalManaged, "external managed sentinel");
      await fs.rm(path.join(managedOutput, fixture.managed));
      await fs.symlink(externalManaged, path.join(managedOutput, fixture.managed));
      const managedResult = run(fixture, managedOutput);
      assert.notEqual(managedResult.status, 0, `${fixture.family}: symlink managed destination was accepted`);
      assert.equal(await fs.readFile(externalManaged, "utf8"), "external managed sentinel");

      const staleOutput = path.join(tempRoot, `${fixture.family}-stale`);
      assert.equal(run(fixture, staleOutput, { force: false }).status, 0);
      const externalStale = path.join(tempRoot, `${fixture.family}-stale-external.txt`);
      await fs.writeFile(externalStale, "external stale sentinel");
      await fs.symlink(externalStale, path.join(staleOutput, fixture.stale));
      const staleResult = run(fixture, staleOutput);
      assert.notEqual(staleResult.status, 0, `${fixture.family}: symlink stale artifact was accepted`);
      assert.equal(await fs.readFile(externalStale, "utf8"), "external stale sentinel");

      const specialOutput = path.join(tempRoot, `${fixture.family}-special`);
      assert.equal(run(fixture, specialOutput, { force: false }).status, 0);
      const fifo = spawnSync("mkfifo", [path.join(specialOutput, fixture.stale)], { encoding: "utf8" });
      assert.equal(fifo.status, 0, fifo.stderr);
      const specialResult = run(fixture, specialOutput);
      assert.notEqual(specialResult.status, 0, `${fixture.family}: special stale artifact was accepted`);
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("atomic scaffold publication rolls back an injected publish failure without partial destination writes", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-family-atomic-publish-"));
  const probe = String.raw`
import importlib.util
import os
import pathlib
import sys
from unittest import mock

script = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("initializer_under_test", str(script))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
output.mkdir()
(output / "managed.txt").write_text("old managed")
(output / "user.txt").write_text("preserve user")
real_replace = module.os.replace

def injected_replace(source, destination):
    source_path = pathlib.Path(source)
    destination_path = pathlib.Path(destination)
    if destination_path == output and ".stage-" in source_path.name:
        raise OSError("injected publish failure")
    return real_replace(source, destination)

def populate(stage):
    (stage / "managed.txt").write_text("new managed")

try:
    with mock.patch.object(module.os, "replace", side_effect=injected_replace):
        module.atomic_publish(output, populate)
except OSError as error:
    assert "injected publish failure" in str(error)
else:
    raise AssertionError("injected publication unexpectedly succeeded")

assert (output / "managed.txt").read_text() == "old managed"
assert (output / "user.txt").read_text() == "preserve user"
assert not any(".stage-" in item.name or ".backup-" in item.name for item in output.parent.iterdir())
`;
  try {
    for (const script of [
      "skills/autoresearch/scripts/init_research.py",
      "skills/autoconference/scripts/init_conference.py"
    ]) {
      const output = path.join(tempRoot, path.basename(path.dirname(path.dirname(script))));
      const result = spawnSync("python3", ["-c", probe, path.resolve(script), output], {
        cwd: process.cwd(),
        encoding: "utf8"
      });
      assert.equal(result.status, 0, `${script}\n${result.stdout}\n${result.stderr}`);
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow-family recursive relative references and runtime inventory resolve", async () => {
  const requiredAssets = [
    "skills/autoresearch/assets/results_template.tsv",
    "skills/autoresearch/scripts/init_research.py",
    "skills/autoresearch/scripts/check_progress.sh",
    "skills/autoresearch/scripts/style_presets.py",
    "skills/autoconference/assets/conference_template.md",
    "skills/autoconference/scripts/init_conference.py",
    "skills/autoconference/scripts/check_conference.sh",
    "skills/autoconference/scripts/style_presets.py"
  ];
  for (const asset of requiredAssets) assert.equal((await fs.stat(asset)).isFile(), true, asset);

  for (const helper of [
    "skills/autoresearch/scripts/init_research.py",
    "skills/autoconference/scripts/init_conference.py"
  ]) {
    const source = await fs.readFile(helper, "utf8");
    assert.doesNotMatch(source, /scripts\/(?:autoresearch|autoconference)-loop\.sh/iu, helper);
    assert.match(source, /explicit \/start-work/iu, helper);
  }

  for (const family of ["autoresearch", "autoconference"]) {
    const skillRoot = path.resolve("skills", family);
    for (const filePath of await markdownFiles(skillRoot)) {
      const markdown = await fs.readFile(filePath, "utf8");
      assert.doesNotMatch(markdown, /(?:autoresearch|autoconference)-loop\.sh/iu, filePath);
      assert.doesNotMatch(markdown, /\/(?:autoresearch|autoconference):[a-z*<>-]+/iu, filePath);
      for (const match of markdown.matchAll(/(?:^|[\s`("'=])((?:(?:\.\.\/)+)?(?:assets|scripts|references|modes|skills)\/[A-Za-z0-9._/-]+\.(?:md|py|sh|tsv|json))/gmu)) {
        const documented = match[1];
        const resolved = documented.startsWith("skills/")
          ? path.resolve(documented)
          : documented.startsWith("../")
          ? path.resolve(path.dirname(filePath), documented)
          : path.resolve(skillRoot, documented);
        await assert.doesNotReject(fs.access(resolved), `${path.relative(skillRoot, filePath)} -> ${documented}`);
      }
      for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
        const target = match[1].split("#", 1)[0];
        if (target === "" || /^[a-z]+:/iu.test(target)) continue;
        await assert.doesNotReject(
          fs.access(path.resolve(path.dirname(filePath), decodeURIComponent(target))),
          `${path.relative(skillRoot, filePath)} -> ${target}`
        );
      }
    }
  }
});

test("conference blocks without real task capability and keeps depth-one children packet-only", async () => {
  const text = await familyText("autoconference");
  assert.match(text, /BLOCKED_MULTI_AGENT_UNAVAILABLE/u);
  assert.match(text, /verify.*task capability/is);
  assert.match(text, /depth-one/iu);
  assert.match(text, /packet-only/iu);
  assert.match(text, /required.*autoresearch/is);
  assert.doesNotMatch(text, /(?:degrade|fall back|continue)\s+(?:to|with)\s+sequential/i);
  assert.doesNotMatch(text, /nohup|tmux|tail -f/u);
});

test("autoresearch handles cancel, resume, stale state, and no-daemon execution", async () => {
  const text = await familyText("autoresearch");
  assert.match(text, /cancel/iu);
  assert.match(text, /resume/iu);
  assert.match(text, /stale state/iu);
  assert.match(text, /bounded/iu);
  assert.match(text, /no daemon/iu);
  assert.doesNotMatch(text, /nohup|tmux/u);
});

test("family runtime modes stop before publication and deployment commands", async () => {
  const text = [await familyText("autoresearch"), await familyText("autoconference")].join("\n");
  const forbiddenPublicationRoutes = [
    ["npm", "publish"].join(" "),
    "twine upload",
    "docker push",
    "gh release create",
    "Phase 8:\\s*Publish"
  ].join("|");
  assert.doesNotMatch(text, new RegExp(forbiddenPublicationRoutes, "iu"));
  assert.match(text, /human-only|human handoff/iu);
});

test("wikify connects inert local research review to LitOpenCode continuity surfaces", async () => {
  const text = await familyText("wikify");
  for (const phrase of ["litresearch", "inert", "review-work", "lit-recap", "lit-handoff"]) {
    assert.match(text, new RegExp(phrase, "i"));
  }
  for (const asset of [
    "home-template.md", "maintenance-report-template.md", "paper-source-note-template.md",
    "source-note-template.md", "wiki-rules-template.md"
  ]) await fs.stat(path.join("skills", "wikify", "assets", asset));
});

test("workflow families keep general commands non-mutating while Wikify permits only review-needed local capture", async () => {
  for (const family of ["autoresearch", "autoconference"]) {
    const prompt = workflowFamilyPrompt(family);
    assert.match(prompt, /never authorizes general workflow mutation or execution/iu);
    assert.doesNotMatch(prompt, /review-needed.*claims\.jsonl/iu);
  }

  const wikifyPrompt = workflowFamilyPrompt("wikify-ingest");
  assert.match(wikifyPrompt, /narrow product-local exception/iu);
  assert.match(wikifyPrompt, /review-needed/iu);
  assert.match(wikifyPrompt, /\.litopencode\/knowledge\/claims\.jsonl/iu);
  assert.match(wikifyPrompt, /does not.*general.*mutation/isu);

  const wikify = await familyText("wikify");
  assert.match(wikify, /narrow product-local exception/iu);
  assert.match(wikify, /review-needed/iu);
  assert.match(wikify, /claims\.jsonl/iu);
  const ingest = await fs.readFile("skills/wikify/modes/ingest.md", "utf8");
  assert.match(ingest, /validated.*review-needed/isu);
  assert.match(ingest, /does not.*wiki files/isu);
  const query = await fs.readFile("skills/wikify/modes/query.md", "utf8");
  assert.match(query, /remains read-only/iu);
  const init = await fs.readFile("skills/wikify/modes/init.md", "utf8");
  assert.match(init, /remain(?:s)? read-only/iu);
});

test("family enrollment keeps research families static while Wikify owns its bounded local runtime", async () => {
  const featureIds = litOpenCodeFeatures.map((feature) => feature.id);
  assert.ok(featureIds.includes("autoresearch"));
  assert.ok(featureIds.includes("autoconference"));
  assert.ok(featureIds.includes("wikify"));

  const staticFamilySource = [
    await fs.readFile("src/agents/registry.ts", "utf8"),
    await fs.readFile("src/config.ts", "utf8")
  ].join("\n");
  assert.doesNotMatch(staticFamilySource, /(?:autoresearch|autoconference).*(?:tool\s*:|MCP|mode:\s*["']subagent)/iu);
  const wikifyFeature = litOpenCodeFeatures.find((feature) => feature.id === "wikify");
  assert.ok(wikifyFeature);
  assert.ok(wikifyFeature.bindings.some((binding) => binding.kind === "tool" && binding.id === "wikify"));
  assert.ok(wikifyFeature.bindings.some((binding) => binding.kind === "hook" && binding.id === "tool.execute.after"));
  assert.ok(wikifyFeature.bindings.some((binding) => binding.kind === "config" && binding.id === "knowledge.capture"));
  const toolsSource = await fs.readFile("src/tools.ts", "utf8");
  assert.match(toolsSource, /export const wikifyTool/u);
  assert.doesNotMatch(toolsSource, /\b(?:autoresearch|autoconference)\b/iu);
  assert.doesNotMatch(await fs.readFile("src/knowledge.ts", "utf8"), /\b(?:fetch|watch|daemon|embedding|vector database)\s*\(/iu);

  const toolIds = Object.keys(litOpenCodeTools);
  assert.equal(toolIds.includes("wikify"), true);
  assert.equal(toolIds.some((id) => id.startsWith("autoresearch")), false);
  assert.equal(toolIds.some((id) => id.startsWith("autoconference")), false);
  assert.doesNotMatch(toolsSource, /(?:autoresearch|autoconference)[_-].*tool/iu);

  const frontendFeature = litOpenCodeFeatures.find((feature) => feature.id === "frontend-ui-ux");
  assert.ok(frontendFeature);
  assert.doesNotMatch(JSON.stringify(frontendFeature), /_canonical-corpus.*(?:execute|fetch|agent|tool|hook|MCP)/iu);
});

test("README is current-behavior documentation, not cumulative prepared-release chronology", async () => {
  const readme = await fs.readFile("README.md", "utf8");
  const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.doesNotMatch(readme, /\bprepared(?: release| tree| as)\b/iu);
  assert.doesNotMatch(readme, /^v0\.1\.\d+ /gmu);
  assert.doesNotMatch(readme, /\bv0\.1\.8\b/iu);
  assert.doesNotMatch(readme, /\b(?:530 tests|529 pass|283-entry|73-asset|17\/17|27\/27)\b/u);
  assert.ok(readme.includes(`[Changelog](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@${version}/CHANGELOG.md)`));
  assert.match(readme, /lit-plan.*start-work.*review-work/is);

  const reference = await fs.readFile("docs/reference.md", "utf8");
  const uiHelpers = reference.match(/### UI and Visual QA managed helpers([\s\S]*?)### Managed workflow families/u)?.[1] ?? "";
  const workflowFamilies = reference.match(/### Managed workflow families([\s\S]*?)## Release Readiness/u)?.[1] ?? "";
  assert.match(uiHelpers, /frontend-ui-ux/iu);
  assert.match(uiHelpers, /visual-qa/iu);
  assert.match(uiHelpers, /Node ESM helpers/iu);
  assert.doesNotMatch(uiHelpers, /autoresearch|autoconference|wikify/iu);
  for (const family of ["autoresearch", "autoconference", "wikify"]) assert.match(workflowFamilies, new RegExp(family, "iu"));
  assert.doesNotMatch(workflowFamilies, /Node ESM helpers|PNG|terminal validation|every helper import/iu);

  const npmignore = await fs.readFile(".npmignore", "utf8");
  assert.match(npmignore, /^test\/$/mu);
  assert.match(npmignore, /^tests\/$/mu);
  assert.match(npmignore, /^!vendor\/scientific-visualization\/tests\/$/mu);
});
