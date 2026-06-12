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
      "  /batch <goal>         Run isolated worktree batch agents",
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
    "  /batch <目标>          启动隔离 worktree batch 智能体",
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
  const isEn = language === "en-US";
  const lines = [
    isEn ? "Available commands (registry-backed):" : "可用命令（来自命令 registry）：",
  ];
  lines.push(...formatRegistryBackedHelpLines(language));
  lines.push(
    "",
    isEn
      ? "Slash commands, config keys, and transcript event fields stay in English."
      : "普通输入会发送给当前 provider/model，并写入 JSONL transcript。工具命令也会写入 transcript。",
  );
  return lines.join("\n");
}

function formatRegistryBackedHelpLines(language: Language): string[] {
  const catalog = getUserVisibleCommandCapabilities();
  const lines: string[] = [];
  for (const group of COMMAND_GROUP_ORDER) {
    const commands = catalog.filter((item) => item.group === group);
    if (commands.length === 0) continue;
    const label = COMMAND_GROUP_LABELS[group];
    lines.push(language === "en-US" ? `${label.en}:` : `${label.zh}：`);
    const widest = Math.min(Math.max(...commands.map((item) => item.slash.length), 0) + 2, 18);
    for (const command of commands) {
      const title = language === "en-US" ? command.titleEn : command.titleZh;
      const description = language === "en-US" ? command.descriptionEn : command.descriptionZh;
      const risk = command.risk === "readonly" ? "" : ` [${command.risk}]`;
      lines.push(`  ${command.slash.padEnd(widest, " ")}${title} — ${description}${risk}`);
    }
  }
  return lines;
}
