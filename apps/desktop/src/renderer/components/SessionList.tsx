import type { ProjectInfo, SessionMeta } from "../../bridge/events";

type Props = {
  sessions: SessionMeta[];
  activeId: string | null;
  project: ProjectInfo;
  onNewSession: () => void;
  onSelect: (id: string) => void;
  onSwitchProject: () => void;
};

// 左栏 MVP：项目切换 + 会话列表 + 新建。
// Phase 1 会话元数据走前端本地态；Phase 2 接 session-store 持久化。
export function SessionList({
  sessions,
  activeId,
  project,
  onNewSession,
  onSelect,
  onSwitchProject,
}: Props) {
  return (
    <div className="session-list">
      <button
        type="button"
        className="project-switcher"
        title={`${project.path}${project.isGitRepo ? "" : "（非 git 仓库）"}\n点击切换项目`}
        onClick={onSwitchProject}
      >
        <span className="project-icon">{project.isGitRepo ? "▣" : "▢"}</span>
        <span className="project-name">{project.name}</span>
        <span className="project-switch-hint">切换</span>
      </button>

      <button type="button" className="new-session-btn" onClick={onNewSession}>
        ＋ 新会话
      </button>

      <div className="session-items">
        {sessions.length === 0 && <div className="empty">还没有会话</div>}
        {sessions.map((s) => (
          <button
            type="button"
            key={s.id}
            className={`session-item${s.id === activeId ? " active" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <div className="session-title">{s.title}</div>
            <div className="session-time">{new Date(s.updatedAt).toLocaleTimeString()}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
