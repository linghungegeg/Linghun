import type { TerminalCapability } from "./terminal-capability.js";
import type { ProductBlockStatus, ShellThemeMode } from "./types.js";

export type ShellTheme = {
  mode: ShellThemeMode;
  brand: string | undefined;
  accent: string | undefined;
  muted: string | undefined;
  border: string | undefined;
  warning: string | undefined;
  status: Record<ProductBlockStatus, string | undefined>;
  /**
   * D.13Q-UX — 消息语义颜色键（CCB Messages.tsx 对照）：
   * - assistantText: 普通 assistant 正文，默认 brand white；不再借 info=cyan。
   * - dim: 从属响应 / Ctrl+O hint / 弱提示通用 dim。
   * - panel: 普通面板（HelpPanel / ConfigPanel）边框色。
   * - permission: 权限面板独立边框色（独立于普通 panel，让 PermissionPanel 一眼可识别）。
   * - help: HelpPanel 主题色（professionalBlue 风格，与 permission 区分）。
   * - diagnostic: /model doctor 等诊断输出色（cyan 等强调色，不与普通正文同源）。
   * - notification: 轻提示色（默认 dim，warning/error 时另染色）。
   * - success: 强调成功（与 status.pass 同色，但语义上独立）。
   * - error: 强调错误（与 status.fail 同色）。
   */
  assistantText: string | undefined;
  dim: string | undefined;
  panel: string | undefined;
  permission: string | undefined;
  help: string | undefined;
  diagnostic: string | undefined;
  notification: string | undefined;
  success: string | undefined;
  error: string | undefined;
  inlineCode: string | undefined;
};

export function createShellTheme(noColor: boolean): ShellTheme {
  if (noColor) {
    return {
      mode: "no-color",
      brand: undefined,
      accent: undefined,
      muted: undefined,
      border: undefined,
      warning: undefined,
      status: {
        info: undefined,
        running: undefined,
        pass: undefined,
        partial: undefined,
        fail: undefined,
        blocked: undefined,
      },
      assistantText: undefined,
      dim: undefined,
      panel: undefined,
      permission: undefined,
      help: undefined,
      diagnostic: undefined,
      notification: undefined,
      success: undefined,
      error: undefined,
      inlineCode: undefined,
    };
  }
  return {
    mode: "color",
    brand: "white",
    accent: "cyan",
    muted: "gray",
    border: "gray",
    warning: "redBright",
    status: {
      info: "cyan",
      running: "yellow",
      pass: "green",
      partial: "yellow",
      fail: "red",
      blocked: "yellow",
    },
    // D.13Q-UX 语义键 —— assistant 正文用 brand white（默认色），不再借 info=cyan
    // 让 status dot 与正文同色一片青；panel/permission/help 用不同 border 色，
    // 让 PermissionPanel 一眼能与 ConfigPanel 区分；diagnostic 仍可用 cyan 强调
    // /model doctor 等诊断输出，但只服务诊断，不再当通用正文色。
    assistantText: undefined,
    dim: "gray",
    panel: "gray",
    permission: "magenta",
    help: "blueBright",
    diagnostic: "cyan",
    notification: "gray",
    success: "green",
    error: "red",
    inlineCode: "gray",
  };
}

/**
 * Status marker for product blocks.
 * Uses ASCII labels on legacy/no-color terminals, Unicode dots on modern terminals.
 */
export function getStatusMarker(
  status: ProductBlockStatus,
  noColor: boolean,
  capability?: TerminalCapability,
): string {
  const useAscii = noColor || (capability ? !capability.unicodeBox : false);

  if (useAscii) {
    const asciiLabels: Record<ProductBlockStatus, string> = {
      info: "[INFO]",
      running: "[..]",
      pass: "[OK]",
      partial: "[PARTIAL]",
      fail: "[FAIL]",
      blocked: "[BLOCKED]",
    };
    return asciiLabels[status];
  }

  const unicodeLabels: Record<ProductBlockStatus, string> = {
    info: "\u25CF",
    running: "\u25CB",
    pass: "\u2713",
    partial: "\u25D2",
    fail: "\u2717",
    blocked: "\u25A0",
  };
  return unicodeLabels[status];
}
