// Motion for the mission chip and panel. Everything here is a pure function of a clock value, so the
// TUI only runs a frame timer while one of these tracks is still moving and stays static otherwise.
import { missionRowKeys, type MissionView } from "./mission-model.ts";

export const motionTiming = Object.freeze({
  stagger: 60,
  entry: 160,
  entryLead: 40,
  fill: 300,
  fillDelayOnGoal: 240,
  noticeIn: 220,
  crossfade: 140,
  workDoneAt: 200,
  reviewDoneAt: 260,
  popAt: 300,
  pop: 160,
  shimmerAt: 300,
  shimmer: 400,
  settleAt: 1000,
  complete: 1200,
  frameMs: 33
});

export function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

export const ease = Object.freeze({
  outCubic: (x: number): number => 1 - Math.pow(1 - x, 3),
  inCubic: (x: number): number => x * x * x,
  inOutCubic: (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  // Overshoots a little past 1 and settles back: the snap of a pill or row popping in.
  outBack: (x: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }
});

/** 0..1 progress of a track that starts `start` ms after the change and lasts `duration` ms. */
export function seg(t: number, start: number, duration: number): number {
  if (duration <= 0) return t >= start ? 1 : 0;
  return clamp01((t - start) / duration);
}

/** Cells a row is pushed right while it slides in; the ease-out-back overshoot lands it a cell left first. */
export function slideIn(progress: number, amplitude = 6): number {
  return Math.round(amplitude * (1 - ease.outBack(progress)));
}

function hexChannels(hex: string): readonly [number, number, number] {
  const clean = hex.replace(/^#/u, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function mixHex(from: string, to: string, t: number): string {
  const a = hexChannels(from);
  const b = hexChannels(to);
  const k = clamp01(t);
  return "#" + a.map((channel, index) => Math.round(channel + (b[index] - channel) * k).toString(16).padStart(2, "0")).join("");
}

export type MotionState = {
  /** When the last state change happened; undefined while nothing has animated yet. */
  readonly changeAt?: number;
  /** Panel row keys that are new in this change and slide in, in order. */
  readonly entering: readonly string[];
  readonly chipEnter: boolean;
  readonly barFrom: number;
  readonly barTo: number;
  readonly barDelay: number;
  readonly warnFrom: number;
  readonly warnTo: number;
  readonly celebrate: boolean;
};

export type MotionFrame = {
  /** Milliseconds since the last change; Infinity once settled or when motion is off. */
  readonly t: number;
  readonly entering: readonly string[];
  readonly chipEnter: boolean;
  readonly barRatio: number;
  /** 0 = normal colours, 1 = warning colours. */
  readonly warn: number;
  /** Milliseconds into the completion moment while it plays, otherwise undefined. */
  readonly celebrate?: number;
  readonly moving: boolean;
};

export const idleMotion: MotionState = Object.freeze({
  entering: Object.freeze([]),
  chipEnter: false,
  barFrom: 0,
  barTo: 0,
  barDelay: 0,
  warnFrom: 0,
  warnTo: 0,
  celebrate: false
});

function ratio(view: MissionView | undefined): number {
  const progress = view?.progress;
  if (progress === undefined || progress.total === 0) return 0;
  return clamp01(progress.done / progress.total);
}

function warnTarget(view: MissionView | undefined): number {
  return view !== undefined && view.warnings.length > 0 ? 1 : 0;
}

/** Row entry with the approved stagger: rows of a fresh mission wait a short lead; later rows follow 60 ms apart. */
export function rowEntryStart(state: Pick<MotionState, "entering" | "chipEnter">, key: string): number | undefined {
  const index = state.entering.indexOf(key);
  if (index < 0) return undefined;
  return (state.chipEnter ? motionTiming.entryLead : 0) + index * motionTiming.stagger;
}

function rowDuration(key: string): number {
  return key.startsWith("warn:") ? motionTiming.noticeIn : motionTiming.entry;
}

function settleTime(state: MotionState): number {
  let end: number = motionTiming.crossfade;
  for (const key of state.entering) end = Math.max(end, (rowEntryStart(state, key) ?? 0) + rowDuration(key));
  if (state.chipEnter) end = Math.max(end, 3 * motionTiming.stagger + motionTiming.entry);
  if (state.barFrom !== state.barTo) end = Math.max(end, state.barDelay + motionTiming.fill);
  if (state.celebrate) end = Math.max(end, motionTiming.complete);
  return end;
}

/**
 * Starts the tracks a state change calls for. A bar or warning already moving continues from where
 * it is, so a burst of updates never makes either jump backwards.
 */
export function planMotion(
  prev: MissionView | undefined,
  next: MissionView,
  now: number,
  state: MotionState,
  enabled = true
): MotionState {
  const nextRatio = ratio(next);
  const nextWarn = warnTarget(next);
  if (!enabled || !next.active) return { ...idleMotion, barFrom: nextRatio, barTo: nextRatio, warnFrom: nextWarn, warnTo: nextWarn };
  const current = sampleMotion(state, now);
  const appearing = prev === undefined || !prev.active;
  const before = new Set(appearing ? [] : missionRowKeys(prev));
  const entering = missionRowKeys(next).filter((key) => !before.has(key));
  const goalArrived = !appearing && prev?.goal === undefined && next.goal !== undefined;
  return {
    changeAt: now,
    entering,
    chipEnter: appearing,
    barFrom: appearing ? 0 : current.barRatio,
    barTo: nextRatio,
    barDelay: goalArrived || appearing ? motionTiming.fillDelayOnGoal : 0,
    warnFrom: appearing ? nextWarn : current.warn,
    warnTo: nextWarn,
    celebrate: !appearing && prev?.complete !== true && next.complete
  };
}

export function sampleMotion(state: MotionState, now: number): MotionFrame {
  if (state.changeAt === undefined) {
    return { t: Number.POSITIVE_INFINITY, entering: [], chipEnter: false, barRatio: state.barTo, warn: state.warnTo, moving: false };
  }
  const t = now - state.changeAt;
  const moving = t < settleTime(state);
  const fill = ease.inOutCubic(seg(t, state.barDelay, motionTiming.fill));
  const fade = ease.inOutCubic(seg(t, 0, motionTiming.crossfade));
  return {
    t: moving ? t : Number.POSITIVE_INFINITY,
    entering: moving ? state.entering : [],
    chipEnter: moving && state.chipEnter,
    barRatio: clamp01(state.barFrom + (state.barTo - state.barFrom) * fill),
    warn: clamp01(state.warnFrom + (state.warnTo - state.warnFrom) * fade),
    ...(moving && state.celebrate ? { celebrate: t } : {}),
    moving
  };
}

export function restingFrameFor(view: MissionView): MotionFrame {
  return { t: Number.POSITIVE_INFINITY, entering: [], chipEnter: false, barRatio: ratio(view), warn: warnTarget(view), moving: false };
}
