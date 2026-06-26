import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserWindow, IpcMain } from "electron";
import type { DiffFile, DiffLine, DiffResult } from "../bridge/events.js";

const run = promisify(execFile);

// 在 projectPath 下执行 git，失败（非仓库/无 git）走 ok:false 返回，不抛。
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

// 把单个文件的 unified diff 片段解析成结构化行。
function parseFileHunks(body: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of body.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      lines.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1), newNo });
      newNo += 1;
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo += 1;
    } else if (raw.startsWith(" ")) {
      lines.push({ kind: "context", text: raw.slice(1), oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    }
  }
  return lines;
}

// 解析 git diff 全文：以 "diff --git" 分块，每块一个文件。
function parseDiff(diff: string): Map<string, { lines: DiffLine[]; status: DiffFile["status"] }> {
  const out = new Map<string, { lines: DiffLine[]; status: DiffFile["status"] }>();
  if (!diff.trim()) return out;
  const blocks = diff.split(/^diff --git /m).slice(1);
  for (const block of blocks) {
    const header = block.split("\n", 1)[0] ?? "";
    const pathMatch = /b\/(.+)$/.exec(header);
    const path = pathMatch ? pathMatch[1].trim() : header.trim();
    let status: DiffFile["status"] = "modified";
    if (/^new file mode/m.test(block)) status = "added";
    else if (/^deleted file mode/m.test(block)) status = "deleted";
    else if (/^rename from/m.test(block)) status = "renamed";
    const hunkStart = block.indexOf("@@");
    const body = hunkStart >= 0 ? block.slice(hunkStart) : "";
    out.set(path, { lines: parseFileHunks(body), status });
  }
  return out;
}

// 汇总：tracked 改动（含已暂存）走 git diff HEAD；untracked 单列。
export async function collectDiff(projectPath: string): Promise<DiffResult> {
  try {
    const numstat = await git(projectPath, ["diff", "HEAD", "--numstat"]).catch(() =>
      git(projectPath, ["diff", "--numstat"]),
    );
    const diff = await git(projectPath, ["diff", "HEAD"]).catch(() =>
      git(projectPath, ["diff"]),
    );
    const parsed = parseDiff(diff);

    const files: DiffFile[] = [];
    for (const row of numstat.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(row.trim());
      if (!m) continue;
      const path = m[3];
      const entry = parsed.get(path);
      files.push({
        path,
        status: entry?.status ?? "modified",
        additions: m[1] === "-" ? 0 : Number(m[1]),
        deletions: m[2] === "-" ? 0 : Number(m[2]),
        lines: entry?.lines ?? [],
      });
    }

    // untracked 文件：列出但不展开内容
    const status = await git(projectPath, ["status", "--porcelain"]);
    for (const row of status.split("\n")) {
      if (row.startsWith("?? ")) {
        const path = row.slice(3).trim();
        files.push({ path, status: "untracked", additions: 0, deletions: 0, lines: [] });
      }
    }

    return { ok: true, files };
  } catch (err) {
    return { ok: false, files: [], error: String(err) };
  }
}

// 右栏 review 面板的 diff 请求入口；checkpoint 后 renderer 主动拉一次。
export function registerDiffBridge(win: BrowserWindow, ipc: IpcMain): void {
  ipc.handle("diff:collect", async (_e, projectPath: string): Promise<DiffResult> => {
    return collectDiff(projectPath || ".");
  });
  void win;
}
