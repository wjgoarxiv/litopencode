import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

const packageJson = JSON.parse(fsSync.readFileSync(path.resolve("package.json"), "utf8"));
const binPath = path.resolve(packageJson.bin.litopencode);

export const packageVersion = packageJson.version;
export const packageId = `@litfamily/litopencode@${packageVersion}`;

export async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-cli-"));
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg-config");
  try {
    await fn(dir);
  } finally {
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export function runCli(args, options = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options
  });
}

export async function runCliAsync(args, options = {}) {
  const child = spawn(process.execPath, [binPath, ...args], {
    cwd: process.cwd(),
    ...options
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [status] = await once(child, "close");
  return { status, stdout, stderr };
}
