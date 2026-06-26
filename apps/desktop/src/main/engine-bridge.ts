import { Writable } from "node:stream";
import type { BrowserWindow, IpcMain } from "electron";
import type { TranscriptEvent } from "@linghun/core";
import type { EngineCommand, EngineEvent } from "../bridge/events.js";

// 把 TranscriptEvent 映射成精简的 EngineEvent 推给 renderer
function toEngineEvent(raw: TranscriptEvent): EngineEvent | null {
  switch (raw.type) {
    case "session_start":
      return { type: "session_start", sessionId: raw.sessionId, projectPath: raw.projectPath };
    case "user_message":
      return { type: "user_message", id: raw.id, text: raw.text };
    case "assistant_text_delta":
      return { type: "assistant_delta", id: raw.id, text: raw.text };
    case "system_event":
      return { type: "error", message: raw.message };
    case "background_task_update":
      return { type: "task_update", task: raw.task };
    case "checkpoint_created":
      return { type: "checkpoint", files: raw.checkpoint.changedFiles };
    default:
      return null;
  }
}

// 静默 stdout/stderr，引擎日志走 onEvent 旁路
const nullWritable = new Writable({ write(_chunk, _enc, cb) { cb(); } });

export function registerEngineBridge(win: BrowserWindow, ipc: IpcMain): void {
  let abortController: AbortController | null = null;

  function push(event: EngineEvent): void {
    if (!win.isDestroyed()) {
      win.webContents.send("engine:event", event);
    }
  }

  ipc.handle("engine:command", async (_e, cmd: EngineCommand) => {
    if (cmd.type === "abort") {
      abortController?.abort();
      return;
    }

    if (cmd.type === "send_message") {
      abortController?.abort();
      abortController = new AbortController();

      const { runHeadlessTask } = await import("@linghun/tui");

      void runHeadlessTask({
        prompt: cmd.text,
        projectPath: cmd.projectPath,
        mode: "auto-review",
        stdout: nullWritable,
        stderr: nullWritable,
        onEvent(raw) {
          const ev = toEngineEvent(raw);
          if (ev) push(ev);
        },
      }).then((exitCode) => {
        push({ type: "done", exitCode });
      }).catch((err: unknown) => {
        push({ type: "error", message: String(err) });
      });
    }
  });
}
