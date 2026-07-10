import type { Language } from "@linghun/shared";

export type RequestActivityPhase =
  | "request_started"
  | "request_started_report"
  | "waiting_first_delta"
  | "compacting_context"
  | "tool_running"
  | "continuing_after_tool"
  | "permission_waiting"
  | "checking_final_evidence"
  | "collecting_final_evidence"
  | "rewriting_final_answer"
  | "verifying_final_answer"
  | "provider_retrying"
  | "provider_recovering"
  | "provider_switching";

export type WorkRequestPhase =
  | "idle"
  | "queued"
  | "understanding"
  | "planning"
  | "model_streaming"
  | "tool_calling"
  | "tool_running"
  | "permission_waiting"
  | "verification_running"
  | "provider_recovering"
  | "background_running"
  | "agent_running"
  | "blocked"
  | "failed"
  | "completed";

export type WorkRequestSource =
  | "model"
  | "tool"
  | "permission"
  | "runner"
  | "verification"
  | "agent"
  | "background"
  | "provider";

export type WorkRequestProgress = {
  completed: number;
  total: number;
  label?: string;
};

export type WorkRequestState = {
  phase: WorkRequestPhase;
  title: string;
  summary?: string;
  nextAction?: string;
  elapsedMs?: number;
  progress?: WorkRequestProgress;
  source: WorkRequestSource;
  detailsRef?: string;
};

export type WorkRequestProjectionInput = {
  language: Language;
  requestPhase?: string;
  startedAtMs?: number;
  nowMs?: number;
  reportPath?: string;
  toolName?: string;
  toolTarget?: string;
  retryAttempt?: number;
  retryMax?: number;
  retryDelaySec?: number;
  permissionToolName?: string;
  permissionSummary?: string;
  permissionNextAction?: string;
  agentsRunning?: number;
  workflowRunning?: boolean;
  multiAgentWorkflowRunning?: boolean;
  backgroundTasksRunning?: number;
  includeBackgroundRunning?: boolean;
  detailsRef?: string;
};

export function projectWorkRequestState(
  input: WorkRequestProjectionInput,
): WorkRequestState | undefined {
  const isEn = input.language === "en-US";
  const elapsedMs = computeElapsedMs(input.startedAtMs, input.nowMs);
  const withCommon = (state: Omit<WorkRequestState, "elapsedMs" | "detailsRef">): WorkRequestState => ({
    ...state,
    ...(elapsedMs === undefined || isTerminalWorkRequestPhase(state.phase) ? {} : { elapsedMs }),
    ...(input.detailsRef ? { detailsRef: input.detailsRef } : {}),
  });

  const permissionToolName = normalizeOptionalText(input.permissionToolName);
  if (permissionToolName) {
    return withCommon({
      phase: "permission_waiting",
      source: "permission",
      title: isEn ? `Waiting for approval · ${permissionToolName}` : `等待确认 · ${permissionToolName}`,
      summary: input.permissionSummary,
      nextAction:
        input.permissionNextAction ??
        (isEn ? "Confirm, inspect details, or cancel." : "确认、查看详情或取消。"),
    });
  }

  const phase = input.requestPhase;
  if (phase) {
    const activityState = projectActivityPhaseToWorkRequestState(input, phase, isEn);
    if (activityState) return withCommon(activityState);
  }

  const agentsRunning = input.agentsRunning ?? 0;
  if (agentsRunning > 0) {
    return withCommon({
      phase: "agent_running",
      source: "agent",
      title: isEn
        ? agentsRunning === 1
          ? "Agent running"
          : `${agentsRunning} agents running`
        : agentsRunning === 1
          ? "智能体运行中"
          : `${agentsRunning} 个智能体运行中`,
      nextAction: isEn ? "Use /agents for details." : "可用 /agents 查看详情。",
    });
  }

  if (input.workflowRunning || input.multiAgentWorkflowRunning) {
    return withCommon({
      phase: "agent_running",
      source: "agent",
      title: input.multiAgentWorkflowRunning
        ? isEn
          ? "Multi-agent workflow running"
          : "多智能体工作流运行中"
        : isEn
          ? "Workflow running"
          : "工作流运行中",
      nextAction: isEn ? "Use /workflows for details." : "可用 /workflows 查看详情。",
    });
  }

  const backgroundTasksRunning = input.backgroundTasksRunning ?? 0;
  if (input.includeBackgroundRunning && backgroundTasksRunning > 0) {
    return withCommon({
      phase: "background_running",
      source: "background",
      title: isEn
        ? `${backgroundTasksRunning} background task(s) running`
        : `${backgroundTasksRunning} 个后台任务运行中`,
      nextAction: isEn ? "Use /background for details." : "可用 /background 查看详情。",
    });
  }

  return undefined;
}

function projectActivityPhaseToWorkRequestState(
  input: WorkRequestProjectionInput,
  phase: string,
  isEn: boolean,
): Omit<WorkRequestState, "elapsedMs" | "detailsRef"> | undefined {
  const toolName = normalizeOptionalText(input.toolName) ?? (isEn ? "tool" : "工具");
  const toolTarget = normalizeOptionalText(input.toolTarget);
  const reportPath = input.reportPath ?? "report.md";
  if (phase === "request_started") {
    return { phase: "understanding", source: "model", title: isEn ? "Thinking…" : "思考中…" };
  }
  if (phase === "request_started_report") {
    return {
      phase: "planning",
      source: "model",
      title: isEn ? "Preparing report…" : "准备报告…",
      summary: reportPath,
    };
  }
  if (phase === "waiting_first_delta") {
    return {
      phase: "model_streaming",
      source: "model",
      title: isEn ? "Waiting for model response…" : "等待模型响应…",
      nextAction: isEn ? "Use /interrupt to stop this request." : "可用 /interrupt 中断本次请求。",
    };
  }
  if (phase === "compacting_context") {
    return {
      phase: "provider_recovering",
      source: "provider",
      title: isEn ? "Compacting context…" : "正在压缩上下文…",
      nextAction: isEn ? "Continuing after compaction." : "压缩完成后继续。",
    };
  }
  if (phase === "provider_retrying") {
    const attempt = input.retryAttempt ?? 1;
    const max = input.retryMax ?? 3;
    const delay = input.retryDelaySec ?? 1;
    return {
      phase: "provider_recovering",
      source: "provider",
      title: isEn ? `Automatic retry ${attempt}/${max}` : `自动重试 ${attempt}/${max}`,
      summary: isEn ? `Retry in ${delay}s` : `${delay}s 后重试`,
    };
  }
  if (phase === "provider_recovering") {
    return {
      phase: "provider_recovering",
      source: "provider",
      title: isEn ? "Recovering provider stream…" : "正在恢复 provider 流…",
      nextAction: isEn
        ? "Retrying with compacted context if needed."
        : "必要时会压缩上下文后重试。",
    };
  }
  if (phase === "provider_switching") {
    return {
      phase: "provider_recovering",
      source: "provider",
      title: isEn ? "Switching provider/model…" : "正在切换 provider/model…",
      nextAction: isEn ? "Trying the configured fallback route." : "正在尝试配置的 fallback 路线。",
    };
  }
  if (phase === "tool_running") {
    return {
      phase: "tool_running",
      source: "tool",
      title: isEn ? `Running ${toolName}…` : `运行 ${toolName}…`,
      summary: toolTarget,
    };
  }
  if (phase === "continuing_after_tool") {
    return {
      phase: "tool_calling",
      source: "model",
      title: isEn ? "Reviewing tool result…" : "整理工具结果…",
    };
  }
  if (
    phase === "checking_final_evidence" ||
    phase === "collecting_final_evidence" ||
    phase === "rewriting_final_answer" ||
    phase === "verifying_final_answer"
  ) {
    return {
      phase: "verification_running",
      source: "verification",
      title: isEn ? "Verifying final answer…" : "验证最终回答…",
      nextAction: isEn
        ? "Keeping the draft out of scrollback until it is final."
        : "最终文本确认前不会写入 scrollback。",
    };
  }
  if (phase === "permission_waiting") {
    return {
      phase: "permission_waiting",
      source: "permission",
      title: isEn ? "Waiting for approval" : "等待确认",
    };
  }
  if (phase === "request_failed" || phase === "error" || phase === "failed") {
    return {
      phase: "failed",
      source: "provider",
      title: isEn ? "Request failed" : "请求失败",
      nextAction: isEn ? "Retry or inspect details." : "请重试或查看详情。",
    };
  }
  if (phase === "completed" || phase === "request_completed") {
    return {
      phase: "completed",
      source: "model",
      title: isEn ? "Completed" : "已完成",
    };
  }
  return undefined;
}

function computeElapsedMs(startedAtMs: number | undefined, nowMs: number | undefined): number | undefined {
  if (!startedAtMs || !Number.isFinite(startedAtMs)) return undefined;
  return Math.max(0, (nowMs ?? Date.now()) - startedAtMs);
}

function isTerminalWorkRequestPhase(phase: WorkRequestPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "idle";
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function formatRequestActivity(
  phase: RequestActivityPhase,
  language: Language,
  values: {
    reportPath?: string;
    toolName?: string;
    retryAttempt?: number;
    retryMax?: number;
    retryDelaySec?: number;
  } = {},
): string {
  const reportPath = values.reportPath ?? "report.md";
  const toolName = values.toolName ?? "tool";
  if (language === "en-US") {
    if (phase === "request_started_report") {
      return `Inspecting project evidence, then saving the report to ${reportPath}.`;
    }
    if (phase === "waiting_first_delta") {
      return "Still waiting for the model. Use /interrupt to stop this request.";
    }
    if (phase === "compacting_context") {
      return "Compacting context before the model request…";
    }
    if (phase === "tool_running") {
      return `Running ${toolName}…`;
    }
    if (phase === "continuing_after_tool") {
      return "Continuing after the tool result…";
    }
    if (phase === "permission_waiting") {
      return "Waiting for your approval; the model request is paused.";
    }
    if (phase === "checking_final_evidence") {
      return "Checking final answer evidence before showing it.";
    }
    if (phase === "collecting_final_evidence") {
      return "Collecting missing final answer evidence.";
    }
    if (phase === "rewriting_final_answer") {
      return "Rewriting the final answer from recorded evidence.";
    }
    if (phase === "verifying_final_answer") {
      return "Verifying the final answer before showing it.";
    }
    if (phase === "provider_retrying") {
      const attempt = values.retryAttempt ?? 1;
      const max = values.retryMax ?? 3;
      const delay = values.retryDelaySec ?? 1;
      return `Automatic retry ${attempt}/${max}… retry in ${delay}s`;
    }
    if (phase === "provider_recovering") {
      return "Recovering the stream and compacting context before retry…";
    }
    if (phase === "provider_switching") {
      return "Switching to a backup model…";
    }
    return "Thinking…";
  }
  if (phase === "request_started_report") {
    return `正在检查项目证据，随后把报告保存到 ${reportPath}。`;
  }
  if (phase === "waiting_first_delta") {
    return "模型仍在等待响应。可用 /interrupt 中断本次请求。";
  }
  if (phase === "compacting_context") {
    return "正在压缩上下文，随后继续请求模型…";
  }
  if (phase === "tool_running") {
    return `正在运行 ${toolName}…`;
  }
  if (phase === "continuing_after_tool") {
    return "工具结果已回传，正在继续生成…";
  }
  if (phase === "permission_waiting") {
    return "正在等待你的批准；模型请求已暂停。";
  }
  if (phase === "checking_final_evidence") {
    return "正在检查最终回答证据。";
  }
  if (phase === "collecting_final_evidence") {
    return "正在补齐最终回答缺失证据。";
  }
  if (phase === "rewriting_final_answer") {
    return "正在根据已有证据重写最终回答。";
  }
  if (phase === "verifying_final_answer") {
    return "正在验证最终回答，验证后再显示。";
  }
  if (phase === "provider_retrying") {
    const attempt = values.retryAttempt ?? 1;
    const max = values.retryMax ?? 3;
    const delay = values.retryDelaySec ?? 1;
    return `自动重试 ${attempt}/${max}…${delay}s 后重试`;
  }
  if (phase === "provider_recovering") {
    return "正在恢复流并压缩上下文后重试…";
  }
  if (phase === "provider_switching") {
    return "正在切换备用模型…";
  }
  return "正在思考…";
}

export function formatProviderFailurePrimary(error: unknown, language: Language): string {
  const kind = classifyProviderFailure(error);
  if (language === "en-US") {
    if (kind === "rate_limit") {
      return "The model service is rate limited. Slow down or retry later; a configured fallback model can be used when available. Run /model doctor for details.";
    }
    if (kind === "quota_or_balance_exhausted") {
      return "The model service reported exhausted quota, credits, or account balance. Add billing or credits, or switch key/provider/model. Linghun has not queried your balance. Run /model doctor for details.";
    }
    if (kind === "reasoning_unsupported") {
      return "This gateway or model does not accept reasoning params. Lower the reasoning level or switch the gateway/model. Run /model doctor for details.";
    }
    if (kind === "auth") {
      return "The model service rejected the API key or permission. Check the key, account permissions, or selected provider/model. Run /model doctor for details.";
    }
    if (kind === "not_found") {
      return "The endpoint or model was not found. Check the base URL, endpoint profile, and model name. Run /model doctor for details.";
    }
    if (kind === "gateway") {
      return "The upstream model service or gateway is temporarily unavailable, so this request did not complete. Retry later or run /model doctor for details.";
    }
    if (kind === "response_failed") {
      return "The upstream service explicitly ended this response without a usable answer. This request did not complete; input is ready, so retry or switch model. Run /model doctor if it repeats.";
    }
    if (kind === "compatibility") {
      return "The endpoint returned a non-SSE stream. Check whether the endpoint/base URL supports streaming SSE and whether the endpoint profile matches this gateway. Run /model doctor for details.";
    }
    if (kind === "stream_parse") {
      return "The gateway returned malformed SSE stream data. This points to an SSE compatibility-layer format issue, not ordinary network instability. Run /model doctor or inspect /details evidence.";
    }
    if (kind === "tool_stream") {
      return "The tool-call stream ended incomplete. This can be a model/gateway interruption or a local stream parsing boundary issue. Run /model doctor or inspect /details evidence.";
    }
    if (kind === "transit") {
      return "The response stream failed in transit, so this request did not complete. This is a service or network transport issue, not a local Linghun bug. Retry later or run /model doctor for details.";
    }
    if (kind === "timeout") {
      return "The model took too long to respond, so this request did not complete. Retry later or run /model doctor for details.";
    }
    if (kind === "abort") {
      return "This request was interrupted. Input is ready again.";
    }
    if (kind === "schema") {
      return "The model service rejected the request shape: schema, tool choice, tool result, or reasoning settings are incompatible. Run /model doctor for details.";
    }
    return "The model request did not complete. Run /model doctor for details, then retry.";
  }
  if (kind === "rate_limit") {
    return "模型服务触发限流。本次请求未完成；请降低请求频率或稍后重试。若已配置备用模型，Linghun 会尝试切换。可运行 /model doctor 查看详情。";
  }
  if (kind === "quota_or_balance_exhausted") {
    return "模型服务返回额度、点数或账户余额不足。本次请求未完成；请充值或检查账单，或切换密钥、服务商或模型。Linghun 没有查询余额，只是根据上游错误分类。可运行 /model doctor 查看详情。";
  }
  if (kind === "reasoning_unsupported") {
    return "当前网关或模型不接受推理参数。请降低推理等级或更换网关/模型。可运行 /model doctor 查看详情。";
  }
  if (kind === "auth") {
    return "模型服务拒绝了密钥或权限。本次请求未完成；请检查密钥、账号权限或当前服务商/模型配置。可运行 /model doctor 查看详情。";
  }
  if (kind === "not_found") {
    return "接口或模型不存在。本次请求未完成；请检查服务地址、接口类型和模型名称。可运行 /model doctor 查看详情。";
  }
  if (kind === "gateway") {
    return "上游模型服务或网关暂时异常，本次请求未完成。请稍后重试，或运行 /model doctor 查看详情。";
  }
  if (kind === "response_failed") {
    return "上游服务已明确结束本次响应，但没有生成可用答案。本次请求未完成，输入已恢复；可重试或切换模型，若重复出现请运行 /model doctor。";
  }
  if (kind === "compatibility") {
    return "接口返回的不是 SSE 流。本次请求未完成；请检查 endpoint/baseUrl 是否支持 SSE，以及 endpointProfile 是否和网关匹配。可运行 /model doctor 查看详情。";
  }
  if (kind === "stream_parse") {
    return "网关返回的 SSE 流格式异常。本次请求未完成；这更像是 SSE 兼容层格式问题，不是普通网络抖动。可运行 /model doctor 或 /details evidence 查看详情。";
  }
  if (kind === "tool_stream") {
    return "工具调用流不完整，本次请求未完成。可能是模型/网关中断，也可能是流解析边界问题。可运行 /model doctor 或 /details evidence 查看详情。";
  }
  if (kind === "transit") {
    return "响应流传输失败，本次请求未完成。可能是模型服务、网关传输或本地兼容层问题；请稍后重试，或运行 /model doctor 和 /details evidence 查看详情。";
  }
  if (kind === "timeout") {
    return "等待模型响应过久，本次请求未完成。稍后重试，或运行 /model doctor 查看详情。";
  }
  if (kind === "abort") {
    return "已中断本次请求，可以继续输入。";
  }
  if (kind === "schema") {
    return "模型服务拒绝了请求格式：接口类型、工具选择、工具结果或推理设置不兼容。请运行 /model doctor 查看详情。";
  }
  return "模型请求未完成。可运行 /model doctor 查看详情后重试。";
}

export function formatProviderFailureTitle(language: Language): string {
  return language === "en-US" ? "model request failed" : "模型请求失败";
}

export function formatProviderFallbackAttemptSummary(
  input: {
    fromProvider: string;
    fromModel: string;
    toProvider: string;
    toModel: string;
    reasonKind: ProviderFailureKind;
  },
  language: Language,
): string {
  if (language === "en-US") {
    return `Fallback attempt: the primary model failed with ${formatProviderFailureKindLabel(input.reasonKind, language)}; trying a backup model.`;
  }
  return `正在尝试备用模型：主模型因${formatProviderFailureKindLabel(input.reasonKind, language)}失败，正在切换。`;
}

export function formatProviderFailureKindLabel(
  kind: ProviderFailureKind,
  language: Language,
): string {
  const labels: Record<ProviderFailureKind, { zh: string; en: string }> = {
    rate_limit: { zh: "限流", en: "rate limit" },
    quota_or_balance_exhausted: { zh: "额度或余额不足", en: "quota or balance exhausted" },
    schema: { zh: "请求格式不兼容", en: "schema/tool compatibility" },
    auth: { zh: "密钥或权限问题", en: "API key or permission" },
    not_found: { zh: "接口或模型不存在", en: "endpoint or model not found" },
    gateway: { zh: "服务端或网关异常", en: "server or gateway failure" },
    response_failed: { zh: "上游响应未完成", en: "upstream response failed" },
    compatibility: { zh: "SSE/接口兼容问题", en: "SSE/endpoint compatibility" },
    stream_parse: { zh: "SSE 流格式异常", en: "malformed SSE stream" },
    tool_stream: { zh: "工具调用流不完整", en: "incomplete tool-call stream" },
    transit: { zh: "传输失败", en: "stream or transit failure" },
    timeout: { zh: "响应超时", en: "timeout" },
    abort: { zh: "请求已中断", en: "interrupted request" },
    reasoning_unsupported: { zh: "推理设置不兼容", en: "reasoning settings unsupported" },
    generic: { zh: "模型请求失败", en: "model request failure" },
  };
  const label = labels[kind] ?? labels.generic;
  return language === "en-US" ? label.en : label.zh;
}

export function formatProviderEmptyResponsePrimary(language: Language): string {
  return language === "en-US"
    ? "The model returned no answer. Run /model doctor for details, then retry."
    : "模型没有返回有效回答。可运行 /model doctor 查看详情后重试。";
}

// D.13M：thinking-only 空响应（Anthropic extended thinking 已返回，但没有最终 text/tool_use）。
// 给用户明确人话提示，区别于"完全没产出"的通用文案。
export function formatProviderThinkingOnlyResponsePrimary(language: Language): string {
  return language === "en-US"
    ? "The model returned a thinking stream but no final text. Retry, lower the reasoning level, or run /model doctor for details."
    : "模型已返回思考流但没有最终文本。请重试或降低推理等级，可运行 /model doctor 查看详情。";
}

export function formatReportEvidenceRequired(language: Language): string {
  return language === "en-US"
    ? "If the report depends on project facts, inspect the relevant evidence and mark missing README/package/config items as unconfirmed."
    : "如果报告依赖项目事实，请检查相关证据；未发现 README/package/config 时，请在报告中标记为未确认。";
}

export function formatReportIncompletePrimary(path: string, language: Language): string {
  return language === "en-US"
    ? `Report generation is blocked: no saved report was produced at ${path}.`
    : `报告生成受阻：尚未在 ${path} 生成报告文件。`;
}

export type ProviderFailureKind =
  | "rate_limit"
  | "quota_or_balance_exhausted"
  | "schema"
  | "auth"
  | "not_found"
  | "gateway"
  | "response_failed"
  | "compatibility"
  | "stream_parse"
  | "tool_stream"
  | "transit"
  | "timeout"
  | "abort"
  | "reasoning_unsupported"
  | "generic";

export function classifyProviderFailure(error: unknown): ProviderFailureKind {
  const code = readStringField(error, "code");
  const name = readStringField(error, "name");
  const status = readNumberField(error, "status") ?? readNumberField(error, "statusCode");
  const message = error instanceof Error ? error.message : (readStringField(error, "message") ?? String(error ?? ""));
  const text = `${code ?? ""} ${name ?? ""} ${status ?? ""} ${message}`;
  // Decode transport envelopes are transit failures. Plain provider
  // SSE `error` events may carry quota, schema, or gateway text, so classify
  // those by message below instead of treating every PROVIDER_STREAM_ERROR as
  // a transport problem.
  if (code === "PROVIDER_NON_SSE_STREAM") {
    return "compatibility";
  }
  if (code === "PROVIDER_RESPONSE_FAILED" || code === "PROVIDER_RESPONSE_INCOMPLETE") {
    return "response_failed";
  }
  if (code === "PROVIDER_MALFORMED_STREAM") {
    return "stream_parse";
  }
  if (code === "PROVIDER_PARTIAL_TOOL_CALL") {
    return "tool_stream";
  }
  if (code === "PROVIDER_STREAM_DECODE_ERROR" || code === "PROVIDER_RETRY_EXHAUSTED") {
    return "transit";
  }
  if (
    code === "PROVIDER_QUOTA_EXHAUSTED" ||
    /insufficient[_\s-]?quota|quota\s*(?:exhausted|exceeded|limit|reached)|credits?\s*(?:exhausted|used\s*up|insufficient|limit)|balance\s*(?:exhausted|insufficient|too\s*low|不足)|billing\s*(?:hard\s*limit|limit|required|payment)|payment[_\s-]?required|account\s+balance|余额不足|额度不足|欠费|充值/iu.test(
      text,
    )
  ) {
    return "quota_or_balance_exhausted";
  }
  if (
    code === "PROVIDER_RATE_LIMITED" ||
    status === 429 ||
    /\brate\s*limit(?:ed)?\b|too many requests|请求过快|限流/iu.test(text)
  ) {
    return "rate_limit";
  }
  // 推理参数不被网关/模型接受 —— 必须在 schema 之前分流，否则会被 schema 吞掉。
  if (
    /thinking|extended_thinking|reasoning|unsupported_param|不支持.*推理|推理.*不支持/iu.test(text)
  ) {
    return "reasoning_unsupported";
  }
  if (/prompt[_\s-]?too[_\s-]?long|context[_\s-]?length|maximum context|input too large|上下文.*过长|提示词.*过长/iu.test(text)) {
    return "schema";
  }
  if (/pdf[_\s-]?too[_\s-]?large|file too large|payload too large|request entity too large/iu.test(text)) {
    return "schema";
  }
  if (/tool[_\s-]?use[_\s-]?mismatch|duplicate[_\s-]?tool[_\s-]?use[_\s-]?id|duplicate[_\s-]?tool[_\s-]?call|tool result.*mismatch|invalid tool_call_id/iu.test(text)) {
    return "schema";
  }
  if (/overload|overloaded|server overloaded|capacity|temporarily overloaded|服务器.*过载/iu.test(text)) {
    return "gateway";
  }
  if (/ssl|certificate|cert[_\s-]?error|tls handshake|self signed|证书/iu.test(text)) {
    return "transit";
  }
  // D.14D-R2 P2-1 — provider/transit 层失败：eventstream/SSE 流解码失败、CRC
  // 校验不一致、流提前中断、重试耗尽。这些是 provider 与网络传输问题，不是
  // Linghun runtime bug，必须先于 gateway/timeout/schema 分流并明确归因。
  // PROVIDER_STREAM_ERROR 在真实压测里承载过 eventstream CRC mismatch / stream
  // decode 类错误；用户可见归因必须明确是 provider/transit failure。文案仍是固定
  // 脱敏摘要，不回显 baseUrl/key/raw response。
  if (
    /crc|checksum|eventstream|event[-\s]?stream|stream\s*decode|decode\s*(?:error|failed|mismatch)|malformed\s*(?:sse|stream|chunk)|retry\s*exhausted|重试.*耗尽|流.*解码|解码.*失败/iu.test(
      text,
    )
  ) {
    return "transit";
  }
  if (
    code === "PROVIDER_API_KEY_ERROR" ||
    code === "PROVIDER_AUTH_ERROR" ||
    status === 401 ||
    status === 403 ||
    /api\s*key|permission|forbidden|unauthorized|authentication|权限|鉴权|密钥/iu.test(text)
  ) {
    return "auth";
  }
  if (
    code === "PROVIDER_NOT_FOUND" ||
    code === "MODEL_NOT_FOUND" ||
    status === 404 ||
    /not[_\s-]?found|model.*not.*found|endpoint.*not.*found|不存在|未找到/iu.test(text)
  ) {
    return "not_found";
  }
  if (
    /\b(?:502|503|504)\b/u.test(text) ||
    code === "PROVIDER_SERVER_ERROR" ||
    /an error occurred while processing your request|upstream.*(?:error|failed)|gateway.*(?:error|failed)|service unavailable/iu.test(
      text,
    )
  ) {
    return "gateway";
  }
  if (/TIMEOUT|timeout|超时|等待.*过久/iu.test(text)) {
    return "timeout";
  }
  if (/AbortError|aborted|abort|中断/iu.test(text) || code === "ABORT_ERR") {
    return "abort";
  }
  if (
    code === "PROVIDER_BAD_REQUEST" ||
    code === "MODEL_TOOLS_UNSUPPORTED" ||
    code === "PROVIDER_PROFILE_MISMATCH" ||
    /schema|tool_choice|tools?|tool_result|profile mismatch|endpointProfile|请求格式|工具.*不支持/iu.test(
      text,
    )
  ) {
    return "schema";
  }
  if (code === "PROVIDER_STREAM_ERROR") {
    return "transit";
  }
  return "generic";
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function readNumberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : undefined;
}
