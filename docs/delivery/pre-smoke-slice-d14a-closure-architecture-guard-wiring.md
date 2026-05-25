# D.14A-Closure Architecture Guard Wiring

## 阶段目标

将 D.14A 创建的三个 guard 模块（verification-level、runtime-path-marker、architecture-boundary）接入实际运行时入口，使 guard 在 /doctor、任务完成摘要、runner/provider/TUI 启动和报告校准中可见可用。

核心要求：所有用户可见输出使用自然语言，不暴露内部枚举。内部 marker 保持内部；主输出解释：达成了什么、未达成什么、为什么不能声称 mature/ready/PASS、下一步需要什么真实验证。

## 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/tui/src/guard-wiring.ts` | 新增 | 自然语言 guard wiring 层 |
| `packages/tui/src/guard-wiring.test.ts` | 新增 | 24 个针对性测试 |
| `packages/tui/src/terminal-readiness-presenter.ts` | 修改 | TerminalReadinessView 新增 runtimePath/verificationLevel/startupPath 字段 + readiness items |
| `packages/tui/src/index.ts` | 修改 | 接入 guard wiring re-exports + createTerminalReadinessView 生成 guard markers |

## 已完成功能

### 1. Guard Wiring Layer (`guard-wiring.ts`)

自然语言翻译层，将内部 guard 分类转为用户可见消息：

- `formatRuntimePathDoctor()` — /doctor 输出 TUI 渲染路径状态
- `formatStartupPathDoctor()` — /doctor 输出 CLI 入口路径状态
- `formatVerificationLevelDoctor()` — /doctor 输出验证等级状态
- `formatRunnerGuardSummary()` — Runner 验证摘要（node fallback 不能声称 native mature）
- `formatProviderGuardSummary()` — Provider 验证摘要（cooldown/mock/fallback 不能声称 ready）
- `validateCompletionClaim()` — 任务完成声明校验（检测膨胀）
- `validateChangeDeclarationHuman()` — 变更声明校验（大改动需声明 realSmokeRequired）

所有函数支持 `zh-CN` / `en-US` 双语输出。

### 2. TerminalReadinessView 扩展

新增三个可选字段：

```typescript
runtimePath?: {
  path: string;
  kind: "main" | "fallback";
  canClaimMature: boolean;
  degradedReason?: string;
};
verificationLevel?: {
  level: string;
  canClaimPass: boolean;
  canClaimMature: boolean;
  upgradeBlocked: boolean;
  blockReason?: string;
};
startupPath?: {
  entryKind: string;
  isVerifiedCurrent: boolean;
  staleRisk: boolean;
  staleReason?: string;
};
```

### 3. Readiness Items 接入

`createReadinessItems()` 新增三个条件 readiness item：
- `runtime-path` — 当 runtimePath 存在且为 fallback 时显示
- `verification-level` — 当 verificationLevel 存在且 upgradeBlocked 时显示
- `startup-path` — 当 startupPath 存在且有 staleRisk 时显示

### 4. createTerminalReadinessView 接入

三个 helper 函数在 `createTerminalReadinessView` 中生成 guard markers：
- `createRuntimePathForReadiness()` — 检测 TTY/CI/Ink/env override/config
- `createVerificationLevelForReadiness()` — 从 context.verificationEvidence 推断等级
- `createStartupPathForReadiness()` — 从 process.argv/env 推断入口类型

### 5. Re-exports

`index.ts` 新增 guard-wiring 模块的完整 re-export。

## 拦住的伪成熟路径

| 场景 | 拦截方式 |
|------|----------|
| plain/non-tty 报告 "TUI mature" | formatRuntimePathDoctor 输出降级原因 + 不能声称 |
| node fallback 报告 "native runner mature" | formatRunnerGuardSummary 明确说明 |
| provider cooldown 报告 "provider ready" | formatProviderGuardSummary 明确说明 |
| mock PASS 升级为 real PASS | validateCompletionClaim 检测膨胀 |
| source-only 声称 build PASS | validateCompletionClaim 检测膨胀 |
| 大改动不声明 realSmokeRequired | validateChangeDeclarationHuman 警告 |
| dist/global-bin 声称 source-level verification | formatStartupPathDoctor 标记 stale risk |

## 验证结果

```
typecheck: PASS (0 errors)
vitest guard-wiring.test.ts: 24/24 PASS
vitest index.test.ts regression: 200/200 PASS
biome check: 0 errors, 1 pre-existing warning (non-D.14A-Closure)
git diff --check: clean
```

## 仍然必须 Real Smoke 的项目

| 项目 | 原因 |
|------|------|
| /doctor 实际 TUI 渲染 | 测试环境无真实 TTY，guard wiring 只生成数据，不验证 Ink 渲染 |
| Readiness items 实际显示效果 | 需要真实终端观察 readiness panel 输出 |
| Provider 真实 endpoint 响应 | formatProviderGuardSummary 只格式化，不发请求 |
| Windows conhost vs Windows Terminal 差异 | isTTY 检测在不同终端行为不同 |
| 全局 bin / desktop cmd 启动路径 | createStartupPathForReadiness 依赖 process.argv 推断 |

## 不在本阶段处理

- TUI 视觉修改
- 自动学习功能（D.14B）
- 报告自动拦截（本阶段只提供 wiring，拦截逻辑由调用方决定）
- index.ts 实际拆分
- guard 自动修复建议

## 参考核对

- 本阶段实际读取：guard-wiring.ts 依赖的 verification-level.ts、runtime-path-marker.ts、architecture-boundary.ts（D.14A 产出）
- 本阶段实际参考：terminal-readiness-presenter.ts 现有 TerminalReadinessView 类型和 createReadinessItems 模式
- 本阶段参考：CCB 的 /doctor 输出风格（行为参考）、成熟社区 CLI health check 模式（行为参考）
- 进入 Linghun 自研实现：guard-wiring.ts 为 clean rewrite，无复制可疑源码

## Handoff Packet

- **下一阶段**: D.14B 自动学习 / D.15 Pre-Beta 收尾
- **禁止事项**: 不得将 guard wiring 输出的 "不能声称" 消息静默吞掉；不得在 fallback 路径下声称 mature
- **证据引用**: guard-wiring.test.ts 24 tests + index.test.ts 200 tests regression
- **验证结果**: typecheck PASS, vitest PASS, biome PASS
- **索引状态**: codebase-memory 索引未在本轮使用（不可用），使用本地 grep/read
- **权限模式**: 无新权限需求
- **模型/provider**: 无变更
- **预算使用**: 无 API 调用，纯本地验证
