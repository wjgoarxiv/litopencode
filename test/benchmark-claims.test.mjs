import assert from "node:assert/strict";
import { test } from "node:test";
import {
  benchmarkGateAllowsStrongClaim,
  classifyReferenceSuperiorityClaim,
  certifyDeclaredBenchmarkUniverse,
  litOpenCodeClaimPolicy,
  litOpenCodeReferenceBenchmark,
  renderDeclaredBenchmarkUniverseClaim
} from "../src/index.ts";

function passingUniverseResults() {
  return litOpenCodeReferenceBenchmark.taskCategories.flatMap((category) =>
    Array.from({ length: litOpenCodeReferenceBenchmark.passThresholds.minimumTasksPerCategory }, (_, index) => ({
      id: `${category}-${index + 1}`,
      category,
      winner: "litopencode",
      criticalRegressions: 0,
      artifacts: [...litOpenCodeReferenceBenchmark.requiredArtifacts],
      referenceReplayCompleted: true,
      blindReviewCompleted: true,
      packedOpenCodeProbeCompleted: true
    }))
  );
}

function passingUniverseInput() {
  const taskResults = passingUniverseResults();
  return {
    universeId: "litopencode-real-dev-v1",
    declaredTaskIds: taskResults.map((result) => result.id),
    taskResults
  };
}

test("reference benchmark contract is finite, replayable, and adversarial", () => {
  assert.equal(litOpenCodeReferenceBenchmark.id, "reference-superiority-benchmark");
  assert.equal(litOpenCodeReferenceBenchmark.competitor, "REFERENCE");
  assert.ok(litOpenCodeReferenceBenchmark.taskCategories.length >= 6);
  assert.ok(litOpenCodeReferenceBenchmark.requiredArtifacts.length >= 6);
  assert.ok(litOpenCodeReferenceBenchmark.scoringDimensions.length >= 5);
  assert.equal(litOpenCodeReferenceBenchmark.passThresholds.minimumTasksPerCategory >= 3, true);
  assert.equal(litOpenCodeReferenceBenchmark.passThresholds.requiredWinRate >= 0.8, true);
  assert.equal(litOpenCodeReferenceBenchmark.passThresholds.maximumCriticalRegressions, 0);
  assert.equal(litOpenCodeReferenceBenchmark.passThresholds.requireReferenceReplay, true);
  assert.equal(litOpenCodeReferenceBenchmark.passThresholds.requireBlindReview, true);
  assert.equal(litOpenCodeReferenceBenchmark.passThresholds.requirePackedOpenCodeProbe, true);

  const benchmarkText = JSON.stringify(litOpenCodeReferenceBenchmark);
  assert.match(benchmarkText, /RED\/GREEN/i);
  assert.match(benchmarkText, /real-surface/i);
  assert.match(benchmarkText, /independent review/i);
  assert.match(benchmarkText, /cleanup receipt/i);
  assert.match(benchmarkText, /package/i);
});

test("claim policy blocks universal all-task superiority wording", () => {
  const blocked = classifyReferenceSuperiorityClaim(
    "LitOpenCode는 모든 실제 개발 작업에서 REFERENCE보다 무조건 더 잘한다.",
    { benchmarkPassed: true }
  );

  assert.equal(blocked.verdict, "blocked");
  assert.equal(blocked.reason, "universal-superiority-claim");
  assert.match(blocked.safeAlternative, /measured OpenCode-native benchmark suite/i);
  assert.match(JSON.stringify(litOpenCodeClaimPolicy.forbiddenUniversalPatterns), /무조건/);

  const koreanSuperior = classifyReferenceSuperiorityClaim(
    "LitOpenCode는 모든 실제 개발 작업에서 REFERENCE보다 우수하다.",
    { benchmarkPassed: true }
  );
  assert.equal(koreanSuperior.verdict, "blocked");
  assert.equal(koreanSuperior.reason, "universal-superiority-claim");
});

test("claim policy allows only benchmark-scoped superiority after thresholds pass", () => {
  const unscoped = classifyReferenceSuperiorityClaim("LitOpenCode is better than the REFERENCE.", {
    benchmarkPassed: true
  });
  assert.equal(unscoped.verdict, "blocked");
  assert.equal(unscoped.reason, "missing-benchmark-scope");

  const scopedBeforePass = classifyReferenceSuperiorityClaim(
    "LitOpenCode dominates the measured OpenCode-native benchmark suite versus the REFERENCE.",
    { benchmarkPassed: false }
  );
  assert.equal(scopedBeforePass.verdict, "blocked");
  assert.equal(scopedBeforePass.reason, "benchmark-not-passed");

  const scopedAfterPass = classifyReferenceSuperiorityClaim(
    "LitOpenCode dominates the measured OpenCode-native benchmark suite versus the REFERENCE.",
    { benchmarkPassed: true }
  );
  assert.equal(scopedAfterPass.verdict, "allowed");

  const declaredUniverseBeforeCertification = classifyReferenceSuperiorityClaim(
    "LitOpenCode는 선언된 benchmark universe의 모든 task에서 REFERENCE보다 우수하다.",
    { benchmarkPassed: false }
  );
  assert.equal(declaredUniverseBeforeCertification.verdict, "blocked");
  assert.equal(declaredUniverseBeforeCertification.reason, "benchmark-not-passed");

  const declaredUniverseAfterCertification = classifyReferenceSuperiorityClaim(
    "LitOpenCode는 선언된 benchmark universe의 모든 task에서 REFERENCE보다 우수하다.",
    { benchmarkPassed: false, declaredUniverseCertified: true }
  );
  assert.equal(declaredUniverseAfterCertification.verdict, "allowed");
});

test("benchmark gate requires full threshold evidence before strong claims", () => {
  assert.equal(
    benchmarkGateAllowsStrongClaim({
      tasksPerCategory: 3,
      winRate: 0.8,
      criticalRegressions: 0,
      referenceReplayCompleted: true,
      blindReviewCompleted: true,
      packedOpenCodeProbeCompleted: true
    }),
    true
  );

  assert.equal(
    benchmarkGateAllowsStrongClaim({
      tasksPerCategory: 3,
      winRate: 1,
      criticalRegressions: 1,
      referenceReplayCompleted: true,
      blindReviewCompleted: true,
      packedOpenCodeProbeCompleted: true
    }),
    false
  );

  assert.equal(
    benchmarkGateAllowsStrongClaim({
      tasksPerCategory: 2,
      winRate: 1,
      criticalRegressions: 0,
      referenceReplayCompleted: true,
      blindReviewCompleted: true,
      packedOpenCodeProbeCompleted: true
    }),
    false
  );
});

test("declared benchmark universe certification requires every task to beat the REFERENCE", () => {
  const certification = certifyDeclaredBenchmarkUniverse({
    ...passingUniverseInput()
  });

  assert.equal(certification.certified, true);
  assert.equal(certification.taskCount, 18);
  assert.equal(certification.blockers.length, 0);
  assert.match(certification.allowedClaim, /all tasks in the declared benchmark universe/i);
  assert.match(certification.allowedClaim, /not all possible real development tasks/i);

  const rendered = renderDeclaredBenchmarkUniverseClaim(certification);
  assert.match(rendered, /LitOpenCode는 선언된 benchmark universe의 모든 task에서 REFERENCE보다 우수하다/);
});

test("declared benchmark universe certification blocks incomplete coverage and regressions", () => {
  const noManifest = certifyDeclaredBenchmarkUniverse({
    universeId: "litopencode-real-dev-v1",
    taskResults: passingUniverseResults()
  });
  assert.equal(noManifest.certified, false);
  assert.ok(noManifest.blockers.includes("missing-declared-task-manifest"));

  const missingCategory = certifyDeclaredBenchmarkUniverse({
    ...passingUniverseInput(),
    taskResults: passingUniverseResults().filter((result) => result.category !== "security-secret-handling")
  });
  assert.equal(missingCategory.certified, false);
  assert.ok(missingCategory.blockers.includes("missing-category-coverage:security-secret-handling"));
  assert.ok(missingCategory.blockers.includes("missing-task-result:security-secret-handling-1"));

  const failedTask = passingUniverseResults();
  failedTask[0] = { ...failedTask[0], winner: "reference" };
  const losing = certifyDeclaredBenchmarkUniverse({ ...passingUniverseInput(), taskResults: failedTask });
  assert.equal(losing.certified, false);
  assert.ok(losing.blockers.includes("task-not-won:planning-approval-1"));

  const missingArtifact = passingUniverseResults();
  missingArtifact[0] = { ...missingArtifact[0], artifacts: [] };
  const noArtifact = certifyDeclaredBenchmarkUniverse({
    ...passingUniverseInput(),
    taskResults: missingArtifact
  });
  assert.equal(noArtifact.certified, false);
  assert.ok(noArtifact.blockers.includes("missing-required-artifacts:planning-approval-1"));

  const extraTask = certifyDeclaredBenchmarkUniverse({
    ...passingUniverseInput(),
    taskResults: [
      ...passingUniverseResults(),
      {
        ...passingUniverseResults()[0],
        id: "undeclared-extra-task"
      }
    ]
  });
  assert.equal(extraTask.certified, false);
  assert.ok(extraTask.blockers.includes("undeclared-task-result:undeclared-extra-task"));
});
