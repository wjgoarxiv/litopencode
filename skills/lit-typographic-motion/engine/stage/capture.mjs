// One stage browser: the software rung plus the stage flags, the page served from a synthetic origin
// through request interception (no listening socket), the virtual clock injected before any page
// script, and CDP screenshots of exactly the format's viewport. The master capture, the determinism
// replay and the QA replay each launch their own with this module.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromeFlagRungs } from "../constants.mjs";
import { StageError, contentTypes, insideDir } from "./scan.mjs";

export const stageHost = "lit.stage";
export const stageOrigin = `http://${stageHost}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const kitSource = () => readFileSync(path.join(here, "stage-kit.js"), "utf8");
const threeRoot = path.join(here, "..", "vendor", "three");
const clockSource = () => readFileSync(path.join(here, "clock.js"), "utf8");

// The stage's Chrome flags on one rung. "swiftshader" (the default) is the software rung: CPU raster,
// the same pixels on every machine. "gpu" asks the platform's native ANGLE backend for WebGL, so a
// three.js film draws in real time on the graphics card; page raster stays on the CPU, which keeps the
// text and the capture path identical to the software rung.
export function stageChromeFlags(width, height, rung = "swiftshader", platform = process.platform) {
  const found = chromeFlagRungs(platform).find((candidate) => candidate.name === rung);
  if (!found) throw new Error(`unknown Chrome rung "${rung}" (gpu or swiftshader)`);
  const base = rung === "gpu" ? [...found.flags.filter((flag) => flag !== "--enable-gpu-rasterization"), "--disable-gpu-rasterization"] : found.flags;
  return [...base,
    "--run-all-compositor-stages-before-draw", "--disable-checker-imaging", "--disable-new-content-rendering-timeout",
    "--disable-threaded-animation", "--disable-threaded-scrolling", "--disable-image-animation-resync", "--disable-lcd-text",
    "--force-color-profile=srgb", "--hide-scrollbars", "--mute-audio", "--force-device-scale-factor=1", `--window-size=${width},${height}`,
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings", "--metrics-recording-only",
    `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE ${stageHost}`];
}

// The product's own faces, served under /lit/fonts/ and declared in /lit/fonts.css.
export function stageFonts(skillRoot, state, pins) {
  const faces = [];
  for (const [stretch, width] of [[75, "75%"], [100, "100%"], [125, "125%"]]) for (const weight of [400, 700, 900]) faces.push({ family: "Archivo", weight, stretch: width, file: path.join(skillRoot, "fonts", `Archivo-${stretch}-${weight}.ttf`) });
  if (state.hangul === "lit-pptx") {
    faces.push({ family: "Pretendard", weight: 400, file: path.resolve(skillRoot, pins.litPptxPair.Regular.path) }, { family: "Pretendard", weight: 700, file: path.resolve(skillRoot, pins.litPptxPair.Bold.path) });
  } else faces.push({ family: "Pretendard", weight: 400, file: path.join(state.fontDir, "Pretendard-Regular.otf") }, { family: "Pretendard", weight: 700, file: path.join(state.fontDir, "Pretendard-Regular.otf") });
  faces.push({ family: "VT323", weight: 400, file: path.join(skillRoot, "fonts", "VT323-Regular.ttf") });
  faces.push({ family: "Silkscreen", weight: 400, file: path.join(skillRoot, "fonts", "Silkscreen-Regular.ttf") }, { family: "Silkscreen", weight: 700, file: path.join(skillRoot, "fonts", "Silkscreen-Bold.ttf") });
  faces.push({ family: "MesloLGS NF", weight: 400, file: path.join(state.fontDir, "MesloLGS-NF-Regular.ttf") });
  faces.push({ family: "Galmuri9", weight: 400, file: path.join(state.fontDir, "Galmuri9.ttf") });
  const files = new Map();
  const css = faces.map((face) => {
    const name = path.basename(face.file);
    files.set(name, face.file);
    const format = name.endsWith(".otf") ? "opentype" : "truetype";
    return `@font-face { font-family: "${face.family}"; src: url("/lit/fonts/${encodeURIComponent(name)}") format("${format}"); font-weight: ${face.weight}; font-style: normal;${face.stretch ? ` font-stretch: ${face.stretch};` : ""} font-display: block; }`;
  }).join("\n") + "\n";
  return { css, files, families: [...new Set(faces.map((face) => face.family))] };
}

// Serve the stage origin from disk through request interception: the product's scripts and faces
// under /lit/ (fonts, and the pinned three.js under /lit/three/), every other path from inside `stageDir` only. Anything else is recorded, never fetched:
// another origin in `blocked`, a path that leaves the directory or has no stage type in `refused`, a
// file that is not there in `missing`. The stage and the cover browsers both use it.
export async function serveStage(context, { stageDir, fonts, scripts }) {
  const blocked = [];
  const refused = [];
  const missing = [];
  const root = realpathSync(stageDir);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== stageOrigin) { blocked.push(url.href); return route.abort("blockedbyclient"); }
    const pathname = decodeURIComponent(url.pathname);
    if (Object.hasOwn(scripts, pathname)) return route.fulfill({ status: 200, contentType: contentTypes[path.extname(pathname)] ?? contentTypes[".js"], body: scripts[pathname] });
    if (pathname === "/lit/fonts.css") return route.fulfill({ status: 200, contentType: contentTypes[".css"], body: fonts.css });
    if (pathname.startsWith("/lit/fonts/")) {
      const file = fonts.files.get(pathname.slice("/lit/fonts/".length));
      return file && existsSync(file) ? route.fulfill({ status: 200, contentType: contentTypes[path.extname(file)], body: readFileSync(file) }) : route.fulfill({ status: 404, body: "" });
    }
    if (pathname.startsWith("/lit/three/")) {
      // The pinned three.js build and its two addons, JavaScript only; the licence and anything else is not served.
      const sub = pathname.slice("/lit/three/".length);
      const file = path.join(threeRoot, sub);
      const ok = !sub.split("/").includes("..") && sub.endsWith(".js") && insideDir(threeRoot, file) && existsSync(file);
      return ok ? route.fulfill({ status: 200, contentType: contentTypes[".js"], body: readFileSync(file) }) : route.fulfill({ status: 404, body: "" });
    }
    const rel = pathname.replace(/^\/+/u, "") || "index.html";
    if (rel.split("/").includes("..")) { refused.push(rel); return route.fulfill({ status: 404, body: "" }); }
    const full = path.join(root, rel);
    if (!existsSync(full)) { missing.push(rel); return route.fulfill({ status: 404, body: "" }); }
    const real = realpathSync(full);
    if (!insideDir(root, real)) { refused.push(rel); return route.fulfill({ status: 404, body: "" }); }
    const type = contentTypes[path.extname(real).toLowerCase()];
    if (!type) { refused.push(rel); return route.fulfill({ status: 404, body: "" }); }
    return route.fulfill({ status: 200, contentType: type, body: readFileSync(real) });
  });
  return { blocked, refused, missing };
}

// Launch one stage browser. `profile` is a short directory under the run's .run/, removed on close.
// `styleFiles` maps /lit/style.css and /lit/style.js to the film's house style, written per treatment.
export async function openStage(chromium, { chromePath, profile, stageDir, width, height, fps, seed, fonts, extraInit, styleFiles = {}, rung = "swiftshader" }) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const flags = stageChromeFlags(width, height, rung);
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath, headless: true, args: flags, chromiumSandbox: true, timeout: 30000,
      viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: "block"
    });
  } catch (error) {
    rmSync(profile, { recursive: true, force: true });
    const line = String(error?.message ?? error).split("\n").find((part) => part.trim()) ?? String(error);
    throw Object.assign(new Error(`BLOCKED_NO_CHROME (10): Chrome failed to launch headless: ${line}; fix: check that Chrome can start headless in this sandbox`), { exitCode: 10 });
  }
  const { blocked, refused, missing } = await serveStage(context, { stageDir, fonts, scripts: { "/lit/stage-kit.js": kitSource(), ...styleFiles } });
  await context.addInitScript({ content: `window.__litStageConfig = ${JSON.stringify({ seed: seed >>> 0, fps })};\n${clockSource()}` });
  if (extraInit) await context.addInitScript({ content: extraInit });
  const page = context.pages()[0] ?? await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.message ?? error)));
  const cdp = await context.newCDPSession(page);
  // The capture session owns the viewport: a screenshot restores the metrics of the session that took
  // it, so the size is pinned here rather than only through the driver's own emulation.
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  const close = async () => {
    await context.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  };
  const check = async () => {
    if (blocked.length) throw new StageError(19, "STAGE_NETWORK_REQUEST", `the page requested ${blocked[0]}${blocked.length > 1 ? ` and ${blocked.length - 1} more` : ""}`);
    if (refused.length) throw new StageError(17, "STAGE_CONTRACT_ERROR", `the page asked for ${refused[0]}, which is outside the stage directory or not a stage file type`);
    const violations = await page.evaluate(() => window.__litStage.violations.map((v) => ({ ...v })));
    const first = violations.find((v) => v.code === 19) ?? violations.find((v) => v.code === 17);
    if (first) throw new StageError(first.code, first.code === 19 ? "STAGE_NETWORK_REQUEST" : "STAGE_CONTRACT_ERROR", `the page used ${first.what} at ${first.t.toFixed(2)} s`);
  };
  return {
    context, page, cdp, flags, blocked, missing, errors, close, check,
    async load(rasterUrls) {
      try { await page.goto(`${stageOrigin}/index.html`, { waitUntil: "load", timeout: 60000 }); }
      catch (error) { await check(); throw new StageError(17, "STAGE_CONTRACT_ERROR", `the page did not load: ${String(error?.message ?? error).split("\n")[0]}`); }
      const definition = await page.evaluate((urls) => window.__litStage.prepare(urls), rasterUrls);
      await check();
      const webgl = await page.evaluate(() => ({ ...window.__litStage.webgl }));
      return { definition, webgl };
    },
    // Advance the virtual clock to `frame`. `settle` waits two native frames so the compositor has
    // drawn it; frames that are not captured skip that wait.
    async step(frame, settle = true) {
      await page.evaluate(({ f, settle: wait }) => window.__litStage.step(f, wait), { f: frame, settle });
    },
    async stepRange(from, to) {
      await page.evaluate(({ a, b }) => window.__litStage.stepRange(a, b), { a: from, b: to });
    },
    async capture() {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      return Buffer.from(shot.data, "base64");
    }
  };
}
