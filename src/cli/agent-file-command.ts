// The install-time step and the `litopencode agent-file` command around the LitFamily block: one place
// that decides whether OpenCode's global AGENTS.md gets the block, and says so in one `AGENT_FILE:` line.

import fs from "node:fs";
import path from "node:path";
import {
  agentFileBody,
  agentFileLine,
  agentFileState,
  applyAgentFile,
  claudeFallbackFile,
  globalAgentFilePath,
  readAgentFileMode,
  writeAgentFileMode,
  type AgentFileMode,
  type AgentFileResult
} from "./agent-file.ts";
import { createPromptReader } from "./model-routing.ts";
import type { CliResult, ParsedArgs } from "./types.ts";

const QUESTION = "Add the short LitFamily block to OpenCode's global AGENTS.md? Your own text stays as it is. [Y/n] ";
const SHADOW_HINT =
  "OpenCode reads ~/.claude/CLAUDE.md while this file is missing, and a new AGENTS.md would hide it; create the file yourself first, or set OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1";

function shouldAsk(env: NodeJS.ProcessEnv): boolean {
  if (env.LITOPENCODE_AGENT_FILE_PROMPT === "1") return true;
  if (env.LITOPENCODE_AGENT_FILE_PROMPT === "0") return false;
  return process.stdin.isTTY === true && process.stdout.isTTY === true && env.CI === undefined;
}

async function askYes(): Promise<boolean> {
  const reader = createPromptReader();
  try {
    return !/^\s*n/iu.test(await reader.question(QUESTION));
  } finally {
    reader.close();
  }
}

const note = (status: string, filePath: string, hint: string): string => `AGENT_FILE: ${status} ${filePath} (${hint})`;

type InstallInput = {
  readonly root: string;
  readonly version: string;
  readonly assumeYes: boolean;
  readonly skip: boolean;
};

export type AgentFilePlan = {
  readonly path: string;
  readonly state: string;
  readonly mode: AgentFileMode | "unset";
  readonly action: "add" | "refresh" | "ask" | "none" | "off" | "skipped-claude-fallback";
};

/** What an install would do to the global file, without asking or writing. */
export async function planAgentFile(input: InstallInput, env: NodeJS.ProcessEnv = process.env): Promise<AgentFilePlan> {
  const filePath = globalAgentFilePath(input.root);
  const mode = await readAgentFileMode(input.root, env);
  const state = agentFileState({ path: filePath, version: input.version });
  const base = { path: filePath, state, mode };
  if (input.skip || mode === "off") return { ...base, action: "off" };
  if (state.startsWith("present")) return { ...base, action: "none" };
  if (state.startsWith("stale")) return { ...base, action: "refresh" };
  // A malformed, linked or non-UTF-8 file goes through the writer, which refuses it and says why.
  if (state !== "absent") return { ...base, action: "refresh" };
  if (!fs.existsSync(filePath) && claudeFallbackFile(env) !== null) return { ...base, action: "skipped-claude-fallback" };
  return { ...base, action: input.assumeYes ? "add" : "ask" };
}

/** The install step: adds on a yes, refreshes a block already there, leaves everything else as it is. */
export async function installAgentFile(input: InstallInput, env: NodeJS.ProcessEnv = process.env, ask: () => Promise<boolean> = askYes): Promise<string> {
  const plan = await planAgentFile(input, env);
  const write = (): string =>
    agentFileLine(applyAgentFile({ path: plan.path, version: input.version, body: agentFileBody("global"), action: "install" }));
  switch (plan.action) {
    case "off":
      return note("off", plan.path, "left as it is; turn on: litopencode agent-file on");
    case "none":
      return agentFileLine({ status: "unchanged", path: plan.path });
    case "refresh":
    case "add":
      return write();
    case "skipped-claude-fallback":
      return note("skipped-claude-fallback", plan.path, SHADOW_HINT);
    case "ask":
      if (!shouldAsk(env)) return note("skipped", plan.path, "add the LitFamily block: litopencode agent-file on");
      if (await ask()) return write();
      await writeAgentFileMode(input.root, "off");
      return note("off", plan.path, "turn on later: litopencode agent-file on");
  }
}

/** `litopencode agent-file on|off|remove|project`. */
export async function runAgentFileCommand(parsed: ParsedArgs, version: string, env: NodeJS.ProcessEnv = process.env): Promise<CliResult> {
  const action = parsed.agentFileAction;
  const failed = (result: AgentFileResult): number => (result.status.startsWith("refused-") ? 1 : 0);
  if (action === "project") {
    const dir = path.resolve(parsed.agentFileDir ?? process.cwd());
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { exitCode: 2, stderr: `agent-file project: ${dir} is not a folder` };
    const result = applyAgentFile({ path: path.join(dir, "AGENTS.md"), version, body: agentFileBody("project"), action: "install", dryRun: parsed.dryRun, backup: false });
    return { exitCode: failed(result), stdout: agentFileLine(result) };
  }
  const filePath = globalAgentFilePath(parsed.root);
  const lines: string[] = [];
  if (action === "on" || action === "off") {
    if (!parsed.dryRun) await writeAgentFileMode(parsed.root, action);
    lines.push(`AGENT_FILE: ${action}`);
  }
  if (action === "on" && !fs.existsSync(filePath) && claudeFallbackFile(env) !== null) {
    lines.push(note("skipped-claude-fallback", filePath, SHADOW_HINT));
    return { exitCode: 0, stdout: lines.join("\n") };
  }
  const result = applyAgentFile({
    path: filePath,
    version,
    body: agentFileBody("global"),
    action: action === "on" ? "install" : "uninstall",
    dryRun: parsed.dryRun
  });
  lines.push(agentFileLine(result));
  return { exitCode: failed(result), stdout: lines.join("\n") };
}
