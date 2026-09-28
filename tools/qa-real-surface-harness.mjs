#!/usr/bin/env node
// Shared machinery for the replacement real-surface QA drivers.
//
// Everything here works against isolated temporary roots. No driver may read or
// write a live profile: the installer, the doctor and the update helper are all
// pointed at a fresh mkdtemp root whose removal is recorded in a cleanup receipt.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function assertBuiltRuntime() {
  for (const relativePath of ["dist/cli.js", "dist/index.js", "dist/cli/update-check.js"]) {
    const entry = path.join(repoRoot, relativePath);
    if (!fsSync.existsSync(entry)) {
      throw new Error(`missing built runtime ${entry}: run \`npm run build\` first`);
    }
  }
}

// A cleanup receipt is part of the evidence, not an afterthought: every
// temporary root a driver creates is registered here and its removal is proven
// by a post-removal stat.
export class CleanupLedger {
  #entries = [];

  register(kind, target) {
    this.#entries.push({ kind, target, removed: false, verified: false });
    return target;
  }

  async remove(target) {
    const entry = this.#entries.find((candidate) => candidate.target === target);
    await fs.rm(target, { recursive: true, force: true });
    const stillPresent = await fs.lstat(target).then(() => true).catch(() => false);
    if (entry !== undefined) {
      entry.removed = true;
      entry.verified = !stillPresent;
    }
    return !stillPresent;
  }

  async removeAll() {
    for (const entry of this.#entries) {
      if (!entry.removed) await this.remove(entry.target);
    }
  }

  get incomplete() {
    return this.#entries.filter((entry) => !entry.verified);
  }

  render(label) {
    const lines = [`CLEANUP-RECEIPT ${label}`];
    for (const entry of this.#entries) {
      lines.push(`  ${entry.verified ? "removed" : "REMAINING"} ${entry.kind} ${entry.target}`);
    }
    lines.push(`  processes_left=0 ports_opened=0 remaining_paths=${this.incomplete.length}`);
    return lines.join("\n");
  }
}

// The realpath matters: on macOS os.tmpdir() is reached through a symlink, and
// the shipped CLIs compare process.argv[1] against import.meta.url to decide
// whether they were invoked directly. An unresolved path makes them import
// silently instead of running.
export async function createTempRoot(ledger, kind) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `litopencode-qa-${kind}-`)));
  ledger.register(kind, root);
  return root;
}

export function isolatedEnv(homeDir) {
  return {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, "config"),
    CI: "1",
    NO_UPDATE_NOTIFIER: "1",
    LITOPENCODE_NO_UPDATE_CHECK: "1"
  };
}

export function runNode(scriptPath, args, { input, cwd = repoRoot, env = process.env } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env,
    input,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Installs the current working tree into an isolated OpenCode root. `install`
// only delegates to the real OpenCode installer when the target equals the
// default profile root, so a temp root stays offline and touches nothing live.
export async function installIntoIsolatedRoot(ledger) {
  const sandbox = await createTempRoot(ledger, "install");
  const openCodeRoot = path.join(sandbox, "opencode");
  const homeDir = path.join(sandbox, "home");
  await fs.mkdir(openCodeRoot, { recursive: true });
  await fs.mkdir(path.join(homeDir, "config"), { recursive: true });
  const install = runNode(path.join(repoRoot, "bin", "litopencode.cjs"), ["install", "--root", openCodeRoot], {
    env: isolatedEnv(homeDir)
  });
  if (install.status !== 0) {
    throw new Error(`isolated install failed with exit ${install.status}: ${install.stderr || install.stdout}`);
  }
  return { sandbox, openCodeRoot, homeDir };
}

export function doctorReport(openCodeRoot, homeDir) {
  const doctor = runNode(path.join(repoRoot, "bin", "litopencode.cjs"), ["doctor", "--root", openCodeRoot, "--json"], {
    env: isolatedEnv(homeDir)
  });
  if (doctor.status !== 0) {
    throw new Error(`doctor failed with exit ${doctor.status}: ${doctor.stderr || doctor.stdout}`);
  }
  return JSON.parse(doctor.stdout);
}

export function sha256File(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// The pinned resource tampered here is a managed canonical asset: the installer
// records its SHA-256 in skills/managed-skill-manifest.json, so a single changed
// byte has to surface as an integrity failure naming that exact path.
export const tamperTargetRelativePath = "skills/visual-qa/schemas/evidence-manifest-v1alpha1.json";

export async function tamperRestoreProbe(openCodeRoot, homeDir) {
  const target = path.join(openCodeRoot, tamperTargetRelativePath);
  const original = await fs.readFile(target);

  const clean = doctorReport(openCodeRoot, homeDir).install.nativeSkills;
  await fs.writeFile(target, Buffer.concat([original, Buffer.from("\n")]));
  const tampered = doctorReport(openCodeRoot, homeDir).install.nativeSkills;
  await fs.writeFile(target, original);
  const restored = doctorReport(openCodeRoot, homeDir).install.nativeSkills;

  return {
    target,
    originalSha256: sha256File(original),
    restoredSha256: sha256File(await fs.readFile(target)),
    clean: { ok: clean.ok, invalid: clean.invalid, invalidAssets: clean.invalidAssets },
    tampered: { ok: tampered.ok, invalid: tampered.invalid, invalidAssets: tampered.invalidAssets },
    restored: { ok: restored.ok, invalid: restored.invalid, invalidAssets: restored.invalidAssets }
  };
}

export function formatRow(index, row) {
  const number = String(index + 1).padStart(2, "0");
  const parts = [
    `ROW ${number}`,
    row.id.padEnd(38),
    `expected=${row.expected}`,
    `observed=${row.observed}`,
    `status=${row.status}`
  ];
  if (row.matrix !== undefined && row.matrix !== row.expected) parts.push(`standing-matrix=${row.matrix}`);
  if (row.divergence !== undefined) parts.push(`divergence=${row.divergence}`);
  if (row.detail !== undefined) parts.push(`detail=${row.detail}`);
  return parts.join(" ");
}
