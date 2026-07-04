import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, "..");

describe("terminal-first transcript phase 1 boundary", () => {
  it("keeps the current task transcript app-owned until the gated prototype exists", async () => {
    const shellApp = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    const terminalInteraction = await readFile(
      join(SRC_ROOT, "shell/terminal-interaction-runtime.ts"),
      "utf8",
    );

    expect(shellApp).toContain("<TranscriptViewport");
    expect(shellApp).toContain("<StreamingMarkdown");
    expect(shellApp).toContain("<MouseInputRouter");
    expect(shellApp).toContain('process.env.LINGHUN_TUI_MOUSE_SELECTION === "1"');
    expect(shellApp).toContain("selectionActive={mouseSelectionActive}");
    expect(terminalInteraction).toContain('env.LINGHUN_TUI_MOUSE === "1"');
    expect(terminalInteraction).toContain("appOwnedScreen");
  });

  it("keeps the raw terminal-first ANSI sink on the native scrollback coexist path", async () => {
    const outputSurface = await readFile(join(SRC_ROOT, "tui-output-surface.ts"), "utf8");
    const index = await readFile(join(SRC_ROOT, "index.ts"), "utf8");
    const viewModel = await readFile(join(SRC_ROOT, "shell/view-model.ts"), "utf8");
    const shellApp = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");

    expect(outputSurface).toContain("createTerminalFirstAssistantSink");
    expect(outputSurface).toContain("isNativeScrollbackEnabled()");
    expect(outputSurface).toContain('process.env[TERMINAL_FIRST_TRANSCRIPT_ENV] === "0"');
    expect(outputSurface).toContain('env[NATIVE_SCROLLBACK_ENV] !== "0"');
    expect(outputSurface).toContain("stageStableAssistantText");
    expect(outputSurface).toContain("commitStableAssistantText");
    expect(outputSurface).toContain("rollbackStableAssistantText");
    expect(outputSurface).toContain("commitStableTranscriptBlock");
    expect(outputSurface).toContain("commitUserTranscriptBlock");
    expect(outputSurface).toContain("insertTerminalHistoryText");
    expect(outputSurface).toContain("viewportGeometry");
    // Plan B single ownership: history is written synchronously at commit time
    // and spliced inline via onFlush. The queue / reflow / replay machinery is
    // physically removed, so guard that it does not creep back in.
    expect(outputSurface).not.toContain("replayFlushedHistoryForResize");
    expect(outputSurface).not.toContain("hasFlushedHistory");
    expect(outputSurface).not.toContain("renderFlushedHistoryForReplay");
    expect(outputSurface).not.toContain("flushPendingHistory");
    expect(outputSurface).not.toContain("markResizeReflowNeeded");
    expect(outputSurface).not.toContain("canFlushTerminalHistoryAtCurrentGeometry");
    expect(outputSurface).not.toContain("MAX_TERMINAL_FIRST_REPLAY_ENTRIES");
    expect(outputSurface).toContain('block.messageKind === "assistant_text"');
    expect(outputSurface).toContain('block.messageKind === "tool_result_success"');
    expect(outputSurface).toContain('messageKind === "diagnostic"');
    expect(outputSurface).toContain('messageKind === "local_command_output"');
    expect(outputSurface).toContain('block.kind === "command" && !block.messageKind');
    expect(outputSurface).toContain("renderPlainMarkdownLines");
    expect(outputSurface).toContain("const committed =");
    expect(outputSurface).toContain("return false");
    expect(index).toContain("createTerminalFirstAssistantSink(output,");
    // Plan B single ownership: the sink derives its frame-top geometry fresh at
    // commit time from the live view model, not from the beforeRender-set
    // context geometry — this removes the timing dependency behind 病根2.
    expect(index).toContain("nativeScrollbackTaskHistoryGeometry(controller.getViewModel())");
    expect(index).toContain("transcriptSource: () => context.transcriptSource");
    // Plan B: history is written synchronously at commit time, so there is no
    // beforeRender flush pump and no resize replay wiring anymore.
    expect(index).not.toContain("flushPendingHistory");
    expect(index).not.toContain("markResizeReflowNeeded");
    expect(index).not.toContain("beforeNativeScrollbackResizeReflow");
    expect(index).toContain("function appendTranscriptSourceBlock(context: TuiContext");
    expect(index).toContain("context.pushTranscriptBlock = (block) => {");
    expect(index).toContain("appendTranscriptSourceBlock(context, block)");
    expect(index).not.toContain("function promoteTerminalFlushedBlocks(");
    expect(index).not.toContain("promoteTerminalFlushedBlocks(context, blocks)");
    expect(viewModel).toContain("staticHistoryBlocks");
    expect(viewModel).not.toContain("shouldFilterTerminalOwnedBlocks()");
    expect(viewModel).not.toContain("TERMINAL_OWNED_FILTER_ENV");
    expect(viewModel).not.toContain("findLatestTerminalOwnedUserId");
    expect(viewModel).not.toContain("latestTerminalOwnedUserId");
    expect(shellApp).toContain("mergeTranscriptBlocks");
    expect(shellApp).not.toContain("nativeEchoBlocks");
    expect(shellApp).not.toContain("selectNativeScrollbackEchoBlocks");
  });

  it("clears the transient frame once before native task transcript ownership starts", async () => {
    const inkRenderer = await readFile(join(SRC_ROOT, "shell/ink-renderer.tsx"), "utf8");
    const index = await readFile(join(SRC_ROOT, "index.ts"), "utf8");

    expect(inkRenderer).toContain("clearTransientFrame");
    expect(inkRenderer).toContain("beforeClearTransientFrame");
    expect(inkRenderer).not.toContain('"\\x1B[2J\\x1B[3J\\x1B[H"');
    const resizeStart = inkRenderer.indexOf("const onResize = () =>");
    expect(resizeStart).toBeGreaterThan(0);
    const resizeEnd = inkRenderer.indexOf("};", resizeStart + 30);
    const resizeBody = inkRenderer.slice(resizeStart, resizeEnd);
    expect(resizeBody).not.toContain('"\\x1B[2J\\x1B[3J\\x1B[H"');
    expect(index).toContain("transientFrameCleared");
    expect(index).toContain("shell?.clearTransientFrame()");
    expect(index).not.toContain("beforeClearTransientFrame: () => terminalFirstSink?.clearHistory?.()");
    expect(index).not.toContain("clearTranscriptSource");
  });

  it("keeps native scrollback on the default non-app-owned path without app-owned wheel tracking", async () => {
    const inkRenderer = await readFile(join(SRC_ROOT, "shell/ink-renderer.tsx"), "utf8");
    const terminalInteraction = await readFile(
      join(SRC_ROOT, "shell/terminal-interaction-runtime.ts"),
      "utf8",
    );

    expect(inkRenderer).toContain('process.env.LINGHUN_TUI_PLAIN === "1"');
    expect(inkRenderer).toContain("resolveAlternateScreen(capability)");
    expect(inkRenderer).toContain("isNativeScrollbackEnabled()");
    expect(terminalInteraction).toContain('env.LINGHUN_TUI_MOUSE === "1"');
    expect(terminalInteraction).toContain("appOwnedScreen");
    expect(terminalInteraction).toContain("appOwnedInteractive");
    expect(terminalInteraction).toContain("mouseTracking");
  });

  it("keeps the default native scrollback task layout in a bottom frame without Ink owning finalized transcript", async () => {
    const shellApp = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");

    expect(shellApp).toContain("height={frameHeight}");
    expect(shellApp).toContain("terminalFrameTop");
    expect(shellApp).toContain("nativeScrollbackTaskFrameHeight");
    expect(shellApp).toContain("flexGrow={1}");
    expect(shellApp).toContain("wheelActive={wheelRouterActive}");
    expect(shellApp).toContain("mouseActive={appOwnedScreen}");
    expect(shellApp).toContain("const visibleTranscriptBlocks = normalScreenNativeScrollback");
    // Plan A single ownership: committed blocks are physically removed from
    // view.blocks, so ShellApp no longer filters by terminalOwned.
    expect(shellApp).not.toContain("block.terminalOwned !== true");
    expect(shellApp).toContain(
      "const transcriptBlocks = mergeTranscriptBlocks(view.staticHistoryBlocks ?? [], view.blocks)",
    );
    expect(shellApp).not.toContain("shouldFilterTerminalOwnedStaticHistory");
    expect(shellApp).not.toContain("nativeScrollbackMainScreen");
  });

  it("keeps first-delta observability in request activity state, not provider events", async () => {
    const modelStream = await readFile(join(SRC_ROOT, "model-stream-runtime.ts"), "utf8");
    const runtimeStatus = await readFile(join(SRC_ROOT, "runtime-status-snapshot.ts"), "utf8");

    expect(modelStream).toContain("recordRequestFirstDelta");
    expect(modelStream).toContain("firstDeltaMs");
    expect(runtimeStatus).toContain("formatModelRequestTiming");
    expect(runtimeStatus).toContain("firstDeltaType");
  });

  it("keeps provider warmup as DNS-only interactive startup work", async () => {
    const index = await readFile(join(SRC_ROOT, "index.ts"), "utf8");
    const warmup = await readFile(join(SRC_ROOT, "provider-network-warmup.ts"), "utf8");

    expect(index).toContain("shouldWarmProviderDnsForStreams(input, output)");
    expect(index).toContain("warmConfiguredProviderDns(context.config)");
    expect(warmup).toContain("return readIsTty(input) && readIsTty(output)");
    expect(warmup).toContain(".isTTY === true");
    expect(warmup).toContain('url.protocol !== "http:" && url.protocol !== "https:"');
    expect(warmup).toContain("lookup(hostname)");
    expect(warmup).not.toContain("fetch(");
    expect(warmup).not.toContain("apiKey");
  });

  it("shares markdown stability boundaries between streaming render and stable queues", async () => {
    const messageMarkdown = await readFile(
      join(SRC_ROOT, "shell/components/MessageMarkdown.tsx"),
      "utf8",
    );
    const streamState = await readFile(
      join(SRC_ROOT, "shell/models/streaming-transcript-state.ts"),
      "utf8",
    );

    expect(messageMarkdown).toContain("findStableMarkdownPrefixLength");
    expect(streamState).toContain("findStableMarkdownLinePrefixLength");
  });
});
