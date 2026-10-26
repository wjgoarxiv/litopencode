// One cover browser: the stage path's software rung (the GPU rung for a 3D hero) and stage flags at device scale 2, the cover
// page served from disk on the stage origin (engine/stage/capture.mjs serveStage, so no socket
// listens), the loop kit at /lit/loop-kit.js, the product faces plus JetBrains Mono at
// /lit/fonts.css, and the cover init script before any page script. The renderer SEEKS: it calls
// window.renderFrame(t, { mask }) for any t in [0, 1) in any order and screenshots the page at twice
// its CSS size; a worker pool reduces each screenshot to the cover size with Lanczos and writes it.
// The master pass, the replay pass and the seek-order pass each open their own browser.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { EXIT } from "../constants.mjs";
import { serveStage, stageChromeFlags, stageFonts, stageOrigin } from "../stage/capture.mjs";
import { StageError } from "../stage/scan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const stageDir = path.join(here, "..", "stage");

/**
 * The stage flags with the device scale raised to the cover's capture scale, and raster kept on the
 * CPU and whole. G0 compares every frame of two fresh browsers, and glyphs rasterized through the
 * software GL (canvas fillText, and DOM text at changing weights) came out one level apart on a
 * handful of pixels between them; CPU raster gives the same pixels every time.
 */
export function coverChromeFlags(width, height, scale, rung = "swiftshader") {
  const flags = stageChromeFlags(width, height, rung).map((flag) => (flag === "--force-device-scale-factor=1" ? `--force-device-scale-factor=${scale}` : flag));
  return [...new Set([...flags, "--disable-gpu-rasterization", "--disable-partial-raster"])];
}

/** The stage faces plus JetBrains Mono, a variable face with a real wght axis (100-800). */
export function coverFonts(skillRoot, state, pins) {
  const fonts = stageFonts(skillRoot, state, pins);
  const file = path.join(skillRoot, "fonts", "JetBrainsMono-wght-latin.woff2");
  fonts.files.set(path.basename(file), file);
  fonts.css += `@font-face { font-family: "JetBrains Mono"; src: url("/lit/fonts/${path.basename(file)}") format("woff2"); font-weight: 100 800; font-style: normal; font-display: block; }\n`;
  fonts.families.push("JetBrains Mono");
  return fonts;
}

const contractError = (detail) => new StageError(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR", detail);

/**
 * Wait for window.ready, but stop at the page's first uncaught error: a page that throws while it
 * builds (a stage-contract message such as `PAINTING.glows has no entry for the hero panel N`) never
 * becomes ready, so the render reports that message now instead of after the full wait.
 */
export async function waitForCoverReady(tab, pageFailed, timeout = 60000) {
  const ready = tab.waitForFunction(() => window.ready === true, null, { timeout, polling: 50 }).then(
    () => undefined,
    () => { throw new Error(`the cover page never set window.ready = true within ${timeout / 1000} s`); }
  );
  ready.catch(() => {});
  const failure = await Promise.race([ready, pageFailed]);
  if (failure !== undefined) throw new Error(`the cover page raised an error before it set window.ready: ${failure}`);
  return undefined;
}

/**
 * Launch a cover browser on `coverDir` and load its index.html. `page` is the CSS size; screenshots
 * are `scale` times that. Returns { frame(t, { mask }), capture(), close(), flags }.
 */
export async function openCover(chromium, { chromePath, profile, coverDir, page: [width, height], scale, fonts, rung = "swiftshader" }) {
  const flags = coverChromeFlags(width, height, scale, rung);
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath, headless: true, args: flags, chromiumSandbox: true, timeout: 30000,
      viewport: { width, height }, deviceScaleFactor: scale, serviceWorkers: "block"
    });
  } catch (error) {
    const line = String(error?.message ?? error).split("\n").find((part) => part.trim()) ?? String(error);
    throw Object.assign(new Error(`BLOCKED_NO_CHROME (10): Chrome failed to launch headless: ${line}; fix: check that Chrome can start headless in this sandbox`), { exitCode: EXIT.BLOCKED_NO_CHROME });
  }
  const served = await serveStage(context, { stageDir: coverDir, fonts, scripts: { "/lit/loop-kit.js": readFileSync(path.join(stageDir, "loop-kit.js"), "utf8") } });
  await context.addInitScript({ content: readFileSync(path.join(stageDir, "cover-init.js"), "utf8") });
  const tab = context.pages()[0] ?? await context.newPage();
  const errors = [];
  const pageFailed = new Promise((resolve) => tab.on("pageerror", (error) => {
    errors.push(String(error?.message ?? error).split("\n")[0]);
    resolve(errors[0]);
  }));
  const cdp = await context.newCDPSession(tab);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false, screenWidth: width, screenHeight: height });
  const close = async () => { await context.close().catch(() => {}); };
  // Everything a cover page may not do, named; `at` says when.
  const check = async (at) => {
    if (served.blocked.length) throw new StageError(EXIT.STAGE_NETWORK_REQUEST, "STAGE_NETWORK_REQUEST", `the cover page requested ${served.blocked[0]}; everything is local`);
    if (served.refused.length) throw contractError(`the cover page asked for ${served.refused[0]}, which is outside the cover folder or not a stage file type`);
    const used = await tab.evaluate(() => (window.__litCover ? window.__litCover.used() : [])).catch(() => []);
    if (used.length) throw new StageError(EXIT.STAGE_NONDETERMINISTIC, "STAGE_NONDETERMINISTIC", `the cover page called ${used.join(", ")}${at ? ` ${at}` : ""}; a cover frame is a function of t alone (LitLoop.rng(seed) for layout)`);
  };
  try {
    try { await tab.goto(`${stageOrigin}/index.html`, { waitUntil: "load", timeout: 60000 }); }
    catch (error) { await check("while loading"); throw contractError(`the cover page did not load: ${String(error?.message ?? error).split("\n")[0]}`); }
    try { await waitForCoverReady(tab, pageFailed); }
    catch (error) {
      await check("while loading");
      throw contractError(`${error.message}${served.missing[0] ? `; missing file: ${served.missing[0]}` : ""}`);
    }
    await check("while loading");
    if (await tab.evaluate(() => typeof window.renderFrame) !== "function") throw contractError("the cover page set window.ready but defines no window.renderFrame(t, { mask })");
  } catch (error) {
    await close();
    throw error;
  }
  return {
    flags, errors, missing: served.missing, close,
    async frame(t, { mask = false } = {}) {
      try {
        await tab.evaluate(async ({ time, asMask }) => {
          await window.renderFrame(time, { mask: asMask });
          if (document.fonts) await document.fonts.ready;
        }, { time: t, asMask: mask });
      } catch (error) {
        await check(`at t = ${t.toFixed(4)}`);
        throw contractError(`renderFrame(${t.toFixed(4)}${mask ? ", { mask: true }" : ""}) threw: ${String(error?.message ?? error).split("\n")[0]}`);
      }
      await check(`at t = ${t.toFixed(4)}`);
    },
    async capture() {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      return Buffer.from(shot.data, "base64");
    }
  };
}

/** Worker threads that reduce screenshots to the cover size, write them, and hash the pixels. */
export class CoverPool {
  constructor(size = Math.max(2, Math.min(6, os.availableParallelism() - 3))) {
    this.workers = Array.from({ length: size }, () => new Worker(path.join(here, "frame-worker.mjs")));
    this.jobs = new Map();
    this.id = 0;
    this.turn = 0;
    for (const worker of this.workers) {
      worker.on("message", (message) => {
        const job = this.jobs.get(message.id);
        this.jobs.delete(message.id);
        if (message.error) job.reject(contractError(message.error)); else job.resolve(message);
      });
      worker.on("error", (error) => { for (const job of this.jobs.values()) job.reject(error); this.jobs.clear(); });
    }
  }
  reduce(png, size, file) {
    const id = this.id++;
    const bytes = new Uint8Array(png);
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.workers[this.turn++ % this.workers.length].postMessage({ id, png: bytes, size, file }, [bytes.buffer]);
    });
  }
  async close() { await Promise.all(this.workers.map((worker) => worker.terminate())); }
}

/**
 * Draw and capture `times` ([index, t] pairs) in the order given, writing `<prefix>NNNN.png` at the
 * cover `size` into `dir`. Returns Map index -> SHA-256 of the reduced frame's RGBA.
 */
export async function capturePass({ browser, pool, times, dir, prefix = "f", mask = false, size, expected }) {
  const hashes = new Map();
  const pending = [];
  for (const [index, t] of times) {
    await browser.frame(t, { mask });
    const png = await browser.capture();
    pending.push(pool.reduce(png, size, path.join(dir, `${prefix}${String(index).padStart(4, "0")}.png`)).then((result) => {
      if (result.captured !== expected) throw contractError(`the capture is ${result.captured}, not ${expected}; the cover page must not resize its viewport`);
      hashes.set(index, result.sha256);
    }));
    if (pending.length >= 12) await Promise.all(pending.splice(0, 6));
  }
  await Promise.all(pending);
  return hashes;
}
