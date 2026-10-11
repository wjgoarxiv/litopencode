// The band: one full-width ribbon row in OpenCode's app_bottom slot that carries the lit mission on
// the main screen, plus an opt-in card. It reuses the chip's pills, the panel's bar and the shared
// motion frame, so the chip, the panel and the band always move together.
import { mixHex, motionTiming, type MotionFrame } from "./mission-motion.ts";
import type { MissionView } from "./mission-model.ts";
import {
  cellWidth,
  chipGroups,
  chipSparkCells,
  chipSparkWidth,
  groupsWidth,
  lineWidth,
  missionPanel,
  progressBar,
  shimmerAt,
  statusSegments,
  truncateCells,
  type ChipTier,
  type Line,
  type MissionPalette,
  type Segment
} from "./mission-text.ts";

export type BandOptions = { readonly enabled: boolean; readonly card: boolean };

/**
 * Reads the band switches from the plugin's tui.json options: `band: false` turns the band off,
 * `band: { card: true }` adds the card under the ribbon. Anything else keeps the defaults.
 */
export function readBandOptions(options: unknown): BandOptions {
  const band = typeof options === "object" && options !== null ? (options as Record<string, unknown>).band : undefined;
  if (band === false) return { enabled: false, card: false };
  const card = typeof band === "object" && band !== null && (band as Record<string, unknown>).card === true;
  return { enabled: true, card };
}

type RibbonPlan = { readonly tier: ChipTier; readonly bar: number; readonly text: boolean; readonly time: boolean };

// Shedding order as the row narrows: step labels first, then the next-task text, then bar width,
// then the time. Each plan is tried in turn and the first that fits wins.
const plans: readonly RibbonPlan[] = [
  { tier: "full", bar: 18, text: true, time: true },
  { tier: "medium", bar: 18, text: true, time: true },
  { tier: "tight", bar: 18, text: true, time: true },
  { tier: "tight", bar: 18, text: false, time: true },
  { tier: "tight", bar: 10, text: false, time: true },
  { tier: "tight", bar: 5, text: false, time: true },
  { tier: "tight", bar: 0, text: false, time: true },
  { tier: "tight", bar: 0, text: false, time: false }
];

const minimumText = 12;

function elapsedText(minutes: number | undefined): string {
  const total = Math.max(0, minutes ?? 0);
  return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")}`;
}

/** The text after the bar: a warning (⚑ and words) replaces the next task; a finished mission shows COMPLETE. */
function trailing(view: MissionView, frame: MotionFrame, palette: MissionPalette, room: number): Segment[] {
  if (view.complete) {
    // Before COMPLETE pops in, the slot stays empty rather than flashing the header's "● active".
    if (frame.celebrate !== undefined && frame.celebrate < motionTiming.popAt) return [];
    const status = statusSegments(view, frame, palette);
    const lead = Math.max(1, 2 + status.offset);
    return [{ text: " ".repeat(lead), fg: palette.muted }, ...status.segments];
  }
  const warning = view.warnings[0];
  if (warning !== undefined) {
    const color = warning.kind === "retry" ? mixHex(palette.warning, palette.error, 0.5) : palette.warning;
    return [{ text: "  ⚑ ", fg: color, bold: true }, { text: truncateCells(warning.text, room - 4), fg: color }];
  }
  if (view.next === undefined) return [];
  return [{ text: "  ▸ ", fg: palette.muted }, { text: truncateCells(view.next, room - 4), fg: palette.text }];
}

/**
 * One ribbon row exactly `width` cells wide: pills, bar, the next task or a warning, and the elapsed
 * time, shedding parts in a fixed order so it never wraps. Idle sessions draw nothing.
 */
export function bandRibbon(view: MissionView, frame: MotionFrame, palette: MissionPalette, width: number, place: { readonly inLane: boolean }): Line {
  if (!view.active || width <= 0) return [];
  const time: Segment = { text: `⟳ ${elapsedText(view.elapsedMinutes)}${place.inLane ? " · in lane" : ""}`, fg: palette.muted };
  const sweep = shimmerAt(frame);
  for (const plan of plans) {
    const pills = chipGroups(view, frame, palette, plan.tier, false).flat();
    const bar: Segment[] = plan.bar > 0 && view.progress !== undefined ? [{ text: "  ", fg: palette.muted }, ...progressBar(frame.barRatio, plan.bar, palette, sweep)] : [];
    const timeWidth = plan.time ? cellWidth(time.text) + 1 : 0;
    const fixed = lineWidth(pills) + lineWidth(bar) + timeWidth;
    if (fixed > width) continue;
    const room = width - fixed;
    const after = trailing(view, frame, palette, room);
    const keepText = plan.text && after.length > 0 && (view.complete ? lineWidth(after) <= room : room >= minimumText);
    if (plan.text && after.length > 0 && !keepText) continue;
    const body: Segment[] = [...pills, ...bar, ...(keepText ? after : [])];
    let used = lineWidth(body) + timeWidth;
    const sparks = frame.celebrate !== undefined && used + chipSparkWidth <= width ? chipSparkCells(frame.celebrate, palette) : undefined;
    if (sparks !== undefined) used += chipSparkWidth;
    const gap = width - used + (plan.time ? 1 : 0);
    // Sparks sit after the text, in the free space, so the pills never shift while they play.
    return [...body, ...(sparks ?? []), { text: " ".repeat(Math.max(plan.time ? 1 : 0, gap)), fg: palette.muted }, ...(plan.time ? [time] : [])];
  }
  return [];
}

export type BandCard = { readonly title: string; readonly border: string; readonly rows: readonly Line[] };

const cardRows = 4;

/**
 * The opt-in card under the ribbon. It keeps a fixed four rows whenever a goal exists, warnings
 * first, so turning a warning on or off never moves the prompt.
 */
export function bandCard(view: MissionView, frame: MotionFrame, palette: MissionPalette, width: number): BandCard | undefined {
  if (!view.active || (view.goal === undefined && view.warnings.length === 0)) return undefined;
  const panel = missionPanel(view, frame, palette);
  if (panel === undefined) return undefined;
  const inner = Math.max(8, width - 4);
  const rows: Line[] = [];
  for (const warning of view.warnings.slice(0, 2)) {
    rows.push([{ text: "⚑ ", fg: palette.warning, bold: true }, { text: truncateCells(warning.text, inner - 2), fg: palette.warning }]);
  }
  if (view.next !== undefined && !view.complete) rows.push([{ text: "next  ", fg: palette.muted }, { text: truncateCells(`▸ ${view.next}`, inner - 6), fg: palette.text }]);
  if (view.goal !== undefined) {
    const criteria = view.goal.criteria.map((criterion) => `${criterion.status === "pass" ? "✓" : criterion.status === "fail" ? "✗" : "○"}${criterion.id}`).join(" ");
    const title = truncateCells(view.goal.title, Math.max(4, inner - 8 - cellWidth(criteria)));
    rows.push([
      { text: "goal  ", fg: palette.muted },
      { text: title, fg: palette.text, bold: true },
      { text: "  ", fg: palette.muted },
      { text: truncateCells(criteria, Math.max(0, inner - 8 - cellWidth(title))), fg: palette.muted }
    ]);
  }
  while (rows.length < cardRows) rows.push([]);
  return { title: panel.title, border: panel.border, rows: rows.slice(0, cardRows) };
}
