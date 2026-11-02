// What OpenCode 2's prompt footer row holds besides our line, and how our line steps down to the room left.
// The row is the host's spinner and `esc interrupt` hint on the left and its token, goal and `ctrl+p commands`
// figures on the right; our line is squeezed between them, and the host clips it mid-word when it is too long.
// So the line is chosen by width: the ignition mark with the whole stage chip, the chip at a smaller size,
// the chip as `🔥 1/3`, the bare flame, then nothing. The numbers were measured on opencode2 2.2.5.
import { activationDiscipline } from "../activation-probe.ts";
import type { MissionView } from "../tui/mission-model.ts";
import type { MotionFrame } from "../tui/mission-motion.ts";
import { cellWidth, chipLine, lineWidth, type ChipTier, type Line, type MissionPalette } from "../tui/mission-text.ts";

/** The session sidebar, which a wide terminal is taken to have open (the setting is not readable by a plugin). */
export const sidebarCells = 42;
// Right of our line: with a turn running `↓ 1 shell · ◎ goal  ctrl+p commands`, idle `◎ goal paused · 42.3K (8%) · $0.07  ctrl+p commands`.
const hostRightBusy = 38;
const hostRightIdle = 54;
// Left of it, the least the host keeps: the spinner and a shortened `esc …rrupt` while running, a shortened path when idle.
const hostLeftBusy = 24;
const hostLeftIdle = 6;
const gap = 2;

export function footerBudget(input: { readonly columns: number; readonly sidebar: boolean; readonly busy: boolean }): number {
  const main = input.columns - (input.sidebar ? sidebarCells : 0);
  const host = input.busy ? hostRightBusy + hostLeftBusy : hostRightIdle + hostLeftIdle;
  return Math.max(0, main - host);
}

export type FooterInput = {
  /** The discipline the latest lit prompt started, as the server wrote it into the message. */
  readonly name: string;
  readonly view: MissionView | undefined;
  readonly frame: MotionFrame;
  readonly palette: MissionPalette;
  readonly budget: number;
};

const flameWidth = 2;

/** The footer line for `budget` cells, as segments; empty when not even the flame fits. */
export function footerStatus(input: FooterInput): Line {
  const { palette, budget } = input;
  const discipline = activationDiscipline(input.name);
  const mark = (text: string): Line => [{ text, fg: palette.primary, bold: true }];
  const full = `🔥 LIT IGNITED · ${discipline}`;
  const active = input.view !== undefined && input.view.active;
  const chipFor = (room: number, largest: ChipTier): Line => {
    if (!active || input.view === undefined || room < flameWidth) return [];
    const chip = chipLine(input.view, input.frame, palette, room, largest);
    return lineWidth(chip) <= room ? chip : [];
  };

  if (!active) {
    if (cellWidth(full) <= budget) return mark(full);
  } else {
    const beside = chipFor(budget - cellWidth(full) - gap, "full");
    if (beside.length > 0) return [...mark(full), { text: " ".repeat(gap), fg: palette.muted }, ...beside];
    // The chip is worth more than the mark's words, so it stays alone when both do not fit. Alone it never
    // grows past the middle size, so the line only gets smaller as the room does.
    const alone = chipFor(budget, "medium");
    if (alone.length > 0) return alone;
  }
  const short = `🔥 ${discipline}`;
  if (cellWidth(short) <= budget) return mark(short);
  if (budget >= flameWidth) return mark("🔥");
  return [];
}
