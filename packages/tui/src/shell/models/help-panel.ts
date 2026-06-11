import type { Language } from "@linghun/shared";

/**
 * D.13Q-UX — HelpPanel 模型
 *
 * 把 /help 的 short / advanced / details 三组命令收敛成结构化数据，
 * 让 HelpPanel UI 可以 Tab 切换、↑↓ 选择、Enter dispatch slash。
 * 隐藏命令（userVisible=false / 例如 /status）永远过滤；plain TUI
 * 仍走 formatCatalogHelp 文本表 fallback。
 *
 * CCB HelpV2 范式：tabs by group + 只读 Select；本模块不引入新功能、
 * 不复制 CCB 源码；命令清单与 slash-dispatch 中的现有清单对齐。
 */

export type HelpPanelGroup = "core" | "advanced" | "details";

export type HelpPanelEntry = {
  /** 命令文本，例如 "/model"。 */
  slash: string;
  /** user-facing 描述。 */
  description: string;
};

export type HelpPanelData = {
  /** 当前 active 分组。 */
  group: HelpPanelGroup;
  /** 当前 cursor 位置（被选中条目下标）。 */
  cursor: number;
  /** 滚动偏移（用于 scroll viewport）。 */
  scrollOffset: number;
  /** 该分组的命令清单。 */
  entries: HelpPanelEntry[];
};

const CORE_ENTRIES_ZH: HelpPanelEntry[] = [
  { slash: "/help", description: "查看命令帮助（all / advanced / details 切换分组）" },
  { slash: "/model", description: "查看 / 切换执行模型与 reasoning level" },
  { slash: "/permissions", description: "查看权限规则与最近被拒列表" },
  { slash: "/mode", description: "切换权限模式（default / auto / plan / full-access）" },
  { slash: "/config", description: "打开配置面板（model / language / permissions 等）" },
  { slash: "/index", description: "查看代码索引状态与刷新入口" },
  { slash: "/details", description: "打开最近输出 / evidence / background 详情面板" },
  { slash: "/exit", description: "退出 Linghun" },
];

const CORE_ENTRIES_EN: HelpPanelEntry[] = [
  { slash: "/help", description: "Show command help (all / advanced / details groups)" },
  { slash: "/model", description: "Show / switch executor model and reasoning level" },
  { slash: "/permissions", description: "Inspect permission rules and recent denials" },
  { slash: "/mode", description: "Switch permission mode (default / auto / plan / full-access)" },
  { slash: "/config", description: "Open the config panel (model / language / permissions ...)" },
  { slash: "/index", description: "Show codebase index status and refresh entry" },
  { slash: "/details", description: "Open recent output / evidence / background details panel" },
  { slash: "/exit", description: "Exit Linghun" },
];

const ADVANCED_ENTRIES_ZH: HelpPanelEntry[] = [
  { slash: "/agents", description: "查看团队智能体与后台 agent 状态" },
  { slash: "/background", description: "查看后台任务列表与详情" },
  { slash: "/job", description: "管理后台任务（start / pause / cancel）" },
  { slash: "/skills", description: "管理技能与启用状态" },
  { slash: "/workflows", description: "查看 workflow 状态与触发入口" },
  { slash: "/handoff", description: "导出会话 handoff packet" },
  { slash: "/branch", description: "基于 handoff 创建会话分支（不是 git 分支）" },
  { slash: "/git", description: "查看 git 状态、稳定点建议、worktree 摘要（只读）" },
  { slash: "/worktree", description: "查看 git worktree 列表（只读）" },
  { slash: "/checkpoint", description: "查看 Linghun snapshot checkpoint / 稳定点建议" },
  { slash: "/cache", description: "查看 cache 使用情况与冷热分布" },
];

const ADVANCED_ENTRIES_EN: HelpPanelEntry[] = [
  { slash: "/agents", description: "Inspect teammate agents and background agent status" },
  { slash: "/background", description: "List background tasks and inspect details" },
  { slash: "/job", description: "Manage background jobs (start / pause / cancel)" },
  { slash: "/skills", description: "Manage skills and their enabled state" },
  { slash: "/workflows", description: "Inspect workflow status and trigger entries" },
  { slash: "/handoff", description: "Export the session handoff packet" },
  { slash: "/branch", description: "Create a session branch from handoff (not a git branch)" },
  {
    slash: "/git",
    description: "Show git status, stable-point hints, worktree summary (read-only)",
  },
  { slash: "/worktree", description: "List git worktrees (read-only)" },
  { slash: "/checkpoint", description: "Inspect Linghun snapshot checkpoints / stable points" },
  { slash: "/cache", description: "Inspect cache usage and hot / cold distribution" },
];

const DETAILS_ENTRIES_ZH: HelpPanelEntry[] = [
  { slash: "/details", description: "展开最近正文 / evidence / background 详情" },
  { slash: "/cache-log", description: "查看 cache log 详情" },
  { slash: "/break-cache", description: "诊断 cache hash 漂移" },
  { slash: "/model doctor", description: "运行模型路由诊断" },
  { slash: "/model route", description: "查看 / 调整模型路由" },
  { slash: "/index doctor", description: "运行索引诊断" },
];

const DETAILS_ENTRIES_EN: HelpPanelEntry[] = [
  { slash: "/details", description: "Expand recent body / evidence / background details" },
  { slash: "/cache-log", description: "Inspect cache log details" },
  { slash: "/break-cache", description: "Diagnose cache hash drift" },
  { slash: "/model doctor", description: "Run model route diagnostics" },
  { slash: "/model route", description: "Inspect / adjust model routes" },
  { slash: "/index doctor", description: "Run codebase index diagnostics" },
];

/**
 * 取本组命令清单。隐藏命令（如 /status）已经在数据层过滤掉，不出现在
 * HelpPanel 主流程；用户仍可通过 /help all 看到完整文本表。
 */
export function getHelpPanelEntries(group: HelpPanelGroup, language: Language): HelpPanelEntry[] {
  if (group === "core") return language === "en-US" ? CORE_ENTRIES_EN : CORE_ENTRIES_ZH;
  if (group === "advanced") return language === "en-US" ? ADVANCED_ENTRIES_EN : ADVANCED_ENTRIES_ZH;
  return language === "en-US" ? DETAILS_ENTRIES_EN : DETAILS_ENTRIES_ZH;
}

export function buildHelpPanelData(
  group: HelpPanelGroup,
  cursor: number,
  scrollOffset: number,
  language: Language,
): HelpPanelData {
  const entries = getHelpPanelEntries(group, language);
  const safe = entries.length === 0 ? 0 : Math.min(Math.max(0, cursor), entries.length - 1);
  return { group, cursor: safe, scrollOffset, entries };
}

export const HELP_PANEL_GROUPS: HelpPanelGroup[] = ["core", "advanced", "details"];
