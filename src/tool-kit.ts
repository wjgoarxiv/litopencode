import { z } from "zod";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin";

type ToolInput<Args extends Record<string, unknown>> = {
  readonly description: string;
  readonly args: Args;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
};

type ToolSchema = {
  string(): {
    optional(): unknown;
    describe(description: string): {
      optional(): unknown;
    };
  };
};

type ToolFactory = (<Args extends Record<string, unknown>>(input: {
  readonly description: string;
  readonly args: Args;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}) => ToolInput<Args>) & {
  readonly schema: ToolSchema;
};

// OpenCode's runtime helper is intentionally only an identity function with a
// zod namespace attached. Keeping both pieces local removes the host package's
// effect/ini dependency chain from packed consumers. A missing zod dependency
// must fail the import instead of silently downgrading to an unvalidated schema.
const toolFactory = (<Args extends Record<string, unknown>>(input: ToolInput<Args>) => input) as ToolFactory;
Object.assign(toolFactory, { schema: z });

export const tool = toolFactory;

export function projectRootFromContext(context: ToolContext): string {
  const worktree = context.worktree?.trim();
  if (worktree !== undefined && worktree !== "" && worktree !== "/") return worktree;

  const directory = context.directory?.trim();
  if (directory !== undefined && directory !== "") return directory;

  return ".";
}

export function summarizeEventTypes(events: readonly { readonly type: string }[]): string {
  if (events.length === 0) return "No ledger events recorded yet.";
  return events.map((event, index) => `${index + 1}. ${event.type}`).join("\n");
}

export function deniedToolResultFromArgs(
  args: Record<string, unknown>,
  command: string,
  allowedActions: readonly string[] = []
): ToolResult | undefined {
  const explicitInvalidAction =
    args.action !== undefined && args.action !== "deny" && (typeof args.action !== "string" || !allowedActions.includes(args.action));
  if (args.action !== "deny" && !explicitInvalidAction) return undefined;
  const rawReason = typeof args.reason === "string" ? args.reason.trim() : "";
  const reason = rawReason.length > 0 ? rawReason : "invalid LitOpenCode tool action";
  return {
    title: `LitOpenCode ${command} blocked`,
    output: `BLOCKED: ${reason}`,
    metadata: {
      command,
      action: "deny",
      blocked: true,
      reason
    }
  };
}

export function actionFromArgs<T extends readonly string[]>(args: Record<string, unknown>, allowed: T, fallback: T[number]): T[number] {
  if (typeof args.action !== "string") return fallback;
  return allowed.find((candidate) => candidate === args.action) ?? fallback;
}
