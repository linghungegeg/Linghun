import { contextBridge, ipcRenderer } from "electron";
import type {
  DiffResult,
  EngineCommand,
  EngineEvent,
  PickProjectResult,
  ProjectInfo,
  WindowControlAction,
  WindowState,
} from "../bridge/events.js";

// 暴露给 renderer 的最小接口，主进程侧维持 contextIsolation
contextBridge.exposeInMainWorld("linghunBridge", {
  sendCommand(cmd: EngineCommand): void {
    void ipcRenderer.invoke("engine:command", cmd);
  },
  onEngineEvent(listener: (event: EngineEvent) => void): () => void {
    const handler = (_e: Electron.IpcRendererEvent, ev: EngineEvent) => listener(ev);
    ipcRenderer.on("engine:event", handler);
    return () => ipcRenderer.off("engine:event", handler);
  },
  windowControl(action: WindowControlAction): void {
    void ipcRenderer.invoke("window:control", action);
  },
  queryWindowState(): Promise<WindowState> {
    return ipcRenderer.invoke("window:query_state");
  },
  onWindowState(listener: (state: WindowState) => void): () => void {
    const handler = (_e: Electron.IpcRendererEvent, state: WindowState) => listener(state);
    ipcRenderer.on("window:state", handler);
    return () => ipcRenderer.off("window:state", handler);
  },
  collectDiff(projectPath: string): Promise<DiffResult> {
    return ipcRenderer.invoke("diff:collect", projectPath);
  },
  currentProject(projectPath: string): Promise<ProjectInfo> {
    return ipcRenderer.invoke("project:current", projectPath);
  },
  pickProject(): Promise<PickProjectResult> {
    return ipcRenderer.invoke("project:pick");
  },
});
