import type { Config } from "@opencode-ai/plugin";
import type { JsonObject, ReasoningEffort, TextVerbosity } from "../config.ts";

export type AgentTier = "default" | "role" | "specialist";
export type AgentMode = "primary" | "subagent";
export type OpenCodeAgentMode = "all" | "subagent";
export type AgentToolId = "read" | "write" | "edit" | "bash" | "webfetch" | "grep";
export type AgentPermission = "ask" | "allow" | "deny";

export type LitOpenCodeAgent = {
  readonly id: string;
  readonly name: string;
  readonly tier: AgentTier;
  readonly defaultRole: boolean;
  readonly recommended: boolean;
  readonly mode: AgentMode;
  readonly summary: string;
  readonly prompt: string;
  readonly tools: readonly AgentToolId[];
  readonly color: string;
  readonly maxSteps: number;
};

export type OpenCodeAgentConfig = {
  readonly description: string;
  readonly prompt: string;
  readonly mode: OpenCodeAgentMode;
  readonly tools: Record<string, boolean>;
  readonly color: string;
  readonly maxSteps: number;
  readonly model?: string;
  readonly variant?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly textVerbosity?: TextVerbosity;
  readonly thinking?: boolean;
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly providerOptions?: JsonObject;
  readonly hidden?: boolean;
  readonly permission?: {
    readonly edit?: AgentPermission;
    readonly bash?: AgentPermission;
    readonly webfetch?: AgentPermission;
    readonly task?: AgentPermission;
  };
};

export type OpenCodePermissionConfig =
  | AgentPermission
  | {
      readonly [key: string]: unknown;
    };

export type AgentConfigTarget = Pick<Config, "agent" | "provider"> & {
  default_agent?: string;
  permission?: OpenCodePermissionConfig;
};

export const planningTools = Object.freeze(["read", "grep"] satisfies readonly AgentToolId[]);
export const workerTools = Object.freeze(["read", "write", "edit", "bash", "grep"] satisfies readonly AgentToolId[]);
export const reviewTools = Object.freeze(["read", "bash", "grep"] satisfies readonly AgentToolId[]);
export const researchTools = Object.freeze(["read", "webfetch", "grep"] satisfies readonly AgentToolId[]);
