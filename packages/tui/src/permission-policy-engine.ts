// permission-policy-engine.ts — D.13N
//
// Linghun-self-built permission policy engine.
//
// Layer model (Tool request → decision):
//   normalize tool input
//     → command/path parser
//     → semantic classifier (readonly / mutating / destructive / network /
//                            install / secret_read / outside_workspace / unknown)
//     → path safety classifier (workspace_safe / workspace_write /
//                                outside_workspace / sensitive_path / unknown_path)
//     → policy decision (auto_allow_readonly / require_permission / hard_deny)
//
// Behavioral references (CCB only — no source copied):
//   F:\ccb-source\src\utils\shell\readOnlyCommandValidation.ts (readonly maps,
//     EXTERNAL_READONLY_COMMANDS, containsVulnerableUncPath)
//   F:\ccb-source\src\utils\permissions\dangerousPatterns.ts (CROSS_PLATFORM_CODE_EXEC)
//   F:\ccb-source\src\utils\permissions\filesystem.ts (DANGEROUS_FILES,
//     DANGEROUS_DIRECTORIES, sensitive-path patterns)
//   F:\ccb-source\src\components\permissions\BashPermissionRequest\
//     BashPermissionRequest.tsx (allow once / always / deny / cancel UX)
//
// Hard boundary: this module is **pure** logic — no fs / no network / no
// TuiContext mutation. Callers (index.ts) are responsible for converting
// `decision === "auto_allow_readonly"` into a `decidePermission`-shaped
// allow result and for emitting the `permission_auto_allow_readonly` event.
//
// Non-goals (D.13N):
//   - This engine MUST NOT auto-deny outside the existing `getHardDenyReason`
//     boundary; conservative path is `require_permission`.
//   - Edit / Write / MultiEdit are intentionally never auto-allowed here.
//   - "Always allow" rules continue to be expressed by `permissions.rules`;
//     this engine only widens the *implicit* allow surface for safe readonly.

import { isAbsolute, relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SemanticClass =
  | "readonly"
  | "mutating"
  | "destructive"
  | "network"
  | "install"
  | "secret_read"
  | "outside_workspace"
  | "unknown";

export type PathSafetyClass =
  | "workspace_safe"
  | "workspace_write"
  | "outside_workspace"
  | "sensitive_path"
  | "unknown_path";

export type PolicyDecision = "auto_allow_readonly" | "require_permission";

/** Tool request shape the engine consumes. Decoupled from TuiContext. */
export type PolicyRequest = {
  toolName: string;
  /** Raw tool input as the model sent it (may be unknown / object). */
  input: unknown;
  /** Absolute workspace root used as the "inside workspace" anchor. */
  workspaceRoot: string;
  /**
   * Marker for deferred/MCP/ExecuteExtraTool dispatch. Built-in tools must
   * pass `false`. Engine treats `true` paths as `unknown` semantic by default
   * unless `manifestReadOnly === true` is set explicitly.
   */
  isDeferred?: boolean;
  /**
   * Set by deferred caller when the tool's manifest declares it readonly with
   * trusted provenance. Without this, deferred tools fall through to
   * `require_permission`.
   */
  manifestReadOnly?: boolean;
};

export type PolicyVerdict = {
  decision: PolicyDecision;
  semantic: SemanticClass;
  pathSafety: PathSafetyClass;
  /** Short human reason — safe to surface in TUI / event payload. */
  reason: string;
  /**
   * Sanitized command form for events / explainers. Never includes the raw
   * value of secrets, tokens, or absolute paths to sensitive files.
   */
  redactedSummary: string;
};

// ---------------------------------------------------------------------------
// Sensitive-path patterns (file-name + directory-segment based, case-insensitive)
// ---------------------------------------------------------------------------

const SENSITIVE_FILE_BASENAMES = new Set<string>([
  ".env",
  "provider.env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".pgpass",
  "credentials",
  "credentials.json",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
]);

const SENSITIVE_BASENAME_KEYWORDS = [
  "secret",
  "token",
  "password",
  "credential",
  "apikey",
  "api_key",
];

const SENSITIVE_DIR_SEGMENTS = new Set<string>([".ssh", ".gnupg", ".aws", ".azure", ".gcloud"]);

// Combinator / quoting patterns that force a Bash command back to
// `require_permission` regardless of the head verb.
const COMPOSITION_OPERATORS_REGEX =
  // ; && || | > >> < `...` $(...) — we only need to detect *presence*.
  // Plain quoted strings stay safe; engine errs toward require_permission on match.
  /[;|&<>`]|\$\(/u;

// PowerShell / cmd.exe encoded-command and arbitrary-shell patterns.
const ENCODED_OR_NESTED_SHELL_REGEX =
  /(?:^|\s)(?:powershell|pwsh)(?:\.exe)?\s+.*?(?:-enc(?:odedcommand)?|-e\b)|(?:^|\s)cmd(?:\.exe)?\s+\/c\b|(?:^|\s)(?:bash|sh)\s+-c\b/iu;

// Network downloaders / fetchers that effectively act as code-exec entry
// points. Treated as `network` regardless of verb argument.
const NETWORK_HEADS = new Set<string>([
  "curl",
  "wget",
  "irm",
  "iwr",
  "invoke-restmethod",
  "invoke-webrequest",
  "scp",
  "sftp",
  "ssh",
  "ftp",
  "tftp",
]);

// Package install verbs (per-manager). install/add/remove are mutating; check
// the package manager head + the verb pair so that `npm view` (readonly query)
// stays in `unknown` and not `install`.
const INSTALL_PAIRS: Array<[string, Set<string>]> = [
  ["npm", new Set(["install", "i", "add", "uninstall", "un", "rm", "remove", "ci", "exec"])],
  ["pnpm", new Set(["install", "i", "add", "remove", "rm", "uninstall", "dlx", "exec", "deploy"])],
  ["yarn", new Set(["add", "remove", "install", "global"])],
  ["bun", new Set(["add", "remove", "install", "i", "x"])],
  ["pip", new Set(["install", "uninstall", "wheel", "download"])],
  ["pip3", new Set(["install", "uninstall", "wheel", "download"])],
  ["pipx", new Set(["install", "uninstall", "inject", "upgrade", "run"])],
  ["uv", new Set(["pip", "tool", "add", "remove", "sync"])],
  ["cargo", new Set(["install", "uninstall", "add", "remove"])],
  ["gem", new Set(["install", "uninstall"])],
  ["go", new Set(["install", "get"])],
  ["brew", new Set(["install", "uninstall", "reinstall", "upgrade", "tap"])],
  ["apt", new Set(["install", "remove", "purge", "upgrade", "update"])],
  ["apt-get", new Set(["install", "remove", "purge", "upgrade", "update"])],
  ["dnf", new Set(["install", "remove", "upgrade", "update"])],
  ["yum", new Set(["install", "remove", "upgrade", "update"])],
  ["choco", new Set(["install", "uninstall", "upgrade"])],
  ["scoop", new Set(["install", "uninstall", "update"])],
  ["winget", new Set(["install", "uninstall", "upgrade"])],
];

// Single-token destructive heads. Argument shape doesn't soften these.
const DESTRUCTIVE_HEADS = new Set<string>([
  "rm",
  "rmdir",
  "del",
  "erase",
  "remove-item",
  "rd",
  "mkfs",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "format",
  "diskpart",
  "fdisk",
  "dd",
  "kill",
  "taskkill",
  "pkill",
]);

// Heads that are mutating to local fs/state but not destructive at the
// catastrophic level (require_permission, but not `destructive`).
const MUTATING_HEADS = new Set<string>([
  "mv",
  "move",
  "cp",
  "copy",
  "copy-item",
  "ren",
  "rename",
  "rename-item",
  "mkdir",
  "md",
  "new-item",
  "touch",
  "ln",
  "new-symlink",
  "set-content",
  "out-file",
  "add-content",
  "clear-content",
  "chmod",
  "chown",
  "icacls",
  "attrib",
  "setx",
  "regedit",
  "sc",
]);

// Plain readonly shell heads (no further argument validation needed beyond
// "no composition operators"). Path-bearing tools like cat/type are checked
// against path-safety classifier separately.
//
// D.13N-fix: `env` and `set` are intentionally NOT on this list. Both verbs
// print environment variables when invoked bare and would silently leak
// secrets (provider keys, tokens, etc.) into transcripts under
// auto_allow_readonly. They fall through to `unknown` → require_permission
// via the explicit gate in classifyBashHead below, regardless of argument
// shape (so `env --version` / `set` both still ask).
const READONLY_HEADS = new Set<string>([
  "pwd",
  "ls",
  "dir",
  "where",
  "where.exe",
  "which",
  "whoami",
  "hostname",
  "echo",
  "printf",
  "true",
  "false",
  "date",
  "uptime",
  "uname",
  "id",
  "get-location",
  "get-childitem",
  "gci",
  "get-content",
  "gc",
  "get-process",
  "get-service",
  "get-date",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "python",
  "python3",
  "tsc",
  "git",
  "gh",
  "cargo",
  "go",
  "rustc",
  "javac",
  "java",
  "ruby",
  "docker",
]);

// Heads that print process / shell environment by design. Always
// require_permission so secret-bearing env vars never reach stdout silently.
// Listed separately from READONLY_HEADS so a future caller can't accidentally
// re-add them.
const ENV_PRINTING_HEADS = new Set<string>(["env", "set"]);

// File-reading heads that need a path safety check (the path argument must
// land inside workspace and not match a sensitive pattern).
const PATH_READ_HEADS = new Set<string>([
  "cat",
  "type",
  "head",
  "tail",
  "less",
  "more",
  "view",
  "wc",
  "get-content",
  "gc",
]);

// Subset of git subcommands that are truly readonly. Anything not on this list
// is treated as `unknown` → require_permission (covers git push / git reset /
// git clean / git checkout etc.).
const GIT_READONLY_SUBS = new Set<string>([
  "status",
  "log",
  "show",
  "diff",
  "branch",
  "tag",
  "shortlog",
  "reflog",
  "blame",
  "rev-parse",
  "describe",
  "config", // only when read; we check below for `--unset` / set-style writes
  "worktree", // worktree list is readonly; add/remove are mutating — check below
  "remote", // remote -v / remote get-url readonly; add/set-url mutating — check below
  "stash", // stash list / show readonly; pop/push/drop mutating — check below
  "ls-files",
  "ls-tree",
  "ls-remote",
]);

// Heads that always look like `<head> --version` / `<head> -v` and stay readonly
// regardless of trailing args. Used to short-circuit npm/pnpm/yarn/bun version
// queries before falling into the install-pair detector.
const VERSION_FLAGS = new Set<string>(["--version", "-v", "-V"]);

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export function classifyToolRequest(req: PolicyRequest): PolicyVerdict {
  if (req.isDeferred) {
    return classifyDeferredRequest(req);
  }
  switch (req.toolName) {
    case "Bash":
      return classifyBashRequest(req);
    case "Read":
      return classifyReadRequest(req);
    case "Write":
    case "Edit":
    case "MultiEdit":
      return {
        decision: "require_permission",
        semantic: "mutating",
        pathSafety: classifyInputPath(req),
        reason: `${req.toolName} 走原有权限流程；本引擎不自动放行写入。`,
        redactedSummary: `${req.toolName} ${redactPathFromInput(req.input)}`,
      };
    case "Grep":
    case "Glob":
    case "Diff":
    case "Todo":
      // Already low-risk readonly in `tool` definitions; engine echoes that.
      return {
        decision: "auto_allow_readonly",
        semantic: "readonly",
        pathSafety: "workspace_safe",
        reason: `${req.toolName} 在内置工具定义中即为只读；engine 复述其判断。`,
        redactedSummary: req.toolName,
      };
    default:
      return {
        decision: "require_permission",
        semantic: "unknown",
        pathSafety: "unknown_path",
        reason: `未识别的工具 ${req.toolName}，保守要求权限确认。`,
        redactedSummary: req.toolName,
      };
  }
}

// ---------------------------------------------------------------------------
// Bash classifier
// ---------------------------------------------------------------------------

function classifyBashRequest(req: PolicyRequest): PolicyVerdict {
  const command = readBashCommand(req.input);
  const redactedSummary = redactBashCommand(command);

  if (!command.trim()) {
    return {
      decision: "require_permission",
      semantic: "unknown",
      pathSafety: "unknown_path",
      reason: "空 Bash 命令；保守要求权限确认。",
      redactedSummary,
    };
  }
  if (containsBareSensitiveTokenInCommand(command)) {
    return {
      decision: "require_permission",
      semantic: "secret_read",
      pathSafety: "sensitive_path",
      reason: "命令引用敏感路径或密钥命名；不自动放行。",
      redactedSummary,
    };
  }

  if (COMPOSITION_OPERATORS_REGEX.test(command) || ENCODED_OR_NESTED_SHELL_REGEX.test(command)) {
    return {
      decision: "require_permission",
      semantic: "unknown",
      pathSafety: "unknown_path",
      reason: "命令含组合符 / 重定向 / 嵌套 shell / 编码命令；不自动放行。",
      redactedSummary,
    };
  }

  const tokens = tokenizeShellCommand(command);
  if (tokens.length === 0) {
    return {
      decision: "require_permission",
      semantic: "unknown",
      pathSafety: "unknown_path",
      reason: "无法解析 Bash 命令 token；保守要求权限确认。",
      redactedSummary,
    };
  }

  const head = tokens[0]?.toLowerCase() ?? "";
  const args = tokens.slice(1);
  const semantic = classifyBashHead(head, args);

  // D.13R Git / Worktree / Stable Point Maturity Sweep — git 命令的 redactedSummary
  // 用稳定的 "git <subcommand>" 形式覆盖原始命令字符串；这是 allow_always_tool 的
  // 命中键，避免因为 -m / --no-edit / 文件路径等微小差异导致每次都重弹权限。
  // 仅作用于 git，且只覆盖 require_permission 路径的 summary（readonly 路径不
  // 需要持久化权限）。git status / log / diff 等 readonly 子命令仍走 readonly
  // 路径，保持原 redactedSummary，让审计 log 留有可读信息。
  const stableSummary = head === "git" ? buildStableGitSummary(args) : null;
  const finalSummary = stableSummary ?? redactedSummary;

  if (semantic === "readonly") {
    if (PATH_READ_HEADS.has(head)) {
      const pathArgs = getPathReadArgs(head, args);
      if (pathArgs.length > 0) {
        const pathSafeties = pathArgs.map((arg) => classifyPathString(arg, req.workspaceRoot));
        const unsafePathSafety =
          pathSafeties.find((pathSafety) => pathSafety === "sensitive_path") ??
          pathSafeties.find((pathSafety) => pathSafety !== "workspace_safe");
        if (!unsafePathSafety) {
          return {
            decision: "auto_allow_readonly",
            semantic: "readonly",
            pathSafety: "workspace_safe",
            reason: `${head} 读取工作区内文件，自动放行。`,
            redactedSummary,
          };
        }
        return {
          decision: "require_permission",
          semantic: unsafePathSafety === "sensitive_path" ? "secret_read" : "outside_workspace",
          pathSafety: unsafePathSafety,
          reason:
            unsafePathSafety === "sensitive_path"
              ? `${head} 命中敏感路径；不自动放行。`
              : `${head} 路径在工作区外或无法判定；不自动放行。`,
          redactedSummary,
        };
      }
      if (head === "wc") {
        return {
          decision: "require_permission",
          semantic: "unknown",
          pathSafety: "unknown_path",
          reason: "wc 未提供可判定的工作区文件路径；不自动放行。",
          redactedSummary,
        };
      }
    }
    return {
      decision: "auto_allow_readonly",
      semantic: "readonly",
      pathSafety: "workspace_safe",
      reason: `${head} 是只读命令；自动放行。`,
      redactedSummary,
    };
  }

  return {
    decision: "require_permission",
    semantic,
    pathSafety: "unknown_path",
    reason: bashReasonFor(semantic, head),
    redactedSummary: finalSummary,
  };
}

function getPathReadArgs(head: string, args: string[]): string[] {
  const pathArgs = args.filter((arg) => !arg.startsWith("-"));
  if (head === "wc") return pathArgs;
  const firstPath = pathArgs[0];
  return firstPath ? [firstPath] : [];
}

/**
 * D.13R: 把 `git <sub> [args...]` 折叠成稳定的 redactedSummary，让
 * allow_always_tool 持久化命中不被参数差异打散。返回 null 表示头不是 git，
 * 调用方应回退到默认 redactedSummary。
 *
 * 例：
 *   git commit -m "fix: foo"          → "git commit"
 *   git commit -a --no-verify         → "git commit"
 *   git worktree add ../wt feature    → "git worktree add"
 *   git worktree remove ../wt --force → "git worktree remove"
 *   git checkout -b feature           → "git checkout"
 *   git push origin main              → "git push"
 *   git reset --hard HEAD~1           → "git reset"
 *
 * 子命令清单与 classifyGitSubcommand 一致，保持权限语义和持久化键的对齐。
 */
function buildStableGitSummary(args: string[]): string {
  const sub = args.find((a) => !a.startsWith("-"))?.toLowerCase() ?? "";
  if (!sub) return "git";
  // worktree / remote / stash / config 这类多动词子命令，把第二个非 flag token
  // 也带上（"git worktree add" / "git stash pop"），这是用户授权时关心的真实意图。
  if (sub === "worktree" || sub === "remote" || sub === "stash" || sub === "config") {
    const verb = args.filter((a) => !a.startsWith("-"))[1]?.toLowerCase();
    return verb ? `git ${sub} ${verb}` : `git ${sub}`;
  }
  return `git ${sub}`;
}

function bashReasonFor(semantic: SemanticClass, head: string): string {
  switch (semantic) {
    case "destructive":
      return `${head} 属于破坏性命令；保守要求权限确认。`;
    case "network":
      return `${head} 会发起网络访问；保守要求权限确认。`;
    case "install":
      return `${head} 会安装/卸载或拉取依赖；保守要求权限确认。`;
    case "mutating":
      return `${head} 会改写本地文件或系统状态；保守要求权限确认。`;
    case "secret_read":
      return `${head} 触及敏感数据；保守要求权限确认。`;
    case "outside_workspace":
      return `${head} 越界访问；保守要求权限确认。`;
    default:
      return `${head} 当前未列入只读白名单；保守要求权限确认。`;
  }
}

function classifyBashHead(head: string, args: string[]): SemanticClass {
  if (DESTRUCTIVE_HEADS.has(head)) return "destructive";
  if (MUTATING_HEADS.has(head)) return "mutating";
  if (NETWORK_HEADS.has(head)) return "network";

  // D.13N-fix: env / set print process environment and would leak secrets
  // (provider keys, tokens) on stdout. Always require_permission, regardless
  // of argument shape — even `env --version` and `set` (no args) ask.
  if (ENV_PRINTING_HEADS.has(head)) {
    return "secret_read";
  }

  // D.13N-fix: echo / printf are only readonly when they emit pure literals.
  // Any shell-style env expansion ($VAR / ${VAR} / $env:VAR / %VAR%) or any
  // sensitive keyword (secret/key/token/password/credential/api_key/apikey)
  // in the argv must require_permission so the value can't be dumped to
  // stdout under auto_allow_readonly.
  if (head === "echo" || head === "printf") {
    return classifyEchoPrintf(args);
  }

  // git: subcommand drives the verdict.
  if (head === "git") {
    return classifyGitSubcommand(args);
  }
  // gh: only `gh status` / `gh repo view` etc. are *queries*, but they hit the
  // network. For D.13N keep gh entirely behind permission unless explicitly
  // listed; mark as network so the reason is clear.
  if (head === "gh") {
    return "network";
  }
  // docker: ps / images / version / inspect / logs are readonly queries.
  if (head === "docker") {
    return classifyDockerSubcommand(args);
  }
  // package managers: --version / -v stay readonly; install pairs go to install.
  if (isVersionQuery(args)) return "readonly";
  if (head === "node") {
    return classifyNodeSubcommand(args);
  }
  for (const [pkgHead, verbs] of INSTALL_PAIRS) {
    if (head === pkgHead) {
      const verb = args.find((a) => !a.startsWith("-"))?.toLowerCase();
      if (verb && verbs.has(verb)) return "install";
      // unknown subcommand on a package manager → unknown (require_permission).
      return "unknown";
    }
  }

  // Path-reading heads (cat / type / head / tail / get-content) — readonly
  // pending path classifier check at caller.
  if (PATH_READ_HEADS.has(head)) return "readonly";

  if (READONLY_HEADS.has(head)) return "readonly";
  return "unknown";
}

function classifyNodeSubcommand(args: string[]): SemanticClass {
  if (args.length === 0) return "readonly";
  if (isVersionQuery(args)) return "readonly";
  if (args.some((arg) => arg === "-e" || arg === "--eval")) return "unknown";
  return "unknown";
}

function classifyGitSubcommand(args: string[]): SemanticClass {
  const sub = args.find((a) => !a.startsWith("-"))?.toLowerCase();
  if (!sub) return "readonly"; // bare `git` prints usage — readonly.
  if (!GIT_READONLY_SUBS.has(sub)) return "unknown";
  // Refine the subset that has both readonly and write modes.
  if (sub === "config") {
    const setLike = args.some((a) =>
      [
        "--unset",
        "--unset-all",
        "--add",
        "--replace-all",
        "--rename-section",
        "--remove-section",
      ].includes(a),
    );
    return setLike ? "mutating" : "readonly";
  }
  if (sub === "worktree") {
    const verb = args.filter((a) => !a.startsWith("-"))[1]?.toLowerCase();
    return verb && verb !== "list" ? "mutating" : "readonly";
  }
  if (sub === "remote") {
    const verb = args.filter((a) => !a.startsWith("-"))[1]?.toLowerCase();
    if (!verb || verb === "show" || verb === "get-url") return "readonly";
    return "mutating";
  }
  if (sub === "stash") {
    const verb = args.filter((a) => !a.startsWith("-"))[1]?.toLowerCase();
    if (!verb || verb === "list" || verb === "show") return "readonly";
    return "mutating";
  }
  return "readonly";
}

function classifyDockerSubcommand(args: string[]): SemanticClass {
  const sub = args.find((a) => !a.startsWith("-"))?.toLowerCase();
  if (!sub) return "readonly";
  if (
    [
      "ps",
      "images",
      "image",
      "inspect",
      "logs",
      "version",
      "info",
      "stats",
      "top",
      "history",
    ].includes(sub)
  ) {
    return "readonly";
  }
  return "unknown";
}

// D.13N-fix: detect env-expansion / sensitive-keyword arguments to echo /
// printf. The check is intentionally conservative and purely static — we
// never evaluate the shell or run the command. Any signal of dynamic
// expansion or secret-shaped naming flips the verdict to `secret_read` so
// the existing require_permission path catches it.
//
// Patterns:
//   $VAR, ${VAR}, ${env:VAR}     POSIX-style expansion
//   $env:VAR                     PowerShell-style env expansion
//   %VAR%                        cmd.exe-style env expansion
//   secret/token/password/credential/api_key/apikey/key (case-insensitive)
//                                even as a literal word, since echoing one
//                                of these almost always means dumping a
//                                value the user does not want in transcripts
//
// `echo --version` / `printf "%s\n" hello` / `echo "hello world"` stay
// readonly because none of those tokens contains an expansion marker.
const ENV_EXPANSION_REGEX = /\$\{?[A-Za-z_][\w:]*\}?|%[A-Za-z_][\w]*%/u;
const ECHO_SENSITIVE_KEYWORDS = [
  "secret",
  "token",
  "password",
  "credential",
  "api_key",
  "apikey",
  // Standalone "key" as a whole word — e.g. `echo $key` after we already
  // catch $key, but also covers `echo my_key value`. Boundary-checked so
  // benign strings like "monkey" don't trip.
  "key",
];

function classifyEchoPrintf(args: string[]): SemanticClass {
  for (const arg of args) {
    if (ENV_EXPANSION_REGEX.test(arg)) return "secret_read";
    if (containsSensitiveEchoKeyword(arg)) return "secret_read";
  }
  return "readonly";
}

function containsSensitiveEchoKeyword(arg: string): boolean {
  const lower = arg.toLowerCase();
  for (const kw of ECHO_SENSITIVE_KEYWORDS) {
    // Word-boundary match against [A-Za-z0-9_] so monkey/keychain/passwordless
    // do NOT match — only standalone tokens like KEY / api_key / SECRET.
    const re = new RegExp(`(?:^|[^a-z0-9_])${kw}(?:$|[^a-z0-9_])`, "iu");
    if (re.test(lower)) return true;
  }
  return false;
}

function isVersionQuery(args: string[]): boolean {
  return args.length > 0 && args.every((a) => VERSION_FLAGS.has(a) || !a.startsWith("-"))
    ? args.some((a) => VERSION_FLAGS.has(a))
    : false;
}

// ---------------------------------------------------------------------------
// Read tool classifier
// ---------------------------------------------------------------------------

function classifyReadRequest(req: PolicyRequest): PolicyVerdict {
  const path = readStringField(req.input, "path");
  if (!path) {
    return {
      decision: "require_permission",
      semantic: "unknown",
      pathSafety: "unknown_path",
      reason: "Read 缺少 path 字段；保守要求权限确认。",
      redactedSummary: "Read",
    };
  }
  const pathSafety = classifyPathString(path, req.workspaceRoot);
  if (pathSafety === "workspace_safe") {
    return {
      decision: "auto_allow_readonly",
      semantic: "readonly",
      pathSafety,
      reason: "Read 工作区内普通文件；自动放行。",
      redactedSummary: `Read ${redactPathForSummary(path, req.workspaceRoot)}`,
    };
  }
  return {
    decision: "require_permission",
    semantic: pathSafety === "sensitive_path" ? "secret_read" : "outside_workspace",
    pathSafety,
    reason:
      pathSafety === "sensitive_path"
        ? "Read 命中敏感路径；不自动放行。"
        : "Read 路径在工作区外或无法判定；不自动放行。",
    redactedSummary: `Read ${redactPathForSummary(path, req.workspaceRoot)}`,
  };
}

// ---------------------------------------------------------------------------
// Deferred / MCP / ExecuteExtraTool
// ---------------------------------------------------------------------------

function classifyDeferredRequest(req: PolicyRequest): PolicyVerdict {
  if (req.manifestReadOnly) {
    return {
      decision: "auto_allow_readonly",
      semantic: "readonly",
      pathSafety: "workspace_safe",
      reason: "deferred 工具 manifest 声明只读；自动放行。",
      redactedSummary: redactDeferredSummary(req.toolName),
    };
  }
  return {
    decision: "require_permission",
    semantic: "unknown",
    pathSafety: "unknown_path",
    reason: "deferred / MCP / ExecuteExtraTool 默认要求权限确认。",
    redactedSummary: redactDeferredSummary(req.toolName),
  };
}

// ---------------------------------------------------------------------------
// Path classifier
// ---------------------------------------------------------------------------

export function classifyPathString(pathArg: string, workspaceRoot: string): PathSafetyClass {
  if (!pathArg) return "unknown_path";
  // UNC / WebDAV / network paths.
  if (
    pathArg.startsWith("\\\\") ||
    pathArg.startsWith("//") ||
    /@SSL@\d+|@\d+@SSL/i.test(pathArg)
  ) {
    return "outside_workspace";
  }
  // Path-traversal token kept as a separate signal — flag as outside_workspace.
  if (pathArg.includes("..")) {
    // Resolve relative path against workspace and re-check below.
  }

  const absolute = isAbsolute(pathArg) ? pathArg : resolve(workspaceRoot, pathArg);
  const lower = absolute.toLowerCase();
  const basename = lower.split(/[\\/]/).pop() ?? "";

  if (SENSITIVE_FILE_BASENAMES.has(basename)) return "sensitive_path";
  if (basename.startsWith(".env.")) return "sensitive_path";
  for (const kw of SENSITIVE_BASENAME_KEYWORDS) {
    if (basename.includes(kw)) return "sensitive_path";
  }
  // Directory-segment based check (case-insensitive).
  const segments = lower.split(/[\\/]+/);
  for (const seg of segments) {
    if (SENSITIVE_DIR_SEGMENTS.has(seg)) return "sensitive_path";
  }
  // Also catch ~/.linghun/provider.env style: basename matched above is the
  // primary check; here we cover the case when only the dir matches.
  if (segments.includes(".linghun") && (basename === "provider.env" || basename.endsWith(".env"))) {
    return "sensitive_path";
  }

  // Workspace boundary.
  const rel = relative(resolve(workspaceRoot), absolute);
  if (!rel || rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return rel === "" ? "workspace_safe" : "outside_workspace";
  }
  return "workspace_safe";
}

function classifyInputPath(req: PolicyRequest): PathSafetyClass {
  const path = readStringField(req.input, "path");
  if (!path) return "unknown_path";
  return classifyPathString(path, req.workspaceRoot);
}

// ---------------------------------------------------------------------------
// Helpers — input parsing / redaction
// ---------------------------------------------------------------------------

function readBashCommand(input: unknown): string {
  if (input && typeof input === "object" && "command" in input) {
    const value = (input as { command?: unknown }).command;
    if (typeof value === "string") return value;
  }
  return "";
}

function readStringField(input: unknown, field: string): string {
  if (input && typeof input === "object" && field in input) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return "";
}

/**
 * Lightweight shell-token splitter.
 * Honors single and double quotes; does **not** evaluate $(...) / `...` —
 * those force require_permission upstream via COMPOSITION_OPERATORS_REGEX.
 *
 * Backslash handling: outside single quotes, `\` is treated as an escape
 * **only when it precedes a shell-meta character** (whitespace, quotes, $, #,
 * the backslash itself). Backslashes followed by alphanumerics or path
 * separators stay literal so Windows-style paths like `C:\Users\foo`
 * tokenize as a single token instead of being silently de-slashed.
 */
export function tokenizeShellCommand(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? "";
    if (ch === "\\" && quote !== "'" && i + 1 < input.length) {
      const next = input[i + 1] ?? "";
      // Treat as escape only when next char is shell-meta. Otherwise keep
      // literal so Windows paths survive unchanged.
      if (/[\s"'`$#\\]/u.test(next)) {
        cur += next;
        i += 1;
        continue;
      }
      // Plain literal backslash — keep both chars.
      cur += ch;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * Returns true if the *raw* command text references a sensitive token even
 * when our tokenizer would normally split it benignly. This catches inline
 * tail-grep style invocations and string interpolations that the heuristic
 * head/args check misses.
 */
function containsBareSensitiveTokenInCommand(command: string): boolean {
  const lower = command.toLowerCase();
  if (lower.includes("provider.env")) return true;
  if (/(?:^|[\s\\/])\.env(?:[\s$.]|\.[\w-]+)/u.test(lower)) return true;
  if (/(?:^|[\\/.])\.ssh[\\/]/u.test(lower)) return true;
  for (const kw of SENSITIVE_BASENAME_KEYWORDS) {
    // Only flag if it looks like a path token, not a flag like --secret-flag
    // which doesn't actually read a secret.
    const re = new RegExp(`(?:^|[\\s/\\\\])[\\w./-]*${kw}[\\w./-]*`, "iu");
    if (re.test(lower)) return true;
  }
  return false;
}

function redactBashCommand(command: string): string {
  if (!command) return "Bash";
  let out = command.length > 200 ? `${command.slice(0, 200)}…` : command;
  // Mask candidate secret-shaped tokens (=value or quoted blobs) — engine
  // never emits raw values into events. Pattern is conservative: long alnum/-
  // runs preceded by `=` are masked, plus standalone Bearer / sk- / pk- tokens.
  out = out
    .replace(/(=)([\w./+=-]{12,})/gu, "$1***")
    .replace(/\b(?:sk|pk|api|token)[-_][\w.-]{6,}/giu, "***")
    .replace(/\bBearer\s+[\w.-]+/giu, "Bearer ***");
  // Also mask sensitive path-like tokens so events never carry the literal
  // secret-file location: provider.env, .env / .env.*, .ssh/* paths, and
  // tokens whose basename includes secret keywords.
  out = out.replace(/\S+/gu, (token) => maskTokenIfSensitive(token));
  return out;
}

function maskTokenIfSensitive(token: string): string {
  // Strip surrounding quotes for inspection but keep them on output.
  const stripped = token.replace(/^["']|["']$/gu, "");
  const lower = stripped.toLowerCase();
  const basename = lower.split(/[\\/]/).pop() ?? "";
  if (
    SENSITIVE_FILE_BASENAMES.has(basename) ||
    basename.startsWith(".env.") ||
    SENSITIVE_BASENAME_KEYWORDS.some((kw) => basename.includes(kw))
  ) {
    return "(sensitive)";
  }
  // D.13N-fix: env-expansion markers (${VAR} / $VAR / $env:VAR / %VAR%) and
  // standalone secret-keyword tokens (KEY / API_KEY / TOKEN / SECRET …) are
  // also masked so the audit summary never carries the variable name a
  // caller was trying to dereference.
  if (ENV_EXPANSION_REGEX.test(stripped)) return "(sensitive)";
  if (containsSensitiveEchoKeyword(stripped)) return "(sensitive)";
  // Path that walks through a sensitive directory segment (e.g. .ssh/) —
  // mask the whole token to avoid leaking the home-dir layout.
  for (const seg of SENSITIVE_DIR_SEGMENTS) {
    const re = new RegExp(`(?:^|[\\\\/])${seg.replace(/\./gu, "\\.")}(?:[\\\\/]|$)`, "iu");
    if (re.test(lower)) return "(sensitive)";
  }
  return token;
}

function redactPathFromInput(input: unknown): string {
  const path = readStringField(input, "path");
  if (!path) return "(no path)";
  return redactPathForSummary(path, "");
}

/**
 * Path summary used in events: keep only the basename if the path looks
 * sensitive; otherwise keep a workspace-relative form (or basename when
 * absolute path is outside workspace).
 */
function redactPathForSummary(pathArg: string, workspaceRoot: string): string {
  const lower = pathArg.toLowerCase();
  const basename = lower.split(/[\\/]/).pop() ?? "";
  if (
    SENSITIVE_FILE_BASENAMES.has(basename) ||
    basename.startsWith(".env.") ||
    SENSITIVE_BASENAME_KEYWORDS.some((kw) => basename.includes(kw))
  ) {
    return "(sensitive)";
  }
  if (workspaceRoot && isAbsolute(pathArg)) {
    const rel = relative(resolve(workspaceRoot), pathArg);
    if (rel && !rel.startsWith("..")) return rel.replaceAll("\\", "/");
    return basename || "(outside workspace)";
  }
  return pathArg.length > 80 ? `${pathArg.slice(0, 80)}…` : pathArg;
}

function redactDeferredSummary(toolName: string): string {
  // Tool name is not secret, but truncate aggressive prefixes.
  return toolName.length > 64 ? `${toolName.slice(0, 64)}…` : toolName;
}
