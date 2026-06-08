import type { Language } from "@linghun/shared";

export type MessageKey =
  | "appTitle"
  | "intro"
  | "currentModel"
  | "unknownCommand"
  | "languageSwitchedZh"
  | "languageSwitchedEn"
  | "modeCurrent"
  | "modeOptions"
  | "modeBoundary"
  | "modeUnknown"
  | "modeSwitched"
  | "modePlanBoundary"
  | "startGateConfirmed"
  | "startGateExpired"
  | "startGateExactRequired"
  | "startGatePlainConfirmationRejected"
  | "exit"
  | "status"
  | "statusShort"
  | "help"
  | "inputPrompt"
  | "noSessions"
  | "sessionHeader"
  | "noSummary"
  | "checkpointCreated"
  | "checkpointNone"
  | "checkpointRestored"
  | "checkpointMissing"
  | "backgroundNone"
  | "backgroundEmptyOutput"
  | "backgroundRunning"
  | "interruptIdle"
  | "interruptCancelled"
  | "btwPrefix"
  | "evidenceBlocked"
  | "claimNeedsDisclaimer"
  | "projectRulesMissingHint"
  | "toolInterrupted";

export const messages: Record<Language, Record<MessageKey, string>> = {
  "zh-CN": {
    appTitle: "{name} TUI / REPL",
    intro: "输入普通消息开始对话；输入 /help 查看命令；输入 /exit 退出。",
    currentModel: "当前模型",
    unknownCommand: "未知命令",
    languageSwitchedZh: "语言已切换为中文。",
    languageSwitchedEn: "Language switched to English.",
    modeCurrent: "当前权限模式：{mode}",
    modeOptions: "可选：default / auto-review / plan / full-access",
    modeBoundary:
      "边界：切换模式不等于绕过硬拒绝；危险动作仍受权限底座约束。Plan 仍只读，auto-review 会自动放行安全只读动作和低风险工作区编辑；写入、非只读 Bash、安装、联网或权限变更仍会确认。",
    modeUnknown: "未知模式。可选：default / auto-review / plan / full-access",
    modeSwitched: "已切换权限模式：{mode}",
    modePlanBoundary:
      "Plan 模式只允许 Read / Grep / Glob / Diff / Todo 等只读或会话内操作。确认方案后仍不等于授权所有工具。",
    startGateConfirmed: "已确认，正在进入本地动作路径；后续受保护操作仍会单独审批。",
    startGateExpired: "确认已过期。请重新发起请求。",
    startGateExactRequired: "该动作需要输入精确 slash command 才能继续；这条输入未执行。",
    startGatePlainConfirmationRejected: "该动作需要精确确认；普通 yes/确认 未放行。",
    exit: "已退出 Linghun。",
    status:
      "状态栏：session {session} · model {model} · mode {mode} · bg {background} · cache {cache} · index {index} · gate {gate}",
    statusShort: "状态栏：{mode} · bg {background}",
    help: "帮助",
    inputPrompt: "你> ",
    noSessions: "当前项目还没有会话。",
    sessionHeader: "会话ID  更新时间  摘要",
    noSummary: "（无摘要）",
    checkpointCreated: "已创建 checkpoint",
    checkpointNone: "当前没有 checkpoint。",
    checkpointRestored: "已恢复 checkpoint",
    checkpointMissing: "未找到 checkpoint",
    backgroundNone: "当前没有后台任务。",
    backgroundEmptyOutput: "尚未产生有效输出",
    backgroundRunning: "仍在运行",
    interruptIdle: "当前没有正在运行的长任务；状态为 idle。",
    interruptCancelled: "已标记当前长任务为 cancelled。",
    btwPrefix: "临时插问",
    evidenceBlocked:
      "尚未确认，需要先检查。涉及代码事实的结论必须先通过 /read、/grep、索引查询或命令输出获得证据。",
    claimNeedsDisclaimer: "缺少证据，请补齐匹配证据或移除该声明。",
    projectRulesMissingHint:
      "[hint:info] 缺少 LINGHUN.md 项目规则；如需基础模板，可运行 /memory init。不会自动生成或打断输入。",
    toolInterrupted: "当前模型响应或工具调用已取消；可以继续输入。",
  },
  "en-US": {
    appTitle: "{name} TUI / REPL",
    intro: "Type a message to chat; use /help for commands; use /exit to quit.",
    currentModel: "Current model",
    unknownCommand: "Unknown command",
    languageSwitchedZh: "语言已切换为中文。",
    languageSwitchedEn: "Language switched to English.",
    modeCurrent: "Current permission mode: {mode}",
    modeOptions: "Options: default / auto-review / plan / full-access",
    modeBoundary:
      "Boundary: switching modes does not bypass hard denies; dangerous actions still go through the permission pipeline. Plan remains readonly; auto-review automatically allows safe readonly actions and low-risk workspace edits; writes, non-readonly Bash, installs, network, and permission changes still ask.",
    modeUnknown: "Unknown mode. Options: default / auto-review / plan / full-access",
    modeSwitched: "Permission mode switched: {mode}",
    modePlanBoundary:
      "Plan mode only allows Read / Grep / Glob / Diff / Todo and session-scoped actions. Accepting a plan still does not authorize every tool.",
    startGateConfirmed:
      "Confirmed; entering the local action path. Protected follow-up actions still require separate approval.",
    startGateExpired: "Confirmation expired. Reissue the request.",
    startGateExactRequired:
      "This action requires the exact slash command before it can continue. This input was not executed.",
    startGatePlainConfirmationRejected:
      "This action requires exact confirmation; plain yes/confirm was not accepted.",
    exit: "Exited Linghun.",
    status:
      "Status: session {session} · model {model} · mode {mode} · bg {background} · cache {cache} · index {index} · gate {gate}",
    statusShort: "Status: {mode} · bg {background}",
    help: "Help",
    inputPrompt: "you> ",
    noSessions: "No sessions for this project yet.",
    sessionHeader: "Session ID  Updated At  Summary",
    noSummary: "(no summary)",
    checkpointCreated: "Checkpoint created",
    checkpointNone: "No checkpoints yet.",
    checkpointRestored: "Checkpoint restored",
    checkpointMissing: "Checkpoint not found",
    backgroundNone: "No background tasks.",
    backgroundEmptyOutput: "no valid output yet",
    backgroundRunning: "still running",
    interruptIdle: "No long task is running; state is idle.",
    interruptCancelled: "Current long task marked as cancelled.",
    btwPrefix: "Temporary question",
    evidenceBlocked:
      "Not confirmed yet; evidence is required first. Use /read, /grep, index query, or command output before code-fact claims.",
    claimNeedsDisclaimer: "Evidence is missing; gather matching evidence or remove the claim.",
    projectRulesMissingHint:
      "[hint:info] LINGHUN.md project rules are missing. To create a basic template, run /memory init. I will not generate it automatically or interrupt input.",
    toolInterrupted: "The current model response or tool call was cancelled; input is ready again.",
  },
};
