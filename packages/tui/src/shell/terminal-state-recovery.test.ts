import { describe, it, expect, vi } from "vitest";
import { Writable } from "node:stream";
import {
  createTerminalStateSnapshot,
  recoverTerminalState,
  createTerminalStateRecoveryHandler,
} from "./terminal-state-recovery.js";

describe("terminal-state-recovery", () => {
  describe("createTerminalStateSnapshot", () => {
    it("creates initial clean state", () => {
      const snapshot = createTerminalStateSnapshot();

      expect(snapshot.cursorVisible).toBe(true);
      expect(snapshot.mouseEnabled).toBe(false);
      expect(snapshot.alternateScreen).toBe(false);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });
  });

  describe("recoverTerminalState", () => {
    it("returns immediately if stdout is undefined", async () => {
      await expect(recoverTerminalState(undefined)).resolves.toBeUndefined();
    });

    it("returns immediately if stdout is not TTY", async () => {
      const stdout = new Writable();
      (stdout as NodeJS.WriteStream).isTTY = false;
      await expect(recoverTerminalState(stdout)).resolves.toBeUndefined();
    });

    it("writes recovery sequences without exiting alternate screen", async () => {
      const chunks: Buffer[] = [];
      const stdout = new Writable({
        write: (chunk, encoding, callback) => {
          chunks.push(Buffer.from(chunk));
          if (typeof callback === "function") callback();
          return true;
        },
      });
      (stdout as NodeJS.WriteStream).isTTY = true;

      await recoverTerminalState(stdout, { exitAlternateScreen: false });

      const written = Buffer.concat(chunks).toString();

      // Should contain recovery sequences
      expect(written).toContain("\x1b[?25h"); // Show cursor
      expect(written).toContain("\x1b[?1000l"); // Disable X10 mouse
      expect(written).toContain("\x1b[?1002l"); // Disable button motion
      expect(written).toContain("\x1b[?1003l"); // Disable any motion
      expect(written).toContain("\x1b[?1006l"); // Disable SGR mouse
      expect(written).toContain("\x1b[?1004l"); // Disable focus events
      expect(written).toContain("\x1b[?2004l"); // Disable bracketed paste
      expect(written).toContain("\x1b[0m"); // Reset SGR
      expect(written).toContain("\r\x1b[K"); // Clear line

      // Should NOT exit alternate screen
      expect(written).not.toContain("\x1b[?1049l");
    });

    it("exits alternate screen when requested", async () => {
      const chunks: Buffer[] = [];
      const stdout = new Writable({
        write: (chunk, encoding, callback) => {
          chunks.push(Buffer.from(chunk));
          if (typeof callback === "function") callback();
          return true;
        },
      });
      (stdout as NodeJS.WriteStream).isTTY = true;

      await recoverTerminalState(stdout, { exitAlternateScreen: true });

      const written = Buffer.concat(chunks).toString();
      expect(written).toContain("\x1b[?1049l"); // Exit alternate screen
    });

    it("does not throw on write error", async () => {
      const stdout = new Writable({
        write: () => {
          throw new Error("Write failed");
        },
      });
      (stdout as NodeJS.WriteStream).isTTY = true;

      // Should not throw - errors are caught internally
      await expect(recoverTerminalState(stdout)).resolves.toBeUndefined();
    });
  });

  describe("createTerminalStateRecoveryHandler", () => {
    it("returns a function that recovers terminal state", async () => {
      const chunks: Buffer[] = [];
      const stdout = new Writable({
        write: (chunk, encoding, callback) => {
          chunks.push(Buffer.from(chunk));
          if (typeof callback === "function") callback();
          return true;
        },
      });
      (stdout as NodeJS.WriteStream).isTTY = true;

      const recover = createTerminalStateRecoveryHandler(stdout);

      await recover();

      const written = Buffer.concat(chunks).toString();
      expect(written).toContain("\x1b[?25h"); // Show cursor
      expect(written).toContain("\x1b[0m"); // Reset SGR
    });

    it("passes options to recoverTerminalState", async () => {
      const chunks: Buffer[] = [];
      const stdout = new Writable({
        write: (chunk, encoding, callback) => {
          chunks.push(Buffer.from(chunk));
          if (typeof callback === "function") callback();
          return true;
        },
      });
      (stdout as NodeJS.WriteStream).isTTY = true;

      const recover = createTerminalStateRecoveryHandler(stdout, {
        exitAlternateScreen: true,
      });

      await recover();

      const written = Buffer.concat(chunks).toString();
      expect(written).toContain("\x1b[?1049l"); // Exit alternate screen
    });
  });
});
