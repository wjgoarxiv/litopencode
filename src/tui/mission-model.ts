// The mission view model for the OpenCode TUI. It reads only what LitOpenCode already leaves behind:
// the `metadata.litopencode` marks the plugin attaches to user-message parts on activation and on
// commands, the host todo list and running tool, the evidence ledger in
// .litopencode/litgoal/lit-loop/goals.json, the bounded work record work-schema-3.json with its plan
// checklist, and litresearch run folders. No new state is written for the TUI.

export type LitMark = {
  readonly at: number;
  readonly mode?: string;
  readonly command?: string;
  readonly operation?: string;
  readonly blocked?: boolean;
};

export type TodoInput = { readonly content: string; readonly status: string };

/** The plan file's `- [ ]` / `- [x]` rows: how many are ticked, how many exist, and the first open one. */
export type PlanChecklist = { readonly done: number; readonly total: number; readonly next?: string };

/** This session's bounded work from work-schema-3.json: its status, recorded progress turns and plan. */
export type WorkInput = { readonly status: string; readonly iterations: number; readonly plan?: PlanChecklist; readonly boundary?: boolean };

export type ResearchStage = "decompose" | "wave" | "expand" | "verify" | "synthesis";

/** The latest litresearch run folder: what its journal, claim graph and report say so far. */
export type ResearchInput = {
  readonly stage: ResearchStage;
  readonly waves: number;
  readonly claims: number;
  readonly verified: number;
  readonly reported: boolean;
  /** Last write to the run folder, in ms; a run older than the session's first lit turn is earlier work. */
  readonly touchedAt: number;
};

/** The tool the session is running now: its name and start time only, never its input. */
export type LiveStep = { readonly tool: string; readonly start: number };

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
  readonly work?: WorkInput;
  readonly research?: ResearchInput;
  readonly live?: LiveStep;
  readonly now: number;
};

/**
 * Which stage table the map follows: the main chain, lit-loop's criterion loop (the same stages with
 * the work stage counting criteria), or a litresearch run.
 */
export type MissionFamily = "main" | "loop" | "research";
export type StepId = "interview" | "plan" | "work" | "review" | "done" | ResearchStage;
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
  readonly family: MissionFamily;
  readonly phase: StepId;
  readonly steps: readonly MissionStep[];
  readonly progress?: { readonly done: number; readonly total: number };
  readonly next?: string;
  /** The lead of the detail line: `task 3`, or a research run's claim counts. */
  readonly detail?: string;
  /** Recorded turns of the current loop: bounded work progress, or lit-loop goal checkpoints. */
  readonly iteration?: number;
  /** How many tasks the saved plan holds, shown beside the plan stage. */
  readonly planTasks?: number;
  readonly wave?: number;
  readonly live?: LiveStep;
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

export const familySteps: Readonly<Record<MissionFamily, readonly StepId[]>> = Object.freeze({
  main: Object.freeze(["interview", "plan", "work", "review", "done"] as const),
  loop: Object.freeze(["interview", "plan", "work", "review", "done"] as const),
  research: Object.freeze(["decompose", "wave", "expand", "verify", "synthesis"] as const)
});

export const idleMission: MissionView = Object.freeze({
  active: false,
  discipline: "",
  family: "main",
  phase: "plan",
  steps: Object.freeze(familySteps.main.map((id) => Object.freeze({ id, state: "todo" as const }))),
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
  if (name === "deep-interview" || name.endsWith("-interview")) return "interview";
  if (name === "review-work" || name.includes("review")) return "review";
  if (name === "lit-plan" || name.endsWith("-plan") || name === "lit-crucible") return "plan";
  return "work";
}

function isResearchName(name: string): boolean {
  return name === "litresearch" || name === "lit-research";
}

/** The name a stage shows: the loop counts criteria at its work stage and a research wave carries its number. */
export function stepName(id: StepId, view: Pick<MissionView, "family" | "wave">): string {
  if (id === "work" && view.family === "loop") return "criterion";
  if (id === "wave") return `wave ${Math.max(1, view.wave ?? 1)}`;
  return id;
}

/** Index of the stage that is running (or flagged); the step count once complete; -1 while idle. */
export function currentStepIndex(view: Pick<MissionView, "steps" | "complete" | "active">): number {
  if (!view.active) return -1;
  const index = view.steps.findIndex((step) => step.state === "now" || step.state === "warn");
  return index >= 0 ? index : view.complete ? view.steps.length : -1;
}

/**
 * Counts a plan's checkbox rows at column zero (`- [ ] 1. title — …`). The first open row, cut at its
 * em dash, becomes the next item. Indented rows are not tasks.
 */
export function planChecklist(text: string): PlanChecklist | undefined {
  let done = 0;
  let total = 0;
  let next: string | undefined;
  for (const line of text.split(/\r?\n/u)) {
    const match = /^- \[( |x|X)\] +(.*)$/u.exec(line);
    if (match === null) continue;
    total += 1;
    if (match[1] !== " ") done += 1;
    else if (next === undefined) next = match[2].split(" — ")[0].trim();
  }
  if (total === 0) return undefined;
  return { done, total, ...(next === undefined || next === "" ? {} : { next }) };
}

/**
 * Lenient read of work-schema-3.json for one session: undefined when it is absent, another session's,
 * cancelled, or not the schema-3 shape. Iterations count the recorded `work.progressed` turns.
 */
export function readWorkState(raw: unknown, sessionID: string): { readonly status: string; readonly iterations: number; readonly planPath: string; readonly boundary?: true } | undefined {
  if (!isRecord(raw) || raw.schemaVersion !== 3 || raw.sessionID !== sessionID) return undefined;
  const status = text(raw.status);
  if (status === "" || status === "cancelled") return undefined;
  const history = Array.isArray(raw.history) ? raw.history.filter(isRecord) : [];
  const plan = isRecord(raw.plan) ? text(raw.plan.path) : "";
  // A paused run holding a boundary waits for the user's typed approval.
  const boundary = status === "paused" && isRecord(raw.pendingBoundary);
  return { status, iterations: history.filter((entry) => entry.type === "work.progressed").length, planPath: plan, ...(boundary ? { boundary: true as const } : {}) };
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
  /** Written by the ledger CLI, whose completion gate checks evidence; a hand-written goal passed none. */
  readonly gated: boolean;
};

// The ledger CLI accepts `passed`, `failed` and `completed` as spellings of its own statuses; a goals.json
// the agent writes by hand also marks a finished criterion `completed` or `done`.
const criterionStatusSpellings: Readonly<Record<string, string>> = { passed: "pass", completed: "pass", complete: "pass", done: "pass", failed: "fail" };
const goalStatusSpellings: Readonly<Record<string, string>> = { completed: "complete", done: "complete" };

/**
 * Picks the goal out of goals.json: the ledger's active goal, else what an agent writes by hand —
 * a goal nested under `goal`, the last entry of a `goals` list, or one goal object at the top.
 */
function pickGoal(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const hasCriteria = (value: unknown): value is Record<string, unknown> => isRecord(value) && Array.isArray(value.criteria);
  if (Array.isArray(raw.goals)) {
    if (raw.activeGoalId !== undefined) {
      const active = raw.goals.find((candidate) => isRecord(candidate) && candidate.id === raw.activeGoalId);
      return isRecord(active) ? active : undefined;
    }
    return raw.goals.filter(hasCriteria).at(-1);
  }
  if (hasCriteria(raw.goal)) return raw.goal;
  return hasCriteria(raw) ? raw : undefined;
}

/** Lenient read of goals.json: the goal it names, or undefined when there is none. */
export function readActiveGoal(raw: unknown): LedgerGoal | undefined {
  if (!isRecord(raw)) return undefined;
  const goal = pickGoal(raw);
  if (goal === undefined) return undefined;
  const list = (value: unknown): readonly Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);
  const status = text(goal.status);
  return {
    gated: goal !== raw && Array.isArray(raw.goals) && raw.activeGoalId !== undefined,
    title: text(goal.title) || text(goal.objective),
    status: goalStatusSpellings[status] ?? status,
    createdAt: text(goal.createdAt),
    updatedAt: text(goal.updatedAt),
    criteria: list(goal.criteria).map((criterion) => ({
      id: text(criterion.id),
      scenario: text(criterion.scenario),
      status: criterionStatusSpellings[text(criterion.status)] ?? text(criterion.status),
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
  // A research run counts when this session started it or wrote to it; an older folder is earlier work.
  const research = input.research !== undefined && !(input.research.touchedAt < marks[0].at - staleGoalSlackMs) ? input.research : undefined;
  const researching = isResearchName(discipline) || (research !== undefined && !research.reported);
  const work = input.work;

  const counted = input.todos.filter((todo) => todo.status !== "cancelled");
  const planList = work?.plan;
  const progress = counted.length > 0
    ? { done: counted.filter((todo) => todo.status === "completed").length, total: counted.length }
    : planList !== undefined
      ? { done: planList.done, total: planList.total }
      : goal !== undefined && goal.criteria.length > 0
        ? { done: goal.criteria.filter((criterion) => criterion.status === "pass").length, total: goal.criteria.length }
        : undefined;
  const countsTasks = counted.length > 0 || planList !== undefined;
  const nextTodo = counted.find((todo) => todo.status === "in_progress") ?? counted.find((todo) => todo.status === "pending");
  const nextCriterion = goal?.criteria.find((criterion) => criterion.status !== "pass");
  const family: MissionFamily = researching ? "research" : !countsTasks && goal !== undefined && goal.criteria.length > 0 && /lit-?loop|litgoal/u.test(discipline) ? "loop" : "main";

  const blockers = (goal?.reviewBlockers ?? []).filter((blocker) => !blocker.resolved);
  const complete = researching
    ? research?.reported === true
    : goal?.status === "complete" || (progress !== undefined && progress.total > 0 && progress.done === progress.total && goal === undefined && countsTasks);

  let phase: StepId = latest === undefined ? agentStep ?? "work" : stepOf(latest.command ?? latest.mode ?? "") ?? "work";
  if (latest?.operation === "save-plan" && !planBlocked) phase = "work";
  // A blocker sends finished work back to review; with criteria still open the work phase carries the warning.
  const workComplete = progress === undefined || progress.done === progress.total;
  if (blockers.length > 0 || goal?.status === "review_blocked") phase = workComplete ? "review" : phase === "review" ? "review" : "work";
  if (researching) phase = research?.stage ?? "decompose";
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

  const order = familySteps[family];
  const position = complete ? order.length : order.indexOf(phase);
  const visited = (id: StepId): boolean => {
    if (id === "interview") return agentStep === "interview" || marks.some((mark) => stepOf(mark.command ?? mark.mode ?? "") === "interview");
    if (id === "plan") return planMark !== undefined || work !== undefined || agentStep === "plan" || marks.some((mark) => stepOf(mark.command ?? mark.mode ?? "") === "plan");
    // Finished todos alone prove no review; a review command, a review blocker or the goal ledger's
    // completion gate does.
    if (id === "review") return (goal?.status === "complete" && goal.gated) || blockers.length > 0 || (goal?.reviewBlockers.length ?? 0) > 0 || marks.some((mark) => stepOf(mark.command ?? mark.mode ?? "") === "review");
    return true;
  };
  const steps = order.map((id, index): MissionStep => {
    if (index < position) return { id, state: visited(id) ? "done" : "skip" };
    if (index > position) return { id, state: "todo" };
    return { id, state: warnings.length > 0 ? "warn" : "now" };
  });

  const iteration = work !== undefined && work.iterations > 0 ? work.iterations : family === "loop" && goal !== undefined && goal.checkpoints.length > 0 ? goal.checkpoints.length : undefined;
  const nextPlan = nextTodo === undefined ? planList?.next : undefined;
  const detail = family === "research"
    ? research === undefined ? undefined : `${research.claims} claims · ${research.verified} verified`
    : countsTasks && progress !== undefined && progress.done < progress.total ? `task ${progress.done + 1}` : undefined;
  const live = input.live !== undefined && (input.sessionStatus === "busy" || input.sessionStatus === "retry") ? input.live : undefined;

  return {
    active: true,
    discipline,
    family,
    phase,
    steps,
    ...(family === "research" || progress === undefined ? {} : { progress }),
    ...(family === "research"
      ? {}
      : nextTodo !== undefined
        ? { next: nextTodo.content }
        : nextPlan !== undefined
          ? { next: nextPlan }
          : nextCriterion !== undefined ? { next: `${nextCriterion.id} ${nextCriterion.scenario}`.trim() } : {}),
    ...(detail === undefined ? {} : { detail }),
    ...(iteration === undefined ? {} : { iteration }),
    ...(planList === undefined ? {} : { planTasks: planList.total }),
    ...(family === "research" && research !== undefined && research.waves > 0 ? { wave: research.waves } : {}),
    ...(live === undefined ? {} : { live }),
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
  view.steps.forEach((step, index) => keys.push(...(index === 0 ? [] : [`link:${index}`]), `step:${step.id}`));
  if (view.progress !== undefined) keys.push("bar");
  const line = (view.next !== undefined || view.detail !== undefined) && !view.complete;
  const live = view.live !== undefined && !view.complete;
  if (line || live || view.goal !== undefined || view.warnings.length > 0) keys.push("b2");
  if (line) keys.push("detail");
  if (live) keys.push("live");
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
