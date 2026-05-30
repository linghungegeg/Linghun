export type ArchitectureCard = {
  target: string;
  projectFacts: string[];
  recommendedApproach: string;
  rejectedApproaches: string[];
  stagedBreakdown: string[];
  risks: string[];
  verification: string[];
  nonGoals: string[];
};

export type ArchitectureRuntimeContext = {
  projectPath?: string;
  permissionMode?: string;
  model?: string;
  evidence?: Array<{ kind?: string; source?: string; summary?: string; supportsClaims?: string[] }>;
  index?: {
    status?: string;
    projectName?: string;
    nodes?: number;
    edges?: number;
    staleHint?: string;
  };
  activePlan?: unknown;
  planAccepted?: boolean;
};

export type ArchitectureCardSummary = Pick<
  ArchitectureCard,
  "target" | "recommendedApproach" | "risks" | "verification" | "nonGoals"
> & {
  projectFacts: string[];
};

export type ArchitectureNextAction = {
  toolName?: string;
  input?: unknown;
  summary?: string;
  files?: string[];
  verificationPlanned?: boolean;
  skipVerification?: boolean;
  recommendedApproach?: string;
  treatsUnknownOrStaleAsFact?: boolean;
};

export type ArchitectureDriftResult = {
  drift: boolean;
  warnings: string[];
  requiresConfirmation: boolean;
};

const SYSTEMIC_TRIGGER_PATTERNS = [
  /跨文件|跨模块|多文件|多个模块|multi[-\s]?file|cross[-\s]?module/i,
  /公共接口|对外接口|API\s*(change|变更)|public\s+api/i,
  /依赖|配置|package\.json|tsconfig|pnpm-lock|npm\s+install|pnpm\s+add|yarn\s+add/i,
  /部署|性能|安全|deploy|deployment|performance|security/i,
  /新系统|新功能|系统性缺口|new\s+(system|feature)|systemic\s+gap/i,
  /(实现|新增|添加|加一个|支持).{0,16}(功能|模块|系统|流程|接口)/i,
  /\b(implement|add|support)\b.{0,32}\b(feature|module|system|flow|api)\b/i,
  /mature|complete|reference[-\s]?aligned|no\s+omissions|成熟|完整|对齐参考源|不要遗漏/i,
  /(做|写|建|改|加|开发|搭建|重构|实现).{0,20}(页面|组件|界面|主页|首页|后台|仪表盘|表单|导航|侧边栏|弹窗|模态框)/i,
  /\b(build|create|make|write|develop|redesign|refactor)\b.{0,32}\b(page|component|view|homepage|dashboard|form|layout|modal|sidebar|navbar|ui)\b/i,
  /(修复|修|改|fix|resolve|debug).{0,16}(bug|问题|报错|异常|崩溃|error|issue|crash)/i,
];

const SMALL_TASK_PATTERNS = [
  /typo|错别字|拼写|文案/i,
  /单文件小\s*bug|小\s*bug|本地小问题|local\s+small\s+bug/i,
  /只读|状态查询|简单解释|read[-\s]?only|status\s+query|explain/i,
  /只改一处|改这一处|one\s+line|single\s+spot/i,
];

const CONTROL_PLANE_PATTERNS = [
  /^\s*\//,
  /切换模型|查看状态|列出会话|退出|中断|继续会话|model\s+status|show\s+status/i,
];

export function shouldTriggerArchitectureRuntime(
  input: string,
  _context: ArchitectureRuntimeContext = {},
): boolean {
  const text = input.trim();
  if (!text) {
    return false;
  }
  if (CONTROL_PLANE_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  if (SMALL_TASK_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return SYSTEMIC_TRIGGER_PATTERNS.some((pattern) => pattern.test(text));
}

export function collectArchitectureFacts(context: ArchitectureRuntimeContext): string[] {
  const facts: string[] = [];
  const evidence = context.evidence ?? [];
  const usefulEvidence = evidence
    .filter((item) => item.summary || item.source || item.kind)
    .slice(0, 3)
    .map((item) => {
      const kind = item.kind ?? "evidence";
      const source = item.source ?? "unknown-source";
      const summary = item.summary ?? "summary unavailable";
      return `evidence:${kind}:${source}: ${truncate(summary, 120)}`;
    });

  facts.push(...usefulEvidence);

  if (context.index?.status) {
    const project = context.index.projectName ?? "unknown-project";
    const size =
      typeof context.index.nodes === "number" || typeof context.index.edges === "number"
        ? ` nodes=${context.index.nodes ?? "unknown"} edges=${context.index.edges ?? "unknown"}`
        : "";
    const stale = context.index.staleHint
      ? ` staleHint=${truncate(context.index.staleHint, 80)}`
      : "";
    facts.push(`index:${project}: status=${context.index.status}${size}${stale}`);
  }

  if (context.permissionMode) {
    facts.push(
      `runtime: permissionMode=${context.permissionMode}; Architecture Runtime does not change it`,
    );
  }

  if (facts.length === 0) {
    facts.push(
      "unknown: no verified README/package/source/index/evidence facts are available in this request",
    );
  }

  if (requiresFreshnessEvidence(facts.join("\n"))) {
    facts.push(
      "stale: external/current-version claims require Freshness/Web Evidence before being treated as facts",
    );
  }

  return facts.slice(0, 5);
}

export function createArchitectureCard(
  input: string,
  context: ArchitectureRuntimeContext = {},
): ArchitectureCard {
  const target = summarizeArchitectureTarget(input);
  const projectFacts = collectArchitectureFacts(context);
  addFreshnessFactFromInput(projectFacts, input);
  return {
    target,
    projectFacts,
    recommendedApproach:
      "先在主屏给出 1-2 行行动摘要，完整 Architecture Card 仅保留在内部记录；再按现有 Start Gate、Plan、权限和工具链路做最小分阶段实现。",
    rejectedApproaches: [
      "不把 Architecture Runtime 变成第五权限模式、agent、ADR DB 或完整 spec 平台。",
      "不为小修、状态查询或简单解释强制进入 Plan。",
    ],
    stagedBreakdown: [
      "确认目标、证据和 nonGoals。",
      "按最小影响面分阶段修改。",
      "执行 focused verification，并在 drift 时要求用户确认或更新 card。",
    ],
    risks: [
      "项目事实不足时只能标记 unknown/stale，不能把模型记忆当当前事实。",
      "后续动作可能扩散到未提及模块、依赖或配置，需要 drift check。",
    ],
    verification: [
      "运行与改动范围匹配的最小 focused tests/typecheck。",
      "涉及主链路或多文件改动时保留 verifier/复检，不由 Architecture Runtime 替代。",
    ],
    nonGoals: [
      "不改变 default/auto-review/plan/full-access 四权限模式。",
      "不绕过 Start Gate、permission pipeline 或 Plan approval。",
      "不新增未确认的依赖、配置、agent、DB 或长期 memory。",
      "不替代 Freshness/Web Evidence、Verification Runner 或 verifier。",
    ],
  };
}

export function formatArchitectureCard(card: ArchitectureCard): string {
  return [
    "Architecture Card",
    `- target: ${card.target}`,
    `- projectFacts: ${formatList(card.projectFacts)}`,
    `- recommendedApproach: ${card.recommendedApproach}`,
    `- rejectedApproaches: ${formatList(card.rejectedApproaches)}`,
    `- stagedBreakdown: ${formatList(card.stagedBreakdown)}`,
    `- risks: ${formatList(card.risks)}`,
    `- verification: ${formatList(card.verification)}`,
    `- nonGoals: ${formatList(card.nonGoals)}`,
  ].join("\n");
}

export function summarizeArchitectureCard(card: ArchitectureCard): ArchitectureCardSummary {
  return {
    target: card.target,
    projectFacts: card.projectFacts.slice(0, 3),
    recommendedApproach: card.recommendedApproach,
    risks: card.risks.slice(0, 3),
    verification: card.verification.slice(0, 3),
    nonGoals: card.nonGoals.slice(0, 4),
  };
}

export function createArchitectureRuntimeDirective(card: ArchitectureCard): string {
  // D.14A-R-Fix P1-7 — AntiCodeBlob / LegacyLargeFileDebt 是 prompt-only guidance：
  // 只作为给模型的 system prompt 指令进入此 directive，不是 hard gate、不是
  // pre-write/pre-edit 拦截、不是 linter/AST 阻断、不是权限拒绝。architecture-boundary.ts
  // 的检测器是 standalone helper / 报告用，主链 Write/Edit/MultiEdit/Bash 路径不会自动
  // 调用它阻断写入。下面文案只描述工程建议，不得被理解为会阻断写入的运行时闸门。
  return [
    "ArchitectureRuntime=triggered",
    "主屏只输出 1-2 行面向用户的行动摘要；不要把 Architecture Card、字段名或内部审计结构输出到主屏。",
    "后续动作必须保持与该 card 一致；完整 Architecture Card 仅用于内部记录、details/debug 或验证。",
    "Architecture Runtime 不授权写入、不改变权限模式、不替代 Plan approval、Freshness/Web Evidence 或 verifier。",
    "MaturityDefaults=默认要求成熟方案：信息架构清晰、响应式布局、状态/空态/错误态/加载态完整、可读性优先、语义化结构。避免卡片流水席、营销式 hero、堆内部术语、无意义工程废话。用户不需要额外说'成熟'或'别做丑'。",
    "AntiCodeBlob=新功能、新页面、新流程、长任务、UI 开发、跨文件改动时，默认不把逻辑堆进已有巨型文件。避免 god file、code blob、超长函数（>200行）、深层嵌套（>3层）、无边界全局状态。UI/状态/I-O/provider/runner/doctor/permission/cache/index/verification 等职责边界尽量分清。优先复用项目已有模块、helper、presenter、runtime，不新建第二套系统。如果必须改大文件，保持局部最小改动并说明为什么不能放到已有更合适模块。不为了优雅新增无收益抽象。每个改动要有可验证边界：focused tests、typecheck、check。这不是授权大重构，仍遵守最小改动、权限管道和 evidence/verifier 边界。",
    "LegacyLargeFileDebt=已知历史债：packages/tui/src/index.ts 属 legacy-large-file。老项目里大文件很常见，是 maintenance-risk signal / 维护风险信号，不是违规、不是 permission 拒绝、不是硬禁止（not a violation, not a permission denial）。Architecture Runtime 不授权写入、不改变权限模式、不替代 Start Gate 或 permission pipeline——does not grant write permission；现有 Start Gate / 权限管道仍生效。当任务需要触碰 index.ts 或其他巨型文件时，优先 prompt / ask user 询问用户在两条路径里选择：(1) continue minimal local change / 继续做当前任务的最小局部改动；(2) split plan / 输出拆分计划。用户明确选择继续、或当前修复必须触碰大文件时，可以继续，但保持最小改动、说明范围、跑 focused verification。用户选择拆分时只输出拆分计划，不自动重构。允许必要的 wiring 接线，但不要借机塞无关业务逻辑或大范围重构。modularization 计划仍在 D.14。",
    "LongTaskHint=若任务涉及多步骤或预计超过 3 轮工具调用，主动提示用户可用 /autopilot 或 /plan 进入托管/规划模式，但不强制。",
    formatArchitectureCard(card),
  ].join("\n");
}

export function detectArchitectureDrift(
  card: ArchitectureCard,
  nextAction: ArchitectureNextAction,
): ArchitectureDriftResult {
  const warnings: string[] = [];
  const summary = normalizeText(nextAction.summary ?? "");
  const toolName = nextAction.toolName ?? "";
  const files = nextAction.files ?? extractFiles(nextAction.input);
  const actionText = normalizeText(
    [summary, toolName, JSON.stringify(nextAction.input ?? "")].join("\n"),
  );

  if (addsDependencyOrConfig(toolName, actionText, files)) {
    warnings.push("Architecture drift: dependency/config changed.");
  }

  const unmentionedFiles = files.filter(
    (file) => isArchitectureScopeFile(file) && !isFileCoveredByCard(card, file),
  );
  if (unmentionedFiles.length > 0 && mutatesProject(toolName, actionText)) {
    warnings.push(
      `Architecture drift: scope expanded (${unmentionedFiles.slice(0, 3).join(", ")}).`,
    );
  }

  if (
    nextAction.skipVerification ||
    /skip\s+(test|verification)|不(运行|做).{0,8}(测试|验证)/i.test(summary)
  ) {
    warnings.push("Architecture drift: verification skipped.");
  }

  if (
    nextAction.recommendedApproach &&
    normalizeText(nextAction.recommendedApproach) !== normalizeText(card.recommendedApproach)
  ) {
    warnings.push("Architecture drift: approach changed.");
  }

  const reportArtifactWrite = isReportArtifactWrite(card, toolName, files);
  const reportActionText = normalizeText([summary, toolName, files.join("\n")].join("\n"));
  const factActionText = reportArtifactWrite ? reportActionText : actionText;
  if (nextAction.treatsUnknownOrStaleAsFact || treatsUnknownOrStaleAsFact(card, factActionText)) {
    warnings.push("Architecture drift: stale facts treated as confirmed.");
  }

  const nonGoalActionText = reportArtifactWrite ? reportActionText : actionText;
  if (violatesNonGoals(card, nonGoalActionText)) {
    warnings.push("Architecture drift: non-goal crossed.");
  }

  return { drift: warnings.length > 0, warnings, requiresConfirmation: warnings.length > 0 };
}

function formatList(values: string[]): string {
  return values.map((value) => truncate(value.replace(/\s+/g, " "), 140)).join("; ");
}

function summarizeArchitectureTarget(input: string): string {
  return truncate(
    input
      .replace(/[\w./\\-]+\.(?:md|json|ts|tsx|js|jsx|yaml|yml|toml|env)\b/giu, "[target-file]")
      .replace(/"[^"]*\.(?:md|json|ts|tsx|js|jsx|yaml|yml|toml|env)"/giu, '"[target-file]"')
      .replace(/\s+/g, " "),
    120,
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function addFreshnessFactFromInput(facts: string[], input: string): void {
  if (!requiresFreshnessEvidence(input)) {
    return;
  }
  if (facts.some((fact) => fact.startsWith("stale:"))) {
    return;
  }
  facts.push(
    "stale: user request mentions current/latest external facts; require Freshness/Web Evidence before treating them as facts",
  );
}

function requiresFreshnessEvidence(value: string): boolean {
  return /latest|current|最新|当前版本|价格|price|安全公告|security advisory|provider api|第三方方案|community/i.test(
    value,
  );
}

function extractFiles(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }
  const record = input as Record<string, unknown>;
  const candidates = [
    record.file,
    record.path,
    record.file_path,
    record.old_path,
    record.new_path,
    record.files,
  ]
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  return [...new Set(candidates)];
}

function addsDependencyOrConfig(toolName: string, actionText: string, files: string[]): boolean {
  if (
    toolName === "Bash" &&
    /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update)\b/.test(actionText)
  ) {
    return true;
  }
  return (
    ["Write", "Edit", "MultiEdit"].includes(toolName) &&
    files.some((file) =>
      /package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig|vite\.config|biome\.json|\.env/.test(
        file,
      ),
    )
  );
}

function mutatesProject(toolName: string, actionText: string): boolean {
  return (
    ["Write", "Edit", "MultiEdit", "Bash"].includes(toolName) ||
    /写入|修改|删除|新增|edit|write|delete/.test(actionText)
  );
}

function isArchitectureScopeFile(file: string): boolean {
  return /(?:^|\/)(packages|apps|src|docs\/audit|docs\/delivery)\//i.test(normalizePath(file));
}

function isFileCoveredByCard(card: ArchitectureCard, file: string): boolean {
  const normalizedFile = normalizePath(file);
  const cardText = normalizeText(Object.values(card).flat().join("\n"));
  if (!normalizedFile || cardText.includes(normalizedFile)) {
    return true;
  }
  const parent = normalizedFile.slice(0, normalizedFile.lastIndexOf("/"));
  return Boolean(parent && cardText.includes(parent));
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").toLowerCase();
}

function treatsUnknownOrStaleAsFact(card: ArchitectureCard, actionText: string): boolean {
  const cardHasUnknown = card.projectFacts.some((fact) =>
    /\bunknown\b|\bstale\b|未知|过期/.test(fact),
  );
  if (!cardHasUnknown) {
    return false;
  }
  return /confirmed|certain|definitely|已确认|确定|当前最新|latest/.test(actionText);
}

function isReportArtifactWrite(card: ArchitectureCard, toolName: string, files: string[]): boolean {
  if (!["Write", "Edit", "MultiEdit"].includes(toolName) || files.length !== 1) {
    return false;
  }

  const file = normalizePath(files[0]);
  const fileName = file.split("/").pop() ?? "";
  const cardText = normalizeText([card.target, card.recommendedApproach].join("\n"));
  return /\.md$/.test(file) && /report|报告/.test([cardText, fileName].join("\n"));
}

function violatesNonGoals(card: ArchitectureCard, actionText: string): boolean {
  const nonGoalText = normalizeText(card.nonGoals.join("\n"));
  const checks: Array<[RegExp, RegExp]> = [
    [/agent/, /新增|创建|add|create|agent/],
    [
      /db|数据库/,
      /(?:新增|创建|引入|安装|配置|add|create|introduce|install|configure).{0,32}(?:db|database|数据库)/,
    ],
    [/长期 memory|long[-\s]?term memory/, /长期\s*memory|long[-\s]?term memory/],
    [/权限模式|permission mode/, /新增.{0,12}权限模式|fifth permission|new permission mode/],
    [
      /freshness|web evidence/,
      /跳过.{0,12}(freshness|web evidence|联网证据)|skip.{0,12}(freshness|web evidence)/,
    ],
  ];
  return checks.some(
    ([nonGoalPattern, actionPattern]) =>
      nonGoalPattern.test(nonGoalText) && actionPattern.test(actionText),
  );
}
