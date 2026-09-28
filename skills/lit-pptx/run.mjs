#!/usr/bin/env node
// First-use runtime for the installed OpenCode skill. All installs stay in cache.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, renameSync, rmSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"), "litopencode", "office");
const hash = (file) => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex").slice(0, 16);
const nodeRoot = path.join(cache, `node-${hash("package-lock.json")}`);
const pythonRoot = path.join(cache, `python-pptx-${hash("requirements.lock")}`);
const commands = {
  compile: ["node", "scripts/compile-deck.js"],
  qa: ["python", "scripts/qa_deck.py"],
  embed: ["python", "scripts/embed_fonts.py"],
  learn: ["python", "scripts/learn_template.py"],
  validate: ["python", "scripts/validate_pptx.py"],
};

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { stdio: "inherit", cwd: root, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function prepareNode() {
  if (existsSync(path.join(nodeRoot, "node_modules", "pptxgenjs"))) return;
  mkdirSync(cache, { recursive: true });
  const temporary = mkdtempSync(path.join(cache, "node-install-"));
  try {
    copyFileSync(path.join(root, "package.json"), path.join(temporary, "package.json"));
    copyFileSync(path.join(root, "package-lock.json"), path.join(temporary, "package-lock.json"));
    process.stderr.write("Installing LitOpenCode office Node dependencies in its cache.\n");
    run("npm", ["ci", "--ignore-scripts", "--prefix", temporary]);
    renameSync(temporary, nodeRoot);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  }
}

function preparePython() {
  const binary = path.join(pythonRoot, "bin", "python");
  if (existsSync(binary)) return binary;
  mkdirSync(cache, { recursive: true });
  const temporary = mkdtempSync(path.join(cache, "python-install-"));
  try {
    process.stderr.write("Installing LitOpenCode office Python dependencies in its cache.\n");
    run("python3", ["-m", "venv", temporary]);
    run(path.join(temporary, "bin", "python"), ["-m", "pip", "install", "--disable-pip-version-check", "--require-hashes", "-r", path.join(root, "requirements.lock")]);
    renameSync(temporary, pythonRoot);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  }
  return binary;
}

const [command, ...args] = process.argv.slice(2);
if (command === "doctor") {
  console.log(JSON.stringify({ nodeReady: existsSync(path.join(nodeRoot, "node_modules", "pptxgenjs")), pythonReady: existsSync(path.join(pythonRoot, "bin", "python")) }));
} else if (Object.hasOwn(commands, command)) {
  const [kind, script] = commands[command];
  const binary = kind === "node" ? (prepareNode(), "node") : preparePython();
  const env = kind === "node" ? { ...process.env, NODE_PATH: path.join(nodeRoot, "node_modules") } : { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
  run(binary, [path.join(root, script), ...args], { env, cwd: process.cwd() });
} else {
  console.error("Usage: node run.mjs <compile|qa|embed|learn|validate|doctor> [arguments]");
  process.exit(2);
}
