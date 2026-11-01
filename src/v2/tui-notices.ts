// The toasts OpenCode 2 raises beyond the shared gate events (plan saved, goal set, criterion passed,
// blockers, complete): the workflow stage moving, a discipline switching, a lane starting or finishing.
// They are pure: the TUI hands in the previous and next view and thread rows and gets notices back,
// which leadingNotice folds into one toast with a `+N more` tail.
import { stepName, type MissionNotice, type MissionView } from "../tui/mission-model.ts";
import type { ThreadRow } from "../tui/mission-threads.ts";

const maxNamed = 1;

function runningStage(view: MissionView): { readonly id: string; readonly label: string } | undefined {
  const step = view.steps.find((candidate) => candidate.state === "now");
  if (step === undefined) return undefined;
  const count = view.progress !== undefined && view.progress.total > 0 ? ` ${view.progress.done}/${view.progress.total}` : "";
  return { id: `${view.family}:${step.id}`, label: `${stepName(step.id, view)}${count}` };
}

function laneNotice(rows: readonly ThreadRow[], verb: "started" | "finished"): MissionNotice | undefined {
  if (rows.length === 0) return undefined;
  const message = rows.length > maxNamed ? `${rows.length} lanes ${verb}` : `lane ${verb} · ${rows[0].name}`;
  return { variant: "info", title: "🔥 Lane", message };
}

/**
 * Stage, discipline and lane changes between two views. A first view never toasts its history. A lane
 * counts as started when its key is new and working, and as finished when a working lane is gone or done.
 */
export function v2StageNotices(
  prev: MissionView | undefined,
  next: MissionView,
  before: readonly ThreadRow[],
  after: readonly ThreadRow[]
): readonly MissionNotice[] {
  if (prev === undefined || !next.active) return [];
  const notices: MissionNotice[] = [];
  if (prev.active && prev.discipline !== next.discipline && next.discipline !== "") {
    notices.push({ variant: "info", title: `🔥 ${prev.discipline} → ${next.discipline}`, message: "Discipline switched." });
  } else if (prev.active && !next.complete) {
    const was = runningStage(prev);
    const now = runningStage(next);
    if (was !== undefined && now !== undefined && was.id !== now.id) notices.push({ variant: "info", title: "🔥 Stage", message: now.label });
  }
  const priorKeys = new Set(before.map((row) => row.key));
  const nextByKey = new Map(after.map((row) => [row.key, row]));
  const started = after.filter((row) => row.status === "working" && !priorKeys.has(row.key));
  const finished = before.filter((row) => row.status === "working" && (nextByKey.get(row.key) === undefined || nextByKey.get(row.key)?.status === "done"));
  for (const notice of [laneNotice(started, "started"), laneNotice(finished, "finished")]) if (notice !== undefined) notices.push(notice);
  return notices;
}
