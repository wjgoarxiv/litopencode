import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { detectChatActivationMode, promptForChatActivationMode } from "../src/activation-routing.ts";
import { createChatMessageActivationHook } from "../src/activation.ts";
import { litOpenCodeRuntimeSkills } from "../src/skills.ts";
import { litOpenCodeFeatures } from "../src/features.ts";
import { managedSkillDefinition, managedSkillDiscoveryDescription } from "../src/cli/managed-skill-assets.ts";
import { motionPrewarmSkipped } from "../src/cli/motion-runtime.ts";
import { runCli } from "../test-support/cli-fixture.ts";
import { completionState } from "../skills/lit-typographic-motion/gate.mjs";
import { eojeols, fnv1a32, mulberry32, passSeed, plain, readingFloor, scriptRuns, selectPreset, smart } from "../skills/lit-typographic-motion/engine/text.mjs";
import { buildTimeline, pinnedSampleTimes } from "../skills/lit-typographic-motion/engine/timing.mjs";
import { postOverrideTable } from "../skills/lit-typographic-motion/engine/constants.mjs";

const skillId = "lit-typographic-motion";
const skillRoot = path.resolve("skills", skillId);
const motionLoaded = /load lit-typographic-motion with OpenCode's native skill tool/u;

function walk(root, rel = "") {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((entry) => {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(root, next) : [next];
  });
}

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---- routing: this product's own corpus, run through the real router (MO-C-18..24) ----
const positives = [
  "이 짧은 시 한 구절로 키네틱 타이포 영상 하나 만들어 줘 lit",
  "우리 동아리 행사 오프닝 타이틀 제작해 줘 lit",
  "동아리 소개 인트로 영상 뽑아 줘 lit",
  "팟캐스트 첫 회용 모션그래픽 만들어 줘 lit",
  "발표 영상 하나 만들어 줘 lit",
  "타이포그래피 영상으로 만들어 줘 lit",
  "create a lyric video for this verse lit",
  "render a title sequence for the conference keynote lit",
  "produce a short kinetic typography clip about our harbour festival lit",
  "turn this tagline into a typographic motion piece lit",
  "make a presentation video for the team offsite lit"
];

test("motion corpus: video creation requests route to lit-typographic-motion before slides or interface", () => {
  for (const text of positives) {
    assert.equal(detectChatActivationMode(text), "lit-task", text);
    const prompt = promptForChatActivationMode("lit-task", text);
    assert.match(prompt, motionLoaded, text);
    assert.doesNotMatch(prompt, /load lit-pptx|load lit-docx|lit-diagram-drawer/u, text);
  }
});

// No-copy creation requests across genres: the route gives the neutral film context, never a path
// verdict, and no type-led hint (the hint never claims the reverse).
const noCopyRequests = [
  "우리 동네 도서관 야간 개관을 알리는 영상 만들어줘 lit",
  "make a short video explaining how a heat pump moves warmth lit",
  "브랜드 분위기를 보여주는 30초 영상 제작해줘 lit",
  "create a motion graphics piece for a jazz trio's autumn tour lit",
  "animate a clip showing a bakery's morning routine lit",
  "render a 9:16 video for a hiking club's first snow walk lit",
  "천문대 관측의 밤 행사 영상 하나 뽑아 줘 lit"
];
const typeLedRequests = [
  ["이 짧은 시 한 구절로 키네틱 타이포 영상 하나 만들어 줘 lit", /키네틱 타이포/u],
  ["create a lyric video for this verse lit", /lyric video/u],
  ["render a title sequence for the conference keynote lit", /title sequence/u],
  ["\"물은 낮은 곳으로 흐른다\" 이 문장으로 영상 만들어줘 lit", /a quoted span of 4 words/u],
  ["make a video of the line 'slow mornings, open windows' lit", /a quoted span of 4 words/u]
];

test("no-copy creation requests in six genres route to the neutral film context without a hint", () => {
  for (const text of noCopyRequests) {
    assert.equal(detectChatActivationMode(text), "lit-task", text);
    const prompt = promptForChatActivationMode("lit-task", text);
    assert.match(prompt, /This is a film request\./u, text);
    assert.match(prompt, motionLoaded, text);
    assert.match(prompt, /write treatment\.json in the film's output directory before any render/u, text);
    assert.match(prompt, /Path rule: the type path when the words themselves are the film, at 16:9; the stage path for every other film and every 9:16 film\./u, text);
    assert.match(prompt, /Hand-encoded films are not the deliverable\./u, text);
    assert.doesNotMatch(prompt, /type-led cue found/u, text);
  }
});

test("type-led requests raise the type-led cue hint, and a quote is detected without being echoed", () => {
  for (const [text, cue] of typeLedRequests) {
    const prompt = promptForChatActivationMode("lit-task", text);
    assert.match(prompt, motionLoaded, text);
    const hint = prompt.match(/type-led cue found: (.+)/u);
    assert.ok(hint, `${text} raises the hint`);
    assert.match(hint[1], cue, text);
    assert.doesNotMatch(hint[1], /물은|slow mornings/u, "the quoted words themselves are never echoed");
  }
});

test("the neutral film context stays under 700 bytes of prose and names each installed script once", () => {
  const prompt = promptForChatActivationMode("lit-task", noCopyRequests[0]);
  const context = prompt.slice(prompt.indexOf("This is a film request"), prompt.indexOf("</lit-task-mode>"));
  const [prose, commands] = context.split("\nCommands: ");
  assert.ok(Buffer.byteLength(prose, "utf8") <= 700, `${Buffer.byteLength(prose, "utf8")} bytes of prose`);
  assert.equal((commands.match(/render\.mjs'/gu) ?? []).length, 1);
  assert.equal((commands.match(/gate\.mjs'/gu) ?? []).length, 1);
  for (const sub of ["film", "stills", "stage", "sound", "look", "gate", "--done <dir>"]) assert.ok(commands.includes(sub), sub);
});

// Every Wave 1 premise and mandate string is gone from every surface the host reads before the
// skill body: route text, SKILL.md and its references, the managed description, the runtime catalog,
// the feature registry, CLI help and the reference docs.
const retiredPremises = [
  /kinetic[- ]type(?:graphy)? film/iu, /typographic film/iu, /WebGL2 (?:typographic )?films?/iu, /not this skill's deliverable/iu,
  /engine path is required/iu, /only the engine/iu, /HTML film/iu, /only a gate result counts/iu,
  /narrowly relevant skill for this video/iu, /Motion-video request/u, /hand-made ffmpeg/iu
];
test("the Wave 1 premise and mandate strings are gone from every shipped surface", () => {
  const surfaces = [
    ...[...noCopyRequests, ...typeLedRequests.map(([text]) => text)].map((text) => ["route", promptForChatActivationMode("lit-task", text)]),
    ["loop route", promptForChatActivationMode("lit-loop", "make a lyric video and continue until all scenes pass lit loop")],
    ["SKILL.md", fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8")],
    ...fs.readdirSync(path.join(skillRoot, "references")).map((name) => [name, fs.readFileSync(path.join(skillRoot, "references", name), "utf8")]),
    ["managed description", managedSkillDiscoveryDescription(skillId)],
    ["runtime catalog", JSON.stringify(litOpenCodeRuntimeSkills.find((entry) => entry.id === skillId))],
    ["feature registry", JSON.stringify(litOpenCodeFeatures.find((feature) => feature.id === skillId))],
    ["help", runCli(["--help"]).stdout],
    ["reference docs", fs.readFileSync("docs/reference.md", "utf8") + fs.readFileSync("docs/reference-Ko-KR.md", "utf8")]
  ];
  for (const [name, text] of surfaces) for (const premise of retiredPremises) assert.doesNotMatch(text, premise, `${name} still carries ${premise}`);
});

test("motion corpus: slide and report requests without a video noun still reach the office skills", () => {
  for (const [text, skill] of [["분기 실적 발표자료 만들어 줘 lit", "lit-pptx"], ["draft the board slide deck lit", "lit-pptx"], ["produce a quarterly report lit", "lit-docx"]]) {
    assert.equal(detectChatActivationMode(text), "lit-task", text);
    const prompt = promptForChatActivationMode("lit-task", text);
    assert.match(prompt, new RegExp(`load ${skill}`, "u"), text);
    assert.doesNotMatch(prompt, motionLoaded, text);
  }
});

test("motion corpus: interface typography and embedded-video requests stay with frontend-ui-ux", () => {
  for (const text of [
    "설정 화면 타이포그래피 정리해서 다시 디자인해 줘 lit",
    "design the typography for our pricing page lit",
    "랜딩 페이지에 배경 영상 넣어서 만들어 줘 lit",
    "embed a background video in the landing page lit",
    "design motion tokens for the checkout screen lit",
    "polish the pricing page layout lit"
  ]) assert.equal(detectChatActivationMode(text), "frontend-ui-ux", text);
});

test("motion corpus: exclusions, bare motion and verbs alone never reach the motion skill", () => {
  for (const text of [
    "이 영상 편집해서 자막 넣어 줘 lit",
    "trim this clip and add captions lit",
    "보고서에 이 영상 삽입해 줘 lit",
    "영상 썸네일 만들어 줘 lit",
    "write a script for our onboarding video lit",
    "이 영상 요약해 줘 lit",
    "이 버튼에 모션 넣어 줘 lit",
    "draft a motion for the committee to vote on lit",
    "인트로 만들어 줘 lit",
    "render the chart as a PNG lit",
    "이 포스터 뽑아 줘 lit",
    "render a thumbnail for the video lit",
    "produce captions for this clip lit",
    "animate the modal on the settings page lit"
  ]) {
    const mode = detectChatActivationMode(text);
    const prompt = mode ? promptForChatActivationMode(mode, text) : "";
    assert.doesNotMatch(prompt, motionLoaded, text);
  }
});

test("motion corpus: no lit means no motion route, and the interface fallback does not claim it", () => {
  assert.equal(detectChatActivationMode("키네틱 타이포 영상 만들어 줘"), undefined);
  assert.equal(detectChatActivationMode("make a title sequence for the landing screen"), undefined);
});

test("motion corpus: explicit lit routes and the planning agent keep their own modes", () => {
  assert.equal(detectChatActivationMode("make a lyric video lit", "lit-plan"), "lit-plan");
  assert.equal(detectChatActivationMode("lit plan a kinetic type video for the garden tour"), "lit-plan");
  const loop = "make a lyric video and continue until all scenes pass lit loop";
  assert.equal(detectChatActivationMode(loop), "lit-loop");
  assert.match(promptForChatActivationMode("lit-loop", loop), motionLoaded);
});

test("motion activation stays inside the 4352-byte activation budget", async () => {
  const root = tmp("ltm-activation-");
  try {
    const hook = createChatMessageActivationHook(root, { getSession: async () => ({ id: "session-motion" }) });
    const text = "create a lyric video for this verse lit";
    const output = { message: { id: "message-motion", role: "user", sessionID: "session-motion" }, parts: [{ type: "text", text }] };
    await hook({ sessionID: "session-motion", messageID: "message-motion", agent: "build" }, output);
    const injection = output.parts.find((part) => part.metadata?.litopencode);
    assert.match(injection.text, motionLoaded);
    assert.ok(Buffer.byteLength(injection.text, "utf8") <= 4352, `${Buffer.byteLength(injection.text, "utf8")} bytes`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- route context -> installed, resolvable commands (Test 4) and symlinked launches (Test 5) ----
test("the route context names installed render and gate commands that resolve and print their own usage", () => {
  const root = tmp("ltm-install-");
  const previous = process.env.OPENCODE_CONFIG_DIR;
  try {
    const install = runCli(["install", "--root", root]);
    assert.equal(install.status, 0, install.stderr);
    process.env.OPENCODE_CONFIG_DIR = root;
    const prompt = promptForChatActivationMode("lit-task", "render a title sequence for the conference keynote lit");
    const installed = fs.realpathSync(path.join(root, "skills", skillId));
    for (const [script, banner] of [["render.mjs", /^lit-typographic-motion render$/mu], ["gate.mjs", /^lit-typographic-motion gate$/mu]]) {
      const match = prompt.match(new RegExp(`node '([^']+/${script.replace(".", "\\.")})'`, "u"));
      assert.ok(match, `route context names ${script}`);
      assert.ok(path.isAbsolute(match[1]));
      assert.ok(fs.realpathSync(match[1]).startsWith(installed + path.sep), `${match[1]} is under the installed skill`);
      const help = spawnSync(process.execPath, [match[1], "--help"], { encoding: "utf8" });
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, banner, `${script} --help prints its own banner`);
    }
    assert.match(install.stdout.replace(/\n/gu, " "), /Motion runtime: pre-warm skipped \(test run\); run litopencode motion-runtime install/u);
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every motion CLI launched through a symlinked directory prints real output", () => {
  const dir = tmp("ltm-symlink-");
  try {
    const link = path.join(dir, "linked-skill");
    fs.symlinkSync(skillRoot, link, "dir");
    for (const [script, banner] of [["render.mjs", /lit-typographic-motion render/u], ["gate.mjs", /lit-typographic-motion gate/u], ["runtime.mjs", /lit-typographic-motion runtime/u], ["probe.mjs", /lit-typographic-motion probe/u]]) {
      const result = spawnSync(process.execPath, [path.join(link, script), "--help"], { encoding: "utf8" });
      assert.equal(result.status, 0, `${script}: ${result.stderr}`);
      assert.match(result.stdout, banner, `${script} ran its main instead of exiting silently`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- enrollment, orphans, corpus and caps (Test 6) ----
test("the skill is enrolled in the runtime catalog, features, managed manifest, parity and docs", () => {
  const skill = litOpenCodeRuntimeSkills.find((entry) => entry.id === skillId);
  assert.ok(skill, "runtime catalog");
  assert.ok(litOpenCodeFeatures.some((feature) => feature.id === skillId), "feature catalog");
  const definition = managedSkillDefinition(skillId);
  assert.ok(definition, "managed skill definition");
  assert.match(managedSkillDiscoveryDescription(skillId), /Write the treatment first/u);
  const onDisk = walk(skillRoot).filter((file) => file !== "SKILL.md").sort();
  assert.deepEqual(definition.canonicalFiles.map((asset) => asset.path).sort(), onDisk, "every file in the skill is pinned and installed");
  const parity = JSON.parse(fs.readFileSync("tools/payload-substance-parity.json", "utf8"));
  assert.ok(JSON.stringify(parity).includes(`"${skillId}"`), "payload substance parity");
  assert.match(fs.readFileSync("docs/reference.md", "utf8"), new RegExp(`- <code>${skillId}</code>`, "u"));
  const help = runCli(["--help"]);
  assert.match(help.stdout, /litopencode motion-runtime install\|status/u);
  assert.match(help.stdout, /lit-typographic-motion/u);
});

test("the packed payload carries the engine, lockfile, notices, fonts and pins but no test data", () => {
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(pack.status, 0, pack.stderr);
  const files = new Set(JSON.parse(pack.stdout)[0].files.map((entry) => entry.path));
  for (const rel of ["SKILL.md", "render.mjs", "gate.mjs", "runtime.mjs", "probe.mjs", "package-lock.json", "NOTICE", "THIRD_PARTY_NOTICES", "fonts/pins.json", "fonts/stroke/OFL.txt", "fonts/stroke/CREDITS", "engine/page/engine.js", "word-timing-models.json", "requirements-audio.txt",
    "engine/treatment.mjs", "engine/stills.mjs", "engine/encode.mjs", "engine/stage/stage-kit.js", "engine/stage/clock.js", "engine/stage/capture.mjs", "engine/stage/scan.mjs", "engine/stage/render.mjs", "engine/stage/gate.mjs", "engine/stage/frame-worker.mjs",
    "references/treatment.md", "references/stage.md"]) {
    assert.ok(files.has(`skills/${skillId}/${rel}`), `pack lacks ${rel}`);
  }
  assert.equal([...files].some((file) => /motion-forbidden|motion-fixture|motion-treatment|motion-stage|fixtures\/stage\//u.test(file)), false, "guard data and stage fixtures stay out of the pack");
});

test("SKILL.md stays lean, contract-shaped, and the references carry the dense detail", () => {
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.ok(Buffer.byteLength(skill, "utf8") <= 6144, `SKILL.md is ${Buffer.byteLength(skill, "utf8")} bytes`);
  for (const heading of ["#contract.activation", "#contract.inputs", "#contract.mode_matrix", "#contract.procedure", "#contract.runtime", "#contract.outputs", "#contract.output_channels", "#contract.evidence", "#contract.hard_stops", "#contract.anti_patterns"]) assert.ok(skill.includes(`## ${heading}`), heading);
  for (const phrase of [/ask no questions/u, /--stills-only/u, /gate\.mjs --done/u, /BLOCKED exit 10/u, /Hand-encoded films/u, /MO-B-00/u, /references\/treatment\.md` only/u]) assert.match(skill, phrase);
  const references = ["treatment.md", "style-bibles.md", "authoring.md", "type-craft.md", "craft-loop.md", "runtime.md"];
  let words = 0;
  for (const name of references) {
    const text = fs.readFileSync(path.join(skillRoot, "references", name), "utf8");
    assert.match(skill, new RegExp(`references/${name.replace(".", "\\.")}`, "u"), `SKILL.md points to ${name}`);
    words += text.split(/\s+/u).filter(Boolean).length;
  }
  assert.ok(words >= 3500, `references hold ${words} words`);
});

test("bundled fonts stay under the per-file and aggregate caps, and fetched fonts are pinned", () => {
  const pins = JSON.parse(fs.readFileSync(path.join(skillRoot, "fonts", "pins.json"), "utf8"));
  let total = 0;
  for (const rel of Object.keys(pins.bundled).filter((file) => /\.(?:ttf|otf|svg)$/u.test(file))) {
    const size = fs.statSync(path.join(skillRoot, rel)).size;
    assert.ok(size <= 1_000_000, `${rel} is ${size} bytes`);
    total += size;
  }
  assert.ok(total <= 4_000_000, `bundled fonts total ${total} bytes`);
  for (const [name, pin] of Object.entries({ ...pins.fetched, ...pins.fallback })) {
    assert.match(pin.sha256, /^[0-9a-f]{64}$/u, name);
    assert.match(pin.url, /^https:\/\//u, name);
  }
  assert.equal(Object.keys(pins.bundled).some((file) => /Bitmap|DotGothic|Hershey/u.test(file)), false);
});

// ---- credit (Test 2) ----
const expectedNotice = `Portions of this engine are adapted from mexicat/pdoom-video
(https://github.com/mexicat/pdoom-video), commit
ca251e3dddda422b364385eb484b5a3593a0990d.

Copyright (c) 2026 Giacomo Magnanini

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

test("NOTICE is the verbatim MIT credit, and the one-line credit is on the help surface", () => {
  assert.equal(fs.readFileSync(path.join(skillRoot, "NOTICE"), "utf8"), expectedNotice);
  const help = runCli(["--help"]);
  assert.match(help.stdout, /Typographic-motion engine adapted from mexicat\/pdoom-video \(MIT, Giacomo Magnanini\), commit `ca251e3`\./u);
});

test("THIRD_PARTY_NOTICES names every preset font with a licence path that exists or is pinned", () => {
  const notices = fs.readFileSync(path.join(skillRoot, "THIRD_PARTY_NOTICES"), "utf8");
  for (const font of ["Archivo", "VT323", "Silkscreen", "EMSAllure", "LitOpenCode Sans", "Galmuri9", "MesloLGS NF"]) assert.match(notices, new RegExp(font, "u"), font);
  for (const rel of ["fonts/Archivo-OFL.txt", "fonts/VT323-OFL.txt", "fonts/Silkscreen-OFL.txt", "fonts/stroke/OFL.txt", "fonts/stroke/CREDITS", "../lit-pptx/pretendard-font/LICENSE.txt"]) {
    assert.match(notices, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), rel);
    assert.ok(fs.existsSync(path.join(skillRoot, rel)), rel);
  }
  const pins = JSON.parse(fs.readFileSync(path.join(skillRoot, "fonts", "pins.json"), "utf8"));
  for (const licence of ["Galmuri-OFL.md", "MesloLGS-NF-License.txt", "Apache-2.0.txt", "Vera-Arev-LICENSE"]) {
    assert.match(notices, new RegExp(licence.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.ok(pins.fetched[licence], `${licence} is pinned for pre-warm`);
  }
});

// ---- determinism guards and licence-forbidden analysers ----
test("no wall clock or unseeded randomness in any visual code path, and no forbidden analysers", () => {
  for (const file of [...fs.readdirSync(path.join(skillRoot, "engine", "page")).map((name) => `engine/page/${name}`), "engine/timing.mjs", "engine/text.mjs", "engine/flash.mjs"]) {
    const source = fs.readFileSync(path.join(skillRoot, file), "utf8");
    assert.doesNotMatch(source, /Math\.random\(|Date\.now\(|performance\.now\(|new Date\(/u, file);
  }
  const requirements = fs.readFileSync(path.join(skillRoot, "requirements-audio.txt"), "utf8").toLowerCase();
  for (const name of ["aubio", "essentia", "madmom"]) assert.equal(new RegExp(`^${name}==`, "mu").test(requirements), false, name);
  assert.equal(motionPrewarmSkipped({ NODE_TEST_CONTEXT: "child-v8" }), "test run");
  assert.equal(motionPrewarmSkipped({ NODE_TEST_CONTEXT: "child-v8", LITOPENCODE_MOTION_PREWARM: "force" }), undefined);
});

// ---- engine units (Test 7) ----
test("seed vectors: fnv1a32, the MO-SH-01 formula and mulberry32", () => {
  assert.equal(fnv1a32(""), 0x811c9dc5);
  assert.equal(fnv1a32("a"), 0xe40c292c);
  assert.equal(passSeed(20260926, "title-slam", 0, "dither"), 3693088578);
  const random = mulberry32(1);
  assert.equal(random(), 0.6270739405881613);
  assert.equal(random(), 0.002735721180215478);
});

test("pinned sub-sample times follow t_n + (shutter/fps)((i + 0.5)/N - 0.5), clamped at 0", () => {
  assert.deepEqual(pinnedSampleTimes(0, 4, 0.5, 60), [0, 0, 0.0010416666666666667, 0.003125]);
  const times = pinnedSampleTimes(60, 4, 0.5, 60);
  assert.ok(Math.abs(times[0] - (1 - 0.003125)) < 1e-12 && Math.abs(times[3] - (1 + 0.003125)) < 1e-12);
  assert.deepEqual(pinnedSampleTimes(30, 1, 0.5, 60), [0.5]);
});

test("the one reading-floor function covers English, Korean, mixed, word and reveal units", () => {
  assert.equal(readingFloor("Test Title", "line"), 0.9);
  assert.ok(Math.abs(readingFloor("여름밤의 작은 축제가 시작됩니다", "line") - 2.8) < 1e-9, "a 4-어절 line with 14 Hangul syllables floors at 2.8 s");
  assert.ok(Math.abs(readingFloor("LIT 스튜디오 2026년 개막", "line") - (0.2 * 7 + 2 / 3.3)) < 1e-9);
  assert.equal(readingFloor("Go", "word"), 0.5);
  assert.equal(readingFloor("a very long revealed word", "reveal"), 0.35);
  assert.equal(readingFloor("새", "line"), 1.0);
});

test("어절 breaking, script runs and typographic punctuation", () => {
  assert.deepEqual(eojeols("우리는  오늘\t새로운"), ["우리는", "오늘", "새로운"]);
  assert.deepEqual(scriptRuns("2026년").map((run) => [run.script, run.text]), [["hangul", "2026년"]]);
  assert.deepEqual(scriptRuns("LIT팀").map((run) => [run.script, run.text]), [["latin", "LIT"], ["hangul", "팀"]]);
  assert.deepEqual(scriptRuns("LIT 스튜디오").map((run) => [run.script, run.text]), [["latin", "LIT "], ["hangul", "스튜디오"]]);
  assert.equal(smart(`"It's here..."`), "“It’s here…”");
  assert.equal(plain("“It’s here…”"), `"It's here..."`);
});

test("override vocabulary keeps the MO-A-58 ranges and neutral values", () => {
  assert.equal(postOverrideTable.fade.neutral, 1);
  assert.equal(postOverrideTable.bloomThreshold.neutral, 0.85);
  assert.equal(postOverrideTable.invert.kind, "boolean");
  assert.equal(postOverrideTable.flash.max, 1);
  assert.deepEqual(postOverrideTable.shake.neutral, [0, 0]);
});

test("MO-B-00 auto-pick: whole words only, first match wins, an explicit style wins", () => {
  assert.equal(selectPreset("a terminal boot log").id, "terminalcore");
  assert.equal(selectPreset("terminally tired founders").id, "swiss-signal");
  assert.equal(selectPreset("잔잔한 바다 위로").id, "tidal");
  assert.equal(selectPreset("새물결 캠페인").id, "swiss-signal");
  assert.equal(selectPreset("a calm terminal").id, "terminalcore");
  assert.equal(selectPreset("a calm terminal", "tidal").id, "tidal");
  assert.equal(selectPreset("payment system status").id, "swiss-signal");
});

test("the Tier-1 timeline snaps every start to the beat and never splits a 어절", () => {
  const { timeline } = buildTimeline({ scenes: [{ scene: "title-slam", text: "Open" }, { scene: "karaoke", text: "우리는 오늘 새로운 문을 연다" }] }, { bpm: 100 });
  for (const entry of timeline) assert.ok(Math.abs(entry.start / 0.6 - Math.round(entry.start / 0.6)) < 1e-9, entry.id);
  assert.deepEqual(timeline.filter((entry) => entry.kind === "reveal").map((entry) => entry.text), ["우리는", "오늘", "새로운", "문을", "연다"]);
  const karaoke = timeline.find((entry) => entry.scene === "karaoke");
  assert.ok(karaoke.holdSec >= 1.25 * readingFloor(karaoke.text, "line") - 1e-9);
});

// ---- completion contract ----
// The done check now needs look rounds as well as a gate PASS; its cases live in
// test/motion-look.test.mjs (a gate PASS alone, one round and a stale manifest are not done).
test("the done check is the gate's --done surface and names its four statuses", () => {
  const help = spawnSync(process.execPath, [path.join(skillRoot, "gate.mjs"), "--help"], { encoding: "utf8" });
  assert.match(help.stdout, /--done <output-dir>   \(0 DONE, 1 NOT DONE, 2 DONE_WITH_OPEN_ITEMS after round 3, 3 DONE_UNVIEWED\)/u);
  assert.equal(typeof completionState, "function");
});

test("doctor reports the five motion probes and names what the pre-warm is missing", () => {
  const root = tmp("ltm-doctor-");
  try {
    const result = runCli(["doctor", "--root", root], { env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache"), XDG_CONFIG_HOME: path.join(root, "config") } });
    assert.equal(result.status, 0, result.stderr);
    const motion = JSON.parse(result.stdout).motion;
    for (const key of ["chrome", "ffmpeg", "webgl2", "softwareWarning", "prewarm"]) assert.ok(key in motion, key);
    assert.equal(motion.prewarm.ready, false);
    assert.match(motion.prewarm.deps.join(" "), /pinned Node dependencies/u);
    assert.equal(motion.prewarm.fix, "litopencode motion-runtime install");
    assert.match(motion.webgl2.detail, /not pre-warmed|Chrome is missing/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every Chrome launch carries the mock-keychain flags, so no macOS keychain dialog appears", async () => {
  const { chromeFlagRungs } = await import("../skills/lit-typographic-motion/engine/constants.mjs");
  const { launchLadder } = await import("../skills/lit-typographic-motion/engine/browser.mjs");
  for (const platform of ["darwin", "linux", "win32"]) {
    for (const rung of chromeFlagRungs(platform)) {
      assert.ok(rung.flags.includes("--use-mock-keychain") && rung.flags.includes("--password-store=basic"), `${platform} ${rung.name}`);
    }
  }
  const seen = [];
  const fakeChromium = { launchPersistentContext: async (_profile, options) => { seen.push(options.args); throw new Error("fake launch refused"); } };
  const dir = tmp("ltm-keychain-");
  try {
    await assert.rejects(launchLadder(fakeChromium, "/nonexistent/chrome", dir), /Chrome failed to launch headless/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(seen.length, 2, "both rungs were tried");
  for (const args of seen) for (const flag of ["--use-mock-keychain", "--password-store=basic"]) assert.ok(args.includes(flag), flag);
});
