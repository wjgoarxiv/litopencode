// Tool hooks on OpenCode 2, reusing the OpenCode 1 guards. OpenCode 2 renamed two tools (bash is shell,
// task is subagent) and names a file argument `path`, so each call is shown to the guards under the
// names they know. A throw in `execute.before` fails that one call; `execute.after` must never throw.
import { createToolExecuteAfterHook, createToolExecuteBeforeHook } from "../hooks.ts";
import type { DeliverableHedgeGuardState } from "../deliverable-hedge-guard.ts";
import type { SessionLookup } from "../session-lineage.ts";

export type ToolBeforeEvent = {
  tool: string;
  readonly sessionID: string;
  readonly agent: string;
  readonly messageID: string;
  readonly id: string;
  input: unknown;
};

type ToolContent = string | ReadonlyArray<{ readonly type: string; readonly text?: string }>;

export type ToolAfterEvent = {
  readonly tool: string;
  readonly sessionID: string;
  readonly agent: string;
  readonly messageID: string;
  readonly id: string;
  readonly input: unknown;
  readonly status: "completed" | "error";
  result?: { content?: ToolContent; metadata?: Readonly<Record<string, unknown>>; output?: unknown };
};

const v1ToolNames: Readonly<Record<string, string>> = { shell: "bash", subagent: "task" };

function v1ToolName(tool: string): string {
  return v1ToolNames[tool] ?? tool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The arguments as the OpenCode 1 guards read them: a `path` also answers to `filePath`. */
function v1Args(input: unknown): { readonly args: unknown; readonly aliased: boolean } {
  if (!isRecord(input) || typeof input.path !== "string" || "filePath" in input) return { args: input, aliased: false };
  return { args: { ...input, filePath: input.path }, aliased: true };
}

function contentText(content: ToolContent | undefined): string | undefined {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return undefined;
}

export type V2ToolHookOptions = {
  readonly projectRoot: string;
  readonly knowledgeCaptureEnabled: boolean;
  readonly getSession: SessionLookup;
  readonly deliverableHedgeGuard: DeliverableHedgeGuardState;
};

export function createV2ToolHooks(options: V2ToolHookOptions) {
  const before = createToolExecuteBeforeHook({ getSession: options.getSession, deliverableHedgeGuard: options.deliverableHedgeGuard });
  const after = createToolExecuteAfterHook({
    projectRoot: options.projectRoot,
    knowledgeCaptureEnabled: options.knowledgeCaptureEnabled,
    deliverableHedgeGuard: options.deliverableHedgeGuard
  });

  async function executeBefore(event: ToolBeforeEvent): Promise<void> {
    const { args, aliased } = v1Args(event.input);
    const output = { args };
    await before({ tool: v1ToolName(event.tool), sessionID: event.sessionID, callID: event.id } as Parameters<typeof before>[0], output as Parameters<typeof before>[1]);
    if (output.args === args) return;
    if (aliased && isRecord(output.args)) {
      const { filePath: _alias, ...rest } = output.args;
      event.input = rest;
      return;
    }
    event.input = output.args;
  }

  async function executeAfter(event: ToolAfterEvent): Promise<void> {
    if (event.status !== "completed" || event.result === undefined) return;
    const text = contentText(event.result.content);
    if (text === undefined) return;
    const output = { title: "", output: text, metadata: { ...(event.result.metadata ?? {}) } };
    try {
      await after(
        { tool: v1ToolName(event.tool), sessionID: event.sessionID, callID: event.id, args: v1Args(event.input).args } as Parameters<typeof after>[0],
        output as Parameters<typeof after>[1]
      );
    } catch { // no-excuse-ok: catch -- OpenCode 2 treats a throw after a tool ran as a crash; the result stays as it was.
      return;
    }
    event.result = { ...event.result, content: output.output, metadata: output.metadata };
  }

  return { executeBefore, executeAfter };
}
