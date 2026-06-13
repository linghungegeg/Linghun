import type { Language } from "@linghun/shared";
import type { ToolName } from "@linghun/tools";
import type { PermissionRule } from "../../permission-continuation-runtime.js";

/**
 * PermissionElevationModel — D.13E Step 1（v3 修正）
 *
 * 纯函数：根据当前权限上下文（toolName / scope / risk / 现有规则）计算
 * 提权选项菜单。本轮只返回 4 档：
 *   - allow_once          当次同意（不落盘）
 *   - allow_always_tool   当次同意 + 持久落盘（语义由 controller 层 atomic 实现）
 *   - deny                当次拒绝
 *   - details             展开 reason/scope
 *
 * 复用 packages/tui/src/permission-continuation-runtime.ts 中已存在的
 * PermissionRule 类型。本模块不持久化、不写文件、不注册任何 store —
 * "always" 落盘由 controller 层调用 addAllowRule helper（见 index.ts）。
 *
 * 已存在 effect:"allow" toolName:<x>|"*" 规则时，allow_always_tool 隐藏，
 * 避免重复落盘和误导用户。
 *
 * v3 契约调整：删除 dispatches 字段。原本"submit yes + slash /permissions add"
 * 的复合 dispatch 由 model 描述、UI 顺次发两个 onInput 的设计会与
 * pendingLocalApproval 状态竞争（两个 submit 之间 pending 已被消费）。
 * 修正后：model 只暴露 `id`（语义），副作用由 controller 在收到
 * `permission-action` 事件后 atomic 处理（先 addAllowRule 持久化，
 * 持久化成功才 approve；失败保留 pending）。
 */

export type ElevationOptionId = "allow_once" | "allow_always_tool" | "deny" | "details";

export type ElevationOption = {
  id: ElevationOptionId;
  /** 单字母快捷键。details 用 d；allow_always_tool 用 a；allow_once 用 y；deny 用 n。 */
  shortcut?: string;
  label: string;
  /** 短提示，用于权限卡 hint 行 / suggestion bar 副标题。 */
  hint: string;
};

export type ElevationInput = {
  toolName: ToolName;
  /** 影响范围（文件路径 / bash 命令片段等），仅用于文案，不参与决策。 */
  scope: string[];
  risk: "low" | "medium" | "high";
  existingRules: PermissionRule[];
  language: Language;
};

const TEXT = {
  "zh-CN": {
    allowOnce: "本次允许",
    allowAlways: "始终允许该工具",
    deny: "拒绝",
    details: "查看详情",
    hintAllowOnce: "仅本次执行；规则不会落盘",
    hintAllowAlwaysLow: "未来同工具静默通过（低风险）",
    hintAllowAlwaysMedium: "未来同工具静默通过（中风险，请确认）",
    hintAllowAlwaysHigh: "未来同工具静默通过（高风险，建议先 details）",
    hintAllowAlwaysHidden: "已存在 allow 规则，无需重复落盘",
    hintDeny: "本次拒绝；可继续对话调整方案",
    hintDetails: "展开原因 / 影响范围 / 安全级别",
  },
  "en-US": {
    allowOnce: "Allow once",
    allowAlways: "Always allow this tool",
    deny: "Deny",
    details: "Details",
    hintAllowOnce: "One-shot allow; no rule is persisted",
    hintAllowAlwaysLow: "Future invocations of this tool pass silently (low risk)",
    hintAllowAlwaysMedium: "Future invocations of this tool pass silently (medium risk)",
    hintAllowAlwaysHigh:
      "Future invocations of this tool pass silently (HIGH risk; review details first)",
    hintAllowAlwaysHidden: "An allow rule already exists; persisting again is redundant",
    hintDeny: "Reject this invocation; you can keep iterating",
    hintDetails: "Show reason / scope / safety level",
  },
} as const;

/**
 * 检测当前 rules 中是否已经有覆盖 `toolName` 的 effect:"allow" 规则。
 * 与 /permissions add 的语义对齐：toolName 为 "*" 表示通配；risk 限定可能更窄，
 * 但只要存在一条无 risk 限定或 risk 等于当前 risk 的 allow 规则，就视为已覆盖。
 *
 * 暴露为独立纯函数便于单元测试。
 */
export function hasExistingAllowRule(
  rules: PermissionRule[],
  toolName: ToolName,
  risk: "low" | "medium" | "high",
): boolean {
  for (const rule of rules) {
    if (rule.effect !== "allow") continue;
    if (rule.toolName !== toolName && rule.toolName !== "*") continue;
    if (rule.risk && rule.risk !== risk) continue;
    return true;
  }
  return false;
}

function buildAllowAlwaysHint(
  text: (typeof TEXT)[keyof typeof TEXT],
  risk: "low" | "medium" | "high",
): string {
  if (risk === "high") return text.hintAllowAlwaysHigh;
  if (risk === "medium") return text.hintAllowAlwaysMedium;
  return text.hintAllowAlwaysLow;
}

function buildAllowAlwaysSlashCommand(toolName: ToolName, risk: "low" | "medium" | "high"): string {
  // Documented for tooling/help; controller side now invokes addAllowRule helper
  // directly instead of dispatching this slash text through onInput.
  return `/permissions add allow ${toolName} ${risk}`;
}

/**
 * 暴露 allow_always_tool 等价 slash 命令（仅文档/调试用途）。
 * controller 端不再通过 onInput 派发该 slash；直接调 addAllowRule helper 完成
 * "持久化 + approve" 的 atomic 操作。
 */
export function describeAllowAlwaysCommand(
  toolName: ToolName,
  risk: "low" | "medium" | "high",
): string {
  return buildAllowAlwaysSlashCommand(toolName, risk);
}

/**
 * 根据当前权限上下文返回 ElevationOption[]。
 * 顺序固定为 allow_once → allow_always_tool → deny → details，
 * 与 PermissionAction 的稳定渲染顺序兼容。
 */
export function buildElevationOptions(input: ElevationInput): ElevationOption[] {
  const text = TEXT[input.language];
  const alreadyAllowed = hasExistingAllowRule(input.existingRules, input.toolName, input.risk);

  const options: ElevationOption[] = [];
  options.push({
    id: "allow_once",
    shortcut: "y",
    label: text.allowOnce,
    hint: text.hintAllowOnce,
  });

  if (!alreadyAllowed) {
    options.push({
      id: "allow_always_tool",
      shortcut: "a",
      label: text.allowAlways,
      hint: buildAllowAlwaysHint(text, input.risk),
    });
  }

  options.push({
    id: "deny",
    shortcut: "n",
    label: text.deny,
    hint: text.hintDeny,
  });
  options.push({
    id: "details",
    shortcut: "d",
    label: text.details,
    hint: text.hintDetails,
  });

  return options;
}
