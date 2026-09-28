import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { laneBudgets } from "../src/rules/engine.ts";
import { validateDesignContract } from "../skills/frontend-ui-ux/scripts/design-contract.mjs";
import { validBetaDesignContract } from "../test-support/uiux-visual-fixtures.mjs";
import { registerVisualQaEvidenceContract } from "../test-support/visualqa-evidence-contract.mjs";

const requiredDocs = [
  "README.md",
  "README-Ko-KR.md",
  "docs/reference.md",
  "docs/reference-Ko-KR.md",
  "CHANGELOG.md",
  "docs/migration.md",
  "docs/release-checklist.md"
];
const topLevelSkillCorpusWordTarget = 42_789;
const requiredSkillContractHeadings = [
  "## #contract.activation",
  "## #contract.inputs",
  "## #contract.mode_matrix",
  "## #contract.procedure",
  "## #contract.outputs",
  "## #contract.evidence",
  "## #contract.hard_stops",
  "## #contract.anti_patterns"
];
const guardedPattern = new RegExp([
  ["o", "mo"].join(""),
  ["oh-my-open", "agent"].join(""),
  ["oh-my-open", "code"].join(""),
  ["sisyphus", "labs"].join(""),
  ["lazy", "codex"].join(""),
  ["lazy", "claude"].join(""),
  ["code-yeong", "yu"].join(""),
  ["u", "lw"].join(""),
  ["ultra", "work"].join(""),
  ["ultra", "goal"].join("")
].map((token) => "\\b" + token + "\\b").join("|"), "i");
const placeholderOnlyPattern = /\b(?:TODO|TBD|placeholder|stub)\b/i;
const evidenceBoundaryPattern = /\b(?:blocked|hard stop|failure)\b/i;
const canonicalSkillIds = [
  "workflow-loop",
  "durable-litgoal",
  "agent-roster",
  "lit-plan",
  "start-work",
  "review-work",
  "litresearch",
  "reference-benchmark-claims",
  "native-goal-verdict",
  "doctor-installer",
  "frontend-ui-ux",
  "search-workflow-ideas",
  "lit-fetch",
  "release-guardrails",
  "lit-init",
  "lit-crucible",
  "refactor",
  "lit-burnoff",
  "lit-burnoff-file",
  "autoconference",
  "autoresearch",
  "comment-checker",
  "lit-code",
  "debugging",
  "lit-commit",
  "lsp",
  "lsp-setup",
  "rules",
  "deep-interview",
  "structural-search",
  "lit-humanizer",
  "lit-recap",
  "lit-handoff",
  "lit-scientific-visualization",
  "litwork",
  "tool-guards",
  "visual-qa",
  "wikify"
];

function boundedToken(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, "i").test(text);
}

function markdownSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, "m"));
  assert.ok(match, `expected documentation to contain a ${heading} section`);
  return match[1];
}

async function readText(filePath) {
  return await fs.readFile(filePath, "utf8");
}

async function readOptionalText(filePath) {
  try {
    return await readText(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

function assertContainsAll(text, labels) {
  for (const label of labels) {
    assert.match(text, new RegExp(label, "i"), `expected docs to mention ${label}`);
  }
}

function formattedBudget(value) {
  return value.toLocaleString("en-US");
}

function assertReferenceRuleBudgets(readme) {
  const rulesDescription = readme.match(/^- repository rules engine with two lanes:[\s\S]*?(?=^- session-scoped)/mu)?.[0] ?? "";
  const staticPerRule = formattedBudget(laneBudgets.static.perRule);
  const staticTotal = formattedBudget(laneBudgets.static.total);
  const dynamicPerRule = formattedBudget(laneBudgets.dynamic.perRule);
  const dynamicTotal = formattedBudget(laneBudgets.dynamic.total);

  assert.ok(
    rulesDescription.includes(`static lane has a final encoded per-rule limit of ${staticPerRule} characters`),
    `Reference should document runtime static per-rule limit ${staticPerRule}`
  );
  assert.ok(
    rulesDescription.includes(`static total remains ${staticTotal}`),
    `Reference should document runtime static total ${staticTotal}`
  );
  assert.ok(
    rulesDescription.includes(`dynamic lane has a final encoded per-rule limit of ${dynamicPerRule} characters`),
    `Reference should document runtime dynamic per-rule limit ${dynamicPerRule}`
  );
  assert.ok(
    rulesDescription.includes(`total limit of ${dynamicTotal} characters`),
    `Reference should document runtime dynamic total ${dynamicTotal}`
  );
}

async function listTopLevelSkillDocs() {
  const entries = await fs.readdir("skills", { withFileTypes: true });
  const skillDocs = [];
  const skillDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const skillId of skillDirs) {
    const skillPath = path.join("skills", skillId, "SKILL.md");
    try {
      const stat = await fs.stat(skillPath);
      if (stat.isFile()) {
        skillDocs.push({ skillId, skillPath, text: await readText(skillPath) });
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return skillDocs;
}

function countWhitespaceWords(text) {
  return (text.match(/\S+/g) ?? []).length;
}

function assertSkillContractShape(skillPath, text) {
  const headingPositions = requiredSkillContractHeadings.map((heading) => {
    const index = text.indexOf(heading);
    assert.notEqual(index, -1, `${skillPath} should include ${heading}`);
    return index;
  });

  const firstH2 = text.match(/^##\s+/m);
  assert.equal(
    firstH2?.index,
    headingPositions[0],
    `${skillPath} should be contract-first: first h2 must be ${requiredSkillContractHeadings[0]}`
  );

  assert.deepEqual(
    [...headingPositions].sort((left, right) => left - right),
    headingPositions,
    `${skillPath} should keep required contract headings in schema order`
  );
  assert.match(
    text,
    /```(?:yaml|json)\n[\s\S]*?contract_schema_version:[\s\S]*?```|```json\n[\s\S]*?"contract_schema_version"[\s\S]*?```/,
    `${skillPath} should contain a fenced yaml/json contract schema block`
  );
  assert.match(
    text,
    /^\|\s*(?:Field|Mode|Step|Surface)\s*\|.+\|\s*$/m,
    `${skillPath} should contain a markdown contract table`
  );
}

test("required W5 documentation files exist", async () => {
  for (const filePath of requiredDocs) {
    const stat = await fs.stat(filePath);
    assert.equal(stat.isFile(), true, `${filePath} should be a file`);
  }
});

test("README links resolve to local docs", async () => {
  const readme = await readText("README.md");
  const version = JSON.parse(await readText("package.json")).version;
  const npmPackage = `https://cdn.jsdelivr.net/npm/@litfamily/litopencode@${version}/`;
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/gu)]
    .map((match) => match[1].startsWith(npmPackage) ? match[1].slice(npmPackage.length) : match[1]);

  assert.ok(links.includes("docs/migration.md"), "README should link migration docs");
  assert.ok(!links.includes("docs/release-checklist.md"), "npm README must not link the excluded repository-only release checklist");
  assert.ok(links.includes("CHANGELOG.md"), "README should link the changelog");
  assert.ok(links.includes("docs/reference.md"), "README should link the detailed operational reference");

  for (const link of links) {
    await fs.stat(path.resolve(link));
  }
});

test("bilingual entry paths and operational references keep local document links reachable", async () => {
  const version = JSON.parse(await readText("package.json")).version;
  const npmPackage = `https://cdn.jsdelivr.net/npm/@litfamily/litopencode@${version}/`;
  for (const file of ["README.md", "README-Ko-KR.md", "docs/reference.md", "docs/reference-Ko-KR.md"]) {
    const content = await readText(file);
    for (const [, target] of content.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/gu)) {
      if (target.startsWith(npmPackage)) {
        const packagePath = target.slice(npmPackage.length).split("#")[0];
        assert.equal((await fs.stat(path.resolve(packagePath))).isFile(), true, `${file} -> ${target}`);
      } else if (/^https?:\/\//u.test(target)) continue;
      else assert.equal((await fs.stat(path.resolve(path.dirname(file), target))).isFile(), true, `${file} -> ${target}`);
    }
  }
});

test("GPT-6 model docs pin the catalog effort bounds and distinguish GPT-5.6 Luna", async () => {
  const documents = Object.fromEntries(await Promise.all([
    ["reference", "docs/reference.md"],
    ["referenceKo", "docs/reference-Ko-KR.md"],
    ["migration", "docs/migration.md"],
    ["checklist", "docs/release-checklist.md"]
  ].map(async ([name, file]) => [name, (await readText(file)).replace(/\s+/gu, " ")])));

  assert.ok(/GPT-6 Astra and Sol accept `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`\./u.test(documents.reference), "English reference should state the complete Astra/Sol range");
  assert.ok(/GPT-6 Luna accepts `low`, `medium`, `high`, `xhigh`, and `max`, but not `ultra`\./u.test(documents.reference), "English reference should allow GPT-6 Luna xhigh and exclude ultra");
  assert.ok(/GPT-5\.6 Luna accepts only `high` and `max`; `xhigh` remains unsupported for that model\./u.test(documents.reference), "English reference should retain the legacy Luna limit");
  assert.ok(/GPT-6 Astra와 GPT-6 Sol은 `low`, `medium`, `high`, `xhigh`, `max`, `ultra`를 모두 지원합니다\./u.test(documents.referenceKo), "Korean reference should state the complete Astra/Sol range");
  assert.ok(/GPT-6 Luna는 `low`, `medium`, `high`, `xhigh`, `max`를 지원하지만 `ultra`는 지원하지 않습니다\./u.test(documents.referenceKo), "Korean reference should allow GPT-6 Luna xhigh and exclude ultra");
  assert.ok(/GPT-5\.6 Luna는 `high`와 `max`만 지원하고 `xhigh`는 허용하지 않습니다\./u.test(documents.referenceKo), "Korean reference should retain the legacy Luna limit");
  assert.ok(/GPT-6 Astra and Sol accept `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`\./u.test(documents.migration), "migration docs should state the complete Astra/Sol range");
  assert.ok(/GPT-6 Luna accepts `low`, `medium`, `high`, `xhigh`, and `max`, but not `ultra`\./u.test(documents.migration), "migration docs should allow GPT-6 Luna xhigh and exclude ultra");
  assert.ok(/Previous-generation GPT-5\.6 Luna accepts only `high` and `max`; `xhigh` remains unsupported for that model\./u.test(documents.migration), "migration docs should retain the legacy Luna limit");
  assert.ok(/accepts GPT-6 Luna\/xhigh, rejects GPT-6 Luna\/ultra and GPT-5\.6 Luna\/xhigh/u.test(documents.checklist), "active checklist should distinguish GPT-6 from GPT-5.6 Luna");
  assert.doesNotMatch(documents.reference, /Luna plus `?xhigh` is (?:rejected|forbidden)/iu);
  assert.doesNotMatch(documents.referenceKo, /Luna와 `xhigh` 조합도 허용하지 않습니다/u);
  assert.doesNotMatch(documents.migration, /LUNA plus xhigh is forbidden/iu);
});

test("bilingual quick starts preserve executable package names and resolve the repository cover", async () => {
  const vector = await readText("docs/assets/cover.svg");
  assert.match(vector, /<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
  assert.match(vector, /\bviewBox="0 0 1920 960"/u);
  assert.match(vector, /<path\b/u);
  assert.match(vector, /<title id="title">LITOPENCODE — Ignition vector cover<\/title>/u);
  for (const hex of ["#FF6337", "#D7F75B", "#F2EFDF", "#080D14"]) assert.ok(vector.includes(hex));
  assert.doesNotMatch(vector, /<(?:image|text|script|foreignObject|use)\b|\b(?:href|on\w+)\s*=|url\s*\(|data:/iu);
  const cover = await fs.readFile("docs/assets/cover.webp");
  assert.equal(cover.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(cover.subarray(8, 12).toString("ascii"), "WEBP");
  assert.equal(createHash("sha256").update(cover).digest("hex"), "00b045cf08c00ed3c2b5205645689a035be8f56540a289f9b9a9cad6a7ef9251");
  const still = await fs.readFile("docs/assets/cover-motion-still.webp");
  assert.equal(still.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(still.subarray(8, 12).toString("ascii"), "WEBP");
  assert.equal(createHash("sha256").update(still).digest("hex"), "048f141ad91425e1e41737e822f8d32ac865ada352a5edcc10a6a654130d01ce");
  const assets = "https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.10/docs/assets";
  for (const file of ["README.md", "README-Ko-KR.md"]) {
    const content = await readText(file);
    const alt = file === "README.md"
      ? "LitFamily motion cover: five armored robots power on one by one, the LitOpenCode robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up."
      : "LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitOpenCode 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상";
    assert.ok(content.includes('<source media="(prefers-reduced-motion: reduce)" srcset="' + assets + '/cover-motion-still.webp" />'));
    assert.ok(content.includes('<img src="' + assets + '/cover-motion.webp" width="100%" alt="' + alt + '" />'));
    assert.ok(!content.includes(assets + '/cover.webp'), file + ": the motion cover replaces the separate static robot cover");
    assert.doesNotMatch(content, /View the static (?:family )?cover|정지 (?:패밀리 )?표지 보기/u);
    const linksHeading = file === "README.md" ? "## Links" : "## 링크";
    const linksStart = content.indexOf(linksHeading);
    const familyStart = content.indexOf("### LITFAMILY", linksStart);
    const motionStart = content.indexOf("### Ignition motion", familyStart);
    const familyImages = [...content.slice(familyStart, motionStart).matchAll(/!\[[^\]]+\]\(([^)]+cover\.webp)\)/gu)];
    assert.equal(familyImages.length, 0, file + ": the robot cover no longer repeats near the end");
    assert.doesNotMatch(content, /raw\.githubusercontent/u);
    assert.match(content, /npm exec --package @litfamily\/litopencode@latest -- litopencode install/u);
    assert.match(content, /```text\nlit [^\n]+\n```/u);
    assert.match(content, /npm uninstall -g @litfamily\/litopencode/u);
    assert.match(content, /LITOPENCODE_NO_AUTO_UPDATE=1/u);
    assert.match(content, /POSIX/u);
    assert.match(content, /Windows/u);
  }
});

test("operational reference documents lane-specific final encoded rule budgets", async () => {
  const readme = await readText("docs/reference.md");
  const staticTotal = formattedBudget(laneBudgets.static.total);
  const mutated = readme.replace(`static total remains ${staticTotal}`, "static total remains 99,000");

  assert.doesNotMatch(readme, /Per-rule cap 12,000 characters/u, "Reference must not describe one uniform per-rule cap");
  assertReferenceRuleBudgets(readme);
  assert.match(readme, /complete rule fragments,\s+XML entities, and code points/iu);
  assert.match(readme, /bounded digest\/omission rule\s+fragment/iu);
  assert.notEqual(mutated, readme, "mutation fixture should replace the documented static total");
  assert.throws(() => assertReferenceRuleBudgets(mutated), new RegExp(`runtime static total ${staticTotal}`, "u"));
});

test("migration docs cover package, environment, state, and vocabulary moves", async () => {
  const migration = await readText("docs/migration.md");

  assertContainsAll(migration, [
    "package",
    "litopencode",
    "environment",
    "LITOPENCODE_",
    "\\.litopencode/litgoal",
    "native goal",
    "vocabulary",
    "legacy"
  ]);
});

test("release checklist documents no-publication guardrails and required gates", async () => {
  const checklist = await readText("docs/release-checklist.md");

  assertContainsAll(checklist, [
    "publication",
    "HUMAN-ONLY",
    ["npm", "publish --access", "public"].join(" "),
    "push",
    "tag",
    "auth token",
    "native goal verdict",
    "scan:legacy-tokens",
    "check:version",
    "check:pack-payload",
    "pack --dry-run"
  ]);
  assert.doesNotMatch(checklist, /The completed final wave drove/iu);
  assert.match(checklist, /must run.*npm test.*npm run typecheck/is);
});

const b12ProbeContract = [
  {
    alias: "qa:negative-gate-matrix",
    command: "node tools/run-negative-gate-matrix.mjs",
    tableIdentity: "qa:negative-gate-matrix"
  },
  {
    alias: "qa:installed-resource-tamper",
    command: "node tools/run-installed-resource-tamper-probe.mjs",
    tableIdentity: "qa:installed-resource-tamper"
  },
  {
    alias: "qa:behavior-replacement",
    command: "node tools/run-behavior-replacement-probes.mjs",
    tableIdentity: "qa:behavior-replacement"
  },
  {
    alias: undefined,
    command: "node tools/run-wikify-surface-probe.mjs",
    tableIdentity: "node tools/run-wikify-surface-probe.mjs"
  }
];
const b12CountWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const b12ForbiddenPreflightHandoff = /\bHANDOFF\.md\b|\b(?:per[-\s]?repository|repository[-\s]?local|repository|local)\b[^\n]*\bhandoff\b|\bhandoff\b[^\n]*\b(?:per[-\s]?repository|repository[-\s]?local|repository|local)\b/iu;
const b12RequiredGateCommands = [
  "npm run build",
  "npm test",
  "npm test",
  "npm run typecheck",
  "npm run check:managed-skill-manifest",
  "npm run scan:legacy-tokens",
  "npm run check:version",
  "npm run check:pack-payload",
  "npm run qa:negative-gate-matrix",
  "npm run qa:installed-resource-tamper",
  "npm run qa:behavior-replacement",
  "npm run qa:rules-glob-differential",
  "npm pack --dry-run --json"
];
const b12SummaryStructureError = "Required Gates must contain exactly one qa:real-surface summary line as the first nonblank prose line after its closing fence";

function parseRequiredGateStructure(requiredGates) {
  const lines = requiredGates.split("\n");
  const openingLines = lines.map((line, index) => (line === "```sh" ? index : -1)).filter((index) => index >= 0);
  const closingLines = lines.map((line, index) => (line === "```" ? index : -1)).filter((index) => index >= 0);
  assert.equal(openingLines.length, 1, "Required Gates must contain exactly one unindented ```sh opening line");
  assert.equal(closingLines.length, 1, "Required Gates must contain exactly one unindented ``` closing line");
  const openingIndex = openingLines[0];
  const closingIndex = closingLines[0];
  assert.ok(openingIndex < closingIndex, "Required Gates command block must close after it opens");

  const commandLines = lines.slice(openingIndex + 1, closingIndex);
  assert.equal(
    commandLines.filter((line) => line.includes("qa:real-surface")).length,
    0,
    b12SummaryStructureError
  );
  assert.deepEqual(
    commandLines.filter((line) => line.trim() !== ""),
    b12RequiredGateCommands,
    "Required Gates command block must parse under the exact repository structure"
  );
  return lines.slice(closingIndex + 1);
}

function assertB12ReleaseChecklist(checklist, packageJson) {
  const preflight = checklist.match(/^## Preflight\n([\s\S]*?)(?=^## Required Gates)/m)?.[1];
  assert.ok(preflight, "release checklist should contain a Preflight section");
  assert.doesNotMatch(
    preflight,
    b12ForbiddenPreflightHandoff,
    "Preflight must not grant authority to a local, repository, or per-repository handoff"
  );
  assert.match(preflight, /authoritative family handoff from the umbrella root/iu);

  const packageProbes = packageJson.scripts["qa:real-surface"]
    .split(" && ")
    .filter((command) => command !== "npm run build");
  assert.deepEqual(
    packageProbes,
    b12ProbeContract.map(({ command }) => command),
    "package.json must keep the four exact probe command forms"
  );
  for (const { alias, command } of b12ProbeContract) {
    if (alias === undefined) continue;
    assert.equal(packageJson.scripts[alias], command, "qa alias bodies must match their direct probe commands");
  }
  assert.deepEqual(
    Object.keys(packageJson.scripts).filter((name) => /^qa:.*wikify/iu.test(name)),
    [],
    "the Wikify direct probe must not gain a qa alias"
  );
  const qaSection = checklist.match(/^## Replacement Real-Surface QA\n([\s\S]*?)(?=^## Packed Artifact Probe)/m)?.[1];
  assert.ok(qaSection, "release checklist should contain the replacement QA section");
  const requiredGates = checklist.match(/^## Required Gates\n([\s\S]*?)(?=^## Replacement Real-Surface QA)/m)?.[1];
  assert.ok(requiredGates, "release checklist should contain the Required Gates section");
  const allSummaryLines = requiredGates.split("\n").filter((line) => line.includes("qa:real-surface"));
  assert.equal(allSummaryLines.length, 1, b12SummaryStructureError);
  const proseAfterClosingFence = parseRequiredGateStructure(requiredGates);
  const summaryLines = proseAfterClosingFence.filter((line) => line.includes("qa:real-surface"));
  assert.equal(summaryLines.length, 1, b12SummaryStructureError);

  const documentedProbes = [...qaSection.matchAll(/^\|\s*`([^`]+)`\s*\|/gmu)].map((match) => match[1]);
  const expectedProbes = b12ProbeContract.map(({ tableIdentity }) => tableIdentity);
  assert.deepEqual(
    documentedProbes,
    expectedProbes,
    "checklist probes must match package.json in order"
  );
  assert.ok(packageProbes.includes("node tools/run-wikify-surface-probe.mjs"));
  assert.ok(documentedProbes.includes("node tools/run-wikify-surface-probe.mjs"));

  const quotedProbes = expectedProbes.map((probe) => `\`${probe}\``);
  const summaryProbeList = quotedProbes.length > 1
    ? `${quotedProbes.slice(0, -1).join(", ")}, and ${quotedProbes.at(-1)}`
    : quotedProbes[0];
  const expectedSummary = `\`npm run qa:real-surface\` builds once and then runs the ${b12CountWords[packageProbes.length]} probes in this order: ${summaryProbeList}.`;
  assert.equal(summaryLines[0], expectedSummary, b12SummaryStructureError);
  assert.equal(
    proseAfterClosingFence.find((line) => line.trim() !== ""),
    expectedSummary,
    b12SummaryStructureError
  );
}

test("release checklist follows the authoritative handoff and real-surface probe contract", async () => {
  const checklist = await readText("docs/release-checklist.md");
  const packageJson = JSON.parse(await readText("package.json"));
  assertB12ReleaseChecklist(checklist, packageJson);

  const staleChecklistAlias = checklist.replace(
    "| `qa:behavior-replacement` |",
    "| `qa:behavior-replacement-probe` |"
  );
  assert.throws(
    () => assertB12ReleaseChecklist(staleChecklistAlias, packageJson),
    /checklist probes must match package\.json in order/u,
    "a stale checklist probe alias must fail"
  );

  const stalePackageSuffix = {
    ...packageJson,
    scripts: {
      ...packageJson.scripts,
      "qa:real-surface": packageJson.scripts["qa:real-surface"].replace(
        "run-behavior-replacement-probes.mjs",
        "run-behavior-replacement-probe.mjs"
      )
    }
  };
  assert.throws(
    () => assertB12ReleaseChecklist(checklist, stalePackageSuffix),
    /package\.json must keep the four exact probe command forms/u,
    "a stale package probe suffix must fail"
  );

  const staleAliasBody = {
    ...packageJson,
    scripts: {
      ...packageJson.scripts,
      "qa:behavior-replacement": "node tools/run-behavior-replacement-probes.mjs --stale"
    }
  };
  assert.throws(
    () => assertB12ReleaseChecklist(checklist, staleAliasBody),
    /qa alias bodies must match their direct probe commands/u,
    "a stale qa alias body must fail"
  );

  const duplicateSummary = checklist.replace(
    "`npm run qa:real-surface` builds once and then runs the four probes",
    "A copied note says `qa:real-surface` runs four probes.\n\n`npm run qa:real-surface` builds once and then runs the three probes"
  );
  assert.throws(
    () => assertB12ReleaseChecklist(duplicateSummary, packageJson),
    /exactly one qa:real-surface summary line/u,
    "an unrelated qa:real-surface line must not satisfy the count check"
  );

  const validSummaryLine = checklist.split("\n").find((line) => line.startsWith("`npm run qa:real-surface`"));
  assert.ok(validSummaryLine, "the valid checklist must contain the qa:real-surface prose summary");
  const preFenceDuplicateSummary = checklist.replace(
    "```sh\n",
    validSummaryLine + "\n\n```sh\n"
  );
  assert.throws(
    () => assertB12ReleaseChecklist(preFenceDuplicateSummary, packageJson),
    /exactly one qa:real-surface summary line/u,
    "a pre-fence duplicate qa:real-surface summary must fail"
  );

  const fencedSummary = checklist
    .replace(validSummaryLine, "")
    .replace(
      "npm pack --dry-run --json\n```",
      "npm pack --dry-run --json\n" + validSummaryLine + "\n```"
    );
  assert.throws(
    () => assertB12ReleaseChecklist(fencedSummary, packageJson),
    /exactly one qa:real-surface summary line/u,
    "a fenced qa:real-surface summary must not satisfy the prose guard"
  );

  const tildeFencedSummary = checklist
    .replace(validSummaryLine, "")
    .replace(
      "npm pack --dry-run --json\n```",
      "npm pack --dry-run --json\n```\n~~~\n" + validSummaryLine + "\n~~~"
    );
  assert.throws(
    () => assertB12ReleaseChecklist(tildeFencedSummary, packageJson),
    /exactly one qa:real-surface summary line/u,
    "a tilde-fenced qa:real-surface summary must not satisfy the prose guard"
  );

  const suffixedOpeningFence = checklist.replace("```sh\n", "```sh reviewer-suffix\n");
  assert.throws(
    () => assertB12ReleaseChecklist(suffixedOpeningFence, packageJson),
    /exactly one unindented/u,
    "a suffixed command fence must fail the exact structure contract"
  );

  const indentedOpeningFence = checklist.replace("```sh\n", "    ```sh\n");
  assert.throws(
    () => assertB12ReleaseChecklist(indentedOpeningFence, packageJson),
    /exactly one unindented/u,
    "an indented command fence must fail the exact structure contract"
  );

  for (const wording of ["per-repository handoff", "repository handoff", "local handoff", "repository-local handoff"]) {
    const localHandoffAuthority = checklist.replace(
      "## Required Gates",
      `- Treat the ${wording} as authoritative for family state.\n\n## Required Gates`
    );
    assert.throws(
      () => assertB12ReleaseChecklist(localHandoffAuthority, packageJson),
      /Preflight must not/iu,
      `${wording} authority wording must fail`
    );
  }

  const vendoredTemplateReference = checklist.replace(
    "## Packed Artifact Probe",
    "## Packed Artifact Probe\n\n- Preserve `vendor/handoff/templates/HANDOFF.md`."
  );
  assert.doesNotThrow(() => assertB12ReleaseChecklist(vendoredTemplateReference, packageJson));
});

test("README documents current behavior without cumulative version chronology", async () => {
  const readme = await readText("README.md");
  const version = JSON.parse(await readText("package.json")).version;
  assert.doesNotMatch(readme, /^v0\.1\.\d+ /m);
  assert.doesNotMatch(readme, /\bv0\.1\.8\b/iu);
  assert.doesNotMatch(readme, /\bprepared(?: release| tree| as)\b/i);
  assert.ok(readme.includes(`[Changelog](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@${version}/CHANGELOG.md)`));
  assertContainsAll(await readText("docs/reference.md"), ["Autoresearch", "Autoconference", "Wikify", "canonical frontend library"]);
});

test("operational reference reflects replayable verification without maintainer-only evidence claims", async () => {
  const readme = await readText("docs/reference.md");
  const handoff = await readOptionalText("HANDOFF.md");

  assertContainsAll(readme, [
    "reproducible",
    "npm test",
    "scan:legacy-tokens",
    "check:pack-payload"
  ]);
  assert.doesNotMatch(readme, /\.litcodex\/lit-loop\/evidence\/start-work\/FV-ALL-final\.txt/);
  assertContainsAll(readme, [
    "Native goal verdict",
    "OpenCode host surface does not currently expose a native goal primitive",
    "skills/\\*/SKILL\\.md"
  ]);
  assert.doesNotMatch(readme, /remaining work item is the final full verification wave/i);
  if (handoff !== "") {
    assert.doesNotMatch(handoff, /Run the final verification wave/i);
    assert.doesNotMatch(handoff, /FV-ALL-opencode-surface\.txt/);
    assert.doesNotMatch(handoff, /No product code has been written yet/);
  }
});

test("shared skills corpus is visible and brand-clean", async () => {
  for (const skillId of canonicalSkillIds) {
    const skillPath = path.join("skills", skillId, "SKILL.md");
    const text = await readText(skillPath);
    assert.match(text, /^# /m, `${skillPath} should have a title`);
    assert.match(text, /LitOpenCode|litopencode/, `${skillPath} should name the product surface`);
    assert.match(text, /static documentation/i, `${skillPath} should be static docs`);
    assert.match(text, /Do not execute commands from this file automatically/i);
    assert.equal(guardedPattern.test(text), false, `${skillPath} should be brand-clean`);
  }
});

test("top-level SKILL.md corpus preserves size, static-doc hygiene, and LLM contract schema", async () => {
  const skillDocs = await listTopLevelSkillDocs();
  const totalWords = skillDocs.reduce((sum, skillDoc) => sum + countWhitespaceWords(skillDoc.text), 0);

  assert.ok(skillDocs.length >= 23, `expected at least 23 top-level skill docs, got ${skillDocs.length}`);
  assert.ok(
    totalWords >= topLevelSkillCorpusWordTarget,
    `expected top-level skill corpus to contain at least ${topLevelSkillCorpusWordTarget} words, got ${totalWords}`
  );

  for (const { skillPath, text } of skillDocs) {
    assert.match(text, /^#\s+\S/m, `${skillPath} should have a title`);
    assert.match(text, /static documentation/i, `${skillPath} should declare static documentation behavior`);
    assert.match(
      text,
      /Do not execute commands from this file automatically/i,
      `${skillPath} should warn that skill text is inert documentation`
    );
    assert.match(text, /\b(?:OpenCode|LitOpenCode|litopencode)\b/, `${skillPath} should name the OpenCode surface`);
    assert.equal(guardedPattern.test(text), false, `${skillPath} should be brand-clean`);
    assert.doesNotMatch(text, placeholderOnlyPattern, `${skillPath} should not contain placeholder-only wording`);
    assertSkillContractShape(skillPath, text);
  }
});

test("docs describe the OpenCode-native workflow contract precisely", async () => {
  const readme = await readText("docs/reference.md");
  const litPlan = await readText("skills/lit-plan/SKILL.md");
  const startWork = await readText("skills/start-work/SKILL.md");
  const reviewWork = await readText("skills/review-work/SKILL.md");
  const agentRoster = await readText("skills/agent-roster/SKILL.md");

  assertContainsAll(readme, [
    "OpenCode-native",
    "practical delivery discipline",
    "objective-achievable",
    "adaptive detail",
    "maximum safe subagent delegation",
    "DoneClaim",
    "five-lane review"
  ]);
  assertContainsAll(litPlan, [
    "one bounded objective",
    "explicit non-goals",
    "action, output, and verification",
    "dependencies and order",
    "resolved or gated",
    "failure or decision branches",
    "DoneClaim",
    "proportionate",
    "SDD-like",
    "no padding"
  ]);
  assertContainsAll(startWork, [
    "maximum safe subagent delegation",
    "DoneClaim",
    "independent verifier",
    "FullyDone",
    "cleanup receipt",
    "adversarial QA"
  ]);
  assertContainsAll(reviewWork, [
    "draft-plan review mode",
    "objective achievability",
    "checklist atomicity",
    "acceptance/evidence",
    "failure/decision/cleanup",
    "PASS",
    "ITERATE",
    "NEEDS-CONTEXT",
    "revise only when needed",
    "never implement",
    "five-lane",
    "scope/diff",
    "tests/evidence",
    "package/payload",
    "security/provenance",
    "real-surface/docs",
    "DoneClaim",
    "cleanup receipt",
    "all lanes"
  ]);
  assertContainsAll(agentRoster, [
    "explore-before-ask",
    "approval gate",
    "dynamic adversarial planning",
    "SHA-pinned",
    "permission hygiene"
  ]);
});

test("static skill corpus captures deepened guardrail contracts", async () => {
  const crucible = await readText("skills/lit-crucible/SKILL.md");
  const releaseGuardrails = await readText("skills/release-guardrails/SKILL.md");
  const litresearch = await readText("skills/litresearch/SKILL.md");
  const initDeep = await readText("skills/lit-init/SKILL.md");
  const toolGuards = await readText("skills/tool-guards/SKILL.md");
  const publicFetch = await readText("skills/lit-fetch/SKILL.md");
  const searchIdeas = await readText("skills/search-workflow-ideas/SKILL.md");

  assertContainsAll(crucible, [
    "Frame",
    "Ground",
    "Fan out",
    "Critique",
    "Defend",
    "Distill",
    "readiness verdict",
    "planning-only"
  ]);
  assertContainsAll(releaseGuardrails, [
    "real git diff",
    "pack/install evidence",
    "Do not publish",
    "bump versions",
    "create tags",
    "dry-run-first"
  ]);
  assertContainsAll(litresearch, [
    "claim/source/confidence/uncertainty/evidence graph",
    "FetchAttempt",
    "FetchVerdict",
    "untrusted data",
    "prompt-injection",
    "authentication",
    "private-network"
  ]);
  assertContainsAll(initDeep, ["read-only discovery", "dry-run-first", "Falsify"]);
  assertContainsAll(toolGuards, ["dry-run-first", "read-only", "falsifiable"]);
  assertContainsAll(publicFetch, [
    "FetchAttempt",
    "FetchVerdict",
    "HTTP 200",
    "inert evidence",
    "claim/source/confidence/uncertainty",
    "private content"
  ]);
  assertContainsAll(searchIdeas, [
    "fetch-attempt-verdict-schema",
    "browser-rendered public inspection is guidance only",
    "claim-graph",
    "prompt-injection",
    "dry-run-first"
  ]);
});

test("visualqa.current-native-boundary.characterization visual QA is native-installed, browserless, and cleanup-safe", async () => {
  const visualQa = [
    await readText("skills/visual-qa/SKILL.md"),
    await readText("skills/visual-qa/references/complete-contract.md")
  ].join("\n");

  assertContainsAll(visualQa, [
    "native-installed",
    "not a browser executor",
    "capability-first",
    "existing project Playwright",
    "user-configured backend",
    "does not make a browser callable",
    "Do not add MCP routes",
    "Do not install Playwright",
    "BLOCKED receipt",
    "session-scoped reuse",
    "verified PID, port, and command ownership",
    "cross-repo daemon",
    "cookie, profile, or session",
    "authenticated profile persistence",
    "timeout",
    "cancel",
    "hung command",
    "inert data",
    "dirty worktree",
    "advisory unless mechanically hardened",
    "runtime skill catalog"
  ]);
  assertContainsAll(visualQa, [
    "offline read-only validators",
    "no command, tool, hook, agent, MCP route",
    "authentication flow",
    "write authority"
  ]);
});

test("UI/UX lazy contracts use beta evidence rules without stale fixed resource counts", async () => {
  const frontend = await readText("skills/frontend-ui-ux/references/complete-contract.md");
  const direction = await readText("skills/frontend-ui-ux/references/product-direction.md");
  const visual = await readText("skills/visual-qa/references/complete-contract.md");
  const lazyDocs = `${frontend}\n${direction}\n${visual}`;
  assert.match(frontend, /canonical `litfamily\.design-contract\/v1beta2`/u);
  assert.match(visual, /smoke.*does not require|smoke.*without.*review/is);
  assert.match(visual, /host-proven|host.*provenance/i);
  assert.match(visual, /every helper import resolves inside.*visual-qa/is);
  assert.doesNotMatch(lazyDocs, /managed-skill-manifest OK: \d+ canonical asset/u);
  assert.doesNotMatch(lazyDocs, /validates (?:exactly )?as `?(?:litfamily\.design-contract\/)?v1alpha1/u);
  assert.doesNotMatch(lazyDocs, /output is one canonical `litfamily\.design-contract\/v1alpha1`/u);
  assert.doesNotMatch(visual, /Exactly two independent receipts/u);
});

test("frontend motion guidance is routed and enrolled as a managed reference", async () => {
  const skill = await readText("skills/frontend-ui-ux/SKILL.md");
  const referenceIndex = await readText("skills/frontend-ui-ux/references/complete-contract.md");
  const motion = await readText("skills/frontend-ui-ux/references/motion-guide.md");
  const manifest = JSON.parse(await readText("skills/managed-skill-manifest.json"));

  assert.match(skill, /references\/motion-guide\.md/u);
  assert.match(skill, /Phase 3 capture examples.*references\/complete-contract\.md/u);
  assert.match(referenceIndex, /\[motion-guide\.md\]/u);
  assert.match(referenceIndex, /skills\/frontend-ui-ux\/examples\/motion\/<case>\//u);
  assert.match(referenceIndex, /before\.png.*after\.png.*case\.json/u);
  assert.match(referenceIndex, /prompt, model and host, viewport, and screenshot provenance/u);
  assert.match(motion, /prefers-reduced-motion/u);
  assert.match(motion, /root margin/u);
  assert.match(motion, /60 ms/u);
  assert.ok(
    manifest.skills["frontend-ui-ux"].canonicalFiles.some((asset) => asset.path === "references/motion-guide.md"),
    "managed manifest must hash and install the motion guide"
  );
});

test("frontend UI/UX keeps v1beta1 as an explicit compatibility format", async () => {
  const frontend = await readText("skills/frontend-ui-ux/references/complete-contract.md");
  assert.match(
    frontend,
    /Compatibility:\s+valid `litfamily\.design-contract\/v1beta1` documents remain accepted and evidence-eligible\./u
  );
});

test("a valid v1beta1 Design Contract remains evidence-eligible", () => {
  const result = validateDesignContract(validBetaDesignContract());
  assert.equal(result.valid, true, result.issues.join("; "));
  assert.equal(result.schema, "litfamily.design-contract/v1beta1");
  assert.equal(result.evidence_eligible, true);
});

test("frontend UI/UX evidence review keeps optional narrative advice separate from rendered verdicts", async () => {
  const evidenceReview = await readText("skills/frontend-ui-ux/references/evidence-review.md");

  assert.match(
    evidenceReview,
    /Optional narrative check/u,
    "G13_GUIDANCE_PRESENT: evidence-review.md should define the optional narrative check"
  );
  assert.match(
    evidenceReview,
    /implied narrative or progression/u,
    "G13_OPTIONAL_ADVISORY_QUESTIONS: evidence-review.md should name implied narrative or progression"
  );
  assert.match(
    evidenceReview,
    /semantic feel/u,
    "G13_OPTIONAL_ADVISORY_QUESTIONS: evidence-review.md should name semantic feel"
  );
  assert.match(
    evidenceReview,
    /not schema fields/u,
    "G13_OPTIONAL_ADVISORY_QUESTIONS: evidence-review.md should keep advisory questions out of schema fields"
  );
  assert.match(
    evidenceReview,
    /does not assign a rendered verdict/u,
    "G13_PRESERVES_EXISTING_CONTRACT: evidence review must not assign a rendered verdict"
  );
  assert.match(
    evidenceReview,
    /visual-qa[\s\S]*owns rendered evidence and verdicts/u,
    "G13_PRESERVES_EXISTING_CONTRACT: visual-qa must own rendered evidence and verdicts"
  );
});

registerVisualQaEvidenceContract({ readOptionalText });

test("docs describe lit-plan to start-work to review-work without borrowed execution-mode names", async () => {
  const readme = await readText("README.md");
  const startWork = await readText("skills/start-work/SKILL.md");
  const commands = await readText("src/commands.ts");
  const tools = await readText("src/tools.ts");
  const docs = readme + "\n" + startWork + "\n" + commands + "\n" + tools;

  assertContainsAll(docs, [
    "lit-plan",
    "explicit user confirmation",
    "start-work",
    "execution-only",
    "approved plan",
    "review-work"
  ]);
  assert.doesNotMatch(docs, /\bAtlas\b/i);
  assert.doesNotMatch(docs, /current durable goal/i);
});

test("public README omits maintainer benchmark terminology while release checklist keeps claim guards", async () => {
  const readme = await readText("README.md");
  const releaseChecklist = await readText("docs/release-checklist.md");

  assert.doesNotMatch(readme, /\bREFERENCE\b/);
  assert.doesNotMatch(readme, /benchmark-backed superiority claims/i);
  assert.doesNotMatch(readme, /unconditional all-task superiority/i);
  assert.doesNotMatch(readme, /^v0\.1\.\d+ /m);
  assertContainsAll(releaseChecklist, [
    "benchmark-backed superiority",
    "classifyReferenceSuperiorityClaim",
    "benchmarkGateAllowsStrongClaim",
    "universal",
    "blocked"
  ]);
});

test("operational reference Runtime Skills catalog exactly matches the actual top-level skill directories", async () => {
  const readme = await readText("docs/reference.md");
  const runtimeSkillsSection = markdownSection(readme, "Runtime Skills");
  const actualSkillIds = (await listTopLevelSkillDocs()).map(({ skillId }) => skillId).sort();
  const catalogSkillIds = [...runtimeSkillsSection.matchAll(/^- <code>([a-z0-9]+(?:-[a-z0-9]+)*)<\/code>$/gm)]
    .map((match) => match[1])
    .sort();

  assert.equal(new Set(catalogSkillIds).size, catalogSkillIds.length, "Runtime Skills catalog should not repeat ids");
  assert.deepEqual(
    catalogSkillIds,
    actualSkillIds,
    "Runtime Skills catalog should exactly match skills/*/SKILL.md; additions, omissions, and stale ids must fail"
  );
});

test("release docs do not hard-code a stale top-level skill count", async () => {
  const readme = await readText("README.md");
  const releaseChecklist = await readText("docs/release-checklist.md");

  assert.doesNotMatch(readme, /\b\d+-skill Runtime Skills catalog\b/i);
  assert.doesNotMatch(releaseChecklist, /\ball \d+ actual top-level `skills\/\*\/SKILL\.md` directories\b/i);
});

test("every top-level skill pairs evidence with a blocked/hard-stop/failure boundary", async () => {
  const skillDocs = await listTopLevelSkillDocs();

  for (const { skillPath, text } of skillDocs) {
    assert.ok(boundedToken(text, "evidence"), `${skillPath} should mention evidence`);
    assert.match(
      text,
      evidenceBoundaryPattern,
      `${skillPath} should pair evidence with a blocked/hard-stop/failure outcome`
    );
  }
});

const outputChannelByGenre = new Map([
  ["client_deliverable", ["reply"]],
  ["internal_analysis", ["designated_section", "reply"]],
  ["audit_report", ["methodology_paragraph", "reply"]],
  ["working_note", ["inline", "reply"]],
  ["no_artifact", ["reply"]]
]);
const lazyOutputChannelSkills = new Set(["frontend-ui-ux", "visual-qa"]);

test("every top-level skill declares where its limitations are written", async () => {
  const skillDocs = await listTopLevelSkillDocs();
  assert.ok(skillDocs.length > 0, "expected a skill corpus to enumerate");

  for (const { skillId, skillPath, text } of skillDocs) {
    // A skill whose dense contract detail is lazily routed declares there instead,
    // because the activation prompt embeds the whole SKILL.md under a byte budget.
    const lazyContractPath = path.join("skills", skillId, "references", "complete-contract.md");
    let declaring = skillPath;
    let body = text;
    if (!text.includes("#contract.output_channels")) {
      assert.ok(
        lazyOutputChannelSkills.has(skillId),
        `${skillPath} must declare #contract.output_channels directly`
      );
      declaring = lazyContractPath;
      body = await readText(lazyContractPath).catch(() => {
        assert.fail(`${skillPath} declares no #contract.output_channels and has no ${lazyContractPath}`);
      });
    }

    const genre = body.match(/^artifact_genre:\s*(\S+)\s*$/mu)?.[1];
    assert.ok(
      genre !== undefined,
      `${declaring} must declare artifact_genre under #contract.output_channels`
    );
    const allowedChannels = outputChannelByGenre.get(genre);
    assert.ok(allowedChannels, `${declaring} declares unknown artifact_genre "${genre}"`);

    const channel = body.match(/^limitations_channel:\s*(\S+)\s*$/mu)?.[1];
    assert.ok(allowedChannels.includes(channel), `${declaring} routes ${genre} limitations to "${channel}"`);
  }
});
