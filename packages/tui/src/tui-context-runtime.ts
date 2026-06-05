import type { LinghunConfig } from "@linghun/config";
import type { SessionStore } from "@linghun/core";
import type { ModelGateway, ModelMessage, ModelToolCall } from "@linghun/providers";
import type { Language, PermissionMode } from "@linghun/shared";
import type { ToolContext, ToolName } from "@linghun/tools";
import type {
  RegistryAgentDefinition,
  RegistryWorkflowDefinition,
} from "./agent-workflow-registry.js";
import type { BoundaryEditPreflightResult } from "./architecture-boundary.js";
import type { ArchitectureCard } from "./architecture-runtime.js";
import type { IndexState } from "./index-runtime.js";
import type { MemoryMutation } from "./memory-command-runtime.js";
import type { SolutionCompletenessStatus } from "./model-loop-runtime.js";
import type { PendingModelSetup } from "./model-setup-runtime.js";
import type { PendingNaturalCommand } from "./natural-command-bridge.js";
import type { SLASH_COMMAND_REGISTRY } from "./natural-command-bridge.js";
import type { PermissionState, ReportWriteGuard } from "./permission-continuation-runtime.js";
import type { ProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import type { RequestActivityPhase } from "./request-lifecycle-presenter.js";
import {
  LINGHUN_MAX_AGENTIC_TURNS,
  LINGHUN_MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES,
  LINGHUN_MAX_TODO_ONLY_CONSECUTIVE_ROUNDS,
} from "./runtime-budget.js";
import type { ConfigPanelId } from "./shell/models/config-control-plane.js";
import type { ProductBlockViewModel } from "./shell/types.js";
import type { ToolResultBudgetState } from "./tool-result-budget.js";
import type {
  AgentRun,
  BackgroundTaskState,
  CacheState,
  CheckpointState,
  EvidenceRecord,
  FailureLearningState,
  HookState,
  ImageGenerationResult,
  McpState,
  MemoryCandidate,
  MemoryState,
  PlanProposal,
  PluginState,
  ProviderFailureSummary,
  ProviderFallbackAttemptSummary,
  RemoteState,
  RoleHandoff,
  RoleRouteDecision,
  RoleUsage,
  SkillState,
  VerificationReport,
  VisionObservation,
  WorkflowState,
  WorkflowTemplate,
} from "./tui-data-types.js";
import type { SelectedModelRuntime } from "./tui-model-runtime.js";
import { formatReasoningEffectiveState } from "./tui-model-runtime.js";

type PendingIndexSafetyRepairPlan = {
  path: ".linghunignore" | ".cbmignore";
  content: string;
  expectedHash?: string;
  missingEntries: string[];
};

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

export type PendingAutopilotRequest = {
  goal: string;
  maxSteps: number;
  maxTokens: number;
  timeoutMs: number;
  allowEdit: boolean;
  allowBash: boolean;
  createdAt: string;
};

export type BreakCacheMutationAction = "always" | "clear" | "off" | "once";

export type PendingLocalApproval =
  | {
      kind: "index_ignore_write";
      plan: PendingIndexSafetyRepairPlan;
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

export function runtimeFromContinuation(
  continuation: PendingModelContinuation,
): SelectedModelRuntime {
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

export function createSingleToolCallContinuation(
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
  /** meta-scheduler failure-learning contract tracking */
  lastMetaSchedulerFailureLearningRequired?: boolean;
  lastMetaSchedulerFailureLearningFulfilled?: boolean;
  /** most recent tool failure captured for meta-scheduler input */
  lastToolFailure?: { toolName: string; summary: string };
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

export const VERIFICATION_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export const MIN_CACHE_HISTORY_SIZE = 1;
export const MAX_CACHE_HISTORY_SIZE = 200;
export const DEFAULT_LIGHT_HINT_COOLDOWN_MS = 5 * 60 * 1000;
export const MAX_LIGHT_HINTS_PER_TURN = 1;
export const MAX_TODO_ONLY_CONSECUTIVE_ROUNDS = LINGHUN_MAX_TODO_ONLY_CONSECUTIVE_ROUNDS;
export const MAX_MODEL_TOTAL_TOOL_ROUNDS = LINGHUN_MAX_AGENTIC_TURNS;
export const MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES = LINGHUN_MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES;
export const CODEBASE_MEMORY_COMMAND = "codebase-memory-mcp";
export const CODEBASE_MEMORY_ENV = "LINGHUN_CODEBASE_MEMORY_MCP";
export const PROJECT_RULES_STATUS_WIDTH = 160;
export const MEMORY_PROMPT_TOP_K = 3;
export const MEMORY_PROMPT_ITEM_WIDTH = 180;
export const MEMORY_PROMPT_TOTAL_WIDTH = 720;
export const MAX_CONTEXT_MESSAGES = 12;
export const REQUEST_SLOW_HINT_MS = 20_000;
export const MAX_EVIDENCE_RECORDS = 50;
export const MAX_BACKGROUND_TASKS = 50;
export const WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT = 8;
export const BACKGROUND_RUNNING_GLOBAL_CAP = 4;
export const BACKGROUND_KIND_CAPS: Partial<Record<BackgroundTaskState["kind"], number>> = {
  bash: 1,
  verification: 1,
  index: 1,
  agent: 3,
  job: 1,
};
export const MAX_CHECKPOINTS = 20;
export const MAX_ROUTE_DECISIONS = 50;

// D.14G-Refactor-Closure composition root：注入 index.ts hoisted 函数到迁出的 git 模块。
