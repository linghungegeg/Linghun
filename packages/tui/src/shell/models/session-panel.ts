/**
 * session-panel — D.13Q-UX Closure
 *
 * SessionsPanel 数据模型：把 SessionStore.list() 转成 picker 用的稳定结构。
 * 按 updatedAt 倒序排序；当前 session 标记 isCurrent；title 优先使用 summary，
 * 退到 sessionId 短串。**不在数据层 dump transcript**；只暴露 id + 元数据。
 */

export type SessionPanelEntry = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  isCurrent: boolean;
};

export type SessionListItem = {
  id: string;
  createdAt?: string;
  updatedAt: string;
  summary?: string;
  messageCount?: number;
};

export type SessionPreviewEvent = {
  type: string;
  text?: string;
  createdAt?: string;
};

export type SessionPreviewMessage = {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export function buildSessionPanelEntries(
  sessions: SessionListItem[],
  currentSessionId: string | undefined,
): SessionPanelEntry[] {
  const sorted = [...sessions].sort((a, b) => {
    const at = new Date(a.updatedAt).getTime() || 0;
    const bt = new Date(b.updatedAt).getTime() || 0;
    if (bt !== at) return bt - at;
    const ac = new Date(a.createdAt ?? "").getTime() || 0;
    const bc = new Date(b.createdAt ?? "").getTime() || 0;
    if (bc !== ac) return bc - ac;
    return b.id.localeCompare(a.id);
  });
  return sorted.map((s) => ({
    id: s.id,
    title: s.summary && s.summary.trim().length > 0 ? s.summary.trim() : s.id.slice(0, 12),
    updatedAt: s.updatedAt,
    messageCount: typeof s.messageCount === "number" ? s.messageCount : 0,
    isCurrent: s.id === currentSessionId,
  }));
}

export function buildSessionPreviewMessages(
  events: SessionPreviewEvent[],
  limit = 10,
): SessionPreviewMessage[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const messages: SessionPreviewMessage[] = [];
  for (const event of events) {
    if (
      (event.type !== "user_message" && event.type !== "assistant_text_delta") ||
      typeof event.text !== "string" ||
      event.text.trim().length === 0
    ) {
      continue;
    }
    const role = event.type === "user_message" ? "user" : "assistant";
    const previous = messages.at(-1);
    if (role === "assistant" && previous?.role === "assistant") {
      previous.text = `${previous.text}${event.text}`;
      previous.createdAt = event.createdAt ?? previous.createdAt;
      continue;
    }
    messages.push({
      role,
      text: role === "assistant" ? event.text : event.text.trim(),
      createdAt: event.createdAt ?? "",
    });
  }
  return messages.slice(-safeLimit).map((message) => ({
    ...message,
    text: message.text.trim(),
  }));
}
