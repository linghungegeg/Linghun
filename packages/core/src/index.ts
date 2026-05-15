export * from "./jsonl.js";
export * from "./project.js";
export * from "./session.js";
export * from "./session-store.js";

export type LinghunErrorShape = {
  code: string;
  message: string;
  suggestion?: string;
  cause?: unknown;
  recoverable: boolean;
};

export class LinghunError extends Error implements LinghunErrorShape {
  readonly code: string;
  readonly suggestion?: string;
  readonly cause?: unknown;
  readonly recoverable: boolean;

  constructor(input: LinghunErrorShape) {
    super(input.message);
    this.name = "LinghunError";
    this.code = input.code;
    this.suggestion = input.suggestion;
    this.cause = input.cause;
    this.recoverable = input.recoverable;
  }
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export function createLogger(level: LogLevel = "info"): Logger {
  const levels: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  const shouldLog = (target: LogLevel) => levels[target] >= levels[level];
  const write = (target: LogLevel, message: string) => {
    if (!shouldLog(target)) {
      return;
    }

    const line = `[linghun] ${target}: ${message}`;
    if (target === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  };

  return {
    debug: (message) => write("debug", message),
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}
