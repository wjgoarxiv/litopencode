import { activationBanner } from "./activation-probe.ts";
import { renamedSkillId, skillRenameNote } from "./skill-renames.ts";
import type { Hooks } from "@opencode-ai/plugin";
import {
  comprehendPromptInjection,
  debuggingPromptInjection,
  deepInterviewPromptInjection,
  gitMasterPromptInjection,
  lspPromptInjection,
  lspSetupPromptInjection,
  rulesPromptInjection,
  browserDrivePromptInjection,
  structuralSearchPromptInjection,
  litGoalPromptInjection,
  litCruciblePromptInjection,
  initDeepPromptInjection,
  litLoopPromptInjection,
  litPlanPromptInjection,
  litRecapPromptInjection,
  litHandoffPromptInjection,
  litResearchPromptInjection,
  litCodePromptInjection,
  refactorPromptInjection,
  removeAiSlopsPromptInjection,
  reviewWorkPromptInjection,
  scientificVisualizationPromptInjection,
  startWorkPromptInjection,
  litBurnoffFilePromptInjection,
  litFetchPromptInjection,
  litHumanizerPromptInjection
} from "./activation.ts";
import { createLitGoalOperations } from "./ledger.ts";
import { commandAliasOwnership } from "./cli/command-alias-ownership.ts";
import {
  applyTrustedStartWorkDirective,
  parseStartWorkLifecycleDirective
} from "./bounded-authority-hooks.ts";
import type { BoundedAuthorityOptions } from "./bounded-authority.ts";
import {
  formatResolvedPlanNotice,
  formatSavedPlanNotice,
  parsePlanSaveArgument,
  persistApprovedPlan,
  resolveLatestDurablePlan
} from "./durable-plan.ts";
import { isWorkflowFamilyMode, workflowFamilyCommandDefinitions } from "./workflow-families.ts";
import {
  captureKnowledgeEvent,
  inspectKnowledge,
  queryKnowledge,
  recoverKnowledge,
  reviewKnowledgeRecord
} from "./knowledge.ts";

export type LitOpenCodeCommandId =
  | "lit"
  | "lit-loop"
  | "litwork"
  | "lit-work"
  | "start-work"
  | "review-work"
  | "lit-plan"
  | "litgoal"
  | "lit-goal"
  | "litresearch"
  | "lit-research"
  | "lit-init"
  | "lit-crucible"
  | "lit-burnoff-file"
  | "lit-fetch"
  | "refactor"
  | "lit-burnoff"
  | "lit-code"
  | "debugging"
  | "lit-commit"
  | "lsp"
  | "lsp-setup"
  | "rules"
  | "deep-interview"
  | "structural-search"
  | "browser-drive"
  | "lit-recap"
  | "lit-comprehend"
  | "lit-handoff"
  | "lit-scientific-visualization"
  | "lit-humanizer"
  | "autoresearch"
  | "autoresearch-debug"
  | "autoresearch-fix"
  | "autoresearch-learn"
  | "autoresearch-plan"
  | "autoresearch-predict"
  | "autoresearch-reason"
  | "autoresearch-scenario"
  | "autoresearch-security"
  | "autoresearch-ship"
  | "autoconference"
  | "autoconference-analyze"
  | "autoconference-debate"
  | "autoconference-plan"
  | "autoconference-resume"
  | "autoconference-ship"
  | "autoconference-survey"
  | "wikify-init"
  | "wikify-ingest"
  | "wikify-query"
  | "wikify-save"
  | "wikify-lint";

export type LitOpenCodeCommand = {
  readonly id: LitOpenCodeCommandId;
  readonly slash: string;
  readonly title: string;
  readonly description: string;
  readonly banner: string;
  readonly activationText: string;
  readonly agent?: string;
  readonly readOnly?: boolean;
};

type CommandExecuteBeforeHook = NonNullable<Hooks["command.execute.before"]>;

type CommandArgumentSummary = {
  readonly present: boolean;
  readonly redacted: boolean;
  readonly length: number;
};

export type CommandActivationOptions = {
  readonly commandAliasRoot?: string;
  readonly boundedAuthority?: BoundedAuthorityOptions;
  readonly knowledgeCaptureEnabled?: boolean;
  readonly onScientificVisualizationActivation?: (sessionID: string) => void;
  readonly onSkillActivation?: (sessionID: string, skillId: string) => void | Promise<void>;
};

export { litActivationBanner, startWorkPromptInjection } from "./activation.ts";

export const litOpenCodeCommands = Object.freeze([
  ...workflowFamilyCommandDefinitions,
  {
    id: "lit-burnoff-file",
    slash: "/lit-burnoff-file",
    title: "LitOpenCode Lit Burnoff File",
    description: "Clean the single named file against its current diff while preserving behavior.",
    banner: activationBanner("lit-burnoff-file"),
    activationText: litBurnoffFilePromptInjection
  },
  {
    id: "lit-fetch",
    slash: "/lit-fetch",
    title: "LitOpenCode Lit Fetch",
    description: "Retrieve public sources through the guarded fetch runtime with evidence and access verdicts.",
    banner: activationBanner("lit-fetch"),
    activationText: litFetchPromptInjection
  },
  {
    id: "lit",
    slash: "/lit",
    title: "LitOpenCode",
    description: "Activate the LitOpenCode model probe line and durable goal loop.",
    banner: activationBanner("lit"),
    activationText: litLoopPromptInjection
  },
  {
    id: "lit-loop",
    slash: "/lit-loop",
    title: "LitOpenCode Lit Loop",
    description: "Activate the full LitOpenCode durable lit-loop prompt.",
    banner: activationBanner("lit-loop"),
    activationText: litLoopPromptInjection
  },
  {
    id: "litwork",
    slash: "/litwork",
    title: "LitOpenCode Work Loop",
    description: "Resume a LitOpenCode work loop with durable ledger-backed progress.",
    banner: activationBanner("litwork"),
    activationText: litLoopPromptInjection
  },
  {
    id: "lit-work",
    slash: "/lit-work",
    title: "LitOpenCode Work Loop",
    description: "Hyphenated alias for /litwork.",
    banner: activationBanner("lit-work"),
    activationText: litLoopPromptInjection
  },
  {
    id: "start-work",
    slash: "/start-work",
    title: "LitOpenCode Start Work",
    description: "Start or resume a plan-backed implementation loop with evidence checkpoints.",
    banner: activationBanner("start-work"),
    activationText: startWorkPromptInjection,
    agent: "lit-implement"
  },
  {
    id: "review-work",
    slash: "/review-work",
    title: "LitOpenCode Review Work",
    description: "Review a draft plan for objective achievability or completed work across five evidence lanes.",
    banner: activationBanner("review-work"),
    activationText: reviewWorkPromptInjection
  },
  {
    id: "lit-plan",
    slash: "/lit-plan",
    title: "LitOpenCode Plan",
    description: "Create a proportionate objective-achievable checklist before confirmed execution.",
    banner: activationBanner("lit-plan"),
    activationText: litPlanPromptInjection
  },
  {
    id: "litgoal",
    slash: "/litgoal",
    title: "LitOpenCode Goal",
    description: "Bind a durable LitOpenCode goal before execution.",
    banner: activationBanner("litgoal"),
    activationText: litGoalPromptInjection
  },
  {
    id: "lit-goal",
    slash: "/lit-goal",
    title: "LitOpenCode Goal",
    description: "Hyphenated alias for /litgoal.",
    banner: activationBanner("lit-goal"),
    activationText: litGoalPromptInjection
  },
  {
    id: "litresearch",
    slash: "/litresearch",
    title: "LitOpenCode Research",
    description: "Run a LitOpenCode research loop with evidence-backed findings.",
    banner: activationBanner("litresearch"),
    activationText: litResearchPromptInjection,
    agent: "lit-loop"
  },
  {
    id: "lit-research",
    slash: "/lit-research",
    title: "LitOpenCode Research",
    description: "Hyphenated alias for /litresearch.",
    banner: activationBanner("lit-research"),
    activationText: litResearchPromptInjection,
    agent: "lit-loop"
  },
  {
    id: "lit-init",
    slash: "/lit-init",
    title: "LitOpenCode Lit Init",
    description: "Create or refresh a sparse AGENTS.md knowledge hierarchy with evidence-backed directory guidance.",
    banner: activationBanner("lit-init"),
    activationText: initDeepPromptInjection
  },
  {
    id: "lit-crucible",
    slash: "/lit-crucible",
    title: "LitOpenCode Lit Crucible",
    description: "Run planning-only adversarial planning before implementation and hand surviving insights to lit-plan.",
    banner: activationBanner("lit-crucible"),
    activationText: litCruciblePromptInjection,
    agent: "lit-plan"
  },
  {
    id: "refactor",
    slash: "/refactor",
    title: "LitOpenCode Refactor",
    description: "Restructure code without changing behavior, pinned by before/after evidence and a named rollback boundary.",
    banner: activationBanner("refactor"),
    activationText: refactorPromptInjection
  },
  {
    id: "lit-burnoff",
    slash: "/lit-burnoff",
    title: "LitOpenCode Lit Burnoff",
    description: "Remove machine-written artifacts from text or code while preserving facts, APIs, tests, and accessibility behavior.",
    banner: activationBanner("lit-burnoff"),
    activationText: removeAiSlopsPromptInjection
  },
  {
    id: "lit-code",
    slash: "/lit-code",
    title: "LitOpenCode Lit Code",
    description: "Apply minimum-first implementation discipline with paired verification and a cleanup receipt.",
    banner: activationBanner("lit-code"),
    activationText: litCodePromptInjection
  },
  {
    id: "debugging",
    slash: "/debugging",
    title: "LitOpenCode Debugging",
    description: "Reproduce the failure, prove the mechanism, and only then write the fix with before/after evidence.",
    banner: activationBanner("debugging"),
    activationText: debuggingPromptInjection
  },
  {
    id: "lit-commit",
    slash: "/lit-commit",
    title: "LitOpenCode Lit Commit",
    description: "Inspect git state before mutating it and keep commit, push, tag, reset, and history rewrites behind explicit authorization.",
    banner: activationBanner("lit-commit"),
    activationText: gitMasterPromptInjection
  },
  {
    id: "lsp",
    slash: "/lsp",
    title: "LitOpenCode LSP",
    description: "Use the host language server for diagnostics, definitions, references, and rename blast radius; this package bundles none.",
    banner: activationBanner("lsp"),
    activationText: lspPromptInjection
  },
  {
    id: "lsp-setup",
    slash: "/lsp-setup",
    title: "LitOpenCode LSP Setup",
    description: "Handle the file type with no configured language server: name the gap, offer the config, and fall back to real compiler or test evidence.",
    banner: activationBanner("lsp-setup"),
    activationText: lspSetupPromptInjection
  },
  {
    id: "rules",
    slash: "/rules",
    title: "LitOpenCode Rules",
    description: "Inspect the shipped two-lane repository rules engine, apply its scoped guidance, and report which rules actually applied.",
    banner: activationBanner("rules"),
    activationText: rulesPromptInjection
  },
  {
    id: "deep-interview",
    slash: "/deep-interview",
    title: "LitOpenCode Deep Interview",
    description: "Turn a broad or underspecified request into a decision-complete brief before lit-plan starts.",
    banner: activationBanner("deep-interview"),
    activationText: deepInterviewPromptInjection,
    agent: "lit-plan"
  },
  {
    id: "browser-drive",
    slash: "/browser-drive",
    title: "LitOpenCode Browser Drive",
    description: "Drive a real page through an external driver behind a verified identity probe, three named blockers, and a snapshot-then-act loop.",
    banner: activationBanner("browser-drive"),
    activationText: browserDrivePromptInjection
  },
  {
    id: "structural-search",
    slash: "/structural-search",
    title: "LitOpenCode Structural Search",
    description: "Search or rewrite source by syntax shape behind a verified engine probe, a labeled textual fallback, and a bounded rewrite boundary.",
    banner: activationBanner("structural-search"),
    activationText: structuralSearchPromptInjection
  },
  {
    id: "lit-recap",
    slash: "/lit-recap",
    title: "LitOpenCode Recap",
    description: "Read-only Korean work recap from durable ledger and session context (--brief, --en supported).",
    banner: activationBanner("lit-recap"),
    activationText: litRecapPromptInjection,
    readOnly: true
  },
  {
    id: "lit-comprehend",
    slash: "/lit-comprehend",
    title: "LitOpenCode Comprehend",
    description: "Build a self-contained explainer artifact so the user can reason about work that was already done.",
    banner: activationBanner("lit-comprehend"),
    activationText: comprehendPromptInjection
  },
  {
    id: "lit-handoff",
    slash: "/lit-handoff",
    title: "LitOpenCode Handoff",
    description: "Create or update a resumable project handoff from the complete embedded contract and live evidence.",
    banner: activationBanner("lit-handoff"),
    activationText: litHandoffPromptInjection
  },
  {
    id: "lit-scientific-visualization",
    slash: "/lit-scientific-visualization",
    title: "LitOpenCode Scientific Visualization",
    description: "Create publication-ready figures from the complete embedded scientific-visualization corpus.",
    banner: activationBanner("lit-scientific-visualization"),
    activationText: scientificVisualizationPromptInjection
  },
  {
    id: "lit-humanizer",
    slash: "/lit-humanizer",
    title: "LitOpenCode Lit Humanizer",
    description: "Revise reader-facing prose across languages and formats while preserving meaning, evidence, citations, useful qualifiers, and author voice.",
    banner: activationBanner("lit-humanizer"),
    activationText: litHumanizerPromptInjection
  }
] satisfies readonly LitOpenCodeCommand[]);

export function findLitOpenCodeCommand(input: string): LitOpenCodeCommand | undefined {
  const normalized = input.trim().replace(/^\//, "").toLowerCase();
  const renamed = renamedSkillId(normalized);
  const command = litOpenCodeCommands.find((candidate) => candidate.id === (renamed ?? normalized));
  return command === undefined || renamed === undefined
    ? command
    : { ...command, activationText: `${skillRenameNote(renamed, normalized)}\n${command.activationText}` };
}

function summarizeCommandArguments(value: unknown): CommandArgumentSummary {
  if (typeof value !== "string" || value.length === 0) {
    return { present: false, redacted: false, length: 0 };
  }
  return { present: true, redacted: true, length: value.length };
}

function commandMode(command: LitOpenCodeCommand): string {
  if (isWorkflowFamilyMode(command.id)) return command.id;
  if (command.id === "lit-plan") return "lit-plan";
  if (command.id === "start-work") return "start-work";
  if (command.id === "lit-recap") return "lit-recap";
  if (command.id === "lit-comprehend") return "lit-comprehend";
  if (command.id === "lit-handoff") return "lit-handoff";
  if (command.id === "lit-scientific-visualization") return "lit-scientific-visualization";
  if (command.id === "lit-burnoff-file" || command.id === "lit-fetch" || command.id === "lit-humanizer") return command.id;
  if (command.id === "lit-init") return "lit-init";
  if (command.id === "lit-crucible") return "lit-crucible";
  if (command.id === "refactor") return "refactor";
  if (command.id === "lit-burnoff") return "lit-burnoff";
  if (command.id === "lit-code") return "lit-code";
  if (command.id === "debugging") return "debugging";
  if (command.id === "lit-commit") return "lit-commit";
  if (command.id === "lsp") return "lsp";
  if (command.id === "lsp-setup") return "lsp-setup";
  if (command.id === "rules") return "rules";
  if (command.id === "deep-interview") return "deep-interview";
  if (command.id === "structural-search") return "structural-search";
  if (command.id === "browser-drive") return "browser-drive";
  if (command.id === "litresearch" || command.id === "lit-research") return "lit-research";
  return "lit-loop";
}

async function applyWikifyKnowledgeCommand(
  projectRoot: string,
  input: Parameters<CommandExecuteBeforeHook>[0],
  output: Parameters<CommandExecuteBeforeHook>[1],
  command: LitOpenCodeCommand,
  captureEnabled: boolean | undefined
): Promise<void> {
  if (!command.id.startsWith("wikify-")) return;
  const mode = command.id.slice("wikify-".length);
  let text: string;
  let receipt: Record<string, unknown>;
  try {
    if (mode === "init") {
      const status = await inspectKnowledge(projectRoot);
      text = `Wikify knowledge authority: ${status.path}. claims: ${Object.values(status.counts).reduce((sum, count) => sum + count, 0)}.`;
      receipt = { action: mode, status: "ready", authority: status.authority };
    } else if (mode === "ingest") {
      let event: unknown;
      try {
        event = JSON.parse(input.arguments);
      } catch {
        event = undefined;
      }
      const result = await captureKnowledgeEvent(projectRoot, event, {
        surface: "command.execute.before",
        captureEnabled
      });
      if (result.status === "disabled") {
        text = "Wikify knowledge capture is disabled by .litopencode/config.json.";
        receipt = { action: mode, status: result.status, disabled: true };
      } else if (result.status === "rejected") {
        text = `BLOCKED: structured Wikify event rejected (${result.reason}).`;
        receipt = { action: mode, status: result.status, blocked: true, reason: result.reason };
      } else {
        text = `${result.record.id}: ${result.record.state}. Explicit save or review is required for acceptance.`;
        receipt = { action: mode, status: result.status, id: result.record.id, state: result.record.state };
      }
    } else if (mode === "save") {
      const result = await reviewKnowledgeRecord(projectRoot, {
        id: input.arguments.trim(),
        state: "accepted",
        surface: "command.wikify.save"
      });
      if (result.status === "blocked") {
        text = `BLOCKED: knowledge save rejected (${result.reason}).`;
        receipt = { action: mode, status: result.status, blocked: true, reason: result.reason };
      } else {
        text = `${result.record.id}: accepted.`;
        receipt = { action: mode, status: result.status, id: result.record.id, state: result.record.state };
      }
    } else if (mode === "query") {
      const result = await queryKnowledge(projectRoot, input.arguments);
      text = result.text === "" ? "No accepted relevant knowledge." : result.text;
      receipt = { action: mode, status: "complete", matchCount: result.records.length, byteLength: result.byteLength };
    } else {
      const recovery = await recoverKnowledge(projectRoot);
      try {
        const status = await inspectKnowledge(projectRoot);
        text = `Wikify knowledge lint: review-needed: ${status.counts["review-needed"]}; accepted: ${status.counts.accepted}; rejected: ${status.counts.rejected}; stale: ${status.counts.stale}; snapshot recovery: ${recovery.status}.`;
        receipt = {
          action: mode,
          status: recovery.status === "recovery-required" ? "recovery-required" : "complete",
          counts: status.counts,
          recovered: recovery.recovered,
          recoveryRequired: recovery.recoveryRequired,
          removed: recovery.removed,
          preserved: recovery.preserved
        };
      } catch (error) {
        if (!recovery.recoveryRequired) throw error;
        text = `Wikify knowledge lint: recovery-required; safe stages removed: ${recovery.removed.join(", ") || "none"}; stages preserved for manual recovery: ${recovery.preserved.join(", ") || "none"}.`;
        receipt = {
          action: mode,
          status: "recovery-required",
          recoveryRequired: true,
          removed: recovery.removed,
          preserved: recovery.preserved
        };
      }
    }
  } catch {
    text = "BLOCKED: the local Wikify knowledge operation failed closed.";
    receipt = { action: mode, status: "blocked", blocked: true, reason: "STORE_ERROR" };
  }
  output.parts.push({
    id: `prt_litopencode_${command.id.replace(/-/gu, "_")}_knowledge`,
    sessionID: input.sessionID,
    messageID: `msg_litopencode_${command.id.replace(/-/gu, "_")}_knowledge`,
    type: "text",
    text,
    synthetic: true,
    metadata: { litopencodeKnowledge: receipt }
  });
}

export function createCommandActivationHook(
  projectRoot: string,
  options: CommandActivationOptions = {}
): CommandExecuteBeforeHook {
  const operations = createLitGoalOperations(projectRoot);

  return async (input, output) => {
    const command = findLitOpenCodeCommand(input.command);
    if (!command) return;
    if (
      options.commandAliasRoot !== undefined &&
      await commandAliasOwnership(options.commandAliasRoot, input.command.trim().replace(/^\//, "").toLowerCase()) === "preserved"
    ) return;

    await applyWikifyKnowledgeCommand(projectRoot, input, output, command, options.knowledgeCaptureEnabled);

    if (command.id === "start-work") {
      if (/^save-plan(?:\s|$)/u.test(input.arguments.trim())) {
        const request = parsePlanSaveArgument(input.arguments);
        if (request === undefined) {
          output.parts.push({
            id: "prt_litopencode_start_work_plan_save_blocked",
            sessionID: input.sessionID,
            messageID: "msg_litopencode_start_work_plan_save_blocked",
            type: "text",
            text: "BLOCKED: malformed or unapproved save-plan argument. Provide the approved plan as one bounded JSON argument.",
            synthetic: true,
            metadata: {
              litopencode: {
                command: command.id,
                operation: "save-plan",
                authorityGranted: false,
                blocked: true
              }
            }
          });
          return;
        }
        try {
          const saved = await persistApprovedPlan(projectRoot, request);
          const replayed = saved.replayed === true;
          output.parts.push({
            id: "prt_litopencode_start_work_plan_saved",
            sessionID: input.sessionID,
            messageID: "msg_litopencode_start_work_plan_saved",
            type: "text",
            text: formatSavedPlanNotice(saved, replayed),
            synthetic: true,
            metadata: {
              litopencode: {
                command: command.id,
                operation: "save-plan",
                authorityGranted: false,
                replayed
              }
            }
          });
        } catch {
          output.parts.push({
            id: "prt_litopencode_start_work_plan_save_blocked",
            sessionID: input.sessionID,
            messageID: "msg_litopencode_start_work_plan_save_blocked",
            type: "text",
            text: "BLOCKED: the approved plan was not saved because the request is stale, repeated with different content, or conflicts with existing state.",
            synthetic: true,
            metadata: {
              litopencode: {
                command: command.id,
                operation: "save-plan",
                authorityGranted: false,
                blocked: true
              }
            }
          });
        }
        return;
      }
      const directive = parseStartWorkLifecycleDirective(input.arguments);
      const lifecycleIntent = /^(?:resume(?:$|\s)|(?:init|cancel|complete|status)(?:$|\s+\{))/u.test(input.arguments.trim());
      if (directive === undefined && lifecycleIntent) {
        output.parts.push({
          id: "prt_litopencode_start_work_lifecycle_blocked",
          sessionID: input.sessionID,
          messageID: "msg_litopencode_start_work_lifecycle_blocked",
          type: "text",
          text: "BLOCKED: malformed schema-3 start-work lifecycle directive. Use an exact supported action and bounded JSON object.",
          synthetic: true,
          metadata: {
            litopencode: {
              command: command.id,
              mode: "bounded-authority-lifecycle",
              blocked: true
            }
          }
        });
        return;
      }
      if (directive !== undefined) {
        let lifecycleText: string;
        try {
          lifecycleText = (await applyTrustedStartWorkDirective(
            projectRoot,
            input.sessionID,
            directive,
            options.boundedAuthority
          )).text;
        } catch {
          lifecycleText = `BLOCKED: bounded-authority lifecycle ${directive.action} rejected. Check the exact work id, session, CAS revision, canonical plan/worktree, and matching boundary grant.`;
        }
        output.parts.push({
          id: `prt_litopencode_start_work_lifecycle_${directive.action}`,
          sessionID: input.sessionID,
          messageID: `msg_litopencode_start_work_lifecycle_${directive.action}`,
          type: "text",
          text: lifecycleText,
          synthetic: true,
          metadata: {
            litopencode: {
              command: command.id,
              mode: "bounded-authority-lifecycle",
              action: directive.action
            }
          }
        });
      }
    }

    if (!command.readOnly) {
      await operations.append({
        type: "command.activated",
        command: command.id,
        arguments: summarizeCommandArguments(input.arguments),
        sessionID: input.sessionID,
        timestamp: new Date().toISOString()
      });
    }

    let activationText = command.activationText;
    if (command.id === "start-work") {
      const durablePlan = await resolveLatestDurablePlan(projectRoot);
      if (durablePlan !== undefined) {
        activationText = `${command.activationText}\n\n${formatResolvedPlanNotice(durablePlan)}`;
      }
    }

    output.parts.push({
      id: `prt_litopencode_${command.id.replace(/-/g, "_")}_activation`,
      sessionID: input.sessionID,
      messageID: `msg_litopencode_${command.id.replace(/-/g, "_")}_activation`,
      type: "text",
      text: activationText,
      synthetic: true,
      metadata: {
        litopencode: {
          command: command.id,
          banner: command.banner,
          mode: commandMode(command)
        }
      }
    });

    await options.onSkillActivation?.(input.sessionID, command.id);

    if (command.id === "lit-scientific-visualization") {
      options.onScientificVisualizationActivation?.(input.sessionID);
    }
  };
}
