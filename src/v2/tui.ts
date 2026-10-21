// LitOpenCode's OpenCode 2 TUI plugin: the mission panel in the session sidebar, the ignition line under
// the prompt (`🔥 LIT IGNITED · <discipline>`, the OpenCode 2 home of the OpenCode 1 completion mark),
// and toasts. OpenCode 2 loads it on its own for an active server plugin. The server cannot raise toasts
// on OpenCode 2, so the ignition toast is inferred here from the lit mark the server writes into the user
// message metadata. It only reads state. OpenTUI and Solid come from the host at run time; tests pass a
// stand-in runtime.
import { activationDiscipline } from "../activation-probe.ts";
import { micro, supportsMarkGlyphs } from "../lit-mark.ts";
import { buildMissionView, leadingNotice, missionNotices, type MissionView } from "../tui/mission-model.ts";
import { idleMotion, motionTiming, planMotion, sampleMotion, type MotionState } from "../tui/mission-motion.ts";
import { latestLitMarkV2, missionStateFromV2, type MissionDataV2 } from "../tui/mission-source-v2.ts";
import { createLedgerReader, createWorkReader, missionProjectRoot, readLatestResearchRun, readMissionInput } from "../tui/mission-source.ts";
import { missionPanel, paletteFromTheme, panelWidth, type Line, type MissionPalette } from "../tui/mission-text.ts";

export type TuiRuntime = {
  readonly jsx: (type: string, props?: Record<string, unknown>) => unknown;
  readonly createSignal: <T>(value: T) => readonly [() => T, (value: T) => T];
  readonly createEffect: (fn: () => void) => void;
  readonly createRoot: <T>(fn: (dispose: () => void) => T) => T;
};

type PromptFooterInput = { readonly sessionID?: string; readonly mode: "normal" | "shell"; readonly showDetails: boolean };

export type SlotClaimLike =
  | { readonly append: "sidebar.content"; readonly render: (input: { readonly sessionID: string }) => unknown }
  | { readonly append: "prompt.footer.status"; readonly render: (input: PromptFooterInput) => unknown };

export type TuiContextLike = {
  readonly location: { readonly directory: string } | undefined;
  readonly theme: unknown;
  readonly themeMode: "dark" | "light";
  readonly ui: {
    readonly slot: (claim: SlotClaimLike) => () => void;
    readonly toast: { readonly show: (options: { readonly title?: string; readonly message: string; readonly variant?: "info" | "success" | "warning" | "error"; readonly duration?: number; readonly sessionID?: string }) => void };
  };
  readonly storage: { readonly store: <Value extends object>(key: string, options: { readonly initial: Value }) => readonly [Value, unknown] };
  readonly data: MissionDataV2 & {
    readonly listen: (handler: (event: { readonly details: { readonly type: string } }) => void) => () => void;
    readonly location: { default(): { readonly directory: string } };
  };
};

const refreshDelayMs = 80;
const ledgerPollMs = 2000;
const toastMs = 4000;
const ignitionToastMs = 6000;
const trackedSessionLimit = 4;
// A lit mark older than the moment a session is first drawn is history being loaded, not a new turn.
const historySlackMs = 2000;

type Entry = { view: MissionView; motion: MotionState };

async function hostRuntime(): Promise<TuiRuntime> {
  const [jsxRuntime, solid] = await Promise.all([import("@opentui/solid/jsx-runtime"), import("solid-js")]);
  return { jsx: jsxRuntime.jsx, createSignal: solid.createSignal as TuiRuntime["createSignal"], createEffect: solid.createEffect, createRoot: solid.createRoot };
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
  const directory = context.location?.directory ?? context.data.location.default().directory;
  const root = missionProjectRoot({ directory });
  const readLedger = createLedgerReader();
  const readWork = createWorkReader();
  const sessions = new Map<string, Entry>();
  const ignitions = new Map<string, string | undefined>();
  const trackedAt = new Map<string, number>();
  const tracked: string[] = [];
  // Each session's store watcher lives in its own root, so it outlasts the slot render that started it
  // and ends only on eviction or cleanup. After cleanup nothing may arm a timer again.
  const watchers = new Map<string, () => void>();
  let disposed = false;
  const [revision, setRevision] = ui.createSignal(0);
  const [clock, setClock] = ui.createSignal(Date.now());
  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

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

  function viewFor(sessionID: string, now: number): MissionView {
    const source = missionStateFromV2(context.data, directory);
    const records = { work: readWork(root, sessionID), research: readLatestResearchRun(root) };
    return buildMissionView(readMissionInput(source, sessionID, readLedger(root), now, {
      ...(records.work === undefined ? {} : { work: records.work }),
      ...(records.research === undefined ? {} : { research: records.research })
    }));
  }

  function anyMoving(now: number): boolean {
    for (const entry of sessions.values()) if (sampleMotion(entry.motion, now).moving) return true;
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

  function ignitionToast(sessionID: string, name: string): void {
    const label = `${ignitionLine(name)} 🔥`;
    const message = supportsMarkGlyphs() ? [...micro.map((row) => row.replace(/ +$/u, "")), label].join("\n") : label;
    context.ui.toast.show({ title: "🔥 LIT IGNITED", message, variant: "warning", duration: ignitionToastMs, sessionID });
  }

  function refresh(sessionID: string): void {
    if (disposed) return;
    const now = Date.now();
    const mark = latestLitMarkV2(context.data, sessionID);
    if (ignitions.get(sessionID) !== mark?.messageID) {
      ignitions.set(sessionID, mark?.messageID);
      if (mark !== undefined && mark.at >= (trackedAt.get(sessionID) ?? 0) - historySlackMs) ignitionToast(sessionID, mark.name);
    }
    const next = viewFor(sessionID, now);
    const entry = sessions.get(sessionID);
    if (entry !== undefined && JSON.stringify(entry.view) === JSON.stringify(next)) return;
    if (entry !== undefined) {
      const notice = leadingNotice(missionNotices(entry.view, next));
      if (notice !== undefined) context.ui.toast.show({ variant: notice.variant, title: notice.title, message: notice.message, duration: toastMs, sessionID });
    }
    sessions.set(sessionID, { view: next, motion: planMotion(entry?.view, next, now, entry?.motion ?? idleMotion, motionEnabled) });
    setClock(now);
    setRevision(revision() + 1);
    ensureFrames();
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
    sessions.set(sessionID, { view: viewFor(sessionID, now), motion: idleMotion });
    queueMicrotask(syncPoll);
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

  const releases = [
    context.ui.slot({
      append: "prompt.footer.status",
      render(input) {
        const sessionID = input.sessionID;
        if (sessionID === undefined) return null;
        track(sessionID);
        return () => {
          revision();
          const mark = latestLitMarkV2(context.data, sessionID);
          if (mark === undefined) return null;
          return ui.jsx("box", {
            flexShrink: 0,
            children: line([{ text: ignitionLine(mark.name), fg: palette().primary, bold: true }])
          });
        };
      }
    }),
    context.ui.slot({
      append: "sidebar.content",
      render(input) {
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
    })
  ];

  return async () => {
    disposed = true;
    for (const dispose of watchers.values()) dispose();
    watchers.clear();
    tracked.length = 0;
    unlisten();
    for (const release of releases) release();
    if (frameTimer !== undefined) clearInterval(frameTimer);
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    if (pollTimer !== undefined) clearInterval(pollTimer);
    sessions.clear();
    ignitions.clear();
    trackedAt.clear();
  };
}
