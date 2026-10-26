import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createChatMessageActivationHook, detectChatActivationMode } from "../src/activation.ts";
import { promptForChatActivationMode } from "../src/activation-routing.ts";
import { createCommandActivationHook, findLitOpenCodeCommand, litOpenCodeCommands } from "../src/commands.ts";
import { expectedManagedSkillFiles, managedSkillDiscoveryDescription } from "../src/cli/managed-skill-assets.ts";
import { findLitOpenCodeRuntimeSkill, litOpenCodeFeatures } from "../src/index.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";
import {
  buildImplementerBrief,
  checkRun,
  decideLicence,
  detectLicence,
  findOverlap,
  fxtwitterToMarkdown,
  parseXStatusUrl,
  planGrammarIssues
} from "../skills/lit-hijack/scripts/hijack.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const skillDir = path.join(root, "skills", "lit-hijack");
const cliPath = path.join(skillDir, "scripts", "hijack.mjs");
const skillPath = (id, ...rest) => path.join("skills", id, ...rest);
const read = (...parts) => fs.readFile(path.join(...parts), "utf8");

let temp;
let counter = 0;

before(() => {
  temp = mkdtempSync(path.join(os.tmpdir(), "litopencode-hijack-"));
});

after(() => rmSync(temp, { recursive: true, force: true }));

const freshDir = (name) => {
  const dir = path.join(temp, `${name}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const cli = (args, cwd = temp) =>
  spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: path.join(temp, "home"), NO_COLOR: "1" } });

async function chatText(text, sessionID = "session-hijack") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-hijack-chat-"));
  try {
    const output = {
      message: { id: "msg_1", sessionID, role: "user" },
      parts: [{ id: "prt_1", sessionID, messageID: "msg_1", type: "text", text }]
    };
    await createChatMessageActivationHook(dir)({ sessionID, messageID: "msg_1", agent: "lit-loop" }, output);
    return output.parts.slice(1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Own-written sample prose. Nothing here is taken from a real post.
const SOURCE_PROSE = [
  "A careful studio writes the brief before any frame exists, so the model cannot fill gaps with its favourite defaults.",
  "The brief names the one thing a viewer must remember and the outcome that would make the film unacceptable to ship."
].join(" ");
const PARAPHRASE = "Pin the takeaway and the rejection condition in a short production note first; only then may rendering start.";

describe("lit-hijack enrollment", () => {
  it("is a runtime skill with a feature, a command, a managed tree and a discovery description", () => {
    const skill = findLitOpenCodeRuntimeSkill("lit-hijack");
    assert.ok(skill, "missing runtime skill");
    assert.deepEqual(skill.featureIds, ["lit-hijack"]);
    const feature = litOpenCodeFeatures.find((entry) => entry.id === "lit-hijack");
    assert.ok(feature, "missing feature");
    assert.ok(feature.bindings.some((binding) => binding.kind === "command" && binding.id === "lit-hijack"));
    assert.ok(feature.bindings.some((binding) => binding.kind === "config" && binding.id === "skills/lit-hijack/SKILL.md"));
    assert.ok(feature.bindings.some((binding) => binding.kind === "agent"), "names the task-tool implementer lane");
    const files = expectedManagedSkillFiles("lit-hijack");
    for (const file of [
      "SKILL.md",
      "scripts/hijack.mjs",
      "references/capture-and-provenance.md",
      "references/distil-and-licence.md",
      "references/gap-and-port-design.md",
      "references/clean-room-build.md",
      "references/parity-and-report.md"
    ]) assert.ok(files.includes(file), `${file} is pinned and installed`);
    assert.match(managedSkillDiscoveryDescription("lit-hijack"), /hijack/iu);
    const command = findLitOpenCodeCommand("lit-hijack");
    assert.equal(command?.slash, "/lit-hijack");
    assert.ok(litOpenCodeCommands.some((entry) => entry.id === "lit-hijack"));
  });

  it("lists the command, the skill and the route in the docs a user reads, in both languages", async () => {
    for (const page of ["docs/skills.md", "docs/skills-Ko-KR.md", "docs/reference.md", "docs/reference-Ko-KR.md"]) {
      assert.match(await read(page), /\/lit-hijack/u, `${page} lists /lit-hijack`);
    }
    assert.match(await read("docs/reference.md"), /<code>lit-hijack<\/code>/u);
    assert.match(await read("docs/skills-Ko-KR.md"), /lit 하이재킹/u);
    assert.match(await read("CHANGELOG.md"), /`lit-hijack`/u);
  });

  it("is named by the neighbours it hands work to", async () => {
    for (const neighbour of ["litresearch", "lit-plan", "start-work"]) {
      assert.match(await read(skillPath(neighbour, "SKILL.md")), /`lit-hijack`/u, `${neighbour} points at lit-hijack`);
    }
  });

  it("keeps the lit-plan agent planning-only while the skill relies on it", async () => {
    const body = await read(skillPath("lit-hijack", "SKILL.md"));
    assert.match(body, /planning-only/u);
    assert.match(body, /edit and bash are denied/u);
    assert.doesNotMatch(body, /grant[^\n]*lit-plan[^\n]*write access/iu);
  });
});

describe("lit-hijack routing", () => {
  it("routes the hijack words to lit-hijack ahead of plan, review and research", () => {
    for (const text of [
      "lit hijack https://x.com/someone/status/1 into my motion skill",
      "lit hijacking the review lanes from this repo into my plan skill",
      "lit hijack this repo's research method into a new skill",
      "lit 하이재킹 이 글의 기법을 내 스킬에",
      "lit 하이잭 이 PDF 두 개",
      "lit 하이재킹해줘 이 글",
      "lit-hijack these five posts",
      "please lit hijack ./article.md into skills/throwaway"
    ]) assert.equal(detectChatActivationMode(text), "lit-hijack", text);
  });

  it("keeps the neighbouring routes where they were", () => {
    for (const [text, mode] of [
      ["lit plan the hijack ledger migration", "lit-plan"],
      ["lit review the hijack ledger", "review-work"],
      ["lit research session hijack defences", "lit-research"],
      ["lit fix the session hijack bug", "lit-task"],
      ["lit plan the \"lit hijack\" screen", "lit-plan"],
      ["lit plan plans/lit-hijack.md", "lit-plan"],
      ["start-work plans/lit-hijack.md", "start-work"],
      ["lit start work plans/lit-hijack.md", "start-work"],
      ["lit fix the bug in src/lit-hijack.ts", "lit-task"]
    ]) assert.equal(detectChatActivationMode(text), mode, text);
    assert.notEqual(detectChatActivationMode("lit debug the session hijack in the login flow"), "lit-hijack");
  });

  it("stays ahead of the schematic route when the material is a drawing technique", () => {
    assert.equal(detectChatActivationMode("lit hijack the P&ID drawing technique from this post into my skill"), "lit-hijack");
    assert.equal(detectChatActivationMode("lit 하이재킹 이 글의 컷어웨이 그리는 기법을 내 스킬에"), "lit-hijack");
    assert.notEqual(detectChatActivationMode("lit draw a P&ID of the hijack test rig"), "lit-hijack");
  });

  it("does not activate on slash forms, code spans, or the word without lit", () => {
    for (const text of [
      "/lit-hijack these posts",
      "/lit-hijack lit",
      "`lit hijack these posts`",
      "```\nlit hijack\n```",
      "> lit hijack these posts",
      "hijack these posts into my skill",
      "how do attackers hijack a session cookie?",
      "I wrote the word lit-hijacker in a note",
      "split hijack notes"
    ]) assert.notEqual(detectChatActivationMode(text), "lit-hijack", text);
    assert.equal(detectChatActivationMode("/lit-hijack lit"), undefined);
    assert.equal(detectChatActivationMode("how do attackers hijack a session cookie?"), undefined);
    assert.equal(detectChatActivationMode("`lit hijack these posts`"), undefined);
  });

  it("chat activation points at the installed skill and names the fences", async () => {
    const parts = await chatText("lit hijack ./article.md into skills/throwaway");
    assert.equal(parts.length, 1);
    const [part] = parts;
    assert.equal(part.metadata.litopencode.mode, "lit-hijack");
    assert.match(part.text, /^🔥 LIT IGNITED · lit-hijack 🔥/u);
    assert.match(part.text, /<lit-hijack-mode>/u);
    assert.match(part.text, /skill name: lit-hijack/u);
    assert.match(part.text, /hijack\.mjs/u);
    assert.match(part.text, /planning-only/u);
    assert.match(part.text, /inert data/u);
    assert.ok(Buffer.byteLength(part.text, "utf8") < 6_000, "the activation points at the skill instead of pasting it");
    assert.match(promptForChatActivationMode("lit-hijack", "lit hijack x"), /lit-hijack-mode/u);
  });

  it("the command activates the same mode", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-hijack-command-"));
    try {
      const output = { parts: [] };
      await createCommandActivationHook(dir)({ sessionID: "session-command", command: "/lit-hijack", arguments: "./article.md into skills/throwaway" }, output);
      const activation = output.parts.at(-1);
      assert.equal(activation.metadata.litopencode.mode, "lit-hijack");
      assert.match(activation.text, /skill name: lit-hijack/u);
      assert.equal(findLitOpenCodeCommand("lit-hijack").agent, undefined, "a port writes files, so the command never routes to the planning-only agent");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("hijack.mjs capture helpers", () => {
  it("parses X status URLs and nothing else", () => {
    assert.equal(parseXStatusUrl("https://x.com/someone/status/2105643919119696297"), "2105643919119696297");
    assert.equal(parseXStatusUrl("https://twitter.com/a_b/status/42?s=20"), "42");
    assert.equal(parseXStatusUrl("https://x.com/i/article/42"), null);
    assert.equal(parseXStatusUrl("https://example.com/status/42"), null);
  });

  it("turns an fxtwitter post with a long article into Markdown and provenance", () => {
    const json = {
      code: 200,
      tweet: {
        url: "https://x.com/writer/status/77",
        id: "77",
        text: "Short teaser",
        created_at: "Thu Oct 01 13:00:05 +0000 2026",
        author: { screen_name: "writer", name: "A Writer" },
        article: {
          title: "Studio notes",
          content: {
            blocks: [
              { key: "a", type: "header-one", text: "First part", entityRanges: [] },
              { key: "b", type: "unstyled", text: "Plain paragraph.", entityRanges: [] },
              { key: "c", type: "unordered-list-item", text: "one item", entityRanges: [] },
              { key: "d", type: "atomic", text: " ", entityRanges: [{ key: 0, offset: 0, length: 1 }] },
              { key: "e", type: "atomic", text: " ", entityRanges: [{ key: 1, offset: 0, length: 1 }] },
              { key: "f", type: "blockquote", text: "quoted line", entityRanges: [] }
            ],
            entityMap: [
              { key: "0", value: { type: "MARKDOWN", data: { markdown: "```\nlayout/\n```" } } },
              { key: "1", value: { type: "MEDIA", data: {} } }
            ]
          }
        }
      }
    };
    const { markdown, meta } = fxtwitterToMarkdown(json);
    assert.equal(meta.author, "A Writer (@writer)");
    assert.equal(meta.published, "2026-10-01T13:00:05.000Z");
    assert.equal(meta.kind, "x-article");
    assert.equal(meta.title, "Studio notes");
    assert.match(markdown, /^# Studio notes$/mu);
    assert.match(markdown, /^## First part$/mu);
    assert.match(markdown, /^- one item$/mu);
    assert.match(markdown, /^```\nlayout\/\n```$/mu);
    assert.match(markdown, /^\[media\]$/mu);
    assert.match(markdown, /^> quoted line$/mu);
    const plain = fxtwitterToMarkdown({ code: 200, tweet: { ...json.tweet, article: null } });
    assert.equal(plain.meta.kind, "x-post");
    assert.match(plain.markdown, /Short teaser/u);
  });
});

describe("hijack.mjs licence gate", () => {
  it("detects common licences from their text or an SPDX line", () => {
    assert.equal(detectLicence("MIT License\n\nPermission is hereby granted, free of charge, to any person").spdx, "MIT");
    assert.equal(detectLicence("Apache License\nVersion 2.0, January 2004").spdx, "Apache-2.0");
    assert.equal(detectLicence("GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007").spdx, "GPL-3.0");
    assert.equal(detectLicence("GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3").spdx, "AGPL-3.0");
    assert.equal(detectLicence("// SPDX-License-Identifier: MPL-2.0\n").spdx, "MPL-2.0");
    assert.equal(detectLicence("This is free and unencumbered software released into the public domain.").spdx, "Unlicense");
    assert.equal(detectLicence("Licensed under Creative Commons Attribution-NonCommercial 4.0").spdx, "CC-BY-NC-4.0");
    assert.equal(detectLicence("Just a readme with no terms").spdx, "NOASSERTION");
  });

  it("maps every licence class to a take decision, and prohibition to review", () => {
    assert.equal(decideLicence("MIT").decision, "ideas-credit");
    assert.equal(decideLicence("Apache-2.0").decision, "ideas-credit");
    assert.equal(decideLicence("CC-BY-4.0").decision, "ideas-credit");
    assert.equal(decideLicence("GPL-3.0").decision, "ideas-only");
    assert.equal(decideLicence("CC-BY-SA-4.0").decision, "ideas-only");
    assert.equal(decideLicence("CC-BY-NC-4.0").decision, "ideas-only");
    assert.equal(decideLicence("NOASSERTION").decision, "ideas-only");
    assert.equal(decideLicence("NOASSERTION", { text: "Do not copy, adapt or redistribute any part of this guide." }).decision, "needs-review");
    assert.equal(decideLicence("NOASSERTION", { text: "© 2026 A Writer. All rights reserved.\nNo part of this publication may be reproduced." }).decision, "needs-review");
  });

  it("reads reuse terms only where the source talks about rights, not inside its subject matter", () => {
    const article = "## Reference analysis\n\n- KEEP: the pacing of the reveal\n- DO NOT COPY: the exact layout of the hero shot\n";
    assert.equal(decideLicence("NOASSERTION", { text: article }).decision, "ideas-only");
    assert.equal(decideLicence("MIT", { text: `${article}\nSPDX-License-Identifier: MIT` }).decision, "ideas-credit");
  });
});

describe("hijack.mjs overlap gate", () => {
  it("flags a verbatim run and passes a paraphrase", () => {
    const sources = [{ id: "S1", text: SOURCE_PROSE }];
    const copied = "Intro line.\nAs one note says, a careful studio writes the brief before any frame exists, so the model cannot fill gaps.\n";
    const runs = findOverlap({ sources, targets: [{ path: "SKILL.md", text: copied }], minWords: 12 });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].source, "S1");
    assert.equal(runs[0].path, "SKILL.md");
    assert.equal(runs[0].line, 2);
    assert.ok(runs[0].words >= 12);
    assert.deepEqual(findOverlap({ sources, targets: [{ path: "SKILL.md", text: PARAPHRASE }], minWords: 12 }), []);
  });

  it("ignores case, punctuation and Markdown, and works on Hangul", () => {
    const sources = [{ id: "S2", text: "먼저 브리프를 쓰고 그다음에 장면을 그린다 그래야 모델이 빈칸을 자기 취향으로 채우지 않는다 정말로" }];
    const target = "**먼저** 브리프를 쓰고, 그다음에 장면을 그린다. 그래야 모델이 빈칸을 자기 취향으로 채우지 않는다!";
    assert.equal(findOverlap({ sources, targets: [{ path: "a.md", text: target }], minWords: 12 }).length, 1);
    assert.equal(findOverlap({ sources, targets: [{ path: "a.md", text: target }], minWords: 20 }).length, 0);
  });
});

describe("hijack.mjs plan grammar", () => {
  const good = "# Plan\n\n## TODOs\n\n- [ ] 1. Add fields — Action: edit; Output: fields; Verification: node --test\n- [ ] 2. Wire it — Action: edit; Output: route; Verification: node --test\n\n## Final verification\n\n- [ ] F1. Review — Verification: review-work\n";

  it("accepts lit-plan rows and rejects each way of leaving the grammar", () => {
    assert.deepEqual(planGrammarIssues(good), []);
    assert.match(planGrammarIssues("# Plan\n\n1. Add the fields (SPEC M1)\n").join("\n"), /no implementation row under ## TODOs/u);
    assert.match(planGrammarIssues(good.replace("## Final verification\n\n- [ ] F1. Review — Verification: review-work\n", "")).join("\n"), /no final-verifier row/u);
    assert.match(planGrammarIssues(good.replace("- [ ] 2. Wire it", "- [ ] 3. Wire it")).join("\n"), /numbers its ## TODOs rows 1, 3/u);
    assert.match(planGrammarIssues(good.replace("; Output: route", "")).join("\n"), /malformed row under ## TODOs/u);
    assert.match(planGrammarIssues(good.replace("F1.", "F2.")).join("\n"), /numbers its ## Final verification rows/u);
  });

  it("ignores rows inside fences and rows under other headings", () => {
    const fenced = "# Plan\n\n```\n## TODOs\n- [ ] 1. A — Action: a; Output: b; Verification: c\n```\n\n## Notes\n\n- [ ] 1. A — Action: a; Output: b; Verification: c\n";
    assert.match(planGrammarIssues(fenced).join("\n"), /no implementation row under ## TODOs/u);
  });
});

// A complete small run on disk: one captured source, one mechanism, a spec, a build, parity and a report.
const writeRun = () => {
  const target = freshDir("target");
  mkdirSync(path.join(target, "skills", "toy"), { recursive: true });
  writeFileSync(path.join(target, "skills", "toy", "SKILL.md"), "# Toy\n\nLine two.\nWrite the promo brief.\n");
  const run = path.join(target, ".litopencode", "hijack", "studio-brief");
  const init = cli(["init", run, "--target", target, "--base-ref", "abc1234"]);
  assert.equal(init.status, 0, init.stderr);
  const sourceFile = path.join(target, "post.md");
  writeFileSync(sourceFile, `${SOURCE_PROSE}\n`);
  const capture = cli(["capture", run, sourceFile, "--kind", "file", "--url", "https://x.com/writer/status/77", "--author", "A Writer", "--date", "2026-10-01"]);
  assert.equal(capture.status, 0, capture.stderr);
  const licence = cli(["licence", run]);
  assert.equal(licence.status, 0, licence.stderr);
  const ledgerPath = path.join(run, "ledger.json");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  ledger.mechanisms = [{
    id: "M1",
    title: "Brief before render",
    sources: ["S1"],
    locator: "S1 paragraph 1",
    what: "A production note fixes the takeaway and the rejection condition before any rendering.",
    why: "Unfilled decisions are filled by model defaults, which is where look-alike output comes from.",
    evidence: "anecdotal",
    evidence_note: "Practitioner report, no measurement.",
    gap: { status: "weak", refs: ["skills/toy/SKILL.md:4"], note: "asks for a brief with no required fields" },
    port: { decision: "adapt", reason: "The toy skill already writes a brief; it lacks the two required fields." },
    parity: {
      criterion: "A brief from the toy skill names the takeaway and the rejection condition.",
      red: "baseline brief has neither field",
      green: "treatment brief has both fields",
      surface: "opencode run in a throwaway workspace",
      artifact: "parity/treatment.md"
    }
  }];
  ledger.build = { plan: "plans/toy-brief.md", changed: ["skills/toy/SKILL.md"] };
  ledger.parity = { baseline_outputs: ["parity/baseline.md"], treatment_outputs: ["parity/treatment.md"], markers: ["Rejection condition"] };
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  writeFileSync(path.join(run, "SPEC.md"), "# Spec\n\n## M1 Brief before render\n\nThe toy skill's brief gains two required fields: Takeaway and Rejection condition.\n");
  mkdirSync(path.join(target, "plans"), { recursive: true });
  writeFileSync(
    path.join(target, "plans", "toy-brief.md"),
    "# Toy brief\n\n## TODOs\n\n- [ ] 1. Add the two fields (SPEC M1) — Action: edit skills/toy/SKILL.md; Output: two required fields; Verification: node --test\n\n## Final verification\n\n- [ ] F1. Review the diff — Verification: review-work\n"
  );
  writeFileSync(path.join(target, "skills", "toy", "SKILL.md"), "# Toy\n\nLine two.\nWrite the promo brief with a Takeaway and a Rejection condition field.\n");
  mkdirSync(path.join(run, "parity"), { recursive: true });
  writeFileSync(path.join(run, "parity", "baseline.md"), "Brief: a fun launch video.\n");
  writeFileSync(path.join(run, "parity", "treatment.md"), "Takeaway: one tap. Rejection condition: any invented screen.\n");
  writeFileSync(path.join(run, "REPORT.md"), "# Report\n\n## Taken\n\nM1 adapted.\n\n## Left\n\nNothing else.\n\n## Provenance\n\nS1 https://x.com/writer/status/77 (A Writer, 2026-10-01), ideas-only.\n");
  return { target, run, ledgerPath };
};

const editLedger = (ledgerPath, change) => {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  change(ledger);
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
};

describe("hijack.mjs run gate", () => {
  it("passes a complete run through every phase, from the CLI too", () => {
    const { run } = writeRun();
    for (const phase of ["frame", "capture", "licence", "distil", "gap", "spec", "build", "parity", "report"]) {
      const result = checkRun(run, { phase });
      assert.deepEqual(result.issues, [], phase);
    }
    const result = checkRun(run, { phase: "report" });
    assert.equal(result.ok, true);
    const ledger = JSON.parse(readFileSync(path.join(run, "ledger.json"), "utf8"));
    assert.equal(ledger.schema, "litopencode.hijack-ledger.v1");
    assert.equal(ledger.sources[0].licence.decision, "ideas-only", "an X post with no licence is ideas-only");
    assert.match(ledger.sources[0].retrieved_at, /^\d{4}-\d{2}-\d{2}T/u);
    assert.match(ledger.sources[0].files[0].sha256, /^[0-9a-f]{64}$/u);
    const cliCheck = cli(["check", run, "--phase", "report"]);
    assert.equal(cliCheck.status, 0, cliCheck.stdout + cliCheck.stderr);
  });

  it("RED frame: a ledger with a foreign schema, or a missing target, fails", () => {
    const { run, ledgerPath } = writeRun();
    editLedger(ledgerPath, (ledger) => { ledger.schema = "other.v1"; });
    assert.match(checkRun(run, { phase: "frame" }).issues.join("\n"), /schema is not litopencode\.hijack-ledger\.v1/u);
    const second = writeRun();
    editLedger(second.ledgerPath, (ledger) => { ledger.target.root = path.join(temp, "missing-target-root"); });
    assert.match(checkRun(second.run, { phase: "frame" }).issues.join("\n"), /target\.root is missing/u);
  });

  it("RED capture: missing provenance or a tampered capture fails", () => {
    const { run, ledgerPath } = writeRun();
    editLedger(ledgerPath, (ledger) => { delete ledger.sources[0].retrieved_at; });
    assert.match(checkRun(run, { phase: "capture" }).issues.join("\n"), /S1: retrieved_at/u);
    const second = writeRun();
    const captured = JSON.parse(readFileSync(second.ledgerPath, "utf8")).sources[0].files[0].path;
    writeFileSync(path.join(second.run, captured), "changed after capture\n");
    assert.match(checkRun(second.run, { phase: "capture" }).issues.join("\n"), /S1: .*sha256 mismatch/u);
  });

  it("RED licence: a needs-review source keeps the phase open", () => {
    const { run, ledgerPath } = writeRun();
    editLedger(ledgerPath, (ledger) => { ledger.sources[0].licence.decision = "needs-review"; });
    assert.match(checkRun(run, { phase: "licence" }).issues.join("\n"), /S1: licence needs a person's decision/u);
    const second = writeRun();
    editLedger(second.ledgerPath, (ledger) => { delete ledger.sources[0].licence.decision; });
    assert.notDeepEqual(checkRun(second.run, { phase: "licence" }).issues, []);
  });

  it("RED distil: a mechanism without evidence class or sources fails", () => {
    const { run, ledgerPath } = writeRun();
    editLedger(ledgerPath, (ledger) => { ledger.mechanisms[0].evidence = "certain"; });
    assert.notDeepEqual(checkRun(run, { phase: "distil" }).issues, []);
    const second = writeRun();
    editLedger(second.ledgerPath, (ledger) => { ledger.mechanisms[0].sources = []; });
    assert.notDeepEqual(checkRun(second.run, { phase: "distil" }).issues, []);
  });

  it("RED gap: a gap ref that does not resolve fails, and so does a taken no-go mechanism", () => {
    const { run, ledgerPath } = writeRun();
    editLedger(ledgerPath, (ledger) => { ledger.mechanisms[0].gap.refs = ["skills/toy/SKILL.md:400"]; });
    assert.match(checkRun(run, { phase: "gap" }).issues.join("\n"), /M1: gap ref skills\/toy\/SKILL\.md:400/u);
    const second = writeRun();
    editLedger(second.ledgerPath, (ledger) => { ledger.sources[0].licence.decision = "no-go"; });
    assert.match(checkRun(second.run, { phase: "gap" }).issues.join("\n"), /M1: .*no-go/u);
  });

  it("RED spec: a spec that points at the sources or copies them fails", () => {
    const { run } = writeRun();
    writeFileSync(path.join(run, "SPEC.md"), "# Spec\n\n## M1\n\nRead sources/S1/content.md for details.\n");
    assert.match(checkRun(run, { phase: "spec" }).issues.join("\n"), /SPEC\.md names the captured sources/u);
    writeFileSync(path.join(run, "SPEC.md"), `# Spec\n\n## M1\n\n${SOURCE_PROSE}\n`);
    assert.match(checkRun(run, { phase: "spec" }).issues.join("\n"), /SPEC\.md:5 copies \d+ words from S1/u);
  });

  it("RED build: a plan outside lit-plan's row grammar, one that skips a mechanism, or none at all fails", () => {
    const { run, target, ledgerPath } = writeRun();
    writeFileSync(path.join(target, "plans", "toy-brief.md"), "# Toy brief\n\n1. Add the two fields (SPEC M1)\n");
    assert.match(checkRun(run, { phase: "build" }).issues.join("\n"), /build\.plan plans\/toy-brief\.md has no implementation row under ## TODOs/u);
    writeFileSync(
      path.join(target, "plans", "toy-brief.md"),
      "# Toy brief\n\n## TODOs\n\n- [ ] 1. Add the two fields — Action: edit; Output: fields; Verification: test\n\n## Final verification\n\n- [ ] F1. Review — Verification: review\n"
    );
    assert.match(checkRun(run, { phase: "build" }).issues.join("\n"), /build\.plan plans\/toy-brief\.md never cites M1/u);
    editLedger(ledgerPath, (ledger) => { delete ledger.build.plan; });
    assert.match(checkRun(run, { phase: "build" }).issues.join("\n"), /build\.plan is missing/u);
  });

  it("RED build: a plan that names the sources, or a build that copied source wording, fails", () => {
    const { run, target } = writeRun();
    writeFileSync(
      path.join(target, "plans", "toy-brief.md"),
      "# Toy brief\n\n## TODOs\n\n- [ ] 1. Read sources/S1 (SPEC M1) — Action: edit; Output: fields; Verification: test\n\n## Final verification\n\n- [ ] F1. Review — Verification: review\n"
    );
    assert.match(checkRun(run, { phase: "build" }).issues.join("\n"), /names the captured sources/u);
    const second = writeRun();
    writeFileSync(path.join(second.target, "skills", "toy", "SKILL.md"), `# Toy\n\n${SOURCE_PROSE}\n`);
    assert.match(checkRun(second.run, { phase: "build" }).issues.join("\n"), /skills\/toy\/SKILL\.md:3 copies \d+ words from S1/u);
  });

  it("RED parity: a marker that never appeared, or a baseline that saw the treatment, fails", () => {
    const { run } = writeRun();
    writeFileSync(path.join(run, "parity", "treatment.md"), "A fun launch video.\n");
    assert.match(checkRun(run, { phase: "parity" }).issues.join("\n"), /marker "Rejection condition" never appears in a treatment output/u);
    const second = writeRun();
    writeFileSync(path.join(second.run, "parity", "baseline.md"), "Rejection condition: none.\n");
    assert.match(checkRun(second.run, { phase: "parity" }).issues.join("\n"), /baseline output parity\/baseline\.md shows marker "Rejection condition"/u);
  });

  it("RED report: a report that skips a mechanism, a heading or a needed credit fails", () => {
    const { run } = writeRun();
    writeFileSync(path.join(run, "REPORT.md"), "# Report\n\n## Taken\n\n## Left\n\n## Provenance\n");
    assert.match(checkRun(run, { phase: "report" }).issues.join("\n"), /REPORT\.md does not account for M1/u);
    const second = writeRun();
    editLedger(second.ledgerPath, (ledger) => { ledger.sources[0].licence.decision = "ideas-credit"; });
    assert.match(checkRun(second.run, { phase: "report" }).issues.join("\n"), /S1 needs credit/u);
    const third = writeRun();
    writeFileSync(path.join(third.run, "REPORT.md"), "# Report\n\nM1 and S1 https://x.com/writer/status/77.\n");
    assert.notDeepEqual(checkRun(third.run, { phase: "report" }).issues, []);
  });

  it("builds an implementer brief from the spec alone", () => {
    const { run } = writeRun();
    const brief = buildImplementerBrief(run);
    assert.match(brief, /^TASK:/mu);
    assert.match(brief, /DELIVERABLE/u);
    assert.match(brief, /SCOPE/u);
    assert.match(brief, /VERIFY/u);
    assert.match(brief, /\.litopencode\/hijack/u);
    assert.match(brief, /Rejection condition/u, "carries the spec text");
    assert.doesNotMatch(brief, /x\.com\/writer|sources\/S1/u, "names no captured source");
  });

  it("the brief refuses while the spec gate fails, in the library and on the CLI", () => {
    const { run } = writeRun();
    writeFileSync(path.join(run, "SPEC.md"), `# Spec\n\n## M1\n\n${SOURCE_PROSE}\n`);
    assert.throws(() => buildImplementerBrief(run), /spec/iu);
    const result = cli(["brief", run]);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /^TASK:/mu, "no packet is printed");
  });

  it("refuses a PDF capture whose bytes are not a PDF", () => {
    const { run, target } = writeRun();
    writeFileSync(path.join(target, "fake.pdf"), "not a pdf\n");
    const result = cli(["capture", run, path.join(target, "fake.pdf"), "--kind", "pdf"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /%PDF-/u);
  });
});

describe("lit-hijack installation", () => {
  it("install ships the whole lit-hijack folder, doctor sees it, and the shipped helper runs", async () => {
    await withTempDir(async (dir) => {
      const install = runCli(["install", "--root", dir]);
      assert.equal(install.status, 0, install.stderr);
      for (const file of await fs.readdir(skillPath("lit-hijack", "references"))) {
        await fs.access(path.join(dir, "skills", "lit-hijack", "references", file));
      }
      await fs.access(path.join(dir, "skills", "lit-hijack", "scripts", "hijack.mjs"));
      assert.match(await read(dir, "skills", "lit-hijack", "SKILL.md"), /^---\nname: lit-hijack\n/u);
      assert.match(await read(dir, "command", "lit-hijack.md"), /lit-hijack/u);
      const doctor = JSON.parse(runCli(["doctor", "--root", dir]).stdout);
      assert.equal(doctor.install.ok, true);
      assert.ok(doctor.install.nativeSkills.present.includes("lit-hijack"));
      assert.ok(doctor.install.commandAliases.present.includes("lit-hijack"));
      assert.deepEqual(doctor.install.nativeSkills.missing, []);
      const installedHelper = spawnSync(process.execPath, [path.join(dir, "skills", "lit-hijack", "scripts", "hijack.mjs"), "check", path.join(dir, "no-run"), "--phase", "frame"], { encoding: "utf8" });
      assert.notEqual(installedHelper.status, 0, "an empty run folder fails the frame gate instead of crashing the loader");
    });
  });
});

describe("lit-hijack skill depth", () => {
  const skill = () => readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

  it("is a dense phased workflow, not a stub", () => {
    const text = skill();
    assert.ok(Buffer.byteLength(text, "utf8") >= 18_000, `SKILL.md is ${Buffer.byteLength(text, "utf8")} bytes`);
    assert.match(text, /^---\nname: lit-hijack\n/u);
    for (const heading of [
      "## #contract.activation",
      "## #contract.output_channels",
      "## #contract.hard_stops",
      "## When to use lit-hijack",
      "## How to start it in OpenCode",
      "## The run folder",
      "## Phase 0: Frame",
      "## Phase 1: Capture",
      "## Phase 2: Distil",
      "## Phase 3: Licence gate",
      "## Phase 4: Gap analysis",
      "## Phase 5: Port design and spec",
      "## Phase 6: Build",
      "## Phase 7: Parity proof",
      "## Phase 8: Report",
      "## Stop rules",
      "## Safety boundaries",
      "## Failure modes",
      "## Worked example",
      "## Final checklist"
    ]) assert.ok(text.includes(heading), `missing ${heading}`);
  });

  it("routes to its neighbours instead of re-implementing them", () => {
    const text = skill();
    for (const neighbour of ["litresearch", "lit-plan", "start-work", "review-work", "lit-brainstorm", "lit-crucible"]) {
      assert.match(text, new RegExp(`\`${neighbour}\``, "u"), `hands work to ${neighbour}`);
    }
    for (const command of ["capture", "licence", "overlap", "brief", "check"]) {
      assert.match(text, new RegExp(`hijack\\.mjs ${command}\\b`, "u"), `documents hijack.mjs ${command}`);
    }
    assert.match(text, /api\.fxtwitter\.com/u);
    assert.match(text, /TASK:[\s\S]*DELIVERABLE[\s\S]*SCOPE[\s\S]*VERIFY/u);
    assert.match(text, /git worktree/u);
    assert.match(text, /no host-managed worktree isolation/u);
    assert.match(text, /opencode run/u);
    assert.match(text, /— Action: <action>; Output: <output>; Verification: <verification>/u);
    for (const word of ["hijack", "hijacking", "하이재킹", "하이잭"]) assert.ok(text.includes(word), `route word ${word}`);
  });

  it("resolves every references/ path it names, and the references carry real content", async () => {
    const text = skill();
    const named = [...new Set([...text.matchAll(/references\/([a-z0-9-]+\.md)/gu)].map((match) => match[1]))];
    assert.ok(named.length >= 5, "names its reference files");
    for (const file of named) assert.ok(existsSync(path.join(skillDir, "references", file)), `references/${file}`);
    assert.deepEqual(readdirSync(path.join(skillDir, "references")).sort(), [...named].sort(), "no orphaned reference file");
    for (const file of named) {
      assert.ok((await read(skillDir, "references", file)).length >= 3_000, `references/${file} has content`);
    }
  });

  it("names no sibling product or foreign harness", () => {
    const corpus = [skill(), ...readdirSync(path.join(skillDir, "references")).map((file) => readFileSync(path.join(skillDir, "references", file), "utf8")), readFileSync(cliPath, "utf8")].join("\n");
    assert.doesNotMatch(corpus, /\blit(?:claude|hermes|codex|grok|muse|gravity)\b|claude|spawn_agent|apply_patch|CLAUDE_PLUGIN_ROOT|isolation: "worktree"/iu);
  });
});

test("lit-hijack stays reachable: the route, the catalog row and the command are the three doors", () => {
  assert.equal(detectChatActivationMode("lit hijack ./a.md into skills/x"), "lit-hijack");
  assert.ok(findLitOpenCodeRuntimeSkill("lit-hijack"));
  assert.ok(findLitOpenCodeCommand("lit-hijack"));
});

// Review hardening: a capture checks every hop before it connects, never leaves the clone for a tree
// subpath, and never reads more than its cap.
const hijackModule = () => import("../skills/lit-hijack/scripts/hijack.mjs");
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const hopFetch = (table, seen) => async (url) => {
  seen.push(url);
  const hit = table[url];
  if (!hit) return new Response("not found", { status: 404 });
  return new Response(hit.body ?? "", { status: hit.status ?? 200, headers: hit.headers ?? { "content-type": "text/html" } });
};

test("a capture refuses a redirect to a loopback, link-local or private host and never connects to it", async () => {
  const { publicFetch } = await hijackModule();
  for (const target of ["http://127.0.0.1:3000/admin", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://10.0.0.7/", "http://localhost/", "http://2130706433/"]) {
    const seen = [];
    const fetchImpl = hopFetch({ "https://post.example/x": { status: 302, headers: { location: target } } }, seen);
    await assert.rejects(publicFetch("https://post.example/x", { fetchImpl, lookup: publicLookup }), /not a public|private|loopback|localhost|numeric/u, target);
    assert.deepEqual(seen, ["https://post.example/x"], `${target} is never fetched`);
  }
  const seen = [];
  const inside = async (host) => (host === "inside.example" ? [{ address: "192.168.1.4", family: 4 }] : publicLookup());
  await assert.rejects(publicFetch("https://inside.example/", { fetchImpl: hopFetch({}, seen), lookup: inside }), /private|not a public/u);
  assert.deepEqual(seen, [], "a name that resolves to a private address is never fetched");
  const ok = await publicFetch("https://post.example/a", { fetchImpl: hopFetch({ "https://post.example/a": { status: 301, headers: { location: "/b" } }, "https://post.example/b": { body: "<title>B</title>" } }, []), lookup: publicLookup });
  assert.equal(ok.finalUrl, "https://post.example/b");
  assert.equal(ok.buffer.toString("utf8"), "<title>B</title>");
});

test("a capture stops reading a body as soon as it passes the size cap", { timeout: 10_000 }, async () => {
  const { publicFetch } = await hijackModule();
  let pulled = 0;
  const endless = new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(64 * 1024)); } });
  const fetchImpl = async () => new Response(endless, { status: 200 });
  await assert.rejects(publicFetch("https://big.example/", { fetchImpl, lookup: publicLookup, limit: 256 * 1024 }), /larger than/u);
  assert.ok(pulled < 16, `stopped after ${pulled} chunks`);
  const declared = async () => new Response("x", { status: 200, headers: { "content-length": String(1 << 30) } });
  await assert.rejects(publicFetch("https://big.example/", { fetchImpl: declared, lookup: publicLookup, limit: 1024 }), /larger than/u);
});

test("a GitHub tree subpath stays inside the clone and a ref is a plain branch or tag name", async () => {
  const { containedSubpath, safeGitRef } = await hijackModule();
  const repo = path.join(os.tmpdir(), "r", "repo");
  assert.equal(containedSubpath(repo, "/skills/one"), path.join(repo, "skills", "one"));
  for (const escape of ["/../../etc/passwd", "/..", "/a/../../b"]) assert.equal(containedSubpath(repo, escape), null, escape);
  for (const ref of ["main", "v1.2.0", "feature/x_y"]) assert.equal(safeGitRef(ref), ref);
  for (const ref of ["-u", "--upload-pack=x", "a..b", "x y", "", "a".repeat(200)]) assert.equal(safeGitRef(ref), null, ref);
});
