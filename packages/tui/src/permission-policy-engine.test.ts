import { describe, expect, it } from "vitest";
import {
  type PolicyRequest,
  classifyPathString,
  classifyToolRequest,
  tokenizeShellCommand,
} from "./permission-policy-engine.js";

const WORKSPACE = process.platform === "win32" ? "C:\\workspace\\demo" : "/workspace/demo";

function bash(command: string, workspaceRoot = WORKSPACE): PolicyRequest {
  return { toolName: "Bash", input: { command }, workspaceRoot };
}

describe("permission-policy-engine — Bash readonly auto allow", () => {
  for (const cmd of [
    "pwd",
    "git status",
    "git status --short",
    "git diff --stat",
    "git log --oneline",
    "git branch",
    "ls",
    "ls -la",
    "dir",
    "where node",
    "which git",
    "node --version",
    "npm --version",
    "pnpm --version",
    "python --version",
    "tsc --version",
    "echo hello",
    "docker ps",
  ]) {
    it(`auto_allow_readonly: ${cmd}`, () => {
      const v = classifyToolRequest(bash(cmd));
      expect(v.decision).toBe("auto_allow_readonly");
      expect(v.semantic).toBe("readonly");
    });
  }

  it("cat workspace 内 README 自动放行", () => {
    const v = classifyToolRequest(bash("cat README.md"));
    expect(v.decision).toBe("auto_allow_readonly");
    expect(v.pathSafety).toBe("workspace_safe");
  });

  it("wc -l workspace 内普通文件自动放行", () => {
    const v = classifyToolRequest(bash("wc -l src/shared/large-generated.ts"));
    expect(v.decision).toBe("auto_allow_readonly");
    expect(v.semantic).toBe("readonly");
    expect(v.pathSafety).toBe("workspace_safe");
  });

  it("wc 多路径中任一越界或敏感路径都不自动放行", () => {
    const outside = process.platform === "win32" ? "C:\\Users\\Admin\\foo.txt" : "/etc/passwd";
    const v = classifyToolRequest(bash(`wc -l src/shared/large-generated.ts ${outside}`));
    expect(v.decision).toBe("require_permission");
    expect(v.pathSafety).not.toBe("workspace_safe");
  });

  for (const cmd of [
    "node test/orders.test.mjs",
    "node tests/orders.test.mjs",
    "node scripts/check.mjs",
    "node scripts/check.cjs --report",
  ]) {
    it(`auto_allow_readonly local node verification script: ${cmd}`, () => {
      const v = classifyToolRequest(bash(cmd));
      expect(v.decision).toBe("auto_allow_readonly");
      expect(v.semantic).toBe("readonly");
      expect(v.pathSafety).toBe("workspace_safe");
    });
  }
});

describe("permission-policy-engine — Bash routine development auto allow", () => {
  for (const cmd of [
    "pnpm test",
    "pnpm exec vitest run",
    "corepack pnpm exec vitest run",
    "npm run build",
    "npm ci",
    "pnpm install",
    "yarn install",
    "bun test",
    "tsc",
    "eslint src",
    "prettier --check .",
    "biome check .",
    "python3 -m pytest",
    "python scripts/check.py",
    "cargo test",
    "go test ./...",
    "git add .",
    "git commit -m fix",
    "git checkout -b feature/demo",
    "git switch main",
    "git stash push",
    "docker build .",
    "docker compose build",
  ]) {
    it(`auto_allow_development: ${cmd}`, () => {
      const v = classifyToolRequest(bash(cmd));
      expect(v.decision).toBe("auto_allow_development");
    });
  }

  it("allows chained routine development commands only when every segment is auto-allowable", () => {
    const v = classifyToolRequest(bash("pnpm test && pnpm run build"));
    expect(v.decision).toBe("auto_allow_development");
  });
});

describe("permission-policy-engine — Bash require_permission", () => {
  for (const cmd of [
    "rm -rf node_modules",
    "rm important.txt",
    "del important.txt",
    "Remove-Item ./x",
    "mv a b",
    "cp a b",
    "npm install lodash",
    "pnpm add react",
    "pip install requests",
    "yarn add lodash",
    "curl https://example.com",
    "wget https://example.com/file",
    "Invoke-WebRequest https://x",
    "git push origin main",
    "git reset --hard HEAD",
    "git clean -fdx",
    "git checkout -- file.ts",
    "git config --unset user.email",
    "git remote add origin url",
    "git stash drop",
    "git worktree add ../x",
    "chmod +x foo.sh",
    "kill -9 1234",
    "shutdown /r",
    "powershell -EncodedCommand QQA=",
    "bash -c 'echo hi'",
    "cmd /c dir",
    'node -e "console.log(process.env.LINGHUN_OPENAI_API_KEY)"',
    "node -e \"require('child_process').execSync('git status')\"",
    "node -e \"require('fs').writeFileSync('x.txt','x')\"",
    "node -e \"require('fs').rmSync('x.txt')\"",
    "node -e \"fetch('https://example.com')\"",
    "node --eval \"console.log(1)\"",
    "node app.mjs",
    "node ../test/orders.test.mjs",
    "node scripts/check.mjs $LINGHUN_OPENAI_API_KEY",
    "node scripts/check.mjs %LINGHUN_OPENAI_API_KEY%",
    "node scripts/check.mjs --token",
    "node --require ./preload.cjs scripts/check.mjs",
    "node scripts/check.mjs > out.txt",
    "python script.py",
    "deno run x.ts",
    "javac Main.java",
    "java Main",
    "ruby script.rb",
    "docker logs app",
    "docker inspect app",
    "docker stats",
    "docker run -p 8080:80 app",
    "docker run --privileged app",
    "pnpm exec unknown-tool",
    "npm run dev -- --host 0.0.0.0",
  ]) {
    it(`require_permission: ${cmd}`, () => {
      const v = classifyToolRequest(bash(cmd));
      expect(v.decision).toBe("require_permission");
    });
  }

  for (const cmd of [
    "ls; rm -rf /",
    "cat foo && rm foo",
    "pwd | grep x",
    "echo hi > out.txt",
    "echo hi >> out.txt",
    "echo `pwd`",
    "echo $(pwd)",
    "Get-Content src/shared/large-generated.ts | Measure-Object -Line",
    "node --version > version.txt",
    "wc -l",
  ]) {
    it(`组合符强制 require_permission: ${cmd}`, () => {
      const v = classifyToolRequest(bash(cmd));
      expect(v.decision).toBe("require_permission");
    });
  }

  for (const cmd of [
    "git status || true",
    "cat < input.txt",
    "node scripts/check.mjs | cat",
  ]) {
    it(`全段 readonly 管道/链 auto_allow_readonly: ${cmd}`, () => {
      const v = classifyToolRequest(bash(cmd));
      expect(v.decision).toBe("auto_allow_readonly");
    });
  }
});

describe("permission-policy-engine — sensitive paths", () => {
  it("cat .env require_permission（即使 cat 是 readonly）", () => {
    const v = classifyToolRequest(bash("cat .env"));
    expect(v.decision).toBe("require_permission");
    expect(v.semantic).toBe("secret_read");
    expect(v.pathSafety).toBe("sensitive_path");
  });

  it("cat .env.local require_permission（.env.* 通配）", () => {
    const v = classifyToolRequest(bash("cat .env.local"));
    expect(v.decision).toBe("require_permission");
    expect(v.pathSafety).toBe("sensitive_path");
  });

  it("cat global ~/.linghun/provider.env require_permission（命中 provider.env basename）", () => {
    const provider =
      process.platform === "win32"
        ? "C:\\Users\\Admin\\.linghun\\provider.env"
        : "/home/admin/.linghun/provider.env";
    const v = classifyToolRequest(bash(`cat ${provider}`));
    expect(v.decision).toBe("require_permission");
    expect(v.pathSafety).toBe("sensitive_path");
  });

  it("cat workspace 外路径 require_permission", () => {
    const outside = process.platform === "win32" ? "C:\\Users\\Admin\\foo.txt" : "/etc/passwd";
    const v = classifyToolRequest(bash(`cat ${outside}`));
    expect(v.decision).toBe("require_permission");
    expect(v.pathSafety).toBe("outside_workspace");
  });

  it("cat .ssh/id_rsa require_permission（敏感目录段）", () => {
    const v = classifyToolRequest(bash("cat .ssh/id_rsa"));
    expect(v.decision).toBe("require_permission");
    expect(v.pathSafety).toBe("sensitive_path");
  });

  it("命令中出现 secret/token/password 关键词时也保守要求权限", () => {
    const v = classifyToolRequest(bash("cat ./mysecret.json"));
    expect(v.decision).toBe("require_permission");
    expect(v.semantic).toBe("secret_read");
  });
});

describe("permission-policy-engine — built-in 非 Bash 不自动放行 Edit/Write/MultiEdit", () => {
  for (const tool of ["Write", "Edit", "MultiEdit"] as const) {
    it(`${tool} 仍 require_permission`, () => {
      const v = classifyToolRequest({
        toolName: tool,
        input: { path: "src/foo.ts", content: "x" },
        workspaceRoot: WORKSPACE,
      });
      expect(v.decision).toBe("require_permission");
      expect(v.semantic).toBe("mutating");
    });
  }

  it("Read sensitive_path 不静默放行", () => {
    const v = classifyToolRequest({
      toolName: "Read",
      input: { path: ".env" },
      workspaceRoot: WORKSPACE,
    });
    expect(v.decision).toBe("require_permission");
    expect(v.semantic).toBe("secret_read");
  });

  it("Read 工作区内普通文件自动放行", () => {
    const v = classifyToolRequest({
      toolName: "Read",
      input: { path: "src/main.ts" },
      workspaceRoot: WORKSPACE,
    });
    expect(v.decision).toBe("auto_allow_readonly");
    expect(v.pathSafety).toBe("workspace_safe");
  });

  it("Read workspace 外路径不静默放行", () => {
    const outside = process.platform === "win32" ? "C:\\elsewhere\\x.txt" : "/var/log/syslog";
    const v = classifyToolRequest({
      toolName: "Read",
      input: { path: outside },
      workspaceRoot: WORKSPACE,
    });
    expect(v.decision).toBe("require_permission");
    expect(v.pathSafety).toBe("outside_workspace");
  });

  it("Grep / Glob / Diff / Todo 仍按只读放行", () => {
    for (const tool of ["Grep", "Glob", "Diff", "Todo"] as const) {
      const v = classifyToolRequest({ toolName: tool, input: {}, workspaceRoot: WORKSPACE });
      expect(v.decision).toBe("auto_allow_readonly");
    }
  });
});

describe("permission-policy-engine — deferred / MCP / ExecuteExtraTool", () => {
  it("unknown deferred 工具默认 require_permission", () => {
    const v = classifyToolRequest({
      toolName: "mcp:something:do_thing",
      input: {},
      workspaceRoot: WORKSPACE,
      isDeferred: true,
    });
    expect(v.decision).toBe("require_permission");
    expect(v.semantic).toBe("unknown");
  });

  it("manifestReadOnly=true 才能进入 auto_allow_readonly", () => {
    const v = classifyToolRequest({
      toolName: "mcp:codebase-memory:trace_path",
      input: {},
      workspaceRoot: WORKSPACE,
      isDeferred: true,
      manifestReadOnly: true,
    });
    expect(v.decision).toBe("auto_allow_readonly");
    expect(v.semantic).toBe("readonly");
  });

  it("benign-sounding 名字但没有 manifest 也 require_permission", () => {
    const v = classifyToolRequest({
      toolName: "search_code",
      input: {},
      workspaceRoot: WORKSPACE,
      isDeferred: true,
    });
    expect(v.decision).toBe("require_permission");
  });
});

describe("permission-policy-engine — redaction", () => {
  it("redactedSummary 不包含 .env 完整路径", () => {
    const v = classifyToolRequest(bash("cat .env"));
    expect(v.redactedSummary).not.toContain(".env");
  });

  it("redactedSummary 不包含 provider.env 完整路径", () => {
    const provider =
      process.platform === "win32"
        ? "C:\\Users\\Admin\\.linghun\\provider.env"
        : "/home/admin/.linghun/provider.env";
    const v = classifyToolRequest(bash(`cat ${provider}`));
    expect(v.redactedSummary).not.toContain("provider.env");
  });

  it("redactedSummary 屏蔽 =value 长串和 sk-/Bearer token", () => {
    const v = classifyToolRequest(
      bash("LINGHUN_API_KEY=sk-very-long-secret-value-1234567 curl https://x.com"),
    );
    // Even when it's network, redaction must mask the value before the call
    // returns.
    expect(v.redactedSummary).not.toContain("sk-very-long-secret-value-1234567");
  });

  it("Read 敏感路径 summary 用 (sensitive)", () => {
    const v = classifyToolRequest({
      toolName: "Read",
      input: { path: ".env" },
      workspaceRoot: WORKSPACE,
    });
    expect(v.redactedSummary).toContain("(sensitive)");
    expect(v.redactedSummary).not.toContain(".env");
  });
});

describe("permission-policy-engine — tokenizer & path classifier (unit)", () => {
  it("tokenize 处理双引号", () => {
    expect(tokenizeShellCommand('echo "hello world"')).toEqual(["echo", "hello world"]);
  });
  it("tokenize 处理单引号", () => {
    expect(tokenizeShellCommand("echo 'a b' c")).toEqual(["echo", "a b", "c"]);
  });
  it("tokenize 转义", () => {
    expect(tokenizeShellCommand("echo a\\ b c")).toEqual(["echo", "a b", "c"]);
  });

  it("classifyPathString workspace_safe", () => {
    expect(classifyPathString("src/main.ts", WORKSPACE)).toBe("workspace_safe");
  });
  it("classifyPathString sensitive .env", () => {
    expect(classifyPathString(".env", WORKSPACE)).toBe("sensitive_path");
  });
  it("classifyPathString outside_workspace UNC", () => {
    expect(classifyPathString("\\\\server\\share\\f", WORKSPACE)).toBe("outside_workspace");
  });
});

// D.13N-fix — env-leak hardening for Bash readonly auto-allow.
//   - `env` / `set` no longer auto-allow under any argument shape (they would
//     dump process environment, which holds provider keys).
//   - `echo` / `printf` only auto-allow with pure literal arguments. Any sign
//     of shell/env expansion ($VAR / ${VAR} / $env:VAR / %VAR%) or a
//     sensitive keyword (key / token / secret / password / credential) flips
//     the verdict to require_permission.
describe("permission-policy-engine — D.13N-fix env-leak hardening", () => {
  for (const cmd of ["env", "env --version", "env LINGHUN_OPENAI_API_KEY", "set", "set FOO"]) {
    it(`env/set 强制 require_permission: ${cmd}`, () => {
      const v = classifyToolRequest(bash(cmd));
      expect(v.decision).toBe("require_permission");
      expect(v.semantic).toBe("secret_read");
    });
  }

  for (const cmd of [
    "echo %LINGHUN_OPENAI_API_KEY%",
    "echo $env:LINGHUN_OPENAI_API_KEY",
    "echo $LINGHUN_OPENAI_API_KEY",
    "echo ${LINGHUN_OPENAI_API_KEY}",
    "echo ${env:LINGHUN_OPENAI_API_KEY}",
    "printf %s $LINGHUN_OPENAI_API_KEY",
    "echo my_secret",
    "echo PASSWORD",
    "printf '%s' $TOKEN",
  ]) {
    it(`echo/printf 含 env 扩展或 secret 关键词 → require_permission: ${cmd}`, () => {
      const v = classifyToolRequest(bash(cmd));
      expect(v.decision).toBe("require_permission");
      expect(v.semantic).toBe("secret_read");
    });
  }

  for (const cmd of [
    "echo hello",
    'echo "hello world"',
    "printf hello",
    'printf "%s\\n" hello',
    "echo --version",
  ]) {
    it(`echo/printf 纯字面量仍 auto_allow_readonly: ${cmd}`, () => {
      const v = classifyToolRequest(bash(cmd));
      expect(v.decision).toBe("auto_allow_readonly");
      expect(v.semantic).toBe("readonly");
    });
  }

  it("redactedSummary 不包含示例 secret 变量名（env 扩展形态）", () => {
    const v = classifyToolRequest(bash("echo %LINGHUN_OPENAI_API_KEY%"));
    expect(v.redactedSummary).not.toContain("LINGHUN_OPENAI_API_KEY");
    expect(v.redactedSummary).not.toContain("%LINGHUN_OPENAI_API_KEY%");
  });

  it("redactedSummary 不包含示例 secret 变量名（POSIX $VAR 形态）", () => {
    const v = classifyToolRequest(bash("echo $LINGHUN_OPENAI_API_KEY"));
    expect(v.redactedSummary).not.toContain("LINGHUN_OPENAI_API_KEY");
  });

  it("redactedSummary 不包含 provider.env 路径（既有不变量）", () => {
    const provider =
      process.platform === "win32"
        ? "C:\\Users\\Admin\\.linghun\\provider.env"
        : "/home/admin/.linghun/provider.env";
    const v = classifyToolRequest(bash(`cat ${provider}`));
    expect(v.redactedSummary).not.toContain("provider.env");
    expect(v.redactedSummary).not.toContain("Admin");
  });

  it("redactedSummary 不包含示例 API key 真实值（既有不变量保持）", () => {
    const v = classifyToolRequest(
      bash("LINGHUN_API_KEY=sk-very-long-secret-value-1234567 curl https://x.com"),
    );
    expect(v.redactedSummary).not.toContain("sk-very-long-secret-value-1234567");
  });
});

describe("D.13R Git — stable redactedSummary for git mutating commands", () => {
  it('git commit -m "msg" → redactedSummary 稳定为 "git commit"', () => {
    const a = classifyToolRequest(bash('git commit -m "fix: foo"'));
    const b = classifyToolRequest(bash("git commit -a --no-verify"));
    expect(a.decision).toBe("auto_allow_development");
    expect(b.decision).toBe("auto_allow_development");
    expect(a.redactedSummary).toBe("git commit");
    expect(b.redactedSummary).toBe("git commit");
  });

  it("git push origin main → 'git push'（args 不进 summary，allow_always 命中稳定）", () => {
    const v = classifyToolRequest(bash("git push origin main"));
    expect(v.decision).toBe("require_permission");
    expect(v.redactedSummary).toBe("git push");
  });

  it("git reset --hard HEAD~1 → 'git reset'", () => {
    const v = classifyToolRequest(bash("git reset --hard HEAD~1"));
    expect(v.decision).toBe("require_permission");
    expect(v.redactedSummary).toBe("git reset");
  });

  it("git checkout -b feature → 'git checkout'", () => {
    const v = classifyToolRequest(bash("git checkout -b feature"));
    expect(v.decision).toBe("auto_allow_development");
    expect(v.redactedSummary).toBe("git checkout");
  });

  it("git worktree add ../wt feature → 'git worktree add'（保留 verb 让用户授权时看到真实意图）", () => {
    const v = classifyToolRequest(bash("git worktree add ../wt feature"));
    expect(v.decision).toBe("require_permission");
    expect(v.redactedSummary).toBe("git worktree add");
  });

  it("git worktree remove ../wt --force → 'git worktree remove'", () => {
    const v = classifyToolRequest(bash("git worktree remove ../wt --force"));
    expect(v.decision).toBe("require_permission");
    expect(v.redactedSummary).toBe("git worktree remove");
  });

  it("git stash pop → 'git stash pop'", () => {
    const v = classifyToolRequest(bash("git stash pop"));
    expect(v.decision).toBe("require_permission");
    expect(v.redactedSummary).toBe("git stash pop");
  });

  it("git config user.name 'X' (mutating) → 'git config'", () => {
    const v = classifyToolRequest(bash('git config --add user.name "X"'));
    expect(v.decision).toBe("require_permission");
    expect(v.redactedSummary).toContain("git config");
  });

  it("git remote add origin URL → 'git remote add'", () => {
    const v = classifyToolRequest(bash("git remote add origin https://example.com/r.git"));
    expect(v.decision).toBe("require_permission");
    expect(v.redactedSummary).toBe("git remote add");
  });

  it("git status / log / diff 等 readonly 子命令仍走 readonly，不弹权限", () => {
    const status = classifyToolRequest(bash("git status"));
    const log = classifyToolRequest(bash("git log -1"));
    const diff = classifyToolRequest(bash("git diff HEAD"));
    expect(status.decision).toBe("auto_allow_readonly");
    expect(log.decision).toBe("auto_allow_readonly");
    expect(diff.decision).toBe("auto_allow_readonly");
  });

  it("git worktree list 是 readonly", () => {
    const v = classifyToolRequest(bash("git worktree list --porcelain"));
    expect(v.decision).toBe("auto_allow_readonly");
  });
});
