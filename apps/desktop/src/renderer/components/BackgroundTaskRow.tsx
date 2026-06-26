import type { EngineEvent } from "../../bridge/events";

type Task = Extract<EngineEvent, { type: "task_update" }>["task"];

const STATUS_DOT: Record<Task["status"], string> = {
  running: "var(--accent)",
  paused: "var(--warn)",
  completed: "var(--success)",
  failed: "var(--danger)",
  blocked: "var(--danger)",
  cancelled: "var(--text-muted)",
  timeout: "var(--warn)",
  stale: "var(--text-muted)",
};

// 中栏后台任务单行：状态色点 + 标题 + 当前步 + 进度。
export function BackgroundTaskRow({ task }: { task: Task }) {
  const pct =
    task.progress && task.progress.total
      ? Math.round((task.progress.completed / task.progress.total) * 100)
      : null;

  return (
    <div className="task-row">
      <span className="task-dot" style={{ background: STATUS_DOT[task.status] }} />
      <div className="task-body">
        <div className="task-title">
          <span className="task-kind">[{task.kind}]</span> {task.title}
        </div>
        {task.currentStep && <div className="task-step">{task.currentStep}</div>}
        {pct !== null && (
          <div className="task-progress">
            <div className="task-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <span className="task-status">{task.status}</span>
    </div>
  );
}
