import type { DiffFile } from "../../bridge/events";
import { DiffView } from "./DiffView";

type Props = {
  files: DiffFile[];
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
};

// 右栏 review 容器：头部操作 + diff 或空态。
// Phase 1 只读 diff；stage/commit/push 留 Phase 2。
export function ReviewPanel({ files, loading, onRefresh, onClose }: Props) {
  return (
    <section className="review">
      <div className="review-header">
        <span className="review-title">变更审查</span>
        <div className="review-actions">
          <button type="button" className="review-btn" onClick={onRefresh} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
          <button type="button" className="review-btn" onClick={onClose} title="收起">
            ✕
          </button>
        </div>
      </div>

      <div className="review-body">
        {files.length === 0 ? (
          <div className="review-empty">
            {loading ? "正在读取 diff…" : "没有未提交的更改"}
          </div>
        ) : (
          <DiffView files={files} />
        )}
      </div>
    </section>
  );
}
