# 修复项8：Compact memory 不得复活

## 问题描述

在 context compact 过程中，projection 保存了 memory 的权威副本（通过 `restoreContext.userConstraints`），导致以下问题：

1. projection 中保存了从 `context.memory.accepted` 提取的 `userConstraints` 内容副本
2. restore 时直接使用缓存的 projection 数据，未重新查询当前 memory store
3. 如果在 compact 后删除或禁用了某个 memory，恢复时可能仍然使用旧的副本，导致已删除/禁用的 memory 复活

## 修复方案

### 1. 移除 projection 中的 memory 内容副本

**文件**: `packages/tui/src/tui-data-types.ts`
- 从 `CompactRestoreContext` 类型中移除 `userConstraints: string[]` 字段
- 只保留 memory 的统计信息（`memoryStatus: string`）

**文件**: `packages/tui/src/compact-preflight-runtime.ts`
- 在创建 `restoreContext` 时，不再从 `context.memory.accepted` 中提取和保存 `userConstraints`
- 从 `stableProjection` 的摘要中移除 `userConstraints` 行

### 2. 在 restore 时重新查询当前有效 memory

**文件**: `packages/tui/src/compact-restore-runtime.ts`

修改内容：
1. 添加 `isMemoryTombstoned` 和 `MemoryCandidate` 导入
2. 新增常量：
   - `RESTORE_MEMORY_LIMIT = 4`
   - `RESTORE_MEMORY_ITEM_MAX_CHARS = 160`
3. 在 `CompactRestorePayload` 类型中添加 `userConstraints: string[]` 字段
4. 新增 `collectUserConstraints(context: TuiContext): string[]` 函数：
   - 从当前 `context.memory.accepted` 重新查询
   - 过滤条件：
     - `status === "accepted"`
     - `scope === "user" || taxonomy === "user"`
     - 不在 tombstone 索引中（`!isMemoryTombstoned(tombstoneIndex, item)`）
   - 返回前 4 条有效 memory 的 summary
5. 在 `buildPostCompactRestorePayload` 中调用 `collectUserConstraints`
6. 在 `formatPostCompactRestorePayload` 中添加 `userConstraints` 的格式化输出

### 3. 添加测试验证

**文件**: `packages/tui/src/compact-restore-runtime.test.ts`

新增 3 个测试用例：

1. **"does not resurrect deleted memory after compact"**
   - 创建一个已被 tombstone 标记的 user memory
   - 验证 `buildPostCompactRestorePayload` 返回空的 `userConstraints`

2. **"does not resurrect disabled memory after compact"**
   - 创建一个 status 为 "disabled" 的 user memory
   - 验证 `buildPostCompactRestorePayload` 返回空的 `userConstraints`

3. **"restores only current valid user memory after compact"**
   - 创建一个有效的 user memory 和一个已删除的 user memory
   - 验证只有有效的 memory 被返回

## 关键设计决策

1. **不保存 memory 副本**：projection 只保存统计信息，不保存完整内容，避免绕过 memory lifecycle
2. **restore 时重新查询**：每次 restore 都从 `context.memory.accepted` 重新查询，确保使用最新状态
3. **应用 tombstone 过滤**：使用 `isMemoryTombstoned` 确保已删除的 memory 不会被恢复
4. **应用 status 过滤**：只恢复 status 为 "accepted" 的 memory
5. **复用现有 memory store/lifecycle**：不新增 restore memory 层，完全依赖现有机制

## 影响范围

修改的文件：
- `packages/tui/src/tui-data-types.ts`: 类型定义修改（移除 userConstraints 字段）
- `packages/tui/src/compact-preflight-runtime.ts`: 移除 memory 副本保存逻辑
- `packages/tui/src/compact-restore-runtime.ts`: 添加 memory 重新查询逻辑
- `packages/tui/src/compact-restore-runtime.test.ts`: 新增 3 个测试用例

## 验证结果

1. ✅ 语法检查：所有修改文件通过 Node.js 语法检查
2. ⏳ TypeCheck：等待依赖安装完成后运行
3. ⏳ 测试：等待依赖安装完成后运行新增测试

## 未完成的验证

由于 worktree 中的依赖安装尚未完成，以下验证需要在依赖安装完成后进行：

1. 运行 `corepack pnpm typecheck` 确保类型正确
2. 运行 `corepack pnpm --filter @linghun/tui test src/compact-restore-runtime.test.ts` 验证新增测试
3. 运行完整测试套件确保没有回归

## 手动测试场景

建议在提交前进行以下手动测试：

1. **Compact → Delete → Resume**
   - 进行一次 compact
   - 删除一个 user memory
   - 触发新的 compact/restore
   - 确认被删除的 memory 不会出现在恢复的 userConstraints 中

2. **Compact → Disable → Resume**
   - 进行一次 compact
   - 禁用一个 user memory
   - 触发新的 compact/restore
   - 确认被禁用的 memory 不会出现在恢复的 userConstraints 中

3. **Compact → Normal → Resume**
   - 进行一次 compact
   - 保持 memory 正常状态
   - 触发新的 compact/restore
   - 确认有效的 memory 正常恢复

