import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, ipcMain } from "electron";
import { registerEngineBridge } from "./engine-bridge.js";
import { registerDiffBridge } from "./git-diff.js";
import { registerProjectBridge } from "./project.js";
import { registerWindowControl } from "./window-control.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// 打包后 Rust 二进制在 resources/bundled，复用 CLI 同款发现链路。
// 开发态留空，引擎走 node_modules 可选包回退链。
function configureBundledRoot(): void {
  if (process.env.LINGHUN_CLI_BUNDLED_ROOT) {
    return;
  }
  if (app.isPackaged) {
    process.env.LINGHUN_CLI_BUNDLED_ROOT = join(process.resourcesPath, "bundled");
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1459,
    height: 811,
    minWidth: 820,
    minHeight: 560,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#F6F6F6",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

app.whenReady().then(() => {
  configureBundledRoot();
  const win = createWindow();
  registerEngineBridge(win, ipcMain);
  registerWindowControl(win, ipcMain);
  registerDiffBridge(win, ipcMain);
  registerProjectBridge(win, ipcMain);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
