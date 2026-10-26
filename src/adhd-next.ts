import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createActivationMemory, decideReentry, type ActivationMemory } from "./activation-reentry.ts";
import type { ChatActivationMode } from "./activation-routing.ts";
import { startWorkPromptInjection } from "./activation-workflow-prompts.ts";
import type { BoundedAuthorityOptions } from "./bounded-authority.ts";
import { answerBoundary, boundaryVerdict, startTypedWork } from "./start-work-typed.ts";
import { createRuntimePaths } from "./state.ts";

// The brief from lit-adhd ends with one recommended next step and the word `go`. The collector writes that
// step as a small record for ONE session; a bare `go` only means something while that record is alive.
// Without it `go`, `고` and `진행` are ordinary words and nothing routes.

export const adhdNextSchema = "litopencode.adhd-next/v1";
export const adhdNextTtlMs = 30 * 60_000;

export type NextKind = "continue" | "work" | "plan" | "elsewhere";

export type NextRecord = {
  readonly schema: typeof adhdNextSchema;
  readonly kind: NextKind;
  readonly target: string;
  readonly at: number;
  readonly sessionID: string;
};

const safeSessionID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const recordByteLimit = 4096;
const goWord = /^(?:lit\s+go|go|ㄱㄱ|고|진행)[.!?。]*$/iu;

/** True only when the WHOLE prompt is a go word; a go word inside a sentence or a code span is not one. */
export function detectGoWord(text: string): boolean {
  return goWord.test(text.trim());
}

export function nextFile(projectRoot: string, sessionID: string): string {
  if (!safeSessionID.test(sessionID)) throw new Error("next-step session id must match [A-Za-z0-9_-]");
  return path.join(createRuntimePaths(projectRoot).adhdDir, `next-${sessionID}.json`);
}

function isNextRecord(value: unknown): value is NextRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schema === adhdNextSchema &&
    (record.kind === "continue" || record.kind === "work" || record.kind === "plan" || record.kind === "elsewhere") &&
    typeof record.target === "string" &&
    record.target.length <= 512 &&
    typeof record.at === "number" &&
    Number.isFinite(record.at) &&
    typeof record.sessionID === "string"
  );
}

export async function writeNext(projectRoot: string, record: Omit<NextRecord, "schema">): Promise<void> {
  const file = nextFile(projectRoot, record.sessionID);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = await fs.lstat(file).catch(() => undefined);
  if (existing !== undefined && !existing.isFile()) throw new Error("next-step record path is not a regular file");
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ schema: adhdNextSchema, ...record }), { mode: 0o600, flag: "w" });
  await fs.rename(temp, file);
}

/**
 * Reads and removes the next-step record of THIS session. A record of another session, an older one,
 * a link, an oversized file or malformed JSON is treated as absent; a file that was read is deleted either way.
 */
export async function consumeNext(projectRoot: string, sessionID: string, now: number): Promise<NextRecord | undefined> {
  let file: string;
  try {
    file = nextFile(projectRoot, sessionID);
  } catch {
    return undefined;
  }
  const stat = await fs.lstat(file).catch(() => undefined);
  if (stat === undefined) return undefined;
  if (!stat.isFile() || stat.size > recordByteLimit) {
    if (stat.isFile() || stat.isSymbolicLink()) await fs.unlink(file).catch(() => undefined);
    return undefined;
  }
  let parsed: unknown;
  try {
    const handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      parsed = JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    parsed = undefined;
  }
  await fs.unlink(file).catch(() => undefined);
  if (!isNextRecord(parsed) || parsed.sessionID !== sessionID) return undefined;
  const age = now - parsed.at;
  return age >= 0 && age <= adhdNextTtlMs ? parsed : undefined;
}

export type GoRoute = {
  readonly text: string;
  readonly mode: ChatActivationMode;
  readonly kind: NextKind;
};

/**
 * Turns a live `go` into the existing re-entry or start path. A paused spine returns through the same
 * resume a `lit continue` takes, running work gets the continue note, and one open plan goes through the typed
 * start-work path. A pending boundary is never answered here: only `lit approve` or `lit deny` can.
 */
export async function routeGo(input: {
  readonly projectRoot: string;
  readonly sessionID: string;
  readonly text: string;
  readonly memory?: ActivationMemory;
  readonly boundedAuthority?: BoundedAuthorityOptions;
  readonly now?: number;
}): Promise<GoRoute | undefined> {
  if (!detectGoWord(input.text)) return undefined;
  const now = input.now ?? Date.now();
  const record = await consumeNext(input.projectRoot, input.sessionID, now);
  if (record === undefined) return undefined;
  if (record.kind === "continue") {
    const decision = await decideReentry({
      memory: input.memory ?? createActivationMemory(),
      projectRoot: input.projectRoot,
      sessionID: input.sessionID,
      mode: "lit-task",
      text: "lit continue",
      now
    });
    return decision.kind === "continue" ? { text: decision.text, mode: decision.mode, kind: "continue" } : undefined;
  }
  if (record.kind === "elsewhere") {
    // The brief's step belongs to another session or worktree; go here only says where to act.
    return {
      text: `LitOpenCode: the user answered go to the lit-adhd brief, but its next step is outside this session: ${record.target} Say in one line where to open it; do not start that work here.`,
      mode: "lit-adhd",
      kind: "elsewhere"
    };
  }
  if (record.kind === "work") {
    return {
      text: "LitOpenCode: the user answered go to the brief's next step, which is the running start-work run. Keep working from the checked plan; do not restart it, replan or widen what it may touch. A pending boundary still needs `lit approve` from the user.",
      mode: "start-work",
      kind: "work"
    };
  }
  const started = await startTypedWork({
    projectRoot: input.projectRoot,
    sessionID: input.sessionID,
    ...(record.target === "" ? {} : { plan: record.target }),
    ...(input.boundedAuthority === undefined ? {} : { options: input.boundedAuthority })
  });
  return { text: `${started.text}\n${startWorkPromptInjection}`, mode: "start-work", kind: "plan" };
}

export type TypedPromptReply = {
  readonly text: string;
  readonly mode: ChatActivationMode;
  readonly kind: "approve" | "deny" | NextKind;
  readonly continued: boolean;
};

/**
 * The whole-prompt typed words of a ROOT user session: `lit approve`, `lit deny` and a live `go`.
 * Callers pass only prompts that came from the user in a root session; anything else never reaches here.
 */
export async function typedPromptReply(
  projectRoot: string,
  sessionID: string,
  text: string,
  memory: ActivationMemory | undefined,
  boundedAuthority: BoundedAuthorityOptions | undefined
): Promise<TypedPromptReply | undefined> {
  const verdict = boundaryVerdict(text);
  if (verdict !== undefined) {
    const reply = await answerBoundary({ projectRoot, sessionID, verdict, ...(boundedAuthority === undefined ? {} : { options: boundedAuthority }) });
    return { text: reply, mode: "start-work", kind: verdict, continued: false };
  }
  const go = await routeGo({
    projectRoot,
    sessionID,
    text,
    ...(memory === undefined ? {} : { memory }),
    ...(boundedAuthority === undefined ? {} : { boundedAuthority })
  });
  return go === undefined ? undefined : { text: go.text, mode: go.mode, kind: go.kind, continued: go.kind !== "plan" && go.kind !== "elsewhere" };
}
