// The offline Blender rung. A 3D film with `render3d: "blender"` writes its world as a Blender Python
// scene (<out>/stage/scene.py); `render.mjs blender` renders it headless with Cycles on the GPU through
// the bundled runner: first preview stills at the shot midpoints (half size, few samples) to look at,
// then with --final the full plate sequence in <out>/stage/plate/ with plate.json, the receipt the
// stage trusts. The stage page shows the plate through LitStage.plate() and draws its type and labels
// over it, so the page itself stays on the software rung. Without Blender the command renders nothing
// and names the fallback: the three.js world on the GPU rung.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT } from "./constants.mjs";
import { StageError, readPlate } from "./stage/scan.mjs";
import { frameSize, loadTreatment } from "./treatment.mjs";

export { readPlate };

export const BLENDER = Object.freeze({
  macApp: "/Applications/Blender.app/Contents/MacOS/Blender",
  runner: fileURLToPath(new URL("./blender/runner.py", import.meta.url)),
  plateFps: 30,
  device: "METAL",
  preview: Object.freeze({ percent: 50, samples: 40 }),
  final: Object.freeze({ percent: 100, samples: 160 })
});

// Where Blender is: an explicit LITOPENCODE_BLENDER path (used only if it exists, never second-guessed),
// then the macOS app, then `blender` on PATH. Returns { path, source } or null.
export function findBlender({ env = process.env, exists = existsSync, platform = process.platform } = {}) {
  if (env.LITOPENCODE_BLENDER) return exists(env.LITOPENCODE_BLENDER) ? { path: env.LITOPENCODE_BLENDER, source: "LITOPENCODE_BLENDER" } : null;
  if (platform === "darwin" && exists(BLENDER.macApp)) return { path: BLENDER.macApp, source: "app" };
  for (const dir of String(env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, "blender");
    if (exists(file)) return { path: file, source: "PATH" };
  }
  return null;
}

export const plateFrames = (treatment) => Math.round(treatment.durationSec * BLENDER.plateFps);

// The seed the stage page and the plate share, below 2^31 because Cycles takes a signed int.
export const plateSeed = (seed) => (seed >>> 0) % 2147483648;

// The headless command line: factory settings, the runner, and the runner's own arguments after `--`.
export function blenderArgs({ treatment, scene, out, quality }) {
  const q = BLENDER[quality];
  if (quality !== "preview" && quality !== "final") throw new Error(`blenderArgs: quality is preview or final (got ${quality})`);
  const { width, height } = frameSize(treatment);
  const args = ["-b", "--factory-startup", "-P", BLENDER.runner, "--",
    "--scene", scene, "--out", out, "--width", String(width), "--height", String(height),
    "--percent", String(q.percent), "--samples", String(q.samples), "--device", BLENDER.device,
    "--fps", String(BLENDER.plateFps), "--seed", String(plateSeed(Number.isSafeInteger(treatment.seed) ? treatment.seed : 0))];
  if (quality === "preview") args.push("--stills", treatment.beats.map((b) => +((b.t0 + b.t1) / 2).toFixed(3)).join(","));
  else args.push("--frames", `1-${plateFrames(treatment)}`);
  return args;
}

const FALLBACK = (out) => [
  "FALLBACK: no Blender found (LITOPENCODE_BLENDER, /Applications/Blender.app, blender on PATH), so nothing was rendered.",
  `Set render3d to "three" in ${path.join(out, "treatment.json")} and build the world in three.js on the GPU rung (references/depth.md),`,
  "and say in the reply that the film used the GPU rung because Blender is not installed."
].join("\n");

const usage = (detail) => Object.assign(new Error(detail), { exitCode: 2 });
const listPngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".png")).sort() : []);

function runBlender({ bin, args, dir, expected, progress }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (chunk) => { tail = (tail + chunk).slice(-4000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = progress ? setInterval(() => progress(listPngs(dir).length, expected), 2000) : null;
    const done = (value) => { if (timer) clearInterval(timer); resolve(value); };
    child.on("close", (code) => done({ code, tail }));
    child.on("error", (error) => done({ code: -1, tail: error.message }));
  });
}

// `render.mjs blender --out <dir> [--final]`. Preview: stills in stage/plate-preview/. Final: the plate
// sequence in stage/plate/ and plate.json listing every frame by name and size, with the device,
// samples and Blender version from the runner's receipt. Returns { code, message }.
export async function blenderCommand({ out, final = false, env = process.env, log = () => {}, progress = null }) {
  const { treatment } = loadTreatment(out);
  if (treatment.path !== "stage" || treatment.render3d !== "blender") throw usage(`blender renders a stage treatment with render3d "blender" (this one is ${treatment.path === "stage" ? (treatment.render3d ?? "three") : "a type-path film"})`);
  const stageDir = path.join(out, "stage");
  const scene = path.join(stageDir, "scene.py");
  if (!existsSync(scene)) throw new StageError(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR", `${scene} is missing; write the Blender scene first (references/depth.md, the Blender rung)`);
  const found = findBlender({ env });
  if (!found) return { code: EXIT.OK, message: FALLBACK(out) };
  const quality = final ? "final" : "preview";
  const dir = path.join(stageDir, final ? "plate" : "plate-preview");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const args = blenderArgs({ treatment, scene, out: dir, quality });
  const expected = final ? plateFrames(treatment) : treatment.beats.length;
  log(`blender ${quality}: ${found.path} (${found.source}), ${expected} ${final ? "frames" : "stills"}`);
  const run = await runBlender({ bin: found.path, args, dir, expected, progress });
  const receiptFile = path.join(dir, "receipt.json");
  if (run.code !== 0 || !existsSync(receiptFile)) {
    throw new StageError(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR", `Blender ${quality} failed (exit ${run.code}); fix stage/scene.py and run it again. Last output: ${run.tail.trim().split("\n").slice(-8).join(" | ")}`);
  }
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
  const frames = receipt.files.map((name) => ({ name, bytes: statSync(path.join(dir, name)).size }));
  if (frames.length !== expected) throw new StageError(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR", `Blender wrote ${frames.length} of ${expected} ${final ? "frames" : "stills"}`);
  const plate = { kind: quality, blender: receipt.blender, engine: receipt.engine, device: receipt.device, samples: receipt.samples, percent: receipt.percent, fps: BLENDER.plateFps, frames };
  writeFileSync(path.join(dir, "plate.json"), `${JSON.stringify(plate, null, 1)}\n`);
  const label = `Blender ${receipt.blender}, ${receipt.engine} ${receipt.device}, ${receipt.samples} spp at ${receipt.percent} %`;
  if (!final) {
    return { code: EXIT.OK, message: `BLENDER preview: ${frames.length} stills at the shot midpoints in ${dir} (${label}). Open them with the read tool, compare them with any reference frames the user gave, fix scene.py, then render the plate: blender --out ${out} --final` };
  }
  return { code: EXIT.OK, message: `BLENDER plate: ${frames.length} frames at ${BLENDER.plateFps} fps in ${dir} (${label}). Show it with LitStage.plate() under the type, then render the stage: stage --out ${out} --round N` };
}

// A Blender film needs its whole plate before the stage starts: returns the plate, throws exit 17 when
// plate.json is missing, does not match its frames, or counts a different number of frames than the
// film's length needs. Any other film returns null.
export function requirePlate(treatment, stageDir) {
  if (treatment.render3d !== "blender") return null;
  const plate = readPlate(stageDir, "plate");
  if (!plate) throw new StageError(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR", `render3d is blender but stage/plate/plate.json is missing or does not match its frames; render the plate first: blender --out <dir> --final (no Blender: set render3d to "three" and use the GPU rung)`);
  const want = plateFrames(treatment);
  if (plate.frames.length !== want) throw new StageError(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR", `the plate has ${plate.frames.length} frames; a ${treatment.durationSec} s film needs ${want} at ${BLENDER.plateFps} fps (render it again: blender --out <dir> --final)`);
  return plate;
}
