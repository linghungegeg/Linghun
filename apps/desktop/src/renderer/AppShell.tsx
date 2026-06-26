import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffFile, ProjectInfo, SessionMeta } from "../bridge/events";
import { AppTitleBar } from "./components/AppTitleBar";
import { BackgroundTaskRow } from "./components/BackgroundTaskRow";
import { ResizeHandle } from "./components/ResizeHandle";
import { ReviewPanel } from "./components/ReviewPanel";
import { SessionList } from "./components/SessionList";
import { useEngineEvents } from "./hooks/useEngineEvents";
import { useTheme } from "./hooks/useTheme";

export function AppShell() {
  const { messages, tasks, running, changedFiles, sessionId } = useEngineEvents();
  const { mode, cycle } = useTheme();
  const [input, setInput] = useState("");

  // 当前项目（左栏 ProjectSwitcher）；初始用 "." 占位，挂载后解析真实仓库名。
  const [project, setProject] = useState<ProjectInfo>({
    path: ".",
    name: "当前项目",
    isGitRepo: false,
  });

  // 左栏会话（Phase 1 前端本地态）
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);

  // 右栏 review
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewWidth, setReviewWidth] = useState(600);
  const [sidebarWidth, setSidebarWidth] = useState(318);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);

  const transcriptEnd = useRef<HTMLDivElement>(null);

  // 挂载时解析当前工作目录的项目信息（git 仓库名）。
  useEffect(() => {
    void window.linghunBridge.currentProject(".").then(setProject);
  }, []);

  // session_start 时登记会话条目
  useEffect(() => {
    if (!sessionId) return;
    setSessions((prev) => {
      if (prev.some((s) => s.id === sessionId)) return prev;
      const now = new Date().toISOString();
      const firstUser = messages.find((m) => m.kind === "user");
      const title =
        firstUser && firstUser.kind === "user" ? firstUser.text.slice(0, 40) : "新会话";
      return [
        { id: sessionId, title, projectPath: project.path, createdAt: now, updatedAt: now },
        ...prev,
      ];
    });
    setActiveSession(sessionId);
  }, [sessionId, messages, project.path]);

  const refreshDiff = useCallback(async () => {
    setDiffLoading(true);
    try {
      const res = await window.linghunBridge.collectDiff(project.path);
      setDiffFiles(res.ok ? res.files : []);
    } finally {
      setDiffLoading(false);
    }
  }, [project.path]);

  // checkpoint（引擎产生变更）后自动开 review 并拉 diff
  useEffect(() => {
    if (changedFiles.length > 0) {
      setReviewOpen(true);
      void refreshDiff();
    }
  }, [changedFiles, refreshDiff]);

  // 新消息滚到底
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send() {
    const text = input.trim();
    if (!text || running) return;
    window.linghunBridge.sendCommand({ type: "send_message", text, projectPath: project.path });
    setInput("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function newSession() {
    window.linghunBridge.sendCommand({ type: "new_session" });
  }

  async function switchProject() {
    const res = await window.linghunBridge.pickProject();
    if (!res.ok) return;
    setProject(res.project);
    window.linghunBridge.sendCommand({ type: "open_project", path: res.project.path });
    setReviewOpen(false);
    setDiffFiles([]);
  }

  return (
    <div className="app-shell">
      <AppTitleBar themeMode={mode} onCycleTheme={cycle} />

      <div
        className={`body${reviewOpen ? " with-review" : ""}`}
        style={{
          gridTemplateColumns: reviewOpen
            ? `${sidebarWidth}px 1fr ${reviewWidth}px`
            : `${sidebarWidth}px 1fr`,
        }}
      >
        <aside className="sidebar">
          <SessionList
            sessions={sessions}
            activeId={activeSession}
            project={project}
            onNewSession={newSession}
            onSelect={setActiveSession}
            onSwitchProject={() => void switchProject()}
          />
        </aside>

        <section className="thread">
          <div className="thread-header">
            <span>{project.name}</span>
            <button
              type="button"
              className="thread-review-toggle"
              onClick={() => {
                setReviewOpen((v) => !v);
                if (!reviewOpen) void refreshDiff();
              }}
            >
              {reviewOpen ? "隐藏审查" : "查看变更"}
            </button>
          </div>

          <div className="transcript">
            {messages.length === 0 && <div className="empty">输入消息开始一次任务。</div>}
            {messages.map((m) => {
              if (m.kind === "user") {
                return (
                  <div key={m.id} className="msg msg-user">
                    {m.text}
                  </div>
                );
              }
              if (m.kind === "assistant") {
                return (
                  <div key={m.id} className="msg msg-assistant">
                    {m.text}
                  </div>
                );
              }
              if (m.kind === "tool") {
                return (
                  <div key={m.id} className="tool-card">
                    <span className={m.risk === "high" ? "risk-high" : ""}>⚙ {m.name}</span>
                  </div>
                );
              }
              if (m.kind === "task") {
                const task = tasks[m.id];
                return task ? <BackgroundTaskRow key={m.id} task={task} /> : null;
              }
              return (
                <div key={m.id} className="msg empty">
                  {m.text}
                </div>
              );
            })}
            {running && <div className="empty">运行中…</div>}
            <div ref={transcriptEnd} />
          </div>

          <div className="composer">
            <textarea
              rows={2}
              value={input}
              placeholder="给 Linghun 发条消息…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="button" onClick={send} disabled={running}>
              发送
            </button>
          </div>
        </section>

        {reviewOpen && (
          <>
            <ResizeHandle
              width={reviewWidth}
              min={360}
              max={900}
              edge="right"
              onResize={setReviewWidth}
            />
            <ReviewPanel
              files={diffFiles}
              loading={diffLoading}
              onRefresh={refreshDiff}
              onClose={() => setReviewOpen(false)}
            />
          </>
        )}
      </div>

      <div className="statusbar">
        <span>权限：auto-review</span>
        <span>模型：claude</span>
        <span>变更文件：{changedFiles.length}</span>
      </div>
    </div>
  );
}
