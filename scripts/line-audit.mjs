import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

const ROOT = process.env.AUDIT_ROOT || "F:\\Linghun";
const SRC_DIRS = [
  "packages/config/src",
  "packages/core/src",
  "packages/providers/src",
  "packages/shared/src",
  "packages/tools/src",
  "packages/tui/src",
  "packages/tui/src/shell",
  "packages/tui/src/shell/models",
  "packages/tui/src/shell/components",
  "apps/cli/src",
];

const OUTPUT = process.env.AUDIT_OUTPUT || join(ROOT, "CODE_AUDIT_LINE_BY_LINE.md");

function collectFiles(dirs) {
  const files = [];
  for (const dir of dirs) {
    const full = join(ROOT, dir);
    try {
      walk(full, files);
    } catch { /* dir doesn't exist */ }
  }
  return files.filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && !f.includes("node_modules")
  );
}

function walk(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      walk(full, files);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(full);
    }
  }
}

const PATTERNS = [
  {
    name: "空catch吞错误",
    regex: /}\s*catch\s*\{[\s\n]*\}/g,
    desc: "完全空的 catch 块将静默丢弃所有异常",
  },
  {
    name: "空catch吞错误(带变量)",
    regex: /}\s*catch\s*\(\s*\w*\s*\)\s*\{[\s\n]*\}/g,
    desc: "带变量但空的 catch 块，吞错且丢失变量名",
  },
  {
    name: "catch返回null/undefined",
    regex: /}\s*catch\s*(?:\([^)]*\))?\s*\{[^}]*\breturn\s+(?:null|undefined|\{\})\s*[^}]*\}/g,
    desc: "catch 中返回 null/undefined/{} 将真实错误与正常缺值不可区分",
  },
  {
    name: "catch返回空数组",
    regex: /}\s*catch\s*(?:\([^)]*\))?\s*\{[^}]*\breturn\s+\[\]\s*[^}]*\}/g,
    desc: "catch 中返回 [] 将权限错误当无数据",
  },
  {
    name: "void Promise(潜在rejection)",
    regex: /\bvoid\s+\w+\([^)]*\)(?!\s*\.catch)/g,
    desc: "void 调用异步函数未附 .catch()",
  },
  {
    name: "硬编码URL",
    regex: /"(?:https?:\/\/)[^"]{5,}"/g,
    desc: "硬编码的 URL 字符串",
  },
  {
    name: "硬编码文件路径(/tmp或~/)",
    regex: /"(?:\/tmp\/|~\/\.\w+|C:\\[A-Z])[^"]{2,}"/g,
    desc: "硬编码的文件系统路径",
  },
  {
    name: "硬编码模型名",
    regex: /"(?:claude[-_](?:3|4|5|opus|sonnet|haiku)|gpt[-_](?:4|4o|3\.5)|deepseek[-_]|claude\.ai)"/gi,
    desc: "硬编码的模型名称",
  },
  {
    name: "as断言绕过类型",
    regex: /\bas\s+(?:Record<string,\s*unknown>|{[^}]*}|unknown\[\]|never)\b/g,
    desc: "as 类型断言绕过 TS 编译检查",
  },
  {
    name: "魔法数字(MB/KB)",
    regex: /\b(?:128_000|4_096|8_192|16_384|32_768|64_000|200_000)\b/g,
    desc: "常见的上下文/输出 token 魔法数字",
  },
  {
    name: "魔法数字(毫秒超时)",
    regex: /\b(?:5_000|10_000|15_000|30_000|45_000|60_000|120_000|300_000|600_000)\b/g,
    desc: "常见的超时魔法数字(ms)",
  },
  {
    name: "魔法数字(轮次/计数)",
    regex: /(?<!\w)(?:3|4|5|8|10|12|20|50|100|200)(?:\s*[,;)\]}])/g,
    desc: "可能为魔法数字的整数阈值",
  },
  {
    name: "export函数超过100行",
    regex: /^export\s+(?:async\s+)?function\s+\w+/gm,
    desc_ctx_lines: 120, // check if function spans >100 lines
    desc: "长函数签名(需要手动检查体量)",
  },
  {
    name: "TuiContext直接字段修改",
    regex: /context\.\w+(?:\s*=\s*|\.unshift\(|\.push\(|\.splice\()/g,
    desc: "对 TuiContext 属性的直接修改",
  },
  {
    name: "if-elseif链无else兜底",
    regex: /if\s*\([^)]+\)\s*\{[^}]*return[^}]*\}\s*(?:else\s+)?if\s*\([^)]+\)\s*\{/g,
    desc: "if/else-if 链(需手动检查最后有无 else 兜底)",
  },
  {
    name: "默认值使用硬编码中文",
    regex: /["'][^"']*[一-鿿][^"']{5,}["']/g,
    desc: "可能硬编码的中文用户可见字符串",
  },
];

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const findings = [];

  // Pattern-based scan
  for (const pattern of PATTERNS) {
    if (!pattern.regex) continue;
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      const matchText = match[0].length > 80 ? match[0].substring(0, 80) + "..." : match[0];
      findings.push({
        file: relative(ROOT, filePath).replace(/\\/g, "/"),
        line: lineNum,
        category: pattern.name,
        text: matchText,
        severity: pattern.name.includes("吞错误") ? "high" :
                   pattern.name.includes("void Promise") ? "medium" :
                   pattern.name.includes("硬编码") ? "medium" : "low",
        hint: pattern.desc,
      });
    }
    // Reset lastIndex for regex with global flag
    re.lastIndex = 0;
  }

  // Line-by-line manual checks
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Empty catch without logging
    if (/\bcatch\s*\{?\s*$/.test(line.trim()) || /catch\s*\(\s*\w*\s*\)\s*\{?\s*$/.test(line.trim())) {
      // Check next few lines to see if catch body is empty
      let body = "";
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        body += lines[j].trim();
      }
      if (body.length === 0 || body === "}" || body.startsWith("}")) {
        findings.push({
          file: relative(ROOT, filePath).replace(/\\/g, "/"),
          line: lineNum,
          category: "空catch(行级检测)",
          text: line.trim(),
          severity: "high",
          hint: '下一行似乎直接闭合 catch 块，无任何错误处理',
        });
      }
    }

    // .toFixed without NaN check
    if (/\.toFixed\(\d+\)/.test(line) && !/isNaN/.test(line) && !/Number\.isNaN/.test(line)) {
      // Check if there's a NaN guard nearby
      let nearby = lines.slice(Math.max(0, i-2), Math.min(lines.length, i+3)).join("\n");
      if (!nearby.includes("isNaN") && !nearby.includes("Number.isFinite")) {
        // skip if it's obviously fine
        findings.push({
          file: relative(ROOT, filePath).replace(/\\/g, "/"),
          line: lineNum,
          category: "toFixed未检查NaN",
          text: line.trim().substring(0, 80),
          severity: "low",
          hint: '.toFixed() 对 NaN 会抛出 RangeError',
        });
      }
    }

    // JSON.parse without try
    if (/\bJSON\.parse\(/.test(line) && !/try\s*\{/.test(lines[Math.max(0, i-2)]?.trim())) {
      // Check broader context
      let contextBlock = lines.slice(Math.max(0, i-3), Math.min(lines.length, i+1)).join("\n");
      if (!contextBlock.includes("try {") && !contextBlock.includes("catch")) {
        // Could be inside a larger try block — skip if seen try in function
      }
    }
  }

  return findings;
}

// Main
const files = collectFiles(SRC_DIRS);
const allFindings = [];

console.log(`Scanning ${files.length} files...`);

for (const file of files) {
  try {
    const findings = scanFile(file);
    allFindings.push(...findings);
  } catch (e) {
    console.error(`Error scanning ${file}: ${e.message}`);
  }
}

// Sort by severity then file then line
const severityOrder = { high: 0, medium: 1, low: 2 };
allFindings.sort((a, b) =>
  severityOrder[a.severity] - severityOrder[b.severity] ||
  a.file.localeCompare(b.file) ||
  a.line - b.line
);

// Generate report
let report = `# Linghun 逐行代码审计（自动化扫描）

**扫描时间**: ${new Date().toISOString()}
**扫描文件数**: ${files.length}
**发现问题数**: ${allFindings.length}

---

## 扫描模式

| 模式 | 检测内容 |
|------|---------|
${PATTERNS.filter(p => p.regex).map(p => `| ${p.name} | ${p.desc} |`).join("\n")}

---

## 按严重度汇总

| 严重度 | 数量 |
|--------|------|
| high | ${allFindings.filter(f => f.severity === "high").length} |
| medium | ${allFindings.filter(f => f.severity === "medium").length} |
| low | ${allFindings.filter(f => f.severity === "low").length} |

---

## 详细发现

`;

let currentFile = "";
for (const f of allFindings) {
  if (f.file !== currentFile) {
    currentFile = f.file;
    report += `\n### ${currentFile}\n\n`;
    report += `| 行号 | 类型 | 严重度 | 内容 |\n`;
    report += `|------|------|--------|------|\n`;
  }
  const escapedText = f.text.replace(/\|/g, "\\|").replace(/\n/g, " ");
  report += `| ${f.line} | ${f.category} | ${f.severity} | ${escapedText} |\n`;
}

writeFileSync(OUTPUT, report, "utf8");
console.log(`Done. Report written to ${OUTPUT}`);
console.log(`Total: ${allFindings.length} findings across ${files.length} files`);
