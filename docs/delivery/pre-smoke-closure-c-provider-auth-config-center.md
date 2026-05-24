# Pre-Smoke Closure C - Provider/Auth Config Center

## 状态声明

- 本轮目标：让新用户不需要手写复杂 `providers` / `modelRoutes` JSON，也不需要先理解高级 provider route，能通过 `/model setup` 或首次运行提示完成 OpenAI-compatible provider 配置。
- 本轮只做 provider/auth config center 的本地配置、诊断、文档和 focused/local validation；不做真实 provider smoke、发布、Phase 18、桌面端或开源包装。
- 本轮未执行真实项目 smoke。
- 本轮不是 Beta PASS / smoke-ready / open-source-ready。
- 本轮未进入 Phase 18 / 桌面端 / 开源发布。
- 本轮未提交 commit。
- 本轮未调用 live provider/API，未使用真实 key。
- 本轮未新增第二套 provider runtime、config runtime、doctor、permission、tool、evidence、job、MCP 或 agent 系统。
- 本轮未改变四权限模式、Start Gate、permission pipeline、Plan approval 或 PASS evidence 语义。
- 本轮未复制 CCB / Claude Code / OpenCode / 第三方源码；只参考公开/本地行为边界。
- 本轮未实现 keychain、vault 或加密 secret 系统；Closure C 只使用本机用户私有 `provider.env` 与既有 env 优先级。

## Source-Level Reality Check 摘要

### 索引状态

- 开工前按要求运行 `git status --short`；当时已有 `README.md`、`START_NEXT_CHAT.md` 修改，后续未回滚这些既有改动。
- codebase-memory 首次以 `project_name=F-Linghun` 查询失败，随后确认项目名为 `F-Linghun` 并继续用源码事实交叉确认。
- 当前复查索引状态：`project=F-Linghun`，`status=ready`，`nodes=1940`，`edges=4137`。

索引只用于缩小定位范围；最终结论以源码、测试和验证命令为准。

### Existing implementation

- Linghun 已有 `packages/config/src/index.ts` 配置中心：
  - 项目配置：`<project>/.linghun/settings.json`。
  - 用户配置目录：默认 `~/.linghun`，可由 `LINGHUN_CONFIG_DIR` 覆盖。
  - `loadConfig()` 合并默认配置、项目 settings 和 env override。
  - `writeConfig()` 原本已避免把 provider `apiKey` 写回项目 settings。
- Linghun 已有 provider/runtime：
  - `packages/providers/src/index.ts` 已有 OpenAI-compatible / DeepSeek provider、endpoint profile、reasoning/includeUsage/tool schema diagnostics。
  - `/model doctor` / `/model route doctor` 已有 runtime contract、role route、capability、baseUrl suffix/query/fragment 诊断。
- Linghun 已有 slash router/TUI input loop：
  - `/model` 统一走 `handleModelCommand()`。
  - TUI 已有 local command routing、Start Gate、permission pipeline、model/tool loop、doctor/status/help 分层。
- 已有 key 脱敏事实：
  - `/model doctor` 只显示 masked preview。
  - project settings 中 legacy `apiKey` 可读取但 settings write 会剥离。

### CCB reference facts

本轮按要求只读参考了 `F:\ccb-source` provider/auth/env/settings/login/env command 相关文件，由参考审查整理行为事实：

- CCB 使用全局 config home，支持 env override 的 config home。
- CCB settings/env 路径分层，env key 优先于 settings key。
- CCB workspace key / login flow 会在 prompt 后保存，显示时只给 masked preview。
- CCB OpenAI-compatible setup 表单以 Base URL / API Key / model aliases 为用户入口。
- CCB `/env` 展示允许列表与 secret pattern masking。
- 这些只作为行为参考；Closure C 没有复制 CCB 源码、内部 API、专有实现或反编译痕迹。

### Gaps

- 新用户此前需要理解 `providers` / `modelRoutes` 或手写项目 settings 才能配置 OpenAI-compatible provider。
- 缺少用户私有、非项目目录的 provider env 文件。
- 缺少 `/model setup` 轻量交互路径。
- 缺少 provider.env broken file 的可操作提示。
- `/model doctor` 尚不能区分 `env` / `user-provider-env` / `project-settings-legacy` / `missing` 来源。
- README / START / delivery index 未说明 Closure C 后的 provider setup 安全边界。

### Minimal touch points

- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `apps/cli/src/cli.ts`
- `apps/cli/src/main.test.ts`
- `.gitignore`
- `.env.example`
- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `docs/delivery/pre-smoke-closure-c-provider-auth-config-center.md`

### Forbidden duplicate systems

本轮没有新增第二套：

- provider runtime / model gateway / role route system
- config center / settings schema / permission system
- Start Gate / Plan approval / evidence store / verification runner
- tool runtime / MCP runtime / job runtime / agent runtime
- keychain / vault / encrypted secret store
- doctor / status / help / slash router

## Closure C 裁决总表

| Item | 裁决 | 处理说明 |
| --- | --- | --- |
| 私有 provider.env | DONE | 新增 `~/.linghun/provider.env` / `$LINGHUN_CONFIG_DIR/provider.env` 路径、模板、parser、atomic temp + rename write。 |
| env 优先级 | DONE | shell env 最高，其次 provider.env，再是项目 settings/default；project settings legacy key 仍可读但不鼓励。 |
| `/model setup` | DONE | 复用既有 slash router/TUI input，收集 API 地址、API key、模型名、推理等级和可选辅助模型。 |
| 首次运行提示 | DONE | selected provider 缺 key/baseUrl/model 时给轻量 `/model setup` 提示；TTY 下确保 provider.env 模板存在并显示路径；不自动进入 setup，不抢占 trust/language 首次交互。 |
| 输入校验 | DONE | baseUrl 要求 http/https root baseUrl，拒绝 `/chat/completions`、`/responses`、query、fragment；API key 检查空值、换行、首尾空格、首尾引号；model trim only；reasoning Low/Medium/High，默认 Medium。 |
| key mask / no leak | DONE | setup summary 只显示 present/missing；doctor masked；测试覆盖输出不含 key。 |
| `/model doctor` source | DONE | 显示 `env` / `user-provider-env` / `project-settings-legacy` / `missing`，并 warning legacy project settings apiKey。 |
| role route light tip | DONE | setup 保存后提示可选角色路由，不强制用户理解或配置。 |
| `.env.example` | DONE | 新增 tracked template，不包含真实 key。 |
| `.gitignore` secret guard | DONE | 忽略 `.env`、`.env.local`、`.env.*.local`、`provider.env`、`.linghun/provider.env`。 |
| keychain/vault/encryption | NOT-DO | 用户明确禁止新增复杂 keychain/vault/encrypted secret 系统；本轮不做。 |
| real provider smoke | DEFERRED | 仍需用户确认后单独进入；Closure C 不跑 live provider/API。 |
| Phase 18 / open-source packaging | NOT-DO | 不进入桌面端、发布或开源包装。 |

## 实现内容

### A. Config provider.env layer

- 新增 `ProviderEnvSetup` / `ProviderEnvWarning`。
- 新增 `providerEnvTemplate`、`getProviderEnvPath()`、`providerEnvExists()`、`ensureProviderEnvTemplate()`、`saveProviderEnvSetup()`、`readProviderEnvValues()`。
- provider.env parser 支持注释、空行和 `KEY=VALUE`，仅识别 Linghun provider keys，broken line 或未闭合引号给出可操作错误。
- `saveProviderEnvSetup()` 使用 temp file + rename 原子写入。
- `loadConfig()` 新增 provider.env merge layer：shell env 仍覆盖 provider.env；provider.env 覆盖 project settings/default。
- `writeConfig()` 继续不写 provider `apiKey` 到项目 `.linghun/settings.json`。

### B. `/model setup` TUI flow

- `/model setup` 进入轻量配置向导。
- 必填：API 地址、API key、模型名称、推理等级。
- 可选：辅助模型；直接回车则只保存为空，当前不声明自动角色路由收益。
- setup 过程中只做校验，确认前不保存 API key。
- 确认页只显示：
  - `provider=openai-compatible`
  - `baseUrl=present`
  - `apiKey=present`
  - `model=<name>`
  - `reasoningLevel=<level>`
  - write location
- `yes` 保存，`no` / `cancel` 取消，`details` 显示安全说明。
- 保存后提示重启、可再次运行 `/model setup`、可运行 `/model doctor` 检查，并给角色路由轻提示；`LINGHUN_AUX_MODEL` 仅作为可选保存/提示字段，不在 Closure C 声明自动角色路由收益。
- TTY API key 输入增加 best-effort masking；非 TTY 测试路径不回显 key。

### C. First-run / doctor behavior

- 启动时若 selected provider 缺 key/baseUrl/model，输出轻量人话提示：`检测到还没有完成模型配置。输入 /model setup 填写 API 地址、API key、模型名称和推理等级。`；TTY 下确保 provider.env 模板存在并展示路径，不进入交互式 setup，不阻塞已有 trust/language 首次交互。
- provider.env 读取失败时输出可操作提示：修正文件、重启 Linghun 或运行 `/model setup`。
- `/model doctor` 显示 provider.env 读取 warning、apiKey source、masked key 和 legacy project settings warning。
- Headless `linghun model doctor` / `linghun /model doctor` 同步显示当前 provider 的 `env` / `user-provider-env` / `project-settings-legacy` / `missing` 来源标签，避免旧 deepseek-only 诊断误报。
- CLI help 已暴露 `TUI /model setup`，帮助新用户发现交互式配置入口。

### D. Docs and safety files

- `.gitignore` 增加常见 env/provider.env ignore。
- `.env.example` 提供无真实 key 的 provider env 模板。
- README 增加“模型配置”小节，说明 `/model setup`、provider.env 路径、env 优先级、`/model doctor` key source。
- `START_NEXT_CHAT.md` 更新 Closure C 状态和下一步仍需用户确认真实 smoke。
- `docs/delivery/README.md` 增加 Closure C 记录。

## 修改文件清单

### Code

- `packages/config/src/index.ts`
  - provider.env path/template/read/write/parser/validation/warning。
  - `loadConfig()` merge provider.env layer。
  - shell env > provider.env > project settings/default。
- `packages/tui/src/index.ts`
  - `/model setup` interactive flow。
  - first-run missing model config hint/template creation。
  - `/model doctor` apiKey source and provider.env warning。
  - API key TTY masking best-effort。
- `apps/cli/src/cli.ts`
  - headless `linghun model doctor` / `linghun /model doctor` 解析当前 provider。
  - headless doctor 输出 `env` / `user-provider-env` / `project-settings-legacy` / `missing` key source，避免旧 deepseek-only 误报。

### Tests

- `packages/config/src/index.test.ts`
  - provider.env precedence, shell env override, no project settings key write。
  - template creation and atomic save path。
  - quote-prefixed/suffixed API key rejection。
  - broken provider.env warning and fallback。
- `packages/tui/src/index.test.ts`
  - `/model setup` writes provider.env and does not leak API key to output/project settings。
  - `/model doctor` shows `user-provider-env` source and masks key。
- `apps/cli/src/main.test.ts`
  - headless doctor legacy project settings key source uses `project-settings-legacy`。
  - headless doctor OpenAI-compatible provider.env key source uses `user-provider-env`。

### Docs / safety

- `.gitignore`
- `.env.example`
- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `docs/delivery/pre-smoke-closure-c-provider-auth-config-center.md`

## 验证命令结果

| command | result |
| --- | --- |
| `git status --short` | PASS：已查看工作树；存在本轮文件和预先存在/非本轮 untracked 文件，未提交 commit。 |
| `corepack pnpm exec vitest run packages/config/src/index.test.ts packages/tui/src/index.test.ts packages/providers/src/index.test.ts` | PASS：3 files passed；242 tests passed。 |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts` | PASS：1 file passed；175 tests passed。 |
| `corepack pnpm exec vitest run apps/cli/src/main.test.ts packages/config/src/index.test.ts` | PASS：2 files passed；38 tests passed。覆盖 verifier fail 修复点。 |
| `corepack pnpm exec vitest run apps/cli/src/main.test.ts packages/config/src/index.test.ts packages/tui/src/index.test.ts packages/providers/src/index.test.ts` | PASS：4 files passed；251 tests passed。 |
| Closure C 小收口自检（用户要求停止独立复检）：`corepack pnpm exec vitest run apps/cli/src/main.test.ts packages/tui/src/index.test.ts` | PASS：2 files passed；184 tests passed。覆盖 CLI help `/model setup` 发现性和首次缺配置轻量提示；该结果是 main-agent self-review，不是独立 verifier PASS。 |
| `corepack pnpm test` | PASS：19 files passed、2 skipped；474 passed、2 skipped。 |
| 用户要求停止第二轮独立 verification 后的自检：`corepack pnpm exec vitest run apps/cli/src/main.test.ts packages/config/src/index.test.ts packages/tui/src/index.test.ts packages/providers/src/index.test.ts` | PASS：4 files passed；251 tests passed。该结果是 main-agent self-review，不是独立 verifier PASS。 |
| `corepack pnpm typecheck` | PASS；用户要求停止第二轮独立 verification 后再次自检 PASS。 |
| `corepack pnpm check` | PASS：Biome checked 69 files。首次发现格式差异，已按 formatter 最小修正后复跑通过；verifier fix 后复跑通过。 |
| `corepack pnpm build` | PASS：workspace packages build completed。 |
| `git diff --check` | PASS：无 whitespace error；仅提示 `.gitignore` LF/CRLF 工作区 warning。 |

### 修复过的验证失败

- 首次 focused run 发现 `packages/config/src/index.ts` 中 API key quote 检查正则存在无效 escape；已改为合法正则并复跑通过。
- 第二次 focused run 中 config/provider 已通过，TUI 因 startup hint 在 TTY first-run 测试中自动进入 setup 导致 5 个 timeout；已改为首次运行只确保 provider.env 模板存在并提示 `/model setup`，不抢占既有 trust/language 首次交互，复跑通过。
- `corepack pnpm check` 首次发现格式差异；已按 Biome 最小格式修正后复跑通过。
- 独立 verifier 首轮返回 FAIL：`/model setup` 曾允许 quote-prefixed API key 保存成无法解析的 provider.env；已改为拒绝任意首尾单/双引号，并新增 config regression。
- 独立 verifier 首轮返回 FAIL：headless `linghun model doctor` / `linghun /model doctor` 仍是旧 deepseek-only 诊断；已改为解析当前 provider，并新增 headless OpenAI-compatible provider.env / legacy project settings source regression。

## Slice C 用户级自然语言配置入口补充（2026-05-24）

- Pre-Smoke Ink TUI Product Shell Gate / Slice C 在 Closure C provider.env 基础上补齐首屏入口：setup-needed 明确是本机用户级 provider setup，不是当前仓库配置。
- provider setup 继续复用既有 `getProviderEnvPath()`、`saveProviderEnvSetup()` 和 `loadConfig()` provider.env layer；没有新增第二套 provider config writer 或 resolver。
- 默认写入 `~/.linghun/provider.env`；设置 `LINGHUN_CONFIG_DIR` 时写入 `$LINGHUN_CONFIG_DIR/provider.env`；保存一次后其他仓库默认复用同一个用户 provider.env。
- 新仓库若能从用户 provider.env 得到有效 `baseUrl`、`apiKey`、`model` 且不是 placeholder model，不再显示 setup-needed。
- Slice C boundary fix：项目 executor route 指向 `openai-compatible` 但用户级 provider 必需项尚未配置时，优先显示 user-scoped setup-needed；只有 missing provider、无效 concrete model、用户 provider 已有效但项目 route 仍错误、或 legacy project settings 明确造成 route/model override 时，才提示 project-scoped route/settings 问题。
- 如果问题来自项目 executor route / legacy `.linghun/settings.json` override，则提示 project-scoped route/settings 问题，不引导用户重复填写用户 API key。
- 自然语言“我要配置模型 / 配置 API key / setup model / configure provider”和 setup-needed 上按 Enter 会进入既有模型配置向导；`/model setup` 仍是高级/恢复入口。
- 直接输入 URL、`model=xxx` / `model xxx` / `模型 xxx`、`reasoning Low|Medium|High` / `推理 低|中|高` 和 key 时，只预填 pending setup 内存；摘要先显示 present/missing 和 model/reasoning，不输出 raw key，确认 `yes/save/确认` 后才保存。
- 本补充未执行真实 provider/API smoke，未使用真实 key，未把 key 写入 docs/reports/logs/transcript/evidence，也未把真实 `apiKey` 写入项目 `.linghun/settings.json`。

## 剩余风险和 real smoke watchlist

- 本轮未执行 live provider/API；真实 provider 的 baseUrl/model/tool calling/reasoning/includeUsage 行为仍需用户确认后进入 Real Provider + Real Project Smoke。
- provider.env 是本机明文私有文件，不是 keychain/vault/encrypted secret；这是本轮明确边界。
- TTY API key masking 是 best-effort；真实终端需 smoke 观察不同 shell/terminal 组合下的输入回显。
- `/model setup` 当前只配置 OpenAI-compatible 主 provider；高级 role route 仍通过既有 `/model route` 能力完成。
- provider.env parser 是轻量 env format，不是完整 shell parser；复杂 shell expansion 不在本阶段处理。
- `LINGHUN_AUX_MODEL` 已保存为可选字段，但当前 role routes 默认仍跟随主模型；高级路由由后续显式 `/model route` 设置。

## 参考核对

### Linghun 文档

本轮实际读取并遵守：

- `START_NEXT_CHAT.md`
- `README.md`
- `docs/audit/pre-smoke-terminal-product-ultimate-audit.md`
- `docs/delivery/pre-smoke-closure-a-p1-engineering-risk.md`
- `docs/delivery/pre-smoke-closure-b-p2-product-truthfulness.md`
- `docs/delivery/phase-15-5e-provider-freshness.md`
- `docs/delivery/README.md`
- `CLAUDE.md` / 项目规则中阶段开发、Source-Level Reality Check、最小改动和安全边界要求

### Linghun 源码

本轮实际读取或修改：

- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/providers/src/index.ts`
- `packages/providers/src/index.test.ts`
- `apps/cli/src/cli.ts`
- `apps/cli/src/main.test.ts`

### CCB / reference sources

本轮按要求只读参考：

- `F:\ccb-source\src\utils\env.ts`
- `F:\ccb-source\src\utils\envUtils.ts`
- `F:\ccb-source\src\utils\config.ts`
- `F:\ccb-source\src\utils\settings\settings.ts`
- `F:\ccb-source\src\utils\settings\types.ts`
- `F:\ccb-source\src\commands\login\login.tsx`
- `F:\ccb-source\src\commands\login\WorkspaceKeyInput.tsx`
- `F:\ccb-source\src\commands\login\getAuthStatus.ts`
- `F:\ccb-source\src\commands\env\index.ts`
- `F:\ccb-source\src\services\auth\saveWorkspaceKey.ts`
- `F:\ccb-source\src\components\ConsoleOAuthFlow.tsx`

参考内容只进入 Linghun 自研行为边界：config home、env priority、masked display、prompt-after-save、OpenAI-compatible form、`/env` secret masking。未复制可疑源码实现、内部 API、专有遥测或服务逻辑。

## Handoff Packet

| 字段 | 内容 |
| --- | --- |
| 下一阶段 | 用户确认后才可进入 Real Provider + Real Project Smoke；不得自动进入。 |
| 禁止事项 | 不提交 commit；不进入真实 smoke；不宣布 Beta PASS / smoke-ready / open-source-ready；不进入 Phase 18 / open-source packaging；不写真实 key 到 docs/reports/logs/project settings；不保存 raw provider request/full response/full logs；不新增第二套系统。 |
| 证据引用 | 本报告；focused/full tests；README / START / delivery README 更新；provider.env config/TUI/headless CLI tests。 |
| 验证结果 | Focused config/TUI/provider/CLI tests PASS；full test PASS；typecheck PASS；check PASS；build PASS；git diff --check PASS。 |
| 索引状态 | `F-Linghun` ready；nodes=1940，edges=4137。 |
| 权限模式 | 未改变四权限模式、Start Gate、permission pipeline 或 Plan approval 语义。 |
| provider/model | 未调用 live provider；测试使用 fake/test key 字符串，未使用真实 key。 |
| 预算使用 | 本轮只做本地源码、测试、文档；无 live API 成本。 |
