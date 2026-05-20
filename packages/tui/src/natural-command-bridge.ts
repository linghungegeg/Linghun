import { randomUUID } from "node:crypto";
import type { Language, PermissionMode } from "@linghun/shared";

export type CommandRisk =
  | "readonly"
  | "start_gate"
  | "config_write"
  | "tool_permission"
  | "dangerous";

export type CommandCapability = {
  id: string;
  slash: string;
  aliases: string[];
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  whenToUseZh: string;
  whenToUseEn: string;
  risk: CommandRisk;
  readonly: boolean;
  modelInvocable: boolean;
  userInvocable: boolean;
  requiresStartGate: boolean;
  writesConfig: boolean;
  entersPermissionPipeline: boolean;
  bridgeSafe: boolean;
  hiddenReason?: string;
};

export type NaturalIntentAction =
  | "answer"
  | "execute_readonly"
  | "safe_local_action"
  | "start_gate"
  | "permission_pipeline"
  | "ask_clarify"
  | "model";

export type NaturalIntent = {
  action: NaturalIntentAction;
  capability?: CommandCapability;
  confidence: number;
  command?: string;
  reason: string;
  candidates: CommandCapability[];
  language: Language;
  inquiry: "status" | "doctor" | "read" | "usage" | "risk" | "howto" | "execute";
  riskHandler: CommandRisk | "safe_local_action" | "model" | "clarify";
};

export type RuntimeStatusForModel = {
  memory: {
    linghunMd: "found" | "missing" | "unreadable";
    candidates: number;
    accepted: number;
    autoAccept: boolean;
  };
  index: { status: string; changedFiles: number | null };
  cache: { latestHitRate: number | null; changedKeys: string[] };
  model: { provider: string; name: string };
  permissionMode: PermissionMode;
  extensions: {
    skills: { enabled: boolean; count: number };
    plugins: { enabled: boolean; count: number };
    hooks: { enabled: boolean; count: number };
  };
};

export type RuntimeStatusSource = {
  model: string;
  provider?: string;
  permissionMode: PermissionMode;
  projectPath: string;
  language: Language;
  memory: {
    projectRulesExists: boolean;
    projectRulesError?: string;
    candidates: unknown[];
    accepted: unknown[];
  };
  index: { status: string; changedFiles?: number };
  cache: {
    history: { hitRate: number | null; freshness?: { changedKeys?: string[] } }[];
    lastFreshness?: { changedKeys?: string[] };
  };
  skills: { enabled: boolean; skills: unknown[] };
  plugins: { enabled: boolean; plugins: unknown[] };
  hooks: { enabled: boolean; hooks: unknown[] };
};

export type PendingNaturalCommand = {
  gateId: string;
  capabilityId: string;
  source: "natural";
  exactCommand: string;
  command: string;
  risk: CommandRisk;
  scope: string;
  createdAt: string;
  expiresAt: string;
  requiresExactConfirmation: boolean;
};

export type SlashCommandRegistryEntry = {
  slash: string;
  capabilityId: string;
  userVisible: boolean;
  hiddenReason?: string;
};

export const SLASH_COMMAND_REGISTRY: SlashCommandRegistryEntry[] = [
  { slash: "/help", capabilityId: "help", userVisible: true },
  { slash: "/features", capabilityId: "features", userVisible: true },
  { slash: "/language", capabilityId: "language", userVisible: true },
  { slash: "/model", capabilityId: "model", userVisible: true },
  { slash: "/vision", capabilityId: "vision", userVisible: true },
  { slash: "/image", capabilityId: "image", userVisible: true },
  { slash: "/skills", capabilityId: "skills", userVisible: true },
  { slash: "/workflows", capabilityId: "workflows", userVisible: true },
  { slash: "/plugins", capabilityId: "plugins", userVisible: true },
  { slash: "/doctor", capabilityId: "hooks", userVisible: true },
  { slash: "/sessions", capabilityId: "sessions", userVisible: true },
  { slash: "/resume", capabilityId: "resume", userVisible: true },
  { slash: "/branch", capabilityId: "branch", userVisible: true },
  { slash: "/memory", capabilityId: "memory", userVisible: true },
  { slash: "/mode", capabilityId: "mode", userVisible: true },
  { slash: "/tab", capabilityId: "tab", userVisible: true },
  { slash: "/plan", capabilityId: "plan", userVisible: true },
  { slash: "/permissions", capabilityId: "permissions", userVisible: true },
  { slash: "/background", capabilityId: "background", userVisible: true },
  { slash: "/details", capabilityId: "details", userVisible: true },
  { slash: "/agents", capabilityId: "agents", userVisible: true },
  { slash: "/fork", capabilityId: "fork", userVisible: true },
  { slash: "/rewind", capabilityId: "rewind", userVisible: true },
  { slash: "/btw", capabilityId: "btw", userVisible: true },
  { slash: "/interrupt", capabilityId: "interrupt", userVisible: true },
  { slash: "/claim-check", capabilityId: "claim-check", userVisible: true },
  { slash: "/verify", capabilityId: "verify", userVisible: true },
  { slash: "/review", capabilityId: "review", userVisible: true },
  { slash: "/cache-log", capabilityId: "cache-log", userVisible: true },
  { slash: "/cache", capabilityId: "cache", userVisible: true },
  { slash: "/break-cache", capabilityId: "break-cache", userVisible: true },
  { slash: "/mcp", capabilityId: "mcp", userVisible: true },
  { slash: "/index", capabilityId: "index", userVisible: true },
  { slash: "/usage", capabilityId: "usage", userVisible: true },
  { slash: "/stats", capabilityId: "stats", userVisible: true },
  { slash: "/read", capabilityId: "read", userVisible: true },
  { slash: "/write", capabilityId: "write", userVisible: true },
  { slash: "/edit", capabilityId: "edit", userVisible: true },
  { slash: "/multiedit", capabilityId: "multiedit", userVisible: true },
  { slash: "/grep", capabilityId: "grep", userVisible: true },
  { slash: "/glob", capabilityId: "glob", userVisible: true },
  { slash: "/bash", capabilityId: "bash", userVisible: true },
  { slash: "/todo", capabilityId: "todo", userVisible: true },
  { slash: "/diff", capabilityId: "diff", userVisible: true },
  { slash: "/exit", capabilityId: "exit", userVisible: true },
  {
    slash: "/status",
    capabilityId: "status",
    userVisible: false,
    hiddenReason: "status bar is emitted automatically",
  },
] as const;

const USER_VISIBLE_SLASH_COMMANDS = SLASH_COMMAND_REGISTRY.filter((item) => item.userVisible).map(
  (item) => item.slash,
);

const COMMAND_CAPABILITY_DATA: CommandCapability[] = [
  cap(
    "help",
    "/help",
    ["help", "帮助", "commands"],
    "帮助",
    "Help",
    "显示命令清单。",
    "Shows the command list.",
    "了解可用命令或自然语言桥能力。",
    "Use for available commands or bridge capabilities.",
    "readonly",
  ),
  cap(
    "features",
    "/features",
    ["features", "feature policy", "功能开关", "默认功能"],
    "功能策略",
    "Feature policy",
    "显示默认功能策略、推荐底座、高级/危险/未支持边界。",
    "Shows default feature policy, recommended foundation, advanced/dangerous/unsupported boundaries.",
    "核对默认功能开关、自动执行边界和权限风险。",
    "Use to audit default feature switches, auto-run boundaries, and permission risk.",
    "readonly",
  ),
  cap(
    "language",
    "/language",
    ["语言", "language"],
    "语言",
    "Language",
    "查看或切换界面语言。",
    "Shows or switches UI language.",
    "需要中英文体验跟随偏好时使用。",
    "Use when changing Chinese/English UI preference.",
    "config_write",
    { writesConfig: true },
  ),
  cap(
    "model",
    "/model",
    ["模型", "provider", "route", "what model", "current model"],
    "模型",
    "Model",
    "查看当前模型与角色路由；切换路由需要确认。",
    "Shows current model and role routes; route changes need confirmation.",
    "询问当前模型、provider、模型风险或路由。",
    "Use for current model, provider, or model routing questions.",
    "start_gate",
  ),
  cap(
    "vision",
    "/vision",
    ["vision", "图片", "image input"],
    "视觉输入",
    "Vision",
    "记录图片观察证据，不直接写代码。",
    "Records vision evidence without direct code writes.",
    "需要基于图片路径生成 evidence。",
    "Use for image-path evidence capture.",
    "start_gate",
  ),
  cap(
    "image",
    "/image",
    ["generate image", "生成图片"],
    "图片生成",
    "Image",
    "生成本地图片资产 metadata。",
    "Generates local image asset metadata.",
    "需要图片角色生成资产。",
    "Use for image-role asset generation.",
    "start_gate",
  ),
  cap(
    "skills",
    "/skills",
    ["skill", "skills", "技能", "能力"],
    "技能",
    "Skills",
    "列出本地 skill 摘要；启用第三方 skill 不直通。",
    "Lists local skill summaries; enabling third-party skills is not direct.",
    "查看技能是否启用、有什么技能、如何注册技能。",
    "Use to inspect skills or local registration paths.",
    "start_gate",
  ),
  cap(
    "workflows",
    "/workflows",
    ["workflow", "workflows", "工作流", "bug-fix", "bug fix"],
    "工作流",
    "Workflows",
    "列出工作流模板；启动模板只展示 Start Gate。",
    "Lists workflow templates; starting one only shows a Start Gate.",
    "想知道有哪些工作流或启动 bug-fix/review 模板。",
    "Use to discover or start bug-fix/review workflows.",
    "start_gate",
  ),
  cap(
    "plugins",
    "/plugins",
    ["plugin", "plugins", "插件"],
    "插件",
    "Plugins",
    "列出本地 plugin manifest 与诊断；启用第三方 plugin 不直通。",
    "Lists local plugin manifests and doctor output; third-party enable is not direct.",
    "查看插件状态、贡献项、加载错误和信任边界。",
    "Use for plugin state, contributions, load errors, and trust boundaries.",
    "start_gate",
  ),
  cap(
    "hooks",
    "/doctor",
    ["hook", "hooks", "钩子", "doctor hooks"],
    "Hooks 诊断",
    "Hooks doctor",
    "诊断 hooks 是否开启、来源、timeout、日志和权限边界；启用或执行 hook 不直通。",
    "Diagnoses hook enablement, sources, timeout, logs, and permission boundary; hook enable/run is not direct.",
    "询问 hook 开没开或 hook 风险。",
    "Use when asking whether hooks are enabled or risky.",
    "start_gate",
  ),
  cap(
    "sessions",
    "/sessions",
    ["sessions", "session list", "会话", "历史会话"],
    "会话列表",
    "Sessions",
    "列出当前项目会话。",
    "Lists project sessions.",
    "查看历史会话或恢复入口。",
    "Use to inspect session history and resume options.",
    "readonly",
  ),
  cap(
    "resume",
    "/resume",
    ["resume", "恢复", "continue", "last session"],
    "恢复会话",
    "Resume",
    "从结构化 handoff 恢复会话，不注入完整 transcript。",
    "Resumes from structured handoff without full transcript injection.",
    "想恢复上次会话。",
    "Use to resume a prior session after a Start Gate.",
    "start_gate",
  ),
  cap(
    "branch",
    "/branch",
    ["branch", "分支", "branch session"],
    "分支会话",
    "Branch session",
    "基于 handoff 创建分支会话。",
    "Creates a branch session from handoff.",
    "想试验另一条思路。",
    "Use to try an alternate path after a Start Gate.",
    "start_gate",
  ),
  cap(
    "memory",
    "/memory",
    ["memory", "记忆", "自动记忆", "linghun.md"],
    "记忆",
    "Memory",
    "查看 LINGHUN.md、候选记忆、已接受记忆和存储路径。",
    "Shows LINGHUN.md, candidate/accepted memories, and storage paths.",
    "询问记忆是否开启、记忆数量、审查或存储。",
    "Use for memory status, review, and storage questions.",
    "start_gate",
  ),
  cap(
    "mode",
    "/mode",
    ["mode", "权限模式", "permission mode", "bypass"],
    "权限模式",
    "Permission mode",
    "查看或切换权限模式；bypass 不能自然语言直通。",
    "Shows or switches permission mode; bypass is never natural-language direct.",
    "询问当前权限模式或想切换模式。",
    "Use for current permission mode or switching mode.",
    "start_gate",
  ),
  cap(
    "tab",
    "/tab",
    ["shift tab", "tab", "切模式"],
    "模式循环",
    "Mode cycle",
    "循环常用权限模式。",
    "Cycles common permission modes.",
    "只在用户明确要切换常用模式时使用。",
    "Use only when explicitly cycling common modes.",
    "start_gate",
  ),
  cap(
    "plan",
    "/plan",
    ["plan", "计划", "方案"],
    "计划模式",
    "Plan",
    "生成或确认结构化方案。",
    "Generates or accepts structured plans.",
    "需要先规划再执行。",
    "Use when planning before execution.",
    "start_gate",
  ),
  cap(
    "permissions",
    "/permissions",
    ["permission", "permissions", "权限", "allow", "deny"],
    "权限规则",
    "Permissions",
    "查看权限规则；增删规则必须走配置写入/审批边界。",
    "Shows permission rules; add/remove follows config-write/approval boundary.",
    "查看权限、最近拒绝或规则风险。",
    "Use for permissions, recent denials, and rule risks.",
    "dangerous",
    { entersPermissionPipeline: true },
  ),
  cap(
    "background",
    "/background",
    ["background", "后台", "long task", "长任务"],
    "后台任务",
    "Background",
    "查看后台任务摘要、输出路径和取消入口。",
    "Shows background task summaries, output paths, and cancellation entry.",
    "询问长任务状态、日志、取消方式。",
    "Use for long-task state, logs, and cancel hints.",
    "readonly",
  ),
  cap(
    "details",
    "/details",
    ["details", "详情", "evidence", "证据"],
    "详情",
    "Details",
    "查看 evidence、后台任务和裁剪详情摘要，不把大输出塞回主屏。",
    "Shows evidence, background tasks, and trimmed details without dumping large output into the main view.",
    "查看证据、工具详情或后台详情。",
    "Use to inspect evidence, tool details, or background details.",
    "readonly",
  ),
  cap(
    "agents",
    "/agents",
    ["agent", "agents", "智能体", "subagent"],
    "Agent",
    "Agents",
    "查看 agent 状态、transcript、usage 和取消入口。",
    "Lists agent state, transcript, usage, and cancel entry.",
    "查看或解释 agent 状态。",
    "Use to inspect or explain agent state.",
    "readonly",
  ),
  cap(
    "fork",
    "/fork",
    ["fork", "开 agent", "start agent", "verifier agent", "planner agent"],
    "派生 Agent",
    "Fork agent",
    "从裁剪 handoff 派生 agent；长任务必须 Start Gate。",
    "Forks an agent from trimmed handoff; long tasks require Start Gate.",
    "想开 explorer/planner/verifier/worker agent。",
    "Use to start explorer/planner/verifier/worker agents.",
    "start_gate",
  ),
  cap(
    "rewind",
    "/rewind",
    ["rewind", "restore", "回滚", "恢复检查点"],
    "回滚",
    "Rewind",
    "列出或恢复 checkpoint；restore 不自然语言直通。",
    "Lists or restores checkpoints; restore is never direct through natural language.",
    "查看 checkpoint 或理解恢复风险。",
    "Use for checkpoints and restore risk explanation.",
    "dangerous",
  ),
  cap(
    "btw",
    "/btw",
    ["btw", "临时插问", "side question"],
    "临时插问",
    "Temporary question",
    "回答临时问题，不改 Todo/Plan/checkpoint。",
    "Answers a side question without changing Todo/Plan/checkpoints.",
    "长任务中临时问一个不改变状态的问题。",
    "Use for a side question that should not alter state.",
    "readonly",
  ),
  cap(
    "interrupt",
    "/interrupt",
    ["interrupt", "cancel", "中断", "停止"],
    "中断",
    "Interrupt",
    "标记当前长任务取消。",
    "Marks the current long task cancelled.",
    "要中断正在运行的长任务。",
    "Use to cancel a running long task.",
    "start_gate",
  ),
  cap(
    "claim-check",
    "/claim-check",
    ["claim", "核查", "证据"],
    "结论核查",
    "Claim check",
    "降级缺证据结论。",
    "Downgrades unsupported claims.",
    "需要核查回答是否有证据。",
    "Use to check whether a claim has evidence.",
    "readonly",
  ),
  cap(
    "verify",
    "/verify",
    ["verify", "验证", "test", "typecheck"],
    "验证",
    "Verify",
    "生成或运行验证计划。",
    "Generates or runs verification.",
    "想跑测试、typecheck、build 或 verifier。",
    "Use for tests, typecheck, build, or verifier checks.",
    "start_gate",
  ),
  cap(
    "review",
    "/review",
    ["review", "代码审查", "审查"],
    "审查",
    "Review",
    "审查 diff、风险和验证证据。",
    "Reviews diff, risks, and verification evidence.",
    "想做一次 review 或看风险。",
    "Use for review or risk inspection.",
    "start_gate",
  ),
  cap(
    "cache-log",
    "/cache-log",
    ["cache log", "缓存日志"],
    "缓存日志",
    "Cache log",
    "查看或导出最近 cache usage 记录。",
    "Shows or exports recent cache usage records.",
    "需要对账 cache usage 或导出日志。",
    "Use for cache usage reconciliation or export.",
    "config_write",
    { writesConfig: true },
  ),
  cap(
    "cache",
    "/cache",
    ["cache", "缓存", "hit rate", "cache hit rate", "命中率"],
    "缓存",
    "Cache",
    "查看 cache 命中率与 freshness；refresh 需确认。",
    "Shows cache hit rate and freshness; refresh needs confirmation.",
    "询问缓存命中率、预热或刷新。",
    "Use for cache hit rate, warmup, or refresh.",
    "start_gate",
  ),
  cap(
    "break-cache",
    "/break-cache",
    ["break cache", "freshness", "缓存破坏"],
    "缓存破坏诊断",
    "Break-cache",
    "查看 cache freshness hash 变化。",
    "Shows cache freshness hash changes.",
    "排查为什么缓存命中下降。",
    "Use to diagnose cache hit-rate drops.",
    "readonly",
  ),
  cap(
    "mcp",
    "/mcp",
    ["mcp", "server", "tools"],
    "MCP",
    "MCP",
    "查看 MCP server 状态和稳定工具摘要。",
    "Shows MCP server status and stable tool summaries.",
    "询问 MCP 是否可用或有哪些工具。",
    "Use for MCP availability and tool summaries.",
    "readonly",
  ),
  cap(
    "index",
    "/index",
    [
      "index",
      "索引",
      "codebase",
      "architecture",
      "search code",
      "build index",
      "更新索引",
      "刷新索引",
      "重建索引",
    ],
    "代码索引",
    "Index",
    "status/search/architecture 为只读；init fast/refresh 是带安全扫描的本地安全动作；rebuild/force 需要精确确认。",
    "Status/search/architecture are read-only; init fast/refresh are safe local actions with a safety scan; rebuild/force requires exact confirmation.",
    "询问只读索引状态、搜索代码、架构摘要；普通 init fast/refresh 可安全执行，重建或 force 需精确确认。",
    "Use for read-only index status/search/architecture; normal init fast/refresh can run safely, while rebuild or force needs exact confirmation.",
    "start_gate",
  ),
  cap(
    "usage",
    "/usage",
    ["usage", "token", "tokens", "用量"],
    "用量",
    "Usage",
    "查看 token/cache usage 摘要。",
    "Shows token/cache usage summary.",
    "询问 token、usage 或账单口径。",
    "Use for token/cache usage questions.",
    "readonly",
  ),
  cap(
    "stats",
    "/stats",
    ["stats", "statistics", "统计"],
    "统计",
    "Stats",
    "查看本地 cache/cost 统计。",
    "Shows local cache/cost statistics.",
    "查看总体统计或 endpoint 聚合。",
    "Use for overall stats or endpoint grouping.",
    "readonly",
  ),
  cap(
    "read",
    "/read",
    [
      "read",
      "读取",
      "看文件",
      "open file",
      "项目规则",
      "本仓库规则",
      "linghun.md",
      "project rules",
    ],
    "读取文件",
    "Read file",
    "读取文件内容。",
    "Reads file content.",
    "自然语言询问怎么看文件时解释；项目规则读取走只读路径。",
    "Explain file reading; project-rules reads use a read-only path.",
    "tool_permission",
    { entersPermissionPipeline: true },
  ),
  cap(
    "write",
    "/write",
    ["write", "写文件", "create file"],
    "写文件",
    "Write file",
    "写入文件，必须走权限管道。",
    "Writes files through the permission pipeline.",
    "只用于解释风险或显式 slash 命令；自然语言不能直通。",
    "Use only for risk explanation or explicit slash commands; no natural direct execution.",
    "dangerous",
    { entersPermissionPipeline: true },
  ),
  cap(
    "edit",
    "/edit",
    ["edit", "修改", "replace"],
    "编辑",
    "Edit",
    "唯一替换编辑，必须走权限管道。",
    "Performs unique replacement edits through the permission pipeline.",
    "只用于解释编辑风险或显式 slash 命令。",
    "Use only to explain edit risk or explicit slash commands.",
    "dangerous",
    { entersPermissionPipeline: true },
  ),
  cap(
    "multiedit",
    "/multiedit",
    ["multiedit", "multi edit", "批量编辑"],
    "批量编辑",
    "MultiEdit",
    "多处编辑，必须走权限管道。",
    "Performs multiple edits through the permission pipeline.",
    "只用于解释批量编辑风险或显式 slash 命令。",
    "Use only to explain multi-edit risk or explicit slash commands.",
    "dangerous",
    { entersPermissionPipeline: true },
  ),
  cap(
    "grep",
    "/grep",
    ["grep", "search", "搜索", "查找", "TODO"],
    "搜索文本",
    "Search text",
    "搜索文本匹配。",
    "Searches text matches.",
    "想搜索代码、TODO 或错误信息。",
    "Use to search code, TODOs, or error messages.",
    "tool_permission",
    { entersPermissionPipeline: true },
  ),
  cap(
    "glob",
    "/glob",
    ["glob", "find files", "匹配文件", "文件列表", "按模式找文件", "模式找文件"],
    "匹配文件",
    "Match files",
    "按 glob 匹配文件路径。",
    "Matches file paths by glob.",
    "想找文件名或按模式列文件。",
    "Use to find files by name or pattern.",
    "tool_permission",
    { entersPermissionPipeline: true },
  ),
  cap(
    "bash",
    "/bash",
    ["bash", "run command", "运行命令", "npm install", "install dependency"],
    "Shell 命令",
    "Shell command",
    "执行 shell 命令，必须权限审批。",
    "Runs shell commands through approval.",
    "自然语言只能解释风险和审批要求，不能直通执行。",
    "Natural language may only explain risk and approval requirements.",
    "dangerous",
    { entersPermissionPipeline: true },
  ),
  cap(
    "todo",
    "/todo",
    ["todo", "任务", "task list"],
    "任务",
    "Todo",
    "查看或更新会话任务列表。",
    "Shows or updates the session task list.",
    "需要可见任务进度。",
    "Use for visible task progress.",
    "start_gate",
  ),
  cap(
    "diff",
    "/diff",
    ["diff", "changed files", "差异", "改动"],
    "Diff",
    "Diff",
    "显示本轮工具改动摘要。",
    "Shows current tool-change summary.",
    "想看改了什么或 show me the diff。",
    "Use to inspect current changes.",
    "readonly",
  ),
  cap(
    "exit",
    "/exit",
    ["exit", "quit", "退出"],
    "退出",
    "Exit",
    "退出 REPL。",
    "Exits the REPL.",
    "需要结束当前 REPL。",
    "Use to end the REPL.",
    "start_gate",
  ),
  cap(
    "status",
    "/status",
    ["status", "状态栏"],
    "状态栏",
    "Status",
    "内部状态栏输出入口。",
    "Internal status-bar output entry.",
    "通常由系统自动输出；可用于调试短状态。",
    "Usually emitted automatically; useful for short status debugging.",
    "readonly",
    { hiddenReason: "not listed in /help; status bar is emitted automatically" },
  ),
];

export function getCommandCapabilityCatalog(): CommandCapability[] {
  return [...COMMAND_CAPABILITY_DATA].sort(
    (a, b) => a.slash.localeCompare(b.slash) || a.id.localeCompare(b.id),
  );
}

export function validateCommandCapabilityCoverage(
  dispatchSlashes = USER_VISIBLE_SLASH_COMMANDS,
): string[] {
  const catalog = getCommandCapabilityCatalog();
  const registry = SLASH_COMMAND_REGISTRY;
  const missingFromRegistry = dispatchSlashes.filter(
    (slash) => !registry.some((item) => item.slash === slash && item.userVisible),
  );
  const missingFromCatalog = dispatchSlashes.filter((slash) => {
    const entry = registry.find((item) => item.slash === slash && item.userVisible);
    return !entry || !catalog.some((item) => item.id === entry.capabilityId && item.userInvocable);
  });
  const registryWithoutCatalog = registry.filter(
    (entry) => !catalog.some((item) => item.id === entry.capabilityId),
  );
  const invalidHidden = catalog
    .filter((item) => item.hiddenReason !== undefined && item.hiddenReason.trim() === "")
    .map((item) => item.id);
  return [
    ...missingFromRegistry.map((slash) => `dispatch missing registry ${slash}`),
    ...missingFromCatalog.map((slash) => `dispatch missing catalog ${slash}`),
    ...registryWithoutCatalog.map((entry) => `registry missing catalog ${entry.slash}`),
    ...invalidHidden.map((id) => `hidden reason missing ${id}`),
  ];
}

export function buildRuntimeStatusForModel(context: RuntimeStatusSource): RuntimeStatusForModel {
  const latest = context.cache.history.at(-1);
  const freshness = latest?.freshness ?? context.cache.lastFreshness;
  return {
    memory: {
      linghunMd: context.memory.projectRulesError
        ? "unreadable"
        : context.memory.projectRulesExists
          ? "found"
          : "missing",
      candidates: context.memory.candidates.length,
      accepted: context.memory.accepted.length,
      autoAccept: false,
    },
    index: {
      status: context.index.status,
      changedFiles: context.index.changedFiles ?? null,
    },
    cache: {
      latestHitRate: latest?.hitRate ?? null,
      changedKeys: (freshness?.changedKeys ?? []).slice(0, 8),
    },
    model: { provider: context.provider ?? "unknown", name: context.model },
    permissionMode: context.permissionMode,
    extensions: {
      skills: { enabled: context.skills.enabled, count: context.skills.skills.length },
      plugins: { enabled: context.plugins.enabled, count: context.plugins.plugins.length },
      hooks: { enabled: context.hooks.enabled, count: context.hooks.hooks.length },
    },
  };
}

export function createModelCapabilitySummary(limit = 30): string {
  return getCommandCapabilityCatalog()
    .filter((item) => item.modelInvocable || item.bridgeSafe)
    .slice(0, limit)
    .map((item) => `${item.slash} ${item.titleEn}: risk=${item.risk}; ${item.whenToUseEn}`)
    .join("\n");
}

export function routeNaturalIntent(
  text: string,
  preferredLanguage: Language = "zh-CN",
): NaturalIntent {
  const language = detectInputLanguage(text, preferredLanguage);
  const normalized = normalizeIntentText(text);
  const mentionedSlash = /\/[a-z-]+/iu.exec(text)?.[0];
  const catalog = getCommandCapabilityCatalog();
  const explicit = mentionedSlash
    ? catalog.find((item) => item.slash === mentionedSlash)
    : undefined;
  const classification = classifyNaturalControlIntent(normalized);
  const inquiry = classification.inquiry;
  const dangerous = classification.dangerousReason;
  const scored = catalog
    .map((capability) => ({ capability, score: scoreCapability(capability, normalized, text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.capability.slash.localeCompare(b.capability.slash));
  const candidates = uniqueCapabilities([
    ...(explicit ? [explicit] : []),
    ...scored.map((item) => item.capability),
  ]).slice(0, 5);
  const capability = explicit ?? candidates[0];
  const topScore = explicit ? Math.max(8, scored[0]?.score ?? 0) : (scored[0]?.score ?? 0);
  const secondScore = scored[1]?.score ?? 0;

  if (!capability) {
    return {
      action: "model",
      confidence: 0,
      reason: "no catalog match",
      candidates: [],
      language,
      inquiry,
      riskHandler: "model",
    };
  }
  if (inquiry === "status" && isFirstBatchStatusCapability(capability.id)) {
    return createIntent(
      "execute_readonly",
      capability,
      Math.min(1, Math.max(0.7, topScore / 5)),
      "readonly status",
      candidates,
      language,
      inquiry,
      normalized,
    );
  }
  if (inquiry === "doctor" && isFirstBatchStatusCapability(capability.id)) {
    return createIntent(
      "execute_readonly",
      capability,
      Math.min(1, Math.max(0.75, topScore / 5)),
      "readonly doctor",
      candidates,
      language,
      inquiry,
      normalized,
    );
  }
  if (inquiry === "read" && capability.id === "read") {
    return createIntent(
      "execute_readonly",
      capability,
      Math.min(1, Math.max(0.75, topScore / 5)),
      "readonly project rules",
      candidates,
      language,
      inquiry,
      normalized,
    );
  }
  if (!explicit && isMcpIndexControlRequest(normalized, capability.id)) {
    return createIntent(
      "answer",
      capability,
      Math.min(1, Math.max(0.82, topScore / 5)),
      "mcp index control plane handled locally",
      candidates,
      language,
      "usage",
      normalized,
    );
  }
  if (!explicit && capability.id === "index" && classification.indexAction === "rebuild") {
    return createIntent(
      "start_gate",
      capability,
      Math.min(1, Math.max(0.85, topScore / 5)),
      "rebuild index requires exact confirmation",
      candidates,
      language,
      "execute",
      normalized,
    );
  }
  if (dangerous && isDangerousNaturalTarget(capability.id)) {
    return createIntent(
      "permission_pipeline",
      capability,
      0.92,
      dangerous,
      candidates,
      language,
      "execute",
      normalized,
    );
  }
  if (
    !explicit &&
    capability.id === "index" &&
    !["usage", "risk"].includes(inquiry) &&
    classification.indexAction === "safe"
  ) {
    return createIntent(
      "safe_local_action",
      capability,
      Math.min(1, Math.max(0.8, topScore / 5)),
      "safe local index action",
      candidates,
      language,
      "execute",
      normalized,
    );
  }
  if (!explicit && !isNaturalControlPlaneIntent(capability.id, normalized, inquiry)) {
    return {
      action: "model",
      confidence: Math.min(1, topScore / 5),
      reason: "ordinary development request",
      candidates,
      language,
      inquiry,
      riskHandler: "model",
    };
  }
  if (!explicit && topScore < 2.2) {
    return createIntent(
      "ask_clarify",
      capability,
      topScore / 5,
      "low confidence",
      candidates,
      language,
      inquiry,
      normalized,
    );
  }
  if (!explicit && candidates.length > 1 && Math.abs(topScore - secondScore) < 0.6) {
    return createIntent(
      "ask_clarify",
      capability,
      topScore / 6,
      "multiple close candidates",
      candidates,
      language,
      inquiry,
      normalized,
    );
  }
  if (!explicit && isAmbiguousCapabilityList(normalized, candidates)) {
    return createIntent(
      "ask_clarify",
      capability,
      Math.min(0.8, topScore / 6),
      "ambiguous capability list",
      candidates,
      language,
      inquiry,
      normalized,
    );
  }
  if (isUsageOrRiskQuestion(normalized, inquiry) || explicit) {
    return createIntent(
      "answer",
      capability,
      1,
      "catalog question",
      candidates,
      language,
      inquiry,
      normalized,
    );
  }
  if (capability.readonly && isStatusLike(normalized, capability)) {
    return createIntent(
      "execute_readonly",
      capability,
      Math.min(1, topScore / 5),
      "readonly status",
      candidates,
      language,
      inquiry,
      normalized,
    );
  }
  if (capability.risk === "dangerous") {
    return createIntent(
      "permission_pipeline",
      capability,
      Math.min(1, topScore / 5),
      "dangerous natural language cannot execute directly",
      candidates,
      language,
      "execute",
      normalized,
    );
  }
  return createIntent(
    "start_gate",
    capability,
    Math.min(1, topScore / 5),
    capability.risk === "tool_permission"
      ? "tool permission path requires confirmation"
      : "start gate required",
    candidates,
    language,
    "execute",
    normalized,
  );
}

export function formatNaturalClarification(intent: NaturalIntent): string {
  const zh = intent.language === "zh-CN";
  const lines = zh
    ? ["我不确定你想做哪件事。请选择一个自然语言方向："]
    : ["I am not sure which action you want. Please choose one natural-language direction:"];
  for (const item of intent.candidates.slice(0, 3)) {
    const title = zh ? item.titleZh : item.titleEn;
    const when = zh ? item.whenToUseZh : item.whenToUseEn;
    const risk = formatHumanRisk(item, intent.language);
    lines.push(
      zh
        ? `- 查看/处理「${title}」：${when} 风险：${risk}`
        : `- View/handle ${title}: ${when} Risk: ${risk}`,
    );
  }
  lines.push(
    zh
      ? "如果你只是想聊天或说明需求，可以直接补充一句目标；我不会猜测执行。"
      : "If you only want to chat or describe a task, add the goal in plain language; I will not guess and execute.",
  );
  return lines.join("\n");
}

export function formatCapabilityAnswer(intent: NaturalIntent): string {
  const c = intent.capability;
  if (!c) return "";
  const zh = intent.language === "zh-CN";
  const description = zh ? c.descriptionZh : c.descriptionEn;
  const when = zh ? c.whenToUseZh : c.whenToUseEn;
  const risk = formatRiskLine(c, intent.language);
  const equivalent = intent.command ?? createNaturalEquivalentCommand(c, "");
  return zh
    ? [
        `${c.slash}：${c.titleZh}`,
        `- 用途：${description}`,
        `- 何时使用：${when}`,
        `- 风险：${risk}`,
        `- 等价命令：${equivalent}`,
        `- 自然语言桥：${c.bridgeSafe ? "可解释/可进入安全路径" : "不可直通"}`,
      ].join("\n")
    : [
        `${c.slash}: ${c.titleEn}`,
        `- Purpose: ${description}`,
        `- When to use: ${when}`,
        `- Risk: ${risk}`,
        `- Equivalent command: ${equivalent}`,
        `- Natural bridge: ${c.bridgeSafe ? "can explain / enter safe path" : "not direct"}`,
      ].join("\n");
}

export function formatNaturalPermissionBlock(intent: NaturalIntent): string {
  const c = intent.capability;
  if (!c) return "";
  const command = intent.command ?? createNaturalEquivalentCommand(c, "");
  if (intent.language === "en-US") {
    return [
      `Blocked natural-language direct execution: ${c.titleEn}`,
      `- Exact action: ${command}`,
      `- Risk: ${formatHumanRisk(c, intent.language)}`,
      "- Scope: current project or the command-specific target; config/permission/tool effects must be reviewed before execution.",
      "- Reason: request came from the Natural Command Bridge; bridge/workflow/agent/plugin/hook/remote paths can only create gates or permission requests.",
      "- Rollback: inspect /diff, checkpoint, config state, or disable the affected extension before accepting follow-up changes.",
      "- Choices: type the explicit slash command locally, enter a Start Gate, or reject and provide feedback; plain natural-language confirmation is not enough.",
      "- Start Gate does not replace the existing permission pipeline.",
      "- I did not execute it.",
    ].join("\n");
  }
  return [
    `已阻止自然语言直通：${c.titleZh}`,
    `- 精确动作：${command}`,
    `- 风险：${formatHumanRisk(c, intent.language)}`,
    "- 范围：当前项目或命令指定目标；配置、权限、工具影响必须在执行前复核。",
    "- 原因：请求来自 Natural Command Bridge；自然语言桥、workflow、agent、plugin、hook、remote 只能生成确认门或权限请求。",
    "- 回滚方式：先查看 /diff、checkpoint、配置状态，或禁用受影响扩展，再接受后续变更。",
    "- 选择：在本地显式输入 slash command、进入 Start Gate，或拒绝并提供反馈；普通自然语言确认不够。",
    "- Start Gate 不替代现有权限审批管道。",
    "- 本次没有执行。",
  ].join("\n");
}

export function createPendingNaturalCommand(
  intent: NaturalIntent,
  context: RuntimeStatusSource,
  now = new Date(),
): PendingNaturalCommand | null {
  const c = intent.capability;
  const command = intent.command ?? (c ? createNaturalEquivalentCommand(c, "") : "");
  if (!c || !command || intent.action !== "start_gate") return null;
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 90_000).toISOString();
  return {
    gateId: `ng-${randomUUID().slice(0, 8)}`,
    capabilityId: c.id,
    source: "natural",
    exactCommand: command,
    command,
    risk: c.risk,
    scope: `current project ${context.projectPath}`,
    createdAt,
    expiresAt,
    requiresExactConfirmation: requiresExactNaturalConfirmation(c, command),
  };
}

export function formatNaturalStartGate(
  intent: NaturalIntent,
  context: RuntimeStatusSource,
  gate = createPendingNaturalCommand(intent, context),
): string {
  const c = intent.capability;
  const command =
    gate?.exactCommand ?? intent.command ?? (c ? createNaturalEquivalentCommand(c, "") : "");
  const scope = gate?.scope ?? `current project ${context.projectPath}`;
  const exactHint = gate?.requiresExactConfirmation
    ? intent.language === "en-US"
      ? `To continue, reply with exactly \`${command}\`. Plain \`yes\` is not accepted for this action.`
      : `如要继续，请原样回复 \`${command}\`。这个动作不能只回复“确认”或 yes。`
    : intent.language === "en-US"
      ? "Reply `yes` to run the equivalent slash command, or type anything else to cancel."
      : "回复 `确认` 执行等价 slash command；输入其他内容则取消。";
  if (intent.language === "en-US") {
    return [
      `I can prepare this action: ${c?.titleEn ?? "command"}`,
      `- Exact command: ${command}`,
      `- Scope: ${scope}`,
      `- Risk: ${formatHumanRisk(c, intent.language)}`,
      "- Safety: this only opens the action path; any later file writes, Bash, network access, config changes, or tool permissions still require their own approval.",
      "- Cancel: type anything other than the required confirmation, or use /interrupt if a later long-running task has started.",
      exactHint,
    ].join("\n");
  }
  return [
    `我可以准备执行：${c?.titleZh ?? "命令"}`,
    `- 精确命令：${command}`,
    `- 范围：${scope}`,
    `- 风险：${formatHumanRisk(c, intent.language)}`,
    "- 安全边界：这里只打开动作路径；后续如需写文件、Bash、联网、改配置或工具权限，仍会单独审批。",
    "- 取消方式：输入任何非确认内容即可取消；如果后续长任务已开始，可用 /interrupt。",
    exactHint,
  ].join("\n");
}

export function isNaturalGateExpired(gate: PendingNaturalCommand, now = new Date()): boolean {
  return Date.parse(gate.expiresAt) <= now.getTime();
}

export function matchesNaturalGateConfirmation(
  gate: PendingNaturalCommand,
  text: string,
  now = new Date(),
): "confirmed" | "expired" | "exact_required" | "cancelled" {
  if (isNaturalGateExpired(gate, now)) return "expired";
  const normalized = text.trim();
  if (gate.requiresExactConfirmation) {
    return normalized === gate.exactCommand ? "confirmed" : "exact_required";
  }
  return /^(yes|y|confirm|确认|是|执行|继续)$/iu.test(normalized) ? "confirmed" : "cancelled";
}

function requiresExactNaturalConfirmation(c: CommandCapability, command: string): boolean {
  return (
    c.risk === "dangerous" ||
    c.writesConfig ||
    c.entersPermissionPipeline ||
    ["workflows", "fork"].includes(c.id) ||
    /\b(refresh|init|enable|accept|delete|restore|bypass|add|remove|install|job|remote|hook)\b|刷新|建立|启用|接受|删除|恢复|安装依赖/u.test(
      command,
    )
  );
}

function formatHumanRisk(c: CommandCapability | undefined, language: Language): string {
  if (!c)
    return language === "en-US"
      ? "Unknown risk; do not continue if unsure."
      : "风险未知；不确定时不要继续。";
  if (c.risk === "dangerous") {
    return language === "en-US"
      ? "High risk. This cannot run directly from natural language and must stay behind explicit confirmation and the permission pipeline."
      : "高风险。不能由自然语言直通执行，必须保留精确确认和权限管道。";
  }
  if (c.risk === "tool_permission") {
    return language === "en-US"
      ? "May use tools or touch project state. It will still enter the tool permission flow before any protected action."
      : "可能使用工具或触及项目状态；任何受保护动作仍会进入工具权限审批。";
  }
  if (c.risk === "config_write") {
    return language === "en-US"
      ? "May change Linghun configuration. Review the exact command and keep a rollback path before continuing."
      : "可能修改 Linghun 配置；继续前请确认精确命令，并保留回滚路径。";
  }
  if (c.risk === "start_gate") {
    if (c.id === "index") {
      return language === "en-US"
        ? "Status/search/architecture are read-only. Init fast/refresh are safe local actions that run a safety scan before building the local code index. Rebuild/force requires exact confirmation. It should not modify source files."
        : "status/search/architecture 为只读；init fast/refresh 是带安全扫描的本地安全动作，会生成本地代码索引；rebuild/force 需要精确确认；不应修改源码。";
    }
    return language === "en-US"
      ? "Requires a Start Gate before the equivalent command starts; later protected actions still need approval."
      : "需要先通过 Start Gate 才会启动等价命令；后续受保护动作仍需审批。";
  }
  return language === "en-US" ? "Read-only local state check." : "只读本地状态检查。";
}

export function formatRiskLine(c: CommandCapability, language: Language): string {
  const details = [
    `risk=${c.risk}`,
    `readonly=${c.readonly ? "yes" : "no"}`,
    `startGate=${c.requiresStartGate ? "yes" : "no"}`,
    `writesConfig=${c.writesConfig ? "yes" : "no"}`,
    `permissionPipeline=${c.entersPermissionPipeline ? "yes" : "no"}`,
  ];
  const reason =
    c.risk === "dangerous"
      ? language === "en-US"
        ? "cannot run directly from natural language"
        : "不能由自然语言直通执行"
      : c.risk === "tool_permission"
        ? language === "en-US"
          ? "must enter tool permission pipeline"
          : "必须进入工具权限管道"
        : c.risk === "start_gate"
          ? language === "en-US"
            ? "requires Start Gate confirmation"
            : "需要 Start Gate 确认"
          : language === "en-US"
            ? "read-only local state"
            : "只读本地状态";
  return `${details.join(", ")} · ${reason}`;
}

function cap(
  id: string,
  slash: string,
  aliases: string[],
  titleZh: string,
  titleEn: string,
  descriptionZh: string,
  descriptionEn: string,
  whenToUseZh: string,
  whenToUseEn: string,
  risk: CommandRisk,
  options: Partial<CommandCapability> = {},
): CommandCapability {
  const readonly = risk === "readonly" || options.readonly === true;
  return {
    id,
    slash,
    aliases,
    titleZh,
    titleEn,
    descriptionZh,
    descriptionEn,
    whenToUseZh,
    whenToUseEn,
    risk,
    readonly,
    modelInvocable: options.modelInvocable ?? readonly,
    userInvocable: options.userInvocable ?? true,
    requiresStartGate:
      options.requiresStartGate ?? ["start_gate", "config_write", "dangerous"].includes(risk),
    writesConfig: options.writesConfig ?? risk === "config_write",
    entersPermissionPipeline:
      options.entersPermissionPipeline ?? (risk === "tool_permission" || risk === "dangerous"),
    bridgeSafe:
      options.bridgeSafe ?? (readonly || risk === "start_gate" || risk === "tool_permission"),
    hiddenReason: options.hiddenReason,
  };
}

function createIntent(
  action: NaturalIntentAction,
  capability: CommandCapability,
  confidence: number,
  reason: string,
  candidates: CommandCapability[],
  language: Language,
  inquiry: NaturalIntent["inquiry"],
  normalized = "",
): NaturalIntent {
  return {
    action,
    capability,
    confidence,
    command: createNaturalEquivalentCommand(capability, normalized),
    reason,
    candidates,
    language,
    inquiry,
    riskHandler:
      action === "ask_clarify"
        ? "clarify"
        : action === "safe_local_action"
          ? "safe_local_action"
          : capability.risk,
  };
}

function detectInputLanguage(text: string, preferred: Language): Language {
  if (preferred === "en-US") return "en-US";
  return /[\u4e00-\u9fff]/u.test(text) ? "zh-CN" : "en-US";
}

function normalizeIntentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[？?。！!,，:：()（）]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

type NaturalControlClassification = {
  inquiry: NaturalIntent["inquiry"];
  dangerousReason: string | null;
  indexAction: "safe" | "rebuild" | null;
  projectRulesRead: boolean;
  actionRequest: boolean;
};

function classifyNaturalControlIntent(text: string): NaturalControlClassification {
  const projectRulesRead = /项目规则|本仓库规则|linghun\.md|project rules/u.test(text);
  const indexAction = classifyIndexAction(text);
  const actionRequest = isActionRequest(text);

  return {
    inquiry: classifyInquiry(text, projectRulesRead, actionRequest),
    dangerousReason: classifyDangerousReason(text),
    indexAction,
    projectRulesRead,
    actionRequest,
  };
}

function classifyInquiry(
  text: string,
  projectRulesRead: boolean,
  actionRequest: boolean,
): NaturalIntent["inquiry"] {
  if (
    /是否|开了吗|enabled|status|状态|当前|现在|什么模型|哪个模型|用的哪个|命中|hit rate|list|有哪些|what model|current model|好了没|好了么|已经.*是吧|已经.*了吗|ready/u.test(
      text,
    )
  ) {
    return "status";
  }
  if (
    /key|api key|configured|connected|working|doctor|诊断|配好了吗|配置正常|配置.*问题|为什么不能用|不能用|连上了吗|可用吗/u.test(
      text,
    )
  ) {
    return "doctor";
  }
  if (projectRulesRead) return "read";
  if (/风险|危险|safe|risk|danger/u.test(text)) return "risk";
  if (/怎么|如何|用途|干什么|what does|how do i|how to|what is/u.test(text)) return "usage";
  return actionRequest ? "execute" : "howto";
}

function detectInquiry(text: string): NaturalIntent["inquiry"] {
  return classifyNaturalControlIntent(text).inquiry;
}

function classifyDangerousReason(text: string): string | null {
  if (
    /直接|force|强制|bypass|npm install|pnpm add|install dependency|安装依赖|接受所有|accept all|delete memory|restore|hook|remote|job/u.test(
      text,
    )
  ) {
    return "high-risk wording";
  }
  return null;
}

function isDangerousNaturalTarget(id: string): boolean {
  return [
    "write",
    "edit",
    "multiedit",
    "bash",
    "permissions",
    "rewind",
    "plugins",
    "skills",
    "index",
    "cache",
    "memory",
    "hooks",
    "mode",
  ].includes(id);
}

function isMcpIndexControlRequest(text: string, capabilityId: string): boolean {
  return (
    (capabilityId === "mcp" || capabilityId === "index") &&
    /mcp/u.test(text) &&
    /索引|index/u.test(text) &&
    /打开|开启|启用|enable|turn on/u.test(text)
  );
}

function classifyIndexAction(text: string): NaturalControlClassification["indexAction"] {
  if (/重建|重新索引|重做索引|清空.*重建|force rebuild|rebuild|reindex/u.test(text)) {
    return "rebuild";
  }
  if (
    /(?:帮我|请)?.*(?:更新|刷新|同步).*索引|refresh the project index|update the project index|sync the project index/u.test(
      text,
    ) ||
    /(?:帮我|请)?.*(?:建立|初始化|创建).*索引|build the index|init index|create index/u.test(text)
  ) {
    return "safe";
  }
  return null;
}

function isNaturalControlPlaneIntent(
  id: string,
  text: string,
  inquiry: NaturalIntent["inquiry"],
): boolean {
  const classification = classifyNaturalControlIntent(text);
  if (["status", "doctor", "usage", "risk", "read"].includes(inquiry)) return true;
  if (id === "read") return classification.projectRulesRead;
  if (id === "index") return classification.indexAction === "safe";
  return ["model", "cache", "memory", "mode"].includes(id) && !classification.actionRequest;
}

function isFirstBatchStatusCapability(id: string): boolean {
  return [
    "memory",
    "index",
    "cache",
    "model",
    "mode",
    "workflows",
    "skills",
    "plugins",
    "hooks",
    "sessions",
    "resume",
    "branch",
  ].includes(id);
}

function isActionRequest(text: string): boolean {
  if (/好了没|好了么|已经.*是吧|已经.*了吗|ready/u.test(text)) return false;
  return /帮我|请|直接|打开|建立|恢复|build|start|create|run|enable|accept|force|切换|switch|set|resume/u.test(
    text,
  );
}

function isOrdinaryDevelopmentRequest(text: string): boolean {
  return /分析|部署|报告|输出|inspect|understand|deploy|report/u.test(text);
}

function scoreCapability(
  capability: CommandCapability,
  normalized: string,
  original: string,
): number {
  let score = 0;
  const hay =
    `${capability.id} ${capability.slash} ${capability.aliases.join(" ")} ${capability.titleZh} ${capability.titleEn} ${capability.descriptionZh} ${capability.descriptionEn} ${capability.whenToUseZh} ${capability.whenToUseEn}`.toLowerCase();
  for (const token of splitIntentTokens(normalized)) {
    if (token.length < 2) continue;
    if (hay.includes(token)) score += token.length > 4 ? 1.2 : 0.7;
  }
  if (original.includes(capability.slash)) score += 6;
  for (const alias of capability.aliases) {
    const lower = alias.toLowerCase();
    if (normalized.includes(lower)) score += 3;
  }
  if (capability.id === "hooks" && /hook|钩子/u.test(normalized)) score += 3;
  if (capability.id === "workflows" && /bug-fix|bug fix|工作流|workflow/u.test(normalized))
    score += 3;
  if (capability.id === "cache" && /命中|hit rate|cache/u.test(normalized)) score += 3;
  if (capability.id === "memory" && /记忆|memory/u.test(normalized)) score += 3;
  if (
    capability.id === "index" &&
    /索引|index|搜索代码|search code|architecture|更新|刷新|重建|重新索引|重做索引|同步索引/u.test(
      normalized,
    )
  )
    score += 3;
  if (capability.id === "read" && /项目规则|本仓库规则|linghun\.md|project rules/u.test(normalized))
    score += 8;
  if (
    capability.id === "model" &&
    /模型|model|provider|claude|deepseek|gpt|route|路由/u.test(normalized)
  )
    score += 4;
  if (
    capability.id === "mode" &&
    /权限模式|permission mode|bypass|accept edits|acceptedits|auto|dontask|don't ask|plan mode/u.test(
      normalized,
    )
  )
    score += 5;
  if (capability.id === "diff" && /diff|改动|差异/u.test(normalized)) score += 3;
  if (capability.id === "review" && /review|审查/u.test(normalized)) score += 3;
  if (capability.id === "grep" && /搜索代码|search code|搜索.*todo/u.test(normalized)) score += 5;
  if (
    capability.id === "todo" &&
    /todo|任务|task/u.test(normalized) &&
    !/搜索代码|search code|搜索.*todo/u.test(normalized)
  )
    score += 4;
  if (capability.id === "background" && /后台|background|长任务|long task/u.test(normalized))
    score += 6;
  if (capability.id === "glob" && /按模式找文件|模式找文件|find files|匹配文件/u.test(normalized))
    score += 4;
  if (capability.id === "fork" && /agent|智能体|verifier/u.test(normalized)) score += 2;
  return score;
}

function splitIntentTokens(text: string): string[] {
  const ascii = text.match(/[a-z0-9_.\/-]+/giu) ?? [];
  const zh = text.match(/[\u4e00-\u9fff]{2,}/gu) ?? [];
  return [...ascii, ...zh];
}

function uniqueCapabilities(items: CommandCapability[]): CommandCapability[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function isUsageOrRiskQuestion(text: string, inquiry: NaturalIntent["inquiry"]): boolean {
  return (
    inquiry === "usage" ||
    inquiry === "risk" ||
    /干什么|what does|危险|risk|how do i|怎么/u.test(text)
  );
}

function isAmbiguousCapabilityList(text: string, candidates: CommandCapability[]): boolean {
  const inquiry = detectInquiry(text);
  if (
    candidates.length < 2 ||
    inquiry === "status" ||
    inquiry === "doctor" ||
    inquiry === "read" ||
    isActionRequest(text) ||
    isUsageOrRiskQuestion(text, inquiry) ||
    !/^[\u4e00-\u9fff]{4,}$/u.test(text)
  ) {
    return false;
  }
  const matched = candidates.filter((item) =>
    item.aliases.some((alias) => alias.length >= 2 && text.includes(alias.toLowerCase())),
  );
  return matched.length >= 2;
}

function isStatusLike(text: string, capability: CommandCapability): boolean {
  return (
    capability.readonly ||
    /状态|status|当前|enabled|开了吗|命中|hit rate|list|有哪些|what model/u.test(text)
  );
}

function createNaturalEquivalentCommand(capability: CommandCapability, normalized: string): string {
  if (capability.id === "hooks") return "/doctor hooks";
  if (capability.id === "cache") {
    return normalized.includes("refresh") ||
      normalized.includes("刷新") ||
      normalized.includes("预热")
      ? "/cache refresh"
      : "/cache status";
  }
  if (capability.id === "index") {
    if (/好了没|好了么|已经.*是吧|已经.*了吗|已经建立了吗|ready|status|状态/u.test(normalized)) {
      return "/index status";
    }
    if (/重建|重新索引|重做索引|rebuild|reindex/u.test(normalized))
      return "/index refresh --confirm-rebuild";
    if (/更新|刷新|同步索引|refresh|update|sync/u.test(normalized)) return "/index refresh";
    if (/build|建立|初始化|创建|init|create/u.test(normalized)) return "/index init fast";
    if (/architecture|架构/u.test(normalized)) return "/index architecture";
    if (/search|搜索|查找|todo/u.test(normalized)) return "/index search <query>";
    return "/index status";
  }
  if (capability.id === "workflows") {
    const workflow = extractWorkflowName(normalized);
    return workflow ? `/workflows ${workflow}` : "/workflows";
  }
  if (capability.id === "fork") {
    const role = extractAgentRole(normalized);
    return role ? `/fork ${role} <task>` : "/fork <explorer|planner|verifier|worker> <task>";
  }
  if (capability.id === "permissions" && /add|remove|添加|删除/u.test(normalized))
    return "/permissions add|remove ...";
  if (capability.id === "mode") {
    const mode = extractPermissionMode(normalized);
    return mode ? `/mode ${mode}` : "/mode";
  }
  if (capability.id === "model") {
    if (
      /key|api key|configured|connected|working|doctor|诊断|配好了吗|配置正常|配置.*问题|为什么不能用|不能用|连上了吗|可用吗/u.test(
        normalized,
      )
    ) {
      return "/model route doctor";
    }
    if (/route|路由/u.test(normalized)) return "/model route";
    const candidate = extractModelCandidate(normalized);
    return candidate ? `/model route set executor ${candidate}` : "/model";
  }
  if (capability.id === "branch") {
    const purpose = extractBranchPurpose(normalized);
    return purpose ? `/branch ${purpose}` : "/branch";
  }
  if (capability.id === "bash" && /npm install/u.test(normalized)) return "/bash npm install";
  if (capability.id === "read" && /项目规则|本仓库规则|linghun\.md|project rules/u.test(normalized))
    return "/read LINGHUN.md";
  return capability.slash;
}

function extractPermissionMode(text: string): PermissionMode | null {
  if (/acceptedits|accept edits|接受编辑/u.test(text)) return "acceptEdits";
  if (/dontask|don't ask|dont ask|不询问/u.test(text)) return "dontAsk";
  if (/bypass|绕过/u.test(text)) return "bypass";
  if (/auto|自动审批/u.test(text)) return "auto";
  if (/plan|计划/u.test(text)) return "plan";
  if (/default|默认/u.test(text)) return "default";
  return null;
}

function extractWorkflowName(text: string): string | null {
  const names = [
    "bug-fix",
    "review",
    "refactor-plan",
    "doc-to-code",
    "design-to-code",
    "release-note",
  ];
  for (const name of names) {
    if (text.includes(name)) return name;
  }
  if (/bug fix|修 bug|修复 bug/u.test(text)) return "bug-fix";
  if (/审查|代码审查/u.test(text)) return "review";
  if (/重构/u.test(text)) return "refactor-plan";
  if (/文档.*代码|doc to code/u.test(text)) return "doc-to-code";
  if (/设计.*代码|design to code/u.test(text)) return "design-to-code";
  if (/release|发布说明/u.test(text)) return "release-note";
  return null;
}

function extractAgentRole(text: string): string | null {
  if (/explorer|探索|查代码/u.test(text)) return "explorer";
  if (/planner|计划|规划/u.test(text)) return "planner";
  if (/verifier|验证|复检/u.test(text)) return "verifier";
  if (/worker|执行|实现/u.test(text)) return "worker";
  return null;
}

function extractModelCandidate(text: string): string | null {
  const match = /(?:set|switch to|切到|换到|使用)\s+([a-z0-9_.:-]+)/iu.exec(text);
  return match?.[1] && !["model", "route"].includes(match[1]) ? match[1] : null;
}

function extractBranchPurpose(text: string): string | null {
  const match = /(?:branch|分支)(?: session)?\s+(.+)$/iu.exec(text);
  if (!match?.[1]) return null;
  return match[1].trim().slice(0, 80) || null;
}
