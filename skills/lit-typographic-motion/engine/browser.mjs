// Chrome discovery and the MO-A-51 launch ladder. A rung counts only when the page itself obtains a
// WebGL2 context. Chrome is driven over Playwright's pipe transport, so no control port listens.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromeFlagRungs } from "./constants.mjs";

const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function which(name, env = process.env) {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function findChrome(env = process.env) {
  if (env.CHROME_PATH) return existsSync(env.CHROME_PATH) ? { path: env.CHROME_PATH } : { missing: `CHROME_PATH does not exist: ${env.CHROME_PATH}` };
  if (process.platform === "darwin" && existsSync(macChrome)) return { path: macChrome };
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const found = which(name, env);
    if (found) return { path: found };
  }
  return { missing: "Chrome/Chromium not found on PATH or at the standard install location" };
}

export function chromeVersion(executable) {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 10000 });
  return result.status === 0 ? result.stdout.trim() : `version unavailable (${(result.stderr || result.error?.message || "").split("\n")[0]})`;
}

export async function loadPlaywright(cacheDir) {
  const entry = path.join(cacheDir, "node_modules", "playwright-core", "index.mjs");
  return (await import(pathToFileURL(entry).href)).chromium;
}

const probeHtml = "<!doctype html><meta charset=utf-8><title>lit-typographic-motion</title>";

// Try each rung in order. Returns { context, page, rung, renderer } or throws a classified error:
// error.kind = "launch" (no rung launched Chrome) or "webgl" (Chrome ran, WebGL2 never came up).
export async function launchLadder(chromium, executable, profileRoot, { timeout = 30000, onPage, rungOnly } = {}) {
  let firstLaunchError = "";
  let lastWebglError = "";
  let launched = false;
  for (const rung of chromeFlagRungs().filter((candidate) => !rungOnly || candidate.name === rungOnly)) {
    const profile = path.join(profileRoot, rung.name === "gpu" ? "cg" : "cs");
    rmSync(profile, { recursive: true, force: true });
    mkdirSync(profile, { recursive: true });
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, {
        executablePath: executable, headless: true, args: rung.flags, chromiumSandbox: true, timeout,
        viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1
      });
      launched = true;
      const page = context.pages()[0] ?? await context.newPage();
      await page.setContent(probeHtml);
      const probe = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        if (!gl) return { ok: false, detail: "canvas.getContext('webgl2') returned null" };
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        return { ok: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown (debug-info extension unavailable)" };
      });
      if (probe.ok) {
        if (onPage) await onPage(page);
        return { context, page, rung, renderer: probe.renderer, profile };
      }
      lastWebglError = `${rung.name} rung: ${probe.detail}`;
    } catch (error) {
      const line = String(error?.message ?? error).split("\n").find((part) => part.trim()) ?? String(error);
      if (!launched) firstLaunchError ||= line;
      else lastWebglError = `${rung.name} rung: ${line}`;
    }
    await context?.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
  const error = new Error(launched ? `no WebGL2 context on any rung (${lastWebglError})` : `Chrome failed to launch headless: ${firstLaunchError}`);
  error.kind = launched ? "webgl" : "launch";
  throw error;
}
