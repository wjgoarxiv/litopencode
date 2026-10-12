// Skill chips for the band: which LitOpenCode skills fired in a session. Everything is read from what
// OpenCode already stores: the built-in `skill` tool's calls, this plugin's own tool calls, and the
// `metadata.litopencode` marks on user parts for bare `lit` routing and slash commands.
import { litOpenCodeRuntimeSkills, litOpenCodeStaticOnlySkills } from "../skills.ts";
import { seg, motionTiming } from "./mission-motion.ts";
import { readLitMark } from "./mission-model.ts";

export type SkillUse = { readonly name: string; readonly at: number };
export type SkillChip = { readonly name: string; readonly current: boolean };

const ownSkills: ReadonlySet<string> = new Set([...litOpenCodeRuntimeSkills, ...litOpenCodeStaticOnlySkills].map((skill) => skill.id));

// LitOpenCode's own tools, by the chip each one shows. The `lit` tool activates lit-loop.
const ownTools: Readonly<Record<string, string>> = { lit: "lit-loop", litwork: "litwork", "start-work": "start-work", "review-work": "review-work", wikify: "wikify" };

const recentLimit = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One part as a skill use, or undefined. `at` is the owning message's time, used when the part
 * carries no start time of its own. A failed call or a status read is not a firing.
 */
export function readSkillUse(part: unknown, at: number): SkillUse | undefined {
  if (!isRecord(part)) return undefined;
  if (part.type === "tool" && typeof part.tool === "string" && isRecord(part.state)) {
    const state = part.state;
    if (state.status === "error") return undefined;
    const input = isRecord(state.input) ? state.input : {};
    const start = isRecord(state.time) && typeof state.time.start === "number" ? state.time.start : at;
    if (part.tool === "skill") {
      return typeof input.name === "string" && ownSkills.has(input.name) ? { name: input.name, at: start } : undefined;
    }
    const name = ownTools[part.tool];
    if (name === undefined || input.action === "status") return undefined;
    return { name, at: start };
  }
  const mark = readLitMark(part.metadata, at);
  if (mark === undefined) return undefined;
  const name = mark.mode !== undefined && mark.mode !== "bounded-authority-lifecycle" ? mark.command ?? mark.mode : mark.command;
  return name === undefined ? undefined : { name, at };
}

/**
 * The chips to draw: skills fired since `since` (the latest user message) are current while the
 * session is busy, in the order they arrived; every other name is recent, newest first.
 */
export function skillChips(uses: readonly SkillUse[], turn: { readonly since: number | undefined; readonly busy: boolean }): SkillChip[] {
  const ordered = [...uses].sort((left, right) => left.at - right.at);
  const last = new Map<string, number>();
  const current: string[] = [];
  for (const use of ordered) {
    last.set(use.name, use.at);
    if (turn.busy && turn.since !== undefined && use.at >= turn.since && !current.includes(use.name)) current.push(use.name);
  }
  const recent = [...last.entries()]
    .filter(([name]) => !current.includes(name))
    .sort((left, right) => right[1] - left[1])
    .slice(0, recentLimit)
    .map(([name]) => ({ name, current: false }));
  return [...current.map((name) => ({ name, current: true })), ...recent];
}

export type ChipMotion = { readonly at?: number; readonly arrivals: readonly string[] };

export const idleChipMotion: ChipMotion = Object.freeze({ arrivals: Object.freeze([]) });

/**
 * Starts a shimmer over chips that just became current. On the first look at a session only current
 * chips shimmer, since they belong to the running request; recent ones, the same chips again, or
 * motion turned off leave the state as it is.
 */
export function planChipMotion(prev: readonly SkillChip[] | undefined, next: readonly SkillChip[], now: number, state: ChipMotion, enabled = true): ChipMotion {
  if (!enabled) return state;
  const arrivals = next.filter((chip) => chip.current && !(prev ?? []).some((before) => before.name === chip.name && before.current)).map((chip) => chip.name);
  return arrivals.length === 0 ? state : { at: now, arrivals };
}

export type ChipShimmer = { readonly names: readonly string[]; readonly sweep: number };

/** The light sweep over arriving chips at `now`: its centre runs from just before to just past each chip. */
export function chipShimmer(state: ChipMotion, now: number): ChipShimmer | undefined {
  if (state.at === undefined || state.arrivals.length === 0) return undefined;
  const t = now - state.at;
  if (t < 0 || t > motionTiming.shimmer) return undefined;
  return { names: state.arrivals, sweep: -0.2 + 1.4 * seg(t, 0, motionTiming.shimmer) };
}
