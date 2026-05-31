import type { Language } from "@linghun/shared";

export type RequestActivityPhase =
  | "request_started"
  | "request_started_report"
  | "waiting_first_delta"
  | "tool_running"
  | "continuing_after_tool"
  | "permission_waiting";

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
  return "正在思考…";
}

export function formatProviderFailurePrimary(error: unknown, language: Language): string {
  const kind = classifyProviderFailure(error);
  if (language === "en-US") {
    if (kind === "reasoning_unsupported") {
      return "This gateway or model does not accept reasoning params. Lower the reasoning level or switch the gateway/model. Run /model doctor for details.";
    }
    if (kind === "gateway") {
      return "The upstream gateway is temporarily unavailable, so this request did not complete. Retry later or run /model doctor for details.";
    }
    if (kind === "transit") {
      return "The provider's response stream failed in transit (decode / checksum / stream error), so this request did not complete. This is a provider/network transport issue, not a local Linghun bug. Retry later or run /model doctor for details.";
    }
    if (kind === "timeout") {
      return "The model took too long to respond, so this request did not complete. Retry later or run /model doctor for details.";
    }
    if (kind === "abort") {
      return "This request was interrupted. Input is ready again.";
    }
    if (kind === "schema") {
      return "The provider rejected the request schema. Run /model doctor to check endpointProfile, tools/tool_choice, tool_result, and reasoning compatibility.";
    }
    return "The model request did not complete. Run /model doctor for details, then retry.";
  }
  if (kind === "reasoning_unsupported") {
    return "当前网关或模型不接受推理参数。请降低推理等级或更换网关/模型。可运行 /model doctor 查看详情。";
  }
  if (kind === "gateway") {
    return "上游网关暂时异常，本次请求未完成。稍后重试，或运行 /model doctor 查看详情。";
  }
  if (kind === "transit") {
    return "provider 返回的响应流在传输中失败（解码/校验/流错误），本次请求未完成。这是 provider 与网络传输问题，不是 Linghun 本地缺陷。请稍后重试，或运行 /model doctor 查看详情。";
  }
  if (kind === "timeout") {
    return "等待模型响应过久，本次请求未完成。稍后重试，或运行 /model doctor 查看详情。";
  }
  if (kind === "abort") {
    return "已中断本次请求，可以继续输入。";
  }
  if (kind === "schema") {
    return "provider 拒绝了本次请求 schema。请运行 /model doctor 检查 endpointProfile、tools/tool_choice、tool_result 和 reasoning 兼容性。";
  }
  return "模型请求未完成。可运行 /model doctor 查看详情后重试。";
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

function classifyProviderFailure(
  error: unknown,
): "gateway" | "timeout" | "abort" | "schema" | "reasoning_unsupported" | "transit" | "generic" {
  const code = readStringField(error, "code");
  const name = readStringField(error, "name");
  const message = error instanceof Error ? error.message : String(error ?? "");
  const text = `${code ?? ""} ${name ?? ""} ${message}`;
  // 推理参数不被网关/模型接受 —— 必须在 schema 之前分流，否则会被 schema 吞掉。
  if (
    /thinking|extended_thinking|reasoning|unsupported_param|不支持.*推理|推理.*不支持/iu.test(
      text,
    )
  ) {
    return "reasoning_unsupported";
  }
  // D.14D-R2 P2-1 — provider/transit 层失败：eventstream/SSE 流解码失败、CRC
  // 校验不一致、流提前中断、重试耗尽。这些是 provider 与网络传输问题，不是
  // Linghun runtime bug，必须先于 gateway/timeout/schema 分流并明确归因。
  // PROVIDER_STREAM_ERROR 在真实压测里承载过 eventstream CRC mismatch / stream
  // decode 类错误；用户可见归因必须明确是 provider/transit failure。文案仍是固定
  // 脱敏摘要，不回显 baseUrl/key/raw response。
  if (
    code === "PROVIDER_STREAM_ERROR" ||
    code === "PROVIDER_STREAM_DECODE_ERROR" ||
    code === "PROVIDER_RETRY_EXHAUSTED" ||
    /crc|checksum|eventstream|event[-\s]?stream|stream\s*decode|decode\s*(?:error|failed|mismatch)|malformed\s*(?:sse|stream|chunk)|retry\s*exhausted|重试.*耗尽|流.*解码|解码.*失败/iu.test(
      text,
    )
  ) {
    return "transit";
  }
  if (/\b(?:502|503|504)\b/u.test(text) || code === "PROVIDER_SERVER_ERROR") {
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
  return "generic";
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}
