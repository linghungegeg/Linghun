import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { type BrowserWindow, type IpcMain, dialog } from "electron";
import type { PickProjectResult, ProjectInfo } from "../bridge/events.js";

const run = promisify(execFile);

// 解析项目根：在 path 下执行 git rev-parse 取顶层目录；
// 非仓库或无 git 时回退到传入路径本身，name 用 basename。
export async function resolveProject(path: string): Promise<ProjectInfo> {
  const abs = path === "." ? process.cwd() : resolve(path);
  try {
    const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], {
      cwd: abs,
      windowsHide: true,
    });
    const top = stdout.trim();
    if (top) {
      return { path: top, name: basename(top) || top, isGitRepo: true };
    }
  } catch {
    // 非仓库 / git 不可用：走目录名回退
  }
  return { path: abs, name: basename(abs) || abs, isGitRepo: false };
}

// 左栏 ProjectSwitcher：取当前项目信息 + 弹原生目录选择对话框。
export function registerProjectBridge(win: BrowserWindow, ipc: IpcMain): void {
  ipc.handle("project:current", async (_e, path: string): Promise<ProjectInfo> => {
    return resolveProject(path || ".");
  });

  ipc.handle("project:pick", async (): Promise<PickProjectResult> => {
    try {
      const res = await dialog.showOpenDialog(win, {
        title: "选择项目目录",
        properties: ["openDirectory"],
      });
      if (res.canceled || res.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      const project = await resolveProject(res.filePaths[0]);
      return { ok: true, project };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
