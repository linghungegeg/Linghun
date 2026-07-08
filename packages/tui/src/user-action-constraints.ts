export type UserActionConstraints = {
  readonlyOnly: boolean;
  forbidWrite: boolean;
  forbidTests: boolean;
  forbidBuild: boolean;
  forbidLint: boolean;
  forbidTypecheck: boolean;
  forbidShell: boolean;
  forbidAllTools: boolean;
};

const EMPTY_CONSTRAINTS: UserActionConstraints = {
  readonlyOnly: false,
  forbidWrite: false,
  forbidTests: false,
  forbidBuild: false,
  forbidLint: false,
  forbidTypecheck: false,
  forbidShell: false,
  forbidAllTools: false,
};

export function parseUserActionConstraints(text: string | undefined): UserActionConstraints {
  if (!text) return { ...EMPTY_CONSTRAINTS };
  const normalized = text.trim();
  if (!normalized) return { ...EMPTY_CONSTRAINTS };

  const forbidAllTools =
    /(?:不要|别|不准|禁止).{0,12}(?:用|调用|执行).{0,8}(?:任何|所有)?工具/iu.test(normalized) ||
    /(?:do\s+not|don't|dont|no)\s+(?:use|call|run|execute)\s+(?:any\s+|all\s+)?tools/iu.test(normalized);

  const readonlyOnly =
    /(?:只读|只(?:看|检查|分析|审计|定位)|先(?:看|检查|分析|审计|定位)|read[-\s]?only|audit\s+only|diagnose\s+only)/iu.test(
      normalized,
    );

  const forbidWrite =
    readonlyOnly ||
    /(?:不要|别|不准|禁止|先别).{0,12}(?:改|修改|写|写入|编辑|创建|删除|动文件|改文件)/iu.test(normalized) ||
    /(?:do\s+not|don't|dont|no)\s+(?:edit|write|modify|change|create|delete)(?:\s+files?)?/iu.test(normalized);

  const forbidTests =
    /(?:不要|别|不准|禁止|先别).{0,12}(?:跑测试|运行测试|测试|test)/iu.test(normalized) ||
    /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?tests?/iu.test(normalized);

  const forbidBuild =
    /(?:不要|别|不准|禁止|先别).{0,12}(?:build|构建|打包)/iu.test(normalized) ||
    /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?build/iu.test(normalized);

  const forbidLint =
    /(?:不要|别|不准|禁止|先别).{0,12}(?:lint|检查格式)/iu.test(normalized) ||
    /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?lint/iu.test(normalized);

  const forbidTypecheck =
    /(?:不要|别|不准|禁止|先别).{0,12}(?:typecheck|类型检查)/iu.test(normalized) ||
    /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?typecheck/iu.test(normalized);

  const forbidShell =
    forbidAllTools ||
    /(?:不要|别|不准|禁止|先别).{0,12}(?:执行命令|运行命令|跑命令|用\s*Bash|bash|shell|终端命令)/iu.test(normalized) ||
    /(?:do\s+not|don't|dont|no)\s+(?:run|execute|use)\s+(?:commands?|bash|shell)/iu.test(normalized);

  return {
    readonlyOnly,
    forbidWrite,
    forbidTests,
    forbidBuild,
    forbidLint,
    forbidTypecheck,
    forbidShell,
    forbidAllTools,
  };
}

export function forbidsVerificationEvidence(constraints: UserActionConstraints): boolean {
  return constraints.forbidAllTools ||
    constraints.forbidShell ||
    constraints.forbidTests ||
    constraints.forbidBuild ||
    constraints.forbidLint ||
    constraints.forbidTypecheck;
}

export function hasReadOnlyUserConstraint(constraints: UserActionConstraints): boolean {
  return constraints.readonlyOnly || constraints.forbidWrite || constraints.forbidAllTools;
}
