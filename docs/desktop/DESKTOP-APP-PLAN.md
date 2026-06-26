# Linghun Desktop App 方案（Electron · 对齐 Codex Desktop）

> 状态：方案确认中，未开始编码。
> 目标：基于现有 Linghun 底座，做一个独立的跨平台桌面端（Windows 优先），
> 布局与细节对齐 Codex Desktop 的三栏工作台，暗色/亮色双主题。

## 0. 决策基线（已确认）

- 桌面端与 CLI 是**两个平行前端壳，共享同一套引擎底座**；App 自带完整引擎，只装 App 即具备 CLI 全部能力。
- 桌面端是**独立 app**，不重构现有 CLI / TUI（一行不改其行为）。
- **不是「把终端封包进窗口」**：底座（引擎 / 工具 / 权限 / MCP / 会话存储）复用且不动，
  但终端字符 UI 不搬过去；可见层是用 React 从零重画的一套图形界面
  （diff 卡片、审批卡、工具卡、composer 等）。复用的是 `runHeadlessTask` 这个 headless 引擎，
  不是 TUI 的字符界面。引擎不用动，桌面 UI 是全新搭的——这是工作量的大头，需心里有数。
- 后端引擎复用现有 `runHeadlessTask`（完整 agent loop，与 TUI 同源 `sendMessage`），主进程直接 import。
- 主区形态：**三栏** = 左项目/会话/任务栏 + 中线程（对话流+工具执行+composer）+ 右 review 面板（diff/git）。
- 主题：暗色 + 亮色双主题，CSS 变量 token 化。
- 平台优先级：Windows 先，Phase 2 补 macOS / Linux。

## 1. Codex Desktop 参考事实（联网核实）

确定（官方 docs + 官方复刻项目源码）：
- 三栏骨架：project sidebar / active thread / review pane（Windows 同结构）。
- 亮色 + 暗色双主题（官方截图 `-light` / `-dark`）。
- 技术栈：Electron 42 + webview 渲染 + node-pty 内嵌终端 + better-sqlite3 本地存储；
  electron-forge 打 dmg / squirrel / deb / rpm。
- diff/git 在**右侧 review 面板**集中（inspect diff / PR 反馈 / stage / commit / push），
  不塞在对话流里。
- 侧栏 surface：task 摘要、plan、sources、生成文件预览（artifacts）。
- 危险操作色 `#ef4444`（red-500）。

无法核实（闭源，官方未公开）：精确配色 token、字体、间距、圆角数值。
→ 这些用业界暗色规范做合理推断，并在 spec 中标注"推断"，后续可按真实截图微调。

来源：developers.openai.com/codex/app；Haleclipse/CodexDesktop-Rebuild；
openai.com introducing-the-codex-app；第三方实测文章。

## 2. 架构：独立 app + 共享引擎底座

定位：桌面端与 CLI 是**两个平行的前端壳，共享同一套引擎底座**，
而不是 App 内嵌一份 CLI 可执行文件。两者各自独立打包、独立安装、互不依赖；
只装 App 也具备 CLI 的全部能力，因为引擎核心由 App 自带。

```
引擎底座（@linghun/tui · core · providers · config）
apps/
  cli/            ← 前端壳 A：终端交互（不动）
  desktop/        ← 前端壳 B：Electron GUI（新增，独立打包）
    src/
      main/       ← Electron 主进程：import 引擎、托盘、菜单、窗口
      preload/    ← contextBridge IPC 白名单
      renderer/   ← Web UI（React + Vite），三栏布局
      bridge/     ← IPC 事件/命令类型定义（main 与 renderer 共用）
```

进程模型（主进程直接 import 引擎，无子进程、无 NDJSON 解析层）：
```
Electron main ──import──> @linghun/tui · core · providers · config
      │  ↕ runHeadlessTask({ onEvent }) 回调拿结构化 TranscriptEvent
      │  ↕ IPC ←→ preload(contextBridge)
      ▼
Renderer(React) ── 三栏渲染
```

打包形态：App 自带完整引擎包；Rust 二进制（pre-engine / codebase-memory /
native-runner）随 `apps/cli/bundled/` 复制到 `resources/bundled/`，
主进程启动时设 `LINGHUN_CLI_BUNDLED_ROOT = process.resourcesPath + "/bundled"`，
复用现有 `configureCliBundledRoot()` 发现链路。

为什么直接 import 而非 fork CLI 子进程：asar 打包后没有可执行的 `node linghun`，
子进程路径发现麻烦，还要额外 NDJSON 解析层。直接 import 更干净。
崩溃隔离若有需要，留到 Phase 3 用 `worker_threads` 实现，Phase 1 不需要。

## 3. 唯一的无侵入接缝：`onEvent` 回调

现状 `runHeadlessTask` 往 stdout 写**人读文本** + `store.appendEvent()` 写结构化 JSON（两路并行）；
桌面端要画 diff/卡片/审批需**结构化事件**。复用 core 已有的 `TranscriptEvent`
（session_start / user_message / assistant_text_delta / system_event /
background_task_update / checkpoint_created），类型已全量定义，不缺。

改动范围（纯增量，零改引擎逻辑，30 行内）：
- `packages/tui`：`RunHeadlessOptions` 新增 `onEvent?: (event: TranscriptEvent) => void`，
  在 `context.store.appendEvent()` 调用处同步触发这个旁路回调。

这是整个方案唯一需要碰现有代码的地方。Renderer 通过 IPC 订阅该回调即可实时拿到全部结构化事件。

## 4. 设计系统（配色 token）

说明：以下亮色 token 为**对 7 张 Codex Desktop 真实截图逐像素采样**得到（非推断）。
采样脚本 `scripts/_codex_palette_probe.py` / `_codex_deep_probe.py`。
7 张图全部为亮色主题（avgL≈246-251），故**亮色为默认主题**。
diff 色与 danger 色截图未覆盖，标注为推断。暗色主题无截图，整体推断，留 Phase 2。

亮色（默认，真实采样）：
```
--bg-app          #F6F6F6   窗口底 / 标题栏 / 侧栏（采样：占 18-23%）
--bg-sidebar      #F6F6F6   左栏（与 app 同色，靠明度差与主区分层）
--bg-main         #FFFFFF   中间内容区 / 右栏（采样：占 50-63% 主色）
--bg-elevated     #FFFFFF   卡片 / 输入框
--bg-hover        #EDEDEE   hover 态（采样）
--bg-selected     #E8E8E9   侧栏选中项（采样）
--border          #BCBDBE   主分隔线 1px（采样，侧栏/主区分界）
--border-subtle   #E3E3E4   次级细线（采样）
--text            #1F2124   主文字 近黑（采样）
--text-secondary  #35373A   次级（采样）
--text-muted      #5C5E60   占位 / 时间戳（采样）
--accent          #59ACF7   主强调 蓝 hue≈210°（采样，7 张图一致出现）
--accent-hover    #53ABFD   强调 hover（采样）
--danger          #EF4444   删除 / 高风险（patch 脚本核实值）
--warn            #D29922   中风险（推断，截图未覆盖）
--success         #1A7F37   通过 / diff 新增（推断）
--diff-add-bg     #E6FFEC   diff + 行底（推断）
--diff-del-bg     #FFEBE9   diff - 行底（推断）
--card-warm-bg    #FAE1D5   暖色卡片背景（采样，见于审批/提示块，用途待确认）
```
注：`#F5C3A9`（hue≈30° 橙肤）为用户头像色，非 UI token，不纳入。

暗色（Phase 2，无截图，整体推断，待补真实暗色截图后校准）：
```
--bg-app #0D0D0F  --bg-sidebar #141417  --bg-main #1B1B1F
--border #2A2A30  --text #ECECEC  --text-muted #9A9AA2  --accent #6B8AFF
```

风险三档（对齐底座 `TaskPermissionView.risk`）：low=text-muted，medium=warn，high=danger。

## 5. 字体 / 间距 / 圆角

```
UI 字体     系统 sans：Segoe UI（Win） / -apple-system（mac） / system-ui
代码/diff   等宽：ui-monospace, "Cascadia Code", Consolas, monospace
字号        12 / 13(正文) / 15(标题) / 11(footer)
行高        1.5(正文) / 1.45(代码)
间距刻度    4 8 12 16 24 32（统一用这套）
圆角        6px(卡片/输入) / 4px(小标签) / 8px(面板)
边框        1px solid var(--border)，靠背景分层而非阴影
阴影        几乎不用；仅浮层(托盘/下拉)用极淡阴影
```

## 6. 布局规格（cv2 结构检测，真实数据）

检测脚本 `scripts/_layout_detect.py`，对 7 张截图做竖向/横向分隔线 + 卡片 + 文字区检测。
窗口 1459×811。**7 张图一致检测到的结构（按比例换算，非推断）：**

```
标题栏      高 34px（y=34 边界，4%）
侧栏        宽 318px（x=316 边界，22% —— 7 张全一致）
  └ 内部窄元素 x=53（4%，图标/头像左缘）
  └ 顶部区 y=0-177（项目/会话头）
  └ 分隔线 y=177（22%，会话列表区起点）
  └ 底部 y=708-746 x=0-82（设置/头像）
主区        x=318-1459（78%）—— 多数图为「侧栏 + 主区」两栏态，
            最大卡片 (318,36) 1141×775 占屏 74.7%
  └ 线程头 y=36-81（约 45px）
  └ 对话流 y=81-698（滚动区，文字带分布在 x=498-1277 / 34-88%）
  └ composer y≈698-746（底部约 73px）
  └ 底部条 y=746-810
```

**关键修正（基于检测数据）：**
1. 侧栏实测 **318px**（不是之前估的 260/280）
2. 多数截图是**两栏态**（侧栏+主区铺满），右 review 栏**默认折叠**
3. 右 review 栏仅图 6 出现：额外竖分隔 x=858（59%），即开启时 主区≈318-858 / review≈858-1459
4. 图 1 检测到浮层卡片 (483,86) 220×244（33%,11%）——下拉/命令面板/模型选择
5. 图 3（蓝色像素 count=125）检测到 y≈291-351 处两列并排卡片（x=539-759 + x=820-1101）
   —— 多任务/并行 agent 视图，对应 Codex worktree 并行
6. 对话流文字带左缘统一在 x≈498（34%），即主区内容有 ~180px 左内边距/头像列

```
两栏态（默认，多数截图）          三栏态（review 开启，图 6）
┌─标题栏 34px──────────────┐     ┌─标题栏─────────────────┐
├────┬────────────────────┤     ├────┬──────────┬────────┤
│侧栏 │ 线程头 45px        │     │侧栏 │ 线程     │ review │
│318 │ ──────────────────│     │318 │ 318-858  │858-1459│
│px  │ 对话流(滚动)        │     │px  │ 对话流   │ diff/  │
│    │  user/assistant    │     │    │          │ git    │
│ y= │  工具卡/task/审批卡 │     │    │          │        │
│177 │ ──────────────────│     │    │ composer │        │
│分隔│ composer 73px      │     │    │          │        │
│会话│ 底部条             │     │    │          │        │
└────┴────────────────────┘     └────┴──────────┴────────┘
```

折叠规则：review 默认折叠（对齐截图）；窗口 <820px 折侧栏为抽屉。

## 7. 组件清单（Renderer）

左栏：
- `ProjectSwitcher` — 项目根路径切换，显示 git 仓库名
- `SessionList` — 会话列表（id / 摘要 / 时间），点击切换
- `TaskSummaryList` — background_task 摘要，状态色点
- `ArtifactList` — 生成文件预览（checkpoint_created 事件驱动）
- `SidebarFooter` — 设置图标 + 版本号

中栏：
- `ThreadHeader` — 当前会话标题 + 模型标签 + git 分支
- `TranscriptView` — 滚动对话流，渲染以下消息块：
  - `UserMessage` — 缩进、无气泡、monospace 等宽文字区
  - `AssistantMessage` — Markdown 渲染（代码块语法高亮）
  - `ToolCallCard` — 工具执行卡，折叠态显示工具名+target，
                     展开态显示 input/output；图标标注 risk 档
  - `BackgroundTaskRow` — task 单行：进度条 + 状态 + 耗时
  - `PermissionCard` — 内联审批卡：actionSummary + scope + risk 徽章
                       + 按钮组（allow_once / allow_always / deny / details）
  - `SystemEventRow` — dim 渲染系统提示 / 警告
- `StreamingCursor` — assistant 流式输出尾部光标动画
- `Composer` — 底部输入框：多行自增高 textarea + 模型选择 + 发送/停止按钮
- `StatusBar` — 最底部 24px：权限模式 · 模型 · cache 命中率 · index 状态

右栏：
- `ReviewPanel` — 可折叠容器
- `DiffView` — 文件列表 + hunk 展示；+行绿底 / -行红底；行号可点击
- `GitActions` — stage / commit(message 输入) / push 按钮
- `ReviewPanelEmpty` — 无 diff 时的占位（dim 文字）

设置面板（模态，`SidebarFooter` 图标触发）：
- `SettingsModal` — 容器，Tab 导航（通用 / 模型 / MCP / 权限）
  - `SettingsGeneral` — 主题切换（亮/暗/跟随系统）、语言、默认项目路径
  - `SettingsModel` — provider 选择、model 名称、API key 输入（masked）、base URL
  - `SettingsMcp` — MCP 服务器管理：
    - `McpServerList` — 已配置服务器列表（名称 / 传输类型 stdio|sse / 连接状态点）
    - `McpServerForm` — 新增/编辑：name + command/args（stdio）或 url（sse）+ env vars
    - `McpToolWhitelist` — 每个服务器可开启/关闭的工具列表
    - 说明：UI 层仅读写 config 包的 MCP 配置文件；底座 5 个 mcp-*-runtime 无需改动
  - `SettingsPermission` — 默认权限模式（auto-review / ask / deny）、常驻白名单管理

共用：
- `AppTitleBar` — frameless 自绘：控制按钮（Win 右 / mac 左）+ 拖拽区 + app 名
- `ThemeProvider` — CSS 变量注入，暗色/亮色切换
- `ResizeHandle` — 栏宽拖拽调整

## 8. IPC 桥接协议（bridge/）

主进程 → renderer（单向事件流）：
```typescript
// bridge/events.ts
type EngineEvent =
  | { type: "session_start"; sessionId: string; projectPath: string }
  | { type: "user_message"; id: string; text: string }
  | { type: "assistant_delta"; id: string; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown; risk: "low"|"medium"|"high" }
  | { type: "tool_result"; id: string; output: string; error?: string }
  | { type: "task_update"; task: BackgroundTask }
  | { type: "permission_request"; id: string; view: PermissionView }
  | { type: "checkpoint"; files: string[] }
  | { type: "done"; exitCode: number }
  | { type: "error"; message: string }
```

renderer → 主进程（命令）：
```typescript
type EngineCommand =
  | { type: "send_message"; text: string }
  | { type: "permission_reply"; id: string; action: PermissionActionId }
  | { type: "abort" }
  | { type: "open_project"; path: string }
  | { type: "new_session" }
  | { type: "load_session"; id: string }
```

Phase 1 交互审批先走 autoApprove，PermissionCard 仅展示（不阻塞）。
Phase 2 升级为双向：引擎暂停 → 发 permission_request → 用户点按钮 → permission_reply → 引擎继续。

## 9. apps/desktop 文件结构

```
apps/desktop/
  package.json          vite + electron-builder + react 依赖（已选定，非 forge）
  vite.config.ts        三进程构建：main / preload / renderer（vite-plugin-electron）
  electron-builder.yml  打包配置：win NSIS / mac dmg / linux AppImage；Rust 二进制 extraResources + asarUnpack
  tsconfig.json         renderer（DOM lib）
  tsconfig.node.json    main + preload（node lib）
  src/
    main/
      index.ts          BrowserWindow + Tray 创建；import 并调用引擎
      engine-bridge.ts  直接调用 runHeadlessTask，onEvent 回调 → ipcMain.emit
      tray.ts           系统托盘（远程渠道通知入口）
      session-store.ts  会话元数据本地缓存（better-sqlite3 或 JSON file）
    preload/
      index.ts          contextBridge：暴露 onEngineEvent / sendCommand
    bridge/
      events.ts         EngineEvent / EngineCommand 类型（main + renderer 共用）
    renderer/
      index.html
      main.tsx          React 入口，ThemeProvider + AppShell
      styles/
        tokens.css      CSS 变量（暗色 / 亮色 @media prefers-color-scheme）
        reset.css
      components/
        layout/         AppTitleBar / AppShell / ResizeHandle / ThemeProvider
        sidebar/        ProjectSwitcher / SessionList / TaskSummaryList / ...
        thread/         TranscriptView / UserMessage / AssistantMessage / ...
                        ToolCallCard / PermissionCard / BackgroundTaskRow / ...
                        Composer / StreamingCursor / StatusBar
        review/         ReviewPanel / DiffView / GitActions
        settings/        SettingsModal / SettingsGeneral / SettingsModel
                         SettingsMcp(McpServerList / McpServerForm / McpToolWhitelist)
                         SettingsPermission
        shared/         Button / Badge / Spinner / Tooltip / Icon
      hooks/
        useEngineEvents.ts   订阅 IPC 事件流，dispatch 到 transcript state
        useTheme.ts          暗色/亮色 + 系统偏好同步
```

## 10. 工程分期

### Phase 1（Win 优先，可用里程碑）

目标：能在窗口里完整跑一次 agent 任务，看到对话流和工具执行。

任务清单：
1. **引擎接缝**：`packages/tui` 的 `RunHeadlessOptions` 新增 `onEvent` 回调（TranscriptEvent 旁路，30 行内）
2. **apps/desktop 脚手架**：electron-forge + vite + react + TS 初始配置
3. **主进程**：BrowserWindow / import runHeadlessTask / onEvent→IPC 桥（**无子进程、无 NDJSON 解析层**）
4. **Renderer 骨架**：ThemeProvider(暗/亮) + AppTitleBar(frameless) + 三栏布局 + ResizeHandle
5. **左栏 MVP**：SessionList（从 SessionStore 读会话列表）+ ProjectSwitcher
6. **中栏 MVP**：TranscriptView（UserMessage / AssistantMessage / ToolCallCard / BackgroundTaskRow）
   + Composer（发送消息 → import 调用引擎）+ StatusBar
7. **右栏 MVP**：DiffView（checkout_created 触发，`git diff` 输出解析）+ ReviewPanelEmpty 占位
8. **打包**：`electron-builder` 出 Windows NSIS 安装包；`.github/workflows/build-desktop.yml`。
   workspace 包进 `node_modules`；Rust 二进制用 `asarUnpack` + `extraResources`
   从 `apps/cli/bundled` 复到 `resources/bundled`；主进程启动设 `LINGHUN_CLI_BUNDLED_ROOT`。

Phase 1 **不做**：交互审批（autoApprove）/ 系统托盘 / macOS / artifacts 面板 / git push UI。

### Phase 2（差异化）

- 双向权限审批通道 → PermissionCard 真正阻塞 + 按钮响应
- 系统托盘：远程渠道（Feishu / DingTalk / Wecom）通知 → 点击拉起会话
- GitActions：stage / commit / push（封装 `linghun git` 命令）
- ArtifactList：artifact 预览（代码/图片/markdown）
- macOS dmg + Linux AppImage 打包
- 多会话并行 tab（对应 Codex Desktop 多 worktree）
- 完整亮色主题细化 + 主题手动切换 UI
- 设置面板 `SettingsModal`：通用 / 模型 / 权限三 tab（读写 config 包，UI 壳）
- MCP 配置 UI `SettingsMcp`：服务器增删改 + 连接状态 + 工具白名单
  （底座 mcp-*-runtime 复用，可见层只做配置界面）

### Phase 3（可选 · 稳定性）

- 崩溃隔离：把引擎从主进程移进 `worker_threads`，引擎异常不带崩窗口。
  Phase 1 主进程直接 import 已足够可用，此项仅在需要强隔离时做。

## 11. 你们的差异化（超出 Codex Desktop 的地方）

利用底座独有能力，Phase 2 起逐步开放：

| 特性 | Codex Desktop | Linghun Desktop |
|------|--------------|-----------------|
| 远程渠道（飞书/钉钉/企微） | ❌ | ✅ 托盘通知 + 会话入口 |
| Codebase Memory 图谱视图 | ❌ | ✅ 可视化代码图（review 面板扩展 tab） |
| Workflow 可视化 | ❌ | ✅ AgentProgressTree 迁移到 Web 渲染 |
| Pre-engine 分析结果面板 | ❌ | ✅ 侧栏 artifacts 区显示分析报告 |
| 多会话并行 tab | 有限 | ✅ 每 tab 独立 fork 进程 |
| 权限审计日志面板 | 弱 | ✅ 每次工具调用可追溯（bottom sheet） |
