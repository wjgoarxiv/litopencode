// Thread rows for the band: the lanes of work that run beside the session's own mission. A lane is a
// frame on this session's workflow stack (a paused spine under an interjected command), a `task` tool
// call that runs a subagent, or another session in the same workspace whose stack moved lately. The
// module is pure: sources go in, rows and drawn lines come out.
//
// A gauge needs a real total. Without one a row says what is known in words (how long it has run, which
// step it is on) and, while it is working, plays a small pulse; it never shows a question mark.
import { cellWidth, lineWidth, truncateCells, type Line, type MissionPalette, type Segment } from "./mission-text.ts";

export type ThreadStatus = "working" | "paused" | "done" | "failed" | "idle";

export type ThreadSource = {
  readonly kind: "stack" | "task" | "session";
  readonly name: string;
  readonly status: ThreadStatus;
  /** Both counts or neither. */
  readonly done?: number;
  readonly total?: number;
  /** A word for what is known, such as the stage a frame is on. */
  readonly phase?: string;
  /** When the lane started, for the elapsed time of a task. */
  readonly startedAt?: number;
  /** When the lane last moved; an old one reads as idle. */
  readonly touchedAt?: number;
  /** When a done lane finished; it leaves the card a minute later. */
  readonly doneAt?: number;
  /** The status came from the session's liveness record, so the five-minute idle guess does not apply. */
  readonly settled?: boolean;
};

export type ThreadRow = {
  readonly key: string;
  readonly name: string;
  readonly status: ThreadStatus;
  readonly done?: number;
  readonly total?: number;
  readonly facts: string;
};

export const threadRowCap = 4;
/** A lane untouched for this long is shown as idle rather than working. */
export const idleAfterMs = 5 * 60_000;
/** A finished lane stays this long, so a glance still catches it, then leaves. */
export const doneLingerMs = 60_000;
const sessionRank: Readonly<Record<ThreadStatus, number>> = { working: 0, paused: 1, done: 2, failed: 2, idle: 3 };
const pulseFrames = ["▓▒░░░", "░▓▒░░", "░░▓▒░", "░░░▓▒", "░░▒▓░", "░▒▓░░"] as const;
const steadyPulse = "░▒▓▒░";
const pulseMs = 250;
const statusWordCells = 7;

export function isRealCount(done: unknown, total: unknown): done is number {
  return Number.isInteger(done) && Number.isInteger(total) && (total as number) > 0 && (done as number) >= 0 && (done as number) <= (total as number);
}

function minutes(from: number | undefined, now: number): string | undefined {
  if (from === undefined || !Number.isFinite(from) || from > now) return undefined;
  const total = Math.floor((now - from) / 60_000);
  return total < 1 ? "<1m" : total < 60 ? `${total}m` : `${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")}`;
}

function factsFor(source: ThreadSource, status: ThreadStatus, now: number): string {
  const parts: string[] = [];
  if (source.phase !== undefined && source.phase !== "") parts.push(source.phase);
  const elapsed = minutes(source.startedAt ?? (status === "working" ? source.touchedAt : undefined), now);
  if (elapsed !== undefined && status === "working") parts.push(elapsed);
  if (parts.length === 0) parts.push(status === "done" ? "finished" : status === "failed" ? "stopped" : status === "paused" ? "held" : status === "idle" ? "quiet" : "started");
  return parts.join(" · ");
}

/**
 * The rows for the sources, or undefined when only one lane of the session's own work exists, which the
 * four-row card already shows; one other session is still a row. A source untouched for five minutes reads
 * as idle unless a liveness record settled it, a done lane leaves a minute after it finished, and other
 * sessions follow the session's own lanes, working first, then paused, finished and idle.
 */
export function threadsOf(sources: readonly ThreadSource[], now: number): ThreadRow[] | undefined {
  const live = sources.filter((source) => !(source.status === "done" && source.doneAt !== undefined && now - source.doneAt > doneLingerMs));
  const statusOf = (source: ThreadSource): ThreadStatus =>
    source.status === "working" && source.settled !== true && source.touchedAt !== undefined && now - source.touchedAt > idleAfterMs ? "idle" : source.status;
  const own = live.filter((source) => source.kind !== "session");
  const others = live.filter((source) => source.kind === "session").sort((left, right) => sessionRank[statusOf(left)] - sessionRank[statusOf(right)]);
  if (others.length === 0 && own.length < 2) return undefined;
  return [...own, ...others].map((source, index) => {
    const status = statusOf(source);
    return {
      key: `${source.kind}:${index}:${source.name}`,
      name: source.name,
      status,
      ...(isRealCount(source.done, source.total) ? { done: source.done, total: source.total } : {}),
      facts: factsFor(source, status, now)
    };
  });
}

/** How many card rows the threads take: the fork line, the shown lanes and the `+N more` line. */
export function threadLineCount(rows: readonly ThreadRow[] | undefined): number {
  if (rows === undefined || rows.length === 0) return 0;
  return 1 + Math.min(rows.length, threadRowCap) + (rows.length > threadRowCap ? 1 : 0);
}

/** `[▉▉▉░░░░░] 3/10` for a real total, an empty string otherwise. */
export function threadGauge(done: number | undefined, total: number | undefined, cells: number): string {
  if (!isRealCount(done, total) || cells < 1) return "";
  const full = Math.round((done / (total as number)) * cells);
  return `[${"▉".repeat(full)}${"░".repeat(cells - full)}] ${done}/${total}`;
}

/** An indeterminate pulse: five cells that scan while motion is on, one steady frame otherwise. */
export function pulseText(now: number, motion: boolean): string {
  return motion ? pulseFrames[Math.floor(now / pulseMs) % pulseFrames.length] : steadyPulse;
}

const statusWords: Readonly<Record<ThreadStatus, string>> = { working: "working", paused: "paused", done: "done", failed: "failed", idle: "idle" };

function statusColor(status: ThreadStatus, palette: MissionPalette): string {
  if (status === "working") return palette.info;
  if (status === "done") return palette.success;
  if (status === "failed") return palette.error;
  if (status === "paused") return palette.warning;
  return palette.muted;
}

export type ThreadDrawOptions = {
  readonly now: number;
  readonly motion: boolean;
  /** A colour per gauge index while the rainbow plays; the gauge keeps the palette colour otherwise. */
  readonly gaugeColor?: (index: number) => string;
};

function rowLine(row: ThreadRow, index: number, last: boolean, palette: MissionPalette, width: number, options: ThreadDrawOptions): Line {
  const branch: Segment = { text: last ? "└─ " : "├─ ", fg: palette.borderSubtle };
  const word: Segment = { text: statusWords[row.status].padEnd(statusWordCells), fg: statusColor(row.status, palette), bold: row.status === "working" };
  const gap: Segment = { text: "  ", fg: palette.muted };
  const gaugeColor = options.gaugeColor?.(index) ?? palette.accent;
  const real = threadGauge(row.done, row.total, 8);
  const trailing = (room: number): Segment[] => {
    if (real !== "" && cellWidth(real) <= room) return [{ text: real, fg: gaugeColor }];
    const facts = truncateCells(row.facts, Math.max(0, room - (row.status === "working" ? 6 : 0)));
    const pulse: Segment[] = row.status === "working" ? [{ text: ` ${pulseText(options.now, options.motion)}`, fg: gaugeColor }] : [];
    return [{ text: facts, fg: palette.muted }, ...pulse];
  };
  const fixed = lineWidth([branch, gap, word, gap]);
  const room = Math.max(0, width - fixed);
  const nameRoom = Math.max(6, Math.min(24, Math.floor(room / 2)));
  const name: Segment = { text: truncateCells(row.name, nameRoom), fg: row.status === "idle" || row.status === "done" ? palette.muted : palette.text };
  const pad: Segment = { text: " ".repeat(Math.max(0, Math.min(24, nameRoom) - cellWidth(name.text))), fg: palette.muted };
  const left = [branch, name, pad, gap, word, gap];
  return [...left, ...trailing(Math.max(0, width - lineWidth(left)))];
}

/**
 * The lines under the skill row: `┬ 3 lanes in parallel`, then one `├─`/`└─` line per lane (four at most;
 * `+N more` names the rest). Each line is fitted to `width` by the caller.
 */
export function threadLines(rows: readonly ThreadRow[], palette: MissionPalette, width: number, options: ThreadDrawOptions): Line[] {
  if (rows.length === 0) return [];
  const shown = rows.slice(0, threadRowCap);
  const more = rows.length - shown.length;
  const fork: Line = [{ text: "┬ ", fg: palette.borderSubtle }, { text: `${rows.length} ${rows.length === 1 ? "lane" : "lanes"} in parallel`, fg: palette.muted }];
  const lines: Line[] = [fork];
  shown.forEach((row, index) => lines.push(rowLine(row, index, index === shown.length - 1 && more === 0, palette, width, options)));
  if (more > 0) lines.push([{ text: "└─ ", fg: palette.borderSubtle }, { text: `+${more} more`, fg: palette.muted }]);
  return lines;
}
