// LitOpenCode's five tools on OpenCode 2. The tool bodies are the OpenCode 1 ones; this adapter gives
// each a closed JSON Schema input, validates the call before it runs, hands the body an OpenCode 1
// style context whose directory is the plugin's project, and returns `{ content, metadata }`. Each tool
// sits on the model's own tool list (`codemode: false`), as it did on OpenCode 1, so lit-plan, which has
// no Code Mode `execute`, still has them.
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "@opencode-ai/plugin";
import { litOpenCodeTools } from "../tools.ts";

export type ToolCallContextLike = {
  readonly sessionID: string;
  readonly agent: string;
  readonly messageID: string;
  readonly signal: AbortSignal;
};

export type ToolResultLike = {
  readonly content?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type ToolInfoLike = {
  readonly name: string;
  readonly description: string;
  readonly input: Record<string, unknown>;
  readonly options: { readonly codemode: false };
  readonly execute: (input: unknown, context: ToolCallContextLike) => Promise<ToolResultLike>;
};

export type ToolEditorLike = { add(tool: ToolInfoLike): void };

function resultToV2(result: ToolResult): ToolResultLike {
  if (typeof result === "string") return { content: result };
  return {
    content: result.output,
    metadata: { ...(result.metadata ?? {}), ...(result.title === undefined ? {} : { title: result.title }) }
  };
}

export function adaptTool(name: string, definition: ToolDefinition, projectRoot: string): ToolInfoLike {
  const schema = z.strictObject(definition.args as z.ZodRawShape);
  const { $schema: _dialect, ...input } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return {
    name,
    description: definition.description,
    input,
    options: { codemode: false },
    async execute(raw, context) {
      const args = schema.parse(raw ?? {});
      const v1Context: ToolContext = {
        sessionID: context.sessionID,
        messageID: context.messageID,
        agent: context.agent,
        directory: projectRoot,
        worktree: projectRoot,
        abort: context.signal,
        metadata: () => undefined,
        // No tool body asks today; a future one must not be approved without the user seeing a prompt.
        ask: async () => {
          throw new Error(`${name}: asking for permission from inside a tool is not supported on OpenCode 2`);
        }
      };
      return resultToV2(await definition.execute(args, v1Context));
    }
  };
}

export function litToolsForProject(projectRoot: string): readonly ToolInfoLike[] {
  return Object.entries(litOpenCodeTools).map(([name, definition]) => adaptTool(name, definition, projectRoot));
}

export function addLitTools(editor: ToolEditorLike, tools: readonly ToolInfoLike[]): void {
  for (const tool of tools) editor.add(tool);
}
