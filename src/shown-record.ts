import { createHash } from "node:crypto";
import fs from "node:fs";

// An append-only record of what LitOpenCode itself has already shown: one JSON line per notice (a hash of
// its text and the time) and one per run ending. It lives next to the state it describes, in the project's
// .litopencode folder or, for the installer's notice, in the OpenCode config root. Model prose is never
// intercepted; only text this package prints is recorded. Every failure here (missing folder, unreadable or
// corrupt file) answers "not shown" and writes nothing, which is what the product did before the record.

export type RunOutcome = "sent" | "nothing" | "waiting";

export const shownRecordName = "shown.jsonl";

export function noticeHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/gu, " ").trim()).digest("hex").slice(0, 16);
}

function entriesOf(file: string): Array<Record<string, unknown>> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const entries: Array<Record<string, unknown>> = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) entries.push(parsed as Record<string, unknown>);
    } catch { // no-excuse-ok: catch -- one damaged line must not hide the others, and never blocks a notice.
    }
  }
  return entries;
}

function append(file: string, entry: Record<string, unknown>): void {
  try {
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch { // no-excuse-ok: catch -- a record that cannot be written only means the notice may show again.
  }
}

/** True when a notice with this hash was recorded at or after `sinceMs`. */
export function noticeShown(file: string, hash: string, sinceMs = 0): boolean {
  return entriesOf(file).some((entry) => {
    if (entry.kind !== "notice" || entry.hash !== hash || typeof entry.at !== "string") return false;
    const at = Date.parse(entry.at);
    return Number.isFinite(at) && at >= sinceMs;
  });
}

export function recordNotice(file: string, hash: string, now: number = Date.now()): void {
  append(file, { kind: "notice", hash, at: new Date(now).toISOString() });
}

export function recordRunEnd(file: string, outcome: RunOutcome, workId: string, now: number = Date.now()): void {
  append(file, { kind: "run-end", outcome, workId, at: new Date(now).toISOString() });
}

/**
 * How a lifecycle write ends or pauses a run: a completed run sent its report, a cancelled one had
 * nothing to send, and a run whose parked queue just went from empty to non-empty waits on the user.
 */
export function runOutcome(eventType: string, parkedBefore: number, parkedNow: number): RunOutcome | undefined {
  if (eventType === "work.completed") return "sent";
  if (eventType === "work.cancelled" || eventType === "work.user-cancelled") return "nothing";
  if (parkedBefore === 0 && parkedNow > 0) return "waiting";
  return undefined;
}
