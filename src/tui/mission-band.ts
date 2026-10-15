// The band: a status card in OpenCode's full-width app_bottom slot that stays on screen for the
// whole session, plus an opt-in detail card. Its border carries the LIT mark, the discipline and the
// phase; row one is the phase track, row two the skill chips, and the bottom border the live figures.
// It reuses the chip's pills, the panel's bar and the shared motion frame, so the chip, the panel and
// the band always move together.
import { ease, mixHex, motionTiming, seg, type MotionFrame } from "./mission-motion.ts";
import { contextWarnPercent, currentStepIndex, missionStatus, stepName, type MissionView } from "./mission-model.ts";
import type { ChipShimmer, SkillChip } from "./mission-skills.ts";
import {
  cellWidth,
  chipSparkCells,
  chipSparkWidth,
  crumb,
  fade,
  lineWidth,
  linkColor,
  liveSegments,
  missionPanel,
  progressBar,
  shimmerAt,
  shine,
  stageFlash,
  statusSegments,
  truncateCells,
  type LastMission,
  type Line,
  type MissionPalette,
  type Segment
} from "./mission-text.ts";

export type BandOptions = { readonly enabled: boolean; readonly card: boolean };

/**
 * Reads the band switches from the plugin's tui.json options: `band: false` turns the band off,
 * `band: { card: true }` adds the detail card under the status card. Anything else keeps the defaults.
 */
export function readBandOptions(options: unknown): BandOptions {
  const band = typeof options === "object" && options !== null ? (options as Record<string, unknown>).band : undefined;
  if (band === false) return { enabled: false, card: false };
  const card = typeof band === "object" && band !== null && (band as Record<string, unknown>).card === true;
  return { enabled: true, card };
}

export type NotifyOptions = { readonly enabled: boolean; readonly desktop: boolean; readonly sound: boolean };

/**
 * Reads the finish alert switch from the plugin's tui.json options. It is off unless `notify` is true
 * (desktop notification and the host's `done` sound) or an object that turns either part off with
 * `desktop: false` or `sound: false`.
 */
export function readNotifyOptions(options: unknown): NotifyOptions {
  const notify = typeof options === "object" && options !== null ? (options as Record<string, unknown>).notify : undefined;
  if (notify === true) return { enabled: true, desktop: true, sound: true };
  if (typeof notify !== "object" || notify === null) return { enabled: false, desktop: false, sound: false };
  const record = notify as Record<string, unknown>;
  const desktop = record.desktop !== false;
  const sound = record.sound !== false;
  return { enabled: desktop || sound, desktop, sound };
}

const minimumText = 12;

function elapsedText(minutes: number | undefined): string {
  const total = Math.max(0, minutes ?? 0);
  return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")}`;
}

/**
 * The text after the bar: a warning (⚑ and words) replaces the live step and the next task; a finished
 * mission shows COMPLETE. Otherwise the live step, then the next task when it still has room.
 */
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
  const live = liveSegments(view, frame, palette, Math.min(28, room - 2));
  const lead: Segment[] = live.length === 0 ? [] : [{ text: "  ", fg: palette.muted }, ...live];
  const left = room - lineWidth(lead);
  if (view.next === undefined || left < minimumText) return lead;
  return [...lead, { text: "  ▸ ", fg: palette.muted }, { text: truncateCells(view.next, left - 4), fg: palette.text }];
}

/** Cuts or pads a line to exactly `width` cells, keeping wide glyphs whole. */
function fitLine(line: Line, width: number, palette: MissionPalette): Segment[] {
  const out: Segment[] = [];
  let used = 0;
  for (const segment of line) {
    const room = width - used;
    if (room <= 0) break;
    if (cellWidth(segment.text) <= room) {
      out.push(segment);
      used += cellWidth(segment.text);
      continue;
    }
    let text = "";
    let taken = 0;
    for (const char of segment.text) {
      const w = cellWidth(char);
      if (taken + w > room) break;
      text += char;
      taken += w;
    }
    if (text !== "") out.push({ ...segment, text });
    used += taken;
    break;
  }
  if (used < width) out.push({ text: " ".repeat(width - used), fg: palette.muted });
  return out;
}

/** A border row: corner, optional left label, rule, optional right label, corner; undefined when it does not fit. */
function ruled(lead: string, left: Line, right: Line, tail: string, width: number, border: string): Segment[] | undefined {
  const space: Segment = { text: " ", fg: border };
  const l = left.length > 0 ? [space, ...left, space] : [];
  const r = right.length > 0 ? [space, ...right, space] : [];
  const fill = width - cellWidth(lead) - lineWidth(l) - lineWidth(r) - cellWidth(tail);
  if (fill < 1) return undefined;
  return [{ text: lead, fg: border }, ...l, { text: "─".repeat(fill), fg: border }, ...r, { text: tail, fg: border }];
}

/**
 * A lit session whose turn has ended rests: nothing is running, so the card stops showing a lit step.
 * A finished goal and an open warning still show, since they are news after the turn.
 */
function resting(view: MissionView, busy: boolean | undefined): boolean {
  return view.active && busy === false && !view.complete && view.warnings.length === 0;
}

function borderColor(view: MissionView, frame: MotionFrame, palette: MissionPalette, rest: boolean): string {
  if (!view.active || rest) return palette.borderActive;
  const enter = frame.chipEnter ? ease.outCubic(seg(frame.t, 0, motionTiming.entry)) : 1;
  const done = view.complete ? (frame.celebrate === undefined ? 1 : ease.inOutCubic(seg(frame.celebrate, 0, motionTiming.crossfade))) : 0;
  return mixHex(palette.borderActive, mixHex(mixHex(palette.accent, palette.warning, frame.warn), palette.success, done), enter);
}

/** The phase on the right of the title: always a glyph plus words. */
function phaseLabel(view: MissionView, frame: MotionFrame, palette: MissionPalette, rest: boolean): Segment {
  if (!view.active || rest) return { text: "○ IDLE", fg: palette.muted };
  const status = missionStatus(view);
  if (status.tone === "success") return { text: "✓ COMPLETE", fg: palette.success, bold: true };
  if (status.tone === "warning") return { text: `⚑ ${status.text}`, fg: mixHex(palette.info, palette.warning, Math.max(frame.warn, 0.5)), bold: true };
  return { text: `● ${stepName(view.phase, view).toUpperCase()}`, fg: palette.info, bold: true };
}

function topLine(view: MissionView, frame: MotionFrame, palette: MissionPalette, width: number, border: string, rest: boolean): Line {
  const brand: Segment[] = [{ text: "🔥 ", fg: palette.text }, { text: "LIT", fg: shine(palette.secondary, palette, 0.5, shimmerAt(frame), 0.6), bold: true }];
  const name = view.active ? view.discipline : "ready";
  const right = [phaseLabel(view, frame, palette, rest)];
  const withName = (room: number): Segment[] => [...brand, { text: " · ", fg: palette.muted }, { text: truncateCells(name, room), fg: view.active ? palette.text : palette.muted }];
  const nameRoom = width - cellWidth("╭─") - lineWidth(withName(0)) - 2 - (lineWidth(right) + 2) - cellWidth("─╮") - 1;
  const attempts: [Line, Line][] = [];
  if (nameRoom >= Math.min(4, cellWidth(name))) attempts.push([withName(nameRoom), right]);
  attempts.push([brand, right], [brand, []]);
  for (const [left, label] of attempts) {
    const line = ruled("╭─", left, label, "─╮", width, border);
    if (line !== undefined) return line;
  }
  return fitLine([{ text: "╭" + "─".repeat(Math.max(0, width)), fg: border }], width, palette);
}

/** The figures in the bottom border, most important first; the last ones go first when room runs out. */
function figureParts(view: MissionView, figures: CardFigures, palette: MissionPalette): Segment[] {
  const parts: Segment[] = [];
  if (figures.contextPercent !== null) {
    const percent = Math.round(figures.contextPercent);
    parts.push({ text: `ctx ${percent}%`, fg: percent >= contextWarnPercent ? palette.warning : palette.muted });
  }
  if (view.active) parts.push({ text: `⟳ ${elapsedText(view.elapsedMinutes)}${figures.inLane ? " · in lane" : ""}`, fg: palette.muted });
  if (figures.branch !== undefined) parts.push({ text: `⎇ ${truncateCells(figures.branch, 24)}`, fg: palette.muted });
  return parts;
}

function bottomLine(view: MissionView, figures: CardFigures, palette: MissionPalette, width: number, border: string): Line {
  const parts = figureParts(view, figures, palette);
  for (let count = parts.length; count >= 0; count -= 1) {
    const right: Segment[] = [];
    parts.slice(0, count).forEach((part, index) => right.push(...(index === 0 ? [] : [{ text: " · ", fg: palette.muted }]), part));
    const line = ruled("╰", [], right, "─╯", width, border);
    if (line !== undefined) return line;
  }
  return fitLine([{ text: "╰" + "─".repeat(Math.max(0, width)), fg: border }], width, palette);
}

/** The whole stage map as a breadcrumb, `plan ✓ ━ WORK 1/3 ─ review ─ done`, or only the running stage when tight. */
function trackPills(view: MissionView, frame: MotionFrame, palette: MissionPalette, tight: boolean): Segment[] {
  const alpha = (index: number): number => (frame.chipEnter ? ease.outCubic(seg(frame.t, index * motionTiming.stagger, motionTiming.entry)) : 1);
  const reached = currentStepIndex(view);
  const current = Math.min(view.steps.length - 1, Math.max(0, reached));
  const flash = stageFlash(frame);
  if (tight) return crumb(view, current, frame, palette, 0, flash).map((segment) => fade(segment, alpha(0), palette));
  const out: Segment[] = [];
  view.steps.forEach((_step, index) => {
    if (index > 0) {
      const color = linkColor(view, index, frame, palette, palette.borderSubtle);
      out.push(fade({ text: color === palette.borderSubtle ? " ─ " : " ━ ", fg: color }, alpha(index), palette));
    }
    for (const segment of crumb(view, index, frame, palette, 0, index === current && reached >= 0 ? flash : -1)) out.push(fade(segment, alpha(index), palette));
  });
  return out;
}

/** The text after the track in an idle session: the project's last goal, or how to start. */
function idleText(last: LastMission | undefined, palette: MissionPalette, room: number): Segment[] {
  if (last === undefined || last.title === "") return [{ text: "  ", fg: palette.muted }, { text: truncateCells("add lit to a prompt to start", room - 2), fg: palette.muted }];
  const mark: Segment = last.complete ? { text: ` ✓ ${last.passed}/${last.total}`, fg: palette.success } : { text: ` ● ${last.passed}/${last.total}`, fg: palette.info };
  const head: Segment = { text: "  last: ", fg: palette.muted };
  return [head, { text: truncateCells(last.title, room - cellWidth(head.text) - cellWidth(mark.text)), fg: palette.text }, mark];
}

type TrackPlan = { readonly tight: boolean; readonly bar: number; readonly criteria: boolean; readonly text: boolean };

// Shedding order as the row narrows: the next-task text, bar width, the bar, the criteria count and
// then the step labels. Each plan is tried in turn and the first that fits wins.
const trackPlans: readonly TrackPlan[] = [
  { tight: false, bar: 16, criteria: true, text: true },
  { tight: false, bar: 16, criteria: true, text: false },
  { tight: false, bar: 8, criteria: true, text: false },
  { tight: false, bar: 0, criteria: true, text: false },
  { tight: false, bar: 0, criteria: false, text: false },
  { tight: true, bar: 0, criteria: false, text: false }
];

function trackRow(view: MissionView, frame: MotionFrame, palette: MissionPalette, width: number, last: LastMission | undefined): Line {
  const sweep = shimmerAt(frame);
  const gap: Segment = { text: "  ", fg: palette.muted };
  for (const plan of trackPlans) {
    const pills = trackPills(view, frame, palette, plan.tight);
    const bar = plan.bar > 0 && view.progress !== undefined ? [gap, ...progressBar(frame.barRatio, plan.bar, palette, sweep)] : [];
    // In the criterion loop the stage itself counts criteria, so the count is not repeated.
    const goal = view.family === "loop" ? undefined : view.goal;
    const criteria: Segment[] = plan.criteria && goal !== undefined ? [gap, { text: `${goal.passed}/${goal.total} criteria`, fg: goal.total > 0 && goal.passed === goal.total ? palette.success : palette.muted }] : [];
    const fixed = lineWidth(pills) + lineWidth(bar) + lineWidth(criteria);
    if (fixed > width) continue;
    const room = width - fixed;
    const after = plan.text ? (view.active ? trailing(view, frame, palette, room) : idleText(last, palette, room)) : [];
    const keepText = plan.text && after.length > 0 && (view.complete ? lineWidth(after) <= room : room >= minimumText);
    if (plan.text && after.length > 0 && !keepText) continue;
    const body: Segment[] = [...pills, ...bar, ...criteria, ...(keepText ? after : [])];
    // Sparks sit after the text, in the free space, so the pills never shift while they play.
    const sparks = frame.celebrate !== undefined && lineWidth(body) + chipSparkWidth <= width ? chipSparkCells(frame.celebrate, palette) ?? [] : [];
    return fitLine([...body, ...sparks], width, palette);
  }
  return fitLine(trackPills(view, frame, palette, true), width, palette);
}

function chipSegments(chip: SkillChip, shimmer: ChipShimmer | undefined, palette: MissionPalette): Segment[] {
  const text = ` ${chip.name} `;
  if (!chip.current) return [{ text, fg: palette.muted, ...(palette.element === undefined ? {} : { bg: palette.element }) }];
  const sweep = shimmer?.names.includes(chip.name) === true ? shimmer.sweep : -1;
  if (sweep < 0) return [{ text, fg: palette.onFill, bg: palette.fill, bold: true }];
  const chars = [...text];
  return chars.map((char, index) => ({ text: char, fg: palette.onFill, bg: shine(palette.fill, palette, index / (chars.length - 1), sweep, 0.3), bold: true }));
}

/**
 * The skill chips row, exactly `width` cells: bright LIT accent pills for the current request first, then
 * dim recent names, and `+N` for the ones that do not fit. The label goes before any chip does.
 */
export function skillRow(chips: readonly SkillChip[], shimmer: ChipShimmer | undefined, palette: MissionPalette, width: number): Line {
  const label: Segment = { text: "skills ", fg: palette.muted };
  if (chips.length === 0) return fitLine([label, { text: " none yet", fg: palette.muted }], width, palette);
  const pills = chips.map((chip) => chipSegments(chip, shimmer, palette));
  const space: Segment = { text: " ", fg: palette.muted };
  for (const lead of [[label], []] as const) {
    const all = lineWidth(lead) + pills.reduce((total, pill, index) => total + lineWidth(pill) + (index === 0 ? 0 : 1), 0);
    let shown = pills.length;
    if (all > width) {
      let used = lineWidth(lead);
      shown = 0;
      for (const pill of pills) {
        const next = used + (shown === 0 ? 0 : 1) + lineWidth(pill);
        if (next + cellWidth(` +${pills.length - shown - 1}`) > width) break;
        used = next;
        shown += 1;
      }
    }
    if (shown === 0 && lead.length > 0) continue;
    const out: Segment[] = [...lead];
    pills.slice(0, shown).forEach((pill, index) => out.push(...(index === 0 ? [] : [space]), ...pill));
    if (shown < pills.length) out.push({ text: `${shown === 0 ? "" : " "}+${pills.length - shown}`, fg: palette.muted });
    return fitLine(out, width, palette);
  }
  return fitLine([{ text: `+${pills.length}`, fg: palette.muted }], width, palette);
}

export type CardFigures = { readonly contextPercent: number | null; readonly branch?: string; readonly inLane: boolean };

export type CardInputs = {
  readonly view: MissionView;
  readonly frame: MotionFrame;
  readonly chips: readonly SkillChip[];
  /** Whether the session's turn is running; false lets a lit card rest at idle. Unknown keeps it working. */
  readonly busy?: boolean;
  readonly shimmer?: ChipShimmer;
  readonly figures: CardFigures;
  /** The project's last goal, shown on the track while the session has no lit mission. */
  readonly last?: LastMission;
};

/**
 * The status card: four rows of exactly `width` cells whether the session is idle or working, so
 * the prompt never moves. Each row sheds its own low-priority parts as the terminal narrows.
 */
export function statusCard(input: CardInputs, palette: MissionPalette, width: number): Line[] {
  const { frame } = input;
  const rest = resting(input.view, input.busy);
  // At rest the track keeps what is done and unlights the step that was running.
  const view: MissionView = rest ? { ...input.view, steps: input.view.steps.map((step) => (step.state === "now" ? { ...step, state: "todo" } : step)) } : input.view;
  const border = borderColor(view, frame, palette, rest);
  const inner = width - 4;
  const row = (content: Line): Line => (inner < 0 ? fitLine([], width, palette) : [{ text: "│ ", fg: border }, ...fitLine(content, inner, palette), { text: " │", fg: border }]);
  return [
    topLine(view, frame, palette, width, border, rest),
    row(trackRow(view, frame, palette, Math.max(0, inner), input.last)),
    row(skillRow(input.chips, input.shimmer, palette, Math.max(0, inner))),
    bottomLine(view, input.figures, palette, width, border)
  ];
}

export type BandCard = { readonly title: string; readonly border: string; readonly rows: readonly Line[] };

const cardRows = 4;

/**
 * The opt-in detail card under the status card. It keeps a fixed four rows whenever a goal exists, warnings
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
