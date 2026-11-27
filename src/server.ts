import { advisoryGoalCheck, advisoryLoopGoalCheck } from "./goal-pipeline.ts";
import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import { fileURLToPath } from "node:url";
import { createChatMessageActivationHook, showActivationToast } from "./activation.ts";
import { createActivationMemory } from "./activation-reentry.ts";
import { registerLitOpenCodeAgents } from "./agents.ts";
import { createAutoHandoff } from "./auto-handoff-hooks.ts";
import { createAutopilotDeliveryV1, createAutopilotRuntime } from "./autopilot-hooks.ts";
import { createBoundedAuthorityEventHook } from "./bounded-authority-hooks.ts";
import { suggestionNote } from "./suggestion-tier.ts";
import { createBrainstormRun } from "./brainstorm-run.ts";
import { createCommandActivationHook } from "./commands.ts";
import { loadConfig } from "./config.ts";
import { createDeliverableHedgeGuard } from "./deliverable-hedge-guard.ts";
import { createToolExecuteAfterHook, createToolExecuteBeforeHook } from "./hooks.ts";
import { createLogger } from "./logger.ts";
import { createIgnitionState, stripIgnitionMarksFromHistory } from "./ignition.ts";
import { createSessionLookup } from "./session-lineage.ts";
import { markLiveness } from "./session-liveness.ts";
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
    // The completion mark resets every root turn; which discipline a session runs must outlive the turn.
    const activationMemory = createActivationMemory();
    const autoHandoff = createAutoHandoff({
      projectRoot: root,
      paths: loaded.paths,
      client: input?.client,
      config: loaded.config.autoHandoff,
      ...(getSession === undefined ? {} : { getSession })
    });
    const brainstormRun = createBrainstormRun({
      dir: loaded.paths.brainstormRunsDir,
      getSession,
      send: async (sessionID, text, route) => {
        if (input?.client === undefined) return;
        await input.client.session.promptAsync({
          path: { id: sessionID },
          query: { directory: root },
          body: {
            ...(route?.agent === undefined ? {} : { agent: route.agent }),
            ...(route?.providerID === undefined || route.modelID === undefined ? {} : { model: { providerID: route.providerID, modelID: route.modelID } }),
            parts: [{ type: "text", text }]
          }
        });
      },
      notify: (message) => {
        try {
          void input?.client?.tui?.showToast({ body: { title: "LitOpenCode ultra-brainstorm", message, variant: "warning", duration: 10000 } })?.catch(() => undefined);
        } catch { // no-excuse-ok: catch -- a missing TUI must never stop the session; the run stays paused.
        }
      }
    });
    const withBrainstormToolCount = (hook: NonNullable<Hooks["tool.execute.after"]>): NonNullable<Hooks["tool.execute.after"]> => async (toolInput, toolOutput) => {
      await brainstormRun.toolDone({ sessionID: toolInput.sessionID, tool: toolInput.tool, args: toolInput.args, output: typeof toolOutput.output === "string" ? toolOutput.output : "" });
      await hook(toolInput, toolOutput);
    };
    // The run guard reads what the user typed, and the agent and model to continue on, before activation runs.
    const withBrainstormUserText = (hook: NonNullable<Hooks["chat.message"]>): NonNullable<Hooks["chat.message"]> => async (messageInput, messageOutput) => {
      const typed = messageOutput.parts.flatMap((part) => (part.type === "text" && part.synthetic !== true ? [part.text] : [])).join("\n");
      await brainstormRun.userText(messageInput.sessionID, typed, {
        ...(messageInput.agent === undefined ? {} : { agent: messageInput.agent }),
        ...(messageInput.model === undefined ? {} : { providerID: messageInput.model.providerID, modelID: messageInput.model.modelID })
      });
      await hook(messageInput, messageOutput);
    };
    // The host resolves a relative write or edit path against its launch directory, which can be a subfolder of the worktree.
    const deliverableHedgeGuard = createDeliverableHedgeGuard({ projectRoot: input?.directory?.trim() || root });
    const recordSkillActivation = async (sessionID: string, skillId: string, appendedLit = false): Promise<void> => {
      showActivationToast(input?.client, skillId);
      ignitionState.activate(sessionID, skillId, !appendedLit);
    };
    const boundedAuthorityEvent = createBoundedAuthorityEventHook(root, input?.client, loaded.config.boundedAuthority);
    const autopilot = createAutopilotRuntime({
      projectRoot: root,
      directory: input?.directory?.trim() || root,
      ...(getSession === undefined ? {} : { getSession }),
      autopilot: loaded.config.boundedAuthority
    });
    const autopilotDelivery = createAutopilotDeliveryV1(autopilot, input?.client, root);
    // Keyed by session: the host resolves command parts into a new array before chat.message runs.
    const trustedCommandActivations = new Map<string, string>();
    const commandNotices = new Map<string, string>();
    const commandActivation = createCommandActivationHook(root, {
      commandAliasRoot: defaultOpenCodeConfigRoot(),
      boundedAuthority: loaded.config.boundedAuthority,
      knowledgeCaptureEnabled: loaded.config.knowledge.capture,
      autoHandoffRoute: autoHandoff.route,
      onSkillActivation: recordSkillActivation,
      onPlanQuestion: (line) => {
        try {
          void input?.client?.tui?.showToast({ body: { title: "LitOpenCode plan", message: line, variant: "info", duration: 30000 } })?.catch(() => undefined);
        } catch { // no-excuse-ok: catch -- a missing TUI must never block the plan save.
          // The question still rides the saved-plan notice.
        }
      },
      onLoopGoalQuestion: (line) => {
        try {
          void input?.client?.tui?.showToast({ body: { title: "LitOpenCode goal", message: line, variant: "info", duration: 30000 } })?.catch(() => undefined);
        } catch { // no-excuse-ok: catch -- a missing TUI must never block the command.
          // The consent stays recorded, so the user's yes still arms the goal.
        }
      }
    });

    const hooks: Hooks = {
      config: async (config) => {
        registerLitOpenCodeAgents(config, loaded.config);
      },
      event: async (eventInput) => {
        if (eventInput.event.type === "session.idle") {
          await markLiveness(root, eventInput.event.properties.sessionID, "idle");
          await brainstormRun.idle(eventInput.event.properties.sessionID);
          // OpenCode 1 has no /goal: an armed goal is checked here, as an advisory, when the turn ends.
          const line = advisoryGoalCheck(root, eventInput.event.properties.sessionID)
            ?? await advisoryLoopGoalCheck(root, eventInput.event.properties.sessionID);
          if (line !== undefined) {
            try {
              await input?.client?.tui?.showToast({ body: { title: "LitOpenCode goal", message: line, variant: "info", duration: 10000 } });
            } catch { // no-excuse-ok: catch -- a missing toast must not stop the session; the intent file holds the result.
            }
          }
        }
        // The bounded-authority hook runs first, so a progress fence it continued is seen by the driver.
        await boundedAuthorityEvent(eventInput);
        if (eventInput.event.type === "session.idle") await autopilotDelivery.onIdle(eventInput.event.properties.sessionID);
        if (eventInput.event.type === "session.deleted") {
          await markLiveness(root, eventInput.event.properties.info.id, "ended");
          ignitionState.clear(eventInput.event.properties.info.id);
          activationMemory.forget(eventInput.event.properties.info.id);
          trustedCommandActivations.delete(eventInput.event.properties.info.id);
          autopilot.forget(eventInput.event.properties.info.id);
        }
        if (eventInput.event.type === "session.error" && eventInput.event.properties.error?.name === "MessageAbortedError" && eventInput.event.properties.sessionID !== undefined) {
          await brainstormRun.interrupt(eventInput.event.properties.sessionID);
        }
        await autoHandoff.event(eventInput);
      },
      tool: litOpenCodeTools,
      "chat.message": withBrainstormUserText(createChatMessageActivationHook(root, {
        getSession,
        boundedAuthority: loaded.config.boundedAuthority,
        ...(input?.directory?.trim() ? { directory: input.directory.trim() } : {}),
        knowledgeCaptureEnabled: loaded.config.knowledge.capture,
        autoHandoffRoute: autoHandoff.route,
        onRootUserTurn: (sessionID) => {
          ignitionState.resetDiscipline(sessionID);
        },
        onSkillActivation: recordSkillActivation,
        activationMemory,
        onSkillContinue: (sessionID, skillId, appendedLit = false) => {
          ignitionState.activate(sessionID, skillId, !appendedLit);
        },
        trustedInjectedSkill: (sessionID) => {
          const skillId = trustedCommandActivations.get(sessionID);
          trustedCommandActivations.delete(sessionID);
          return skillId;
        },
        onTrustedSkillResume: (sessionID, skillId) => {
          ignitionState.activate(sessionID, skillId);
        },
        extensionsNoticeRoot: defaultOpenCodeConfigRoot(),
        onLoopGoalQuestion: (line) => {
          try {
            void input?.client?.tui?.showToast({ body: { title: "LitOpenCode goal", message: line, variant: "info", duration: 30000 } })?.catch(() => undefined);
          } catch { // no-excuse-ok: catch -- a missing TUI must never block the activation.
            // The question still reaches the model as context, and the consent stays recorded.
          }
        },
        takeCommandNotice: (sessionID) => {
          const notice = commandNotices.get(sessionID);
          commandNotices.delete(sessionID);
          return notice;
        },
        autopilotAnswer: async (sessionID, text, typed) => {
          const answer = await autopilot.answer(sessionID, text, typed);
          return answer.handled ? answer.reply : undefined;
        },
        suggestion: suggestionNote
      })),
      "command.execute.before": async (commandInput, commandOutput) => {
        const priorLength = commandOutput.parts.length;
        await commandActivation(commandInput, commandOutput);
        const activationPart = commandOutput.parts.slice(priorLength).reverse().find(
          (part) => trustedCommandSkillId(part) !== undefined
        );
        const skillId = trustedCommandSkillId(activationPart);
        // The saved-plan notice and its approval question reach the model through chat.message.
        const saved = commandOutput.parts.slice(priorLength).find((part) => part.type === "text" && (part.metadata as { litopencode?: { operation?: string } } | undefined)?.litopencode?.operation === "save-plan");
        if (saved?.type === "text") commandNotices.set(commandInput.sessionID, saved.text);
        else commandNotices.delete(commandInput.sessionID);
        if (skillId === undefined) trustedCommandActivations.delete(commandInput.sessionID);
        else trustedCommandActivations.set(commandInput.sessionID, skillId);
      },
      "experimental.text.complete": ignitionState.complete,
      "experimental.chat.messages.transform": stripIgnitionMarksFromHistory,
      "experimental.chat.system.transform": async (transformInput, transformOutput) => {
        await applyStaticRuleInjection({
          projectRoot: root,
          bundledRulesDir: fileURLToPath(new URL("../rules/bundled-rules", import.meta.url)),
          outputStyle: loaded.config.outputStyle
        }, transformInput, transformOutput);
        await autoHandoff.systemTransform(transformInput, transformOutput);
      },
      "experimental.session.compacting": async (compactInput, compactOutput) => {
        activationMemory.forget(compactInput.sessionID);
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
        value: createToolExecuteBeforeHook({ getSession, deliverableHedgeGuard, projectRoot: root, baseDirectory: input?.directory?.trim() || root, autopilot }),
        enumerable: false
      },
      "tool.execute.after": {
        value: withBrainstormToolCount(createToolExecuteAfterHook({
          projectRoot: root,
          knowledgeCaptureEnabled: loaded.config.knowledge.capture,
          deliverableHedgeGuard,
          onSkillActivation: recordSkillActivation,
          autopilot
        })),
        enumerable: false
      }
    });

    return hooks;
  };
}

const litOpenCodePlugin = createLitOpenCodePlugin();

export default litOpenCodePlugin;
