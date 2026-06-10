import { Text } from "@linghun/ink-runtime";
import { createContext, useContext } from "react";
import type React from "react";
import type { ShellTheme } from "../theme.js";

/**
 * D.13Q-UX — CtrlOToExpand
 *
 * CCB CtrlOToExpand.tsx 范式：
 * - 单一全局组件，所有"按 Ctrl+O 展开完整内容"提示统一渲染。
 * - 双层 Context 守门：一旦在子 agent / 虚拟列表里，hint 隐藏，
 *   避免一屏到处都是 (ctrl+o to expand)。
 * - 提示文案 dim 单行；hint 文本可由调用方覆盖（中英文）。
 *
 * 不复制 CCB 源码：CCB 用 useShortcutDisplay 动态读快捷键文案；
 * Linghun 当前 Ctrl+O 是固定绑定（Composer.tsx），文案传 prop 即可。
 */

const SubAgentContext = createContext<boolean>(false);
const InVirtualListContext = createContext<boolean>(false);

export function useInSubAgent(): boolean {
  return useContext(SubAgentContext);
}

export function useInVirtualList(): boolean {
  return useContext(InVirtualListContext);
}

export function SubAgentProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return <SubAgentContext.Provider value={true}>{children}</SubAgentContext.Provider>;
}

export function VirtualListProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return <InVirtualListContext.Provider value={true}>{children}</InVirtualListContext.Provider>;
}

/**
 * 渲染 "(Ctrl+O 查看完整内容)" / "(Ctrl+O for details)" 单行 dim 提示。
 *
 * 隐藏规则（CCB 同款）：
 * - 在子 agent 上下文里隐藏。
 * - 在虚拟列表上下文里隐藏（避免列表每行都画 hint）。
 * - hidden=true 强制隐藏（调用方决定本块是否真的折叠）。
 */
export function CtrlOToExpand({
  theme,
  hint,
  hidden = false,
}: {
  theme: ShellTheme;
  hint: string;
  hidden?: boolean;
}): React.ReactNode {
  const inSubAgent = useInSubAgent();
  const inVirtualList = useInVirtualList();
  if (hidden || inSubAgent || inVirtualList) return null;
  if (!hint || hint.trim().length === 0) return null;
  return (
    <Text color={theme.dim ?? theme.muted} dimColor>
      {hint}
    </Text>
  );
}

/**
 * 字符串版（plain renderer / ANSI 拼接场景）：
 * 由于 Context 在字符串拼接路径不可用，这里直接根据外部传入的 suppressed
 * 决定返回空。
 */
export function ctrlOToExpandString(hint: string, suppressed = false): string {
  if (suppressed) return "";
  if (!hint || hint.trim().length === 0) return "";
  return hint;
}
