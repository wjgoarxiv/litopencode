// The stage path's gate rows: the flash audit on the master and the looping
// preview, exact size / fps / length, file sizes, the reduced-motion still, near-black runs,
// determinism, and the sound and text rows the sound and QA modules record. Type-engine rules (GLSL
// passes, presets, glyph masks, frame time) do not apply to a page.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { limits } from "../constants.mjs";
import { countFlashes } from "../flash.mjs";
import { soundChecks } from "../sound.mjs";

const pass = (detail = "") => ({ pass: true, detail });
const fail = (detail) => ({ pass: false, detail });

function probe(file) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries,duration,sample_rate,channels:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (result.status !== 0) return { error: (result.stderr || result.error?.message || "ffprobe failed").trim() };
  const json = JSON.parse(result.stdout);
  return { video: json.streams?.find((s) => s.codec_type === "video"), audio: json.streams?.find((s) => s.codec_type === "audio"), duration: Number(json.format?.duration) };
}

const locate = (root, name) => [path.join(root, name), path.join(root, ".run", name), path.join(root, "withheld", name)].find((file) => existsSync(file)) ?? null;
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

export function checkStageRun(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  const lines = existsSync(path.join(root, ".run", "stage-frames.jsonl")) ? readFileSync(path.join(root, ".run", "stage-frames.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  const frameLines = lines.filter((line) => line.stream === undefined).sort((a, b) => a.frame - b.frame);
  const previewLines = lines.filter((line) => line.stream === "preview").sort((a, b) => a.previewFrame - b.previewFrame);
  const [width, height] = manifest.resolution;
  const fps = manifest.fps;
  const checks = {};
  const warnings = [];

  // MO-C-03: the grid and window transpose for 9:16 (the render audited with that geometry).
  const master = countFlashes(frameLines.map((line) => line.transitions ?? {}), fps, false);
  const preview = previewLines.length ? countFlashes(previewLines.map((line) => line.transitions ?? {}), manifest.preview?.fps ?? fps, true) : null;
  const general = Math.max(master.general, preview?.general ?? 0), red = Math.max(master.red, preview?.red ?? 0);
  const flashDetail = `worst window ${general} general / ${red} red  (limit ${limits.flashLimitGeneral} / ${limits.flashLimitRed}); grid ${width >= height ? "320x180" : "180x320"} cells`;
  checks["MO-C-03"] = frameLines.length !== manifest.frameCount ? fail(`only ${frameLines.length} of ${manifest.frameCount} frames were audited`)
    : !previewLines.length ? fail(`preview frames were not audited; ${flashDetail}`)
    : general <= limits.flashLimitGeneral && red <= limits.flashLimitRed ? pass(flashDetail) : fail(flashDetail);

  if (manifest.webgl?.requested) checks["MO-C-02"] = manifest.webgl.failed ? fail("the page asked for WebGL and got none") : pass("WebGL on the stage's software rung (SwiftShader), labelled software");

  const det = readJson(path.join(root, ".run", "determinism.json"));
  const mismatch = det?.frames?.find((entry) => entry.master !== entry.replay);
  checks["MO-C-09"] = !det ? fail("no determinism replay was recorded")
    : det.frames.length < 8 || det.frames.length > 16 ? fail(`${det.frames.length} sample frames; the replay compares 8-16`)
    : mismatch ? fail(`frame ${mismatch.frame} differs from a fresh replay`) : pass(`${det.frames.length} sample frames match a fresh replay from 0 (frames ${det.frames.map((entry) => entry.frame).join(",")})`);

  const film = locate(root, "film.mp4");
  const probed = film ? probe(film) : null;
  const video = probed?.video;
  const rate = video?.r_frame_rate ? Number(video.r_frame_rate.split("/")[0]) / Number(video.r_frame_rate.split("/")[1] ?? 1) : 0;
  const tags = video && video.pix_fmt === "yuv420p" && video.color_space === "bt709" && video.color_range === "tv";
  checks["MO-C-10"] = video && video.codec_name === "h264" && video.width === width && video.height === height && tags
    ? pass(`${video.width}x${video.height} h264 yuv420p/bt709/tv (${manifest.format})`)
    : fail(`${video ? `${video.width}x${video.height} ${video.codec_name} ${video.pix_fmt}/${video.color_space}/${video.color_range}` : probed?.error ?? "no MP4"}; the ${manifest.format} stage needs exactly ${width}x${height} with BT.709 tags`);
  checks["MO-C-11"] = video && Math.abs(rate - fps) < 0.01 && (fps === 60 || fps === 30) ? pass(`${rate} fps`) : fail(`${rate} fps; the stage renders at ${fps}`);
  const drift = Math.abs(manifest.durationSec - manifest.targetDurationSec) / manifest.targetDurationSec;
  checks["MO-C-12"] = drift <= 0.1 + 1e-9 && manifest.durationSec >= 4 && manifest.durationSec <= 90
    ? pass(`${manifest.durationSec.toFixed(2)} s against the treatment's ${manifest.targetDurationSec} s (${(drift * 100).toFixed(1)} %)`)
    : fail(`${manifest.durationSec.toFixed(2)} s against the treatment's ${manifest.targetDurationSec} s: more than 10 % off`);

  const previewFile = locate(root, "preview.webp") ?? locate(root, "preview.gif");
  const poster = locate(root, "poster.png");
  const sizes = { mp4: film ? statSync(film).size : 0, preview: previewFile ? statSync(previewFile).size : 0, poster: poster ? statSync(poster).size : 0 };
  checks["MO-C-13"] = sizes.preview > 0 && sizes.preview <= limits.previewMaxBytes && sizes.poster > 0 && sizes.poster <= limits.posterMaxBytes
    ? pass(`mp4 ${sizes.mp4}, preview ${sizes.preview} (cap 3 MB), poster ${sizes.poster} (cap 1 MB)`)
    : fail(`mp4 ${sizes.mp4}, preview ${sizes.preview} (cap 3 MB), poster ${sizes.poster} (cap 1 MB)`);
  const still = locate(root, "reduced-motion.png");
  checks["MO-C-14"] = still && Number.isInteger(manifest.stillFrame) ? pass(`present; the final beat's midpoint, frame ${manifest.stillFrame}`) : fail("no reduced-motion still");

  // MO-D-03: no near-black stretch longer than twice the shortest allowed beat (1.2 s), outside the
  // first and last second.
  const allowance = Math.round(2 * 1.2 * fps);
  let run = 0, emptyError = null;
  for (const line of frameLines) {
    run = line.p995L < limits.nearBlackLuminance ? run + 1 : 0;
    const edge = line.frame < fps || line.frame >= manifest.frameCount - fps ? fps : 0;
    if (run > allowance + edge) { emptyError = `${run} near-black frames ending at frame ${line.frame}`; break; }
  }
  checks["MO-D-03"] = emptyError ? fail(emptyError) : pass(`no near-black run past ${allowance} frames`);

  if (manifest.sound?.mode) Object.assign(checks, soundChecks(film, manifest.durationSec, manifest.sound.mode));
  const qa = readJson(path.join(root, ".run", "qa.json"));
  if (qa) Object.assign(checks, qa.checks);
  else checks["TEXT-copy-found"] = fail("no text QA was recorded");
  for (const warning of manifest.pageErrors ?? []) warnings.push(`page error: ${warning}`);
  for (const asset of manifest.missingAssets ?? []) warnings.push(`missing stage asset: ${asset}`);
  const failed = Object.entries(checks).filter(([, check]) => !check.pass && !check.warn).map(([id]) => id);
  for (const [id, check] of Object.entries(checks)) if (check.warn) warnings.push(`${id}: ${check.detail}`);
  return { manifest, checks, warnings, failed, passed: failed.length === 0, sizes, flash: { master, preview } };
}

const order = ["MO-C-03", "MO-C-02", "MO-C-09", "MO-C-10", "MO-C-11", "MO-C-12", "MO-C-13", "MO-C-14", "MO-D-03"];
export function formatStageReport(result, context) {
  const { manifest, checks } = result;
  const out = (name) => path.join(context.exportDir, name);
  const lines = [
    "lit-typographic-motion — render report (stage)",
    `outputs: ${out("film.mp4")} · ${out(manifest.previewEncoder === "gif" ? "preview.gif" : "preview.webp")} (encoder: ${manifest.previewEncoder}) · ${out("poster.png")} · ${out("reduced-motion.png")}`,
    `format / fps / length: ${manifest.format} ${manifest.resolution.join("x")} @ ${manifest.fps} fps, ${manifest.durationSec.toFixed(2)} s (treatment ${manifest.targetDurationSec} s)`,
    `renderer: stage software rung (flags: ${(manifest.chromeFlags ?? []).join(" ")})`,
    `timing: master ${manifest.timing?.masterSec ?? "?"} s, per frame p50 ${manifest.timing?.frameP50 ?? "?"} ms / p95 ${manifest.timing?.frameP95 ?? "?"} ms, total ${manifest.timing?.totalSec ?? "?"} s`,
    "",
    `QA gate: ${result.passed ? "PASS" : "FAIL"}`
  ];
  const ids = [...order.filter((id) => checks[id]), ...Object.keys(checks).filter((id) => !order.includes(id))];
  for (const id of ids) {
    const check = checks[id];
    lines.push(`  ${id} ${check.pass ? "PASS" : check.warn ? "WARN" : "FAIL"}${check.detail ? `  (${check.detail})` : ""}`);
  }
  lines.push("", `craft rounds run: ${manifest.craftRound} / 3 max`, `frames actually viewed this run: ${context.viewed} (confirmed looked, not just rendered)`);
  if (result.warnings.length) lines.push(`warnings: ${result.warnings.join("; ")}`);
  lines.push(`gate exit: ${context.exitCode}`, `export state: ${context.exportState}`, "brief: none (stage path)", "");
  return lines.join("\n");
}
