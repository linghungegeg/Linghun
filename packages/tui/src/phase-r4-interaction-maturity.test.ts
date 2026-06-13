import { describe, expect, it } from "vitest";
import { computeGhostText, acceptGhostText } from "./ghost-text.js";
import { createPromptStash, toggleStash } from "./prompt-stash.js";
import { createUndoRing, undoRingPop, undoRingPush, undoRingReset } from "./undo-ring.js";
import type { EditBuffer } from "./shell/components/Composer.js";
import {
  detectTerminalEnvironment,
  generateSetupGuidance,
} from "./terminal-setup-runtime.js";
import { createGitBranchRuntime } from "./git-branch-runtime.js";

// ---------------------------------------------------------------------------
// Ghost Text
// ---------------------------------------------------------------------------

describe("R4 Ghost Text", () => {
  const candidates = [
    { slash: "/help", description: "Help" },
    { slash: "/history", description: "History" },
    { slash: "/exit", description: "Exit" },
    { slash: "/model", description: "Model" },
  ];

  it("returns suffix when single match", () => {
    expect(computeGhostText("/he", candidates)).toBe("lp");
  });

  it("returns undefined when multiple matches", () => {
    expect(computeGhostText("/h", candidates)).toBeUndefined();
  });

  it("returns undefined when no match", () => {
    expect(computeGhostText("/xyz", candidates)).toBeUndefined();
  });

  it("returns undefined for non-slash input", () => {
    expect(computeGhostText("hello", candidates)).toBeUndefined();
  });

  it("returns undefined when input has space (args)", () => {
    expect(computeGhostText("/help arg", candidates)).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(computeGhostText("", candidates)).toBeUndefined();
  });

  it("acceptGhostText appends ghost + space", () => {
    expect(acceptGhostText("/he", "lp")).toBe("/help ");
  });
});

// ---------------------------------------------------------------------------
// Prompt Stash
// ---------------------------------------------------------------------------

describe("R4 Prompt Stash", () => {
  it("stashes current text and returns empty buffer", () => {
    const stash = createPromptStash();
    const result = toggleStash(stash, "hello world");
    expect(result.bufferText).toBe("");
    expect(result.stash.text).toBe("hello world");
  });

  it("restores from stash when buffer is empty", () => {
    const stash = { text: "saved text" };
    const result = toggleStash(stash, "");
    expect(result.bufferText).toBe("saved text");
    expect(result.stash.text).toBeUndefined();
  });

  it("no-op when both empty", () => {
    const stash = createPromptStash();
    const result = toggleStash(stash, "");
    expect(result.bufferText).toBeUndefined();
  });

  it("overwrites stash with new text", () => {
    const stash = { text: "old" };
    const result = toggleStash(stash, "new text");
    expect(result.bufferText).toBe("");
    expect(result.stash.text).toBe("new text");
  });
});

// ---------------------------------------------------------------------------
// Undo Ring
// ---------------------------------------------------------------------------

describe("R4 Undo Ring", () => {
  const buf = (text: string): EditBuffer => ({
    chars: Array.from(text),
    cursor: text.length,
  });

  it("pushes and pops entries", () => {
    let ring = createUndoRing();
    ring = undoRingPush(ring, buf("a"), 0);
    ring = undoRingPush(ring, buf("ab"), 1000);
    ring = undoRingPush(ring, buf("abc"), 2000);
    const result = undoRingPop(ring);
    expect(result.buffer).toBeDefined();
    expect(result.buffer!.chars.join("")).toBe("ab");
  });

  it("debounces rapid pushes", () => {
    let ring = createUndoRing(50, 500);
    ring = undoRingPush(ring, buf("a"), 0);
    ring = undoRingPush(ring, buf("ab"), 100);
    ring = undoRingPush(ring, buf("abc"), 200);
    // All within 500ms debounce, should coalesce
    const result = undoRingPop(ring);
    // After pop, we should get undefined because all were coalesced into one entry
    expect(result.buffer).toBeUndefined();
  });

  it("pop returns undefined when ring is empty", () => {
    const ring = createUndoRing();
    const result = undoRingPop(ring);
    expect(result.buffer).toBeUndefined();
  });

  it("reset clears the ring", () => {
    let ring = createUndoRing();
    ring = undoRingPush(ring, buf("x"), 0);
    ring = undoRingReset(ring);
    const result = undoRingPop(ring);
    expect(result.buffer).toBeUndefined();
  });

  it("respects max size", () => {
    let ring = createUndoRing(3, 0); // no debounce, max 3 entries
    ring = undoRingPush(ring, buf("1"), 0);
    ring = undoRingPush(ring, buf("2"), 1000);
    ring = undoRingPush(ring, buf("3"), 2000);
    ring = undoRingPush(ring, buf("4"), 3000);
    // Should be able to pop at least 2 entries
    const pop1 = undoRingPop(ring);
    expect(pop1.buffer).toBeDefined();
    const pop2 = undoRingPop(pop1.ring);
    expect(pop2.buffer).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Terminal Setup
// ---------------------------------------------------------------------------

describe("R4 Terminal Setup Runtime", () => {
  it("detects terminal environment without crashing", () => {
    const env = detectTerminalEnvironment();
    expect(env.os).toMatch(/^(windows|macos|linux)$/);
    expect(env.terminal).toBeDefined();
    expect(env.shell).toBeDefined();
  });

  it("generates setup guidance", () => {
    const env = detectTerminalEnvironment();
    const guidance = generateSetupGuidance(env);
    expect(guidance.environment).toBe(env);
    expect(Array.isArray(guidance.recommendations)).toBe(true);
    expect(Array.isArray(guidance.configSnippets)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Git Branch Runtime
// ---------------------------------------------------------------------------

describe("R4 Git Branch Runtime", () => {
  it("creates runtime without crashing", async () => {
    const runtime = createGitBranchRuntime(process.cwd(), { intervalMs: 60000 });
    // Initial state is empty; refresh populates it
    const state = await runtime.refresh();
    expect(typeof state.branch === "string").toBe(true);
    runtime.dispose();
  });

  it("refresh returns state", async () => {
    const runtime = createGitBranchRuntime(process.cwd(), { intervalMs: 60000 });
    const state = await runtime.refresh();
    expect(typeof state.branch === "string" || state.branch === undefined).toBe(true);
    runtime.dispose();
  });

  it("handles non-git directory gracefully", async () => {
    const runtime = createGitBranchRuntime("/tmp/definitely-not-a-repo-12345", {
      intervalMs: 60000,
    });
    const state = await runtime.refresh();
    expect(state.branch).toBeUndefined();
    runtime.dispose();
  });
});
