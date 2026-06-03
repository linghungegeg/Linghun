import { describe, expect, it } from "vitest";
import {
  type EditBuffer,
  bufferBackspace,
  bufferDelete,
  bufferDeleteWordLeft,
  bufferEnd,
  bufferHome,
  bufferInsert,
  bufferKillToEnd,
  bufferMoveDown,
  bufferMoveLeft,
  bufferMoveRight,
  bufferMoveUp,
  bufferMoveVisualDown,
  bufferMoveVisualUp,
  bufferToString,
  bufferWordLeft,
  bufferWordRight,
  createEditBuffer,
  createInputHistory,
  formatComposerRenderLines,
  historyAdd,
  historyCurrentText,
  historyDown,
  historyUp,
  isDoublePressWithin,
  isMultilineEnterSequence,
  sanitizeComposerInput,
  shouldEnterPastePath,
  shouldUnstickSlashHidden,
  splitLineAtDisplayCol,
} from "./Composer.js";

// ---------------------------------------------------------------------------
// 基础 EditBuffer 已有专门测试覆盖于 Composer.test.ts；本文件只补本次新增的
// owner-priority dispatcher 行为：粘贴聚合判定、双击窗口、slash 粘性、
// CJK 换行 / 单词跳跃 / Ctrl+B/F 等价 / 多行 ↑↓ vs 历史。
// ---------------------------------------------------------------------------

describe("Composer dispatcher behavior boundaries", () => {
  describe("paste path discrimination", () => {
    it("treats a >16-char single chunk as paste", () => {
      const longText = "a".repeat(20);
      expect(shouldEnterPastePath(longText, {}, false)).toBe(true);
    });

    it("does not treat normal single key as paste when not pending", () => {
      expect(shouldEnterPastePath("a", {}, false)).toBe(false);
      expect(shouldEnterPastePath("h", {}, false)).toBe(false);
    });

    it("keeps subsequent chunks inside paste path while pending", () => {
      // pendingRef=true → 后续即便短 chunk 也继续走粘贴聚合，避免提交时序错位。
      expect(shouldEnterPastePath("xy", {}, true)).toBe(true);
      expect(shouldEnterPastePath(".", {}, true)).toBe(true);
    });

    it("never treats Enter / Esc / Tab / Ctrl-* as paste even while pending", () => {
      expect(shouldEnterPastePath("\r", { return: true }, true)).toBe(false);
      expect(shouldEnterPastePath("", { escape: true }, true)).toBe(false);
      expect(shouldEnterPastePath("\t", { tab: true }, true)).toBe(false);
      expect(shouldEnterPastePath("c", { ctrl: true }, true)).toBe(false);
      expect(shouldEnterPastePath("v", { ctrl: true }, true)).toBe(false);
    });

    it("ignores empty input even while pending", () => {
      expect(shouldEnterPastePath("", {}, true)).toBe(false);
    });
  });

  describe("double-press window (Esc / Ctrl+C clear)", () => {
    it("first press has no last timestamp → not double-press", () => {
      expect(isDoublePressWithin(0, 1000)).toBe(false);
    });

    it("second press within 1s of last → double-press", () => {
      expect(isDoublePressWithin(500, 1000)).toBe(true);
    });

    it("second press outside 1s window → not double-press", () => {
      expect(isDoublePressWithin(500, 2000)).toBe(false);
    });

    it("respects custom window override", () => {
      expect(isDoublePressWithin(0, 100, 500)).toBe(false);
      expect(isDoublePressWithin(50, 100, 500)).toBe(true);
      expect(isDoublePressWithin(50, 700, 500)).toBe(false);
    });
  });

  describe("slash hidden stickiness", () => {
    it("unsticks when text no longer starts with /", () => {
      expect(shouldUnstickSlashHidden("/m", "m", "m")).toBe(true);
    });

    it("unsticks when slash head changes", () => {
      expect(shouldUnstickSlashHidden("/m", "/me", "/me")).toBe(true);
      expect(shouldUnstickSlashHidden("/help", "/h", "/h")).toBe(true);
    });

    it("stays sticky when only args change but head unchanged", () => {
      expect(shouldUnstickSlashHidden("/help", "/help foo", "/help")).toBe(false);
      expect(shouldUnstickSlashHidden("/m", "/m baseUrl", "/m")).toBe(false);
    });
  });

  describe("EditBuffer multiline ↑↓ keeps column", () => {
    it("移动到上一行保留列位置（CJK 列对齐）", () => {
      // "你好\nworld"，char-unit cursor 编号：你=0 好=1 \n=2 w=3 o=4 r=5。
      // cursor=5 → row=1 col=2（在 'wo' 之后）。
      let buf = createEditBuffer("你好\nworld");
      buf = { ...buf, cursor: 5 };
      const up = bufferMoveUp(buf);
      // 上一行 col=2 → '你好' 之后 → cursor=2
      expect(bufferToString(up)).toBe("你好\nworld");
      expect(up.cursor).toBe(2);
    });

    it("光标在第 0 行 ↑ 不动（让上层走历史）", () => {
      const buf = createEditBuffer("hello world");
      const up = bufferMoveUp(buf);
      expect(up.cursor).toBe(buf.cursor);
    });

    it("光标在最后一行 ↓ 不动", () => {
      const buf = createEditBuffer("a\nb");
      const down = bufferMoveDown(buf);
      expect(down.cursor).toBe(buf.cursor);
    });

    it("长逻辑行按 soft-wrap 视觉行移动", () => {
      const buf = { ...createEditBuffer("abcdefghij"), cursor: 8 };
      const up = bufferMoveVisualUp(buf, 8);
      expect(up.cursor).toBe(2);
      const down = bufferMoveVisualDown(up, 8);
      expect(down.cursor).toBe(8);
    });

    it("光标刚好在 soft-wrap 下一视觉行开头时归属下一行", () => {
      const buf = { ...createEditBuffer("abcdefghij"), cursor: 6 };
      const up = bufferMoveVisualUp(buf, 8);
      expect(up.cursor).toBe(0);
      const down = bufferMoveVisualDown(up, 8);
      expect(down.cursor).toBe(6);
    });

    it("光标在逻辑行尾时仍可向下进入下一逻辑行", () => {
      const buf = { ...createEditBuffer("abc\ndef"), cursor: 3 };
      const down = bufferMoveVisualDown(buf, 80);
      expect(down.cursor).toBe(7);
      const up = bufferMoveVisualUp(down, 80);
      expect(up.cursor).toBe(3);
    });

    it("中文宽字符按视觉列移动", () => {
      const buf = { ...createEditBuffer("你好世界abc"), cursor: 4 };
      const up = bufferMoveVisualUp(buf, 8);
      expect(up.cursor).toBe(1);
      const down = bufferMoveVisualDown(up, 8);
      expect(down.cursor).toBe(4);
    });
  });

  describe("EditBuffer Ctrl+B/F semantics equivalent to ←/→ (one char)", () => {
    it("逐字符左右移动（包含 CJK 与组合 emoji）", () => {
      const buf = createEditBuffer("你好");
      expect(bufferMoveLeft(buf).cursor).toBe(1);
      expect(bufferMoveLeft(bufferMoveLeft(buf)).cursor).toBe(0);
      const home = bufferHome(buf);
      expect(bufferMoveRight(home).cursor).toBe(1);
    });
  });

  describe("EditBuffer word jump (Ctrl/Meta + arrow)", () => {
    it("Word left jumps over punctuation/space", () => {
      const buf = createEditBuffer("hello world.foo");
      const end = bufferEnd(buf);
      expect(bufferWordLeft(end).cursor).toBe(12); // before "foo"
    });

    it("Word right jumps past trailing space", () => {
      const buf = createEditBuffer("hello world");
      const home = bufferHome(buf);
      const next = bufferWordRight(home);
      expect(next.cursor).toBe(6); // past "hello "
    });

    it("Ctrl+W / Ctrl+Backspace 等价于删除前一个单词", () => {
      const buf = createEditBuffer("hello world");
      const end = bufferEnd(buf);
      const after = bufferDeleteWordLeft(end);
      expect(bufferToString(after)).toBe("hello ");
    });
  });

  describe("EditBuffer paste insertion on \\r→\\n", () => {
    it("插入多行字符串，光标位于末尾", () => {
      const buf = createEditBuffer("");
      const next = bufferInsert(buf, "line1\nline2\nline3");
      expect(bufferToString(next)).toBe("line1\nline2\nline3");
      expect(next.cursor).toBe(17);
    });

    it("插入到中间位置不破坏前后", () => {
      const buf = createEditBuffer("ab");
      const mid: EditBuffer = { ...buf, cursor: 1 };
      const next = bufferInsert(mid, "XY");
      expect(bufferToString(next)).toBe("aXYb");
      expect(next.cursor).toBe(3);
    });
  });

  describe("control sequence sanitation", () => {
    it("recognizes CSI-u / modifyOtherKeys newline sequences before sanitation", () => {
      expect(isMultilineEnterSequence("\x1B[13;2u")).toBe(true);
      expect(isMultilineEnterSequence("\x1B[10;3u")).toBe(true);
      expect(isMultilineEnterSequence("\x1B[57414;2u")).toBe(true);
      expect(isMultilineEnterSequence("\x1B[27;2;13~")).toBe(true);
      expect(isMultilineEnterSequence("\x1B[27;2;57414~")).toBe(true);
      expect(isMultilineEnterSequence("\x1B[1;2C")).toBe(false);
    });

    it("drops CSI/ANSI/special key sequences without touching normal text", () => {
      expect(sanitizeComposerInput("ab\x1B[200~cd\x1B[201~ef")).toBe("abcdef");
      expect(sanitizeComposerInput("a\x1B[5~b\x1B[1;2Cc")).toBe("abc");
      expect(sanitizeComposerInput("你好\x1B[31m世界\x1B[0m")).toBe("你好世界");
    });

    it("keeps real newlines and drops raw control bytes", () => {
      expect(sanitizeComposerInput("a\r\nb\x00\x7Fc")).toBe("a\nbc");
    });
  });

  describe("History up/down with multiline boundary integration", () => {
    it("空 history 时 ↑ 返回 undefined（保持当前 buffer 不变）", () => {
      const empty = createInputHistory();
      expect(historyUp(empty, "current")).toBeUndefined();
    });

    it("历史登记 + 上下浏览", () => {
      let h = createInputHistory();
      h = historyAdd(h, "first");
      h = historyAdd(h, "second");
      const up1 = historyUp(h, "draft");
      if (!up1) throw new Error("up1 should be defined");
      expect(historyCurrentText(up1)).toBe("second");
      const up2 = historyUp(up1, "draft");
      if (!up2) throw new Error("up2 should be defined");
      expect(historyCurrentText(up2)).toBe("first");
      const down1 = historyDown(up2);
      if (!down1) throw new Error("down1 should be defined");
      expect(historyCurrentText(down1)).toBe("second");
      const down2 = historyDown(down1);
      if (!down2) throw new Error("down2 should be defined");
      expect(historyCurrentText(down2)).toBeUndefined();
      expect(down2.draft).toBe("draft");
    });
  });

  describe("EditBuffer kill / clear", () => {
    it("Ctrl+K 删除从光标到行末（仅当前行）", () => {
      const buf = createEditBuffer("hello world");
      const mid: EditBuffer = { ...buf, cursor: 6 };
      const next = bufferKillToEnd(mid);
      expect(bufferToString(next)).toBe("hello ");
    });

    it("Backspace / Delete 单字符可逆删除（CJK 计 1 char unit）", () => {
      const buf = createEditBuffer("你好");
      const end = bufferEnd(buf);
      const back1 = bufferBackspace(end);
      expect(bufferToString(back1)).toBe("你");
      const home = bufferHome(buf);
      const del1 = bufferDelete(home);
      expect(bufferToString(del1)).toBe("好");
    });
  });

  // 真实 cursor 锚点 smoke：直接断言 formatComposerRenderLines 的 (row,col) 输出。
  // 这是 useAnchoredCursor 喂入 setCursorPosition 的源头；row/col 错则锚点错。
  describe("cursor anchor coordinates (formatComposerRenderLines)", () => {
    it("typing 'heet' → cursor at end-of-line (row=0, col=6 = '> '+'heet')", () => {
      const buf = bufferInsert(createEditBuffer(""), "heet");
      const r = formatComposerRenderLines({
        buffer: buf,
        placeholder: "",
        masking: false,
        noColor: true,
        maxWidth: 80,
      });
      expect(r.lines[0]).toBe("> heet");
      expect(r.cursorRow).toBe(0);
      expect(r.cursorCol).toBe(6);
      expect(r.truncatedAbove).toBe(0);
      expect(r.truncatedBelow).toBe(0);
    });

    it("empty buffer with placeholder → cursor at PROMPT_MARKER end (col=2)", () => {
      const r = formatComposerRenderLines({
        buffer: createEditBuffer(""),
        placeholder: "type here",
        masking: false,
        noColor: true,
        maxWidth: 80,
      });
      expect(r.cursorRow).toBe(0);
      expect(r.cursorCol).toBe(2);
    });

    it("multiline buffer → cursor row tracks EditBuffer line, col tracks display width", () => {
      // "abc\ndef" cursor=6 → row=1, col after prompt-cont width(2) + "de" width(2) = 4
      const buf: EditBuffer = { ...createEditBuffer("abc\ndef"), cursor: 6 };
      const r = formatComposerRenderLines({
        buffer: buf,
        placeholder: "",
        masking: false,
        noColor: true,
        maxWidth: 80,
      });
      expect(r.lines).toEqual(["> abc", "  def"]);
      expect(r.cursorRow).toBe(1);
      expect(r.cursorCol).toBe(4);
    });

    it("CJK in cursor line → col advances by 2 per fullwidth char", () => {
      // "你好" cursor=2（末尾） → row=0, col = '> '(2) + '你'(2) + '好'(2) = 6
      const buf = bufferInsert(createEditBuffer(""), "你好");
      const r = formatComposerRenderLines({
        buffer: buf,
        placeholder: "",
        masking: false,
        noColor: true,
        maxWidth: 80,
      });
      expect(r.lines[0]).toBe("> 你好");
      expect(r.cursorRow).toBe(0);
      expect(r.cursorCol).toBe(6);
    });

    it("masked buffer → cursor still at end, line is asterisks", () => {
      const buf = bufferInsert(createEditBuffer(""), "secret");
      const r = formatComposerRenderLines({
        buffer: buf,
        placeholder: "",
        masking: true,
        noColor: true,
        maxWidth: 80,
      });
      expect(r.lines[0]).toBe("> ******");
      expect(r.cursorCol).toBe(8);
    });

    it("very wide content with cursor at end → cursor lands inside viewport (no off-screen)", () => {
      // 60 'a' fits within maxWidth=80-(prompt 2)=78 budget; cursor at end col = 2 + 60 = 62
      const buf = bufferInsert(createEditBuffer(""), "a".repeat(60));
      const r = formatComposerRenderLines({
        buffer: buf,
        placeholder: "",
        masking: false,
        noColor: true,
        maxWidth: 80,
      });
      expect(r.cursorRow).toBe(0);
      expect(r.cursorCol).toBeLessThanOrEqual(80);
      expect(r.cursorCol).toBe(62);
    });

    it("narrow long content keeps cursor inside the rendered viewport", () => {
      const buf = bufferInsert(createEditBuffer(""), "abcdefghij".repeat(4));
      const r = formatComposerRenderLines({
        buffer: buf,
        placeholder: "",
        masking: false,
        noColor: true,
        maxWidth: 18,
      });

      expect(r.cursorRow).toBeGreaterThanOrEqual(0);
      expect(r.cursorRow).toBeLessThan(r.lines.length);
      expect(r.cursorCol).toBeGreaterThanOrEqual(0);
      expect(r.cursorCol).toBeLessThanOrEqual(18);
    });
  });

  describe("D.13Q-UX Task Surface — splitLineAtDisplayCol inline cursor", () => {
    it("拆分点在中间：before / cursorChar / after", () => {
      const r = splitLineAtDisplayCol("abcdef", 3);
      expect(r.before).toBe("abc");
      expect(r.cursorChar).toBe("d");
      expect(r.after).toBe("ef");
    });
    it("拆分点在行尾：before=full、cursorChar=空，避免视觉多空格", () => {
      const r = splitLineAtDisplayCol("abc", 3);
      expect(r.before).toBe("abc");
      expect(r.cursorChar).toBe("");
      expect(r.after).toBe("");
    });
    it("CJK 宽字符不被拆开：cursor 落在第二列时仍把整字当作 cursorChar", () => {
      const r = splitLineAtDisplayCol("中a", 1);
      expect(r.cursorChar).toBe("中");
      expect(r.after).toBe("a");
    });
  });
});
