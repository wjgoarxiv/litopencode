import { compactionTriggerTokens, contextCeilingTokens } from "./host-limits.ts";

export type HostCapabilityStatus = "hard" | "advisory" | "unavailable";

export type HostCapability = {
  readonly status: HostCapabilityStatus;
  readonly reason: string;
  readonly observedSource: string;
};

export type OpenCodeHostCapabilities = {
  readonly contextCeiling372k: HostCapability;
  readonly autoCompaction334800: HostCapability;
  readonly subagentConcurrency20: HostCapability;
};

export function openCodeHostCapabilities(): OpenCodeHostCapabilities {
  const observedSource = "OpenCode 1.17.18 config schema and session overflow implementation";
  return {
    contextCeiling372k: {
      status: "hard",
      reason: "OpenCode accepts provider model input and context limits; LitOpenCode configures the exact " + contextCeilingTokens + " token ceiling.",
      observedSource
    },
    autoCompaction334800: {
      status: "hard",
      reason:
        "OpenCode compacts at model input minus the reserved buffer; " +
        contextCeilingTokens +
        " minus 37200 yields " +
        compactionTriggerTokens +
        ".",
      observedSource
    },
    subagentConcurrency20: {
      status: "advisory",
      reason: "Use at most 20 concurrent subagents; OpenCode exposes no verified numeric hard-limit setting.",
      observedSource
    }
  };
}
