// The mission view model for the OpenCode TUI. It reads only what LitOpenCode already leaves behind:
// the `metadata.litopencode` marks the plugin attaches to user-message parts on activation and on
// commands, the host todo list, and the evidence ledger in .litopencode/litgoal/lit-loop/goals.json.
// No new state is written for the TUI.

export type LitMark = {
  readonly at: number;
  readonly mode?: string;
  readonly command?: string;
  readonly operation?: string;
  readonly blocked?: boolean;
};

export type TodoInput = { readonly content: string; readonly status: string };

export type MissionInput = {
  readonly marks: readonly LitMark[];
  readonly agent?: string;
  readonly todos: readonly TodoInput[];
  readonly ledger?: unknown;
  readonly sessionStatus?: string;
  readonly retryMessage?: string;
  readonly pendingPermissions?: number;
  readonly pendingQuestions?: number;
  readonly contextPercent?: number | null;
  readonly now: number;
};

export type StepId = "plan" | "work" | "review";
// "skip" marks a phase this session passed without doing it, such as planning for a bounded lit-task.
export type StepState = "done" | "skip" | "now" | "todo" | "warn";
export type MissionStep = { readonly id: StepId; readonly state: StepState };

export type MissionWarning = { readonly kind: "blocker" | "decision" | "retry" | "permission" | "question" | "context" | "plan"; readonly text: string };

export type MissionCriterion = { readonly id: string; readonly status: string };

export type MissionGoal = {
  readonly title: string;
  readonly status: string;
  readonly passed: number;
  readonly total: number;
  readonly criteria: readonly MissionCriterion[];
};

export type MissionEvent = { readonly ago: string; readonly kind: string; readonly label: string };

export type MissionView = {
  readonly active: boolean;
  readonly discipline: string;
  readonly phase: StepId | "done";
  readonly steps: readonly MissionStep[];
  readonly progress?: { readonly done: number; readonly total: number };
  readonly next?: string;
  readonly goal?: MissionGoal;
  readonly blockers: readonly { readonly id: string; readonly detail: string; readonly needsUserDecision: boolean }[];
  readonly warnings: readonly MissionWarning[];
  readonly timeline: readonly MissionEvent[];
  readonly planSaved: boolean;
  readonly complete: boolean;
  /** Whole minutes since this session's first lit turn; only an active view carries it. */
  readonly elapsedMinutes?: number;
};

export type MissionNotice = {
  readonly variant: "info" | "success" | "warning" | "error";
  readonly title: string;
  readonly message: string;
  readonly celebrate?: boolean;
};

export const contextWarnPercent = 75;

const timelineLimit = 4;
const staleGoalSlackMs = 60_000;

export const idleMission: MissionView = Object.freeze({
  active: false,
  discipline: "",
  phase: "plan",
  steps: Object.freeze([
    { id: "plan", state: "todo" },
    { id: "work", state: "todo" },
    { id: "review", state: "todo" }
  ] as const),
  blockers: Object.freeze([]),
  warnings: Object.freeze([]),
  timeline: Object.freeze([]),
  planSaved: false,
  complete: false
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Reads one part's `metadata.litopencode` mark. Anything without that shape is not a mark. */
export function readLitMark(metadata: unknown, at: number): LitMark | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.litopencode)) return undefined;
  const mark = metadata.litopencode;
  const mode = text(mark.mode);
  const command = text(mark.command);
  if (mode === "" && command === "") return undefined;
  return {
    at,
    ...(mode === "" ? {} : { mode }),
    ...(command === "" ? {} : { command }),
    ...(text(mark.operation) === "" ? {} : { operation: text(mark.operation) }),
    ...(mark.blocked === true ? { blocked: true } : {})
  };
}

function stepOf(name: string): StepId | undefined {
  if (name === "") return undefined;
  if (name === "review-work" || name.includes("review")) return "review";
  if (name === "lit-plan" || name.endsWith("-plan") || name === "lit-crucible" || name === "deep-interview") return "plan";
  return "work";
}

type LedgerCriterion = { readonly id: string; readonly scenario: string; readonly status: string; readonly evidence: readonly { readonly kind: string; readonly ref: string; readonly at: string }[] };
type LedgerGoal = {
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly criteria: readonly LedgerCriterion[];
  readonly checkpoints: readonly { readonly summary: string; readonly at: string }[];
  readonly reviewBlockers: readonly { readonly id: string; readonly detail: string; readonly resolved: boolean; readonly needsUserDecision: boolean }[];
};

/** Lenient read of goals.json: the active goal, or undefined when the file is absent or not the ledger shape. */
export function readActiveGoal(raw: unknown): LedgerGoal | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.goals)) return undefined;
  const goal = raw.goals.find((candidate) => isRecord(candidate) && candidate.id === raw.activeGoalId);
  if (!isRecord(goal)) return undefined;
  const list = (value: unknown): readonly Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);
  return {
    title: text(goal.title) || text(goal.objective),
    status: text(goal.status),
    createdAt: text(goal.createdAt),
    updatedAt: text(goal.updatedAt),
    criteria: list(goal.criteria).map((criterion) => ({
      id: text(criterion.id),
      scenario: text(criterion.scenario),
      status: text(criterion.status),
      evidence: list(criterion.evidence).map((entry) => ({ kind: text(entry.kind), ref: text(entry.ref), at: text(entry.at) }))
    })),
    checkpoints: list(goal.checkpoints).map((entry) => ({ summary: text(entry.summary), at: text(entry.at) })),
    reviewBlockers: list(goal.reviewBlockers).map((entry) => ({
      id: text(entry.id),
      detail: text(entry.detail),
      resolved: entry.resolved === true,
      needsUserDecision: entry.needsUserDecision === true
    }))
  };
}

export function formatAgo(at: string, now: number): string {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function timeline(goal: LedgerGoal, now: number): readonly MissionEvent[] {
  const events: { readonly at: number; readonly raw: string; readonly kind: string; readonly label: string }[] = [];
  for (const criterion of goal.criteria) {
    for (const entry of criterion.evidence) {
      events.push({ at: Date.parse(entry.at), raw: entry.at, kind: entry.kind, label: `${criterion.id} ${entry.ref}`.trim() });
    }
  }
  for (const checkpoint of goal.checkpoints) {
    events.push({ at: Date.parse(checkpoint.at), raw: checkpoint.at, kind: "checkpoint", label: checkpoint.summary });
  }
  if (goal.createdAt !== "") events.push({ at: Date.parse(goal.createdAt), raw: goal.createdAt, kind: "goal", label: "created" });
  return events
    .filter((event) => Number.isFinite(event.at))
    .sort((left, right) => right.at - left.at)
    .slice(0, timelineLimit)
    .map((event) => ({ ago: formatAgo(event.raw, now), kind: event.kind, label: event.label }));
}

export function buildMissionView(input: MissionInput): MissionView {
  const marks = [...input.marks].sort((left, right) => left.at - right.at);
  const agentStep = input.agent?.startsWith("lit-") === true ? stepOf(input.agent) : undefined;
  const latest = marks.at(-1);
  // The ledger is per project. A goal last touched before this session's first lit turn belongs to
  // earlier work, so a fresh session does not open on someone else's finished goal.
  const ledgerGoal = readActiveGoal(input.ledger);
  const touched = ledgerGoal === undefined ? Number.NaN : Date.parse(ledgerGoal.updatedAt || ledgerGoal.createdAt);
  const goal = ledgerGoal !== undefined && marks.length > 0 && !(touched < marks[0].at - staleGoalSlackMs) ? ledgerGoal : undefined;
  // lit-loop is LitOpenCode's default agent, so the agent alone never lights the mission; only a lit
  // activation or a lit command recorded in this session does.
  const active = marks.length > 0;
  if (!active) return idleMission;

  const planMark = [...marks].reverse().find((mark) => mark.operation === "save-plan");
  const planSaved = planMark !== undefined && planMark.blocked !== true;
  const planBlocked = planMark?.blocked === true;
  const discipline = latest?.mode && latest.mode !== "bounded-authority-lifecycle" ? latest.mode : latest?.command ?? input.agent ?? "lit";

  const counted = input.todos.filter((todo) => todo.status !== "cancelled");
  const progress = counted.length > 0
    ? { done: counted.filter((todo) => todo.status === "completed").length, total: counted.length }
    : goal !== undefined && goal.criteria.length > 0
      ? { done: goal.criteria.filter((criterion) => criterion.status === "pass").length, total: goal.criteria.length }
      : undefined;
  const nextTodo = counted.find((todo) => todo.status === "in_progress") ?? counted.find((todo) => todo.status === "pending");
  const nextCriterion = goal?.criteria.find((criterion) => criterion.status !== "pass");

  const blockers = (goal?.reviewBlockers ?? []).filter((blocker) => !blocker.resolved);
  const complete = goal?.status === "complete" || (progress !== undefined && progress.total > 0 && progress.done === progress.total && goal === undefined && counted.length > 0);

  let phase: StepId | "done" = latest === undefined ? agentStep ?? "work" : stepOf(latest.command ?? latest.mode ?? "") ?? "work";
  if (latest?.operation === "save-plan" && !planBlocked) phase = "work";
  // A blocker sends finished work back to review; with criteria still open the work phase carries the warning.
  const workComplete = progress === undefined || progress.done === progress.total;
  if (blockers.length > 0 || goal?.status === "review_blocked") phase = workComplete ? "review" : phase === "review" ? "review" : "work";
  if (complete) phase = "done";

  const warnings: MissionWarning[] = [];
  for (const blocker of blockers) {
    warnings.push({ kind: blocker.needsUserDecision ? "decision" : "blocker", text: `${blocker.id} ${blocker.detail}`.trim() });
  }
  if (goal?.status === "needs_user_decision" && !blockers.some((blocker) => blocker.needsUserDecision)) {
    warnings.push({ kind: "decision", text: "goal needs your decision" });
  }
  if (planBlocked && phase === "plan") warnings.push({ kind: "plan", text: "plan not saved yet" });
  if (input.sessionStatus === "retry") warnings.push({ kind: "retry", text: input.retryMessage ? `retrying · ${input.retryMessage}` : "retrying" });
  if ((input.pendingPermissions ?? 0) > 0) warnings.push({ kind: "permission", text: "waiting for permission" });
  if ((input.pendingQuestions ?? 0) > 0) warnings.push({ kind: "question", text: "waiting for your answer" });
  if (typeof input.contextPercent === "number" && input.contextPercent >= contextWarnPercent) {
    warnings.push({ kind: "context", text: `ctx ${Math.round(input.contextPercent)}%` });
  }

  const order: readonly StepId[] = ["plan", "work", "review"];
  const position = phase === "done" ? order.length : order.indexOf(phase);
  const planned = planMark !== undefined || agentStep === "plan" || marks.some((mark) => stepOf(mark.command ?? mark.mode ?? "") === "plan");
  const steps = order.map((id, index): MissionStep => {
    if (index < position) return { id, state: id === "plan" && !planned ? "skip" : "done" };
    if (index > position) return { id, state: "todo" };
    return { id, state: warnings.length > 0 ? "warn" : "now" };
  });

  return {
    active: true,
    discipline,
    phase,
    steps,
    ...(progress === undefined ? {} : { progress }),
    ...(nextTodo !== undefined ? { next: nextTodo.content } : nextCriterion !== undefined ? { next: `${nextCriterion.id} ${nextCriterion.scenario}`.trim() } : {}),
    ...(goal === undefined
      ? {}
      : {
          goal: {
            title: goal.title,
            status: goal.status,
            passed: goal.criteria.filter((criterion) => criterion.status === "pass").length,
            total: goal.criteria.length,
            criteria: goal.criteria.map((criterion) => ({ id: criterion.id, status: criterion.status }))
          }
        }),
    blockers: blockers.map((blocker) => ({ id: blocker.id, detail: blocker.detail, needsUserDecision: blocker.needsUserDecision })),
    warnings,
    timeline: goal === undefined ? [] : timeline(goal, input.now),
    planSaved,
    complete,
    elapsedMinutes: Math.max(0, Math.floor((input.now - marks[0].at) / 60_000))
  };
}

const noticeRank: Readonly<Record<MissionNotice["variant"], number>> = { error: 3, warning: 2, success: 1, info: 0 };

/**
 * OpenCode shows one toast at a time, so several gate events from one refresh collapse into the most
 * urgent one (completion first), with the rest counted in its message. The panel still lists them all.
 */
export function leadingNotice(notices: readonly MissionNotice[]): MissionNotice | undefined {
  if (notices.length <= 1) return notices[0];
  const lead = [...notices].sort((left, right) => Number(right.celebrate === true) - Number(left.celebrate === true) || noticeRank[right.variant] - noticeRank[left.variant])[0];
  return { ...lead, message: `${lead.message} · +${notices.length - 1} more` };
}

/** The gate events between two views. A first view never toasts its whole history. */
export function missionNotices(prev: MissionView | undefined, next: MissionView): readonly MissionNotice[] {
  if (prev === undefined || !next.active) return [];
  const notices: MissionNotice[] = [];
  if (prev.active && !prev.planSaved && next.planSaved) {
    notices.push({ variant: "success", title: "🔥 Plan saved", message: "Work can start from the saved plan." });
  }
  if (!prev.warnings.some((warning) => warning.kind === "plan") && next.warnings.some((warning) => warning.kind === "plan")) {
    notices.push({ variant: "warning", title: "🔥 Plan not saved yet", message: "Save the plan under .litopencode/plans before work starts." });
  }
  if (prev.goal === undefined && next.goal !== undefined) {
    notices.push({ variant: "info", title: "🔥 Goal set", message: `${next.goal.title} · ${next.goal.total} criteria` });
  }
  if (prev.goal !== undefined && next.goal !== undefined) {
    for (const criterion of next.goal.criteria) {
      const before = prev.goal.criteria.find((candidate) => candidate.id === criterion.id);
      if (criterion.status === "pass" && before?.status !== "pass") {
        notices.push({ variant: "success", title: `✓ ${criterion.id} passed`, message: `${next.goal.passed}/${next.goal.total} criteria` });
      }
    }
  }
  for (const blocker of next.blockers) {
    if (!prev.blockers.some((candidate) => candidate.id === blocker.id)) {
      notices.push({
        variant: "warning",
        title: blocker.needsUserDecision ? "⚑ Needs your decision" : "⚑ Review blocker",
        message: `${blocker.id} ${blocker.detail}`.trim()
      });
    }
  }
  for (const blocker of prev.blockers) {
    if (!next.blockers.some((candidate) => candidate.id === blocker.id)) {
      notices.push({ variant: "info", title: `✓ ${blocker.id} resolved`, message: blocker.detail });
    }
  }
  if (!prev.complete && next.complete) {
    const message = next.goal !== undefined
      ? `${next.goal.title} · ${next.goal.passed}/${next.goal.total} criteria`
      : `${next.progress?.done ?? 0}/${next.progress?.total ?? 0} tasks`;
    notices.push({ variant: "success", title: "🔥 Complete", message, celebrate: true });
  }
  return notices;
}

const warningStatus: Readonly<Record<MissionWarning["kind"], string>> = {
  blocker: "review blocked",
  decision: "needs decision",
  retry: "retrying",
  permission: "permission asked",
  question: "question asked",
  context: "context high",
  plan: "plan not saved"
};

/** The short status beside the header: always a glyph plus words, never colour alone. */
export function missionStatus(view: MissionView): { readonly glyph: string; readonly text: string; readonly tone: "info" | "warning" | "success" } {
  if (view.complete) return { glyph: "✓", text: "COMPLETE", tone: "success" };
  const warning = view.warnings[0];
  if (warning !== undefined) return { glyph: "⚑", text: warning.kind === "context" ? warning.text : warningStatus[warning.kind], tone: "warning" };
  return { glyph: "●", text: view.goal === undefined ? "working" : "active", tone: "info" };
}

/**
 * Stable keys for the panel rows a view shows. Motion compares two views' keys to decide which rows
 * slide in, so a new goal animates its own rows without replaying the header.
 */
export function missionRowKeys(view: MissionView): readonly string[] {
  if (!view.active) return [];
  const keys = ["h1", "h2", "b1"];
  if (view.goal !== undefined) keys.push("title");
  keys.push("steps");
  if (view.progress !== undefined) keys.push("bar");
  const detail = (view.next !== undefined && !view.complete) || view.goal !== undefined || view.warnings.length > 0;
  if (detail) keys.push("b2");
  if (view.next !== undefined && !view.complete) keys.push("next");
  if (view.goal !== undefined) keys.push("crit");
  view.warnings.forEach((warning) => keys.push(`warn:${warning.kind}:${warning.text}`));
  if (view.timeline.length > 0) {
    keys.push("b3", "evh");
    view.timeline.forEach((_event, index) => keys.push(`ev${index}`));
  }
  return keys;
}

/** The project's last goal for the home line, or undefined when the ledger holds none. */
export function lastMission(raw: unknown): { readonly title: string; readonly passed: number; readonly total: number; readonly complete: boolean } | undefined {
  const goal = readActiveGoal(raw);
  if (goal === undefined || goal.title === "") return undefined;
  return {
    title: goal.title,
    passed: goal.criteria.filter((criterion) => criterion.status === "pass").length,
    total: goal.criteria.length,
    complete: goal.status === "complete"
  };
}
