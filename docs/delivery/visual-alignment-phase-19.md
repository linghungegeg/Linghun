# Visual Alignment Phase 19 — 远程连接状态指示器

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

Footer 右侧新增 `● remote` 状态指示器；远程模式下权限模式指示器 dim。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `PromptInputFooterLeftSide.tsx:348-355` 的 `● remote` Link 指示器 + `!getIsRemoteMode()` 隐藏权限模式 |
| 自研行为 | Linghun `StatusFooter` 追加 `● remote` dim 段 + `isRemoteMode` 时 dim 权限模式（不隐藏） |
| 新增模块 | 无新文件 |

## 已完成功能

### 19A. Remote 状态指示器

- **StatusFooter.tsx** — 
  - `footer.isRemoteMode` 为 true 时，权限模式指示器染 dim（`dimColor`）
  - 右侧段前追加 `● remote` dim 色（`remoteSegment` prefixed to `allRightSegments`）
  - 宽屏（≥80）/窄屏（<80）两条路径均覆盖
- **view-model.ts** — `buildTaskFooterView` 从 `context.remote?.enabled ?? false` 计算 `isRemoteMode`，传入 `TaskFooterView`
- **types.ts** — `TaskFooterView` 新增 `isRemoteMode?: boolean`

### 行为对比

| 维度 | CCB | Linghun |
|------|-----|---------|
| 触发条件 | `remoteSessionUrl` 存在 | `context.remote.enabled === true` |
| 权限模式 | 隐藏（`!getIsRemoteMode()`） | dim 降级（不隐藏，保留可见） |
| remote 指示 | Link（可点击 URL）| dim 文本（无 URL，通知桥接模式） |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/types.ts` | `TaskFooterView` 新增 `isRemoteMode` 字段 |
| `packages/tui/src/shell/view-model.ts` | `TaskFooterInput` + `buildTaskFooterView` + call site 传入 `isRemoteMode` |
| `packages/tui/src/shell/components/StatusFooter.tsx` | 窄屏/宽屏双路径：dim permission mode + `● remote` 段 |

## 关键设计

1. **信息来源：** `context.remote.enabled` — Linghun 的 remote 是通知/桥接模式（飞书/钉钉/企微 webhook），不基于 WebSocket session URL。`isRemoteMode` 从已有 state 计算，零新依赖。
2. **Dim 非隐藏：** 与 CCB 的 `!getIsRemoteMode()` 完全隐藏不同，Linghun 选择 dim 降级而非隐藏 — 远程桥接模式下用户仍可本地切换权限模式。
3. **统一段渲染：** remote 段通过 `remoteSegment` 预置数组并入 `allRightSegments`，复用现有 separator (`·`) 和 color/dimColor 逻辑。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

```
packages/tui shell/* — 全部通过:
  view-model.test.ts      344 passed
  status-footer 相关       覆盖在 ink-interaction-smoke
  shell 全 17 文件         593 passed
```

### 手动验证路径

1. `linghun` 启动，确认无 remote 配置时 Footer 不变（无 `● remote` 段）
2. 模拟 remote enabled 场景：确认 `● remote` 出现在 Footer 右侧最前（dim 色）
3. 确认权限模式指示器 dim 降级
4. 窄屏（<80 列）同样显示 `● remote`

## 已知问题

- `remote.enabled` 不区分 active/inactive 连接；仅 enabled/disabled 布尔。未来可按 channel 连接状态细化。
- 无 CCB Link 可点击跳转 — Linghun remote 是 inbound 桥接，不需要远程 session URL。

## 不在本阶段处理的内容

- Remote 连接状态细化（connecting/reconnecting/disconnected）
- Remote inbox 未读计数显示
- 快捷键行内提示（Phase 16）

## 下一阶段衔接

Phase 16：快捷键行内提示 — Composer 区域追加 `Esc` / `Ctrl+O` / `Shift+Tab` 行内快捷键提示。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §19 |
| 本阶段参考的 CCB 文件 | `PromptInputFooterLeftSide.tsx:328-356`, `AppStateStore.ts:121-127` |
| 行为参考 | CCB `● remote` Link + `getIsRemoteMode()` 条件隐藏模式 |
| 自研实现 | Dim 非隐藏策略；`remoteSegment` 统一段渲染；`context.remote.enabled` 布尔源 |
| 未复制可疑源码 | 仅参考行为模式，Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 19,
  "status": "DONE",
  "next_phase": 16,
  "forbidden": [
    "remote connection URL link rendering (no WS-based session URL in Linghun)",
    "full permission mode hide (Linghun dims instead)",
    "remote connection status refinement (connecting/reconnecting states)"
  ],
  "evidence": ["593 shell tests pass", "view-model 344 pass"],
  "index_state": "not checked (3 files, direct edits)",
  "permission_mode": "auto (not remote)",
  "model": "claude-opus-4-6",
  "budget": "~6s test duration"
}
```
