// D.14D-R2 P3-1 — code-fact pre-gate narrowing.
//
// 验证"代码事实前置 gate"只在用户对**当前仓库已有事实**下结论/确认时触发取证；
// 对"从零写新代码/示例/教学/新文件草稿"不前置取证（写入仍走权限）。
// 不恢复本地自然语言关键词截获——这里只检查 gate 触发范围。

import { describe, expect, it } from "vitest";
import { isCurrentRepoFactClaimRequest } from "./final-answer-gate.js";

describe("D.14D-R2 P3-1 code-fact pre-gate trigger scope", () => {
  describe("from-scratch authoring is NOT gated", () => {
    const allowed = [
      "写一个 add 函数",
      "帮我写个快排函数",
      "实现一个防抖工具函数",
      "write an add function",
      "create a small debounce utility",
      "give me an example React component",
      "在当前项目里新增一个组件", // authoring with location word, still not a fact claim
      "新增一个 Button 组件",
    ];
    for (const text of allowed) {
      it(`"${text}" → no pre-gate`, () => {
        expect(isCurrentRepoFactClaimRequest(text)).toBe(false);
      });
    }
  });

  describe("current-repo fact claims ARE gated", () => {
    const gated = [
      "这个仓库里 add 函数已经实现了吗",
      "当前项目里有没有实现防抖函数",
      "确认所有测试通过",
      "已经完成了吗",
      "架构是不是一致的，没有漂移吧",
      "is the add function already implemented in the code",
      "confirm all tests are passing",
      "did you verify the fix is completed",
    ];
    for (const text of gated) {
      it(`"${text}" → pre-gate (require evidence)`, () => {
        expect(isCurrentRepoFactClaimRequest(text)).toBe(true);
      });
    }
  });

  describe("current-repo edit requests enter the model/tool path; write still needs evidence + permission", () => {
    const allowed = [
      "修复当前仓库里的这个 bug",
      "重构现有的 add 函数",
      "fix the existing function in this file",
      "refactor the current module",
    ];
    for (const text of allowed) {
      it(`"${text}" → no input-side pre-gate`, () => {
        expect(isCurrentRepoFactClaimRequest(text)).toBe(false);
      });
    }
  });
});
