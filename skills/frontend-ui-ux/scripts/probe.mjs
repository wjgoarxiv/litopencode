#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPage } from "./probe-page.mjs";
import { staticScan } from "./probe-static.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const input = option("--path") ?? option("--url");
const output = option("--out") ? resolve(option("--out")) : null;
if (!input || !output) { process.stderr.write("Usage: probe.mjs --path FILE|DIR or --url LOOPBACK --out DIR\n"); process.exit(2); }
const spec = JSON.parse(readFileSync(join(here, "probe-thresholds.json"), "utf8"));
const session = `uiux-${process.pid}-${Date.now()}`;
const browserEnv = { ...process.env, AGENT_BROWSER_HIDE_SCROLLBARS: "true", AGENT_BROWSER_IDLE_TIMEOUT_MS: "120000" };
delete browserEnv.AGENT_BROWSER_ALLOW_FILE_ACCESS;
const blockedRules = ["RS-001", "RS-002", "RS-003", "RS-004", "RS-006", "RS-007", "CF-201", "CF-202", "CF-701"];

function entryFor(pathname) {
  const root = resolve(pathname);
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) return null;
  if (statSync(root).isFile()) return root.endsWith(".html") ? root : null;
  for (const rel of ["dist/index.html", "build/index.html", "out/index.html", "index.html"]) {
    const file = join(root, rel);
    if (existsSync(file) && statSync(file).isFile() && !lstatSync(file).isSymbolicLink()) return file;
  }
  return null;
}

function localUrl(value) {
  try { const url = new URL(value); return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname); } catch { return false; }
}

function run(command, parts, stdin = "", timeout = 20_000) {
  return new Promise((done) => {
    const child = spawn(command, parts, { env: browserEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", (error) => { clearTimeout(timer); done({ status: 2, stdout, stderr, error }); });
    child.on("close", (status) => { clearTimeout(timer); done({ status, stdout, stderr }); });
    child.stdin.end(stdin);
  });
}

async function browser(command, parts, stdin) {
  browserAttempted = true;
  const result = await run(command, ["--session", session, ...parts], stdin);
  if (result.status !== 0 || result.error) throw new Error(`${parts.join(" ")}: ${(result.stderr || result.error?.message || "failed").trim().slice(-300)}`);
  return result.stdout.trim();
}

function parseEval(value) {
  let result = JSON.parse(value);
  if (typeof result === "string") result = JSON.parse(result);
  return result;
}

function startServer(root) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(here, "probe-server.mjs"), root], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); fail(new Error("static server did not start")); }, 10_000);
    child.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/LISTENING (\d+)/u);
      if (match) { clearTimeout(timer); done({ child, port: Number(match[1]) }); }
    });
    child.on("error", (error) => { clearTimeout(timer); fail(error); });
    child.on("exit", (code) => { if (!/LISTENING \d+/u.test(output)) { clearTimeout(timer); fail(new Error(`static server exited ${code}`)); } });
  });
}

function writeReport(manifest, findings) {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "probe.json"), `${JSON.stringify({ manifest, findings }, null, 2)}\n`);
  const rows = ["| Severity | Rule | Where | Measured | Fix |", "| --- | --- | --- | --- | --- |"];
  for (const f of findings) rows.push(`| ${f.severity} | ${f.rule} | ${String(f.selector ?? "document").replaceAll("|", "\\|")} @ ${f.viewport} | ${f.tier}: ${JSON.stringify(f.value).replaceAll("|", "\\|")} | ${JSON.stringify(f.threshold).replaceAll("|", "\\|")} |`);
  const missing = manifest.not_verified.map((item) => `- ${item.rule} @ ${item.viewport ?? "all"}: ${item.reason}`);
  writeFileSync(join(output, "review.md"), `# Interface probe\n\n${manifest.exit_code === 2 ? "Blocked" : manifest.exit_code === 1 ? "Block" : "Approve"}\n\n${rows.join("\n")}\n\n## Not verified\n\n${missing.join("\n") || "None"}\n`);
  if (manifest.exit_code === 2) process.stdout.write(`BLOCKED: ${manifest.blocked_reason}\n`);
  else process.stdout.write(`${findings.length} findings; ${manifest.exit_code === 1 ? "Block" : "Approve"}\n`);
  process.exitCode = manifest.exit_code;
}

const source = option("--source") ?? (option("--path") ? resolve(option("--path")) : null);
const fallback = staticScan(source);
const manifest = { url: null, viewports_run: [], browser_version: null, zoom_emulation: "viewport-halved", not_verified: [], screenshots: [], exit_code: 2, blocked_reason: null };
const findings = [];
const block = (reason) => {
  manifest.blocked_reason = reason;
  manifest.not_verified.push(...fallback.notVerified);
  findings.push(...fallback.findings);
};

let server = null, command = null, browserAttempted = false, socketDir = null;
try {
  const entry = option("--path") ? entryFor(option("--path")) : null;
  if (option("--path") && !entry) { block("no entry page found"); }
  else if (option("--url") && !localUrl(option("--url"))) { block("browser unavailable"); }
  else if (args.includes("--static-only")) { block("browser unavailable"); }
  else {
    const capability = spawnSync(process.execPath, [resolve(here, "../../browser-drive/scripts/capability-probe.mjs")], { encoding: "utf8", timeout: 15_000 });
    let status;
    try { status = JSON.parse(capability.stdout); } catch { status = null; }
    if (status?.status !== "available") block(status?.blocker?.includes("IDENTITY") ? "browser identity unverified" : "browser unavailable");
    else {
      command = status.command;
      manifest.browser_version = status.version;
      socketDir = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "lo-uiux-"));
      browserEnv.AGENT_BROWSER_SOCKET_DIR = socketDir;
      if (entry) {
        server = await startServer(dirname(entry));
        manifest.url = `http://127.0.0.1:${server.port}/${encodeURIComponent(basename(entry))}`;
      } else manifest.url = option("--url");
      const started = Date.now();
      for (const probeCase of spec.matrix) {
        if (Date.now() - started > spec.values.runTimeBudgetMs) {
          manifest.not_verified.push(...blockedRules.map((rule) => ({ rule, viewport: probeCase.name, reason: "time budget exceeded" })));
          manifest.blocked_reason = "matrix incomplete";
          break;
        }
        await browser(command, ["set", "viewport", String(probeCase.width), String(probeCase.height)]);
        await browser(command, ["set", "media", probeCase.scheme, ...(probeCase.reducedMotion ? ["reduced-motion"] : [])]);
        await browser(command, ["open", manifest.url]);
        await browser(command, ["wait", "1200"]);
        let ready = parseEval(await browser(command, ["eval", "--stdin"], "JSON.stringify(document.readyState)"));
        if (ready !== "complete") {
          await browser(command, ["wait", "1200"]);
          ready = parseEval(await browser(command, ["eval", "--stdin"], "JSON.stringify(document.readyState)"));
        }
        if (ready !== "complete") {
          manifest.not_verified.push(...blockedRules.map((rule) => ({ rule, viewport: probeCase.name, reason: "page did not settle" })));
          manifest.blocked_reason = "matrix incomplete";
          break;
        }
        const state = { scheme: probeCase.scheme, reducedMotion: !!probeCase.reducedMotion, zoomEmulation: probeCase.zoomEmulation };
        const inspected = parseEval(await browser(command, ["eval", "--stdin"], `JSON.stringify((${inspectPage.toString()})(${JSON.stringify(probeCase.name)},${JSON.stringify(spec.values)},${JSON.stringify(state)}))`));
        findings.push(...inspected.findings);
        manifest.not_verified.push(...inspected.notVerified);
        for (const selector of inspected.hoverSelectors.slice(0, 5)) {
          await browser(command, ["hover", selector]);
          const duration = parseEval(await browser(command, ["eval", "--stdin"], `JSON.stringify((() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? Math.max(...getComputedStyle(el).transitionDuration.split(',').map((value) => value.trim().endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000)) : null; })())`));
          if (duration !== null && duration > spec.values.repeatedHoverMaxMs) findings.push({ rule: "CF-506", severity: "MEDIUM", tier: "measured", viewport: probeCase.name, selector, value: duration, threshold: spec.values.repeatedHoverMaxMs });
        }
        manifest.viewports_run.push(probeCase.name);
        const path = join(output, `${probeCase.name}.png`);
        mkdirSync(output, { recursive: true });
        await browser(command, ["screenshot", path]);
        const image = readFileSync(path);
        manifest.screenshots.push({ viewport: probeCase.name, path, bytes: image.length, width: image.readUInt32BE(16), height: image.readUInt32BE(20) });
        const errors = await browser(command, ["errors"]);
        if (errors && !/no errors|0 errors/iu.test(errors)) writeFileSync(join(output, `${probeCase.name}-errors.txt`), `${errors}\n`);
      }
      const missing = spec.requiredViewports.filter((name) => !manifest.viewports_run.includes(name));
      if (missing.length) manifest.blocked_reason = `matrix incomplete (${missing.join(', ')})`;
      manifest.exit_code = findings.some((row) => row.severity === "HIGH" && ["measured", "derived"].includes(row.tier)) ? 1 : manifest.blocked_reason ? 2 : 0;
    }
  }
} catch (error) {
  if (manifest.exit_code !== 2 || !manifest.blocked_reason) {
    manifest.exit_code = 2;
    manifest.blocked_reason = "browser unavailable";
    manifest.not_verified.push(...blockedRules.map((rule) => ({ rule, reason: error.message })));
  }
} finally {
  if (command && browserAttempted) {
    const closed = await run(command, ["--session", session, "close"]);
    if (closed.status !== 0 && manifest.exit_code !== 2) { manifest.exit_code = 2; manifest.blocked_reason = "browser cleanup failed"; }
  }
  if (server) {
    const child = server.child;
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null) await new Promise((done) => { const timer = setTimeout(() => { child.kill("SIGKILL"); done(); }, 2000); child.once("exit", () => { clearTimeout(timer); done(); }); });
    if (child.exitCode === null && child.signalCode === null) { manifest.exit_code = 2; manifest.blocked_reason = "browser cleanup failed"; }
  }
  if (socketDir) rmSync(socketDir, { recursive: true, force: true });
}
writeReport(manifest, findings);
