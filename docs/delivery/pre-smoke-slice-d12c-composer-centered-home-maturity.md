# Slice D.12C: Composer-Centered Home Maturity Patch

## 阶段目标

将 Home 首屏的主视觉焦点从品牌/欢迎信息转移到 active composer，保持整体居中布局不变，不改成 CCB 常驻工作台。

## 已完成功能

### 1. Composer prompt marker `>`
- 输入行左侧增加稳定 prompt marker `> `
- 空输入显示：`> 我能帮您做点什么？`（placeholder 带 prompt marker）
- 有输入显示：`> 用户输入▌`（color 模式）/ `> 用户输入|`（no-color 模式）
- plain renderer 和 Ink renderer 均已适配

### 2. 多行输入成熟化
- 第一行带 `> ` prefix
- 后续行用 `  `（两空格）缩进对齐
- 最后一行显示 cursor
- 超过 5 行显示省略提示（已有，本次未改动）
- Shift+Enter 继续追加 newline，不提交（已有，本次未改动）

### 3. Vision/slogan 弱化
- 移除 vision 行的 `marginTop={1}`，紧贴 brand wordmark
- vision 颜色保持 muted，不抢 composer 视觉焦点

### 4. Home 首屏精简
- Home 模式不显示 background task blocks
- `后台：0` 不显示（count=0 时返回空字符串）
- Home 模式不显示 setupHint（setup 入口延迟到 Enter 后流程或 task 模式）
- 不删除模型配置流程本身

### 5. Task layout 不回归
- 提交后仍通过 `submitted` → `pending` 进入 task layout
- task 模式继续显示 activity/permission/output/background blocks
- permission placeholder 仍提示 y/yes/n/no/details/Esc
- setupHint 在 task/pending 模式下仍正常显示

## 涉及模块

| 文件 | 改动说明 |
|------|----------|
| `packages/tui/src/shell/view-model.ts` | effectiveViewMode 提前计算；home 过滤 bg blocks；background=0 不显示；setupHint 仅 task/pending |
| `packages/tui/src/shell/components/Composer.tsx` | 增加 PROMPT_MARKER 常量；首行 `> ` prefix；后续行缩进对齐 |
| `packages/tui/src/shell/plain-renderer.ts` | home/task 模式 composer 行增加 `> ` prefix |
| `packages/tui/src/shell/components/ShellApp.tsx` | vision marginTop 移除，弱化间距 |
| `packages/tui/src/shell/view-model.test.ts` | 调整 background/setupHint 测试为 task 模式；新增 home 不显示 bg blocks 测试 |

## 测试与验证

```
corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts  → 86 passed
corepack pnpm exec vitest run packages/tui/src/index.test.ts             → 200 passed
corepack pnpm typecheck                                                   → pass
corepack pnpm check                                                       → 0 errors, 1 pre-existing warning
git diff --check                                                          → pass
```

验证覆盖：
- home 仍整体居中/仍渲染 brand ✓
- home 不显示历史 background blocks ✓
- background count=0 不显示 ✓
- composer empty/typed/multiline/no-color 渲染正确 ✓
- Shift+Enter newline 不 submit ✓
- submitted=true 仍进入 pending/task layout ✓
- width=40 不崩 ✓

## 已知限制

- 未真实 provider smoke
- 未 Beta PASS / smoke-ready / open-source-ready
- Ink renderer 中 prompt marker 由 Composer 组件内部渲染，plain renderer 由 `renderPlainHome`/`renderPlainTask` 外部拼接——两条路径独立维护

## 参考核对

- 本阶段实际读取：`CLAUDE.md`、`view-model.ts`、`Composer.tsx`、`ShellApp.tsx`、`plain-renderer.ts`、`text-utils.ts`、`types.ts`、`view-model.test.ts`
- 行为参考：CCB composer prompt marker `>`、OpenCode 输入行风格
- 未复制可疑源码实现

## Handoff

- **下一阶段**：由用户决定
- **禁止事项**：不得将 Home 改为顶部常驻工作台；不得删除 task layout 中的 background/permission 显示
- **验证结果**：286 tests passed, typecheck pass, lint 0 errors
- **索引状态**：主项目 F-Linghun 未在 codebase-memory 中索引（仅 temp 项目存在）
