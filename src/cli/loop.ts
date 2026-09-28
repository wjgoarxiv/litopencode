import {
  completeGoals,
  createGoals,
  EvidenceLedgerError,
  evaluateGoalGate,
  readEvidenceLedgerStatus,
  recordCheckpoint,
  recordEvidence,
  recordReviewBlocker,
  recordSteering,
  resolveReviewBlocker,
  type Goal
} from "../ledger.ts";
import { createRuntimePaths } from "../state.ts";
import type { CliResult, LoopArgs } from "./types.ts";
import type { LoopCommand } from "./args.ts";

// Exit codes are distinct so a caller can tell a refusal from a usage error: 2 is a malformed
// invocation, 3 is a deliberate refusal, 1 is a gate that did not pass.
const usageExit = 2;
const refusedExit = 3;
const gateExit = 1;

function requireOption(value: string | undefined, option: string): string {
  if (value === undefined || value.trim() === "") throw new UsageError(`${option} is required`);
  return value;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function ok(loop: LoopArgs, payload: Record<string, unknown>, text: string): CliResult {
  return { exitCode: 0, stdout: loop.json ? `${JSON.stringify(payload, null, 2)}` : text };
}

function describeGoal(goal: Goal): string {
  const gate = evaluateGoalGate(goal);
  const lines = [
    `${goal.id} [${goal.status}] ${goal.title || goal.objective}`,
    `  session: ${goal.sessionId}`,
    `  gate: ${gate.passed ? "PASSED" : "NOT PASSED"}`
  ];
  for (const criterion of goal.criteria) {
    const kinds = criterion.evidence.map((entry) => entry.kind).join(", ") || "no evidence";
    lines.push(`  ${criterion.id} [${criterion.status}] ${criterion.scenario} (${kinds})`);
  }
  for (const blocker of goal.reviewBlockers) {
    lines.push(`  ${blocker.id} [${blocker.resolved ? "resolved" : "open"}] ${blocker.detail}`);
  }
  if (!gate.passed) for (const reason of gate.reasons) lines.push(`  - ${reason}`);
  return lines.join("\n");
}

export async function runLoopCommand(command: LoopCommand, loop: LoopArgs): Promise<CliResult> {
  const root = loop.projectRoot;
  try {
    if (command === "create-goals") {
      const goal = await createGoals(root, {
        sessionId: requireOption(loop.sessionId, "--session-id"),
        objective: requireOption(loop.objective, "--objective"),
        title: loop.title,
        criteria: loop.criteria,
        force: loop.force
      });
      const paths = createRuntimePaths(root);
      return ok(
        loop,
        { created: true, goal },
        `created ${goal.id} for session ${goal.sessionId} with ${goal.criteria.length} criteria\n` +
          `  state: ${paths.goalsFile}\n  brief: ${paths.briefFile}\n  ledger: ${paths.ledgerFile}`
      );
    }

    if (command === "status") {
      const status = await readEvidenceLedgerStatus(root);
      if (status.goals.length === 0) {
        return ok(loop, { activeGoalId: "", goals: [] }, "no goals recorded; run create-goals to open one");
      }
      return ok(loop, status, status.goals.map(describeGoal).join("\n"));
    }

    if (command === "record-evidence") {
      const criterion = await recordEvidence(root, {
        criterionId: requireOption(loop.criterionId, "--criterion-id"),
        kind: requireOption(loop.kind, "--kind"),
        ref: requireOption(loop.ref, "--ref"),
        detail: loop.detail,
        status: loop.status
      });
      return ok(
        loop,
        { recorded: true, criterion },
        `recorded ${criterion.evidence[criterion.evidence.length - 1]?.kind} evidence on ${criterion.id} ` +
          `(status ${criterion.status}, ${criterion.evidence.length} entries retained)`
      );
    }

    if (command === "checkpoint") {
      const checkpoint = await recordCheckpoint(root, {
        summary: requireOption(loop.summary, "--summary"),
        activeCriterion: loop.criterionId
      });
      return ok(
        loop,
        { recorded: true, checkpoint },
        `recorded ${checkpoint.id}${checkpoint.activeCriterion === "" ? "" : ` on ${checkpoint.activeCriterion}`}: ${checkpoint.summary}`
      );
    }

    if (command === "steer") {
      const steering = await recordSteering(root, {
        directive: requireOption(loop.directive, "--directive"),
        kind: loop.kind
      });
      const text = steering.criterionId === undefined
        ? `recorded ${steering.id} (${steering.kind}): ${steering.directive}`
        : `recorded ${steering.id} (${steering.kind}); added pending ${steering.criterionId}: ${steering.directive}`;
      return ok(loop, { recorded: true, steering }, text);
    }

    if (command === "record-review-blockers") {
      const blocker = loop.resolve === undefined
        ? await recordReviewBlocker(root, {
            detail: requireOption(loop.detail, "--detail"),
            needsUserDecision: loop.needsUserDecision
          })
        : await resolveReviewBlocker(root, { blockerId: loop.resolve });
      const status = await readEvidenceLedgerStatus(root);
      const goalStatus = status.goals.find((goal) => goal.id === status.activeGoalId)?.status ?? "unknown";
      return ok(
        loop,
        { recorded: true, blocker, goalStatus },
        `recorded ${blocker.id}; goal status is now ${goalStatus}`
      );
    }

    const result = await completeGoals(root);
    if (!result.completed) {
      const text = [`BLOCKED: ${result.goalId} did not pass the completion gate.`, ...result.reasons.map((reason) => `  - ${reason}`)].join("\n");
      return { exitCode: gateExit, stdout: loop.json ? JSON.stringify(result, null, 2) : undefined, stderr: loop.json ? undefined : text };
    }
    return ok(loop, result, `completed ${result.goalId}`);
  } catch (error) {
    if (error instanceof UsageError) return { exitCode: usageExit, stderr: error.message };
    if (error instanceof EvidenceLedgerError) return { exitCode: refusedExit, stderr: `REFUSED (${error.code}): ${error.message}` };
    throw error;
  }
}
