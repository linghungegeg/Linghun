import type { BrowserWindow, IpcMain } from "electron";
import type { WindowControlAction, WindowState } from "../bridge/events.js";

// frameless 窗口的最小/最大化/关闭 IPC，以及最大化状态回推。
// 与引擎桥解耦：窗口外壳行为不经过 runHeadlessTask。
export function registerWindowControl(win: BrowserWindow, ipc: IpcMain): void {
  function pushState(): void {
    if (win.isDestroyed()) return;
    win.webContents.send("window:state", {
      maximized: win.isMaximized(),
      platform: process.platform,
    } satisfies WindowState);
  }

  ipc.handle("window:control", (_e, action: WindowControlAction) => {
    switch (action) {
      case "minimize":
        win.minimize();
        break;
      case "toggle_maximize":
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
        break;
      case "close":
        win.close();
        break;
    }
  });

  ipc.handle("window:query_state", () => ({
    maximized: win.isMaximized(),
    platform: process.platform,
  } satisfies WindowState));

  win.on("maximize", pushState);
  win.on("unmaximize", pushState);
}
