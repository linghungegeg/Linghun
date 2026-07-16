import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Writable } from "node:stream";
import { TOGGLE_DETAILS_KEYBIND, formatDiagnosticError } from "@linghun/shared";
import { highlight, type Theme } from "cli-highlight";
import type { TuiContext } from "./index.js";
import {
  appendAssistantStreamDelta,
  assistantStreamVisibleTail,
  createAssistantStreamDisplayState,
  drainAssistantStreamCommits,
  finalizeAssistantStreamDisplayState,
  type AssistantStreamDisplayState,
} from "./shell/models/streaming-transcript-state.js";
import {
  createTranscriptSource,
  findTranscriptSourceCell,
  snapshotTranscriptSourceCells,
  type TranscriptSource,
  transcriptSourceRawTextForBlock,
  transcriptSourceKindForBlock,
  upsertTranscriptSourceCell,
} from "./shell/models/transcript-source.js";
import { isDiffFenceLanguage } from "./shell/diff-renderer.js";
import { renderPlainMarkdownLines } from "./shell/plain-renderer.js";
import {
  canInsertTerminalHistoryText,
  insertTerminalHistoryText,
} from "./shell/terminal-history-inserter.js";
import { displayWidth, wrapText } from "./shell/text-utils.js";
import type { ProductBlockViewModel, TranscriptViewportGeometryView } from "./shell/types.js";
import {
  normalizeVisibleToolText,
  sanitizeDangerousTerminalControls,
} from "./shell/visible-output-normalizer.js";
import { createOutputBlock, redactSensitiveText } from "./shell/view-model.js";
import { stripAnsi, writeLine } from "./startup-runtime.js";
import {
  createAssistantPrimaryTextSanitizer,
  type StructuredToolOutput,
} from "./tool-output-presenter.js";

const MAX_OUTPUT_BLOCKS = 80;
const PRESERVE_RECENT_EPHEMERAL_BLOCKS = 12;
const POST_COMPACT_VISIBLE_BLOCKS = 4;
const MAX_LAST_FULL_OUTPUT_CHARS = 12_000;
const MAX_BLOCK_FULL_TEXT_CHARS = 12_000;
const LAST_FULL_OUTPUT_PREVIEW_CHARS = 2_000;
const OUTPUT_MEMORY_ARTIFACT_DIR = "tui-output";
// Phase 6.5: summary 首行超长时截断，避免单行渲染撑爆 TUI。
const MAX_STREAMING_SUMMARY_CHARS = 500;
const ASSISTANT_STREAM_COMMIT_TICK_MS = 16;
const NATIVE_SCROLLBACK_ENV = "LINGHUN_TUI_NATIVE_SCROLLBACK";
const TERMINAL_FIRST_TRANSCRIPT_ENV = "LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT";
const TERMINAL_FIRST_CODE_THEME: Theme = {
  keyword: (text) => ansiStyle("35", text),
  built_in: (text) => ansiStyle("36", text),
  type: (text) => ansiStyle("36", text),
  literal: (text) => ansiStyle("35", text),
  number: (text) => ansiStyle("33", text),
  string: (text) => ansiStyle("32", text),
  regexp: (text) => ansiStyle("32", text),
  title: (text) => ansiStyle("36", text),
  function: (text) => ansiStyle("36", text),
  comment: (text) => ansiStyle("2", text),
  meta: (text) => ansiStyle("33", text),
};
const FALLBACK_VISIBLE_TEXT_SANITIZER = Symbol("linghunFallbackVisibleTextSanitizer");

export type TerminalFirstAssistantSink = {
  stageStableAssistantText(text: string): void;
  commitStableAssistantText(sourceCellId?: string, onFlush?: () => void): boolean;
  rollbackStableAssistantText(): void;
  resetAssistantStream?(): void;
  commitAssistantTurnBreak?(): boolean;
  commitStableTranscriptBlock?(block: ProductBlockViewModel, onFlush?: () => void): boolean;
  commitUserTranscriptBlock?(block: ProductBlockViewModel, onFlush?: () => void): boolean;
};

export type TerminalFirstAssistantSinkOptions = {
  noColor?: boolean | (() => boolean);
  columns?: number | (() => number);
  rows?: number | (() => number);
  viewportGeometry?: TranscriptViewportGeometryView | (() => TranscriptViewportGeometryView | undefined);
  transcriptSource?: TranscriptSource | (() => TranscriptSource | undefined);
  // Plan B fix: explicit frame-top row (1-indexed), derived from live terminal
  // height so history writes land at the right boundary even at the instant a
  // user message is committed. Preferred over viewportGeometry when present.
  frameTopRow?: number | (() => number | undefined);
};

export type AssistantStreamOptions = {
  holdStableCommit?: boolean;
};

export function isNativeScrollbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[NATIVE_SCROLLBACK_ENV] !== "0";
}

function isRuntimeStatusDump(line: string): boolean {
  if (line.startsWith("[Linghun] 会话 ")) return true;
  if (line.startsWith("[Linghun] 模型 ")) return true;
  if (line.startsWith("Status: Session ")) return true;
  if (line.startsWith("Status: Model ")) return true;
  if (line.includes("确认 ") && line.includes("后台 ")) return true;
  if (line.includes("Gate ") && line.includes("BG ")) return true;
  return false;
}

export class ShellBlockOutput extends Writable {
  /**
   * 当前 active 的 assistant streaming block id（keep:true，由
   * beginAssistantStream 注册）。endAssistantStream 之后清空，下一轮
   * 再 begin 时换新 id。
   *
   * 这条路径专门绕开 _write 的 createOutputBlock + ephemeral splice 逻辑：
   * 流式 assistant_text_delta 不应被当作普通 writeLine 反复 push/splice，
   * 否则只会留下最后一片 chunk 而非完整文本。
   */
  private assistantBlockId: string | undefined;
  private compactOutputMemoryQueue: Promise<{ beforeCount: number; afterCount: number }> =
    Promise.resolve({ beforeCount: 0, afterCount: 0 });
  private assistantStreamText = "";
  private assistantPreviewText = "";
  private assistantStreamState: AssistantStreamDisplayState | undefined;
  private assistantCommitTick: ReturnType<typeof setTimeout> | undefined;
  private assistantTerminalFirstText = "";
  private assistantTerminalFirstCommitted = false;
  private assistantTerminalFirstStaged = false;
  private assistantHoldStableCommit = false;
  private readonly visibleTextSanitizer: ReturnType<typeof createAssistantPrimaryTextSanitizer>;

  constructor(
    private readonly context: TuiContext,
    private readonly blocks: ProductBlockViewModel[],
    private readonly onWrite: () => void,
    private readonly terminalFirstAssistantSink?: TerminalFirstAssistantSink,
  ) {
    super();
    this.visibleTextSanitizer = createAssistantPrimaryTextSanitizer(context.language, {
      terminalControlsOnly: true,
    });
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    const text = this.visibleTextSanitizer.push(chunk.toString());
    const normalized = text.trim();
    if (normalized) {
      // D13E-P3 cleanup #4 — 拦截 plain TUI 用的 StatusTray raw 行（writeStatus
      // 的产出）。Ink 路径下任何 writeLine/handleTuiKeypress 残留写出
      // "[Linghun] 会话 ... · 后台 N" / "Status: Session ..." 都会被这里 drop，
      // 让 task transcript 永远看不到那条噪音。新 TaskFooter 已经覆盖必要状态
      // （permission · model · cache · index · reasoning），所以丢弃这条不损失信号。
      if (isRuntimeStatusDump(normalized)) {
        callback();
        return;
      }
      const baseBlock = createOutputBlock(normalized, this.context.language);
      const block: ProductBlockViewModel = baseBlock.messageKind === "tool_result_error"
        ? {
            ...baseBlock,
            failureDomain: baseBlock.failureDomain ?? "tool",
            failureRequestTurnId: baseBlock.failureRequestTurnId ?? this.context.currentRequestTurnId,
          }
        : baseBlock;
      this.appendTranscriptSourceBlock(block);
      this.blocks.push(block);
      this.commitTerminalFirstStableBlock(block);
      // 缓存"最近一次普通 writeLine 的完整正文"，让 /details 默认分支可以展开
      // 长正文（如 /model doctor 的 provider.env merge / providers / endpointPath
      // 等多行 body）。/details 自身不能覆盖这条记录，否则连续 /details 会陷入
      // 套娃；handleDetailsCommand 在执行期间设置 suppressLastFullOutputCapture
      // 标记位跳过缓存。
      if (!this.context.suppressLastFullOutputCapture) {
        this.context.lastFullOutput = normalized;
      }
      this.compactOutputMemory().catch((error) => {
        void this.appendCompactOutputMemoryWarning(error);
      });
      // D.13Q-UX Real Smoke Fix v3 — 不再在 ShellBlockOutput 内做 ephemeral
      // splice 重排（旧实现 keep+lastEphemeral 会破坏 user → assistant →
      // diagnostic → user → assistant 的真实时间线，并且与 view-model 的
      // selectedBlocks 限流重复）。view-model.createShellViewModel 已按 append
      // 顺序保留 keep/fail/blocked，并对 ephemeral 做 N 条上限；这里只 append
      // 后通知 rerender。
      this.onWrite();
    }
    callback();
  }

  writeStructuredToolOutput(structured: StructuredToolOutput, primaryText = structured.text): void {
    const normalizedPrimary = this.visibleTextSanitizer.push(primaryText).replace(/\r/g, "").trim();
    if (!normalizedPrimary) return;
    const base = createOutputBlock(normalizedPrimary, this.context.language);
    const details = createVisibleStructuredDetails(structured, this.context.language);
    const hasVisibleDetails = Boolean(details && details !== base.fullText);
    const isError = structured.block.kind === "tool_result_error";
    const detailsHint =
      this.context.language === "en-US"
        ? `${TOGGLE_DETAILS_KEYBIND} for details`
        : `${TOGGLE_DETAILS_KEYBIND} 查看完整内容`;
    const block: ProductBlockViewModel = {
      ...base,
      kind: isError ? "error" : "details",
      status: isError ? "fail" : "info",
      title: "",
      fullText: details || base.fullText,
      nextAction: hasVisibleDetails ? detailsHint : base.nextAction,
      ctrlOCollapsed: hasVisibleDetails || base.ctrlOCollapsed,
      messageKind: structured.block.kind,
      failureDomain: isError ? "tool" : undefined,
      failureRequestTurnId: isError ? this.context.currentRequestTurnId : undefined,
      displayBlock: {
        ...structured.block,
        summary: base.summary,
        body: base.fullText,
      },
    };
    this.appendTranscriptSourceBlock(block);
    this.blocks.push(block);
    this.commitTerminalFirstStableBlock(block);
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = block.fullText;
    }
    this.compactOutputMemory().catch((error) => {
      void this.appendCompactOutputMemoryWarning(error);
    });
    this.onWrite();
  }

  /**
   * 注册一条 assistant streaming preview id，但 **不立即** 推入 blocks 数组。
   * 首个 keep:true block 只在 stable commit tick / end / replace 时出现。这样在
   * thinking-only / 空响应 / 慢请求等场景下，
   * 主屏不会出现一条空 block 渲染成"没有可见输出。"占位行 —— 等待态由
   * requestActivityPhase / mapRequestActivityToView 驱动的 ActivityIndicator
   * 单独负责（"正在思考…" / "Thinking…"）。
   *
   * id 由调用方传入（每个 request 用一个稳定 id），便于多轮请求各自占用
   * 独立 block，互不覆盖。
   */
  beginAssistantStream(id: string, options: AssistantStreamOptions = {}): void {
    if (this.assistantBlockId && this.assistantBlockId !== id) {
      if (this.assistantHoldStableCommit) {
        this.discardAssistantBlock(this.assistantBlockId);
      } else {
        this.finalizeActiveAssistantStream(this.assistantBlockId, { captureLastFullOutput: true });
        this.clearStreamingPreview(this.assistantBlockId);
      }
    }
    this.assistantBlockId = id;
    this.assistantHoldStableCommit = options.holdStableCommit === true;
    this.assistantStreamText = "";
    this.assistantPreviewText = "";
    this.assistantStreamState = createAssistantStreamDisplayState();
    this.assistantTerminalFirstText = "";
    this.assistantTerminalFirstCommitted = false;
    this.assistantTerminalFirstStaged = false;
    this.terminalFirstAssistantSink?.resetAssistantStream?.();
    this.terminalFirstAssistantSink?.rollbackStableAssistantText();
    this.context.streamingAssistant = undefined;
    this.setStreamingPreview(id, "");
    // 不再 push 初始空 block；只通知一次 rerender（让 ActivityIndicator 起来）。
    this.onWrite();
  }

  private ensureAssistantBlock(id: string): ProductBlockViewModel | undefined {
    const existing = this.blocks.find((b) => b.id === id);
    if (existing) return existing;
    // 复用 createOutputBlock 拿到 i18n 后的 title / 占位 summary，再补 keep:true。
    // 初始 fullText 用空串，由调用者紧接着覆盖为首个 delta 文本。
    const block = createOutputBlock("", this.context.language, id);
    block.keep = true;
    block.fullText = "";
    block.nextAction = undefined;
    this.blocks.push(block);
    return block;
  }

  /**
   * 将一段 assistant_text_delta 追加到当前 streaming preview。
   * - delta 先进入 display state，稳定行由 commit tick 渐进写入历史 ProductBlock
   * - mutable live tail 保持为独立 preview，避免全量正文反复作为热渲染单元
   * - 真实模型流带 expectedId；取消/换轮后 id 不匹配的迟到 delta 直接丢弃
   * - 测试/非交互直接调用不带 expectedId 时，找不到 active id 再 fallback 到 _write
   */
  appendAssistantDelta(text: string, expectedId?: string): void {
    text = this.visibleTextSanitizer.push(text);
    if (!text) return;
    const id = this.assistantBlockId;
    if (expectedId && id !== expectedId) {
      return;
    }
    if (!id) {
      this._write(text, "utf8", () => {});
      return;
    }
    this.assistantStreamText += text;
    this.assistantStreamState = appendAssistantStreamDelta(this.assistantStreamState, text);
    if (!this.assistantHoldStableCommit) {
      this.ensureAssistantCommitTick();
      this.assistantPreviewText = assistantStreamVisibleTail(this.assistantStreamState);
      this.setStreamingPreview(id, this.assistantPreviewText);
    } else {
      // Final-answer drafts can still be rejected by the gate; keep them out of
      // the user-visible live preview until replaceAssistantBlockContent commits
      // the cleaned or downgraded text.
      this.assistantPreviewText = "";
      this.clearStreamingPreview(id);
    }
    this.onWrite();
  }

  /**
   * 结束当前 streaming block 的 active 状态。block 保留在 this.blocks
   * 中作为 transcript row（keep:true 已确保 view-model 不会 slice 它），
   * 只清掉 active id，下一轮 beginAssistantStream 会换新 id。
   */
  endAssistantStream(): void {
    const id = this.assistantBlockId;
    if (id) {
      if (this.assistantHoldStableCommit) {
        this.discardAssistantBlock(id);
      } else {
        this.finalizeActiveAssistantStream(id, { captureLastFullOutput: true });
        this.clearStreamingPreview(id);
      }
    }
    this.assistantBlockId = undefined;
    this.assistantHoldStableCommit = false;
    this.assistantStreamText = "";
    this.assistantPreviewText = "";
    this.assistantStreamState = undefined;
    this.compactOutputMemory().catch((error) => {
      void this.appendCompactOutputMemoryWarning(error);
    });
    this.onWrite();
  }

  cancelAssistantStream(): void {
    const id = this.assistantBlockId ?? this.context.streamingAssistant?.id;
    if (id) {
      this.discardAssistantBlock(id);
    } else {
      this.stopAssistantCommitTick();
      this.context.streamingAssistant = undefined;
      this.terminalFirstAssistantSink?.resetAssistantStream?.();
      this.terminalFirstAssistantSink?.rollbackStableAssistantText();
    }
    this.assistantBlockId = undefined;
    this.assistantHoldStableCommit = false;
    this.assistantStreamText = "";
    this.assistantPreviewText = "";
    this.assistantStreamState = undefined;
    this.assistantTerminalFirstText = "";
    this.assistantTerminalFirstCommitted = false;
    this.assistantTerminalFirstStaged = false;
    this.onWrite();
  }

  /**
   * D.13V — Final Answer Gate 在 retry 前丢弃当前 streaming block 的全部累计
   * 内容。保留 active id，让接下来的 delta 可以重新填回同一条 block；
   * 同时清掉 lastFullOutput 中可能残留的违规原文，避免 Ctrl+O / details 拉到。
   */
  discardAssistantBlock(id: string): void {
    if (this.assistantBlockId === id) {
      this.stopAssistantCommitTick();
      this.assistantStreamText = "";
      this.assistantPreviewText = "";
      this.assistantStreamState = createAssistantStreamDisplayState();
      this.assistantTerminalFirstText = "";
      this.assistantTerminalFirstCommitted = false;
      this.assistantTerminalFirstStaged = false;
      this.terminalFirstAssistantSink?.resetAssistantStream?.();
      this.terminalFirstAssistantSink?.rollbackStableAssistantText();
    }
    this.clearStreamingPreview(id);
    const blockIndex = this.blocks.findIndex((b) => b.id === id);
    if (blockIndex >= 0) this.blocks.splice(blockIndex, 1);
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = undefined;
    }
    this.onWrite();
  }

  /**
   * D.13V — Final Answer Gate 在本地降级时把 streaming block 的 fullText
   * 替换成已经过 buildDowngradedFinalAnswer 处理过的安全文本；同时把
   * lastFullOutput 同步为同一份安全文本，让 Ctrl+O / details 也只看降级版。
   */
  replaceAssistantBlockContent(id: string, text: string): void {
    text = this.visibleTextSanitizer.push(text);
    if (this.assistantBlockId === id) {
      this.stopAssistantCommitTick();
      this.assistantStreamText = "";
      this.assistantPreviewText = "";
      this.assistantStreamState = undefined;
      this.assistantHoldStableCommit = false;
      this.assistantTerminalFirstText = "";
      this.assistantTerminalFirstCommitted = false;
      this.assistantTerminalFirstStaged = false;
      this.terminalFirstAssistantSink?.resetAssistantStream?.();
      this.terminalFirstAssistantSink?.rollbackStableAssistantText();
      // Plan B fix: the Final Answer Gate replaces the streamed draft with a
      // safe final text. Re-seed the stream + stage the safe text so the
      // subsequent finalize still writes this block into terminal scrollback.
      // Without this, replaced blocks never leave the Ink frame (root of the
      // "assistant reply never enters scrollback → resize duplicates it" bug).
      if (text) {
        this.assistantStreamText = text;
        this.terminalFirstAssistantSink?.stageStableAssistantText(text);
        this.assistantTerminalFirstText = text;
        this.assistantTerminalFirstStaged = true;
      }
    }
    this.clearStreamingPreview(id);
    const block = this.commitAssistantBlock(id, text, { captureLastFullOutput: true });
    if (block) this.appendTranscriptSourceBlock(block);
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = text;
    }
    this.compactOutputMemory().catch((error) => {
      void this.appendCompactOutputMemoryWarning(error);
    });
    this.onWrite();
  }

  /**
   * D.13Q-UX Real Smoke Fix v3 — 把一段诊断正文（/mcp status / /index status
   * 等）显式当作 messageKind=diagnostic block 写入 transcript：
   *   - 不走 createOutputBlock 的 assistant_text 默认分支，避免被当作普通 AI 正文；
   *   - 不进入 fail/blocked 状态，不再被任何关键词扫描误伤；
   *   - 仍累计到 lastFullOutput，让 /details + Ctrl+O 能展开完整诊断。
   * 调用方应自己保证只用于真正的诊断输出（status / doctor 概要 / state dump）。
   */
  writeDiagnosticLine(text: string): void {
    const normalized = this.visibleTextSanitizer.push(text).replace(/\r/g, "").trim();
    if (!normalized) return;
    const firstLine = normalized.split("\n").find((line) => line.trim()) ?? normalized;
    const nonEmptyLines = normalized.split("\n").filter((line) => line.trim().length > 0).length;
    const hasMore =
      normalized.length > 0 && (nonEmptyLines >= 2 || normalized.length > firstLine.length + 16);
    const detailsHint =
      this.context.language === "en-US"
        ? `${TOGGLE_DETAILS_KEYBIND} for details`
        : `${TOGGLE_DETAILS_KEYBIND} 查看完整内容`;
    const block: ProductBlockViewModel = {
      id: `diag-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      kind: "details",
      status: "info",
      title: "",
      summary: firstLine,
      fullText: normalized,
      nextAction: hasMore ? detailsHint : undefined,
      messageKind: "diagnostic",
    };
    this.appendTranscriptSourceBlock(block);
    this.blocks.push(block);
    this.commitTerminalFirstStableBlock(block);
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = normalized;
    }
    this.compactOutputMemory().catch((error) => {
      void this.appendCompactOutputMemoryWarning(error);
    });
    this.onWrite();
  }

  /**
   * D.13Q-UX Real Smoke Fix v3 复核 — 显式结构化错误写入路径：
   *   - 与 createOutputBlock（不再扫关键词）解耦，由调用方明确表态"这是错误"；
   *   - 走 messageKind="tool_result_error" / kind="error" / status="fail"，
   *     ProductBlock 命中红边卡片（带 fail marker + tool_result_error tone）；
   *   - Ctrl+O hint 沿用 v3 规则：只有多行或单行明显超长才挂 errorDetailsHint；
   *   - fullText 累计到 lastFullOutput，/details + Ctrl+O 能展开完整错误正文。
   * 调用点限定为真实错误：provider stream error / final no-tools provider error /
   * slash/tool catch / executeIndexIgnoreWritePlan ignore 写入失败 等。
   * 普通 writeLine / /mcp status / 普通 assistant 正文不要走这条路径。
   */
  writeErrorLine(text: string, title?: string, metadata?: ErrorLineMetadata): void {
    const normalized = this.visibleTextSanitizer.push(text).replace(/\r/g, "").trim();
    if (!normalized) return;
    const firstLine = normalized.split("\n").find((line) => line.trim()) ?? normalized;
    const nonEmptyLines = normalized.split("\n").filter((line) => line.trim().length > 0).length;
    const hasMore =
      normalized.length > 0 && (nonEmptyLines >= 2 || normalized.length > firstLine.length + 16);
    const errorHint =
      this.context.language === "en-US"
        ? `${TOGGLE_DETAILS_KEYBIND} for full error`
        : `${TOGGLE_DETAILS_KEYBIND} 查看完整错误`;
    const block: ProductBlockViewModel = {
      id: `err-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      kind: "error",
      status: "fail",
      title: title ?? (this.context.language === "en-US" ? "output failed" : "output 失败"),
      summary: firstLine,
      fullText: normalized,
      nextAction: hasMore ? errorHint : undefined,
      messageKind: "tool_result_error",
      retrySeconds: metadata?.retrySeconds ?? this.context.retryInfo?.delaySec,
      retryAttempt: metadata?.retryAttempt ?? this.context.retryInfo?.attempt,
      retryMax: metadata?.retryMax ?? this.context.retryInfo?.max,
      failureDomain: metadata?.failureDomain,
      failureOutcome: metadata?.failureOutcome,
      failureRequestTurnId: metadata?.failureRequestTurnId ?? this.context.currentRequestTurnId,
    };
    const last = this.blocks.at(-1);
    if (
      last?.messageKind === "tool_result_error" &&
      last.title === block.title &&
      last.fullText === block.fullText
    ) {
      if (!this.context.suppressLastFullOutputCapture) {
        this.context.lastFullOutput = normalized;
      }
      this.onWrite();
      return;
    }
    this.appendTranscriptSourceBlock(block);
    this.blocks.push(block);
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = normalized;
    }
    this.compactOutputMemory().catch((error) => {
      void this.appendCompactOutputMemoryWarning(error);
    });
    this.onWrite();
  }

  writeLocalCommandOutputLine(text: string): void {
    const normalized = this.visibleTextSanitizer.push(text).replace(/\r/g, "").trim();
    if (!normalized) return;
    const firstLine = normalized.split("\n").find((line) => line.trim()) ?? normalized;
    const nonEmptyLines = normalized.split("\n").filter((line) => line.trim().length > 0).length;
    const hasMore =
      normalized.length > 0 && (nonEmptyLines >= 2 || normalized.length > firstLine.length + 16);
    const detailsHint =
      this.context.language === "en-US"
        ? `${TOGGLE_DETAILS_KEYBIND} for details`
        : `${TOGGLE_DETAILS_KEYBIND} 查看完整内容`;
    const block: ProductBlockViewModel = {
      id: `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      kind: "tool",
      status: "info",
      title: "",
      summary: firstLine,
      fullText: normalized,
      nextAction: hasMore ? detailsHint : undefined,
      messageKind: "local_command_output",
    };
    this.appendTranscriptSourceBlock(block);
    this.blocks.push(block);
    this.commitTerminalFirstStableBlock(block);
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = normalized;
    }
    this.compactOutputMemory().catch((error) => {
      void this.appendCompactOutputMemoryWarning(error);
    });
    this.onWrite();
  }

  async compactOutputMemory(
    options: { projectMainScreen?: boolean } = {},
  ): Promise<{ beforeCount: number; afterCount: number }> {
    this.compactOutputMemoryQueue = this.compactOutputMemoryQueue.then(() =>
      this.compactOutputMemoryOnce(options),
    );
    return this.compactOutputMemoryQueue;
  }

  private async appendCompactOutputMemoryWarning(error: unknown): Promise<void> {
    if (!this.context.sessionId) {
      process.stderr.write(
        `[linghun] compact_output_memory_failed reason=${formatDiagnosticError(error)}\n`,
      );
      return;
    }
    try {
      await this.context.store.appendEvent(this.context.sessionId, {
        type: "system_event",
        id: randomUUID(),
        level: "warning",
        message: `compact_output_memory_failed reason=${formatDiagnosticError(error)}`,
        createdAt: new Date().toISOString(),
      });
    } catch (writeError) {
      process.stderr.write(
        `[linghun] compact_output_memory_failed reason=${formatDiagnosticError(error)}; warning_write_failed=${formatDiagnosticError(writeError)}\n`,
      );
    }
  }

  private commitAssistantBlock(
    id: string,
    text: string,
    options: { captureLastFullOutput?: boolean } = {},
  ): ProductBlockViewModel | undefined {
    if (!text) return undefined;
    const block = this.ensureAssistantBlock(id);
    if (!block) return undefined;
    const firstLine = text.split("\n").find((line) => line.trim()) ?? text;
    block.fullText = text;
    block.summary =
      firstLine.length > MAX_STREAMING_SUMMARY_CHARS
        ? `${firstLine.slice(0, MAX_STREAMING_SUMMARY_CHARS)}…`
        : firstLine;
    if (options.captureLastFullOutput !== false && !this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = text;
    }
    return block;
  }

  private setStreamingPreview(id: string, text: string): boolean {
    const fullText = this.assistantStreamText || text;
    if (!fullText) {
      if (this.context.streamingAssistant?.id === id) {
        this.context.streamingAssistant = undefined;
        return true;
      }
      return false;
    }
    const previous = this.context.streamingAssistant;
    this.context.streamingAssistant = {
      id,
      text: fullText,
      tailText: text,
      committedText: this.assistantStreamState?.committedText,
    };
    return (
      !previous ||
      previous.id !== id ||
      previous.text !== fullText ||
      previous.tailText !== text ||
      previous.committedText !== this.assistantStreamState?.committedText
    );
  }

  private drainAssistantStableCommits(id: string): void {
    if (!this.assistantStreamState) return;
    const drained = drainAssistantStreamCommits(this.assistantStreamState);
    this.assistantStreamState = drained.state;
    if (drained.committedDelta) {
      this.commitAssistantBlock(id, this.assistantStreamState.committedText, {
        captureLastFullOutput: false,
      });
    }
  }

  private ensureAssistantCommitTick(): void {
    if (this.assistantHoldStableCommit) return;
    if (this.assistantCommitTick || !this.assistantStreamState?.pendingStableText) return;
    this.assistantCommitTick = setTimeout(() => {
      this.assistantCommitTick = undefined;
      this.runAssistantCommitTick();
    }, ASSISTANT_STREAM_COMMIT_TICK_MS);
  }

  private runAssistantCommitTick(): void {
    const id = this.assistantBlockId;
    if (!id || !this.assistantStreamState) return;
    this.drainAssistantStableCommits(id);
    this.assistantPreviewText = assistantStreamVisibleTail(this.assistantStreamState);
    if (this.setStreamingPreview(id, this.assistantPreviewText)) {
      this.onWrite();
    }
    this.ensureAssistantCommitTick();
  }

  private stopAssistantCommitTick(): void {
    if (!this.assistantCommitTick) return;
    clearTimeout(this.assistantCommitTick);
    this.assistantCommitTick = undefined;
  }

  private finalizeActiveAssistantStream(
    id: string,
    options: { captureLastFullOutput?: boolean } = {},
  ): void {
    this.stopAssistantCommitTick();
    const visibleText = this.assistantStreamText || this.assistantPreviewText;
    if (!visibleText) return;
    this.assistantStreamState = finalizeAssistantStreamDisplayState(this.assistantStreamState);
    const terminalFirstTargetText = this.stageTerminalFirstAssistantText(visibleText);
    // Materialize the block (fullText/summary) before committing to terminal
    // history: a successful commit physically removes the block from the Ink
    // array, so it must be fully formed first. This keeps single ownership —
    // the block lives either in Ink (not yet committed) or in terminal
    // scrollback (committed), never both.
    const block = this.commitAssistantBlock(id, visibleText, options);
    if (block) this.appendTranscriptSourceBlock(block);
    const hadTerminalFirstText =
      this.assistantTerminalFirstCommitted ||
      this.assistantTerminalFirstStaged ||
      Boolean(terminalFirstTargetText);
    const committed = this.commitTerminalFirstAssistantText(terminalFirstTargetText);
    if (hadTerminalFirstText && committed) {
      this.terminalFirstAssistantSink?.commitAssistantTurnBreak?.();
    }
  }

  private clearStreamingPreview(id: string): void {
    if (this.context.streamingAssistant?.id === id) {
      this.context.streamingAssistant = undefined;
    }
  }

  private async compactOutputMemoryOnce(
    options: { projectMainScreen?: boolean } = {},
  ): Promise<{ beforeCount: number; afterCount: number }> {
    trimOutputBlocks(this.blocks);
    try {
      const compactedBlocks = await compactBlockFullText(this.context, this.blocks);
      for (const block of compactedBlocks) this.appendTranscriptSourceBlock(block);
      await compactLastFullOutput(this.context);
    } catch (error) {
      const compactedBlocks = compactBlockFullTextInMemory(this.blocks, error);
      for (const block of compactedBlocks) this.appendTranscriptSourceBlock(block);
      compactLastFullOutputInMemory(this.context, error);
    }
    if (options.projectMainScreen) {
      return projectMainScreenAfterCompact(this.context, this.blocks);
    }
    return { beforeCount: this.blocks.length, afterCount: this.blocks.length };
  }

  private stageTerminalFirstAssistantText(text: string): string | undefined {
    if (!this.terminalFirstAssistantSink) return undefined;
    if (!text.startsWith(this.assistantTerminalFirstText)) return undefined;
    const delta = text.slice(this.assistantTerminalFirstText.length);
    if (!delta) return undefined;
    this.terminalFirstAssistantSink.stageStableAssistantText(delta);
    this.assistantTerminalFirstStaged = true;
    return text;
  }

  private commitTerminalFirstAssistantText(committedText?: string): boolean {
    if (!this.terminalFirstAssistantSink) return false;
    const id = this.assistantBlockId;
    // Plan B single ownership: the sink writes to terminal scrollback and
    // fires onFlush synchronously on success, so the splice happens inline.
    // A failed commit leaves the block in the Ink array as the visible fallback.
    const committed = this.terminalFirstAssistantSink.commitStableAssistantText(id, () => {
      this.assistantTerminalFirstCommitted = true;
      this.assistantTerminalFirstStaged = false;
      if (committedText) this.assistantTerminalFirstText = committedText;
      if (!id) return;
      const idx = this.blocks.findIndex((candidate) => candidate.id === id);
      if (idx >= 0) {
        this.appendTranscriptSourceBlock(this.blocks[idx]);
        this.blocks.splice(idx, 1);
      }
    });
    if (!committed) {
      this.terminalFirstAssistantSink.rollbackStableAssistantText();
      this.assistantTerminalFirstCommitted = false;
      this.assistantTerminalFirstStaged = false;
    }
    return committed;
  }

  private commitTerminalFirstStableBlock(block: ProductBlockViewModel): void {
    // Plan B single ownership: onFlush fires synchronously on a successful
    // terminal write, splicing the block out of the Ink array inline.
    this.terminalFirstAssistantSink?.commitStableTranscriptBlock?.(block, () => {
      this.appendTranscriptSourceBlock(block);
      const idx = this.blocks.indexOf(block);
      if (idx >= 0) this.blocks.splice(idx, 1);
    });
  }

  private appendTranscriptSourceBlock(block: ProductBlockViewModel): void {
    const kind = transcriptSourceKindForBlock(block);
    if (!kind) return;
    this.context.transcriptSource ??= createTranscriptSource();
    upsertTranscriptSourceCell(this.context.transcriptSource, {
      id: block.id,
      kind,
      block,
      rawText: transcriptSourceRawTextForBlock(block),
    });
  }

}

function createVisibleStructuredDetails(
  structured: StructuredToolOutput,
  language: "zh-CN" | "en-US",
): string | undefined {
  const normalized = structured.layered.details
    ? redactSensitiveText(normalizeVisibleToolText(structured.layered.details).replace(/\r/g, "").trim())
    : undefined;
  const references = [
    structured.layered.fullOutputPath
      ? language === "en-US"
        ? `Full output: ${structured.layered.fullOutputPath}`
        : `完整输出：${structured.layered.fullOutputPath}`
      : undefined,
    structured.layered.evidenceId
      ? language === "en-US"
        ? `Evidence: ${structured.layered.evidenceId}`
        : `证据：${structured.layered.evidenceId}`
      : undefined,
  ].filter((line): line is string => Boolean(line));
  if (!normalized) return references.length > 0 ? references.join("\n") : undefined;
  if (normalized.length <= MAX_BLOCK_FULL_TEXT_CHARS) {
    return references.length > 0 ? [normalized, ...references].join("\n") : normalized;
  }
  const notice =
    language === "en-US"
      ? "... inline details bounded; use the retained full output or evidence."
      : "... 内联详情已收敛；请查看保留的完整输出或证据。";
  return [normalized.slice(0, LAST_FULL_OUTPUT_PREVIEW_CHARS).trimEnd(), notice, ...references]
    .filter(Boolean)
    .join("\n");
}

function projectMainScreenAfterCompact(
  context: TuiContext,
  blocks: ProductBlockViewModel[],
): { beforeCount: number; afterCount: number } {
  context.transcriptSource ??= createTranscriptSource();
  for (const block of blocks) {
    const kind = transcriptSourceKindForBlock(block);
    if (!kind) continue;
    upsertTranscriptSourceCell(context.transcriptSource, {
      id: block.id,
      kind,
      block,
      rawText: transcriptSourceRawTextForBlock(block),
    });
  }
  const sourceCells = context.transcriptSource.cells;
  const beforeCount = sourceCells.length;
  let sourceBoundaryIndex = -1;
  for (let index = sourceCells.length - 1; index >= 0; index -= 1) {
    if (sourceCells[index]?.kind !== "compact_boundary") continue;
    sourceBoundaryIndex = index;
    break;
  }
  const sourceBoundary = sourceBoundaryIndex >= 0 ? sourceCells[sourceBoundaryIndex] : undefined;
  const recentSourceCells = sourceCells
    .slice(sourceBoundaryIndex >= 0 ? sourceBoundaryIndex + 1 : 0)
    .slice(-POST_COMPACT_VISIBLE_BLOCKS);
  sourceCells.splice(
    0,
    sourceCells.length,
    ...(sourceBoundary ? [sourceBoundary, ...recentSourceCells] : recentSourceCells),
  );
  const boundaries = blocks.filter((block) => block.messageKind === "compact_boundary");
  const latestBoundary = boundaries.at(-1);
  const blockBoundaryIndex = latestBoundary ? blocks.lastIndexOf(latestBoundary) : -1;
  const recent = blocks
    .slice(blockBoundaryIndex + 1)
    .slice(-POST_COMPACT_VISIBLE_BLOCKS);
  const selected = latestBoundary ? [latestBoundary, ...recent] : recent;
  blocks.splice(0, blocks.length, ...selected);
  return { beforeCount, afterCount: sourceCells.length };
}

function trimOutputBlocks(blocks: ProductBlockViewModel[]): void {
  if (blocks.length <= MAX_OUTPUT_BLOCKS) return;
  const isPreserved = (block: ProductBlockViewModel): boolean =>
    block.keep === true || block.status === "fail" || block.status === "blocked";
  const ephemeralIndices = blocks
    .map((block, index) => (isPreserved(block) ? -1 : index))
    .filter((index) => index >= 0);
  const keepEphemeral = new Set(
    ephemeralIndices.slice(Math.max(0, ephemeralIndices.length - PRESERVE_RECENT_EPHEMERAL_BLOCKS)),
  );
  const selected = blocks.filter((block, index) => isPreserved(block) || keepEphemeral.has(index));
  if (selected.length > MAX_OUTPUT_BLOCKS) {
    const overflow = selected.length - MAX_OUTPUT_BLOCKS;
    const removable = selected
      .map((block, index) => (isPreserved(block) ? -1 : index))
      .filter((index) => index >= 0)
      .slice(0, overflow);
    const drop = new Set(removable);
    selected.splice(0, selected.length, ...selected.filter((_block, index) => !drop.has(index)));
  }
  blocks.splice(0, blocks.length, ...selected);
}

async function compactBlockFullText(
  context: TuiContext,
  blocks: ProductBlockViewModel[],
): Promise<ProductBlockViewModel[]> {
  const compacted: ProductBlockViewModel[] = [];
  for (const block of blocks) {
    const value = block.fullText;
    if (!value || value.length <= MAX_BLOCK_FULL_TEXT_CHARS || isCompactedOutputText(value)) {
      continue;
    }
    const artifact = await writeOutputArtifact(context, value);
    if (block.fullText !== value) {
      continue;
    }
    block.fullText = buildCompactedOutputSummary({
      tag: "persisted-tui-block-output",
      relativePath: artifact.relativePath,
      originalChars: value.length,
      sha256: artifact.sha256,
      preview: value.slice(0, LAST_FULL_OUTPUT_PREVIEW_CHARS),
    });
    compacted.push(block);
  }
  return compacted;
}

function compactBlockFullTextInMemory(
  blocks: ProductBlockViewModel[],
  error: unknown,
): ProductBlockViewModel[] {
  const compacted: ProductBlockViewModel[] = [];
  for (const block of blocks) {
    const value = block.fullText;
    if (!value || value.length <= MAX_BLOCK_FULL_TEXT_CHARS || isCompactedOutputText(value)) {
      continue;
    }
    block.fullText = buildCompactedOutputSummary({
      tag: "compacted-tui-block-output",
      archiveFailed: error instanceof Error ? error.message : String(error),
      originalChars: value.length,
      preview: value.slice(0, LAST_FULL_OUTPUT_PREVIEW_CHARS),
    });
    compacted.push(block);
  }
  return compacted;
}

async function compactLastFullOutput(context: TuiContext): Promise<void> {
  const value = context.lastFullOutput;
  if (!value || value.length <= MAX_LAST_FULL_OUTPUT_CHARS || isCompactedOutputText(value)) return;
  const artifact = await writeOutputArtifact(context, value);
  if (context.lastFullOutput !== value) return;
  context.lastFullOutput = buildCompactedOutputSummary({
    tag: "persisted-tui-output",
    relativePath: artifact.relativePath,
    originalChars: value.length,
    sha256: artifact.sha256,
    preview: value.slice(0, LAST_FULL_OUTPUT_PREVIEW_CHARS),
  });
}

function compactLastFullOutputInMemory(context: TuiContext, error: unknown): void {
  const value = context.lastFullOutput;
  if (!value || value.length <= MAX_LAST_FULL_OUTPUT_CHARS || isCompactedOutputText(value)) return;
  context.lastFullOutput = buildCompactedOutputSummary({
    tag: "compacted-tui-output",
    archiveFailed: error instanceof Error ? error.message : String(error),
    originalChars: value.length,
    preview: value.slice(0, LAST_FULL_OUTPUT_PREVIEW_CHARS),
  });
}

async function writeOutputArtifact(
  context: TuiContext,
  text: string,
): Promise<{ relativePath: string; sha256: string }> {
  const sessionId = context.sessionId ?? "unsaved";
  const dir = join(
    context.projectPath,
    ".linghun",
    "session",
    OUTPUT_MEMORY_ARTIFACT_DIR,
    sessionId,
  );
  await mkdir(dir, { recursive: true });
  const sha256 = createHash("sha256").update(text).digest("hex");
  const path = join(dir, `${randomUUID()}-${sha256.slice(0, 12)}.txt`);
  await writeFile(path, text, "utf8");
  return {
    relativePath: relative(context.projectPath, path).replace(/\\/g, "/"),
    sha256,
  };
}

function buildCompactedOutputSummary(input: {
  tag: string;
  relativePath?: string;
  archiveFailed?: string;
  originalChars: number;
  sha256?: string;
  preview: string;
}): string {
  return [
    `<${input.tag}>`,
    input.relativePath ? `artifactPath: ${input.relativePath}` : "",
    input.archiveFailed ? `archiveFailed: ${input.archiveFailed}` : "",
    `originalChars: ${input.originalChars}`,
    input.sha256 ? `sha256: ${input.sha256}` : "",
    `previewChars: ${input.preview.length}`,
    "read: use the artifact path if you need the full TUI output.",
    "preview:",
    input.preview,
    input.originalChars > input.preview.length ? "..." : "",
    `</${input.tag}>`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function isCompactedOutputText(value: string): boolean {
  return (
    value.startsWith("<persisted-tui-output>") ||
    value.startsWith("<compacted-tui-output>") ||
    value.startsWith("<persisted-tui-block-output>") ||
    value.startsWith("<compacted-tui-block-output>")
  );
}

export function createTerminalFirstAssistantSink(
  output: Writable | undefined,
  options: TerminalFirstAssistantSinkOptions = {},
): TerminalFirstAssistantSink | undefined {
  if (process.env[TERMINAL_FIRST_TRANSCRIPT_ENV] === "0") return undefined;
  const nativeScrollback = isNativeScrollbackEnabled();
  if (!nativeScrollback) return undefined;
  if ((output as { isTTY?: boolean } | undefined)?.isTTY !== true) return undefined;
  const ttyOutput = output as Writable;
  let stagedText = "";
  let assistantMarkdownState = createTerminalFirstMarkdownState();
  // Plan B single ownership: history is written to terminal scrollback
  // synchronously at commit time and immediately spliced out of the Ink block
  // array by the caller's onFlush. No queue, no flush timing, no reflow/replay
  // state machine — the write path mirrors ceshi/scrollback-probe.mjs.
  const writeHistory = (text: string | undefined): boolean => {
    if (!text) return false;
    try {
      return insertTerminalHistoryText(ttyOutput, sanitizeDangerousTerminalControls(text), {
        frameTopRow: resolveOptionalOption(options.frameTopRow),
        viewportGeometry: resolveOptionalOption(options.viewportGeometry),
        terminalRows: resolveOptionalOption(options.rows),
      });
    } catch {
      return false;
    }
  };
  return {
    stageStableAssistantText(text: string): void {
      if (!text) return;
      stagedText += text;
    },
    commitStableAssistantText(_sourceCellId?: string, onFlush?: () => void): boolean {
      if (!stagedText) return true;
      const sourceText = stagedText;
      let rendered: string | undefined;
      const nextMarkdownState = { ...assistantMarkdownState };
      try {
        rendered = renderTerminalFirstAssistantText(sourceText, options, nextMarkdownState);
      } catch {
        stagedText = "";
        return false;
      }
      if (!writeHistory(rendered)) return false;
      assistantMarkdownState = nextMarkdownState;
      stagedText = "";
      onFlush?.();
      return true;
    },
    rollbackStableAssistantText(): void {
      stagedText = "";
    },
    resetAssistantStream(): void {
      stagedText = "";
      assistantMarkdownState = createTerminalFirstMarkdownState();
    },
    commitAssistantTurnBreak(): boolean {
      return writeHistory("\r\n");
    },
    commitStableTranscriptBlock(block: ProductBlockViewModel, onFlush?: () => void): boolean {
      if (!canRenderTerminalFirstStableBlock(block)) return false;
      let rendered: string | undefined;
      try {
        rendered = renderTerminalFirstStableBlock(block, options);
      } catch {
        return false;
      }
      if (!writeHistory(rendered)) return false;
      if (block.messageKind === "assistant_text") {
        writeHistory("\r\n");
      }
      onFlush?.();
      return true;
    },
    commitUserTranscriptBlock(block: ProductBlockViewModel, onFlush?: () => void): boolean {
      if (!canRenderTerminalFirstUserBlock(block)) return false;
      let rendered: string | undefined;
      try {
        rendered = renderTerminalFirstUserBlock(block, options);
      } catch {
        return false;
      }
      if (!writeHistory(rendered)) return false;
      onFlush?.();
      return true;
    },
  };
}

function canRenderTerminalFirstStableBlock(block: ProductBlockViewModel): boolean {
  const text = terminalFirstStableBlockText(block);
  if (!text) return false;
  return (
    block.messageKind === "assistant_text" ||
    block.messageKind === "tool_result_success" ||
    block.messageKind === "diagnostic" ||
    block.messageKind === "local_command_output" ||
    (block.kind === "command" && !block.messageKind)
  );
}

function renderTerminalFirstAssistantText(
  text: string,
  options: TerminalFirstAssistantSinkOptions,
  state?: TerminalFirstMarkdownState,
): string {
  const noColor = resolveOption(options.noColor, false);
  const columns = resolveTerminalFirstColumns(options);
  const wrapWidth = Math.max(8, Math.floor(columns));
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = state
    ? renderTerminalFirstMarkdownDeltaLines(normalized, noColor, wrapWidth, state)
    : renderPlainMarkdownLines(normalized, noColor, { wrapWidth });
  return withTerminalFirstRows(lines);
}

function renderTerminalFirstStableBlock(
  block: ProductBlockViewModel,
  options: TerminalFirstAssistantSinkOptions,
): string | undefined {
  const text = terminalFirstStableBlockText(block);
  if (!text) return undefined;
  const noColor = resolveOption(options.noColor, false);
  const columns = resolveTerminalFirstColumns(options);
  const wrapWidth = Math.max(8, Math.floor(columns));
  const messageKind = block.messageKind;
  if (block.kind === "command" && !messageKind) {
    return `${dimAnsi("\u276F ", noColor)}${cyanAnsi(text, noColor)}\r\n`;
  }
  if (messageKind === "assistant_text") {
    if (hasTerminalFirstCodeFence(text)) {
      const state = createTerminalFirstMarkdownState();
      return withTerminalFirstRows(renderTerminalFirstMarkdownDeltaLines(text, noColor, wrapWidth, state));
    }
    return renderTerminalFirstAssistantText(text, options);
  }
  if (messageKind === "tool_result_success") {
    const prefix = dimAnsi("  \u23BF  ", noColor);
    return renderPlainMarkdownLines(text, noColor, { wrapWidth: Math.max(8, wrapWidth - 6) })
      .map((line) => `${prefix}${line}`)
      .join("\n")
      .replace(/\n/g, "\r\n") + "\r\n\r\n";
  }
  if (messageKind === "diagnostic") {
    return renderPlainMarkdownLines(text, noColor, { diagnostic: true, wrapWidth })
      .join("\n")
      .replace(/\n/g, "\r\n") + "\r\n\r\n";
  }
  if (messageKind === "local_command_output") {
    const prefix = dimAnsi("  ⎿  ", noColor);
    return renderPlainMarkdownLines(text, noColor, { wrapWidth: Math.max(8, wrapWidth - 6) })
      .map((line) => `${prefix}${line}`)
      .join("\n")
      .replace(/\n/g, "\r\n") + "\r\n\r\n";
  }
  return undefined;
}

function terminalFirstStableBlockText(block: ProductBlockViewModel): string {
  const source = block.kind === "command" && !block.messageKind
    ? block.title
    : block.ctrlOCollapsed
      ? block.summary
      : (block.fullText ?? block.summary);
  return source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function canRenderTerminalFirstUserBlock(block: ProductBlockViewModel): boolean {
  const text = (block.fullText ?? block.title).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return block.messageKind === "user_text" && text.length > 0;
}

function renderTerminalFirstUserBlock(
  block: ProductBlockViewModel,
  options: TerminalFirstAssistantSinkOptions,
): string | undefined {
  if (block.messageKind !== "user_text") return undefined;
  const text = (block.fullText ?? block.title).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return undefined;
  const noColor = resolveOption(options.noColor, false);
  const columns = resolveTerminalFirstColumns(options);
  const wrapWidth = Math.max(8, Math.floor(columns) - 2);
  return withTerminalFirstTurnSpacing(
    renderPlainMarkdownLines(text, noColor, { wrapWidth }).map(
      (line, index) => `${index === 0 ? dimAnsi("│ ", noColor) : "  "}${line}`,
    ),
  );
}

function withTerminalFirstTurnSpacing(lines: string[]): string {
  const rendered = lines.join("\n").replace(/\n/g, "\r\n");
  return rendered ? `${rendered}\r\n\r\n` : "";
}

type TerminalFirstMarkdownState = {
  inCode: boolean;
  codeLang?: string;
  codeLineNumber: number;
};

function createTerminalFirstMarkdownState(): TerminalFirstMarkdownState {
  return { inCode: false, codeLineNumber: 1 };
}

function renderTerminalFirstMarkdownDeltaLines(
  text: string,
  noColor: boolean,
  wrapWidth: number,
  state: TerminalFirstMarkdownState,
): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  const hasTrailingNewline = text.endsWith("\n");
  const lineCount = hasTrailingNewline ? lines.length - 1 : lines.length;

  for (let index = 0; index < lineCount; index += 1) {
    const raw = lines[index] ?? "";
    const fence = raw.match(/^\s*```\s*([A-Za-z0-9_+-]*)\s*$/u);
    if (fence) {
      if (state.inCode) {
        out.push(dimAnsi("  +", noColor));
        state.inCode = false;
        state.codeLang = undefined;
        state.codeLineNumber = 1;
      } else {
        state.inCode = true;
        state.codeLang = fence[1] || undefined;
        state.codeLineNumber = 1;
        out.push(dimAnsi(`  +${state.codeLang ? ` ${state.codeLang}` : ""}`, noColor));
      }
      continue;
    }

    if (!state.inCode) {
      out.push(...renderPlainMarkdownLines(raw, noColor, { wrapWidth }));
      continue;
    }

    const isDiff = isDiffFenceLanguage(state.codeLang);
    const gutter = `${String(state.codeLineNumber).padStart(2, " ")} │ `;
    const bodyWidth = Math.max(8, wrapWidth - gutter.length - 2);
    const highlightedLine = highlightTerminalFirstCodeLine(raw, state.codeLang, noColor, bodyWidth);
    if (highlightedLine) {
      out.push(`${dimAnsi(gutter, noColor)}${highlightedLine}`);
      state.codeLineNumber += 1;
      continue;
    }
    const wrappedLines = wrapText(raw.length === 0 ? " " : raw, bodyWidth);
    wrappedLines.forEach((wrapped, wrappedIndex) => {
      const wrappedBody =
        isDiff && wrapped.startsWith("+") && !wrapped.startsWith("+++")
          ? greenAnsi(wrapped, noColor)
          : isDiff && wrapped.startsWith("-") && !wrapped.startsWith("---")
            ? redAnsi(wrapped, noColor)
            : dimAnsi(wrapped, noColor);
      const prefix = wrappedIndex === 0 ? gutter : " ".repeat(gutter.length);
      out.push(`${dimAnsi(prefix, noColor)}${wrappedBody}`);
    });
    state.codeLineNumber += 1;
  }

  return out;
}

function highlightTerminalFirstCodeLine(
  raw: string,
  lang: string | undefined,
  noColor: boolean,
  maxWidth: number,
): string | undefined {
  if (noColor || !lang || isDiffFenceLanguage(lang) || raw.length === 0) return undefined;
  try {
    const highlighted = highlight(raw, {
      language: lang,
      ignoreIllegals: true,
      theme: TERMINAL_FIRST_CODE_THEME,
    }).replace(/\n$/u, "");
    return displayWidth(stripAnsi(highlighted)) <= maxWidth ? highlighted : undefined;
  } catch {
    return undefined;
  }
}

function withTerminalFirstRows(lines: string[]): string {
  const rendered = lines.join("\n").replace(/\n/g, "\r\n");
  return rendered ? `${rendered}\r\n` : "";
}

function hasTerminalFirstCodeFence(text: string): boolean {
  return /^\s*```\s*(?!markdown\b|md\b)[A-Za-z0-9_+-]+\s*$/imu.test(text);
}

export function commitTerminalFirstUserBlock(
  sink: TerminalFirstAssistantSink | undefined,
  block: ProductBlockViewModel,
  onFlush?: () => void,
): boolean {
  // Plan B: commitUserTranscriptBlock writes to terminal scrollback and fires
  // onFlush synchronously on success, so this wrapper just forwards the result.
  return sink?.commitUserTranscriptBlock?.(block, onFlush) ?? false;
}

function dimAnsi(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `\x1B[2m${text}\x1B[0m`;
}

function cyanAnsi(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `\x1B[36m${text}\x1B[0m`;
}

function redAnsi(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `\x1B[31m${text}\x1B[0m`;
}

function greenAnsi(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `\x1B[32m${text}\x1B[0m`;
}

function ansiStyle(code: string, text: string): string {
  return `\x1B[${code}m${text}\x1B[0m`;
}

function resolveOption<T>(option: T | (() => T) | undefined, fallback: T): T {
  if (typeof option === "function") return (option as () => T)();
  return option ?? fallback;
}

function resolveTerminalFirstColumns(options: TerminalFirstAssistantSinkOptions): number {
  const columns = resolveOptionalOption(options.columns);
  if (typeof columns === "number") return columns;
  return resolveOptionalOption(options.viewportGeometry)?.width ?? 100;
}

function resolveOptionalOption<T>(option: T | (() => T) | undefined): T | undefined {
  if (typeof option === "function") return (option as () => T)();
  return option;
}

/**
 * Duck-typed helpers for assistant streaming. Ink shell 注入 ShellBlockOutput
 * 时走 begin/append/end 三段式，把每个 assistant_text_delta 累积到同一条
 * keep:true block；其他 Writable（plain TUI、MemoryOutput、tests）走原始
 * output.write 路径，保持非交互行为不变。
 */
export function beginAssistantStream(
  output: Writable,
  id: string,
  options: AssistantStreamOptions = {},
): void {
  const candidate = output as { beginAssistantStream?: (id: string, options?: AssistantStreamOptions) => void };
  if (typeof candidate.beginAssistantStream === "function") {
    candidate.beginAssistantStream(id, options);
  }
}

export function writeAssistantDelta(output: Writable, id: string, text: string): void {
  const candidate = output as { appendAssistantDelta?: (text: string, id?: string) => void };
  if (typeof candidate.appendAssistantDelta === "function") {
    candidate.appendAssistantDelta(text, id);
    return;
  }
  text = sanitizeFallbackVisibleText(output, text);
  if (!text) return;
  output.write(text);
}

export function endAssistantStream(output: Writable): void {
  const candidate = output as { endAssistantStream?: () => void };
  if (typeof candidate.endAssistantStream === "function") {
    candidate.endAssistantStream();
  }
}

export function cancelAssistantStream(output: Writable): void {
  const candidate = output as { cancelAssistantStream?: () => void };
  if (typeof candidate.cancelAssistantStream === "function") {
    candidate.cancelAssistantStream();
  }
}

/**
 * D.13V — Final Answer Gate retry 前调用，清空当前 streaming block 累计的
 * 违规原文与 lastFullOutput，避免 Ctrl+O/details 残留。Plain Writable / 测试
 * MemoryOutput 自动跳过（无 ShellBlockOutput 状态可清）。
 */
export function discardAssistantBlock(output: Writable, id: string): void {
  const candidate = output as { discardAssistantBlock?: (id: string) => void };
  if (typeof candidate.discardAssistantBlock === "function") {
    candidate.discardAssistantBlock(id);
  }
}

/**
 * D.13V — Final Answer Gate 本地降级时替换 streaming block 的 fullText 与
 * lastFullOutput 为安全文本（buildDowngradedFinalAnswer 输出）。
 */
export function replaceAssistantBlockContent(output: Writable, id: string, text: string): void {
  const candidate = output as {
    replaceAssistantBlockContent?: (id: string, text: string) => void;
  };
  if (typeof candidate.replaceAssistantBlockContent === "function") {
    candidate.replaceAssistantBlockContent(id, text);
  }
}

/**
 * D.13Q-UX Real Smoke Fix v3 — 写诊断正文。Ink shell 注入的 ShellBlockOutput
 * 命中 writeDiagnosticLine 走 messageKind=diagnostic 分支（dim/cyan，不红框）；
 * plain TUI / MemoryOutput / 其他 Writable 走 writeLine 兼容回退。
 */
export function writeDiagnosticLine(output: Writable, text: string): void {
  const candidate = output as { writeDiagnosticLine?: (text: string) => void };
  if (typeof candidate.writeDiagnosticLine === "function") {
    candidate.writeDiagnosticLine(text);
    return;
  }
  const sanitized = sanitizeFallbackVisibleText(output, text);
  if (sanitized) writeLine(output, sanitized);
}

/**
 * D.13Q-UX Real Smoke Fix v3 复核 — 写真实错误。Ink shell 注入的
 * ShellBlockOutput 命中 writeErrorLine 走 messageKind=tool_result_error /
 * kind=error / status=fail（红边卡 + fail marker）；plain TUI / MemoryOutput /
 * 其他 Writable 走 writeLine 兼容回退（正文文案保持一致）。
 *
 * 仅用于真实错误调用点：provider stream error / final no-tools provider error /
 * slash/tool catch / executeIndexIgnoreWritePlan ignore 写入失败。
 * 普通正文 / diagnostic / status 不要走这条路径。
 */
export type ErrorLineMetadata = {
  retrySeconds?: number;
  retryAttempt?: number;
  retryMax?: number;
  failureDomain?: "provider" | "request" | "tool";
  failureOutcome?: string;
  failureRequestTurnId?: string;
};

export function writeErrorLine(
  output: Writable,
  text: string,
  title?: string,
  metadata?: ErrorLineMetadata,
): void {
  const candidate = output as {
    writeErrorLine?: (text: string, title?: string, metadata?: ErrorLineMetadata) => void;
  };
  if (typeof candidate.writeErrorLine === "function") {
    candidate.writeErrorLine(text, title, metadata);
    return;
  }
  const sanitized = sanitizeFallbackVisibleText(output, text);
  if (sanitized) writeLine(output, sanitized);
}

export function writeLocalCommandOutputLine(output: Writable, text: string): void {
  const candidate = output as { writeLocalCommandOutputLine?: (text: string) => void };
  if (typeof candidate.writeLocalCommandOutputLine === "function") {
    candidate.writeLocalCommandOutputLine(text);
    return;
  }
  const sanitized = sanitizeFallbackVisibleText(output, text);
  if (sanitized) writeLine(output, sanitized);
}

export function writeStructuredToolOutput(
  output: Writable,
  structured: StructuredToolOutput,
  primaryText = structured.text,
): void {
  const candidate = output as {
    writeStructuredToolOutput?: (
      structured: StructuredToolOutput,
      primaryText?: string,
    ) => void;
  };
  if (typeof candidate.writeStructuredToolOutput === "function") {
    candidate.writeStructuredToolOutput(structured, primaryText);
    return;
  }
  const sanitized = sanitizeFallbackVisibleText(output, primaryText);
  if (sanitized) writeLine(output, sanitized);
}

function sanitizeFallbackVisibleText(output: Writable, text: string): string {
  const ownedOutput = output as Writable & {
    [FALLBACK_VISIBLE_TEXT_SANITIZER]?: ReturnType<typeof createAssistantPrimaryTextSanitizer>;
  };
  let sanitizer = ownedOutput[FALLBACK_VISIBLE_TEXT_SANITIZER];
  if (!sanitizer) {
    sanitizer = createAssistantPrimaryTextSanitizer("en-US", { terminalControlsOnly: true });
    ownedOutput[FALLBACK_VISIBLE_TEXT_SANITIZER] = sanitizer;
  }
  return sanitizer.push(text);
}

/**
 * 测试入口：构造一个 ShellBlockOutput 并暴露 begin/append/end + D.13V
 * discard/replace 操作，便于单测验证 streaming block / lastFullOutput 行为。
 */
export function createShellBlockOutputForTest(
  context: TuiContext,
  blocks: ProductBlockViewModel[],
  onWrite: () => void = () => {},
  terminalFirstAssistantSink?: TerminalFirstAssistantSink,
): Writable & {
  beginAssistantStream(id: string, options?: AssistantStreamOptions): void;
  appendAssistantDelta(text: string, id?: string): void;
  endAssistantStream(): void;
  cancelAssistantStream(): void;
  discardAssistantBlock(id: string): void;
  replaceAssistantBlockContent(id: string, text: string): void;
  writeLocalCommandOutputLine(text: string): void;
  writeStructuredToolOutput(structured: StructuredToolOutput, primaryText?: string): void;
  compactOutputMemory(options?: { projectMainScreen?: boolean }): Promise<{ beforeCount: number; afterCount: number }>;
} {
  return new ShellBlockOutput(context, blocks, onWrite, terminalFirstAssistantSink);
}
