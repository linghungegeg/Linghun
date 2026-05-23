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
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  type LinghunConfig,
  type McpServerConfig,
  type ModelCapability,
  type ModelRole,
  type NativeRunnerConfig,
  type RemoteChannelConfig,
  type RemoteChannelType,
  type RemoteEventType,
  type RoleModelRoute,
  defaultConfig,
  getProjectSettingsPath,
  loadConfig,
  removeMcpServerConfig,
  resetExtensionTrustForInstall,
  resolveStoragePaths,
  saveExtensionEnablement,
  saveMcpServerConfig,
  saveModelRoute,
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
  type ModelToolDefinition,
  type ModelUsage,
  OpenAiCompatibleProvider,
  findKnownModel,
  resolveProviderBaseUrlDiagnostic,
  resolveProviderRuntimeContract,
} from "@linghun/providers";
import {
  LINGHUN_NAME,
  type Language,
  type PermissionMode,
  isRawPermissionMode,
  normalizePermissionMode,
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
  type ArchitectureCard,
  type ArchitectureCardSummary,
  createArchitectureCard,
  createArchitectureRuntimeDirective,
  detectArchitectureDrift,
  shouldTriggerArchitectureRuntime,
  summarizeArchitectureCard,
} from "./architecture-runtime.js";
import {
  type CompactBoundary,
  compactBoundaryHash,
  createManualCompactBoundary,
  microCompactMessages,
} from "./compact-context.js";
import { classifyIndexSafetyRepairContinuation } from "./index-safety-repair.js";
import {
  type LogArtifactRequest,
  formatLogArtifactSlice,
  readLogArtifactSlice,
} from "./log-artifact.js";
import {
  type NaturalIntent,
  type PendingNaturalCommand,
  type SLASH_COMMAND_REGISTRY,
  buildRuntimeStatusForModel,
  createModelCapabilitySummary,
  createPendingNaturalCommand,
  formatCapabilityAnswer,
  formatNaturalStartGate,
  getCommandCapabilityCatalog,
  matchesNaturalGateConfirmation,
  routeNaturalIntent,
} from "./natural-command-bridge.js";
import {
  formatLocalToolPermissionPrompt,
  formatModelToolPermissionPrompt,
} from "./permission-presenter.js";
import {
  type RequestActivityPhase,
  formatProviderEmptyResponsePrimary,
  formatProviderFailurePrimary,
  formatReportEvidenceRequired,
  formatReportIncompletePrimary,
  formatRequestActivity,
} from "./request-lifecycle-presenter.js";
import { formatRuntimeStatusLine } from "./runtime-status-presenter.js";
import {
  type TerminalProblemView,
  type TerminalReadinessView,
  formatTerminalProblemsPanel,
  formatTerminalReadinessDoctor,
  formatTerminalReadinessStatus,
} from "./terminal-readiness-presenter.js";
import { formatToolOutput } from "./tool-output-presenter.js";
import {
  type WorkspaceReferenceCache,
  createWorkspaceReferenceCache,
  getWorkspaceReferenceSnapshot,
  workspaceReferenceHash,
} from "./workspace-reference-cache.js";

export type TuiStatus = "ready";

export const tuiStatus: TuiStatus = "ready";

export type RunTuiOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  projectPath?: string;
};

export type PermissionRule = {
  id: string;
  effect: "allow" | "ask" | "deny";
  toolName: ToolName | "*";
  risk?: "low" | "medium" | "high";
};

export type RecentPermissionRejection = {
  id: string;
  toolName: ToolName;
  mode: PermissionMode;
  reason: string;
  createdAt: string;
};

export type PermissionState = {
  rules: PermissionRule[];
  recentDenied: RecentPermissionRejection[];
};

export type SolutionCompletenessClassification = "single_issue" | "systemic_gap" | "unknown";

export type SolutionCompletenessSeverity =
  | "P0"
  | "blocking_P1"
  | "P1"
  | "P2"
  | "later"
  | "not_do"
  | "unknown";

export type SolutionCompletenessStatus = {
  triggered: boolean;
  triggerReason:
    | "none"
    | "user_request"
    | "repeated_denial"
    | "smoke_contamination"
    | "audit_finding";
  classificationRequired: boolean;
  classification: SolutionCompletenessClassification;
  impactAreas: string[];
  severity: SolutionCompletenessSeverity;
  requiredBeforeAction: boolean;
  evidenceRefs: string[];
  sourceRefs: string[];
  nextRequiredOutput: string;
  checklist: string[];
  lastWarning?: string;
};

export type PlanProposal = {
  id: string;
  title: string;
  options: { id: string; title: string; steps: string[]; risks: string[] }[];
};

export type BackgroundTaskStatus =
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"
  | "stale";

export type BackgroundTaskState = {
  id: string;
  kind: "bash" | "verification" | "compact" | "agent" | "job" | "mcp" | "index";
  title: string;
  status: BackgroundTaskStatus;
  currentStep?: string;
  progress?: { completed: number; total?: number; label?: string };
  startedAt: string;
  updatedAt: string;
  lastOutputAt?: string;
  estimatedRemainingMs?: number;
  heartbeatIntervalMs: number;
  staleAfterMs: number;
  logPath?: string;
  outputPath?: string;
  hasOutput: boolean;
  result?: "pass" | "fail" | "partial" | "cancelled" | "timeout" | "stale";
  userVisibleSummary: string;
  nextAction?: string;
};

export type CheckpointState = {
  id: string;
  sessionId: string;
  createdAt: string;
  reason: string;
  changedFiles: string[];
  restoreKind: "git" | "snapshot";
  files: { path: string; existed: boolean; content?: string }[];
};

export type EvidenceRecord = {
  id: string;
  kind:
    | "file_read"
    | "grep_result"
    | "index_query"
    | "command_output"
    | "test_result"
    | "web_source"
    | "vision_observation"
    | "image_result"
    | "user_provided";
  summary: string;
  source: string;
  fullOutputPath?: string;
  outputPath?: string;
  logPath?: string;
  supportsClaims: string[];
  createdAt: string;
};

export type VerificationStepKind = "test" | "typecheck" | "build" | "lint" | "smoke";

export type VerificationStep = {
  kind: VerificationStepKind;
  command: string;
  reason: string;
};

const VERIFICATION_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export type VerificationRuntimeStatus =
  | "pass"
  | "fail"
  | "partial"
  | "skipped"
  | "cancelled"
  | "timeout"
  | "stale";

export type VerificationCommandResult = VerificationStep & {
  status: VerificationRuntimeStatus;
  exitCode?: number;
  durationMs: number;
  logPath?: string;
  summary: string;
  runnerError?: string;
};

export type VerificationReport = {
  id: string;
  status: Exclude<VerificationRuntimeStatus, "skipped">;
  summary: string;
  commands: VerificationCommandResult[];
  unverified: string[];
  risk: string[];
  logPath?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  nextAction: string;
};

export type CacheHistoryConfig = {
  maxTurns: number;
  warnBelowHitRate: number;
  persistPath: string;
  hintsMuted: boolean;
};

export type LightHint = {
  id: string;
  severity: "info" | "warning";
  message: string;
  suggestedCommand: string;
  dedupeKey: string;
  cooldownMs: number;
};

export type CacheState = {
  config: CacheHistoryConfig;
  history: CacheTurnStats[];
  nextTurn: number;
  lastFreshness?: CacheFreshness;
  hintLastShownAt: Record<string, number>;
  compacted: boolean;
  compactBoundaries: CompactBoundary[];
  workspaceReference: WorkspaceReferenceCache;
  startedAt: number;
};

export type McpServerState = {
  name: string;
  command: string;
  status: "configured" | "disabled" | "missing" | "error";
  error?: string;
};

export type McpToolState = {
  server: string;
  name: string;
  description: string;
  discovery?: "discovered" | "placeholder";
  trusted?: boolean;
  schemaLoaded?: boolean;
  runtimeVersion?: "compatible" | "unknown";
};

export type McpState = {
  enabled: boolean;
  servers: McpServerState[];
  tools: McpToolState[];
  lastDoctor?: string;
};

type CodebaseMemoryBinarySource = "env" | "managed" | "path" | "missing";
type CodebaseMemoryBinaryStatus = "ready" | "missing" | "corrupt" | "unsupported" | "unknown";
type CodebaseMemoryArtifactStatus = "ready" | "missing" | "stale" | "corrupt" | "unknown";
type CodebaseMemoryProjectSelectionSource = "root_path" | "name-candidate" | "missing";

export type IndexState = {
  enabled: boolean;
  projectName?: string;
  status: "unknown" | "ready" | "missing" | "stale" | "error" | "indexing";
  nodes?: number;
  edges?: number;
  indexedAt?: string;
  changedFiles?: number;
  staleHint?: string;
  safetyWarning?: string;
  safetyRiskyFiles?: IndexSafetyFile[];
  safetyAction?: "init fast" | "refresh";
  error?: string;
  lastQuery?: string;
  lastSummary?: string;
  binarySource?: CodebaseMemoryBinarySource;
  binaryStatus?: CodebaseMemoryBinaryStatus;
  binaryVersion?: string;
  binaryCommand?: string;
  artifactStatus?: CodebaseMemoryArtifactStatus;
  artifactPath?: string;
  projectSelectionSource?: CodebaseMemoryProjectSelectionSource;
  runtime?: string;
};

export type VerdictScope =
  | "focused"
  | "full-test"
  | "mock"
  | "journey"
  | "live-provider"
  | "real-tui"
  | "beta"
  | "release";

export type VerdictStatus = "PASS" | "PARTIAL" | "FAIL" | "SKIPPED";

export type VerdictEvidenceScope = {
  scope: VerdictScope;
  status: VerdictStatus;
  evidenceRefs: string[];
  validationCommands: string[];
  uncoveredItems: string[];
  residualRisks: string[];
  nextAction: string;
};

export type HandoffPacket = {
  id: string;
  sessionId: string;
  projectPath: string;
  parentSessionId?: string;
  currentPhase: string;
  nextPhase: string;
  phaseStatus: "pending" | "in_progress" | "completed" | "blocked";
  goal: string;
  completed: string[];
  pending: string[];
  mustNotDo: string[];
  todos: TodoItem[];
  keyFiles: string[];
  changedFiles: string[];
  evidenceRefs: Array<Pick<EvidenceRecord, "id" | "kind" | "source" | "summary">>;
  verdictEvidence: VerdictEvidenceScope;
  verification: VerificationReport | null;
  risks: string[];
  indexStatus: Pick<
    IndexState,
    "projectName" | "status" | "nodes" | "edges" | "changedFiles" | "staleHint"
  >;
  permissionMode: PermissionMode;
  modelProvider: { provider: string; model: string };
  recentCommit: string;
  budgetUsage: string;
  createdAt: string;
  generatedBy: string;
  solutionCompleteness?: SolutionCompletenessStatus;
  currentArchitectureCard?: ArchitectureCardSummary;
};

export type AgentType = "explorer" | "worker" | "verifier" | "planner";

export type RoleUsage = {
  role: ModelRole;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCny: number;
  createdAt: string;
  durationMs?: number;
  fallbackUsed: boolean;
  budgetStop: boolean;
  contributionSummary: string;
};

export type RoleRouteDecision = {
  id: string;
  triggerReason: string;
  role: ModelRole;
  selectedProvider: string;
  selectedModel: string;
  fallbackCandidates: string[];
  requiredCapabilities: ModelCapability[];
  maxCostCny?: number;
  stopConditions: string[];
  repairSuggestions: string[];
  fallbackUsed: boolean;
  budgetStop: boolean;
  createdAt: string;
};

type ResolvedRoleRoute = {
  route: RoleModelRoute;
  decision: RoleRouteDecision;
  usable: boolean;
};

export type RoleHandoff = {
  from: ModelRole;
  to: ModelRole;
  taskId: string;
  summary: string;
  evidence: Array<Pick<EvidenceRecord, "id" | "kind" | "source" | "summary">>;
  changedFiles: string[];
  keyFiles: string[];
  diffSummary?: DiffSummary;
  verificationReport?: VerificationReport;
  notIncluded: string[];
};

export type VisionObservation = {
  id: string;
  source: "image" | "screenshot" | "design" | "browser-capture";
  model: string;
  provider: string;
  summary: string;
  extractedText: string[];
  uiRegions: string[];
  suspectedFiles: string[];
  confidence: number;
  evidenceRefs: Array<Pick<EvidenceRecord, "id" | "kind" | "source" | "summary">>;
  createdAt: string;
};

export type ImageGenerationResult = {
  id: string;
  provider: string;
  model: string;
  images: Array<{ path: string; mimeType: string; revisedPrompt?: string }>;
  usage?: RoleUsage;
  evidenceRefs: Array<Pick<EvidenceRecord, "id" | "kind" | "source" | "summary">>;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  type: AgentType;
  role: ModelRole;
  provider: string;
  parentSessionId?: string;
  forkedFrom?: string;
  task: string;
  model: string;
  permissionMode: PermissionMode;
  status: "running" | "completed" | "failed" | "cancelled";
  transcriptPath: string;
  transcriptSessionId: string;
  summary: string;
  contextSummary: string;
  cost: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    estimatedCny: number;
  };
  startedAt: string;
  updatedAt: string;
};

export type DurableJobStatus =
  | "created"
  | "running"
  | "sleeping"
  | "blocked"
  | "stale"
  | "cancelled"
  | "timeout"
  | "completed"
  | "failed";

export type DurableJobAgentStatus =
  | "created"
  | "running"
  | "queued"
  | "sleeping"
  | "blocked"
  | "stale"
  | "cancelled"
  | "timeout"
  | "completed"
  | "failed";

export type DurableJobAgent = {
  id: string;
  type: AgentType;
  goal: string;
  status: DurableJobAgentStatus;
  budgetTokens: number;
  owner?: string;
  heartbeatAt?: string;
  summary?: string;
};

export type NativeRunnerResolutionStatus =
  | "disabled"
  | "unavailable"
  | "available"
  | "protocol_mismatch";

export type NativeRunnerLifecycleStatus =
  | "node_fallback"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"
  | "stale"
  | "protocol_mismatch"
  | "unavailable";

export type ApprovedRunnerJobSpec = {
  id: string;
  approvedTaskKind: "durable_job_supervisor";
  cwd: string;
  envAllowlist: string[];
  redactedEnvRefs: string[];
  timeoutMs: number;
  logPaths: {
    state: string;
    stdout: string;
    stderr: string;
    jobLog: string;
    fullOutput: string;
    report: string;
  };
  expectedProtocol: string;
  permissionRef: PermissionMode;
  evidenceRefs: string[];
  runnerRoot: string;
};

export type DurableJobState = {
  id: string;
  goal: string;
  projectPath: string;
  phase: string;
  target: string;
  plan: string[];
  budget: {
    maxTokens: number;
    maxRunningAgents: number;
    maxSteps: number;
    note: string;
    usedTokens?: number;
    remainingTokens?: number;
    usedSteps?: number;
    maxRuntimeMs?: number;
  };
  timeoutMs: number;
  permissionPolicy: PermissionMode;
  allowEdit: boolean;
  allowBash: boolean;
  allowMultiAgent: boolean;
  status: DurableJobStatus;
  pauseReason?: string;
  agents: DurableJobAgent[];
  handoffPacket?: HandoffPacket;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  logPath: string;
  reportPath: string;
  fullOutputPath: string;
  evidenceRefs: Array<Pick<EvidenceRecord, "id" | "kind" | "source" | "summary">>;
  verification?: { status: "not_run" | "pass" | "fail" | "partial"; summary: string };
  runner?: {
    enabled: boolean;
    status: NativeRunnerLifecycleStatus;
    resolution: NativeRunnerResolutionStatus;
    adapter: "native" | "node";
    protocol?: string;
    version?: string;
    pathRef?: string;
    spec?: ApprovedRunnerJobSpec;
    startedAt?: string;
    updatedAt: string;
    completedAt?: string;
    heartbeatAt?: string;
    logRefs?: {
      state: string;
      stdout: string;
      stderr: string;
    };
    lastError?: string;
    fallbackReason?: string;
    nextAction: string;
  };
  ownerSessionId?: string;
  ownerPid?: number;
  heartbeatAt?: string;
  worker?: {
    sessionId?: string;
    status: "not_started" | "running" | "completed" | "blocked" | "timeout" | "failed" | "stale";
    startedAt?: string;
    endedAt?: string;
    currentStep?: number;
    completedSteps?: number;
    summary: string;
  };
  result?: {
    status: "partial" | "blocked" | "stale" | "timeout" | "overbudget" | "failed" | "cancelled";
    summary: string;
    facts: string[];
    evidenceRefs: string[];
    generatedAt: string;
  };
  adoptedConclusions: string[];
  rejectedConclusions: string[];
};

export type RemoteEventStatus = "pending" | "sent" | "failed" | "expired" | "rejected" | "approved";
export type RemoteChannelRuntimeStatus = "disabled" | "blocked" | "ready";

export type RemoteChannelState = {
  id: string;
  config: RemoteChannelConfig;
  runtimeStatus: RemoteChannelRuntimeStatus;
  bindingStatus: "bound" | "unbound";
  transportStatus: "ready" | "missing" | "not_configured" | "mock" | "unknown";
  lastError?: string;
  nextAction: string;
};

export type RemoteEvent = {
  id: string;
  channel: string;
  eventType: RemoteEventType;
  createdAt: string;
  expiresAt: string;
  nonce: string;
  messageId: string;
  source: string;
  redactedSummary: string;
  refs: string[];
  status: RemoteEventStatus;
};

export type RemoteApprovalMessage = {
  eventId: string;
  channel: string;
  messageId: string;
  nonce: string;
  source: string;
  bindingUserId: string;
  bindingDeviceId?: string;
  signature?: string;
  receivedAt?: string;
  approve: boolean;
};

export type RemoteApprovalDecision = {
  status:
    | "approved"
    | "rejected"
    | "expired"
    | "unknown_source"
    | "wrong_binding"
    | "bad_signature"
    | "replayed"
    | "blocked";
  summary: string;
  evidenceCreated: false;
};

export type RemoteState = {
  enabled: boolean;
  channels: RemoteChannelState[];
  events: RemoteEvent[];
  processedMessageIds: string[];
  sessionDisabledChannelIds: string[];
  lastDoctor?: string;
  lastApproval?: RemoteApprovalDecision;
};

export type MemoryScope = "project" | "user" | "session";
export type MemoryStatus = "candidate" | "accepted" | "rejected" | "disabled" | "retired";

export type MemoryCandidate = {
  id: string;
  scope: MemoryScope;
  status: MemoryStatus;
  summary: string;
  source: string;
  sourceRefs: string[];
  risk: "low" | "medium" | "high";
  inferred: boolean;
  createdAt: string;
};

export type MemoryLearningRun = {
  trigger: "manual" | "verification" | "handoff" | "evidence";
  candidatesCreated: number;
  modelCalled: boolean;
  skippedReason?: string;
  createdAt: string;
};

export type MemoryState = {
  projectRulesPath: string;
  projectRulesExists: boolean;
  projectRulesSummary: string;
  projectRulesError?: string;
  projectDir: string;
  userDir: string;
  sessionDir: string;
  candidates: MemoryCandidate[];
  accepted: MemoryCandidate[];
  rejected: MemoryCandidate[];
  disabled: MemoryCandidate[];
  retired: MemoryCandidate[];
  lastLearningRun?: MemoryLearningRun;
  lastHandoff?: HandoffPacket;
  lastResumeReadonly?: boolean;
};

export type ExtensionSource = "local" | "official" | "third-party";
export type ExtensionScope = "project" | "user";

export type ExtensionTrustLevel = "trusted" | "untrusted" | "disabled";

export type ExtensionLifecycleRecord = {
  sourceUrl?: string;
  localPath?: string;
  ref?: string;
  commit?: string;
  installedAt?: string;
  trustLevel: ExtensionTrustLevel;
  permissionSummary: string;
  discovered: boolean;
  registered: boolean;
  schemaLoaded: boolean;
  runtimeVersion: "compatible" | "incompatible" | "unknown";
};

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  summary: string;
  source: ExtensionSource;
  scope: ExtensionScope;
  path: string;
  version: string;
  enabled: boolean;
  trusted: boolean;
  permissions: string[];
  mayWrite: boolean;
  mayExecute: boolean;
  mayNetwork: boolean;
  lifecycle: ExtensionLifecycleRecord;
  lastError?: string;
};

export type SkillEvolutionCandidate = {
  id: string;
  status: "candidate" | "rejected";
  summary: string;
  triggerCondition: string;
  source: string;
  risk: "low" | "medium" | "high";
  suggestedPath: string;
  createdAt: string;
};

export type SkillState = {
  enabled: boolean;
  projectDir: string;
  userDir: string;
  skills: SkillSummary[];
  disabledIds: string[];
  trustedIds: string[];
  evolutionCandidates: SkillEvolutionCandidate[];
  rejectedEvolutionCandidates: SkillEvolutionCandidate[];
  lastError?: string;
};

export type WorkflowTemplate = {
  id: string;
  purpose: string;
  risk: "low" | "medium" | "high";
  writesFiles: boolean;
  recommendedValidation: string[];
  steps: string[];
};

export type WorkflowState = {
  enabled: boolean;
  templates: WorkflowTemplate[];
  disabledIds: string[];
  lastStarted?: string;
};

export type HookSummary = {
  id: string;
  event: "PreToolUse" | "PostToolUse" | "Stop" | "Notification" | "Workflow" | "Plugin";
  source: ExtensionSource;
  scope: ExtensionScope;
  path: string;
  enabled: boolean;
  trusted: boolean;
  timeoutMs: number;
  outputLimitBytes: number;
  lastError?: string;
  logPath?: string;
  permissions: string[];
};

export type HookState = {
  enabled: boolean;
  projectTrusted: boolean;
  timeoutMs: number;
  outputLimitBytes: number;
  hooks: HookSummary[];
  recentErrors: string[];
};

export type PluginSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  source: ExtensionSource;
  scope: ExtensionScope;
  path: string;
  enabled: boolean;
  trusted: boolean;
  permissions: string[];
  mayWrite: boolean;
  mayExecute: boolean;
  mayNetwork: boolean;
  lifecycle: ExtensionLifecycleRecord;
  contributions: {
    commands: string[];
    mcpServers: string[];
    providers: string[];
    hooks: string[];
    workflows: string[];
    skills: string[];
  };
  lastError?: string;
};

export type PluginState = {
  enabled: boolean;
  projectDir: string;
  userDir: string;
  plugins: PluginSummary[];
  disabledIds: string[];
  trustedIds: string[];
  lastError?: string;
};

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

type ReportWriteGuard = {
  requestedPath: string;
  pathExplicit: boolean;
  completed: boolean;
  reminderSent: boolean;
  evidenceReminderSent: boolean;
  finalReferenceReminderSent: boolean;
  nonWriteToolRounds: number;
  evidenceRead: boolean;
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
  activeAbortController?: AbortController;
  backgroundAbortControllers?: Map<string, AbortController>;
  recentlyMentionedFiles: string[];
  lastProviderFailure?: ProviderFailureSummary;
  solutionCompleteness: SolutionCompletenessStatus;
  currentArchitectureCard?: ArchitectureCard;
  requestActivity?: { slowHintShown: boolean; slowTimer?: ReturnType<typeof setTimeout> };
};

type ProviderFailureSummary = {
  code: string;
  provider: string;
  model: string;
  endpointProfile: string;
  summary: string;
  evidenceId: string;
  createdAt: string;
};

const DEFAULT_CACHE_HISTORY_SIZE = 20;
const MIN_CACHE_HISTORY_SIZE = 1;
const MAX_CACHE_HISTORY_SIZE = 200;
const DEFAULT_CACHE_WARN_BELOW_HIT_RATE = 0.75;
const DEFAULT_LIGHT_HINT_COOLDOWN_MS = 5 * 60 * 1000;
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
const PROJECT_RULES_SUMMARY_WIDTH = 600;
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
const DEFAULT_JOB_RUNNING_AGENT_CAP = 3;
const JOB_AGENT_HIGH_CONFIG_CANDIDATE = 8;
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_JOB_BUDGET_TOKENS = 120_000;
const JOB_LOG_TAIL_LINES = 40;
const JOB_RECOVERY_HEARTBEAT_STALE_MS = 2 * 60 * 1000;
const DEFAULT_JOB_MAX_STEPS = 4;
const MAX_JOB_MAX_STEPS = 20;
const NATIVE_RUNNER_VERSION_TIMEOUT_MS = 2_000;
const NATIVE_RUNNER_START_STATE_WAIT_MS = 1_500;
const NATIVE_RUNNER_APPROVED_TASK_HEARTBEAT_MS = 100;
const NATIVE_RUNNER_BUNDLED_PLATFORM_ARCHES = new Set([
  "win32-x64",
  "linux-x64",
  "darwin-arm64",
  "darwin-x64",
]);
const NATIVE_RUNNER_APPROVED_TASK_SCRIPT = [
  "const durationMs = Number(process.argv[1] || '1000');",
  "const heartbeatMs = 100;",
  "const startedAt = Date.now();",
  "let tick = 0;",
  "console.log(JSON.stringify({ kind: 'linghun-approved-runner-task', status: 'started', tick, elapsedMs: 0 }));",
  "const timer = setInterval(() => {",
  "  tick += 1;",
  "  const elapsedMs = Date.now() - startedAt;",
  "  console.log(JSON.stringify({ kind: 'linghun-approved-runner-task', status: elapsedMs >= durationMs ? 'completed' : 'heartbeat', tick, elapsedMs }));",
  "  if (elapsedMs >= durationMs) {",
  "    clearInterval(timer);",
  "    process.exitCode = 0;",
  "  }",
  "}, heartbeatMs);",
].join("\n");
const MAX_CHECKPOINTS = 20;
const MAX_AGENTS = 20;
const MAX_ROUTE_DECISIONS = 50;

export function createCacheState(
  projectPath: string,
  model = "deepseek-v4-flash",
  mcpToolList: McpToolState[] = [],
): CacheState {
  const freshness = createCacheFreshness({
    systemPrompt: "Linghun interactive terminal with local extensions and workflows",
    toolSchema: builtInTools,
    mcpToolList: stabilizeMcpToolList(mcpToolList),
    model,
    provider: "deepseek",
    projectRules: "local CLAUDE.md rules loaded by harness",
    memory: "memory/handoff context not loaded yet",
    compact: "not compacted",
    plugins: [],
  });
  return {
    config: {
      maxTurns: DEFAULT_CACHE_HISTORY_SIZE,
      warnBelowHitRate: DEFAULT_CACHE_WARN_BELOW_HIT_RATE,
      persistPath: join(projectPath, ".linghun", "cache-log.json"),
      hintsMuted: false,
    },
    history: [],
    nextTurn: 1,
    lastFreshness: freshness,
    hintLastShownAt: {},
    compacted: false,
    compactBoundaries: [],
    workspaceReference: createWorkspaceReferenceCache(),
    startedAt: Date.now(),
  };
}

export function createRemoteState(config: LinghunConfig): RemoteState {
  return {
    enabled: config.remote.enabled,
    channels: Object.entries(config.remote.channels)
      .map(([id, channel]) => createRemoteChannelState(id, channel, config.remote.enabled))
      .sort((a, b) => a.id.localeCompare(b.id)),
    events: [],
    processedMessageIds: [],
    sessionDisabledChannelIds: [],
  };
}

function createRemoteChannelState(
  id: string,
  config: RemoteChannelConfig,
  remoteEnabled: boolean,
): RemoteChannelState {
  const active = remoteEnabled && config.enabled;
  const bindingStatus = config.bindingUserId ? "bound" : "unbound";
  const transportStatus = active ? getRemoteTransportStatus(config) : "unknown";
  const disabledReason = active ? undefined : "remote_disabled";
  const blockedReason =
    disabledReason ?? getRemoteBlockedReason(config, transportStatus, bindingStatus);
  return {
    id,
    config,
    runtimeStatus: blockedReason
      ? blockedReason === "remote_disabled"
        ? "disabled"
        : "blocked"
      : "ready",
    bindingStatus,
    transportStatus,
    lastError: blockedReason,
    nextAction: getRemoteNextAction(id, config, blockedReason),
  };
}

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

function applyRemoteSessionDisables(remote: RemoteState): void {
  for (const channel of remote.channels) {
    if (!remote.sessionDisabledChannelIds.includes(channel.id)) {
      continue;
    }
    channel.runtimeStatus = "disabled";
    channel.lastError = "disabled_by_user";
    channel.nextAction = `/remote setup ${channel.id}`;
  }
}

function getRemoteTransportStatus(
  config: RemoteChannelConfig,
): RemoteChannelState["transportStatus"] {
  if (config.transport === "webhook_mock") {
    return "mock";
  }
  if (config.transport === "webhook") {
    return config.endpoint ? "ready" : "not_configured";
  }
  if (!config.cliPath) {
    return "not_configured";
  }
  const result = spawnSync(config.cliPath, ["--version"], { encoding: "utf8", timeout: 2_000 });
  return result.error ? "missing" : "ready";
}

function getRemoteBlockedReason(
  config: RemoteChannelConfig,
  transportStatus: RemoteChannelState["transportStatus"],
  bindingStatus: RemoteChannelState["bindingStatus"],
): string | undefined {
  if (bindingStatus !== "bound") {
    return "not_bound";
  }
  if (config.transport === "official_cli" && transportStatus !== "ready") {
    return transportStatus === "missing" ? "cli_missing" : "cli_not_configured";
  }
  if (config.transport === "webhook" && transportStatus !== "ready") {
    return "webhook_missing";
  }
  if (!config.trustedSources.length) {
    return "source_not_trusted";
  }
  return undefined;
}

function getRemoteNextAction(
  channelId: string,
  config: RemoteChannelConfig,
  reason: string | undefined,
): string {
  if (!reason || reason === "remote_disabled") {
    return reason ? `/remote setup ${channelId}` : `/remote test ${channelId}`;
  }
  if (reason === "not_bound") {
    return `/remote setup ${channelId}`;
  }
  if (reason === "cli_missing") {
    return getRemoteInstallHint(config.type);
  }
  if (reason === "webhook_missing") {
    return `configure a redacted webhook endpoint or use /remote setup ${channelId}`;
  }
  if (reason === "source_not_trusted") {
    return `bind a trusted source with /remote setup ${channelId}`;
  }
  return "/remote doctor";
}

export function createMcpState(config: LinghunConfig): McpState {
  const servers = Object.entries(config.mcp.servers)
    .map(
      ([name, server]) =>
        ({
          name,
          command: server.command,
          status:
            server.disabled || !config.mcp.enabledServers.includes(name)
              ? "disabled"
              : "configured",
        }) satisfies McpServerState,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    enabled: config.mcp.enabledServers.length > 0,
    servers,
    tools: stabilizeMcpToolList(
      servers
        .filter((server) => server.status === "configured")
        .flatMap((server) => createMcpToolPlaceholders(server.name, "placeholder")),
    ),
  };
}

function createMcpToolPlaceholders(
  serverName: string,
  discovery: "discovered" | "placeholder",
): McpToolState[] {
  if (serverName !== "codebase-memory") {
    return [
      {
        server: serverName,
        name: `${serverName}.status`,
        description:
          "MCP server health and tool discovery placeholder; real tool schemas are not dumped.",
        discovery,
        trusted: discovery === "discovered",
        schemaLoaded: discovery === "discovered",
        runtimeVersion: discovery === "discovered" ? "compatible" : "unknown",
      },
    ];
  }
  return Object.keys(codebaseMemoryRequiredArgs()).map((tool) => ({
    server: serverName,
    name: `${serverName}.${tool}`,
    description: `codebase-memory ${tool}; schema summary only, full schema omitted.`,
    discovery,
    trusted: discovery === "discovered",
    schemaLoaded: discovery === "discovered",
    runtimeVersion: discovery === "discovered" ? "compatible" : "unknown",
  }));
}

export function createIndexState(config: LinghunConfig): IndexState {
  return {
    enabled: config.index.enabled,
    status: config.index.enabled ? "unknown" : "missing",
  };
}

export async function createMemoryState(
  config: LinghunConfig,
  projectPath: string,
): Promise<MemoryState> {
  const paths = resolveStoragePaths(config, projectPath);
  const projectRulesPath = join(projectPath, "LINGHUN.md");
  const projectRules = await loadProjectRulesSummary(projectRulesPath);
  return {
    projectRulesPath,
    projectRulesExists: projectRules.exists,
    projectRulesSummary: projectRules.summary,
    ...(projectRules.error ? { projectRulesError: projectRules.error } : {}),
    projectDir: paths.memoryProject,
    userDir: paths.memoryUser,
    sessionDir: paths.memorySession,
    candidates: [],
    accepted: await loadMemoryByStatus(paths, "accepted"),
    rejected: await loadMemoryByStatus(paths, "rejected"),
    disabled: await loadMemoryByStatus(paths, "disabled"),
    retired: await loadMemoryByStatus(paths, "retired"),
  };
}

async function loadProjectRulesSummary(
  path: string,
): Promise<{ exists: boolean; summary: string; error?: string }> {
  try {
    const content = await readFile(path, "utf8");
    return { exists: true, summary: summarizeProjectRules(content) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { exists: false, summary: "missing" };
    }
    return { exists: false, summary: "unreadable", error: formatError(error) };
  }
}

function summarizeProjectRules(content: string): string {
  const normalized = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ");
  return truncateDisplay(normalized || "empty", PROJECT_RULES_SUMMARY_WIDTH);
}

async function loadMemoryByStatus(
  paths: ReturnType<typeof resolveStoragePaths>,
  status: MemoryStatus,
): Promise<MemoryCandidate[]> {
  const [projectMemory, userMemory] = await Promise.all([
    loadMemoryDirByStatus(paths.memoryProject, status),
    loadMemoryDirByStatus(paths.memoryUser, status),
  ]);
  return [...projectMemory, ...userMemory].sort((a, b) => a.id.localeCompare(b.id));
}

async function loadMemoryDirByStatus(
  directory: string,
  status: MemoryStatus,
): Promise<MemoryCandidate[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const memory = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => readMemoryCandidate(join(directory, entry))),
  );
  return memory.filter(
    (item): item is MemoryCandidate => item !== null && normalizeMemoryStatus(item) === status,
  );
}

async function readMemoryCandidate(path: string): Promise<MemoryCandidate | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parseMemoryCandidate(value);
  } catch {
    return null;
  }
}

function parseMemoryCandidate(value: unknown): MemoryCandidate | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.source !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  if (value.scope !== "project" && value.scope !== "user" && value.scope !== "session") {
    return null;
  }
  const status =
    value.status === "candidate" ||
    value.status === "accepted" ||
    value.status === "rejected" ||
    value.status === "disabled" ||
    value.status === "retired"
      ? value.status
      : "accepted";
  const risk = value.risk === "medium" || value.risk === "high" ? value.risk : "low";
  const sourceRefs = Array.isArray(value.sourceRefs)
    ? value.sourceRefs.filter((item): item is string => typeof item === "string")
    : [value.source];
  return {
    id: value.id,
    scope: value.scope,
    status,
    summary: truncateDisplay(value.summary.replace(/\s+/g, " "), 240),
    source: value.source,
    sourceRefs: sourceRefs.slice(0, 6),
    risk,
    inferred: value.inferred === true,
    createdAt: value.createdAt,
  };
}

function normalizeMemoryStatus(item: MemoryCandidate): MemoryStatus {
  return item.status ?? "accepted";
}

function resolveConfiguredDir(projectPath: string, configured: string): string {
  if (configured.startsWith("~/")) {
    return join(homedir(), configured.slice(2));
  }
  return resolve(projectPath, configured);
}

export async function createSkillState(
  config: LinghunConfig,
  projectPath: string,
): Promise<SkillState> {
  const projectDir = resolveConfiguredDir(projectPath, config.skills.projectDir);
  const userDir = resolveConfiguredDir(projectPath, config.skills.userDir);
  try {
    const skills = await loadSkillSummaries(config, projectDir, userDir);
    return {
      enabled: config.skills.enabled,
      projectDir,
      userDir,
      skills,
      disabledIds: [...config.skills.disabledIds].sort((a, b) => a.localeCompare(b)),
      trustedIds: [...config.skills.trustedIds].sort((a, b) => a.localeCompare(b)),
      evolutionCandidates: [],
      rejectedEvolutionCandidates: [],
    };
  } catch (error) {
    return {
      enabled: config.skills.enabled,
      projectDir,
      userDir,
      skills: [],
      disabledIds: config.skills.disabledIds,
      trustedIds: config.skills.trustedIds,
      evolutionCandidates: [],
      rejectedEvolutionCandidates: [],
      lastError: formatError(error),
    };
  }
}

export function createWorkflowState(config: LinghunConfig): WorkflowState {
  return {
    enabled: config.workflows.enabled,
    disabledIds: [...config.workflows.disabledIds].sort((a, b) => a.localeCompare(b)),
    templates: [
      workflow("bug-fix", "定位 bug、做最小修复、运行相关验证", "medium", true, [
        "corepack pnpm test",
        "corepack pnpm typecheck",
      ]),
      workflow("design-to-code", "把已确认设计转成最小代码改动", "high", true, [
        "corepack pnpm test",
        "corepack pnpm build",
      ]),
      workflow("doc-to-code", "按文档差异补齐代码入口和验证", "medium", true, [
        "corepack pnpm test",
        "corepack pnpm check",
      ]),
      workflow("refactor-plan", "只输出重构计划与风险，不直接改代码", "medium", false, [
        "corepack pnpm typecheck",
      ]),
      workflow("release-note", "基于已验证变更生成发布说明", "low", false, ["corepack pnpm check"]),
      workflow("review", "只读审查 diff、风险和验证证据", "low", false, ["corepack pnpm test"]),
      workflow(
        "solution-completeness-check",
        "先判断 single_issue/systemic_gap、影响面、P0/P1/P2、阶段边界和验证方式",
        "low",
        false,
        ["focused Solution Completeness Gate test"],
      ),
    ].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function workflow(
  id: string,
  purpose: string,
  risk: WorkflowTemplate["risk"],
  writesFiles: boolean,
  recommendedValidation: string[],
): WorkflowTemplate {
  return {
    id,
    purpose,
    risk,
    writesFiles,
    recommendedValidation,
    steps: [
      "Start Gate：启动前先让用户确认范围。",
      "执行中任何写文件、Bash、联网或依赖安装仍走现有权限管道。",
      "结束前提示运行推荐验证，并输出修改文件、验证结果、已知限制和范围边界。",
    ],
  };
}

export async function createHookState(
  config: LinghunConfig,
  projectPath: string,
): Promise<HookState> {
  const hooks = await loadHookSummaries(config, projectPath);
  return {
    enabled: config.hooks.enabled,
    projectTrusted: config.hooks.projectTrusted,
    timeoutMs: config.hooks.timeoutMs,
    outputLimitBytes: config.hooks.outputLimitBytes,
    hooks,
    recentErrors: hooks.flatMap((hook) =>
      hook.lastError ? [`${hook.id}: ${hook.lastError}`] : [],
    ),
  };
}

export async function createPluginState(
  config: LinghunConfig,
  projectPath: string,
): Promise<PluginState> {
  const projectDir = resolveConfiguredDir(projectPath, config.plugins.projectDir);
  const userDir = resolveConfiguredDir(projectPath, config.plugins.userDir);
  try {
    const plugins = await loadPluginSummaries(config, projectDir, userDir);
    return {
      enabled: config.plugins.enabled,
      projectDir,
      userDir,
      plugins,
      disabledIds: [...config.plugins.disabledIds].sort((a, b) => a.localeCompare(b)),
      trustedIds: [...config.plugins.trustedIds].sort((a, b) => a.localeCompare(b)),
    };
  } catch (error) {
    return {
      enabled: config.plugins.enabled,
      projectDir,
      userDir,
      plugins: [],
      disabledIds: config.plugins.disabledIds,
      trustedIds: config.plugins.trustedIds,
      lastError: formatError(error),
    };
  }
}

async function loadSkillSummaries(
  config: LinghunConfig,
  projectDir: string,
  userDir: string,
): Promise<SkillSummary[]> {
  const loaded = await Promise.all([
    loadSkillDir(config, projectDir, "project"),
    loadSkillDir(config, userDir, "user"),
  ]);
  return loaded.flat().sort((a, b) => a.id.localeCompare(b.id));
}

async function loadSkillDir(
  config: LinghunConfig,
  directory: string,
  scope: ExtensionScope,
): Promise<SkillSummary[]> {
  const entries = await readJsonManifestFiles(directory);
  const items = await Promise.all(entries.map((path) => readSkillManifest(config, path, scope)));
  return items.filter((item): item is SkillSummary => item !== null);
}

async function readSkillManifest(
  config: LinghunConfig,
  path: string,
  scope: ExtensionScope,
): Promise<SkillSummary | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const id = stableId(value.id, basename(path, extname(path)));
    const permissions = stringArray(value.permissions).sort((a, b) => a.localeCompare(b));
    const source = parseSource(value.source, scope);
    const trusted = source === "official" || config.skills.trustedIds.includes(id);
    const enabled = config.skills.enabled && !config.skills.disabledIds.includes(id) && trusted;
    return {
      id,
      name: stringValue(value.name, id),
      description: truncateDisplay(stringValue(value.description, "no description"), 240),
      triggers: stringArray(value.triggers).sort((a, b) => a.localeCompare(b)),
      summary: truncateDisplay(stringValue(value.summary, stringValue(value.description, "")), 600),
      source,
      scope,
      path,
      version: stringValue(value.version, "0.0.0"),
      enabled,
      trusted,
      permissions,
      mayWrite: permissions.includes("write"),
      mayExecute: permissions.includes("bash") || permissions.includes("execute"),
      mayNetwork: permissions.includes("network"),
      lifecycle: readLifecycleRecord(value, {
        path,
        source,
        trusted,
        enabled,
        permissions,
        hasSchema: true,
      }),
    };
  } catch (error) {
    return {
      id: basename(path, extname(path)),
      name: basename(path),
      description: "manifest load failed; skill isolated from main session",
      triggers: [],
      summary: "manifest load failed; skill isolated from prompt and tools",
      source: scope === "project" ? "third-party" : "local",
      scope,
      path,
      version: "unknown",
      enabled: false,
      trusted: false,
      permissions: [],
      mayWrite: false,
      mayExecute: false,
      mayNetwork: false,
      lifecycle: {
        localPath: path,
        trustLevel: "disabled",
        permissionSummary: "none",
        discovered: false,
        registered: false,
        schemaLoaded: false,
        runtimeVersion: "unknown",
      },
      lastError: formatError(error),
    };
  }
}

async function loadPluginSummaries(
  config: LinghunConfig,
  projectDir: string,
  userDir: string,
): Promise<PluginSummary[]> {
  const loaded = await Promise.all([
    loadPluginDir(config, projectDir, "project"),
    loadPluginDir(config, userDir, "user"),
  ]);
  return loaded.flat().sort((a, b) => a.id.localeCompare(b.id));
}

async function loadPluginDir(
  config: LinghunConfig,
  directory: string,
  scope: ExtensionScope,
): Promise<PluginSummary[]> {
  const entries = await readJsonManifestFiles(directory);
  const items = await Promise.all(entries.map((path) => readPluginManifest(config, path, scope)));
  return items.filter((item): item is PluginSummary => item !== null);
}

async function readPluginManifest(
  config: LinghunConfig,
  path: string,
  scope: ExtensionScope,
): Promise<PluginSummary | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const id = stableId(value.id, basename(path, extname(path)));
    const permissions = stringArray(value.permissions).sort((a, b) => a.localeCompare(b));
    const source = parseSource(value.source, scope);
    const trusted = source === "official" || config.plugins.trustedIds.includes(id);
    const enabled = config.plugins.enabled && !config.plugins.disabledIds.includes(id) && trusted;
    const contributions = normalizeContributions(value.contributions);
    return {
      id,
      name: stringValue(value.name, id),
      version: stringValue(value.version, "0.0.0"),
      description: truncateDisplay(stringValue(value.description, "no description"), 240),
      source,
      scope,
      path,
      enabled,
      trusted,
      permissions,
      mayWrite: permissions.includes("write"),
      mayExecute: permissions.includes("bash") || permissions.includes("execute"),
      mayNetwork: permissions.includes("network"),
      lifecycle: readLifecycleRecord(value, {
        path,
        source,
        trusted,
        enabled,
        permissions,
        hasSchema: Object.values(contributions).some((items) => items.length > 0),
      }),
      contributions,
    };
  } catch (error) {
    return {
      id: basename(path, extname(path)),
      name: basename(path),
      version: "unknown",
      description: "manifest load failed; plugin isolated from main session",
      source: scope === "project" ? "third-party" : "local",
      scope,
      path,
      enabled: false,
      trusted: false,
      permissions: [],
      mayWrite: false,
      mayExecute: false,
      mayNetwork: false,
      lifecycle: {
        localPath: path,
        trustLevel: "disabled",
        permissionSummary: "none",
        discovered: false,
        registered: false,
        schemaLoaded: false,
        runtimeVersion: "unknown",
      },
      contributions: normalizeContributions(undefined),
      lastError: formatError(error),
    };
  }
}

async function loadHookSummaries(
  config: LinghunConfig,
  projectPath: string,
): Promise<HookSummary[]> {
  const pluginHooks = (await createPluginState(config, projectPath)).plugins.flatMap((plugin) =>
    plugin.contributions.hooks.map((event) => ({ plugin, event })),
  );
  return pluginHooks
    .map(({ plugin, event }) => ({
      id: `${plugin.id}:${event}`,
      event: parseHookEvent(event),
      source: plugin.source,
      scope: plugin.scope,
      path: plugin.path,
      enabled:
        config.hooks.enabled &&
        plugin.enabled &&
        plugin.trusted &&
        (plugin.scope !== "project" || config.hooks.projectTrusted),
      trusted: plugin.trusted && (plugin.scope !== "project" || config.hooks.projectTrusted),
      timeoutMs: config.hooks.timeoutMs,
      outputLimitBytes: config.hooks.outputLimitBytes,
      permissions: plugin.permissions,
      logPath: join(projectPath, ".linghun", "logs", "hooks", `${plugin.id}.log`),
      lastError: plugin.lastError,
    }))
    .sort((a, b) => `${a.event}:${a.id}`.localeCompare(`${b.event}:${b.id}`));
}

function parseHookEvent(value: string): HookSummary["event"] {
  const allowed: HookSummary["event"][] = [
    "Notification",
    "Plugin",
    "PostToolUse",
    "PreToolUse",
    "Stop",
    "Workflow",
  ];
  return allowed.includes(value as HookSummary["event"])
    ? (value as HookSummary["event"])
    : "Plugin";
}

async function readJsonManifestFiles(directory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => join(directory, entry))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeContributions(value: unknown): PluginSummary["contributions"] {
  const input = isRecord(value) ? value : {};
  return {
    commands: stringArray(input.commands).sort((a, b) => a.localeCompare(b)),
    hooks: stringArray(input.hooks).sort((a, b) => a.localeCompare(b)),
    mcpServers: stringArray(input.mcpServers).sort((a, b) => a.localeCompare(b)),
    providers: stringArray(input.providers).sort((a, b) => a.localeCompare(b)),
    skills: stringArray(input.skills).sort((a, b) => a.localeCompare(b)),
    workflows: stringArray(input.workflows).sort((a, b) => a.localeCompare(b)),
  };
}

function parseSource(value: unknown, scope: ExtensionScope): ExtensionSource {
  if (value === "official" || value === "third-party" || value === "local") {
    return value;
  }
  return scope === "project" ? "third-party" : "local";
}

function stableId(value: unknown, fallback: string): string {
  return stringValue(value, fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function permissionSummary(permissions: string[]): string {
  if (permissions.length === 0) {
    return "none";
  }
  const risks = [
    permissions.includes("write") ? "write" : undefined,
    permissions.includes("bash") || permissions.includes("execute") ? "execute" : undefined,
    permissions.includes("network") ? "network" : undefined,
  ].filter((item): item is string => Boolean(item));
  return risks.length > 0 ? risks.join("+") : permissions.join("+");
}

function readLifecycleRecord(
  value: Record<string, unknown>,
  options: {
    path: string;
    source: ExtensionSource;
    trusted: boolean;
    enabled: boolean;
    permissions: string[];
    hasSchema: boolean;
  },
): ExtensionLifecycleRecord {
  const raw = isRecord(value.lifecycle) ? value.lifecycle : value;
  return {
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : undefined,
    localPath: typeof raw.localPath === "string" ? raw.localPath : options.path,
    ref: typeof raw.ref === "string" ? raw.ref : undefined,
    commit: typeof raw.commit === "string" ? raw.commit : undefined,
    installedAt: typeof raw.installedAt === "string" ? raw.installedAt : undefined,
    trustLevel: options.enabled ? "trusted" : options.trusted ? "disabled" : "untrusted",
    permissionSummary: permissionSummary(options.permissions),
    discovered: true,
    registered: true,
    schemaLoaded: options.hasSchema,
    runtimeVersion: "compatible",
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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
    solutionCompleteness: createSolutionCompletenessStatus(),
    backgroundAbortControllers: new Map(),
  };
  await hydrateDurableJobBackgroundTasks(context);
  const gateway = createModelGateway(config);

  writeLine(output, t(context, "appTitle", { name: LINGHUN_NAME }));
  writeStatus(output, context);
  writeLine(output, `${t(context, "intro")}\n`);
  if (!context.memory.projectRulesExists) {
    writeLine(output, t(context, "projectRulesMissingHint"));
  }

  const sigintHandler = () => {
    const controller = context.activeAbortController ?? context.activeVerificationAbortController;
    if (!controller) {
      return;
    }
    controller.abort();
    writeLine(output, t(context, "toolInterrupted"));
  };
  process.once("SIGINT", sigintHandler);

  try {
    for await (const line of readInputLines(input, output)) {
      process.removeListener("SIGINT", sigintHandler);
      process.once("SIGINT", sigintHandler);
      const text = line.trim();
      if (!text) {
        continue;
      }

      const commandResult = await handleSlashCommand(text, context, output);
      if (commandResult === "exit") {
        if (context.sessionId && !context.sessionEnded) {
          await store.appendEvent(context.sessionId, createSessionEndEvent(context.sessionId));
          context.sessionEnded = true;
        }
        writeLine(output, t(context, "exit"));
        return 0;
      }
      if (commandResult === "message") {
        const naturalResult = await handleNaturalInput(text, context, gateway, output);
        if (naturalResult === "message") {
          await sendMessage(text, context, gateway, output);
        }
      }
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "TUI 运行失败。";
    writeLine(errorOutput, `错误：${message}`);
    return 1;
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}

export async function handleSlashCommand(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<"handled" | "exit" | "message"> {
  if (!text.startsWith("/")) {
    return "message";
  }

  if (context.pendingNaturalCommand?.exactCommand === text.trim()) {
    context.pendingNaturalCommand = undefined;
  }

  const [command, ...rest] = text.split(/\s+/);
  if (command === "/help") {
    writeLine(output, formatCatalogHelp(context.language));
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
  if (command === "/exit") {
    return "exit";
  }

  writeLine(
    output,
    context.language === "en-US"
      ? `Unknown command: ${command}. Type /help to see available commands.`
      : `未知命令：${command}。输入 /help 查看可用命令。`,
  );
  return "handled";
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
    writeLine(output, formatRunnerDoctor(context));
    return;
  }
  if (["readiness", "status", "checklist", "project", "report"].includes(action)) {
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

type NativeRunnerResolution = {
  status: NativeRunnerResolutionStatus;
  enabled: boolean;
  source: NativeRunnerConfig["source"];
  path?: string;
  pathRef: string;
  bundledCandidateRef: string;
  version?: string;
  protocol?: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  platformArch: string;
  nodeFallback: "available";
  lastError?: string;
  nextAction: string;
};

type NativeRunnerCandidate = {
  path?: string;
  ref: string;
  platformArch: string;
  supported: boolean;
};

type NativeRunnerAdapterResult = {
  status: NativeRunnerLifecycleStatus;
  adapter: "native" | "node";
  protocol?: string;
  version?: string;
  heartbeatAt?: string;
  logRefs?: {
    state: string;
    stdout: string;
    stderr: string;
  };
  lastError?: string;
  fallbackReason?: string;
};

function resolveNativeRunner(config: LinghunConfig): NativeRunnerResolution {
  const runner = config.nativeRunner;
  const bundledCandidate = getBundledNativeRunnerCandidate();
  const base = {
    bundledCandidateRef: bundledCandidate.ref,
    platform: process.platform,
    arch: process.arch,
    platformArch: bundledCandidate.platformArch,
    nodeFallback: "available" as const,
  };
  if (!runner.enabled) {
    return {
      status: "disabled",
      enabled: false,
      source: "disabled",
      pathRef: "disabled",
      ...base,
      nextAction: "Native runner is disabled; Node/TUI remains the fallback for durable jobs.",
    };
  }
  const resolvedPath = resolveNativeRunnerPath(runner, bundledCandidate);
  if (!resolvedPath) {
    return {
      status: "unavailable",
      enabled: true,
      source: runner.source,
      pathRef: "missing",
      ...base,
      lastError:
        runner.source === "bundled" && !bundledCandidate.supported
          ? `bundled runner platform is not supported: ${bundledCandidate.platformArch}`
          : "runner path is not configured",
      nextAction:
        runner.source === "bundled"
          ? "Install a Linghun package with a bundled runner for this platform, or keep using Node fallback."
          : "Configure a project-local/custom runner path for development, or keep using Node fallback.",
    };
  }
  if (!existsSync(resolvedPath) || !isExecutableNativeRunnerCandidate(resolvedPath)) {
    return {
      status: "unavailable",
      enabled: true,
      source: runner.source,
      path: resolvedPath,
      pathRef: redactedPath(resolvedPath),
      ...base,
      lastError: "runner binary is missing or not executable",
      nextAction:
        runner.source === "bundled"
          ? "Bundled runner is unavailable; reinstall/repair Linghun or continue with Node fallback."
          : "Repair runner execution permissions or keep using Node fallback.",
    };
  }
  const versionCommand = createNativeRunnerCommand(resolvedPath, ["version"]);
  const version = spawnSync(versionCommand.command, versionCommand.args, {
    cwd: dirname(resolvedPath),
    encoding: "utf8",
    timeout: NATIVE_RUNNER_VERSION_TIMEOUT_MS,
    windowsHide: true,
  });
  const raw = `${version.stdout ?? ""}\n${version.stderr ?? ""}`.trim();
  if (version.error || version.status !== 0) {
    return {
      status: "unavailable",
      enabled: true,
      source: runner.source,
      path: resolvedPath,
      pathRef: redactedPath(resolvedPath),
      ...base,
      lastError: sanitizeDiagnosticText(
        version.error instanceof Error ? version.error.message : raw || "version probe failed",
      ),
      nextAction: "Repair runner execution permissions or keep using Node fallback.",
    };
  }
  const parsed = parseRunnerJson(raw);
  const protocol = stringValue(parsed.protocol, "unknown");
  const runnerVersion = stringValue(parsed.version, "unknown");
  if (protocol !== runner.expectedProtocol) {
    return {
      status: "protocol_mismatch",
      enabled: true,
      source: runner.source,
      path: resolvedPath,
      pathRef: redactedPath(resolvedPath),
      version: runnerVersion,
      protocol,
      ...base,
      lastError: `protocol mismatch: expected ${runner.expectedProtocol}, got ${protocol}`,
      nextAction:
        "Use a compatible bundled/project-local runner build, or continue with Node fallback.",
    };
  }
  return {
    status: "available",
    enabled: true,
    source: runner.source,
    path: resolvedPath,
    pathRef: redactedPath(resolvedPath),
    version: runnerVersion,
    protocol,
    ...base,
    nextAction:
      "Native runner may supervise approved durable job specs; Node fallback remains available.",
  };
}

function resolveNativeRunnerPath(
  runner: NativeRunnerConfig,
  bundledCandidate: NativeRunnerCandidate,
): string | undefined {
  if (runner.source === "bundled") {
    return bundledCandidate.path;
  }
  if (runner.path) {
    return resolve(runner.path);
  }
  return undefined;
}

function getBundledNativeRunnerCandidate(): NativeRunnerCandidate {
  const platformArch = getNativeRunnerPlatformArch();
  const supported = NATIVE_RUNNER_BUNDLED_PLATFORM_ARCHES.has(platformArch);
  const targetPlatform = platformArch.split("-")[0];
  const names =
    targetPlatform === "win32"
      ? ["linghun-native-runner.exe", "linghun-native-runner.cjs"]
      : ["linghun-native-runner", "linghun-native-runner.cjs"];
  const rootCandidates = getBundledNativeRunnerRoots();
  for (const root of rootCandidates) {
    for (const name of names) {
      const candidate = join(root, platformArch, name);
      if (existsSync(candidate)) {
        return {
          path: candidate,
          ref: `bundled:${platformArch}/${name}`,
          platformArch,
          supported,
        };
      }
    }
  }
  return {
    path:
      supported && rootCandidates[0]
        ? join(rootCandidates[0], platformArch, names[0] ?? "linghun-native-runner")
        : undefined,
    ref: `bundled:${platformArch}/${names[0] ?? "linghun-native-runner"}`,
    platformArch,
    supported,
  };
}

function getNativeRunnerPlatformArch(): string {
  const override = process.env.LINGHUN_NATIVE_RUNNER_PLATFORM_ARCH_TEST;
  if (override && NATIVE_RUNNER_BUNDLED_PLATFORM_ARCHES.has(override)) {
    return override;
  }
  return `${process.platform}-${process.arch}`;
}

function getBundledNativeRunnerRoots(): string[] {
  const roots: string[] = [];
  if (process.env.LINGHUN_NATIVE_RUNNER_BUNDLED_DIR) {
    roots.push(process.env.LINGHUN_NATIVE_RUNNER_BUNDLED_DIR);
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  roots.push(join(moduleDir, "..", "native-runner"));
  roots.push(join(moduleDir, "native-runner"));
  return roots;
}

function isExecutableNativeRunnerCandidate(path: string): boolean {
  try {
    accessSync(
      path,
      process.platform === "win32" ? constants.R_OK : constants.R_OK | constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function parseRunnerJson(raw: string): Record<string, unknown> {
  for (const line of raw.split(/\r?\n/u).filter(Boolean).reverse()) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // keep looking for the short JSON protocol line
    }
  }
  return {};
}

function createNativeRunnerCommand(
  runnerPath: string,
  args: string[],
): { command: string; args: string[] } {
  if (runnerPath.endsWith(".js") || runnerPath.endsWith(".cjs") || runnerPath.endsWith(".mjs")) {
    return { command: process.execPath, args: [runnerPath, ...args] };
  }
  return { command: runnerPath, args };
}

function formatRunnerDoctor(context: TuiContext): string {
  const resolution = resolveNativeRunner(context.config);
  return [
    `Native Runner Doctor：${resolution.status}；Node fallback=${resolution.nodeFallback}；主 TUI 不因 runner 问题崩溃。`,
    `- enabled: ${resolution.enabled ? "yes" : "no"}`,
    `- source: ${resolution.source}`,
    `- platform/arch: ${resolution.platform}/${resolution.arch}`,
    `- bundled platform/arch: ${resolution.platformArch}`,
    `- bundled candidate: ${resolution.bundledCandidateRef}`,
    `- resolved path: ${resolution.pathRef}`,
    `- version/protocol: ${resolution.version ?? "unknown"} / ${resolution.protocol ?? context.config.nativeRunner.expectedProtocol}`,
    `- fallback reason: ${resolution.status === "available" ? "none" : resolution.lastError ? sanitizeDiagnosticText(resolution.lastError) : resolution.status}`,
    `- next action: ${resolution.nextAction}`,
    "- boundary: runner only accepts Linghun-approved job specs; it is not a second provider/tool/agent runtime and cannot decide verification PASS.",
    "- DEFERRED: managed/bundled binary distribution, signing/AV/install matrix, and Unix/macOS process-group cleanup.",
  ].join("\n");
}

function formatJobRunnerInline(job: DurableJobState): string {
  if (!job.runner) {
    return "runner=not_started; Node/TUI default";
  }
  const heartbeat = job.runner.heartbeatAt ? `; heartbeat=${job.runner.heartbeatAt}` : "";
  return `runner=${job.runner.adapter}/${job.runner.status}; resolution=${job.runner.resolution}; fallback=${job.runner.fallbackReason ?? "none"}${heartbeat}`;
}

function formatJobRunnerReportLine(job: DurableJobState): string {
  if (!job.runner) {
    return "- runner: not_started; Node/TUI default path remains active.";
  }
  const logRefs = job.runner.logRefs
    ? `; logs=state:${job.runner.logRefs.state},stdout:${job.runner.logRefs.stdout},stderr:${job.runner.logRefs.stderr}`
    : "";
  return `- runner: enabled=${job.runner.enabled}; adapter=${job.runner.adapter}; status=${job.runner.status}; resolution=${job.runner.resolution}; pathRef=${job.runner.pathRef ?? "-"}; protocol=${job.runner.protocol ?? "unknown"}; version=${job.runner.version ?? "unknown"}; heartbeat=${job.runner.heartbeatAt ?? "-"}; fallback=${job.runner.fallbackReason ?? "none"}; lastError=${job.runner.lastError ?? "none"}; next=${job.runner.nextAction}${logRefs}`;
}

function formatApprovedRunnerSpecLine(job: DurableJobState): string {
  const spec = job.runner?.spec;
  if (!spec) {
    return "- approved spec: none";
  }
  return `- approved spec: id=${spec.id}; taskKind=${spec.approvedTaskKind}; cwdRef=${redactedPath(spec.cwd)}; timeoutMs=${spec.timeoutMs}; expectedProtocol=${spec.expectedProtocol}; envAllowlist=${spec.envAllowlist.join(",") || "none"}; redactedEnvRefs=${spec.redactedEnvRefs.join(",") || "none"}; evidenceRefs=${spec.evidenceRefs.join(",") || "none"}; logRefs=state/stdout/stderr/jobLog/fullOutput/report`;
}

function createApprovedRunnerJobSpec(
  context: TuiContext,
  job: DurableJobState,
  resolution: NativeRunnerResolution,
): ApprovedRunnerJobSpec {
  const runnerRoot = join(dirname(job.logPath), "runner");
  return {
    id: job.id,
    approvedTaskKind: "durable_job_supervisor",
    cwd: context.projectPath,
    envAllowlist: [],
    redactedEnvRefs: ["PATH:runtime-only"],
    timeoutMs: Math.min(job.timeoutMs, context.config.nativeRunner.timeoutMs),
    logPaths: {
      state: join(runnerRoot, job.id, "state.json"),
      stdout: join(runnerRoot, job.id, "stdout.log"),
      stderr: join(runnerRoot, job.id, "stderr.log"),
      jobLog: job.logPath,
      fullOutput: job.fullOutputPath,
      report: job.reportPath,
    },
    expectedProtocol: resolution.protocol ?? context.config.nativeRunner.expectedProtocol,
    permissionRef: job.permissionPolicy,
    evidenceRefs: job.evidenceRefs.map((item) => item.id),
    runnerRoot,
  };
}

async function startRunnerForDurableJob(context: TuiContext, job: DurableJobState): Promise<void> {
  const resolution = resolveNativeRunner(context.config);
  const spec = createApprovedRunnerJobSpec(context, job, resolution);
  const result = await startApprovedRunnerSpec(context, spec, resolution);
  const now = new Date().toISOString();
  job.runner = {
    enabled: resolution.enabled,
    status: result.status,
    resolution: resolution.status,
    adapter: result.adapter,
    protocol: result.protocol ?? resolution.protocol,
    version: result.version ?? resolution.version,
    pathRef: resolution.pathRef,
    spec,
    startedAt: now,
    updatedAt: now,
    completedAt:
      result.status === "completed" || result.status === "node_fallback" ? now : undefined,
    heartbeatAt: result.heartbeatAt,
    logRefs: result.logRefs,
    lastError: result.lastError,
    fallbackReason: result.fallbackReason,
    nextAction:
      result.adapter === "node"
        ? "Node/TUI fallback is active; inspect /job report and logs."
        : result.status === "running"
          ? "Native runner is supervising an approved long-running task; verification remains partial until verified separately."
          : "Native runner reached a terminal lifecycle state; verification remains partial until verified separately.",
  };
  await appendJobLog(
    job,
    `runner adapter=${job.runner.adapter} status=${job.runner.status} resolution=${job.runner.resolution} fallback=${job.runner.fallbackReason ?? "none"}`,
  );
}

async function startApprovedRunnerSpec(
  _context: TuiContext,
  spec: ApprovedRunnerJobSpec,
  resolution: NativeRunnerResolution,
): Promise<NativeRunnerAdapterResult> {
  if (resolution.status !== "available" || !resolution.path) {
    return {
      status: "node_fallback",
      adapter: "node",
      protocol: resolution.protocol,
      version: resolution.version,
      lastError: resolution.lastError,
      fallbackReason: resolution.status,
    };
  }
  await mkdir(spec.runnerRoot, { recursive: true });
  const taskDurationMs =
    spec.timeoutMs <= NATIVE_RUNNER_APPROVED_TASK_HEARTBEAT_MS * 8
      ? spec.timeoutMs + NATIVE_RUNNER_APPROVED_TASK_HEARTBEAT_MS * 5
      : 1_200;
  const startCommand = createNativeRunnerCommand(resolution.path, [
    "start",
    "--id",
    spec.id,
    "--root",
    spec.runnerRoot,
    "--timeout-ms",
    String(spec.timeoutMs),
    "--heartbeat-ms",
    String(NATIVE_RUNNER_APPROVED_TASK_HEARTBEAT_MS),
    "--",
    process.execPath,
    "-e",
    NATIVE_RUNNER_APPROVED_TASK_SCRIPT,
    String(taskDurationMs),
  ]);
  let child!: ReturnType<typeof spawn>;
  try {
    child = spawn(startCommand.command, startCommand.args, {
      cwd: spec.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => {
      // The adapter observes missing state below and falls back to Node/TUI.
    });
    child.unref();
  } catch (error) {
    return {
      status: "node_fallback",
      adapter: "node",
      protocol: resolution.protocol,
      version: resolution.version,
      lastError: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
      fallbackReason: "start_failed",
    };
  }

  const state = await waitForRunnerState(spec, NATIVE_RUNNER_START_STATE_WAIT_MS);
  if (!state) {
    const failed = await new Promise<boolean>((resolve) => {
      if (child.exitCode !== null) {
        resolve(true);
        return;
      }
      child.once("exit", () => resolve(true));
      setTimeout(() => resolve(false), 25);
    });
    return {
      status: "node_fallback",
      adapter: "node",
      protocol: resolution.protocol,
      version: resolution.version,
      lastError: failed
        ? "runner start failed before writing observable state"
        : "runner did not write observable state before startup timeout",
      fallbackReason: "start_failed",
    };
  }
  const status = mapNativeRunnerStatus(stringValue(state.status, "running"));
  return {
    status,
    adapter: "native",
    protocol: stringValue(state.protocol, resolution.protocol ?? "unknown"),
    version: resolution.version,
    heartbeatAt: runnerHeartbeatValue(state),
    logRefs: runnerLogRefs(spec, state),
    lastError:
      status === "failed"
        ? sanitizeDiagnosticText(stringValue(state.error, "runner start failed"))
        : undefined,
  };
}

async function waitForRunnerState(
  spec: ApprovedRunnerJobSpec,
  timeoutMs: number,
): Promise<Record<string, unknown> | undefined> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const state = await readRunnerState(spec);
    if (state) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

async function readRunnerState(
  spec: ApprovedRunnerJobSpec,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(spec.logPaths.state, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function runnerHeartbeatValue(state: Record<string, unknown>): string | undefined {
  const heartbeatAt = state.heartbeatAt;
  if (typeof heartbeatAt === "number" || typeof heartbeatAt === "string") {
    return String(heartbeatAt);
  }
  const updatedAt = state.updatedAt;
  return typeof updatedAt === "number" || typeof updatedAt === "string"
    ? String(updatedAt)
    : undefined;
}

function runnerLogRefs(
  spec: ApprovedRunnerJobSpec,
  state: Record<string, unknown>,
): { state: string; stdout: string; stderr: string } {
  return {
    state: "state.json",
    stdout: safeRunnerLogRef(state.stdoutPath, spec.logPaths.stdout),
    stderr: safeRunnerLogRef(state.stderrPath, spec.logPaths.stderr),
  };
}

function safeRunnerLogRef(value: unknown, fallbackPath: string): string {
  const fallback = basename(fallbackPath);
  if (typeof value !== "string" || value.trim().length === 0) {
    return isSafeRunnerRelativeLogRef(fallback) ? fallback : "log";
  }
  const ref = sanitizeDiagnosticText(value.trim());
  if (isSafeRunnerRelativeLogRef(ref)) {
    return ref;
  }
  const redactedBasename = ref.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
  if (redactedBasename && isSafeRunnerRelativeLogRef(redactedBasename)) {
    return `present:${redactedBasename}`;
  }
  return isSafeRunnerRelativeLogRef(fallback) ? `present:${fallback}` : "present:log";
}

function isSafeRunnerRelativeLogRef(ref: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(ref) && !ref.includes("..") && !ref.includes(":");
}

function mapNativeRunnerStatus(status: string): NativeRunnerLifecycleStatus {
  if (status === "timeout") return "timeout";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "duplicate" || status === "missing") return "failed";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  return "failed";
}

function refreshRunnerStatusForJob(context: TuiContext, job: DurableJobState): void {
  if (!job.runner?.spec || job.runner.adapter !== "native") return;
  const resolution = resolveNativeRunner(context.config);
  if (resolution.status !== "available" || !resolution.path) {
    markJobRunnerFallback(job, resolution.status, resolution.lastError ?? resolution.status);
    return;
  }
  const statusCommand = createNativeRunnerCommand(resolution.path, [
    "status",
    "--id",
    job.runner.spec.id,
    "--root",
    job.runner.spec.runnerRoot,
  ]);
  const status = spawnSync(statusCommand.command, statusCommand.args, {
    encoding: "utf8",
    timeout: NATIVE_RUNNER_VERSION_TIMEOUT_MS,
    windowsHide: true,
  });
  const raw = `${status.stdout ?? ""}\n${status.stderr ?? ""}`.trim();
  if (status.error || status.status !== 0) {
    markJobRunnerFallback(job, "available", raw || "runner status failed", "status_failed");
    return;
  }
  const parsed = parseRunnerJson(raw);
  const mapped = mapNativeRunnerStatus(stringValue(parsed.status, job.runner.status));
  const now = new Date().toISOString();
  job.runner.status = mapped;
  job.runner.updatedAt = now;
  job.runner.heartbeatAt = runnerHeartbeatValue(parsed) ?? job.runner.heartbeatAt;
  job.runner.logRefs = runnerLogRefs(job.runner.spec, parsed);
  if (mapped !== "running") job.runner.completedAt ??= now;
  if (mapped === "timeout" || mapped === "cancelled" || mapped === "failed") {
    job.status = mapped;
    job.pauseReason = `runner_${mapped}`;
    job.updatedAt = now;
    job.endedAt = now;
    job.result = {
      status: mapped,
      summary: `Native runner reported ${mapped}; no PASS evidence generated.`,
      facts: [formatJobRunnerInline(job)],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: now,
    };
    rescheduleDurableJobAgents(job);
  }
}

async function stopRunnerForDurableJob(context: TuiContext, job: DurableJobState): Promise<void> {
  if (!job.runner?.spec || job.runner.adapter !== "native") {
    markJobRunnerTerminal(job, "cancelled", "node fallback or no native runner to stop");
    return;
  }
  const resolution = resolveNativeRunner(context.config);
  if (resolution.status === "available" && resolution.path) {
    const stopCommand = createNativeRunnerCommand(resolution.path, [
      "stop",
      "--id",
      job.runner.spec.id,
      "--root",
      job.runner.spec.runnerRoot,
    ]);
    spawnSync(stopCommand.command, stopCommand.args, {
      encoding: "utf8",
      timeout: NATIVE_RUNNER_VERSION_TIMEOUT_MS,
      windowsHide: true,
    });
  }
  markJobRunnerTerminal(job, "cancelled", "user_cancelled");
  await appendJobLog(job, "runner stop requested; cancelled is non-PASS");
}

function markJobRunnerTerminal(
  job: DurableJobState,
  status: NativeRunnerLifecycleStatus,
  reason: string,
): void {
  const now = new Date().toISOString();
  job.runner = {
    enabled: job.runner?.enabled ?? false,
    status,
    resolution: job.runner?.resolution ?? "unavailable",
    adapter: job.runner?.adapter ?? "node",
    protocol: job.runner?.protocol,
    version: job.runner?.version,
    pathRef: job.runner?.pathRef,
    spec: job.runner?.spec,
    startedAt: job.runner?.startedAt,
    updatedAt: now,
    completedAt: now,
    heartbeatAt: job.runner?.heartbeatAt,
    logRefs: job.runner?.logRefs,
    lastError: sanitizeDiagnosticText(reason),
    fallbackReason: job.runner?.fallbackReason,
    nextAction: "Inspect /job report and logs; runner terminal states are not verification PASS.",
  };
}

function markJobRunnerFallback(
  job: DurableJobState,
  resolution: NativeRunnerResolutionStatus,
  reason: string,
  fallbackReason: string = resolution,
): void {
  const now = new Date().toISOString();
  job.runner = {
    enabled: job.runner?.enabled ?? true,
    status: "node_fallback",
    resolution,
    adapter: "node",
    protocol: job.runner?.protocol,
    version: job.runner?.version,
    pathRef: job.runner?.pathRef,
    spec: job.runner?.spec,
    startedAt: job.runner?.startedAt,
    updatedAt: now,
    completedAt: now,
    heartbeatAt: job.runner?.heartbeatAt,
    logRefs: job.runner?.logRefs,
    lastError: sanitizeDiagnosticText(reason),
    fallbackReason,
    nextAction:
      "Node/TUI fallback is active; runner fallback is non-PASS and visible in report/background.",
  };
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
  if (action === "doctor") {
    writeLine(output, await formatModelRouteDoctor(context));
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
  writeLine(output, formatModelRouteSummary(context));
  writeLine(output, "提示：如需诊断配置，可运行 /model doctor 或 /model route doctor。");
  writeStatus(output, context);
}

async function handleModelRouteCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action) {
    writeLine(output, formatModelRoutes(context));
    return;
  }
  if (action === "doctor") {
    writeLine(output, await formatModelRouteDoctor(context));
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
    const route = getRoleRoute(context, role);
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

function isModelRole(value: string): value is ModelRole {
  return ["planner", "executor", "reviewer", "verifier", "summarizer", "vision", "image"].includes(
    value,
  );
}

function getRoleRoute(context: TuiContext, role: ModelRole): RoleModelRoute {
  const route = context.config.modelRoutes.routes.find((item) => item.role === role);
  if (route) {
    return route;
  }
  return {
    role,
    provider: "",
    primaryModel: "",
    fallbackModels: [],
    requiredCapabilities: ["text"],
    allowTools: false,
    allowWrite: false,
    allowBash: false,
    requireApprovalBeforeRun: true,
  };
}

function formatModelRouteSummary(context: TuiContext): string {
  const routes = context.config.modelRoutes.routes
    .map(
      (route) =>
        `${route.role}:${route.provider || "unknown"}/${route.primaryModel || "unconfigured"}`,
    )
    .slice(0, 4);
  return `角色路由摘要：${routes.length > 0 ? routes.join("；") : "未配置"}`;
}

function formatModelRoutes(context: TuiContext): string {
  return [
    "Model routes（多模型按角色触发，不默认乱开）",
    ...context.config.modelRoutes.routes.map((route) =>
      [
        `- ${route.role}: provider=${route.provider || "未配置"}`,
        `model=${route.primaryModel || "未配置"}`,
        `capabilities=${route.requiredCapabilities.join("+") || "none"}`,
        `tools=${route.allowTools ? "yes" : "no"}`,
        `write=${route.allowWrite ? "yes" : "no"}`,
        `bash=${route.allowBash ? "yes" : "no"}`,
        `budget=${route.maxCostCny === undefined ? "unconfigured" : `estimated <= ${route.maxCostCny} CNY`}`,
      ].join("  "),
    ),
    "提示：/model route doctor 诊断缺 provider、能力不足和预算配置。",
  ].join("\n");
}

async function formatModelRouteDoctor(context: TuiContext): Promise<string> {
  const lines = ["Model route doctor"];
  const projectSettingsApiKeyProviders = await readProjectSettingsApiKeyProviders(
    context.projectPath,
  );
  lines.push("- providers:");
  for (const [providerId, provider] of Object.entries(context.config.providers)) {
    const endpointProfile = provider.endpointProfile ?? "chat_completions";
    const compatibilityProfile =
      provider.compatibilityProfile ??
      (provider.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
    const reasoningLevel = provider.reasoningLevel;
    const reasoningStatus = reasoningLevel
      ? endpointProfile === "responses"
        ? `effective/sent level=${reasoningLevel}`
        : compatibilityProfile === "permissive_openai_compatible"
          ? `effective/sent level=${reasoningLevel}`
          : `ignored/unsupported/未生效 compatibilityProfile=${compatibilityProfile}`
      : "not configured/未生效";
    const baseUrlDiagnostic = resolveProviderBaseUrlDiagnostic(
      provider.baseUrl,
      endpointProfile as EndpointProfile,
    );
    const keySource = provider.apiKey
      ? getProviderKeySource(providerId, projectSettingsApiKeyProviders)
      : undefined;
    const contract = resolveProviderRuntimeContract({ id: providerId, ...provider });
    lines.push(
      `  - ${providerId}: type=${provider.type} provider=${providerId} model=${provider.model || "missing"} runtimeProfile=${contract.profile} endpointProfile=${contract.endpointProfile} compatibilityProfile=${contract.compatibilityProfile} baseUrl=${provider.baseUrl ? "present" : "missing"} endpointPath=${baseUrlDiagnostic.endpointPath} tools=${contract.supportsTools ? "enabled" : "disabled"} toolSchema=${contract.toolSchemaShape} toolResult=${contract.toolResultShape} retry=${contract.retryStatuses.join("/")}x${contract.maxAttempts} timeoutMs=${contract.requestTimeoutMs} idleTimeoutMs=${contract.streamIdleTimeoutMs} includeUsage=${contract.includeUsage ? "yes" : "no"} reasoning=${reasoningStatus} apiKey=${provider.apiKey && keySource ? `present source=${keySource} masked=${maskSecret(provider.apiKey)}` : "missing"}`,
    );
    if (projectSettingsApiKeyProviders.has(providerId)) {
      lines.push(
        `    WARN: project-settings provider=${providerId} contains apiKey; project .linghun/settings.json 不建议保存 apiKey，请迁移到环境变量或私有配置。`,
      );
    }
    if (baseUrlDiagnostic.hasQueryOrFragment) {
      lines.push(
        "    warning: baseUrl 包含 query/fragment；doctor 不显示原值，请改为不含 query/fragment 的 root baseUrl。",
      );
      lines.push(`    recommendation: ${baseUrlDiagnostic.recommendation}`);
    }
    if (baseUrlDiagnostic.fullEndpointSuffix) {
      lines.push(
        `    warning: baseUrl 包含完整 endpoint suffix=${baseUrlDiagnostic.fullEndpointSuffix}；已按 root baseUrl 诊断，最终 endpointPath=${baseUrlDiagnostic.endpointPath}`,
      );
      lines.push(`    recommendation: ${baseUrlDiagnostic.recommendation}`);
      if (baseUrlDiagnostic.profileMismatch) {
        lines.push(
          `    profile/baseUrl 不匹配：baseUrl suffix=${baseUrlDiagnostic.fullEndpointSuffix}，endpointProfile=${endpointProfile}`,
        );
      }
    }
  }
  for (const route of context.config.modelRoutes.routes) {
    const problems = diagnoseRoute(route, context);
    const level = getRouteDoctorLevel(route, problems, context);
    lines.push(
      `- ${route.role}: ${level}${problems.length === 0 ? "" : `：${problems.join("；")}`} provider=${route.provider || "未配置"} model=${route.primaryModel || "未配置"} fallback=${route.fallbackModels.length > 0 ? route.fallbackModels.join(",") : "未配置"}`,
    );
  }
  if (context.routeDecisions.length > 0) {
    lines.push("- recent route decisions:");
    for (const decision of context.routeDecisions.slice(0, 3)) {
      lines.push(
        `  - ${decision.role}: trigger=${decision.triggerReason} selected=${decision.selectedProvider || "paused"}/${decision.selectedModel || "paused"} fallbackUsed=${decision.fallbackUsed ? "yes" : "no"} stop=${decision.stopConditions.length > 0 ? decision.stopConditions.join("|") : "none"}`,
      );
    }
  }
  if (context.lastProviderFailure) {
    const failure = context.lastProviderFailure;
    lines.push(
      `- last provider failure: code=${failure.code} provider=${failure.provider} model=${failure.model} endpointProfile=${failure.endpointProfile}; details: /details evidence`,
    );
  }
  if (hasOpenAiCompatibleDoctorProblem(context)) {
    lines.push(
      "- openai-compatible 修复：设置 LINGHUN_OPENAI_BASE_URL、LINGHUN_OPENAI_API_KEY、LINGHUN_OPENAI_MODEL 后重启 Linghun。",
    );
  }
  if (hasOpenAiCompatiblePlaceholderProblem(context)) {
    lines.push(
      "- openai-compatible 占位提示：请检查 .linghun/settings.json，避免 openai-compatible-model 占位值覆盖真实模型。",
    );
  }
  lines.push(
    "- budget: 未配置预算只作为 WARN；金额仅在 /usage 或 /stats 中以 estimated 展示，状态栏不会显示金额。",
  );
  lines.push(
    "- handoff: 角色间只传 summary/evidence/diff/verification/keyFiles，不传完整 transcript/memory/index/logs。",
  );
  return lines.join("\n");
}

async function readProjectSettingsApiKeyProviders(projectPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(getProjectSettingsPath(projectPath), "utf8");
    const parsed = JSON.parse(raw) as { providers?: Record<string, { apiKey?: unknown }> };
    return new Set(
      Object.entries(parsed.providers ?? {})
        .filter(([, provider]) => typeof provider.apiKey === "string" && provider.apiKey.length > 0)
        .map(([providerId]) => providerId),
    );
  } catch {
    return new Set();
  }
}

function getProviderKeySource(
  providerId: string,
  projectSettingsApiKeyProviders: Set<string>,
): string {
  const envName = providerId === "deepseek" ? "LINGHUN_DEEPSEEK_API_KEY" : "LINGHUN_OPENAI_API_KEY";
  if (process.env[envName]) return "env";
  if (projectSettingsApiKeyProviders.has(providerId)) return "project-settings";
  return "merged-config";
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}

function hasOpenAiCompatibleDoctorProblem(context: TuiContext): boolean {
  const provider = context.config.providers["openai-compatible"];
  return Boolean(
    provider &&
      (!provider.baseUrl ||
        !provider.apiKey ||
        !provider.model ||
        provider.model === "openai-compatible-model"),
  );
}

function hasOpenAiCompatiblePlaceholderProblem(context: TuiContext): boolean {
  return context.config.providers["openai-compatible"]?.model === "openai-compatible-model";
}

function getRouteDoctorLevel(
  route: RoleModelRoute,
  problems: string[],
  context: TuiContext,
): "BLOCK" | "WARN" | "ok" {
  const primaryProblems = diagnoseConcreteRoute(route, route.primaryModel, route.provider, context);
  const primaryBlocking = getRouteBlockingProblems(primaryProblems);
  if (primaryBlocking.length > 0) {
    const hasUsableFallback = route.fallbackModels.some((fallbackModel) => {
      const fallbackProvider = inferProviderForRouteModel(fallbackModel, context);
      const fallbackProblems = diagnoseConcreteRoute(
        route,
        fallbackModel,
        fallbackProvider,
        context,
      );
      return getRouteBlockingProblems(fallbackProblems).length === 0;
    });
    return hasUsableFallback ? "WARN" : "BLOCK";
  }
  return problems.length > 0 ? "WARN" : "ok";
}

function diagnoseRoute(route: RoleModelRoute, context: TuiContext): string[] {
  const problems = diagnoseConcreteRoute(route, route.primaryModel, route.provider, context);
  if (route.fallbackModels.length === 0) {
    problems.push("fallbackModels 未配置");
  }
  for (const fallbackModel of route.fallbackModels) {
    const fallbackProvider = inferProviderForRouteModel(fallbackModel, context);
    const fallbackProblems = diagnoseConcreteRoute(route, fallbackModel, fallbackProvider, context);
    if (getRouteBlockingProblems(fallbackProblems).length > 0) {
      problems.push(
        `fallback 不可用 ${fallbackModel}：${getRouteBlockingProblems(fallbackProblems).join("/")}`,
      );
    }
  }
  if (route.maxCostCny === undefined) {
    problems.push("预算未配置");
  }
  if (
    (route.role === "planner" || route.role === "reviewer" || route.role === "vision") &&
    route.allowWrite
  ) {
    problems.push("权限过宽：不应写文件");
  }
  if (
    (route.role === "vision" || route.role === "image" || route.role === "planner") &&
    route.allowBash
  ) {
    problems.push("权限过宽：不应执行 Bash");
  }
  return problems;
}

function diagnoseConcreteRoute(
  route: RoleModelRoute,
  model: string,
  providerId: string,
  context: TuiContext,
): string[] {
  const problems: string[] = [];
  const provider = providerId ? context.config.providers[providerId] : undefined;
  if (!providerId) {
    problems.push("缺 provider");
  } else if (!provider) {
    problems.push("provider 未配置");
  }
  if (!model) {
    problems.push("缺模型");
  }
  if (provider?.type === "openai-compatible") {
    if (!provider.baseUrl) problems.push("openai-compatible 缺 baseUrl");
    if (!provider.apiKey) problems.push("openai-compatible 缺 apiKey");
    if (!provider.model || provider.model === "openai-compatible-model") {
      problems.push("openai-compatible 缺已确认模型");
    }
  }
  for (const capability of route.requiredCapabilities) {
    if (!routeSupportsCapability({ ...route, primaryModel: model }, capability)) {
      problems.push(
        capability === "tools" ? "能力不足：tools/tool calling" : `能力不足：${capability}`,
      );
    }
  }
  return problems;
}

function getRouteBlockingProblems(problems: string[]): string[] {
  return problems.filter(
    (problem) =>
      problem !== "预算未配置" &&
      problem !== "fallbackModels 未配置" &&
      (problem.startsWith("缺") ||
        problem.includes("未配置") ||
        problem.includes("缺 ") ||
        problem.includes("缺已确认") ||
        problem.includes("不匹配") ||
        problem.startsWith("能力不足")),
  );
}

function routeSupportsCapability(route: RoleModelRoute, capability: ModelCapability): boolean {
  if (capability === "text") {
    return Boolean(route.primaryModel);
  }
  if (capability === "vision") {
    return /vision|vl|gpt-4o|claude|qwen|glm|kimi/i.test(route.primaryModel);
  }
  if (capability === "image") {
    return /image|dall|gpt-image|flux|sd|comfy/i.test(route.primaryModel);
  }
  if (capability === "tools") {
    return route.allowTools;
  }
  if (capability === "thinking") {
    return /pro|reason|thinking|claude|gpt/i.test(route.primaryModel);
  }
  if (capability === "promptCache") {
    return /claude|gpt|deepseek/i.test(route.primaryModel);
  }
  return false;
}

function inferProviderForRouteModel(model: string, context: TuiContext): string {
  for (const [providerId, provider] of Object.entries(context.config.providers)) {
    if (provider.model === model) {
      return providerId;
    }
  }
  return model.startsWith("deepseek-") ? "deepseek" : "openai-compatible";
}

function getRuntimeStatusProvider(context: TuiContext): string {
  const runtime = getSelectedModelRuntime(context);
  return runtime.provider;
}

function resolveInitialModel(config: LinghunConfig): string {
  const executor = config.modelRoutes.routes.find((route) => route.role === "executor");
  if (executor && !isDefaultExecutorRoute(executor, config) && executor.primaryModel) {
    return executor.primaryModel;
  }
  return config.defaultModel || executor?.primaryModel || config.providers.deepseek.model;
}

function isDefaultExecutorRoute(route: RoleModelRoute, _config: LinghunConfig): boolean {
  return (
    route.provider === "deepseek" && route.primaryModel === defaultConfig.providers.deepseek.model
  );
}

type SelectedModelRuntime = {
  role: ModelRole;
  provider: string;
  model: string;
  endpointProfile: "chat_completions" | "responses";
  reasoningLevel?: string;
  reasoningStatus: string;
  reasoningSent: boolean;
};

function getSelectedModelRuntime(
  context: TuiContext,
  role: ModelRole = "executor",
): SelectedModelRuntime {
  const route = getRoleRoute(context, role);
  const useContextModel =
    role === "executor" &&
    isDefaultExecutorRoute(route, context.config) &&
    context.model &&
    context.model !== route.primaryModel;
  const model = useContextModel ? context.model : route.primaryModel || context.model;
  const provider = useContextModel
    ? resolveProviderForModel(context.config, model)
    : route.provider || resolveProviderForModel(context.config, model);
  const providerConfig = context.config.providers[provider];
  const endpointProfile = providerConfig?.endpointProfile ?? "chat_completions";
  const compatibilityProfile =
    providerConfig?.compatibilityProfile ??
    (providerConfig?.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
  const reasoningLevel = providerConfig?.reasoningLevel;
  const reasoningSent = Boolean(
    reasoningLevel &&
      (endpointProfile === "responses" || compatibilityProfile === "permissive_openai_compatible"),
  );
  return {
    role,
    provider,
    model,
    endpointProfile,
    reasoningLevel,
    reasoningStatus: formatReasoningEffectiveState(reasoningLevel, reasoningSent),
    reasoningSent,
  };
}

function formatReasoningEffectiveState(
  reasoningLevel: string | undefined,
  reasoningSent: boolean,
): string {
  if (!reasoningLevel) {
    return "未生效";
  }
  return reasoningSent ? `effective/sent ${reasoningLevel}` : "ignored/unsupported/未生效";
}

function resolveProviderForModel(config: LinghunConfig, model: string): string {
  const executor = config.modelRoutes.routes.find((route) => route.role === "executor");
  if (executor?.primaryModel === model && executor.provider) {
    return executor.provider;
  }
  if (config.defaultModel === model) {
    for (const [providerId, provider] of Object.entries(config.providers)) {
      if (provider.model === model) return providerId;
    }
  }
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (provider.model === model) {
      return providerId;
    }
  }
  return model.startsWith("deepseek-") ? "deepseek" : "unknown";
}

function createModelGateway(config: LinghunConfig): ModelGateway {
  return new ModelGateway(
    Object.entries(config.providers).map(([id, provider]) => {
      if (provider.type === "deepseek") {
        return new DeepSeekProvider({ ...provider, id, displayName: "DeepSeek" });
      }
      return new OpenAiCompatibleProvider({ ...provider, id, displayName: "OpenAI compatible" });
    }),
  );
}

function resolveRoleRoute(
  context: TuiContext,
  role: ModelRole,
  triggerReason: string,
): ResolvedRoleRoute {
  const baseRoute = getRoleRoute(context, role);
  const primaryProblems = diagnoseConcreteRoute(
    baseRoute,
    baseRoute.primaryModel,
    baseRoute.provider,
    context,
  );
  const primaryBlocking = getRouteBlockingProblems(primaryProblems);
  let selectedProvider = baseRoute.provider;
  let selectedModel = baseRoute.primaryModel;
  let stopConditions = primaryBlocking;
  let fallbackUsed = false;

  if (primaryBlocking.length > 0) {
    for (const fallbackModel of baseRoute.fallbackModels) {
      const fallbackProvider = inferProviderForRouteModel(fallbackModel, context);
      const fallbackProblems = diagnoseConcreteRoute(
        baseRoute,
        fallbackModel,
        fallbackProvider,
        context,
      );
      const fallbackBlocking = getRouteBlockingProblems(fallbackProblems);
      if (fallbackBlocking.length === 0) {
        selectedProvider = fallbackProvider;
        selectedModel = fallbackModel;
        stopConditions = [];
        fallbackUsed = true;
        break;
      }
    }
  } else {
    stopConditions = [];
  }

  const resolvedRoute = { ...baseRoute, provider: selectedProvider, primaryModel: selectedModel };
  const repairSuggestions = createRouteRepairSuggestions(role, stopConditions, baseRoute);
  const decision: RoleRouteDecision = {
    id: `route-${randomUUID().slice(0, 8)}`,
    triggerReason,
    role,
    selectedProvider: stopConditions.length > 0 ? "" : selectedProvider,
    selectedModel: stopConditions.length > 0 ? "" : selectedModel,
    fallbackCandidates: baseRoute.fallbackModels,
    requiredCapabilities: baseRoute.requiredCapabilities,
    maxCostCny: baseRoute.maxCostCny,
    stopConditions,
    repairSuggestions,
    fallbackUsed,
    budgetStop: false,
    createdAt: new Date().toISOString(),
  };
  context.routeDecisions.unshift(decision);
  context.routeDecisions = context.routeDecisions.slice(0, MAX_ROUTE_DECISIONS);
  return { route: resolvedRoute, decision, usable: stopConditions.length === 0 };
}

function createRouteRepairSuggestions(
  role: ModelRole,
  stopConditions: string[],
  route: RoleModelRoute,
): string[] {
  if (stopConditions.length === 0) {
    return [];
  }
  const suggestions = [`运行 /model route set ${role} <model> 设置可用模型`];
  if (stopConditions.some((item) => item.includes("openai-compatible"))) {
    suggestions.push(
      "在 .linghun/settings.json 配置 openai-compatible 的 baseUrl、apiKey 和 model",
    );
  }
  if (stopConditions.some((item) => item.startsWith("能力不足"))) {
    suggestions.push(`选择满足 ${route.requiredCapabilities.join("+")} capability 的模型`);
  }
  if (route.fallbackModels.length === 0) {
    suggestions.push("为该 role 配置 fallbackModels，避免 primary 不可用时直接暂停");
  }
  return suggestions;
}

function formatRoutePauseMessage(role: ModelRole, decision: RoleRouteDecision): string {
  return `${role} role 路由暂停：${decision.stopConditions.join("；")}。修复建议：${decision.repairSuggestions.join("；")}。不会假装可用。`;
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
    writeStatus(output, context);
    return;
  }
  await setPermissionMode(context, output, nextMode, `mode command -> ${nextMode}`);
}

async function cycleMode(context: TuiContext, output: Writable): Promise<void> {
  const modes: PermissionMode[] = ["default", "auto-review", "plan"];
  const index = modes.indexOf(context.permissionMode);
  const nextMode = modes[(index + 1) % modes.length] ?? "default";
  const guard = getModeChangeGuard(nextMode, context);
  if (guard) {
    writeLine(output, guard);
    writeStatus(output, context);
    return;
  }
  await setPermissionMode(context, output, nextMode, "tab mode cycle");
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
  if (!language) {
    writeLine(output, `language: ${context.language}`);
    return;
  }
  if (language !== "zh-CN" && language !== "en-US") {
    writeLine(output, "usage: /language zh-CN|en-US");
    return;
  }
  context.language = language;
  writeLine(output, t(context, language === "zh-CN" ? "languageSwitchedZh" : "languageSwitchedEn"));
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
    writeLine(output, formatRemoteStatus(context));
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

function formatRemoteStatus(context: TuiContext): string {
  const lines = [
    `Remote Channels：${context.remote.enabled ? "已开启" : "默认关闭"}；仅发送脱敏摘要/审批请求/结果报告。`,
    "- 不发送完整 transcript、源码、日志、index result、evidence、API key/token 或 provider raw request。",
  ];
  for (const channel of context.remote.channels) {
    lines.push(
      `- ${channel.id}: ${channel.runtimeStatus}; binding=${channel.bindingStatus}; transport=${channel.config.transport}/${channel.transportStatus}; lastError=${channel.lastError ?? "none"}; next=${channel.nextAction}`,
    );
  }
  if (context.remote.channels.some((channel) => channel.config.transport === "webhook_mock")) {
    lines.push("- webhook_mock：diagnostic/test-only dry run，不代表真实 remote delivery PASS。");
  }
  lines.push("- 主路径：/remote setup <channel> -> /remote test <channel> -> /remote status");
  return lines.join("\n");
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

function formatRemoteTestResult(channel: RemoteChannelState, event: RemoteEvent): string {
  const ok = event.status === "sent";
  return [
    `Remote test ${ok ? "已发送" : "未发送"}：${channel.id}`,
    `- status: ${event.status}`,
    `- summary: ${event.redactedSummary}`,
    `- next: ${ok ? "/remote status" : channel.nextAction}`,
    "- 本测试只使用脱敏摘要；不代表真实外网回调服务器已接入。",
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

function redactRemoteSummary(value: string): string {
  const bounded = truncateDisplay(value.replace(/\s+/g, " "), 500);
  return bounded
    .replace(
      /(api[_-]?key|token|secret|authorization|provider raw request)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/giu,
      "$1=[REDACTED]",
    )
    .replace(/\bbearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, "sk-[REDACTED]")
    .replace(/transcript\s*[:=]\s*[^\s,;]+/giu, "transcript=[REDACTED]")
    .replace(/(source|log|index result|evidence)\s*[:=]\s*\{[^}]*\}/giu, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s]+/giu, "[REDACTED_ENDPOINT]");
}

function remoteTranscriptSummary(value: string): string {
  return truncateDisplay(redactRemoteSummary(value), 220);
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

type ParsedJobRunOptions = {
  goal: string;
  phase: string;
  target: string;
  plan: string[];
  maxTokens: number;
  maxSteps: number;
  requestedAgents: number;
  timeoutMs: number;
  allowEdit: boolean;
  allowBash: boolean;
  allowMultiAgent: boolean;
};

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

function parseJobRunOptions(args: string[]): ParsedJobRunOptions {
  const goalParts: string[] = [];
  let phase = "Phase 17A";
  let target = "local-durable-jobs";
  let requestedAgents = 1;
  let maxTokens = DEFAULT_JOB_BUDGET_TOKENS;
  let maxSteps = DEFAULT_JOB_MAX_STEPS;
  let timeoutMs = DEFAULT_JOB_TIMEOUT_MS;
  let allowEdit = false;
  let allowBash = false;
  let allowMultiAgent = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (arg === "--phase") {
      phase = args[index + 1] ?? phase;
      index += 1;
      continue;
    }
    if (arg === "--target") {
      target = args[index + 1] ?? target;
      index += 1;
      continue;
    }
    if (arg === "--agents") {
      requestedAgents = clampPositiveInt(args[index + 1], 1, MAX_AGENTS);
      index += 1;
      continue;
    }
    if (arg === "--tokens") {
      maxTokens = clampPositiveInt(args[index + 1], DEFAULT_JOB_BUDGET_TOKENS, 10_000_000);
      index += 1;
      continue;
    }
    if (arg === "--max-steps" || arg === "--steps") {
      maxSteps = clampPositiveInt(args[index + 1], DEFAULT_JOB_MAX_STEPS, MAX_JOB_MAX_STEPS);
      index += 1;
      continue;
    }
    if (arg === "--timeout" || arg === "--max-runtime-ms") {
      timeoutMs = clampPositiveInt(args[index + 1], DEFAULT_JOB_TIMEOUT_MS, 24 * 60 * 60 * 1000);
      index += 1;
      continue;
    }
    if (arg === "--allow-edit") {
      allowEdit = true;
      continue;
    }
    if (arg === "--allow-bash") {
      allowBash = true;
      continue;
    }
    if (arg === "--multi-agent") {
      allowMultiAgent = true;
      continue;
    }
    goalParts.push(arg);
  }
  const goal = goalParts.join(" ").trim();
  const normalizedAgents = allowMultiAgent ? requestedAgents : 1;
  return {
    goal,
    phase,
    target,
    plan: [
      goal || "prepare job",
      "validate handoff",
      "schedule bounded local agents",
      "write report",
    ],
    maxTokens,
    maxSteps,
    requestedAgents: normalizedAgents,
    timeoutMs,
    allowEdit,
    allowBash,
    allowMultiAgent,
  };
}

function clampPositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
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

function createDurableJobAgents(
  options: ParsedJobRunOptions,
  status: DurableJobStatus,
  runningCap: number,
): DurableJobAgent[] {
  const total = Math.max(1, Math.min(options.requestedAgents, MAX_AGENTS));
  return Array.from({ length: total }, (_, index) => {
    const active = status === "running" && index < runningCap;
    const agentStatus: DurableJobAgentStatus =
      status === "running"
        ? active
          ? "running"
          : "sleeping"
        : status === "created"
          ? "created"
          : status;
    return {
      id: `job-agent-${index + 1}`,
      type:
        index === 0 ? "planner" : index === 1 ? "worker" : index === 2 ? "verifier" : "explorer",
      goal: `${options.goal}#${index + 1}`,
      status: agentStatus,
      budgetTokens: Math.floor(options.maxTokens / total),
      heartbeatAt: active ? new Date().toISOString() : undefined,
      summary: active
        ? "scheduled with trimmed handoff/evidence/cache refs only; no full transcript/source/index/log output"
        : "not running; queued/sleeping behind Phase 17A resource cap",
    };
  });
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

function estimateJobTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function getDurableJobMaxSteps(job: DurableJobState): number {
  return Math.max(1, Math.min(job.budget.maxSteps ?? DEFAULT_JOB_MAX_STEPS, MAX_JOB_MAX_STEPS));
}

function countDurableJobAgents(job: DurableJobState): Record<DurableJobAgentStatus, number> {
  return job.agents.reduce(
    (counts, agent) => {
      counts[agent.status] += 1;
      return counts;
    },
    {
      created: 0,
      running: 0,
      queued: 0,
      sleeping: 0,
      blocked: 0,
      stale: 0,
      cancelled: 0,
      timeout: 0,
      completed: 0,
      failed: 0,
    } satisfies Record<DurableJobAgentStatus, number>,
  );
}

function rescheduleDurableJobAgents(job: DurableJobState): void {
  let running = 0;
  for (const agent of job.agents) {
    if (job.status === "running" && running < job.budget.maxRunningAgents) {
      agent.status = "running";
      agent.heartbeatAt = job.updatedAt;
      running += 1;
      continue;
    }
    if (job.status === "running") {
      agent.status = "sleeping";
      continue;
    }
    agent.status =
      job.status === "sleeping" ? "sleeping" : job.status === "blocked" ? "blocked" : job.status;
  }
}

function upsertJobBackgroundTask(context: TuiContext, job: DurableJobState): BackgroundTaskState {
  const existing = context.backgroundTasks.find((task) => task.id === job.id);
  const task = createJobBackgroundTask(job, context);
  if (existing) {
    Object.assign(existing, task);
    return existing;
  }
  rememberBackgroundTask(context, task);
  return task;
}

function createJobBackgroundTask(job: DurableJobState, context: TuiContext): BackgroundTaskState {
  const runningAgents = job.agents.filter((agent) => agent.status === "running").length;
  const runnerInline = formatJobRunnerInline(job);
  return {
    id: job.id,
    kind: "job",
    title: `Job: ${truncateDisplay(job.goal, 40)}`,
    status: mapDurableJobToBackgroundStatus(job.status),
    currentStep:
      job.pauseReason ??
      `worker step ${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}; agents ${runningAgents}/${job.agents.length}; ${runnerInline}`,
    progress: {
      completed: job.budget.usedSteps ?? 0,
      total: getDurableJobMaxSteps(job),
      label: "worker steps",
    },
    startedAt: job.startedAt ?? job.createdAt,
    updatedAt: job.updatedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: job.timeoutMs,
    logPath: job.logPath,
    outputPath: job.fullOutputPath,
    hasOutput: true,
    result: mapDurableJobToBackgroundResult(job.status),
    userVisibleSummary:
      job.status === "running"
        ? `Job running with ${runningAgents}/${job.agents.length} agents under cap ${job.budget.maxRunningAgents}; ${runnerInline}; raw output stays in logs.`
        : `Job ${job.status}; ${runnerInline}; ${job.pauseReason ?? "no PASS evidence generated"}.`,
    nextAction: formatJobNextAction(job, context.language),
  };
}

function mapDurableJobToBackgroundStatus(status: DurableJobStatus): BackgroundTaskStatus {
  if (status === "created" || status === "sleeping" || status === "blocked") {
    return "paused";
  }
  return status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "stale" ||
    status === "timeout"
    ? status
    : "running";
}

function mapDurableJobToBackgroundResult(
  status: DurableJobStatus,
): BackgroundTaskState["result"] | undefined {
  if (status === "completed") return "partial";
  if (status === "failed") return "fail";
  if (status === "cancelled") return "cancelled";
  if (status === "stale") return "stale";
  if (status === "timeout") return "timeout";
  if (status === "blocked" || status === "sleeping") return "partial";
  return undefined;
}

function formatJobNextAction(job: DurableJobState, language: Language): string {
  if (job.status === "running") {
    return language === "en-US"
      ? `Use /job pause ${job.id}, /job cancel ${job.id}, /job report ${job.id}, or /job logs ${job.id}.`
      : `可用 /job pause ${job.id}、/job cancel ${job.id}、/job report ${job.id} 或 /job logs ${job.id}。`;
  }
  if (job.status === "blocked") {
    return language === "en-US"
      ? "Repair the handoff packet or evidence/index state, then /job resume."
      : "先修复 handoff/evidence/index 状态，再用 /job resume。";
  }
  return language === "en-US"
    ? `Inspect /job report ${job.id}; completed/cancelled/timeout/stale/blocked never count as verification PASS.`
    : `查看 /job report ${job.id}；completed/cancelled/timeout/stale/blocked 不等于 verification PASS。`;
}

async function persistDurableJob(job: DurableJobState): Promise<void> {
  await mkdir(dirname(job.logPath), { recursive: true });
  await writeFile(getDurableJobStatePath(job), `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

async function appendJobLog(job: DurableJobState, message: string): Promise<void> {
  await mkdir(dirname(job.logPath), { recursive: true });
  await appendFile(job.logPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  await appendFile(job.fullOutputPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

async function writeDurableJobReport(job: DurableJobState): Promise<void> {
  const lines = [
    `# Job Report ${job.id}`,
    "",
    `- status: ${job.status}`,
    `- goal: ${job.goal}`,
    `- projectPath: ${job.projectPath}`,
    `- phase/target: ${job.phase} / ${job.target}`,
    `- permission: ${job.permissionPolicy}; allowEdit=${job.allowEdit}; allowBash=${job.allowBash}; allowMultiAgent=${job.allowMultiAgent}`,
    `- budget: maxTokens=${job.budget.maxTokens}; usedTokens=${job.budget.usedTokens ?? 0}; remainingTokens=${job.budget.remainingTokens ?? job.budget.maxTokens}; maxSteps=${getDurableJobMaxSteps(job)}; usedSteps=${job.budget.usedSteps ?? 0}; runningAgentCap=${job.budget.maxRunningAgents}; timeoutMs=${job.timeoutMs}; maxRuntimeMs=${job.budget.maxRuntimeMs ?? job.timeoutMs}`,
    `- budget note: ${job.budget.note}`,
    `- pauseReason: ${job.pauseReason ?? "-"}`,
    `- owner: session=${job.ownerSessionId ?? "-"}; pid=${job.ownerPid ?? "-"}; heartbeatAt=${job.heartbeatAt ?? "-"}`,
    `- worker: ${job.worker?.status ?? "not_started"}; session=${job.worker?.sessionId ?? "-"}; ${job.worker?.summary ?? "-"}`,
    `- verification: ${job.verification?.status ?? "not_run"}; ${job.verification?.summary ?? "-"}`,
    formatJobRunnerReportLine(job),
    formatApprovedRunnerSpecLine(job),
    `- handoff: ${job.handoffPacket?.id ?? "missing"}`,
    `- evidenceRefs: ${job.evidenceRefs.map((item) => item.id).join(", ") || "none"}`,
    `- logs: ${job.logPath}`,
    `- fullOutput: ${job.fullOutputPath}`,
    "",
    "## Task graph",
    ...job.plan.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Agent assignment",
    ...job.agents.map(
      (agent) =>
        `- ${agent.id}: ${agent.type} status=${agent.status} budgetTokens=${agent.budgetTokens} goal=${agent.goal}`,
    ),
    "",
    "## Worker result",
    `- status: ${job.result?.status ?? "not_run"}`,
    `- summary: ${job.result?.summary ?? "Worker loop has not produced a result yet."}`,
    `- lifecycle: ${job.status === "completed" ? "completed means the bounded worker loop ended; verification remains partial and is not PASS/smoke-ready" : job.status}`,
    `- facts: ${job.result?.facts.join(" | ") ?? "none"}`,
    `- evidenceRefs: ${job.result?.evidenceRefs.join(", ") ?? "none"}`,
    "",
    "## Budget enforcement",
    `- usedTokens: ${job.budget.usedTokens ?? 0}`,
    `- remainingTokens: ${job.budget.remainingTokens ?? job.budget.maxTokens}`,
    `- maxRuntimeMs: ${job.budget.maxRuntimeMs ?? job.timeoutMs}`,
    "- conservative: overbudget/timeout/stale/blocked states do not generate PASS evidence.",
    "",
    "## Adopted conclusions",
    ...(job.adoptedConclusions.length > 0 ? job.adoptedConclusions : ["- none"]),
    "",
    "## Rejected conclusions",
    ...(job.rejectedConclusions.length > 0
      ? job.rejectedConclusions.map((item) => `- ${item}`)
      : ["- No blocked/cancelled/timeout/stale state is treated as PASS evidence."]),
    "",
    "## Boundaries",
    "- Node/TUI runtime remains default and explicit fallback; Phase 17C only adds a gated native runner resolver/adapter for approved durable job specs.",
    "- Native runner lifecycle completion is not verification PASS; failed/timeout/cancelled/stale/crash/protocol mismatch paths do not create PASS evidence.",
    "- DEFERRED: managed/bundled binary distribution, signing/AV/install matrix, real daemon supervision, and Unix/macOS process-group cleanup.",
    "- Remote channels / Phase 17B, Fast Workspace Scanner, and Phase 18 desktop are NOT entered.",
    "- Agent context is trimmed to handoff/evidence/cache/index refs; no full transcript/source/index/log output is injected.",
  ];
  await mkdir(dirname(job.reportPath), { recursive: true });
  await writeFile(job.reportPath, `${lines.join("\n")}\n`, "utf8");
}

async function listDurableJobs(context: TuiContext): Promise<DurableJobState[]> {
  const root = getDurableJobsRoot(context);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const jobs: DurableJobState[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const job = await readDurableJobState(join(root, entry.name, "state.json"));
    if (job) jobs.push(job);
  }
  return jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function findDurableJob(
  context: TuiContext,
  id: string | undefined,
): Promise<DurableJobState | undefined> {
  const jobs = await listDurableJobs(context);
  if (!id) return jobs[0];
  return jobs.find((job) => job.id === id || job.id.endsWith(id));
}

async function readDurableJobState(path: string): Promise<DurableJobState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isDurableJobState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isDurableJobState(value: unknown): value is DurableJobState {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.goal === "string" &&
    typeof value.projectPath === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.plan) &&
    Array.isArray(value.agents) &&
    typeof value.logPath === "string" &&
    typeof value.reportPath === "string" &&
    typeof value.fullOutputPath === "string"
  );
}

function getDurableJobsRoot(context: TuiContext): string {
  return resolveStoragePaths(context.config, context.projectPath).jobs;
}

function getDurableJobPaths(
  context: TuiContext,
  id: string,
): Pick<DurableJobState, "logPath" | "reportPath" | "fullOutputPath"> {
  const dir = join(getDurableJobsRoot(context), id);
  return {
    logPath: join(dir, "job.log"),
    reportPath: join(dir, "report.md"),
    fullOutputPath: join(dir, "full-output.log"),
  };
}

function getDurableJobStatePath(job: DurableJobState): string {
  return join(dirname(job.logPath), "state.json");
}

function formatJobList(jobs: DurableJobState[], context: TuiContext): string {
  if (jobs.length === 0) {
    return "当前没有 durable job。用法：/job run <goal>。";
  }
  return [
    "Durable jobs:",
    ...jobs.map((job) => {
      const counts = countDurableJobAgents(job);
      return `${job.id}  ${job.status}  created=${job.agents.length} running=${counts.running} sleeping=${counts.sleeping} blocked=${counts.blocked} stale=${counts.stale}  worker=${job.worker?.status ?? "not_started"} ${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}  pause=${job.pauseReason ?? "-"}  budget=${job.budget.usedTokens ?? 0}/${job.budget.maxTokens}  goal=${truncateDisplay(job.goal, 60)}  next=/job status ${job.id} | /job report ${job.id} | /job logs ${job.id}`;
    }),
    context.language === "en-US"
      ? `Default running agent cap is ${DEFAULT_JOB_RUNNING_AGENT_CAP}; ${JOB_AGENT_HIGH_CONFIG_CANDIDATE} is benchmark/high-config candidate only. Full paths are shown only in /job status, /job report, and /job logs.`
      : `默认真实运行 agent 上限为 ${DEFAULT_JOB_RUNNING_AGENT_CAP}；${JOB_AGENT_HIGH_CONFIG_CANDIDATE} 只是 benchmark/high-config 候选。完整路径只在 /job status、/job report 和 /job logs 中显示。`,
  ].join("\n");
}

function formatJobPrimary(job: DurableJobState, context: TuiContext): string {
  const runningAgents = job.agents.filter((agent) => agent.status === "running").length;
  return [
    `[job] ${job.id} · ${job.status} · ${truncateDisplay(job.goal, 80)}`,
    "- impact: local durable metadata + unified background task; no remote channel, no Phase 18, no Beta/smoke-ready PASS.",
    `- agents: created=${job.agents.length}, running=${runningAgents}, cap=${job.budget.maxRunningAgents}; 8-agent mode is deferred benchmark candidate.`,
    `- runner: ${formatJobRunnerInline(job)}`,
    `- verification: ${job.verification?.status ?? "not_run"}; completed/cancelled/timeout/stale/blocked never equals verification PASS.`,
    `- next: ${formatJobNextAction(job, context.language)}`,
    `- details: /job report ${job.id}; logs: /job logs ${job.id}; background: /background`,
  ].join("\n");
}

function formatJobStatus(job: DurableJobState): string {
  const counts = countDurableJobAgents(job);
  return [
    `Job ${job.id}`,
    `- status: ${job.status}`,
    `- pauseReason: ${job.pauseReason ?? "-"}`,
    `- goal: ${job.goal}`,
    `- projectPath: ${job.projectPath}`,
    `- phase/target: ${job.phase} / ${job.target}`,
    `- agents: created=${job.agents.length}; running=${counts.running}; sleeping=${counts.sleeping}; queued=${counts.queued}; blocked=${counts.blocked}; stale=${counts.stale}; cap=${job.budget.maxRunningAgents}`,
    `- budget: maxTokens=${job.budget.maxTokens}; usedTokens=${job.budget.usedTokens ?? 0}; remainingTokens=${job.budget.remainingTokens ?? job.budget.maxTokens}; maxSteps=${getDurableJobMaxSteps(job)}; usedSteps=${job.budget.usedSteps ?? 0}; timeoutMs=${job.timeoutMs}; maxRuntimeMs=${job.budget.maxRuntimeMs ?? job.timeoutMs}`,
    `- worker: ${job.worker?.status ?? "not_started"}; step=${job.worker?.completedSteps ?? job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}; session=${job.worker?.sessionId ?? "-"}; ${job.worker?.summary ?? "-"}`,
    `- runner: ${formatJobRunnerInline(job)}`,
    `- permission: ${job.permissionPolicy}; allowEdit=${job.allowEdit}; allowBash=${job.allowBash}; allowMultiAgent=${job.allowMultiAgent}`,
    `- logPath: ${job.logPath}`,
    `- fullOutputPath: ${job.fullOutputPath}`,
    `- reportPath: ${job.reportPath}`,
  ].join("\n");
}

function formatJobReport(job: DurableJobState): string {
  const counts = countDurableJobAgents(job);
  return [
    `Job report ${job.id}`,
    `- status: ${job.status}`,
    `- task graph: ${job.plan.length} steps; worker=${job.worker?.status ?? "not_started"}; usedSteps=${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}`,
    `- agent assignment: ${job.agents.map((agent) => `${agent.id}:${agent.type}:${agent.status}`).join(", ")}`,
    `- agent counts: created=${job.agents.length}; running=${counts.running}; sleeping=${counts.sleeping}; queued=${counts.queued}; blocked=${counts.blocked}; stale=${counts.stale}; cap=${job.budget.maxRunningAgents}`,
    `- budget: maxTokens=${job.budget.maxTokens}; usedTokens=${job.budget.usedTokens ?? 0}; remainingTokens=${job.budget.remainingTokens ?? job.budget.maxTokens}; maxSteps=${getDurableJobMaxSteps(job)}; timeoutMs=${job.timeoutMs}; maxRuntimeMs=${job.budget.maxRuntimeMs ?? job.timeoutMs}`,
    `- verification: ${job.verification?.status ?? "not_run"}; ${job.verification?.summary ?? "-"}`,
    `- runner: ${formatJobRunnerInline(job)}`,
    `- adopted: ${job.adoptedConclusions.join("; ") || "none"}`,
    `- rejected: ${job.rejectedConclusions.join("; ") || "blocked/cancelled/timeout/stale are never PASS"}`,
    `- pauseReason: ${job.pauseReason ?? "-"}`,
    `- logPath: ${job.logPath}`,
    `- fullOutputPath: ${job.fullOutputPath}`,
    `- reportPath: ${job.reportPath}`,
  ].join("\n");
}

async function formatJobLogs(job: DurableJobState): Promise<string> {
  const content = await readFile(job.logPath, "utf8").catch(() => "");
  const tail = content.split(/\r?\n/u).filter(Boolean).slice(-JOB_LOG_TAIL_LINES);
  return [
    `Job logs ${job.id}`,
    `- path: ${job.logPath}`,
    `- fullOutputPath: ${job.fullOutputPath}`,
    `- tailLines: ${tail.length}/${JOB_LOG_TAIL_LINES}`,
    tail.length > 0 ? tail.join("\n") : "日志为空；job 可能尚未写入输出。",
  ].join("\n");
}

async function handleDetailsCommand(
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

  const lines = [
    "Linghun details",
    `- evidence: ${context.evidence.length}/${MAX_EVIDENCE_RECORDS}`,
    `- background: ${context.backgroundTasks.length}/${MAX_BACKGROUND_TASKS}`,
    `- agents: ${context.agents.length}/${MAX_AGENTS}`,
    `- checkpoints: ${context.checkpoints.length}/${MAX_CHECKPOINTS}`,
    "- full output: /details evidence <id> | /details background <id> | /details output <id>",
  ];
  if (context.evidence.length > 0) {
    lines.push("- recent evidence:");
    for (const evidence of context.evidence.slice(0, 5)) {
      lines.push(`  - ${evidence.id} ${evidence.kind} ${evidence.source}: ${evidence.summary}`);
    }
  }
  if (context.backgroundTasks.length > 0) {
    lines.push("- recent background:");
    for (const task of context.backgroundTasks.slice(0, 5)) {
      lines.push(`  - ${task.id} ${task.kind} ${task.status}: ${task.userVisibleSummary}`);
    }
  }
  writeLine(output, lines.join("\n"));
}

function findEvidence(context: TuiContext, id: string | undefined): EvidenceRecord | undefined {
  if (!id) {
    return context.evidence[0];
  }
  return context.evidence.find((evidence) => evidence.id === id || evidence.id.endsWith(id));
}

function findBackgroundTask(
  context: TuiContext,
  id: string | undefined,
): BackgroundTaskState | undefined {
  if (!id) {
    return context.backgroundTasks[0];
  }
  return context.backgroundTasks.find((task) => task.id === id || task.id.endsWith(id));
}

function isActiveBackgroundStatus(status: BackgroundTaskStatus): boolean {
  return status === "running" || status === "stale";
}

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

function rememberBackgroundTask(context: TuiContext, task: BackgroundTaskState): void {
  context.backgroundTasks.unshift(task);
  context.backgroundTasks = context.backgroundTasks.slice(0, MAX_BACKGROUND_TASKS);
}

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

function formatEvidenceDetails(evidence: EvidenceRecord): string {
  return [
    `Evidence ${evidence.id}`,
    `- kind: ${evidence.kind}`,
    `- source: ${evidence.source}`,
    `- summary: ${evidence.summary}`,
    `- supportsClaims: ${evidence.supportsClaims.join(", ") || "none"}`,
    `- createdAt: ${evidence.createdAt}`,
  ].join("\n");
}

function formatBackgroundDetails(task: BackgroundTaskState, language: Language): string {
  const progress = task.progress
    ? `${task.progress.completed}/${task.progress.total ?? "?"} ${task.progress.label ?? ""}`.trim()
    : "none";
  return [
    language === "en-US" ? `Background ${task.id}` : `Background ${task.id}`,
    `- kind: ${task.kind}`,
    `- title: ${task.title}`,
    `- status: ${task.status}`,
    `- currentStep: ${task.currentStep ?? "-"}`,
    `- progress: ${progress}`,
    `- logPath: ${task.logPath ?? "-"}`,
    `- outputPath: ${task.outputPath ?? "-"}`,
    `- hasOutput: ${task.hasOutput}`,
    `- result: ${task.result ?? "-"}`,
    `- summary: ${task.userVisibleSummary}`,
    `- nextAction: ${task.nextAction ?? "-"}`,
    `- startedAt: ${task.startedAt}`,
    `- updatedAt: ${task.updatedAt}`,
  ].join("\n");
}

function formatBackgroundOutputDetails(task: BackgroundTaskState, language: Language): string {
  const location = task.outputPath ?? task.logPath;
  if (!location) {
    return language === "en-US"
      ? `Background ${task.id} has no output path yet.`
      : `Background ${task.id} 尚无输出路径。`;
  }
  return [
    `Background output ${task.id}`,
    `- path: ${location}`,
    `- hasOutput: ${task.hasOutput}`,
    `- status: ${task.status}`,
    `- summary: ${task.userVisibleSummary}`,
    `- slices: /details output ${task.id} --tail 40 | --grep <pattern> --context 2 | --errors`,
  ].join("\n");
}

function parseLogArtifactRequest(args: string[]): LogArtifactRequest | undefined {
  const tailIndex = args.indexOf("--tail");
  if (tailIndex >= 0) {
    return {
      mode: "tail",
      lines: readPositiveIntegerArg(args[tailIndex + 1]),
    };
  }
  const grepIndex = args.indexOf("--grep");
  if (grepIndex >= 0) {
    const contextIndex = args.indexOf("--context");
    return {
      mode: "grep",
      pattern: args[grepIndex + 1],
      contextLines: contextIndex >= 0 ? readPositiveIntegerArg(args[contextIndex + 1]) : undefined,
    };
  }
  if (args.includes("--errors")) {
    return { mode: "errors" };
  }
  return undefined;
}

function readPositiveIntegerArg(value: string | undefined): number | undefined {
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function createLogArtifactRegistry(context: TuiContext) {
  return {
    workspaceRoot: context.projectPath,
    logRoots: [join(context.projectPath, ".linghun", "logs")],
    backgrounds: context.backgroundTasks.map((task) => ({
      id: task.id,
      outputPath: task.outputPath,
      logPath: task.logPath,
    })),
    evidence: context.evidence.map((evidence) => ({
      id: evidence.id,
      source: evidence.source,
      fullOutputPath: evidence.fullOutputPath,
      outputPath: evidence.outputPath,
      logPath: evidence.logPath,
    })),
  };
}

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

function isAgentType(value: string): value is AgentType {
  return value === "explorer" || value === "worker" || value === "verifier" || value === "planner";
}

function getAgentRole(type: AgentType): ModelRole {
  if (type === "planner") {
    return "planner";
  }
  if (type === "verifier") {
    return "verifier";
  }
  return "executor";
}

function getAgentPermissionMode(type: AgentType, parentMode: PermissionMode): PermissionMode {
  if (type === "explorer" || type === "planner") {
    return "plan";
  }
  if (type === "verifier") {
    return "default";
  }
  return parentMode;
}

function createEmptyAgentCost(task: string): AgentRun["cost"] {
  const inputTokens = Math.ceil(task.length / 4);
  return { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 };
}

function createAgentContextSummary(
  packet: HandoffPacket,
  task: string,
  context: TuiContext,
): string {
  const evidence = packet.evidenceRefs.map((item) => `${item.kind}:${item.source}`).slice(0, 5);
  const files = packet.keyFiles.slice(0, 8);
  return [
    "Agent context package (trimmed)",
    `handoff=${packet.id}`,
    `task=${truncateDisplay(task, 200)}`,
    `todos=${packet.todos.length}`,
    `evidence=${evidence.length > 0 ? evidence.join("; ") : "none"}`,
    `keyFiles=${files.length > 0 ? files.join(", ") : "none"}`,
    `permission=${context.permissionMode}`,
    "notIncluded=full transcript/full memory/full index/large logs",
  ].join(" | ");
}

function createAgentBackgroundTask(agent: AgentRun, context: TuiContext): BackgroundTaskState {
  return {
    id: agent.id,
    kind: "agent",
    title: `Agent ${agent.type}: ${truncateDisplay(agent.task, 40)}`,
    status: "running",
    currentStep: context.language === "en-US" ? "running agent" : "正在运行 agent",
    progress: { completed: 0, total: 1, label: agent.type },
    startedAt: agent.startedAt,
    updatedAt: agent.updatedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    outputPath: agent.transcriptPath,
    hasOutput: true,
    userVisibleSummary:
      context.language === "en-US"
        ? `Started ${agent.type} agent. Use /agents show ${agent.id}.`
        : `已启动 ${agent.type} agent。可用 /agents show ${agent.id} 查看。`,
    nextAction:
      context.language === "en-US"
        ? `Use /agents cancel ${agent.id} to interrupt.`
        : `可用 /agents cancel ${agent.id} 中断。`,
  };
}

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
    { ...getRoleRoute(context, agent.role), provider: agent.provider, primaryModel: agent.model },
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

function mapAgentBackgroundResult(
  agent: AgentRun,
  verifierStatus?: string,
): BackgroundTaskState["result"] {
  if (agent.type !== "verifier") {
    return "partial";
  }
  return verifierStatus === "pass" ? "partial" : verifierStatus === "fail" ? "fail" : "partial";
}

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

function findAgent(context: TuiContext, id: string | undefined): AgentRun | undefined {
  if (!id) {
    return context.agents[0];
  }
  return context.agents.find((agent) => agent.id === id || agent.id.endsWith(id));
}

function formatAgentsList(context: TuiContext): string {
  if (context.agents.length === 0) {
    return "当前没有 agent。用法：/fork explorer|planner|verifier|worker <task>";
  }
  const lines = ["Agents:"];
  for (const agent of context.agents) {
    lines.push(
      `${agent.id}  ${agent.type}  role=${agent.role}  ${agent.status}  provider=${agent.provider}  model=${agent.model}  mode=${agent.permissionMode}  estimated tokens=${agent.cost.inputTokens + agent.cost.outputTokens}  task=${truncateDisplay(agent.task, 60)}`,
    );
  }
  return lines.join("\n");
}

function formatAgentDetails(agent: AgentRun, context: TuiContext): string {
  const lines = [
    `Agent ${agent.id}`,
    `- type: ${agent.type}`,
    `- role: ${agent.role}`,
    `- provider: ${agent.provider}`,
    `- status: ${agent.status}`,
    `- parentSessionId: ${agent.parentSessionId ?? "none"}`,
    `- transcript: ${agent.transcriptPath}`,
    `- permissionMode: ${agent.permissionMode}`,
    `- cost: input=${agent.cost.inputTokens}, output=${agent.cost.outputTokens}, cacheRead=${agent.cost.cacheReadTokens}, cacheWrite=${agent.cost.cacheWriteTokens}, estimatedCny=${agent.cost.estimatedCny}`,
    `- context: ${agent.contextSummary}`,
    `- summary: ${agent.summary}`,
  ];
  if (agent.status === "running") {
    lines.push(
      context.language === "en-US"
        ? `- cancel: /agents cancel ${agent.id}`
        : `- 中断：/agents cancel ${agent.id}`,
    );
  }
  return lines.join("\n");
}

function formatAgentSummary(agent: AgentRun, context: TuiContext): string {
  return context.language === "en-US"
    ? `[agent] ${agent.id} · ${agent.type} · ${agent.status} · ${agent.summary}`
    : `[agent] ${agent.id} · ${agent.type} · ${agent.status} · ${agent.summary}`;
}

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

function getBackgroundAbortControllers(context: TuiContext): Map<string, AbortController> {
  if (!context.backgroundAbortControllers) {
    context.backgroundAbortControllers = new Map();
  }
  return context.backgroundAbortControllers;
}

function registerBackgroundAbortController(context: TuiContext, taskId: string): AbortController {
  const controller = new AbortController();
  getBackgroundAbortControllers(context).set(taskId, controller);
  return controller;
}

function clearBackgroundAbortController(context: TuiContext, taskId: string): void {
  context.backgroundAbortControllers?.delete(taskId);
}

function abortBackgroundTask(context: TuiContext, taskId: string): boolean {
  const controller = context.backgroundAbortControllers?.get(taskId);
  if (!controller) {
    return false;
  }
  controller.abort();
  clearBackgroundAbortController(context, taskId);
  return true;
}

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
  if (args[0] !== "status") {
    writeLine(output, "用法：/break-cache status");
    return;
  }
  writeLine(output, formatBreakCacheStatus(context));
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
    writeLine(output, formatMcpTools(context));
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
    const result = await runControlledMemoryLearning(context);
    writeLine(output, formatMemoryLearningRun(result));
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
  if (action === "delete") {
    const id = args[1];
    const memory = findMemoryRecord(context.memory, id);
    if (!memory) {
      writeLine(output, "未找到该记忆。用法：/memory delete <id>");
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
    "用法：/memory | /memory storage | /memory review | /memory stats | /memory candidate <摘要> [--scope project|user|session] | /memory accept|reject|disable|rollback|delete <id> | /memory init | /memory import sessions [source] [query]",
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

function formatProjectRulesContext(context: TuiContext): string {
  if (context.memory.projectRulesError) {
    return "unreadable; 可检查文件权限或运行 /memory storage 定位路径";
  }
  if (!context.memory.projectRulesExists) {
    return "missing; 可运行 /memory init 生成基础模板，不会自动生成";
  }
  return truncateDisplay(context.memory.projectRulesSummary, PROJECT_RULES_STATUS_WIDTH);
}

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

function createMemoryCandidate(
  scope: MemoryScope,
  summary: string,
  source: string,
  sourceRefs: string[],
): MemoryCandidate {
  return {
    id: randomUUID(),
    scope,
    status: "candidate",
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 240),
    source,
    sourceRefs: sourceRefs.slice(0, 6),
    risk: "low",
    inferred: false,
    createdAt: new Date().toISOString(),
  };
}

function parseMemoryCandidateArgs(args: string[]): { scope: MemoryScope; summary: string } {
  const scopeIndex = args.findIndex((arg) => arg === "--scope");
  const rawScope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
  const scope: MemoryScope =
    rawScope === "user" || rawScope === "session" || rawScope === "project" ? rawScope : "project";
  const summary = args
    .filter((_, index) => scopeIndex < 0 || (index !== scopeIndex && index !== scopeIndex + 1))
    .join(" ")
    .trim();
  return { scope, summary };
}

async function writeMemoryRecord(candidate: MemoryCandidate, context: TuiContext): Promise<void> {
  if (candidate.scope === "session") {
    return;
  }
  const directory = getMemoryDirectory(candidate.scope, context);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${candidate.id}.json`);
  await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
}

async function removeMemoryRecord(candidate: MemoryCandidate, context: TuiContext): Promise<void> {
  if (candidate.scope === "session") {
    return;
  }
  await rm(join(getMemoryDirectory(candidate.scope, context), `${candidate.id}.json`), {
    force: true,
  });
}

function getMemoryDirectory(scope: MemoryScope, context: TuiContext): string {
  if (scope === "project") return context.memory.projectDir;
  if (scope === "user") return context.memory.userDir;
  return context.memory.sessionDir;
}

function findMemoryRecord(
  memory: MemoryState,
  id: string | undefined,
): MemoryCandidate | undefined {
  if (!id) return undefined;
  return [
    ...memory.candidates,
    ...memory.accepted,
    ...memory.rejected,
    ...memory.disabled,
    ...memory.retired,
  ].find((item) => item.id === id);
}

function removeMemoryFromState(memory: MemoryState, id: string): void {
  memory.candidates = memory.candidates.filter((item) => item.id !== id);
  memory.accepted = memory.accepted.filter((item) => item.id !== id);
  memory.rejected = memory.rejected.filter((item) => item.id !== id);
  memory.disabled = memory.disabled.filter((item) => item.id !== id);
  memory.retired = memory.retired.filter((item) => item.id !== id);
}

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

function formatMemoryScope(scope: MemoryScope): string {
  if (scope === "project") return "项目";
  if (scope === "user") return "用户";
  return "会话";
}

function formatMemoryStatus(context: TuiContext): string {
  const injected = createControlledMemoryInjection(context);
  return [
    "Memory status",
    `- LINGHUN.md: ${context.memory.projectRulesExists ? "found" : "missing"}`,
    `- projectRulesSummary: ${formatProjectRulesContext(context)}`,
    `- candidates: ${context.memory.candidates.length}`,
    `- accepted: ${context.memory.accepted.length}`,
    `- disabled: ${context.memory.disabled.length}`,
    `- rejected: ${context.memory.rejected.length}`,
    "- autoAccept: no",
    `- promptInjection: acceptedOnly topK=${MEMORY_PROMPT_TOP_K} injected=${injected.items.length} estimatedTokens=${estimateMemoryTokens(injected.text)}`,
    ...context.memory.accepted
      .slice(0, 5)
      .map((item) => `  - ${item.id} [${item.scope}] ${item.summary}`),
    `- lastHandoff: ${context.memory.lastHandoff ? context.memory.lastHandoff.createdAt : "none"}`,
    context.memory.projectRulesError
      ? "- hint: LINGHUN.md 读取失败；可运行 /memory storage 定位路径，不会自动生成或打断输入。"
      : context.memory.projectRulesExists
        ? "- note: LINGHUN.md 只用于长期稳定工程规则；这里只显示截断摘要。"
        : "- hint: 缺少 LINGHUN.md。可运行 /memory init 生成基础模板；不会打断输入。",
  ].join("\n");
}

function formatMemoryStorage(context: TuiContext): string {
  const paths = resolveStoragePaths(context.config, context.projectPath);
  return [
    "Memory storage",
    `- project rules: ${context.memory.projectRulesPath}`,
    `- project memory: ${paths.memoryProject}`,
    `- user memory: ${paths.memoryUser}`,
    `- session memory/handoff: ${paths.memorySession}`,
    `- sessions: ${paths.sessions}`,
    `- logs: ${paths.logs}`,
    `- jobs: ${paths.jobs}`,
    `- cache: ${paths.cache}`,
    `- index metadata: ${paths.index}`,
    `- LINGHUN_DATA_DIR: ${process.env.LINGHUN_DATA_DIR ?? "not set; default user data is under ~/.linghun/data"}`,
  ].join("\n");
}

function formatMemoryReview(context: TuiContext): string {
  const accepted = context.memory.accepted.map(
    (item) =>
      `- accepted ${item.id} [${item.scope}] ${item.summary} (source=${item.source}; refs=${item.sourceRefs.join(",") || "none"})`,
  );
  const disabled = context.memory.disabled.map(
    (item) => `- disabled ${item.id} [${item.scope}] ${item.summary} (source=${item.source})`,
  );
  if (context.memory.candidates.length === 0) {
    return [
      "Memory review：暂无候选记忆。可用 /memory candidate <短小稳定摘要> [--scope project|user|session] 创建候选；长期写入前必须 /memory accept。",
      "边界：默认不逐轮学习、不自动接受长期记忆、不把完整 transcript/source/tool output 写入记忆。",
      ...accepted,
      ...disabled,
    ].join("\n");
  }
  return [
    "Memory review（候选，不是长期记忆）",
    ...context.memory.candidates.map(
      (item) =>
        `- candidate ${item.id} [${item.scope}] risk=${item.risk} inferred=${item.inferred ? "yes" : "no"} ${item.summary} (source=${item.source}; refs=${item.sourceRefs.join(",") || "none"})`,
    ),
    ...accepted,
    ...disabled,
    "确认写入：/memory accept <id>；拒绝候选：/memory reject <id>；禁用已接受：/memory disable <id>；删除：/memory delete <id>",
  ].join("\n");
}

function formatMemoryStats(context: TuiContext): string {
  const injection = createControlledMemoryInjection(context);
  return [
    "Memory stats（controlled learning / cost guard）",
    `- candidates: ${context.memory.candidates.length}`,
    `- accepted: ${context.memory.accepted.length}`,
    `- disabled: ${context.memory.disabled.length}`,
    `- rejected: ${context.memory.rejected.length}`,
    `- promptInjection: acceptedOnly topK=${MEMORY_PROMPT_TOP_K} injected=${injection.items.length} chars=${injection.text.length} estimatedTokens=${estimateMemoryTokens(injection.text)}`,
    `- lastLearningRun: ${context.memory.lastLearningRun ? `${context.memory.lastLearningRun.trigger}; candidates=${context.memory.lastLearningRun.candidatesCreated}; modelCalled=${context.memory.lastLearningRun.modelCalled ? "yes" : "no"}` : "none"}`,
    "- autoLearning: off by default; no per-turn learning model call",
    "- longTermWrite: requires explicit /memory accept <id>; memory never bypasses Start Gate or permission mode",
    "- summarizerRole: only optional bounded summary source; failure degrades to no learning",
  ].join("\n");
}

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

function createEvidenceBackedMemoryCandidates(context: TuiContext): MemoryCandidate[] {
  const existing = new Set(
    [...context.memory.candidates, ...context.memory.accepted, ...context.memory.disabled].map(
      (item) => item.summary,
    ),
  );
  const summaries: MemoryCandidate[] = [];
  const add = (summary: string, source: string, refs: string[]): void => {
    const normalized = truncateDisplay(summary.replace(/\s+/g, " "), 240);
    if (!normalized || existing.has(normalized)) {
      return;
    }
    existing.add(normalized);
    summaries.push(createMemoryCandidate("project", normalized, source, refs));
  };
  for (const evidence of context.evidence.slice(0, 3)) {
    add(`证据线索：${evidence.summary}`, `evidence:${evidence.kind}`, [evidence.id]);
  }
  for (const todo of context.tools.todos.slice(0, 3)) {
    if (todo.status === "completed") {
      add(`已完成任务线索：${todo.content}`, "todo:completed", [`todo:${todo.id}`]);
    }
  }
  if (context.lastVerification?.status === "pass") {
    add(`验证通过线索：${context.lastVerification.summary}`, "verification:pass", [
      context.lastVerification.id,
    ]);
  }
  if (context.memory.lastHandoff) {
    add(`handoff 线索：${context.memory.lastHandoff.goal}`, "handoff", [
      context.memory.lastHandoff.id,
    ]);
  }
  return summaries;
}

function formatMemoryLearningRun(run: MemoryLearningRun): string {
  return [
    "Memory learn（controlled / candidate-only）",
    `- trigger: ${run.trigger}`,
    `- candidatesCreated: ${run.candidatesCreated}`,
    `- modelCalled: ${run.modelCalled ? "yes" : "no"}`,
    `- skippedReason: ${run.skippedReason ?? "none"}`,
    "- autoAccept: no；请运行 /memory review 后用 /memory accept <id> 明确确认长期写入。",
  ].join("\n");
}

function createControlledMemoryInjection(context: TuiContext): {
  items: MemoryCandidate[];
  text: string;
} {
  const items = context.memory.accepted
    .filter((item) => normalizeMemoryStatus(item) === "accepted" && !item.inferred)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MEMORY_PROMPT_TOP_K);
  const text = truncateDisplay(
    items
      .map(
        (item) =>
          `- ${item.id} [${item.scope}] ${truncateDisplay(item.summary.replace(/\s+/g, " "), MEMORY_PROMPT_ITEM_WIDTH)} (source=${truncateDisplay(item.source, 80)})`,
      )
      .join("\n"),
    MEMORY_PROMPT_TOTAL_WIDTH,
  );
  return { items, text };
}

function estimateMemoryTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatControlledMemoryForModel(context: TuiContext): string {
  const injection = createControlledMemoryInjection(context);
  if (injection.items.length === 0) {
    return "[]";
  }
  return JSON.stringify(
    injection.items.map((item) => ({
      id: item.id,
      scope: item.scope,
      summary: truncateDisplay(item.summary.replace(/\s+/g, " "), MEMORY_PROMPT_ITEM_WIDTH),
      source: truncateDisplay(item.source, 80),
    })),
  );
}

function createLinghunMdTemplate(language: Language): string {
  if (language === "en-US") {
    return `# Project Rules

## Purpose
- LINGHUN.md records long-lived project rules, stable facts, common commands, and explicit constraints.
- Keep this file concise so it can be loaded into context without adding unnecessary tokens.

## What to write here
- Stable engineering rules, validation commands, architecture boundaries, coding style, and project-specific do/don't items.
- Facts that have been checked against code, index results, command output, or project documents.

## What not to write here
- Temporary plans, phase progress, full transcripts, large logs, raw index dumps, secrets, tokens, billing details, or private credentials.
- Short-term handoff content belongs in structured handoff/todo/verification records, not in long-term rules.

## Work rules
- Prefer facts over guesses: read code, project index, documentation, or command results before making claims.
- Natural-language commands do not bypass Start Gate or permission approval.
- Writing files, Bash, network access, dependency installation, and permission/config changes require explicit user confirmation.
- Long-term memory is candidate-first by default; do not auto-write it without user review and acceptance.
- After code changes, run the smallest project-approved validation that covers the touched area.
- Do not paste full transcripts, huge logs, large index results, or full memory stores back into model context.
- Keep clean rewrite boundaries: reference public behavior and project docs, but do not copy suspicious or proprietary source.
- Be friendly to Chinese and English projects; keep names, commands, and errors readable for both when practical.
`;
  }

  return `# 项目规则

## 用途
- LINGHUN.md 记录项目长期稳定规则、稳定事实、常用命令和明确禁止事项。
- 保持短小清晰，避免把完整文件塞进上下文造成 token 负担。

## 应该写入
- 稳定工程规则、验证命令、架构边界、代码风格、项目专属约定和禁止事项。
- 已通过代码、项目索引、文档或命令结果确认过的事实。

## 不应该写入
- 临时计划、阶段进度、完整 transcript、大日志、原始索引结果、密钥、token、账单细节或私有凭据。
- 短期交接内容应进入结构化 handoff、Todo 或验证记录，不要追加到长期规则。

## 工作规则
- 事实优先：先读代码、项目索引、文档或命令结果，再判断和下结论。
- 自然语言命令不能绕过 Start Gate 或权限审批。
- 写文件、Bash、联网、安装依赖、权限或配置变更，都必须先得到用户明确确认。
- 长期记忆默认先生成候选，用户 review/accept 后再写入，不自动长期保存。
- 改代码后运行项目认可的最小必要验证，覆盖本次改动范围。
- 不要把完整 transcript、大日志、大索引结果或完整 memory 塞回模型上下文。
- 遵守 clean rewrite：可参考公开行为和项目文档，不复制可疑或专有源码。
- 中文友好，同时尽量保留中英文项目名、命令和错误信息的可读性。

## 工程纪律
- 默认只做完成当前任务所必需的最小改动，不顺手修无关问题。
- 不主动新增抽象、helper、wrapper、目录层级或结构性改造。
- 优先局部补丁和现有代码风格，避免继续放大屎山、超长文件和复杂分支。
- 重构仅在必要、存在直接风险或用户明确要求时进行。
- 默认不改公共接口、依赖、配置、构建脚本、文件名和目录结构。
- 涉及超过 3 个文件、公共接口、依赖/配置、删除/重命名或明显重构时，先说明理由和范围。
- 修 bug 要定位直接原因，不接受只掩盖症状的补丁。
`;
}

async function formatProjectRulesRead(context: TuiContext): Promise<string> {
  if (!(await pathExists(context.memory.projectRulesPath))) {
    context.memory.projectRulesExists = false;
    context.memory.projectRulesSummary = "missing";
    return context.language === "en-US"
      ? `Project rules file is missing: ${context.memory.projectRulesPath}\n- To create a template, run /memory init. I will not generate it automatically.`
      : `项目规则文件不存在：${context.memory.projectRulesPath}\n- 如需生成模板，请运行 /memory init。本次不会自动生成。`;
  }
  try {
    const content = await readFile(context.memory.projectRulesPath, "utf8");
    context.memory.projectRulesExists = true;
    context.memory.projectRulesSummary = summarizeProjectRules(content);
    context.memory.projectRulesError = undefined;
    return context.language === "en-US"
      ? `Project rules: ${context.memory.projectRulesPath}\n${truncateDisplay(content, 2000)}`
      : `项目规则：${context.memory.projectRulesPath}\n${truncateDisplay(content, 2000)}`;
  } catch (error) {
    context.memory.projectRulesExists = false;
    context.memory.projectRulesSummary = "unreadable";
    context.memory.projectRulesError = formatError(error);
    return context.language === "en-US"
      ? `Failed to read project rules: ${context.memory.projectRulesError}`
      : `读取项目规则失败：${context.memory.projectRulesError}`;
  }
}

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
  const executorRoute = getRoleRoute(context, "executor");
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

function sanitizeDiagnosticText(text: string): string {
  return text
    .replace(/prompt=[^\s&]+/giu, "prompt=***")
    .replace(/api[_-]?key=[^\s&]+/giu, "api_key=***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***");
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
  context.mcp.tools = stabilizeMcpToolList(
    context.mcp.servers
      .filter((server) => server.status === "configured")
      .flatMap((server) => createMcpToolPlaceholders(server.name, "discovered")),
  );
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

function formatMcpTools(context: TuiContext): string {
  if (context.mcp.tools.length === 0) {
    return "MCP tools：暂无稳定工具摘要。可运行 /mcp doctor 检测本机 server；不会输出完整 tool schema。";
  }
  return [
    "MCP tools（稳定排序摘要，不输出完整 schema）",
    "- placeholder 表示安全占位摘要：未加载、未信任、不可执行真实 schema；schemaLoaded=yes 只会在 discovery/doctor 成功后出现。",
    ...context.mcp.tools.map(
      (tool) =>
        `- ${tool.server} :: ${tool.name} — ${tool.description}; discovery=${tool.discovery ?? "placeholder"}; trusted=${tool.trusted ? "yes" : "no"}; schemaLoaded=${tool.schemaLoaded ? "yes" : "no"}; runtime=${tool.runtimeVersion ?? "unknown"}`,
    ),
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

type IndexSafetyFile = {
  path: string;
  size: number;
  reason: string;
};

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

function findCurrentIndexProject(
  data: unknown,
  projectPath: string,
): { name: string; rootPath?: string; source: CodebaseMemoryProjectSelectionSource } | null {
  if (!isRecord(data) || !Array.isArray(data.projects)) {
    return null;
  }
  const normalizedProjectPath = normalizePath(projectPath);
  const rootPathMatch = data.projects.find((project) => {
    if (!isRecord(project)) {
      return false;
    }
    return normalizePath(String(project.root_path ?? "")) === normalizedProjectPath;
  });
  if (isRecord(rootPathMatch) && typeof rootPathMatch.name === "string") {
    const rootPath =
      typeof rootPathMatch.root_path === "string" ? rootPathMatch.root_path : undefined;
    return { name: rootPathMatch.name, rootPath, source: "root_path" };
  }

  const candidateNames = createCurrentIndexProjectNameCandidates(projectPath);
  const nameMatches = data.projects.filter((project) => {
    if (!isRecord(project) || typeof project.name !== "string") {
      return false;
    }
    return candidateNames.has(project.name.toLowerCase());
  });
  if (nameMatches.length !== 1) {
    return null;
  }
  const [nameMatch] = nameMatches;
  if (!isRecord(nameMatch) || typeof nameMatch.name !== "string") {
    return null;
  }
  const rootPath = typeof nameMatch.root_path === "string" ? nameMatch.root_path : undefined;
  return { name: nameMatch.name, rootPath, source: "name-candidate" };
}

function createCurrentIndexProjectNameCandidates(projectPath: string): Set<string> {
  const normalizedPath = projectPath.replaceAll("\\", "/").replace(/\/$/, "");
  const projectName = basename(normalizedPath);
  const candidates = new Set<string>();
  if (projectName) {
    candidates.add(projectName.toLowerCase());
  }
  const drive = /^([A-Za-z]):\//.exec(normalizedPath)?.[1];
  if (drive && projectName) {
    candidates.add(`${drive}-${projectName}`.toLowerCase());
  }
  return candidates;
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
    try {
      child = spawn(command, args, { cwd, shell: false, windowsHide: true });
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
      child.kill();
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

function estimateTranscriptContextChars(transcript: TranscriptEvent[]): number {
  return transcript.reduce((total, event) => {
    if (event.type === "user_message") return total + event.text.length;
    if (event.type === "assistant_text_delta") return total + event.text.length;
    if (event.type === "tool_call_start") return total + JSON.stringify(event.input).length;
    if (event.type === "tool_result") return total + JSON.stringify(event.content).length;
    return total;
  }, 0);
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

function createWorkspaceReferenceDimensions(context: TuiContext) {
  const runtime = getSelectedModelRuntime(context);
  return {
    configHash: stableHash(createConfigFreshnessSummary(context.config)),
    toolSchemaHash: stableHash(builtInTools),
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

function createConfigFreshnessSummary(config: LinghunConfig): unknown {
  return {
    language: config.language,
    permission: config.permission,
    index: config.index,
    defaultModel: config.defaultModel,
    modelRoutes: config.modelRoutes,
    providers: Object.fromEntries(
      Object.entries(config.providers)
        .map(([id, provider]) => ({
          id,
          summary: {
            type: provider.type,
            model: provider.model,
            baseUrl: provider.baseUrl ? "configured" : "missing",
            apiKey: provider.apiKey ? "configured" : "missing",
            endpointProfile: provider.endpointProfile,
            compatibilityProfile: provider.compatibilityProfile,
            supportsTools: provider.supportsTools,
          },
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entry) => [entry.id, entry.summary]),
    ),
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function getCurrentFreshness(context: TuiContext): CacheFreshness {
  return createCacheFreshness({
    systemPrompt:
      context.language === "en-US" ? "Linghun EN system prompt" : "Linghun ZH system prompt",
    toolSchema: builtInTools,
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

function createCacheFreshness(input: {
  systemPrompt: unknown;
  toolSchema: unknown;
  mcpToolList: unknown;
  model: string;
  provider: string;
  reasoningEffort?: unknown;
  projectRules?: unknown;
  memory?: unknown;
  compact?: unknown;
  plugins?: unknown;
}): CacheFreshness {
  return {
    systemPromptHash: stableHash(input.systemPrompt),
    toolSchemaHash: stableHash(input.toolSchema),
    mcpToolListHash: stableHash(input.mcpToolList),
    modelProviderHash: stableHash(`${input.provider}:${input.model}`),
    reasoningEffortHash: stableHash(input.reasoningEffort ?? "default"),
    projectRulesHash: stableHash(input.projectRules ?? "none"),
    memoryHash: stableHash(input.memory ?? "none"),
    compactHash: stableHash(input.compact ?? "none"),
    pluginListHash: stableHash(input.plugins ?? []),
    changedKeys: [],
  };
}

function diffFreshness(previous: CacheFreshness | undefined, current: CacheFreshness): string[] {
  if (!previous) {
    return [];
  }
  const keys: (keyof CacheFreshness)[] = [
    "systemPromptHash",
    "toolSchemaHash",
    "mcpToolListHash",
    "modelProviderHash",
    "reasoningEffortHash",
    "projectRulesHash",
    "memoryHash",
    "compactHash",
    "pluginListHash",
  ];
  return keys.filter((key) => previous[key] !== current[key]);
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 12);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${key}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
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

function formatBreakCacheStatus(context: TuiContext): string {
  const current = getCurrentFreshness(context);
  const changed = diffFreshness(context.cache.lastFreshness, current);
  const keys =
    changed.length > 0
      ? changed
      : context.cache.lastFreshness?.changedKeys.length
        ? context.cache.lastFreshness.changedKeys
        : (context.cache.history.at(-1)?.freshness.changedKeys ?? []);
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
    `- changedKeys: ${keys.length > 0 ? keys.join(", ") : "none"}`,
    "- suggestion: 如 system prompt / tool schema / MCP list / model/provider / memory / compact / plugin list 变化，可运行 /cache warmup 或 /cache refresh；不会替你自动执行。",
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
        context.language === "en-US" ? "Cache hit rate dropped" : "cache 命中率下降",
        "/break-cache status",
      ),
    );
  }
  if ((latest?.inputTokens ?? 0) > 96_000) {
    hints.push(
      createLightHint(
        "context-long",
        "info",
        context.language === "en-US"
          ? "Context is long; consider compacting when needed"
          : "context 较长，建议按需压缩",
        "/compact",
      ),
    );
  }
  if (latest?.cacheWriteTokensSource === "zero_reported" && latest.cacheReadTokens > 0) {
    hints.push(
      createLightHint(
        "cache-zero-create-with-read",
        "info",
        context.language === "en-US"
          ? "cache_creation is reported as 0 while cache_read is high; this is usually provider field semantics, not zero write cost"
          : "cache_creation 长期为 0 但 cache_read 很高时通常是 provider 字段口径，不代表零写入成本",
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
        context.language === "en-US"
          ? "Important cache freshness hashes changed"
          : "缓存 freshness 关键 hash 已变化",
        "/cache warmup",
      ),
    );
  }
  return hints;
}

function createLightHint(
  dedupeKey: string,
  severity: "info" | "warning",
  message: string,
  suggestedCommand: string,
): LightHint {
  return {
    id: randomUUID(),
    severity,
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
  for (const hint of collectLightHints(context)) {
    const lastShown = context.cache.hintLastShownAt[hint.dedupeKey] ?? 0;
    if (now - lastShown < hint.cooldownMs) {
      continue;
    }
    context.cache.hintLastShownAt[hint.dedupeKey] = now;
    writeLine(
      output,
      context.language === "en-US"
        ? `[hint:${hint.severity}] ${hint.message}; suggestion: ${hint.suggestedCommand}`
        : `[hint:${hint.severity}] ${hint.message}；建议：${hint.suggestedCommand}`,
    );
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
): Promise<{
  exitCode: number;
  output: string;
  outcome: "completed" | "timeout" | "cancelled";
  runnerError?: string;
}> {
  return new Promise((resolveCommand) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let output = "";
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const requestStop = (force: boolean) => {
      if (process.platform === "win32" && child.pid) {
        const args = ["/pid", String(child.pid), "/t"];
        if (force) {
          args.push("/f");
        }
        const killer = spawn("taskkill", args, { windowsHide: true });
        killer.on("error", () => child.kill(force ? "SIGKILL" : "SIGTERM"));
        return;
      }
      child.kill(force ? "SIGKILL" : "SIGTERM");
    };
    const scheduleForceStop = () => {
      forceTimer = setTimeout(() => requestStop(true), 1_000);
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
      requestStop(false);
      scheduleForceStop();
      settle({ exitCode: 1, output, outcome: "cancelled", runnerError });
    };
    const timeout = setTimeout(() => {
      const runnerError = `runner timeout after ${VERIFICATION_COMMAND_TIMEOUT_MS}ms`;
      output = output ? `${output}\n${runnerError}` : runnerError;
      requestStop(false);
      scheduleForceStop();
      settle({ exitCode: 1, output, outcome: "timeout", runnerError });
    }, VERIFICATION_COMMAND_TIMEOUT_MS);
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

function formatPermissionDenialPrimary(language: Language): string {
  return language === "en-US"
    ? "Denied. No file was written; the assistant will receive the denial and adjust."
    : "已拒绝。本轮未写入文件，模型会收到拒绝结果并继续调整。";
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
    if (/^(yes|y|confirm|ok|okay|确认|是|继续|执行)$/iu.test(normalized)) {
      const approval = pendingLocalApproval;
      context.pendingLocalApproval = undefined;
      if (approval.kind === "index_ignore_write") {
        const written = await executeIndexIgnoreWritePlan(approval.plan, context, output);
        if (written) {
          await runIndexRepository(context, context.config.index.mode, "refresh", false, output);
          writeLine(output, formatIndexRefreshSummary(context));
        }
        writeStatus(output, context);
        return "handled";
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
        return "handled";
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
        return "handled";
      }
    }
    if (/^(no|n|deny|取消|拒绝|不|否|cancel)$/iu.test(normalized)) {
      const approval = pendingLocalApproval;
      context.pendingLocalApproval = undefined;
      const sessionId = await ensureSession(context);
      const cancelled = /^(cancel|取消)$/iu.test(normalized);
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
        return "handled";
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
          return "handled";
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
          return "handled";
        }
      }
      writeLine(output, formatPermissionDenialPrimary(context.language));
      writeStatus(output, context);
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

  const indexRepair = await handleIndexSafetyRepairContinuation(text, context, output);
  if (indexRepair === "handled") {
    return "handled";
  }

  const compositeStatus = formatCompositeStatusQuery(text, context);
  if (compositeStatus) {
    writeLine(output, compositeStatus);
    writeStatus(output, context);
    return "handled";
  }

  const fileRead = await resolveNaturalFileRead(text, context);
  if (fileRead.status === "resolved") {
    await handleToolCommand("Read", [fileRead.path], context, output);
    return "handled";
  }
  if (fileRead.status === "ambiguous") {
    writeLine(output, formatFileCandidates(fileRead.candidates, context.language));
    return "handled";
  }

  const localPreprocess = await handleLocalControlPlaneInput(text, context, output);
  if (localPreprocess === "handled") {
    return "handled";
  }

  if (!shouldTriggerArchitectureRuntime(text, context)) {
    context.currentArchitectureCard = undefined;
  }
  const modelGuard = checkResourceGuard(context, "model");
  if (modelGuard) {
    writeLine(output, modelGuard);
    return "handled";
  }
  return "message";
}

const LOCAL_CONTROL_PLANE_CAPABILITY_IDS = new Set([
  "help",
  "features",
  "status",
  "mode",
  "model",
  "index",
  "cache",
  "permissions",
  "hooks",
]);

const LOCAL_READONLY_COMMANDS = new Set([
  "/help",
  "/features",
  "/status",
  "/mode",
  "/model",
  "/model route",
  "/model doctor",
  "/model route doctor",
  "/index status",
  "/index architecture",
  "/cache status",
  "/permissions",
  "/doctor hooks",
]);

async function handleLocalControlPlaneInput(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<"handled" | "pass"> {
  if (looksLikeOrdinaryDevelopmentRequest(text)) {
    return "pass";
  }

  const intent = routeNaturalIntent(text, context.language);
  const capabilityId = intent.capability?.id;
  if (!capabilityId || !LOCAL_CONTROL_PLANE_CAPABILITY_IDS.has(capabilityId)) {
    return "pass";
  }
  if (intent.confidence < 0.75 || intent.riskHandler === "model") {
    return "pass";
  }

  if (shouldDispatchLocalReadonlyIntent(intent)) {
    const result = await handleSlashCommand(intent.command, context, output);
    return result === "message" ? "pass" : "handled";
  }

  if (isReadonlyPermissionsStatus(intent)) {
    await handleSlashCommand("/permissions", context, output);
    return "handled";
  }

  if (isAllowedModeStartGate(intent)) {
    const gate = createPendingNaturalCommand(intent, context);
    if (!gate) {
      return "pass";
    }
    context.pendingNaturalCommand = gate;
    await appendNaturalGateDebugEvent(context, gate, "created");
    writeLine(output, formatNaturalStartGate(intent, context, gate));
    writeStatus(output, context);
    return "handled";
  }

  if (intent.action === "answer" && isAllowedLocalCapabilityAnswer(intent)) {
    writeLine(output, formatCapabilityAnswer(intent));
    writeStatus(output, context);
    return "handled";
  }

  return "pass";
}

function looksLikeOrdinaryDevelopmentRequest(text: string): boolean {
  return /分析|实现|修复|部署|报告|生成|输出|项目|技术栈|代码|开发|写|改|新增|导出|bug|analy[sz]e|implement|fix|deploy|report|generate|project|tech stack|code|write|export/iu.test(
    text,
  );
}

function shouldDispatchLocalReadonlyIntent(
  intent: NaturalIntent,
): intent is NaturalIntent & { command: string } {
  return intent.action === "execute_readonly" && isAllowedLocalReadonlyCommand(intent.command);
}

function isAllowedLocalReadonlyCommand(command: string | undefined): command is string {
  return Boolean(command && LOCAL_READONLY_COMMANDS.has(command));
}

function isReadonlyPermissionsStatus(intent: NaturalIntent): boolean {
  return (
    intent.capability?.id === "permissions" &&
    intent.inquiry === "status" &&
    intent.confidence >= 0.8 &&
    intent.command === "/permissions"
  );
}

function isAllowedModeStartGate(
  intent: NaturalIntent,
): intent is NaturalIntent & { command: string } {
  return (
    intent.action === "start_gate" &&
    intent.capability?.id === "mode" &&
    typeof intent.command === "string" &&
    /^\/mode (?:default|auto-review|plan|full-access)$/u.test(intent.command)
  );
}

function isAllowedLocalCapabilityAnswer(intent: NaturalIntent): boolean {
  return (
    intent.confidence >= 0.85 &&
    (intent.capability?.id === "help" || intent.capability?.id === "features") &&
    (intent.inquiry === "usage" || intent.inquiry === "howto" || intent.inquiry === "status")
  );
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
}

function startRequestActivity(
  output: Writable,
  context: TuiContext,
  phase: RequestActivityPhase,
  values: { reportPath?: string; toolName?: string } = {},
): void {
  clearRequestActivity(context);
  writeLine(output, formatRequestActivity(phase, context.language, values));
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
    writeLine(output, formatRequestActivity("waiting_first_delta", context.language, values));
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
    messages.push({ role: "user", content: createReportTaskGuard(reportWriteGuard, context) });
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
          output.write(event.text);
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
            content: createReportWriteReminder(reportWriteGuard, context),
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
            content: createReportFinalReferenceReminder(reportWriteGuard, context),
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
    clearRequestActivity(context);
    context.activeAbortController = undefined;
    context.tools.abortSignal = undefined;
    context.interrupt = { type: "idle" };
  }

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

function estimateModelMessageChars(messages: ModelMessage[]): number {
  return messages.reduce((total, message) => {
    if (message.role === "assistant") {
      return total + message.content.length + JSON.stringify(message.toolCalls ?? []).length;
    }
    return total + message.content.length;
  }, 0);
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
  let chunkCount = 0;
  let hadUsage = false;
  let finishReason: string | undefined;
  let hadThinking = false;
  for await (const event of gateway.stream(
    continuation.provider,
    {
      messages: continuation.messages,
      model: continuation.model,
      endpointProfile: continuation.endpointProfile,
      ...(continuation.reasoningSent ? { reasoningLevel: continuation.reasoningLevel } : {}),
      toolChoice: "none",
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
      output.write(event.text);
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
  const sessionId = await ensureSession(context);
  try {
    for (let round = 0; round < MAX_MODEL_TOOL_ROUNDS; round += 1) {
      const toolCalls: ModelToolCall[] = [];
      let roundAssistantText = "";
      for await (const event of gateway.stream(
        continuation.provider,
        {
          messages: continuation.messages,
          model: continuation.model,
          endpointProfile: continuation.endpointProfile,
          ...(continuation.reasoningSent ? { reasoningLevel: continuation.reasoningLevel } : {}),
          tools: createModelToolDefinitionsForReportGuard(continuation.reportWriteGuard),
          toolChoice: "auto",
        },
        controller.signal,
      )) {
        if (event.type === "assistant_text_delta") {
          clearRequestActivity(context);
          assistantText += event.text;
          roundAssistantText += event.text;
          output.write(event.text);
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
            content: createReportWriteReminder(reportWriteGuard, context),
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
            content: createReportFinalReferenceReminder(reportWriteGuard, context),
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

function createModelToolDefinitions(): ModelToolDefinition[] {
  return createModelToolDefinitionsForTools(
    Object.values(builtInTools) as (typeof builtInTools)[ToolName][],
  );
}

function createModelToolDefinitionsForReportGuard(
  guard: ReportWriteGuard | undefined,
): ModelToolDefinition[] {
  if (!guard || guard.completed) {
    return createModelToolDefinitions();
  }
  if (!guard.evidenceRead) {
    return createModelToolDefinitionsForTools([
      builtInTools.Read,
      builtInTools.Grep,
      builtInTools.Glob,
    ]);
  }
  if (guard.nonWriteToolRounds < 1) {
    return createModelToolDefinitionsForTools(
      (Object.values(builtInTools) as (typeof builtInTools)[ToolName][]).filter(
        (tool) => tool.name !== "Bash",
      ),
    );
  }
  return createModelToolDefinitionsForTools([builtInTools.Write]);
}

function createModelToolDefinitionsForTools(
  tools: (typeof builtInTools)[ToolName][],
): ModelToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: createToolInputSchema(tool.name),
  }));
}

function createToolInputSchema(name: ToolName): unknown {
  const base = { type: "object", additionalProperties: false } as const;
  if (name === "Read") {
    return {
      ...base,
      properties: {
        path: { type: "string" },
        offset: { type: "number" },
        limit: { type: "number" },
      },
      required: ["path"],
    };
  }
  if (name === "Write") {
    return {
      ...base,
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        expectedHash: { type: "string" },
      },
      required: ["path", "content"],
    };
  }
  if (name === "Edit") {
    return {
      ...base,
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
        expectedHash: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
    };
  }
  if (name === "MultiEdit") {
    return {
      ...base,
      properties: {
        path: { type: "string" },
        expectedHash: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: { oldText: { type: "string" }, newText: { type: "string" } },
            required: ["oldText", "newText"],
            additionalProperties: false,
          },
        },
      },
      required: ["path", "edits"],
    };
  }
  if (name === "Grep") {
    return {
      ...base,
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        limit: { type: "number" },
      },
      required: ["pattern"],
    };
  }
  if (name === "Glob") {
    return {
      ...base,
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        limit: { type: "number" },
      },
      required: ["pattern"],
    };
  }
  if (name === "Bash") {
    return {
      ...base,
      properties: { command: { type: "string" }, timeoutMs: { type: "number" } },
      required: ["command"],
    };
  }
  if (name === "Todo") {
    return {
      ...base,
      properties: {
        action: { type: "string", enum: ["list", "add", "start", "done", "block"] },
        content: { type: "string" },
        id: { type: "string" },
        evidence: { type: "string" },
      },
      required: ["action"],
    };
  }
  return { ...base, properties: { files: { type: "array", items: { type: "string" } } } };
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
          ? `Architecture drift requires confirmation before this tool use: ${drift.warnings.join("; ")}`
          : `Architecture drift 需要确认后才能执行本次工具调用：${drift.warnings.join("；")}`;
      await appendSystemEvent(context, sessionId, warning, "warning");
      writeLine(
        output,
        context.language === "en-US"
          ? "Architecture drift detected. Confirm before running this tool."
          : "检测到 Architecture drift。确认后才会运行本工具。",
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

function normalizeToolName(name: string): ToolName | null {
  const found = (Object.keys(builtInTools) as ToolName[]).find(
    (item) => item.toLowerCase() === name.toLowerCase(),
  );
  return found ?? null;
}

function toPermissionPromptView(permission: PermissionCheck) {
  return {
    toolName: permission.request.toolName,
    decision: permission.decision,
    risk: permission.request.risk,
    mode: permission.request.mode,
    reason: permission.reason,
    scope: permission.request.files,
  };
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
  return `${
    context.language === "en-US"
      ? "You are Linghun, a coding assistant with tool-use capabilities. Answer in English by default unless the user explicitly requests another language. Use evidence before code claims; avoid unverified claims. Natural command execution is decided by local RuntimeStatus and Command Capability Catalog, not by guessing. Use real tool_use events when file/search/edit/bash/todo facts or actions are needed; never describe a tool call as text instead of using a tool event."
      : "你是 Linghun 工程型中文助手，具备工具调用能力。默认用中文回答，除非用户明确指定其他语言。涉及代码事实必须先有证据，避免未验证断言。自然语言命令是否可执行由本地 RuntimeStatus 与 Command Capability Catalog 裁决，不能靠模型猜。需要文件、搜索、编辑、Bash 或 Todo 事实/动作时必须使用真实 tool_use 事件，不要用文本冒充工具调用。"
  }\nRuntimeStatusForModel=${JSON.stringify(runtimeStatus)}\nControlledMemorySummary=${formatControlledMemoryForModel(context)}\nMemoryBoundary=acceptedOnly; topK=${MEMORY_PROMPT_TOP_K}; noAutoLearning; noAutoAccept; doNotWriteLongTermMemoryWithoutExplicitMemoryAccept\nEvidenceSummary=${createEvidenceSummaryForModel(context)}${freshnessBoundary ? `\n${freshnessBoundary}` : ""}\nSolutionCompleteness=${JSON.stringify(context.solutionCompleteness)}${solutionCompletenessWarning ? `\n${solutionCompletenessWarning}` : ""}${architectureDirective ? `\n${architectureDirective}` : ""}\nCommandCapabilitySummary=\n${createModelCapabilitySummary(24)}`;
}

type FreshnessLiteState = {
  sensitive: boolean;
  webSourceEvidence: "present" | "missing";
};

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

function formatFreshnessLitePrimaryWarning(
  state: FreshnessLiteState,
  language: TuiContext["language"],
): string | undefined {
  if (!state.sensitive || state.webSourceEvidence === "present") {
    return undefined;
  }
  return language === "en-US"
    ? "Freshness note: no web_source evidence is available in this session, so any latest/current/external facts above are unverified and need confirmation."
    : "Freshness 提示：本会话没有 web_source 证据，以上涉及最新/当前/外部事实的内容均未验证，需要进一步确认。";
}

function needsFreshnessLiteBoundary(text: string): boolean {
  return /最新|当前|现在|今天|今年|实时|外部资料|网页|官网|官方|新闻|版本|价格|latest|current|today|now|real[-\s]?time|external|web|official|news|price|version/iu.test(
    text,
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

export function createSolutionCompletenessStatus(): SolutionCompletenessStatus {
  return {
    triggered: false,
    triggerReason: "none",
    classificationRequired: false,
    classification: "unknown",
    impactAreas: [],
    severity: "unknown",
    requiredBeforeAction: false,
    evidenceRefs: [],
    sourceRefs: [],
    nextRequiredOutput: "none",
    checklist: [],
  };
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

function inferSolutionCompletenessImpactAreas(
  text: string,
  triggerReason: SolutionCompletenessStatus["triggerReason"],
): string[] {
  const areas = new Set<string>();
  const lower = text.toLowerCase();
  if (/ccb|opencode|成熟项目|对照|全局|系统性|完整性/u.test(lower)) {
    areas.add("reference_parity");
    areas.add("runtime_behavior");
  }
  if (/权限|permission|denial|拒绝/u.test(lower) || triggerReason === "repeated_denial") {
    areas.add("permission_pipeline");
    areas.add("tool_loop");
  }
  if (/smoke|tui|交互|手感|污染|失真/u.test(lower) || triggerReason === "smoke_contamination") {
    areas.add("tui_smoke");
    areas.add("natural_command_bridge");
  }
  if (/文字补丁|regex|正则|只改文档|verifier|审计|audit/u.test(lower)) {
    areas.add("implementation_scope");
    areas.add("verification");
  }
  return [...areas];
}

function formatSolutionCompletenessTrigger(
  triggerReason: SolutionCompletenessStatus["triggerReason"],
): string {
  if (triggerReason === "user_request") {
    return "用户明确要求成品级/不要缝补/先对照成熟参考/全局检查遗漏。";
  }
  if (triggerReason === "smoke_contamination") {
    return "真实 smoke 已出现污染或交互失真。";
  }
  if (triggerReason === "audit_finding") {
    return "verifier/审计指出文字补丁、regex 补丁或只改文档风险。";
  }
  if (triggerReason === "repeated_denial") {
    return "最近同类权限拒绝反复出现。";
  }
  return "未触发。";
}

function collectSolutionCompletenessEvidenceRefs(context: TuiContext): string[] {
  const evidence = context.evidence.slice(0, 3).map((item) => item.id);
  const denied = context.permissions.recentDenied
    .slice(0, 3)
    .map((item) => `permission_denial:${item.toolName}:${item.mode}`);
  return [...evidence, ...denied];
}

function hasRepeatedPermissionDenial(recentDenied: RecentPermissionRejection[]): boolean {
  const latest = recentDenied.slice(0, 5);
  const counts = new Map<string, number>();
  for (const item of latest) {
    const key = `${item.toolName}:${item.mode}:${item.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
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

function extractFileMentions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(":")[0]?.trim() ?? "")
    .filter((line) => /[\\/]|\.[a-z0-9]+$/iu.test(line))
    .map((line) => line.replaceAll("\\", "/"));
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

function isNaturalReadFileRequest(text: string): boolean {
  return /(?:读|读取|打开|看看|查看|show|read|open|view)\s*(?:一下|下)?/iu.test(text);
}

function createReportWriteGuard(text: string): ReportWriteGuard | undefined {
  if (!isReportFileWriteRequest(text)) {
    return undefined;
  }
  const requestedPath = extractRequestedReportPath(text);
  return {
    requestedPath: requestedPath ?? "report.md",
    pathExplicit: Boolean(requestedPath),
    completed: false,
    reminderSent: false,
    evidenceReminderSent: false,
    finalReferenceReminderSent: false,
    nonWriteToolRounds: 0,
    evidenceRead: false,
  };
}

function isReportFileWriteRequest(text: string): boolean {
  const asksForReport = /报告|report/iu.test(text);
  const asksToWrite = /生成|写入|创建|保存|输出|写到|写在|generate|write|create|save|output/iu.test(
    text,
  );
  const asksForFile = /根目录|文件|file|\.md\b|写到|写在|保存为|save as|as\s+[^\s]+\.md/iu.test(
    text,
  );
  return asksForReport && asksToWrite && asksForFile;
}

function extractRequestedReportPath(text: string): string | undefined {
  const quotedMarkdownPath = text.match(/["“”'‘’`]([^"“”'‘’`]+\.md)["“”'‘’`]/iu)?.[1];
  if (quotedMarkdownPath) {
    return normalizeReportPath(quotedMarkdownPath.trim());
  }
  const markdownPath = text.match(
    /(?:^|[\s`"'“”‘’：:，,。；;()（）])([\w./\\-]*report[\w./\\-]*\.md)\b/iu,
  )?.[1];
  if (markdownPath) {
    return normalizeReportPath(markdownPath);
  }
  const anyMarkdownPath = text.match(/(?:^|[\s`"'“”‘’：:，,。；;()（）])([\w./\\-]+\.md)\b/iu)?.[1];
  return anyMarkdownPath ? normalizeReportPath(anyMarkdownPath) : undefined;
}

function normalizeReportPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function shouldSendReportEvidenceReminder(guard: ReportWriteGuard | undefined): boolean {
  return Boolean(guard && !guard.completed && !guard.evidenceRead && !guard.evidenceReminderSent);
}

function shouldSendReportWriteReminder(guard: ReportWriteGuard | undefined): boolean {
  return Boolean(guard?.evidenceRead && !guard.completed && !guard.reminderSent);
}

function shouldSendReportFinalReferenceReminder(
  guard: ReportWriteGuard,
  assistantText: string,
): boolean {
  return (
    guard.completed &&
    !guard.finalReferenceReminderSent &&
    (!assistantText.includes(guard.requestedPath) || !hasReportFinalAnswerShape(assistantText))
  );
}

function hasReportFinalAnswerShape(text: string): boolean {
  return (
    /结论|conclusion|发现|findings/iu.test(text) && /下一步|next step|建议|recommend/iu.test(text)
  );
}

function createReportFinalReferenceReminder(guard: ReportWriteGuard, context: TuiContext): string {
  return context.language === "en-US"
    ? `The report file has been written. Give the final answer now: reference ${guard.requestedPath}, include 2-4 evidence-based conclusions, separate inferred/unconfirmed items, and list next steps. Do not call another tool unless necessary.`
    : `报告文件已经写入。现在请给出最终回答：引用 ${guard.requestedPath}，列出 2-4 条基于证据的核心结论，单独说明推断/未确认项，并给出下一步。除非必要，不要再调用工具。`;
}

function createReportTaskGuard(guard: ReportWriteGuard, context: TuiContext): string {
  return context.language === "en-US"
    ? `Task-specific completion requirement for this turn only: the user explicitly asked for a saved report file. Before final answer, call Write with path ${guard.requestedPath}. If you inspect the project first, keep it minimal and still finish by writing ${guard.requestedPath}. The final answer must reference ${guard.requestedPath}, include 2-4 evidence-based conclusions, separate inferred/unconfirmed items, and list next steps.`
    : `仅本轮任务的完成要求：用户明确要求保存报告文件。最终回答前必须调用 Write，path 使用 ${guard.requestedPath}。如需先检查项目，请保持最小必要检查，并仍以写入 ${guard.requestedPath} 收口。最终回答必须引用 ${guard.requestedPath}，列出 2-4 条基于证据的核心结论，单独说明推断/未确认项，并给出下一步。`;
}

function createReportWriteReminder(guard: ReportWriteGuard, context: TuiContext): string {
  return context.language === "en-US"
    ? `The user explicitly asked you to generate and save a report file. No saved report exists yet. Call the Write tool now with path ${guard.requestedPath}, then give a final answer that references ${guard.requestedPath}.`
    : `用户明确要求生成并保存报告文件，但当前还没有保存报告。现在请调用 Write 工具写入 ${guard.requestedPath}，然后在最终回答中引用 ${guard.requestedPath}。`;
}

function formatModelToolOutput(
  toolName: ToolName,
  output: ToolOutput,
  language: Language,
  evidenceId: string | undefined,
  reportWriteGuard: ReportWriteGuard | undefined,
): string {
  if (!reportWriteGuard) {
    return formatToolOutput(toolName, output, language, evidenceId);
  }
  const changedFile = output.changedFiles?.[0];
  if (toolName === "Write" && changedFile) {
    return language === "en-US" ? `Report saved: ${changedFile}` : `报告已保存：${changedFile}`;
  }
  if (toolName === "Write") {
    return language === "en-US" ? "Report file write completed." : "报告文件写入已完成。";
  }
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
    return language === "en-US"
      ? `${toolName} completed; continuing the report analysis.`
      : `${toolName} 已完成，继续整理报告分析。`;
  }
  return formatToolOutput(toolName, output, language, evidenceId);
}

function createToolUseDriftSummary(toolName: ToolName, input: unknown): string {
  const path = readToolInputString(input, "path") ?? readToolInputString(input, "file_path");
  if ((toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") && path) {
    return `${toolName}: ${path}`;
  }
  return `${toolName}: ${JSON.stringify(input ?? {})}`;
}

function readToolInputString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
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

function doesWriteSatisfyReportGuard(
  guard: ReportWriteGuard | undefined,
  toolCall: ModelToolCall,
  result: { ok: boolean; tool: string },
): guard is ReportWriteGuard {
  return Boolean(
    guard && result.ok && result.tool === "Write" && hasReportWriteToolCall(guard, [toolCall]),
  );
}

function hasReportWriteToolCall(guard: ReportWriteGuard, toolCalls: ModelToolCall[]): boolean {
  for (const toolCall of toolCalls) {
    if (normalizeToolName(toolCall.name) !== "Write") {
      continue;
    }
    const input = toolCall.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      continue;
    }
    const path = (input as { path?: unknown }).path;
    if (typeof path !== "string") {
      continue;
    }
    const normalizedPath = normalizeReportPath(path);
    if (guard.pathExplicit && normalizedPath === guard.requestedPath) {
      return true;
    }
    const matchesDefaultReport = /(?:^|\/)\w*[\w-]*report[\w-]*\.md$/iu.test(normalizedPath);
    if (!guard.pathExplicit && matchesDefaultReport) {
      guard.requestedPath = normalizedPath;
      return true;
    }
  }
  return false;
}

function hasModelSynthesisIntent(text: string): boolean {
  return /总结|摘要|分析|解释|归纳|summary|summari[sz]e|analy[sz]e|explain/iu.test(text);
}

function extractNaturalReadPath(text: string): string | null {
  const quoted = /["'“”‘’`]([^"'“”‘’`]+)["'“”‘’`]/u.exec(text)?.[1];
  if (quoted && looksLikeFilePath(quoted)) {
    return normalizeRelativePath(quoted);
  }

  const token = text
    .split(/\s+/)
    .map((item) => item.replace(/[，。,.!?；;：:）)]+$/u, ""))
    .find(looksLikeFilePath);
  return token ? normalizeRelativePath(token) : null;
}

function looksLikeFilePath(value: string): boolean {
  return /[\\/]/u.test(value) || /\.[a-z0-9]{1,12}$/iu.test(value);
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

function extractFileSearchKeywords(text: string): string[] {
  return text
    .replace(/["'“”‘’`]/gu, " ")
    .split(/[^\p{L}\p{N}_.-]+/u)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 2)
    .filter(
      (item) =>
        ![
          "read",
          "open",
          "view",
          "show",
          "file",
          "the",
          "this",
          "that",
          "previous",
          "recent",
          "读取",
          "打开",
          "查看",
          "看看",
          "文件",
          "这个",
          "刚才",
          "上面",
          "最近",
        ].includes(item),
    );
}

function matchesFileKeywords(file: string, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return false;
  }
  const normalized = file.toLowerCase();
  const name = basename(normalized);
  return keywords.some((keyword) => normalized.includes(keyword) || name.includes(keyword));
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

function normalizeRelativePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function formatFileCandidates(candidates: string[], language: Language): string {
  const lines = candidates.map((candidate) => `- ${candidate}`);
  return language === "en-US"
    ? [
        "Multiple files match that request. Please choose one with an explicit command:",
        ...lines,
        "Example: /read <path>",
      ].join("\n")
    : ["找到多个可能文件，请用明确命令选择一个：", ...lines, "示例：/read <path>"].join("\n");
}

async function* readInputLines(input: Readable, output: Writable): AsyncGenerator<string> {
  if ((input as { isTTY?: boolean }).isTTY !== true) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(toInputBuffer(chunk));
    }
    const text = decodeInput(Buffer.concat(chunks));
    for (const line of text.split(/\r?\n/)) {
      yield line;
    }
    return;
  }

  if ("setEncoding" in input && typeof input.setEncoding === "function") {
    input.setEncoding("utf8");
  }

  const rl = createInterface({ input, output });
  try {
    output.write("你> ");
    for await (const line of rl) {
      yield line;
      output.write("你> ");
    }
  } finally {
    rl.close();
  }
}

function toInputBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk), "utf8");
}

function decodeInput(bytes: Buffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) {
    return utf8;
  }
  return new TextDecoder("gb18030", { fatal: false }).decode(bytes);
}

function formatCatalogHelp(language: Language): string {
  const lines =
    language === "en-US"
      ? ["Available commands (from Command Capability Catalog):"]
      : ["可用命令（来自 Command Capability Catalog）："];
  for (const capability of getCommandCapabilityCatalog().filter((item) => !item.hiddenReason)) {
    const title = language === "en-US" ? capability.titleEn : capability.titleZh;
    const description = language === "en-US" ? capability.descriptionEn : capability.descriptionZh;
    lines.push(
      `  ${capability.slash.padEnd(18)} ${title} — ${description} [risk=${capability.risk}]`,
    );
  }
  lines.push("");
  lines.push(
    language === "en-US"
      ? "Natural language can ask what any slash command does or request safe status. High-risk actions never bypass Start Gate or permission pipeline."
      : "普通自然语言可以询问任何 slash command 的用途/风险，也可以请求安全状态查询。高风险动作不会绕过 Start Gate 或权限管道。",
  );
  return `${lines.join("\n")}\n\n${formatHelp(language)}`;
}

function formatHelp(language: Language): string {
  if (language === "en-US") {
    return `Available commands:
  /help                 Show help
  /features             Show default feature policy and disabled automation boundaries
  /language zh-CN|en-US Switch UI language
  /model                Show current model
  /model doctor         Alias of /model route doctor
  /model route          Show role-based model routes
  /model route doctor   Diagnose role provider/model/capability/budget
  /model route set <role> <model>  Set one role route
  /vision <path>        Record VisionObservation evidence through vision role
  /image generate <prompt> Generate image asset metadata through image role
  /skills               List local skills metadata summaries
  /skills status|doctor|validate [id] Show Connect Lite lifecycle status
  /skills install local|git|github ... Install skill metadata with trust/source record
  /skills enable|disable <id> Persist local skill enablement
  /workflows            List workflow templates, risks, write/validation hints
  /workflows <name>     Show Start Gate for one workflow
  /plugins              List local plugin manifests and contributions
  /plugins doctor       Diagnose plugin lifecycle and load errors
  /plugins status|doctor|validate [id] Diagnose plugin lifecycle and load errors
  /plugins install local|git|github ... Install plugin metadata with trust/source record
  /plugins enable|disable <id> Persist local plugin enablement
  /doctor [readiness]   Show local terminal readiness checklist; does not run real smoke
  /doctor project       Show Project Doctor, drift/context/rollback/cost Lite sections
  /doctor hooks         Diagnose hook sources, events, timeout, logs, and cache impact
  /doctor runner        Diagnose native runner resolver, protocol, and Node fallback
  /problems             Show local Problems Lite summary from runtime evidence
  /sessions             List sessions
  /sessions resume <id> Resume a session using structured handoff
  /resume [id]          Resume latest or selected session without full transcript injection
  /branch [purpose]     Create a normal branch session from structured handoff
  /memory               Show memory and handoff status
  /memory storage       Show sessions/memory/log/cache storage paths
  /memory review        Review candidate memories before accepting
  /memory accept <id>   Accept a candidate memory
  /memory delete <id>   Delete a candidate memory in this session
  /memory init          Create a basic LINGHUN.md template on explicit request
  /memory import sessions [source] [query]  Import external AI session summary/evidence only
  /mode                 Show permission mode
  /mode default|auto-review|plan|full-access  Switch mode
  /tab                  Shift+Tab equivalent: cycle common modes
  /plan                 Show structured plan options
  /plan accept [id]     Accept a plan and return to default
  /permissions          Show permission rules
  /background           Show collapsed background task summaries
  /job                  Manage local durable jobs (list/run/pause/resume/cancel/status/logs/report)
  /agents               List agent status, transcripts, and usage
  /agents show <id>     Show one agent detail
  /agents cancel <id>   Interrupt one agent without stopping the main session
  /fork <type> <task>   Start explorer/planner/verifier/worker from trimmed handoff
  /rewind               List checkpoints
  /rewind restore <id>  Restore a checkpoint
  /btw <question>       Answer a temporary question without changing Todo/Plan/checkpoints
  /interrupt            Mark current running background task as cancelled
  /claim-check <claim>  Downgrade unsupported final claims
  /verify [plan|last|smoke] Generate or run verification
  /review               Review diff, risks, and verification evidence
  /cache-log            Show recent cache usage records
  /cache-log config size <n>  Set cache history size
  /cache-log export [path]  Export recent cache usage records
  /cache status         Show cache status and freshness
  /cache warmup|refresh Attempt cache warmup or refresh
  /break-cache status   Show cache freshness changes
  /mcp [status]         Show MCP server status
  /mcp tools            Show stable MCP tool summary
  /mcp doctor           Diagnose MCP server availability
  /mcp validate [id]    Validate MCP source/trust/enablement metadata
  /mcp add local <id> <command> [args...] Register local MCP command metadata
  /mcp update <id> local <command> [args...] Update local MCP command metadata
  /mcp enable|disable|remove <id> Manage MCP server lifecycle
  /index status [--fresh] Show fast codebase-memory status; --fresh runs detect_changes
  /index doctor         Diagnose bundled/managed codebase-memory runtime
  /index check          Run explicit freshness check with detect_changes
  /index init fast      Build a fast local index on explicit request
  /index refresh        Refresh the current project index
  /index search <query> Query codebase-memory and record evidence
  /index architecture   Show short architecture summary
  /usage                Show token/cache usage summary
  /stats                Show local cache/cost statistics
  /stats endpoints      Group usage by endpoint
  /read <path>          Read file
  /write <path> <text>  Write file
  /edit <path> <old> => <new>  Unique replacement
  /multiedit <path> <old> => <new>  Minimal multi-edit entry
  /grep <pattern> [path] Search text
  /glob <pattern> [path] Match files
  /bash <command>       Run command with collapsed task status and full log
  /todo                 Show tasks
  /diff                 Show changed file summary
  /exit                 Exit

Slash commands, config keys, and transcript event fields stay in English.`;
  }
  return `可用命令：
  /help                 显示帮助
  /features             查看默认功能策略与关闭的自动化边界
  /language zh-CN|en-US 切换界面语言
  /model                显示当前模型
  /model doctor         等价于 /model route doctor
  /model route          查看角色模型路由
  /model route doctor   诊断角色 provider/model/capability/budget
  /model route set <role> <model>  设置单个角色路由
  /vision <path>        通过 vision role 记录 VisionObservation evidence
  /image generate <prompt>  通过 image role 生成本地资产 metadata
  /skills               列出本地 skill metadata 摘要
  /skills status|doctor|validate [id] 查看 Connect Lite 生命周期状态
  /skills install local|git|github ... 安装 skill metadata 与来源/信任记录
  /skills enable <id>   启用并信任本地 skill
  /skills disable <id>  禁用本地 skill，重启后保留
  /workflows            列出 workflow 模板、风险、写文件和验证提示
  /workflows <name>     展示单个 workflow 的 Start Gate
  /plugins              列出本地 plugin manifest 与贡献项
  /plugins doctor       诊断 plugin 生命周期和加载错误
  /plugins status|doctor|validate [id] 诊断 plugin 生命周期和加载错误
  /plugins install local|git|github ... 安装 plugin metadata 与来源/信任记录
  /plugins enable|disable <id> 持久化启停 plugin
  /doctor [readiness]   查看本地终端就绪 checklist；不运行真实 smoke
  /doctor project       查看 Project Doctor、drift/context/rollback/cost Lite 小节
  /doctor hooks         诊断 hook 来源、事件、timeout、日志和 cache 影响
  /doctor runner        诊断 native runner 解析、协议与 Node fallback
  /problems             查看来自 runtime evidence 的 Problems Lite 摘要
  /sessions             列出当前项目会话
  /sessions resume <id> 基于结构化 handoff 恢复历史会话
  /resume [id]          恢复最近或指定会话，不注入完整历史
  /branch [目的]        基于结构化 handoff 创建普通分支会话
  /memory               查看记忆与 handoff 状态
  /memory storage       查看会话/记忆/日志/cache 存储路径
  /memory review        审查候选记忆
  /memory accept <id>   确认写入候选记忆
  /memory delete <id>   删除本会话候选/已接收记忆记录
  /memory init          显式生成基础 LINGHUN.md 模板
  /memory import sessions [source] [query]  只导入外部 AI 会话摘要和证据引用
  /mode                 查看权限模式
  /mode default|auto-review|plan|full-access  切换模式
  /tab                  等价 Shift+Tab：循环切换常用模式
  /plan                 输出结构化可选方案
  /plan accept [id]     确认方案并回到 default 执行
  /permissions          查看权限规则
  /permissions add allow|ask|deny <tool|*> [risk]  添加规则
  /permissions remove <id> 删除规则
  /permissions recent   查看最近拒绝
  /permissions recent delete <id> 删除单条最近拒绝
  /permissions recent clear  清空最近拒绝
  /background           查看后台任务一行摘要
  /job                  管理本地 durable job（list/run/pause/resume/cancel/status/logs/report）
  /details              查看 evidence/background/details 摘要
  /agents               查看 agent 状态、transcript 和 usage
  /agents show <id>     查看单个 agent 详情
  /agents cancel <id>   中断单个 agent，不影响主会话
  /fork <类型> <任务>    从裁剪 handoff 派生 explorer/planner/verifier/worker
  /rewind               列出 checkpoint
  /rewind restore <id>  恢复 checkpoint
  /btw <question>       临时插问，不修改 Todo/Plan/checkpoint
  /interrupt            标记当前长任务已取消
  /claim-check <claim>  降级缺少证据的最终结论
  /verify [plan|last|smoke] 生成或运行验证
  /review               按代码审查口径输出风险与建议
  /cache-log            查看最近 cache usage 记录
  /cache-log config size <n>  设置 cache 历史容量
  /cache-log export [path]  导出最近 cache usage 记录
  /cache status         查看 cache 状态与 freshness
  /cache warmup|refresh 尝试预热或刷新 cache
  /break-cache status   查看 cache freshness 变化
  /mcp                  查看 MCP 状态
  /mcp status           查看 MCP server 状态
  /mcp tools            查看稳定排序的 MCP tool 摘要
  /mcp doctor           诊断 MCP server 可用性
  /mcp validate [id]    校验 MCP 来源/信任/启用 metadata
  /mcp add local <id> <command> [args...] 注册本地 MCP command metadata
  /mcp update <id> local <command> [args...] 更新本地 MCP command metadata
  /mcp enable|disable|remove <id> 管理 MCP server 生命周期
  /index status [--fresh] 查看 fast 索引状态；--fresh 才运行 detect_changes
  /index doctor         诊断 bundled/managed codebase-memory runtime
  /index check          显式运行 detect_changes 新鲜度检查
  /index init fast      显式建立 fast 索引
  /index refresh        显式刷新当前项目索引
  /index search <query> 查询索引并写入 evidence
  /index architecture   输出短架构摘要并写入 evidence
  /usage                查看 token/cache usage 汇总
  /stats                查看本地 cache/cost 统计
  /stats endpoints      按 endpoint 聚合 usage
  /read <path>          读取文件
  /write <path> <text>  写入文件
  /edit <path> <old> => <new>  唯一替换
  /multiedit <path> <old> => <new>  批量编辑的最小入口
  /grep <pattern> [path] 搜索文本
  /glob <pattern> [path] 匹配文件
  /bash <command>       执行命令并保存完整日志
  /todo                 查看任务
  /todo add <text>      添加任务
  /todo start|done|block <id> 更新任务状态
  /diff                 显示本轮工具改动摘要
  /exit                 退出

普通输入会发送给当前 provider/model，并写入 JSONL transcript。工具命令也会写入 transcript。`;
}

function slashCommandToTool(command: string): ToolName | null {
  const mapping: Record<string, ToolName> = {
    "/read": "Read",
    "/write": "Write",
    "/edit": "Edit",
    "/multiedit": "MultiEdit",
    "/grep": "Grep",
    "/glob": "Glob",
    "/bash": "Bash",
    "/todo": "Todo",
    "/diff": "Diff",
  };
  return mapping[command] ?? null;
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

type PermissionCheck = {
  request: {
    id: string;
    toolName: ToolName;
    mode: PermissionMode;
    risk: "low" | "medium" | "high";
    summary: string;
    files: string[];
    reason: string;
  };
  decision: "allow" | "ask" | "deny";
  reason: string;
  preflight?: string;
};

async function decidePermission(
  name: ToolName,
  input: unknown,
  context: TuiContext,
  sessionId: string,
): Promise<PermissionCheck> {
  const tool = builtInTools[name];
  const files = collectInputFiles(input);
  const hardDeny = getHardDenyReason(name, input, files, context.projectPath);
  const request = {
    id: randomUUID(),
    toolName: name,
    mode: context.permissionMode,
    risk: tool.permission.risk,
    summary: formatPermissionSummary(name, files, tool.permission.risk),
    files,
    reason: tool.permission.reason,
  };
  if (hardDeny) {
    await recordPermissionDenied(context, name, hardDeny);
    return { request, decision: "deny", reason: hardDeny };
  }

  if (context.permissionMode === "plan") {
    if (isPlanAllowedTool(name, tool.isReadOnly)) {
      return { request, decision: "allow", reason: "Plan 模式允许只读或会话内规划工具。" };
    }
    const reason =
      "Plan 模式禁止写入、编辑和 Bash 执行；请先 /plan accept 确认方案并切回执行模式。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  const rule = findPermissionRule(context.permissions.rules, name, tool.permission.risk);
  if (rule) {
    if (rule.effect === "deny") {
      const reason = `命中 deny 规则：${rule.id}`;
      await recordPermissionDenied(context, name, reason);
      return { request, decision: "deny", reason };
    }
    if (rule.effect === "ask") {
      const reason = `命中 ask 规则：${rule.id}。需要用户确认后才会执行本次工具。`;
      await recordPermissionDenied(context, name, reason);
      return { request, decision: "ask", reason };
    }
    return { request, decision: "allow", reason: `命中 allow 规则：${rule.id}` };
  }

  if (context.permissionMode === "auto-review") {
    if (isLowRiskWorkspaceEdit(name, tool.permission.risk, files)) {
      return {
        request,
        decision: "allow",
        reason: "auto-review 自动允许工作区内低风险文件编辑。",
        preflight: formatDiffBeforeWrite(name, files, tool.permission.risk),
      };
    }
    if (tool.isReadOnly || name === "Todo" || name === "Diff") {
      return { request, decision: "allow", reason: "auto-review 允许只读或会话内工具。" };
    }
    const reason = "auto-review 不自动允许 Bash、高风险或越界操作。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  if (context.permissionMode === "full-access") {
    return {
      request,
      decision: "allow",
      reason: "full-access 已由本地用户显式开启，但硬拒绝和安全路径仍生效。",
      preflight: tool.isReadOnly
        ? undefined
        : formatDiffBeforeWrite(name, files, tool.permission.risk),
    };
  }

  if (tool.isReadOnly || name === "Todo" || name === "Diff") {
    return { request, decision: "allow", reason: "default 模式允许只读或会话内工具。" };
  }
  const reason =
    "default 模式不会静默执行 Bash、写入、编辑、删除、配置、安装、联网或权限变更；需要用户确认后才会执行本次工具。";
  await recordPermissionDenied(context, name, reason);
  return { request, decision: "ask", reason };
}

function isPlanAllowedTool(name: ToolName, isReadOnly: boolean): boolean {
  return isReadOnly || name === "Todo";
}

function isLowRiskWorkspaceEdit(
  name: ToolName,
  risk: "low" | "medium" | "high",
  files: string[],
): boolean {
  return (
    (name === "Write" || name === "Edit" || name === "MultiEdit") &&
    risk === "low" &&
    files.length > 0
  );
}

function collectInputFiles(input: unknown): string[] {
  if (typeof input !== "object" || input === null || !("path" in input)) {
    return [];
  }
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" ? [path.replaceAll("\\", "/")] : [];
}

function getHardDenyReason(
  name: ToolName,
  input: unknown,
  files: string[],
  workspaceRoot: string,
): string | null {
  for (const file of files) {
    const target = resolve(workspaceRoot, file);
    const rel = relative(resolve(workspaceRoot), target);
    if (rel.startsWith("..") || (rel === "" && !builtInTools[name].isReadOnly)) {
      return `路径越界或指向工作区根：${file}。只允许操作当前工作区内明确文件。`;
    }
    const normalized = rel.replaceAll("\\", "/");
    if (normalized.startsWith(".git/") || normalized.includes("/.git/")) {
      return "安全保护：禁止修改 .git 目录。";
    }
    if (
      normalized.includes(".ssh/") ||
      normalized.endsWith(".env") ||
      normalized.includes("secret")
    ) {
      return "安全保护：疑似密钥或敏感路径，需要更高阶段的安全流程处理。";
    }
  }
  if (name === "Bash") {
    const command =
      typeof input === "object" && input !== null ? (input as { command?: unknown }).command : "";
    if (typeof command !== "string" || !command.trim()) {
      return "Bash 命令不能为空。";
    }
    if (
      /(rm\s+-rf|curl\s+[^|]+\|\s*(sh|bash)|wget\s+[^|]+\|\s*(sh|bash)|mkfs|shutdown|reboot)/i.test(
        command,
      )
    ) {
      return "安全保护：拒绝高风险删除、远程脚本执行或系统级命令。";
    }
  }
  return null;
}

function findPermissionRule(
  rules: PermissionRule[],
  name: ToolName,
  risk: "low" | "medium" | "high",
): PermissionRule | undefined {
  return rules.find(
    (rule) =>
      (rule.toolName === "*" || rule.toolName === name) && (!rule.risk || rule.risk === risk),
  );
}

async function recordPermissionDenied(
  context: TuiContext,
  toolName: ToolName,
  reason: string,
): Promise<void> {
  context.permissions.recentDenied.unshift({
    id: randomUUID(),
    toolName,
    mode: context.permissionMode,
    reason,
    createdAt: new Date().toISOString(),
  });
  context.permissions.recentDenied = context.permissions.recentDenied.slice(0, 20);
  await savePermissionState(context.projectPath, context.permissions);
}

function formatPermissionSummary(
  name: ToolName,
  files: string[],
  risk: "low" | "medium" | "high",
): string {
  const targets = files.length === 0 ? "无文件路径" : files.join(", ");
  return `工具 ${name}；目标：${targets}；风险：${risk}`;
}

function formatDiffBeforeWrite(
  name: ToolName,
  files: string[],
  risk: "low" | "medium" | "high",
): string {
  const fileText = files.length === 0 ? "未声明文件" : files.join(", ");
  return `写入前摘要：将执行 ${name}\n将影响文件：${fileText}\n风险：${risk}\n原因：工作区内工具操作；本阶段展示轻量摘要，不生成完整 git hunk。`;
}

function formatPermissionDenied(reason: string, summary: string): string {
  return `权限已拒绝：${reason}\n本次请求：${summary}\n建议：查看 /permissions recent，或切换合适模式后重试。`;
}

function parsePermissionModeInput(value: string): PermissionMode | null {
  if (!isRawPermissionMode(value)) return null;
  return normalizePermissionMode(value);
}

async function loadPermissionState(projectPath: string): Promise<PermissionState> {
  try {
    const raw = await readFile(permissionStatePath(projectPath), "utf8");
    const parsed = JSON.parse(raw) as Partial<PermissionState>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      recentDenied: Array.isArray(parsed.recentDenied) ? parsed.recentDenied : [],
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { rules: [], recentDenied: [] };
    }
    throw error;
  }
}

async function savePermissionState(projectPath: string, state: PermissionState): Promise<void> {
  await mkdir(join(projectPath, ".linghun"), { recursive: true });
  await writeFile(permissionStatePath(projectPath), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function permissionStatePath(projectPath: string): string {
  return join(projectPath, ".linghun", "permissions.json");
}

function formatPermissionRules(state: PermissionState): string {
  if (state.rules.length === 0) {
    return "当前没有持久化权限规则。可用 /permissions add allow|ask|deny <tool|*> [risk] 添加。";
  }
  return state.rules
    .map(
      (rule) => `${rule.id}  ${rule.effect}  ${rule.toolName}${rule.risk ? `  ${rule.risk}` : ""}`,
    )
    .join("\n");
}

function formatRecentDenied(state: PermissionState): string {
  if (state.recentDenied.length === 0) {
    return "最近没有拒绝记录。";
  }
  return state.recentDenied
    .map((item) => `${item.createdAt}  ${item.toolName}  ${item.mode}  ${item.reason}`)
    .join("\n");
}

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

function formatBackgroundTask(task: BackgroundTaskState, language: Language): string {
  const progress = task.progress ? ` ${task.progress.completed}/${task.progress.total ?? "?"}` : "";
  const output = task.hasOutput
    ? (task.logPath ?? "-")
    : language === "en-US"
      ? "no valid output yet"
      : "尚未产生有效输出";
  return language === "en-US"
    ? `[background] ${task.title} · ${task.status} · ${task.currentStep ?? "-"}${progress} · log: ${output} · next: ${task.nextAction ?? "-"}`
    : `[后台] ${task.title} · ${task.status} · ${task.currentStep ?? "-"}${progress} · 日志：${output} · 下一步：${task.nextAction ?? "-"}`;
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
        gate: context.pendingLocalApproval
          ? "waiting approval"
          : context.pendingNaturalCommand
            ? "waiting confirmation"
            : "none",
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

function truncateDisplay(text: string, maxWidth: number): string {
  let width = 0;
  let result = "";
  for (const char of stripAnsi(text)) {
    const charWidth = char.charCodeAt(0) > 0xff ? 2 : 1;
    if (width + charWidth > maxWidth) {
      return `${result}…`;
    }
    width += charWidth;
    result += char;
  }
  return result;
}

function stripAnsi(text: string): string {
  const escapeChar = String.fromCharCode(27);
  return text.replace(new RegExp(`${escapeChar}\\[[0-9;]*m`, "g"), "");
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
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

function formatError(error: unknown, language: Language = "zh-CN"): string {
  if (error instanceof Error && "suggestion" in error && typeof error.suggestion === "string") {
    return language === "en-US"
      ? `Error: ${error.message}\nSuggestion: ${error.suggestion}`
      : `错误：${error.message}\n建议：${error.suggestion}`;
  }
  if (error instanceof Error) {
    return language === "en-US" ? `Error: ${error.message}` : `错误：${error.message}`;
  }
  return language === "en-US" ? "Error: unknown error." : "错误：未知错误。";
}

function writeLine(output: Writable, text: string): void {
  output.write(`${text}\n`);
}
