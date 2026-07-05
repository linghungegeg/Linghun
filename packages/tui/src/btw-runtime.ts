// D.14D — /btw side-question runtime.
//
// 参考 CCB sideQuestion.ts / btw.tsx 的产品行为（不复制源码实现）：
//   - 模型背书的临时插问：调用 provider 给出一次性回答；
//   - 单轮、无工具：不进入 tool loop，不触发权限/文件/Bash；
//   - 不污染 main conversation / Todo / Plan / checkpoint / git stable point；
//   - 不写 evidence、不进 D.13U/D.13V completion gate、不计入 final-answer claim；
//   - 失败可见：provider error / 空响应都返回 error 文本，由 BtwPanel 显示。
//
// 该模块只负责"发起隔离单轮请求并提取纯文本答案"。会话状态、面板状态、
// session store 记录由 index.ts 的 handleBtwCommand 协调（保持 index.ts 只做
// glue，本模块承载逻辑）。

import type { EndpointProfile, ModelGateway, ModelRequest, ModelUsage } from "@linghun/providers";
import type { Language } from "@linghun/shared";
import {
  applyCacheWritePolicyToRequest,
  resolveCachePolicy,
} from "./cache-policy-runtime.js";
import type { NaturalIntent } from "./natural-command-bridge.js";
import type { ProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import { withProviderRetry } from "./provider-circuit-breaker.js";

export type BtwSideQuestionRuntime = {
  provider: string;
  model: string;
  endpointProfile: EndpointProfile;
  reasoningLevel?: string;
  reasoningSent: boolean;
};

export type BtwTelemetryObserver = {
  onRequest?: (request: ModelRequest) => void;
  onUsage?: (usage: ModelUsage) => void;
};

export type BtwSideQuestionResult =
  | { status: "answered"; answer: string }
  | { status: "error"; error: string };

export type BtwIntent = "status_query" | "general_side_question" | "unknown";

const BTW_SYSTEM_PROMPT_ZH =
  "你正在以「临时插问」(side question) 身份回答一个独立的小问题。这是一个隔离的单轮请求：" +
  "不要调用任何工具，不要声称已完成/已验证/已修复任何主任务，" +
  "不要修改任何状态。直接、简洁地回答这个问题即可。如果需要更多上下文才能回答，请说明这一点。";

const BTW_SYSTEM_PROMPT_EN =
  "You are answering a standalone side question. This is an isolated single-turn request: " +
  "do not call any tools, do not claim that " +
  "any main-task work is done/verified/fixed, and do not modify any state. Answer the question " +
  "directly and concisely. If you would need more context to answer, say so.";

/**
 * 把 side-question 问题包成隔离的 system+user 消息对。注入只读上下文摘要让模型
 * 能回答进度类问题，但不注入 tool definitions / permission / evidence 等可操作字段。
 */
export function buildBtwMessages(
  question: string,
  language: Language,
  contextSnapshot?: string,
): { role: "system" | "user"; content: string }[] {
  const system = language === "en-US" ? BTW_SYSTEM_PROMPT_EN : BTW_SYSTEM_PROMPT_ZH;
  const systemContent = contextSnapshot
    ? `${system}\n\n--- Current session context (read-only) ---\n${contextSnapshot}`
    : system;
  return [
    { role: "system", content: systemContent },
    { role: "user", content: question },
  ];
}

export function classifyBtwIntent(intent: NaturalIntent): BtwIntent {
  if (intent.runtimeIntent?.kind === "runtime_status_query") {
    return "status_query";
  }
  if (intent.action === "model" || intent.confidence > 0) {
    return "general_side_question";
  }
  return "unknown";
}

/**
 * 纯函数：把累计的文本、是否有 thinking、是否 provider 报错，归一成 BtwSideQuestionResult。
 * 单测用它覆盖"只有 thinking"、"空响应"、"正常答案"等分支，不需要真实 provider。
 */
export function extractBtwResult(
  collected: { text: string; hadThinking: boolean; providerError?: string },
  language: Language,
): BtwSideQuestionResult {
  if (collected.providerError) {
    return { status: "error", error: collected.providerError };
  }
  const answer = collected.text.trim();
  if (answer.length > 0) {
    return { status: "answered", answer };
  }
  // 空响应（只有 thinking / 无内容）：给可见的降级文案，不冒充答案。
  const emptyHint =
    language === "en-US"
      ? collected.hadThinking
        ? "The model produced only internal reasoning and no visible answer. Try rephrasing the side question."
        : "The model returned an empty response. Try again or rephrase the side question."
      : collected.hadThinking
        ? "模型只产生了内部思考，没有可见回答。可以换个说法再问一次这个临时问题。"
        : "模型返回了空响应。可以重试或换个说法再问这个临时问题。";
  return { status: "error", error: emptyHint };
}

/**
 * 发起隔离单轮 side-question 请求。无工具、无 continuation、不记录 evidence、
 * 不写 session transcript（由调用方决定是否记 btw_question 事件）。
 *
 * 失败（provider error / 空响应）返回 status:"error"；成功返回 status:"answered"。
 */
export async function runBtwSideQuestion(
  question: string,
  gateway: ModelGateway,
  runtime: BtwSideQuestionRuntime,
  language: Language,
  signal: AbortSignal,
  breakerState?: ProviderCircuitBreakerState,
  contextSnapshot?: string,
  telemetry?: BtwTelemetryObserver,
): Promise<BtwSideQuestionResult> {
  const messages = buildBtwMessages(question, language, contextSnapshot);
  let text = "";
  let hadThinking = false;
  let providerError: string | undefined;
  try {
    const providerRequest: ModelRequest = applyCacheWritePolicyToRequest(
      {
        messages,
        model: runtime.model,
        endpointProfile: runtime.endpointProfile,
        ...(runtime.reasoningSent ? { reasoningLevel: runtime.reasoningLevel } : {}),
        toolChoice: "none",
      },
      resolveCachePolicy("side-question"),
    );
    telemetry?.onRequest?.(providerRequest);
    const stream = breakerState
      ? withProviderRetry(
          gateway,
          breakerState,
          runtime.provider,
          providerRequest,
          signal,
        )
      : gateway.stream(
          runtime.provider,
          providerRequest,
          signal,
        );
    for await (const event of stream) {
      if (signal.aborted) {
        return {
          status: "error",
          error: language === "en-US" ? "Side question cancelled." : "临时插问已取消。",
        };
      }
      if (event.type === "assistant_text_delta") {
        text += event.text;
        continue;
      }
      if (event.type === "assistant_thinking_delta") {
        hadThinking = true;
        continue;
      }
      if (event.type === "usage") {
        telemetry?.onUsage?.(event.usage);
        continue;
      }
      if (event.type === "error") {
        providerError =
          event.error.message || (language === "en-US" ? "Provider error." : "Provider 出错。");
        break;
      }
    }
  } catch (error) {
    providerError = error instanceof Error ? error.message : String(error);
  }
  return extractBtwResult({ text, hadThinking, providerError }, language);
}
