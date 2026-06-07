import type { Language } from "@linghun/shared";

export type RequestActivityPhase =
  | "request_started"
  | "request_started_report"
  | "waiting_first_delta"
  | "tool_running"
  | "continuing_after_tool"
  | "permission_waiting"
  | "verifying_final_answer";

export function formatRequestActivity(
  phase: RequestActivityPhase,
  language: Language,
  values: { reportPath?: string; toolName?: string } = {},
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
    if (phase === "tool_running") {
      return `Running ${toolName}…`;
    }
    if (phase === "continuing_after_tool") {
      return "Continuing after the tool result…";
    }
    if (phase === "permission_waiting") {
      return "Waiting for your approval; the model request is paused.";
    }
    if (phase === "verifying_final_answer") {
      return "Verifying the final answer before showing it.";
    }
    return "Thinking…";
  }
  if (phase === "request_started_report") {
    return `正在检查项目证据，随后把报告保存到 ${reportPath}。`;
  }
  if (phase === "waiting_first_delta") {
    return "模型仍在等待响应。可用 /interrupt 中断本次请求。";
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
  if (phase === "verifying_final_answer") {
    return "正在验证最终回答，验证后再显示。";
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
    ? "Read key project evidence before writing the report. Mark missing README/package/config items as unconfirmed in the report."
    : "写报告前需要先读取关键项目证据；未发现 README/package/config 时，请在报告中标记为未确认。";
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
  // Decode / malformed transport envelopes are transit failures. Plain provider
  // SSE `error` events may carry quota, schema, or gateway text, so classify
  // those by message below instead of treating every PROVIDER_STREAM_ERROR as
  // a transport problem.
  if (
    code === "PROVIDER_STREAM_DECODE_ERROR" ||
    code === "PROVIDER_RETRY_EXHAUSTED" ||
    code === "PROVIDER_NON_SSE_STREAM" ||
    code === "PROVIDER_MALFORMED_STREAM"
  ) {
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
    code === "PROVIDER_PARTIAL_TOOL_CALL" ||
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
