// LitOpenCode's OpenCode 2 TUI plugin: the same HUD OpenCode 1 draws, placed in the slots OpenCode 2
// publishes (@opencode/plugin SlotMap). The status card sits after the prompt footer, the stage chip and
// the ignition line (`🔥 LIT IGNITED · <discipline>`, the OpenCode 2 home of the OpenCode 1 completion
// mark) share prompt.footer.status, the home line is in home.footer and the mission panel in
// sidebar.content. Toasts cover the gate events, the stage moving, discipline switches, lanes, the
// ignition and the restart notice, with an opt-in finish alert. OpenCode 2 loads the plugin on its own
// for an active server plugin. The server cannot raise toasts there, so the ignition toast is inferred
// from the lit mark the server writes into the user message metadata. It only reads state. OpenTUI and
// Solid come from the host at run time; tests pass a stand-in runtime.
import { activationDiscipline } from "../activation-probe.ts";
import { readPackageMetadata } from "../cli/json.ts";
import { micro, supportsMarkGlyphs } from "../lit-mark.ts";
import { readInstalledVersions, restartVersion } from "../restart-notice.ts";
import { buildMissionView, lastMission, leadingNotice, missionNotices, type MissionNotice, type MissionView } from "../tui/mission-model.ts";
import { idleMotion, motionTiming, planMotion, sampleMotion, type MotionState } from "../tui/mission-motion.ts";
import { latestLitMarkV2, missionStateFromV2, type MissionDataV2 } from "../tui/mission-source-v2.ts";
import {
  adhdSuggestDue,
  createLedgerReader,
  createWorkReader,
  earlierWorkWindowMs,
  hasEarlierWork,
  messageTimes,
  missionProjectRoot,
  readCardInput,
  readLatestResearchRun,
  readMissionInput,
  readThreadSources,
  wayBackDue,
  type CardInput,
  type MissionStateSource
} from "../tui/mission-source.ts";
import { chipShimmer, idleChipMotion, planChipMotion, type ChipMotion } from "../tui/mission-skills.ts";
import { bandCard, readBandOptions, readNotifyOptions, statusCard } from "../tui/mission-band.ts";
import { activeSkillLook, turnGlow, waitingOnYou } from "../tui/mission-looks.ts";
import { rainbowActive, rainbowAllowed, rainbowAt, rainbowShows, rainbowTickMs } from "../tui/mission-rainbow.ts";
import { threadLineCount, threadsOf } from "../tui/mission-threads.ts";
import { chipLine, cellWidth, homeLine, lineWidth, missionPanel, paletteFromTheme, panelWidth, type Line, type MissionPalette } from "../tui/mission-text.ts";
import { v2StageNotices } from "./tui-notices.ts";

export type TuiRuntime = {
  readonly jsx: (type: string, props?: Record<string, unknown>) => unknown;
  readonly createSignal: <T>(value: T) => readonly [() => T, (value: T) => T];
  readonly createEffect: (fn: () => void) => void;
  readonly createRoot: <T>(fn: (dispose: () => void) => T) => T;
  /** The host's terminal size, reactive; a stand-in runtime may leave it out. */
  readonly useTerminalDimensions?: () => () => { readonly width: number; readonly height: number };
};

type PromptFooterInput = { readonly sessionID?: string; readonly mode: "normal" | "shell"; readonly showDetails: boolean };

export type SlotClaimLike =
  | { readonly append: "sidebar.content"; readonly render: (input: { readonly sessionID: string }) => unknown }
  | { readonly append: "prompt.footer.status"; readonly render: (input: PromptFooterInput) => unknown }
  | { readonly append: "app"; readonly render: (input: Record<string, never>) => unknown }
  | { readonly append: "home.footer"; readonly render: (input: Record<string, never>) => unknown };

export type TuiContextLike = {
  readonly options?: unknown;
  readonly location: { readonly directory: string } | undefined;
  readonly theme: unknown;
  readonly themeMode: "dark" | "light";
  readonly attention?: { readonly notify: (options: { readonly title?: string; readonly message: string; readonly notification?: boolean; readonly sound?: boolean | { readonly name?: "done" } }) => Promise<unknown> };
  readonly ui: {
    readonly slot: (claim: SlotClaimLike) => () => void;
    readonly router?: { current(): { readonly type: string; readonly sessionID?: string } };
    readonly toast: { readonly show: (options: { readonly title?: string; readonly message: string; readonly variant?: "info" | "success" | "warning" | "error"; readonly duration?: number; readonly sessionID?: string }) => void };
  };
  readonly storage: { readonly store: <Value extends object>(key: string, options: { readonly initial: Value }) => readonly [Value, unknown] };
  readonly data: MissionDataV2 & {
    readonly listen: (handler: (event: { readonly details: { readonly type: string } }) => void) => () => void;
    readonly location: MissionDataV2["location"] & { default(): { readonly directory: string } };
    readonly session: MissionDataV2["session"] & { get?(sessionID: string): { readonly parentID?: string; readonly time?: { readonly created?: number } } | undefined };
  };
};

const refreshDelayMs = 80;
const ledgerPollMs = 2000;
const toastMs = 4000;
const ignitionToastMs = 6000;
const liveTickMs = 1000;
const restartCheckMs = 10 * 60_000;
const trackedSessionLimit = 4;
const homeLineWidth = 69;
// A lit mark older than the moment a session is first drawn is history being loaded, not a new turn.
const historySlackMs = 2000;
const defaultWidth = 120;
// What the footer row holds besides our line: the host's spinner and hint on the left, its token, cost,
// goal and `ctrl+p commands` figures on the right (measured with a turn running, when they are widest).
const hostFooterCells = 68;
const sidebarCells = 42;
const sidebarMinWidth = 120;

type Entry = { view: MissionView; card: CardInput; motion: MotionState; chipMotion: ChipMotion; reserve: number; rainbowSeen?: number; lastPromptAt?: number; waiting: boolean };

async function hostRuntime(): Promise<TuiRuntime> {
  const [jsxRuntime, solid, opentui] = await Promise.all([import("@opentui/solid/jsx-runtime"), import("solid-js"), import("@opentui/solid")]);
  return {
    jsx: jsxRuntime.jsx,
    createSignal: solid.createSignal as TuiRuntime["createSignal"],
    createEffect: solid.createEffect,
    createRoot: solid.createRoot,
    useTerminalDimensions: opentui.useTerminalDimensions as unknown as NonNullable<TuiRuntime["useTerminalDimensions"]>
  };
}

type ThemeTokens = {
  readonly text?: { readonly base?: unknown; readonly muted?: unknown };
  readonly border?: { readonly base?: unknown };
  readonly background?: { readonly base?: unknown; readonly raised?: { readonly base?: unknown; readonly high?: unknown } };
};

/** OpenCode 2 theme tokens under the names the mission palette reads. */
export function paletteFromV2Theme(theme: unknown, mode: "dark" | "light"): MissionPalette {
  const tokens = (typeof theme === "object" && theme !== null ? theme : {}) as ThemeTokens;
  return paletteFromTheme({
    text: tokens.text?.base,
    textMuted: tokens.text?.muted,
    borderActive: tokens.border?.base,
    borderSubtle: tokens.border?.base,
    background: tokens.background?.base,
    backgroundPanel: tokens.background?.raised?.base,
    backgroundElement: tokens.background?.raised?.high
  }, mode);
}

export function ignitionLine(name: string): string {
  return `🔥 LIT IGNITED · ${activationDiscipline(name)}`;
}

export async function setupLitOpenCodeTui(context: TuiContextLike, runtime?: TuiRuntime): Promise<() => Promise<void>> {
  const ui = runtime ?? await hostRuntime();
  const [settings] = context.storage.store("settings", { initial: { motion: true } });
  const motionEnabled = (settings as { motion?: unknown }).motion !== false;
  const band = readBandOptions(context.options);
  const notify = readNotifyOptions(context.options);
  const directory = context.location?.directory ?? context.data.location.default().directory;
  const root = missionProjectRoot({ directory });
  const readLedger = createLedgerReader();
  const readWork = createWorkReader();
  const colorAllowed = rainbowAllowed(motionEnabled, process.env.NO_COLOR);
  const sessions = new Map<string, Entry>();
  const ignitions = new Map<string, string | undefined>();
  const trackedAt = new Map<string, number>();
  const tracked: string[] = [];
  const suggested = new Set<string>();
  const suggestedDays = new Map<string, string>();
  // Each session's store watcher lives in its own root, so it outlasts the slot render that started it
  // and ends only on eviction or cleanup. After cleanup nothing may arm a timer again.
  const watchers = new Map<string, () => void>();
  let disposed = false;
  const [revision, setRevision] = ui.createSignal(0);
  const [clock, setClock] = ui.createSignal(Date.now());
  // The version this start loaded; an install newer than it shows `restart to <v>` and one toast.
  const [restartTo, setRestartTo] = ui.createSignal<string | undefined>(undefined);
  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let liveTimer: ReturnType<typeof setInterval> | undefined;
  let bandTimer: ReturnType<typeof setInterval> | undefined;
  let restartTimer: ReturnType<typeof setInterval> | undefined;

  const palette = (): MissionPalette => paletteFromV2Theme(context.theme, context.themeMode);

  function span(segment: Line[number]): unknown {
    return ui.jsx("span", {
      style: { fg: segment.fg, ...(segment.bg === undefined ? {} : { bg: segment.bg }), ...(segment.bold === true ? { bold: true } : {}) },
      children: segment.text
    });
  }

  function line(segments: Line): unknown {
    return ui.jsx("text", { wrapMode: "none", children: segments.length === 0 ? " " : segments.map(span) });
  }

  function state(): MissionStateSource {
    return missionStateFromV2(context.data, directory);
  }

  function parentOf(sessionID: string): string | undefined {
    const parent = context.data.session.get?.(sessionID)?.parentID;
    return typeof parent === "string" && parent !== "" ? parent : undefined;
  }

  function width(): number {
    return ui.useTerminalDimensions?.()().width ?? defaultWidth;
  }

  function rainbowOn(entry: Entry, now: number): boolean {
    return colorAllowed && rainbowShows(rainbowActive(entry.view, entry.card.chips, entry.card.busy), entry.rainbowSeen, entry.lastPromptAt, now);
  }

  function bandStepping(entry: Entry): boolean {
    if (!colorAllowed) return false;
    if (entry.waiting || rainbowOn(entry, Date.now())) return true;
    return entry.card.threads?.some((row) => row.status === "working" && row.done === undefined) === true;
  }

  function syncBandTimer(): void {
    if (disposed) return;
    const needed = [...sessions.values()].some(bandStepping);
    if (needed && bandTimer === undefined) bandTimer = setInterval(() => {
      setClock(Date.now());
      syncBandTimer();
    }, rainbowTickMs);
    if (!needed && bandTimer !== undefined) {
      clearInterval(bandTimer);
      bandTimer = undefined;
    }
  }

  function anyMoving(now: number): boolean {
    for (const entry of sessions.values()) if (sampleMotion(entry.motion, now).moving || chipShimmer(entry.chipMotion, now) !== undefined) return true;
    return false;
  }

  function ensureFrames(): void {
    if (disposed || frameTimer !== undefined || !anyMoving(Date.now())) return;
    frameTimer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (!anyMoving(now)) {
        clearInterval(frameTimer);
        frameTimer = undefined;
      }
    }, motionTiming.frameMs);
  }

  // The live step's elapsed time is the one steady change: a tick a second while a tool runs.
  function syncLiveTick(): void {
    if (disposed) return;
    const running = [...sessions.values()].some((entry) => entry.view.live !== undefined);
    if (running && liveTimer === undefined) liveTimer = setInterval(() => setClock(Date.now()), liveTickMs);
    if (!running && liveTimer !== undefined) {
      clearInterval(liveTimer);
      liveTimer = undefined;
    }
  }

  // The card keeps the tallest lane count it reached while lanes are live or a turn runs, so the prompt does not jump.
  function holdRows(held: number, rows: number, busy: boolean): number {
    if (rows > 0) return Math.max(held, rows);
    return busy ? held : 0;
  }

  function ignitionToast(sessionID: string, name: string): void {
    const label = `${ignitionLine(name)} 🔥`;
    const message = supportsMarkGlyphs() ? [...micro.map((row) => row.replace(/ +$/u, "")), label].join("\n") : label;
    context.ui.toast.show({ title: "🔥 LIT IGNITED", message, variant: "warning", duration: ignitionToastMs, sessionID });
  }

  // The finish alert is off unless the plugin options opt in; OpenCode's own attention settings still
  // decide whether a desktop notification or a sound actually plays.
  function alertFinish(notice: MissionNotice): void {
    if (!notify.enabled || context.attention === undefined) return;
    void context.attention
      .notify({ title: "🔥 LIT complete", message: notice.message, notification: notify.desktop, sound: notify.sound ? { name: "done" } : false })
      .catch(() => undefined);
  }

  async function checkRestart(): Promise<void> {
    const loaded = await readPackageMetadata().catch(() => undefined);
    if (loaded === undefined || disposed) return;
    const target = restartVersion(loaded.version, await readInstalledVersions(loaded.packageRoot).catch(() => []));
    if (disposed || target === undefined || target === restartTo()) return;
    if (restartTo() === undefined) {
      context.ui.toast.show({ variant: "info", title: "🔥 LIT", message: `LitOpenCode ${target} is installed. Restart OpenCode to load it.`, duration: toastMs });
    }
    setRestartTo(target);
  }

  // One toast per session, for a fresh root session in a workspace that has earlier work to pick up.
  function suggestAdhd(sessionID: string, source: MissionStateSource): void {
    if (suggested.has(sessionID) || parentOf(sessionID) !== undefined) return;
    suggested.add(sessionID);
    const created = context.data.session.get?.(sessionID)?.time?.created;
    const now = Date.now();
    if (source.session.messages(sessionID).length > 0 || typeof created !== "number" || now - created > 2 * 60_000) return;
    const projectRoot = missionProjectRoot(source.path);
    if (projectRoot === undefined || !hasEarlierWork(projectRoot, sessionID, now, earlierWorkWindowMs) || !adhdSuggestDue(suggestedDays, projectRoot, now)) return;
    context.ui.toast.show({ variant: "info", title: "🔥 LIT", message: "Earlier work here. Say lit adhd to pick up where you left off.", duration: toastMs });
  }

  // One session's view, card and the notices from its previous entry. Pure reads; nothing is armed here.
  function build(sessionID: string, entry: Entry | undefined, now: number): { readonly next: Entry; readonly changed: boolean; readonly notices: readonly MissionNotice[] } {
    const source = state();
    const work = readWork(root, sessionID);
    const research = readLatestResearchRun(root);
    const view = buildMissionView(readMissionInput(source, sessionID, readLedger(root), now, {
      ...(work === undefined ? {} : { work }),
      ...(research === undefined ? {} : { research })
    }));
    const threads = threadsOf(readThreadSources(source, sessionID, root, now), now);
    const times = messageTimes(source, sessionID);
    const card: CardInput = {
      ...readCardInput(source, sessionID),
      ...(threads === undefined ? {} : { threads }),
      ...(wayBackDue(times.lastAt, now, hasEarlierWork(root, sessionID, now, earlierWorkWindowMs)) ? { earlier: true } : {})
    };
    const viewChanged = entry === undefined || JSON.stringify(entry.view) !== JSON.stringify(view);
    const rainbowSeen = rainbowActive(view, card.chips, card.busy) ? now : entry?.rainbowSeen;
    const waiting = waitingOnYou(view, card.busy, { asked: card.asked === true, userSpokeLast: card.userSpokeLast === true, blockedReply: card.blockedReply === true, boundary: work?.boundary === true });
    const changed = entry === undefined || viewChanged || entry.lastPromptAt !== times.lastPromptAt || JSON.stringify(entry.card) !== JSON.stringify(card) || entry.rainbowSeen !== rainbowSeen || entry.waiting !== waiting;
    const lanesChanged = entry !== undefined && JSON.stringify(entry.card.threads) !== JSON.stringify(card.threads);
    const notices = entry !== undefined && (viewChanged || lanesChanged)
      ? [...missionNotices(entry.view, view), ...v2StageNotices(entry.view, view, entry.card.threads ?? [], card.threads ?? [])]
      : [];
    return {
      changed,
      notices,
      next: {
        view,
        card,
        motion: entry !== undefined && viewChanged ? planMotion(entry.view, view, now, entry.motion, motionEnabled) : (entry?.motion ?? idleMotion),
        chipMotion: planChipMotion(entry?.card.chips, card.chips, now, entry?.chipMotion ?? idleChipMotion, motionEnabled),
        reserve: holdRows(entry?.reserve ?? 0, threadLineCount(threads), card.busy),
        ...(rainbowSeen === undefined ? {} : { rainbowSeen }),
        ...(times.lastPromptAt === undefined ? {} : { lastPromptAt: times.lastPromptAt }),
        waiting
      }
    };
  }

  function refresh(sessionID: string): void {
    if (disposed) return;
    const now = Date.now();
    const mark = latestLitMarkV2(context.data, sessionID);
    if (ignitions.get(sessionID) !== mark?.messageID) {
      ignitions.set(sessionID, mark?.messageID);
      if (mark !== undefined && mark.at >= (trackedAt.get(sessionID) ?? 0) - historySlackMs) ignitionToast(sessionID, mark.name);
    }
    const entry = sessions.get(sessionID);
    const { next, changed, notices } = build(sessionID, entry, now);
    if (!changed) return;
    const notice = leadingNotice(notices);
    if (notice !== undefined) context.ui.toast.show({ variant: notice.variant, title: notice.title, message: notice.message, duration: toastMs, sessionID });
    const finish = notices.find((candidate) => candidate.celebrate === true);
    if (finish !== undefined) alertFinish(finish);
    sessions.set(sessionID, next);
    setClock(now);
    setRevision(revision() + 1);
    ensureFrames();
    syncBandTimer();
    syncLiveTick();
    syncPoll();
  }

  function syncPoll(): void {
    if (disposed) return;
    const active = [...sessions.values()].some((entry) => entry.view.active);
    if (active && pollTimer === undefined) pollTimer = setInterval(refreshTracked, ledgerPollMs);
    if (!active && pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  function refreshTracked(): void {
    refreshTimer = undefined;
    if (disposed) return;
    for (const sessionID of tracked) refresh(sessionID);
    syncPoll();
  }

  function scheduleRefresh(): void {
    if (!disposed && refreshTimer === undefined) refreshTimer = setTimeout(refreshTracked, refreshDelayMs);
  }

  // A session is tracked from its first render. Its existing history raises no toast; only a lit mark
  // that appears after that does.
  function track(sessionID: string): void {
    if (disposed || tracked.includes(sessionID)) return;
    tracked.push(sessionID);
    if (tracked.length > trackedSessionLimit) {
      const dropped = tracked.shift() ?? "";
      watchers.get(dropped)?.();
      watchers.delete(dropped);
      sessions.delete(dropped);
      ignitions.delete(dropped);
      trackedAt.delete(dropped);
    }
    const now = Date.now();
    trackedAt.set(sessionID, now);
    ignitions.set(sessionID, latestLitMarkV2(context.data, sessionID)?.messageID);
    suggestAdhd(sessionID, state());
    sessions.set(sessionID, build(sessionID, undefined, now).next);
    queueMicrotask(() => {
      syncPoll();
      syncLiveTick();
      syncBandTimer();
    });
    // Opening a session loads its messages over HTTP, which raises no event. Reading the host's reactive
    // store here re-runs this effect as they arrive, so a resumed session lights up too.
    const dispose = ui.createRoot((release) => {
      ui.createEffect(() => {
        for (const message of context.data.session.message.list(sessionID) ?? []) void (message as { id?: unknown }).id;
        void context.data.session.status(sessionID);
        scheduleRefresh();
      });
      return release;
    });
    watchers.set(sessionID, dispose);
  }

  const unlisten = context.data.listen((event) => {
    const type = event.details.type;
    if (type.startsWith("session.") || type.startsWith("permission.") || type.startsWith("form.")) scheduleRefresh();
  });

  // Reads that only a rendered slot needs. `view` follows the reactive revision and the clock.
  function snapshot(sessionID: string): (Entry & { readonly frame: ReturnType<typeof sampleMotion>; readonly now: number }) | undefined {
    revision();
    const entry = sessions.get(sessionID);
    const now = clock();
    return entry === undefined ? undefined : { ...entry, frame: sampleMotion(entry.motion, now), now };
  }

  function statusCardRows(sessionID: string, inLane: boolean, columns: number): readonly unknown[] | undefined {
    const current = snapshot(sessionID);
    if (current === undefined) return undefined;
    const colors = palette();
    const cells = columns - 2;
    const last = current.view.active ? undefined : lastMission(readLedger(root));
    const shimmer = chipShimmer(current.chipMotion, current.now);
    const lines = statusCard({
      view: current.view,
      frame: current.frame,
      chips: current.card.chips,
      busy: current.card.busy,
      motion: motionEnabled,
      reserve: current.reserve,
      ...(current.card.threads === undefined ? {} : { threads: current.card.threads }),
      ...(current.card.earlier === true ? { earlier: true } : {}),
      ...(current.waiting ? { turn: { glow: turnGlow(current.now, colorAllowed) } } : {}),
      ...(rainbowOn(current, current.now) ? { rainbow: rainbowAt(current.now) } : {}),
      ...(current.card.lanes !== undefined && activeSkillLook(current.view, current.card.chips, current.card.busy) === "review" ? { lanes: current.card.lanes } : {}),
      ...(shimmer === undefined ? {} : { shimmer }),
      figures: {
        contextPercent: current.card.contextPercent,
        ...(current.card.branch === undefined ? {} : { branch: current.card.branch }),
        inLane,
        ...(restartTo() === undefined ? {} : { restartTo: restartTo() })
      },
      ...(last === undefined ? {} : { last })
    }, colors, cells);
    const rows: unknown[] = lines.map(line);
    const detail = band.card ? bandCard(current.view, current.frame, colors, cells) : undefined;
    if (detail !== undefined) {
      rows.push(ui.jsx("box", {
        border: true,
        borderStyle: "rounded",
        borderColor: detail.border,
        title: detail.title,
        titleColor: colors.text,
        paddingLeft: 1,
        paddingRight: 1,
        flexShrink: 0,
        flexDirection: "column",
        children: detail.rows.map(line)
      }));
    }
    return rows;
  }

  const releases = [
    context.ui.slot({
      append: "prompt.footer.status",
      render(input: PromptFooterInput) {
        const sessionID = input.sessionID;
        if (sessionID === undefined) return null;
        track(sessionID);
        const columns = width;
        return () => {
          revision();
          const mark = latestLitMarkV2(context.data, sessionID);
          if (mark === undefined) return null;
          const ignition = ignitionLine(mark.name);
          const current = snapshot(sessionID);
          // The sidebar setting is not readable here, so a wide terminal is taken to have it open.
          const sidebar = parentOf(sessionID) === undefined && columns() > sidebarMinWidth ? sidebarCells : 0;
          const budget = columns() - sidebar - hostFooterCells - cellWidth(ignition);
          const drawn = current === undefined || !current.view.active ? [] : chipLine(current.view, current.frame, palette(), budget);
          const chip = lineWidth(drawn) > budget ? [] : drawn;
          return ui.jsx("box", {
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
            flexDirection: "row",
            children: [line([{ text: ignition, fg: palette().primary, bold: true }]), ...(chip.length === 0 ? [] : [line([{ text: "  ", fg: palette().muted }]), line(chip)])]
          });
        };
      }
    }),
    context.ui.slot({
      append: "sidebar.content",
      render(input: { readonly sessionID: string }) {
        track(input.sessionID);
        return () => {
          revision();
          const entry = sessions.get(input.sessionID);
          if (entry === undefined || !entry.view.active) return null;
          const panel = missionPanel(entry.view, sampleMotion(entry.motion, clock()), palette());
          if (panel === undefined) return null;
          return ui.jsx("box", {
            border: true,
            borderStyle: "rounded",
            width: panelWidth,
            flexShrink: 0,
            flexDirection: "column",
            paddingLeft: 1,
            paddingRight: 1,
            titleAlignment: "left",
            bottomTitleAlignment: "right",
            borderColor: panel.border,
            title: panel.title,
            titleColor: panel.titleColor,
            bottomTitle: panel.bottomTitle ?? "",
            backgroundColor: panel.background ?? "transparent",
            children: panel.rows.map(line)
          });
        };
      }
    }),
    context.ui.slot({
      append: "home.footer",
      render() {
        const columns = width;
        return () => {
          revision();
          const segments = homeLine(lastMission(readLedger(root)), palette(), Math.min(homeLineWidth, columns() - 10));
          return segments.length === 0 ? null : ui.jsx("box", { flexDirection: "row", justifyContent: "center", flexShrink: 0, children: line(segments) });
        };
      }
    })
  ];

  // The card is drawn once for the whole app, under the session and its sidebar, on every session, lit or
  // not, and keeps its rows when a turn starts. A subagent session shows its parent's card as a lane. The
  // home route has no session, so it shows no card.
  if (band.enabled) {
    releases.push(context.ui.slot({
      append: "app",
      render() {
        const columns = width;
        return () => {
          const route = context.ui.router?.current();
          const sessionID = route?.type === "session" ? route.sessionID : undefined;
          if (sessionID === undefined) return null;
          const parent = parentOf(sessionID);
          const target = parent ?? sessionID;
          track(target);
          const rows = statusCardRows(target, parent !== undefined, columns());
          if (rows === undefined) return null;
          return ui.jsx("box", {
            flexDirection: "column",
            flexShrink: 0,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: palette().panel ?? "transparent",
            children: rows
          });
        };
      }
    }));
  }

  void checkRestart();
  restartTimer = setInterval(() => void checkRestart(), restartCheckMs);

  return async () => {
    disposed = true;
    for (const dispose of watchers.values()) dispose();
    watchers.clear();
    tracked.length = 0;
    unlisten();
    for (const release of releases) release();
    if (restartTimer !== undefined) clearInterval(restartTimer);
    if (frameTimer !== undefined) clearInterval(frameTimer);
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    if (pollTimer !== undefined) clearInterval(pollTimer);
    if (liveTimer !== undefined) clearInterval(liveTimer);
    if (bandTimer !== undefined) clearInterval(bandTimer);
    sessions.clear();
    ignitions.clear();
    trackedAt.clear();
  };
}
