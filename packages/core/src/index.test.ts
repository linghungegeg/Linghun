import { describe, expect, it } from "vitest";
import { LinghunError } from "./index.js";

describe("LinghunError", () => {
  it("keeps readable error fields", () => {
    const error = new LinghunError({
      code: "TEST_ERROR",
      message: "测试错误",
      suggestion: "请检查输入。",
      recoverable: true,
    });

    expect(error.code).toBe("TEST_ERROR");
    expect(error.message).toBe("测试错误");
    expect(error.suggestion).toBe("请检查输入。");
    expect(error.recoverable).toBe(true);
  });
});
