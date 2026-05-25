# Pre-Smoke Slice D.12C Composer Cursor Alignment Closure

## Verdict

PARTIAL / local validation only.

本次是 TUI 输入光标成熟度修复：Composer 使用自绘 cursor 表达输入位置，Ink renderer 隐藏终端原生 cursor 以防双光标，并微调 brand underline 到 vision/slogan 的 1 行间距。

未真实 provider smoke；未 Beta PASS；未 smoke-ready；未 open-source-ready。

## Scope

### 本次完成

- Composer render 行统一带 prompt marker `> `。
- 空输入 placeholder 也显示自绘 cursor：
  - color：`> 我能帮您做点什么？▌`
  - no-color：`> 我能帮您做点什么？|`
- 有输入时 cursor 显示在输入文本末尾。
- 多行输入时只有最后一行末尾显示 cursor，前面行不显示 cursor。
- no-color / ASCII fallback 使用 `|`，不使用 `▌`。
- Ink renderer 启动后写入 hide cursor escape：`\x1B[?25l`。
- Ink renderer 在 unmount、stdin/stdout close/error、render fallback/error 路径恢复 show cursor：`\x1B[?25h`。
- cursor hide/show 均用 try/catch 包裹，stdout 关闭时不崩溃；业务异常继续抛出，不吞掉。
- Home brand underline 到 vision/slogan 之间保留 1 行间距；未把 Home 改成顶部工作台。
- plain renderer 只渲染自绘 prompt/cursor 文本，不隐藏终端原生 cursor。

### 明确未做

- 未修改 provider、模型请求、工具执行、权限、任务、会话或业务流程逻辑。
- 未真实 provider smoke。
- 未声明 Beta PASS / smoke-ready / open-source-ready。
- 未处理断线前已有的 Home 业务显示 diff；本轮只按用户交接做 cursor 与 brand 间距闭环。

## Changed files

本次 D.12C 相关文件：

- `packages/tui/src/shell/components/Composer.tsx`
  - 增加 `formatComposerRenderLines`，集中生成 prompt marker、自绘 cursor、多行末尾 cursor 与 no-color fallback。
- `packages/tui/src/shell/ink-renderer.tsx`
  - Ink 启动隐藏原生 cursor；unmount / close / error / fallback 恢复原生 cursor。
- `packages/tui/src/shell/plain-renderer.ts`
  - plain home/task composer 行显示 `> placeholder + self-drawn cursor`。
- `packages/tui/src/shell/components/ShellApp.tsx`
  - 保留 brand underline 到 vision/slogan 的 1 行间距。
- `packages/tui/src/shell/view-model.test.ts`
  - 补充 D.12C cursor / no-color / multiline / Ink hide-show / Home brand / width=40 覆盖。
- `docs/delivery/pre-smoke-slice-d12c-composer-cursor-alignment-closure.md`
  - 本交付报告。

工作区中还存在断线前已有未提交 diff / 文档：

- `packages/tui/src/shell/view-model.ts`
- `docs/delivery/pre-smoke-slice-d12c-composer-centered-home-maturity.md`

这些不是本轮 D.12C cursor closure 的新增业务范围。

## Validation

已运行：

```text
corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts
→ PASS：97 tests passed
```

```text
corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts packages/tui/src/index.test.ts
→ PASS：297 tests passed
```

```text
corepack pnpm typecheck
→ PASS
```

```text
corepack pnpm check
→ PASS with 1 existing warning
```

既有 warning：

```text
packages/tui/src/model-doctor-runtime.test.ts:91:9 suppressions/unused
```

```text
git diff --check
→ PASS
```

额外验证：

```text
corepack pnpm --filter @linghun/tui build
→ PASS
```

```text
node -e "import('./packages/tui/dist/index.js').then(()=>console.log('dist import ok'))"
→ PASS：dist import ok
```

## Warning closure addendum

本次追加做了一个最小 `MaxListenersExceededWarning` 收口，不改业务逻辑。

实际定位结果：

- 优先检查了 `packages/tui/src/process-guard.ts`；该文件已有 `hooksInstalled` 模块级幂等保护。
- 使用 `NODE_OPTIONS=--trace-warnings` 追踪后，实际 `beforeExit` listener 来源不是 ProcessGuard，而是 Ink 内部 `waitUntilExit()`：
  - `Ink.waitUntilExit (.../ink/src/ink.tsx:880:12)`
  - `packages/tui/src/shell/ink-renderer.tsx:109:22`
  - `packages/tui/src/shell/view-model.test.ts:1483:17`

最小修复：

- `packages/tui/src/shell/ink-renderer.tsx`
  - 缓存 `instance.waitUntilExit()` promise，避免重复调用重复注册 listener。
  - shell 已 `unmount()` 后，`waitUntilExit()` 直接返回，不再调用 Ink 内部 `waitUntilExit()`。
- `packages/tui/src/shell/view-model.test.ts`
  - 增加最小回归：`unmount()` 后重复 `waitUntilExit()` 不增加 `process.beforeExit` listener。

追加验证：

```text
corepack pnpm exec vitest run packages/tui/src/process-guard.test.ts packages/tui/src/shell/view-model.test.ts packages/tui/src/index.test.ts
→ PASS：3 files passed，308 tests passed（process-guard 10，view-model 98，index 200）
→ final run 未再输出 MaxListenersExceededWarning
```

```text
corepack pnpm typecheck
→ PASS
```

```text
corepack pnpm check
→ PASS with 1 existing warning
```

既有 warning 仍为：

```text
packages/tui/src/model-doctor-runtime.test.ts:91:9 suppressions/unused
```

```text
git diff --check
→ PASS
```

本收口未修改 provider、TUI 业务流程、permission、job 行为；未声明真实 smoke / Beta PASS / smoke-ready / open-source-ready。

## Test coverage added

- empty Composer render 包含 prompt marker 与自绘 cursor。
- typed Composer render cursor 位于文本末尾。
- multiline Composer render cursor 只在最后一行末尾。
- no-color Composer render 不包含 `▌`，使用 `|`。
- Ink renderer render/unmount 覆盖 `\x1B[?25l` / `\x1B[?25h`。
- Ink renderer stdout close 路径恢复 `\x1B[?25h`。
- Home brand / vision 仍渲染，未切换成顶部工作台。
- width=40 render 不崩。

## Runtime / risk facts

- Provider/model：未触发真实 provider；本轮仅本地 TUI/source-level validation。
- 权限模式：本地文件修改与本地验证命令。
- codebase-memory：`F-Linghun` index status 为 `ready`，nodes=2077，edges=4491。
- Cache / usage：未触发模型 provider 调用，未产生真实 provider usage。
- Plain renderer：不隐藏终端原生 cursor，只输出 prompt/cursor 文本。
- Ink renderer：隐藏/恢复终端原生 cursor；stdout 关闭异常被局部保护，不吞业务异常。

## Reference check

实际读取的 Linghun 文档：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`

实际读取/确认的源码：

- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/ink-renderer.tsx`
- `packages/tui/src/shell/plain-renderer.ts`
- `packages/tui/src/shell/text-utils.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/index.ts`

行为参考：CCB 截图事实中“输入区只有一个光标，位置紧跟 prompt/输入文本”。

未复制可疑源码实现；本轮只做 Linghun 自研最小补丁。

## Handoff packet

- 下一步：用户审核本次 D.12C diff；如需进入真实 smoke，需单独确认。
- 禁止事项：不得把本次 local validation 说成 Beta PASS / smoke-ready / open-source-ready；不得借本次 cursor closure 扩展 provider、权限、任务或业务逻辑。
- 证据引用：本文件 Validation 小节；`packages/tui/src/shell/view-model.test.ts` 的 D.12C test block；本地命令输出 transcript。
- 验证结果：local tests/typecheck/check/build/import 均通过；`check` 仅保留既有 warning。
- 索引状态：`F-Linghun` ready，nodes=2077，edges=4491。
- 权限模式：本地仓库修改；未远程执行；未改依赖/配置。
- 模型/provider：未真实 provider smoke。
- 预算/成本：未产生 provider 成本。
