import type { Writable } from "node:stream";
import { saveExtensionEnablement } from "@linghun/config";
import { showCommandPanel } from "./command-panel-runtime.js";
import {
  createSkillEvolutionCandidate,
  formatExtensionInstallGate,
  formatExtensionStatus,
  formatPlugins,
  formatPluginsDoctor,
  formatSkills,
  formatTrustNotice,
  installExtensionFromRequest,
  parseExtensionInstallRequest,
  removeExtension,
  updateExtension,
  validateExtensionItems,
} from "./extension-command-runtime.js";
import type { TuiContext } from "./index.js";
import { writeLine } from "./startup-runtime.js";
import { createHookState, createPluginState, createSkillState } from "./tui-state-runtime.js";

export type ExtensionSlashRuntimeDeps = {
  appendSystemEvent: (
    context: TuiContext,
    sessionId: string,
    message: string,
    level: "info" | "warning",
  ) => Promise<void>;
  ensureSession: (context: TuiContext) => Promise<string>;
  refreshCacheFreshness: (context: TuiContext) => void;
};

let runtimeDeps: ExtensionSlashRuntimeDeps | undefined;

export function configureExtensionSlashRuntime(deps: ExtensionSlashRuntimeDeps): void {
  runtimeDeps = deps;
}

function deps(): ExtensionSlashRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error("extension-slash-runtime deps not configured");
  }
  return runtimeDeps;
}

export async function handleSkillsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action) {
    // D.13Q-UX Task Surface — /skills 默认走降噪 CommandPanel。
    const isEn = context.language === "en-US";
    const total = context.skills.skills.length;
    const enabled = context.skills.skills.filter((s) => s.enabled).length;
    showCommandPanel(context, output, {
      title: "/skills",
      tone: "neutral",
      summary: [
        isEn
          ? `Skills · ${total} total · ${enabled} enabled`
          : `技能 · 共 ${total} · 启用 ${enabled}`,
      ],
      actions: ["/skills status", "/skills doctor"],
      detailsText: formatSkills(context),
    });
    return;
  }
  if (action === "status") {
    showCommandPanel(context, output, {
      title: "/skills status",
      tone: "neutral",
      summary: [],
      detailsText: formatExtensionStatus("skills", context),
    });
    return;
  }
  if (action === "doctor") {
    // D.14D-E — /skills doctor 走降噪 CommandPanel：完整校验进 detailsText。
    showCommandPanel(context, output, {
      title: "/skills doctor",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? "Skills doctor — Ctrl+O for details."
          : "技能诊断 — Ctrl+O 查看详情。",
      ],
      detailsText: validateExtensionItems("skills", context),
    });
    return;
  }
  if (action === "add" || action === "install") {
    const request = parseExtensionInstallRequest(args.slice(1));
    if (!request) {
      writeLine(
        output,
        [
          "Skills install（Connect Lite）",
          `- project: ${context.skills.projectDir}`,
          `- user: ${context.skills.userDir}`,
          "- usage: /skills install local <path> [--scope project|user]",
          "- usage: /skills install git <url> [--ref <ref>] --confirm-network",
          "- usage: /skills install github <owner/repo> [--ref <ref>] --confirm-network",
          "- install 前只读取 manifest / SKILL.md / metadata；不执行第三方代码。",
        ].join("\n"),
      );
      return;
    }
    if (request.source !== "local" && !request.confirmNetwork) {
      writeLine(output, formatExtensionInstallGate("skills", request, "/skills install"));
      return;
    }
    const result = await installExtensionFromRequest(
      "skills",
      request,
      context,
      async (summary) => {
        await deps().appendSystemEvent(
          context,
          await deps().ensureSession(context),
          summary,
          "info",
        );
      },
    );
    context.skills = await createSkillState(context.config, context.projectPath);
    deps().refreshCacheFreshness(context);
    writeLine(output, result.summary);
    return;
  }
  if (action === "validate") {
    // D.14D-E — /skills validate 走降噪 CommandPanel：完整校验进 detailsText。
    showCommandPanel(context, output, {
      title: "/skills validate",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? "Skills validate — Ctrl+O for details."
          : "技能校验 — Ctrl+O 查看详情。",
      ],
      detailsText: validateExtensionItems("skills", context, args[1]),
    });
    return;
  }
  if (action === "evolve") {
    const summary = args.slice(1).join(" ").trim();
    if (!summary) {
      writeLine(
        output,
        [
          "Skill evolution candidates（不会自动启用）",
          "- auto enable no; writes files no; trust changes no",
          `- candidates: ${context.skills.evolutionCandidates.length}`,
          ...context.skills.evolutionCandidates.map(
            (item) =>
              `  - ${item.id}: risk ${item.risk}; trigger ${item.triggerCondition}; suggested path ${item.suggestedPath}; summary ${item.summary}`,
          ),
          "- usage: /skills evolve candidate <summary> | /skills evolve reject <id>",
        ].join("\n"),
      );
      return;
    }
    if (args[1] === "reject") {
      const id = args[2];
      const candidate = context.skills.evolutionCandidates.find((item) => item.id === id);
      if (!candidate) {
        writeLine(output, "未找到 skill evolution candidate。用法：/skills evolve reject <id>");
        return;
      }
      context.skills.evolutionCandidates = context.skills.evolutionCandidates.filter(
        (item) => item.id !== id,
      );
      context.skills.rejectedEvolutionCandidates.unshift({ ...candidate, status: "rejected" });
      const sessionId = await deps().ensureSession(context);
      await deps().appendSystemEvent(
        context,
        sessionId,
        `skill evolution: action rejected; id ${candidate.id}; source ${candidate.source}`,
        "info",
      );
      writeLine(output, `已拒绝 skill evolution candidate：${id}；不会生成或启用 skill。`);
      return;
    }
    if (args[1] !== "candidate") {
      writeLine(
        output,
        "用法：/skills evolve | /skills evolve candidate <summary> | /skills evolve reject <id>。不会自动写文件、安装、信任或启用。",
      );
      return;
    }
    const candidateSummary = args.slice(2).join(" ").trim();
    if (!candidateSummary) {
      writeLine(output, "用法：/skills evolve candidate <summary>");
      return;
    }
    const candidate = createSkillEvolutionCandidate(
      candidateSummary,
      "manual /skills evolve candidate",
    );
    context.skills.evolutionCandidates.unshift(candidate);
    const sessionId = await deps().ensureSession(context);
    await deps().appendSystemEvent(
      context,
      sessionId,
      `skill evolution: action candidate; id ${candidate.id}; source ${candidate.source}`,
      "info",
    );
    writeLine(
      output,
      `已创建 skill evolution candidate：${candidate.id}；不会自动写文件、安装、信任或启用。建议路径：${candidate.suggestedPath}`,
    );
    return;
  }
  if (action === "remove") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await removeExtension("skills", id, context).then((summary) => {
            deps().refreshCacheFreshness(context);
            return summary;
          })
        : "用法：/skills remove <id>",
    );
    return;
  }
  if (action === "update") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await updateExtension("skills", id, context, args.slice(2), async (summary) => {
            await deps().appendSystemEvent(
              context,
              await deps().ensureSession(context),
              summary,
              "info",
            );
          }).then((summary) => {
            deps().refreshCacheFreshness(context);
            return summary;
          })
        : "用法：/skills update <id> [--ref <ref>] [--confirm-network]",
    );
    return;
  }
  if (action === "enable" || action === "disable") {
    const id = args[1];
    if (!id) {
      writeLine(output, `用法：/skills ${action} <id>`);
      return;
    }
    const skill = context.skills.skills.find((item) => item.id === id);
    if (action === "enable") {
      if (!skill) {
        writeLine(output, `未知 skill：${id}。请先在本地 manifest 注册后再启用。`);
        return;
      }
      if (skill.lastError) {
        writeLine(output, `skill manifest 加载失败，不能启用：${id}。请先修复 manifest。`);
        return;
      }
      writeLine(output, formatTrustNotice("skill", skill));
    }
    context.config = await saveExtensionEnablement(
      "skills",
      id,
      action === "enable",
      context.projectPath,
    );
    context.skills = await createSkillState(context.config, context.projectPath);
    writeLine(
      output,
      `${action === "enable" ? "已启用" : "已禁用"} skill：${id}（状态写入 .linghun/settings.json，重启后保留）`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/skills | /skills status|doctor|validate [id] | /skills install local|git|github ... | /skills enable|disable <id> | /skills remove <id> | /skills update <id>",
  );
}

export async function handlePluginsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action) {
    // D.13Q-UX Task Surface — /plugins 默认走降噪 CommandPanel。
    const isEn = context.language === "en-US";
    const total = context.plugins.plugins.length;
    const enabled = context.plugins.plugins.filter((p) => p.enabled).length;
    showCommandPanel(context, output, {
      title: "/plugins",
      tone: "neutral",
      summary: [
        isEn
          ? `Plugins · ${total} total · ${enabled} enabled`
          : `插件 · 共 ${total} · 启用 ${enabled}`,
      ],
      actions: ["/plugins status", "/plugins doctor"],
      detailsText: formatPlugins(context),
    });
    return;
  }
  if (action === "status") {
    showCommandPanel(context, output, {
      title: "/plugins status",
      tone: "neutral",
      summary: [],
      detailsText: formatExtensionStatus("plugins", context),
    });
    return;
  }
  if (action === "doctor") {
    // D.14D-E — /plugins doctor 走降噪 CommandPanel：完整诊断进 detailsText。
    showCommandPanel(context, output, {
      title: "/plugins doctor",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? "Plugins doctor — Ctrl+O for details."
          : "插件诊断 — Ctrl+O 查看详情。",
      ],
      detailsText: formatPluginsDoctor(context),
    });
    return;
  }
  if (action === "add" || action === "install") {
    const request = parseExtensionInstallRequest(args.slice(1));
    if (!request) {
      writeLine(
        output,
        [
          "Plugins install（Connect Lite）",
          `- project: ${context.plugins.projectDir}`,
          `- user: ${context.plugins.userDir}`,
          "- usage: /plugins install local <path> [--scope project|user]",
          "- usage: /plugins install git <url> [--ref <ref>] --confirm-network",
          "- usage: /plugins install github <owner/repo> [--ref <ref>] --confirm-network",
          "- install 前只读取 manifest / metadata；不执行仓库脚本、postinstall、hook 或第三方代码。",
        ].join("\n"),
      );
      return;
    }
    if (request.source !== "local" && !request.confirmNetwork) {
      writeLine(output, formatExtensionInstallGate("plugins", request, "/plugins install"));
      return;
    }
    const result = await installExtensionFromRequest(
      "plugins",
      request,
      context,
      async (summary) => {
        await deps().appendSystemEvent(
          context,
          await deps().ensureSession(context),
          summary,
          "info",
        );
      },
    );
    context.plugins = await createPluginState(context.config, context.projectPath);
    context.hooks = await createHookState(context.config, context.projectPath);
    deps().refreshCacheFreshness(context);
    writeLine(output, result.summary);
    return;
  }
  if (action === "validate") {
    // D.14D-E — /plugins validate 走降噪 CommandPanel：完整校验进 detailsText。
    showCommandPanel(context, output, {
      title: "/plugins validate",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? "Plugins validate — Ctrl+O for details."
          : "插件校验 — Ctrl+O 查看详情。",
      ],
      detailsText: validateExtensionItems("plugins", context, args[1]),
    });
    return;
  }
  if (action === "remove") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await removeExtension("plugins", id, context).then((summary) => {
            deps().refreshCacheFreshness(context);
            return summary;
          })
        : "用法：/plugins remove <id>",
    );
    return;
  }
  if (action === "update") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await updateExtension("plugins", id, context, args.slice(2), async (summary) => {
            await deps().appendSystemEvent(
              context,
              await deps().ensureSession(context),
              summary,
              "info",
            );
          }).then((summary) => {
            deps().refreshCacheFreshness(context);
            return summary;
          })
        : "用法：/plugins update <id> [--ref <ref>] [--confirm-network]",
    );
    return;
  }
  if (action === "enable" || action === "disable") {
    const id = args[1];
    if (!id) {
      writeLine(output, `用法：/plugins ${action} <id>`);
      return;
    }
    const plugin = context.plugins.plugins.find((item) => item.id === id);
    if (action === "enable") {
      if (!plugin) {
        writeLine(output, `未知 plugin：${id}。请先在本地 manifest 注册后再启用。`);
        return;
      }
      writeLine(output, formatTrustNotice("plugin", plugin));
    }
    context.config = await saveExtensionEnablement(
      "plugins",
      id,
      action === "enable",
      context.projectPath,
    );
    context.plugins = await createPluginState(context.config, context.projectPath);
    context.hooks = await createHookState(context.config, context.projectPath);
    writeLine(
      output,
      `${action === "enable" ? "已启用" : "已禁用"} plugin：${id}（状态写入 .linghun/settings.json，重启后保留）`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/plugins | /plugins status|doctor|validate [id] | /plugins install local|git|github ... | /plugins enable|disable <id> | /plugins remove <id> | /plugins update <id>",
  );
}
