# D.14A Global Architecture Guard / Anti-Hallucination Runtime Enhancement

## 阶段目标

增强全局架构系统、证据系统、freshness、报告口径和 runtime guard，防止 mock/local/source/fallback/partial/report 被写成 mature/ready/PASS。

## 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/tui/src/verification-level.ts` | 新增 | 统一 verification level classifier |
| `packages/tui/src/verification-level.test.ts` | 新增 | 34 个针对性测试 |
| `packages/tui/src/runtime-path-marker.ts` | 新增 | TUI runtime path classification |
| `packages/tui/src/runtime-path-marker.test.ts` | 新增 | 26 个针对性测试 |
| `packages/tui/src/architecture-boundary.ts` | 新增 | Architecture boundary guard |
| `packages/tui/src/architecture-boundary.test.ts` | 新增 | 31 个针对性测试 |
| `packages/tui/src/index.ts` | 修改 | 最小 re-export 新模块类型和函数 |

## 增强的 Guard / Classifier / Marker

### 1. Verification Level Classifier (`verification-level.ts`)

**覆盖系统：** Evidence / Freshness / Anti-Hallucination / Runner / Provider / Report

- `classifyVerificationLevel()` — 从输入信号推断实际验证等级（mock → source → local → build → real-smoke）
- `isNonUpgradeableStatus()` — 检测 partial/simulated/fallback/mocked/source-only 等不可升级状态
- `detectVerificationInflation()` — 检测报告层把低等级声称为 mature/ready/PASS 的膨胀行为
- `classifyRunnerVerificationLevel()` — Runner 专用：node fallback 不能声称 native runner mature
- `classifyProviderVerificationLevel()` — Provider 专用：mock/cooldown/fallback 不能声称 provider ready
- `formatVerificationLevel()` — 格式化输出，含 blocked reason 和 mature-requires
- `compareVerificationLevels()` — 等级比较

**拦住的伪成熟路径：**
- runner adapter=node 报告为 "native runner mature"
- provider cooldown 期间报告为 "provider ready"
- mock PASS 升级为 real PASS
- source-only 分析声称 build PASS
- fallback 路径声称 main path verified

### 2. Runtime Path Marker (`runtime-path-marker.ts`)

**覆盖系统：** TUI Runtime / Product Shell / CLI Startup / Build Path

- `classifyRuntimePath()` — 分类 TUI 实际渲染路径（ink/plain/non-tty/forced-legacy）
- `classifyStartupPath()` — 分类 CLI 入口（source/dist/global-bin/desktop-cmd）
- `canClaimTuiMaturity()` — 只有 ink main path 能声称 TUI mature
- `canClaimCurrentVerification()` — 只有 source execution 能声称 "当前源码已验证"
- `detectRuntimePathInflation()` — 检测 fallback 路径声称 mature 的膨胀
- `formatRuntimePathMarker()` / `formatStartupPathMarker()` — 格式化输出

**拦住的伪成熟路径：**
- plain/non-tty/forced-legacy 报告为 "TUI mature"
- CI 环境报告为 "ink-verified"
- 旧 dist/global-bin 被误认为当前源码验证通过
- desktop-cmd 脚本声称 source-level verification

### 3. Architecture Boundary Guard (`architecture-boundary.ts`)

**覆盖系统：** Architecture Boundary / Cache / Context / Hot Path / Code Blob

- `checkFileBoundaries()` — 检测大文件（>800行）、god file（>1500行）、大函数（>200行）、深嵌套（>4层）
- `detectCrossLayerImports()` — 检测低层 import 高层（shared→tui 等违规）
- `detectCircularDependencyRisk()` — 检测双向 import 循环依赖风险
- `checkBoundaries()` — 批量检查，输出 critical/warning/info 分级
- `validateChangeDeclaration()` — 验证大改动声明是否包含 mainPath/verificationLevel/realSmokeRequired
- `estimateFileMetrics()` — 从源码文本估算文件指标（无需 AST parser）
- `formatBoundaryViolations()` — 格式化输出

**拦住的伪成熟路径：**
- 大改动（>3文件）不声明 realSmokeRequired
- 不声明 mainPath 和 verificationLevel 的改动
- god file 继续膨胀不被标记
- 跨层 import 不被发现

## 仍然必须 Real Smoke 的项目

| 项目 | 原因 |
|------|------|
| Ink 渲染实际效果 | 测试环境无真实 TTY，classifyRuntimePath 只能标记，不能替代真实 Ink 渲染验证 |
| Native runner Job Object / process group | 测试用 mock spawn，真实 orphan cleanup 需要 real smoke |
| Provider 真实 endpoint 响应 | 测试用 mock fetch，真实 429/503 恢复需要 real smoke |
| Windows conhost vs Windows Terminal 差异 | 测试无法区分，需要真实终端验证 |
| 全局 bin / desktop cmd 启动路径 | 需要真实安装后验证 |
| 大文件实际拆分效果 | boundary guard 只标记，不执行拆分 |

## 验证结果

```
typecheck: PASS (0 errors)
vitest (3 new test files): 91/91 PASS
vitest (index.test.ts regression): 200/200 PASS
biome check: 0 errors, 1 pre-existing warning (non-D.14A)
```

## 不在本阶段处理

- TUI 视觉修改
- 自动学习功能（D.14B）
- index.ts 实际拆分（只增强约束和检测）
- 大范围重构
- 报告自动生成/自动拦截（本阶段只提供 classifier，拦截逻辑由调用方决定）

## 参考核对

- 本阶段实际读取：CLAUDE.md、LINGHUN_PHASED_DELIVERY_BLUEPRINT.md（阶段范围）、现有 runner-runtime.ts、process-guard.ts、architecture-runtime.ts、model-loop-runtime.ts、permission-continuation-runtime.ts、provider-circuit-breaker.ts、log-artifact.ts、model-doctor-runtime.ts、index.ts 类型定义
- 本阶段参考：CCB 的 verification/evidence 分级思路（行为参考）、成熟社区 lint/boundary 检测模式（行为参考）
- 进入 Linghun 自研实现：全部三个 guard 模块为 clean rewrite，无复制可疑源码
