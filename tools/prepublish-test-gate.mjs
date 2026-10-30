import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// The Publish workflow sets LITOPENCODE_PUBLISH_FROM_CI=1. ci.yml has already run the suite and the QA
// probes on the pushed commit, so here the gate only proves that ci.yml passed on this exact, unmodified
// checkout and stops the release otherwise. Any other publish still runs npm test first.
export async function readCiVerdict({ env, fetchRun = fetch, git = runGit }) {
  const sha = env.GITHUB_SHA ?? "";
  const repository = env.GITHUB_REPOSITORY ?? "";
  if (env.GITHUB_ACTIONS !== "true" || !/^[0-9a-f]{40}$/u.test(sha) || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    return { ok: false, detail: "not a GitHub Actions run with a commit and repository" };
  }
  if (git(["rev-parse", "HEAD"]) !== sha) return { ok: false, detail: `checkout is not ${sha}` };
  if (git(["status", "--porcelain"]) !== "") return { ok: false, detail: "checkout has local changes" };

  const url = `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs`
    + `?head_sha=${sha}&status=success&event=push&per_page=1`;
  const headers = { accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  let body;
  try {
    const response = await fetchRun(url, { headers });
    if (!response.ok) return { ok: false, detail: `GitHub API answered ${response.status}` };
    body = await response.json();
  } catch (error) {
    return { ok: false, detail: `GitHub API unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }

  const run = Array.isArray(body?.workflow_runs) ? body.workflow_runs[0] : undefined;
  if (run?.head_sha !== sha || run?.conclusion !== "success") {
    return { ok: false, detail: `no successful ci.yml push run for ${sha}` };
  }
  return { ok: true, detail: `ci.yml run ${run.id} passed on ${sha}` };
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function runSuite() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_dry_run"),
  );
  const npmExecPath = env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmExecPath ? [npmExecPath, "test"] : ["test"];
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    ...(process.platform === "win32" && !npmExecPath ? { shell: true } : {}),
  });

  if (result.error) {
    process.stderr.write(`prepublish test gate could not start npm test: ${result.error.message}\n`);
    process.exitCode = 1;
  } else if (result.signal) {
    process.stderr.write(`prepublish test gate interrupted by ${result.signal}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = Number.isInteger(result.status) ? result.status : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.LITOPENCODE_PUBLISH_FROM_CI === "1") {
    const verdict = await readCiVerdict({ env: process.env });
    if (verdict.ok) {
      process.stdout.write(`prepublish test gate: ${verdict.detail}; the suite is not run again\n`);
    } else {
      process.stderr.write(`prepublish test gate refused: ${verdict.detail}\n`);
      process.exitCode = 1;
    }
  } else {
    runSuite();
  }
}
