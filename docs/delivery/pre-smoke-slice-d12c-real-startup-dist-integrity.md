# Slice D.12C — 真实启动 dist 产物完整性修复

> 日期：2026-05-25
> 范围：修复 `packages/tui` build 产物缺失导致的 `ERR_MODULE_NOT_FOUND` 启动失败。不改业务逻辑、provider loop、TUI 行为、permission/job/runner。
> 状态：未真实 smoke；未 Beta PASS / smoke-ready / open-source-ready。

---

## 问题

cmd 启动报错：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'F:\Linghun\packages\tui\dist\index-runtime.js'
imported from F:\Linghun\packages\tui\dist\index.js
```

根因：`packages/tui/package.json` 的 tsup build entry 未包含 `src/index-runtime.ts`。tsup 在当前版本会将其内联到 `dist/index.js`，但当 dist 目录有旧 tsc 产物残留（`.d.ts` 存在但 `.js` 不存在）时，Node.js 模块解析会优先匹配到不完整的文件路径导致失败。

---

## 修复内容

### 1. build entry 补全

`packages/tui/package.json` build 脚本新增 `src/index-runtime.ts` 为显式 tsup entry：

```
tsup src/index.ts src/index-runtime.ts src/index-safety-repair.ts ...
```

效果：`dist/index-runtime.js` 现在作为独立产物显式输出，不再依赖 tsup 内联行为。

### 2. 其他本地模块完整性确认

检查 `dist/index.js` 所有相对 import 的本地模块：

| 模块 | 状态 |
|------|------|
| `./index-runtime.js` | 本次修复（新增 entry） |
| `./context-estimator.js` | tsup 内联到 index.js（无外部引用） |
| `./model-loop-runtime.js` | tsup 内联到 index.js（无外部引用） |
| `./shell/plain-renderer.js` | tsup 内联到 index.js（无外部引用） |
| `./index-safety-repair.js` | 已在 entry 中 |
| `./runtime-status-presenter.js` | 已在 entry 中 |
| `./tool-output-presenter.js` | 已在 entry 中 |
| `./natural-command-bridge.js` | 已在 entry 中 |
| `./permission-presenter.js` | 已在 entry 中 |

build 后 `dist/index.js` 的相对 import 只有 chunk 文件，全部存在。

### 3. dist 完整性回归测试

新增 `packages/tui/src/dist-integrity.test.ts`（4 个测试）：

- `dist/index.js` 存在
- `dist/index.js` 所有相对 import 对应文件存在
- `dist/index-runtime.js` 所有相对 import 对应文件存在
- `dist/index.js` 可被 `import()` 动态加载（不触发真实 provider/key）

---

## 验证结果

```
corepack pnpm --filter @linghun/tui build
→ 通过，dist/index-runtime.js (229B) 显式输出

node -e "import('./packages/tui/dist/index.js').then(()=>console.log('dist import ok'))"
→ dist import ok

corepack pnpm exec vitest run packages/tui/src/dist-integrity.test.ts
→ 4 passed

corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts packages/tui/src/index.test.ts
→ 285 passed (85 + 200)

corepack pnpm typecheck
→ 通过

corepack pnpm check
→ 通过（1 个无关 warning：model-doctor-runtime.test.ts 中已有的 biome-ignore）

git diff --check
→ 通过
```

---

## 改动文件列表

- `packages/tui/package.json` — build entry 新增 `src/index-runtime.ts`
- `packages/tui/src/dist-integrity.test.ts` — 新增 dist 产物完整性回归测试

未触碰：provider loop、model gateway、job/runner 状态机、permission approval 语义、ProcessGuard、TUI 行为逻辑。

---

## 声明

- 未真实 smoke
- 未 Beta PASS / smoke-ready / open-source-ready
- 本修复仅解决 build 产物缺失导致的启动失败，不改变任何运行时行为
