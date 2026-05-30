import { Writable } from "node:stream";
import type { TuiContext } from "./index.js";
import type { ProductBlockViewModel } from "./shell/types.js";
import { createOutputBlock } from "./shell/view-model.js";
import { writeLine } from "./startup-runtime.js";

function isRuntimeStatusDump(line: string): boolean {
  if (line.startsWith("[Linghun] 会话 ")) return true;
  if (line.startsWith("Status: Session ")) return true;
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

  constructor(
    private readonly context: TuiContext,
    private readonly blocks: ProductBlockViewModel[],
    private readonly onWrite: () => void,
  ) {
    super();
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    const text = chunk.toString();
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
      this.blocks.push(createOutputBlock(normalized, this.context.language));
      // 缓存"最近一次普通 writeLine 的完整正文"，让 /details 默认分支可以展开
      // 长正文（如 /model doctor 的 provider.env merge / providers / endpointPath
      // 等多行 body）。/details 自身不能覆盖这条记录，否则连续 /details 会陷入
      // 套娃；handleDetailsCommand 在执行期间设置 suppressLastFullOutputCapture
      // 标记位跳过缓存。
      if (!this.context.suppressLastFullOutputCapture) {
        this.context.lastFullOutput = normalized;
      }
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

  /**
   * 注册一条 assistant streaming block id，但 **不立即** 推入 blocks 数组。
   * 真正的 keep:true block 在第一次 appendAssistantDelta 收到非空文本时才创建
   * （ensureAssistantBlock）。这样在 thinking-only / 空响应 / 慢请求等场景下，
   * 主屏不会出现一条空 block 渲染成"没有可见输出。"占位行 —— 等待态由
   * requestActivityPhase / mapRequestActivityToView 驱动的 ActivityIndicator
   * 单独负责（"正在思考…" / "Thinking…"）。
   *
   * id 由调用方传入（每个 request 用一个稳定 id），便于多轮请求各自占用
   * 独立 block，互不覆盖。
   */
  beginAssistantStream(id: string): void {
    this.assistantBlockId = id;
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
   * 将一段 assistant_text_delta 追加到当前 streaming block。
   * - 第一次收到非空 delta 时才创建 keep:true block（避免空占位行）
   * - fullText 累计完整正文
   * - summary 取累计正文的首个非空行
   * - 找不到 active id 时静默 fallback 到 _write，保持非交互回退
   */
  appendAssistantDelta(text: string): void {
    if (!text) return;
    const id = this.assistantBlockId;
    if (!id) {
      this._write(text, "utf8", () => {});
      return;
    }
    const block = this.ensureAssistantBlock(id);
    if (!block) {
      this.assistantBlockId = undefined;
      this._write(text, "utf8", () => {});
      return;
    }
    const nextFull = `${block.fullText ?? ""}${text}`;
    const firstLine = nextFull.split("\n").find((line) => line.trim()) ?? nextFull;
    block.fullText = nextFull;
    block.summary = firstLine || block.summary;
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = nextFull;
    }
    this.onWrite();
  }

  /**
   * 结束当前 streaming block 的 active 状态。block 保留在 this.blocks
   * 中作为 transcript row（keep:true 已确保 view-model 不会 slice 它），
   * 只清掉 active id，下一轮 beginAssistantStream 会换新 id。
   */
  endAssistantStream(): void {
    this.assistantBlockId = undefined;
    this.onWrite();
  }

  /**
   * D.13V — Final Answer Gate 在 retry 前丢弃当前 streaming block 的全部累计
   * 内容。保留 active id，让接下来的 delta 可以重新填回同一条 block；
   * 同时清掉 lastFullOutput 中可能残留的违规原文，避免 Ctrl+O / details 拉到。
   */
  discardAssistantBlock(id: string): void {
    const block = this.blocks.find((b) => b.id === id);
    if (block) {
      block.fullText = "";
      block.summary = "";
    }
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
    const block = this.blocks.find((b) => b.id === id);
    if (block) {
      block.fullText = text;
      const firstLine = text.split("\n").find((line) => line.trim()) ?? text;
      block.summary = firstLine || block.summary;
    }
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = text;
    }
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
    const normalized = text.replace(/\r/g, "").trim();
    if (!normalized) return;
    const firstLine = normalized.split("\n").find((line) => line.trim()) ?? normalized;
    const nonEmptyLines = normalized.split("\n").filter((line) => line.trim().length > 0).length;
    const hasMore =
      normalized.length > 0 && (nonEmptyLines >= 2 || normalized.length > firstLine.length + 16);
    const detailsHint =
      this.context.language === "en-US" ? "Ctrl+O for details" : "Ctrl+O 查看完整内容";
    this.blocks.push({
      id: `diag-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      kind: "details",
      status: "info",
      title: "",
      summary: firstLine,
      fullText: normalized,
      nextAction: hasMore ? detailsHint : undefined,
      messageKind: "diagnostic",
    });
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = normalized;
    }
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
  writeErrorLine(text: string, title?: string): void {
    const normalized = text.replace(/\r/g, "").trim();
    if (!normalized) return;
    const firstLine = normalized.split("\n").find((line) => line.trim()) ?? normalized;
    const nonEmptyLines = normalized.split("\n").filter((line) => line.trim().length > 0).length;
    const hasMore =
      normalized.length > 0 && (nonEmptyLines >= 2 || normalized.length > firstLine.length + 16);
    const errorHint =
      this.context.language === "en-US" ? "Ctrl+O for full error" : "Ctrl+O 查看完整错误";
    this.blocks.push({
      id: `err-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      kind: "error",
      status: "fail",
      title: title ?? (this.context.language === "en-US" ? "output failed" : "output 失败"),
      summary: firstLine,
      fullText: normalized,
      nextAction: hasMore ? errorHint : undefined,
      messageKind: "tool_result_error",
    });
    if (!this.context.suppressLastFullOutputCapture) {
      this.context.lastFullOutput = normalized;
    }
    this.onWrite();
  }
}

/**
 * Duck-typed helpers for assistant streaming. Ink shell 注入 ShellBlockOutput
 * 时走 begin/append/end 三段式，把每个 assistant_text_delta 累积到同一条
 * keep:true block；其他 Writable（plain TUI、MemoryOutput、tests）走原始
 * output.write 路径，保持非交互行为不变。
 */
export function beginAssistantStream(output: Writable, id: string): void {
  const candidate = output as { beginAssistantStream?: (id: string) => void };
  if (typeof candidate.beginAssistantStream === "function") {
    candidate.beginAssistantStream(id);
  }
}

export function writeAssistantDelta(output: Writable, _id: string, text: string): void {
  if (!text) return;
  const candidate = output as { appendAssistantDelta?: (text: string) => void };
  if (typeof candidate.appendAssistantDelta === "function") {
    candidate.appendAssistantDelta(text);
    return;
  }
  output.write(text);
}

export function endAssistantStream(output: Writable): void {
  const candidate = output as { endAssistantStream?: () => void };
  if (typeof candidate.endAssistantStream === "function") {
    candidate.endAssistantStream();
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
  writeLine(output, text);
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
export function writeErrorLine(output: Writable, text: string, title?: string): void {
  const candidate = output as { writeErrorLine?: (text: string, title?: string) => void };
  if (typeof candidate.writeErrorLine === "function") {
    candidate.writeErrorLine(text, title);
    return;
  }
  writeLine(output, text);
}

/**
 * 测试入口：构造一个 ShellBlockOutput 并暴露 begin/append/end + D.13V
 * discard/replace 操作，便于单测验证 streaming block / lastFullOutput 行为。
 */
export function createShellBlockOutputForTest(
  context: TuiContext,
  blocks: ProductBlockViewModel[],
  onWrite: () => void = () => {},
): Writable & {
  beginAssistantStream(id: string): void;
  appendAssistantDelta(text: string): void;
  endAssistantStream(): void;
  discardAssistantBlock(id: string): void;
  replaceAssistantBlockContent(id: string, text: string): void;
} {
  return new ShellBlockOutput(context, blocks, onWrite);
}
