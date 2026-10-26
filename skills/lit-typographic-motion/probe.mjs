#!/usr/bin/env node
// The five MO-A-44 probes, reported on every doctor/status run: Chrome, ffmpeg (with the preview
// encoder rung), the WebGL2 renderer string from a real headless probe, the software-GL warning, and
// pre-warm state naming what is missing and the command that fixes it. A sixth line names the cover
// encoder (cover mode: img2webp decoded with dwebp, else gifski decoded with ffmpeg).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSoftwareRenderer, unknownRenderer } from "./engine/constants.mjs";
import { chromeVersion, findChrome, launchLadder, loadPlaywright, which } from "./engine/browser.mjs";
import { splitLines } from "./engine/command.mjs";
import { inspectWarmState } from "./runtime.mjs";
import { coverEncoder } from "./engine/cover/render.mjs";
import { findBlender } from "./engine/blender.mjs";

export function previewEncoderRung(ffmpeg, env = process.env) {
  if (ffmpeg) {
    const encoders = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8", timeout: 15000 }).stdout ?? "";
    if (/\blibwebp_anim\b/u.test(encoders)) return "libwebp_anim";
  }
  if (which("img2webp", env)) return "img2webp";
  return ffmpeg ? "gif" : "none";
}

// Blender is optional: found, it is the offline Cycles rung for high-quality 3D films; absent, those films
// take the three.js world on the GPU rung. Either way this is information, never a failure.
export function blenderProbe(env = process.env) {
  const found = findBlender({ env });
  return found
    ? { ok: true, path: found.path, source: found.source }
    : { ok: false, detail: "optional; not found (LITOPENCODE_BLENDER, /Applications/Blender.app, blender on PATH); high-quality 3D films use the three.js GPU rung" };
}

export async function probe(env = process.env) {
  const prewarm = inspectWarmState(env);
  const chrome = findChrome(env);
  const ffmpeg = which("ffmpeg", env);
  const report = {
    chrome: chrome.path ? { ok: true, path: chrome.path, version: chromeVersion(chrome.path) } : { ok: false, detail: `${chrome.missing} (not found on PATH / not installed)` },
    ffmpeg: ffmpeg ? { ok: true, path: ffmpeg, version: splitLines(spawnSync(ffmpeg, ["-version"], { encoding: "utf8", timeout: 15000 }).stdout ?? "")[0], previewEncoder: previewEncoderRung(ffmpeg, env) }
      : { ok: false, detail: "ffmpeg not found on PATH", previewEncoder: previewEncoderRung(undefined, env) },
    webgl2: { ok: false, renderer: null, flags: [], detail: "" },
    softwareWarning: null,
    prewarm,
    coverEncoder: coverEncoder(env),
    blender: blenderProbe(env)
  };
  if (!chrome.path) report.webgl2.detail = "not probed: Chrome is missing";
  else if (prewarm.deps.length) report.webgl2.detail = `not probed: the pinned driver is not pre-warmed; run ${prewarm.fix}`;
  else {
    const scratch = mkdtempSync(path.join(os.tmpdir(), "ltm-probe-"));
    try {
      const chromium = await loadPlaywright(prewarm.nodeDir);
      const launched = await launchLadder(chromium, chrome.path, scratch, { timeout: 20000 });
      report.webgl2 = { ok: true, renderer: launched.renderer, flags: launched.rung.flags, rung: launched.rung.name };
      await launched.context.close();
    } catch (error) {
      report.webgl2.detail = `no WebGL2 context obtainable (not even software): ${error.message}`;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const renderer = report.webgl2.renderer;
  report.softwareWarning = !renderer ? `renderer not probed (${report.webgl2.detail})`
    : renderer === unknownRenderer ? "renderer type unknown — debug-info extension unavailable"
    : isSoftwareRenderer(renderer) ? `software GL detected (${renderer}); renders will be slower, --samples lowered automatically`
    : "none (hardware renderer)";
  return report;
}

export function formatProbe(report) {
  const p = report.prewarm;
  const missing = [...p.deps, ...p.missingFonts, ...p.mismatchedFonts.map((name) => `${name} (hash mismatch)`)];
  return [
    `motion chrome: ${report.chrome.ok ? `${report.chrome.path} — ${report.chrome.version}` : report.chrome.detail}`,
    `motion ffmpeg: ${report.ffmpeg.ok ? `${report.ffmpeg.path} — ${report.ffmpeg.version}` : report.ffmpeg.detail}; preview encoder rung: ${report.ffmpeg.previewEncoder}`,
    `motion webgl2: ${report.webgl2.ok ? `${report.webgl2.renderer} (rung ${report.webgl2.rung}: ${report.webgl2.flags.join(" ")})` : report.webgl2.detail}`,
    `motion software-gl: ${report.softwareWarning}`,
    `motion cover encoder: ${report.coverEncoder.name === "none" ? `none; cover renders stop with exit 21; fix: ${report.coverEncoder.fix}` : `${report.coverEncoder.name} (the gate decodes with ${report.coverEncoder.decoder})`}`,
    `motion blender: ${report.blender.ok ? `${report.blender.path} (${report.blender.source})` : report.blender.detail}`,
    `motion prewarm: ${p.ready ? `ready in ${p.cache} (Hangul body: ${p.hangul})` : `missing ${missing.join(", ")}; run ${p.fix}`}; audio: ${p.audio.ready ? "ready" : p.audio.reason}; word timing: ${p.wordTiming.reason}`
  ].join("\n");
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const json = process.argv.includes("--json");
  if (process.argv.includes("--help")) console.log("lit-typographic-motion probe\nUsage: node probe.mjs [--json]");
  else probe().then((report) => console.log(json ? JSON.stringify(report, null, 2) : formatProbe(report)));
}
