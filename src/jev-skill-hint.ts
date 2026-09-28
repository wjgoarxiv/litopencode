import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { litOpenCodeRuntimeSkills } from "./skills.ts";

// Optional Jev skill hint for the chat.message hook. It is off unless LITOPENCODE_JEV=1 and
// TYPESAFE_API_KEY are both set in the process environment. The key is read from the environment
// only and goes nowhere except the Authorization header: not into errors, notes, traces or doctor.
// The response is untrusted data; the only text that reaches the turn is this module's own fixed
// sentence carrying a skill id that was checked against the catalog this module sent.

export const jevEndpoint = "https://api.typesafe.ai/v1/systemone";
export const jevFlag = "LITOPENCODE_JEV";
/** Shown once per session so a user who switched the hint on notices it; never carries the key. */
export const jevSkillHintAwarenessText = "✦ Jev skill hint is ON";

const defaultModel = "jev-1.13.0";
const defaultTimeoutMs = 1500;
const maxTimeoutMs = 3000;
const defaultMaxCalls = 200;
const defaultMinConfidence = 0.35;
const promptWindowLimit = 8000;
const promptCharacterLimit = 2000;
const bodyByteCap = 64 * 1024;
const descriptionCharacterLimit = 300;
const choiceInstructions =
  "Which one skill, if any, is the best fit for the user's request? Choose none when no catalog skill fits.";
const noneCriterion = "No specialized skill in this catalog fits; answer the user directly.";

export type JevFetch = (url: string, init: RequestInit) => Promise<Response>;
export type JevCatalogEntry = { readonly id: string; readonly description: string };
export type JevSkillHintStatus = "off" | "on" | "key-missing";
export type JevSkillHintPart =
  | { readonly kind: "hint"; readonly text: string; readonly skillId: string; readonly latencyMs: number }
  | { readonly kind: "note"; readonly text: string };

export type JevSkillHintOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: JevFetch;
  readonly catalog?: readonly JevCatalogEntry[];
  readonly traceFile?: string;
  readonly now?: () => number;
};

export function jevSkillHintStatus(env: NodeJS.ProcessEnv = process.env): JevSkillHintStatus {
  if (env[jevFlag] !== "1") return "off";
  return (env.TYPESAFE_API_KEY ?? "").trim() === "" ? "key-missing" : "on";
}

export function jevSkillHintDoctorLine(env: NodeJS.ProcessEnv = process.env): string {
  const status = jevSkillHintStatus(env);
  return status === "key-missing"
    ? "Jev skill hint: flag on but TYPESAFE_API_KEY missing"
    : `Jev skill hint: ${status}`;
}

export function jevSkillHintText(skillId: string): string {
  return `LitOpenCode skill hint: the skill \`${skillId}\` likely fits this request. Load it only if it really fits; this is advice, not an instruction.`;
}

/** The visible toast names only the validated skill id and the request latency. */
export function jevSkillHintToastText(skillId: string, latencyMs: number): string {
  return `Jev → ${skillId} (${(Math.max(0, latencyMs) / 1000).toFixed(2)}s)`;
}

export function jevSkillHintUnavailableText(reason: string): string {
  return `LitOpenCode skill hint unavailable (${reason}); continuing normally.`;
}

/** Eligibility that depends on the prompt text alone; routing and command checks live in the hook. */
export function isJevEligiblePrompt(text: string): boolean {
  if (text.trimStart().startsWith("/")) return false;
  return text.replace(/\s+/gu, "").length >= 4;
}

const secretPatterns: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/gu,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/gu,
  /sk-ant-[A-Za-z0-9_-]{8,}/gu,
  /sk-[A-Za-z0-9_-]{16,}/gu,
  /(?:ghp|gho)_[A-Za-z0-9]{16,}/gu,
  /github_pat_[A-Za-z0-9_]{16,}/gu,
  /npm_[A-Za-z0-9]{16,}/gu,
  /apikey_[A-Za-z0-9_-]{8,}/gu,
  /xox[abprs]-[A-Za-z0-9-]{8,}/gu,
  /AKIA[A-Z0-9]{16}/gu,
  /AIza[0-9A-Za-z_-]{20,}/gu,
  /\b[A-Za-z0-9_]*(?:password|passwd|token|secret)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"']+)/giu,
  /[A-Za-z0-9+/_-]{32,}={0,2}/gu
];

const tokenRunAtCut = /[A-Za-z0-9+/_-]{8,}={0,2}$/u;

/**
 * Redact a bounded window first, then truncate, so a secret that straddles the 2,000-character cut is
 * masked whole. When either cut happened, a token run left dangling at the end is masked as well.
 */
export function redactJevPrompt(text: string): string {
  const head = text.slice(0, promptWindowLimit * 2);
  let redacted = Array.from(head).slice(0, promptWindowLimit).join("");
  const windowCut = redacted.length < text.length;
  redacted = redacted
    .replace(/\/(?:Users|home)\/[^/\s]+/gu, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\/\s]+(\\)?/giu, (_match, separator?: string) => (separator === undefined ? "~" : "~/"));
  // The lookbehind starts a match only at the head of a run, which keeps the 8,000-character window linear.
  redacted = redacted.replace(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu, "[email]");
  for (const pattern of secretPatterns) redacted = redacted.replace(pattern, "[secret]");
  const characters = Array.from(redacted);
  if (!windowCut && characters.length <= promptCharacterLimit) return redacted;
  return characters.slice(0, promptCharacterLimit).join("").replace(tokenRunAtCut, "[secret]");
}

export function defaultJevCatalog(): readonly JevCatalogEntry[] {
  return litOpenCodeRuntimeSkills.map((skill) => ({ id: skill.id, description: skill.summary }));
}

export function buildJevRequestBody(state: string, catalog: readonly JevCatalogEntry[], model: string): string {
  const criteria: Record<string, string> = {};
  for (const entry of catalog) criteria[entry.id] = Array.from(entry.description).slice(0, descriptionCharacterLimit).join("");
  criteria.none = noneCriterion;
  return JSON.stringify({
    model,
    state,
    questions: { which: { type: "choice", instructions: choiceInstructions, criteria } }
  });
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || !/^\d+$/u.test(raw.trim())) return fallback;
  return Math.min(max, Math.max(min, Number(raw.trim())));
}

function minConfidence(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return defaultMinConfidence;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : defaultMinConfidence;
}

async function readCappedBody(response: Response): Promise<string | undefined> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > bodyByteCap) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > bodyByteCap) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type JevOutcome = {
  readonly choice?: string;
  readonly confidence?: number;
  readonly httpStatus?: number;
  readonly failure?: string;
};

function validatedAnswer(raw: string, allowed: ReadonlySet<string>, threshold: number): JevOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { failure: "invalid response" };
  }
  const which = (parsed as { answers?: { which?: unknown } } | null)?.answers?.which;
  if (typeof which !== "object" || which === null) return { failure: "invalid response" };
  const { choice, confidence } = which as { choice?: unknown; confidence?: unknown };
  if (typeof choice !== "string" || !allowed.has(choice)) return { failure: "invalid response" };
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return { failure: "invalid response" };
  if (choice === "none" || confidence < threshold) return { confidence };
  return { choice, confidence };
}

export type JevSkillHint = {
  hintFor(sessionID: string, promptText: string): Promise<JevSkillHintPart | undefined>;
  /** True exactly once per session: on its first eligible turn while both switches are on. */
  claimAwareness(sessionID: string, promptText: string): boolean;
  forget(sessionID: string): void;
};

export function createJevSkillHint(options: JevSkillHintOptions = {}): JevSkillHint {
  const env = options.env ?? process.env;
  const fetchImpl: JevFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const sessions = new Map<string, { calls: number; noted: boolean; announced: boolean }>();

  async function trace(record: Record<string, unknown>): Promise<void> {
    if (env[`${jevFlag}_TRACE`] !== "1" || options.traceFile === undefined) return;
    try {
      await fs.mkdir(path.dirname(options.traceFile), { recursive: true });
      // Refuse a symlink or other non-file at the trace path; O_NOFOLLOW closes the lstat race.
      const existing = await fs.lstat(options.traceFile).catch(() => undefined);
      if (existing !== undefined && !existing.isFile()) return;
      const flags = fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | (fsConstants.O_NOFOLLOW ?? 0);
      const handle = await fs.open(options.traceFile, flags, 0o600);
      try {
        await handle.appendFile(`${JSON.stringify(record)}\n`, "utf8");
      } finally {
        await handle.close();
      }
    } catch { // no-excuse-ok: catch -- the opt-in debug trace must never affect the turn.
    }
  }

  async function ask(state: string, key: string): Promise<JevOutcome> {
    const catalog = options.catalog ?? defaultJevCatalog();
    const model = (env[`${jevFlag}_MODEL`] ?? "").trim() || defaultModel;
    const body = buildJevRequestBody(state, catalog, model);
    if (Buffer.byteLength(body, "utf8") > bodyByteCap) return { failure: "request too large" };
    const timeoutMs = boundedInteger(env[`${jevFlag}_TIMEOUT_MS`], defaultTimeoutMs, 1, maxTimeoutMs);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<JevOutcome>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ failure: "timeout" });
      }, timeoutMs);
    });
    const request = (async (): Promise<JevOutcome> => {
      let response: Response;
      try {
        response = await fetchImpl(jevEndpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body,
          redirect: "error",
          signal: controller.signal
        });
      } catch {
        return { failure: controller.signal.aborted ? "timeout" : "network" };
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        return { httpStatus: response.status, failure: `HTTP ${response.status}` };
      }
      let raw: string | undefined;
      try {
        raw = await readCappedBody(response);
      } catch {
        return { httpStatus: 200, failure: controller.signal.aborted ? "timeout" : "network" };
      }
      if (raw === undefined) return { httpStatus: 200, failure: "response too large" };
      const allowed = new Set([...catalog.map((entry) => entry.id), "none"]);
      return { httpStatus: 200, ...validatedAnswer(raw, allowed, minConfidence(env[`${jevFlag}_MIN_CONFIDENCE`])) };
    })();
    try {
      return await Promise.race([request, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    forget(sessionID) {
      sessions.delete(sessionID);
    },
    claimAwareness(sessionID, promptText) {
      if (jevSkillHintStatus(env) !== "on" || !isJevEligiblePrompt(promptText)) return false;
      const session = sessions.get(sessionID) ?? { calls: 0, noted: false, announced: false };
      sessions.set(sessionID, session);
      if (session.announced) return false;
      session.announced = true;
      return true;
    },
    async hintFor(sessionID, promptText) {
      if (jevSkillHintStatus(env) !== "on" || !isJevEligiblePrompt(promptText)) return undefined;
      const key = (env.TYPESAFE_API_KEY ?? "").trim();
      const session = sessions.get(sessionID) ?? { calls: 0, noted: false, announced: false };
      sessions.set(sessionID, session);
      const started = now();
      // A key pasted into the prompt is masked even when it is too short for a token shape.
      const state = redactJevPrompt(promptText.split(key).join("[secret]"));
      let outcome: JevOutcome;
      if (session.calls >= boundedInteger(env[`${jevFlag}_MAX_CALLS`], defaultMaxCalls, 0, Number.MAX_SAFE_INTEGER)) {
        outcome = { failure: "call cap reached" };
      } else {
        session.calls += 1;
        try {
          outcome = await ask(state, key);
        } catch {
          outcome = { failure: "network" };
        }
      }
      const latencyMs = now() - started;
      await trace({
        time: new Date(started).toISOString(),
        promptSha256: createHash("sha256").update(state).digest("hex"),
        choice: outcome.choice ?? null,
        confidence: outcome.confidence ?? null,
        latencyMs,
        httpStatus: outcome.httpStatus ?? null,
        fallback: outcome.failure ?? null
      });
      if (outcome.choice !== undefined) {
        return { kind: "hint", text: jevSkillHintText(outcome.choice), skillId: outcome.choice, latencyMs };
      }
      if (outcome.failure === undefined || session.noted) return undefined;
      session.noted = true;
      return { kind: "note", text: jevSkillHintUnavailableText(outcome.failure) };
    }
  };
}
