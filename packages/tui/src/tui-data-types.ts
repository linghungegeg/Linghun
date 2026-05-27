// Module 1: tui-data-types
// Pure type declarations extracted from packages/tui/src/index.ts as part of
// the D.13 mechanical split. Behavior is unchanged. TuiContext deliberately
// stays in index.ts because ~60 downstream files import it from "../index.js".
// All types here are re-exported from index.ts so existing consumers keep
// working unchanged.

import type { CacheFreshness, CacheTurnStats } from "@linghun/core";
import type {
  ModelCapability,
  ModelRole,
  RemoteChannelConfig,
  RemoteEventType,
  RoleModelRoute,
} from "@linghun/config";
import type { PermissionMode } from "@linghun/shared";
import type { DiffSummary, TodoItem } from "@linghun/tools";
import type { ArchitectureCardSummary } from "./architecture-runtime.js";
import type { CompactBoundary } from "./compact-context.js";
import type { IndexState } from "./index-runtime.js";
import type { SolutionCompletenessStatus } from "./model-loop-runtime.js";
import type { WorkspaceReferenceCache } from "./workspace-reference-cache.js";

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
  priority: number;
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

export type ResolvedRoleRoute = {
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
  displayName?: string;
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
  displayName?: string;
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

export type MemoryLearningMode = "off" | "active";

export type MemoryLearningCategory =
  | "preference"
  | "frequent_behavior"
  | "project_habit"
  | "collaboration_rule";

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
  learningMode: MemoryLearningMode;
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

export type ProviderFailureSummary = {
  code: string;
  provider: string;
  model: string;
  endpointProfile: string;
  summary: string;
  evidenceId: string;
  createdAt: string;
};
