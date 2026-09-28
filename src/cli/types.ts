import type { OpenCodeHostCapabilities } from "./host-capabilities.ts";

export type CliResult = {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
};

export type PackageMetadata = {
  readonly name: string;
  readonly version: string;
  readonly packageRoot: string;
};

export type ParsedArgs = {
  readonly command?: string;
  readonly root: string;
  readonly fetchPublicUrl?: string;
  readonly fetchPublicJson: boolean;
  readonly fetchPublicAllowPrivateNetwork: boolean;
  readonly fetchPublicTimeoutMs?: number;
  readonly fetchPublicMaxBytes?: number;
  readonly dryRun: boolean;
  readonly permissionMode: InstallPermissionMode;
  readonly permissionModeExplicit: boolean;
  readonly permissionPrompt: PermissionPromptMode;
  readonly modelSelection?: InstallModelSelection;
  readonly modelPrompt: ModelPromptMode;
  readonly outputStylePrompt: PermissionPromptMode;
  readonly loop: LoopArgs;
};

// Arguments for the evidence-ledger verbs. They address a project workspace, not the OpenCode
// config root, so they carry their own --project rather than overloading --root.
export type LoopArgs = {
  readonly projectRoot: string;
  readonly json: boolean;
  readonly force: boolean;
  readonly needsUserDecision: boolean;
  readonly sessionId?: string;
  readonly objective?: string;
  readonly title?: string;
  readonly criteria: readonly string[];
  readonly criterionId?: string;
  readonly kind?: string;
  readonly ref?: string;
  readonly detail?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly directive?: string;
  readonly resolve?: string;
};

export type InstallModelRoute = {
  readonly provider: string;
  readonly model: string;
  readonly effort?: InstallModelEffort;
};

// The top-level fields are the lead route (planning/review); `helper` routes execution/research
// and defaults to the lead when absent.
export type InstallModelSelection = InstallModelRoute & {
  readonly helper?: InstallModelRoute;
};

export type InstallModelEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ModelConfigClass =
  | "fresh"
  | "managed_legacy"
  | "gpt56_managed"
  | "astra_managed"
  | "gpt56_other"
  | "custom"
  | "mixed";
export type ModelConfigClassification = {
  readonly class: ModelConfigClass;
  readonly originalDispatchId: string | null;
};
export type ModelPromptMode = "auto" | "always" | "never";
export type PermissionPromptMode = "auto" | "always" | "never";
export type InstallPermissionMode = "safe" | "balanced" | "yolo";
export type InstallPermissionChoice = {
  readonly mode: InstallPermissionMode;
  readonly explicit: boolean;
};

export type InstallProgress = {
  start(packageLabel: string): Promise<void>;
  run<T>(label: InstallStageLabel, task: () => Promise<T>): Promise<T>;
  complete(): Promise<void>;
  fail(message: string): Promise<void>;
};

export type InstallStageLabel =
  | "Resolve package"
  | "Read OpenCode config"
  | "Write litopencode.json"
  | "Register plugin"
  | "Verify install";

export type JsonPatchOperation =
  | {
      readonly op: "add";
      readonly path: "/plugin";
      readonly value: readonly string[];
    }
  | {
      readonly op: "replace";
      readonly path: "/plugin";
      readonly value: readonly string[];
    }
  | {
      readonly op: "replace";
      readonly path: "/plugin";
      readonly value: readonly unknown[];
    }
  | {
      readonly op: "add";
      readonly path: "/plugin/-";
      readonly value: string;
    }
  | {
      readonly op: "replace";
      readonly path: `/plugin/${number}`;
      readonly value: unknown;
    };

export type PluginMutation = {
  readonly changed: boolean;
  readonly plugin: {
    readonly alreadyPresent: boolean;
    readonly currentCount: number;
    readonly resultCount: number;
    readonly add: readonly string[];
  };
  readonly patch: readonly JsonPatchOperation[];
};

export type InstallRouteReport = {
  readonly managed: Readonly<Record<string, {
    readonly agentId: string;
    readonly model?: string;
    readonly variant?: string;
    readonly reasoningEffort?: string;
    readonly status: "configured";
  }>>;
  readonly preservedAgents: readonly string[];
  readonly planningOnly: {
    readonly agentId: "lit-plan";
    readonly permissions: {
      readonly edit: "deny";
      readonly bash: "deny";
      readonly task: "deny";
    };
    readonly tools: {
      readonly write: false;
      readonly edit: false;
      readonly bash: false;
      readonly task: false;
    };
  };
};

export type InstallReport = {
  readonly dryRun: boolean;
  readonly path: string;
  readonly litopencodeConfig: {
    readonly path: string;
    readonly alreadyPresent: boolean;
    readonly changed: boolean;
    readonly agents: readonly string[];
    readonly categories: readonly string[];
    readonly model: {
      readonly provider?: string;
      readonly model?: string;
      readonly effort?: InstallModelEffort;
      readonly helper?: InstallModelRoute;
      readonly classification: ModelConfigClassification;
      readonly existingVariant?: string;
      readonly changed: boolean;
    };
    readonly permissionMode: {
      readonly mode: InstallPermissionMode;
      readonly changed: boolean;
    };
    readonly outputStyle: {
      readonly style: string;
      readonly changed: boolean;
    };
  };
  readonly plugin: PluginMutation["plugin"];
  readonly commandAliases: {
    readonly path: string;
    readonly changed: boolean;
    readonly write: readonly string[];
    readonly preserve: readonly string[];
  };
  readonly nativeSkills: {
    readonly path: string;
    readonly changed: boolean;
    readonly write: readonly string[];
    readonly preserve: readonly string[];
    readonly collisions: readonly string[];
    // Present only when <root>/skills is a symlink; mirrors native-skill-integrity's resolveSafeDirectory follow.
    readonly link?: {
      readonly path: string;
      readonly target: string;
      readonly gitRepositoryRoot?: string;
    };
  };
  readonly hostLimits: {
    readonly path: string;
    readonly reconfigure: boolean;
    readonly changed: boolean;
    readonly contextCeilingTokens: number;
    readonly compactionTriggerTokens: number;
    readonly compactionReserveTokens: number;
  };
  readonly patch: readonly JsonPatchOperation[];
  readonly changed: boolean;
  readonly routes?: InstallRouteReport;
  readonly capabilities: OpenCodeHostCapabilities;
  readonly package: Pick<PackageMetadata, "name" | "version">;
};
