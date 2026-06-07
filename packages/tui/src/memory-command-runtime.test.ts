import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { TuiContext } from "./index.js";
import { executeMemoryMutation } from "./memory-command-runtime.js";

describe("memory-command-runtime", () => {
  it("fails closed for unknown memory mutation actions", async () => {
    await expect(
      executeMemoryMutation({} as TuiContext, new MockWritable(), {
        action: "future-action",
      } as never),
    ).rejects.toThrow(/未知 memory mutation action/);
  });
});

class MockWritable extends Writable {
  _write(_chunk: Buffer | string, _encoding: string, callback: () => void): void {
    callback();
  }
}
