import { describe, expect, it } from "vitest";
import {
  buildFooterView,
  formatFooterCacheLabel,
  formatFooterIndexLabel,
  formatFooterModelLabel,
  formatFooterReasoningLabel,
} from "./footer-view.js";

describe("footer-view: model label setup-needed dim", () => {
  it("setup-needed=true 时 model 段返回 dim '--' 占位", () => {
    const result = formatFooterModelLabel("zh-CN", "deepseek-chat", true, 120);
    expect(result.dim).toBe(true);
    expect(result.text).toContain("--");
  });

  it("空 model 名时显 dim '--'", () => {
    const result = formatFooterModelLabel("zh-CN", "", false, 120);
    expect(result.dim).toBe(true);
  });

  it("正常 model 名不 dim", () => {
    const result = formatFooterModelLabel("zh-CN", "claude-3.5-sonnet", false, 120);
    expect(result.dim).toBe(false);
    expect(result.text).toContain("claude-3.5-sonnet");
  });

  it("placeholder 'openai-compatible-model' 视为占位，dim '--'", () => {
    const result = formatFooterModelLabel("en-US", "openai-compatible-model", false, 120);
    expect(result.dim).toBe(true);
    expect(result.text).toContain("--");
  });
});

describe("footer-view: cache hit rate tone", () => {
  it("hitRate=null → tone=dim", () => {
    expect(formatFooterCacheLabel("zh-CN", null).tone).toBe("dim");
  });

  it("hitRate=0.9 → tone=default", () => {
    expect(formatFooterCacheLabel("zh-CN", 0.9).tone).toBe("default");
  });

  it("hitRate=0.4 → tone=warning（命中率偏低）", () => {
    expect(formatFooterCacheLabel("zh-CN", 0.4).tone).toBe("warning");
  });
});

describe("footer-view: index status placeholder", () => {
  it("'unknown' / 空字符串显示 ?-suffix", () => {
    expect(formatFooterIndexLabel("zh-CN", "")).toContain("?");
    expect(formatFooterIndexLabel("zh-CN", "unknown")).toContain("?");
  });

  it("正常 status 显示完整标签", () => {
    expect(formatFooterIndexLabel("zh-CN", "ready")).toContain("ready");
  });
});

describe("footer-view: reasoning level only when sent", () => {
  it("sent=false → 不显示 reasoning 段", () => {
    expect(formatFooterReasoningLabel("zh-CN", "High", false)).toBeUndefined();
  });

  it("sent=true 且 level 非空 → 显示", () => {
    expect(formatFooterReasoningLabel("zh-CN", "High", true)).toContain("推理");
  });

  it("level 空字符串 → undefined", () => {
    expect(formatFooterReasoningLabel("zh-CN", "", true)).toBeUndefined();
  });
});

describe("buildFooterView: 整合", () => {
  it("setupNeeded + cache 低命中 + index unknown 共同生效", () => {
    const result = buildFooterView({
      language: "zh-CN",
      width: 120,
      permissionModeLabel: "默认模式",
      cyclePermHint: "（Shift+Tab 切换模式）",
      effectiveModel: "deepseek-chat",
      setupNeeded: true,
      cacheHitRate: 0.3,
      indexStatus: "unknown",
    });
    expect(result.modelDim).toBe(true);
    expect(result.cacheTone).toBe("warning");
    expect(result.view.index).toContain("?");
  });
});
