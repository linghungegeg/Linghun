import type {
  DiffResult,
  EngineCommand,
  EngineEvent,
  PickProjectResult,
  ProjectInfo,
  WindowControlAction,
  WindowState,
} from "../bridge/events";

declare global {
  interface Window {
    linghunBridge: {
      sendCommand(cmd: EngineCommand): void;
      onEngineEvent(listener: (event: EngineEvent) => void): () => void;
      windowControl(action: WindowControlAction): void;
      queryWindowState(): Promise<WindowState>;
      onWindowState(listener: (state: WindowState) => void): () => void;
      collectDiff(projectPath: string): Promise<DiffResult>;
      currentProject(projectPath: string): Promise<ProjectInfo>;
      pickProject(): Promise<PickProjectResult>;
    };
  }
}

export {};
