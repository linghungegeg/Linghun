import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, accessSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import {
  stderr as defaultStderr,
  stdin as defaultStdin,
  stdout as defaultStdout,
} from "node:process";
import { clearLine, cursorTo, emitKeypressEvents, moveCursor } from "node:readline";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import {
  type LinghunConfig,
  type McpServerConfig,
  type ModelRole,
  type ProviderEnvSetup,
  type RemoteChannelType,
  type RemoteEventType,
  type RoleModelRoute,
  type WorkspaceTrustLevel,
  calculateEstimatedCny,
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
  type ModelGateway,
  type ModelMessage,
  type ModelToolCall,
  type ModelUsage,
  findKnownModel,
} from "@linghun/providers";
import {
  LINGHUN_NAME,
  type Language,
  type PermissionMode,
  isNodeErrorWithCode,
} from "@linghun/shared";
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
  type RegistryAgentDefinition,
  type RegistryWorkflowDefinition,
  loadAgentRegistry,
  loadWorkflowRegistry,
  registryAgentToWorkflowTemplate,
  registryWorkflowToTemplate,
} from "./agent-workflow-registry.js";
import {
  type BoundaryEditPreflightResult,
  checkBoundaries,
  checkBoundaryEditPreflight,
  detectBashFileWriteTargets,
  estimateFileMetrics,
} from "./architecture-boundary.js";
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
  RESOURCE_GUARD_KIND,
  __testStopCommandPanelSelection,
  __testToggleCommandPanelSelection,
  __testUpdateCommandPanelSelection,
  checkBackgroundStartGuard,
  checkResourceGuard,
  finishBackgroundTaskFromToolOutput,
  handleInterruptCommand,
  interruptAllActiveWork,
  refreshBackgroundLifecycle,
  refreshRunnerStatusForJob,
  startRunnerForDurableJob,
  stopCommandPanelSelection,
  stopRunnerForDurableJob,
  toggleCommandPanelSelection,
  updateCommandPanelSelection,
} from "./background-control-runtime.js";
import {
  appendBreakCacheEvent,
  buildPromptCacheRequestFields,
  clearBreakCacheMarker,
  formatBreakCacheStatus,
  writeBreakCacheMarker,
} from "./break-cache-runtime.js";
import { runBtwSideQuestion } from "./btw-runtime.js";
import {
  createRuntimeStatusSnapshot,
  formatRuntimeStatusSnapshotForBtw,
} from "./runtime-status-snapshot.js";
import {
  buildCacheStatusPanel,
  formatCacheLog,
  formatCacheStatus,
  formatCompactStatus,
  writeLightHints,
} from "./cache-command-runtime.js";
import {
  recordCacheRequestObservation,
  recordCacheUsageObservation,
} from "./cache-policy-runtime.js";
import {
  createCacheFreshness,
  createConfigFreshnessSummary,
  diffFreshness,
  stableHash,
  stableStringify,
} from "./cache-freshness.js";
import {
  buildExplicitDetailsCommandPanel,
  getCommandPanelSelectableRows,
  showCommandPanel,
} from "./command-panel-runtime.js";
import {
  appendUsageEvents,
  compactPreflightDeps,
  executeBreakCacheMutation,
  getCurrentFreshness,
  handleBreakCacheCommand,
  handleCacheCommand,
  handleCacheLogCommand,
  handleClaimCheckCommand,
  handleCompactCommand,
  recordBreakCacheMutationEvidence,
  recordMemoryMutationEvidence,
  recordModelUsage,
  refreshCacheFreshness,
  refreshCompactPressureSnapshot,
  refreshWorkspaceReferenceCache,
  requestMemoryMutationApproval,
} from "./compact-cache-command-runtime.js";
import { compactBoundaryHash } from "./compact-context.js";
import {
  getAutoCompactTriggerChars,
  getProviderContextMaxChars,
  inspectToolPairingSafety,
  prepareMessagesForProviderPreflight,
  recordCompactBoundary,
} from "./compact-preflight-runtime.js";
import { estimateModelMessageChars } from "./context-estimator.js";
import { runDeepCompact } from "./deep-compact-runtime.js";
import {
  type DeferredToolDescriptor,
  type DeferredToolDiscoverySnapshot,
  type DeferredToolKind,
  type DiscoveredDeferredToolsSummary,
  deferredToolListHashInput,
  findDeferredTool,
  formatDeferredToolsSystemReminder,
  getCodebaseMemoryToolRisk,
  isCodebaseMemoryToolName,
  isLocalStdioMcpServer,
  listDeferredTools,
  parseMcpDeferredToolName,
  sanitizeDiscoveredDeferredToolName,
  searchDeferredTools,
  snapshotDeferredTools,
  snapshotDeferredToolsSummary,
  snapshotDiscoveredDeferredToolsSummary,
  summarizeDeferredToolMatch,
  validateCodebaseMemoryToolExecution,
} from "./deferred-tools-catalog.js";
import {
  __testBuildExplicitDetailsCommandPanel,
  __testCreateShellBlockOutput,
  __testCreateVerificationLevelForReadiness,
  createSessionEndEvent,
  createSilentOutput,
  createUserMessageEvent,
  ensureSession,
  formatHomeScreen,
  formatShellBackgroundSummaries,
  handleDetailsCommand,
  t,
  writeStatus,
} from "./details-status-runtime.js";
import {
  TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS,
  TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS,
  appendBackgroundTaskEvent,
  appendDeferredToolResultEvent,
  appendDerivedToolEvents,
  appendRouteDecisionEvent,
  appendSystemEvent,
  appendToolResultEvent,
  budgetToolResultTranscriptContent,
  captureFailureLearning,
  createEvidenceRecord,
  createToolEndEvent,
  getToolResultBudgetState,
  isToolOutputFailure,
  pickEvidence,
  recordArchitectureRuntimeCard,
  recordModelToolFailureForMetaScheduler,
  recordProviderFailureEvidence,
  recordToolEvidence,
  recordToolFailureEvidence,
  recordToolResultBudgetEvidence,
  recordVerificationEvidence,
  rememberEvidence,
  sanitizeProviderFailureError,
  sanitizeProviderFailureText,
  truncateRoundAssistantForProvider,
} from "./evidence-runtime.js";
import {
  type ExtensionInstallRequest,
  type ExtensionKind,
  formatConfigOverview,
  formatFeaturePolicy,
  formatHooksDoctor,
  formatWorkflows,
  githubRepoToUrl,
  refreshExtensionState,
  validateExtensionContributionExecution,
} from "./extension-command-runtime.js";
import {
  configureExtensionSlashRuntime,
  handlePluginsCommand,
  handleSkillsCommand,
} from "./extension-slash-runtime.js";
import {
  configureFailureLearningCommandRuntime,
  handleFailuresCommand,
} from "./failure-learning-command-runtime.js";
import {
  type FailureLearningInput,
  buildFailureLearningSummaryForPrompt,
  createFailureLearningState,
  loadFailureRecords,
  recordFailureLearningDegradedWarning,
} from "./failure-learning-runtime.js";
import { startFeishuLongConnection } from "./feishu-long-connection-runtime.js";
import {
  checkClaimSupport,
  createHandoffPendingItems,
  createHandoffRiskItems,
  createPhase15BetaVerdictScope,
  formatClaimCheck,
  runArchitectureAndCompletenessFinalGate,
} from "./final-answer-gate.js";
import {
  handleCheckpointCommand,
  handleGitCommand,
  handleWorktreeCommand,
} from "./git-command-runtime.js";
import { computeWorktreeContext } from "./git-operation-runtime.js";
import type { GitSlashDeps } from "./git-slash-runtime.js";
import {
  type GitToolDispatchDeps,
  type WorktreeRemoveResolveDeps,
  executeGitToolUse,
  resolveStablePointApprove,
  resolveStablePointDeny,
  resolveWorktreeRemoveApprove,
  resolveWorktreeRemoveDeny,
} from "./git-tool-dispatch-runtime.js";
import { isGitToolName, summarizeWorktreeContextForPrompt } from "./git-tool-runtime.js";
import {
  createHandoffPacket,
  formatResumePacket,
  hydrateResumeContext,
  isHandoffPacket,
  loadOrCreateHandoffPacket,
  validateHandoffPacket,
  writeHandoffPacket,
} from "./handoff-session-runtime.js";
import {
  isIgnoredIndexPath,
  scanIndexSafety,
  summarizeIndexResult,
} from "./index-result-presenter.js";
import {
  type CodebaseMemoryBinarySource,
  type CodebaseMemoryBinaryStatus,
  type IndexSafetyFile,
  type IndexState,
  createIndexState,
  findCurrentIndexProject,
  formatIndexRuntimeRef,
} from "./index-runtime.js";
import {
  INDEX_REFRESH,
  INDEX_REPAIR,
  INDEX_STATUS_INSPECT,
  isIndexToolName,
  isMutatingIndexTool,
  parseIndexRefreshInput,
  summarizeIndexRefreshOutcome,
  summarizeIndexStatusInspect,
} from "./index-tool-runtime.js";
import {
  cancelAgentByRef,
  cancelAllAgents,
  configureJobAgentCommandRuntime,
  denyAgentToolUse,
  executeApprovedAgentToolUse,
  handleAgentsCommand,
  handleBackgroundCommand,
  handleForkCommand,
  handleJobCommand,
  hydrateDurableJobBackgroundTasks,
  hydratePersistentAgents,
  sendAgentMessage,
  transitionDurableJob,
} from "./job-agent-command-runtime.js";
import {
  formatBackgroundDetails,
  formatBackgroundOutputDetails,
  formatBackgroundTask,
  formatElapsedSince,
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
  DEFAULT_JOB_TIMEOUT_MS,
  JOB_LOG_TAIL_LINES,
  JOB_RECOVERY_HEARTBEAT_STALE_MS,
  type JobContext,
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
  buildIndexStatusPanel,
  buildMcpStatusPanel,
  formatIndexRefreshSummary,
  formatIndexStatus,
  formatMcpStatus,
} from "./mcp-index-command-runtime.js";
import {
  configureMcpIndexRuntime,
  executeExtraTool,
  executeSearchExtraTools,
  handleIndexCommand,
  handleMcpCommand,
  refreshIndexStatus,
  runIndexQuery,
  runIndexRepository,
  stabilizeMcpToolList,
} from "./mcp-index-runtime.js";
import {
  isPotentiallyMutatingMcpTool,
  runMcpStdioToolCall,
  runMcpStdioToolList,
} from "./mcp-stdio-runtime.js";
import {
  type MemoryMutation,
  configureMemoryCommandRuntime,
  executeMemoryMutation,
  handleMemoryCommand,
  resumeSessionWithHandoff,
  runAutoLearningOnTurnEnd,
} from "./memory-command-runtime.js";
import {
  evaluateMetaScheduler,
  formatMetaSchedulerDirective,
  verifyFailureLearningContract,
} from "./meta-scheduler-runtime.js";
import {
  configureModelCommandRuntime,
  handleModelCommand,
  handleModelRouteCommand,
  handleModelSetupInput,
  startModelSetup,
} from "./model-command-runtime.js";
import {
  formatModelRouteDoctor,
  formatModelRouteSummary,
  formatModelRoutes,
  getRoleRoute,
  inferProviderForRouteModel,
  isModelRole,
} from "./model-doctor-runtime.js";
import {
  AGENT_CONTROL_TOOL_NAME,
  COMMAND_PROPOSAL_TOOL_NAME,
  EXECUTE_EXTRA_TOOL_NAME,
  type FinalAnswerClaimVerdict,
  INDEX_OPERATION_TOOL_NAME,
  RUN_VERIFICATION_TOOL_NAME,
  RUN_WORKFLOW_TOOL_NAME,
  SEARCH_EXTRA_TOOLS_NAME,
  SEND_MESSAGE_TOOL_NAME,
  START_AGENT_TOOL_NAME,
  type SolutionCompletenessClassification,
  type SolutionCompletenessSeverity,
  type SolutionCompletenessStatus,
  WRITE_REPORT_TOOL_NAME,
  buildDowngradedFinalAnswer,
  buildExtendedDowngradedFinalAnswer,
  createDeferredToolDispatchDefinitions,
  createExtendedFinalAnswerReminder,
  createFinalAnswerClaimReminder,
  createModelToolDefinitions,
  createModelToolDefinitionsForReportGuard,
  createModelToolDefinitionsForTools,
  createSolutionCompletenessStatus,
  createToolInputSchema,
  createToolUseDriftSummary,
  deriveToolSupportsClaims,
  evaluateFinalAnswerClaims,
  extractFileMentions,
  extractFileSearchKeywords,
  extractNaturalReadPath,
  formatFileCandidates,
  hasModelSynthesisIntent,
  isNaturalReadFileRequest,
  looksLikeFilePath,
  matchesFileKeywords,
  normalizeRelativePath,
  readToolInputString,
  sanitizeDeferredToolPrimaryText,
  stripStructuredFinalAnswerClaims,
} from "./model-loop-runtime.js";
import { createModelSystemPrompt, sanitizeMainScreenLeakage } from "./model-prompt-runtime.js";
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
  __testSendMessage,
  buildModelMessagesWithRecentContext,
  clearRequestActivity,
  continueModelAfterToolResults,
  handleNaturalInput,
  handleRemoteInboundMessage,
  sendMessage,
  startRequestActivity,
} from "./model-stream-runtime.js";
import {
  executeApprovedIndexToolUse,
  executeApprovedModelToolUse,
  executeModelToolUse,
  formatBoundaryEditPreflightPrompt,
  formatPlanProposal,
  handleToolCommand,
  recordReportIncompleteEvidence,
  rememberToolFiles,
} from "./model-tool-runtime.js";
import {
  type NaturalIntent,
  type PendingNaturalCommand,
  type SLASH_COMMAND_REGISTRY,
  buildRuntimeStatusForModel,
  createModelCapabilitySummary,
  matchesNaturalGateConfirmation,
} from "./natural-command-bridge.js";
import {
  formatPendingApprovalDetails,
  formatPendingNaturalCommandDetails,
  formatWorkspaceTrustStatus,
} from "./pending-details-presenter.js";
import {
  addAllowRuleForTest,
  cancelPendingInteraction,
  confirmPendingInteraction,
  cycleMode,
  executePermissionApprove,
  executePermissionDeny,
  handleModeCommand,
  handlePermissionsCommand,
  handlePlanCommand,
  handleTuiKeypress,
  hasPendingEnterConfirmation,
  reevaluatePendingLocalApprovalAfterModeChange,
} from "./permission-approval-runtime.js";
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
import { classifyToolRequest } from "./permission-policy-engine.js";
import {
  formatLocalToolPermissionPrompt,
  formatModelToolPermissionPrompt,
} from "./permission-presenter.js";
import { redactedPath, runCommandCapture } from "./process-command-runtime.js";
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
  checkAndWriteProviderCooldown,
  recordProviderFallbackAttempt,
  resolveRuntimeFallback,
} from "./provider-loop-runtime.js";
import {
  configureRemoteCommandRuntime,
  consumeRemoteInboundMessage,
  createRemoteEvent,
  handleRemoteCommand,
  processRemoteApprovalForTest,
  processRemoteInbound,
  sendRemoteEventReal,
  validateRemoteInboundEnvelope,
  validateRemotePairingEnvelope,
} from "./remote-command-runtime.js";
import { decideRemoteInbox, processRemoteBindCommand } from "./remote-inbound-bridge-runtime.js";
import { formatMcpTools } from "./remote-mcp-presenter.js";
import {
  type ProviderFailureKind,
  type RequestActivityPhase,
  classifyProviderFailure,
  formatProviderEmptyResponsePrimary,
  formatProviderFailureKindLabel,
  formatProviderFailurePrimary,
  formatProviderFallbackAttemptSummary,
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
import {
  LINGHUN_BASH_MAX_OUTPUT_DEFAULT,
  LINGHUN_BASH_MAX_OUTPUT_UPPER_LIMIT,
  LINGHUN_BYTES_PER_TOKEN,
  LINGHUN_DEFAULT_TOOL_RESULT_CHARS,
  LINGHUN_MAX_AGENTIC_TURNS,
  LINGHUN_MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES,
  LINGHUN_MAX_TODO_ONLY_CONSECUTIVE_ROUNDS,
  LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  LINGHUN_MAX_TOOL_RESULT_BYTES,
  LINGHUN_MAX_TOOL_RESULT_TOKENS,
  LINGHUN_TASK_MAX_OUTPUT_DEFAULT,
  LINGHUN_TASK_MAX_OUTPUT_UPPER_LIMIT,
} from "./runtime-budget.js";
import { classifyRuntimePath, classifyStartupPath } from "./runtime-path-marker.js";
import { formatPermissionModeLabel, formatRuntimeStatusLine } from "./runtime-status-presenter.js";
import {
  createCommandBlock,
  createUserTextBlock,
} from "./shell/models/command-transcript-presenter.js";
import { writePlainShell } from "./shell/plain-renderer.js";
import type {
  BackgroundTaskSummary,
  ProductBlockViewModel,
  ShellController,
  ShellInputEvent,
} from "./shell/types.js";
import {
  createOutputBlock,
  createShellViewModel,
  mapPendingApprovalToPermission,
  mapRequestActivityToView,
} from "./shell/view-model.js";
import {
  formatCatalogHelp,
  formatModeBehavior,
  formatSlashDiscovery,
  formatUnknownSlashCommand,
  getSlashPrefixCandidates,
  isAllowedModeStartGate,
  looksLikeOrdinaryDevelopmentRequest,
  slashCommandToTool,
} from "./slash-dispatch.js";
import {
  createShellLimitations,
  formatDisplayPath,
  formatError,
  formatProjectRouteProblem,
  formatProviderEnvWarning,
  formatUserScopedSetupNeeded,
  readInputLines,
  readOutputColumns,
  readOutputRows,
  sanitizeDiagnosticText,
  sanitizeDisplayPaths,
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
import {
  createTerminalReadinessView,
  createVerificationLevelForReadiness,
} from "./terminal-readiness-runtime.js";
import {
  createAssistantPrimaryTextSanitizer,
  formatToolOutput,
  formatToolStart,
} from "./tool-output-presenter.js";
import {
  type ToolResultBudgetRecord,
  type ToolResultBudgetState,
  applyToolResultBudgetToMessages,
  formatToolResultBudgetEvidenceSummary,
  formatToolResultBudgetSystemEvent,
} from "./tool-result-budget.js";
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
import {
  findBackgroundTask,
  isActiveBackgroundStatus,
  isRuntimeActiveBackgroundTask,
  listCancellableAgents,
} from "./tui-agent-job-runtime.js";
import { rememberBackgroundTask } from "./tui-agent-job-runtime.js";
import {
  createAgentBackgroundTask,
  createAgentContextSummary,
  createEmptyAgentCost,
  getAgentPermissionMode,
  getAgentRole,
  isAgentType,
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
import {
  BACKGROUND_KIND_CAPS,
  BACKGROUND_RUNNING_GLOBAL_CAP,
  CODEBASE_MEMORY_COMMAND,
  CODEBASE_MEMORY_ENV,
  DEFAULT_LIGHT_HINT_COOLDOWN_MS,
  MAX_BACKGROUND_TASKS,
  MAX_CACHE_HISTORY_SIZE,
  MAX_CHECKPOINTS,
  MAX_CONTEXT_MESSAGES,
  MAX_EVIDENCE_RECORDS,
  MAX_LIGHT_HINTS_PER_TURN,
  MAX_MODEL_TOTAL_TOOL_ROUNDS,
  MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES,
  MAX_TODO_ONLY_CONSECUTIVE_ROUNDS,
  MEMORY_PROMPT_ITEM_WIDTH,
  MEMORY_PROMPT_TOP_K,
  MEMORY_PROMPT_TOTAL_WIDTH,
  MIN_CACHE_HISTORY_SIZE,
  PROJECT_RULES_STATUS_WIDTH,
  REQUEST_SLOW_HINT_MS,
  VERIFICATION_COMMAND_TIMEOUT_MS,
  createSingleToolCallContinuation,
  runtimeFromContinuation,
} from "./tui-context-runtime.js";
import type {
  BreakCacheMutationAction,
  PendingAutopilotRequest,
  PendingLocalApproval,
  PendingModelContinuation,
  TuiContext,
} from "./tui-context-runtime.js";
import type {
  AgentMailboxMessage,
  AgentRun,
  AgentType,
  ApprovedRunnerJobSpec,
  BackgroundTaskState,
  BackgroundTaskStatus,
  CacheHistoryConfig,
  CacheState,
  CheckpointState,
  CompactProjection,
  DurableJobAgent,
  DurableJobAgentStatus,
  DurableJobState,
  DurableJobStatus,
  EvidenceRecord,
  ExtensionLifecycleRecord,
  ExtensionScope,
  ExtensionSource,
  ExtensionTrustLevel,
  FailureLearningCategory,
  FailureLearningRecord,
  FailureLearningSeverity,
  FailureLearningState,
  FailureLearningStatus,
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
  ProviderFallbackAttemptSummary,
  RemoteApprovalDecision,
  RemoteApprovalMessage,
  RemoteChannelRuntimeStatus,
  RemoteChannelState,
  RemoteEvent,
  RemoteEventStatus,
  RemoteInboundDecision,
  RemoteInboundMessage,
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
  WorkflowStepState,
  WorkflowTemplate,
} from "./tui-data-types.js";
import {
  createLogArtifactRegistry,
  findEvidence,
  formatAgentDetails,
  formatEvidenceDetails,
  parseLogArtifactRequest,
} from "./tui-details-runtime.js";
import {
  containsSecret,
  countMemoryScopes,
  createControlledMemoryInjection,
  createEvidenceBackedMemoryCandidates,
  createLinghunMdTemplate,
  createMemoryCandidate,
  estimateMemoryTokens,
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
import { type MessageKey, messages } from "./tui-messages.js";
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
import {
  ShellBlockOutput,
  beginAssistantStream,
  createShellBlockOutputForTest,
  discardAssistantBlock,
  endAssistantStream,
  replaceAssistantBlockContent,
  writeAssistantDelta,
  writeDiagnosticLine,
  writeErrorLine,
  writeLocalCommandOutputLine,
} from "./tui-output-surface.js";
import {
  addAllowRule,
  decidePermission,
  loadPermissionState,
  recordPermissionDenied,
  savePermissionState,
  toPermissionPromptView,
} from "./tui-permission-runtime.js";
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
import { CHAT_COMPLETIONS_ENDPOINT, formatStats, formatUsage } from "./usage-stats-presenter.js";
import {
  createReviewReport,
  createVerificationUnavailableReport,
  createVerificationPlan,
  formatVerificationLast,
  formatVerificationPlan,
  formatVerificationTaskSummary,
  runVerificationCommand,
  runVerificationPlan,
} from "./verification-command-runtime.js";
import { classifyVerificationLevel } from "./verification-level.js";
import {
  type WorkflowBridgeRequestProposal,
  type WorkflowMainChainRequest,
  bridgeWorkflowPlanToMainChainRequests,
  decideWorkflowStepCapability,
} from "./workflow-agent-runtime-bridge.js";
import {
  configureWorkflowCommandRuntime,
  createWorkflowInterruptBackgroundTask,
  findRegistryAgentWorkflow,
  findRegistryWorkflow,
  finishWorkflowRun,
  formatWorkflowStartPrimary,
  handleWorkflowsCommand,
  hydrateWorkflowRuns,
  runRegistryAgentWorkflow,
  runRegistryWorkflow,
  runWorkflowSteps,
  runWorkflowVerificationStep,
  upsertWorkflowBackgroundTask,
} from "./workflow-command-runtime.js";
import type { NormalizedWorkflowPlan } from "./workflow-plan-schema.js";
import type { WorkflowPlannerEntryResult } from "./workflow-planner-entry.js";
import {
  type WorkspaceReferenceCache,
  createWorkspaceReferenceCache,
  getWorkspaceReferenceSnapshot,
  isFallbackWorkspaceReferenceSnapshot,
  workspaceReferenceHash,
} from "./workspace-reference-cache.js";
type SlashRuntimeDeps = {
  handleSlashCommand: (
    text: string,
    context: TuiContext,
    output: Writable,
  ) => Promise<"handled" | "exit" | "message">;
};

let slashRuntimeDeps: SlashRuntimeDeps | undefined;

export function configureSlashCommandRuntime(deps: SlashRuntimeDeps): void {
  slashRuntimeDeps = deps;
}

export async function handleSlashCommand(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<"handled" | "exit" | "message"> {
  if (!slashRuntimeDeps) {
    throw new Error("slash command runtime is not configured");
  }
  return slashRuntimeDeps.handleSlashCommand(text, context, output);
}

export const gitToolDispatchDeps: GitToolDispatchDeps = {
  maxCheckpoints: MAX_CHECKPOINTS,
  startRequestActivity,
  clearRequestActivity,
  writeLine,
  formatError,
  appendSystemEvent,
  createEvidenceRecord,
  rememberEvidence,
  recordToolEvidence,
  recordToolFailureEvidence,
  appendDeferredToolResultEvent,
  createSingleToolCallContinuation,
  randomUUID,
  resolvePath: resolve,
  readFileUtf8: (path) => readFile(path, "utf8"),
};

export const gitSlashDeps: GitSlashDeps = {
  dispatch: gitToolDispatchDeps,
  ensureSession,
  writeLine,
  writeStatus,
};

// git_worktree_remove yes/no 解析 deps。continueAfterToolResults 仅 gateway 在场时回灌续轮。
export function createWorktreeRemoveResolveDeps(
  gateway: ModelGateway | undefined,
): WorktreeRemoveResolveDeps {
  return {
    ...gitToolDispatchDeps,
    writeLightHints,
    writeStatus,
    formatPermissionDenialPrimary,
    continueAfterToolResults: async (continuation, context, output) => {
      if (gateway) await continueModelAfterToolResults(continuation, context, gateway, output);
    },
  };
}

// Module 2 (state-runtime) — pure state factories and their leaf helpers
// moved to ./tui-state-runtime.ts. Only `refreshRemoteState` stays here
export async function runCommandCaptureForTest(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): ReturnType<typeof runCommandCapture> {
  return runCommandCapture(command, args, cwd, timeoutMs);
}

export async function handleDoctorCommand(
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
    refreshBackgroundLifecycle(context);
    writeLine(
      output,
      formatTerminalReadinessDoctor(createTerminalReadinessView(context), { showAll: true }),
    );
    return;
  }
  if (["readiness", "status"].includes(action)) {
    refreshBackgroundLifecycle(context);
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

export function writeWorkspaceTrustStartupNotice(output: Writable, context: TuiContext): void {
  const level = context.config.workspaceTrust.level;
  if (!context.config.workspaceTrust.recorded) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Workspace trust not set. Use interactive mode to confirm trust on first run."
        : "工作区信任未设置。首次启动时会提示确认。",
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
      ? `Workspace: ${level}. Writes and commands require approval. Use /trust to change.`
      : `工作区：${level}。写入和命令需要确认。可用 /trust 调整。`,
  );
}

export async function shouldPromptForInitialLanguage(
  input: Readable,
  context: TuiContext,
): Promise<boolean> {
  return (
    (input as { isTTY?: boolean }).isTTY === true &&
    !(await hasRecordedUserLanguage()) &&
    !(await hasRecordedProjectLanguage(context.projectPath))
  );
}

export async function promptInitialLanguage(
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
  let choicesRendered = false;
  const renderChoices = (): void => {
    const cursor = (active: boolean) => (active ? "❯" : " ");
    const choiceLines = [
      `  ${cursor(selectedIndex === 0)} [${selectedIndex === 0 ? "x" : " "}] 中文 (zh-CN)`,
      `  ${cursor(selectedIndex === 1)} [${selectedIndex === 1 ? "x" : " "}] English (en-US)`,
      "> ",
    ];
    renderInteractiveChoiceLines(output, choiceLines, choicesRendered);
    choicesRendered = true;
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
    const onKeypress = (str: string | undefined, key: { name?: string } = {}) => {
      const name = key.name;
      const value = typeof str === "string" ? str.trim().toLowerCase() : "";
      if (name === "escape") {
        finish("zh-CN");
        return;
      }
      if (name === "return" || name === "enter") {
        finish(selectedIndex === 0 ? "zh-CN" : "en-US");
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
      if (/^(1|zh|中)$/iu.test(value)) {
        finish("zh-CN");
        return;
      }
      if (/^(2|en|e)$/iu.test(value)) {
        finish("en-US");
        return;
      }
      // Plain typed choices are handled by readline 'line'; ignore other raw input here.
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
  });
}

function renderInteractiveChoiceLines(
  output: Writable,
  lines: string[],
  replacePrevious: boolean,
): void {
  const isTtyOutput = (output as { isTTY?: boolean }).isTTY === true;
  if (!isTtyOutput) {
    output.write(`${lines.join("\n")}\n`);
    return;
  }
  if (replacePrevious) {
    moveCursor(output, 0, -(lines.length - 1));
  }
  lines.forEach((line, index) => {
    cursorTo(output, 0);
    clearLine(output, 0);
    output.write(line);
    if (index < lines.length - 1) {
      output.write("\n");
    }
  });
}

export const __testRenderInteractiveChoiceLines = renderInteractiveChoiceLines;

export function shouldPromptForInitialWorkspaceTrust(
  input: Readable,
  context: TuiContext,
): boolean {
  return (input as { isTTY?: boolean }).isTTY === true && !context.config.workspaceTrust.recorded;
}

export async function promptInitialWorkspaceTrust(
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
  let choicesRendered = false;
  const renderChoices = (): void => {
    const trustLabel = isEnglish ? "Trust this project (yes)" : "信任此项目 (yes)";
    const restrictedLabel = isEnglish ? "Keep restricted (no)" : "保持 restricted (no)";
    const cursor = (active: boolean) => (active ? "❯" : " ");
    const lines = [
      `  ${cursor(selectedIndex === 0)} [${selectedIndex === 0 ? "x" : " "}] ${trustLabel}`,
      `  ${cursor(selectedIndex === 1)} [${selectedIndex === 1 ? "x" : " "}] ${restrictedLabel}`,
      "> ",
    ];
    renderInteractiveChoiceLines(output, lines, choicesRendered);
    choicesRendered = true;
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
    const onKeypress = (str: string | undefined, key: { name?: string } = {}) => {
      const name = key.name;
      const value = typeof str === "string" ? str.trim().toLowerCase() : "";
      if (name === "escape") {
        finish(false);
        return;
      }
      if (name === "return" || name === "enter") {
        finish(selectedIndex === 0);
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
      if (/^(y|是|信)$/iu.test(value)) {
        finish(true);
        return;
      }
      if (/^(n|否|不)$/iu.test(value)) {
        finish(false);
        return;
      }
      // 普通 yes/no 输入由 readline 'line' 事件处理；此处忽略其他原始输入。
      void str;
    };
    const onLine = (line: string) => {
      const normalized = line.trim().toLowerCase();
      if (normalized === "") {
        finish(selectedIndex === 0);
        return;
      }
      if (/^(yes|y|confirm|ok|okay|trust|trusted|确认|是|信任)$/iu.test(normalized)) {
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
  });
}

export function getWorkspaceTrustCommandGuard(
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
  if (command === "/remote")
    return !["", "status", "doctor", "list", "events", "inbox"].includes(args[0] ?? "");
  if (command === "/index") return ["init", "refresh", "repair"].includes(args[0] ?? "");
  if (command === "/mcp")
    return ["add", "enable", "disable", "remove", "update"].includes(args[0] ?? "");
  if (command === "/skills" || command === "/plugins") {
    return ["install", "enable", "disable", "remove", "update", "evolve"].includes(args[0] ?? "");
  }
  if (command === "/workflows") return ["run", "enable", "disable"].includes(args[0] ?? "");
  return false;
}

export async function handleTrustCommand(
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

export async function handleAutopilotCommand(
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
    `- 允许范围：durable job + background + runner fallback；allow edit ${pending.allowEdit ? "yes" : "no"}；allow bash ${pending.allowBash ? "yes" : "no"}`,
    `- 预算：steps<=${pending.maxSteps}；tokens<=${pending.maxTokens}；timeoutMs<=${pending.timeoutMs}`,
    "- 禁止事项：不绕过 Start Gate / permission pipeline / Plan approval；不进入真实 smoke；不把 runner completed 当 verification PASS。",
    "- 控制入口：/autopilot confirm 启动；/esc 或 /autopilot cancel 取消；启动后用 /job pause|resume|cancel <id>。",
    "- 报告入口：启动后查看 /job report <id>、/job logs <id>、/background。",
  ].join("\n");
}

export async function startPendingAutopilot(context: TuiContext, output: Writable): Promise<void> {
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

export async function handleLanguageCommand(
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

// Module 4 — isAgentType / getAgentRole / getAgentPermissionMode /
// createEmptyAgentCost / createAgentContextSummary / createAgentBackgroundTask
// 已移至 ./tui-agent-job-runtime.ts。

// Module 4 — mapAgentBackgroundResult / findAgent / formatAgentSummary /
// 4 abort controller helpers 已移至 ./tui-agent-job-runtime.ts。

// Module 5 — formatAgentDetails 已移至 ./tui-details-runtime.ts。

// Module 4 — formatAgentSummary moved to ./tui-agent-job-runtime.ts
// (en-US/zh-CN 双分支字符串完全一致，新模块去掉冗余 ternary，行为不变)

export async function handleRewindCommand(
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
    // D.13R: 明确这些是 Linghun snapshot checkpoint，不是 git rollback。
    writeLine(
      output,
      context.language === "en-US"
        ? "Linghun snapshot checkpoints (in-memory file snapshots; not git revert/reset and does not move HEAD):"
        : "Linghun snapshot checkpoint（内存文件快照，不是 git revert/reset，不移动 HEAD）：",
    );
    writeLine(
      output,
      context.checkpoints
        .map(
          (checkpoint) => {
            const restoreState =
              checkpoint.restorable === false || checkpoint.files.length === 0
                ? context.language === "en-US"
                  ? "not restorable after resume"
                  : "恢复后不可还原"
                : context.language === "en-US"
                  ? "restorable"
                  : "可还原";
            return `${checkpoint.id}  ${checkpoint.createdAt}  ${restoreState}  ${checkpoint.changedFiles.join(", ")}`;
          },
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
  if (checkpoint.restorable === false || checkpoint.files.length === 0) {
    writeLine(
      output,
      context.language === "en-US"
        ? `Checkpoint cannot be restored after resume: ${
            checkpoint.restoreUnavailableReason ?? "snapshot file contents are unavailable"
          }.`
        : `checkpoint 在恢复会话后不可还原：${
            checkpoint.restoreUnavailableReason ?? "缺少 snapshot 文件内容"
          }。`,
    );
    return;
  }
  const sessionId = await ensureSession(context);
  if (checkpoint.sessionId !== sessionId) {
    writeLine(
      output,
      context.language === "en-US"
        ? `Checkpoint belongs to another session and will not be restored: ${checkpoint.id}.`
        : `checkpoint 属于其他会话，已拒绝恢复：${checkpoint.id}。`,
    );
    return;
  }
  const permission = await decidePermission(
    "Write",
    { paths: checkpoint.changedFiles.length > 0 ? checkpoint.changedFiles : [".linghun/checkpoint-restore"] },
    context,
    sessionId,
  );
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
      "Write",
      `checkpoint restore ${permission.decision}: ${permission.reason}`,
    );
    writeLine(output, formatPermissionDenied(permission.reason, permission.request.summary));
    writeStatus(output, context);
    return;
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
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
  await context.store.appendEvent(sessionId, {
    type: "checkpoint_restored",
    checkpointId: checkpoint.id,
    createdAt: new Date().toISOString(),
  });
  const evidence = createEvidenceRecord(
    "command_output",
    `checkpoint restore ${checkpoint.id}: files ${checkpoint.changedFiles.join(",")}`,
    `checkpoint:${checkpoint.id}`,
    ["checkpoint_restore", "Write"],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
  writeLine(
    output,
    context.language === "en-US"
      ? `Linghun snapshot checkpoint restored (file snapshot only; not git revert/reset and HEAD was not moved): ${checkpoint.id}`
      : `已恢复 Linghun snapshot checkpoint（仅文件快照；不是 git revert/reset，HEAD 未移动）：${checkpoint.id}`,
  );
  writeStatus(output, context);
}

export async function handleBtwCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const question = args.join(" ").trim();
  if (!question) {
    writeLine(
      output,
      context.language === "en-US" ? "Usage: /btw <side question>" : "用法：/btw <临时小问题>",
    );
    return;
  }
  // D.14D — /btw is now model-backed for every question (no status_query short-circuit):
  // isolated single-turn, no tools, does not pollute main conversation / Todo / Plan /
  // checkpoint / git stable point / evidence / D.13U/D.13V completion gate.
  const sessionId = await ensureSession(context);
  const gateway = context.modelGateway;
  // ink 路径：先开 loading 面板，让用户看到"正在回答"；plain 路径无面板。
  if (context.isInkSession) {
    context.btwPanelState = { question, phase: "loading" };
    // 在 await 模型前主动刷一帧 loading，否则单次 handler 内的 loading 态不可见。
    context.shellRerender?.();
  }
  if (!gateway) {
    // gateway 不可用（理论上仅在未走 runTui 的测试桩里）——可见降级，不假装答案。
    const msg =
      context.language === "en-US"
        ? "Side question unavailable: model gateway is not ready."
        : "临时插问不可用：模型网关尚未就绪。";
    if (context.isInkSession) {
      context.btwPanelState = { question, phase: "error", error: msg };
    } else {
      writeLine(output, msg);
    }
    return;
  }
  const runtime = getSelectedModelRuntime(context);
  const controller = new AbortController();
  context.activeBtwAbortController = controller;
  const snapshot = createRuntimeStatusSnapshot({
    language: context.language,
    requestActivityPhase: context.requestActivityPhase,
    requestActivityStartedAt: (context as { requestActivityStartedAt?: number }).requestActivityStartedAt,
    requestActivityToolName: context.requestActivityToolName,
    pendingApproval: Boolean(context.pendingLocalApproval),
    workflow: context.workflows?.activeRun,
    backgroundTasks: context.backgroundTasks,
  });
  const deepSummary = context.cache.deepCompact?.summary;
  const snapshotText = formatRuntimeStatusSnapshotForBtw(snapshot, context.language);
  const contextSnapshot = deepSummary
    ? `${snapshotText}\n\n--- Session summary ---\n${deepSummary}`
    : snapshotText;
  const result = await runBtwSideQuestion(
    question,
    gateway,
    {
      provider: runtime.provider,
      model: runtime.model,
      endpointProfile: runtime.endpointProfile,
      reasoningLevel: runtime.reasoningLevel,
      reasoningSent: runtime.reasoningSent,
    },
    context.language,
    controller.signal,
    context.providerBreaker,
    contextSnapshot,
    {
      onRequest: (request) =>
        recordCacheRequestObservation(context.cache, "side-question", runtime.provider, request),
      onUsage: (usage) => recordCacheUsageObservation(context.cache, usage),
    },
  );
  if (context.activeBtwAbortController === controller) {
    context.activeBtwAbortController = undefined;
  }
  // 记录 side question（含答案/错误）供 /details 审计；不写 evidence，不进 completion gate。
  await context.store.appendEvent(sessionId, {
    type: "btw_question",
    id: randomUUID(),
    text: question,
    answer: result.status === "answered" ? result.answer : `error: ${result.error}`,
    createdAt: new Date().toISOString(),
  });
  if (
    context.isInkSession &&
    context.btwPanelState?.phase === "loading" &&
    context.btwPanelState.question === question
  ) {
    context.btwPanelState =
      result.status === "answered"
        ? { question, phase: "answered", answer: result.answer }
        : { question, phase: "error", error: result.error };
  } else if (!context.isInkSession) {
    writeLine(output, result.status === "answered" ? result.answer : result.error);
  }
}

export async function handleResumeCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const explicitId = args[0];
  // D.13Q-UX Closure: ink 路径无参 → 打开 SessionsPanel picker；
  // 带参或 plain TUI → 仍走 resumeSessionWithHandoff structured handoff。
  if (!explicitId && (context as { isInkSession?: boolean }).isInkSession) {
    const sessions = await context.store.list();
    if (sessions.length === 0) {
      writeLine(output, "还没有可恢复会话。下一步：先正常对话，或用 /sessions 查看历史。");
      return;
    }
    const { buildSessionPanelEntries } = await import("./shell/models/session-panel.js");
    const entries = buildSessionPanelEntries(
      sessions.map((s) => ({
        id: s.id,
        updatedAt: s.updatedAt,
        summary: s.summary ?? undefined,
        messageCount:
          typeof (s as unknown as { messageCount?: number }).messageCount === "number"
            ? (s as unknown as { messageCount: number }).messageCount
            : 0,
      })),
      context.sessionId,
    );
    context.sessionsPanelState = { cursor: 0, entries };
    return;
  }
  const sessionId = explicitId ?? (await context.store.list())[0]?.id;
  if (!sessionId) {
    writeLine(output, "还没有可恢复会话。下一步：先正常对话，或用 /sessions 查看历史。");
    return;
  }
  await resumeSessionWithHandoff(sessionId, context, output, "resume");
}

export async function handleBranchCommand(
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
  writeLine(output, `已创建会话分支（session branch，不是 git 分支）：${branch.id}`);
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

configureMcpIndexRuntime({
  getCurrentFreshness,
  writeStatus,
  checkBackgroundStartGuard,
  ensureSession,
  rememberBackgroundTask,
  appendBackgroundTaskEvent,
  rememberEvidence,
});

configureWorkflowCommandRuntime({
  ensureSession,
  appendSystemEvent,
  appendBackgroundTaskEvent,
  recordVerificationEvidence,
  captureFailureLearning,
  rememberEvidence,
  handleSlashCommand,
  handleToolCommand,
  createSilentOutput,
});

configureRemoteCommandRuntime({
  appendSystemEvent,
  ensureSession,
  handleRemoteInboundMessage,
  startFeishuLongConnection,
});

configureMemoryCommandRuntime({
  appendSystemEvent,
  ensureSession,
  requestMemoryMutationApproval,
  refreshCacheFreshness,
  recordMemoryMutationEvidence,
  writeStatus,
});

configureFailureLearningCommandRuntime({
  appendSystemEvent,
  ensureSession,
  writeStatus,
});

configureExtensionSlashRuntime({
  appendSystemEvent,
  ensureSession,
  refreshCacheFreshness,
});

configureModelCommandRuntime({
  currentModelText: (context) => t(context, "currentModel"),
});

configureJobAgentCommandRuntime({
  addRoleUsage,
  appendBackgroundTaskEvent,
  appendRouteDecisionEvent,
  checkBackgroundStartGuard,
  checkResourceGuard,
  createRoleHandoff,
  ensureSession,
  refreshBackgroundLifecycle,
  writeStatus,
  captureFailureLearning,
  recordVerificationEvidence,
  createAgentGatewayContinuation: (context, agent) => {
    const runtime = getSelectedModelRuntime(context, agent.role);
    if (!context.modelGateway) return null;
    return {
      gateway: context.modelGateway,
      provider: runtime.provider,
      model: runtime.model,
      endpointProfile: runtime.endpointProfile,
      reasoningLevel: runtime.reasoningLevel,
      reasoningSent: runtime.reasoningSent,
    };
  },
  recordAgentExecutionEvidence,
  recordAgentMailboxEvidence,
  recordAgentToolEvidence,
  recordAgentToolFailureEvidence,
  recordToolResultBudgetEvidence,
  createAgentToolApproval: ({
    context,
    agent,
    toolCall,
    toolName,
    parentSessionId,
    permission,
    output,
  }) => {
    if (context.pendingLocalApproval) {
      writeLine(
        output,
        context.language === "en-US"
          ? `Agent ${agent.id} requested ${toolName}, but another local approval is already pending. Resolve the current approval first, then resume or resend.`
          : `agent ${agent.id} 请求 ${toolName}，但当前已有本地权限审批待处理。请先处理当前审批，再 resume 或重新发送。`,
      );
      return false;
    }
    context.pendingLocalApproval = {
      kind: "agent_tool_use",
      agentId: agent.id,
      agentTranscriptSessionId: agent.transcriptSessionId,
      toolCall,
      toolName,
      sessionId: parentSessionId,
      verdict: permission.verdict,
    };
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
    }
    return true;
  },
  prepareProviderPreflight: (context, sessionId, messages, runtime, trigger) =>
    prepareMessagesForProviderPreflight({
      messages,
      context,
      sessionId,
      runtime,
      trigger,
      deps: compactPreflightDeps,
    }),
});

export async function handleVerifyCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action === "last") {
    writeLine(output, formatVerificationLast(context.lastVerification, context.language));
    return;
  }

  let plan: Awaited<ReturnType<typeof createVerificationPlan>>;
  if (action === "typecheck") {
    const defaultPlan = await createVerificationPlan(context.projectPath, "default");
    plan = defaultPlan.filter((step) => step.kind === "typecheck");
    if (plan.length === 0) {
      plan = await createVerificationPlan(context.projectPath, "smoke");
    }
  } else if (action === "focused") {
    plan = await createVerificationPlan(context.projectPath, "focused");
  } else if (action === "real-smoke") {
    plan = await createVerificationPlan(context.projectPath, "real-smoke");
  } else {
    plan = await createVerificationPlan(
      context.projectPath,
      action === "smoke" ? "smoke" : "default",
    );
  }

  if (action === "plan" || action === "plan-only") {
    writeLine(output, formatVerificationPlan(plan, context.language));
    writeLine(
      output,
      context.language === "en-US"
        ? "Mode: plan-only. No command was run and no verification evidence was recorded."
        : "模式：plan-only。未执行命令，也不会记录验证 evidence。",
    );
    return;
  }
  if (
    action &&
    action !== "smoke" &&
    action !== "typecheck" &&
    action !== "focused" &&
    action !== "real-smoke"
  ) {
    writeLine(
      output,
      "用法：/verify | /verify plan-only | /verify plan | /verify last | /verify focused | /verify real-smoke | /verify smoke | /verify typecheck",
    );
    return;
  }
  if (action === "real-smoke" && plan.length === 0) {
    const sessionId = await ensureSession(context);
    const report = createVerificationUnavailableReport(
      "real-smoke",
      "package.json 未提供 smoke 脚本；synthetic smoke 不会升级为 real-smoke。",
    );
    context.lastVerification = report;
    await recordVerificationEvidence(context, sessionId, report);
    writeLine(output, formatVerificationTaskSummary(report, context.language));
    writeStatus(output, context);
    return;
  }

  const guard = checkBackgroundStartGuard(context, "verification", true);
  if (guard) {
    writeLine(output, guard);
    return;
  }

  const sessionId = await ensureSession(context);
  const report = await runVerificationPlan(
    plan,
    context,
    sessionId,
    output,
    appendBackgroundTaskEvent,
  );
  context.lastVerification = report;
  await recordVerificationEvidence(context, sessionId, report);
  writeLine(output, formatVerificationTaskSummary(report, context.language));
  writeStatus(output, context);
}

export async function handleReviewCommand(context: TuiContext, output: Writable): Promise<void> {
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

export async function handleVisionCommand(
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
    `VisionObservation: provider ${route.provider}, model ${route.primaryModel}, source ${sourcePath}`,
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
  writeLine(output, `- model route: ${route.provider}/${route.primaryModel}`);
  writeLine(output, `- source: ${sourcePath}`);
  writeLine(output, "- boundary: vision role 只写入 evidence，不执行 Bash、不改代码。");
}

export async function handleImageCommand(
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
  const outputDir = join(context.projectPath, ".linghun", "assets");
  const assetPath = join(outputDir, `${id}.json`);
  const approval: Extract<PendingLocalApproval, { kind: "image_generation" }> = {
    kind: "image_generation",
    sessionId,
    prompt,
    id,
    assetPath,
    provider: route.provider,
    model: route.primaryModel,
  };
  const permission = await decidePermission(
    "Write",
    {
      path: relative(context.projectPath, assetPath),
      content: "image generation metadata",
      reason: "explicit /image generate",
    },
    context,
    sessionId,
  );
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
    context.pendingLocalApproval = approval;
    if (!context.isInkSession) {
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
      writeStatus(output, context);
    }
    return;
  }
  if (permission.decision === "deny") {
    await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `image generate deny: ${permission.reason}`,
    );
    writeLine(output, formatPermissionDenied(permission.reason, permission.request.summary));
    writeStatus(output, context);
    return;
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  await executeImageGeneration(approval, context, output);
}

export async function executeImageGeneration(
  approval: Extract<PendingLocalApproval, { kind: "image_generation" }>,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const guard = checkBackgroundStartGuard(context, "agent");
  if (guard) {
    writeLine(output, guard);
    return;
  }
  const now = new Date().toISOString();
  await mkdir(dirname(approval.assetPath), { recursive: true });
  const result: ImageGenerationResult = {
    id: approval.id,
    provider: approval.provider,
    model: approval.model,
    images: [
      { path: approval.assetPath, mimeType: "application/json", revisedPrompt: approval.prompt },
    ],
    evidenceRefs: [],
    createdAt: now,
  };
  await writeFile(
    approval.assetPath,
    `${JSON.stringify(
      {
        kind: "image_generation_metadata",
        prompt: approval.prompt,
        provider: approval.provider,
        model: approval.model,
        note: "Image result metadata recorded; no size/quality/format was fixed unless user specified it.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const evidence = createEvidenceRecord(
    "image_result",
    `ImageGenerationResult ${approval.id}: provider ${approval.provider}, model ${approval.model}, asset ${approval.assetPath}`,
    approval.assetPath,
    ["image_result", "生图结果", "image generated"],
  );
  result.evidenceRefs.push(pickEvidence(evidence));
  context.imageResults.unshift(result);
  rememberEvidence(context, evidence);
  addRoleUsage(
    context,
    "image",
    {
      role: "image",
      provider: approval.provider,
      primaryModel: approval.model,
      fallbackModels: [],
      requiredCapabilities: ["image"],
      allowTools: false,
      allowWrite: false,
      allowBash: false,
      requireApprovalBeforeRun: false,
    },
    Math.ceil(approval.prompt.length / 4),
    0,
  );
  const task: BackgroundTaskState = {
    id: approval.id,
    kind: "agent",
    title: `Image generate: ${truncateDisplay(approval.prompt, 40)}`,
    status: "completed",
    currentStep: "image result metadata saved",
    progress: { completed: 1, total: 1, label: "image" },
    startedAt: now,
    updatedAt: now,
    lastOutputAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    outputPath: approval.assetPath,
    hasOutput: true,
    result: "pass",
    userVisibleSummary: `image 结果已落盘：${approval.assetPath}`,
    nextAction: "查看 evidence 或把资产路径交给 executor；image role 不改代码。",
  };
  rememberBackgroundTask(context, task);
  await context.store.appendEvent(approval.sessionId, { type: "evidence_record", ...evidence });
  await appendBackgroundTaskEvent(context, approval.sessionId, task);
  const displayPath = relative(context.projectPath, approval.assetPath);
  writeLine(output, `Image result saved: ${displayPath}`);
  writeLine(output, "- impact: metadata was recorded; no source image or code was changed.");
  writeLine(output, "- next: use the saved path when you want to inspect or reuse the result.");
}

export async function runVerificationCommandForTest(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): ReturnType<typeof runVerificationCommand> {
  return runVerificationCommand(command, cwd, signal, timeoutMs);
}

export async function recordAgentExecutionEvidence(
  context: TuiContext,
  sessionId: string,
  agent: AgentRun,
  result: { status: "completed" | "failed" | "blocked"; summary: string },
): Promise<string | undefined> {
  const evidence = createEvidenceRecord(
    "command_output",
    `agent_execution ${agent.type} ${result.status}: ${result.summary}`,
    `agent:${agent.id}`,
    result.status === "completed"
      ? ["agent_execution", `agent_${agent.type}`, "action_executed", "agent_terminal_status"]
      : ["tool_failure", "agent_execution", `agent_${agent.type}`],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  return evidence.id;
}

export async function recordAgentMailboxEvidence(
  context: TuiContext,
  sessionId: string,
  agent: AgentRun,
  messages: AgentMailboxMessage[],
): Promise<string | undefined> {
  if (messages.length === 0) return undefined;
  const evidence = createEvidenceRecord(
    "command_output",
    `agent_mailbox ${agent.id}: consumed ${messages.length} message(s): ${messages
      .map((message) => `${message.id}:${message.summary}`)
      .join("; ")}`,
    `agent:${agent.id}:mailbox`,
    ["agent_mailbox", `agent_${agent.type}`, "mailbox_consumed"],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  return evidence.id;
}

export async function recordAgentToolEvidence(
  context: TuiContext,
  sessionId: string,
  agent: AgentRun,
  toolName: ToolName,
  output: ToolOutput,
  input: unknown,
): Promise<string | undefined> {
  const evidence = await recordToolEvidence(context, sessionId, toolName, output, input);
  await appendSystemEvent(
    context,
    sessionId,
    `agent tool evidence: agent ${agent.id}; tool ${toolName}; evidence ${evidence?.id ?? "none"}`,
    "info",
  );
  return evidence?.id;
}

export async function recordAgentToolFailureEvidence(
  context: TuiContext,
  sessionId: string,
  agent: AgentRun,
  toolName: ToolName,
  summary: string,
): Promise<string | undefined> {
  const evidence = await recordToolFailureEvidence(
    context,
    sessionId,
    toolName,
    `agent ${agent.id}: ${summary}`,
  );
  await appendSystemEvent(
    context,
    sessionId,
    `agent tool failure: agent ${agent.id}; tool ${toolName}; evidence ${evidence.id}`,
    "warning",
  );
  return evidence.id;
}

export async function runIndexSafetyRepair(context: TuiContext, output: Writable): Promise<void> {
  const riskyFiles = context.index.safetyRiskyFiles ?? [];
  if (riskyFiles.length === 0 || !context.index.safetyWarning) {
    writeLine(
      output,
      context.language === "en-US"
        ? "No index skip suggestions can be persisted right now. Run index refresh first; if refresh automatically skipped large/generated files, run index repair to write the rules to ignore."
        : "当前没有可持久化的索引跳过建议。先运行索引刷新；如刷新时自动跳过了大文件/生成物，可再运行索引修复把规则写入 ignore。",
    );
    writeStatus(output, context);
    return;
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
      return;
    }
  } else {
    writeLine(
      output,
      context.language === "en-US"
        ? "Ignore write skipped: all risky files are already covered by the ignore file."
        : "ignore 写入跳过：风险文件已被 ignore 文件覆盖。",
    );
  }

  await runIndexRepository(context, context.config.index.mode, "refresh", false, output, {
    guardAlreadyChecked: true,
  });
  if (!context.index.safetyWarning) {
    writeLine(output, formatIndexRefreshSummary(context));
  }
  if (!context.isInkSession) writeStatus(output, context);
}

export async function requestIndexRefreshApproval(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await requestIndexActionApproval(args, context, output, {
    action: "refresh",
    idPrefix: "slash-index-refresh",
    reason: "explicit /index refresh slash command",
    autoReviewMessage:
      "slash_index_refresh_auto_review_allowed: ordinary workspace index write uses existing permission pipeline; dangerous shell/network/install/delete remain gated",
    denySummary: "index refresh deny",
  });
}

export async function requestIndexInitFastApproval(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await requestIndexActionApproval(args, context, output, {
    action: "init fast",
    idPrefix: "slash-index-init-fast",
    reason: "explicit /index init fast slash command",
    autoReviewMessage:
      "slash_index_init_fast_auto_review_allowed: ordinary workspace index write uses existing permission pipeline; dangerous shell/network/install/delete remain gated",
    denySummary: "index init fast deny",
  });
}

type IndexApprovalOptions = {
  action: "refresh" | "init fast";
  idPrefix: string;
  reason: string;
  autoReviewMessage: string;
  denySummary: string;
};

async function requestIndexActionApproval(
  args: string[],
  context: TuiContext,
  output: Writable,
  options: IndexApprovalOptions,
): Promise<void> {
  const sessionId = await ensureSession(context);
  const toolCall: ModelToolCall = {
    id: `${options.idPrefix}-${randomUUID().slice(0, 8)}`,
    name: INDEX_REFRESH,
    input: {
      force: args.includes("--force"),
      reason: options.reason,
    },
  };
  const permission = await decidePermission(
    "Write",
    { path: ".linghun/index" },
    context,
    sessionId,
  );
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: toolCall.id,
    name: toolCall.name,
    input: toolCall.input,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(sessionId, {
    type: "permission_request",
    request: { ...permission.request, toolName: INDEX_REFRESH as unknown as ToolName },
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(sessionId, {
    type: "permission_result",
    requestId: permission.request.id,
    decision: permission.decision,
    reason: permission.reason,
    createdAt: new Date().toISOString(),
  });

  if (context.permissionMode === "auto-review" && permission.decision === "ask") {
    await appendSystemEvent(context, sessionId, options.autoReviewMessage, "info");
    await executeApprovedIndexToolUse(
      toolCall,
      options.action,
      args.includes("--force"),
      context,
      sessionId,
      output,
    );
    if (!context.isInkSession) writeStatus(output, context);
    return;
  }
  if (permission.decision === "deny") {
    const evidence = await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `${options.denySummary}: ${permission.reason}`,
    );
    await appendToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      "Write",
      `deny: ${permission.reason}`,
      true,
      evidence.id,
    );
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
      writeStatus(output, context);
    }
    return;
  }
  if (permission.decision === "ask") {
    context.pendingLocalApproval = {
      kind: "index_tool",
      indexAction: options.action,
      toolCall,
      sessionId,
      force: args.includes("--force"),
    };
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
      writeStatus(output, context);
    }
    return;
  }

  await executeApprovedIndexToolUse(
    toolCall,
    options.action,
    args.includes("--force"),
    context,
    sessionId,
    output,
  );
  if (!context.isInkSession) writeStatus(output, context);
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
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error;
    }
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

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

function hashFileContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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
    // P0-1 — ink 主屏走 PermissionPanel（index_ignore_write 已被
    // mapPendingApprovalToPermission 映射）；plain TUI / 非交互保留文本 yes/no。
    if (!context.isInkSession) {
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
    }
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

export async function executeIndexIgnoreWritePlan(
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
    const evidence = await recordToolEvidence(context, sessionId, "Write", result.output, input);
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
    writeErrorLine(
      output,
      context.language === "en-US"
        ? `${text}\nNext: fix the ignore file path or permissions, then retry the natural request.`
        : `${text}\n下一步：修复 ignore 文件路径或权限后，重试这条自然语言请求。`,
      context.language === "en-US" ? "ignore write failed" : "ignore 写入失败",
    );
    return false;
  }
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

export function addRoleUsage(
  context: TuiContext,
  role: ModelRole,
  route: RoleModelRoute,
  inputTokens: number,
  outputTokens: number,
  contributionSummary = "role contribution recorded",
  cacheTokens: { cacheReadTokens?: number; cacheWriteTokens?: number } = {},
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
  const estimatedCny = calculateEstimatedCny(route.primaryModel, inputTokens, outputTokens);
  const cacheReadTokens = cacheTokens.cacheReadTokens ?? 0;
  const cacheWriteTokens = cacheTokens.cacheWriteTokens ?? 0;
  if (existing) {
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.cacheReadTokens += cacheReadTokens;
    existing.cacheWriteTokens += cacheWriteTokens;
    existing.estimatedCny = sumEstimatedCny(existing.estimatedCny, estimatedCny);
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
    cacheReadTokens,
    cacheWriteTokens,
    estimatedCny,
    createdAt: new Date().toISOString(),
    fallbackUsed: Boolean(latestDecision?.fallbackUsed),
    budgetStop: Boolean(latestDecision?.budgetStop),
    contributionSummary,
  });
}

function sumEstimatedCny(current: number, increment: number): number {
  if (!Number.isFinite(increment)) return current;
  if (!Number.isFinite(current)) return increment;
  return current + increment;
}
