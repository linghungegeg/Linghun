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
  updatedAt: string;
  summary?: string;
  messageCount?: number;
};

export function buildSessionPanelEntries(
  sessions: SessionListItem[],
  currentSessionId: string | undefined,
): SessionPanelEntry[] {
  const sorted = [...sessions].sort((a, b) => {
    const at = new Date(a.updatedAt).getTime() || 0;
    const bt = new Date(b.updatedAt).getTime() || 0;
    return bt - at;
  });
  return sorted.map((s) => ({
    id: s.id,
    title: (s.summary && s.summary.trim().length > 0
      ? s.summary.trim()
      : s.id.slice(0, 12)),
    updatedAt: s.updatedAt,
    messageCount: typeof s.messageCount === "number" ? s.messageCount : 0,
    isCurrent: s.id === currentSessionId,
  }));
}
