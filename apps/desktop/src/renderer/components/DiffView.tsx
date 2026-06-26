import { useState } from "react";
import type { DiffFile } from "../../bridge/events";

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

function FileBlock({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="diff-file">
      <button type="button" className="diff-file-head" onClick={() => setOpen((v) => !v)}>
        <span className={`diff-status diff-status-${file.status}`}>{STATUS_LABEL[file.status]}</span>
        <span className="diff-path">{file.path}</span>
        <span className="diff-stat">
          <span className="diff-add">+{file.additions}</span>{" "}
          <span className="diff-del">-{file.deletions}</span>
        </span>
      </button>
      {open && file.lines.length > 0 && (
        <table className="diff-table">
          <tbody>
            {file.lines.map((line, i) => (
              <tr key={i} className={`diff-line diff-line-${line.kind}`}>
                <td className="diff-gutter">{line.oldNo ?? ""}</td>
                <td className="diff-gutter">{line.newNo ?? ""}</td>
                <td className="diff-sign">
                  {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
                </td>
                <td className="diff-code">{line.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && file.lines.length === 0 && file.status === "untracked" && (
        <div className="diff-untracked">新文件，未跟踪</div>
      )}
    </div>
  );
}

export function DiffView({ files }: { files: DiffFile[] }) {
  return (
    <div className="diff-view">
      {files.map((f) => (
        <FileBlock key={f.path} file={f} />
      ))}
    </div>
  );
}
