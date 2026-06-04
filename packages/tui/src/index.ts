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
import { type Readable, Writable } from "node:stream";
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
import { evaluateMetaScheduler, formatMetaSchedulerDirective } from "./meta-scheduler-runtime.js";
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
  cancelAllAgents,
  cancelAgentByRef,
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
import { type ConfigPanelId, reduceConfigState } from "./shell/models/config-control-plane.js";
import { computeHomePromptPrefix, writePlainShell } from "./shell/plain-renderer.js";
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
  applyToolResultBudgetToMessages,
  type ToolResultBudgetRecord,
  type ToolResultBudgetState,
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
// D.14A-3 source anchors for source-level D.13 tests after modular split:
// createVerificationLevelForReadiness -> classifyVerificationLevel(...); createModelSystemPrompt still projects with projectRuntimeStatusForPrompt(runtimeStatus).
// FreshnessRule= WebSearch/WebFetch unverified; RuntimeIdentityRule= Do not include provider, endpointProfile, route role, baseUrl; "(provider: ...)" openai-compatible.
// RuntimeStatusForModel does not contain provider/baseUrl/endpointProfile by default; RuntimeIdentityRule allows when the user runs /model doctor or /model route doctor; doctor may print provider=${runtime.provider}.
// /model echo still includes reasoning=${runtime.reasoningStatus}; async function handleModelCommand( uses formatModelRouteSummary and intentionally omits trailing writeStatus(output, context).
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
  "/context",
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

type BreakCacheMutationAction = "always" | "clear" | "off" | "once";

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
      // D.13Q-UX Closure: 携带 engine 真实 verdict 给 PermissionPanel 用。
      verdict?: import("./permission-policy-engine.js").PolicyVerdict;
      boundaryPreflight?: BoundaryEditPreflightResult & { decision: "confirm" };
    }
  | {
      kind: "architecture_drift";
      toolCall: ModelToolCall;
      toolName: ToolName;
      sessionId: string;
      warnings: string[];
      continuation?: PendingModelContinuation;
      verdict?: import("./permission-policy-engine.js").PolicyVerdict;
    }
  | {
      // D.14G — managed worktree remove 确认（clean=轻确认；strong=dirty+force 强确认）。
      // 复用 pendingLocalApproval / yes-no glue，不新增第五种权限模式。continuation 仅
      // 模型工具路径需要（回灌结果给模型续轮）；slash 路径为 undefined。
      kind: "git_worktree_remove";
      sessionId: string;
      name: string;
      path: string;
      force: boolean;
      strong: boolean;
      continuation?: PendingModelContinuation;
      toolCall?: ModelToolCall;
    }
  | {
      // D.14D-R2 P1-1 — 模型工具 GitStablePointCreate 的确认。自然语言触发的稳定点
      // （创建 commit/snapshot）仅 default / auto-review 进入确认；plan 模式在工具派发
      // 层直接只读拒绝。复用 pendingLocalApproval / yes-no glue / PermissionPanel，不新增第五种权限模式。
      // 仅模型工具路径用此 kind；slash /git stable create 是显式用户动作，不走此确认。
      kind: "git_stable_point";
      sessionId: string;
      message?: string;
      includeUntracked?: boolean;
      continuation?: PendingModelContinuation;
      toolCall: ModelToolCall;
    }
  | {
      // D.14D-R P0-2 — 结构化索引工具（IndexRefresh / IndexRepair）的 mutating
      // 权限确认。复用 pendingLocalApproval / PermissionPanel 管道；continuation
      // 仅模型工具路径需要（回灌工具结果给模型续轮）。
      kind: "index_tool";
      indexAction: "init fast" | "refresh" | "repair";
      toolCall: ModelToolCall;
      sessionId: string;
      force?: boolean;
      continuation?: PendingModelContinuation;
    }
  | {
      kind: "report_write_tool";
      toolCall: ModelToolCall;
      sessionId: string;
      continuation?: PendingModelContinuation;
    }
  | {
      kind: "agent_tool_use";
      agentId: string;
      agentTranscriptSessionId: string;
      toolCall: ModelToolCall;
      toolName: ToolName;
      sessionId: string;
      verdict?: import("./permission-policy-engine.js").PolicyVerdict;
    }
  | {
      kind: "memory_mutation";
      sessionId: string;
      mutation: MemoryMutation;
    }
  | {
      kind: "break_cache_mutation";
      sessionId: string;
      action: BreakCacheMutationAction;
    }
  | {
      kind: "image_generation";
      sessionId: string;
      prompt: string;
      id: string;
      assetPath: string;
      provider: string;
      model: string;
    };

export type PendingModelContinuation = {
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

function getProviderErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "PROVIDER_ERROR";
}

function shouldAttemptRuntimeFallback(kind: ProviderFailureKind): boolean {
  return (
    kind === "rate_limit" ||
    kind === "quota_or_balance_exhausted" ||
    kind === "gateway" ||
    kind === "transit" ||
    kind === "timeout"
  );
}

function createRuntimeForFallbackModel(
  context: TuiContext,
  baseRuntime: SelectedModelRuntime,
  fallbackModel: string,
): SelectedModelRuntime | undefined {
  if (!fallbackModel || fallbackModel === baseRuntime.model) return undefined;
  const provider = inferProviderForRouteModel(fallbackModel, context.config);
  const providerConfig = context.config.providers[provider];
  if (!providerConfig) return undefined;
  const rawEndpointProfile = providerConfig.endpointProfile ?? "chat_completions";
  const endpointProfile = rawEndpointProfile === "responses" ? "responses" : "chat_completions";
  const compatibilityProfile =
    providerConfig.compatibilityProfile ??
    (providerConfig.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
  const reasoningLevel = providerConfig.reasoningLevel;
  const reasoningSent = Boolean(
    reasoningLevel &&
      (endpointProfile === "responses" ||
        compatibilityProfile === "permissive_openai_compatible" ||
        rawEndpointProfile === "anthropic_messages"),
  );
  return {
    role: baseRuntime.role,
    provider,
    model: fallbackModel,
    endpointProfile,
    reasoningLevel,
    reasoningStatus: formatReasoningEffectiveState(reasoningLevel, reasoningSent),
    reasoningSent,
  };
}

function resolveRuntimeFallback(
  context: TuiContext,
  runtime: SelectedModelRuntime,
  error: unknown,
): { runtime: SelectedModelRuntime; kind: ProviderFailureKind; code: string } | undefined {
  const kind = classifyProviderFailure(error);
  if (!shouldAttemptRuntimeFallback(kind)) return undefined;
  const route = getRoleRoute(context.config, runtime.role);
  for (const fallbackModel of route.fallbackModels) {
    const fallbackRuntime = createRuntimeForFallbackModel(context, runtime, fallbackModel);
    if (!fallbackRuntime) continue;
    if (fallbackRuntime.provider === runtime.provider && fallbackRuntime.model === runtime.model) {
      continue;
    }
    return { runtime: fallbackRuntime, kind, code: getProviderErrorCode(error) };
  }
  return undefined;
}

async function recordProviderFallbackAttempt(
  context: TuiContext,
  sessionId: string,
  input: {
    from: SelectedModelRuntime;
    to: SelectedModelRuntime;
    kind: ProviderFailureKind;
    code: string;
    status: "attempted" | "succeeded" | "failed";
  },
): Promise<void> {
  const summary = formatProviderFallbackAttemptSummary(
    {
      fromProvider: input.from.provider,
      fromModel: input.from.model,
      toProvider: input.to.provider,
      toModel: input.to.model,
      reasonKind: input.kind,
    },
    context.language,
  );
  context.lastProviderFallbackAttempt = {
    fromProvider: input.from.provider,
    fromModel: input.from.model,
    toProvider: input.to.provider,
    toModel: input.to.model,
    reasonKind: input.kind,
    reasonCode: input.code,
    status: input.status,
    summary,
    createdAt: new Date().toISOString(),
  };
  const decision = context.routeDecisions.find(
    (item) => item.role === input.from.role && item.selectedModel === input.from.model,
  );
  if (decision) {
    decision.fallbackUsed = true;
  } else {
    context.routeDecisions.unshift({
      id: `route-${randomUUID().slice(0, 8)}`,
      triggerReason: "provider runtime fallback",
      role: input.from.role,
      selectedProvider: input.to.provider,
      selectedModel: input.to.model,
      fallbackCandidates: [input.to.model],
      requiredCapabilities: [],
      stopConditions: [],
      repairSuggestions: [],
      fallbackUsed: true,
      budgetStop: false,
      createdAt: new Date().toISOString(),
    });
  }
  await appendSystemEvent(
    context,
    sessionId,
    `provider fallback attempt: from ${input.from.provider}/${input.from.model}; to ${input.to.provider}/${input.to.model}; reason ${input.kind}; code ${input.code}; status ${input.status}`,
    input.status === "succeeded" ? "info" : "warning",
  );
}

function checkAndWriteProviderCooldown(
  context: TuiContext,
  runtime: SelectedModelRuntime,
  output: Writable,
): boolean {
  const cooldownCheck = checkProviderCooldown(
    context.providerBreaker,
    runtime.provider,
    runtime.model,
  );
  if (!cooldownCheck.blocked) return false;
  writeLine(
    output,
    formatCooldownMessage(
      runtime.provider,
      runtime.model,
      cooldownCheck.remainingMs,
      context.language,
    ),
  );
  return true;
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
  failureLearning: FailureLearningState;
  skills: SkillState;
  workflows: WorkflowState;
  agentRegistry: { agents: RegistryAgentDefinition[]; errors: string[] };
  workflowRegistry: { workflows: RegistryWorkflowDefinition[]; errors: string[] };
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
  taskSuggestionCursor?: number;
  handledTaskSuggestionIds?: Set<string>;
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
  lastProviderFallbackAttempt?: ProviderFallbackAttemptSummary;
  providerBreaker: ProviderCircuitBreakerState;
  solutionCompleteness: SolutionCompletenessStatus;
  currentArchitectureCard?: ArchitectureCard;
  requestActivity?: { slowHintShown: boolean; slowTimer?: ReturnType<typeof setTimeout> };
  requestActivityPhase?: RequestActivityPhase;
  requestActivityToolName?: string;
  lastModelRequest?: {
    phase: RequestActivityPhase;
    toolName?: string;
    startedAt?: string;
    endedAt: string;
  };
  // D.13I tail fix — 记录本 session 通过 SearchExtraTools 真正发现过的 deferred 工具名。
  // ExecuteExtraTool 必须先看 Set，命中后再走白名单/适配器/必填参数检查。
  // 这是"已发现"的唯一证据；listDeferredTools 仅作为白名单存在性，不能等同于"发现过"。
  discoveredDeferredToolNames: Set<string>;
  toolResultBudgetState?: ToolResultBudgetState;
  sessionStoreVerifiedId?: string;
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
  /**
   * D.13Q-UX Closure — 轻提示队列。cache-low / setup / shortcut 类提示
   * 通过 view-model 映射到 view.notifications，由 NotificationStack 右对齐
   * 单条主显，绝不进 transcript（与 ShellBlockOutput 隔离）。
   */
  notifications?: import("./shell/types.js").NotificationView[];
  /**
   * D.13Q-UX Closure — HelpPanel 状态。打开时显示三组 Tab + 命令列表。
   */
  helpPanelState?: {
    group: "core" | "advanced" | "details";
    cursor: number;
  };
  /**
   * D.13Q-UX Closure — BtwPanel 状态（side question 独立面板，不进主 conversation）。
   */
  btwPanelState?: {
    question: string;
    phase: "loading" | "answered" | "error";
    answer?: string;
    error?: string;
  };
  activeBtwAbortController?: AbortController;
  /**
   * D.13Q-UX Closure — SessionsPanel 状态（picker，按 updatedAt 排序）。
   */
  sessionsPanelState?: {
    cursor: number;
    entries: {
      id: string;
      title: string;
      updatedAt: string;
      messageCount: number;
      isCurrent: boolean;
    }[];
  };
  /**
   * D.13Q-UX Closure — 当前是否在 ink TUI 会话中。runInkShell 启动时设 true，
   * 让 /btw / /sessions / /resume 等 handler 选择 panel 路径而不是 writeLine。
   */
  isInkSession?: boolean;
  /**
   * D.14D — 当前会话的 ModelGateway 引用。runTui 创建 gateway 后挂上，让
   * /btw 这类需要发起隔离单轮模型请求（无工具、不污染主 conversation）的
   * 命令可以拿到 gateway，而不必修改 handleSlashCommand 的签名。普通模型主链
   * 仍走显式 gateway 参数；这里只是给 side-question runtime 一个稳定入口。
   */
  modelGateway?: ModelGateway;
  /**
   * D.14D — ink shell 的 rerender 钩子（runInkShell 启动后挂上）。让需要在
   * 单次 handler 内"先显示 loading 帧、再 await 异步结果"的命令（如 /btw 调模型）
   * 能在 await 前主动刷新一帧。plain TUI / 测试无此钩子时安全跳过。
   */
  shellRerender?: () => void;
  /** Optional Ink output memory cleanup hook, invoked after context compaction succeeds. */
  compactOutputMemory?: () => Promise<void> | void;
  /**
   * D.13Q-UX Task Surface — 通用 CommandPanel 状态。高级 slash 命令的结果
   * 由命令处理器 set 进这里，view-model 透传给 view.commandPanel。
   * undefined = 没有面板打开。
   */
  commandPanelState?: import("./shell/types.js").CommandPanelView;
  /**
   * Ctrl+O transcript/message verbose expand state. This is intentionally
   * separate from commandPanelState: Ctrl+O expands folded output blocks, while
   * CommandPanel remains reserved for explicit advanced slash panels.
   */
  ctrlOExpandState?: { active: boolean; blockId?: string };
  /**
   * D.13Q-UX Task Surface — 任务区滚动状态。home 模式下不读取；task/pending
   * 模式默认为 { scrollOffset: 0, stickToBottom: true }。
   */
  transcriptScrollState?: import("./shell/types.js").TranscriptScrollView;
};

const VERIFICATION_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

const MIN_CACHE_HISTORY_SIZE = 1;
const MAX_CACHE_HISTORY_SIZE = 200;
const DEFAULT_LIGHT_HINT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_LIGHT_HINTS_PER_TURN = 1;
const MAX_TODO_ONLY_CONSECUTIVE_ROUNDS = LINGHUN_MAX_TODO_ONLY_CONSECUTIVE_ROUNDS;
const MAX_MODEL_TOTAL_TOOL_ROUNDS = LINGHUN_MAX_AGENTIC_TURNS;
const MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES = LINGHUN_MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES;
const CODEBASE_MEMORY_COMMAND = "codebase-memory-mcp";
const CODEBASE_MEMORY_ENV = "LINGHUN_CODEBASE_MEMORY_MCP";
const PROJECT_RULES_STATUS_WIDTH = 160;
const MEMORY_PROMPT_TOP_K = 3;
const MEMORY_PROMPT_ITEM_WIDTH = 180;
const MEMORY_PROMPT_TOTAL_WIDTH = 720;
const MAX_CONTEXT_MESSAGES = 12;
const REQUEST_SLOW_HINT_MS = 20_000;
const MAX_EVIDENCE_RECORDS = 50;
const MAX_BACKGROUND_TASKS = 50;
const WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT = 8;
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

// D.14G-Refactor-Closure composition root：注入 index.ts hoisted 函数到迁出的 git 模块。
const gitToolDispatchDeps: GitToolDispatchDeps = {
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

const gitSlashDeps: GitSlashDeps = {
  dispatch: gitToolDispatchDeps,
  ensureSession,
  writeLine,
  writeStatus,
};

// git_worktree_remove yes/no 解析 deps。continueAfterToolResults 仅 gateway 在场时回灌续轮。
function createWorktreeRemoveResolveDeps(
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
          context.sessionsPanelState
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
        } catch {
          // 会话/事件写入失败不阻断 UI 切换；底层日志路径不应把用户输入区拖死。
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
      // Ctrl+O 是 transcript/message verbose expand，不是高级 CommandPanel。
      // 有可展开 output block 时只切换 view-model 的 block 展开态；无可展开内容
      // 时只显示轻提示，不写 transcript，不触发 /details，也不靠 Esc 退出。
      if (event.type === "toggle-details") {
        submittedPending = false;
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
        if (!context.notifications) context.notifications = [];
        context.notifications.push({
          key: "ctrl-o-empty",
          text:
            context.language === "en-US"
              ? "Nothing to expand right now."
              : "当前没有可展开的完整内容。",
          priority: "low",
          timeoutMs: 4000,
          createdAt: Date.now(),
          tone: "dim",
        });
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
      // ─── Main transcript scroll ─────────────────────────────────────────────
      if (event.type === "transcript-scroll") {
        const { reduceTranscriptScroll } = await import(
          "./shell/models/transcript-scroll-state.js"
        );
        context.transcriptScrollState =
          "action" in event
            ? reduceTranscriptScroll(context.transcriptScrollState, {
                type: "scroll",
                action: event.action,
              })
            : reduceTranscriptScroll(context.transcriptScrollState, {
                type: "scroll",
                delta: event.delta,
              });
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "transcript-scroll-measure") {
        const { reduceTranscriptScroll } = await import(
          "./shell/models/transcript-scroll-state.js"
        );
        context.transcriptScrollState = reduceTranscriptScroll(context.transcriptScrollState, {
          type: "measure",
          viewportHeight: event.viewportHeight,
          contentHeight: event.contentHeight,
        });
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "transcript-scroll-end") {
        const { reduceTranscriptScroll } = await import(
          "./shell/models/transcript-scroll-state.js"
        );
        context.transcriptScrollState = reduceTranscriptScroll(context.transcriptScrollState, {
          type: "end",
        });
        shell?.rerender();
        await shell?.waitUntilRenderFlush();
        return;
      }
      if (event.type === "transcript-scroll-top") {
        const { reduceTranscriptScroll } = await import(
          "./shell/models/transcript-scroll-state.js"
        );
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
      // P1-6: immediately enter pending state to prevent home flicker
      submittedPending = true;
      submittedPendingStartedAt = Date.now();
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
    writeLine(output, formatCatalogHelp(context.language, context.permissionMode, false, variant));
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
    writeStatus(output, context);
    refreshBackgroundLifecycle(context);
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

export async function runCommandCaptureForTest(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): ReturnType<typeof runCommandCapture> {
  return runCommandCapture(command, args, cwd, timeoutMs);
}

async function handleWorkflowsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await hydrateWorkflowRuns(context);
  const name = args[0];
  if (!name) {
    writeLine(output, formatWorkflows(context));
    return;
  }
  if (name === "status") {
    writeLine(output, formatWorkflowStatus(context));
    return;
  }
  if (name === "registry" || name === "list") {
    writeLine(output, formatWorkflowRegistryList(context));
    return;
  }
  if (name === "plan") {
    const goal = args.slice(1).join(" ").trim();
    if (!goal) {
      writeLine(
        output,
        context.language === "en-US"
          ? "Usage: /workflows plan <goal>"
          : "用法：/workflows plan <目标描述>",
      );
      return;
    }
    const { generateWorkflowPlanPreview, formatWorkflowPlanPreview } = await import(
      "./workflow-planner-entry.js"
    );
    const result = generateWorkflowPlanPreview({
      goal,
      permissionMode: context.permissionMode,
      ...buildWorkflowPlannerContextInput(context),
    });
    writeLine(output, formatWorkflowPlanPreview(result, context.language));
    if (result.ok) {
      context.lastFullOutput = result.detailsText;
      await recordWorkflowPlanPreviewEvidence(context, await ensureSession(context), result);
    }
    return;
  }
  if (name === "run") {
    const target = args[1];
    const rest = args.slice(2).join(" ").trim();
    if (!target) {
      writeLine(
        output,
        context.language === "en-US"
          ? "Usage: /workflows run <workflowId|goal>"
          : "用法：/workflows run <workflowId|目标描述>",
      );
      return;
    }
    const registry = findRegistryWorkflow(context, target);
    if (registry) {
      await runRegistryWorkflow(registry, rest, false, context, output);
      return;
    }
    const registryAgent = findRegistryAgentWorkflow(context, target);
    if (registryAgent) {
      await runRegistryAgentWorkflow(registryAgent, rest, false, context, output);
      return;
    }
    const goal = args.slice(1).join(" ").trim();
    await runWorkflowSteps(goal, context, output);
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

function buildWorkflowPlannerContextInput(context: TuiContext): {
  controlledMemoryRef?: { rulesFound: boolean; summary?: string };
  selfLearningHints?: string[];
  failureLearningRefs?: Array<{ lesson: string; source: string }>;
  cacheFreshnessHint?: string;
  deepCompactRef?: { id: string; summary: string };
  indexStatusRef?: { status: string; projectName?: string; freshness?: string };
  architectureRef?: { target: string; summary: string };
} {
  const controlledMemoryRef =
    context.memory.projectRulesExists && context.memory.projectRulesSummary
      ? { rulesFound: true, summary: context.memory.projectRulesSummary }
      : undefined;
  const selfLearningHints = context.memory.accepted
    .filter((item) => item.source.startsWith("auto-learning:"))
    .slice(0, 5)
    .map((item) => item.summary)
    .filter(Boolean);
  const activeFailures = context.failureLearning.records
    .filter(
      (item) =>
        item.status === "active" && item.projectScope === context.failureLearning.projectScope,
    )
    .slice(0, 5)
    .map((item) => ({
      lesson: item.avoidNextTime,
      source: `${item.category}:${item.id.slice(0, 8)}`,
    }));
  return {
    ...(controlledMemoryRef ? { controlledMemoryRef } : {}),
    ...(selfLearningHints.length > 0 ? { selfLearningHints } : {}),
    ...(activeFailures.length > 0 ? { failureLearningRefs: activeFailures } : {}),
    ...(context.cache.lastFreshness
      ? { cacheFreshnessHint: summarizeWorkflowCacheFreshness(context.cache.lastFreshness) }
      : {}),
    ...(context.cache.deepCompact
      ? {
          deepCompactRef: {
            id: context.cache.deepCompact.id,
            summary: context.cache.deepCompact.summary,
          },
        }
      : {}),
    indexStatusRef: {
      status: context.index.status,
      projectName: context.index.projectName,
      freshness: formatIndexRuntimeRef(context.index),
    },
    ...(context.currentArchitectureCard
      ? {
          architectureRef: {
            target: context.currentArchitectureCard.target,
            summary: summarizeArchitectureCard(context.currentArchitectureCard).recommendedApproach,
          },
        }
      : {}),
  };
}

type DurableWorkflowRunState = NonNullable<WorkflowState["activeRun"]> & {
  projectPath: string;
  updatedAt: string;
  backgroundTask: BackgroundTaskState;
};

function getWorkflowRunsRoot(context: TuiContext): string {
  return join(dirname(resolveStoragePaths(context.config, context.projectPath).jobs), "workflows");
}

function getWorkflowRunStatePath(context: TuiContext, runId: string): string {
  return join(getWorkflowRunsRoot(context), runId, "state.json");
}

async function persistWorkflowRunState(
  context: TuiContext,
  run: NonNullable<WorkflowState["activeRun"]>,
  task: BackgroundTaskState,
): Promise<void> {
  const path = getWorkflowRunStatePath(context, run.id);
  const state: DurableWorkflowRunState = {
    ...run,
    projectPath: context.projectPath,
    updatedAt: new Date().toISOString(),
    backgroundTask: task,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function hydrateWorkflowRuns(context: TuiContext): Promise<void> {
  const root = getWorkflowRunsRoot(context);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = await readWorkflowRunState(join(root, entry.name, "state.json"));
    if (
      !state ||
      resolve(state.projectPath).toLowerCase() !== resolve(context.projectPath).toLowerCase()
    ) {
      continue;
    }
    const run = recoverWorkflowRunState(state);
    context.workflows.activeRun = run;
    const background = createWorkflowBackgroundProjection(state.backgroundTask, run);
    upsertWorkflowBackgroundTask(context, background);
    if (
      run.status !== state.status ||
      run.steps.some((step, index) => step.status !== state.steps[index]?.status)
    ) {
      await persistWorkflowRunState(context, run, background);
    }
  }
}

async function readWorkflowRunState(path: string): Promise<DurableWorkflowRunState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DurableWorkflowRunState>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.goal !== "string" ||
      typeof parsed.planId !== "string" ||
      typeof parsed.projectPath !== "string" ||
      !Array.isArray(parsed.steps) ||
      !parsed.backgroundTask
    ) {
      return null;
    }
    return parsed as DurableWorkflowRunState;
  } catch {
    return null;
  }
}

function recoverWorkflowRunState(
  state: DurableWorkflowRunState,
): NonNullable<WorkflowState["activeRun"]> {
  const recoveredSteps = state.steps.map((step) =>
    step.status === "running"
      ? {
          ...step,
          status: "stale" as const,
          summary: step.summary ?? "Workflow step was running before restart; marked stale.",
        }
      : step,
  );
  const hasStale = recoveredSteps.some((step) => step.status === "stale");
  const status = state.status === "running" && hasStale ? "stale" : state.status;
  return {
    id: state.id,
    goal: state.goal,
    planId: state.planId,
    status,
    steps: recoveredSteps,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    result: status === "completed" ? "partial" : status === "stale" ? "stale" : state.result,
  };
}

function createWorkflowBackgroundProjection(
  task: BackgroundTaskState,
  run: NonNullable<WorkflowState["activeRun"]>,
): BackgroundTaskState {
  const runningStep = run.steps.find((step) => step.status === "running");
  const staleStep = run.steps.find((step) => step.status === "stale");
  return {
    ...task,
    status: run.status === "running" ? "running" : run.status === "stale" ? "stale" : task.status,
    currentStep: staleStep?.summary ?? runningStep?.title ?? task.currentStep,
    updatedAt: new Date().toISOString(),
    result: run.status === "completed" ? "partial" : run.status === "failed" ? "fail" : "partial",
    userVisibleSummary:
      run.status === "stale"
        ? "Workflow stale after restart; inspect /workflows status before rerun."
        : task.userVisibleSummary,
    nextAction:
      run.status === "stale"
        ? "Use /workflows status and rerun after checking stale step evidence."
        : task.nextAction,
  };
}

function upsertWorkflowBackgroundTask(context: TuiContext, task: BackgroundTaskState): void {
  const existing = context.backgroundTasks.find((item) => item.id === task.id);
  if (existing) {
    Object.assign(existing, task);
    return;
  }
  rememberBackgroundTask(context, task);
}

function createWorkflowInterruptBackgroundTask(
  run: NonNullable<WorkflowState["activeRun"]>,
  language: Language,
): BackgroundTaskState {
  const now = new Date().toISOString();
  const runningStep = run.steps.find((step) => step.status === "running");
  return {
    id: run.id,
    kind: "job",
    title: `Workflow: ${truncateDisplay(run.goal, 50)}`,
    status: "running",
    currentStep: runningStep?.title ?? "workflow running",
    progress: {
      completed: run.steps.filter(
        (step) => step.status === "completed" || step.status === "partial",
      ).length,
      total: run.steps.length,
      label: "workflow",
    },
    startedAt: run.startedAt,
    updatedAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    result: "partial",
    userVisibleSummary:
      language === "en-US"
        ? "Workflow was active; interrupt is reconciling its missing background state."
        : "workflow 仍处于活动状态；中断正在恢复缺失的后台状态。",
    nextAction:
      language === "en-US"
        ? "Inspect /workflows status before rerun."
        : "重跑前请先查看 /workflows status。",
  };
}

function formatWorkflowStatus(context: TuiContext): string {
  const run = context.workflows.activeRun;
  if (!run) {
    return context.language === "en-US"
      ? "No active workflow run."
      : "当前没有 active workflow run。";
  }
  const counts = run.steps.reduce(
    (acc, step) => {
      acc[step.status] += 1;
      return acc;
    },
    {
      queued: 0,
      running: 0,
      completed: 0,
      partial: 0,
      failed: 0,
      blocked: 0,
      cancelled: 0,
      stale: 0,
    } satisfies Record<WorkflowStepState["status"], number>,
  );
  return [
    `Workflow ${run.id}`,
    `- status: ${run.status}; result ${run.result}`,
    `- goal: ${truncateDisplay(run.goal, 120)}`,
    `- planId: ${run.planId}`,
    `- steps: queued ${counts.queued}; running ${counts.running}; completed ${counts.completed}; partial ${counts.partial}; blocked ${counts.blocked}; failed ${counts.failed}; cancelled ${counts.cancelled}; stale ${counts.stale}`,
    `- evidenceRefs: ${run.steps.flatMap((step) => step.evidenceRefs).join(", ") || "none"}`,
    "- completion is PARTIAL only; blocked/stale/cancelled/failed steps never claim PASS.",
    "- background: /background; details: /details background <id>",
  ].join("\n");
}

function formatWorkflowStartPrimary(input: {
  language: Language;
  steps: number;
  currentPhase: string;
  background: boolean;
}): string {
  const phase = formatWorkflowDisplayLabel(input.currentPhase, "workflow");
  if (input.language === "en-US") {
    return [
      input.background ? "Background workflow started." : "Workflow started.",
      `- steps: ${input.steps}`,
      `- current phase: ${phase}`,
      "- details: /workflows status or /background",
    ].join("\n");
  }
  return [
    input.background ? "后台 workflow 已启动。" : "workflow 已启动。",
    `- steps: ${input.steps}`,
    `- 当前阶段：${phase}`,
    "- 详情：/workflows status 或 /background",
  ].join("\n");
}

function formatWorkflowBackgroundSummary(input: {
  language: Language;
  steps: number;
  currentPhase: string;
  background: boolean;
}): string {
  const phase = formatWorkflowDisplayLabel(input.currentPhase, "workflow");
  if (input.language === "en-US") {
    return `${input.background ? "Background workflow started" : "Workflow started"}; steps: ${input.steps}; current phase: ${phase}; details: /workflows status or /background.`;
  }
  return `${input.background ? "后台 workflow 已启动" : "workflow 已启动"}；steps: ${input.steps}；当前阶段：${phase}；详情：/workflows status 或 /background。`;
}

function formatWorkflowDisplayLabel(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  if (/^workflow(?:[-:_]|$)/iu.test(cleaned)) return fallback;
  if (/^(agent|verification|details|index|bash|write):[\w.-]+$/iu.test(cleaned)) {
    return workflowActionLabel(cleaned.split(":")[0] ?? "", fallback);
  }
  return truncateDisplay(cleaned, 48);
}

function formatRegistryWorkflowStepTitle(
  step: RegistryWorkflowDefinition["steps"][number],
): string {
  if (step.task?.trim()) return truncateDisplay(step.task.replace(/\s+/g, " ").trim(), 48);
  return workflowActionLabel(step.action, "workflow step");
}

function workflowActionLabel(action: string, fallback: string): string {
  switch (action) {
    case "agent":
      return "agent step";
    case "verification":
      return "verification step";
    case "index":
      return "index step";
    case "details":
      return "details step";
    case "bash":
      return "bash step";
    case "write":
      return "write step";
    default:
      return fallback;
  }
}

async function runWorkflowSteps(
  goal: string,
  context: TuiContext,
  output: Writable,
  options: RunWorkflowExecutionOptions = {},
): Promise<void> {
  const { generateWorkflowPlanPreview } = await import("./workflow-planner-entry.js");
  const preview = generateWorkflowPlanPreview({
    goal,
    permissionMode: context.permissionMode,
    agents: options.agents,
    multiAgent: options.multiAgent,
    runningCap: options.runningCap,
    teamName: options.teamName,
    ...buildWorkflowPlannerContextInput(context),
  });
  if (!preview.ok) {
    writeLine(output, `工作流计划生成失败：${preview.reason}`);
    return;
  }

  const phase =
    preview.plan.phases.find((item) => item.id === preview.plan.currentPhaseId) ??
    preview.plan.phases[0];
  if (!phase) {
    writeLine(output, "工作流运行失败：计划没有可执行 phase。");
    return;
  }
  const confirmed = generateWorkflowPlanPreview({
    goal,
    permissionMode: context.permissionMode,
    agents: options.agents,
    multiAgent: options.multiAgent,
    runningCap: options.runningCap,
    teamName: options.teamName,
    ...buildWorkflowPlannerContextInput(context),
    confirmedPhaseStopPoints: [phase.id],
  });
  if (!confirmed.ok) {
    writeLine(output, `工作流运行失败：${confirmed.reason}`);
    return;
  }

  await runWorkflowPlanSteps(goal, confirmed.plan, context, output, options);
}

type RunWorkflowExecutionOptions = {
  agents?: number;
  multiAgent?: boolean;
  runningCap?: number;
  teamName?: string;
  __testRunId?: string;
};

type WorkflowBatchItem = {
  step: WorkflowStepState;
  request: WorkflowBridgeRequestProposal;
};

export async function __testRunWorkflowStepsWithPlan(
  goal: string,
  plan: NormalizedWorkflowPlan,
  context: TuiContext,
  output: Writable,
  options: RunWorkflowExecutionOptions = {},
): Promise<void> {
  await runWorkflowPlanSteps(goal, plan, context, output, options);
}

async function runWorkflowPlanSteps(
  goal: string,
  plan: NormalizedWorkflowPlan,
  context: TuiContext,
  output: Writable,
  options: RunWorkflowExecutionOptions = {},
): Promise<void> {
  const phase = plan.phases.find((item) => item.id === plan.currentPhaseId) ?? plan.phases[0];
  if (!phase) {
    writeLine(output, "工作流运行失败：计划没有可执行 phase。");
    return;
  }

  const sessionId = await ensureSession(context);
  const runId = options.__testRunId ?? `workflow-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const executableSlices = plan.phases.flatMap((item) => item.slices);
  const stepStates: WorkflowStepState[] = executableSlices.map((slice) => ({
    id: slice.id,
    title: slice.title,
    status: "queued",
    runtime: workflowRuntimeKind(getCurrentWorkflowStepRequest(plan, phase.id, [], slice.id)),
    evidenceRefs: (slice.evidence ?? []).map((item) => item.ref),
    dependsOnSliceIds: slice.dependsOnSliceIds ?? [],
    independent: slice.independent === true,
    canRunInParallel: slice.canRunInParallel === true,
  }));
  const workflowTask: BackgroundTaskState = {
    id: runId,
    kind: "job",
    title: `Workflow: ${truncateDisplay(goal, 50)}`,
    status: "running",
    currentStep: "workflow starting",
    progress: { completed: 0, total: stepStates.length, label: "workflow" },
    startedAt,
    updatedAt: startedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    result: "partial",
    userVisibleSummary: formatWorkflowBackgroundSummary({
      language: context.language,
      steps: stepStates.length,
      currentPhase: phase.title || phase.id,
      background: false,
    }),
    nextAction: "等待 step_result；失败时查看 /failures 和 transcript。",
  };
  context.workflows.activeRun = {
    id: runId,
    goal,
    planId: plan.id,
    status: "running",
    steps: stepStates,
    startedAt,
    result: "partial",
  };
  rememberBackgroundTask(context, workflowTask);
  await persistWorkflowRunState(context, context.workflows.activeRun, workflowTask);
  await context.store.appendEvent(sessionId, {
    type: "workflow_start",
    workflow: {
      id: runId,
      goal,
      planId: plan.id,
      steps: stepStates,
      multiAgent: options.multiAgent === true,
      agents: options.agents,
      runningCap: normalizeWorkflowRunningCap(options.runningCap ?? plan.budget.maxRunningAgents),
      teamName: options.teamName,
    },
    createdAt: startedAt,
  });
  await appendBackgroundTaskEvent(context, sessionId, workflowTask);
  writeLine(
    output,
    formatWorkflowStartPrimary({
      language: context.language,
      steps: stepStates.length,
      currentPhase: phase.title || phase.id,
      background: false,
    }),
  );

  let completed = 0;
  let batchIndex = 0;
  while (stepStates.some((step) => step.status === "queued")) {
    if (isWorkflowRunTerminal(context, runId, workflowTask)) return;
    const batch = selectRunnableWorkflowBatch(plan, phase.id, stepStates, options);
    if (batch.length === 0) {
      const blocked = stepStates.find((step) => step.status === "queued");
      const summary = formatWorkflowStepSummary(
        blocked?.id ?? "workflow",
        "blocked",
        "no runnable workflow slice; dependencies or running cap left all remaining slices waiting",
        context.language,
      );
      if (blocked) {
        blocked.status = "blocked";
        blocked.summary = summary;
        blocked.endedAt = new Date().toISOString();
      }
      await finishWorkflowRun(runId, "blocked", summary, context, sessionId, workflowTask);
      return;
    }
    batchIndex += 1;
    const stepStartedAt = new Date().toISOString();
    for (const item of batch) {
      item.step.status = "running";
      item.step.startedAt = stepStartedAt;
      item.step.batchId = `batch-${batchIndex}`;
    }
    workflowTask.currentStep =
      batch.length === 1
        ? batch[0]?.step.title
        : `workflow batch ${batchIndex}: ${batch.map((item) => item.step.title).join(", ")}`;
    workflowTask.progress = {
      completed,
      total: stepStates.length,
      label: batch.length === 1 ? (batch[0]?.step.runtime ?? "workflow") : "workflow-batch",
    };
    workflowTask.updatedAt = stepStartedAt;
    await persistWorkflowRunState(context, context.workflows.activeRun, workflowTask);
    for (const item of batch) {
      await context.store.appendEvent(sessionId, {
        type: "workflow_step_start",
        workflowId: runId,
        step: item.step,
        createdAt: stepStartedAt,
      });
    }
    await appendBackgroundTaskEvent(context, sessionId, workflowTask);

    const results = await Promise.all(
      batch.map(async (item) => ({
        step: item.step,
        result: await executeWorkflowStep(
          item.request,
          context,
          output,
          runId,
          normalizeWorkflowRunningCap(options.runningCap ?? plan.budget.maxRunningAgents),
        ),
      })),
    );
    if (isWorkflowRunTerminal(context, runId, workflowTask)) return;
    const stepEndedAt = new Date().toISOString();
    for (const item of results) {
      item.step.status = item.result.status;
      item.step.summary = item.result.summary;
      item.step.evidenceRefs = item.result.evidenceRefs;
      item.step.endedAt = stepEndedAt;
      if (item.result.status === "completed" || item.result.status === "partial") completed += 1;
    }
    const terminal = results.find(
      (item) => item.result.status !== "completed" && item.result.status !== "partial",
    );
    workflowTask.currentStep =
      terminal?.result.summary ??
      (results.length === 1
        ? (results[0]?.result.summary ?? "workflow step completed")
        : `workflow batch ${batchIndex} completed`);
    workflowTask.progress = { completed, total: stepStates.length, label: "workflow" };
    workflowTask.updatedAt = stepEndedAt;
    workflowTask.lastOutputAt = stepEndedAt;
    workflowTask.hasOutput = true;
    await persistWorkflowRunState(context, context.workflows.activeRun, workflowTask);
    for (const item of results) {
      await context.store.appendEvent(sessionId, {
        type: "workflow_step_result",
        workflowId: runId,
        stepId: item.step.id,
        status: item.result.status,
        summary: item.result.summary,
        evidenceRefs: item.result.evidenceRefs,
        createdAt: stepEndedAt,
      });
    }
    await appendBackgroundTaskEvent(context, sessionId, workflowTask);

    if (terminal) {
      await finishWorkflowRun(
        runId,
        terminal.result.status,
        terminal.result.summary,
        context,
        sessionId,
        workflowTask,
      );
      return;
    }
  }

  await finishWorkflowRun(
    runId,
    "completed",
    "Workflow steps completed; result remains PARTIAL until verification/final gate evidence proves PASS.",
    context,
    sessionId,
    workflowTask,
  );
  writeLine(
    output,
    context.language === "en-US"
      ? "Workflow completed with PARTIAL result; no PASS evidence generated. Use /workflows status for details."
      : "workflow 已完成，结果仍为 PARTIAL；未生成 PASS 证据。可用 /workflows status 查看详情。",
  );
}

function isWorkflowRunTerminal(
  context: TuiContext,
  runId: string,
  task: BackgroundTaskState,
): boolean {
  const status =
    context.workflows.activeRun?.id === runId ? context.workflows.activeRun.status : undefined;
  return (
    status === "completed" ||
    status === "partial" ||
    status === "failed" ||
    status === "blocked" ||
    status === "cancelled" ||
    status === "stale" ||
    task.status === "completed" ||
    task.status === "failed" ||
    task.status === "cancelled" ||
    task.status === "timeout" ||
    task.status === "stale"
  );
}

function formatWorkflowRegistryList(context: TuiContext): string {
  const lines = [context.language === "en-US" ? "Workflow registry:" : "Workflow registry："];
  if (context.workflowRegistry.errors.length > 0 || context.agentRegistry.errors.length > 0) {
    lines.push("- registry schema errors:");
    for (const error of [...context.agentRegistry.errors, ...context.workflowRegistry.errors]) {
      lines.push(`  - ${error}`);
    }
  }
  if (
    context.workflowRegistry.workflows.length === 0 &&
    context.agentRegistry.agents.length === 0
  ) {
    lines.push(
      context.language === "en-US"
        ? "- no custom agents/workflows found under .linghun/agents or .linghun/workflows"
        : "- .linghun/agents 或 .linghun/workflows 下暂无自定义 agent/workflow",
    );
    return lines.join("\n");
  }
  for (const agent of context.agentRegistry.agents) {
    lines.push(`- agent:${agent.id} ${agent.name}: ${agent.description}`);
  }
  for (const workflow of context.workflowRegistry.workflows) {
    lines.push(`- ${workflow.id} ${workflow.name}: ${workflow.description}`);
  }
  return lines.join("\n");
}

function findRegistryWorkflow(
  context: TuiContext,
  id: string | undefined,
): RegistryWorkflowDefinition | undefined {
  if (!id) return undefined;
  return context.workflowRegistry.workflows.find((workflow) => workflow.id === id);
}

function findRegistryAgentWorkflow(
  context: TuiContext,
  id: string | undefined,
): RegistryAgentDefinition | undefined {
  if (!id?.startsWith("agent:")) return undefined;
  const agentId = id.slice("agent:".length);
  return context.agentRegistry.agents.find(
    (agent) => agent.id === agentId || agent.name === agentId,
  );
}

async function runRegistryAgentWorkflow(
  agent: RegistryAgentDefinition,
  goal: string,
  runInBackground: boolean,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const task = goal || agent.description;
  await handleForkCommand(
    [agent.id, task, ...(runInBackground ? ["--background"] : [])],
    context,
    output,
  );
}

async function runRegistryWorkflow(
  workflow: RegistryWorkflowDefinition,
  goal: string,
  runInBackground: boolean,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const sessionId = await ensureSession(context);
  const runId = `workflow-${workflow.id}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const stepStates: WorkflowStepState[] = workflow.steps.map((step) => ({
    id: step.id,
    title: formatRegistryWorkflowStepTitle(step),
    status: "queued",
    runtime:
      step.action === "verification"
        ? "verification"
        : step.action === "details"
          ? "details"
          : "agent",
    evidenceRefs: [],
  }));
  const task: BackgroundTaskState = {
    id: runId,
    kind: "job",
    title: `Workflow: ${truncateDisplay(workflow.name || "workflow", 50)}`,
    status: "running",
    currentStep: "workflow starting",
    progress: { completed: 0, total: stepStates.length, label: "workflow" },
    startedAt,
    updatedAt: startedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    result: "partial",
    userVisibleSummary: formatWorkflowBackgroundSummary({
      language: context.language,
      steps: stepStates.length,
      currentPhase: workflow.name,
      background: runInBackground || Boolean(workflow.runInBackground),
    }),
    nextAction: "查看 /workflows registry、/background 或 /details background。",
  };
  context.workflows.activeRun = {
    id: runId,
    goal: goal || workflow.description,
    planId: workflow.id,
    status: "running",
    steps: stepStates,
    startedAt,
    result: "partial",
  };
  rememberBackgroundTask(context, task);
  await persistWorkflowRunState(context, context.workflows.activeRun, task);
  await context.store.appendEvent(sessionId, {
    type: "workflow_start",
    workflow: {
      id: runId,
      goal: goal || workflow.description,
      planId: workflow.id,
      steps: stepStates,
    },
    createdAt: startedAt,
  });
  await appendBackgroundTaskEvent(context, sessionId, task);
  writeLine(
    output,
    formatWorkflowStartPrimary({
      language: context.language,
      steps: stepStates.length,
      currentPhase: workflow.name,
      background: runInBackground || Boolean(workflow.runInBackground),
    }),
  );
  if (runInBackground || workflow.runInBackground) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Workflow is running in the background. Use /background for details."
        : "workflow 正在后台运行。可用 /background 查看详情。",
    );
    setTimeout(() => {
      void executeRegistryWorkflowRun(
        workflow,
        goal,
        runId,
        stepStates,
        task,
        context,
        sessionId,
        createSilentOutput(),
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        void finishWorkflowRun(
          runId,
          "failed",
          `Registry workflow failed: ${message}`,
          context,
          sessionId,
          task,
        );
      });
    }, 0);
    return;
  }

  await executeRegistryWorkflowRun(
    workflow,
    goal,
    runId,
    stepStates,
    task,
    context,
    sessionId,
    output,
  );
}

async function executeRegistryWorkflowRun(
  workflow: RegistryWorkflowDefinition,
  goal: string,
  runId: string,
  stepStates: WorkflowStepState[],
  task: BackgroundTaskState,
  context: TuiContext,
  sessionId: string,
  output: Writable,
): Promise<void> {
  let completed = 0;
  for (const step of workflow.steps) {
    if (isWorkflowRunTerminal(context, runId, task)) return;
    const state = stepStates.find((item) => item.id === step.id);
    const started = new Date().toISOString();
    if (state) {
      state.status = "running";
      state.startedAt = started;
    }
    task.currentStep = formatRegistryWorkflowStepTitle(step);
    task.updatedAt = started;
    task.progress = { completed, total: stepStates.length, label: step.action };
    if (context.workflows.activeRun?.id === runId) {
      await persistWorkflowRunState(context, context.workflows.activeRun, task);
    }
    await appendBackgroundTaskEvent(context, sessionId, task);
    const result = await executeRegistryWorkflowStep(workflow, step, goal, context, output);
    if (isWorkflowRunTerminal(context, runId, task)) return;
    const ended = new Date().toISOString();
    if (state) {
      state.status = result.status;
      state.summary = result.summary;
      state.evidenceRefs = result.evidenceRefs;
      state.endedAt = ended;
    }
    if (result.status === "completed") completed += 1;
    task.currentStep = result.summary;
    task.updatedAt = ended;
    task.lastOutputAt = ended;
    task.hasOutput = true;
    task.progress = { completed, total: stepStates.length, label: step.action };
    if (context.workflows.activeRun?.id === runId) {
      await persistWorkflowRunState(context, context.workflows.activeRun, task);
    }
    await appendBackgroundTaskEvent(context, sessionId, task);
    if (result.status !== "completed") {
      await finishWorkflowRun(runId, result.status, result.summary, context, sessionId, task);
      return;
    }
  }
  if (isWorkflowRunTerminal(context, runId, task)) return;
  await finishWorkflowRun(
    runId,
    "completed",
    "Registry workflow completed; result remains PARTIAL until verification/final gate evidence proves PASS.",
    context,
    sessionId,
    task,
  );
}

async function executeRegistryWorkflowStep(
  workflow: RegistryWorkflowDefinition,
  step: RegistryWorkflowDefinition["steps"][number],
  goal: string,
  context: TuiContext,
  output: Writable,
): Promise<{
  status: WorkflowStepTerminalStatus;
  summary: string;
  evidenceRefs: string[];
}> {
  const beforeEvidence = context.evidence.map((item) => item.id);
  try {
    if (step.action === "agent") {
      const role = step.role ?? "worker";
      const task = step.task ?? (goal || workflow.description);
      const previousAgentIds = new Set(context.agents.map((agent) => agent.id));
      await handleForkCommand([role, task], context, output);
      const agent = context.agents.find((item) => !previousAgentIds.has(item.id));
      if (!agent) {
        return {
          status: "blocked",
          summary: formatWorkflowStepSummary(
            step.id,
            "blocked",
            context.language === "en-US"
              ? "agent runtime did not start; step is waiting for runtime/resource availability"
              : "agent runtime 未启动；步骤正在等待 runtime/resource 可用",
            context.language,
          ),
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (agent.status === "failed") {
        return {
          status: "failed",
          summary: formatWorkflowStepSummary(step.id, "failed", agent.summary, context.language),
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (agent.status === "blocked" || agent.status === "stale" || agent.status === "cancelled") {
        return {
          status: agent.status === "cancelled" ? "cancelled" : "blocked",
          summary: formatWorkflowStepSummary(step.id, "blocked", agent.summary, context.language),
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
    } else if (step.action === "verification") {
      const report = await runWorkflowVerificationStep(step.level ?? "focused", context, output);
      const status = workflowStepStatusFromVerification(report.status);
      if (status !== "completed") {
        return {
          status,
          summary: formatWorkflowStepSummary(
            step.id,
            status,
            `verification ${report.status}: ${report.summary}`,
            context.language,
          ),
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
    } else if (step.action === "details") {
      await handleSlashCommand("/details", context, output);
    } else if (step.action === "index") {
      await handleSlashCommand("/index status", context, output);
    } else if (step.action === "bash") {
      if (!step.command)
        return {
          status: "blocked",
          summary: `workflow step ${step.id} blocked: missing command`,
          evidenceRefs: [],
        };
      await handleToolCommand("Bash", [step.command], context, output);
    } else if (step.action === "write") {
      return {
        status: "blocked",
        summary: formatWorkflowStepSummary(
          step.id,
          "blocked",
          context.language === "en-US"
            ? "write registry step requires existing Write tool input and is not auto-synthesized"
            : "write registry step 需要现有 Write 工具输入，不能自动合成",
          context.language,
        ),
        evidenceRefs: [],
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      summary: formatWorkflowStepSummary(step.id, "failed", message, context.language),
      evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
    };
  }
  return {
    status: "completed",
    summary: formatWorkflowStepSummary(
      step.id,
      "completed",
      context.language === "en-US"
        ? `completed via registry ${step.action}`
        : `已通过 registry ${step.action} 完成`,
      context.language,
    ),
    evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
  };
}

function formatWorkflowStepSummary(
  stepId: string,
  status: WorkflowStepState["status"],
  detail: string,
  language: TuiContext["language"],
): string {
  if (language === "en-US") {
    return `Workflow step ${stepId} ${status}: ${detail}`;
  }
  const statusText =
    status === "completed"
      ? "已完成"
      : status === "failed"
        ? "失败"
        : status === "cancelled"
          ? "已取消"
          : status === "stale"
            ? "已过期"
            : status === "partial"
              ? "部分完成"
              : "受阻";
  return `工作流步骤 ${stepId} ${statusText}：${detail}`;
}

type WorkflowStepTerminalStatus = Extract<
  WorkflowStepState["status"],
  "completed" | "partial" | "failed" | "blocked" | "cancelled" | "stale"
>;

function workflowStepStatusFromVerification(
  status: VerificationReport["status"],
): WorkflowStepTerminalStatus {
  if (status === "pass") return "completed";
  if (status === "partial") return "partial";
  if (status === "cancelled") return "cancelled";
  if (status === "stale") return "stale";
  return "failed";
}

function workflowStepStatusFromNestedJob(job: DurableJobState): WorkflowStepTerminalStatus {
  const resultStatus = job.result?.status;
  if (job.status === "failed" || job.status === "timeout") return "failed";
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "blocked" || job.status === "sleeping" || job.status === "stale") {
    return "blocked";
  }
  if (resultStatus === "failed" || resultStatus === "timeout" || resultStatus === "overbudget") {
    return "failed";
  }
  if (resultStatus === "cancelled") return "cancelled";
  if (resultStatus === "blocked" || resultStatus === "stale") return "blocked";
  return "completed";
}

async function executeWorkflowStep(
  request: WorkflowBridgeRequestProposal,
  context: TuiContext,
  output: Writable,
  workflowRunId?: string,
  workflowRunningCap?: number,
): Promise<{
  status: WorkflowStepTerminalStatus;
  summary: string;
  evidenceRefs: string[];
}> {
  const capability = decideWorkflowStepCapability({
    permissionMode: context.permissionMode,
    phaseStopPointConfirmed: true,
    target:
      request.safety.mutating || request.request
        ? ({ kind: "details", view: "evidence", mutating: request.safety.mutating } as never)
        : undefined,
    request: request.request,
  });
  if (!capability.ok || !request.executable || !request.request) {
    const summary = formatWorkflowStepSummary(
      request.sliceId,
      "blocked",
      !capability.ok && capability.reason.includes("plan mode")
        ? capability.reason
        : request.reason,
      context.language,
    );
    await captureWorkflowFailureLearning(request, summary, context);
    return { status: "blocked", summary, evidenceRefs: request.taskSurfaceInput.evidenceRefs };
  }
  const beforeEvidence = context.evidence.map((item) => item.id);
  const req = request.request;
  try {
    if (request.sliceId === "slice-architecture-review") {
      return await executeWorkflowArchitectureReviewStep(request, context);
    }
    if (req.mainChain === "fork") {
      const activeWorkflowAgents =
        workflowRunId && workflowRunningCap
          ? context.backgroundTasks.filter(
              (task) =>
                task.kind === "agent" &&
                task.workflowRunId === workflowRunId &&
                isRuntimeActiveBackgroundTask(task),
            ).length
          : 0;
      if (workflowRunningCap && activeWorkflowAgents >= workflowRunningCap) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          `workflow runningCap ${workflowRunningCap} reached; wait for existing workflow agents before starting another /fork`,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "blocked",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      const previousAgentIds = new Set(context.agents.map((agent) => agent.id));
      await handleForkCommand([req.role, req.task], context, output, { workflowRunId });
      const agent = context.agents.find((item) => !previousAgentIds.has(item.id));
      const agentTask = agent
        ? context.backgroundTasks.find((task) => task.id === agent.id)
        : undefined;
      if (agentTask && workflowRunId) {
        agentTask.workflowRunId = workflowRunId;
        await appendBackgroundTaskEvent(context, await ensureSession(context), agentTask);
      }
      if (!agent) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          context.language === "en-US"
            ? "agent runtime did not start; step is waiting for runtime/resource availability"
            : "agent runtime 未启动；步骤正在等待 runtime/resource 可用",
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "blocked",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (!agentTask) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          context.language === "en-US"
            ? `agent runtime ${agent.id} has no background task; treating step as waiting/resource blocked`
            : `agent runtime ${agent.id} 没有后台任务；步骤按 waiting/resource blocked 处理`,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "blocked",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (agent?.status === "failed") {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "failed",
          agent.summary,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "failed",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (agent?.status === "blocked" || agent?.summary.includes("权限管道拒绝")) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          agent.summary,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "blocked",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
    } else if (req.mainChain === "verification") {
      const report = await runWorkflowVerificationStep(req.level, context, output);
      const status = workflowStepStatusFromVerification(report.status);
      if (status !== "completed") {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          status,
          `verification ${report.status}: ${report.summary}`,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status,
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
    } else if (req.mainChain === "details") {
      await handleSlashCommand(formatWorkflowDetailsSlashCommand(req), context, output);
    } else if (req.mainChain === "agents") {
      await handleAgentsCommand([req.action, req.agentRef ?? ""].filter(Boolean), context, output);
    } else if (req.mainChain === "job") {
      const beforeJobIds = new Set((await listDurableJobs(context)).map((job) => job.id));
      if (req.action === "run" || req.action === "create") {
        await runNestedWorkflowJobCommand(
          [
            req.action,
            req.goal ?? request.taskSurfaceInput.nextAction,
            "--phase",
            req.phase,
            "--target",
            req.target,
            ...(req.maxTokens ? ["--tokens", String(req.maxTokens)] : []),
            ...(req.maxDurationMs ? ["--timeout", String(req.maxDurationMs)] : []),
            ...(req.runningCap ? ["--running-cap", String(req.runningCap)] : []),
            ...(req.requestedAgents && req.requestedAgents > 1
              ? ["--multi-agent", "--agents", String(req.requestedAgents)]
              : []),
          ],
          context,
          output,
        );
      } else {
        await runNestedWorkflowJobCommand(
          [req.action, req.jobRef ?? ""].filter(Boolean),
          context,
          output,
        );
      }
      const jobs = await listDurableJobs(context);
      const job =
        jobs.find((item) => !beforeJobIds.has(item.id)) ??
        (req.jobRef
          ? jobs.find((item) => item.id === req.jobRef || item.id.endsWith(req.jobRef ?? ""))
          : undefined) ??
        jobs[0];
      if (!job) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          context.language === "en-US"
            ? "nested job did not persist state"
            : "嵌套 job 未持久化 state",
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return { status: "blocked", summary, evidenceRefs: request.taskSurfaceInput.evidenceRefs };
      }
      const nestedStatus = workflowStepStatusFromNestedJob(job);
      if (nestedStatus !== "completed") {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          nestedStatus,
          `nested job ${job.id} ${job.status}${job.result?.status ? ` result ${job.result.status}` : ""}: ${job.pauseReason ?? job.result?.summary ?? "not runnable"}`,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: nestedStatus,
          summary,
          evidenceRefs: mergeWorkflowEvidenceRefs(
            newWorkflowEvidenceRefs(beforeEvidence, context),
            job.evidenceRefs.map((item) => item.id),
          ),
        };
      }
      return {
        status: "completed",
        summary: formatWorkflowStepSummary(
          request.sliceId,
          "completed",
          `nested job lifecycle ${job.id} ${job.status}; workflow result remains PARTIAL; persisted state ${getDurableJobStatePath(job)}`,
          context.language,
        ),
        evidenceRefs: mergeWorkflowEvidenceRefs(
          newWorkflowEvidenceRefs(beforeEvidence, context),
          job.evidenceRefs.map((item) => item.id),
        ),
      };
    } else {
      const summary = formatWorkflowStepSummary(
        request.sliceId,
        "blocked",
        context.language === "en-US" ? "unsupported nested job request" : "不支持嵌套 job 请求",
        context.language,
      );
      await captureWorkflowFailureLearning(request, summary, context);
      return { status: "blocked", summary, evidenceRefs: request.taskSurfaceInput.evidenceRefs };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summary = formatWorkflowStepSummary(request.sliceId, "failed", message, context.language);
    await captureWorkflowFailureLearning(request, summary, context);
    return {
      status: "failed",
      summary,
      evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
    };
  }
  return {
    status: "completed",
    summary: formatWorkflowStepSummary(
      request.sliceId,
      "completed",
      context.language === "en-US"
        ? `completed via ${req.mainChain}`
        : `已通过 ${req.mainChain} 完成`,
      context.language,
    ),
    evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
  };
}

function formatWorkflowDetailsSlashCommand(
  req: Extract<WorkflowMainChainRequest, { mainChain: "details" }>,
): string {
  const ref = req.refs.find((item) => item.trim().length > 0);
  if ((req.view === "evidence" || req.view === "background") && ref) {
    return `/details ${req.view} ${ref}`;
  }
  return "/details";
}

async function executeWorkflowArchitectureReviewStep(
  request: WorkflowBridgeRequestProposal,
  context: TuiContext,
): Promise<{
  status: WorkflowStepTerminalStatus;
  summary: string;
  evidenceRefs: string[];
}> {
  const sessionId = await ensureSession(context);
  const candidates = await selectWorkflowArchitectureReviewFiles(context);
  if (candidates.length === 0) {
    const evidence = createEvidenceRecord(
      "command_output",
      "workflow architecture review skipped: no project source files available for boundary check",
      "workflow-architecture-review:no-files",
      ["architecture_boundary_check", "workflow_slice_architecture_review", "partial_evidence"],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendSystemEvent(
      context,
      sessionId,
      `workflow architecture review: slice ${request.sliceId}; status partial; evidence ${evidence.id}; files 0; reason no files`,
      "warning",
    );
    return {
      status: "partial",
      summary: formatWorkflowStepSummary(
        request.sliceId,
        "partial",
        "architecture boundary check skipped: no project source files found; continue readonly workflow with partial evidence",
        context.language,
      ),
      evidenceRefs: [evidence.id],
    };
  }

  const metrics = [];
  const scannedFiles: string[] = [];
  for (const relativePath of candidates) {
    try {
      const source = await readFile(resolve(context.projectPath, relativePath), "utf8");
      metrics.push(estimateFileMetrics(relativePath, source));
      scannedFiles.push(relativePath);
    } catch {
      // Missing optional workflow files should not hide the result for files that were scanned.
    }
  }

  if (metrics.length === 0) {
    const evidence = createEvidenceRecord(
      "command_output",
      `workflow architecture review skipped: candidate files unreadable (${candidates.join(", ")})`,
      "workflow-architecture-review:unreadable",
      ["architecture_boundary_check", "workflow_slice_architecture_review", "partial_evidence"],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendSystemEvent(
      context,
      sessionId,
      `workflow architecture review: slice ${request.sliceId}; status partial; evidence ${evidence.id}; files 0; reason unreadable`,
      "warning",
    );
    return {
      status: "partial",
      summary: formatWorkflowStepSummary(
        request.sliceId,
        "partial",
        "architecture boundary check skipped: no readable project source files; continue readonly workflow with partial evidence",
        context.language,
      ),
      evidenceRefs: [evidence.id],
    };
  }

  const check = checkBoundaries(metrics);
  const status: WorkflowStepTerminalStatus = check.violations.length > 0 ? "partial" : "completed";
  const riskKinds = Array.from(new Set(check.violations.map((item) => item.kind)));
  const evidence = createEvidenceRecord(
    "command_output",
    `workflow architecture boundary check ${check.summary}; files ${scannedFiles.length}; risks ${riskKinds.join(",") || "none"}`,
    `workflow-architecture-review:${request.workflowId}:${request.phaseId}:${request.sliceId}`,
    [
      "architecture_boundary_check",
      "workflow_slice_architecture_review",
      status === "completed" ? "architecture_boundary_clean" : "needs_review",
      ...riskKinds.map((kind) => `architecture_risk:${kind}`),
    ],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
  await appendSystemEvent(
    context,
    sessionId,
    `workflow architecture review: slice ${request.sliceId}; status ${status}; evidence ${evidence.id}; files ${scannedFiles.join(",")}; summary ${check.summary}`,
    status === "completed" ? "info" : "warning",
  );

  return {
    status,
    summary: formatWorkflowStepSummary(
      request.sliceId,
      status,
      status === "partial"
        ? `architecture boundary risks found (${check.summary}); continue readonly workflow with evidence ${evidence.id}`
        : `architecture boundary check ${check.summary}; evidence ${evidence.id}`,
      context.language,
    ),
    evidenceRefs: [evidence.id],
  };
}

async function selectWorkflowArchitectureReviewFiles(context: TuiContext): Promise<string[]> {
  const files = new Set<string>();
  for (const file of [...context.tools.changedFiles, ...context.recentlyMentionedFiles]) {
    const normalized = file.replace(/\\/g, "/");
    if (!/\.(?:ts|tsx|js|jsx)$/u.test(normalized)) continue;
    files.add(normalized);
  }
  if (files.size < WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) {
    for (const discovered of await discoverWorkflowArchitectureReviewFiles(context.projectPath)) {
      files.add(discovered);
      if (files.size >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) break;
    }
  }
  for (const file of [
    "packages/tui/src/index.ts",
    "packages/tui/src/workflow-planner-entry.ts",
    "packages/tui/src/workflow-task-surface.ts",
    "packages/tui/src/workflow-agent-runtime-bridge.ts",
  ]) {
    if (files.size >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) break;
    if (canReadProjectFile(context.projectPath, file)) files.add(file);
  }
  return Array.from(files).slice(0, WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT);
}

async function discoverWorkflowArchitectureReviewFiles(projectPath: string): Promise<string[]> {
  const roots = ["src", "packages", "apps", "."];
  const discovered: string[] = [];
  for (const root of roots) {
    await discoverWorkflowArchitectureReviewFilesUnder(
      projectPath,
      root,
      root === "." ? 1 : 4,
      discovered,
    );
    if (discovered.length >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) break;
  }
  return discovered.slice(0, WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT);
}

async function discoverWorkflowArchitectureReviewFilesUnder(
  projectPath: string,
  relativeRoot: string,
  depth: number,
  discovered: string[],
): Promise<void> {
  if (depth < 0 || discovered.length >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) return;
  const entries = await readdir(resolve(projectPath, relativeRoot), { withFileTypes: true }).catch(
    () => undefined,
  );
  if (!entries) return;
  for (const entry of entries) {
    if (discovered.length >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) return;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const relativePath = relativeRoot === "." ? entry.name : `${relativeRoot}/${entry.name}`;
    if (entry.isFile() && /\.(?:ts|tsx|js|jsx)$/u.test(entry.name)) {
      discovered.push(relativePath);
      continue;
    }
    if (entry.isDirectory()) {
      await discoverWorkflowArchitectureReviewFilesUnder(
        projectPath,
        relativePath,
        depth - 1,
        discovered,
      );
    }
  }
}

function canReadProjectFile(projectPath: string, path: string): boolean {
  try {
    accessSync(resolve(projectPath, path), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function getCurrentWorkflowStepRequest(
  plan: NormalizedWorkflowPlan,
  phaseId: string,
  steps: WorkflowStepState[],
  stepId: string,
  options: RunWorkflowExecutionOptions = {},
): WorkflowBridgeRequestProposal {
  const satisfied = new Map(
    steps
      .filter((step) => step.status === "completed" || step.status === "partial")
      .map((step) => [step.id, step.status] as const),
  );
  const runningPlan: NormalizedWorkflowPlan = {
    ...plan,
    currentPhaseId: phaseId,
    phases: plan.phases.map((phase) => ({
      ...phase,
      status: phase.id === phaseId ? "running" : (phase.status ?? "pending"),
      slices: phase.slices.map((slice) => ({
        ...slice,
        allowedToolClasses: slice.allowedToolClasses ?? [],
        evidence: slice.evidence ?? [],
        references: slice.references ?? [],
        status:
          slice.id === stepId
            ? "queued"
            : satisfied.get(slice.id) === "partial"
              ? "partial"
              : satisfied.has(slice.id)
                ? "completed"
                : slice.status === "blocked"
                  ? "queued"
                  : (slice.status ?? "queued"),
        dependsOnSliceIds: slice.dependsOnSliceIds ?? [],
        independent: slice.independent === true,
        canRunInParallel: slice.canRunInParallel === true,
      })),
    })),
  };
  const bridge = bridgeWorkflowPlanToMainChainRequests(runningPlan, {
    currentPhaseId: phaseId,
    confirmedPhaseStopPoints: [phaseId],
    runningCap: normalizeWorkflowRunningCap(options.runningCap ?? plan.budget.maxRunningAgents),
  });
  return (
    bridge.requests.find((request) => request.sliceId === stepId) ?? {
      id: `${plan.id}:${phaseId}:${stepId}`,
      proposalOnly: true,
      workflowId: plan.id,
      phaseId,
      sliceId: stepId,
      status: "blocked",
      reason: "workflow step missing from bridge request set",
      executable: false,
      request: null,
      safety: {
        readonly: true,
        mutating: false,
        requiresStartGate: false,
        requiresPermissionPipeline: false,
        requiredPermissionAction: "none",
        evidencePolicy: "neverTreatCompletionAsPass",
      },
      handoffProposal: {
        boundedRefs: [],
        workspaceCacheRefs: [],
        evidenceRefs: [],
        keyFilesSummary: [],
        droppedRefKinds: [],
        notIncluded: [],
      },
      backgroundProjection: {
        source: "background-task-projection",
        kind: "job",
        userVisibleSummary: "workflow step missing from bridge request set",
        nextAction: "Inspect workflow plan.",
      },
      taskSurfaceInput: {
        phaseId,
        sliceId: stepId,
        requestStatus: "blocked",
        evidenceRefs: [],
        nextAction: "Inspect workflow plan.",
      },
    }
  );
}

function selectRunnableWorkflowBatch(
  plan: NormalizedWorkflowPlan,
  phaseId: string,
  steps: WorkflowStepState[],
  options: RunWorkflowExecutionOptions,
): WorkflowBatchItem[] {
  const cap = normalizeWorkflowRunningCap(options.runningCap ?? plan.budget.maxRunningAgents);
  const batch: WorkflowBatchItem[] = [];
  const candidates = steps.filter((step) => {
    if (step.status !== "queued") return false;
    const deps = step.dependsOnSliceIds ?? [];
    return deps.every((depId) => {
      const dep = steps.find((item) => item.id === depId);
      return dep?.status === "completed" || dep?.status === "partial";
    });
  });
  for (const step of candidates) {
    if (batch.length >= cap) {
      break;
    }
    const request = getCurrentWorkflowStepRequest(plan, phaseId, steps, step.id, options);
    if (!request.executable || !request.request) {
      return [{ step, request }];
    }
    const mutating = request.safety.mutating;
    if (mutating && batch.filter((item) => item.request.safety.mutating).length >= cap) {
      continue;
    }
    if (
      batch.length > 0 &&
      (mutating || !step.independent || step.canRunInParallel !== true)
    ) {
      break;
    }
    batch.push({ step, request });
    if (mutating || !step.independent || step.canRunInParallel !== true) {
      break;
    }
  }
  return batch;
}

function normalizeWorkflowRunningCap(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) {
    return DEFAULT_JOB_RUNNING_AGENT_CAP;
  }
  return Math.max(1, Math.floor(value));
}

async function runWorkflowVerificationStep(
  level: "smoke" | "focused" | "typecheck" | "test" | "build" | "lint",
  context: TuiContext,
  output: Writable,
): Promise<VerificationReport> {
  const sessionId = await ensureSession(context);
  const plan =
    level === "smoke" || level === "focused"
      ? await createVerificationPlan(context.projectPath, "smoke")
      : (await createVerificationPlan(context.projectPath, "default")).filter(
          (step) => step.kind === level,
        );
  const effectivePlan =
    plan.length > 0 ? plan : await createVerificationPlan(context.projectPath, "smoke");
  const report = await runVerificationPlan(
    effectivePlan,
    context,
    sessionId,
    output,
    appendBackgroundTaskEvent,
  );
  context.lastVerification = report;
  await recordVerificationEvidence(context, sessionId, report);
  return report;
}

async function runNestedWorkflowJobCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const workflowTaskIndex = context.backgroundTasks.findIndex(
    (task) => task.kind === "job" && task.id.startsWith("workflow-") && task.status === "running",
  );
  if (workflowTaskIndex < 0) {
    await handleJobCommand(args, context, output);
    return;
  }
  const [workflowTask] = context.backgroundTasks.splice(workflowTaskIndex, 1);
  try {
    await handleJobCommand(args, context, output);
  } finally {
    if (workflowTask && !context.backgroundTasks.some((task) => task.id === workflowTask.id)) {
      rememberBackgroundTask(context, workflowTask);
    }
  }
}

async function finishWorkflowRun(
  runId: string,
  status: WorkflowStepTerminalStatus,
  summary: string,
  context: TuiContext,
  sessionId: string,
  task: BackgroundTaskState,
): Promise<void> {
  const now = new Date().toISOString();
  if (context.workflows.activeRun?.id === runId) {
    context.workflows.activeRun.status = status;
    context.workflows.activeRun.endedAt = now;
    context.workflows.activeRun.result = status === "completed" ? "partial" : status;
    for (const step of context.workflows.activeRun.steps) {
      if (step.status !== "running") continue;
      step.status = status;
      step.endedAt = now;
      step.summary = summary;
    }
  }
  task.status =
    status === "completed"
      ? "completed"
      : status === "partial"
        ? "completed"
        : status === "stale"
          ? "stale"
          : status === "cancelled"
            ? "cancelled"
            : "failed";
  task.result =
    status === "completed" || status === "partial" || status === "blocked"
      ? "partial"
      : status === "cancelled"
        ? "cancelled"
        : status === "stale"
          ? "stale"
          : "fail";
  task.currentStep = summary;
  task.updatedAt = now;
  task.lastOutputAt = now;
  task.userVisibleSummary = task.userVisibleSummary || summary;
  task.nextAction =
    status === "completed" || status === "partial"
      ? "Review verification evidence; do not treat workflow completion as PASS."
      : "Inspect /failures and rerun after fixing the failed step.";
  if (context.workflows.activeRun?.id === runId) {
    await persistWorkflowRunState(context, context.workflows.activeRun, task);
  }
  await appendBackgroundTaskEvent(context, sessionId, task);
  await context.store.appendEvent(sessionId, {
    type: "workflow_end",
    workflowId: runId,
    status,
    summary,
    createdAt: now,
  });
  if (status !== "completed" && status !== "cancelled") {
    await captureFailureLearning(context, sessionId, {
      category: "tool_failure",
      failureSummary: summary,
      rootCauseGuess: "workflow step failed or blocked before all planned steps completed",
      avoidNextTime:
        "Inspect the failed workflow step and existing runtime evidence before rerunning; do not claim workflow PASS",
      sourceRef: `workflow:${runId}`,
      relatedTarget: "workflow",
      severity: "medium",
    });
  }
}

async function captureWorkflowFailureLearning(
  request: WorkflowBridgeRequestProposal,
  summary: string,
  context: TuiContext,
): Promise<void> {
  await captureFailureLearning(context, await ensureSession(context), {
    category: "tool_failure",
    failureSummary: summary,
    rootCauseGuess: `workflow step ${request.sliceId} did not complete through the main chain`,
    avoidNextTime:
      "Fix the blocked workflow step and rerun; do not rely on projected task surface state",
    sourceRef: `workflow-step:${request.workflowId}:${request.sliceId}`,
    relatedTarget: "workflow",
    severity: "medium",
  });
}

function workflowRuntimeKind(request: WorkflowBridgeRequestProposal): WorkflowStepState["runtime"] {
  if (request.request?.mainChain === "job") return "job";
  if (request.request?.mainChain === "verification") return "verification";
  if (request.request?.mainChain === "details") return "details";
  return "agent";
}

function findWorkflowSliceTitle(plan: NormalizedWorkflowPlan, sliceId: string): string {
  return (
    plan.phases.flatMap((phase) => phase.slices).find((slice) => slice.id === sliceId)?.title ??
    sliceId
  );
}

function newWorkflowEvidenceRefs(before: string[], context: TuiContext): string[] {
  const seen = new Set(before);
  return context.evidence.map((item) => item.id).filter((id) => !seen.has(id));
}

function mergeWorkflowEvidenceRefs(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().filter(Boolean)));
}

async function recordWorkflowPlanPreviewEvidence(
  context: TuiContext,
  sessionId: string,
  result: Extract<WorkflowPlannerEntryResult, { ok: true }>,
): Promise<void> {
  const evidence = createEvidenceRecord(
    "user_provided",
    `workflow plan preview: ${result.plan.title}; evidence merge ${result.surface.evidenceMergeSummary}; requests runnable ${result.bridgeResult.summary.runnable}; start gate ${result.bridgeResult.summary.startGateNeeded}; blocked ${result.bridgeResult.summary.blocked}`,
    `workflow-plan-preview:${result.plan.id}`,
    [
      "workflow_plan_preview",
      "workflow_preview_only",
      `workflow_evidence_merge:${result.surface.evidenceMergeSummary}`,
    ],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
  await appendSystemEvent(
    context,
    sessionId,
    `workflow plan preview: evidence ${evidence.id}; plan ${result.plan.id}; preview only yes; pass evidence no`,
    "info",
  );
}

function summarizeWorkflowCacheFreshness(freshness: CacheFreshness): string {
  const changed =
    freshness.changedKeys.length > 0
      ? `changed ${freshness.changedKeys.slice(0, 5).join(", ")}`
      : "changed none";
  return `cache freshness ${changed}`;
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
    const onKeypress = (str: string, key: { name?: string } = {}) => {
      const name = key.name;
      const value = str.trim().toLowerCase();
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
    const onKeypress = (str: string, key: { name?: string } = {}) => {
      const name = key.name;
      const value = str.trim().toLowerCase();
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

export async function handleTuiKeypress(
  key: "escape" | "return" | "shift-tab",
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (key === "escape") {
    if (context.ctrlOExpandState?.active) {
      context.ctrlOExpandState = { active: false };
      return;
    }
    await cancelPendingInteraction(context, output, "Esc");
    return;
  }
  if (key === "shift-tab") {
    await cycleMode(context, output);
    const continued = await reevaluatePendingLocalApprovalAfterModeChange(
      context,
      context.modelGateway,
      output,
    );
    if (continued) {
      writeStatus(output, context);
    }
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
    } else if (approval.kind === "git_worktree_remove") {
      writeLine(output, `已取消删除 worktree；「${approval.name}」未被删除。可调整请求后重试。`);
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
  if (hasActiveInterruptibleWork(context)) {
    if (!context.notifications) context.notifications = [];
    context.notifications.push({
      key: `esc-no-interrupt:${Date.now()}`,
      text:
        context.language === "en-US"
          ? "Esc does not stop tasks; press Ctrl+C or run /interrupt to stop."
          : "Esc 不会停止任务；按 Ctrl+C 或 /interrupt 停止。",
      priority: "medium",
      timeoutMs: 4000,
      createdAt: Date.now(),
      tone: "dim",
    });
  }
}

async function reevaluatePendingLocalApprovalAfterModeChange(
  context: TuiContext,
  gateway: ModelGateway | undefined,
  output: Writable,
): Promise<boolean> {
  const approval = context.pendingLocalApproval;
  if (!approval || approval.kind !== "model_tool_use") return false;
  const permission = await decidePermission(
    approval.toolName,
    approval.toolCall.input,
    context,
    approval.sessionId,
  );
  approval.verdict = permission.verdict;
  if (permission.decision !== "allow") return false;
  context.pendingLocalApproval = undefined;
  await executePermissionApprove(approval, context, gateway, output);
  return true;
}

function hasActiveInterruptibleWork(context: TuiContext): boolean {
  if (context.activeAbortController) return true;
  if (context.activeVerificationAbortController) return true;
  if (context.backgroundAbortControllers && context.backgroundAbortControllers.size > 0)
    return true;
  if (context.interrupt?.type === "running") return true;
  if (
    context.backgroundTasks.some(
      (task) =>
        isRuntimeActiveBackgroundTask(task) ||
        task.status === "paused" ||
        task.status === "blocked",
    )
  ) {
    return true;
  }
  const workflowStatus = context.workflows.activeRun?.status;
  return workflowStatus === "running" || workflowStatus === "blocked";
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
    `- 允许范围：durable job + background + runner fallback；allow edit ${pending.allowEdit ? "yes" : "no"}；allow bash ${pending.allowBash ? "yes" : "no"}`,
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
  await setPermissionMode(context, output, nextMode, `mode command -> ${nextMode}`);
}

async function cycleMode(context: TuiContext, output: Writable): Promise<void> {
  const modes: PermissionMode[] = ["default", "auto-review", "plan", "full-access"];
  const index = modes.indexOf(context.permissionMode);
  const nextMode = modes[(index + 1) % modes.length] ?? "default";
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
          "- Shift+Tab cycles modes directly; /mode <mode> switches directly.",
          "- switching mode does not bypass hard denies; dangerous actions still go through the permission pipeline.",
        ].join("\n")
      : [
          "模式切换",
          `- 当前：${context.permissionMode}`,
          "- 可选：default / auto-review / plan / full-access",
          "- Shift+Tab 会直接循环切换模式；/mode <mode> 可直接切换。",
          "- 切换模式不等于绕过硬拒绝；危险动作仍受权限底座约束。",
        ].join("\n"),
  );
  writeStatus(output, context);
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
    `permission mode change: ${previousMode} -> ${nextMode}; reason ${reason}; boundary Start Gate and permission pipeline remain active`,
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
      `plan approved: proposal ${context.activePlan.id}; option ${optionId}; boundary ${boundary}; note does not authorize all tools`,
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
  if (approval.kind === "agent_tool_use") {
    const agent = context.agents.find((item) => item.id === approval.agentId);
    if (!agent) {
      const evidence = await recordToolFailureEvidence(
        context,
        approval.sessionId,
        approval.toolName,
        `agent approval target missing: ${approval.agentId}`,
      );
      await appendToolResultEvent(
        context,
        approval.sessionId,
        approval.toolCall.id,
        approval.toolName,
        `agent ${approval.agentId} is no longer available; ${approval.toolName} was not executed.`,
        true,
        evidence.id,
      );
      writeLine(output, `agent ${approval.agentId} 不存在，未执行 ${approval.toolName}。`);
      writeStatus(output, context);
      return;
    }
    const result = await executeApprovedAgentToolUse(
      agent,
      approval.toolCall,
      approval.toolName,
      context,
      approval.sessionId,
    );
    await appendToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolName,
      result.text,
      !result.ok,
      result.evidenceId,
    );
    writeLine(
      output,
      result.ok
        ? `agent ${agent.id} 已执行 ${approval.toolName}；子 agent 已继续处理，当前状态 ${agent.status}。可检查 /agents show ${agent.id}。`
        : `agent ${agent.id} 执行 ${approval.toolName} 失败：${truncateDisplay(result.text, 160)}`,
    );
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "index_ignore_write") {
    const written = await executeIndexIgnoreWritePlan(approval.plan, context, output);
    if (written) {
      await runIndexRepository(context, context.config.index.mode, "refresh", false, output);
      if (!context.index.safetyWarning) {
        writeLine(output, formatIndexRefreshSummary(context));
      }
    }
    if (!context.isInkSession) writeStatus(output, context);
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
    await recordModelToolFailureForMetaScheduler(context, approval.sessionId, result);
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
      approval.boundaryPreflight
        ? formatBoundaryEditPreflightPrompt(approval.boundaryPreflight, context.language)
        : undefined,
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
  if (approval.kind === "git_worktree_remove") {
    await resolveWorktreeRemoveApprove(
      approval,
      context,
      output,
      createWorktreeRemoveResolveDeps(gateway),
    );
    return;
  }
  if (approval.kind === "git_stable_point") {
    // D.14D-R2 P1-1 — 用户确认后真实创建稳定点，并把工具结果回灌模型续轮。
    await resolveStablePointApprove(
      approval,
      context,
      output,
      createWorktreeRemoveResolveDeps(gateway),
    );
    return;
  }
  if (approval.kind === "index_tool") {
    // D.14D-R P0-2 — 用户确认后真实刷新/修复索引，并把工具结果回灌模型续轮。
    const result = await executeApprovedIndexToolUse(
      approval.toolCall,
      approval.indexAction,
      approval.force,
      context,
      approval.sessionId,
      output,
    );
    if (gateway && approval.continuation) {
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(result),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
    }
    if (!context.isInkSession) {
      writeLightHints(output, context);
      writeStatus(output, context);
    }
    return;
  }
  if (approval.kind === "report_write_tool") {
    const result = await executeApprovedModelToolUse(
      { ...approval.toolCall, name: "Write" },
      "Write",
      context,
      approval.sessionId,
      output,
      undefined,
      approval.continuation?.reportWriteGuard,
    );
    if (gateway && approval.continuation) {
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(result),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
    }
    if (!context.isInkSession) {
      writeLightHints(output, context);
      writeStatus(output, context);
    }
    return;
  }
  if (approval.kind === "memory_mutation") {
    await executeMemoryMutation(context, output, approval.mutation);
    if (!context.isInkSession) writeStatus(output, context);
    return;
  }
  if (approval.kind === "break_cache_mutation") {
    await executeBreakCacheMutation(approval.action, context, output);
    if (!context.isInkSession) writeStatus(output, context);
    return;
  }
  if (approval.kind === "image_generation") {
    await executeImageGeneration(approval, context, output);
    if (!context.isInkSession) writeStatus(output, context);
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
  if (approval.kind === "agent_tool_use") {
    const agent = context.agents.find((item) => item.id === approval.agentId);
    if (!agent) {
      const evidence = await recordToolFailureEvidence(
        context,
        approval.sessionId,
        approval.toolName,
        `agent approval target missing after deny: ${approval.agentId}`,
      );
      await appendToolResultEvent(
        context,
        approval.sessionId,
        approval.toolCall.id,
        approval.toolName,
        `agent ${approval.agentId} is no longer available; ${approval.toolName} was not executed.`,
        true,
        evidence.id,
      );
      writeLine(output, `agent ${approval.agentId} 不存在，未执行 ${approval.toolName}。`);
      writeStatus(output, context);
      return;
    }
    const result = await denyAgentToolUse(
      agent,
      approval.toolCall,
      approval.toolName,
      context,
      approval.sessionId,
      outcomeText,
    );
    await appendToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolName,
      result.text,
      true,
      result.evidenceId,
    );
    writeLine(output, `已拒绝 agent ${agent.id} 的 ${approval.toolName}；工具未执行。`);
    writeStatus(output, context);
    return;
  }
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
    const text =
      approval.toolName === "Write" ||
      approval.toolName === "Edit" ||
      approval.toolName === "MultiEdit"
        ? `${outcomeText}; ${approval.toolName} was NOT written / NOT created.`
        : outcomeText;
    const evidence = await recordToolFailureEvidence(
      context,
      approval.sessionId,
      approval.toolName,
      `${outcomeText}: architecture drift confirmation required`,
    );
    const deniedResult = {
      ok: false,
      tool: approval.toolName,
      text,
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
      if (
        approval.toolName === "Write" ||
        approval.toolName === "Edit" ||
        approval.toolName === "MultiEdit"
      ) {
        writeLine(output, `${approval.toolName} was NOT written / NOT created.`);
      }
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
      text:
        approval.toolName === "Write" ||
        approval.toolName === "Edit" ||
        approval.toolName === "MultiEdit"
          ? `${outcomeText}; ${approval.toolName} was NOT written / NOT created.`
          : outcomeText,
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
      if (
        approval.toolName === "Write" ||
        approval.toolName === "Edit" ||
        approval.toolName === "MultiEdit"
      ) {
        writeLine(output, `${approval.toolName} was NOT written / NOT created.`);
      }
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
  if (approval.kind === "git_worktree_remove") {
    await resolveWorktreeRemoveDeny(
      approval,
      context,
      output,
      cancelled,
      createWorktreeRemoveResolveDeps(gateway),
    );
    return;
  }
  if (approval.kind === "git_stable_point") {
    // D.14D-R2 P1-1 — 拒绝稳定点：不创建 commit/snapshot，回灌"NOT created"给模型。
    await resolveStablePointDeny(
      approval,
      context,
      output,
      cancelled,
      createWorktreeRemoveResolveDeps(gateway),
    );
    return;
  }
  if (approval.kind === "index_tool") {
    // D.14D-R P0-2 — 拒绝索引刷新/修复：记录失败，回灌"未执行"工具结果给模型，
    // 让 final answer 不会声称索引已刷新。
    const evidence = await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: index ${approval.indexAction}`,
    );
    const deniedResult = {
      ok: false,
      tool: approval.toolCall.name,
      text: `${outcomeText}; the index was NOT refreshed.`,
      outcome: cancelled ? "cancelled" : "denied",
      evidenceId: evidence.id,
    };
    await appendDeferredToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolCall.name,
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
  if (approval.kind === "report_write_tool") {
    const evidence = await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: WriteReport`,
    );
    const deniedResult = {
      ok: false,
      tool: WRITE_REPORT_TOOL_NAME,
      text: `${outcomeText}; the report file was NOT written.`,
      outcome: cancelled ? "cancelled" : "denied",
      evidenceId: evidence.id,
    };
    await appendDeferredToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      WRITE_REPORT_TOOL_NAME,
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
  if (approval.kind === "memory_mutation") {
    await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: memory ${approval.mutation.action}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? "Permission denied. No memory file was written or deleted."
        : "已拒绝权限。本轮未写入或删除记忆文件。",
    );
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "break_cache_mutation") {
    await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: break-cache ${approval.action}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? "Permission denied. Break-cache marker was not changed."
        : "已拒绝权限。本轮未修改 break-cache marker。",
    );
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "image_generation") {
    await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: image generate ${approval.id}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? "Permission denied. Image metadata was not written."
        : "已拒绝权限。本轮未写入 image metadata。",
    );
    writeStatus(output, context);
    return;
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
    // D.14E+ — /permissions recent 走 CommandPanel 避免刷屏：
    // 主屏显示总数+最近 5 条，完整列表进 detailsText。
    const denied = context.permissions.recentDenied;
    if (denied.length === 0) {
      writeLine(output, "最近没有拒绝记录。");
      return;
    }
    const recent = denied.slice(0, 5);
    const summaryLines = [
      `最近拒绝记录（共 ${denied.length} 条，显示最近 5 条）：`,
      ...recent.map((item) => `${item.createdAt}  ${item.toolName}  ${item.mode}  ${item.reason}`),
    ];
    if (denied.length > 5) {
      summaryLines.push(`... 另有 ${denied.length - 5} 条（完整列表见 details）`);
    }
    const detailsText = denied
      .map((item) => `${item.createdAt}  ${item.toolName}  ${item.mode}  ${item.reason}`)
      .join("\n");
    showCommandPanel(context, output, {
      title: "/permissions recent",
      tone: "neutral",
      summary: summaryLines,
      actions: ["/permissions recent clear", "/permissions recent delete <id>"],
      detailsText,
    });
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
      evidence
        ? formatEvidenceDetails(evidence, context.projectPath)
        : "未找到 evidence。用法：/details evidence <id>",
    );
    return;
  }
  if (action === "background") {
    const task = findBackgroundTask(context, id);
    writeLine(
      output,
      task
        ? formatBackgroundDetails(task, context.language, context.projectPath)
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
        writeErrorLine(output, formatError(error));
      }
      return;
    }
    if (task) {
      writeLine(output, formatBackgroundOutputDetails(task, context.language, context.projectPath));
      return;
    }
    writeLine(
      output,
      evidence
        ? formatEvidenceDetails(evidence, context.projectPath)
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
      context.language === "en-US" ? "Latest output (full body):" : "最近一次输出（完整正文）：",
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
      context.language === "en-US" ? "Nothing to expand right now." : "当前没有可展开的完整内容。",
    );
    return;
  }
  const summary = [
    "Linghun details",
    `- evidence: ${context.evidence.length}/${MAX_EVIDENCE_RECORDS}`,
    `- background: ${context.backgroundTasks.filter(isRuntimeActiveBackgroundTask).length}/${MAX_BACKGROUND_TASKS}`,
    `- agents: ${listCancellableAgents(context).length}/${MAX_AGENTS}`,
    `- checkpoints: ${context.checkpoints.length}/${MAX_CHECKPOINTS}`,
    "- full output: /details evidence <id> | /details background <id> | /details output <id>",
  ];
  if (context.evidence.length > 0) {
    summary.push("- recent evidence:");
    for (const evidence of context.evidence.slice(0, 5)) {
      summary.push(
        `  - ${evidence.id} ${evidence.kind} ${formatDisplayPath(
          evidence.source,
          context.projectPath,
        )}: ${sanitizeDisplayPaths(evidence.summary, context.projectPath)}`,
      );
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
  isRuntimeActiveBackgroundTask,
  listCancellableAgents,
} from "./tui-agent-job-runtime.js";

import {
  findBackgroundTask,
  isActiveBackgroundStatus,
  isRuntimeActiveBackgroundTask,
  listCancellableAgents,
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

// D.13V-C — Resource / concurrency guard，并非第五种权限模式。
// 命名/语义说明：
// - 此 guard 仅做 concurrency cap（前台模型请求互斥 + 后台任务上限），不做 access control。
// - mutating access control 仍由 default / auto-review / plan / full-access 四档权限管道决策。
// - 文案、报告、UI、smoke 全部应避免把 "resource guard" 称为 "permission mode" 或第五权限。
// - 测试在 docs/delivery/phase-13V-* 与 D13T audit 已记录；此常量是源码级断言锚点。
export const RESOURCE_GUARD_KIND = "concurrency-cap" as const;

function checkResourceGuard(
  context: TuiContext,
  kind: BackgroundTaskState["kind"] | "model" | "heavy",
  ignoreTaskId?: string,
): string | null {
  refreshBackgroundLifecycle(context);
  if (kind === "model") {
    return context.activeAbortController
      ? "并发上限：已有前台模型请求正在运行；请等待完成或使用 /interrupt 取消后再继续。这是 resource/concurrency cap，不是权限拒绝。"
      : null;
  }
  const activeTasks = context.backgroundTasks.filter(
    (task) => task.id !== ignoreTaskId && isRuntimeActiveBackgroundTask(task),
  );
  if (activeTasks.length >= BACKGROUND_RUNNING_GLOBAL_CAP) {
    return `并发上限：后台任务已达到全局上限 ${BACKGROUND_RUNNING_GLOBAL_CAP}；请等待完成、查看 /background，或用 /interrupt 取消卡住任务。这是 resource/concurrency cap，不是权限拒绝。`;
  }
  const capTasks = activeTasks.filter(
    (task) => !ignoreTaskId || task.workflowRunId !== ignoreTaskId || task.kind !== "agent",
  );
  if (kind === "heavy") {
    const heavy = capTasks.find(
      (task) =>
        task.kind === "verification" ||
        task.kind === "index" ||
        task.kind === "agent" ||
        task.kind === "bash" ||
        task.kind === "job",
    );
    return heavy
      ? `并发上限：已有 ${heavy.kind} 重任务正在运行。请等待完成、查看 /background，或先 /interrupt。这是 resource/concurrency cap，不是权限拒绝。`
      : null;
  }
  const cap = BACKGROUND_KIND_CAPS[kind];
  if (cap !== undefined && capTasks.filter((task) => task.kind === kind).length >= cap) {
    return `并发上限：${kind} 后台任务已达到上限 ${cap}；请等待完成、查看 /background，或用 /interrupt 取消后重试。这是 resource/concurrency cap，不是权限拒绝。`;
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
    // D.13R: 明确这些是 Linghun snapshot checkpoint，不是 git rollback。
    writeLine(
      output,
      context.language === "en-US"
        ? "Linghun snapshot checkpoints (in-memory file snapshots; not a git reset):"
        : "Linghun snapshot checkpoint（内存文件快照，不是 git reset）：",
    );
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
  const sessionId = await ensureSession(context);
  const permission = await decidePermission(
    "Write",
    { path: checkpoint.changedFiles[0] ?? ".linghun/checkpoint-restore" },
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
      ? `Linghun snapshot checkpoint restored (not a git operation): ${checkpoint.id}`
      : `已恢复 Linghun snapshot checkpoint（不是 git reset）：${checkpoint.id}`,
  );
  writeStatus(output, context);
}

async function handleBtwCommand(
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
  const btwIntent = classifyBtwIntent(routeNaturalIntent(question, context.language));
  if (btwIntent === "status_query") {
    const statusAnswer = formatBtwStatusAnswer(context);
    if (context.isInkSession) {
      context.btwPanelState = { question, phase: "answered", answer: statusAnswer };
    } else {
      writeLine(output, statusAnswer);
    }
    return;
  }
  // D.14D — /btw 现在是 model-backed side question（参考 CCB sideQuestion.ts 行为）：
  // 隔离单轮、无工具、不污染 main conversation / Todo / Plan / checkpoint / git stable
  // point / evidence / D.13U/D.13V completion gate。只把临时问题与答案写进 session
  // store（btw_question event）供 /details 审计；不调用 recordToolEvidence，也不进
  // final-answer claim gate。
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

function formatBtwStatusAnswer(context: TuiContext): string {
  const snapshot = createRuntimeStatusSnapshot({
    language: context.language,
    requestActivityPhase: context.requestActivityPhase,
    requestActivityStartedAt: (context as { requestActivityStartedAt?: number })
      .requestActivityStartedAt,
    requestActivityToolName: context.requestActivityToolName,
    pendingApproval: Boolean(context.pendingLocalApproval),
    workflow: context.workflows.activeRun,
    backgroundTasks: context.backgroundTasks,
    lastVerification: context.lastVerification,
    lastModelRequest: context.lastModelRequest,
  });
  return formatRuntimeStatusSnapshotForBtw(snapshot, context.language);
}

function updateCommandPanelSelection(context: TuiContext, delta: -1 | 1): void {
  const panel = context.commandPanelState;
  if (!panel) return;
  const rows = getCommandPanelSelectableRows(panel);
  if (rows.length === 0) return;
  const current = Math.max(0, Math.min(panel.cursor ?? 0, rows.length - 1));
  const next = (current + delta + rows.length) % rows.length;
  const pageSize = 8;
  const currentOffset = Math.max(0, panel.scrollOffset ?? 0);
  const scrollOffset =
    next < currentOffset
      ? next
      : next >= currentOffset + pageSize
        ? Math.max(0, next - pageSize + 1)
        : currentOffset;
  context.commandPanelState = { ...panel, cursor: next, scrollOffset };
}

function toggleCommandPanelSelection(context: TuiContext): void {
  const panel = context.commandPanelState;
  if (!panel || getCommandPanelSelectableRows(panel).length === 0) return;
  context.commandPanelState = { ...panel, expanded: !panel.expanded };
}

export function __testUpdateCommandPanelSelection(context: TuiContext, delta: -1 | 1): void {
  updateCommandPanelSelection(context, delta);
}

export function __testToggleCommandPanelSelection(context: TuiContext): void {
  toggleCommandPanelSelection(context);
}

async function stopCommandPanelSelection(context: TuiContext, output: Writable): Promise<void> {
  const panel = context.commandPanelState;
  if (!panel) return;
  const rows = getCommandPanelSelectableRows(panel);
  if (rows.length === 0) return;
  const cursor = Math.max(0, Math.min(panel.cursor ?? 0, rows.length - 1));
  const taskRef = rows[cursor]?.taskRef;
  if (!taskRef) return;
  const dispatchOutput = context.isInkSession ? createSilentOutput() : output;
  if (taskRef.kind === "agent") {
    await cancelAgentByRef(taskRef.id, context, dispatchOutput);
  } else if (taskRef.kind === "job") {
    await handleJobCommand(["cancel", taskRef.id], context, dispatchOutput);
  } else {
    await stopSingleBackgroundTask(taskRef.id, context, dispatchOutput);
  }
  if (context.isInkSession) {
    await handleBackgroundCommand([], context, createSilentOutput());
  }
}

export async function __testStopCommandPanelSelection(
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await stopCommandPanelSelection(context, output);
}

async function stopSingleBackgroundTask(
  taskId: string,
  context: TuiContext,
  output: Writable,
): Promise<boolean> {
  const task = findBackgroundTask(context, taskId);
  if (!task || !isRuntimeActiveBackgroundTask(task)) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Selected background task is not running."
        : "选中的后台任务当前未运行。",
    );
    return false;
  }
  const sessionId = await ensureSession(context);
  const now = new Date().toISOString();
  let aborted = false;
  if (task.kind === "verification" && context.activeVerificationAbortController) {
    context.activeVerificationAbortController.abort();
    context.activeVerificationAbortController = undefined;
    context.interrupt = { type: "idle" };
    aborted = true;
  } else {
    aborted = abortBackgroundTask(context, task.id);
  }
  if (task.kind === "job") {
    const job = await findDurableJob(context, task.id);
    if (job) {
      await transitionDurableJob(
        job,
        context,
        aborted ? "cancelled" : "stale",
        aborted ? "selected_abort_signal_sent" : "selected_without_abort_controller",
      );
      const updatedTask = createJobBackgroundTask(job, context);
      Object.assign(task, updatedTask);
      await appendBackgroundTaskEvent(context, sessionId, task);
      return true;
    }
  }
  task.status = aborted ? "cancelled" : "stale";
  task.result = aborted ? "cancelled" : "partial";
  task.updatedAt = now;
  task.nextAction = aborted
    ? context.language === "en-US"
      ? "Abort signal sent. Review /background and the log before continuing."
      : "已发送取消信号。继续前可先查看 /background 和日志。"
    : context.language === "en-US"
      ? "No live abort controller was available; state marked stale/resumable."
      : "未找到可用取消 controller；已标记为 stale/resumable。";
  await appendBackgroundTaskEvent(context, sessionId, task);
  writeLine(
    output,
    aborted
      ? context.language === "en-US"
        ? `Stopped ${task.title}.`
        : `已停止 ${task.title}。`
      : context.language === "en-US"
        ? `${task.title} has no live abort controller; marked stale.`
        : `${task.title} 没有可用取消 controller；已标记为 stale。`,
  );
  return true;
}

async function handleInterruptCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const agentRef = args.join(" ").trim();
  if (agentRef) {
    await cancelAgentByRef(agentRef, context, output);
    return;
  }
  const result = await interruptAllActiveWork(context);
  if (result.cancelled === 0) {
    writeLine(output, t(context, "interruptIdle"));
    return;
  }
  writeLine(
    output,
    context.language === "en-US"
      ? `Interrupt requested for ${result.cancelled} active item(s); abort signals ${result.abortSignalsSent}, marked ${result.markedOnly}.`
      : `已请求中断 ${result.cancelled} 个活动任务；abort signals ${result.abortSignalsSent}，marked ${result.markedOnly}。`,
  );
}

type InterruptAllActiveWorkResult = {
  cancelled: number;
  abortSignalsSent: number;
  markedOnly: number;
};

export async function interruptAllActiveWork(
  context: TuiContext,
): Promise<InterruptAllActiveWorkResult> {
  const sessionId = await ensureSession(context);
  const now = new Date().toISOString();
  let cancelled = 0;
  let abortSignalsSent = 0;
  let markedOnly = 0;
  const appendInterruptEvent = async (message: string) => {
    await context.store.appendEvent(sessionId, {
      type: "interrupt",
      id: randomUUID(),
      status: "cancelled",
      message,
      createdAt: new Date().toISOString(),
    });
  };

  if (context.activeVerificationAbortController) {
    context.activeVerificationAbortController.abort();
    context.activeVerificationAbortController = undefined;
    cancelled += 1;
    abortSignalsSent += 1;
    context.interrupt = { type: "idle" };
    const verificationTasks = context.backgroundTasks.filter(
      (task) => task.kind === "verification" && isActiveBackgroundStatus(task.status),
    );
    for (const verificationTask of verificationTasks) {
      verificationTask.status = "cancelled";
      verificationTask.result = "cancelled";
      verificationTask.updatedAt = now;
      verificationTask.nextAction =
        context.language === "en-US"
          ? "Review the verification log, then rerun /verify if needed."
          : "先查看验证日志，必要时复跑 /verify。";
      await appendBackgroundTaskEvent(context, sessionId, verificationTask);
    }
  }

  if (context.activeAbortController) {
    context.activeAbortController.abort();
    context.activeAbortController = undefined;
    clearRequestActivity(context);
    context.interrupt = { type: "idle" };
    cancelled += 1;
    abortSignalsSent += 1;
  }

  if (context.activeBtwAbortController) {
    context.activeBtwAbortController.abort();
    context.activeBtwAbortController = undefined;
    if (context.btwPanelState?.phase === "loading") {
      context.btwPanelState = {
        question: context.btwPanelState.question,
        phase: "error",
        error: context.language === "en-US" ? "Side question cancelled." : "临时插问已取消。",
      };
    }
    cancelled += 1;
    abortSignalsSent += 1;
  }

  const workflowRun = context.workflows.activeRun;
  const workflowTask =
    workflowRun?.status === "running"
      ? (context.backgroundTasks.find((task) => task.id === workflowRun.id) ??
        createWorkflowInterruptBackgroundTask(workflowRun, context.language))
      : undefined;
  if (workflowRun?.status === "running" && workflowTask) {
    upsertWorkflowBackgroundTask(context, workflowTask);
    cancelled += 1;
    markedOnly += 1;
    await finishWorkflowRun(
      workflowRun.id,
      "cancelled",
      context.language === "en-US"
        ? "Workflow cancelled by interrupt; inspect /workflows status before rerun."
        : "Workflow 已由中断取消；重跑前请先查看 /workflows status。",
      context,
      sessionId,
      workflowTask,
    );
  }

  const runningAgentIds = new Set(
    context.agents.filter((agent) => agent.status === "running").map((agent) => agent.id),
  );
  const activeTasks = context.backgroundTasks
    .filter((task) => isRuntimeActiveBackgroundTask(task) && task.id !== workflowRun?.id)
    .filter((task) => !runningAgentIds.has(task.id));
  for (const task of activeTasks) {
    const aborted = abortBackgroundTask(context, task.id);
    if (aborted) abortSignalsSent += 1;
    else markedOnly += 1;
    cancelled += 1;
    if (task.kind === "job") {
      const job = await findDurableJob(context, task.id);
      if (job) {
        await transitionDurableJob(
          job,
          context,
          aborted ? "cancelled" : "stale",
          aborted ? "interrupt_abort_signal_sent" : "interrupt_without_abort_controller",
        );
        const updatedTask = createJobBackgroundTask(job, context);
        Object.assign(task, updatedTask);
        await appendBackgroundTaskEvent(context, sessionId, task);
        continue;
      }
    }
    task.status = aborted ? "cancelled" : "stale";
    task.result = aborted ? "cancelled" : "partial";
    task.updatedAt = now;
    task.nextAction = aborted
      ? context.language === "en-US"
        ? "Abort signal sent. Review /background and the log before continuing."
        : "已发送取消信号。继续前可先查看 /background 和日志。"
      : context.language === "en-US"
        ? "No live abort controller was available; state marked stale/resumable."
        : "未找到可用取消 controller；已标记为 stale/resumable。";
    await appendBackgroundTaskEvent(context, sessionId, task);
  }

  for (const agent of context.agents.filter((item) => item.status === "running")) {
    const hadController = Boolean(context.backgroundAbortControllers?.has(agent.id));
    await cancelAgentByRef(agent.id, context, createSilentOutput());
    cancelled += 1;
    if (hadController) abortSignalsSent += 1;
  }

  if (context.workflows.activeRun?.status === "running") {
    context.workflows.activeRun.status = "cancelled";
    context.workflows.activeRun.endedAt = now;
    context.workflows.activeRun.result = "cancelled";
  }

  await appendInterruptEvent(
    cancelled === 0
      ? t(context, "interruptIdle")
      : `${t(context, "interruptCancelled")} abort signals ${abortSignalsSent}; marked only ${markedOnly}`,
  );
  return { cancelled, abortSignalsSent, markedOnly };
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
    const sessionId = await ensureSession(context);
    const permission = await decidePermission(
      "Write",
      { path: relative(context.projectPath, path), content: "cache history export" },
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
        `cache-log export ${permission.decision}: ${permission.reason}`,
      );
      writeLine(output, formatPermissionDenied(permission.reason, permission.request.summary));
      writeStatus(output, context);
      return;
    }
    if (permission.preflight) {
      writeLine(output, permission.preflight);
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(context.cache.history, null, 2)}\n`, "utf8");
    const evidence = createEvidenceRecord(
      "command_output",
      `cache_log_export: ${relative(context.projectPath, path)}`,
      `cache-log:${relative(context.projectPath, path)}`,
      ["cache_log_export", "Write"],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
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
    // D.13Q-UX Task Surface — /cache 默认走降噪 CommandPanel。
    showCommandPanel(context, output, buildCacheStatusPanel(context, getCurrentFreshness(context)));
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
        ? `已尝试预热 cache。workspace reference ${snapshot.source}；该最小路径不保证 provider 一定写入缓存，请用 /cache status 或 provider usage 对账。`
        : `已尝试刷新 cache。workspace reference ${snapshot.source}；该最小路径不保证 provider 一定写入缓存，请用 /cache status 或 provider usage 对账。`,
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
    await refreshCompactPressureSnapshot(context);
    writeLine(output, formatCompactStatus(context));
    return;
  }
  if (action === "manual" || action === "run" || action === "deep") {
    const sessionId = await ensureSession(context);
    const resumed = await context.store.resume(sessionId);
    const runtime = getSelectedModelRuntime(context);
    if (!context.modelGateway) {
      writeLine(
        output,
        context.language === "en-US"
          ? "Deep compact unavailable: model gateway is not ready."
          : "Deep compact 不可用：模型网关尚未就绪。",
      );
      return;
    }
    const result = await runDeepCompact({
      context,
      sessionId,
      transcript: resumed.transcript,
      runtime,
      trigger: "manual",
      gateway: context.modelGateway,
      deps: compactPreflightDeps.runDeepCompact,
    });
    if (!result.ok) {
      writeLine(output, result.message);
      writeStatus(output, context);
      return;
    }
    writeLine(
      output,
      `Deep compact completed: ${result.packet.id}；scope full transcript semantic compact；tools disabled/tool choice none；不写项目文件、不写长期记忆、不启动后台任务。`,
    );
    writeStatus(output, context);
    return;
  }
  if (action === "auto") {
    writeLine(
      output,
      "Compact auto：provider 压力触发时先尝试 deep compact agent（full transcript semantic compact，tools disabled/toolChoice none），再保留 provider-visible projection 作为 preflight safety layer。",
    );
    return;
  }
  writeLine(output, "用法：/compact status | /compact manual | /compact deep | /compact auto");
}

async function refreshCompactPressureSnapshot(context: TuiContext): Promise<void> {
  if (!context.sessionId) {
    context.cache.compactPressure = undefined;
    return;
  }
  try {
    const runtimeStatus = buildRuntimeStatusForModel({
      ...context,
      provider: getRuntimeStatusProvider(context),
    });
    const systemPrompt = createModelSystemPrompt(
      "",
      context,
      runtimeStatus,
      undefined,
      undefined,
      buildFailureLearningSummaryForPrompt(context.failureLearning),
    );
    const messages = await buildModelMessagesWithRecentContext(
      context,
      context.sessionId,
      systemPrompt,
      "",
      getSelectedModelRuntime(context),
    );
    const runtime = getSelectedModelRuntime(context);
    const estimatedChars = estimateModelMessageChars(messages);
    const maxChars = getProviderContextMaxChars(context, runtime);
    const triggerChars = getAutoCompactTriggerChars(context, runtime);
    context.cache.compactPressure = {
      estimatedChars,
      maxChars,
      triggerChars,
      ratio: Number((estimatedChars / Math.max(1, maxChars)).toFixed(3)),
      toolPairingSafe: inspectToolPairingSafety(messages).safe,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    context.cache.compactPressure = undefined;
  }
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
    writeLine(output, formatBreakCacheStatus(context, getCurrentFreshness(context)));
    return;
  }
  if (clearFlag) {
    if ((await requestBreakCacheMutationApproval(context, output, "clear")) !== "approved") {
      return;
    }
    await executeBreakCacheMutation("clear", context, output);
    return;
  }
  if (action === "once") {
    if ((await requestBreakCacheMutationApproval(context, output, "once")) !== "approved") {
      return;
    }
    await executeBreakCacheMutation("once", context, output);
    return;
  }
  if (action === "always") {
    if ((await requestBreakCacheMutationApproval(context, output, "always")) !== "approved") {
      return;
    }
    await executeBreakCacheMutation("always", context, output);
    return;
  }
  if (action === "off") {
    if ((await requestBreakCacheMutationApproval(context, output, "off")) !== "approved") {
      return;
    }
    await executeBreakCacheMutation("off", context, output);
    return;
  }
  writeLine(
    output,
    "用法：/break-cache status | /break-cache once | /break-cache always | /break-cache off | /break-cache --clear",
  );
}

async function requestBreakCacheMutationApproval(
  context: TuiContext,
  output: Writable,
  action: BreakCacheMutationAction,
): Promise<"approved" | "blocked" | "pending"> {
  const sessionId = await ensureSession(context);
  const input = {
    path: ".linghun/break-cache",
    content: action,
    reason: `explicit /break-cache ${action}`,
  };
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
    context.pendingLocalApproval = { kind: "break_cache_mutation", sessionId, action };
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
    return "pending";
  }
  if (permission.decision === "deny") {
    await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `permission ${permission.decision}: ${permission.reason}; break-cache ${action}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? `Permission blocked break-cache ${action}: ${permission.reason}`
        : `权限阻止 break-cache ${action}：${permission.reason}`,
    );
    writeStatus(output, context);
    return "blocked";
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  return "approved";
}

async function executeBreakCacheMutation(
  action: BreakCacheMutationAction,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (action === "clear") {
    // /break-cache --clear 或 /break-cache <mode> --clear：清掉 once+always 两个 marker。
    await clearBreakCacheMarker(context, "all");
    await appendBreakCacheEvent(context, "cleared");
    refreshCacheFreshness(context);
    writeLine(output, "已清除 break-cache marker（once + always）。下次请求不再附加 nonce。");
    writeLine(output, formatBreakCacheStatus(context, getCurrentFreshness(context)));
  } else if (action === "once") {
    const nonce = randomUUID();
    await writeBreakCacheMarker(context, "once", nonce);
    await appendBreakCacheEvent(context, "once_set");
    refreshCacheFreshness(context);
    writeLine(
      output,
      "已设置 once：下一次模型请求将附加 cacheBreakNonce 破坏前缀缓存，命中后自动消费。",
    );
  } else if (action === "always") {
    const nonce = randomUUID();
    await writeBreakCacheMarker(context, "always", nonce);
    await appendBreakCacheEvent(context, "always_set");
    refreshCacheFreshness(context);
    writeLine(
      output,
      "已设置 always：固定 break-cache namespace（stable nonce），所有请求共享同一 cacheBreakNonce，相当于切到一个新的 cache 命名空间，并在该命名空间内继续命中前缀缓存；不会每次请求都破坏缓存。运行 /break-cache off 或 --clear 取消。",
    );
  } else {
    await clearBreakCacheMarker(context, "all");
    await appendBreakCacheEvent(context, "off");
    refreshCacheFreshness(context);
    writeLine(output, "已关闭 break-cache：下次请求不再附加 nonce。");
  }
  await recordBreakCacheMutationEvidence(context, await ensureSession(context), action);
}

async function handleResumeCommand(
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

export type { CodebaseMemoryResolution, ExecuteExtraToolResult } from "./mcp-index-runtime.js";

function refreshCacheFreshness(context: TuiContext): void {
  const freshness = getCurrentFreshness(context);
  context.cache.lastFreshness = {
    ...freshness,
    changedKeys: diffFreshness(context.cache.lastFreshness, freshness),
  };
}

async function requestMemoryMutationApproval(
  context: TuiContext,
  output: Writable,
  mutation: MemoryMutation,
): Promise<"approved" | "blocked" | "pending"> {
  const sessionId = await ensureSession(context);
  const input = createMemoryMutationPermissionInput(context, mutation);
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
    context.pendingLocalApproval = { kind: "memory_mutation", sessionId, mutation };
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
    return "pending";
  }
  if (permission.decision === "deny") {
    await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `permission ${permission.decision}: ${permission.reason}; memory ${mutation.action}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? `Permission blocked memory ${mutation.action}: ${permission.reason}`
        : `权限阻止 memory ${mutation.action}：${permission.reason}`,
    );
    writeStatus(output, context);
    return "blocked";
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  return "approved";
}

function createMemoryMutationPermissionInput(
  context: TuiContext,
  mutation: MemoryMutation,
): Record<string, unknown> {
  if (mutation.action === "init") {
    return {
      path: "LINGHUN.md",
      content: createLinghunMdTemplate(context.language),
      reason: "explicit /memory init",
    };
  }
  const memory = "candidate" in mutation ? mutation.candidate : mutation.memory;
  return {
    path: memory.scope === "session" ? ".linghun/session-memory" : memoryFilePermissionPath(memory),
    content: memory.summary,
    reason: `explicit /memory ${mutation.action}`,
  };
}

function memoryFilePermissionPath(memory: MemoryCandidate): string {
  const root =
    memory.scope === "user"
      ? ".linghun/user-memory"
      : memory.scope === "project"
        ? ".linghun/memory"
        : ".linghun/session-memory";
  return `${root}/${memory.id}.json`;
}

async function recordMemoryMutationEvidence(
  context: TuiContext,
  sessionId: string,
  action: string,
  memory: MemoryCandidate,
): Promise<void> {
  const summary =
    action === "init"
      ? "memory_mutation init: generated LINGHUN.md"
      : `memory_mutation ${action}: scope=${memory.scope} id=${memory.id} status=${memory.status}`;
  const source = action === "init" ? "memory:init:LINGHUN.md" : `memory:${action}:${memory.id}`;
  const evidence = createEvidenceRecord("command_output", summary, source, [
    "memory_mutation",
    `memory_${action}`,
    "Write",
  ]);
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
}

async function recordBreakCacheMutationEvidence(
  context: TuiContext,
  sessionId: string,
  action: BreakCacheMutationAction,
): Promise<void> {
  const evidence = createEvidenceRecord(
    "command_output",
    `break_cache_mutation ${action}: marker updated`,
    `break-cache:${action}`,
    ["break_cache_mutation", `break_cache_${action}`, "Write"],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
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

const compactPreflightDeps = {
  appendSystemEvent,
  captureFailureLearning,
  recordToolResultBudgetEvidence,
  refreshCacheFreshness,
  runDeepCompact: {
    appendSystemEvent,
    captureFailureLearning,
    refreshCacheFreshness,
    recordCompactBoundary,
  },
};

const TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS = 2_000;
const TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS = 8_000;
// Phase 6.5: round assistant text 入 provider context 时的上限；超出截断为 head+tail+artifact ref，
// 避免超长模型输出污染下一轮 provider 上下文。
const MAX_ROUND_ASSISTANT_CHARS_FOR_PROVIDER = 16_000;
const ROUND_ASSISTANT_HEAD_CHARS = 4_000;
const ROUND_ASSISTANT_TAIL_CHARS = 4_000;

/**
 * Phase 6.5 — 将超长 round assistant text 截断为 head + artifact 引用的有界投影，
 * 仅用于写回 provider messages，完整正文保留在 block.fullText / lastFullOutput 中。
 */
function truncateRoundAssistantForProvider(
  text: string,
  context: { language: "zh-CN" | "en-US"; projectPath: string },
): string {
  if (text.length <= MAX_ROUND_ASSISTANT_CHARS_FOR_PROVIDER) return text;
  const head = text.slice(0, ROUND_ASSISTANT_HEAD_CHARS);
  const tail = text.slice(-ROUND_ASSISTANT_TAIL_CHARS);
  const omitted = text.length - ROUND_ASSISTANT_HEAD_CHARS - ROUND_ASSISTANT_TAIL_CHARS;
  const separator =
    context.language === "en-US"
      ? `\n\n[... ${omitted} characters omitted — full output preserved in artifact; use /details or Ctrl+O to inspect ...]\n\n`
      : `\n\n[... 中间省略 ${omitted} 个字符 — 完整输出已保存在 artifact 中；用 /details 或 Ctrl+O 查看 ...]\n\n`;
  return head + separator + tail;
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
      deepCompactId: context.cache.deepCompact?.id ?? "none",
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

  let plan: Awaited<ReturnType<typeof createVerificationPlan>>;
  if (action === "typecheck") {
    const defaultPlan = await createVerificationPlan(context.projectPath, "default");
    plan = defaultPlan.filter((step) => step.kind === "typecheck");
    if (plan.length === 0) {
      plan = await createVerificationPlan(context.projectPath, "smoke");
    }
  } else {
    plan = await createVerificationPlan(
      context.projectPath,
      action === "smoke" ? "smoke" : "default",
    );
  }

  if (action === "plan") {
    writeLine(output, formatVerificationPlan(plan, context.language));
    return;
  }
  if (action && action !== "smoke" && action !== "typecheck") {
    writeLine(
      output,
      "用法：/verify | /verify plan | /verify last | /verify smoke | /verify typecheck",
    );
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

async function executeImageGeneration(
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

async function recordVerificationEvidence(
  context: TuiContext,
  sessionId: string,
  report: VerificationReport,
): Promise<void> {
  const supportsClaims =
    report.status === "pass"
      ? ["verification_passed", "test_passed"]
      : ["verification attempted", `verification:${report.status}`, "未通过验证", "需要复核"];
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind: "test_result",
    summary: `${formatVerificationEvidenceStatusSummary(report)} 日志：${report.logPath ?? "无日志"}`,
    source: report.logPath ?? "Verification Runner",
    supportsClaims,
    createdAt: new Date().toISOString(),
  };
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  // D.14B — 验证失败转 failure learning。只记 fail/partial/timeout（真实失败）；
  // cancelled（用户取消）/stale（过期非失败）/skipped 不记为模型失败。
  if (report.status === "fail" || report.status === "partial" || report.status === "timeout") {
    const failedCommand = report.commands.find(
      (c) => c.status === "fail" || c.status === "timeout",
    );
    await captureFailureLearning(context, sessionId, {
      category: "verification_failure",
      failureSummary: `verification ${report.status}: ${report.summary}`,
      rootCauseGuess: failedCommand
        ? `verification command failed (exit ${failedCommand.exitCode ?? "n/a"})`
        : `verification did not reach pass (${report.status})`,
      avoidNextTime:
        "Fix the failing verification command and re-run it; do not claim verified/passed until status=pass",
      sourceRef: `evidence:${evidence.id}`,
      relatedTarget: failedCommand?.kind ?? "verification",
      severity: report.status === "fail" ? "high" : "medium",
    });
  }
}

function formatVerificationEvidenceStatusSummary(report: VerificationReport): string {
  const statusLabel = report.status.toUpperCase();
  return new RegExp(`^${statusLabel}(?:\\s|:|：)`, "u").test(report.summary)
    ? report.summary
    : `${statusLabel} ${report.summary}`;
}

async function recordAgentExecutionEvidence(
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
      ? ["agent_execution", `agent_${agent.type}`, "action_executed"]
      : ["tool_failure", "agent_execution", `agent_${agent.type}`],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  return evidence.id;
}

async function recordAgentMailboxEvidence(
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

async function recordAgentToolEvidence(
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

async function recordAgentToolFailureEvidence(
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

async function recordToolResultBudgetEvidence(
  context: TuiContext,
  sessionId: string,
  record: ToolResultBudgetRecord,
): Promise<string> {
  const existing = context.evidence.find(
    (item) =>
      item.fullOutputPath === record.artifact.path ||
      item.outputPath === record.artifact.path ||
      item.summary.includes(record.artifact.relativePath),
  );
  if (existing) return existing.id;

  const evidence = createEvidenceRecord(
    "command_output",
    formatToolResultBudgetEvidenceSummary(record),
    record.artifact.relativePath,
    ["tool_result_budget", "artifact", `toolUseId:${record.toolUseId}`],
  );
  evidence.fullOutputPath = record.artifact.path;
  evidence.outputPath = record.artifact.path;
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(context, sessionId, formatToolResultBudgetSystemEvent(record), "info");
  return evidence.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    return "handled";
  }

  // D.14D — 模型未配好时的 onboarding 入口（state-gated，不是普通自然语言截胡）。
  // 只有当 shouldOfferUserScopedModelSetup 为真（即当前没有可用的 user provider 配置）
  // 时才命中；模型一旦配好，这条永远不触发，普通自然语言照常进模型主链。这是新手安全
  // 配置路径，不依赖关键词把普通对话转 slash。
  if (shouldOfferUserScopedModelSetup(context) && looksLikeModelSetupInput(text)) {
    await startModelSetup(context, output, parseModelSetupPrefill(text));
    return "handled";
  }

  // D.14D — 输入路由边界（参考：plain text 永远进模型，唯一分支是 "/" 前缀）。
  // 普通自然语言（不以 "/" 开头、无 pending approval / 无 pending Start Gate）默认必须
  // 发送给模型。这里**不再**做任何本地 NL 关键词截胡：
  //   - 已移除 workspace-trust NL Start Gate（"信任这个项目"等）；
  //   - 已移除 index safety repair NL 续跑（"把这些文件加入 ignore 后刷新索引"等）；
  //   - 已移除 composite local status NL 应答（"索引和记忆 MCP 打开了吗"等）。
  // 这些产品能力仍可通过精确 slash command 使用（/trust、/index、/doctor、/status），
  // 普通自然语言不再被中文/英文关键词表转成本地命令意图。

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

async function runIndexSafetyRepair(context: TuiContext, output: Writable): Promise<void> {
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

  await runIndexRepository(context, context.config.index.mode, "refresh", false, output);
  if (!context.index.safetyWarning) {
    writeLine(output, formatIndexRefreshSummary(context));
  }
  if (!context.isInkSession) writeStatus(output, context);
}

async function requestIndexRefreshApproval(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const sessionId = await ensureSession(context);
  const toolCall: ModelToolCall = {
    id: `slash-index-refresh-${randomUUID().slice(0, 8)}`,
    name: INDEX_REFRESH,
    input: {
      force: args.includes("--force"),
      reason: "explicit /index refresh slash command",
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
    await appendSystemEvent(
      context,
      sessionId,
      "slash_index_refresh_auto_review_allowed: ordinary workspace index write uses existing permission pipeline; dangerous shell/network/install/delete remain gated",
      "info",
    );
    await executeApprovedIndexToolUse(
      toolCall,
      "refresh",
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
      `index refresh deny: ${permission.reason}`,
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
      indexAction: "refresh",
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
    "refresh",
    args.includes("--force"),
    context,
    sessionId,
    output,
  );
  if (!context.isInkSession) writeStatus(output, context);
}

async function requestIndexInitFastApproval(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const sessionId = await ensureSession(context);
  const toolCall: ModelToolCall = {
    id: `slash-index-init-fast-${randomUUID().slice(0, 8)}`,
    name: INDEX_REFRESH,
    input: {
      force: args.includes("--force"),
      reason: "explicit /index init fast slash command",
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
    await appendSystemEvent(
      context,
      sessionId,
      "slash_index_init_fast_auto_review_allowed: ordinary workspace index write uses existing permission pipeline; dangerous shell/network/install/delete remain gated",
      "info",
    );
    await executeApprovedIndexToolUse(
      toolCall,
      "init fast",
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
      `index init fast deny: ${permission.reason}`,
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
      indexAction: "init fast",
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
    "init fast",
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

function clearRequestActivity(context: TuiContext): void {
  const timer = context.requestActivity?.slowTimer;
  if (timer) {
    clearTimeout(timer);
  }
  if (context.requestActivityPhase) {
    const startedAt = (context as { requestActivityStartedAt?: number }).requestActivityStartedAt;
    context.lastModelRequest = {
      phase: context.requestActivityPhase,
      toolName: context.requestActivityToolName,
      startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
      endedAt: new Date().toISOString(),
    };
  }
  context.requestActivity = undefined;
  context.requestActivityPhase = undefined;
  context.requestActivityToolName = undefined;
  (context as { requestActivityStartedAt?: number }).requestActivityStartedAt = undefined;
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
  (context as { requestActivityStartedAt?: number }).requestActivityStartedAt = Date.now();
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
    // D.14B — 并发上限拒绝是真实的"任务无法继续"事件（不是权限拒绝、不是用户取消）。
    const guardSessionId = await ensureSession(context);
    await captureFailureLearning(context, guardSessionId, {
      category: "resource_cap",
      failureSummary:
        "model request blocked by concurrency cap (a foreground request is already running)",
      rootCauseGuess: "started a new model request while one was still active",
      avoidNextTime:
        "Wait for the active model request to finish or use /interrupt before starting another",
      sourceRef: `event:${RESOURCE_GUARD_KIND}`,
      relatedTarget: "model",
      severity: "low",
    });
    return;
  }
  const selectedRuntimeForCooldown = getSelectedModelRuntime(context);
  if (checkAndWriteProviderCooldown(context, selectedRuntimeForCooldown, output)) {
    return;
  }
  const sessionId = await ensureSession(context);
  context.sessionEnded = false;
  await context.store.appendEvent(sessionId, createUserMessageEvent(text));
  let selectedRuntime = getSelectedModelRuntime(context);
  context.model = selectedRuntime.model;
  let selectedTools = currentModelSupportsTools(context, selectedRuntime);
  const reportWriteGuard = createReportWriteGuard(text);
  await appendSystemEvent(
    context,
    sessionId,
    `model request: selected role ${selectedRuntime.role}; provider ${selectedRuntime.provider}; model ${selectedRuntime.model}; endpoint profile ${selectedRuntime.endpointProfile}; reasoning level ${selectedRuntime.reasoningLevel ?? "none"}; reasoning sent ${selectedRuntime.reasoningSent ? "yes" : "no"}; tools ${selectedTools ? "yes" : "no"}`,
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
  let finalAnswerClaimRetried = false;
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
  // D.14G — 最小 WorktreeContext（redacted，无 provider/baseUrl）；仅隔离 worktree 内注入。
  const worktreeContext = await computeWorktreeContext(context.projectPath);
  const metaSchedulerDecision = evaluateMetaScheduler({
    language: context.language,
    userText: text,
    index: context.index,
    evidence: context.evidence,
    failureLearning: context.failureLearning,
    backgroundTasks: context.backgroundTasks,
    workflow: context.workflows.activeRun,
  });
  for (const event of metaSchedulerDecision.internalEvents) {
    await appendSystemEvent(context, sessionId, event, "info");
  }
  const systemPrompt = createModelSystemPrompt(
    text,
    context,
    runtimeStatus,
    architectureDirective,
    summarizeWorktreeContextForPrompt(worktreeContext),
    buildFailureLearningSummaryForPrompt(context.failureLearning),
    formatMetaSchedulerDirective(metaSchedulerDecision),
  );
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
    selectedRuntime,
  );
  let messagesForProvider = messages;
  if (reportWriteGuard) {
    messagesForProvider.push({
      role: "user",
      content: createReportTaskGuard(reportWriteGuard, context.language),
    });
  }
  try {
    let evidenceRounds = 0;
    let consecutiveTodoOnlyRounds = 0;
    let totalPlanningOnlyRounds = 0;
    let todoOnlyHintSent = false;
    let rawToolProtocolTextRetries = 0;
    modelRoundLoop: for (let round = 0; round < MAX_MODEL_TOTAL_TOOL_ROUNDS; round += 1) {
      const toolCalls: ModelToolCall[] = [];
      let roundAssistantText = "";
      const textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
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
      const preflight = await prepareMessagesForProviderPreflight({
        messages: messagesForProvider,
        context,
        sessionId,
        runtime: selectedRuntime,
        trigger: "request",
        deps: compactPreflightDeps,
      });
      if (preflight.blocked) {
        clearRequestActivity(context);
        context.activeAbortController = undefined;
        context.tools.abortSignal = undefined;
        context.interrupt = { type: "idle" };
        writeLine(output, preflight.message);
        writeStatus(output, context);
        return;
      }
      messagesForProvider = preflight.messages;
      const requestMessages = preflight.messages;
      const contextMaxChars = getProviderContextMaxChars(context, selectedRuntime);
      if (estimateModelMessageChars(requestMessages) > contextMaxChars) {
        const warning =
          context.language === "en-US"
            ? "This request is still too large after automatic compaction. Please shorten the latest input or summarize older context, then retry."
            : "自动压缩后这次请求仍过长。请缩短最新输入或先摘要较早上下文后重试。";
        await appendSystemEvent(
          context,
          sessionId,
          `context_still_too_large_after_compaction: model=${selectedRuntime.model} inputTooLarge=${text.length > contextMaxChars ? "yes" : "no"}`,
          "warning",
        );
        clearRequestActivity(context);
        context.activeAbortController = undefined;
        context.tools.abortSignal = undefined;
        context.interrupt = { type: "idle" };
        writeLine(output, warning);
        writeStatus(output, context);
        return;
      }
      const promptCacheFields = await buildPromptCacheRequestFields(context);
      for await (const event of gateway.stream(
        selectedRuntime.provider,
        {
          messages: requestMessages,
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
          endAssistantStream(output);
          writeLine(output, t(context, "toolInterrupted"));
          return;
        }
        if (event.type === "assistant_text_delta") {
          clearRequestActivity(context);
          const visibleText = textSanitizer.push(event.text);
          assistantText += visibleText;
          roundAssistantText += visibleText;
          if (visibleText) {
            writeAssistantDelta(output, assistantStreamBlockId, visibleText);
          }
          continue;
        }
        if (event.type === "tool_use") {
          const visibleText = textSanitizer.flush();
          assistantText += visibleText;
          roundAssistantText += visibleText;
          if (visibleText) {
            writeAssistantDelta(output, assistantStreamBlockId, visibleText);
          }
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
          const fallback = resolveRuntimeFallback(context, selectedRuntime, event.error);
          if (fallback) {
            await recordProviderFallbackAttempt(context, sessionId, {
              from: selectedRuntime,
              to: fallback.runtime,
              kind: fallback.kind,
              code: fallback.code,
              status: "attempted",
            });
            writeLine(
              output,
              context.lastProviderFallbackAttempt?.summary ??
                formatProviderFallbackAttemptSummary(
                  {
                    fromProvider: selectedRuntime.provider,
                    fromModel: selectedRuntime.model,
                    toProvider: fallback.runtime.provider,
                    toModel: fallback.runtime.model,
                    reasonKind: fallback.kind,
                  },
                  context.language,
                ),
            );
            selectedRuntime = fallback.runtime;
            context.model = selectedRuntime.model;
            selectedTools = currentModelSupportsTools(context, selectedRuntime);
            if (checkAndWriteProviderCooldown(context, selectedRuntime, output)) {
              return;
            }
            continue modelRoundLoop;
          }
          writeErrorLine(output, formatProviderFailurePrimary(event.error, context.language));
          return;
        }
      }
      const finalVisibleText = textSanitizer.flush();
      assistantText += finalVisibleText;
      roundAssistantText += finalVisibleText;
      if (finalVisibleText) {
        writeAssistantDelta(output, assistantStreamBlockId, finalVisibleText);
      }

      if (textSanitizer.hadRawToolProtocol() && toolCalls.length === 0) {
        await appendSystemEvent(
          context,
          sessionId,
          "assistant_raw_tool_protocol_as_text",
          "warning",
        );
        discardAssistantBlock(output, assistantStreamBlockId);
        assistantText = "";
        roundAssistantText = "";
        if (rawToolProtocolTextRetries < MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES) {
          messagesForProvider.push({
            role: "user",
            content: createRawToolProtocolReminder(context.language),
          });
          rawToolProtocolTextRetries += 1;
          continue;
        }
        writeLine(output, formatRawToolProtocolRetryFailure(context.language));
        break;
      }

      if (!roundAssistantText && toolCalls.length === 0) {
        clearRequestActivity(context);
        const result = await recordProviderEmptyResponse(
          context,
          sessionId,
          roundChunkCount,
          roundHadUsage,
          roundFinishReason,
          roundHadThinking,
        );
        if (result.isError) {
          writeErrorLine(output, result.message);
        } else {
          writeLine(output, result.message);
        }
        return;
      }

      if (roundAssistantText || toolCalls.length > 0) {
        messagesForProvider.push({
          role: "assistant",
          content: truncateRoundAssistantForProvider(roundAssistantText, context),
          toolCalls,
        });
      }
      if (toolCalls.length === 0) {
        if (reportWriteGuard && shouldSendReportEvidenceReminder(reportWriteGuard)) {
          messagesForProvider.push({
            role: "user",
            content: formatReportEvidenceRequired(context.language),
          });
          reportWriteGuard.evidenceReminderSent = true;
          continue;
        }
        if (reportWriteGuard && shouldSendReportWriteReminder(reportWriteGuard)) {
          messagesForProvider.push({
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
          messagesForProvider.push({
            role: "user",
            content: createReportFinalReferenceReminder(reportWriteGuard, context.language),
          });
          reportWriteGuard.finalReferenceReminderSent = true;
          continue;
        }
        // D.13U — Final Answer Claim Gate（仅一次自我修正）
        if (!finalAnswerClaimRetried && assistantText) {
          const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
          if (verdict.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_claim_gate retry kinds=${verdict.unsupportedKinds.join(",")}`,
              "warning",
            );
            messagesForProvider.push({
              role: "user",
              content: createFinalAnswerClaimReminder(verdict, context.language),
            });
            finalAnswerClaimRetried = true;
            assistantText = "";
            // D.13V — 同时清掉本轮 streaming block 累计的违规原文，
            // 避免 Ctrl+O/details/lastFullOutput 残留。
            discardAssistantBlock(output, assistantStreamBlockId);
            continue;
          }
        }
        // D.13V-B — Architecture / Completeness Final Gate（共享一次重试预算）
        if (!finalAnswerClaimRetried && assistantText) {
          const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
          if (extended.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_extended_gate retry kinds=${extended.verdict.unsupportedKinds.join(",")}`,
              "warning",
            );
            messagesForProvider.push({
              role: "user",
              content: createExtendedFinalAnswerReminder(extended.verdict, context.language),
            });
            finalAnswerClaimRetried = true;
            assistantText = "";
            discardAssistantBlock(output, assistantStreamBlockId);
            continue;
          }
        }
        break;
      }
      if (roundAssistantText) {
        output.write("\n");
      }
      if (reportWriteGuard && !hasReportWriteToolCall(reportWriteGuard, toolCalls)) {
        reportWriteGuard.nonWriteToolRounds += 1;
      }
      const todoOnly = isTodoOnlyRound(toolCalls);
      if (todoOnly) {
        consecutiveTodoOnlyRounds += 1;
      } else {
        consecutiveTodoOnlyRounds = 0;
        evidenceRounds += 1;
      }
      for (const toolCall of toolCalls) {
        const result = await executeModelToolUse(toolCall, context, sessionId, output, {
          messages: messagesForProvider,
          provider: selectedRuntime.provider,
          model: selectedRuntime.model,
          endpointProfile: selectedRuntime.endpointProfile,
          reasoningLevel: selectedRuntime.reasoningLevel,
          reasoningSent: selectedRuntime.reasoningSent,
          ...(reportWriteGuard ? { reportWriteGuard } : {}),
        });
        await recordModelToolFailureForMetaScheduler(context, sessionId, result);
        if (result.pendingApproval) {
          return;
        }
        if (doesWriteSatisfyReportGuard(reportWriteGuard, toolCall, result)) {
          reportWriteGuard.completed = true;
        }
        messagesForProvider.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      if (todoOnly) {
        totalPlanningOnlyRounds += 1;
        if (consecutiveTodoOnlyRounds > MAX_TODO_ONLY_CONSECUTIVE_ROUNDS && !todoOnlyHintSent) {
          const todoHint =
            context.language === "en-US"
              ? "Planning recorded. Please proceed with verification tools (Read/Grep/Bash/GitStatusInspect) or provide an unverified conclusion."
              : "计划已记录。请继续执行验证工具（Read/Grep/Bash/GitStatusInspect）或给出尚未验证结论。";
          messagesForProvider.push({ role: "user", content: todoHint });
          todoOnlyHintSent = true;
          continue;
        }
      }
      const reachedTotalLimit = round + 1 >= MAX_MODEL_TOTAL_TOOL_ROUNDS;
      if (reachedTotalLimit) {
        const onlyPlanning = evidenceRounds === 0;
        const limitMsg = onlyPlanning
          ? context.language === "en-US"
            ? `Execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_ROUNDS} turns. Only planning/Todo was executed; no repository verification was performed. If verification is needed, run the matching command or send the request again.`
            : `执行轮次预算已耗尽（${MAX_MODEL_TOTAL_TOOL_ROUNDS} 轮）。仅完成计划整理，尚未执行仓库验证。如需验证请运行对应命令或重新发起请求。`
          : context.language === "en-US"
            ? `Execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_ROUNDS} turns. Summarizing with what was gathered so far; no further tools will run. If an action still needs to finish (for example refreshing the index), run the matching command such as /index refresh, or send the request again.`
            : `执行轮次预算已耗尽（${MAX_MODEL_TOTAL_TOOL_ROUNDS} 轮）。将基于目前已收集的信息给出回答，不再继续调用工具。如果还有动作需要完成（例如刷新索引），请运行对应命令（如 /index refresh）或重新发起请求。`;
        writeLine(output, limitMsg);
        const finalText = await streamFinalModelAnswerWithoutTools(
          {
            messages: messagesForProvider,
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
          assistantStreamBlockId,
        );
        assistantText += finalText;
        break;
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
  if (
    context.lastProviderFallbackAttempt?.toProvider === selectedRuntime.provider &&
    context.lastProviderFallbackAttempt.toModel === selectedRuntime.model &&
    context.lastProviderFallbackAttempt.status === "attempted"
  ) {
    context.lastProviderFallbackAttempt.status = "succeeded";
    context.lastProviderFallbackAttempt.createdAt = new Date().toISOString();
    await appendSystemEvent(
      context,
      sessionId,
      `provider fallback attempt: status succeeded; to ${selectedRuntime.provider}/${selectedRuntime.model}`,
      "info",
    );
  }

  if (reportWriteGuard && !reportWriteGuard.completed) {
    const message = await recordReportIncompleteEvidence(context, sessionId, reportWriteGuard);
    writeLine(output, message);
  }

  if (assistantText) {
    // D.13U — 最后一道关卡：所有 final answer（含预算耗尽后的 no-tool summary）
    // 入 transcript 前都必须 gate；没有 retry 机会时直接降级，原文不入 transcript。
    {
      const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
      if (verdict.status === "needs_disclaimer") {
        assistantText = await downgradeUnsupportedFinalAnswer(
          assistantText,
          verdict,
          context,
          sessionId,
          output,
          assistantStreamBlockId,
        );
      }
      const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
      if (extended.status === "needs_disclaimer") {
        await appendSystemEvent(
          context,
          sessionId,
          `final_answer_extended_gate downgrade kinds=${extended.verdict.unsupportedKinds.join(",")}`,
          "warning",
        );
        assistantText = buildExtendedDowngradedFinalAnswer(
          assistantText,
          extended.verdict,
          context.language,
        );
        replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
      }
      const visibleAssistantText = stripStructuredFinalAnswerClaims(assistantText);
      if (visibleAssistantText !== assistantText) {
        assistantText = visibleAssistantText;
        replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
      }
    }
    // D.14D — main-screen prompt hygiene：模型若把内部 system-prompt 字段
    // （RuntimeStatusForModel= / ControlledMemorySummary= / MemoryBoundary= /
    // EvidenceSummary= / CommandCapabilitySummary= 等）原样复述，进主屏前清掉，
    // 避免内部运行时 token 泄漏。doctor/details 诊断能力不受影响。必须在
    // final-answer gate 之后执行，避免提前移除 LinghunFinalAnswerClaims 契约。
    {
      const sanitized = sanitizeMainScreenLeakage(assistantText, context.language);
      if (sanitized !== assistantText) {
        assistantText = sanitized;
        replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
      }
    }
    output.write("\n");
    await context.store.appendEvent(sessionId, {
      type: "assistant_text_delta",
      id: assistantEventId,
      text: assistantText,
      createdAt: new Date().toISOString(),
    });
  }
  writeLightHints(output, context);
  writeStatus(output, context);
}

export async function __testSendMessage(
  text: string,
  context: TuiContext,
  gateway: ModelGateway,
  output: Writable,
): Promise<void> {
  await sendMessage(text, context, gateway, output);
}

// D.14E — 远程入站消息进入本地主链的唯一 glue。校验交给 processRemoteInbound（纯
// 逻辑），执行交回既有本地管道：approval_response 复用 executePermissionApprove/
// executePermissionDeny；natural_language_message 原样进 sendMessage（本地模型主链，
// 无关键词截获、无第二套执行器）；status_query 只回脱敏状态。本函数不直接执行任何
// 工具/Bash/写文件/Git。
export async function handleRemoteInboundMessage(
  message: RemoteInboundMessage,
  context: TuiContext,
  gateway: ModelGateway | undefined,
  output: Writable,
): Promise<RemoteInboundDecision> {
  const channel = context.remote.channels.find((item) => item.id === message.channel);
  if (channel && message.kind === "natural_language_message") {
    if ((message.text ?? "").trim().match(/^\/bind\s+[A-Z0-9]{6}$/i)) {
      const envelope = validateRemotePairingEnvelope(context, message);
      const sessionId = await ensureSession(context);
      if (envelope.status !== "envelope_accepted") {
        await appendSystemEvent(
          context,
          sessionId,
          `remote_pair_bind channel=${message.channel} status=${envelope.status} summary=${envelope.summary}`,
          "warning",
        );
        return {
          kind: "natural_language_message",
          status: envelope.status,
          summary: envelope.summary,
          evidenceCreated: false,
        };
      }
      const bind = processRemoteBindCommand(context.remote, channel, message);
      if (!bind) return processRemoteInbound(context, message);
      if (bind.status === "bound") {
        consumeRemoteInboundMessage(context, message.messageId);
      }
      await appendSystemEvent(
        context,
        sessionId,
        `remote_pair_bind channel=${message.channel} status=${bind.status} summary=${bind.summary}`,
        bind.status === "bound" ? "info" : "warning",
      );
      return {
        kind: "natural_language_message",
        status: bind.status === "bound" ? "accepted" : "blocked",
        summary: bind.summary,
        evidenceCreated: false,
      };
    }
  }
  const decision = processRemoteInbound(context, message);
  const sessionId = await ensureSession(context);
  await appendSystemEvent(
    context,
    sessionId,
    `remote_inbound kind=${decision.kind} channel=${message.channel} status=${decision.status} summary=${decision.summary}`,
    decision.status === "accepted" ||
      decision.status === "approved" ||
      decision.status === "rejected"
      ? "info"
      : "warning",
  );
  if (
    decision.status === "approved" ||
    (decision.kind === "approval_response" && decision.status === "rejected")
  ) {
    const approval = context.pendingLocalApproval;
    if (approval) {
      context.pendingLocalApproval = undefined;
      if (decision.status === "approved") {
        await executePermissionApprove(approval, context, gateway, output);
      } else {
        await executePermissionDeny(approval, context, gateway, output, false);
      }
    }
    return decision;
  }
  if (decision.kind === "natural_language_message" && decision.routedText) {
    const inbox = decideRemoteInbox(context.remote, message, {
      activeModelTurn: Boolean(context.activeAbortController),
      activeJob: context.backgroundTasks.some(
        (task) => task.kind === "job" && task.status === "running",
      ),
      toolRunning: context.backgroundTasks.some(
        (task) => task.kind !== "job" && task.status === "running",
      ),
      pendingApproval: Boolean(context.pendingLocalApproval),
      sessionId,
    });
    if (inbox.status === "queued") {
      await appendSystemEvent(
        context,
        sessionId,
        `remote inbox queued: channel ${message.channel}; id ${inbox.item.id}; reason ${inbox.reason}`,
        "info",
      );
      return {
        ...decision,
        status: "accepted",
        summary: `remote natural-language message queued; ${inbox.reason}`,
        routedText: undefined,
      };
    }
    if (gateway) {
      await sendMessage(decision.routedText, context, gateway, output);
    }
  }
  return decision;
}

async function buildModelMessagesWithRecentContext(
  context: TuiContext,
  sessionId: string,
  systemPrompt: string,
  currentUserText: string,
  runtime = getSelectedModelRuntime(context),
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
    const historyMessages: ModelMessage[] = [];
    for (const event of selected) {
      if (event.type === "user_message") {
        historyMessages.push({ role: "user", content: event.text });
      }
      if (event.type === "assistant_text_delta") {
        historyMessages.push({ role: "assistant", content: event.text });
      }
      if (event.type === "tool_result") {
        const toolCall = toolCalls.get(event.toolUseId);
        if (!toolCall) {
          const content = await budgetToolResultTranscriptContent(
            context,
            sessionId,
            event.toolUseId,
            event.content,
          );
          historyMessages.push({
            role: "assistant",
            content: `Previous ${event.toolName} tool_result summary: ${JSON.stringify({
              isError: event.isError ?? false,
              evidenceId: event.evidenceId,
              content,
            })}`,
          });
          continue;
        }
        historyMessages.push({ role: "assistant", content: "", toolCalls: [toolCall] });
        historyMessages.push({
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
    const budgetedHistory = await budgetRecentContextToolResults(
      context,
      sessionId,
      historyMessages,
    );
    messages.push(...budgetedHistory);
  } catch (error) {
    await appendSystemEvent(
      context,
      sessionId,
      `recent_context_unavailable: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
  messages.push({ role: "user", content: currentUserText });
  return messages;
}

async function budgetRecentContextToolResults(
  context: TuiContext,
  sessionId: string,
  messages: ModelMessage[],
): Promise<ModelMessage[]> {
  const budgeted = await applyToolResultBudgetToMessages(messages, {
    projectPath: context.projectPath,
    sessionId,
    state: getToolResultBudgetState(context),
  });
  for (const record of budgeted.records) {
    await recordToolResultBudgetEvidence(context, sessionId, record);
  }
  return budgeted.messages;
}

async function streamFinalModelAnswerWithoutTools(
  continuation: PendingModelContinuation,
  context: TuiContext,
  gateway: ModelGateway,
  sessionId: string,
  output: Writable,
  signal: AbortSignal,
  // D.13V — 外层（sendMessage / continueModelAfterToolResults）已经在用某个
  // assistantStreamBlockId 累计 round 文本，这里复用同一 id，downgrade/discard
  // 才能命中真实 block。不传则保持旧行为新建一个 final 专用 id。
  reuseAssistantStreamBlockId?: string,
  fallbackAttempted = false,
): Promise<string> {
  let assistantText = "";
  const textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
  // 与 sendMessage 一致的 assistant streaming block：避免最后一轮 assistant 文本
  // 被 _write 的 ephemeral splice 淘汰，保证完整正文落到 keep:true block。
  const assistantStreamBlockId =
    reuseAssistantStreamBlockId ?? `assistant-stream-final-${randomUUID()}`;
  if (!reuseAssistantStreamBlockId) {
    beginAssistantStream(output, assistantStreamBlockId);
  }
  let chunkCount = 0;
  let hadUsage = false;
  let finishReason: string | undefined;
  let hadThinking = false;
  let ignoredRawToolProtocolText = false;
  const runtime = runtimeFromContinuation(continuation);
  const preflight = await prepareMessagesForProviderPreflight({
    messages: continuation.messages,
    context,
    sessionId,
    runtime,
    trigger: "final",
    deps: compactPreflightDeps,
  });
  if (preflight.blocked) {
    writeLine(output, preflight.message);
    return "";
  }
  if (checkAndWriteProviderCooldown(context, runtime, output)) {
    return "";
  }
  continuation.messages = preflight.messages;
  const promptCacheFields = await buildPromptCacheRequestFields(context);
  for await (const event of gateway.stream(
    continuation.provider,
    {
      messages: preflight.messages,
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
      endAssistantStream(output);
      writeLine(output, t(context, "toolInterrupted"));
      return assistantText;
    }
    if (event.type === "assistant_text_delta") {
      clearRequestActivity(context);
      const visibleText = textSanitizer.push(event.text);
      assistantText += visibleText;
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
      const visibleText = textSanitizer.flush();
      assistantText += visibleText;
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
      const currentRuntime = runtimeFromContinuation(continuation);
      await recordProviderFailureEvidence(context, sessionId, event.error, currentRuntime);
      recordProviderFailure(
        context.providerBreaker,
        continuation.provider,
        continuation.model,
        event.error.code ?? "UNKNOWN",
      );
      const fallback = fallbackAttempted
        ? undefined
        : resolveRuntimeFallback(context, currentRuntime, event.error);
      if (fallback) {
        await recordProviderFallbackAttempt(context, sessionId, {
          from: currentRuntime,
          to: fallback.runtime,
          kind: fallback.kind,
          code: fallback.code,
          status: "attempted",
        });
        writeLine(output, context.lastProviderFallbackAttempt?.summary ?? "");
        continuation.provider = fallback.runtime.provider;
        continuation.model = fallback.runtime.model;
        continuation.endpointProfile = fallback.runtime.endpointProfile;
        continuation.reasoningLevel = fallback.runtime.reasoningLevel;
        continuation.reasoningSent = fallback.runtime.reasoningSent;
        if (checkAndWriteProviderCooldown(context, fallback.runtime, output)) {
          return assistantText;
        }
        return (
          assistantText +
          (await streamFinalModelAnswerWithoutTools(
            continuation,
            context,
            gateway,
            sessionId,
            output,
            signal,
            assistantStreamBlockId,
            true,
          ))
        );
      }
      writeErrorLine(output, formatProviderFailurePrimary(event.error, context.language));
      return assistantText;
    }
  }
  const finalVisibleText = textSanitizer.flush();
  assistantText += finalVisibleText;
  if (textSanitizer.hadRawToolProtocol()) {
    ignoredRawToolProtocolText = true;
    assistantText = "";
    discardAssistantBlock(output, assistantStreamBlockId);
    await appendSystemEvent(
      context,
      sessionId,
      "final_no_tools_raw_tool_protocol_as_text",
      "warning",
    );
  }
  if (!assistantText) {
    clearRequestActivity(context);
    if (ignoredRawToolProtocolText) {
      writeLine(output, formatRawToolProtocolRetryFailure(context.language));
    } else {
      const result = await recordProviderEmptyResponse(
        context,
        sessionId,
        chunkCount,
        hadUsage,
        finishReason,
        hadThinking,
      );
      if (result.isError) {
        writeErrorLine(output, result.message);
      } else {
        writeLine(output, result.message);
      }
    }
  }
  if (assistantText) {
    const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
    if (verdict.status === "needs_disclaimer") {
      assistantText = await downgradeUnsupportedFinalAnswer(
        assistantText,
        verdict,
        context,
        sessionId,
        output,
        assistantStreamBlockId,
      );
    }
    const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
    if (extended.status === "needs_disclaimer") {
      await appendSystemEvent(
        context,
        sessionId,
        `final_answer_extended_gate downgrade kinds=${extended.verdict.unsupportedKinds.join(",")}`,
        "warning",
      );
      assistantText = buildExtendedDowngradedFinalAnswer(
        assistantText,
        extended.verdict,
        context.language,
      );
      replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
    }
    const visibleAssistantText = stripStructuredFinalAnswerClaims(assistantText);
    if (visibleAssistantText !== assistantText) {
      assistantText = visibleAssistantText;
      replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
    }
  }
  if (assistantText) {
    writeAssistantDelta(output, assistantStreamBlockId, assistantText);
  }
  // D.13V — 仅当我们自己 begin 的 stream 才负责 end；复用外层 id 时由外层 end。
  if (!reuseAssistantStreamBlockId) {
    endAssistantStream(output);
  }
  clearProviderBreaker(context.providerBreaker, continuation.provider, continuation.model);
  if (
    context.lastProviderFallbackAttempt?.toProvider === continuation.provider &&
    context.lastProviderFallbackAttempt.toModel === continuation.model &&
    context.lastProviderFallbackAttempt.status === "attempted"
  ) {
    context.lastProviderFallbackAttempt.status = "succeeded";
    context.lastProviderFallbackAttempt.createdAt = new Date().toISOString();
    await appendSystemEvent(
      context,
      sessionId,
      `provider fallback attempt: status succeeded; to ${continuation.provider}/${continuation.model}`,
      "info",
    );
  }
  return assistantText;
}

async function downgradeUnsupportedFinalAnswer(
  assistantText: string,
  verdict: FinalAnswerClaimVerdict,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  assistantStreamBlockId: string,
): Promise<string> {
  await appendSystemEvent(
    context,
    sessionId,
    `final_answer_claim_gate downgrade kinds=${verdict.unsupportedKinds.join(",")}`,
    "warning",
  );
  const downgraded = buildDowngradedFinalAnswer(assistantText, verdict, context.language);
  replaceAssistantBlockContent(output, assistantStreamBlockId, downgraded);
  const isBenignSecretSafety =
    (/secret|api[_\s-]?key|密钥|安全|不应|不能|建议|避免|谨慎/iu.test(assistantText) &&
      !/代码里|调用链是|\bin\s+the\s+code\b|\bcall\s+chain\s+is\b/iu.test(assistantText)) ||
    verdict.unsupportedKinds.length === 0;
  if (!isBenignSecretSafety) {
    await captureFailureLearning(context, sessionId, {
      category: "final_gate_downgrade",
      failureSummary: `final answer downgraded: unsupported claim kinds=${verdict.unsupportedKinds.join(",")}`,
      rootCauseGuess: "claimed completion/verification/fact without supporting evidence",
      avoidNextTime:
        "Only declare completion/verification/fixed when matching evidence exists; otherwise remove the claim or gather evidence first",
      sourceRef: "event:final_answer_claim_gate",
      relatedTarget: verdict.unsupportedKinds.join(","),
      severity: "high",
    });
  }
  return downgraded;
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
  let finalAnswerClaimRetried = false;
  const assistantEventId = randomUUID();
  // 每轮 round 都会开新的 streaming block，避免不同轮的输出粘到同一行。
  let assistantStreamBlockId = `assistant-stream-cont-${assistantEventId}-0`;
  beginAssistantStream(output, assistantStreamBlockId);
  const sessionId = await ensureSession(context);
  try {
    let evidenceRounds = 0;
    let consecutiveTodoOnlyRounds = 0;
    let totalPlanningOnlyRounds = 0;
    let todoOnlyHintSent = false;
    let rawToolProtocolTextRetries = 0;
    let runtimeFallbackAttempted = false;
    continuationRoundLoop: for (let round = 0; round < MAX_MODEL_TOTAL_TOOL_ROUNDS; round += 1) {
      if (round > 0) {
        assistantStreamBlockId = `assistant-stream-cont-${assistantEventId}-${round}`;
        beginAssistantStream(output, assistantStreamBlockId);
      }
      const toolCalls: ModelToolCall[] = [];
      let roundAssistantText = "";
      const textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
      const continuationRuntime = runtimeFromContinuation(continuation);
      const preflight = await prepareMessagesForProviderPreflight({
        messages: continuation.messages,
        context,
        sessionId,
        runtime: continuationRuntime,
        trigger: "continuation",
        deps: compactPreflightDeps,
      });
      if (preflight.blocked) {
        clearRequestActivity(context);
        writeLine(output, preflight.message);
        writeStatus(output, context);
        return;
      }
      if (checkAndWriteProviderCooldown(context, continuationRuntime, output)) {
        clearRequestActivity(context);
        writeStatus(output, context);
        return;
      }
      continuation.messages = preflight.messages;
      const requestMessages = preflight.messages;
      const promptCacheFields = await buildPromptCacheRequestFields(context);
      for await (const event of gateway.stream(
        continuation.provider,
        {
          messages: requestMessages,
          model: continuation.model,
          endpointProfile: continuation.endpointProfile,
          ...(continuation.reasoningSent ? { reasoningLevel: continuation.reasoningLevel } : {}),
          tools: createModelToolDefinitionsForReportGuard(continuation.reportWriteGuard),
          toolChoice: "auto",
          ...promptCacheFields,
        },
        controller.signal,
      )) {
        // D.13O — abort 后必须早返回，迟到的 SSE delta 不再写主屏 / transcript /
        // continuation messages。与 sendMessage 顶层的 controller.signal.aborted
        // 早返回保持一致。
        if (controller.signal.aborted) {
          clearRequestActivity(context);
          endAssistantStream(output);
          writeLine(output, t(context, "toolInterrupted"));
          return;
        }
        if (event.type === "assistant_text_delta") {
          clearRequestActivity(context);
          const visibleText = textSanitizer.push(event.text);
          assistantText += visibleText;
          roundAssistantText += visibleText;
          if (visibleText) {
            writeAssistantDelta(output, assistantStreamBlockId, visibleText);
          }
          continue;
        }
        if (event.type === "tool_use") {
          const visibleText = textSanitizer.flush();
          assistantText += visibleText;
          roundAssistantText += visibleText;
          if (visibleText) {
            writeAssistantDelta(output, assistantStreamBlockId, visibleText);
          }
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
          const currentRuntime = runtimeFromContinuation(continuation);
          await recordProviderFailureEvidence(context, sessionId, event.error, currentRuntime);
          recordProviderFailure(
            context.providerBreaker,
            continuation.provider,
            continuation.model,
            event.error.code ?? "UNKNOWN",
          );
          const fallback = runtimeFallbackAttempted
            ? undefined
            : resolveRuntimeFallback(context, currentRuntime, event.error);
          if (fallback) {
            runtimeFallbackAttempted = true;
            await recordProviderFallbackAttempt(context, sessionId, {
              from: currentRuntime,
              to: fallback.runtime,
              kind: fallback.kind,
              code: fallback.code,
              status: "attempted",
            });
            writeLine(output, context.lastProviderFallbackAttempt?.summary ?? "");
            continuation.provider = fallback.runtime.provider;
            continuation.model = fallback.runtime.model;
            continuation.endpointProfile = fallback.runtime.endpointProfile;
            continuation.reasoningLevel = fallback.runtime.reasoningLevel;
            continuation.reasoningSent = fallback.runtime.reasoningSent;
            if (checkAndWriteProviderCooldown(context, fallback.runtime, output)) {
              writeStatus(output, context);
              return;
            }
            continue continuationRoundLoop;
          }
          writeErrorLine(output, formatProviderFailurePrimary(event.error, context.language));
          return;
        }
      }
      const finalVisibleText = textSanitizer.flush();
      assistantText += finalVisibleText;
      roundAssistantText += finalVisibleText;
      if (finalVisibleText) {
        writeAssistantDelta(output, assistantStreamBlockId, finalVisibleText);
      }
      if (textSanitizer.hadRawToolProtocol() && toolCalls.length === 0) {
        await appendSystemEvent(
          context,
          sessionId,
          "assistant_raw_tool_protocol_as_text",
          "warning",
        );
        discardAssistantBlock(output, assistantStreamBlockId);
        assistantText = "";
        roundAssistantText = "";
        if (rawToolProtocolTextRetries < MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES) {
          continuation.messages.push({
            role: "user",
            content: createRawToolProtocolReminder(context.language),
          });
          rawToolProtocolTextRetries += 1;
          continue;
        }
        writeLine(output, formatRawToolProtocolRetryFailure(context.language));
        break;
      }
      if (roundAssistantText || toolCalls.length > 0) {
        continuation.messages.push({
          role: "assistant",
          content: truncateRoundAssistantForProvider(roundAssistantText, context),
          toolCalls,
        });
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
        // D.13U — Final Answer Claim Gate（仅一次自我修正，continuation 镜像）
        if (!finalAnswerClaimRetried && assistantText) {
          const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
          if (verdict.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_claim_gate retry kinds=${verdict.unsupportedKinds.join(",")}`,
              "warning",
            );
            continuation.messages.push({
              role: "user",
              content: createFinalAnswerClaimReminder(verdict, context.language),
            });
            finalAnswerClaimRetried = true;
            assistantText = "";
            // D.13V — 同步丢弃 continuation 当前 streaming block 累计的违规原文。
            discardAssistantBlock(output, assistantStreamBlockId);
            continue;
          }
        }
        // D.13V-B — Architecture / Completeness Final Gate（continuation 镜像）
        if (!finalAnswerClaimRetried && assistantText) {
          const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
          if (extended.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_extended_gate retry kinds=${extended.verdict.unsupportedKinds.join(",")}`,
              "warning",
            );
            continuation.messages.push({
              role: "user",
              content: createExtendedFinalAnswerReminder(extended.verdict, context.language),
            });
            finalAnswerClaimRetried = true;
            assistantText = "";
            discardAssistantBlock(output, assistantStreamBlockId);
            continue;
          }
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
      const todoOnly = isTodoOnlyRound(toolCalls);
      if (todoOnly) {
        consecutiveTodoOnlyRounds += 1;
      } else {
        consecutiveTodoOnlyRounds = 0;
        evidenceRounds += 1;
      }
      for (const toolCall of toolCalls) {
        const result = await executeModelToolUse(
          toolCall,
          context,
          sessionId,
          output,
          continuation,
        );
        await recordModelToolFailureForMetaScheduler(context, sessionId, result);
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
      if (todoOnly) {
        totalPlanningOnlyRounds += 1;
      }
      if (todoOnly && consecutiveTodoOnlyRounds > MAX_TODO_ONLY_CONSECUTIVE_ROUNDS) {
        if (!todoOnlyHintSent) {
          const todoHint =
            context.language === "en-US"
              ? "Planning recorded. Please proceed with verification tools (Read/Grep/Bash/GitStatusInspect) or provide an unverified conclusion."
              : "计划已记录。请继续执行验证工具（Read/Grep/Bash/GitStatusInspect）或给出尚未验证结论。";
          continuation.messages.push({ role: "user", content: todoHint });
          todoOnlyHintSent = true;
          continue;
        }
      }
      const reachedTotalLimit = round + 1 >= MAX_MODEL_TOTAL_TOOL_ROUNDS;
      if (reachedTotalLimit) {
        const onlyPlanning = evidenceRounds === 0;
        const limitMsg = onlyPlanning
          ? context.language === "en-US"
            ? `Continuation execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_ROUNDS} turns. Only planning/Todo was executed; no repository verification was performed.`
            : `续轮执行轮次预算已耗尽（${MAX_MODEL_TOTAL_TOOL_ROUNDS} 轮）。仅完成计划整理，尚未执行仓库验证。如需验证请运行对应命令或重新发起请求。`
          : context.language === "en-US"
            ? `Continuation execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_ROUNDS} turns. Summarizing with what was gathered so far; no further tools will run. If an action still needs to finish (for example refreshing the index), run the matching command such as /index refresh, or send the request again.`
            : `续轮执行轮次预算已耗尽（${MAX_MODEL_TOTAL_TOOL_ROUNDS} 轮）。将基于目前已收集的信息给出回答，不再继续调用工具。如果还有动作需要完成（例如刷新索引），请运行对应命令（如 /index refresh）或重新发起请求。`;
        writeLine(output, limitMsg);
        const finalText = await streamFinalModelAnswerWithoutTools(
          continuation,
          context,
          gateway,
          sessionId,
          output,
          controller.signal,
          assistantStreamBlockId,
        );
        assistantText += finalText;
        break;
      }
    }
    if (assistantText) {
      // D.13U — 最后一道关卡：所有 final answer（含预算耗尽后的 no-tool summary）
      // 入 transcript 前都必须 gate；没有 retry 机会时直接降级，原文不入 transcript。
      {
        const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
        if (verdict.status === "needs_disclaimer") {
          assistantText = await downgradeUnsupportedFinalAnswer(
            assistantText,
            verdict,
            context,
            sessionId,
            output,
            assistantStreamBlockId,
          );
        }
        const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
        if (extended.status === "needs_disclaimer") {
          await appendSystemEvent(
            context,
            sessionId,
            `final_answer_extended_gate downgrade kinds=${extended.verdict.unsupportedKinds.join(",")}`,
            "warning",
          );
          assistantText = buildExtendedDowngradedFinalAnswer(
            assistantText,
            extended.verdict,
            context.language,
          );
          replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
        }
        const visibleAssistantText = stripStructuredFinalAnswerClaims(assistantText);
        if (visibleAssistantText !== assistantText) {
          assistantText = visibleAssistantText;
          replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
        }
      }
      // D.14D — main-screen prompt hygiene（与 sendMessage 同款），continuation 路径
      // 同样在 assistant 文本进主屏前清掉内部 system-prompt 字段复述；必须在
      // final-answer gate 之后执行，避免提前移除 LinghunFinalAnswerClaims 契约。
      {
        const sanitized = sanitizeMainScreenLeakage(assistantText, context.language);
        if (sanitized !== assistantText) {
          assistantText = sanitized;
          replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
        }
      }
      output.write("\n");
      await context.store.appendEvent(sessionId, {
        type: "assistant_text_delta",
        id: assistantEventId,
        text: assistantText,
        createdAt: new Date().toISOString(),
      });
    }
    clearProviderBreaker(context.providerBreaker, continuation.provider, continuation.model);
    if (
      context.lastProviderFallbackAttempt?.toProvider === continuation.provider &&
      context.lastProviderFallbackAttempt.toModel === continuation.model &&
      context.lastProviderFallbackAttempt.status === "attempted"
    ) {
      context.lastProviderFallbackAttempt.status = "succeeded";
      context.lastProviderFallbackAttempt.createdAt = new Date().toISOString();
      await appendSystemEvent(
        context,
        sessionId,
        `provider fallback attempt: status succeeded; to ${continuation.provider}/${continuation.model}`,
        "info",
      );
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
): Promise<{ message: string; isError: boolean }> {
  const provider = getRuntimeStatusProvider(context);
  const model = context.model;
  const metadata = [
    `provider ${provider}`,
    `model=${model}`,
    `chunkCount=${chunkCount}`,
    `hadUsage=${hadUsage ? "yes" : "no"}`,
    `hadThinking=${hadThinking ? "yes" : "no"}`,
    `finishReason=${finishReason ?? "unknown"}`,
  ].join("; ");
  // D.14H-F — reasoning-only stream（DeepSeek v4 pro 等 reasoning-first 模型）不再被
  // 视为 provider empty/FAIL。evidence 标记为 provider_reasoning_only，级别为 info。
  if (hadThinking) {
    const evidence = createEvidenceRecord(
      "command_output",
      `provider_reasoning_only: ${metadata}`,
      `provider:${provider}:model:${model}`,
      ["provider_reasoning_only", "reasoning_stream_observed", provider, model],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendSystemEvent(context, sessionId, `provider_reasoning_only: ${metadata}`, "info");
    return { message: formatProviderThinkingOnlyResponsePrimary(context.language), isError: false };
  }
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
  return { message: formatProviderEmptyResponsePrimary(context.language), isError: true };
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

function createRawToolProtocolReminder(language: Language): string {
  return language === "en-US"
    ? "Use structured tool calls when you need a tool. Do not write raw tool protocol, XML, JSON tool_use blocks, or tool schemas as assistant text. Retry the answer using real tool calls or concise plain text."
    : "需要使用工具时请发起结构化工具调用。不要把 raw tool protocol、XML、JSON tool_use 块或工具 schema 写成 assistant 正文。请用真实工具调用或简短正文重试。";
}

function formatRawToolProtocolRetryFailure(language: Language): string {
  return language === "en-US"
    ? "The model returned tool protocol as plain text again. I did not run any unstructured tool request; please retry or use an explicit slash command."
    : "模型再次把工具协议写成了正文。Linghun 没有执行任何非结构化工具请求；请重试或使用明确的 slash 命令。";
}

function isTodoOnlyRound(toolCalls: ModelToolCall[]): boolean {
  if (toolCalls.length === 0) return false;
  return toolCalls.every((tc) => tc.name === "Todo");
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
    toolCall.name === EXECUTE_EXTRA_TOOL_NAME ||
    toolCall.name === COMMAND_PROPOSAL_TOOL_NAME
  ) {
    return executeDeferredDispatchToolUse(toolCall, context, sessionId, output);
  }
  // D.14G — 结构化 Git 能力不走 builtInTools / runTool / 四档 permission；由
  // git-tool-dispatch-runtime 真实执行（status 只读；create safe-create；remove 走确认）。
  if (isGitToolName(toolCall.name)) {
    const gitResult = await executeGitToolUse(
      toolCall,
      context,
      sessionId,
      output,
      gitToolDispatchDeps,
      continuation,
    );
    // D.14B — git 操作真实失败转 failure learning。pendingApproval（等待用户确认）
    // 不是失败，不记录；只有 runtime 真正失败/拒绝（ok=false 且非 pending）才记。
    if (!gitResult.ok && !gitResult.pendingApproval) {
      await captureFailureLearning(context, sessionId, {
        category: "git_operation_failure",
        failureSummary: `git operation failed: ${gitResult.text}`,
        rootCauseGuess: `${toolCall.name} git operation failed or was rejected by runtime validation`,
        avoidNextTime:
          "Check repo/worktree state and arguments before retrying the git operation; do not claim it succeeded",
        sourceRef: gitResult.evidenceId
          ? `evidence:${gitResult.evidenceId}`
          : `tool:${toolCall.name}`,
        relatedTarget: toolCall.name,
        severity: "medium",
      });
    }
    return gitResult;
  }
  // D.14D-R P0-2 — 结构化索引工具不走 builtInTools / runTool；只读 Inspect 直接执行，
  // mutating Refresh/Repair 走既有 pendingLocalApproval / PermissionPanel 确认管道。
  if (isIndexToolName(toolCall.name)) {
    return executeIndexToolUse(toolCall, context, sessionId, output, continuation);
  }
  if (
    toolCall.name === START_AGENT_TOOL_NAME ||
    toolCall.name === AGENT_CONTROL_TOOL_NAME ||
    toolCall.name === SEND_MESSAGE_TOOL_NAME ||
    toolCall.name === RUN_WORKFLOW_TOOL_NAME ||
    toolCall.name === INDEX_OPERATION_TOOL_NAME ||
    toolCall.name === RUN_VERIFICATION_TOOL_NAME ||
    toolCall.name === WRITE_REPORT_TOOL_NAME
  ) {
    return executeLinghunControlToolUse(toolCall, context, sessionId, output, continuation);
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
  if (permission.autoAllowReadonly) {
    // D.13N — engine short-circuited this tool to auto_allow_readonly.
    // Record a structured event for transparency. Payload is sanitized: the
    // engine returns redactedSummary, never raw command text or absolute
    // sensitive paths, so this event is safe to ship in transcripts.
    const verdict = permission.autoAllowReadonly;
    await appendSystemEvent(
      context,
      sessionId,
      `permission auto allow readonly: tool ${toolName}; semantic ${verdict.semantic}; path safety ${verdict.pathSafety}; summary ${verdict.redactedSummary}; reason ${verdict.reason}`,
      "info",
    );
  }
  if (permission.decision !== "allow") {
    clearRequestActivity(context);
    const text = `${permission.decision}: ${permission.reason}`;
    const isAskWithPanel =
      permission.decision === "ask" &&
      (toolName === "Write" ||
        toolName === "Edit" ||
        toolName === "MultiEdit" ||
        toolName === "Bash");
    // P0-1 — ink 主屏的提权 UI 必须是 PermissionPanel（pendingLocalApproval →
    // mapPendingApprovalToPermission → view.permission），不得用 writeLine 把
    // "Linghun 想执行 …？yes/no" 当作普通 assistant/output 文本糊到主屏。
    // ink ask 路径只设 pendingLocalApproval，由 PermissionPanel 渲染；
    // plain TUI / 非交互 / 测试仍走文本 yes/no fallback（保留既有断言）。
    if (!(context.isInkSession && isAskWithPanel)) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
    }
    if (isAskWithPanel) {
      context.pendingLocalApproval = {
        kind: "model_tool_use",
        toolCall,
        toolName,
        sessionId,
        continuation: continuation
          ? createSingleToolCallContinuation(continuation, toolCall)
          : undefined,
        verdict: permission.verdict,
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
  const boundaryPreflight = await runBoundaryEditPreflight(toolCall, toolName, context);
  if (boundaryPreflight.decision === "confirm") {
    clearRequestActivity(context);
    const prompt = formatBoundaryEditPreflightPrompt(boundaryPreflight, context.language);
    if (!context.isInkSession) {
      writeLine(output, prompt);
    }
    context.pendingLocalApproval = {
      kind: "model_tool_use",
      toolCall,
      toolName,
      sessionId,
      continuation: continuation
        ? createSingleToolCallContinuation(continuation, toolCall)
        : undefined,
      verdict: permission.verdict,
      boundaryPreflight,
    };
    await appendSystemEvent(
      context,
      sessionId,
      `architecture_boundary_preflight_confirm: tool=${toolName} path=${boundaryPreflight.path} lines=${boundaryPreflight.lineCount} added=${boundaryPreflight.estimatedAddedLines}`,
      "warning",
    );
    return { ok: false, tool: toolName, text: boundaryPreflight.reason, pendingApproval: true };
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

async function runBoundaryEditPreflight(
  toolCall: ModelToolCall,
  toolName: ToolName,
  context: TuiContext,
): Promise<BoundaryEditPreflightResult> {
  if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") {
    return { decision: "allow", reason: "not an edit tool" };
  }
  const [path] = collectInputFiles(toolCall.input);
  if (!path || isReportArtifactPath(path)) {
    return { decision: "allow", reason: "no path or report artifact" };
  }
  const absolutePath = resolve(context.projectPath, path);
  try {
    const source = await readFile(absolutePath, "utf8");
    return checkBoundaryEditPreflight({
      toolName,
      path,
      existingSource: source,
      targetExists: true,
      input: toolCall.input,
      reportArtifact: false,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { decision: "allow", reason: "target does not exist" };
    }
    return { decision: "allow", reason: "target not readable by boundary preflight" };
  }
}

function isReportArtifactPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const fileName = normalized.split("/").pop() ?? normalized;
  return /\.md$/u.test(fileName) && (fileName === "report.md" || /report|报告/u.test(fileName));
}

function formatBoundaryEditPreflightPrompt(
  preflight: BoundaryEditPreflightResult & { decision: "confirm" },
  language: Language,
): string {
  if (language === "en-US") {
    return [
      `Architecture boundary check paused ${preflight.path}.`,
      `Existing file has ${preflight.lineCount} lines; this edit appears to add about ${preflight.estimatedAddedLines} lines.`,
      "Choose yes to continue this minimal local edit, or no to ask the assistant for a split plan.",
    ].join("\n");
  }
  return [
    `架构边界检查已暂停 ${preflight.path}。`,
    `目标文件已有 ${preflight.lineCount} 行，本次看起来会新增约 ${preflight.estimatedAddedLines} 行。`,
    "输入 yes 继续这次最小局部改动；输入 no 让模型改为拆分计划或更小改动。",
  ].join("\n");
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
    const evidence = await recordToolEvidence(
      context,
      sessionId,
      toolName,
      result.output,
      toolCall.input,
    );
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
    if (isError) {
      // D.14B — Bash/command 退出码非 0（非异常）也是真实失败。
      await captureFailureLearning(context, sessionId, {
        category: "tool_failure",
        failureSummary: `${toolName} exited non-zero: ${result.output.text}`,
        rootCauseGuess: `${toolName} command returned a non-zero exit code`,
        avoidNextTime:
          "Inspect the command output and exit code; fix the underlying cause before claiming the command passed",
        sourceRef: evidence?.id ? `evidence:${evidence.id}` : `tool:${toolName}`,
        relatedTarget: toolName,
        severity: "medium",
      });
    }
    clearBackgroundAbortController(context, task?.id ?? "");
    if (backgroundController) {
      context.tools.abortSignal = previousAbortSignal;
    }
    const userFacingToolOutput = formatModelToolOutput(
      toolName,
      result.output,
      context.language,
      evidence?.id,
      reportWriteGuard,
    );
    if (toolName === "Bash") {
      writeLocalCommandOutputLine(output, userFacingToolOutput);
    } else {
      writeLine(output, userFacingToolOutput);
    }
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
    await captureFailureLearning(context, sessionId, {
      category: "tool_failure",
      failureSummary: text,
      rootCauseGuess: `${toolName} tool threw an error during execution`,
      avoidNextTime: `Re-check ${toolName} inputs/preconditions before retrying; verify the error, do not assume it succeeded`,
      sourceRef: `evidence:${evidence.id}`,
      relatedTarget: toolName,
      severity: "medium",
    });
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
    const input = (
      toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
        ? toolCall.input
        : {}
    ) as Record<string, unknown>;
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
      // D.13V-C — 主屏只显示降噪后的产品文案；raw text 已经写入 tool_result store，
      // doctor / details / Ctrl+O 仍可看到。
      writeLine(
        output,
        sanitizeDeferredToolPrimaryText(result.text, context.language, {
          dispatchKind: "SearchExtraTools",
          ok: true,
          matchedCount: result.data.total,
        }),
      );
      return {
        ok: true,
        tool: dispatchName,
        text: result.text,
        data: result.data,
        evidenceId: evidence?.id,
      };
    }
    if (dispatchName === COMMAND_PROPOSAL_TOOL_NAME) {
      const commandRaw = input.command;
      const reasonRaw = input.reason;
      const command = typeof commandRaw === "string" ? commandRaw.trim() : "";
      const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
      if (!command.startsWith("/")) {
        const text =
          context.language === "en-US"
            ? "Command proposal must be an explicit slash command."
            : "命令提案必须是明确的 slash command。";
        await appendDeferredToolResultEvent(
          context,
          sessionId,
          toolCall.id,
          dispatchName,
          text,
          true,
        );
        clearRequestActivity(context);
        return { ok: false, tool: dispatchName, text };
      }
      const structuredTool = executableCommandProposalTool(command);
      if (structuredTool) {
        const text =
          context.language === "en-US"
            ? `CommandProposal is not allowed for executable ${structuredTool} requests. Call the real structured tool instead.`
            : `CommandProposal 不能用于可执行的 ${structuredTool} 请求。请改用真实结构化工具调用。`;
        await appendDeferredToolResultEvent(
          context,
          sessionId,
          toolCall.id,
          dispatchName,
          text,
          true,
        );
        clearRequestActivity(context);
        return { ok: false, tool: dispatchName, text };
      }
      const text =
        context.language === "en-US"
          ? `Suggested command: ${command}${reason ? ` (${reason})` : ""}`
          : `建议命令：${command}${reason ? `（${reason}）` : ""}`;
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        dispatchName,
        { command, reason },
        false,
      );
      clearRequestActivity(context);
      writeLine(output, text);
      return { ok: true, tool: dispatchName, text, data: { command, reason } };
    }
    // ExecuteExtraTool
    // D.13N — record a policy engine verdict for transparency. The actual
    // gate (whitelist + mutating flags inside executeExtraTool) is unchanged;
    // this event is the auditable proof that ExecuteExtraTool runs through
    // the same classifier as built-in tools, so dispatch never silently
    // bypasses permission policy.
    const requestedToolName = typeof input.tool_name === "string" ? input.tool_name : "(unknown)";
    const deferredVerdict = classifyToolRequest({
      toolName: requestedToolName,
      input: input.params,
      workspaceRoot: context.projectPath,
      isDeferred: true,
      manifestReadOnly:
        isCodebaseMemoryToolName(requestedToolName) &&
        getCodebaseMemoryToolRisk(requestedToolName) === "readonly",
    });
    if (deferredVerdict.decision === "auto_allow_readonly") {
      await appendSystemEvent(
        context,
        sessionId,
        `permission auto allow readonly: tool ExecuteExtraTool; target ${deferredVerdict.redactedSummary}; semantic ${deferredVerdict.semantic}; reason ${deferredVerdict.reason}`,
        "info",
      );
    } else {
      await appendSystemEvent(
        context,
        sessionId,
        `permission policy require: tool ExecuteExtraTool; target ${deferredVerdict.redactedSummary}; semantic ${deferredVerdict.semantic}; reason ${deferredVerdict.reason}`,
        "info",
      );
    }
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
      // D.13V-C — 失败也要降噪：主屏不暴露 ExecuteExtraTool / dispatcher 等内部词。
      writeLine(
        output,
        sanitizeDeferredToolPrimaryText(result.text, context.language, {
          dispatchKind: "ExecuteExtraTool",
          ok: false,
        }),
      );
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
    writeLine(
      output,
      sanitizeDeferredToolPrimaryText(result.text, context.language, {
        dispatchKind: "ExecuteExtraTool",
        ok: true,
      }),
    );
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

async function executeLinghunControlToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation?: PendingModelContinuation,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  pendingApproval?: boolean;
}> {
  startRequestActivity(output, context, "tool_running", { toolName: toolCall.name });
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: toolCall.id,
    name: toolCall.name,
    input: toolCall.input,
    createdAt: new Date().toISOString(),
  });
  try {
    if (toolCall.name === START_AGENT_TOOL_NAME) {
      const input = parseStartAgentToolInput(toolCall.input, context);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      const before = new Set(context.agents.map((agent) => agent.id));
      await handleForkCommand(buildForkArgsFromStartAgentInput(input, context), context, output);
      const agent = context.agents.find((item) => !before.has(item.id));
      const ok = agent?.status === "completed" || agent?.status === "idle" || agent?.status === "running";
      const text = agent
        ? `Agent ${agent.status}: ${agent.summary}`
        : formatStartAgentDidNotStartMessage(input, context);
      return await finishControlToolResult(toolCall, context, sessionId, output, text, !ok, {
        agentId: agent?.id,
        status: agent?.status ?? "blocked",
      });
    }
    if (toolCall.name === AGENT_CONTROL_TOOL_NAME) {
      const input = parseAgentControlToolInput(toolCall.input, context);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      if (input.action === "list") {
        await handleAgentsCommand(["list"], context, output);
        const cancellable = listCancellableAgents(context);
        return await finishControlToolResult(
          toolCall,
          context,
          sessionId,
          output,
          `Agent list inspected: ${context.agents.length} agent(s); cancellable ${cancellable.length}: ${cancellable.map((agent) => `${agent.id}:${agent.status}`).join(", ") || "none"}.`,
          false,
          {
            total: context.agents.length,
            cancellable: cancellable.map((agent) => ({ id: agent.id, status: agent.status })),
            teammates: context.agents.map((agent) => ({
              id: agent.id,
              role: agent.role,
              team: agent.teamName ?? null,
              status: agent.status,
              activity: agent.activityStatus ?? null,
              queuedMessages:
                agent.mailbox?.filter((message) => (message.status ?? "pending") === "pending")
                  .length ?? 0,
              activeTask: agent.activeTask
                ? { id: agent.activeTask.id, status: agent.activeTask.status }
                : null,
              recentResult: agent.lastResultSummary ?? agent.summary,
            })),
          },
        );
      }
      if (input.action === "cancel_all" || input.action === "stop_all") {
        const agents = await cancelAllAgents(context, output);
        return await finishControlToolResult(
          toolCall,
          context,
          sessionId,
          output,
          agents.length > 0
            ? `AgentControl ${input.action}: cancelled ${agents.length} agent(s).`
            : `AgentControl ${input.action}: no cancellable agents.`,
          false,
          { cancelled: agents.map((agent) => ({ id: agent.id, status: agent.status })) },
        );
      }
      if (input.action === "show") {
        await handleAgentsCommand(["show", input.agentRef ?? ""].filter(Boolean), context, output);
        const agent = findAgent(context, input.agentRef);
        return await finishControlToolResult(
          toolCall,
          context,
          sessionId,
          output,
          agent
            ? `Agent ${agent.status}: ${agent.summary}`
            : `Agent not found: ${input.agentRef ?? "latest"}`,
          !agent,
          { agentId: agent?.id, status: agent?.status ?? "not_found" },
        );
      }
      const agent = await cancelAgentByRef(input.agentRef, context, output);
      return await finishControlToolResult(
        toolCall,
        context,
        sessionId,
        output,
        agent
          ? `Agent cancelled: ${agent.summary}`
          : `Agent not found: ${input.agentRef ?? "latest"}`,
        !agent,
        { agentId: agent?.id, status: agent?.status ?? "not_found" },
      );
    }
    if (toolCall.name === SEND_MESSAGE_TOOL_NAME) {
      const input = parseSendMessageToolInput(toolCall.input);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      const result = await sendAgentMessage(context, { ...input, from: "model" });
      return await finishControlToolResult(
        toolCall,
        context,
        sessionId,
        output,
        result.text,
        !result.ok,
        {
          delivered: result.delivered,
        },
      );
    }
    if (toolCall.name === RUN_WORKFLOW_TOOL_NAME) {
      const input = parseRunWorkflowToolInput(toolCall.input);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      if (input.workflowId) {
        const registry = findRegistryWorkflow(context, input.workflowId);
        const registryAgent = findRegistryAgentWorkflow(context, input.workflowId);
        if (!registry && !registryAgent) {
          return await finishControlToolFailure(
            toolCall,
            context,
            sessionId,
            output,
            `Unknown workflowId: ${input.workflowId}`,
          );
        }
        const workflowGoal = input.goal ?? (input.inputs ? JSON.stringify(input.inputs) : "");
        if (registry) {
          await runRegistryWorkflow(registry, workflowGoal, input.runInBackground, context, output);
        } else if (registryAgent) {
          await runRegistryAgentWorkflow(
            registryAgent,
            workflowGoal,
            input.runInBackground,
            context,
            output,
          );
        }
      } else {
        await runWorkflowSteps(input.goal ?? "", context, output, input);
      }
      const run = context.workflows.activeRun;
      const ok =
        run?.status === "completed" || (input.runInBackground && run?.status === "running");
      const text = run
        ? formatWorkflowStartPrimary({
            language: context.language,
            steps: run.steps.length,
            currentPhase:
              run.steps.find((step) => step.status === "running")?.title ??
              run.steps.find((step) => step.status === "queued")?.title ??
              run.steps.at(-1)?.title ??
              "workflow",
            background: input.runInBackground && run.status === "running",
          })
        : "Workflow runtime did not start.";
      return await finishControlToolResult(toolCall, context, sessionId, output, text, !ok, {
        workflowId: run?.id,
        status: run?.status ?? "blocked",
        result: run?.result ?? "blocked",
        agents: input.agents,
        multiAgent: input.multiAgent,
        runningCap: input.runningCap,
        teamName: input.teamName,
      });
    }
    if (toolCall.name === INDEX_OPERATION_TOOL_NAME) {
      const input = parseIndexOperationToolInput(toolCall.input);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      const mappedName =
        input.action === "inspect"
          ? INDEX_STATUS_INSPECT
          : input.action === "repair"
            ? INDEX_REPAIR
            : INDEX_REFRESH;
      const mappedInput = { force: input.force };
      const action = input.action === "init_fast" ? "init fast" : undefined;
      return executeIndexToolUse(
        { id: toolCall.id, name: mappedName, input: mappedInput },
        context,
        sessionId,
        output,
        continuation,
        action,
        INDEX_OPERATION_TOOL_NAME,
        false,
      );
    }
    if (toolCall.name === RUN_VERIFICATION_TOOL_NAME) {
      const input = parseVerificationToolInput(toolCall.input);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      await runWorkflowVerificationStep(input.level, context, output);
      const report = context.lastVerification;
      const ok = report?.status === "pass";
      const text = report
        ? `Verification ${report.status.toUpperCase()}: ${report.summary}`
        : "Verification runner did not produce a report.";
      return await finishControlToolResult(toolCall, context, sessionId, output, text, !ok, {
        status: report?.status ?? "partial",
        reportId: report?.id,
      });
    }
    if (toolCall.name === WRITE_REPORT_TOOL_NAME) {
      return executeWriteReportToolUse(toolCall, context, sessionId, output, continuation);
    }
    return await finishControlToolFailure(
      toolCall,
      context,
      sessionId,
      output,
      `Unknown Linghun control tool: ${toolCall.name}`,
    );
  } finally {
    clearRequestActivity(context);
  }
}

function executableCommandProposalTool(command: string): string | undefined {
  const normalized = command.trim().toLowerCase();
  if (/^\/fork\b/u.test(normalized)) return START_AGENT_TOOL_NAME;
  if (/^\/agents?\b/u.test(normalized)) return AGENT_CONTROL_TOOL_NAME;
  if (/^\/workflows?\s+(?:run|plan|enable|disable|[^\s]+)/u.test(normalized)) {
    return RUN_WORKFLOW_TOOL_NAME;
  }
  if (/^\/index\b/u.test(normalized)) return INDEX_OPERATION_TOOL_NAME;
  if (/^\/verify\b/u.test(normalized)) return RUN_VERIFICATION_TOOL_NAME;
  if (/^\/(?:report|review)\b/u.test(normalized)) return WRITE_REPORT_TOOL_NAME;
  if (/^\/(?:write|edit|multiedit)\b/u.test(normalized)) return "Write/Edit";
  return undefined;
}

function parseStartAgentToolInput(
  input: unknown,
  context: TuiContext,
):
  | {
      ok: true;
      role: AgentType;
      task: string;
      name?: string;
      teamName?: string;
      runInBackground: boolean;
      cwd?: string;
      isolation?: "worktree";
      registryAgentId?: string;
    }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const rawRole =
    typeof obj.role === "string"
      ? obj.role
      : typeof obj.subagent_type === "string"
        ? obj.subagent_type
        : "";
  const task = obj.task;
  const registryAgent = !isAgentType(rawRole)
    ? context.agentRegistry.agents.find((agent) => agent.id === rawRole || agent.name === rawRole)
    : undefined;
  const role = isAgentType(rawRole)
    ? rawRole
    : registryAgent
      ? inferRegistryAgentRole(registryAgent)
      : undefined;
  if (!role || typeof task !== "string" || !task.trim()) {
    return {
      ok: false,
      text: "StartAgent requires role/subagent_type explorer|planner|worker|verifier and task.",
    };
  }
  const isolation = obj.isolation === "worktree" ? "worktree" : undefined;
  return {
    ok: true,
    role,
    task: task.trim(),
    ...(typeof obj.name === "string" && obj.name.trim() ? { name: obj.name.trim() } : {}),
    ...(typeof obj.teamName === "string" && obj.teamName.trim()
      ? { teamName: obj.teamName.trim() }
      : typeof obj.team_name === "string" && obj.team_name.trim()
        ? { teamName: obj.team_name.trim() }
        : {}),
    runInBackground: obj.runInBackground === true || obj.run_in_background === true,
    ...(typeof obj.cwd === "string" && obj.cwd.trim() ? { cwd: obj.cwd.trim() } : {}),
    ...(isolation ? { isolation } : {}),
    ...(registryAgent ? { registryAgentId: registryAgent.id } : {}),
  };
}

function inferRegistryAgentRole(agent: RegistryAgentDefinition): AgentType {
  const tools = agent.allowedTools ?? [];
  if (tools.some((tool) => ["Write", "Edit", "MultiEdit", "Bash"].includes(tool))) return "worker";
  return "planner";
}

export function __testFormatStartAgentDidNotStartMessage(
  input: Extract<ReturnType<typeof parseStartAgentToolInput>, { ok: true }>,
  context: TuiContext,
): string {
  return formatStartAgentDidNotStartMessage(input, context);
}

function formatStartAgentDidNotStartMessage(
  input: Extract<ReturnType<typeof parseStartAgentToolInput>, { ok: true }>,
  context: TuiContext,
): string {
  const workflowTaskId =
    context.workflows.activeRun?.status === "running" ? context.workflows.activeRun.id : undefined;
  const guard = checkBackgroundStartGuard(context, "agent", true, workflowTaskId);
  const route = resolveRoleRoute(context, getAgentRole(input.role), "StartAgent");
  const hints = [
    guard ? `resource=${guard}` : undefined,
    !route.usable
      ? `route=${formatRoutePauseMessage(getAgentRole(input.role), route.decision)}`
      : undefined,
    input.cwd ? `cwd=${input.cwd}` : undefined,
    input.isolation ? `isolation=${input.isolation}` : undefined,
  ].filter((item): item is string => Boolean(item));
  const suffix = hints.length > 0 ? ` ${hints.join(" | ")}` : "";
  return context.language === "en-US"
    ? `Agent runtime did not start: no AgentRun was persisted after StartAgent.${suffix} Check /background and /model doctor, then retry or run /fork manually.`
    : `Agent runtime 未启动：StartAgent 后没有持久化任何 AgentRun。${suffix} 请先查看 /background 和 /model doctor，必要时手动运行 /fork 重试。`;
}

function buildForkArgsFromStartAgentInput(
  input: Extract<ReturnType<typeof parseStartAgentToolInput>, { ok: true }>,
  _context: TuiContext,
): string[] {
  const args = [input.registryAgentId ?? input.role, input.task];
  if (input.runInBackground) args.push("--background");
  if (input.name) args.push("--name", input.name);
  if (input.teamName) args.push("--team", input.teamName);
  if (input.cwd) args.push("--cwd", input.cwd);
  if (input.isolation) args.push("--isolation", input.isolation);
  return args;
}

function parseAgentControlToolInput(
  input: unknown,
  context: TuiContext,
):
  | { ok: true; action: "list" | "show" | "cancel" | "cancel_all" | "stop_all"; agentRef?: string }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const action = obj.action;
  if (
    action !== "list" &&
    action !== "show" &&
    action !== "cancel" &&
    action !== "cancel_all" &&
    action !== "stop_all"
  ) {
    return {
      ok: false,
      text: "AgentControl requires action list|show|cancel|cancel_all|stop_all.",
    };
  }
  const ref =
    typeof obj.agentId === "string" && obj.agentId.trim()
      ? obj.agentId.trim()
      : typeof obj.agent_id === "string" && obj.agent_id.trim()
        ? obj.agent_id.trim()
        : typeof obj.ref === "string" && obj.ref.trim()
          ? obj.ref.trim()
          : undefined;
  if ((action === "show" || action === "cancel") && !ref && context.agents.length > 1) {
    return { ok: false, text: "AgentControl requires agentId/ref when multiple agents exist." };
  }
  return { ok: true, action, ...(ref ? { agentRef: ref } : {}) };
}

function parseSendMessageToolInput(input: unknown):
  | {
      ok: true;
      to?: string;
      name?: string;
      team?: string;
      teamName?: string;
      team_name?: string;
      targetType?: "id" | "name" | "team";
      broadcastTeam?: boolean;
      kind?: "message" | "task";
      taskId?: string;
      message: string;
    }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const message = obj.message;
  if (typeof message !== "string" || !message.trim()) {
    return { ok: false, text: "SendMessage requires message." };
  }
  const targetTypeRaw = obj.targetType ?? obj.target_type;
  const targetType =
    targetTypeRaw === "id" || targetTypeRaw === "name" || targetTypeRaw === "team"
      ? targetTypeRaw
      : undefined;
  return {
    ok: true,
    ...(typeof obj.to === "string" && obj.to.trim() ? { to: obj.to.trim() } : {}),
    ...(typeof obj.name === "string" && obj.name.trim() ? { name: obj.name.trim() } : {}),
    ...(typeof obj.team === "string" && obj.team.trim() ? { team: obj.team.trim() } : {}),
    ...(typeof obj.teamName === "string" && obj.teamName.trim()
      ? { teamName: obj.teamName.trim() }
      : {}),
    ...(typeof obj.team_name === "string" && obj.team_name.trim()
      ? { team_name: obj.team_name.trim() }
      : {}),
    ...(targetType ? { targetType } : {}),
    ...(obj.broadcastTeam === true || obj.broadcast_team === true ? { broadcastTeam: true } : {}),
    ...(obj.kind === "message" || obj.kind === "task" ? { kind: obj.kind } : {}),
    ...(typeof obj.taskId === "string" && obj.taskId.trim()
      ? { taskId: obj.taskId.trim() }
      : typeof obj.task_id === "string" && obj.task_id.trim()
        ? { taskId: obj.task_id.trim() }
        : {}),
    message: message.trim(),
  };
}

function parseRunWorkflowToolInput(input: unknown):
  | {
      ok: true;
      goal?: string;
      workflowId?: string;
      inputs?: Record<string, unknown>;
      runInBackground: boolean;
      agents?: number;
      multiAgent: boolean;
      runningCap?: number;
      teamName?: string;
    }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const goal = typeof obj.goal === "string" && obj.goal.trim() ? obj.goal.trim() : undefined;
  const workflowId =
    typeof obj.workflowId === "string" && obj.workflowId.trim()
      ? obj.workflowId.trim()
      : typeof obj.workflow_id === "string" && obj.workflow_id.trim()
        ? obj.workflow_id.trim()
        : undefined;
  const agents = normalizePositiveToolInt(obj.agents);
  const runningCap = normalizePositiveToolInt(obj.runningCap ?? obj.running_cap);
  const teamName =
    typeof obj.teamName === "string" && obj.teamName.trim()
      ? obj.teamName.trim()
      : typeof obj.team_name === "string" && obj.team_name.trim()
        ? obj.team_name.trim()
        : undefined;
  if (!goal && !workflowId) {
    return { ok: false, text: "RunWorkflow requires goal or workflowId." };
  }
  return {
    ok: true,
    ...(goal ? { goal } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(obj.inputs && typeof obj.inputs === "object" && !Array.isArray(obj.inputs)
      ? { inputs: obj.inputs as Record<string, unknown> }
      : {}),
    runInBackground: obj.runInBackground === true || obj.run_in_background === true,
    ...(agents ? { agents } : {}),
    multiAgent: obj.multiAgent === true || obj.multi_agent === true || Boolean(agents && agents > 1),
    ...(runningCap ? { runningCap } : {}),
    ...(teamName ? { teamName } : {}),
  };
}

export function __testParseRunWorkflowToolInput(input: unknown): ReturnType<typeof parseRunWorkflowToolInput> {
  return parseRunWorkflowToolInput(input);
}

function normalizePositiveToolInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function parseStringFieldToolInput(
  input: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const value = obj[field];
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, text: `${field} must be a non-empty string.` };
  }
  return { ok: true, value: value.trim() };
}

function parseIndexOperationToolInput(
  input: unknown,
):
  | { ok: true; action: "inspect" | "refresh" | "init_fast" | "repair"; force?: boolean }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const action = obj.action;
  if (
    action !== "inspect" &&
    action !== "refresh" &&
    action !== "init_fast" &&
    action !== "repair"
  ) {
    return { ok: false, text: "IndexOperation requires action inspect|refresh|init_fast|repair." };
  }
  return { ok: true, action, force: typeof obj.force === "boolean" ? obj.force : undefined };
}

function parseVerificationToolInput(
  input: unknown,
):
  | { ok: true; level: "smoke" | "focused" | "typecheck" | "test" | "build" | "lint" }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const level = obj.level;
  if (
    level !== "smoke" &&
    level !== "focused" &&
    level !== "typecheck" &&
    level !== "test" &&
    level !== "build" &&
    level !== "lint"
  ) {
    return { ok: false, text: "RunVerification requires a valid level." };
  }
  return { ok: true, level };
}

async function finishControlToolFailure(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  text: string,
) {
  return finishControlToolResult(toolCall, context, sessionId, output, text, true);
}

function controlToolEvidenceSpec(
  toolName: string,
  isError: boolean,
): { source: string; supportsClaims: string[] } {
  if (toolName === START_AGENT_TOOL_NAME) {
    return {
      source: "agent-execution",
      supportsClaims: isError
        ? ["tool_failure", "agent_execution"]
        : ["agent_execution", "action_executed"],
    };
  }
  if (toolName === RUN_WORKFLOW_TOOL_NAME) {
    return {
      source: "workflow-execution",
      supportsClaims: isError
        ? ["tool_failure", "workflow_execution"]
        : ["workflow_execution", "action_executed"],
    };
  }
  if (toolName === INDEX_OPERATION_TOOL_NAME) {
    return {
      source: "index-operation",
      supportsClaims: isError
        ? ["tool_failure", "index_operation"]
        : ["index_operation", "action_executed"],
    };
  }
  if (toolName === RUN_VERIFICATION_TOOL_NAME) {
    return {
      source: "verification-result",
      supportsClaims: isError
        ? ["tool_failure", "verification_result"]
        : ["verification_result", "verified", "已验证"],
    };
  }
  if (toolName === WRITE_REPORT_TOOL_NAME) {
    return {
      source: "report-write",
      supportsClaims: isError
        ? ["tool_failure", "report_write"]
        : ["report_write", "write_result", "action_executed"],
    };
  }
  return {
    source: `control-tool:${toolName}`,
    supportsClaims: isError ? ["tool_failure", toolName] : [toolName, "action_executed"],
  };
}

async function finishControlToolResult(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  text: string,
  isError: boolean,
  data?: unknown,
) {
  const spec = controlToolEvidenceSpec(toolCall.name, isError);
  const evidence = createEvidenceRecord(
    "command_output",
    `${toolCall.name}: ${truncateDisplay(text, 160)}`,
    spec.source,
    spec.supportsClaims,
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
  await appendDeferredToolResultEvent(
    context,
    sessionId,
    toolCall.id,
    toolCall.name,
    { text, data },
    isError,
    evidence?.id,
  );
  writeLine(output, text);
  return { ok: !isError, tool: toolCall.name, text, data, evidenceId: evidence?.id };
}

async function executeWriteReportToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation?: PendingModelContinuation,
) {
  const obj =
    toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
      ? (toolCall.input as Record<string, unknown>)
      : {};
  const path = obj.path;
  const content = obj.content;
  if (typeof path !== "string" || !path.trim() || typeof content !== "string") {
    return finishControlToolFailure(
      toolCall,
      context,
      sessionId,
      output,
      "WriteReport requires path and content.",
    );
  }
  const writeCall: ModelToolCall = {
    ...toolCall,
    name: "Write",
    input: {
      path,
      content,
      ...(typeof obj.expectedHash === "string" ? { expectedHash: obj.expectedHash } : {}),
    },
  };
  const permission = await decidePermission("Write", writeCall.input, context, sessionId);
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
    context.pendingLocalApproval = {
      kind: "report_write_tool",
      toolCall: writeCall,
      sessionId,
      continuation,
    };
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
    }
    return {
      ok: false,
      tool: WRITE_REPORT_TOOL_NAME,
      text: `ask: ${permission.reason}`,
      pendingApproval: true,
    };
  }
  if (permission.decision !== "allow") {
    const text = `${permission.decision}: ${permission.reason}`;
    const evidence = await recordToolFailureEvidence(context, sessionId, "Write", text);
    await appendToolResultEvent(context, sessionId, toolCall.id, "Write", text, true, evidence.id);
    return { ok: false, tool: WRITE_REPORT_TOOL_NAME, text, evidenceId: evidence.id };
  }
  return executeApprovedModelToolUse(
    writeCall,
    "Write",
    context,
    sessionId,
    output,
    permission.preflight,
    continuation?.reportWriteGuard,
  );
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
  const budgetedContent = await budgetToolResultTranscriptContent(
    context,
    sessionId,
    toolUseId,
    content,
  );
  // 复用既有 tool_result store schema；toolName 字段塞 dispatchName 字符串以便排查（doctor /
  // details / verifier 都已基于 toolName 字段读取）。store 类型对 toolName 是 string 标签，
  // 所以这里用 cast 的方式保持向后兼容，不引入新 event kind。
  await context.store.appendEvent(sessionId, {
    type: "tool_result",
    toolUseId,
    toolName: dispatchName as unknown as ToolName,
    content: budgetedContent,
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
  const budgetedContent = await budgetToolResultTranscriptContent(
    context,
    sessionId,
    toolUseId,
    content,
  );
  await context.store.appendEvent(sessionId, {
    type: "tool_result",
    toolUseId,
    toolName,
    content: budgetedContent,
    isError,
    evidenceId,
    createdAt: new Date().toISOString(),
  });
}

async function budgetToolResultTranscriptContent(
  context: TuiContext,
  sessionId: string,
  toolUseId: string,
  content: unknown,
): Promise<unknown> {
  const contentText = stringifyToolResultContentForBudget(content);
  if (!contentText || contentText.startsWith("<persisted-tool-result>")) return content;
  if (
    contentText.length <= LINGHUN_DEFAULT_TOOL_RESULT_CHARS &&
    Buffer.byteLength(contentText, "utf8") <= LINGHUN_MAX_TOOL_RESULT_BYTES
  ) {
    return content;
  }

  const budgeted = await applyToolResultBudgetToMessages(
    [{ role: "tool", tool_call_id: toolUseId, content: contentText }],
    { projectPath: context.projectPath, sessionId },
  );
  for (const record of budgeted.records) {
    await recordToolResultBudgetEvidence(context, sessionId, record);
  }
  const replacement = budgeted.messages[0];
  return replacement?.role === "tool" ? replacement.content : content;
}

function stringifyToolResultContentForBudget(content: unknown): string | null {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return null;
  }
}

// D.14D-R P0-2 — 结构化索引工具执行 glue。
//   IndexStatusInspect（只读）：刷新状态读取并返回摘要，明确"未刷新"，立即执行。
//   IndexRefresh / IndexRepair（mutating）：进入 pendingLocalApproval（PermissionPanel）
//   确认管道；用户确认后由 executeApprovedIndexToolUse 复用 runIndexRepository /
//   runIndexSafetyRepair 真实执行，再回灌工具结果给模型续轮。
async function executeIndexToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation?: PendingModelContinuation,
  forcedAction?: "init fast",
  resultToolName?: string,
  appendToolStart = true,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  pendingApproval?: boolean;
}> {
  const name = toolCall.name;
  const dispatchName = resultToolName ?? name;
  if (appendToolStart) {
    await context.store.appendEvent(sessionId, {
      type: "tool_call_start",
      id: toolCall.id,
      name,
      input: toolCall.input,
      createdAt: new Date().toISOString(),
    });
  }

  if (name === INDEX_STATUS_INSPECT) {
    // 只读：刷新状态读取（不重建），返回摘要。明确标注"仅检查，未刷新"。
    startRequestActivity(output, context, "tool_running", { toolName: name });
    await refreshIndexStatus(context);
    clearRequestActivity(context);
    const text = summarizeIndexStatusInspect(
      context.index.status,
      context.index.projectName,
      context.index.nodes,
      context.index.edges,
      context.language,
    );
    const evidence = createEvidenceRecord(
      "command_output",
      `index_operation inspect: ${text}`,
      "index-operation:inspect",
      ["index_operation", "index_status_inspect"],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      dispatchName,
      { text },
      false,
      evidence.id,
    );
    writeLine(output, text);
    return { ok: true, tool: name, text, evidenceId: evidence.id };
  }

  // IndexRefresh / IndexRepair — mutating：走权限确认。
  const action: "init fast" | "refresh" | "repair" =
    forcedAction ?? (name === INDEX_REPAIR ? "repair" : "refresh");
  const parsed = parseIndexRefreshInput(toolCall.input);
  // 复用既有 decidePermission（Write 语义代表索引写入/外部 runtime 写入）。default /
  // auto-review 下 Write 为 ask；命中允许规则或 full-access 时直接执行。
  const permission = await decidePermission(
    "Write",
    { path: ".linghun/index" },
    context,
    sessionId,
  );
  await context.store.appendEvent(sessionId, {
    type: "permission_request",
    request: { ...permission.request, toolName: name as unknown as ToolName },
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
    await appendSystemEvent(
      context,
      sessionId,
      `index_${action}_auto_review_allowed: ordinary workspace index write uses existing permission pipeline; dangerous shell/network/install/delete remain gated`,
      "info",
    );
    return executeApprovedIndexToolUse(toolCall, action, parsed.force, context, sessionId, output);
  }
  if (permission.decision === "deny") {
    clearRequestActivity(context);
    const text = `deny: ${permission.reason}`;
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
    }
    const evidence = await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `index ${action} ${text}`,
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
    return { ok: false, tool: name, text, evidenceId: evidence.id };
  }
  if (permission.decision === "ask") {
    clearRequestActivity(context);
    context.pendingLocalApproval = {
      kind: "index_tool",
      indexAction: action,
      toolCall: { ...toolCall, name: dispatchName },
      sessionId,
      force: parsed.force,
      continuation,
    };
    // ink 主屏走 PermissionPanel；plain 保留文本 yes/no。
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
    }
    return { ok: false, tool: name, text: `ask: ${permission.reason}`, pendingApproval: true };
  }
  // allow（命中允许规则 / full-access）：直接执行。
  return executeApprovedIndexToolUse(
    { ...toolCall, name: dispatchName },
    action,
    parsed.force,
    context,
    sessionId,
    output,
  );
}

// 用户确认（或已允许）后真实执行索引刷新/修复，复用受控 runtime 路径。
async function executeApprovedIndexToolUse(
  toolCall: ModelToolCall,
  action: "init fast" | "refresh" | "repair",
  force: boolean | undefined,
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
  const name = toolCall.name;
  const evidenceToolName =
    name === INDEX_OPERATION_TOOL_NAME
      ? INDEX_OPERATION_TOOL_NAME
      : action === "repair"
        ? INDEX_REPAIR
        : INDEX_REFRESH;
  if (action !== "repair") {
    const guard = checkBackgroundStartGuard(context, "index", true);
    if (guard) {
      const evidence = await recordToolFailureEvidence(
        context,
        sessionId,
        "Write",
        `index ${action} resource guard: ${guard}`,
      );
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        evidenceToolName,
        guard,
        true,
        evidence.id,
      );
      writeLine(output, guard);
      return { ok: false, tool: name, text: guard, evidenceId: evidence.id };
    }
  }
  if (!context.isInkSession) {
    startRequestActivity(output, context, "tool_running", { toolName: name });
  }
  if (action === "repair") {
    // 复用 /index repair 续跑：追加 ignore 条目后刷新（内部已有 writeLine 摘要）。
    await runIndexSafetyRepair(context, output);
  } else if (action === "init fast") {
    await runIndexRepository(context, "fast", "init fast", Boolean(force), output);
  } else {
    await runIndexRepository(context, context.config.index.mode, "refresh", Boolean(force), output);
  }
  clearRequestActivity(context);
  const ok = context.index.status === "ready" || context.index.status === "stale";
  const text = ok
    ? summarizeIndexRefreshOutcome(
        action === "init fast" ? "refresh" : action,
        context.index.status,
        context.language,
      )
    : context.language === "en-US"
      ? `Index ${action} did not complete: status ${context.index.status}. ${context.index.error ?? ""}`.trim()
      : `索引${action === "repair" ? "修复" : action === "init fast" ? "初始化" : "刷新"}未完成：状态 ${context.index.status}。${context.index.error ?? ""}`.trim();
  const primaryText =
    ok && action !== "repair" && context.index.status === "ready"
      ? `${formatIndexRefreshSummary(
          context,
          action === "init fast" ? "init fast" : "refresh",
        )}\n${text}`
      : text;
  if (ok) {
    const panelAlreadyShown = Boolean(context.isInkSession && context.commandPanelState);
    const evidence = createEvidenceRecord(
      "command_output",
      `index_operation ${action}: ${text}`,
      `index-operation:${action}`,
      ["index_operation", `index_${action.replace(" ", "_")}`],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      evidenceToolName,
      { text },
      false,
      evidence.id,
    );
    if (!context.isInkSession) {
      writeLine(output, primaryText);
    } else if (!panelAlreadyShown) {
      writeLine(output, primaryText);
    }
    return { ok: true, tool: name, text, evidenceId: evidence.id };
  }
  const evidence = await recordToolFailureEvidence(
    context,
    sessionId,
    "Write",
    `index ${action}: ${text}`,
  );
  await appendDeferredToolResultEvent(
    context,
    sessionId,
    toolCall.id,
    evidenceToolName,
    text,
    true,
    evidence.id,
  );
  if (!context.isInkSession) {
    writeLine(output, text);
  } else {
    showCommandPanel(context, output, {
      title:
        action === "repair"
          ? context.language === "en-US"
            ? "Index repair"
            : "索引修复"
          : context.language === "en-US"
            ? "Index refresh"
            : "索引刷新",
      tone: "error",
      summary: [text],
      actions: [
        context.language === "en-US" ? "Use index status for details." : "可查看索引状态获取详情。",
      ],
    });
  }
  return { ok: false, tool: name, text, evidenceId: evidence.id };
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
    `report incomplete: missing Write evidence for ${guard.requestedPath}; evidence ${evidence.id}`,
    "warning",
  );
  // D.14B — report guard 未满足转 failure learning。relatedTarget 用脱敏路径基名，不记完整绝对路径。
  await captureFailureLearning(context, sessionId, {
    category: "report_guard",
    failureSummary: `report write blocked: missing Write evidence for ${basename(guard.requestedPath)}`,
    rootCauseGuess: "claimed a report/file was written without an actual Write tool_use",
    avoidNextTime:
      "Actually run the Write tool before claiming a report/file is written; the report guard requires Write evidence",
    sourceRef: `evidence:${evidence.id}`,
    relatedTarget: basename(guard.requestedPath),
    severity: "medium",
  });
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
    if (permission.autoAllowReadonly) {
      // D.13N — same audit event as the model-dispatched path. Mirrors the
      // emit in executeModelToolUse so transcripts have a single, uniform
      // signal regardless of whether the tool was triggered by the model
      // or by a user-typed slash command.
      const verdict = permission.autoAllowReadonly;
      await appendSystemEvent(
        context,
        sessionId,
        `permission auto allow readonly: tool ${name}; semantic ${verdict.semantic}; path safety ${verdict.pathSafety}; summary ${verdict.redactedSummary}; reason ${verdict.reason}`,
        "info",
      );
    }

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

    const shouldKeepAutoReviewWorkspaceEditQuiet =
      context.permissionMode === "auto-review" &&
      permission.request.files.length > 0 &&
      permission.request.risk !== "high" &&
      (name === "Write" || name === "Edit" || name === "MultiEdit");

    if (permission.preflight && !shouldKeepAutoReviewWorkspaceEditQuiet) {
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
    if (checkpoint && !shouldKeepAutoReviewWorkspaceEditQuiet) {
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
    const evidence = await recordToolEvidence(context, sessionId, name, result.output, input);
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
    if (isToolOutputFailure(name, result.output)) {
      await captureFailureLearning(context, sessionId, {
        category: "tool_failure",
        failureSummary: `${name} exited non-zero: ${result.output.text}`,
        rootCauseGuess: `${name} command returned a non-zero exit code`,
        avoidNextTime:
          "Inspect the command output and exit code; fix the underlying cause before claiming the command passed",
        sourceRef: evidence?.id ? `evidence:${evidence.id}` : `tool:${name}`,
        relatedTarget: name,
        severity: "medium",
      });
    }
    writeLine(output, formatToolOutput(name, result.output, context.language, evidence?.id));
    writeStatus(output, context);
  } catch (error) {
    writeErrorLine(output, formatError(error, context.language));
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

async function appendProgressEventSafely(
  context: TuiContext,
  sessionId: string,
  event: Parameters<TuiContext["store"]["appendEvent"]>[1],
): Promise<void> {
  try {
    await context.store.appendEvent(sessionId, event);
  } catch (error) {
    if (isSessionAppendRace(error)) return;
    throw error;
  }
}

function isSessionAppendRace(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("未找到会话：");
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
      pending.push(
        appendProgressEventSafely(context, sessionId, {
          type: "background_task_update",
          task,
          createdAt: new Date().toISOString(),
        }),
      );
    }
    pending.push(
      appendProgressEventSafely(context, sessionId, {
        type: "tool_call_delta",
        id: callId,
        message: truncateDisplay(message.replace(/\s+/g, " "), 500),
        createdAt: new Date().toISOString(),
      }),
    );
    const lines = message.split(/\r?\n/u).filter(Boolean);
    const remainingLines = Math.max(0, 12 - visibleProgressLines);
    const visibleLines = lines.slice(0, remainingLines);
    if (remainingLines > 0) {
      output.write(`${truncateDisplay(visibleLines.join("\n"), 2_000)}\n`);
      visibleProgressLines += Math.min(lines.length, remainingLines);
    }
    if (
      (lines.length > remainingLines || visibleLines.some((line) => line.length > 2_000)) &&
      !progressSuppressed
    ) {
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
  const failureKind = classifyProviderFailure(error);
  const transitFailure = failureKind === "transit";
  const summary = `provider failure: kind ${failureKind}; code ${code}; provider ${runtime.provider}; model ${runtime.model}; endpoint profile ${runtime.endpointProfile}; message ${sanitizeProviderFailureText(message)}`;
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
    kind: failureKind,
    provider: runtime.provider,
    model: runtime.model,
    endpointProfile: runtime.endpointProfile,
    summary: evidence.summary,
    evidenceId: evidence.id,
    createdAt: evidence.createdAt,
  };
  // D.14B — provider/model 请求失败转 failure learning。不记录 baseUrl/key/Authorization；
  // failureSummary 只含错误码与脱敏 message，relatedTarget 用错误码。
  await captureFailureLearning(context, sessionId, {
    category: "provider_failure",
    failureSummary: `provider request failed kind=${failureKind} code=${code} message=${sanitizeProviderFailureText(message)}`,
    rootCauseGuess: transitFailure
      ? `provider/network transit failure with ${code}`
      : `model/provider request failed with ${code}`,
    avoidNextTime: transitFailure
      ? "Retry later; if it repeats, check provider transit/gateway stability with /model doctor. Do not change provider route/env/key/model unless diagnostics point there."
      : code === "PROVIDER_RATE_LIMITED"
        ? "Back off / reduce request rate before retrying provider calls"
        : `Check provider config and request shape for ${code} before retrying; do not assume the request succeeded`,
    sourceRef: `evidence:${evidence.id}`,
    relatedTarget: code,
    severity: "high",
  });
  return evidence;
}

async function recordModelToolFailureForMetaScheduler(
  context: TuiContext,
  sessionId: string,
  result: {
    ok: boolean;
    tool: string;
    text: string;
    pendingApproval?: boolean;
    evidenceId?: string;
  },
): Promise<void> {
  if (result.ok || result.pendingApproval) return;
  if (isUserDecisionToolStop(result.text)) return;
  await appendSystemEvent(
    context,
    sessionId,
    `meta scheduler tool failure: tool ${result.tool}; evidence ${result.evidenceId ?? "none"}`,
    "warning",
  );
  await captureFailureLearning(context, sessionId, {
    category: "tool_failure",
    failureSummary: `tool failed: ${result.tool}: ${truncateDisplay(result.text, 180)}`,
    rootCauseGuess: `${result.tool} returned a failed result in the model tool loop`,
    avoidNextTime:
      "Do not claim the tool action completed; inspect the failure, retry with corrected inputs, or explicitly degrade.",
    sourceRef: result.evidenceId ? `evidence:${result.evidenceId}` : `tool:${result.tool}`,
    relatedTarget: result.tool,
    severity: "medium",
  });
}

function isUserDecisionToolStop(text: string): boolean {
  return /^(?:ask|denied|deny|rejected|cancelled|canceled|block):/iu.test(text.trim());
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

// D.14B Failure Learning — 薄接线：在已判定失败的站点搭车记录一条 failure learning。
// 不做新的失败检测；只把已发生的真实失败（含 evidence/event 引用）转成脱敏后的可复用教训，
// 去重合并 count/lastSeen 后持久化。绝不在用户取消/权限拒绝路径调用本函数。
async function captureFailureLearning(
  context: TuiContext,
  sessionId: string,
  input: FailureLearningInput,
): Promise<void> {
  let record: FailureLearningRecord | undefined;
  try {
    ({ record } = mergeFailureRecord(context.failureLearning, input));
    await writeFailureRecord(context.failureLearning, record);
    await appendSystemEvent(
      context,
      sessionId,
      `failure_learning recorded category=${record.category} count=${record.count} severity=${record.severity}`,
      "info",
    );
  } catch (error) {
    // 失败学习是加性能力；记录自身失败不得影响主链。
    await appendSystemEvent(
      context,
      sessionId,
      `failure_learning degraded warning=write_failed category=${record?.category ?? input.category}`,
      "warning",
    ).catch(() => undefined);
  }
}

async function recordArchitectureRuntimeCard(
  context: TuiContext,
  sessionId: string,
  card: ArchitectureCard,
): Promise<EvidenceRecord> {
  const evidence = createEvidenceRecord(
    "command_output",
    context.language === "en-US"
      ? `Architecture audit recorded: ${card.projectFacts.length} fact(s), ${card.verification.length} verification suggestion(s).`
      : `架构审计已记录：${card.projectFacts.length} 条事实，${card.verification.length} 条验证建议。`,
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
    `architecture runtime triggered: evidence ${evidence.id}; target ${card.target}`,
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
  input?: unknown,
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
    deriveToolSupportsClaims(name, input, output),
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
    `Role route decision ${decision.id}: trigger ${decision.triggerReason}; role ${decision.role}; selected ${decision.selectedProvider || "paused"}/${decision.selectedModel || "paused"}; fallback candidates ${decision.fallbackCandidates.join(",") || "none"}; capabilities ${decision.requiredCapabilities.join("+")}; budget ${decision.maxCostCny === undefined ? "unconfigured" : decision.maxCostCny}; fallback used ${decision.fallbackUsed ? "yes" : "no"}; budget stop ${decision.budgetStop ? "yes" : "no"}; stop ${decision.stopConditions.join("|") || "none"}`,
    decision.stopConditions.length > 0 ? "warning" : "info",
  );
}

function createToolEndEvent(id: string, output: ToolOutput): TranscriptEvent {
  return {
    type: "tool_call_end",
    id,
    output: compactToolOutputForTranscript(output),
    createdAt: new Date().toISOString(),
  };
}

function compactToolOutputForTranscript(output: ToolOutput): ToolOutput {
  const text = typeof output.text === "string" ? output.text : "";
  const textBytes = Buffer.byteLength(text, "utf8");
  if (
    text.length <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS &&
    textBytes <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS
  ) {
    const compactedDetails =
      typeof output.details === "string" && output.details.length > TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS
        ? `<transcript-tool-output-details-truncated originalChars=${output.details.length}${output.fullOutputPath ? ` fullOutputPath=${output.fullOutputPath}` : ""}>`
        : output.details;
    return compactedDetails === output.details ? output : { ...output, details: compactedDetails };
  }
  const preview = text.slice(0, TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS);
  return {
    ...output,
    text: [
      preview,
      "",
      `<transcript-tool-output-truncated originalChars=${text.length} originalBytes=${textBytes}${output.fullOutputPath ? ` fullOutputPath=${output.fullOutputPath}` : ""}>`,
    ].join("\n"),
    details:
      typeof output.details === "string" &&
      output.details.length > TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS
        ? `<transcript-tool-output-details-truncated originalChars=${output.details.length}${output.fullOutputPath ? ` fullOutputPath=${output.fullOutputPath}` : ""}>`
        : output.details,
    data: compactToolOutputDataForTranscript(output.data),
    truncated: true,
  };
}

function compactToolOutputDataForTranscript(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const serialized = JSON.stringify(data);
  if (
    serialized.length <= LINGHUN_DEFAULT_TOOL_RESULT_CHARS &&
    Buffer.byteLength(serialized, "utf8") <= LINGHUN_MAX_TOOL_RESULT_BYTES
  ) {
    return data;
  }
  return {
    truncated: true,
    originalChars: serialized.length,
    preview: serialized.slice(0, TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS),
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
    if (context.sessionStoreVerifiedId === context.sessionId) {
      context.sessionEnded = false;
      return context.sessionId;
    }
    try {
      await context.store.resume(context.sessionId);
      context.sessionStoreVerifiedId = context.sessionId;
      context.sessionEnded = false;
      return context.sessionId;
    } catch (error) {
      if (!isSessionAppendRace(error)) {
        throw error;
      }
      context.sessionId = undefined;
    }
  }

  const session = await context.store.create({ model: context.model });
  context.sessionId = session.id;
  context.sessionStoreVerifiedId = session.id;
  context.sessionEnded = false;
  return session.id;
}

function getToolResultBudgetState(context: TuiContext): ToolResultBudgetState {
  context.toolResultBudgetState ??= { seenIds: new Set(), replacements: new Map() };
  return context.toolResultBudgetState;
}

function createSilentOutput(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function formatShellBackgroundSummaries(context: TuiContext): BackgroundTaskSummary[] {
  return context.backgroundTasks
    .filter((task) => task.kind !== "agent" || task.status === "running")
    .filter(
      (task) =>
        task.status === "running" ||
        task.status === "paused" ||
        task.status === "blocked",
    )
    .map((task) => ({
      id: task.id,
      kind: task.kind,
      title: task.title,
      status: task.status,
      currentStep: task.currentStep,
      progress: task.progress,
      result: task.result,
      nextAction: task.nextAction,
    }));
}

function isSessionEnded(transcript: TranscriptEvent[]): boolean {
  return transcript.at(-1)?.type === "session_end";
}

function writeStatus(output: Writable, context: TuiContext): void {
  const background = context.backgroundTasks.filter(isRuntimeActiveBackgroundTask).length;
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
  // D.13V — 暴露 retry/downgrade 路径上的 streaming block 操作，便于单测验证
  // unsupported first-pass final answer 不残留于 streaming block / lastFullOutput。
  discardAssistantBlock(id: string): void;
  replaceAssistantBlockContent(id: string, text: string): void;
  compactOutputMemory(): Promise<void>;
} {
  return createShellBlockOutputForTest(context, blocks, onWrite);
}

/**
 * D.13Q-UX Task Surface — 测试入口：暴露 explicit /details panel 装配器。
 * 单测用它验证 lastFullOutput / evidence / background 的 panel 化行为；
 * Ctrl+O 不走这个 CommandPanel 路径。
 */
export function __testBuildExplicitDetailsCommandPanel(
  context: TuiContext,
): import("./shell/types.js").CommandPanelView | undefined {
  return buildExplicitDetailsCommandPanel(context);
}

/**
 * D.13V-A — 测试入口：暴露 createVerificationLevelForReadiness。单测用它
 * 验证 readiness 不再绕过 verification-level 分级器（仅 build pass 的报告
 * 不应出现 level=real-smoke）。
 */
export function __testCreateVerificationLevelForReadiness(
  context: TuiContext,
): NonNullable<TerminalReadinessView["verificationLevel"]> {
  return createVerificationLevelForReadiness(context);
}
