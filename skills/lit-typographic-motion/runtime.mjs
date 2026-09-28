#!/usr/bin/env node
// lit-typographic-motion runtime: `litopencode motion-runtime install|status [--audio] [--word-timing]`.
// Installs the pinned engine dependencies, fonts and (opt-in) the librosa venv into a product-owned
// cache, once, outside any render session (MO-A-42, MO-A-54). Renders only read what this wrote.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const skillRoot = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (file) => sha256(readFileSync(file));
export const pins = JSON.parse(readFileSync(path.join(skillRoot, "fonts", "pins.json"), "utf8"));
export const wordTimingPins = JSON.parse(readFileSync(path.join(skillRoot, "word-timing-models.json"), "utf8"));
const installCommand = "litopencode motion-runtime install";

export function runtimePaths(env = process.env) {
  const base = path.join(env.XDG_CACHE_HOME || path.join(env.HOME || os.homedir(), ".cache"), "litopencode", "motion-runtime");
  const lockHash = hashFile(path.join(skillRoot, "package-lock.json")).slice(0, 16);
  const pinHash = sha256(JSON.stringify(pins.fetched) + JSON.stringify(pins.fallback)).slice(0, 16);
  const audioHash = hashFile(path.join(skillRoot, "requirements-audio.txt")).slice(0, 16);
  return {
    base,
    node: path.join(base, `node-${lockHash}`),
    fonts: path.join(base, `fonts-${pinHash}`),
    audio: path.join(base, `audio-${audioHash}`),
    lockHash, pinHash, audioHash
  };
}

const pairPath = (entry) => path.resolve(skillRoot, entry.path);

// Which fetched files a preset needs (MO-A-55: status names exactly what is missing).
export function presetFontNeeds(presetId) {
  return Object.entries(pins.fetched).filter(([, pin]) => pin.presets?.includes(presetId)).flatMap(([name, pin]) => [name, ...(pin.licence ?? [])]);
}

export function inspectAudio(env = process.env) {
  const paths = runtimePaths(env);
  const python = path.join(paths.audio, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const receipt = path.join(paths.audio, "requirements.sha256");
  const fix = `${installCommand} --audio`;
  if (!existsSync(python) || !existsSync(receipt)) return { ready: false, state: "absent", reason: `audio analysis not prewarmed: run ${fix}`, python, fix };
  if (readFileSync(receipt, "utf8").trim() !== hashFile(path.join(skillRoot, "requirements-audio.txt")))
    return { ready: false, state: "mismatched", reason: `audio venv no longer matches its pins: run ${fix}`, python, fix };
  const probe = spawnSync(python, ["-c", "import librosa; print(librosa.__version__)"], { encoding: "utf8", timeout: 30000 });
  if (probe.status !== 0 || probe.stdout.trim() !== "0.11.0") return { ready: false, state: "mismatched", reason: `audio venv no longer matches its pins: run ${fix}`, python, fix };
  return { ready: true, state: "ready", version: probe.stdout.trim(), python, fix };
}

export function inspectWordTiming() {
  const usable = wordTimingPins.models.every((model) => model.id && model.revision && model.bytes && model.licenceVerified && !/non-?commercial|\bNC\b/iu.test(model.licence ?? ""));
  return { ready: false, pinned: usable, reason: usable ? "word-timing models are pinned but not installed" : "no licence-verified Korean alignment model is pinned; Tier 3 fails closed", fix: `${installCommand} --word-timing` };
}

// The full pre-warm state. `blocked` classifies what a render would hit first:
// a present-but-wrong font -> 15; missing deps -> 14; a missing font -> 15.
export function inspectWarmState(env = process.env) {
  const paths = runtimePaths(env);
  const deps = [];
  const nodeReceipt = path.join(paths.node, "receipt.json");
  if (!existsSync(path.join(paths.node, "node_modules", "playwright-core", "index.mjs"))) deps.push("pinned Node dependencies (playwright-core, opentype.js, ws)");
  else if (!existsSync(nodeReceipt) || JSON.parse(readFileSync(nodeReceipt, "utf8")).lockSha256 !== hashFile(path.join(skillRoot, "package-lock.json"))) deps.push("lockfile receipt");
  const missingFonts = [];
  const mismatchedFonts = [];
  for (const [name, pin] of Object.entries(pins.fetched)) {
    const file = path.join(paths.fonts, name);
    if (!existsSync(file)) missingFonts.push(name);
    else if (hashFile(file) !== pin.sha256) mismatchedFonts.push(name);
  }
  for (const [relative, expected] of Object.entries(pins.bundled)) {
    const file = path.join(skillRoot, relative);
    if (!existsSync(file)) missingFonts.push(relative);
    else if (hashFile(file) !== expected) mismatchedFonts.push(relative);
  }
  let hangul = "lit-pptx";
  for (const weight of ["Regular", "Bold"]) {
    const entry = pins.litPptxPair[weight];
    const file = pairPath(entry);
    if (existsSync(file) && hashFile(file) === entry.sha256) continue;
    if (existsSync(file)) { mismatchedFonts.push(`lit-pptx ${path.basename(entry.path)}`); continue; }
    hangul = "fallback";
  }
  if (hangul === "fallback") {
    for (const [name, pin] of Object.entries(pins.fallback)) {
      const file = path.join(paths.fonts, name);
      if (!existsSync(file)) missingFonts.push(`${name} (the lit-pptx Hangul pair is absent)`);
      else if (hashFile(file) !== pin.sha256) mismatchedFonts.push(name);
    }
  }
  const blocked = mismatchedFonts.length ? { exit: 15, name: "BLOCKED_FONT_FETCH", detail: `font hash mismatch: ${mismatchedFonts.join(", ")}` }
    : deps.length ? { exit: 14, name: "BLOCKED_DEPS_NOT_PREWARMED", detail: `missing ${deps.join(", ")}` }
    : missingFonts.length ? { exit: 15, name: "BLOCKED_FONT_FETCH", detail: `missing fonts: ${missingFonts.join(", ")}` }
    : null;
  return {
    cache: paths.base, nodeDir: paths.node, fontDir: paths.fonts, hangul,
    deps, missingFonts, mismatchedFonts, blocked, ready: blocked === null,
    presets: Object.fromEntries(["swiss-signal", "terminalcore", "tidal"].map((id) => {
      const needs = presetFontNeeds(id);
      const gaps = needs.filter((name) => missingFonts.includes(name) || mismatchedFonts.includes(name));
      return [id, { ready: gaps.length === 0 && deps.length === 0, missing: gaps }];
    })),
    audio: inspectAudio(env), wordTiming: inspectWordTiming(), fix: installCommand
  };
}

function takeLock(dir) {
  mkdirSync(path.dirname(dir), { recursive: true });
  try { mkdirSync(dir); return; } catch (error) { if (error.code !== "EEXIST") throw error; }
  if (Date.now() - statSync(dir).mtimeMs > 10 * 60 * 1000) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir); return; }
  throw new Error(`another motion-runtime install holds ${dir}; wait for it to finish`);
}

async function fetchPinned(name, pin, env) {
  const url = env.LITOPENCODE_MOTION_MIRROR ? `${env.LITOPENCODE_MOTION_MIRROR.replace(/\/$/u, "")}/${encodeURIComponent(name)}` : pin.url;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`fetch ${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== pin.sha256) throw new Error(`fetch ${name}: sha256 mismatch (got ${sha256(bytes)}, pinned ${pin.sha256})`);
  return bytes;
}

async function installFonts(env, log) {
  const paths = runtimePaths(env);
  const wanted = { ...pins.fetched, ...(inspectWarmState(env).hangul === "fallback" ? pins.fallback : {}) };
  const todo = Object.entries(wanted).filter(([name, pin]) => {
    const file = path.join(paths.fonts, name);
    return !existsSync(file) || hashFile(file) !== pin.sha256;
  });
  if (todo.length === 0) return;
  mkdirSync(paths.fonts, { recursive: true });
  for (const [name, pin] of todo) {
    const bytes = await fetchPinned(name, pin, env);
    const temp = path.join(paths.fonts, `.${name}.${process.pid}.part`);
    writeFileSync(temp, bytes);
    renameSync(temp, path.join(paths.fonts, name));
    log(`fetched ${name} (${bytes.length} B, sha256 verified)`);
  }
}

function installNode(env, log) {
  const paths = runtimePaths(env);
  if (inspectWarmState(env).deps.length === 0) return;
  mkdirSync(paths.base, { recursive: true });
  const stage = mkdtempSync(path.join(paths.base, ".stage-"));
  try {
    copyFileSync(path.join(skillRoot, "package.json"), path.join(stage, "package.json"));
    copyFileSync(path.join(skillRoot, "package-lock.json"), path.join(stage, "package-lock.json"));
    const npm = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: stage, encoding: "utf8", timeout: 240000, env: { ...env, npm_config_update_notifier: "false" } });
    if (npm.status !== 0) throw new Error(`npm ci failed: ${(npm.stderr || npm.error?.message || String(npm.status)).trim().split("\n").slice(-3).join(" ")}`);
    writeFileSync(path.join(stage, "receipt.json"), JSON.stringify({ lockSha256: hashFile(path.join(skillRoot, "package-lock.json")) }) + "\n");
    rmSync(paths.node, { recursive: true, force: true });
    renameSync(stage, paths.node);
    log(`installed pinned engine dependencies into ${paths.node}`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function pythonForAudio(env) {
  const uv = spawnSync("uv", ["python", "find", "--no-python-downloads", "3.12"], { encoding: "utf8", timeout: 10000 });
  for (const name of [env.MOTION_PYTHON, uv.status === 0 ? uv.stdout.trim() : undefined, "python3.12", "python3.11", "python3.13", "python3"]) {
    if (!name) continue;
    const version = spawnSync(name, ["-c", "import sys; print(sys.version_info.major, sys.version_info.minor)"], { encoding: "utf8", timeout: 10000 });
    if (version.status === 0 && /^3 (?:11|12|13)$/u.test(version.stdout.trim())) return name;
  }
  throw new Error("Python 3.11-3.13 is required for the optional audio tier");
}

function installAudio(env, log) {
  if (inspectAudio(env).ready) return;
  const paths = runtimePaths(env);
  mkdirSync(paths.base, { recursive: true });
  const stage = mkdtempSync(path.join(paths.base, ".audio-stage-"));
  try {
    const created = spawnSync(pythonForAudio(env), ["-m", "venv", stage], { encoding: "utf8", timeout: 180000 });
    if (created.status !== 0) throw new Error(`audio venv creation failed: ${(created.stderr || created.error?.message || "").trim()}`);
    const python = path.join(stage, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const pip = spawnSync(python, ["-m", "pip", "install", "--require-hashes", "--only-binary=:all:", "--no-deps", "-r", path.join(skillRoot, "requirements-audio.txt")],
      { encoding: "utf8", timeout: 900000, maxBuffer: 16_000_000 });
    if (pip.status !== 0) throw new Error(`audio pin install failed: ${(pip.stderr || pip.error?.message || "").trim().split("\n").slice(-3).join(" ")}`);
    writeFileSync(path.join(stage, "requirements.sha256"), hashFile(path.join(skillRoot, "requirements-audio.txt")) + "\n");
    rmSync(paths.audio, { recursive: true, force: true });
    renameSync(stage, paths.audio);
    log(`installed the pinned librosa venv into ${paths.audio}`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// MO-A-21: state the download size and every pin first; fail closed unless each model is pinned
// with a verified commercial-use licence. No model is downloaded in this build.
export function describeWordTiming() {
  const lines = ["Tier 3 word timing (opt-in, --word-timing):"];
  const known = wordTimingPins.models.filter((model) => Number.isFinite(model.bytes));
  lines.push(`  download size: ${known.length === wordTimingPins.models.length ? `${known.reduce((sum, model) => sum + model.bytes, 0)} bytes` : "not stated, because at least one model has no pinned size"}`);
  for (const model of wordTimingPins.models) {
    lines.push(`  ${model.role}: id ${model.id ?? "UNPINNED"}, revision ${model.revision ?? "UNPINNED"}, licence ${model.licence ?? "UNVERIFIED"}`);
  }
  lines.push(`  never used at any tier: ${wordTimingPins.forbidden.join(", ")}`);
  return lines.join("\n");
}

export async function install(flags = [], env = process.env, log = (line) => console.log(line)) {
  const paths = runtimePaths(env);
  if (flags.includes("--word-timing")) {
    log(describeWordTiming());
    const state = inspectWordTiming();
    if (!state.pinned) {
      log("BLOCKED_DEPS_NOT_PREWARMED: no licence-verified Korean alignment model is pinned, so Tier 3 fails closed; nothing was downloaded.");
      return { exitCode: 14 };
    }
  }
  const lock = path.join(paths.base, ".install-lock");
  takeLock(lock);
  try {
    await installFonts(env, log);
    installNode(env, log);
    if (flags.includes("--audio")) installAudio(env, log);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
  const state = inspectWarmState(env);
  return { exitCode: state.ready ? 0 : state.blocked.exit, state };
}

async function main(argv) {
  const [command, ...flags] = argv;
  if (!command || command === "--help" || command === "help") {
    console.log("lit-typographic-motion runtime\nUsage: litopencode motion-runtime install|status [--audio] [--word-timing] [--json]");
    return 0;
  }
  if (command === "install") {
    try {
      const result = await install(flags);
      if (result.state) console.log(`motion runtime: ${result.state.ready ? "ready" : `not ready (${result.state.blocked.name}: ${result.state.blocked.detail})`} in ${result.state.cache}`);
      return result.exitCode;
    } catch (error) {
      console.error(`motion runtime install failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`nothing in the render session will install it; rerun ${installCommand} with network access`);
      return 14;
    }
  }
  if (command === "status") {
    const { probe, formatProbe } = await import("./probe.mjs");
    const report = await probe();
    console.log(flags.includes("--json") ? JSON.stringify(report, null, 2) : formatProbe(report));
    return report.prewarm.ready ? 0 : report.prewarm.blocked.exit;
  }
  console.error("Usage: litopencode motion-runtime install|status [--audio] [--word-timing] [--json]");
  return 2;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
