#!/usr/bin/env node
// First-use runtime for the installed OpenCode skill. All installs stay in cache.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, renameSync, rmSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { commandPlan, npmPlan, supportedPython } from "./command.mjs";

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
  render: ["python", "scripts/render_pages.py"],
};

// Windows: Node refuses to spawn a .cmd shim without a shell (spawn EINVAL) and a bare name never
// matches npm.cmd or python.exe; command.mjs plans the launch (npm through Node and its own CLI).
const isWindows = process.platform === "win32";

function run(binary, args, options = {}) {
  const launch = binary === "npm" ? npmPlan(args) : commandPlan(binary, args);
  const result = spawnSync(launch.command, launch.args, { stdio: "inherit", cwd: root, shell: launch.shell, windowsHide: true, ...options });
  if (result.error) throw new Error(`${binary} could not start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status || 1);
}

const venvPython = (venv) => path.join(venv, ...(isWindows ? ["Scripts", "python.exe"] : ["bin", "python"]));

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
  const binary = venvPython(pythonRoot);
  if (existsSync(binary)) return binary;
  mkdirSync(cache, { recursive: true });
  const temporary = mkdtempSync(path.join(cache, "python-install-"));
  try {
    process.stderr.write("Installing LitOpenCode office Python dependencies in its cache.\n");
    const python = supportedPython({ min: 10, max: 14, override: process.env.LITOPENCODE_OFFICE_PYTHON });
    if (!python.ok) throw new Error(`${python.detail}. Install Python 3.10 to 3.14, or set LITOPENCODE_OFFICE_PYTHON to one.`);
    run(python.command, ["-m", "venv", temporary]);
    run(venvPython(temporary), ["-m", "pip", "install", "--disable-pip-version-check", "--require-hashes", "-r", path.join(root, "requirements.lock")]);
    renameSync(temporary, pythonRoot);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  }
  return binary;
}

const [command, ...args] = process.argv.slice(2);
if (command === "doctor") {
  console.log(JSON.stringify({ nodeReady: existsSync(path.join(nodeRoot, "node_modules", "pptxgenjs")), pythonReady: existsSync(venvPython(pythonRoot)) }));
} else if (Object.hasOwn(commands, command)) {
  const [kind, script] = commands[command];
  const binary = kind === "node" ? (prepareNode(), "node") : preparePython();
  const env = kind === "node" ? { ...process.env, NODE_PATH: path.join(nodeRoot, "node_modules") } : { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
  run(binary, [path.join(root, script), ...args], { env, cwd: process.cwd() });
} else {
  console.error("Usage: node run.mjs <compile|qa|embed|learn|validate|render|doctor> [arguments]");
  process.exit(2);
}
