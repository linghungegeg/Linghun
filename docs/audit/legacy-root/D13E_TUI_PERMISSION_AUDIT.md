# D.13E TUI Permission & Output Block — 只读对照审计

只读对照 `F:\ccb-source` / `F:\freecodex\opencode-source` / `F:\freecodex\warp-source` 与 Linghun 当前 TUI（`packages/tui/src/shell/`）。
范围：permission prompt、composer、output block、footer 互斥与可扫读。
约束：不动 provider / env / view-model 数据流；不跑 smoke；不 commit；P0 ≤ 3 文件。

---

## 1. 三个参考源的关键事实

### 1.1 CCB（`F:\ccb-source`）

- **`PermissionPrompt`（共享外壳）**
  - 同一 Box 内绑定三段：
    1. 标题 / 风险 / 命令 / 路径 等 body 行
    2. `<Select options={...} />` 选项行（每个 option 自带 `feedbackConfig`）
    3. 底部 hint：`Esc 取消{showTabHint && ' · Tab 修改'}`
  - 选项侧的 `feedbackConfig: { type: 'accept' | 'reject' }` 决定按 Tab 时是否在卡内展开 reject feedback 文本框。
- **`FallbackPermissionRequest`**
  - 选项标签是命题式："Yes" / "Yes, and don't ask again for `<tool>` commands in `<cwd>`" / "No"。标签直接陈述会发生什么，不依赖外部 hint 解释。
- **结论**
  - body + options + hint 始终在一个块里，不被 composer 边界切开。
  - 4 档提权（once / always-tool / always-cwd / deny）由 option 列表 + feedbackConfig 自然表达。

### 1.2 OpenCode（`F:\freecodex\opencode-source`）

- **`routes/session/permission.tsx`**
  - 显式 3 阶段状态机：`type PermissionStage = "permission" | "always" | "reject"`。
    - `permission`：3 选项 Allow once / Allow always / Reject；← → / h l / Tab 在选项间走，Enter 确认，Esc → 进入 reject。
    - `always`：再确认一次"是否真的要授予永久权限"。
    - `reject`：textarea 输入"Tell OpenCode what to do differently"，提交后把反馈带回上层。
  - body / button row / hint 共属一个 panel，键盘事件全部由该 panel 拥有。
- **`routes/session/footer.tsx`**
  - footer 强互斥：当 `permissions().length > 0`，footer 用 warning 色显示 `△ N Permission(s)`，常规 lsp / mcp / status 文案让位。
- **结论**
  - 永久授权先经过单独"再确认"阶段，避免误按一次就长期生效。
  - reject 不是终态，而是带反馈回流的协作动作。
  - footer 在 permission 等待时只剩一句最高优先级文字，与主屏卡片节奏对齐。

### 1.3 Warp（`F:\freecodex\warp-source`）

- 仅参考产品方向，不引用 Rust 实现。
- transcript 以 block 为单位：每个 block 自带 status（running / pass / fail / blocked），block 之间留白，可独立选择 / 折叠。
- editor 是固定 footer，永远 1–N 行 well-defined 区域，不会被 transcript 覆盖。
- request status 与 block status 分轨：editor 行只描述"我在等什么"，不重复 block 内的明细。
- **结论（产品方向）**：block 之间可视分隔 + editor 区域稳定 + 状态分轨 = 长会话仍然可扫读。

---

## 2. Linghun 当前 TUI 的事实

来源：`packages/tui/src/shell/types.ts`、`components/ShellApp.tsx`、`components/Composer.tsx`、`components/ProductBlock.tsx`、`models/input-owner-controller.ts`。

### 2.1 已经吸收的部分

1. **Owner-priority dispatcher**：`selectInputOwner` 纯函数化（`models/input-owner-controller.ts`），优先级 `permission > paste > slash > composer`，与 Composer.tsx useInput 的实际派发一致，单测可覆盖。
2. **UI 互斥优先级**：`ShellApp.TaskLayout` 已实现 `permission > configPanel`，Composer 在 ConfigPanel 渲染时 `useInput { isActive: false }`，避免双消费。
3. **4 档提权 ID 已落地**：`PermissionActionId = "allow_once" | "allow_always_tool" | "deny" | "details" | "cancel"`，并兼容 legacy `yes` / `no`（controller 端做映射）。
4. **单字母快捷键**：Composer 中 `y → allow_once`、`a → allow_always_tool`、`n → deny`、`d → details`，Esc 单独走 cancel；Enter 走当前高亮项。
5. **Paste / 双击 Esc / slash**：`PASTE_THRESHOLD=16`、100 ms 聚合窗口、`DOUBLE_PRESS_WINDOW_MS=1000` 双击清空、slash 候选 sticky-hidden 状态都已实现。
6. **TaskFooter 收敛**：从完整 StatusTray 缩到 `permissionMode · index · hint`，不再把"[Linghun] 会话…"灌进 task 区。
7. **Anchored cursor**：`useAnchoredCursor` 在 permission 卡显示时走 null 分支隐藏原生光标，让 PermissionActionRow 成为唯一焦点。

### 2.2 与参考源对比仍然欠缺的点

1. **PermissionPrompt 卡 与 PermissionActionRow 空间割裂**（最严重）
   - `ShellApp.PermissionPrompt` 在 output 区渲染：toolName / 风险 / reason / scope / hint。
   - `Composer.PermissionActionRow` 在 composer band 渲染：`[ ▸Allow once ] [ Allow always tool ] [ Reject ] [ Details ]`。
   - body 与 options 中间隔了一段任意高度的 output 内容 + 一条分隔线，眼睛要在两个区域跳跃；CCB / OpenCode 都把它们绑在同一卡内。
2. **缺锚定问题行**：CCB / OpenCode 都在 body 末尾给一句"是否继续？"或"Do you want to proceed?"作为视觉锚点。Linghun 当前只列 reason / scope，缺少这一行直接读的 Yes/No 提示。
3. **缺标准 hint 行**：CCB 卡底有 `Esc 取消 · Tab 修改`；Linghun 把 hint 放在 `permission.hint` 字段里但与 actions 不在同一视觉块。
4. **option 标签不是命题式**：Linghun 现在依赖 `actions[i].label` 默认字符串（如 "允许一次"）。CCB 的 `Yes, and don't ask again for <tool> commands in <cwd>` 把 scope 直接写进标签，能在不看 reason 的情况下做决定。
5. **缺 `always` 再确认阶段**：OpenCode 在按 "Allow always" 后会切到独立确认页；Linghun 的 `allow_always_tool` 一次性提交，没有反悔窗口。
6. **缺 reject 反馈回流**：现在 `cancel` / `deny` 走单一路径，没有 OpenCode 的 reject + textarea 模式。`feedbackConfig` 这个概念在 view-model 里没有对应字段。
7. **ProductBlock 之间没有可视间距**：所有 kind（home/repo/setup/permission/run/tool/error/details/command）`marginBottom={0}`，连续多个 block 时眼睛找不到边界，与 Warp block-as-unit 的可扫读节奏相反。
8. **`error` / `blocked` 状态没有边框**：只有 `permission` 和 `fail` 走 `borderStyle="single"`，错误 / 阻塞类 block 在长输出里很容易被忽略。
9. **`/xxx` 命令 echo 行单薄**：`command` kind 渲染为单行 `❯ /xxx`，没有时间戳 / 序号 / 分隔，多次连续命令时无法快速回看是第几次执行。

---

## 3. P0 / P1 / P2 修复方案

约束复述：P0 ≤ 3 文件、不动 provider/env、不动 view-model 类型、不跑 smoke、不 commit。

### 3.1 P0（permission 体感 + 块可扫读，3 文件）

| # | 改动 | 目标文件 | 影响行为 |
|---|------|----------|----------|
| **P0-1** | 把 `PermissionActionRow` 从 Composer band 移进 `PermissionPrompt` 卡，使 body + options 同卡。Composer 仍持有 owner 派发，只是不再自己渲染按钮行；按下 y/a/n/d/Enter/Esc 时 onInput 还是同一条 `permission-action`。 | `packages/tui/src/shell/components/ShellApp.tsx`, `packages/tui/src/shell/components/Composer.tsx` | body / options 视觉合一；空间割裂消失 |
| **P0-2** | 在 `PermissionPrompt` 卡末尾加锚定问题行（`是否继续？` / `Do you want to proceed?`）和标准 hint 行（`Esc 取消 · ↵ 确认 · Tab 切换`）。文案就地用 `view.language` 切换，不动 view-model。 | `packages/tui/src/shell/components/ShellApp.tsx` | 命题清晰；hint 与 options 同卡 |
| **P0-3** | `ProductBlock` 改 `marginBottom: 1`，但 `kind === "command"` 保持 0（命令 echo 仍贴近后续输出）。其它 kind 之间天然隔行。 | `packages/tui/src/shell/components/ProductBlock.tsx` | 多 block 序列可扫读 |

P0 涉及文件总数：**3** —— `ShellApp.tsx` / `Composer.tsx` / `ProductBlock.tsx`，全部在 `packages/tui/src/shell/components/`。
不改 `types.ts` / view-model / controller / providers / env / config。

P0 验证（建议手动 + 现有单测，不在本审计内执行）：
- `pnpm --filter @linghun/tui typecheck`
- `pnpm --filter @linghun/tui test --run` 范围内已有 owner / view-model 单测。
- 手动：触发 permission 流，确认 body + options + hint 在同一框内、按 y/a/n/d/Enter/Esc 行为不变。

### 3.2 P1（提权语义对齐 CCB / OpenCode）

| # | 改动 | 范围 | 说明 |
|---|------|------|------|
| **P1-1** | 选项标签命题化：在 view-model 装配处把 `actions[i].label` 从"允许一次/总是允许/拒绝/详情"改为命题文案，例：`总是允许 <toolName>(在 <cwd>)` / `Always allow <toolName> in <cwd>`。 | view-model assembly（Composer / ShellApp 不变） | 不读 reason 也能判断 |
| **P1-2** | 把 `cancel` 拆成 `reject` + 可选 feedback。新增 `permission.stage: "permission" \| "always" \| "reject"` 字段（view-model 层），reject 阶段卡内出现单行 input。controller 把 reject + 文本一起回流。 | `types.ts` + view-model + Composer/ShellApp | 对齐 OpenCode reject |
| **P1-3** | `allow_always_tool` 之后切到 `stage="always"` 再确认页，单选项 Confirm/Back，避免误按。 | view-model + ShellApp | 对齐 OpenCode always 阶段 |

P1 会动 `types.ts`，不在 P0 范围。

### 3.3 P2（可扫读 / 复盘细节）

| # | 改动 | 范围 |
|---|------|------|
| **P2-1** | `error` / `blocked` 状态的 `ProductBlock` 加 `borderStyle="single"` + 状态色边框。 | `ProductBlock.tsx` |
| **P2-2** | `command` block 加 dim 时间戳或调用序号（`❯ /xxx · 19:42:11` / `#3 ❯ /xxx`）。 | `ProductBlock.tsx` |
| **P2-3** | `detail` / `nextAction` 文本走 `fitText` 截断，超长不撑破布局。 | `ProductBlock.tsx` |
| **P2-4** | TaskFooter 增加权限模式切换提示：在 `permissionMode` 段后追加 `Shift+Tab 切换`（仅 task 模式）。 | `ShellApp.TaskFooter` |

P2 全部在 `ProductBlock.tsx` / `ShellApp.tsx`，仍然不碰 types / view-model / providers。

---

## 4. 边界声明

- 全程只读检查 + 静态对照，没有运行 smoke、没有改任何文件、没有 commit。
- Warp 部分仅参考产品方向（block-as-unit / editor-fixed-footer / status-split），未读取也未引用其 Rust 源码实现。
- CCB / OpenCode 引用限于 prompt 组件结构、option 标签习惯、stage 状态机、footer 让位策略；未复制可疑源码或专有逻辑。
- 不涉及 provider、模型、env、配置、缓存、权限引擎、安全边界等任何运行时。
- 文档落点：本文件位于仓库根目录，作为 D.13E TUI 闭环改动的源依据；后续 P0 实施需用户明确启动 Start Gate。
