import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Phase R4: Lightweight git branch runtime for StatusFooter display.
 *
 * Provides cached, periodically-refreshed branch name + dirty state.
 * Pure runtime — no React/Ink dependencies.
 */

const execFileAsync = promisify(execFile);

const DEFAULT_INTERVAL_MS = 5000;
const SPAWN_TIMEOUT_MS = 2000;

export type GitBranchState = {
  branch: string | undefined;
  dirty: boolean;
  lastChecked: number;
};

export type GitBranchRuntime = {
  getState(): GitBranchState;
  refresh(): Promise<GitBranchState>;
  dispose(): void;
};

const INITIAL_STATE: GitBranchState = {
  branch: undefined,
  dirty: false,
  lastChecked: 0,
};

async function fetchBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      timeout: SPAWN_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
    });
    const branch = stdout.toString().trim();
    return branch.length > 0 ? branch : undefined;
  } catch {
    return undefined;
  }
}

async function fetchDirty(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd,
      timeout: SPAWN_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
    });
    return stdout.toString().trim().length > 0;
  } catch {
    return false;
  }
}

export function createGitBranchRuntime(
  projectPath: string,
  options?: { intervalMs?: number },
): GitBranchRuntime {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;

  let state: GitBranchState = { ...INITIAL_STATE };
  let timer: ReturnType<typeof setInterval> | undefined;

  const refresh = async (): Promise<GitBranchState> => {
    const [branch, dirty] = await Promise.all([
      fetchBranch(projectPath),
      fetchDirty(projectPath),
    ]);
    state = { branch, dirty, lastChecked: Date.now() };
    return state;
  };

  // Fire initial refresh without blocking construction.
  void refresh();

  timer = setInterval(() => {
    void refresh();
  }, intervalMs);

  return {
    getState(): GitBranchState {
      return state;
    },
    refresh,
    dispose(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
