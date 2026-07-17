import type { VerificationStepKind } from "./tui-data-types.js";

export type UserActionConstraints = {
  readonlyOnly: boolean;
  forbidWrite: boolean;
  forbidTests: boolean;
  forbidBuild: boolean;
  forbidLint: boolean;
  forbidTypecheck: boolean;
  forbidSmoke?: boolean;
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
  forbidSmoke: false,
  forbidShell: false,
  forbidAllTools: false,
};

function splitConstraintClauses(text: string): string[] {
  const clauses = text.match(/[^\r\n。！!？?；;，,]+[？?]?/gu)
    ?.map((clause) => clause.trim())
    .filter(Boolean);
  return clauses && clauses.length > 0 ? clauses : [text];
}

function isConstraintWordingQuestion(clause: string): boolean {
  return (
    /[？?]\s*$/u.test(clause) ||
    /(?:这句话|这个说法|是不是|为什么|怎么会|会不会|吗|普通问答|提到).{0,80}(?:关键词|正则|语义|解析|识别|判断|误触|误判|硬门控|硬限制|门控|约束机制|约束规则|阻止验证)/iu.test(
      clause,
    ) ||
    /(?:is\s+this|does\s+["'\w\s-]+trigger|parsed\s+by|constraint\s+wording|wording\s+example)/iu.test(
      clause,
    )
  );
}

function anyClauseMatches(clauses: string[], pattern: RegExp): boolean {
  return clauses.some((clause) => pattern.test(clause));
}

function anyNegatedRunListMentions(clauses: string[], itemPattern: RegExp): boolean {
  const text = clauses.join("，");
  const segments = text.match(
    /(?:(?:不要|别|不准|禁止|先别|不)\s*(?:再|继续|重新)?\s*(?:跑|运行|执行|做|进行)\s*[^。！？!?；;\n]{0,120}|(?:do\s+not|don't|dont|no)\s+run\s+[^.?!;\n]{0,120})/giu,
  ) ?? [];
  return segments.some((segment) => itemPattern.test(segment));
}

function isExplicitConstraintDirective(clause: string): boolean {
  const startsWithExplicitDirective =
    /^(?:(?:请|麻烦|本次|这次|当前(?:请求|任务)?|这个任务|该任务|我要求|用户要求|先|然后|再|也|并且|同时|但(?:是)?)\s*)*(?:只读|只\s*(?:看|检查|分析|审计|定位)|只允许|不要|别|不准|禁止|先别|不可以|不允许|不能|不可|不许|不\s*(?:跑|运行|执行|做|进行))|^(?:(?:please|for\s+this\s+(?:request|task)|then|also|but)\s+)*(?:read[-\s]?only|audit\s+only|diagnose\s+only|inspect\s+only|do\s+not|don't|dont|no\s|cannot|can't|cant|not\s+allowed|may\s+not|must\s+not|without\s|answer\s+without|use\s+no)/iu.test(
      clause,
    );
  if (
    (startsWithExplicitDirective && isConstraintWordingQuestion(clause)) ||
    !startsWithExplicitDirective &&
      /(?:关键词|正则|语义|解析|识别|判断|误触|误判|硬门控|硬限制|门控|约束机制|约束规则|这句话|这个说法|文案)|(?:regex|semantic|parser|parsing|wording|hard\s+(?:gate|constraint)|constraint\s+(?:parser|rule))/iu.test(
        clause,
      )
  ) {
    return false;
  }
  return startsWithExplicitDirective;
}

function hasPhasedReadThenWriteIntent(text: string): boolean {
  const readIntent =
    /(?:先\s*)?(?:只读|只\s*(?:看|检查|分析|审计|定位))|(?:read[-\s]?only|audit\s+only|diagnose\s+only|inspect\s+(?:only|first)|first\s+(?:inspect|audit|diagnose|read))/iu;
  const writeIntent =
    /(?:修复|修改|改动|编辑|写入|实现|落地|fix|repair|edit|write|modify|implement|change)/iu;
  const deniedWriteIntent =
    /(?:不要|别|不准|禁止|不可以|不允许|不能|不可|不许|无需|无须|不用|不必|不需要).{0,12}(?:修复|修改|改动|编辑|写入|实现|落地)|(?:cannot|can't|cant|do\s+not|don't|dont|not\s+allowed|may\s+not|must\s+not|need\s+not|no\s+need\s+to|not).{0,12}(?:fix|repair|edit|write|modify|implement|change)/iu;
  const conditionalWriteIntent = /(?:是否|视情况|按需|if\s+needed|whether)/iu;

  return [...text.matchAll(/(?:然后|随后|之后|接着|再(?:来)?|\bthen\b|\bafter(?:ward|wards)?\b)/giu)].some(
    (transition) => {
      const before = text.slice(0, transition.index);
      const after = text.slice((transition.index ?? 0) + transition[0].length);
      const phasedAction = text.slice(Math.max(0, (transition.index ?? 0) - 16));
      return (
        readIntent.test(before) &&
        writeIntent.test(after) &&
        !deniedWriteIntent.test(phasedAction) &&
        !conditionalWriteIntent.test(after)
      );
    },
  );
}

function hasExplicitWriteException(text: string): boolean {
  const mentionsWrite = (segment: string): boolean =>
    /(?:修复|处理|实现|落地|改|修改|写|写入|编辑|创建|新增|删除|fix|repair|implement|edit|write|save|modify|change|create|add|delete)/iu.test(
      segment,
    );
  const hasNegativePermission = (segment: string): boolean =>
    /(?:不要|别|不准|禁止|不可以|不允许|不能|不可|不许|不\s*(?:修复|处理|实现|落地|改|修改|写|写入|编辑|创建|新增|删除)|(?:无需|无须|不用|不必|不需要)\s*(?:修复|处理|实现|落地|改|修改|写|写入|编辑|创建|新增|删除))|(?:cannot|can't|cant|do\s+not|don't|dont|not\s+allowed|may\s+not|must\s+not|need\s+not|no\s+need\s+to|not\s+(?:fix|repair|implement|edit|write|save|modify|change|create|add|delete))/iu.test(
      segment,
    );
  const clauses = splitConstraintClauses(text);
  const rejectsReadonlyAsTerminalState = clauses.some(
    (clause) =>
      /(?:不要|别|不必|无需|无须|不用)\s*(?:只\s*)?(?:(?:停|停留|止步|局限|限制)(?:在|于)?\s*)?(?:只读|只\s*(?:看|检查|分析|审计|定位))/iu.test(
        clause,
      ) ||
      /(?:do\s+not|don't|dont|need\s+not)\s+(?:(?:stop|stay|remain)\s+(?:at|in)\s+)?(?:read[-\s]?only|audit\s+only|diagnose\s+only|inspect\s+only)/iu.test(
        clause,
      ),
  );
  if (
    rejectsReadonlyAsTerminalState &&
    clauses.some((clause) => mentionsWrite(clause) && !hasNegativePermission(clause))
  ) {
    return true;
  }
  const writesAboutReadonlyConstraint = clauses.some((clause) => {
    const writeIntentIndex = clause.search(
      /(?:修复|处理|实现|落地|修改|编辑|fix|repair|implement|edit|modify|change)/iu,
    );
    const readonlyIntentIndex = clause.search(
      /(?:只读|只\s*(?:看|检查|分析|审计|定位)|read[-\s]?only|audit\s+only|diagnose\s+only|inspect\s+only)/iu,
    );
    return (
      writeIntentIndex >= 0 &&
      readonlyIntentIndex > writeIntentIndex &&
      !hasNegativePermission(clause)
    );
  });
  if (writesAboutReadonlyConstraint) return true;
  const transitionSuffixes = text.split(/(?:但(?:是)?|不过|\bbut\b|\bexcept\b)/iu).slice(1);
  if (hasPhasedReadThenWriteIntent(text)) return true;
  if (
    transitionSuffixes.some(
      (segment) => mentionsWrite(segment) && !hasNegativePermission(segment),
    )
  ) {
    return true;
  }
  return clauses.some(
    (clause) =>
      mentionsWrite(clause) &&
      !hasNegativePermission(clause) &&
      /(?:除(?:了|外)|可以|允许|仍可|只需|只要)|(?:allow(?:ed)?|may|can|only\s+need\s+to)/iu.test(
        clause,
      ),
  );
}

function hasExplicitToolException(text: string): boolean {
  const hasToolReference = (segment: string): boolean =>
    /(?:工具|使用|调用|执行|\b(?:use|call|run|execute|tools?|Read|Grep|Bash)\b)/iu.test(segment);
  const hasNegativeToolPermission = (segment: string): boolean =>
    /(?:不要|别|不准|禁止|不可以|不允许|不能|不可|不许|不\s*(?:用|使用|调用|执行)|(?:无需|无须|不用|不必|不需要)\s*(?:用|使用|调用|执行))|(?:cannot|can't|cant|do\s+not|don't|dont|not\s+allowed|may\s+not|must\s+not|need\s+not|no\s+need\s+to|not\s+(?:use|call|run|execute))/iu.test(
      segment,
    );
  const transitionSuffixes = text.split(/(?:但(?:是)?|不过|\bbut\b|\bexcept\b)/iu).slice(1);
  if (
    transitionSuffixes.some(
      (segment) => hasToolReference(segment) && !hasNegativeToolPermission(segment),
    )
  ) {
    return true;
  }
  return splitConstraintClauses(text).some(
    (clause) =>
      hasToolReference(clause) &&
      !hasNegativeToolPermission(clause) &&
      /(?:可以|允许|仍可)|(?:may|can|allow(?:ed)?)/iu.test(clause),
  );
}

function isTargetScopedWriteBan(clause: string): boolean {
  const denySegment = clause.split(/(?:但(?:是)?|不过|\bbut\b|\bexcept\b)/iu)[0] ?? clause;
  return /(?:只|仅)(?:禁止|不准|不要|别).{0,12}(?:改|修改|写|编辑|创建|删除)/iu.test(denySegment) ||
    /只允许\s*不\s*(?:改|修改|写|写入|编辑|创建|删除).{0,24}(?:旧|现有|已有|原有|指定|特定|这个|那个|UI|样式|文档|配置|测试|目录|文件夹)/iu.test(
      denySegment,
    ) ||
    /(?:不要|别|不准|禁止|先别|不可以|不允许|不能|不可|不许).{0,12}(?:改|修改|写|写入|编辑|创建|删除).{0,24}(?:旧|现有|已有|原有|指定|特定|这个|那个|以下|上述|上面|下面|红框|UI|界面|样式|文档|配置|依赖|测试|目录|文件夹|数据库|数据表|分支|worktree|\b(?:databases?|db|sqlite|sql(?:ite)?\s+files?)\b)/iu.test(
      denySegment,
    ) ||
    /(?:不要|别|不准|禁止|先别|不可以|不允许|不能|不可|不许).{0,12}(?:改|修改|写|写入|编辑|创建|删除).{0,32}(?:[A-Za-z0-9_.-]+[\\/][A-Za-z0-9_./\\*-]*|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/u.test(
      denySegment,
    ) ||
    /(?:do\s+not|don't|dont|no|cannot|can't|cant|not\s+allowed\s+to|may\s+not|must\s+not)\s+(?:edit|write|modify|change|create|delete).{0,32}(?:existing|current|old|specific|selected|UI|styles?|docs?|config|tests?|director(?:y|ies)|folders?|branches?|worktrees?|\b(?:databases?|db|sqlite|sql(?:ite)?\s+files?)\b|[A-Za-z0-9_.-]+[\\/]|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/iu.test(
      denySegment,
    );
}

export function parseUserActionConstraints(text: string | undefined): UserActionConstraints {
  if (!text) return { ...EMPTY_CONSTRAINTS };
  const normalized = text.trim();
  if (!normalized) return { ...EMPTY_CONSTRAINTS };
  const clauses = splitConstraintClauses(normalized);
  const constraintClauses =
    /[?？]\s*$/u.test(normalized) && clauses.length === 1
      ? []
      : clauses.filter(isExplicitConstraintDirective);
  const explicitWriteException = hasExplicitWriteException(normalized);
  const explicitToolException = hasExplicitToolException(normalized);

  const forbidAllTools =
    !explicitToolException &&
    (anyClauseMatches(
      constraintClauses,
      /(?:不要|别|不准|禁止)\s*(?:再)?(?:用|使用|调用|执行)\s*(?:任何|所有|全部|一切)工具/iu,
    ) ||
      anyClauseMatches(constraintClauses, /(?:禁止|不准)\s*(?:任何|所有|全部|一切)工具/iu) ||
      anyClauseMatches(
        constraintClauses,
        /^(?:请)?(?:不要|别|不准|禁止)\s*(?:再)?(?:用|使用|调用|执行)工具(?:了)?(?:\s*只回答)?$/iu,
      ) ||
      anyClauseMatches(
        constraintClauses,
        /(?:do\s+not|don't|dont|no)\s+(?:use|call|run|execute)\s+(?:(?:any|all|every|the)\s+)?tools/iu,
      ) ||
      anyClauseMatches(constraintClauses, /^no\s+(?:tools|tool\s+use)$/iu) ||
      anyClauseMatches(constraintClauses, /^(?:answer\s+)?without\s+(?:using\s+)?tools$/iu) ||
      anyClauseMatches(constraintClauses, /^use\s+no\s+tools$/iu));

  const readonlyOnly =
    !explicitWriteException &&
    anyClauseMatches(
      constraintClauses,
      /(?:只读|只(?:看|检查|分析|审计|定位)|read[-\s]?only|audit\s+only|diagnose\s+only)/iu,
    );

  const forbidWrite =
    !explicitWriteException &&
    (readonlyOnly ||
      constraintClauses.some(
        (clause) =>
          !isTargetScopedWriteBan(clause) &&
          (/(?:不要|别|不准|禁止|先别|不可以|不允许|不能|不可|不许).{0,12}(?:改|修改|写|写入|编辑|创建|删除|动文件|改文件)/iu.test(
            clause,
          ) ||
            /^(?:请)?(?:不要|别|不准|禁止|先别|不可以|不允许|不能|不可|不许)\s*(?:再)?\s*(?:修复|处理)\s*(?:(?:这个|这些|该|当前|上述)\s*)?(?:问题|故障|bug)?(?:了)?$/iu.test(
              clause,
            ) ||
            /只允许\s*不\s*(?:改|修改|写|写入|编辑|创建|删除)/iu.test(clause) ||
            /(?:do\s+not|don't|dont|no|cannot|can't|cant|not\s+allowed\s+to|may\s+not|must\s+not)\s+(?:edit|write|modify|change|create|delete)(?:\s+files?)?/iu.test(
              clause,
            ) ||
            /^(?:please\s+)?(?:do\s+not|don't|dont|cannot|can't|cant|may\s+not|must\s+not)\s+(?:fix|repair)(?:\s+(?:it|(?:this|the)\s+(?:issue|bug|problem)))?$/iu.test(
              clause,
            ) ||
            /^(?:please\s+)?(?:no\s+(?:code|file)\s+changes|do\s+not\s+make\s+any\s+changes|without\s+(?:modifying|editing|changing|writing)(?:\s+any)?\s+(?:files|code))$/iu.test(
              clause,
            )),
      ));

  const forbidTests = constraintClauses.some(
    (clause) =>
      !/(?:smoke|冒烟)/iu.test(clause) &&
      (/(?:不要|别|不准|禁止|先别)\s*(?:再|继续|重新)?\s*(?:(?:跑|运行|执行|做|进行)\s*)?(?:任何|所有|全部)?\s*(?:单元测试|测试|test)/iu.test(clause) ||
        /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?(?:(?:any|all|the)\s+)?(?:(?:unit|integration|e2e|full)\s+)?(?:tests?|test\s+suite)/iu.test(clause)),
  ) || anyNegatedRunListMentions(
    constraintClauses,
    /(?:单元测试|测试|\btests?\b|\btest\s+suite\b)/iu,
  );

  const forbidBuild =
    anyClauseMatches(constraintClauses, /(?:不要|别|不准|禁止|先别)\s*(?:再|继续|重新)?\s*(?:(?:跑|运行|执行|做|进行)\s*)?(?:任何|所有|全部)?\s*(?:build|构建|打包)/iu) ||
    anyClauseMatches(constraintClauses, /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?(?:(?:any|all|the)\s+)?build/iu) ||
    anyNegatedRunListMentions(constraintClauses, /(?:\bbuild\b|构建|打包)/iu);

  const forbidLint =
    anyClauseMatches(constraintClauses, /(?:不要|别|不准|禁止|先别)\s*(?:再|继续|重新)?\s*(?:(?:跑|运行|执行|做|进行)\s*)?(?:任何|所有|全部)?\s*(?:lint|检查格式)/iu) ||
    anyClauseMatches(constraintClauses, /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?(?:(?:any|all|the)\s+)?lint/iu) ||
    anyNegatedRunListMentions(constraintClauses, /(?:\blint\b|检查格式)/iu);

  const forbidTypecheck =
    anyClauseMatches(constraintClauses, /(?:不要|别|不准|禁止|先别)\s*(?:再|继续|重新)?\s*(?:(?:跑|运行|执行|做|进行)\s*)?(?:任何|所有|全部)?\s*(?:type[-\s]?check|类型检查)/iu) ||
    anyClauseMatches(constraintClauses, /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?(?:(?:any|all|the)\s+)?type[-\s]?check/iu) ||
    anyNegatedRunListMentions(constraintClauses, /(?:type[-\s]?check|类型检查)/iu);

  const forbidSmoke =
    anyClauseMatches(constraintClauses, /(?:不要|别|不准|禁止|先别)\s*(?:再|继续|重新)?\s*(?:(?:跑|运行|执行|做|进行)\s*)?(?:任何|所有|全部)?\s*(?:smoke|冒烟测试|冒烟)/iu) ||
    anyClauseMatches(constraintClauses, /(?:do\s+not|don't|dont|no)\s+(?:run\s+)?(?:(?:any|all|the)\s+)?smoke(?:\s+tests?)?/iu) ||
    anyNegatedRunListMentions(constraintClauses, /(?:\bsmoke\b|冒烟测试|冒烟)/iu);

  const forbidShell =
    forbidAllTools ||
    anyClauseMatches(constraintClauses, /(?:不要|别|不准|禁止|先别|不)\s*(?:再|继续|重新)?\s*(?:(?:执行|运行|跑)\s*(?:任何|所有|全部)?\s*(?:终端|shell)?\s*命令|用\s*Bash|用\s*shell|bash|shell|终端命令)/iu) ||
    anyClauseMatches(constraintClauses, /(?:do\s+not|don't|dont|no)\s+(?:run|execute|use)\s+(?:(?:any|all|the)\s+)?(?:commands?|bash|shell)/iu) ||
    anyClauseMatches(constraintClauses, /^no\s+shell(?:\s+commands?)?$/iu);

  return {
    readonlyOnly,
    forbidWrite,
    forbidTests,
    forbidBuild,
    forbidLint,
    forbidTypecheck,
    forbidSmoke,
    forbidShell,
    forbidAllTools,
  };
}

export function forbidsVerificationEvidence(constraints: UserActionConstraints): boolean {
  return constraints.forbidAllTools || constraints.forbidShell;
}

export function verificationStepConstraintReason(
  constraints: UserActionConstraints | undefined,
  kind: VerificationStepKind,
): string | undefined {
  if (!constraints) return undefined;
  if (constraints.forbidAllTools) return "the current request forbids all tools";
  if (constraints.forbidShell) return "the current request forbids shell commands";
  if (kind === "test" && constraints.forbidTests) return "the current request forbids tests";
  if (kind === "build" && constraints.forbidBuild) return "the current request forbids build";
  if (kind === "lint" && constraints.forbidLint) return "the current request forbids lint";
  if (kind === "typecheck" && constraints.forbidTypecheck) {
    return "the current request forbids typecheck";
  }
  if (kind === "smoke" && constraints.forbidSmoke) return "the current request forbids smoke";
  return undefined;
}

export function hasReadOnlyUserConstraint(constraints: UserActionConstraints): boolean {
  return constraints.readonlyOnly || constraints.forbidWrite || constraints.forbidAllTools;
}
