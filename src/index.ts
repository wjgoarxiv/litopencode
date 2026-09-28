import type { PluginModule } from "@opencode-ai/plugin";
import litOpenCodePlugin from "./server.ts";
export {
  LifecycleConflictError,
  LifecycleSafetyError,
  boundedAuthoritySchemaVersion,
  createBoundedAuthorityLifecycle,
  lifecyclePaths,
  parseFencedProgress,
  readBoundedContextFile,
  type AuthorityBoundary,
  type AuthorityGrant,
  type BoundedAuthorityLifecycle,
  type BoundedAuthorityOptions,
  type BoundedAuthorityState,
  type BoundedContextFile,
  type BoundedWorkStatus,
  type ConsumedAuthorityGrant,
  type FencedProgress,
  type LifecycleBoundaryRequest,
  type LifecycleInitRequest,
  type LifecycleMutationResult,
  type LifecycleResumeRequest,
  type LifecycleTerminalRequest,
  type ProgressRecordRequest,
  type ProgressRecordResult,
  type SemanticAuthorityAction
} from "./bounded-authority.ts";
export {
  applyTrustedStartWorkDirective,
  createBoundedAuthorityEventHook,
  parseStartWorkLifecycleDirective,
  type StartWorkLifecycleDirective
} from "./bounded-authority-hooks.ts";
export {
  appendLedgerEvent,
  createLitGoalOperations,
  initializeLitGoal,
  readLedgerEvents,
  readLedgerEventsLenient,
  recoverLedgerTemps,
  LedgerIoError,
  LedgerParseError,
  type JsonValue,
  type LedgerAppendResult,
  type LedgerEvent,
  type LedgerReadDiagnostic,
  type LedgerRecoveryReport,
  type LenientLedgerReadResult,
  type LitGoalInitialization,
  type LitGoalOperations
} from "./ledger.ts";

export {
  containsStandaloneLitTrigger,
  createChatMessageActivationHook,
  detectChatActivationMode,
  litLoopPromptInjection,
  litPlanPromptInjection
} from "./activation.ts";
export {
  defaultGlobalConfigFile,
  defaultGlobalConfigJson,
  effectiveAgentConfig,
  litOpenCodeConfigSchema,
  loadConfig,
  mergeAgentModelConfig,
  mergeConfigs,
  readLitOpenCodeConfigFile,
  type LitOpenCodeAgentModelConfig,
  type BoundedAuthorityConfig,
  type KnowledgeConfig,
  type LitOpenCodeCategoryConfig,
  type LitOpenCodeConfig,
  type LitOpenCodeConfigSource,
  type LitOpenCodePermissionMode,
  type LoadedConfig,
  type ReasoningEffort,
  type TextVerbosity
} from "./config.ts";
export {
  captureKnowledgeEvent,
  inspectKnowledge,
  knowledgeKinds,
  knowledgePaths,
  knowledgeStates,
  queryKnowledge,
  readKnowledgeClaims,
  recoverKnowledge,
  reviewKnowledgeRecord,
  KnowledgeStoreError,
  type KnowledgeCaptureResult,
  type KnowledgeEvent,
  type KnowledgeKind,
  type KnowledgePaths,
  type KnowledgeQueryResult,
  type KnowledgeRecord,
  type KnowledgeReviewResult,
  type KnowledgeState
} from "./knowledge.ts";
export { litActivationBanner, litOpenCodeCommands } from "./commands.ts";
export { createToolExecuteAfterHook, createToolExecuteBeforeHook } from "./hooks.ts";
export {
  createDeliverableHedgeGuard,
  type DeliverableHedgeGuardOptions,
  type DeliverableHedgeGuardState,
  type HumanizerFinding,
  type HumanizerScan,
  type HumanizerScanRequest
} from "./deliverable-hedge-guard.ts";
export {
  activationRegexMetric,
  createProviderUsageReceiptEventHook,
  emptyProviderCacheMeasurement,
  providerUsageReceiptFromEvent,
  recordProviderUsageReceipt,
  ruleDedupMetric,
  updateCacheMetric,
  type ProviderCacheMeasurement,
  type ProviderUsageReceipt,
  type ProviderUsageReceiptEventOptions,
  type RuleDedupMetric,
  type ActivationRegexMetric,
  type UpdateCacheMetric
} from "./cache-metrics.ts";
export {
  benchmarkGateAllowsStrongClaim,
  classifyReferenceSuperiorityClaim,
  certifyDeclaredBenchmarkUniverse,
  litOpenCodeClaimPolicy,
  litOpenCodeReferenceBenchmark,
  renderDeclaredBenchmarkUniverseClaim,
  type LitOpenCodeBenchmarkGateInput,
  type LitOpenCodeBenchmarkScoringDimension,
  type LitOpenCodeBenchmarkTaskCategory,
  type LitOpenCodeBenchmarkTaskResult,
  type LitOpenCodeBenchmarkTaskWinner,
  type LitOpenCodeBenchmarkUniverseCertification,
  type LitOpenCodeBenchmarkUniverseCertificationInput,
  type LitOpenCodeClaimClassification,
  type LitOpenCodeClaimPolicy,
  type LitOpenCodeClaimVerdict,
  type LitOpenCodeReferenceBenchmark
} from "./benchmark.ts";
export {
  completeGoals,
  countRecordedEvidence,
  createGoals,
  criterionStatuses,
  evaluateGoalGate,
  evidenceKinds,
  EvidenceLedgerError,
  evidenceLedgerVersion,
  goalStatuses,
  readEvidenceLedger,
  readEvidenceLedgerStatus,
  recordCheckpoint,
  recordEvidence,
  recordReviewBlocker,
  recordSteering,
  renderEvidenceBrief,
  steeringKinds,
  steeringWeakeningReason,
  type Checkpoint,
  type Criterion,
  type CriterionStatus,
  type EvidenceEntry,
  type EvidenceKind,
  type EvidenceLedgerState,
  type GateVerdict,
  type Goal,
  type GoalStatus,
  type ReviewBlocker,
  type SteeringEntry,
  type SteeringKind
} from "./ledger.ts";
export {
  applyLitOpenCodePostEditHook,
  applyLitOpenCodeToolAfterHook,
  applyLitOpenCodeToolBeforeHook,
  applyTaskRecursionGuard,
  mutatedFilePaths,
  postEditSkillRoutes,
  type LitOpenCodeToolAction,
  type LitOpenCodeToolId,
  type PostEditSkillRoute,
  type ToolGuardAfterOutput,
  type ToolGuardBeforeOutput,
  type ToolGuardDecision,
  type ToolGuardMarker,
  type ToolGuardRequest
} from "./tool-guards.ts";
export { litOpenCodeTools, litTool, litworkTool, reviewWorkTool, startWorkTool, wikifyTool } from "./tools.ts";
export {
  findLitOpenCodeFeature,
  litOpenCodeFeatures,
  type LitOpenCodeBindingKind,
  type LitOpenCodeFeature,
  type LitOpenCodeFeatureBinding,
  type LitOpenCodeFeatureId
} from "./features.ts";
export {
  findLitOpenCodeStaticOnlySkill,
  findLitOpenCodeRuntimeSkill,
  litOpenCodeStaticOnlySkills,
  litOpenCodeRuntimeSkills,
  type LitOpenCodeRuntimeSkill,
  type LitOpenCodeRuntimeSkillId,
  type LitOpenCodeStaticOnlySkill,
  type LitOpenCodeStaticOnlySkillId
} from "./skills.ts";
export {
  findLitOpenCodeSearchWorkflowIdea,
  litOpenCodeSearchWorkflowIdeas,
  type LitOpenCodeSearchWorkflowIdea,
  type LitOpenCodeSearchWorkflowIdeaId
} from "./search-workflow-ideas.ts";
export {
  fetchPublicSource,
  type FetchAttempt,
  type FetchVerdict,
  type PublicSourceContentSafety,
  type PublicSourceFetchAttempt,
  type PublicSourceFetchOptions,
  type PublicSourceFetchPolicyReceipt,
  type PublicSourceFetchResult,
  type PublicSourceFetchVerdict,
  type PublicSourceTraceEntry,
  type PublicSourceVerdict
} from "./lit-fetch.ts";

export const pluginId = "litopencode";

export const pluginModule = {
  id: pluginId,
  server: litOpenCodePlugin
} satisfies PluginModule;

export default litOpenCodePlugin;
