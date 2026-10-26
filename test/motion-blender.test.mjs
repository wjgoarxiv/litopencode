import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { BLENDER, blenderArgs, findBlender, readPlate, requirePlate } from "../skills/lit-typographic-motion/engine/blender.mjs";
import { scaffoldCommand, scaffoldHtml } from "../skills/lit-typographic-motion/engine/scaffold.mjs";
import { stageRung } from "../skills/lit-typographic-motion/engine/stage/render.mjs";
import { blenderProbe } from "../skills/lit-typographic-motion/probe.mjs";
import { stageTreatment, writeTreatment } from "../test-support/motion-treatment.mjs";

// The offline Blender rung: where Blender is, the command line it gets, the labelled fallback when it is
// absent, the plate the stage trusts, and the scaffold's word about it. No real Blender runs here; a
// fake executable stands in for it.
const skillRoot = path.resolve("skills", "lit-typographic-motion");
const render = path.join(skillRoot, "render.mjs");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const absent = "/nonexistent/lit-blender-test/Blender";

const solid = (extra = {}) => stageTreatment({
  request: "빗물 정원을 보여주는 고퀄 3D 영상 만들어줘 lit",
  visualDevices: [{ kind: "depth3d", role: "subject", beats: [0, 1, 2, 3] }, { kind: "diagram", role: "support", beats: [1, 2] }, { kind: "gradient", role: "texture", beats: [0, 1, 2, 3] }],
  depth: "3d",
  render3d: "blender",
  seed: 5_000_000_123,
  ...extra
});

// A fake Blender: records its arguments, writes the stills or frames the runner would, and the receipt.
function fakeBlender(dir, { fail = false } = {}) {
  const file = path.join(dir, "fake-blender");
  fs.writeFileSync(file, `#!${process.execPath}
const fs = require("node:fs");
const a = process.argv.slice(2);
const get = (name) => a[a.indexOf(name) + 1];
const out = get("--out");
fs.writeFileSync(out + ".argv.json", JSON.stringify(a));
if (${fail}) { console.error("Error: Python: scene.py line 3: boom"); process.exit(3); }
let names;
if (a.includes("--stills")) names = get("--stills").split(",").map((_, i) => "still-" + String(i + 1).padStart(2, "0") + ".png");
else { const [from, to] = get("--frames").split("-").map(Number); names = Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(6, "0") + ".png"); }
for (const name of names) fs.writeFileSync(out + "/" + name, "png " + name);
fs.writeFileSync(out + "/receipt.json", JSON.stringify({ blender: "9.9.9", engine: "CYCLES", device: "METAL", samples: Number(get("--samples")), percent: Number(get("--percent")), files: names }));
`, { mode: 0o755 });
  return file;
}

function filmDir(treatment = solid()) {
  const dir = tmp("lit-blender-");
  writeTreatment(dir, treatment);
  fs.mkdirSync(path.join(dir, "stage"), { recursive: true });
  fs.writeFileSync(path.join(dir, "stage", "scene.py"), "lit.camera((0, -6, 2))\n");
  return dir;
}

const cli = (args, env = {}) => spawnSync(process.execPath, [render, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

test("findBlender reads LITOPENCODE_BLENDER first and never second-guesses a path that is not there", () => {
  const dir = tmp("lit-blender-find-");
  try {
    const bin = path.join(dir, "Blender");
    fs.writeFileSync(bin, "");
    assert.deepEqual(findBlender({ env: { LITOPENCODE_BLENDER: bin } }), { path: bin, source: "LITOPENCODE_BLENDER" });
    assert.equal(findBlender({ env: { LITOPENCODE_BLENDER: absent, PATH: dir }, exists: (p) => p !== absent }), null, "an explicit path that is missing is a miss, not a reason to look further");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("findBlender then looks for the macOS app, then blender on PATH, and is null on a bare machine", () => {
  assert.deepEqual(findBlender({ env: { PATH: "" }, platform: "darwin", exists: (p) => p === BLENDER.macApp }), { path: BLENDER.macApp, source: "app" });
  const bin = path.join(path.sep, "opt", "bin", "blender");
  assert.deepEqual(findBlender({ env: { PATH: `/usr/bin${path.delimiter}/opt/bin` }, platform: "linux", exists: (p) => p === bin }), { path: bin, source: "PATH" });
  assert.equal(findBlender({ env: { PATH: "/usr/bin" }, platform: "linux", exists: () => false }), null);
  assert.equal(BLENDER.macApp, "/Applications/Blender.app/Contents/MacOS/Blender");
});

test("the command line is headless on factory settings with the runner, the seed below 2^31, and stills or a frame range", () => {
  const treatment = solid();
  const base = { treatment, scene: "/o/stage/scene.py", out: "/o/stage/plate" };
  const preview = blenderArgs({ ...base, quality: "preview" });
  assert.deepEqual(preview.slice(0, 5), ["-b", "--factory-startup", "-P", BLENDER.runner, "--"]);
  assert.equal(preview[preview.indexOf("--seed") + 1], String(5_000_000_123 % 2147483648));
  assert.ok(Number(preview[preview.indexOf("--seed") + 1]) < 2 ** 31);
  assert.equal(preview[preview.indexOf("--device") + 1], "METAL");
  assert.equal(preview[preview.indexOf("--percent") + 1], "50");
  assert.deepEqual(preview[preview.indexOf("--stills") + 1].split(",").map(Number), [2, 6, 10, 14], "the midpoint of each shot");
  assert.equal(preview.includes("--frames"), false);
  const final = blenderArgs({ ...base, quality: "final" });
  assert.equal(final[final.indexOf("--frames") + 1], "1-480", "16 s at 30 fps");
  assert.equal(final[final.indexOf("--percent") + 1], "100");
  assert.throws(() => blenderArgs({ ...base, quality: "draft" }), /preview or final/u);
});

test("the runner is a valid Python file that sets up Cycles and writes a receipt", () => {
  const runner = path.join(skillRoot, "engine", "blender", "runner.py");
  const check = spawnSync("python3", ["-I", "-c", "import sys; compile(open(sys.argv[1], encoding='utf-8').read(), sys.argv[1], 'exec')", runner], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  const source = fs.readFileSync(runner, "utf8");
  for (const word of ["CYCLES", "receipt.json", "--stills", "--frames", "--seed", "use_gpu"]) assert.ok(source.includes(word), word);
  assert.doesNotMatch(source, /LITCLAUDE|CLAUDE_|\.litclaude/u);
});

test("without Blender the command renders nothing, names the fallback and exits 0", () => {
  const dir = filmDir();
  try {
    const result = cli(["blender", "--out", dir], { LITOPENCODE_BLENDER: absent });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^FALLBACK: no Blender found/mu);
    assert.match(result.stdout, /render3d to "three"/u);
    assert.match(result.stdout, /LITOPENCODE_BLENDER/u);
    assert.equal(fs.existsSync(path.join(dir, "stage", "plate-preview")), false, "nothing was rendered");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a treatment that is not a Blender film, or has no scene.py, stops before Blender is looked for", () => {
  const three = filmDir(solid({ render3d: "three" }));
  const bare = tmp("lit-blender-bare-");
  try {
    const wrong = cli(["blender", "--out", three], { LITOPENCODE_BLENDER: absent });
    assert.equal(wrong.status, 2, wrong.stderr);
    assert.match(wrong.stderr, /render3d "blender"/u);
    writeTreatment(bare, solid());
    const missing = cli(["blender", "--out", bare], { LITOPENCODE_BLENDER: absent });
    assert.equal(missing.status, 17, missing.stderr);
    assert.match(missing.stderr, /scene\.py is missing/u);
  } finally { fs.rmSync(three, { recursive: true, force: true }); fs.rmSync(bare, { recursive: true, force: true }); }
});

test("a preview with a fake Blender writes stills and plate.json; the plate round-trips through readPlate", () => {
  const dir = filmDir();
  try {
    const result = cli(["blender", "--out", dir], { LITOPENCODE_BLENDER: fakeBlender(dir) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BLENDER preview: 4 stills/u);
    const stage = path.join(dir, "stage");
    const args = JSON.parse(fs.readFileSync(path.join(stage, "plate-preview.argv.json"), "utf8"));
    assert.deepEqual(args.slice(0, 3), ["-b", "--factory-startup", "-P"]);
    const plate = readPlate(stage, "plate-preview");
    assert.equal(plate.frames.length, 4);
    assert.equal(plate.kind, "preview");
    assert.equal(plate.blender, "9.9.9");
    fs.appendFileSync(path.join(stage, "plate-preview", "still-01.png"), "changed");
    assert.equal(readPlate(stage, "plate-preview"), null, "a frame that no longer matches its listed size voids the plate");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a failing Blender exits 17 with its last output, and a plate with too few frames is refused", () => {
  const dir = filmDir();
  try {
    const result = cli(["blender", "--out", dir, "--final"], { LITOPENCODE_BLENDER: fakeBlender(dir, { fail: true }) });
    assert.equal(result.status, 17, result.stderr);
    assert.match(result.stderr, /Blender final failed \(exit 3\)/u);
    assert.match(result.stderr, /boom/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the stage needs the whole plate for a Blender film and stays on the software rung", () => {
  const treatment = solid();
  assert.equal(stageRung(treatment), "swiftshader");
  assert.equal(stageRung(solid({ render3d: "three" })), "gpu");
  const dir = tmp("lit-blender-plate-");
  try {
    assert.throws(() => requirePlate(treatment, dir), (error) => error.exitCode === 17 && /plate\.json is missing/u.test(error.message) && /blender --out <dir> --final|render3d to "three"/u.test(error.message));
    const names = Array.from({ length: 3 }, (_, i) => `${String(i + 1).padStart(6, "0")}.png`);
    fs.mkdirSync(path.join(dir, "plate"));
    for (const name of names) fs.writeFileSync(path.join(dir, "plate", name), name);
    fs.writeFileSync(path.join(dir, "plate", "plate.json"), JSON.stringify({ kind: "final", blender: "9.9.9", engine: "CYCLES", device: "METAL", samples: 160, percent: 100, fps: 30, frames: names.map((name) => ({ name, bytes: name.length })) }));
    assert.throws(() => requirePlate(treatment, dir), (error) => error.exitCode === 17 && /the plate has 3 frames; a 16 s film needs 480/u.test(error.message));
    const short = solid({ durationSec: 0.1 });
    assert.equal(requirePlate({ ...short, durationSec: 0.1 }, dir).frames.length, 3);
    assert.equal(requirePlate(solid({ render3d: "three" }), dir), null, "a three.js film needs no plate");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("LitStage.plate shows plate/000001.png for t=0, follows the clock at the plate's fps, and clamps at the last frame", () => {
  const made = [];
  const body = { children: [], prepend(el) { this.children.unshift(el); } };
  const document = { createElement: () => { const el = { style: {}, replaceWith(next) { this.gone = true; body.children[body.children.indexOf(this)] = next; } }; made.push(el); return el; }, images: [], fonts: { ready: Promise.resolve() } };
  const sandbox = { document, performance: { now: () => 0 }, console, Element: class {}, Math };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(skillRoot, "engine", "stage", "stage-kit.js"), "utf8"), sandbox);
  const update = sandbox.LitStage.plate({ parent: body, fps: 30, count: 90 });
  assert.equal(update(0), 0);
  assert.equal(made[0].src, "plate/000001.png");
  assert.equal(update(0.01), 0, "the same frame is not replaced");
  assert.equal(made.length, 1);
  assert.equal(update(1), 30);
  assert.equal(made[1].src, "plate/000031.png");
  assert.equal(made[0].gone, true);
  assert.equal(update(99), 89);
  assert.equal(made.at(-1).src, "plate/000090.png");
  assert.throws(() => sandbox.LitStage.plate({ parent: body, count: 0 }), /needs \{ parent, count \}/u);
});

test("the scaffold of a Blender film draws no three.js world and puts the plate under the type", () => {
  const html = scaffoldHtml(solid());
  assert.match(html, /LitStage\.plate\(\{ parent: document\.body, fps: 30, count: 480 \}\)/u);
  assert.match(html, /PLATE\(t\);/u);
  assert.doesNotMatch(html, /importmap|THREE|WebGLRenderer/u);
});

test("the scaffold says BLENDER: when the request asks for high-quality 3D and Blender is installed, and what it will do when it is not", () => {
  const dir = tmp("lit-blender-scaffold-");
  const dirB = tmp("lit-blender-scaffold-b-");
  try {
    const fake = fakeBlender(dir);
    writeTreatment(dir, solid({ render3d: "three" }));
    const found = scaffoldCommand(dir, { env: { LITOPENCODE_BLENDER: fake } });
    assert.match(found, new RegExp(`\\nBLENDER: ${fake.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} \\(LITOPENCODE_BLENDER\\)`, "u"));
    assert.match(found, /render3d "blender"/u);
    writeTreatment(dirB, solid({ render3d: "three" }));
    const missing = scaffoldCommand(dirB, { env: { LITOPENCODE_BLENDER: absent } });
    assert.match(missing, /\nBLENDER: not found/u);
    assert.match(missing, /GPU rung/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dirB, { recursive: true, force: true }); }
});

test("the scaffold stays quiet about Blender for a plain 3D request and for a 2D film", () => {
  const dir = tmp("lit-blender-quiet-");
  try {
    writeTreatment(dir, solid({ request: "빗물 정원을 보여주는 3D 영상 만들어줘 lit", render3d: "three" }));
    assert.doesNotMatch(scaffoldCommand(dir, { env: { LITOPENCODE_BLENDER: fakeBlender(dir) } }), /BLENDER/u);
    fs.rmSync(path.join(dir, "stage"), { recursive: true, force: true });
    writeTreatment(dir, stageTreatment());
    assert.doesNotMatch(scaffoldCommand(dir, { env: { LITOPENCODE_BLENDER: fakeBlender(dir) } }), /BLENDER/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the runtime probe reports Blender as information, found or not, and never as a failure", () => {
  const dir = tmp("lit-blender-probe-");
  try {
    const bin = fakeBlender(dir);
    assert.deepEqual(blenderProbe({ LITOPENCODE_BLENDER: bin }), { ok: true, path: bin, source: "LITOPENCODE_BLENDER" });
    const none = blenderProbe({ LITOPENCODE_BLENDER: absent });
    assert.equal(none.ok, false);
    assert.match(none.detail, /optional/u);
    assert.match(none.detail, /LITOPENCODE_BLENDER/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
