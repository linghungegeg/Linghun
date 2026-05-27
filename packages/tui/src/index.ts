import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, accessSync, existsSync, readFileSync } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, extname, join, relative, resolve } from "node:path";
import {
  stderr as defaultStderr,
  stdin as defaultStdin,
  stdout as defaultStdout,
} from "node:process";
import { clearLine, cursorTo, emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { type Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  type LinghunConfig,
  type McpServerConfig,
  type ModelCapability,
  type ModelRole,
  type NativeRunnerConfig,
  type ProviderEnvSetup,
  type RemoteChannelConfig,
  type RemoteChannelType,
  type RemoteEventType,
  type RoleModelRoute,
  type WorkspaceTrustLevel,
  defaultConfig,
  ensureProviderEnvTemplate,
  getProjectSettingsPath,
  getProviderEnvPath,
  hasRecordedProjectLanguage,
  hasRecordedUserLanguage,
  lastProviderEnvWarning,
  loadConfig,
  providerEnvExists,
  readProviderEnvValues,
  removeMcpServerConfig,
  resetExtensionTrustForInstall,
  resolveStoragePaths,
  saveExtensionEnablement,
  saveMcpServerConfig,
  saveModelRoute,
  saveProjectLanguage,
  saveProviderEnvSetup,
  saveUserLanguage,
  saveWorkspaceTrust,
  validateProviderEnvSetup,
} from "@linghun/config";
import {
  type CacheFreshness,
  type CacheTurnStats,
  type CacheWriteTokensSource,
  SessionStore,
  type TranscriptEvent,
  computePromptCacheHitRate,
} from "@linghun/core";
import {
  DeepSeekProvider,
  type EndpointProfile,
  ModelGateway,
  type ModelMessage,
  type ModelToolCall,
  type ModelUsage,
  OpenAiCompatibleProvider,
  findKnownModel,
  resolveEffectiveEndpointProfile,
  resolveProviderBaseUrlDiagnostic,
  resolveProviderRuntimeContract,
} from "@linghun/providers";
import { LINGHUN_NAME, type Language, type PermissionMode } from "@linghun/shared";
import {
  type DiffSummary,
  type TodoItem,
  type ToolContext,
  type ToolName,
  type ToolOutput,
  type ToolProgressEvent,
  builtInTools,
  createToolContext,
  runTool,
} from "@linghun/tools";
import {
  type ArchitectureCard,
  type ArchitectureCardSummary,
  createArchitectureCard,
  createArchitectureRuntimeDirective,
  detectArchitectureDrift,
  shouldTriggerArchitectureRuntime,
  summarizeArchitectureCard,
} from "./architecture-runtime.js";
import {
  createCacheFreshness,
  createConfigFreshnessSummary,
  diffFreshness,
  stableHash,
  stableStringify,
} from "./cache-freshness.js";
import {
  type CompactBoundary,
  compactBoundaryHash,
  createManualCompactBoundary,
  microCompactMessages,
} from "./compact-context.js";
import { estimateModelMessageChars, estimateTranscriptContextChars } from "./context-estimator.js";
import {
  type CodebaseMemoryBinarySource,
  type CodebaseMemoryBinaryStatus,
  type IndexSafetyFile,
  type IndexState,
  createIndexState,
  findCurrentIndexProject,
} from "./index-runtime.js";
import { classifyIndexSafetyRepairContinuation } from "./index-safety-repair.js";
import {
  formatBackgroundDetails,
  formatBackgroundOutputDetails,
  formatBackgroundTask,
  formatJobNextAction,
  formatJobRunnerInline,
  formatJobRunnerReportLine,
  formatRunnerDoctor,
  mapDurableJobToBackgroundResult,
  mapDurableJobToBackgroundStatus,
} from "./job-runner-presenter.js";
import {
  DEFAULT_JOB_BUDGET_TOKENS,
  DEFAULT_JOB_MAX_STEPS,
  DEFAULT_JOB_RUNNING_AGENT_CAP,
  DEFAULT_JOB_TIMEOUT_MS,
  JOB_AGENT_HIGH_CONFIG_CANDIDATE,
  JOB_LOG_TAIL_LINES,
  JOB_RECOVERY_HEARTBEAT_STALE_MS,
  type JobContext,
  MAX_AGENTS,
  MAX_JOB_MAX_STEPS,
  type ParsedJobRunOptions,
  appendJobLog,
  clampPositiveInt,
  countDurableJobAgents,
  createDurableJobAgents,
  deriveAgentDisplayName,
  estimateJobTokens,
  findDurableJob as findDurableJobFromFs,
  formatJobAgentLabels,
  formatJobList as formatJobListImpl,
  formatJobLogs as formatJobLogsImpl,
  formatJobPrimary as formatJobPrimaryImpl,
  formatJobReportConclusion,
  formatJobReport as formatJobReportImpl,
  formatJobStatus,
  getDurableJobMaxSteps,
  getDurableJobPaths as getDurableJobPathsImpl,
  getDurableJobStatePath,
  getDurableJobsRoot as getDurableJobsRootImpl,
  isDurableJobState,
  listDurableJobs as listDurableJobsFromFs,
  parseJobRunOptions,
  persistDurableJob,
  readDurableJobState,
  rescheduleDurableJobAgents,
  truncateAsciiLabel,
  writeDurableJobReport,
} from "./job-runtime.js";
import {
  type LogArtifactRequest,
  formatLogArtifactSlice,
  readLogArtifactSlice,
} from "./log-artifact.js";
import {
  type ModelDoctorContext,
  diagnoseConcreteRoute,
  diagnoseRoute,
  formatModelRouteDoctor,
  formatModelRouteSummary,
  formatModelRoutes,
  getProviderKeySource,
  getRoleRoute,
  getRouteBlockingProblems,
  hasOpenAiCompatibleDoctorProblem,
  hasOpenAiCompatiblePlaceholderProblem,
  hasOpenAiCompatibleProviderSetupProblem,
  inferProviderForRouteModel,
  isDefaultExecutorRoute,
  isModelRole,
  maskSecret,
  readProjectSettingsApiKeyProviders,
  readProviderEnvApiKeyProviders,
} from "./model-doctor-runtime.js";
import {
  type FreshnessLiteState,
  type SolutionCompletenessClassification,
  type SolutionCompletenessSeverity,
  type SolutionCompletenessStatus,
  EXECUTE_EXTRA_TOOL_NAME,
  SEARCH_EXTRA_TOOLS_NAME,
  createDeferredToolDispatchDefinitions,
  createModelToolDefinitions,
  createModelToolDefinitionsForReportGuard,
  createModelToolDefinitionsForTools,
  createSolutionCompletenessStatus,
  createToolInputSchema,
  createToolUseDriftSummary,
  extractFileMentions,
  extractFileSearchKeywords,
  extractNaturalReadPath,
  formatFileCandidates,
  formatFreshnessLitePrimaryWarning,
  formatSolutionCompletenessTrigger,
  hasModelSynthesisIntent,
  inferSolutionCompletenessImpactAreas,
  isNaturalReadFileRequest,
  looksLikeFilePath,
  matchesFileKeywords,
  needsFreshnessLiteBoundary,
  normalizeRelativePath,
  readToolInputString,
} from "./model-loop-runtime.js";
import {
  type ModelSetupMessageKey,
  type ModelSetupPrefill,
  type ModelSetupStep,
  type PendingModelSetup,
  applyModelSetupValues,
  formatModelSetupFallbackError,
  formatModelSetupMessage,
  formatModelSetupSaved,
  formatModelSetupSummary,
  getModelSetupPromptMessage,
  getNextModelSetupStep,
  looksLikeModelSetupInput,
  normalizeModelSetupReasoningLevel,
  parseModelSetupPrefill,
  validateModelSetupPartial,
} from "./model-setup-runtime.js";
import {
  type CommandCapability,
  type NaturalIntent,
  type PendingNaturalCommand,
  type SLASH_COMMAND_REGISTRY,
  buildRuntimeStatusForModel,
  createModelCapabilitySummary,
  createPendingNaturalCommand,
  formatCapabilityAnswer,
  formatNaturalStartGate,
  matchesNaturalGateConfirmation,
  routeNaturalIntent,
} from "./natural-command-bridge.js";
import {
  type ModelToolCallLike,
  type PermissionRule,
  type PermissionState,
  type RecentPermissionRejection,
  type ReportWriteGuard,
  collectInputFiles,
  createReportFinalReferenceReminder,
  createReportTaskGuard,
  createReportWriteGuard,
  createReportWriteReminder,
  doesWriteSatisfyReportGuard,
  extractRequestedReportPath,
  findPermissionRule,
  formatDiffBeforeWrite,
  formatModelToolOutput,
  formatPermissionDenialPrimary,
  formatPermissionDenied,
  formatPermissionRules,
  formatPermissionSummary,
  formatRecentDenied,
  getHardDenyReason,
  hasRepeatedPermissionDenial,
  hasReportFinalAnswerShape,
  hasReportWriteToolCall,
  isLowRiskWorkspaceEdit,
  isPlanAllowedTool,
  isReportFileWriteRequest,
  normalizeReportPath,
  normalizeToolName,
  parsePermissionModeInput,
  redactRemoteSummary,
  remoteTranscriptSummary,
  shouldSendReportEvidenceReminder,
  shouldSendReportFinalReferenceReminder,
  shouldSendReportWriteReminder,
} from "./permission-continuation-runtime.js";
import {
  formatLocalToolPermissionPrompt,
  formatModelToolPermissionPrompt,
} from "./permission-presenter.js";
import {
  createProcessGuard,
  installProcessGuardExitHandlers,
  requestTrackedProcessStop,
} from "./process-guard.js";
import {
  type ProviderCircuitBreakerState,
  checkProviderCooldown,
  clearProviderBreaker,
  createProviderCircuitBreakerState,
  formatCooldownDoctorLine,
  formatCooldownMessage,
  recordProviderFailure,
} from "./provider-circuit-breaker.js";
import {
  formatMcpTools,
  formatRemoteStatus,
  formatRemoteTestResult,
} from "./remote-mcp-presenter.js";
import {
  type RequestActivityPhase,
  formatProviderEmptyResponsePrimary,
  formatProviderFailurePrimary,
  formatProviderThinkingOnlyResponsePrimary,
  formatReportEvidenceRequired,
  formatReportIncompletePrimary,
  formatRequestActivity,
} from "./request-lifecycle-presenter.js";
import {
  type RunnerContext,
  type RunnerRuntimeDeps,
  formatApprovedRunnerSpecLine,
  markJobRunnerFallback,
  markJobRunnerTerminal,
  refreshRunnerStatusForJob as refreshRunnerStatusForJobImpl,
  resolveNativeRunner,
  startRunnerForDurableJob as startRunnerForDurableJobImpl,
  stopRunnerForDurableJob as stopRunnerForDurableJobImpl,
} from "./runner-runtime.js";
import { classifyRuntimePath, classifyStartupPath } from "./runtime-path-marker.js";
import { formatPermissionModeLabel, formatRuntimeStatusLine } from "./runtime-status-presenter.js";
import { createCommandBlock } from "./shell/models/command-transcript-presenter.js";
import { type ConfigPanelId, reduceConfigState } from "./shell/models/config-control-plane.js";
import { computeHomePromptPrefix, writePlainShell } from "./shell/plain-renderer.js";
import type { ProductBlockViewModel, ShellController, ShellInputEvent } from "./shell/types.js";
import {
  createOutputBlock,
  createShellViewModel,
  mapPendingApprovalToPermission,
  mapRequestActivityToView,
} from "./shell/view-model.js";
import {
  LOCAL_CONTROL_PLANE_CAPABILITY_IDS,
  formatCatalogHelp,
  formatModeBehavior,
  formatSlashDiscovery,
  formatUnknownSlashCommand,
  getSlashPrefixCandidates,
  isAllowedLocalCapabilityAnswer,
  isAllowedModeStartGate,
  isReadonlyPermissionsStatus,
  isWorkspaceTrustNaturalStartGate,
  looksLikeOrdinaryDevelopmentRequest,
  looksLikeWorkspaceTrustNaturalRequest,
  shouldDispatchLocalReadonlyIntent,
  slashCommandToTool,
} from "./slash-dispatch.js";
import {
  createShellLimitations,
  formatError,
  formatProjectRouteProblem,
  formatProviderEnvWarning,
  formatUserScopedSetupNeeded,
  readInputLines,
  readOutputColumns,
  readOutputRows,
  sanitizeDiagnosticText,
  sanitizeUserFacingError,
  shouldEnterProductShellCandidate,
  stripAnsi,
  truncateDisplay,
  uniqueStrings,
  writeLine,
} from "./startup-runtime.js";
import {
  type TerminalProblemView,
  type TerminalReadinessView,
  formatTerminalProblemsPanel,
  formatTerminalReadinessDoctor,
  formatTerminalReadinessStatus,
} from "./terminal-readiness-presenter.js";
import { formatToolOutput, formatToolStart } from "./tool-output-presenter.js";
import {
  type WorkspaceReferenceCache,
  createWorkspaceReferenceCache,
  getWorkspaceReferenceSnapshot,
  workspaceReferenceHash,
} from "./workspace-reference-cache.js";

export type { IndexState } from "./index-runtime.js";
export { createIndexState } from "./index-runtime.js";

export type TuiStatus = "ready";

export const tuiStatus: TuiStatus = "ready";

export type RunTuiOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  projectPath?: string;
};

export type {
  PermissionRule,
  RecentPermissionRejection,
  PermissionState,
} from "./permission-continuation-runtime.js";

export type {
  SolutionCompletenessClassification,
  SolutionCompletenessSeverity,
  SolutionCompletenessStatus,
} from "./model-loop-runtime.js";
export { createSolutionCompletenessStatus } from "./model-loop-runtime.js";

export type {
  VerificationEvidenceLevel,
  VerificationLevelClassification,
  VerificationLevelInput,
} from "./verification-level.js";
export {
  classifyVerificationLevel,
  isNonUpgradeableStatus,
  detectVerificationInflation,
  classifyRunnerVerificationLevel,
  classifyProviderVerificationLevel,
  formatVerificationLevel,
  compareVerificationLevels,
} from "./verification-level.js";

export type {
  TuiRuntimePath,
  RuntimePathKind,
  RuntimePathMarker,
  RuntimePathDetectionMethod,
  RuntimePathInput,
  StartupPathMarker,
  StartupPathInput,
} from "./runtime-path-marker.js";
export {
  classifyRuntimePath,
  classifyStartupPath,
  canClaimTuiMaturity,
  canClaimCurrentVerification,
  detectRuntimePathInflation,
  formatRuntimePathMarker,
  formatStartupPathMarker,
} from "./runtime-path-marker.js";

export type {
  BoundaryViolationSeverity,
  BoundaryViolationKind,
  BoundaryViolation,
  BoundaryCheckResult,
  FileMetrics,
  BoundaryThresholds,
  ChangeDeclaration,
} from "./architecture-boundary.js";
export {
  DEFAULT_THRESHOLDS as ARCHITECTURE_BOUNDARY_THRESHOLDS,
  checkFileBoundaries,
  detectCrossLayerImports,
  detectCircularDependencyRisk,
  checkBoundaries,
  validateChangeDeclaration,
  formatBoundaryViolations,
  estimateFileMetrics,
} from "./architecture-boundary.js";

export type {
  GuardDoctorItem,
  CompletionClaimCheck,
} from "./guard-wiring.js";
export {
  formatRuntimePathDoctor,
  formatStartupPathDoctor,
  formatVerificationLevelDoctor,
  formatRunnerGuardSummary,
  formatProviderGuardSummary,
  validateCompletionClaim,
  validateChangeDeclarationHuman,
} from "./guard-wiring.js";

// Module 1 (D.13L mechanical split) — pure type declarations live in
// ./tui-data-types.js. Imported for in-file usage (TuiContext + state factories
// + helpers all reference them) and re-exported so downstream consumers that
// rely on `import type { ... } from "../index.js"` keep compiling unchanged.
import type {
  AgentRun,
  AgentType,
  ApprovedRunnerJobSpec,
  BackgroundTaskState,
  BackgroundTaskStatus,
  CacheHistoryConfig,
  CacheState,
  CheckpointState,
  DurableJobAgent,
  DurableJobAgentStatus,
  DurableJobState,
  DurableJobStatus,
  EvidenceRecord,
  ExtensionLifecycleRecord,
  ExtensionScope,
  ExtensionSource,
  ExtensionTrustLevel,
  HandoffPacket,
  HookState,
  HookSummary,
  ImageGenerationResult,
  LightHint,
  McpServerState,
  McpState,
  McpToolState,
  MemoryCandidate,
  MemoryLearningCategory,
  MemoryLearningMode,
  MemoryLearningRun,
  MemoryScope,
  MemoryState,
  MemoryStatus,
  NativeRunnerLifecycleStatus,
  NativeRunnerResolutionStatus,
  PlanProposal,
  PluginState,
  PluginSummary,
  ProviderFailureSummary,
  RemoteApprovalDecision,
  RemoteApprovalMessage,
  RemoteChannelRuntimeStatus,
  RemoteChannelState,
  RemoteEvent,
  RemoteEventStatus,
  RemoteState,
  ResolvedRoleRoute,
  RoleHandoff,
  RoleRouteDecision,
  RoleUsage,
  SkillEvolutionCandidate,
  SkillState,
  SkillSummary,
  VerdictEvidenceScope,
  VerdictScope,
  VerdictStatus,
  VerificationCommandResult,
  VerificationReport,
  VerificationRuntimeStatus,
  VerificationStep,
  VerificationStepKind,
  VisionObservation,
  WorkflowState,
  WorkflowTemplate,
} from "./tui-data-types.js";
export type {
  AgentRun,
  AgentType,
  ApprovedRunnerJobSpec,
  BackgroundTaskState,
  BackgroundTaskStatus,
  CacheHistoryConfig,
  CacheState,
  CheckpointState,
  DurableJobAgent,
  DurableJobAgentStatus,
  DurableJobState,
  DurableJobStatus,
  EvidenceRecord,
  ExtensionLifecycleRecord,
  ExtensionScope,
  ExtensionSource,
  ExtensionTrustLevel,
  HandoffPacket,
  HookState,
  HookSummary,
  ImageGenerationResult,
  LightHint,
  McpServerState,
  McpState,
  McpToolState,
  MemoryCandidate,
  MemoryLearningCategory,
  MemoryLearningMode,
  MemoryLearningRun,
  MemoryScope,
  MemoryState,
  MemoryStatus,
  NativeRunnerLifecycleStatus,
  NativeRunnerResolutionStatus,
  PlanProposal,
  PluginState,
  PluginSummary,
  ProviderFailureSummary,
  RemoteApprovalDecision,
  RemoteApprovalMessage,
  RemoteChannelRuntimeStatus,
  RemoteChannelState,
  RemoteEvent,
  RemoteEventStatus,
  RemoteState,
  ResolvedRoleRoute,
  RoleHandoff,
  RoleRouteDecision,
  RoleUsage,
  SkillEvolutionCandidate,
  SkillState,
  SkillSummary,
  VerdictEvidenceScope,
  VerdictScope,
  VerdictStatus,
  VerificationCommandResult,
  VerificationReport,
  VerificationRuntimeStatus,
  VerificationStep,
  VerificationStepKind,
  VisionObservation,
  WorkflowState,
  WorkflowTemplate,
} from "./tui-data-types.js";

export type {
  ModelSetupStep,
  PendingModelSetup,
  ModelSetupPrefill,
  ModelSetupMessageKey,
} from "./model-setup-runtime.js";

type MessageKey =
  | "appTitle"
  | "intro"
  | "currentModel"
  | "unknownCommand"
  | "languageSwitchedZh"
  | "languageSwitchedEn"
  | "modeCurrent"
  | "modeOptions"
  | "modeBoundary"
  | "modeUnknown"
  | "modeFullAccessPlanBlocked"
  | "modeFullAccessOptInBlocked"
  | "modeSwitched"
  | "modePlanBoundary"
  | "startGateConfirmed"
  | "startGateExpired"
  | "startGateExactRequired"
  | "startGatePlainConfirmationRejected"
  | "exit"
  | "status"
  | "statusShort"
  | "help"
  | "inputPrompt"
  | "noSessions"
  | "sessionHeader"
  | "noSummary"
  | "checkpointCreated"
  | "checkpointNone"
  | "checkpointRestored"
  | "checkpointMissing"
  | "backgroundNone"
  | "backgroundEmptyOutput"
  | "backgroundRunning"
  | "interruptIdle"
  | "interruptCancelled"
  | "btwPrefix"
  | "evidenceBlocked"
  | "claimNeedsDisclaimer"
  | "projectRulesMissingHint"
  | "toolInterrupted";

export const USER_VISIBLE_DISPATCH_SLASH_COMMANDS = [
  "/help",
  "/features",
  "/model",
  "/language",
  "/mode",
  "/plan",
  "/permissions",
  "/background",
  "/job",
  "/remote",
  "/details",
  "/agents",
  "/fork",
  "/rewind",
  "/btw",
  "/interrupt",
  "/claim-check",
  "/verify",
  "/review",
  "/vision",
  "/image",
  "/cache-log",
  "/cache",
  "/compact",
  "/break-cache",
  "/mcp",
  "/index",
  "/resume",
  "/branch",
  "/memory",
  "/skills",
  "/workflows",
  "/plugins",
  "/doctor",
  "/problems",
  "/usage",
  "/stats",
  "/tab",
  "/esc",
  "/enter",
  "/trust",
  "/autopilot",
  "/sessions",
  "/read",
  "/write",
  "/edit",
  "/multiedit",
  "/grep",
  "/glob",
  "/bash",
  "/todo",
  "/diff",
  "/exit",
] as const satisfies readonly (typeof SLASH_COMMAND_REGISTRY)[number]["slash"][];

type PendingAutopilotRequest = {
  goal: string;
  maxSteps: number;
  maxTokens: number;
  timeoutMs: number;
  allowEdit: boolean;
  allowBash: boolean;
  createdAt: string;
};

type PendingLocalApproval =
  | {
      kind: "index_ignore_write";
      plan: IndexSafetyRepairPlan;
    }
  | {
      kind: "model_tool_use";
      toolCall: ModelToolCall;
      toolName: ToolName;
      sessionId: string;
      continuation?: PendingModelContinuation;
    }
  | {
      kind: "architecture_drift";
      toolCall: ModelToolCall;
      toolName: ToolName;
      sessionId: string;
      warnings: string[];
      continuation?: PendingModelContinuation;
    };

type PendingModelContinuation = {
  messages: ModelMessage[];
  provider: string;
  model: string;
  endpointProfile: "chat_completions" | "responses";
  reasoningLevel?: string;
  reasoningSent: boolean;
  reportWriteGuard?: ReportWriteGuard;
};

function runtimeFromContinuation(continuation: PendingModelContinuation): SelectedModelRuntime {
  return {
    role: "executor",
    provider: continuation.provider,
    model: continuation.model,
    endpointProfile: continuation.endpointProfile,
    reasoningLevel: continuation.reasoningLevel,
    reasoningStatus: formatReasoningEffectiveState(
      continuation.reasoningLevel,
      continuation.reasoningSent,
    ),
    reasoningSent: continuation.reasoningSent,
  };
}

function createSingleToolCallContinuation(
  continuation: PendingModelContinuation,
  toolCall: ModelToolCall,
): PendingModelContinuation {
  const removedIds = new Set<string>();
  const mapped = continuation.messages.map((message) => {
    if (message.role !== "assistant" || !message.toolCalls?.length) {
      return message;
    }
    const kept = message.toolCalls.filter((item) => item.id === toolCall.id);
    if (kept.length === 0) {
      return message;
    }
    for (const item of message.toolCalls) {
      if (item.id !== toolCall.id) {
        removedIds.add(item.id);
      }
    }
    return { ...message, toolCalls: kept };
  });
  return {
    ...continuation,
    messages: mapped.filter((message) => {
      if (message.role === "tool" && removedIds.has(message.tool_call_id)) {
        return false;
      }
      return true;
    }),
  };
}

export type TuiContext = {
  store: SessionStore;
  sessionId?: string;
  sessionEnded?: boolean;
  model: string;
  permissionMode: PermissionMode;
  projectPath: string;
  tools: ToolContext;
  permissions: PermissionState;
  language: Language;
  config: LinghunConfig;
  backgroundTasks: BackgroundTaskState[];
  checkpoints: CheckpointState[];
  evidence: EvidenceRecord[];
  cache: CacheState;
  mcp: McpState;
  index: IndexState;
  memory: MemoryState;
  skills: SkillState;
  workflows: WorkflowState;
  hooks: HookState;
  plugins: PluginState;
  remote: RemoteState;
  agents: AgentRun[];
  roleUsage: RoleUsage[];
  routeDecisions: RoleRouteDecision[];
  roleHandoffs: RoleHandoff[];
  visionObservations: VisionObservation[];
  imageResults: ImageGenerationResult[];
  lastVerification?: VerificationReport;
  activePlan?: PlanProposal;
  planAccepted?: boolean;
  interrupt?: { type: "idle" } | { type: "running"; taskId: string; canCancel: boolean };
  activeVerificationAbortController?: AbortController;
  pendingNaturalCommand?: PendingNaturalCommand;
  pendingLocalApproval?: PendingLocalApproval;
  pendingAutopilot?: PendingAutopilotRequest;
  pendingModelSetup?: PendingModelSetup;
  // D.13E Step 2 — ConfigPanel 当前状态。undefined = 未打开。
  // 由 runInkShell.onInput 拦截 /config 与 config-* 事件，经
  // reduceConfigState 推进；view-model 用 mapConfigPanelState 映射给 UI。
  configPanelState?:
    | { phase: "panel_list"; cursor: number }
    | { phase: "panel_detail"; panelId: ConfigPanelId; actionCursor: number };
  workspaceTrustEnforced?: boolean;
  activeAbortController?: AbortController;
  backgroundAbortControllers?: Map<string, AbortController>;
  recentlyMentionedFiles: string[];
  lastProviderFailure?: ProviderFailureSummary;
  providerBreaker: ProviderCircuitBreakerState;
  solutionCompleteness: SolutionCompletenessStatus;
  currentArchitectureCard?: ArchitectureCard;
  requestActivity?: { slowHintShown: boolean; slowTimer?: ReturnType<typeof setTimeout> };
  requestActivityPhase?: RequestActivityPhase;
  requestActivityToolName?: string;
  // D.13I tail fix — 记录本 session 通过 SearchExtraTools 真正发现过的 deferred 工具名。
  // ExecuteExtraTool 必须先看 Set，命中后再走白名单/适配器/必填参数检查。
  // 这是"已发现"的唯一证据；listDeferredTools 仅作为白名单存在性，不能等同于"发现过"。
  discoveredDeferredToolNames: Set<string>;
  // D.13J Block 3 — codebase-memory mutating 工具的 session 权限授予标记。
  // order: whitelist → required-args → permission gate → spawn。readonly 工具不看此 flag。
  codebaseMemoryMutatingGranted?: boolean;
  // D.13J Block 4 — 通用 MCP stdio mutating 工具 session 权限授予标记。
  // 不知道具体 server 的工具语义，按工具名 keyword（write/delete/update/index_*）保守判定 mutating；
  // 命中 mutating heuristic 时必须显式 session 授予才放行。
  mcpStdioMutatingGranted?: boolean;
  /**
   * 最近一条 user-visible writeLine 的完整正文，由 ShellBlockOutput 在每次写入时
   * 缓存。`/details` 默认分支会展开这段全文，让 `/model doctor` 这种长正文不会
   * 被压成 summary（firstLine）。
   *
   * `/details` 自身的 writeLine 不应该覆盖这条记录，否则 `/details` 会陷入
   * "看到的就是我自己" 的套娃。`captureLastFullOutput` 负责把 /details 期间
   * 的写入跳过。
   */
  lastFullOutput?: string;
  /**
   * 标记位：handleDetailsCommand 执行期间的 writeLine 不应该覆盖
   * `lastFullOutput`。命中此标记后，ShellBlockOutput 会保留前一次的全文，
   * 让连续 `/details` 不会自我覆盖。
   */
  suppressLastFullOutputCapture?: boolean;
};

const VERIFICATION_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

const MIN_CACHE_HISTORY_SIZE = 1;
const MAX_CACHE_HISTORY_SIZE = 200;
const DEFAULT_LIGHT_HINT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_LIGHT_HINTS_PER_TURN = 1;
const CHAT_COMPLETIONS_ENDPOINT = "/v1/chat/completions";
const MAX_MODEL_TOOL_ROUNDS = 4;
const LARGE_INDEX_FILE_BYTES = 1_000_000;
const LARGE_INDEX_FILE_LIMIT = 12;
const LARGE_INDEX_RISK_EXTENSIONS = new Set([".json", ".sql", ".xml"]);
const LARGE_INDEX_RISK_DIRS = new Set([
  ".next",
  ".turbo",
  ".venv",
  "assets",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "public",
  "target",
  "vendor",
  "venv",
]);
const INDEX_SCAN_SKIP_DIRS = new Set([".git", ".codebase-memory", ".linghun"]);
const CODEBASE_MEMORY_COMMAND = "codebase-memory-mcp";
const CODEBASE_MEMORY_ENV = "LINGHUN_CODEBASE_MEMORY_MCP";
const PROJECT_RULES_STATUS_WIDTH = 160;
const MEMORY_PROMPT_TOP_K = 3;
const MEMORY_PROMPT_ITEM_WIDTH = 180;
const MEMORY_PROMPT_TOTAL_WIDTH = 720;
const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 48_000;
const REQUEST_SLOW_HINT_MS = 20_000;
const MAX_EVIDENCE_RECORDS = 50;
const MAX_BACKGROUND_TASKS = 50;
const BACKGROUND_RUNNING_GLOBAL_CAP = 4;
const BACKGROUND_KIND_CAPS: Partial<Record<BackgroundTaskState["kind"], number>> = {
  bash: 1,
  verification: 1,
  index: 1,
  agent: 3,
  job: 1,
};
const MAX_CHECKPOINTS = 20;
const MAX_ROUTE_DECISIONS = 50;

// Module 2 (state-runtime) — pure state factories and their leaf helpers
// moved to ./tui-state-runtime.ts. Only `refreshRemoteState` stays here
// because it mutates TuiContext.
export {
  applyRemoteSessionDisables,
  codebaseMemoryRequiredArgs,
  createCacheState,
  createHookState,
  createMcpState,
  createMcpToolPlaceholders,
  createMemoryState,
  createPluginState,
  createRemoteState,
  createSkillState,
  createWorkflowState,
  getRemoteInstallHint,
  isRecord,
  normalizeMemoryStatus,
  pathExists,
  stabilizeMcpToolList,
  stableId,
  summarizeProjectRules,
} from "./tui-state-runtime.js";

import {
  applyRemoteSessionDisables,
  createCacheState,
  createHookState,
  createMcpState,
  createMcpToolPlaceholders,
  createMemoryState,
  createPluginState,
  createRemoteState,
  createSkillState,
  createWorkflowState,
  normalizeMemoryStatus,
  pathExists,
  stableId,
  summarizeProjectRules,
} from "./tui-state-runtime.js";

function refreshRemoteState(context: TuiContext): void {
  const previous = context.remote;
  context.remote = createRemoteState(context.config);
  context.remote.events = previous.events;
  context.remote.processedMessageIds = previous.processedMessageIds;
  context.remote.sessionDisabledChannelIds = previous.sessionDisabledChannelIds;
  context.remote.lastDoctor = previous.lastDoctor;
  context.remote.lastApproval = previous.lastApproval;
  applyRemoteSessionDisables(context.remote);
}

export async function runTui(options: RunTuiOptions = {}): Promise<number> {
  const input = options.stdin ?? defaultStdin;
  const output = options.stdout ?? defaultStdout;
  const errorOutput = options.stderr ?? defaultStderr;
  const projectPath = options.projectPath ?? process.cwd();
  const config = await loadConfig(projectPath);
  const storagePaths = resolveStoragePaths(config, projectPath);
  const store = new SessionStore({ sessionRootDir: storagePaths.sessions, projectPath });
  const initialModel = resolveInitialModel(config);
  const context: TuiContext = {
    store,
    model: initialModel,
    permissionMode: config.permission.defaultMode,
    projectPath,
    tools: createToolContext(projectPath),
    permissions: await loadPermissionState(projectPath),
    language: config.language,
    config,
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: createCacheState(projectPath, initialModel),
    mcp: createMcpState(config),
    index: createIndexState(config),
    memory: await createMemoryState(config, projectPath),
    skills: await createSkillState(config, projectPath),
    workflows: createWorkflowState(config),
    hooks: await createHookState(config, projectPath),
    plugins: await createPluginState(config, projectPath),
    remote: createRemoteState(config),
    agents: [],
    roleUsage: [],
    routeDecisions: [],
    roleHandoffs: [],
    visionObservations: [],
    imageResults: [],
    interrupt: { type: "idle" },
    recentlyMentionedFiles: [],
    lastProviderFailure: undefined,
    providerBreaker: createProviderCircuitBreakerState(),
    solutionCompleteness: createSolutionCompletenessStatus(),
    backgroundAbortControllers: new Map(),
    discoveredDeferredToolNames: new Set<string>(),
  };
  installProcessGuardExitHandlers();
  await hydrateDurableJobBackgroundTasks(context);
  const gateway = createModelGateway(config);

  const startup = await prepareTuiStartup(input, output, context);
  const sigintHandler = () => {
    requestTrackedProcessStop(false);
    const controller = context.activeAbortController ?? context.activeVerificationAbortController;
    if (!controller) {
      return;
    }
    controller.abort();
    writeLine(output, t(context, "toolInterrupted"));
  };
  process.once("SIGINT", sigintHandler);

  try {
    const useInkShell = await shouldEnterInkShell(input, output);
    if (useInkShell) {
      return await runInkShell(
        input,
        output,
        errorOutput,
        context,
        gateway,
        store,
        startup,
        sigintHandler,
      );
    }
    return await runPlainTui(input, output, context, gateway, store, startup, sigintHandler);
  } catch (error) {
    const message = error instanceof Error ? error.message : "TUI 运行失败。";
    writeLine(errorOutput, `错误：${message}`);
    return 1;
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}

type TuiStartupState = {
  setupNeeded: boolean;
  providerEnvPath?: string;
  providerEnvWarning?: string;
  projectRouteProblem?: string;
};

type TuiLineResult = "continue" | "exit";

async function prepareTuiStartup(
  input: Readable,
  output: Writable,
  context: TuiContext,
): Promise<TuiStartupState> {
  if (await shouldPromptForInitialLanguage(input, context)) {
    await promptInitialLanguage(input, output, context);
  }
  if (shouldPromptForInitialWorkspaceTrust(input, context)) {
    await promptInitialWorkspaceTrust(input, output, context);
  }
  const projectRouteProblem = await getStartupProjectRouteProblem(context);
  const startup: TuiStartupState = {
    setupNeeded: !projectRouteProblem && hasSelectedProviderConfigProblem(context),
    providerEnvWarning: lastProviderEnvWarning?.reason,
    projectRouteProblem,
  };
  if (startup.setupNeeded && !shouldEnterProductShellCandidate(input, output)) {
    startup.providerEnvPath =
      (input as { isTTY?: boolean }).isTTY === true
        ? (await providerEnvExists())
          ? getProviderEnvPath()
          : await ensureProviderEnvTemplate()
        : getProviderEnvPath();
  }
  return startup;
}

function writeLegacyStartup(output: Writable, context: TuiContext, startup: TuiStartupState): void {
  writeLine(output, t(context, "appTitle", { name: LINGHUN_NAME }));
  writeWorkspaceTrustStartupNotice(output, context);
  writeStatus(output, context);
  writeLine(output, formatHomeScreen(context));
  writeLine(output, `${t(context, "intro")}\n`);
  if (!context.memory.projectRulesExists) {
    writeLine(output, t(context, "projectRulesMissingHint"));
  }
  if (startup.providerEnvWarning) {
    writeLine(output, formatProviderEnvWarning(startup.providerEnvWarning, context.language));
  }
  if (startup.projectRouteProblem) {
    writeLine(output, formatProjectRouteProblem(startup.projectRouteProblem, context.language));
  }
  if (startup.setupNeeded) {
    writeLine(
      output,
      formatUserScopedSetupNeeded(
        startup.providerEnvPath ?? getProviderEnvPath(),
        context.language,
      ),
    );
  }
}

async function runPlainTui(
  input: Readable,
  output: Writable,
  context: TuiContext,
  gateway: ModelGateway,
  store: SessionStore,
  startup: TuiStartupState,
  sigintHandler: () => void,
): Promise<number> {
  const { isNoColorTerminal } = await import("./shell/ink-renderer.js");
  const isTty = (input as { isTTY?: boolean }).isTTY === true;
  const blocks: ProductBlockViewModel[] = [];

  // Non-TTY (pipe/script) keeps legacy text startup for scripting compatibility.
  // TTY legacy (Windows cmd) gets the product-grade plain shell.
  if (!isTty) {
    writeLegacyStartup(output, context, startup);
  } else {
    const view = createShellViewModel(context, {
      width: readOutputColumns(output),
      height: readOutputRows(output),
      noColor: isNoColorTerminal(),
      setupNeeded: startup.setupNeeded,
      projectRouteProblem: startup.projectRouteProblem,
      outputBlocks: blocks,
      reasoningLevel: getSelectedModelRuntime(context).reasoningLevel,
      reasoningSent: getSelectedModelRuntime(context).reasoningSent,
      limitations: createShellLimitations({
        language: context.language,
        providerEnvWarning: startup.providerEnvWarning,
      }),
    });
    writePlainShell(output, view);
  }

  for await (const line of readInputLines(input, output, {
    prompt: isTty
      ? `${computeHomePromptPrefix(readOutputColumns(output))}> `
      : t(context, "inputPrompt"),
    onEsc: () => handleTuiKeypress("escape", context, output),
    onEnter: () => handleTuiKeypress("return", context, output),
    onShiftTab: () => handleTuiKeypress("shift-tab", context, output),
    shouldMaskInput: () => context.pendingModelSetup?.step === "apiKey",
  })) {
    process.removeListener("SIGINT", sigintHandler);
    process.once("SIGINT", sigintHandler);
    const result = await processTuiLine(line, context, gateway, output, store);
    if (result === "exit") return 0;

    // After each interaction, refresh the product shell view for TTY legacy terminals
    if (isTty) {
      const runtime = getSelectedModelRuntime(context);
      const refreshView = createShellViewModel(context, {
        width: readOutputColumns(output),
        height: readOutputRows(output),
        noColor: isNoColorTerminal(),
        setupNeeded: startup.setupNeeded,
        projectRouteProblem: startup.projectRouteProblem,
        activity: mapRequestActivityToView(context),
        permission: mapPendingApprovalToPermission(context),
        outputBlocks: blocks,
        reasoningLevel: runtime.reasoningLevel,
        reasoningSent: runtime.reasoningSent,
        backgroundSummaries: context.backgroundTasks
          .filter(
            (task) =>
              task.status === "running" ||
              task.status === "completed" ||
              task.status === "failed" ||
              task.status === "timeout",
          )
          .slice(-2)
          .map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            result: task.result,
          })),
        limitations: createShellLimitations({
          language: context.language,
          providerEnvWarning: startup.providerEnvWarning,
        }),
      });
      writePlainShell(output, refreshView);
    }
  }
  return 0;
}

async function runInkShell(
  input: Readable,
  output: Writable,
  errorOutput: Writable,
  context: TuiContext,
  gateway: ModelGateway,
  store: SessionStore,
  startup: TuiStartupState,
  sigintHandler: () => void,
): Promise<number> {
  const { renderInkShell, isNoColorTerminal, shouldUseInkShell } = await import(
    "./shell/ink-renderer.js"
  );
  if (!shouldUseInkShell(input, output)) {
    return await runPlainTui(input, output, context, gateway, store, startup, sigintHandler);
  }

  const blocks: ProductBlockViewModel[] = [];
  let shell: ReturnType<typeof renderInkShell> | undefined;
  let submittedPending = false;
  // D.13E Step 2 — command transcript 行序号；createCommandBlock 用 sequence 生成稳定 id。
  let commandSequence = 0;
  let resolveExit: (code: number) => void = () => undefined;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const shellOutput = new ShellBlockOutput(context, blocks, () => shell?.rerender());
  const controller: ShellController = {
    getViewModel: () => {
      const runtime = getSelectedModelRuntime(context);
      return createShellViewModel(context, {
        width: readOutputColumns(output),
        height: readOutputRows(output),
        noColor: isNoColorTerminal(),
        setupNeeded: startup.setupNeeded,
        projectRouteProblem: startup.projectRouteProblem,
        outputBlocks: blocks,
        activity: mapRequestActivityToView(context),
        permission: mapPendingApprovalToPermission(context),
        submitted: submittedPending,
        reasoningLevel: runtime.reasoningLevel,
        reasoningSent: runtime.reasoningSent,
        backgroundSummaries: context.backgroundTasks
          .filter(
            (t) =>
              t.status === "running" ||
              t.status === "completed" ||
              t.status === "failed" ||
              t.status === "timeout",
          )
          .slice(-2)
          .map((t) => ({ id: t.id, title: t.title, status: t.status, result: t.result })),
        limitations: createShellLimitations({
          language: context.language,
          providerEnvWarning: startup.providerEnvWarning,
        }),
      });
    },
    onInput: async (event: ShellInputEvent) => {
      process.removeListener("SIGINT", sigintHandler);
      process.once("SIGINT", sigintHandler);
      if (event.type === "escape") {
        submittedPending = false;
        await handleTuiKeypress("escape", context, shellOutput);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "cycle-permission-mode") {
        // Ink 路径下的 Shift+Tab 必须 quiet：只切 context.permissionMode，
        // 不能再走 handleTuiKeypress("shift-tab") → setPermissionMode 那条 plain TUI
        // 链路；那条链路会 writeLine(modeSwitched) + writeStatus(...)，把
        // "[Linghun] 会话…" StatusTray 文本写进 shellOutput，污染 Task 区 transcript。
        // TaskFooter 的 permissionMode 段已经覆盖可见状态，rerender 后用户能看到切换结果。
        const modes: PermissionMode[] = ["default", "auto-review", "plan", "full-access"];
        const idx = modes.indexOf(context.permissionMode);
        const nextMode = modes[(idx + 1) % modes.length] ?? "default";
        const guard = getModeChangeGuard(nextMode, context);
        if (!guard) {
          const previousMode = context.permissionMode;
          context.permissionMode = nextMode;
          context.planAccepted = false;
          try {
            const sessionId = await ensureSession(context);
            await appendSystemEvent(
              context,
              sessionId,
              `permission_mode_change: ${previousMode} -> ${nextMode}; reason=ink shift-tab quiet cycle; boundary=Start Gate and permission pipeline remain active`,
              "info",
            );
          } catch {
            // 会话/事件写入失败不阻断 UI 切换；底层日志路径不应把用户输入区拖死。
          }
        }
        // guard 命中（例如 full-access 需要 opt-in）也不写 transcript，
        // TaskSuggestionBar / 后续显式 /mode 命令会暴露详细原因。
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "shift-enter") {
        // Composer 自己已经在 buffer 里 bufferInsert("\n")（见 Composer.tsx 的
        // Shift+Enter 分支），上抛 ShellInputEvent 仅作为占位事件，
        // 不应再 push 任何 transcript fallback block —— 那会在每次换行时往
        // task transcript 里塞一条 "多行输入降级" 噪音 block。
        // 这里仅 rerender 让光标 anchor 跟上新 buffer。
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      // ─── D.13E Step 2 修正 #2 — /config 拦截：在 ink 模式下打开真 panel UI ────
      // handleSlashCommand("/config") 仍然只 writeLine(formatConfigOverview(...))，
      // 保留 plain TUI 与 index.test 不破。这里只在 ink 路径上用 panel 接管。
      if (event.type === "submit" && event.text.trim() === "/config") {
        const trimmed = event.text;
        // 推 transcript 命令行（与其它 slash 一致），让用户能看到他敲了 /config
        blocks.push(createCommandBlock(commandSequence++, trimmed));
        context.configPanelState = { phase: "panel_list", cursor: 0 };
        submittedPending = false;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      // ─── D.13E Step 2 — config-* 三类事件：ConfigPanel 自带 useInput 上抛 ─────
      if (event.type === "config-move") {
        if (!context.configPanelState) return;
        const step = reduceConfigState(context.configPanelState, {
          type: "move",
          delta: event.delta,
        });
        context.configPanelState =
          step.next.phase === "idle" ? undefined : (step.next as typeof context.configPanelState);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "config-enter") {
        if (!context.configPanelState) return;
        const step = reduceConfigState(context.configPanelState, { type: "enter" });
        context.configPanelState =
          step.next.phase === "idle" ? undefined : (step.next as typeof context.configPanelState);
        if (step.dispatch.kind === "slash") {
          // 关闭面板再派 slash，避免 panel UI 与 slash 输出叠加。
          context.configPanelState = undefined;
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          // 推 transcript 命令行，与用户手敲 slash 保持一致的视觉反馈。
          blocks.push(createCommandBlock(commandSequence++, step.dispatch.command));
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          await processTuiLine(step.dispatch.command, context, gateway, shellOutput, store);
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          return;
        }
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "config-back") {
        if (!context.configPanelState) return;
        const step = reduceConfigState(context.configPanelState, { type: "back" });
        context.configPanelState =
          step.next.phase === "idle" ? undefined : (step.next as typeof context.configPanelState);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      // ─── D.13E Step 2 修正 #3 — permission-action atomic 路由 ────────────────
      if (event.type === "permission-action") {
        const approval = context.pendingLocalApproval;
        if (!approval) return;
        switch (event.actionId) {
          case "details":
            writeLine(shellOutput, formatPendingApprovalDetails(approval, context));
            shell?.rerender();
            await shell?.waitUntilRenderFlush();
            return;
          case "cancel": {
            context.pendingLocalApproval = undefined;
            await executePermissionDeny(approval, context, gateway, shellOutput, true);
            shell?.rerender();
            await shell?.waitUntilRenderFlush();
            return;
          }
          case "deny":
          case "no": {
            context.pendingLocalApproval = undefined;
            await executePermissionDeny(approval, context, gateway, shellOutput, false);
            shell?.rerender();
            await shell?.waitUntilRenderFlush();
            return;
          }
          case "allow_once":
          case "yes": {
            context.pendingLocalApproval = undefined;
            await executePermissionApprove(approval, context, gateway, shellOutput);
            shell?.rerender();
            await shell?.waitUntilRenderFlush();
            return;
          }
          case "allow_always_tool": {
            // 修正 #3：先持久化 allow rule，成功后再 approve；失败则不 approve、保留 pending
            if (approval.kind !== "model_tool_use") {
              // 非 model_tool_use 没有"工具规则持久化"语义，退化为 allow_once
              context.pendingLocalApproval = undefined;
              await executePermissionApprove(approval, context, gateway, shellOutput);
              shell?.rerender();
              await shell?.waitUntilRenderFlush();
              return;
            }
            const tool = approval.toolName;
            const risk: PermissionRule["risk"] = tool === "Bash" ? "high" : "medium";
            const result = await addAllowRule(context, tool, risk);
            // D.13L Block 0-C — 权限卡里的"始终允许"反馈降噪：
            // 不再把 "已添加权限规则：<uuid> allow Bash high" 这类含 rule.id 的审计文案
            // 直接写到主屏。added / duplicate 都视为持久化成功，给同一句"已记住"。
            // save_failed / invalid 走人性化分支，仍保留可操作信息但不含 rule.id。
            const isEn = context.language === "en-US";
            if (result.kind === "added" || result.kind === "duplicate") {
              writeLine(
                shellOutput,
                isEn
                  ? `Remembered: future ${tool} actions like this will be allowed.`
                  : `已记住：以后这类 ${tool} 操作将自动允许。`,
              );
            }
            if (result.kind === "save_failed") {
              writeLine(
                shellOutput,
                isEn
                  ? `Could not save the permission rule: ${result.error.message}`
                  : `保存权限规则失败：${result.error.message}`,
              );
              writeLine(
                shellOutput,
                isEn
                  ? "Permission rule was not persisted; pending approval kept."
                  : "权限规则未保存；当前 pending 仍保留，可重试或选择其它动作。",
              );
              shell?.rerender();
              await shell?.waitUntilRenderFlush();
              return;
            }
            if (result.kind === "invalid") {
              writeLine(
                shellOutput,
                isEn ? `Unknown tool: ${tool}` : `未知工具：${tool}`,
              );
              shell?.rerender();
              await shell?.waitUntilRenderFlush();
              return;
            }
            // duplicate / added 都视为持久化成功 → approve
            context.pendingLocalApproval = undefined;
            await executePermissionApprove(approval, context, gateway, shellOutput);
            shell?.rerender();
            await shell?.waitUntilRenderFlush();
            return;
          }
        }
        return;
      }
      // P1-6: immediately enter pending state to prevent home flicker
      submittedPending = true;
      // Slash commands are user-visible commands, not chat input. Push a
      // dedicated command block (kind="command", keep=true) into the
      // transcript so it survives ShellBlockOutput splice and renders as an
      // independent `❯ /command` row above the tool/output blocks.
      if (event.type === "submit" && event.text.startsWith("/")) {
        // D.13E Step 2 — 用 createCommandBlock 替代手写 push，统一 transcript 行格式。
        blocks.push(createCommandBlock(commandSequence++, event.text));
      }
      shell?.rerender();
      await shell?.waitUntilRenderFlush();
      let result: Awaited<ReturnType<typeof processTuiLine>>;
      try {
        result = await processTuiLine(
          event.type === "submit" ? event.text : "",
          context,
          gateway,
          shellOutput,
          store,
        );
      } finally {
        submittedPending = false;
        shell?.rerender();
      }
      if (result === "exit") {
        shell?.unmount();
        resolveExit(0);
        return;
      }
      await shell?.waitUntilRenderFlush();
    },
  };

  try {
    shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: errorOutput,
    });
  } catch (error) {
    blocks.push(
      createOutputBlock(
        context.language === "en-US"
          ? `Ink shell failed to start; falling back to plain TUI. ${error instanceof Error ? error.message : String(error)}`
          : `Ink shell 启动失败，已降级到 plain TUI。${error instanceof Error ? error.message : String(error)}`,
        context.language,
        "ink-fallback",
      ),
    );
    writePlainShell(output, controller.getViewModel());
    return await runPlainTui(input, output, context, gateway, store, startup, sigintHandler);
  }
  return await exitPromise;
}

async function processTuiLine(
  line: string,
  context: TuiContext,
  gateway: ModelGateway,
  output: Writable,
  store: SessionStore,
): Promise<TuiLineResult> {
  const text = line.trim();
  if (!text) {
    if (context.pendingModelSetup) {
      await handleModelSetupInput("", context, output);
      return "continue";
    }
    if (hasPendingEnterConfirmation(context)) {
      await confirmPendingInteraction(context, output);
      return "continue";
    }
    if (shouldOfferUserScopedModelSetup(context)) {
      await startModelSetup(context, output);
    }
    return "continue";
  }

  const commandResult = await handleSlashCommand(text, context, output);
  if (commandResult === "exit") {
    if (context.sessionId && !context.sessionEnded) {
      await store.appendEvent(context.sessionId, createSessionEndEvent(context.sessionId));
      context.sessionEnded = true;
    }
    writeLine(output, t(context, "exit"));
    return "exit";
  }
  if (commandResult === "message") {
    const naturalResult = await handleNaturalInput(text, context, gateway, output);
    if (naturalResult === "message") {
      await sendMessage(text, context, gateway, output);
    }
  }
  return "continue";
}

async function shouldEnterInkShell(input: Readable, output: Writable): Promise<boolean> {
  if (!shouldEnterProductShellCandidate(input, output)) return false;
  const { shouldUseInkShell } = await import("./shell/ink-renderer.js");
  return shouldUseInkShell(input, output);
}

/**
 * D13E-P3 cleanup #4 — 识别 plain TUI 的 StatusTray raw 行
 * （`formatRuntimeStatusLine` 的产出）。Ink 模式下任何残留 writeLine 该格式
 * 的字符串都视为噪音，必须从 ShellBlockOutput._write 静默丢弃。
 *
 * 命中条件（任意一条即可，line 已经 trim）：
 *   - "[Linghun] 会话 …" / "[Linghun] 会话 ..." 中文格式
 *   - "Status: Session …" 英文格式
 *   - 同时包含 "确认 " 与 "后台 "（中文 fallback）
 *   - 同时包含 "Gate " 与 "BG "（英文 fallback；前导可有可无的 "· "
 *     分隔符，所以这里只查 token 关键字）
 *
 * 故意保守：长 doctor 报告 / 错误堆栈 / 用户回声不会同时命中两个 token。
 */
function isRuntimeStatusDump(line: string): boolean {
  if (line.startsWith("[Linghun] 会话 ")) return true;
  if (line.startsWith("Status: Session ")) return true;
  if (line.includes("确认 ") && line.includes("后台 ")) return true;
  if (line.includes("Gate ") && line.includes("BG ")) return true;
  return false;
}

class ShellBlockOutput extends Writable {
  /**
   * 当前 active 的 assistant streaming block id（keep:true，由
   * beginAssistantStream 注册）。endAssistantStream 之后清空，下一轮
   * 再 begin 时换新 id。
   *
   * 这条路径专门绕开 _write 的 createOutputBlock + ephemeral splice 逻辑：
   * 流式 assistant_text_delta 不应被当作普通 writeLine 反复 push/splice，
   * 否则只会留下最后一片 chunk 而非完整文本。
   */
  private assistantBlockId: string | undefined;

  constructor(
    private readonly context: TuiContext,
    private readonly blocks: ProductBlockViewModel[],
    private readonly onWrite: () => void,
  ) {
    super();
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    const text = chunk.toString();
    const normalized = text.trim();
    if (normalized) {
      // D13E-P3 cleanup #4 — 拦截 plain TUI 用的 StatusTray raw 行（writeStatus
      // 的产出）。Ink 路径下任何 writeLine/handleTuiKeypress 残留写出
      // "[Linghun] 会话 ... · 后台 N" / "Status: Session ..." 都会被这里 drop，
      // 让 task transcript 永远看不到那条噪音。新 TaskFooter 已经覆盖必要状态
      // （permission · model · cache · index · reasoning），所以丢弃这条不损失信号。
      if (isRuntimeStatusDump(normalized)) {
        callback();
        return;
      }
      this.blocks.push(createOutputBlock(normalized, this.context.language));
      // 缓存"最近一次普通 writeLine 的完整正文"，让 /details 默认分支可以展开
      // 长正文（如 /model doctor 的 provider.env merge / providers / endpointPath
      // 等多行 body）。/details 自身不能覆盖这条记录，否则连续 /details 会陷入
      // 套娃；handleDetailsCommand 在执行期间设置 suppressLastFullOutputCapture
      // 标记位跳过缓存。
      if (!this.context.suppressLastFullOutputCapture) {
        this.context.lastFullOutput = normalized;
      }
      // 只回收非 keep 的 ephemeral 输出，让 keep:true 的 transcript row（slash
      // command 行等）穿透 splice，保住分层。回收策略：保留所有 keep 块 + 最后
      // 一条 ephemeral 块。
      const keepBlocks = this.blocks.filter((b) => b.keep);
      const ephemeralBlocks = this.blocks.filter((b) => !b.keep);
      if (ephemeralBlocks.length > 1) {
        const lastEphemeral = ephemeralBlocks[ephemeralBlocks.length - 1];
        this.blocks.length = 0;
        this.blocks.push(...keepBlocks);
        if (lastEphemeral) this.blocks.push(lastEphemeral);
      }
      this.onWrite();
    }
    callback();
  }

  /**
   * 注册一个 keep:true 的 assistant streaming block。后续每个
   * appendAssistantDelta 都会 mutate 同一条 block.fullText / summary，
   * 不再走 _write → createOutputBlock + splice 这条 ephemeral 路径，
   * 因此 splice 不会把流式正文淘汰为最后一片 chunk。
   *
   * id 由调用方传入（每个 request 用一个稳定 id），便于多轮请求各自占用
   * 独立 block，互不覆盖。
   */
  beginAssistantStream(id: string): void {
    this.assistantBlockId = id;
    // 复用 createOutputBlock 拿到 i18n 后的 title / 占位 summary，再补 keep:true。
    // 初始 fullText 用空串，后续 appendAssistantDelta 会累计实际正文。
    const initial = createOutputBlock("", this.context.language, id);
    initial.keep = true;
    initial.fullText = "";
    initial.nextAction = undefined;
    this.blocks.push(initial);
    this.onWrite();
  }

  /**
   * 将一段 assistant_text_delta 追加到当前 streaming block。
   * - fullText 累计完整正文
   * - summary 取累计正文的首个非空行
   * - 找不到 active block 时静默 fallback 到 _write，保持非交互回退
   */
  appendAssistantDelta(text: string): void {
    if (!text) return;
    const id = this.assistantBlockId;
    if (!id) {
      this._write(text, "utf8", () => {});
      return;
    }
    const block = this.blocks.find((b) => b.id === id);
    if (!block) {
      this.assistantBlockId = undefined;
      this._write(text, "utf8", () => {});
      return;
    }
    const nextFull = `${block.fullText ?? ""}${text}`;
    const firstLine = nextFull.split("\n").find((line) => line.trim()) ?? nextFull;
    block.fullText = nextFull;
    block.summary = firstLine || block.summary;
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = nextFull;
    }
    this.onWrite();
  }

  /**
   * 结束当前 streaming block 的 active 状态。block 保留在 this.blocks
   * 中作为 transcript row（keep:true 已确保 view-model 不会 slice 它），
   * 只清掉 active id，下一轮 beginAssistantStream 会换新 id。
   */
  endAssistantStream(): void {
    this.assistantBlockId = undefined;
    this.onWrite();
  }
}

/**
 * Duck-typed helpers for assistant streaming. Ink shell 注入 ShellBlockOutput
 * 时走 begin/append/end 三段式，把每个 assistant_text_delta 累积到同一条
 * keep:true block；其他 Writable（plain TUI、MemoryOutput、tests）走原始
 * output.write 路径，保持非交互行为不变。
 */
function beginAssistantStream(output: Writable, id: string): void {
  const candidate = output as { beginAssistantStream?: (id: string) => void };
  if (typeof candidate.beginAssistantStream === "function") {
    candidate.beginAssistantStream(id);
  }
}

function writeAssistantDelta(output: Writable, _id: string, text: string): void {
  if (!text) return;
  const candidate = output as { appendAssistantDelta?: (text: string) => void };
  if (typeof candidate.appendAssistantDelta === "function") {
    candidate.appendAssistantDelta(text);
    return;
  }
  output.write(text);
}

function endAssistantStream(output: Writable): void {
  const candidate = output as { endAssistantStream?: () => void };
  if (typeof candidate.endAssistantStream === "function") {
    candidate.endAssistantStream();
  }
}

export async function handleSlashCommand(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<"handled" | "exit" | "message"> {
  if (context.pendingModelSetup) {
    await handleModelSetupInput(text, context, output);
    return "handled";
  }

  if (!text.startsWith("/")) {
    return "message";
  }

  if (context.pendingNaturalCommand?.exactCommand === text.trim()) {
    context.pendingNaturalCommand = undefined;
  }

  const [command, ...rest] = text.split(/\s+/);
  if (command === "/" || command === "/?") {
    writeLine(output, formatSlashDiscovery(context.language));
    return "handled";
  }
  const workspaceGuard = getWorkspaceTrustCommandGuard(command, rest, context);
  if (workspaceGuard) {
    writeLine(output, workspaceGuard);
    writeStatus(output, context);
    return "handled";
  }
  if (command === "/help") {
    const variantArg = (rest[0] ?? "").toLowerCase();
    const variant: "short" | "all" | "advanced" | "details" =
      variantArg === "all"
        ? "all"
        : variantArg === "advanced"
          ? "advanced"
          : variantArg === "details"
            ? "details"
            : "short";
    writeLine(
      output,
      formatCatalogHelp(context.language, context.permissionMode, false, variant),
    );
    return "handled";
  }
  if (command === "/features") {
    writeLine(output, formatFeaturePolicy(context));
    return "handled";
  }
  if (command === "/model") {
    await handleModelCommand(rest, context, output);
    return "handled";
  }
  if (command === "/language") {
    await handleLanguageCommand(rest, context, output);
    return "handled";
  }
  if (command === "/mode") {
    await handleModeCommand(rest, context, output);
    return "handled";
  }
  if (command === "/plan") {
    await handlePlanCommand(rest, context, output);
    return "handled";
  }
  if (command === "/permissions") {
    await handlePermissionsCommand(rest, context, output);
    return "handled";
  }
  if (command === "/background") {
    await handleBackgroundCommand(rest, context, output);
    return "handled";
  }
  if (command === "/job") {
    await handleJobCommand(rest, context, output);
    return "handled";
  }
  if (command === "/remote") {
    await handleRemoteCommand(rest, context, output);
    return "handled";
  }
  if (command === "/details") {
    await handleDetailsCommand(rest, context, output);
    return "handled";
  }
  if (command === "/agents") {
    await handleAgentsCommand(rest, context, output);
    return "handled";
  }
  if (command === "/fork") {
    await handleForkCommand(rest, context, output);
    return "handled";
  }
  if (command === "/rewind") {
    await handleRewindCommand(rest, context, output);
    return "handled";
  }
  if (command === "/btw") {
    await handleBtwCommand(rest, context, output);
    return "handled";
  }
  if (command === "/interrupt") {
    await handleInterruptCommand(context, output);
    return "handled";
  }
  if (command === "/claim-check") {
    await handleClaimCheckCommand(rest, context, output);
    return "handled";
  }
  if (command === "/verify") {
    await handleVerifyCommand(rest, context, output);
    return "handled";
  }
  if (command === "/review") {
    await handleReviewCommand(context, output);
    return "handled";
  }
  if (command === "/vision") {
    await handleVisionCommand(rest, context, output);
    return "handled";
  }
  if (command === "/image") {
    await handleImageCommand(rest, context, output);
    return "handled";
  }
  if (command === "/cache-log") {
    await handleCacheLogCommand(rest, context, output);
    return "handled";
  }
  if (command === "/cache") {
    await handleCacheCommand(rest, context, output);
    return "handled";
  }
  if (command === "/compact") {
    await handleCompactCommand(rest, context, output);
    return "handled";
  }
  if (command === "/break-cache") {
    await handleBreakCacheCommand(rest, context, output);
    return "handled";
  }
  if (command === "/mcp") {
    await handleMcpCommand(rest, context, output);
    return "handled";
  }
  if (command === "/index") {
    await handleIndexCommand(rest, context, output);
    return "handled";
  }
  if (command === "/resume") {
    await handleResumeCommand(rest, context, output);
    return "handled";
  }
  if (command === "/branch") {
    await handleBranchCommand(rest, context, output);
    return "handled";
  }
  if (command === "/memory") {
    await handleMemoryCommand(rest, context, output);
    return "handled";
  }
  if (command === "/skills") {
    await handleSkillsCommand(rest, context, output);
    return "handled";
  }
  if (command === "/workflows") {
    await handleWorkflowsCommand(rest, context, output);
    return "handled";
  }
  if (command === "/plugins") {
    await handlePluginsCommand(rest, context, output);
    return "handled";
  }
  if (command === "/doctor") {
    await handleDoctorCommand(rest, context, output);
    return "handled";
  }
  if (command === "/problems") {
    writeLine(output, formatTerminalProblemsPanel(createTerminalReadinessView(context)));
    return "handled";
  }
  if (command === "/usage") {
    writeLine(output, formatUsage(context));
    return "handled";
  }
  if (command === "/stats") {
    writeLine(output, formatStats(rest, context));
    return "handled";
  }
  if (command === "/status") {
    writeStatus(output, context);
    writeLine(output, formatTerminalReadinessStatus(createTerminalReadinessView(context)));
    return "handled";
  }
  if (command === "/tab") {
    await cycleMode(context, output);
    return "handled";
  }
  if (command === "/esc") {
    await cancelPendingInteraction(context, output, "Esc");
    return "handled";
  }
  if (command === "/enter") {
    await confirmPendingInteraction(context, output);
    return "handled";
  }
  if (command === "/trust") {
    await handleTrustCommand(rest, context, output);
    return "handled";
  }
  if (command === "/autopilot") {
    await handleAutopilotCommand(rest, context, output);
    return "handled";
  }
  if (command === "/sessions") {
    if (rest[0] === "resume") {
      const sessionId = rest[1];
      if (!sessionId) {
        writeLine(output, "用法：/sessions resume <id>");
        return "handled";
      }
      await resumeSessionWithHandoff(sessionId, context, output, "sessions resume");
      return "handled";
    }

    const sessions = await context.store.list();
    if (sessions.length === 0) {
      writeLine(output, t(context, "noSessions"));
      return "handled";
    }
    writeLine(output, t(context, "sessionHeader"));
    for (const session of sessions) {
      const marker = session.id === context.sessionId ? "*" : " ";
      writeLine(
        output,
        `${marker} ${session.id}  ${session.updatedAt}  ${session.summary ?? t(context, "noSummary")}`,
      );
    }
    return "handled";
  }
  const toolName = slashCommandToTool(command);
  if (toolName) {
    await handleToolCommand(toolName, rest, context, output);
    return "handled";
  }
  if (command === "/config") {
    writeLine(output, formatConfigOverview(context));
    return "handled";
  }
  if (command === "/exit") {
    return "exit";
  }

  const prefixCandidates = getSlashPrefixCandidates(command);
  if (prefixCandidates.length > 0) {
    writeLine(output, formatSlashDiscovery(context.language, command));
    return "handled";
  }

  writeLine(output, formatUnknownSlashCommand(command, context.language));
  return "handled";
}

function formatConfigOverview(context: TuiContext): string {
  const zh = context.language === "zh-CN";
  const yes = zh ? "是" : "yes";
  const no = zh ? "否" : "no";
  const onOff = (b: boolean) => (b ? yes : no);
  const executor = context.config.modelRoutes.routes.find((r) => r.role === "executor");
  const trust = context.config.workspaceTrust;
  const trustLabel = trust.recorded
    ? trust.level === "trusted"
      ? zh
        ? "已信任"
        : "trusted"
      : zh
        ? "受限"
        : "restricted"
    : zh
      ? "未记录"
      : "unrecorded";
  const mcpServers = context.config.mcp.enabledServers.join(", ") || (zh ? "无" : "none");
  const indexStatus = context.index.status || (zh ? "未知" : "unknown");
  const cacheCount = context.cache.history.length;
  const bgRunning = context.backgroundTasks.filter((t) => t.status === "running").length;
  const skillsTrusted = context.skills.trustedIds.length;
  const pluginsTrusted = context.plugins.trustedIds.length;
  const remoteEnabled = Boolean(
    (context.config as { remote?: { enabled?: boolean } }).remote?.enabled,
  );

  if (zh) {
    return [
      "配置概览（一站式只读）",
      `- 语言：${context.config.language}（用 /language en-US 切换）`,
      `- 模型：${context.model}（执行器 allowTools=${onOff(Boolean(executor?.allowTools))}；用 /model、/model doctor、/model route 查看与诊断）`,
      `- 权限模式：${context.permissionMode}（用 /mode 切换；规则用 /permissions）`,
      `- 工作区信任：${trustLabel}（用 /trust 调整）`,
      `- 索引：${indexStatus}（用 /index status、/index doctor、/index check）`,
      `- MCP：启用=${mcpServers}（用 /mcp、/mcp doctor、/mcp tools）`,
      "- 记忆：用 /memory、/memory storage、/memory review、/memory learn",
      `- 缓存：history=${cacheCount}（用 /cache status、/cache-log、/usage、/stats）`,
      `- 后台：running=${bgRunning}（用 /background、/job、/details）`,
      `- 远程：enabled=${onOff(remoteEnabled)}（用 /remote）`,
      `- 钩子：enabled=${onOff(context.hooks.enabled)}；项目信任=${onOff(context.hooks.projectTrusted)}（用 /doctor hooks）`,
      `- 插件：discover=${onOff(context.plugins.enabled)}；信任 id 数=${pluginsTrusted}（用 /plugins、/plugins doctor）`,
      `- 技能：discover=${onOff(context.skills.enabled)}；信任 id 数=${skillsTrusted}（用 /skills、/skills status）`,
      `- 工作流：discover=${onOff(context.workflows.enabled)}（用 /workflows）`,
      "下一步：直接输入对应 slash 进入；用 /features 查看默认功能策略，用 /help all 查看完整命令表。",
    ].join("\n");
  }
  return [
    "Configuration overview (one-stop read-only)",
    `- language: ${context.config.language} (switch via /language en-US)`,
    `- model: ${context.model} (executor allowTools=${onOff(Boolean(executor?.allowTools))}; use /model, /model doctor, /model route)`,
    `- permission mode: ${context.permissionMode} (switch via /mode; rules via /permissions)`,
    `- workspace trust: ${trustLabel} (adjust via /trust)`,
    `- index: ${indexStatus} (use /index status, /index doctor, /index check)`,
    `- MCP: enabled=${mcpServers} (use /mcp, /mcp doctor, /mcp tools)`,
    "- memory: use /memory, /memory storage, /memory review, /memory learn",
    `- cache: history=${cacheCount} (use /cache status, /cache-log, /usage, /stats)`,
    `- background: running=${bgRunning} (use /background, /job, /details)`,
    `- remote: enabled=${onOff(remoteEnabled)} (use /remote)`,
    `- hooks: enabled=${onOff(context.hooks.enabled)}; projectTrusted=${onOff(context.hooks.projectTrusted)} (use /doctor hooks)`,
    `- plugins: discover=${onOff(context.plugins.enabled)}; trustedIds=${pluginsTrusted} (use /plugins, /plugins doctor)`,
    `- skills: discover=${onOff(context.skills.enabled)}; trustedIds=${skillsTrusted} (use /skills, /skills status)`,
    `- workflows: discover=${onOff(context.workflows.enabled)} (use /workflows)`,
    "Next: type the slash to enter the panel. /features for default policy. /help all for the full command list.",
  ].join("\n");
}

function formatFeaturePolicy(context: TuiContext): string {
  return [
    "Feature policy（default CCB-style posture）",
    "Recommended foundation（default on / visible）",
    `- language: ${context.config.language}; en-US available via /language en-US`,
    `- model/tool loop: enabled through provider tools=${context.config.modelRoutes.routes.find((route) => route.role === "executor")?.allowTools ? "yes" : "no"}; evidence and long output are kept in details, available via /details`,
    `- cache/stats: /cache status, /break-cache status, /usage, /stats; history=${context.cache.history.length}`,
    `- model doctor: /model doctor and /model route doctor; provider=${getRuntimeStatusProvider(context)} model=${context.model}`,
    "- index: status/search/architecture are readonly; init fast/refresh are safe local actions with safety scan; auto full-repo index on startup=no",
    `- codebase-memory MCP: discoverable/diagnosable via /mcp doctor; enabledServers=${context.config.mcp.enabledServers.join(",") || "none"}`,
    `- permissions: project allowlist visible via /permissions; defaultMode=${context.permissionMode}`,
    "Advanced/high-cost/automation（discoverable, not auto-run）",
    "- memory: auto long-term extraction=no; autoAccept=no; review via /memory review",
    `- skills: discover manifests=${context.skills.enabled ? "yes" : "no"}; autoExecute=no; trustedIds=${context.skills.trustedIds.join(",") || "none"}`,
    `- workflows: discover templates=${context.workflows.enabled ? "yes" : "no"}; autoRun=no; /workflows <name> only shows Start Gate`,
    `- plugins: discover manifests=${context.plugins.enabled ? "yes" : "no"}; autoExecute=no; trustedIds=${context.plugins.trustedIds.join(",") || "none"}`,
    "- agents/background: manual commands only; verifier auto fork=no; coordinator/multi-worker=unsupported",
    "Dangerous defaults（off）",
    "- full-access permission: default off; requires LINGHUN_ENABLE_FULL_ACCESS=1; auto-review never auto-allows Bash/network/deps/permission/plugin/hook/remote",
    `- hooks: enabled=${context.hooks.enabled ? "yes" : "no"}; projectTrusted=${context.hooks.projectTrusted ? "yes" : "no"}; auto execution=no`,
    "- auto accept all edits=no; auto dependency install=no; auto networking=no; delete/rename/restore auto execution=no",
    "- plugin marketplace auto install/update=no; remote bridge/control auto connect=no; continuous phase progression=no",
    "Unsupported / pending",
    "- remote channels, voice, computer-use/browser control, daemon jobs, plugin marketplace, and AI sessions auto injection are not default features.",
  ].join("\n");
}

function formatSkills(context: TuiContext): string {
  const lines = [
    "Skills（summary-first / load-on-demand）",
    `- projectDir: ${context.skills.projectDir}`,
    `- userDir: ${context.skills.userDir}`,
    `- enabled: ${context.skills.enabled ? "yes" : "no"}`,
    `- evolutionCandidates: ${context.skills.evolutionCandidates.length}（candidate only; autoEnable=no）`,
  ];
  if (context.skills.lastError) {
    lines.push(`- lastError: ${context.skills.lastError}`);
  }
  if (context.skills.skills.length === 0) {
    lines.push(
      "- none：可运行 /skills add 查看注册路径，或 /skills install local <path> 安装本地 skill manifest。",
    );
  }
  for (const skill of context.skills.skills) {
    const error = skill.lastError ? ` lastError=${skill.lastError}` : "";
    lines.push(
      `- ${skill.id}: ${skill.enabled ? "enabled" : "disabled"} trusted=${skill.trusted ? "yes" : "no"} source=${skill.source} scope=${skill.scope} version=${skill.version} triggers=${skill.triggers.join(",") || "-"} write=${skill.mayWrite ? "yes" : "no"} bash=${skill.mayExecute ? "yes" : "no"} network=${skill.mayNetwork ? "yes" : "no"} summary=${skill.summary}${error}`,
    );
  }
  lines.push(
    "- note: 默认只加载 metadata/description/triggers/stable summary；不会把 skill 正文塞进 prompt；evolution candidate 只记录建议，不写文件、不启用。",
  );
  return lines.join("\n");
}

function createSkillEvolutionCandidate(summary: string, source: string): SkillEvolutionCandidate {
  return {
    id: randomUUID(),
    status: "candidate",
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 240),
    triggerCondition: "repeated verified workflow success or explicit user request",
    source,
    risk: "medium",
    suggestedPath:
      "manual-review-only; use /skills install local <path> after creating a trusted manifest",
    createdAt: new Date().toISOString(),
  };
}

function formatWorkflows(context: TuiContext): string {
  return [
    "Workflows（本地模板，启动前必须 Start Gate）",
    ...context.workflows.templates.map(
      (item) =>
        `- ${item.id}: purpose=${item.purpose} risk=${item.risk} writesFiles=${item.writesFiles ? "yes" : "no"} validation=${item.recommendedValidation.join(" | ")}`,
    ),
    "- run: /workflows <name> 只进入启动确认说明；写文件/Bash/联网/安装依赖仍走权限管道。",
  ].join("\n");
}

function formatPlugins(context: TuiContext): string {
  const lines = [
    "Plugins（本地 manifest loader）",
    `- projectDir: ${context.plugins.projectDir}`,
    `- userDir: ${context.plugins.userDir}`,
    `- enabled: ${context.plugins.enabled ? "yes" : "no"}`,
  ];
  if (context.plugins.lastError) {
    lines.push(`- lastError: ${context.plugins.lastError}`);
  }
  if (context.plugins.plugins.length === 0) {
    lines.push(
      "- none：把本地 manifest 放到 project/user plugins 目录，或运行 /plugins install local <path>；Git/GitHub 仅支持受控 metadata 安装。",
    );
  }
  for (const plugin of context.plugins.plugins) {
    lines.push(
      `- ${plugin.id}: ${plugin.enabled ? "enabled" : "disabled"} trusted=${plugin.trusted ? "yes" : "no"} source=${plugin.source} scope=${plugin.scope} version=${plugin.version} write=${plugin.mayWrite ? "yes" : "no"} bash=${plugin.mayExecute ? "yes" : "no"} network=${plugin.mayNetwork ? "yes" : "no"} commands=${plugin.contributions.commands.join(",") || "-"} hooks=${plugin.contributions.hooks.join(",") || "-"} workflows=${plugin.contributions.workflows.join(",") || "-"} skills=${plugin.contributions.skills.join(",") || "-"}`,
    );
  }
  lines.push("- note: plugin 贡献项稳定排序；贡献工具仍走统一权限管道，加载失败隔离。");
  return lines.join("\n");
}

function formatPluginsDoctor(context: TuiContext): string {
  return [
    "Plugins doctor",
    `- manifest count: ${context.plugins.plugins.length}`,
    `- disabledIds: ${context.plugins.disabledIds.join(",") || "none"}`,
    `- trustedIds: ${context.plugins.trustedIds.join(",") || "none"}`,
    ...context.plugins.plugins.map((plugin) => {
      const risk = !plugin.trusted ? `BLOCK untrusted ${plugin.source}` : "ok";
      const error = plugin.lastError ? ` lastError=${plugin.lastError}` : "";
      return `- ${plugin.id}: ${risk} path=${plugin.path} permissions=${plugin.permissions.join(",") || "none"}${error}`;
    }),
    "- boundary: 不执行远程安装/自动更新/完整沙箱；未信任 extension 不得写文件、联网或执行命令。",
  ].join("\n");
}

function formatHooksDoctor(context: TuiContext): string {
  const cacheImpact = stableHash(createExtensionFreshnessSummary(context));
  const lines = [
    "Hooks doctor",
    `- hooks enabled: ${context.hooks.enabled ? "yes" : "no"}（默认关闭）`,
    `- projectTrusted: ${context.hooks.projectTrusted ? "yes" : "no"}`,
    `- timeoutMs: ${context.hooks.timeoutMs}`,
    `- outputLimitBytes: ${context.hooks.outputLimitBytes}`,
    `- cacheImpactHash: ${cacheImpact}`,
  ];
  if (context.hooks.hooks.length === 0) {
    lines.push("- hooks: none");
  }
  for (const hook of context.hooks.hooks) {
    lines.push(
      `- ${hook.id}: event=${hook.event} enabled=${hook.enabled ? "yes" : "no"} trusted=${hook.trusted ? "yes" : "no"} source=${hook.source} scope=${hook.scope} path=${hook.path} timeoutMs=${hook.timeoutMs} outputLimitBytes=${hook.outputLimitBytes} permissions=${hook.permissions.join(",") || "none"} logPath=${hook.logPath ?? "-"} lastError=${hook.lastError ?? "none"}`,
    );
  }
  lines.push(
    "- boundary: hook 诊断只检查来源、边界和可见状态，不执行完整 hook 脚本；hook 不能绕过权限系统；失败隔离；显示输出按 outputLimitBytes 截断，完整输出只能写 logPath。",
  );
  return lines.join("\n");
}

function formatTrustNotice(kind: "skill" | "plugin", item: SkillSummary | PluginSummary): string {
  return [
    `Trust notice：即将启用 ${kind} ${item.id}`,
    `- source: ${item.source}`,
    `- path: ${item.path}`,
    `- version: ${item.version}`,
    `- sourceUrl: ${item.lifecycle.sourceUrl ? sanitizeDiagnosticText(item.lifecycle.sourceUrl) : "-"}`,
    `- ref/commit: ${item.lifecycle.ref ?? "-"}/${item.lifecycle.commit ?? "-"}`,
    `- installedAt: ${item.lifecycle.installedAt ?? "unknown"}`,
    `- permissions: ${item.permissions.join(",") || "none"}`,
    `- trust: ${item.trusted ? "trusted" : "untrusted"}`,
    `- mayWrite=${item.mayWrite ? "yes" : "no"} mayExecute=${item.mayExecute ? "yes" : "no"} mayNetwork=${item.mayNetwork ? "yes" : "no"}`,
    "- 未信任 extension 不得写文件、联网或执行命令；实际工具调用仍走权限管道。",
  ].join("\n");
}

export type ExtensionKind = "skills" | "plugins";

type ExtensionInstallSource = "local" | "git" | "github";

type ExtensionInstallRequest = {
  source: ExtensionInstallSource;
  locator: string;
  scope: ExtensionScope;
  ref?: string;
  confirmNetwork: boolean;
};

function formatExtensionStatus(kind: ExtensionKind, context: TuiContext): string {
  const items = kind === "skills" ? context.skills.skills : context.plugins.plugins;
  const title = kind === "skills" ? "Skills Connect Lite status" : "Plugins Connect Lite status";
  const disabledIds = kind === "skills" ? context.skills.disabledIds : context.plugins.disabledIds;
  const trustedIds = kind === "skills" ? context.skills.trustedIds : context.plugins.trustedIds;
  return [
    title,
    "- lifecycle: add/install, validate, enable/disable, remove/update, trust notice, doctor/status",
    `- installed: ${items.length}`,
    `- disabledIds: ${disabledIds.join(",") || "none"}`,
    `- trustedIds: ${trustedIds.join(",") || "none"}`,
    ...items.map((item) => {
      const source = item.lifecycle.sourceUrl
        ? `sourceUrl=${sanitizeDiagnosticText(item.lifecycle.sourceUrl)}`
        : `localPath=${redactedPath(item.lifecycle.localPath)}`;
      return `- ${item.id}: ${item.enabled ? "enabled" : "disabled"} trust=${item.lifecycle.trustLevel} ${source} ref=${item.lifecycle.ref ?? "-"} commit=${item.lifecycle.commit ?? "-"} permissions=${item.lifecycle.permissionSummary} discovered=${item.lifecycle.discovered ? "yes" : "no"} registered=${item.lifecycle.registered ? "yes" : "no"} schemaLoaded=${item.lifecycle.schemaLoaded ? "yes" : "no"} runtime=${item.lifecycle.runtimeVersion}${item.lastError ? ` loadError=${truncateDisplay(item.lastError, 80)}` : ""}`;
    }),
    "- boundary: Git/GitHub 安装只做受控 clone/fetch 和 manifest/SKILL.md 读取；不执行 postinstall、hook、仓库脚本或第三方代码。",
  ].join("\n");
}

function parseExtensionInstallRequest(args: string[]): ExtensionInstallRequest | null {
  const [first, second, ...remaining] = args;
  if (!first) {
    return null;
  }
  let source: ExtensionInstallSource;
  let locator: string;
  let rest: string[];
  if (first === "local" || first === "git" || first === "github") {
    if (!second) {
      return null;
    }
    source = first;
    locator = second;
    rest = remaining;
  } else if (first.startsWith("github:")) {
    source = "github";
    locator = first.slice("github:".length);
    rest = [second, ...remaining].filter((item): item is string => Boolean(item));
  } else if (isGitLocator(first)) {
    source = "git";
    locator = first;
    rest = [second, ...remaining].filter((item): item is string => Boolean(item));
  } else {
    source = "local";
    locator = first;
    rest = [second, ...remaining].filter((item): item is string => Boolean(item));
  }
  if (!locator) {
    return null;
  }
  let scope: ExtensionScope = "project";
  let ref: string | undefined;
  let confirmNetwork = false;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--scope" && (rest[index + 1] === "project" || rest[index + 1] === "user")) {
      scope = rest[index + 1] as ExtensionScope;
      index += 1;
      continue;
    }
    if (value === "--ref" && rest[index + 1]) {
      ref = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--confirm-network") {
      confirmNetwork = true;
    }
  }
  return { source, locator, scope, ref, confirmNetwork };
}

function isGitLocator(value: string): boolean {
  return /^https?:\/\//iu.test(value) || /^git@/iu.test(value) || value.endsWith(".git");
}

function formatExtensionInstallGate(
  kind: ExtensionKind,
  request: ExtensionInstallRequest,
  command: string,
): string {
  return [
    `Connect Lite Start Gate：${kind} install ${request.source}`,
    `- source: ${sanitizeDiagnosticText(request.locator)}`,
    `- scope: ${request.scope}`,
    `- ref: ${request.ref ?? "default"}`,
    "- risk: network + third-party extension metadata; install 前只读取 manifest / SKILL.md / metadata。",
    "- boundary: 不执行仓库脚本、postinstall、hook、依赖安装或任意第三方代码。",
    "- recovery: 失败不会覆盖已有启用项；可运行 status/doctor 查看来源、加载错误和下一步。",
    "- permission: --confirm-network 是 exact-command Start Gate confirmation，不是完整 permission approval；后续工具/Bash/联网仍走权限管道，确认执行会写入 audit event。",
    `- exact command: ${formatExtensionInstallExactCommand(command, request)}`,
  ].join("\n");
}

function formatExtensionInstallExactCommand(
  command: string,
  request: ExtensionInstallRequest,
): string {
  const parts = [command];
  if (!/\supdate\s/u.test(command)) {
    parts.push(request.source, request.locator);
    if (request.scope !== "project") {
      parts.push("--scope", request.scope);
    }
  }
  if (request.ref) {
    parts.push("--ref", request.ref);
  }
  parts.push("--confirm-network");
  return parts.join(" ");
}

async function installExtensionFromRequest(
  kind: ExtensionKind,
  request: ExtensionInstallRequest,
  context: TuiContext,
): Promise<{ ok: false; summary: string } | { ok: true; summary: string; id: string }> {
  const targetDir = getExtensionTargetDir(kind, request.scope, context);
  await mkdir(targetDir, { recursive: true });
  if (request.source === "local") {
    const localPath = resolve(context.projectPath, request.locator);
    const result = await installExtensionFromDirectory(kind, localPath, targetDir, {
      localPath,
      source: "local",
    });
    if (result.ok) {
      context.config = await resetExtensionTrustForInstall(kind, result.id, context.projectPath);
    }
    return result;
  }
  if (request.confirmNetwork) {
    const sessionId = await ensureSession(context);
    await appendSystemEvent(
      context,
      sessionId,
      `connect_lite_network_start_gate_confirmed: kind=${kind} source=${request.source} scope=${request.scope} ref=${request.ref ?? "default"} locator=${sanitizeDiagnosticText(request.locator)} boundary=exact-command_start_gate_not_full_permission_approval`,
      "info",
    );
  }
  if (!request.confirmNetwork) {
    return { ok: false, summary: "network confirmation required" };
  }
  const sourceUrl =
    request.source === "github" ? githubRepoToUrl(request.locator) : request.locator;
  if (!sourceUrl) {
    return { ok: false, summary: "GitHub repo 格式应为 owner/repo，或使用完整 Git URL。" };
  }
  const tempRoot = await mkdtemp(join(tmpdir(), "linghun-connect-lite-"));
  try {
    const cloneArgs = ["-c", "core.hooksPath=/dev/null", "clone", "--depth", "1"];
    if (request.ref) {
      cloneArgs.push("--branch", request.ref);
    }
    cloneArgs.push("--", sourceUrl, tempRoot);
    const clone = await runCommandCapture("git", cloneArgs, context.projectPath, 60_000);
    if (clone.exitCode !== 0) {
      return { ok: false, summary: `受控 git clone/fetch 失败：${clone.summary}` };
    }
    const commit = await runCommandCapture(
      "git",
      ["-C", tempRoot, "rev-parse", "HEAD"],
      context.projectPath,
      10_000,
    );
    const result = await installExtensionFromDirectory(kind, tempRoot, targetDir, {
      sourceUrl,
      ref: request.ref,
      commit: commit.exitCode === 0 ? commit.stdout.trim().slice(0, 40) : undefined,
    });
    if (result.ok) {
      context.config = await resetExtensionTrustForInstall(kind, result.id, context.projectPath);
    }
    return result;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function runCommandCaptureForTest(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): ReturnType<typeof runCommandCapture> {
  return runCommandCapture(command, args, cwd, timeoutMs);
}

function githubRepoToUrl(locator: string): string | null {
  if (/^https?:\/\//iu.test(locator) || locator.endsWith(".git")) {
    return locator;
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(locator)) {
    return `https://github.com/${locator}.git`;
  }
  return null;
}

function getExtensionTargetDir(
  kind: ExtensionKind,
  scope: ExtensionScope,
  context: TuiContext,
): string {
  if (kind === "skills") {
    return scope === "project" ? context.skills.projectDir : context.skills.userDir;
  }
  return scope === "project" ? context.plugins.projectDir : context.plugins.userDir;
}

async function installExtensionFromDirectory(
  kind: ExtensionKind,
  sourcePath: string,
  targetDir: string,
  lifecycle: Pick<ExtensionLifecycleRecord, "sourceUrl" | "localPath" | "ref" | "commit"> & {
    source?: ExtensionSource;
  },
): Promise<{ ok: false; summary: string } | { ok: true; summary: string; id: string }> {
  const manifest = await readExtensionSourceManifest(kind, sourcePath);
  if (!manifest.ok) {
    return manifest;
  }
  const id = stableId(manifest.value.id, basename(sourcePath, extname(sourcePath)));
  const outputPath = join(targetDir, `${id}.json`);
  const value = {
    ...manifest.value,
    id,
    source: lifecycle.source ?? manifest.value.source ?? "third-party",
    lifecycle: {
      ...lifecycle,
      installedAt: new Date().toISOString(),
      trustLevel: "untrusted",
    },
  };
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return {
    ok: true,
    id,
    summary: `已安装 ${kind === "skills" ? "skill" : "plugin"} manifest：${id}`,
  };
}

async function readExtensionSourceManifest(
  kind: ExtensionKind,
  sourcePath: string,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; summary: string }> {
  const resolved = resolve(sourcePath);
  const info = await stat(resolved).catch(() => null);
  if (!info) {
    return { ok: false, summary: `来源不存在：${redactedPath(resolved)}` };
  }
  const candidates = info.isDirectory()
    ? [
        kind === "skills" ? "skill.json" : "plugin.json",
        kind === "skills" ? "linghun-skill.json" : "linghun-plugin.json",
        "manifest.json",
        "metadata.json",
      ].map((file) => join(resolved, file))
    : [resolved];
  for (const candidate of candidates) {
    const content = await readFile(candidate, "utf8").catch(() => null);
    if (!content) {
      continue;
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return { ok: true, value: parsed };
    } catch (error) {
      return {
        ok: false,
        summary: `manifest JSON 无效：${redactedPath(candidate)} ${formatError(error)}`,
      };
    }
  }
  if (kind === "skills" && info.isDirectory()) {
    const markdown = await readFile(join(resolved, "SKILL.md"), "utf8").catch(() => null);
    if (markdown) {
      const title = markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? basename(resolved);
      const summary = markdown
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#"));
      return {
        ok: true,
        value: {
          id: stableId(title, basename(resolved)),
          name: title,
          description: summary ?? title,
          summary: summary ?? title,
          triggers: [],
          permissions: ["read"],
        },
      };
    }
  }
  return {
    ok: false,
    summary:
      "未找到 manifest.json / metadata.json / skill.json / plugin.json；skill 可提供 SKILL.md。",
  };
}

async function refreshExtensionState(kind: ExtensionKind, context: TuiContext): Promise<void> {
  if (kind === "skills") {
    context.skills = await createSkillState(context.config, context.projectPath);
    return;
  }
  context.plugins = await createPluginState(context.config, context.projectPath);
  context.hooks = await createHookState(context.config, context.projectPath);
}

async function removeExtension(
  kind: ExtensionKind,
  id: string,
  context: TuiContext,
): Promise<string> {
  const item =
    kind === "skills"
      ? context.skills.skills.find((skill) => skill.id === id)
      : context.plugins.plugins.find((plugin) => plugin.id === id);
  if (!item) {
    return `未找到 ${kind === "skills" ? "skill" : "plugin"}：${id}`;
  }
  await rm(item.path, { force: true });
  context.config = await saveExtensionEnablement(kind, id, false, context.projectPath);
  await refreshExtensionState(kind, context);
  refreshCacheFreshness(context);
  return `已移除 ${kind === "skills" ? "skill" : "plugin"}：${id}；若需要恢复，请从原 source 重新 install。`;
}

async function updateExtension(
  kind: ExtensionKind,
  id: string,
  context: TuiContext,
  args: string[],
): Promise<string> {
  const item =
    kind === "skills"
      ? context.skills.skills.find((skill) => skill.id === id)
      : context.plugins.plugins.find((plugin) => plugin.id === id);
  if (!item) {
    return `未找到 ${kind === "skills" ? "skill" : "plugin"}：${id}`;
  }
  const source = item.lifecycle.sourceUrl ? "git" : "local";
  const request: ExtensionInstallRequest = {
    source,
    locator: item.lifecycle.sourceUrl ?? item.lifecycle.localPath ?? item.path,
    scope: item.scope,
    ref: args.includes("--ref") ? args[args.indexOf("--ref") + 1] : item.lifecycle.ref,
    confirmNetwork: args.includes("--confirm-network"),
  };
  if (source === "git" && !request.confirmNetwork) {
    return formatExtensionInstallGate(kind, request, `/${kind} update ${id}`);
  }
  const result = await installExtensionFromRequest(kind, request, context);
  if (result.ok) {
    await refreshExtensionState(kind, context);
    refreshCacheFreshness(context);
    return `已更新 ${kind === "skills" ? "skill" : "plugin"}：${id}；${result.summary}`;
  }
  return result.summary;
}

function validateExtensionItems(kind: ExtensionKind, context: TuiContext, id?: string): string {
  const items = kind === "skills" ? context.skills.skills : context.plugins.plugins;
  const selected = id ? items.filter((item) => item.id === id) : items;
  if (selected.length === 0) {
    return id
      ? `未找到 ${kind === "skills" ? "skill" : "plugin"}：${id}`
      : `没有已发现的 ${kind} manifest。`;
  }
  return [
    `${kind === "skills" ? "Skills" : "Plugins"} validate`,
    ...selected.map((item) => {
      const problems = [];
      if (!item.lifecycle.discovered) problems.push("not discovered");
      if (!item.lifecycle.registered) problems.push("not registered");
      if (!item.trusted) problems.push("untrusted");
      if (!item.lifecycle.schemaLoaded) problems.push("schema not loaded");
      if (item.lifecycle.runtimeVersion !== "compatible") problems.push("runtime incompatible");
      if (item.lastError) problems.push("load error");
      return `- ${item.id}: ${problems.length === 0 ? "ok" : problems.join("; ")} next=${problems.length === 0 ? "enable/use explicit command" : `run /${kind} doctor, then validate/enable after fixing`}`;
    }),
  ].join("\n");
}

export function validateExtensionContributionExecution(
  kind: ExtensionKind,
  id: string,
  contribution: string,
  context: Pick<TuiContext, "plugins" | "skills">,
): { ok: true } | { ok: false; summary: string } {
  const item =
    kind === "skills"
      ? context.skills.skills.find((skill) => skill.id === id)
      : context.plugins.plugins.find((plugin) => plugin.id === id);
  if (!item) {
    return {
      ok: false,
      summary: `Connect Lite guard: ${kind}:${id} 未发现，已拒绝执行。请先 install/validate。`,
    };
  }
  if (!item.enabled || !item.trusted) {
    return {
      ok: false,
      summary: `Connect Lite guard: ${kind}:${id} 未启用或未信任，已拒绝执行。请先 validate/enable/doctor。`,
    };
  }
  if (!item.lifecycle.discovered || !item.lifecycle.registered || !item.lifecycle.schemaLoaded) {
    return {
      ok: false,
      summary: `Connect Lite guard: ${kind}:${id} 尚未完成 discover/register/schema load，已拒绝执行。请先 validate/doctor。`,
    };
  }
  if (item.lifecycle.runtimeVersion !== "compatible") {
    return {
      ok: false,
      summary: `Connect Lite guard: ${kind}:${id} runtimeVersion=${item.lifecycle.runtimeVersion} 不兼容，已拒绝执行。请 update 或 disable。`,
    };
  }
  if (kind === "skills") {
    const skill = item as SkillSummary;
    if (!skill.triggers.includes(contribution)) {
      return {
        ok: false,
        summary: `Connect Lite guard: skill:${id} 未注册触发项 ${contribution}，已拒绝盲执行。`,
      };
    }
    return { ok: true };
  }
  const plugin = item as PluginSummary;
  const contributions = Object.values(plugin.contributions).flat();
  if (!contributions.includes(contribution)) {
    return {
      ok: false,
      summary: `Connect Lite guard: plugin:${id} 未注册贡献项 ${contribution}，已拒绝盲执行。`,
    };
  }
  return { ok: true };
}

async function handleSkillsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action) {
    writeLine(output, formatSkills(context));
    return;
  }
  if (action === "status") {
    writeLine(output, formatExtensionStatus("skills", context));
    return;
  }
  if (action === "doctor") {
    writeLine(output, validateExtensionItems("skills", context));
    return;
  }
  if (action === "add" || action === "install") {
    const request = parseExtensionInstallRequest(args.slice(1));
    if (!request) {
      writeLine(
        output,
        [
          "Skills install（Connect Lite）",
          `- project: ${context.skills.projectDir}`,
          `- user: ${context.skills.userDir}`,
          "- usage: /skills install local <path> [--scope project|user]",
          "- usage: /skills install git <url> [--ref <ref>] --confirm-network",
          "- usage: /skills install github <owner/repo> [--ref <ref>] --confirm-network",
          "- install 前只读取 manifest / SKILL.md / metadata；不执行第三方代码。",
        ].join("\n"),
      );
      return;
    }
    if (request.source !== "local" && !request.confirmNetwork) {
      writeLine(output, formatExtensionInstallGate("skills", request, "/skills install"));
      return;
    }
    const result = await installExtensionFromRequest("skills", request, context);
    context.skills = await createSkillState(context.config, context.projectPath);
    refreshCacheFreshness(context);
    writeLine(output, result.summary);
    return;
  }
  if (action === "validate") {
    writeLine(output, validateExtensionItems("skills", context, args[1]));
    return;
  }
  if (action === "evolve") {
    const summary = args.slice(1).join(" ").trim();
    if (!summary) {
      writeLine(
        output,
        [
          "Skill evolution candidates（不会自动启用）",
          "- autoEnable=no; writesFiles=no; trustChanges=no",
          `- candidates: ${context.skills.evolutionCandidates.length}`,
          ...context.skills.evolutionCandidates.map(
            (item) =>
              `  - ${item.id}: risk=${item.risk} trigger=${item.triggerCondition} suggestedPath=${item.suggestedPath} summary=${item.summary}`,
          ),
          "- usage: /skills evolve candidate <summary> | /skills evolve reject <id>",
        ].join("\n"),
      );
      return;
    }
    if (args[1] === "reject") {
      const id = args[2];
      const candidate = context.skills.evolutionCandidates.find((item) => item.id === id);
      if (!candidate) {
        writeLine(output, "未找到 skill evolution candidate。用法：/skills evolve reject <id>");
        return;
      }
      context.skills.evolutionCandidates = context.skills.evolutionCandidates.filter(
        (item) => item.id !== id,
      );
      context.skills.rejectedEvolutionCandidates.unshift({ ...candidate, status: "rejected" });
      const sessionId = await ensureSession(context);
      await appendSystemEvent(
        context,
        sessionId,
        `skill_evolution action=rejected id=${candidate.id} source=${candidate.source}`,
        "info",
      );
      writeLine(output, `已拒绝 skill evolution candidate：${id}；不会生成或启用 skill。`);
      return;
    }
    if (args[1] !== "candidate") {
      writeLine(
        output,
        "用法：/skills evolve | /skills evolve candidate <summary> | /skills evolve reject <id>。不会自动写文件、安装、信任或启用。",
      );
      return;
    }
    const candidateSummary = args.slice(2).join(" ").trim();
    if (!candidateSummary) {
      writeLine(output, "用法：/skills evolve candidate <summary>");
      return;
    }
    const candidate = createSkillEvolutionCandidate(
      candidateSummary,
      "manual /skills evolve candidate",
    );
    context.skills.evolutionCandidates.unshift(candidate);
    const sessionId = await ensureSession(context);
    await appendSystemEvent(
      context,
      sessionId,
      `skill_evolution action=candidate id=${candidate.id} source=${candidate.source}`,
      "info",
    );
    writeLine(
      output,
      `已创建 skill evolution candidate：${candidate.id}；不会自动写文件、安装、信任或启用。建议路径：${candidate.suggestedPath}`,
    );
    return;
  }
  if (action === "remove") {
    const id = args[1];
    writeLine(
      output,
      id ? await removeExtension("skills", id, context) : "用法：/skills remove <id>",
    );
    return;
  }
  if (action === "update") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await updateExtension("skills", id, context, args.slice(2))
        : "用法：/skills update <id> [--ref <ref>] [--confirm-network]",
    );
    return;
  }
  if (action === "enable" || action === "disable") {
    const id = args[1];
    if (!id) {
      writeLine(output, `用法：/skills ${action} <id>`);
      return;
    }
    const skill = context.skills.skills.find((item) => item.id === id);
    if (action === "enable") {
      if (!skill) {
        writeLine(output, `未知 skill：${id}。请先在本地 manifest 注册后再启用。`);
        return;
      }
      if (skill.lastError) {
        writeLine(output, `skill manifest 加载失败，不能启用：${id}。请先修复 manifest。`);
        return;
      }
      writeLine(output, formatTrustNotice("skill", skill));
    }
    context.config = await saveExtensionEnablement(
      "skills",
      id,
      action === "enable",
      context.projectPath,
    );
    context.skills = await createSkillState(context.config, context.projectPath);
    writeLine(
      output,
      `${action === "enable" ? "已启用" : "已禁用"} skill：${id}（状态写入 .linghun/settings.json，重启后保留）`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/skills | /skills status|doctor|validate [id] | /skills install local|git|github ... | /skills enable|disable <id> | /skills remove <id> | /skills update <id>",
  );
}

async function handleWorkflowsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const name = args[0];
  if (!name) {
    writeLine(output, formatWorkflows(context));
    return;
  }
  const template = context.workflows.templates.find((item) => item.id === name);
  if (!template) {
    writeLine(output, `未知 workflow：${name}。可运行 /workflows 查看可用模板。`);
    return;
  }
  context.workflows.lastStarted = template.id;
  writeLine(
    output,
    [
      `Workflow Start Gate：${template.id}`,
      `- purpose: ${template.purpose}`,
      `- risk: ${template.risk}`,
      `- writesFiles: ${template.writesFiles ? "yes" : "no"}`,
      "- 启动前需要用户明确确认；本命令只展示启动门，不会自动改文件。",
      "- 后续写文件、Bash、联网、安装依赖仍走现有权限管道。",
      `- recommended validation: ${template.recommendedValidation.join(" && ")}`,
      "- finish check: 输出修改文件、验证结果、已知限制、交付检查与是否越界。",
    ].join("\n"),
  );
}

async function handlePluginsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action) {
    writeLine(output, formatPlugins(context));
    return;
  }
  if (action === "status") {
    writeLine(output, formatExtensionStatus("plugins", context));
    return;
  }
  if (action === "doctor") {
    writeLine(output, formatPluginsDoctor(context));
    return;
  }
  if (action === "add" || action === "install") {
    const request = parseExtensionInstallRequest(args.slice(1));
    if (!request) {
      writeLine(
        output,
        [
          "Plugins install（Connect Lite）",
          `- project: ${context.plugins.projectDir}`,
          `- user: ${context.plugins.userDir}`,
          "- usage: /plugins install local <path> [--scope project|user]",
          "- usage: /plugins install git <url> [--ref <ref>] --confirm-network",
          "- usage: /plugins install github <owner/repo> [--ref <ref>] --confirm-network",
          "- install 前只读取 manifest / metadata；不执行仓库脚本、postinstall、hook 或第三方代码。",
        ].join("\n"),
      );
      return;
    }
    if (request.source !== "local" && !request.confirmNetwork) {
      writeLine(output, formatExtensionInstallGate("plugins", request, "/plugins install"));
      return;
    }
    const result = await installExtensionFromRequest("plugins", request, context);
    context.plugins = await createPluginState(context.config, context.projectPath);
    context.hooks = await createHookState(context.config, context.projectPath);
    refreshCacheFreshness(context);
    writeLine(output, result.summary);
    return;
  }
  if (action === "validate") {
    writeLine(output, validateExtensionItems("plugins", context, args[1]));
    return;
  }
  if (action === "remove") {
    const id = args[1];
    writeLine(
      output,
      id ? await removeExtension("plugins", id, context) : "用法：/plugins remove <id>",
    );
    return;
  }
  if (action === "update") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await updateExtension("plugins", id, context, args.slice(2))
        : "用法：/plugins update <id> [--ref <ref>] [--confirm-network]",
    );
    return;
  }
  if (action === "enable" || action === "disable") {
    const id = args[1];
    if (!id) {
      writeLine(output, `用法：/plugins ${action} <id>`);
      return;
    }
    const plugin = context.plugins.plugins.find((item) => item.id === id);
    if (action === "enable") {
      if (!plugin) {
        writeLine(output, `未知 plugin：${id}。请先在本地 manifest 注册后再启用。`);
        return;
      }
      writeLine(output, formatTrustNotice("plugin", plugin));
    }
    context.config = await saveExtensionEnablement(
      "plugins",
      id,
      action === "enable",
      context.projectPath,
    );
    context.plugins = await createPluginState(context.config, context.projectPath);
    context.hooks = await createHookState(context.config, context.projectPath);
    writeLine(
      output,
      `${action === "enable" ? "已启用" : "已禁用"} plugin：${id}（状态写入 .linghun/settings.json，重启后保留）`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/plugins | /plugins status|doctor|validate [id] | /plugins install local|git|github ... | /plugins enable|disable <id> | /plugins remove <id> | /plugins update <id>",
  );
}

async function handleDoctorCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "readiness";
  if (action === "hooks") {
    writeLine(output, formatHooksDoctor(context));
    return;
  }
  if (action === "runner") {
    writeLine(
      output,
      formatRunnerDoctor(
        resolveNativeRunner(context.config),
        context.config.nativeRunner.expectedProtocol,
        sanitizeDiagnosticText,
      ),
    );
    return;
  }
  if (["all", "details", "checklist", "project", "report"].includes(action)) {
    writeLine(
      output,
      formatTerminalReadinessDoctor(createTerminalReadinessView(context), { showAll: true }),
    );
    return;
  }
  if (["readiness", "status"].includes(action)) {
    writeLine(output, formatTerminalReadinessDoctor(createTerminalReadinessView(context)));
    return;
  }
  writeLine(
    output,
    context.language === "en-US"
      ? "Usage: /doctor [readiness|status|checklist|project|report|hooks|runner]"
      : "用法：/doctor [readiness|status|checklist|project|report|hooks|runner]",
  );
}

// ---------------------------------------------------------------------------
// Runner runtime — thin wrappers delegating to runner-runtime.ts
// ---------------------------------------------------------------------------

function toRunnerContext(context: TuiContext): RunnerContext {
  return { config: context.config, projectPath: context.projectPath };
}

function getRunnerRuntimeDeps(): RunnerRuntimeDeps {
  return { appendJobLog, rescheduleDurableJobAgents };
}

async function startRunnerForDurableJob(context: TuiContext, job: DurableJobState): Promise<void> {
  await startRunnerForDurableJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

function refreshRunnerStatusForJob(context: TuiContext, job: DurableJobState): void {
  refreshRunnerStatusForJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

async function stopRunnerForDurableJob(context: TuiContext, job: DurableJobState): Promise<void> {
  await stopRunnerForDurableJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

async function handleModelCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action === "route") {
    await handleModelRouteCommand(args.slice(1), context, output);
    return;
  }
  if (action === "setup") {
    await startModelSetup(context, output);
    return;
  }
  if (action === "doctor") {
    writeLine(output, await formatModelRouteDoctor({ ...context, deferredToolsSummary: snapshotDeferredToolsSummary(context), discoveredDeferredToolsSummary: snapshotDiscoveredDeferredToolsSummary(context) }));
    return;
  }
  const runtime = getSelectedModelRuntime(context);
  writeLine(
    output,
    `${t(context, "currentModel")}：role=${runtime.role} provider=${runtime.provider} model=${runtime.model} reasoning=${runtime.reasoningStatus}`,
  );
  if (context.config.defaultModel && context.config.defaultModel !== runtime.model) {
    writeLine(
      output,
      `说明：defaultModel=${context.config.defaultModel}，普通开发请求按 executor route=${runtime.provider}/${runtime.model} 执行。`,
    );
  }
  writeLine(output, formatModelRouteSummary(context.config));
  writeLine(output, "提示：如需诊断配置，可运行 /model doctor 或 /model route doctor。");
  // Task-mode denoise: previously this called writeStatus(output, context),
  // which emits the full `[Linghun] 会话 … 模型 … 模式 … 缓存 … 索引 … 确认
  // … 后台 …` line and is the dominant noise source above the composer.
  // /model already prints role / provider / model / reasoning above; the
  // remaining signals users need (permission mode + index) live in the
  // TaskFooter beneath the composer. We omit the status echo here entirely.
}

async function startModelSetup(
  context: TuiContext,
  output: Writable,
  prefill: ModelSetupPrefill = {},
): Promise<void> {
  const existed = await providerEnvExists();
  const providerEnvPath = existed ? getProviderEnvPath() : await ensureProviderEnvTemplate();
  const values: Partial<ProviderEnvSetup> = { reasoningLevel: "Medium", ...prefill };
  context.pendingModelSetup = {
    step: getNextModelSetupStep(values),
    providerEnvPath,
    createdTemplate: !existed,
    values,
  };
  writeLine(output, formatModelSetupMessage("intro", context.language, context.pendingModelSetup));
  if (context.pendingModelSetup.step === "confirm") {
    writeLine(output, formatModelSetupSummary(context.pendingModelSetup, context.language));
    return;
  }
  writeLine(output, getModelSetupPromptMessage(context.pendingModelSetup, context.language));
}

async function handleModelSetupInput(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const setup = context.pendingModelSetup;
  if (!setup) return;
  const trimmed = text.trim();
  const value = setup.step === "apiKey" ? text : trimmed;
  if (/^(cancel|no|n|取消|否)$/iu.test(trimmed)) {
    context.pendingModelSetup = undefined;
    writeLine(output, formatModelSetupMessage("cancelled", context.language, setup));
    return;
  }
  if (/^(details|detail|详情)$/iu.test(trimmed)) {
    writeLine(output, formatModelSetupMessage("details", context.language, setup));
    writeLine(output, getModelSetupPromptMessage(setup, context.language));
    return;
  }

  try {
    const parsed = parseModelSetupPrefill(text);
    if (Object.keys(parsed).length > 0) {
      applyModelSetupValues(setup, parsed);
      setup.step = getNextModelSetupStep(setup.values);
      if (setup.step === "confirm") {
        writeLine(output, formatModelSetupSummary(setup, context.language));
        return;
      }
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }

    if (setup.step === "baseUrl") {
      applyModelSetupValues(setup, { baseUrl: value });
      setup.step = "apiKey";
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }
    if (setup.step === "apiKey") {
      applyModelSetupValues(setup, { apiKey: value });
      setup.step = "model";
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }
    if (setup.step === "model") {
      applyModelSetupValues(setup, { model: value });
      setup.step = "reasoning";
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }
    if (setup.step === "reasoning") {
      applyModelSetupValues(setup, {
        reasoningLevel: normalizeModelSetupReasoningLevel(value || "Medium"),
      });
      setup.step = "auxModel";
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }
    if (setup.step === "auxModel") {
      applyModelSetupValues(setup, { auxModel: value || undefined });
      setup.step = "confirm";
      writeLine(output, formatModelSetupSummary(setup, context.language));
      return;
    }
    if (setup.step === "confirm") {
      if (/^(yes|y|save|ok|confirm|确认|保存|是)$/iu.test(value)) {
        const savedPath = await saveProviderEnvSetup(setup.values as ProviderEnvSetup);
        context.pendingModelSetup = undefined;
        context.config = await loadConfig(context.projectPath);
        context.model = resolveInitialModel(context.config);
        writeLine(output, formatModelSetupSaved(savedPath, context.language));
        return;
      }
      context.pendingModelSetup = undefined;
      writeLine(output, formatModelSetupMessage("cancelled", context.language, setup));
      return;
    }
  } catch (error) {
    writeLine(
      output,
      error instanceof Error ? error.message : formatModelSetupFallbackError(context.language),
    );
    writeLine(output, getModelSetupPromptMessage(setup, context.language));
  }
}

async function handleModelRouteCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action) {
    writeLine(output, formatModelRoutes(context.config));
    return;
  }
  if (action === "doctor") {
    writeLine(output, await formatModelRouteDoctor({ ...context, deferredToolsSummary: snapshotDeferredToolsSummary(context), discoveredDeferredToolsSummary: snapshotDiscoveredDeferredToolsSummary(context) }));
    return;
  }
  if (action === "set") {
    const role = args[1] as ModelRole | undefined;
    const model = args[2];
    if (!role || !isModelRole(role) || !model) {
      writeLine(
        output,
        "用法：/model route set <planner|executor|reviewer|verifier|summarizer|vision|image> <model>",
      );
      return;
    }
    context.config = await saveModelRoute(role, model, context.projectPath);
    const route = getRoleRoute(context.config, role);
    if (role === "executor") {
      context.model = route.primaryModel || context.model;
    }
    writeLine(
      output,
      `已设置 ${role} role：provider=${route.provider || "未配置"} model=${route.primaryModel || "未配置"}`,
    );
    if (role === "executor" && context.config.defaultModel !== route.primaryModel) {
      writeLine(
        output,
        `说明：defaultModel=${context.config.defaultModel}，普通开发请求将按 executor route=${route.provider}/${route.primaryModel} 执行。`,
      );
    }
    if (role === "vision") {
      writeLine(output, "vision role 只输出 VisionObservation evidence，不写代码、不执行 Bash。");
    }
    if (role === "image") {
      writeLine(output, "image role 只生成本地资产路径和 evidence，不改代码、不执行 Bash。");
    }
    return;
  }
  writeLine(output, "用法：/model route | /model route doctor | /model route set <role> <model>");
}

// Module 6 — shouldOfferUserScopedModelSetup / getStartupProjectRouteProblem /
// readProjectExecutorRouteOverride / getProjectModelRouteProblem /
// getProjectModelRouteProblemForRoute / hasSelectedProviderConfigProblem /
// getRuntimeStatusProvider / getActiveEndpointProfileLabel / resolveInitialModel /
// getSelectedModelRuntime / formatReasoningEffectiveState / resolveProviderForModel /
// createModelGateway / resolveRoleRoute / createRouteRepairSuggestions /
// formatRoutePauseMessage 已移至 ./tui-model-runtime.ts。
export type { SelectedModelRuntime } from "./tui-model-runtime.js";
export {
  createModelGateway,
  createRouteRepairSuggestions,
  formatReasoningEffectiveState,
  formatRoutePauseMessage,
  getActiveEndpointProfileLabel,
  getProjectModelRouteProblem,
  getProjectModelRouteProblemForRoute,
  getRuntimeStatusProvider,
  getSelectedModelRuntime,
  getStartupProjectRouteProblem,
  hasSelectedProviderConfigProblem,
  readProjectExecutorRouteOverride,
  resolveInitialModel,
  resolveProviderForModel,
  resolveRoleRoute,
  shouldOfferUserScopedModelSetup,
} from "./tui-model-runtime.js";

import {
  createModelGateway,
  formatReasoningEffectiveState,
  formatRoutePauseMessage,
  getActiveEndpointProfileLabel,
  getRuntimeStatusProvider,
  getSelectedModelRuntime,
  getStartupProjectRouteProblem,
  hasSelectedProviderConfigProblem,
  resolveInitialModel,
  resolveRoleRoute,
  shouldOfferUserScopedModelSetup,
} from "./tui-model-runtime.js";
import type { SelectedModelRuntime } from "./tui-model-runtime.js";

function writeWorkspaceTrustStartupNotice(output: Writable, context: TuiContext): void {
  const level = context.config.workspaceTrust.level;
  if (!context.config.workspaceTrust.recorded) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Workspace trust is not recorded. Non-interactive input skips the trust prompt; use an interactive start to confirm this workspace. Start Gate, Plan approval, and the permission pipeline still apply."
        : "工作区信任尚未记录。非交互输入不会弹出 trust 确认；请用交互式启动确认此工作区。Start Gate、Plan approval 和权限管道仍会生效。",
    );
    return;
  }
  if (level === "trusted") {
    return;
  }
  context.workspaceTrustEnforced = true;
  writeLine(
    output,
    context.language === "en-US"
      ? `Workspace trust: ${level}. Read-only status and safe diagnostics are allowed; writes, Bash, extensions, remote channels, and long jobs stay blocked until you confirm trust or keep /trust restricted.`
      : `工作区信任：${level}。只读状态和安全诊断可用；写文件、Bash、插件/skills/hooks、远程通道和长任务会受限。可确认信任，或用 /trust restricted 保持受限。`,
  );
}

async function shouldPromptForInitialLanguage(
  input: Readable,
  context: TuiContext,
): Promise<boolean> {
  return (
    (input as { isTTY?: boolean }).isTTY === true &&
    !(await hasRecordedUserLanguage()) &&
    !(await hasRecordedProjectLanguage(context.projectPath))
  );
}

async function promptInitialLanguage(
  input: Readable,
  output: Writable,
  context: TuiContext,
): Promise<void> {
  // D13E-P3 first-run language UI: bordered arrow-select panel that mirrors
  // the workspace-trust prompt rhythm. ↑↓ / jk navigate, Enter confirms,
  // Esc accepts the default (中文). The text-input fallback (1/2/zh/en/中文/
  // English) is preserved by readInitialLanguageDecision so non-keypress
  // terminals still work.
  const lines = [
    "",
    "┌─ 选择输出语言 / Choose output language ─────────────────────",
    "│",
    "│  ↑/↓ 或 j/k 切换 · Enter 确认 · Esc 默认中文",
    "│  Type 1/2/zh/en/中文/English to choose by keyboard.",
    "│",
    "└─────────────────────────────────────────────────────────────",
    "",
  ];
  writeLine(output, lines.join("\n"));
  const language = await readInitialLanguageDecision(input, output);
  await saveUserLanguage(language);
  context.config = { ...context.config, language };
  context.language = language;
  writeLine(output, t(context, language === "zh-CN" ? "languageSwitchedZh" : "languageSwitchedEn"));
}

async function readInitialLanguageDecision(input: Readable, output: Writable): Promise<Language> {
  if ("setEncoding" in input && typeof input.setEncoding === "function") {
    input.setEncoding("utf8");
  }
  const rl = createInterface({ input, output });
  const rawInput = input as Readable & { setRawMode?: (enabled: boolean) => void; isRaw?: boolean };
  const wasRaw = rawInput.isRaw === true;
  let settled = false;
  let selectedIndex = 0; // 0 = zh-CN (default), 1 = en-US
  const renderChoices = (): void => {
    const cursor = (active: boolean) => (active ? "❯" : " ");
    const choiceLines = [
      `  ${cursor(selectedIndex === 0)} [${selectedIndex === 0 ? "x" : " "}] 中文 (zh-CN)`,
      `  ${cursor(selectedIndex === 1)} [${selectedIndex === 1 ? "x" : " "}] English (en-US)`,
    ];
    output.write(choiceLines.join("\n") + "\n");
  };
  return await new Promise<Language>((resolveDecision) => {
    const finish = (language: Language) => {
      if (settled) return;
      settled = true;
      input.off("keypress", onKeypress);
      rl.off("line", onLine);
      if (typeof rawInput.setRawMode === "function" && !wasRaw) {
        rawInput.setRawMode(false);
      }
      rl.close();
      resolveDecision(language);
    };
    const onKeypress = (str: string, key: { name?: string } = {}) => {
      const name = key.name;
      if (name === "escape") {
        finish("zh-CN");
        return;
      }
      if (name === "up" || name === "k") {
        if (selectedIndex !== 0) {
          selectedIndex = 0;
          renderChoices();
        }
        return;
      }
      if (name === "down" || name === "j") {
        if (selectedIndex !== 1) {
          selectedIndex = 1;
          renderChoices();
        }
        return;
      }
      // Enter handled by readline 'line' event; ignore other raw input here.
      void str;
    };
    const onLine = (line: string) => {
      const normalized = line.trim().toLowerCase();
      if (normalized === "") {
        finish(selectedIndex === 0 ? "zh-CN" : "en-US");
        return;
      }
      if (/^(1|zh|zh-cn|中文|chinese|cn)$/iu.test(normalized)) {
        finish("zh-CN");
        return;
      }
      if (/^(2|en|en-us|english|英文)$/iu.test(normalized)) {
        finish("en-US");
        return;
      }
      writeLine(output, "请输入 1/中文 或 2/English。Type 1/中文 or 2/English.");
      renderChoices();
    };
    emitKeypressEvents(input);
    input.on("keypress", onKeypress);
    rl.on("line", onLine);
    if (typeof rawInput.setRawMode === "function") {
      rawInput.setRawMode(true);
    }
    renderChoices();
    output.write("> ");
  });
}

function shouldPromptForInitialWorkspaceTrust(input: Readable, context: TuiContext): boolean {
  return (input as { isTTY?: boolean }).isTTY === true && !context.config.workspaceTrust.recorded;
}

async function promptInitialWorkspaceTrust(
  input: Readable,
  output: Writable,
  context: TuiContext,
): Promise<void> {
  const project = context.projectPath;
  const isEnglish = context.language === "en-US";
  const lines = isEnglish
    ? [
        "",
        "┌─ Workspace trust ───────────────────────────────────────────",
        `│  ${project}`,
        "│",
        "│  Do you trust this project?",
        "│  Trusted allows reads/writes/commands; approvals still apply.",
        "│",
        "│  ↑/↓ or j/k to switch · Enter to confirm · Esc keep restricted",
        "└─────────────────────────────────────────────────────────────",
        "",
      ]
    : [
        "",
        "┌─ 工作区信任 ────────────────────────────────────────────────",
        `│  ${project}`,
        "│",
        "│  是否信任这个项目？",
        "│  信任后可读写和运行命令；安全审批仍生效。",
        "│",
        "│  ↑/↓ 或 j/k 切换 · Enter 确认 · Esc 保持受限",
        "└─────────────────────────────────────────────────────────────",
        "",
      ];
  writeLine(output, lines.join("\n"));
  const trusted = await readInitialWorkspaceTrustDecision(input, output, isEnglish);
  context.config = await saveWorkspaceTrust(
    trusted ? "trusted" : "restricted",
    context.projectPath,
  );
  context.workspaceTrustEnforced = !trusted;
  writeLine(output, formatWorkspaceTrustStatus(context));
}

async function readInitialWorkspaceTrustDecision(
  input: Readable,
  output: Writable,
  isEnglish = false,
): Promise<boolean> {
  if ("setEncoding" in input && typeof input.setEncoding === "function") {
    input.setEncoding("utf8");
  }
  const rl = createInterface({ input, output });
  const rawInput = input as Readable & { setRawMode?: (enabled: boolean) => void; isRaw?: boolean };
  const wasRaw = rawInput.isRaw === true;
  let settled = false;
  let selectedIndex = 0; // 0 = trust, 1 = restricted
  const renderChoices = (): void => {
    const trustLabel = isEnglish ? "Trust this project (yes)" : "信任此项目 (yes)";
    const restrictedLabel = isEnglish ? "Keep restricted (no)" : "保持 restricted (no)";
    const cursor = (active: boolean) => (active ? "❯" : " ");
    const lines = [
      `  ${cursor(selectedIndex === 0)} [${selectedIndex === 0 ? "x" : " "}] ${trustLabel}`,
      `  ${cursor(selectedIndex === 1)} [${selectedIndex === 1 ? "x" : " "}] ${restrictedLabel}`,
    ];
    output.write(lines.join("\n") + "\n");
  };
  return await new Promise<boolean>((resolveDecision) => {
    const finish = (trusted: boolean) => {
      if (settled) return;
      settled = true;
      input.off("keypress", onKeypress);
      rl.off("line", onLine);
      if (typeof rawInput.setRawMode === "function" && !wasRaw) {
        rawInput.setRawMode(false);
      }
      rl.close();
      resolveDecision(trusted);
    };
    const onKeypress = (str: string, key: { name?: string } = {}) => {
      const name = key.name;
      if (name === "escape") {
        finish(false);
        return;
      }
      if (name === "up" || name === "k") {
        if (selectedIndex !== 0) {
          selectedIndex = 0;
          renderChoices();
        }
        return;
      }
      if (name === "down" || name === "j") {
        if (selectedIndex !== 1) {
          selectedIndex = 1;
          renderChoices();
        }
        return;
      }
      if (name === "y") {
        finish(true);
        return;
      }
      if (name === "n") {
        finish(false);
        return;
      }
      // Enter 由 readline 'line' 事件处理；此处忽略其他原始输入。
      void str;
    };
    const onLine = (line: string) => {
      const normalized = line.trim().toLowerCase();
      if (normalized === "") {
        finish(selectedIndex === 0);
        return;
      }
      if (
        /^(yes|y|confirm|ok|okay|trust|trusted|确认|是|信任)$/iu.test(normalized)
      ) {
        finish(true);
        return;
      }
      if (
        /^(no|n|cancel|restricted|restrict|untrust|untrusted|取消|否|不|受限)$/iu.test(normalized)
      ) {
        finish(false);
        return;
      }
      writeLine(
        output,
        isEnglish
          ? "Use ↑/↓ to switch, Enter to confirm; or type yes/no."
          : "请用 ↑/↓ 切换，Enter 确认；或输入 yes/no。",
      );
      renderChoices();
    };
    emitKeypressEvents(input);
    input.on("keypress", onKeypress);
    rl.on("line", onLine);
    if (typeof rawInput.setRawMode === "function") {
      rawInput.setRawMode(true);
    }
    renderChoices();
    output.write("> ");
  });
}

function getWorkspaceTrustCommandGuard(
  command: string,
  args: string[],
  context: TuiContext,
): string | null {
  const level = getEffectiveWorkspaceTrustLevel(context);
  if (!context.workspaceTrustEnforced || level === "trusted") {
    return null;
  }
  if (!isWorkspaceTrustRestrictedCommand(command, args)) {
    return null;
  }
  return context.language === "en-US"
    ? `Workspace is ${level}. I did not run ${command}. Read-only status is still available; confirm trust interactively or use /trust as an advanced fallback to persist trust in .linghun/settings.json.`
    : `当前工作区为 ${level}，已拦截 ${command}。只读状态仍可用；可用交互式 trust 确认，或将 /trust 作为高级 fallback 写入 .linghun/settings.json。`;
}

function isWorkspaceTrustRestrictedCommand(command: string, args: string[]): boolean {
  if (["/write", "/edit", "/multiedit", "/bash"].includes(command)) return true;
  if (command === "/job") return ["run", "create", "new", "resume"].includes(args[0] ?? "list");
  if (command === "/autopilot") return !["status", "details", "cancel"].includes(args[0] ?? "");
  if (command === "/remote") return !["", "status", "doctor", "list"].includes(args[0] ?? "");
  if (command === "/index") return ["init", "refresh", "repair"].includes(args[0] ?? "");
  if (command === "/mcp")
    return ["add", "enable", "disable", "remove", "update"].includes(args[0] ?? "");
  if (command === "/skills" || command === "/plugins") {
    return ["install", "enable", "disable", "remove", "update", "evolve"].includes(args[0] ?? "");
  }
  if (command === "/workflows") return ["run", "enable", "disable"].includes(args[0] ?? "");
  return false;
}

async function handleTrustCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    writeLine(output, formatWorkspaceTrustStatus(context));
    return;
  }
  const level = parseWorkspaceTrustAction(action);
  if (!level) {
    writeLine(output, "用法：/trust status | /trust trust | /trust restricted | /trust untrust");
    return;
  }
  context.config = await saveWorkspaceTrust(level, context.projectPath);
  context.workspaceTrustEnforced = level !== "trusted";
  writeLine(output, formatWorkspaceTrustStatus(context));
  writeStatus(output, context);
}

function parseWorkspaceTrustAction(action: string): WorkspaceTrustLevel | null {
  if (action === "trust" || action === "trusted") return "trusted";
  if (action === "restricted" || action === "restrict") return "restricted";
  if (action === "untrust" || action === "untrusted") return "untrusted";
  return null;
}

function getEffectiveWorkspaceTrustLevel(context: TuiContext): WorkspaceTrustLevel {
  return context.config.workspaceTrust.recorded
    ? context.config.workspaceTrust.level
    : "restricted";
}

function formatWorkspaceTrustStatus(context: TuiContext): string {
  const level = getEffectiveWorkspaceTrustLevel(context);
  const recorded = context.config.workspaceTrust.recorded ? "yes" : "no";
  const path =
    relative(context.projectPath, getProjectSettingsPath(context.projectPath)) ||
    ".linghun/settings.json";
  return context.language === "en-US"
    ? [
        `Workspace trust: ${level}`,
        `- recorded: ${recorded}`,
        `- persists in: ${path}`,
        "- trusted: quiet startup; normal permission pipeline still applies.",
        "- restricted/untrusted: read-only status and safe diagnostics remain; writes, Bash, extension enablement, remote channels, and long jobs are blocked or require trust first.",
      ].join("\n")
    : [
        `工作区信任：${level}`,
        `- 已记录：${recorded}`,
        `- 持久化位置：${path}`,
        "- trusted：启动时安静；仍保留权限管道。",
        "- restricted/untrusted：只读状态和安全诊断可用；写文件、Bash、插件/skills/hooks 启用、远程通道和长任务会先受限。",
      ].join("\n");
}

function formatPendingApprovalDetails(approval: PendingLocalApproval, context: TuiContext): string {
  if (approval.kind === "index_ignore_write") {
    return context.language === "en-US"
      ? [
          "Pending permission details",
          "- action: update index ignore file, then refresh the index",
          `- file: ${approval.plan.path}`,
          `- entries: ${approval.plan.missingEntries.length}`,
          "- raw content, tokens, request ids, and internal gate ids are hidden.",
          "- next: yes/confirm to allow once; no/cancel/Esc to deny.",
        ].join("\n")
      : [
          "待确认权限详情",
          "- 动作：更新索引 ignore 文件，然后刷新索引",
          `- 文件：${approval.plan.path}`,
          `- 条目数量：${approval.plan.missingEntries.length}`,
          "- raw content、token、request id 和内部 gate id 已隐藏。",
          "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。",
        ].join("\n");
  }
  if (approval.kind === "architecture_drift") {
    const warnings = approval.warnings.map((item) => truncateDisplay(item, 120)).join("；") || "-";
    return context.language === "en-US"
      ? [
          "Pending permission details",
          `- tool: ${approval.toolName}`,
          `- reason: agreed scope would change (${warnings})`,
          "- tool input, tokens, request ids, and internal gate ids are hidden.",
          "- next: yes/confirm to allow once; no/cancel/Esc to deny.",
        ].join("\n")
      : [
          "待确认权限详情",
          `- 工具：${approval.toolName}`,
          `- 原因：会改变已约定范围（${warnings}）`,
          "- tool input、token、request id 和内部 gate id 已隐藏。",
          "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。",
        ].join("\n");
  }
  return context.language === "en-US"
    ? [
        "Pending permission details",
        `- tool: ${approval.toolName}`,
        "- reason: protected tool requires approval before running",
        "- tool input, tokens, request ids, and internal gate ids are hidden.",
        "- next: yes/confirm to allow once; no/cancel/Esc to deny.",
      ].join("\n")
    : [
        "待确认权限详情",
        `- 工具：${approval.toolName}`,
        "- 原因：受保护工具运行前需要审批",
        "- tool input、token、request id 和内部 gate id 已隐藏。",
        "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。",
      ].join("\n");
}

function formatPendingNaturalCommandDetails(
  gate: PendingNaturalCommand,
  context: TuiContext,
): string {
  if (gate.capabilityId === "trust") {
    return context.language === "en-US"
      ? [
          "Workspace trust details",
          "- If trusted, Linghun can read, edit, and run commands in the current directory.",
          "- Start Gate, Plan approval, and the permission pipeline still apply.",
          "- /trust remains an advanced recovery/status entry, not the normal user path.",
          "- Yes continues to the safe confirmation path; No/Esc cancels.",
        ].join("\n")
      : [
          "工作区信任详情",
          "- 信任后 Linghun 可以在当前目录读、改、运行命令。",
          "- Start Gate、Plan approval 和 permission pipeline 仍然生效。",
          "- /trust 仍是高级恢复/状态入口，不是普通用户主路径。",
          "- Yes 继续进入安全确认路径；No/Esc 取消。",
        ].join("\n");
  }
  return context.language === "en-US"
    ? [
        "Pending Start Gate details",
        `- command: ${gate.exactCommand}`,
        `- risk: ${gate.risk}`,
        `- scope: ${gate.scope}`,
        `- confirmation: ${gate.requiresExactConfirmation ? "exact command required" : "yes/confirm or /enter allowed"}`,
        "- raw schema, keys, tokens, and internal gate ids are hidden.",
        "- next: confirm as shown, or /esc to cancel.",
      ].join("\n")
    : [
        "待确认 Start Gate 详情",
        `- 命令：${gate.exactCommand}`,
        `- 风险：${gate.risk}`,
        `- 范围：${gate.scope}`,
        `- 确认方式：${gate.requiresExactConfirmation ? "需要输入精确命令" : "可用 yes/确认 或 /enter"}`,
        "- raw schema、key、token 和内部 gate id 已隐藏。",
        "- 下一步：按提示确认，或输入 /esc 取消。",
      ].join("\n");
}

export async function handleTuiKeypress(
  key: "escape" | "return" | "shift-tab",
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (key === "escape") {
    await cancelPendingInteraction(context, output, "Esc");
    return;
  }
  if (key === "shift-tab") {
    openModeSwitch(context, output);
    return;
  }
  if (hasPendingEnterConfirmation(context)) {
    await confirmPendingInteraction(context, output);
  }
}

async function cancelPendingInteraction(
  context: TuiContext,
  output: Writable,
  source: string,
): Promise<void> {
  if (context.pendingLocalApproval) {
    const approval = context.pendingLocalApproval;
    context.pendingLocalApproval = undefined;
    if (approval.kind === "index_ignore_write") {
      writeLine(output, "已取消待确认权限；未写入文件，也未刷新索引。可修改请求后重试。");
    } else {
      writeLine(output, "已取消待确认权限；工具尚未执行。可调整请求或继续说明目标。");
    }
    writeStatus(output, context);
    return;
  }
  if (context.pendingNaturalCommand) {
    context.pendingNaturalCommand = undefined;
    writeLine(output, `${source} 已取消待确认动作；没有执行命令。可重新描述目标或输入 /help。`);
    writeStatus(output, context);
    return;
  }
  if (context.pendingAutopilot) {
    context.pendingAutopilot = undefined;
    writeLine(output, "已取消持续推进确认；没有启动 job。可用 /autopilot <目标> 重新设置边界。");
    writeStatus(output, context);
    return;
  }
  if (context.activePlan && !context.planAccepted) {
    context.activePlan = undefined;
    context.planAccepted = false;
    writeLine(output, "已取消待确认计划；没有进入执行。可重新运行 /plan 或继续说明修改意见。");
    writeStatus(output, context);
    return;
  }
  writeLine(
    output,
    "当前没有可取消的等待交互；已执行的工具不会被静默撤销。需要停止长任务请用 /interrupt 或 /job cancel <id>。",
  );
  writeStatus(output, context);
}

function hasPendingEnterConfirmation(context: TuiContext): boolean {
  return Boolean(
    context.pendingLocalApproval ||
      context.pendingNaturalCommand ||
      context.pendingAutopilot ||
      (context.activePlan && !context.planAccepted),
  );
}

async function confirmPendingInteraction(context: TuiContext, output: Writable): Promise<void> {
  if (context.pendingNaturalCommand?.requiresExactConfirmation) {
    writeLine(
      output,
      "该动作需要输入精确 slash command；/enter 不会绕过精确确认。输入 /esc 可取消。",
    );
    writeStatus(output, context);
    return;
  }
  if (context.pendingAutopilot) {
    await startPendingAutopilot(context, output);
    return;
  }
  if (context.pendingLocalApproval) {
    await handleNaturalInput("yes", context, output);
    return;
  }
  if (context.pendingNaturalCommand) {
    await handleNaturalInput("yes", context, output);
    return;
  }
  if (context.activePlan && !context.planAccepted) {
    await handlePlanCommand(
      ["accept", "manual", context.activePlan.options[0]?.id ?? "a"],
      context,
      output,
    );
    return;
  }
  writeLine(output, "当前没有等待确认的显式选择；请提交输入或先发起需要确认的请求。");
  writeStatus(output, context);
}

async function handleAutopilotCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "";
  if (action === "status" || action === "details") {
    writeLine(output, formatPendingAutopilotDetails(context));
    return;
  }
  if (action === "cancel") {
    await cancelPendingInteraction(context, output, "autopilot");
    return;
  }
  if (action === "confirm" || action === "start") {
    await startPendingAutopilot(context, output);
    return;
  }
  const goal = args.join(" ").trim();
  if (!goal) {
    writeLine(
      output,
      "用法：/autopilot <目标> [--steps N] [--tokens N] [--timeout MS] [--allow-edit] [--allow-bash]，确认后用 /autopilot confirm。持续推进不会绕过 Start Gate、权限或 Plan。 ",
    );
    return;
  }
  context.pendingAutopilot = createPendingAutopilotRequest(args);
  writeLine(output, formatPendingAutopilotDetails(context));
  writeStatus(output, context);
}

function createPendingAutopilotRequest(args: string[]): PendingAutopilotRequest {
  const parsed = parseJobRunOptions(args);
  return {
    goal: parsed.goal,
    maxSteps: parsed.maxSteps,
    maxTokens: parsed.maxTokens,
    timeoutMs: parsed.timeoutMs,
    allowEdit: parsed.allowEdit,
    allowBash: parsed.allowBash,
    createdAt: new Date().toISOString(),
  };
}

function formatPendingAutopilotDetails(context: TuiContext): string {
  const pending = context.pendingAutopilot;
  if (!pending) {
    return "当前没有待确认的持续推进。用法：/autopilot <目标> [--steps N] [--tokens N] [--timeout MS]。";
  }
  return [
    "持续推进待确认",
    `- 目标：${truncateDisplay(pending.goal, 100)}`,
    `- 允许范围：durable job + background + runner fallback；allowEdit=${pending.allowEdit ? "yes" : "no"}；allowBash=${pending.allowBash ? "yes" : "no"}`,
    `- 预算：steps<=${pending.maxSteps}；tokens<=${pending.maxTokens}；timeoutMs<=${pending.timeoutMs}`,
    "- 禁止事项：不绕过 Start Gate / permission pipeline / Plan approval；不进入真实 smoke；不把 runner completed 当 verification PASS。",
    "- 控制入口：/autopilot confirm 启动；/esc 或 /autopilot cancel 取消；启动后用 /job pause|resume|cancel <id>。",
    "- 报告入口：启动后查看 /job report <id>、/job logs <id>、/background。",
  ].join("\n");
}

async function startPendingAutopilot(context: TuiContext, output: Writable): Promise<void> {
  const pending = context.pendingAutopilot;
  if (!pending) {
    writeLine(output, "当前没有待确认的持续推进。先运行 /autopilot <目标>。 ");
    return;
  }
  if (context.workspaceTrustEnforced && getEffectiveWorkspaceTrustLevel(context) !== "trusted") {
    writeLine(
      output,
      getWorkspaceTrustCommandGuard("/autopilot", ["confirm"], context) ??
        "当前工作区未信任，未启动持续推进。",
    );
    writeStatus(output, context);
    return;
  }
  context.pendingAutopilot = undefined;
  const args = [
    "run",
    pending.goal,
    "--max-steps",
    String(pending.maxSteps),
    "--tokens",
    String(pending.maxTokens),
    "--timeout",
    String(pending.timeoutMs),
    ...(pending.allowEdit ? ["--allow-edit"] : []),
    ...(pending.allowBash ? ["--allow-bash"] : []),
  ];
  await handleJobCommand(args, context, output);
}

async function handleModeCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const rawMode = args[0] === "set" ? args[1] : args[0];
  if (!rawMode) {
    writeLine(output, t(context, "modeCurrent", { mode: context.permissionMode }));
    writeLine(output, t(context, "modeOptions"));
    writeLine(output, t(context, "modeBoundary"));
    return;
  }
  const nextMode = parsePermissionModeInput(rawMode);
  if (!nextMode) {
    writeLine(output, t(context, "modeUnknown"));
    return;
  }
  const guard = getModeChangeGuard(nextMode, context);
  if (guard) {
    writeLine(output, guard);
    return;
  }
  await setPermissionMode(context, output, nextMode, `mode command -> ${nextMode}`);
}

async function cycleMode(context: TuiContext, output: Writable): Promise<void> {
  const modes: PermissionMode[] = ["default", "auto-review", "plan", "full-access"];
  const index = modes.indexOf(context.permissionMode);
  const nextMode = modes[(index + 1) % modes.length] ?? "default";
  const guard = getModeChangeGuard(nextMode, context);
  if (guard) {
    writeLine(output, guard);
    return;
  }
  await setPermissionMode(context, output, nextMode, "tab mode cycle");
}

function openModeSwitch(context: TuiContext, output: Writable): void {
  writeLine(
    output,
    context.language === "en-US"
      ? [
          "Mode switch",
          `- current: ${context.permissionMode}`,
          "- options: default / auto-review / plan / full-access",
          "- Shift+Tab opens this switch only; it does not enable full-access.",
          "- use /mode <mode> to switch. full-access still requires local opt-in and cannot bypass Start Gate.",
        ].join("\n")
      : [
          "模式切换",
          `- 当前：${context.permissionMode}`,
          "- 可选：default / auto-review / plan / full-access",
          "- Shift+Tab 只打开这个切换提示；不会开启 full-access。",
          "- 用 /mode <mode> 切换。full-access 仍需要本地显式 opt-in，不能绕过 Start Gate。",
        ].join("\n"),
  );
  writeStatus(output, context);
}

function getModeChangeGuard(nextMode: PermissionMode, context: TuiContext): string | null {
  if (context.permissionMode === "plan" && nextMode === "full-access" && !context.planAccepted) {
    return t(context, "modeFullAccessPlanBlocked");
  }
  if (nextMode === "full-access" && process.env.LINGHUN_ENABLE_FULL_ACCESS !== "1") {
    return t(context, "modeFullAccessOptInBlocked");
  }
  return null;
}

async function setPermissionMode(
  context: TuiContext,
  output: Writable,
  nextMode: PermissionMode,
  reason: string,
): Promise<void> {
  const previousMode = context.permissionMode;
  context.permissionMode = nextMode;
  context.planAccepted = false;
  const sessionId = await ensureSession(context);
  await appendSystemEvent(
    context,
    sessionId,
    `permission_mode_change: ${previousMode} -> ${nextMode}; reason=${reason}; boundary=Start Gate and permission pipeline remain active`,
    "info",
  );
  writeLine(output, t(context, "modeSwitched", { mode: nextMode }));
  if (nextMode === "plan") {
    writeLine(output, t(context, "modePlanBoundary"));
  }
  writeStatus(output, context);
}

async function handlePlanCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action === "accept") {
    if (!context.activePlan) {
      writeLine(output, "当前没有待确认计划。先运行 /plan 生成结构化方案。");
      return;
    }
    const boundary = args[1] ?? "manual";
    if (boundary !== "manual" && boundary !== "auto-review") {
      writeLine(
        output,
        "用法：/plan accept manual|auto-review。批准计划不等于授权所有工具；Bash/联网/依赖/权限仍走权限管道。",
      );
      return;
    }
    const optionId = args[2] ?? context.activePlan.options[0]?.id ?? "a";
    context.planAccepted = true;
    context.permissionMode = boundary === "auto-review" ? "auto-review" : "default";
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "plan_decision",
      proposalId: context.activePlan.id,
      optionId,
      decision: "accepted",
      createdAt: new Date().toISOString(),
    });
    await appendSystemEvent(
      context,
      sessionId,
      `plan_approved: proposal=${context.activePlan.id}; option=${optionId}; boundary=${boundary}; note=does not authorize all tools`,
      "info",
    );
    writeLine(
      output,
      `已确认计划 ${context.activePlan.id} / 方案 ${optionId}；边界=${boundary}；当前模式=${context.permissionMode}。写入、Bash、联网、依赖和权限变更仍走权限管道。`,
    );
    writeStatus(output, context);
    return;
  }
  if (action === "reject") {
    if (!context.activePlan) {
      writeLine(output, "当前没有待拒绝计划。先运行 /plan 生成结构化方案。");
      return;
    }
    const feedback = args.slice(1).join(" ") || "no feedback";
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "plan_decision",
      proposalId: context.activePlan.id,
      optionId: context.activePlan.options[0]?.id ?? "a",
      decision: "rejected",
      createdAt: new Date().toISOString(),
    });
    await appendSystemEvent(context, sessionId, `plan_rejected: ${feedback}`, "info");
    context.planAccepted = false;
    writeLine(output, `已拒绝当前计划并保留 plan 模式。反馈：${feedback}`);
    writeStatus(output, context);
    return;
  }

  const proposal: PlanProposal = {
    id: randomUUID(),
    title: "Phase 06 执行前计划",
    options: [
      {
        id: "a",
        title: "最小权限闭环（推荐）",
        steps: [
          "先用 Read/Grep/Glob/Diff 收集证据",
          "确认写入文件和风险摘要",
          "执行工作区内允许的低/中风险改动",
          "运行最小必要验证",
        ],
        risks: ["需要写入时必须离开 plan 或确认计划", "Bash 不会在 auto-review 中自动放行"],
      },
      {
        id: "b",
        title: "只读审查",
        steps: ["保持 plan 模式", "只运行 Read/Grep/Glob/Diff/Todo", "输出建议，不写文件"],
        risks: ["不会完成需要落盘的代码改动"],
      },
    ],
  };
  context.activePlan = proposal;
  context.permissionMode = "plan";
  context.planAccepted = false;
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "plan_proposal",
    proposal,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, formatPlanProposal(proposal));
  writeLine(
    output,
    "确认执行请运行：/plan accept manual a 或 /plan accept auto-review a；拒绝请运行 /plan reject <反馈>。批准计划不授权 Bash/联网/依赖/权限变更。",
  );
  writeStatus(output, context);
}

async function handleLanguageCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const language = args[0] as Language | undefined;
  const scope = args[1];
  if (!language) {
    writeLine(output, `language: ${context.language}`);
    return;
  }
  if (
    (language !== "zh-CN" && language !== "en-US") ||
    (scope && !["project", "--project", "user", "--user"].includes(scope))
  ) {
    writeLine(output, "usage: /language zh-CN|en-US [user|project]");
    return;
  }
  const wantsProjectScope = scope === "project" || scope === "--project";
  const hasProjectOverride = await hasRecordedProjectLanguage(context.projectPath);
  const wantsUserScope = scope === "user" || scope === "--user";
  const shouldSaveProjectLanguage =
    (wantsProjectScope || (hasProjectOverride && !wantsUserScope)) &&
    getEffectiveWorkspaceTrustLevel(context) === "trusted";
  if (shouldSaveProjectLanguage) {
    context.config = await saveProjectLanguage(language, context.projectPath);
  } else {
    if (wantsProjectScope && getEffectiveWorkspaceTrustLevel(context) !== "trusted") {
      writeLine(
        output,
        context.language === "en-US"
          ? "Project language scope requires trusted workspace; saved user language preference instead."
          : "项目级语言覆盖需要已信任工作区；已改为保存用户级语言偏好。",
      );
    }
    await saveUserLanguage(language);
    context.config = { ...context.config, language };
  }
  context.language = language;
  writeLine(output, t(context, language === "zh-CN" ? "languageSwitchedZh" : "languageSwitchedEn"));
  writeStatus(output, context);
}

// ---------------------------------------------------------------------------
// D.13E Step 2 — permission helpers（修正 #3 + #4）
// ---------------------------------------------------------------------------
// Module 3 (permission-runtime) — addAllowRule、decidePermission、
// recordPermissionDenied、loadPermissionState、savePermissionState、
// permissionStatePath、toPermissionPromptView、PermissionCheck、
// AddAllowRuleResult 都迁移到 ./tui-permission-runtime.ts。
// 保留在 index.ts 的协调器：executePermissionApprove / executePermissionDeny /
// handlePermissionsCommand / setPermissionMode / getModeChangeGuard，因为它们
// 依赖 i18n（t）/ ensureSession / executeIndexIgnoreWritePlan /
// runIndexRepository / executeApprovedModelToolUse /
// continueModelAfterToolResults / writeLightHints / writeStatus 等
// index.ts 内部协调函数，跨模块迁移会引入循环依赖。
// ---------------------------------------------------------------------------
export {
  type AddAllowRuleResult,
  type PermissionCheck,
  addAllowRule,
  decidePermission,
  loadPermissionState,
  permissionStatePath,
  recordPermissionDenied,
  savePermissionState,
  toPermissionPromptView,
} from "./tui-permission-runtime.js";

import {
  addAllowRule,
  decidePermission,
  loadPermissionState,
  recordPermissionDenied,
  savePermissionState,
  toPermissionPromptView,
} from "./tui-permission-runtime.js";

// 测试导出：让 index.test.ts 直接覆盖去重 / 失败回滚 / 成功落盘三条核心路径。
export async function addAllowRuleForTest(
  context: TuiContext,
  toolName: ToolName | "*",
  risk: PermissionRule["risk"] | undefined,
): Promise<import("./tui-permission-runtime.js").AddAllowRuleResult> {
  return addAllowRule(context, toolName, risk);
}

/**
 * executePermissionApprove — 把 handleNaturalInput 的 yes 分支主体抽成
 * 函数。语义与原 yes 路径完全一致。**调用方负责清空 pendingLocalApproval**
 * （与原 inline 分支保持一致，避免双清空）。
 */
async function executePermissionApprove(
  approval: PendingLocalApproval,
  context: TuiContext,
  gateway: ModelGateway | undefined,
  output: Writable,
): Promise<void> {
  if (approval.kind === "index_ignore_write") {
    const written = await executeIndexIgnoreWritePlan(approval.plan, context, output);
    if (written) {
      await runIndexRepository(context, context.config.index.mode, "refresh", false, output);
      writeLine(output, formatIndexRefreshSummary(context));
    }
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "architecture_drift") {
    const result = await executeModelToolUse(
      approval.toolCall,
      context,
      approval.sessionId,
      output,
      approval.continuation,
      true,
    );
    const reportWriteGuard = approval.continuation?.reportWriteGuard;
    if (doesWriteSatisfyReportGuard(reportWriteGuard, approval.toolCall, result)) {
      reportWriteGuard.completed = true;
    }
    if (gateway && approval.continuation && !result.pendingApproval) {
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(result),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
    }
    writeLightHints(output, context);
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "model_tool_use") {
    const result = await executeApprovedModelToolUse(
      approval.toolCall,
      approval.toolName,
      context,
      approval.sessionId,
      output,
      undefined,
      approval.continuation?.reportWriteGuard,
    );
    const reportWriteGuard = approval.continuation?.reportWriteGuard;
    if (doesWriteSatisfyReportGuard(reportWriteGuard, approval.toolCall, result)) {
      reportWriteGuard.completed = true;
    }
    if (gateway && approval.continuation) {
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(result),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
    }
    writeLightHints(output, context);
    writeStatus(output, context);
    return;
  }
}

/**
 * executePermissionDeny — 把 handleNaturalInput 的 no 分支主体抽成函数。
 * 与原 no 路径行为一致；cancelled=true 写 "cancelled by user"，否则
 * "denied by user"。**调用方负责清空 pendingLocalApproval**。
 */
async function executePermissionDeny(
  approval: PendingLocalApproval,
  context: TuiContext,
  gateway: ModelGateway | undefined,
  output: Writable,
  cancelled: boolean,
): Promise<void> {
  const sessionId = await ensureSession(context);
  const outcomeText = cancelled ? "permission cancelled by user" : "permission denied by user";
  if (approval.kind === "index_ignore_write") {
    await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `${outcomeText}: ${approval.plan.path}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? "Permission denied. No file was written and the index was not refreshed."
        : "已拒绝权限。本轮未写入文件，也未刷新索引。",
    );
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "architecture_drift") {
    const evidence = await recordToolFailureEvidence(
      context,
      approval.sessionId,
      approval.toolName,
      `${outcomeText}: architecture drift confirmation required`,
    );
    const deniedResult = {
      ok: false,
      tool: approval.toolName,
      text: outcomeText,
      outcome: cancelled ? "cancelled" : "denied",
      evidenceId: evidence.id,
      architectureDrift: approval.warnings,
    };
    await appendToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolName,
      deniedResult.text,
      true,
      evidence.id,
    );
    if (gateway && approval.continuation) {
      writeLine(output, formatPermissionDenialPrimary(context.language));
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(deniedResult),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
      writeLightHints(output, context);
      writeStatus(output, context);
      return;
    }
  }
  if (approval.kind === "model_tool_use") {
    const evidence = await recordToolFailureEvidence(
      context,
      approval.sessionId,
      approval.toolName,
      `${outcomeText}: ${approval.toolName}`,
    );
    const deniedResult = {
      ok: false,
      tool: approval.toolName,
      text: outcomeText,
      outcome: cancelled ? "cancelled" : "denied",
      evidenceId: evidence.id,
    };
    await appendToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolName,
      deniedResult.text,
      true,
      evidence.id,
    );
    if (gateway && approval.continuation) {
      writeLine(output, formatPermissionDenialPrimary(context.language));
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(deniedResult),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
      writeLightHints(output, context);
      writeStatus(output, context);
      return;
    }
  }
  writeLine(output, formatPermissionDenialPrimary(context.language));
  writeStatus(output, context);
}

async function handlePermissionsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const [action, ...rest] = args;
  if (!action) {
    writeLine(output, formatPermissionRules(context.permissions));
    return;
  }
  if (action === "recent") {
    if (rest[0] === "clear") {
      context.permissions.recentDenied = [];
      await savePermissionState(context.projectPath, context.permissions);
      writeLine(output, "已清空最近拒绝记录。");
      return;
    }
    if (rest[0] === "delete" || rest[0] === "remove") {
      const id = rest[1];
      if (!id) {
        writeLine(output, "用法：/permissions recent delete <id>");
        return;
      }
      const before = context.permissions.recentDenied.length;
      context.permissions.recentDenied = context.permissions.recentDenied.filter(
        (item) => item.id !== id,
      );
      await savePermissionState(context.projectPath, context.permissions);
      writeLine(
        output,
        before === context.permissions.recentDenied.length
          ? `未找到最近拒绝：${id}`
          : `已删除最近拒绝：${id}`,
      );
      return;
    }
    writeLine(output, formatRecentDenied(context.permissions));
    return;
  }
  if (action === "add") {
    const effect = rest[0] as PermissionRule["effect"] | undefined;
    const toolName = rest[1] as ToolName | "*" | undefined;
    const risk = rest[2] as PermissionRule["risk"] | undefined;
    if (!effect || !["allow", "ask", "deny"].includes(effect) || !toolName) {
      writeLine(output, "用法：/permissions add allow|ask|deny <tool|*> [low|medium|high]");
      return;
    }
    if (effect === "allow") {
      // D.13E Step 2 修正 #4：复用 addAllowRule helper（去重 + 失败回滚 + 审计文案）
      const result = await addAllowRule(context, toolName, risk);
      writeLine(output, result.message);
      return;
    }
    // ask / deny 仍走原 inline 逻辑（去重语义只对 allow 收紧）
    if (toolName !== "*" && !(toolName in builtInTools)) {
      writeLine(output, `未知工具：${toolName}`);
      return;
    }
    const rule: PermissionRule = { id: randomUUID(), effect, toolName, risk };
    context.permissions.rules.push(rule);
    await savePermissionState(context.projectPath, context.permissions);
    writeLine(output, `已添加权限规则：${rule.id} ${effect} ${toolName}${risk ? ` ${risk}` : ""}`);
    return;
  }
  if (action === "remove") {
    const id = rest[0];
    if (!id) {
      writeLine(output, "用法：/permissions remove <id>");
      return;
    }
    const before = context.permissions.rules.length;
    context.permissions.rules = context.permissions.rules.filter((rule) => rule.id !== id);
    await savePermissionState(context.projectPath, context.permissions);
    writeLine(
      output,
      before === context.permissions.rules.length ? `未找到规则：${id}` : `已删除规则：${id}`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/permissions | /permissions add | /permissions remove | /permissions recent",
  );
}

async function handleBackgroundCommand(
  _args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await hydrateDurableJobBackgroundTasks(context);
  refreshBackgroundLifecycle(context);
  if (context.backgroundTasks.length === 0) {
    writeLine(output, t(context, "backgroundNone"));
    return;
  }
  for (const task of context.backgroundTasks) {
    writeLine(output, formatBackgroundTask(task, context.language));
  }
}

async function handleRemoteCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  refreshRemoteState(context);
  const action = args[0] ?? "status";
  if (action === "status") {
    writeLine(output, formatRemoteStatus(context.remote));
    return;
  }
  if (action === "doctor") {
    const report = formatRemoteDoctor(context);
    context.remote.lastDoctor = report;
    await appendRemoteSystemEvent(
      context,
      `remote_doctor ${remoteTranscriptSummary(report)}`,
      "info",
    );
    writeLine(output, report);
    return;
  }
  if (action === "setup") {
    writeLine(output, formatRemoteSetup(args[1], context));
    return;
  }
  if (action === "test") {
    const channel = findRemoteChannel(context, args[1]);
    if (!channel) {
      writeLine(output, "Remote test：未识别通道。用法：/remote test feishu|wecom|dingtalk");
      return;
    }
    const event = createRemoteEvent(
      channel,
      "job_status",
      "Remote channel test: Linghun redacted summary only.",
      [],
      5 * 60 * 1000,
    );
    const result = sendRemoteEvent(context, event);
    await appendRemoteSystemEvent(
      context,
      `remote_test channel=${channel.id} status=${result.status} summary=${event.redactedSummary}`,
      result.status === "sent" ? "info" : "warning",
    );
    writeLine(output, formatRemoteTestResult(channel, result));
    return;
  }
  if (action === "disable") {
    const channel = findRemoteChannel(context, args[1]);
    if (!channel) {
      writeLine(output, "Remote disable：未识别通道。用法：/remote disable feishu|wecom|dingtalk");
      return;
    }
    if (!context.remote.sessionDisabledChannelIds.includes(channel.id)) {
      context.remote.sessionDisabledChannelIds.push(channel.id);
    }
    channel.runtimeStatus = "disabled";
    channel.lastError = "disabled_by_user";
    channel.nextAction = `/remote setup ${channel.id}`;
    await appendRemoteSystemEvent(context, `remote_disabled channel=${channel.id}`, "info");
    writeLine(
      output,
      `Remote channel disabled：${channel.id}\n- 本地 TUI 不受影响。\n- 如需重新连接：/remote setup ${channel.id}`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/remote setup <channel> | /remote test <channel> | /remote status | /remote doctor | /remote disable <channel>",
  );
}

function formatRemoteDoctor(context: TuiContext): string {
  const lines = [
    `Remote Doctor：${context.remote.enabled ? "enabled" : "disabled"}；失败会降级为 disabled/blocked，不阻塞主 TUI。`,
  ];
  for (const channel of context.remote.channels) {
    lines.push(`- ${channel.id}: ${channel.runtimeStatus}`);
    lines.push(`  binding: ${channel.bindingStatus}`);
    lines.push(`  transport: ${channel.config.transport}; status=${channel.transportStatus}`);
    lines.push(`  last error: ${channel.lastError ?? "none"}`);
    lines.push(`  allowed events: ${channel.config.allowedEventTypes.join(", ")}`);
    lines.push(`  next action: ${channel.nextAction}`);
  }
  lines.push("Secrets/endpoints are redacted. Use webhook_mock for notification-only dry runs.");
  return lines.join("\n");
}

function formatRemoteSetup(channelArg: string | undefined, context: TuiContext): string {
  const channel = findRemoteChannel(context, channelArg);
  if (!channel) {
    return "Remote setup：请选择 feishu、wecom 或 dingtalk。示例：/remote setup feishu";
  }
  const loginHint = getRemoteLoginHint(channel.config.type);
  const fallback =
    "如果只想收通知，可配置 webhook_mock/webhook fallback；不要在主屏粘贴 secret/token/full endpoint。";
  return [
    `Remote setup：${channel.id}（默认不自动启用；先完成绑定和信任来源）`,
    `- 推荐路径：${loginHint}`,
    `- 当前 binding: ${channel.bindingStatus}; transport=${channel.config.transport}/${channel.transportStatus}`,
    `- 下一步：完成 CLI 登录或 webhook 填写后运行 /remote test ${channel.id}，再运行 /remote status。`,
    `- ${fallback}`,
  ].join("\n");
}

function findRemoteChannel(
  context: TuiContext,
  channelArg: string | undefined,
): RemoteChannelState | undefined {
  const id = normalizeRemoteChannelId(channelArg ?? "");
  return context.remote.channels.find((channel) => channel.id === id || channel.config.type === id);
}

function normalizeRemoteChannelId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "lark") return "feishu";
  if (normalized === "enterprise-wechat") return "wecom";
  return normalized;
}

function getRemoteLoginHint(type: RemoteChannelType): string {
  if (type === "feishu" || type === "lark") {
    return "检测 lark-cli / feishu-cli；未初始化请运行 feishu-cli config init 或 lark-cli auth login。";
  }
  if (type === "dingtalk") {
    return "检测 dws；未登录请运行 dws auth login 或 dws device login。";
  }
  return "检测 wecom-cli；未初始化请运行 wecom-cli init，然后检查 auth/login 状态。";
}

function getRemoteInstallHint(type: RemoteChannelType): string {
  if (type === "feishu" || type === "lark") {
    return "install lark-cli/feishu-cli, then run feishu-cli config init or lark-cli auth login";
  }
  if (type === "dingtalk") {
    return "install dws, then run dws auth login or dws device login";
  }
  return "install wecom-cli, then run wecom-cli init/auth";
}

export function createRemoteEvent(
  channel: RemoteChannelState,
  eventType: RemoteEventType,
  summary: string,
  refs: string[] = [],
  ttlMs = 10 * 60 * 1000,
): RemoteEvent {
  const now = Date.now();
  const id = `remote-${randomUUID().slice(0, 8)}`;
  return {
    id,
    channel: channel.id,
    eventType,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    nonce: randomUUID(),
    messageId: `msg-${randomUUID().slice(0, 12)}`,
    source: channel.config.trustedSources[0] ?? "local-test",
    redactedSummary: redactRemoteSummary(summary),
    refs: refs.map((ref) => truncateDisplay(redactRemoteSummary(ref), 120)),
    status: "pending",
  };
}

function sendRemoteEvent(context: TuiContext, event: RemoteEvent): RemoteEvent {
  const channel = context.remote.channels.find((item) => item.id === event.channel);
  const next = { ...event };
  if (!channel || channel.runtimeStatus !== "ready") {
    next.status = "failed";
  } else if (!channel.config.allowedEventTypes.includes(event.eventType)) {
    next.status = "rejected";
  } else if (channel.config.transport === "webhook" && !channel.config.endpoint) {
    next.status = "failed";
  } else {
    next.status = "sent";
  }
  context.remote.events.unshift(next);
  context.remote.events = context.remote.events.slice(0, 20);
  return next;
}

export function processRemoteApprovalForTest(
  context: TuiContext,
  event: RemoteEvent,
  message: RemoteApprovalMessage,
): RemoteApprovalDecision {
  const decision = processRemoteApproval(context, event, message);
  context.remote.lastApproval = decision;
  return decision;
}

function processRemoteApproval(
  context: TuiContext,
  event: RemoteEvent,
  message: RemoteApprovalMessage,
): RemoteApprovalDecision {
  const channel = context.remote.channels.find((item) => item.id === event.channel);
  const reject = (
    status: RemoteApprovalDecision["status"],
    summary: string,
  ): RemoteApprovalDecision => {
    event.status = status === "expired" ? "expired" : "rejected";
    return { status, summary, evidenceCreated: false };
  };
  if (!channel || channel.runtimeStatus !== "ready") {
    return reject("blocked", "remote channel is not ready");
  }
  if (event.eventType !== "approval_request") {
    return reject("blocked", "remote event is not an approval_request");
  }
  if (Date.parse(event.expiresAt) <= Date.now()) {
    return reject("expired", "remote approval expired");
  }
  if (context.remote.processedMessageIds.includes(message.messageId)) {
    return reject("replayed", "remote approval replayed");
  }
  if (message.messageId !== event.messageId || message.nonce !== event.nonce) {
    return reject("bad_signature", "remote approval nonce/messageId mismatch");
  }
  if (!channel.config.trustedSources.includes(message.source)) {
    return reject("unknown_source", "remote approval source is not trusted");
  }
  if (
    message.bindingUserId !== channel.config.bindingUserId ||
    (channel.config.bindingDeviceId && message.bindingDeviceId !== channel.config.bindingDeviceId)
  ) {
    return reject("wrong_binding", "remote approval binding mismatch");
  }
  if (!verifyRemoteSignature(channel, event, message)) {
    return reject("bad_signature", "remote approval signature check failed");
  }
  if (!context.pendingLocalApproval) {
    return reject("blocked", "no local pending approval to resume");
  }
  context.remote.processedMessageIds.unshift(message.messageId);
  context.remote.processedMessageIds = context.remote.processedMessageIds.slice(0, 50);
  event.status = message.approve ? "approved" : "rejected";
  return {
    status: message.approve ? "approved" : "rejected",
    summary: message.approve
      ? "remote approval validated; local permission pipeline remains the execution boundary"
      : "remote approval rejected by user",
    evidenceCreated: false,
  };
}

function verifyRemoteSignature(
  channel: RemoteChannelState,
  event: RemoteEvent,
  message: RemoteApprovalMessage,
): boolean {
  if (!channel.config.signingSecretRef) {
    return message.signature === `mock:${event.messageId}:${event.nonce}`;
  }
  return typeof message.signature === "string" && message.signature.startsWith("ref:");
}

async function appendRemoteSystemEvent(
  context: TuiContext,
  message: string,
  level: "info" | "warning",
): Promise<void> {
  await appendSystemEvent(
    context,
    await ensureSession(context),
    remoteTranscriptSummary(message),
    level,
  );
}

async function handleJobCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "list";
  await hydrateDurableJobBackgroundTasks(context);
  if (action === "list") {
    const jobs = await listDurableJobs(context);
    writeLine(output, formatJobList(jobs, context));
    return;
  }
  if (action === "run" || action === "create" || action === "new") {
    const options = parseJobRunOptions(args.slice(1));
    if (!options.goal) {
      writeLine(
        output,
        "用法：/job run <goal> [--phase <phase>] [--target <target>] [--agents <n>] [--tokens <n>] [--max-steps <n>] [--timeout <ms>] [--allow-edit] [--allow-bash] [--multi-agent]",
      );
      return;
    }
    const start = action === "run";
    const job = await createDurableJob(context, options, start);
    if (start && job.status === "running") {
      await startRunnerForDurableJob(context, job);
    }
    await persistDurableJob(job);
    await appendJobLog(
      job,
      `job ${action}: ${job.status}; pauseReason=${job.pauseReason ?? "none"}`,
    );
    await writeDurableJobReport(job);
    const background = upsertJobBackgroundTask(context, job);
    await appendBackgroundTaskEvent(context, await ensureSession(context), background);
    if (start && job.status === "running") {
      await runDurableJobLiteTick(context, job);
    }
    writeLine(output, formatJobPrimary(job, context));
    return;
  }
  if (["status", "report", "logs", "pause", "resume", "cancel"].includes(action)) {
    const job = await findDurableJob(context, args[1]);
    if (!job) {
      writeLine(output, "未找到 job。用法：/job status|report|logs|pause|resume|cancel <id>");
      return;
    }
    if (action === "status") {
      refreshRunnerStatusForJob(context, job);
      await persistDurableJob(job);
      await writeDurableJobReport(job);
      upsertJobBackgroundTask(context, job);
      writeLine(output, formatJobStatus(job));
      return;
    }
    if (action === "report") {
      refreshRunnerStatusForJob(context, job);
      await persistDurableJob(job);
      await writeDurableJobReport(job);
      upsertJobBackgroundTask(context, job);
      writeLine(output, formatJobReport(job));
      return;
    }
    if (action === "logs") {
      writeLine(output, await formatJobLogs(job));
      return;
    }
    if (action === "pause") {
      await transitionDurableJob(job, context, "sleeping", "user_paused");
      writeLine(output, formatJobPrimary(job, context));
      return;
    }
    if (action === "resume") {
      await resumeDurableJob(job, context);
      writeLine(output, formatJobPrimary(job, context));
      return;
    }
    if (job.runner) {
      await stopRunnerForDurableJob(context, job);
    }
    await transitionDurableJob(job, context, "cancelled", "user_cancelled");
    writeLine(output, formatJobPrimary(job, context));
    return;
  }
  writeLine(
    output,
    "用法：/job list | /job run <goal> | /job create <goal> | /job status <id> | /job logs <id> | /job report <id> | /job pause <id> | /job resume <id> | /job cancel <id>",
  );
}

async function createDurableJob(
  context: TuiContext,
  options: ParsedJobRunOptions,
  start: boolean,
): Promise<DurableJobState> {
  const now = new Date().toISOString();
  const id = `job-${randomUUID().slice(0, 8)}`;
  const paths = getDurableJobPaths(context, id);
  const handoffPacket = await loadOrCreateHandoffPacket(context, await ensureSession(context));
  const missing = validateHandoffPacket(handoffPacket);
  const resourceGuard = start
    ? (checkResourceGuard(context, "model") ?? checkBackgroundStartGuard(context, "job", true))
    : null;
  const runningCap = DEFAULT_JOB_RUNNING_AGENT_CAP;
  const status: DurableJobStatus = !start
    ? "created"
    : missing.length > 0
      ? "blocked"
      : resourceGuard
        ? "sleeping"
        : "running";
  const pauseReason =
    missing.length > 0
      ? `needs_handoff_repair:${missing.join(",")}`
      : resourceGuard
        ? `resource_guard:${resourceGuard}`
        : undefined;
  const agents = createDurableJobAgents(options, status, runningCap);
  return {
    id,
    goal: options.goal,
    projectPath: context.projectPath,
    phase: options.phase,
    target: options.target,
    plan: options.plan,
    budget: {
      maxTokens: options.maxTokens,
      maxRunningAgents: runningCap,
      maxSteps: options.maxSteps,
      note: `${runningCap} running agents is the default cap; ${JOB_AGENT_HIGH_CONFIG_CANDIDATE} is benchmark/high-config candidate only, not default.`,
      usedTokens: 0,
      remainingTokens: options.maxTokens,
      usedSteps: 0,
      maxRuntimeMs: options.timeoutMs,
    },
    timeoutMs: options.timeoutMs,
    permissionPolicy: context.permissionMode,
    allowEdit: options.allowEdit,
    allowBash: options.allowBash,
    allowMultiAgent: options.allowMultiAgent,
    status,
    pauseReason,
    agents,
    handoffPacket,
    createdAt: now,
    updatedAt: now,
    startedAt: start && status === "running" ? now : undefined,
    ownerSessionId: start && status === "running" ? await ensureSession(context) : undefined,
    ownerPid: start && status === "running" ? process.pid : undefined,
    heartbeatAt: start && status === "running" ? now : undefined,
    worker: { status: "not_started", summary: "Lite worker has not run yet." },
    logPath: paths.logPath,
    reportPath: paths.reportPath,
    fullOutputPath: paths.fullOutputPath,
    evidenceRefs: context.evidence
      .map((item) => ({ id: item.id, kind: item.kind, source: item.source, summary: item.summary }))
      .slice(0, 8),
    verification: { status: "not_run", summary: "not run in Phase 17A Lite job loop" },
    adoptedConclusions: [],
    rejectedConclusions:
      status === "blocked" || status === "sleeping"
        ? ["No PASS evidence is generated for blocked/sleeping jobs."]
        : [],
  };
}

async function resumeDurableJob(job: DurableJobState, context: TuiContext): Promise<void> {
  if (
    job.status === "cancelled" ||
    job.status === "timeout" ||
    job.status === "failed" ||
    job.status === "completed"
  ) {
    job.result = {
      status: job.status === "timeout" ? "timeout" : job.status === "failed" ? "failed" : "blocked",
      summary: `Resume refused for terminal ${job.status} job; no PASS evidence generated.`,
      facts: [`terminalStatus=${job.status}`, job.pauseReason ?? "no pause reason"],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: new Date().toISOString(),
    };
    job.rejectedConclusions = [
      ...job.rejectedConclusions,
      `Terminal ${job.status} job was not upgraded by resume and is not PASS evidence.`,
    ];
    await persistDurableJobProgress(
      context,
      job,
      `resume refused for terminal status ${job.status}`,
    );
    return;
  }
  const missing = job.handoffPacket ? validateHandoffPacket(job.handoffPacket) : ["handoffPacket"];
  if (missing.length > 0) {
    await transitionDurableJob(
      job,
      context,
      "blocked",
      `needs_handoff_repair:${missing.join(",")}`,
    );
    return;
  }
  const resourceGuard =
    checkResourceGuard(context, "model") ?? checkBackgroundStartGuard(context, "job", true, job.id);
  if (resourceGuard) {
    await transitionDurableJob(job, context, "sleeping", `resource_guard:${resourceGuard}`);
    return;
  }
  await transitionDurableJob(job, context, "running");
  if (job.status === "running") {
    await startRunnerForDurableJob(context, job);
    await persistDurableJob(job);
    await writeDurableJobReport(job);
    upsertJobBackgroundTask(context, job);
  }
  await runDurableJobLiteTick(context, job);
}

async function transitionDurableJob(
  job: DurableJobState,
  context: TuiContext,
  status: DurableJobStatus,
  pauseReason?: string,
): Promise<void> {
  const now = new Date().toISOString();
  job.status = status;
  job.pauseReason = pauseReason;
  job.updatedAt = now;
  if (status === "running") {
    job.startedAt ??= now;
    job.ownerSessionId = await ensureSession(context);
    job.ownerPid = process.pid;
    job.heartbeatAt = now;
  }
  if (
    status === "cancelled" ||
    status === "completed" ||
    status === "failed" ||
    status === "stale" ||
    status === "timeout"
  ) {
    job.endedAt = now;
  }
  if (status === "cancelled" || status === "failed" || status === "stale" || status === "timeout") {
    job.result = {
      status,
      summary: `Durable job moved to ${status}; no PASS evidence generated.`,
      facts: [pauseReason ?? "no pause reason", formatJobRunnerInline(job)],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: now,
    };
  }
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `job transition: ${status}; pauseReason=${pauseReason ?? "none"}`);
  await persistDurableJob(job);
  await writeDurableJobReport(job);
  const background = upsertJobBackgroundTask(context, job);
  await appendBackgroundTaskEvent(context, await ensureSession(context), background);
}

async function hydrateDurableJobBackgroundTasks(context: TuiContext): Promise<void> {
  const jobs = await listDurableJobs(context);
  for (const job of jobs) {
    const recovered = await recoverDurableJobForContext(context, job);
    upsertJobBackgroundTask(context, recovered);
  }
}

async function recoverDurableJobForContext(
  context: TuiContext,
  job: DurableJobState,
): Promise<DurableJobState> {
  const recoverableStatuses: DurableJobStatus[] = ["running", "sleeping", "blocked", "stale"];
  if (!recoverableStatuses.includes(job.status)) {
    return job;
  }
  const originalStatus = job.status;
  const missing = job.handoffPacket ? validateHandoffPacket(job.handoffPacket) : ["handoffPacket"];
  if (missing.length > 0) {
    job.status = "blocked";
    job.pauseReason = `needs_handoff_repair:${missing.join(",")}`;
  } else if (
    originalStatus === "running" &&
    (!job.ownerSessionId || !job.ownerPid || !job.heartbeatAt)
  ) {
    job.status = "stale";
    job.pauseReason = "recovered_without_owner_or_heartbeat";
  } else if (originalStatus === "running") {
    const heartbeatAge = Date.now() - Date.parse(job.heartbeatAt ?? "");
    if (Number.isNaN(heartbeatAge) || heartbeatAge > JOB_RECOVERY_HEARTBEAT_STALE_MS) {
      job.status = "stale";
      job.pauseReason = "recovered_stale_heartbeat";
    }
  }
  if (job.status === originalStatus && originalStatus !== "stale") {
    return job;
  }
  if (job.runner && job.status === "stale") {
    await stopRunnerForDurableJob(context, job);
    markJobRunnerTerminal(job, "stale", job.pauseReason ?? "recovered stale job");
  }
  const now = new Date().toISOString();
  job.updatedAt = now;
  job.endedAt = job.status === "stale" ? now : job.endedAt;
  job.result = {
    status: job.status === "blocked" ? "blocked" : "stale",
    summary: `Recovered job moved to ${job.status}; no PASS evidence generated.`,
    facts: ["startup recovery", job.pauseReason ?? "no pause reason"],
    evidenceRefs: job.evidenceRefs.map((item) => item.id),
    generatedAt: now,
  };
  job.rejectedConclusions = [
    ...job.rejectedConclusions,
    `Recovered ${job.status} job is conservative and not PASS evidence.`,
  ];
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `job recovery: ${job.status}; pauseReason=${job.pauseReason ?? "none"}`);
  await persistDurableJob(job);
  await writeDurableJobReport(job);
  return job;
}

async function runDurableJobLiteTick(context: TuiContext, job: DurableJobState): Promise<void> {
  if (job.status !== "running") {
    return;
  }
  const budgetStop = await applyDurableJobBudgetStop(context, job, "before_worker_loop");
  if (budgetStop) {
    return;
  }
  const startedAt = new Date().toISOString();
  const workerSession = await context.store.create({
    model: context.model,
    summary: `job-worker:${job.id}:${truncateDisplay(job.goal, 40)}`,
  });
  job.worker = {
    sessionId: workerSession.id,
    status: "running",
    startedAt,
    currentStep: job.budget.usedSteps ?? 0,
    completedSteps: job.budget.usedSteps ?? 0,
    summary: "Bounded local worker loop is running with trimmed refs only.",
  };
  await persistDurableJobProgress(context, job, "worker loop started");

  while (job.status === "running" && (job.budget.usedSteps ?? 0) < job.plan.length) {
    const stepIndex = job.budget.usedSteps ?? 0;
    if (stepIndex >= getDurableJobMaxSteps(job)) {
      job.result = {
        status: "blocked",
        summary: "Durable worker stopped at maxSteps; no PASS evidence generated.",
        facts: [`maxSteps=${getDurableJobMaxSteps(job)}`, `plannedSteps=${job.plan.length}`],
        evidenceRefs: job.evidenceRefs.map((item) => item.id),
        generatedAt: new Date().toISOString(),
      };
      job.worker = {
        ...job.worker,
        status: "blocked",
        endedAt: job.result.generatedAt,
        summary: job.result.summary,
      };
      await transitionDurableJob(
        job,
        context,
        "blocked",
        `max_steps_reached:${getDurableJobMaxSteps(job)}`,
      );
      return;
    }

    const stop = await applyDurableJobBudgetStop(context, job, `before_step_${stepIndex + 1}`);
    if (stop) {
      return;
    }

    const stepFacts = createDurableJobStepFacts(context, job, stepIndex);
    const summary = [
      `Phase 17A bounded worker step ${stepIndex + 1}/${job.plan.length}: ${job.plan[stepIndex]}.`,
      "Input boundary: trimmed handoff/project facts/evidence refs/workspace cache/index status only.",
      `Permissions: allowEdit=${job.allowEdit}; allowBash=${job.allowBash}; no write/Bash/network action is executed by this local worker loop.`,
      "No full transcript/source/index/log output was injected.",
    ].join(" ");
    const estimatedTokens = estimateJobTokens(`${summary}\n${stepFacts.join("\n")}`);
    if ((job.budget.usedTokens ?? 0) + estimatedTokens > job.budget.maxTokens) {
      job.result = {
        status: "overbudget",
        summary:
          "Durable worker stopped before the next step because maxTokens would be exceeded; no PASS evidence generated.",
        facts: stepFacts,
        evidenceRefs: job.evidenceRefs.map((item) => item.id),
        generatedAt: new Date().toISOString(),
      };
      job.worker = {
        ...job.worker,
        status: "blocked",
        currentStep: stepIndex + 1,
        completedSteps: stepIndex,
        endedAt: job.result.generatedAt,
        summary: job.result.summary,
      };
      await transitionDurableJob(
        job,
        context,
        "blocked",
        `budget_exceeded:maxTokens=${job.budget.maxTokens}`,
      );
      return;
    }

    const now = new Date().toISOString();
    job.budget.usedTokens = (job.budget.usedTokens ?? 0) + estimatedTokens;
    job.budget.remainingTokens = Math.max(0, job.budget.maxTokens - job.budget.usedTokens);
    job.budget.usedSteps = stepIndex + 1;
    job.worker = {
      ...job.worker,
      status: "running",
      currentStep: stepIndex + 1,
      completedSteps: stepIndex + 1,
      summary,
    };
    job.result = {
      status: "partial",
      summary,
      facts: stepFacts,
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: now,
    };
    job.verification = {
      status: "partial",
      summary: "Bounded worker output is structured but not verification PASS.",
    };
    job.heartbeatAt = now;
    job.updatedAt = now;
    await context.store.appendEvent(workerSession.id, {
      type: "system_event",
      id: randomUUID(),
      level: "info",
      message: `${summary} facts=${stepFacts.join(" | ")}`,
      createdAt: now,
    });
    await appendJobLog(
      job,
      `worker step ${stepIndex + 1}/${job.plan.length}: tokens=${estimatedTokens}; refs=${stepFacts.join(" | ")}`,
    );
    await persistDurableJobProgress(context, job, `worker step ${stepIndex + 1} persisted`);

    const afterStop = await applyDurableJobBudgetStop(context, job, `after_step_${stepIndex + 1}`);
    if (afterStop) {
      return;
    }
  }

  if (job.status !== "running") {
    return;
  }
  const endedAt = new Date().toISOString();
  job.worker = {
    ...job.worker,
    status: "completed",
    endedAt,
    currentStep: job.budget.usedSteps ?? job.plan.length,
    completedSteps: job.budget.usedSteps ?? job.plan.length,
    summary:
      "Phase 17A bounded worker loop completed local read-only task graph steps; verification is still partial.",
  };
  job.result = {
    status: "partial",
    summary: job.worker.summary,
    facts: createDurableJobStepFacts(context, job, Math.max(0, (job.budget.usedSteps ?? 1) - 1)),
    evidenceRefs: job.evidenceRefs.map((item) => item.id),
    generatedAt: endedAt,
  };
  job.verification = {
    status: "partial",
    summary: "Worker loop completion is not verification PASS and not smoke-ready proof.",
  };
  job.status = "completed";
  job.pauseReason = undefined;
  job.endedAt = endedAt;
  job.heartbeatAt = endedAt;
  job.updatedAt = endedAt;
  job.adoptedConclusions = [
    ...job.adoptedConclusions,
    "Bounded worker loop produced read-only structured results from trimmed refs.",
  ];
  job.rejectedConclusions = [
    ...job.rejectedConclusions,
    "Completed job lifecycle only means the bounded worker loop ended; it is not PASS evidence, not Beta readiness, and not smoke-ready proof.",
  ];
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `worker loop completed: session=${workerSession.id}`);
  await persistDurableJobProgress(context, job, "worker loop completed without verification PASS");
}

async function persistDurableJobProgress(
  context: TuiContext,
  job: DurableJobState,
  message: string,
): Promise<void> {
  await appendJobLog(job, message);
  await persistDurableJob(job);
  await writeDurableJobReport(job);
  const background = upsertJobBackgroundTask(context, job);
  await appendBackgroundTaskEvent(context, await ensureSession(context), background);
}

function createDurableJobStepFacts(
  context: TuiContext,
  job: DurableJobState,
  stepIndex: number,
): string[] {
  const workspaceRef = context.cache.workspaceReference.latest;
  const workspaceSnapshot = workspaceRef?.workspaceSnapshot;
  return [
    `step=${stepIndex + 1}/${job.plan.length}`,
    `goal=${truncateDisplay(job.goal, 120)}`,
    `phase=${job.phase}`,
    `target=${job.target}`,
    `handoff=${job.handoffPacket?.id ?? "missing"}`,
    `index=${context.index.status}${context.index.projectName ? `:${context.index.projectName}` : ""}`,
    `workspaceCache=${workspaceRef?.source ?? "missing"};snapshot=${workspaceSnapshot ? "ready" : "missing"}`,
    `evidenceRefs=${job.evidenceRefs.map((item) => item.id).join(",") || "none"}`,
    `agents=${job.agents.filter((agent) => agent.status === "running").length}/${job.agents.length}`,
    `logs=${job.logPath};report=${job.reportPath}`,
  ];
}

async function applyDurableJobBudgetStop(
  context: TuiContext,
  job: DurableJobState,
  phase: string,
): Promise<boolean> {
  const started = Date.parse(job.startedAt ?? job.createdAt);
  const runtimeMs = Number.isNaN(started) ? 0 : Date.now() - started;
  const maxRuntimeMs = job.budget.maxRuntimeMs ?? job.timeoutMs;
  if (runtimeMs > maxRuntimeMs) {
    await transitionDurableJob(
      job,
      context,
      "timeout",
      `timeout:${phase}:${runtimeMs}/${maxRuntimeMs}`,
    );
    job.result = {
      status: "timeout",
      summary: "Durable job exceeded maxRuntime/timeout; no PASS evidence generated.",
      facts: [`runtimeMs=${runtimeMs}`, `maxRuntimeMs=${maxRuntimeMs}`],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: new Date().toISOString(),
    };
    await persistDurableJob(job);
    await writeDurableJobReport(job);
    return true;
  }
  if ((job.budget.usedTokens ?? 0) > job.budget.maxTokens) {
    await transitionDurableJob(job, context, "blocked", `budget_exceeded:${phase}`);
    return true;
  }
  return false;
}

// Module 4 — upsertJobBackgroundTask / createJobBackgroundTask /
// toJobContext / listDurableJobs / findDurableJob / getDurableJobsRoot /
// getDurableJobPaths / formatJobList / formatJobPrimary / formatJobReport /
// formatJobLogs 已移至 ./tui-agent-job-runtime.ts。
export {
  createJobBackgroundTask,
  findDurableJob,
  formatJobList,
  formatJobLogs,
  formatJobPrimary,
  formatJobReport,
  getDurableJobPaths,
  getDurableJobsRoot,
  listDurableJobs,
  toJobContext,
  upsertJobBackgroundTask,
} from "./tui-agent-job-runtime.js";

import {
  createJobBackgroundTask,
  findDurableJob,
  formatJobList,
  formatJobLogs,
  formatJobPrimary,
  formatJobReport,
  getDurableJobPaths,
  getDurableJobsRoot,
  listDurableJobs,
  toJobContext,
  upsertJobBackgroundTask,
} from "./tui-agent-job-runtime.js";

async function handleDetailsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  // /details 的所有 writeLine 都不应该覆盖 lastFullOutput，否则连续 /details
  // 会把"最近一次正文"替换成"上一次的 /details 总览"，陷入套娃。
  context.suppressLastFullOutputCapture = true;
  try {
    await runDetailsCommandBody(args, context, output);
  } finally {
    context.suppressLastFullOutputCapture = false;
  }
}

async function runDetailsCommandBody(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  const id = args[1];
  if (action === "evidence") {
    const evidence = findEvidence(context, id);
    writeLine(
      output,
      evidence ? formatEvidenceDetails(evidence) : "未找到 evidence。用法：/details evidence <id>",
    );
    return;
  }
  if (action === "background") {
    const task = findBackgroundTask(context, id);
    writeLine(
      output,
      task
        ? formatBackgroundDetails(task, context.language)
        : "未找到 background。用法：/details background <id>",
    );
    return;
  }
  if (action === "output") {
    const task = findBackgroundTask(context, id);
    const evidence = task ? undefined : findEvidence(context, id);
    const logRequest = parseLogArtifactRequest(args.slice(2));
    if (logRequest) {
      if (!task && !evidence) {
        writeLine(
          output,
          "未找到 output。用法：/details output <backgroundId|evidenceId> --tail [lines] | --grep <pattern> [--context N] | --errors",
        );
        return;
      }
      try {
        const slice = await readLogArtifactSlice(
          task ? { backgroundId: task.id } : { evidenceId: evidence?.id },
          logRequest,
          createLogArtifactRegistry(context),
        );
        writeLine(output, formatLogArtifactSlice(slice, context.language));
      } catch (error) {
        writeLine(output, formatError(error));
      }
      return;
    }
    if (task) {
      writeLine(output, formatBackgroundOutputDetails(task, context.language));
      return;
    }
    writeLine(
      output,
      evidence
        ? formatEvidenceDetails(evidence)
        : "未找到 output。用法：/details output <backgroundId|evidenceId>",
    );
    return;
  }
  if (action && action !== "list") {
    writeLine(
      output,
      "用法：/details | /details evidence <id> | /details background <id> | /details output <id>",
    );
    return;
  }

  // 默认分支：先展开最近一次完整正文（lastFullOutput），让 /model doctor →
  // /details 这种链路可以看到 provider.env merge / providers / endpointPath
  // 等被 summary 行截断的内容。再附上 evidence/background 的简短摘要。
  // D.13L Block C — 没有可展开内容时（lastFullOutput 空 + 没有 evidence /
  // background），主屏说人话："当前没有可展开的完整内容。" 不再 dump
  // "Linghun details / evidence: 0/16 / background: 0/16" 这种内部计数。
  const sections: string[] = [];
  if (context.lastFullOutput) {
    sections.push(
      context.language === "en-US"
        ? "Latest output (full body):"
        : "最近一次输出（完整正文）：",
    );
    sections.push(context.lastFullOutput);
    sections.push("");
  }
  const hasAnyDetail =
    Boolean(context.lastFullOutput) ||
    context.evidence.length > 0 ||
    context.backgroundTasks.length > 0;
  if (!hasAnyDetail) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Nothing to expand right now."
        : "当前没有可展开的完整内容。",
    );
    return;
  }
  const summary = [
    "Linghun details",
    `- evidence: ${context.evidence.length}/${MAX_EVIDENCE_RECORDS}`,
    `- background: ${context.backgroundTasks.length}/${MAX_BACKGROUND_TASKS}`,
    `- agents: ${context.agents.length}/${MAX_AGENTS}`,
    `- checkpoints: ${context.checkpoints.length}/${MAX_CHECKPOINTS}`,
    "- full output: /details evidence <id> | /details background <id> | /details output <id>",
  ];
  if (context.evidence.length > 0) {
    summary.push("- recent evidence:");
    for (const evidence of context.evidence.slice(0, 5)) {
      summary.push(`  - ${evidence.id} ${evidence.kind} ${evidence.source}: ${evidence.summary}`);
    }
  }
  if (context.backgroundTasks.length > 0) {
    summary.push("- recent background:");
    for (const task of context.backgroundTasks.slice(0, 5)) {
      summary.push(`  - ${task.id} ${task.kind} ${task.status}: ${task.userVisibleSummary}`);
    }
  }
  sections.push(summary.join("\n"));
  writeLine(output, sections.join("\n"));
}

// Module 5 — findEvidence / formatEvidenceDetails / parseLogArtifactRequest /
// readPositiveIntegerArg / createLogArtifactRegistry / formatAgentDetails
// 已移至 ./tui-details-runtime.ts。
export {
  createLogArtifactRegistry,
  findEvidence,
  formatAgentDetails,
  formatEvidenceDetails,
  parseLogArtifactRequest,
  readPositiveIntegerArg,
} from "./tui-details-runtime.js";

import {
  createLogArtifactRegistry,
  findEvidence,
  formatAgentDetails,
  formatEvidenceDetails,
  parseLogArtifactRequest,
} from "./tui-details-runtime.js";

// Module 4 — findBackgroundTask / isActiveBackgroundStatus 已移至
// ./tui-agent-job-runtime.ts。
export {
  findBackgroundTask,
  isActiveBackgroundStatus,
} from "./tui-agent-job-runtime.js";

import {
  findBackgroundTask,
  isActiveBackgroundStatus,
} from "./tui-agent-job-runtime.js";

function refreshBackgroundLifecycle(context: TuiContext): void {
  const now = Date.now();
  for (const task of context.backgroundTasks) {
    if (!isActiveBackgroundStatus(task.status)) {
      continue;
    }
    const lastActivity = Date.parse(task.lastOutputAt ?? task.updatedAt ?? task.startedAt);
    if (Number.isNaN(lastActivity)) {
      continue;
    }
    if (task.status === "running" && now - lastActivity > task.staleAfterMs) {
      task.status = "stale";
      task.result = "partial";
      task.updatedAt = new Date(now).toISOString();
      task.userVisibleSummary = `${task.userVisibleSummary}（可能卡住或长时间无输出）`;
      task.nextAction =
        context.language === "en-US"
          ? `Open /details background ${task.id}, inspect logs, or use /interrupt.`
          : `可用 /details background ${task.id} 查看日志，或用 /interrupt 取消。`;
    }
  }
}

function checkResourceGuard(
  context: TuiContext,
  kind: BackgroundTaskState["kind"] | "model" | "heavy",
  ignoreTaskId?: string,
): string | null {
  refreshBackgroundLifecycle(context);
  if (kind === "model") {
    return context.activeAbortController
      ? "已有前台模型请求正在运行；请等待完成或使用 /interrupt 取消后再继续。"
      : null;
  }
  const activeTasks = context.backgroundTasks.filter(
    (task) => task.id !== ignoreTaskId && isActiveBackgroundStatus(task.status),
  );
  if (activeTasks.length >= BACKGROUND_RUNNING_GLOBAL_CAP) {
    return `后台任务已达到全局上限 ${BACKGROUND_RUNNING_GLOBAL_CAP}；请等待完成、查看 /background，或用 /interrupt 取消卡住任务。`;
  }
  if (kind === "heavy") {
    const heavy = activeTasks.find(
      (task) =>
        task.kind === "verification" ||
        task.kind === "index" ||
        task.kind === "agent" ||
        task.kind === "bash" ||
        task.kind === "job",
    );
    return heavy
      ? `已有重任务正在运行：${heavy.kind} ${heavy.id}。请等待完成、查看 /background，或先 /interrupt。`
      : null;
  }
  const cap = BACKGROUND_KIND_CAPS[kind];
  if (cap !== undefined && activeTasks.filter((task) => task.kind === kind).length >= cap) {
    return `${kind} 后台任务已达到上限 ${cap}；请等待完成、查看 /background，或用 /interrupt 取消后重试。`;
  }
  return null;
}

function checkBackgroundStartGuard(
  context: TuiContext,
  kind: BackgroundTaskState["kind"],
  heavy = false,
  ignoreTaskId?: string,
): string | null {
  return (
    checkResourceGuard(context, kind, ignoreTaskId) ??
    (heavy ? checkResourceGuard(context, "heavy", ignoreTaskId) : null)
  );
}

// Module 4 — rememberBackgroundTask 已移至 ./tui-agent-job-runtime.ts。
export { rememberBackgroundTask } from "./tui-agent-job-runtime.js";
import { rememberBackgroundTask } from "./tui-agent-job-runtime.js";

function finishBackgroundTaskFromToolOutput(
  task: BackgroundTaskState,
  output: ToolOutput,
  context: TuiContext,
): void {
  const data = output.data as { exitCode?: unknown; outcome?: unknown } | undefined;
  const exitCode = typeof data?.exitCode === "number" ? data.exitCode : 0;
  const outcome = data?.outcome;
  const now = new Date().toISOString();
  if (outcome === "cancelled") {
    task.status = "cancelled";
    task.result = "cancelled";
    task.currentStep = context.language === "en-US" ? "cancelled" : "已取消";
  } else if (outcome === "timeout") {
    task.status = "timeout";
    task.result = "timeout";
    task.currentStep = context.language === "en-US" ? "timeout" : "已超时";
  } else if (exitCode !== 0) {
    task.status = "failed";
    task.result = "fail";
    task.currentStep = context.language === "en-US" ? "command failed" : "命令失败";
  } else {
    task.status = "completed";
    task.result = "pass";
    task.currentStep = context.language === "en-US" ? "command completed" : "命令完成";
  }
  task.updatedAt = now;
  task.lastOutputAt = now;
  task.hasOutput = Boolean(output.text.trim() || output.fullOutputPath);
  task.logPath = output.fullOutputPath;
  task.outputPath = output.fullOutputPath;
  task.progress = { completed: 1, total: 1, label: "Bash" };
  task.userVisibleSummary =
    task.status === "completed"
      ? context.language === "en-US"
        ? "Command completed; full output is in the log."
        : "命令已完成；完整输出已写入日志。"
      : context.language === "en-US"
        ? `Command ended with ${task.status}; do not claim it passed.`
        : `命令以 ${task.status} 结束；不得声称已通过。`;
  task.nextAction =
    task.status === "completed"
      ? context.language === "en-US"
        ? "Review the summarized output or open the log."
        : "可查看摘要输出或打开完整日志。"
      : context.language === "en-US"
        ? "Inspect the log, fix the issue, then rerun if needed."
        : "先查看日志并修复问题，必要时重跑。";
}

// Module 5 — formatEvidenceDetails / parseLogArtifactRequest /
// readPositiveIntegerArg / createLogArtifactRegistry 实现见
// ./tui-details-runtime.ts；下方 export+import 块将其引回 index.ts。

async function handleAgentsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "list";
  if (action === "list") {
    writeLine(output, formatAgentsList(context));
    return;
  }
  if (action === "show") {
    const agent = findAgent(context, args[1]);
    writeLine(output, agent ? formatAgentDetails(agent, context) : "未找到 agent。");
    return;
  }
  if (action === "cancel" || action === "interrupt") {
    const agent = findAgent(context, args[1]);
    if (!agent) {
      writeLine(output, "未找到 agent。");
      return;
    }
    await cancelAgent(agent, context, output);
    return;
  }
  writeLine(output, "用法：/agents | /agents show <id> | /agents cancel <id>");
}

async function handleForkCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const type = args[0] as AgentType | undefined;
  const task = args.slice(1).join(" ").trim();
  if (!type || !isAgentType(type) || !task) {
    writeLine(output, "用法：/fork explorer|planner|verifier|worker <task>");
    return;
  }
  const guard = checkBackgroundStartGuard(context, "agent", true);
  if (guard) {
    writeLine(output, guard);
    return;
  }
  const runningCount = context.agents.filter((agent) => agent.status === "running").length;
  if (runningCount >= 3) {
    writeLine(output, "最多同时运行 3 个 agent；请先 /agents cancel <id> 或等待完成。");
    return;
  }

  const parentSessionId = await ensureSession(context);
  const packet = await loadOrCreateHandoffPacket(context, parentSessionId);
  const role = getAgentRole(type);
  const resolved = resolveRoleRoute(context, role, `/fork ${type}`);
  await appendRouteDecisionEvent(context, parentSessionId, resolved.decision);
  if (!resolved.usable) {
    writeLine(output, formatRoutePauseMessage(role, resolved.decision));
    return;
  }
  const route = resolved.route;
  const child = await context.store.create({
    model: route.primaryModel || context.model,
    summary: `agent:${type}:${truncateDisplay(task, 60)}`,
  });
  const now = new Date().toISOString();
  const agent: AgentRun = {
    id: `agent-${randomUUID().slice(0, 8)}`,
    type,
    displayName: deriveAgentDisplayName(type, task),
    role,
    provider: route.provider || "unconfigured",
    parentSessionId,
    forkedFrom: packet.id,
    task,
    model: route.primaryModel || context.model,
    permissionMode: getAgentPermissionMode(type, context.permissionMode),
    status: "running",
    transcriptPath: child.transcriptPath,
    transcriptSessionId: child.id,
    summary: "agent running",
    contextSummary: createAgentContextSummary(packet, task, context),
    cost: createEmptyAgentCost(task),
    startedAt: now,
    updatedAt: now,
  };
  context.agents.unshift(agent);
  context.agents = context.agents.slice(0, MAX_AGENTS);
  const background = createAgentBackgroundTask(agent, context);
  rememberBackgroundTask(context, background);
  await context.store.appendEvent(parentSessionId, { type: "agent_start", agent, createdAt: now });
  await context.store.appendEvent(child.id, {
    type: "system_event",
    id: randomUUID(),
    level: "info",
    message: agent.contextSummary,
    createdAt: now,
  });
  await appendBackgroundTaskEvent(context, parentSessionId, background);
  writeLine(output, formatBackgroundTask(background, context.language));

  if (task.includes("--background")) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Background agent execution is not available in this runtime; running synchronously instead so no fake running state is created."
        : "当前 runtime 不支持真实后台 agent 执行；已降级为同步执行，避免生成假的 running 状态。",
    );
  }

  await completeAgent(agent, background, context, output);
}

// Module 4 — isAgentType / getAgentRole / getAgentPermissionMode /
// createEmptyAgentCost / createAgentContextSummary / createAgentBackgroundTask
// 已移至 ./tui-agent-job-runtime.ts。
export {
  createAgentBackgroundTask,
  createAgentContextSummary,
  createEmptyAgentCost,
  getAgentPermissionMode,
  getAgentRole,
  isAgentType,
} from "./tui-agent-job-runtime.js";

import {
  createAgentBackgroundTask,
  createAgentContextSummary,
  createEmptyAgentCost,
  getAgentPermissionMode,
  getAgentRole,
  isAgentType,
} from "./tui-agent-job-runtime.js";

async function completeAgent(
  agent: AgentRun,
  task: BackgroundTaskState,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const parentSessionId = agent.parentSessionId ?? (await ensureSession(context));
  const summary = await runAgentWork(agent, context, output);
  const now = new Date().toISOString();
  agent.status = "completed";
  agent.summary = summary;
  agent.updatedAt = now;
  agent.cost.outputTokens = Math.ceil(summary.length / 4);
  addRoleUsage(
    context,
    agent.role,
    {
      ...getRoleRoute(context.config, agent.role),
      provider: agent.provider,
      primaryModel: agent.model,
    },
    agent.cost.inputTokens,
    agent.cost.outputTokens,
    `${agent.type} agent summary`,
  );
  context.roleHandoffs.unshift(
    createRoleHandoff("executor", agent.role, agent.id, summary, context),
  );
  const verifierStatus = agent.type === "verifier" ? context.lastVerification?.status : undefined;
  task.status = "completed";
  task.result = mapAgentBackgroundResult(agent, verifierStatus);
  task.currentStep = context.language === "en-US" ? "summary ready" : "摘要已生成";
  task.progress = { completed: 1, total: 1, label: agent.type };
  task.updatedAt = now;
  task.lastOutputAt = now;
  task.nextAction =
    context.language === "en-US" ? "Review /agents show output." : "查看 /agents show 输出。";
  await context.store.appendEvent(agent.transcriptSessionId, {
    type: "assistant_text_delta",
    id: randomUUID(),
    text: summary,
    createdAt: now,
  });
  await context.store.appendEvent(parentSessionId, {
    type: "agent_end",
    agentId: agent.id,
    status: "completed",
    summary,
    createdAt: now,
  });
  await appendBackgroundTaskEvent(context, parentSessionId, task);
  writeLine(output, formatAgentSummary(agent, context));
  writeStatus(output, context);
}

// Module 4 — mapAgentBackgroundResult / findAgent / formatAgentSummary /
// 4 abort controller helpers 已移至 ./tui-agent-job-runtime.ts。
export {
  abortBackgroundTask,
  clearBackgroundAbortController,
  findAgent,
  formatAgentSummary,
  getBackgroundAbortControllers,
  mapAgentBackgroundResult,
  registerBackgroundAbortController,
} from "./tui-agent-job-runtime.js";

import {
  abortBackgroundTask,
  clearBackgroundAbortController,
  findAgent,
  formatAgentSummary,
  getBackgroundAbortControllers,
  mapAgentBackgroundResult,
  registerBackgroundAbortController,
} from "./tui-agent-job-runtime.js";

async function runAgentWork(
  agent: AgentRun,
  context: TuiContext,
  output: Writable,
): Promise<string> {
  if (agent.type === "explorer") {
    return `explorer 摘要：只读分析任务「${agent.task}」。可读取索引/证据/关键文件；不会写入。上下文已裁剪为 handoff、Todo、证据和关键文件。`;
  }
  if (agent.type === "planner") {
    return `planner 摘要：只规划任务「${agent.task}」。输出计划建议，不执行写入、Bash 或后续阶段能力。`;
  }
  if (agent.type === "verifier") {
    const plan = await createVerificationPlan(context.projectPath, "smoke");
    const report = await runVerificationPlan(plan, context, agent.transcriptSessionId, output);
    context.lastVerification = report;
    return `verifier 摘要：session-scoped conservative verification；不是 durable job、不是第二套 job system、不是 Phase 17。已在独立 transcript 中运行验证命令，结果 ${report.status.toUpperCase()}；任务「${agent.task}」。`;
  }
  return runWorkerAgent(agent, context, output);
}

async function runWorkerAgent(
  agent: AgentRun,
  context: TuiContext,
  output: Writable,
): Promise<string> {
  const match = /^write\s+(\S+)\s+([\s\S]+)$/u.exec(agent.task);
  if (!match) {
    return `worker 摘要：已接收明确子任务「${agent.task}」。worker 可编辑，但本次没有匹配低风险 write 路径，因此未改文件。所有编辑必须走权限管道。`;
  }
  const [, path, content] = match;
  const input = { path, content };
  const parentSessionId = agent.parentSessionId ?? (await ensureSession(context));
  const permission = await decidePermission("Write", input, context, parentSessionId);
  await context.store.appendEvent(parentSessionId, {
    type: "permission_request",
    request: permission.request,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(parentSessionId, {
    type: "permission_result",
    requestId: permission.request.id,
    decision: permission.decision,
    reason: permission.reason,
    createdAt: new Date().toISOString(),
  });
  if (permission.decision !== "allow") {
    return `worker 摘要：权限管道拒绝写入 ${path}。原因：${permission.reason}`;
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  const result = await runTool("Write", input, context.tools);
  await context.store.appendEvent(agent.transcriptSessionId, {
    type: "tool_call_start",
    id: randomUUID(),
    name: "Write",
    input,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(
    agent.transcriptSessionId,
    createToolEndEvent(randomUUID(), result.output),
  );
  return `worker 摘要：已通过权限管道执行低风险写入 ${path}。${result.output.text}`;
}

async function cancelAgent(agent: AgentRun, context: TuiContext, output: Writable): Promise<void> {
  const now = new Date().toISOString();
  agent.status = "cancelled";
  agent.summary = `agent ${agent.id} 已取消；主会话可继续。`;
  agent.updatedAt = now;
  const background = context.backgroundTasks.find((task) => task.id === agent.id);
  if (background) {
    background.status = "cancelled";
    background.result = "cancelled";
    background.updatedAt = now;
    background.currentStep = context.language === "en-US" ? "cancelled" : "已取消";
  }
  const parentSessionId = agent.parentSessionId ?? (await ensureSession(context));
  await context.store.appendEvent(parentSessionId, {
    type: "agent_end",
    agentId: agent.id,
    status: "cancelled",
    summary: agent.summary,
    createdAt: now,
  });
  if (background) {
    await appendBackgroundTaskEvent(context, parentSessionId, background);
  }
  writeLine(output, agent.summary);
  writeStatus(output, context);
}

// Module 4 — findAgent moved to ./tui-agent-job-runtime.ts

function formatAgentsList(context: TuiContext): string {
  if (context.agents.length === 0) {
    return context.language === "en-US"
      ? "No agents. Usage: /fork explorer|planner|verifier|worker <task>."
      : "当前没有 agent。用法：/fork explorer|planner|verifier|worker <task>。";
  }
  const lines = [context.language === "en-US" ? "Agents:" : "Agents："];
  for (const agent of context.agents) {
    const label = agent.displayName ?? deriveAgentDisplayName(agent.type, agent.task);
    lines.push(
      `${agent.id}  ${label}  type=${agent.type}  role=${agent.role}  ${agent.status}  mode=${agent.permissionMode}  tokens~${agent.cost.inputTokens + agent.cost.outputTokens}  task=${truncateDisplay(agent.task, 24)}`,
    );
  }
  lines.push(
    context.language === "en-US"
      ? "displayName is cosmetic only; role, permission mode, resource guard, evidence, and lifecycle stay unchanged."
      : "displayName 仅用于展示；role、权限模式、资源守卫、证据和生命周期不变。",
  );
  return lines.join("\n");
}

// Module 5 — formatAgentDetails 已移至 ./tui-details-runtime.ts。

// Module 4 — formatAgentSummary moved to ./tui-agent-job-runtime.ts
// (en-US/zh-CN 双分支字符串完全一致，新模块去掉冗余 ternary，行为不变)

async function handleRewindCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action || action === "list") {
    if (context.checkpoints.length === 0) {
      writeLine(output, t(context, "checkpointNone"));
      return;
    }
    writeLine(
      output,
      context.checkpoints
        .map(
          (checkpoint) =>
            `${checkpoint.id}  ${checkpoint.createdAt}  ${checkpoint.changedFiles.join(", ")}`,
        )
        .join("\n"),
    );
    return;
  }
  if (action !== "restore") {
    writeLine(output, "用法：/rewind | /rewind restore <checkpointId>");
    return;
  }
  const checkpointId = args[1] ?? context.checkpoints[0]?.id;
  if (!checkpointId) {
    writeLine(output, t(context, "checkpointNone"));
    return;
  }
  const checkpoint = context.checkpoints.find((item) => item.id === checkpointId);
  if (!checkpoint) {
    writeLine(output, `${t(context, "checkpointMissing")}：${checkpointId}`);
    return;
  }
  for (const file of checkpoint.files) {
    const target = resolve(context.projectPath, file.path);
    if (!file.existed) {
      await rm(target, { force: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content ?? "", "utf8");
  }
  context.tools.changedFiles = uniqueStrings([
    ...context.tools.changedFiles,
    ...checkpoint.changedFiles,
  ]);
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "checkpoint_restored",
    checkpointId: checkpoint.id,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, `${t(context, "checkpointRestored")}：${checkpoint.id}`);
  writeStatus(output, context);
}

async function handleBtwCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const question = args.join(" ").trim();
  if (!question) {
    writeLine(output, "用法：/btw <临时小问题>");
    return;
  }
  const answer = `${t(context, "btwPrefix")}：${question}\n${context.language === "en-US" ? "This temporary answer does not change Todo, plan, or checkpoints." : "这次临时回答不会修改 Todo、Plan 或 checkpoint。"}`;
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "btw_question",
    id: randomUUID(),
    text: question,
    answer,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, answer);
}

async function handleInterruptCommand(context: TuiContext, output: Writable): Promise<void> {
  const running = context.backgroundTasks.find((task) => task.status === "running");
  const sessionId = await ensureSession(context);
  if (context.activeVerificationAbortController) {
    context.activeVerificationAbortController.abort();
    context.activeVerificationAbortController = undefined;
    context.interrupt = { type: "idle" };
    const verificationTask = context.backgroundTasks.find(
      (task) => task.kind === "verification" && isActiveBackgroundStatus(task.status),
    );
    if (verificationTask) {
      verificationTask.status = "cancelled";
      verificationTask.result = "cancelled";
      verificationTask.updatedAt = new Date().toISOString();
      verificationTask.nextAction =
        context.language === "en-US"
          ? "Review the verification log, then rerun /verify if needed."
          : "先查看验证日志，必要时复跑 /verify。";
      await appendBackgroundTaskEvent(context, sessionId, verificationTask);
    }
    await context.store.appendEvent(sessionId, {
      type: "interrupt",
      id: randomUUID(),
      status: "cancelled",
      message: t(context, "toolInterrupted"),
      createdAt: new Date().toISOString(),
    });
    writeLine(output, t(context, "toolInterrupted"));
    return;
  }
  if (
    context.activeAbortController &&
    !(running && context.backgroundAbortControllers?.has(running.id))
  ) {
    context.activeAbortController.abort();
    clearRequestActivity(context);
    context.interrupt = { type: "idle" };
    await context.store.appendEvent(sessionId, {
      type: "interrupt",
      id: randomUUID(),
      status: "cancelled",
      message: t(context, "toolInterrupted"),
      createdAt: new Date().toISOString(),
    });
    writeLine(output, t(context, "toolInterrupted"));
    return;
  }
  if (!running) {
    await context.store.appendEvent(sessionId, {
      type: "interrupt",
      id: randomUUID(),
      status: "cancelled",
      message: t(context, "interruptIdle"),
      createdAt: new Date().toISOString(),
    });
    writeLine(output, t(context, "interruptIdle"));
    return;
  }
  const aborted = abortBackgroundTask(context, running.id);
  running.status = "cancelled";
  running.result = "cancelled";
  running.updatedAt = new Date().toISOString();
  running.nextAction = aborted
    ? context.language === "en-US"
      ? "Abort signal sent. Review /background and the log before continuing."
      : "已发送取消信号。继续前可先查看 /background 和日志。"
    : context.language === "en-US"
      ? "No live abort controller was available; state marked cancelled. Review /background."
      : "未找到可用取消 controller；仅将状态标记为 cancelled。继续前查看 /background。";
  await appendBackgroundTaskEvent(context, sessionId, running);
  await context.store.appendEvent(sessionId, {
    type: "interrupt",
    id: randomUUID(),
    status: "cancelled",
    message: aborted
      ? `${t(context, "interruptCancelled")} abortSignal=sent`
      : `${t(context, "interruptCancelled")} abortSignal=unavailable`,
    createdAt: new Date().toISOString(),
  });
  writeLine(
    output,
    aborted
      ? `${t(context, "interruptCancelled")}（已发送 AbortSignal）`
      : `${t(context, "interruptCancelled")}（未找到可用 AbortSignal，仅标记状态）`,
  );
}

// Module 4 — abort controller helpers moved to ./tui-agent-job-runtime.ts

async function handleClaimCheckCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const claim = args.join(" ").trim();
  if (!claim) {
    writeLine(output, "用法：/claim-check <claim>");
    return;
  }
  const result = checkClaimSupport(claim, context);
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "claim_check",
    id: randomUUID(),
    status: result.status,
    unsupportedClaims: result.unsupportedClaims,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, formatClaimCheck(result, context.language));
}

async function handleCacheLogCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (args[0] === "config" && args[1] === "size") {
    const size = Number.parseInt(args[2] ?? "", 10);
    if (!Number.isFinite(size) || size < MIN_CACHE_HISTORY_SIZE) {
      writeLine(output, `用法：/cache-log config size <n>，n >= ${MIN_CACHE_HISTORY_SIZE}`);
      return;
    }
    context.cache.config.maxTurns = Math.min(size, MAX_CACHE_HISTORY_SIZE);
    trimCacheHistory(context.cache);
    writeLine(
      output,
      `cache history size：${context.cache.config.maxTurns}，超过上限的旧记录已淘汰。`,
    );
    return;
  }
  if (args[0] === "export") {
    const path = args[1] ? resolve(context.projectPath, args[1]) : context.cache.config.persistPath;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(context.cache.history, null, 2)}\n`, "utf8");
    writeLine(
      output,
      `已导出最近缓存日志：${path}。用于和 provider usage 或账号账单对账，金额仍以账单为准。`,
    );
    return;
  }
  if (args.length > 0) {
    writeLine(output, "用法：/cache-log | /cache-log config size <n> | /cache-log export [path]");
    return;
  }
  writeLine(output, formatCacheLog(context));
}

async function handleCacheCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action || action === "status") {
    writeLine(output, formatCacheStatus(context));
    return;
  }
  if (action === "warmup" || action === "refresh") {
    const runtimeStatus = buildRuntimeStatusForModel({
      ...context,
      provider: getRuntimeStatusProvider(context),
    });
    const snapshot = await refreshWorkspaceReferenceCache(context, runtimeStatus);
    const freshness = getCurrentFreshness(context);
    const changedKeys = diffFreshness(context.cache.lastFreshness, freshness);
    context.cache.lastFreshness = { ...freshness, changedKeys };
    writeLine(
      output,
      action === "warmup"
        ? `已尝试预热 cache。workspace reference=${snapshot.source}；该最小路径不保证 provider 一定写入缓存，请用 /cache status 或 provider usage 对账。`
        : `已尝试刷新 cache。workspace reference=${snapshot.source}；该最小路径不保证 provider 一定写入缓存，请用 /cache status 或 provider usage 对账。`,
    );
    return;
  }
  writeLine(output, "用法：/cache status | /cache warmup | /cache refresh");
}

async function handleCompactCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    writeLine(output, formatCompactStatus(context));
    return;
  }
  if (action === "manual" || action === "run") {
    const sessionId = await ensureSession(context);
    const resumed = await context.store.resume(sessionId);
    const preChars = estimateTranscriptContextChars(resumed.transcript);
    const boundary = createManualCompactBoundary({
      preCompactChars: preChars,
      postCompactChars: Math.min(preChars, MAX_CONTEXT_CHARS),
      preservedEvidenceRefs: context.evidence.map((item) => item.id),
      preservedFiles: context.recentlyMentionedFiles,
      handoffPacketId: context.memory.lastHandoff?.id,
    });
    recordCompactBoundary(context, boundary);
    refreshCacheFreshness(context);
    writeLine(
      output,
      `Compact Lite manual boundary recorded: ${boundary.id}；不执行工具、不写项目文件、不写长期记忆、不启动后台任务。`,
    );
    writeStatus(output, context);
    return;
  }
  if (action === "auto") {
    writeLine(
      output,
      "Compact Lite auto：受控最小实现仅在 provider 请求前、本地上下文超过预算时执行 MicroCompact；有阈值、无工具、无文件写入、无额外模型调用。",
    );
    return;
  }
  writeLine(output, "用法：/compact status | /compact manual | /compact auto");
}

async function handleBreakCacheCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  // D.13F：standalone /break-cache 子命令。marker 写入与 event log 全部在 TUI/runtime 层完成；
  // packages/providers 不读不写本地文件。--clear 可放在第一个或第二个位置。
  const clearFlag = args.includes("--clear");
  if (action === "status" && !clearFlag) {
    writeLine(output, formatBreakCacheStatus(context));
    return;
  }
  if (clearFlag) {
    // /break-cache --clear 或 /break-cache <mode> --clear：清掉 once+always 两个 marker。
    await clearBreakCacheMarker(context, "all");
    await appendBreakCacheEvent(context, "cleared");
    refreshCacheFreshness(context);
    writeLine(output, "已清除 break-cache marker（once + always）。下次请求不再附加 nonce。");
    writeLine(output, formatBreakCacheStatus(context));
    return;
  }
  if (action === "once") {
    const nonce = randomUUID();
    await writeBreakCacheMarker(context, "once", nonce);
    await appendBreakCacheEvent(context, "once_set");
    refreshCacheFreshness(context);
    writeLine(output, "已设置 once：下一次模型请求将附加 cacheBreakNonce 破坏前缀缓存，命中后自动消费。");
    return;
  }
  if (action === "always") {
    const nonce = randomUUID();
    await writeBreakCacheMarker(context, "always", nonce);
    await appendBreakCacheEvent(context, "always_set");
    refreshCacheFreshness(context);
    writeLine(
      output,
      "已设置 always：固定 break-cache namespace（stable nonce），所有请求共享同一 cacheBreakNonce，相当于切到一个新的 cache 命名空间，并在该命名空间内继续命中前缀缓存；不会每次请求都破坏缓存。运行 /break-cache off 或 --clear 取消。",
    );
    return;
  }
  if (action === "off") {
    await clearBreakCacheMarker(context, "all");
    await appendBreakCacheEvent(context, "off");
    refreshCacheFreshness(context);
    writeLine(output, "已关闭 break-cache：下次请求不再附加 nonce。");
    return;
  }
  writeLine(
    output,
    "用法：/break-cache status | /break-cache once | /break-cache always | /break-cache off | /break-cache --clear",
  );
}

async function handleMcpCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    writeLine(output, formatMcpStatus(context));
    writeStatus(output, context);
    return;
  }
  if (action === "tools") {
    context.mcp.tools = stabilizeMcpToolList(context.mcp.tools);
    refreshCacheFreshness(context);
    writeLine(output, formatMcpTools(context.mcp));
    return;
  }
  if (action === "doctor") {
    await runMcpDoctor(context);
    writeLine(output, formatMcpStatus(context));
    writeStatus(output, context);
    return;
  }
  if (action === "validate") {
    writeLine(output, validateMcpServers(context, args[1]));
    return;
  }
  if (action === "add" || action === "install") {
    const result = await addMcpServer(args.slice(1), context);
    writeLine(output, result);
    return;
  }
  if (action === "enable" || action === "disable") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await setMcpServerEnabled(id, action === "enable", context)
        : `用法：/mcp ${action} <server-id>`,
    );
    return;
  }
  if (action === "remove") {
    const id = args[1];
    writeLine(output, id ? await removeMcpServer(id, context) : "用法：/mcp remove <server-id>");
    return;
  }
  if (action === "update") {
    writeLine(output, await updateMcpServer(args.slice(1), context));
    return;
  }
  writeLine(
    output,
    "用法：/mcp | /mcp status | /mcp tools | /mcp doctor | /mcp validate [id] | /mcp add local <id> <command> [args...] | /mcp update <id> local <command> [args...] | /mcp enable|disable <id> | /mcp remove <id>",
  );
}

async function handleResumeCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const sessionId = args[0] ?? (await context.store.list())[0]?.id;
  if (!sessionId) {
    writeLine(output, "还没有可恢复会话。下一步：先正常对话，或用 /sessions 查看历史。");
    return;
  }
  await resumeSessionWithHandoff(sessionId, context, output, "resume");
}

async function handleBranchCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const purpose = args.join(" ").trim() || "试验分支会话";
  const parentSessionId = context.sessionId ?? "none";
  const packet = await loadOrCreateHandoffPacket(context, parentSessionId);
  const branch = await context.store.create({
    model: context.model,
    summary: `branch from ${parentSessionId}: ${purpose}`,
  });
  const branchPacket: HandoffPacket = {
    ...packet,
    id: randomUUID(),
    sessionId: branch.id,
    projectPath: context.projectPath,
    parentSessionId,
    createdAt: new Date().toISOString(),
  };
  const missing = validateHandoffPacket(branchPacket);
  context.memory.lastHandoff = branchPacket;
  context.sessionId = branch.id;
  context.sessionEnded = false;
  await writeHandoffPacket(context, branchPacket);
  await context.store.appendEvent(branch.id, {
    type: "branch_created",
    branch: {
      id: branch.id,
      parentSessionId,
      sourceSession: parentSessionId,
      purpose,
      permissionMode: context.permissionMode,
      mustNotDo: branchPacket.mustNotDo,
      handoffReadonly: missing.length > 0,
    },
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(branch.id, {
    type: "handoff_packet",
    packet: branchPacket,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, `已创建分支会话：${branch.id}`);
  writeLine(output, `来源 session：${parentSessionId}`);
  writeLine(output, `目的：${purpose}`);
  writeLine(
    output,
    `权限边界：${context.permissionMode}；禁止事项：${branchPacket.mustNotDo.join("；")}`,
  );
  if (missing.length > 0) {
    writeLine(output, `handoff 缺少关键字段，分支按只读恢复：${missing.join(", ")}`);
  }
  refreshCacheFreshness(context);
  writeStatus(output, context);
}

async function handleMemoryCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status" || action === "list") {
    writeLine(output, formatMemoryStatus(context));
    return;
  }
  if (action === "storage") {
    writeLine(output, formatMemoryStorage(context));
    return;
  }
  if (action === "review") {
    writeLine(output, formatMemoryReview(context));
    return;
  }
  if (action === "stats") {
    writeLine(output, formatMemoryStats(context));
    return;
  }
  if (action === "learn") {
    const subAction = args[1];
    if (subAction === "on") {
      context.memory.learningMode = "active";
      const sessionId = await ensureSession(context);
      await appendSystemEvent(context, sessionId, "memory_learning_mode=active", "info");
      writeLine(
        output,
        context.language === "en-US"
          ? "Auto-learning enabled. New preferences/habits will be captured as candidates (not auto-accepted). Disable with /memory learn off."
          : "自动学习已开启。新偏好/习惯将作为候选记录（不会自动接受）。关闭：/memory learn off",
      );
      return;
    }
    if (subAction === "off") {
      context.memory.learningMode = "off";
      const sessionId = await ensureSession(context);
      await appendSystemEvent(context, sessionId, "memory_learning_mode=off", "info");
      writeLine(
        output,
        context.language === "en-US"
          ? "Auto-learning disabled. No new candidates will be generated automatically."
          : "自动学习已关闭。不再自动生成新候选记忆。",
      );
      return;
    }
    if (subAction === "status") {
      writeLine(
        output,
        context.language === "en-US"
          ? `Learning mode: ${context.memory.learningMode}; candidates=${context.memory.candidates.length}; accepted=${context.memory.accepted.length}`
          : `学习模式：${context.memory.learningMode === "active" ? "开启" : "关闭"}；候选=${context.memory.candidates.length}；已接受=${context.memory.accepted.length}`,
      );
      return;
    }
    const result = await runControlledMemoryLearning(context);
    writeLine(output, formatMemoryLearningRun(result, context.language));
    return;
  }
  if (action === "candidate") {
    const parsed = parseMemoryCandidateArgs(args.slice(1));
    if (!parsed.summary) {
      writeLine(
        output,
        "用法：/memory candidate <短小稳定记忆摘要> [--scope project|user|session]",
      );
      return;
    }
    const candidate = createMemoryCandidate(
      parsed.scope,
      parsed.summary,
      "manual /memory candidate",
      ["user:/memory candidate"],
    );
    context.memory.candidates.unshift(candidate);
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "memory_candidate",
      candidate,
      createdAt: new Date().toISOString(),
    });
    refreshCacheFreshness(context);
    writeLine(
      output,
      `已创建候选记忆：${candidate.id}。写入长期记忆前请运行 /memory review 和 /memory accept ${candidate.id}`,
    );
    return;
  }
  if (action === "accept") {
    const id = args[1];
    const candidate = context.memory.candidates.find((item) => item.id === id);
    if (!candidate) {
      writeLine(output, "未找到候选记忆。用法：/memory accept <candidate-id>");
      return;
    }
    const accepted = { ...candidate, status: "accepted" as const };
    await writeMemoryRecord(accepted, context);
    context.memory.candidates = context.memory.candidates.filter((item) => item.id !== id);
    context.memory.accepted.unshift(accepted);
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "memory_accepted",
      memory: accepted,
      createdAt: new Date().toISOString(),
    });
    await appendMemoryLifecycleEvent(context, sessionId, "accepted", accepted);
    refreshCacheFreshness(context);
    writeLine(
      output,
      `已写入${formatMemoryScope(accepted.scope)}级长期记忆：${accepted.id}；autoAccept=no，后续注入仍受 top-k/字符预算限制。`,
    );
    return;
  }
  if (action === "reject") {
    const id = args[1];
    const candidate = context.memory.candidates.find((item) => item.id === id);
    if (!candidate) {
      writeLine(output, "未找到候选记忆。用法：/memory reject <candidate-id>");
      return;
    }
    const rejected = { ...candidate, status: "rejected" as const };
    await writeMemoryRecord(rejected, context);
    context.memory.candidates = context.memory.candidates.filter((item) => item.id !== id);
    context.memory.rejected.unshift(rejected);
    const sessionId = await ensureSession(context);
    await appendMemoryLifecycleEvent(context, sessionId, "rejected", rejected);
    refreshCacheFreshness(context);
    writeLine(output, `已拒绝候选记忆：${id}；不会写入长期记忆或注入 prompt。`);
    return;
  }
  if (action === "disable") {
    const id = args[1];
    const memory = context.memory.accepted.find((item) => item.id === id);
    if (!memory) {
      writeLine(output, "未找到已接受记忆。用法：/memory disable <accepted-id>");
      return;
    }
    const disabled = { ...memory, status: "disabled" as const };
    await writeMemoryRecord(disabled, context);
    context.memory.accepted = context.memory.accepted.filter((item) => item.id !== id);
    context.memory.disabled.unshift(disabled);
    const sessionId = await ensureSession(context);
    await appendMemoryLifecycleEvent(context, sessionId, "disabled", disabled);
    refreshCacheFreshness(context);
    writeLine(output, `已禁用长期记忆：${id}；保留记录但不再注入 prompt。`);
    return;
  }
  if (action === "rollback") {
    const id = args[1];
    const memory = context.memory.disabled.find((item) => item.id === id);
    if (!memory) {
      writeLine(output, "未找到已禁用记忆。用法：/memory rollback <disabled-id>");
      return;
    }
    const accepted = { ...memory, status: "accepted" as const };
    await writeMemoryRecord(accepted, context);
    context.memory.disabled = context.memory.disabled.filter((item) => item.id !== id);
    context.memory.accepted.unshift(accepted);
    const sessionId = await ensureSession(context);
    await appendMemoryLifecycleEvent(context, sessionId, "rollback", accepted);
    refreshCacheFreshness(context);
    writeLine(output, `已回滚启用长期记忆：${id}；仍受受控 prompt 注入预算限制。`);
    return;
  }
  if (action === "delete" || action === "forget") {
    const id = args[1];
    const memory = findMemoryRecord(context.memory, id);
    if (!memory) {
      writeLine(output, "未找到该记忆。用法：/memory delete <id> 或 /memory forget <id>");
      return;
    }
    await removeMemoryRecord(memory, context);
    removeMemoryFromState(context.memory, id);
    const sessionId = await ensureSession(context);
    await appendMemoryLifecycleEvent(context, sessionId, "deleted", memory);
    refreshCacheFreshness(context);
    writeLine(output, `已删除记忆记录：${id}；不会保留在候选/长期/禁用列表。`);
    return;
  }
  if (action === "init") {
    await initLinghunMd(context, output);
    return;
  }
  if (action === "import" && args[1] === "sessions") {
    await importAiSessions(args.slice(2), context, output);
    return;
  }
  writeLine(
    output,
    "用法：/memory | /memory storage | /memory review | /memory stats | /memory learn [on|off|status] | /memory candidate <摘要> [--scope project|user|session] | /memory accept|reject|disable|rollback|delete|forget <id> | /memory init | /memory import sessions [source] [query]",
  );
}

async function resumeSessionWithHandoff(
  sessionId: string,
  context: TuiContext,
  output: Writable,
  source: "resume" | "sessions resume",
): Promise<void> {
  try {
    const resumed = await context.store.resume(sessionId);
    context.sessionId = resumed.session.id;
    context.sessionEnded = isSessionEnded(resumed.transcript);
    context.model = resumed.session.model;
    hydrateResumeContext(context, resumed.transcript);
    const packet = context.memory.lastHandoff ?? createHandoffPacket(context, resumed.transcript);
    const missing = validateHandoffPacket(packet);
    context.memory.lastResumeReadonly = missing.length > 0;
    writeLine(output, `已恢复会话：${resumed.session.id}`);
    writeLine(output, `恢复方式：${source}；不会把完整 transcript 塞回上下文。`);
    writeLine(output, formatResumePacket(packet, missing, context));
    if (context.index.status === "stale" || context.index.status === "missing") {
      writeLine(
        output,
        "索引不是 ready：建议先运行 /index status 或 /index refresh；不会自动刷新。 ",
      );
    }
    writeStatus(output, context);
  } catch (error) {
    writeLine(output, formatError(error));
  }
}

function hydrateResumeContext(context: TuiContext, transcript: TranscriptEvent[]): void {
  const latestTodo = [...transcript].reverse().find((event) => event.type === "todo_update");
  if (latestTodo?.type === "todo_update") {
    context.tools.todos = latestTodo.items.map((item) => ({ ...item }));
  }
  const latestVerification = [...transcript]
    .reverse()
    .find((event) => event.type === "verification_end");
  if (latestVerification?.type === "verification_end") {
    context.lastVerification = latestVerification.report as VerificationReport;
  }
  const evidence = transcript
    .filter(
      (event): event is Extract<TranscriptEvent, { type: "evidence_record" }> =>
        event.type === "evidence_record",
    )
    .slice(-10)
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      summary: event.summary,
      source: event.source,
      supportsClaims: event.supportsClaims,
      createdAt: event.createdAt,
    }));
  context.evidence = [...evidence.reverse(), ...context.evidence].slice(0, 20);
  const handoff = [...transcript].reverse().find((event) => event.type === "handoff_packet");
  if (handoff?.type === "handoff_packet" && isHandoffPacket(handoff.packet)) {
    context.memory.lastHandoff = handoff.packet;
  }
  refreshCacheFreshness(context);
}

async function loadOrCreateHandoffPacket(
  context: TuiContext,
  parentSessionId?: string,
): Promise<HandoffPacket> {
  if (context.memory.lastHandoff) {
    context.memory.lastHandoff.solutionCompleteness = context.solutionCompleteness;
    await writeHandoffPacket(context, context.memory.lastHandoff);
    return context.memory.lastHandoff;
  }
  const sessionId = await ensureSession(context);
  const packet = createHandoffPacket(context, [], parentSessionId, sessionId);
  context.memory.lastHandoff = packet;
  await writeHandoffPacket(context, packet);
  await context.store.appendEvent(sessionId, {
    type: "handoff_packet",
    packet,
    createdAt: new Date().toISOString(),
  });
  return packet;
}

function createHandoffPacket(
  context: TuiContext,
  transcript: TranscriptEvent[],
  parentSessionId?: string,
  sessionId = context.sessionId ?? "uncreated",
): HandoffPacket {
  const latestEvidence = context.evidence.slice(0, 8).map((item) => ({
    id: item.id,
    kind: item.kind,
    source: item.source,
    summary: item.summary,
  }));
  const transcriptTodos = [...transcript].reverse().find((event) => event.type === "todo_update");
  const todos =
    context.tools.todos.length > 0
      ? context.tools.todos
      : transcriptTodos?.type === "todo_update"
        ? transcriptTodos.items
        : [];
  return {
    id: randomUUID(),
    sessionId,
    projectPath: context.projectPath,
    ...(parentSessionId ? { parentSessionId } : {}),
    currentPhase: "Runtime readiness evidence guard",
    nextPhase:
      "Real-project Beta（blocked until explicit user confirmation and real TUI/provider evidence）",
    phaseStatus: "blocked",
    goal: "只关闭 readiness / verdict 结论层 evidence guard；不进入 Beta 或后续路线图阶段。",
    completed: [
      "runtime silent-failure guard is PASS for the tested runtime path",
      "live provider basic text smoke is PASS for the temporary-env smoke only",
      "verdict/readiness claims now require explicit scope, evidence, validation, uncovered paths, and risk",
    ],
    pending: createHandoffPendingItems(context.evidence),
    mustNotDo: [
      "不要进入 Beta，除非用户明确确认且 Beta readiness evidence guard 通过",
      "不要进入后续路线图阶段",
      "不要把 focused PASS、mock PASS、live text PASS、SKIPPED smoke 或 PARTIAL path 写成整体 ready",
      "不要把 Linghun 写成等于 CCB / 成熟工具，除非附 scope/evidence/validation/uncovered/risk",
      "不要复制 CCB / Claude Code / OpenCode 源码、内部 API 或专有实现",
      "不要让 verdict gate / coverage matrix / systemic_gap 污染普通开发请求主输出",
    ],
    todos,
    keyFiles: [
      "packages/tui/src/index.ts",
      "packages/config/src/index.ts",
      "packages/tui/src/index.test.ts",
      "packages/config/src/index.test.ts",
      "apps/cli/src/cli.ts",
      "docs/delivery/phase-14-skills-workflow.md",
    ],
    changedFiles: [...new Set(context.tools.changedFiles)],
    evidenceRefs: latestEvidence,
    verdictEvidence: createPhase15BetaVerdictScope(context.evidence, transcript),
    verification: context.lastVerification ?? null,
    risks: context.lastVerification
      ? context.lastVerification.risk
      : createHandoffRiskItems(context.evidence),
    indexStatus: {
      projectName: context.index.projectName,
      status: context.index.status,
      nodes: context.index.nodes,
      edges: context.index.edges,
      changedFiles: context.index.changedFiles,
      staleHint: context.index.staleHint,
    },
    permissionMode: context.permissionMode,
    modelProvider: { provider: getRuntimeStatusProvider(context), model: context.model },
    recentCommit: "unknown until git metadata is checked externally",
    budgetUsage:
      "local validation only; no external provider calls; status bar does not show money",
    createdAt: new Date().toISOString(),
    generatedBy: "Linghun HandoffPacket",
    solutionCompleteness: context.solutionCompleteness,
    ...(context.currentArchitectureCard
      ? { currentArchitectureCard: summarizeArchitectureCard(context.currentArchitectureCard) }
      : {}),
  };
}

function validateHandoffPacket(packet: HandoffPacket): string[] {
  const missing: string[] = [];
  if (!packet.id) missing.push("id");
  if (!packet.sessionId) missing.push("sessionId");
  if (!packet.projectPath) missing.push("projectPath");
  if (!packet.verification) missing.push("verification");
  if (packet.evidenceRefs.length === 0) missing.push("evidenceRefs");
  if (packet.mustNotDo.length === 0) missing.push("mustNotDo");
  if (!packet.indexStatus.status || packet.indexStatus.status === "unknown")
    missing.push("indexStatus");
  return missing;
}

function isHandoffPacket(value: unknown): value is HandoffPacket {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.projectPath === "string" &&
    typeof value.currentPhase === "string" &&
    typeof value.nextPhase === "string" &&
    Array.isArray(value.mustNotDo) &&
    Array.isArray(value.evidenceRefs)
  );
}

// Module 7 (tui-memory-runtime): formatProjectRulesContext moved out — see
// re-export+import block below.

function formatResumePacket(packet: HandoffPacket, missing: string[], context: TuiContext): string {
  return [
    "Resume context package（摘要，不含完整历史）：",
    `- projectRules: ${formatProjectRulesContext(context)}`,
    `- currentPhase: ${packet.currentPhase}`,
    `- phaseStatus: ${packet.phaseStatus}`,
    `- goal: ${packet.goal}`,
    `- todos: ${packet.todos.length}`,
    `- evidenceRefs: ${packet.evidenceRefs.length}`,
    `- keyFiles: ${packet.keyFiles.join(", ")}`,
    `- verification: ${packet.verification?.status ?? "missing"}`,
    `- indexStatus: ${packet.indexStatus.status}`,
    `- readonly: ${missing.length > 0 ? `yes (${missing.join(", ")})` : "no"}`,
    context.memory.projectRulesError
      ? `- projectRules warning: ${context.memory.projectRulesError}`
      : "- projectRules warning: none",
    missing.length > 0
      ? "- 下一步：补齐 handoff 关键字段或先只读检查 /index status、/memory review、/verify last。"
      : "- 下一步：可基于摘要、Todo、证据和关键文件继续。",
  ].join("\n");
}

async function writeHandoffPacket(context: TuiContext, packet: HandoffPacket): Promise<void> {
  await mkdir(context.memory.sessionDir, { recursive: true });
  await writeFile(
    join(context.memory.sessionDir, "handoff-latest.json"),
    `${JSON.stringify(packet, null, 2)}\n`,
    "utf8",
  );
}

// Module 7 (tui-memory-runtime): createMemoryCandidate / parseMemoryCandidateArgs /
// writeMemoryRecord / removeMemoryRecord / getMemoryDirectory / findMemoryRecord /
// removeMemoryFromState moved out — see re-export+import block below.

async function appendMemoryLifecycleEvent(
  context: TuiContext,
  sessionId: string,
  action: string,
  memory: MemoryCandidate,
): Promise<void> {
  await appendSystemEvent(
    context,
    sessionId,
    `memory_lifecycle action=${action} id=${memory.id} scope=${memory.scope} status=${memory.status} source=${memory.source}`,
    action === "deleted" ? "warning" : "info",
  );
}

// Module 7 (tui-memory-runtime): formatMemoryScope / formatMemoryStatus /
// formatMemoryStorage / formatMemoryReview / formatMemoryStats /
// countMemoryScopes moved out — see re-export+import block below.

async function runControlledMemoryLearning(context: TuiContext): Promise<MemoryLearningRun> {
  const candidates = createEvidenceBackedMemoryCandidates(context).slice(0, 3);
  context.memory.candidates.unshift(...candidates);
  const sessionId = await ensureSession(context);
  for (const candidate of candidates) {
    await context.store.appendEvent(sessionId, {
      type: "memory_candidate",
      candidate,
      createdAt: new Date().toISOString(),
    });
  }
  const run: MemoryLearningRun = {
    trigger: "manual",
    candidatesCreated: candidates.length,
    modelCalled: false,
    ...(candidates.length === 0
      ? { skippedReason: "no bounded evidence/todo/verification/handoff source" }
      : {}),
    createdAt: new Date().toISOString(),
  };
  context.memory.lastLearningRun = run;
  await appendSystemEvent(
    context,
    sessionId,
    `memory_learning trigger=${run.trigger} candidates=${run.candidatesCreated} modelCalled=no skipped=${run.skippedReason ?? "none"}`,
    candidates.length === 0 ? "warning" : "info",
  );
  refreshCacheFreshness(context);
  return run;
}

// Module 7 (tui-memory-runtime): createEvidenceBackedMemoryCandidates moved
// out — see re-export+import block below.

// --- D.14B Controlled Learning: secret filter + auto-learning extraction ---
// Module 7 (tui-memory-runtime): MEMORY_SECRET_PATTERNS / containsSecret /
// AutoLearningExtraction / PREFERENCE_TRIGGERS / extractLearningCandidatesFromInput
// moved out — see re-export+import block below.

export async function runAutoLearningOnTurnEnd(
  context: TuiContext,
  userInput: string,
): Promise<MemoryLearningRun> {
  if (context.memory.learningMode !== "active") {
    return {
      trigger: "manual",
      candidatesCreated: 0,
      modelCalled: false,
      skippedReason: "learning_mode=off",
      createdAt: new Date().toISOString(),
    };
  }

  const existingSummaries = new Set(
    [...context.memory.candidates, ...context.memory.accepted, ...context.memory.disabled].map(
      (item) => item.summary,
    ),
  );

  const extractions = extractLearningCandidatesFromInput(userInput, existingSummaries);
  if (extractions.length === 0) {
    return {
      trigger: "manual",
      candidatesCreated: 0,
      modelCalled: false,
      skippedReason: "no_learnable_content",
      createdAt: new Date().toISOString(),
    };
  }

  const candidates: MemoryCandidate[] = extractions.map((ext) => ({
    ...createMemoryCandidate("user", ext.summary, ext.source, ext.sourceRefs),
    inferred: true,
  }));

  context.memory.candidates.unshift(...candidates);
  const sessionId = await ensureSession(context);
  for (const candidate of candidates) {
    await context.store.appendEvent(sessionId, {
      type: "memory_candidate",
      candidate,
      createdAt: new Date().toISOString(),
    });
  }

  const run: MemoryLearningRun = {
    trigger: "evidence",
    candidatesCreated: candidates.length,
    modelCalled: false,
    createdAt: new Date().toISOString(),
  };
  context.memory.lastLearningRun = run;
  await appendSystemEvent(
    context,
    sessionId,
    `auto_learning trigger=turn_end candidates=${run.candidatesCreated} mode=active`,
    "info",
  );
  refreshCacheFreshness(context);
  return run;
}

// Module 7 (tui-memory-runtime): formatMemoryLearningRun /
// createControlledMemoryInjection / estimateMemoryTokens /
// formatControlledMemoryForModel / createLinghunMdTemplate /
// formatProjectRulesRead moved out — see re-export+import block below.

// Module 7 — consolidated re-exports + value imports for /memory + LINGHUN.md helpers
// moved to ./tui-memory-runtime.ts. Coordinators that depend on ensureSession,
// store.appendEvent, appendSystemEvent, refreshCacheFreshness or writeLine stay
// in index.ts (Path A safety valve #2).
export type { AutoLearningExtraction } from "./tui-memory-runtime.js";
export {
  containsSecret,
  countMemoryScopes,
  createControlledMemoryInjection,
  createEvidenceBackedMemoryCandidates,
  createLinghunMdTemplate,
  createMemoryCandidate,
  estimateMemoryTokens,
  extractLearningCandidatesFromInput,
  findMemoryRecord,
  formatControlledMemoryForModel,
  formatMemoryLearningRun,
  formatMemoryReview,
  formatMemoryScope,
  formatMemoryStats,
  formatMemoryStatus,
  formatMemoryStorage,
  formatProjectRulesContext,
  formatProjectRulesRead,
  getMemoryDirectory,
  parseMemoryCandidateArgs,
  removeMemoryFromState,
  removeMemoryRecord,
  writeMemoryRecord,
} from "./tui-memory-runtime.js";
import {
  containsSecret,
  countMemoryScopes,
  createControlledMemoryInjection,
  createEvidenceBackedMemoryCandidates,
  createLinghunMdTemplate,
  createMemoryCandidate,
  estimateMemoryTokens,
  extractLearningCandidatesFromInput,
  findMemoryRecord,
  formatControlledMemoryForModel,
  formatMemoryLearningRun,
  formatMemoryReview,
  formatMemoryScope,
  formatMemoryStats,
  formatMemoryStatus,
  formatMemoryStorage,
  formatProjectRulesContext,
  formatProjectRulesRead,
  getMemoryDirectory,
  parseMemoryCandidateArgs,
  removeMemoryFromState,
  removeMemoryRecord,
  writeMemoryRecord,
} from "./tui-memory-runtime.js";

async function initLinghunMd(context: TuiContext, output: Writable): Promise<void> {
  if (await pathExists(context.memory.projectRulesPath)) {
    context.memory.projectRulesExists = true;
    writeLine(output, `LINGHUN.md 已存在：${context.memory.projectRulesPath}`);
    return;
  }
  const content = createLinghunMdTemplate(context.language);
  await writeFile(context.memory.projectRulesPath, content, "utf8");
  context.memory.projectRulesExists = true;
  context.memory.projectRulesSummary = summarizeProjectRules(content);
  context.memory.projectRulesError = undefined;
  refreshCacheFreshness(context);
  writeLine(output, `已生成基础 LINGHUN.md：${context.memory.projectRulesPath}`);
}

async function importAiSessions(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const source = args[0] ?? "auto";
  const query = args.slice(1).join(" ").trim() || basename(context.projectPath);
  const summary = `AI sessions import requested: source=${source}, query=${query}. 当前 Linghun 最小入口只记录摘要和证据引用，不读取或保存敏感聊天原文；如 MCP bridge 不可用，请先配置 ai-sessions。`;
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "session_import",
    source,
    summary,
    createdAt: new Date().toISOString(),
  });
  const candidate = createMemoryCandidate(
    "project",
    `外部会话导入线索：${source} / ${query}`,
    "AI sessions import summary",
    [`ai-sessions:${source}:${query}`],
  );
  context.memory.candidates.unshift(candidate);
  refreshCacheFreshness(context);
  writeLine(output, summary);
  writeLine(output, `已创建候选记忆等待确认：${candidate.id}`);
}

async function handleIndexCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    await refreshIndexStatus(context, args.includes("--fresh"));
    writeLine(output, formatIndexStatus(context));
    writeStatus(output, context);
    return;
  }
  if (action === "doctor") {
    await refreshIndexStatus(context, true);
    writeLine(output, formatIndexStatus(context));
    writeStatus(output, context);
    return;
  }
  if (action === "check") {
    await refreshIndexStatus(context, true);
    writeLine(output, formatIndexStatus(context));
    writeStatus(output, context);
    return;
  }
  if (action === "init" && args[1] === "fast") {
    const guard = checkBackgroundStartGuard(context, "index", true);
    if (guard) {
      writeLine(output, guard);
      return;
    }
    await runIndexRepository(context, "fast", "init fast", args.includes("--force"), output);
    if (context.index.status === "ready") {
      writeLine(output, formatIndexRefreshSummary(context, "init fast"));
    }
    writeStatus(output, context);
    return;
  }
  if (action === "refresh") {
    const guard = checkBackgroundStartGuard(context, "index", true);
    if (guard) {
      writeLine(output, guard);
      return;
    }
    await runIndexRepository(
      context,
      context.config.index.mode,
      "refresh",
      args.includes("--force"),
      output,
    );
    if (context.index.status === "ready") {
      writeLine(output, formatIndexRefreshSummary(context, "refresh"));
    }
    writeStatus(output, context);
    return;
  }
  if (action === "search") {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      writeLine(output, "用法：/index search <query>");
      return;
    }
    const result = await runIndexQuery(context, "search_code", { pattern: query, limit: 5 });
    await recordIndexEvidence(context, `search ${query}`, result.summary);
    writeLine(output, result.summary);
    writeStatus(output, context);
    return;
  }
  if (action === "architecture") {
    const result = await runIndexQuery(context, "get_architecture", {});
    await recordIndexEvidence(context, "architecture", result.summary);
    writeLine(output, result.summary);
    writeStatus(output, context);
    return;
  }
  writeLine(
    output,
    "用法：/index status [--fresh] | /index doctor | /index check | /index search <query> | /index architecture（只读） | /index init fast | /index refresh（需确认）",
  );
}

export function recordModelUsage(context: TuiContext, usage: ModelUsage): CacheTurnStats {
  const executorRoute = getRoleRoute(context.config, "executor");
  addRoleUsage(context, "executor", executorRoute, usage.inputTokens, usage.outputTokens);
  const freshness = getCurrentFreshness(context);
  const changedKeys = diffFreshness(context.cache.lastFreshness, freshness);
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokensSource = classifyCacheWriteTokensSource(usage);
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  const provider = getRuntimeStatusProvider(context);
  const stats: CacheTurnStats = {
    turn: context.cache.nextTurn,
    timestamp: Date.now(),
    hitRate: computePromptCacheHitRate({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      provider,
      model: context.model,
    }),
    cacheReadTokens,
    cacheWriteTokens,
    cacheWriteTokensSource,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    model: context.model,
    provider,
    endpoint: usage.endpoint ?? CHAT_COMPLETIONS_ENDPOINT,
    source:
      usage.cacheReadTokens === undefined && usage.cacheWriteTokensRaw === undefined
        ? "estimated"
        : "api_usage",
    compacted: context.cache.compacted,
    freshness: { ...freshness, changedKeys },
    rawUsage: usage.rawUsage,
  };
  context.cache.nextTurn += 1;
  context.cache.lastFreshness = stats.freshness;
  context.cache.history.push(stats);
  trimCacheHistory(context.cache);
  return stats;
}

async function appendUsageEvents(
  context: TuiContext,
  sessionId: string,
  stats: CacheTurnStats,
): Promise<void> {
  const createdAt = new Date().toISOString();
  await context.store.appendEvent(sessionId, { type: "usage", usage: stats, createdAt });
  await context.store.appendEvent(sessionId, { type: "cache_update", stats, createdAt });
}

type CodebaseMemoryResolution = {
  command: string;
  args: string[];
  source: CodebaseMemoryBinarySource;
  status: CodebaseMemoryBinaryStatus;
  version?: string;
  detailPath?: string;
  summary: string;
};

async function resolveCodebaseMemoryBinary(context: TuiContext): Promise<CodebaseMemoryResolution> {
  const configured = context.config.mcp.servers["codebase-memory"];
  const configuredCommand = configured?.command?.trim();
  const configuredArgs = configured?.args ?? [];
  const envCommand = process.env[CODEBASE_MEMORY_ENV]?.trim();
  if (envCommand) {
    const spec = codebaseMemoryCommandSpec(envCommand, []);
    return probeCodebaseMemoryBinary(spec.command, spec.args, "env", context, spec.detailPath);
  }
  if (configuredCommand && configuredCommand !== CODEBASE_MEMORY_COMMAND) {
    const spec = codebaseMemoryCommandSpec(configuredCommand, configuredArgs);
    return probeCodebaseMemoryBinary(spec.command, spec.args, "env", context, spec.detailPath);
  }

  const managed = await findManagedCodebaseMemoryBinary(context);
  if (managed) {
    return probeCodebaseMemoryBinary(
      managed.command,
      managed.args,
      "managed",
      context,
      managed.detailPath,
    );
  }

  const pathBinary = await findPathCodebaseMemoryBinary();
  if (pathBinary) {
    return probeCodebaseMemoryBinary(
      pathBinary.command,
      pathBinary.args,
      "path",
      context,
      pathBinary.detailPath,
    );
  }

  const pathProbe = await probeCodebaseMemoryBinary(CODEBASE_MEMORY_COMMAND, [], "path", context);
  if (pathProbe.status === "missing") {
    return { ...pathProbe, source: "missing" };
  }
  return pathProbe;
}

function codebaseMemoryCommandSpec(
  command: string,
  args: string[],
): { command: string; args: string[]; detailPath: string } {
  const lowerCommand = command.toLowerCase();
  if (lowerCommand.endsWith(".cjs")) {
    return { command: process.execPath, args: [command, ...args], detailPath: command };
  }
  if (
    process.platform === "win32" &&
    (lowerCommand.endsWith(".cmd") || lowerCommand.endsWith(".bat"))
  ) {
    return {
      command: "cmd.exe",
      args: ["/d", "/c", "call", command, ...args],
      detailPath: command,
    };
  }
  if (process.platform === "win32" && lowerCommand.endsWith(".ps1")) {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args],
      detailPath: command,
    };
  }
  return { command, args, detailPath: command };
}

async function findManagedCodebaseMemoryBinary(
  context: TuiContext,
): Promise<{ command: string; args: string[]; detailPath: string } | undefined> {
  const paths = resolveStoragePaths(context.config, context.projectPath);
  const candidates = [
    join(context.projectPath, ".linghun", "bin", CODEBASE_MEMORY_COMMAND),
    join(paths.index, "bin", CODEBASE_MEMORY_COMMAND),
    join(paths.userData, "bin", CODEBASE_MEMORY_COMMAND),
  ];
  return findCodebaseMemoryBinaryCandidate(candidates);
}

async function findPathCodebaseMemoryBinary(): Promise<
  { command: string; args: string[]; detailPath: string } | undefined
> {
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = pathDirs.map((dir) => join(dir, CODEBASE_MEMORY_COMMAND));
  return findCodebaseMemoryBinaryCandidate(candidates);
}

async function findCodebaseMemoryBinaryCandidate(
  candidates: string[],
): Promise<{ command: string; args: string[]; detailPath: string } | undefined> {
  const suffixes =
    process.platform === "win32" ? [".cmd", ".exe", ".ps1", ".cjs", ""] : [".cjs", ""];
  for (const candidate of candidates) {
    for (const suffix of suffixes) {
      const path = `${candidate}${suffix}`;
      if (!(await pathExists(path))) {
        continue;
      }
      return codebaseMemoryCommandSpec(path, []);
    }
  }
  return undefined;
}

async function probeCodebaseMemoryBinary(
  command: string,
  args: string[],
  source: Exclude<CodebaseMemoryBinarySource, "missing">,
  context: TuiContext,
  detailPath = command,
): Promise<CodebaseMemoryResolution> {
  const result = await runCommandCapture(
    command,
    [...args, "--version"],
    context.projectPath,
    5_000,
  );
  if (result.errorCode === "ENOENT") {
    return {
      command,
      args,
      source,
      status: "missing",
      detailPath,
      summary: "codebase-memory binary not found",
    };
  }
  if (result.exitCode !== 0) {
    return {
      command,
      args,
      source,
      status: "corrupt",
      detailPath,
      summary: `codebase-memory --version failed: ${result.summary}`,
    };
  }
  const version = extractCodebaseMemoryVersion(result.stdout || result.stderr);
  if (!version) {
    return {
      command,
      args,
      source,
      status: "unsupported",
      detailPath,
      summary: "codebase-memory --version did not return a supported version string",
    };
  }
  return {
    command,
    args,
    source,
    status: "ready",
    version,
    detailPath,
    summary: "codebase-memory binary ready",
  };
}

function extractCodebaseMemoryVersion(output: string): string | undefined {
  const compact = output.replace(/\s+/g, " ").trim();
  const version = compact.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
  if (!version) {
    return undefined;
  }
  return version;
}

function rememberCodebaseMemoryResolution(
  context: TuiContext,
  resolution: CodebaseMemoryResolution,
): void {
  context.index.binarySource = resolution.source;
  context.index.binaryStatus = resolution.status;
  context.index.binaryVersion = resolution.version;
  context.index.binaryCommand = redactedPath(resolution.detailPath);
  context.index.runtime =
    resolution.source === "managed"
      ? "Linghun-managed codebase-memory"
      : resolution.source === "path"
        ? "external fallback from PATH"
        : resolution.source === "env"
          ? "explicit codebase-memory override"
          : "missing codebase-memory runtime";
}

function redactedPath(path: string | undefined): string {
  if (!path) {
    return "-";
  }
  return `present:${sanitizeDiagnosticText(basename(path))}`;
}

async function getCodebaseMemoryResolution(context: TuiContext): Promise<CodebaseMemoryResolution> {
  const resolution = await resolveCodebaseMemoryBinary(context);
  rememberCodebaseMemoryResolution(context, resolution);
  return resolution;
}

async function runMcpDoctor(context: TuiContext): Promise<void> {
  for (const server of context.mcp.servers) {
    if (server.status === "disabled") {
      continue;
    }
    if (server.name !== "codebase-memory") {
      const result = await runCommandCapture(
        server.command,
        ["--version"],
        context.projectPath,
        5_000,
      );
      if (result.exitCode === 0) {
        server.status = "configured";
        server.error = undefined;
        continue;
      }
      server.status = result.errorCode === "ENOENT" ? "missing" : "error";
      server.error = result.summary;
      continue;
    }
    const resolution = await getCodebaseMemoryResolution(context);
    server.command = redactedPath(resolution.detailPath);
    server.status =
      resolution.status === "ready"
        ? "configured"
        : resolution.status === "missing"
          ? "missing"
          : "error";
    server.error = resolution.status === "ready" ? undefined : resolution.summary;
  }
  context.mcp.lastDoctor = new Date().toISOString();
  // D.13J tail fix（Block A）：local stdio MCP server 走真实 tools/list 把 server 公布的工具
  // 翻译为 mcp.tools；非 local stdio（无 command / disabled / 远程）保留旧 placeholder 行为。
  // 仅把 server 真实公布的工具名进入 mcp.tools；description / inputSchema 不进入缓存
  // （由 stabilizeMcpToolList 截断 description 防 raw schema 泄露）。
  // tools/list 失败时 fall back 到 placeholder 命名以保留可见性，但 schemaLoaded=false 让
  // listMcpDeferredTools 认定为不可执行（discovery !== "discovered"），从而拒绝 ExecuteExtraTool。
  const discoveredTools: McpToolState[] = [];
  for (const server of context.mcp.servers) {
    if (server.status !== "configured") continue;
    if (server.name === "codebase-memory") {
      discoveredTools.push(...createMcpToolPlaceholders(server.name, "discovered"));
      continue;
    }
    const serverConfig = context.config.mcp.servers[server.name];
    if (!isLocalStdioMcpServer(serverConfig)) {
      // 非 local stdio：保留 placeholder 行为，executable 由 listMcpDeferredTools 在渲染时再裁决。
      discoveredTools.push(...createMcpToolPlaceholders(server.name, "discovered"));
      continue;
    }
    const listResult = await runMcpStdioToolList(
      serverConfig as McpServerConfig,
      context.projectPath,
    );
    if (listResult.ok && listResult.toolNames.length > 0) {
      for (const toolName of listResult.toolNames) {
        discoveredTools.push({
          server: server.name,
          name: toolName,
          description: `MCP tool ${server.name}:${toolName}`,
          discovery: "discovered",
          trusted: true,
          schemaLoaded: true,
          runtimeVersion: "compatible",
        });
      }
    } else {
      // tools/list 失败：暴露 server 仍可被 doctor 看见（status / error），但 deferred 入口
      // 不会标 schemaLoaded=true，因此 listMcpDeferredTools 自然过滤掉。
      discoveredTools.push({
        server: server.name,
        name: `${server.name}.status`,
        description: `MCP server tools/list failed: ${truncateDisplay(listResult.summary, 80)}`,
        discovery: "placeholder",
        trusted: false,
        schemaLoaded: false,
        runtimeVersion: "unknown",
      });
    }
  }
  context.mcp.tools = stabilizeMcpToolList(discoveredTools);
  refreshCacheFreshness(context);
}

function formatMcpStatus(context: TuiContext): string {
  const servers = context.mcp.servers.map((server) => {
    const suffix = server.error ? ` (${truncateDisplay(server.error, 80)})` : "";
    return `- ${server.name}: ${server.status} command=${redactedPath(server.command)}${suffix}`;
  });
  return [
    "MCP status",
    `- enabled: ${context.mcp.enabled ? "yes" : "no"}`,
    `- servers: ${context.mcp.servers.length}`,
    `- tools(stable): ${context.mcp.tools.length}`,
    `- lastDoctor: ${context.mcp.lastDoctor ?? "not run"}`,
    ...servers,
    `- codebase-memory source=${context.index.binarySource ?? "unknown"}`,
    `- codebase-memory binary=${context.index.binaryStatus ?? "unknown"} version=${context.index.binaryVersion ?? "-"}`,
    `- runtime: ${context.index.runtime ?? "Linghun-managed codebase-memory or external fallback"}`,
    "- guard: codebase-memory deferred tools currently require Linghun static registry + required args before CLI execution; unknown or incomplete tool calls are rejected.",
    "- guard: extension-contributed MCP/skill/plugin tools must pass discovery + trust + schemaLoaded + compatible runtime before execution.",
    "- license/NOTICE: Linghun-managed codebase-memory must be shipped with license/NOTICE metadata; external fallback is reported as external, not bundled.",
    "- note: MCP/codebase-memory 启动或检测失败会隔离，不影响普通聊天、本地工具和 cache/status。",
  ].join("\n");
}

function validateMcpServers(context: TuiContext, id?: string): string {
  const servers = id
    ? context.mcp.servers.filter((server) => server.name === id)
    : context.mcp.servers;
  if (servers.length === 0) {
    return id ? `未找到 MCP server：${id}` : "没有 MCP server 配置。";
  }
  return [
    "MCP validate",
    ...servers.map((server) => {
      const config = context.config.mcp.servers[server.name];
      const problems = [];
      if (!config) problems.push("not registered");
      if (server.status === "disabled") problems.push("disabled");
      if (server.status === "missing") problems.push("missing binary");
      if (server.status === "error") problems.push("doctor error");
      if (config?.trustLevel === "untrusted") problems.push("untrusted");
      return `- ${server.name}: ${problems.length === 0 ? "ok" : problems.join("; ")} source=${config?.sourceUrl ? sanitizeDiagnosticText(config.sourceUrl) : redactedPath(config?.localPath ?? config?.command)} ref=${config?.ref ?? "-"} commit=${config?.commit ?? "-"} permissions=${config?.permissionSummary ?? "tool-discovery"} next=${problems.length === 0 ? "tools/status available" : "run /mcp doctor, then validate/enable after fixing"}`;
    }),
  ].join("\n");
}

async function addMcpServer(args: string[], context: TuiContext): Promise<string> {
  const [source, id, command, ...commandArgs] = args;
  if (source !== "local" || !id || !command) {
    return [
      "MCP add（Connect Lite）",
      "- usage: /mcp add local <server-id> <command> [args...]",
      "- 本阶段 MCP 只支持本地 command 注册；Git/GitHub install 只用于 skills/plugins。",
      "- add 只写来源/权限记录，不执行 server；运行 /mcp doctor 才做受控 --version 诊断。",
    ].join("\n");
  }
  const server: McpServerConfig = {
    command,
    args: commandArgs,
    localPath: command,
    scope: "project",
    installedAt: new Date().toISOString(),
    disabled: true,
    trustLevel: "untrusted",
    permissionSummary: "tool-discovery",
  };
  context.config = await saveMcpServerConfig(id, server, false, context.projectPath);
  context.mcp = createMcpState(context.config);
  refreshCacheFreshness(context);
  return `已添加 MCP server：${id}；默认 untrusted/disabled，未执行 server。下一步运行 /mcp validate ${id} 或 /mcp doctor；确认信任后再运行 /mcp enable ${id}。`;
}

async function setMcpServerEnabled(
  id: string,
  enabled: boolean,
  context: TuiContext,
): Promise<string> {
  const current = context.config.mcp.servers[id];
  if (!current) {
    return `未找到 MCP server：${id}`;
  }
  const nextTrustLevel = enabled ? "trusted" : "disabled";
  context.config = await saveMcpServerConfig(
    id,
    { ...current, disabled: !enabled, trustLevel: nextTrustLevel },
    enabled,
    context.projectPath,
  );
  context.mcp = createMcpState(context.config);
  refreshCacheFreshness(context);
  const trustNotice = enabled
    ? "Trust notice：即将启用本地 MCP server；Linghun 不会在 enable 时执行 server，但后续 tools/call 仍必须经过 discovery/schema/required-args 和权限管道。"
    : "";
  return [
    trustNotice,
    `${enabled ? "已启用" : "已禁用"} MCP server：${id}；失败可通过 /mcp doctor 隔离诊断。`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function updateMcpServer(args: string[], context: TuiContext): Promise<string> {
  const [id, source, command, ...commandArgs] = args;
  const current = id ? context.config.mcp.servers[id] : undefined;
  if (!id || source !== "local" || !command) {
    return "用法：/mcp update <server-id> local <command> [args...]；Connect Lite 不执行 server，只更新 metadata。";
  }
  if (!current) {
    return `未找到 MCP server：${id}`;
  }
  const server: McpServerConfig = {
    ...current,
    command,
    args: commandArgs,
    localPath: command,
    installedAt: new Date().toISOString(),
    disabled: current.disabled ?? !context.config.mcp.enabledServers.includes(id),
    trustLevel: current.trustLevel ?? (current.disabled ? "disabled" : "untrusted"),
    permissionSummary: current.permissionSummary ?? "tool-discovery",
  };
  context.config = await saveMcpServerConfig(id, server, !server.disabled, context.projectPath);
  context.mcp = createMcpState(context.config);
  refreshCacheFreshness(context);
  return `已更新 MCP server：${id}；只更新本地 command metadata，未执行 server。下一步运行 /mcp validate ${id} 或 /mcp doctor。`;
}

async function removeMcpServer(id: string, context: TuiContext): Promise<string> {
  if (!context.config.mcp.servers[id]) {
    return `未找到 MCP server：${id}`;
  }
  context.config = await removeMcpServerConfig(id, context.projectPath);
  context.mcp = createMcpState(context.config);
  refreshCacheFreshness(context);
  return `已移除 MCP server：${id}；已有普通聊天和本地工具不受影响。`;
}

async function refreshIndexStatus(context: TuiContext, fresh = false): Promise<void> {
  const resolution = await getCodebaseMemoryResolution(context);
  if (resolution.status !== "ready") {
    context.index.status = "missing";
    context.index.artifactStatus = "unknown";
    context.index.error = `${resolution.summary}。普通聊天不受影响；如需索引，请配置 ${CODEBASE_MEMORY_ENV} 或安装 Linghun-managed codebase-memory。`;
    context.index.projectName = undefined;
    context.index.projectSelectionSource = "missing";
    context.index.safetyRiskyFiles = undefined;
    context.index.safetyAction = undefined;
    return;
  }

  const projects = await runCodebaseMemoryCli(context, "list_projects", {}, context.projectPath);
  if (!projects.ok) {
    context.index.status = projects.errorCode === "ENOENT" ? "missing" : "error";
    context.index.artifactStatus = projects.errorCode === "ENOENT" ? "missing" : "corrupt";
    context.index.error = projects.summary;
    context.index.projectName = undefined;
    context.index.projectSelectionSource = "missing";
    context.index.safetyRiskyFiles = undefined;
    context.index.safetyAction = undefined;
    return;
  }
  const project = findCurrentIndexProject(projects.data, context.projectPath);
  if (!project) {
    context.index.status = "missing";
    context.index.artifactStatus = "missing";
    context.index.artifactPath = undefined;
    context.index.projectName = undefined;
    context.index.projectSelectionSource = "missing";
    context.index.error = "未找到当前项目索引。请运行 /index init fast 建立索引。";
    context.index.safetyRiskyFiles = undefined;
    context.index.safetyAction = undefined;
    return;
  }
  context.index.projectName = project.name;
  context.index.artifactPath = project.rootPath;
  context.index.projectSelectionSource = project.source;
  const status = await runCodebaseMemoryCli(
    context,
    "index_status",
    { project: project.name },
    context.projectPath,
  );
  if (!status.ok) {
    context.index.status = "error";
    context.index.artifactStatus = "corrupt";
    context.index.error = status.summary;
    context.index.safetyRiskyFiles = undefined;
    context.index.safetyAction = undefined;
    return;
  }
  const data = status.data as { status?: string; nodes?: number; edges?: number };
  context.index.status = data.status === "ready" ? "ready" : "stale";
  context.index.artifactStatus = data.status === "ready" ? "ready" : "stale";
  context.index.nodes = data.nodes;
  context.index.edges = data.edges;
  context.index.error = undefined;
  context.index.changedFiles = undefined;
  context.index.staleHint = fresh
    ? undefined
    : "fast status：未运行 detect_changes；需要新鲜度检查请用 /index status --fresh 或 /index check。";
  context.index.safetyWarning = undefined;
  context.index.safetyRiskyFiles = undefined;
  context.index.safetyAction = undefined;
  if (fresh) {
    await refreshIndexStaleHint(context, project.name);
  }
}

async function refreshIndexStaleHint(context: TuiContext, projectName: string): Promise<void> {
  const changes = await runCodebaseMemoryCli(
    context,
    "detect_changes",
    { project: projectName },
    context.projectPath,
    15_000,
  );
  if (!changes.ok) {
    context.index.staleHint = `detect_changes 不可用：${changes.summary}。/index status 仍按 index_status 展示；不会自动刷新。`;
    return;
  }
  const data = changes.data as { changed_count?: number; changed_files?: unknown[] };
  const changedCount =
    typeof data.changed_count === "number"
      ? data.changed_count
      : Array.isArray(data.changed_files)
        ? data.changed_files.length
        : 0;
  context.index.changedFiles = changedCount;
  if (changedCount > 0) {
    context.index.status = "stale";
    context.index.artifactStatus = "stale";
    context.index.staleHint = `detect_changes 发现 ${changedCount} 个变更文件，建议运行 /index refresh；不会自动刷新。`;
    return;
  }
  context.index.staleHint = "detect_changes 未发现变更；/index refresh 仍只在用户显式执行时运行。";
}

async function runIndexRepository(
  context: TuiContext,
  mode: "fast" | "moderate" | "full",
  actionLabel: "init fast" | "refresh",
  force: boolean,
  output: Writable,
): Promise<void> {
  writeLine(output, "Index: scanning safety risks...");
  const safety = await scanIndexSafety(context.projectPath);
  if (!force && safety.riskyFiles.length > 0) {
    context.index.status = "stale";
    context.index.safetyWarning = formatIndexSafetyWarning(safety, actionLabel, "primary");
    context.index.safetyRiskyFiles = safety.riskyFiles;
    context.index.safetyAction = actionLabel;
    context.index.error =
      "索引前发现未排除的大文件风险；请更新 .linghunignore/.cbmignore，或显式追加 --force。";
    await recordIndexEvidence(
      context,
      `safety:${actionLabel}`,
      formatIndexSafetyWarning(safety, actionLabel, "details"),
      safety.riskyFiles.map((file) => `risky_file:${file.path}`),
    );
    writeLine(output, context.index.safetyWarning);
    return;
  }
  context.index.safetyWarning =
    safety.riskyFiles.length > 0
      ? formatIndexSafetyWarning(safety, actionLabel, "primary")
      : undefined;
  context.index.safetyRiskyFiles = safety.riskyFiles.length > 0 ? safety.riskyFiles : undefined;
  context.index.safetyAction = safety.riskyFiles.length > 0 ? actionLabel : undefined;
  context.index.error = undefined;
  context.index.status = "indexing";
  const now = new Date().toISOString();
  const task: BackgroundTaskState = {
    id: `index-${randomUUID().slice(0, 8)}`,
    kind: "index",
    title: `Index ${actionLabel}`,
    status: "running",
    currentStep: "index_repository",
    progress: { completed: 0, total: 1, label: "index" },
    startedAt: now,
    updatedAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    userVisibleSummary: `索引${actionLabel === "refresh" ? "刷新" : "初始化"}正在执行。`,
    nextAction: "等待完成，或用 /interrupt 标记取消后检查 /index status。",
  };
  const sessionId = await ensureSession(context);
  rememberBackgroundTask(context, task);
  await appendBackgroundTaskEvent(context, sessionId, task);
  writeLine(
    output,
    context.language === "en-US"
      ? `Index ${actionLabel}: running...`
      : `索引${actionLabel === "refresh" ? "刷新" : "初始化"}：正在执行...`,
  );
  const result = await runCodebaseMemoryCli(
    context,
    "index_repository",
    { repo_path: context.projectPath, mode, persistence: true },
    context.projectPath,
    120_000,
  );
  const endedAt = new Date().toISOString();
  task.updatedAt = endedAt;
  task.lastOutputAt = endedAt;
  task.hasOutput = Boolean(result.ok || result.summary);
  if (!result.ok) {
    context.index.status = result.errorCode === "ENOENT" ? "missing" : "error";
    context.index.error = `${result.summary}。请确认已安装 codebase-memory-mcp，或检查 .linghunignore 排除大 JSON/SQL/XML/min.js/生成物后重试。`;
    task.status = result.summary.includes("命令超时") ? "timeout" : "failed";
    task.result = task.status === "timeout" ? "timeout" : "fail";
    task.currentStep = task.status === "timeout" ? "timeout" : "index failed";
    task.progress = { completed: 1, total: 1, label: "index" };
    task.userVisibleSummary = `Index ${task.status}: ${context.index.error}`;
    task.nextAction = "查看 /index status，修复 runtime/artifact 后重试；不得声称索引刷新成功。";
    await appendBackgroundTaskEvent(context, sessionId, task);
    writeLine(output, `Index: ${context.index.status}. ${context.index.error}`);
    return;
  }
  await refreshIndexStatus(context);
  task.status = "completed";
  task.result = "pass";
  task.currentStep = "index finished";
  task.progress = { completed: 1, total: 1, label: "index" };
  task.userVisibleSummary = `Index ${actionLabel} completed: ${context.index.status}`;
  task.nextAction = "用 /index status 查看详情；需要新鲜度检查时用 /index status --fresh。";
  await appendBackgroundTaskEvent(context, sessionId, task);
}

async function runIndexQuery(
  context: TuiContext,
  tool: "search_code" | "get_architecture",
  input: Record<string, unknown>,
): Promise<{ summary: string }> {
  await refreshIndexStatus(context);
  if (context.index.status !== "ready" || !context.index.projectName) {
    const summary = formatIndexStatus(context);
    return { summary };
  }
  const result = await runCodebaseMemoryCli(
    context,
    tool,
    { project: context.index.projectName, ...input },
    context.projectPath,
  );
  if (!result.ok) {
    context.index.status = result.errorCode === "ENOENT" ? "missing" : "error";
    context.index.error = result.summary;
    return { summary: formatIndexStatus(context) };
  }
  const summary = summarizeIndexResult(tool, result.data);
  context.index.lastQuery = tool === "search_code" ? String(input.pattern ?? "") : "architecture";
  context.index.lastSummary = summary;
  return { summary };
}

async function recordIndexEvidence(
  context: TuiContext,
  query: string,
  summary: string,
  supportsClaims: string[] = [],
): Promise<void> {
  const sessionId = await ensureSession(context);
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind: "index_query",
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 160),
    source: `codebase-memory:${context.index.projectName ?? "unknown"}:${query}`,
    supportsClaims: ["index_query", query, ...supportsClaims],
    createdAt: new Date().toISOString(),
  };
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
}

function formatIndexStatus(context: TuiContext): string {
  const suggestion =
    context.index.binaryStatus && context.index.binaryStatus !== "ready"
      ? `建议：配置 ${CODEBASE_MEMORY_ENV}，或安装/修复 Linghun-managed codebase-memory；普通聊天不受影响。`
      : context.index.status === "missing"
        ? context.index.error
          ? "建议：确认 codebase-memory artifact 是否存在；可显式运行 /index init fast。普通聊天不受影响。"
          : "建议：运行 /index init fast 建立索引；如仓库很大，先用 .linghunignore 排除大 JSON、SQL、XML、min.js 和生成物。"
        : context.index.status === "stale"
          ? "建议：运行 /index refresh 刷新索引；不会自动重建。"
          : context.index.status === "error"
            ? "建议：修复 codebase-memory runtime/artifact 后重试 /index doctor 或 /index status。"
            : "建议：可用 /index search <query> 或 /index architecture 获取短结果；新鲜度检查用 /index status --fresh 或 /index check。";
  return [
    "Index status",
    `- enabled: ${context.index.enabled ? "yes" : "no"}`,
    `- project: ${context.index.projectName ?? basename(context.projectPath)}`,
    `- project selection: ${context.index.projectSelectionSource ?? (context.index.projectName ? "root_path" : "missing")}`,
    `- status: ${context.index.status}`,
    `- source=${context.index.binarySource ?? "unknown"}`,
    `- binary status: ${context.index.binaryStatus ?? "unknown"}`,
    `- binary command: ${context.index.binaryCommand ?? "-"}`,
    `- version: ${context.index.binaryVersion ?? "-"}`,
    `- artifact status: ${context.index.artifactStatus ?? "unknown"}`,
    `- artifactPath(details): ${redactedPath(context.index.artifactPath)}`,
    `- runtime: ${context.index.runtime ?? "Linghun-managed codebase-memory or external fallback"}`,
    `- nodes/edges: ${context.index.nodes ?? "-"}/${context.index.edges ?? "-"}`,
    `- changedFiles: ${context.index.changedFiles ?? "-"}`,
    `- staleHint: ${context.index.staleHint ? truncateDisplay(context.index.staleHint, 160) : "-"}`,
    `- safety: ${context.index.safetyRiskyFiles?.length ? `pending risky files=${context.index.safetyRiskyFiles.length}` : "-"}`,
    `- error: ${context.index.error ? truncateDisplay(context.index.error, 120) : "-"}`,
    `- lastQuery: ${context.index.lastQuery ?? "-"}`,
    `- next action: ${suggestion}`,
  ].join("\n");
}

function formatIndexRefreshSummary(
  context: TuiContext,
  actionLabel: "init fast" | "refresh" = "refresh",
): string {
  const title = actionLabel === "refresh" ? "Index refresh completed" : "Index init completed";
  const titleZh = actionLabel === "refresh" ? "索引刷新完成" : "索引初始化完成";
  if (context.language === "en-US") {
    return [
      title,
      `- status: ${context.index.status}`,
      "- details: run /index status for the full index status view.",
    ].join("\n");
  }
  return [
    titleZh,
    `- 状态：${context.index.status}`,
    "- 详情：输入 /index status 查看完整索引状态。",
  ].join("\n");
}

function summarizeIndexResult(tool: "search_code" | "get_architecture", data: unknown): string {
  if (tool === "get_architecture" && isRecord(data)) {
    return [
      "Index architecture（短摘要）",
      `- project: ${String(data.project ?? "unknown")}`,
      `- nodes/edges: ${String(data.total_nodes ?? "-")}/${String(data.total_edges ?? "-")}`,
      `- node labels: ${summarizeNamedCounts(data.node_labels)}`,
      `- edge types: ${summarizeNamedCounts(data.edge_types)}`,
    ].join("\n");
  }
  if (isRecord(data)) {
    const raw = Array.isArray(data.results) ? data.results : [];
    const matches = raw
      .slice(0, 5)
      .map((item, index) => `- #${index + 1} ${summarizeIndexSearchItem(item)}`);
    return [
      "Index search（短摘要，最多 5 条）",
      `- total: ${String(data.total_results ?? raw.length)}`,
      ...matches,
      matches.length === 0
        ? "- no matches"
        : "- truncated: full source is not dumped into transcript/status bar.",
    ].join("\n");
  }
  return `Index result: ${truncateDisplay(stableStringify(data), 500)}`;
}

function summarizeIndexSearchItem(item: unknown): string {
  if (!isRecord(item)) {
    return truncateDisplay(String(item), 120);
  }
  const path = String(item.path ?? item.file ?? item.file_path ?? "unknown");
  const symbol = item.symbol ?? item.name ?? item.qualified_name;
  const kind = item.kind ?? item.type ?? item.label;
  const parts = [`path=${truncateDisplay(path, 80)}`];
  if (symbol !== undefined) {
    parts.push(`symbol=${truncateDisplay(String(symbol), 60)}`);
  }
  if (kind !== undefined) {
    parts.push(`kind=${truncateDisplay(String(kind), 40)}`);
  }
  return parts.join(" ");
}

function summarizeNamedCounts(value: unknown): string {
  if (!Array.isArray(value)) {
    return "-";
  }
  return value
    .slice(0, 6)
    .map((item) => {
      if (!isRecord(item)) {
        return truncateDisplay(String(item), 32);
      }
      return `${String(item.label ?? item.type ?? item.name ?? "?")}=${String(item.count ?? "?")}`;
    })
    .join(", ");
}

type IndexSafetyResult = {
  riskyFiles: IndexSafetyFile[];
  truncated: boolean;
};

async function scanIndexSafety(projectPath: string): Promise<IndexSafetyResult> {
  const ignorePatterns = await readIndexIgnorePatterns(projectPath);
  const riskyFiles: IndexSafetyFile[] = [];
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    if (riskyFiles.length >= LARGE_INDEX_FILE_LIMIT) {
      truncated = true;
      return;
    }
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (riskyFiles.length >= LARGE_INDEX_FILE_LIMIT) {
        truncated = true;
        return;
      }
      const absolutePath = join(directory, entry.name);
      const relativePath = normalizePath(relative(projectPath, absolutePath));
      if (!relativePath || isIgnoredIndexPath(relativePath, ignorePatterns)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (INDEX_SCAN_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        if (LARGE_INDEX_RISK_DIRS.has(entry.name)) {
          riskyFiles.push({
            path: `${relativePath}/`,
            size: 0,
            reason: "generated/dependency directory",
          });
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const fileRisk = getIndexFileRisk(relativePath);
      if (!fileRisk) {
        continue;
      }
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(absolutePath);
      } catch {
        continue;
      }
      if (fileStat.size < LARGE_INDEX_FILE_BYTES) {
        continue;
      }
      riskyFiles.push({ path: relativePath, size: fileStat.size, reason: fileRisk });
    }
  }

  await visit(projectPath);
  return { riskyFiles, truncated };
}

async function readIndexIgnorePatterns(projectPath: string): Promise<string[]> {
  const patterns: string[] = [];
  for (const fileName of [".linghunignore", ".cbmignore"]) {
    try {
      const text = await readFile(join(projectPath, fileName), "utf8");
      patterns.push(
        ...text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith("#"))
          .map((line) => normalizePath(line)),
      );
    } catch {
      // Ignore file is optional; missing or unreadable files must not break /index commands.
    }
  }
  return patterns;
}

function isIgnoredIndexPath(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\//, "");
    if (!normalized) {
      return false;
    }
    if (normalized.endsWith("/")) {
      return relativePath.startsWith(normalized);
    }
    if (normalized.includes("*")) {
      const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
      return (
        new RegExp(`^${escaped}$`).test(relativePath) ||
        new RegExp(`(^|/)${escaped}$`).test(relativePath)
      );
    }
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

function getIndexFileRisk(relativePath: string): string | null {
  const fileName = basename(relativePath);
  const extension = extname(relativePath).toLowerCase();
  const segments = relativePath.split("/");
  if (fileName.endsWith(".min.js")) {
    return "minified javascript";
  }
  if (LARGE_INDEX_RISK_EXTENSIONS.has(extension)) {
    return `${extension} file`;
  }
  if (segments.some((segment) => LARGE_INDEX_RISK_DIRS.has(segment))) {
    return "generated/resource directory";
  }
  return null;
}

function formatIndexSafetyWarning(
  safety: IndexSafetyResult,
  actionLabel: "init fast" | "refresh",
  layer: "primary" | "details" = "primary",
): string {
  const hiddenCount = safety.riskyFiles.length;
  if (layer === "primary") {
    return [
      `索引安全门：/index ${actionLabel} 发现 ${hiddenCount} 项未排除的大文件风险，默认阻止索引。`,
      "阻塞原因：大 JSON/SQL/XML/min.js/生成物会显著放大索引成本和噪声。",
      "主屏不展开完整风险清单；完整清单已写入 transcript/evidence。",
      "建议 ignore 文件：.linghunignore 或 .cbmignore",
      "修复路径：可以用自然语言要求排除这些大文件并更新索引；写入 ignore 文件仍会进入权限管道。",
      "重试命令：/index refresh",
      "如确认要继续，可显式追加 --force。",
    ].join("\n");
  }

  const files = safety.riskyFiles.map((file) => {
    const size = file.size > 0 ? `${formatBytes(file.size)}, ` : "";
    return `- ${file.path} (${size}${file.reason})`;
  });
  const ignoreEntries = safety.riskyFiles.map((file) => `  ${file.path}`);
  return [
    `索引安全门详情：/index ${actionLabel} 发现未排除的大文件风险。`,
    "阻塞原因：大 JSON/SQL/XML/min.js/生成物会显著放大索引成本和噪声。",
    ...files,
    safety.truncated ? `- 仅记录前 ${LARGE_INDEX_FILE_LIMIT} 项风险文件。` : "",
    "建议 ignore 文件：.linghunignore 或 .cbmignore",
    "建议加入条目：",
    ...ignoreEntries,
    "修复路径：可以用自然语言要求排除这些大文件并更新索引；写入 ignore 文件仍会进入权限管道。",
    "重试命令：/index refresh",
    "如确认要继续，可显式追加 --force。",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1_000)} KB`;
}

async function runCodebaseMemoryCli(
  context: TuiContext,
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
  timeoutMs = 30_000,
): Promise<{ ok: true; data: unknown } | { ok: false; summary: string; errorCode?: string }> {
  const guard = validateCodebaseMemoryToolExecution(tool, input);
  if (!guard.ok) {
    return { ok: false, summary: guard.summary };
  }
  const resolution = await getCodebaseMemoryResolution(context);
  if (resolution.status !== "ready") {
    return { ok: false, summary: resolution.summary, errorCode: resolution.status };
  }
  const result = await runCommandCapture(
    resolution.command,
    [...resolution.args, "cli", tool, JSON.stringify(input)],
    cwd,
    timeoutMs,
  );
  if (result.exitCode !== 0) {
    return { ok: false, summary: result.summary, errorCode: result.errorCode };
  }
  const jsonLine = [...result.stdout.trim().split(/\r?\n/)]
    .reverse()
    .find((line) => line.trim().startsWith("{"));
  if (!jsonLine) {
    return { ok: false, summary: "codebase-memory-mcp 未返回 JSON。" };
  }
  try {
    return { ok: true, data: JSON.parse(jsonLine) };
  } catch (error) {
    return { ok: false, summary: `无法解析 codebase-memory-mcp 输出：${formatError(error)}` };
  }
}

function codebaseMemoryRequiredArgs(): Record<string, string[]> {
  return {
    list_projects: [],
    index_status: ["project"],
    detect_changes: ["project"],
    index_repository: ["repo_path"],
    search_code: ["project", "pattern"],
    get_architecture: ["project"],
    get_code_snippet: ["project", "qualified_name"],
    query_graph: ["project", "query"],
    trace_path: ["project", "from", "to"],
    search_graph: ["project", "query"],
  };
}

// D.13J Block 3 — codebase-memory 工具 risk 分层。
// readonly = 只读查询，无 session 权限门槛；mutating = 可能写入索引/触发昂贵操作，
// 必须显式权限授予。order: whitelist → required-args → permission gate → spawn。
function codebaseMemoryRiskClass(): Record<string, "readonly" | "mutating"> {
  return {
    list_projects: "readonly",
    index_status: "readonly",
    search_code: "readonly",
    get_architecture: "readonly",
    get_code_snippet: "readonly",
    query_graph: "readonly",
    trace_path: "readonly",
    search_graph: "readonly",
    index_repository: "mutating",
    detect_changes: "mutating",
  };
}

export function getCodebaseMemoryToolRisk(
  tool: string,
): "readonly" | "mutating" | "unknown" {
  return codebaseMemoryRiskClass()[tool] ?? "unknown";
}

export function validateCodebaseMemoryToolExecution(
  tool: string,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; summary: string } {
  const requiredArgs = codebaseMemoryRequiredArgs();
  if (!(tool in requiredArgs)) {
    return {
      ok: false,
      summary: `MCP deferred tool guard: ${tool} 尚未经过 discovery/schema/trust/runtime 登记，已拒绝执行。请先运行 /mcp doctor 或使用已发现且可信的工具入口。`,
    };
  }
  const missing = requiredArgs[tool]?.filter(
    (key) => input[key] === undefined || input[key] === null || input[key] === "",
  );
  if (missing && missing.length > 0) {
    return {
      ok: false,
      summary: `MCP deferred tool guard: ${tool} 缺少 required args：${missing.join(", ")}。已拒绝盲执行。`,
    };
  }
  return { ok: true };
}

// ===========================================================================
// D.13I — Self-built deferred tools dispatch
// ---------------------------------------------------------------------------
// SearchExtraTools / ExecuteExtraTool 是 Linghun 自研的 deferred 调用层。模型必须
// 先调用 SearchExtraTools 获得 executable=true 的工具，再用 ExecuteExtraTool 调用。
// 不发 Anthropic defer_loading / tool_reference / anthropic-beta；不新建 runner；
// 仍走既有 permission / tool_result / evidence / continuation 链路。
// 执行分层：
//   - codebase-memory：白名单 10 个工具，复用 runCodebaseMemoryCli + validateCodebaseMemoryToolExecution
//   - MCP server tools：仅 schemaLoaded+trusted+server.enabled 时 discoverable；本阶段
//     不接通用 MCP 调用 adapter，所以 executable=false
//   - skills：discover trusted manifest，autoExecute=no，executable=false
//   - plugins：discover trusted manifest contribution，autoExecute=no，executable=false
// ===========================================================================

export type DeferredToolKind = "codebase-memory" | "mcp" | "skill" | "plugin";

export type DeferredToolDescriptor = {
  name: string;
  kind: DeferredToolKind;
  description: string;
  requiredArgs: string[];
  executable: boolean;
  reason: string;
};

export type DeferredToolDiscoverySnapshot = {
  generatedAt: string;
  total: number;
  byKind: Record<DeferredToolKind, number>;
  executableCount: number;
  tools: DeferredToolDescriptor[];
};

const CODEBASE_MEMORY_DESCRIPTIONS: Record<string, string> = {
  list_projects: "List indexed projects in codebase-memory.",
  index_status: "Get current index status (nodes/edges/status) for a project.",
  detect_changes: "Detect uncovered file changes for a project's index.",
  index_repository: "Build or refresh the codebase-memory index for a repo path.",
  search_code: "Pattern search across an indexed project.",
  get_architecture: "Project architecture summary (modules, entry points).",
  get_code_snippet: "Read a code snippet by qualified name in an indexed project.",
  query_graph: "Run a graph query (CALLS / IMPORTS) on an indexed project.",
  trace_path: "Trace a function call chain from -> to in an indexed project.",
  search_graph: "Find similar implementations / SIMILAR_TO entries in a project.",
};

function listCodebaseMemoryDeferredTools(): DeferredToolDescriptor[] {
  const required = codebaseMemoryRequiredArgs();
  return Object.keys(required)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      kind: "codebase-memory" as const,
      description: CODEBASE_MEMORY_DESCRIPTIONS[name] ?? `codebase-memory tool: ${name}`,
      requiredArgs: [...required[name]],
      executable: true,
      reason: "codebase-memory static whitelist; required args validated before execution.",
    }));
}

function listMcpDeferredTools(context: TuiContext): DeferredToolDescriptor[] {
  if (!context.mcp.enabled) return [];
  const enabledServers = new Set(
    context.mcp.servers
      .filter((server) => server.status !== "disabled" && server.status !== "missing")
      .map((server) => server.name),
  );
  return context.mcp.tools
    .filter((tool) => enabledServers.has(tool.server))
    .filter((tool) => tool.discovery === "discovered")
    .filter((tool) => tool.schemaLoaded === true)
    .filter((tool) => tool.trusted === true)
    .map((tool) => {
      // D.13J Block 4 — local stdio MCP runtime adapter.
      // Server is executable iff它在 config 里且有 command（即本地 stdio 启动方式）。
      // 远程/HTTP MCP 仍保持 executable=false：这是 D.13J Block 4 的明确范围边界。
      const serverConfig = context.config.mcp.servers[tool.server];
      const localStdio = isLocalStdioMcpServer(serverConfig);
      return {
        name: `mcp:${tool.server}:${tool.name}`,
        kind: "mcp" as const,
        // truncate is already enforced by stabilizeMcpToolList; do not echo raw schema
        description: tool.description || `MCP tool ${tool.server}:${tool.name}`,
        requiredArgs: [],
        executable: localStdio,
        reason: localStdio
          ? "MCP server tool discovered (local stdio); JSON-RPC tools/call adapter available. Mutating use needs session permission."
          : "MCP server tool discovered with schema and trusted, but server is not local stdio (no command); Linghun has no remote MCP transport adapter yet.",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// D.13J Block 4 — local stdio identification. command 必须是非空字符串；若 command 缺失
// 表示 server 仅以远程 HTTP 形式注册（不在本 Block 范围）。
function isLocalStdioMcpServer(server: McpServerConfig | undefined): boolean {
  if (!server) return false;
  if (server.disabled === true) return false;
  if (typeof server.command !== "string") return false;
  if (server.command.trim() === "") return false;
  return true;
}

function listSkillDeferredTools(context: TuiContext): DeferredToolDescriptor[] {
  if (!context.skills.enabled) return [];
  const disabled = new Set(context.skills.disabledIds);
  const trusted = new Set(context.skills.trustedIds);
  return context.skills.skills
    .filter((skill) => !disabled.has(skill.id))
    .filter((skill) => trusted.has(skill.id))
    .map((skill) => ({
      name: `skill:${skill.id}`,
      kind: "skill" as const,
      description: truncateDisplay(
        (skill.description ?? skill.name ?? skill.id).replace(/\s+/g, " "),
        160,
      ),
      requiredArgs: [],
      executable: false,
      reason: skillManifestHasContribution(skill)
        ? "Skill manifest contributes commands/tools (enabled+trusted), but Linghun has no safe skill execution adapter yet; review manifest manually or run /skills status."
        : "Skill manifest is metadata-only (no command/tool contribution); not executable. Run /skills status for details.",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// D.13J Block 5 — manifest 事实裁决：根据 manifest 字段区分"贡献了 command/tool"
// 与"纯 metadata"。仅读取已加载的 manifest 字段，不执行 postinstall/hook。
// SkillSummary 上没有显式 commands 字段，但 triggers 是 skill 的命令/工具触发入口；
// 同时兼容 manifest 上可能存在的 commands/tools 数组（通过 raw 字段读取）。
function skillManifestHasContribution(skill: SkillSummary): boolean {
  const triggers = skill.triggers ?? [];
  if (Array.isArray(triggers) && triggers.length > 0) return true;
  const raw = skill as unknown as { commands?: unknown; tools?: unknown };
  if (Array.isArray(raw.commands) && raw.commands.length > 0) return true;
  if (Array.isArray(raw.tools) && raw.tools.length > 0) return true;
  return false;
}

function listPluginDeferredTools(context: TuiContext): DeferredToolDescriptor[] {
  if (!context.plugins.enabled) return [];
  const disabled = new Set(context.plugins.disabledIds);
  const trusted = new Set(context.plugins.trustedIds);
  return context.plugins.plugins
    .filter((plugin) => !disabled.has(plugin.id))
    .filter((plugin) => trusted.has(plugin.id))
    .map((plugin) => ({
      name: `plugin:${plugin.id}`,
      kind: "plugin" as const,
      description: truncateDisplay(
        (plugin.description ?? plugin.name ?? plugin.id).replace(/\s+/g, " "),
        160,
      ),
      requiredArgs: [],
      executable: false,
      reason: pluginManifestHasContribution(plugin)
        ? "Plugin manifest contributes commands/tools (enabled+trusted), but Linghun has no safe plugin execution adapter yet; review contributions manually or run /plugins doctor."
        : "Plugin manifest is metadata-only (no command/tool contribution); not executable. Run /plugins doctor for details.",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function pluginManifestHasContribution(plugin: PluginSummary): boolean {
  const c = plugin.contributions;
  if (!c) return false;
  return (
    (c.commands?.length ?? 0) > 0 ||
    (c.mcpServers?.length ?? 0) > 0 ||
    (c.providers?.length ?? 0) > 0 ||
    (c.hooks?.length ?? 0) > 0 ||
    (c.workflows?.length ?? 0) > 0 ||
    (c.skills?.length ?? 0) > 0
  );
}

export function listDeferredTools(context: TuiContext): DeferredToolDescriptor[] {
  return [
    ...listCodebaseMemoryDeferredTools(),
    ...listMcpDeferredTools(context),
    ...listSkillDeferredTools(context),
    ...listPluginDeferredTools(context),
  ];
}

export function snapshotDeferredTools(context: TuiContext): DeferredToolDiscoverySnapshot {
  const tools = listDeferredTools(context);
  const byKind: Record<DeferredToolKind, number> = {
    "codebase-memory": 0,
    mcp: 0,
    skill: 0,
    plugin: 0,
  };
  let executableCount = 0;
  for (const tool of tools) {
    byKind[tool.kind] += 1;
    if (tool.executable) executableCount += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    total: tools.length,
    byKind,
    executableCount,
    tools,
  };
}

// D.13I：仅用于 doctor 的非泄漏摘要——不含 raw schema/secret/参数，只输出 total/byKind/executableCount。
export function snapshotDeferredToolsSummary(
  context: TuiContext,
): { total: number; byKind: Record<DeferredToolKind, number>; executableCount: number } {
  const snapshot = snapshotDeferredTools(context);
  return {
    total: snapshot.total,
    byKind: snapshot.byKind,
    executableCount: snapshot.executableCount,
  };
}

// D.13J Block 2：D.13I session-scoped discovered Set 的 doctor 摘要。
// `executeSearchExtraTools` 把匹配上的 deferred 工具名写入 `context.discoveredDeferredToolNames`，
// `executeExtraTool` 必须先看 Set 才放行。出于排查 ExecuteExtraTool 拒绝的需要，doctor 必须能看见
// 当前 session "已发现"了哪些工具。但只能输出"经过 sanitize 的工具名 + 数量"——
// 不能输出 raw 参数、不能透出 secret，因为发现集合里有可能包含将来引入的非 codebase-memory 工具名。
//
// sanitize 规则：
//   - 仅保留字母/数字/下划线/冒号/连字符/点号；其他字符替换为 "_"
//   - 长度上限 80；超长直接截断（避免日志爆炸）
//   - 总数上限 32；超过则按字典序保留前 32 项 + 一个 "+N more" 提示位
export type DiscoveredDeferredToolsSummary = {
  total: number;
  names: string[];
  truncated: boolean;
};

const DISCOVERED_NAME_MAX_LEN = 80;
const DISCOVERED_NAMES_MAX_COUNT = 32;

export function sanitizeDiscoveredDeferredToolName(name: string): string {
  // 仅保留 A-Za-z0-9_:.- ；其他都替换为 "_"，避免在 doctor 输出里出现奇怪字符。
  const cleaned = name.replace(/[^A-Za-z0-9_:.\-]/g, "_");
  if (cleaned.length <= DISCOVERED_NAME_MAX_LEN) return cleaned;
  return `${cleaned.slice(0, DISCOVERED_NAME_MAX_LEN)}…`;
}

export function snapshotDiscoveredDeferredToolsSummary(
  context: TuiContext,
): DiscoveredDeferredToolsSummary {
  const sorted = Array.from(context.discoveredDeferredToolNames).sort();
  const sanitized = sorted.map(sanitizeDiscoveredDeferredToolName);
  if (sanitized.length <= DISCOVERED_NAMES_MAX_COUNT) {
    return { total: sanitized.length, names: sanitized, truncated: false };
  }
  return {
    total: sanitized.length,
    names: sanitized.slice(0, DISCOVERED_NAMES_MAX_COUNT),
    truncated: true,
  };
}

export function searchDeferredTools(
  query: string,
  tools: DeferredToolDescriptor[],
): DeferredToolDescriptor[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return tools;
  return tools.filter((tool) => {
    const haystack = `${tool.name} ${tool.description} ${tool.kind}`.toLowerCase();
    return haystack.includes(trimmed);
  });
}

export function findDeferredTool(
  toolName: string,
  tools: DeferredToolDescriptor[],
): DeferredToolDescriptor | undefined {
  return tools.find((tool) => tool.name === toolName);
}

// stableHash 输入：仅暴露 name/kind/executable/requiredArgs；不进 raw schema/secret。
export function deferredToolListHashInput(tools: DeferredToolDescriptor[]): unknown {
  return tools
    .map((tool) => ({
      name: tool.name,
      kind: tool.kind,
      executable: tool.executable,
      requiredArgs: [...tool.requiredArgs].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// 仅当 deferred 列表非空时给出 system reminder。core tools 仍直接调用，不进 ExecuteExtraTool。
export function formatDeferredToolsSystemReminder(
  language: Language,
  snapshot: DeferredToolDiscoverySnapshot,
): string | undefined {
  if (snapshot.total === 0) return undefined;
  return language === "en-US"
    ? "Additional tools must be discovered via SearchExtraTools, then invoked via ExecuteExtraTool. Built-in tools (Read/Edit/Write/Bash/Grep/Glob/Todo) are still called directly."
    : "Additional tools must be discovered via SearchExtraTools, then invoked via ExecuteExtraTool.";
}

function isCodebaseMemoryToolName(name: string): boolean {
  return name in codebaseMemoryRequiredArgs();
}

function summarizeDeferredToolMatch(tool: DeferredToolDescriptor): Record<string, unknown> {
  return {
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    requiredArgs: tool.requiredArgs,
    executable: tool.executable,
    reason: tool.reason,
  };
}

export function executeSearchExtraTools(
  query: string,
  context: TuiContext,
): {
  ok: boolean;
  text: string;
  data: { matches: ReturnType<typeof summarizeDeferredToolMatch>[]; total: number };
} {
  const all = listDeferredTools(context);
  const filtered = searchDeferredTools(query, all);
  // D.13I tail fix — 仅把"匹配上的"工具名记入本 session 已发现集合。
  // ExecuteExtraTool 需要这个证据来证明模型确实通过 SearchExtraTools 发现过该工具。
  for (const tool of filtered) {
    context.discoveredDeferredToolNames.add(tool.name);
  }
  return {
    ok: true,
    text: `SearchExtraTools matched ${filtered.length}/${all.length} deferred tools (query=${JSON.stringify(query)}).`,
    data: { matches: filtered.map(summarizeDeferredToolMatch), total: filtered.length },
  };
}

export type ExecuteExtraToolResult =
  | { ok: true; text: string; data?: unknown }
  | { ok: false; text: string };

export async function executeExtraTool(
  args: { tool_name: unknown; params?: unknown },
  context: TuiContext,
): Promise<ExecuteExtraToolResult> {
  if (typeof args.tool_name !== "string" || args.tool_name.trim() === "") {
    return {
      ok: false,
      text: "ExecuteExtraTool: tool_name 缺失或为空，请先运行 SearchExtraTools 找到目标工具。",
    };
  }
  // D.13I tail fix — gating: 必须先看本 session 的"已发现"集合。
  // listDeferredTools 等价于"白名单存在"，不能等同于"模型已通过 SearchExtraTools 发现过"。
  // Set 命中 → 才允许进入白名单/适配器/必填参数检查。
  if (!context.discoveredDeferredToolNames.has(args.tool_name)) {
    return {
      ok: false,
      text: `ExecuteExtraTool: 工具 ${args.tool_name} 未在本 session 通过 SearchExtraTools 发现过。请先运行 SearchExtraTools 发现该工具。`,
    };
  }
  const all = listDeferredTools(context);
  const target = findDeferredTool(args.tool_name, all);
  if (!target) {
    return {
      ok: false,
      text: `ExecuteExtraTool: 工具 ${args.tool_name} 已被本 session 记为发现过，但已不在当前可用 deferred 工具清单中（白名单或会话状态可能已变化）。请重新运行 SearchExtraTools。`,
    };
  }
  if (!target.executable) {
    return {
      ok: false,
      text: `ExecuteExtraTool: 工具 ${target.name} (${target.kind}) 已发现但当前没有安全执行适配器：${target.reason}`,
    };
  }
  const params = (args.params && typeof args.params === "object" && !Array.isArray(args.params)
    ? args.params
    : {}) as Record<string, unknown>;
  if (target.kind === "codebase-memory") {
    if (!isCodebaseMemoryToolName(target.name)) {
      return {
        ok: false,
        text: `ExecuteExtraTool: ${target.name} 未通过 codebase-memory 白名单。`,
      };
    }
    const guard = validateCodebaseMemoryToolExecution(target.name, params);
    if (!guard.ok) {
      return { ok: false, text: guard.summary };
    }
    // D.13J Block 3 — mutating 工具需要 session 权限授予。order: whitelist
    // (Set + listDeferredTools) → required-args → permission gate → spawn。
    const risk = getCodebaseMemoryToolRisk(target.name);
    if (risk === "mutating" && !context.codebaseMemoryMutatingGranted) {
      return {
        ok: false,
        text: `ExecuteExtraTool: codebase-memory tool ${target.name} 需要 mutating 权限。当前 session 默认拒绝 mutating；如果你确实要刷新索引，请使用真实的 slash 命令 /index refresh 或 /index init fast --force（这两个命令会走 Linghun 受控路径，不需要本入口）。`,
      };
    }
    const cliResult = await runCodebaseMemoryCli(context, target.name, params, context.projectPath);
    if (!cliResult.ok) {
      return {
        ok: false,
        text: `ExecuteExtraTool(codebase-memory:${target.name}) 失败：${cliResult.summary}${cliResult.errorCode ? ` [${cliResult.errorCode}]` : ""}`,
      };
    }
    return {
      ok: true,
      text: `ExecuteExtraTool(codebase-memory:${target.name}) 完成。`,
      data: cliResult.data,
    };
  }
  // 防御：MCP/skill/plugin 已在上面被 executable=false 拦截，理论上不会到这里。
  if (target.kind === "mcp") {
    // D.13J Block 4 — local stdio MCP runtime adapter.
    // mcp:<server>:<tool> 形态：从 target.name 解析出 server 和 tool name。
    // server 必须存在于 context.config.mcp.servers 且为 local stdio；同时 mutating
    // 工具默认拒绝（沿用 codebase-memory 的 mutating gate 思路）。
    const parsed = parseMcpDeferredToolName(target.name);
    if (!parsed) {
      return {
        ok: false,
        text: `ExecuteExtraTool: 无法解析 MCP 工具名 ${target.name}，期望格式 mcp:<server>:<tool>。`,
      };
    }
    const serverConfig = context.config.mcp.servers[parsed.server];
    if (!isLocalStdioMcpServer(serverConfig)) {
      return {
        ok: false,
        text: `ExecuteExtraTool: MCP server ${parsed.server} 不是本地 stdio（缺少 command 或已禁用），当前没有远程 MCP 传输适配器。`,
      };
    }
    if (!context.mcpStdioMutatingGranted && isPotentiallyMutatingMcpTool(parsed.tool)) {
      return {
        ok: false,
        text: `ExecuteExtraTool: MCP 工具 ${target.name} 看起来是 mutating（write/delete/update/index/create 类）。当前 session 默认拒绝 mcp 写权限，无 slash 入口可显式授予；如果该工具是 codebase-memory 索引写入，请改用 /index refresh 或 /index init fast --force 走受控路径，否则请在 server 自身或 .linghun/settings.json 中关闭对应 mutating 工具。`,
      };
    }
    const stdio = await runMcpStdioToolCall(
      serverConfig as McpServerConfig,
      parsed.tool,
      params,
      context.projectPath,
    );
    if (!stdio.ok) {
      return {
        ok: false,
        text: `ExecuteExtraTool(${target.name}) 失败：${stdio.summary}${stdio.errorCode ? ` [${stdio.errorCode}]` : ""}`,
      };
    }
    return {
      ok: true,
      text: `ExecuteExtraTool(${target.name}) 完成。`,
      data: stdio.data,
    };
  }
  return {
    ok: false,
    text: `ExecuteExtraTool: 工具 ${target.name} (${target.kind}) 没有可用的安全执行适配器。`,
  };
}

// D.13J Block 4 — `mcp:<server>:<tool>` 名称解析。server 不能含冒号，tool 名允许出现冒号
// 以兼容 `server.tool` 形态（如 `codebase-memory.list_projects` 或 `srv:tool:sub`）。
export function parseMcpDeferredToolName(
  name: string,
): { server: string; tool: string } | undefined {
  if (!name.startsWith("mcp:")) return undefined;
  const rest = name.slice(4);
  const idx = rest.indexOf(":");
  if (idx <= 0) return undefined;
  const server = rest.slice(0, idx);
  const tool = rest.slice(idx + 1);
  if (server.trim() === "" || tool.trim() === "") return undefined;
  return { server, tool };
}

// D.13J Block 4 — mutating heuristic for generic MCP tools。我们不知道具体 server 的工具语义，
// 只能依赖工具名前缀/关键字保守判定：write/delete/update/create/remove/index 等被视为 mutating。
// 默认守门：mutating → 必须 session 权限授予。readonly heuristic miss 不是问题（继续走 spawn）；
// mutating heuristic miss 才是问题（用户明确点名 codebase-memory 的 index_repository / detect_changes
// 必须默认拒绝），因此误报偏 mutating 比误报偏 readonly 更安全。
const MUTATING_MCP_TOOL_KEYWORDS: ReadonlyArray<string> = [
  "write",
  "delete",
  "update",
  "create",
  "remove",
  "index_repository",
  "detect_changes",
  "ingest",
  "manage_adr",
];

export function isPotentiallyMutatingMcpTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return MUTATING_MCP_TOOL_KEYWORDS.some((keyword) => lower.includes(keyword));
}

// D.13J Block 4 — JSON-RPC 2.0 over stdio MCP client。最小可用：
//   1. spawn server with command/args/env (cwd = project)
//   2. send `initialize` (capabilities + clientInfo)，等 result
//   3. send `tools/list`，校验目标 tool 在 server 公布的 list 内（防止虚假发现）
//   4. send `tools/call` (name + arguments)，等 result
//   5. 直接 kill 子进程；不维持长连接（每次 ExecuteExtraTool 一次性 spawn）。
// 设计说明：长连接需要管理 reconnect / inflight 字典 / pendingRequests 状态机，超出 D.13J Block 4
// 范围。一次性 spawn 简单、安全、可测；性能代价由后续 Block 优化。
// D.13J tail fix（Block A）：tools/list 是 tail fix 新增链路，server 必须能返回包含目标 tool 的列表，
// 否则视为 schema 不一致并拒绝执行；这样 deferred discovery 不再依赖 placeholder。
type McpStdioResult = {
  ok: boolean;
  data?: unknown;
  summary: string;
  errorCode?: string;
};

// D.13J tail fix（Block A）：仅探测 tools/list 用于 discovery。仅返回工具名集合 +
// 是否存在 noise/error，不写入 stdio adapter 缓存；调用方负责把它喂给 stabilizeMcpToolList。
type McpStdioToolListResult = {
  ok: boolean;
  toolNames: string[];
  summary: string;
  errorCode?: string;
};

const MCP_STDIO_CALL_TIMEOUT_MS = 15_000;
const MCP_STDIO_PROTOCOL_VERSION = "2025-06-18";

async function runMcpStdioToolCall(
  server: McpServerConfig,
  toolName: string,
  params: Record<string, unknown>,
  cwd: string,
  timeoutMs: number = MCP_STDIO_CALL_TIMEOUT_MS,
): Promise<McpStdioResult> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    const guard = createProcessGuard();
    try {
      child = spawn(server.command, server.args ?? [], {
        cwd,
        shell: false,
        windowsHide: true,
        env: server.env ? { ...process.env, ...server.env } : process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      guard.track(child, { label: `mcp-stdio:${server.command}` });
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      resolvePromise({
        ok: false,
        summary: `spawn failed: ${sanitizeDiagnosticText(nodeError.message)}`,
        errorCode: nodeError.code,
      });
      return;
    }

    let settled = false;
    const settle = (result: McpStdioResult): void => {
      if (settled) return;
      settled = true;
      try {
        guard.requestStop(false);
      } catch {
        // ignore
      }
      resolvePromise(result);
    };

    const stderrChunks: Buffer[] = [];
    let stdoutBuffer = "";
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdin || !stdout || !stderr) {
      settle({ ok: false, summary: "MCP stdio streams unavailable" });
      return;
    }

    const timer = setTimeout(() => {
      settle({
        ok: false,
        summary: `MCP stdio timeout after ${timeoutMs}ms (no result for tools/call ${toolName})`,
        errorCode: "ETIMEDOUT",
      });
    }, timeoutMs);

    type Pending = {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    };
    const pending = new Map<number, Pending>();
    let nextId = 1;

    const sendRequest = (method: string, params2?: unknown): Promise<unknown> => {
      return new Promise((resolveReq, rejectReq) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveReq, reject: rejectReq });
        const message = JSON.stringify({ jsonrpc: "2.0", id, method, params: params2 });
        try {
          stdin.write(`${message}\n`);
        } catch (error) {
          pending.delete(id);
          rejectReq(error as Error);
        }
      });
    };

    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIdx: number;
      // line-delimited JSON-RPC; each newline is a frame.
      while ((newlineIdx = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, newlineIdx).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
        if (line === "") continue;
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          // ignore non-JSON noise (some MCP servers print banners on first line)
          continue;
        }
        const obj = frame as {
          id?: number;
          result?: unknown;
          error?: { message?: string; code?: number | string };
        };
        if (typeof obj.id !== "number") continue;
        const handler = pending.get(obj.id);
        if (!handler) continue;
        pending.delete(obj.id);
        if (obj.error) {
          handler.reject(
            new Error(
              `MCP error id=${obj.id}: ${sanitizeDiagnosticText(obj.error.message ?? "unknown")}`,
            ),
          );
        } else {
          handler.resolve(obj.result);
        }
      }
    });
    stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error: Error) => {
      const nodeError = error as NodeJS.ErrnoException;
      clearTimeout(timer);
      settle({
        ok: false,
        summary: `MCP stdio error: ${sanitizeDiagnosticText(nodeError.message)}`,
        errorCode: nodeError.code,
      });
    });
    child.on("exit", (code, signal) => {
      // 让 settle 决定 outcome：如果 tools/call 已经 resolve 过，settle 会被忽略。
      if (!settled) {
        clearTimeout(timer);
        const stderrText = sanitizeDiagnosticText(
          Buffer.concat(stderrChunks).toString("utf8").slice(0, 400),
        );
        settle({
          ok: false,
          summary: `MCP stdio child exited prematurely (code=${code ?? "?"} signal=${signal ?? "-"})${stderrText ? `: ${stderrText}` : ""}`,
        });
      }
    });

    (async () => {
      try {
        await sendRequest("initialize", {
          protocolVersion: MCP_STDIO_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "linghun-tui", version: "0.0.0" },
        });
        // D.13J tail fix（Block A）：tools/list 校验目标 tool 在 server 公布的列表内。
        // 防御 server 静默接受 tools/call 但工具名不存在 / 拼写错误 / server 已下线该工具。
        const listResult = await sendRequest("tools/list", {});
        const toolNames = extractMcpToolNames(listResult);
        if (!toolNames.includes(toolName)) {
          clearTimeout(timer);
          settle({
            ok: false,
            summary: `tools/list does not contain ${toolName} (server published ${toolNames.length} tools); refusing tools/call`,
            errorCode: "MCP_TOOL_NOT_FOUND",
          });
          return;
        }
        const result = await sendRequest("tools/call", {
          name: toolName,
          arguments: params,
        });
        clearTimeout(timer);
        settle({
          ok: true,
          summary: `tools/call ${toolName} ok`,
          data: result,
        });
      } catch (error) {
        clearTimeout(timer);
        settle({
          ok: false,
          summary: sanitizeDiagnosticText((error as Error).message),
        });
      }
    })();
  });
}

// D.13J tail fix（Block A）：从 MCP `tools/list` result 中提取工具名集合。
// MCP 规范：result.tools 是 { name: string; description?: string; inputSchema?: object }[]。
// 我们仅取 name，丢弃其余字段（description/inputSchema 不进入 stdio adapter 缓存，避免 raw schema 泄露）。
function extractMcpToolNames(listResult: unknown): string[] {
  if (!listResult || typeof listResult !== "object") return [];
  const tools = (listResult as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const tool of tools) {
    if (tool && typeof tool === "object") {
      const name = (tool as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0) names.push(name);
    }
  }
  return names;
}

// D.13J tail fix（Block A）：仅探测 server 的 tools/list，用于 discovery 真实化。
// 与 runMcpStdioToolCall 共享 spawn / settle / JSON-RPC 解析逻辑；区别：不发 tools/call，
// 只回返工具名集合。失败时不抛错，返回 ok=false + errorCode + summary，由调用方决定是否
// 在 deferred discovery 中标 schemaLoaded=false。仅 5s timeout，避免拖慢启动。
async function runMcpStdioToolList(
  server: McpServerConfig,
  cwd: string,
  timeoutMs = 5_000,
): Promise<McpStdioToolListResult> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    const guard = createProcessGuard();
    try {
      child = spawn(server.command, server.args ?? [], {
        cwd,
        shell: false,
        windowsHide: true,
        env: server.env ? { ...process.env, ...server.env } : process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      guard.track(child, { label: `mcp-stdio-list:${server.command}` });
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      resolvePromise({
        ok: false,
        toolNames: [],
        summary: `spawn failed: ${sanitizeDiagnosticText(nodeError.message)}`,
        errorCode: nodeError.code,
      });
      return;
    }

    let settled = false;
    const settle = (result: McpStdioToolListResult): void => {
      if (settled) return;
      settled = true;
      try {
        guard.requestStop(false);
      } catch {
        // ignore
      }
      resolvePromise(result);
    };

    let stdoutBuffer = "";
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdin || !stdout || !stderr) {
      settle({ ok: false, toolNames: [], summary: "MCP stdio streams unavailable" });
      return;
    }

    const timer = setTimeout(() => {
      settle({
        ok: false,
        toolNames: [],
        summary: `MCP stdio tools/list timeout after ${timeoutMs}ms`,
        errorCode: "ETIMEDOUT",
      });
    }, timeoutMs);

    type Pending = {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    };
    const pending = new Map<number, Pending>();
    let nextId = 1;

    const sendRequest = (method: string, params2?: unknown): Promise<unknown> => {
      return new Promise((resolveReq, rejectReq) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveReq, reject: rejectReq });
        const message = JSON.stringify({ jsonrpc: "2.0", id, method, params: params2 });
        try {
          stdin.write(`${message}\n`);
        } catch (error) {
          pending.delete(id);
          rejectReq(error as Error);
        }
      });
    };

    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIdx: number;
      while ((newlineIdx = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, newlineIdx).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
        if (line === "") continue;
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        const obj = frame as {
          id?: number;
          result?: unknown;
          error?: { message?: string; code?: number | string };
        };
        if (typeof obj.id !== "number") continue;
        const handler = pending.get(obj.id);
        if (!handler) continue;
        pending.delete(obj.id);
        if (obj.error) {
          handler.reject(
            new Error(
              `MCP error id=${obj.id}: ${sanitizeDiagnosticText(obj.error.message ?? "unknown")}`,
            ),
          );
        } else {
          handler.resolve(obj.result);
        }
      }
    });
    stderr.on("data", () => {
      // discard noise; tools/list discovery prefers silent failure over noisy summaries
    });
    child.on("error", (error: Error) => {
      const nodeError = error as NodeJS.ErrnoException;
      clearTimeout(timer);
      settle({
        ok: false,
        toolNames: [],
        summary: `MCP stdio error: ${sanitizeDiagnosticText(nodeError.message)}`,
        errorCode: nodeError.code,
      });
    });
    child.on("exit", (code, signal) => {
      if (!settled) {
        clearTimeout(timer);
        settle({
          ok: false,
          toolNames: [],
          summary: `MCP stdio child exited prematurely (code=${code ?? "?"} signal=${signal ?? "-"})`,
        });
      }
    });

    (async () => {
      try {
        await sendRequest("initialize", {
          protocolVersion: MCP_STDIO_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "linghun-tui", version: "0.0.0" },
        });
        const listResult = await sendRequest("tools/list", {});
        const toolNames = extractMcpToolNames(listResult);
        clearTimeout(timer);
        settle({
          ok: true,
          toolNames,
          summary: `tools/list ok (${toolNames.length} tools)`,
        });
      } catch (error) {
        clearTimeout(timer);
        settle({
          ok: false,
          toolNames: [],
          summary: sanitizeDiagnosticText((error as Error).message),
        });
      }
    })();
  });
}

async function runCommandCapture(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
  errorCode?: string;
}> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    const guard = createProcessGuard();
    try {
      child = spawn(command, args, { cwd, shell: false, windowsHide: true });
      guard.track(child, { label: `command:${command}` });
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      resolvePromise({
        exitCode: 127,
        stdout: "",
        stderr: "",
        summary: sanitizeDiagnosticText(nodeError.message),
        errorCode: nodeError.code,
      });
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      guard.requestStop(false);
      resolvePromise({
        exitCode: 124,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        summary: `命令超时：${redactedPath(command)}`,
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: 127,
        stdout: "",
        stderr: "",
        summary: sanitizeDiagnosticText(error.message),
        errorCode: error.code,
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      resolvePromise({
        exitCode: exitCode ?? 1,
        stdout: out,
        stderr: err,
        summary: truncateDisplay(
          sanitizeDiagnosticText(err || out || `exit ${exitCode}`).replace(/\s+/g, " "),
          200,
        ),
      });
    });
  });
}

function refreshCacheFreshness(context: TuiContext): void {
  const freshness = getCurrentFreshness(context);
  context.cache.lastFreshness = {
    ...freshness,
    changedKeys: diffFreshness(context.cache.lastFreshness, freshness),
  };
}

function stabilizeMcpToolList(tools: McpToolState[]): McpToolState[] {
  return tools
    .map((tool) => ({
      server: tool.server,
      name: tool.name,
      description: truncateDisplay(tool.description.replace(/\s+/g, " "), 120),
      discovery: tool.discovery ?? "placeholder",
      trusted: tool.trusted ?? false,
      schemaLoaded: tool.schemaLoaded ?? false,
      runtimeVersion: tool.runtimeVersion ?? "unknown",
    }))
    .sort((a, b) => `${a.server}:${a.name}`.localeCompare(`${b.server}:${b.name}`));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

function hashFileContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function classifyCacheWriteTokensSource(usage: ModelUsage): CacheWriteTokensSource {
  if (usage.cacheWriteTokensRaw === null) {
    return "missing";
  }
  if (typeof usage.cacheWriteTokensRaw === "number") {
    return usage.cacheWriteTokensRaw === 0 ? "zero_reported" : "reported";
  }
  if (usage.cacheWriteTokensEstimated && typeof usage.cacheWriteTokens === "number") {
    return "estimated";
  }
  if (typeof usage.cacheWriteTokens === "number") {
    return usage.cacheWriteTokens === 0 ? "zero_reported" : "reported";
  }
  return "missing";
}

function trimCacheHistory(cache: CacheState): void {
  while (cache.history.length > cache.config.maxTurns) {
    cache.history.shift();
  }
}

function recordCompactBoundary(context: TuiContext, boundary: CompactBoundary): void {
  context.cache.compacted = true;
  context.cache.compactBoundaries.push(boundary);
  if (context.cache.compactBoundaries.length > MAX_CHECKPOINTS) {
    context.cache.compactBoundaries.shift();
  }
}

async function refreshWorkspaceReferenceCache(
  context: TuiContext,
  runtimeStatus: unknown,
): Promise<Awaited<ReturnType<typeof getWorkspaceReferenceSnapshot>>> {
  return getWorkspaceReferenceSnapshot(context.cache.workspaceReference, {
    projectPath: context.projectPath,
    dimensions: createWorkspaceReferenceDimensions(context),
    runtimeStatus,
    toolCapabilitySummary: createModelCapabilitySummary(24),
    evidenceRefs: context.evidence.map((item) => item.id),
    logRefs: context.backgroundTasks
      .flatMap((task) => [task.logPath, task.outputPath])
      .filter(isString),
  });
}

// Static hash: builtInTools never changes at runtime; avoid recomputing on every probe
let _builtInToolsHashCache: string | undefined;

function createWorkspaceReferenceDimensions(context: TuiContext) {
  const runtime = getSelectedModelRuntime(context);
  if (!_builtInToolsHashCache) {
    _builtInToolsHashCache = stableHash(builtInTools);
  }
  return {
    configHash: stableHash(createConfigFreshnessSummary(context.config)),
    toolSchemaHash: _builtInToolsHashCache,
    providerModelHash: stableHash({ provider: runtime.provider, model: runtime.model }),
    mcpToolListHash: stableHash(stabilizeMcpToolList(context.mcp.tools)),
    indexFreshnessHash: stableHash({
      projectName: context.index.projectName,
      status: context.index.status,
      nodes: context.index.nodes,
      edges: context.index.edges,
      changedFiles: context.index.changedFiles,
      artifactStatus: context.index.artifactStatus,
    }),
    compactBoundaryHash: compactBoundaryHash(context.cache.compactBoundaries),
    extensionListHash: stableHash(createExtensionFreshnessSummary(context)),
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function getCurrentFreshness(context: TuiContext): CacheFreshness {
  // Reuse cached builtInTools hash — builtInTools is a static import constant
  if (!_builtInToolsHashCache) {
    _builtInToolsHashCache = stableHash(builtInTools);
  }
  return createCacheFreshness({
    systemPrompt:
      context.language === "en-US" ? "Linghun EN system prompt" : "Linghun ZH system prompt",
    toolSchema: builtInTools,
    _precomputedToolSchemaHash: _builtInToolsHashCache,
    mcpToolList: stabilizeMcpToolList(context.mcp.tools),
    model: context.model,
    provider: getRuntimeStatusProvider(context),
    reasoningEffort: "default",
    projectRules: createProjectRulesFreshnessSummary(context),
    memory: createMemoryFreshnessSummary(context),
    compact: {
      compacted: context.cache.compacted,
      boundaryHash: compactBoundaryHash(context.cache.compactBoundaries),
    },
    plugins: {
      ...createExtensionFreshnessSummary(context),
      workspaceReferenceHash: workspaceReferenceHash(context.cache.workspaceReference.latest),
    },
    // D.13F：附加 endpointProfile / cacheControl / cacheTtl 维度，
    // 用于 /break-cache status 直接展示 prompt cache 配置变化。
    endpointProfile: getActiveEndpointProfileLabel(context),
    cacheControl: context.config.promptCache.enabled ? "ephemeral" : "off",
    cacheTtl: context.config.promptCache.systemTtl,
    // D.13I：deferred tools list 仅记录 name/kind/executable/requiredArgs，
    // 不含 raw schema/secret；与 toolSchemaHash（固定 builtIn + dispatch 两件套）解耦。
    deferredToolList: deferredToolListHashInput(listDeferredTools(context)),
  });
}

function createProjectRulesFreshnessSummary(context: TuiContext): string {
  return stableStringify({
    path: normalizePath(context.memory.projectRulesPath),
    exists: context.memory.projectRulesExists,
    summary: context.memory.projectRulesSummary,
    error: context.memory.projectRulesError ? "unreadable" : "none",
  });
}

function createMemoryFreshnessSummary(context: TuiContext): string {
  const summarize = (items: MemoryCandidate[]) =>
    items
      .map((item) => ({
        id: item.id,
        scope: item.scope,
        status: normalizeMemoryStatus(item),
        summary: item.summary,
        source: item.source,
      }))
      .sort((a, b) =>
        `${a.status}:${a.scope}:${a.id}:${a.summary}:${a.source}`.localeCompare(
          `${b.status}:${b.scope}:${b.id}:${b.summary}:${b.source}`,
        ),
      );
  return stableStringify({
    projectRules: context.memory.projectRulesSummary,
    candidates: summarize(context.memory.candidates),
    accepted: summarize(context.memory.accepted),
    disabled: summarize(context.memory.disabled),
    rejected: summarize(context.memory.rejected),
  });
}

function createExtensionFreshnessSummary(context: TuiContext): Record<string, unknown> {
  return {
    skills: context.skills.skills
      .map((skill) => ({
        id: skill.id,
        enabled: skill.enabled,
        source: skill.source,
        trusted: skill.trusted,
        triggers: skill.triggers,
        summary: skill.summary,
        permissions: skill.permissions,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    workflows: context.workflows.templates
      .map((workflow) => ({
        id: workflow.id,
        risk: workflow.risk,
        writesFiles: workflow.writesFiles,
        validation: workflow.recommendedValidation,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    hooks: context.hooks.hooks
      .map((hook) => ({
        id: hook.id,
        event: hook.event,
        enabled: hook.enabled,
        trusted: hook.trusted,
        permissions: hook.permissions,
      }))
      .sort((a, b) => `${a.event}:${a.id}`.localeCompare(`${b.event}:${b.id}`)),
    plugins: context.plugins.plugins
      .map((plugin) => ({
        id: plugin.id,
        enabled: plugin.enabled,
        source: plugin.source,
        trusted: plugin.trusted,
        permissions: plugin.permissions,
        contributions: plugin.contributions,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function formatCacheLog(context: TuiContext): string {
  if (context.cache.history.length === 0) {
    return "最近缓存日志为空。真实 usage 需要 provider 返回 token/cache 字段；可用 /cache warmup 尝试预热。";
  }
  return [
    `Cache log 最近 ${context.cache.history.length}/${context.cache.config.maxTurns} 轮：`,
    ...context.cache.history.map(
      (item) =>
        `#${item.turn} hit=${formatPercent(item.hitRate)} input=${item.inputTokens} output=${item.outputTokens} cache_read=${item.cacheReadTokens} cache_write=${item.cacheWriteTokens} write_source=${item.cacheWriteTokensSource} model=${item.model} provider=${item.provider} endpoint=${item.endpoint ?? "-"} compact=${item.compacted ? "yes" : "no"}`,
    ),
  ].join("\n");
}

function formatCacheStatus(context: TuiContext): string {
  const latest = context.cache.history.at(-1);
  const freshness = latest?.freshness ?? getCurrentFreshness(context);
  const changed =
    latest?.freshness.changedKeys ?? diffFreshness(context.cache.lastFreshness, freshness);
  const source = latest?.cacheWriteTokensSource ?? "missing";
  const zeroNote =
    source === "zero_reported"
      ? "provider 当前返回 cache_creation/cache write 为 0；这只是字段口径，不代表零写入成本。"
      : source === "missing"
        ? "provider 未返回 cache_creation/cache write 字段；不支持真实缓存写入统计。"
        : "cache write/create 字段来自 provider/API usage。";
  return [
    "Cache status",
    `- history: ${context.cache.history.length}/${context.cache.config.maxTurns}`,
    `- latest hitRate: ${formatPercent(latest?.hitRate ?? null)}（公式：cacheRead / (input + cacheWrite + cacheRead)，output 不进分母）`,
    `- read/write tokens: ${latest?.cacheReadTokens ?? 0}/${latest?.cacheWriteTokens ?? 0}`,
    `- cache write source: ${source}`,
    `- compact: ${context.cache.compacted ? "yes" : "no"}`,
    `- workspace reference: hits=${context.cache.workspaceReference.hits} misses=${context.cache.workspaceReference.misses} failures=${context.cache.workspaceReference.failures} latest=${context.cache.workspaceReference.latest?.source ?? "none"}`,
    `- workspace snapshot lite: ${formatWorkspaceSnapshotLiteStatus(context)}`,
    `- freshness changedKeys: ${changed.length > 0 ? changed.join(", ") : "none"}`,
    `- note: ${zeroNote}`,
  ].join("\n");
}

function formatWorkspaceSnapshotLiteStatus(context: TuiContext): string {
  const snapshot = context.cache.workspaceReference.latest?.workspaceSnapshot;
  if (!snapshot) {
    return "none";
  }
  const changed = snapshot.changedSummary?.changedKeys.length
    ? snapshot.changedSummary.changedKeys.join(",")
    : "none";
  return `files=${snapshot.counts.files} dirs=${snapshot.counts.directories} ignored=${snapshot.counts.ignored} stored=${snapshot.counts.storedEntries} partial=${snapshot.partial ? "yes" : "no"} changed=${changed}`;
}

function createTerminalReadinessView(context: TuiContext): TerminalReadinessView {
  refreshBackgroundLifecycle(context);
  const runtime = getSelectedModelRuntime(context);
  const latestCache = context.cache.history.at(-1);
  const blockedBackground = context.backgroundTasks.filter((task) =>
    ["failed", "cancelled", "timeout", "stale"].includes(task.status),
  );
  const webSourceEvidence = context.evidence.some((evidence) => evidence.kind === "web_source")
    ? "present"
    : "missing";
  const projectDoctor = createProjectDoctorLite(context);
  const sourceDrift = createSourceOfTruthDriftLite(context);
  const contextPicker = createContextPickerLite(context, webSourceEvidence);
  const rollbackCoach = createRollbackCoachLite(context);
  const costPreview = createTaskCostPreviewLite(context);
  return {
    projectPath: context.projectPath,
    provider: runtime.provider,
    model: runtime.model,
    endpointProfile: runtime.endpointProfile,
    permissionMode: context.permissionMode,
    language: context.language,
    index: {
      status: context.index.status,
      changedFiles: context.index.changedFiles ?? null,
      staleHint: context.index.staleHint,
    },
    cache: {
      latestHitRate: latestCache?.hitRate ?? null,
      compacted: context.cache.compacted,
      workspaceSnapshot: context.cache.workspaceReference.latest?.workspaceSnapshot
        ? "ready"
        : "missing",
    },
    memory: {
      projectRules: context.memory.projectRulesError
        ? "unreadable"
        : context.memory.projectRulesExists
          ? "found"
          : "missing",
      candidates: context.memory.candidates.length,
      accepted: context.memory.accepted.length,
    },
    mcp: {
      enabled: context.mcp.enabled,
      servers: context.mcp.servers.length,
      tools: context.mcp.tools.length,
      errors: context.mcp.servers.filter((server) => server.status === "error").length,
    },
    background: {
      total: context.backgroundTasks.length,
      running: context.backgroundTasks.filter((task) => task.status === "running").length,
      blocked: blockedBackground.length,
    },
    verification: context.lastVerification
      ? {
          status: context.lastVerification.status,
          summary: context.lastVerification.summary,
          unverified: context.lastVerification.unverified.length,
          risk: context.lastVerification.risk.length,
        }
      : undefined,
    providerFailure: context.lastProviderFailure
      ? {
          code: context.lastProviderFailure.code,
          provider: context.lastProviderFailure.provider,
          model: context.lastProviderFailure.model,
          endpointProfile: context.lastProviderFailure.endpointProfile,
          summary: context.lastProviderFailure.summary,
        }
      : undefined,
    freshness: { webSourceEvidence },
    runtimePath: createRuntimePathForReadiness(context),
    verificationLevel: createVerificationLevelForReadiness(context),
    startupPath: createStartupPathForReadiness(),
    projectDoctor,
    sourceDrift,
    contextPicker,
    rollbackCoach,
    costPreview,
    problems: createTerminalProblems(context, webSourceEvidence, {
      projectDoctor,
      sourceDrift,
      contextPicker,
      rollbackCoach,
      costPreview,
    }),
  };
}

function createRuntimePathForReadiness(_context: TuiContext): TerminalReadinessView["runtimePath"] {
  const isTTY = Boolean(process.stdout.isTTY);
  const isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI);
  const envOverride = process.env.LINGHUN_TUI_RENDER_MODE;
  const forcedLegacy = envOverride === "legacy";
  const inkAvailable = isTTY && !isCI && !forcedLegacy;
  const marker = classifyRuntimePath({
    isTTY,
    inkAvailable,
    envOverride,
    forcedLegacy,
    isCI,
  });
  return {
    path: marker.path,
    kind: marker.kind,
    canClaimMature: marker.canClaimMature,
    degradedReason: marker.degradedReason,
  };
}

function createVerificationLevelForReadiness(
  context: TuiContext,
): TerminalReadinessView["verificationLevel"] {
  const lastVerification = context.lastVerification;
  if (!lastVerification) {
    return {
      level: "source",
      canClaimPass: false,
      canClaimMature: false,
      upgradeBlocked: false,
    };
  }
  // Infer level from verification status
  const status = lastVerification.status;
  const hasRealSmoke = status === "pass" && lastVerification.unverified.length === 0;
  const hasBuild = status === "pass" || status === "partial";
  return {
    level: hasRealSmoke ? "real-smoke" : hasBuild ? "build" : "local",
    canClaimPass: hasBuild,
    canClaimMature: hasRealSmoke,
    upgradeBlocked: status === "partial" || status === "stale",
    blockReason:
      status === "partial"
        ? "partial-verification"
        : status === "stale"
          ? "stale-verification"
          : undefined,
  };
}

function createStartupPathForReadiness(): TerminalReadinessView["startupPath"] {
  const isSourceExecution = Boolean(
    process.argv[1]?.endsWith(".ts") || process.env.LINGHUN_DEV_MODE || process.env.VITEST,
  );
  const isDistExecution = Boolean(
    process.argv[1]?.includes("/dist/") || process.argv[1]?.includes("\\dist\\"),
  );
  const isGlobalBin = Boolean(
    process.argv[1]?.includes("/bin/") || process.argv[1]?.includes("\\bin\\"),
  );
  const marker = classifyStartupPath({
    isSourceExecution,
    isDistExecution,
    isGlobalBin,
  });
  return {
    entryKind: marker.entryKind,
    isVerifiedCurrent: marker.isVerifiedCurrent,
    staleRisk: marker.staleRisk,
    staleReason: marker.staleReason,
  };
}

function createProjectDoctorLite(context: TuiContext): TerminalReadinessView["projectDoctor"] {
  const packageJson = readPackageJsonLite(context.projectPath);
  const scriptsRecord = readRecord(packageJson?.scripts);
  const scripts = Object.keys(scriptsRecord).sort();
  const packageManager = readPackageManagerLite(packageJson, context.projectPath);
  const configFiles = [
    "package.json",
    "tsconfig.json",
    "vitest.config.ts",
    "vitest.config.mts",
    "vitest.config.js",
    "vitest.config.mjs",
    "biome.json",
    "biome.jsonc",
    "pnpm-lock.yaml",
  ].filter((file) => existsSync(join(context.projectPath, file)));
  const ciFiles = [".github/workflows/ci.yml", ".github/workflows/ci.yaml"].filter((file) =>
    existsSync(join(context.projectPath, file)),
  );
  const packageManagerReady =
    packageManager.startsWith("pnpm@") ||
    (packageManager === "pnpm" && existsSync(join(context.projectPath, "pnpm-lock.yaml")));
  const vitestReady =
    hasAnyFile(context.projectPath, [
      "vitest.config.ts",
      "vitest.config.mts",
      "vitest.config.js",
      "vitest.config.mjs",
    ]) || hasPackageDependency(packageJson, "vitest");
  const biomeReady =
    hasAnyFile(context.projectPath, ["biome.json", "biome.jsonc"]) ||
    hasPackageDependency(packageJson, "@biomejs/biome");
  const projectRulesExists =
    context.memory.projectRulesExists || existsSync(join(context.projectPath, "LINGHUN.md"));
  const requiredChecks = [
    { id: "script:test", ok: typeof scriptsRecord.test === "string" },
    { id: "script:typecheck", ok: typeof scriptsRecord.typecheck === "string" },
    { id: "script:check", ok: typeof scriptsRecord.check === "string" },
    { id: "script:build", ok: typeof scriptsRecord.build === "string" },
    { id: "tsconfig", ok: existsSync(join(context.projectPath, "tsconfig.json")) },
    { id: "vitest", ok: vitestReady },
    { id: "biome", ok: biomeReady },
    { id: "pnpm/corepack", ok: packageManagerReady },
    { id: "ci-workflow", ok: ciFiles.length > 0 },
    { id: "LINGHUN.md", ok: projectRulesExists },
  ];
  const unknown = [
    packageJson ? undefined : "package.json",
    context.memory.projectRulesError ? "LINGHUN.md:unreadable" : undefined,
    ...requiredChecks.filter((check) => !check.ok).map((check) => check.id),
  ].filter((item): item is string => Boolean(item));
  const status: TerminalReadinessView["projectDoctor"]["status"] =
    unknown.length === 0 ? "pass" : "partial";
  return {
    status,
    packageManager,
    scripts,
    configFiles,
    ciFiles,
    projectRules: context.memory.projectRulesError
      ? "unreadable"
      : projectRulesExists
        ? "found"
        : "missing",
    checks: requiredChecks.map((check) => `${check.id}=${check.ok ? "ok" : "missing"}`),
    unknown,
  };
}

function createSourceOfTruthDriftLite(context: TuiContext): TerminalReadinessView["sourceDrift"] {
  const requiredDocs = [
    "docs/delivery/pre-open-source-terminal-product-completion-gate.md",
    "LINGHUN_PHASED_DELIVERY_BLUEPRINT.md",
    "LINGHUN_IMPLEMENTATION_SPEC.md",
    "docs/delivery/phase-15-5a-performance-context.md",
    "docs/delivery/phase-15-5b-resource-task-lifecycle.md",
    "docs/delivery/phase-15-5c-editing-tool-ux.md",
    "docs/delivery/phase-15-5c-plus-log-artifact-runtime-lite.md",
    "docs/delivery/phase-15-5c-plus-plus-workspace-snapshot-lite.md",
    "docs/delivery/phase-15-5d-connect-lite.md",
    "docs/delivery/phase-15-5e-provider-freshness.md",
    "docs/delivery/phase-15-5f-terminal-product-readiness.md",
  ];
  const checked = requiredDocs.filter((file) => existsSync(join(context.projectPath, file)));
  const issues = requiredDocs
    .filter((file) => !checked.includes(file))
    .map((file) => `missing:${file}`);
  const report = readTextFileLite(
    join(context.projectPath, "docs/delivery/phase-15-5f-terminal-product-readiness.md"),
  );
  if (report && !report.includes("Project Doctor Lite")) issues.push("report:project-doctor-lite");
  if (report && !report.includes("Source-of-Truth Drift")) issues.push("report:drift-linter-lite");
  if (report && !/未执行真实|未.*真实.*smoke|不代表真实全量 smoke/u.test(report)) {
    issues.push("report:no-real-smoke-negative");
  }
  if (report && !/不代表 Beta PASS|不是 Beta PASS|不声明 Beta PASS/u.test(report)) {
    issues.push("report:no-beta-ready-negative");
  }
  if (report && !/不代表.*smoke-ready|不是.*smoke-ready|不声明.*smoke-ready/u.test(report)) {
    issues.push("report:no-smoke-ready-negative");
  }
  if (
    report &&
    !/不代表.*open-source-ready|不是.*open-source-ready|不声明.*open-source-ready/u.test(report)
  ) {
    issues.push("report:no-open-source-ready-negative");
  }
  if (
    report &&
    !/未进入 Phase 16 \/ 17 \/ 18|未进 16\/17\/18|不得自动进入真实全量 smoke、Phase 16\/17\/18/u.test(
      report,
    )
  ) {
    issues.push("report:no-phase-16-17-18-negative");
  }
  if (report && !/未 commit|未提交 commit|不提交 commit|no commit/u.test(report)) {
    issues.push("report:no-commit-negative");
  }
  const status: TerminalReadinessView["sourceDrift"]["status"] =
    issues.length === 0 ? "pass" : checked.length > 0 ? "partial" : "unknown";
  return {
    status,
    checked,
    issues,
    nextAction:
      issues.length === 0 ? "/doctor report" : "sync Phase 15.5F report/source-of-truth notes",
  };
}

function createContextPickerLite(
  context: TuiContext,
  webSourceEvidence: "present" | "missing",
): TerminalReadinessView["contextPicker"] {
  const hasWorkspaceSnapshot = Boolean(context.cache.workspaceReference.latest?.workspaceSnapshot);
  const refs = [
    context.memory.projectRulesExists ? "project-rules" : undefined,
    hasWorkspaceSnapshot ? "workspace-snapshot" : undefined,
    context.index.status !== "missing" ? "index-status" : undefined,
    context.lastVerification ? "verification-last" : undefined,
    context.backgroundTasks.length > 0 ? "background-tasks" : undefined,
    webSourceEvidence === "present" ? "web-source-evidence" : undefined,
  ].filter((item): item is string => Boolean(item));
  const evidenceKinds = [...new Set(context.evidence.map((evidence) => evidence.kind))].sort();
  const indexFreshness =
    context.index.status === "ready"
      ? "fresh"
      : context.index.status === "stale"
        ? "stale"
        : "unknown";
  const hasEvidenceRef = evidenceKinds.length > 0 || Boolean(context.lastVerification);
  const status: TerminalReadinessView["contextPicker"]["status"] =
    context.memory.projectRulesExists &&
    indexFreshness === "fresh" &&
    hasWorkspaceSnapshot &&
    hasEvidenceRef
      ? "pass"
      : refs.length > 0
        ? "partial"
        : "unknown";
  return {
    status,
    refs,
    evidenceKinds,
    indexFreshness,
  };
}

function createRollbackCoachLite(context: TuiContext): TerminalReadinessView["rollbackCoach"] {
  const gitStatusLines = readGitStatusShortLite(context.projectPath);
  const fallbackChangedFiles = new Set([
    ...context.tools.changedFiles,
    ...context.checkpoints.flatMap((checkpoint) => checkpoint.changedFiles),
  ]);
  const changedFiles = gitStatusLines ? gitStatusLines.length : fallbackChangedFiles.size;
  const untrackedFiles = gitStatusLines
    ? gitStatusLines.filter((line) => line.startsWith("??")).length
    : 0;
  const gitStatus = gitStatusLines
    ? gitStatusLines.length > 0
      ? "dirty"
      : "clean"
    : "unavailable";
  const hasBlockedWork = context.backgroundTasks.some((task) =>
    ["failed", "cancelled", "timeout", "stale"].includes(task.status),
  );
  const status: TerminalReadinessView["rollbackCoach"]["status"] =
    gitStatus === "unavailable"
      ? "unknown"
      : hasBlockedWork || changedFiles > 0
        ? "partial"
        : "pass";
  return {
    status,
    changedFiles,
    untrackedFiles,
    checkpoints: context.checkpoints.length,
    gitStatus,
    mode: "advisory-only",
    nextAction:
      changedFiles > 0
        ? "review /diff and create a normal checkpoint before manual rollback"
        : gitStatus === "unavailable"
          ? "run git status --short manually before rollback decisions"
          : "no rollback action suggested",
  };
}

function createTaskCostPreviewLite(context: TuiContext): TerminalReadinessView["costPreview"] {
  const labels = ["local-only", "no-network", "no-real-smoke", "advisory-estimate"];
  if (context.lastVerification) labels.push("may-run-tests");
  if (context.backgroundTasks.length > 0) labels.push("background-visible");
  if (context.lastProviderFailure) labels.push("provider-diagnostic-only");
  return {
    status: "partial",
    level: context.lastVerification || context.backgroundTasks.length > 0 ? "medium" : "light",
    labels,
    nextAction:
      "advisory estimate only; confirm before tests, provider calls, network, or release actions",
  };
}

function readPackageJsonLite(projectPath: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(join(projectPath, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

function hasAnyFile(projectPath: string, files: string[]): boolean {
  return files.some((file) => existsSync(join(projectPath, file)));
}

function hasPackageDependency(
  packageJson: Record<string, unknown> | undefined,
  dependency: string,
): boolean {
  if (!packageJson) return false;
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
    (section) => typeof readRecord(packageJson[section])[dependency] === "string",
  );
}

function readGitStatusShortLite(projectPath: string): string[] | undefined {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: projectPath,
    encoding: "utf8",
    shell: false,
    timeout: 2_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readPackageManagerLite(
  packageJson: Record<string, unknown> | undefined,
  projectPath: string,
): string {
  if (typeof packageJson?.packageManager === "string") return packageJson.packageManager;
  if (existsSync(join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectPath, "package-lock.json"))) return "npm";
  if (existsSync(join(projectPath, "yarn.lock"))) return "yarn";
  return "unknown";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readTextFileLite(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function createTerminalProblems(
  context: TuiContext,
  webSourceEvidence: "present" | "missing",
  lite: Pick<
    TerminalReadinessView,
    "projectDoctor" | "sourceDrift" | "contextPicker" | "rollbackCoach" | "costPreview"
  >,
): TerminalProblemView[] {
  const problems: TerminalProblemView[] = [];
  if (context.lastVerification && context.lastVerification.status !== "pass") {
    problems.push({
      source: "verification",
      severity:
        context.lastVerification.status === "fail" || context.lastVerification.status === "timeout"
          ? "error"
          : "warning",
      summary: `${context.lastVerification.status}: ${context.lastVerification.summary}`,
      nextAction: context.lastVerification.nextAction,
      detailRef: "/verify last",
    });
  }
  if (context.lastProviderFailure) {
    problems.push({
      source: "provider",
      severity: "error",
      summary: `${context.lastProviderFailure.code}: ${context.lastProviderFailure.provider}/${context.lastProviderFailure.model}`,
      nextAction: "/model doctor",
      detailRef: "/details evidence",
    });
  }
  const cooldownDoctorLine = formatCooldownDoctorLine(context.providerBreaker, context.language);
  if (cooldownDoctorLine) {
    problems.push({
      source: "provider",
      severity: "warning",
      summary: cooldownDoctorLine,
      nextAction: "/model doctor",
    });
  }
  for (const task of context.backgroundTasks.filter((item) =>
    ["failed", "cancelled", "timeout", "stale"].includes(item.status),
  )) {
    problems.push({
      source: "background",
      severity: task.status === "failed" || task.status === "timeout" ? "error" : "warning",
      summary: `${task.kind} ${task.status}: ${task.userVisibleSummary}`,
      nextAction: task.nextAction ?? `/details background ${task.id}`,
      detailRef: `/details background ${task.id}`,
    });
  }
  if (webSourceEvidence === "missing") {
    problems.push({
      source: "freshness",
      severity: "warning",
      summary:
        "No web_source evidence in the current session; current/external facts must stay unverified.",
      nextAction: "Mark latest/current/external facts as unverified unless evidence is added.",
      detailRef: "/details evidence",
    });
  }
  if (context.index.status === "stale" || context.index.status === "error") {
    problems.push({
      source: "index",
      severity: context.index.status === "error" ? "error" : "warning",
      summary: `index status=${context.index.status}${context.index.staleHint ? ` ${context.index.staleHint}` : ""}`,
      nextAction: "/index doctor",
      detailRef: "/index status",
    });
  }
  if (lite.projectDoctor.status !== "pass") {
    problems.push({
      source: "project",
      severity: "warning",
      summary: `Project Doctor Lite status=${lite.projectDoctor.status} unknown=${lite.projectDoctor.unknown.join(",") || "none"}`,
      nextAction: "/doctor project",
    });
  }
  if (lite.sourceDrift.status !== "pass") {
    problems.push({
      source: "drift",
      severity: "warning",
      summary: `Source-of-Truth Drift Linter Lite issues=${lite.sourceDrift.issues.join(",") || "none"}`,
      nextAction: lite.sourceDrift.nextAction,
    });
  }
  if (lite.contextPicker.status !== "pass") {
    problems.push({
      source: "context",
      severity: "warning",
      summary: `Context Picker Lite refs=${lite.contextPicker.refs.length} index=${lite.contextPicker.indexFreshness}`,
      nextAction: "/doctor project",
    });
  }
  if (lite.rollbackCoach.status !== "pass") {
    problems.push({
      source: "rollback",
      severity: "info",
      summary: `Rollback Coach Lite changedFiles=${lite.rollbackCoach.changedFiles} untracked=${lite.rollbackCoach.untrackedFiles} checkpoints=${lite.rollbackCoach.checkpoints}; read-only advice only`,
      nextAction: lite.rollbackCoach.nextAction,
    });
  }
  if (lite.costPreview.status !== "pass") {
    problems.push({
      source: "cost",
      severity: "warning",
      summary: `Task Cost Preview Lite level=${lite.costPreview.level}`,
      nextAction: lite.costPreview.nextAction,
    });
  }
  return problems;
}

function formatCompactStatus(context: TuiContext): string {
  const latest = context.cache.compactBoundaries.at(-1);
  return [
    "Compact Lite status",
    `- compacted: ${context.cache.compacted ? "yes" : "no"}`,
    `- boundaries: ${context.cache.compactBoundaries.length}`,
    `- latest: ${latest ? `${latest.kind}/${latest.id}` : "none"}`,
    `- latest tokens: ${latest ? `${latest.preCompactTokenEstimate ?? "-"}->${latest.postCompactTokenEstimate ?? "-"}` : "-"}`,
    `- preserved evidence refs: ${latest?.preservedEvidenceRefs.length ?? 0}`,
    `- preserved files: ${latest?.preservedFiles.length ?? 0}`,
    "- boundary: no tools, no file writes, no long-term memory writes, no background task starts, no extra model calls.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// D.13F：/break-cache marker 文件 + 有界事件 jsonl 助手
// ---------------------------------------------------------------------------
// 设计要点：
// - marker 文件位于 .linghun/，文件存在即代表对应模式生效；once 命中后由 runtime 删除。
// - event log 仅记录动作类型与时间戳；不记录 prompt / api key / raw request / raw response。
// - 容量上限 200 行（按行截断），写入失败不抛；读取失败返回空数组。
// - 全部 IO 集中在 TUI/runtime 层，packages/providers 只接收最终的 cacheBreakNonce 输入。

type BreakCacheMode = "off" | "once" | "always";
type BreakCacheMarker = { mode: BreakCacheMode; nonce?: string };
type BreakCacheEvent = { action: string; createdAt: string };

const BREAK_CACHE_ONCE_FILENAME = ".break-cache-once";
const BREAK_CACHE_ALWAYS_FILENAME = ".break-cache-always";
const BREAK_CACHE_EVENTS_FILENAME = "break-cache-events.jsonl";
const BREAK_CACHE_EVENTS_MAX_LINES = 200;

function getBreakCacheDir(context: TuiContext): string {
  return join(context.projectPath, ".linghun");
}

function getBreakCacheOncePath(context: TuiContext): string {
  return join(getBreakCacheDir(context), BREAK_CACHE_ONCE_FILENAME);
}

function getBreakCacheAlwaysPath(context: TuiContext): string {
  return join(getBreakCacheDir(context), BREAK_CACHE_ALWAYS_FILENAME);
}

function getBreakCacheEventsPath(context: TuiContext): string {
  return join(getBreakCacheDir(context), BREAK_CACHE_EVENTS_FILENAME);
}

function readBreakCacheMarkerSync(context: TuiContext): BreakCacheMarker {
  // always 优先于 once；off 表示无 marker。任何读取错误一律视为 off。
  try {
    const alwaysPath = getBreakCacheAlwaysPath(context);
    if (existsSync(alwaysPath)) {
      const nonce = readFileSync(alwaysPath, "utf8").trim();
      return { mode: "always", nonce: nonce || undefined };
    }
    const oncePath = getBreakCacheOncePath(context);
    if (existsSync(oncePath)) {
      const nonce = readFileSync(oncePath, "utf8").trim();
      return { mode: "once", nonce: nonce || undefined };
    }
  } catch {
    // 静默降级到 off；marker 不可读不应阻断主流程。
  }
  return { mode: "off" };
}

function readRecentBreakCacheEventsSync(context: TuiContext, limit: number): BreakCacheEvent[] {
  try {
    const path = getBreakCacheEventsPath(context);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
    const recent = lines.slice(-Math.max(1, limit));
    const events: BreakCacheEvent[] = [];
    for (const line of recent) {
      try {
        const parsed = JSON.parse(line) as Partial<BreakCacheEvent>;
        if (typeof parsed.action === "string" && typeof parsed.createdAt === "string") {
          events.push({ action: parsed.action, createdAt: parsed.createdAt });
        }
      } catch {
        // 跳过损坏行，不抛
      }
    }
    return events;
  } catch {
    return [];
  }
}

async function appendBreakCacheEvent(context: TuiContext, action: string): Promise<void> {
  // 有界 jsonl：先 append，再按 200 行截断重写。失败不抛，避免破坏主流程。
  try {
    await mkdir(getBreakCacheDir(context), { recursive: true });
    const path = getBreakCacheEventsPath(context);
    const event: BreakCacheEvent = { action, createdAt: new Date().toISOString() };
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
    const raw = await readFile(path, "utf8").catch(() => "");
    const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length > BREAK_CACHE_EVENTS_MAX_LINES) {
      const trimmed = lines.slice(-BREAK_CACHE_EVENTS_MAX_LINES).join("\n");
      await writeFile(path, `${trimmed}\n`, "utf8");
    }
  } catch {
    // ignore
  }
}

async function writeBreakCacheMarker(
  context: TuiContext,
  mode: "once" | "always",
  nonce: string,
): Promise<void> {
  await mkdir(getBreakCacheDir(context), { recursive: true });
  const path = mode === "once" ? getBreakCacheOncePath(context) : getBreakCacheAlwaysPath(context);
  await writeFile(path, nonce, "utf8");
}

async function clearBreakCacheMarker(context: TuiContext, mode: BreakCacheMode | "all"): Promise<void> {
  const targets: string[] = [];
  if (mode === "once" || mode === "all") targets.push(getBreakCacheOncePath(context));
  if (mode === "always" || mode === "all") targets.push(getBreakCacheAlwaysPath(context));
  for (const target of targets) {
    try {
      if (existsSync(target)) {
        await rm(target, { force: true });
      }
    } catch {
      // ignore；下次状态读取仍能反映真实文件状态
    }
  }
}

// D.13F：导出 path-based pure helper 仅供 model-doctor / break-cache 单元测试使用。
// 不依赖 TuiContext，避免测试构造庞大的运行时上下文。生产代码继续使用 context-based 形态。
export type BreakCacheTestHooks = {
  writeMarker: (
    projectPath: string,
    mode: "once" | "always",
    nonce: string,
  ) => Promise<void>;
  clearMarker: (projectPath: string, mode: "off" | "once" | "always" | "all") => Promise<void>;
  readMarker: (projectPath: string) => { mode: "off" | "once" | "always"; nonce?: string };
  consumeNonce: (projectPath: string) => Promise<string | undefined>;
  appendEvent: (projectPath: string, action: string) => Promise<void>;
  readRecentEvents: (
    projectPath: string,
    limit: number,
  ) => Array<{ action: string; createdAt: string }>;
  buildPromptCacheFields: (
    projectPath: string,
    enabled: boolean,
    systemTtl: "5m" | "1h",
  ) => Promise<{
    promptCacheEnabled?: boolean;
    promptCacheTtl?: "1h";
    cacheBreakNonce?: string;
  }>;
  paths: (projectPath: string) => {
    onceMarker: string;
    alwaysMarker: string;
    eventsLog: string;
  };
  eventsMaxLines: number;
};

function makeFakeContextForPath(projectPath: string): TuiContext {
  // 单元测试专用：仅提供 break-cache 助手所需的 projectPath 字段。
  // 其它字段访问会抛 TypeError，迫使新依赖在测试覆盖中显式增加。
  return { projectPath } as unknown as TuiContext;
}

export const breakCacheTestHooks: BreakCacheTestHooks = {
  writeMarker: (projectPath, mode, nonce) =>
    writeBreakCacheMarker(makeFakeContextForPath(projectPath), mode, nonce),
  clearMarker: (projectPath, mode) =>
    clearBreakCacheMarker(makeFakeContextForPath(projectPath), mode),
  readMarker: (projectPath) => readBreakCacheMarkerSync(makeFakeContextForPath(projectPath)),
  consumeNonce: (projectPath) =>
    consumeBreakCacheNonceForRequest(makeFakeContextForPath(projectPath)),
  appendEvent: (projectPath, action) =>
    appendBreakCacheEvent(makeFakeContextForPath(projectPath), action),
  readRecentEvents: (projectPath, limit) =>
    readRecentBreakCacheEventsSync(makeFakeContextForPath(projectPath), limit),
  buildPromptCacheFields: async (projectPath, enabled, systemTtl) => {
    if (!enabled) return {};
    const nonce = await consumeBreakCacheNonceForRequest(makeFakeContextForPath(projectPath));
    return {
      promptCacheEnabled: true,
      ...(systemTtl === "1h" ? { promptCacheTtl: "1h" as const } : {}),
      ...(nonce ? { cacheBreakNonce: nonce } : {}),
    };
  },
  paths: (projectPath) => {
    const ctx = makeFakeContextForPath(projectPath);
    return {
      onceMarker: getBreakCacheOncePath(ctx),
      alwaysMarker: getBreakCacheAlwaysPath(ctx),
      eventsLog: getBreakCacheEventsPath(ctx),
    };
  },
  eventsMaxLines: BREAK_CACHE_EVENTS_MAX_LINES,
};

// 由请求 dispatch 路径调用：返回当轮要写进 ModelRequest 的 cacheBreakNonce，
// 并在 once 命中后立即消费 marker（删除 once 文件）。always 不消费。
async function consumeBreakCacheNonceForRequest(context: TuiContext): Promise<string | undefined> {
  const marker = readBreakCacheMarkerSync(context);
  if (marker.mode === "off") return undefined;
  const nonce = marker.nonce && marker.nonce.length > 0 ? marker.nonce : randomUUID();
  if (marker.mode === "once") {
    try {
      await rm(getBreakCacheOncePath(context), { force: true });
    } catch {
      // ignore
    }
    await appendBreakCacheEvent(context, "once_consumed");
  }
  return nonce;
}

// D.13F：把 promptCache 配置 + 当轮 nonce 折叠成 ModelRequest 片段。
// enabled=false 时返回空对象，请求体不会带 cache_control / nonce。
async function buildPromptCacheRequestFields(context: TuiContext): Promise<{
  promptCacheEnabled?: boolean;
  promptCacheTtl?: "1h";
  cacheBreakNonce?: string;
}> {
  const config = context.config.promptCache;
  if (!config.enabled) return {};
  const nonce = await consumeBreakCacheNonceForRequest(context);
  return {
    promptCacheEnabled: true,
    ...(config.systemTtl === "1h" ? { promptCacheTtl: "1h" as const } : {}),
    ...(nonce ? { cacheBreakNonce: nonce } : {}),
  };
}

function formatBreakCacheStatus(context: TuiContext): string {
  const current = getCurrentFreshness(context);
  const changed = diffFreshness(context.cache.lastFreshness, current);
  const keys =
    changed.length > 0
      ? changed
      : context.cache.lastFreshness?.changedKeys.length
        ? context.cache.lastFreshness.changedKeys
        : (context.cache.history.at(-1)?.freshness.changedKeys ?? []);
  // D.13F：standalone marker mode 与最近事件摘要，仅作只读展示。
  const marker = readBreakCacheMarkerSync(context);
  const recentEvents = readRecentBreakCacheEventsSync(context, 3);
  return [
    "Break-cache status",
    `- systemPromptHash: ${current.systemPromptHash}`,
    `- toolSchemaHash: ${current.toolSchemaHash}`,
    `- mcpToolListHash: ${current.mcpToolListHash}`,
    `- modelProviderHash: ${current.modelProviderHash}`,
    `- reasoningEffortHash: ${current.reasoningEffortHash ?? "-"}`,
    `- projectRulesHash: ${current.projectRulesHash ?? "-"}`,
    `- memoryHash: ${current.memoryHash ?? "-"}`,
    `- compactHash: ${current.compactHash ?? "-"}`,
    `- pluginListHash: ${current.pluginListHash ?? "-"}`,
    `- endpointProfileHash: ${current.endpointProfileHash ?? "-"}`,
    `- cacheControlHash: ${current.cacheControlHash ?? "-"}`,
    `- cacheTtlHash: ${current.cacheTtlHash ?? "-"}`,
    `- promptCache: enabled=${context.config.promptCache.enabled ? "yes" : "no"} systemTtl=${context.config.promptCache.systemTtl}`,
    `- mode: ${marker.mode}${marker.nonce ? ` nonce=${marker.nonce.slice(0, 8)}…` : ""}${marker.mode === "always" ? "（固定 break-cache namespace；不会每次请求都破坏缓存）" : ""}`,
    `- recent break-cache events: ${recentEvents.length === 0 ? "none" : recentEvents.map((event) => `${event.action}@${event.createdAt}`).join("; ")}`,
    `- changedKeys: ${keys.length > 0 ? keys.join(", ") : "none"}`,
    "- usage: /break-cache status | once | always | off | --clear；marker 与 event 仅记录动作，不记录 prompt/key/raw request/response。always=固定 nonce 切到新 cache namespace（stable nonce），不是每次请求都破坏缓存。",
    "- suggestion: 如 system prompt / tool schema / MCP list / model/provider / memory / compact / plugin list / endpoint profile / cacheControl / cacheTtl 变化，可运行 /cache warmup 或 /cache refresh；不会替你自动执行。",
  ].join("\n");
}

function formatUsage(context: TuiContext): string {
  const totals = sumCacheHistory(context.cache.history);
  const latest = context.cache.history.at(-1);
  return [
    "Usage（本会话原始 token/cache usage）",
    `- input tokens: ${totals.inputTokens}`,
    `- output tokens: ${totals.outputTokens}`,
    `- cache read tokens: ${totals.cacheReadTokens}`,
    `- cache write/create tokens: ${totals.cacheWriteTokens}`,
    `- model: ${latest?.model ?? context.model}`,
    `- provider: ${latest?.provider ?? "unknown"}`,
    `- endpoint: ${latest?.endpoint ?? CHAT_COMPLETIONS_ENDPOINT}`,
    `- compact: ${context.cache.compacted ? "yes" : "no"}`,
    `- rawUsage records: ${context.cache.history.filter((item) => item.rawUsage !== undefined).length}`,
    "- role usage (estimated):",
    ...formatRoleUsageLines(context),
    "- billing: 未记录真实账单字段；任何金额只能标记 estimated。",
  ].join("\n");
}

function formatRoleUsageLines(context: TuiContext): string[] {
  if (context.roleUsage.length === 0) {
    return ["  - none yet"];
  }
  return context.roleUsage.map(
    (usage) =>
      `  - ${usage.role}/${usage.provider}/${usage.model}: input=${usage.inputTokens} output=${usage.outputTokens} cache_read=${usage.cacheReadTokens} cache_write=${usage.cacheWriteTokens} estimatedCny=${usage.estimatedCny.toFixed(4)} estimated createdAt=${usage.createdAt} fallbackUsed=${usage.fallbackUsed ? "yes" : "no"} budgetStop=${usage.budgetStop ? "yes" : "no"} contribution=${usage.contributionSummary}`,
  );
}

function formatStats(args: string[], context: TuiContext): string {
  if (args[0] === "endpoints") {
    return formatEndpointStats(context.cache.history);
  }
  const totals = sumCacheHistory(context.cache.history);
  const latest = context.cache.history.at(-1);
  const provider = latest?.provider ?? "unknown";
  const hitRate = computePromptCacheHitRate({
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    provider,
    model: context.model,
  });
  return [
    "Stats",
    `- samples: ${context.cache.history.length}`,
    `- elapsedMs: ${Date.now() - context.cache.startedAt}`,
    `- model: ${context.model}`,
    `- provider: ${provider}`,
    `- hitRate: ${formatPercent(hitRate)}`,
    `- tokens: input=${totals.inputTokens}, output=${totals.outputTokens}, cache_read=${totals.cacheReadTokens}, cache_write=${totals.cacheWriteTokens}`,
    "- role/model/provider usage (estimated):",
    ...formatRoleUsageLines(context),
    "- cost: estimated unavailable（未配置价格；不伪装成真实账单；状态栏不显示金额）",
  ].join("\n");
}

function formatEndpointStats(history: CacheTurnStats[]): string {
  if (history.length === 0) {
    return "Endpoint stats：暂无样本。";
  }
  const groups = new Map<string, CacheTurnStats[]>();
  for (const item of history) {
    const key = item.endpoint ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [
    "Endpoint stats",
    ...[...groups.entries()].map(([endpoint, items]) => {
      const totals = sumCacheHistory(items);
      const hitRate = computePromptCacheHitRate({
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheWriteTokens: totals.cacheWriteTokens,
        provider: items[0]?.provider ?? "unknown",
        model: items[0]?.model ?? "unknown",
      });
      return `- ${endpoint}: samples=${items.length} hitRate=${formatPercent(hitRate)} input=${totals.inputTokens} output=${totals.outputTokens} cache_read=${totals.cacheReadTokens} cache_write=${totals.cacheWriteTokens}`;
    }),
  ].join("\n");
}

function sumCacheHistory(history: CacheTurnStats[]): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  return history.reduce(
    (total, item) => ({
      inputTokens: total.inputTokens + item.inputTokens,
      outputTokens: total.outputTokens + item.outputTokens,
      cacheReadTokens: total.cacheReadTokens + item.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + item.cacheWriteTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function collectLightHints(context: TuiContext): LightHint[] {
  const latest = context.cache.history.at(-1);
  const hints: LightHint[] = [];
  if (
    latest?.hitRate !== null &&
    latest?.hitRate !== undefined &&
    latest.hitRate < context.cache.config.warnBelowHitRate
  ) {
    hints.push(
      createLightHint(
        "cache-hit-low",
        "warning",
        10,
        context.language === "en-US"
          ? "Reuse became less effective in the latest turn"
          : "最近一轮复用效果变低",
        "/break-cache status",
      ),
    );
  }
  if ((latest?.inputTokens ?? 0) > 96_000) {
    hints.push(
      createLightHint(
        "context-long",
        "info",
        4,
        context.language === "en-US"
          ? "This conversation is getting long; compact only if it starts feeling slow"
          : "这轮对话较长；如果开始变慢，再按需压缩",
        "/compact",
      ),
    );
  }
  if (latest?.cacheWriteTokensSource === "zero_reported" && latest.cacheReadTokens > 0) {
    hints.push(
      createLightHint(
        "cache-zero-create-with-read",
        "info",
        2,
        context.language === "en-US"
          ? "Usage numbers may need checking before cost claims"
          : "要下成本结论前，建议先核对用量口径",
        "/usage",
      ),
    );
  }
  const changedKeys = latest?.freshness.changedKeys ?? [];
  if (
    changedKeys.some((key) =>
      ["systemPromptHash", "toolSchemaHash", "mcpToolListHash"].includes(key),
    )
  ) {
    hints.push(
      createLightHint(
        "freshness-changed",
        "warning",
        8,
        context.language === "en-US"
          ? "Project context changed; refresh reuse data when results look stale"
          : "项目上下文有变化；结果像旧信息时再刷新复用数据",
        "/cache warmup",
      ),
    );
  }
  return hints;
}

function createLightHint(
  dedupeKey: string,
  severity: "info" | "warning",
  priority: number,
  message: string,
  suggestedCommand: string,
): LightHint {
  return {
    id: randomUUID(),
    severity,
    priority,
    message,
    suggestedCommand,
    dedupeKey,
    cooldownMs: DEFAULT_LIGHT_HINT_COOLDOWN_MS,
  };
}

function writeLightHints(output: Writable, context: TuiContext): void {
  if (context.cache.config.hintsMuted) {
    return;
  }
  const now = Date.now();
  const visibleHints = collectLightHints(context)
    .filter((hint) => now - (context.cache.hintLastShownAt[hint.dedupeKey] ?? 0) >= hint.cooldownMs)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_LIGHT_HINTS_PER_TURN);
  // D.13L Block F — 主屏轻提示说人话：不再用 "[提示:warning] ... ；下一步：/break-cache status"
  // 这种内部术语 + 强 slash 推送的格式。改成单行平铺：dedupeKey 决定语气，
  //   - cache-hit-low → "最近缓存复用变低，后续响应可能会慢一点。"
  //   - context-long → "这轮对话较长；如果开始变慢，再按需压缩。"
  //   - cache-zero-create-with-read → "用量数据可能需要复核后再下结论。"
  //   - freshness-changed → "项目上下文有变化；结果像旧信息时再刷新。"
  // suggestedCommand 仍保留在 LightHint 上，给 /usage / /stats / /details 路径
  // 当数据点用，不再贴到主屏行。
  for (const hint of visibleHints) {
    context.cache.hintLastShownAt[hint.dedupeKey] = now;
    writeLine(output, formatPlainLightHint(hint, context.language));
  }
}

function formatPlainLightHint(hint: LightHint, language: TuiContext["language"]): string {
  const isEn = language === "en-US";
  switch (hint.dedupeKey) {
    case "cache-hit-low":
      return isEn
        ? "Cache reuse dipped a bit; the next response may be slower."
        : "最近缓存复用变低，后续响应可能会慢一点。";
    case "context-long":
      return isEn
        ? "This conversation is getting long; compact only if it starts feeling slow."
        : "这轮对话较长；如果开始变慢，再按需压缩。";
    case "cache-zero-create-with-read":
      return isEn
        ? "Usage numbers may need a quick check before drawing cost conclusions."
        : "用量数据可能需要复核后再下结论。";
    case "freshness-changed":
      return isEn
        ? "Project context changed; refresh reuse data when results look stale."
        : "项目上下文有变化；结果像旧信息时再刷新。";
    default:
      return hint.message;
  }
}

export function writeLightHintsForTest(output: Writable, context: TuiContext): void {
  writeLightHints(output, context);
}

async function handleVerifyCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action === "last") {
    writeLine(output, formatVerificationLast(context.lastVerification, context.language));
    return;
  }

  const plan = await createVerificationPlan(
    context.projectPath,
    action === "smoke" ? "smoke" : "default",
  );
  if (action === "plan") {
    writeLine(output, formatVerificationPlan(plan, context.language));
    return;
  }
  if (action && action !== "smoke") {
    writeLine(output, "用法：/verify | /verify plan | /verify last | /verify smoke");
    return;
  }

  const guard = checkBackgroundStartGuard(context, "verification", true);
  if (guard) {
    writeLine(output, guard);
    return;
  }

  const sessionId = await ensureSession(context);
  const report = await runVerificationPlan(plan, context, sessionId, output);
  context.lastVerification = report;
  await recordVerificationEvidence(context, sessionId, report);
  writeLine(output, formatVerificationReport(report, context.language));
  writeStatus(output, context);
}

async function handleReviewCommand(context: TuiContext, output: Writable): Promise<void> {
  const sessionId = await ensureSession(context);
  const resolved = resolveRoleRoute(context, "reviewer", "/review");
  await appendRouteDecisionEvent(context, sessionId, resolved.decision);
  if (!resolved.usable) {
    writeLine(output, formatRoutePauseMessage("reviewer", resolved.decision));
    return;
  }
  const report = createReviewReport(context);
  const handoff = createRoleHandoff("executor", "reviewer", "review", report, context);
  context.roleHandoffs.unshift(handoff);
  addRoleUsage(
    context,
    "reviewer",
    resolved.route,
    Math.ceil(report.length / 8),
    Math.ceil(report.length / 4),
    "read-only review handoff",
  );
  await appendSystemEvent(context, sessionId, `review: ${report.replace(/\s+/g, " ")}`, "info");
  writeLine(output, report);
  writeLine(
    output,
    `Role handoff: ${handoff.from} -> ${handoff.to}；只传 summary/evidence/diff/verification/keyFiles。`,
  );
}

async function handleVisionCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const sourcePath = args.join(" ").trim();
  if (!sourcePath) {
    writeLine(
      output,
      "用法：/vision <image-or-screenshot-path>。vision role 不执行 Bash、不改代码，只记录 VisionObservation evidence。",
    );
    return;
  }
  const sessionId = await ensureSession(context);
  const resolved = resolveRoleRoute(context, "vision", "/vision");
  await appendRouteDecisionEvent(context, sessionId, resolved.decision);
  if (!resolved.usable) {
    writeLine(
      output,
      `vision role 未就绪：${formatRoutePauseMessage("vision", resolved.decision)}`,
    );
    return;
  }
  const route = resolved.route;
  const evidence = createEvidenceRecord(
    "vision_observation",
    `VisionObservation: provider=${route.provider}, model=${route.primaryModel}, source=${sourcePath}`,
    sourcePath,
    ["vision_observation", "视觉观察", "image evidence"],
  );
  const observation: VisionObservation = {
    id: `vision-${randomUUID().slice(0, 8)}`,
    source: "image",
    provider: route.provider,
    model: route.primaryModel,
    summary: `Vision observation metadata recorded for ${sourcePath}.`,
    extractedText: [],
    uiRegions: [],
    suspectedFiles: [],
    confidence: 0.5,
    evidenceRefs: [pickEvidence(evidence)],
    createdAt: evidence.createdAt,
  };
  context.visionObservations.unshift(observation);
  rememberEvidence(context, evidence);
  addRoleUsage(
    context,
    "vision",
    route,
    Math.ceil(sourcePath.length / 4),
    Math.ceil(observation.summary.length / 4),
  );
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
  writeLine(output, `VisionObservation: ${observation.id}`);
  writeLine(output, `- provider/model: ${route.provider}/${route.primaryModel}`);
  writeLine(output, `- source: ${sourcePath}`);
  writeLine(output, "- boundary: vision role 只写入 evidence，不执行 Bash、不改代码。");
}

async function handleImageCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action !== "generate") {
    writeLine(
      output,
      "用法：/image generate <prompt>。image role 不执行 Bash、不改代码、不覆盖原图。",
    );
    return;
  }
  const prompt = args.slice(1).join(" ").trim();
  if (!prompt) {
    writeLine(output, "用法：/image generate <prompt>");
    return;
  }
  const sessionId = await ensureSession(context);
  const resolved = resolveRoleRoute(context, "image", "/image generate");
  await appendRouteDecisionEvent(context, sessionId, resolved.decision);
  if (!resolved.usable) {
    writeLine(output, `image role 未就绪：${formatRoutePauseMessage("image", resolved.decision)}`);
    return;
  }
  const route = resolved.route;
  const id = `image-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const outputDir = join(context.projectPath, ".linghun", "assets");
  await mkdir(outputDir, { recursive: true });
  const assetPath = join(outputDir, `${id}.json`);
  const result: ImageGenerationResult = {
    id,
    provider: route.provider,
    model: route.primaryModel,
    images: [{ path: assetPath, mimeType: "application/json", revisedPrompt: prompt }],
    evidenceRefs: [],
    createdAt: now,
  };
  await writeFile(
    assetPath,
    `${JSON.stringify(
      {
        kind: "image_generation_metadata",
        prompt,
        provider: route.provider,
        model: route.primaryModel,
        note: "Image result metadata recorded; no size/quality/format was fixed unless user specified it.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const evidence = createEvidenceRecord(
    "image_result",
    `ImageGenerationResult ${id}: provider=${route.provider}, model=${route.primaryModel}, asset=${assetPath}`,
    assetPath,
    ["image_result", "生图结果", "image generated"],
  );
  const guard = checkBackgroundStartGuard(context, "agent");
  if (guard) {
    writeLine(output, guard);
    return;
  }
  result.evidenceRefs.push(pickEvidence(evidence));
  context.imageResults.unshift(result);
  rememberEvidence(context, evidence);
  addRoleUsage(context, "image", route, Math.ceil(prompt.length / 4), 0);
  const task: BackgroundTaskState = {
    id,
    kind: "agent",
    title: `Image generate: ${truncateDisplay(prompt, 40)}`,
    status: "completed",
    currentStep: "image result metadata saved",
    progress: { completed: 1, total: 1, label: "image" },
    startedAt: now,
    updatedAt: now,
    lastOutputAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    outputPath: assetPath,
    hasOutput: true,
    result: "pass",
    userVisibleSummary: `image 结果已落盘：${assetPath}`,
    nextAction: "查看 evidence 或把资产路径交给 executor；image role 不改代码。",
  };
  rememberBackgroundTask(context, task);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
  await appendBackgroundTaskEvent(context, sessionId, task);
  writeLine(output, `ImageGenerationResult: ${id}`);
  writeLine(output, `- provider/model: ${route.provider}/${route.primaryModel}`);
  writeLine(output, `- asset path: ${assetPath}`);
  writeLine(output, "- request: 未固定 size/quality/format；只有用户明确指定才传。 ");
}

async function createVerificationPlan(
  projectPath: string,
  mode: "default" | "smoke",
): Promise<VerificationStep[]> {
  if (mode === "smoke") {
    return [
      {
        kind: "smoke",
        command: "node -e \"console.log('linghun verify smoke')\"",
        reason: "最小 smoke 验证，确认 Verification Runner 可执行命令并归档 evidence。",
      },
    ];
  }

  const packageJson = await safeReadJson(join(projectPath, "package.json"));
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  const steps: VerificationStep[] = [];
  addPackageStep(steps, scripts, "typecheck", "typecheck", "TypeScript 类型检查。 ");
  addPackageStep(steps, scripts, "test", "test", "项目测试套件。 ");
  addPackageStep(steps, scripts, "lint", "lint", "lint 静态检查。 ");
  addPackageStep(steps, scripts, "build", "build", "构建验证。 ");
  addPackageStep(steps, scripts, "smoke", "smoke", "项目自定义 smoke 验证。 ");

  if (steps.length > 0) {
    return steps;
  }
  return [
    {
      kind: "smoke",
      command: "node --version",
      reason: "未发现项目验证脚本，降级为 Node 运行环境 smoke 检查。",
    },
  ];
}

function addPackageStep(
  steps: VerificationStep[],
  scripts: Record<string, unknown>,
  scriptName: string,
  kind: VerificationStepKind,
  reason: string,
): void {
  if (typeof scripts[scriptName] !== "string") {
    return;
  }
  steps.push({ kind, command: `corepack pnpm ${scriptName}`, reason });
}

async function runVerificationPlan(
  plan: VerificationStep[],
  context: TuiContext,
  sessionId: string,
  output: Writable,
): Promise<VerificationReport> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const logRoot = join(context.projectPath, ".linghun", "logs", "verification");
  await mkdir(logRoot, { recursive: true });
  const controller = new AbortController();
  context.activeVerificationAbortController = controller;
  context.interrupt = { type: "running", taskId: runId, canCancel: true };
  const task: BackgroundTaskState = {
    id: runId,
    kind: "verification",
    title: "Verification Runner",
    status: "running",
    currentStep: "preparing verification",
    progress: { completed: 0, total: plan.length, label: "verify" },
    startedAt,
    updatedAt: startedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    logPath: logRoot,
    hasOutput: false,
    userVisibleSummary: `验证已启动：${plan.length} 个步骤。可用 /background 查看详情。`,
    nextAction: "等待 PASS / FAIL / PARTIAL 结果，失败后按建议修复并复跑 /verify。",
  };
  rememberBackgroundTask(context, task);
  await context.store.appendEvent(sessionId, {
    type: "verification_start",
    run: { id: runId, plan, startedAt },
    createdAt: startedAt,
  });
  await appendBackgroundTaskEvent(context, sessionId, task);
  writeLine(output, formatBackgroundTask(task, context.language));

  const results: VerificationCommandResult[] = [];
  const unverified: string[] = [];
  const risk: string[] = [];
  try {
    for (const [index, step] of plan.entries()) {
      const stepStarted = Date.now();
      task.currentStep = `${step.kind} ${index + 1}/${plan.length}`;
      task.progress = { completed: index, total: plan.length, label: step.kind };
      task.updatedAt = new Date().toISOString();
      await appendBackgroundTaskEvent(context, sessionId, task);
      writeLine(output, `验证步骤：${task.currentStep} · ${step.command}`);

      const logPath = join(logRoot, `${runId}-${index + 1}-${step.kind}.log`);
      const result = await runVerificationCommand(
        step.command,
        context.projectPath,
        controller.signal,
      );
      const durationMs = Date.now() - stepStarted;
      const runnerErrorLine = result.runnerError ? `runnerError=${result.runnerError}\n` : "";
      const fullLog = `$ ${step.command}\nexitCode=${result.exitCode}\noutcome=${result.outcome}\n${runnerErrorLine}durationMs=${durationMs}\n\n${result.output}`;
      await writeFile(logPath, fullLog, "utf8");
      const summary = summarizeVerificationOutput(
        result.output,
        result.exitCode,
        result.runnerError,
      );
      const wasMarkedStale = task.status === "stale";
      const commandStatus: VerificationRuntimeStatus =
        result.outcome === "cancelled"
          ? "cancelled"
          : result.outcome === "timeout"
            ? "timeout"
            : wasMarkedStale
              ? "stale"
              : result.runnerError
                ? "partial"
                : result.exitCode === 0
                  ? "pass"
                  : "fail";
      if (commandStatus === "fail") {
        risk.push(`${step.kind} 失败：${summary}`);
      }
      if (commandStatus === "partial") {
        unverified.push(`${step.kind} runner error：${summary}`);
        risk.push(`${step.kind} runner/toolchain 兼容风险：${summary}`);
      }
      if (commandStatus === "cancelled" || commandStatus === "timeout") {
        unverified.push(`${step.kind} ${commandStatus}：${summary}`);
        risk.push(`${step.kind} 未完成：${commandStatus}；不得生成 PASS 证据。`);
      }
      if (commandStatus === "stale") {
        unverified.push(`${step.kind} stale：${summary}`);
        risk.push(`${step.kind} 曾被标记为 stale；即使命令随后结束，也不得生成 PASS 证据。`);
      }
      results.push({
        ...step,
        status: commandStatus,
        exitCode: result.exitCode,
        durationMs,
        logPath,
        summary,
        runnerError: result.runnerError,
      });
      task.lastOutputAt = new Date().toISOString();
      task.hasOutput = Boolean(result.output.trim());
      if (
        commandStatus === "cancelled" ||
        commandStatus === "timeout" ||
        commandStatus === "stale"
      ) {
        break;
      }
    }

    const endedAt = new Date().toISOString();
    const failed = results.filter((item) => item.status === "fail");
    const partial = results.filter((item) => item.status === "partial");
    const cancelled = results.filter((item) => item.status === "cancelled");
    const timedOut = results.filter((item) => item.status === "timeout");
    const stale = results.filter((item) => item.status === "stale");
    const hasRunnerError = partial.some((item) => item.runnerError);
    const status: VerificationReport["status"] =
      cancelled.length > 0
        ? "cancelled"
        : timedOut.length > 0
          ? "timeout"
          : stale.length > 0
            ? "stale"
            : failed.length > 0
              ? "fail"
              : partial.length > 0 || unverified.length > 0
                ? "partial"
                : "pass";
    const report: VerificationReport = {
      id: runId,
      status,
      summary:
        status === "pass"
          ? `PASS：${results.length} 个验证步骤通过。`
          : status === "fail"
            ? `FAIL：${failed.length}/${results.length} 个验证步骤失败。`
            : status === "cancelled"
              ? "CANCELLED：验证已取消，未生成 PASS 证据。"
              : status === "timeout"
                ? "TIMEOUT：验证超时，未生成 PASS 证据。"
                : status === "stale"
                  ? "STALE：验证任务疑似卡住，未生成 PASS 证据。"
                  : hasRunnerError
                    ? "PARTIAL：验证命令已运行，但 runner/toolchain 退出清理异常。"
                    : `PARTIAL：${unverified.length} 项未验证。`,
      commands: results,
      unverified,
      risk,
      logPath: logRoot,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      nextAction:
        status === "pass"
          ? "可继续审查结果或进入交付总结。"
          : hasRunnerError
            ? "查看 runner error 日志，记录 Node 版本，并建议用 Node 22 LTS 复核。"
            : "先查看失败命令与日志，修复后复跑 /verify。",
    };
    task.status =
      status === "fail"
        ? "failed"
        : status === "cancelled" || status === "timeout" || status === "stale"
          ? status
          : "completed";
    task.result = status;
    task.currentStep = status === "pass" ? "verification finished" : `verification ${status}`;
    task.progress = { completed: results.length, total: plan.length, label: "verify" };
    task.updatedAt = endedAt;
    task.nextAction = report.nextAction;
    task.userVisibleSummary = report.summary;
    await appendBackgroundTaskEvent(context, sessionId, task);
    await context.store.appendEvent(sessionId, {
      type: "verification_end",
      report,
      createdAt: endedAt,
    });
    return report;
  } finally {
    if (context.activeVerificationAbortController === controller) {
      context.activeVerificationAbortController = undefined;
    }
    context.interrupt = { type: "idle" };
  }
}

async function runVerificationCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = VERIFICATION_COMMAND_TIMEOUT_MS,
): Promise<{
  exitCode: number;
  output: string;
  outcome: "completed" | "timeout" | "cancelled";
  runnerError?: string;
}> {
  return new Promise((resolveCommand) => {
    const detached = process.platform !== "win32";
    const child = spawn(command, { cwd, shell: true, detached, windowsHide: true });
    const guard = createProcessGuard();
    guard.track(child, { detached, label: "verification" });
    let output = "";
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const scheduleForceStop = () => {
      forceTimer = setTimeout(() => guard.requestStop(true), 1_000);
    };
    const settle = (result: {
      exitCode: number;
      output: string;
      outcome?: "completed" | "timeout" | "cancelled";
      runnerError?: string;
    }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceTimer && result.outcome === undefined) {
        clearTimeout(forceTimer);
      }
      signal?.removeEventListener("abort", onAbort);
      resolveCommand({ ...result, outcome: result.outcome ?? "completed" });
    };
    const onAbort = () => {
      const runnerError = "runner cancelled by interrupt";
      output = output ? `${output}\n${runnerError}` : runnerError;
      guard.requestStop(false);
      scheduleForceStop();
      settle({ exitCode: 1, output, outcome: "cancelled", runnerError });
    };
    const timeout = setTimeout(() => {
      const runnerError = `runner timeout after ${timeoutMs}ms`;
      output = output ? `${output}\n${runnerError}` : runnerError;
      guard.requestStop(false);
      scheduleForceStop();
      settle({ exitCode: 1, output, outcome: "timeout", runnerError });
    }, timeoutMs);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      const runnerError = `runner error: ${error.message}`;
      settle({
        exitCode: 1,
        output: output ? `${output}\n${runnerError}` : runnerError,
        runnerError,
      });
    });
    child.on("close", (code, childSignal) => {
      const exitCode = code ?? 1;
      const runnerError = detectRunnerCompatibilityError(output, exitCode, childSignal);
      settle({ exitCode, output, runnerError });
    });
  });
}

export async function runVerificationCommandForTest(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): ReturnType<typeof runVerificationCommand> {
  return runVerificationCommand(command, cwd, signal, timeoutMs);
}

function detectRunnerCompatibilityError(
  output: string,
  exitCode: number,
  signal: NodeJS.Signals | null,
): string | undefined {
  if (signal) {
    return `runner stopped by signal ${signal}`;
  }
  if (exitCode === 0) {
    return undefined;
  }
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const normalized = output.replace(ansiPattern, "");
  const vitestPassed =
    /Test Files\s+\d+\s+passed/i.test(normalized) && /Tests\s+\d+\s+passed/i.test(normalized);
  const nodeCleanupError =
    normalized.includes("TypeError: emitter.removeListener is not a function") ||
    normalized.includes("emitter.removeListener is not a function");
  if (vitestPassed && nodeCleanupError) {
    return "runner/toolchain cleanup error after tests passed; verify again with Node 22 LTS";
  }
  const childSignal = normalized.match(/\bSIG(?:TERM|KILL|INT|HUP|ABRT)\b/);
  if (childSignal) {
    return `runner/child stopped by signal ${childSignal[0]}`;
  }
  return undefined;
}

async function recordVerificationEvidence(
  context: TuiContext,
  sessionId: string,
  report: VerificationReport,
): Promise<void> {
  const supportsClaims =
    report.status === "pass"
      ? ["已验证", "验证通过", "测试通过", "verified", "tests passed"]
      : ["verification attempted", `verification:${report.status}`, "未通过验证", "需要复核"];
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind: "test_result",
    summary: `${report.status.toUpperCase()} ${report.summary} 日志：${report.logPath ?? "无日志"}`,
    source: report.logPath ?? "Verification Runner",
    supportsClaims,
    createdAt: new Date().toISOString(),
  };
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
}

function createReviewReport(context: TuiContext): string {
  const changedFiles =
    context.tools.changedFiles.length > 0 ? context.tools.changedFiles : ["未记录改动"];
  const verification = context.lastVerification;
  const conservativeStatuses: VerificationReport["status"][] = [
    "fail",
    "partial",
    "cancelled",
    "timeout",
    "stale",
  ];
  const conservative = verification ? conservativeStatuses.includes(verification.status) : true;
  const priority =
    verification?.status === "fail" ||
    verification?.status === "timeout" ||
    verification?.status === "stale"
      ? "P0"
      : conservative
        ? "P1"
        : "P2";
  const risk = verification
    ? verification.risk.length > 0
      ? verification.risk.join("; ")
      : `最近验证为 ${verification.status.toUpperCase()}`
    : "尚未运行 /verify，不能声称 PASS 或已验证。";
  const suggestion =
    verification?.status === "fail"
      ? "先按失败命令日志修复，再复跑 /verify。"
      : verification?.status === "partial"
        ? "先查看 runner error 日志；如为 Node/工具链退出清理异常，建议用 Node 22 LTS 复核。"
        : verification?.status === "cancelled"
          ? "验证已取消；先确认取消原因，再复跑 /verify，当前不得给 PASS verdict。"
          : verification?.status === "timeout"
            ? "验证超时；先查看日志和进程清理情况，缩小命令或修复卡住点后复跑。"
            : verification?.status === "stale"
              ? "验证任务疑似卡住；先查看 /background 和日志，必要时 /interrupt 后复跑。"
              : verification
                ? "结合 diff 人工确认需求覆盖；如有新改动请复跑 /verify。"
                : "先运行 /verify 或 /verify plan，形成 test_result evidence。";
  return [
    "Review Report",
    `- Priority: ${priority}`,
    `- Files: ${changedFiles.join(", ")}`,
    `- Risk: ${risk}`,
    `- Verdict: ${verification?.status === "pass" ? "SCOPED_PASS_WITH_EVIDENCE" : "CONSERVATIVE_NO_PASS"}`,
    `- Suggestion: ${suggestion}`,
  ].join("\n");
}

function formatVerificationPlan(plan: VerificationStep[], language: Language): string {
  const header = language === "en-US" ? "Verification plan:" : "验证计划：";
  return [
    header,
    ...plan.map((step, index) => `${index + 1}. [${step.kind}] ${step.command} — ${step.reason}`),
  ].join("\n");
}

function formatVerificationReport(report: VerificationReport, language: Language): string {
  const lines = [
    `${report.status.toUpperCase()} ${report.summary}`,
    language === "en-US" ? `Duration: ${report.durationMs}ms` : `耗时：${report.durationMs}ms`,
  ];
  for (const command of report.commands) {
    lines.push(
      `- [${command.status.toUpperCase()}] ${command.command} (${command.durationMs}ms) log: ${command.logPath ?? "无日志"}`,
    );
    if (command.status !== "pass") {
      lines.push(`  摘要：${command.summary}`);
    }
  }
  if (report.unverified.length > 0) {
    lines.push(`未验证：${report.unverified.join("; ")}`);
  }
  lines.push(`下一步：${report.nextAction}`);
  return lines.join("\n");
}

function formatVerificationLast(
  report: VerificationReport | undefined,
  language: Language,
): string {
  if (!report) {
    return language === "en-US" ? "No verification has run yet." : "还没有最近验证结果。";
  }
  return formatVerificationReport(report, language);
}

function summarizeVerificationOutput(
  output: string,
  exitCode: number,
  runnerError?: string,
): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-6).join(" | ");
  const summary = tail ? truncateDisplay(tail, 240) : "无输出";
  return runnerError
    ? `exitCode=${exitCode}; runner error=${runnerError}; ${summary}`
    : `exitCode=${exitCode}; ${summary}`;
}

async function safeReadJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCompositeStatusQuery(text: string, context: TuiContext): string | null {
  const normalized = text.trim().toLowerCase();
  if (
    !/(状态|正常|吗|准备好|配好|可用|ready|status|doctor|configured|available|working)/i.test(
      normalized,
    )
  ) {
    return null;
  }
  const sections: string[] = [];
  const add = (key: string, line: string): void => {
    if (matchesCompositeStatusKey(normalized, key)) {
      sections.push(line);
    }
  };

  add(
    "model",
    `- model/provider: provider=${getRuntimeStatusProvider(context)} model=${context.model}`,
  );
  add(
    "index",
    `- index: status=${context.index.status} changedFiles=${context.index.changedFiles ?? "-"}`,
  );
  add(
    "permission",
    `- permissions: mode=${context.permissionMode} recentDenied=${context.permissions.recentDenied.length}`,
  );
  add(
    "cache",
    `- cache: latestHitRate=${context.cache.history[0]?.hitRate ?? "-"} changedKeys=${context.cache.lastFreshness?.changedKeys?.join(",") || "-"}`,
  );
  add(
    "memory",
    `- memory: projectRules=${context.memory.projectRulesExists ? "found" : "missing"} candidates=${context.memory.candidates.length} accepted=${context.memory.accepted.length}`,
  );
  add(
    "mcp",
    `- mcp: enabled=${context.mcp.enabled ? "yes" : "no"} servers=${context.mcp.servers.length} tools=${context.mcp.tools.length}`,
  );
  add(
    "background",
    `- background: tasks=${context.backgroundTasks.length} running=${context.backgroundTasks.filter((task) => task.status === "running").length}`,
  );
  add(
    "gate",
    `- gate: pendingNaturalCommand=${context.pendingNaturalCommand ? context.pendingNaturalCommand.exactCommand : "none"}`,
  );

  if (sections.length < 2) {
    return null;
  }
  return [
    context.language === "en-US" ? "Composite local status" : "组合本地状态",
    ...sections,
    context.language === "en-US"
      ? "- next: use the exact slash command for details; this status was not sent to the model."
      : "- 下一步：需要细节时输入对应 slash command；本次状态查询未发送给模型。",
  ].join("\n");
}

function matchesCompositeStatusKey(text: string, key: string): boolean {
  const patterns: Record<string, RegExp> = {
    model: /模型|provider|route|model/,
    index: /索引|index|codebase-memory/,
    permission: /权限|permission|审批|mode|模式/,
    cache: /缓存|cache|hit rate|命中/,
    memory: /记忆|memory|linghun\.md|规则/,
    mcp: /\bmcp\b|codebase-memory|服务器/,
    background: /后台|background|任务|task/,
    gate: /gate|确认|confirmation|start gate|pending/,
  };
  return patterns[key]?.test(text) ?? false;
}

export async function handleNaturalInput(
  text: string,
  context: TuiContext,
  gatewayOrOutput: ModelGateway | Writable,
  maybeOutput?: Writable,
): Promise<"handled" | "message"> {
  const gateway = maybeOutput ? (gatewayOrOutput as ModelGateway) : undefined;
  const output = maybeOutput ?? (gatewayOrOutput as Writable);
  const pendingLocalApproval = context.pendingLocalApproval;
  if (pendingLocalApproval) {
    const normalized = text.trim().toLowerCase();
    if (/^(details|detail|详情|细节)$/iu.test(normalized)) {
      writeLine(output, formatPendingApprovalDetails(pendingLocalApproval, context));
      writeStatus(output, context);
      return "handled";
    }
    if (/^(yes|y|confirm|ok|okay|确认|是|继续|执行)$/iu.test(normalized)) {
      const approval = pendingLocalApproval;
      context.pendingLocalApproval = undefined;
      // D.13E Step 2 修正 #4：复用 executePermissionApprove，避免双实现漂移
      await executePermissionApprove(approval, context, gateway, output);
      return "handled";
    }
    if (/^(no|n|deny|取消|拒绝|不|否|cancel)$/iu.test(normalized)) {
      const approval = pendingLocalApproval;
      context.pendingLocalApproval = undefined;
      const cancelled = /^(cancel|取消)$/iu.test(normalized);
      await executePermissionDeny(approval, context, gateway, output, cancelled);
      return "handled";
    }
    writeLine(
      output,
      context.language === "en-US"
        ? "A local approval is pending. Type yes/confirm to allow once, or no/cancel to deny; this input was not sent to the model."
        : "当前有本地权限审批待处理。输入 yes/确认/继续 可本次允许，输入 no/取消 可拒绝；这条输入不会发送给模型。",
    );
    writeStatus(output, context);
    return "handled";
  }

  if (context.pendingNaturalCommand) {
    const gate = context.pendingNaturalCommand;
    if (/^(details|detail|详情|细节)$/iu.test(text.trim())) {
      writeLine(output, formatPendingNaturalCommandDetails(gate, context));
      writeStatus(output, context);
      return "handled";
    }
    const decision = matchesNaturalGateConfirmation(gate, text);
    if (decision === "expired") {
      context.pendingNaturalCommand = undefined;
      writeLine(output, t(context, "startGateExpired"));
      writeStatus(output, context);
      return "handled";
    }
    if (decision === "exact_required") {
      if (/^(yes|y|confirm|确认|是|执行|继续)$/iu.test(text.trim())) {
        writeLine(output, t(context, "startGatePlainConfirmationRejected"));
        writeStatus(output, context);
        return "handled";
      }
      writeLine(output, t(context, "startGateExactRequired"));
      writeStatus(output, context);
      return "handled";
    }
    if (decision === "confirmed") {
      context.pendingNaturalCommand = undefined;
      writeLine(output, t(context, "startGateConfirmed"));
      await appendNaturalGateDebugEvent(context, gate, "confirmed");
      const result = await handleSlashCommand(gate.exactCommand, context, output);
      return result === "message" ? "message" : "handled";
    }
    context.pendingNaturalCommand = undefined;
  }

  if (/^(yes|y|confirm|ok|okay|确认|是|继续|执行)$/iu.test(text.trim())) {
    writeLine(
      output,
      context.language === "en-US"
        ? "No pending confirmation is active. Describe the task or type the exact slash command; I did not send this confirmation to the model."
        : "当前没有等待确认的 Start Gate。请说明要做的任务，或输入精确 slash command；这条确认不会发送给模型。",
    );
    writeStatus(output, context);
    return "handled";
  }

  // Narrow workspace-trust intent (P3 收口): only the explicit "trust this folder /
  // 信任这个项目" wording opens a Start Gate. Everything else falls through to the
  // model — we do NOT restore the broad routeNaturalIntent / handleLocalControlPlaneInput
  // pre-route path that historically swallowed ordinary natural language.
  if (looksLikeWorkspaceTrustNaturalRequest(text)) {
    const intent = routeNaturalIntent(text, context.language);
    if (isWorkspaceTrustNaturalStartGate(intent)) {
      const gate = createPendingNaturalCommand(intent, context);
      if (gate) {
        context.pendingNaturalCommand = gate;
        writeLine(output, formatNaturalStartGate(intent, context, gate));
        writeStatus(output, context);
        return "handled";
      }
    }
  }

  if (shouldOfferUserScopedModelSetup(context) && looksLikeModelSetupInput(text)) {
    await startModelSetup(context, output, parseModelSetupPrefill(text));
    return "handled";
  }

  const indexRepair = await handleIndexSafetyRepairContinuation(text, context, output);
  if (indexRepair === "handled") {
    return "handled";
  }

  // CCB 输入路由边界：普通自然语言（不以 "/" 开头、无 pending approval/Start Gate）
  // 默认必须发送给模型。本地控制面（routeNaturalIntent / capability answer / composite
  // status / 文件读取兜底）不再前置截胡——历史上这条路径会把 "你好"/"模型这里是不是
  // 有问题"/"how do I configure model" 这种普通对话误识别成本地命令意图，让 gateway.stream
  // 永远不被触发。要使用本地控制面，请输入精确 slash command（例如 `/model doctor`）。
  if (!shouldTriggerArchitectureRuntime(text, context)) {
    context.currentArchitectureCard = undefined;
  }
  const modelGuard = checkResourceGuard(context, "model");
  if (modelGuard) {
    writeLine(output, modelGuard);
    return "handled";
  }
  if (context.memory.learningMode === "active") {
    await runAutoLearningOnTurnEnd(context, text);
  }
  return "message";
}

async function handleIndexSafetyRepairContinuation(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<"handled" | "pass"> {
  const riskyFiles = context.index.safetyRiskyFiles ?? [];
  if (riskyFiles.length === 0 || !context.index.safetyWarning) {
    return "pass";
  }
  const continuation = classifyIndexSafetyRepairContinuation(text, {
    hasSafetyWarning: Boolean(context.index.safetyWarning),
    riskyFileCount: riskyFiles.length,
  });
  if (continuation.action === "force") {
    writeLine(
      output,
      context.language === "en-US"
        ? "Index force/rebuild is not accepted through natural language. Type the exact high-risk slash command if you really want to force it."
        : "索引 force/rebuild 不能通过自然语言直通。如确需强制执行，请输入精确高风险 slash command。",
    );
    writeStatus(output, context);
    return "handled";
  }
  if (continuation.action !== "repair") {
    return "pass";
  }

  const plan = await createIndexSafetyRepairPlan(context, riskyFiles);
  writeLine(
    output,
    context.language === "en-US"
      ? [
          "Index safety repair continuation",
          "- action: append missing ignore entries, then refresh project index",
          `- ignore file: ${plan.path}`,
          `- entries: ${plan.missingEntries.length}`,
        ].join("\n")
      : [
          "索引安全修复续跑",
          "- 动作：追加缺失 ignore 条目，然后刷新项目索引",
          `- ignore 文件：${plan.path}`,
          `- 条目数量：${plan.missingEntries.length}`,
        ].join("\n"),
  );

  if (plan.missingEntries.length > 0) {
    const writeResult = await runIndexIgnoreWritePlan(plan, context, output);
    if (!writeResult) {
      writeStatus(output, context);
      return "handled";
    }
  } else {
    writeLine(
      output,
      context.language === "en-US"
        ? "Ignore write skipped: all risky files are already covered by the ignore file."
        : "ignore 写入跳过：风险文件已被 ignore 文件覆盖。",
    );
  }

  await runIndexRepository(context, context.config.index.mode, "refresh", false, output);
  writeLine(output, formatIndexRefreshSummary(context));
  writeStatus(output, context);
  return "handled";
}

type IndexSafetyRepairPlan = {
  path: ".linghunignore" | ".cbmignore";
  content: string;
  expectedHash?: string;
  missingEntries: string[];
};

async function createIndexSafetyRepairPlan(
  context: TuiContext,
  riskyFiles: IndexSafetyFile[],
): Promise<IndexSafetyRepairPlan> {
  const path = await chooseIndexIgnoreFile(context.projectPath);
  let current = "";
  let currentExists = true;
  try {
    current = await readFile(join(context.projectPath, path), "utf8");
  } catch {
    current = "";
    currentExists = false;
  }
  const existing = current
    .split(/\r?\n/u)
    .map((line) => normalizePath(line.trim()))
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const missingEntries = uniqueStrings(riskyFiles.map((file) => file.path)).filter(
    (entry) => !isIgnoredIndexPath(entry, existing),
  );
  const needsTrailingNewline = current.length > 0 && !current.endsWith("\n");
  const content =
    missingEntries.length === 0
      ? current
      : `${current}${needsTrailingNewline ? "\n" : ""}${missingEntries.join("\n")}\n`;
  return {
    path,
    content,
    expectedHash: currentExists ? hashFileContent(current) : undefined,
    missingEntries,
  };
}

async function chooseIndexIgnoreFile(
  projectPath: string,
): Promise<".linghunignore" | ".cbmignore"> {
  const linghunPath = join(projectPath, ".linghunignore");
  const cbmPath = join(projectPath, ".cbmignore");
  if (!(await pathExists(linghunPath)) && (await pathExists(cbmPath))) {
    return ".cbmignore";
  }
  return ".linghunignore";
}

async function runIndexIgnoreWritePlan(
  plan: IndexSafetyRepairPlan,
  context: TuiContext,
  output: Writable,
): Promise<boolean> {
  const sessionId = await ensureSession(context);
  const input = { path: plan.path, content: plan.content, expectedHash: plan.expectedHash };
  const permission = await decidePermission("Write", input, context, sessionId);
  await context.store.appendEvent(sessionId, {
    type: "permission_request",
    request: permission.request,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(sessionId, {
    type: "permission_result",
    requestId: permission.request.id,
    decision: permission.decision,
    reason: permission.reason,
    createdAt: new Date().toISOString(),
  });
  if (permission.decision === "ask") {
    context.pendingLocalApproval = { kind: "index_ignore_write", plan };
    writeLine(
      output,
      formatLocalToolPermissionPrompt(
        {
          toolName: "Write",
          decision: permission.decision,
          risk: permission.request.risk,
          mode: permission.request.mode,
          reason: permission.reason,
          scope: permission.request.files,
        },
        context.language,
      ),
    );
    return false;
  }
  if (permission.decision === "deny") {
    await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `permission ${permission.decision}: ${permission.reason}; ${permission.request.summary}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? `Permission blocked ignore write: ${permission.reason}\nNext: review /permissions recent or allow Write for ${plan.path}, then repeat the natural request.`
        : `权限阻止 ignore 写入：${permission.reason}\n下一步：查看 /permissions recent，或允许 Write 写入 ${plan.path} 后重试这条自然语言请求。`,
    );
    return false;
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  return executeIndexIgnoreWritePlan(plan, context, output);
}

async function executeIndexIgnoreWritePlan(
  plan: IndexSafetyRepairPlan,
  context: TuiContext,
  output: Writable,
): Promise<boolean> {
  const sessionId = await ensureSession(context);
  const input = { path: plan.path, content: plan.content, expectedHash: plan.expectedHash };
  const callId = randomUUID();
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: callId,
    name: "Write",
    input,
    createdAt: new Date().toISOString(),
  });
  try {
    const result = await runTool("Write", input, context.tools);
    await context.store.appendEvent(sessionId, createToolEndEvent(callId, result.output));
    const evidence = await recordToolEvidence(context, sessionId, "Write", result.output);
    rememberToolFiles(context, "Write", input, result.output);
    await appendToolResultEvent(
      context,
      sessionId,
      callId,
      "Write",
      result.output,
      false,
      evidence?.id,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? `Ignore write completed: ${plan.path}; entries=${plan.missingEntries.length}.`
        : `ignore 写入完成：${plan.path}；条目数量=${plan.missingEntries.length}。`,
    );
    return true;
  } catch (error) {
    const text = formatError(error, context.language);
    const evidence = await recordToolFailureEvidence(context, sessionId, "Write", text);
    await appendToolResultEvent(context, sessionId, callId, "Write", text, true, evidence.id);
    writeLine(
      output,
      context.language === "en-US"
        ? `${text}\nNext: fix the ignore file path or permissions, then retry the natural request.`
        : `${text}\n下一步：修复 ignore 文件路径或权限后，重试这条自然语言请求。`,
    );
    return false;
  }
}

function clearRequestActivity(context: TuiContext): void {
  const timer = context.requestActivity?.slowTimer;
  if (timer) {
    clearTimeout(timer);
  }
  context.requestActivity = undefined;
  context.requestActivityPhase = undefined;
  context.requestActivityToolName = undefined;
}

function startRequestActivity(
  output: Writable,
  context: TuiContext,
  phase: RequestActivityPhase,
  values: { reportPath?: string; toolName?: string } = {},
): void {
  clearRequestActivity(context);
  context.requestActivityPhase = phase;
  context.requestActivityToolName = values.toolName;
  // D13E-P3 single-thinking display: in Ink/Task mode the ActivityIndicator
  // (driven by context.requestActivityPhase via mapRequestActivityToView) is
  // the sole visible "thinking…" surface. Writing the same line into the
  // transcript via writeLine would produce a duplicated "正在思考…" / "Thinking…"
  // row that survives across rerenders. We detect Ink mode by checking whether
  // `output` is the ShellBlockOutput instance and skip the writeLine in that
  // case; plain TUI keeps the writeLine for transcript-style scrollback. The
  // slow-hint timer follows the same gate so plain TUI still gets its
  // waiting_first_delta line on slow requests.
  const isInkOutput = output instanceof ShellBlockOutput;
  if (!isInkOutput) {
    writeLine(output, formatRequestActivity(phase, context.language, values));
  }
  if (
    phase !== "request_started" &&
    phase !== "request_started_report" &&
    phase !== "continuing_after_tool"
  ) {
    context.requestActivity = { slowHintShown: false };
    return;
  }
  const slowTimer = setTimeout(() => {
    const activity = context.requestActivity;
    if (!activity || activity.slowHintShown) {
      return;
    }
    context.requestActivity = { slowHintShown: true };
    if (!isInkOutput) {
      writeLine(output, formatRequestActivity("waiting_first_delta", context.language, values));
    }
  }, REQUEST_SLOW_HINT_MS);
  context.requestActivity = { slowHintShown: false, slowTimer };
}

async function appendNaturalGateDebugEvent(
  context: TuiContext,
  gate: PendingNaturalCommand,
  status: "created" | "confirmed",
): Promise<void> {
  const sessionId = await ensureSession(context);
  await appendSystemEvent(
    context,
    sessionId,
    `natural_gate_${status}: capability=${gate.capabilityId} command=${gate.exactCommand} scope=${gate.scope} risk=${gate.risk} requiresExactConfirmation=${gate.requiresExactConfirmation ? "yes" : "no"}`,
    "info",
  );
}

async function sendMessage(
  text: string,
  context: TuiContext,
  gateway: ModelGateway,
  output: Writable,
): Promise<void> {
  const modelGuard = checkResourceGuard(context, "model");
  if (modelGuard) {
    writeLine(output, modelGuard);
    return;
  }
  const selectedRuntimeForCooldown = getSelectedModelRuntime(context);
  const cooldownCheck = checkProviderCooldown(
    context.providerBreaker,
    selectedRuntimeForCooldown.provider,
    selectedRuntimeForCooldown.model,
  );
  if (cooldownCheck.blocked) {
    const cooldownMsg = formatCooldownMessage(
      selectedRuntimeForCooldown.provider,
      selectedRuntimeForCooldown.model,
      cooldownCheck.remainingMs,
      context.language,
    );
    writeLine(output, cooldownMsg);
    return;
  }
  const sessionId = await ensureSession(context);
  context.sessionEnded = false;
  await context.store.appendEvent(sessionId, createUserMessageEvent(text));
  const gate = checkEvidenceGate(text, context);
  if (gate) {
    await appendSystemEvent(context, sessionId, gate, "warning");
    writeLine(output, gate);
    writeStatus(output, context);
    return;
  }
  const selectedRuntime = getSelectedModelRuntime(context);
  context.model = selectedRuntime.model;
  const selectedTools = currentModelSupportsTools(context, selectedRuntime);
  const reportWriteGuard = createReportWriteGuard(text);
  const freshnessLite = createFreshnessLiteState(text, context);
  await recordFreshnessLiteBoundary(context, sessionId, freshnessLite);
  await appendSystemEvent(
    context,
    sessionId,
    `model_request selectedRole=${selectedRuntime.role} provider=${selectedRuntime.provider} model=${selectedRuntime.model} endpointProfile=${selectedRuntime.endpointProfile} reasoningLevel=${selectedRuntime.reasoningLevel ?? "none"} reasoningSent=${selectedRuntime.reasoningSent ? "yes" : "no"} tools=${selectedTools ? "yes" : "no"}`,
    "info",
  );
  const assistantEventId = randomUUID();
  // 当 output 是 ShellBlockOutput（Ink task shell）时，每轮 request 用一个稳定的
  // streaming block id，让 assistant_text_delta 累计写入同一条 keep:true block，
  // 避免被 _write 的 ephemeral splice 淘汰为最后一片 chunk。plain TUI / 测试
  // MemoryOutput 上没有 beginAssistantStream，writeAssistantDelta 会回退到 write。
  const assistantStreamBlockId = `assistant-stream-${assistantEventId}`;
  beginAssistantStream(output, assistantStreamBlockId);
  let assistantText = "";
  const controller = new AbortController();
  context.activeAbortController = controller;
  context.tools.abortSignal = controller.signal;
  context.interrupt = { type: "running", taskId: "model-stream", canCancel: true };
  startRequestActivity(
    output,
    context,
    reportWriteGuard ? "request_started_report" : "request_started",
    {
      reportPath: reportWriteGuard?.requestedPath,
    },
  );
  const runtimeStatus = buildRuntimeStatusForModel({
    ...context,
    provider: getRuntimeStatusProvider(context),
  });
  const architectureCard = shouldTriggerArchitectureRuntime(text, context)
    ? createArchitectureCard(text, context)
    : undefined;
  if (architectureCard) {
    context.currentArchitectureCard = architectureCard;
    await recordArchitectureRuntimeCard(context, sessionId, architectureCard);
  }
  const architectureDirective = architectureCard
    ? createArchitectureRuntimeDirective(architectureCard)
    : undefined;
  await refreshWorkspaceReferenceCache(context, runtimeStatus);
  const systemPrompt = createModelSystemPrompt(text, context, runtimeStatus, architectureDirective);
  if (context.solutionCompleteness.triggered) {
    await appendSystemEvent(
      context,
      sessionId,
      `solution_completeness_gate: ${JSON.stringify(context.solutionCompleteness)}`,
      "warning",
    );
  }
  const messages = await buildModelMessagesWithRecentContext(
    context,
    sessionId,
    systemPrompt,
    text,
  );
  const budget = estimateModelMessageChars(messages);
  if (budget > MAX_CONTEXT_CHARS) {
    const warning =
      context.language === "en-US"
        ? `Context budget exceeded before provider call: ${budget}/${MAX_CONTEXT_CHARS} chars. Run /sessions summary or reduce recent context before retrying.`
        : `上下文预算超限，已在请求 provider 前停止：${budget}/${MAX_CONTEXT_CHARS} 字符。请先运行 /sessions summary 或减少最近上下文后重试。`;
    await appendSystemEvent(context, sessionId, warning, "warning");
    clearRequestActivity(context);
    context.activeAbortController = undefined;
    context.tools.abortSignal = undefined;
    context.interrupt = { type: "idle" };
    writeLine(output, warning);
    writeStatus(output, context);
    return;
  }
  if (reportWriteGuard) {
    messages.push({
      role: "user",
      content: createReportTaskGuard(reportWriteGuard, context.language),
    });
  }
  try {
    for (let round = 0; round < MAX_MODEL_TOOL_ROUNDS; round += 1) {
      const toolCalls: ModelToolCall[] = [];
      let roundAssistantText = "";
      let roundChunkCount = 0;
      let roundHadUsage = false;
      let roundFinishReason: string | undefined;
      let roundHadThinking = false;
      const modelSupportsTools = selectedTools;
      if (!modelSupportsTools && round === 0) {
        writeLine(
          output,
          context.language === "en-US"
            ? "Tool calling is not supported by the current provider/model; continuing as plain text without tools. Run /model doctor for details."
            : "当前 provider/model 不支持 tool calling；本轮降级为纯文本，不发送 tools/toolChoice。可运行 /model doctor 查看详情。",
        );
      }
      const promptCacheFields = await buildPromptCacheRequestFields(context);
      for await (const event of gateway.stream(
        selectedRuntime.provider,
        {
          messages,
          model: selectedRuntime.model,
          endpointProfile: selectedRuntime.endpointProfile,
          ...(selectedRuntime.reasoningSent
            ? { reasoningLevel: selectedRuntime.reasoningLevel }
            : {}),
          ...(modelSupportsTools
            ? {
                tools: createModelToolDefinitionsForReportGuard(reportWriteGuard),
                toolChoice: "auto" as const,
              }
            : {}),
          ...promptCacheFields,
        },
        controller.signal,
      )) {
        if (controller.signal.aborted) {
          clearRequestActivity(context);
          writeLine(output, t(context, "toolInterrupted"));
          return;
        }
        if (event.type === "assistant_text_delta") {
          clearRequestActivity(context);
          assistantText += event.text;
          roundAssistantText += event.text;
          writeAssistantDelta(output, assistantStreamBlockId, event.text);
          continue;
        }
        if (event.type === "tool_use") {
          clearRequestActivity(context);
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          continue;
        }
        if (event.type === "assistant_thinking_delta") {
          roundHadThinking = true;
          continue;
        }
        if (event.type === "usage") {
          roundHadUsage = true;
          const stats = recordModelUsage(context, event.usage);
          await appendUsageEvents(context, sessionId, stats);
          continue;
        }
        if (event.type === "message_stop") {
          roundChunkCount = event.chunkCount;
          roundHadUsage = roundHadUsage || event.hadUsage;
          roundFinishReason = event.finishReason;
          continue;
        }
        if (event.type === "error") {
          clearRequestActivity(context);
          await recordProviderFailureEvidence(context, sessionId, event.error, selectedRuntime);
          recordProviderFailure(
            context.providerBreaker,
            selectedRuntime.provider,
            selectedRuntime.model,
            event.error.code ?? "UNKNOWN",
          );
          writeLine(output, formatProviderFailurePrimary(event.error, context.language));
          return;
        }
      }

      if (!roundAssistantText && toolCalls.length === 0) {
        clearRequestActivity(context);
        const message = await recordProviderEmptyResponse(
          context,
          sessionId,
          roundChunkCount,
          roundHadUsage,
          roundFinishReason,
          roundHadThinking,
        );
        writeLine(output, message);
        return;
      }

      if (roundAssistantText || toolCalls.length > 0) {
        messages.push({ role: "assistant", content: roundAssistantText, toolCalls });
      }
      if (toolCalls.length === 0) {
        if (reportWriteGuard && shouldSendReportEvidenceReminder(reportWriteGuard)) {
          messages.push({
            role: "user",
            content: formatReportEvidenceRequired(context.language),
          });
          reportWriteGuard.evidenceReminderSent = true;
          continue;
        }
        if (reportWriteGuard && shouldSendReportWriteReminder(reportWriteGuard)) {
          messages.push({
            role: "user",
            content: createReportWriteReminder(reportWriteGuard, context.language),
          });
          reportWriteGuard.reminderSent = true;
          continue;
        }
        if (
          reportWriteGuard &&
          shouldSendReportFinalReferenceReminder(reportWriteGuard, assistantText)
        ) {
          messages.push({
            role: "user",
            content: createReportFinalReferenceReminder(reportWriteGuard, context.language),
          });
          reportWriteGuard.finalReferenceReminderSent = true;
          continue;
        }
        break;
      }
      if (roundAssistantText) {
        output.write("\n");
      }
      if (reportWriteGuard && !hasReportWriteToolCall(reportWriteGuard, toolCalls)) {
        reportWriteGuard.nonWriteToolRounds += 1;
      }
      for (const toolCall of toolCalls) {
        const result = await executeModelToolUse(toolCall, context, sessionId, output, {
          messages,
          provider: selectedRuntime.provider,
          model: selectedRuntime.model,
          endpointProfile: selectedRuntime.endpointProfile,
          reasoningLevel: selectedRuntime.reasoningLevel,
          reasoningSent: selectedRuntime.reasoningSent,
          ...(reportWriteGuard ? { reportWriteGuard } : {}),
        });
        if (result.pendingApproval) {
          return;
        }
        if (doesWriteSatisfyReportGuard(reportWriteGuard, toolCall, result)) {
          reportWriteGuard.completed = true;
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      if (round === MAX_MODEL_TOOL_ROUNDS - 1) {
        writeLine(
          output,
          context.language === "en-US"
            ? "Tool round limit reached; requesting one final model answer without tools."
            : "已达到工具轮次上限；将不再调用工具，并请求模型给出最终回答。",
        );
        const finalText = await streamFinalModelAnswerWithoutTools(
          {
            messages,
            provider: selectedRuntime.provider,
            model: selectedRuntime.model,
            endpointProfile: selectedRuntime.endpointProfile,
            reasoningLevel: selectedRuntime.reasoningLevel,
            reasoningSent: selectedRuntime.reasoningSent,
          },
          context,
          gateway,
          sessionId,
          output,
          controller.signal,
        );
        assistantText += finalText;
      }
    }
  } finally {
    endAssistantStream(output);
    clearRequestActivity(context);
    context.activeAbortController = undefined;
    context.tools.abortSignal = undefined;
    context.interrupt = { type: "idle" };
  }

  // Successful response — clear the circuit breaker for this provider+model
  clearProviderBreaker(context.providerBreaker, selectedRuntime.provider, selectedRuntime.model);

  if (reportWriteGuard && !reportWriteGuard.completed) {
    const message = await recordReportIncompleteEvidence(context, sessionId, reportWriteGuard);
    writeLine(output, message);
  }

  if (assistantText) {
    const freshnessWarning = formatFreshnessLitePrimaryWarning(freshnessLite, context.language);
    output.write("\n");
    if (freshnessWarning) {
      writeLine(output, freshnessWarning);
      assistantText = `${assistantText}\n\n${freshnessWarning}`;
      await appendSystemEvent(
        context,
        sessionId,
        "freshness_lite_primary_enforced: web_source_evidence=missing warning=appended",
        "warning",
      );
    }
    await context.store.appendEvent(sessionId, {
      type: "assistant_text_delta",
      id: assistantEventId,
      text: assistantText,
      createdAt: new Date().toISOString(),
    });
    if (needsSolutionCompletenessReportClosure(context, assistantText)) {
      const message = formatSolutionCompletenessReportBlock(context);
      writeLine(output, message);
      await appendSystemEvent(context, sessionId, message, "warning");
    }
  }
  writeLightHints(output, context);
  writeStatus(output, context);
}

async function buildModelMessagesWithRecentContext(
  context: TuiContext,
  sessionId: string,
  systemPrompt: string,
  currentUserText: string,
): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = [{ role: "system", content: systemPrompt }];
  try {
    const resumed = await context.store.resume(sessionId);
    const recent = resumed.transcript
      .filter(
        (event) =>
          event.type === "user_message" ||
          event.type === "assistant_text_delta" ||
          event.type === "tool_call_start" ||
          event.type === "tool_result",
      )
      .slice(-MAX_CONTEXT_MESSAGES * 2 - 1);
    const lastRecent = recent.at(-1);
    const withoutCurrent =
      lastRecent?.type === "user_message" && lastRecent.text === currentUserText
        ? recent.slice(0, -1)
        : recent;
    const toolCalls = new Map<string, ModelToolCall>();
    let added = 0;
    for (const event of withoutCurrent.slice().reverse()) {
      if (added >= MAX_CONTEXT_MESSAGES) {
        break;
      }
      if (event.type === "tool_call_start") {
        toolCalls.set(event.id, { id: event.id, name: event.name, input: event.input });
        continue;
      }
      if (event.type === "user_message" || event.type === "assistant_text_delta") {
        added += 1;
        continue;
      }
      if (event.type === "tool_result" && toolCalls.has(event.toolUseId)) {
        added += 2;
      }
    }
    const selected = withoutCurrent.slice(-Math.max(MAX_CONTEXT_MESSAGES, added + toolCalls.size));
    for (const event of selected) {
      if (event.type === "user_message") {
        messages.push({ role: "user", content: event.text });
      }
      if (event.type === "assistant_text_delta") {
        messages.push({ role: "assistant", content: event.text });
      }
      if (event.type === "tool_result") {
        const toolCall = toolCalls.get(event.toolUseId);
        if (!toolCall) {
          messages.push({
            role: "assistant",
            content: `Previous ${event.toolName} tool_result summary: ${JSON.stringify({
              isError: event.isError ?? false,
              evidenceId: event.evidenceId,
              content: event.content,
            })}`,
          });
          continue;
        }
        messages.push({ role: "assistant", content: "", toolCalls: [toolCall] });
        messages.push({
          role: "tool",
          tool_call_id: event.toolUseId,
          content: JSON.stringify({
            tool: event.toolName,
            isError: event.isError ?? false,
            evidenceId: event.evidenceId,
            content: event.content,
          }),
        });
      }
    }
  } catch (error) {
    await appendSystemEvent(
      context,
      sessionId,
      `recent_context_unavailable: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
  messages.push({ role: "user", content: currentUserText });
  const compacted = microCompactMessages(messages, {
    maxChars: MAX_CONTEXT_CHARS,
    preserveRecentMessages: MAX_CONTEXT_MESSAGES,
    kind: "micro",
  });
  if (compacted.changed && compacted.boundary) {
    recordCompactBoundary(context, compacted.boundary);
    refreshCacheFreshness(context);
  }
  return compacted.messages;
}

async function streamFinalModelAnswerWithoutTools(
  continuation: PendingModelContinuation,
  context: TuiContext,
  gateway: ModelGateway,
  sessionId: string,
  output: Writable,
  signal: AbortSignal,
): Promise<string> {
  let assistantText = "";
  // 与 sendMessage 一致的 assistant streaming block：避免最后一轮 assistant 文本
  // 被 _write 的 ephemeral splice 淘汰，保证完整正文落到 keep:true block。
  const assistantStreamBlockId = `assistant-stream-final-${randomUUID()}`;
  beginAssistantStream(output, assistantStreamBlockId);
  let chunkCount = 0;
  let hadUsage = false;
  let finishReason: string | undefined;
  let hadThinking = false;
  const promptCacheFields = await buildPromptCacheRequestFields(context);
  for await (const event of gateway.stream(
    continuation.provider,
    {
      messages: continuation.messages,
      model: continuation.model,
      endpointProfile: continuation.endpointProfile,
      ...(continuation.reasoningSent ? { reasoningLevel: continuation.reasoningLevel } : {}),
      toolChoice: "none",
      ...promptCacheFields,
    },
    signal,
  )) {
    if (signal.aborted) {
      clearRequestActivity(context);
      writeLine(output, t(context, "toolInterrupted"));
      return assistantText;
    }
    if (event.type === "assistant_text_delta") {
      clearRequestActivity(context);
      assistantText += event.text;
      writeAssistantDelta(output, assistantStreamBlockId, event.text);
      continue;
    }
    if (event.type === "assistant_thinking_delta") {
      hadThinking = true;
      continue;
    }
    if (event.type === "usage") {
      hadUsage = true;
      const stats = recordModelUsage(context, event.usage);
      await appendUsageEvents(context, sessionId, stats);
      continue;
    }
    if (event.type === "message_stop") {
      chunkCount = event.chunkCount;
      hadUsage = hadUsage || event.hadUsage;
      finishReason = event.finishReason;
      continue;
    }
    if (event.type === "tool_use") {
      await appendSystemEvent(
        context,
        sessionId,
        `final_no_tools_ignored_tool_use: ${event.name}`,
        "warning",
      );
      continue;
    }
    if (event.type === "error") {
      clearRequestActivity(context);
      await recordProviderFailureEvidence(
        context,
        sessionId,
        event.error,
        runtimeFromContinuation(continuation),
      );
      recordProviderFailure(
        context.providerBreaker,
        continuation.provider,
        continuation.model,
        event.error.code ?? "UNKNOWN",
      );
      writeLine(output, formatProviderFailurePrimary(event.error, context.language));
      return assistantText;
    }
  }
  if (!assistantText) {
    clearRequestActivity(context);
    const message = await recordProviderEmptyResponse(
      context,
      sessionId,
      chunkCount,
      hadUsage,
      finishReason,
      hadThinking,
    );
    writeLine(output, message);
  }
  endAssistantStream(output);
  return assistantText;
}

async function continueModelAfterToolResults(
  continuation: PendingModelContinuation,
  context: TuiContext,
  gateway: ModelGateway,
  output: Writable,
): Promise<void> {
  const controller = new AbortController();
  context.activeAbortController = controller;
  context.tools.abortSignal = controller.signal;
  context.interrupt = { type: "running", taskId: "model-continuation", canCancel: true };
  startRequestActivity(output, context, "continuing_after_tool");
  let assistantText = "";
  const assistantEventId = randomUUID();
  // 每轮 round 都会开新的 streaming block，避免不同轮的输出粘到同一行。
  let assistantStreamBlockId = `assistant-stream-cont-${assistantEventId}-0`;
  beginAssistantStream(output, assistantStreamBlockId);
  const sessionId = await ensureSession(context);
  try {
    for (let round = 0; round < MAX_MODEL_TOOL_ROUNDS; round += 1) {
      if (round > 0) {
        assistantStreamBlockId = `assistant-stream-cont-${assistantEventId}-${round}`;
        beginAssistantStream(output, assistantStreamBlockId);
      }
      const toolCalls: ModelToolCall[] = [];
      let roundAssistantText = "";
      const promptCacheFields = await buildPromptCacheRequestFields(context);
      for await (const event of gateway.stream(
        continuation.provider,
        {
          messages: continuation.messages,
          model: continuation.model,
          endpointProfile: continuation.endpointProfile,
          ...(continuation.reasoningSent ? { reasoningLevel: continuation.reasoningLevel } : {}),
          tools: createModelToolDefinitionsForReportGuard(continuation.reportWriteGuard),
          toolChoice: "auto",
          ...promptCacheFields,
        },
        controller.signal,
      )) {
        if (event.type === "assistant_text_delta") {
          clearRequestActivity(context);
          assistantText += event.text;
          roundAssistantText += event.text;
          writeAssistantDelta(output, assistantStreamBlockId, event.text);
          continue;
        }
        if (event.type === "tool_use") {
          clearRequestActivity(context);
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          continue;
        }
        if (event.type === "usage") {
          const stats = recordModelUsage(context, event.usage);
          await appendUsageEvents(context, sessionId, stats);
          continue;
        }
        if (event.type === "error") {
          clearRequestActivity(context);
          await recordProviderFailureEvidence(
            context,
            sessionId,
            event.error,
            runtimeFromContinuation(continuation),
          );
          recordProviderFailure(
            context.providerBreaker,
            continuation.provider,
            continuation.model,
            event.error.code ?? "UNKNOWN",
          );
          writeLine(output, formatProviderFailurePrimary(event.error, context.language));
          return;
        }
      }
      if (roundAssistantText || toolCalls.length > 0) {
        continuation.messages.push({ role: "assistant", content: roundAssistantText, toolCalls });
      }
      if (toolCalls.length === 0) {
        const reportWriteGuard = continuation.reportWriteGuard;
        if (reportWriteGuard && shouldSendReportEvidenceReminder(reportWriteGuard)) {
          continuation.messages.push({
            role: "user",
            content: formatReportEvidenceRequired(context.language),
          });
          reportWriteGuard.evidenceReminderSent = true;
          continue;
        }
        if (reportWriteGuard && shouldSendReportWriteReminder(reportWriteGuard)) {
          continuation.messages.push({
            role: "user",
            content: createReportWriteReminder(reportWriteGuard, context.language),
          });
          reportWriteGuard.reminderSent = true;
          continue;
        }
        if (
          reportWriteGuard &&
          shouldSendReportFinalReferenceReminder(reportWriteGuard, assistantText)
        ) {
          continuation.messages.push({
            role: "user",
            content: createReportFinalReferenceReminder(reportWriteGuard, context.language),
          });
          reportWriteGuard.finalReferenceReminderSent = true;
          continue;
        }
        break;
      }
      if (roundAssistantText) {
        output.write("\n");
      }
      const reportWriteGuard = continuation.reportWriteGuard;
      if (reportWriteGuard && !hasReportWriteToolCall(reportWriteGuard, toolCalls)) {
        reportWriteGuard.nonWriteToolRounds += 1;
      }
      for (const toolCall of toolCalls) {
        const result = await executeModelToolUse(
          toolCall,
          context,
          sessionId,
          output,
          continuation,
        );
        if (result.pendingApproval) {
          return;
        }
        if (doesWriteSatisfyReportGuard(continuation.reportWriteGuard, toolCall, result)) {
          continuation.reportWriteGuard.completed = true;
        }
        continuation.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      if (round === MAX_MODEL_TOOL_ROUNDS - 1) {
        writeLine(
          output,
          context.language === "en-US"
            ? "Tool round limit reached during continuation; requesting one final model answer without tools."
            : "续轮已达到工具轮次上限；将不再调用工具，并请求模型给出最终回答。",
        );
        const finalText = await streamFinalModelAnswerWithoutTools(
          continuation,
          context,
          gateway,
          sessionId,
          output,
          controller.signal,
        );
        assistantText += finalText;
      }
    }
    if (assistantText) {
      output.write("\n");
      await context.store.appendEvent(sessionId, {
        type: "assistant_text_delta",
        id: assistantEventId,
        text: assistantText,
        createdAt: new Date().toISOString(),
      });
    }
    endAssistantStream(output);
  } finally {
    clearRequestActivity(context);
    context.activeAbortController = undefined;
    context.tools.abortSignal = undefined;
    context.interrupt = { type: "idle" };
  }
}

async function recordProviderEmptyResponse(
  context: TuiContext,
  sessionId: string,
  chunkCount: number,
  hadUsage: boolean,
  finishReason: string | undefined,
  hadThinking: boolean,
): Promise<string> {
  const provider = getRuntimeStatusProvider(context);
  const model = context.model;
  const metadata = [
    `provider=${provider}`,
    `model=${model}`,
    `chunkCount=${chunkCount}`,
    `hadUsage=${hadUsage ? "yes" : "no"}`,
    `hadThinking=${hadThinking ? "yes" : "no"}`,
    `finishReason=${finishReason ?? "unknown"}`,
  ].join("; ");
  const evidence = createEvidenceRecord(
    "command_output",
    `provider_empty_response: ${metadata}`,
    `provider:${provider}:model:${model}`,
    ["provider_empty_response", "model_empty_response", provider, model],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(context, sessionId, `provider_empty_response: ${metadata}`, "warning");
  // D.13M：本轮只有 thinking 没有 text/tool_use 时，给用户区分性提示，不再用通用 empty response 文案。
  if (hadThinking) {
    return formatProviderThinkingOnlyResponsePrimary(context.language);
  }
  return formatProviderEmptyResponsePrimary(context.language);
}

function needsSolutionCompletenessReportClosure(
  context: TuiContext,
  assistantText: string,
): boolean {
  if (!context.solutionCompleteness.classificationRequired) {
    return false;
  }
  return !/single_issue|systemic_gap/u.test(assistantText);
}

function formatSolutionCompletenessReportBlock(context: TuiContext): string {
  const status = context.solutionCompleteness;
  const classification =
    status.classification === "unknown" ? "systemic_gap" : status.classification;
  const impact = status.impactAreas.length > 0 ? status.impactAreas.join(", ") : "unknown";
  const severity = status.severity === "unknown" ? "blocking_P1" : status.severity;
  return [
    "Solution Completeness Gate report",
    `- classification: ${classification}`,
    `- impactAreas: ${impact}`,
    `- severity: ${severity}`,
    "- phaseBoundary: stay in the current approved scope; do not enter Beta or later roadmap stages automatically.",
    "- validation: list focused tests/check/typecheck/build/diff-check before claiming closure.",
  ].join("\n");
}

function currentModelSupportsTools(
  context: TuiContext,
  runtime = getSelectedModelRuntime(context),
): boolean {
  const providerConfig = context.config.providers[runtime.provider];
  if (
    providerConfig &&
    "supportsTools" in providerConfig &&
    providerConfig.supportsTools === false
  ) {
    return false;
  }
  const known = findKnownModel(runtime.model);
  return known?.supportsTools !== false;
}

async function executeModelToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation?: PendingModelContinuation,
  architectureDriftConfirmed = false,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  pendingApproval?: boolean;
}> {
  // D.13I：SearchExtraTools / ExecuteExtraTool 不走 builtInTools / runTool / permission 分支，
  // 但仍走既有 tool_call_start / tool_result / evidence 链路；不重复 architecture drift /
  // permission 状态机，因为这两个工具本身不写文件、不执行 shell——它们的"风险"由其分发到的
  // 子工具承担（codebase-memory 只读 + 命令白名单 + required args 校验）。
  if (
    toolCall.name === SEARCH_EXTRA_TOOLS_NAME ||
    toolCall.name === EXECUTE_EXTRA_TOOL_NAME
  ) {
    return executeDeferredDispatchToolUse(toolCall, context, sessionId, output);
  }
  const toolName = normalizeToolName(toolCall.name);
  if (!toolName) {
    return { ok: false, tool: toolCall.name, text: `Unknown tool: ${toolCall.name}` };
  }
  if (!architectureDriftConfirmed && context.currentArchitectureCard) {
    clearRequestActivity(context);
    const drift = detectArchitectureDrift(context.currentArchitectureCard, {
      toolName,
      input: toolCall.input,
      summary: createToolUseDriftSummary(toolName, toolCall.input),
    });
    if (drift.drift) {
      const warning =
        context.language === "en-US"
          ? `Scope change requires confirmation before this tool use: ${drift.warnings.join("; ")}`
          : `本次工具调用改变约定范围，需要确认后才能执行：${drift.warnings.join("；")}`;
      await appendSystemEvent(context, sessionId, warning, "warning");
      writeLine(
        output,
        context.language === "en-US"
          ? "This tool use changes the agreed scope. Confirm before running it."
          : "本次工具调用会改变已约定范围。确认后才会运行本工具。",
      );
      context.pendingLocalApproval = {
        kind: "architecture_drift",
        toolCall,
        toolName,
        sessionId,
        warnings: drift.warnings,
        continuation: continuation
          ? createSingleToolCallContinuation(continuation, toolCall)
          : undefined,
      };
      return { ok: false, tool: toolName, text: warning, pendingApproval: true };
    }
  }
  if (continuation?.reportWriteGuard && toolName === "Bash") {
    const text =
      context.language === "en-US"
        ? "Bash is not available for report file generation; use Write/Edit so shell output cannot pollute the report body."
        : "报告文件生成不开放 Bash；请使用 Write/Edit，避免 shell 输出污染报告正文。";
    const evidence = await recordToolFailureEvidence(context, sessionId, toolName, text);
    await appendToolResultEvent(context, sessionId, toolCall.id, toolName, text, true, evidence.id);
    return { ok: false, tool: toolName, text, evidenceId: evidence.id };
  }
  if (
    continuation?.reportWriteGuard &&
    !continuation.reportWriteGuard.evidenceRead &&
    (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit")
  ) {
    const text = formatReportEvidenceRequired(context.language);
    continuation.reportWriteGuard.evidenceReminderSent = true;
    const evidence = await recordToolFailureEvidence(context, sessionId, toolName, text);
    await appendToolResultEvent(context, sessionId, toolCall.id, toolName, text, true, evidence.id);
    return { ok: false, tool: toolName, text, evidenceId: evidence.id };
  }
  const permission = await decidePermission(toolName, toolCall.input, context, sessionId);
  await context.store.appendEvent(sessionId, {
    type: "permission_request",
    request: permission.request,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(sessionId, {
    type: "permission_result",
    requestId: permission.request.id,
    decision: permission.decision,
    reason: permission.reason,
    createdAt: new Date().toISOString(),
  });
  if (permission.decision !== "allow") {
    clearRequestActivity(context);
    const text = `${permission.decision}: ${permission.reason}`;
    writeLine(
      output,
      formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
    );
    if (
      permission.decision === "ask" &&
      (toolName === "Write" ||
        toolName === "Edit" ||
        toolName === "MultiEdit" ||
        toolName === "Bash")
    ) {
      context.pendingLocalApproval = {
        kind: "model_tool_use",
        toolCall,
        toolName,
        sessionId,
        continuation: continuation
          ? createSingleToolCallContinuation(continuation, toolCall)
          : undefined,
      };
      return { ok: false, tool: toolName, text, pendingApproval: true };
    }
    const evidence = await recordToolFailureEvidence(
      context,
      sessionId,
      toolName,
      `permission ${permission.decision}: ${permission.reason}; ${permission.request.summary}`,
    );
    await appendToolResultEvent(context, sessionId, toolCall.id, toolName, text, true, evidence.id);
    return { ok: false, tool: toolName, text, evidenceId: evidence.id };
  }
  return executeApprovedModelToolUse(
    toolCall,
    toolName,
    context,
    sessionId,
    output,
    permission.preflight,
    continuation?.reportWriteGuard,
  );
}

async function executeApprovedModelToolUse(
  toolCall: ModelToolCall,
  toolName: ToolName,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  preflight?: string,
  reportWriteGuard?: ReportWriteGuard,
): Promise<{ ok: boolean; tool: string; text: string; data?: unknown; evidenceId?: string }> {
  if (preflight) {
    writeLine(output, preflight);
  }
  if (toolName === "Bash") {
    const guard = checkBackgroundStartGuard(context, "bash", true);
    if (guard) {
      const evidence = await recordToolFailureEvidence(context, sessionId, toolName, guard);
      await appendToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        toolName,
        guard,
        true,
        evidence.id,
      );
      return { ok: false, tool: toolName, text: guard, evidenceId: evidence.id };
    }
  }
  const task =
    toolName === "Bash" ? createBackgroundTask(toolName, toolCall.input, context) : undefined;
  if (task) {
    rememberBackgroundTask(context, task);
    await appendBackgroundTaskEvent(context, sessionId, task);
  }
  startRequestActivity(output, context, "tool_running", { toolName });
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: toolCall.id,
    name: toolName,
    input: toolCall.input,
    createdAt: new Date().toISOString(),
  });
  const backgroundController = task
    ? registerBackgroundAbortController(context, task.id)
    : undefined;
  const previousAbortSignal = context.tools.abortSignal;
  if (backgroundController) {
    context.tools.abortSignal = backgroundController.signal;
  }
  const progress = installToolProgressHandler(context, sessionId, toolCall.id, output, task);
  // D.13L Section 4 — model tool use 也在 runTool 前 emit 启动行，确保
  // `Bash(git status)` / `Read(src/foo.ts)` 这种人类可读句首与 CCB 一致；
  // permission 已批准、preflight 已写入后再打印，避免被拒绝时多一行噪音。
  const startBanner = formatToolStart(toolName, toolCall.input);
  if (startBanner) {
    writeLine(output, startBanner);
  }
  try {
    const result = await runTool(toolName, toolCall.input, context.tools);
    progress.restore();
    await Promise.all(progress.pending);
    clearRequestActivity(context);
    await context.store.appendEvent(sessionId, createToolEndEvent(toolCall.id, result.output));
    await appendDerivedToolEvents(context, sessionId, toolName, result.output);
    const evidence = await recordToolEvidence(context, sessionId, toolName, result.output);
    if (reportWriteGuard && (toolName === "Read" || toolName === "Glob" || toolName === "Grep")) {
      reportWriteGuard.evidenceRead = true;
    }
    rememberToolFiles(context, toolName, toolCall.input, result.output);
    const isError = isToolOutputFailure(toolName, result.output);
    if (task) {
      finishBackgroundTaskFromToolOutput(task, result.output, context);
      await appendBackgroundTaskEvent(context, sessionId, task);
    }
    await appendToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      toolName,
      result.output,
      isError,
      evidence?.id,
    );
    clearBackgroundAbortController(context, task?.id ?? "");
    if (backgroundController) {
      context.tools.abortSignal = previousAbortSignal;
    }
    writeLine(
      output,
      formatModelToolOutput(
        toolName,
        result.output,
        context.language,
        evidence?.id,
        reportWriteGuard,
      ),
    );
    return {
      ok: !isError,
      tool: toolName,
      text: result.output.text,
      data: result.output.data,
      evidenceId: evidence?.id,
    };
  } catch (error) {
    progress.restore();
    await Promise.all(progress.pending);
    clearBackgroundAbortController(context, task?.id ?? "");
    if (backgroundController) {
      context.tools.abortSignal = previousAbortSignal;
    }
    clearRequestActivity(context);
    const text = formatError(error, context.language);
    const evidence = await recordToolFailureEvidence(context, sessionId, toolName, text);
    await appendToolResultEvent(context, sessionId, toolCall.id, toolName, text, true, evidence.id);
    return { ok: false, tool: toolName, text, evidenceId: evidence.id };
  }
}

// Module 3 — toPermissionPromptView 已移至 ./tui-permission-runtime.ts。

// D.13I：deferred dispatch 的特殊执行路径。复用 tool_call_start / tool_result / evidence
// 三件套，但不调用 runTool（因为 SearchExtraTools / ExecuteExtraTool 不在 builtInTools 里）。
// 失败仍写 evidence，便于 verifier / /details 排查。
async function executeDeferredDispatchToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
}> {
  const dispatchName = toolCall.name;
  startRequestActivity(output, context, "tool_running", { toolName: dispatchName });
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: toolCall.id,
    name: dispatchName,
    input: toolCall.input,
    createdAt: new Date().toISOString(),
  });
  try {
    const input = (toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
      ? toolCall.input
      : {}) as Record<string, unknown>;
    if (dispatchName === SEARCH_EXTRA_TOOLS_NAME) {
      const queryRaw = input.query;
      if (typeof queryRaw !== "string") {
        const text = "SearchExtraTools: query 必须是字符串（可为空字符串）。";
        const evidence = await recordToolFailureEvidence(
          context,
          sessionId,
          "Read",
          `${dispatchName}: ${text}`,
        );
        await appendDeferredToolResultEvent(
          context,
          sessionId,
          toolCall.id,
          dispatchName,
          text,
          true,
          evidence.id,
        );
        clearRequestActivity(context);
        return { ok: false, tool: dispatchName, text, evidenceId: evidence.id };
      }
      const result = executeSearchExtraTools(queryRaw, context);
      const evidence = await recordToolEvidence(context, sessionId, "Read", {
        text: result.text,
        data: result.data,
      } as ToolOutput);
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        dispatchName,
        { text: result.text, data: result.data },
        false,
        evidence?.id,
      );
      clearRequestActivity(context);
      writeLine(output, result.text);
      return {
        ok: true,
        tool: dispatchName,
        text: result.text,
        data: result.data,
        evidenceId: evidence?.id,
      };
    }
    // ExecuteExtraTool
    const result = await executeExtraTool(
      { tool_name: input.tool_name, params: input.params },
      context,
    );
    if (!result.ok) {
      const evidence = await recordToolFailureEvidence(
        context,
        sessionId,
        "Read",
        `${dispatchName}: ${result.text}`,
      );
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        dispatchName,
        result.text,
        true,
        evidence.id,
      );
      clearRequestActivity(context);
      writeLine(output, result.text);
      return { ok: false, tool: dispatchName, text: result.text, evidenceId: evidence.id };
    }
    const evidence = await recordToolEvidence(context, sessionId, "Read", {
      text: result.text,
      data: result.data,
    } as ToolOutput);
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      dispatchName,
      { text: result.text, data: result.data },
      false,
      evidence?.id,
    );
    clearRequestActivity(context);
    writeLine(output, result.text);
    return {
      ok: true,
      tool: dispatchName,
      text: result.text,
      data: result.data,
      evidenceId: evidence?.id,
    };
  } catch (error) {
    clearRequestActivity(context);
    const text = formatError(error, context.language);
    const evidence = await recordToolFailureEvidence(
      context,
      sessionId,
      "Read",
      `${dispatchName}: ${text}`,
    );
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      dispatchName,
      text,
      true,
      evidence.id,
    );
    return { ok: false, tool: dispatchName, text, evidenceId: evidence.id };
  }
}

async function appendDeferredToolResultEvent(
  context: TuiContext,
  sessionId: string,
  toolUseId: string,
  dispatchName: string,
  content: unknown,
  isError: boolean,
  evidenceId?: string,
): Promise<void> {
  // 复用既有 tool_result store schema；toolName 字段塞 dispatchName 字符串以便排查（doctor /
  // details / verifier 都已基于 toolName 字段读取）。store 类型对 toolName 是 string 标签，
  // 所以这里用 cast 的方式保持向后兼容，不引入新 event kind。
  await context.store.appendEvent(sessionId, {
    type: "tool_result",
    toolUseId,
    toolName: dispatchName as unknown as ToolName,
    content,
    isError,
    evidenceId,
    createdAt: new Date().toISOString(),
  });
}

async function appendToolResultEvent(
  context: TuiContext,
  sessionId: string,
  toolUseId: string,
  toolName: ToolName,
  content: unknown,
  isError: boolean,
  evidenceId?: string,
): Promise<void> {
  await context.store.appendEvent(sessionId, {
    type: "tool_result",
    toolUseId,
    toolName,
    content,
    isError,
    evidenceId,
    createdAt: new Date().toISOString(),
  });
}

export function createModelSystemPrompt(
  text: string,
  context: TuiContext,
  runtimeStatus: unknown,
  architectureDirective?: string,
): string {
  const solutionCompletenessWarning = updateSolutionCompletenessGate(text, context);
  const freshnessBoundary = createFreshnessLiteBoundary(text, context);
  // D.13I：仅当 deferred 列表非空时注入 SearchExtraTools/ExecuteExtraTool 提示。built-in
  // 工具继续直接调用；不暴露 raw schema/secret/参数，仅提示发现-执行两步约束。
  const deferredReminder = formatDeferredToolsSystemReminder(
    context.language,
    snapshotDeferredTools(context),
  );
  return `${
    context.language === "en-US"
      ? "You are Linghun, a coding assistant with tool-use capabilities. Answer in English by default unless the user explicitly requests another language. Use evidence before code claims; avoid unverified claims. Natural command execution is decided by local RuntimeStatus and Command Capability Catalog, not by guessing. Use real tool_use events when file/search/edit/bash/todo facts or actions are needed; never describe a tool call as text instead of using a tool event."
      : "你是 Linghun 工程型中文助手，具备工具调用能力。默认用中文回答，除非用户明确指定其他语言。涉及代码事实必须先有证据，避免未验证断言。自然语言命令是否可执行由本地 RuntimeStatus 与 Command Capability Catalog 裁决，不能靠模型猜。需要文件、搜索、编辑、Bash 或 Todo 事实/动作时必须使用真实 tool_use 事件，不要用文本冒充工具调用。"
  }\n${
    context.language === "en-US"
      ? "OutputStyle=summary-first; use plain language on main screen, minimize internal jargon; error messages should suggest next steps; details/debug reserved for advanced info. Default mature engineering for frontend/UI: clear information architecture, responsive layout, complete states (empty/error/loading), readability first."
      : "OutputStyle=summary-first; 主屏用人话、少内部术语；错误提示给下一步；details/debug 保留高级信息。涉及前端/UI 开发时默认要求成熟方案：信息架构清晰、响应式、状态完整（空态/错误态/加载态）、可读性优先，不需要用户额外说\u201C成熟\u201D。"
  }\n${
    context.language === "en-US"
      ? "EngineeringStructure=Do not pile logic into existing large files by default. Avoid god files, code blobs, overly long functions (>200 lines), deep nesting (>3 levels), and unbounded global state. Keep responsibility boundaries clear: UI/state/IO/provider/runner/permission/cache/verification. Prefer reusing existing project modules, helpers, presenters, and runtimes over creating a second system. Do not add zero-benefit abstractions for elegance. Each change must have a verifiable boundary (focused tests, typecheck, check). This is not authorization for large refactors."
      : "EngineeringStructure=默认不把逻辑堆进已有大文件。避免 god file、code blob、超长函数（>200行）、深层嵌套（>3层）、无边界全局状态。职责边界保持清晰：UI/状态/IO/provider/runner/permission/cache/verification。优先复用项目已有模块、helper、presenter、runtime，不新建第二套系统。不为了优雅新增无收益抽象。每个改动要有可验证边界（focused tests、typecheck、check）。这不是授权大重构。"
  }\nRuntimeStatusForModel=${JSON.stringify(runtimeStatus)}\nControlledMemorySummary=${formatControlledMemoryForModel(context)}\nMemoryBoundary=acceptedOnly; topK=${MEMORY_PROMPT_TOP_K}; noAutoLearning; noAutoAccept; doNotWriteLongTermMemoryWithoutExplicitMemoryAccept\nEvidenceSummary=${createEvidenceSummaryForModel(context)}${freshnessBoundary ? `\n${freshnessBoundary}` : ""}\nSolutionCompleteness=${JSON.stringify(context.solutionCompleteness)}${solutionCompletenessWarning ? `\n${solutionCompletenessWarning}` : ""}${architectureDirective ? `\n${architectureDirective}` : ""}${deferredReminder ? `\nDeferredToolsReminder=${deferredReminder}` : ""}\nCommandCapabilitySummary=\n${createModelCapabilitySummary(24)}`;
}

function createFreshnessLiteBoundary(text: string, context: TuiContext): string | undefined {
  const state = createFreshnessLiteState(text, context);
  if (!state.sensitive) {
    return undefined;
  }
  return context.language === "en-US"
    ? `FreshnessBoundary=latest/current/external facts requested; web_source_evidence=${state.webSourceEvidence}; if missing, do not present latest/current facts as verified and explicitly mark them as unverified or needing confirmation.`
    : `FreshnessBoundary=本轮请求涉及最新/当前/外部事实；web_source_evidence=${state.webSourceEvidence}；如缺少 web_source，不得把最新/当前事实写成已验证，必须标记为未验证或需要确认。`;
}

function createFreshnessLiteState(text: string, context: TuiContext): FreshnessLiteState {
  return {
    sensitive: needsFreshnessLiteBoundary(text),
    webSourceEvidence: context.evidence.some((item) => item.kind === "web_source")
      ? "present"
      : "missing",
  };
}

async function recordFreshnessLiteBoundary(
  context: TuiContext,
  sessionId: string,
  state: FreshnessLiteState,
): Promise<void> {
  if (!state.sensitive) {
    return;
  }
  await appendSystemEvent(
    context,
    sessionId,
    `freshness_lite_boundary: sensitive=yes web_source_evidence=${state.webSourceEvidence}`,
    state.webSourceEvidence === "missing" ? "warning" : "info",
  );
}

function createEvidenceSummaryForModel(context: TuiContext): string {
  return JSON.stringify(
    context.evidence.slice(0, 5).map((item) => ({
      id: item.id,
      kind: item.kind,
      source: item.source,
      summary: truncateDisplay(item.summary.replace(/\s+/g, " "), 180),
      supportsClaims: item.supportsClaims.slice(0, 5),
    })),
  );
}

function updateSolutionCompletenessGate(text: string, context: TuiContext): string {
  const userRequestedGate =
    /成品级|不要缝|不要补丁|不要只补|先看\s*ccb|参考\s*ccb|对照\s*ccb|对照成熟项目|全局|有没有漏|系统性|完整性|solution completeness/i.test(
      text,
    );
  const smokeContamination = /smoke.*(污染|contaminat)|真实\s*smoke.*(污染|失真)/i.test(text);
  const auditFinding =
    /(verifier|审计|audit).*(文字补丁|regex|正则|只改文档)|文字补丁|regex\s*补丁|只改文档/i.test(
      text,
    );
  const repeatedDenial = hasRepeatedPermissionDenial(context.permissions.recentDenied);
  if (repeatedDenial) {
    context.solutionCompleteness = {
      ...createSolutionCompletenessStatus(),
      triggerReason: "repeated_denial",
      evidenceRefs: collectSolutionCompletenessEvidenceRefs(context),
      nextRequiredOutput:
        "最近同类权限拒绝已记录；普通任务继续走 model/tool loop，必要时给短 hint 或让用户查看 /permissions recent。",
    };
  }
  if (!userRequestedGate && !smokeContamination && !auditFinding) {
    if (!repeatedDenial) {
      context.solutionCompleteness = createSolutionCompletenessStatus();
    }
    return "";
  }

  const triggerReason = userRequestedGate
    ? "user_request"
    : smokeContamination
      ? "smoke_contamination"
      : "audit_finding";
  const impactAreas = inferSolutionCompletenessImpactAreas(text, triggerReason);
  const classification = "unknown";
  const severity = "unknown";
  const requiredBeforeAction = true;
  const nextRequiredOutput =
    "先给 single_issue/systemic_gap 判断；若 systemic_gap，再列影响面、P0/P1/P2、阶段边界、验证方式和当前阶段/后续登记。";
  const warning = [
    "SYSTEMIC_GAP_WARNING:",
    formatSolutionCompletenessTrigger(triggerReason),
    "回答或修复前必须先判断 single_issue / systemic_gap。",
    `impactAreas=${impactAreas.join(",") || "unknown"}`,
    `severity=${severity}`,
    "必须列出：影响面、P0/P1/P2、阶段边界、验证方式。",
    "若属于当前批准范围外内容，只登记到后续路线图或 not-do，不要扩大实现范围。",
  ].join(" ");
  context.solutionCompleteness = {
    triggered: true,
    triggerReason,
    classificationRequired: true,
    classification,
    impactAreas,
    severity,
    requiredBeforeAction,
    evidenceRefs: collectSolutionCompletenessEvidenceRefs(context),
    sourceRefs: [
      "LINGHUN_IMPLEMENTATION_SPEC.md#11.6",
      "LINGHUN_CCB_MATURITY_COMPARISON_REPORT.md#14",
      "docs/delivery/phase-15-natural-command-bridge.md",
    ],
    nextRequiredOutput,
    checklist: ["single_issue/systemic_gap", "影响面", "P0/P1/P2", "阶段边界", "验证方式"],
    lastWarning: warning,
  };
  return warning;
}

function collectSolutionCompletenessEvidenceRefs(context: TuiContext): string[] {
  const evidence = context.evidence.slice(0, 3).map((item) => item.id);
  const denied = context.permissions.recentDenied
    .slice(0, 3)
    .map((item) => `permission_denial:${item.toolName}:${item.mode}`);
  return [...evidence, ...denied];
}

function rememberToolFiles(
  context: TuiContext,
  name: ToolName,
  input: unknown,
  output: ToolOutput,
): void {
  const paths: string[] = [];
  if (typeof input === "object" && input !== null && "path" in input) {
    const path = (input as { path?: unknown }).path;
    if (typeof path === "string") {
      paths.push(path.replaceAll("\\", "/"));
    }
  }
  if (Array.isArray(output.changedFiles)) {
    paths.push(...output.changedFiles);
  }
  if (name === "Glob" || name === "Grep") {
    paths.push(...extractFileMentions(output.text));
  }
  context.recentlyMentionedFiles = uniqueStrings([
    ...paths.filter(Boolean),
    ...context.recentlyMentionedFiles,
  ]).slice(0, 10);
}

type NaturalFileReadResult =
  | { status: "none" }
  | { status: "resolved"; path: string }
  | { status: "ambiguous"; candidates: string[] };

async function resolveNaturalFileRead(
  text: string,
  context: TuiContext,
): Promise<NaturalFileReadResult> {
  if (!isNaturalReadFileRequest(text)) {
    return { status: "none" };
  }

  if (hasModelSynthesisIntent(text)) {
    return { status: "none" };
  }

  const explicit = extractNaturalReadPath(text);
  if (explicit) {
    return { status: "resolved", path: explicit };
  }

  const recent = context.recentlyMentionedFiles.filter(Boolean);
  if (/这个|刚才|上面|最近|this|that|previous|recent/i.test(text) && recent.length > 0) {
    return { status: "resolved", path: recent[0] };
  }

  const candidates = await findNaturalFileCandidates(text, context.projectPath, recent);
  if (candidates.length === 1) {
    return { status: "resolved", path: candidates[0] };
  }
  if (candidates.length > 1) {
    return { status: "ambiguous", candidates };
  }
  return { status: "none" };
}

async function recordReportIncompleteEvidence(
  context: TuiContext,
  sessionId: string,
  guard: ReportWriteGuard,
): Promise<string> {
  const evidence = createEvidenceRecord(
    "command_output",
    `report_incomplete blocked missing Write evidence requestedPath=${guard.requestedPath}`,
    `report:${guard.requestedPath}`,
    ["report_incomplete", "missing_write_evidence", guard.requestedPath],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(
    context,
    sessionId,
    `report_incomplete: missing Write evidence for ${guard.requestedPath}; evidence=${evidence.id}`,
    "warning",
  );
  return formatReportIncompletePrimary(guard.requestedPath, context.language);
}

async function findNaturalFileCandidates(
  text: string,
  projectPath: string,
  recent: string[],
): Promise<string[]> {
  const keywords = extractFileSearchKeywords(text);
  const recentMatches = recent.filter((file) => matchesFileKeywords(file, keywords));
  if (recentMatches.length > 0) {
    return uniqueStrings(recentMatches).slice(0, 5);
  }
  if (keywords.length === 0) {
    return [];
  }

  const files = await listProjectFiles(projectPath, 300);
  return files.filter((file) => matchesFileKeywords(file, keywords)).slice(0, 5);
}

async function listProjectFiles(projectPath: string, limit: number): Promise<string[]> {
  const files: string[] = [];
  await collectProjectFiles(projectPath, projectPath, files, limit);
  return files;
}

async function collectProjectFiles(
  root: string,
  current: string,
  files: string[],
  limit: number,
): Promise<void> {
  if (files.length >= limit) {
    return;
  }
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= limit) {
      return;
    }
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      await collectProjectFiles(root, fullPath, files, limit);
      continue;
    }
    if (entry.isFile()) {
      files.push(relative(root, fullPath).replaceAll("\\", "/"));
    }
  }
}

function formatHomeScreen(context: TuiContext): string {
  const model = getSelectedModelRuntime(context).model;
  const project = basename(context.projectPath) || context.projectPath;
  const mode = formatPermissionModeLabel(context.permissionMode, context.language);
  if (context.language === "en-US") {
    return [
      `Project ${project} · Model ${model} · Mode ${mode}`,
      "You can describe a goal directly, like “check project status” or “run tests”.",
      "For exact commands, use /help.",
      formatModeBehavior(context.permissionMode, context.language),
      "",
    ].join("\n");
  }
  return [
    `项目 ${project} · 模型 ${model} · 模式 ${mode}`,
    "可以直接说“帮我检查项目状态 / 跑测试 / 解释这个报错”。",
    "需要精确命令时，用 /help 查看。",
    formatModeBehavior(context.permissionMode, context.language),
    "",
  ].join("\n");
}

async function handleToolCommand(
  name: ToolName,
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  try {
    const input = parseToolInput(name, args);
    const sessionId = await ensureSession(context);
    const permission = await decidePermission(name, input, context, sessionId);
    await context.store.appendEvent(sessionId, {
      type: "permission_request",
      request: permission.request,
      createdAt: new Date().toISOString(),
    });
    await context.store.appendEvent(sessionId, {
      type: "permission_result",
      requestId: permission.request.id,
      decision: permission.decision,
      reason: permission.reason,
      createdAt: new Date().toISOString(),
    });

    if (permission.decision !== "allow") {
      await recordToolFailureEvidence(
        context,
        sessionId,
        name,
        `permission ${permission.decision}: ${permission.reason}; ${permission.request.summary}`,
      );
      writeLine(output, formatPermissionDenied(permission.reason, permission.request.summary));
      writeStatus(output, context);
      return;
    }

    if (permission.preflight) {
      writeLine(output, permission.preflight);
    }

    if (name === "Bash") {
      const guard = checkBackgroundStartGuard(context, "bash", true);
      if (guard) {
        writeLine(output, guard);
        writeStatus(output, context);
        return;
      }
    }

    const checkpoint = await maybeCreateCheckpoint(name, input, context, sessionId);
    if (checkpoint) {
      writeLine(output, `${t(context, "checkpointCreated")}：${checkpoint.id}`);
    }
    const task = name === "Bash" ? createBackgroundTask(name, input, context) : undefined;
    if (task) {
      rememberBackgroundTask(context, task);
      await appendBackgroundTaskEvent(context, sessionId, task);
      writeLine(output, formatBackgroundTask(task, context.language));
    }

    const callId = randomUUID();
    await context.store.appendEvent(sessionId, {
      type: "tool_call_start",
      id: callId,
      name,
      input,
      createdAt: new Date().toISOString(),
    });
    const backgroundController = task
      ? registerBackgroundAbortController(context, task.id)
      : undefined;
    const previousAbortSignal = context.tools.abortSignal;
    if (backgroundController) {
      context.tools.abortSignal = backgroundController.signal;
    }
    const progress = installToolProgressHandler(context, sessionId, callId, output, task);
    // D.13L Section 4 — 在 runTool 前 emit `<Tool>(<arg>)` 启动行，与 CCB
    // AssistantToolUseMessage 渲染对齐；只有可派生单参数（command / path /
    // pattern）时才打印，避免 fallback 到无意义的 "Tool() ".
    const startBanner = formatToolStart(name, input);
    if (startBanner) {
      writeLine(output, startBanner);
    }
    let result: Awaited<ReturnType<typeof runTool>>;
    try {
      result = await runTool(name, input, context.tools);
    } finally {
      progress.restore();
      await Promise.all(progress.pending);
      clearBackgroundAbortController(context, task?.id ?? "");
      if (backgroundController) {
        context.tools.abortSignal = previousAbortSignal;
      }
    }
    if (task) {
      finishBackgroundTaskFromToolOutput(task, result.output, context);
      await appendBackgroundTaskEvent(context, sessionId, task);
    }
    await context.store.appendEvent(sessionId, createToolEndEvent(callId, result.output));
    await appendDerivedToolEvents(context, sessionId, name, result.output);
    const evidence = await recordToolEvidence(context, sessionId, name, result.output);
    rememberToolFiles(context, name, input, result.output);
    await appendToolResultEvent(
      context,
      sessionId,
      callId,
      name,
      result.output,
      isToolOutputFailure(name, result.output),
      evidence?.id,
    );
    writeLine(output, formatToolOutput(name, result.output, context.language, evidence?.id));
    writeStatus(output, context);
  } catch (error) {
    writeLine(output, formatError(error, context.language));
  }
}

function parseToolInput(name: ToolName, args: string[]): unknown {
  if (name === "Read") {
    return { path: requireArg(args.join(" ").trim(), "用法：/read <path>") };
  }
  if (name === "Write") {
    return {
      path: requireArg(args[0], "用法：/write <path> <text>"),
      content: args.slice(1).join(" "),
    };
  }
  if (name === "Edit" || name === "MultiEdit") {
    const path = requireArg(args[0], `用法：/${name.toLowerCase()} <path> <old> => <new>`);
    const expression = args.slice(1).join(" ");
    const separator = expression.indexOf("=>");
    if (separator < 0) {
      throw new Error(`用法：/${name.toLowerCase()} <path> <old> => <new>`);
    }
    const oldText = expression.slice(0, separator).trim();
    const newText = expression.slice(separator + 2).trim();
    if (name === "MultiEdit") {
      return { path, edits: [{ oldText, newText }] };
    }
    return { path, oldText, newText };
  }
  if (name === "Grep") {
    return { pattern: requireArg(args[0], "用法：/grep <pattern> [path]"), path: args[1] };
  }
  if (name === "Glob") {
    return { pattern: requireArg(args[0], "用法：/glob <pattern> [path]"), path: args[1] };
  }
  if (name === "Bash") {
    return { command: requireArg(args.join(" ").trim(), "用法：/bash <command>") };
  }
  if (name === "Todo") {
    const action = args[0];
    if (!action) {
      return { action: "list" };
    }
    if (action === "add") {
      return {
        action,
        content: requireArg(args.slice(1).join(" ").trim(), "用法：/todo add <text>"),
      };
    }
    if (action === "start" || action === "done" || action === "block") {
      return { action, id: requireArg(args[1], `用法：/todo ${action} <id>`) };
    }
    throw new Error("用法：/todo 或 /todo add|start|done|block ...");
  }
  return {};
}

function requireArg(value: string | undefined, usage: string): string {
  if (!value) {
    throw new Error(usage);
  }
  return value;
}

// Module 3 — PermissionCheck / decidePermission / recordPermissionDenied /
// loadPermissionState / savePermissionState / permissionStatePath 已移至
// ./tui-permission-runtime.ts。

function formatPlanProposal(proposal: PlanProposal): string {
  const lines = [`PlanProposal ${proposal.id}：${proposal.title}`];
  for (const option of proposal.options) {
    lines.push(`方案 ${option.id}：${option.title}`);
    lines.push(...option.steps.map((step, index) => `  ${index + 1}. ${step}`));
    lines.push(...option.risks.map((risk) => `  风险：${risk}`));
  }
  return lines.join("\n");
}

async function maybeCreateCheckpoint(
  name: ToolName,
  input: unknown,
  context: TuiContext,
  sessionId: string,
): Promise<CheckpointState | null> {
  const files = collectInputFiles(input);
  const needsCheckpoint = !builtInTools[name].isReadOnly && files.length > 0;
  if (!needsCheckpoint) {
    return null;
  }
  const checkpoint: CheckpointState = {
    id: randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    reason: `before ${name}`,
    changedFiles: files,
    restoreKind: "snapshot",
    files: [],
  };
  for (const file of files) {
    const target = resolve(context.projectPath, file);
    try {
      checkpoint.files.push({ path: file, existed: true, content: await readFile(target, "utf8") });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        checkpoint.files.push({ path: file, existed: false });
        continue;
      }
      throw error;
    }
  }
  context.checkpoints.unshift(checkpoint);
  context.checkpoints = context.checkpoints.slice(0, MAX_CHECKPOINTS);
  await context.store.appendEvent(sessionId, {
    type: "checkpoint_created",
    checkpoint: {
      id: checkpoint.id,
      sessionId: checkpoint.sessionId,
      createdAt: checkpoint.createdAt,
      reason: checkpoint.reason,
      changedFiles: checkpoint.changedFiles,
      restoreKind: checkpoint.restoreKind,
    },
    createdAt: checkpoint.createdAt,
  });
  return checkpoint;
}

function createBackgroundTask(
  name: ToolName,
  input: unknown,
  context: TuiContext,
): BackgroundTaskState {
  const now = new Date().toISOString();
  const command =
    typeof input === "object" && input !== null ? (input as { command?: unknown }).command : "";
  const title =
    name === "Bash" && typeof command === "string" ? `Bash: ${truncateDisplay(command, 40)}` : name;
  return {
    id: randomUUID(),
    kind: "bash",
    title,
    status: "running",
    currentStep: context.language === "en-US" ? "running command" : "正在执行命令",
    progress: { completed: 0, total: 1, label: "Bash" },
    startedAt: now,
    updatedAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    userVisibleSummary:
      context.language === "en-US"
        ? "Started long task. Use /background for details."
        : "长任务已启动。可用 /background 查看详情。",
    nextAction:
      context.language === "en-US"
        ? "Wait for completion or use /interrupt."
        : "等待完成，或用 /interrupt 中断。",
  };
}

async function appendBackgroundTaskEvent(
  context: TuiContext,
  sessionId: string,
  task: BackgroundTaskState,
): Promise<void> {
  await context.store.appendEvent(sessionId, {
    type: "background_task_update",
    task,
    createdAt: new Date().toISOString(),
  });
}

function installToolProgressHandler(
  context: TuiContext,
  sessionId: string,
  callId: string,
  output: Writable,
  task?: BackgroundTaskState,
): { pending: Promise<void>[]; restore: () => void } {
  const previous = context.tools.onProgress;
  const pending: Promise<void>[] = [];
  let visibleProgressLines = 0;
  let progressSuppressed = false;
  context.tools.onProgress = (event: ToolProgressEvent) => {
    if (event.toolName !== "Bash") {
      void previous?.(event);
      return;
    }
    const message = `[${event.stream}] ${event.text}`;
    if (task) {
      task.currentStep = event.stream === "stderr" ? "stderr output" : "streaming output";
      task.updatedAt = new Date().toISOString();
      task.lastOutputAt = task.updatedAt;
      task.hasOutput = true;
      task.progress = { completed: 0, total: 1, label: "streaming" };
      pending.push(appendBackgroundTaskEvent(context, sessionId, task));
    }
    pending.push(
      context.store.appendEvent(sessionId, {
        type: "tool_call_delta",
        id: callId,
        message: truncateDisplay(message.replace(/\s+/g, " "), 500),
        createdAt: new Date().toISOString(),
      }),
    );
    const lines = message.split(/\r?\n/u).filter(Boolean);
    const remainingLines = Math.max(0, 12 - visibleProgressLines);
    if (remainingLines > 0) {
      output.write(`${lines.slice(0, remainingLines).join("\n")}\n`);
      visibleProgressLines += Math.min(lines.length, remainingLines);
    }
    if (lines.length > remainingLines && !progressSuppressed) {
      output.write(
        context.language === "en-US"
          ? "[stdout] ... streaming output hidden from main view; full log/transcript keeps the complete output.\n"
          : "[stdout] ... 主屏已隐藏后续流式输出；完整输出保留在日志/transcript。\n",
      );
      progressSuppressed = true;
    }
  };
  return {
    pending,
    restore: () => {
      context.tools.onProgress = previous;
    },
  };
}

function createEvidenceRecord(
  kind: EvidenceRecord["kind"],
  summary: string,
  source: string,
  supportsClaims: string[],
): EvidenceRecord {
  return {
    id: randomUUID(),
    kind,
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 180),
    source,
    supportsClaims,
    createdAt: new Date().toISOString(),
  };
}

function rememberEvidence(context: TuiContext, evidence: EvidenceRecord): void {
  context.evidence.unshift(evidence);
  context.evidence = context.evidence.slice(0, MAX_EVIDENCE_RECORDS);
}

function pickEvidence(
  evidence: EvidenceRecord,
): Pick<EvidenceRecord, "id" | "kind" | "source" | "summary"> {
  return {
    id: evidence.id,
    kind: evidence.kind,
    source: evidence.source,
    summary: evidence.summary,
  };
}

function createRoleHandoff(
  from: ModelRole,
  to: ModelRole,
  taskId: string,
  summary: string,
  context: TuiContext,
): RoleHandoff {
  const diffSummary =
    context.tools.changedFiles.length > 0
      ? {
          changedFiles: [...context.tools.changedFiles],
          addedLines: 0,
          removedLines: 0,
          summary: "本阶段只传 diff 摘要和文件列表，不传完整 patch。",
          riskyFiles: [],
        }
      : undefined;
  return {
    from,
    to,
    taskId,
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 300),
    evidence: context.evidence.slice(0, 5).map(pickEvidence),
    changedFiles: [...context.tools.changedFiles],
    keyFiles: context.memory.lastHandoff?.keyFiles.slice(0, 8) ?? [],
    ...(diffSummary ? { diffSummary } : {}),
    ...(context.lastVerification ? { verificationReport: context.lastVerification } : {}),
    notIncluded: ["full transcript", "full memory", "full index", "large logs"],
  };
}

function addRoleUsage(
  context: TuiContext,
  role: ModelRole,
  route: RoleModelRoute,
  inputTokens: number,
  outputTokens: number,
  contributionSummary = "role contribution recorded",
): void {
  const latestDecision = context.routeDecisions.find(
    (decision) =>
      decision.role === role &&
      decision.selectedProvider === route.provider &&
      decision.selectedModel === route.primaryModel,
  );
  const existing = context.roleUsage.find(
    (usage) =>
      usage.role === role &&
      usage.provider === (route.provider || "unconfigured") &&
      usage.model === (route.primaryModel || "unconfigured"),
  );
  if (existing) {
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.fallbackUsed = existing.fallbackUsed || Boolean(latestDecision?.fallbackUsed);
    existing.budgetStop = existing.budgetStop || Boolean(latestDecision?.budgetStop);
    existing.contributionSummary = contributionSummary;
    return;
  }
  context.roleUsage.push({
    role,
    provider: route.provider || "unconfigured",
    model: route.primaryModel || "unconfigured",
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCny: 0,
    createdAt: new Date().toISOString(),
    fallbackUsed: Boolean(latestDecision?.fallbackUsed),
    budgetStop: Boolean(latestDecision?.budgetStop),
    contributionSummary,
  });
}

async function recordProviderFailureEvidence(
  context: TuiContext,
  sessionId: string,
  error: unknown,
  runtime: SelectedModelRuntime,
): Promise<EvidenceRecord> {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "PROVIDER_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  const summary = `provider_failure code=${code} provider=${runtime.provider} model=${runtime.model} endpointProfile=${runtime.endpointProfile} message=${sanitizeProviderFailureText(message)}`;
  const evidence = createEvidenceRecord(
    "command_output",
    summary,
    `provider:${runtime.provider}:failure`,
    ["provider_failure", code, runtime.provider, runtime.model, runtime.endpointProfile],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(context, sessionId, summary, "warning");
  context.lastProviderFailure = {
    code,
    provider: runtime.provider,
    model: runtime.model,
    endpointProfile: runtime.endpointProfile,
    summary: evidence.summary,
    evidenceId: evidence.id,
    createdAt: evidence.createdAt,
  };
  return evidence;
}

function sanitizeProviderFailureError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return sanitizeProviderFailureText(String(error));
  }
  const sanitized = new Error(sanitizeProviderFailureText(error.message));
  if ("suggestion" in error && typeof error.suggestion === "string") {
    Object.assign(sanitized, { suggestion: error.suggestion });
  }
  return sanitized;
}

function sanitizeProviderFailureText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/api[_-]?key=[^\s&]+/giu, "api_key=***")
    .replace(/[A-Z]:[\\/][^\s]+/gu, "[local-path]")
    .replace(/\/[^\s]*?(?:Linghun|linghun)[^\s]*/gu, "[local-path]");
}

async function recordToolFailureEvidence(
  context: TuiContext,
  sessionId: string,
  name: ToolName,
  summary: string,
): Promise<EvidenceRecord> {
  const evidence = createEvidenceRecord(
    "command_output",
    `${name} failure: ${truncateDisplay(summary.replace(/\s+/g, " "), 140)}`,
    `tool:${name}:failure`,
    [name, "tool_failure"],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  return evidence;
}

async function recordArchitectureRuntimeCard(
  context: TuiContext,
  sessionId: string,
  card: ArchitectureCard,
): Promise<EvidenceRecord> {
  const evidence = createEvidenceRecord(
    "command_output",
    `architecture_runtime target=${card.target}; facts=${card.projectFacts.length}; verification=${card.verification.length}`,
    "architecture-runtime:v1",
    ["architecture_runtime", "architecture_card", card.target],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(
    context,
    sessionId,
    `architecture_runtime_triggered evidence=${evidence.id} target=${card.target}`,
    "info",
  );
  if (context.memory.lastHandoff) {
    context.memory.lastHandoff.currentArchitectureCard = summarizeArchitectureCard(card);
    await writeHandoffPacket(context, context.memory.lastHandoff);
  }
  return evidence;
}

async function recordToolEvidence(
  context: TuiContext,
  sessionId: string,
  name: ToolName,
  output: ToolOutput,
): Promise<EvidenceRecord | null> {
  const kind =
    name === "Read"
      ? "file_read"
      : name === "Grep" || name === "Glob"
        ? "grep_result"
        : name === "Bash" || name === "Write" || name === "Edit" || name === "MultiEdit"
          ? "command_output"
          : null;
  if (!kind) {
    return null;
  }
  const evidence = createEvidenceRecord(
    kind,
    `${name}: ${truncateDisplay(output.text.replace(/\s+/g, " "), 120)}`,
    output.fullOutputPath ?? name,
    [name],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  return evidence;
}

async function appendSystemEvent(
  context: TuiContext,
  sessionId: string,
  message: string,
  level: "info" | "warning",
): Promise<void> {
  await context.store.appendEvent(sessionId, {
    type: "system_event",
    id: randomUUID(),
    level,
    message,
    createdAt: new Date().toISOString(),
  });
}

async function appendRouteDecisionEvent(
  context: TuiContext,
  sessionId: string,
  decision: RoleRouteDecision,
): Promise<void> {
  await appendSystemEvent(
    context,
    sessionId,
    `RoleRouteDecision ${decision.id}: trigger=${decision.triggerReason} role=${decision.role} selected=${decision.selectedProvider || "paused"}/${decision.selectedModel || "paused"} fallbackCandidates=${decision.fallbackCandidates.join(",") || "none"} capabilities=${decision.requiredCapabilities.join("+")} budget=${decision.maxCostCny === undefined ? "unconfigured" : decision.maxCostCny} fallbackUsed=${decision.fallbackUsed ? "yes" : "no"} budgetStop=${decision.budgetStop ? "yes" : "no"} stop=${decision.stopConditions.join("|") || "none"}`,
    decision.stopConditions.length > 0 ? "warning" : "info",
  );
}

function checkEvidenceGate(text: string, context: TuiContext): string | null {
  const lower = text.toLowerCase();
  const asksCodeFact =
    /代码|函数|调用链|实现|修复|验证|code|function|call chain|fixed|verified/.test(lower);
  if (!asksCodeFact) {
    return null;
  }
  if (context.evidence.length > 0) {
    return null;
  }
  return t(context, "evidenceBlocked");
}

type ClaimCheck = {
  status: "passed" | "needs_disclaimer" | "blocked";
  unsupportedClaims: string[];
  verdict?: VerdictEvidenceScope;
};

function createHandoffPendingItems(evidence: EvidenceRecord[]): string[] {
  return createPhase15BetaVerdictScope(evidence).uncoveredItems;
}

function createHandoffRiskItems(evidence: EvidenceRecord[]): string[] {
  return createPhase15BetaVerdictScope(evidence).residualRisks;
}

function createPhase15BetaVerdictScope(
  evidence: EvidenceRecord[] = [],
  transcript: TranscriptEvent[] = [],
): VerdictEvidenceScope {
  const requiredEvidence = [
    {
      key: "real-tui-report-generation",
      missing: "real TUI report-generation path lacks PASS evidence",
      present: hasEvidenceClaim(
        evidence,
        /real[-\s]?tui.*report.*pass|report[-\s]?generation.*pass/iu,
      ),
    },
    {
      key: "deepseek-dual-provider-pass",
      missing: "DeepSeek dual-provider live report evidence is missing",
      present: hasEvidenceClaim(evidence, /deepseek.*(?:gate\s*f|dual[-\s]?provider).*pass/iu),
    },
    {
      key: "openai-compatible-dual-provider-pass",
      missing: "OpenAI-compatible dual-provider live report evidence is missing",
      present: hasEvidenceClaim(
        evidence,
        /openai[-\s]?compatible.*(?:gate\s*f|dual[-\s]?provider).*pass/iu,
      ),
    },
    {
      key: "write-evidence",
      missing: "report Write evidence is missing",
      present: hasReportWriteEvidence(evidence),
    },
    {
      key: "final-answer-report-reference",
      missing: "final answer does not reference the generated report",
      present: hasFinalAnswerReportReference(evidence, transcript),
    },
  ];
  const hasBlockingGate = hasBlockingGateEvidence(evidence, transcript);
  const uncoveredItems = requiredEvidence
    .filter((item) => !item.present)
    .map((item) => item.missing);
  const residualRisks: string[] = [];
  if (uncoveredItems.length > 0) {
    residualRisks.push(
      "live provider basic text PASS is not live provider tool/report PASS",
      "mock provider PASS and focused test PASS cannot prove Beta readiness",
    );
  }
  if (hasBlockingGate) {
    uncoveredItems.push("blocking gate evidence still contains SKIPPED, PARTIAL, or BLOCKED");
    residualRisks.push("blocking gate is not fully closed");
  }
  return {
    scope: "beta",
    status: uncoveredItems.length === 0 ? "PASS" : "PARTIAL",
    evidenceRefs: evidence.filter((item) => isBetaVerdictEvidence(item)).map((item) => item.id),
    validationCommands: [
      "corepack pnpm test -- --run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts",
      "corepack pnpm test",
      "corepack pnpm check",
      "corepack pnpm typecheck",
      "corepack pnpm build",
      "git diff --check",
    ],
    uncoveredItems,
    residualRisks,
    nextAction:
      uncoveredItems.length === 0
        ? "All required Beta readiness evidence is present. User confirmation is still required before Beta."
        : "Fix or re-smoke the real provider + real TUI report-generation path before any Beta readiness PASS claim.",
  };
}

function hasEvidenceClaim(evidence: EvidenceRecord[], pattern: RegExp): boolean {
  return evidence.some((item) =>
    pattern.test([item.summary, item.source, ...item.supportsClaims].join(" ")),
  );
}

function hasReportWriteEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some(
    (item) =>
      item.kind === "command_output" &&
      (item.source === "Write" || item.supportsClaims.includes("Write")) &&
      /report|报告|\.md\b/iu.test([item.summary, item.source, ...item.supportsClaims].join(" ")),
  );
}

function hasFinalAnswerReportReference(
  evidence: EvidenceRecord[],
  transcript: TranscriptEvent[],
): boolean {
  if (hasEvidenceClaim(evidence, /final answer.*report|最终回答.*报告|reference.*report/iu)) {
    return true;
  }
  return [...transcript]
    .reverse()
    .some(
      (event) =>
        event.type === "assistant_text_delta" &&
        /(?:report[\w./\\-]*\.md|报告文件|生成的报告|saved report)/iu.test(event.text),
    );
}

function hasBlockingGateEvidence(
  evidence: EvidenceRecord[],
  transcript: TranscriptEvent[],
): boolean {
  const blockingStatusPattern =
    /(?:blocking|阻塞|gate|闸门).{0,80}(?:SKIPPED|PARTIAL|BLOCKED|跳过|部分|阻塞)|(?:SKIPPED|PARTIAL|BLOCKED).{0,80}(?:blocking|阻塞|gate|闸门)/iu;
  if (hasEvidenceClaim(evidence, blockingStatusPattern)) {
    return true;
  }
  return transcript.some((event) => {
    if (event.type === "verification_end") {
      return (
        event.report.status === "partial" ||
        event.report.commands.some(
          (command) => command.status === "partial" || command.status === "skipped",
        )
      );
    }
    if (event.type === "system_event" || event.type === "assistant_text_delta") {
      const text = event.type === "system_event" ? event.message : event.text;
      return blockingStatusPattern.test(text);
    }
    return false;
  });
}

function isBetaVerdictEvidence(item: EvidenceRecord): boolean {
  return (
    /real[-\s]?tui.*report.*pass|report[-\s]?generation.*pass|deepseek.*(?:gate\s*f|dual[-\s]?provider).*pass|openai[-\s]?compatible.*(?:gate\s*f|dual[-\s]?provider).*pass|final answer.*report|最终回答.*报告/iu.test(
      [item.summary, item.source, ...item.supportsClaims].join(" "),
    ) || hasReportWriteEvidence([item])
  );
}

function isBetaReadinessClaim(normalizedClaim: string): boolean {
  return (
    normalizedClaim.includes("beta") &&
    (normalizedClaim.includes("ready") ||
      normalizedClaim.includes("readiness") ||
      normalizedClaim.includes("pass") ||
      normalizedClaim.includes("完成") ||
      normalizedClaim.includes("就绪") ||
      normalizedClaim.includes("通过"))
  );
}

function checkClaimSupport(claim: string, context: TuiContext): ClaimCheck {
  const normalizedClaim = claim.toLowerCase();
  if (isBetaReadinessClaim(normalizedClaim)) {
    return {
      status: "needs_disclaimer",
      unsupportedClaims: ["Beta readiness PASS"],
      verdict: createPhase15BetaVerdictScope(context.evidence),
    };
  }

  const highRisk = [
    "已完成",
    "已修复",
    "已验证",
    "无风险",
    "等于 ccb",
    "成熟工具",
    "可以进入 beta",
    "测试通过",
    "代码里",
    "调用链是",
    "不会影响",
    "completed",
    "fixed",
    "verified",
    "no risk",
    "ccb parity",
    "ready for beta",
    "release ready",
    "tests passed",
    "in the code",
  ];
  const unsupportedClaims = highRisk.filter((item) => normalizedClaim.includes(item.toLowerCase()));
  if (unsupportedClaims.length === 0 || context.evidence.length > 0) {
    return { status: "passed", unsupportedClaims: [] };
  }
  return { status: "needs_disclaimer", unsupportedClaims };
}

function formatClaimCheck(result: ClaimCheck, language: Language): string {
  if (result.verdict) {
    const evidenceStatus = result.verdict.evidenceRefs.length > 0 ? "recorded" : "missing";
    const validation = result.verdict.validationCommands.join("; ");
    const uncovered = result.verdict.uncoveredItems.join("; ");
    const risks = result.verdict.residualRisks.join("; ");
    return language === "en-US"
      ? [
          `Claim Checker: verdict=${result.verdict.status}; scope=${result.verdict.scope}.`,
          `Evidence is ${evidenceStatus}; use /details evidence for details.`,
          `Validation: ${validation}.`,
          `Uncovered: ${uncovered}.`,
          `Risk: ${risks}.`,
          `Next: ${result.verdict.nextAction}`,
        ].join("\n")
      : [
          `Claim Checker：verdict=${result.verdict.status}；scope=${result.verdict.scope}。`,
          `证据已${evidenceStatus === "recorded" ? "记录" : "缺失"}；详情用 /details evidence。`,
          `Validation：${validation}。`,
          `Uncovered：${uncovered}。`,
          `Risk：${risks}。`,
          `Next：${result.verdict.nextAction}`,
        ].join("\n");
  }
  if (result.status === "passed") {
    return language === "en-US" ? "Claim check passed." : "Claim Checker：通过。";
  }
  const claims = result.unsupportedClaims.join(", ");
  return language === "en-US"
    ? `Claim needs disclaimer: ${claims}. Use unverified / pending confirmation wording.`
    : `Claim Checker：缺少证据，需降级表述：${claims}。请改写为“未验证 / 待确认”。`;
}

function createToolEndEvent(id: string, output: ToolOutput): TranscriptEvent {
  return {
    type: "tool_call_end",
    id,
    output,
    createdAt: new Date().toISOString(),
  };
}

function isToolOutputFailure(name: ToolName, output: ToolOutput): boolean {
  if (name === "Bash") {
    const exitCode = (output.data as { exitCode?: unknown } | undefined)?.exitCode;
    return typeof exitCode === "number" && exitCode !== 0;
  }
  return false;
}

async function appendDerivedToolEvents(
  context: TuiContext,
  sessionId: string,
  name: ToolName,
  output: ToolOutput,
): Promise<void> {
  if (name === "Todo") {
    await context.store.appendEvent(sessionId, {
      type: "todo_update",
      items: context.tools.todos as TodoItem[],
      createdAt: new Date().toISOString(),
    });
  }
  if (name === "Diff" && isDiffSummary(output.data)) {
    await context.store.appendEvent(sessionId, {
      type: "diff_update",
      summary: output.data,
      createdAt: new Date().toISOString(),
    });
  }
}

function isDiffSummary(value: unknown): value is DiffSummary {
  return typeof value === "object" && value !== null && "changedFiles" in value;
}

async function ensureSession(context: TuiContext): Promise<string> {
  if (context.sessionId) {
    return context.sessionId;
  }

  const session = await context.store.create({ model: context.model });
  context.sessionId = session.id;
  context.sessionEnded = false;
  return session.id;
}

function isSessionEnded(transcript: TranscriptEvent[]): boolean {
  return transcript.at(-1)?.type === "session_end";
}

function writeStatus(output: Writable, context: TuiContext): void {
  const background = context.backgroundTasks.filter((task) => task.status === "running").length;
  const latestHitRate = context.cache.history.at(-1)?.hitRate ?? null;
  const gate = context.pendingLocalApproval
    ? "waiting approval"
    : context.pendingNaturalCommand || context.pendingAutopilot
      ? "waiting confirmation"
      : "none";
  writeLine(
    output,
    formatRuntimeStatusLine(
      {
        session: context.sessionId ?? (context.language === "en-US" ? "new" : "未创建"),
        provider: getRuntimeStatusProvider(context),
        model: getSelectedModelRuntime(context).model,
        endpointProfile: getSelectedModelRuntime(context).endpointProfile,
        reasoningStatus: getSelectedModelRuntime(context).reasoningStatus,
        mode: context.permissionMode,
        background,
        cacheHitRate: latestHitRate,
        indexStatus: context.index.status,
        gate,
      },
      context.language,
    ),
  );
}

function t(context: TuiContext, key: MessageKey, values: Record<string, string> = {}): string {
  let template = messages[context.language][key];
  for (const [name, value] of Object.entries(values)) {
    template = template.replaceAll(`{${name}}`, value);
  }
  return template;
}

const messages: Record<Language, Record<MessageKey, string>> = {
  "zh-CN": {
    appTitle: "{name} TUI / REPL",
    intro: "输入普通消息开始对话；输入 /help 查看命令；输入 /exit 退出。",
    currentModel: "当前模型",
    unknownCommand: "未知命令",
    languageSwitchedZh: "语言已切换为中文。",
    languageSwitchedEn: "Language switched to English.",
    modeCurrent: "当前权限模式：{mode}",
    modeOptions: "可选：default / auto-review / plan / full-access",
    modeBoundary:
      "边界：full-access 需要本地显式 opt-in；auto-review 只自动允许低风险工作区编辑。Plan approval 不授权所有工具。",
    modeUnknown: "未知模式。可选：default / auto-review / plan / full-access",
    modeFullAccessPlanBlocked:
      "Plan 模式不能直接切到 full-access 执行写入。请先批准计划的明确边界，或切回 default。",
    modeFullAccessOptInBlocked:
      "已拒绝切换 full-access：full-access 必须本地显式 opt-in，不能由自然语言、workflow、agent、plugin 或 hook 静默开启。",
    modeSwitched: "已切换权限模式：{mode}",
    modePlanBoundary:
      "Plan 模式只允许 Read / Grep / Glob / Diff / Todo 等只读或会话内操作。确认方案后仍不等于授权所有工具。",
    startGateConfirmed: "已确认，正在进入本地动作路径；后续受保护操作仍会单独审批。",
    startGateExpired: "确认已过期。请重新发起请求。",
    startGateExactRequired: "该动作需要输入精确 slash command 才能继续；这条输入未执行。",
    startGatePlainConfirmationRejected: "该动作需要精确确认；普通 yes/确认 未放行。",
    exit: "已退出 Linghun。",
    status:
      "状态栏：session {session} · model {model} · mode {mode} · bg {background} · cache {cache} · index {index} · gate {gate}",
    statusShort: "状态栏：{mode} · bg {background}",
    help: "帮助",
    inputPrompt: "你> ",
    noSessions: "当前项目还没有会话。",
    sessionHeader: "会话ID  更新时间  摘要",
    noSummary: "（无摘要）",
    checkpointCreated: "已创建 checkpoint",
    checkpointNone: "当前没有 checkpoint。",
    checkpointRestored: "已恢复 checkpoint",
    checkpointMissing: "未找到 checkpoint",
    backgroundNone: "当前没有后台任务。",
    backgroundEmptyOutput: "尚未产生有效输出",
    backgroundRunning: "仍在运行",
    interruptIdle: "当前没有正在运行的长任务；状态为 idle。",
    interruptCancelled: "已标记当前长任务为 cancelled。",
    btwPrefix: "临时插问",
    evidenceBlocked:
      "尚未确认，需要先检查。涉及代码事实的结论必须先通过 /read、/grep、索引查询或命令输出获得证据。",
    claimNeedsDisclaimer: "缺少证据，必须降级为未验证或待确认表述。",
    projectRulesMissingHint:
      "[hint:info] 缺少 LINGHUN.md 项目规则；如需基础模板，可运行 /memory init。不会自动生成或打断输入。",
    toolInterrupted: "当前模型响应或工具调用已取消；可以继续输入。",
  },
  "en-US": {
    appTitle: "{name} TUI / REPL",
    intro: "Type a message to chat; use /help for commands; use /exit to quit.",
    currentModel: "Current model",
    unknownCommand: "Unknown command",
    languageSwitchedZh: "语言已切换为中文。",
    languageSwitchedEn: "Language switched to English.",
    modeCurrent: "Current permission mode: {mode}",
    modeOptions: "Options: default / auto-review / plan / full-access",
    modeBoundary:
      "Boundary: full-access requires local opt-in; auto-review only allows low-risk workspace edits automatically. Plan approval does not authorize every tool.",
    modeUnknown: "Unknown mode. Options: default / auto-review / plan / full-access",
    modeFullAccessPlanBlocked:
      "Plan mode cannot switch directly to full-access for writes. Approve a clear plan boundary first, or switch back to default.",
    modeFullAccessOptInBlocked:
      "Refused to switch to full-access: full-access requires local opt-in and cannot be silently enabled by natural language, workflow, agent, plugin, or hook.",
    modeSwitched: "Permission mode switched: {mode}",
    modePlanBoundary:
      "Plan mode only allows Read / Grep / Glob / Diff / Todo and session-scoped actions. Accepting a plan still does not authorize every tool.",
    startGateConfirmed:
      "Confirmed; entering the local action path. Protected follow-up actions still require separate approval.",
    startGateExpired: "Confirmation expired. Reissue the request.",
    startGateExactRequired:
      "This action requires the exact slash command before it can continue. This input was not executed.",
    startGatePlainConfirmationRejected:
      "This action requires exact confirmation; plain yes/confirm was not accepted.",
    exit: "Exited Linghun.",
    status:
      "Status: session {session} · model {model} · mode {mode} · bg {background} · cache {cache} · index {index} · gate {gate}",
    statusShort: "Status: {mode} · bg {background}",
    help: "Help",
    inputPrompt: "you> ",
    noSessions: "No sessions for this project yet.",
    sessionHeader: "Session ID  Updated At  Summary",
    noSummary: "(no summary)",
    checkpointCreated: "Checkpoint created",
    checkpointNone: "No checkpoints yet.",
    checkpointRestored: "Checkpoint restored",
    checkpointMissing: "Checkpoint not found",
    backgroundNone: "No background tasks.",
    backgroundEmptyOutput: "no valid output yet",
    backgroundRunning: "still running",
    interruptIdle: "No long task is running; state is idle.",
    interruptCancelled: "Current long task marked as cancelled.",
    btwPrefix: "Temporary question",
    evidenceBlocked:
      "Not confirmed yet; evidence is required first. Use /read, /grep, index query, or command output before code-fact claims.",
    claimNeedsDisclaimer:
      "Evidence is missing; downgrade to unverified or pending confirmation wording.",
    projectRulesMissingHint:
      "[hint:info] LINGHUN.md project rules are missing. To create a basic template, run /memory init. I will not generate it automatically or interrupt input.",
    toolInterrupted: "The current model response or tool call was cancelled; input is ready again.",
  },
};

function createUserMessageEvent(text: string): TranscriptEvent {
  return {
    type: "user_message",
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
  };
}

function createSessionEndEvent(sessionId: string): TranscriptEvent {
  return {
    type: "session_end",
    sessionId,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Test-only factory. ShellBlockOutput 是 module-internal class（Ink shell 注入），
 * 这里仅为单测暴露一个等价构造器，让测试可以验证 assistant_text_delta 多片
 * 累积到同一条 keep:true block 而不是被 _write 的 ephemeral splice 淘汰。
 * 不要在生产代码里使用这个工厂。
 */
export function __testCreateShellBlockOutput(
  context: TuiContext,
  blocks: ProductBlockViewModel[],
  onWrite: () => void = () => {},
): Writable & {
  beginAssistantStream(id: string): void;
  appendAssistantDelta(text: string): void;
  endAssistantStream(): void;
} {
  return new ShellBlockOutput(context, blocks, onWrite);
}
