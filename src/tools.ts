import { activationBanner, activationProbeInstruction } from "./activation-probe.ts";
import { litActivationBanner, startWorkPromptInjection } from "./commands.ts";
import fs from "node:fs/promises";
import { createLitGoalOperations, type LenientLedgerReadResult } from "./ledger.ts";
import { actionFromArgs, deniedToolResultFromArgs, projectRootFromContext, summarizeEventTypes, tool } from "./tool-kit.ts";
import type { ToolDefinition, ToolResult } from "@opencode-ai/plugin";
import { LifecycleConflictError, createBoundedAuthorityLifecycle } from "./bounded-authority.ts";
import { createRuntimePaths } from "./state.ts";
import { loadConfig } from "./config.ts";
import {
  captureKnowledgeEvent,
  inspectKnowledge,
  queryKnowledge,
  reviewKnowledgeRecord,
  type KnowledgeState
} from "./knowledge.ts";

const litActions = ["activate", "status"] as const;
const litworkActions = ["start", "status"] as const;
const startWorkActions = ["start", "status"] as const;
const reviewWorkActions = ["review", "status"] as const;
const wikifyActions = ["capture", "save", "review", "query", "status"] as const;

function formatLenientDiagnostic(result: LenientLedgerReadResult): string {
  if (result.skipped.length === 0) return "";
  const count = result.skipped.length;
  const first = result.skipped[0];
  return `\n${count} invalid ledger event(s) skipped at ${result.filePath}; first error: ${first.error} (line ${first.line})`;
}
const litPlanStartWorkBlocker =
  "BLOCKED: lit-plan cannot execute the start-work tool in-place because OpenCode tool calls do not switch the active agent. Run /start-work so OpenCode routes the approved plan to lit-implement.";

function actionSchema(description: string): ReturnType<ReturnType<typeof tool.schema.string>["optional"]> {
  return tool.schema.string().describe(description).optional();
}

function assertNever(value: never): never {
  throw new Error(`Unhandled LitOpenCode action: ${value}`);
}

function blockedWikifyStoreResult(action: (typeof wikifyActions)[number]): ToolResult {
  return {
    title: "Wikify knowledge operation blocked",
    output: "BLOCKED: the local Wikify knowledge operation failed closed.",
    metadata: { command: "wikify", action, blocked: true, reason: "STORE_ERROR" }
  };
}

export const litTool = tool({
  description: "Inspect the durable ledger only on explicit request. Bare lit activation is automatic: the chat hook routes it as bounded direct work. Do not call this for a bounded task.",
  args: {
    action: actionSchema("LitOpenCode action. Supported values: activate, status.")
  },
  async execute(args, context): Promise<ToolResult> {
    const denied = deniedToolResultFromArgs(args, "lit", litActions);
    if (denied !== undefined) return denied;
    const action = actionFromArgs(args, litActions, "activate");
    const operations = createLitGoalOperations(projectRootFromContext(context));

    switch (action) {
      case "activate": {
        await operations.init();
        await operations.append({
          type: "tool.lit.activated",
          sessionID: context.sessionID,
          ...(context.agent === undefined ? {} : { agent: context.agent })
        });
        return {
          title: "LitOpenCode activated",
          output: `${litActivationBanner}\n${activationProbeInstruction("lit-loop")}\n\nLedger initialized and activation recorded.`,
          metadata: {
            command: "lit",
            action
          }
        };
      }
      case "status": {
        const lenient = await operations.readLenient();
        return {
          title: "LitOpenCode ledger status",
          output: `${summarizeEventTypes(lenient.events)}${formatLenientDiagnostic(lenient)}`,
          metadata: {
            command: "lit",
            action,
            eventCount: lenient.events.length,
            ...(lenient.skipped.length > 0 ? { skippedCount: lenient.skipped.length } : {})
          }
        };
      }
      default:
        return assertNever(action);
    }
  }
}) as unknown as ToolDefinition;

export const litworkTool = tool({
  description: "Start or inspect a durable loop only when the user asks for persistent tracking or the task needs multi-turn resumption; do not call for bounded work.",
  args: {
    action: actionSchema("LitOpenCode work action. Supported values: start, status.")
  },
  async execute(args, context): Promise<ToolResult> {
    const denied = deniedToolResultFromArgs(args, "litwork", litworkActions);
    if (denied !== undefined) return denied;
    const action = actionFromArgs(args, litworkActions, "start");
    const operations = createLitGoalOperations(projectRootFromContext(context));

    switch (action) {
      case "start": {
        await operations.init();
        await operations.append({
          type: "tool.litwork.started",
          sessionID: context.sessionID,
          ...(context.agent === undefined ? {} : { agent: context.agent })
        });
        return {
          title: "LitOpenCode work loop started",
          output: `${litActivationBanner}\n${activationProbeInstruction("lit-loop")}\n\nWork loop start recorded in the durable ledger.`,
          metadata: {
            command: "litwork",
            action
          }
        };
      }
      case "status": {
        const lenient = await operations.readLenient();
        return {
          title: "LitOpenCode work loop status",
          output: `${summarizeEventTypes(lenient.events)}${formatLenientDiagnostic(lenient)}`,
          metadata: {
            command: "litwork",
            action,
            eventCount: lenient.events.length,
            ...(lenient.skipped.length > 0 ? { skippedCount: lenient.skipped.length } : {})
          }
        };
      }
      default:
        return assertNever(action);
    }
  }
}) as unknown as ToolDefinition;

export const startWorkTool = tool({
  description: "Start or resume an approved durable plan only through explicit user start-work requests; do not use for a bounded task.",
  args: {
    action: actionSchema("LitOpenCode start-work action. Supported values: start, status.")
  },
  async execute(args, context): Promise<ToolResult> {
    const denied = deniedToolResultFromArgs(args, "start-work", startWorkActions);
    if (denied !== undefined) return denied;
    const action = actionFromArgs(args, startWorkActions, "start");
    const operations = createLitGoalOperations(projectRootFromContext(context));

    switch (action) {
      case "start": {
        await operations.init();
        if (context.agent === "lit-plan") {
          await operations.append({
            type: "tool.start-work.blocked_lit_plan",
            sessionID: context.sessionID,
            agent: context.agent
          });
          return {
            title: "LitOpenCode start-work blocked in lit-plan",
            output: litPlanStartWorkBlocker,
            metadata: {
              command: "start-work",
              action,
              blocked: true,
              requiredAgent: "lit-implement"
            }
          };
        }
        await operations.append({
          type: "tool.start-work.started",
          sessionID: context.sessionID,
          ...(context.agent === undefined ? {} : { agent: context.agent })
        });
        return {
          title: "LitOpenCode start-work started",
          output: startWorkPromptInjection,
          metadata: {
            command: "start-work",
            action
          }
        };
      }
      case "status": {
        const lenient = await operations.readLenient();
        let lifecycle;
        const projectRoot = projectRootFromContext(context);
        try {
          await fs.access(createRuntimePaths(projectRoot).lifecycleStateFile);
          lifecycle = await createBoundedAuthorityLifecycle(projectRoot).read();
        } catch (error) {
          const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
          if (!missing && !(error instanceof LifecycleConflictError)) throw error;
        }
        const lifecycleLine = lifecycle === undefined
          ? "schema 3 bounded-authority: no work initialized"
          : `schema 3 bounded-authority: ${lifecycle.status}; revision ${lifecycle.revision}; work ${lifecycle.workId}`;
        return {
          title: "LitOpenCode start-work status",
          output: `${lifecycleLine}\n${summarizeEventTypes(lenient.events)}${formatLenientDiagnostic(lenient)}`,
          metadata: {
            command: "start-work",
            action,
            eventCount: lenient.events.length,
            lifecycleSchemaVersion: 3,
            ...(lenient.skipped.length > 0 ? { skippedCount: lenient.skipped.length } : {}),
            ...(lifecycle === undefined ? {} : {
              lifecycleStatus: lifecycle.status,
              lifecycleRevision: lifecycle.revision,
              lifecycleWorkId: lifecycle.workId
            })
          }
        };
      }
      default:
        return assertNever(action);
    }
  }
}) as unknown as ToolDefinition;

export const reviewWorkTool = tool({
  description: "Start read-only review-work only when the user explicitly requests an independent plan or work review; run relevant checks directly for bounded tasks.",
  args: {
    action: actionSchema("LitOpenCode review-work action. Supported values: review, status.")
  },
  async execute(args, context): Promise<ToolResult> {
    const denied = deniedToolResultFromArgs(args, "review-work", reviewWorkActions);
    if (denied !== undefined) return denied;
    const action = actionFromArgs(args, reviewWorkActions, "review");
    const operations = createLitGoalOperations(projectRootFromContext(context));

    switch (action) {
      case "review": {
        await operations.init();
        await operations.append({
          type: "tool.review-work.started",
          sessionID: context.sessionID,
          ...(context.agent === undefined ? {} : { agent: context.agent })
        });
        return {
          title: "LitOpenCode review-work started",
          output: `${activationBanner("review-work")}
${activationProbeInstruction("review-work")}

review-work is active. For a draft plan, audit objective achievability and return PASS, ITERATE, or NEEDS-CONTEXT without implementation. For completed work, run the five-lane evidence review before claiming completion.`,
          metadata: {
            command: "review-work",
            action
          }
        };
      }
      case "status": {
        const lenient = await operations.readLenient();
        return {
          title: "LitOpenCode review-work status",
          output: `${summarizeEventTypes(lenient.events)}${formatLenientDiagnostic(lenient)}`,
          metadata: {
            command: "review-work",
            action,
            eventCount: lenient.events.length,
            ...(lenient.skipped.length > 0 ? { skippedCount: lenient.skipped.length } : {})
          }
        };
      }
      default:
        return assertNever(action);
    }
  }
}) as unknown as ToolDefinition;

export const wikifyTool = tool({
  description: "Capture, review, query, or inspect bounded project-local Wikify knowledge.",
  args: {
    action: actionSchema("Wikify action. Supported values: capture, save, review, query, status."),
    id: actionSchema("Stable knowledge record id for save or review."),
    kind: actionSchema("Structured event kind: fact, decision, failure, risk, rule, or checkpoint."),
    text: actionSchema("Concise structured event text. Raw chat and source bodies are not accepted."),
    evidenceRef: actionSchema("Bounded project-local evidence reference."),
    source: actionSchema("Bounded product-local structured event source."),
    state: actionSchema("Review state: accepted, rejected, or stale."),
    query: actionSchema("Local deterministic relevance query."),
    budgetBytes: actionSchema("Optional output budget in bytes. The hard limit is 4096.")
  },
  async execute(args, context): Promise<ToolResult> {
    const denied = deniedToolResultFromArgs(args, "wikify", wikifyActions);
    if (denied !== undefined) return denied;
    const action = actionFromArgs(args, wikifyActions, "status");
    const projectRoot = projectRootFromContext(context);

    if (action === "capture") {
      let result: Awaited<ReturnType<typeof captureKnowledgeEvent>>;
      try {
        const loaded = await loadConfig(projectRoot);
        result = await captureKnowledgeEvent(projectRoot, {
          kind: args.kind,
          text: args.text,
          evidenceRef: args.evidenceRef,
          source: args.source
        }, { surface: "tool.wikify", captureEnabled: loaded.config.knowledge.capture });
      } catch {
        return blockedWikifyStoreResult(action);
      }
      if (result.status === "disabled") {
        return {
          title: "Wikify knowledge capture disabled",
          output: "Wikify knowledge capture is disabled by .litopencode/config.json.",
          metadata: { command: "wikify", action, disabled: true }
        };
      }
      if (result.status === "rejected") {
        return {
          title: "Wikify knowledge capture blocked",
          output: `BLOCKED: structured knowledge event rejected (${result.reason}).`,
          metadata: { command: "wikify", action, blocked: true, reason: result.reason }
        };
      }
      return {
        title: result.status === "captured" ? "Wikify knowledge captured for review" : "Wikify knowledge capture already recorded",
        output: `${result.record.id}: ${result.record.state}. Use an explicit save or review operation to change its state.`,
        metadata: { command: "wikify", action, status: result.status, id: result.record.id, state: result.record.state }
      };
    }

    if (action === "save" || action === "review") {
      const state = action === "save" ? "accepted" : args.state;
      if (typeof args.id !== "string" || typeof state !== "string" || !["accepted", "rejected", "stale"].includes(state)) {
        return {
          title: "Wikify knowledge review blocked",
          output: "BLOCKED: save needs a stable id; review also needs accepted, rejected, or stale state.",
          metadata: { command: "wikify", action, blocked: true, reason: "INVALID_REVIEW_INPUT" }
        };
      }
      let result: Awaited<ReturnType<typeof reviewKnowledgeRecord>>;
      try {
        result = await reviewKnowledgeRecord(projectRoot, {
          id: args.id,
          state: state as Exclude<KnowledgeState, "review-needed">,
          surface: action === "save" ? "tool.wikify.save" : "tool.wikify.review"
        });
      } catch {
        return blockedWikifyStoreResult(action);
      }
      if (result.status === "blocked") {
        return {
          title: "Wikify knowledge review blocked",
          output: `BLOCKED: knowledge state did not change (${result.reason}).`,
          metadata: { command: "wikify", action, blocked: true, reason: result.reason }
        };
      }
      return {
        title: "Wikify knowledge state recorded",
        output: `${result.record.id}: ${result.record.state}.`,
        metadata: { command: "wikify", action, status: result.status, id: result.record.id, state: result.record.state }
      };
    }

    if (action === "query") {
      const budget = typeof args.budgetBytes === "string" ? Number(args.budgetBytes) : undefined;
      let result: Awaited<ReturnType<typeof queryKnowledge>>;
      try {
        result = await queryKnowledge(projectRoot, typeof args.query === "string" ? args.query : "", { budgetBytes: budget });
      } catch {
        return blockedWikifyStoreResult(action);
      }
      return {
        title: "Wikify knowledge query",
        output: result.text,
        metadata: { command: "wikify", action, matchCount: result.records.length, byteLength: result.byteLength, budgetBytes: result.budgetBytes }
      };
    }

    let status: Awaited<ReturnType<typeof inspectKnowledge>>;
    try {
      status = await inspectKnowledge(projectRoot);
    } catch {
      return blockedWikifyStoreResult(action);
    }
    return {
      title: "Wikify knowledge status",
      output: `authority: ${status.path}\nreview-needed: ${status.counts["review-needed"]}\naccepted: ${status.counts.accepted}\nrejected: ${status.counts.rejected}\nstale: ${status.counts.stale}`,
      metadata: { command: "wikify", action, authority: status.authority, counts: status.counts }
    };
  }
}) as unknown as ToolDefinition;

export const litOpenCodeTools = Object.freeze({
  lit: litTool,
  litwork: litworkTool,
  "start-work": startWorkTool,
  "review-work": reviewWorkTool,
  wikify: wikifyTool
});
