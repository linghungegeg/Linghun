// D.14B Failure Learning Command Runtime
//
// /failures slash 入口（summary-first 只读 + ignore/resolve 写状态）。
// 业务逻辑在 failure-learning-runtime.ts / presenter；本模块只编排 handler。
// ignore/resolve 是轻量状态写入（改 status + 写回 <id>.json），复用现有
// appendSystemEvent 记录生命周期，不新增权限模式。

import type { Writable } from "node:stream";
import { showCommandPanel } from "./command-panel-runtime.js";
import { buildFailureLearningPanel } from "./failure-learning-presenter.js";
import {
  findFailureRecord,
  setFailureRecordStatus,
  writeFailureRecord,
} from "./failure-learning-runtime.js";
import type { TuiContext } from "./index.js";
import { writeLine } from "./startup-runtime.js";
import type { FailureLearningStatus } from "./tui-data-types.js";

export type FailureLearningCommandDeps = {
  appendSystemEvent: (
    context: TuiContext,
    sessionId: string,
    message: string,
    level: "info" | "warning",
  ) => Promise<void>;
  ensureSession: (context: TuiContext) => Promise<string>;
  writeStatus: (output: Writable, context: TuiContext) => void;
};

let runtimeDeps: FailureLearningCommandDeps | undefined;

export function configureFailureLearningCommandRuntime(deps: FailureLearningCommandDeps): void {
  runtimeDeps = deps;
}

function deps(): FailureLearningCommandDeps {
  if (!runtimeDeps) {
    throw new Error("failure-learning-command-runtime deps not configured");
  }
  return runtimeDeps;
}

async function updateStatus(
  args: string[],
  context: TuiContext,
  output: Writable,
  status: FailureLearningStatus,
): Promise<void> {
  const isEn = context.language === "en-US";
  const id = args[0];
  const record = findFailureRecord(context.failureLearning, id);
  if (!record) {
    writeLine(
      output,
      isEn
        ? `No matching failure learning record. Usage: /failures ${status === "resolved" ? "resolve" : "ignore"} <id>`
        : `未找到对应失败学习记录。用法：/failures ${status === "resolved" ? "resolve" : "ignore"} <id>`,
    );
    return;
  }
  setFailureRecordStatus(record, status);
  await writeFailureRecord(context.failureLearning, record);
  const sessionId = await deps().ensureSession(context);
  await deps().appendSystemEvent(
    context,
    sessionId,
    `failure learning status: id ${record.id}; status ${status}; category ${record.category}`,
    "info",
  );
  if (status === "resolved") {
    writeLine(
      output,
      isEn
        ? `Marked failure learning ${record.id} as resolved. It will no longer be surfaced to the model.`
        : `已将失败学习 ${record.id} 标记为已解决；不再投影给模型。`,
    );
  } else {
    writeLine(
      output,
      isEn
        ? `Ignored failure learning ${record.id}. It stays on record but is muted from prompt/main screen.`
        : `已忽略失败学习 ${record.id}；记录保留但不再进入 prompt/主屏。`,
    );
  }
}

export async function handleFailuresCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status" || action === "list") {
    showCommandPanel(
      context,
      output,
      buildFailureLearningPanel(context.failureLearning, context.language),
    );
    return;
  }
  if (action === "resolve") {
    await updateStatus(args.slice(1), context, output, "resolved");
    return;
  }
  if (action === "ignore") {
    await updateStatus(args.slice(1), context, output, "ignored");
    return;
  }
  writeLine(
    output,
    context.language === "en-US"
      ? "Usage: /failures | /failures list | /failures resolve <id> | /failures ignore <id>"
      : "用法：/failures | /failures list | /failures resolve <id> | /failures ignore <id>",
  );
}
