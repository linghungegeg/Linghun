// Module 1: tui-data-types
// Pure type declarations extracted from packages/tui/src/index.ts as part of
// the D.13 mechanical split. Behavior is unchanged. TuiContext deliberately
// stays in index.ts because ~60 downstream files import it from "../index.js".
// All types here are re-exported from index.ts so existing consumers keep
// working unchanged.

import type {
  ModelCapability,
  ModelRole,
  RemoteChannelConfig,
  RemoteEventType,
  RoleModelRoute,
} from "@linghun/config";
import type { CacheFreshness, CacheTurnStats } from "@linghun/core";
import type { PermissionMode } from "@linghun/shared";
import type { DiffSummary, TodoItem, ToolName } from "@linghun/tools";
import type { ArchitectureCardSummary } from "./architecture-runtime.js";
import type {
  CacheRequestObservation,
  CacheRequestShapeLatch,
  CacheSafePrefixSnapshot,
} from "./cache-policy-runtime.js";
import type { CompactBoundary } from "./compact-context.js";
import type {
  EngineeringFailureCategory,
  EngineeringTaskProfile,
} from "./headless-bench-runtime.js";
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
  | "blocked"
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
  completedAt?: string;
  lastOutputAt?: string;
  estimatedRemainingMs?: number;
  heartbeatIntervalMs: number;
  staleAfterMs: number;
  logPath?: string;
  outputPath?: string;
  workflowRunId?: string;
  hasOutput: boolean;
  result?: "pass" | "fail" | "partial" | "cancelled" | "timeout" | "stale";
  cancelState?: "abort_signal_sent" | "marked_stale" | "confirmed_exited";
  cancelRequestedAt?: string;
  confirmedExitedAt?: string;
  userVisibleSummary: string;
  nextAction?: string;
};

export type WorkflowStepState = {
  id: string;
  title: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "partial"
    | "failed"
    | "blocked"
    | "cancelled"
    | "stale";
  runtime: "agent" | "job" | "verification" | "details";
  summary?: string;
  evidenceRefs: string[];
  dependsOnSliceIds?: string[];
  independent?: boolean;
  canRunInParallel?: boolean;
  batchId?: string;
  startedAt?: string;
  endedAt?: string;
};

export type CheckpointState = {
  id: string;
  sessionId: string;
  createdAt: string;
  reason: string;
  changedFiles: string[];
  restoreKind: "git" | "snapshot";
  restorable?: boolean;
  restoreUnavailableReason?: string;
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
  data?: unknown;
};

export type VerificationStepKind = "test" | "typecheck" | "build" | "lint" | "smoke";

export type VerificationStep = {
  kind: VerificationStepKind;
  command: string;
  reason: string;
  // D.14A-R-Fix P1-2 — true 表示这是 Linghun 自动生成的合成 smoke（如
  // `node -e "console.log(...)"` 或无脚本时的 `node --version` 降级），只能证明
  // 本地 Node 进程可运行，不能当作真实 provider/TUI/render/report 主链 smoke。
  // readiness 分级器据此拒绝把合成 smoke pass 升级为 real-smoke。
  synthetic?: boolean;
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
  lastRequestObservation?: CacheRequestObservation;
  lastRequestObservationByKind?: Partial<
    Record<CacheRequestObservation["kind"], CacheRequestObservation>
  >;
  cacheRequestShapeLatch?: CacheRequestShapeLatch;
  lastCacheSafePrefix?: CacheSafePrefixSnapshot;
  lastCacheSafePrefixSkipReason?: string;
  hintLastShownAt: Record<string, number>;
  compacted: boolean;
  compactBoundaries: CompactBoundary[];
  compactProjection?: CompactProjection;
  compactStrategy?: CompactStrategySnapshot;
  deepCompact?: DeepCompactPacket;
  compactPressure?: CompactPressureSnapshot;
  compactFailure?: CompactFailureState;
  compactCooldownUntil?: number;
  deepCompactCooldownUntil?: number;
  workspaceReference: WorkspaceReferenceCache;
  startedAt: number;
};

export type CompactProjection = {
  boundaryId: string;
  createdAt: string;
  summary: string;
  windowId?: string;
  replacementKind?: "provider-visible";
  replacedMessageCount?: number;
  replacementMessageCount?: number;
  terminalVisibleBeforeCount?: number;
  terminalVisibleAfterCount?: number;
  pressureRatio: number;
  preCompactChars: number;
  postCompactChars: number;
  postCompactTargetChars?: number;
  savingsRatio?: number;
  discardedRange: string;
  toolPairingSafe: boolean;
  risks: string[];
  evidenceRefs: string[];
};

export type CompactStrategyLayer = "payload_trim" | "semantic_deep" | "full_summary" | "reactive";

export type CompactStrategyStep = {
  layer: CompactStrategyLayer;
  status: "skipped" | "applied" | "failed";
  reason: string;
  beforeChars: number;
  afterChars: number;
};

export type CompactPreflightTrigger = DeepCompactTrigger | "reactive";

export type CompactStrategySnapshot = {
  trigger: CompactPreflightTrigger;
  createdAt: string;
  contextMaxChars: number;
  triggerChars: number;
  postCompactTargetChars: number;
  finalChars: number;
  cacheStablePrefixRisk: "low" | "medium" | "high";
  steps: CompactStrategyStep[];
};

export type DeepCompactTrigger =
  | "manual"
  | "request"
  | "continuation"
  | "final"
  | "agent-child"
  | "workflow";

export type DeepCompactPacket = {
  id: string;
  kind: "deep";
  scope: "full transcript semantic compact";
  summary: string;
  preservedEvidenceRefs: string[];
  preservedFiles: string[];
  activeAgentsWorkflows: string[];
  needsAttentionAgentsWorkflows?: string[];
  staleResumableAgentsWorkflows?: string[];
  pendingItems: string[];
  decisions: string[];
  risks: string[];
  createdAt: string;
  model: string;
  provider: string;
  trigger: DeepCompactTrigger;
  transcriptEventCount: number;
};

export type CompactPressureSnapshot = {
  estimatedChars: number;
  maxChars: number;
  triggerChars: number;
  ratio: number;
  toolPairingSafe: boolean;
  updatedAt: string;
};

export type CompactFailureState = {
  at: string;
  reason: string;
  blocked: boolean;
  cooldownUntil: string;
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

export type AgentMailboxMessage = {
  id: string;
  from: "user" | "model" | "workflow" | "system";
  to: string;
  text: string;
  createdAt: string;
  status: "pending" | "consumed" | "failed";
  summary: string;
  kind?: "message" | "task";
  taskId?: string;
  consumedAt?: string;
  failedAt?: string;
  error?: string;
};

export type AgentSharedTask = {
  id: string;
  summary: string;
  assignedBy: AgentMailboxMessage["from"];
  assignedAt: string;
  status: "assigned" | "running" | "blocked" | "completed" | "cancelled";
  messageId?: string;
  completedAt?: string;
  resultSummary?: string;
};

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

export type AgentCompletionStatus = "completed" | "failed" | "blocked" | "cancelled" | "stale";

export type AgentCompletionValidity = "valid" | "partial" | "invalid";

export type AgentCompletionNotice = {
  id: string;
  agentId: string;
  agentType: AgentType;
  agentRole: ModelRole;
  displayName?: string;
  teamName?: string;
  parentSessionId?: string;
  workflowRunId?: string;
  task: string;
  status: AgentCompletionStatus;
  validity: AgentCompletionValidity;
  summary: string;
  evidenceRefs: string[];
  nextAction: string;
  createdAt: string;
  updatedAt: string;
  reportedAt?: string;
};

export type AgentCompletionBatchSummary = {
  id: string;
  scopeKey: string;
  teamName?: string;
  parentSessionId?: string;
  workflowRunId?: string;
  total: number;
  valid: number;
  partial: number;
  invalid: number;
  completed: number;
  failed: number;
  blocked: number;
  stale: number;
  cancelled: number;
  evidenceRefs: string[];
  summary: string;
  createdAt: string;
};

export type AgentCompletionState = {
  notices: AgentCompletionNotice[];
  batchSummaries: AgentCompletionBatchSummary[];
  lastNotificationAt: Record<string, number>;
  reportedNoticeIds: string[];
};

export type AgentRun = {
  id: string;
  type: AgentType;
  displayName?: string;
  addressableName?: string;
  teamName?: string;
  role: ModelRole;
  provider: string;
  parentSessionId?: string;
  forkedFrom?: string;
  task: string;
  engineeringSignal?: EngineeringSignalSnapshot;
  model: string;
  registryAgentId?: string;
  allowedTools?: ToolName[];
  maxTurns?: number;
  permissionMode: PermissionMode;
  status: "running" | "idle" | "completed" | "failed" | "blocked" | "cancelled" | "stale";
  lastTerminalStatus?: "completed" | "failed" | "blocked";
  activityStatus?:
    | "processing"
    | "idle"
    | "waiting_mailbox"
    | "blocked"
    | "cancelled"
    | "completed";
  activitySummary?: string;
  activeTask?: AgentSharedTask;
  lastResultSummary?: string;
  lastResultFullReport?: string;
  transcriptPath: string;
  transcriptSessionId: string;
  mailbox: AgentMailboxMessage[];
  cwd?: string;
  isolation?: "worktree";
  cancelTokenId?: string;
  heartbeatAt?: string;
  staleReason?: string;
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

export type EngineeringSignalSnapshot = {
  profile: EngineeringTaskProfile;
  strategyHint?: string;
  artifactTargets?: string[];
  failureCategory?: EngineeringFailureCategory;
  finalBoundaryHint?: string;
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
  | "skipped"
  | "budget_limited"
  | "resource_limited"
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
  task?: string;
  status: DurableJobAgentStatus;
  runId?: string;
  statusReason?: string;
  budgetTokens: number;
  owner?: string;
  heartbeatAt?: string;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  resultSummary?: string;
  resultFullReport?: string;
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
    // P1-5 — 仅当用户显式设置时为 true；未设置时 /job 无用户可见预算，
    // enforcement 不触发，UI 显示"预算：未设置"。缺省（旧 state.json）按未设置处理。
    explicit?: { tokens?: boolean; steps?: boolean; runtime?: boolean };
  };
  effectiveAgentCap?: number;
  capReason?: string;
  timeoutMs: number;
  permissionPolicy: PermissionMode;
  allowEdit: boolean;
  allowBash: boolean;
  allowMultiAgent: boolean;
  isolation?: "worktree";
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

export type RemoteEventStatus =
  | "pending"
  | "sent"
  | "failed"
  | "expired"
  | "rejected"
  | "approved"
  | "blocked"
  | "mock";
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
  // D.14E — 脱敏后的投递结果说明（不含 endpoint/secret/payload）；webhook_mock
  // 恒标注为 diagnostic mock，不代表真实 delivery PASS。
  deliveryDetail?: string;
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

// D.14E — 远程入站消息模型。手机端只能回传以下三类，全部先进入本地校验，再交回
// 本地主链/权限管道；远程端永不直接执行工具/Bash/写文件/Git。
export type RemoteInboundKind = "approval_response" | "natural_language_message" | "status_query";

export type RemoteInboundMessage = {
  kind: RemoteInboundKind;
  channel: string;
  messageId: string;
  nonce: string;
  source: string;
  bindingUserId: string;
  bindingDeviceId?: string;
  signature?: string;
  // 入站消息自带过期时间（手机端发起，无对应出站 nonce 时用它做时效校验）。
  expiresAt: string;
  receivedAt?: string;
  origin?: "fixture" | "adapter";
  // approval_response：引用此前发出的 approval_request event id 并回显 nonce。
  eventId?: string;
  approve?: boolean;
  // natural_language_message：手机端自然语言原文，原样进入本地模型主链。
  text?: string;
};

export type RemoteInboundStatus =
  | "accepted"
  | "approved"
  | "rejected"
  | "expired"
  | "unknown_source"
  | "wrong_binding"
  | "bad_signature"
  | "replayed"
  | "channel_not_ready"
  | "inbound_disabled"
  | "no_pending_approval"
  | "blocked";

export type RemoteInboundDecision = {
  kind: RemoteInboundKind;
  status: RemoteInboundStatus;
  summary: string;
  // natural_language_message accepted 时携带原文，由 index.ts glue 交给本地主链。
  routedText?: string;
  evidenceCreated: false;
};

export type RemotePairingState = {
  code: string;
  channel: string;
  source: string;
  projectPath: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  consumedMessageIds: string[];
  status: "pending" | "bound" | "expired" | "cancelled";
};

export type RemoteInboxItem = {
  id: string;
  channel: string;
  messageId: string;
  source: string;
  bindingUserId: string;
  text: string;
  priority: "normal" | "interrupt";
  reason: string;
  createdAt: string;
  sessionId?: string;
};

export type RemoteState = {
  enabled: boolean;
  channels: RemoteChannelState[];
  events: RemoteEvent[];
  processedMessageIds: string[];
  sessionDisabledChannelIds: string[];
  pairings: RemotePairingState[];
  inbox: RemoteInboxItem[];
  localReplBridge?: import("./remote-repl-bridge-runtime.js").ReplBridgeState;
  localReplBridgeSocket?: import("./remote-repl-bridge-runtime.js").ReplBridgeSocketServer;
  lastDoctor?: string;
  lastApproval?: RemoteApprovalDecision;
};

export type MemoryScope = "project" | "user" | "session";
export type MemoryStatus = "candidate" | "accepted" | "rejected" | "disabled" | "retired";
export type MemoryTaxonomy = "user" | "feedback" | "project" | "reference";

export type MemoryCandidate = {
  id: string;
  scope: MemoryScope;
  status: MemoryStatus;
  taxonomy?: MemoryTaxonomy;
  topic?: string;
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
  acceptedCreated?: number;
  acceptedUpdated?: number;
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
  projectRulesIncludedPaths?: string[];
  projectRulesWarnings?: string[];
  projectRulesTruncated?: boolean;
  projectDir: string;
  userDir: string;
  sessionDir: string;
  candidates: MemoryCandidate[];
  accepted: MemoryCandidate[];
  rejected: MemoryCandidate[];
  disabled: MemoryCandidate[];
  retired: MemoryCandidate[];
  learningMode: MemoryLearningMode;
  learningModeSource?: "default" | "persisted";
  lastLearningRun?: MemoryLearningRun;
  lastHandoff?: HandoffPacket;
  lastResumeReadonly?: boolean;
};

// D.14B Failure Learning — 从真实失败事件（provider/tool/verification/git/final
// gate/report guard/resource cap）提取的可复用教训。与 D.14B 受控记忆学习
// （从用户输入提取偏好）是两套独立系统，互不复用。所有字段均为脱敏后内容，
// 绝不持久化 secret/apiKey/baseUrl/token/Authorization/完整 env/长绝对路径。
export type FailureLearningCategory =
  | "provider_failure"
  | "tool_failure"
  | "verification_failure"
  | "git_operation_failure"
  | "final_gate_downgrade"
  | "report_guard"
  | "resource_cap";

export type FailureLearningSeverity = "low" | "medium" | "high";
export type FailureLearningStatus = "active" | "resolved" | "ignored";

export type FailureLearningRecord = {
  id: string;
  createdAt: string;
  lastSeen: string;
  // 项目作用域键（脱敏后的项目名/根标识），用于只投影当前项目的教训。
  projectScope: string;
  // 触发本记录的来源事件标识（evidence id / event 标识），仅引用不含正文。
  sourceRef: string;
  category: FailureLearningCategory;
  // 脱敏后的短失败摘要。
  failureSummary: string;
  // 推断的根因，必须标记 inferred=true 且只能基于 evidence。
  rootCauseGuess: string;
  inferred: boolean;
  // 可执行、短的"下次避免"提示（脱敏）。
  avoidNextTime: string;
  // 关联的命令/工具/provider/git 操作（脱敏，可空）。
  relatedTarget?: string;
  severity: FailureLearningSeverity;
  // 去重 hash：基于脱敏后的 category + source/target + 归一化 message。
  dedupeHash: string;
  count: number;
  status: FailureLearningStatus;
};

export type FailureLearningState = {
  // 存储目录（项目作用域）：<project>/.linghun/failures
  directory: string;
  projectScope: string;
  records: FailureLearningRecord[];
  degradedWarnings: string[];
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

export type WorkflowRunState = {
  id: string;
  goal: string;
  planId: string;
  status: "running" | "completed" | "partial" | "failed" | "blocked" | "cancelled" | "stale";
  steps: WorkflowStepState[];
  startedAt: string;
  endedAt?: string;
  result: "partial" | "failed" | "blocked" | "cancelled" | "stale";
  engineeringSignal?: EngineeringSignalSnapshot;
  /** Set to true when the user explicitly invoked /workflows run. */
  phaseGateConfirmed?: boolean;
  confirmedPhaseStopPoints?: string[];
  /** True when this workflow wraps a multi-agent collaboration request. */
  multiAgent?: boolean;
};

export type WorkflowState = {
  enabled: boolean;
  templates: WorkflowTemplate[];
  disabledIds: string[];
  lastStarted?: string;
  activeRuns?: WorkflowRunState[];
  activeRun?: WorkflowRunState;
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
  kind?: string;
  provider: string;
  model: string;
  endpointProfile: string;
  endpointSummary?: string;
  httpStatus?: number;
  contentType?: string;
  summary: string;
  evidenceId: string;
  createdAt: string;
};

export type ProviderFallbackAttemptSummary = {
  fromProvider: string;
  fromModel: string;
  toProvider: string;
  toModel: string;
  reasonKind: string;
  reasonCode: string;
  status: "attempted" | "succeeded" | "failed";
  summary: string;
  createdAt: string;
};
