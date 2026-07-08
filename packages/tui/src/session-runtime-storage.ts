import { join } from "node:path";
import { resolveStoragePaths } from "@linghun/config";
import type { TuiContext } from "./tui-context-runtime.js";

export function bindSessionRuntimeStorage(context: TuiContext, sessionId: string): void {
  const baseSessionDir = resolveStoragePaths(context.config, context.projectPath).memorySession;
  context.memory.sessionDir = join(baseSessionDir, sessionId);
}
