// Host wiring for the start-work autopilot, shared by OpenCode 1 and OpenCode 2.
//   before-tool  `tool.execute.before` (v1) / `tool.hook("execute.before")` (v2, shown under the v1 tool
//                names): the shell guard, the file-tool guard, and lane tracking for the task tool.
//   turn-end     `session.idle` (v1) / the end of a turn in the v2 event stream; the driver runs on every
//                turn end, including the one that follows its own continuation.
//   prompt-time  `chat.message` (v1) / the session `prompt` hook (v2): the typed answer words.
// Delivery differs by host and lives in the two adapters at the bottom.
import type { PluginInput } from "@opencode-ai/plugin";
import { createHash } from "node:crypto";
import { autopilotContextBytes, createAutopilot, type AutopilotOptions, type Lane, type ParkedStep, type PromptAnswer, type TurnEndDecision } from "./autopilot.ts";
import type { SessionLookup } from "./session-lineage.ts";

type ToolCall = { readonly tool: string; readonly sessionID: string; readonly callID: string };

const shellTools = new Set(["bash"]);
const fileTools = new Set(["edit", "write", "patch", "multiedit", "apply_patch"]);
const laneTools = new Set(["task"]);
const ownTextMarkers = ["<litopencode-autopilot", "<bounded-authority-continuation>", "LitOpenCode start-work"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

/** Every file a patch body names: the `*** Add/Update/Delete File:` and `*** Move to:` headers and unified `---`/`+++` lines. */
export function patchTargets(patch: string): readonly string[] {
  const found = new Set<string>();
  for (const line of patch.split(/\r?\n/u)) {
    const header = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/u.exec(line) ?? /^\*\*\* Move to:\s*(.+?)\s*$/u.exec(line);
    if (header !== null) found.add(header[1]);
    const unified = /^(?:\+\+\+|---) (?:[ab]\/)?(.+?)(?:\t.*)?$/u.exec(line);
    if (unified !== null && unified[1] !== "/dev/null") found.add(unified[1]);
  }
  return [...found];
}

/** The most text one autopilot message may add to the model's context; the inbox is built to fit, this is the backstop. */
export const autopilotContextCap = autopilotContextBytes;

function capped(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= autopilotContextCap) return text;
  let cut = text.slice(0, autopilotContextCap);
  while (Buffer.byteLength(cut, "utf8") > autopilotContextCap - 80) cut = cut.slice(0, -200);
  return `${cut}\n[cut at ${autopilotContextCap} bytes]`;
}

export type AutopilotRuntimeOptions = {
  readonly projectRoot: string;
  /** The folder a shell call without its own `workdir` runs in. */
  readonly directory: string;
  readonly getSession?: SessionLookup;
  readonly autopilot?: AutopilotOptions;
};

export function createAutopilotRuntime(options: AutopilotRuntimeOptions) {
  const autopilot = createAutopilot(options.projectRoot, options.autopilot);
  const lanes = new Map<string, Lane & { readonly owner: string }>();
  const sent = new Set<string>();
  let parkPing: ((step: ParkedStep) => void) | undefined;

  async function ownerFor(sessionID: string): Promise<string | undefined> {
    const owner = await autopilot.ownerOf();
    if (owner === undefined) return undefined;
    if (owner === sessionID) return owner;
    if (options.getSession === undefined) return undefined;
    let session: Awaited<ReturnType<SessionLookup>>;
    try {
      session = await options.getSession(sessionID);
    } catch {
      // A run is live and this session's parent cannot be checked: refuse rather than let a lane run unguarded.
      throw new Error("LitOpenCode start-work guard could not check which run this session belongs to, so this call was refused. Try it again.");
    }
    return session?.parentID === owner ? owner : undefined;
  }

  /** Throws to refuse the call; a parked step also reaches the park ping. */
  /** Any error inside the guard propagates, and the host refuses the call on a throw: the guard fails closed. */
  async function beforeTool(call: ToolCall, args: unknown): Promise<void> {
    if (!shellTools.has(call.tool) && !fileTools.has(call.tool) && !laneTools.has(call.tool)) return;
    const owner = await ownerFor(call.sessionID);
    if (owner === undefined) return;
    const record = isRecord(args) ? args : {};
    if (laneTools.has(call.tool)) {
      lanes.set(call.callID, { id: call.callID, startedAt: Date.now(), owner });
      return;
    }
    if (fileTools.has(call.tool)) {
      const filePath = typeof record.filePath === "string" ? record.filePath : typeof record.path === "string" ? record.path : undefined;
      const patchText = typeof record.patchText === "string" ? record.patchText : typeof record.patch === "string" ? record.patch : undefined;
      const targets = [...(filePath === undefined ? [] : [filePath]), ...(patchText === undefined ? [] : patchTargets(patchText))];
      if (targets.length === 0) {
        if (patchText !== undefined) throw new Error("LitOpenCode start-work guard refused this patch: it names no file the guard can read. Write each file with the edit or write tool instead.");
        return;
      }
      for (const target of targets) {
        const result = await autopilot.guardWrite({ sessionID: call.sessionID, ownerSessionID: owner, filePath: target });
        if (result.kind === "deny") throw new Error(result.message);
      }
      return;
    }
    const cwd = typeof record.workdir === "string" ? record.workdir : typeof record.cwd === "string" ? record.cwd : options.directory;
    const result = await autopilot.guardShell({ sessionID: call.sessionID, ownerSessionID: owner, command: record.command, cwd });
    if (result.kind === "deny") {
      if (result.parked !== undefined) {
        try {
          parkPing?.(result.parked);
        } catch { // no-excuse-ok: catch -- the park ping is a notice; the refusal below is what matters.
        }
      }
      throw new Error(result.message);
    }
  }

  /** The park ping is on wherever the host can show a notice; it approves nothing. */
  function onPark(handler: (step: ParkedStep) => void): void {
    parkPing = handler;
  }

  function afterTool(call: ToolCall): void {
    if (laneTools.has(call.tool)) lanes.delete(call.callID);
  }

  function lanesOf(owner: string): readonly Lane[] {
    return [...lanes.values()].filter((lane) => lane.owner === owner);
  }

  async function turnEnd(sessionID: string): Promise<TurnEndDecision> {
    let decision: TurnEndDecision;
    try {
      decision = await autopilot.turnEnd({ sessionID, lanes: lanesOf(sessionID) });
    } catch {
      // The guards already fail closed on an unreadable run; a turn end only goes quiet.
      return { kind: "silent", reason: "the run state cannot be read" };
    }
    return decision.kind === "silent" ? decision : { ...decision, text: capped(decision.text) };
  }

  /** A prompt LitOpenCode sent itself, or one carrying its own markers, is not the user typing. */
  function isOwnText(text: string): boolean {
    if (sent.has(digest(text))) return true;
    return ownTextMarkers.some((marker) => text.trimStart().startsWith(marker));
  }

  function markSent(text: string): void {
    sent.add(digest(text));
    if (sent.size > 64) sent.delete(sent.values().next().value as string);
  }

  async function answer(sessionID: string, text: string, typed: boolean): Promise<PromptAnswer> {
    let result: PromptAnswer;
    try {
      result = await autopilot.answerPrompt({ sessionID, text, typed: typed && !isOwnText(text) });
    } catch {
      return { handled: false };
    }
    return result.handled ? { ...result, reply: capped(result.reply) } : result;
  }

  function forget(sessionID: string): void {
    for (const [id, lane] of lanes) if (lane.owner === sessionID) lanes.delete(id);
  }

  return { autopilot, beforeTool, afterTool, turnEnd, answer, isOwnText, markSent, forget, onPark };
}

export type AutopilotRuntime = ReturnType<typeof createAutopilotRuntime>;

export function parkPingText(step: ParkedStep): string {
  return `Parked [${step.tier}] for your answer at the end of the run: ${step.command}`;
}

/** The user-facing header every inbox, completion and impossible message starts with. */
export function decisionMessage(decision: TurnEndDecision): string | undefined {
  if (decision.kind === "silent" || decision.kind === "continue") return undefined;
  return `LitOpenCode start-work (${decision.kind})\n${decision.text}`;
}

type OpenCodeClient = PluginInput["client"];

/** OpenCode 1: a continuation is a new prompt; the inbox and the closing line are added without a reply. */
export function createAutopilotDeliveryV1(runtime: AutopilotRuntime, client: OpenCodeClient | undefined, projectRoot: string) {
  async function prompt(sessionID: string, text: string, noReply: boolean): Promise<void> {
    if (client === undefined) return;
    runtime.markSent(text);
    try {
      await client.session.promptAsync({
        path: { id: sessionID },
        query: { directory: projectRoot },
        body: { ...(noReply ? { noReply: true } : {}), parts: [{ type: "text", text }] }
      } as Parameters<OpenCodeClient["session"]["promptAsync"]>[0]);
    } catch { // no-excuse-ok: catch -- a failed delivery leaves the run state as recorded; the next idle retries the next state.
    }
  }

  function toast(message: string, variant: "info" | "success" | "warning"): void {
    try {
      const pending = client?.tui?.showToast({ body: { title: "LitOpenCode start-work", message, variant, duration: 8000 } });
      void pending?.catch(() => undefined);
    } catch { // no-excuse-ok: catch -- a missing TUI must never break the run.
    }
  }

  async function onIdle(sessionID: string): Promise<TurnEndDecision> {
    const decision = await runtime.turnEnd(sessionID);
    if (decision.kind === "continue") await prompt(sessionID, decision.text, false);
    const message = decisionMessage(decision);
    if (message !== undefined) {
      toast(message.split("\n")[1] ?? "", decision.kind === "done" ? "success" : "warning");
      await prompt(sessionID, message, true);
    }
    return decision;
  }

  runtime.onPark((step) => toast(parkPingText(step), "info"));

  return { onIdle };
}

export type V2SessionDelivery = {
  readonly prompt: (input: { readonly sessionID: string; readonly text: string }) => Promise<unknown>;
  readonly synthetic?: (input: { readonly sessionID: string; readonly text: string; readonly resume?: boolean; readonly description?: string; readonly metadata?: Readonly<Record<string, string>> }) => Promise<unknown>;
};

/**
 * OpenCode 2: the server has no toast, so the park ping and the closing line go to the notices file the TUI
 * plugin shows; the inbox and closing line are synthetic messages that do not resume the session.
 */
export function createAutopilotDeliveryV2(runtime: AutopilotRuntime, session: V2SessionDelivery, notify?: (message: string, variant: "info" | "success" | "warning") => void) {
  async function onIdle(sessionID: string): Promise<TurnEndDecision> {
    const decision = await runtime.turnEnd(sessionID);
    try {
      if (decision.kind === "continue") {
        runtime.markSent(decision.text);
        await session.prompt({ sessionID, text: decision.text });
      }
      const message = decisionMessage(decision);
      if (message !== undefined) {
        runtime.markSent(message);
        notify?.(message.split("\n")[1] ?? "", decision.kind === "done" ? "success" : "warning");
        if (session.synthetic !== undefined) await session.synthetic({ sessionID, text: message, resume: false, description: "LitOpenCode start-work", metadata: { source: "litopencode-autopilot" } });
      }
    } catch { // no-excuse-ok: catch -- a failed delivery must not end the event stream.
    }
    return decision;
  }
  runtime.onPark((step) => notify?.(parkPingText(step), "info"));
  return { onIdle };
}
