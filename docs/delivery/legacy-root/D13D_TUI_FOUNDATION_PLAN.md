# D13D LingHun TUI Mature Foundation 方案（修订版）

## 0. 修订记录
- v2：修正 useAnchoredCursor 必须用 parent-chain 累加获取终端绝对坐标；plain-renderer 不动；Task 区补测试覆盖矩阵。

## 1. 源码事实

LingHun 当前能力（已验证）：
- Ink 7.0.3 已具备 `useCursor().setCursorPosition({x,y})`（commit 阶段写入，自动 tear-down，见 `node_modules/.../ink/build/hooks/use-cursor.js`）。坐标系是**相对 Ink 输出原点（即 ink-root）**。
- Ink 7.0.3 已具备 `useBoxMetrics(ref)` 返回 `{width,height,left,top,hasMeasured}`，由 Yoga 计算。**关键：left/top 是相对父节点，不是 ink-root**（见 `use-box-metrics.js` 第 55 行 `ref.current?.yogaNode?.getComputedLayout()`，Yoga 返回 parent-relative 布局）。它的真实价值在于：触发 layout/resize 后重新计算、用 `hasMeasured` 判断首帧是否就绪、订阅 `addLayoutListener`。
- `dom.d.ts` 暴露 `DOMElement` 含 `parentNode: DOMElement | undefined` 和 `yogaNode?: YogaNode`，向上累加可达 `ink-root`。这是公开 API。
- `terminal-capability.ts` 已分 modern/basic/legacy 三档，`cursorPositioning` 字段可信。
- `Composer.tsx` 当前调用 `useCursor().setCursorPosition({x: cursorCol, y: cursorRow + ...})`，传的是 **Composer 内部坐标**，不是终端绝对坐标 → 任何外层 padding/margin/centering 都会让光标偏。
- `ShellApp.tsx` Home/Task 在 Composer 外层有 `<Box marginTop>`、`<Box width={cw} alignSelf="center">` 等会改变 Yoga 计算的容器属性。
- `Composer` 内部 `maxWidth = Math.min(80, Math.max(30, view.width - 4))` 与 `text-utils.ts` 的 `composerMaxWidth = Math.min(80, Math.max(40, viewWidth - 6))` **不一致**。
- `text-utils.ts brandWordmark` 在 width≥60 仍输出 ASCII art / Unicode box art。
- `plain-renderer.ts` 是 stdout 一次性写入路径（`renderPlainHome` 写 brand + accent line + vision + composer line + placeholder + composer line + status），与 Ink 路径完全独立。

参考边界（只取行为，不复制代码）：
- CCB `useTextInput`：纯函数 cursor → render 字符串 + cursorLine/cursorColumn → 父组件再决定终端坐标（input/output 解耦）。
- OpenCode：editor 区与 transcript 区是两个独立组件，editor 永远在固定位置。
- Warp：command block 输出区与 input 区是两个独立 region，input 不被 output 挤压。

## 2. 自研 foundation 架构

新增一个 hook + 一个组件 wrapper：

```
shell/components/
  useAnchoredCursor.ts   ← 新增
  Composer.tsx           ← 改：去掉直接 useCursor，改为声明 declared cursor
  ShellApp.tsx           ← 改：Home/Task 用统一的 Composer 容器结构
```

### useAnchoredCursor(declared, anchorRef, capability)

入参：
- `declared = {row: number, col: number}` — Composer 内部坐标
- `anchorRef: RefObject<DOMElement | null>` — Composer 顶层 Box ref
- `capability: TerminalCapability`

实现要点：
1. **绝对坐标用 parent-chain 累加**，不用 `useBoxMetrics` 的 `left/top` 直接当绝对值：

   ```
   function getAbsoluteOrigin(node: DOMElement | null): {x:number, y:number} | null {
     if (!node) return null;
     let x = 0, y = 0;
     let cur: DOMElement | undefined = node;
     while (cur && cur.nodeName !== 'ink-root') {
       const layout = cur.yogaNode?.getComputedLayout();
       if (!layout) return null;
       x += layout.left;
       y += layout.top;
       cur = cur.parentNode;
     }
     return cur?.nodeName === 'ink-root' ? {x, y} : null;
   }
   ```

2. **`useBoxMetrics(anchorRef)` 仍然调用**，但只用它的副作用：
   - 触发 layout/sibling/resize 变化时 hook 重新执行
   - `hasMeasured` 判断首帧是否就绪
   - 不直接使用它返回的 left/top 数值

3. 调用 `useCursor().setCursorPosition`：
   - `!capability.cursorPositioning || !hasMeasured || origin === null` → 传 `undefined`（隐藏，不画假光标）
   - 否则传 `{x: origin.x + declared.col, y: origin.y + declared.row}`

4. 业务层 Composer **永远只声明 row/col**，绝不接触终端坐标；Home/Task 改容器布局，foundation 自动适配。

### Composer 改动
- 删除 Composer 内部 `useCursor()` 直接调用，改为：
  ```
  const anchorRef = useRef<DOMElement | null>(null);
  useAnchoredCursor(
    { row: cursorRow + (truncatedCount > 0 ? 1 : 0), col: cursorCol },
    anchorRef,
    capability
  );
  ```
- 顶层 `<Box ref={anchorRef} flexDirection="column" width="100%">` 包住所有渲染行。
- `maxWidth` 改为 `composerMaxWidth(view.width)`，与 ShellApp 容器对齐。
- EditBuffer / History / 按键 handler / `formatComposerRenderLines` 实体不动。

### ShellApp 改动
- Home/Task 都把 Composer 包进同一种容器结构 `<Box width={cw} flexDirection="column">`，不要再在 Composer 外加 `paddingX`/`alignSelf` 等会改 Yoga left/top 的属性（可以保留 `marginTop`，因为 parent-chain 累加已正确处理）。
- 删除 Home/Task 业务层任何 cursor offset 计算（当前没有，注释里点死禁止后续手算）。

### text-utils 改动（标题修复）
- `brandWordmark` 全部分支统一返回 `["LingHun"]`。
- 删除/停用 `brandWordmarkLarge`/`brandWordmarkCompact` ASCII/Unicode 大字实体（保留导出签名以保持 API）。
- 不加版本号。
- 不用空字符串造空行（删除 `, "",` 这类占位）。

### width 修复
- Composer 内部使用 `composerMaxWidth(view.width)`，与 ShellApp 容器 cw 一致。

### plain-renderer 改动
- **不动**。当前目标是恢复成熟视觉层级，不是减配 plain home。除非真实 smoke 证明 plain 路径有问题，否则保持原样。

## 3. 为什么是 foundation 不是补丁
- Composer 永远只懂"我自己的内部 row/col"。任何外层布局（Home 居中、Task 顶/底栏、未来 sidebar）只需改 ShellApp，foundation 不变。
- 假光标 `<Text inverse>` 完全不引入；`cursorPositioning=false` 或 metrics 未就绪时直接不画，比假光标错位更诚实。
- Home/Task 共用一份输入 foundation（同一个 Composer + 同一个 anchored cursor hook），无法分裂。
- 绝对坐标算法是 Yoga 公开 API（`getComputedLayout`）+ DOMElement 公开链（`parentNode`），不依赖任何 Ink 私有内部。

## 4. 为什么不复制 CCB / 不直接换包
- CCB 的 `Cursor` 类绑定它自己的 `@anthropic/ink` 私有 API（私有 Key 类型、内部 fullscreen、kitty CSIu detection 等），整体迁移会拖大半个仓库。
- LingHun 的 EditBuffer + getCursorLinePosition 已经能正确处理 CJK/多行/掩码，行为与 CCB 等价。
- Ink 7.0.3 公版 `useCursor` + `useBoxMetrics` + DOMElement parent chain 已经覆盖当年 CCB 拉私有 fork 的根本理由。

## 5. 改动文件清单

| 文件 | 改动 |
|---|---|
| `packages/tui/src/shell/components/useAnchoredCursor.ts` | 新增（~40 行：parent-chain 累加 + useCursor + useBoxMetrics 触发 + capability 守卫） |
| `packages/tui/src/shell/components/Composer.tsx` | 去掉直接 useCursor、引入 anchorRef + useAnchoredCursor、统一 maxWidth；EditBuffer/History/keymap 不动 |
| `packages/tui/src/shell/components/ShellApp.tsx` | Home/Task 的 Composer 容器层统一；activity/permission/StatusTray/ProductBlock 渲染逻辑不动 |
| `packages/tui/src/shell/text-utils.ts` | `brandWordmark` 三个分支统一返回 `["LingHun"]`；删除大字实体 |

5 个文件以内，符合 CLAUDE.md "默认不做超过 3 个文件的扩散式改动" 例外条件（"任务天然涉及多文件，只改完成任务所必需的范围"）。

## 6. 不改的文件（明示）
- `Composer.tsx` 的 EditBuffer / History / 按键 handler / `formatComposerRenderLines`
- `view-model.ts` / `types.ts` / `theme.ts`
- `terminal-capability.ts`
- `ink-renderer.tsx`（render 入口、resize、unmount）
- `ProductBlock.tsx` / `StatusTray.tsx`
- **`plain-renderer.ts`**（不动 accent underline、不动其他任何渲染分支）
- `index.ts`（507KB 主入口）

## 7. Task 区达标矩阵 + 测试覆盖

| 项 | 现状 | 处理 | 验证 |
|---|---|---|---|
| Task composer | 与 Home 共享 Composer | foundation 自动达标 | 新增 ink render 测试：task 模式下 anchored cursor 落在 Task composer 区域 |
| output/message blocks | ProductBlock 列表，flexGrow=1 | 不改 | 现有快照保留 + 新增：blocks 多条时 composer 不被挤压 |
| permission card | 单独 Box border 在 composer 上方 | 不改 | 新增：permission + composer 共存时，cursor 落在 composer，不在 permission card |
| permission pending 输入所有权 | view-model 切 placeholder（permissionPlaceholder） | 不改 | 新增：permission 状态下 keypress 仍进 Composer EditBuffer |
| activity indicator | ActivityIndicator 在 main 区顶部 | 不改 | 新增：activity + output blocks + composer 共存，三者渲染位置正确 |
| status/footer | 顶 bar StatusTray，已分窄屏裁剪 | 不改 | 新增：status 顶栏 + 窄屏（width=40）下 composer cursor 仍正确 |
| resize/窄屏 | ink-renderer 已 debounced rerender | 不改 | 新增：resize 后 useBoxMetrics 触发重算，cursor 跟随 |
| model setup masking | composer.masking → buffer 走 `*` | 不改 | 新增：masking 模式下 cursor 列基于 mask 字符宽度计算 |
| startup/first-run | view-model setupHint + setupPlaceholder | 不改 | 现有 view-model.test 保留 |
| new repo | 走 home + setupHint 路径 | 不改 | 现有 view-model.test 保留 |
| language selection | view-model i18n | 不改 | 现有 view-model.test 保留 |
| plain fallback / TERM=dumb / non-TTY | shouldUseInkShell + plain-renderer 已分流 | 不改 | 现有 plain-renderer 快照保留 |

## 8. 自动化测试清单

- `useAnchoredCursor` 单测：
  - mock `DOMElement` 链（child→box→ink-root），各层 `yogaNode.getComputedLayout()` 给定 left/top → 期望 `setCursorPosition` 被调以 `(累加x + col, 累加y + row)`
  - `hasMeasured=false` 时调 `undefined`
  - `cursorPositioning=false` 时调 `undefined`
  - `parentNode` 链断（中间某层 yogaNode 缺失）时调 `undefined`，不抛
- Composer 既有 `formatComposerRenderLines` 单测全部保留通过。
- `brandWordmark` 单测改为：noColor / 各 width / 各 capability 全部期望返回 `["LingHun"]`。
- 新增 ShellApp ink render 测试覆盖 Task 区矩阵中标"新增"的 7 项。
- `view-model.test.ts` 现有 Ink render smoke 不变；额外验证 Home/Task 不再因 maxWidth 不一致触发文本溢出。
- plain-renderer 快照测试**保持原有**，不修改预期。

## 9. Smoke 清单（人工）
- Windows Terminal：Home 输入空格、CJK、英文混排、长文本、Shift+Enter 多行、Esc、Ctrl+U/W/K、history Up/Down、resize。
- Windows cmd / PowerShell（conpty）：同上 + 验证 cursor 不漂。
- Git Bash / mintty：basic 档；CJK 宽字符光标对齐。
- TERM=dumb：自动走 plain-renderer，无 ANSI escape，可读。
- Non-TTY（管道）：plain 输出，不 hang。
- Task 运行长 tool（>5s）：activity 在顶，Composer 不被挤；permission 弹出时输入仍可编辑、Esc 取消。
- 窄屏 40 列：brand 仍是 `LingHun` 一行，placeholder 不溢出，cursor 不超过 maxWidth。

## 10. 风险与回滚点
- 风险 A：parent-chain 累加在 React concurrent 渲染中可能读到中间态。缓解：`useAnchoredCursor` 通过 `useInsertionEffect`（继承 useCursor 行为）+ `useBoxMetrics` 的 layout listener 保证 commit 后才读 yoga，且 useCursor 自身在 abandoned render 不会写。
- 风险 B：首帧 `hasMeasured=false`，会有一帧光标隐藏。已用 `undefined` 显式表达；不画假光标比错位诚实。
- 风险 C：某些 Ink 内部节点（ink-virtual-text）没有 yogaNode。缓解：parent-chain 遇到无 yogaNode 节点直接返回 null，调 `undefined`。
- 回滚点：5 个改动文件独立，可按文件粒度 `git checkout` 回退。无 dead code、无 commented fallback。

---
等你确认后再动代码。
