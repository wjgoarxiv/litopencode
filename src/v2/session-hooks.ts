// Prompt admission and request context on OpenCode 2. OpenCode 1 appended activation text to the user
// message as an extra part; OpenCode 2 has no parts. Here the `prompt` hook marks a lit prompt in the
// user message metadata (which the TUI reads for the ignition toast and the footer line), and the
// `context` hook hands the activation text, the static rules and the reader contract to every model
// request of that session as system parts. Text that comes from the project or a lifecycle file rather
// than from LitOpenCode's own instructions (local knowledge, a start-work receipt, an auto-handoff setting
// reply) rides the latest user message instead, the channel it had on OpenCode 1.
import { fileURLToPath } from "node:url";
import { createActivationMemory, decideReentry } from "../activation-reentry.ts";
import { detectChatActivationMode, promptForChatActivationMode, type ChatActivationMode } from "../activation-routing.ts";
import { startWorkPromptInjection } from "../activation-workflow-prompts.ts";
import { autoHandoffSettingText, type AutoHandoffRouteMode } from "../auto-handoff.ts";
import { applyTrustedStartWorkDirective, parseStartWorkLifecycleDirective } from "../bounded-authority-hooks.ts";
import type { BoundedAuthorityOptions } from "../bounded-authority.ts";
import type { LitOpenCodeConfig } from "../config.ts";
import { queryKnowledge } from "../knowledge.ts";
import { createLitGoalOperations } from "../ledger.ts";
import { applyCompactionRuleReset, applyStaticRuleInjection } from "../rules/hooks.ts";
import { isReadOnlyWorkflowFamilyPlan } from "../workflow-families.ts";
import type { AgentRequestOptions } from "./agents.ts";

export type SystemPartLike = { readonly type: "text"; readonly text: string };

export type PromptEvent = {
  readonly sessionID: string;
  readonly messageID: string;
  prompt: { text: string };
  metadata?: Record<string, unknown>;
};

/** An OpenCode 2 request message: an instance of the host's own message class. */
export type MessageLike = { readonly role: string; readonly content: readonly unknown[] };

export type ContextEvent = {
  readonly sessionID: string;
  readonly agent: string;
  system: SystemPartLike[];
  messages?: MessageLike[];
  options: Record<string, unknown>;
};

export type SessionAgentLookup = (sessionID: string) => Promise<{ readonly parentID?: string; readonly agent?: string } | undefined>;

export type V2SessionHookOptions = {
  readonly projectRoot: string;
  readonly config: Pick<LitOpenCodeConfig, "outputStyle" | "boundedAuthority">;
  readonly getSession: SessionAgentLookup;
  /** Puts a session that has no model of its own on its agent's route. */
  readonly routeModel?: (sessionID: string) => Promise<void>;
  readonly requestOptions: ReadonlyMap<string, AgentRequestOptions>;
  readonly autoHandoffRoute?: (text: string, mode: AutoHandoffRouteMode) => Promise<string | undefined>;
  /** Extra system text for this request, such as the saved handoff after a compaction. */
  readonly extraSystem?: (sessionID: string) => Promise<readonly string[]>;
  readonly onActivation?: (sessionID: string, mode: ChatActivationMode | string) => void;
  /** Accepts a command mark the plugin itself sent for this session; anything else is dropped. */
  readonly acceptCommandMark?: (sessionID: string, marker: unknown) => { readonly command: string; readonly banner: string } | undefined;
};

type SessionContext = {
  /** The latest activation stays with the session, the way an OpenCode 1 activation part stays in its history. */
  activation?: string;
  /** LitOpenCode's own text that belongs to the current turn only, such as a re-entry note. */
  turn: string[];
  /** Data for the current turn that belongs to the user message: local knowledge, a receipt, a setting reply. */
  user: string[];
};

const bundledRulesDir = fileURLToPath(new URL("../../rules/bundled-rules", import.meta.url));

/**
 * `opencode2 run "lit fix it"` sends the message wrapped in double quotes (each multi-word argument is
 * quoted, inner quotes escaped). The prompt hook runs in the server, so the run's argv is not available
 * the way it is on OpenCode 1; a message that is exactly one such quoted argument is read without the
 * quotes. Quoted text inside a longer prompt stays inactive. The server cannot tell a run argument from
 * a TUI prompt typed entirely inside double quotes, so such a typed `"lit fix it"` activates as well;
 * on OpenCode 1 it stayed inert.
 */
export function unwrapRunArgument(input: string): string {
  const match = /^"((?:[^"\\]|\\.)*)"$/su.exec(input);
  return match === null ? input : match[1].replace(/\\"/gu, '"');
}

function text(value: string): SystemPartLike {
  return { type: "text", text: value };
}

/**
 * Adds text parts to the latest user message. The host builds each message with its own class, so the
 * copy is made with that class; false when there is no user message to carry the text.
 */
function appendToLatestUserMessage(messages: MessageLike[] | undefined, texts: readonly string[]): boolean {
  if (messages === undefined) return false;
  let index = messages.length - 1;
  while (index >= 0 && messages[index].role !== "user") index -= 1;
  if (index < 0) return false;
  const latest = messages[index];
  const Message = latest.constructor as new (input: MessageLike) => MessageLike;
  messages[index] = new Message({ ...latest, content: [...latest.content, ...texts.map(text)] });
  return true;
}

export function createV2SessionHooks(options: V2SessionHookOptions) {
  const operations = createLitGoalOperations(options.projectRoot);
  const sessions = new Map<string, SessionContext>();
  // The latest activation stays in every request of its session, so a repeated lit only adds a note to it.
  const activationMemory = createActivationMemory();

  function stateFor(sessionID: string): SessionContext {
    let state = sessions.get(sessionID);
    if (state === undefined) {
      state = { turn: [], user: [] };
      sessions.set(sessionID, state);
    }
    return state;
  }

  async function lookup(sessionID: string): Promise<{ readonly child: boolean; readonly agent?: string }> {
    try {
      const session = await options.getSession(sessionID);
      if (session === undefined) return { child: true };
      return { child: session.parentID !== undefined, ...(session.agent === undefined ? {} : { agent: session.agent }) };
    } catch {
      // Fail closed: a session whose lineage cannot be read is treated as delegated.
      return { child: true };
    }
  }

  /** Keeps a command mark only when the plugin sent it; returns true for such a trusted command turn. */
  function admitCommandMark(event: PromptEvent): boolean {
    const metadata = event.metadata;
    if (metadata === undefined || !("litopencode" in metadata)) return false;
    const { litopencode: marker, ...rest } = metadata;
    const accepted = options.acceptCommandMark?.(event.sessionID, marker);
    if (accepted === undefined) {
      event.metadata = Object.keys(rest).length === 0 ? undefined : rest;
      return false;
    }
    event.metadata = { ...rest, litopencode: { command: accepted.command, banner: accepted.banner, source: "command" } };
    options.onActivation?.(event.sessionID, accepted.command);
    return true;
  }

  async function prompt(event: PromptEvent): Promise<void> {
    const input = unwrapRunArgument(event.prompt.text);
    try {
      await options.routeModel?.(event.sessionID);
    } catch { // no-excuse-ok: catch -- a failed route switch must never block the user message.
      // The session keeps the model the host chose.
    }
    if (admitCommandMark(event)) {
      const state = stateFor(event.sessionID);
      state.turn = [];
      state.user = [];
      return;
    }
    const session = await lookup(event.sessionID);
    if (session.child) return;
    const state = stateFor(event.sessionID);
    state.turn = [];
    state.user = [];
    if (input.trim() === "") return;

    if (options.autoHandoffRoute !== undefined) {
      const reply = await options.autoHandoffRoute(input, "chat");
      if (reply !== undefined) {
        state.user.push(autoHandoffSettingText(reply));
        return;
      }
    }

    try {
      const knowledge = await queryKnowledge(options.projectRoot, input.slice(0, 4096));
      if (knowledge.text !== "") state.user.push(knowledge.text);
    } catch { // no-excuse-ok: catch -- local relevance must never block the user message.
      // A malformed or unreadable knowledge store stays silent instead of inventing context.
    }

    const mode = detectChatActivationMode(input, session.agent);
    if (mode === undefined) return;
    const trigger = mode === "lit-handoff" ? "handoff" : mode === "lit-scientific-visualization" ? mode : "lit";
    let activation = promptForChatActivationMode(mode, input);
    if (mode === "start-work" && session.agent !== "lit-plan") {
      const directive = parseStartWorkLifecycleDirective(input, { chat: true });
      if (directive?.action === "resume") {
        try {
          const receipt = await applyTrustedStartWorkDirective(options.projectRoot, event.sessionID, directive, options.config.boundedAuthority as BoundedAuthorityOptions);
          state.user.push(receipt.text);
          activation = startWorkPromptInjection;
        } catch {
          activation = "BLOCKED: bounded-authority lifecycle resume rejected. Use /start-work with the exact pending boundary, grant, work id, session, and CAS revision.";
        }
      }
    }
    const reentry = await decideReentry({
      memory: activationMemory,
      projectRoot: options.projectRoot,
      sessionID: event.sessionID,
      mode,
      text: input
    });
    if (reentry.kind === "continue") {
      state.turn.push(reentry.text);
      event.metadata = { ...(event.metadata ?? {}), litopencode: { mode: reentry.mode, trigger, source: "prompt", reentry: "continue" } };
      options.onActivation?.(event.sessionID, reentry.mode);
      return;
    }
    if (reentry.kind === "resume") activation = `${reentry.line}\n${activation}`;
    else if (reentry.kind === "confirm") activation = `${activation}\n${reentry.line}`;
    state.activation = activation;
    event.metadata = {
      ...(event.metadata ?? {}),
      litopencode: { mode, trigger, source: "prompt", ...(reentry.kind === "full" ? {} : { reentry: reentry.kind }) }
    };
    options.onActivation?.(event.sessionID, mode);
    if (reentry.kind !== "confirm" && mode !== "lit-handoff" && mode !== "lit-scientific-visualization") {
      activationMemory.remember(event.sessionID, mode);
    }

    if (mode === "lit-task" || mode === "lit-recap" || mode === "lit-brainstorm" || isReadOnlyWorkflowFamilyPlan(mode)) return;
    try {
      await operations.init();
      await operations.append({
        type: "prompt.activated",
        trigger,
        source: "prompt",
        mode,
        sessionID: event.sessionID,
        messageID: event.messageID,
        ...(session.agent === undefined ? {} : { agent: session.agent }),
        timestamp: new Date().toISOString()
      });
    } catch { // no-excuse-ok: catch -- activation must survive best-effort ledger failure.
      // The activation text is the primary surface; the ledger write is best-effort.
    }
  }

  async function context(event: ContextEvent): Promise<void> {
    const state = sessions.get(event.sessionID);
    if (state?.activation !== undefined) event.system.push(text(state.activation));
    for (const entry of state?.turn ?? []) event.system.push(text(entry));
    const user = state?.user ?? [];
    if (user.length > 0 && !appendToLatestUserMessage(event.messages, user)) {
      for (const entry of user) event.system.push(text(entry));
    }
    for (const entry of (await options.extraSystem?.(event.sessionID)) ?? []) event.system.push(text(entry));
    const rules = { system: [] as string[] };
    await applyStaticRuleInjection(
      { projectRoot: options.projectRoot, bundledRulesDir, outputStyle: options.config.outputStyle },
      { sessionID: event.sessionID } as Parameters<typeof applyStaticRuleInjection>[1],
      rules as Parameters<typeof applyStaticRuleInjection>[2]
    );
    for (const entry of rules.system) event.system.push(text(entry));
    const request = options.requestOptions.get(event.agent);
    if (request !== undefined) {
      for (const [key, value] of Object.entries(request)) if (event.options[key] === undefined) event.options[key] = value;
    }
  }

  async function compaction(event: ContextEvent): Promise<void> {
    const output = { context: [] as string[] };
    await applyCompactionRuleReset({ sessionID: event.sessionID }, output);
    for (const entry of output.context) event.system.push(text(entry));
  }

  return {
    prompt,
    context,
    compaction,
    clear(sessionID: string): void {
      sessions.delete(sessionID);
      activationMemory.forget(sessionID);
    }
  };
}
