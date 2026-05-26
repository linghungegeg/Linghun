import type { Language } from "@linghun/shared";
import { isKnownSlashCommand } from "./task-suggestion.js";

/**
 * ConfigControlPlane — D.13E Step 1
 *
 * 把 14 个配置面板（model / language / permissions / memory / index / mcp /
 * cache / background / remote / hooks / plugins / skills / workflows / trust）
 * 统一成纯函数状态机：
 *
 *   idle ──open──▶ panel_list ──enter──▶ panel_detail ──enter──▶ slash dispatch
 *                       ▲                      │
 *                       └────────back──────────┘
 *                       ▲
 *                       └────close───── idle
 *
 * 设计契约（D.13E 拍板）：
 *   - 只做"导航 + 状态读取"，不做内联编辑、不新增 settings writer。
 *   - 任何写入都通过 dispatch 一个真实 slash（已落在 SLASH_COMMAND_REGISTRY
 *     白名单），由现有 slash handler + 权限管道处理。
 *   - 所有 action.slash 必须通过 isKnownSlashCommand 校验，越界面板/拼写错误
 *     的 slash 在 buildConfigPanels() 内被丢弃，避免暴露假入口。
 *
 * 本模块是纯函数 / 数据驱动，无 IO，无 React state。
 */

export type ConfigPanelId =
  | "model"
  | "language"
  | "permissions"
  | "memory"
  | "index"
  | "mcp"
  | "cache"
  | "background"
  | "remote"
  | "hooks"
  | "plugins"
  | "skills"
  | "workflows"
  | "trust";

export type ConfigPanelAction = {
  id: string;
  labelZh: string;
  labelEn: string;
  /** 必须命中 SLASH_COMMAND_REGISTRY 白名单（含 head 命中规则）。 */
  slash: string;
};

export type ConfigPanel = {
  id: ConfigPanelId;
  titleZh: string;
  titleEn: string;
  summaryZh: string;
  summaryEn: string;
  /** 面板的 root slash（也作为默认 "view" 动作）。 */
  rootSlash: string;
  /** 面板内可选的 next actions（全是 slash 跳转，不内联写入）。 */
  actions: ConfigPanelAction[];
};

export type ConfigState =
  | { phase: "idle" }
  | { phase: "panel_list"; cursor: number }
  | { phase: "panel_detail"; panelId: ConfigPanelId; actionCursor: number };

export type ConfigEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "move"; delta: number }
  | { type: "enter" }
  | { type: "back" };

export type ConfigDispatch = { kind: "none" } | { kind: "slash"; command: string };

export type ConfigStep = {
  next: ConfigState;
  dispatch: ConfigDispatch;
};

/**
 * 14 个面板的固定数据。每个 action 的 slash 都会经过 isKnownSlashCommand 校验；
 * 校验失败的 action 不会出现在最终结构里。
 */
const PANEL_DATA: ReadonlyArray<ConfigPanel> = Object.freeze(
  buildConfigPanelsRaw().map((panel) => ({
    ...panel,
    actions: panel.actions.filter((act) => isKnownSlashCommand(act.slash)),
  })),
);

function buildConfigPanelsRaw(): ConfigPanel[] {
  return [
    {
      id: "model",
      titleZh: "模型",
      titleEn: "Model",
      summaryZh: "查看当前模型 / provider / 角色路由。",
      summaryEn: "Show current model / provider / role routing.",
      rootSlash: "/model",
      actions: [{ id: "view", labelZh: "查看模型", labelEn: "Show model", slash: "/model" }],
    },
    {
      id: "language",
      titleZh: "语言",
      titleEn: "Language",
      summaryZh: "切换 zh-CN / en-US 体验。",
      summaryEn: "Switch zh-CN / en-US UI.",
      rootSlash: "/language",
      actions: [
        { id: "view", labelZh: "切换语言", labelEn: "Switch language", slash: "/language" },
      ],
    },
    {
      id: "permissions",
      titleZh: "权限规则",
      titleEn: "Permissions",
      summaryZh: "查看 / 编辑 allow / ask / deny 规则。",
      summaryEn: "View / edit allow / ask / deny rules.",
      rootSlash: "/permissions",
      actions: [{ id: "view", labelZh: "查看规则", labelEn: "Show rules", slash: "/permissions" }],
    },
    {
      id: "memory",
      titleZh: "记忆",
      titleEn: "Memory",
      summaryZh: "查看 LINGHUN.md / 候选 / 已接受记忆。",
      summaryEn: "Show LINGHUN.md / candidate / accepted memory.",
      rootSlash: "/memory",
      actions: [{ id: "view", labelZh: "查看记忆", labelEn: "Show memory", slash: "/memory" }],
    },
    {
      id: "index",
      titleZh: "索引",
      titleEn: "Index",
      summaryZh: "查看 codebase 索引状态与诊断。",
      summaryEn: "Show codebase index status and doctor.",
      rootSlash: "/index",
      actions: [
        { id: "status", labelZh: "状态", labelEn: "Status", slash: "/index status" },
        { id: "doctor", labelZh: "诊断", labelEn: "Doctor", slash: "/index doctor" },
      ],
    },
    {
      id: "mcp",
      titleZh: "MCP",
      titleEn: "MCP",
      summaryZh: "查看 MCP server 与工具。",
      summaryEn: "Show MCP servers and tools.",
      rootSlash: "/mcp",
      actions: [{ id: "view", labelZh: "查看 MCP", labelEn: "Show MCP", slash: "/mcp" }],
    },
    {
      id: "cache",
      titleZh: "缓存",
      titleEn: "Cache",
      summaryZh: "查看缓存命中与日志。",
      summaryEn: "Show cache hit and log.",
      rootSlash: "/cache",
      actions: [
        { id: "view", labelZh: "查看缓存", labelEn: "Show cache", slash: "/cache" },
        { id: "log", labelZh: "查看日志", labelEn: "Show log", slash: "/cache-log" },
      ],
    },
    {
      id: "background",
      titleZh: "后台任务",
      titleEn: "Background",
      summaryZh: "查看后台 job 与远程任务。",
      summaryEn: "Show background jobs and remote tasks.",
      rootSlash: "/background",
      actions: [
        { id: "view", labelZh: "查看后台", labelEn: "Show background", slash: "/background" },
        { id: "job", labelZh: "查看 job", labelEn: "Show jobs", slash: "/job" },
      ],
    },
    {
      id: "remote",
      titleZh: "远程",
      titleEn: "Remote",
      summaryZh: "查看远程会话与控制平面。",
      summaryEn: "Show remote sessions and control plane.",
      rootSlash: "/remote",
      actions: [{ id: "view", labelZh: "查看远程", labelEn: "Show remote", slash: "/remote" }],
    },
    {
      id: "hooks",
      titleZh: "Hooks",
      titleEn: "Hooks",
      summaryZh: "查看 hooks 启用与诊断。",
      summaryEn: "Show hook enablement and doctor.",
      // /hooks 在 registry 中以 capabilityId=hooks 但 slash=/doctor 表示，
      // 这里直接走 doctor 子命令，避免暴露不在白名单的 /hooks。
      rootSlash: "/doctor",
      actions: [{ id: "doctor", labelZh: "诊断 hooks", labelEn: "Hook doctor", slash: "/doctor" }],
    },
    {
      id: "plugins",
      titleZh: "插件",
      titleEn: "Plugins",
      summaryZh: "查看插件 manifest 与诊断。",
      summaryEn: "Show plugin manifests and doctor.",
      rootSlash: "/plugins",
      actions: [{ id: "view", labelZh: "查看插件", labelEn: "Show plugins", slash: "/plugins" }],
    },
    {
      id: "skills",
      titleZh: "技能",
      titleEn: "Skills",
      summaryZh: "查看本地 skill 摘要。",
      summaryEn: "Show local skill summaries.",
      rootSlash: "/skills",
      actions: [{ id: "view", labelZh: "查看技能", labelEn: "Show skills", slash: "/skills" }],
    },
    {
      id: "workflows",
      titleZh: "工作流",
      titleEn: "Workflows",
      summaryZh: "查看可用工作流模板。",
      summaryEn: "Show available workflow templates.",
      rootSlash: "/workflows",
      actions: [
        { id: "view", labelZh: "查看工作流", labelEn: "Show workflows", slash: "/workflows" },
      ],
    },
    {
      id: "trust",
      titleZh: "信任",
      titleEn: "Trust",
      summaryZh: "查看 / 调整本项目信任级别。",
      summaryEn: "Show / adjust project trust level.",
      rootSlash: "/trust",
      actions: [{ id: "view", labelZh: "查看信任", labelEn: "Show trust", slash: "/trust" }],
    },
  ];
}

export function getConfigPanels(): ReadonlyArray<ConfigPanel> {
  return PANEL_DATA;
}

export function findConfigPanel(id: ConfigPanelId): ConfigPanel | undefined {
  return PANEL_DATA.find((p) => p.id === id);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 根据当前 state + event 计算下一个 state 和可选 dispatch。
 *
 * - move 用 clamp（不 wrap），避免上下越界后跳到对侧造成误操作。
 * - enter 在 panel_list 进入面板详情；在 panel_detail dispatch 当前 action 的 slash。
 * - back 从详情回到列表（保留列表 cursor 为该面板索引）。
 * - close 永远回到 idle。
 */
export function reduceConfigState(state: ConfigState, event: ConfigEvent): ConfigStep {
  switch (event.type) {
    case "open": {
      if (state.phase !== "idle") return { next: state, dispatch: { kind: "none" } };
      return { next: { phase: "panel_list", cursor: 0 }, dispatch: { kind: "none" } };
    }
    case "close": {
      return { next: { phase: "idle" }, dispatch: { kind: "none" } };
    }
    case "move": {
      if (state.phase === "panel_list") {
        const next = clamp(state.cursor + event.delta, 0, PANEL_DATA.length - 1);
        return { next: { phase: "panel_list", cursor: next }, dispatch: { kind: "none" } };
      }
      if (state.phase === "panel_detail") {
        const panel = findConfigPanel(state.panelId);
        const max = (panel?.actions.length ?? 1) - 1;
        const next = clamp(state.actionCursor + event.delta, 0, Math.max(0, max));
        return {
          next: { phase: "panel_detail", panelId: state.panelId, actionCursor: next },
          dispatch: { kind: "none" },
        };
      }
      return { next: state, dispatch: { kind: "none" } };
    }
    case "enter": {
      if (state.phase === "panel_list") {
        const panel = PANEL_DATA[state.cursor];
        if (!panel) return { next: state, dispatch: { kind: "none" } };
        return {
          next: { phase: "panel_detail", panelId: panel.id, actionCursor: 0 },
          dispatch: { kind: "none" },
        };
      }
      if (state.phase === "panel_detail") {
        const panel = findConfigPanel(state.panelId);
        const action = panel?.actions[state.actionCursor];
        if (!action) return { next: state, dispatch: { kind: "none" } };
        return { next: state, dispatch: { kind: "slash", command: action.slash } };
      }
      return { next: state, dispatch: { kind: "none" } };
    }
    case "back": {
      if (state.phase === "panel_detail") {
        const idx = PANEL_DATA.findIndex((p) => p.id === state.panelId);
        return {
          next: { phase: "panel_list", cursor: idx >= 0 ? idx : 0 },
          dispatch: { kind: "none" },
        };
      }
      if (state.phase === "panel_list") {
        return { next: { phase: "idle" }, dispatch: { kind: "none" } };
      }
      return { next: state, dispatch: { kind: "none" } };
    }
    default: {
      const _exhaustive: never = event;
      return { next: state, dispatch: { kind: "none" } };
    }
  }
}

/** 取面板的本地化标题 / 摘要，view-model 层只复用，不做字符串拼接。 */
export function getPanelText(
  panel: ConfigPanel,
  language: Language,
): { title: string; summary: string } {
  if (language === "en-US") return { title: panel.titleEn, summary: panel.summaryEn };
  return { title: panel.titleZh, summary: panel.summaryZh };
}

export function getActionLabel(action: ConfigPanelAction, language: Language): string {
  return language === "en-US" ? action.labelEn : action.labelZh;
}
