import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { relative, join } from "node:path";

const ROOT_CCB = "F:\\ccb-source";
const REPORT_PATH = "F:\\Linghun\\CCB_STRUCTURE_SCAN.md";
const KEY_PATHS = [
  { base: join(ROOT_CCB, "src/services/api"), label: "API核心" },
  { base: join(ROOT_CCB, "src/components"), label: "UI组件" },
  { base: join(ROOT_CCB, "src/utils"), label: "工具函数" },
  { base: join(ROOT_CCB, "src/hooks"), label: "React Hooks" },
  { base: join(ROOT_CCB, "src/keybindings"), label: "键绑定" },
  { base: join(ROOT_CCB, "src/jobs"), label: "Job/后台" },
  { base: join(ROOT_CCB, "src/context"), label: "Context" },
  { base: join(ROOT_CCB, "src/commands"), label: "命令" },
  { base: join(ROOT_CCB, "src/bridge"), label: "远程桥接" },
  { base: join(ROOT_CCB, "src/buddy"), label: "Buddy" },
  { base: join(ROOT_CCB, "src/bootstrap"), label: "启动" },
  { base: join(ROOT_CCB, "src/cli"), label: "CLI" },
  { base: join(ROOT_CCB, "src/constants"), label: "常量" },
  { base: join(ROOT_CCB, "src/coordinator"), label: "协调器" },
  { base: join(ROOT_CCB, "src/daemon"), label: "守护进程" },
  { base: join(ROOT_CCB, "src/entrypoints"), label: "入口" },
  { base: join(ROOT_CCB, "src/memdir"), label: "内存目录" },
  { base: join(ROOT_CCB, "src/migrations"), label: "迁移" },
  { base: join(ROOT_CCB, "src/skills"), label: "技能" },
  { base: join(ROOT_CCB, "src/state"), label: "状态管理" },
  { base: join(ROOT_CCB, "packages/builtin-tools/src/tools"), label: "工具实现" },
  { base: join(ROOT_CCB, "packages/mcp-client/src"), label: "MCP Client" },
  { base: join(ROOT_CCB, "packages/weixin/src"), label: "微信" },
  { base: join(ROOT_CCB, "packages/@ant/ink/src/hooks"), label: "Ink Hooks" },
  { base: join(ROOT_CCB, "packages/@ant/ink/src/components"), label: "Ink Components" },
  { base: join(ROOT_CCB, "packages/@ant/ink/src/core"), label: "Ink Core" },
  { base: join(ROOT_CCB, "packages/@ant/model-provider/src"), label: "Model Provider" },
];

function scanDir(dir, label) {
  if (!existsSync(dir)) return { label, files: [], totalLines: 0, exportCount: 0 };
  const files = [];
  let totalLines = 0;
  function walk(d) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("__")) {
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        try {
          const content = readFileSync(full, "utf8");
          const lines = content.split("\n").length;
          totalLines += lines;
          const rel = relative(ROOT_CCB, full).replace(/\\/g, "/");
          const exports = [];
          for (const line of content.split("\n")) {
            const mf = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
            if (mf) exports.push(mf[1]);
            const mc = line.match(/^export\s+(?:const|let)\s+(\w+)/);
            if (mc) exports.push(mc[1]);
          }
          files.push({ file: rel, lines, exports: exports.slice(0, 10) });
        } catch {}
      }
    }
  }
  walk(dir);
  return { label, files, totalLines, exportCount: files.reduce((s, r) => s + r.exports.length, 0) };
}

let report = `# CCB 结构扫描报告\n扫描时间: ${new Date().toISOString()}\n\n`;

for (const { base, label } of KEY_PATHS) {
  const r = scanDir(base, label);
  const relativeBase = relative(ROOT_CCB, base).replace(/\\/g, "/");
  report += `\n## ${label} (${relativeBase})\n`;
  report += `- 文件数: ${r.files.length} | 总行数: ${r.totalLines} | 导出符号: ${r.exportCount}\n`;
  const bigFiles = r.files.filter(f => f.lines > 500);
  if (bigFiles.length) report += `- 超大文件(>500行): ${bigFiles.map(f => `${f.file}(${f.lines}行)`).join(", ")}\n`;
  else report += `- 超大文件(>500行): 无\n`;
  const topExports = r.files.flatMap(f => f.exports).slice(0, 30);
  if (topExports.length) report += `- 主要导出: ${topExports.join(", ")}\n`;

  for (const f of r.files.slice(0, 60)) {
    report += `  - ${f.file} (${f.lines}行): ${f.exports.slice(0, 5).join(", ") || "(无导出)"}\n`;
  }
  if (r.files.length > 60) report += `  ... 还有 ${r.files.length - 60} 个文件\n`;
}

const allDirs = KEY_PATHS.map(({ base, label }) => scanDir(base, label));
const totalFiles = allDirs.reduce((s, d) => s + d.files.length, 0);
const totalLines = allDirs.reduce((s, d) => s + d.totalLines, 0);
report += `\n## 汇总\n- 扫描目录: ${KEY_PATHS.length}\n- 文件总计: ${totalFiles}\n- 行数总计: ${totalLines}\n`;

writeFileSync(REPORT_PATH, report, "utf8");
console.log(`Done. ${KEY_PATHS.length} dirs, ${totalFiles} files, ${totalLines} lines.`);
