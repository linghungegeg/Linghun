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

export function currentRequestUserActionConstraints(input: {
  currentRequestTurnId?: string;
  currentUserActionConstraintsRequestTurnId?: string;
  currentUserActionConstraints?: UserActionConstraints;
}): UserActionConstraints | undefined {
  return input.currentRequestTurnId &&
    input.currentUserActionConstraintsRequestTurnId === input.currentRequestTurnId
    ? input.currentUserActionConstraints
    : undefined;
}

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

function splitConstraintClauses(text: string): string[] {
  const clauses = text
    .split(/[\r\n。！？!?；;，,]+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.length > 0 ? clauses : [text];
}

function anyClauseMatches(clauses: string[], pattern: RegExp): boolean {
  return clauses.some((clause) => pattern.test(clause));
}

export function parseUserActionConstraints(text: string | undefined): UserActionConstraints {
  if (!text) return { ...EMPTY_CONSTRAINTS };
  const normalized = text.trim();
  if (!normalized) return { ...EMPTY_CONSTRAINTS };
  const clauses = splitConstraintClauses(normalized);

  const forbidAllTools =
    anyClauseMatches(clauses, /(?:不要|别|不准|禁止).{0,12}(?:用|调用|执行).{0,8}(?:任何|所有)?工具/iu) ||
    anyClauseMatches(clauses, /(?:do\s+not|don't|dont|no)\s+(?:use|call|run|execute)\s+(?:any\s+|all\s+)?tools/iu);

  const readonlyOnly =
    anyClauseMatches(
      clauses,
      /(?:只读|只(?:看|检查|分析|审计|定位)|read[-\s]?only|audit\s+only|diagnose\s+only)/iu,
    );

  const forbidWrite =
    readonlyOnly ||
    anyClauseMatches(clauses, /(?:不要|别|不准|禁止|先别).{0,12}(?:改|修改|写|写入|编辑|创建|删除|动文件|改文件)/iu) ||
    anyClauseMatches(clauses, /(?:do\s+not|don't|dont|no)\s+(?:edit|write|modify|change|create|delete)(?:\s+files?)?/iu);

  const forbidTests =
    anyClauseMatches(clauses, /(?:不要|别|不准|禁止|先别).{0,12}(?:跑测试|运行测试|测试|test)/iu) ||
    anyClauseMatches(clauses, /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?tests?/iu);

  const forbidBuild =
    anyClauseMatches(clauses, /(?:不要|别|不准|禁止|先别).{0,12}(?:build|构建|打包)/iu) ||
    anyClauseMatches(clauses, /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?build/iu);

  const forbidLint =
    anyClauseMatches(clauses, /(?:不要|别|不准|禁止|先别).{0,12}(?:lint|检查格式)/iu) ||
    anyClauseMatches(clauses, /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?lint/iu);

  const forbidTypecheck =
    anyClauseMatches(clauses, /(?:不要|别|不准|禁止|先别).{0,12}(?:typecheck|类型检查)/iu) ||
    anyClauseMatches(clauses, /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?typecheck/iu);

  const forbidShell =
    forbidAllTools ||
    anyClauseMatches(clauses, /(?:不要|别|不准|禁止|先别).{0,12}(?:执行命令|运行命令|跑命令|用\s*Bash|bash|shell|终端命令)/iu) ||
    anyClauseMatches(clauses, /(?:do\s+not|don't|dont|no)\s+(?:run|execute|use)\s+(?:commands?|bash|shell)/iu);

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
