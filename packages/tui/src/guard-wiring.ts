/**
 * guard-wiring.ts — D.14A Guard Wiring Layer
 *
 * Provides natural-language helpers that translate internal guard classifications
 * into user-facing messages for /doctor, task completion, runner/provider summaries.
 *
 * All output is human-readable. Internal enums/markers stay internal.
 * Debug/report output may include short markers, but primary output explains:
 * - What was achieved
 * - What was NOT achieved
 * - Why mature/ready/PASS cannot be claimed
 * - What real verification is needed next
 *
 * D.14A-Closure Architecture Guard Wiring.
 */

import type { Language } from "@linghun/shared";
import type { ChangeDeclaration } from "./architecture-boundary.js";
import { validateChangeDeclaration } from "./architecture-boundary.js";
import type { RuntimePathMarker, StartupPathMarker } from "./runtime-path-marker.js";
import { detectRuntimePathInflation } from "./runtime-path-marker.js";
import type {
  VerificationEvidenceLevel,
  VerificationLevelClassification,
} from "./verification-level.js";
import {
  classifyProviderVerificationLevel,
  classifyRunnerVerificationLevel,
  detectVerificationInflation,
} from "./verification-level.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GuardDoctorItem = {
  id: string;
  label: string;
  ok: boolean;
  summary: string;
  nextAction: string;
};

export type CompletionClaimCheck = {
  valid: boolean;
  warnings: string[];
  humanSummary: string;
};

// ---------------------------------------------------------------------------
// Doctor / Status output helpers (natural language)
// ---------------------------------------------------------------------------

/**
 * Format runtime path for /doctor output.
 * Returns a human-readable line explaining the current TUI rendering path.
 */
export function formatRuntimePathDoctor(
  marker: RuntimePathMarker,
  language: Language,
): GuardDoctorItem {
  if (marker.isMainPath) {
    return {
      id: "runtime-path",
      label: language === "en-US" ? "TUI rendering" : "TUI 渲染",
      ok: true,
      summary:
        language === "en-US"
          ? "Ink main path active. TUI maturity claims are valid for this session."
          : "Ink 主路径已激活。本次会话的 TUI 成熟度声明有效。",
      nextAction:
        language === "en-US" ? "No action needed for TUI path." : "TUI 路径无需额外操作。",
    };
  }

  const reason = explainDegradedReason(marker.degradedReason, language);
  return {
    id: "runtime-path",
    label: language === "en-US" ? "TUI rendering" : "TUI 渲染",
    ok: false,
    summary:
      language === "en-US"
        ? `Fallback path "${marker.path}" is active. ${reason} TUI maturity cannot be claimed.`
        : `当前使用降级路径"${marker.path}"。${reason}不能声称 TUI 已成熟。`,
    nextAction:
      language === "en-US"
        ? "Run in a real terminal with Ink support to verify TUI maturity."
        : "在支持 Ink 的真实终端中运行以验证 TUI 成熟度。",
  };
}

/**
 * Format startup path for /doctor output.
 */
export function formatStartupPathDoctor(
  marker: StartupPathMarker,
  language: Language,
): GuardDoctorItem {
  if (marker.isVerifiedCurrent) {
    return {
      id: "startup-path",
      label: language === "en-US" ? "CLI entry" : "CLI 入口",
      ok: true,
      summary:
        language === "en-US"
          ? "Running from source. Verification results reflect current code."
          : "从源码运行。验证结果反映当前代码。",
      nextAction: language === "en-US" ? "No action needed." : "无需额外操作。",
    };
  }

  return {
    id: "startup-path",
    label: language === "en-US" ? "CLI entry" : "CLI 入口",
    ok: false,
    summary:
      language === "en-US"
        ? `Entry kind "${marker.entryKind}" may be outdated. ${marker.staleReason ?? "Cannot confirm this is current code."}`
        : `入口类型"${marker.entryKind}"可能已过时。${translateStaleReason(marker.staleReason, language)}`,
    nextAction:
      language === "en-US"
        ? "Rebuild or run from source to ensure verification reflects current code."
        : "重新构建或从源码运行，确保验证反映当前代码。",
  };
}

/**
 * Format verification level for /doctor output.
 */
export function formatVerificationLevelDoctor(
  classification: VerificationLevelClassification,
  language: Language,
): GuardDoctorItem {
  if (classification.canClaimMature) {
    return {
      id: "verification-level",
      label: language === "en-US" ? "verification level" : "验证等级",
      ok: true,
      summary:
        language === "en-US"
          ? "Real smoke verification achieved. Maturity claims are valid."
          : "已达到真实 smoke 验证。成熟度声明有效。",
      nextAction: language === "en-US" ? "No action needed." : "无需额外操作。",
    };
  }

  const levelExplanation = explainLevel(classification.level, language);
  const needed = explainRequiredForMature(classification.requiredForMature, language);

  return {
    id: "verification-level",
    label: language === "en-US" ? "verification level" : "验证等级",
    ok: false,
    summary:
      language === "en-US"
        ? `Current level: ${levelExplanation}. Cannot claim mature or production-ready.`
        : `当前等级：${levelExplanation}。不能声称已成熟或可上线。`,
    nextAction: language === "en-US" ? `Need: ${needed}` : `需要：${needed}`,
  };
}

/**
 * Format runner verification for /doctor or job summary.
 */
export function formatRunnerGuardSummary(
  adapter: "native" | "node",
  status: string,
  fallbackReason: string | undefined,
  language: Language,
): string {
  const classification = classifyRunnerVerificationLevel(adapter, status, fallbackReason);

  if (classification.canClaimMature) {
    return language === "en-US"
      ? "Native runner completed successfully. Runner maturity verified."
      : "原生 runner 已成功完成。Runner 成熟度已验证。";
  }

  if (adapter === "node" || fallbackReason) {
    return language === "en-US"
      ? `Runner is using Node fallback${fallbackReason ? ` (${fallbackReason})` : ""}. This does not prove native runner maturity. Real native runner smoke is required.`
      : `Runner 正在使用 Node 降级方案${fallbackReason ? `（${fallbackReason}）` : ""}。这不能证明原生 runner 已成熟。需要真实原生 runner smoke 验证。`;
  }

  return language === "en-US"
    ? `Runner status "${status}" is not a maturity proof. Real smoke verification is required.`
    : `Runner 状态"${status}"不是成熟度证明。需要真实 smoke 验证。`;
}

/**
 * Format provider verification for /doctor or status.
 */
export function formatProviderGuardSummary(
  input: {
    realEndpointHit: boolean;
    fallbackUsed: boolean;
    mockUsed: boolean;
    cooldownActive: boolean;
  },
  language: Language,
): string {
  const classification = classifyProviderVerificationLevel(input);

  if (classification.canClaimMature) {
    return language === "en-US"
      ? "Provider endpoint verified with real response. Provider readiness confirmed."
      : "Provider 端点已通过真实响应验证。Provider 就绪状态已确认。";
  }

  if (input.cooldownActive) {
    return language === "en-US"
      ? "Provider is in cooldown. Cannot claim provider ready until cooldown expires and a real request succeeds."
      : "Provider 正在冷却中。冷却结束且真实请求成功前，不能声称 provider 已就绪。";
  }

  if (input.mockUsed) {
    return language === "en-US"
      ? "Provider verification used mocks. Real endpoint hit is required to confirm provider readiness."
      : "Provider 验证使用了 mock。需要真实端点请求来确认 provider 就绪状态。";
  }

  if (input.fallbackUsed) {
    return language === "en-US"
      ? "Provider is using a fallback. Main provider path must succeed to claim readiness."
      : "Provider 正在使用降级方案。主 provider 路径必须成功才能声称就绪。";
  }

  return language === "en-US"
    ? "Provider status is inconclusive. A real endpoint request is needed."
    : "Provider 状态不确定。需要真实端点请求。";
}

// ---------------------------------------------------------------------------
// Completion claim validation (task/report output)
// ---------------------------------------------------------------------------

/**
 * Validate a completion/maturity claim against actual evidence.
 * Returns human-readable warnings if the claim inflates actual status.
 */
export function validateCompletionClaim(
  claimedStatus: string,
  actualLevel: VerificationEvidenceLevel,
  runtimePath: RuntimePathMarker | undefined,
  language: Language,
): CompletionClaimCheck {
  const warnings: string[] = [];

  // Check verification level inflation
  const levelInflation = detectVerificationInflation(claimedStatus, actualLevel);
  if (levelInflation) {
    warnings.push(
      language === "en-US"
        ? `Cannot claim "${claimedStatus}": actual verification is ${explainLevel(actualLevel, "en-US")}. Real smoke is required for mature/ready claims.`
        : `不能声称"${claimedStatus}"：实际验证等级为${explainLevel(actualLevel, "zh-CN")}。成熟/就绪声明需要真实 smoke 验证。`,
    );
  }

  // Check runtime path inflation
  if (runtimePath) {
    const pathInflation = detectRuntimePathInflation(claimedStatus, runtimePath);
    if (pathInflation) {
      warnings.push(
        language === "en-US"
          ? `Cannot claim "${claimedStatus}": TUI is running on fallback path "${runtimePath.path}". Ink main path verification is required.`
          : `不能声称"${claimedStatus}"：TUI 正在降级路径"${runtimePath.path}"上运行。需要 Ink 主路径验证。`,
      );
    }
  }

  if (warnings.length === 0) {
    return {
      valid: true,
      warnings: [],
      humanSummary:
        language === "en-US"
          ? "Claim is consistent with available evidence."
          : "声明与现有证据一致。",
    };
  }

  return {
    valid: false,
    warnings,
    humanSummary:
      language === "en-US"
        ? `Claim "${claimedStatus}" cannot be made: ${warnings.length} issue(s) found.`
        : `不能做出"${claimedStatus}"声明：发现 ${warnings.length} 个问题。`,
  };
}

/**
 * Validate a change declaration and return human-readable warnings.
 */
export function validateChangeDeclarationHuman(
  declaration: Partial<ChangeDeclaration>,
  language: Language,
): string[] {
  const raw = validateChangeDeclaration(declaration);
  return raw.map((warning) => translateDeclarationWarning(warning, language));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function explainDegradedReason(reason: string | undefined, language: Language): string {
  if (!reason) return "";
  if (reason === "non-tty-output") {
    return language === "en-US"
      ? "Output is not a TTY (piped or redirected)."
      : "输出不是 TTY（被管道或重定向）。";
  }
  if (reason === "ci-environment") {
    return language === "en-US" ? "Running in CI environment." : "正在 CI 环境中运行。";
  }
  if (reason === "ink-unavailable") {
    return language === "en-US" ? "Ink renderer is not available." : "Ink 渲染器不可用。";
  }
  if (reason === "forced-legacy-by-config") {
    return language === "en-US"
      ? "Legacy mode forced by configuration."
      : "配置强制使用 legacy 模式。";
  }
  if (reason.startsWith("env-override=")) {
    return language === "en-US" ? "Overridden by environment variable." : "被环境变量覆盖。";
  }
  return language === "en-US" ? `Degraded: ${reason}.` : `降级原因：${reason}。`;
}

function explainLevel(level: VerificationEvidenceLevel, language: Language): string {
  const map: Record<VerificationEvidenceLevel, [string, string]> = {
    mock: ["mock/simulated tests only", "仅 mock/模拟测试"],
    source: ["source code analysis only", "仅源码分析"],
    local: ["local test runner (vitest/jest)", "本地测试运行器（vitest/jest）"],
    build: ["build passed", "构建通过"],
    "real-smoke": ["real smoke verified", "真实 smoke 已验证"],
  };
  return language === "en-US" ? map[level][0] : map[level][1];
}

function explainRequiredForMature(required: string, language: Language): string {
  if (required === "already-mature") {
    return language === "en-US" ? "Already at mature level." : "已达到成熟等级。";
  }
  const parts = required.split("+");
  const translated = parts.map((part) => {
    if (part === "real-smoke-observation") {
      return language === "en-US"
        ? "real process/provider/TUI observation"
        : "真实进程/provider/TUI 观测";
    }
    if (part === "main-path-execution") {
      return language === "en-US" ? "main path execution (not fallback)" : "主路径执行（非降级）";
    }
    if (part === "real-dependency-verification") {
      return language === "en-US"
        ? "real dependency verification (not mocked)"
        : "真实依赖验证（非 mock）";
    }
    if (part === "real-smoke-required") {
      return language === "en-US" ? "real smoke test execution" : "真实 smoke 测试执行";
    }
    return part;
  });
  return translated.join(language === "en-US" ? " + " : " + ");
}

function translateStaleReason(reason: string | undefined, _language: Language): string {
  if (!reason) return "无法确认是否为当前代码。";
  if (reason === "dist-may-be-outdated") return "dist 构建可能已过时。";
  if (reason === "global-bin-may-be-outdated") return "全局 bin 链接可能已过时。";
  if (reason === "desktop-cmd-may-be-outdated") return "桌面 cmd 脚本可能已过时。";
  if (reason === "unknown-entry-point") return "未知入口点。";
  return "无法确认是否为当前代码。";
}

function translateDeclarationWarning(warning: string, language: Language): string {
  if (language === "en-US") return warning;
  if (warning.includes("files list is empty")) {
    return "变更声明缺失：文件列表为空。";
  }
  if (warning.includes("mainPath not specified")) {
    return "变更声明缺失：未指定主路径。";
  }
  if (warning.includes("verificationLevel not specified")) {
    return "变更声明缺失：未指定验证等级。";
  }
  if (warning.includes("Large change")) {
    return "大改动（>3 文件）未声明 realSmokeRequired 项。请声明哪些内容需要真实 smoke 验证。";
  }
  return warning;
}
