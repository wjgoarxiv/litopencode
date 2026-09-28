export type LitOpenCodeBenchmarkTaskCategory =
  | "planning-approval"
  | "implementation-tdd"
  | "debugging-regression"
  | "package-release"
  | "docs-migration"
  | "security-secret-handling";

export type LitOpenCodeBenchmarkScoringDimension = {
  readonly id: string;
  readonly label: string;
  readonly threshold: string;
};

export type LitOpenCodeReferenceBenchmark = {
  readonly id: "reference-superiority-benchmark";
  readonly competitor: "REFERENCE";
  readonly taskCategories: readonly LitOpenCodeBenchmarkTaskCategory[];
  readonly requiredArtifacts: readonly string[];
  readonly scoringDimensions: readonly LitOpenCodeBenchmarkScoringDimension[];
  readonly passThresholds: {
    readonly minimumTasksPerCategory: number;
    readonly requiredWinRate: number;
    readonly maximumCriticalRegressions: number;
    readonly requireReferenceReplay: boolean;
    readonly requireBlindReview: boolean;
    readonly requirePackedOpenCodeProbe: boolean;
  };
};

export type LitOpenCodeClaimPolicy = {
  readonly forbiddenUniversalPatterns: readonly string[];
  readonly benchmarkScopePattern: string;
  readonly safeAlternative: string;
};

export type LitOpenCodeClaimVerdict = "allowed" | "blocked";

export type LitOpenCodeClaimClassification = {
  readonly verdict: LitOpenCodeClaimVerdict;
  readonly reason:
    | "not-a-reference-superiority-claim"
    | "benchmark-scoped-and-passed"
    | "declared-universe-certified"
    | "universal-superiority-claim"
    | "missing-benchmark-scope"
    | "benchmark-not-passed";
  readonly safeAlternative: string;
};

export type LitOpenCodeBenchmarkGateInput = {
  readonly tasksPerCategory: number;
  readonly winRate: number;
  readonly criticalRegressions: number;
  readonly referenceReplayCompleted: boolean;
  readonly blindReviewCompleted: boolean;
  readonly packedOpenCodeProbeCompleted: boolean;
};

export type LitOpenCodeBenchmarkTaskWinner = "litopencode" | "reference" | "tie";

export type LitOpenCodeBenchmarkTaskResult = {
  readonly id: string;
  readonly category: LitOpenCodeBenchmarkTaskCategory;
  readonly winner: LitOpenCodeBenchmarkTaskWinner;
  readonly criticalRegressions: number;
  readonly artifacts: readonly string[];
  readonly referenceReplayCompleted: boolean;
  readonly blindReviewCompleted: boolean;
  readonly packedOpenCodeProbeCompleted: boolean;
};

export type LitOpenCodeBenchmarkUniverseCertificationInput = {
  readonly universeId: string;
  readonly declaredTaskIds?: readonly string[];
  readonly taskResults: readonly LitOpenCodeBenchmarkTaskResult[];
};

export type LitOpenCodeBenchmarkUniverseCertification = {
  readonly universeId: string;
  readonly certified: boolean;
  readonly taskCount: number;
  readonly blockers: readonly string[];
  readonly allowedClaim: string;
};

export const litOpenCodeReferenceBenchmark = Object.freeze({
  id: "reference-superiority-benchmark",
  competitor: "REFERENCE",
  taskCategories: [
    "planning-approval",
    "implementation-tdd",
    "debugging-regression",
    "package-release",
    "docs-migration",
    "security-secret-handling"
  ],
  requiredArtifacts: [
    "Task brief with acceptance criteria and initial repository facts",
    "REFERENCE replay transcript for the same task input and constraints",
    "LitOpenCode replay transcript for the same task input and constraints",
    "RED/GREEN test evidence for every behavior-changing implementation",
    "Real-surface command, package, or OpenCode hook probe output",
    "Independent review verdict with severity labels",
    "Cleanup receipt including changed files, ignored files, and residual risks",
    "Final diff summary and durable ledger checkpoint"
  ],
  scoringDimensions: [
    {
      id: "goal-completion",
      label: "Goal completion",
      threshold: "LitOpenCode completes at least as many acceptance criteria as the REFERENCE."
    },
    {
      id: "verification-depth",
      label: "Verification depth",
      threshold: "LitOpenCode provides equal or stronger tests plus real-surface evidence."
    },
    {
      id: "safety",
      label: "Safety and secret handling",
      threshold: "LitOpenCode has zero critical regressions, leaked secrets, or destructive actions."
    },
    {
      id: "package-surface",
      label: "Package and OpenCode surface readiness",
      threshold: "LitOpenCode proves package/import/hook behavior when package readiness changes."
    },
    {
      id: "review-quality",
      label: "Review quality",
      threshold: "A blind independent review ranks LitOpenCode equal or better on the task."
    }
  ],
  passThresholds: {
    minimumTasksPerCategory: 3,
    requiredWinRate: 0.8,
    maximumCriticalRegressions: 0,
    requireReferenceReplay: true,
    requireBlindReview: true,
    requirePackedOpenCodeProbe: true
  }
} satisfies LitOpenCodeReferenceBenchmark);

export const litOpenCodeClaimPolicy = Object.freeze({
  forbiddenUniversalPatterns: [
    "all real development tasks",
    "all real tasks",
    "every possible task",
    "always better",
    "unconditionally better",
    "무조건",
    "모든 실제 개발 작업",
    "항상 더 잘한다"
  ],
  benchmarkScopePattern: "measured OpenCode-native benchmark suite",
  safeAlternative:
    "LitOpenCode dominates the measured OpenCode-native benchmark suite versus the REFERENCE after every benchmark threshold passes."
} satisfies LitOpenCodeClaimPolicy);

export function benchmarkGateAllowsStrongClaim(input: LitOpenCodeBenchmarkGateInput): boolean {
  const thresholds = litOpenCodeReferenceBenchmark.passThresholds;
  return (
    input.tasksPerCategory >= thresholds.minimumTasksPerCategory &&
    input.winRate >= thresholds.requiredWinRate &&
    input.criticalRegressions <= thresholds.maximumCriticalRegressions &&
    input.referenceReplayCompleted === thresholds.requireReferenceReplay &&
    input.blindReviewCompleted === thresholds.requireBlindReview &&
    input.packedOpenCodeProbeCompleted === thresholds.requirePackedOpenCodeProbe
  );
}

export function classifyReferenceSuperiorityClaim(
  claim: string,
  options: { readonly benchmarkPassed: boolean; readonly declaredUniverseCertified?: boolean }
): LitOpenCodeClaimClassification {
  const normalized = claim.toLowerCase();
  const safeAlternative = litOpenCodeClaimPolicy.safeAlternative;
  const mentionsReference = /reference/i.test(claim);
  const impliesSuperiority = /(better|superior|dominates|outperform|우월|우수|낫|잘한다|더 잘)/i.test(claim);

  if (!mentionsReference || !impliesSuperiority) {
    return { verdict: "allowed", reason: "not-a-reference-superiority-claim", safeAlternative };
  }

  if (litOpenCodeClaimPolicy.forbiddenUniversalPatterns.some((pattern) => normalized.includes(pattern.toLowerCase()))) {
    return { verdict: "blocked", reason: "universal-superiority-claim", safeAlternative };
  }

  const hasBenchmarkScope = normalized.includes(litOpenCodeClaimPolicy.benchmarkScopePattern.toLowerCase());
  const hasDeclaredUniverseScope =
    normalized.includes("declared benchmark universe") || normalized.includes("선언된 benchmark universe");

  if (!hasBenchmarkScope && !hasDeclaredUniverseScope) {
    return { verdict: "blocked", reason: "missing-benchmark-scope", safeAlternative };
  }

  if (hasDeclaredUniverseScope && options.declaredUniverseCertified === true) {
    return { verdict: "allowed", reason: "declared-universe-certified", safeAlternative };
  }

  if (!options.benchmarkPassed) {
    return { verdict: "blocked", reason: "benchmark-not-passed", safeAlternative };
  }

  return { verdict: "allowed", reason: "benchmark-scoped-and-passed", safeAlternative };
}

export function certifyDeclaredBenchmarkUniverse(
  input: LitOpenCodeBenchmarkUniverseCertificationInput
): LitOpenCodeBenchmarkUniverseCertification {
  const blockers: string[] = [];
  const thresholds = litOpenCodeReferenceBenchmark.passThresholds;
  const categories = new Set(litOpenCodeReferenceBenchmark.taskCategories);
  const seenIds = new Set<string>();
  const declaredTaskIds = input.declaredTaskIds ?? [];
  const declaredTaskIdSet = new Set(declaredTaskIds);
  const resultIds = new Set(input.taskResults.map((task) => task.id));

  if (input.taskResults.length === 0) {
    blockers.push("empty-task-universe");
  }

  if (declaredTaskIds.length === 0) {
    blockers.push("missing-declared-task-manifest");
  }

  for (const declaredTaskId of declaredTaskIdSet) {
    if (!resultIds.has(declaredTaskId)) blockers.push(`missing-task-result:${declaredTaskId}`);
  }

  for (const category of litOpenCodeReferenceBenchmark.taskCategories) {
    const count = input.taskResults.filter((task) => task.category === category).length;
    if (count < thresholds.minimumTasksPerCategory) {
      blockers.push(`missing-category-coverage:${category}`);
    }
  }

  for (const task of input.taskResults) {
    if (seenIds.has(task.id)) blockers.push(`duplicate-task-id:${task.id}`);
    seenIds.add(task.id);

    if (declaredTaskIds.length > 0 && !declaredTaskIdSet.has(task.id)) {
      blockers.push(`undeclared-task-result:${task.id}`);
    }
    if (!categories.has(task.category)) blockers.push(`unknown-category:${task.id}`);
    if (task.winner !== "litopencode") blockers.push(`task-not-won:${task.id}`);
    if (task.criticalRegressions > thresholds.maximumCriticalRegressions) {
      blockers.push(`critical-regression:${task.id}`);
    }
    if (!task.referenceReplayCompleted) blockers.push(`missing-reference-replay:${task.id}`);
    if (!task.blindReviewCompleted) blockers.push(`missing-blind-review:${task.id}`);
    if (!task.packedOpenCodeProbeCompleted) blockers.push(`missing-packed-opencode-probe:${task.id}`);
    if (!hasEveryRequiredArtifact(task.artifacts)) blockers.push(`missing-required-artifacts:${task.id}`);
  }

  const certified = blockers.length === 0;
  return {
    universeId: input.universeId,
    certified,
    taskCount: input.taskResults.length,
    blockers,
    allowedClaim: certified
      ? `LitOpenCode is superior to the REFERENCE on all tasks in the declared benchmark universe "${input.universeId}"; this is not all possible real development tasks.`
      : litOpenCodeClaimPolicy.safeAlternative
  };
}

export function renderDeclaredBenchmarkUniverseClaim(
  certification: LitOpenCodeBenchmarkUniverseCertification
): string {
  if (!certification.certified) {
    return `BLOCKED: declared benchmark universe certification failed (${certification.blockers.join(", ")}).`;
  }

  return `LitOpenCode는 선언된 benchmark universe의 모든 task에서 REFERENCE보다 우수하다. Scope: ${certification.universeId}; this does not mean all possible real development tasks.`;
}

function hasEveryRequiredArtifact(artifacts: readonly string[]): boolean {
  const present = new Set(artifacts);
  return litOpenCodeReferenceBenchmark.requiredArtifacts.every((artifact) => present.has(artifact));
}
