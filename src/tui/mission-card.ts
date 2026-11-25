// The full status card of a dark truecolor terminal: one frame whose title edge carries the brand, the discipline
// and the state, then the stage map, the task, the work that runs and the skills, with the context and the limits
// on the bottom edge and the sunset in the cells no word uses. It grows while work runs and shrinks at rest. Every
// other terminal, theme and narrow window keeps the plain card of mission-band.
import { borderColor, elapsedText, fitLine, idleHint, idleText, laneRule, limitWarnPercent, resting, ruled, skillRow, statusCard, type CardFigures, type CardInputs } from "./mission-band.ts";
import { laneColor, reviewLanes, reviewMark, turnColor, turnMark, type LaneReports } from "./mission-looks.ts";
import { contextWarnPercent, currentStepIndex, missionStatus, stepName, type MissionView, type StepState } from "./mission-model.ts";
import { mixHex, motionTiming, type MotionFrame } from "./mission-motion.ts";
import { rainbowColor, rainbowPill, rewindMark, type Rainbow } from "./mission-rainbow.ts";
import { neonAt, neonRow, paintSky, sceneBreath, stageFrom, sunColumn, sunsetBrand } from "./mission-sunset.ts";
import { rail, type ThreadRow, type ThreadStatus } from "./mission-threads.ts";
import { cellWidth, chipSparkCells, chipSparkWidth, gauge, gradientAt, lineWidth, linkColor, liveSegments, roundPills, shimmerAt, shine, stageColor, stageFlash, statusSegments, synthwavePill, truncateCells, type LastMission, type Line, type MissionPalette, type Segment } from "./mission-text.ts";

/** Below this width the plain card reads better. */
export const fullCardMinimum = 72;
/** Rows between the task and the skills: the running job, the fork and its lanes. */
const workRows = 4;
const laneMax = 3;
/** Rows under the task line that let the sun stand whole, and the window height that can spare a blank one. */
const sunRoom = 3;
const tallWindow = 24;
const gaugeCells = 8;
const laneGaugeCells = 6;

const at = (segments: Line): number => lineWidth(segments);
const plainText = (text: string, fg: string, bold = false): Segment => (bold ? { text, fg, bold } : { text, fg });

/** A row with its words on the left and its live figures against the right edge; the figures give way first. */
function spread(left: Line, right: Line, width: number, palette: MissionPalette): Line {
  const gap = width - at(left) - at(right);
  if (at(right) === 0 || gap < 2) return fitLine(left, width, palette);
  return [...left, plainText(" ".repeat(gap), palette.muted), ...right];
}

function shownSteps(view: MissionView, frame: MotionFrame): readonly StepState[] {
  // During the completion moment the running stage and those after it flip to done in turn.
  return view.steps.map((step, index) => {
    const from = frame.celebrateFrom;
    if (frame.celebrate === undefined || from === undefined || step.state !== "done" || index < from) return step.state;
    const turn = motionTiming.workDoneAt + (index - from) * (motionTiming.reviewDoneAt - motionTiming.workDoneAt);
    return frame.celebrate < turn ? (index === from ? "now" : "todo") : "done";
  });
}

type MapOptions = { readonly rest: boolean; readonly rainbow?: Rainbow; readonly amber?: string };

/** The stage map in words: a warm name, `✓` and rail behind, a filled pill where the work is, dim words ahead. */
function stageMap(view: MissionView, frame: MotionFrame, palette: MissionPalette, options: MapOptions, level: 0 | 1 | 2): Segment[] {
  const states = shownSteps(view, frame);
  const reached = currentStepIndex(view);
  const out: Segment[] = [];
  const flash = stageFlash(frame);
  view.steps.forEach((step, index) => {
    const state = states[index];
    const name = stepName(step.id, view);
    if (level === 2 && index !== Math.min(view.steps.length - 1, Math.max(0, reached))) return;
    if (index > 0 && level < 2) {
      const behind = states[index - 1] === "done" || states[index - 1] === "skip";
      const color = linkColor(view, index, frame, palette, palette.borderSubtle);
      out.push(plainText(level === 0 ? (behind ? " ━━ " : " ── ") : behind ? " ━ " : " ─ ", behind ? color : palette.borderSubtle));
    }
    const turned = options.rainbow === undefined ? undefined : rainbowColor(options.rainbow.hue + 200 + index * 50);
    if (state === "done") {
      out.push(plainText(`${name} ✓`, turned ?? stageColor(index, view.steps.length, palette), true));
      return;
    }
    if (state === "skip") {
      out.push(plainText(`${name} –`, turned ?? palette.muted));
      return;
    }
    if (state === "todo") {
      out.push(plainText(level === 0 ? `${name} ·` : name, turned ?? palette.muted));
      return;
    }
    const label = ` ${name.toUpperCase()}${state === "warn" ? " ⚑" : ""} `;
    if (options.rainbow !== undefined) {
      out.push(...rainbowPill(label, options.rainbow, 160));
      return;
    }
    const chars = [...label];
    const to = options.amber ?? mixHex(palette.fill, palette.fillWarn, state === "warn" ? Math.max(frame.warn, 0.5) : frame.warn);
    const from = options.amber !== undefined ? palette.fillWarn : state === "warn" ? to : mixHex(palette.fill, stageFrom, 0.75);
    chars.forEach((char, x) => {
      const place = x / (chars.length - 1);
      out.push({ text: char, fg: palette.onFill, bg: shine(mixHex(from, to, place), palette, place, flash, 0.3), bold: true });
    });
  });
  return out;
}

const laneDots: Readonly<Record<ThreadStatus, string>> = { working: "●", paused: "●", done: "✓", failed: "✗", idle: "○" };
const laneWords: Readonly<Record<ThreadStatus, string>> = { working: "running", paused: "paused", done: "done", failed: "failed", idle: "idle" };

function laneInk(status: ThreadStatus, palette: MissionPalette): string {
  if (status === "working" || status === "done") return palette.success;
  if (status === "failed") return palette.error;
  return status === "paused" ? palette.warning : palette.muted;
}

type Job = { readonly lead: string; readonly name: string; readonly stage: string; readonly row: ThreadRow };

/** The running job and the lanes as aligned columns: name, stage, gauge, count, status word. */
function workLines(jobs: readonly Job[], fork: string | undefined, forkAt: number, width: number, palette: MissionPalette, options: { readonly now: number; readonly motion: boolean; readonly gaugeColor?: (index: number) => string }): Line[] {
  const nameMax = Math.max(8, Math.min(24, Math.floor(width * 0.24)));
  const nameOf = (job: Job): string => truncateCells(job.name, nameMax);
  const left = Math.max(...jobs.map((job) => cellWidth(job.lead) + 2 + cellWidth(nameOf(job)) + (job.stage === "" ? 0 : 2 + cellWidth(job.stage))));
  const counts = jobs.map((job) => (job.row.done === undefined || job.row.total === undefined ? "" : `${job.row.done}/${job.row.total}`));
  const countWidth = Math.max(0, ...counts.map(cellWidth));
  const lines: Line[] = jobs.map((job, index) => {
    const { row } = job;
    const ink = laneInk(row.status, palette);
    const quiet = row.status === "idle" || row.status === "done";
    const name = nameOf(job);
    const pad = left - cellWidth(job.lead) - 2 - cellWidth(name) - cellWidth(job.stage);
    const color = options.gaugeColor?.(index) ?? ink;
    const meter = counts[index] === "" ? rail(row, laneGaugeCells, options, color, palette) : gauge((row.done as number) / (row.total as number), laneGaugeCells, (x) => mixHex(color, "#ffffff", 0.25 * x), palette);
    const facts = row.facts === "" || row.facts === "started" || row.facts === "quiet" || row.facts === "finished" ? "" : row.facts;
    return [
      ...(job.lead === "" ? [] : [plainText(job.lead, palette.muted)]),
      plainText(`${laneDots[row.status]} `, ink),
      plainText(name, quiet ? palette.muted : palette.text, !quiet),
      plainText(" ".repeat(Math.max(0, pad)), palette.muted),
      ...(job.stage === "" ? [] : [plainText(job.stage, palette.muted)]),
      plainText("  ", palette.muted),
      ...meter,
      ...(countWidth === 0 ? [] : [plainText(` ${counts[index].padStart(countWidth)}`, palette.text, true)]),
      plainText(` ${laneWords[row.status]}`, ink),
      ...(facts === "" ? [] : [plainText(` ${facts}`, palette.muted)])
    ];
  });
  if (fork !== undefined) lines.splice(forkAt, 0, [plainText("┬ ", palette.muted), plainText(fork, palette.muted)]);
  return lines;
}

function workRowsFor(input: CardInputs, view: MissionView, rest: boolean, width: number, palette: MissionPalette, rainbow: Rainbow | undefined): Line[] {
  const all = input.threads ?? [];
  const own = all.filter((row) => row.key.startsWith("stack:"));
  const lanes = all.filter((row) => !row.key.startsWith("stack:"));
  const working = view.active && !rest && !view.complete;
  const counted = view.progress === undefined ? {} : { done: view.progress.done, total: view.progress.total };
  const self: ThreadRow[] = own.length > 0 ? own : working && input.busy !== false ? [{ key: "self", name: view.discipline, status: "working", facts: "", ...counted }] : [];
  const shown = lanes.slice(0, laneMax);
  const room = workRows - shown.length - (lanes.length > 0 ? 1 : 0);
  const jobs: Job[] = self.slice(0, Math.max(0, room)).map((row, index) => ({ lead: "", name: row.name, stage: index === 0 && row.status === "working" ? stepName(view.phase, view).toUpperCase() : "", row: index === 0 && row.done === undefined && row.name === view.discipline ? { ...row, ...counted } : row }));
  shown.forEach((row, index) => jobs.push({ lead: index === shown.length - 1 ? "└─ " : "├─ ", name: row.name, stage: "", row }));
  if (jobs.length === 0) return [];
  const more = lanes.length - shown.length;
  const fork = lanes.length === 0 ? undefined : `${lanes.length} ${lanes.length === 1 ? "lane" : "lanes"} in parallel${more > 0 ? ` · +${more} more` : ""}`;
  return workLines(jobs, fork, jobs.length - shown.length, width, palette, {
    now: input.frame.now ?? 0,
    motion: input.motion ?? true,
    ...(rainbow === undefined ? {} : { gaugeColor: (index: number) => rainbowColor(rainbow.hue + 60 + index * 50) })
  });
}

const hasLast = (last: LastMission | undefined): boolean => last !== undefined && last.title !== "";
const trimmed = (line: Line): Line => line.map((segment, index) => (index === 0 ? { ...segment, text: segment.text.trimStart() } : segment));

/** `└ criterion 1/3 (gauge) · next ▸ …`, a warning, or what a resting session can do next. */
function taskLine(input: CardInputs, view: MissionView, width: number, palette: MissionPalette, rainbow: Rainbow | undefined, lanes: LaneReports | undefined, aside: boolean): Line {
  const { frame } = input;
  const elbow = plainText("└ ", palette.muted);
  const dot = plainText(" · ", palette.muted);
  if (!view.active) return [elbow, ...trimmed(idleText(input.last, palette, sunColumn(width) - 7, input.earlier === true && !hasLast(input.last)))];
  const right = liveSegments(view, frame, palette, 28);
  const room = width - (right.length === 0 ? 0 : at(right) + 2);
  const left: Segment[] = [elbow];
  const add = (...parts: Segment[]): void => {
    if (left.length > 1) left.push(dot);
    left.push(...parts);
  };
  if (view.complete) {
    const status = frame.celebrate !== undefined && frame.celebrate < motionTiming.popAt ? [] : statusSegments(view, frame, palette).segments;
    if (status.length > 0) add(...status);
  }
  const warning = view.complete ? undefined : view.warnings[0];
  if (warning !== undefined) {
    const color = warning.kind === "retry" ? mixHex(palette.warning, palette.error, 0.5) : palette.warning;
    add(plainText("⚑ ", color, true), plainText(truncateCells(warning.text, Math.max(8, room - 34)), color, true));
  }
  const bar = (ratio: number): Segment[] => gauge(ratio, gaugeCells, (x) => (rainbow === undefined ? shine(gradientAt(view.complete ? [palette.success, palette.success] : [palette.primary, palette.accent], x), palette, x, shimmerAt(frame), 0.18) : rainbowColor(rainbow.hue + 40 + x * 120)), palette);
  const count = (label: string, done: number, total: number): Segment[] => [plainText(`${label} `, palette.muted), plainText(String(done), palette.text, true), plainText(`/${total} `, palette.muted)];
  if (view.progress !== undefined && !(view.complete && view.goal !== undefined)) {
    const label = view.family === "loop" ? "criterion" : view.family === "research" ? "claims" : "task";
    add(...count(label, view.progress.done, view.progress.total), ...bar(frame.barRatio));
  }
  if (view.goal !== undefined && (view.family !== "loop" || view.complete)) add(...count("criteria", view.goal.passed, view.goal.total), ...(view.progress === undefined || view.complete ? bar(view.goal.total === 0 ? 0 : view.goal.passed / view.goal.total) : []));
  if (!aside && view.complete && view.goal !== undefined && room - at(left) >= 15) add(plainText(truncateCells(view.goal.title, room - at(left) - 3), palette.text));
  if (!aside && !view.complete && view.next !== undefined && room - at(left) >= 22) add(plainText("next ▸ ", palette.muted), plainText(truncateCells(view.next, room - at(left) - 10), palette.text));
  if (lanes !== undefined) {
    const reports = reviewLanes.flatMap((lane, index): Segment[] => {
      const result = lanes[lane];
      const ink = result === undefined ? palette.muted : laneColor(lane, lanes, palette);
      return [...(index === 0 ? [] : [plainText(" ", palette.muted)]), plainText(`${lane} ${result === undefined ? "·" : result === "pass" ? "✓" : "✗"}`, ink, result !== undefined)];
    });
    if (at(left) + 3 + at(reports) <= room) add(...reports);
  }
  if (left.length === 1) left.pop();
  const sparks = frame.celebrate !== undefined && at(left) + chipSparkWidth <= room ? chipSparkCells(frame.celebrate, palette) ?? [] : [];
  return spread([...left, ...sparks], right, width, palette);
}

/** What the task line leaves to the spare row of a resting card, left of the sun. */
function asideLine(view: MissionView, width: number, palette: MissionPalette): Line {
  const room = sunColumn(width) - 5;
  if (view.complete) return view.goal === undefined ? [] : [plainText(`  ${truncateCells(view.goal.title, room - 2)}`, palette.text)];
  return view.next === undefined ? [] : [plainText("  next ▸ ", palette.muted), plainText(truncateCells(view.next, room - 9), palette.text)];
}

function mapLine(input: CardInputs, view: MissionView, width: number, palette: MissionPalette, options: MapOptions): Line {
  const lanes = (input.threads ?? []).filter((row) => !row.key.startsWith("stack:"));
  const live = lanes.filter((row) => row.status === "working").length;
  const elapsed: Segment[] = view.active ? [plainText(elapsedText(view.elapsedMinutes), palette.muted)] : [];
  const full: Segment[] = live === 0 ? elapsed : [plainText("●".repeat(Math.min(3, live)), palette.success), plainText(" ", palette.muted), plainText(String(live), palette.text, true), plainText(` ${live === 1 ? "lane" : "lanes"} `, palette.muted), ...elapsed];
  for (const level of [0, 1] as const) {
    const map = stageMap(view, input.frame, palette, options, level);
    for (const right of [full, elapsed, []]) if (at(map) + (right.length === 0 ? 0 : at(right) + 2) <= width) return spread(map, right, width, palette);
  }
  return fitLine(stageMap(view, input.frame, palette, options, 2), width, palette);
}

function stateMark(view: MissionView, frame: MotionFrame, palette: MissionPalette, rest: boolean): Line {
  if (!view.active || rest) return [plainText("IDLE ○", palette.muted)];
  const status = missionStatus(view);
  if (status.tone === "success") return [plainText("COMPLETE ✓", palette.success, true)];
  if (status.tone === "warning") return [plainText(`${status.text} ⚑`, mixHex(palette.info, palette.warning, Math.max(frame.warn, 0.5)), true)];
  return [plainText(`${stepName(view.phase, view).toUpperCase()} ●`, palette.info, true)];
}

/** A look's mark with its glyph after the words, as every state word on the title edge. */
function flipped(mark: Line): Line {
  const only = mark.length === 1 ? /^(\S) (.+)$/u.exec(mark[0].text) : null;
  return only === null ? mark : [{ ...mark[0], text: `${only[2]} ${only[1]}` }];
}

function titleEdge(view: MissionView, palette: MissionPalette, width: number, border: string, brand: Line, mark: Line): Line {
  const name = view.active ? view.discipline : "ready";
  const named = (room: number): Line => [...brand, plainText(" · ", palette.muted), plainText(truncateCells(name, room), view.active ? palette.accent : palette.muted, view.active)];
  const room = width - at(named(0)) - at(mark) - 9;
  const lines = [room >= Math.min(4, cellWidth(name)) ? ruled("╭─", named(room), mark, "─╮", width, border) : undefined, ruled("╭─", brand, mark, "─╮", width, border), ruled("╭─", brand, [], "─╮", width, border)];
  return lines.find((line) => line !== undefined) ?? fitLine([plainText("╭" + "─".repeat(width), border)], width, palette);
}

function bottomEdge(figures: CardFigures, palette: MissionPalette, width: number, border: string, rainbow: Rainbow | undefined): Line {
  const parts: Line[] = [];
  const percentInk = (percent: number, limit: number): string => (percent >= limit ? palette.warning : palette.accent);
  if (figures.restartTo !== undefined) parts.push([plainText(`restart to ${truncateCells(figures.restartTo, 16)}`, palette.warning, true)]);
  if (figures.contextPercent !== null) {
    const percent = Math.round(figures.contextPercent);
    const ink = rainbow === undefined ? percentInk(percent, contextWarnPercent) : rainbowColor(rainbow.hue + 120);
    parts.push([plainText("ctx ", palette.muted), plainText(`${percent}%`, ink, true), plainText(" ", palette.muted), ...gauge(percent / 100, 6, (x) => (percent >= contextWarnPercent ? palette.warning : mixHex(stageFrom, ink, x)), palette)]);
  }
  for (const limit of figures.limits ?? []) parts.push([plainText(`${limit.label} `, palette.muted), plainText(`${limit.percent}%`, limit.limited || limit.percent >= limitWarnPercent ? palette.warning : palette.success, true), ...(limit.limited ? [plainText(" limited", palette.warning)] : [])]);
  if (figures.branch !== undefined) parts.push([plainText("⎇ ", palette.muted), plainText(truncateCells(figures.branch, 24), palette.accent)]);
  if (figures.inLane) parts.push([plainText("in lane", palette.muted)]);
  for (let count = parts.length; count > 0; count -= 1) {
    const left = parts.slice(0, count).flatMap((part, index) => (index === 0 ? [...part] : [plainText(" · ", palette.muted), ...part]));
    const line = ruled("╰─", left, [], "─╯", width, border);
    if (line !== undefined) return line;
  }
  return fitLine([plainText(`╰${"─".repeat(Math.max(0, width - 2))}╯`, border)], width, palette);
}

/** The card for this terminal: the full one where the sunset shows and the width allows, else the plain one. */
export function missionCard(input: CardInputs, palette: MissionPalette, width: number): Line[] {
  if (input.scene === undefined || palette.synthwave !== true || width < fullCardMinimum) return statusCard(input, palette, width);
  const { frame } = input;
  const rest = resting(input.view, input.busy);
  const view: MissionView = rest ? { ...input.view, steps: input.view.steps.map((step) => (step.state === "now" ? { ...step, state: "todo" } : step)) } : input.view;
  const turn = input.turn;
  const rainbow = turn === undefined ? input.rainbow : undefined;
  const lanes = turn === undefined && rainbow === undefined ? input.lanes : undefined;
  const plain = turn === undefined && rainbow === undefined && lanes === undefined;
  const inner = width - 4;
  const border = turn !== undefined ? turnColor(palette, turn.glow) : rainbow === undefined ? borderColor(view, frame, palette, rest) : rainbowColor(rainbow.hue);
  const scene = frame.celebrate === undefined ? input.scene : undefined;
  const neon = scene !== undefined && plain && !view.complete && view.warnings.length === 0 && frame.warn === 0;
  const dim = plain && input.busy !== true;
  const brand = rainbow !== undefined ? rainbowPill(" 🔥 LIT ", rainbow, 90) : synthwavePill(sunsetBrand, 0.22 * sceneBreath(scene?.t));
  const mark = turn !== undefined ? turnMark(palette, turn.glow) : rainbow !== undefined ? rewindMark(rainbow) : lanes !== undefined ? reviewMark(lanes, palette) : stateMark(view, frame, palette, rest);
  const title = titleEdge(view, palette, width, border, brand, rainbow === undefined ? flipped(mark) : mark);
  const top = lanes === undefined ? title : laneRule(title, lanes, palette);
  const work = workRowsFor(input, view, rest, inner, palette, rainbow);
  const held = Math.min(workRows, (input.reserve ?? 0) === 0 ? 0 : (input.reserve ?? 0) + 1);
  while (work.length < held) work.push([]);
  // The way back in has its own row under the last goal, left of the sun.
  if (!view.active && hasLast(input.last) && input.earlier === true) work.push([plainText(`  ${idleHint}`, palette.accent)]);
  const spare = work.length + (input.chips.length === 0 ? 0 : 1) < sunRoom && (input.rows ?? tallWindow) >= tallWindow;
  const aside = spare && view.active && work.length === 0;
  const body: Line[] = [
    mapLine(input, view, inner, palette, { rest, ...(rainbow === undefined ? {} : { rainbow }), ...(turn === undefined ? {} : { amber: turnColor(palette, turn.glow) }) }),
    taskLine(input, view, inner, palette, rainbow, lanes, aside),
    ...(aside ? [asideLine(view, inner, palette)] : []),
    ...work,
    ...(input.chips.length === 0 ? [] : [skillRow(input.chips, input.shimmer, { ...palette, fillFrom: mixHex(palette.fill, stageFrom, 0.75) }, inner, rainbow)]),
    ...(spare && !aside ? [[]] : [])
  ].map((line) => fitLine(line, inner, palette));
  const sky = scene === undefined ? undefined : paintSky(body.slice(-3), inner, {
    dim,
    ...(scene.t === undefined ? {} : { t: scene.t }),
    ...(turn === undefined ? {} : { turn: true }),
    ...(rainbow === undefined ? {} : { rainbow: (position: number) => rainbowColor(rainbow.hue + position * 360) })
  });
  const rows: readonly Line[] = sky === undefined ? body : [...body.slice(0, -3), ...sky.rows];
  const light = { width, accent: palette.accent, dim, sun: sky?.sun ?? 0, ...(scene?.t === undefined ? {} : { t: scene.t }) };
  const edge = (line: Line, water: boolean): Line => (neon ? neonRow(line, border, water, light) : line);
  const [left, right] = neon ? [neonAt(0, false, light), neonAt(width - 1, false, light)] : [border, border];
  return [
    edge(top, false),
    ...rows.map((line): Line => [plainText("│ ", left), ...line, plainText(" │", right)]),
    edge(bottomEdge(input.figures, palette, width, border, rainbow), true)
  ].map((line) => [...roundPills(line, palette)]);
}
