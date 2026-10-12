// LitOpenCode's TUI plugin: a phase chip beside the prompt, a mission panel in the session sidebar,
// a status card with skill chips along the bottom, toasts for gate events and a short completion moment. OpenCode loads it from the package's `./tui`
// export through the `plugin` list in tui.json. It only reads state; the server plugin owns writes.
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createEffect, createMemo, createSignal } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { jsx } from "@opentui/solid/jsx-runtime";
import { buildMissionView, lastMission, leadingNotice, missionNotices, type MissionView } from "./tui/mission-model.ts";
import { idleMotion, motionTiming, planMotion, sampleMotion, type MotionState } from "./tui/mission-motion.ts";
import { chipBudget, chipLine, homeLine, missionPanel, paletteFromTheme, panelWidth, type Line, type MissionPalette } from "./tui/mission-text.ts";
import { createLedgerReader, missionProjectRoot, readCardInput, readMissionInput, type CardInput, type MissionStateSource } from "./tui/mission-source.ts";
import { chipShimmer, idleChipMotion, planChipMotion, type ChipMotion } from "./tui/mission-skills.ts";
import { bandCard, readBandOptions, statusCard } from "./tui/mission-band.ts";

export const litOpenCodeTuiPluginId = "litopencode";

const homeLineWidth = 69;
const refreshDelayMs = 80;
const ledgerPollMs = 2000;
const toastMs = 4000;
const trackedSessionLimit = 4;
const refreshEvents = [
  "message.updated",
  "message.part.updated",
  "todo.updated",
  "session.status",
  "session.idle",
  "session.error",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected"
] as const;

type SessionEntry = { view: MissionView; card: CardInput; motion: MotionState; chipMotion: ChipMotion };

function spanFor(segment: Line[number]): unknown {
  return jsx("span", {
    style: { fg: segment.fg, ...(segment.bg === undefined ? {} : { bg: segment.bg }), ...(segment.bold === true ? { bold: true } : {}) },
    children: segment.text
  });
}

function lineElement(line: Line): unknown {
  return jsx("text", { wrapMode: "none", children: line.length === 0 ? " " : line.map(spanFor) });
}

const tui: TuiPlugin = async (api: TuiPluginApi, options) => {
  const motionEnabled = (options as Record<string, unknown> | undefined)?.motion !== false;
  const band = readBandOptions(options);
  const readLedger = createLedgerReader();
  const sessions = new Map<string, SessionEntry>();
  const tracked: string[] = [];
  const [revision, setRevision] = createSignal(0);
  const [clock, setClock] = createSignal(Date.now());
  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const state = (): MissionStateSource => api.state as unknown as MissionStateSource;
  const palette = (): MissionPalette => paletteFromTheme(api.theme.current as unknown as Record<string, unknown>, api.theme.mode());

  // OpenCode keeps the sidebar choice in its KV store under "sidebar" ("auto" or "hide"); a child
  // session never shows the sidebar. Before the store is ready the setting is unknown.
  function sidebarSetting(): string | undefined {
    if (!api.kv.ready) return undefined;
    const value = api.kv.get<unknown>("sidebar", "auto");
    return typeof value === "string" ? value : undefined;
  }

  function isChildSession(sessionID: string): boolean {
    const session = api.state.session.get(sessionID) as { readonly parentID?: string } | undefined;
    return typeof session?.parentID === "string" && session.parentID !== "";
  }

  function anyMoving(now: number): boolean {
    for (const entry of sessions.values()) if (sampleMotion(entry.motion, now).moving || chipShimmer(entry.chipMotion, now) !== undefined) return true;
    return false;
  }

  // The frame timer runs only while a track is moving; an idle session draws nothing new.
  function ensureFrames(): void {
    if (frameTimer !== undefined || !anyMoving(Date.now())) return;
    frameTimer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (!anyMoving(now)) {
        clearInterval(frameTimer);
        frameTimer = undefined;
      }
    }, motionTiming.frameMs);
  }

  function refresh(sessionID: string): void {
    const now = Date.now();
    const source = state();
    const ledger = readLedger(missionProjectRoot(source.path));
    const next = buildMissionView(readMissionInput(source, sessionID, ledger, now));
    const card = readCardInput(source, sessionID);
    const entry = sessions.get(sessionID);
    const viewChanged = entry === undefined || JSON.stringify(entry.view) !== JSON.stringify(next);
    if (!viewChanged && JSON.stringify(entry.card) === JSON.stringify(card)) return;
    if (entry !== undefined && viewChanged) {
      const notice = leadingNotice(missionNotices(entry.view, next));
      if (notice !== undefined) api.ui.toast({ variant: notice.variant, title: notice.title, message: notice.message, duration: toastMs });
    }
    sessions.set(sessionID, {
      view: next,
      card,
      motion: viewChanged ? planMotion(entry?.view, next, now, entry?.motion ?? idleMotion, motionEnabled) : entry.motion,
      chipMotion: planChipMotion(entry?.card.chips, card.chips, now, entry?.chipMotion ?? idleChipMotion, motionEnabled)
    });
    setClock(now);
    setRevision(revision() + 1);
    ensureFrames();
  }

  function refreshTracked(): void {
    refreshTimer = undefined;
    for (const sessionID of tracked) refresh(sessionID);
    syncPoll();
  }

  // Ledger writes from a terminal or another session fire no TUI event, so an active mission
  // re-reads goals.json (one lstat while unchanged) every two seconds. Idle sessions do not poll.
  function syncPoll(): void {
    const active = [...sessions.values()].some((entry) => entry.view.active);
    if (active && pollTimer === undefined) pollTimer = setInterval(refreshTracked, ledgerPollMs);
    if (!active && pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer === undefined) refreshTimer = setTimeout(refreshTracked, refreshDelayMs);
  }

  function track(sessionID: string): void {
    if (tracked.includes(sessionID)) return;
    tracked.push(sessionID);
    if (tracked.length > trackedSessionLimit) sessions.delete(tracked.shift() ?? "");
    queueMicrotask(() => {
      refresh(sessionID);
      syncPoll();
    });
  }

  // Opening a session loads its messages and parts over HTTP, which fires no bus event. Reading the
  // reactive store here re-runs this effect as they arrive, so a resumed session lights up too and its
  // skill calls come back as chips.
  function watchSession(sessionID: string): void {
    createEffect(() => {
      const source = state();
      for (const message of source.session.messages(sessionID)) void source.part(message.id).length;
      void source.session.todo(sessionID).length;
      void source.session.status(sessionID)?.type;
      scheduleRefresh();
    });
  }

  function sessionView(sessionID: string): () => { readonly view: MissionView; readonly frame: ReturnType<typeof sampleMotion> } | undefined {
    return () => {
      revision();
      const entry = sessions.get(sessionID);
      if (entry === undefined || !entry.view.active) return undefined;
      return { view: entry.view, frame: sampleMotion(entry.motion, clock()) };
    };
  }

  // The band shows every session, lit or not, so it reads the entry whether or not the mission is active.
  function cardView(sessionID: string): () => (SessionEntry & { readonly frame: ReturnType<typeof sampleMotion>; readonly now: number }) | undefined {
    return () => {
      revision();
      const entry = sessions.get(sessionID);
      const now = clock();
      return entry === undefined ? undefined : { ...entry, frame: sampleMotion(entry.motion, now), now };
    };
  }

  for (const type of refreshEvents) {
    api.event.on(type as Parameters<TuiPluginApi["event"]["on"]>[0], scheduleRefresh);
  }

  api.lifecycle.onDispose(() => {
    if (frameTimer !== undefined) clearInterval(frameTimer);
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    if (pollTimer !== undefined) clearInterval(pollTimer);
    sessions.clear();
  });

  api.slots.register({
    order: 50,
    slots: {
      session_prompt_right(_ctx: unknown, props: { readonly session_id: string }) {
        track(props.session_id);
        watchSession(props.session_id);
        const current = sessionView(props.session_id);
        const dimensions = useTerminalDimensions();
        const visible = createMemo(() => current() !== undefined);
        return () => {
          if (!visible()) return null;
          return jsx("box", {
            flexDirection: "row",
            flexShrink: 0,
            children: () => {
              const snapshot = current();
              if (snapshot === undefined) return null;
              const budget = chipBudget({ width: dimensions().width, sidebar: sidebarSetting(), child: isChildSession(props.session_id) });
              return lineElement(chipLine(snapshot.view, snapshot.frame, palette(), budget));
            }
          });
        };
      },
      sidebar_content(_ctx: unknown, props: { readonly session_id: string }) {
        track(props.session_id);
        watchSession(props.session_id);
        const current = sessionView(props.session_id);
        const panel = createMemo(() => {
          const snapshot = current();
          return snapshot === undefined ? undefined : missionPanel(snapshot.view, snapshot.frame, palette());
        });
        const visible = createMemo(() => panel() !== undefined);
        return () => {
          if (!visible()) return null;
          // Props are getters so the border, titles and fill follow each frame without rebuilding the box.
          return jsx("box", {
            border: true,
            borderStyle: "rounded",
            width: panelWidth,
            flexShrink: 0,
            flexDirection: "column",
            paddingLeft: 1,
            paddingRight: 1,
            titleAlignment: "left",
            bottomTitleAlignment: "right",
            get borderColor() { return panel()?.border; },
            get title() { return panel()?.title; },
            get titleColor() { return panel()?.titleColor; },
            get bottomTitle() { return panel()?.bottomTitle ?? ""; },
            get backgroundColor() { return panel()?.background ?? "transparent"; },
            children: () => (panel()?.rows ?? []).map(lineElement)
          });
        };
      }
    }
  });

  // The band: a four-row status card under every session route in app_bottom, idle or working. It
  // follows the session on screen; a child (subagent) session shows its parent's mission as a lane.
  // Home shows no band.
  if (band.enabled) {
    api.slots.register({
      order: 50,
      slots: {
        app_bottom() {
          const dimensions = useTerminalDimensions();
          const target = createMemo(() => {
            const route = api.route.current as { readonly name: string; readonly params?: { readonly sessionID?: unknown } };
            const id = route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined;
            if (id === undefined) return undefined;
            const parent = (api.state.session.get(id) as { readonly parentID?: string } | undefined)?.parentID;
            return typeof parent === "string" && parent !== "" ? { sessionID: parent, inLane: true } : { sessionID: id, inLane: false };
          });
          createEffect(() => {
            const place = target();
            if (place === undefined) return;
            track(place.sessionID);
            watchSession(place.sessionID);
          });
          const current = createMemo(() => {
            const place = target();
            const snapshot = place === undefined ? undefined : cardView(place.sessionID)();
            return snapshot === undefined || place === undefined ? undefined : { ...snapshot, inLane: place.inLane };
          });
          const visible = createMemo(() => current() !== undefined);
          return () => {
            if (!visible()) return null;
            return jsx("box", {
              flexDirection: "column",
              flexShrink: 0,
              paddingLeft: 1,
              paddingRight: 1,
              get backgroundColor() { return palette().panel ?? "transparent"; },
              children: () => {
                const snapshot = current();
                if (snapshot === undefined) return null;
                const colors = palette();
                const width = dimensions().width - 2;
                const last = snapshot.view.active ? undefined : lastMission(readLedger(missionProjectRoot(state().path)));
                const shimmer = chipShimmer(snapshot.chipMotion, snapshot.now);
                const lines = statusCard({
                  view: snapshot.view,
                  frame: snapshot.frame,
                  chips: snapshot.card.chips,
                  ...(shimmer === undefined ? {} : { shimmer }),
                  figures: { contextPercent: snapshot.card.contextPercent, ...(snapshot.card.branch === undefined ? {} : { branch: snapshot.card.branch }), inLane: snapshot.inLane },
                  ...(last === undefined ? {} : { last })
                }, colors, width);
                const rows: unknown[] = lines.map(lineElement);
                const card = band.card ? bandCard(snapshot.view, snapshot.frame, colors, width) : undefined;
                if (card !== undefined) {
                  rows.push(jsx("box", {
                    border: true,
                    borderStyle: "rounded",
                    borderColor: card.border,
                    title: card.title,
                    titleColor: colors.text,
                    paddingLeft: 1,
                    paddingRight: 1,
                    flexShrink: 0,
                    flexDirection: "column",
                    children: card.rows.map(lineElement)
                  }));
                }
                return rows;
              }
            });
          };
        }
      }
    });
  }

  // After the built-in home tips (order 100): one line about the project's last mission, if any.
  api.slots.register({
    order: 150,
    slots: {
      home_bottom() {
        const dimensions = useTerminalDimensions();
        const line = createMemo(() => {
          revision();
          return homeLine(lastMission(readLedger(missionProjectRoot(state().path))), palette(), Math.min(homeLineWidth, dimensions().width - 10));
        });
        return () => {
          const segments = line();
          return segments.length === 0 ? null : jsx("box", { flexDirection: "row", justifyContent: "center", flexShrink: 0, children: lineElement(segments) });
        };
      }
    }
  });
};

const plugin: TuiPluginModule & { readonly id: string } = {
  id: litOpenCodeTuiPluginId,
  tui
};

export default plugin;
