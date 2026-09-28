import type { Hooks } from "@opencode-ai/plugin";
import { activationBanner } from "./activation-probe.ts";
import type { SessionLookup } from "./session-lineage.ts";
import type { DeliverableHedgeGuardState } from "./deliverable-hedge-guard.ts";
import { dynamicRulesForPaths } from "./rules/hooks.ts";
import {
  applyLitOpenCodePostEditHook,
  applyLitOpenCodeToolAfterHook,
  applyLitOpenCodeToolBeforeHook,
  applyTaskRecursionGuard,
  mutatedFilePaths
} from "./tool-guards.ts";
import { captureKnowledgeEvent } from "./knowledge.ts";
import { recordMotionImageRead } from "./motion-image-reads.ts";

type ToolExecuteBeforeHook = NonNullable<Hooks["tool.execute.before"]>;
type ToolExecuteAfterHook = NonNullable<Hooks["tool.execute.after"]>;

export type ToolExecuteHookOptions = {
  readonly getSession?: SessionLookup;
  readonly deliverableHedgeGuard?: DeliverableHedgeGuardState;
};

export function createToolExecuteBeforeHook(options: ToolExecuteHookOptions = {}): ToolExecuteBeforeHook {
  return async (input, output) => {
    await applyTaskRecursionGuard(input, options.getSession);
    applyLitOpenCodeToolBeforeHook(input, output);
    await options.deliverableHedgeGuard?.before(input);
  };
}

export type ToolExecuteAfterHookOptions = {
  readonly projectRoot?: string;
  readonly knowledgeCaptureEnabled?: boolean;
  readonly deliverableHedgeGuard?: DeliverableHedgeGuardState;
  readonly onSkillActivation?: (sessionID: string, skillId: string) => void | Promise<void>;
};

export function createToolExecuteAfterHook(options: ToolExecuteAfterHookOptions = {}): ToolExecuteAfterHook {
  return async (input, output) => {
    applyLitOpenCodeToolAfterHook(input, output);
    applyLitOpenCodePostEditHook(input, output);
    recordMotionImageRead(input, options.projectRoot);

    const activationAction = input.tool === "lit" ? "activate"
      : input.tool === "litwork" || input.tool === "start-work" ? "start"
      : input.tool === "review-work" ? "review" : undefined;
    if (activationAction !== undefined && output.metadata?.command === input.tool &&
      output.metadata.action === activationAction && output.metadata.blocked !== true &&
      output.output.startsWith(`${activationBanner(input.tool)}\n`)) {
      await options.onSkillActivation?.(input.sessionID, input.tool);
    }

    await options.deliverableHedgeGuard?.after(input, output);

    if (options.projectRoot !== undefined && output.metadata?.litopencodeKnowledgeCapture !== undefined) {
      const request = output.metadata.litopencodeKnowledgeCapture;
      const metadata = { ...output.metadata };
      delete metadata.litopencodeKnowledgeCapture;
      try {
        const event = typeof request === "object" && request !== null
          ? { ...request as Record<string, unknown>, source: input.tool }
          : request;
        const receipt = await captureKnowledgeEvent(options.projectRoot, event, {
          surface: "tool.execute.after",
          captureEnabled: options.knowledgeCaptureEnabled
        });
        const knowledgeReceipt = receipt.status === "rejected"
          ? { status: receipt.status, reason: receipt.reason }
          : receipt.status === "disabled"
          ? { status: receipt.status }
          : { status: receipt.status, id: receipt.record.id, state: receipt.record.state };
        output.metadata = { ...metadata, litopencodeKnowledgeReceipt: knowledgeReceipt };
      } catch {
        output.metadata = { ...metadata, litopencodeKnowledgeReceipt: { status: "rejected", reason: "STORE_ERROR" } };
      }
    }

    // The dynamic rules lane rides the same post-edit surface: rules scoped by globs are delivered
    // only when a path the session actually mutated matches one.
    if (options.projectRoot === undefined) return;
    if (input.tool !== "edit" && input.tool !== "write") return;
    const mutated = mutatedFilePaths(input.args);
    if (mutated.length === 0) return;

    try {
      const rules = await dynamicRulesForPaths({ projectRoot: options.projectRoot }, input.sessionID, mutated);
      if (rules.text === "") return;
      output.output = `${output.output}\n\n${rules.text}`;
      output.metadata = { ...output.metadata, litopencodeRules: { lane: "dynamic", ruleCount: rules.ruleCount } };
    } catch { // no-excuse-ok: catch -- a rules read must never break the tool result the user is waiting on.
      // Rule discovery touches the filesystem; an unreadable repository must not fail the edit.
    }
  };
}
