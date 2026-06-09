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
  registerHooks as registerProviderHooks,
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
  appendBreakCacheEvent,
  buildPromptCacheRequestFields,
  clearBreakCacheMarker,
  formatBreakCacheStatus,
  writeBreakCacheMarker,
} from "./break-cache-runtime.js";
import { classifyBtwIntent, runBtwSideQuestion } from "./btw-runtime.js";
import { handleCapabilitiesCommand } from "./capability-runtime.js";
import { handleAppsCommand } from "./connector-runtime.js";
// D.14A-2 — break-cache runtime moved to ./break-cache-runtime.ts.
// Re-export the test hooks to preserve model-doctor-runtime.test.ts imports from "./index.js".
export { type BreakCacheTestHooks, breakCacheTestHooks } from "./break-cache-runtime.js";
import {
  createCacheFreshness,
  createConfigFreshnessSummary,
  diffFreshness,
  stableHash,
  stableStringify,
} from "./cache-freshness.js";
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
  checkClaimSupport,
  createHandoffPendingItems,
  createHandoffRiskItems,
  createPhase15BetaVerdictScope,
  formatClaimCheck,
  runArchitectureAndCompletenessFinalGate,
} from "./final-answer-gate.js";
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
  evaluateMetaScheduler,
  formatMetaSchedulerDirective,
  verifyFailureLearningContract,
} from "./meta-scheduler-runtime.js";
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
  type NaturalIntent,
  type PendingNaturalCommand,
  type SLASH_COMMAND_REGISTRY,
  buildRuntimeStatusForModel,
  createModelCapabilitySummary,
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
import { classifyToolRequest } from "./permission-policy-engine.js";
import {
  formatLocalToolPermissionPrompt,
  formatModelToolPermissionPrompt,
} from "./permission-presenter.js";
import {
  checkAndWriteProviderCooldown,
  recordProviderFallbackAttempt,
  resolveRuntimeFallback,
} from "./provider-loop-runtime.js";
import {
  createRuntimeStatusSnapshot,
  formatRuntimeStatusSnapshotForBtw,
} from "./runtime-status-snapshot.js";
// D.14A — deferred tools catalog moved to ./deferred-tools-catalog.ts.
// Re-export to preserve existing external / test imports from "./index.js".
export {
  type DeferredToolDescriptor,
  type DeferredToolDiscoverySnapshot,
  type DeferredToolKind,
  type DiscoveredDeferredToolsSummary,
  deferredToolListHashInput,
  findDeferredTool,
  formatDeferredToolsSystemReminder,
  getCodebaseMemoryToolRisk,
  isLocalStdioMcpServer,
  listDeferredTools,
  parseMcpDeferredToolName,
  sanitizeDiscoveredDeferredToolName,
  searchDeferredTools,
  snapshotDeferredTools,
  snapshotDeferredToolsSummary,
  snapshotDiscoveredDeferredToolsSummary,
  validateCodebaseMemoryToolExecution,
} from "./deferred-tools-catalog.js";
import {
  isPotentiallyMutatingMcpTool,
  runMcpStdioToolCall,
  runMcpStdioToolList,
} from "./mcp-stdio-runtime.js";
import { redactedPath, runCommandCapture } from "./process-command-runtime.js";
import {
  createProcessGuard,
  installProcessGuardExitHandlers,
  requestTrackedProcessStop,
} from "./process-guard.js";
export { isPotentiallyMutatingMcpTool } from "./mcp-stdio-runtime.js";
import { startFeishuLongConnection } from "./feishu-long-connection-runtime.js";
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
export {
  createRemoteEvent,
  consumeRemoteInboundMessage,
  processRemoteApprovalForTest,
  processRemoteInbound,
  sendRemoteEventReal,
  validateRemoteInboundEnvelope,
  validateRemotePairingEnvelope,
} from "./remote-command-runtime.js";
export {
  createRemotePairing,
  createSignedRemoteInboundFixture,
  decideRemoteInbox,
  dingtalkBridgeAdapter,
  dingtalkStreamFrameToBridgeEvent,
  feishuBridgeAdapter,
  feishuReceiveMessageToBridgeEvent,
  formatRemoteBridgeDoctor,
  getRemoteBridgeDoctor,
  processRemoteBindCommand,
  wecomBridgeAdapter,
} from "./remote-inbound-bridge-runtime.js";
export {
  startFeishuLongConnection,
  type FeishuLongConnectionHandle,
  type FeishuLongConnectionOptions,
} from "./feishu-long-connection-runtime.js";
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
import { loadProjectKeybindings } from "./keybinding-runtime.js";
import {
  configureModelCommandRuntime,
  handleModelCommand,
  handleModelRouteCommand,
  handleModelSetupInput,
  startModelSetup,
} from "./model-command-runtime.js";
import {
  formatPendingApprovalDetails,
  formatPendingNaturalCommandDetails,
  formatWorkspaceTrustStatus,
} from "./pending-details-presenter.js";
import { buildPromptCommandUserText, findPromptCommand } from "./prompt-command-runtime.js";
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
import { writeTextToClipboard } from "./shell/clipboard.js";
import {
  createCommandBlock,
  createUserTextBlock,
} from "./shell/models/command-transcript-presenter.js";
import { reduceTranscriptScroll } from "./shell/models/transcript-scroll-state.js";
import {
  buildTranscriptScreenBuffer,
  isSelectionStale,
  reduceTranscriptSelection,
} from "./shell/models/transcript-selection-state.js";
import { computeHomePromptPrefix, writePlainShell } from "./shell/plain-renderer.js";
import {
  getBackgroundOverlaySelectedTask,
  updateBackgroundOverlayCursor,
} from "./shell/progress-views.js";
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
export {
  LINGHUN_BASH_MAX_OUTPUT_DEFAULT,
  LINGHUN_BASH_MAX_OUTPUT_UPPER_LIMIT,
  LINGHUN_BYTES_PER_TOKEN,
  LINGHUN_DEFAULT_TOOL_RESULT_CHARS,
  LINGHUN_MAX_AGENTIC_TURNS,
  LINGHUN_MAX_AGENT_CHILD_TOOL_ROUNDS,
  LINGHUN_MAX_AGENT_CHILD_TURNS,
  LINGHUN_MAX_EVIDENCE_TOOL_ROUNDS,
  LINGHUN_MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES,
  LINGHUN_MAX_TODO_ONLY_CONSECUTIVE_ROUNDS,
  LINGHUN_MAX_TOOL_RESULT_BYTES,
  LINGHUN_MAX_TOOL_RESULT_TOKENS,
  LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  LINGHUN_TASK_MAX_OUTPUT_DEFAULT,
  LINGHUN_TASK_MAX_OUTPUT_UPPER_LIMIT,
} from "./runtime-budget.js";
import { type MessageKey, messages } from "./tui-messages.js";
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
import { CHAT_COMPLETIONS_ENDPOINT, formatStats, formatUsage } from "./usage-stats-presenter.js";
import {
  type WorkspaceReferenceCache,
  createWorkspaceReferenceCache,
  getWorkspaceReferenceSnapshot,
  isFallbackWorkspaceReferenceSnapshot,
  workspaceReferenceHash,
} from "./workspace-reference-cache.js";
export { validateExtensionContributionExecution } from "./extension-command-runtime.js";
import { createModelSystemPrompt, sanitizeMainScreenLeakage } from "./model-prompt-runtime.js";
import {
  createReviewReport,
  createVerificationPlan,
  formatVerificationLast,
  formatVerificationPlan,
  formatVerificationReport,
  runVerificationCommand,
  runVerificationPlan,
} from "./verification-command-runtime.js";
export { createModelSystemPrompt, sanitizeMainScreenLeakage } from "./model-prompt-runtime.js";
import {
  buildExplicitDetailsCommandPanel,
  getCommandPanelSelectableRows,
  showCommandPanel,
} from "./command-panel-runtime.js";
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
export { executeExtraTool, executeSearchExtraTools } from "./mcp-index-runtime.js";
export {
  findBundledCodebaseMemoryBinary,
  getBundledCodebaseMemoryRoots,
  getCodebaseMemoryPlatformArch,
} from "./mcp-index-runtime.js";
import {
  buildCacheStatusPanel,
  formatCacheLog,
  formatCacheStatus,
  formatCompactStatus,
  writeLightHints,
} from "./cache-command-runtime.js";
export { writeLightHintsForTest } from "./cache-command-runtime.js";
import {
  type MemoryMutation,
  configureMemoryCommandRuntime,
  executeMemoryMutation,
  handleMemoryCommand,
  resumeSessionWithHandoff,
  runAutoLearningOnTurnEnd,
} from "./memory-command-runtime.js";
import {
  createTerminalReadinessView,
  createVerificationLevelForReadiness,
} from "./terminal-readiness-runtime.js";
export { runAutoLearningOnTurnEnd } from "./memory-command-runtime.js";
import {
  configureFailureLearningCommandRuntime,
  handleFailuresCommand,
} from "./failure-learning-command-runtime.js";
import {
  type FailureLearningInput,
  buildFailureLearningSummaryForPrompt,
  createFailureLearningState,
  loadFailureRecords,
  mergeFailureRecord,
  recordFailureLearningDegradedWarning,
  writeFailureRecord,
} from "./failure-learning-runtime.js";
export { createFailureLearningState } from "./failure-learning-runtime.js";
import {
  createHandoffPacket,
  formatResumePacket,
  hydrateResumeContext,
  isHandoffPacket,
  loadOrCreateHandoffPacket,
  validateHandoffPacket,
  writeHandoffPacket,
} from "./handoff-session-runtime.js";

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
import { classifyVerificationLevel } from "./verification-level.js";

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

import {
  __testStopCommandPanelSelection,
  __testStopSingleBackgroundTask,
  __testToggleCommandPanelSelection,
  __testUpdateCommandPanelSelection,
  handleInterruptCommand,
  interruptAllActiveWork,
  refreshBackgroundLifecycle,
  stopCommandPanelSelection,
  toggleCommandPanelSelection,
  updateCommandPanelSelection,
} from "./background-control-runtime.js";
import {
  handleBreakCacheCommand,
  handleCacheCommand,
  handleCacheLogCommand,
  handleClaimCheckCommand,
  handleCompactCommand,
  recordModelUsage,
} from "./compact-cache-command-runtime.js";
import {
  __testBuildExplicitDetailsCommandPanel,
  __testCreateShellBlockOutput,
  __testCreateVerificationLevelForReadiness,
  buildStatusPanel,
  createSessionEndEvent,
  ensureSession,
  formatHomeScreen,
  formatShellBackgroundSummaries,
  handleDetailsCommand,
  t,
  writeStatus,
} from "./details-status-runtime.js";
import { appendSystemEvent } from "./evidence-runtime.js";
import {
  __testSendMessage,
  handleNaturalInput,
  handleRemoteInboundMessage,
  sendMessage,
} from "./model-stream-runtime.js";
import {
  __testFormatStartAgentDidNotStartMessage,
  __testParseRunWorkflowToolInput,
  handleToolCommand,
} from "./model-tool-runtime.js";
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
  __testRenderInteractiveChoiceLines,
  configureSlashCommandRuntime,
  getWorkspaceTrustCommandGuard,
  gitSlashDeps,
  handleAutopilotCommand,
  handleBranchCommand,
  handleBtwCommand,
  handleDoctorCommand,
  handleImageCommand,
  handleLanguageCommand,
  handleResumeCommand,
  handleReviewCommand,
  handleRewindCommand,
  handleTrustCommand,
  handleVerifyCommand,
  handleVisionCommand,
  promptInitialLanguage,
  promptInitialWorkspaceTrust,
  requestIndexInitFastApproval,
  requestIndexRefreshApproval,
  runCommandCaptureForTest,
  runIndexSafetyRepair,
  shouldPromptForInitialLanguage,
  shouldPromptForInitialWorkspaceTrust,
  writeWorkspaceTrustStartupNotice,
} from "./slash-command-runtime.js";
// Module 1 (D.13L mechanical split) — pure type declarations live in
// ./tui-data-types.js. Imported for in-file usage (TuiContext + state factories
// + helpers all reference them) and re-exported so downstream consumers that
// rely on `import type { ... } from "../index.js"` keep compiling unchanged.
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
  type WorkflowBridgeRequestProposal,
  type WorkflowMainChainRequest,
  bridgeWorkflowPlanToMainChainRequests,
  decideWorkflowStepCapability,
} from "./workflow-agent-runtime-bridge.js";
import type { NormalizedWorkflowPlan } from "./workflow-plan-schema.js";
import type { WorkflowPlannerEntryResult } from "./workflow-planner-entry.js";
export {
  __testBuildExplicitDetailsCommandPanel,
  __testCreateShellBlockOutput,
  __testCreateVerificationLevelForReadiness,
} from "./details-status-runtime.js";
export {
  __testFormatStartAgentDidNotStartMessage,
  __testParseRunWorkflowToolInput,
} from "./model-tool-runtime.js";
export {
  handleBreakCacheCommand,
  handleCacheCommand,
  handleCacheLogCommand,
  handleClaimCheckCommand,
  handleCompactCommand,
  recordModelUsage,
} from "./compact-cache-command-runtime.js";
export {
  __testStopCommandPanelSelection,
  __testStopSingleBackgroundTask,
  __testToggleCommandPanelSelection,
  __testUpdateCommandPanelSelection,
  interruptAllActiveWork,
} from "./background-control-runtime.js";
export { addAllowRuleForTest, handleTuiKeypress } from "./permission-approval-runtime.js";
export {
  __testSendMessage,
  handleNaturalInput,
  handleRemoteInboundMessage,
} from "./model-stream-runtime.js";
export {
  __testRenderInteractiveChoiceLines,
  runCommandCaptureForTest,
  runVerificationCommandForTest,
} from "./slash-command-runtime.js";
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
export {
  __testGetCurrentWorkflowStepRequest,
  __testRunWorkflowStepsWithPlan,
  __testWorkflowStepStatusFromNestedJob,
} from "./workflow-command-runtime.js";
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
  WorkflowStepState,
  WorkflowState,
  WorkflowTemplate,
} from "./tui-data-types.js";

export type {
  ModelSetupStep,
  PendingModelSetup,
  ModelSetupPrefill,
  ModelSetupMessageKey,
} from "./model-setup-runtime.js";

export {
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
  USER_VISIBLE_DISPATCH_SLASH_COMMANDS,
  VERIFICATION_COMMAND_TIMEOUT_MS,
  WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT,
  createSingleToolCallContinuation,
  runtimeFromContinuation,
} from "./tui-context-runtime.js";
export type {
  BreakCacheMutationAction,
  PendingAutopilotRequest,
  PendingLocalApproval,
  PendingModelContinuation,
  TuiContext,
} from "./tui-context-runtime.js";
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
  stableId,
  summarizeProjectRules,
} from "./tui-state-runtime.js";

import { getDurableJobPaths } from "./tui-agent-job-runtime.js";
import { containsSecret } from "./tui-memory-runtime.js";
import {
  createModelGateway,
  getSelectedModelRuntime,
  getStartupProjectRouteProblem,
  hasSelectedProviderConfigProblem,
  resolveInitialModel,
  shouldOfferUserScopedModelSetup,
} from "./tui-model-runtime.js";
import { addAllowRule, decidePermission, loadPermissionState } from "./tui-permission-runtime.js";
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
export { createModelGateway } from "./tui-model-runtime.js";
export { decidePermission } from "./tui-permission-runtime.js";
export { getDurableJobPaths } from "./tui-agent-job-runtime.js";
export { containsSecret } from "./tui-memory-runtime.js";

async function createAgentRegistryState(projectPath: string): Promise<TuiContext["agentRegistry"]> {
  const result = await loadAgentRegistry(projectPath);
  return { agents: result.items, errors: result.errors };
}

async function createWorkflowRegistryState(
  projectPath: string,
): Promise<TuiContext["workflowRegistry"]> {
  const result = await loadWorkflowRegistry(projectPath);
  return { workflows: result.items, errors: result.errors };
}

function mergeWorkflowTemplates(...groups: WorkflowTemplate[][]): WorkflowTemplate[] {
  const byId = new Map<string, WorkflowTemplate>();
  for (const group of groups) {
    for (const template of group) {
      byId.set(template.id, template);
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function isCtrlOExpandableBlock(block: ProductBlockViewModel): boolean {
  const fullText = (block.fullText ?? "").trim();
  const summary = (block.summary ?? "").trim();
  if (!fullText) return false;
  if (!summary) return fullText.length > 0;
  const nonEmptyLines = fullText.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
  return nonEmptyLines >= 2 || fullText.length > summary.length + 16;
}

function findLatestCtrlOExpandableBlock(
  blocks: ProductBlockViewModel[],
): ProductBlockViewModel | undefined {
  return [...blocks].reverse().find(isCtrlOExpandableBlock);
}

function toggleCurrentCommandPanelDetails(context: TuiContext): boolean {
  const panel = context.commandPanelState;
  if (!panel) return false;
  const selectableRows = (panel.sections ?? [])
    .flatMap((section) => section.rows)
    .filter((row): row is Exclude<typeof row, string> => typeof row !== "string");
  const cursor = Math.max(0, Math.min(panel.cursor ?? 0, selectableRows.length - 1));
  const selectedDetails = selectableRows[cursor]?.detailsText?.trim();
  const panelDetails = panel.detailsText?.trim();
  if (!selectedDetails && !panelDetails) return false;
  context.commandPanelState = { ...panel, expanded: !panel.expanded };
  context.ctrlOExpandState = { active: false };
  return true;
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
    cache: createCacheState(projectPath, initialModel, [], config),
    mcp: createMcpState(config),
    index: createIndexState(config),
    memory: await createMemoryState(config, projectPath),
    keybindings: await loadProjectKeybindings(projectPath),
    failureLearning: createFailureLearningState(projectPath, config),
    skills: await createSkillState(config, projectPath),
    workflows: createWorkflowState(config),
    agentRegistry: await createAgentRegistryState(projectPath),
    workflowRegistry: await createWorkflowRegistryState(projectPath),
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
    lastProviderFallbackAttempt: undefined,
    providerBreaker: createProviderCircuitBreakerState(),
    solutionCompleteness: createSolutionCompletenessStatus(),
    backgroundAbortControllers: new Map(),
    discoveredDeferredToolNames: new Set<string>(),
  };
  context.workflows.templates = mergeWorkflowTemplates(
    context.workflows.templates,
    context.agentRegistry.agents.map(registryAgentToWorkflowTemplate),
    context.workflowRegistry.workflows.map(registryWorkflowToTemplate),
  );
  installProcessGuardExitHandlers();
  const startup = await prepareTuiStartup(input, output, context);
  await refreshIndexStatus(context);
  await hydrateDurableJobBackgroundTasks(context);
  await hydratePersistentAgents(context);
  context.failureLearning.records = await loadFailureRecords(context.failureLearning);
  const gateway = createModelGateway(context.config);
  // D.14D — 把 gateway 挂到 context，让 /btw side-question runtime 能发起隔离单轮请求。
  context.modelGateway = gateway;
  // R6 — Register provider retry hook so the TUI can show retry activity.
  registerProviderHooks({
    onRetry: (info) => {
      context.requestActivityPhase = "provider_retrying";
      context.requestActivityToolName = undefined;
      (context as { retryInfo?: { attempt: number; max: number; delaySec: number } }).retryInfo = {
        attempt: info.attempt,
        max: info.maxAttempts,
        delaySec: Math.ceil(info.delayMs / 1000),
      };
    },
  });
  // R6 — Initialize notification callback on context for circuit breaker and other runtimes.
  context.pushNotification = (text, tone) => pushTransientNotification(context, text, tone);
  const sigintHandler = () => {
    requestTrackedProcessStop(false);
    void handleInterruptCommand([], context, output).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      writeLine(output, `Interrupt failed: ${message}`);
    });
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

function pushTransientNotification(
  context: TuiContext,
  text: string,
  tone: "default" | "dim" | "warning" | "error" | "success" = "default",
): void {
  if (!context.notifications) context.notifications = [];
  context.notifications.push({
    key: `transient:${Date.now()}:${context.notifications.length}`,
    text: truncateDisplay(text, 160),
    priority: tone === "error" || tone === "warning" ? "immediate" : "medium",
    timeoutMs: 5000,
    createdAt: Date.now(),
    tone,
  });
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
        backgroundSummaries: formatShellBackgroundSummaries(context),
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

function isSameTranscriptScrollState(
  previous: TuiContext["transcriptScrollState"],
  next: TuiContext["transcriptScrollState"],
): boolean {
  return (
    previous?.scrollOffset === next?.scrollOffset &&
    previous?.stickToBottom === next?.stickToBottom &&
    previous?.hasOverflow === next?.hasOverflow &&
    previous?.viewportHeight === next?.viewportHeight &&
    previous?.contentHeight === next?.contentHeight &&
    previous?.wheelStep === next?.wheelStep
  );
}

function isSameTranscriptViewportGeometry(
  previous: TuiContext["transcriptViewportGeometry"],
  next: TuiContext["transcriptViewportGeometry"],
): boolean {
  return (
    previous?.x === next?.x &&
    previous?.y === next?.y &&
    previous?.width === next?.width &&
    previous?.height === next?.height &&
    previous?.contentHeight === next?.contentHeight &&
    previous?.topOffset === next?.topOffset
  );
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
  // D.13Q-UX Closure: 标记 ink session，让 /btw / /sessions / /resume 等
  // handler 选择 panel 路径（而不是 plain TUI 的 writeLine fallback）。
  context.isInkSession = true;

  const blocks: ProductBlockViewModel[] = [];
  let shell: ReturnType<typeof renderInkShell> | undefined;
  let submittedPending = false;
  let submittedPendingStartedAt: number | undefined;
  let activityTicker: ReturnType<typeof setInterval> | undefined;
  // D.13E Step 2 — command transcript 行序号；createCommandBlock 用 sequence 生成稳定 id。
  let commandSequence = 0;
  let resolveExit: (code: number) => void = () => undefined;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const shellOutput = new ShellBlockOutput(context, blocks, () => shell?.rerender());
  context.compactOutputMemory = () => shellOutput.compactOutputMemory();
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
        submittedStartedAt: submittedPendingStartedAt,
        reasoningLevel: runtime.reasoningLevel,
        reasoningSent: runtime.reasoningSent,
        // D.13Q-UX Task Surface — controller 持有的 configPanelState 必须显式
        // 喂给 view-model；旧实现遗漏这一行，导致 /config submit 后 ConfigPanel
        // 永远不会出现在 ShellViewModel.configPanel 上。
        configPanelState: context.configPanelState,
        backgroundSummaries: formatShellBackgroundSummaries(context),
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
        if (context.transcriptSelectionState) {
          context.transcriptSelectionState = undefined;
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          return;
        }
        if (context.ctrlOExpandState?.active) {
          context.ctrlOExpandState = { active: false };
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          return;
        }
        if (
          context.commandPanelState ||
          context.helpPanelState ||
          context.configPanelState ||
          context.btwPanelState ||
          context.sessionsPanelState ||
          context.backgroundOverlayState?.open
        ) {
          if (context.btwPanelState?.phase === "loading" && context.activeBtwAbortController) {
            context.activeBtwAbortController.abort();
            context.activeBtwAbortController = undefined;
          }
          context.commandPanelState = undefined;
          context.helpPanelState = undefined;
          context.configPanelState = undefined;
          context.btwPanelState = undefined;
          context.sessionsPanelState = undefined;
          context.backgroundOverlayState = undefined;
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          return;
        }
        await handleTuiKeypress("escape", context, shellOutput);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "interrupt") {
        submittedPending = false;
        await handleInterruptCommand([], context, shellOutput);
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
        const previousMode = context.permissionMode;
        context.permissionMode = nextMode;
        context.planAccepted = false;
        try {
          const sessionId = await ensureSession(context);
          await appendSystemEvent(
            context,
            sessionId,
            `permission mode change: ${previousMode} -> ${nextMode}; reason ink shift-tab quiet cycle; boundary Start Gate and permission pipeline remain active`,
            "info",
          );
        } catch (error) {
          process.stderr.write(
            `[linghun] permission_mode_system_event_failed reason=${formatError(error, context.language).replace(/\s+/g, " ")}\n`,
          );
        }
        const continued = await reevaluatePendingLocalApprovalAfterModeChange(
          context,
          gateway,
          shellOutput,
        );
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        if (continued) {
          writeStatus(shellOutput, context);
        }
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
      // ─── D.13Q-UX Ctrl+O — toggle-details ───────────────────────────────────
      // Composer 的 Ctrl+O 派发本事件（不再 submit "/details"），用户输入区不会
      // 出现 /details，transcript 命令行也不会多出一条 ❯ /details。/details slash
      // 仍保留为兼容命令（显式诊断走原 handleDetailsCommand 链路）。
      //
      // Ctrl+O 优先展开当前 command/background/session 面板详情；没有面板详情时，
      // 再展开最近一个可折叠 output block。没有真实可展开对象时保持安静。
      if (event.type === "toggle-details") {
        submittedPending = false;
        if (toggleCurrentCommandPanelDetails(context)) {
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          return;
        }
        const expandableBlock = findLatestCtrlOExpandableBlock(blocks);
        if (expandableBlock) {
          const isSameBlockExpanded =
            context.ctrlOExpandState?.active &&
            (!context.ctrlOExpandState.blockId ||
              context.ctrlOExpandState.blockId === expandableBlock.id);
          context.ctrlOExpandState = isSameBlockExpanded
            ? { active: false }
            : { active: true, blockId: expandableBlock.id };
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          return;
        }
        context.ctrlOExpandState = { active: false };
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      // ─── D.13Q-UX Task Surface — CommandPanel 关闭 ──────────────────────────
      if (event.type === "command-panel-close") {
        context.commandPanelState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "command-panel-move") {
        updateCommandPanelSelection(context, event.delta);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "command-panel-toggle") {
        toggleCommandPanelSelection(context);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "command-panel-stop") {
        await stopCommandPanelSelection(context, output);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "background-overlay-open") {
        context.backgroundOverlayState = { open: true, cursor: context.backgroundOverlayState?.cursor ?? 0 };
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "background-overlay-close") {
        context.backgroundOverlayState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "background-overlay-move") {
        updateBackgroundOverlayCursor(context, event.delta);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "background-overlay-toggle") {
        const selected = getBackgroundOverlaySelectedTask(context);
        context.commandPanelState = selected
          ? {
              title: "/background",
              summary: [selected.userVisibleSummary],
              detailsText: selected.nextAction ?? selected.userVisibleSummary,
            }
          : undefined;
        context.backgroundOverlayState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "background-overlay-stop") {
        const selected = getBackgroundOverlaySelectedTask(context);
        if (selected) {
          context.commandPanelState = {
            title: "/background",
            sections: [
              {
                rows: [
                  {
                    text: selected.title,
                    taskRef: {
                      id: selected.id,
                      kind: selected.kind === "agent" ? "agent" : selected.kind === "job" ? "job" : "background",
                    },
                    detailsText: selected.nextAction ?? selected.userVisibleSummary,
                  },
                ],
              },
            ],
            cursor: 0,
          };
          await stopCommandPanelSelection(context, output);
          context.commandPanelState = undefined;
        }
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "copy-selection") {
        const sel = context.transcriptSelectionState;
        const text = sel?.selectedText ?? sel?.copiedText;
        if (text) {
          const copy = await writeTextToClipboard(text, { stdout: output as NodeJS.WriteStream });
          if (!copy.ok && copy.error) {
            pushTransientNotification(context, `Copy failed: ${copy.error}`, "warning");
          } else if (copy.ok) {
            const lineCount = Math.max(1, text.split("\n").length);
            const message = context.language === "en-US"
              ? `Copied ${lineCount} line${lineCount === 1 ? "" : "s"}`
              : `已复制 ${lineCount} 行`;
            pushTransientNotification(context, message, "success");
          }
        }
        shell?.rerender();
        return;
      }
      // ─── Main transcript scroll ─────────────────────────────────────────────
      if (event.type === "transcript-scroll") {
        const previous = context.transcriptScrollState;
        const next =
          "action" in event
            ? reduceTranscriptScroll(context.transcriptScrollState, {
                type: "scroll",
                action: event.action,
              })
            : reduceTranscriptScroll(context.transcriptScrollState, {
                type: "scroll",
                delta: event.delta,
              });
        if (!isSameTranscriptScrollState(previous, next)) {
          context.transcriptScrollState = next;
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
        }
        return;
      }
      if (event.type === "transcript-scroll-measure") {
        const previous = context.transcriptScrollState;
        const next = reduceTranscriptScroll(context.transcriptScrollState, {
          type: "measure",
          viewportHeight: event.viewportHeight,
          contentHeight: event.contentHeight,
        });
        if (!isSameTranscriptScrollState(previous, next)) {
          context.transcriptScrollState = next;
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
        }
        return;
      }
      if (event.type === "transcript-block-measure") {
        context.transcriptBlockHeightCache ??= {};
        const existing = context.transcriptBlockHeightCache[event.id];
        const next = {
          height: event.height,
          width: event.width,
          textHash: existing?.textHash ?? "measured",
        };
        if (
          !existing ||
          existing.height !== next.height ||
          existing.width !== next.width ||
          existing.textHash !== next.textHash
        ) {
          context.transcriptBlockHeightCache[event.id] = next;
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
        }
        return;
      }
      if (event.type === "transcript-viewport-geometry") {
        if (!isSameTranscriptViewportGeometry(context.transcriptViewportGeometry, event.geometry)) {
          context.transcriptViewportGeometry = event.geometry;
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
        }
        return;
      }
      if (event.type === "transcript-mouse") {
        if (isSelectionStale(context.transcriptSelectionState, Date.now())) {
          context.transcriptSelectionState = undefined;
        }
        const currentView = controller.getViewModel();
        const rows = buildTranscriptScreenBuffer(
          currentView.blocks,
          Math.max(8, currentView.width - 4),
        ).rows;
        const result = reduceTranscriptSelection({
          state: context.transcriptSelectionState,
          event: event.event,
          rows,
          geometry: context.transcriptViewportGeometry,
          scroll: context.transcriptScrollState,
        });
        if (!result.consumed) return;
        context.transcriptSelectionState = result.state;
        if (result.scrollDelta) {
          context.transcriptScrollState = reduceTranscriptScroll(context.transcriptScrollState, {
            type: "scroll",
            delta: result.scrollDelta,
          });
        }
        if (result.copyText) {
          const copy = await writeTextToClipboard(result.copyText, {
            stdout: output as NodeJS.WriteStream,
          });
          if (!copy.ok && copy.error) {
            pushTransientNotification(context, `Copy failed: ${copy.error}`, "warning");
          } else if (copy.ok) {
            const lineCount = Math.max(1, result.copyText.split("\n").length);
            const message =
              context.language === "en-US"
                ? `Copied ${lineCount} line${lineCount === 1 ? "" : "s"}`
                : `已复制 ${lineCount} 行`;
            pushTransientNotification(context, message, "success");
          }
        }
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "transcript-scroll-end") {
        context.transcriptScrollState = reduceTranscriptScroll(context.transcriptScrollState, {
          type: "end",
        });
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "transcript-scroll-top") {
        context.transcriptScrollState = reduceTranscriptScroll(context.transcriptScrollState, {
          type: "top",
        });
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
      // ─── D.13Q-UX Closure — /help 拦截：ink 模式打开真 HelpPanel ──────────────
      // plain TUI 仍走 formatCatalogHelp 文本表 fallback；ink 模式不 writeLine，
      // 直接打开 panel。/help advanced / /help details 进入对应分组。
      if (event.type === "submit") {
        const trimmed = event.text.trim();
        if (trimmed === "/help" || trimmed === "/help advanced" || trimmed === "/help details") {
          const group: "core" | "advanced" | "details" =
            trimmed === "/help advanced"
              ? "advanced"
              : trimmed === "/help details"
                ? "details"
                : "core";
          blocks.push(createCommandBlock(commandSequence++, trimmed));
          context.helpPanelState = { group, cursor: 0 };
          submittedPending = false;
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          return;
        }
      }
      if (event.type === "help-open") {
        context.helpPanelState = { group: event.group ?? "core", cursor: 0 };
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "help-close") {
        context.helpPanelState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "help-move") {
        if (!context.helpPanelState) return;
        const { buildHelpPanelData: build } = await import("./shell/models/help-panel.js");
        const entries = build(context.helpPanelState.group, 0, context.language).entries;
        const total = entries.length;
        if (total === 0) return;
        const next = (context.helpPanelState.cursor + event.delta + total) % total;
        context.helpPanelState = { ...context.helpPanelState, cursor: next };
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "help-switch-group") {
        if (!context.helpPanelState) return;
        const groups: ("core" | "advanced" | "details")[] = ["core", "advanced", "details"];
        const idx = groups.indexOf(context.helpPanelState.group);
        const next = groups[(idx + event.delta + groups.length) % groups.length] ?? "core";
        context.helpPanelState = { group: next, cursor: 0 };
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "help-enter") {
        if (!context.helpPanelState) return;
        const { buildHelpPanelData: build } = await import("./shell/models/help-panel.js");
        const entries = build(context.helpPanelState.group, 0, context.language).entries;
        const target = entries[context.helpPanelState.cursor];
        if (!target) return;
        context.helpPanelState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        blocks.push(createCommandBlock(commandSequence++, target.slash));
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        await processTuiLine(target.slash, context, gateway, shellOutput, store);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "help-select") {
        if (!context.helpPanelState) return;
        const { buildHelpPanelData: build } = await import("./shell/models/help-panel.js");
        const entries = build(context.helpPanelState.group, 0, context.language).entries;
        const target = entries[event.index];
        if (!target) return;
        context.helpPanelState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        blocks.push(createCommandBlock(commandSequence++, target.slash));
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        await processTuiLine(target.slash, context, gateway, shellOutput, store);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      // ─── D.13Q-UX Closure — BtwPanel 关闭 ────────────────────────────────────
      if (event.type === "btw-close") {
        if (context.btwPanelState?.phase === "loading" && context.activeBtwAbortController) {
          context.activeBtwAbortController.abort();
          context.activeBtwAbortController = undefined;
        }
        context.btwPanelState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "btw-open") {
        context.btwPanelState = { question: event.question, phase: "loading" };
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      // ─── D.13Q-UX Closure — SessionsPanel 事件 ──────────────────────────────
      if (event.type === "sessions-close") {
        context.sessionsPanelState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "sessions-open") {
        blocks.push(createCommandBlock(commandSequence++, "/sessions"));
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        await processTuiLine("/sessions", context, gateway, shellOutput, store);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "sessions-move") {
        if (!context.sessionsPanelState) return;
        const total = context.sessionsPanelState.entries.length;
        if (total === 0) return;
        const next = (context.sessionsPanelState.cursor + event.delta + total) % total;
        context.sessionsPanelState = { ...context.sessionsPanelState, cursor: next };
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "sessions-resume") {
        if (!context.sessionsPanelState) return;
        const target = context.sessionsPanelState.entries[context.sessionsPanelState.cursor];
        if (!target) return;
        // D.13Q-UX Closure: 当前 session 不能 resume —— resumeSessionWithHandoff
        // 需要往新 session 注入 structured handoff，对自身做这件事既是逻辑死循环
        // 也无意义。给一条 NotificationStack 轻提示并保留 panel 让用户重新选。
        if (target.isCurrent) {
          const tip =
            context.language === "en-US"
              ? "Already on this session; nothing to resume."
              : "已在当前会话，无需恢复。";
          if (!context.notifications) context.notifications = [];
          context.notifications.push({
            key: "sessions:resume-current",
            text: tip,
            priority: "medium",
            timeoutMs: 4000,
            createdAt: Date.now(),
            tone: "warning",
          });
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          return;
        }
        context.sessionsPanelState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        const cmd = `/resume ${target.id}`;
        blocks.push(createCommandBlock(commandSequence++, cmd));
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        await processTuiLine(cmd, context, gateway, shellOutput, store);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      // ─── D.13E Step 2 — config-* 三类事件：ConfigPanel 自带 useInput 上抛 ─────
      if (event.type === "config-move") {
        if (!context.configPanelState) return;
        const current = context.configPanelState.phase === "panel_list" ? context.configPanelState.cursor : 0;
        context.configPanelState = { phase: "panel_list", cursor: Math.max(0, Math.min(13, current + event.delta)) };
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "config-submit") {
        context.configPanelState = undefined;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        blocks.push(createCommandBlock(commandSequence++, event.command));
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        await processTuiLine(event.command, context, gateway, shellOutput, store);
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "config-enter") {
        return;
      }
      if (event.type === "config-back") {
        if (!context.configPanelState) return;
        context.configPanelState = undefined;
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
              writeLine(
                shellOutput,
                context.language === "en-US"
                  ? "Project-level allow is not available for this action yet. Choose allow once, deny, or details."
                  : "此动作暂不支持项目级同类允许。请选择本次允许、拒绝或查看详情。",
              );
              shell?.rerender();
              await shell?.waitUntilRenderFlush();
              return;
            }
            const tool = approval.toolName;
            const risk: PermissionRule["risk"] = tool === "Bash" ? "high" : "medium";
            const result = await addAllowRule(context, tool, risk);
            // D.13L Block 0-C — 权限卡里的"项目级允许"反馈降噪：
            // 不再把 "已添加权限规则：<uuid> allow Bash high" 这类含 rule.id 的审计文案
            // 直接写到主屏。added / duplicate 都视为持久化成功，给同一句"已记住"。
            // save_failed / invalid 走人性化分支，仍保留可操作信息但不含 rule.id。
            const isEn = context.language === "en-US";
            if (result.kind === "added" || result.kind === "duplicate") {
              // D.13Q-UX Real Smoke Fix v2 — F. allow_always_tool 成功反馈走
              // NotificationStack 单条主显，不再 writeLine 进 transcript（避免
              // task transcript 里冒出 "已记住：..." 大块）。NotificationStack
              // 由 view-model 的 createdAt+timeoutMs 过滤过期项。
              if (!context.notifications) context.notifications = [];
              context.notifications.push({
                key: `permission:remembered:${tool}:${Date.now()}`,
                text: isEn
                  ? `Remembered: future ${tool} actions like this will be allowed.`
                  : `已记住：以后这类 ${tool} 操作将自动允许。`,
                priority: "medium",
                timeoutMs: 4000,
                createdAt: Date.now(),
                tone: "success",
              });
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
              writeLine(shellOutput, isEn ? `Unknown tool: ${tool}` : `未知工具：${tool}`);
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
      if (event.type === "task-suggestion-move") {
        const total = controller.getViewModel().taskSuggestions?.length ?? 0;
        if (total <= 0) {
          context.taskSuggestionCursor = 0;
          return;
        }
        const current = context.taskSuggestionCursor ?? 0;
        context.taskSuggestionCursor = (current + event.delta + total) % total;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "task-suggestion-action") {
        const view = controller.getViewModel();
        const suggestion = view.taskSuggestions?.find((item) => item.id === event.suggestionId);
        if (!suggestion) return;
        if (!context.handledTaskSuggestionIds) context.handledTaskSuggestionIds = new Set();
        context.handledTaskSuggestionIds.add(suggestion.id);
        context.taskSuggestionCursor = 0;
        if (suggestion.action.kind === "slash") {
          context.commandPanelState = undefined;
          blocks.push(createCommandBlock(commandSequence++, suggestion.action.command));
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          await processTuiLine(suggestion.action.command, context, gateway, shellOutput, store);
          shell?.rerender();
          await shell?.waitUntilRenderFlush();
          return;
        }
        if (suggestion.action.kind === "inline") {
          await controller.onInput({
            type: "permission-action",
            actionId: suggestion.action.id as import("./shell/types.js").PermissionActionId,
          });
          return;
        }
        return;
      }
      if (event.type === "empty-submit") {
        submittedPending = false;
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type !== "submit") {
        submittedPending = false;
        const sessionId = context.sessionId ?? (await ensureSession(context));
        await appendSystemEvent(
          context,
          sessionId,
          `ink shell ignored unrecognized input event: ${(event as { type?: string }).type ?? "unknown"}`,
          "warning",
        );
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      // P1-6: immediately enter pending state to prevent home flicker
      submittedPending = true;
      submittedPendingStartedAt = Date.now();
      if (event.type === "submit" && !event.text.startsWith("/")) {
        context.commandPanelState = undefined;
        context.helpPanelState = undefined;
        context.configPanelState = undefined;
        context.btwPanelState = undefined;
        context.sessionsPanelState = undefined;
      }
      // Slash commands are user-visible commands, not chat input. Push a
      // dedicated command block (kind="command", keep=true) into the
      // transcript so it survives ShellBlockOutput splice and renders as an
      // independent `❯ /command` row above the tool/output blocks.
      if (event.type === "submit" && event.text.startsWith("/")) {
        // D.13E Step 2 — 用 createCommandBlock 替代手写 push，统一 transcript 行格式。
        blocks.push(createCommandBlock(commandSequence++, event.text));
      } else if (event.type === "submit" && event.text.length > 0) {
        // D.13Q-UX Real Smoke Fix v2 — C. 用户普通消息立即推 user transcript block，
        // 让任务页"对话流"成立：模型还没回话之前，用户输入也已经在屏幕上可见，
        // 不会出现"消息被吞"的错觉。pendingModelSetup（apiKey 遮罩流）和正在
        // 等待 enter confirmation 的特殊路径走单独的 prompt 渲染，不进 transcript。
        const isModelSetup = Boolean(context.pendingModelSetup);
        const isPendingConfirm = hasPendingEnterConfirmation(context);
        if (!isModelSetup && !isPendingConfirm) {
          blocks.push(createUserTextBlock(commandSequence++, event.text));
        }
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
        submittedPendingStartedAt = undefined;
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
    activityTicker = setInterval(() => {
      if (!submittedPending && !context.requestActivityPhase && !context.activeAbortController) {
        return;
      }
      shell?.rerender();
    }, 1000);
    // D.14D — 暴露 rerender 钩子给需要在 handler 内先刷 loading 帧的命令（/btw）。
    context.shellRerender = () => shell?.rerender();
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
    if (activityTicker) clearInterval(activityTicker);
    return await runPlainTui(input, output, context, gateway, store, startup, sigintHandler);
  }
  try {
    return await exitPromise;
  } finally {
    if (activityTicker) clearInterval(activityTicker);
  }
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
    const promptCommand = context.pendingPromptCommand;
    context.pendingPromptCommand = undefined;
    const messageText = promptCommand?.prompt ?? text;
    context.commandPanelState = undefined;
    context.helpPanelState = undefined;
    context.configPanelState = undefined;
    context.btwPanelState = undefined;
    context.sessionsPanelState = undefined;
    const naturalResult = promptCommand
      ? "message"
      : await handleNaturalInput(text, context, gateway, output);
    if (naturalResult === "message") {
      await sendMessage(messageText, context, gateway, output);
    }
  }
  return "continue";
}

async function shouldEnterInkShell(input: Readable, output: Writable): Promise<boolean> {
  if (!shouldEnterProductShellCandidate(input, output)) return false;
  const { shouldUseInkShell } = await import("./shell/ink-renderer.js");
  return shouldUseInkShell(input, output);
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
  if (findPromptCommand(command)) {
    const promptText = buildPromptCommandUserText(command, rest, context.language);
    if (promptText) {
      context.pendingPromptCommand = { command, prompt: promptText };
      return "message";
    }
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
    writeLine(output, formatCatalogHelp(context.language, context.permissionMode, false, variant));
    return "handled";
  }
  if (command === "/features") {
    writeLine(output, formatFeaturePolicy(context));
    return "handled";
  }
  if (command === "/capabilities") {
    await handleCapabilitiesCommand(rest, context, output);
    return "handled";
  }
  if (command === "/apps") {
    await handleAppsCommand(rest, context, output);
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
    await hydrateWorkflowRuns(context);
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
    await handleInterruptCommand(rest, context, output);
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
  if (command === "/compact" || command === "/context") {
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
    // D.14D — /index repair 是显式入口：在安全门阻塞（有 risky files）时把缺失的
    // ignore 条目写入并刷新索引。历史上这条只能通过自然语言续跑触发；现在改为显式
    // slash，普通自然语言不再被关键词截胡。ignore 写入仍走权限管道（decidePermission）。
    if ((rest[0] ?? "") === "repair") {
      await runIndexSafetyRepair(context, output);
      return "handled";
    }
    if ((rest[0] ?? "") === "refresh") {
      await requestIndexRefreshApproval(rest, context, output);
      return "handled";
    }
    if ((rest[0] ?? "") === "init" && (rest[1] ?? "") === "fast") {
      await requestIndexInitFastApproval(rest, context, output);
      return "handled";
    }
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
  // D.13R Git / Worktree / Stable Point — 只读探测面板。
  // /git、/worktree、/checkpoint 默认显示状态摘要，不执行任何 mutating 操作。
  // 真正的 git commit / reset / checkout / worktree add/remove 走 Bash 工具
  // + permission-policy-engine 的现有四档权限链。
  if (command === "/git") {
    await handleGitCommand(rest, context, output, gitSlashDeps);
    return "handled";
  }
  if (command === "/worktree") {
    await handleWorktreeCommand(rest, context, output, gitSlashDeps);
    return "handled";
  }
  if (command === "/checkpoint") {
    await handleCheckpointCommand(rest, context, output, gitSlashDeps);
    return "handled";
  }
  if (command === "/memory") {
    await handleMemoryCommand(rest, context, output);
    return "handled";
  }
  if (command === "/failures") {
    await handleFailuresCommand(rest, context, output);
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
    refreshBackgroundLifecycle(context);
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
    refreshBackgroundLifecycle(context);
    if (context.isInkSession) {
      showCommandPanel(context, output, buildStatusPanel(context));
    } else {
      writeStatus(output, context);
      writeLine(output, formatTerminalReadinessStatus(createTerminalReadinessView(context)));
    }
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
  if (command === "/brief") {
    context.briefMode = !context.briefMode;
    const msg = context.briefMode
      ? messages[context.language].r7BriefEnabled
      : messages[context.language].r7BriefDisabled;
    writeLine(output, msg);
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
    // D.13Q-UX Closure: ink 路径打开 SessionsPanel（不逐行 writeLine）；
    // plain TUI 仍走旧 writeLine fallback。
    if ((context as { isInkSession?: boolean }).isInkSession) {
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
      return "handled";
    }
    if (sessions.length === 0) {
      writeLine(output, t(context, "noSessions"));
      return "handled";
    }
    // D.14E+ — plain TUI 也用 CommandPanel 避免刷屏：主屏显示总数+最近 5 个，
    // 完整列表进 detailsText（/details sessions）。
    const recentSessions = sessions.slice(0, 5);
    const summaryLines = [
      t(context, "sessionHeader"),
      ...recentSessions.map((s) => {
        const marker = s.id === context.sessionId ? "*" : " ";
        return `${marker} ${s.id}  ${s.updatedAt}  ${s.summary ?? t(context, "noSummary")}`;
      }),
    ];
    if (sessions.length > 5) {
      summaryLines.push(`... 另有 ${sessions.length - 5} 个 session（完整列表见 details）`);
    }
    const detailsText = [
      t(context, "sessionHeader"),
      ...sessions.map((s) => {
        const marker = s.id === context.sessionId ? "*" : " ";
        return `${marker} ${s.id}  ${s.updatedAt}  ${s.summary ?? t(context, "noSummary")}`;
      }),
    ].join("\n");
    showCommandPanel(context, output, {
      title: "/sessions",
      tone: "neutral",
      summary: summaryLines,
      actions: ["/sessions resume <id>"],
      detailsText,
    });
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

configureSlashCommandRuntime({ handleSlashCommand });
