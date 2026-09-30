import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChatMessageActivationHook, showActivationToast, showJevSkillHintToast } from "./activation.ts";
import { registerLitOpenCodeAgents } from "./agents.ts";
import { createAutoHandoff } from "./auto-handoff-hooks.ts";
import { createBoundedAuthorityEventHook } from "./bounded-authority-hooks.ts";
import { createCommandActivationHook } from "./commands.ts";
import { loadConfig } from "./config.ts";
import { createDeliverableHedgeGuard } from "./deliverable-hedge-guard.ts";
import { createToolExecuteAfterHook, createToolExecuteBeforeHook } from "./hooks.ts";
import { createLogger } from "./logger.ts";
import { createJevSkillHint } from "./jev-skill-hint.ts";
import { createIgnitionState } from "./ignition.ts";
import { createSessionLookup } from "./session-lineage.ts";
import { applyCompactionRuleReset, applyStaticRuleInjection } from "./rules/hooks.ts";
import { defaultOpenCodeConfigRoot } from "./state.ts";
import { litOpenCodeTools } from "./tools.ts";
import { autoUpdateDiagnostic, canContinueAfterAutoUpdate, runPluginAutoUpdate } from "./cli/auto-update.ts";

function trustedCommandSkillId(part: unknown): string | undefined {
  if (typeof part !== "object" || part === null || !("metadata" in part)) return undefined;
  const metadata = part.metadata;
  if (typeof metadata !== "object" || metadata === null || !("litopencode" in metadata)) return undefined;
  const marker = metadata.litopencode;
  if (typeof marker !== "object" || marker === null || !("banner" in marker) || !("command" in marker)) return undefined;
  return typeof marker.banner === "string" && typeof marker.command === "string" ? marker.command : undefined;
}

export function resolvePluginProjectRoot(input?: Pick<PluginInput, "directory" | "worktree">): string {
  const worktree = input?.worktree?.trim();
  if (worktree !== undefined && worktree !== "" && worktree !== "/") return worktree;

  const directory = input?.directory?.trim();
  if (directory !== undefined && directory !== "") return directory;

  return ".";
}

export function createLitOpenCodePlugin(autoUpdateRunner: typeof runPluginAutoUpdate = runPluginAutoUpdate) {
  return async (input?: PluginInput): Promise<Hooks> => {
    // Await the foreground barrier before exposing hooks. A packaged plugin may
    // update its registration before the host proceeds. If the transaction
    // cannot prove rollback, fail closed instead of exposing a mixed state.
    const autoUpdateResult = await autoUpdateRunner();
    if (!canContinueAfterAutoUpdate(autoUpdateResult)) throw new Error(autoUpdateDiagnostic(autoUpdateResult));
    const root = resolvePluginProjectRoot(input);
    const loaded = await loadConfig(root);
    const logger = createLogger(loaded.paths);
    const getSession = createSessionLookup(input?.client);
    const ignitionState = createIgnitionState();
    const autoHandoff = createAutoHandoff({
      projectRoot: root,
      paths: loaded.paths,
      client: input?.client,
      config: loaded.config.autoHandoff,
      ...(getSession === undefined ? {} : { getSession })
    });
    const deliverableHedgeGuard = createDeliverableHedgeGuard({ projectRoot: root });
    const recordSkillActivation = async (sessionID: string, skillId: string, appendedLit = false): Promise<void> => {
      showActivationToast(input?.client, skillId);
      ignitionState.activate(sessionID, skillId, !appendedLit);
    };
    const boundedAuthorityEvent = createBoundedAuthorityEventHook(root, input?.client, loaded.config.boundedAuthority);
    const skillHint = createJevSkillHint({
      traceFile: path.join(loaded.paths.logsDir, "jev-skill-hint.jsonl"),
      traceRoot: loaded.paths.projectRoot
    });
    // Keyed by session: the host resolves command parts into a new array before chat.message runs.
    const pendingCommand = new Set<string>();
    const trustedCommandActivations = new Map<string, string>();
    const commandActivation = createCommandActivationHook(root, {
      commandAliasRoot: defaultOpenCodeConfigRoot(),
      boundedAuthority: loaded.config.boundedAuthority,
      knowledgeCaptureEnabled: loaded.config.knowledge.capture,
      autoHandoffRoute: autoHandoff.route,
      onSkillActivation: recordSkillActivation
    });

    const hooks: Hooks = {
      config: async (config) => {
        registerLitOpenCodeAgents(config, loaded.config);
      },
      event: async (eventInput) => {
        if (eventInput.event.type === "session.deleted") {
          ignitionState.clear(eventInput.event.properties.info.id);
          skillHint.forget(eventInput.event.properties.info.id);
          pendingCommand.delete(eventInput.event.properties.info.id);
          trustedCommandActivations.delete(eventInput.event.properties.info.id);
        }
        await boundedAuthorityEvent(eventInput);
        await autoHandoff.event(eventInput);
      },
      tool: litOpenCodeTools,
      "chat.message": createChatMessageActivationHook(root, {
        getSession,
        boundedAuthority: loaded.config.boundedAuthority,
        knowledgeCaptureEnabled: loaded.config.knowledge.capture,
        autoHandoffRoute: autoHandoff.route,
        onRootUserTurn: (sessionID) => {
          ignitionState.resetDiscipline(sessionID);
        },
        onSkillActivation: recordSkillActivation,
        isCommandTurn: (sessionID) => pendingCommand.delete(sessionID),
        skillHint: async (sessionID, promptText) => {
          const hint = await skillHint.hintFor(sessionID, promptText);
          showJevSkillHintToast(input?.client, hint, skillHint.claimAwareness(sessionID, promptText));
          return hint;
        },
        trustedInjectedSkill: (sessionID) => {
          const skillId = trustedCommandActivations.get(sessionID);
          trustedCommandActivations.delete(sessionID);
          return skillId;
        },
        onTrustedSkillResume: (sessionID, skillId) => {
          ignitionState.activate(sessionID, skillId);
        }
      }),
      "command.execute.before": async (commandInput, commandOutput) => {
        pendingCommand.add(commandInput.sessionID);
        const priorLength = commandOutput.parts.length;
        await commandActivation(commandInput, commandOutput);
        const activationPart = commandOutput.parts.slice(priorLength).reverse().find(
          (part) => trustedCommandSkillId(part) !== undefined
        );
        const skillId = trustedCommandSkillId(activationPart);
        if (skillId === undefined) trustedCommandActivations.delete(commandInput.sessionID);
        else trustedCommandActivations.set(commandInput.sessionID, skillId);
      },
      "experimental.text.complete": ignitionState.complete,
      "experimental.chat.system.transform": async (transformInput, transformOutput) => {
        await applyStaticRuleInjection({
          projectRoot: root,
          bundledRulesDir: fileURLToPath(new URL("../rules/bundled-rules", import.meta.url)),
          outputStyle: loaded.config.outputStyle
        }, transformInput, transformOutput);
        await autoHandoff.systemTransform(transformInput, transformOutput);
      },
      "experimental.session.compacting": async (compactInput, compactOutput) => {
        await applyCompactionRuleReset(compactInput, compactOutput);
      },
      dispose: async () => {
        deliverableHedgeGuard.dispose();
        ignitionState.dispose();
        await logger.dispose();
      }
    };

    Object.defineProperties(hooks, {
      "tool.execute.before": {
        value: createToolExecuteBeforeHook({ getSession, deliverableHedgeGuard }),
        enumerable: false
      },
      "tool.execute.after": {
        value: createToolExecuteAfterHook({
          projectRoot: root,
          knowledgeCaptureEnabled: loaded.config.knowledge.capture,
          deliverableHedgeGuard,
          onSkillActivation: recordSkillActivation
        }),
        enumerable: false
      }
    });

    return hooks;
  };
}

const litOpenCodePlugin = createLitOpenCodePlugin();

export default litOpenCodePlugin;
