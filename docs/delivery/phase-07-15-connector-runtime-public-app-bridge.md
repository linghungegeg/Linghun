# Phase 7.15 Connector Runtime / Public App Bridge

## 阶段目标

在 Phase 7.14 Capability Runtime 薄桥之上，补齐一个真实可用的外部连接闭环：Local HTTP Connector。开发者可以提供 manifest，本地 HTTP app 可以暴露 capabilities，用户可以通过 `/apps` 连接、诊断、断开，并通过 `/capabilities run` 执行已连接的 HTTP capability。

本阶段只做 Local HTTP Connector；`mcp`、`plugin`、`desktop_bridge`、`websocket` 继续保留为 transport 类型和 doctor 口径，不声明真实连接完成。

## 已完成功能

- 新增 `packages/tui/src/connector-runtime.ts`：
  - `AppConnectorManifest`
  - `AppConnectorState`
  - `AppConnectorAuthConfig`
  - `AppConnectorConnectionResult`
  - `AppConnectorDoctorResult`
- `/apps` 命令：
  - `/apps connect <manifestPath>`
  - `/apps validate <manifestPath>`
  - `/apps test-run <manifestPath> <capabilityId> <json>`
  - `/apps list`
  - `/apps doctor`
  - `/apps disconnect <appId>`
- Local HTTP handshake：
  - `GET <baseUrl>/linghun/capabilities`
  - 只接受 loopback `http://localhost`、`127.0.0.1`、`[::1]`
  - 不做后台扫描，不读取用户无关目录
- HTTP execute provider：
  - `POST <baseUrl>/linghun/execute`
  - request body 只包含 `capabilityId`、`input` 和 request metadata
  - 返回归一为 `CapabilityExecutionResult`
- Capability Runtime 最小扩展：
  - 外部 capability/provider 注册
  - 按 appId 注销 capability
  - HTTP connector 连接状态解析
  - 仍复用统一 `executeCapability()`、`decidePermission()`、evidence 和 budget 边界
- Auth MVP：
  - `none`
  - `api_key`
  - `local_token`
  - shell env 优先，随后是 `settings.*` project/user config ref
  - doctor 只显示 auth source，不显示 raw value
- 大输出 budget：
  - HTTP execute response 中过大的 `output` / `result` / `data` 会进入 artifact/ref
  - transcript 不出现 30KB raw payload
- Policy / sanitizer：
  - app bridge / connector / 连接应用纳入 capability route
  - workflow/job/agent 仍优先，不被 capability route 抢走
  - 主屏 sanitizer 覆盖 `AppConnectorManifest`、`AppConnectorState`、raw connector response/payload/request
- 开发者文档：
  - `docs/developers/capability-runtime-app-bridge.md`
  - `docs/developers/capability-runtime-app-bridge.en.md`
- 开源接入物料：
  - `APP_BRIDGE_MANIFEST.schema.json`
  - `app-bridge-examples/node-demo`
  - `app-bridge-examples/python-demo`

## 使用方式

Manifest 示例：

```json
{
  "appId": "demo.drawing",
  "name": "Demo Drawing",
  "version": "0.1.0",
  "transport": "http",
  "baseUrl": "http://127.0.0.1:47831",
  "auth": { "type": "none" },
  "capabilities": [
    {
      "id": "demo.drawing.describe",
      "appId": "demo.drawing",
      "title": "Describe Drawing",
      "description": "Describes a local drawing.",
      "category": "drawing",
      "intents": ["describe drawing"],
      "keywords": ["drawing", "describe"],
      "transport": "http",
      "auth": "none",
      "permission": "read",
      "riskLevel": "low",
      "inputSchema": { "type": "object", "required": ["subject"] },
      "outputSchema": { "type": "object", "required": ["summary"] },
      "supportsRollback": false,
      "supportsPreview": false
    }
  ]
}
```

命令：

```text
/apps connect .\demo-connector.json
/apps validate .\demo-connector.json
/apps test-run .\demo-connector.json demo.drawing.describe {"subject":"circle"}
/apps list
/apps doctor
/capabilities run demo.drawing.describe {"subject":"circle"}
/apps disconnect demo.drawing
```

连接成功输出：

```text
已连接 Demo Drawing；注册 capability 1 个；写入/外部 app 操作会走权限确认。
```

## 涉及模块

- `packages/tui/src/connector-runtime.ts`
- `packages/tui/src/connector-runtime.test.ts`
- `packages/tui/src/capability-runtime.ts`
- `packages/tui/src/capability-runtime.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/model-prompt-runtime.test.ts`
- `docs/developers/capability-runtime-app-bridge.md`
- `docs/developers/capability-runtime-app-bridge.en.md`
- `APP_BRIDGE_MANIFEST.schema.json`
- `app-bridge-examples/node-demo/*`
- `app-bridge-examples/python-demo/*`
- `docs/delivery/README.md`

## 关键设计

- Connector Runtime 只负责 manifest、连接状态、HTTP discovery/execute provider，不新增第二套 scheduler。
- Capability Runtime 仍是唯一执行入口；connector 不能绕过 permission，也不能直接写 evidence。
- HTTP connector state 按 `context.projectPath` 保存在运行期内存中，本阶段不做持久化、不做自动重连、不做后台扫描。
- manifest capabilities 与远端 capabilities 按 id 合并；远端同 id metadata 覆盖 manifest metadata。
- Auth raw value 不写入 `AppConnectorState`；执行时按 env/ref 重新解析。
- Capability execution 不等于 verification PASS；evidence tags 保留 `not_verification_pass`。

## Phase 7.15.1 Hotfix

本次 hotfix 修复两个闭环问题：

- 失败口径：`executeCapability()` 根据 provider result 区分 `capability succeeded id=...` 与 `capability failed id=...`。失败 capability 不再写 `capability completed id=...`，system event severity 使用 `warning`，evidence summary 也写 `capability failed ...`。
- Claims：成功 evidence 增加 `capability_success`，失败 evidence 增加 `capability_failure`；两者都保留 `capability_execution`、capability id、permission、transport 和 `not_verification_pass`，不写 `verification_passed`。
- 项目隔离：HTTP connector capability 注册时绑定当前 `context.projectPath`；`listCapabilities(context)`、`findCapability(id, context)`、`formatCapabilityDoctor(..., context)` 和 `/capabilities run` 只看到当前项目可用的 HTTP capability。内置 mock capabilities 仍是全局可见。
- 断开连接：`/apps disconnect <appId>` 只删除当前项目对应 app 的 HTTP capabilities，不影响其他项目。
- 非当前项目缺失 connector 时，不显示 connected，不写成功 evidence。

## 配置项

Auth ref 示例：

```json
{
  "auth": {
    "type": "api_key",
    "env": "LINGHUN_DEMO_DRAWING_KEY"
  }
}
```

```powershell
$env:LINGHUN_DEMO_DRAWING_KEY = "dev-local-token"
```

支持来源：

- `shell-env`
- `project-config-ref`
- `user-config-ref`
- `manifest-ref`
- `none`
- `missing`

`/apps doctor` 只展示 `authSource`，不展示 secret value。

## 命令

- `/apps list`
- `/apps validate <manifestPath>`
- `/apps connect <manifestPath>`
- `/apps test-run <manifestPath> <capabilityId> <json>`
- `/apps doctor`
- `/apps disconnect <appId>`
- `/capabilities run <capabilityId> <json>`

## 测试与验证

已运行：

```powershell
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm exec vitest run packages/tui/src/connector-runtime.test.ts packages/tui/src/capability-runtime.test.ts packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/model-prompt-runtime.test.ts --no-color
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "apps|connector|capability|Capability|App Bridge|external app|http connector|auth|api_key|permission|evidence|artifact|rollback|Policy|Strategy|策略" --no-color
corepack pnpm exec biome check packages/tui/src/connector-runtime.ts packages/tui/src/connector-runtime.test.ts packages/tui/src/capability-runtime.ts packages/tui/src/capability-runtime.test.ts packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/model-prompt-runtime.ts packages/tui/src/index.ts packages/tui/src/index.test.ts packages/tui/src/tui-context-runtime.ts
corepack pnpm --filter @linghun/tui build
corepack pnpm --filter @linghun/cli build
node F:\Linghun\apps\cli\dist\main.js --version
node F:\Linghun\apps\cli\dist\main.js --help
git diff --check
```

结果：

- typecheck PASS
- focused runtime tests PASS：4 files / 71 tests
- focused index tests PASS：109 selected / 545 skipped
- biome check PASS
- `@linghun/tui` build PASS
- `@linghun/cli` build PASS
- CLI `--version` PASS：`0.1.0`
- CLI `--help` PASS
- `git diff --check` PASS

## 性能结果

- 连接按用户命令触发，只做一次 `GET /linghun/capabilities` handshake。
- HTTP 请求 timeout 为 5 秒。
- 不做后台扫描，不常驻轮询，不启动额外 scheduler。
- 大输出进入 `.linghun/session/tool-results/<sessionId>/...` artifact/ref，避免 transcript 膨胀。

## 已知问题

- 本阶段 connector state 是 runtime 内存状态，未做跨会话持久化。
- 本阶段不支持手动输入 token。
- `projectConfigRef` / `userConfigRef` 当前按 `settings.*` 路径读取运行时 config；没有新增独立 connector config 文件。
- `POST /linghun/state` 与 `POST /linghun/rollback` 仍是可选协议，当前 runtime 不主动调用。

## 不在本阶段处理的内容

- 不做 Computer Use。
- 不做桌面端 UI。
- 不做应用市场。
- 不做后台常驻扫描。
- 不做真实 MCP 自动导入。
- 不做真实 plugin loader 改造。
- 不做真实 websocket / desktop bridge 执行。
- 不做每个软件专属适配。
- 不做第二套 scheduler。
- 不声明 Beta PASS、smoke-ready、open-source-ready。

## 下一阶段衔接

下一阶段若继续 app bridge，应优先裁决：

- 是否持久化 app connector state。
- 是否加入 `/linghun/state` 只读状态接口。
- 是否加入 rollback ref 的用户可见操作路径。
- 是否扩展到 websocket 或 desktop bridge。

不得在没有新阶段确认时自动进入 Phase 7.16。

## 开发者排查入口

- connector lifecycle：`packages/tui/src/connector-runtime.ts`
- capability execution：`packages/tui/src/capability-runtime.ts`
- slash dispatch：`packages/tui/src/index.ts`
- policy route：`packages/tui/src/meta-scheduler-runtime.ts`
- sanitizer：`packages/tui/src/model-prompt-runtime.ts`
- developer guide：`docs/developers/capability-runtime-app-bridge.md`

## Source-Level Reality Check

实际读取并遵守：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-13-user-state-routing-policy-kernel.md`
- `docs/delivery/phase-07-14-capability-runtime-app-bridge-mvp.md`
- `packages/tui/src/capability-runtime.ts`
- `packages/tui/src/capability-runtime.test.ts`
- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/command-panel-runtime.ts`
- `packages/tui/src/evidence-runtime.ts`
- `packages/tui/src/tool-result-budget.ts`
- `packages/tui/src/index.test.ts`

codebase-memory 工具本轮未暴露；已按规则降级为 `rg` + 源码精读，未触发 refresh/rebuild。

## 参考核对

- 本阶段实际读取了上述 Linghun 文档和源码。
- 本阶段未复制 CCB / CCB Dev Boost 源码、内部 API、专有遥测或反编译痕迹。
- 行为参考仅限阶段文档中已固化的边界：权限先行、主屏降噪、details 分层、artifact/ref、大输出不进 transcript、capability execution 不等于 PASS。
- 进入 Linghun 的实现为自研 Local HTTP Connector MVP。

## 成品级结构化 handoff packet

- phase: `Phase 7.15 Connector Runtime / Public App Bridge`
- status: `complete; focused/local validation passing`
- nextPhase: `等待用户确认；不得自动进入 Phase 7.16`
- completed:
  - Local HTTP manifest loader / validator
  - `/apps list/connect/doctor/disconnect`
  - HTTP `GET /linghun/capabilities`
  - HTTP `POST /linghun/execute`
  - auth env/ref source-only doctor
  - permission/evidence/budget/sanitizer boundaries
  - developer guide
- mustNotDo:
  - 不触碰禁止文件
  - 不新增第二套 scheduler / permission / evidence / verification runtime
  - 不把 MCP/plugin/desktop bridge 写成已真连接
  - 不声明 Beta PASS / smoke-ready / open-source-ready
- evidence:
  - `packages/tui/src/connector-runtime.ts`
  - `packages/tui/src/connector-runtime.test.ts`
  - `docs/developers/capability-runtime-app-bridge.md`
  - `docs/delivery/phase-07-15-connector-runtime-public-app-bridge.md`
- validation:
  - typecheck PASS
  - focused runtime tests PASS
  - focused index tests PASS
  - biome check PASS
  - TUI build PASS
  - CLI build PASS
  - CLI version/help PASS
  - git diff --check PASS
- indexStatus: `codebase-memory unavailable in this thread; no refresh/rebuild`
- permissionMode: `local repo edit; no stage; no commit`
- providerModel: `未修改 provider/model/key/env route`
- budgetUsage: `未新增 provider/model token 消耗`
