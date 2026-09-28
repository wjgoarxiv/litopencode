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
const clockSource = () => readFileSync(path.join(here, "clock.js"), "utf8");

// The Wave 1 software rung (SwiftShader, CPU raster; keychain flags included) plus the stage flags.
export function stageChromeFlags(width, height) {
  const software = chromeFlagRungs().find((rung) => rung.name === "swiftshader").flags;
  return [...software,
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
    faces.push({ family: "LitOpenCode Sans", weight: 400, file: path.resolve(skillRoot, pins.litPptxPair.Regular.path) }, { family: "LitOpenCode Sans", weight: 700, file: path.resolve(skillRoot, pins.litPptxPair.Bold.path) });
  } else faces.push({ family: "LitOpenCode Sans", weight: 400, file: path.join(state.fontDir, "Pretendard-Regular.otf") }, { family: "LitOpenCode Sans", weight: 700, file: path.join(state.fontDir, "Pretendard-Regular.otf") });
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

// Launch one stage browser. `profile` is a short directory under the run's .run/, removed on close.
export async function openStage(chromium, { chromePath, profile, stageDir, width, height, fps, seed, fonts, extraInit }) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const flags = stageChromeFlags(width, height);
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
  const blocked = [];
  const refused = [];
  const missing = [];
  const root = realpathSync(stageDir);
  const kit = kitSource();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== stageOrigin) { blocked.push(url.href); return route.abort("blockedbyclient"); }
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/lit/stage-kit.js") return route.fulfill({ status: 200, contentType: contentTypes[".js"], body: kit });
    if (pathname === "/lit/fonts.css") return route.fulfill({ status: 200, contentType: contentTypes[".css"], body: fonts.css });
    if (pathname.startsWith("/lit/fonts/")) {
      const file = fonts.files.get(pathname.slice("/lit/fonts/".length));
      return file && existsSync(file) ? route.fulfill({ status: 200, contentType: contentTypes[path.extname(file)], body: readFileSync(file) }) : route.fulfill({ status: 404, body: "" });
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
