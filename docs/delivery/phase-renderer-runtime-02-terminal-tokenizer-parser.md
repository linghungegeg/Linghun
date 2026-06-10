# Renderer Runtime Phase 02 — Terminal Tokenizer / Parser

## 阶段目标

建立 Linghun-owned terminal input tokenizer/parser，把鼠标、滚轮、粘贴、终端响应和未知 escape 从普通键盘文本中分离出来，先关闭用户实测中 `<64;...M` / `[<64;...M` / `;x;yM` 进入 Composer 的核心乱码入口。

## 已完成功能

- 新增 `packages/ink-runtime/src/terminal-input.ts`。
- 从 `@linghun/ink-runtime` 导出 terminal input parser API。
- 新增 `TerminalInputTokenizer.feed()` / `flush()`，支持跨 chunk 缓冲。
- 支持解析：
  - SGR mouse press / drag / release / hover。
  - SGR wheel up / down。
  - X10 mouse / wheel fallback。
  - bracketed paste，并保留 paste 内 escape-looking bytes 为 paste text。
  - CSI / OSC / DCS / SS3 边界。
  - cursor / DA / DECRPM 等 terminal response。
  - orphan SGR mouse tail。
  - known partial mouse fragments。
  - unknown escape。
- `packages/tui/src/shell/models/terminal-input-runtime.ts` 改为复用 `@linghun/ink-runtime` parser 分类结果，让现有 Composer guard 阻止非 keyboard 输入进入编辑缓冲。
- `vitest.config.ts` 增加 `@linghun/ink-runtime` 源码 alias，测试不依赖已构建 dist。

## 使用方式

本阶段没有新增用户命令；它是 TUI 输入链路的内部 runtime 能力。

开发者可直接使用：

```ts
import {
  classifyParsedTerminalInput,
  createTerminalInputTokenizer,
  parseTerminalInput,
} from "@linghun/ink-runtime";
```

## 涉及模块

- `packages/ink-runtime/src/terminal-input.ts`
- `packages/ink-runtime/src/index.ts`
- `packages/ink-runtime/src/terminal-input.test.ts`
- `packages/ink-runtime/package.json`
- `packages/tui/src/shell/models/terminal-input-runtime.ts`
- `packages/tui/src/shell/models/terminal-input-runtime.test.ts`
- `vitest.config.ts`
- `RENDERER_RUNTIME_MIGRATION_PLAN.md`

## 关键设计

- Parser 放在 `@linghun/ink-runtime`，不是继续在 React component 内猜 raw string。
- TUI 现有 Composer guard 暂时复用 parser 分类结果，保持最小接入，不改 UI 样式和用户交互布局。
- `TerminalInputTokenizer` 维护内部 buffer，split SGR sequence 不立即 flush 成文本。
- Bracketed paste 优先解析，paste 内类似 mouse escape 的内容不被拆成 mouse event。
- 完整 SGR/X10 mouse 进入结构化 event；孤儿 tail 和已知 fragment 被归类为 mouse fragment，避免进入 Composer text。

## 配置项

无新增配置项。

## 命令

无新增 CLI / slash command。

## 测试与验证

已运行：

```text
corepack pnpm exec vitest run packages/ink-runtime/src/terminal-input.test.ts packages/tui/src/shell/models/terminal-input-runtime.test.ts
corepack pnpm --filter @linghun/ink-runtime typecheck
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm --filter @linghun/ink-runtime build
corepack pnpm --filter @linghun/tui build
corepack pnpm typecheck
```

结果：全部 PASS；focused tests 为 2 个文件、27 个测试通过。

## 性能结果

未新增基准测试。Parser 为线性扫描当前输入 buffer；本阶段 focused tests 和 package build 均在本地快速完成，未发现明显性能异常。

## 已知问题

- 本阶段仍未替换 stock Ink 的底层 stdin parser，只是在 Linghun runtime 边界建立 parser 并接入现有 Composer guard。
- `1002` / `1003` mouse modes 尚未启用，属于 Phase 3。
- renderer-owned selection / copy / scroll drain / render lifecycle 尚未接管，属于后续阶段。

## 不在本阶段处理的内容

- 不改视觉样式、布局、主题、footer、panel、composer 外观。
- 不改 provider / model / tool / scheduler / agent / MCP / permission 主链。
- 不接管 selection/copy/scroll 行为。
- 不复制或 vend CCB 源码。

## 下一阶段衔接

Phase 3 应从 terminal mode runtime ownership 开始：在 runtime/capability 边界下启用并清理 `1000 + 1002 + 1003 + 1006`，并确保异常退出、unmount、stream close 时 terminal mode 恢复可靠。

## 开发者排查入口

- Parser 主实现：`packages/ink-runtime/src/terminal-input.ts`
- Parser focused tests：`packages/ink-runtime/src/terminal-input.test.ts`
- TUI 分类接入：`packages/tui/src/shell/models/terminal-input-runtime.ts`
- Composer guard 使用点：`packages/tui/src/shell/components/Composer.tsx`
- 阶段根计划：`RENDERER_RUNTIME_MIGRATION_PLAN.md`

## 参考核对

实际读取的 Linghun 文档：

- `RENDERER_RUNTIME_MIGRATION_PLAN.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`

实际参考的行为事实：

- Phase 0/1 已记录的 CCB 行为级事实：renderer-owned parser、SGR mouse/wheel、bracketed paste、terminal response、incomplete escape buffering、orphan tail suppression。

进入 Linghun 自研实现的内容：

- 自研 `TerminalInputTokenizer` / `parseTerminalInput` / `classifyParsedTerminalInput`。
- 自研 focused tests，覆盖协议行为和 Composer guard 分类边界。

未复制内容：

- 未复制 CCB 私有源码。
- 未 vend CCB forked Ink。
- 未导入 CCB internal API。

## 成品级结构化 handoff packet

```text
phase: Renderer Runtime Phase 02 — Terminal Tokenizer / Parser
status: PASS / focused-local-validation
next_phase: Renderer Runtime Phase 03 — Terminal Mode Runtime
must_not_do_next:
  - 不改视觉风格作为 Phase 3 的目标
  - 不改 provider/model/tool/scheduler/agent/MCP 主链
  - 不复制 CCB 私有源码
  - 不把 app-layer raw SGR parser 当作最终成熟方案
evidence:
  - packages/ink-runtime/src/terminal-input.ts
  - packages/ink-runtime/src/terminal-input.test.ts
  - packages/tui/src/shell/models/terminal-input-runtime.ts
  - packages/tui/src/shell/models/terminal-input-runtime.test.ts
  - RENDERER_RUNTIME_MIGRATION_PLAN.md
validation:
  - focused terminal input tests: PASS, 27 tests
  - @linghun/ink-runtime typecheck: PASS
  - @linghun/tui typecheck: PASS
  - @linghun/ink-runtime build: PASS
  - @linghun/tui build: PASS
  - root typecheck: PASS
index_status: not refreshed in this phase; source files verified directly
permission_mode: local source edits and local validation only
model_provider: Claude Code session model; no product model/provider logic changed
budget_usage: no explicit token budget set
```
