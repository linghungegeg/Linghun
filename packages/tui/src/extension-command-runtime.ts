import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { resetExtensionTrustForInstall, saveExtensionEnablement } from "@linghun/config";
import type { TuiContext } from "./index.js";
import { stableHash } from "./cache-freshness.js";
import { getRuntimeStatusProvider } from "./tui-model-runtime.js";
import { redactedPath, runCommandCapture } from "./process-command-runtime.js";
import { sanitizeDiagnosticText, formatError, truncateDisplay } from "./startup-runtime.js";
import { createHookState, createPluginState, createSkillState, stableId } from "./tui-state-runtime.js";
import type { ExtensionLifecycleRecord, ExtensionScope, ExtensionSource, PluginSummary, SkillEvolutionCandidate, SkillSummary } from "./tui-data-types.js";
export type ExtensionKind = "skills" | "plugins";
export type ExtensionInstallSource = "local" | "git" | "github";
export type ExtensionInstallRequest = { source: ExtensionInstallSource; locator: string; scope: ExtensionScope; ref?: string; confirmNetwork: boolean; };

export function formatConfigOverview(context: TuiContext): string {
  const zh = context.language === "zh-CN";
  const yes = zh ? "是" : "yes";
  const no = zh ? "否" : "no";
  const onOff = (b: boolean) => (b ? yes : no);
  const executor = context.config.modelRoutes.routes.find((r) => r.role === "executor");
  const trust = context.config.workspaceTrust;
  const trustLabel = trust.recorded
    ? trust.level === "trusted"
      ? zh
        ? "已信任"
        : "trusted"
      : zh
        ? "受限"
        : "restricted"
    : zh
      ? "未记录"
      : "unrecorded";
  const mcpServers = context.config.mcp.enabledServers.join(", ") || (zh ? "无" : "none");
  const indexStatus = context.index.status || (zh ? "未知" : "unknown");
  const cacheCount = context.cache.history.length;
  const bgRunning = context.backgroundTasks.filter((t) => t.status === "running").length;
  const skillsTrusted = context.skills.trustedIds.length;
  const pluginsTrusted = context.plugins.trustedIds.length;
  const remoteEnabled = Boolean(
    (context.config as { remote?: { enabled?: boolean } }).remote?.enabled,
  );

  if (zh) {
    return [
      "配置概览（一站式只读）",
      `- 语言：${context.config.language}（用 /language en-US 切换）`,
      `- 模型：${context.model}（执行器 allowTools=${onOff(Boolean(executor?.allowTools))}；用 /model、/model doctor、/model route 查看与诊断）`,
      `- 权限模式：${context.permissionMode}（用 /mode 切换；规则用 /permissions）`,
      `- 工作区信任：${trustLabel}（用 /trust 调整）`,
      `- 索引：${indexStatus}（用 /index status、/index doctor、/index check）`,
      `- MCP：启用=${mcpServers}（用 /mcp、/mcp doctor、/mcp tools）`,
      "- 记忆：用 /memory、/memory storage、/memory review、/memory learn",
      `- 缓存：history=${cacheCount}（用 /cache status、/cache-log、/usage、/stats）`,
      `- 后台：running=${bgRunning}（用 /background、/job、/details）`,
      `- 远程：enabled=${onOff(remoteEnabled)}（用 /remote）`,
      `- 钩子：enabled=${onOff(context.hooks.enabled)}；项目信任=${onOff(context.hooks.projectTrusted)}（用 /doctor hooks）`,
      `- 插件：discover=${onOff(context.plugins.enabled)}；信任 id 数=${pluginsTrusted}（用 /plugins、/plugins doctor）`,
      `- 技能：discover=${onOff(context.skills.enabled)}；信任 id 数=${skillsTrusted}（用 /skills、/skills status）`,
      `- 工作流：discover=${onOff(context.workflows.enabled)}（用 /workflows）`,
      "下一步：直接输入对应 slash 进入；用 /features 查看默认功能策略，用 /help all 查看完整命令表。",
    ].join("\n");
  }
  return [
    "Configuration overview (one-stop read-only)",
    `- language: ${context.config.language} (switch via /language en-US)`,
    `- model: ${context.model} (executor allowTools=${onOff(Boolean(executor?.allowTools))}; use /model, /model doctor, /model route)`,
    `- permission mode: ${context.permissionMode} (switch via /mode; rules via /permissions)`,
    `- workspace trust: ${trustLabel} (adjust via /trust)`,
    `- index: ${indexStatus} (use /index status, /index doctor, /index check)`,
    `- MCP: enabled=${mcpServers} (use /mcp, /mcp doctor, /mcp tools)`,
    "- memory: use /memory, /memory storage, /memory review, /memory learn",
    `- cache: history=${cacheCount} (use /cache status, /cache-log, /usage, /stats)`,
    `- background: running=${bgRunning} (use /background, /job, /details)`,
    `- remote: enabled=${onOff(remoteEnabled)} (use /remote)`,
    `- hooks: enabled=${onOff(context.hooks.enabled)}; projectTrusted=${onOff(context.hooks.projectTrusted)} (use /doctor hooks)`,
    `- plugins: discover=${onOff(context.plugins.enabled)}; trustedIds=${pluginsTrusted} (use /plugins, /plugins doctor)`,
    `- skills: discover=${onOff(context.skills.enabled)}; trustedIds=${skillsTrusted} (use /skills, /skills status)`,
    `- workflows: discover=${onOff(context.workflows.enabled)} (use /workflows)`,
    "Next: type the slash to enter the panel. /features for default policy. /help all for the full command list.",
  ].join("\n");
}



export function formatFeaturePolicy(context: TuiContext): string {
  return [
    "Feature policy（default CCB-style posture）",
    "Recommended foundation（default on / visible）",
    `- language: ${context.config.language}; en-US available via /language en-US`,
    `- model/tool loop: enabled through provider tools=${context.config.modelRoutes.routes.find((route) => route.role === "executor")?.allowTools ? "yes" : "no"}; evidence and long output are kept in details, available via /details`,
    `- cache/stats: /cache status, /break-cache status, /usage, /stats; history=${context.cache.history.length}`,
    `- model doctor: /model doctor and /model route doctor; provider=${getRuntimeStatusProvider(context)} model=${context.model}`,
    "- index: status/search/architecture are readonly; init fast/refresh are safe local actions with safety scan; auto full-repo index on startup=no",
    `- codebase-memory MCP: discoverable/diagnosable via /mcp doctor; enabledServers=${context.config.mcp.enabledServers.join(",") || "none"}`,
    `- permissions: project allowlist visible via /permissions; defaultMode=${context.permissionMode}`,
    "Advanced/high-cost/automation（discoverable, not auto-run）",
    "- memory: auto long-term extraction=no; autoAccept=no; review via /memory review",
    `- skills: discover manifests=${context.skills.enabled ? "yes" : "no"}; autoExecute=no; trustedIds=${context.skills.trustedIds.join(",") || "none"}`,
    `- workflows: discover templates=${context.workflows.enabled ? "yes" : "no"}; autoRun=no; /workflows <name> only shows Start Gate`,
    `- plugins: discover manifests=${context.plugins.enabled ? "yes" : "no"}; autoExecute=no; trustedIds=${context.plugins.trustedIds.join(",") || "none"}`,
    "- agents/background: manual commands only; verifier auto fork=no; coordinator/multi-worker=unsupported",
    "Dangerous defaults（off）",
    "- full-access permission: default off; requires LINGHUN_ENABLE_FULL_ACCESS=1; auto-review never auto-allows Bash/network/deps/permission/plugin/hook/remote",
    `- hooks: enabled=${context.hooks.enabled ? "yes" : "no"}; projectTrusted=${context.hooks.projectTrusted ? "yes" : "no"}; auto execution=no`,
    "- auto accept all edits=no; auto dependency install=no; auto networking=no; delete/rename/restore auto execution=no",
    "- plugin marketplace auto install/update=no; remote bridge/control auto connect=no; continuous phase progression=no",
    "Unsupported / pending",
    "- remote channels, voice, computer-use/browser control, daemon jobs, plugin marketplace, and AI sessions auto injection are not default features.",
  ].join("\n");
}



export function formatSkills(context: TuiContext): string {
  const lines = [
    "Skills（summary-first / load-on-demand）",
    `- projectDir: ${context.skills.projectDir}`,
    `- userDir: ${context.skills.userDir}`,
    `- enabled: ${context.skills.enabled ? "yes" : "no"}`,
    `- evolutionCandidates: ${context.skills.evolutionCandidates.length}（candidate only; autoEnable=no）`,
  ];
  if (context.skills.lastError) {
    lines.push(`- lastError: ${context.skills.lastError}`);
  }
  if (context.skills.skills.length === 0) {
    lines.push(
      "- none：可运行 /skills add 查看注册路径，或 /skills install local <path> 安装本地 skill manifest。",
    );
  }
  for (const skill of context.skills.skills) {
    const error = skill.lastError ? ` lastError=${skill.lastError}` : "";
    lines.push(
      `- ${skill.id}: ${skill.enabled ? "enabled" : "disabled"} trusted=${skill.trusted ? "yes" : "no"} source=${skill.source} scope=${skill.scope} version=${skill.version} triggers=${skill.triggers.join(",") || "-"} write=${skill.mayWrite ? "yes" : "no"} bash=${skill.mayExecute ? "yes" : "no"} network=${skill.mayNetwork ? "yes" : "no"} summary=${skill.summary}${error}`,
    );
  }
  lines.push(
    "- note: 默认只加载 metadata/description/triggers/stable summary；不会把 skill 正文塞进 prompt；evolution candidate 只记录建议，不写文件、不启用。",
  );
  return lines.join("\n");
}



export function createSkillEvolutionCandidate(summary: string, source: string): SkillEvolutionCandidate {
  return {
    id: randomUUID(),
    status: "candidate",
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 240),
    triggerCondition: "repeated verified workflow success or explicit user request",
    source,
    risk: "medium",
    suggestedPath:
      "manual-review-only; use /skills install local <path> after creating a trusted manifest",
    createdAt: new Date().toISOString(),
  };
}



export function formatWorkflows(context: TuiContext): string {
  return [
    "Workflows（本地模板，启动前必须 Start Gate）",
    ...context.workflows.templates.map(
      (item) =>
        `- ${item.id}: purpose=${item.purpose} risk=${item.risk} writesFiles=${item.writesFiles ? "yes" : "no"} validation=${item.recommendedValidation.join(" | ")}`,
    ),
    "- run: /workflows <name> 只进入启动确认说明；写文件/Bash/联网/安装依赖仍走权限管道。",
  ].join("\n");
}



export function formatPlugins(context: TuiContext): string {
  const lines = [
    "Plugins（本地 manifest loader）",
    `- projectDir: ${context.plugins.projectDir}`,
    `- userDir: ${context.plugins.userDir}`,
    `- enabled: ${context.plugins.enabled ? "yes" : "no"}`,
  ];
  if (context.plugins.lastError) {
    lines.push(`- lastError: ${context.plugins.lastError}`);
  }
  if (context.plugins.plugins.length === 0) {
    lines.push(
      "- none：把本地 manifest 放到 project/user plugins 目录，或运行 /plugins install local <path>；Git/GitHub 仅支持受控 metadata 安装。",
    );
  }
  for (const plugin of context.plugins.plugins) {
    lines.push(
      `- ${plugin.id}: ${plugin.enabled ? "enabled" : "disabled"} trusted=${plugin.trusted ? "yes" : "no"} source=${plugin.source} scope=${plugin.scope} version=${plugin.version} write=${plugin.mayWrite ? "yes" : "no"} bash=${plugin.mayExecute ? "yes" : "no"} network=${plugin.mayNetwork ? "yes" : "no"} commands=${plugin.contributions.commands.join(",") || "-"} hooks=${plugin.contributions.hooks.join(",") || "-"} workflows=${plugin.contributions.workflows.join(",") || "-"} skills=${plugin.contributions.skills.join(",") || "-"}`,
    );
  }
  lines.push("- note: plugin 贡献项稳定排序；贡献工具仍走统一权限管道，加载失败隔离。");
  return lines.join("\n");
}



export function formatPluginsDoctor(context: TuiContext): string {
  return [
    "Plugins doctor",
    `- manifest count: ${context.plugins.plugins.length}`,
    `- disabledIds: ${context.plugins.disabledIds.join(",") || "none"}`,
    `- trustedIds: ${context.plugins.trustedIds.join(",") || "none"}`,
    ...context.plugins.plugins.map((plugin) => {
      const risk = !plugin.trusted ? `BLOCK untrusted ${plugin.source}` : "ok";
      const error = plugin.lastError ? ` lastError=${plugin.lastError}` : "";
      return `- ${plugin.id}: ${risk} path=${plugin.path} permissions=${plugin.permissions.join(",") || "none"}${error}`;
    }),
    "- boundary: 不执行远程安装/自动更新/完整沙箱；未信任 extension 不得写文件、联网或执行命令。",
  ].join("\n");
}



export function formatHooksDoctor(context: TuiContext): string {
  const cacheImpact = stableHash(createExtensionFreshnessSummaryForDoctor(context));
  const lines = [
    "Hooks doctor",
    `- hooks enabled: ${context.hooks.enabled ? "yes" : "no"}（默认关闭）`,
    `- projectTrusted: ${context.hooks.projectTrusted ? "yes" : "no"}`,
    `- timeoutMs: ${context.hooks.timeoutMs}`,
    `- outputLimitBytes: ${context.hooks.outputLimitBytes}`,
    `- cacheImpactHash: ${cacheImpact}`,
  ];
  if (context.hooks.hooks.length === 0) {
    lines.push("- hooks: none");
  }
  for (const hook of context.hooks.hooks) {
    lines.push(
      `- ${hook.id}: event=${hook.event} enabled=${hook.enabled ? "yes" : "no"} trusted=${hook.trusted ? "yes" : "no"} source=${hook.source} scope=${hook.scope} path=${hook.path} timeoutMs=${hook.timeoutMs} outputLimitBytes=${hook.outputLimitBytes} permissions=${hook.permissions.join(",") || "none"} logPath=${hook.logPath ?? "-"} lastError=${hook.lastError ?? "none"}`,
    );
  }
  lines.push(
    "- boundary: hook 诊断只检查来源、边界和可见状态，不执行完整 hook 脚本；hook 不能绕过权限系统；失败隔离；显示输出按 outputLimitBytes 截断，完整输出只能写 logPath。",
  );
  return lines.join("\n");
}



export function formatTrustNotice(kind: "skill" | "plugin", item: SkillSummary | PluginSummary): string {
  return [
    `Trust notice：即将启用 ${kind} ${item.id}`,
    `- source: ${item.source}`,
    `- path: ${item.path}`,
    `- version: ${item.version}`,
    `- sourceUrl: ${item.lifecycle.sourceUrl ? sanitizeDiagnosticText(item.lifecycle.sourceUrl) : "-"}`,
    `- ref/commit: ${item.lifecycle.ref ?? "-"}/${item.lifecycle.commit ?? "-"}`,
    `- installedAt: ${item.lifecycle.installedAt ?? "unknown"}`,
    `- permissions: ${item.permissions.join(",") || "none"}`,
    `- trust: ${item.trusted ? "trusted" : "untrusted"}`,
    `- mayWrite=${item.mayWrite ? "yes" : "no"} mayExecute=${item.mayExecute ? "yes" : "no"} mayNetwork=${item.mayNetwork ? "yes" : "no"}`,
    "- 未信任 extension 不得写文件、联网或执行命令；实际工具调用仍走权限管道。",
  ].join("\n");
}



export function formatExtensionStatus(kind: ExtensionKind, context: TuiContext): string {
  const items = kind === "skills" ? context.skills.skills : context.plugins.plugins;
  const title = kind === "skills" ? "Skills Connect Lite status" : "Plugins Connect Lite status";
  const disabledIds = kind === "skills" ? context.skills.disabledIds : context.plugins.disabledIds;
  const trustedIds = kind === "skills" ? context.skills.trustedIds : context.plugins.trustedIds;
  return [
    title,
    "- lifecycle: add/install, validate, enable/disable, remove/update, trust notice, doctor/status",
    `- installed: ${items.length}`,
    `- disabledIds: ${disabledIds.join(",") || "none"}`,
    `- trustedIds: ${trustedIds.join(",") || "none"}`,
    ...items.map((item) => {
      const source = item.lifecycle.sourceUrl
        ? `sourceUrl=${sanitizeDiagnosticText(item.lifecycle.sourceUrl)}`
        : `localPath=${redactedPath(item.lifecycle.localPath)}`;
      return `- ${item.id}: ${item.enabled ? "enabled" : "disabled"} trust=${item.lifecycle.trustLevel} ${source} ref=${item.lifecycle.ref ?? "-"} commit=${item.lifecycle.commit ?? "-"} permissions=${item.lifecycle.permissionSummary} discovered=${item.lifecycle.discovered ? "yes" : "no"} registered=${item.lifecycle.registered ? "yes" : "no"} schemaLoaded=${item.lifecycle.schemaLoaded ? "yes" : "no"} runtime=${item.lifecycle.runtimeVersion}${item.lastError ? ` loadError=${truncateDisplay(item.lastError, 80)}` : ""}`;
    }),
    "- boundary: Git/GitHub 安装只做受控 clone/fetch 和 manifest/SKILL.md 读取；不执行 postinstall、hook、仓库脚本或第三方代码。",
  ].join("\n");
}



export function parseExtensionInstallRequest(args: string[]): ExtensionInstallRequest | null {
  const [first, second, ...remaining] = args;
  if (!first) {
    return null;
  }
  let source: ExtensionInstallSource;
  let locator: string;
  let rest: string[];
  if (first === "local" || first === "git" || first === "github") {
    if (!second) {
      return null;
    }
    source = first;
    locator = second;
    rest = remaining;
  } else if (first.startsWith("github:")) {
    source = "github";
    locator = first.slice("github:".length);
    rest = [second, ...remaining].filter((item): item is string => Boolean(item));
  } else if (isGitLocator(first)) {
    source = "git";
    locator = first;
    rest = [second, ...remaining].filter((item): item is string => Boolean(item));
  } else {
    source = "local";
    locator = first;
    rest = [second, ...remaining].filter((item): item is string => Boolean(item));
  }
  if (!locator) {
    return null;
  }
  let scope: ExtensionScope = "project";
  let ref: string | undefined;
  let confirmNetwork = false;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--scope" && (rest[index + 1] === "project" || rest[index + 1] === "user")) {
      scope = rest[index + 1] as ExtensionScope;
      index += 1;
      continue;
    }
    if (value === "--ref" && rest[index + 1]) {
      ref = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--confirm-network") {
      confirmNetwork = true;
    }
  }
  return { source, locator, scope, ref, confirmNetwork };
}



export function isGitLocator(value: string): boolean {
  return /^https?:\/\//iu.test(value) || /^git@/iu.test(value) || value.endsWith(".git");
}



export function formatExtensionInstallGate(
  kind: ExtensionKind,
  request: ExtensionInstallRequest,
  command: string,
): string {
  return [
    `Connect Lite Start Gate：${kind} install ${request.source}`,
    `- source: ${sanitizeDiagnosticText(request.locator)}`,
    `- scope: ${request.scope}`,
    `- ref: ${request.ref ?? "default"}`,
    "- risk: network + third-party extension metadata; install 前只读取 manifest / SKILL.md / metadata。",
    "- boundary: 不执行仓库脚本、postinstall、hook、依赖安装或任意第三方代码。",
    "- recovery: 失败不会覆盖已有启用项；可运行 status/doctor 查看来源、加载错误和下一步。",
    "- permission: --confirm-network 是 exact-command Start Gate confirmation，不是完整 permission approval；后续工具/Bash/联网仍走权限管道，确认执行会写入 audit event。",
    `- exact command: ${formatExtensionInstallExactCommand(command, request)}`,
  ].join("\n");
}



export function formatExtensionInstallExactCommand(
  command: string,
  request: ExtensionInstallRequest,
): string {
  const parts = [command];
  if (!/\supdate\s/u.test(command)) {
    parts.push(request.source, request.locator);
    if (request.scope !== "project") {
      parts.push("--scope", request.scope);
    }
  }
  if (request.ref) {
    parts.push("--ref", request.ref);
  }
  parts.push("--confirm-network");
  return parts.join(" ");
}



export async function installExtensionFromRequest(
  kind: ExtensionKind,
  request: ExtensionInstallRequest,
  context: TuiContext,
  onNetworkConfirmed?: (summary: string) => Promise<void>,
): Promise<{ ok: false; summary: string } | { ok: true; summary: string; id: string }> {
  const targetDir = getExtensionTargetDir(kind, request.scope, context);
  await mkdir(targetDir, { recursive: true });
  if (request.source === "local") {
    const localPath = resolve(context.projectPath, request.locator);
    const result = await installExtensionFromDirectory(kind, localPath, targetDir, {
      localPath,
      source: "local",
    });
    if (result.ok) {
      context.config = await resetExtensionTrustForInstall(kind, result.id, context.projectPath);
    }
    return result;
  }
  if (request.confirmNetwork) {
    await onNetworkConfirmed?.(
      `connect_lite_network_start_gate_confirmed: kind=${kind} source=${request.source} scope=${request.scope} ref=${request.ref ?? "default"} locator=${sanitizeDiagnosticText(request.locator)} boundary=exact-command_start_gate_not_full_permission_approval`,
    );
  }
  if (!request.confirmNetwork) {
    return { ok: false, summary: "network confirmation required" };
  }
  const sourceUrl =
    request.source === "github" ? githubRepoToUrl(request.locator) : request.locator;
  if (!sourceUrl) {
    return { ok: false, summary: "GitHub repo 格式应为 owner/repo，或使用完整 Git URL。" };
  }
  const tempRoot = await mkdtemp(join(tmpdir(), "linghun-connect-lite-"));
  try {
    const cloneArgs = ["-c", "core.hooksPath=/dev/null", "clone", "--depth", "1"];
    if (request.ref) {
      cloneArgs.push("--branch", request.ref);
    }
    cloneArgs.push("--", sourceUrl, tempRoot);
    const clone = await runCommandCapture("git", cloneArgs, context.projectPath, 60_000);
    if (clone.exitCode !== 0) {
      return { ok: false, summary: `受控 git clone/fetch 失败：${clone.summary}` };
    }
    const commit = await runCommandCapture(
      "git",
      ["-C", tempRoot, "rev-parse", "HEAD"],
      context.projectPath,
      10_000,
    );
    const result = await installExtensionFromDirectory(kind, tempRoot, targetDir, {
      sourceUrl,
      ref: request.ref,
      commit: commit.exitCode === 0 ? commit.stdout.trim().slice(0, 40) : undefined,
    });
    if (result.ok) {
      context.config = await resetExtensionTrustForInstall(kind, result.id, context.projectPath);
    }
    return result;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}



export function githubRepoToUrl(locator: string): string | null {
  if (/^https?:\/\//iu.test(locator) || locator.endsWith(".git")) {
    return locator;
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(locator)) {
    return `https://github.com/${locator}.git`;
  }
  return null;
}



export function getExtensionTargetDir(
  kind: ExtensionKind,
  scope: ExtensionScope,
  context: TuiContext,
): string {
  if (kind === "skills") {
    return scope === "project" ? context.skills.projectDir : context.skills.userDir;
  }
  return scope === "project" ? context.plugins.projectDir : context.plugins.userDir;
}



export async function installExtensionFromDirectory(
  kind: ExtensionKind,
  sourcePath: string,
  targetDir: string,
  lifecycle: Pick<ExtensionLifecycleRecord, "sourceUrl" | "localPath" | "ref" | "commit"> & {
    source?: ExtensionSource;
  },
): Promise<{ ok: false; summary: string } | { ok: true; summary: string; id: string }> {
  const manifest = await readExtensionSourceManifest(kind, sourcePath);
  if (!manifest.ok) {
    return manifest;
  }
  const id = stableId(manifest.value.id, basename(sourcePath, extname(sourcePath)));
  const outputPath = join(targetDir, `${id}.json`);
  const value = {
    ...manifest.value,
    id,
    source: lifecycle.source ?? manifest.value.source ?? "third-party",
    lifecycle: {
      ...lifecycle,
      installedAt: new Date().toISOString(),
      trustLevel: "untrusted",
    },
  };
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return {
    ok: true,
    id,
    summary: `已安装 ${kind === "skills" ? "skill" : "plugin"} manifest：${id}`,
  };
}



export async function readExtensionSourceManifest(
  kind: ExtensionKind,
  sourcePath: string,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; summary: string }> {
  const resolved = resolve(sourcePath);
  const info = await stat(resolved).catch(() => null);
  if (!info) {
    return { ok: false, summary: `来源不存在：${redactedPath(resolved)}` };
  }
  const candidates = info.isDirectory()
    ? [
        kind === "skills" ? "skill.json" : "plugin.json",
        kind === "skills" ? "linghun-skill.json" : "linghun-plugin.json",
        "manifest.json",
        "metadata.json",
      ].map((file) => join(resolved, file))
    : [resolved];
  for (const candidate of candidates) {
    const content = await readFile(candidate, "utf8").catch(() => null);
    if (!content) {
      continue;
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return { ok: true, value: parsed };
    } catch (error) {
      return {
        ok: false,
        summary: `manifest JSON 无效：${redactedPath(candidate)} ${formatError(error)}`,
      };
    }
  }
  if (kind === "skills" && info.isDirectory()) {
    const markdown = await readFile(join(resolved, "SKILL.md"), "utf8").catch(() => null);
    if (markdown) {
      const title = markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? basename(resolved);
      const summary = markdown
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#"));
      return {
        ok: true,
        value: {
          id: stableId(title, basename(resolved)),
          name: title,
          description: summary ?? title,
          summary: summary ?? title,
          triggers: [],
          permissions: ["read"],
        },
      };
    }
  }
  return {
    ok: false,
    summary:
      "未找到 manifest.json / metadata.json / skill.json / plugin.json；skill 可提供 SKILL.md。",
  };
}



export async function refreshExtensionState(kind: ExtensionKind, context: TuiContext): Promise<void> {
  if (kind === "skills") {
    context.skills = await createSkillState(context.config, context.projectPath);
    return;
  }
  context.plugins = await createPluginState(context.config, context.projectPath);
  context.hooks = await createHookState(context.config, context.projectPath);
}



export async function removeExtension(
  kind: ExtensionKind,
  id: string,
  context: TuiContext,
): Promise<string> {
  const item =
    kind === "skills"
      ? context.skills.skills.find((skill) => skill.id === id)
      : context.plugins.plugins.find((plugin) => plugin.id === id);
  if (!item) {
    return `未找到 ${kind === "skills" ? "skill" : "plugin"}：${id}`;
  }
  await rm(item.path, { force: true });
  context.config = await saveExtensionEnablement(kind, id, false, context.projectPath);
  await refreshExtensionState(kind, context);
  return `已移除 ${kind === "skills" ? "skill" : "plugin"}：${id}；若需要恢复，请从原 source 重新 install。`;
}



export async function updateExtension(
  kind: ExtensionKind,
  id: string,
  context: TuiContext,
  args: string[],
  onNetworkConfirmed?: (summary: string) => Promise<void>,
): Promise<string> {
  const item =
    kind === "skills"
      ? context.skills.skills.find((skill) => skill.id === id)
      : context.plugins.plugins.find((plugin) => plugin.id === id);
  if (!item) {
    return `未找到 ${kind === "skills" ? "skill" : "plugin"}：${id}`;
  }
  const source = item.lifecycle.sourceUrl ? "git" : "local";
  const request: ExtensionInstallRequest = {
    source,
    locator: item.lifecycle.sourceUrl ?? item.lifecycle.localPath ?? item.path,
    scope: item.scope,
    ref: args.includes("--ref") ? args[args.indexOf("--ref") + 1] : item.lifecycle.ref,
    confirmNetwork: args.includes("--confirm-network"),
  };
  if (source === "git" && !request.confirmNetwork) {
    return formatExtensionInstallGate(kind, request, `/${kind} update ${id}`);
  }
  const result = await installExtensionFromRequest(kind, request, context, onNetworkConfirmed);
  if (result.ok) {
    await refreshExtensionState(kind, context);
    return `已更新 ${kind === "skills" ? "skill" : "plugin"}：${id}；${result.summary}`;
  }
  return result.summary;
}



export function validateExtensionItems(kind: ExtensionKind, context: TuiContext, id?: string): string {
  const items = kind === "skills" ? context.skills.skills : context.plugins.plugins;
  const selected = id ? items.filter((item) => item.id === id) : items;
  if (selected.length === 0) {
    return id
      ? `未找到 ${kind === "skills" ? "skill" : "plugin"}：${id}`
      : `没有已发现的 ${kind} manifest。`;
  }
  return [
    `${kind === "skills" ? "Skills" : "Plugins"} validate`,
    ...selected.map((item) => {
      const problems = [];
      if (!item.lifecycle.discovered) problems.push("not discovered");
      if (!item.lifecycle.registered) problems.push("not registered");
      if (!item.trusted) problems.push("untrusted");
      if (!item.lifecycle.schemaLoaded) problems.push("schema not loaded");
      if (item.lifecycle.runtimeVersion !== "compatible") problems.push("runtime incompatible");
      if (item.lastError) problems.push("load error");
      return `- ${item.id}: ${problems.length === 0 ? "ok" : problems.join("; ")} next=${problems.length === 0 ? "enable/use explicit command" : `run /${kind} doctor, then validate/enable after fixing`}`;
    }),
  ].join("\n");
}



export function validateExtensionContributionExecution(
  kind: ExtensionKind,
  id: string,
  contribution: string,
  context: Pick<TuiContext, "plugins" | "skills">,
): { ok: true } | { ok: false; summary: string } {
  const item =
    kind === "skills"
      ? context.skills.skills.find((skill) => skill.id === id)
      : context.plugins.plugins.find((plugin) => plugin.id === id);
  if (!item) {
    return {
      ok: false,
      summary: `Connect Lite guard: ${kind}:${id} 未发现，已拒绝执行。请先 install/validate。`,
    };
  }
  if (!item.enabled || !item.trusted) {
    return {
      ok: false,
      summary: `Connect Lite guard: ${kind}:${id} 未启用或未信任，已拒绝执行。请先 validate/enable/doctor。`,
    };
  }
  if (!item.lifecycle.discovered || !item.lifecycle.registered || !item.lifecycle.schemaLoaded) {
    return {
      ok: false,
      summary: `Connect Lite guard: ${kind}:${id} 尚未完成 discover/register/schema load，已拒绝执行。请先 validate/doctor。`,
    };
  }
  if (item.lifecycle.runtimeVersion !== "compatible") {
    return {
      ok: false,
      summary: `Connect Lite guard: ${kind}:${id} runtimeVersion=${item.lifecycle.runtimeVersion} 不兼容，已拒绝执行。请 update 或 disable。`,
    };
  }
  if (kind === "skills") {
    const skill = item as SkillSummary;
    if (!skill.triggers.includes(contribution)) {
      return {
        ok: false,
        summary: `Connect Lite guard: skill:${id} 未注册触发项 ${contribution}，已拒绝盲执行。`,
      };
    }
    return { ok: true };
  }
  const plugin = item as PluginSummary;
  const contributions = Object.values(plugin.contributions).flat();
  if (!contributions.includes(contribution)) {
    return {
      ok: false,
      summary: `Connect Lite guard: plugin:${id} 未注册贡献项 ${contribution}，已拒绝盲执行。`,
    };
  }
  return { ok: true };
}

function createExtensionFreshnessSummaryForDoctor(context: TuiContext): Record<string, unknown> {
  return {
    skills: context.skills.skills
      .map((skill) => ({
        id: skill.id,
        enabled: skill.enabled,
        source: skill.source,
        trusted: skill.trusted,
        triggers: skill.triggers,
        summary: skill.summary,
        permissions: skill.permissions,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    workflows: context.workflows.templates
      .map((workflow) => ({
        id: workflow.id,
        risk: workflow.risk,
        writesFiles: workflow.writesFiles,
        validation: workflow.recommendedValidation,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    hooks: context.hooks.hooks
      .map((hook) => ({
        id: hook.id,
        event: hook.event,
        enabled: hook.enabled,
        trusted: hook.trusted,
        permissions: hook.permissions,
      }))
      .sort((a, b) => `${a.event}:${a.id}`.localeCompare(`${b.event}:${b.id}`)),
    plugins: context.plugins.plugins
      .map((plugin) => ({
        id: plugin.id,
        enabled: plugin.enabled,
        source: plugin.source,
        trusted: plugin.trusted,
        permissions: plugin.permissions,
        contributions: plugin.contributions,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}


