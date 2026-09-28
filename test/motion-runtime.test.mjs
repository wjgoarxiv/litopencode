import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "../test-support/cli-fixture.ts";
import { inspectAudio, inspectWarmState, runtimePaths } from "../skills/lit-typographic-motion/runtime.mjs";
import { planRun } from "../skills/lit-typographic-motion/render.mjs";
import { typeTreatment, writeTreatment } from "../test-support/motion-treatment.mjs";

const skillRoot = path.resolve("skills", "lit-typographic-motion");
const render = path.join(skillRoot, "render.mjs");
const runtime = path.join(skillRoot, "runtime.mjs");
const warmed = process.env.MOTION_TEST_XDG_CACHE_HOME;
const needsWarm = warmed ? false : "MOTION_TEST_XDG_CACHE_HOME is not set to a pre-warmed test cache, so this path cannot launch the engine";
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// A type-path brief plus a valid treatment in each output directory the test renders into.
function briefIn(dir, extra = {}) {
  const file = path.join(dir, "brief.json");
  fs.writeFileSync(file, JSON.stringify({ title: "Quiet Harbour", scenes: [{ scene: "title-slam", text: "Quiet Harbour" }, { scene: "end-card", text: "Quiet Harbour", sub: "see you" }], ...extra }));
  for (const out of ["out", "degrade"]) writeTreatment(path.join(dir, out), typeTreatment());
  return file;
}

function node(args, env, options = {}) {
  return spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, ...env }, timeout: 600_000, ...options });
}

// A throwaway HTTP mirror on 127.0.0.1:0 that counts requests and serves wrong bytes.
async function junkMirror() {
  let requests = 0;
  const server = http.createServer((_, response) => { requests += 1; response.end("not the pinned bytes"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, count: () => requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("status on an empty cache names every missing item and the command that fixes it", () => {
  const dir = tmp("ltm-status-");
  try {
    const result = node([runtime, "status", "--json"], { XDG_CACHE_HOME: dir });
    assert.equal(result.status, 14, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.match(report.prewarm.deps.join(" "), /pinned Node dependencies/u);
    for (const name of ["Galmuri9.ttf", "MesloLGS-NF-Regular.ttf", "Apache-2.0.txt"]) assert.ok(report.prewarm.missingFonts.includes(name), name);
    assert.equal(report.prewarm.fix, "litopencode motion-runtime install");
    assert.match(report.prewarm.audio.reason, /motion-runtime install --audio/u);
    for (const key of ["chrome", "ffmpeg", "webgl2", "softwareWarning"]) assert.ok(key in report, key);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a render with an unwarmed cache exits 14 and names the pre-warm command, without touching the network", () => {
  const dir = tmp("ltm-unwarmed-");
  try {
    const result = node([render, "film", "--brief", briefIn(dir), "--out", path.join(dir, "out")], { XDG_CACHE_HOME: path.join(dir, "cache"), LITOPENCODE_MOTION_MIRROR: "http://127.0.0.1:9" });
    assert.equal(result.status, 14, result.stderr);
    assert.match(result.stderr, /BLOCKED_DEPS_NOT_PREWARMED \(14\).*litopencode motion-runtime install/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a font whose cached bytes do not match the pin exits 15", () => {
  const dir = tmp("ltm-mismatch-");
  try {
    const env = { XDG_CACHE_HOME: path.join(dir, "cache") };
    const fontDir = runtimePaths(env).fonts;
    fs.mkdirSync(fontDir, { recursive: true });
    fs.writeFileSync(path.join(fontDir, "MesloLGS-NF-Regular.ttf"), "tampered");
    assert.equal(inspectWarmState(env).blocked.exit, 15);
    const result = node([render, "film", "--brief", briefIn(dir), "--out", path.join(dir, "out")], env);
    assert.equal(result.status, 15, result.stderr);
    assert.match(result.stderr, /BLOCKED_FONT_FETCH \(15\): font hash mismatch: MesloLGS-NF-Regular\.ttf/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a pre-warm fetch whose bytes miss the pinned sha256 fails closed and writes no font", async () => {
  const dir = tmp("ltm-junk-");
  const mirror = await junkMirror();
  try {
    const env = { XDG_CACHE_HOME: path.join(dir, "cache"), LITOPENCODE_MOTION_MIRROR: mirror.url };
    const child = spawn(process.execPath, [runtime, "install"], { env: { ...process.env, ...env } });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 14);
    assert.match(stderr, /sha256 mismatch/u);
    assert.ok(mirror.count() >= 1);
    assert.equal(fs.existsSync(path.join(runtimePaths(env).fonts, "Galmuri9.ttf")), false);
  } finally {
    await mirror.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Tier-3 word timing states its size and pins first, downloads nothing and fails closed; a render asking for it exits 14", async () => {
  const dir = tmp("ltm-words-");
  const mirror = await junkMirror();
  try {
    const env = { XDG_CACHE_HOME: path.join(dir, "cache"), LITOPENCODE_MOTION_MIRROR: mirror.url };
    const child = spawn(process.execPath, [runtime, "install", "--word-timing"], { env: { ...process.env, ...env } });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 14);
    assert.match(stdout, /download size: /u);
    assert.match(stdout, /Korean forced alignment: id UNPINNED, revision UNPINNED, licence UNVERIFIED/u);
    assert.ok(stdout.indexOf("download size") < stdout.indexOf("fails closed"));
    assert.equal(mirror.count(), 0, "no request was made");
    const renderRun = node([render, "film", "--brief", briefIn(dir), "--out", path.join(dir, "out"), "--word-timing"], env);
    assert.equal(renderRun.status, 14);
    assert.match(renderRun.stderr, /litopencode motion-runtime install --word-timing/u);
  } finally {
    await mirror.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an absent audio venv, or one that no longer matches its pins, falls back to Tier 1 with the warning", () => {
  const dir = tmp("ltm-audio-");
  try {
    const env = { XDG_CACHE_HOME: path.join(dir, "cache") };
    fs.writeFileSync(path.join(dir, "track.wav"), Buffer.alloc(64));
    const absent = inspectAudio(env);
    assert.equal(absent.state, "absent");
    assert.equal(absent.reason, "audio analysis not prewarmed: run litopencode motion-runtime install --audio");
    const venv = runtimePaths(env).audio;
    fs.mkdirSync(path.join(venv, "bin"), { recursive: true });
    fs.symlinkSync(spawnSync("which", ["python3"], { encoding: "utf8" }).stdout.trim() || "/usr/bin/python3", path.join(venv, "bin", "python"));
    fs.writeFileSync(path.join(venv, "requirements.sha256"), "0".repeat(64) + "\n");
    assert.equal(inspectAudio(env).state, "mismatched");
    const previous = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = env.XDG_CACHE_HOME;
    try {
      const brief = { title: "Tide Clock", audio: "track.wav", scenes: [{ scene: "title-slam", text: "Tide Clock" }, { scene: "end-card", text: "Tide Clock" }] };
      fs.mkdirSync(path.join(dir, ".run"), { recursive: true });
      const plan = planRun(brief, path.join(dir, "brief.json"), { runDir: path.join(dir, ".run") }, null);
      assert.equal(plan.audioTier, "text-reading-time");
      assert.ok(plan.warnings.some((w) => /audio venv no longer matches its pins: run litopencode motion-runtime install --audio/u.test(w)), plan.warnings.join(" | "));
    } finally {
      if (previous === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previous;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an offline installer still succeeds and prints the pre-warm receipt line", () => {
  const dir = tmp("ltm-offline-install-");
  try {
    const result = runCli(["install", "--root", path.join(dir, "opencode")], {
      env: { ...process.env, XDG_CACHE_HOME: path.join(dir, "cache"), XDG_CONFIG_HOME: path.join(dir, "config"), LITOPENCODE_MOTION_PREWARM: "force", LITOPENCODE_MOTION_MIRROR: "http://127.0.0.1:9", npm_config_offline: "true" }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.replace(/\n/gu, " "), /Motion runtime: pre-warm not completed \(.+\); run litopencode motion-runtime install outside any sandboxed session before rendering\./u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- paths that launch the engine: they need a pre-warmed cache (never the user's real one) ----
test("no Chrome exits 10 with the launcher's own message", { skip: needsWarm }, () => {
  const dir = tmp("ltm-nochrome-");
  try {
    const result = node([render, "film", "--brief", briefIn(dir), "--out", path.join(dir, "out"), "--stills-only"], { XDG_CACHE_HOME: warmed, CHROME_PATH: path.join(dir, "missing-chrome") });
    assert.equal(result.status, 10, result.stderr);
    assert.match(result.stderr, /BLOCKED_NO_CHROME \(10\): CHROME_PATH does not exist/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Chrome running without WebGL2 exits 11 and quotes the renderer or launch message", { skip: needsWarm }, () => {
  const dir = tmp("ltm-nowebgl-");
  try {
    const real = spawnSync(process.execPath, ["-e", "import('" + path.join(skillRoot, "engine", "browser.mjs") + "').then(m => console.log(m.findChrome().path ?? ''))"], { encoding: "utf8" }).stdout.trim();
    const wrapper = path.join(dir, "chrome-no-webgl");
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${real}" "$@" --disable-webgl --disable-webgl2\n`, { mode: 0o755 });
    const result = node([render, "film", "--brief", briefIn(dir), "--out", path.join(dir, "out"), "--stills-only"], { XDG_CACHE_HOME: warmed, CHROME_PATH: wrapper });
    assert.equal(result.status, 11, result.stderr);
    assert.match(result.stderr, /BLOCKED_NO_WEBGL2 \(11\): no WebGL2 context on any rung/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a sandbox that refuses listen takes the CDP-pull fallback and still renders", { skip: needsWarm }, () => {
  const dir = tmp("ltm-eperm-");
  try {
    const preload = path.join(dir, "deny-listen.mjs");
    fs.writeFileSync(preload, `import net from "node:net";\nnet.Server.prototype.listen = function () { const error = Object.assign(new Error("listen EPERM: operation not permitted 127.0.0.1"), { code: "EPERM" }); process.nextTick(() => this.emit("error", error)); return this; };\n`);
    const result = node(["--import", preload, render, "film", "--brief", briefIn(dir), "--out", path.join(dir, "out"), "--stills-only"], { XDG_CACHE_HOME: warmed });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /listen on 127\.0\.0\.1:0 failed \(EPERM .*\); using per-frame CDP pull/u);
    assert.ok(fs.existsSync(path.join(dir, "out", "sheet", "contact.png")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a film without ffmpeg writes its stills and sheet, then exits 12; stills and film --stills-only still exit 0", { skip: needsWarm }, () => {
  const dir = tmp("ltm-noffmpeg-");
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.symlinkSync(process.execPath, path.join(bin, "node"));
    const env = { XDG_CACHE_HOME: warmed, PATH: bin };
    const film = node([render, "film", "--brief", briefIn(dir), "--out", path.join(dir, "out")], env);
    assert.equal(film.status, 12, film.stderr);
    assert.match(film.stderr, /BLOCKED_NO_FFMPEG_FOR_VIDEO \(12\)/u);
    assert.ok(fs.existsSync(path.join(dir, "out", "sheet", "contact.png")), "the film wrote its contact sheet before stopping");
    assert.ok(fs.readdirSync(path.join(dir, "out", "stills")).some((name) => /^beat-\d\d-mid\.png$/u.test(name)), "and its beat stills");
    const stills = node([render, "stills", "--brief", briefIn(dir), "--out", path.join(dir, "out")], env);
    assert.equal(stills.status, 0, stills.stderr);
    assert.ok(fs.readdirSync(path.join(dir, "out", "stills")).some((name) => name.endsWith(".png")));
    const degrade = node([render, "film", "--brief", briefIn(dir), "--out", path.join(dir, "degrade"), "--stills-only"], env);
    assert.equal(degrade.status, 0, degrade.stderr);
    assert.ok(fs.readdirSync(path.join(dir, "degrade", "stills")).some((name) => name.endsWith(".png")));
    assert.ok(fs.existsSync(path.join(dir, "degrade", "sheet")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function clickTrack(file, bpm = 120, seconds = 8, rate = 22050) {
  const samples = seconds * rate;
  const data = Buffer.alloc(samples * 2);
  const interval = Math.round((60 / bpm) * rate);
  for (let i = 0; i < samples; i++) {
    const sinceBeat = i % interval;
    const value = sinceBeat < 600 ? Math.sin((2 * Math.PI * 1000 * i) / rate) * Math.exp(-sinceBeat / 120) * 0.8 : 0;
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

const audioReady = warmed && inspectAudio({ XDG_CACHE_HOME: warmed }).ready;
test("Tier 2: a supplied audio file is analysed by the pre-warmed venv into a beat grid that drives the cuts", { skip: audioReady ? false : "the pre-warmed test cache has no audio venv (litopencode motion-runtime install --audio)" }, () => {
  const dir = tmp("ltm-tier2-");
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = warmed;
  try {
    clickTrack(path.join(dir, "click.wav"));
    fs.mkdirSync(path.join(dir, ".run"));
    const brief = { title: "On the Beat", audio: "click.wav", scenes: [{ scene: "title-slam", text: "On the Beat" }, { scene: "karaoke", text: "every cut lands on a click" }, { scene: "end-card", text: "On the Beat" }] };
    const plan = planRun(brief, path.join(dir, "brief.json"), { runDir: path.join(dir, ".run") }, null);
    assert.equal(plan.audioTier, "librosa-beat-grid", plan.warnings.join(" | "));
    assert.ok(Math.abs(plan.bpm - 120) < 3, `bpm ${plan.bpm}`);
    for (const entry of plan.timeline.filter((e) => e.start > 0)) {
      assert.ok(plan.beatGrid.some((beat) => Math.abs(beat - entry.start) <= 1 / 60 + 1e-9), `${entry.id} at ${entry.start}s sits on a detected beat`);
    }
  } finally {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
