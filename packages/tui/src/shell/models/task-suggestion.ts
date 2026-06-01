import type { Language } from "@linghun/shared";
import { SLASH_COMMAND_REGISTRY } from "../../natural-command-bridge.js";
import type { ProductBlockViewModel, TaskPermissionView } from "../types.js";

/**
 * TaskSuggestionModel — D.13E Step 1
 *
 * 把 slash candidates、setup hint、permission next actions、config next actions、
 * tool error retry 五种来源统一成 TaskSuggestion[]。所有 action 必须命中
 * SLASH_COMMAND_REGISTRY 白名单（除 details 这类 inline 动作外），不允许
 * 出现假候选 / 拼写错误的 slash。
 *
 * 优先级（从高到低）：
 *   permission > tool_error > setup > config > slash
 *
 * 本模块是纯函数，无 IO，无 React state；仅作为 view-model.ts 的输入合成层。
 */

export type TaskSuggestionSource = "slash" | "setup" | "permission" | "config" | "tool_error";

export type TaskSuggestionAction =
  | { kind: "slash"; command: string }
  | { kind: "inline"; id: string };

export type TaskSuggestion = {
  id: string;
  source: TaskSuggestionSource;
  label: string;
  hint?: string;
  action: TaskSuggestionAction;
};

export type SuggestionInputs = {
  language: Language;
  /** 来自 setup flow 的提示，对应 view-model.ts 已存在的 setupHint。 */
  setupHint?: string;
  /** 触发权限卡时的 next actions 候选；本轮只生成 details 与 always-allow 两条。 */
  permission?: TaskPermissionView;
  /** 最近 fail/blocked 的 output blocks，决定 tool_error 候选。 */
  failBlocks?: ProductBlockViewModel[];
  /** 用户输入 / 头部，用于触发 slash 候选的真实白名单。 */
  slashCandidates?: { slash: string; label: string }[];
  /** 当 viewMode = task / pending 时，可附加常用 config next actions。 */
  configHints?: { id: string; label: string; slash: string }[];
};

export type TaskSuggestionLimits = {
  /** UI 最多渲染几条；超过的会按优先级裁剪。默认 4。 */
  max?: number;
};

const TEXT = {
  "zh-CN": {
    // D.13L Block E：permissionDetailsLabel/Hint 已停用（权限卡只剩 3 项动作），
    // 字段保留为空字符串避免未引用警告，未来真要恢复 details 入口时再回填文案。
    permissionDetailsLabel: "",
    permissionDetailsHint: "",
    toolErrorRetryLabel: "查看完整错误",
    toolErrorRetryHint: "按 Ctrl+O 查看最近一次失败输出（或 /details）",
    setupLabel: "继续模型配置",
    setupHint: "回到 setup 流，按 Enter 进入下一步",
  },
  "en-US": {
    permissionDetailsLabel: "",
    permissionDetailsHint: "",
    toolErrorRetryLabel: "Show full error output",
    toolErrorRetryHint: "Press Ctrl+O for the latest failure output (or /details)",
    setupLabel: "Continue model setup",
    setupHint: "Re-enter the setup flow; press Enter to advance",
  },
} as const;

const VALID_SLASHES: ReadonlySet<string> = new Set(
  SLASH_COMMAND_REGISTRY.map((entry) => entry.slash),
);

/**
 * 校验一个 slash 字符串是否落在 SLASH_COMMAND_REGISTRY 白名单内。
 * 命中规则：原样命中 / "<root> <subcommand>" 命中 root（与 NaturalCommandBridge 行为一致）。
 *
 * 暴露为独立纯函数便于 ConfigControlPlane / 上层一并复用。
 */
export function isKnownSlashCommand(command: string): boolean {
  if (!command.startsWith("/")) return false;
  if (VALID_SLASHES.has(command)) return true;
  const head = command.split(/\s+/, 1)[0];
  return Boolean(head && VALID_SLASHES.has(head));
}

function pushIfValid(out: TaskSuggestion[], suggestion: TaskSuggestion): void {
  if (suggestion.action.kind === "slash" && !isKnownSlashCommand(suggestion.action.command)) {
    return;
  }
  out.push(suggestion);
}

function buildPermissionSuggestions(
  text: (typeof TEXT)[keyof typeof TEXT],
  permission: TaskPermissionView,
): TaskSuggestion[] {
  // 权限卡自带 [本次允许 / 项目级允许 / 拒绝 / 详情] 动作，
  // 不再额外曝出 details 入口或 /permissions 入口。details 由 /details 命令承担，
  // 持久化规则视图由用户主动调用 /permissions 看，不再在权限卡下方推。
  return [];
}

function buildToolErrorSuggestions(
  text: (typeof TEXT)[keyof typeof TEXT],
  failBlocks: ProductBlockViewModel[],
): TaskSuggestion[] {
  if (failBlocks.length === 0) return [];
  const out: TaskSuggestion[] = [];
  const latest = failBlocks[failBlocks.length - 1];
  pushIfValid(out, {
    id: `tool_error:details:${latest?.id ?? "latest"}`,
    source: "tool_error",
    label: text.toolErrorRetryLabel,
    hint: text.toolErrorRetryHint,
    action: { kind: "slash", command: "/details" },
  });
  return out;
}

function buildSetupSuggestions(
  text: (typeof TEXT)[keyof typeof TEXT],
  setupHint: string,
): TaskSuggestion[] {
  return [
    {
      id: "setup:resume",
      source: "setup",
      label: text.setupLabel,
      hint: setupHint || text.setupHint,
      action: { kind: "slash", command: "/model" },
    },
  ];
}

function buildConfigSuggestions(
  hints: NonNullable<SuggestionInputs["configHints"]>,
): TaskSuggestion[] {
  const out: TaskSuggestion[] = [];
  for (const hint of hints) {
    pushIfValid(out, {
      id: `config:${hint.id}`,
      source: "config",
      label: hint.label,
      action: { kind: "slash", command: hint.slash },
    });
  }
  return out;
}

function buildSlashSuggestions(
  candidates: NonNullable<SuggestionInputs["slashCandidates"]>,
): TaskSuggestion[] {
  const out: TaskSuggestion[] = [];
  for (const cand of candidates) {
    pushIfValid(out, {
      id: `slash:${cand.slash}`,
      source: "slash",
      label: cand.slash,
      hint: cand.label,
      action: { kind: "slash", command: cand.slash },
    });
  }
  return out;
}

const SOURCE_PRIORITY: Record<TaskSuggestionSource, number> = {
  permission: 0,
  tool_error: 1,
  setup: 2,
  config: 3,
  slash: 4,
};

/**
 * 合并 5 来源 → 按优先级排序 → 去重 → 裁剪到 max。
 */
export function buildTaskSuggestions(
  inputs: SuggestionInputs,
  limits: TaskSuggestionLimits = {},
): TaskSuggestion[] {
  const text = TEXT[inputs.language];
  const merged: TaskSuggestion[] = [];

  if (inputs.permission) {
    merged.push(...buildPermissionSuggestions(text, inputs.permission));
  }
  if (inputs.failBlocks && inputs.failBlocks.length > 0) {
    merged.push(...buildToolErrorSuggestions(text, inputs.failBlocks));
  }
  if (inputs.setupHint) {
    merged.push(...buildSetupSuggestions(text, inputs.setupHint));
  }
  if (inputs.configHints && inputs.configHints.length > 0) {
    merged.push(...buildConfigSuggestions(inputs.configHints));
  }
  if (inputs.slashCandidates && inputs.slashCandidates.length > 0) {
    merged.push(...buildSlashSuggestions(inputs.slashCandidates));
  }

  // 稳定排序（保持同优先级内的输入顺序）
  merged.sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);

  // id 去重
  const seen = new Set<string>();
  const deduped = merged.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  const max = limits.max ?? 4;
  return deduped.slice(0, max);
}
