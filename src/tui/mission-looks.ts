// The looks the status card can wear, chosen in one place. A skill look belongs to the discipline at work
// or to a chip lit by this turn: lit-adhd and its alias lit-rewind wear the rewind look, review-work wears
// its five lanes. A state look belongs to the session: `YOUR TURN` while it waits on the user, and the
// done burst (the completion sparks of mission-motion) when a goal reaches done. Each look reads only
// records OpenCode or LitOpenCode already keep, so a lane without a report stays dim and nothing is
// guessed. Motion is slow and small: the amber breath is one hue held while its mix eases over 3 s.
import { mixHex } from "./mission-motion.ts";
import type { MissionPalette, Segment } from "./mission-text.ts";
import type { MissionView } from "./mission-model.ts";
import type { SkillChip } from "./mission-skills.ts";

export type SkillLook = "rewind" | "review";

const skillLooks: Readonly<Record<string, SkillLook>> = Object.freeze({ "lit-adhd": "rewind", "lit-rewind": "rewind", "review-work": "review" });

/** The look a skill name carries, if any. */
export function lookOfSkill(name: string): SkillLook | undefined {
  return Object.hasOwn(skillLooks, name) ? skillLooks[name] : undefined;
}

/** The skill look while a turn runs: the session's discipline first, then a chip this turn lit. */
export function activeSkillLook(view: Pick<MissionView, "active" | "discipline">, chips: readonly SkillChip[], busy: boolean | undefined): SkillLook | undefined {
  if (busy === false) return undefined;
  const own = view.active ? lookOfSkill(view.discipline) : undefined;
  if (own !== undefined) return own;
  for (const chip of chips) {
    const look = chip.current ? lookOfSkill(chip.name) : undefined;
    if (look !== undefined) return look;
  }
  return undefined;
}

/** What the session is waiting on the user for, read from records; every field is a real signal. */
export type WaitSignals = {
  /** OpenCode holds a permission request or a question for this session. */
  readonly asked: boolean;
  /** The last message is the user's: they have answered, so nothing waits on them now. */
  readonly userSpokeLast: boolean;
  /** The last reply of the turn opens with `BLOCKED:`. */
  readonly blockedReply: boolean;
  /** A typed start-work run is paused on a boundary only the user can approve. */
  readonly boundary: boolean;
};

/** True while the session waits on the user: asked now, or idle on a decision, a BLOCKED reply or a boundary. */
export function waitingOnYou(view: Pick<MissionView, "active" | "warnings">, busy: boolean | undefined, signals: WaitSignals): boolean {
  if (signals.asked) return true;
  if (signals.userSpokeLast || busy === true) return false;
  const decision = view.active && view.warnings.some((warning) => warning.kind === "decision");
  return decision || signals.blockedReply || signals.boundary;
}

export const turnBreathMs = 3000;

/** How far the amber has eased toward the border at `now`, 0 to 1; a 3 s sine, 0 under reduced motion. */
export function turnGlow(now: number, motion: boolean): number {
  if (!motion) return 0;
  return (1 - Math.cos((2 * Math.PI * (now % turnBreathMs)) / turnBreathMs)) / 2;
}

/** The amber of the waiting look: the warning colour eased at most 25 % toward the card's border. */
export function turnColor(palette: MissionPalette, glow: number): string {
  return mixHex(palette.warning, palette.borderActive, Math.min(1, Math.max(0, glow)) * 0.25);
}

export function turnMark(palette: MissionPalette, glow: number): Segment[] {
  return [{ text: "◆ YOUR TURN", fg: turnColor(palette, glow), bold: true }];
}

export const reviewLanes = ["scope", "tests", "package", "security", "surface"] as const;
export type ReviewLane = (typeof reviewLanes)[number];
export type LaneResult = "pass" | "fail" | "blocked";
export type LaneReports = Partial<Readonly<Record<ReviewLane, LaneResult>>>;

export const laneResults: readonly LaneResult[] = ["pass", "fail", "blocked"];

export function isReviewLane(value: unknown): value is ReviewLane {
  return typeof value === "string" && (reviewLanes as readonly string[]).includes(value);
}

export function isLaneResult(value: unknown): value is LaneResult {
  return typeof value === "string" && (laneResults as readonly string[]).includes(value);
}

/** One lane's colour on the border: its own hue once it reports a pass, error once it fails, dim until then. */
export function laneColor(lane: ReviewLane, reports: LaneReports, palette: MissionPalette): string {
  const result = reports[lane];
  if (result === undefined) return palette.borderSubtle;
  if (result !== "pass") return palette.error;
  const hues = [palette.primary, palette.info, palette.accent, palette.secondary, palette.success];
  return hues[reviewLanes.indexOf(lane)] ?? palette.success;
}

/** The corner label of the review look: how many of the five lanes have reported, never a guess. */
export function reviewMark(reports: LaneReports, palette: MissionPalette): Segment[] {
  const reported = reviewLanes.filter((lane) => reports[lane] !== undefined).length;
  const failed = reviewLanes.some((lane) => reports[lane] !== undefined && reports[lane] !== "pass");
  return [{ text: `◇ REVIEW ${reported}/${reviewLanes.length}`, fg: failed ? palette.error : palette.info, bold: true }];
}
