/**
 * Slash command dispatch helpers: discovery, suggestion, help formatting,
 * command-to-tool mapping, and catalog presentation.
 *
 * Pure functions with no IO, no TuiContext mutation, no provider/permission logic.
 * Extracted from index.ts (Slice D.10B) to reduce index.ts size.
 */

import type { Language, PermissionMode } from "@linghun/shared";
import type { ToolName } from "@linghun/tools";
import {
  type CommandCapability,
  type CommandGroup,
  type NaturalIntent,
  getUserVisibleCommandCapabilities,
} from "./natural-command-bridge.js";
import { formatPermissionModeLabel } from "./runtime-status-presenter.js";

// ─── Constants ───────────────────────────────────────────────────────────────

export const COMMAND_GROUP_ORDER: CommandGroup[] = [
  "core",
  "edit",
  "index-mcp",
  "memory-rules",
  "agents-jobs",
  "diagnostics",
  "exit",
];

export const DEFAULT_HELP_SLASHES = [
  "/model",
  "/mode",
  "/doctor",
  "/problems",
  "/help",
  "/memory",
  "/index",
  "/exit",
] as const;

export const COMMAND_GROUP_LABELS: Record<CommandGroup, { en: string; zh: string }> = {
  core: { en: "Core", zh: "核心" },
  edit: { en: "Edit", zh: "编辑" },
  "index-mcp": { en: "Index & MCP", zh: "索引与协议" },
  "memory-rules": { en: "Memory & Rules", zh: "记忆与规则" },
  "agents-jobs": { en: "Agents & Jobs", zh: "代理与任务" },
  diagnostics: { en: "Diagnostics", zh: "诊断" },
  exit: { en: "Exit", zh: "退出" },
};

// ─── Natural command local control-plane constants ───────────────────────────

export const LOCAL_CONTROL_PLANE_CAPABILITY_IDS = new Set([
  "help",
  "features",
  "status",
  "mode",
  "model",
  "index",
  "cache",
  "permissions",
  "hooks",
  "trust",
  "autopilot",
]);

export const LOCAL_READONLY_COMMANDS = new Set([
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

// ─── Slash-to-tool mapping ───────────────────────────────────────────────────

export function slashCommandToTool(command: string): ToolName | null {
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

// ─── Help / Discovery / Unknown command formatting ───────────────────────────

export function formatCatalogHelp(
  language: Language,
  mode: PermissionMode = "default",
  showAll = false,
  variant: "short" | "all" | "advanced" | "details" = "short",
): string {
  // D13E-P3: differentiate /help all vs /help advanced vs /help details so the
  // short core list isn't the only branch. `showAll` is preserved for the old
  // boolean call-site (treated as "all"). `variant` is the canonical knob.
  const effective: "short" | "all" | "advanced" | "details" = showAll ? "all" : variant;
  if (effective === "all") {
    return formatHelp(language);
  }
  if (effective === "advanced") {
    return formatHelpAdvanced(language);
  }
  if (effective === "details") {
    return formatHelpDetails(language);
  }
  const lines =
    language === "en-US"
      ? [
          "Help: describe your goal directly first.",
          `Current mode: ${formatPermissionModeLabel(mode, language)} — ${formatModeBehavior(mode, language)}`,
          "Core entries:",
          "(Hidden commands still work — /help all shows the full list.)",
        ]
      : [
          "帮助：优先直接描述你的目标。",
          `当前模式：${formatPermissionModeLabel(mode, language)} — ${formatModeBehavior(mode, language)}`,
          "核心入口：",
          "（未显示不等于不能用，/help all 查看完整命令表）",
        ];
  lines.push(...formatDefaultCommandLines(language));
  lines.push(
    language === "en-US"
      ? "Full command list: /help all, /help advanced, or /help details."
      : "完整命令表：/help all、/help advanced 或 /help details。",
  );
  lines.push(
    language === "en-US"
      ? "Tip: type / or /? for the same short discovery view."
      : "提示：输入 / 或 /? 会显示同样的短候选。",
  );
  return lines.join("\n");
}

export function formatSlashDiscovery(language: Language, prefix = "/"): string {
  const trimmed = prefix.trim();
  const candidates = trimmed === "/" || trimmed === "/?" ? [] : getSlashPrefixCandidates(trimmed);
  if (candidates.length > 0) {
    const lines =
      language === "en-US" ? [`Slash candidates for ${trimmed}:`] : [`${trimmed} 的候选命令：`];
    lines.push(...formatColumnAlignedCandidates(candidates, language));
    lines.push(language === "en-US" ? "Full command list: /help all." : "完整命令表：/help all。");
    return lines.join("\n");
  }
  const lines =
    language === "en-US"
      ? ["Describe your goal directly first.", "Core slash entries:"]
      : ["优先直接描述你的目标。", "核心 slash 入口："];
  lines.push(...formatDefaultCommandLines(language));
  lines.push(
    language === "en-US"
      ? "Type a slash prefix (e.g. /p, /ca) to filter; /help all shows the full list."
      : "继续输入前缀（例如 /p、/ca）可筛选；/help all 查看完整命令表。",
  );
  return lines.join("\n");
}

// D.13P Slash discovery polish:
// - 前缀候选必须命中完整 user-visible registry（/skills /plugins /workflows 等高级命令），
//   不再只限于 DEFAULT_HELP_SLASHES。
// - /status 仍隐藏：getUserVisibleCommandCapabilities 已经过滤掉 hiddenReason 项。
// - /config 等用户可见命令进入候选，与 /help all 保持一致。
// - 上限固定 8 条，避免炸屏。
export function getSlashPrefixCandidates(prefix: string): CommandCapability[] {
  if (!prefix.startsWith("/") || prefix.length <= 1) return [];
  const normalized = prefix.toLowerCase();
  return getUserVisibleCommandCapabilities()
    .filter((item) => item.slash.toLowerCase().startsWith(normalized))
    .slice(0, 8);
}

/**
 * Core slash candidates surfaced when the user types just `/` and nothing else.
 * Returns the same DEFAULT_HELP_SLASHES set used by /help discovery (max 8),
 * keeping the inline overlay narrow without炸屏. Used by the Composer as a
 * soft onboarding affordance — not an alternate dispatch path.
 */
export function getCoreSlashCandidates(): CommandCapability[] {
  return getDefaultVisibleCommandCapabilities().slice(0, 8);
}

export function formatUnknownSlashCommand(command: string, language: Language): string {
  const suggestions = suggestSlashCommands(command);
  if (suggestions.length === 0) {
    return language === "en-US"
      ? `Unknown command: ${command}. Type /help to see available commands.`
      : `未知命令：${command}。输入 /help 查看可用命令。`;
  }
  const joined = suggestions.map((item) => item.slash).join(" / ");
  return language === "en-US"
    ? `Unknown command: ${command}. Did you mean ${joined}? Type /help for groups.`
    : `未知命令：${command}。你是不是想用 ${joined}？输入 /help 查看分组。`;
}

// ─── Natural command control-plane predicates ────────────────────────────────

export function looksLikeOrdinaryDevelopmentRequest(text: string): boolean {
  return /分析|实现|修复|部署|报告|生成|输出|项目|技术栈|代码|开发|写|改|新增|导出|bug|analy[sz]e|implement|fix|deploy|report|generate|project|tech stack|code|write|export/iu.test(
    text,
  );
}

export function looksLikeWorkspaceTrustNaturalRequest(text: string): boolean {
  return /信任.*(?:项目|工作区)|调整.*工作区信任|workspace trust|trust this (?:folder|project)/iu.test(
    text,
  );
}

export function shouldDispatchLocalReadonlyIntent(
  intent: NaturalIntent,
): intent is NaturalIntent & { command: string } {
  return intent.action === "execute_readonly" && isAllowedLocalReadonlyCommand(intent.command);
}

export function isAllowedLocalReadonlyCommand(command: string | undefined): command is string {
  return Boolean(command && LOCAL_READONLY_COMMANDS.has(command));
}

export function isReadonlyPermissionsStatus(intent: NaturalIntent): boolean {
  return (
    intent.capability?.id === "permissions" &&
    intent.inquiry === "status" &&
    intent.confidence >= 0.8 &&
    intent.command === "/permissions"
  );
}

export function isAllowedModeStartGate(
  intent: NaturalIntent,
): intent is NaturalIntent & { command: string } {
  return (
    intent.action === "start_gate" &&
    intent.capability?.id === "mode" &&
    typeof intent.command === "string" &&
    /^\/mode (?:default|auto-review|plan|full-access)$/u.test(intent.command)
  );
}

export function isWorkspaceTrustNaturalStartGate(
  intent: NaturalIntent,
): intent is NaturalIntent & { command: string } {
  return (
    intent.action === "start_gate" &&
    intent.capability?.id === "trust" &&
    intent.command === "/trust status"
  );
}

export function isAllowedLocalCapabilityAnswer(intent: NaturalIntent): boolean {
  return (
    intent.confidence >= 0.85 &&
    (intent.capability?.id === "help" || intent.capability?.id === "features") &&
    (intent.inquiry === "usage" || intent.inquiry === "howto" || intent.inquiry === "status")
  );
}

// ─── Mode behavior formatting ────────────────────────────────────────────────

export function formatModeBehavior(mode: PermissionMode, language: Language): string {
  const zh: Record<PermissionMode, string> = {
    default: "风险动作会先确认。",
    "auto-review": "低风险编辑更顺滑，高风险仍确认。",
    plan: "只规划，不直接改。",
    "full-access": "本地开启后减少确认，安全边界仍生效。",
  };
  const en: Record<PermissionMode, string> = {
    default: "Risky actions ask first.",
    "auto-review": "Low-risk edits are smoother; high-risk still asks.",
    plan: "Plans and explains; does not edit directly.",
    "full-access": "Local opt-in reduces prompts; safety boundaries remain.",
  };
  return language === "en-US" ? en[mode] : zh[mode];
}

export function formatModeBehaviorLines(language: Language): string[] {
  const modes: PermissionMode[] = ["default", "auto-review", "plan", "full-access"];
  return [
    language === "en-US" ? "Mode behavior:" : "模式差异：",
    ...modes.map((mode) => `- ${mode}: ${formatModeBehavior(mode, language)}`),
  ];
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function formatDefaultCommandLines(language: Language): string[] {
  const catalog = getDefaultVisibleCommandCapabilities();
  return formatColumnAlignedCandidates(catalog, language);
}

// D.13P Slash discovery polish — column-aligned candidate rendering.
// 旧版本是 "- /xxx — 标题：说明"，长度参差且 emdash 在窄终端不齐；
// 改成 "/xxx        标题" 两列对齐，左列固定宽度（按最长 slash 取整 + 2 空格），
// 上限 8 条，左列 cap=14（覆盖现有最长命令 /claim-check / /permissions 12 字符）。
export function formatColumnAlignedCandidates(
  candidates: CommandCapability[],
  language: Language,
): string[] {
  const items = candidates.slice(0, 8);
  if (items.length === 0) return [];
  const widest = items.reduce((acc, item) => Math.max(acc, item.slash.length), 0);
  const colWidth = Math.min(Math.max(widest + 2, 12), 14);
  return items.map((item) => {
    const title = language === "en-US" ? item.titleEn : item.titleZh;
    return `${item.slash.padEnd(colWidth, " ")}${title}`;
  });
}

function formatGroupedCommandLines(language: Language): string[] {
  const catalog = getUserVisibleCommandCapabilities();
  const lines: string[] = [];
  for (const group of COMMAND_GROUP_ORDER) {
    const commands = catalog.filter((item) => item.group === group);
    if (commands.length === 0) continue;
    const label = COMMAND_GROUP_LABELS[group];
    lines.push(`- ${language === "en-US" ? label.en : label.zh}`);
    for (const row of wrapSlashNames(commands.map((item) => item.slash))) {
      lines.push(`  ${row}`);
    }
  }
  return lines;
}

function getDefaultVisibleCommandCapabilities(): CommandCapability[] {
  const all = getUserVisibleCommandCapabilities();
  return DEFAULT_HELP_SLASHES.map((slash) => all.find((item) => item.slash === slash)).filter(
    (item): item is CommandCapability => Boolean(item),
  );
}

function wrapSlashNames(names: string[], maxWidth = 72): string[] {
  const rows: string[] = [];
  let row = "";
  for (const name of names) {
    const next = row ? `${row}  ${name}` : name;
    if (next.length > maxWidth && row) {
      rows.push(row);
      row = name;
      continue;
    }
    row = next;
  }
  if (row) rows.push(row);
  return rows;
}

function suggestSlashCommands(command: string): CommandCapability[] {
  const normalized = command.toLowerCase();
  return getUserVisibleCommandCapabilities()
    .map((item) => ({ item, score: scoreSlashSuggestion(normalized, item.slash.toLowerCase()) }))
    .filter((entry) => entry.score < 4)
    .sort((a, b) => a.score - b.score || a.item.slash.localeCompare(b.item.slash))
    .slice(0, 3)
    .map((entry) => entry.item);
}

function scoreSlashSuggestion(input: string, slash: string): number {
  if (slash === input) return 0;
  if (slash.startsWith(input) || input.startsWith(slash)) return 1;
  if (slash.includes(input.slice(1)) || input.includes(slash.slice(1))) return 2;
  return boundedEditDistance(input, slash, 3);
}

function boundedEditDistance(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = current[0] ?? i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? maxDistance) + 1,
        (current[j - 1] ?? maxDistance) + 1,
        (previous[j - 1] ?? maxDistance) + cost,
      );
      current[j] = value;
      rowBest = Math.min(rowBest, value);
    }
    if (rowBest > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length] ?? maxDistance + 1;
}

function formatHelpAdvanced(language: Language): string {
  // D13E-P3 /help advanced: surface advanced / recovery / diagnostic / agent /
  // job / provider / index / mcp / plugin / skill / workflow entries without
  // the noise of basic CRUD slashes that already live in /help short.
  if (language === "en-US") {
    return [
      "Advanced commands:",
      "  /model setup          Configure provider, key, model, reasoning",
      "  /model route          Show role-based model routes",
      "  /model route doctor   Diagnose role provider/model/capability/budget",
      "  /model route set <role> <model>  Set one role route",
      "  /permissions          Show permission rules",
      "  /memory               Show memory and handoff status",
      "  /memory review        Review candidate memories before accepting",
      "  /memory learn [on|off|status]  Toggle auto-learning",
      "  /mcp                  Show MCP server status",
      "  /mcp doctor           Diagnose MCP server availability",
      "  /skills               List local skills metadata",
      "  /plugins              List local plugin manifests",
      "  /workflows            List workflow templates",
      "  /index status         Show fast codebase-memory status",
      "  /index doctor         Diagnose bundled/managed codebase-memory",
      "  /index check          Run explicit freshness check",
      "  /background           Show background task summaries",
      "  /job                  Manage local durable jobs",
      "  /agents               List agent status, transcripts, usage",
      "  /agents show <id>     Show one agent detail",
      "  /agents cancel <id>   Interrupt one agent",
      "  /fork <type> <task>   Start explorer/planner/verifier/worker",
      "  /rewind               List Linghun snapshot checkpoints (not git reset)",
      "  /git [status|stable|worktree|doctor]  Git status / stable-point hint / worktree (read-only)",
      "  /worktree             List git worktrees (read-only)",
      "  /checkpoint [list|stable]   Linghun snapshot checkpoints and stable-point hints",
      "  /verify [plan|last|smoke]  Generate or run verification",
      "  /compact              Compact long conversation context",
      "  /trust                Show or change workspace trust",
      "  /remote               Manage remote sessions",
      "  /config               Consolidated configuration overview",
      "Use /help all for the full command list, /help details for debug entries.",
    ].join("\n");
  }
  return [
    "高级命令：",
    "  /model setup          配置 provider、key、模型与推理等级",
    "  /model route          查看角色模型路由",
    "  /model route doctor   诊断角色 provider/model/capability/budget",
    "  /model route set <role> <model>  设置单角色路由",
    "  /permissions          查看权限规则",
    "  /memory               查看记忆与 handoff 状态",
    "  /memory review        审查候选记忆",
    "  /memory learn [on|off|status]  开关自动学习",
    "  /mcp                  查看 MCP 状态",
    "  /mcp doctor           诊断 MCP server 可用性",
    "  /skills               列出本地 skill metadata",
    "  /plugins              列出本地 plugin manifest",
    "  /workflows            列出 workflow 模板",
    "  /index status         查看 fast 索引状态",
    "  /index doctor         诊断 bundled/managed 索引 runtime",
    "  /index check          显式运行 detect_changes",
    "  /background           查看后台任务摘要",
    "  /job                  管理本地 durable job",
    "  /agents               查看 agent 状态、transcript、usage",
    "  /agents show <id>     查看单个 agent 详情",
    "  /agents cancel <id>   中断单个 agent",
    "  /fork <类型> <任务>    派生 explorer/planner/verifier/worker",
    "  /rewind               列出 Linghun snapshot checkpoint（不是 git reset）",
    "  /git [status|stable|worktree|doctor]  Git 状态 / 稳定点建议 / worktree（只读）",
    "  /worktree             查看 git worktree 列表（只读）",
    "  /checkpoint [list|stable]   查看 Linghun snapshot checkpoint 与稳定点建议",
    "  /verify [plan|last|smoke]  生成或运行验证",
    "  /compact              压缩长对话上下文",
    "  /trust                查看或更改工作区信任",
    "  /remote               管理远程会话",
    "  /config               统一配置面板",
    "使用 /help all 查看完整命令表；/help details 查看调试入口。",
  ].join("\n");
}

function formatHelpDetails(language: Language): string {
  // D13E-P3 /help details: details / debug entries that aren't surfaced in the
  // short core list or the advanced view. Kept small so the output is scannable.
  if (language === "en-US") {
    return [
      "Details and debug commands:",
      "  /details              Open evidence/background/details panel",
      "  /diff                 Show changed file summary",
      "  /todo                 Show tasks",
      "  /todo add <text>      Add a task",
      "  /todo start|done|block <id>  Update task state",
      "  /usage                Show token/cache usage summary",
      "  /stats                Show local cache/cost statistics",
      "  /stats endpoints      Group usage by endpoint",
      "  /cache status         Show cache status and freshness",
      "  /cache-log            Show recent cache usage records",
      "  /break-cache status   Show cache freshness changes",
      "  /sessions             List sessions",
      "  /sessions resume <id> Resume a session via structured handoff",
      "  /resume [id]          Resume latest session without full transcript",
      "  /branch [purpose]     Create a branch session from handoff",
      "  /git [status|stable|worktree|doctor]  Git status / stable-point hint / worktree (read-only)",
      "  /worktree             List git worktrees (read-only)",
      "  /checkpoint [list|stable]   Linghun snapshot checkpoints / stable-point hints",
      "  /problems             Show local Problems Lite summary",
      "  /doctor               Show terminal readiness checklist",
      "  /doctor project       Project Doctor sections",
      "  /doctor hooks         Diagnose hook sources/events/timeouts",
      "  /doctor runner        Diagnose native runner resolver",
      "  /interrupt            Mark current background task cancelled",
      "  /claim-check <claim>  Downgrade unsupported final claims",
      "  /btw <question>       Insert a temporary question",
      "  /review               Review diff, risks, evidence",
      "  /vision <path>        Record VisionObservation evidence",
      "  /image generate <prompt>  Generate image asset metadata",
      "Use /help all for the full command list, /help advanced for advanced.",
    ].join("\n");
  }
  return [
    "详情与调试命令：",
    "  /details              打开 evidence/background/details 详情面板",
    "  /diff                 查看本轮工具改动摘要",
    "  /todo                 查看任务",
    "  /todo add <text>      添加任务",
    "  /todo start|done|block <id>  更新任务状态",
    "  /usage                查看 token/cache usage 汇总",
    "  /stats                查看本地 cache/cost 统计",
    "  /stats endpoints      按 endpoint 聚合 usage",
    "  /cache status         查看 cache 状态与 freshness",
    "  /cache-log            查看最近 cache usage 记录",
    "  /break-cache status   查看 cache freshness 变化",
    "  /sessions             列出会话",
    "  /sessions resume <id> 基于结构化 handoff 恢复会话",
    "  /resume [id]          恢复最近会话，不注入完整历史",
    "  /branch [目的]        基于 handoff 创建分支会话（会话分支，不是 git 分支）",
    "  /git [status|stable|worktree|doctor]  Git 状态 / 稳定点建议 / worktree（只读）",
    "  /worktree             查看 git worktree 列表（只读）",
    "  /checkpoint [list|stable]   查看 Linghun snapshot checkpoint / 稳定点建议",
    "  /problems             查看 Problems Lite 摘要",
    "  /doctor               查看就绪 checklist",
    "  /doctor project       Project Doctor 小节",
    "  /doctor hooks         诊断 hook 来源/事件/超时",
    "  /doctor runner        诊断 native runner 解析器",
    "  /interrupt            标记当前后台任务取消",
    "  /claim-check <claim>  降级缺少证据的结论",
    "  /btw <question>       插入临时问题",
    "  /review               审查 diff/风险/证据",
    "  /vision <path>        记录 VisionObservation evidence",
    "  /image generate <prompt>  生成图片资产 metadata",
    "使用 /help all 查看完整命令表；/help advanced 查看高级入口。",
  ].join("\n");
}

function formatHelp(language: Language): string {
  if (language === "en-US") {
    return `Available commands:
  /help                 Show help
  /features             Show default feature policy and disabled automation boundaries
  /language zh-CN|en-US Switch UI language
  /model                Show current model
  /model setup          Configure API address, key, model, and reasoning level
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
  /workflows plan <goal> Preview a workflow plan without executing
  /workflows run <goal> Start a real durable workflow job
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
  /git [status|stable|worktree|doctor]  Git status / stable-point hint / worktree (read-only)
  /worktree             List git worktrees (read-only)
  /checkpoint [list|stable]   Linghun snapshot checkpoints and stable-point hints
  /memory               Show memory and handoff status
  /memory storage       Show sessions/memory/log/cache storage paths
  /memory review        Review candidate memories before accepting
  /memory learn [on|off|status]  Toggle auto-learning or show learning status
  /memory accept <id>   Accept a candidate memory
  /memory delete <id>   Delete a candidate memory in this session
  /memory forget <id>   Alias for /memory delete
  /memory init          Create a basic LINGHUN.md template on explicit request
  /memory import sessions [source] [query]  Import external AI session summary/evidence only
  /failures             Show reusable lessons from real failures (provider/tool/verification/git/final-gate/report-guard/resource-cap)
  /failures resolve <id>  Mark a failure lesson resolved (stops surfacing it to the model)
  /failures ignore <id>   Mute a failure lesson without deleting it
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
  /compact              Compact long conversation context on request
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
  /config               Show consolidated configuration overview with next actions
  /exit                 Exit

Slash commands, config keys, and transcript event fields stay in English.`;
  }
  return `可用命令：
  /help                 显示帮助
  /features             查看默认功能策略与关闭的自动化边界
  /language zh-CN|en-US 切换界面语言
  /model                显示当前模型
  /model setup          配置 API 地址、key、模型名称和推理等级
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
  /workflows plan <目标>  预览 workflow 计划，不执行
  /workflows run <目标>   启动真实 durable workflow job
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
  /git [status|stable|worktree|doctor]  Git 状态 / 稳定点建议 / worktree（只读）
  /worktree             查看 git worktree 列表（只读）
  /checkpoint [list|stable]   查看 Linghun snapshot checkpoint 与稳定点建议
  /memory               查看记忆与 handoff 状态
  /memory storage       查看会话/记忆/日志/cache 存储路径
  /memory review        审查候选记忆
  /memory learn [on|off|status]  开关自动学习或查看学习状态
  /memory accept <id>   确认写入候选记忆记录
  /memory delete <id>   删除本会话候选/已接收记忆记录
  /memory forget <id>   等同 /memory delete
  /memory init          显式生成基础 LINGHUN.md 模板
  /memory import sessions [source] [query]  只导入外部 AI 会话摘要和证据引用
  /failures             查看从真实失败（provider/工具/验证/git/最终回答降级/报告守卫/并发上限）提取的可复用教训
  /failures resolve <id>  标记某条失败教训已解决（不再投影给模型）
  /failures ignore <id>   忽略某条失败教训但保留记录
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
  /compact              按需压缩长对话上下文
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
  /config               一站式查看当前模型/权限/语言/索引/MCP/记忆/缓存/后台/远程/钩子/插件/技能/工作流
  /exit                 退出

普通输入会发送给当前 provider/model，并写入 JSONL transcript。工具命令也会写入 transcript。`;
}
