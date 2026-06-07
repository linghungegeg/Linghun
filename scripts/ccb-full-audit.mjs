// CCB 全量逐行审计脚本——每个文件逐行扫描
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

const ROOT = "F:\\ccb-source";
const REPORT = "F:\\Linghun\\CCB_FULL_LINE_AUDIT.md";

// 收集所有非测试 TS/TSX 文件
const allFiles = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("__")) walk(full);
    else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) && !e.name.includes(".test.")) {
      allFiles.push(full);
    }
  }
}
walk(join(ROOT, "src"));
walk(join(ROOT, "packages"));

console.log(`Total files to scan: ${allFiles.length}`);
let totalLines = 0;
const findings = [];
const bigFiles = [];

for (const file of allFiles) {
  try {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    totalLines += lines.length;
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (lines.length > 500) bigFiles.push({ file: rel, lines: lines.length });

    // Per-line scan
    for (let i = 0; i < lines.length; i++) {
      const ln = i + 1;
      const line = lines[i];
      const trimmed = line.trim();

      // 空 catch
      if (/}\s*catch\s*\{?\s*$/.test(trimmed) || /catch\s*\(\s*\w*\s*\)\s*\{?\s*$/.test(trimmed)) {
        let bodyLines = "";
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) bodyLines += lines[j].trim();
        if (bodyLines.length <= 1 || bodyLines === "}" || bodyLines.startsWith("}")) {
          findings.push({ file: rel, line: ln, cat: "空catch", sev: "high", text: trimmed.substring(0, 80) });
        }
      }

      // 硬编码URL
      const urlMatch = line.match(/"(https?:\/\/[^"]{4,})"/);
      if (urlMatch && !line.includes("//") && !line.includes("api.") && !line.includes("localhost")) {
        findings.push({ file: rel, line: ln, cat: "硬编码URL", sev: "medium", text: urlMatch[0].substring(0, 80) });
      }

      // 硬编码文件路径
      if (/(?:\.claude|~\/\.|\.linghun|\.ssh|\.gitconfig|\.bashrc)/.test(line) && (line.includes('"') || line.includes("'"))) {
        findings.push({ file: rel, line: ln, cat: "硬编码路径", sev: "low", text: trimmed.substring(0, 80) });
      }

      // 魔法数字（常见阈值）
      const magicMatch = line.match(/(?<![.\w])(3|4|5|8|10|12|20|30|50|100|200|500|1000|2000|5000|10000|30000|60000|120000|300000)\s*[,;)\]}]:]/);
      if (magicMatch && !line.includes("import") && !line.includes("export const") && !line.includes("MAX_") && !line.includes("DEFAULT_") && !line.includes("LIMIT") && !line.includes("TIMEOUT") && !line.includes("SIZE")) {
        // Only flag if it's not an obviously named constant
        if (!lines.slice(Math.max(0,i-2), i+1).join(" ").match(/(?:MAX|MIN|DEFAULT|LIMIT|TIMEOUT|THRESHOLD|CAP|SIZE)/i)) {
          findings.push({ file: rel, line: ln, cat: "魔法数字", sev: "low", text: trimmed.substring(0, 80) });
        }
      }

      // void Promise without .catch
      if (/\bvoid\s+\w+\(/.test(line) && !line.includes(".catch")) {
        const nextLine = i + 1 < lines.length ? lines[i+1] : "";
        if (!nextLine.includes(".catch")) {
          findings.push({ file: rel, line: ln, cat: "void Promise(无catch)", sev: "medium", text: trimmed.substring(0, 80) });
        }
      }

      // 类型断言 as
      if (/\bas\s+(?:Record<|unknown\[\]|{[^}]*}|never)\b/.test(line) && !line.includes("as const")) {
        findings.push({ file: rel, line: ln, cat: "as类型断言", sev: "low", text: trimmed.substring(0, 80) });
      }

      // 直接context修改 (CCB uses setAppState pattern)
      if (/\bsetAppState\(/.test(line) || /\bcontext\.\w+\s*=\s*/.test(line)) {
        findings.push({ file: rel, line: ln, cat: "直接状态修改", sev: "info", text: trimmed.substring(0, 80) });
      }

      // 中文硬编码字符串
      if (/[一-鿿]{4,}/.test(line) && (line.includes('"') || line.includes("'"))) {
        findings.push({ file: rel, line: ln, cat: "中文硬编码", sev: "info", text: trimmed.substring(0, 80) });
      }
    }
  } catch(e) { /* skip unreadable */ }
}

// 统计
const sevCounts = { high: 0, medium: 0, low: 0, info: 0 };
findings.forEach(f => sevCounts[f.sev]++);

// 写报告
let report = `# CCB 全量逐行审计报告
**扫描时间**: ${new Date().toISOString()}
**文件总数**: ${allFiles.length}
**总行数**: ${totalLines}
**发现问题总数**: ${findings.length}

## 严重度分布
| 严重度 | 数量 |
|--------|------|
| high | ${sevCounts.high} |
| medium | ${sevCounts.medium} |
| low | ${sevCounts.low} |
| info | ${sevCounts.info} |

## 超大文件 (>500行)
${bigFiles.sort((a,b) => b.lines - a.lines).slice(0, 50).map(f => `- ${f.file} (${f.lines}行)`).join("\n")}

## 空catch (high severity - ${sevCounts.high})
`;
findings.filter(f => f.sev === "high").forEach(f => {
  report += `- ${f.file}:${f.line} — \`${f.text}\`\n`;
});

report += `\n## 硬编码URL (medium - ${sevCounts.medium}次)
`;
findings.filter(f => f.sev === "medium").slice(0, 100).forEach(f => {
  report += `- ${f.file}:${f.line} — \`${f.text}\`\n`;
});

report += `\n## 按文件分布（前100个问题最多的文件）
`;
const fileCounts = {};
findings.forEach(f => { fileCounts[f.file] = (fileCounts[f.file] || 0) + 1; });
Object.entries(fileCounts).sort((a,b) => b[1] - a[1]).slice(0, 100).forEach(([file, count]) => {
  report += `- ${file}: ${count} 个问题\n`;
});

writeFileSync(REPORT, report, "utf8");
console.log(`Done. ${allFiles.length} files, ${totalLines} lines, ${findings.length} findings.`);
console.log(`High: ${sevCounts.high}, Medium: ${sevCounts.medium}, Low: ${sevCounts.low}, Info: ${sevCounts.info}`);
