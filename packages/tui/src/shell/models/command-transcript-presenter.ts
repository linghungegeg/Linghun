import type { ProductBlockViewModel } from "../types.js";

/**
 * CommandTranscriptPresenter — D.13E Step 1
 *
 * D.13D 已经把 slash command 提交后的回声改造为独立 `❯ /command` 转录行，
 * 通过 ProductBlockKind="command" + keep:true 进入 view.blocks。当前格式化
 * 逻辑散落在两处：
 *   - packages/tui/src/shell/plain-renderer.ts:239
 *   - packages/tui/src/shell/components/ProductBlock.tsx:20
 *
 * 这两处都在做同一件事：U+276F + 一个 cyan/accent 着色的 slash 文本，
 * 不带 status marker，不带 detail/nextAction。本模块抽出唯一的事实源：
 *   - createCommandBlock(): 构造转录 block（带 keep:true）。
 *   - getCommandTranscriptText(): 取出最终单行文本（用于 plain renderer / 单测）。
 *
 * 本模块只整合现有规则，不引入新行为：
 *   - 仍是 ProductBlockKind="command"。
 *   - 仍只显示一行（不展开 detail）。
 *   - 仍设置 keep:true，不被 thinking → completed 的 block 替换 reset 掉。
 *
 * 调用方（plain-renderer.ts / ProductBlock.tsx / view-model.ts）只调用
 * 本模块拿到 block 或 text，不再自行拼接 `${"\u276F"} ${title}`。
 */

/** 转录行使用的前缀字符。U+276F 是单行 slash echo 的标准 marker。 */
export const COMMAND_TRANSCRIPT_PREFIX = "\u276F";

/** 转录 block id 前缀。每条 transcript 用 `cmd:<n>:<slug>` 唯一标识。 */
export const COMMAND_TRANSCRIPT_ID_PREFIX = "cmd:";

/** 把单条 slash 文本规范化为转录行用的 title（去首尾空白，但保留中间空格）。 */
export function normalizeCommandTitle(command: string): string {
  return command.trim();
}

/**
 * 由 (sequence, command) 生成稳定的 block id。
 * sequence 由调用方递增，避免同一条命令重复提交时 React key 冲突。
 *
 * slug 仅取 `/command-head` 部分（去掉参数），便于追踪同一命令族。
 */
export function buildCommandBlockId(sequence: number, command: string): string {
  const trimmed = normalizeCommandTitle(command);
  const head = trimmed.split(/\s+/, 1)[0] ?? trimmed;
  const slug = head.replace(/[^A-Za-z0-9/_-]/g, "").replace(/^\//, "") || "anon";
  return `${COMMAND_TRANSCRIPT_ID_PREFIX}${sequence}:${slug}`;
}

/**
 * 构造一条 slash command 转录 block。view-model 在用户提交 slash 后调用。
 *
 * 设计要点：
 *   - kind="command" → ProductBlock / plain-renderer 的 command 分支命中。
 *   - status="info" → 与现有 status 颜色映射兼容（command 渲染分支自己覆盖颜色，
 *     这里给个稳定值便于其它 reducer 读取）。
 *   - keep=true → block 在新一轮 thinking → completed 流转中不被清掉，转录持久。
 *   - summary 故意置空字符串：command 渲染分支只用 title，不展示 summary，
 *     但 ProductBlockViewModel 的契约要求 summary 字段存在。
 */
export function createCommandBlock(sequence: number, command: string): ProductBlockViewModel {
  const title = normalizeCommandTitle(command);
  return {
    id: buildCommandBlockId(sequence, title),
    kind: "command",
    status: "info",
    title,
    summary: "",
    keep: true,
  };
}

/**
 * 取出转录行的最终 plain 文本（不含 ANSI），用于 plain-renderer 与单测断言。
 * 与 plain-renderer.ts 的 dim/colorCyan 包装独立 —— 那一层颜色由调用方加。
 *
 * 仅一行：`❯ /command`。
 */
export function getCommandTranscriptText(block: ProductBlockViewModel): string {
  if (block.kind !== "command") return "";
  return `${COMMAND_TRANSCRIPT_PREFIX} ${block.title}`;
}

/** 类型守卫：判断一个 block 是否是 command transcript 行。 */
export function isCommandBlock(block: ProductBlockViewModel): boolean {
  return block.kind === "command";
}
