import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stageChromeFlags, serveStage, stageOrigin } from "../skills/lit-typographic-motion/engine/stage/capture.mjs";
import { openChecked, stageRung } from "../skills/lit-typographic-motion/engine/stage/render.mjs";
import { scaffoldHtml } from "../skills/lit-typographic-motion/engine/scaffold.mjs";
import { demoTreatment } from "../skills/lit-typographic-motion/engine/gallery.mjs";
import { fixtureStageTreatment, stageRun } from "../test-support/motion-treatment.mjs";

// The 3D route: the pinned three.js build, served to the stage under /lit/three/, drawn on the GPU rung
// with a labelled software fallback.
const skillRoot = path.resolve("skills", "lit-typographic-motion");
const vendor = path.join(skillRoot, "engine", "vendor", "three");
const render = path.join(skillRoot, "render.mjs");
const fixtures = path.resolve("test", "fixtures", "stage");
const warmed = process.env.MOTION_TEST_XDG_CACHE_HOME;
const needsWarm = warmed ? false : "MOTION_TEST_XDG_CACHE_HOME is not set to a pre-warmed test cache, so this path cannot launch the stage";
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const PINNED = Object.freeze({
  "three.module.js": "ce1fa418de16a19495a9f72495580e3015d7745c296d3ce0485897f902ddedfb",
  "addons/environments/RoomEnvironment.js": "85869bdd22f7cf0b22e68dcefe6cb710480af0f5c901a76f7a7764fd07fc8014",
  "addons/geometries/RoundedBoxGeometry.js": "d20aeaf7077c459a8d952d215738d7b44fba028440bb862d84b622a34f0c80bb",
  LICENSE: "4c40a1ef62450b857c3b2aaf294936304cd552d965fbcd9d32d4c5bcf4ba4454"
});

test("the vendored three.js r170 files match their pinned hashes, are unminified, and every hash is in THIRD_PARTY_NOTICES", () => {
  const notices = fs.readFileSync(path.join(skillRoot, "THIRD_PARTY_NOTICES"), "utf8");
  for (const [rel, hash] of Object.entries(PINNED)) {
    assert.equal(sha(path.join(vendor, rel)), hash, rel);
    assert.ok(notices.includes(`engine/vendor/three/${rel}`) && notices.includes(hash), `${rel} is not listed with its hash in THIRD_PARTY_NOTICES`);
  }
  const source = fs.readFileSync(path.join(vendor, "three.module.js"), "utf8");
  assert.match(source, /const REVISION = '170';/u);
  assert.ok(source.split("\n").length > 50_000, "an unminified build keeps its lines");
  assert.match(fs.readFileSync(path.join(vendor, "LICENSE"), "utf8"), /The MIT License/u);
  assert.match(notices, /tarball sha256 4a608a355dcaba72e0e5383cdc814303f5b6060b43c238cdf6932dceb699238d/u);
  const files = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) (entry.isDirectory() ? walk(path.join(dir, entry.name)) : files.push(path.relative(vendor, path.join(dir, entry.name)))); };
  walk(vendor);
  assert.deepEqual(files.sort(), Object.keys(PINNED).sort(), "nothing is vendored beyond the pinned files");
});

test("the GPU rung uses the platform's native angle backend and keeps page raster on the CPU; the default rung stays software", () => {
  const gpu = stageChromeFlags(1920, 1080, "gpu", "darwin");
  for (const flag of ["--use-angle=metal", "--use-mock-keychain", "--password-store=basic", "--disable-gpu-rasterization", "--run-all-compositor-stages-before-draw", "--window-size=1920,1080", "--force-device-scale-factor=1"]) assert.ok(gpu.includes(flag), flag);
  assert.equal(gpu.some((flag) => /swiftshader|enable-gpu-rasterization|deterministic-mode/u.test(flag)), false);
  assert.ok(stageChromeFlags(1920, 1080, "gpu", "linux").includes("--use-angle=gl"));
  const software = stageChromeFlags(1080, 1920);
  assert.ok(software.includes("--use-angle=swiftshader"));
  assert.equal(software.some((flag) => /use-angle=metal/u.test(flag)), false);
  assert.throws(() => stageChromeFlags(10, 10, "tpu"), /rung/u);
});

test("a depth 3d film takes the GPU rung; every other film takes the software rung", () => {
  assert.equal(stageRung({ depth: "3d" }), "gpu");
  assert.equal(stageRung({ depth: "2d" }), "swiftshader");
  assert.equal(stageRung({}), "swiftshader");
});

// A request router stand-in: serveStage registers one handler and the test calls it with fake routes.
async function serve(url, stageDir) {
  let handler;
  const context = { route: async (_pattern, fn) => { handler = fn; } };
  const result = await serveStage(context, { stageDir, fonts: { css: "", files: new Map() }, scripts: {} });
  const seen = {};
  await handler({ request: () => ({ url: () => url }), fulfill: async (r) => { seen.fulfilled = r; }, abort: async (reason) => { seen.aborted = reason; } });
  return { ...seen, ...result };
}

test("the stage serves the pinned three.js files under /lit/three/ as JavaScript, and nothing else from there", async () => {
  const dir = tmp("lit-three-serve-");
  const ok = await serve(`${stageOrigin}/lit/three/three.module.js`, dir);
  assert.equal(ok.fulfilled.status, 200);
  assert.match(ok.fulfilled.contentType, /text\/javascript/u);
  assert.equal(createHash("sha256").update(ok.fulfilled.body).digest("hex"), PINNED["three.module.js"]);
  const addon = await serve(`${stageOrigin}/lit/three/addons/environments/RoomEnvironment.js`, dir);
  assert.equal(addon.fulfilled.status, 200);
  for (const bad of ["/lit/three/LICENSE", "/lit/three/addons/nothing.js", "/lit/three/../../engine/treatment.mjs", "/lit/three/%2e%2e/%2e%2e/runtime.mjs"]) {
    const refused = await serve(`${stageOrigin}${bad}`, dir);
    assert.equal(refused.fulfilled.status, 404, bad);
  }
  const outside = await serve("https://cdn.example.com/three.js", dir);
  assert.equal(outside.aborted, "blockedbyclient");
});

test("a 3D scaffold maps three and its addons to /lit/three/ and draws the world on the GPU canvas; a 2D scaffold has none of it", () => {
  const solid = demoTreatment("swiss-signal");
  solid.depth = "3d";
  const html = scaffoldHtml(solid);
  assert.match(html, /<script type="importmap">\{ "imports": \{ "three": "\/lit\/three\/three\.module\.js", "three\/addons\/": "\/lit\/three\/addons\/" \} \}<\/script>/u);
  assert.match(html, /<script type="module">/u);
  assert.match(html, /import \* as THREE from "three";/u);
  assert.match(html, /import \{ RoomEnvironment \} from "three\/addons\/environments\/RoomEnvironment\.js";/u);
  assert.match(html, /new THREE\.WebGLRenderer\(\{[^}]*preserveDrawingBuffer: true/u);
  assert.match(html, /WORLD\[s\.index\]/u);
  assert.match(html, /shadow\.normalBias/u);
  const flat = scaffoldHtml(demoTreatment("swiss-signal"));
  assert.doesNotMatch(flat, /importmap|THREE|WebGLRenderer/u);
});

// openChecked with an injected opener: the first browser asks for the GPU rung; when it cannot start or
// gives the page no WebGL the round takes the software rung for every browser and says so.
function fakeStage({ webgl = { requested: true, failed: false } } = {}) {
  const calls = { closed: 0 };
  return {
    calls,
    flags: [],
    close: async () => { calls.closed += 1; },
    load: async () => ({ definition: { width: 1920, height: 1080, fps: 30, duration: 4.2 }, webgl })
  };
}
const context = (opener, rung = "gpu") => ({ opener, rung, notices: [], treatment: { format: "16:9" }, width: 1920, height: 1080, fps: 30, seed: 1, chromePath: "x", stageDir: "x", fonts: {}, scan: { rasters: [] }, styleFiles: {} });

test("a GPU rung that cannot launch falls back to SwiftShader once, labelled, and later browsers stay on it", async () => {
  const rungs = [];
  const opener = async (_chromium, options) => {
    rungs.push(options.rung);
    if (options.rung === "gpu") throw new Error("Chrome failed to launch with --use-angle=metal");
    return fakeStage();
  };
  const ctx = context(opener);
  await openChecked(null, ctx, "p1");
  await openChecked(null, ctx, "p2");
  assert.deepEqual(rungs, ["gpu", "swiftshader", "swiftshader"]);
  assert.equal(ctx.rung, "swiftshader");
  assert.equal(ctx.notices.length, 1);
  assert.match(ctx.notices[0], /GPU rung.*did not start.*software rung \(SwiftShader\), slower, same frames/u);
});

test("a GPU rung that gives the page no WebGL is closed, the round takes the software rung, and the notice says so", async () => {
  const stages = [];
  const opener = async (_chromium, options) => {
    const stage = fakeStage({ webgl: options.rung === "gpu" ? { requested: true, failed: true } : { requested: true, failed: false } });
    stages.push(stage);
    return stage;
  };
  const ctx = context(opener);
  await openChecked(null, ctx, "p1");
  assert.equal(stages[0].calls.closed, 1, "the GPU browser is closed before the software one opens");
  assert.equal(ctx.rung, "swiftshader");
  assert.match(ctx.notices[0], /got no WebGL there; rendered on the software rung \(SwiftShader\)/u);
});

test("a software round never retries a rung, and a missing WebGL there is still exit 11", async () => {
  const ctx = context(async () => fakeStage({ webgl: { requested: true, failed: true } }), "swiftshader");
  await assert.rejects(openChecked(null, ctx, "p1"), (error) => error.exitCode === 11);
  assert.deepEqual(ctx.notices, []);
});

// ---- a real 3D film (Chrome + pre-warmed cache) ----
test("GREEN: a three.js film renders on the GPU rung or, labelled, on SwiftShader, deterministically and under the gate", { skip: needsWarm }, () => {
  const dir = tmp("lit-three-film-");
  try {
    const treatment = fixtureStageTreatment({ depth: "3d", request: "미니멀한 분위기로 하루 동안 물을 모으는 빗물 정원을 설명하는 영상 만들어줘 lit 30fps", register: "minimal", sound: { mode: "generated", plan: "a glass bed that thickens as the arc completes", palette: "glass", key: "A minor", tempo: 104 }, visualDevices: [{ kind: "depth3d", role: "subject", beats: [0, 1, 2] }, { kind: "shape", role: "support", beats: [1, 2] }] });
    const out = stageRun(path.join(dir, "out"), fs.readFileSync(path.join(fixtures, "three-box.html"), "utf8"), { treatment });
    const result = spawnSync(process.execPath, [render, "stage", "--out", out, "--round", "2"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: warmed }, timeout: 600_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    assert.ok(["gpu", "swiftshader"].includes(manifest.rung), manifest.rung);
    assert.ok(manifest.renderer && manifest.renderer !== "no WebGL", manifest.renderer);
    if (manifest.rung === "swiftshader") assert.ok(manifest.warnings.some((w) => /software rung \(SwiftShader\), slower, same frames/u.test(w)), manifest.warnings.join("\n"));
    else assert.ok(manifest.chromeFlags.includes("--use-angle=metal") || manifest.chromeFlags.some((f) => /use-angle=/u.test(f)));
    assert.match(result.stdout, /MO-C-02 PASS/u);
    assert.match(result.stdout, /MO-C-09 PASS/u);
    const det = JSON.parse(fs.readFileSync(path.join(out, ".run", "determinism.json"), "utf8"));
    assert.ok(det.frames.length >= 8 && det.frames.every((entry) => entry.master === entry.replay), "the master and its replay match on every sample");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
