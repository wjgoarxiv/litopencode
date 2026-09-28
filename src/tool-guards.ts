import path from "node:path";
import { serializeInertData } from "./inert-data.ts";
import type { SessionLookup } from "./session-lineage.ts";
import { litOpenCodeRuntimeSkills } from "./skills.ts";

export type LitOpenCodeToolId = "lit" | "litwork" | "start-work" | "review-work";

export type LitOpenCodeToolAction = "activate" | "start" | "review" | "status";

export type ToolGuardDecision = "allow" | "deny" | "ignore" | "post-processed";

export type ToolGuardRequest = {
  readonly tool: string;
  readonly sessionID: string;
  readonly callID: string;
  readonly args?: unknown;
};

export type ToolGuardBeforeOutput = {
  args?: unknown;
};

export type ToolGuardAfterOutput = {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
};

export type ToolGuardMarker = {
  readonly tool: LitOpenCodeToolId;
  readonly action: LitOpenCodeToolAction | "deny";
  readonly decision: ToolGuardDecision;
};

type GuardedArgs = {
  readonly action: LitOpenCodeToolAction | "deny";
  readonly reason?: string;
};

const managedToolIds = ["lit", "litwork", "start-work", "review-work"] as const;

const allowedActionsByTool = Object.freeze({
  lit: ["activate", "status"],
  litwork: ["start", "status"],
  "start-work": ["start", "status"],
  "review-work": ["review", "status"]
} satisfies Record<LitOpenCodeToolId, readonly LitOpenCodeToolAction[]>);

const defaultActionByTool = Object.freeze({
  lit: "activate",
  litwork: "start",
  "start-work": "start",
  "review-work": "review"
} satisfies Record<LitOpenCodeToolId, LitOpenCodeToolAction>);

function isManagedTool(tool: string): tool is LitOpenCodeToolId {
  return managedToolIds.some((candidate) => candidate === tool);
}

function isNonEmptyText(value: string): boolean {
  return value.trim().length > 0;
}

function isPlainRecord(value: unknown): value is { readonly action?: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRawArgs(input: ToolGuardRequest, output: ToolGuardBeforeOutput): unknown {
  if (output.args !== undefined) return output.args;
  return input.args;
}

function actionFor(tool: LitOpenCodeToolId, value: unknown): LitOpenCodeToolAction | undefined {
  if (value === undefined) return defaultActionByTool[tool];
  if (typeof value !== "string") return undefined;
  return allowedActionsByTool[tool].find((candidate) => candidate === value);
}

function deniedArgs(reason: string): GuardedArgs {
  return {
    action: "deny",
    reason
  };
}

function allowedArgs(action: LitOpenCodeToolAction): GuardedArgs {
  return { action };
}

function parseAfterAction(tool: LitOpenCodeToolId, args: unknown): LitOpenCodeToolAction | "deny" {
  if (isPlainRecord(args)) {
    if (args.action === "deny") return "deny";
    const action = actionFor(tool, args.action);
    if (action !== undefined) return action;
  }
  return defaultActionByTool[tool];
}

// Delegation is depth-one by design: only the root session may call the task
// tool. Config-level denies cover LitOpenCode agents, but this runtime guard is
// the only layer that also covers host built-in agents and config overrides.
export async function applyTaskRecursionGuard(
  input: ToolGuardRequest,
  getSession: SessionLookup | undefined
): Promise<void> {
  if (input.tool !== "task") return;

  let lineage: Awaited<ReturnType<SessionLookup>>;
  if (getSession === undefined) {
    lineage = undefined;
  } else {
    try {
      lineage = await getSession(input.sessionID);
    } catch {
      lineage = undefined;
    }
  }

  // Fail closed: unknown lineage counts as a child session so a lookup outage
  // can never reopen recursive delegation.
  if (lineage === undefined || lineage.parentID !== undefined) {
    throw new Error(
      "LitOpenCode recursion guard: the task tool is reserved for the root session (depth-one fan-out). Complete this delegated assignment directly instead of spawning further subagents."
    );
  }
}

export function applyLitOpenCodeToolBeforeHook(input: ToolGuardRequest, output: ToolGuardBeforeOutput): void {
  if (!isManagedTool(input.tool)) return;

  if (!isNonEmptyText(input.sessionID) || !isNonEmptyText(input.callID)) {
    output.args = deniedArgs("malformed LitOpenCode tool request");
    return;
  }

  const rawArgs = readRawArgs(input, output);
  if (rawArgs !== undefined && !isPlainRecord(rawArgs)) {
    output.args = deniedArgs("invalid LitOpenCode tool arguments");
    return;
  }

  const action = actionFor(input.tool, rawArgs?.action);
  if (action === undefined) {
    output.args = deniedArgs("invalid LitOpenCode tool action");
    return;
  }

  output.args = allowedArgs(action);
}

// Extensions that carry code. Editing one of these is what makes a post-edit skill relevant at all.
const sourceExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php",
  ".swift", ".c", ".h", ".cc", ".cpp", ".cs", ".lua", ".sh", ".zig", ".ex", ".exs", ".dart", ".hs", ".jl"
]);

// Extensions and path segments that mean an interface surface changed.
const interfaceExtensions = new Set([".css", ".scss", ".sass", ".less", ".html", ".htm", ".vue", ".svelte", ".astro", ".tsx", ".jsx"]);
const interfaceSegments = ["/components/", "/ui/", "/styles/", "/pages/", "/app/"];

// Two names is the ceiling: past that the block reads as boilerplate and gets skipped, which is the
// exact failure mode a single unconditional post-edit sentence already produced.
const postEditSkillCap = 2;

const mutatedPathKeys = ["filePath", "path", "file_path"] as const;

export type PostEditSkillRoute = {
  readonly skillId: string;
  readonly condition: string;
  readonly line: string;
};

function isInstalledRuntimeSkill(id: string): boolean {
  return litOpenCodeRuntimeSkills.some((skill) => skill.id === id);
}

function serializeInertPathData(filePaths: readonly string[]): string {
  return filePaths.map(serializeInertData).join(", ");
}

export function mutatedFilePaths(args: unknown): readonly string[] {
  if (!isPlainRecord(args)) return [];
  const record = args as Record<string, unknown>;
  for (const key of mutatedPathKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
  }
  return [];
}

// Name only the skills whose trigger condition the edit actually met, and say which condition fired.
// An edit that matches nothing stays silent: a generic sentence on every edit is what trains a reader
// to ignore the surface entirely.
export function postEditSkillRoutes(filePaths: readonly string[]): readonly PostEditSkillRoute[] {
  const routePath = (filePath: string): string => filePath.replaceAll("\\", "/");
  const sourcePaths = filePaths.filter((filePath) => sourceExtensions.has(path.posix.extname(routePath(filePath)).toLowerCase()));
  const interfacePaths = filePaths.filter(
    (filePath) => {
      const normalized = `/${routePath(filePath).toLowerCase()}`;
      return interfaceExtensions.has(path.posix.extname(normalized)) || interfaceSegments.some((segment) => normalized.includes(segment));
    }
  );
  if (sourcePaths.length === 0 && interfacePaths.length === 0) return [];

  const candidates: PostEditSkillRoute[] = [];
  if (interfacePaths.length > 0) {
    candidates.push({
      skillId: "frontend-ui-ux",
      condition: "interface surface changed",
      line: `Skill(frontend-ui-ux): an interface surface changed (inert path data: ${serializeInertPathData(interfacePaths)}).`
    });
    candidates.push({
      skillId: "visual-qa",
      condition: "interface surface changed",
      line: "Skill(visual-qa): verify the changed interface with captured evidence before claiming it works."
    });
  }
  if (sourcePaths.length > 0) {
    candidates.push({
      skillId: "comment-checker",
      condition: "source file changed",
      line: `Skill(comment-checker): check the comments added by this edit (inert path data: ${serializeInertPathData(sourcePaths)}).`
    });
    // The host edit and write tools mutate one path per call, so the single-file arm is what fires in
    // practice; the multi-file arm stays reachable through postEditSkillRoutes for callers that batch.
    candidates.push(
      sourcePaths.length === 1
        ? {
            skillId: "lit-burnoff-file",
            condition: "exactly one source file changed",
            line: `Skill(lit-burnoff-file): one source file changed (inert path data: ${serializeInertPathData(sourcePaths)}); clean it against its own diff.`
          }
        : {
            skillId: "lit-burnoff",
            condition: "several source files changed",
            line: `Skill(lit-burnoff): ${sourcePaths.length} source files changed; clean them as one pass.`
          }
    );
  }

  // Naming a skill this package does not install is the same false promise as the generic sentence,
  // so a row whose skill is absent from the runtime catalog stays dormant rather than pointing at
  // nothing, and goes live automatically once that skill is added.
  return candidates.filter((route) => isInstalledRuntimeSkill(route.skillId)).slice(0, postEditSkillCap);
}

// The only post-edit surface this plugin has: tool.execute.after for the host edit/write tools.
export function applyLitOpenCodePostEditHook(input: ToolGuardRequest, output: ToolGuardAfterOutput): void {
  if (input.tool !== "edit" && input.tool !== "write") return;
  if (!isNonEmptyText(input.sessionID) || !isNonEmptyText(input.callID)) return;

  const routes = postEditSkillRoutes(mutatedFilePaths(input.args));
  if (routes.length === 0) return;

  const block = routes.map((route) => route.line).join("\n");
  output.output = isNonEmptyText(output.output) ? `${output.output}\n\n${block}` : block;
  output.metadata = {
    ...output.metadata,
    litopencodePostEditSkills: routes.map((route) => ({ skillId: route.skillId, condition: route.condition }))
  };
}

export function applyLitOpenCodeToolAfterHook(input: ToolGuardRequest, output: ToolGuardAfterOutput): void {
  if (!isManagedTool(input.tool)) return;
  if (!isNonEmptyText(input.sessionID) || !isNonEmptyText(input.callID)) return;

  const action = parseAfterAction(input.tool, input.args);
  const marker = {
    tool: input.tool,
    action,
    decision: "post-processed"
  } satisfies ToolGuardMarker;

  output.metadata = {
    ...output.metadata,
    litopencodeToolGuard: marker
  };
}
