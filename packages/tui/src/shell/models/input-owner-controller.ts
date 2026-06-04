import type { Key } from "ink";

/**
 * InputOwnerController — D.13E Step 1
 *
 * 把 Composer.tsx useInput 回调里的 4 段 if 链抽成纯函数：
 *
 *   permission > panel > paste > slash > composer
 *
 * 现有实现见 packages/tui/src/shell/components/Composer.tsx 第 448-500+ 行。
 * 本模块只把 owner 选择的判定逻辑（"当前事件应当属于哪个 owner"）reduce
 * 出来，**不改派发优先级、不改副作用、不引入新 owner**。
 *
 * Composer 仍然各自负责 setState / setBuffer / submit / paste flush。
 * 抽离 owner 选择是为了：
 *   1. 单测可覆盖（不需要 ink 渲染上下文）。
 *   2. D.13D Composer 长函数体里那段隐式优先级链显式化，避免后续误改。
 *   3. 后续 D.13F 普通输入排序如要新增 owner，只需在白名单里加一档。
 *
 * 本模块不持有状态，不调用 useInput / useState；纯函数 + 常量。
 */

export type InputOwner = "permission" | "panel" | "paste" | "slash" | "composer";

/** Composer 中各 owner 的有效条件（由调用方在每次 useInput 回调起始处计算并传入）。 */
export type OwnerContext = {
  /** view.permission 存在 → permission 卡占据焦点。 */
  permissionActive: boolean;
  /** Any active panel surface that should close/navigate before global input. */
  panelActive?: boolean;
  /** True when the active panel owns row navigation/actions, not only Esc close. */
  panelInteractive?: boolean;
  /** pastePendingRef.current → paste 聚合窗口内。 */
  pastePending: boolean;
  /** slashCandidates.length > 0 && !slashHidden → slash 候选可见。 */
  slashVisible: boolean;
};

/** 仅取 useInput 回调用得到的字段，避免与 ink Key 全量绑死，便于单测构造。 */
export type OwnerKeyShape = Pick<Key, "ctrl" | "meta" | "escape" | "tab" | "return" | "shift">;

/**
 * Owner-priority dispatcher 阈值。与 Composer.tsx 内常量保持一致：
 *   - PASTE_THRESHOLD: 单次 chunk 长度超过 → 视作粘贴。
 *
 * 这里只用于 paste 触发判定；paste 内部聚合超时由 Composer 维护。
 */
export const OWNER_PASTE_THRESHOLD = 16;

/**
 * 判断当前 useInput 事件是否应当激活 paste owner。
 * 与 Composer.shouldEnterPastePath 对齐 —— 提取在这里是为了让
 * selectInputOwner 一站式给出 owner，无需调用方再串两个函数。
 *
 * - input.length 超过阈值 → 大 chunk，必然 paste。
 * - 已在 pastePending 窗口内，且当前事件是普通字符（无修饰键、非 esc/tab/return）→ 继续聚合。
 */
export function shouldOwnerBePaste(
  input: string,
  key: OwnerKeyShape,
  pastePending: boolean,
): boolean {
  if (input.length > OWNER_PASTE_THRESHOLD) return true;
  if (
    pastePending &&
    input.length > 0 &&
    !key.ctrl &&
    !key.meta &&
    !key.escape &&
    !key.tab &&
    !key.return
  ) {
    return true;
  }
  return false;
}

/**
 * 选择当前事件的 owner。优先级（与 Composer.tsx 当前实现一致）：
 *
 *   1. permission（permissionActive）
 *      —— 权限卡占位时，所有按键都被 permission 选择器接管。
 *   2. panel
 *      —— 面板层存在时，至少 Esc 等面板键先由 panel 处理，不落到全局停止。
 *   3. paste
 *      —— pastePending 期间 Enter / Esc 也算 paste owner（吞 Enter / 取消粘贴）；
 *         其他大 chunk 或聚合中按键继续 paste。
 *   3. slash
 *      —— slashVisible 时仅在 ↑↓ Tab Esc Enter 上拦截；
 *         注意：slash owner 拦截范围在 Composer 内仍然由更细的分支决定，
 *         本函数只回答"slash 是否优先于 composer"。
 *   4. composer（默认）
 *
 * 判定纯依赖 (input, key, ctx)，无副作用。
 */
export function selectInputOwner(input: string, key: OwnerKeyShape, ctx: OwnerContext): InputOwner {
  if (ctx.permissionActive) return "permission";

  if (ctx.panelActive && isPanelKey(input, key, ctx.panelInteractive === true)) return "panel";

  // paste 优先：pending 期间的 Enter/Esc 也算 paste owner（用于吞 Enter / 取消粘贴）；
  // 大 chunk 或 pending 中的普通字符同样 paste。
  if (ctx.pastePending && (key.return || key.escape)) return "paste";
  if (shouldOwnerBePaste(input, key, ctx.pastePending)) return "paste";

  if (ctx.slashVisible) {
    // slash 只接管导航/确认按键，普通字符仍走 composer（不阻断输入）。
    if (
      key.return ||
      key.escape ||
      key.tab ||
      // 数组按键的判定在 Composer 里仍依赖 ink Key 字段，这里只识别"导航类"
      // 这一概念。selectInputOwner 不关心是 ↑ 还是 ↓。
      isNavigationKey(key)
    ) {
      return "slash";
    }
  }

  return "composer";
}

/**
 * 仅判断 ink Key 上下/左右箭头是否被按下。从 Composer.tsx 的扩展接口看，
 * useInput 在 ink@7 中仍然提供 upArrow/downArrow/leftArrow/rightArrow。
 *
 * 这里把可选字段都用类型断言读出，避免 selectInputOwner 与 ink Key 全量绑死。
 */
export function isNavigationKey(key: OwnerKeyShape): boolean {
  const k = key as Record<string, unknown>;
  return (
    Boolean(k.upArrow) || Boolean(k.downArrow) || Boolean(k.leftArrow) || Boolean(k.rightArrow)
  );
}

function isPanelKey(input: string, key: OwnerKeyShape, interactive: boolean): boolean {
  if (key.escape) return true;
  if (!interactive) return false;
  if (key.return || isNavigationKey(key)) return true;
  return input.toLowerCase() === "x" && !key.ctrl && !key.meta;
}

/** 调试 / 测试辅助：返回 owner 选择的稳定优先级数组。 */
export const OWNER_PRIORITY: ReadonlyArray<InputOwner> = [
  "permission",
  "panel",
  "paste",
  "slash",
  "composer",
];
