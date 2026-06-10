import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import { flushStdout, writeSGRResetAndFlush, drainStdin } from "./stdout-flush-barrier.js";

describe("stdout-flush-barrier", () => {
  describe("flushStdout", () => {
    it("returns immediately if stdout is undefined", async () => {
      await expect(flushStdout(undefined)).resolves.toBeUndefined();
    });

    it("returns immediately if stdout is not TTY", async () => {
      const stdout = new Writable();
      (stdout as NodeJS.WriteStream).isTTY = false;
      await expect(flushStdout(stdout)).resolves.toBeUndefined();
    });

    it("returns immediately if stdout is destroyed", async () => {
      const stdout = new Writable();
      (stdout as NodeJS.WriteStream).isTTY = true;
      stdout.destroy();
      await expect(flushStdout(stdout)).resolves.toBeUndefined();
    });

    it("returns immediately if no buffered data", async () => {
      const stdout = new Writable({
        write: vi.fn((chunk, encoding, callback) => {
          if (typeof callback === "function") callback();
          return true;
        }),
      });
      (stdout as NodeJS.WriteStream).isTTY = true;
      Object.defineProperty(stdout, "writableLength", { value: 0 });

      await expect(flushStdout(stdout)).resolves.toBeUndefined();
    });

    it("waits for drain event when buffer is full", async () => {
      const stdout = new Writable({
        write: vi.fn((chunk, encoding, callback) => {
          setTimeout(() => {
            stdout.emit("drain");
            if (typeof callback === "function") callback();
          }, 10);
          return true;
        }),
      });
      (stdout as NodeJS.WriteStream).isTTY = true;
      Object.defineProperty(stdout, "writableLength", { value: 100 });

      const start = Date.now();
      await flushStdout(stdout);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(9);
      expect(elapsed).toBeLessThan(100); // Should not timeout
    });

    it("times out after 100ms if drain never fires", async () => {
      const stdout = new Writable({
        write: vi.fn((chunk, encoding, callback) => {
          // Never call callback or emit drain
          return true;
        }),
      });
      (stdout as NodeJS.WriteStream).isTTY = true;
      Object.defineProperty(stdout, "writableLength", { value: 100 });

      const start = Date.now();
      await flushStdout(stdout);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(99);
      expect(elapsed).toBeLessThan(150);
    });
  });

  describe("writeSGRResetAndFlush", () => {
    it("returns immediately if stdout is undefined", async () => {
      await expect(writeSGRResetAndFlush(undefined)).resolves.toBeUndefined();
    });

    it("returns immediately if stdout is not TTY", async () => {
      const stdout = new Writable();
      (stdout as NodeJS.WriteStream).isTTY = false;
      await expect(writeSGRResetAndFlush(stdout)).resolves.toBeUndefined();
    });

    it("writes SGR reset sequence and flushes", async () => {
      const chunks: Buffer[] = [];
      const stdout = new Writable({
        write: (chunk, encoding, callback) => {
          chunks.push(Buffer.from(chunk));
          if (typeof callback === "function") callback();
          return true;
        },
      });
      (stdout as NodeJS.WriteStream).isTTY = true;

      await writeSGRResetAndFlush(stdout);

      const written = Buffer.concat(chunks).toString();
      expect(written).toContain("\x1b[0m"); // SGR reset
      expect(written).toContain("\x1b[?25h"); // Show cursor
      expect(written).toContain("\x1b[?1000l"); // Disable mouse modes
      expect(written).toContain("\x1b[?1006l");
    });

    it("does not throw on write error", async () => {
      const stdout = new Writable({
        write: () => {
          throw new Error("Write failed");
        },
      });
      (stdout as NodeJS.WriteStream).isTTY = true;

      // Should not throw - errors are caught internally
      await expect(writeSGRResetAndFlush(stdout)).resolves.toBeUndefined();
    });
  });

  describe("drainStdin", () => {
    it("returns immediately if stdin is undefined", () => {
      expect(() => drainStdin(undefined)).not.toThrow();
    });

    it("returns immediately if stdin is destroyed", () => {
      const stdin = {
        destroyed: true,
        closed: false,
        readable: true,
        readableLength: 10,
        read: vi.fn(),
      } as unknown as NodeJS.ReadStream;

      expect(() => drainStdin(stdin)).not.toThrow();
      expect(stdin.read).not.toHaveBeenCalled();
    });

    it("reads all available data from stdin", () => {
      const stdin = {
        destroyed: false,
        closed: false,
        readable: true,
        readableLength: 100,
        read: vi.fn(() => {
          // Simulate reading data
          (stdin as { readableLength: number }).readableLength = 0;
          return Buffer.from("test");
        }),
      } as unknown as NodeJS.ReadStream;

      drainStdin(stdin);

      expect(stdin.read).toHaveBeenCalled();
    });

    it("does not throw if read fails", () => {
      const stdin = {
        destroyed: false,
        closed: false,
        readable: true,
        readableLength: 10,
        read: vi.fn(() => {
          throw new Error("Read failed");
        }),
      } as unknown as NodeJS.ReadStream;

      expect(() => drainStdin(stdin)).not.toThrow();
    });
  });
});
