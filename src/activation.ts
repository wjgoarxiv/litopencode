import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import type { TuiShowToastData } from "@opencode-ai/sdk";
import { litOpenCodeAgents } from "./agents.ts";
import {
  detectChatActivationMode,
  endsWithStandaloneLitInvocation,
  unwrapOpenCodeRunMessage,
  promptForChatActivationMode,
  type ChatActivationMode
} from "./activation-routing.ts";
import { createLitGoalOperations } from "./ledger.ts";
import type { SessionLookup } from "./session-lineage.ts";
import {
  applyTrustedStartWorkDirective,
  parseStartWorkLifecycleDirective
} from "./bounded-authority-hooks.ts";
import { startWorkPromptInjection } from "./activation-workflow-prompts.ts";
import type { BoundedAuthorityOptions } from "./bounded-authority.ts";
import { isReadOnlyWorkflowFamilyPlan } from "./workflow-families.ts";
import { queryKnowledge } from "./knowledge.ts";
import { activationDiscipline } from "./activation-probe.ts";
import { micro, supportsMarkGlyphs } from "./lit-mark.ts";
import { jevSkillHintAwarenessText, jevSkillHintToastText, type JevSkillHintPart } from "./jev-skill-hint.ts";

// Prompt modules preserve minimum-first, single-task or few-task planning, avoidable custom code review,
// and external-source safety; this module only coordinates their unchanged activation surfaces.
export {
  litHandoffPromptInjection,
  scientificVisualizationPromptInjection
} from "./activation-managed-prompts.ts";
export { litActivationBanner } from "./activation-prompt-utils.ts";
export { litLoopPromptInjection, litPlanPromptInjection } from "./activation-primary-prompts.ts";
export {
  containsStandaloneLitTrigger,
  detectChatActivationMode
} from "./activation-routing.ts";
export {
  comprehendPromptInjection,
  debuggingPromptInjection,
  deepInterviewPromptInjection,
  gitMasterPromptInjection,
  litCruciblePromptInjection,
  initDeepPromptInjection,
  litGoalPromptInjection,
  litRecapPromptInjection,
  litResearchPromptInjection,
  lspPromptInjection,
  lspSetupPromptInjection,
  litCodePromptInjection,
  refactorPromptInjection,
  removeAiSlopsPromptInjection,
  browserDrivePromptInjection,
  structuralSearchPromptInjection,
  rulesPromptInjection,
  reviewWorkPromptInjection,
  startWorkChatPromptInjection,
  startWorkPromptInjection,
  litBurnoffFilePromptInjection,
  litFetchPromptInjection,
  litHumanizerPromptInjection
} from "./activation-workflow-prompts.ts";

type ChatMessageHook = NonNullable<Hooks["chat.message"]>;
type ActivationToastClient = Pick<PluginInput["client"], "tui">;

export function showActivationToast(
  client: ActivationToastClient | undefined,
  skillId: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  const label = `🔥 LIT IGNITED · ${activationDiscipline(skillId)} 🔥`;
  const message = supportsMarkGlyphs(env)
    ? [...micro.map((row) => row.replace(/ +$/u, "")), label].join("\n")
    : label;
  const body: NonNullable<TuiShowToastData["body"]> = {
    title: "🔥 LIT IGNITED",
    message,
    variant: "warning",
    duration: 6000
  };

  try {
    const pending = client?.tui?.showToast({ body });
    void pending?.catch(() => undefined);
  } catch { // no-excuse-ok: catch -- a missing or failing TUI must never block prompt activation.
    // The activation prompt is the primary surface; this toast is best-effort UI feedback.
  }
}

/**
 * One quiet `info` toast per hinted turn; notes, `none` and silent turns never reach it. On the first
 * eligible turn of a session (`announce`) the standout ON notice goes out instead, with that turn's hint
 * as its body: the TUI keeps a single toast, so a second one would replace the notice at once.
 */
export function showJevSkillHintToast(
  client: ActivationToastClient | undefined,
  hint: JevSkillHintPart | undefined,
  announce = false
): void {
  const hinted = hint?.kind === "hint" ? jevSkillHintToastText(hint.skillId, hint.latencyMs) : undefined;
  let body: NonNullable<TuiShowToastData["body"]>;
  if (announce) {
    body = hinted === undefined
      ? { message: jevSkillHintAwarenessText, variant: "warning" }
      : { title: jevSkillHintAwarenessText, message: hinted, variant: "warning" };
  } else if (hinted !== undefined) {
    body = { message: hinted, variant: "info" };
  } else {
    return;
  }
  try {
    const pending = client?.tui?.showToast({ body });
    void pending?.catch(() => undefined);
  } catch { // no-excuse-ok: catch -- a missing or failing TUI must never block the user message.
  }
}

const knownSubagentAgentNames = new Set<string>([
  ...litOpenCodeAgents.filter((agent) => agent.mode !== "primary").map((agent) => agent.id),
  "build",
  "plan",
  "general",
  "explore"
]);

export type ChatMessageActivationOptions = {
  readonly getSession?: SessionLookup;
  readonly hostArgv?: readonly string[];
  readonly boundedAuthority?: BoundedAuthorityOptions;
  readonly knowledgeCaptureEnabled?: boolean;
  readonly onScientificVisualizationActivation?: (sessionID: string) => void;
  readonly onRootUserTurn?: (sessionID: string) => void | Promise<void>;
  readonly onSkillActivation?: (sessionID: string, skillId: string, appendedLit?: boolean) => void | Promise<void>;
  /** Consumes the skill a trusted command activation recorded for this session, if any. */
  readonly trustedInjectedSkill?: (sessionID: string) => string | undefined;
  /** Restores that skill after the root-turn reset; the command already showed its activation toast. */
  readonly onTrustedSkillResume?: (sessionID: string, skillId: string) => void | Promise<void>;
  /** Consumes the mark `command.execute.before` left for this session's next message. */
  readonly isCommandTurn?: (sessionID: string) => boolean;
  readonly skillHint?: (sessionID: string, promptText: string) => Promise<JevSkillHintPart | undefined>;
};

// Activation belongs to root user sessions only: a delegated child prompt that
// happens to contain a trigger word must never re-enter a lit workflow, or
// every subagent re-runs the full fan-out instructions recursively.
async function isChildSessionMessage(
  sessionID: string,
  agent: string | undefined,
  getSession: SessionLookup | undefined
): Promise<boolean> {
  if (getSession !== undefined) {
    try {
      const session = await getSession(sessionID);
      return session === undefined || session.parentID !== undefined;
    } catch {
      return true;
    }
  }
  return agent !== undefined && knownSubagentAgentNames.has(agent);
}

export function createChatMessageActivationHook(
  projectRoot: string,
  options: ChatMessageActivationOptions = {}
): ChatMessageHook {
  const operations = createLitGoalOperations(projectRoot);
  const processedOutputs = new WeakSet<object>();

  return async (input, output) => {
    // Object identity is internal to this hook instance; unlike part metadata,
    // it cannot be forged by a user-authored message to preserve stale state.
    if (processedOutputs.has(output)) return;
    processedOutputs.add(output);
    // Command marks are keyed by session and consumed here, on every turn: the host hands this hook a
    // new parts array, so the array `command.execute.before` saw can never be matched by identity.
    const commandTurn = options.isCommandTurn?.(input.sessionID) === true;
    const trustedInjectedSkill = options.trustedInjectedSkill?.(input.sessionID);
    const agent = input.agent ?? (typeof output.message.agent === "string" ? output.message.agent : undefined);
    const childSession = await isChildSessionMessage(input.sessionID, agent, options.getSession);
    if (!childSession) {
      await options.onRootUserTurn?.(input.sessionID);
      if (trustedInjectedSkill !== undefined) {
        await options.onTrustedSkillResume?.(input.sessionID, trustedInjectedSkill);
        return;
      }
    }
    const nonEmptyTextParts = output.parts.filter(
      (part): part is typeof part & { readonly type: "text"; readonly text: string } =>
        part.type === "text" && part.text.trim().length > 0
    ).map((part) => ({ ...part, text: unwrapOpenCodeRunMessage(part.text, options.hostArgv ?? process.argv) }));
    const exactBareMode =
      output.parts.every((part) => part.type === "text") &&
      nonEmptyTextParts.length === 1 &&
      detectChatActivationMode(nonEmptyTextParts[0].text, agent);
    const mode = exactBareMode === "lit-handoff" || exactBareMode === "lit-scientific-visualization"
      ? exactBareMode
      : output.parts.reduce<ChatActivationMode | undefined>((detected, part) => {
          if (detected !== undefined || part.type !== "text") return detected;
          const candidate = detectChatActivationMode(unwrapOpenCodeRunMessage(part.text, options.hostArgv ?? process.argv), agent);
          return candidate === "lit-handoff" || candidate === "lit-scientific-visualization" ? undefined : candidate;
        }, undefined);
    if (!childSession && !hasKnowledgeInjection(output.parts)) {
      const query = nonEmptyTextParts.map((part) => part.text).join(" ").slice(0, 4096);
      try {
        const knowledge = await queryKnowledge(projectRoot, query);
        if (knowledge.text !== "") {
          output.parts.push({
            id: `prt_litopencode_knowledge_${idSuffix(input.messageID ?? output.message.id)}`,
            sessionID: input.sessionID,
            messageID: input.messageID ?? output.message.id,
            type: "text",
            text: knowledge.text,
            metadata: {
              litopencodeKnowledge: {
                source: "chat.message",
                matchCount: knowledge.records.length,
                byteLength: knowledge.byteLength
              }
            }
          });
        }
      } catch { // no-excuse-ok: catch -- local relevance must never block the user message.
        // A malformed or unreadable knowledge store stays silent instead of inventing context.
      }
    }
    // The optional skill hint only speaks on root turns that no command or deterministic route claimed.
    if (!childSession && mode === undefined && options.skillHint !== undefined && !commandTurn) {
      const promptText = nonEmptyTextParts
        .filter((part) => (part as { readonly synthetic?: boolean }).synthetic !== true)
        .map((part) => part.text)
        .join("\n");
      try {
        const hint = await options.skillHint(input.sessionID, promptText);
        if (hint !== undefined) {
          output.parts.push({
            id: `prt_litopencode_skill_hint_${idSuffix(input.messageID ?? output.message.id)}`,
            sessionID: input.sessionID,
            messageID: input.messageID ?? output.message.id,
            type: "text",
            text: hint.text,
            // Sent to the model like any text part, but not shown or copied as the user's own words.
            synthetic: true,
            metadata: { litopencodeSkillHint: { kind: hint.kind, source: "chat.message" } }
          });
        }
      } catch { // no-excuse-ok: catch -- the optional hint must never block the user message.
      }
    }
    if (mode === undefined || childSession) return;

    const trigger = mode === "lit-handoff" ? "handoff" : mode === "lit-scientific-visualization" ? mode : "lit";

    let activationText = promptForChatActivationMode(mode, nonEmptyTextParts.find((part) => detectChatActivationMode(part.text, agent) === mode)?.text);
    if (mode === "start-work" && agent !== "lit-plan" && nonEmptyTextParts.length === 1) {
      const directive = parseStartWorkLifecycleDirective(nonEmptyTextParts[0].text, { chat: true });
      if (directive?.action === "resume") {
        try {
          const receipt = await applyTrustedStartWorkDirective(
            projectRoot,
            input.sessionID,
            directive,
            options.boundedAuthority
          );
          activationText = `${receipt.text}\n${startWorkPromptInjection}`;
        } catch {
          activationText = "BLOCKED: bounded-authority lifecycle resume rejected. Use /start-work with the exact pending boundary, grant, work id, session, and CAS revision.";
        }
      }
    }

    output.parts.push({
      id: `prt_litopencode_${mode.replace("-", "_")}_${idSuffix(input.messageID ?? output.message.id)}`,
      sessionID: input.sessionID,
      messageID: input.messageID ?? output.message.id,
      type: "text",
      text: activationText,
      metadata: {
        litopencode: {
          mode,
          trigger,
          source: "chat.message"
        }
      }
    });

    await options.onSkillActivation?.(
      input.sessionID, mode,
      nonEmptyTextParts.some((part) => endsWithStandaloneLitInvocation(part.text))
    );

    if (mode === "lit-scientific-visualization") {
      options.onScientificVisualizationActivation?.(input.sessionID);
    }

    if (mode === "lit-task" || mode === "lit-recap" || isReadOnlyWorkflowFamilyPlan(mode)) return;

    try {
      await operations.init();
      await operations.append({
        type: "prompt.activated",
        trigger,
        source: "chat.message",
        mode,
        sessionID: input.sessionID,
        messageID: input.messageID ?? output.message.id,
        ...(agent === undefined ? {} : { agent }),
        timestamp: new Date().toISOString()
      });
    } catch { // no-excuse-ok: catch -- activation must survive best-effort ledger failure.
      // Prompt injection is the primary activation surface; ledger writes are best-effort.
    }
  };
}

function idSuffix(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function hasKnowledgeInjection(
  parts: readonly {
    readonly type: string;
    readonly metadata?: { readonly [key: string]: unknown };
  }[]
): boolean {
  return parts.some((part) => part.metadata?.litopencodeKnowledge !== undefined);
}
