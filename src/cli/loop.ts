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
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

type PlannedWrite = { readonly path: string; readonly change: "create" | "update" | "delete" };

async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.set(path.relative(dir, full), createHash("sha256").update(await fs.readFile(full)).digest("hex"));
    }
  };
  await walk(dir);
  return files;
}

// A dry run executes the verb against a private copy of the project's .litopencode state, so the
// same validation, refusals and gates apply, then reports which files the real run would change.
// The copy dereferences symlinks, so a write in the copy can never reach a linked target.
async function dryRunLoopCommand(command: LoopCommand, loop: LoopArgs): Promise<CliResult> {
  const realRuntimeDir = createRuntimePaths(loop.projectRoot).runtimeDir;
  const shadowRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-dry-run-shadow-")));
  try {
    const shadowRuntimeDir = createRuntimePaths(shadowRoot).runtimeDir;
    try {
      await fs.cp(realRuntimeDir, shadowRuntimeDir, { recursive: true, dereference: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const before = await snapshotTree(shadowRuntimeDir);
    const result = await runLoopCommandAt(command, { ...loop, projectRoot: shadowRoot });
    const after = await snapshotTree(shadowRuntimeDir);
    const writes: PlannedWrite[] = [];
    for (const [file, hash] of after) {
      const previous = before.get(file);
      if (previous === undefined) writes.push({ path: path.join(realRuntimeDir, file), change: "create" });
      else if (previous !== hash) writes.push({ path: path.join(realRuntimeDir, file), change: "update" });
    }
    for (const file of before.keys()) if (!after.has(file)) writes.push({ path: path.join(realRuntimeDir, file), change: "delete" });
    writes.sort((left, right) => left.path.localeCompare(right.path));
    const realProjectRoot = path.resolve(loop.projectRoot);
    const relabel = (text: string | undefined): string | undefined => text?.split(shadowRoot).join(realProjectRoot);
    if (loop.json && result.stdout !== undefined) {
      const payload = { dryRun: true, command, wouldWrite: writes, result: JSON.parse(relabel(result.stdout) ?? "null") as unknown };
      return { exitCode: result.exitCode, stdout: JSON.stringify(payload, null, 2), stderr: relabel(result.stderr) };
    }
    const plan = writes.length === 0
      ? `DRY RUN: nothing was written. ${command} would change no files.`
      : [`DRY RUN: nothing was written. ${command} would change:`, ...writes.map((entry) => `  ${entry.change} ${entry.path}`)].join("\n");
    const preview = relabel(result.stdout);
    const stdout = preview === undefined || preview === "" ? plan : `${plan}\nThe real run would report:\n${preview}`;
    return { exitCode: result.exitCode, stdout, stderr: relabel(result.stderr) };
  } finally {
    await fs.rm(shadowRoot, { recursive: true, force: true });
  }
}

// status only reads, so --dry-run changes nothing about it; every other verb writes the ledger.
export async function runLoopCommand(command: LoopCommand, loop: LoopArgs, dryRun = false): Promise<CliResult> {
  if (dryRun && command !== "status") return await dryRunLoopCommand(command, loop);
  return await runLoopCommandAt(command, loop);
}

async function runLoopCommandAt(command: LoopCommand, loop: LoopArgs): Promise<CliResult> {
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
